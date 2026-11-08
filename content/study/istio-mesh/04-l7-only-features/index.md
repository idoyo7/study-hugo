---
title: "04 요청을 읽는 갈림길 — L7 프록시가 여는 기능"
description: "요청 단위 분산, 카나리, 재시도, 경로별 인가를 네 그림으로 살펴본다. 대기 한도와 중복 실행 비용, waypoint가 필요한 범위를 짚는다."
date: 2026-11-07
lastmod: 2026-11-08
inlineToc: false
weight: 4
url: "/study/istio-mesh/04-l7-only-features/"
aliases:
  - "/istio/mesh-traffic/04-l7-only-features/"
---

# 04 · 요청을 읽는 갈림길 — L7 프록시가 여는 기능

HTTP를 읽는 사이드카는 연결 하나 안의 요청을 각각 다른 파드로 보낼 수 있습니다. 재시도·트래픽 분할·경로별 인가도 이 요청 경계에서 시작합니다.

{{< flow src="_flow/2-연결-하나-요청-여럿.json" />}}

## 연결 하나에서도 요청마다 다른 파드 {#연결-하나에-묶였던-요청을-다시-나누기}

앱이 연 연결과 프록시의 대상별 연결 풀은 별개입니다. 앞쪽 HTTP/2 연결이 하나여도 뒤에서는 요청마다 EDS 엔드포인트를 고릅니다. 기본 least request는 연결 수가 아니라 활성 요청 수를 비교합니다.

TCP로만 처리하는 연결은 처음 고른 대상에 묶입니다. Envoy의 TCP proxy 필터는 연결마다 업스트림 클러스터를 고르고, 연결이 맺힌 뒤에는 바이트를 해석하지 않고 넘깁니다. HTTP로 인식하는 조건과 연결 구조는 [03편]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}})에서 봤습니다.

HTTP로 인식한 연결에서는 HTTP connection manager가 바이트를 요청과 응답으로 구분합니다. router 필터가 요청마다 route와 cluster를 정하고, 그 cluster의 로드밸런서가 엔드포인트를 고릅니다. 목적지도 Service의 ClusterIP가 아니라 EDS로 받은 파드 IP이므로, 이 경로에는 kube-proxy의 연결 단위 선택이 끼어들지 않습니다.

사이드카가 실제로 받은 LB 정책과 엔드포인트는 다음 명령으로 확인합니다.

```bash
istioctl proxy-config cluster deploy/frontend --fqdn orders.shop.svc.cluster.local -o json | grep -i lbPolicy
istioctl proxy-config endpoints deploy/frontend --cluster "outbound|8080||orders.shop.svc.cluster.local"
```

기본 설치라면 `"lbPolicy": "LEAST_REQUEST"`가 보입니다. 이 줄이 없으면 round robin이 적용된 것이므로 DestinationRule을 확인합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| TCP proxy는 연결 단위로 클러스터를 고른다 | "per-connection basis" | Envoy 1.39 `tcp_proxy_filter.rst` |
| 로드밸런서는 요청이 올 때 엔드포인트를 고른다 | "picks an endpoint when a new request arrives" | Envoy 1.39 Life of a Request |
| Istio 기본 LB는 least request | "two randomly selected hosts" 중 활성 요청이 적은 쪽 | Istio Traffic Management 개념 |
| 가중치가 같을 때 P2C, 다르면 동적 WRR | 무작위 후보 기본 2개 | Envoy 1.39 load balancers |
| DR 레퍼런스는 기본값을 직접 명시하지 않음 | 소스의 `defaultLBAlgorithm()`은 `LEAST_REQUEST` | Istio DestinationRule 레퍼런스, 1.31.4 `cluster_traffic_policy.go` |
| HTTP/2 풀은 멀티플렉싱, HTTP/1.1 풀은 연결을 더 연다 | 제한이 없으면 HTTP/2는 연결 1개 | Envoy 1.39 Connection pooling |
| `lbPolicy` 생략 = ROUND_ROBIN | Envoy cluster proto 기본값 | Envoy 1.39 API |
{{% /details %}}

## 헤더와 가중치로 나누는 요청 {#어떤-요청을-어느-버전으로-보낼-것인가}

VirtualService의 HTTP 규칙은 위에서부터 평가하며, 처음 맞는 규칙을 적용합니다.

{{< flow src="_flow/2-헤더-우선-카나리-분할.json" />}}

이 예시의 `x-canary: true` 요청은 v2로 고정하고, 나머지는 v1:v2를 90:10 가중치로 나눕니다. 가중치는 장기적인 선택 비율이며 요청 열 개 중 하나를 보장하는 약속은 아닙니다. subset과 파드 라벨의 대응은 DestinationRule에 둡니다.

TCP 가중치는 **연결 수**에 적용됩니다. 오래 열린 연결 몇 개라면 요청 비율은 가중치와 크게 달라질 수 있습니다. 미러링은 요청 복사본을 따로 보내고 응답을 버립니다. 응답을 기다리지는 않지만 복제 트래픽과 대상의 처리 비용은 늘어납니다.

미러링은 같은 규칙 안에서 비율까지 정합니다.

```yaml
    mirror: {host: orders, subset: v3}
    mirrorPercentage: {value: 5}
```

비율을 생략하면 전체 요청을 복사합니다. 요청 하나를 골라 복사하는 동작은 요청의 경계를 읽어야 가능하므로 L4 프록시는 할 수 없습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| TCP route에도 weight | `RouteDestination` = "L4 routing rule weighted destination" | Istio VS 레퍼런스 |
| TCP 가중치는 연결 단위 | Envoy `weighted_clusters`를 연결마다 선택. 요청 비율과 벌어지는 정도는 구조에서 도출한 설명 | Envoy 1.39 TCP proxy |
| HTTP 매칭 필드 | headers, uri, method, queryParams, sourceLabels | Istio VS 레퍼런스 |
| 미러는 응답을 기다리지 않음, 비율 생략 시 100% | "fire and forget… responses are discarded" | Istio VS 레퍼런스, Mirroring 태스크 |
{{% /details %}}

## 실패한 요청의 재시도와 전체 대기 한도 {#실패한-요청은-다시-보내고-대기-시간은-제한한다}

재시도는 조건에 맞는 실패에만 적용합니다. 아래는 다른 파드로 재시도가 성공하는 예입니다.

{{< seq src="_seq/3-다른-파드로-재시도.json" />}}

Istio 1.31은 VirtualService에 별도 설정이 없어도 HTTP 요청을 두 번까지 재시도하며, 간격은 25ms에서 시작하는 지수 백오프입니다. 기본 정책에는 이미 시도한 엔드포인트를 피하는 `previous_hosts`가 들어 있어 재시도는 대개 다른 파드로 갑니다. consistent hash LB에서는 이 조건을 넣지 않습니다.

기본 HTTP 재시도는 최대 두 번이며, 연결 실패·스트림 거부·일부 gRPC 상태가 대상입니다. 앱의 모든 500·503 응답을 자동으로 재시도하는 정책은 아닙니다. 응답 코드로 재시도하려면 `retryOn`에 직접 지정합니다. 이 해석은 소스와 Envoy 문서를 함께 읽은 결과이며 실측한 동작은 아닙니다. 전체 요청의 타임아웃은 기본으로 꺼져 있으므로, 필요한 경로에 명시합니다.

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: orders
spec:
  hosts: [orders]
  http:
  - route:
    - destination: {host: orders}
    timeout: 3s
    retries:
      attempts: 2
      perTryTimeout: 1s
      retryOn: connect-failure,refused-stream,503
```

`attempts: 2`는 최초 시도 뒤 최대 두 번을 더 보낸다는 뜻입니다. 각 시도는 최대 1초, 전체는 백오프를 포함해 3초로 제한합니다. 결제처럼 중복 실행이 위험한 요청은 멱등성을 확보하거나 `attempts: 0`으로 끕니다. 앱과 메시가 함께 재시도하면 호출 수가 곱해지므로 정책을 맞춰야 합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 기본 2회 재시도, 25ms 이상 간격 | HTTP 요청 | Istio Traffic Management 개념, VS 레퍼런스(`backoff`) |
| 기본 정책 구성 | `retryOn: connect-failure,refused-stream,unavailable,cancelled,retriable-status-codes`, `previous_hosts`. consistent hash LB면 `previous_hosts` 없음 | Istio 1.31.4 `retry.go` |
| 기본만으로 503 응답을 재시도하지 않음 | `retriable-status-codes`가 켜져 있지만 코드 목록이 비어 있음. 해석이고 실측은 아님 | `retry.go`, Envoy 1.39 router filter |
| `retryOn`에 숫자를 쓰면 `retriable-status-codes` 자동 추가 | — | Istio 1.31.4 `retry.go` |
| 타임아웃 기본 비활성 | `perTryTimeout` 기본 = route `timeout` = 제한 없음 | Istio VS 레퍼런스 |
| TCP proxy는 연결 시도만 반복 | `max_connect_attempts` 미지정 시 1회 | Envoy 1.39 `tcp_proxy.proto` |
| retryBudget 기본값 | percent 20%, minRetryConcurrency 3 | Istio DR 레퍼런스 |
{{% /details %}}

## 요청 한도와 불량 파드 제외 {#연결-수로-보이지-않는-부하와-오류}

DestinationRule의 두 설정은 백엔드를 보호하는 방식이 다릅니다.

| 설정 | 조절하는 대상 | 한도·조건을 넘으면 |
|---|---|---|
| `connectionPool` | 연결 수·대기 요청·활성 요청 | 새 요청을 제한, overflow는 로그의 `UO`로 확인 |
| `outlierDetection` | 실제 오류를 내는 엔드포인트 | 해당 파드를 후보에서 일시 제외 |

HTTP/2 연결 하나에도 요청 수백 개가 들어갑니다. 연결 한도만 두면 이 부하를 구분하지 못합니다. 반대로 TCP 연결이 정상이어도 앱이 계속 500을 보내는 파드는 HTTP 오류를 기준으로 제외해야 합니다. TCP outlier detection은 HTTP 응답을 읽지 못하고 연결 실패·타임아웃을 봅니다.

outlier detection은 실제 트래픽의 응답을 보고 엔드포인트를 잠시 제외합니다. HTTP에서는 `outlierDetectionHttpErrorCodes`를 따로 지정하지 않으면 5xx 응답을 오류로 셉니다. 기본값은 연속 5번의 오류, 10초마다 점검, 최소 30초 축출이며 풀의 10%까지 제외합니다.

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: orders
spec:
  host: orders
  trafficPolicy:
    connectionPool:
      http: {http2MaxRequests: 500, http1MaxPendingRequests: 100}
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 10s
      baseEjectionTime: 30s
```

간헐적인 5xx가 어느 홉에서 발생했는지 response flag로 구분하는 방법은 [간헐적 응답 이상 추적]({{< relref "/platform/istio/operations/05-incident-intermittent-5xx/index.md" >}})에 있습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| `tcp`는 HTTP·TCP 공통, `http`는 HTTP 전용 | "Settings common to both HTTP and TCP upstream connections" | Istio DR 레퍼런스 |
| outlier 기본값 | consecutive5xxErrors 5, interval 10s, baseEjectionTime 30s, maxEjectionPercent 10% | Istio DR 레퍼런스 |
| HTTP는 5xx만 오류로 셈 | `outlierDetectionHttpErrorCodes` 미지정 시 | Istio DR 레퍼런스 |
| TCP는 연결 실패만 셈 | Envoy tcp proxy는 locally originated 오류만 보고 | Istio DR 레퍼런스, Envoy 1.39 Outlier detection |
| 풀 초과는 `UO` | response flag `UPSTREAM_OVERFLOW` | Envoy 1.39 `stream_info/utility.h` |
{{% /details %}}

<span id="fault로-재시도를-시험할-때는-홉을-나눈다"></span>

fault injection으로 재시도를 시험할 때는 **서로 다른 홉**에 둡니다. 같은 HTTP route에 fault를 켜면 그 route의 retry·timeout은 활성화되지 않습니다. 세부 필드와 동작은 [재시도와 복원력]({{< relref "/platform/istio/cilium/04-retry-resilience/index.md" >}})에서 확인합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| fault는 클라이언트 쪽 HTTP 트래픽에 적용 | "Fault injection policy to apply on HTTP traffic at the client side" | Istio VS 레퍼런스 |
| 필드 | `delay.fixedDelay`(≥1ms), `abort.httpStatus`/`grpcStatus`, 각 `percentage`(미지정 시 적용 안 함) | Istio VS 레퍼런스 |
| fault와 retry·timeout은 같이 안 됨 | "timeouts or retries will not be enabled when faults are enabled on the client side" | Istio VS 레퍼런스 |
{{% /details %}}

## 같은 호출자도 경로와 메서드로 나누는 인가 {#호출자-신원에서-경로와-메서드까지}

mTLS로 확인한 서비스 어카운트에 HTTP 메서드와 경로 조건을 더하면, 같은 호출자의 요청도 다르게 처리합니다.

{{< flow src="_flow/5-신원과-요청-조건의-인가.json" />}}

그림은 해당 서비스 계정에 `GET /orders/*`만 ALLOW한 예입니다. 신원·IP·포트 조건은 L4에서도 쓸 수 있지만, 메서드·경로·헤더와 JWT 클레임에는 HTTP 해석이 필요합니다. JWT 조건을 쓴다면 RequestAuthentication으로 먼저 검증하며, 토큰을 필수로 요구하는 인가 조건도 별도로 둡니다. RequestAuthentication은 토큰이 없는 요청을 통과시키기 때문입니다.

워크로드 신원에 메서드와 경로, 검증된 JWT 클레임을 함께 지정한 정책은 다음과 같습니다.

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: payments-allow
spec:
  selector:
    matchLabels: {app: payments}
  action: ALLOW
  rules:
  - from:
    - source:
        principals: ["cluster.local/ns/shop/sa/orders"]
    to:
    - operation:
        methods: ["POST"]
        paths: ["/charge"]
    when:
    - key: request.auth.claims[scope]
      values: ["payments:write"]
```

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| HTTP 전용 조건 | `request.headers`, `request.auth.principal/audiences/presenter/claims` | Istio Authorization conditions |
| HTTP·TCP 공통 조건 | `source.ip`, `source.namespace`, `source.principal`, `destination.ip/port`, `connection.sni` | Istio Authorization conditions |
| `hosts`·`methods`·`paths`는 HTTP 전용 | "Must be used only with HTTP" | Istio AuthorizationPolicy 레퍼런스 |
| TCP에서 DENY의 HTTP 속성은 일치로 취급 | 예시에서 8080 포트 TCP 전체 거부, 포트로 범위를 좁히라고 권고 | Istio AuthorizationPolicy 레퍼런스 |
| 평가 순서 | CUSTOM → DENY → ALLOW. ALLOW 정책이 있는데 맞는 것이 없으면 거부 | Istio AuthorizationPolicy 레퍼런스 |
{{% /details %}}

HTTP 속성이 든 DENY를 TCP에 적용하면 없는 속성을 일치로 취급해 해당 포트 전체가 막힐 수 있습니다. 정책 범위를 포트와 워크로드로 좁혀야 합니다.

## ambient에서 L7을 맡는 waypoint {#ztunnel만-있는-경로에는-무엇이-남는가}

ztunnel만 쓰는 경로에는 mTLS·워크로드 신원·L4 인가가 남습니다. 요청 단위 분산, 재시도, HTTP 라우팅과 L7 인가는 waypoint에서 처리합니다.

L7 인가 정책은 `targetRefs`로 서비스 등에 연결하고 트래픽이 실제 waypoint를 지나는지 확인합니다. ztunnel에 HTTP 조건을 둔 정책을 붙이면 의도대로 집행되지 않고 트래픽이 차단될 수 있습니다. ALLOW 정책에 맞는 규칙이 없으면 트래픽이 막히고, L7 속성만 든 DENY는 막을 규칙이 없어 그대로 지나갑니다. 한 항목에 L4·L7 속성이 섞여 있으면 ztunnel은 L4 부분만 집행합니다. 우회 경로의 접근도 제한하려면 ztunnel의 L4 정책을 함께 설계합니다.

[이전: 03 사이드카와 사이드카 사이]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}}) · [다음: 05 메트릭·로그·트레이스]({{< relref "/study/istio-mesh/05-logs-and-tracing/index.md" >}})

## 근거와 더 보기

기준: 사이드카 모드, Istio 1.31.4.

- [Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/) — 요청 분산과 기본 동작
- [VirtualService](https://istio.io/latest/docs/reference/config/networking/virtual-service/) — HTTP 매칭·가중치·재시도·fault
- [DestinationRule](https://istio.io/latest/docs/reference/config/networking/destination-rule/) — 연결 풀·outlier detection
- [AuthorizationPolicy](https://istio.io/latest/docs/reference/config/security/authorization-policy/) — ALLOW·DENY와 HTTP 조건
- [Ambient L7 기능](https://istio.io/latest/docs/ambient/usage/l7-features/) — waypoint 경유와 정책 연결
