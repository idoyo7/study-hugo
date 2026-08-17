---
title: "레이어 3 — 닫힌 영역과 클러스터 내부 우회"
weight: 4
---

# 레이어 3 — 닫힌 영역과 클러스터 내부 우회

{{< callout type="info" >}}
**한눈에**
- **finance 판정: 실제로 부딪히는 닫힌 항목은 셋이다** — HPA 스케일다운 안정화 시간, 감사 정책 파일, etcd 스냅샷. 셋 다 클러스터 내부 우회로만 처리합니다.
- **2026-08에 열린 것은 EKS API 필드 3개 안의 세부 값 4개뿐입니다.** `kubeApiServerConfig`의 하위 필드는 `eventTtl`·`serviceNodePortRange` **2개**입니다. "이제 apiserver 플래그를 만질 수 있다"는 서술은 이 숫자 하나로 반박됩니다.
- **열린 값 옆자리가 그대로 닫혀 있습니다.** HPA는 `--horizontal-pod-autoscaler-sync-period` 하나만 열리고 같은 코드 블록의 downscale-stabilization·tolerance·cpu-initialization-period·initial-readiness-delay 4개는 닫혔습니다.
- **우회 창구는 사실상 3개다** — APF(`FlowSchema`·`PriorityLevelConfiguration`), 어드미션(웹훅·CEL·Kyverno/OPA), 자체 스케줄러 배포 + `schedulerName`. 나머지 대부분은 대안이 **없다**.
- **etcd는 전 구간 차단**입니다. 엔드포인트도, compaction·defrag·quota 튜닝도, 스냅샷도 없습니다. 백업은 Velero 같은 API 레벨 도구뿐이고 **원자적 시점 복구는 포기해야 한다**.
- **`--force`는 PDB·어드미션 웹훅을 우회하지 않습니다.** EKS 자체 인사이트 검사만 우회하며, 전진 업그레이드 쪽 강제는 2025-03-28 임시 롤백된 뒤 재활성화가 확인되지 않아 현재 실질적으로 거의 무효입니다.
{{< /callout >}}

이 페이지는 [레이어 1]({{< relref "01-cluster-parameters.md" >}})의 클러스터 파라미터와 [레이어 2]({{< relref "02-component-parameters.md" >}})의 열린 4종을 전제로 그 **여집합**을 다룹니다. 무엇을 못 하는가, 못 하는 자리를 클러스터 안에서 어떻게 메우는가. 질문은 이 둘입니다.

이 페이지의 모든 `path:line` 인용은 로컬 클론 기준입니다 — kubernetes는 v1.37 개발 브랜치 커밋 `752b8875`(2026-07-26, `git describe`로는 `v1.37.0-beta.0-499`), karpenter-core는 `ac7a021e`(v1.14.0-6, 2026-07-27). EKS가 실제로 돌리는 마이너(1.31~1.36)의 배포본과 줄번호가 다를 수 있습니다. 다만 여기 인용한 플래그는 대부분 오래전에 도입돼 옵션 계약 자체는 안정적입니다.

## 1. 열린 것과 닫힌 것의 경계

### 1.1 컴포넌트별 개방 비율

"열린 세부 값" 열은 사용자가 실제로 값을 넣을 수 있는 스칼라·구조체의 개수를 뜻합니다. 2026-08 신규 필드가 들어온 뒤에도 컴포넌트별 개방 표면은 이만큼입니다.

| 컴포넌트 | EKS API 필드 | 열린 세부 값 | 이 페이지가 이름을 올린 닫힌 플래그 | 비고 |
|---|---|---|---|---|
| kube-apiserver | `kubeApiServerConfig` | **2** — `eventTtl`, `serviceNodePortRange` | 16 | 나머지 전부 비노출 |
| kube-controller-manager | `kubeControllerManagerConfig` | **1** — HPA `syncPeriod` | 5 | 이 하나도 Provisioned 티어 종속(§3.1) |
| kube-scheduler | `kubeSchedulerConfig` | **1** — NodeResourcesFit `scoringStrategy` | 3 | 전략 3종 중 2종만, 프로파일·플러그인 전체 닫힘 |
| cloud-controller-manager | **없음** | 0 | 3 | 이번 신설에 CCM 필드는 아예 포함되지 않았다 |
| etcd | **없음**(`encryptionConfig`만 간접) | 0 | `--etcd-*` 전체 | §5 |

`CreateCluster` 요청 스키마에서 이 셋이 차지하는 자리를 그대로 옮겼습니다. 스키마가 열어 준 자리는 중괄호 안에서 끝납니다.

```json
{
  "kubeApiServerConfig": {
    "eventTtl": "1h",
    "serviceNodePortRange": { "minPort": 30000, "maxPort": 32767 }
  },
  "kubeControllerManagerConfig": {
    "horizontalPodAutoscalerControllerConfig": {
      "horizontalPodAutoscalerSyncPeriod": "15s"
    }
  },
  "kubeSchedulerConfig": {
    "nodeResourcesFit": {
      "scoringStrategy": { "type": "LeastAllocated", "resources": [{ "name": "cpu", "weight": 1 }] }
    }
  }
}
```

값 범위·가변성·Terraform 인자명은 [레이어 2]({{< relref "02-component-parameters.md" >}})가 단일 소유로 다룹니다. 여기서 필요한 사실은 하나입니다. **이 JSON 밖에는 아무것도 없습니다.**

### 1.2 열린 값의 옆자리가 닫혀 있다

개방이 좁다는 점은 총량 비교가 아니라 **같은 코드 블록 안에서 하나만 뚫렸다**는 데서 가장 잘 드러납니다.

| 열린 값 | 업스트림 정의 위치 | 바로 옆에 있는데 닫힌 것 |
|---|---|---|
| `eventTtl` | `pkg/controlplane/apiserver/options/options.go` — 선언 `:67`(`EventTTL time.Duration`), 기본값 `:129`(`1 * time.Hour`), 플래그 등록 `:162` | 같은 apiserver 옵션 계층의 나머지 전부(§2). ⚠️ 이 플래그를 `cmd/kube-apiserver/app/options/` 에서 찾으면 없다 — 리팩터로 공유 옵션 패키지 `pkg/controlplane/apiserver/options` 로 옮겨간 뒤다 |
| `serviceNodePortRange` | 기본값 `pkg/kubeapiserver/options/options.go:26-27`(`PortRange{Base: 30000, Size: 2768}`), 플래그 등록 `cmd/kube-apiserver/app/options/options.go:127-129` | 같은 파일이 등록하는 다른 apiserver 플래그 전부 |
| HPA `syncPeriod` | `cmd/kube-controller-manager/app/options/hpacontroller.go:33-41` 블록, 기본값 15s는 `pkg/controller/podautoscaler/config/v1alpha1/defaults.go:40-41` | **같은 블록의 4개** — `--horizontal-pod-autoscaler-downscale-stabilization`(5m), `-tolerance`, `-cpu-initialization-period`(5m), `-initial-readiness-delay`(30s) |
| `scoringStrategy.type` | 상수 3종 `pkg/scheduler/apis/config/types_pluginargs.go:188-199`, 검증 집합 `validation_pluginargs.go:36-40`, 기본값 `LeastAllocated` `pkg/scheduler/apis/config/v1/defaults.go:234` | **세 번째 전략 `RequestedToCapacityRatio`**(`requested_to_capacity_ratio.go:29-56`). 이건 가변 길이 `(utilization, score)` 점 배열을 요구해 구조화 API 표면이 훨씬 커진다 — 그래서 빠졌다는 것은 코드 구조를 보고 세운 **추론**이고, AWS가 이유를 밝힌 문장은 찾지 못했다 |

실무에서 문제가 되는 것은 sync period보다 **downscale stabilization**(기본 5분)인 경우가 많은데 열린 쪽은 sync period입니다. HPA 행이 특히 아픈 이유가 여기 있습니다.

## 2. kube-apiserver — 닫힌 플래그

EKS API(`CreateCluster`/`UpdateClusterConfig`) 스키마 전체를 대조했습니다. 아래 항목에 대응하는 필드는 없습니다. "대안" 열은 §7의 우회 수단과 짝을 이룹니다.

### 2.1 처리율·동시성·타임아웃

| 플래그 | 하는 일 | 업스트림 위치 | 대안 |
|---|---|---|---|
| `--max-requests-inflight` | non-mutating 요청 동시 처리 상한. APF가 켜져 있으면 mutating 값과 합산돼 **APF seat 총량**을 정한다 | `staging/src/k8s.io/apiserver/pkg/server/options/server_run_options.go:350-353` | 티어 선택으로 **총량만** 간접 조정(§6). 배분은 APF로(§7.1) |
| `--max-mutating-requests-inflight` | mutating 요청 쪽 상한 | 같은 파일 `:356-359` | 위와 동일 |
| `--request-timeout` | 기본 요청 타임아웃 | 같은 파일 `:360-363` | **없다** |
| `--min-request-timeout` | watch 요청 최소 타임아웃 | 같은 파일 `:378-382` | **없다** |
| `--goaway-chance` | HTTP/2 GOAWAY를 확률적으로 보내 커넥션 재분산을 유도 | 같은 파일 `:365-370` | **없다**(EKS는 앞단 NLB가 분산을 담당) |
| `--default-watch-cache-size` | 기본 watch 캐시 크기 — 업스트림에서 이미 deprecated·no-op | `staging/.../server/options/etcd.go:149-154`(코드에 `MarkDeprecated`) | 불필요. watch 캐시는 자동 사이징된다 |
| `--watch-cache-sizes` | 리소스별 watch 캐시 개별 오버라이드 | 같은 파일 `:157-165` | **없다** |

EKS의 `--max-requests-inflight` 기본값을 400, mutating 쪽을 200으로 설명하는 AWS 자료가 있으나 API Reference 같은 1차 문서에서 확인한 값은 아니어서 2차 근거로만 취급합니다.

### 2.2 감사·어드미션

| 플래그 | 하는 일 | 업스트림 위치 | 대안 |
|---|---|---|---|
| `--audit-policy-file` | 어떤 요청을 어느 레벨(`Metadata`/`Request`/`RequestResponse`)까지 기록할지 정하는 정책 파일 | `staging/.../server/options/audit.go:262-263` | EKS는 로그 타입 on/off(`api`·`audit`·`authenticator`·`controllerManager`·`scheduler`)만 준다. 이미 생성된 이벤트를 **사후 필터링**하는 것이 전부(§7.4) |
| `--enable-admission-plugins` / `--disable-admission-plugins` | 어드미션 플러그인 활성 목록 조정 | `staging/.../server/options/admission.go:107-111` | 웹훅·CEL 정책·Kyverno/OPA(§7.2) |
| `--admission-control-config-file` | 플러그인별 세부 설정(예: PodSecurity exemption) | 같은 파일 `:118` | PodSecurity는 네임스페이스 라벨로 우회. 파일 기반 세밀 설정은 **없다** |

활성 어드미션 플러그인 목록은 각 k8s 마이너의 **platform version**에 고정돼 있고 platform version 자체도 사용자가 못 고릅니다. AWS 문서가 1.35·1.36에 동일하게 명시한 목록입니다.

```text
NodeRestriction, ExtendedResourceToleration, NamespaceLifecycle, LimitRanger,
ServiceAccount, TaintNodesByCondition, PodSecurity, Priority,
DefaultTolerationSeconds, DefaultStorageClass, StorageObjectInUseProtection,
PersistentVolumeClaimResize, RuntimeClass, CertificateApproval, CertificateSigning,
CertificateSubjectRestriction, DefaultIngressClass, MutatingAdmissionWebhook,
ValidatingAdmissionWebhook, ResourceQuota
```

`MutatingAdmissionWebhook`·`ValidatingAdmissionWebhook`이 이 목록에 들어 있습니다. 웹훅 메커니즘 자체는 이미 켜져 있으니 서버만 우리가 배포하면 됩니다. §7.2의 근거가 이것입니다.

### 2.3 API 표면·인증·암호화

| 플래그 | 하는 일 | 업스트림 위치 | 대안 |
|---|---|---|---|
| `--feature-gates` | 기능 게이트 on/off | `staging/src/k8s.io/component-base/compatibility/registry.go:263-266` | **없다**(§4) |
| `--runtime-config` | API 그룹·버전 개별 on/off(`api/all`·`api/beta` 단위 포함) | `staging/.../server/options/api_enablement.go:50-56` | **없다**. 특정 alpha API 그룹을 켜는 길이 원천 차단된다 |
| `--anonymous-auth` | 익명 요청 허용 여부 | `pkg/kubeapiserver/options/authentication.go:357` | 값 변경 불가. RBAC 쪽에서 `system:anonymous` 바인딩(기본 `system:public-info-viewer`)을 점검·제거하라는 것이 AWS 베스트프랙티스 권고다 |
| `--service-account-issuer` / `--service-account-signing-key-file` / `--service-account-key-file` / `--service-account-max-token-expiration` / `--api-audiences` | SA 토큰 발급자·서명키·audience·만료 | `pkg/kubeapiserver/options/authentication.go:350,430,440,458` | **읽기만 가능**. issuer는 EKS가 자동 발급(`identity.oidc.issuer`로 조회)하고 커스텀 URL 지정·서명키 직접 로테이션은 불가. IRSA·Pod Identity가 이 issuer를 전제로 동작한다 |
| `--encryption-provider-config` | etcd 저장 시 암호화 provider 체인 설정 파일 | `staging/.../server/options/etcd.go:185` | **축소판만 있다.** EKS `encryptionConfig`는 리소스를 secrets로 고정하고 KMS 키 ARN만 받는다. 다중 provider 체인·aescbc/aesgcm 직접 선택·`--encryption-provider-config-automatic-reload`는 불가 |

### 2.4 etcd 접속 플래그

`--etcd-servers`·`--etcd-prefix`·`--etcd-compaction-interval`·`--etcd-count-metric-poll-period`·`--etcd-cafile`/`-certfile`/`-keyfile` 등 `staging/.../server/options/etcd.go:170-199` 블록 전체가 닫혔습니다. 상세와 대안은 §5.

## 3. kube-controller-manager와 kube-scheduler

### 3.1 HPA — 열린 것은 period 하나뿐이고, 그것도 조건부다

| 플래그 | 하는 일 | 업스트림 위치 | EKS |
|---|---|---|---|
| `--horizontal-pod-autoscaler-sync-period` | HPA 오브젝트 재평가 주기 | `cmd/kube-controller-manager/app/options/hpacontroller.go:33-41` | **열림.** 단 Provisioned 티어에서만 설정 가능하고, 기본값(15s)이 아닌 값을 유지한 채로는 Standard로 복귀할 수 없다 → [용량 축]({{< relref "03-provisioned-control-plane.md" >}}) |
| `--horizontal-pod-autoscaler-downscale-stabilization` | 스케일다운 판단을 안정화시키는 창(기본 5m) | 같은 블록 | **닫힘.** 스케일다운 지연의 실질적 주범인데 열리지 않았다 |
| `--horizontal-pod-autoscaler-tolerance` | 목표치 대비 무시할 오차 | 같은 블록 | **닫힘** |
| `--horizontal-pod-autoscaler-cpu-initialization-period` / `--initial-readiness-delay` | 새 파드 메트릭을 신뢰하기 시작하는 시점(5m / 30s) | 같은 블록 | **닫힘** |
| `--concurrent-horizontal-pod-autoscaler-syncs` | HPA 오브젝트 동시 처리 수 | `hpacontroller.go:38`, `Validate()`는 `:58-68` | **직접 불가.** 티어가 대리로 올려준다(§6) — 사용자가 독립적으로 지정하는 축이 아니다 |

sync period를 줄이면 apiserver 요청량이 늘어납니다. 메커니즘은 코드에서 그대로 읽힙니다. `pkg/controller/podautoscaler/horizontal.go:356-368`의 `processNextWorkItem()`은 reconcile을 마친 뒤 `queue.AddRateLimited(key)`로 같은 키를 다시 큐에 넣고, 이때 resync period만큼 지연이 걸립니다. 그래서 HPA 오브젝트 하나당 정확히 period 간격으로 재평가가 돌고 매 실행이 metrics 조회 + Scale 서브리소스 호출을 수반합니다. 요청량은 **HPA 개수 × (1/period)** 에 선형 비례합니다. 다만 AWS가 하한을 그 값으로 고른 산출식이나 부하 시험 수치는 공개 문서에서 확인되지 않았습니다.

### 3.2 노드 라이프사이클·GC·클라이언트 QPS

| 플래그 | 하는 일 | 업스트림 위치 | 대안 |
|---|---|---|---|
| `--node-monitor-grace-period` | 노드 무응답을 unhealthy로 판정하기까지의 대기 시간 | `cmd/kube-controller-manager/app/options/nodelifecyclecontroller.go:41-45` | **없다.** 축출을 더 빠르게 하고 싶어도 못 한다 — Node Problem Detector와 자체 감시로 감지 시점만 앞당기는 정도 |
| `--terminated-pod-gc-threshold` | 종료된 파드가 이 수를 넘으면 GC 시작(≤0이면 비활성) | `cmd/kube-controller-manager/app/options/podgccontroller.go:36` | **없다.** Containers Roadmap `#1544`가 요청 중 |
| `--kube-api-qps` / `--kube-api-burst` | 컨트롤 플레인 컴포넌트가 apiserver에 거는 자체 클라이언트 상한 | scheduler `cmd/kube-scheduler/app/options/deprecated.go:48-49`, controller-manager `staging/src/k8s.io/controller-manager/options/generic.go:61-63` | **없다.** 티어가 서버 쪽 총량은 올려주지만 컴포넌트의 클라이언트 상한은 AWS 내부값 고정이다 |
| `--controllers` | controller-manager의 개별 컨트롤 루프 on/off | `cmd/kube-controller-manager/app/options/options.go` | **없다** |

### 3.3 스케줄러 — scoring 하나만 열리고 프로파일 전체는 닫혔다

`kubeSchedulerConfig`가 노출하는 필드는 `nodeResourcesFit.scoringStrategy` 단 하나이고 그 밖의 스케줄러 커스터마이즈는 전부 닫혔습니다.

| 닫힌 축 | 예 | 업스트림 위치 |
|---|---|---|
| 다중 프로파일(`KubeSchedulerConfiguration.profiles[]`) | 워크로드별로 다른 플러그인 세트 | `pkg/scheduler/apis/config/**` |
| 플러그인 활성/비활성·weight 조정 | `PodTopologySpread` weight, `InterPodAffinity` 우선순위 | `pkg/scheduler/framework/plugins/**` |
| 커스텀 플러그인 로딩·extender | out-of-tree 플러그인 바이너리 | 동일 |
| `RequestedToCapacityRatio` 전략 | 구간별 선형 함수 shape | `pkg/scheduler/framework/plugins/noderesources/requested_to_capacity_ratio.go:29-56` |

이 축에는 대안이 **있습니다.** 실효성 있는 길은 자체 스케줄러 배포(§7.3) 하나뿐입니다.

## 4. feature gate와 alpha API

AWS User Guide(kubernetes-versions.html) FAQ가 원문으로 못박습니다.

> "Amazon EKS supports all generally available (GA) features of the Kubernetes API. New beta APIs aren't enabled in clusters by default. However, previously existing beta APIs and new versions of existing beta APIs continue to be enabled by default. **Alpha features aren't supported.**"

| 단계 | EKS에서 | 근거 |
|---|---|---|
| GA | 전부 사용 가능 | 위 인용 |
| beta(기존) | 기본 활성 유지 | 위 인용 |
| beta(신규) | 기본 비활성 | 이건 EKS가 더 막는 것이 아니라 **업스트림 정책 그대로다**(1.24부터 신규 beta API는 기본 off) |
| alpha | ⚠️ **불가.** 켤 수단이 없다 | `--feature-gates`·`--runtime-config` 둘 다 비노출(§2.3) |

`--feature-gates`가 없으니 게이트를 켤 수 없고 `--runtime-config`가 없으니 API 그룹을 켤 수도 없습니다. 두 경로가 동시에 막혀 있어 alpha는 **원리적으로 닫힌 영역**입니다. 대안은 없습니다. 그 기능이 beta 기본 활성 또는 GA로 승격할 때까지 기다리는 수밖에 없습니다.

"alpha 게이트를 전부 켠 전용 클러스터 타입을 달라"는 요청은 `aws/containers-roadmap#2348`("EKS Alpha Clusters")로 살아 있으나 2026-08 기준 그런 제품은 없습니다.

2026-08(k8s 1.36 계열) 시점에 alpha라서 못 쓰는 기능의 구체적 목록은 **이번 조사 범위에 넣지 않았습니다.** 알파 목록은 마이너마다 바뀝니다. 특정 기능이 필요하면 목표 버전 시점의 업스트림 feature gate 표를 그때 직접 확인해야 합니다.

### ValidatingAdmissionPolicy — 목록에는 없지만 단정할 수 없다

업스트림 `pkg/kubeapiserver/options/plugins.go:163-192`를 보면 `ValidatingAdmissionPolicy` 플러그인이 `defaultOnPlugins` 집합에 들어 있습니다(주석: 게이트가 켜졌을 때만 활성). 그 게이트는 1.30부터 GA·기본 on입니다. 그런데 EKS가 공개한 활성 어드미션 플러그인 목록(§2.2)에는 `ValidatingAdmissionPolicy`가 **1.30~1.36 어느 절에도 등장하지 않습니다.** `MutatingAdmissionPolicy`·`PodTopologyLabels`·`NodeDeclaredFeatureValidator`·`PodResizeValidator`·`ClusterTrustBundleAttest`도 마찬가지입니다.

이게 "EKS가 껐다"인지 "AWS 문서가 조건부 활성 플러그인을 목록에서 생략한다"인지는 **1차 소스로 확정하지 못했습니다.** GA 이후 API 그룹 활성화에 내장돼 동작하는 방식이라 전통적 플러그인 목록과 다르게 문서화될 여지가 있습니다. 확실하게 가려내려면 정책 도구를 정하기 전에 대상 클러스터에서 `ValidatingAdmissionPolicy` 오브젝트를 실제로 `kubectl apply` 해 봐야 합니다. 그 밖에 확정할 길은 없습니다.

## 5. etcd

| 축 | 상태 | 근거·비고 |
|---|---|---|
| 엔드포인트·자격증명 | ⚠️ **없다** | EKS API 스키마 전체에 etcd 접속 필드가 없다. etcd는 AWS 계정 안에 있고 주소조차 주지 않는다 |
| etcd 버전 선택 | **불가** | AWS 내부 관리. 현재 버전이 공개 문서에 명시되지 않았다 |
| compaction 주기 | **불가** | `--etcd-compaction-interval`(`etcd.go:192`) 비노출 |
| defrag 주기 | **불가** | AWS 내부 관리 |
| `--quota-backend-bytes` | **불가** | 대신 티어가 정하는 DB 크기 상한만 간접 통제(§6) |
| 스냅샷 다운로드·복원 | ⚠️ **없다** | EKS 공식 문서 어디에도 스냅샷 제공 기능이 없다. 이건 부재 증명이라 "있다"고 말하는 문장이 없는 것 자체가 근거다 |
| 크기 한도 | Standard 최대 **8GB**, Provisioned 티어 **16GB** | 8GB는 Provisioned→Standard 복귀 조건과 직결된다 → [용량 축]({{< relref "03-provisioned-control-plane.md" >}}) |
| 관측 | `apiserver_storage_size_bytes` | AWS 문서가 2026년 하반기부터 `etcd_mvcc_db_total_size_in_use_in_bytes`로 전체 클러스터에 롤아웃할 예정이라고 명시했다 |

**백업 대안과 그 한계.** Velero는 API 서버를 거쳐 리소스를 백업합니다. etcd를 직접 읽지 않으니 `kubectl`이 보는 것과 같은 수준입니다. PV 데이터는 CSI 볼륨 스냅샷이나 Velero의 파일 레벨 백업으로 따로 처리합니다. RBAC·CRD 정의 같은 컨트롤 플레인 메타데이터까지 리소스 단위로 재현은 되지만 **etcd 스냅샷 기반 복원처럼 원자적 시점 복구는 되지 않습니다.** 리소스마다 백업 시각이 미세하게 다르고 백업 중 변경된 오브젝트 사이의 정합은 보장되지 않습니다. "애플리케이션 레벨 백업이 최초이자 최후의 방어선"이라는 정리는 커뮤니티 2차 소스 다수가 일치합니다. 다만 원자성 상실이라는 대가를 명시하지 않고 인용하면 오해를 만듭니다.

## 6. 컨트롤 플레인 사이징

인스턴스 타입·노드 수·AZ 배치는 **여전히 전혀 못 고릅니다.** 2025-11-27 Provisioned Control Plane이 나오면서 생긴 선택은 미리 정해진 성능 등급을 사는 쪽입니다. 인스턴스를 직접 고르는 문이 열린 것은 아닙니다.

| 항목 | 사용자 선택 | 비고 |
|---|---|---|
| 컨트롤 플레인 인스턴스 타입 | ⚠️ **불가** | 예외는 Outposts 로컬 클러스터뿐 — `outpostConfig.etcdInstanceType`이 스키마에 존재한다. 개별 GA 시점은 1차 문서로 특정하지 못했다 |
| 노드 수(레플리카 수) | ⚠️ **불가** | 티어가 대리 지표(seats·pods/sec)로만 표현된다 |
| AZ 배치 | ⚠️ **불가** | Outposts는 `outpostConfig.etcdPlacement.spreadLevel`이 존재. 일반 리전 클러스터에는 대응 필드가 없다 |
| platform version | ⚠️ **불가** | "You cannot change the platform version of an EKS cluster." 어드미션 플러그인 목록이 여기에 묶여 있다(§2.2) |
| 용량 등급(티어) | **가능** | 이 축의 전체 판정·요금·복귀 제약은 [용량 축]({{< relref "03-provisioned-control-plane.md" >}}) |

레버는 티어가 대리로 올려주는 값뿐입니다 — APF seat 총량, 파드 스케줄링 처리율, HPA sync concurrency, DB 크기 넷입니다. §2·§3에서 "직접 불가, 티어로 간접"이라고 적은 항목은 모두 여기에 걸립니다. 그 수치와 전환 제약은 여기서 재서술하지 않습니다.

## 7. 그래서 대신 무엇을 하나

닫힌 항목과 클러스터 내부 대안을 짝지었습니다. 대안이 없으면 없다고 적었습니다. 이 표에서 "없다"의 개수가 §1의 개방 비율을 다시 확인해 줍니다.

| 닫힌 것 | 클러스터 내부 대안 | 등가성 |
|---|---|---|
| `--max-requests-inflight` 계열 | **APF** `FlowSchema` + `PriorityLevelConfiguration`(§7.1) | 부분 — 총량은 못 바꾸고 **배분**만 바꾼다 |
| `--enable-admission-plugins` | ValidatingAdmissionPolicy(CEL) · 어드미션 웹훅 · Kyverno/OPA Gatekeeper(§7.2) | 높음 — 정책 표현력은 오히려 더 크다 |
| `--admission-control-config-file` | PodSecurity는 네임스페이스 라벨(`pod-security.kubernetes.io/enforce` 등) | 부분 — 파일 기반 exemption은 재현 불가 |
| 스케줄러 프로파일·플러그인 | **자체 kube-scheduler 배포 + 파드의 `schedulerName`**(§7.3) | 높음 — 대신 운영 부담을 우리가 진다 |
| `--audit-policy-file` | audit 로그를 CloudWatch로 켠 뒤 외부 싱크로 반출해 사후 필터링(§7.4) | 낮음 — 기록 레벨 자체는 못 정한다 |
| `eventTtl`을 넘는 이벤트 보존 | Event를 외부 저장소로 반출(§7.4) | 높음 — 반출 후에는 TTL과 무관하게 보존된다 |
| etcd 스냅샷·복원 | **Velero**(§5) | 낮음 — 원자적 시점 복구가 없다 |
| CCM 플래그 | AWS Load Balancer Controller · VPC CNI · EBS/EFS CSI 애드온 | 높음 — 애초에 다른 컴포넌트로 쪼개졌다(§7.5) |
| `--node-monitor-grace-period` | Node Problem Detector로 감지만 앞당김 | 낮음 — 축출 판정 시점 자체는 못 바꾼다 |
| `--terminated-pod-gc-threshold` | **없다** | — |
| `--request-timeout` / `--min-request-timeout` / `--goaway-chance` | **없다** | — |
| `--kube-api-qps` / `--kube-api-burst` | **없다** | — |
| `--feature-gates` / `--runtime-config`(alpha) | **없다** | GA·beta 승격 대기(§4) |
| etcd compaction·defrag·quota | **없다**(크기 상한만 티어로) | — |
| 컨트롤 플레인 인스턴스 타입·AZ | **없다** | Outposts 예외(§6) |

### 7.1 APF — 스로틀링을 실질적으로 통제하는 유일한 창구

`FlowSchema`와 `PriorityLevelConfiguration`은 **클러스터 내부 API 오브젝트**(`flowcontrol.apiserver.k8s.io`)라서 EKS에서도 사용자가 만들고 고칠 수 있습니다. apiserver 플래그가 완전히 닫힌 영역에 남은 예외적인 통로입니다.

이 통로는 **총량이 아니라 배분만 다룹니다.** 서버 전체 seat 예산은 `--max-requests-inflight` + `--max-mutating-requests-inflight`가 정하고 그건 AWS가 쥐고 있습니다(티어로 간접 조정, §6). 우리는 그 고정된 예산을 누구에게 얼마나 줄지만 나눕니다.

```yaml
apiVersion: flowcontrol.apiserver.k8s.io/v1
kind: PriorityLevelConfiguration
metadata:
  name: platform-controllers
spec:
  type: Limited
  limited:
    nominalConcurrencyShares: 30
    lendablePercent: 0
    limitResponse:
      type: Queue
      queuing:
        queues: 32
        handSize: 6
        queueLengthLimit: 50
---
apiVersion: flowcontrol.apiserver.k8s.io/v1
kind: FlowSchema
metadata:
  name: platform-controllers
spec:
  matchingPrecedence: 900
  priorityLevelConfiguration:
    name: platform-controllers
  distinguisherMethod:
    type: ByUser
  rules:
    - subjects:
        - kind: ServiceAccount
          serviceAccount: { namespace: karpenter, name: karpenter }
      resourceRules:
        - verbs: ["*"]
          apiGroups: ["*"]
          resources: ["*"]
          clusterScope: true
          namespaces: ["*"]
```

이 방식으로 **격리**를 얻습니다. 특정 컨트롤러가 폭주해도 다른 컨트롤러의 seat를 다 먹지 못하게 상한을 겁니다. 반대로 karpenter처럼 노드 프로비저닝을 담당하는 컨트롤러는 배치 작업에 밀려 굶지 않게 우선순위를 확보합니다.

업스트림 apiserver는 기본 제공 `FlowSchema`·`PriorityLevelConfiguration`을 부팅 때 다시 채워 넣으면서 사용자가 수정한 suggested 오브젝트를 원복시킵니다. 업스트림에서는 `apf.kubernetes.io/autoupdate-spec: "false"` 를 붙여야 이 원복을 막습니다. **EKS 관리형 apiserver에서 이 동작이 그대로인지는 이번에 실측하지 않았습니다.** 기본 오브젝트를 수정하기보다 새 오브젝트를 추가하는 쪽이 안전합니다.

### 7.2 어드미션 — 세 갈래

| 수단 | 조건 | 성격 |
|---|---|---|
| **ValidatingAdmissionPolicy**(CEL) | 클러스터 리소스, 게이트 GA는 1.30+ | 웹훅 서버가 없어 레이턴시·가용성 리스크가 없다. 단 EKS 활성 여부를 `kubectl apply`로 먼저 검증해야 한다(§4) |
| **`ValidatingWebhookConfiguration` / `MutatingWebhookConfiguration`** | 두 웹훅 플러그인이 EKS 기본 목록에 이미 있다(§2.2) | **가장 확실하게 되는 길.** 서버만 우리가 배포한다. 대신 웹훅 장애가 apiserver 요청 실패로 번질 수 있어 `failurePolicy` 설계가 필수다 |
| **Kyverno / OPA Gatekeeper** | 위 웹훅 메커니즘 위에 얹힌 정책 엔진 | EKS에 제약 없이 그대로 동작한다 |

`PodSecurity`는 이미 기본 활성입니다. 네임스페이스 라벨로 조정하면 되니 이 항목은 애초에 닫힌 적이 없습니다.

### 7.3 자체 스케줄러 배포

스케줄러 프로파일·플러그인은 못 고칩니다. 그 자리를 메우는 길은 하나뿐입니다. kube-scheduler를 우리가 하나 더 배포하고 그 스케줄러에 맡길 파드에 `spec.schedulerName`을 지정합니다.

```yaml
spec:
  template:
    spec:
      schedulerName: binpack-scheduler
```

- AWS가 `aws-samples/custom-scheduler-eks`로 참조 구현을 공개했습니다(bin packing 목적, EKS 1.24+ 명시).
- 같은 문서는 kube-scheduler를 직접 빌드하지 말고 eks-distro 이미지를 쓰라고 권고합니다. 버전 정합 관리가 그만큼 까다롭습니다.
- ServiceAccount + ClusterRoleBinding을 직접 구성해야 합니다. 스케줄러는 파드·노드·PV 전반에 광범위한 권한이 필요하므로 RBAC 범위가 작지 않습니다.
- 관리형 스케줄러와 공존합니다. `schedulerName`을 지정하지 않은 파드는 계속 EKS 관리형 스케줄러가 처리합니다. 그래서 전면 교체 없이 부분 적용으로 갈 수 있습니다. 반대로 두 스케줄러가 같은 노드 자원을 동시에 바인딩하려는 경쟁 조건은 우리 책임입니다.

### 7.4 감사·이벤트 보존

- **감사 정책의 세밀도**는 우회할 수 없습니다. `--audit-policy-file`이 없으니 "어떤 필드까지 기록할지"는 AWS가 정한 그대로입니다. 우리는 로그 타입을 켜고 나온 것을 반출해 **사후 필터링**합니다. `enabled_cluster_log_types`에 `audit`을 넣으면 CloudWatch Logs로 나가고 거기서 Logs Insights·Athena·외부 싱크로 옮겨 질의합니다.
- **이벤트 보존 기간**은 우회할 수 있습니다. `eventTtl`은 etcd 안에 얼마나 남기는지만 정합니다. Event 오브젝트를 watch해 외부 저장소로 밀어내는 exporter를 두면 TTL을 늘리지 않고도 장기 보존과 질의를 얻습니다. 오히려 이쪽이 권장 방향입니다. TTL을 늘리면 etcd 크기와 watch 캐시 부담이 함께 늘어나는데 그 둘은 우리가 손댈 수 없는 축입니다(§2.1·§5).

### 7.5 CCM — "제약"이 아니라 "쪼개졌다"

`cloudControllerManagerConfig` 같은 필드는 신설되지 않았고 `--cloud-provider`·`--route-reconciliation-period`·`--node-status-update-frequency` 류도 전부 비노출입니다. 하지만 CCM이 원래 하던 일의 대부분은 EKS에서 사용자가 직접 배포·설정하는 애드온으로 쪼개져 있습니다 — AWS Load Balancer Controller(ALB/NLB), VPC CNI, EBS/EFS CSI. 이 애드온들은 EKS가 관리하는 필드가 아니면 자유롭게 수정할 수 있습니다. 이 축에서 실제로 일어난 일은 **아키텍처가 다른 컴포넌트로 분해된 것**입니다. 순수한 제약과는 다릅니다.

EKS가 내부적으로 in-tree AWS cloud provider를 쓰는지 external `cloud-provider-aws`를 쓰는지는 AWS가 공개 문서로 밝히지 않아 이 한 가지는 확정하지 못했습니다.

## 8. `--force`를 둘러싼 흔한 오해

`aws eks update-cluster-version --force`를 "PDB와 웹훅을 무시하고 밀어붙이는 스위치"로 이해하는 경우가 많습니다. 아닙니다.

| 오해 | 실제 |
|---|---|
| PDB를 우회한다 | ⚠️ **아니다.** Auto Mode 클러스터에서도 NodePool 디스럽션 버짓·PDB·`karpenter.sh/do-not-disrupt`는 그대로 존중된다 |
| 어드미션 웹훅을 우회한다 | ⚠️ **아니다** |
| 모든 검증을 건너뛴다 | **아니다.** 7일 창·생성 시점 버전 확인·순차 롤백 확인 같은 필수 검증은 우회하지 못한다 |
| 무엇을 우회하나 | **EKS 자체 인사이트(readiness) 검사뿐이다** |

인사이트가 ERROR/UNKNOWN일 때 `--force` 없이는 업그레이드를 막는 기능은 **2025-03-27 도입 후 2025-03-28 임시 롤백**됐습니다. 2026-08-14 현재도 User Guide(cluster-insights.html)가 같은 문장을 현재 시제로 유지합니다. 여기에 시점 문제가 하나 더 겹칩니다.

> "Amazon EKS has temporarily rolled back a feature that would require you to use a `--force` flag to upgrade your cluster when there were certain cluster insight issues."

재활성화를 확인해 주는 1차 문서는 없습니다. 따라서 **전진 업그레이드에서 `--force`는 현재 실질적으로 거의 무효**입니다. 의미가 있는 자리는 다른 곳입니다 — 2026년 도입된 **클러스터 버전 롤백**(역방향) 흐름에서는 신설된 Rollback Readiness Insights가 ERROR/UNKNOWN일 때 `--force` 없이 롤백을 차단하는 강제 로직이 실제로 살아 있습니다. "인사이트가 ERROR면 업그레이드가 시스템적으로 막힌다"는 전제로 절차를 짜면 안 됩니다. 롤백 절차에서는 반대로 이 플래그를 계산에 넣어야 합니다. 롤백 계약 자체는 [컷오버·롤백]({{< relref "../05-cutover-rollback.md" >}})이 다룹니다.

## 9. 과장과 오해 정리

1차 근거로 반박되는 서술을 모았습니다.

| 흔한 서술 | 판정 | 1차 근거 |
|---|---|---|
| "이제 EKS에서 apiserver 플래그를 다 만질 수 있다" | ⚠️ **틀렸다** | 열린 세부 값은 **총 4개**이고 `kubeApiServerConfig`의 하위 필드는 2개다(§1.1) |
| "`--force`가 PDB를 무시한다" | ⚠️ **틀렸다** | EKS 인사이트 검사만 우회한다(§8) |
| "audit 로그를 켰으니 감사 정책을 정할 수 있다" | **틀렸다** | 로그 타입 on/off만 제공된다. `--audit-policy-file`은 비노출(§2.2) |
| "EKS에서도 alpha 기능을 켤 수 있다" | **틀렸다** | "Alpha features aren't supported" + 게이트·runtime-config 양쪽 비노출(§4) |
| "etcd 스냅샷을 받아 복원할 수 있다" | **틀렸다** | 스냅샷 제공 기능이 없다. Velero는 API 레벨이고 원자적 시점 복구가 아니다(§5) |
| "platform version을 골라 어드미션 플러그인을 조정할 수 있다" | **틀렸다** | platform version 자체를 못 고른다(§6) |
| "로컬 CLI `help`에 없으니 API에도 없다" | **틀렸다** | 2026-08-14 같은 날 `aws-cli 2.27.5`의 `create-cluster help`에는 없고 API Reference에는 있었다. 필드 부재는 반드시 최신 API Reference로 재대조한다 |
| "AWS가 다음에 무엇을 열지 로드맵이 있다" | **확인되지 않았다** | "다음에 무엇을 열겠다"는 AWS 문장은 찾지 못했고 안내는 Containers Roadmap 요청뿐이다. `#1468`(스케줄러 커스터마이즈)은 신기능 출시 뒤에도 열린 상태로 확인된다 |

## 우리 케이스에서는

finance가 실제로 부딪히는 닫힌 항목은 세 개로 좁혀집니다. 첫째는 **HPA downscale stabilization**입니다. 열린 것은 sync period뿐이라 스케일다운 지연은 HPA `behavior.scaleDown` 필드로 워크로드마다 따로 잡아야 합니다(오브젝트 레벨 설정이라 컨트롤 플레인과 무관하게 쓸 수 있습니다). **감사 정책 파일**이 둘째입니다. 금융 도메인이라 기록 레벨을 우리가 정하고 싶지만 그 축은 닫혔습니다. [클러스터 설정]({{< relref "../02-cluster-config.md" >}})이 `enabled_cluster_log_types=["audit"]`로 로그 타입을 켜는 데까지가 우리 몫입니다. 세 번째는 **etcd 스냅샷 부재**입니다. blue-green 이관이라 "green을 그대로 남겨둔다"는 것이 사실상 우리의 시점 복구 수단이고 컷오버 이후 시점부터는 Velero 같은 API 레벨 백업으로 내려앉습니다. 원자적 시점 복구가 없다는 대가는 이관 계획에 명시해 두는 편이 낫습니다.

이 조직은 [HyperDX 내재화]({{< relref "../../hyperdx/_index.md" >}})에서 ClickStack + ClickHouse를 직접 운영하고 있으므로 §7.4의 "감사·이벤트를 외부로 반출해 장기 보존·질의한다"는 우회에 새 스택을 세울 필요가 없습니다. 감사 로그와 Event를 보낼 싱크가 이미 서 있습니다. 우회 쪽에서 손에 쥔 자산이 이것 하나입니다. 다만 그 챕터의 용량 산정은 **RUM 전용 전제**(월 0.7TB 규모)로 잡혀 있어서 k8s 감사 로그를 얹으려면 별도 산정이 선행돼야 합니다. APF 쪽은 우선순위가 낮습니다. [레이어 2]({{< relref "02-component-parameters.md" >}})가 정리한 대로 blue create 시점에는 컨트롤 플레인 파라미터를 전부 기본값으로 두는 방침입니다. karpenter·ArgoCD 컨트롤러가 seat를 다투는지는 blue가 실제 부하를 받은 뒤에 `apiserver_flowcontrol_current_executing_seats`로 확인할 문제입니다.
