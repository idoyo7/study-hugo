---
title: "istio — →1.30.3, sidecar 유지·ambient 금지"
weight: 2
---

# istio — →1.30.3, sidecar 유지·ambient 금지

{{< callout type="info" >}}
**한눈에**
- **제약(변경 불가)**: data plane 은 **sidecar 유지**가 전제입니다. ztunnel/waypoint 기반 ambient mesh 전환은 범위 밖이고 어떤 단계에서도 시도하지 않습니다 `✓`
- **경로는 A(1.35 신규 클러스터 직행)로 확정됐다** — 2026-08-05 의 EKS 1.35 · istio 1.30 결정이 근거입니다. 아래 경로 B 서술은 "왜 안 되는가"의 근거로만 남깁니다 `✓`
- **라이브 버전은 여전히 미확인**이지만 경로 A 확정으로 성격이 바뀌었다 — 홉 산정용 blocking 이 아니라 **green↔blue values·EnvoyFilter 설정 parity 확인용**입니다. 그래도 컷오버 전에 `istioctl version` 으로 실측은 남깁니다 `?`
- 목표 **1.30.3**(2026-07-16 릴리스)은 istio.io 최신 stable 이고 지원 k8s 가 **1.32~1.36** 이라 목표 클러스터 **1.35** 를 포함합니다 `✓`
- **경로 B(기존 green in-place)로는 1.30.3 에 도달할 수 없다** — istio 1.30 의 k8s 하한이 **1.32** 인데 green 은 **1.31** 입니다. green 이 1.31 인 동안 올릴 수 있는 상한은 **istio 1.29**(지원 1.31~1.35)이고 그마저 EOL 이 ~2026-08 입니다. 즉 1.30.3 은 **1.35 신규 클러스터 직행(경로 A)에서만** 성립합니다 `✓`
- **native sidecar 전환 시점은 istio 버전이 아니라 노드 kubelet 버전이 정한다** — 기본값이 `true` 가 아니라 `"auto"` 이고 전 노드 kubelet ≥1.33 일 때만 켜집니다. 목표 1.35 노드에서는 **처음부터 ON** 이고 green(1.31)에서는 **끝까지 OFF** 입니다 `✓`
- **1.29 차트 통합의 리소스 rename 은 우리에게 해당 없을 가능성이 크다** — 코드 대조 결과 istiod 차트는 1.22.0 부터 이미 신 이름(`istiod-clusterrole`)입니다. 대응은 "rename 추적"이 아니라 **구 이름 orphan 탐색**입니다 `✓`
- blue-green 신규 클러스터라면 **canary 홉 체인 없이 1.30.3 을 처음부터 직행 설치**할 수 있습니다 `✓`
{{< /callout >}}

## 1. 왜 1.30.3인가

목표 버전은 남은 선택지가 좁아서 결정됩니다. istio 1.24 계열이 지원하는 k8s 는 1.28~1.31 까지라 목표 **1.35** 에서는 아예 지원 대상 밖입니다. 1.35 를 지원하는 비-EOL 라인은 **1.29**(k8s 1.31~1.35)와 **1.30**(k8s 1.32~1.36) 둘뿐이고 그중 1.29 는 EOL 전망이 ~2026-08 입니다. 그래서 목표를 **1.30.3** 으로 잡습니다. 1.30.3 은 2026-07-16 릴리스이자 istio.io 최신 stable 입니다. 지원 k8s 범위가 목표 클러스터 1.35 를 안쪽에 둡니다.

여기에는 확인되지 않은 전제가 하나 깔려 있습니다. 라이브 버전이 실제로 몇인지는 이 문서 작성 시점에 확인되지 않았습니다. 배포 차트의 README 이력 배지가 훨씬 오래된 버전까지 내려가므로 이 문서는 최소한 chart tip 인 **1.24.1** 을 하한으로 가정하고 작성했습니다. 아래 판정을 읽을 때 그 점을 감안해야 합니다.

## 2. 무엇이 깨지나

sidecar 관점에서 영향 있는 변화만 추리면 세 구간이 중요합니다. 각 구간의 코드 대조·정정 근거는 [istio 1.25→1.30 changelog]({{< relref "../../istio/17-changelog-1.25-1.30.md" >}})가 단일 소유입니다. 여기서는 이관 절차에 필요한 결론만 싣습니다.

- **1.26→1.27**: native sidecar 의 기본값이 바뀝니다. 다만 릴리스노트의 "default to `true`"는 부정확합니다. **코드가 등록하는 값은 `"auto"`** 입니다 — 인젝션 웹훅이 전 노드의 kubelet 마이너를 훑어 하나라도 33 미만이면 끕니다. 그래서 **전환을 트리거하는 건 istio 업그레이드가 아니라 노드 업그레이드**입니다. 목표 1.35 노드에서는 신규 설치 시점부터 native 입니다. `istio-proxy` 가 init 컨테이너(`restartPolicy: Always`)가 되는 것을 전제로 Job/CronJob 완료·기동/종료 순서를 검증해야 합니다. 파급 두 가지가 릴리스노트에 없습니다 — ① **사용자 init 컨테이너가 메시 안으로 들어와** egress 가 `ServiceEntry`·`Sidecar` 스코프·`AuthorizationPolicy` 의 지배를 받습니다, ② finance 가 쓰는 **`holdApplicationUntilProxyStarts` 가 조용히 무효**가 됩니다(에러·경고 없음). 후자의 실제 조치는 값을 지우는 게 아니라 **`global.proxy.lifecycle` 을 직접 지정하고 있지 않은지** 확인하는 것입니다. 지정하고 있으면 native 의 `preStop` drain 훅이 렌더되지 않아 종료 시 인플라이트 요청이 끊깁니다.
- **1.28→1.29**: base·istiod 차트가 통합되며 중복 설정이 istiod 차트로 이관됩니다. upgrade-notes 는 `ClusterRole istiod` → `istiod-clusterrole` 매핑표를 싣지만 **코드 대조 결과 istiod 차트는 1.22.0 부터 이미 신 이름**입니다. base 차트에는 해당 템플릿이 애초에 없습니다. 우리 하한 가정(chart tip 1.24.1)에서는 rename 을 통과하지 않으므로 할 일은 rename 대응이 아니라 **`kubectl get clusterrole istiod` 로 1.22 이전 설치의 orphan 이 남아 있는지 확인**입니다. 비어 있으면 이 항목은 해당 없음입니다. 같은 절의 **접미사 규칙**(클러스터 스코프 리소스에 `-{revision}-{namespace}`)이 오히려 실질적입니다 — revision 을 쓰는 구성에서는 canary 홉마다 이름이 달라집니다.
- **1.29→1.30(목표)**: 디버그 엔드포인트 인가가 **1.29 에서 포트 15014, 1.30 에서 plaintext XDS 15010 까지** 확장됩니다(CVE-2026-31838). Kiali 같은 관측 도구와 `istioctl --plaintext` 를 쓰는 내부 스크립트가 영향을 받습니다. Kiali 를 함께 올린다면 1.30 요건인 2.26+ 로 lockstep bump 가 필요합니다. 네임스페이스 선택 로직도 바뀌어 동일 hostname 이 여러 네임스페이스에 있으면 "Kubernetes Service 우선"이 됩니다. 그리고 `DestinationRule.trafficPolicy.retryBudget` 의 기본 `percent` 가 **0.2%→20% 로 정정**됩니다 — 쓰고 있었다면 재시도 예산이 **100배**로 뜁니다.

**1.29 구간에서 조용히 죽는 알람이 셋입니다** — 서킷브레이커 remaining 메트릭 기본 비활성, Envoy stats 압축 기본 활성(스크레이퍼가 디코드를 못 하면 stats 전량 소실), 위 디버그 엔드포인트 인가. 셋 다 에러가 없고 쿼리가 `No data` 를 리턴할 뿐이라 신규 설치라도 **대시보드·알람 룰 감사는 그대로 해야 합니다**. 1.27 의 Grafana 대시보드 UID 고정(업그레이드 후 재생성 필요)과 Lightstep·OpenCensus 프로바이더 완전 제거도 같은 성격입니다.

finance 가 실제로 쓰는 EnvoyFilter 2개(`local-reply` SIDECAR_OUTBOUND·`ingressgateway-local-reply` GATEWAY)는 안정적인 Envoy v3 API 를 쓰므로 1.25~1.30 릴리스노트에 깨짐 항목은 없습니다. 다만 EnvoyFilter 는 버전을 보증하지 않는 API 이므로 매 목표 버전에서 istiod validation 과 실제 Envoy config_dump 렌더를 검증해야 합니다.

## 3. 적용 절차

### 경로 A — 1.35 신규 클러스터 직행(확정)

신규 1.35 클러스터에는 canary 홉 체인이 필요 없습니다. istio 1.30.3 을 처음부터 직접 설치합니다.

1. **차트 리워크** — `base`/`istiod` 의존성과 appVersion 을 1.30.3 으로 올리고 차트 버전을 bump 해 재퍼블리시합니다. revision/tag 값도 신 버전으로 갱신합니다.
2. **이미지 미러** — proxyv2·pilot·install-cni 1.30.3 을 사전에 ECR 미러로 push 합니다.
3. **app-of-apps 핀 갱신** — chart targetRevision 을 신 버전으로 교체하고 destination 을 신규 클러스터 API 서버 엔드포인트로 교체합니다.
4. **배포 순서** — base CRD → istiod(신 revision + default tag) → istio-ingressgateway → EnvoyFilter/AuthorizationPolicy/RequestAuthentication → istiod 의 KEDA 기반 오토스케일링(KEDA 앱이 선행돼 있어야 합니다).
5. 검증은 아래 검증·롤백 게이트를 따릅니다. Kiali 를 함께 쓴다면 별도 major 마이그레이션으로 2.26+ 까지 올립니다.

### 경로 B — 왜 성립하지 않는가

경로 B 는 기존 green 을 in-place 로 올리는 canary revision 방식입니다. 라이브 버전을 확정한 뒤 2 마이너 점프까지 지원하는 공식 canary 절차를 씁니다. 하한 1.24 가정으로 `1.24 → 1.26 → 1.28 → 1.30` 3홉이 됩니다. 라이브가 더 오래됐으면 홉이 늘어납니다. 홉마다 신규 revision istiod 를 기존과 병존 설치 → 네임스페이스 revision tag 를 flip → 전 sidecar 워크로드/gateway 를 rolling restart → `istioctl proxy-status` 로 전량 SYNCED 확인 → 구 revision decommission 순서를 반복합니다.

**다만 이 경로는 마지막 홉에서 막힙니다.** green 은 k8s **1.31** 인데 istio 1.30 의 지원 k8s 하한이 **1.32** 입니다. 홉별로 대조하면 1.26(k8s 1.29~1.33)·1.28(1.30~1.34)까지는 green 에서 지원 범위 안이지만 **1.30 은 범위 밖**입니다. `istioctl` 자체도 1.30 부터 최소 지원 k8s 를 1.32 로 올렸으므로 green 을 같은 바이너리로 다룰 수 없습니다. 즉 **green 이 1.31 인 동안 도달 가능한 상한은 istio 1.29**(k8s 1.31~1.35)입니다. 그 버전은 EOL 전망이 ~2026-08 이라 도착하자마자 다시 올려야 합니다. 1.30.3 을 목표로 두는 한 **경로 B 는 목표를 만족시키지 못합니다.**

native sidecar 도 경로에 따라 갈립니다 — green 의 kubelet 은 1.31 이라 `"auto"` 판정이 계속 `false` 입니다. **경로 B 에서는 `1.26→1.28` 홉을 지나도 native 전환이 일어나지 않습니다.** 검증은 istio 업그레이드 창이 아니라 **k8s 1.35 노드가 실제로 있는 곳**에서만 성립하므로 경로 B 를 택하면 native 검증이 나중으로 미뤄질 뿐 사라지지 않습니다.

**경로는 A 로 확정됐습니다** — 상위 문서 간에 "신규 클러스터 직행"과 "기존 green in-place"가 상충하는 서술이 남아 있었습니다. 목표가 EKS 1.35 · istio 1.30 으로 확정된 조합에서 경로 B 는 애초에 1.30.3 에 도달할 수 없습니다. 경로 B 에 남는 유일한 용도는 "1.35 컷오버가 지연될 때 green 을 istio 1.29 까지만 올려 EOL 노출을 줄이는 임시 수단"입니다. 그건 이 이관의 경로가 아니라 별도 판단입니다. 차트/이미지 리워크·ECR 미러·Kiali 절차는 어느 쪽이든 동일합니다.

## 4. 검증과 롤백

배포 전에 결정하거나 확인해 두어야 하는 게이트부터 봅니다.

- [ ] **라이브 버전 실측** — `istioctl version` + istiod 이미지 태그 + `istioctl proxy-status` 로 green 의 실제 control/data plane 버전을 캡처합니다. 경로 A 확정으로 홉 산정용은 아니지만 blue 의 values·EnvoyFilter 가 green 과 기능적으로 동등한지 대조하려면 기준값이 필요합니다.
- [ ] **ambient 미전환 재확인** — 어느 단계에서도 ztunnel/waypoint 도입 금지.
- [ ] **이미지 ECR 미러 누락** — 1.30.3 proxyv2/pilot/install-cni 미러가 없으면 ImagePullBackOff.
- [ ] **native sidecar(1.27+) 영향** — Job/CronJob 완료, `spec.containers` 에서 `istio-proxy` 를 찾는 mutating webhook·운영 스크립트, readiness gate 를 워크로드별로 검증합니다. 검증 환경은 반드시 **k8s ≥1.33 노드**여야 합니다(1.32 이하에서는 `auto` 가 계속 disabled 라 검증이 성립하지 않습니다).
- [ ] **init 컨테이너 egress(1.27+)** — 네트워크를 쓰는 init 이 있으면 목적지가 `ServiceEntry`·`Sidecar` egress 스코프 안에 있는지, `AuthorizationPolicy` 가 그 호출자를 허용하는지 재검증합니다(`REGISTRY_ONLY` 면 init 에서 처음 막힙니다).
- [ ] **`global.proxy.lifecycle` 오버라이드 확인(1.27+)** — 이 키를 직접 지정하고 있지 않은지 확인합니다. `holdApplicationUntilProxyStarts` 는 값을 지우는 게 아니라 **무효화됨을 인지**하는 것이 조치입니다.
- [ ] **base/istiod 차트 orphan 탐색(1.29+)** — `kubectl get clusterrole,clusterrolebinding -o name | grep -E '/istiod($|-istio-system$)'` 와 `istiod-service-account` SA 가 비어 있으면 해당 없음. revision 접미사가 canary 홉마다 달라지는 것은 별도로 확인합니다.
- [ ] **디버그 엔드포인트 인증(1.29의 15014 / 1.30의 15010)** — Kiali 를 2.26+ 로 lockstep 하지 않으면 topology/config 조회가 실패할 수 있습니다. Kiali 가 istio-system 밖이면 이전하거나 `DEBUG_ENDPOINT_AUTH_ALLOWED_NAMESPACES` 에 추가합니다. `istioctl --plaintext` 를 쓰는 내부 스크립트는 표준 인증 경로로 옮긴다 — `ENABLE_DEBUG_ENDPOINT_AUTH=false` 는 CVE-2026-31838 수정을 무력화하므로 쓰지 않습니다.
- [ ] **알람·대시보드 감사(1.27~1.29)** — 서킷브레이커 `remaining` 메트릭 기본 비활성, Envoy stats 압축 기본 활성(스크레이퍼 디코드 확인), Grafana 대시보드 UID 고정으로 인한 재생성, `lightstep|opencensus` 프로바이더 잔재 grep. 전부 에러 없이 조용히 깨집니다.
- [ ] **`retryBudget` 값 재결정(1.30)** — `DestinationRule` 에 `retryBudget` 이 있으면 기본 `percent` 정정치를 반영해 값을 다시 결정합니다. 없으면 무해합니다.
- [ ] **동일 hostname 중복 노출 카운트(1.30)** — 같은 hostname 을 `Service` 와 `ServiceEntry` 로 동시에 노출하는 곳이 1건 이상이면 업그레이드 전 `istioctl proxy-config cluster` 로 현재 선택 대상을 캡처해 전후를 비교합니다.
- [ ] **Gateway API CRD 유입 여부(1.30)** — finance 는 classic Gateway 를 쓰지만 클러스터에 k8s Gateway API CRD 가 이미 설치돼 있으면 1.30 은 v1.5.x 를 요구합니다.
- [ ] **KEDA 의존** — istiod 가 KEDA ScaledObject 로 오토스케일되므로 KEDA 자체 업그레이드({{< relref "04-secrets-autoscaling.md" >}})와 순서를 맞춥니다.

배포한 뒤에는 control plane 과 data plane 이 실제로 목표 버전·목표 형태인지를 봅니다.

- [ ] **배포 후 검증** — `istioctl version` 목표 버전 일치, `istioctl proxy-status` 전 sidecar SYNCED, sidecar 주입이 native init-container 형태인지, EnvoyFilter(local_reply MERGE)가 실제로 반영되는지 확인합니다.

되돌릴 길은 트래픽 전환 게이트에 걸려 있습니다.

- [ ] **트래픽 컷오버 검증(rollback 게이트)** — VirtualService hosts 응답과 타깃그룹 바인딩이 정상인지 확인한 뒤에만 트래픽을 전환합니다. 이상 시 revision/targetRevision 을 이전 값으로 되돌립니다.

## 근거

- 지원 릴리스·k8s 호환 매트릭스(**1.29=k8s 1.31~1.35 · 1.30=1.32~1.36**, 경로 B 상한 판정의 근거): `https://istio.io/latest/docs/releases/supported-releases/` — 로컬 대조는 `istio/istio.io` 클론의 `data/compatibility/supportStatus.yml`
- canary/revision 업그레이드, 2-마이너 스킵 지원: `https://istio.io/latest/docs/setup/upgrade/canary/`
- 마이너별 upgrade-notes(1.25~1.30, native sidecar, base/istiod 통합, 디버그 엔드포인트 인증): `https://istio.io/latest/news/releases/`
- Kiali 호환(1.30→2.26+): `https://kiali.io/docs/installation/installation-guide/prerequisites/`
- **코드 대조로 확정·정정된 항목**(`ENABLE_NATIVE_SIDECARS`의 실제 기본값 `"auto"`와 kubelet ≥1.33 판정, `holdApplicationUntilProxyStarts` 무효화와 `lifecycle` 분기, init 컨테이너 순서 역전, istiod 차트가 1.22.0부터 신 이름이라는 대조 결과, `retryBudget` 100배, 1.30 CVE 목록): [istio 1.25→1.30 changelog]({{< relref "../../istio/17-changelog-1.25-1.30.md" >}}) — 릴리스노트와 코드가 어긋나는 지점은 그 문서가 코드를 근거로 판정합니다
