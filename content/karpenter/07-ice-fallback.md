---
title: "용량이 없을 때 — ICE와 폴백 지연"
weight: 7
aliases: ["/k8s-features/karpenter/04-ice-fallback/"]
---

# 07 · 용량이 없을 때 — ICE와 폴백 지연

{{< callout type="info" >}}
**한눈에**
- **폴백은 이미 공짜다.** 8세대가 ICE(InsufficientInstanceCapacity)를 내면 provider-aws가 그 오퍼링을 unavailable로 마킹하고, 코어가 `Offerings.Available()`에서 걸러 다음 루프의 후보에서 자동으로 뺀다. 만들어야 하는 건 폴백이 아니라 **"평소엔 8세대"라는 상향 강제**뿐이다.
- **코어는 ICE 난 NodeClaim을 지우고 재큐하지 않는다.** `err`조차 반환하지 않아 controller-runtime 백오프도 안 붙는다. 재시도를 되살리는 건 오직 **파드 컨트롤러의 10초 재큐 + 배치창(idle 1s / max 10s)** — 실측 기대치는 **대략 11~30초**다.
- **ICE 캐시는 3분이다.** 키는 `<capacityType>:<instanceType>:<zone>`. 함의가 둘: 부족이 지속되면 **3분 주기로 실패 왕복이 반복**되고, 반대로 **용량이 회복되면 최대 3분 뒤 8세대가 저절로 부활**한다 — 사람이 할 일은 없다.
- **가용성 판정 축은 오퍼링 하나가 아니라 셋이다.** `IsUnavailable()`은 오퍼링 캐시 ∨ **capacity-type 전체 차단 캐시** ∨ **전 서브넷 차단 캐시**의 OR다. 서브넷 IP 고갈은 인스턴스 타입과 무관하게 오퍼링을 죽인다.
- **spot을 섞으면 세대 강제가 무력화된다.** capacity-type 우선순위가 `reserved > spot > on-demand`고, spot Fleet은 `price-capacity-optimized`라 **EC2가 용량 깊이로 타입을 고른다.** 세대 선호가 목적이면 on-demand로 한정하라.
- **단일 NodePool 안에서 알파 없이 8세대를 1순위로 만드는 길은 ODCR이다.** reserved 오퍼링 가격이 `odPrice / 10,000,000`이라 정렬·절단·Fleet 전부에서 무조건 앞선다. 게이트 `ReservedCapacity`는 **기본 ON(BETA)**.
{{< /callout >}}

> **원래 전제부터 확인한다.** 이 챕터의 출발점은 "8세대(c8i/m8i/r8i)는 용량이 부족할 수 있으니 7세대를 폴백으로 넣고 싶다"였다. 그런데 폴백 쪽은 이미 동작한다 — 코어와 provider-aws가 ICE를 오퍼링 가용성으로 환산해 스케줄링에 되먹이는 배선이 완비돼 있다. 문제는 반대 방향이었다. 이 문서는 **폴백이 실제로 어느 코드에서 어떤 순서로 일어나고 몇 초가 걸리는지**를 끝까지 내려가서, 01~03에서 고른 구성이 ICE 상황에서 어떻게 행동하는지 확정한다.

> 자매 문서: [챕터 개요]({{< relref "_index.md" >}}) · 왜 싼 게 이기는지는 [04 인스턴스는 누가 고르는가]({{< relref "04-instance-selection.md" >}}) · 상향 강제 매니페스트는 [05 세대 선호 만들기]({{< relref "05-generation-preference.md" >}}) · 폴백 후 되돌아오지 않는 문제는 [06 consolidation이 되돌리는 것]({{< relref "06-consolidation-traps.md" >}}) · 자매 챕터는 [K8s 버전별 신기능]({{< relref "../k8s-features/_index.md" >}}) · 실제 업그레이드 기록은 [eks-upgrade 01 Karpenter]({{< relref "../eks-upgrade/components/01-karpenter.md" >}})

**검증 기준 버전**: 코어 `kubernetes-sigs/karpenter` **v1.14.0-6-gac7a021e**(로컬 체크아웃), provider-aws는 `main` / `v1.7.0` / `v1.11.3`. 별도 표기가 없으면 provider-aws 인용은 `main` 기준이다. 아래 코어 라인번호는 v1.14 기준이라 실제 배포 버전과 몇 줄 어긋날 수 있다.

## 1. 폴백은 이미 공짜다

ICE 한 번이 스케줄링에 반영되는 경로는 네 홉이다. 사람이 개입할 지점이 하나도 없다.

- **① provider-aws** — `CreateFleet` 응답의 `Errors`를 훑어 `IsUnfulfillableCapacity`면 `MarkUnavailable(instanceType, zone, capacityType, …)` (`pkg/providers/instance/instance.go` `updateUnavailableOfferingsCache()`)
- **② 캐시** — 오퍼링 캐시에 3분 TTL로 넣고 **그 인스턴스 타입의 `offeringCacheSeqNum`을 증가** (`pkg/cache/unavailableofferings.go`)
- **③ 오퍼링 해석** — seqNum이 바뀌었으므로 캐시된 오퍼링을 못 쓰고 재계산 → `Available: … && !isUnavailable && …` (`pkg/providers/instancetype/offering/base_resolver.go:101`)
- **④ 코어** — `Offerings.Available()`가 빈 셋이 되면 `fits()`의 `hasOffering`이 false → 그 인스턴스 타입이 후보에서 제거 (`pkg/cloudprovider/types.go` · `scheduling/nodeclaim.go`)

여기에 결정적인 성질 하나가 더 붙는다. 프로비저닝 루프는 **매 루프마다 `cloudProvider.GetInstanceTypes()`를 새로 호출한다**(`pkg/controllers/provisioning/provisioner.go`). 즉 ICE 마킹과 다음 스케줄링 사이에 별도의 캐시 만료 대기가 없다 — 다음 루프는 곧바로 갱신된 가용성을 본다.

그래서 "7세대를 폴백으로 넣어두면 8세대가 없을 때 7세대가 뜬다"는 기대는 **구성과 무관하게 성립한다.** 단일 NodePool에 6개 패밀리를 다 넣어도, NodePool을 둘로 쪼개도 마찬가지다. 이 문서에서 구성별로 갈리는 건 "폴백이 되느냐"가 아니라 **"폴백이 몇 초 걸리느냐"와 "폴백 전에 8세대를 시도하기는 하느냐"** 두 가지뿐이다. 후자가 [04]({{< relref "04-instance-selection.md" >}})·[05]({{< relref "05-generation-preference.md" >}})의 주제고, 전자가 아래 §2~§4다.

## 2. ICE가 나면 코어는 NodeClaim을 지운다

`CloudProvider.Create()`가 `InsufficientCapacityError`로 실패했을 때 코어가 하는 일은 짧다.

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

**이벤트 · 로그 · 메트릭 · 삭제. 재시도는 없다.** 호출부는 `if err != nil || created == nil { return reconcile.Result{}, err }`인데 여기서 `err`는 `nil`이므로 **controller-runtime의 지수 백오프조차 걸리지 않는다.** 애초에 NodeClaim 오브젝트 자체가 사라졌으니 그 리소스로는 재큐할 것도 없다.

그럼 다시 시도하게 만드는 건 누구인가. 코어 전체에서 프로비저너를 깨우는 `Trigger()` 호출부는 네 곳뿐이고(파드 컨트롤러, 노드 컨트롤러, 배처 내부, capacity buffer) **NodeClaim 삭제를 프로비저너에 알리는 경로는 없다.** 파드는 여전히 pending이므로 파드 컨트롤러의 주기 재큐가 유일한 복구 장치다.

```go
// pkg/controllers/provisioning/controller.go — PodController.Reconcile()
return reconcile.Result{RequeueAfter: 10 * time.Second}, nil
```

여기에 배치창이 더 붙는다 — `BATCH_IDLE_DURATION` 기본 1초, `BATCH_MAX_DURATION` 기본 10초(`pkg/operator/options/options.go`). 파드가 계속 도착하면 idle 창이 계속 연장되어 max 10초까지 늘어난다. 합치면 **코어 측 대기만 11~20초**, 여기에 `CreateFleet` 왕복과 컨트롤러 처리 시간이 얹혀 실측 기대치는 **대략 11~30초**다.

{{< seq caption="ICE 한 번의 전체 왕복 — 마킹은 provider-aws에, 재시도 트리거는 파드에 있다. 3분 뒤 TTL이 만료되면 8세대가 아무 조작 없이 후보로 돌아온다" >}}
{
  "participants": [
    { "id": "pod", "label": "pending 파드" },
    { "id": "core", "label": "코어 컨트롤러" },
    { "id": "prov", "label": "provider-aws" },
    { "id": "ec2", "label": "EC2 Fleet" }
  ],
  "steps": [
    { "msg": ["pod", "core"], "label": "① Trigger + 배치창 1~10초" },
    { "msg": ["core", "prov"], "label": "② Create — gen8 후보" },
    { "msg": ["prov", "ec2"], "label": "③ CreateFleet (instant)" },
    { "msg": ["ec2", "prov"], "label": "④ InsufficientInstanceCapacity", "dashed": true },
    { "note": ["prov"], "lines": ["MarkUnavailable(on-demand:c8i.2xlarge:2a)", "TTL 3분 · seqNum++ → 오퍼링 재계산"] },
    { "msg": ["prov", "core"], "label": "⑤ InsufficientCapacityError", "dashed": true },
    { "note": ["core"], "lines": ["NodeClaim 삭제 · 재큐 없음 · 백오프 없음", "nodeclaims_disrupted_total{insufficient_capacity}"] },
    { "msg": ["pod", "core"], "label": "⑥ 여전히 pending → 10초 재큐" },
    { "alt": "TTL 3분 이내", "steps": [
      { "msg": ["core", "prov"], "label": "⑦ gen8이 Available()에서 빠짐 → gen7" },
      { "msg": ["prov", "ec2"], "label": "⑧ CreateFleet 성공" }
    ], "elseLabel": "TTL 만료 후", "elseSteps": [
      { "msg": ["core", "prov"], "label": "⑦' gen8 재후보 — 복귀 또는 재실패" }
    ] }
  ]
}
{{< /seq >}}

두 개의 갈림길을 미리 못 박아 둔다.

**(a) `CreateFleet`을 한 번도 부르지 않고 ICE가 나는 경로가 따로 있다.** provider-aws는 런치 직전 필터 체인을 돌리는데, 어느 필터에서든 남는 인스턴스 타입이 0이 되면 API 호출 없이 즉시 ICE를 반환한다.

```go
// pkg/providers/instance/instance.go — filterInstanceTypes()
remaining, rejected := filter.FilterReject(instanceTypes)
if len(remaining) == 0 {
	return nil, cloudprovider.NewInsufficientCapacityError(
		fmt.Errorf("all requested instance types were unavailable during launch"))
}
```

ICE 캐시가 이미 채워진 뒤의 재시도가 정확히 이 경로를 탄다. 그래서 "폴백에는 `CreateFleet` 실패 왕복이 반드시 한 번 든다"는 서술은 **첫 실패에만** 맞다. 두 번째부터는 EC2를 때리지 않는다.

**(b) fleet 에러가 전부 "ICE로 집계되는 에러"여야 위 삭제 경로를 탄다.** `combineFleetErrors()`가 세는 것은 순수 ICE가 아니라 `IsUnfulfillableCapacity(err) || IsServiceLinkedRoleCreationNotPermitted(err)`이고, 그 개수가 전체와 같을 때만 `InsufficientCapacityError`로 감싼다(`pkg/providers/instance/instance.go:798-803`) — 즉 **spot service-linked role 생성 불가도 ICE로 집계된다**(§3의 `capacityTypeCache` 축을 채우는 바로 그 에러다). 하나라도 다른 에러(런치 템플릿 문제, 권한 등)가 섞이면 `CreateError`로 분류한다. 이 경우 NodeClaim은 삭제되지 않고 `Launched=Unknown`으로 남아 컨트롤러 백오프 재큐를 탄다 — **폴백이 훨씬 느려지고, `karpenter_nodeclaims_disrupted_total`에도 안 잡힌다.** §8의 이벤트/메트릭으로 "정말 ICE 경로인지"를 먼저 확인해야 하는 이유다.

## 3. ICE 캐시 — 3분, 그리고 세 개의 축

시간 상수는 provider-aws `pkg/cache/cache.go`에 있다.

```go
UnavailableOfferingsTTL             = 3 * time.Minute
UnavailableOfferingsCleanupInterval = time.Second * 10
```

키 포맷은 `<capacityType>:<instanceType>:<zone>`이다(placement group을 쓰면 `:<pgID>[:<partition>]`이 더 붙는다). **리전이나 패밀리 단위가 아니라 (capacity-type, 인스턴스 타입, AZ) 조합 단위**라는 점이 실무에서 자주 어긋나는 지점이다 — `c8i.2xlarge`가 `ap-northeast-2a`에서 ICE를 냈다고 `c8i.4xlarge`나 다른 AZ의 `c8i.2xlarge`가 막히지는 않는다.

그런데 가용성 판정은 이 캐시 하나로 끝나지 않는다. `IsUnavailable()`은 세 축의 OR다 — **아래는 provider-aws `main` 기준**이다.

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

차단 범위는 축마다 다르다.

- **offeringCache** · (capacity-type, 인스턴스 타입, AZ) 하나만 막는다.
- **capacityTypeCache** · **해당 capacity-type 전체**를 막는다 — spot이 통째로 3분간 사라진다.
- **subnetCache** · 그 오퍼링의 **모든** 서브넷이 캐시에 있으면 차단한다. 인스턴스 타입과 무관하다.

> **구버전 주의 — 세 번째 축은 버전마다 다르다.** 위 시그니처와 `subnetCache`는 `main` 형태다. provider-aws `v1.7.0`·`v1.11.3`에서는 `IsUnavailable(instanceType, zone, capacityType)`이고 세 번째 캐시가 `subnetCache`가 아니라 **`azCache`**다 — 서브넷 IP 고갈 시 `MarkAZUnavailable(zone)`으로 **그 AZ 전체**가 3분간 차단된다(서브넷 하나가 아니라). 배포 중인 provider-aws가 v1.11.x 이하라면 차단 범위를 서브넷이 아니라 AZ 단위로 읽어야 한다.

세 번째 축이 특히 헷갈린다. "8세대가 안 뜬다"의 원인이 실제로는 서브넷 IP 고갈일 수 있고, 이때는 7세대로 폴백해도 똑같이 막힌다 — 세대 문제가 아니라 VPC 문제다. `MarkSubnetUnavailable`은 그 서브넷을 이후 런치에서 후순위로 정렬하도록 subnet provider의 IP 캐시도 함께 갱신한다.

3분이라는 숫자에서 파생되는 운영 함의는 두 가지다.

- **부족이 지속되면 3분 주기로 실패 왕복이 반복된다.** TTL 만료 → 8세대가 다시 후보 → `CreateFleet` → ICE → 삭제 → 재큐. 파드가 pending으로 남아 있는 내내 이 사이클이 돈다. 이벤트 스팸과 `disrupted_total` 증가가 보이면 대부분 이 상태다.
- **반대로 용량이 회복되면 최대 3분 뒤 8세대가 저절로 부활한다.** 캐시를 비우는 조작도, 컨트롤러 재시작도 필요 없다. 단 이건 "**앞으로 뜰 노드**가 8세대로 돌아온다"는 뜻이지 **이미 떠 있는 7세대 노드가 8세대로 교체된다는 뜻이 아니다** — 그쪽은 [06]({{< relref "06-consolidation-traps.md" >}})의 주제고, consolidation은 더 싼 방향으로만 움직이므로 자동 복귀 경로가 없다.

토폴로지 제약이 있으면 첫 번째 함의가 악화된다. zone 고정 PVC를 문 StatefulSet처럼 AZ를 하나로 묶어 두면, 다른 AZ의 8세대가 멀쩡해도 그 AZ에서만 3분마다 반복 실패한다.

## 4. 구성별로 폴백은 어디서 일어나는가

01~03에서 다룬 세 구성이 ICE 상황에서 어떻게 갈리는지 구성별 표 셋으로 정리한다.

**A. 단일 NodePool (8+7 혼재)**

| 항목 | 내용 |
|---|---|
| 평상시 무엇이 뜨나 | **7세대.** 코어가 가격 오름차순으로 후보를 싣고 Fleet이 `lowest-price`로 고른다 |
| 대체가 결정되는 지점 | 없음 — 애초에 8세대를 안 고른다 |
| 첫 폴백 지연 | 해당 없음 |
| ICE 캐시 유효한 3분 동안 | 해당 없음 |
| 주요 함정 | 사용자의 요구를 아예 만족 못 함 |
| 8세대 복귀 | 해당 없음 |

**B. NodePool 분리 + `weight`**

| 항목 | 내용 |
|---|---|
| 평상시 무엇이 뜨나 | **8세대.** 상위 weight 템플릿의 성공이 채택된다 |
| 대체가 결정되는 지점 | **코어 스케줄러.** 8세대 풀이 스케줄에 실패해야 7세대 풀 결과가 채택된다 |
| 첫 폴백 지연 | `CreateFleet` ICE 1회 + 재큐 10초 + 배치창 1~10초 = **대략 11~30초** |
| ICE 캐시 유효한 3분 동안 | 8세대 오퍼링이 `Available()`에서 빠져 **`CreateFleet` 호출 없이** 즉시 7세대 |
| 주요 함정 | 8세대 오퍼링이 **일부만** 마킹되면 8세대 풀이 계속 "가용"으로 보여 왕복이 반복된다 |
| 8세대 복귀 | 없음 — `expireAfter`/drift에 의존 |

**C. 단일 NodePool + NodeOverlay**

| 항목 | 내용 |
|---|---|
| 평상시 무엇이 뜨나 | **8세대(의도).** 오버레이가 7세대 가격을 부풀려 정렬을 뒤집는다 |
| 대체가 결정되는 지점 | **EC2 Fleet.** `prioritized` 전략이 Priority 순으로 흘러내린다 (**확인 필요**) |
| 첫 폴백 지연 | 이론상 **같은 API 호출 안** — 추가 지연 0 (**확인 필요**) |
| ICE 캐시 유효한 3분 동안 | 동일 — 8세대 오버라이드 자체가 후보에서 빠진다 |
| 주요 함정 | 페널티 과다 시 60개 절단으로 7세대가 잘려 **폴백 후보 자체가 사라진다** |
| 8세대 복귀 | 오버레이 가격이 consolidation 후보 가격 산정에도 쓰여 복귀 여지가 있다 (**확인 필요**) |

**B의 평가 방식을 오해하지 마라.** "8세대 풀을 먼저 시도하고 실패하면 7세대 풀로 내려간다"는 순차 short-circuit이 아니다. `addToNewNodeClaim`은 `parallelizeUntil`로 NodeClaimTemplate들을 워커에 흩뿌리고, 채택 규칙은 **성공한 것 중 인덱스가 가장 앞선(=weight가 가장 높은) 결과**다(`scheduling/scheduler.go:759`의 `if i >= idx { return false }`).

다만 이게 **"모든 템플릿이 매 루프 평가된다"는 뜻은 아니다.** `parallelizeUntil`의 워커는 `if !doWorkPiece(work) { return }`으로 그 자리에서 죽고(`scheduler.go:939-961`), **성공 경로가 바로 그 `return false`**(`scheduler.go:780`)다. 반대로 실패는 `return true`라 워커가 다음 조각을 계속 집는다. 워커 수는 상수가 아니라 `ceil(CPURequests / 1000)`(`provisioner.go:390`)이라, **컨트롤러 CPU request가 1코어 미만이면 워커는 1개**고 이때 인덱스 0(8세대)이 성공하는 순간 루프가 끝나 **7세대 템플릿은 평가조차 되지 않는다.** 결정성은 평가 순서가 아니라 뮤텍스로 보호된 최소 인덱스 비교가 만든다 — 자세한 것은 [05]({{< relref "05-generation-preference.md" >}}) §1.2에 있다.

그리고 8세대 풀이 "실패"한다는 건 ICE 하나만을 뜻하지 않는다. 사유는 넷이다 — ① **오퍼링 전멸**(ICE 마킹으로 `Offerings.Available()`가 비어 그 템플릿에서 파드가 fit하지 않음) ② **NodePool limits 소진**(`scheduler.go:709-718`의 node limits / `filterByRemainingResources`) ③ **`minValues` 불충족** ④ **파드 요구사항과 비호환**. §1의 ICE 마킹이 만드는 것은 ①뿐이고, 나머지 셋은 용량과 무관하게 같은 폴백을 일으킨다([06]({{< relref "06-consolidation-traps.md" >}}) §3).

B에서 왕복이 반복되는 조건도 여기서 나온다. ICE 캐시는 (타입, AZ, capacity-type) 단위인데 8세대 풀에는 보통 수십 개 조합이 들어 있다. 몇 개만 마킹되면 남은 조합으로 8세대 풀이 여전히 스케줄에 성공하고, 그 NodeClaim이 또 ICE를 맞는다. **8세대 풀의 인스턴스 타입 범위를 좁게 잡을수록 한 번의 ICE로 풀 전체가 한꺼번에 무력화되어 폴백이 빨라진다** — 넓게 잡는 게 항상 좋은 게 아니다.

**C의 "지연 0초"는 확정 사실이 아니다.** 오버레이가 적용되면 provider-aws가 온디맨드 할당 전략을 `lowest-price` → `prioritized`로 바꾸고 각 override의 `Priority`에 조정 가격을 싣는다. 그런데 AWS API 레퍼런스는 `Priority`를 "Valid values are whole numbers starting at `0`"으로 규정하는 반면 Karpenter는 `Priority: lo.ToPtr(float64(offering.Price))`로 소수 달러값(0.17 vs 0.19)을 넣는다. **정수 절단이 일어나면 시간당 $1 미만 인스턴스가 전부 priority 0이 되어 세대 선호가 조용히 무력화된다.** 게다가 AWS 문서의 "낮은 우선순위 풀로 흘러내린다"는 폴백 서술은 `lowest-price` 항목에만 있고 `prioritized` 항목에는 없다. **코드로도 문서로도 확정할 수 없어 확인 필요로 남긴다** — C를 도입한다면 실제로 어떤 패밀리가 뜨는지 실측이 필수다. 자세한 것은 [05 세대 선호 만들기]({{< relref "05-generation-preference.md" >}})에 있다.

## 5. spot을 섞는 순간 논의가 바뀐다

여기까지의 모든 서술은 **on-demand 전제**다. capacity-type이 섞이면 인스턴스 선택의 주체가 바뀌기 때문이다.

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

**요구사항에 허용돼 있고 가용한 오퍼링이 하나라도 있으면 reserved → spot 순으로 먼저 잡히고, 둘 다 없을 때만 on-demand로 떨어진다.** 이건 폴백 관점에서 좋은 성질이다 — 예약이 소진되거나 spot이 ICE로 전멸하면 `Available()`가 비어 자동으로 아래 단계로 내려간다. 하지만 세대 강제 관점에서는 치명적이다.

{{< flow caption="capacity-type이 결정되면 할당 전략이 따라오고, 할당 전략이 '인스턴스를 누가 고르는가'를 정한다 — spot을 허용한 순간 선택권이 EC2로 넘어간다" >}}
{
  "nodes": [
    { "id": "nc", "col": 0, "row": 1, "label": "NodeClaim", "sub": "capacity-type In [...]", "kind": "src" },
    { "id": "gct", "col": 1, "row": 1, "label": "getCapacityType", "sub": "가용 오퍼링이 있는 첫 단계", "kind": "proc" },
    { "id": "rsv", "col": 2, "row": 0, "label": "reserved", "sub": "가격 = odPrice / 10^7", "kind": "store" },
    { "id": "spt", "col": 2, "row": 1, "label": "spot", "sub": "price-capacity-optimized", "kind": "query" },
    { "id": "od", "col": 2, "row": 2, "label": "on-demand", "sub": "lowest-price", "kind": "proc" },
    { "id": "k", "col": 3, "row": 0, "label": "사실상 확정", "sub": "정렬·절단·Fleet 전부 1순위", "kind": "sink" },
    { "id": "e1", "col": 3, "row": 1, "label": "EC2 · 용량 기준", "sub": "세대 선호 무력화", "kind": "sink" },
    { "id": "e2", "col": 3, "row": 2, "label": "EC2 · 가격 기준", "sub": "가장 싼 세대가 이긴다", "kind": "sink" }
  ],
  "edges": [
    { "from": "nc", "to": "gct", "rate": 700 },
    { "from": "gct", "to": "rsv", "label": "예약 있음", "rate": 900 },
    { "from": "gct", "to": "spt", "label": "spot 허용", "rate": 700 },
    { "from": "gct", "to": "od", "label": "나머지", "rate": 800 },
    { "from": "rsv", "to": "k", "rate": 900 },
    { "from": "spt", "to": "e1", "rate": 700 },
    { "from": "od", "to": "e2", "rate": 800 }
  ]
}
{{< /flow >}}

spot Fleet의 기본 전략은 `price-capacity-optimized`다 — EC2가 **용량 깊이를 우선 보고** 가격을 그다음으로 본다. 오버레이(구성 C)를 걸어도 spot 전략은 `capacity-optimized-prioritized`로 바뀔 뿐이고, AWS 문서상 이 전략은 우선순위를 **best-effort**로만 존중한다. 즉 spot에서는 어떤 방법으로도 세대 우선이 보장되지 않는다.

정리하면 트레이드오프가 정직하게 갈린다.

| | ICE 내성 | 세대 강제 |
|---|---|---|
| spot | **좋음** — EC2가 용량 깊은 풀을 고르므로 ICE 자체가 덜 난다 | **불가** — 선택 주체가 EC2고 우선순위는 best-effort |
| on-demand | 보통 — ICE가 나면 §2의 왕복을 탄다 | **가능** — weight(B) 또는 오버레이(C)로 표현 가능 |
| reserved | **최상** — 예약분은 정의상 확보돼 있다 | **가능** — §6 |

이 챕터의 목표가 "평소엔 8세대"라면 답은 하나다. **on-demand 전용 NodePool과 spot NodePool을 분리하고, 세대 선호는 on-demand 쪽에만 건다.** 한 NodePool에 둘을 섞으면 `getCapacityType`이 spot을 먼저 고르는 순간 weight도 오버레이도 의미를 잃는다.

## 6. ODCR — 알파 없이 8세대를 1순위로 만드는 길

`ReservedCapacity` 게이트로 활성화되는 reserved 오퍼링의 가격 산정이 이 절의 전부다.

```go
// pkg/providers/instancetype/offering/reserved_capacity_resolver.go
if odPrice, ok := r.PricingProvider.OnDemandPrice(ec2types.InstanceType(it.Name)); ok {
	// Divide the on-demand price by a sufficiently large constant. This allows us to treat the
	// reservation as "free", while maintaining relative ordering for consolidation. ...
	price = odPrice / 10_000_000.0
}
```

가격이 사실상 0이므로 **코어의 `OrderByPrice`, `Truncate`(600 → 60), EC2 Fleet의 `lowest-price` 세 관문을 전부 무조건 통과한다.** 01에서 본 "싼 게 이긴다"는 성질이 여기서는 우리 편이 된다 — 8세대에 ODCR을 잡아두면 7세대보다 싸게 보이므로, 세대 선호를 표현하기 위한 알파 기능도 NodePool 분리도 필요 없다.

게이트는 기본으로 켜져 있다. `FEATURE_GATES` 기본값이 `NodeRepair=false,ReservedCapacity=true,SpotToSpotConsolidation=false,NodeOverlay=false,StaticCapacity=false,CapacityBuffer=false`다(`pkg/operator/options/options.go`) — `NodeOverlay`가 명시적으로 `false`인 것과 대비된다.

폴백 동작도 자연스럽다. §5에서 본 대로 `getCapacityType`은 **가용한 reserved 오퍼링이 있을 때만** reserved를 고른다. 예약분이 다 차면 그 오퍼링이 `Available()`에서 빠지고 같은 NodePool 안에서 on-demand로 내려간다. 여기서 다시 ICE가 나면 §2의 왕복을 타고 7세대로 간다. **"8세대 예약분 → 8세대 온디맨드 → 7세대 온디맨드"라는 3단 폴백이 GA 기능만으로 성립한다.**

다만 예약과 weight를 같이 쓸 때 코어가 특별 취급을 한다는 점은 알아둘 필요가 있다.

```go
// pkg/controllers/provisioning/scheduling/scheduler.go
// If the pod is compatible with a NodePool with reserved offerings available, we shouldn't fall back
// to a NodePool with a lower weight. ...
if IsReservedOfferingError(err) { … idx = i; return false }
```

예약 오퍼링을 확보하려다 실패한 경우(`"one or more instance types with compatible reserved offerings are available, but could not be reserved"`)에는 **하위 weight NodePool의 성공 결과를 채택하지 않는다.** 즉 8세대 풀에 ODCR을 걸어 뒀는데 예약 슬롯 경합에 진 순간, 7세대 풀로 내려가는 대신 그 루프를 통째로 포기하고 다음 루프를 기다린다. 이게 [05]({{< relref "05-generation-preference.md" >}})의 weight 구성과 겹칠 때 실제 지연이 얼마나 되는지는 **확인 필요** — 코드 경로는 확인했지만 재현 실험은 하지 않았다.

{{< callout type="warning" >}}
**EC2NodeClass 쪽 필드는 직접 확인하라.** provider-aws는 `nodeClass.CapacityReservations()`로 예약 목록을 읽어 reserved 오퍼링을 만든다(`reserved_capacity_resolver.go`). 그 목록을 채우는 EC2NodeClass의 셀렉터 필드명과 스키마는 이 조사에서 **확인하지 못했다** — 로컬에 provider-aws의 `pkg/apis/v1` EC2NodeClass 타입 정의 사본이 없다. 쓰기 전에 `kubectl explain ec2nodeclass.spec`으로 사용 중인 버전의 필드를 확인할 것. 그리고 ODCR은 예약해 둔 시간만큼 돈이 나간다 — 알파 회피의 대가는 비용이다.
{{< /callout >}}

## 7. 런치는 됐는데 등록이 안 될 때 — `NodeRegistrationHealthy`

§1~§6은 전부 **런치가 거부되는** 실패다. 런치가 성공한 뒤 노드가 클러스터에 조인하지 못하는 실패는 성질이 완전히 다르다. RFC가 드는 대표 원인은 클러스터 security group의 outbound 규칙 누락이다(`designs/noderegistrationhealthy-status-condition.md`).

**결정적 차이: 오퍼링이 마킹되지 않는다.**

| | ICE (§2) | 등록 실패 |
|---|---|---|
| 어디서 실패 | `CreateFleet` 호출 | 노드 부팅 후 kubelet 조인 |
| 오퍼링 마킹 | `MarkUnavailable` → 후보에서 제외 | **없음** — 오퍼링은 계속 available |
| 다음 사이클 | 다른 조합으로 넘어감 | **같은 조합을 다시 시도** |
| 폴백 | 자동 | **안 걸린다** |

8세대 풀에서 노드가 뜨는데 등록이 안 되면 §3의 ICE 캐시도 §4의 구성별 폴백도 구제하지 못한다. 캐시는 비어 있고, 8세대 풀은 스케줄 시뮬레이션에 계속 **성공**하므로 7세대 풀의 결과가 채택되지 않는다. 증상은 노드가 주기적으로 뜨고 사라지는 것뿐이다.

### 7.1 3상태

`ConditionTypeNodeRegistrationHealthy`(`pkg/apis/v1/nodepool_status.go:31`)는 3상태다.

| 상태 | 언제 | 코드 |
|---|---|---|
| `Unknown` | NodePool 최초 생성, 또는 NodePool·NodeClass generation 변경 | `registrationhealth/controller.go:92-97` |
| `True` | 이 NodePool·NodeClass 조합으로 등록이 성공 | `nodeclaim/lifecycle/registration.go:192` |
| `False` | 등록 실패가 임계를 넘음 | `nodeclaim/lifecycle/liveness.go:128`, `:131-135` |

`False`의 reason은 둘로 갈린다 — 등록 타임아웃이면 `RegistrationFailed` / `"Failed to register node"`(`liveness.go:132`), 런치 자체가 실패했으면 NodeClaim의 `Launched` condition reason·message를 그대로 옮긴다(`:134`).

### 7.2 판정 — 링버퍼 4칸

`03-keyword-reference`가 "관찰용"이라고 적은 그 조건의 판정 근거다. 상태는 컨디션이 아니라 인메모리 링버퍼에서 나온다(`pkg/state/nodepoolhealth/tracker.go`).

```go
// pkg/state/nodepoolhealth/tracker.go:28-29
BufferSize     = 4
ThresholdFalse = 0.5 // 50% of 0s for NodeRegistrationHealthy=False
```

- `Status()`는 `unhealthyCount / BufferSize >= ThresholdFalse`이면 `StatusUnhealthy`(`:80-84`). **최근 4회 중 2회 실패면 `False`다.**
- 버퍼가 비어 있으면 `Unknown`(`:69-71`).
- `DryRun(uid, launchStatus)`은 버퍼 **복사본**에 결과를 하나 넣어 보고 판정한다(`:145-157`) — 실제 버퍼를 오염시키지 않고 "이번 결과를 반영하면 상태가 바뀌는가"만 본다.
- 링버퍼는 꽉 차면 가장 오래된 칸을 덮는다(`pkg/utils/ringbuffer/buffer.go:30-39`). 따라서 `[false, false]`에서 `True`로 돌아오려면 **성공 3회**가 필요하다 — 2회까지는 `2/4 = 0.5`로 여전히 Unhealthy다.

**`False`까지 걸리는 시간**: 등록 타임아웃 경로는 `registrationTimeout = 15분`(`liveness.go:52`), 런치 타임아웃은 `5분`(`:59`). 실패 2회가 쌓여야 하므로 **30분 이상**이다. 즉시 알려 주는 신호가 아니다.

### 7.3 재시작은 상태를 보존한다

흔한 오해다. Karpenter가 재시작해 버퍼가 비면 **기존 컨디션 값으로 버퍼를 재수화**한다(`registrationhealth/controller.go:82-89`, `tracker.go:94-101`이 `False`면 `false` 2칸을 선충전). `Unknown`으로 되돌리는 것은 generation 변경뿐이다(`controller.go:92-97`) — NodePool `Generation`이 컨디션의 `ObservedGeneration`과 다르거나, NodeClass generation이 `Status.NodeClassObservedGeneration`과 다를 때.

### 7.4 신호이지 가드가 아니다

{{< callout type="warning" >}}
`NodeRegistrationHealthy=False`인 NodePool도 프로비저닝에 계속 쓰인다. RFC 명시 — "A NodePool marked with `NodeRegistrationHealthy: False` can still be used for provisioning workloads, as this status isn't a precondition for readiness."

§8의 `"ignoring nodepool, not ready"`(NodeClass 오류)와 달리 **풀이 후보에서 빠지지 않는다.** 알람은 사람이 걸어야 한다.
{{< /callout >}}

부작용이 하나 있다. 파드가 스케줄된 NodePool이 `NodeRegistrationHealthy=true`일 때만 스케줄 시각을 기록하고(`pkg/controllers/state/cluster.go:513-516`), 아니면 기존 엔트리를 지운다(`:517-521`). 등록이 한 번도 성공하지 않은 풀의 파드는 바인딩/ready 메트릭에서 빠진다 — **메트릭이 조용해지는 것 자체가 신호다.**

```bash
kubectl get nodepool -o custom-columns=\
'NAME:.metadata.name,REG:.status.conditions[?(@.type=="NodeRegistrationHealthy")].status,\
REASON:.status.conditions[?(@.type=="NodeRegistrationHealthy")].reason'
```

## 8. 지금 ICE가 나고 있는지 아는 법

**가장 먼저 알아야 할 것: NodeClaim에는 흔적이 남지 않는다.** §2에서 본 대로 코어는 ICE 난 NodeClaim을 즉시 삭제한다. `kubectl get nodeclaim`으로는 아무것도 못 본다. 이벤트도 NodeClaim에 붙어 있어 오브젝트가 사라지면 함께 정리될 수 있다. 지속적으로 남는 유일한 신호는 메트릭이다.

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

읽는 법을 정리하면 이렇다.

- **`disrupted_total{insufficient_capacity}`가 3분 주기로 계단식 증가** — 8세대 부족이 지속 중이다. TTL 만료 → 재시도 → 재실패 루프(§3)를 도는 상태다. → 8세대 풀의 타입 범위를 좁혀 왕복 빈도를 낮추거나, ODCR로 예약을 확보한다.
- **이벤트는 나는데 `disrupted_total`이 안 오름** — ICE가 아닌 에러가 섞여 `CreateError` 경로를 탄 것이다(§2-b). 서브넷 IP 고갈·런치 템플릿 문제가 의심된다. → NodeClaim의 `Launched` 컨디션 reason을 확인한다. §3의 `subnetCache` 축도 점검한다.
- **④번 로그가 8세대 풀에만 반복** — 오퍼링이 전멸해 그 풀이 스케줄 후보에서 빠진 것이다 = 폴백이 정상 동작 중이다. → 정상이다. 7세대 노드 비율만 추적한다.
- **⑤번 로그** — EC2NodeClass가 Ready가 아니라 풀이 통째로 제외된 것이다 — ICE와 무관하다. → NodeClass 상태를 먼저 고친다.
- **NodePool별 노드 수에서 gen7 비중이 튐** — ICE가 지속됐거나, 한 번 내려간 뒤 복귀하지 못한 상태다. → [06 consolidation이 되돌리는 것]({{< relref "06-consolidation-traps.md" >}})의 `expireAfter` 절을 참고한다.

마지막 줄이 이 문서와 03을 잇는 지점이다. **ICE 폴백은 "다음에 뜰 노드"만 바꾼다.** 3분 뒤 8세대가 후보로 돌아와도 그 사이 떠버린 7세대 노드는 그대로 남고, consolidation은 더 싼 방향으로만 움직이므로 스스로 되돌아오지 않는다. 폴백이 공짜인 것과 복귀가 공짜인 것은 전혀 다른 얘기다.
