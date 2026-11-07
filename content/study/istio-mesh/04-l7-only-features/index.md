---
title: "04 편지를 읽는 우체부만 할 수 있는 일 — L7 프록시가 여는 기능"
description: "L4만으로도 분산과 인가가 가능한데 L7 프록시는 무엇을 더하나. HTTP를 읽어 요청마다 목적지를 고르고, 실패한 요청만 다시 보내며, 경로와 메서드까지 인가 조건에 넣는다."
date: 2026-11-07
lastmod: 2026-11-07
weight: 4
url: "/study/istio-mesh/04-l7-only-features/"
aliases:
  - "/istio/mesh-traffic/04-l7-only-features/"
---

# 04 · 편지를 읽는 우체부만 할 수 있는 일 — L7 프록시가 여는 기능

앱이 HTTP/2 연결 하나를 오래 열어 둬도 그 안의 요청은 여러 파드로 분산됩니다. 사이드카가 요청마다 목적지를 고르기 때문입니다.

[03편]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}})에서 요청은 클라이언트 사이드카를 나와 mTLS 터널을 지나 상대 사이드카에 도착했습니다. 이 경로의 양쪽 프록시는 HTTP를 읽습니다. 연결 안에서 요청을 구분하므로 실패한 요청만 다시 보내거나, 같은 호출자가 보낸 요청이라도 경로와 메서드에 따라 막을 수 있습니다. Envoy의 전체 기능은 [Envoy가 제공하는 것]({{< relref "/platform/istio/fundamentals/12-envoy-capabilities/index.md" >}})에 정리돼 있습니다.

## 한 연결에 묶인 요청을 한 통씩 나누다 {#연결-하나에-묶였던-요청을-다시-나누기}

[01편]({{< relref "/study/istio-mesh/01-l4-l7-before-mesh/index.md" >}})에서는 오래 열린 연결 때문에 요청이 한 파드에 몰렸습니다. gRPC나 HTTP/2 클라이언트가 연결 하나에 요청을 계속 실어 보내면, kube-proxy가 연결을 맺을 때 DNAT로 고른 파드가 그 요청을 끝까지 받습니다.

L4 프록시도 선택 단위는 TCP 연결입니다. Envoy의 TCP proxy 필터는 연결마다 업스트림 클러스터를 고르고, 연결이 맺힌 뒤에는 바이트를 해석하지 않고 넘깁니다. 로드밸런싱에 영향을 줄 값도 새 연결을 처리하기 전에 정해 둬야 합니다.

사이드카는 앱이 연 연결을 받아 그 안의 요청을 하나씩 읽습니다. Envoy의 HTTP connection manager가 바이트를 요청과 응답으로 구분하면, router 필터가 요청마다 route와 cluster를 정하고 그 cluster의 로드밸런서가 엔드포인트를 고릅니다.

{{< flow src="_flow/2-연결-하나-요청-여럿.json" />}}

앱의 연결 수는 분산을 제한하지 않습니다. Envoy가 업스트림 엔드포인트별로 커넥션 풀을 따로 관리하기 때문입니다. HTTP/2 풀은 연결 하나에 여러 요청을 실어 보내고, HTTP/1.1 풀은 필요한 만큼 연결을 더 엽니다. 목적지도 Service의 ClusterIP가 아닌 EDS로 받은 파드 IP이므로, 이 경로에는 kube-proxy의 연결 단위 선택이 끼어들지 않습니다.

Istio에서 별도로 지정하지 않은 LB 정책은 least request입니다. 엔드포인트의 가중치가 같으면 무작위로 두 후보를 뽑고 활성 요청이 적은 쪽을 고르는 P2C 방식으로 동작합니다. 여기서 세는 것은 연결 수가 아닌 요청 수입니다. 요청의 경계를 읽어야 가능한 선택이며, L4 프록시는 연결 수까지만 셀 수 있습니다.

사이드카가 실제로 받은 LB 정책과 엔드포인트를 확인합니다.

```bash
# 사이드카가 이 서비스에 쓰는 LB 정책과 엔드포인트
istioctl proxy-config cluster deploy/frontend --fqdn orders.shop.svc.cluster.local -o json | grep -i lbPolicy
istioctl proxy-config endpoints deploy/frontend --cluster "outbound|8080||orders.shop.svc.cluster.local"
```

기본 설치라면 `"lbPolicy": "LEAST_REQUEST"`가 보입니다. 이 줄이 없으면 enum 기본값인 round robin이 적용된 것입니다. DestinationRule에서 `ROUND_ROBIN`을 지정했는지 확인합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| TCP proxy는 연결 단위로 클러스터를 고른다 | "per-connection basis", `onNewConnection()` 전에 정해야 LB에 반영 | Envoy 1.39 `tcp_proxy_filter.rst` |
| 로드밸런서는 요청이 올 때 엔드포인트를 고른다 | "picks an endpoint when a new request arrives" | Envoy 1.39 Life of a Request |
| 기준 버전 | Istio 1.31.4, pin된 Envoy 1.39.7-dev(커밋 8893f913) | istio.io 릴리스, `istio.deps`, istio/proxy WORKSPACE |
| Istio 기본 LB는 least request | "two randomly selected hosts" 중 활성 요청이 적은 쪽 | Istio Traffic Management 개념 |
| 가중치가 같을 때 P2C, 다르면 동적 WRR | 무작위 후보 기본 2개, `weight / (active_requests + 1)^bias` | Envoy 1.39 load balancers |
| DR 레퍼런스는 기본값을 직접 명시하지 않음 | UNSPECIFIED = "Istio will select an appropriate default". 소스의 `defaultLBAlgorithm()`은 `LEAST_REQUEST` | Istio DestinationRule 레퍼런스, 1.31.4 `cluster_traffic_policy.go` |
| HTTP/2 풀은 멀티플렉싱, HTTP/1.1 풀은 연결을 더 연다 | 제한이 없으면 HTTP/2는 연결 1개, HTTP/1.1은 파이프라이닝 없음 | Envoy 1.39 Connection pooling |
| `lbPolicy` 생략 = ROUND_ROBIN | Envoy cluster proto 기본값 | Envoy 1.39 API |
{{% /details %}}

## 요청마다 고르는 버전이라는 배달지 {#어떤-요청을-어느-버전으로-보낼-것인가}

VirtualService의 HTTP route에 지정한 가중치는 요청마다 적용됩니다. TCP route에도 `weight`는 있습니다. Istio의 TCP traffic shifting 예제는 v1과 v2를 80:20으로 나누지만, Envoy TCP proxy가 연결마다 클러스터를 고르므로 이 비율의 기준은 연결 수입니다.

연결을 오래 유지하는 클라이언트가 몇 개 없다면 20%를 지정해도 실제 요청 비율은 크게 달라질 수 있습니다. 연결 단위 선택에서 도출되는 차이입니다.

특정 요청만 골라 보내려면 요청 내용까지 읽어야 합니다. `x-canary: true` 헤더를 단 요청만 v2로 보내는 카나리는 L4에서 불가능합니다. VirtualService의 `match`는 헤더뿐 아니라 URI, 메서드, 쿼리 파라미터, 호출한 워크로드의 라벨인 `sourceLabels`도 조건으로 받습니다.

```yaml
  http:
  - match:
    - headers:
        x-canary: {exact: "true"}
    route:
    - destination: {host: orders, subset: v2}
  - route:
    - destination: {host: orders, subset: v1}
      weight: 90
    - destination: {host: orders, subset: v2}
      weight: 10
    mirror: {host: orders, subset: v3}
    mirrorPercentage: {value: 5}
```

이 설정에는 미러링도 들어 있습니다. 요청을 복사해 다른 대상에 보내되, 그 대상의 응답은 버리는 기능입니다. 사이드카는 미러 대상의 응답을 기다리지 않으므로 원래 요청의 지연에는 영향이 없습니다. 비율을 생략하면 전체 요청을 복사합니다.

미러링 역시 요청의 경계가 있어야 성립합니다. L4 프록시는 바이트 흐름에서 요청 하나를 골라 복사하고 그 응답만 버리는 동작을 할 수 없습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| TCP route에도 weight | `RouteDestination` = "L4 routing rule weighted destination" | Istio VS 레퍼런스 |
| TCP 가중치 분할 예제 | tcp-echo v1→v2 20% | Istio TCP Traffic Shifting 태스크 |
| TCP 가중치는 연결 단위 | Envoy `weighted_clusters`를 연결마다 선택. 요청 비율과 벌어지는 정도는 구조에서 도출한 설명 | Envoy 1.39 TCP proxy |
| HTTP 매칭 필드 | headers(소문자·하이픈), uri, method, queryParams, sourceLabels | Istio VS 레퍼런스 |
| 미러는 응답을 기다리지 않음, 비율 생략 시 100% | "fire and forget… responses are discarded" | Istio VS 레퍼런스, Mirroring 태스크 |
| 미러 요청 Host의 `-shadow` 접미사 | 태스크 문서는 붙는다고 쓰지만 1.31.4 소스의 `DISABLE_SHADOW_HOST_SUFFIX` 기본값은 true. 실측하지 않음 | Mirroring 태스크, `pilot/pkg/features/pilot.go` |
{{% /details %}}

## 실패한 편지는 다시 보내되 오래 기다리지 않는다 {#실패한-요청은-다시-보내고-대기-시간은-제한한다}

TCP proxy의 `max_connect_attempts`로 반복할 수 있는 것은 연결 시도뿐입니다. 연결이 맺혀 바이트가 오가기 시작하면 어디까지가 요청 하나인지 모르므로, 실패한 요청만 골라 다시 보낼 수 없습니다.

사이드카는 그 요청을 구분합니다. Istio 1.31은 VirtualService에 별도 설정이 없어도 HTTP 요청을 두 번까지 재시도하며, 간격은 25ms에서 시작하는 지수 백오프입니다. 기본 정책에는 이미 시도한 엔드포인트를 피하는 `previous_hosts`가 들어 있어 재시도는 대개 다른 파드로 갑니다. consistent hash LB에서는 이 조건을 넣지 않습니다.

{{< seq src="_seq/3-다른-파드로-재시도.json" />}}

어떤 실패든 다시 보내는 것은 아닙니다. 기본 재시도 조건에는 연결 실패, 스트림 거부, gRPC `unavailable`·`cancelled` 등이 포함됩니다. 앱이 정상적으로 돌려준 503이나 500 응답은 기본 정책만으로 재시도하지 않는다는 해석입니다. 소스와 Envoy 문서를 함께 읽은 결과이며, 실측한 동작은 아닙니다.

응답 코드에 따라 재시도하려면 `retryOn`에 해당 코드를 직접 지정합니다. 재시도 횟수와 각 시도의 대기 시간, 요청 전체의 제한 시간도 함께 설정할 수 있습니다.

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

재시도와 달리 타임아웃의 기본값은 비활성입니다. 요청 전체의 `timeout`에 제한이 없고 `perTryTimeout`도 그 값을 따릅니다. 둘 다 비워 두면 느린 백엔드 앞에서 요청이 끝없이 기다립니다.

결제처럼 두 번 실행되면 안 되는 경로에서는 `attempts: 0`으로 재시도를 끕니다. 재시도가 늘어 부하가 몰리는 데에는 DestinationRule의 `retryBudget`으로 상한을 둡니다. 재시도 기본값을 설명하는 문서 사이의 차이는 [재시도와 복원력]({{< relref "/platform/istio/cilium/04-retry-resilience/index.md" >}})에서 자세히 다뤘습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 기본 2회 재시도, 25ms 이상 간격 | HTTP 요청 | Istio Traffic Management 개념, VS 레퍼런스(`backoff`) |
| 기본 정책 구성 | `retryOn: connect-failure,refused-stream,unavailable,cancelled,retriable-status-codes`, `previous_hosts`, `HostSelectionRetryMaxAttempts 5`. consistent hash LB면 `previous_hosts` 없음 | Istio 1.31.4 `retry.go` |
| 기본만으로 503 응답을 재시도하지 않음 | `retriable-status-codes`가 켜져 있지만 코드 목록이 비어 있음. 소스와 Envoy 문서를 합친 해석이고 실측은 아님 | `retry.go`, Envoy 1.39 router filter |
| VS 레퍼런스의 기본 `retryOn`은 4종 | `retriable-status-codes`는 적혀 있지 않음 | Istio VS 레퍼런스 |
| `retryOn`에 숫자를 쓰면 `retriable-status-codes` 자동 추가 | — | Istio 1.31.4 `retry.go` |
| 타임아웃 기본 비활성 | `perTryTimeout` 기본 = route `timeout` = 제한 없음 | Istio VS 레퍼런스 |
| TCP proxy는 연결 시도만 반복 | `max_connect_attempts` 미지정 시 1회 | Envoy 1.39 `tcp_proxy.proto` |
| retryBudget 기본값 | percent 20%, minRetryConcurrency 3, budgetInterval 0ms | Istio DR 레퍼런스 |
{{% /details %}}

## 연결 수 뒤에 가려진 부하와 오류 {#연결-수로-보이지-않는-부하와-오류}

HTTP/2 연결 하나에 요청 수백 개가 실려 있어도 연결 수는 하나입니다. 연결 한도만으로는 그 안의 부하를 구분하지 못합니다.

서킷 브레이킹에 쓰는 DestinationRule의 `connectionPool`에서 `tcp` 쪽 한도는 TCP와 HTTP에 공통으로 적용됩니다. 최대 연결 수와 연결 타임아웃이 여기에 속합니다. `http` 쪽은 대기 요청 수, 활성 요청 수, 연결당 요청 수, 재시도 수를 제한하며 HTTP에만 적용됩니다. L4만 처리하는 프록시는 이 가운데 연결 수로 백엔드를 보호하는 데 그칩니다.

한도를 넘어서 프록시가 거절한 요청은 액세스 로그에 `UO`로 남습니다.

연결이 멀쩡해도 요청은 실패할 수 있습니다. 응답마다 500을 돌려주는 파드는 L4에서 건강해 보입니다. TCP에서 outlier detection이 오류로 셀 수 있는 것은 연결 실패와 연결 타임아웃뿐이기 때문입니다.

outlier detection은 실제 트래픽의 응답을 보고 엔드포인트를 잠시 제외합니다. HTTP에서는 `outlierDetectionHttpErrorCodes`를 따로 지정하지 않으면 5xx 응답을 오류로 셉니다. 기본 설정은 연속 5번의 오류, 10초마다 점검, 최소 30초 축출이며, 풀의 10%까지 제외합니다.

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
| 연결 풀 상한 기본값 | `http2MaxRequests` 2^32-1, `maxRequestsPerConnection` 1이면 keepalive 끔 | Istio DR 레퍼런스 |
| outlier 기본값 | consecutive5xxErrors 5(0이면 끔), interval 10s, baseEjectionTime 30s, maxEjectionPercent 10%, minHealthPercent 0% | Istio DR 레퍼런스 |
| HTTP는 5xx만 오류로 셈 | `outlierDetectionHttpErrorCodes` 미지정 시 | Istio DR 레퍼런스 |
| TCP는 연결 실패만 셈 | opaque TCP의 connect timeout·연결 실패를 5xx로 취급. Envoy tcp proxy는 locally originated 오류만 보고 | Istio DR 레퍼런스, Envoy 1.39 Outlier detection |
| 풀 초과는 `UO` | response flag `UPSTREAM_OVERFLOW` | Envoy 1.39 `source/common/stream_info/utility.h` |
{{% /details %}}

## fault와 재시도를 서로 다른 홉에 부치다 {#fault로-재시도를-시험할-때는-홉을-나눈다}

재시도가 장애를 흡수하는지 시험하려면 fault와 재시도를 서로 다른 홉에 둬야 합니다. 같은 VirtualService의 route에 fault를 넣으면 그 route의 재시도와 타임아웃이 꺼지기 때문입니다.

fault injection은 일부 요청에 지연이나 오류를 넣어 호출하는 쪽의 대응을 확인하는 기능입니다. Istio에서는 클라이언트 사이드카가 요청을 내보내기 전에 적용합니다. 지연은 `fixedDelay`, 중단은 HTTP 상태 코드나 gRPC 상태 코드로 정하며, 각각 적용할 비율을 지정합니다.

```yaml
  http:
  - fault:
      delay: {fixedDelay: 2s, percentage: {value: 10}}
      abort: {httpStatus: 503, percentage: {value: 1}}
    route:
    - destination: {host: ratings}
```

요청의 1%를 고르려면 요청을 셀 수 있어야 합니다. 503을 돌려주는 데에는 HTTP 응답을 만드는 기능도 필요합니다. L4에서 연결을 끊거나 패킷을 늦추는 것으로 흉내 낼 수는 있지만, 앱이 겪는 오류의 모양은 달라집니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| fault는 클라이언트 쪽 HTTP 트래픽에 적용 | "Fault injection policy to apply on HTTP traffic at the client side" | Istio VS 레퍼런스 |
| 필드 | `delay.fixedDelay`(≥1ms), `abort.httpStatus`/`grpcStatus`, 각 `percentage`(미지정 시 적용 안 함) | Istio VS 레퍼런스 |
| fault와 retry·timeout은 같이 안 됨 | "timeouts or retries will not be enabled when faults are enabled on the client side" | Istio VS 레퍼런스, Traffic Management 개념 |
{{% /details %}}

## 보낸 이의 신원에서 경로와 메서드까지 {#호출자-신원에서-경로와-메서드까지}

요청을 허용할지 판단할 때도 L7이 꼭 필요한 조건과 연결만으로 판단할 수 있는 조건이 있습니다. 상대 워크로드의 신원은 이미 03편의 mTLS 핸드셰이크에서 인증서의 SPIFFE ID로 확인했습니다. 따라서 주문 서비스 계정만 결제 서비스에 연결하도록 제한하는 정책은 TCP에서도 집행됩니다.

HTTP를 읽으면 같은 호출자의 요청도 구별합니다. `GET /orders/*`는 허용하고 `DELETE`는 막는 식입니다. AuthorizationPolicy에 쓰는 속성을 보면 어디까지 연결 정보로 판단하고 어디부터 요청을 읽어야 하는지 드러납니다.

| 속성 | 예 | 필요한 것 |
|---|---|---|
| 상대 워크로드 신원 | `principals`, `source.principal`, `namespaces` | mTLS 인증서 |
| 네트워크 위치 | `ipBlocks`, `destination.port`, `connection.sni` | 연결 정보 |
| 요청 내용 | `methods`, `paths`, `hosts`, `request.headers` | HTTP 해석 |
| 최종 사용자 | `requestPrincipals`, `request.auth.claims` | HTTP 해석 + JWT 검증 |

JWT 클레임을 조건으로 쓰려면 RequestAuthentication이 먼저 토큰을 검증해야 합니다. RequestAuthentication은 토큰이 없는 요청을 통과시킨다는 점도 함께 봐야 합니다.

워크로드 신원에 메서드와 경로, 검증된 JWT 클레임을 함께 지정한 정책입니다.

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

HTTP 속성이 든 정책이 TCP 트래픽을 만나면 해당 속성을 평가하지 못합니다. DENY 정책에서는 평가하지 못한 속성을 일치로 취급합니다. `methods`만 적은 DENY가 해당 포트의 TCP 연결을 전부 막을 수 있는 이유입니다.

Istio 문서는 이런 DENY 정책의 범위를 포트로 좁히라고 권합니다. JWT 검증과 인가 조건을 함께 다루는 내용은 [요청 커스터마이즈와 정책]({{< relref "/platform/istio/cilium/05-request-customization/index.md" >}}) 2절에 정리했습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| HTTP 전용 조건 | `request.headers`, `request.auth.principal/audiences/presenter/claims` | Istio Authorization conditions |
| HTTP·TCP 공통 조건 | `source.ip`, `remote.ip`, `source.namespace`, `source.principal`, `destination.ip/port`, `connection.sni` | Istio Authorization conditions |
| `hosts`·`methods`·`paths`는 HTTP 전용 | "Must be used only with HTTP" | Istio AuthorizationPolicy 레퍼런스 |
| TCP에서 DENY의 HTTP 속성은 일치로 취급 | 예시에서 8080 포트 TCP 전체 거부, 포트로 범위를 좁히라고 권고 | Istio AuthorizationPolicy 레퍼런스 |
| 평가 순서 | CUSTOM → DENY → ALLOW. ALLOW 정책이 있는데 맞는 것이 없으면 거부 | Istio AuthorizationPolicy 레퍼런스 |
| 1.31.4 보안 수정 | `:authority`·`host` 조건 대소문자 무시로 변경(GHSA-7m6f-j3gp-2r53) | Istio 1.31.4 발표 |
{{% /details %}}

## ztunnel만 지나는 길에 남는 것들 {#ztunnel만-있는-경로에는-무엇이-남는가}

ambient의 ztunnel은 노드가 공유하는 프록시이며 L4만 처리합니다. mTLS와 워크로드 신원은 남지만, 요청을 읽어야 하는 기능에는 waypoint가 필요합니다.

| 기능 | ztunnel만 | waypoint 추가 |
|---|---|---|
| 엔드포인트 분산 | 연결 단위, 지역 우선 annotation | 요청 단위 LB |
| 재시도·타임아웃 | 없음 | 있음 |
| 서킷 브레이킹·fault injection | 없음 | 있음 |
| HTTP 라우팅(가중치·헤더 매칭) | 없음 | HTTPRoute(Beta), VirtualService(Alpha) |
| 인가 | 신원·네임스페이스·IP·포트 | L7 속성까지 |
| mTLS·워크로드 신원 | 있음 | 있음 |

인가에서는 정책을 집행하는 프록시까지 확인해야 합니다. 경로나 메서드가 든 정책을 waypoint 대신 ztunnel이 집행하면, ztunnel은 그 규칙을 건너뜁니다. ALLOW 정책에 맞는 규칙이 없으면 트래픽이 막힙니다.

DENY 정책이면 막을 규칙이 없으니 트래픽이 그대로 지나갑니다. 한 항목에 L4·L7 속성이 섞여 있으면 L4 부분만 집행합니다.

L7 정책은 `targetRefs`로 waypoint에 붙입니다. waypoint를 거치지 않는 경로에도 대비하려면 ztunnel에 L4 정책을 함께 두는 편이 안전합니다. ambient로 옮길지 검토하는 과정은 [왜 ambient 모드인가]({{< relref "/platform/istio/ambient/01-why-ambient-mode/index.md" >}})에 있습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| ztunnel은 L4만 처리 | "scoped to only process traffic at Layer 4" | Istio ambient waypoint 문서 |
| waypoint가 필요한 기능 | "HTTP routing & load balancing, circuit breaking, rate limiting, fault injection, retries, timeouts", L7 인가, HTTP 메트릭·로그·트레이싱 | Istio ambient waypoint 문서 |
| ztunnel의 분산 | `PreferSameZone`·`PreferSameNode` annotation. 연결 단위라는 점은 L4 구조에서 도출 | Istio ambient traffic distribution |
| 라우팅 리소스 상태 | HTTPRoute Beta, TLSRoute·TCPRoute Alpha, VirtualService Alpha, Gateway API와 섞어 쓰기 미지원 | Istio ambient L7 features |
| ztunnel 집행 가능 속성 | principals·namespaces·ipBlocks·ports, source.ip/namespace/principal, destination.ip/port | Istio ambient L4 policy |
| L7 속성 정책을 ztunnel이 만나면 | ALLOW → 거부, L7 속성만 든 DENY → 허용, 한 항목에 L4·L7이 섞인 DENY → L4 부분만 집행 | Istio ambient L4 policy |
| waypoint 우회 가능성 | waypoint가 없거나 주소가 없을 때 등. ztunnel 정책 병행 권고 | Istio ambient L7 features |
{{% /details %}}

프록시가 요청을 구분하면 결과 코드와 지연도 요청마다 기록할 수 있습니다. 어느 워크로드가 어느 워크로드를 불렀는지도 라벨로 남깁니다. [05편]({{< relref "/study/istio-mesh/05-logs-and-tracing/index.md" >}})에서는 이 기록이 메트릭, 액세스 로그, 트레이스로 이어지는 과정을 따라갑니다.
