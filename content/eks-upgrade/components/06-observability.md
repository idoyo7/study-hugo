---
title: "관측성 — VM-stack·metrics-server"
linkTitle: "관측성 — VM-stack·metrics-server·fluentbit·descheduler"
date: 2026-07-21
lastmod: 2026-08-24
weight: 6
---

# 관측성 — VM-stack·metrics-server·fluentbit·descheduler

{{< callout type="info" >}}
- victoria-metrics-k8s-stack: chart 0.19.4 → 0.87.0, 68마이너 점프. CRD 관리 스키마가 통째로 개편됩니다. 0.85.0부터는 대시보드/룰을 sync-job이 외부에서 fetch해 적용하는 방식으로 바뀌고 VM 컴포넌트 이미지는 태그를 핀하지 않아 차트만 올려도 몇 년치가 자동으로 점프합니다 `✓`
- metrics-server: v0.7.2 → v0.9.0. raw manifest로 배포돼 있어 ArgoCD 앱 스캔·Helm 인벤토리 어디에도 잡히지 않습니다(누락이 아니라 배포 방식이 다릅니다) `✓`
- fluentbit(aws-for-fluent-bit): chart 0.1.34 → 0.2.0. 차트 diff는 사소하지만 이미지 태그를 핀하지 않아 차트 버전 하나 올리는 것이 곧 Fluent Bit 1.9.10→4.2.2·AL2→AL2023 major 점프입니다 `✓`
- descheduler: 0.28.0 → 0.35.x(원 조사는 1.33 기준 0.33.x). values의 `strategies` 블록이 v1alpha1 잔재라 지금도 무시되고 있을 가능성이 매우 높습니다 — 그대로 둘지(옵션 A) 원 의도를 복원할지(옵션 B)는 팀이 정해야 합니다 `?`
- 네 컴포넌트 모두 tier-3(`kubernetes.default.svc`) 배포라 blue-green 신규 클러스터에서 endpoint를 다시 잡을 필요가 없습니다 `✓`
{{< /callout >}}

## 1. victoria-metrics-k8s-stack — 0.19.4 → 0.87.0

### 왜 이 버전인가

chart를 0.19.4에서 0.87.0으로 올립니다. 68마이너 점프입니다. VM 코어(appVersion)는 v1.99.0에서 v1.148.0으로, operator 서브차트는 0.28.*에서 0.66.*(app v0.73.1)로 함께 대점프합니다.

조사 시점에 업스트림 master는 0.87.0이었지만 ArtifactHub 게시본은 0.86.0으로 하루 지연돼 있었습니다. 어느 쪽이든 이 절에서 다루는 breaking은 모두 포함되므로 작업 당일 실제 게시된 최신 정식 버전을 재확인해 핀하면 됩니다.

### 무엇이 깨지나

태그를 핀하지 않은 자리가 함정입니다. finance values는 operator·vmagent·vmcluster(vmselect/vminsert/vmstorage)·vmalert·alertmanager 이미지의 repository만 ECR로 오버라이드하고 tag는 핀하지 않습니다 — 그래서 차트를 0.87.0으로 올리면 이 컴포넌트들은 자동으로 v1.148.0(operator는 v0.73.1)까지 점프합니다. 거꾸로 grafana(11.3.0)·kube-state-metrics(v2.12.0)·curl(7.85.0)처럼 태그가 명시로 핀된 컴포넌트는 차트를 올려도 이미지가 그대로 고정됩니다 — 목표 버전에 맞추려면 이 태그들을 따로 올려야 합니다.

CRD를 다루는 방식 자체가 바뀝니다. 로컬 `crds` 서브차트가 아예 제거되고 operator 서브차트가 `crds.plain`(specless 템플릿 렌더)으로 CRD를 관리합니다. finance가 명시한 `victoria-metrics-operator.createCRD: false`는 대상 차트에서 데드키가 됩니다 — CRD가 실제로 설치되도록 새 스키마 경로로 보장해야 합니다. 방치하면 CR은 있는데 CRD가 없어 sync가 실패합니다. 개편과 함께 VLSingle/VLCluster/VLAgent(logs), VTSingle/VTCluster(traces), VMAnomaly 같은 신규 CRD도 대량으로 추가됩니다.

finance에 가장 크게 걸리는 변화는 0.85.0의 대시보드/룰 sync-job 전환입니다. Helm이 렌더하던 대시보드 ConfigMap과 VMRule이 제거되고 배포 시점에 sync-job이 외부에서 fetch해 적용하는 방식(`syncJob.enabled: true`가 기본)으로 바뀝니다. finance는 대시보드/룰을 이미 raw Grafana dashboard + VMRule CR 체계로 따로 운영하므로 이 기본 동작이 클러스터 egress 제한과 부딪히거나 기존 체계와 중복될 위험이 있습니다 — `syncJob.enabled: false` + `defaultDashboards.enabled: false`로 명시 비활성해 기존 방식을 유지하는 편이 안전합니다.

그 밖에 확인할 항목:

- 0.74.0 라벨 표준화 — 커스텀 `app` 라벨이 `app.kubernetes.io/component`로 대체됩니다. vmagent의 `topologySpreadConstraints`가 라벨 셀렉터를 쓰고 있다면 렌더 후 실제로 매칭되는지 다시 확인해야 합니다(어긋나면 spread 제약이 무력화될 수 있습니다).
- 0.81.0 `defaultRules.create`→`enabled` 리네임 — 구키도 fallback으로 당장은 동작하지만 새 이름으로 바꾸는 편이 좋습니다.
- kube-state-metrics 태그 bump 별도 필요 — 서브차트를 올려도 이미지 태그가 핀돼 있으면 KSM 앱 자체는 그대로입니다. 목표(k8s 1.35를 지원하는 최신 정식 릴리스 라인 ≥2.19. 원 조사의 ≥2.17은 1.33 기준값이었습니다)에 닿으려면 태그를 직접 올려야 합니다. v2.14.0의 `kube_endpoint_address_*` 메트릭 제거·v2.18.0의 endpoints→endpointslices 기본 전환에 걸리는 알림룰/대시보드가 있는지도 감사해야 합니다.
- grafana 서브차트 12.x vs 핀 이미지 11.3.0 괴리 — 서브차트는 12.7.x로 올라가지만 이미지 태그를 11.3.0에 고정할지 12.x로 함께 올릴지는 따로 정해야 합니다(11→12 자체에 breaking이 있습니다).
- operator env/CLI 매핑 변경 — `disable_prometheus_converter: true`는 v0.73.1에서도 하위호환되지만 finance가 커스텀으로 넣은 operator env 4종(config-reloader·alertmanager 기본 이미지 지정용)의 키가 여전히 유효한지는 배포 전에 검증해야 합니다.

오설정 두 건도 이 업그레이드와 함께 정정합니다. prod values의 vmagent `externalLabels.cluster`가 `ring0`으로 남아 있지만 ArgoCD 파라미터가 이미 `prod-finance-green`으로 오버라이드하고 있어 실제 쿼리에는 영향이 없는 "그림자 오설정"입니다. 그래도 스키마 개편 뒤에도 이 파라미터 경로가 유효한지 확인하고 values 자체도 바로잡아 혼선을 없애야 합니다. prod grafana의 `root_url`에도 staging 도메인 패턴이 그대로 남아 있어 prod 도메인으로 고쳐야 합니다.

### 적용 절차

1. ECR 미러 완전성 확보 — 태그 미핀 컴포넌트(operator v0.73.1, vmagent/vmalert/vmcluster 3종 v1.148.0, node-exporter 서브차트 기본 태그)를 사전에 전량 미러합니다. 이 업그레이드의 최대 리스크입니다.
2. values 정정 — `createCRD: false` 제거/재매핑, `defaultRules.create`→`enabled`, `syncJob.enabled: false` + `defaultDashboards.enabled: false` 명시, KSM 태그를 ≥2.19로 bump, grafana 태그 유지/상승 결정, externalLabels·root_url 오설정 정정.
3. CRD 선적용 권장 — 신규/버전업 CRD가 컴포넌트보다 먼저 적용되도록 순서를 맞춥니다(ArgoCD Server-Side Apply에 맡긴다면 CRD가 먼저 뜨는지 확인).
4. staging 우선, prod 승격 — staging에 먼저 적용하고 prod는 안정을 확인한 뒤 승격합니다.

### 검증·롤백

**배포 전 결정·확인**

- [ ] ECR 이미지 미러 완전성(최대 리스크) — 전량 사전 미러 없이는 대량 ImagePullBackOff.
- [ ] sync-job의 외부 egress — 비활성화로 기존 extras 관리 체계 유지.
- [ ] CRD 관리 스키마 개편 — `crds.plain`으로 실제 설치되는지 확인.
- [ ] KSM 태그 미bump 함정 — 차트만 올려서는 목표 버전에 도달하지 않습니다.
- [ ] KSM 메트릭 rename 감사(v2.14.0/v2.18.0).
- [ ] grafana 12.x 서브차트 vs 11.3.0 이미지 괴리 결정.
- [ ] 라벨 표준화(0.74.0) vs topologySpreadConstraints 셀렉터 매칭 재확인.
- [ ] operator 커스텀 env 4종의 v0.73.1 유효성 검증.
- [ ] prod externalLabels·grafana root_url 오설정 정정.

**배포 후 검증**

- [ ] 모든 파드가 Ready이고 ImagePullBackOff가 0건인지 확인합니다. VictoriaMetrics 계열 CRD가 전부 존재하는지, vmagent 스크레이프와 VMRule 로드가 정상인지도 봅니다. `cluster="prod-finance-green"`(ring0 아님)으로 라벨이 실제로 찍히는지, KSM 메트릭 rename이 알림룰/대시보드에 영향을 주지 않는지까지 확인합니다.

**롤백**

- [ ] chart targetRevision을 0.19.4로 되돌립니다. CRD 관리 스키마가 개편되므로(구 `crds` 서브차트 vs `crds.plain`) 다운그레이드할 때 CRD가 남아 있는지 확인합니다.

## 2. metrics-server — v0.7.2 → v0.9.0

### 왜 이 버전인가

target 버전은 v0.9.0입니다. v0.9.0으로 가는 세부 breaking 변경은 이 페이지의 소스 범위 밖이라 따로 조사해야 합니다(`?`).

### 무엇이 깨지나

metrics-server는 클러스터 부트스트랩 단계에서 raw manifest로 배포되며 ArgoCD Helm 앱 목록이나 차트 인벤토리 어디에서도 잡히지 않습니다. 목록에 없는 건 관리를 놓쳐서가 아닙니다. 이 컴포넌트만 애초에 배포 경로가 다릅니다. 그래서 이번 업그레이드 인벤토리를 짤 때 metrics-server를 빠뜨리기 쉽고 그 점 자체가 리스크입니다.

소비 측에서는 HPA(`autoscaling/v2`)가 metrics-server의 API를 씁니다. keda가 등록하는 `external.metrics.k8s.io`와 metrics-server의 `metrics.k8s.io`는 서로 다른 API 그룹이라 충돌하지 않으므로 그 점만 확인하면 됩니다.

## 3. fluentbit(aws-for-fluent-bit) — 0.1.34 → 0.2.0

### 왜 이 버전인가

차트 자체의 diff는 사소합니다 — image.tag를 빼면 values 스키마와 input/filter/firehose 렌더 로직이 두 차트 버전 사이에 byte-identical합니다. 정작 바뀌는 건 차트가 기본으로 지정하는 이미지 태그입니다. finance는 `image.tag`를 핀하지 않으므로 차트 기본 태그를 그대로 상속합니다. 0.1.34의 기본은 `2.32.2.20240516`(Fluent Bit 1.9.10, AL2)이고 0.2.0의 기본은 `3.2.1`(Fluent Bit 4.2.2, AL2023)입니다. targetRevision 한 줄을 bump하면 3.5년치 엔진 교체이자 base OS 전환이 따라옵니다.

이 전환의 배경에는 AL2가 2026-06-30로 EOL을 지났다는 사실이 있습니다 — v2 이미지는 더 이상 보안 패치를 받지 못하므로 v3(AL2023, LTS ~2028+) 이관을 미룰 수 없습니다.

### 무엇이 깨지나

공식 upgrade-notes를 finance가 실제로 쓰는 요소(`tail` 입력 + `Parser cri`/`Docker_Mode On`, `kubernetes` 필터, `parser` 필터, `rewrite_tag` re-emitter, Go `firehose` 출력) 기준으로 항목별로 따져보면 v2.0(mbedTLS 제거)·v3.0(HTTP 입력 HTTP/2 기본)·v4.0(구형 배포판 패키지 중단, AL2 ARM64 Kafka 비활성)·v4.2(Vivo exporter 경로 변경) 어느 것도 finance 설정에 직접 영향을 주지 않습니다. finance가 쓰는 AWS Go 출력 플러그인 `firehose`도 v2·v3 최신 이미지 양쪽에 계속 번들되므로 제거로 인한 breaking은 없습니다.

문서화된 breaking이 없다는 것과 "실제로 아무 일도 없다"는 것은 다릅니다 — 1.9.10에서 4.2.2로 가면 문서화되지 않은 미세 거동(k8s 필터 메타데이터 처리, 메모리 사용량, CRI 라인 결합, firehose 플러그인과 신규 코어의 상호작용) 차이를 배제할 수 없으므로 스테이징 엔드투엔드 검증으로만 확정할 수 있습니다.

### 적용 절차

1. 먼저 확인할 것 — ECR 미러에 `3.2.1` 태그가 있는지 확인합니다. 없으면 전 노드 로깅 DaemonSet이 ImagePullBackOff에 걸려 로그 파이프라인 전체가 멈춥니다.
2. targetRevision bump — chart를 0.2.0으로 올립니다. values는 스키마가 호환되므로 손댈 게 없습니다(태그를 명시로 핀하고 싶다면 `image.tag: "3.2.1"`을 추가하면 됩니다).
3. IRSA 재바인딩 — role ARN·account는 불변이지만 신규 blue 클러스터라면 role의 trust policy에 신규 OIDC provider를 추가해야 합니다. v3도 표준 IRSA(web identity token)를 쓰므로 자격증명 해석 방식 자체는 바뀌지 않습니다.
4. stage → prod — stage에 먼저 적용해 검증한 뒤 prod로 갑니다. 롤백은 targetRevision을 되돌리는 것만으로 충분합니다(값·스키마가 불변이라 무손실).

### 검증·롤백

**배포 전 결정·확인**

- [ ] (최우선) ECR 미러에 목표 태그 존재 확인 — 없으면 로깅 파이프라인 전면 중단.
- [ ] firehose 플러그인 초기화 — 신규 코어에서 IRSA 자격증명 획득·전송이 정상인지 로그로 확인.
- [ ] IRSA/AL2023 자격증명 — 신규 클러스터의 OIDC provider가 role trust에 추가됐는지 확인.
- [ ] arm64 이미지 pull — finance 노드가 arm64이므로 목표 태그의 멀티아치 이미지에 arm64가 포함되는지 확인.
- [ ] prune:true/selfHeal:true — 머지 즉시 자동 롤아웃되므로 카나리/수동 게이트가 필요하면 일시적으로 selfHeal을 끕니다.

**배포 후 검증**

- [ ] DaemonSet이 전 노드에서 Running이고 이미지 태그가 목표와 맞는지 봅니다. 플러그인 로드 에러가 없는지, 두 Firehose delivery stream(finance/mydata) 모두 실제 레코드가 도착하는지까지 stage에서 확인합니다.

**롤백**

- [ ] targetRevision을 0.1.34로 되돌리는 것만으로 충분합니다(값·스키마 불변, 무손실).

## 4. descheduler — 0.28.0 → 0.35.x

### 왜 이 버전인가

descheduler는 마이너 릴리스마다 k8s client-go 라이브러리를 해당 k8s 마이너로 1:1 bump합니다(0.29→k8s 1.29 … 0.33→k8s 1.33). 원 조사는 k8s 1.33을 목표로 진행돼 0.33.x를 채택안으로 제시했습니다. 상위 목표가 1.35로 상향됐으므로 이 페이지의 목표는 같은 1:1 규칙을 따라 0.35.x로 잡습니다 — 패치 버전은 작업 당일 upstream 인덱스로 재확인합니다(`?`).

client-go skew 때문에 이 bump는 blocking으로 분류합니다 — 0.28(client-go 1.28)을 k8s 1.35 API server와 그대로 맞물리면 마이너 격차가 커서 위험합니다.

### 무엇이 깨지나

이 업그레이드에서 실제로 손볼 것은 버전 bump보다 policy 스키마 정리입니다. finance values는 이미 `apiVersion: descheduler/v1alpha2`로 선언돼 있어 0.31.0에서 완전히 제거된 v1alpha1 apiVersion 문제 자체는 겪지 않습니다. 그런데 values 안의 `deschedulerPolicy`에는 `profiles`(v1alpha2 정식 문법)와 `strategies`(v1alpha1 문법) 블록이 섞여 있습니다. v1alpha2 타입에는 `strategies` 필드가 아예 존재하지 않습니다. k8s 표준 디코더는 unknown 필드를 non-strict로 처리해 경고 하나 없이 버립니다 — `strategies` 블록은 지금도 무시되고 있을 가능성이 매우 높습니다.

이게 사실이라면 실제로 도는 플러그인은 `profiles.balance`의 `RemovePodsViolatingTopologySpreadConstraint` 하나뿐이고 `strategies`에서 `enabled:true`로 표시된 InterPodAntiAffinity·NodeAffinity·NodeTaints 셋은 겉보기와 달리 동작하지 않는 죽은 설정일 공산이 큽니다. "무시 vs 디코드 에러" 여부는 클러스터 없이는 단정할 수 없으므로 작업 전에 현재 descheduler 파드 로그에서 실제 enabled plugins 목록을 캡처해 확정해야 합니다.

확정 결과에 따라 대응이 달라집니다.

- 옵션 A(현재 유효 동작 보존, 저위험) — profiles에 topology-spread 하나만 남기고 `strategies` 블록을 삭제합니다. 실제 축출 동작 변화가 가장 적습니다. 대신 원래 의도했던 3개 플러그인은 계속 안 도는 채로 남습니다.
- 옵션 B(원 의도 복원, 동작 변화 있음) — InterPodAntiAffinity·NodeAffinity·NodeTaints 셋을 `profiles.deschedule`로 이관해 실제로 켭니다. 그동안 안 돌던 축출이 갑자기 시작돼 파드 재스케줄이 늘어날 수 있으므로 staging에서 축출량을 관찰해야 합니다.

어느 쪽을 택하든 `strategies` 블록 자체는 제거합니다(0.35에서도 non-strict 디코더가 무시할 공산이 크지만 모호한 설정과 앞으로의 strict 디코드 리스크를 없애려는 것입니다). finance가 쓰는 7개 플러그인명은 이름이 바뀌거나 사라진 것 없이 v0.35의 v1alpha2에서도 유효합니다.

### 적용 절차

descheduler는 upstream `kubernetes-sigs.github.io/descheduler` 차트를 tier-3(`kubernetes.default.svc`)로 직접 소비하므로 신규 blue 클러스터에서 endpoint 재지정이 필요 없고 yo-charts 리워크도 필요 없습니다.

1. targetRevision bump — chart를 0.35.x로 올립니다. ECR 미러에 해당 태그가 있는지 먼저 확인합니다.
2. policy 리워크 — `strategies` 블록을 제거하고 팀이 결정한 옵션(A 또는 B)에 맞춰 `profiles`/`plugins`/`pluginConfig`를 정리합니다. `DefaultEvictor`의 `nodeFit`·`evictLocalStoragePods` 같은 기본값이 finance 의도와 맞는지 따로 검토합니다(특히 topology-spread 축출 시 `nodeFit`을 켜지 않으면 재스케줄이 안 되는 노드로도 축출될 수 있습니다).
3. staging 선적용 — 리워크한 policy를 staging에 먼저 올립니다.
4. prod 적용 — staging 관찰 후 동일 절차.

### 검증·롤백

**배포 전 결정·확인**

- [ ] (리스크 1) 옵션 A/B 결정 — 작업 전 현재 파드 로그로 실제 enabled plugins를 캡처해 `strategies` 무시 여부를 확정합니다.
- [ ] ECR 미러 태그 존재 확인 — 없으면 배포 즉시 ImagePullBackOff.
- [ ] DefaultEvictor 기본값 검토 — 미지정 시 주입되는 기본값(`nodeFit`·`evictLocalStoragePods` 등)이 의도와 맞는지 확인합니다.
- [ ] 잔여 strategies 제거 — 두 옵션 모두에서 삭제하고 policy가 profiles만 갖는지 재확인합니다.
- [ ] prod/stage values가 현재 동일하므로 리워크 후에도 동일하게 유지합니다.

**배포 후 검증**

staging에 올린 뒤 파드 로그 시작부의 enabled plugins 목록이 의도한 옵션과 일치하는지, policy 디코드 에러/경고가 없는지 확인합니다. 옵션 B라면 축출량 급증 여부를 반드시 관찰합니다.

## 근거

- VictoriaMetrics 차트 CHANGELOG: `https://docs.victoriametrics.com/helm/victoria-metrics-k8s-stack/changelog/`
- VictoriaMetrics operator CHANGELOG(`createCRD`→`crds.plain`): `https://raw.githubusercontent.com/VictoriaMetrics/helm-charts/master/charts/victoria-metrics-operator/CHANGELOG.md`
- kube-state-metrics CHANGELOG(메트릭 rename): `https://github.com/kubernetes/kube-state-metrics/blob/main/CHANGELOG.md`
- aws-for-fluent-bit 차트 인덱스·릴리스(v2 EOL/v3 지원): `https://aws.github.io/eks-charts/index.yaml`, `https://github.com/aws/aws-for-fluent-bit`
- Fluent Bit 공식 upgrade-notes: `https://github.com/fluent/fluent-bit-docs` (installation/upgrade-notes.md)
- descheduler 릴리스노트(v1alpha1 제거 v0.31.0, v1alpha2 스키마): `https://github.com/kubernetes-sigs/descheduler/releases`
