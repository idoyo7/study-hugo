---
title: "05 요청 뒤에 남은 발자국 — 메트릭·로그·트레이스"
description: "두 사이드카가 남기는 메트릭, 503이 멈춘 홉, 앱이 이어 주는 trace context를 그림으로 따라간다."
date: 2026-11-07
lastmod: 2026-11-08
inlineToc: false
weight: 5
url: "/study/istio-mesh/05-logs-and-tracing/"
aliases:
  - "/istio/mesh-traffic/05-logs-and-tracing/"
---

# 05 · 요청 뒤에 남은 발자국 — 메트릭·로그·트레이스

같은 요청도 어느 프록시에서 보느냐에 따라 기록이 달라집니다. 먼저 호출 쪽과 대상 쪽을 나눠 봅니다.

{{< flow src="_flow/1-두-사이드카의-기록.json" />}}

## 요청 하나, 두 관측 지점 {#요청-하나에-기록이-두-번-남는-자리}

`reporter="source"`는 호출 쪽, `reporter="destination"`은 대상 쪽 프록시의 메트릭입니다. 둘을 합하면 정상적인 내부 호출도 중복 집계됩니다. 재시도나 연결 실패가 끼면 양쪽 수치가 달라질 수 있습니다.

대상 프록시가 받은 HTTP 요청의 5xx 비율은 이렇게 구합니다. 대상에 도착하기 전의 실패는 source 쪽에서 따로 확인합니다.

```promql
sum by (destination_service) (
  rate(istio_requests_total{reporter="destination", response_code=~"5.."}[5m])
)
/
sum by (destination_service) (
  rate(istio_requests_total{reporter="destination"}[5m])
)
```

HTTP를 해석하는 프록시에는 요청 수·상태 코드·지연이 보입니다. TCP로 처리하면 연결 수와 바이트만 남습니다. HTTP 메트릭이 없다면 [03편의 프로토콜 분류]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md#http인지는-포트-선언이-먼저-정한다" >}})부터 확인합니다.

## IP 뒤의 워크로드 이름 {#ip에서-워크로드-이름으로}

{{< seq src="_seq/2-메타데이터-교환.json" />}}

HTTP 메타데이터 교환과 istiod의 워크로드 정보가 `source_workload` 같은 라벨을 채웁니다. **워크로드 이름과 인증된 신원은 구분해야 합니다.** `source_principal`의 신원 근거는 mTLS 피어 인증서입니다.

mTLS 여부를 볼 때도 `reporter="destination"`을 고릅니다. `connection_security_policy="mutual_tls"`는 대상 쪽 기록에서 의미가 있고, source 쪽 값은 `unknown`입니다. [표준 메트릭 정의](https://istio.io/latest/docs/reference/config/metrics/)

## 503이 멈춘 자리 {#5xx에서-실패한-홉으로-좁혀-가기}

{{< seq src="_seq/3-연결-실패의-두-자리.json" />}}

`UF`는 **그 로그를 남긴 프록시의 업스트림 연결 실패**입니다. 호출 쪽의 업스트림은 대상 사이드카이고, 대상 쪽의 업스트림은 자기 앱입니다. 로그 누락만으로 도착 여부를 단정하기 전에, 양쪽의 로그 활성화·필터·수집 상태도 확인합니다.

| flag | 먼저 확인할 곳 |
|---|---|
| `UF` | 업스트림 연결·TLS 실패 사유 |
| `UH` | 건강한 엔드포인트가 남아 있는지 |
| `UO` | 연결 풀·요청 수 제한 초과 |
| `UT` | 업스트림 응답 시간과 타임아웃 |

기본 프로필에서는 액세스 로그를 별도로 켭니다. 다음은 기본 루트 네임스페이스인 `istio-system`에서 내장 `envoy` provider를 선택하는 예입니다.

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

같은 시간대의 `response_flags`와 업스트림 주소를 보고, 전파된 `x-request-id`로 양쪽 로그를 맞춥니다. 상태 코드만 같다고 같은 실패는 아닙니다. [액세스 로그 설정](https://istio.io/latest/docs/tasks/observability/logs/access-log/) · [Envoy flag 정의](https://www.envoyproxy.io/docs/envoy/latest/configuration/observability/access_log/usage#response-flags)

## 앱이 이어 주는 트레이스 {#span을-이어-주는-것은-앱의-헤더-전파}

{{< seq src="_seq/4-앱의-trace-context-전파.json" />}}

프록시는 앱이 새로 만든 요청이 어느 수신 요청에서 비롯됐는지 알 수 없습니다. 앱이나 계측 라이브러리가 `traceparent`·`tracestate` 또는 B3 context를 다음 호출에 전달해야 합니다. OpenTelemetry 자동 계측은 이 추출·주입과 앱 내부 span 생성을 맡을 수 있습니다.

<span id="로그에-trace-id를-남기는-설정"></span>

**요청 ID와 trace ID는 다릅니다.** `x-request-id`는 홉별 로그를 맞추는 데 쓰고, trace ID는 트레이스 조회에 씁니다. 기본 로그에는 요청 ID가 있지만 trace ID는 없으므로, 필요하면 로그 포맷에 `%TRACE_ID%`를 추가합니다. 트레이싱 provider와 샘플링도 설정해야 하며, ID가 있어도 백엔드에 span이 저장되지 않았다면 조회할 트레이스는 없습니다. [Istio 트레이싱과 헤더 전파](https://istio.io/latest/docs/tasks/observability/distributed-tracing/overview/)

## 남길 기록의 범위 {#남길-라벨을-고르면-저장량도-달라진다}

메트릭으로 **어느 서비스·시간대가 나쁜지**, 로그로 **어느 홉에서 실패했는지**, 트레이스로 **호출이 어떻게 이어졌는지**를 찾습니다. 메트릭의 합계에서 특정 요청 하나를 바로 찾을 수는 없습니다.

사용자 ID·원문 URL처럼 값이 계속 늘어나는 정보는 메트릭 라벨 대신 로그·span에 둡니다. 라벨은 Telemetry의 `tagOverrides`로 줄일 수 있습니다. source 메트릭을 끄면 대상 도착 전 실패도 놓치므로, 중복 집계 방지를 위해 수집 자체를 끌 필요는 없습니다. [Telemetry API](https://istio.io/latest/docs/reference/config/telemetry/)

<span id="ambient에서-요청을-읽는-자리는-waypoint"></span>

Ambient의 **ztunnel은 연결 단위**, **waypoint는 HTTP 요청 단위**로 관측합니다. 위의 두 사이드카 그림과 reporter 조건을 그대로 옮기지 말고 실제 경로에서 확인합니다. [Ambient의 L7 기능](https://istio.io/latest/docs/ambient/usage/l7-features/)

<span id="참고-자료"></span>

[← 04 L7 프록시가 여는 기능]({{< relref "/study/istio-mesh/04-l7-only-features/index.md" >}}) · [시리즈 처음으로]({{< relref "/study/istio-mesh/_index.md" >}})
