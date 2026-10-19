---
title: "04 재시도와 복원력 — 어느 API로 말할 수 있나"
description: "Istio의 기본 재시도·타임아웃·연결 풀·outlier 설정과 Gateway API 표준, Cilium의 CEC 경로를 견주어 재시도와 복원력을 어느 API로 표현할 수 있는지 정리한다."
date: 2026-10-19
lastmod: 2026-10-19
weight: 4
url: "/istio/cilium/04-retry-resilience/"
---

# 04 · 재시도와 복원력 — 어느 API로 말할 수 있나

## 1. 기능보다 설정을 담는 API를 봅니다

Cilium에서도 재시도를 설정할 수 있습니다. Istio와 Cilium 모두 L7(애플리케이션 계층) 처리는 Envoy가 맡으며, 재시도·타임아웃·서킷 브레이킹은 Envoy의 기능입니다. 이 글은 기능의 유무보다 그 기능을 어느 API로 표현하는지가 선택에 더 중요하다고 봅니다.

Istio는 VirtualService와 DestinationRule에 재시도와 복원력 설정을 담습니다. Cilium에서는 Gateway API 표준이 다루는 범위까지 고수준 API를 쓰고, 그 밖의 설정은 CiliumEnvoyConfig(CEC)로 Envoy 리소스를 직접 작성해야 합니다. Cilium의 L7 트래픽 관리 문서에 따르면 CEC는 listeners, routes, clusters, endpoints를 받습니다. 원시 설정을 쓸 수 있어도 빌드에 포함되지 않은 필터까지 사용할 수는 없습니다.

고수준 API에는 기본 재시도 정책, 지원 필드 검증, 문서화된 상호작용 규칙이 따라옵니다. Envoy 원시 설정을 직접 작성하는 경로에서는 사용자가 이를 책임져야 합니다. 이 글에서는 요청의 재시도와 타임아웃부터 백엔드의 연결 제한까지, 각 설정을 어느 API에 담을 수 있는지 살펴봅니다. Envoy가 어디에 놓이는지는 [01편]({{< relref "/platform/istio/cilium/01-l4-l7-proxy-placement/index.md" >}})에 있습니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-19이고, Istio 1.31.2, Cilium stable, Gateway API 문서를 기준으로 합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 재시도·타임아웃은 Envoy 기능이고 API가 갈린다 | VirtualService·DestinationRule vs Gateway API + CEC | Istio·Cilium 문서 | `Σ` |
| CEC는 Envoy 리소스를 직접 받는다 | listeners, routes, clusters, endpoints | Cilium L7 트래픽 관리 문서 | `✓` |

{{% /details %}}

## 2. Istio의 기본 재시도와 꺼져 있는 타임아웃

도식은 Istio의 기본 재시도가 요청 처리에 개입하는 흐름을 보여줍니다.

{{< seq src="_seq/2-기본-재시도.json" />}}

서비스별로 재시도 횟수와 조건을 지정할 때는 다음과 같이 VirtualService를 작성합니다.

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: web
  namespace: shop
spec:
  hosts:
    - web
  http:
    - route:
        - destination:
            host: web
      retries:
        attempts: 3
        perTryTimeout: 2s
        retryOn: connect-failure,refused-stream,unavailable
```

Istio에서는 재시도를 따로 설정하지 않아도 HTTP 요청을 기본 2회 재시도합니다. 오류를 돌려주기 전에 두 번 더 시도하며, Envoy가 자동으로 정하는 재시도 간격은 25ms 이상입니다. Istio 트래픽 관리 개념 문서와 VirtualService 레퍼런스에 명시된 동작입니다.

타임아웃의 기본값은 이와 다릅니다. 요청 전체의 `timeout`은 비활성화되어 있고, 시도별 제한인 `perTryTimeout`은 기본적으로 요청 타임아웃과 같은 값을 씁니다. 둘을 모두 생략하면 한 번의 시도에도 시간제한이 없습니다. 느리게 응답하는 백엔드에서는 재시도만 켜져 있고 기다리는 시간은 제한하지 않는 조합이 문제가 됩니다.

재시도 횟수만큼 중요한 것이 재시도 대상입니다. 기본 `retryOn`을 설명하는 문서는 서로 일치하지 않습니다. VirtualService 레퍼런스에는 `connect-failure,refused-stream,unavailable,cancelled`가 있고, MeshConfig의 `defaultHttpRetryPolicy` 문서와 소스(retry.go)에는 `retriable-status-codes`가 추가됩니다. 이 차이 때문에 기본 설정만으로 503을 재시도하는지는 확인하지 못했습니다. 일반 5xx 응답은 기본 목록에 없으므로 앱이 반환한 500을 자동으로 재시도한다고 기대해서는 안 됩니다. 인바운드 쪽 기본값에 `reset-before-request`가 있는 것은 소스에서 확인했으나 도입 버전은 확인하지 못했습니다.

결제나 주문 생성처럼 중복 실행을 피해야 하는 비멱등 요청도 살펴야 합니다. 이런 경로는 `attempts: 0`으로 재시도를 끄라는 것이 일반적인 해석입니다. 메시 전체의 기본값은 `meshConfig.defaultHttpRetryPolicy`로 바꾸며, 여기에 `attempts: 0`을 지정하면 전역 재시도도 끌 수 있습니다. 개별 요청의 HTTPRetry 설정에는 `attempts`, `perTryTimeout`, `retryOn`, `retryRemoteLocalities`, `backoff` 필드를 사용합니다.

장애 주입 실험에서는 설정 간 제약이 중요합니다. Istio의 장애 주입 작업 문서는 같은 VirtualService에서 장애 주입과 retry 또는 timeout 설정을 함께 쓸 수 없다고 명시합니다. `fault.delay`, `fault.abort`와 percentage로 장애를 만들고 같은 VirtualService의 재시도로 대응하게 하려는 실험은 이 제약에 걸립니다.

미러링은 주 서비스의 핵심 요청 경로와 별개로 수행하는 best effort 동작입니다. Istio 미러링 문서와 VirtualService 레퍼런스는 `mirror`, `mirrors`, `mirrorPercentage`를 제공하며, 비율을 생략하면 전체 트래픽을 미러링한다고 설명합니다. 가중치 분할에는 `route[].weight`를 씁니다. 재시도 폭주를 막는 상한은 VirtualService의 횟수 설정과 별도로 다음 절의 DestinationRule에서 `retryBudget`으로 다룹니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 기본 재시도 2회 | HTTP 요청, 간격 25ms 이상 | Istio 트래픽 관리 개념, VirtualService 레퍼런스 | `✓` |
| 기본 retryOn | 문서마다 다름: VirtualService 레퍼런스는 4종, MeshConfig·소스는 `retriable-status-codes` 추가 | VirtualService 레퍼런스, MeshConfig, retry.go | `✓` |
| 기본만으로 503을 재시도하는지 | 확인하지 못함 | — | `?` |
| 인바운드 기본 `reset-before-request` | 소스에서만 확인, 도입 버전 확인 못 함 | retry.go | `?` |
| 전역 기본값 | `meshConfig.defaultHttpRetryPolicy`, `attempts: 0`으로 전역 off | Istio 트래픽 관리 개념, MeshConfig | `✓` |
| 비멱등 경로는 `attempts: 0` | 일반적 해석 | — | `≈` |
| 타임아웃 기본 비활성 | `timeout` 기본 off, `perTryTimeout` 기본은 요청 타임아웃과 같은 값(= 제한 없음) | Istio 트래픽 관리 개념, VirtualService 레퍼런스 | `✓` |
| 장애 주입은 같은 VirtualService의 retry·timeout과 결합 불가 | 공식 문서 명시 | Istio 장애 주입 작업 문서 | `✓` |
| 미러링은 주 경로와 별개, 비율 생략 시 100% | best effort | Istio 미러링 작업 문서, VirtualService 레퍼런스 | `✓` |

{{% /details %}}

## 3. DestinationRule로 백엔드 보호하기

다음 DestinationRule은 연결 풀 제한과 outlier 감지를 함께 설정하는 예시입니다. YAML의 수치는 설명용 값입니다.

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: web
  namespace: shop
spec:
  host: web
  trafficPolicy:
    connectionPool:
      http:
        http1MaxPendingRequests: 100
        maxRetries: 3
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 10s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
```

요청 하나를 다시 시도할지는 VirtualService에서 정하지만, 백엔드의 연결 풀을 제한하고 outlier(이상 상태의 백엔드)를 감지하는 설정은 DestinationRule에 둡니다. Istio DestinationRule 레퍼런스는 이를 `connectionPool`과 `outlierDetection`으로 제공합니다.

연결 풀 설정에는 `tcp.maxConnections`, `http.http1MaxPendingRequests`, `http.http2MaxRequests`, `http.maxRequestsPerConnection`, `http.maxRetries`, `http.idleTimeout`이 있습니다. `connectionPool` 상한의 기본값은 2^32-1이며, `maxRequestsPerConnection`의 0은 무제한을 뜻합니다. 요청이 한도를 넘으면 프록시가 거절하고 `response_flags`에 `UO`를 남깁니다. 이 값으로 앱이 반환한 에러와 연결 풀 한도 때문에 프록시가 거절한 요청을 구별할 수 있습니다. 관측 쪽 지표는 [03편]({{< relref "/platform/istio/cilium/03-observability/index.md" >}})을 참고합니다.

outlier 감지에는 `consecutive5xxErrors`, `consecutiveGatewayErrors`, `interval`, `baseEjectionTime`, `maxEjectionPercent`를 씁니다. 기본값은 `consecutive5xxErrors` 5, `interval` 10s, `baseEjectionTime` 30s, `maxEjectionPercent` 10%입니다. `consecutive5xxErrors`를 0으로 두면 해당 감지를 끄며, `consecutiveGatewayErrors`는 기본적으로 꺼져 있습니다. DestinationRule 레퍼런스와 locality LB 문서에 따르면 outlierDetection을 설정할 때 locality failover도 자동으로 활성화됩니다.

재시도에도 별도의 상한을 둘 수 있습니다. DestinationRule의 `retryBudget`은 1.27에서 도입됐으며, `percent`의 기본값은 20%, `minRetryConcurrency`의 기본값은 3입니다. 1.31에는 `budgetInterval`이 추가됐습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| connectionPool·outlierDetection 필드 | 본문에 나열한 필드명 | Istio DestinationRule 레퍼런스 | `✓` |
| 풀 초과는 `UO` | `response_flags="UO"` | Istio DestinationRule 레퍼런스 | `✓` |
| outlierDetection 설정 시 locality failover 자동 활성 | 기본값은 본문에 나열 | Istio DestinationRule 레퍼런스, locality LB 문서 | `✓` |
| retryBudget | 1.27 도입, percent 20%, minRetryConcurrency 3, budgetInterval은 1.31 | Istio DestinationRule 레퍼런스 | `✓` |
| YAML의 수치 | 설명용 예시 값 | — | `Σ` |

{{% /details %}}

## 4. Gateway API로 표현할 수 있는 범위와 Cilium의 CEC

HTTPRoute에서는 다음과 같이 요청 타임아웃을 설정합니다.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web
  namespace: shop
spec:
  parentRefs:
    - name: web-gateway
  rules:
    - timeouts:
        request: 10s
      backendRefs:
        - name: web
          port: 8080
```

타임아웃과 재시도는 Gateway API에서도 표현할 수 있습니다. 두 기능의 표준화 상태는 다릅니다. Gateway API 문서에서 timeouts(GEP-1742)는 v1.1부터 표준이며, 재시도(GEP-1731)는 experimental 상태입니다. 재시도 필드는 `retry.codes`, `attempts`(기본 1), `backoff`입니다. HTTPRoute의 표준 기능에는 타임아웃 외에도 매칭, 가중치, 헤더 수정, URLRewrite, RequestRedirect, RequestMirror가 포함됩니다.

재시도의 구현 여부는 conformance(적합성 검증) 리포트에서 확인할 수 있습니다. Istio 1.31 리포트는 Gateway API v1.6의 experimental 채널을 기준으로 HTTPRouteRetry, HTTPRouteRetryBackendTimeout, HTTPRouteRetryConnectionError와 HTTPRouteRequestTimeout, HTTPRouteBackendTimeout을 지원 항목에 올렸습니다. Cilium 1.20.0 리포트도 Gateway API v1.6.1의 experimental 채널에서 같은 재시도 3종과 타임아웃 2종을 지원한다고 표시합니다. Cilium에서 재시도 conformance를 처음 확인한 버전이 1.20.0이라는 뜻이며, 이전 버전의 미지원을 뜻하지는 않습니다. Cilium 문서에 따르면 이 재시도를 사용하려면 experimental 채널 CRD를 설치해야 합니다.

서킷 브레이킹, outlier 감지, 장애 주입으로 범위를 넓히면 Gateway API 표준만으로는 표현할 수 없습니다. Istio의 Gateway API 문서도 표준이 Istio 기능의 100%를 다루지는 못한다고 밝힙니다. fault injection, `outlierDetection`, `connectionPool`, locality, `retryBudget`을 쓰려면 DestinationRule과 VirtualService를 병행해야 합니다. Istio ambient 문서는 같은 대상에 VirtualService와 Gateway API 설정을 섞어 쓰는 구성을 지원하지 않는다고 명시하므로 주의해야 합니다.

Cilium에서는 서킷 브레이킹과 outlier 감지를 Envoy 원시 설정으로 쓸 수 있습니다. 공식 예제는 CiliumClusterwideEnvoyConfig(CCEC)에 Envoy cluster의 `circuit_breakers`와 `outlier_detection`을 넣습니다. 장애 주입은 이 경로로도 쓸 수 없습니다. cilium-envoy 빌드에서 `envoy.filters.http.fault` 필터가 빠져 있기 때문입니다. locality LB와 `retryBudget`에 해당하는 재시도 상한의 Cilium 지원은 확인하지 못했습니다.

원시 설정을 사용할 때의 부담은 Cilium L7 트래픽 관리 문서에 명시되어 있습니다. CEC와 CCEC는 최소한의 검증만 거치며 충돌 해결 규칙도 정의되어 있지 않습니다. 리소스 적용에 성공해도 노드 Envoy에서 실패할 수 있고, 실패 사실은 agent 로그에서만 확인됩니다. 문서는 이 리소스를 클러스터 관리자 리소스로 다루라고 안내합니다.

Gateway가 자동으로 만든 CEC와 충돌할 때도 결과를 예측할 수 없다는 것이 문서의 경고입니다. 사용할 수 있는 확장은 빌드에 포함된 것으로 제한되며, kube-proxy 대체도 켜져 있어야 합니다. 구조로 보면 노드가 공유하는 Envoy에 잘못된 설정을 전달했을 때 해당 노드의 L7 트래픽 전체가 영향을 받을 가능성이 있습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| HTTPRoute 표준 기능 | 매칭, 가중치, 헤더 수정, URLRewrite, RequestRedirect, RequestMirror, timeouts | Gateway API 문서 | `✓` |
| timeouts(GEP-1742)는 v1.1 표준 | — | Gateway API 문서 | `✓` |
| 재시도(GEP-1731)는 experimental | 필드 `retry.codes`, `attempts`(기본 1), `backoff` | Gateway API GEP-1731 | `✓` |
| Istio의 GEP-1731 지원 | 1.31 conformance 리포트(Gateway API v1.6, experimental)에서 HTTPRouteRetry 3종·타임아웃 2종 | Gateway API conformance 리포트 | `✓` |
| Cilium의 GEP-1731 지원 | 1.20.0 리포트(Gateway API v1.6.1, experimental)에서 같은 5종 지원. 이전 버전은 확인하지 않음 | Gateway API conformance 리포트 | `✓` |
| Gateway API로 표현 못 하는 Istio 기능 | fault injection, outlierDetection, connectionPool, locality, retryBudget | Istio Gateway API 문서 | `✓` |
| 서킷 브레이킹·outlier는 CCEC 예제 | Envoy cluster `circuit_breakers`, `outlier_detection` | Cilium 서킷 브레이커 예제 문서 | `✓` |
| Cilium 장애 주입 불가 | `envoy.filters.http.fault`가 빌드에서 빠짐 | cilium/proxy v1.38 빌드 설정 | `✓` |
| CEC 한계 | 최소 검증, 충돌 규칙 없음, 실패는 agent 로그, KPR 필요 | Cilium L7 트래픽 관리 문서 | `✓` |
| CEC 오류의 노드 영향 범위 | 노드 공유 Envoy 구조에서 도출 | — | `≈` |
| locality LB의 Cilium 지원 | 확인하지 못함 | — | `?` |

{{% /details %}}

## 5. 필요한 기능에서 API 선택으로

| 기능 | Istio API | Gateway API 표준 | Cilium |
|---|---|---|---|
| 요청 타임아웃 | VirtualService (기본 off) | timeouts(GEP-1742) 표준 | HTTPRoute timeouts 지원 |
| 재시도 | VirtualService retries (기본 2회) | GEP-1731 experimental | 1.20.0 conformance에서 지원 확인 |
| 재시도 상한 | DestinationRule retryBudget | 표준 없음 | 확인 못 함 |
| 연결 풀·서킷 브레이킹 | DestinationRule connectionPool | 표준 없음 | CCEC 공식 예제 |
| outlier 감지 | DestinationRule outlierDetection | 표준 없음 | CCEC 공식 예제 |
| 장애 주입 | VirtualService fault | 표준 없음 | 불가(fault 필터가 빌드에 없음) |
| 미러링 | VirtualService mirror | RequestMirror | RequestMirror 지원 |
| locality LB | DestinationRule localityLbSetting | 표준 없음 | 확인 못 함 |

필요한 기능을 정했다면 표에서 그 설정을 담을 API를 찾으면 됩니다. 타임아웃, 미러링, 가중치 분할이 요구의 전부라면 Istio와 Cilium 모두 Gateway API 표준으로 비슷하게 표현할 수 있습니다. 기본 재시도, 재시도 상한, 장애 주입 실험까지 필요할 때는 Istio의 고수준 API가 설정을 더 짧게 표현하는 데 유리하다는 것이 이 글의 판단입니다.

Cilium을 선택하면 서킷 브레이킹과 outlier 감지를 Envoy 원시 설정으로 작성해야 하며, 장애 주입은 사용할 수 없습니다. 표의 “확인 못 함”은 지원 여부를 확인하지 못했다는 표시입니다. 이를 불가로 읽어서는 안 되며, 도입 전에는 사용할 기능이 해당 버전에서 실제로 동작하는지 시험해야 합니다.

헤더와 rewrite, 인가, 확장 같은 요청 커스터마이즈는 어느 API까지 표현할 수 있을까요? [05편]({{< relref "/platform/istio/cilium/05-request-customization/index.md" >}})에서는 이 질문과 함께 Istio와 Cilium을 함께 쓰는 구성을 다룹니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 비교표의 Istio 칸 | 2·3절의 필드와 기본값 | Istio 문서 | `✓` |
| 비교표의 Gateway API 칸 | 표준 기능 목록과 GEP 상태 | Gateway API 문서 | `✓` |
| 비교표의 Cilium 칸 | conformance 리포트, CCEC 예제, 빌드 설정 | Cilium 문서·리포트 | `✓` 일부 `?` |
| 표의 "확인 못 함"의 의미 | 확인하지 못한 것이지 불가가 아님 | — | `Σ` |

{{% /details %}}

## 참고 자료

- [Traffic Management concepts — Retries](https://istio.io/latest/docs/concepts/traffic-management/#retries) — Istio, latest(2026-10-19 확인) `✓`
- [VirtualService reference — HTTPRetry](https://istio.io/latest/docs/reference/config/networking/virtual-service/#HTTPRetry) — Istio, latest(2026-10-19 확인) `✓`
- [DestinationRule reference](https://istio.io/latest/docs/reference/config/networking/destination-rule/) — Istio, latest(2026-10-19 확인) `✓`
- [Fault Injection](https://istio.io/latest/docs/tasks/traffic-management/fault-injection/) — Istio, latest(2026-10-19 확인) `✓`
- [Mirroring](https://istio.io/latest/docs/tasks/traffic-management/mirroring/) — Istio, latest(2026-10-19 확인) `✓`
- [Locality Load Balancing](https://istio.io/latest/docs/tasks/traffic-management/locality-load-balancing/) — Istio, latest(2026-10-19 확인) `✓`
- [Istio Gateway API](https://istio.io/latest/docs/tasks/traffic-management/ingress/gateway-api/) — Istio, latest(2026-10-19 확인) `✓`
- [GEP-1731 HTTPRoute Retries](https://gateway-api.sigs.k8s.io/geps/gep-1731/) — Gateway API, 2026-10-19 확인 `✓`
- [Gateway API implementations](https://gateway-api.sigs.k8s.io/implementations/) — Gateway API, 2026-10-19 확인 `✓`
- [Layer 7 traffic management](https://docs.cilium.io/en/stable/network/servicemesh/l7-traffic-management/) — Cilium, stable(2026-10-19 확인) `✓`
- [Gateway API support](https://docs.cilium.io/en/stable/network/servicemesh/gateway-api/gateway-api/) — Cilium, stable(2026-10-19 확인) `✓`
