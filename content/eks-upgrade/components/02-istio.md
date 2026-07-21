---
title: "istio — →1.30.3, sidecar 유지·ambient 금지"
weight: 2
---

# istio — →1.30.3, sidecar 유지·ambient 금지

{{< callout type="info" >}}
**한눈에**
- **제약(변경 불가)**: 이 업그레이드는 **sidecar data plane 유지**가 전제다. ztunnel/waypoint 기반 ambient mesh로의 전환은 범위 밖이며 어떤 단계에서도 시도하지 않는다 `✓`
- **선행 필수(체크리스트 1번)**: finance 워크로드의 라이브 istiod/proxy 버전이 **미확인**이다. 배포 차트의 정확한 appVersion을 diff할 수 없어, 반드시 `istioctl version` 등으로 실측을 먼저 확정한 뒤 나머지를 산정해야 한다 `?`
- 목표 **1.30.3**(2026-07-16 릴리스)은 istio.io 최신 stable이고, k8s 1.33을 포함한 1.32~1.36을 지원한다 `✓`
- **1.29+에서 base/istiod Helm 차트가 통합**되며 리소스 이름이 바뀐다(`ClusterRole istiod` → `istiod-clusterrole`) — 커스텀 role-binding이 구 이름을 참조하면 깨진다 `✓`
- blue-green 신규 클러스터라면 **canary 홉 체인 없이 1.30.3을 처음부터 직행 설치**할 수 있다. 기존 green을 in-place로 올릴 경우에만 revision 기반 canary 홉이 필요하다 `✓`
{{< /callout >}}

## 왜 필수인가, 그리고 무엇이 바뀌는가

istio 1.24 계열은 k8s ~1.31까지만 지원하므로 1.33에서는 아예 지원 대상 밖이다. 비-EOL로 1.33을 지원하는 최소가 1.29, 최신이 1.30이라 목표를 **1.30.3**으로 잡는다. 라이브 버전이 실제로 몇인지는 이 문서 작성 시점에 확인되지 않았다 — 배포 차트의 README 이력 배지가 훨씬 오래된 버전까지 내려가므로, 최소한 chart tip(1.24.1)을 하한으로 가정하고 작성했다는 점을 감안해야 한다.

sidecar 관점에서 영향 있는 변화만 추리면 세 구간이 중요하다.

- **1.26→1.27**: native sidecar가 기본 활성화된다. `istio-proxy`가 일반 컨테이너에서 init 컨테이너(`restartPolicy: Always`)로 바뀌면서 Job/CronJob 완료·기동 순서·readiness 세맨틱이 달라진다. finance가 쓰는 `holdApplicationUntilProxyStarts` 설정과 상호작용하므로 워크로드별 검증이 필요하다. native sidecar는 k8s 1.29에서 beta·기본이고 목표 클러스터(1.33)에서는 GA라 지원 자체는 확실하다.
- **1.28→1.29**: base·istiod 차트가 통합되며 중복 설정이 istiod 차트로 이관된다. `ClusterRole istiod`가 `istiod-clusterrole`로 이름이 바뀌는 것처럼 리소스 이름이 바뀌므로, base가 더 이상 만들지 않는 리소스나 이름이 바뀐 ClusterRole을 참조하는 커스텀 바인딩이 있는지 점검해야 한다. 신규 설치는 클린하게 올라가지만 in-place는 orphan 정리가 필요하다.
- **1.29→1.30(목표)**: XDS 디버그 엔드포인트(포트 15010)가 인증을 요구하게 되면서 Kiali 같은 관측 도구가 영향을 받을 수 있다. Kiali를 함께 올린다면 1.30 요건인 2.26+로 lockstep bump가 필요하다. 네임스페이스 선택 로직도 바뀌어 동일 hostname이 여러 네임스페이스에 있으면 "Kubernetes Service 우선"으로 순서가 바뀐다.

finance가 실제로 쓰는 EnvoyFilter 2개(`local-reply` SIDECAR_OUTBOUND·`ingressgateway-local-reply` GATEWAY)는 안정적인 Envoy v3 API를 쓰므로 1.25~1.30 릴리스노트에 깨짐 항목은 없다. 다만 EnvoyFilter는 버전을 보증하지 않는 API이므로 매 목표 버전에서 istiod validation과 실제 Envoy config_dump 렌더를 검증해야 한다.

## finance 적용 절차

### 경로 A — blue-green 신규 클러스터(권장·직행)

신규 1.33/1.35 클러스터에는 canary 홉 체인이 필요 없다. istio 1.30.3을 처음부터 직접 설치한다.

1. **차트 리워크** — `base`/`istiod` 의존성과 appVersion을 1.30.3으로 올리고 차트 버전을 bump해 재퍼블리시한다. revision/tag 값도 신 버전으로 갱신한다.
2. **이미지 미러** — proxyv2·pilot·install-cni 1.30.3을 사전에 ECR 미러로 push한다.
3. **app-of-apps 핀 갱신** — chart targetRevision을 신 버전으로 교체하고, 신규 클러스터 API 서버 엔드포인트로 destination을 교체한다.
4. **배포 순서** — base CRD → istiod(신 revision + default tag) → istio-ingressgateway → EnvoyFilter/AuthorizationPolicy/RequestAuthentication → istiod의 KEDA 기반 오토스케일링(KEDA 앱이 선행돼 있어야 한다).
5. **검증** — `istioctl version`으로 목표 버전 일치, `istioctl proxy-status`로 전 sidecar SYNCED, sidecar 주입이 native init-container 형태인지, EnvoyFilter가 실제로 반영되는지, gateway 라우팅/타깃그룹 바인딩, VirtualService hosts 응답을 확인한다.
6. Kiali를 함께 쓴다면 별도 major 마이그레이션으로 2.26+까지 올린다.

### 경로 B — 기존 green in-place(canary revision)

라이브 버전을 확정한 뒤 2 마이너 점프까지 지원하는 공식 canary 절차를 쓴다. 하한 1.24 가정으로 `1.24 → 1.26 → 1.28 → 1.30` 3홉이며, 라이브가 더 오래됐으면 홉이 늘어난다. 홉마다 신규 revision istiod를 기존과 병존 설치 → 네임스페이스 revision tag를 flip → 전 sidecar 워크로드/gateway를 rolling restart → `istioctl proxy-status`로 전량 SYNCED 확인 → 구 revision decommission 순서를 반복한다. `1.26→1.28` 홉에서 native sidecar 전환이 함께 일어나므로 Job/CronJob·webhook 컨트롤러를 사전 검증해야 한다.

**경로 분기는 아직 확정되지 않았다** — 상위 문서 간에 "신규 클러스터 직행"과 "기존 green in-place"가 상충하는 서술이 남아 있었으므로, 실제 작업 전에 팀이 확정해야 한다. 차트/이미지 리워크·ECR 미러·Kiali 절차는 두 경로에서 동일하다.

## 리스크 체크리스트

- [ ] **라이브 버전 확정(최우선)** — `istioctl version` + istiod 이미지 태그 + `istioctl proxy-status`로 실제 control/data plane 버전을 확정하지 않으면 나머지 홉 산정이 무의미하다.
- [ ] **경로 분기 확정** — blue-green 직행 vs in-place canary.
- [ ] **ambient 미전환 재확인** — 어느 단계에서도 ztunnel/waypoint 도입 금지.
- [ ] **native sidecar(1.27+) 영향** — Job/CronJob 완료, mutating webhook, readiness gate, `holdApplicationUntilProxyStarts` 상호작용을 워크로드별로 검증한다.
- [ ] **EnvoyFilter 렌더 검증** — 목표 버전 istiod가 두 EnvoyFilter를 accept하고 local_reply MERGE가 실제로 반영되는지 확인한다.
- [ ] **base/istiod 차트 통합(1.29+)** — ClusterRole 등 리소스 rename을 참조하는 커스텀 role/role-binding이 있는지 점검한다.
- [ ] **디버그 엔드포인트 인증(1.29/1.30)** — Kiali를 2.26+로 lockstep하지 않으면 topology/config 조회가 실패할 수 있다.
- [ ] **이미지 ECR 미러 누락** — 1.30.3 proxyv2/pilot/install-cni 미러가 없으면 ImagePullBackOff.
- [ ] **KEDA 의존** — istiod가 KEDA ScaledObject로 오토스케일되므로 KEDA 자체 업그레이드({{< relref "04-secrets-autoscaling.md" >}})와 순서를 맞춘다.
- [ ] **Gateway API CRD 유입 여부(1.30)** — finance는 classic Gateway를 쓰지만, 클러스터에 k8s Gateway API CRD가 이미 설치돼 있으면 1.30은 v1.5.x를 요구한다.
- [ ] **트래픽 컷오버 검증** — VirtualService hosts 응답과 타깃그룹 바인딩이 정상인 뒤 트래픽을 전환한다.

## 근거

- 지원 릴리스·k8s 호환 매트릭스: `https://istio.io/latest/docs/releases/supported-releases/`
- canary/revision 업그레이드, 2-마이너 스킵 지원: `https://istio.io/latest/docs/setup/upgrade/canary/`
- 마이너별 upgrade-notes(1.25~1.30, native sidecar, base/istiod 통합, 디버그 엔드포인트 인증): `https://istio.io/latest/news/releases/`
- Kiali 호환(1.30→2.26+): `https://kiali.io/docs/installation/installation-guide/prerequisites/`
