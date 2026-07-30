---
title: "인스턴스는 누가 고르는가"
weight: 4
---

# 04 · 인스턴스는 누가 고르는가 — 후보를 넘기고, EC2가 정한다

{{< callout type="info" >}}
**한눈에**
- **Karpenter 스케줄러는 인스턴스 타입을 확정하지 않는다.** 후보 이름 전체를 `node.kubernetes.io/instance-type In [...]` 하나로 묶어 NodeClaim에 실어 보낸다. 타입을 하나로 못 박는 Cluster Autoscaler와 갈리는 지점이 여기다.
- **최종 선택자는 EC2다.** provider-aws가 CreateFleet을 `Type: instant`, On-Demand 할당 전략 **`lowest-price`** 로 호출한다. "7세대가 싸서 7세대만 뜬다"의 실제 원인은 이 한 줄이다.
- **"후보 절단(600/60) 때문에 8세대가 잘려 나간다"는 흔한 오해이고 사실이 아니다.** 정렬 키가 *그 타입의 최저 오퍼링 가격*이라 **사이즈에 대해 단조**다. 잘리는 건 세대가 아니라 양 세대의 가장 큰 사이즈들이다.
- **단일 NodePool 안에는 선호를 표현할 축이 없다.** `requirements` 스키마는 Key/Operator/Values/MinValues 넷뿐이고, `weight`는 NodePool **레벨**에만 존재한다.
- **`minValues`는 우선순위가 아니라 다양성 하한**이다. 세대 선호에 쓸 수 없을 뿐 아니라, 7세대를 후보에 붙들어 두는 역효과를 낸다.
- **파드의 `preferred` nodeAffinity도 대안이 아니다.** Karpenter는 이걸 "가장 무거운 term 하나를 hard requirement로 승격한 뒤 실패하면 벗기는" 방식으로 처리한다 — 파드마다 걸어야 하고, 완화 순서상 네 번째이며, 벗겨지려면 먼저 스케줄 시뮬레이션이 실패해야 한다.
{{< /callout >}}

> **왜 이 문서인가.** 하나의 NodePool에 c8i/m8i/r8i와 c7i/m7i/r7i를 함께 선언해 두면 "8세대를 쓰다가 없으면 7세대로 내려간다"가 될 것 같지만, 실제로는 항상 7세대만 뜬다. 이유를 "Karpenter가 싼 걸 좋아해서"로 넘기면 대응책을 고를 수 없다 — 절단 때문인지, 필터 때문인지, EC2 때문인지에 따라 손댈 곳이 완전히 달라지기 때문이다. 이 문서는 파드가 pending되는 순간부터 EC2가 인스턴스를 띄우는 순간까지 **선택이 실제로 일어나는 지점을 코드로 하나씩 지운다.** 그리고 흔히 도는 오해 하나(절단이 세대를 자른다)를 명시적으로 깬다.

> 자매 문서: [챕터 개요]({{< relref "_index.md" >}}) · 세대 선호를 실제로 만드는 [05 세대 선호 만들기]({{< relref "05-generation-preference.md" >}}) · 만들어 놓은 선호를 consolidation이 되돌리는 문제는 [06 consolidation이 되돌리는 것]({{< relref "06-consolidation-traps.md" >}}) · 폴백이 실제로 도는 속도는 [07 용량이 없을 때]({{< relref "07-ice-fallback.md" >}}) · 자매 챕터 [K8s 버전별 신기능]({{< relref "../k8s-features/_index.md" >}})

검증 기준은 kubernetes-sigs/karpenter 코어 **`v1.14.0-6-gac7a021e`**, aws/karpenter-provider-aws `main`(및 태그 `v1.7.0`·`v1.11.3` 대조)이다. 아래 인용한 코어 라인 번호는 v1.14 기준이라 배포 중인 버전과 몇 줄 어긋날 수 있다.

## 1. 스케줄러가 넘기는 것은 타입이 아니라 후보 집합이다

Cluster Autoscaler는 ASG 하나를 골라 desired capacity를 올린다 — 그 순간 인스턴스 타입은 이미 정해져 있다. Karpenter는 그렇지 않다. 스케줄러가 다루는 단위는 `NodeClaimTemplate`이고, 여기에는 **선택된 타입 하나가 아니라 후보 목록 전체**가 들어 있다.

```go
// pkg/controllers/provisioning/scheduling/nodeclaimtemplate.go
type NodeClaimTemplate struct {
	v1.NodeClaim

	NodePoolName        string
	NodePoolUUID        types.UID
	NodePoolWeight      int32
	InstanceTypeOptions cloudprovider.InstanceTypes   // ← 후보 집합
	Requirements        scheduling.Requirements
	IsStaticNodeClaim   bool
}
```

이 `InstanceTypeOptions`가 API 객체로 나가는 순간이 `ToNodeClaim()`이다. 후보 이름들이 requirement **하나**로 압축된다.

```go
// 같은 파일 :113-117
// Order the instance types by price and only take up to MaxInstanceTypes of them ...
instanceTypes := lo.Slice(i.InstanceTypeOptions.OrderByPrice(i.Requirements), 0, MaxInstanceTypes)
i.Requirements.Add(scheduling.NewRequirementWithFlexibility(
	corev1.LabelInstanceTypeStable, corev1.NodeSelectorOpIn,
	i.Requirements.Get(corev1.LabelInstanceTypeStable).MinValues,
	lo.Map(instanceTypes, func(i *cloudprovider.InstanceType, _ int) string { return i.Name })...,
))
```

같은 함수는 이어서 살아남은 후보들의 오퍼링에서 capacity type을 역산해 `karpenter.sh/capacity-type` requirement도 새로 붙인다(`:120-127`). 마지막에 `nc.Spec.Requirements = requirements.NodeSelectorRequirements()`(`:169`)로 반영되므로, 실제로 클러스터에 생기는 NodeClaim은 이런 모양이다.

```yaml
spec:
  requirements:
    - key: node.kubernetes.io/instance-type
      operator: In
      values: ["c7i.large", "c7i.xlarge", "m7i.large", ..., "c8i.large", ...]  # 수십~수백 개
    - key: karpenter.sh/capacity-type
      operator: In
      values: ["on-demand"]
```

**즉 NodeClaim은 "이 타입을 띄워라"가 아니라 "이 중 아무거나 띄워라"라는 주문서다.** 이 설계 덕에 Karpenter는 노드 그룹을 사전에 정의하지 않아도 되고, 대신 **"이 중 어느 것"을 정하는 권한이 클라우드 프로바이더 쪽으로 내려간다.** 세대 선호가 표현되지 않는 근본 원인이 여기서 시작한다.

{{< flow caption="타입 선택은 이 파이프라인의 마지막 칸에서 끝난다. 중간의 두 절단은 가격순 정렬을 쓰지만 세대를 가르지 못하고, 세대를 실제로 정하는 것은 EC2의 lowest-price다" >}}
{
  "nodes": [
    { "id": "pod", "col": 0, "row": 0, "label": "pending 파드", "sub": "nodeSelector · affinity · 리소스", "kind": "src" },
    { "id": "flt", "col": 1, "row": 0, "label": "후보 필터", "sub": "호환 · fit · 오퍼링 존재 (가격 없음)", "kind": "proc" },
    { "id": "nc", "col": 2, "row": 0, "label": "NodeClaim", "sub": "instance-type In [...] · 코어 600 절단", "kind": "store" },
    { "id": "prov", "col": 3, "row": 0, "label": "provider-aws", "sub": "필터 6종 → Truncate 60", "kind": "proc" },
    { "id": "ec2", "col": 4, "row": 0, "label": "EC2 CreateFleet", "sub": "instant · target 1 · lowest-price", "kind": "sink" }
  ],
  "edges": [
    { "from": "pod", "to": "flt", "label": "시뮬레이션", "rate": 620 },
    { "from": "flt", "to": "nc", "label": "후보 집합", "rate": 700 },
    { "from": "nc", "to": "prov", "label": "이름 셋", "rate": 700 },
    { "from": "prov", "to": "ec2", "label": "상위 60개", "rate": 520 }
  ]
}
{{< /flow >}}

## 2. 절단은 두 번 일어난다 — 그러나 세대를 자르지 않는다

후보 목록은 두 번 잘린다. 코어에서 600개, provider-aws에서 60개다.

| | 코어 절단 | provider-aws 절단 |
|---|---|---|
| 위치 | `scheduling/nodeclaimtemplate.go:113-114` | `pkg/providers/instance/instance.go:332` |
| 선언 | `var MaxInstanceTypes = 600` (`:50`) | `const maxInstanceTypes = 60` (`:67`) |
| 정렬 | `OrderByPrice(reqs)` 직접 호출 | `InstanceTypes.Truncate(ctx, reqs, 60)` → 내부에서 `OrderByPrice` |
| 조정 가능성 | `var`지만 이를 노출하는 플래그·환경변수는 **확인 필요**(코드에서 바인딩을 찾지 못했다) | `const` — 설정으로 못 바꾼다 |
| 정렬 결과가 다음 단계에 전달되는가 | **아니오** | 예(overrides 배열) |
| minValues 검증 동반 | 없음 | 조건부 — `HasMinValues()`이고 `MinValuesPolicy != BestEffort`일 때만 `Truncate`가 절단 후 `SatisfiesMinValues` 확인(`types.go:440-446`) |

`maxInstanceTypes = 60`은 `v1.7.0`·`v1.11.3`·`main` 세 곳에서 모두 같은 값이다(각각 `:63`·`:65`·`:67`). 버전 차이를 걱정할 필요는 없다.

### 2.1 정렬 키는 세대가 아니라 "그 타입의 최저 오퍼링 가격"이다

두 절단이 공유하는 정렬 함수는 이것 하나다.

```go
// pkg/cloudprovider/types.go:336-355
func (its InstanceTypes) OrderByPrice(reqs scheduling.Requirements) InstanceTypes {
	sort.Slice(its, func(i, j int) bool {
		iPrice := math.MaxFloat64
		jPrice := math.MaxFloat64
		for _, of := range its[i].Offerings {
			if of.Available && reqs.IsCompatible(of.Requirements, scheduling.AllowUndefinedWellKnownLabels) && of.Price < iPrice {
				iPrice = of.Price
			}
		}
		// j 도 동일
		return iPrice < jPrice
	})
	return its
}
```

세대·성능·패밀리를 보는 항이 하나도 없다. 그런데 **바로 그 점이 "절단이 8세대를 죽인다"는 추측을 반증한다.**

정렬 키는 인스턴스 타입 하나에 대해 스칼라 하나이고, 그 값은 **사이즈에 대해 단조**다. `c8i.large`의 최저 오퍼링 가격은 `c8i.24xlarge`보다 압도적으로 싸다. 세대 간 가격차는 *같은 패밀리·같은 사이즈끼리* 비교했을 때의 차이인 반면, 사이즈 간 가격차는 vCPU 배수만큼 벌어진다. 정렬은 후자가 지배한다.

따라서 가격 오름차순 상위 60개를 남기면 이렇게 된다.

| 잘못된 그림 | 실제 |
|---|---|
| 7세대 전부 생존 → 8세대 전부 탈락 | 양 세대의 **작은 사이즈들이 나란히 생존**, 양 세대의 **가장 큰 사이즈들이 나란히 탈락** |
| 세대 단위로 후보가 사라진다 | 세대 단위 배제는 이 정렬 키에서 **구조적으로 발생할 수 없다** |

**"8세대가 CreateFleet 요청에 아예 실리지 않는다"는 시나리오는 성립하지 않는다.** 8세대는 후보에 남는다. 남은 채로 지는 것뿐이다. 대응책을 고를 때 이 구분이 중요하다 — 후보에서 사라지는 문제였다면 NodePool을 좁혀서 풀렸겠지만, 실제 문제는 그 뒤에 있다.

{{< callout type="warning" >}}
**단, 이 안전성은 "가격을 손대지 않았을 때"의 이야기다.** [05]({{< relref "05-generation-preference.md" >}})에서 다루는 NodeOverlay `priceAdjustment`로 7세대에 인위적인 가격 페널티를 걸면 정렬 키 자체가 왜곡되므로, 페널티가 과하면 7세대가 60위 밖으로 밀려 **폴백 후보가 사라진다.** 절단이 세대를 자르지 못한다는 성질은 자연 가격에서만 보장된다.
{{< /callout >}}

### 2.2 코어 600 절단은 순서를 전달하지 않는다

더 결정적인 사실이 있다. 코어가 열심히 정렬해 잘라낸 결과는 `In` requirement로 들어가는데, `Requirement`의 In 값 저장 구조가 **집합**이다.

```go
// pkg/scheduling/requirement.go:36-43
type Requirement struct {
	Key        string
	complement bool
	values     sets.Set[string]   // ← 순서 없음
	gte        *int
	lte        *int
	MinValues  *int
}
```

`NewRequirementWithFlexibility`의 In 분기는 값들을 그대로 `sets.Set[string]`에 밀어 넣는다(`:61-73`). **OrderByPrice가 만든 순서는 NodeClaim으로 넘어가는 순간 사라진다.** 게다가 사용자 구성처럼 6개 패밀리로 좁힌 NodePool이라면 후보 수가 600에 한참 못 미쳐 `lo.Slice(..., 0, 600)` 자체가 no-op이다. 패밀리 제한 없이 쓰는 NodePool에서만 실제로 잘린다.

⇒ **코어 600 절단은 이 문제에서 관문이 아니다.** "가격이 세 번 개입한다"는 서술을 본 적이 있다면 그중 하나는 지워야 한다.

## 3. 최종 선택자는 EC2다

NodeClaim을 받은 provider-aws는 launch 직전에 필터 6종을 통과시키고(`instance.go:309-320` — `CompatibleAvailableFilter`, `CapacityReservationTypeFilter`, `CapacityBlockFilter`, `ReservedOfferingFilter`, `ExoticInstanceTypeFilter`, `SpotOfferingFilter`), 앞서 본 `Truncate(ctx, reqs, 60)`을 건 다음, CreateFleet 입력을 조립한다.

```go
// pkg/providers/instance/types.go:221-248 — Build()의 세 옵션은 상호 배타 분기다
func (b *CreateFleetInputBuilder) Build() *ec2.CreateFleetInput {
	input := &ec2.CreateFleetInput{
		Type: ec2types.FleetTypeInstant,
		TargetCapacitySpecification: &ec2types.TargetCapacitySpecificationRequest{
			TotalTargetCapacity: lo.ToPtr[int32](1),
			...
		},
		...
	}
	if b.capacityType == karpv1.CapacityTypeSpot {
		input.SpotOptions = &ec2types.SpotOptionsRequest{
			AllocationStrategy: lo.Ternary(b.overlay,
				ec2types.SpotAllocationStrategyCapacityOptimizedPrioritized,
				ec2types.SpotAllocationStrategyPriceCapacityOptimized),
		}
	} else if b.capacityReservationInterruptible {
		input.ReservedCapacityOptions = &ec2types.ReservedCapacityOptionsRequest{ /* ... */ }
	} else if b.capacityReservationType != v1.CapacityReservationTypeCapacityBlock {
		input.OnDemandOptions = &ec2types.OnDemandOptionsRequest{
			AllocationStrategy: lo.Ternary(b.overlay,
				ec2types.FleetOnDemandAllocationStrategyPrioritized,
				ec2types.FleetOnDemandAllocationStrategyLowestPrice),   // ← 기본값
		}
	}
	return input
}
```

**세 필드는 나란히 세팅되는 게 아니라 `if`/`else if`로 갈리는 분기다.** capacity type이 spot이면 `SpotOptions`, reserved+interruptible이면 `ReservedCapacityOptions`, 그 외(CapacityBlock이 아닌 reserved 또는 on-demand)면 `OnDemandOptions`가 설정된다 — CapacityBlock 경로에서는 `OnDemandOptions` 자체가 아예 안 실린다. 이 문서가 다루는 on-demand 기본 경로에서는 마지막 분기가 타므로 결론은 그대로다.

**`lowest-price`.** 후보 60개를 받은 EC2가 그중 제일 싼 것을 고른다. 7세대가 8세대보다 싸다면 여기서 끝이다 — Karpenter는 8세대를 후보에 넣어 보냈고, EC2가 안 골랐을 뿐이다.

`b.overlay`가 참일 때만 전략이 `prioritized`로 바뀌고 각 override의 `Priority`에 Karpenter가 계산한 가격이 실린다(`instance.go:552-556`). 이 플래그는 NodeClaim에 `karpenter.sh/price-overlay-applied` 어노테이션이 붙어 있을 때만 켜지고(`instance.go:365-367`), 그 어노테이션은 코어가 NodeOverlay 적용 인스턴스를 발견했을 때만 붙인다(`nodeclaimtemplate.go:129-133`). 이 경로의 손익과 미검증 지점은 [05]({{< relref "05-generation-preference.md" >}})에서 다룬다.

{{< callout type="warning" >}}
**확인 필요 — 소수점 `Priority`.** Karpenter는 `Priority: lo.ToPtr(float64(offering.Price))`로 시간당 달러 가격(예: `0.1746`)을 그대로 넣는다. 그런데 [AWS API 문서](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_FleetLaunchTemplateOverridesRequest.html)는 이 필드를 "Valid values are whole numbers starting at `0`"으로 규정한다. 1달러 미만 값들이 정수로 절삭된다면 전부 priority 0이 되어 우선순위가 조용히 무력화된다. **코드로도 문서로도 확정할 수 없어 실측이 필요하다.** `prioritized` 전략을 쓰는 방식(=오버레이 경로)의 신뢰도를 깎는 요인이다.
{{< /callout >}}

부수적으로 알아둘 함정이 하나 더 있다. `checkODFallback`은 **on-demand로 결정됐는데 requirements에는 spot도 허용돼 있는** 상황에서 후보가 5개(`instanceTypeFlexibilityThreshold`) 미만이면 경고를 낸다(`instance.go:426-443`). 다만 이건 `log.FromContext(ctx).Error(...)`로 **로그만 남기고 launch를 막지는 않는다**(`instance.go:360-362`). 세대·사이즈를 좁게 자른 NodePool을 만들면 이 로그가 계속 뜰 수 있는데, 장애는 아니다.

## 4. 그래서 가격은 어디서 개입하는가

지금까지의 지점들을 한 줄씩 다시 센다.

| 단계 | 코드 | 가격 개입 | 세대를 가르는가 |
|---|---|---|---|
| 후보 필터 | `scheduling/nodeclaim.go:541-618` | **없음** | ✗ |
| 코어 600 절단 | `nodeclaimtemplate.go:113-114` | 정렬만 | ✗ — 순서 미전달 + 대개 no-op |
| provider 필터 6종 | `instance.go:309-320` | 없음 | ✗ |
| provider 60 절단 | `instance.go:332` | 정렬 + 절단 | ✗ — 사이즈에 대해 단조 |
| **CreateFleet 할당 전략** | `instance/types.go:244` | **결정** | **✅ 여기다** |
| consolidation 교체 필터 | `scheduling/nodeclaim.go:411-419` | **결정** | **✅** → [06]({{< relref "06-consolidation-traps.md" >}}) |

후보 필터에 가격이 없다는 사실은 직접 볼 만하다. `filterInstanceTypesByRequirements`의 채택 조건은 단 한 줄이고, 정렬도 최소화도 없다.

```go
// pkg/controllers/provisioning/scheduling/nodeclaim.go:596-598
if itCompat && itFits && itHasOffering {
	remaining = append(remaining, it)
}
```

다만 "순수한 3조건 AND"라고 말하면 부정확하다. 이 함수는 (a) `daemonOverheadGroups`를 돌면서 `group.HostPortUsage.Conflicts(pod, hostPorts)`인 그룹을 통째로 건너뛰고(`:562-564`), (b) `eligibleInstanceTypes` 집합으로 한 번 더 게이팅하며(`:576-578`), (c) 마지막에 minValues를 강제해 Strict 정책이면 `remaining = nil`로 만든다(`:602-613`). **"정렬을 하지 않는다"만 정확한 서술이다.**

⇒ 정리하면 **"싼 게 이긴다"는 Karpenter 코어의 필터링 정책이 아니라 EC2에 위임한 결과**다. 코어에서 고칠 수 있는 것은 "무엇을 후보로 보낼 것인가"뿐이고, "후보 중 무엇을 고를 것인가"는 코어의 손을 떠나 있다.

## 5. NodePool requirements에 선호는 없다

그러면 "8세대를 선호"를 requirements에 쓸 수 있는가. 스키마를 보면 답이 나온다.

```go
// pkg/apis/v1/nodeclaim.go:93-124
type NodeSelectorRequirementWithMinValues struct {
	Key       string                    `json:"key"`
	Operator  v1.NodeSelectorOperator   `json:"operator,omitempty"`
	Values    []string                  `json:"values,omitempty"`
	MinValues *int                      `json:"minValues,omitempty"`
}
```

**네 필드가 전부다.** `weight`도 `preference`도 `priority`도 없다. 이 타입은 `NodePool.spec.template.spec.requirements`와 `NodeClaim.spec.requirements` 양쪽에 쓰이므로, 어느 쪽에도 선호를 적을 자리가 없다.

`weight`가 존재하는 층은 하나 위다 — `NodePool.spec.weight`이고, 스케줄러는 이 값을 `NodeClaimTemplate.NodePoolWeight`로 복사해 간다(`nodeclaimtemplate.go:71`). 즉 **우선순위는 NodePool 간 축이지 NodePool 내부 축이 아니다.**

| 표현하고 싶은 것 | 가능한가 | 수단 |
|---|---|---|
| "8세대만 쓴다" | ✅ | `instance-generation Gte 8` — hard constraint |
| "8세대와 7세대 둘 다 허용" | ✅ | 두 세대를 `In`에 나열 |
| "8세대를 **먼저**, 없으면 7세대" | ❌ (한 NodePool 안에서) | 표현할 필드가 없다 |
| "8세대를 먼저, 없으면 7세대" (NodePool 2개) | ✅ | `spec.weight` → [05]({{< relref "05-generation-preference.md" >}}) |
| "7세대를 비싸게 취급" | △ | NodeOverlay(알파) → [05]({{< relref "05-generation-preference.md" >}}) |

## 6. 세대를 말하는 어휘 — `instance-generation`과 Gte/Lte

선호는 못 써도 **세대를 지목하는 어휘 자체는 잘 갖춰져 있다.** 두 조각이 필요하다.

**① 라벨.** `karpenter.k8s.aws/instance-generation`은 provider-aws가 만드는 AWS 고유 라벨이다. 인스턴스 타입 이름을 정규식으로 쪼개 값을 채운다.

```go
// provider-aws pkg/providers/instancetype/types.go
instanceTypeScheme = regexp.MustCompile(`(^[a-z]+)(\-[0-9]+tb)?([0-9]+).*\.`)
...
instanceFamilyParts := instanceTypeScheme.FindStringSubmatch(string(info.InstanceType))
if len(instanceFamilyParts) == 4 {
	requirements[v1.LabelInstanceCategory].Insert(instanceFamilyParts[1])    // "c"
	requirements[v1.LabelInstanceGeneration].Insert(instanceFamilyParts[3])  // "8"
}
```

`c8i.large`면 카테고리 `c`, 세대 `8`이다. 그리고 이 라벨은 provider가 init 시점에 코어의 well-known 라벨 집합에 삽입하므로(`pkg/apis/v1/labels.go:31,39,137` — `karpv1.WellKnownLabels = karpv1.WellKnownLabels.Insert(..., LabelInstanceGeneration, ...)`), NodePool requirements뿐 아니라 NodeOverlay requirements에서도 그대로 쓸 수 있다.

**② 숫자 비교 연산자.** 코어 CRD의 operator enum에는 Kubernetes 표준 넷 외에 Gt/Lt/Gte/Lte가 들어 있다.

```yaml
# pkg/apis/crds/karpenter.sh_nodepools.yaml:308-317
enum:
  - Gte
  - Lte
  - In
  - NotIn
  - Exists
  - DoesNotExist
  - Gt
  - Lt
```

Go 타입 주석에는 `+kubebuilder:validation:Enum:=Gte;Lte`만 적혀 있는데, 이는 코드 제너레이터가 기존 `v1.NodeSelectorOperator` 값들과 union하기 때문이다(`nodeclaim.go:99-101` 주석). **생성된 CRD가 최종 진실이고 8개 전부 유효하다.**

내부적으로 Gt/Lt는 포함 경계로 정규화된다.

```go
// pkg/scheduling/requirement.go:87-106
if operator == corev1.NodeSelectorOpGt {
	value, _ := strconv.Atoi(values[0])
	value++              // canonicalize GT N to GTE N+1
	r.gte = &value
}
if operator == corev1.NodeSelectorOpLt {
	value, _ := strconv.Atoi(values[0])
	value--              // canonicalize LT N to LTE N-1
	r.lte = &value
}
```

그래서 이렇게 쓸 수 있다.

```yaml
requirements:
  - key: karpenter.k8s.aws/instance-generation
    operator: Gte
    values: ["8"]          # 8세대 이상만. Gt ["7"] 과 동치.
```

**하지만 이건 hard constraint다.** `Gte 8`을 걸면 8세대 용량이 없을 때 파드가 그냥 pending된다 — 폴백이 없다. 반대로 7·8세대를 모두 허용하면 §3의 `lowest-price`가 7세대를 고른다. **한 NodePool 안에서는 "허용"과 "우선"을 구분할 수 없고, 이 어휘로 표현할 수 있는 건 허용뿐이다.**

## 7. `minValues`는 우선순위가 아니다

스키마의 네 번째 필드인 `minValues`를 우선순위 손잡이로 오해하기 쉽다. 실제로는 정반대에 가깝다.

```go
// pkg/cloudprovider/types.go:399-433
func (its InstanceTypes) SatisfiesMinValues(requirements scheduling.Requirements) (int, map[string]int, error) {
	...
	for k, v := range valuesForKey {
		if len(v) < lo.FromPtr(requirements.Get(k).MinValues) {
			incompatibleKeys[k] = len(v)
		} else {
			delete(incompatibleKeys, k)
		}
	}
	...
}
```

**"이 키에 서로 다른 값이 최소 N개는 후보에 남아 있어야 launch를 허용한다"는 다양성 하한 검증**이다. 스키마 제약도 `Minimum:=1 / Maximum:=50`으로 개수를 받는다(`nodeclaim.go:119-123`).

위반 시 동작은 정책에 따라 갈린다. `MinValuesPolicy`가 Strict(기본)면 후보를 통째로 버리고(`scheduling/nodeclaim.go:608` `remaining = nil`), BestEffort면 에러를 무시한다. provider-aws가 부르는 `Truncate`도 같은 조건(`HasMinValues()`이고 Strict일 때만, `types.go:440-446`)으로 같은 검증을 거쳐 위반 시 `InsufficientCapacityError`를 반환한다(`instance.go:332-335`).

세대 선호에 대해 이게 무슨 뜻인가.

| 시도 | 결과 |
|---|---|
| `instance-generation`에 `minValues: 1` | 무의미 — 어차피 최소 1개는 남는다 |
| `instance-generation`에 `minValues: 2` | **역효과** — 8세대만 남는 상황을 위반으로 만들어, 7세대를 후보에 붙들어 두거나 launch를 포기시킨다 |
| `instance-family`에 큰 `minValues` | spot 다양성 확보용으로는 정당하지만, 세대 선호와는 무관하고 8세대 단독 launch를 막는다 |

⇒ **`minValues`는 spot 중단 위험을 낮추려고 후보 다양성을 강제하는 손잡이**다. 세대 선호에 쓸 수 없고, 쓰면 반대 방향으로 작동한다.

## 8. 파드의 `preferred` nodeAffinity가 대안이 아닌 이유

"NodePool로 안 되면 파드에서 하면 되지 않나" — `preferredDuringSchedulingIgnoredDuringExecution`은 Kubernetes 스케줄러에서는 점수 함수지만, **Karpenter는 점수를 매기지 않는다.** 프로비저닝은 "이 파드를 담을 노드를 만들 수 있는가"라는 만족성 문제이므로, 점수를 쓸 자리가 없다. 대신 이렇게 처리한다.

```go
// pkg/scheduling/requirements.go:73, 96-101
// NewPodRequirements constructs requirements from a pod and treats any preferred requirements as required.
...
// Select heaviest preference and treat as a requirement.
// An outer loop will iteratively unconstrain them if unsatisfiable.
if preferred := pod.Spec.Affinity.NodeAffinity.PreferredDuringSchedulingIgnoredDuringExecution; len(preferred) > 0 {
	sort.Slice(preferred, func(i, j int) bool { return preferred[i].Weight > preferred[j].Weight })
	requirements.Add(NewNodeSelectorRequirements(preferred[0].Preference.MatchExpressions...).Values()...)
}
```

**가장 무거운 preferred term 하나를 hard requirement로 승격**해 시뮬레이션하고, 그 상태로 스케줄이 실패하면 바깥 루프가 제약을 하나씩 벗긴다(`scheduling/scheduler.go:521-552`).

```go
// scheduler.go:543
if relaxed := s.preferences.Relax(ctx, p); !relaxed {
	return err
}
```

벗기는 순서는 고정돼 있다.

```go
// pkg/controllers/provisioning/scheduling/preferences.go:39-44
relaxations := []func(*v1.Pod) *string{
	p.removeRequiredNodeAffinityTerm,
	p.removePreferredPodAffinityTerm,
	p.removePreferredPodAntiAffinityTerm,
	p.removePreferredNodeAffinityTerm,     // ← 4번째
	p.removeTopologySpreadScheduleAnyway,
}
```

이 동작 자체는 `--preference-policy`로 끌 수 있고 기본값은 `Respect`다(`pkg/operator/options/options.go:131`). `Ignore`면 `NewStrictPodRequirements`가 쓰여 preferred term이 프로비저닝에 전혀 반영되지 않는다(`scheduler.go:554-560`).

**그래서 `instance-generation In ["8"]`을 preferred로 걸면 실제로 8세대가 우선 시도되긴 한다.** 그런데 세대 선호의 수단으로는 여섯 군데가 어긋난다.

| 한계 | 근거 | 왜 문제인가 |
|---|---|---|
| **파드마다** 걸어야 한다 | 파드 스펙 필드다 | NodePool 하나 고치면 끝나는 문제를 전체 워크로드로 번지게 한다. 새 팀이 배포하는 파드는 자동으로 누락된다 |
| 최고 가중치 term **하나만** 승격 | `requirements.go:98-100` `preferred[0]` | 이미 zone·arch 선호를 쓰고 있다면 세대 선호와 자리를 다툰다 |
| 완화 순서 **4번째** | `preferences.go:39-44` | 파드에 preferred pod affinity/anti-affinity가 있으면 그것들이 먼저 벗겨진다 — 세대 제약이 풀리기까지 라운드가 더 든다 |
| 완화 트리거가 **시뮬레이션 실패** | `scheduler.go:543` | 8세대 오퍼링이 아직 unavailable로 마킹되지 않았다면 시뮬레이션은 성공한다. 즉 실제 launch에서 ICE를 한 번 맞아야 비로소 완화된다 → 폴백 지연([07]({{< relref "07-ice-fallback.md" >}})) |
| 토폴로지 요구사항 구성에는 required로 안 잡힘 | [공식 문서](https://karpenter.sh/docs/concepts/scheduling/) — "Karpenter does not interpret preferred affinities as required when constructing topology requirements" | topology spread를 쓰는 워크로드에서 의도와 다르게 퍼질 수 있다 |
| 정책 하나로 전부 꺼짐 | `options.go:131` | 클러스터 운영자가 `PREFERENCE_POLICY=Ignore`로 바꾸면 전 워크로드의 세대 선호가 조용히 사라진다 |

⇒ **파드 preferred는 "특정 워크로드에만 세대 힌트를 주고 싶다"에는 쓸 만하지만, "클러스터 기본 정책으로 8세대를 우선한다"에는 맞지 않는 도구다.**

## 이 문서에서 가져갈 것

- **스케줄러는 타입을 확정하지 않는다.** NodeClaim에 실리는 건 후보 이름 집합(`instance-type In [...]`)이고, "이 중 어느 것"을 정하는 권한은 클라우드 프로바이더로 내려간다. Karpenter가 노드 그룹 없이 동작하는 이유이자, 세대 선호가 표현되지 않는 이유다.
- **절단(600/60)은 세대를 자르지 않는다.** 정렬 키가 "그 타입의 최저 오퍼링 가격"이라 사이즈에 대해 단조이므로, 잘리는 건 양 세대의 가장 큰 사이즈들이다. 게다가 코어 600 절단의 순서는 `sets.Set[string]`에 들어가며 소실되고, 좁은 NodePool에서는 애초에 no-op이다.
- **8세대가 지는 곳은 딱 두 군데다** — CreateFleet의 On-Demand 기본 전략 `lowest-price`(`instance/types.go:244`)와 consolidation의 `launchPrice < maxPrice`(`scheduling/nodeclaim.go:411-419`). 앞의 것이 "왜 안 뜨나", 뒤의 것이 "왜 떠도 갈아치워지나"다.
- **단일 NodePool 안에 선호를 표현할 필드가 없다.** requirements는 Key/Operator/Values/MinValues 넷뿐이고 `weight`는 NodePool 레벨에만 있다. `instance-generation` + `Gte/Lte`는 "허용"을 정하는 어휘이지 "우선"을 정하는 어휘가 아니다.
- **잘못 잡은 손잡이 둘.** `minValues`는 다양성 하한이라 오히려 7세대를 붙들어 두고, 파드의 `preferred` nodeAffinity는 파드 단위 개입 + term 하나 제한 + 완화 순서 4번째 + 실패 후 완화라는 제약을 전부 안고 간다.
- ⇒ **선호를 만들려면 NodePool을 쪼개거나 가격 자체를 왜곡해야 한다.** 두 방법의 매니페스트 전문과 손익은 [05 세대 선호 만들기]({{< relref "05-generation-preference.md" >}})에 있다.

## 참고 자료

- 동작 서술의 근거 코드 — `kubernetes-sigs/karpenter` **v1.14.0-6-gac7a021e**: `pkg/controllers/provisioning/scheduling/nodeclaimtemplate.go`(후보 집합 → NodeClaim), `pkg/cloudprovider/types.go`(`OrderByPrice`·`Truncate`·`SatisfiesMinValues`), `pkg/controllers/provisioning/scheduling/nodeclaim.go`(후보 필터), `pkg/scheduling/requirement.go`(연산자 정규화), `pkg/scheduling/requirements.go`·`pkg/controllers/provisioning/scheduling/preferences.go`(preferred 승격·완화), `pkg/apis/v1/nodeclaim.go`·`pkg/apis/crds/karpenter.sh_nodepools.yaml`(스키마·enum)
- `aws/karpenter-provider-aws` `main`(태그 `v1.7.0`·`v1.11.3` 대조): `pkg/providers/instance/instance.go`(필터 6종·60개 절단·overlay 분기·`checkODFallback`), `pkg/providers/instance/types.go`(CreateFleet 입력·할당 전략), `pkg/providers/instancetype/types.go`(세대 라벨 정규식), `pkg/apis/v1/labels.go`(well-known 라벨 등록)
- [Karpenter Scheduling 개념 문서](https://karpenter.sh/docs/concepts/scheduling/) — well-known 라벨 표, Gte/Lte 확장, preferred affinity와 topology 요구사항의 관계
- [EC2 `FleetLaunchTemplateOverridesRequest`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_FleetLaunchTemplateOverridesRequest.html) — §3의 소수점 `Priority` 확인 필요 항목의 출처
- 같은 클러스터군의 업그레이드 기록: [Karpenter 0.36.2 → 1.14.0 (v1beta1 → v1 CRD)]({{< relref "../eks-upgrade/components/01-karpenter.md" >}})

{{< callout type="warning" >}}
**이 문서에서 실측으로 확인해야 할 것**
- **소수점 `Priority` 해석** — `prioritized` 전략에서 1달러 미만 가격이 정수 절삭되는지. 오버레이 경로를 쓴다면 실제로 어떤 패밀리가 뜨는지 직접 확인해야 한다(§3).
- **코어 `MaxInstanceTypes=600`의 조정 수단** — 선언이 `var`인데(테스트용으로 의도적으로 `var`라는 주석이 있다) 이를 노출하는 CLI 플래그·환경변수를 코드에서 찾지 못했다. 운영 중 조정이 필요하면 배포 버전에서 재확인할 것(§2).
- **8세대와 7세대의 실제 가격 대소** — 이 문서의 모든 서술은 "알고리즘이 가격만 본다"는 사실에 근거하며, 8세대가 항상 더 비싸다고 단정하지 않는다. 리전·AZ·할인 상황에 따라 역전 구간이 있을 수 있으므로 대상 리전에서 확인할 것.
{{< /callout >}}
