---
title: "CRD 카탈로그와 연계"
weight: 15
---

# 15 · CRD 카탈로그와 연계 — 14개 리소스가 서로를 참조하는 축

{{< callout type="info" >}}
- 우리 클러스터에 깔린 Istio CRD는 14개, 그룹은 networking · security · telemetry · extensions 넷입니다.
- 리소스는 혼자 동작하지 않습니다. 트래픽 축은 Gateway → VirtualService → DestinationRule → 엔드포인트로 이름과 라벨을 타고 이어집니다. 사슬이 끊기는 곳이 곧 장애 지점입니다.
- 보안 축의 함정 둘: PeerAuthentication(수신)과 DestinationRule `tls`(송신)가 어긋나면 503이 납니다. RequestAuthentication은 토큰 없는 요청을 거부하지 않습니다.
- `Sidecar`·`ProxyConfig`·`Telemetry`는 트래픽 대신 프록시 자체를 조정하는 부류입니다.
- 버전 컬럼에 성숙도가 그대로 적혀 있습니다 — 대부분 `v1`인데 EnvoyFilter만 `v1alpha3`, WasmPlugin은 `v1alpha1`입니다.
{{< /callout >}}

[13]({{< relref "13-istio-envoy-assembly.md" >}})이 다룬 것은 4대 리소스가 Envoy 설정으로 번역되는 경로뿐입니다. 클러스터에 실제로 깔린 CRD는 14개입니다. 사고가 나는 곳은 리소스 하나의 필드보다 리소스와 리소스 사이인 경우가 많습니다 — VirtualService가 부르는 `subset` 이름이 DestinationRule에 없거나, PeerAuthentication과 DestinationRule의 TLS 모드가 어긋나거나, RequestAuthentication만 걸어 두고 인가를 빠뜨리거나. 이 문서는 14개를 사전처럼 나열하는 대신 참조 관계의 축으로 묶습니다.

관련 문서: [13 CRD → Envoy 번역표]({{< relref "13-istio-envoy-assembly.md" >}}) · [07 nginx 지시어 → Istio 리소스]({{< relref "07-from-nginx-to-istio.md" >}}) · [08 표준 CRD의 탈출구]({{< relref "08-envoyfilter-extension.md" >}}) · [04 설정을 코드로]({{< relref "04-config-as-code.md" >}})(아래 짝 맞추기를 리뷰에서 잡는 방법)

## 1. 설치된 14개 — 목록과 소속

`kubectl get crd`가 실제로 보여주는 목록입니다. 130일 전 설치 시점 기준입니다. 아래 버전 컬럼은 그때 배포된 Istio가 서빙하는 API 버전을 그대로 반영합니다.

| 이름 (`kubectl get crd`) | 그룹 | KIND | 버전 |
|---|---|---|---|
| `authorizationpolicies` | `security.istio.io` | `AuthorizationPolicy` | `v1`, `v1beta1` |
| `destinationrules` | `networking.istio.io` | `DestinationRule` | `v1`, `v1alpha3`, `v1beta1` |
| `envoyfilters` | `networking.istio.io` | `EnvoyFilter` | `v1alpha3` |
| `gateways` | `networking.istio.io` | `Gateway` | `v1`, `v1alpha3`, `v1beta1` |
| `peerauthentications` | `security.istio.io` | `PeerAuthentication` | `v1`, `v1beta1` |
| `proxyconfigs` | `networking.istio.io` | `ProxyConfig` | `v1beta1` |
| `requestauthentications` | `security.istio.io` | `RequestAuthentication` | `v1`, `v1beta1` |
| `serviceentries` | `networking.istio.io` | `ServiceEntry` | `v1`, `v1alpha3`, `v1beta1` |
| `sidecars` | `networking.istio.io` | `Sidecar` | `v1`, `v1alpha3`, `v1beta1` |
| `telemetries` | `telemetry.istio.io` | `Telemetry` | `v1`, `v1alpha1` |
| `virtualservices` | `networking.istio.io` | `VirtualService` | `v1`, `v1alpha3`, `v1beta1` |
| `wasmplugins` | `extensions.istio.io` | `WasmPlugin` | `v1alpha1` |
| `workloadentries` | `networking.istio.io` | `WorkloadEntry` | `v1`, `v1alpha3`, `v1beta1` |
| `workloadgroups` | `networking.istio.io` | `WorkloadGroup` | `v1`, `v1alpha3`, `v1beta1` |

그룹으로 세면 networking 9 · security 3 · telemetry 1 · extensions 1입니다. 그룹 이름이 곧 관심사 분리로 읽힙니다. 이렇게 나눈 이유를 밝힌 공식 설계 근거는 istio.io에서 찾지 못했습니다. v1 승격을 알린 2024년 블로그도 네 그룹으로 분류한 표만 제시합니다. 분리의 이유는 서술하지 않습니다. 그러니 그룹 이름은 설계 의도의 증거로 보기 어렵습니다. 찾을 위치의 힌트 정도로만 쓰는 게 안전합니다.

각 CRD의 한 줄 역할과 이 챕터에서 깊이 다루는 곳:

| KIND | 한 줄 역할 | 깊이 |
|---|---|---|
| `Gateway` | 메시 가장자리에서 받을 포트·프로토콜·호스트·TLS | [03]({{< relref "03-gateway-node-isolation.md" >}}) · [07]({{< relref "07-from-nginx-to-istio.md" >}}) |
| `VirtualService` | 매칭 규칙·가중치 분배·재시도·타임아웃 등 라우팅 | [07]({{< relref "07-from-nginx-to-istio.md" >}}) · [13]({{< relref "13-istio-envoy-assembly.md" >}}) |
| `DestinationRule` | 라우팅 이후의 정책 — subset 정의, LB·커넥션 풀·outlier·클라이언트측 TLS | [13]({{< relref "13-istio-envoy-assembly.md" >}}) · [12]({{< relref "12-envoy-capabilities.md" >}}) |
| `ServiceEntry` | 메시 서비스 레지스트리에 외부·미등록 서비스를 추가 | 이 문서 2절 |
| `WorkloadEntry` | VM 같은 비-쿠버네티스 워크로드 하나를 기술 | 이 문서 2절 |
| `WorkloadGroup` | `WorkloadEntry`의 템플릿 | 이 문서 2절 |
| `Sidecar` | 프록시가 받는 설정 범위(포트·프로토콜·egress host) 조정 | [02]({{< relref "02-istiod-control-plane.md" >}}) |
| `ProxyConfig` | 프록시 자체의 파라미터 — concurrency·이미지·환경변수 | 이 문서 4절 |
| `PeerAuthentication` | 워크로드가 **수신**할 mTLS 모드 | [13]({{< relref "13-istio-envoy-assembly.md" >}}) · 이 문서 3절 |
| `RequestAuthentication` | JWT 검증 규칙 | [07]({{< relref "07-from-nginx-to-istio.md" >}}) · 이 문서 3절 |
| `AuthorizationPolicy` | 접근 허용·거부 판정 | [07]({{< relref "07-from-nginx-to-istio.md" >}}) · 이 문서 3절 |
| `Telemetry` | 메트릭·트레이싱·액세스 로그의 생성 방식 조정 | [06]({{< relref "06-observability-points.md" >}}) · [13]({{< relref "13-istio-envoy-assembly.md" >}}) |
| `EnvoyFilter` | istiod가 만든 Envoy 설정을 직접 패치 | [08]({{< relref "08-envoyfilter-extension.md" >}}) · [13]({{< relref "13-istio-envoy-assembly.md" >}}) |
| `WasmPlugin` | WebAssembly 필터로 프록시 기능 확장 | [08]({{< relref "08-envoyfilter-extension.md" >}}) |

## 2. 트래픽 축 — 이름과 라벨로 이어지는 사슬

트래픽 쪽 리소스들은 각자 독립된 설정 조각이 아닙니다. 서로의 이름을 부르는 사슬이어서 따라가면 끝에서 파드 IP 목록에 닿습니다.

{{< flow src="_flow/2-트래픽-축-이름과-라벨로.json" />}}

각 고리를 필드 수준으로 옮기면 이렇습니다.

- Gateway → VirtualService (잇는 필드: VirtualService의 `gateways`) — 근거: "The names of gateways and sidecars that should apply these routes". 어긋나면: 게이트웨이에 규칙이 안 걸리거나 의도치 않게 메시 전체에 걸립니다.
- VirtualService → DestinationRule (잇는 필드: `destination.host` + `subset`) — 근거: "The subset must be defined in a corresponding DestinationRule". 어긋나면: 정의되지 않은 subset을 부르므로 그 경로가 성립하지 않습니다.
- DestinationRule → 엔드포인트 (잇는 필드: subset의 `labels`) — 근거: "Labels apply a filter over the endpoints of a service in the service registry". 어긋나면: subset이 비어 트래픽이 갈 곳이 없습니다.

### `gateways` 필드의 기본값이 함정인 이유

가장 자주 걸리는 곳이 첫 번째 고리입니다. 레퍼런스 원문이 기본 동작을 명시합니다.

> When this field is omitted, the default gateway (`mesh`) will be used, which would apply the rule to all sidecars in the mesh.

`gateways`를 안 쓰면 그 VirtualService는 게이트웨이가 아니라 메시 내부 사이드카 전부에 적용됩니다. `mesh`는 "메시 내 모든 사이드카"를 뜻하는 예약어입니다. 인그레스 라우팅을 짰는데 게이트웨이에서 안 먹는 사례의 상당수가 여기서 나옵니다. 반대로 내부 라우팅 의도로 쓴 규칙이 필드 하나 때문에 전 사이드카로 퍼지기도 합니다. [13]({{< relref "13-istio-envoy-assembly.md" >}})의 진단 순서대로 `istioctl proxy-config route`에 규칙이 안 보이면 이 필드부터 봅니다.

### DestinationRule이 실제로 담는 것

DestinationRule을 "subset 정의용"으로만 아는 경우가 있는데 레퍼런스가 `trafficPolicy` 아래 두는 것이 더 많습니다. `loadBalancer`·`connectionPool`·`outlierDetection`이 [13]({{< relref "13-istio-envoy-assembly.md" >}})이 이미 다룬 "라우팅 이후의 정책"입니다. 여기 `tls`("TLS related settings for connections to the upstream service")가 하나 더 있습니다 — 13은 다루지 않은 필드입니다. `portLevelSettings`·`tunnel`·`proxyProtocol`·`retryBudget` 등도 여기 있습니다. 이 목록은 두 방향으로 이어집니다. 위쪽으로는 [12]({{< relref "12-envoy-capabilities.md" >}})가 소개한 Envoy 기능들을 켜는 스위치입니다. 아래쪽으로 `tls` 한 필드가 3절의 보안 축과 맞물립니다. 같은 리소스가 트래픽 정책을 들고 있습니다. mTLS 클라이언트 동작도 여기서 정합니다. 그래서 보안 축의 짝 맞추기가 자꾸 어긋납니다.

### 레지스트리를 넓히는 셋

나머지 세 리소스는 라우팅 규칙을 정하지 않고 라우팅 대상 자체를 늘립니다.

- ServiceEntry — "enables adding additional entries into Istio's internal service registry, so that auto-discovered services in the mesh can access/route to these manually specified services." 외부 API처럼 메시 밖에 있는 서비스도, VM처럼 플랫폼 레지스트리에 없는 내부 서비스도 대상입니다. 등록된 뒤에는 쿠버네티스 서비스와 똑같이 다뤄집니다. 공식 예시도 ServiceEntry 대상에 DestinationRule로 mTLS를 개시합니다. VirtualService로 SNI 기반 라우팅도 겁니다. 위 사슬은 메시 밖 목적지에도 그대로 적용됩니다.
- WorkloadEntry — "enables operators to describe the properties of a single non-Kubernetes workload such as a VM or a bare metal server as it is onboarded into the mesh."
- WorkloadGroup — 둘의 관계는 공식 문서가 익숙한 비유로 직접 설명합니다. "WorkloadGroup enables specifying the properties of a single workload for bootstrap and provides a template for WorkloadEntry, similar to how Deployment specifies properties of workloads via Pod templates." WorkloadGroup:WorkloadEntry = Deployment:Pod라는 대응이 레퍼런스에 그대로 있습니다.

우리 클러스터는 EKS 위 파드만 다룹니다. 이 셋 중 실제로 쓰는 것은 ServiceEntry뿐입니다. 그래도 WorkloadEntry/WorkloadGroup이 깔려 있으니 메시의 경계가 쿠버네티스 경계와 같아야 할 이유가 없다는 전제는 API 수준에 이미 들어와 있습니다.

## 3. 보안 축 — 짝 맞추기와 2단 관문

security 그룹 3개는 서로 다른 층을 담당합니다. 셋 다 단독으로는 의도한 결과를 못 내고 각각 짝이 따로 있습니다.

### PeerAuthentication ↔ DestinationRule — 수신과 송신은 다른 리소스다

셋 중 가장 헷갈리는 지점입니다. mTLS는 양쪽이 합의해야 성립하는데 Istio에서 그 양쪽을 서로 다른 CRD가 설정합니다. 공식 운영 문서가 역할을 분명히 나눠 놓습니다.

- 수신(서버) — `PeerAuthentication` — 사이드카가 **받아들일** mTLS 트래픽 유형 (`STRICT` / `PERMISSIVE` / `DISABLE`). 원문: "configures what type of mTLS traffic the sidecar will accept".
- 송신(클라이언트) — `DestinationRule` `trafficPolicy.tls` — 사이드카가 **보낼** TLS 트래픽 유형 (`ISTIO_MUTUAL` 등). 원문: "configures what type of TLS traffic the sidecar will send".

두 리소스는 이름도 그룹도 다르고 보통 다른 사람이 다른 PR로 고칩니다. 그래서 어긋납니다. 증상은 공식 문서의 트러블슈팅 항목에 그대로 있습니다.

> If requests to a service immediately start generating HTTP 503 errors after you applied a `DestinationRule`… then the `DestinationRule` is probably causing a TLS conflict.

특히 mTLS가 클러스터 전역으로 켜진 상태에서 DestinationRule에 `trafficPolicy.tls.mode: ISTIO_MUTUAL`을 명시하지 않으면 기본값이 `DISABLE`로 떨어집니다. 클라이언트는 평문을 보내는데 서버는 암호화를 기대하니 503이 납니다. 가이드의 처방은 한 문장입니다 — "ensure the `trafficPolicy` TLS mode matches the global server configuration."

{{< callout type="important" >}}
**리뷰에서 잡을 규칙.** DestinationRule에 `trafficPolicy`를 새로 추가하는 PR은 전역 mTLS 설정과 맞는지 확인해야 합니다. `tls` 필드를 건드리지 않았어도 마찬가지입니다. 기본값이 `DISABLE`이라 "TLS를 안 건드렸으니 안전하다"가 성립하지 않기 때문입니다. [04]({{< relref "04-config-as-code.md" >}})의 GitOps 리뷰 체크리스트에 넣기 좋은 항목입니다. 배포 직후 503이 즉시 뜨는 형태라 [05]({{< relref "05-incident-intermittent-5xx.md" >}})의 간헐적 5xx와는 증상 모양이 다릅니다.
{{< /callout >}}

### RequestAuthentication → AuthorizationPolicy — 토큰이 없는 요청은 거부되지 않는다

두 번째 함정은 겉으로 드러나지 않습니다. RequestAuthentication을 걸면 JWT 검증이 켜지니 인증이 끝났다고 생각하기 쉬운데 레퍼런스가 정반대를 말합니다.

> A request that does not contain any authentication credentials will be accepted but will not have any authenticated identity.

거부되는 것은 **잘못된** 자격증명을 담은 요청뿐입니다 — "will reject a request if the request contains invalid authentication information, based on the configured authentication rules". 아예 토큰이 없으면 그냥 통과합니다. 그래서 같은 페이지가 짝을 요구합니다.

> To restrict access to authenticated requests only, this should be accompanied by an authorization rule.

실제 공식 예제도 RequestAuthentication에 `requestPrincipals: ["*"]`를 쓰는 AuthorizationPolicy를 반드시 붙입니다. [07]({{< relref "07-from-nginx-to-istio.md" >}})의 JWT yaml 예제가 그 실무형입니다. RequestAuthentication은 "토큰이 있다면 검증한다"까지입니다. "토큰을 요구한다"는 AuthorizationPolicy의 몫입니다.

{{< flow src="_flow/requestauthentication-authorizationpolicy-토큰이-없는.json" />}}

### AuthorizationPolicy의 평가 순서와 기본 동작

두 번째 관문의 내부 규칙은 계층으로 정의돼 있습니다.

> Istio checks for matching policies in layers, in this order: **CUSTOM, DENY, and then ALLOW.**

레퍼런스는 알고리즘을 더 정밀하게 적습니다 — 매치되는 CUSTOM 정책이 있으면 평가해서 deny면 거부, 매치되는 DENY 정책이 있으면 거부, 그다음 "If there are no ALLOW policies for the workload, allow the request. If any of the ALLOW policies match the request, allow the request. Deny the request."

운영에서 걸리는 대목은 여기서 나오는 기본 동작입니다.

- 정책이 하나도 없음 → 매치 안 되는 요청은 허용. 원문: "For workloads without authorization policies applied, Istio allows all requests."
- ALLOW 정책이 하나라도 있음 → 매치 안 되는 요청은 거부. 원문: "the 'deny by default' behavior applies only if the workload has at least one authorization policy with the ALLOW action."

ALLOW 정책 하나를 추가하는 순간, 그 워크로드의 기본 동작이 전면 허용에서 전면 거부로 뒤집힙니다. 정책 하나를 좁게 넣었다고 생각하기 쉽습니다. 거기서 커버하지 못한 다른 경로가 전부 막힙니다. 첫 ALLOW 정책을 넣는 PR은 "무엇을 허용하나"가 아니라 "이 워크로드로 오는 경로를 전부 열거했나"로 리뷰해야 합니다.

정책 본문 구조는 `from`·`to`·`when` 셋입니다. 각각 "If not set, any source/operation/condition is allowed"로 비지정 = 전부 허용입니다. TCP 트래픽에 걸린 정책에서는 `method` 같은 HTTP 속성이 처리되지 않습니다. DENY 규칙에서는 누락된 속성을 매치로 간주한다는 L4/L7 경계 서술도 따로 있습니다. L4 대상 정책은 별도로 확인해야 합니다. (ambient의 ztunnel에서 이 처리가 어떻게 달라지는지는 확인하지 못했습니다 — [10]({{< relref "10-ambient-migration-questions.md" >}})의 재심사 항목으로 남깁니다.)

## 4. 스코프·튜닝 축 — 프록시 자체를 조정하는 셋

`Sidecar`·`ProxyConfig`·`Telemetry`는 그룹이 셋 다 다르지만(networking·networking·telemetry) 성격은 같습니다. 요청이 어디로 가는지를 바꾸지 않고 프록시가 무엇을 들고 어떻게 동작하는지를 바꿉니다. 2절의 사슬 어디에도 끼지 않는 대신, 사슬 전체가 딛고 도는 바닥을 건드립니다.

| 리소스 | 조정 대상 | 계층 규칙 |
|---|---|---|
| `Sidecar` | 프록시가 받는 설정 범위(포트·프로토콜·egress host) | 네임스페이스 단위 `default` + 워크로드 셀렉터 |
| `ProxyConfig` | 프록시 파라미터 — `concurrency`, `image`, `environmentVariables` | CR이 어노테이션·메시 전역 설정을 덮어씀 |
| `Telemetry` | 메트릭·트레이싱·액세스 로그의 생성 방식 | 워크로드 > 네임스페이스 > 루트 네임스페이스 |

### Sidecar — 설정 범위 축소이지 트래픽 차단이 아니다

[02]({{< relref "02-istiod-control-plane.md" >}})가 istiod 부하를 줄이는 가장 큰 레버로 이미 다룬 그 리소스입니다 — egress 쪽 목적은 레퍼런스에 "to limit the set of configuration for outbound traffic… useful to prune out unneeded configuration, to improve scalability of the mesh"로 적혀 있습니다. 02가 다루지 않은 것은 이 "범위 제한"의 정체입니다.

{{< callout type="important" >}}
egress host 목록은 보안 경계가 아닙니다. 공식 문서가 이 오해를 직접 경고합니다 — "A common misunderstanding is that restricting the configuration amounts to blocking the traffic… The sidecar is not able to enforce an outbound traffic restriction." 02에서 `egress.hosts`로 범위를 좁힌 것은 istiod의 push 계산량과 프록시 메모리를 줄인 것이지 목록 밖으로 나가는 트래픽을 막은 것이 아닙니다. 아웃바운드를 실제로 통제하려면 인가 정책이나 네트워크 계층의 별도 수단이 필요합니다.
{{< /callout >}}

### ProxyConfig — 어노테이션과 메시 전역 설정 사이

ProxyConfig는 트래픽 대신 프록시 프로세스를 다룹니다. `concurrency`("The number of worker threads to run. If unset, this will be automatically determined based on CPU limits."), `image`(default/debug/distroless), `environmentVariables`("Names starting with `ISTIO_META_` will be included in the generated bootstrap configuration.") 같은 것들입니다.

같은 값을 정할 수 있는 통로가 여럿이라 병합 규칙이 중요합니다. 레퍼런스가 규칙 두 개를 줍니다.

- 워크로드에 매치되는 ProxyConfig CR이 있으면 그 워크로드의 `proxy.istio.io/config` 어노테이션과 병합됩니다. 겹치는 필드는 CR이 이깁니다 — "with the CR taking precedence over the annotation for overlapping fields."
- 메시 전역 ProxyConfig CR과 `meshConfig.defaultConfig`가 함께 있으면 "the two resources will be merged with the CR taking precedence for overlapping fields."

두 규칙을 겹치면 워크로드별 CR > 어노테이션 > 메시 전역 CR/`meshConfig.defaultConfig` 순으로 읽힙니다. 이 순서를 한 줄로 나열한 원문 문장은 확인하지 못했습니다(두 병합 규칙을 조합한 추론입니다). `concurrency`처럼 성능에 직결되는 값을 여러 통로로 설정 중이라면 순서를 믿지 마십시오. 프록시에 실제 반영된 값을 확인하는 편이 낫습니다.

### Telemetry — 계층이 명시된 유일한 리소스

[06]({{< relref "06-observability-points.md" >}})의 카디널리티 정리에서 실제로 쓰는 창구입니다. 적용 계층이 원문에 번호까지 붙어 있습니다.

> The hierarchy of Telemetry configuration is as follows: 1. Workload-specific configuration 2. Namespace-specific configuration 3. Root namespace configuration.

제약도 원문에 그대로 적혀 있습니다 — "For any namespace, including the root configuration namespace, it is only valid to have a single workload selector-less Telemetry resource." 네임스페이스마다 셀렉터 없는 Telemetry는 하나뿐입니다. 워크로드 단위도 마찬가지입니다. 팀별로 Telemetry를 각자 두는 구조는 성립하지 않습니다. 네임스페이스 단위 소유권을 먼저 정해야 합니다. 병합은 명시하지 않은 값이 상위에서 채워지는 방식입니다. `custom_tags`처럼 지정하면 상위 값을 통째로 대체하는 필드도 있습니다.

## 5. 확장 축 — 두 계층의 나머지 절반

`EnvoyFilter`와 `WasmPlugin`은 [13]({{< relref "13-istio-envoy-assembly.md" >}})이 그린 두 계층 중 사용자 확장 쪽입니다. 왜 최후의 수단으로 다뤄야 하는지는 [08]({{< relref "08-envoyfilter-extension.md" >}})에 이미 있습니다. 선택 사다리(표준 CRD → 상위 API → EnvoyFilter)도 거기 있습니다. 여기서는 그 판단에 보탤 사실 둘만 봅니다.

- EnvoyFilter 충돌은 우선순위 문제가 아니라 미정의 상태입니다. 여러 EnvoyFilter가 겹치면 "The behavior is undefined if multiple EnvoyFilter configurations conflict with each other" — [08]이 말한 "업그레이드에 깨진다"보다 한 단계 나쁩니다. 순서를 조정해서 피할 수 있는 문제가 아닙니다.
- WasmPlugin의 `phase`는 3절의 관문을 좌표계로 씁니다. `AUTHN`("Insert plugin before Istio authentication filters"), `AUTHZ`("before Istio authorization filters and after Istio authentication filters"), `STATS`("before Istio stats filters and after Istio authorization filters"), `UNSPECIFIED_PHASE`("Control plane decides where to insert the plugin. This will generally be at the end of the filter chain, right before the Router."). [08]이 WasmPlugin을 "더 안전한 상위 추상화"로 권한 근거가 여기서 확인됩니다. 삽입 위치를 필터 이름이 아니라 보안 관문 이름으로 지정할 수 있습니다.

WasmPlugin을 "EnvoyFilter를 안 쓰고 필터를 넣는 상위 API"로 소개하는 경우가 많은데 레퍼런스 페이지 자체는 그렇게 위치 짓지 않습니다. 거기 적힌 것은 "Extend the functionality provided by the Istio proxy through WebAssembly filters"뿐입니다. 그 위치 부여는 [08]({{< relref "08-envoyfilter-extension.md" >}})의 운영 판단입니다. 그 순서를 명시한 공식 문장은 이 조사에서는 찾지 못했습니다.

## 6. 버전 컬럼이 말하는 것

1절 표의 버전 컬럼을 다시 보면 성숙도가 그대로 드러납니다.

| 버전 상태 | CRD | 읽는 법 |
|---|---|---|
| `v1` 포함 (11개) | 1절 표 참고 — Gateway·VirtualService·DestinationRule 등 14개 중 11개 | API 계약이 안정화됐다 |
| `v1beta1`만 | ProxyConfig | 아직 승격 전 |
| `v1alpha3`만 | **EnvoyFilter** | 승격 대상이 아니다 |
| `v1alpha1`만 | **WasmPlugin** | 확장 API는 아직 초기 |

EnvoyFilter가 특히 도드라집니다. 같은 `networking.istio.io` 그룹의 다른 리소스가 전부 `v1`로 올라간 동안 혼자 `v1alpha3`에 남았습니다. 이건 방치라기보다 계약의 성격 자체가 다르다고 읽는 게 맞습니다. 레퍼런스가 그 이유를 직접 말합니다.

> Some aspects of this API are deeply tied to the internal implementation in Istio networking subsystem as well as Envoy's XDS API. While the EnvoyFilter API by itself will maintain backward compatibility, any envoy configuration provided through this mechanism should be carefully monitored across Istio proxy version upgrades, to ensure that deprecated fields are removed and replaced appropriately.

API 껍데기는 호환을 지키지만 그 안에 넣는 Envoy 설정은 호환 대상이 아닙니다. [08]({{< relref "08-envoyfilter-extension.md" >}})이 EnvoyFilter를 "탈출구"이자 "최후의 수단"으로 부른 근거가 여기서 버전 문자열로 확인됩니다. [13]({{< relref "13-istio-envoy-assembly.md" >}})의 결론과도 맞물립니다. 사이드카 이미지 업그레이드는 곧 Envoy 업그레이드입니다. EnvoyFilter가 결합된 대상은 그 pin된 Envoy 커밋의 스키마입니다. 안정 버전을 서빙하는 CRD 옆에 알파 버전 CRD가 하나 있다면 업그레이드 리스크가 그쪽에 몰려 있다고 보면 됩니다.

## 이 문서에서 가져갈 것

- CRD는 독립된 설정 조각이 아닙니다. 트래픽 축은 `gateways` 이름 → `host`+`subset` 이름 → 라벨 필터로 이어집니다. 어느 고리가 끊겼는지가 곧 진단 순서입니다.
- mTLS의 수신과 송신은 다른 리소스가 정합니다. PeerAuthentication은 받을 것을, DestinationRule `tls`는 보낼 것을 정하며 어긋나면 배포 직후 503으로 나타납니다. `tls`를 명시하지 않으면 기본값이 `DISABLE`입니다.
- RequestAuthentication은 토큰을 요구하지 않습니다. 없는 토큰은 통과시키고 요구하는 것은 AuthorizationPolicy의 몫입니다. 그리고 ALLOW 정책 하나가 그 워크로드의 기본 동작을 deny-by-default로 뒤집습니다.
- `Sidecar`·`ProxyConfig`·`Telemetry`는 트래픽이 아니라 프록시를 조정합니다. 특히 `Sidecar`의 egress 목록은 설정 범위 축소이지 트래픽 차단이 아닙니다.
- 버전 컬럼이 업그레이드 리스크의 지도입니다. EnvoyFilter만 `v1alpha3`, WasmPlugin은 `v1alpha1` — API 호환과 그 안의 Envoy 설정 호환은 별개입니다.

## 소스

- Istio 공식 레퍼런스 — **VirtualService** (`gateways` 기본값 `mesh`, `subset`은 "must be defined in a corresponding DestinationRule"): <https://istio.io/latest/docs/reference/config/networking/virtual-service/>
- Istio 공식 레퍼런스 — **DestinationRule** (Subset의 `labels`가 "filter over the endpoints… in the service registry", `trafficPolicy`의 loadBalancer·connectionPool·outlierDetection·tls): <https://istio.io/latest/docs/reference/config/networking/destination-rule/>
- Istio 공식 레퍼런스 — **ServiceEntry** (내부 서비스 레지스트리에 항목 추가, 등록 대상에 VirtualService·DestinationRule 적용 예시): <https://istio.io/latest/docs/reference/config/networking/service-entry/>
- Istio 공식 레퍼런스 — **WorkloadGroup** ("provides a template for WorkloadEntry, similar to how Deployment specifies properties of workloads via Pod templates"): <https://istio.io/latest/docs/reference/config/networking/workload-group/>
- Istio 공식 레퍼런스 — **Sidecar** ("fine tune the set of ports, protocols", "The sidecar is not able to enforce an outbound traffic restriction"): <https://istio.io/latest/docs/reference/config/networking/sidecar/>
- Istio 공식 레퍼런스 — **ProxyConfig** (`concurrency`·`image`·`environmentVariables`, CR이 어노테이션·`meshConfig.defaultConfig`보다 우선): <https://istio.io/latest/docs/reference/config/networking/proxy-config/>
- Istio 공식 레퍼런스 — **EnvoyFilter** (`v1alpha3` 유지, "could potentially destabilize the entire mesh", 충돌 시 "behavior is undefined"): <https://istio.io/latest/docs/reference/config/networking/envoy-filter/>
- Istio 공식 레퍼런스 — **PeerAuthentication** (워크로드에 강제되는 mutual TLS 모드): <https://istio.io/latest/docs/reference/config/security/peer_authentication/>
- Istio 공식 레퍼런스 — **RequestAuthentication** ("A request that does not contain any authentication credentials will be accepted…", "should be accompanied by an authorization rule"): <https://istio.io/latest/docs/reference/config/security/request_authentication/>
- Istio 공식 레퍼런스 — **AuthorizationPolicy** (평가 알고리즘, `from`/`to`/`when`의 비지정 시 동작): <https://istio.io/latest/docs/reference/config/security/authorization-policy/>
- Istio 공식 문서 — **Security concepts** ("Istio checks for matching policies in layers, in this order: CUSTOM, DENY, and then ALLOW", deny-by-default 조건): <https://istio.io/latest/docs/concepts/security/>
- Istio 공식 레퍼런스 — **Telemetry** (워크로드 > 네임스페이스 > 루트 네임스페이스 계층, 셀렉터 없는 리소스는 네임스페이스당 하나): <https://istio.io/latest/docs/reference/config/telemetry/>
- Istio 공식 레퍼런스 — **WasmPlugin** (`phase`의 AUTHN/AUTHZ/STATS/UNSPECIFIED_PHASE 정의): <https://istio.io/latest/docs/reference/config/proxy_extensions/wasm-plugin/>
- Istio 공식 문서 — **Mutual TLS configuration**(PeerAuthentication은 accept, DestinationRule은 send) · **Network problems**("If requests… immediately start generating HTTP 503 errors after you applied a DestinationRule"): <https://istio.io/latest/docs/ops/configuration/traffic-management/tls-configuration/> · <https://istio.io/latest/docs/ops/common-problems/network-issues/#tls-configuration-mistakes>
- Istio 블로그 — **Introducing Istio v1 APIs** (networking/security/telemetry/extension 그룹 분류표. 분리의 설계 근거는 서술되지 않음): <https://istio.io/latest/blog/2024/v1-apis/>
- 위 버전 컬럼은 우리 클러스터의 `kubectl get crd` 출력(설치 후 130일 시점) 기준입니다. 업스트림의 최신 승격 상태와 다를 수 있으므로 판단이 필요하면 클러스터에서 다시 확인할 것.
