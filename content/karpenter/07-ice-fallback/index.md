---
title: "용량이 없을 때 — ICE와 폴백 지연"
weight: 7
aliases: ["/k8s-features/karpenter/04-ice-fallback/"]
---

# 07 · 용량이 없을 때 — ICE와 폴백 지연

{{< callout type="info" >}}
- 폴백은 이미 공짜입니다. 8세대가 Insufficient Capacity Error(ICE, AWS 응답 코드 `InsufficientInstanceCapacity`)를 내는 순간 provider-aws가 그 오퍼링을 unavailable로 마킹하고 코어는 `Offerings.Available()`에서 그 오퍼링을 걸러 다음 루프의 후보에서 뺍니다. 손으로 만들어야 하는 건 "평소엔 8세대"라는 상향 강제뿐입니다.
- 코어는 ICE 난 NodeClaim을 지우고 재큐하지 않습니다. `err`를 반환하지도 않으니 controller-runtime 백오프도 안 붙습니다. 재시도는 파드 컨트롤러의 10초 재큐 + 배치창(idle 1s / max 10s)뿐이고 실측 기대치는 대략 11~30초입니다.
- ICE 캐시는 3분입니다. 키는 `<capacityType>:<instanceType>:<zone>`. 부족이 지속되면 3분 주기로 실패 왕복이 반복됩니다. 거꾸로 용량이 회복되면 최대 3분 뒤 8세대가 저절로 부활합니다. 사람이 할 일은 없습니다.
- 가용성 판정 축은 셋입니다. `IsUnavailable()`이 보는 것은 오퍼링 캐시 ∨ capacity-type 전체 차단 캐시 ∨ 전 서브넷 차단 캐시의 OR입니다. 서브넷 IP 고갈은 인스턴스 타입과 무관하게 오퍼링을 죽입니다.
- spot을 섞으면 세대 강제가 무력화됩니다. capacity-type 우선순위가 `reserved > spot > on-demand`인데다 spot Fleet은 `price-capacity-optimized`라 EC2가 용량 깊이로 타입을 고릅니다. 세대 선호가 목적이면 on-demand로 한정하십시오.
- 단일 NodePool 안에서 알파 없이 8세대를 1순위로 만드는 길은 On-Demand Capacity Reservation(ODCR)입니다. reserved 오퍼링 가격이 `odPrice / 10,000,000`이라 정렬·절단·Fleet 전부에서 무조건 앞섭니다. 게이트 `ReservedCapacity`는 기본 ON(BETA)입니다.
{{< /callout >}}

"8세대(c8i/m8i/r8i)가 부족하면 7세대로 폴백하고 싶다"에서 폴백 쪽은 이미 동작합니다. ICE를 오퍼링 가용성으로 환산해 스케줄링에 되먹이는 배선이 코어와 provider-aws에 완비돼 있습니다. 이 문서는 그 폴백이 어느 코드에서 몇 초 만에 일어나는지를 끝까지 내려가 01~03에서 고른 구성이 ICE 상황에서 어떻게 행동하는지 확정합니다.

> 자매 문서: [개요]({{< relref "_index.md" >}}) · [04 인스턴스 선택]({{< relref "04-instance-selection.md" >}}) · [05 세대 선호]({{< relref "05-generation-preference.md" >}}) · [06 consolidation 함정]({{< relref "06-consolidation-traps.md" >}}) · [K8s 버전별 신기능]({{< relref "../../k8s-features/_index.md" >}}) · [eks-upgrade 01 Karpenter]({{< relref "../../eks-upgrade/components/01-karpenter.md" >}})

**검증 기준 버전**: 코어 `kubernetes-sigs/karpenter` **v1.14.0-6-gac7a021e**(로컬 체크아웃), provider-aws는 `main` / `v1.7.0` / `v1.11.3`. 별도 표기가 없는 provider-aws 인용은 `main` 기준입니다. 코어 라인번호는 v1.14 기준이라 실제 배포판과 몇 줄 어긋날 수 있습니다.

## 1. 폴백은 이미 공짜다

사람이 개입할 지점은 이 경로 어디에도 없습니다. ICE 한 번이 스케줄링에 반영되기까지 거치는 홉은 네 개입니다.

- ① provider-aws — `CreateFleet` 응답의 `Errors`에서 `IsUnfulfillableCapacity`면 `MarkUnavailable(...)` (`pkg/providers/instance/instance.go` `updateUnavailableOfferingsCache()`)
- ② 캐시 — 오퍼링 캐시에 3분 TTL로 넣고 그 인스턴스 타입의 `offeringCacheSeqNum`을 증가 (`pkg/cache/unavailableofferings.go`)
- ③ 오퍼링 해석 — seqNum이 바뀌었으므로 캐시된 오퍼링을 못 쓰고 재계산해 `isUnavailable`을 다시 반영 (`pkg/providers/instancetype/offering/base_resolver.go:101`)
- ④ 코어 — `Offerings.Available()`가 빈 셋이 되면 `fits()`의 `hasOffering`이 false → 그 인스턴스 타입이 후보에서 제거 (`pkg/cloudprovider/types.go` · `scheduling/nodeclaim.go`)

이 사슬 중간에 캐시 만료를 기다리는 구간은 없습니다. 프로비저닝 루프가 매 루프마다 `cloudProvider.GetInstanceTypes()`를 새로 호출하므로(`pkg/controllers/provisioning/provisioner.go`) 다음 루프가 곧바로 갱신된 가용성을 봅니다.

"7세대 폴백"은 구성과 무관하게 성립합니다. 구성이 정하는 것은 성립 여부가 아니라 "몇 초 걸리느냐"(아래 §2~§4)와 "폴백 전에 8세대를 시도하기는 하느냐"([04]({{< relref "04-instance-selection.md" >}})·[05]({{< relref "05-generation-preference.md" >}})의 주제)입니다.

## 2. ICE가 나면 코어는 NodeClaim을 지운다

`CloudProvider.Create()`가 `InsufficientCapacityError`로 실패했을 때 코어가 하는 일은 짧습니다.

```go
// pkg/controllers/nodeclaim/lifecycle/launch.go — launchNodeClaim()
case cloudprovider.IsInsufficientCapacityError(err):
	l.recorder.Publish(InsufficientCapacityErrorEvent(nodeClaim, err))
	log.FromContext(ctx).Error(err, "failed launching nodeclaim")

	if err = l.kubeClient.Delete(ctx, nodeClaim); err != nil {
		return nil, client.IgnoreNotFound(err)
	}
	metrics.NodeClaimsDisruptedTotal.Inc(map[string]string{
		metrics.ReasonLabel:       "insufficient_capacity",
		metrics.NodePoolLabel:     nodeClaim.Labels[v1.NodePoolLabelKey],
		metrics.CapacityTypeLabel: nodeClaim.Labels[v1.CapacityTypeLabelKey],
	})
	return nil, nil
```

이벤트 · 로그 · 메트릭 · 삭제. 재시도는 없습니다. 호출부의 반환 `err`가 `nil`이라 controller-runtime의 지수 백오프조차 걸리지 않습니다.

그러니 다시 시도를 만드는 주체는 파드입니다. `Trigger()` 호출부 네 곳 중 NodeClaim 삭제를 프로비저너에 알리는 경로가 없어 파드 컨트롤러의 주기 재큐가 유일한 복구 장치로 남습니다.

```go
// pkg/controllers/provisioning/controller.go — PodController.Reconcile()
return reconcile.Result{RequeueAfter: 10 * time.Second}, nil
```

배치창(`BATCH_IDLE_DURATION` 기본 1초 / `BATCH_MAX_DURATION` 기본 10초, `pkg/operator/options/options.go`)이 여기에 더 붙어 코어 측 대기만 11~20초가 됩니다. `CreateFleet` 왕복과 컨트롤러 처리 시간까지 더하면 실측 기대치는 대략 11~30초입니다.

{{< seq src="_seq/2-ice-가-나면-코어는.json" />}}

이 경로에는 갈림길이 둘 있습니다.

(a) `CreateFleet`을 한 번도 부르지 않고 ICE가 나는 경로가 따로 있습니다. provider-aws는 런치 직전 필터 체인을 돌립니다. 어느 필터에서든 남는 인스턴스 타입이 0이 되면 API 호출 없이 즉시 ICE를 반환합니다.

```go
// pkg/providers/instance/instance.go — filterInstanceTypes()
remaining, rejected := filter.FilterReject(instanceTypes)
if len(remaining) == 0 {
	return nil, cloudprovider.NewInsufficientCapacityError(
		fmt.Errorf("all requested instance types were unavailable during launch"))
}
```

ICE 캐시가 이미 채워진 뒤의 재시도가 바로 이 경로입니다. `CreateFleet` 실패 왕복은 첫 실패에만 있고 두 번째부터는 EC2를 때리지 않습니다.

(b) fleet 에러 전부가 "ICE로 집계되는 에러"일 때만 위 삭제 경로를 탑니다. `combineFleetErrors()`는 순수 ICE만 세지 않습니다. spot service-linked role 생성 불가(`IsServiceLinkedRoleCreationNotPermitted`, §3 `capacityTypeCache`를 채우는 그 에러)도 함께 셉니다(`pkg/providers/instance/instance.go:798-803`). 다른 에러가 하나라도 섞이면 `CreateError`로 분류돼 NodeClaim이 삭제되지 않고 `Launched=Unknown`으로 남아 컨트롤러 백오프를 탑니다. 폴백이 느려지고 `disrupted_total`에도 안 잡힙니다. §8에서 메트릭으로 먼저 확인해야 하는 이유입니다.

## 3. ICE 캐시 — 3분, 그리고 세 개의 축

시간 상수는 provider-aws `pkg/cache/cache.go`에 있습니다.

```go
UnavailableOfferingsTTL             = 3 * time.Minute
UnavailableOfferingsCleanupInterval = time.Second * 10
```

실무에서 자주 어긋나는 지점은 이 캐시의 입도입니다. 키 포맷이 `<capacityType>:<instanceType>:<zone>`, 곧 리전이나 패밀리 단위가 아니라 (capacity-type, 인스턴스 타입, AZ) 조합 단위입니다. `c8i.2xlarge`가 `ap-northeast-2a`에서 ICE를 냈다고 `c8i.4xlarge`나 다른 AZ의 `c8i.2xlarge`가 막히지는 않습니다.

가용성 판정은 이 캐시 하나로 끝나지 않습니다. `IsUnavailable()`은 세 축의 OR입니다(아래는 provider-aws `main` 기준).

```go
// pkg/cache/unavailableofferings.go
func (u *UnavailableOfferings) IsUnavailable(instanceType ec2types.InstanceType, zone string,
	subnetIDs []string, capacityType string, opts ...UnavailableOfferingsOption) bool {
	_, offeringFound := u.offeringCache.Get(u.key(instanceType, zone, capacityType, opts...))
	_, capacityTypeFound := u.capacityTypeCache.Get(capacityType)
	allSubnetsUnavailable := lo.EveryBy(subnetIDs, func(subnetID string) bool {
		_, found := u.subnetCache.Get(subnetID)
		return found
	})
	return offeringFound || capacityTypeFound || (allSubnetsUnavailable && len(subnetIDs) != 0)
}
```

| 축 | 무엇이 채우나 |
|---|---|
| `offeringCache` | `CreateFleet` 응답의 ICE 에러 |
| `capacityTypeCache` | spot service-linked role 생성 불가 → `MarkCapacityTypeUnavailable(spot)` |
| `subnetCache` | 서브넷 IP 고갈(`IsInsufficientFreeAddressesInSubnet`) → `MarkSubnetUnavailable` |

차단 범위는 축마다 다릅니다.

- offeringCache · (capacity-type, 인스턴스 타입, AZ) 하나만 막습니다.
- capacityTypeCache · 해당 capacity-type 전체를 막습니다. spot이 통째로 3분간 사라집니다.
- subnetCache · 그 오퍼링의 모든 서브넷이 캐시에 있으면 차단합니다. 인스턴스 타입과 무관합니다.

> **구버전 주의.** provider-aws `v1.7.0`·`v1.11.3`에서는 세 번째 캐시가 `subnetCache`가 아니라 `azCache`입니다 — 서브넷 IP 고갈 시 `MarkAZUnavailable(zone)`으로 AZ 전체가 3분간 차단됩니다. 배포 버전이 v1.11.x 이하라면 차단 범위를 AZ 단위로 읽어야 합니다.

헷갈리는 쪽은 늘 세 번째 축입니다. "8세대가 안 뜬다"의 원인이 실제로는 서브넷 IP 고갈일 수 있습니다. 그렇다면 7세대로 폴백해도 똑같이 막힙니다. 세대 문제가 아니라 VPC 문제입니다.

3분 TTL이 운영에서 만드는 결과는 이렇습니다.

- 부족이 지속되면 3분 주기로 실패 왕복이 반복됩니다. TTL 만료 → 8세대가 다시 후보 → `CreateFleet` → ICE → 삭제 → 재큐. 이벤트 스팸과 `disrupted_total` 증가가 보이면 대부분 이 상태입니다.
- 반대로 용량이 회복되면 최대 3분 뒤 8세대가 저절로 부활합니다. 사람 개입은 필요 없습니다. 부활하는 건 **앞으로 뜰 노드**입니다. 이미 떠 있는 7세대 노드가 8세대로 교체되지는 않습니다. 그쪽은 [06]({{< relref "06-consolidation-traps.md" >}})의 주제입니다. consolidation은 더 싼 방향으로만 움직이므로 자동 복귀 경로가 없습니다.

AZ를 하나로 묶는 토폴로지 제약(zone 고정 PVC 등)이 걸려 있으면 앞의 반복 실패가 심해집니다. 다른 AZ의 8세대가 멀쩡해도 그 AZ에서만 3분마다 실패가 되풀이됩니다.

## 4. 구성별로 폴백은 어디서 일어나는가

01~03에서 다룬 세 구성이 ICE 상황에서 어떻게 달라지는지 나란히 놓습니다.

**A. 단일 NodePool (8+7 혼재)**

| 항목 | 내용 |
|---|---|
| 평상시 무엇이 뜨나 | **7세대.** 가격 오름차순 후보 + Fleet `lowest-price` |
| 대체가 결정되는 지점 | 없음 — 애초에 8세대를 안 고른다 |
| 첫 폴백 지연 | 해당 없음 |
| ICE 캐시 유효한 3분 동안 | 해당 없음 |
| 주요 함정 | 사용자의 요구를 아예 만족 못 함 |
| 8세대 복귀 | 해당 없음 |

**B. NodePool 분리 + `weight`**

| 항목 | 내용 |
|---|---|
| 평상시 무엇이 뜨나 | **8세대.** 상위 weight 템플릿의 성공이 채택된다 |
| 대체가 결정되는 지점 | **코어 스케줄러** — 8세대 풀이 실패해야 7세대 풀 채택 |
| 첫 폴백 지연 | `CreateFleet` ICE 1회 + 재큐 10초 + 배치창 1~10초 = **대략 11~30초** |
| ICE 캐시 유효한 3분 동안 | 8세대 오퍼링이 `Available()`에서 빠져 **`CreateFleet` 호출 없이** 즉시 7세대 |
| 주요 함정 | 8세대 오퍼링이 **일부만** 마킹되면 8세대 풀이 계속 "가용"으로 보여 왕복이 반복된다 |
| 8세대 복귀 | 없음 — `expireAfter`/drift에 의존 |

**C. 단일 NodePool + NodeOverlay**

| 항목 | 내용 |
|---|---|
| 평상시 무엇이 뜨나 | **8세대(의도).** 오버레이가 7세대 가격을 부풀려 정렬을 뒤집는다 |
| 대체가 결정되는 지점 | **EC2 Fleet** — `prioritized` 전략이 Priority 순으로 흘러내림 (**확인 필요**) |
| 첫 폴백 지연 | 이론상 같은 API 호출 안, 추가 지연 0 (**확인 필요**) |
| ICE 캐시 유효한 3분 동안 | 동일 — 8세대 오버라이드 자체가 후보에서 빠진다 |
| 주요 함정 | 페널티 과다 시 60개 절단으로 7세대가 잘려 **폴백 후보 자체가 사라진다** |
| 8세대 복귀 | 오버레이 가격이 consolidation 후보 가격 산정에도 쓰여 복귀 여지가 있다 (**확인 필요**) |

B의 평가 방식을 오해하지 마십시오. 채택 규칙은 성공한 것 중 인덱스가 가장 앞선(=weight가 가장 높은) 결과입니다(`scheduling/scheduler.go:759`). "먼저 시도하고 실패하면 내려간다"는 순차 short-circuit이 아닙니다.

그렇다고 "모든 템플릿이 매 루프 평가된다"는 뜻도 아닙니다. 워커 수가 `ceil(CPURequests/1000)`(`provisioner.go:390`)이라 컨트롤러 CPU request가 1코어 미만이면 워커는 1개뿐입니다. 인덱스 0(8세대)이 성공하는 순간 `parallelizeUntil`이 멈춰(`scheduler.go:780`) 7세대 템플릿은 평가조차 되지 않습니다(워커 종료 로직 `scheduler.go:939-961`). 자세한 것은 [05 §1.2]({{< relref "05-generation-preference.md" >}}).

여기서 말하는 8세대 풀의 "실패"가 ICE만 뜻하지도 않습니다. §1의 ICE는 오퍼링 전멸만 만들고 NodePool limits 소진(`scheduler.go:709-718`)·`minValues` 불충족·파드 요구사항 비호환도 용량과 무관하게 같은 폴백을 일으킵니다([06]({{< relref "06-consolidation-traps.md" >}}) §3).

B의 왕복 반복도 같은 곳에서 나옵니다. ICE 캐시가 (타입, AZ, capacity-type) 단위인데 8세대 풀엔 보통 수십 개 조합이 있어 몇 개만 마킹돼도 나머지로 계속 스케줄에 성공합니다. 범위를 좁게 잡을수록 한 번의 ICE로 풀 전체가 무력화돼 폴백이 빨라집니다. 넓게 잡는 게 항상 좋지는 않습니다.

C의 "지연 0초"는 확정 사실이 아닙니다. 오버레이를 적용하면 provider-aws가 할당 전략을 `prioritized`로 바꿉니다. `Priority`를 정수로 규정하는 AWS API에 Karpenter는 소수 달러값을 그대로 넣습니다. 정수 절단이 일어나면 시간당 $1 미만 인스턴스가 전부 priority 0이 되어 세대 선호가 아무 경고 없이 무력화될 수 있습니다. 코드로도 문서로도 확정할 수 없어 확인 필요로 남깁니다. C를 도입한다면 실제로 어떤 패밀리가 뜨는지 실측이 필수입니다. 자세한 것은 [05]({{< relref "05-generation-preference.md" >}})에 있습니다.

## 5. spot을 섞는 순간 논의가 바뀐다

여기까지의 모든 서술에는 on-demand 전제가 깔려 있습니다. capacity-type이 섞이는 순간 인스턴스 선택의 주체가 바뀌기 때문입니다.

```go
// pkg/providers/instance/instance.go
// getCapacityType selects the capacity type based on the flexibility of the NodeClaim and the available offerings.
// Prioritization is as follows: reserved, spot, on-demand.
func getCapacityType(nodeClaim *karpv1.NodeClaim, instanceTypes []*cloudprovider.InstanceType) string {
	for _, capacityType := range []string{karpv1.CapacityTypeReserved, karpv1.CapacityTypeSpot} {
		requirements := scheduling.NewNodeSelectorRequirementsWithMinValues(nodeClaim.Spec.Requirements...)
		if !requirements.Get(karpv1.CapacityTypeLabelKey).Has(capacityType) {
			continue
		}
		requirements[karpv1.CapacityTypeLabelKey] = scheduling.NewRequirement(karpv1.CapacityTypeLabelKey, corev1.NodeSelectorOpIn, capacityType)
		for _, it := range instanceTypes {
			if len(it.Offerings.Available().Compatible(requirements)) != 0 {
				return capacityType
			}
		}
	}
	return karpv1.CapacityTypeOnDemand
}
```

허용된 요구사항에 가용 오퍼링이 있으면 reserved → spot → on-demand 순으로 내려갑니다. 예약 소진이나 spot ICE 전멸 시 `Available()`가 비어 자동으로 다음 단계로 내려가니 폴백에는 좋습니다. 세대 강제로 보면 치명적입니다.

{{< flow src="_flow/5-spot-을-섞는-순간.json" />}}

spot에서는 어떤 방법으로도 세대 우선이 보장되지 않습니다. 기본 전략인 `price-capacity-optimized`부터가 EC2더러 용량 깊이를 먼저 보고 가격을 그다음으로 보라고 시킵니다. 오버레이(구성 C)를 걸어도 spot 전략은 `capacity-optimized-prioritized`로 바뀔 뿐인데 AWS 문서상 이 전략은 우선순위를 best-effort로만 존중합니다.

트레이드오프는 정직합니다.

| | ICE 내성 | 세대 강제 |
|---|---|---|
| spot | **좋음** — EC2가 용량 깊은 풀을 고르므로 ICE 자체가 덜 난다 | **불가** — 선택 주체가 EC2고 우선순위는 best-effort |
| on-demand | 보통 — ICE가 나면 §2의 왕복을 탄다 | **가능** — weight(B) 또는 오버레이(C)로 표현 가능 |
| reserved | **최상** — 예약분은 정의상 확보돼 있다 | **가능** — §6 |

이 챕터의 목표가 "평소엔 8세대"라면 답은 하나뿐입니다. on-demand 전용 NodePool과 spot NodePool을 분리하고 세대 선호는 on-demand 쪽에만 겁니다. 한 NodePool에 둘을 섞어 두면 `getCapacityType`이 spot을 먼저 고르는 순간 weight도 오버레이도 의미를 잃습니다.

## 6. ODCR — 알파 없이 8세대를 1순위로 만드는 길

`ReservedCapacity` 게이트로 활성화되는 reserved 오퍼링의 가격 산정이 이 절의 전부입니다.

```go
// pkg/providers/instancetype/offering/reserved_capacity_resolver.go
if odPrice, ok := r.PricingProvider.OnDemandPrice(ec2types.InstanceType(it.Name)); ok {
	// Divide the on-demand price by a sufficiently large constant. This allows us to treat the
	// reservation as "free", while maintaining relative ordering for consolidation. ...
	price = odPrice / 10_000_000.0
}
```

가격이 사실상 0이니 `OrderByPrice`·`Truncate`(600 → 60)·EC2 Fleet `lowest-price` 세 관문을 전부 무조건 통과합니다. 8세대에 ODCR을 잡아두면 8세대가 7세대보다 싸게 보이므로 알파 기능도 NodePool 분리도 필요 없습니다. 01의 "싼 게 이긴다" 성질이 여기서는 유리하게 작용합니다.

게이트는 기본으로 켜져 있습니다. `FEATURE_GATES` 기본값은 `ReservedCapacity=true`이고 `NodeOverlay`는 명시적으로 `false`입니다(`pkg/operator/options/options.go`).

폴백도 자연스럽게 딸려옵니다. §5에서 본 대로 `getCapacityType`은 가용한 reserved 오퍼링이 있을 때만 reserved를 고릅니다. 예약분이 차면 on-demand로 내려가고 거기서 다시 ICE가 나면 §2의 왕복을 타고 7세대까지 내려갑니다. "예약 → 온디맨드 8세대 → 온디맨드 7세대" 3단 폴백이 GA 기능만으로 성립합니다.

예약과 weight를 같이 쓸 때는 코어가 특별 취급을 합니다.

```go
// pkg/controllers/provisioning/scheduling/scheduler.go
// If the pod is compatible with a NodePool with reserved offerings available, we shouldn't fall back
// to a NodePool with a lower weight. ...
if IsReservedOfferingError(err) { … idx = i; return false }
```

예약 오퍼링 확보에 실패한 경우 코어는 하위 weight NodePool의 성공 결과를 채택하지 않습니다. 8세대 풀이 예약 슬롯 경합에 지면 7세대로 내려가는 대신 그 루프를 통째로 포기하고 다음 루프를 기다립니다. [05]({{< relref "05-generation-preference.md" >}}) weight 구성과 겹칠 때 실제 지연은 확인이 필요합니다(코드 경로만 확인했고 재현 실험은 하지 않았습니다).

{{< callout type="warning" >}}
EC2NodeClass 쪽 필드는 직접 확인하십시오. provider-aws는 `nodeClass.CapacityReservations()`로 예약 목록을 읽어 reserved 오퍼링을 만듭니다(`reserved_capacity_resolver.go`). 그 목록을 채우는 EC2NodeClass의 셀렉터 필드명과 스키마는 이 조사에서 확인하지 못했습니다. 로컬에 provider-aws의 `pkg/apis/v1` EC2NodeClass 타입 정의 사본이 없습니다. 쓰기 전에 `kubectl explain ec2nodeclass.spec`으로 사용 중인 버전의 필드를 확인하십시오. ODCR은 예약해 둔 시간만큼 돈이 나갑니다 — 알파 회피의 대가는 비용입니다.
{{< /callout >}}

## 7. 런치는 됐는데 등록이 안 될 때 — `NodeRegistrationHealthy`

§1~§6이 다룬 것은 전부 런치가 거부되는 실패였습니다. 런치가 성공한 뒤 노드가 클러스터에 조인하지 못하는 쪽은 성질이 완전히 다릅니다. RFC가 드는 대표 원인은 클러스터 security group의 outbound 규칙 누락입니다(`designs/noderegistrationhealthy-status-condition.md`).

결정적 차이가 하나 있습니다. 오퍼링이 마킹되지 않습니다.

| | ICE (§2) | 등록 실패 |
|---|---|---|
| 어디서 실패 | `CreateFleet` 호출 | 노드 부팅 후 kubelet 조인 |
| 오퍼링 마킹 | `MarkUnavailable` → 후보에서 제외 | **없음** — 오퍼링은 계속 available |
| 다음 사이클 | 다른 조합으로 넘어감 | **같은 조합을 다시 시도** |
| 폴백 | 자동 | **안 걸린다** |

그래서 8세대 풀에서 노드가 뜨는데 등록이 안 되면 §3·§4의 폴백 어느 것도 구제하지 못합니다. 캐시는 비어 있고 8세대 풀은 스케줄 시뮬레이션에 계속 성공하니 7세대 풀 결과가 채택될 이유가 없습니다. 겉으로 남는 증상은 노드가 주기적으로 뜨고 사라지는 것뿐입니다.

### 7.1 3상태

`ConditionTypeNodeRegistrationHealthy`(`pkg/apis/v1/nodepool_status.go:31`)는 3상태입니다.

| 상태 | 언제 | 코드 |
|---|---|---|
| `Unknown` | NodePool 최초 생성, 또는 NodePool·NodeClass generation 변경 | `registrationhealth/controller.go:92-97` |
| `True` | 이 NodePool·NodeClass 조합으로 등록이 성공 | `nodeclaim/lifecycle/registration.go:192` |
| `False` | 등록 실패가 임계를 넘음 | `nodeclaim/lifecycle/liveness.go:128`, `:131-135` |

`False`의 reason은 둘로 나뉩니다. 등록 타임아웃이면 `RegistrationFailed` / `"Failed to register node"`(`liveness.go:132`)이고 런치 자체가 실패했으면 NodeClaim의 `Launched` condition reason·message를 그대로 옮깁니다(`:134`).

### 7.2 판정 — 링버퍼 4칸

`03-keyword-reference`가 "관찰용"이라 적은 그 조건의 판정 근거는 컨디션이 아니라 인메모리 링버퍼입니다(`pkg/state/nodepoolhealth/tracker.go`).

```go
// pkg/state/nodepoolhealth/tracker.go:28-29
BufferSize     = 4
ThresholdFalse = 0.5 // 50% of 0s for NodeRegistrationHealthy=False
```

- `Status()`는 `unhealthyCount / BufferSize >= ThresholdFalse`면 `StatusUnhealthy`, 버퍼가 비어 있으면 `Unknown`입니다(`:69-84`). 최근 4회 중 2회 실패면 `False`입니다.
- 링버퍼는 꽉 차면 가장 오래된 칸을 덮습니다(`pkg/utils/ringbuffer/buffer.go:30-39`). `[false, false]`에서 `True`로 돌아오려면 성공이 3회 쌓여야 합니다. 2회까지는 `2/4 = 0.5`로 여전히 Unhealthy입니다.

`False`까지 걸리는 시간은 등록 타임아웃 경로가 `registrationTimeout = 15분`(`liveness.go:52`), 런치 타임아웃이 `5분`(`:59`)입니다. 실패가 2회 쌓여야 하므로 30분 이상이 됩니다. 즉시 알려 주는 신호가 아닙니다.

### 7.3 재시작은 상태를 보존한다

재시작이 상태를 초기화한다는 것은 흔한 오해입니다. 재시작으로 버퍼가 비면 기존 컨디션 값으로 재수화합니다(`registrationhealth/controller.go:82-89`, `tracker.go:94-101`). `Unknown`으로 되돌리는 것은 generation 변경뿐입니다(`controller.go:92-97`). NodePool 또는 NodeClass generation이 컨디션의 `ObservedGeneration`과 달라질 때입니다.

### 7.4 신호이지 가드가 아니다

{{< callout type="warning" >}}
`NodeRegistrationHealthy=False`인 NodePool도 프로비저닝에 계속 쓰입니다. RFC가 명시합니다. "A NodePool marked with `NodeRegistrationHealthy: False` can still be used for provisioning workloads, as this status isn't a precondition for readiness."

§8의 `"ignoring nodepool, not ready"`(NodeClass 오류)와 달리 풀이 후보에서 빠지지 않습니다. 알람은 사람이 걸어야 합니다.
{{< /callout >}}

부작용도 하나 있습니다. 파드가 스케줄된 NodePool이 `NodeRegistrationHealthy=true`일 때만 스케줄 시각을 기록하고(`state/cluster.go:513-516`) 아니면 지웁니다(`:517-521`). 등록이 한 번도 성공하지 않은 풀의 파드는 바인딩/ready 메트릭에서 빠집니다. 메트릭이 조용해지는 것 자체가 신호입니다.

```bash
kubectl get nodepool -o custom-columns=\
'NAME:.metadata.name,REG:.status.conditions[?(@.type=="NodeRegistrationHealthy")].status,\
REASON:.status.conditions[?(@.type=="NodeRegistrationHealthy")].reason'
```

## 8. 지금 ICE가 나고 있는지 아는 법

NodeClaim에는 흔적이 남지 않습니다. §2처럼 코어가 ICE 난 NodeClaim을 즉시 삭제하므로 `kubectl get nodeclaim`으로는 아무것도 못 봅니다. 이벤트마저 오브젝트와 함께 정리될 수 있어 지속적으로 남는 유일한 신호는 메트릭입니다.

```bash
# ① 메트릭 — 유일하게 사라지지 않는 신호
karpenter_nodeclaims_disrupted_total{reason="insufficient_capacity"}
#   라벨: reason · nodepool · capacity_type (pkg/metrics/metrics.go)
#   nodepool 라벨로 "8세대 풀만 오르고 있는지"를 바로 구분할 수 있다

# ② 이벤트 — 짧은 창이지만 인스턴스 타입/AZ가 메시지에 들어 있다
kubectl get events -A --field-selector reason=InsufficientCapacityError \
  --sort-by=.lastTimestamp

# ③ 로그 — ICE 그 자체
kubectl logs -n kube-system -l app.kubernetes.io/name=karpenter \
  | grep "failed launching nodeclaim"

# ④ 로그 — 8세대 풀이 "조용히" 사라지는 경로
#    ICE 마킹으로 오퍼링이 전멸하면 여기로 나온다
kubectl logs -n kube-system -l app.kubernetes.io/name=karpenter \
  | grep "skipping, nodepool requirements filtered out all instance types"

# ⑤ 로그 — NodeClass 오류로 풀이 통째로 빠지는 경우 (ICE가 아니다)
kubectl logs -n kube-system -l app.kubernetes.io/name=karpenter \
  | grep "ignoring nodepool, not ready"
```

읽는 법은 이렇습니다.

- `disrupted_total{insufficient_capacity}`가 3분 주기로 계단식 증가 — TTL 만료 → 재시도 → 재실패 루프(§3)가 도는 8세대 부족 지속 상태입니다. → 타입 범위를 좁혀 왕복 빈도를 낮추거나 ODCR로 예약을 확보합니다.
- 이벤트는 나는데 `disrupted_total`이 안 오름 — ICE가 아닌 에러가 섞여 `CreateError` 경로를 탄 것입니다(§2-b, 서브넷 IP 고갈·런치 템플릿 문제 의심). → NodeClaim `Launched` reason과 §3 `subnetCache`를 확인합니다.
- ④번 로그가 8세대 풀에만 반복 — 오퍼링 전멸로 그 풀이 후보에서 빠진 것 = 폴백 정상 동작. → 7세대 노드 비율만 추적합니다.
- ⑤번 로그 — EC2NodeClass가 Ready가 아니라 풀이 통째로 제외된 것 — ICE와 무관합니다. → NodeClass 상태를 먼저 고칩니다.
- NodePool별 노드 수에서 gen7 비중이 튐 — ICE가 지속됐거나 한 번 내려간 뒤 복귀하지 못한 상태입니다. → [06]({{< relref "06-consolidation-traps.md" >}})의 `expireAfter` 절을 참고합니다.
- 노드가 뜨고 사라지길 반복하는데 `disrupted_total{insufficient_capacity}`는 그대로 — 8세대 풀에서 며칠째 이 패턴이면 ICE가 아니라 §7의 등록 실패일 가능성이 큽니다. 오퍼링이 마킹되지 않아 메트릭도 이벤트도 오르지 않는 것이 계단식 증가와의 결정적 차입니다. → `NodeRegistrationHealthy` 컨디션과 kubelet 조인 로그를 확인합니다.

마지막 줄이 이 문서와 03을 잇는 대목입니다. ICE 폴백은 "다음에 뜰 노드"만 바꿉니다. 3분 뒤 8세대가 후보로 돌아와도 그 사이 떠버린 7세대 노드는 그대로 남습니다. consolidation은 더 싼 방향으로만 움직이니 스스로 되돌아오지도 않습니다. 폴백이 공짜인 것과 복귀가 공짜인 것은 전혀 다른 얘기입니다.
