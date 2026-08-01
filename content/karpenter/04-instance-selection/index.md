---
title: "인스턴스는 누가 고르는가"
weight: 4
aliases: ["/k8s-features/karpenter/01-instance-selection/"]
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

> **왜 이 문서인가.** 하나의 NodePool에 c8i/m8i/r8i와 c7i/m7i/r7i를 함께 선언하면 "8세대 우선, 없으면 7세대 폴백"을 기대하지만 실제로는 항상 7세대만 뜬다. 원인은 절단·필터·EC2 중 하나이고 어느 쪽이냐에 따라 대응책이 완전히 갈리므로, "싼 걸 좋아해서"로는 넘어갈 수 없다. 이 문서는 파드가 pending되는 순간부터 EC2가 인스턴스를 띄우는 순간까지 **선택이 실제로 일어나는 지점을 코드로 하나씩 지우고**, 흔한 오해 하나(절단이 세대를 자른다)를 명시적으로 깬다.

> 자매 문서: [챕터 개요]({{< relref "_index.md" >}}) · [05 세대 선호 만들기]({{< relref "05-generation-preference.md" >}}) · [06 consolidation이 되돌리는 것]({{< relref "06-consolidation-traps.md" >}}) · [07 용량이 없을 때]({{< relref "07-ice-fallback.md" >}}) · [K8s 버전별 신기능]({{< relref "../../k8s-features/_index.md" >}})

검증 기준은 kubernetes-sigs/karpenter 코어 **`v1.14.0-6-gac7a021e`**, aws/karpenter-provider-aws `main`(및 태그 `v1.7.0`·`v1.11.3` 대조)이다. 라인 번호는 v1.14 기준이라 배포 버전과 몇 줄 어긋날 수 있다.

## 1. 스케줄러가 넘기는 것은 타입이 아니라 후보 집합이다

Cluster Autoscaler는 ASG 하나를 골라 desired capacity를 올린다 — 인스턴스 타입은 이미 정해져 있다. Karpenter가 다루는 단위는 `NodeClaimTemplate`이고, 여기엔 **타입 하나가 아니라 후보 목록 전체**가 들어 있다.

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

같은 함수는 capacity type도 역산해 requirement로 추가하고 `nc.Spec.Requirements`에 반영한다(`:120-127`, `:169`). 실제 NodeClaim은 이런 모양이다.

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

**즉 NodeClaim은 "이 타입을 띄워라"가 아니라 "이 중 아무거나 띄워라"라는 주문서다.** 이 설계 덕에 Karpenter는 노드 그룹을 사전에 정의하지 않아도 되지만, 대신 **"이 중 어느 것"을 정하는 권한이 클라우드 프로바이더 쪽으로 내려간다.** 세대 선호가 표현되지 않는 근본 원인이 여기서 시작한다.

{{< flow src="_flow/1-스케줄러가-넘기는-것은-타입이.json" />}}

## 2. 절단은 두 번 일어난다 — 그러나 세대를 자르지 않는다

후보 목록은 두 번 잘린다. 코어에서 600개, provider-aws에서 60개다.

| | 코어 절단 | provider-aws 절단 |
|---|---|---|
| 위치 | `scheduling/nodeclaimtemplate.go:113-114` | `pkg/providers/instance/instance.go:332` |
| 선언 | `var MaxInstanceTypes = 600` (`:50`) | `const maxInstanceTypes = 60` (`:67`) |
| 정렬 | `OrderByPrice(reqs)` 직접 호출 | `InstanceTypes.Truncate(ctx, reqs, 60)` → 내부에서 `OrderByPrice` |
| 조정 가능성 | `var` — 노출 수단 **확인 필요**(하단 참고) | `const` — 설정 불가 |
| 정렬 결과가 다음 단계에 전달되는가 | **아니오** | 예(overrides 배열) |
| minValues 검증 동반 | 없음 | 조건부 — Strict 정책일 때만 절단 후 확인(§7) |

`maxInstanceTypes = 60`은 `v1.7.0`·`v1.11.3`·`main` 세 곳에서 모두 같다(각각 `:63`·`:65`·`:67`).

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

세대·성능·패밀리를 보는 항이 하나도 없다 — **오히려 그 점이 "절단이 8세대를 죽인다"는 추측을 반증한다.** 정렬 키는 타입 하나당 스칼라 하나이고 **사이즈에 대해 단조**다 — `c8i.large`의 최저 오퍼링 가격은 `c8i.24xlarge`보다 압도적으로 싸고, 그 격차가 세대차보다 훨씬 커서 정렬을 지배한다.

따라서 가격 오름차순 상위 60개를 남기면 이렇게 된다.

| 잘못된 그림 | 실제 |
|---|---|
| 7세대 생존 → 8세대 탈락 | 양 세대의 **작은 사이즈가 나란히 생존**, **큰 사이즈가 나란히 탈락** |
| 세대 단위로 후보가 사라진다 | 세대 단위 배제는 이 정렬 키에서 **구조적으로 불가능** |

**"8세대가 CreateFleet 요청에 아예 실리지 않는다"는 시나리오는 성립하지 않는다.** 8세대는 후보에 남은 채로 지는 것뿐이다. 이 구분이 대응책을 가른다 — 후보 소거 문제였다면 NodePool을 좁혀서 풀렸겠지만, 실제 문제는 그 뒤에 있다.

{{< callout type="warning" >}}
**단, 이 안전성은 "가격을 손대지 않았을 때"의 이야기다.** [05]({{< relref "05-generation-preference.md" >}})에서 다루는 NodeOverlay `priceAdjustment`로 7세대에 인위적인 가격 페널티를 걸면 정렬 키 자체가 왜곡되므로, 페널티가 과하면 7세대가 60위 밖으로 밀려 **폴백 후보가 사라진다.** 절단이 세대를 자르지 못한다는 성질은 자연 가격에서만 보장된다.
{{< /callout >}}

### 2.2 코어 600 절단은 순서를 전달하지 않는다

코어가 정렬해 잘라낸 결과는 `In` requirement로 들어가는데, `Requirement`의 In 값 저장 구조가 **집합**이다.

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

`NewRequirementWithFlexibility`의 In 분기는 값을 `sets.Set[string]`에 밀어 넣는다(`:61-73`) — **순서가 여기서 사라진다.** 패밀리를 좁힌 NodePool에서는 후보가 600에 못 미쳐 절단 자체가 no-op이다.

⇒ **코어 600 절단은 이 문제에서 관문이 아니다.** "가격이 세 번 개입한다"는 서술을 본 적이 있다면 그중 하나는 지워야 한다.

## 3. 최종 선택자는 EC2다

NodeClaim을 받은 provider-aws는 launch 직전에 필터 6종(`instance.go:309-320`)을 통과시키고, 앞서 본 `Truncate(ctx, reqs, 60)`을 건 다음 CreateFleet 입력을 조립한다.

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

이 문서가 다루는 on-demand 기본 경로는 마지막 `else if` 분기이므로 결론엔 영향 없다.

**`lowest-price`.** 후보 60개를 받은 EC2가 그중 제일 싼 것을 고른다. 7세대가 8세대보다 싸다면 여기서 끝이다 — Karpenter는 8세대를 후보에 넣어 보냈고, EC2가 안 골랐을 뿐이다.

`b.overlay`가 참일 때만 `prioritized`로 바뀐다(`instance.go:552-556`) — `price-overlay-applied` 어노테이션이 있을 때만이고(`instance.go:365-367`), 그 어노테이션은 코어가 NodeOverlay 인스턴스를 발견했을 때만 붙는다(`nodeclaimtemplate.go:129-133`). 손익은 [05]({{< relref "05-generation-preference.md" >}}) 참고.

{{< callout type="warning" >}}
**확인 필요 — 소수점 `Priority`.** Karpenter는 `Priority: lo.ToPtr(float64(offering.Price))`로 시간당 달러 가격(예: `0.1746`)을 그대로 넣는다. 그런데 [AWS API 문서](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_FleetLaunchTemplateOverridesRequest.html)는 이 필드를 "Valid values are whole numbers starting at `0`"으로 규정한다. 1달러 미만 값들이 정수로 절삭된다면 전부 priority 0이 되어 우선순위가 조용히 무력화된다. **코드로도 문서로도 확정할 수 없어 실측이 필요하다.** `prioritized` 전략을 쓰는 방식(=오버레이 경로)의 신뢰도를 깎는 요인이다.
{{< /callout >}}

부수적 함정: `checkODFallback`은 on-demand로 결정됐는데 spot도 허용된 상황에서 후보가 5개 미만이면 경고하지만(`instance.go:426-443`), **로그만 남기고 launch는 막지 않는다**(`instance.go:360-362`) — 세대·사이즈를 좁힌 NodePool에서 계속 떠도 장애는 아니다.

## 4. 그래서 가격은 어디서 개입하는가

지금까지의 지점을 한 줄씩 다시 센다.

| 단계 | 코드 | 가격 개입 | 세대를 가르는가 |
|---|---|---|---|
| 후보 필터 | `scheduling/nodeclaim.go:541-618` | **없음** | ✗ |
| 코어 600 절단 | `nodeclaimtemplate.go:113-114` | 정렬만 | ✗ — 순서 미전달 + 대개 no-op |
| provider 필터 6종 | `instance.go:309-320` | 없음 | ✗ |
| provider 60 절단 | `instance.go:332` | 정렬 + 절단 | ✗ — 사이즈에 대해 단조 |
| **CreateFleet 할당 전략** | `instance/types.go:244` | **결정** | **✅ 여기다** |
| consolidation 교체 필터 | `scheduling/nodeclaim.go:411-419` | **결정** | **✅** → [06]({{< relref "06-consolidation-traps.md" >}}) |

후보 필터엔 가격이 없다 — `filterInstanceTypesByRequirements`의 채택 조건은 한 줄뿐이고 정렬도 없다.

```go
// pkg/controllers/provisioning/scheduling/nodeclaim.go:596-598
if itCompat && itFits && itHasOffering {
	remaining = append(remaining, it)
}
```

다만 "3조건 AND"는 부정확하다 — `daemonOverheadGroups`의 포트 충돌 그룹은 통째로 건너뛰고(`:562-564`), `eligibleInstanceTypes`로 한 번 더 게이팅하며(`:576-578`), Strict 정책의 minValues 위반 시 `remaining = nil`로 만든다(`:602-613`). **"정렬을 하지 않는다"만 정확한 서술이다.**

⇒ **"싼 게 이긴다"는 코어의 필터링 정책이 아니라 EC2에 위임한 결과다.** 코어는 "무엇을 후보로 보낼지"만 정하고, "무엇을 고를지"는 코어의 손을 떠나 있다.

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

**네 필드가 전부다** — `weight`·`preference`·`priority`는 없다. `NodePool.spec.template.spec.requirements`와 `NodeClaim.spec.requirements` 양쪽에 쓰이므로 선호를 적을 자리가 없다.

`weight`는 한 층 위 `NodePool.spec.weight`에 있고, 스케줄러가 `NodeClaimTemplate.NodePoolWeight`로 복사해 간다(`nodeclaimtemplate.go:71`). **우선순위는 NodePool 간 축이지 내부 축이 아니다.**

| 표현하고 싶은 것 | 가능한가 | 수단 |
|---|---|---|
| "8세대만 쓴다" | ✅ | `instance-generation Gte 8` — hard constraint |
| "8세대와 7세대 둘 다 허용" | ✅ | 두 세대를 `In`에 나열 |
| "8세대를 **먼저**, 없으면 7세대" | ❌ (한 NodePool 안에서) | 표현할 필드가 없다 |
| "8세대를 먼저, 없으면 7세대" (NodePool 2개) | ✅ | `spec.weight` → [05]({{< relref "05-generation-preference.md" >}}) |
| "7세대를 비싸게 취급" | △ | NodeOverlay(알파) → [05]({{< relref "05-generation-preference.md" >}}) |

## 6. 세대를 말하는 어휘 — `instance-generation`과 Gte/Lte

선호는 못 써도 **세대를 지목하는 어휘는 잘 갖춰져 있다** — 두 조각이 필요하다.

**① 라벨.** `karpenter.k8s.aws/instance-generation`은 provider-aws가 인스턴스 타입 이름을 정규식으로 쪼개 채우는 AWS 고유 라벨이다.

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

`c8i.large`면 카테고리 `c`, 세대 `8`이다. 이 라벨은 provider가 init 시점에 코어 well-known 라벨 집합에 삽입되므로(`pkg/apis/v1/labels.go:31,39,137`), NodePool뿐 아니라 NodeOverlay requirements에서도 그대로 쓸 수 있다.

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

Go 타입 주석엔 `+kubebuilder:validation:Enum:=Gte;Lte`만 있지만, 코드 제너레이터가 기존 `v1.NodeSelectorOperator` 값들과 union하기 때문이다(`nodeclaim.go:99-101` 주석) — **생성된 CRD가 최종 진실이고 8개 전부 유효하다.**

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

**하지만 이건 hard constraint다.** `Gte 8`을 걸면 8세대 용량이 없을 때 파드가 pending된다 — 폴백이 없다. 7·8세대를 모두 허용하면 §3의 `lowest-price`가 7세대를 고른다. **한 NodePool 안에서는 "허용"과 "우선"을 구분할 수 없다.**

## 7. `minValues`는 우선순위가 아니다

네 번째 필드 `minValues`는 우선순위 손잡이로 오해하기 쉽지만 정반대에 가깝다.

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

위반 시 Strict(기본)면 후보를 통째로 버리고(`scheduling/nodeclaim.go:608` `remaining = nil`), BestEffort면 무시한다. provider-aws의 `Truncate`도 같은 조건(`HasMinValues()`이고 Strict일 때만, `types.go:440-446`)에서 위반 시 `InsufficientCapacityError`를 반환한다(`instance.go:332-335`).

세대 선호엔 이런 뜻이다.

| 시도 | 결과 |
|---|---|
| `instance-generation`에 `minValues: 1` | 무의미 — 어차피 최소 1개는 남는다 |
| `instance-generation`에 `minValues: 2` | **역효과** — 8세대 단독 생존을 위반 처리해 7세대를 붙들거나 launch를 포기시킨다 |
| `instance-family`에 큰 `minValues` | spot 다양성엔 정당하지만 세대 선호와 무관 — 8세대 단독 launch를 막는다 |

⇒ **`minValues`는 spot 중단 위험을 낮추려고 후보 다양성을 강제하는 손잡이**다. 세대 선호에 쓸 수 없고, 쓰면 반대 방향으로 작동한다.

## 8. 파드의 `preferred` nodeAffinity가 대안이 아닌 이유

"NodePool로 안 되면 파드에서 하면 되지 않나" — `preferredDuringSchedulingIgnoredDuringExecution`은 Kubernetes 스케줄러에서는 점수 함수지만 **Karpenter는 점수를 매기지 않는다.** 프로비저닝은 "노드를 만들 수 있는가"라는 만족성 문제라 점수를 쓸 자리가 없다. 대신 이렇게 처리한다.

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

**가장 무거운 preferred term 하나를 hard requirement로 승격**해 시뮬레이션하고, 실패하면 바깥 루프가 제약을 하나씩 벗긴다(`scheduling/scheduler.go:521-552`).

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

`--preference-policy`(기본 `Respect`)로 끌 수 있다(`pkg/operator/options/options.go:131`) — `Ignore`면 `NewStrictPodRequirements`가 쓰여 preferred term이 전혀 반영되지 않는다(`scheduler.go:554-560`).

**`instance-generation In ["8"]`을 preferred로 걸면 8세대가 우선 시도되긴 한다** — 그런데 여섯 군데가 어긋난다.

- **파드마다** 걸어야 한다 — NodePool 하나로 끝날 문제가 전체 워크로드로 번지고, 새 팀의 파드는 자동 누락된다.
- 최고 가중치 term **하나만** 승격 · `requirements.go:98-100` — zone·arch 선호가 이미 있다면 세대 선호와 자리를 다툰다.
- 완화 순서 **4번째** · `preferences.go:39-44` — preferred pod affinity/anti-affinity가 먼저 벗겨져 세대 제약까지 라운드가 더 든다.
- 완화 트리거가 **시뮬레이션 실패** · `scheduler.go:543` — 8세대가 아직 unavailable로 안 잡히면 시뮬레이션은 성공하므로, 실제 Insufficient Capacity Error(ICE)를 한 번 맞아야 완화된다 → 폴백 지연([07]({{< relref "07-ice-fallback.md" >}})).
- 토폴로지 요구사항엔 required로 안 잡힘 · [공식 문서](https://karpenter.sh/docs/concepts/scheduling/) — topology spread 워크로드가 의도와 다르게 퍼질 수 있다.
- 정책 하나로 전부 꺼짐 · `options.go:131` — `PREFERENCE_POLICY=Ignore`면 전 워크로드의 세대 선호가 조용히 사라진다.

⇒ **파드 preferred는 "특정 워크로드에만 세대 힌트를 주고 싶다"에는 쓸 만하지만, "클러스터 기본 정책으로 8세대를 우선한다"에는 맞지 않는 도구다.**

## 9. 실전: 원하는 타입이 안 뜰 때 확인 순서

"c8i 전용 풀인데 c7i만 뜬다"를 추적할 때는 이 순서로 좁힌다.

1. **후보에 있나** — `kubectl get nodeclaim <name> -o yaml`의 `instance-type In [...]`에 있는지 본다. 없으면 NodePool `requirements` 자체가 막은 것이다 — `Gte/Lte` hard constraint(§6)나 `minValues` 위반으로 `remaining = nil`(§7)인지 확인한다.
2. **있는데 안 떴다면 EC2 쪽이다** — `checkODFallback` 경고(§3)는 launch를 막지 않으므로 참고만 하고 다음 단계를 본다.
3. **`lowest-price`인지 `prioritized`인지** — `karpenter.sh/price-overlay-applied` 어노테이션이 있으면 오버레이 경로([05]({{< relref "05-generation-preference.md" >}})), 없으면 §3의 `lowest-price`가 그대로 이긴다.
4. **떴다가 사라졌다면** — 절단·필터·CreateFleet이 아니라 [06 consolidation이 되돌리는 것]({{< relref "06-consolidation-traps.md" >}})의 교체 로직이다.

이 네 갈래가 §4 표의 "가격이 결정하는 두 지점"과 대응한다 — 나머지 단계는 후보 필터일 뿐 결정자가 아니다.

## 이 문서에서 가져갈 것

- **스케줄러는 타입을 확정하지 않는다** — NodeClaim엔 후보 이름 집합(`instance-type In [...]`)뿐이고, "어느 것"을 정하는 권한은 클라우드 프로바이더로 내려간다.
- **절단(600/60)은 세대를 자르지 않는다** — 정렬 키가 사이즈에 대해 단조이고, 코어 600 절단은 순서까지 소실돼 좁은 NodePool에서는 no-op이다.
- **8세대가 지는 곳은 두 군데뿐** — CreateFleet의 `lowest-price`(`instance/types.go:244`)와 consolidation의 `launchPrice < maxPrice`(`scheduling/nodeclaim.go:411-419`).
- **단일 NodePool엔 선호를 표현할 필드가 없다** — requirements는 Key/Operator/Values/MinValues 넷뿐, `weight`는 NodePool 레벨에만 있다.
- **잘못 잡은 손잡이 둘** — `minValues`는 다양성 하한이라 오히려 7세대를 붙들고, 파드 `preferred`는 파드 단위 + term 하나 + 완화 4번째 + 실패 후 완화라는 제약을 다 안는다.
- ⇒ **선호를 만들려면 NodePool을 쪼개거나 가격을 왜곡해야 한다** — [05 세대 선호 만들기]({{< relref "05-generation-preference.md" >}}).

## 참고 자료

- 근거 코드 — `kubernetes-sigs/karpenter` **v1.14.0-6-gac7a021e**: `nodeclaimtemplate.go`(후보 → NodeClaim) · `cloudprovider/types.go`(`OrderByPrice`·`Truncate`·`SatisfiesMinValues`) · `nodeclaim.go`(후보 필터) · `scheduling/requirement.go`(연산자 정규화) · `requirements.go`·`preferences.go`(preferred 승격·완화) · `apis/v1/nodeclaim.go`·`crds/karpenter.sh_nodepools.yaml`(스키마·enum)
- `aws/karpenter-provider-aws` `main`(태그 `v1.7.0`·`v1.11.3` 대조): `instance/instance.go`(필터·절단·overlay·`checkODFallback`) · `instance/types.go`(CreateFleet·할당 전략) · `instancetype/types.go`(세대 라벨 정규식) · `apis/v1/labels.go`(well-known 라벨)
- [Karpenter Scheduling 개념 문서](https://karpenter.sh/docs/concepts/scheduling/) — well-known 라벨 표, Gte/Lte 확장, preferred affinity와 topology 요구사항의 관계
- [EC2 `FleetLaunchTemplateOverridesRequest`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_FleetLaunchTemplateOverridesRequest.html) — §3의 소수점 `Priority` 확인 필요 항목의 출처
- 같은 클러스터군의 업그레이드 기록: [Karpenter 0.36.2 → 1.14.0 (v1beta1 → v1 CRD)]({{< relref "../../eks-upgrade/components/01-karpenter.md" >}})

{{< callout type="warning" >}}
**이 문서에서 실측으로 확인해야 할 것**
- **소수점 `Priority` 해석** — `prioritized` 전략에서 1달러 미만 가격이 정수 절삭되는지. 오버레이 경로를 쓴다면 실제로 어떤 패밀리가 뜨는지 직접 확인해야 한다(§3).
- **코어 `MaxInstanceTypes=600`의 조정 수단** — 선언이 `var`인데(테스트용으로 의도적으로 `var`라는 주석이 있다) 이를 노출하는 CLI 플래그·환경변수를 코드에서 찾지 못했다. 운영 중 조정이 필요하면 배포 버전에서 재확인할 것(§2).
- **8세대와 7세대의 실제 가격 대소** — 이 문서의 모든 서술은 "알고리즘이 가격만 본다"는 사실에 근거하며, 8세대가 항상 더 비싸다고 단정하지 않는다. 리전·AZ·할인 상황에 따라 역전 구간이 있을 수 있으므로 대상 리전에서 확인할 것.
{{< /callout >}}
