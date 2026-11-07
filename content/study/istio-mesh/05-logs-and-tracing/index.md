---
title: "05 요청이 지나간 자리에 남는 발자국 — 메트릭·로그·트레이스"
description: "실패한 요청이 어느 프록시까지 갔는지 어떻게 찾나. 메트릭의 reporter로 기록 위치를 구분하고, 라벨과 요청 ID·trace ID로 로그와 트레이스를 이어 읽는다."
date: 2026-11-07
lastmod: 2026-11-07
weight: 5
url: "/study/istio-mesh/05-logs-and-tracing/"
aliases:
  - "/istio/mesh-traffic/05-logs-and-tracing/"
---

# 05 · 요청이 지나간 자리에 남는 발자국 — 메트릭·로그·트레이스

5xx가 늘었다는 사실만으로는 실패한 위치를 알 수 없습니다. 메트릭에서 범위를 좁히고 로그에서 요청을 고른 뒤 트레이스로 홉을 이으려면, 각 기록을 어느 프록시가 남겼는지부터 구분해야 합니다.

시리즈는 [01편]({{< relref "/study/istio-mesh/01-l4-l7-before-mesh/index.md" >}})의 메시 이전 통신에서 출발해 [게이트웨이]({{< relref "/study/istio-mesh/02-gateway-to-sidecar/index.md" >}})와 [프록시 사이 구간]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}})을 따라왔습니다. [04편]({{< relref "/study/istio-mesh/04-l7-only-features/index.md" >}})의 재시도와 카나리는 프록시가 요청 하나하나를 해석하기 때문에 가능한 기능입니다. 요청을 읽는 그 자리에서 메트릭과 액세스 로그, span도 만들어집니다.

설명의 기준은 2026-11-07의 Istio 1.31.4와, 이 버전이 고정한 Envoy 1.39 개발 브랜치 커밋입니다.

## 요청 하나가 양쪽에 남기는 두 발자국 {#요청-하나에-기록이-두-번-남는-자리}

메시 안의 호출은 호출 쪽 사이드카의 outbound와 대상 쪽 사이드카의 inbound를 지납니다. 양쪽 모두 같은 요청을 기록합니다.

{{< flow src="_flow/1-두-사이드카의-기록.json" />}}

메트릭의 `reporter` 라벨은 기록을 남긴 쪽을 구분합니다. 호출 쪽은 `reporter="source"`, 대상 쪽은 `reporter="destination"`입니다. 게이트웨이는 source로 보고합니다. reporter를 고르지 않고 `sum(rate(istio_requests_total[5m]))`을 구하면 메시 내부 트래픽이 두 배로 잡히는 이유가 여기에 있습니다.

서비스별 5xx 비율을 대상 쪽 기록으로 계산하려면 쿼리에 reporter 조건을 넣습니다.

```promql
# 서비스별 5xx 비율 — 대상 쪽 기록만 쓴다
sum by (destination_service) (rate(istio_requests_total{reporter="destination", response_code=~"5.."}[5m]))
  / sum by (destination_service) (rate(istio_requests_total{reporter="destination"}[5m]))
```

그렇다고 두 기록이 늘 같은 값을 갖지는 않습니다. 연결 실패로 호출 쪽 Envoy가 503을 만들고 요청이 대상 사이드카에 닿지 못했다면, 기록은 source에만 남습니다. reporter와 Envoy response flag 정의에서 추론한 차이입니다. 호출 앱이 보는 성공률은 source 쪽 숫자에 가깝고, 서버가 실제로 처리한 결과는 destination 쪽 숫자에 가깝습니다.

무엇을 셀 수 있는지는 프로토콜 분류에 달렸습니다. 사이드카는 HTTP를 파싱해 메서드, 경로, 상태 코드, 지연을 읽으므로 앱에 계측 코드를 넣지 않아도 요청 단위의 표준 메트릭을 만듭니다. HTTP·gRPC로 분류된 요청에는 `istio_requests_total`, `istio_request_duration_milliseconds`, `istio_request_bytes`, `istio_response_bytes`가 붙고, gRPC에는 메시지 수 카운터 두 개가 더 생깁니다.

TCP로 분류되면 `istio_tcp_*` 네 개만 남습니다. 포트 이름이나 `appProtocol`로 프로토콜을 정하지 않은 HTTP 서비스가 TCP로 분류되면 요청 메트릭은 나오지 않습니다. 요청 수가 보이지 않을 때 확인할 프로토콜 감지는 [03편]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}})에서 이어집니다.

기본 설정에서는 사이드카 메트릭과 앱 메트릭을 병합하며, 수집 주소는 `:15020/stats/prometheus`입니다. 프록시가 실제로 세는 값은 Envoy admin에서 직접 조회합니다.

```bash
kubectl exec deploy/web -c istio-proxy -- \
  pilot-agent request GET stats/prometheus | grep '^istio_requests_total' | head
```

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| HTTP 메트릭 4종, gRPC 메시지 메트릭 2종, TCP 메트릭 4종 | 사이드카, 프로토콜 분류에 따름 | [Istio Standard Metrics](https://istio.io/latest/docs/reference/config/metrics/) |
| reporter는 서버 쪽 프록시면 destination, 클라이언트 쪽 프록시나 게이트웨이면 source | 1.31.4 문서 | 같은 문서 |
| 대상까지 못 간 요청은 source에만 남음 | 구조상 도출, 호출 쪽 Envoy가 로컬 응답을 만든 경우 | 위 정의와 Envoy response flag 정의에서 추론 |
| 메트릭 병합 기본 on, `:15020/stats/prometheus` | `meshConfig.enablePrometheusMerge=false`로 끔 | [Istio Prometheus 통합](https://istio.io/latest/docs/ops/integrations/prometheus/) |
{{% /details %}}

### IP 뒤에 있던 워크로드 이름이 드러난다 {#ip에서-워크로드-이름으로}

`istio_requests_total`에는 `source_workload`, `source_principal`, `destination_workload`, `destination_service`, `response_code`, `response_flags`, `connection_security_policy` 같은 라벨이 붙습니다. 그런데 대상 사이드카가 아는 것은 연결의 출발지 IP이고, 호출 쪽 사이드카가 아는 것은 자신이 고른 엔드포인트 IP입니다. 상대의 워크로드와 버전을 채우려면 정보가 더 있어야 합니다.

Istio는 metadata exchange로 그 정보를 얻습니다. HTTP에서는 `istio.metadata_exchange` 필터가 요청과 응답에 워크로드 정보를 실어 교환합니다.

{{< seq src="_seq/2-메타데이터-교환.json" />}}

교환에 쓰는 헤더는 `x-envoy-peer-metadata`와 `x-envoy-peer-metadata-id`입니다. 1.31.4가 생성하는 필터 설정에는 헤더를 읽는 `istio_headers`와 istiod가 내려 준 워크로드 정보를 조회하는 `workload_discovery`가 함께 들어갑니다. 헤더가 없으면 워크로드 정보에서 상대를 찾는다는 흐름은 이 설정 배열의 순서에서 읽은 것이며, 조회 우선순위 자체를 문서에서 확인한 것은 아닙니다.

TCP에는 헤더를 붙일 곳이 없습니다. mTLS 핸드셰이크의 ALPN에 `istio-peer-exchange`를 넣어 교환을 협상합니다. ALPN 협상 과정은 [03편]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}})에서 다뤘습니다.

라벨이 비어 있거나 `unknown`인 이유도 여기서 찾습니다. 메시 밖 클라이언트가 호출하면 대상 사이드카에는 받을 헤더도, 조회할 워크로드 정보도 없어 `source_workload`가 `unknown`으로 남습니다. `source_principal`은 mTLS 피어 인증서의 SPIFFE ID에서 오므로 평문 호출에서는 비어 있습니다.

`connection_security_policy`는 reporter까지 함께 읽어야 뜻이 분명해집니다. 문서 정의상 destination 기록은 mTLS일 때 `mutual_tls`이고, source 기록은 항상 `unknown`입니다. mTLS가 적용되지 않은 호출을 찾는 쿼리에 `reporter="destination"` 조건을 함께 넣어야 하는 이유입니다.

HTTP 필터 체인에 metadata exchange와 stats 필터가 들어 있는지는 설정으로 확인합니다.

```bash
# HTTP 필터 체인에 metadata exchange와 stats 필터가 들어 있는지
istioctl proxy-config listener deploy/web --port 15006 -o json \
  | grep -o '"name": "istio\.\(metadata_exchange\|stats\)"' | sort | uniq -c
```

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 표준 라벨 목록, source/destination_principal은 피어 인증을 쓸 때 채워짐 | 1.31.4 문서 | [Istio Standard Metrics](https://istio.io/latest/docs/reference/config/metrics/) |
| connection_security_policy는 destination에서 `mutual_tls`, source에서 `unknown` | 문서 정의. 평문일 때의 `none`은 istio/proxy 테스트 데이터에서 확인 | 같은 문서, istio/proxy `testdata/metric` |
| 사이드카 HTTP 필터 `istio.metadata_exchange`, discovery `istio_headers`·`workload_discovery`, propagation `istio_headers` | 1.31.4 소스의 생성 설정 | istio/istio `pilot/pkg/xds/filters/filters.go` |
| 헤더 이름 `x-envoy-peer-metadata`, `x-envoy-peer-metadata-id` | istio/proxy e2e 테스트 | istio/proxy `test/envoye2e/http_metadata_exchange` |
| TCP는 ALPN `istio-peer-exchange`, `PILOT_DISABLE_MX_ALPN`으로 끔 | mTLS 연결 | istio/istio `pilot/pkg/networking/util/util.go`, `pilot/pkg/features/pilot.go` |
| 헤더와 워크로드 조회의 우선순위 | 설정 배열 순서로 읽은 것, 문서 근거 없음 | — |
{{% /details %}}

## 5xx의 흔적을 따라 실패한 홉까지 {#5xx에서-실패한-홉으로-좁혀-가기}

메트릭에는 개별 요청이 없습니다. 라벨 조합별 합계에서 문제가 생긴 범위를 찾았다면, 같은 시간대의 `destination_workload`, `response_code`, `response_flags`를 조건으로 로그를 고릅니다. 액세스 로그에는 요청 한 건이 남지만, 보이는 범위는 그 로그를 쓴 홉까지입니다.

그 로그는 켜야 남습니다. Istio 1.31.4에서는 액세스 로그가 기본으로 꺼져 있고 데모 프로필만 켜져 있습니다. 문서가 권장하는 설정은 Telemetry API에서 내장 provider `envoy`를 지정하는 방식입니다. CEL 필터를 붙여 기록할 요청을 줄이는 설정도 여기에 들어갑니다.

```yaml
apiVersion: telemetry.istio.io/v1
kind: Telemetry
metadata:
  name: mesh-default
  namespace: istio-system
spec:
  accessLogging:
    - providers:
        - name: envoy
      filter:
        expression: "response.code >= 400"
```

기본 TEXT 포맷은 한 줄에 스무 개 남짓한 필드를 남깁니다. 앞부분에는 요청 줄, 상태 코드, response flag, 실패 사유가 있고, 뒷부분에는 요청 ID, 업스트림 주소, 클러스터, 라우트 이름이 있습니다. 문서의 예시에서 앞부분을 읽어 보면 응답을 누가 만들었는지 드러납니다.

```text
[2020-11-25T21:26:18.409Z] "GET /status/418 HTTP/1.1" 418 - via_upstream - "-" 0 135 4 4 "-" ...
```

`418` 뒤의 `-`는 `%RESPONSE_FLAGS%`, 이어지는 `via_upstream`은 `%RESPONSE_CODE_DETAILS%`입니다. 이 상태 코드는 앱에서 왔습니다. Envoy가 직접 응답을 만들었다면 flag 칸에 두세 글자 코드가 찍히고 details에 이유가 들어갑니다. 같은 503이라도 아래 flag에 따라 살펴볼 곳이 달라집니다.

| flag | 함께 오는 코드 | Envoy가 본 것 |
|---|---|---|
| `UH` | 503 | 업스트림 클러스터에 건강한 엔드포인트가 없음 |
| `UF` | 503 | 업스트림 연결 실패 |
| `UO` | 503 | 서킷 브레이커(연결 풀) 초과 |
| `URX` | — | HTTP 재시도 한도 또는 TCP 최대 연결 시도 도달 |
| `NR` | 404 | 맞는 라우트가 없음, 또는 downstream 연결에 맞는 filter chain이 없음 |
| `UT` | 504 | 업스트림 요청 타임아웃 |
| `UC` | 503 | 업스트림 연결이 중간에 끊김 |
| `DC` | — | downstream(호출자) 연결이 끊김 |

같은 `UF`라도 어느 프록시의 로그인지에 따라 실패한 위치가 달라집니다. 호출 쪽 로그에 `UF`가 있고 대상 쪽 로그에 같은 요청 ID가 없다면, 요청은 대상 사이드카에 도착하지 못했습니다. 대상 쪽 로그에도 `UF`가 있다면 그 사이드카가 자기 앱 컨테이너에 연결하지 못한 것입니다.

메트릭의 `response_flags`에도 같은 flag 값이 들어갑니다. 메트릭에서 flag별로 범위를 좁힌 뒤 해당 로그를 찾는 순서입니다. 기본 TEXT 포맷에서 flag가 남은 줄을 추리는 명령은 아래와 같습니다.

```bash
kubectl logs deploy/web -c istio-proxy --since=10m | awk '$6 != "-"' | tail
```

간헐적 5xx를 이 방식으로 쫓은 사례는 [장애 추적 글]({{< relref "/platform/istio/operations/05-incident-intermittent-5xx/index.md" >}})에서 이어집니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 액세스 로그 기본 off, Telemetry API `providers: [{name: envoy}]` 권장, `meshConfig.accessLogFile`도 가능 | 데모 프로필만 `/dev/stdout` | [Istio Envoy Access Logs](https://istio.io/latest/docs/tasks/observability/logs/access-log/), 1.31.4 `manifests/charts/*/files/profile-demo.yaml` |
| `filter.expression`은 CEL | Telemetry v1 | [Telemetry API 레퍼런스](https://istio.io/latest/docs/reference/config/telemetry/) |
| 기본 포맷에 RESPONSE_FLAGS, RESPONSE_CODE_DETAILS, CONNECTION_TERMINATION_DETAILS, UPSTREAM_TRANSPORT_FAILURE_REASON, X-REQUEST-ID, UPSTREAM_HOST, ROUTE_NAME 포함 | `EnvoyTextLogFormat` | istio/istio 1.31.4 `pilot/pkg/model/telemetry_logging.go` |
| flag 정의와 함께 오는 응답 코드 | Envoy 1.39.7-dev 커밋 `8893f913` | Envoy `substitution_formatter.rst` |
| `response_flags` 라벨 값은 Envoy 로그의 flag와 같음 | 1.31.4 문서 | [Istio Standard Metrics](https://istio.io/latest/docs/reference/config/metrics/) |
| awk 예시의 `$6`이 flag 칸 | 기본 TEXT 포맷이고 메서드·경로·프로토콜에 공백이 없을 때 | 기본 포맷에서 계산 |
{{% /details %}}

## 앱이 헤더를 건네야 span도 이어진다 {#span을-이어-주는-것은-앱의-헤더-전파}

사이드카가 span을 만들어도 앱의 연속된 호출까지 저절로 이어지지는 않습니다. 호출 쪽 사이드카는 클라이언트 span을, 대상 쪽 사이드카는 서버 span을 남깁니다. 그런데 대상 앱이 요청을 받은 뒤 다른 서비스를 호출하면, 사이드카에는 별개의 새 요청으로 보입니다. 앞서 받은 요청과 같은 트레이스에 속한다는 사실은 앱만 압니다.

앱이 이 관계를 전달해야 합니다. 들어온 요청의 `x-request-id`, `traceparent`, `tracestate`를 나가는 요청에 그대로 옮겨 싣습니다. Zipkin B3를 쓴다면 `x-b3-*` 다섯 개가 전파 대상입니다. 이 과정이 빠지면 백엔드에는 홉마다 끊긴 짧은 트레이스만 쌓입니다.

OpenTelemetry SDK를 쓰는 앱이라면 자동 계측에 헤더 전파를 맡기고, 앱 내부 작업까지 span으로 남길 수 있습니다.

span을 보낼 백엔드로 Istio가 지원하는 provider는 OpenTelemetry, Zipkin, SkyWalking, Datadog, Stackdriver입니다. OpenTelemetry를 선택하면 Collector로 OTLP를 보냅니다.

```yaml
# meshConfig — gRPC OTLP(4317). HTTP라면 4318과 http.path: /v1/traces
extensionProviders:
  - name: otel-tracing
    opentelemetry:
      service: opentelemetry-collector.observability.svc.cluster.local
      port: 4317
---
apiVersion: telemetry.istio.io/v1
kind: Telemetry
metadata:
  name: mesh-default
  namespace: istio-system
spec:
  tracing:
    - providers:
        - name: otel-tracing
      randomSamplingPercentage: 1.0
```

트레이스는 여러 홉을 잇지만 모든 요청을 담지는 않습니다. 기본 샘플링 비율은 1%이며, 퍼센트 샘플러 설정은 Telemetry API, 파드 어노테이션 `proxy.istio.io/config`, MeshConfig 순으로 우선합니다. 커스텀 OTel 샘플러를 쓰면 그쪽이 우선입니다.

경로의 프록시가 모두 Envoy라면 첫 홉에서 고른 요청을 뒤의 Envoy들도 이어서 샘플링합니다. Envoy가 기본적으로 샘플링 결정을 `x-request-id` UUID 안에 담아 넘기기 때문입니다. 중간에 다른 프록시가 있으면 이 성질이 유지되지 않으므로, 그 프록시의 샘플링 정책과 맞춰야 합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 지원 백엔드 5종, 앱이 전파할 헤더 목록 | 1.31.4 문서 | [Distributed Tracing Overview](https://istio.io/latest/docs/tasks/observability/distributed-tracing/overview/) |
| OTel provider gRPC 4317, HTTP 4318 `/v1/traces`, exporter는 하나만 | 1.31.4 문서 | [OpenTelemetry 작업 문서](https://istio.io/latest/docs/tasks/observability/distributed-tracing/opentelemetry/) |
| 기본 샘플링 1%, 우선순위 Telemetry API > 파드 어노테이션 > MeshConfig | 퍼센트 샘플러. 커스텀 OTel 샘플러를 쓰면 그쪽이 우선 | [Sampling](https://istio.io/latest/docs/tasks/observability/distributed-tracing/sampling/) |
| x-request-id에 trace reason을 담아 Envoy 집합 전체에서 안정적으로 샘플링 | Envoy가 아닌 프록시가 섞이면 깨짐 | Envoy `arch_overview/observability/tracing.rst` (커밋 `8893f913`) |
{{% /details %}}

### 로그에 trace ID를 남겨 지나온 길을 잇다 {#로그에-trace-id를-남기는-설정}

요청 ID도 trace 헤더처럼 앱이 전파해야 홉을 넘어 같은 값으로 남습니다. 전파가 되어 있다면 `x-request-id`는 홉별 로그를 맞추는 기준입니다. 호출 쪽과 대상 쪽 로그에서 같은 값을 찾으면 앞서 `UF`를 읽었듯 요청이 어느 홉에서 멈췄는지 확인합니다.

로그에서 트레이스로 넘어가려면 trace ID가 필요합니다. 기본 포맷에는 `x-request-id`가 있지만 trace ID는 없습니다. Envoy의 `%TRACE_ID%` 연산자를 넣은 로그 포맷을 provider로 정의하고 Telemetry에서 그 provider를 선택하면, 로그 한 줄에서 트레이스를 찾을 ID를 얻습니다.

```yaml
# meshConfig — 기본 포맷 뒤에 trace ID를 덧붙인 파일 로그 provider
extensionProviders:
  - name: envoy-with-trace
    envoyFileAccessLog:
      path: /dev/stdout
      logFormat:
        text: "[%START_TIME%] \"%REQ(:METHOD)% %REQ(X-ENVOY-ORIGINAL-PATH?:PATH)% %PROTOCOL%\" %RESPONSE_CODE% %RESPONSE_FLAGS% %RESPONSE_CODE_DETAILS% \"%REQ(X-REQUEST-ID)%\" \"%UPSTREAM_HOST%\" %UPSTREAM_CLUSTER_RAW% trace=%TRACE_ID%\n"
```

그 링크가 실제 트레이스로 이어지려면 백엔드에 span이 있어야 합니다. 샘플링된 요청에서만 가능한 연결입니다. 기본 1% 샘플링이라면 로그 백 줄 가운데 한 줄 정도에 트레이스가 있다는 뜻입니다. 비샘플 요청에서도 trace ID가 출력되는지는 확인하지 못했으며, tracer 구현에 따라 다를 수 있습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 기본 포맷에 X-REQUEST-ID는 있고 TRACE_ID는 없음 | `EnvoyTextLogFormat` | istio/istio 1.31.4 `telemetry_logging.go` |
| `%TRACE_ID%`는 HTTP에서 trace ID, 없으면 빈 문자열 | Envoy 커밋 `8893f913` | Envoy `substitution_formatter.rst` |
| `envoyFileAccessLog.logFormat.text`로 포맷 지정 | meshConfig extensionProviders, Telemetry에서 provider 이름으로 선택 | istio/istio 1.31.4 `telemetry_logging.go`, `tests/integration/telemetry/api/setup_test.go` |
| 비샘플 요청의 trace ID 출력 여부 | 확인하지 못함. tracer 구현에 따라 다를 수 있음 | — |
{{% /details %}}

## 남길 라벨이 바꾸는 기록의 두께 {#남길-라벨을-고르면-저장량도-달라진다}

표준 메트릭의 시계열 수에는 source 워크로드 수 × destination 서비스 수 × 응답 코드 × flag × reporter 두 값 × 버전이 곱해지고, 히스토그램에는 버킷 수도 더 곱해집니다.

Istio 문서도 라벨이 카디널리티를 높여 저장 공간을 많이 쓸 수 있다고 경고합니다. 기본 라벨에 요청 경로가 없는 이유도 여기에 있습니다. 경로나 사용자 ID처럼 값이 끝없이 늘어나는 정보는 로그나 span 속성에 둡니다.

Telemetry API에서는 쓰지 않는 라벨을 `REMOVE`로 빼거나 한쪽 reporter의 메트릭을 통째로 끕니다. 아래 설정은 `destination_canonical_revision`과 `source_canonical_revision`을 제거합니다.

```yaml
apiVersion: telemetry.istio.io/v1
kind: Telemetry
metadata:
  name: mesh-default
  namespace: istio-system
spec:
  metrics:
    - providers:
        - name: prometheus
      overrides:
        - match:
            metric: ALL_METRICS
            mode: CLIENT_AND_SERVER
          tagOverrides:
            destination_canonical_revision:
              operation: REMOVE
            source_canonical_revision:
              operation: REMOVE
```

설정을 놓는 위치도 결과를 바꿉니다. Telemetry는 루트 네임스페이스 → 네임스페이스 → selector 워크로드 순으로 적용되며, 자식의 필드는 부모의 필드를 병합 없이 덮어씁니다. 네임스페이스에 `metrics`를 하나 정의하면 메시 전역 metrics 설정이 그 네임스페이스에서는 사라집니다.

reporter 한쪽을 끄면 시계열은 크게 줄어듭니다. 무엇을 보지 못하게 되는지도 함께 따져야 합니다. 대상까지 가지 못한 요청은 source에만 남으므로, source를 끄면 그 정보도 잃습니다. 제거할 라벨을 고르는 기준 역시 그 라벨로 어떤 질문에 답하고 있는지입니다. 저장 계층의 대응은 [VictoriaMetrics 카디널리티]({{< relref "/observability/metrics/victoriametrics/practice/01-cardinality/index.md" >}})에서 다룹니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 라벨이 카디널리티를 늘린다는 경고 | 1.31.4 문서 | [Istio Prometheus 통합](https://istio.io/latest/docs/ops/integrations/prometheus/) |
| `tagOverrides` UPSERT/REMOVE, `mode` CLIENT/SERVER/CLIENT_AND_SERVER, `disabled: true` | Telemetry v1 | [Telemetry API 레퍼런스](https://istio.io/latest/docs/reference/config/telemetry/) |
| 계층과 덮어쓰기 규칙 | 같은 워크로드를 고르는 Telemetry 둘은 무효 | [Telemetry API 작업 문서](https://istio.io/latest/docs/tasks/observability/telemetry/) |
| 1.31.4에서 source_app·destination_app이 다시 `app` 라벨을 씀 | 이전 패치의 회귀 수정 | [1.31.4 릴리스 공지](https://istio.io/latest/news/releases/1.31.x/announcing-1.31.4/) |
{{% /details %}}

## ambient에서 waypoint를 지나면 요청이 보인다 {#ambient에서-요청을-읽는-자리는-waypoint}

ambient 모드에는 파드마다 사이드카가 없습니다. 노드의 ztunnel은 L4만 처리하고 HTTP를 파싱하지 않으므로, 메트릭도 `istio_tcp_*` 네 개만 남깁니다. 로그는 연결이 끝날 때 한 줄씩 쓰는 `connection complete` 기록입니다. 양쪽 워크로드와 SPIFFE ID, 방향, 바이트, 지속 시간이 들어가며 상태 코드와 response flag는 없습니다.

요청 단위 기록이 필요한 서비스에는 waypoint를 붙입니다. waypoint는 Envoy이므로 Istio 표준 메트릭 전체를 내고, 액세스 로그와 span도 사이드카처럼 남깁니다.

요청 경로의 L7 프록시가 waypoint 하나이므로, 양쪽 사이드카가 같은 요청을 기록하던 첫 그림을 그대로 적용하지는 못합니다. 사이드카 모드의 메트릭 쿼리를 가져온다면 reporter 조건을 다시 확인해야 합니다. 표준 메트릭 문서의 reporter 정의에는 waypoint 값이 없고, 실제 값도 여기서는 확인하지 못했습니다.

ztunnel과 waypoint가 놓이는 경로는 [ambient를 왜 쓰나]({{< relref "/platform/istio/ambient/01-why-ambient-mode/index.md" >}})에서 이어집니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| ztunnel만 쓰면 L4 TCP 메트릭 4종, waypoint가 있으면 Istio·Envoy 메트릭 전체 | 1.31.4 문서 | [Troubleshoot ztunnel](https://istio.io/latest/docs/ambient/usage/troubleshoot-ztunnel/), [L7 features](https://istio.io/latest/docs/ambient/usage/l7-features/) |
| ztunnel 로그 필드 | `connection complete` 레코드 | Troubleshoot ztunnel |
| waypoint 경로의 reporter 값 | 표준 메트릭 문서의 reporter 정의에 waypoint 값이 없음, 실제 값은 확인하지 못함 | [Istio Standard Metrics](https://istio.io/latest/docs/reference/config/metrics/) |
| 1.31.4에서 ztunnel이 잘못된 `traceparent`에 panic하던 문제 수정 | GHSA-77vw-rg85-wx5x | [1.31.4 릴리스 공지](https://istio.io/latest/news/releases/1.31.x/announcing-1.31.4/) |
{{% /details %}}

프록시가 요청을 해석해 제공하는 재시도와 카나리는 [04편]({{< relref "/study/istio-mesh/04-l7-only-features/index.md" >}})에서 다뤘습니다.

## 참고 자료

- [로그 분류]({{< relref "/observability/logs/_index.md" >}}) — 로그를 쌓을 저장소 선택
- [메시가 공짜로 주는 관측성]({{< relref "/platform/istio/operations/06-observability-points.md" >}}) — 메시 관측성을 한 장으로 보는 글
- [관측성 — 기본으로 보이는 것과 켜야 보이는 것]({{< relref "/platform/istio/cilium/03-observability/index.md" >}}) — Cilium Hubble과의 비교
