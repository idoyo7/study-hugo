---
title: "03 관측성 — 기본으로 보이는 것과 켜야 보이는 것"
description: "Istio의 표준 메트릭·액세스 로그·트레이싱과 Cilium Hubble의 flow·L7 가시성을 견주고, 둘이 서로 다른 층을 본다는 점을 정리한다."
date: 2026-10-19
lastmod: 2026-10-19
weight: 3
url: "/istio/cilium/03-observability/"
---

# 03 · 관측성 — 기본으로 보이는 것과 켜야 보이는 것

## 1. 같은 요청을 어디서 기록하는가

아래 도식은 같은 요청이 지나갈 때 Istio와 Hubble이 각각 어느 지점에서 기록을 남기는지 보여 줍니다.

{{< flow src="_flow/1-기록-자리-비교.json" />}}

Hubble이 있으면 Istio의 관측 기능을 대신할 수 있을까요? L7 지표의 기본 제공 범위는 Istio가 넓습니다. Hubble은 메시 밖 파드까지 포함한 L3/L4 flow(트래픽 기록)와 패킷이 버려진 이유를 보여 줍니다. 이 글에서는 두 도구가 서로 다른 층을 관측한다고 봅니다.

이 차이는 기록을 수집하는 위치에서 시작합니다. Istio 표준 메트릭 문서에서 계측 지점은 L7을 처리하는 Envoy입니다. HTTP로 분류된 요청은 모두 표준 메트릭의 대상이자 span(트레이스를 구성하는 개별 작업 기록) 후보가 됩니다. Cilium Hubble 문서는 eBPF에서 수집한 L3/L4 flow를 기본으로 제공합니다. HTTP 메서드나 경로 같은 L7 정보까지 얻으려면 요청이 노드 Envoy를 지나야 하며, 이 경로는 L7 정책이나 Gateway API 리스너 같은 설정에 따라 정해집니다.

프록시 배치 자체는 [01편]({{< relref "/platform/istio/cilium/01-l4-l7-proxy-placement/index.md" >}})에서 다뤘습니다. 여기서는 그 배치가 실제로 남기는 메트릭, 로그, 트레이스의 차이를 살펴봅니다. 메시의 관측 기능 전반은 [메시가 공짜로 주는 관측성]({{< relref "/platform/istio/operations/06-observability-points.md" >}})을 참고하면 됩니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-19이고, Istio 1.31.2 문서와 Cilium stable 문서를 기준으로 합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Istio는 Envoy가 계측 지점 | HTTP로 분류된 트래픽에 표준 메트릭 적용 | Istio 표준 메트릭 문서 | `✓` |
| Hubble은 eBPF에서 flow 수집, L3/L4가 기본 | IP·포트·identity·verdict·drop reason | Cilium Hubble 문서 | `✓` |
| Hubble의 L7 flow는 Envoy를 지날 때만 생김 | L7 규칙이 있는 정책이 필요 | Cilium Hubble·가시성 문서 | `✓` |
| 두 도구는 보는 층이 다르다 | 위 사실을 묶은 판단 | — | `Σ` |

{{% /details %}}

## 2. Istio에서 기본으로 얻는 것과 설정할 것

다음은 Telemetry API에서 액세스 로그 필터와 트레이싱 샘플링 비율을 지정한 최소 예시입니다.

```yaml
apiVersion: telemetry.istio.io/v1
kind: Telemetry
metadata:
  name: web-telemetry
  namespace: shop
spec:
  accessLogging:
    - filter:
        expression: "response.code >= 500"
  tracing:
    - randomSamplingPercentage: 1.0
```

Istio의 관측 기능이 모두 기본으로 켜지는 것은 아닙니다. 사이드카 모드에서는 프로토콜에 맞는 표준 메트릭이 나오지만, 액세스 로그는 따로 켜야 합니다. 트레이싱에서는 Envoy가 span을 보내더라도 앱이 헤더를 전파해야 호출 전체를 하나의 트레이스로 연결할 수 있습니다.

### 프로토콜과 라벨이 메트릭의 의미를 정합니다

Istio 표준 메트릭 문서에 따르면 사이드카 모드의 모든 HTTP·gRPC 요청에는 `istio_requests_total`, `istio_request_duration_milliseconds`, `istio_request_bytes`, `istio_response_bytes`가 나옵니다. TCP로 분류된 연결에는 `istio_tcp_sent_bytes_total`, `istio_tcp_received_bytes_total`, `istio_tcp_connections_opened_total`, `istio_tcp_connections_closed_total`이 기록됩니다.

HTTP 서비스인데 TCP 메트릭만 보인다면 프로토콜 분류를 살펴봐야 합니다. 포트 이름이나 `appProtocol`로 프로토콜을 정하지 않았고 자동 감지까지 실패하면 Istio는 해당 트래픽을 TCP로 처리합니다. 이때는 HTTP 메트릭이 남지 않습니다.

메트릭을 읽을 때는 값만큼 라벨도 중요합니다. `reporter`는 source 또는 destination 중 어느 쪽에서 측정했는지 나타내고, `source_principal`은 호출자의 SPIFFE 신원을 담습니다. mTLS 여부를 나타내는 `connection_security_policy`는 측정 방향에 따라 읽어야 합니다. destination 쪽 리포트에서는 `mutual_tls`로 채워지지만 source 쪽에서는 `unknown`입니다.

`response_flags`에는 Envoy가 응답에 붙인 부가 정보가 들어갑니다. 예를 들어 5xx가 앱에서 발생했는지 프록시가 만들었는지 구분하는 데 이 라벨을 씁니다. 다음 편에서 다룰 연결 풀 초과(`UO`)도 여기에 드러납니다.

### 로그를 켜는 일과 트레이스를 잇는 일

Istio Telemetry 작업 문서는 액세스 로그가 기본으로 꺼져 있다고 설명합니다. `meshConfig.accessLogFile: /dev/stdout`으로 켤 수 있으며, 문서가 권장하는 설정 방법은 Telemetry API입니다. 기본 로그 포맷에는 `%RESPONSE_CODE%`, `%RESPONSE_FLAGS%`, `%RESPONSE_CODE_DETAILS%`가 포함됩니다.

트레이싱은 프록시와 앱이 함께 처리해야 합니다. Istio 분산 트레이싱 문서에서 Envoy가 span을 보낼 수 있는 백엔드는 OpenTelemetry, Zipkin, SkyWalking, Datadog, Stackdriver입니다. 각 홉의 span을 하나로 연결하려면 앱이 `x-request-id`, `traceparent`/`tracestate`, B3 같은 헤더를 다음 호출로 전달해야 합니다. 이 헤더 전파의 한계는 06편에서 설명했습니다.

앞의 YAML에 사용한 Telemetry API(`telemetry.istio.io/v1`)는 메트릭, 액세스 로그, 트레이싱 설정을 한 리소스에서 다룹니다. 적용 범위는 루트 네임스페이스에서 네임스페이스로, 다시 selector로 선택한 워크로드로 좁혀 갑니다. 메트릭 비활성화와 `tagOverrides`, 액세스 로그 필터, 트레이싱 샘플링과 `customTags`를 이 방식으로 조절합니다.

### Ambient에서는 waypoint 유무를 봐야 합니다

Ambient 모드에서는 ztunnel과 waypoint가 내보내는 정보가 다릅니다. ztunnel은 HTTP를 파싱하지 않으므로 Istio 표준 TCP 메트릭만 제공합니다. Istio ambient 문서는 waypoint를 사용하면 Istio와 Envoy 메트릭 전체가 보고된다고 설명합니다. waypoint가 없는 서비스에서는 L7 지표를 얻을 수 없습니다.

ztunnel 로그도 HTTP 요청 로그와는 형태가 다릅니다. `src.*`, `dst.*`, `direction`, `bytes_sent`, `bytes_recv`, `duration` 같은 필드를 key=value 형식으로 남깁니다. 참고로 표준 메트릭의 `reporter` 값 정의에는 `waypoint`가 없습니다.

이 정보를 시각화하는 Istio용 관측 콘솔은 Kiali입니다. Kiali 연동 문서는 Kiali를 별도로 설치하는 애드온으로 안내합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 표준 메트릭 이름과 TCP 메트릭 | `istio_requests_total` 외 HTTP 4종·메시지 2종, `istio_tcp_*` 4종 | Istio 표준 메트릭 문서 | `✓` |
| 주요 라벨 | reporter, source_principal, connection_security_policy, response_flags 등 | Istio 표준 메트릭 문서 | `✓` |
| 액세스 로그 기본 off | `meshConfig.accessLogFile` 또는 Telemetry API로 켬 | Istio Telemetry 작업 문서 | `✓` |
| span은 Envoy, 헤더 전파는 앱 | `x-request-id`, `traceparent`/`tracestate`, B3 | Istio 분산 트레이싱 개요 | `✓` |
| Telemetry API 범위 | 루트 네임스페이스 → 네임스페이스 → selector 워크로드 | Istio Telemetry 작업 문서 | `✓` |
| ambient에서 L7 지표는 waypoint | ztunnel은 L4 TCP 메트릭만, waypoint를 쓰면 전체 보고 | Istio ambient 문서 | `✓` |
| `reporter`·`connection_security_policy` 값 | reporter는 source/destination, 후자는 destination에서만 `mutual_tls` | Istio 표준 메트릭 문서 | `✓` |
| 액세스 로그 기본 포맷, 트레이싱 백엔드 | RESPONSE_FLAGS 포함, 5종 | Istio 문서 | `✓` |
| Kiali는 애드온 | Istio용 관측 콘솔 | Istio Kiali 연동 문서 | `✓` |

{{% /details %}}

## 3. Hubble의 L7 관측은 정책에서 시작합니다

다음 예시는 HTTP 요청을 Envoy로 보내기 위해 빈 HTTP 규칙을 둔 CiliumNetworkPolicy입니다.

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: web-l7-visibility
  namespace: shop
spec:
  endpointSelector:
    matchLabels:
      app: web
  ingress:
    - toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
          rules:
            http:
              - {}
```

Hubble에서 L3/L4 flow는 기본으로 보이지만, HTTP 메서드와 경로까지 보려면 L7 가시성을 켜야 합니다. Cilium 가시성 문서는 L7 규칙이 있는 CiliumNetworkPolicy를 만들도록 안내합니다. HTTP 메서드, 경로, 상태 코드, 지연이나 DNS 정보는 요청이 노드 Envoy를 지날 때만 얻을 수 있습니다.

여기서 관측 설정은 트래픽 허용 범위에도 영향을 줍니다. 과거에는 `policy.cilium.io/proxy-visibility` 어노테이션으로 가시성만 켤 수 있었으나, 이 기능은 1.15에서 deprecated되고 1.17에서 제거되었습니다. 현재 문서가 안내하는 가시성용 정책은 허용할 트래픽도 제한합니다.

관측만 필요하면 앞의 예시처럼 “허용형 L7 규칙”을 씁니다. Cilium L7 정책 문서는 규칙이 하나 이상 매칭되면 요청을 허용한다고 설명합니다. 이 조건에 비춰 보면 빈 HTTP 규칙은 해당 포트의 모든 HTTP 요청을 매칭하고 허용하는 규칙으로 읽힙니다. 정책이 선택한 파드와 포트의 나머지 트래픽에는 허용 목록에 따른 제한이 생기므로 적용 범위를 정확히 정해야 합니다.

L7 메트릭의 수집 범위도 이 정책을 따릅니다. Cilium 메트릭 문서는 HTTP 같은 L7 메트릭이 L7 Protocol Visibility를 켠 파드에서만 나온다고 명시합니다. 사이드카 모드의 Istio는 메시에 들어온 서비스에서 HTTP로 분류한 요청의 지표를 기본으로 내지만, Hubble에서는 L7 가시성을 켠 서비스만 L7 지표가 나옵니다.

### 기본 flow에서 볼 수 있는 것

L7 설정을 하지 않아도 Hubble은 eBPF에서 L3/L4 flow를 수집합니다. Cilium Hubble 문서가 설명하는 기본 기록에는 IP, 포트, identity, `FORWARDED`나 `DROPPED` 같은 verdict(처리 결과), drop reason(폐기 이유)이 들어가며, 정책에 막힌 패킷의 폐기 이유는 Istio 메트릭에 없는 정보입니다. 메시에 참여하지 않은 파드의 트래픽도 같은 방식으로 볼 수 있습니다.

조회 범위는 Hubble 구성에 따라 달라집니다. 기본 Hubble API는 Cilium agent가 실행되는 노드 하나를 다루고, Hubble Relay를 두면 ClusterMesh를 포함한 클러스터 범위로 넓어집니다. CLI에서는 `hubble observe`를 사용합니다. Hubble UI는 서비스 의존 관계를 자동으로 찾아 그래프로 그립니다.

### Flow 수집과 메트릭 활성화는 별개입니다

Flow가 보인다고 메트릭도 켜져 있는 것은 아닙니다. `hubble.metrics.enabled`를 설정하지 않으면 Hubble 메트릭은 기본으로 꺼져 있습니다. 필요한 그룹을 골라 활성화하며, 공개 메트릭 그룹에는 lost events, `dns`, `drop`, `flow`, `flows-to-world`, `http`, `httpV2`, `icmp`, `port-distribution`, `tcp`, `sctp`와 dynamic exporter 메트릭이 있습니다.

HTTP 메트릭 그룹인 `httpV2`는 `hubble_http_requests_total`에 method, protocol, status, reporter 라벨을 붙입니다. 지연 메트릭인 `hubble_http_request_duration_seconds`에는 method, reporter 라벨이 들어갑니다. `sourceContext`와 `destinationContext`를 설정하면 namespace, pod, workload-name, app, dns, ip, identity 같은 라벨도 추가할 수 있습니다. Cilium 메트릭 문서는 이런 컨텍스트를 추가할수록 카디널리티(라벨 값 조합의 수)가 늘어난다고 설명합니다.

Trace ID를 메트릭의 exemplar로 붙이는 설정은 `exemplars=true`이며, OpenMetrics 형식이 필요합니다.

### 액세스 로그는 전달하지만 span은 만들지 않습니다

Cilium 문서의 액세스 로그 경로는 Envoy에서 시작합니다. Envoy가 UNIX 소켓으로 agent에 로그를 보내면 Hubble L7 flow로 나옵니다. `envoy.log.accessLogEnabled`의 기본값은 true입니다. L7 정책 없이 Gateway 트래픽만 있는 경우에도 L7 flow가 나오는지는 확인하지 못했습니다.

Hubble은 HTTP flow의 `traceparent`에서 trace ID를 읽으며, span을 직접 만들지는 않습니다. Cilium의 Envoy도 span을 내보낼 수 없습니다. cilium/proxy 소스의 빌드 설정에는 OpenTelemetry tracer 확장이 빠져 있고 zipkin, datadog tracer도 없습니다.

GitHub 이슈 #44850은 이 때문에 Gateway API 경로에서 분산 트레이싱을 잃는 문제를 다룹니다. 2026-10-14에 메인테이너는 Gateway API의 experimental `TelemetryPolicy`가 대체할 수 있다는 코멘트를 남겼습니다. 조사 시점에도 이슈는 해결되지 않은 상태입니다. hubble-otel 어댑터 역시 유지보수가 중단되었다는 이슈 코멘트가 있습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Hubble 구성 요소와 범위 | 노드 단위가 기본, Relay로 클러스터·ClusterMesh, UI 의존 그래프 | Cilium Hubble 문서 | `✓` |
| L3/L4 flow가 기본 | verdict FORWARDED/DROPPED, drop reason | Cilium Hubble·가시성 문서 | `✓` |
| L7 가시성은 L7 규칙 CNP가 필요, 정책이 허용 트래픽도 제한 | HTTP·DNS | Cilium 가시성 문서 | `✓` |
| `proxy-visibility` 어노테이션 | 1.15 deprecated, 1.17 제거 | Cilium 업그레이드 노트 | `✓` |
| 허용형 `http: [{}]` 패턴 | 규칙 하나라도 매칭하면 허용, 빈 규칙의 의미는 읽은 해석 | Cilium L7 정책 문서 | `≈` |
| Hubble 메트릭 그룹과 httpV2 라벨 | 그룹 11종, 기본 꺼짐, L7 메트릭은 L7 가시성 파드만 | Cilium 메트릭 문서 | `✓` |
| context 라벨은 카디널리티 증가, exemplar | `exemplars=true`, OpenMetrics 필요 | Cilium 메트릭 문서 | `✓` |
| Cilium Envoy는 span을 내지 않음 | OTel·zipkin·datadog tracer가 빌드에서 빠짐 | cilium/proxy v1.38 빌드 설정 | `✓` |
| Gateway 경로 트레이싱 부재 제안 | 이슈 #44850 Open, TelemetryPolicy 코멘트 | GitHub 이슈 | `Ⓥ` |
| hubble-otel 유지보수 중단 | 이슈 코멘트 | GitHub 이슈 #41259 | `Ⓥ` |
| 액세스 로그 경로 | Envoy → agent(UNIX 소켓) → Hubble L7 flow | Cilium 문서 | `✓` |
| 정책 없는 Gateway 트래픽의 L7 flow | 확인하지 못함 | — | `?` |

{{% /details %}}

## 4. 필요한 관측 정보로 비교하기

| Istio | Cilium / Hubble |
|---|---|
| `istio_requests_total` — 모든 HTTP, 기본 | `hubble_http_requests_total` — L7 가시성을 켠 파드만 |
| `response_flags` — UO, UF, URX 등 | 대응 라벨 없음, drop reason은 L3/L4 |
| `source_principal` — SPIFFE 신원 | identity 숫자와 라벨 컨텍스트 |
| `connection_security_policy` | 없음 |
| 요청·응답 바이트 분포, gRPC status | 없음, L4 바이트는 flow에서 |
| Envoy가 span을 기본 송출 | span 미생성, Envoy 빌드에 tracer 없음 |
| — | Hubble에만 있음: L3/L4 drop 이유와 정책 verdict, DNS, 메시 밖 파드를 포함한 전 파드 flow |

관측 기능 때문에 어느 한쪽을 제거하려면, 필요한 정보가 무엇인지부터 적어 봐야 합니다. 위 표는 Istio 표준 메트릭 문서와 Cilium Hubble·메트릭 문서의 항목을 나란히 놓은 것입니다. 이 글의 판단으로는 서비스 간 HTTP 호출과 네트워크에서의 패킷 처리를 모두 살펴야 할 때 두 도구는 서로를 보완합니다.

서비스 간 HTTP 호출의 성공률, 지연 분포, 프록시가 만든 에러를 확인하는 데 필요한 정보는 Istio의 기본 메트릭에 갖춰져 있습니다. 연결 실패의 원인이 정책에 막힌 패킷이라면 Hubble의 verdict와 drop reason을 봐야 합니다. 구조로 보면 프록시에 닿기 전에 버려진 요청은 Istio 메트릭에 잡히지 않고, 그 폐기 사실은 Hubble에 남습니다.

Cilium CNI 위에 Istio를 사용하는 구성에서는 같은 요청을 서로 다른 층에서 관측합니다. L7 지표와 span은 이를 제공하는 Envoy 쪽에서, L3/L4 가시성과 정책 verdict는 eBPF 쪽에서 얻습니다. 두 범위가 모두 필요하다면 도구 하나만 남길 수 있는지보다 각각의 기록으로 어떤 문제를 확인할지 살펴야 합니다. 이 조합을 사용할 때의 주의점은 5편에서 다룹니다.

게이트웨이로 들어오는 경로는 구현에 따라 관측 방식도 달라지므로 [02편]({{< relref "/platform/istio/cilium/02-gateway-api/index.md" >}})의 구조를 함께 참고합니다. [04편]({{< relref "/platform/istio/cilium/04-retry-resilience/index.md" >}})에서는 재시도와 타임아웃이 발생했을 때 어떤 지표로 그 동작을 확인할 수 있는지 살펴봅니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 비교표의 Istio 쪽 항목 | 표준 메트릭·라벨 정의 | Istio 표준 메트릭 문서 | `✓` |
| 비교표의 Cilium 쪽 항목 | Hubble 메트릭·flow 정의 | Cilium Hubble·메트릭 문서 | `✓` |
| 표의 대비 구성 | 두 문서를 나란히 놓은 정리 | — | `Σ` |
| 정책에 막힌 패킷은 Hubble에만 남음 | 프록시에 닿기 전에 떨어진 요청은 Istio 메트릭에 안 잡힘 | 구조상 도출 | `≈` |

{{% /details %}}

## 참고 자료

- [Istio Standard Metrics](https://istio.io/latest/docs/reference/config/metrics/) — Istio, latest(2026-10-19 확인) `✓`
- [Telemetry API](https://istio.io/latest/docs/tasks/observability/telemetry/) — Istio, latest(2026-10-19 확인) `✓`
- [Distributed Tracing Overview](https://istio.io/latest/docs/tasks/observability/distributed-tracing/overview/) — Istio, latest(2026-10-19 확인) `✓`
- [Kiali](https://istio.io/latest/docs/ops/integrations/kiali/) — Istio, latest(2026-10-19 확인) `✓`
- [Hubble](https://docs.cilium.io/en/stable/observability/hubble/) — Cilium, stable(2026-10-19 확인) `✓`
- [Visibility](https://docs.cilium.io/en/stable/observability/visibility/) — Cilium, stable(2026-10-19 확인) `✓`
- [Metrics](https://docs.cilium.io/en/stable/observability/metrics/#hubble-exported-metrics) — Cilium, stable(2026-10-19 확인) `✓`
- [Layer 7 policy examples](https://docs.cilium.io/en/stable/security/policy/language/#layer-7-examples) — Cilium, stable(2026-10-19 확인) `✓`
