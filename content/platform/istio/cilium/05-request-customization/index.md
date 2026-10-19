---
title: "05 요청 커스터마이즈와 정책 — 헤더부터 ext_authz까지, 그리고 함께 쓰기"
description: "헤더·rewrite·redirect·mirror, L7 인가, 확장 지점을 Istio와 Cilium에서 견주고, Cilium CNI 위에 Istio를 올릴 때의 주의점과 고르는 기준을 정리한다."
date: 2026-10-19
lastmod: 2026-10-19
weight: 5
url: "/istio/cilium/05-request-customization/"
---

# 05 · 요청 커스터마이즈와 정책 — 헤더부터 ext_authz까지, 그리고 함께 쓰기

## 1. 요청 변경을 VirtualService와 HTTPRoute로 표현하기

| 동작 | Istio VirtualService | Gateway API HTTPRoute | Cilium |
|---|---|---|---|
| 헤더 set·add·remove | `headers` | Request/ResponseHeaderModifier | 지원 |
| rewrite | `rewrite`(uri·authority), `uriRegexRewrite` | Path/HostRewrite | 지원 |
| redirect | `redirect` | RequestRedirect | 지원 |
| 가중치 분할 | `route[].weight` | 가중치 | 지원 |
| 미러링 | `mirror`, `mirrors`, `mirrorPercentage` | RequestMirror | 지원(다중·비율 포함) |
| CORS | `corsPolicy` | CORS 필터 | 1.20에서 추가 |
| 외부 인가 | AuthorizationPolicy CUSTOM(2절) | ExternalAuth 필터(GEP-1494) | 1.20에서 지원 시작 |
| 정규식 rewrite | `uriRegexRewrite` | 표준에 없음 | 확인 못 함 |

헤더를 바꾸거나 요청 경로를 rewrite하고, redirect·미러링·가중치 분할을 설정하는 요구라면 양쪽의 기능 목록은 거의 같습니다. Istio는 VirtualService 필드로, Cilium은 Gateway API의 HTTPRoute 필터로 이를 표현합니다. Istio VirtualService 레퍼런스와 Cilium conformance 리포트에서 확인할 수 있는 대응 관계가 위 표입니다.

이 절에서 살펴볼 범위는 요청 변경을 Gateway API 표준으로 어디까지 표현할 수 있는지입니다. nginx의 location, rewrite를 Istio 리소스로 옮기는 대응표는 [nginx에서 Istio로]({{< relref "/platform/istio/configuration/07-from-nginx-to-istio.md" >}})에 있습니다. 게이트웨이 구현 방식은 [02편]({{< relref "/platform/istio/cilium/02-gateway-api/index.md" >}})에서 비교했습니다.

표를 적용할 때는 Cilium 버전을 함께 봐야 합니다. CORS는 1.19까지의 conformance 리포트에서 미지원이었지만 1.20에서 지원으로 바뀌었습니다. CNCF 블로그는 ExternalAuth 필터도 1.20부터 지원한다고 소개합니다. 관련 버그 이슈 #49132가 열려 있으므로, 지원 여부와 기능의 성숙도를 구분해서 읽어야 합니다.

문서가 어느 버전을 설명하는지도 중요합니다. 세션 지속(sessionPersistence)은 1.20.3 stable 문서에는 없고 개발 중인 문서에만 있습니다. 정규식 rewrite의 Cilium 지원 여부는 확인하지 못했습니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-19이고, Istio 1.31.2, Cilium stable, Gateway API 문서를 기준으로 합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| VirtualService의 헤더·rewrite·redirect·CORS | headers, rewrite(uri/authority, uriRegexRewrite), redirect, corsPolicy | Istio VirtualService 레퍼런스 | `✓` |
| Cilium의 필터 지원 | 헤더 수정, redirect, Path/HostRewrite, mirror, 가중치 | Cilium 1.20.0 conformance 리포트 | `✓` |
| CORS | 1.19 리포트에서 unsupported, 1.20에서 추가 | Cilium conformance 리포트 | `✓` |
| ExternalAuth | 1.20 지원 시작, 버그 #49132 열림 | CNCF 블로그, GitHub 이슈 | `Ⓥ` |
| sessionPersistence | 1.20.3 stable에 없고 개발 문서에만 있음 | Cilium 문서 | `✓` |
| 정규식 rewrite의 Cilium 지원 | 확인하지 못함 | — | `?` |

{{% /details %}}

## 2. L7 인가에서 신원과 판정 방식의 차이

| 항목 | Cilium CNP L7 | Istio AuthorizationPolicy |
|---|---|---|
| 신원 | 레이블 기반 Cilium security identity | SPIFFE principal(mTLS 인증서) |
| JWT 클레임 | 조건 없음 | `request.auth.claims` |
| 외부 인가 | 정책에는 없음, Gateway 경로엔 ExternalAuth(1.20) | CUSTOM(ext_authz) |
| 액션 | allow-list + 403, L7 deny 없음 | ALLOW·DENY·AUDIT·CUSTOM |
| DNS L7 | 가능 | 불가 |
| Kafka L7 | 1.20에서 제거 | 불가 |
| 집행 위치 | 노드 Envoy | 사이드카 또는 waypoint |

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: web-ext-authz
  namespace: shop
spec:
  selector:
    matchLabels:
      app: web
  action: CUSTOM
  provider:
    name: my-authz
  rules:
    - to:
        - operation:
            paths: ["/admin/*"]
```

L7(애플리케이션 계층) 인가를 비교할 때는 어떤 요청을 허용할지 살펴야 합니다. 이때 요구를 호출자의 신원 확인과 요청의 허용 여부를 판정하는 방식으로 나눠 봅니다. 위 표는 Cilium 공식 문서의 항목을 바탕으로 양쪽을 대비한 이 글의 정리입니다. 인증서로 호출자 신원을 검증하고 JWT 클레임으로 판정하거나 L7 deny 규칙을 쓰는 것은 Istio에서만 됩니다. DNS 도메인 단위로 나가는 트래픽을 제한하는 것은 Cilium에서만 됩니다.

### Istio: 토큰 검증과 접근 허용을 함께 설정하기

Istio AuthorizationPolicy 레퍼런스는 `ALLOW`, `DENY`, `AUDIT`, `CUSTOM` 네 가지 액션을 정의합니다. `to.operation`의 `methods`, `paths`, `hosts`로 요청을 매칭하고, `when`에는 `request.headers`, `request.auth.claims` 같은 조건을 넣습니다. 평가 순서는 CUSTOM, DENY, ALLOW입니다.

위 YAML은 외부 인가 서버에 판정을 맡기는 `CUSTOM` 예시입니다. 이 액션이 지원하는 확장 provider는 Envoy `ext_authz`뿐입니다. 예시는 사이드카 워크로드용이며, waypoint에 정책을 붙일 때는 `targetRefs`가 필수입니다. Istio ambient L7 문서에 따르면 waypoint는 `selector` 정책을 무시합니다. waypoint에서 CUSTOM 액션이 동작하는지는 확인하지 못했습니다.

JWT를 사용할 때는 RequestAuthentication과 AuthorizationPolicy의 역할을 구분해야 합니다. RequestAuthentication은 토큰을 검증하지만 토큰이 없는 요청은 통과시킵니다. 토큰을 반드시 제출하게 하려면 AuthorizationPolicy의 `requestPrincipals` 조건도 필요합니다. 리소스 하나만 설정하고 JWT로 접근을 보호했다고 판단하면 요청이 열려 있을 수 있습니다.

Ambient에서는 정책을 집행할 위치도 맞춰야 합니다. HTTP를 파싱하지 않는 ztunnel에 L7 속성이 든 정책을 적용하면, Istio 문서에 명시된 안전 실패 동작에 따라 `DENY` 정책이 됩니다. 따라서 L7 정책은 waypoint와 함께 설계해야 합니다.

### Cilium: 허용 목록과 규칙이 겹칠 때의 동작

Cilium은 CiliumNetworkPolicy(CNP)에 L7 규칙을 넣습니다. HTTP의 method, path, host는 확장 POSIX 정규식으로 매칭하며, headers로 헤더의 존재 여부를, `headerMatches`로 값을 확인합니다. DNS 정책에는 `toFQDNs`와 DNS 프록시를 사용합니다.

Cilium L7 정책 문서에 따르면 규칙 하나라도 매칭되면 요청을 허용합니다. 위반한 요청은 패킷을 버리는 대신 HTTP 403으로 응답하고, DNS에는 REFUSED를 반환합니다. 이 정책은 허용 목록으로 동작하며 L7 deny 규칙은 없습니다. Deny는 L3/L4에서만 사용할 수 있습니다.

규칙을 추가할 때는 같은 포트의 L4 규칙도 살펴야 합니다. L7 조건이 없는 L4 규칙이 겹치면 L7 부분은 효력을 잃습니다. Kafka L7 정책을 사용했다면 업그레이드 준비도 필요합니다. 이 기능은 1.19에서 deprecated되었고 1.20에서 제거되었으므로, 1.20으로 올리기 전에 Kafka 규칙을 지워야 합니다.

### 인증과 데이터 암호화를 구분하기

인가에 쓰는 신원을 비교하려면 mTLS(상호 TLS 인증)도 함께 봐야 합니다. Istio는 워크로드 인증서로 데이터를 암호화하는 mTLS가 GA입니다. Cilium의 Mutual Authentication은 Beta이며, Cilium 문서는 이 기능이 아직 불완전하다고 밝힙니다. 1.20에서는 deprecated되었고 대체 방식으로 ztunnel을 권장합니다.

Cilium Mutual Authentication은 핸드셰이크를 대역 외로 처리할 뿐 데이터를 암호화하지 않습니다. 사용자가 암호화를 별도로 켜야 하며, 노드 간 WireGuard/IPsec도 워크로드 신원 mTLS와는 구분해야 합니다.

대안인 Cilium ztunnel 투명 암호화는 파드 간 L4 mTLS를 제공합니다. 1.19에서 베타로 도입되었고 1.20.3에서도 베타입니다. Cilium 문서가 명시한 제약은 TCP만 지원한다는 점, 통신 양쪽이 모두 등록되어야 한다는 점, 파드 단위 등록과 ClusterMesh 조합을 지원하지 않는다는 점입니다. waypoint나 L7 지원, Istio ambient와의 상호운용은 확인하지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| AuthorizationPolicy 액션·필드·평가 순서 | CUSTOM → DENY → ALLOW, CUSTOM provider는 ext_authz만 | Istio AuthorizationPolicy 레퍼런스 | `✓` |
| waypoint 정책은 targetRefs 필수 | selector 정책은 무시 | Istio ambient L7 문서 | `✓` |
| waypoint에서 CUSTOM 동작 | 확인하지 못함 | — | `?` |
| RequestAuthentication은 검증만 | 토큰 없으면 통과, `requestPrincipals`로 요구 | Istio 문서 | `✓` |
| CNP L7: HTTP·DNS, 403, allow-list | 확장 POSIX 정규식, L7 deny 없음, REFUSED | Cilium L7 정책 문서 | `✓` |
| Kafka 정책 제거 | 1.19 deprecated, 1.20 제거 | Cilium 업그레이드 노트 | `✓` |
| ztunnel에 건 L7 속성 정책은 DENY | 안전 실패 | Istio ambient L4 정책 문서 | `✓` |
| 비교표의 대비 구성 | Cilium 쪽은 공식, 대비는 조사자 정리 | — | `Σ` |
| Mutual Authentication | Beta, 불완전, 1.20 deprecated, 데이터 비암호화 | Cilium Mutual Authentication 문서 | `✓` |
| Cilium ztunnel 투명 암호화 | 1.19 베타 도입, 1.20.3 베타, TCP만 등 제약 | Cilium ztunnel 암호화 문서 | `✓` |
| ztunnel 암호화와 Istio ambient 상호운용 | 확인하지 못함 | — | `?` |

{{% /details %}}

## 3. 표준 리소스로 부족할 때의 확장 경로

```yaml
apiVersion: cilium.io/v2
kind: CiliumEnvoyConfig
metadata:
  name: web-envoy
  namespace: shop
spec:
  services:
    - name: web
      namespace: shop
  resources:
    # listeners, routes, clusters 등 Envoy 리소스를 직접 기술
```

표준 리소스로 표현할 수 없는 요구는 Envoy 설정을 직접 다뤄야 합니다. Istio에는 EnvoyFilter가 있고, Cilium에는 위 예시의 CiliumEnvoyConfig(CEC)와 클러스터 전역 버전인 CCEC가 있습니다. EnvoyFilter는 Istio가 만든 설정에 패치를 적용합니다. CEC는 Envoy 리소스를 통째로 기술하는 저수준 API입니다.

Cilium L7 트래픽 관리 문서에 따르면 CEC/CCEC는 listeners, routes, clusters, endpoints를 직접 받습니다. `services:`는 특정 Service의 트래픽을 리스너로 보내고, `backendServices:`는 EDS를 동기화합니다. 검증과 충돌 규칙, 실패를 확인할 때의 한계는 [4편]({{< relref "/platform/istio/cilium/04-retry-resilience/index.md" >}})에서 다뤘습니다.

### Istio에서 EnvoyFilter와 TrafficExtension을 쓰는 범위

Istio 공식 문서는 EnvoyFilter가 언제든 바뀔 수 있는 내부 구현을 드러낸다고 경고합니다. 사용법과 사용 수칙은 [EnvoyFilter]({{< relref "/platform/istio/configuration/08-envoyfilter-extension/index.md" >}})에 있습니다. 적용 대상에도 제한이 있습니다. Envoy가 아닌 ztunnel에는 적용되지 않으며, 문서에 따르면 waypoint에서도 지원되지 않습니다.

Wasm과 Lua 확장에는 TrafficExtension(`extensions.istio.io/v1alpha1`, Alpha)이 있습니다. 1.30에서 도입된 이 API는 사이드카, 게이트웨이, waypoint의 Envoy용 Wasm과 Lua 확장을 한 방식으로 설정합니다. Istio 블로그는 이를 WasmPlugin을 대체하는 주 확장 수단으로 소개합니다. wasm과 lua 중 하나를 선택하며 Lua는 64KB까지 허용합니다.

레이트 리밋은 여전히 EnvoyFilter로 설정합니다. local에는 `local_ratelimit`을, global에는 envoyproxy/ratelimit과 Redis를 사용합니다. waypoint는 EnvoyFilter를 지원하지 않으며, waypoint에서 레이트 리밋을 설정하는 공식 경로는 확인하지 못했습니다.

### Cilium에서는 빌드에 포함된 필터인지 확인하기

CEC로 Envoy 리소스를 직접 작성하더라도 사용할 수 있는 필터는 cilium-envoy 빌드에 포함된 것으로 한정됩니다. 빌드 설정에는 ext_authz, jwt_authn, rbac, local_ratelimit, ratelimit, cors가 포함되어 있습니다. Lua 필터와 fault 필터는 빌드에서 빠져 있어 쓸 수 없습니다.

Wasm은 빌드 포함 여부와 지원 근거를 구분해서 읽어야 합니다. Wasm 필터와 런타임(V8, wamr, wasmtime)은 바이너리에 있지만 공식 문서나 지원 선언은 없습니다. 빌드에 있다는 사실만으로 도입을 결정하기는 어렵습니다. Go로 작성하는 L7 파서 프레임워크 proxylib는 deprecated된 뒤 1.20에서 제거되었습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| EnvoyFilter 경고, ztunnel·waypoint에서 미지원 | 내부 구현 노출, waypoint는 어느 Istio 버전에서도 미지원 | Istio EnvoyFilter·rate limit 문서 | `✓` |
| TrafficExtension | 1.30 도입, Alpha, wasm 또는 lua, Lua 64KB, WasmPlugin 대체 | Istio 블로그 | `✓` 블로그 |
| waypoint 레이트 리밋 공식 경로 | 확인하지 못함 | — | `?` |
| CEC/CCEC 구성 | listeners, routes, clusters, endpoints, `services:`, `backendServices:` | Cilium L7 트래픽 관리 문서 | `✓` |
| cilium-envoy 빌드의 필터 | ext_authz 등 포함, Lua·fault 제외, Wasm 포함이나 무문서 | cilium/proxy v1.38 빌드 설정 | `✓` |
| proxylib 제거 | deprecated 뒤 1.20 제거 | Cilium 업그레이드 노트 | `✓` |

{{% /details %}}

## 4. Cilium CNI 위에서 Istio 함께 쓰기

그림은 Cilium CNI와 Istio를 함께 사용할 때 각 계층이 담당하는 범위를 보여 줍니다.

{{< flow src="_flow/4-함께-쓸-때-계층.json" />}}

Cilium을 CNI(컨테이너 네트워크 인터페이스)로 쓰고 그 위에 Istio를 구성하는 방식은 흔합니다. 특히 양쪽에서 L7 HTTP 정책을 모두 집행하려는 구성은 Cilium 문서가 권고하지 않습니다.

사이드카 구성에서 Cilium L7 정책을 사용하려면 해당 워크로드의 mTLS를 `DISABLE`해야 합니다. 사실상 어느 쪽에 L7 정책을 맡길지 선택해야 하는 조건입니다. Ambient에서는 다른 제약이 있습니다. Cilium 문서는 터널 트래픽의 실제 출발지와 목적지를 Cilium이 볼 수 없다고 설명합니다.

이 조건들을 기준으로 보면 HTTP 수준의 인가는 Istio가 맡고, Cilium은 L3/L4 정책과 로드밸런싱, flow 가시성을 담당하는 분담이 자연스럽습니다. 문서의 터널 설명에 비추어 Hubble에서도 ambient 터널 구간의 flow는 터널 양끝으로 보일 것으로 추정합니다. Cilium 투명 암호화와 Istio mTLS를 함께 켰을 때 이중 암호화 오버헤드가 생길 수 있다는 점 역시 구조에서 도출한 추정입니다.

### 요청 경로와 헬스체크에 필요한 설정

Cilium의 Istio 문서는 kube-proxy를 유지하는 구성을 권장하며, `kubeProxyReplacement`의 기본값은 `false`입니다. kube-proxy를 대체하려면 `kubeProxyReplacement: true`, `socketLB.hostNamespaceOnly: true`, `cni.exclusive: false`를 함께 설정합니다. 파드 안에서 Service VIP가 미리 백엔드 IP로 바뀌면 Istio 사이드카처럼 원래 ClusterIP에 의존하는 동작이 깨지기 때문입니다.

Cilium 문서와 Istio ambient 플랫폼 사전 조건 문서에서 확인할 설정은 다음과 같습니다.

- `cni.exclusive: false`가 필요하다. Cilium이 다른 CNI 설정을 지우면 istio-cni의 체이닝이 깨진다.
- `bpf.masquerade=true`는 ambient와 함께 지원되지 않는다. ambient 헬스체크가 깨지며, iptables masquerade는 동작한다.
- default-deny 정책을 쓴다면 ambient 헬스 프로브의 SNAT 주소 `169.254.7.127/32`를 허용하는 CiliumClusterwideNetworkPolicy(`allow-ambient-hostprobes`)가 필요하다.
- ambient에 NetworkPolicy를 걸 때는 포트 15008을 열어야 한다.
- 오버레이 모드의 사이드카 구성이면 istiod에 `hostNetwork: true`를 준다.

### 릴리스 주기와 성능 자료를 읽는 기준

함께 쓰는 구성에서는 두 제품의 릴리스 주기를 모두 따라가야 합니다. Cilium은 CNI, kube-proxy 대체, 정책, Gateway, 메시 기능을 한 릴리스에 묶습니다. Gateway API 버전도 Cilium minor를 따라가며, 1.19는 v1.4, 1.20은 v1.6을 사용합니다. Cilium 문서가 검증한 롤백·업그레이드 경로는 연속된 minor 사이뿐입니다.

cilium-envoy를 DaemonSet으로 실행하면 agent와 별도로 재시작하거나 Envoy 패치 릴리스를 올릴 수 있습니다. Istio는 메시가 CNI와 분리되어 있어 버전을 따로 움직일 수 있습니다.

확인한 성능 자료만으로 어느 구성을 고를지 결정하기는 어렵습니다. 자료는 2024년 11월 arXiv 논문(2411.02267) 하나이며, mTLS를 켠 조건에서 P99 지연이 Istio 166%, Istio Ambient 8%, Linkerd 33%, Cilium 99% 늘었다고 보고합니다. 당시 Cilium은 현재 deprecated된 Mutual Authentication과 WireGuard/IPsec을 사용했습니다. 메시 버전도 명시되지 않아 이 수치를 현재 구성에 직접 적용하기 어렵습니다. 벤더 블로그의 배수 수치는 인용하지 않았습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Cilium 문서의 Istio 구성 권고 | kubeProxyReplacement 기본 false, KPR 시 세 설정, 오버레이+사이드카면 istiod hostNetwork | Cilium Istio 문서 | `✓` |
| ambient 사전 조건 | `cni.exclusive: false`, `bpf.masquerade=true` 미지원, `169.254.7.127/32` 허용, 15008 | Istio ambient 플랫폼 사전 조건 | `✓` |
| L7 정책 동시 사용 비권고 | 사이드카에서는 해당 워크로드 mTLS를 DISABLE | Cilium Istio 문서 | `✓` |
| ambient 터널 구간 가시성 | Cilium이 실제 출발지·목적지를 알 수 없음 | Cilium Istio 문서 | `✓` |
| Hubble에서 터널 양끝으로 보임 | 위 문서 서술에서 도출 | — | `≈` |
| 이중 암호화 오버헤드 | 구조상 도출 | — | `≈` |
| 업그레이드 단위 | 한 릴리스, Gateway API 버전은 minor 추종, 연속 minor 경로만 검증 | Cilium 문서 | `✓` |
| cilium-envoy 독립 재시작 | DaemonSet 모드 | Cilium Envoy 문서 | `✓` |
| 성능 수치 | arXiv 2411.02267, mTLS 조건 P99 지연 증가율 | 학술 논문 | `✓` 조건 한정 |
| 지원하는 Istio 버전 범위 | 확인하지 못함 | — | `?` |

{{% /details %}}

## 5. 고르는 기준

| 요구 | 기울어지는 쪽 | 이유 |
|---|---|---|
| 노드 단위로 가볍게 L4 로드밸런싱·정책을 하고 싶다 | Cilium | L4를 eBPF가 처리하고 사이드카가 없다 |
| 모든 HTTP에 기본 메트릭과 span이 필요하다 | Istio | L7 관측 기본값이 넓다 |
| 메시 밖 파드까지 L3/L4 drop 이유를 보고 싶다 | Cilium(Hubble) | eBPF에서 flow를 수집한다 |
| 재시도 상한·장애 주입을 고수준 API로 | Istio | VirtualService·DestinationRule, Cilium은 장애 주입 불가 |
| 표준 재시도·타임아웃만 필요하다 | 둘 다 가능 | 두 구현 모두 conformance 통과, 상세는 4편 |
| Gateway API 표준으로 게이트웨이만 필요하다 | 둘 다 가능 | 지원 리소스와 구현 방식은 2편 |
| JWT 클레임·ext_authz로 인가해야 한다 | Istio | AuthorizationPolicy |
| DNS 도메인 단위 L7 제한이 필요하다 | Cilium | CNP의 DNS 규칙, Kafka 규칙은 1.20에서 제거 |
| 워크로드 인증서 기반 mTLS가 필요하다 | Istio | GA, 데이터까지 암호화. Cilium은 Mutual Auth가 deprecated, ztunnel 암호화는 베타 |
| Envoy 설정을 직접 조작해야 한다 | 둘 다 가능 | EnvoyFilter·TrafficExtension 또는 CEC, 대신 책임은 사용자. Cilium은 빌드에 없는 필터(Lua·fault)를 못 씀 |
| 위 요구가 섞여 있다 | 함께 사용 | Cilium CNI 위에 Istio, 설정 주의점은 4절 |

Istio를 뺄 수 있는지는 Cilium의 L7 지원 여부만으로 결정되지 않습니다. 이 글의 판단 기준은 위 표에서 Istio 쪽으로 기우는 요구가 남아 있는지입니다. 그런 요구가 없다면 Cilium만으로 충분할 수 있습니다. 하나라도 남는다면 그 요구가 Istio를 유지하는 이유가 됩니다.

표는 다섯 편에서 확인한 내용을 요구 단위로 재배열한 것이며, 개별 근거는 각 편에 있습니다. 관측성 요구를 다시 확인하려면 [03편]({{< relref "/platform/istio/cilium/03-observability/index.md" >}}), 재시도 요구를 비교하려면 [04편]({{< relref "/platform/istio/cilium/04-retry-resilience/index.md" >}})을 보면 됩니다.

선택의 전제부터 검토할 때는 [왜 서비스 메시인가]({{< relref "/platform/istio/fundamentals/14-why-service-mesh/index.md" >}})가 이어집니다. 같은 사이트에서 Linkerd와 Cilium을 비교한 뒤 Istio를 고른 이유는 [왜 Istio였나]({{< relref "/platform/istio/ambient/01-why-ambient-mode/index.md" >}})의 2절에 있습니다. Istio를 유지하면서 ambient로 옮길지를 심사하는 내용은 [Ambient 이행 심사]({{< relref "/platform/istio/ambient/10-ambient-migration-questions.md" >}})에서 따로 다뤘습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 요구별 기울기 | 1~4절과 앞선 편들의 사실을 요구 단위로 재배열 | — | `Σ` |
| Istio 쪽 요구가 남으면 Istio 유지 | 판단 기준 | — | `Σ` |

{{% /details %}}

## 참고 자료

- [VirtualService reference](https://istio.io/latest/docs/reference/config/networking/virtual-service/) — Istio, latest(2026-10-19 확인) `✓`
- [AuthorizationPolicy reference](https://istio.io/latest/docs/reference/config/security/authorization-policy/) — Istio, latest(2026-10-19 확인) `✓`
- [EnvoyFilter reference](https://istio.io/latest/docs/reference/config/networking/envoy-filter/) — Istio, latest(2026-10-19 확인) `✓`
- [Rate limit](https://istio.io/latest/docs/tasks/policy-enforcement/rate-limit/) — Istio, latest(2026-10-19 확인) `✓`
- [Ambient L4 policy](https://istio.io/latest/docs/ambient/usage/l4-policy/) — Istio, latest(2026-10-19 확인) `✓`
- [Ambient platform prerequisites — Cilium](https://istio.io/latest/docs/ambient/install/platform-prerequisites/#cilium) — Istio, latest(2026-10-19 확인) `✓`
- [Layer 7 policy examples](https://docs.cilium.io/en/stable/security/policy/language/#layer-7-examples) — Cilium, stable(2026-10-19 확인) `✓`
- [Layer 7 traffic management](https://docs.cilium.io/en/stable/network/servicemesh/l7-traffic-management/) — Cilium, stable(2026-10-19 확인) `✓`
- [Mutual Authentication](https://docs.cilium.io/en/stable/network/servicemesh/mutual-authentication/mutual-authentication/) — Cilium, stable(2026-10-19 확인) `✓`
- [Transparent Encryption](https://docs.cilium.io/en/stable/security/network/encryption/) — Cilium, stable(2026-10-19 확인) `✓`
- [Istio with Cilium](https://docs.cilium.io/en/stable/network/servicemesh/istio/) — Cilium, stable(2026-10-19 확인) `✓`
- [Gateway API conformance 리포트 — Cilium v1.20.0](https://github.com/kubernetes-sigs/gateway-api/blob/main/conformance/reports/v1.6/cilium/experimental-v1.20.0-default-report.yaml) — Gateway API, 2026-07-31 `✓`
- [Envoy circuit breaker](https://docs.cilium.io/en/stable/network/servicemesh/envoy-circuit-breaker/) — Cilium, stable(2026-10-19 확인) `✓`
- [Ambient L7 features](https://istio.io/latest/docs/ambient/usage/l7-features/) — Istio, latest(2026-10-19 확인) `✓`
- [TrafficExtension API](https://istio.io/latest/blog/2026/traffic-extension-api/) — Istio 블로그, 2026 `✓`
- [Mitigating performance overhead of service meshes (arXiv 2411.02267)](https://arxiv.org/abs/2411.02267) — 2024-11 `✓` 조건 한정
