---
title: "03 두 프록시의 발자국 — 메트릭·로그·트레이스"
description: "호출 쪽과 대상 쪽의 기록을 맞춰 실패한 홉을 찾는다. 메트릭의 reporter부터 로그의 요청 ID, 앱이 전파하는 trace context까지 따라간다."
date: 2026-11-07
lastmod: 2026-11-09
inlineToc: false
weight: 3
url: "/study/istio-mesh/03-traces-left-behind/"
aliases:
  - "/study/istio-mesh/05-logs-and-tracing/"
  - "/istio/mesh-traffic/05-logs-and-tracing/"
---

# 03 · 두 프록시의 발자국 — 메트릭·로그·트레이스

메트릭은 문제가 생긴 서비스와 시간대를 좁혀 줍니다. 요청 하나까지 보이지는 않습니다. 그 요청이 어느 홉에서 실패했는지는 로그에서, 호출이 어떻게 이어졌는지는 트레이스에서 찾습니다. 이 기록들을 맞춰 읽으려면 먼저 기록을 남긴 프록시를 구분해야 합니다.

## 한 요청을 따로 세는 두 사이드카 {#요청-하나에-기록이-두-번-남는-자리}

`reporter="source"`는 호출 쪽 프록시, `reporter="destination"`은 대상 쪽 프록시가 남긴 메트릭입니다. 정상적인 내부 호출에서도 양쪽을 더하면 같은 요청이 중복 집계됩니다.

{{< flow src="_flow/1-두-사이드카의-기록.json" />}}

재시도나 연결 실패가 생기면 양쪽 수치가 달라질 수 있습니다. 호출 쪽 Envoy가 연결 실패로 503을 직접 만들었다면, 요청은 대상 사이드카에 닿지 못하고 기록은 source에만 남습니다. 이 차이는 reporter와 Envoy response flag의 정의에서 추론했습니다.

대상 프록시가 받은 HTTP 요청 중 5xx의 비율을 보려면 분자와 분모 모두 `reporter="destination"`으로 제한합니다.

```promql
sum by (destination_service) (
  rate(istio_requests_total{reporter="destination", response_code=~"5.."}[5m])
)
/
sum by (destination_service) (
  rate(istio_requests_total{reporter="destination"}[5m])
)
```

대상에 도착하기 전의 실패는 source 쪽에서 따로 확인합니다. 중복 집계를 피하려고 source 메트릭 수집 자체를 끄면 그 실패도 놓칩니다.

관측 지점을 골랐는데 HTTP 메트릭이 없다면 프로토콜 분류를 봅니다. HTTP를 해석하는 프록시는 요청 수·상태 코드·지연을 기록하며, HTTP·gRPC로 분류된 요청에는 요청 수·지연·바이트 메트릭이 붙습니다. TCP로 처리하는 경우 남는 것은 연결 수와 바이트를 세는 `istio_tcp_*` 네 개입니다. 프로토콜을 정하지 않은 HTTP 서비스가 TCP로 분류되면 요청 메트릭은 나오지 않습니다. 이때는 [2편의 프로토콜 분류]({{< relref "/study/istio-mesh/02-between-proxies/index.md#http인지는-포트-선언이-먼저-정한다" >}})부터 확인합니다.

기본 설정은 사이드카 메트릭과 앱 메트릭을 병합합니다. 수집 주소는 `:15020/stats/prometheus`입니다. 프록시가 실제로 세고 있는 값을 직접 확인하려면 Envoy admin을 조회합니다.

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

## IP 뒤에 붙은 워크로드 이름과 신원 {#ip에서-워크로드-이름으로}
<span id="남길-라벨을-고르면-저장량도-달라진다"></span>

메트릭의 `source_workload` 같은 라벨은 HTTP 메타데이터 교환과 istiod의 워크로드 정보로 채웁니다. 워크로드 이름이 보인다는 사실과 상대의 신원이 인증됐다는 사실은 구분해서 읽어야 합니다.

{{< seq src="_seq/2-메타데이터-교환.json" />}}

HTTP 교환에 쓰는 헤더는 `x-envoy-peer-metadata`와 `x-envoy-peer-metadata-id`입니다. 필터 설정에는 `istio_headers`와 `workload_discovery`가 함께 들어갑니다. 둘의 조회 우선순위는 확인하지 못했습니다. TCP에서는 mTLS 핸드셰이크의 ALPN `istio-peer-exchange`로 메타데이터를 교환합니다.

인증된 신원을 나타내는 `source_principal`의 근거는 mTLS 피어 인증서입니다. 값은 인증서의 SPIFFE ID에서 옵니다. 그래서 평문 호출에서는 `source_principal`이 비어 있고, 메시 밖 클라이언트가 호출하면 `source_workload`는 `unknown`입니다. 라벨이 비었을 때는 어떤 정보로 그 라벨을 채우는지부터 구분합니다.

mTLS 여부를 읽을 때도 관측 지점이 맞아야 합니다. `connection_security_policy="mutual_tls"`는 `reporter="destination"`인 기록에서 의미가 있습니다. source 쪽 값은 `unknown`입니다. [표준 메트릭 정의](https://istio.io/latest/docs/reference/config/metrics/)

라벨로 남길 정보도 고릅니다. 사용자 ID·원문 URL처럼 값이 계속 늘어나는 정보는 메트릭 라벨 대신 로그·span에 둡니다. 메트릭에 남길 라벨을 줄일 때는 Telemetry의 `tagOverrides`를 씁니다. [Telemetry API](https://istio.io/latest/docs/reference/config/telemetry/)

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 표준 라벨 목록, source/destination_principal은 피어 인증을 쓸 때 채워짐 | 1.31.4 문서 | [Istio Standard Metrics](https://istio.io/latest/docs/reference/config/metrics/) |
| connection_security_policy는 destination에서 `mutual_tls`, source에서 `unknown` | 문서 정의 | 같은 문서 |
| 사이드카 HTTP 필터 `istio.metadata_exchange`, discovery `istio_headers`·`workload_discovery` | 1.31.4 소스의 생성 설정 | istio/istio `pilot/pkg/xds/filters/filters.go` |
| 헤더 이름 `x-envoy-peer-metadata`, `x-envoy-peer-metadata-id` | istio/proxy e2e 테스트 | istio/proxy `test/envoye2e/http_metadata_exchange` |
| TCP는 ALPN `istio-peer-exchange`, `PILOT_DISABLE_MX_ALPN`으로 끔 | mTLS 연결 | istio/istio `pilot/pkg/networking/util/util.go` |
{{% /details %}}

## `UF`를 남긴 프록시와 503의 홉 {#5xx에서-실패한-홉으로-좁혀-가기}

같은 503이어도 실패한 홉은 다릅니다. `UF`는 그 로그를 남긴 프록시의 업스트림 연결 실패를 뜻합니다. 호출 쪽의 업스트림은 대상 사이드카이고, 대상 쪽의 업스트림은 자기 앱입니다.

{{< seq src="_seq/3-연결-실패의-두-자리.json" />}}

이 차이를 로그에서 찾으려면 먼저 액세스 로그가 켜져 있어야 합니다. Istio 1.31.4에서는 기본으로 꺼져 있고 데모 프로필만 켜져 있습니다. 아래 설정은 기본 루트 네임스페이스인 `istio-system`에서 내장 `envoy` provider를 선택하는 예입니다.

```yaml
apiVersion: telemetry.istio.io/v1
kind: Telemetry
metadata:
  name: access-log
  namespace: istio-system
spec:
  accessLogging:
    - providers:
        - name: envoy
```

설정을 놓는 위치도 결과를 바꿉니다. Telemetry는 루트 네임스페이스, 네임스페이스, selector 워크로드 순으로 적용됩니다. 자식의 필드는 부모의 필드를 병합 없이 덮어씁니다.

로그에 남은 flag는 먼저 살펴볼 대상을 좁혀 줍니다.

| flag | 먼저 확인할 곳 |
|---|---|
| `UF` | 업스트림 연결·TLS 실패 사유 |
| `UH` | 건강한 엔드포인트가 남아 있는지 |
| `UO` | 연결 풀·요청 수 제한 초과 |
| `UT` | 업스트림 응답 시간과 타임아웃 |
| `NR` | 맞는 라우트나 filter chain이 없음 |

기본 TEXT 포맷에서는 아래 명령으로 flag가 남은 줄만 추립니다. 메트릭의 `response_flags`에도 같은 값이 들어갑니다.

```bash
kubectl logs deploy/web -c istio-proxy --since=10m | awk '$6 != "-"' | tail
```

로그가 없다는 사실만으로 요청의 도착 여부를 단정해서는 안 됩니다. 양쪽의 로그 활성화·필터·수집 상태를 확인한 뒤, 같은 시간대의 `response_flags`와 업스트림 주소를 살피고 전파된 `x-request-id`로 두 로그를 맞춥니다. 호출 쪽 로그에 `UF`가 있고 대상 쪽 로그에 같은 요청 ID가 없다면 요청은 대상 사이드카에 도착하지 못했습니다. 상태 코드가 같아도 실패한 구간까지 같지는 않습니다. [액세스 로그 설정](https://istio.io/latest/docs/tasks/observability/logs/access-log/) · [Envoy flag 정의](https://www.envoyproxy.io/docs/envoy/latest/configuration/observability/access_log/usage#response-flags)

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 액세스 로그 기본 off, Telemetry API `providers: [{name: envoy}]` 권장 | 데모 프로필만 `/dev/stdout` | [Istio Envoy Access Logs](https://istio.io/latest/docs/tasks/observability/logs/access-log/) |
| `filter.expression`은 CEL | Telemetry v1 | [Telemetry API 레퍼런스](https://istio.io/latest/docs/reference/config/telemetry/) |
| 기본 포맷에 RESPONSE_FLAGS, RESPONSE_CODE_DETAILS, X-REQUEST-ID, UPSTREAM_HOST 포함 | `EnvoyTextLogFormat` | istio/istio 1.31.4 `pilot/pkg/model/telemetry_logging.go` |
| `response_flags` 라벨 값은 Envoy 로그의 flag와 같음 | 1.31.4 문서 | [Istio Standard Metrics](https://istio.io/latest/docs/reference/config/metrics/) |
| awk 예시의 `$6`이 flag 칸 | 기본 TEXT 포맷이고 공백이 없을 때 | 기본 포맷에서 계산 |
{{% /details %}}

## 앱의 다음 호출로 이어지는 trace context {#span을-이어-주는-것은-앱의-헤더-전파}

프록시는 앱이 새로 만든 요청이 어느 수신 요청에서 비롯됐는지 알지 못합니다. 호출을 하나의 트레이스로 이으려면 앱이나 계측 라이브러리가 `traceparent`·`tracestate` 또는 B3 context를 다음 호출에 전달해야 합니다.

{{< seq src="_seq/4-앱의-trace-context-전파.json" />}}

OpenTelemetry 자동 계측은 이 context의 추출·주입과 앱 내부 span 생성을 맡을 수 있습니다. 전파가 빠지면 백엔드에는 홉마다 끊긴 짧은 트레이스만 쌓입니다. 프록시가 기록을 남겨도 앱에서 다음 호출로 잇는 과정까지 대신하지는 못합니다.

기록을 보낼 OpenTelemetry provider는 meshConfig의 `extensionProviders`에 있는 `opentelemetry`로 정의합니다. 여기에 Collector 주소와 포트(gRPC 4317)를 적고, Telemetry의 `tracing.providers`로 provider를 선택합니다. 샘플링 비율은 `randomSamplingPercentage`로 지정합니다.

트레이스에는 모든 요청이 담기지 않습니다. 기본 샘플링 비율은 1%이며, 설정 우선순위는 Telemetry API, 파드 어노테이션, MeshConfig 순입니다. 경로가 모두 Envoy라면 첫 홉의 샘플링 결정을 뒤의 Envoy들도 `x-request-id`로 이어받습니다. 다른 프록시가 끼면 이 결정은 유지되지 않습니다.

<span id="로그에-trace-id를-남기는-설정"></span>

로그에서 트레이스로 넘어갈 때는 ID를 구분합니다. `x-request-id`는 홉별 로그를 맞추는 요청 ID이고, trace ID는 트레이스를 조회하는 ID입니다. 기본 로그에는 요청 ID만 있으므로 trace ID도 남기려면 로그 포맷에 `%TRACE_ID%`를 추가합니다.

로그 포맷은 meshConfig의 `envoyFileAccessLog.logFormat.text`로 정의하고 Telemetry에서 provider 이름으로 선택합니다. 트레이싱 provider와 샘플링 설정도 필요합니다. ID가 남았더라도 백엔드에 span이 저장되지 않았다면 조회할 트레이스는 없습니다. [Istio 트레이싱과 헤더 전파](https://istio.io/latest/docs/tasks/observability/distributed-tracing/overview/)

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 지원 백엔드 5종, 앱이 전파할 헤더 목록 | 1.31.4 문서 | [Distributed Tracing Overview](https://istio.io/latest/docs/tasks/observability/distributed-tracing/overview/) |
| OTel provider gRPC 4317, HTTP 4318 `/v1/traces` | 1.31.4 문서 | [OpenTelemetry 작업 문서](https://istio.io/latest/docs/tasks/observability/distributed-tracing/opentelemetry/) |
| 기본 샘플링 1%, 우선순위 Telemetry API > 파드 어노테이션 > MeshConfig | 퍼센트 샘플러 | [Sampling](https://istio.io/latest/docs/tasks/observability/distributed-tracing/sampling/) |
| 기본 포맷에 X-REQUEST-ID는 있고 TRACE_ID는 없음 | `EnvoyTextLogFormat` | istio/istio 1.31.4 `telemetry_logging.go` |
| 비샘플 요청의 trace ID 출력 여부 | 확인하지 못함 | — |
{{% /details %}}

## Ambient에서 기록을 남기는 ztunnel과 waypoint
<span id="ambient에서-요청을-읽는-자리는-waypoint"></span>

Ambient에서는 요청을 관측하는 위치가 달라집니다. ztunnel은 L4만 처리하므로 연결 단위로 기록합니다. 메트릭은 `istio_tcp_*` 네 개이고, 로그는 연결이 끝날 때 쓰는 `connection complete` 한 줄입니다. 여기에 상태 코드와 response flag는 없습니다.

HTTP 요청 단위 기록이 필요한 서비스에는 waypoint를 붙입니다. waypoint는 Envoy이므로 사이드카처럼 표준 메트릭과 액세스 로그, span을 남깁니다.

waypoint를 붙인 요청 경로의 L7 프록시는 waypoint 하나입니다. 앞의 두 사이드카 그림과 reporter 조건을 그대로 옮기지 말고 실제 요청 경로에서 확인합니다. 문서의 reporter 정의에는 waypoint 값이 없고, 실제 값도 확인하지 못했습니다. [Ambient의 L7 기능](https://istio.io/latest/docs/ambient/usage/l7-features/) · [ambient를 왜 쓰나]({{< relref "/platform/istio/ambient/01-why-ambient-mode/index.md" >}})

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| ztunnel만 쓰면 L4 TCP 메트릭 4종, waypoint가 있으면 Istio·Envoy 메트릭 전체 | 1.31.4 문서 | [Troubleshoot ztunnel](https://istio.io/latest/docs/ambient/usage/troubleshoot-ztunnel/), [L7 features](https://istio.io/latest/docs/ambient/usage/l7-features/) |
| ztunnel 로그 필드 | `connection complete` 레코드 | Troubleshoot ztunnel |
| waypoint 경로의 reporter 값 | 문서에 waypoint 값이 없음, 실제 값은 확인하지 못함 | [Istio Standard Metrics](https://istio.io/latest/docs/reference/config/metrics/) |
{{% /details %}}

<span id="참고-자료"></span>

[← 2편 신원을 주고받는 두 프록시]({{< relref "/study/istio-mesh/02-between-proxies/index.md" >}}) · [시리즈 처음으로]({{< relref "/study/istio-mesh/_index.md" >}})
