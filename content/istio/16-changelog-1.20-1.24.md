---
title: "1.20 → 1.24 — ambient가 실험에서 나온 구간"
weight: 16
---

# 10 · 1.20 → 1.24 — ambient가 실험에서 나오고, 설치 경로가 바뀐다

{{< callout type="info" >}}
**한눈에**
- 이 구간의 사건은 두 개다. **ambient가 alpha → Beta(1.22.0) → GA(1.24.0)로 올라간 것**과 **설치·관리 경로가 강제로 바뀐 것**(in-cluster operator 폐기 1.23.0 → 제거 1.24.0, [#52090](https://github.com/istio/istio/pull/52090)). 전자는 선택이지만 **후자는 선택이 아니다** — sidecar를 유지하는 클러스터도 1.24 이상으로 가려면 그대로 맞는다.
- **ambient GA는 sidecar의 폐기 신호가 아니다.** 1.20~1.24 어느 upgrade-notes·change-notes에도 sidecar injection을 deprecated로 표시한 문구가 없고, 최신 스냅샷 문서도 sidecar를 "thoroughly battle-tested"라며 두 개의 main data plane mode 중 하나로 나란히 둔다. 우리 방침(ambient 금지)은 **유효하고, 이 구간 사실만으로는 재검토 트리거도 발생하지 않았다**(§2.4).
- 제거된 것은 **in-cluster 컨트롤러와 `istio-operator` 차트**이고, `IstioOperator` **API 타입은 1.30.0에도 살아 있다**(`operator/pkg/apis/types.go`, `install.istio.io/v1alpha1`). `istioctl install -f istio.yaml`은 그대로 동작한다 — "IstioOperator가 죽었다"는 요약은 틀렸다.
- 1.24.0에서 **CRD가 Helm 템플릿으로 이동**하고 `base.enableCRDTemplates`가 기본 `true`가 된다([#43204](https://github.com/istio/istio/issues/43204)). CRD를 `kubectl apply`나 이전 `helm install`로 넣었다면 **1.24 전에 1회 `kubectl label/annotate`로 Helm 소유권 이관**이 필요하고, ArgoCD가 만든 실제 Helm 릴리스명을 모르면 이 명령을 실행하면 안 된다.
- **sidecar 트래픽 동작을 바꾸는 플래그 7개가 1.24.0에 한꺼번에 들어오고 전부 기본 `true`다**(§5.6) — `ENABLE_INBOUND_RETRY_POLICY`·`EXCLUDE_UNSAFE_503_FROM_DEFAULT_RETRY`·`PILOT_UNIFIED_SIDECAR_SCOPE`·`ENABLE_ENHANCED_DESTINATIONRULE_MERGE`·`PREFER_DESTINATIONRULE_TLS_FOR_EXTERNAL_SERVICES`·`ENABLE_DEFERRED_STATS_CREATION`·`BYPASS_OVERLOAD_MANAGER_FOR_STATIC_LISTENERS`. 이 7개가 정확히 `compatibilityVersion=1.23` 프로파일의 내용이다.
- **1.21.0의 TLS 기본값 두 개가 egress를 끊을 수 있다.** `ENABLE_AUTO_SNI`와 `VERIFY_CERTIFICATE_AT_CLIENT`가 동시에 `true`가 되면서 `caCertificates` 없는 `DestinationRule` TLS 오리지네이션이 **OS CA로 검증을 시작**한다. 사설 CA 대상은 그 순간 실패한다.
- **istio.io 문서의 플래그명이 실제 env var와 다른 곳이 두 군데다.** 1.21 upgrade-notes는 `VERIFY_CERT_AT_CLIENT`라 쓰지만 등록명은 `VERIFY_CERTIFICATE_AT_CLIENT`(`pilot/pkg/features/pilot.go:239`)고, 1.22 upgrade-notes는 `ENHANCED_RESOURCE_SCOPING`이라 쓰지만 실제는 `ENABLE_ENHANCED_RESOURCE_SCOPING`(`experimental.go:182`)이다. **문서를 복사해 env를 걸면 아무 일도 일어나지 않는다.**
- **1.23.0에 공개 upgrade-notes 페이지에 실리지 않은 메트릭 파괴 변경이 있다.** `ENABLE_DELIMITED_STATS_TAG_REGEX`(기본 `true`, [#52271](https://github.com/istio/istio/pull/52271))가 Envoy cluster 메트릭의 `cluster_name`·`http_conn_manager_prefix` 라벨 파싱을 바꾼다. 근거는 릴리스노트 원본 `releasenotes/notes/51761.yaml`의 `upgradeNote`뿐이다 — **대시보드가 조용히 깨지는 종류**다.
- **1.22.0의 `v1` 승격은 "추가"이지 "이동"이 아니다.** CRD가 `v1`·`v1alpha3`·`v1beta1` 셋을 동시에 served로 제공하고 **storage 버전은 1.22.0에 `v1alpha3`에서 `v1beta1`로 올라가 1.26.0까지 남는다**(1.27.0에서 `v1`로 이동). `v1alpha3`로 쓴 옛 매니페스트는 1.30.0 기준으로도 그대로 apply된다.
- **1.24 계열은 k8s ≤1.31까지다.** 하한 가정(chart tip 1.24.1)이 k8s 1.33 위에서는 지원 대상 밖이라는 뜻이고, 1.24는 2025-06-24에 EOL이라 **compat profile로 버티는 선택지 자체가 이미 없다**.
{{< /callout >}}

> **왜 이 문서인가.** 1.24를 하한으로 가정하고 1.30.3까지 올리는 계획에서 1.20~1.24는 "이미 지나온 구간"으로 취급되기 쉽다. 그런데 이 구간에는 **지나왔는지 아닌지를 클러스터를 봐야 알 수 있는 항목**이 셋 있다 — in-cluster operator를 쓰고 있는지, CRD의 Helm 소유권 이관을 했는지, 1.21의 TLS 기본값 전환에 egress가 걸렸는지. "1.24가 이미 떠 있다"는 사실만으로는 확인되지 않고, 안 했으면 다음 홉에서 터진다. 이 문서는 5개 마이너를 나열하는 대신 그 종류의 항목에만 지면을 준다.
>
> 근거 기준: 릴리스 공지·upgrade-notes·change-notes는 `istio-io` 클론의 `content/en/news/releases/<v>.x/announcing-<v>/`, 문서 본문은 같은 클론의 `content/en/docs/`(**최신 스냅샷 — 과거 마이너 시점 문서가 아니다**), 코드·차트·CRD 인용은 `istio/istio` full history 클론에서 **해당 태그를 직접 체크아웃해 확인**했다(`git show <tag>:<path>`). 플래그 기본값은 문서가 아니라 `env.Register(...)` 인수를, 도입 마이너는 `git log -S` + `git tag --contains`로 확정했다. 릴리스일은 gh release API 기준이다.

> 이 챕터의 축은 "버전이 무엇을 바꿨고, 운영에서 무엇을 해야 하나"다. istiod 부하·xDS 커넥션의 **메커니즘**은 [09 istiod 스케일링과 xDS 커넥션 재분배]({{< relref "09-istiod-scaling-connections.md" >}})가, **우리 클러스터의 차트·values·이관 절차·리스크**는 [eks-upgrade/istio]({{< relref "../eks-upgrade/components/02-istio.md" >}})가 소유한다. 1.25 이후 구간(native sidecar 기본화, base·istiod 차트 통합)은 [11 1.25 → 1.30]({{< relref "17-changelog-1.25-1.30.md" >}})이다.

## 1. 타임라인 — 무엇이 언제 들어왔나

| 버전 | 릴리스일 | 대표 변경 | 지원 k8s | breaking·필요 조치 |
|---|---|---|---|---|
| **1.20.0** | 2023-11-14 | Gateway API v1.0 GA 전면 지원 + Istio CRD `targetRef`, `ExternalName` alias 방식 **예고**(off), Envoy 필터 순서 통일, 다중 대상 미러링 | 1.25 – 1.28 | **sidecar `startupProbe` 기본 on** — 10분 미기동 시 파드 종료(이전엔 무한 대기). 플래그·CLI 제거 4건 |
| **1.21.0** | 2024-03-14 | `compatibilityVersion` 개념 도입, 사이드카 바이너리 ~10MB 축소(이미지 25%↓, 파드당 ~5MB RAM↓) | 1.26 – 1.29 | **`ENABLE_AUTO_SNI`·`VERIFY_CERTIFICATE_AT_CLIENT` 기본 on**(egress TLS 위험), `ExternalName` alias 기본 on, Gateway 라벨 키 교체, Telemetry legacy `EnvoyFilter` 필드 4종 무반영 |
| **1.22.0** | 2024-05-13 | **ambient Beta**, Istio API `v1` 승격, Gateway API v1.1로 mesh(east-west)까지 Stable, `AuthorizationPolicy` path 템플릿([#16585](https://github.com/istio/istio/issues/16585)) | 1.27 – 1.30 | **Delta xDS 기본 on**, `ENABLE_ENHANCED_RESOURCE_SCOPING` 기본 on([#49719](https://github.com/istio/istio/pull/49719)), `ServiceEntry resolution: NONE`이 `targetPort` 존중, **암묵적 zipkin 트레이싱 제거** |
| **1.23.0** | 2024-08-15 | ambient 대규모 개선(단일 ambient Helm 차트, 처리량 최대 50%↑), IP 자동할당 재구현(`PILOT_ENABLE_IP_AUTOALLOCATE`, off), 인바운드 리트라이 프리뷰 | 1.27 – 1.30 | **in-cluster operator 폐기 공지**, **stats tag regex 변경**(메트릭 라벨 파싱, 공개 upgrade-notes에 없음), 플래그 제거 4종, 내부 API protobuf 통합(Go/protobuf 직접 사용자만) |
| **1.24.0** | 2024-11-07 | **ambient GA**, `istioctl manifest translate` 신설, `sidecar.istio.io/nativeSidecar` per-pod 어노테이션 | **1.28 – 1.31** | **in-cluster operator 제거**, **CRD Helm 템플릿화 + 1회 소유권 이관**, **sidecar 동작 플래그 7개 기본 on**, `istiod-remote` 차트 제거, Telemetry CEL 표준화, Helm values 11개·`istioctl` 명령 3개 제거, `1.20` compat profile 제거 |

지원 k8s 하한은 1.20→1.24에서 1.25→1.28로 세 칸 올라갔고 상한은 1.28→1.31이다. **1.24가 커버하는 최대 k8s는 1.31**이므로, k8s 1.33 클러스터에서는 1.24 계열이 지원 대상 자체가 아니다([eks-upgrade/istio]({{< relref "../eks-upgrade/components/02-istio.md" >}})가 목표를 1.30.3으로 잡은 근거가 이것이다).

Envoy 마이너 버전 대응은 **업스트림 문서에 이 구간이 없다**. `docs/releases/supported-releases/index.md`의 Supported Envoy Versions 표는 1.28.x부터만 기재하고, 그 이전은 `istio/proxy`의 `WORKSPACE`에서 `ENVOY_SHA`를 직접 봐야 한다고만 적혀 있다. 로컬 클론의 `istio.deps`에도 `PROXY_REPO_SHA`/`ZTUNNEL_REPO_SHA`만 있어 마이너 번호로 환산할 수 없다 — 이 문서에서는 Envoy 버전을 쓰지 않는다.

## 2. ambient가 어디까지 왔나

> 이 절은 **어느 버전에서 무엇이 어떤 단계가 됐는가**만 다룬다. "사이드카에서 옮겨간다면 01~09의 결론 중 무엇이 무효가 되나"는 [10 Ambient 이행 심사]({{< relref "10-ambient-migration-questions.md" >}}), 사이드카를 거치지 않은 팀의 프로덕션 기록은 하위 섹션 [Ambient mode 도입기]({{< relref "ambient/_index.md" >}})가 소유한다.

### 2.1 단계 이동 — Beta는 1.22.0, GA는 1.24.0

성숙도 단계는 세 지점으로 확정된다.

| 시점 | 상태 | 릴리스 공지 문구의 근거 |
|---|---|---|
| 1.20.0 이전(2022 발표) | alpha | 1.21 공지가 2022 발표 블로그를 참조하며 여전히 실험 단계로 서술 |
| 1.21.0 | alpha (플랫폼 확장) | "works across all Kubernetes platforms and CNI implementations" — GKE·AKS·EKS와 Calico·Cilium·OpenShift 검증. "targeted to move to Beta in the upcoming Istio 1.22"라고 예고 |
| **1.22.0** | **Beta** | "Ambient mode now in Beta" — "features and stability are ready for production workloads with appropriate precautions" |
| 1.23.0 | Beta (대규모 개선) | waypoint의 `DestinationRule` 지원, DNS `ServiceEntry`, 네임스페이스 간 waypoint 공유, dual-stack/IPv6, 단일 ambient Helm 차트, 처리량 최대 50% 개선 |
| **1.24.0** | **GA** | "The core features (ztunnel, waypoints and APIs) have been marked as Stable by the Istio TOC. This marks the final stage in Istio's feature phase progression" |

1.22.0은 성숙도만 올린 게 아니라 **waypoint 첨부 방식을 전면 재설계**했다 — 서비스 어카운트/네임스페이스 attach 시맨틱을 버리고 서비스 향(向) 트래픽과 워크로드 향 트래픽을 구분해 각각 라벨로 붙이는 방식이 됐다(1.22 upgrade-notes "New ambient mode waypoint attachment method"). **Beta 승격과 API 재설계가 같은 릴리스에서 일어났다**는 사실은 그 시점의 안정성 판단에 그대로 반영해야 한다.

### 2.2 두 데이터패스가 지나는 곳

{{< flow caption="sidecar는 파드 안 프록시 두 개가 L4+L7을 다 하고, ambient는 노드 공용 ztunnel이 L4(mTLS·L4 인가)만 처리한다. L7 정책이 필요한 서비스에만 waypoint가 경로에 끼어든다 — 그래서 ambient에서 L7은 '기본'이 아니라 '옵트인'이다. istio-cni는 이 그림에 없다: 파드 생성·라벨 부여 시점에 파드 netns로 들어가 리다이렉션 규칙을 세우고 ztunnel에 netns 파일 디스크립터를 넘기는 셋업 담당이고, 요청 경로에는 앉지 않는다" >}}
{
  "nodes": [
    { "id": "sa", "col": 0, "row": 0, "label": "app A", "sub": "sidecar 모드 파드", "kind": "src" },
    { "id": "sp1", "col": 1, "row": 0, "label": "istio-proxy", "sub": "파드 A netns · L4+L7", "kind": "proc" },
    { "id": "sp2", "col": 3, "row": 0, "label": "istio-proxy", "sub": "파드 B netns · L4+L7", "kind": "proc" },
    { "id": "sb", "col": 4, "row": 0, "label": "app B", "sub": "sidecar 모드 파드", "kind": "sink" },
    { "id": "aa", "col": 0, "row": 1, "label": "app A", "sub": "ambient 모드 파드", "kind": "src" },
    { "id": "z1", "col": 1, "row": 1, "label": "ztunnel W1", "sub": "노드당 1개 · L4 전용", "kind": "proc" },
    { "id": "z2", "col": 3, "row": 1, "label": "ztunnel W2", "sub": "노드당 1개 · L4 전용", "kind": "proc" },
    { "id": "ab", "col": 4, "row": 1, "label": "app B", "sub": "ambient 모드 파드", "kind": "sink" },
    { "id": "wp", "col": 2, "row": 2, "label": "waypoint", "sub": "L7 정책·라우팅 필요할 때만", "kind": "query" }
  ],
  "edges": [
    { "from": "sa", "to": "sp1", "label": "iptables REDIRECT", "rate": 420 },
    { "from": "sp1", "to": "sp2", "label": "mTLS", "rate": 420 },
    { "from": "sp2", "to": "sb", "label": "localhost", "rate": 420 },
    { "from": "aa", "to": "z1", "label": "파드 netns 캡처", "rate": 420 },
    { "from": "z1", "to": "z2", "label": "HBONE mTLS · :15008", "rate": 420 },
    { "from": "z2", "to": "ab", "label": "파드 netns", "rate": 420 },
    { "from": "z1", "to": "wp", "label": "L7 있으면 우회", "rate": 900, "speed": "slow" },
    { "from": "wp", "to": "z2", "label": "정책 적용 후 전달", "rate": 900, "speed": "slow" }
  ]
}
{{< /flow >}}

세 컴포넌트의 책임은 이렇게 갈린다. **ztunnel**은 노드당 하나의 프로세스지만 파드마다 별도의 논리 프록시와 리슨 포트 셋(15008·15006·15001)을 파드 netns 안에 만들고, 워크로드마다 다른 x509 신원을 대신 들어야 하므로 **노드에 있는 서비스 어카운트마다 인증서를 따로 발급받는다**(CA는 요청된 신원이 실제로 그 노드에 있는지 검증해 거부한다 — 노드 하나가 침해돼도 메시 전체가 털리지 않게 하는 장치다). **waypoint**는 HBONE 트래픽만 받고 `AuthorizationPolicy` L7·`RequestAuthentication`·`WasmPlugin`·`Telemetry`를 적용한 뒤 전달하며, `Service` 향 요청에는 L7 라우팅·로드밸런싱까지 한다. **istio-cni**는 체인 CNI 플러그인으로 파드 생성 알림을 받고, 노드 에이전트가 파드 netns에 들어가 리다이렉션 규칙을 세운 다음 Unix 도메인 소켓으로 ztunnel에 netns 파일 디스크립터를 넘긴다.

HBONE 터널이 "ztunnel 사이"에 그려지는 것은 논리적 표현이고, 실제 캡슐화·암호화는 **출발지 파드의 netns 안에서** 일어나 목적지 파드 netns에서 풀린다(`docs/ambient/architecture/data-plane/index.md`의 tip 블록). 같은 노드 안 통신도 ztunnel을 거쳐야 L4 인가·텔레메트리가 노드 경계와 무관하게 동일하게 적용된다.

### 2.3 sidecar와의 공존 — 지원되지만 L7이 조용히 빠진다

공존 자체는 명문으로 지원된다. `docs/ambient/overview/index.md`의 tip 블록: *"Pods and workloads using sidecar mode can co-exist within the same mesh as pods that use ambient mode."* 문제는 **경계를 넘는 트래픽의 L7 정책**이다.

| 상황 | 무슨 일이 나나 | 판정 |
|---|---|---|
| ambient 파드 → waypoint 있는 ambient 파드 | 출발지 ztunnel이 waypoint를 경유시킨다. L7 정책 적용 | **정상** |
| **sidecar 파드 → waypoint 있는 ambient 파드** | **waypoint를 완전히 우회한다.** 출발지가 ambient로 넘어갈 때까지 그 트래픽에는 waypoint의 L7 정책이 적용되지 않는다 | **반쪽** — 점진 이행 중 정책 구멍이 생긴다 |
| ingress gateway → waypoint 있는 ambient 파드 | 기본적으로 waypoint 우회. `istio.io/ingress-use-waypoint` 라벨로 옵트인 | **반쪽** — 라벨을 붙여야 정책이 산다 |
| 메시 밖 파드 → ambient 파드 | ztunnel이 평문도 받는다. peer 신원이 없는 상태로 인가 평가 — 신원을 요구하는 정책을 걸어야 평문이 차단된다 | **주의** |

즉 공존은 "둘이 같이 떠 있을 수 있다"까지고, **L7 정책의 적용 범위는 출발지가 어느 모드인지에 달린다.** 금융 워크로드에서 L7 인가가 요건이면 이 성질이 이행 중간 상태를 그대로 위험 구간으로 만든다.

ambient가 아예 안 되는 것도 명시돼 있다(`docs/ambient/migrate/_index.md`. 그 문서 스스로 **"the limitations listed below reflect the current stable Istio release"**라고 밝히므로 1.24 시점이 아니라 최신 스냅샷 기준이다).

**하드 블로커 — 이행 자체가 불가능**: VM 워크로드, SPIRE 인증서 프로바이더, `PeerAuthentication mode: DISABLE`(ambient는 mTLS를 항상 강제하므로 무시된다), primary-remote 멀티클러스터(multi-primary만 지원).

**알려진 제약 — 동작하지만 제한적**: `EnvoyFilter`는 waypoint에 지원되지 않는다(향후 지원 가능성만 언급). `VirtualService`의 ambient 지원은 아직 **Alpha**여서 L7 라우팅은 `HTTPRoute`로 옮기는 게 전제고, 같은 워크로드에 둘을 섞으면 동작이 정의되지 않는다.

### 2.4 판정 — 우리 방침(ambient 금지)은 이 구간 사실로 볼 때 타당한가

**타당하다.** 근거는 세 갈래다.

| 판단 축 | 확인된 사실 | 방침에 대한 함의 |
|---|---|---|
| sidecar가 폐기 트랙인가 | **아니다.** 1.20~1.24 upgrade-notes·change-notes 어디에도 sidecar injection을 deprecated로 표시한 문구가 없다. 최신 스냅샷 `docs/overview/dataplane-modes/index.md`는 sidecar를 "built on the sidecar pattern from its first release in 2017 … well understood and thoroughly battle-tested"로 서술하고 두 모드를 나란히 비교한다 | 유지가 "레거시에 남는 것"이 아니다 |
| sidecar 경로에 투자가 계속되나 | **계속된다.** 1.20 `startupProbe` 기본화, 1.21 바이너리 ~10MB 축소, 1.23 인바운드 리트라이 프리뷰 → 1.24 기본 활성, 1.24 per-pod native sidecar 제어 | 유지가 성능·안정성에서 손해 보는 방향이 아니다 |
| ambient가 우리 요건을 받을 수 있나 | **하드 블로커·L7 우회 문제가 남아 있다**(§2.3). 특히 `EnvoyFilter` 미지원과 `VirtualService` Alpha는 [08 EnvoyFilter]({{< relref "08-envoyfilter-extension.md" >}})·기존 `VirtualService` 자산과 정면으로 부딪힌다 | 금융 요건과 무관하게라도 전환 비용이 크다 |

**재검토 트리거는 둘뿐이다.** ① 릴리스 공지·upgrade-notes가 sidecar mode를 **명시적으로 deprecated로 지정**하는 경우. ② `EnvoyFilter`가 waypoint에 지원되고 `VirtualService`의 ambient 지원이 Alpha를 벗어나는 경우 — 즉 §2.3의 "알려진 제약" 두 줄이 해소되는 시점. **"ambient가 GA됐다"는 사실 자체는 트리거가 아니다**: GA는 "충분히 검증됐다"는 성숙도 선언이고, sidecar를 없앤다는 선언과는 다른 문장이다. 이 구간에서는 두 트리거 모두 발생하지 않았다.

## 3. 설치·관리 경로의 강제 변경

### 3.1 세 번에 걸쳐 끊긴다

"IstioOperator가 없어졌다"는 흔한 요약이 세 개의 다른 사건을 뭉갠 결과다. 정확히는 이렇다.

| 버전 | 무엇이 끊겼나 | 남는 것 | 근거 |
|---|---|---|---|
| **1.21.0** | `istioctl install`/`helm install`이 만들던 **`installed-state` `IstioOperator` 인스턴스** 제거. 두 명령은 더 이상 `IstioOperator` CRD를 설치하지 않는다 | in-cluster operator 자체는 무관하고 그대로 동작 — 문서가 "이것은 `istioctl install`에만 영향"이라고 명시 | 1.21 change-notes:309 |
| **1.23.0** | **공식 deprecate.** "fewer than 10% of our user base … will need to migrate … in order to upgrade to Istio 1.24 or above" | 1.23.x에서는 계속 동작. 단 **1.24 이상으로는 못 올라간다** | 1.23 공지 "Deprecating the in-cluster Operator"; 폐기 블로그 |
| **1.24.0** | **완전 제거.** `manifests/charts/istio-operator/`가 19개 파일 → 0개(`crd-operator.yaml` 포함), `istioctl/cmd/root.go`에서 `OperatorCmd` 삭제 | Helm, `istioctl install` | commit [c2b027c4e0](https://github.com/istio/istio/pull/52090), `git tag --contains` → 최초 포함 `1.24.0` |

{{< flow caption="1.24.0 이후 남는 것은 로컬 렌더링 두 갈래다 — istioctl이 IstioOperator 파일을 직접 읽어 적용하거나, manifest translate로 Helm values로 바꿔 Helm이 적용한다. 점선(파티클 없음)이 1.24.0에서 끊긴 경로다: 클러스터 안에서 IstioOperator CR을 감시하던 컨트롤러가 사라졌다" >}}
{
  "nodes": [
    { "id": "iop", "col": 0, "row": 1, "label": "IstioOperator YAML", "sub": "install.istio.io/v1alpha1 · 파일 형식으로 생존", "kind": "src" },
    { "id": "ictl", "col": 1, "row": 0, "label": "istioctl install -f", "sub": "로컬에서 Helm 템플릿 렌더링", "kind": "proc" },
    { "id": "tr", "col": 1, "row": 1, "label": "manifest translate", "sub": "1.24 신설 · values.yaml 산출", "kind": "proc" },
    { "id": "op", "col": 1, "row": 2, "label": "in-cluster operator", "sub": "1.23 폐기 → 1.24 삭제", "kind": "query" },
    { "id": "helm", "col": 2, "row": 1, "label": "helm upgrade", "sub": "base · istiod · cni · gateway", "kind": "proc" },
    { "id": "cp", "col": 3, "row": 1, "label": "istio-system", "sub": "적용된 컨트롤 플레인", "kind": "sink" }
  ],
  "edges": [
    { "from": "iop", "to": "ictl", "label": "-f istio.yaml", "rate": 480 },
    { "from": "iop", "to": "tr", "label": "Helm 이관 시 1회", "rate": 900, "speed": "slow" },
    { "from": "tr", "to": "helm", "label": "values.yaml", "rate": 900, "speed": "slow" },
    { "from": "helm", "to": "cp", "label": "GitOps로 적용", "rate": 480 },
    { "from": "ictl", "to": "cp", "label": "직접 apply", "rate": 480 },
    { "from": "iop", "to": "op", "label": "kubectl apply (1.23까지)", "dashed": true },
    { "from": "op", "to": "cp", "label": "1.24에서 끊김", "dashed": true }
  ]
}
{{< /flow >}}

**핵심은 API 타입이 죽지 않았다는 것이다.** `IstioOperator` 스펙은 1.30.0에도 `operator/pkg/apis/types.go`에 그대로 있고 `apiVersion: install.istio.io/v1alpha1`을 문서 주석에 명시한다. 폐기 블로그도 같은 말을 한다 — *"Users who install Istio with the `istioctl install` command and an `IstioOperator` YAML file are not affected."* 사라진 것은 **그 CR을 클러스터 안에서 감시·적용하던 고권한 컨트롤러와 그 컨트롤러를 배포하던 차트**다.

### 3.2 우리가 어느 경로인지 — 확인 명령이 판정을 대신한다

[eks-upgrade/istio]({{< relref "../eks-upgrade/components/02-istio.md" >}})에 설치 방식이 명시돼 있지 않고 라이브 버전도 미확인이므로 이 항목은 **문서로 결론이 나지 않는다.** 두 명령이 판정 전체이고, 둘 다 비어 있으면 이 절은 무해하다.

```bash
kubectl get deployment -n istio-system istio-operator
kubectl get IstioOperator -A
```

둘 다 비어 있지 않으면 **1.24 이상으로 올라갈 수 없다.** 이관 절차는 폐기 블로그가 정한 순서 그대로다.

```bash
# 1) 현재 CR을 파일로 내린다 (결과는 하나여야 정상)
kubectl get IstioOperator <name> -n <ns> -o yaml > istio.yaml

# 2) 컨트롤러를 멈춘다 — 컨트롤 플레인도, 메시 트래픽도 끊기지 않는다
kubectl scale deployment -n istio-system istio-operator --replicas 0

# 3-a) istioctl 경로: 위 istio.yaml을 그대로 쓴다
istioctl install -f istio.yaml --set revision=<rev>
# 3-b) Helm 경로: 1.24+ istioctl이 values.yaml과 설치 스크립트를 만들어준다
istioctl manifest translate -f istio.yaml

# 4) 이관 검증 후 잔재 정리
kubectl delete deployment -n istio-system istio-operator
kubectl delete customresourcedefinition istiooperators.install.istio.io
```

**Helm을 권한다**는 것이 업스트림의 명시적 입장이다(폐기 블로그: *"Because of Helm's popularity within the platform engineering ecosystem, we recommend most users migrate to Helm"*, Helm 설치는 Argo CD·Flux로 관리할 수 있다는 문장까지 포함). ArgoCD로 차트를 렌더링하는 우리 구성은 그 권장 경로에 이미 서 있다. operator 패턴을 유지하려면 `istio-ecosystem`의 Classic Operator Controller나 Sail Operator가 있지만 **둘 다 Istio 프로젝트가 지원하지 않는다**(블로그 명시).

### 3.3 CRD의 Helm 소유권 — 1.24 전에 한 번, 안 하면 충돌한다

1.24.0에서 CRD가 `manifests/charts/base/crds/`(Helm이 설치만 하고 업그레이드·삭제는 관리하지 않는 특수 디렉터리)에서 `manifests/charts/base/files/`(일반 템플릿)로 이동했다. 그래서 업그레이드 방식이 바뀐다.

| | 1.23까지 | 1.24부터 |
|---|---|---|
| 설치 | `helm install istio-base` | `helm install istio-base` |
| **업그레이드** | **`kubectl apply -f manifests/charts/base/files/crd-all.gen.yaml`** (차트 밖에서 별도로) | **`helm upgrade istio-base`** (차트가 관리) |
| 삭제 | `kubectl get crd -oname \| grep istio.io \| xargs kubectl delete` | 동일 |

새 옵션 `base.enableCRDTemplates`가 기본 `true`고, `false`로 레거시 방식을 유지할 수 있지만 **향후 릴리스에서 제거 예정**으로 deprecated 표시됐다([#43204](https://github.com/istio/istio/issues/43204)). 이전에 `helm install istio-base`나 `kubectl apply`로 CRD를 넣었다면 **1.24 업그레이드 전에 1회** 소유권 라벨·어노테이션을 붙여야 한다.

```bash
CRDS="$(kubectl get crds -l chart=istio -o name; kubectl get crds -l app.kubernetes.io/part-of=istio -o name)"
kubectl label   $CRDS "app.kubernetes.io/managed-by=Helm"
kubectl annotate $CRDS "meta.helm.sh/release-name=istio-base"      # 실제 Helm 릴리스명으로 교체
kubectl annotate $CRDS "meta.helm.sh/release-namespace=istio-system"  # 실제 네임스페이스로 교체
```

**우리 경로에서 이 항목이 위험한 이유는 릴리스명이다.** ArgoCD가 Helm 차트를 렌더링해 적용하면 클러스터에 있는 "Helm 릴리스명"이 무엇인지가 Application 정의에 달려 있고, 위 명령의 `release-name`이 그것과 어긋나면 소유권 이관이 아니라 **잘못된 소유권 주장**이 된다. 실제 값을 확인하지 않은 상태로는 이 명령을 실행하면 안 된다. blue-green으로 1.30.3을 처음부터 설치하는 경로라면 CRD가 애초에 신규 템플릿 방식으로 들어오므로 **이 절은 해당 없다** — 기존 green을 in-place로 통과시킬 때만 걸린다.

### 3.4 같은 릴리스의 나머지 설치 변경

`istiod-remote` 차트가 1.24.0에서 제거되고 `helm install istiod istio/istiod --set profile=remote`로 대체됐다. 업스트림이 "never been officially documented or stable"이라고 밝힌 경로이므로 remote/external control plane을 쓰지 않으면 무관하지만, 같은 upgrade-note가 덧붙인 문장은 넓게 적용된다 — **`istio-base` 차트 설치가 로컬·리모트 양쪽에서 이제 필수**다.

`istioctl` 쪽에서는 `istioctl manifest diff`·`manifest profile diff`·`profile`이 제거됐다(1.24 change-notes:275,277). CI에서 프로파일 diff로 드리프트를 검사하는 스텝이 있으면 **범용 YAML diff로 바꿔야 하고**, 이건 [04 설정을 코드로]({{< relref "04-config-as-code.md" >}})가 다루는 파이프라인에 직접 걸리는 변경이다.

## 4. API 그룹 승격과 Gateway API

### 4.1 `v1` 승격(1.22.0)은 추가이지 이동이 아니다

1.22.0에서 `networking.istio.io`(`DestinationRule`·`Gateway`·`ServiceEntry`·`Sidecar`·`VirtualService`·`WorkloadEntry`·`WorkloadGroup`)·`security.istio.io`(`PeerAuthentication`)·`telemetry.istio.io`(`Telemetry`)가 `v1beta1`에서 `v1`로 승격됐다. 공지의 논리는 "기능은 진작 stable이었는데 API 버전만 `v1beta1`에 머물러 있었다"는 것이다.

중요한 건 **CRD가 어떻게 바뀌었는가**다. 태그별 `crd-all.gen.yaml`을 직접 열어 `virtualservices.networking.istio.io`의 버전 블록을 보면 이렇다.

| 태그 | `v1` | `v1alpha3` | `v1beta1` |
|---|---|---|---|
| 1.20.0 · 1.21.0 | **없음** | served, **storage `true`** | served, storage `false` |
| 1.22.0 · 1.24.0 · 1.26.0 | served, storage `false` | served, storage `false` | served, **storage `true`** |
| **1.27.0** · 1.30.0 | served, **storage `true`** | served, storage `false` | served, storage `false` |

읽는 법이 셋이다. ① **`v1`은 1.22.0에서 CRD에 처음 등장한다** — 그 전에는 아예 없다. ② **storage 버전은 이 구간에서 한 번 움직인다** — 1.21.0까지는 `v1alpha3`가 storage였고 1.22.0에 `v1beta1`로 올라간다. `v1`로 넘어가는 것은 1.27.0이고, 그건 [17 1.25 → 1.30]({{< relref "17-changelog-1.25-1.30.md" >}}) 소관이다. ③ **세 버전 모두 1.30.0까지 `served: true`**다. 즉 `apiVersion: networking.istio.io/v1alpha3`로 쓴 옛 매니페스트는 목표 버전 1.30.3에서도 그대로 apply된다. **구버전 served 종료 예정일은 업스트림 문서에 명시가 없다.**

실무 결론: **기존 매니페스트를 일괄 치환할 이유가 없다.** 신규 리소스만 `v1`로 쓰고, 기존 것은 다른 이유로 그 파일을 만질 때 함께 올린다.

```yaml
# 1.22.0 이상에서 유효. v1beta1/v1alpha3로 쓴 기존 리소스도 1.30 기준 그대로 동작한다.
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: payments-egress
  namespace: finance
spec:
  host: gw.partner.example.com
  trafficPolicy:
    tls:
      mode: SIMPLE
      # 1.21.0부터 caCertificates를 안 주면 OS CA로 검증한다 (§5.2)
      caCertificates: /etc/ssl/certs/partner-ca.pem
```

1.23.0의 "내부 API protobuf 다중버전 통합"은 **다른 축**이다. 같은 메시지가 `v1alpha3`/`v1beta1`/`v1` 세 패키지에 중복 정의돼 있던 것을 하나로 합치고 나머지는 타입 alias로 남긴 변경이며, upgrade-note가 명시한 대로 **YAML로만 쓰면 영향이 전혀 없다.** Go(`istio.io/api`·`istio.io/client-go`)로 쓰면 alias 덕에 거의 무영향이고, Protobuf를 직접 쓰면서 새 버전 패키지를 참조했다면 그것만 깨진다.

### 4.2 Gateway API — Stable이 된 시점과 CRD 버전

| Istio | Gateway API 관련 사건 | `go.mod` 버전 |
|---|---|---|
| 1.20.0 | 업스트림 **v1.0 GA**에 맞춰 전면 지원 선언(conformant 구현). Istio 자체 CRD(`AuthorizationPolicy`·`RequestAuthentication`·`Telemetry`·`WasmPlugin`)를 Gateway API 리소스에 붙이는 `targetRef` 추가 | `v1.0.0` |
| 1.21.0 | 변화 없음(라이브러리만 v1.0 계열 pre-release로 이동) | `v1.0.1-0.2024…` |
| **1.22.0** | **"Gateway API now Stable for service mesh"** — v1.1 지원으로 ingress(north-south)와 mesh(east-west) **양쪽 다 Stable** 표시 | `v1.1.0` |
| 1.23.0 | 변화 없음 | `v1.1.0` |
| 1.24.0 | v1.2 계열로 이동 | `v1.2.0` |

`go.mod`의 값은 "Istio가 어느 Gateway API 스펙에 맞춰 빌드됐는가"이지 "클러스터에 어느 CRD를 넣어야 하는가"와 같은 값이 아니다. **권장 Gateway API CRD 버전은 istio.io의 현재 스냅샷 값(v1.6.0)만 확인되고 마이너별 이력은 로컬 근거로 확정하지 못했다** — 이 문서에서는 마이너별 CRD 버전을 단정하지 않는다.

### 4.3 classic `Gateway`/`VirtualService`를 계속 쓸 것인가

업스트림의 방향성은 명문화돼 있다 — *"Istio supports the Kubernetes Gateway API and intends to make it the default API for traffic management in the future."*(`content/en/boilerplates/gateway-api-future.md`). 그러나 **강제 전환 데드라인은 명시되지 않았고, classic `Gateway`·`VirtualService`를 deprecated로 지정한 공지는 1.20~1.30 어디에도 없다.** 두 API는 공존하고, 한쪽이 "미래의 기본값"으로 지목된 상태다.

| 상황 | 판정 |
|---|---|
| 이미 `Gateway`+`VirtualService`로 north-south가 돌고 있다 | **좋음** — 그대로 유지. 폐기 신호가 없고, 전환은 [07 nginx에서 Istio로]({{< relref "07-from-nginx-to-istio.md" >}})급 재작성 비용이다 |
| 신규 north-south 엔드포인트를 새로 판다 | **좋음** — Gateway API(`Gateway`+`HTTPRoute`). 1.22부터 Stable이고 미래의 기본값 |
| east-west(mesh) 라우팅을 Gateway API로 옮긴다 | **반쪽** — 1.22 이상에서 되지만 `VirtualService` 자산과 규칙이 갈리고, 같은 워크로드에 둘을 섞으면 안 된다 |
| `EnvoyFilter`로 저수준 패치가 걸려 있다 | **최적** — classic 유지. Gateway API로 옮겨도 [08 EnvoyFilter]({{< relref "08-envoyfilter-extension.md" >}})의 패치 대상은 그대로 Envoy이고, ambient waypoint로 가면 `EnvoyFilter` 자체가 지원되지 않는다(§2.3) |
| 전면 일괄 전환 | **부적합** — 이득이 "미래 기본값"뿐이고 데드라인이 없다 |

## 5. 버전별 나머지 — 동작이 바뀌는 것을 골라낸다

### 5.1 sidecar `startupProbe` 기본 on (1.20.0)

사이드카 컨테이너에 `startupProbe`가 기본 활성화됐다. 목적은 기동 구간에만 공격적으로 폴링해 평균 파드 기동 시간을 ~1초 줄이는 것이고, 대가로 **동작이 하나 바뀐다** — *"If the startup probe does not pass after 10 minutes, the pod will be terminated. Previously, the pod would never be terminated even if it was unable to start indefinitely."*

```yaml
# 1.20.0의 새 기본값. startupProbe를 끄고 1.19 동작으로 되돌릴 때는
# readiness를 같이 조정해야 한다 — initialDelay 1 / period 2 / failureThreshold 30
readinessInitialDelaySeconds: 0
readinessPeriodSeconds: 15
readinessFailureThreshold: 4
startupProbe:
  enabled: true
  failureThreshold: 600
```

**sidecar 유지 방침과 정합적인, 드물게 순이득인 변경**이다. 유일한 위험은 기동에 10분 넘게 걸리는 워크로드(대형 JVM 웜업, 대용량 인덱스 프리로드)로, 이전에는 무한정 기다렸던 파드가 이제 종료된다. `failureThreshold`를 올려 대응한다.

### 5.2 egress TLS를 끊을 수 있는 두 플래그 (1.21.0)

**둘 다 같은 릴리스에서 `false` → `true`가 됐고, 둘 다 `DestinationRule` TLS 오리지네이션에만 걸린다.** `ENABLE_AUTO_SNI`(`pilot.go:236`)는 `DestinationRule`이 SNI를 명시하지 않으면 다운스트림 `Host`/`:authority`로 SNI를 자동 설정한다. `VERIFY_CERTIFICATE_AT_CLIENT`(`pilot.go:239`)는 `caCertificates`가 없을 때 **OS CA 인증서로 서버 인증서를 검증한다.** 이전에는 `caCertificates` 미지정 시 검증이 아예 없었으니 보안상 옳은 방향이지만, **사설 CA·자체서명 인증서를 쓰는 egress 대상은 업그레이드 즉시 연결이 끊긴다.**

여기에 문서 함정이 있다. **1.21 upgrade-notes는 이 플래그를 `VERIFY_CERT_AT_CLIENT`로 적는다.** 그건 Go 변수명(`VerifyCertAtClient`)에 가깝고 `env.Register`의 실제 이름은 `VERIFY_CERTIFICATE_AT_CLIENT`다. 1.24 change-notes는 같은 플래그를 정확한 이름으로 적으므로 **문서 안에서도 표기가 갈린다.**

```bash
# 1) 영향 리소스를 업스트림 도구로 먼저 찾는다 (1.21에서 도입된 용법)
istioctl experimental precheck --from-version 1.20

# 2) caCertificates 없는 SIMPLE/MUTUAL TLS 오리지네이션 전수 조사
kubectl get destinationrule -A -o json | jq -r '
  .items[] | select(.spec.trafficPolicy.tls.mode // "" | test("SIMPLE|MUTUAL"))
  | select((.spec.trafficPolicy.tls.caCertificates // "") == "")
  | "\(.metadata.namespace)/\(.metadata.name) host=\(.spec.host)"'
```

대응은 `caCertificates`를 명시하는 것이 정석이고(§4.1의 yaml), 급할 때 `insecureSkipVerify: true`로 막았다가 CA를 정식 등록하는 순서가 차선이다. **`compatibilityVersion=1.20`으로 미루는 선택은 이제 없다** — 그 프로파일은 1.24.0에서 제거됐고 `VERIFY_CERTIFICATE_AT_CLIENT`는 Istio에서 **아예 삭제**됐다(1.24 change-notes: *"All of these flags, except for `ENABLE_AUTO_SNI`, have also been removed from Istio entirely."*).

### 5.3 `ExternalName` alias 전환 (1.20.0 예고 → 1.21.0 기본)

같은 변경이 두 릴리스에 걸쳐 있다. 1.20.0에서 `ENABLE_EXTERNAL_NAME_ALIAS=true` 옵트인으로 들어오고 1.21.0에서 기본이 된다. `ExternalName` Service를 **독립 서비스로 취급하던 방식을 alias로 바꾼 것**이고, 결과는 세 줄이다 — ① `ports` 필드가 불필요해지고 지정해도 무시된다(Kubernetes 동작과 일치). ② `VirtualService`는 **참조 대상 서비스(`Service` 또는 `ServiceEntry`)가 실제로 존재해야** 동작하며, 매칭을 참조 대상 쪽으로 다시 써야 한다. ③ `DestinationRule`은 `ExternalName` 서비스에 **더 이상 적용되지 않고**, `host`가 참조 대상을 가리키는 규칙을 새로 만들어야 한다.

`ExternalName`을 안 쓰면 무해하고, 쓰면 **정책이 조용히 안 붙는 형태**로 나타난다(에러 없이 mTLS·라우팅 규칙만 빠진다). 옵트아웃 수단도 없어졌다 — `ENABLE_EXTERNAL_NAME_ALIAS`는 1.24.0에서 플래그 자체가 제거됐다.

### 5.4 Delta xDS와 스코핑 기본값 (1.22.0) — 09이 다루는 축에 걸린다

**Delta(incremental) xDS가 기본이 됐다.** state-of-the-world 방식은 1,000개 서비스 중 하나가 바뀌어도 모든 사이드카에 1,000개를 다 보냈고, Delta는 바뀐 것만 보낸다. 공지가 든 기대 효과는 istiod·프록시의 CPU·메모리 감소와 둘 사이 네트워크 트래픽 감소인데, **"프로토콜을 incremental로 바꿨을 뿐 완벽한 최소 증분을 보내는 건 아니다"**라고 스스로 단서를 붙였다. 이상 동작 시 프록시에 `ISTIO_DELTA_XDS=false`를 걸고 이슈를 올리라는 것이 공식 안내다.

이 변경은 [09 istiod 스케일링과 xDS 커넥션 재분배]({{< relref "09-istiod-scaling-connections.md" >}})의 축과 정확히 겹친다. **버전이 바꾼 것은 "push 1건의 페이로드 크기"이고, 09이 말하는 "커넥션 1건의 단가 = 커넥션 수 × 클러스터 config 크기"라는 성질 자체는 바뀌지 않는다.** 커넥션이 재분배되지 않는 문제도, `GOMAXPROCS`가 `limits.cpu`로 정해지는 문제도 그대로다. Delta xDS는 그 곡선의 기울기를 낮추는 변경이고, 메커니즘과 손잡이는 09에서 본다.

**`ENABLE_ENHANCED_RESOURCE_SCOPING`이 기본 `true`가 됐다**([#49719](https://github.com/istio/istio/pull/49719), `experimental.go:182`). pilot이 `meshConfig.discoverySelectors` 스코프 안의 Istio CR만 처리하고, **root-ca 인증서 배포도 이 스코프를 따른다.** `discoverySelectors`를 설정하지 않았다면 전체 스코프가 유지되므로 무해하고, 설정해뒀다면 스코프 밖에서 동작하기를 기대한 것이 있는지 재검증해야 한다. 여기에도 표기 함정이 있다 — **1.22 upgrade-notes의 제목은 `ENHANCED_RESOURCE_SCOPING`이고 실제 등록명은 `ENABLE_ENHANCED_RESOURCE_SCOPING`이다.**

같은 릴리스의 나머지 동작 변경 둘. **`ServiceEntry`(`resolution: NONE`)가 `targetPort`를 존중하게 됐다**(`ENABLE_RESOLUTION_NONE_TARGET_PORT`, `experimental.go:209`, 기본 `true`) — 이전엔 무시됐으므로 `port ≠ targetPort`로 구성한 `ServiceEntry`는 **트래픽 목적지가 실제로 바뀐다.** 그리고 **암묵적 zipkin 트레이싱이 제거됐다** — 이전에는 트레이싱을 켜면 `zipkin.istio-system.svc`로 자동 전송됐다. zipkin 애드온만 깔아두고 `Telemetry` API 없이 트레이스를 받고 있었다면 업그레이드 후 트레이스가 끊긴다. `istioctl x precheck --from-version=1.21`이 이 항목을 직접 탐지한다고 upgrade-notes가 명시한다.

### 5.5 1.23.0의 메트릭 라벨 변경 — upgrade-notes 페이지에 없다

**공개 1.23 upgrade-notes 페이지에 실린 항목은 "Internal API protobuf changes" 하나뿐이다.** 그런데 같은 릴리스에 메트릭 라벨 파싱을 바꾸는 변경이 들어와 있다.

`ENABLE_DELIMITED_STATS_TAG_REGEX`가 1.23.0에 **기본 `true`로 등록**된다(`pilot/pkg/features/telemetry.go:63`, 도입 PR [#52271](https://github.com/istio/istio/pull/52271), 커밋 `cfc56940dc`). 근거 문서는 릴리스노트 원본 `releasenotes/notes/51761.yaml`의 `upgradeNote` 블록이고, 그 내용이 정확하다.

> *"Previously, the Envoy cluster metrics for services that did not have a `.svc.cluster.local` suffix were incorrectly truncated and parsed. … the regex for parsing the `cluster_name` has been updated to look for a semicolon to indicate the end of the cluster name. … If you have any dependency on the full stat name for cluster metrics, you will need to update your monitoring system to account for this change."*

Envoy cluster 메트릭은 `.`을 메트릭 네임스페이스 구분자로 쓰는데 호스트명에도 `.`이 들어가니 구분이 불가능했고, `.svc.cluster.local` 접미사가 없는 서비스의 `cluster_name`·`http_conn_manager_prefix` 라벨이 잘못 잘렸다. 1.23은 클러스터명 끝을 세미콜론으로 표시하도록 정규식을 바꿔 이를 고쳤다. `meshconfig`의 `inbound_cluster_stat_name`·`outbound_cluster_stat_name`을 쓰고 있으면 세미콜론이 자동 추가된다.

**운영 영향은 "옳게 고쳐진 것이 대시보드를 깨는" 종류다.** `.svc.cluster.local`이 아닌 호스트(외부 서비스, `ServiceEntry` 대상, 커스텀 도메인)의 `cluster_name` 라벨 값이 달라지므로, 그 라벨로 필터·집계하는 Grafana 패널과 알람 룰이 조용히 빈 결과를 낸다. 되돌리는 수단은 proxyConfig로 `ENABLE_DELIMITED_STATS_TAG_REGEX=false`를 걸거나 `compatibilityVersion=1.22`이고, 둘 다 영구 해법이 아니다 — 플래그와 코드 경로 자체가 1.26.0에서 제거됐다(커밋 `9986a0f8d9` "Remove ENABLE_DELIMITED_STATS_TAG_REGEX flag and code paths (#55207)", `git tag --contains` → 최초 `1.26.0`). **1.26 이상으로 가는 계획이면 이 항목은 "미룰 수 있는지"가 아니라 "언제 대시보드를 고칠지"의 문제다.** 관측 지점과 라벨 설계는 [06 메시가 공짜로 주는 관측성]({{< relref "06-observability-points.md" >}})이 소유한다.

같은 릴리스의 나머지: IP 자동할당이 재구현되어 할당된 IP가 `ServiceEntry`의 `status`에 영속되지만 **기본은 off**다(`PILOT_ENABLE_IP_AUTOALLOCATE=true`로 옵트인). 인바운드 리트라이가 프리뷰로 들어왔고 **기본 `false`**이며, 공지가 "expected to be on by default in future releases"라고 예고한다 — 그 예고가 §5.6이다.

### 5.6 1.24.0 — sidecar 트래픽 동작 7개가 한꺼번에 기본 on

`compatibilityVersion=1.23` 프로파일의 내용이 이 절의 목록 전체다. `manifests/helm-profiles/compatibility-version-1.23.yaml`(1.24.0 태그)이 정확히 이 7개를 `false`로 되돌린다 — 5개는 `pilot.env`로, 2개는 `meshConfig.defaultConfig.proxyMetadata`로.

| 플래그 | 기본값·위치 | 도입 PR | 무엇이 바뀌나 | sidecar 유지 클러스터의 영향 |
|---|---|---|---|---|
| `ENABLE_INBOUND_RETRY_POLICY` | `true` · `pilot.go:237` | [#52055](https://github.com/istio/istio/pull/52055) | **서버 사이드카**에서, 앱이 아직 처리하지 않은 요청이 커넥션 재사용 중 리셋되면 자동 재시도. 종래 리트라이는 클라이언트 사이드카 전용이었다 | **대개 이롭다** — 흔한 503 원인(백엔드가 닫는 keep-alive 커넥션 재사용)을 서버 쪽에서 흡수한다. [05 간헐적 응답 이상]({{< relref "05-incident-intermittent-5xx.md" >}})이 추적한 실패 모드와 같은 계열 |
| `EXCLUDE_UNSAFE_503_FROM_DEFAULT_RETRY` | `true` · `pilot.go:240` | [#52111](https://github.com/istio/istio/pull/52111) | **기본 재시도 정책에서 503 재시도를 제외.** 원래 위 실패 모드를 덮으려 넣었던 것인데 non-idempotent 요청에 위험하다고 판단 | **주의.** 503이 자동 재시도로 가려지고 있었다면 **클라이언트에 503이 더 많이 노출된다.** 안전성과 성공률이 맞바꿔진다 |
| `PILOT_UNIFIED_SIDECAR_SCOPE` | `true` · `experimental.go:208` | [#51776](https://github.com/istio/istio/pull/51776) | `Sidecar` 리소스 유무에 따라 갈리던 충돌 해소 규칙 통일(아래 별도 설명) | **직접 영향.** `Sidecar` CR을 쓰거나 동일 hostname 중복 정의가 있으면 라우팅 대상이 바뀔 수 있다 |
| `ENABLE_ENHANCED_DESTINATIONRULE_MERGE` | `true` · `experimental.go:204` | [#52636](https://github.com/istio/istio/pull/52636) | `exportTo`가 다른 동일 호스트 `DestinationRule`을 **더 이상 병합하지 않는다** | 동일 host에 `exportTo`를 달리 준 DR이 중복 정의돼 있으면 적용 결과가 달라진다 |
| `PREFER_DESTINATIONRULE_TLS_FOR_EXTERNAL_SERVICES` | `true` · `pilot.go:243` | [#52597](https://github.com/istio/istio/pull/52597) | mesh-external 호스트에서 `DestinationRule` TLS가 메타데이터 TLS보다 우선 | egress 대상에 TLS DR을 걸어뒀으면 동작이 바뀐다. §5.2와 같은 리소스를 건드린다 |
| `ENABLE_DEFERRED_STATS_CREATION` | `true` · `experimental.go:194` | [#52654](https://github.com/istio/istio/pull/52654) | Envoy stats 객체 일부를 지연 초기화(메모리·CPU 절감) | 파드마다 사이드카가 붙는 구성에서 **누적 이득**. `proxyMetadata`로 전달 |
| `BYPASS_OVERLOAD_MANAGER_FOR_STATIC_LISTENERS` | `true` · `experimental.go:201` | [#52971](https://github.com/istio/istio/pull/52971) | static listener에 overload manager 미적용 | 성능 최적화. `proxyMetadata`로 전달 |

**`PILOT_UNIFIED_SIDECAR_SCOPE`가 이 목록에서 가장 위험하다.** upgrade-notes가 세 가지 규칙을 나란히 적어놓은 것이 근거다.

| 케이스 | `Sidecar` 없을 때(이전) | `Sidecar` 있을 때(이전) | 1.24.0 통일 규칙 |
|---|---|---|---|
| 같은 hostname으로 정의된 서비스가 여러 개 | Kubernetes `Service` 우선(`ServiceEntry` 아님), 아니면 임의 선택 | **프록시와 같은 네임스페이스의 Service 우선**, 아니면 임의 선택 | 같은 네임스페이스 Service → Kubernetes Service(`ServiceEntry` 아님) → 임의 |
| 같은 서비스에 Gateway API Route가 여러 개 | 로컬 프록시 네임스페이스 우선(consumer override 허용) | **임의 순서** | 로컬 프록시 네임스페이스 우선 |

문제의 성질은 "`egress: "*/*"`만 있는, 즉 아무것도 제한하지 않는 `Sidecar` 리소스만 있어도 동작이 달라졌다"는 것이다. upgrade-notes가 그 점을 명시한다 — *"This applied even if the `Sidecar` resource with just `egress: "*/*"`, which should be the same as not having one defined."* 즉 **`Sidecar` CR을 스코핑 최적화 목적으로만 넣어둔 네임스페이스도 영향권**이고, [02 컨트롤 플레인 해부]({{< relref "02-istiod-control-plane.md" >}})가 권하는 스코핑을 성실히 적용한 클러스터가 오히려 더 넓게 걸린다.

```bash
# 1) Sidecar CR을 쓰는 네임스페이스 인벤토리
kubectl get sidecar -A

# 2) 동일 hostname이 Service와 ServiceEntry로 중복 정의됐는지
kubectl get serviceentry -A -o json | jq -r '.items[].spec.hosts[]' | sort -u > /tmp/se.txt
kubectl get svc -A -o json \
  | jq -r '.items[] | "\(.metadata.name).\(.metadata.namespace).svc.cluster.local"' | sort -u > /tmp/svc.txt
comm -12 /tmp/se.txt /tmp/svc.txt
```

**완충 수단은 있지만 유효기간이 있다.** `compatibilityVersion=1.23`으로 7개를 한꺼번에 되돌린 뒤 점진 전환할 수 있는데, 업스트림 문서가 그 수명을 정해뒀다 — *"Compatibility versions for a release will be removed, and will no longer be supported, when the release they refer to reaches end-of-life."* 1.23은 2025-04-16에 EOL이므로 **이 완충은 이미 존재하지 않는다.** 태그별 프로파일 목록이 그 규칙대로 움직인다: 1.24.0에는 `compatibility-version-{1.21,1.22,1.23}.yaml`이, 1.25.0에는 `{1.22,1.23,1.24}`가 있다 — **항상 직전 3개만 유지된다.**

```bash
# 새 설치라면 프로파일로 7개를 한꺼번에 되돌릴 수 있다 (해당 릴리스가 지원 중일 때만)
helm install istiod istio/istiod -n istio-system --set compatibilityVersion=1.23

# 개별 플래그만 되돌릴 때 — pilot.env 5개 / proxyMetadata 2개로 나뉜다
helm upgrade istiod istio/istiod -n istio-system \
  --set pilot.env.PILOT_UNIFIED_SIDECAR_SCOPE=false \
  --set meshConfig.defaultConfig.proxyMetadata.ENABLE_DEFERRED_STATS_CREATION=false
```

### 5.7 1.24.0의 나머지 breaking

| 항목 | 내용 | 우리가 할 일 |
|---|---|---|
| **Telemetry CEL 표준화** | CEL이 커스텀 Wasm 속성 대신 표준 Envoy 속성을 쓴다. `filter_state["wasm.downstream_peer"]` → `filter_state.downstream_peer`, `node` → `xds.node`. 커스텀 Wasm 속성은 완전 수식 필요(`filter_state["wasm.istio_responseClass"]`) | `kubectl get telemetry -A -o yaml`에서 `filter_state`·`node.` grep. **기본 제공 메트릭·액세스 로그는 영향 없다**(Istio가 이미 맞춰 배포). 혼합 프록시 환경은 `has(...)` presence 연산자로 양쪽을 받는 식을 쓸 수 있다 |
| **`istio-csr` ALPN 호환성** | 컨트롤 플레인 **내부 gRPC** 검증 강화(사용자 트래픽 아님). cert-manager `istio-csr`이 걸리고 **`v0.12.0`에는 fix가 없다**. 증상은 `"transport: authentication handshake failed: credentials: cannot check peer: missing selected ALPN property"` | 외부 CA로 `istio-csr`을 쓰는지 확인. 쓰면 fix 포함 버전으로 올리거나 `meshConfig.defaultConfig.proxyMetadata.GRPC_ENFORCE_ALPN_ENABLED: "false"` |
| **`istio.io/gateway-name` 라벨 제거** | 1.21.0에서 `gateway.networking.k8s.io/gateway-name`으로 바뀌며 병기됐던 구 라벨이 1.24.0에서 제거 | Grafana 쿼리·정책 셀렉터·스크립트에서 구 라벨 grep. **1.21~1.23 사이에 갱신하지 않은 채 1.24로 오면 여기서 끊긴다** |
| **Helm values 11개 제거** | `pilot.{configNamespace,configSource,enableProtocolSniffingForOutbound,enableProtocolSniffingForInbound,useMCP}`, `global.{autoscalingV2API,configRootNamespace,defaultConfigVisibilitySettings,useMCP}`, `sidecarInjectorWebhook.{objectSelector,useLegacySelectors}` ([#51987](https://github.com/istio/istio/issues/51987)). 별도로 `istiod` 차트의 `istio_cni` values 제거([#52645](https://github.com/istio/istio/issues/52645), 1.22에서 [#49290](https://github.com/istio/istio/issues/49290)으로 폐기 예고) | values.yaml에서 위 키 grep. change-notes가 "had been without effect and in some cases long-deprecated"라고 밝혔듯 **이미 무효였던 값이 많지만, 제거 후에도 에러가 아니라 무시**라 죽은 설정이 남는다 |
| **`sidecar.istio.io/enableCoreDump`·`--log_rotate_*` 제거** | 코어덤프 어노테이션과 레거시 로그 로테이션 플래그 삭제 | 각각 `samples/proxy-coredump` 방식과 외부 로그 로테이션 도구로 이관([logging 챕터]({{< relref "../logging/_index.md" >}})의 수집 경로와 함께 결정) |
| **`1.20` compat profile 제거** | `ENABLE_EXTERNAL_NAME_ALIAS`·`PERSIST_OLDEST_FIRST_HEURISTIC_FOR_VIRTUAL_SERVICE_HOST_MATCHING`·`VERIFY_CERTIFICATE_AT_CLIENT`는 **플래그 자체가 삭제**되고 `ENABLE_AUTO_SNI`만 남았다 | 1.20 동작에 의존했다면 되돌릴 방법이 없다. §5.2·§5.3의 적응이 끝났는지 확인 |

### 5.8 native sidecar는 이 구간이 아니다

혼동하기 쉬운 지점이라 명시한다. 1.24.0이 추가한 것은 **파드 단위 오버라이드 어노테이션 `sidecar.istio.io/nativeSidecar`뿐**이고, 전역 기본값은 이 구간 내내 `false`다 — `env.Register("ENABLE_NATIVE_SIDECARS", false, …)`(1.24.0 태그, `experimental.go:181`). 인젝션 템플릿이 그 어노테이션과 env를 함께 보고 `restartPolicy: Always`를 붙일지 결정한다(`injection-template.yaml:27,173`, 1.24.0 태그).

즉 **1.24까지는 `istio-proxy`가 일반 컨테이너**다. init 컨테이너(`restartPolicy: Always`)로 바뀌면서 Job/CronJob 완료·기동 순서·readiness 세맨틱이 흔들리는 사건은 1.27이고, [11 1.25 → 1.30]({{< relref "17-changelog-1.25-1.30.md" >}}) 소관이다. 이 구간에서 필요한 조치는 없다.

**proxy(사이드카) 기본 CPU·메모리 requests/limits의 변경**은 1.20~1.24 change-notes 전체에서 찾지 못했다 — **업스트림 문서에 명시 없음**으로 남긴다. 1.21의 파드당 ~5MB RAM 절감은 바이너리 축소에 따른 실사용량 서술이고 기본 requests/limits 값의 변경이 아니다.

## 6. 버전별 운영 판단 표

전제: sidecar 유지·ambient 금지, 목표 1.30.3, 하한 가정 chart tip 1.24.1, 라이브 버전 미확인, ArgoCD로 Helm 차트 렌더링. 절차·차트·values는 [eks-upgrade/istio]({{< relref "../eks-upgrade/components/02-istio.md" >}}) 소유.

| 버전 | 얻는 것 | 조심할 것 | 우리가 할 조치 |
|---|---|---|---|
| **1.20** | Gateway API v1.0 전면 지원 + Istio CRD `targetRef`. 사이드카 기동 ~1초 단축 | `startupProbe` 10분 타임아웃 — 기동 느린 워크로드가 종료된다 | 기동 10분 초과 워크로드가 있으면 `startupProbe.failureThreshold` 상향. **없으면 조치 불필요** |
| **1.21** | `compatibilityVersion`이라는 완충 장치 자체가 생긴다. 사이드카 이미지 25%↓·파드당 ~5MB RAM↓ | **egress TLS 두 플래그 기본 on** — 사설 CA 대상 연결 끊김. Gateway 라벨 키 교체. Telemetry legacy 필드 4종 무반영 | **`caCertificates` 없는 SIMPLE/MUTUAL DR 전수 조사**(§5.2). 구 Gateway 라벨 grep. `prometheus.configOverride`·`stackdriver.*` 3종 grep 후 `Telemetry` API 이전 |
| **1.22** | Delta xDS(istiod·프록시 부하 감소), Istio API `v1`, Gateway API mesh Stable, `AuthorizationPolicy` path 템플릿 | 암묵적 zipkin 트레이싱 제거. `ServiceEntry resolution: NONE`의 `targetPort` 존중으로 **목적지가 바뀐다**. `discoverySelectors` 스코프가 root-ca 배포까지 좁힌다 | 트레이싱을 `Telemetry` API로 명시 구성했는지 확인. `port ≠ targetPort` `ServiceEntry` grep. `discoverySelectors` 설정 여부 확인(미설정이면 무해) |
| **1.23** | ambient 개선(미사용). in-cluster operator 폐기 **공지** — 이관 유예가 여기서 시작된다 | **메트릭 라벨 파싱 변경이 공개 upgrade-notes에 없다**(§5.5). 플래그 4종 제거 | **`cluster_name`·`http_conn_manager_prefix` 라벨을 쓰는 Grafana 패널·알람 룰 전수 점검.** operator 사용 여부 확인(§3.2) |
| **1.24** | ambient GA(미사용), `manifest translate`, CRD를 Helm으로 업그레이드 가능 | **in-cluster operator 제거 — 안 이관하면 여기서 막힌다.** CRD 소유권 이관 1회. **sidecar 동작 7개 기본 on.** k8s 상한 1.31 | ① operator 사용 여부 확인 → 쓰면 Helm/istioctl 이관. ② CRD `label/annotate` 1회(**ArgoCD 릴리스명 확인 선행**). ③ `kubectl get sidecar -A` + 동일 hostname 중복 점검. ④ 503 자동 재시도 의존 워크로드 점검. ⑤ `istio-csr` 사용 여부 확인. ⑥ 커스텀 CEL `Telemetry` grep |

**blue-green으로 1.30.3을 직행 설치하는 경로에서 자동으로 회피되는 항목**이 넷이다 — ① 1.24 CRD Helm 소유권 이관(새 설치는 처음부터 템플릿 방식), ② in-cluster operator 이관(새 설치에 operator가 없다), ③ 1.21 Gateway 라벨 교체(새 리소스는 신 라벨), ④ compat profile 부재(애초에 최신 동작으로 시작). 반대로 **직행에서도 그대로 맞는 것**은 §5.2의 egress TLS 검증·§5.6의 `Sidecar` 스코핑·DR 병합·§5.7의 CEL(전부 매니페스트가 이월되므로)과 §5.5의 메트릭 라벨(대시보드는 클러스터를 안 따라간다), `istio-csr`(외부 CA 구성이 이월되므로)이다. **"새로 설치하니 업그레이드 노트는 무관하다"가 성립하는 것은 클러스터 상태에 관한 항목뿐이고, 매니페스트와 대시보드에 관한 항목은 그대로 따라온다.**

## 7. 업그레이드 경로 — 이 구간이 만드는 제약

### 7.1 마이너 스킵 정책 — 방식에 따라 1과 2로 갈린다

세 개의 공식 문장이 서로 다른 층위에 있다.

| 층위 | 문장 | 출처 |
|---|---|---|
| 전체 공통 경고 | "Upgrading across **more than two** minor versions (e.g., `1.6.x` to `1.9.x`) in one step is not officially tested or recommended." | `docs/setup/upgrade/_index.md` |
| revision 기반(canary) | "jumping across **two** minor versions is supported (e.g. upgrading directly from version `1.15` to `1.17`)." | `docs/setup/upgrade/canary/index.md` |
| in-place | "The installed Istio version is **no more than one minor version less** than the upgrade version." — 중간 마이너를 전부 순서대로 거쳐야 한다. 다운그레이드도 1마이너 이내. `--revision`으로 설치한 것은 `istioctl upgrade`로 못 올린다 | `docs/setup/upgrade/in-place/index.md` |

즉 **1.24 → 1.30(6마이너)은 어느 방식으로도 단일 스텝이 아니다.** 공식 지원 안에서 가장 짧은 경로는 canary로 2마이너씩 뛰는 것 — 1.24 → 1.26 → 1.28 → 1.30, 3홉. in-place면 6홉 전부다. 컨트롤/데이터 플레인 스큐는 "컨트롤 플레인이 데이터 플레인보다 **한 버전 앞설 수 있고, 반대는 안 된다**"가 규칙이며, revision을 쓰면 스큐 자체를 없앨 수 있다.

revision canary 절차 자체는 이 구간에서 바뀌지 않았다. 다만 라벨 순서 하나가 이 구간에도 그대로 걸린다 — 네임스페이스에서 **`istio-injection`을 먼저 제거한 뒤** `istio.io/rev=<name>`을 붙여야 한다. `istio-injection`이 하위호환을 위해 `istio.io/rev`보다 우선 적용되므로 순서가 뒤바뀌면 라벨을 붙여도 옛 revision이 이긴다. `default` 프로파일에서 게이트웨이는 revision별 인스턴스가 아니라 in-place로 새 revision을 따라간다. 상세 절차는 [eks-upgrade/istio]({{< relref "../eks-upgrade/components/02-istio.md" >}})가 소유한다.

업그레이드 전 `istioctl x precheck` 실행이 canary·in-place 공통 권장이고, `--from-version`을 주면 **compat profile이 필요한지까지 판정한다**. 1.21이 도입한 이 용법이 이 구간 전체의 표준 사전 점검 수단이다.

### 7.2 k8s 상한이 만드는 제약 — 1.24는 이미 선택지가 아니다

**1.24 계열은 k8s 1.28~1.31만 지원한다.** 이게 두 개의 결론을 강제한다.

① **k8s 1.33 클러스터에서 1.24는 지원 대상 밖이다.** "일단 1.24로 맞춰두고 나중에 올린다"는 선택이 성립하지 않는다.

② **1.24는 2025-06-24에 EOL됐다.** 지원 정책은 "N+2 마이너 릴리스 후 6주까지"이고(`docs/releases/supported-releases/index.md`), 오늘(2026-07-30) 기준 지원 중인 마이너는 **1.29와 1.30 둘뿐**이다. 1.28도 2026-07-01에 EOL됐다. 하한 가정(chart tip 1.24.1)은 **13개월 전에 EOL된 버전을 기준선으로 잡고 있다는 뜻이고, 그 자체가 시급성의 근거다.** 목표 1.30.3은 지원 여유가 남은 유일한 선택지다.

여기서 §5.6의 완충 수단이 사라지는 것과 맞물린다. compat profile은 **가리키는 릴리스가 EOL되면 제거**되므로, 1.24로 갈 때 `compatibilityVersion=1.23`을 쓰는 선택은 지금 존재하지 않는다. 1.30으로 갈 때 쓸 수 있는 것은 1.30.0 태그가 들고 있는 직전 3개 프로파일뿐이다. **"일단 옛 동작으로 깔고 나중에 전환한다"는 전략의 유효기간은 릴리스 지원 기간과 같다.**

## 8. 근거

아래 `news/...`·`docs/...`는 `/Users/mont/evejuni/istio-io/content/en/` 기준, 그 외 경로는 `github.com/istio/istio` 레포 루트 기준이며 **모든 코드·차트·CRD 인용은 해당 태그를 체크아웃해 확인**했다(`git show <tag>:<path>`).

| 무엇 | 출처 |
|---|---|
| 버전별 필요 조치·breaking | `news/releases/{1.20,1.21,1.22,1.23,1.24}.x/announcing-<v>/upgrade-notes/index.md` 전문 |
| 버전별 변경 목록·제거 항목 | 같은 경로의 `change-notes/index.md`. 1.20 removed:106,110,182,231 · 1.21 removed:155,234,245,247,304,307,309,376 · 1.22 deprecated:17 / removed:60,122,125,127,152,172,205,233,242 · 1.24 removed:237-238,246-248,250,252,275,277 |
| 릴리스 맥락·지원 k8s·ambient 단계 | 같은 경로의 `_index.md`의 `tip` 블록과 "What's new" 절. 릴리스일은 gh release API |
| in-cluster operator 폐기 이유·이관 절차·"istioctl install은 영향 없음" | `blog/2024/in-cluster-operator-deprecation-announcement/index.md` 전문 |
| operator 제거의 코드 근거 | commit `c2b027c4e0`(#52090), `git tag --contains` → 최초 `1.24.0`. `git ls-tree -r 1.23.0 manifests/charts/istio-operator/` 19개 파일 → `1.24.0` 0개. `istioctl/cmd/root.go`의 `OperatorCmd` 1.23.0에 있음 / 1.24.0에 없음 |
| `IstioOperator` API 타입 생존 | `git ls-tree -r 1.30.0 operator/pkg/apis/`, `operator/pkg/apis/types.go`(주석에 `apiVersion: install.istio.io/v1alpha1` 명시) |
| 1.24 플래그 7종의 기본값·도입 PR | `1.24.0:pilot/pkg/features/pilot.go:237,240,243`과 `…/experimental.go:194,201,204,208` — 전부 `env.Register(..., true, ...)`. 도입 PR은 `git log -S<flag> -- pilot/pkg/features/`로 #52055·#52111·#51776·#52636·#52597·#52654·#52971 |
| compat profile 내용·3개 유지 규칙·수명 | `git show 1.24.0:manifests/helm-profiles/compatibility-version-{1.21,1.22,1.23}.yaml`, `git ls-tree --name-only 1.25.0 manifests/helm-profiles/`(1.22·1.23·1.24만 존재), `docs/setup/additional-setup/compatibility-versions/index.md` |
| 1.21·1.22 플래그의 실제 등록명 | `1.21.0:pilot/pkg/features/pilot.go:236,239`(`ENABLE_AUTO_SNI`·`VERIFY_CERTIFICATE_AT_CLIENT`), `1.22.0:…/experimental.go:182`(`ENABLE_ENHANCED_RESOURCE_SCOPING`, 전환 커밋 `2e87d2a82f`/#49719), `:209`(`ENABLE_RESOLUTION_NONE_TARGET_PORT`) — 앞의 둘은 upgrade-notes 표기와 불일치 |
| 1.23 메트릭 라벨 변경 | `1.23.0:pilot/pkg/features/telemetry.go:63`(기본 `true`), 도입 커밋 `cfc56940dc`(#52271), 서술은 `1.23.0:releasenotes/notes/51761.yaml`의 `upgradeNote`. 제거는 `9986a0f8d9`(#55207), 최초 `1.26.0` |
| `v1` 승격의 CRD 실측 | 태그별 `manifests/charts/base/{crds,files}/crd-all.gen.yaml`의 `virtualservices.networking.istio.io` 버전 블록 — `v1` 최초 등장 1.22.0, storage 이동 1.27.0, 세 버전 모두 1.30.0까지 served |
| native sidecar가 이 구간 밖임 | `1.24.0:pilot/pkg/features/experimental.go:181`(`ENABLE_NATIVE_SIDECARS`, 기본 `false`), `1.24.0:manifests/charts/istio-control/istio-discovery/files/injection-template.yaml:27,173` |
| Gateway API 라이브러리 버전·방향성 | `git show <tag>:go.mod`의 `sigs.k8s.io/gateway-api`(1.20.0=v1.0.0 · 1.22.0=v1.1.0 · 1.24.0=v1.2.0), `boilerplates/gateway-api-future.md` |
| ambient 데이터패스·컴포넌트·공존 | `docs/ambient/architecture/data-plane/index.md`, `…/traffic-redirection/index.md`(istio-cni ↔ ztunnel netns 협업, 포트 15008·15006·15001), `docs/ambient/overview/index.md`(공존 tip 블록) |
| ambient 하드 블로커·제약, sidecar가 폐기 트랙이 아님 | `docs/ambient/migrate/_index.md`(스스로 "current stable Istio release" 기준임을 명시), `docs/overview/dataplane-modes/index.md`, 그리고 1.20~1.24 upgrade-notes·change-notes에 sidecar deprecate 문구 부재 |
| 마이너 스킵·스큐·precheck·EOL·Envoy 표 부재 | `docs/setup/upgrade/{_index,canary/index,in-place/index}.md`, `docs/releases/supported-releases/index.md`(Support policy, Supported Envoy Versions는 1.28.x부터만 기재), `data/compatibility/supportStatus.yml` |
