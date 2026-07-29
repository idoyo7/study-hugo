---
title: "1.7 → 1.14 — 운영에 쓸 기능들"
weight: 2
---

# 02 · 1.7 → 1.14 — 지금 켤 만한 것과 미룰 것

{{< callout type="info" >}}
**한눈에**
- 1.7 이후 8개 마이너에서 API breaking은 사실상 없다(1.13·1.14 가이드는 "No breaking changes"). 대신 **켜야 비로소 쓸 수 있는 기능**이 쌓였다 — 라벨 한 줄, feature gate, 신규 CRD, IAM 권한으로 층이 나뉜다.
- **flex 인스턴스 배제는 라벨 한 줄이다.** 1.7의 `karpenter.k8s.aws/instance-capability-flex`(aws#8315 → 이름 변경 aws#8490)를 `operator: In, values: ["false"]`로 걸면 끝난다. 단 `DoesNotExist`로 쓰면 **모든 인스턴스 타입이 배제되어 노드가 하나도 안 뜬다** — 라벨은 예외 없이 `true`/`false` 중 하나로 항상 붙는다.
- flex 배제를 **기존** NodePool에 추가하면 이미 떠 있는 flex 노드가 전부 `RequirementsDrifted`로 잡혀 교체된다. "다음부터 안 쓴다"가 아니라 "지금 있는 걸 몰아낸다"다.
- **1.12 업그레이드는 그 자체로 전 노드 교체를 유발할 수 있다** — CA bundle이 drift 해시에 처음 들어가면서(aws#9083) 기존 노드가 일괄 drifted로 표시된다. 업그레이드 전에 `reasons: ["Drifted"]` 예산을 좁혀두는 게 유일한 방어다.
- **1.8.4는 건너뛴다.** TopologySpreadConstraint 스케줄링 실패 회귀가 있고 업스트림 가이드가 업그레이드 금지를 명시했다([karpenter#2785](https://github.com/kubernetes-sigs/karpenter/issues/2785)). 1.11.0도 CPU 사용량 회귀 경고가 릴리스노트 상단에 박혀 있다([karpenter#2954](https://github.com/kubernetes-sigs/karpenter/issues/2954)).
- **1.14 Balanced consolidation은 feature gate가 없다.** `consolidationPolicy: Balanced` 한 줄이 전부고, 절감 비율 대 파드 파괴 비율 스코어가 `0.5`(k=2) 이상일 때만 통합한다(core#2962). RFC가 적어둔 `BalancedConsolidation` 게이트는 구현에 없다.
- **Capacity Buffers(1.14)는 pause pod 트릭의 정식 대체품**이지만 아직 `CapacityBuffer=false` alpha 게이트 뒤에 있고, API는 코드상 `v1beta1`인데 업스트림 개념 문서는 `v1alpha1`로 남아 있다(core#3129, aws#9276). 신규 CRD라 `karpenter-crd` 차트를 함께 올려야 한다.
- **IAM은 세 번 늘었다** — 1.7 `iam:ListInstanceProfiles`, 1.11 `ec2:DescribePlacementGroups`, 1.12 `ec2:DescribeInstanceStatus`(+ 옵트인 `arc-zonal-shift:GetManagedResource`). 1.9는 권한 값은 그대로 두고 관리형 정책만 5개로 쪼갰다.
- **알람이 조용히 깨진 곳이 두 군데 있다**(1.7, core#2421·core#2349): `karpenter_pods_pods_drained_total` → `karpenter_pods_drained_total`(core#2421), `karpenter_nodeclaims_disrupted_total`의 reason `liveness` → `registration_timeout`(core#2349).
- 우리 기준(EKS·ArgoCD·컨트롤러 Fargate·0.36.2에서 1.14.0 직행) 판정: flex 배제·IAM 3종·메트릭 쿼리 수정·drift 예산은 **지금**, Balanced consolidation·Zonal Shift는 **다음 분기**, Static NodePool·Capacity Buffers·NodeOverlay·DRA는 **보류**.
{{< /callout >}}

> **왜 이 문서인가.** 0.36에서 1.14로 한 번에 올리면 릴리스노트 8개를 연달아 읽어야 하는데, 그 노트들은 "무엇이 머지됐다"까지만 말한다. 정작 필요한 건 세 가지 구분이다 — ① 켜면 그냥 이득인 것, ② 설정·권한·CRD를 건드려야 하는 것, ③ **업그레이드 자체가 노드를 교체하는 것**. 이 문서는 그 셋으로 1.7~1.14를 갈라놓고, 각 항목이 우리 클러스터에서 지금 켤 만한지까지 판정한다.
>
> v1 전환 자체의 semantics(스키마 이동·drift 승격·disruption 리네임)는 [01 v1 전환]({{< relref "01-changelog-v1-transition.md" >}})이, 라벨·연산자·affinity 개념 레퍼런스는 [03 키워드 레퍼런스]({{< relref "03-keyword-reference.md" >}})가, 차트·values·ArgoCD 적용 절차는 [eks-upgrade/karpenter]({{< relref "../eks-upgrade/components/01-karpenter.md" >}})가 소유한다. 여기서는 반복하지 않는다.

> 근거 기준: 릴리스노트는 `aws/karpenter-provider-aws`와 `kubernetes-sigs/karpenter`의 **v1.14.0까지**, 업스트림 문서는 provider 레포 `website/content/en/docs/`(1.14 계열), 코드 인용은 **2026-07-30 기준 두 레포 main 체크아웃**이다. 릴리스일은 git 태그 생성일이다.

## 1. 타임라인 — 무엇이 언제 들어왔나

| 버전 | 릴리스(태그일, core / aws) | 대표 기능 | breaking·필요 조치 |
|---|---|---|---|
| **1.7** | 2025-09-12 / 2025-09-15 | flex 라벨, NodeOverlay(alpha), EC2NodeClass `spec.role` mutable, dry-run 비활성화, DRA 파드 명시적 무시 | **IAM** `iam:ListInstanceProfiles` 추가, **메트릭 리네임 2건**, NodeClaim launch timeout 5분 신설(core#2349, BREAKING 표기) |
| **1.8** | 2025-10-02 / 2025-10-08 | Static NodePool `spec.replicas`(alpha), Pod-level Resources 지원 | **CRD 업그레이드 필수**. **1.8.4 건너뛸 것**(TSC 회귀) |
| **1.9** | 2026-02-04 / 2026-02-06 | ICE 필터링(`MaxFleetCountExceeded`), tenancy 라벨, WS2025 AMI | **IAM 정책 5분할**(권한 값은 무변경) |
| **1.10** | 2026-03-17 / 2026-03-20 | interruptible ODCR에서 launch 지원 | **EventBridge 규칙**에 capacity reservation interruption `detail-type` 추가 |
| **1.11** | 2026-04-04 / 2026-04-06 | Placement Group 지원, ENI 구성, NodePool 노드 수 제한(`limits.nodes` 일반화) | **IAM** `ec2:DescribePlacementGroups` + `placement-group/*` 리소스(사용 시). **CPU 사용량 회귀 경고** |
| **1.12** | 2026-04-25 / 2026-04-24 | CA bundle drift, ARC Zonal Shift(옵트인), EC2 instance status 헬스체크, do-not-disrupt grace period | **업그레이드가 기존 노드를 일괄 drifted로 표시**. **IAM** `ec2:DescribeInstanceStatus`(필수) + `arc-zonal-shift:GetManagedResource`(옵트인) |
| **1.13** | 2026-06-10 / 2026-06-10 | ICE를 subnet 단위로, 커스텀 instance profile path, AMI·subnet refresh interval 설정화, conntrack·nested virtualization 필드 | 없음("No breaking changes") |
| **1.14** | 2026-07-10 / 2026-07-10 | Capacity Buffers `v1beta1`, Balanced consolidation, DRA 지원, preview instance types | **신규 CRD** `autoscaling.x-k8s.io_capacitybuffers` — `karpenter-crd` 차트 동반 업그레이드 |

k8s 호환 하한도 같이 올라갔다. 1.14는 k8s 1.30~1.36을 커버하고, **1.36을 쓰려면 최소 1.13**, 1.35는 1.9, 1.33은 1.5가 하한이다(`upgrading/compatibility.md`의 생성된 매트릭스).

## 2. flex 인스턴스를 한 줄로 배제한다 (1.7)

### 2.1 라벨의 정체 — EC2가 주는 필드가 아니라 문자열 패턴이다

1.7에서 `karpenter.k8s.aws/instance-capability-flex`가 well-known 라벨로 추가됐다. 도입은 [aws#8315](https://github.com/aws/karpenter-provider-aws/pull/8315)("adding instance-**capacity**-flex label")이고 같은 1.7.0 안에서 [aws#8490](https://github.com/aws/karpenter-provider-aws/pull/8490)이 `instance-**capability**-flex`로 이름을 바꿨다. 두 PR이 모두 1.7.0 changelog에 있으므로 **1.7.0 GA 시점의 이름은 처음부터 `instance-capability-flex`**다 — 어디서 본 `capacity` 표기는 릴리스 전 이름이다.

값을 정하는 코드는 세 줄이다(`karpenter-provider-aws/pkg/providers/instancetype/types.go:261-265`):

```go
if strings.Contains(instanceTypeParts[0], "-flex") {
    requirements[v1.LabelInstanceCapabilityFlex].Insert("true")
} else {
    requirements[v1.LabelInstanceCapabilityFlex].Insert("false")
}
```

`instanceTypeParts[0]`은 타입 이름의 `.` 앞부분, 즉 패밀리다. EC2 `DescribeInstanceTypes`가 flex 여부를 별도 필드로 주는 게 아니라 **패밀리 문자열에 `-flex`가 들어 있는지만 본다.** 1.14 시점 인스턴스 타입 레퍼런스의 flex 패밀리는 `c7i-flex`·`c8i-flex`·`m7i-flex`·`m8i-flex`·`r8i-flex` 다섯 개다.

같은 파일 `types.go:204`의 `NewRequirement(v1.LabelInstanceCapabilityFlex, corev1.NodeSelectorOpDoesNotExist)`는 "이 라벨이 없다"는 선언이 아니라 값 셋이 빈 초기 placeholder다. `Requirement.Operator()`는 값 셋이 비면 `DoesNotExist`, 차면 `In`을 리턴하고(`karpenter-core/pkg/scheduling/requirement.go:290-301`) 위 분기가 무조건 하나를 넣으므로, **실제로 만들어지는 모든 인스턴스 타입에는 예외 없이 `In ["true"]` 또는 `In ["false"]`가 붙는다. `DoesNotExist`로 남는 인스턴스 타입은 존재하지 않는다.** 이 사실이 다음 절의 전부다.

라벨은 노드에도 붙는다. AWS 프로바이더가 인스턴스 타입 requirement 중 **값이 정확히 하나인 것을 NodeClaim 라벨로 승격**시키므로(`pkg/cloudprovider/cloudprovider.go:420-437`의 `req.Len() == 1` 분기) 모든 노드에 이 라벨이 박힌다. `kubectl get nodes -L karpenter.k8s.aws/instance-capability-flex`로 지금 클러스터의 flex 노드를 바로 센다.

### 2.2 배제 레시피 — 세 가지 중 하나는 클러스터를 세운다

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: general
spec:
  template:
    spec:
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: default
      requirements:
        - key: karpenter.k8s.aws/instance-capability-flex
          operator: In
          values: ["false"]
```

| 레시피 | 결과 | 판정 |
|---|---|---|
| `operator: In` / `values: ["false"]` | flex=false 인스턴스만 후보. 의도대로 동작 | **최적** — 읽는 사람이 바로 이해한다 |
| `operator: NotIn` / `values: ["true"]` | `In ["false"]`와 **완전히 동치**. 라벨 값 공간이 `{true, false}` 둘뿐이라 제3의 값이 나올 수 없다 | **좋음** — 동작은 같지만 의미가 한 겹 꼬인다 |
| `operator: DoesNotExist` | **모든 인스턴스 타입이 배제된다.** 신규 노드가 하나도 안 뜨고 기존 노드는 전부 drift로 잡힌다 | **부적합** — 절대 쓰지 않는다 |

`DoesNotExist`가 왜 전멸인지는 교집합 판정 코드에 있다. `Requirement.HasIntersection`(`requirement.go:220-253`)은 양쪽이 모두 non-complement일 때 `for v := range r.values { if requirement.values.Has(v) ... }`로 겹치는 값을 찾는다. `DoesNotExist`는 값 셋이 **빈 집합**인 non-complement 요구사항이라 루프가 한 번도 돌지 않고 `false`가 리턴된다. 인스턴스 타입 쪽은 `In ["true"]`든 `In ["false"]`든 값이 하나 있으니 **flex 여부와 무관하게 교집합 없음**이다. `NotIn`은 complement라서 반대편 값 셋을 순회하는 다른 분기를 타고, 그래서 정상 동작한다.

`In`을 쓸 때도 함정이 하나 남는다. **값 오타는 admission에서 안 걸린다.** well-known 라벨의 값 검증(`karpenter-core/pkg/apis/v1/nodeclaim_validation.go:167-178`)은 `WellKnownValuesForRequirements` 맵에 해당 키가 등록돼 있을 때만 동작하고, 등록된 건 `karpenter.sh/capacity-type`(core)과 `karpenter.k8s.aws/instance-tenancy`(AWS provider가 `labels.go:66`에서 추가)뿐이다. flex 라벨은 없다. 그래서 `values: ["False"]`(대문자 F)나 `["no"]`를 써도 NodePool은 그대로 `Ready`가 되고 증상은 **파드가 안 뜨는 것**으로만 나타난다. 1.7이 같이 넣은 [core#2341](https://github.com/kubernetes-sigs/karpenter/pull/2341)("pod errors when nodepool requirements filter all instance types")이 이 경우의 파드 에러 메시지를 개선했으니, NodePool 상태가 아니라 **pending 파드의 이벤트**를 먼저 본다.

### 2.3 왜 배제하나 — 베이스라인이 보장되지 않는다

`-flex` 패밀리는 AWS가 "평균 CPU 사용률이 낮은 워크로드용"으로 내놓은 라인이다. 같은 세대 일반 패밀리보다 저렴한 대가로 성능 모델이 **베이스라인 + 버스트**이고, 지속적으로 vCPU를 밀어 쓰면 버스트 여력이 소진된 뒤 베이스라인으로 떨어진다. 문제가 되는 워크로드는 셋이다.

| 워크로드 | flex에서 무슨 일이 나나 | 판정 |
|---|---|---|
| 지속 고CPU(스트림 처리, 컴파일, 배치) | 버스트 소진 후 처리량이 계단식으로 떨어진다. 노드마다 소진 시점이 달라 **같은 Deployment의 파드 성능이 갈린다** | **부적합** |
| p99 민감한 온라인 API | 스로틀 시점이 비결정적이라 지연시간 꼬리가 튄다. 원인 추적이 어려운 종류의 장애 | **부적합** |
| istiod·ingress gateway 같은 컨트롤/데이터 플레인 | 부하 스파이크와 버스트 소진이 겹치면 복구가 늦다 | **부적합** |
| 이벤트 드리븐 워커, cron 잡, 개발/스테이징 | 평균 사용률이 낮아 flex의 가격 이점을 그대로 먹는다 | **최적** |

즉 "flex는 나쁘다"가 아니라 **"flex를 골라 쓰는 결정을 스케줄러에 맡기지 않겠다"**는 선택이다. Karpenter는 가격만 보고 고르므로, 아무 제약이 없으면 지속 고CPU 워크로드가 flex 노드에 앉는 조합이 정상적으로 나온다.

*이 절의 베이스라인·버스트 동작은 AWS EC2 문서의 일반 서술을 근거로 한다. 이 문서에서 코드로 검증한 것은 라벨 판정 로직과 스케줄링 배제 동작뿐이다.*

### 2.4 배제보다 나은 선택 — 전용 NodePool로 격리

전 클러스터에서 flex를 지우면 평균 사용률 낮은 워크로드의 비용 이점도 같이 버린다. NodePool을 둘로 갈라 flex를 **taint로 격리**하면 둘 다 챙긴다.

```yaml
# ① 기본 풀 — flex 배제, weight를 높여 먼저 선택되게 한다
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: general
spec:
  weight: 50
  template:
    spec:
      nodeClassRef: { group: karpenter.k8s.aws, kind: EC2NodeClass, name: default }
      requirements:
        - key: karpenter.k8s.aws/instance-capability-flex
          operator: In
          values: ["false"]
---
# ② flex 전용 풀 — taint로 격리, weight를 낮춰 opt-in만 받는다
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: flex
spec:
  weight: 10
  template:
    spec:
      nodeClassRef: { group: karpenter.k8s.aws, kind: EC2NodeClass, name: default }
      taints:
        - key: capability
          value: flex
          effect: NoSchedule
      requirements:
        - key: karpenter.k8s.aws/instance-capability-flex
          operator: In
          values: ["true"]
```

flex를 쓰려는 워크로드만 `tolerations`에 `capability=flex:NoSchedule`을 적는다. 기본은 안전, opt-in으로 절감이라는 구조가 되고, "이 워크로드는 버스트로 충분하다"는 판단이 워크로드 매니페스트에 명시적으로 남는다. 반대로 **전량 배제는 클러스터에 flex 워크로드 후보가 아예 없을 때만** 합리적이다.

### 2.5 기존 NodePool에 적용하면 노드가 교체되는가 — 교체된다

**교체된다.** drift 판정 코드가 근거다(`karpenter-core/pkg/controllers/nodeclaim/disruption/drift.go:170-180`):

```go
func areRequirementsDrifted(nodePool *v1.NodePool, nodeClaim *v1.NodeClaim) cloudprovider.DriftReason {
	nodepoolReq := scheduling.NewNodeSelectorRequirementsWithMinValues(nodePool.Spec.Template.Spec.Requirements...)
	nodeClaimReq := scheduling.NewLabelRequirements(nodeClaim.Labels)
	if nodeClaimReq.Compatible(nodepoolReq) != nil {
		return RequirementsDrifted
	}
	return ""
}
```

비교 대상은 **NodeClaim의 현재 라벨**과 **NodePool의 현재 requirements**다. §2.1에서 본 것처럼 flex 노드의 NodeClaim에는 `instance-capability-flex=true`가 이미 박혀 있고, 라벨은 인스턴스 생성 시점에 고정되어 이후 바뀌지 않는다. requirement가 `In ["false"]`로 바뀌는 순간 그 노드는 호환 실패 → `RequirementsDrifted`가 된다. v1에서 drift는 비활성화가 불가능하니 이 판정을 끌 방법도 없다.

결과는 **떠 있던 flex 노드 전량의 순차 교체**(대체 노드는 non-flex)다. 도입 순서는 ① `kubectl get nodes -L karpenter.k8s.aws/instance-capability-flex`로 교체 대상 규모를 세고 → ② 규모가 크면 `spec.disruption.budgets`에 `reasons: ["Drifted"]` 예산을 먼저 좁게 걸고(§6.1의 yaml 재사용) → ③ 한 NodePool씩, 큰 풀은 업무시간 외에 requirement를 추가한다. blue-green으로 신규 클러스터를 세우는 경로면 기존 flex 노드가 없으므로 이 절은 무해하다.

## 3. 1.7의 나머지 — 조용히 알람을 깨는 것들이 섞여 있다

| 항목 | 무엇이 바뀌나 | 우리가 할 일 |
|---|---|---|
| **메트릭 리네임** ([core#2421](https://github.com/kubernetes-sigs/karpenter/pull/2421) · [core#2349](https://github.com/kubernetes-sigs/karpenter/pull/2349), BREAKING) | `karpenter_pods_pods_drained_total`(중복 `pods` 오타) → `karpenter_pods_drained_total`(core#2421). `karpenter_nodeclaims_disrupted_total`의 reason 라벨 `liveness` → `registration_timeout`(core#2349 — 아래 NodeClaim launch timeout과 같은 PR) | Grafana 대시보드·Prometheus 알람 룰 grep. **경보가 조용히 안 오는 종류의 사고**라 업그레이드 후에 발견되면 늦다 |
| **NodeClaim launch timeout** ([core#2349](https://github.com/kubernetes-sigs/karpenter/pull/2349), BREAKING) | `registrationTimeout = 15m`만 있던 자리에 `LaunchTimeout = 5m`이 추가됐다(`pkg/controllers/nodeclaim/lifecycle/liveness.go:51-59`) — launch 자체가 5분 안에 안 되면 NodeClaim을 지우고 재시도 | 용량 부족 상황의 재시도 주기가 15분→5분. NodeClaim 생성/삭제 이벤트 볼륨이 늘 수 있다. AWS upgrade-guide 1.7 절에는 이 항목이 **없다**(core 릴리스노트에만 BREAKING 표기) |
| **Instance profile path 변경** | 루트(`/`) → `/karpenter/{region}/{cluster-name}/{nodeclass-uid}/`. 기존 프로필은 그대로, 신규만 새 경로 | **IAM `iam:ListInstanceProfiles` 추가**(cloudformation의 `AllowUnscopedInstanceProfileListAction`). 1.13에서 path를 사용자 지정할 수 있게 됐다(aws#9120) |
| **`iam:GetRole` 의존성 제거** ([aws#8419](https://github.com/aws/karpenter-provider-aws/pull/8419)) | 권한이 **줄어든** 드문 사례 | 조치 불필요(붙어 있어도 무해) |
| **NodeOverlay AWS 지원** ([aws#8305](https://github.com/aws/karpenter-provider-aws/pull/8305)) | 인스턴스 타입의 가격·확장 리소스를 오버레이로 보정하는 `NodeOverlay`(`karpenter.sh/v1alpha1`)의 AWS 구현 | `NodeOverlay=false` alpha 게이트. Savings Plan 반영이나 커스텀 확장 리소스가 필요할 때만 |
| **EC2NodeClass `spec.role` mutable화** ([aws#8249](https://github.com/aws/karpenter-provider-aws/pull/8249)) | 생성 후에도 role 변경 가능 | 노드 롤 교체 시 EC2NodeClass 재생성이 불필요해졌다 |
| **dry-run 비활성화 + 실 launch template 검증** (aws#8350, aws#8408) | `DISABLE_DRY_RUN=true`로 검증의 dry-run 호출 생략. 검증 자체는 실제 LT 생성 기반으로 전환 | dry-run 호출이 SCP·정책에 막히는 환경에서만 필요 |
| **DRA `ResourceClaim` 파드 명시적 무시** ([core#2384](https://github.com/kubernetes-sigs/karpenter/pull/2384)) | 구버전은 필드를 몰라서 무시했고 1.7은 알고 무시한다. 동작은 동일 | 조치 불필요. 1.14에서 실제 지원이 들어온다(§7.3) |
| **capacity block 만료 처리** ([aws#8362](https://github.com/aws/karpenter-provider-aws/pull/8362)) | 만료 예정 capacity block을 offering에서 unavailable로 표시 | capacity block 사용 시 무의미한 launch 실패 감소 |

## 4. 1.8 — Static NodePool, 그리고 1.8.4를 건너뛰는 이유

### 4.1 dynamic과 무엇이 다른가

`spec.replicas`가 존재하면 그 NodePool은 **static**이 된다([core#2521](https://github.com/kubernetes-sigs/karpenter/pull/2521), 설계는 `karpenter-core/designs/static-capacity.md`). 파드 수요와 무관하게 고정 노드 수를 유지한다.

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: baseline
spec:
  replicas: 6          # 이 필드의 존재가 static 여부를 결정한다
  limits:
    nodes: 10          # drift·expiration 중 버스트 상한. limits는 nodes만 허용
  template:
    spec:
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: default
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["on-demand"]
        - key: node.kubernetes.io/instance-type
          operator: In
          values: ["m7i.2xlarge"]
```

`kubectl scale nodepool baseline --replicas=10`으로 조절하고, 현재 수는 `status.nodes`에 나온다.

| 항목 | dynamic NodePool | static NodePool |
|---|---|---|
| 노드 수 결정 | pending 파드 수요 | `spec.replicas` 고정 |
| consolidation | 대상 | **대상 제외**. `consolidationPolicy`·`consolidateAfter`는 지정해도 **무시**된다 |
| `limits` | cpu/memory/pods 등 자유 | **`limits.nodes`만** 허용. 그 외 지정 시 검증 에러 |
| `weight` | 사용 가능 | **금지**(검증 에러) |
| 스케일 조작 | 해당 없음 | node disruption budget을 **우회**하되 PodDisruptionBudget은 존중 |
| 모드 전환 | — | **불가**. `replicas`를 한 번 세팅하면 nil로 되돌릴 수 없다(NodePool 삭제만) |

마지막 줄이 도입 리스크의 전부다. `replicas`를 잘못 붙이면 되돌리는 방법이 NodePool 삭제, 즉 노드 전량 교체다.

### 4.2 어디에 쓰나

설계 문서가 든 동기는 셋이다(`static-capacity.md:4-9`) — JIT 프로비저닝 지연을 못 견디는 성능 민감 워크로드, 항상 가용해야 하는 예측 가능한 용량, 예산·격리·인프라 경계를 노드 수로 관리하는 운영 모델. 기존 우회책이 pause pod과 별도 노드 관리 도구였다는 점도 명시되어 있다. 실무 번역:

| 목적 | static이 맞나 | 대안 |
|---|---|---|
| 기준 용량 상시 유지(트래픽 바닥에서도 N대) | **좋음** — 이걸 위해 만들어졌다 | pause pod 트릭(수동 관리), Capacity Buffers(§7.1) |
| 스파이크 대비 warm 노드 | **반쪽** — 고정 수라 수요에 비례하지 않는다 | **Capacity Buffers**가 상위 호환(percentage로 비례) |
| 예약 인스턴스·Savings Plan 소진 | **좋음** — 고정 수 × 고정 타입이 약정 소진과 잘 맞는다 | — |
| 노드 수 예산 상한 | **부적합** — 일반 NodePool도 1.11부터 `limits.nodes`를 쓴다([core#2526](https://github.com/kubernetes-sigs/karpenter/pull/2526)) | dynamic + `limits.nodes` |

**CRD 업그레이드가 필수**다(`upgrade-guide.md`의 1.8 절: "Make sure to upgrade your karpenter CRDs to use this feature"). `replicas`·`limits.nodes`·`status.nodes`가 스키마에 추가되므로, `karpenter-crd`를 별도 관리하면 컨트롤러와 함께 올려야 한다. feature gate는 `StaticCapacity=false`(alpha, since v1.8.x)다.

### 4.3 1.8.4를 건너뛴다

업스트림 업그레이드 가이드가 직접 적었다 — *"Karpenter `v1.8.4` release contains a regression which may prevent Karpenter from scheduling pods with specific TopologySpreadConstraint configurations. Please do not upgrade to this version."* ([karpenter#2785](https://github.com/kubernetes-sigs/karpenter/issues/2785)). 관련 커밋 이력을 보면 TSC `nodeAffinityPolicy: Honor` 수정(core#2639)이 머지된 뒤 1.9에서 리버트(core#2797)됐다. 1.8 계열에 머물러야 한다면 1.8.4 이후 patch로 간다.

같은 성격의 경고가 하나 더 있다. **1.11.0 릴리스노트 상단**에 CPU 사용량 회귀 경고가 박혀 있다([karpenter#2954](https://github.com/kubernetes-sigs/karpenter/issues/2954)). 1.11에 머물 계획이면 컨트롤러 CPU requests를 넉넉히 잡아야 하고, 1.12+로 지나가면 해당 없다.

## 5. 1.9 ~ 1.11 — 권한과 배치

### 5.1 IAM 정책 5분할 (1.9)

cloudformation 템플릿의 컨트롤러 관리형 정책이 하나에서 다섯 개로 쪼개졌다([aws#7874](https://github.com/aws/karpenter-provider-aws/issues/7874) 대응). **권한 값 자체는 1.8과 동일**하고 정책 이름·경계만 바뀌었다. 1.12에서 Zonal Shift용 정책이 여섯 번째로 붙는다. 우리처럼 템플릿을 참조하지 않고 IRSA 롤에 인라인 정책을 직접 붙이는 구성이면 무해하고, 템플릿이 만든 정책 ARN을 attach하는 방식이면 5개를 모두 붙여야 한다(하나 빠지면 그 경계의 기능이 조용히 실패한다).

### 5.2 Capacity Reservation 인터럽션 (1.10)

interruptible ODCR에서 노드를 띄울 수 있게 됐다([aws#9019](https://github.com/aws/karpenter-provider-aws/pull/9019)). 짝으로 **EventBridge 규칙에 capacity reservation instance interruption 경고용 `detail-type`을 추가**해야 한다(IAM이 아니라 규칙 변경). 누락하면 경고를 못 받아 **강제 종료 전 drain 기회를 놓친다** — spot 인터럽션과 같은 실패 모드다. interruptible ODCR을 안 쓰면 조치 불필요.

### 5.3 Placement Group (1.11)

EC2 Placement Group을 EC2NodeClass에서 선택할 수 있게 됐다([aws#9030](https://github.com/aws/karpenter-provider-aws/pull/9030)). 노드에 `karpenter.k8s.aws/placement-group-id`가, partition 전략이면 `.../placement-group-partition`이 붙는다(`pkg/apis/v1/labels.go`의 well-known 라벨 목록, `pkg/cloudprovider/cloudprovider.go:471-488`). 쓸 수 있게 된 것은 EC2 placement group의 세 전략 그대로다 — cluster(저지연·고대역, HPC·MPI), spread(하드웨어 분산), partition(랙 단위 격리, 분산 스토리지·Kafka류).

IAM 두 곳이 늘어난다: `AllowRegionalReadActions`에 `ec2:DescribePlacementGroups`, `AllowScopedEC2InstanceAccessActions`에 `arn:${AWS::Partition}:ec2:${AWS::Region}:*:placement-group/*` 리소스. **실제로 쓰는 클러스터만** 갱신하면 되고, 안 주면 해당 EC2NodeClass의 검증·기동이 실패한다.

같은 버전의 나머지: NodeClass 설정값 필터링(aws#9017), 네트워크 인터페이스 구성(aws#9027), 그리고 일반 NodePool의 `limits.nodes`(core#2526) — static이 아닌 풀에도 노드 수 상한이 생겨 "리소스 총량이 아니라 노드 개수로 예산을 거는" 방식이 가능해졌다.

## 6. 1.12 — 업그레이드 자체가 노드를 교체한다

### 6.1 CA bundle drift

[aws#9083](https://github.com/aws/karpenter-provider-aws/pull/9083)이 CA 번들을 drift 해시 계산에 포함시켰다. 업스트림 가이드의 표현이 정확하다 — *"The updated hashing logic will mark existing nodes as drifted."*

메커니즘은 단순하다. Karpenter는 EC2NodeClass·NodePool의 정적 설정을 해시해 NodeClaim에 annotation으로 박아두고 해시가 달라지면 drift로 본다. CA 번들이 해시 입력에 **처음 들어가는 순간** 기존 모든 NodeClaim의 저장된 해시는 새 계산식과 어긋난다. 결과는 **전 노드 일괄 drifted 표시**다 — 번들 내용이 바뀐 게 아니라 해시 정의가 바뀐 것이라, 실제로 교체가 필요한 노드는 하나도 없는데 전량이 교체 대기줄에 선다.

v1에서 drift는 GA로 승격되어 **비활성화가 불가능**하다. 방어는 disruption budget 하나뿐이고, **업그레이드 전에** 넣어야 한다.

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: general
spec:
  disruption:
    consolidationPolicy: WhenEmptyOrUnderutilized
    consolidateAfter: 1m
    budgets:
      # ① 평시 전체 상한 — budgets를 지정하면 기본값(nodes 10%)이 사라지므로 명시적으로 유지한다
      - nodes: "10%"
      # ② drift만 따로 조인다 — CA bundle 해시 변경으로 전 노드가 drifted가 되는 구간의 방어
      - nodes: "2"
        reasons: ["Drifted"]
      # ③ 업무시간에는 drift 교체를 아예 멈춘다 (평일 09:00부터 9시간)
      - nodes: "0"
        reasons: ["Drifted"]
        schedule: "0 9 * * mon-fri"
        duration: 9h
```

세 가지를 알고 써야 한다. **`budgets`를 지정하면 기본값 `nodes: 10%`가 대체된다** — ①을 빼면 전체 상한이 사라진다. **동시 활성 예산이 여럿이면 가장 제한적인 값이 이긴다** — 업무시간에는 ②(2대)와 ③(0대)이 겹쳐 0대가 적용된다. **`reasons` 값은 `Underutilized`·`Empty`·`Drifted` 셋뿐**이고(`karpenter-core/pkg/apis/v1/nodepool.go`의 `DisruptionReason` enum) `duration`은 시간·분만 받는다.

`nodes: "0"`을 무기한 유지하는 건 나쁜 선택이다 — AMI 갱신 같은 **정상 drift도 같이 막히고**, 예산을 푸는 순간 쌓인 drift가 한꺼번에 터진다. 업그레이드 직후 며칠간 좁게 잡고 규모를 보며 단계적으로 푼다.

### 6.2 ARC Zonal Shift (옵트인)

AWS Application Recovery Controller의 Zonal Shift를 Karpenter가 인지하게 됐다([aws#9042](https://github.com/aws/karpenter-provider-aws/pull/9042)). Zonal Shift는 AZ 장애 시 그 AZ의 노드를 cordon하고 파드 엔드포인트를 EndpointSlice에서 빼는 EKS 기능이고, **Karpenter가 여기서 하는 일은 하나**다 — Zonal Shift가 활성인 동안 **그 AZ에 신규 노드를 띄우지 않는다**(`concepts/scheduling.md`의 Zonal Shift 절). cordon·엔드포인트 제거는 EKS/ARC 몫이고, Karpenter는 "장애 AZ로 새 용량을 밀어넣지 않는" 부분만 담당한다.

전제가 둘이다: EKS 클러스터에서 Zonal Shift가 활성화돼 있어야 하고, 컨트롤러가 `arc-zonal-shift:GetManagedResource`를 가져야 한다(cloudformation의 `AllowZonalShiftActions`, 리소스는 대상 클러스터 ARN으로 스코핑). 권한이 없으면 **에러가 아니라 그냥 미동작**이라 켠 줄 알고 안 켜져 있는 상태가 될 수 있다. 후속 patch에서 reserved 인스턴스에도 적용하는 수정이 들어갔다(aws#9094). AZ 단위 TopologySpreadConstraint를 이미 쓰고 있으면 조합이 자연스럽다 — 스프레드로 평시 분산, Zonal Shift로 장애 AZ 자동 회피.

### 6.3 EC2 instance status 헬스체크와 do-not-disrupt grace period

**인터럽션 컨트롤러가 `ec2:DescribeInstanceStatus`를 본다**([aws#9064](https://github.com/aws/karpenter-provider-aws/pull/9064)). 지금까지 인터럽션 소스는 SQS로 들어오는 EventBridge 이벤트(spot ITN, 예정된 유지보수)뿐이었고 EC2 상태 검사 실패는 감지 대상이 아니었다. 이제 상태 검사가 실패한 인스턴스도 인터럽션으로 처리해 노드를 정리한다. **이 권한은 옵션이 아니라 필수**다(가이드가 "new required permission"으로 적었다). 안 주면 하드웨어 문제로 unhealthy가 된 인스턴스가 drain 없이 방치된다.

`karpenter.sh/do-not-disrupt` 어노테이션이 **기간제**를 받게 됐다([core#2874](https://github.com/kubernetes-sigs/karpenter/pull/2874)) — `"true"`는 영구 보호(기존 동작), `"30m"` 같은 Go duration은 파드가 Running이 된 뒤 그 기간만 보호한다. 잘못된 duration은 무시되고 파드에 이벤트가 남는다(`concepts/disruption.md`). 용도는 "웜업이 끝나기 전엔 건드리지 마라"다 — 캐시 프리로드, 대용량 인덱스 로딩, 배치 잡 초기 구간. 지금까지 이런 워크로드는 `"true"`를 걸고 **떼는 걸 잊어버려** 통합에서 영구 제외되는 패턴이 흔했다. 그 실수를 구조적으로 막는 변경이다.

## 7. 1.13 ~ 1.14 — headroom·consolidation·DRA

1.13은 breaking 없는 운영 개선 묶음이다. **ICE(insufficient capacity) 캐시가 AZ 단위에서 subnet 단위로** 내려가([aws#9054](https://github.com/aws/karpenter-provider-aws/pull/9054)) IP 부족 때 AZ 전체를 배제해 선택지를 과도하게 줄이던 문제를 고쳤고, **AMI·subnet refresh interval이 설정 가능**해졌다(aws#9149/#9150, 둘 다 기본 1분, 최소 1분 — `DescribeSubnets`·`DescribeImages` 호출량을 줄이는 대가로 발견 지연을 감수하는 트레이드오프). 그 외 NodeClass 검증 실패 사유 구체화(aws#9114), 커스텀 instance profile path(aws#9120), conntrack 필드(aws#9152), nested virtualization(aws#9043).

1.14가 실제 판단이 필요한 버전이다.

### 7.1 Capacity Buffers — pause pod 트릭의 정식 대체품

headroom을 만드는 관습적 방법은 낮은 PriorityClass의 pause pod을 띄워 자리를 잡아두는 것이었다. 실제 파드이므로 실제 자원을 먹고, 실제 워크로드가 오면 선점(preemption)으로 밀려난다. Capacity Buffers는 같은 목적을 **가상 파드**로 달성한다 — 스케줄링 시뮬레이션 안에만 존재하고 클러스터에 실제로 생성되지 않으며, 매 프로비저닝 사이클마다 재계산된다([core#2898](https://github.com/kubernetes-sigs/karpenter/pull/2898) 설계, [core#3129](https://github.com/kubernetes-sigs/karpenter/pull/3129)로 v1beta1 승격, AWS 지원은 [aws#9276](https://github.com/aws/karpenter-provider-aws/pull/9276)).

```yaml
apiVersion: autoscaling.x-k8s.io/v1beta1
kind: CapacityBuffer
metadata:
  name: web-headroom
  namespace: prod
spec:
  provisioningStrategy: buffer.x-k8s.io/active-capacity
  # scalableRef를 쓰면 워크로드 규모에 비례한다 (podTemplateRef와 상호배타)
  scalableRef:
    apiGroup: apps
    kind: Deployment
    name: web
  percentage: 20      # web의 현재 replicas의 20%
  limits:             # 상한 — 최종 개수는 min(max(replicas, percentage), limits)
    cpu: "16"
    memory: 32Gi
```

pause pod 대비 이점 셋이 문서와 설계에서 확인된다.

| 항목 | pause pod 트릭 | Capacity Buffers |
|---|---|---|
| 자원 점유 | 실제 파드가 실제로 점유. kubelet·CNI·이미지 풀 비용 발생 | 가상 파드 — 시뮬레이션에만 존재 |
| 워크로드 반응 | 개수를 수동 관리 | `percentage`로 `scalableRef` replicas에 비례. 변경은 30초 내 반영 |
| 실 파드가 들어올 때 | **선점(preemption)** — pause pod가 evict되고 스케줄러가 재배치 | 다음 사이클에 버퍼가 다시 계산되고 부족분만 새로 프로비저닝 |
| consolidation과의 충돌 | 노드가 "pause pod만 있는 노드"로 보여 통합 대상이 되는 진동 | **empty consolidation이 차단**된다(`Unconsolidatable` 이유 `"Node has buffer pods"`). underutilized·drift·expiry는 허용되고 대체 노드에 버퍼가 다시 들어간다 |

개수는 `min(max(replicas, percentage), limits)`다 — `replicas: 5` + `percentage: 80`(10 replica Deployment)이면 `max(5,8)=8`, 여기에 `limits: {cpu: 4}`(파드당 1 CPU)를 걸면 `min(8,4)=4`. 상태는 컨디션 둘로 본다: `ReadyForProvisioning`(템플릿 해석·개수 계산 성공)과 `Provisioning`(가상 파드가 기존 용량에 다 들어가는지 `FitsExistingCapacity`, 아니면 프로비저닝 중이거나 NodePool limit에 막힘).

**지금 켜기 어려운 이유**가 셋이다. ① feature gate가 `CapacityBuffer=false`(alpha)로 꺼져 있다(`karpenter-core/pkg/operator/options/options.go`의 `--feature-gates` 기본값 문자열). ② **신규 CRD**라 `karpenter-crd` 차트를 컨트롤러와 함께 올려야 하고 `capacitybuffers`·`podtemplates` RBAC이 필요하다. ③ 업스트림 문서가 낡았다 — 코드와 CRD 매니페스트는 `v1beta1`인데(`pkg/apis/autoscaling/v1beta1/capacitybuffer.go`, `pkg/apis/crds/autoscaling.x-k8s.io_capacitybuffers.yaml:50`) `concepts/capacitybuffers.md`의 예시 yaml과 `reference/settings.md`의 게이트 표는 `v1alpha1`·`Since v1.13.x`로 남아 있다. **문서를 그대로 복붙하면 없는 API 버전을 적게 된다.** API 버전 승격과 게이트 활성화는 별개 축이다 — v1beta1이 됐어도 게이트는 꺼져 있다.

그 밖의 제약: PVC·ephemeral 볼륨은 가상 파드에서 제거되고(실제 PVC가 없어 토폴로지 해석 불가), `scalableRef` 변경 감지는 30초 폴링이며, 버퍼도 NodePool 리소스 limit에 걸린다.

### 7.2 Balanced consolidation — 절감과 파괴의 비율로 판단한다

기존 두 정책은 양 극단이었다. `WhenEmpty`는 빈 노드만 지우고, `WhenEmptyOrUnderutilized`는 **절감이 조금이라도 있으면 규모를 묻지 않고 통합**한다. 후자에서 나오는 불만이 "10원 아끼려고 파드 40개를 옮긴다"였다. `Balanced`([core#2962](https://github.com/kubernetes-sigs/karpenter/pull/2962), 설계 `karpenter-core/designs/balanced-consolidation.md`)는 그 사이를 스코어로 메운다.

{{< flow caption="세 정책은 같은 disruption cost 모델의 서로 다른 임계값이다 — Balanced는 k=2, 즉 절감 비율이 파괴 비율의 절반 이상일 때만 승인한다" >}}
{
  "nodes": [
    { "id": "A", "col": 0, "row": 1, "label": "통합 액션 후보", "sub": "노드 삭제 또는 저가 교체", "kind": "src" },
    { "id": "E", "col": 1, "row": 0, "label": "WhenEmpty", "sub": "파드 disruption cost 0일 때만", "kind": "query" },
    { "id": "B", "col": 1, "row": 1, "label": "Balanced", "sub": "score = 절감비율 / 파괴비율", "kind": "proc" },
    { "id": "U", "col": 1, "row": 2, "label": "Underutilized", "sub": "WhenEmptyOrUnderutilized · k=∞", "kind": "query" },
    { "id": "OK", "col": 2, "row": 1, "label": "승인", "sub": "score ≥ 1/k = 0.5", "kind": "sink" },
    { "id": "NO", "col": 2, "row": 2, "label": "거부", "sub": "karpenter_consolidation_score에 기록", "kind": "store" }
  ],
  "edges": [
    { "from": "A", "to": "E", "label": "가장 보수적", "rate": 1100, "speed": "slow" },
    { "from": "A", "to": "B", "label": "스코어링", "rate": 520 },
    { "from": "A", "to": "U", "label": "절감 > 0이면 통과", "rate": 380, "speed": "fast" },
    { "from": "E", "to": "OK", "dashed": true },
    { "from": "B", "to": "OK", "label": "score ≥ 0.5", "rate": 640 },
    { "from": "B", "to": "NO", "label": "score < 0.5", "rate": 640 },
    { "from": "U", "to": "OK", "dashed": true }
  ]
}
{{< /flow >}}

스코어는 NodePool 총량으로 정규화한 두 비율의 나눗셈이다(`balanced-consolidation.md:115-125`).

```
savings              = Σ(삭제 노드 가격) − Σ(생성 노드 가격)
disruption_cost      = Σ max(0, EvictionCost(pod))  for 축출되는 모든 파드
score = (savings / nodepool_총비용) / (disruption_cost / nodepool_총_disruption_cost)
승인 조건: score ≥ 1/k
```

`Balanced`는 **k=2 고정**이라 임계값이 `score ≥ 0.5`다. 상수가 코드에 박혀 있다(`karpenter-core/pkg/apis/v1/nodepool.go`의 `BalancedK int32 = 2`, 주석: "the smallest value where within-family replaces pass, with 4-step max churn"). 노드 하나의 disruption cost는 **파드가 없어도 1.0**이고(cordon·drain·API 호출·대체 노드 기동 지연 자체의 비용을 모델링한 자리표시자) 여기에 파드별 `max(0, EvictionCost)`가 더해진다. 파드 EvictionCost는 `pod-deletion-cost` 어노테이션과 priority로 계산되며 기본은 파드당 1.0이므로, **아무 설정도 안 하면 스코어는 사실상 "절감 비율 대 파드 개수 비율"** 비교가 된다.

세 정책은 같은 모델의 서로 다른 k다 — `WhenEmpty`는 "양의 disruption cost를 가진 파드가 하나도 없을 때만", `Balanced`는 k=2, `WhenEmptyOrUnderutilized`는 k=+∞. 부수 효과로 `WhenEmpty`의 정의가 "파드가 0개"에서 "양의 disruption cost 파드가 0개"로 미묘하게 넓어졌다 — `pod-deletion-cost`를 크게 음수로 준 파드만 있는 노드는 이제 빈 노드로 취급된다.

**켜는 법은 한 줄이고 feature gate가 없다.**

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
spec:
  disruption:
    consolidationPolicy: Balanced
    consolidateAfter: 1m
```

`consolidationPolicy`는 kubebuilder enum(`WhenEmpty;WhenEmptyOrUnderutilized;Balanced`)으로 직접 검증되므로 잘못된 값은 admission에서 거부된다. 설계 RFC(`balanced-consolidation.md`)에는 `BalancedConsolidation` feature gate로 옵트인한다고 적혀 있지만 **실제 shipped 구현에는 그 게이트가 없다** — RFC와 구현의 불일치다. 기존 `WhenEmptyOrUnderutilized` NodePool은 이 값을 바꾸지 않는 한 영향이 없다.

관측 수단이 같이 들어왔다. 승인된 액션은 `ConsolidationApproved` 이벤트를 남기고(단일 노드는 Node·NodeClaim에, 다중 노드는 NodePool에) 스코어와 절감·파괴 백분율을 포함한다. 메트릭은 `karpenter_consolidation_score`·`karpenter_consolidation_moves_total`이며 decision·NodePool·policy로 라벨링되는데 **둘 다 stability level ALPHA**라 이름·라벨이 바뀔 수 있다. 판정은 `--log-level debug`에도 남는다.

| 언제 쓰나 | 판정 |
|---|---|
| `WhenEmptyOrUnderutilized`인데 노드 churn·파드 재배치가 잦아 불만이 있다 | **최적** — 이 정책이 정확히 그 문제를 겨냥한다 |
| `WhenEmpty`로 묶어놓고 통합을 사실상 포기한 상태 | **좋음** — 안전하게 통합을 재개하는 중간 단계 |
| 비용 최적화가 최우선이고 churn을 감수 중 | **반쪽** — k=2 임계에서 한계 절감 액션이 거부되어 비용이 조금 올라간다 |
| 통합 정책 전환과 대규모 버전 업그레이드를 같은 창에 | **부적합** — 노드 교체 원인이 섞여 사후 분석이 불가능해진다 |

파드 중요도를 스코어에 반영하려면 `pod-deletion-cost`를 붙인다. 값이 클수록 그 파드를 축출하는 액션의 스코어가 낮아져 노드가 살아남는다. 단 스코어는 NodePool 총량 대비 비율이라 **한 풀 안에서만 상대적**이다(cross-NodePool 이동은 source 풀의 정책·예산이 각각 독립적으로 승인해야 한다).

### 7.3 DRA와 preview instance types

**DRA**는 1.7에서 "ResourceClaim을 요구하는 파드는 명시적으로 무시"였다가(core#2384) 1.14에서 실제 스케줄링 지원으로 왔다 — allocator 통합([core#3113](https://github.com/kubernetes-sigs/karpenter/pull/3113)), consumable capacity + partitionable devices([core#3110](https://github.com/kubernetes-sigs/karpenter/pull/3110)), device allocation tracking(1.13의 core#3014), pod-level ResourceClaim 감지(core#3124). 업그레이드 가이드는 **additive이며 기존 NodePool 설정 변경이 필요 없다**고 명시한다. 관련 플래그 `IGNORE_DRA_REQUESTS`는 기본값이 여전히 `true`고 "DRA가 GA되면 제거될 플래그"라는 주석이 붙어 있다(`options.go`). GPU를 DRA로 나누는 구성이 없으면 조치 불필요다.

**preview instance types**([aws#9249](https://github.com/aws/karpenter-provider-aws/pull/9249))는 AWS Pricing API에 가격이 없는 pre-GA 인스턴스 타입을 쓸 수 있게 한다. 가격이 없으면 Karpenter가 offering을 unavailable로 표시해 프로비저닝하지 않는데, `NodeOverlay`(`karpenter.sh/v1alpha1`)로 명시 가격을 주면 후보에 들어온다. 조건이 까다롭다 — `NodeOverlay` 게이트가 켜져 있어야 하고, 계정이 해당 타입에 allowlist돼야 하며, 오버레이가 `node.kubernetes.io/instance-type` `In` 요구사항 **하나만** 갖고(capacity-type·zone·CPU 추가 금지) `priceAdjustment`가 아닌 절대 `price`를 써야 하고 `ValidationSucceeded=True`여야 한다. 이 모양을 벗어나면 preview 가격 용도로 **무시**된다. 그리고 **가격 스코핑이 안 된다** — preview 가격은 전역이라 조건이 맞는 모든 NodePool이 그 타입에 스케줄될 수 있고, 추정 가격이 consolidation과 spot/on-demand 판단에 그대로 들어간다. 가격 캐시는 5분이다.

## 8. 도입 우선순위 — 우리 기준

전제: EKS, ArgoCD 배포, Karpenter 컨트롤러는 Fargate profile, blue-green으로 **1.14.0 직행**(기존 flex 노드·기존 NodeClaim 없음), k8s 1.33. 절차는 [eks-upgrade/karpenter]({{< relref "../eks-upgrade/components/01-karpenter.md" >}}) 소유.

| 기능 | 비용(설정 난이도·리스크) | 효과 | 판정 |
|---|---|---|---|
| **flex 배제** `In ["false"]` | requirement 한 줄. 신규 클러스터라 drift 교체 없음 | 지속 고CPU·저지연 워크로드가 버스트 인스턴스에 앉는 사고를 원천 차단 | **지금** |
| **IAM 3종** `ListInstanceProfiles`·`DescribeInstanceStatus`(+ 쓰면 `DescribePlacementGroups`) | 정책 문서 수정. 리스크 없음 | 없으면 instance profile 관리 실패, unhealthy 인스턴스 방치 | **지금** |
| **메트릭 쿼리 수정** (`pods_drained_total`, reason `registration_timeout`) | Grafana·알람 룰 grep 후 치환 | 안 하면 **경보가 조용히 안 온다**. 가장 발견이 늦는 종류 | **지금** |
| **drift disruption budget** (`reasons: ["Drifted"]`) | NodePool yaml. 값 결정만 필요 | v1은 drift 비활성화 불가 + AMI 갱신·해시 변경이 대량 교체를 유발 | **지금** |
| **do-not-disrupt grace period** · **`limits.nodes`** | 어노테이션·NodePool 각 한 줄 | 웜업 보호를 "떼는 걸 잊을 수 없는" 형태로. 노드 개수 기준 폭주 상한 | **지금** |
| **Balanced consolidation** | NodePool 한 줄, feature gate 없음. 통합 거동이 바뀌어 관찰 필요. 메트릭 2종은 ALPHA | 한계 절감 통합으로 인한 churn 감소 | **다음 분기** — 0.36→1.14 직후에 통합 정책까지 바꾸면 노드 교체 원인이 섞인다 |
| **ARC Zonal Shift** | EKS 클러스터 온보딩 + IAM 1종. 권한 없으면 조용히 미동작 | 장애 AZ로 신규 노드가 안 간다 | **다음 분기** — AZ 장애 대응 설계와 함께 |
| **AMI·subnet refresh interval** | 설정값 2개 | 대규모에서 EC2 API 호출량 감소. 지금 규모엔 이득 없음 | **다음 분기**(호출량 문제가 관측되면) |
| **Static NodePool** | alpha 게이트 + **static↔dynamic 전환 불가** + CRD | 기준 용량 상시 유지, 약정 소진 | **보류** — warm capacity 목적이면 Capacity Buffers가 상위 호환. 전환 불가 리스크가 크다 |
| **Capacity Buffers** | alpha 게이트 + 신규 CRD + RBAC + **업스트림 문서가 낡음** | headroom을 pause pod 없이. 스파이크 대응 지연 단축 | **보류** — 원하는 그림이지만 게이트가 alpha고 문서가 코드를 못 따라왔다. 스테이징 관찰부터 |
| **NodeOverlay + preview instance types** | alpha 게이트, 가격 추정이 전역 적용 | Savings Plan 반영, 신규 타입 조기 사용 | **보류** — 필요가 아직 없다 |
| **Placement Group** · **DRA** · **interruptible ODCR** | 각각 IAM 2곳 / 조치 불필요 / EventBridge 규칙 수정 | HPC 배치 / GPU 분할 / ODCR 인터럽션 경고 | **보류** — 해당 워크로드가 없다. 도입 시 각 절의 조치를 같이 |

**직행 경로에서 자동으로 회피되는 항목**: 1.8.4 TSC 회귀, 1.11.0 CPU 사용량 회귀, 1.12 CA bundle drift의 전 노드 교체, 그리고 §2.5의 flex 배제 drift. 넷 다 "기존 클러스터를 그 버전으로 통과시킬 때" 문제이므로 blue-green 신규 설치에는 해당하지 않는다. **1.9의 IAM 정책 5분할**도 우리가 cloudformation 템플릿의 정책 ARN을 attach하지 않고 IRSA 롤에 정책을 직접 구성하므로 무해하다.

## 9. IAM 권한 누적 — 무엇을 안 주면 무슨 일이 나나

| 버전 | 추가/변경 | 누락 시 증상 |
|---|---|---|
| 1.7 | `iam:ListInstanceProfiles` (cloudformation `AllowUnscopedInstanceProfileListAction`) | 신규 경로(`/karpenter/{region}/{cluster}/{nodeclass-uid}/`)의 instance profile 조회·관리 실패 |
| 1.7 | `iam:GetRole` **제거** | 조치 불필요(권한 축소 방향). 이미 붙어 있어도 무해 |
| 1.9 | 관리형 정책 5분할 — 권한 값 무변경 | 템플릿의 정책 ARN을 롤에 attach하는 구성이면 5개 전부 붙여야 한다. 하나 빠지면 그 경계의 기능이 실패 |
| 1.10 | (IAM 아님) EventBridge 규칙에 capacity reservation interruption `detail-type` | interruptible ODCR 사용 시 인터럽션 경고 미수신 → 강제 종료 전 drain 기회 상실 |
| 1.11 | `ec2:DescribePlacementGroups`(`AllowRegionalReadActions`) + `...:placement-group/*`(`AllowScopedEC2InstanceAccessActions`) | placement group을 지정한 EC2NodeClass의 검증·기동 실패. 미사용이면 무관 |
| 1.12 | `ec2:DescribeInstanceStatus` — **필수** | 인터럽션 컨트롤러가 EC2 상태 검사 실패를 감지 못한다. unhealthy 인스턴스가 drain 없이 방치됨 |
| 1.12 | `arc-zonal-shift:GetManagedResource` — 옵트인(`AllowZonalShiftActions`, 대상 클러스터 ARN 스코핑) | 에러 없이 **조용히 미동작**. Zonal Shift가 켜진 줄 알고 안 켜져 있는 상태가 된다 |
| 1.13 / 1.14 | 없음 | Capacity Buffers는 IAM이 아니라 **k8s RBAC**(`capacitybuffers`, `podtemplates`)이 필요하다 |

## 10. 근거

아래 경로에서 `.../docs/`는 `karpenter-provider-aws/website/content/en/docs/`, 그 외 상대 경로는 `karpenter-core/` 또는 `karpenter-provider-aws/` 레포 루트 기준이다.

| 무엇 | 출처 |
|---|---|
| 버전별 기능·PR 번호·회귀 경고 | 두 레포 v1.7.0~v1.14.0 릴리스노트. 릴리스일은 로컬 클론의 `git tag` 생성일 |
| breaking·필요 조치·IAM | `.../docs/upgrading/upgrade-guide.md`(1.7~1.14 각 절), `.../docs/reference/cloudformation.md`, `.../docs/upgrading/compatibility.md`(k8s 매트릭스) |
| flex 라벨 키·값 판정·패밀리 목록 | `karpenter-provider-aws/pkg/apis/v1/labels.go:41,151`, `pkg/providers/instancetype/types.go:204,261-265`, `.../docs/reference/instance-types.md` |
| 라벨이 노드에 붙는 경로 | `karpenter-provider-aws/pkg/cloudprovider/cloudprovider.go:420-437`(`req.Len() == 1` 승격), `:471-488`(placement group 라벨) |
| 연산자 교집합 semantics | `karpenter-core/pkg/scheduling/requirement.go:220-253`(`HasIntersection`), `:290-301`(`Operator()`) |
| 값 오타가 검증을 통과하는 이유 | `karpenter-core/pkg/apis/v1/labels.go:95-104`(`WellKnownValuesForRequirements`), `pkg/apis/v1/nodeclaim_validation.go:167-178` |
| drift 판정 · launch timeout | `karpenter-core/pkg/controllers/nodeclaim/disruption/drift.go:170-180`, `.../lifecycle/liveness.go:51-59` |
| Static NodePool 제약 | `karpenter-core/designs/static-capacity.md:4-60`, `.../docs/concepts/nodepools.md`의 `spec.replicas` 절 |
| disruption budget · do-not-disrupt duration | `karpenter-core/pkg/apis/v1/nodepool.go`(`Budget`, `DisruptionReason` enum), `.../docs/concepts/disruption.md` |
| Zonal Shift 동작 범위 | `.../docs/concepts/scheduling.md`의 Zonal Shift 절 |
| Capacity Buffers 스펙·API 버전 | `.../docs/concepts/capacitybuffers.md`(v1alpha1로 낡음), `karpenter-core/pkg/apis/autoscaling/v1beta1/capacitybuffer.go`, `pkg/apis/crds/autoscaling.x-k8s.io_capacitybuffers.yaml:50` |
| Balanced consolidation 스코어·k=2 | `karpenter-core/designs/balanced-consolidation.md:60-125`, `pkg/apis/v1/nodepool.go`(`BalancedK`, enum), `.../docs/concepts/disruption.md`의 정책 표 |
| 메트릭·feature gate 기본값 | `.../docs/reference/metrics.md`, `.../docs/reference/settings.md`, `karpenter-core/pkg/operator/options/options.go`의 `--feature-gates` 기본 문자열 |
| preview instance type 오버레이 모양 | `.../docs/concepts/nodeoverlays.md`의 "NodeOverlays and Preview Instance Types" 절 |
