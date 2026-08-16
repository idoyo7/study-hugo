---
title: "1.7 → 1.14 — 운영에 쓸 기능들"
weight: 2
---

# 02 · 1.7 → 1.14 — 지금 켤 만한 것과 미룰 것

{{< callout type="info" >}}
**한눈에**
- 1.7 이후 8개 마이너에서 API breaking은 사실상 없다. 대신 **켜야 비로소 쓸 수 있는 기능**이 라벨·feature gate·신규 CRD·IAM 네 층으로 쌓였다.
- **flex 배제는 라벨 한 줄이다** — `karpenter.k8s.aws/instance-capability-flex`를 `In ["false"]`로. 단 `DoesNotExist`로 쓰면 **모든 인스턴스 타입이 배제되어 노드가 하나도 안 뜬다**(§2.2).
- **기존** NodePool에 배제를 추가하면 떠 있는 flex 노드가 전부 `RequirementsDrifted`로 교체된다. "다음부터"가 아니라 "지금 있는 걸 몰아낸다"다.
- **알람이 조용히 깨진 곳이 둘**(1.7): `karpenter_pods_pods_drained_total` → `karpenter_pods_drained_total`, `disrupted_total`의 reason `liveness` → `registration_timeout`(§3).
- **업그레이드 자체가 노드를 교체하는 버전이 있다** — 1.12는 CA bundle이 drift 해시에 들어가면서 전 노드를 일괄 drifted로 만든다(§6.1). **1.8.4는 건너뛴다**(TopologySpreadConstraint(TSC) 회귀, 업스트림이 업그레이드 금지 명시).
- **1.14 Balanced consolidation은 게이트가 없다** — `consolidationPolicy: Balanced` 한 줄(§7.2). 반면 **Capacity Buffers는 alpha 게이트 + 신규 CRD**이고 업스트림 문서가 코드보다 낡았다(§7.1).
- **IAM은 세 번 늘었다** — 1.7 `iam:ListInstanceProfiles`, 1.11 `ec2:DescribePlacementGroups`, 1.12 `ec2:DescribeInstanceStatus`(§9).
- 우리 기준(blue-green으로 0.36.2 → 1.14.0 직행) 판정은 §8.
{{< /callout >}}

> **왜 이 문서인가.** 릴리스노트는 "무엇이 머지됐냐"까지만 말한다. 필요한 구분은 셋 — ① 켜면 이득인 것, ② 설정·권한·CRD를 건드릴 것, ③ **업그레이드 자체가 노드를 교체하는 것**. 이 문서는 그 셋으로 1.7~1.14를 갈라 판정합니다.
>
> v1 전환 자체의 semantics는 [01 v1 전환]({{< relref "01-changelog-v1-transition.md" >}})이, 라벨·연산자 레퍼런스는 [03 키워드 레퍼런스]({{< relref "03-keyword-reference.md" >}})가, 차트·values·ArgoCD 절차는 [eks-upgrade/karpenter]({{< relref "../eks-upgrade/components/01-karpenter.md" >}})가 소유한다.

> 근거 기준: 릴리스노트는 두 레포의 **v1.14.0까지**, 코드 인용은 **2026-07-30 기준 main 체크아웃**입니다. 릴리스일은 git 태그 생성일입니다.

## 1. 타임라인 — 무엇이 언제 들어왔나

각 버전은 "무엇이 머지됐나"가 아니라 **"어떤 상황에서 켤 것을 주는가"**로 읽습니다. 그래야 필요 없는 버전을 건너뛸 수 있습니다.

| 버전 | 언제 쓰나 (조건) | 무엇이 가능해졌나 | 대가 |
|---|---|---|---|
| **1.7** | flex가 섞이는 게 싫다 | 라벨 한 줄로 배제 (§2) | 기존 풀에 넣으면 전량 교체 |
| **1.8** | 기준 용량을 상시 유지한다 | Static NodePool (§4) | alpha · **전환 불가** · 1.8.4 스킵 |
| **1.9** | 선택 아님 | ICE(Insufficient Capacity Error) 필터링 · tenancy 라벨 | IAM 정책 5분할 |
| **1.10** | interruptible ODCR(On-Demand Capacity Reservation)을 쓴다 | 그 위에서 노드를 띄운다 | EventBridge 규칙 추가 |
| **1.11** | HPC·랙 격리가 필요하다 | Placement Group (§5) | IAM 1종 · 1.11.0 CPU 회귀 |
| **1.12** | **선택 아님 — 지나간다** | Zonal Shift · 상태 헬스체크 (§6) | **전 노드 일괄 drift** |
| **1.13** | 서브넷 IP가 마른다 | ICE를 subnet 단위로 | 없음 |
| **1.14** | churn이 과해 불만이다 | `Balanced` 한 줄 (§7.2) | 통합 거동이 바뀐다 |
| **1.14** | headroom을 자동화한다 | Capacity Buffers (§7.1) | alpha · 신규 CRD · 문서 낡음 |

**"선택 아님" 두 줄이 이 표의 핵심입니다.** 1.9와 1.12는 켤 기능이 아니라 **지나가면 맞는 것**입니다. 그중 1.12는 대가가 전 노드 교체입니다. 나머지는 필요 없으면 그냥 통과해도 됩니다.

릴리스일(core/aws순): 1.7 2025-09-12/15, 1.8 2025-10-02/08, 1.9 2026-02-04/06, 1.10 2026-03-17/20, 1.11 2026-04-04/06, 1.12 2026-04-25/24, 1.13 2026-06-10, 1.14 2026-07-10. 표에 없는 동반 기능은 각 절에서 다룹니다. **1.8.4·1.11.0에는 회귀 경고**가 있습니다(§4.3).

k8s 호환 하한도 올라갔습니다 — 1.14는 k8s 1.30~1.36 커버, **1.36엔 최소 1.13**, 1.35는 1.9, 1.33은 1.5가 하한입니다.

## 2. flex 인스턴스를 한 줄로 배제한다 (1.7)

### 2.1 라벨의 정체 — EC2가 주는 필드가 아니라 문자열 패턴이다

1.7에서 `karpenter.k8s.aws/instance-capability-flex`가 well-known 라벨로 추가됐다([aws#8315](https://github.com/aws/karpenter-provider-aws/pull/8315)→[aws#8490](https://github.com/aws/karpenter-provider-aws/pull/8490)에서 `capacity`→`capability`로 개명). **GA 시점 이름은 처음부터 `capability`**입니다.

값을 정하는 코드는 세 줄입니다(`pkg/providers/instancetype/types.go:261-265`):

```go
if strings.Contains(instanceTypeParts[0], "-flex") {
    requirements[v1.LabelInstanceCapabilityFlex].Insert("true")
} else {
    requirements[v1.LabelInstanceCapabilityFlex].Insert("false")
}
```

`instanceTypeParts[0]`(패밀리)에 **`-flex`가 들어 있는지만** 봅니다 — EC2 필드가 아닌 문자열 패턴입니다. flex 패밀리는 `c7i-flex`·`m7i-flex` 등 1.14 시점 다섯입니다.

`types.go:204`의 `NewRequirement(..., NodeSelectorOpDoesNotExist)`는 빈 placeholder일 뿐이고, 위 분기가 무조건 값을 하나 넣으므로 **모든 인스턴스 타입에 예외 없이 `In ["true"]` 또는 `In ["false"]`가 붙습니다**(`requirement.go:290-301`).

라벨은 노드에도 붙습니다 — AWS 프로바이더가 **값이 하나뿐인 requirement를 NodeClaim 라벨로 승격**시키므로(`cloudprovider.go:420-437`, `req.Len() == 1`), `kubectl get nodes -L karpenter.k8s.aws/instance-capability-flex`로 지금 클러스터의 flex 노드를 바로 셉니다.

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
| `In` / `["false"]` | 의도대로 flex만 배제 | **최적** |
| `NotIn` / `["true"]` | 위와 **완전히 동치** | **좋음** — 의미가 한 겹 꼬인다 |
| `DoesNotExist` | **모든 타입이 배제된다** | **부적합** — 절대 금지 |

`NotIn`이 동치인 이유는 라벨 값 공간이 `{true, false}` 둘뿐이라 제3의 값이 나올 수 없어서입니다. `DoesNotExist`가 전멸인 이유는 교집합 판정에 있습니다. `Requirement.HasIntersection`(`requirement.go:220-253`)은 양쪽이 non-complement면 값 셋을 순회해 겹침을 찾습니다. `DoesNotExist`는 **빈 집합**인 non-complement라 루프가 한 번도 돌지 않고 `false`가 나옵니다. 인스턴스 타입 쪽은 값이 하나 있으니 **flex 여부와 무관하게 교집합 없음**입니다. `NotIn`은 complement라 다른 분기를 타고 정상 동작합니다.

`In`도 함정이 남습니다 — **값 오타는 admission에서 안 걸립니다.** well-known 라벨 값 검증(`nodeclaim_validation.go:167-178`)은 `WellKnownValuesForRequirements`에 등록된 키(`capacity-type`·`instance-tenancy`뿐)만 동작합니다. `["False"]`나 `["no"]`를 써도 NodePool은 `Ready`가 되고 증상은 **파드가 안 뜨는 것**뿐입니다. NodePool 상태가 아니라 **pending 파드 이벤트**를 먼저 봅니다([core#2341](https://github.com/kubernetes-sigs/karpenter/pull/2341)이 메시지를 개선했습니다).

### 2.3 왜 배제하나 — 베이스라인이 보장되지 않는다

`-flex` 패밀리는 저렴한 대가로 성능 모델이 **베이스라인 + 버스트**입니다. 지속적으로 vCPU를 밀어 쓰면 버스트 여력이 소진된 뒤 베이스라인으로 떨어집니다.

| 워크로드 | flex에서 무슨 일이 나나 | 판정 |
|---|---|---|
| 지속 고CPU(스트림·컴파일·배치) | 소진 후 처리량이 계단식으로 하락 | **부적합** |
| p99 민감한 온라인 API | 스로틀 시점이 비결정적 → 꼬리 지연 | **부적합** |
| istiod·ingress gateway | 스파이크와 소진이 겹치면 복구 지연 | **부적합** |
| 이벤트 워커·cron·개발/스테이징 | 평균 사용률이 낮아 가격 이점만 먹는다 | **최적** |

첫 줄이 고약합니다 — 노드마다 소진 시점이 달라 **같은 Deployment 파드 성능이 갈립니다.** 배제는 **"flex 선택을 가격 우선 스케줄러에 맡기지 않겠다"**는 선택입니다.

*베이스라인·버스트 동작은 AWS EC2 문서의 일반 서술을 근거로 합니다. 코드로 검증한 것은 라벨 판정과 스케줄링 배제 동작뿐입니다.*

### 2.4 배제보다 나은 선택 — 전용 NodePool로 격리

flex를 전량 지우면 사용률 낮은 워크로드의 비용 이점도 같이 버립니다. NodePool을 둘로 갈라 flex를 **taint로 격리**하면 둘 다 챙깁니다.

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

flex를 쓰려는 워크로드만 `tolerations`에 `capability=flex:NoSchedule`을 적습니다. 기본은 안전, opt-in으로 절감 — "버스트로 충분하다"는 판단이 매니페스트에 남습니다. **전량 배제는 flex 후보가 아예 없을 때만** 합리적입니다.

### 2.5 기존 NodePool에 적용하면 노드가 교체되는가 — 교체된다

drift 판정 코드가 근거입니다(`drift.go:170-180`):

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

비교 대상은 **NodeClaim의 현재 라벨**과 **NodePool의 현재 requirements**입니다. flex 노드는 이미 `flex=true`가 박혀 있어, requirement가 `In ["false"]`로 바뀌는 순간 호환 실패 → `RequirementsDrifted`입니다. v1은 drift 비활성화가 불가능해 끌 수도 없습니다.

결과는 **떠 있던 flex 노드 전량의 순차 교체**입니다 — `kubectl get nodeclaims`에서 flex였던 노드에만 `Drifted=True`가 몰려 붙고 `RequirementsDrifted` 이벤트가 그 시각에 집중됩니다. 순서는 ① `kubectl get nodes -L ...instance-capability-flex`로 규모 파악 → ② 크면 `reasons: ["Drifted"]` 예산을 먼저 좁게(§6.1) → ③ 한 NodePool씩, 큰 풀은 업무시간 외에. blue-green으로 신규 클러스터를 세우면 기존 flex 노드가 없으므로 무해합니다.

## 3. 1.7의 나머지 — 알람이 조용히 깨진다

1.7의 잔여 변경 중 **실제 조치가 필요한 것은 둘**입니다. 둘 다 core 릴리스노트에만 BREAKING으로 적혀 있습니다.

**메트릭 리네임 2건.** `karpenter_pods_pods_drained_total`→`karpenter_pods_drained_total`([core#2421](https://github.com/kubernetes-sigs/karpenter/pull/2421)), `disrupted_total`의 reason `liveness`→`registration_timeout`([core#2349](https://github.com/kubernetes-sigs/karpenter/pull/2349)). 옛 이름 쿼리는 **에러 아닌 빈 결과**를 냅니다 — 대시보드는 0, 알람은 영원히 안 옵니다. 업그레이드 **전에** Grafana·Prometheus 룰을 치환합니다.

**NodeClaim launch timeout 5분 신설.** `registrationTimeout = 15m`뿐이던 자리에 `LaunchTimeout = 5m`이 추가됐습니다(core#2349, `pkg/controllers/nodeclaim/lifecycle/liveness.go:51-59`) — 5분 안에 launch가 안 끝나면 재생성합니다. 재시도 주기가 15분→5분으로 짧아지고 이벤트 볼륨이 늘 수 있습니다. AWS upgrade-guide 1.7 절엔 이 항목이 없습니다.

나머지 여섯은 알고만 있으면 됩니다.

| 항목 | 조치 |
|---|---|
| Instance profile path가 `/karpenter/{region}/{cluster}/{uid}/`로 | **IAM `iam:ListInstanceProfiles` 추가** |
| `iam:GetRole` 의존성 제거 ([aws#8419](https://github.com/aws/karpenter-provider-aws/pull/8419)) | 불필요 — 권한이 줄어든 드문 사례 |
| NodeOverlay AWS 지원 ([aws#8305](https://github.com/aws/karpenter-provider-aws/pull/8305)) | `NodeOverlay=false` alpha 게이트 (§7.3) |
| EC2NodeClass `spec.role` mutable화 ([aws#8249](https://github.com/aws/karpenter-provider-aws/pull/8249)) | 불필요 — 롤 교체 시 재생성이 없어졌다 |
| 검증 dry-run 비활성화 ([aws#8350](https://github.com/aws/karpenter-provider-aws/pull/8350)) | SCP에 막힐 때만 `DISABLE_DRY_RUN=true` |
| DRA `ResourceClaim` 파드를 알고 무시 ([core#2384](https://github.com/kubernetes-sigs/karpenter/pull/2384)) | 불필요 — 1.14에서 실제 지원 (§7.3) |
| capacity block 만료를 offering에 반영 ([aws#8362](https://github.com/aws/karpenter-provider-aws/pull/8362)) | 불필요 — 무의미한 launch 실패 감소 |

## 4. 1.8 — Static NodePool, 그리고 1.8.4를 건너뛰는 이유

### 4.1 dynamic과 무엇이 다른가

`spec.replicas`가 존재하면 그 NodePool은 **static**이 됩니다([core#2521](https://github.com/kubernetes-sigs/karpenter/pull/2521), `designs/static-capacity.md`) — 파드 수요와 무관하게 고정 노드 수를 유지합니다.

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

`kubectl scale nodepool baseline --replicas=10`으로 조절하고 현재 수는 `status.nodes`에 나옵니다.

| 항목 | dynamic | static |
|---|---|---|
| 노드 수 | pending 파드 수요 | `spec.replicas` 고정 |
| consolidation | 대상 | **제외**. 정책 필드는 무시 |
| `limits` | cpu/memory/pods 자유 | **`nodes`만** 허용 |
| `weight` | 사용 가능 | **금지**(검증 에러) |
| 스케일 조작 | — | 노드 예산 우회, PDB(PodDisruptionBudget)는 존중 |
| 모드 전환 | — | **불가**(NodePool 삭제만) |

마지막 줄이 도입 리스크 전부입니다 — `replicas`를 잘못 붙이면 되돌릴 방법이 NodePool 삭제, 즉 노드 전량 교체뿐입니다.

### 4.2 어디에 쓰나

설계 동기는 JIT 프로비저닝 지연을 못 견디는 성능 민감 워크로드입니다(`static-capacity.md:4-9`); 기존 우회책은 pause pod였습니다.

| 목적 | static | 대안 |
|---|---|---|
| 기준 용량 상시 유지 | **좋음** — 이걸 위해 만들어졌다 | pause pod, Capacity Buffers |
| 스파이크 대비 warm 노드 | **반쪽** — 수요에 비례하지 않는다 | **Capacity Buffers**(§7.1) |
| 예약 인스턴스·SP 소진 | **좋음** — 고정 수 × 고정 타입 | — |
| 노드 수 예산 상한 | **부적합** | dynamic + `limits.nodes` |

마지막 줄은 1.11부터 일반 NodePool도 `limits.nodes`를 쓸 수 있게 되면서([core#2526](https://github.com/kubernetes-sigs/karpenter/pull/2526)) static의 이유가 아니게 됐습니다.

**CRD 업그레이드 필수** — `replicas`·`limits.nodes`·`status.nodes`가 스키마에 추가돼, `karpenter-crd`를 별도 관리하면 컨트롤러와 함께 올려야 합니다. feature gate는 `StaticCapacity=false`(alpha).

### 4.3 1.8.4를 건너뛴다

업스트림 가이드가 직접 적었습니다 — *"Karpenter `v1.8.4` release contains a regression which may prevent Karpenter from scheduling pods with specific TopologySpreadConstraint configurations. Please do not upgrade to this version."*([karpenter#2785](https://github.com/kubernetes-sigs/karpenter/issues/2785)). TSC `nodeAffinityPolicy: Honor` 수정(core#2639)이 머지된 뒤 1.9에서 리버트(core#2797)됐습니다. 1.8 계열에 머물러야 한다면 1.8.4 이후 patch로 갑니다.

같은 성격의 경고가 하나 더 있습니다 — **1.11.0 릴리스노트 상단**에 CPU 사용량 회귀 경고가 박혀 있습니다([karpenter#2954](https://github.com/kubernetes-sigs/karpenter/issues/2954)). 1.11에 머물면 컨트롤러 CPU requests를 넉넉히, 1.12+로 지나가면 해당 없습니다.

## 5. 1.9 ~ 1.11 — 권한과 배치

**IAM 정책 5분할(1.9).** cloudformation 관리형 정책이 하나에서 다섯으로 쪼개졌습니다(aws#7874) — **권한 값은 1.8과 동일**, 이름·경계만 바뀌었습니다(1.12에서 Zonal Shift용이 여섯 번째로 붙습니다). IRSA 인라인 정책이면 무해합니다. 템플릿 ARN attach 방식이면 5개를 모두 붙여야 합니다 — 하나 빠지면 그 경계 기능이 조용히 실패합니다.

**Capacity Reservation 인터럽션(1.10).** interruptible ODCR에서 노드를 띄울 수 있습니다([aws#9019](https://github.com/aws/karpenter-provider-aws/pull/9019)) — 짝으로 **EventBridge 규칙에 capacity reservation instance interruption `detail-type` 추가**가 필요합니다(규칙 변경, IAM 아님). 누락하면 경고를 못 받아 **강제 종료 전 drain 기회를 놓칩니다**. spot 인터럽션과 같은 실패 모드입니다.

**Placement Group(1.11).** EC2 Placement Group을 EC2NodeClass에서 선택할 수 있습니다([aws#9030](https://github.com/aws/karpenter-provider-aws/pull/9030)). 노드에 `.../placement-group-id`(partition이면 `.../placement-group-partition`)가 붙습니다(`cloudprovider.go:471-488`). 전략은 EC2 그대로 cluster(저지연·고대역, HPC·MPI)·spread(하드웨어 분산)·partition(랙 격리, Kafka류) 셋. IAM 두 곳 추가: `AllowRegionalReadActions`의 `ec2:DescribePlacementGroups`, `AllowScopedEC2InstanceAccessActions`의 `...:placement-group/*`. **쓰는 클러스터만** 갱신하면 됩니다. 안 주면 해당 EC2NodeClass 검증·기동이 실패합니다.

같은 버전의 나머지: NodeClass 설정값 필터링(aws#9017), 네트워크 인터페이스 구성(aws#9027).

## 6. 1.12 — 업그레이드 자체가 노드를 교체한다

### 6.1 CA bundle drift

[aws#9083](https://github.com/aws/karpenter-provider-aws/pull/9083)이 CA 번들을 drift 해시 계산에 포함시켰습니다. 업스트림 가이드 표현이 정확합니다 — *"The updated hashing logic will mark existing nodes as drifted."*

메커니즘은 단순합니다. Karpenter는 EC2NodeClass·NodePool의 정적 설정을 해시해 NodeClaim에 annotation으로 박아두고, 해시가 달라지면 drift로 봅니다. CA 번들이 해시 입력에 **처음 들어가는 순간** 기존 모든 NodeClaim의 저장된 해시가 새 계산식과 어긋나 **전 노드가 일괄 drifted**됩니다 — 번들 내용이 아니라 해시 정의가 바뀐 것이라, 교체가 실제로 필요한 노드는 하나도 없는데 전량이 대기줄에 섭니다.

증상은 뚜렷합니다 — 설정을 하나도 안 건드렸는데 `kubectl get nodeclaims`에 `Drifted=True`가 한꺼번에 뜨고 disruption 이벤트가 몰립니다. `karpenter_nodeclaims_disrupted_total{reason="drifted"}`가 업그레이드 직후 계단식으로 뛰면 이 케이스입니다.

v1에서 drift는 GA로 승격돼 **비활성화가 불가능**합니다. 방어는 disruption budget 하나뿐이고 **업그레이드 전에** 넣어야 합니다.

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

**네 가지를 알아야 합니다.** `budgets` 지정 시 기본값 `nodes: 10%`가 사라지므로 ①이 필요합니다. 여럿이 겹치면 **가장 제한적인 값이 이깁니다** — 업무시간엔 ②③ 합산으로 0대. `reasons`는 `Underutilized`·`Empty`·`Drifted` 셋, `duration`은 시간·분만 받습니다.

가장 자주 물리는 게 네 번째입니다 — **`reasons` 생략 예산은 모든 이유에 적용됩니다.** 피크 차단용 `nodes: "0"` + `schedule`에 `reasons`를 빼면 교체형 통합뿐 아니라 **빈 노드 정리까지 멈춥니다**. 증상은 이벤트에 찍힙니다.

```
DisruptionBlocked  No allowed disruptions for disruption reason Empty due to blocking budget
```

빈 노드 삭제는 옮길 파드가 없어 피크에도 안전합니다 — 차단 예산엔 `reasons: ["Underutilized", "Drifted"]`로 `Empty`를 남겨두는 편이 거의 항상 맞습니다.

```yaml
      - nodes: "0"
        reasons: ["Underutilized", "Drifted"]   # Empty는 계속 돈다
        schedule: "0 1 * * *"
        duration: 4h
```

`nodes: "0"`을 무기한 두면 안 됩니다 — **정상 drift(AMI 갱신 등)도 막히고**, 예산을 푸는 순간 쌓인 drift가 한꺼번에 터집니다. 업그레이드 직후 며칠만 좁게 잡고 단계적으로 풉니다.

### 6.2 ARC Zonal Shift (옵트인)

AWS Application Recovery Controller의 Zonal Shift를 Karpenter가 인지합니다([aws#9042](https://github.com/aws/karpenter-provider-aws/pull/9042)). Zonal Shift는 AZ 장애 시 그 AZ를 cordon하고 엔드포인트를 빼는 EKS 기능입니다. **Karpenter는 활성 동안 그 AZ에 신규 노드를 안 띄우는 것 하나만** 합니다 — cordon·엔드포인트 제거는 EKS/ARC 몫입니다.

전제 둘: EKS Zonal Shift 활성화, 컨트롤러의 `arc-zonal-shift:GetManagedResource`(`AllowZonalShiftActions`, 클러스터 ARN 스코핑). 권한 없으면 **에러 없이 그냥 미동작**이라 켠 줄 알고 안 켜진 상태가 됩니다.

### 6.3 헬스체크와 do-not-disrupt grace period

**인터럽션 컨트롤러가 `ec2:DescribeInstanceStatus`를 봅니다**([aws#9064](https://github.com/aws/karpenter-provider-aws/pull/9064)) — 지금까지 인터럽션 소스는 SQS EventBridge 이벤트뿐이라 EC2 상태 검사 실패는 감지 밖이었습니다. 이제 상태 검사 실패 인스턴스도 인터럽션으로 처리합니다. **이 권한은 필수**입니다 — 안 주면 하드웨어 문제로 unhealthy가 된 인스턴스가 drain 없이 방치됩니다.

`karpenter.sh/do-not-disrupt`가 **기간제**를 받습니다([core#2874](https://github.com/kubernetes-sigs/karpenter/pull/2874)) — `"true"`는 영구 보호(기존 동작), `"30m"` 같은 Go duration은 파드가 Running이 된 뒤 그 기간만 보호합니다. 용도는 "웜업 전엔 건드리지 마라"입니다 — 캐시 프리로드, 인덱스 로딩, 배치 잡 초기 구간. 지금까지는 `"true"`를 걸고 **떼는 걸 잊어** 통합에서 영구 제외되는 패턴이 흔했습니다.

## 7. 1.13 ~ 1.14 — headroom·consolidation·DRA

1.13은 breaking 없는 운영 개선 묶음입니다. **ICE 캐시가 AZ 단위→subnet 단위로** 내려가([aws#9054](https://github.com/aws/karpenter-provider-aws/pull/9054)) IP 부족 때 AZ 전체를 배제하던 문제를 고쳤습니다. **AMI·subnet refresh interval이 설정 가능**해졌습니다(aws#9149/#9150, 기본·최소 1분 — API 호출량 감소 대가로 발견 지연 감수). 그 외 검증 실패 사유 구체화(aws#9114)·instance profile path(aws#9120)·conntrack(aws#9152)·nested virtualization(aws#9043)도 왔습니다.

1.14가 실제 판단이 필요한 버전입니다.

### 7.1 Capacity Buffers — pause pod 트릭의 정식 대체품

headroom을 만드는 관습적 방법은 낮은 PriorityClass의 pause pod였습니다 — 실제 파드라 실제 자원을 먹습니다. Capacity Buffers는 같은 목적을 **가상 파드**로 달성합니다 — 시뮬레이션 안에만 존재하고 매 프로비저닝 사이클마다 재계산됩니다([core#2898](https://github.com/kubernetes-sigs/karpenter/pull/2898) 설계, [core#3129](https://github.com/kubernetes-sigs/karpenter/pull/3129) v1beta1 승격, AWS 지원 [aws#9276](https://github.com/aws/karpenter-provider-aws/pull/9276)).

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

| 항목 | pause pod | Capacity Buffers |
|---|---|---|
| 자원 점유 | 실제 파드가 실제로 점유 | 가상 — 시뮬레이션에만 존재 |
| 개수 관리 | 수동 | `percentage`로 replicas에 비례 |
| 실 파드 유입 | **선점** 후 재배치 | 다음 사이클에 부족분만 |
| consolidation | "빈 노드"로 보여 진동 | empty 통합이 차단된다 |

마지막 줄이 가장 큽니다 — 버퍼 노드는 `Unconsolidatable`(`"Node has buffer pods"`)로 empty만 빠지고 underutilized·drift·expiry는 허용됩니다. 대체 노드에 버퍼가 다시 들어갑니다.

개수는 `min(max(replicas, percentage), limits)`입니다. 상태는 `ReadyForProvisioning`(개수 계산 성공)과 `Provisioning`(가상 파드가 기존 용량에 들어가는지) 두 컨디션으로 봅니다.

**지금 켜기 어려운 이유 셋.** ① feature gate `CapacityBuffer=false`(alpha). ② **신규 CRD** — `karpenter-crd` 차트와 `capacitybuffers`·`podtemplates` RBAC이 필요합니다. ③ **업스트림 문서가 낡았습니다** — 코드·CRD는 `v1beta1`인데 `concepts/capacitybuffers.md` 예시·게이트 표는 `v1alpha1`입니다. **그대로 복붙하면 없는 API 버전을 적게 됩니다.**

### 7.2 Balanced consolidation — 언제 켤 것인가

기존 두 정책은 양 극단입니다 — `WhenEmpty`는 빈 노드만 지우고 `WhenEmptyOrUnderutilized`는 **규모를 안 묻고 통합**해 "10원 아끼려고 파드 40개를 옮긴다"는 불만을 낳았습니다. `Balanced`([core#2962](https://github.com/kubernetes-sigs/karpenter/pull/2962))는 절감/파괴 비율이 `0.5` 이상일 때만 승인하는 스코어 게이트를 그 사이에 얹습니다(k=2 고정).

**다만 `Balanced`는 모든 통합을 심사하지 않습니다** — 빈 노드 삭제(`Emptiness`)는 정책 무관, 스코어 미적용입니다. 게이트는 **비어있지 않은 노드**에만 걸립니다. 스코어 공식·비용 모델은 [13 consolidation 처리 흐름]({{< relref "13-consolidation-models.md" >}})이 소유합니다.

**켜는 법은 한 줄이고 feature gate가 없습니다.**

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
spec:
  disruption:
    consolidationPolicy: Balanced
    consolidateAfter: 1m
```

`consolidationPolicy`는 kubebuilder enum이라 잘못된 값은 admission에서 거부됩니다. 설계 RFC는 `BalancedConsolidation` 게이트를 명시하지만 **실제 구현엔 없습니다**(RFC-구현 불일치). 기존 NodePool은 값을 안 바꾸면 무영향입니다.

승인 액션은 `ConsolidationApproved` 이벤트에 스코어·절감/파괴 백분율을 남깁니다. 메트릭 `karpenter_consolidation_score`·`karpenter_consolidation_moves_total`은 **둘 다 ALPHA**라 이름·라벨이 바뀔 수 있습니다.

| 상황 | 판정 |
|---|---|
| `WhenEmptyOrUnderutilized`에서 churn 불만 | **최적** — 정확히 그 문제를 겨냥한다 |
| `WhenEmpty`로 통합을 사실상 포기 | **좋음** — 안전한 재개 단계 |
| 비용 최우선, churn 감수 중 | **반쪽** — 한계 절감이 거부된다 |
| 정책 전환 + 대규모 업그레이드 동시 | **부적합** — 원인이 섞인다 |

`pod-deletion-cost`로 파드 중요도를 스코어에 반영할 수 있습니다 — 단 **`Balanced` 풀에서만** 보호로 작동합니다. 같은 풀 다른 노드로 압력이 옮겨가기도 합니다 — [13 §8.2]({{< relref "13-consolidation-models.md" >}}).

### 7.3 DRA와 preview instance types

**DRA**는 1.7 "ResourceClaim 파드 명시적 무시"에서 1.14 실제 스케줄링 지원으로 왔습니다 — allocator 통합([core#3113](https://github.com/kubernetes-sigs/karpenter/pull/3113)), consumable capacity + partitionable devices([core#3110](https://github.com/kubernetes-sigs/karpenter/pull/3110)), pod-level ResourceClaim 감지(core#3124). 가이드는 **additive이며 기존 NodePool 변경 불필요**라 명시하고 `IGNORE_DRA_REQUESTS` 기본값도 여전히 `true`입니다. GPU를 DRA로 나누지 않으면 조치 불필요합니다.

**preview instance types**([aws#9249](https://github.com/aws/karpenter-provider-aws/pull/9249))는 Pricing API에 가격 없는 pre-GA 타입을 쓰게 합니다 — 가격이 없으면 offering이 unavailable인데 `NodeOverlay`로 명시 가격을 주면 후보에 듭니다. 조건이 까다롭습니다 — `NodeOverlay` 게이트 활성화, 계정 allowlist, 오버레이가 `node.kubernetes.io/instance-type` `In` 요구사항 **하나만** 갖고 `priceAdjustment`가 아닌 절대 `price` 사용, `ValidationSucceeded=True`. 벗어나면 **무시**됩니다. **가격 스코핑도 안 됩니다** — preview 가격은 전역이라 조건 맞는 모든 NodePool이 그 타입에 스케줄될 수 있고, 추정 가격이 consolidation·spot/on-demand 판단에 그대로 들어갑니다.

## 8. 도입 우선순위 — 우리 기준

전제: EKS, ArgoCD 배포, 컨트롤러는 Fargate profile, blue-green으로 **1.14.0 직행**(기존 flex 노드·NodeClaim 없음), k8s 1.33. 절차는 [eks-upgrade/karpenter]({{< relref "../eks-upgrade/components/01-karpenter.md" >}}) 소유.

**지금** — 전부 한두 줄 수정이고 리스크가 없습니다.

| 기능 | 왜 지금인가 |
|---|---|
| flex 배제 `In ["false"]` | 고CPU 워크로드가 버스트 노드에 앉는 사고 차단 |
| IAM 3종 (§9) | 없으면 profile 관리 실패·unhealthy 방치 |
| 메트릭 쿼리 수정 (§3) | 안 하면 **경보가 조용히 안 온다** |
| drift disruption budget (§6.1) | v1은 drift 비활성화 불가 |
| do-not-disrupt grace period · `limits.nodes` | 웜업 보호와 노드 수 상한, 각 한 줄 |

**다음 분기** — 동작이 바뀌므로 업그레이드와 창을 분리합니다.

| 기능 | 미루는 이유 |
|---|---|
| Balanced consolidation (§7.2) | 직후에 바꾸면 노드 교체 원인이 섞인다 |
| ARC Zonal Shift (§6.2) | AZ 장애 대응 설계와 함께 온보딩 |
| AMI·subnet refresh interval | 지금 규모엔 이득이 없다 |

**보류** — 게이트가 alpha거나 해당 워크로드가 없습니다.

| 기능 | 막는 것 |
|---|---|
| Static NodePool (§4) | alpha + **static↔dynamic 전환 불가** |
| Capacity Buffers (§7.1) | alpha 게이트 + 신규 CRD + 문서가 낡음 |
| NodeOverlay · preview types (§7.3) | 필요가 아직 없다 |
| Placement Group · DRA · ODCR | 해당 워크로드가 없다 |

**직행 경로에서 자동으로 회피되는 항목**: 1.8.4 TSC 회귀, 1.11.0 CPU 회귀, 1.12 CA bundle drift의 전 노드 교체, §2.5의 flex 배제 drift. 넷 다 "기존 클러스터를 그 버전으로 통과시킬 때" 문제입니다. **1.9의 IAM 정책 5분할**도 IRSA 롤에 정책을 직접 구성하므로 무해합니다.

### 8.1 이미 v1인 클러스터를 in-place로 올릴 때

위 판정은 blue-green 신규 설치 전제입니다 — **기존 1.x 클러스터를 그대로 1.14까지 통과시키면 회피가 하나도 안 먹습니다.** 순서대로 넷을 맞춥니다.

| 구간 | 무엇을 맞나 | 대비 |
|---|---|---|
| → 1.7 | 메트릭 2건이 리네임된다 | **업그레이드 전에** 대시보드·룰 치환(§3) |
| → 1.8 | 1.8.4 TSC 회귀 | 그 patch를 건너뛴다(§4.3) |
| → 1.11 | 1.11.0 CPU 사용량 회귀 | 머물지 않고 1.12+로 지나간다 |
| → 1.12 | **전 노드 일괄 drifted**(CA bundle 해시) | 전에 `reasons: ["Drifted"]` 예산 축소(§6.1) |

넷 중 1.12만 되돌릴 수 없습니다 — v1 drift는 비활성화 불가라, **예산을 먼저 안 넣고 컨트롤러를 올리면 그 순간부터 전 노드가 교체 대기줄에 섭니다.** IAM 3종(§9)도 해당 버전을 지나기 전에 미리 붙여둡니다 — 권한은 먼저 줘도 무해합니다.

## 9. IAM 권한 누적 — 무엇을 안 주면 무슨 일이 나나

| 버전 | 추가·변경 | 누락 시 |
|---|---|---|
| 1.7 | `iam:ListInstanceProfiles` | 신규 경로의 profile 관리 실패 |
| 1.7 | `iam:GetRole` **제거** | 조치 불필요(권한 축소) |
| 1.9 | 관리형 정책 5분할(값 무변경) | ARN attach 방식이면 5개 전부 |
| 1.10 | EventBridge `detail-type`(IAM 아님) | ODCR 인터럽션 경고 미수신 |
| 1.11 | `ec2:DescribePlacementGroups` + `placement-group/*` | PG 지정 EC2NodeClass 기동 실패 |
| 1.12 | `ec2:DescribeInstanceStatus` — **필수** | unhealthy 인스턴스가 drain 없이 방치 |
| 1.12 | `arc-zonal-shift:GetManagedResource` — 옵트인 | 에러 없이 **조용히 미동작** |
| 1.14 | (IAM 아님) RBAC `capacitybuffers`·`podtemplates` | Capacity Buffers 미동작 |

1.11의 두 권한은 각각 `AllowRegionalReadActions`·`AllowScopedEC2InstanceAccessActions`에, 1.12의 Zonal Shift는 `AllowZonalShiftActions`(대상 클러스터 ARN 스코핑)에 들어갑니다.

## 10. 근거

`.../docs/`는 `karpenter-provider-aws/website/content/en/docs/`, 그 외 상대 경로는 `karpenter-core/` 또는 `karpenter-provider-aws/` 레포 루트 기준입니다.

- **버전별 기능·PR 번호·회귀 경고** — 두 레포 v1.7.0~v1.14.0 릴리스노트. 릴리스일은 로컬 클론의 `git tag` 생성일
- **breaking·필요 조치·IAM** — `.../docs/upgrading/upgrade-guide.md`(1.7~1.14 각 절), `.../docs/reference/cloudformation.md`, `.../docs/upgrading/compatibility.md`(k8s 매트릭스)
- **flex 라벨 키·값 판정·패밀리 목록** — `pkg/apis/v1/labels.go:41,151`, `pkg/providers/instancetype/types.go:204,261-265`, `.../docs/reference/instance-types.md`
- **라벨이 노드에 붙는 경로** — `pkg/cloudprovider/cloudprovider.go:420-437`(`req.Len() == 1` 승격), `:471-488`(placement group 라벨)
- **연산자 교집합 semantics** — `karpenter-core/pkg/scheduling/requirement.go:220-253`(`HasIntersection`), `:290-301`(`Operator()`)
- **값 오타가 검증을 통과하는 이유** — `karpenter-core/pkg/apis/v1/labels.go:95-104`, `pkg/apis/v1/nodeclaim_validation.go:167-178`
- **drift 판정 · launch timeout** — `pkg/controllers/nodeclaim/disruption/drift.go:170-180`, `.../lifecycle/liveness.go:51-59`
- **Static NodePool 제약** — `karpenter-core/designs/static-capacity.md:4-60`, `.../docs/concepts/nodepools.md`
- **disruption budget · do-not-disrupt duration** — `pkg/apis/v1/nodepool.go`(`Budget`, `DisruptionReason`), `.../docs/concepts/disruption.md`
- **Zonal Shift 동작 범위** — `.../docs/concepts/scheduling.md`의 Zonal Shift 절
- **Capacity Buffers 스펙·API 버전** — `.../docs/concepts/capacitybuffers.md`(v1alpha1로 낡음), `pkg/apis/autoscaling/v1beta1/capacitybuffer.go`, `pkg/apis/crds/autoscaling.x-k8s.io_capacitybuffers.yaml:50`
- **Balanced consolidation 스코어·k=2** — `karpenter-core/designs/balanced-consolidation.md:60-125`, `pkg/apis/v1/nodepool.go`(`BalancedK`)
- **메트릭·feature gate 기본값** — `.../docs/reference/metrics.md`, `.../docs/reference/settings.md`, `pkg/operator/options/options.go`의 `--feature-gates`
- **preview instance type 오버레이 모양** — `.../docs/concepts/nodeoverlays.md`
