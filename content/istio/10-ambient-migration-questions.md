---
title: "Ambient 이행 심사"
weight: 10
---

# 10 · Ambient 이행 심사 — 01~09를 다시 심사한다면 무엇이 무효가 되나

{{< callout type="info" >}}
- 하위 섹션 [Ambient mode 도입기]({{< relref "ambient/_index.md" >}})는 사이드카를 아예 거치지 않은 팀의 기록이라 **버리고 오는 쪽의 비용**이 빠져 있습니다. 이 문서가 그 칸을 우리 01~09에 되물어 채웁니다.
- 가장 확실하게 무효가 되는 자산은 **EnvoyFilter**(08)입니다. ztunnel은 Envoy가 아니고 waypoint는 Envoy지만 EnvoyFilter가 공식 미지원·비권장입니다.
- 02의 가장 큰 레버였던 `Sidecar` 리소스는 waypoint의 destination 지향 스코프로 **대체**됩니다. 레버 자체는 남고 손잡이 모양만 바뀝니다.
- 06의 대시보드는 메트릭 **이름은 살고 `reporter` 라벨이 달라집니다.** waypoint가 없는 구간에서는 HTTP 메트릭 자체가 나오지 않습니다.
- **L7 정책이 걸린 워크로드에는 무중단 마이그레이션 경로가 없다**고 공식 가이드가 명시합니다. 이 문장 하나가 전환 대상 선정 기준을 거의 다 정합니다.
{{< /callout >}}

전제는 이렇습니다. 우리 01~09(Sidecar mode 운영기)를 읽었고 하위 섹션 [Ambient mode 도입기]({{< relref "ambient/_index.md" >}})(채널코퍼레이션의 그린필드 도입 기록)도 읽었습니다. 이 문서가 다루는 것은 그 둘 사이에 빠진 칸 하나뿐입니다 — **이미 사이드카를 운영 중인 팀이 Ambient로 넘어갈 때 다시 심사해야 할 것**. 결론 대신 질문을 세는 문서입니다. 각 절은 `무엇이 바뀌나` → `우리가 심사할 것` → `열린 질문` 순으로 갑니다.

근거 등급은 구분해서 적었습니다. 표와 본문에서 **(추론)**이라 표시한 것은 공식 문서가 그 문장으로 직접 진술하지 않았고 확인된 사실에서 우리가 끌어낸 것입니다. 열린 질문은 결함으로 읽을 것이 아닙니다. 답이 없다는 사실 자체가 이행 계획의 입력입니다.

> 관련 문서: [02 컨트롤 플레인]({{< relref "02-istiod-control-plane.md" >}}) · [03 게이트웨이 격리]({{< relref "03-gateway-node-isolation.md" >}}) · [06 관측성]({{< relref "06-observability-points.md" >}}) · [07 nginx에서 Istio로]({{< relref "07-from-nginx-to-istio.md" >}}) · [08 EnvoyFilter]({{< relref "08-envoyfilter-extension.md" >}}) · [09 istiod 스케일링]({{< relref "09-istiod-scaling-connections.md" >}})

## 08 · 확장 자산 — EnvoyFilter는 어디까지 무효인가

**무엇이 바뀌나.** [08]({{< relref "08-envoyfilter-extension.md" >}})에서 EnvoyFilter는 "최후의 수단이지만 열려 있는 문"이었습니다. Ambient에서는 그 문이 두 프록시 모두에서 닫힙니다.

**EnvoyFilter**
- 사이드카 모드(08): 최후의 수단으로 사용 가능
- ztunnel: **적용 불가** — Rust로 새로 쓴 프록시라 Envoy 필터 모델 자체가 없습니다
- waypoint: **공식 미지원·비권장** — "제한된 시나리오에서 가능할 수도 있으나 지원되지 않으며 메인테이너가 적극적으로 만류합니다"

**WasmPlugin**
- 사이드카 모드(08): 상위 API로 권장
- ztunnel: 해당 없음
- waypoint: 지원(Feature Status **Alpha**, `targetRefs`로 부착)

**TrafficExtension**
- 사이드카 모드(08): —
- ztunnel: 해당 없음
- waypoint: 1.30에서 도입된 새 1차 확장 메커니즘. 기존 WasmPlugin과 완전 호환이고 1.30에서 강제 마이그레이션은 없습니다

**local/global rate limit**
- 사이드카 모드(08): EnvoyFilter (08의 플래그십 사례)
- ztunnel: 해당 없음
- waypoint: **공식 지원 경로를 확인하지 못함**

ztunnel이 EnvoyFilter를 못 받는 것은 방침의 문제가 아니라 구조의 문제입니다. 공식 블로그는 ztunnel을 Rust로 새로 쓴 배경을 설명하며 Envoy의 리치 L7 기능과 확장성이 ztunnel에서는 쓸모없이 남는다("went to waste in ztunnel")고 밝혔습니다. ambient L7 기능 문서도 EnvoyFilter가 "데이터 플레인이 Envoy가 아닌 곳으로는 이식될 수 없다"는 취지를 그대로 적습니다.

**우리가 심사할 것.**

- `kubectl get envoyfilter -A`로 전수 목록을 뽑고 각각을 세 갈래로 분류합니다 — (a) 사실은 표준 CRD로 되는 것, (b) WasmPlugin 또는 TrafficExtension으로 옮길 수 있는 것, (c) 옮길 데가 없는 것.
- 08의 플래그십 사례인 레이트 리밋이 현재로선 (c)에 들어갈 공산이 큽니다. (c)로 판정된 워크로드는 **waypoint 뒤로 옮기지 못하거나 사이드카로 남겨야 합니다.** 이행 계획의 첫 제약이 여기서 나옵니다.
- WasmPlugin이 Alpha라는 등급을 우리 프로덕션 기준으로 받아들일 수 있는지. 1.30 기준으로 TrafficExtension이 권장 경로로 병존하므로 지금 WasmPlugin으로 옮기면 두 번 옮기게 될 가능성을 감수해야 합니다.
- 우리 EnvoyFilter 중 istiod가 만든 설정을 패치하던 것들은 Ambient에서 같은 결과가 **정식 경로로 이미 조립되어 내려오는지** 먼저 확인합니다 — 채널팀이 [02 Envoy config 해부]({{< relref "ambient/02-envoy-config-anatomy.md" >}})에서 뜯어본 것이 그 조립 결과물입니다.

**열린 질문.**

- waypoint에서 local/global rate limit을 구성하는 공식 지원 경로(문서화된 EnvoyFilter 예외, WasmPlugin·TrafficExtension 기반 필터, 로드맵)가 있는가. 공식 rate limit 태스크 문서는 EnvoyFilter 전제로만 쓰여 있고 ambient·waypoint를 전혀 언급하지 않습니다. 커뮤니티 논의(discussion #55011, issue #54391)는 있으나 공식 근거는 못 찾았습니다.
- "제한된 시나리오에서는 EnvoyFilter가 waypoint에 가능할 수도 있다"는 문장이 가리키는 시나리오가 구체적으로 무엇인가. 공식 문서에 세부 설명이 없습니다.
- TrafficExtension이 Alpha를 벗는 목표 버전, 그리고 EnvoyFilter의 waypoint 공식 지원 로드맵 시점.
- EnvoyFilter로 삽입하던 Lua 필터의 Ambient 대체 경로는 이번 조사 재료에 없습니다.

## 02 · 스코핑 레버 — `Sidecar` 리소스가 사라진 자리

**무엇이 바뀌나.** [02]({{< relref "02-istiod-control-plane.md" >}})가 내린 결론은 "CPU 증설은 응급 처치이고, 진짜 해법은 `Sidecar` 리소스로 설정 범위를 좁히는 것"이었습니다. Ambient는 그 레버를 없애는 대신 기본 스코프 자체를 좁힙니다.

- 기본값에서 프록시는 메시 전체 설정을 받는다 → ztunnel은 Envoy의 Cluster/Listener 타입을 쓰지 않고 `Address`·`Authorization` 두 커스텀 xDS 리소스만 받습니다. (확인됨)
- 프록시당 설정 크기가 push 비용의 한 항 → 커스텀 타입이 Envoy 타입 대비 크기·할당·CPU에서 "10x edge"라고 설계 문서가 명시. (확인됨)
- `Sidecar` 리소스로 범위를 좁힌다 → waypoint는 namespace 또는 service·pod 단위로 공유되어 스코프가 자연히 좁습니다. (확인됨)
- `Sidecar` 리소스가 데이터 플레인 전체에 적용됩니다 → ztunnel에는 애초에 적용될 자리가 없습니다 **(추론)** — 공식 `Sidecar` CRD 레퍼런스는 ambient·ztunnel·waypoint를 한 번도 언급하지 않습니다. (부분 확인)

공식 블로그가 여기에 가장 가깝게 한 진술은 "오늘날 사용자가 `exportTo`나 `Sidecar` API를 조심스럽게 써서 얻는 개선을 ambient 모드에서는 더 이상 필요로 하지 않는다"입니다. "적용되지 않는다"는 금지 규정이 아닙니다. "필요 없어진다"는 취지입니다. 이 구분은 우리 실무에서 중요합니다 — 남겨둔 `Sidecar` 리소스가 무해한지 유해한지가 여기서 결정되는데, 그 답이 공식 문서에 없습니다.

**우리가 심사할 것.**

- 02에서 우리가 만들어 관리하던 `Sidecar` 리소스 목록을 뽑고 각 네임스페이스가 ambient로 넘어갈 때 그 리소스를 지울지 남길지 정합니다. 혼재 기간에는 사이드카 워크로드가 남아 있으므로 **두 스코핑 모델을 동시에 운영**하게 됩니다.
- 우리가 `Sidecar`로 얻은 설정 범위 축소 효과가 waypoint 기본 스코프로 자동 재현되는지, 아니면 waypoint별로 다시 좁혀야 하는지. 재현된다면 02의 "가장 큰 레버"는 이행과 함께 손이 덜 가는 쪽으로 바뀝니다.
- 02의 두 번째 레버(디바운스, `discoverySelectors`)는 istiod 쪽 손잡이라 데이터 플레인 모드와 무관해 보이지만 이번 재료로는 확인하지 못했습니다. 이행 전에 실제로 확인할 것.
- 채널팀이 [01 왜 Ambient mode인가]({{< relref "ambient/01-why-ambient-mode.md" >}})에서 든 polynomial scaling problem은 우리 02의 "곱의 세 항"과 같은 얘기를 분모 쪽에서 본 것입니다. 우리 클러스터의 세 항 중 어느 항이 실제로 큰지 먼저 재고 넘어갈 것.

**열린 질문.**

- `Sidecar` CRD를 waypoint에 적용하려 하면 무시되는지, 애초에 waypoint가 그 리소스를 조회하지 않는 구조인지 — 명시적 아키텍처 문장을 못 찾았습니다.
- 'WDS(Workload Discovery Service)'라는 명칭이 1.30 공식 문서·API 레퍼런스의 공식 용어인지, 커뮤니티·코드베이스에서만 쓰이는 비공식 명칭인지. 공식 문서는 `Address`·`Authorization` 커스텀 xDS 리소스라고만 부릅니다.
- 2023년 블로그의 destination 지향 waypoint 서술이 1.30에서도 그대로 유효한지, Gateway API 통합이 깊어지며 세부가 달라졌는지.

## 09 · 커넥션 산수 — 분모가 바뀌면 우리 계산은 어디까지 살아남나

**무엇이 바뀌나.** [09]({{< relref "09-istiod-scaling-connections.md" >}})는 "커넥션 하나의 무게는 고정이 아니다"와 "재분배는 없다"를 말했습니다. Ambient는 앞쪽을 흔들고 뒤쪽은 그대로 둡니다.

- 프록시 수 = 파드 수 → ztunnel은 노드당 1개("한 노드를 공유하는 어떤 파드든 대신해 L4 데이터 플레인을 구현한다"), waypoint는 namespace·service 단위 공유. (확인됨)
- xDS 커넥션 수도 파드 수 비례 → 노드 수 + waypoint 수 비례 **(추론)** — 토폴로지는 확인되나 "커넥션 수"라는 표현으로 비교한 공식 문장은 없습니다. (부분 확인)
- 커넥션당 단가 = 클러스터 config 크기 → ztunnel은 단순화된 리소스 셋을 받아 "성능이 개선된다"고 공식 문서가 명시. (확인됨)
- 장수 gRPC라 재분배되지 않습니다 → 성질 자체는 그대로 — ztunnel도 xDS API로 istiod와 통신합니다. (확인됨)
- `keepaliveMaxServerConnectionAge`가 유일한 재분배 손잡이 → 커넥션 총량과 단가가 함께 줄면 이 손잡이의 필요 강도가 달라진다 **(추론)**. (추론)
- GOMAXPROCS·CFS 사슬(§8) → istiod 쪽 문제라 그대로 유효. (무효 아님)

**우리가 심사할 것.**

- 09에서 우리가 세운 임계값은 전부 "커넥션 수 × 커넥션당 config 크기"라는 곱 위에 있었습니다. 두 항이 동시에 줄면 **KEDA 트리거와 keepalive 주기를 다시 계산**해야 합니다. 특히 15분 keepalive가 계속 필요한지.
- 혼재 기간에는 istiod가 사이드카용 Envoy xDS와 ztunnel용 커스텀 xDS를 동시에 계산합니다. `pilot_xds` 하나로 두 종류를 세는 오토스케일링은 **단가가 다른 것을 같은 단위로 세는** 구조가 됩니다. 카운터를 프록시 종류별로 쪼갤 수 있는지 확인할 것.
- ztunnel이 DaemonSet이라는 사실은 09의 keepalive 손잡이와 [03-3 업그레이드 런북]({{< relref "ambient/03-3-ambient-upgrade-in-place.md" >}})의 node pool blue-green이 같은 일(강제 재연결)을 한다는 뜻입니다. 두 개가 겹치는 창을 피하는 운영 규칙이 필요합니다.
- 09가 다룬 "재분배 없음"의 반대편 증상, 곧 한 번 끊긴 스트림이 스스로 낫지 않는 문제는 채널팀이 [03-4 507과 istiod disconnected]({{< relref "ambient/03-4-507-istiod-disconnected.md" >}})에서 탐지 문제로 만났습니다. 우리 readinessProbe·알럿을 그 기준으로 다시 볼 것.

**열린 질문.**

- istiod가 실제로 처리하는 xDS 커넥션·스트림 개수를 sidecar 모드 대비 ambient 모드에서 정량 비교한 공식 벤치마크나 문장이 있는가. Performance and Scalability 문서 쪽에 있을 수 있으나 이번 조사에서는 확인하지 못했습니다.
- 혼재 기간의 istiod 부하가 두 모드의 단순 합인지, 계산 경로가 나뉘며 추가 비용이 붙는지.

## 06 · 관측성 — 대시보드가 어디까지 살아남나

**무엇이 바뀌나.** [06]({{< relref "06-observability-points.md" >}})은 "관측 지점이 이미 트래픽 경로에 있어서 공짜"라고 적었습니다. Ambient에서는 관측 지점이 둘로 나뉘고 둘이 보는 계층이 다릅니다.

**HTTP 골든 시그널** (`istio_requests_total` 등)
- 사이드카 모드(06): 모든 파드에서
- ztunnel만 있을 때: **나오지 않습니다**
- waypoint가 있을 때: 나옵니다

**L4 메트릭**
- 사이드카 모드(06): 함께 나옴
- ztunnel만 있을 때: `istio_tcp_sent_bytes_total`·`istio_tcp_received_bytes_total` 등 표준 TCP 메트릭 전체
- waypoint가 있을 때: —

**트레이싱**
- 사이드카 모드(06): 사이드카가 스팬 생성(헤더 전파는 앱 몫)
- ztunnel만 있을 때: L7 기능이 없어 waypoint가 필요합니다
- waypoint가 있을 때: 참여

**액세스 로그**
- 사이드카 모드(06): Envoy access log
- ztunnel만 있을 때: 연결 단위 로그를 ztunnel 파드 로그로 조회(`src.addr`·`dst.addr`·`src.workload`·`direction`·`bytes`)
- waypoint가 있을 때: HTTP 요청 단위, Telemetry API(envoy provider)

**`reporter` 라벨**
- 사이드카 모드(06): `source` / `destination`
- ztunnel만 있을 때: —
- waypoint가 있을 때: **`waypoint`** — 공식 메트릭 레퍼런스에 아직 문서화되지 않았고 istio/istio#51313으로 추적 중

공식 waypoint 문서는 "HTTP metrics, access logging, tracing"을 **waypoint가 있어야 되는 L7 기능**으로 규정합니다. Ambient에서 관측성은 더 이상 공짜가 아닙니다. waypoint를 세울지 말지를 먼저 정해야 얻습니다.

**우리가 심사할 것.**

- 우리 대시보드·알럿 중 `istio_requests_total` 계열에 의존하는 것을 전수로 뽑습니다. 그 목록이 곧 **waypoint를 세워야 하는 서비스 목록**입니다. 06이 "공짜"라 부른 것에 이제 배치 비용이 붙습니다.
- `reporter="destination"` 또는 `reporter="source"`로 필터하는 쿼리를 전수 검사합니다. waypoint가 보고하는 트래픽을 **놓치거나 이중 계산**할 수 있고 공식 문서·대시보드가 아직 이 값에 맞춰 갱신되지 않았습니다.
- 06이 경고한 카디널리티 예산을 다시 계산합니다. `reporter` 값이 하나 늘고 프록시 종류가 둘로 나뉘면 시계열 수가 어떻게 변하는지.
- 로그 파이프라인의 파서. ztunnel의 연결 단위 로그는 Envoy access log 포맷이 아니므로 [로깅 챕터]({{< relref "../logging/_index.md" >}}) 쪽 수집·파싱 규칙이 수정 대상입니다.
- 채널팀이 [03-1 503과 Half-open Connection]({{< relref "ambient/03-1-503-half-open-connection.md" >}})에서 겪은 것처럼, 게이트웨이 로그에 `via_upstream`만 남고 실제 원인은 waypoint 로그에 있는 상황이 생깁니다. 05의 hop 좁히기 순서를 그 전제로 다시 쓸 것.

**열린 질문.**

- waypoint의 access log를 Telemetry API로 설정하는 절차를 다루는 **ambient 전용 공식 페이지**를 찾지 못했습니다. 사이드카용 Telemetry API 로그 문서는 ambient·ztunnel·waypoint를 전혀 언급하지 않습니다.
- "ztunnel은 스팬을 생성하지 않는다"는 부정형 문장이 공식 페이지에 그 워딩으로 존재하는지. 확인한 것은 "waypoint가 tracing을 포함한 L7 기능을 제공한다"는 긍정형뿐입니다.
- istio/istio#51313의 현재 상태, 그리고 공식 Grafana 대시보드가 waypoint 트래픽을 자동 포함하도록 갱신되었는지.

## 07 · API 대응표 — 표에 세 번째 열이 붙는다

**무엇이 바뀌나.** [07]({{< relref "07-from-nginx-to-istio.md" >}})은 nginx 지시어를 Istio CRD로 옮기는 2열 표였습니다. Ambient는 여기에 Gateway API라는 세 번째 열을 붙입니다.

ambient 공식 문서·예제의 주 트랙은 Gateway API입니다. HTTPRoute·TLSRoute·TCPRoute가 `parentRefs`로, AuthorizationPolicy·RequestAuthentication이 `targetRefs`로 붙습니다. Istio API 쪽은 DestinationRule만 1.23에서 waypoint 지원이 정식으로 도입됐습니다. **VirtualService는 latest 문서 기준으로도 여전히 Alpha**이며 "Gateway API 설정과 섞으면 undefined behavior"라는 경고가 붙어 있습니다.

- **rewrite·리다이렉트** (07: VirtualService) → HTTPRoute로 옮길지 VirtualService(Alpha)로 버틸지. **같은 서비스에 둘을 섞지 말 것**.
- **헤더 조작** (07: VirtualService) → 위와 동일.
- **CORS·타임아웃·재시도** (07: VirtualService) → 위와 동일.
- **트래픽 분할(subset)** (07: DestinationRule subset + VirtualService) → HTTPRoute의 `backendRefs`가 subset을 가리킬 수 없습니다. subset별 Service를 새로 만들 것인지 결정 **(메인테이너 커뮤니티 답변 근거, 등급 한 단계 낮음)**.
- **커넥션 풀·아웃라이어** (07: DestinationRule) → 1.23+ waypoint 정식 지원. 이 열은 그대로 삽니다.
- **IP·워크로드 인가** (07: AuthorizationPolicy) → L4 속성만 쓰면 selector 그대로 ztunnel이 집행.
- **JWT 인증** (07: RequestAuthentication + AuthorizationPolicy) → L7이므로 waypoint 필요, `targetRef`로 부착.
- **레이트 리밋** (07: EnvoyFilter(08)) → 08 절 참조 — 공식 경로 미확인.

07·08 어디에도 없던 축이 여기서 하나 생깁니다. **같은 AuthorizationPolicy 리소스라도 붙이는 방법이 집행 계층을 정합니다.** selector로 붙으면 수신측 ztunnel이 L4로 집행하고 `targetRef`로 붙으면 waypoint가 L7으로 집행합니다. L7 속성을 매치하는 규칙이 든 정책을 selector로 타겟팅해 ztunnel에 걸면 안전을 위해 **자동으로 DENY 정책이 됩니다.**

**우리가 심사할 것.**

- AuthorizationPolicy 전수 목록에서 L7 속성(경로, 메서드, 헤더 등)을 매치하는 것을 먼저 골라냅니다. 이 목록이 자동 DENY 위험군이자 waypoint 필수 목록입니다.
- 07의 표에서 VirtualService에 몰려 있던 항목들을 HTTPRoute로 옮길지 결정합니다. 부분 이전은 위험합니다 — 같은 서비스에 두 API를 섞으면 undefined behavior입니다.
- subset 기반 카나리·트래픽 분할을 쓰는 서비스 목록. subset별 Service 신설이 필요하면 GitOps 리포지토리 구조([04]({{< relref "04-config-as-code.md" >}}))도 함께 바뀝니다.

**열린 질문.**

- 07의 `ext_authz(CUSTOM)` 경로가 waypoint에서 어떻게 되는지는 이번 재료로 확인하지 못했습니다.
- VirtualService가 Alpha에서 Beta·GA로 승격되는 로드맵이 공식적으로 명시되어 있는지.
- VirtualService·DestinationRule이 `targetRef` 없이 기존 host 매칭으로 waypoint에 바인딩된다는 것을 공식 문서 원문으로 확인하지 못했습니다.

## 03 · 격리 원칙 — 폭발 반경 단위가 다시 정의된다

**무엇이 바뀌나.** [03]({{< relref "03-gateway-node-isolation.md" >}})이 다룬 격리는 공간의 격리였습니다 — taint/toleration과 nodeSelector로 전용 노드를 만들고 워크로드를 못 오게 합니다. Ambient는 여기에 **반드시 와야 하는 DaemonSet**과 **시간의 격리**를 추가합니다.

- ztunnel Helm 차트의 기본 tolerations는 `{effect: NoSchedule, operator: Exists}`, `{key: CriticalAddonsOnly, operator: Exists}`, `{effect: NoExecute, operator: Exists}`입니다. key 없는 `Exists`는 해당 effect의 모든 taint에 매치되므로 **우리가 03에서 게이트웨이 전용 노드에 건 taint에도 ztunnel은 기본 설정만으로 이미 스케줄됩니다.** 격리 정책과 충돌하는 상황은 아닙니다. 전제가 바뀐 것이고, 할 일도 막는 쪽에서 빠진 노드가 없는지 확인하는 쪽으로 옮겨 갑니다.
- waypoint는 Gateway 리소스(`gatewayClassName: istio-waypoint`)로 배포됩니다. Gateway API 공통 메커니즘인 `spec.infrastructure.parametersRef`로 ConfigMap을 참조하면 생성되는 Deployment·Service·ServiceAccount·HPA·PDB를 커스터마이즈할 수 있고 GatewayClass 레벨에서 클래스 전체 기본값도 줄 수 있습니다. 우선순위는 builtin < GatewayClass < Gateway. **이 메커니즘이 waypoint에도 그대로 적용된다는 명시적 문장은 공식 문서에서 찾지 못했습니다** — waypoint 전용 문서는 "독립적으로 설치·업그레이드·스케일되며 istiod가 자동 관리한다"고만 적습니다.
- 장애 단위가 커집니다. 채널팀 기준으로 ztunnel은 노드 전체, waypoint는 namespace 전체입니다. 03이 "관문은 전역 급소라 격리한다"고 한 논리가 **waypoint에 그대로 적용됩니다** — waypoint는 namespace 단위 급소입니다.

**우리가 심사할 것.**

- 03에서 만든 게이트웨이 전용 노드 그룹에 ztunnel이 실제로 뜨는지 확인합니다. 안 뜨면 그 노드의 파드는 [03-2 partially enrolled]({{< relref "ambient/03-2-partially-enrolled-untaint-controller.md" >}}) 상태가 됩니다 — Running이고 Ready인데 메시 밖입니다.
- waypoint를 어디에 둘 것인가. 03의 원칙(전역 급소는 전용 노드로, AZ 분산, 안티어피니티, PDB)을 waypoint에 그대로 적용할지, 아니면 istiod 자동 관리에 맡길지.
- waypoint의 HPA·PDB·리소스를 03의 게이트웨이 수준으로 맞출 수 있는지 실제 클러스터에서 확인합니다. 공식 문서 근거가 약하므로 문서 대신 실험으로 확인해야 하는 항목입니다.
- 시간 축의 격리를 추가합니다. untaint controller(`pilot.taint.enabled=true`)로 노드가 준비될 때까지 워크로드 스케줄을 미루는 것이 03의 공간 격리와 짝을 이룹니다.

**열린 질문.**

- waypoint의 nodeSelector·HPA·리소스 커스터마이즈가 waypoint에도 적용된다는 공식 문장이 istio.io에 있는지.
- ztunnel DaemonSet toleration이 하드코딩되어 values.yaml로 설정 불가라고 주장하는 istio/istio#56086의 현재 상태. 실제 1.30 차트 코드는 이미 `.Values.tolerations`를 지원해 이슈 내용과 어긋납니다.

## 이행 역학 — 01~09 어디에도 없는 절

앞의 여섯 절은 우리 문서를 다시 심사한 것이고 이 절은 우리 문서에 아예 없던 축입니다. 사이드카를 건너뛴 채널팀 기록에도 없습니다.

**무엇이 바뀌나.**

- **공식 가이드** — `ambient/migrate/` 아래 문서 세트가 있습니다. 네임스페이스 단위 6단계 — waypoint 활성화 → `istio.io/dataplane-mode=ambient` 라벨 → 사이드카 주입 라벨 제거 → 파드 재시작 → 구 사이드카 기반 정책 삭제 → 검증.
- **무중단 여부** — **L7 정책이 걸린 경우 무중단 마이그레이션 경로가 현재 없다**고 공식 가이드가 명시.
- **혼재** — 같은 메시 안에서 사이드카 파드와 ambient 파드가 east-west로 상호 통신합니다. 사이드카가 목적지를 HBONE destination으로 발견하면 HBONE을 씁니다. `ISTIO_META_ENABLE_HBONE=true`가 필요하지만 ambient 프로파일이면 MeshConfig 기본값으로 이미 켜져 있습니다.
- **혼재의 구멍** — **사이드카 → waypoint L7 상호운용은 미구현**입니다. L3/L4 통신은 되지만 사이드카 클라이언트가 ambient 쪽 waypoint L7 정책을 그대로 타지는 못합니다.
- **라벨 우선순위** — 파드 라벨 > 네임스페이스 라벨. 주입 라벨과 ambient 라벨이 동시에 걸리면 지원 대상이 아니고 현재는 사이드카가 우선합니다. 판별은 `sidecar.istio.io/status` 어노테이션 유무. 공식 권고는 네임스페이스마다 둘 중 하나만 갖는 것.
- **재시작 비대칭** — ambient 편입은 재시작이 필요 없습니다. 반대로 사이드카 제거는 주입 라벨을 지우는 것만으로는 안 되고 **파드가 실제로 재시작돼야** 컨테이너가 빠집니다.
- **롤백** — 3단계(주입 라벨 제거) 이후 롤백은 라벨 재부착. 4단계(재시작) 이후 롤백은 라벨 재부착 + `kubectl rollout restart`, 그리고 파드가 2/2로 뜨는지 확인.

**우리가 심사할 것.**

- **첫 대상 네임스페이스 선정 기준**을 앞 절들의 결과로 만듭니다 — EnvoyFilter가 안 걸렸고(08 절), L7 AuthorizationPolicy가 없고(07 절), HTTP 대시보드 의존이 낮은(06 절) 곳. 세 조건 중 두 번째가 "무중단 경로 없음"에 직접 걸리므로 가장 무겁습니다.
- **전환 창 산정.** 사이드카 제거는 rollout restart를 요구하고 그 롤아웃 자체가 [02]({{< relref "02-istiod-control-plane.md" >}})가 말한 istiod push 이벤트입니다. 한 번에 몇 네임스페이스를 돌릴지는 [09]({{< relref "09-istiod-scaling-connections.md" >}})의 커넥션 산수와 같은 문제입니다.
- **롤백 리허설.** 라벨 재부착 + rollout restart로 파드가 2/2로 돌아오고 트래픽이 정상인지를 스테이징에서 먼저 돌려 봅니다. 롤백 경로가 문서화되어 있다는 것과 우리 환경에서 동작한다는 것은 다른 얘기입니다.
- **혼재 기간의 정책 배치.** 클라이언트가 사이드카이고 서버가 ambient + waypoint인 조합에서는 L7 정책이 기대대로 걸리지 않습니다. 인가를 어느 계층에 둘지 조합별로 정리할 것.
- **정책 전수 재해석.** 사이드카 시절 만든 AuthorizationPolicy 중 L7 속성을 가진 것이 selector로 붙어 있으면 ztunnel 집행 대상이 되어 자동 DENY가 됩니다. 이행 전에 반드시 한 번 훑을 목록입니다.

**열린 질문.**

- 사이드카 시절 만든 AuthorizationPolicy가 전환 시 자동으로 어느 계층으로 재해석되는지, 그리고 자동 DENY 전환을 사용자에게 경고하는 공식 마이그레이션 문구가 있는지. `ambient/migrate/` 하위를 더 훑어야 합니다.
- 사이드카 → waypoint L7 상호운용 미구현이 2026-07 최신 안정판에서도 여전한지. dataplane-modes 문서의 Unsupported features 목록을 최신 기준으로 재확인할 것.
- "1.30에서 사이드카 → ambient 마이그레이션 가이드가 신규 도입되었다"는 서술을 릴리스 노트 1차 출처로 재확인하지 못했습니다.

## 이 문서에서 가져갈 것

- **이행 계획의 첫 입력은 EnvoyFilter 목록과 L7 AuthorizationPolicy 목록입니다.** 전자는 옮길 데가 없을 수 있고 후자는 무중단 경로가 없다고 공식 가이드가 명시합니다. 이 두 목록이 전환 순서를 거의 다 정합니다.
- **02와 06의 결론은 폐기되지 않고 다른 형태로 대체됩니다.** `Sidecar` 스코핑은 waypoint 기본 스코프로, 공짜 관측성은 "waypoint를 어디에 세울까"라는 배치 결정으로 바뀝니다. 09의 GOMAXPROCS·CFS 사슬처럼 istiod 안쪽 얘기는 그대로 살아남습니다.
- **답이 없는 항목이 이 문서의 절반입니다.** waypoint의 rate limit 공식 경로, 기존 정책의 자동 재해석, waypoint 배치 커스터마이즈의 공식 근거 — 셋 다 공식 문서에서 확인하지 못했습니다. 이행 결정을 이 세 항목의 답이 나오기 전에 내리면 안 되는 것인지부터 정할 것.
- **채널팀 기록은 대조군이지 우리 계획서가 아닙니다.** [Ambient mode 도입기]({{< relref "ambient/_index.md" >}})의 네 가지 장애는 전부 "프록시가 파드 밖으로 나가서" 생긴 것이고 그건 우리도 똑같이 받습니다. 이 문서의 절들은 "사이드카를 이미 운영했기 때문에" 생기는 비용이라 그쪽 기록에 없습니다.

## 소스

Ambient 데이터 플레인과 확장:

- Istio 블로그 — **Rust-based ztunnel** (ztunnel이 Envoy가 아닌 이유): <https://istio.io/latest/blog/2023/rust-based-ztunnel/>
- Istio 공식 문서 — **Ambient L7 features** (EnvoyFilter 미지원, WasmPlugin Alpha, VirtualService Alpha): <https://istio.io/latest/docs/ambient/usage/l7-features/>
- Istio 공식 문서 — **Extend waypoint with Wasm**: <https://istio.io/latest/docs/ambient/usage/extend-waypoint-wasm/>
- Istio 블로그 — **TrafficExtension API** (1.30 도입, WasmPlugin 호환): <https://istio.io/latest/blog/2026/traffic-extension-api/>
- Istio 공식 문서 — **Enabling Rate Limits using Envoy** (사이드카 전제, ambient 언급 없음): <https://istio.io/latest/docs/tasks/policy-enforcement/rate-limit/>
- istio/istio — rate limit 커뮤니티 논의: <https://github.com/istio/istio/discussions/55011> · <https://github.com/istio/istio/issues/54391>

스코핑과 컨트롤 플레인:

- istio/istio 아키텍처 설계 문서 — **ztunnel** (커스텀 xDS 리소스, 10x edge): <https://github.com/istio/istio/blob/master/architecture/ambient/ztunnel.md>
- Istio 공식 문서 — **Ambient control plane** (ztunnel의 단순화된 xDS 리소스 셋, 노드당 1개): <https://istio.io/latest/docs/ambient/architecture/control-plane/>
- Istio 블로그 — **Waypoint proxy made simple** (`exportTo`·`Sidecar` API가 "no longer required"): <https://istio.io/latest/blog/2023/waypoint-proxy-made-simple/>
- Istio 공식 문서 — **Sidecar CRD 레퍼런스** (ambient·ztunnel·waypoint 언급 없음, 침묵 확인용): <https://istio.io/latest/docs/reference/config/networking/sidecar/>

관측성:

- Istio 공식 문서 — **Ambient data plane** (ztunnel의 표준 TCP 메트릭): <https://istio.io/latest/docs/ambient/architecture/data-plane/>
- Istio 공식 문서 — **Istio Standard Metrics** (`reporter` 라벨 정의): <https://istio.io/latest/docs/reference/config/metrics/>
- Istio 공식 문서 — **Troubleshoot ztunnel** (ztunnel 연결 단위 로그 필드): <https://istio.io/latest/docs/ambient/usage/troubleshoot-ztunnel/>
- Istio 공식 문서 — **Telemetry API로 액세스 로그 설정** (사이드카 전제, ambient 언급 없음): <https://istio.io/latest/docs/tasks/observability/logs/telemetry-api/>
- istio/istio#51313 — `reporter=Waypoint`에 맞춘 문서·대시보드 갱신 미해결: <https://github.com/istio/istio/issues/51313>
- ambientmesh.io — **Metrics** (`reporter="waypoint"` 확인, 2차 자료): <https://ambientmesh.io/docs/observability/metrics/>

API와 정책:

- Istio 공식 문서 — **Waypoint 설정** (waypoint가 필요한 L7 기능 목록, 공유 범위): <https://istio.io/latest/docs/ambient/usage/waypoint/>
- Istio 1.23 릴리스 공지 — waypoint의 DestinationRule 지원: <https://istio.io/latest/news/releases/1.23.x/announcing-1.23/>
- Istio 공식 문서 — **Ambient L4 정책** (selector → ztunnel 집행, L7 속성 시 자동 DENY): <https://istio.io/latest/docs/ambient/usage/l4-policy/>
- istio/istio 메인테이너 답변 — HTTPRoute가 DestinationRule subset을 참조할 수 없음(커뮤니티 근거): <https://github.com/istio/istio/discussions/53672>

이행과 배치:

- Istio 공식 문서 — **Enable ambient mode** (6단계 마이그레이션, 무중단 경로 없음, 롤백): <https://istio.io/latest/docs/ambient/migrate/enable-ambient-mode/>
- Istio 공식 문서 — **Add workloads to ambient** (HBONE 상호운용, 라벨 우선순위, 재시작 비대칭): <https://istio.io/latest/docs/ambient/usage/add-workloads/>
- istio/istio 차트 — `manifests/charts/ztunnel/values.yaml` (기본 tolerations): <https://raw.githubusercontent.com/istio/istio/release-1.30/manifests/charts/ztunnel/values.yaml>
- Istio 공식 문서 — **Kubernetes Gateway API** (`infrastructure.parametersRef`로 Deployment·HPA·PDB 커스터마이즈): <https://istio.io/latest/docs/tasks/traffic-management/ingress/gateway-api/>
- istio/istio#56086 — ztunnel toleration 설정 관련 이슈(현재 차트 코드와 불일치): <https://github.com/istio/istio/issues/56086>

버전 기준은 2026-07 시점의 istio.io latest(1.30 계열)입니다. Alpha 등급과 미지원 항목은 릴리스마다 바뀌므로, 실제 이행 직전에 배포 대상 버전의 문서로 다시 확인할 것.
