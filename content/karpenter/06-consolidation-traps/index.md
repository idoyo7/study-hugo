---
title: "consolidation이 되돌리는 것"
weight: 6
aliases: ["/k8s-features/karpenter/03-consolidation-traps/"]
---

# 06 · consolidation이 되돌리는 것 — 구성해 놓고 나중에 무너지는 경로들

{{< callout type="info" >}}
**한눈에**
- consolidation의 교체 조건은 가격 부등식 하나뿐입니다. `launchPrice < candidatePrice` — strict라 동가격 교체조차 없습니다. 세대·성능·선호도라는 개념은 disruption 패키지 어디에도 인코딩돼 있지 않습니다.
- disruption 패키지는 NodePool weight를 전혀 보지 않습니다. `grep -rnE 'Spec\.Weight|OrderByWeight' pkg/controllers/disruption/` → 0건. 코어는 크로스 풀 교체를 막지 않고 정상 경로로 인지합니다.
- 다만 크로스 풀 다운그레이드는 좁습니다. 대체안 시뮬레이션도 프로비저닝과 같은 weight 정렬 스케줄러를 씁니다. 평상시엔 gen8 풀에서 대체안이 나오고 strict 부등호에 걸려 탈락합니다. gen8 풀이 스케줄에 실패할 때만 gen7이 이깁니다. 그건 정확히 gen7을 원하는 상황입니다.
- 한 번 내려가면 consolidation으로는 안 돌아옵니다. "더 비싼 교체" 분기가 코드에 없습니다. 업스트림 요청도 반려됐습니다(#1829 closed as not planned). 복귀 경로는 `expireAfter`와 drift입니다 — 둘 다 가격 필터 없이 교체하므로 재스케줄 시 weight 100인 gen8이 다시 먼저 평가됩니다.
- weight는 "보장"이 아닙니다 — 공식 문서가 명시합니다. 원인은 단일 프로비저닝 루프 내부의 빈패킹입니다. "이미 떠 있는 노드" 때문이 아닙니다. in-flight NodeClaim의 정렬 키는 weight가 아니라 파드 수 오름차순입니다. 거기에 얹는 시도가 새 NodeClaim 생성보다 먼저 옵니다.
- drift는 값 추가엔 침묵하고 값 제거엔 폭발합니다. requirements 판정이 호환성 기반이라 세대 추가는 무해합니다. 풀을 쪼개려고 기존 풀에서 세대를 제거하면 RequirementsDrifted 대량 교체가 시작됩니다. 속도 제어 수단은 `disruption.budgets` 하나뿐입니다.
{{< /callout >}}

왜 이 문서인가. [05]({{< relref "05-generation-preference.md" >}})의 매니페스트는 적용 순간엔 의도대로 동작합니다. 문제는 그 다음입니다 — Karpenter의 재계산 루프는 "세대"라는 단어를 모릅니다. 이 문서는 며칠~몇 주에 걸쳐 조용히 무너지는 경로를 코어 소스에서 짚습니다. 검증 기준: kubernetes-sigs/karpenter `v1.14.0-6-gac7a021e`(로컬 체크아웃).

자매 문서: [챕터 개요]({{< relref "_index.md" >}}) · 가격이 이기는 근거는 [04 인스턴스는 누가 고르는가]({{< relref "04-instance-selection.md" >}}) · 매니페스트는 [05 세대 선호 만들기]({{< relref "05-generation-preference.md" >}}) · Insufficient Capacity Error(ICE)와 폴백 타이밍은 [07 용량이 없을 때]({{< relref "07-ice-fallback.md" >}}) · [K8s 버전별 신기능]({{< relref "../../k8s-features/_index.md" >}}) · v1beta1→v1 업그레이드 기록은 [eks-upgrade 01 karpenter]({{< relref "../../eks-upgrade/components/01-karpenter.md" >}})

## 1. 교체 판정은 부등식 하나다

consolidation의 교체 판정은 한 줄입니다 — 후보 노드의 현재 가격(`candidatePrice`)이 상한이고, 시뮬레이션이 뽑은 대체 NodeClaim의 인스턴스 타입 목록을 그 상한으로 거릅니다.

```go
// pkg/controllers/disruption/consolidation.go:221
results.NewNodeClaims[0], err = results.NewNodeClaims[0].
	RemoveInstanceTypeOptionsByPriceAndMinValues(results.NewNodeClaims[0].Requirements, candidatePrice)

// pkg/controllers/provisioning/scheduling/nodeclaim.go:411-419
func (n *NodeClaim) RemoveInstanceTypeOptionsByPriceAndMinValues(reqs scheduling.Requirements, maxPrice float64) (*NodeClaim, error) {
	n.InstanceTypeOptions = lo.Filter(n.InstanceTypeOptions, func(it *cloudprovider.InstanceType, _ int) bool {
		launchPrice := it.Offerings.Available().WorstLaunchPrice(reqs)
		return launchPrice < maxPrice
	})
	if _, _, err := n.InstanceTypeOptions.SatisfiesMinValues(reqs); err != nil {
		return nil, err
	}
	return n, nil
}
```

부등호가 `<`라는 게 중요합니다. 동가격 교체는 일어나지 않습니다. 필터 후 목록이 비면 `"Can't replace with a cheaper node"` 이벤트를 남기고 no-op으로 끝납니다(consolidation.go:228-233).

실제로는 교체를 막는 게이트가 넷 더 있습니다 — 다만 **어느 것도 세대나 선호를 인코딩하지 않습니다.**

| 게이트 | 위치 | 무엇을 보는가 | 세대 개념? |
|---|---|---|---|
| 가격 상한 | `nodeclaim.go:411-419` | `launchPrice < candidatePrice` (strict) | ✗ |
| `SatisfiesMinValues` | `nodeclaim.go:416-418` | 필터 후 남은 값의 다양성 하한 | ✗ (부수적으로 방어막은 됨) |
| `filterOutSameInstanceType` | `multinodeconsolidation.go:209-246` | 삭제 대상과 **같은** 타입이면 상한을 더 조임 | ✗ |
| `CanPassThreshold` 사전 컷 | `singlenodeconsolidation.go:86-89` | DELETE의 절감비를 상한으로 본 조기 탈락 | ✗ |
| `Balanced` 스코어 | `balanced.go:108-121` | `savingsFraction / disruptionFraction >= 1/k` | ✗ |

표의 둘째 행은 뒤집어 쓸 수도 있습니다 — `instance-family Exists minValues: 3` 같은 제약은 예상 못 한 방어막이 됩니다. 필터 후 남은 패밀리가 그 밑으로 줄면 `SatisfiesMinValues`가 에러를 던져 no-op이 됩니다.

multi-node consolidation도 같은 `computeConsolidation`을 탑니다(multinodeconsolidation.go:141). `filterOutSameInstanceType`은 삭제 대상과 **같은** 타입에만 상한을 조이므로 **8세대 여러 개를 7세대 한 개로 합치는 시나리오는 이 필터를 그대로 통과합니다.**

v1.14의 `consolidationPolicy: Balanced`도 해법이 아닙니다 — `ScoreMove`는 절감액·중단 비용 비율만 보므로 7세대가 충분히 싸면 승인됩니다.

{{< callout type="info" >}}
**`Balanced`(1.14)를 켜도 이 부등식은 그대로입니다.** `RemoveInstanceTypeOptionsByPriceAndMinValues` 호출 지점(`consolidation.go:221`(일반)·`:278`(spot→spot)·`multinodeconsolidation.go:241`) 중 어느 것도 정책 분기 안에 없습니다 — `Balanced`는 그 필터를 통과한 커맨드에 나중에 얹히는 승인 게이트일 뿐입니다(`balanced.go:220-221`). 따라서 "더 싼 쪽" 교체 일부를 추가로 거부할 뿐 "더 비싼 쪽" 교체는 만들지 않습니다 — **§4의 복귀 경로 부재는 정책 선택과 무관합니다.** `SavingsFraction <= 0`이면 `Score()`가 0이라 거부됩니다(`disruption/types.go:100-111`).

스코어·k=2 근거는 [13 consolidation 처리 흐름]({{< relref "13-consolidation-models.md" >}}) §7.2·§7.7이, 도입 시점 판정은 [02]({{< relref "02-changelog-maturity.md" >}}) §7.2가 소유합니다.
{{< /callout >}}

## 2. disruption은 weight를 모른다

NodePool weight가 사는 곳은 프로비저닝 경로뿐입니다. disruption 패키지에는 아예 참조가 없습니다.

```bash
$ grep -rnE 'Spec\.Weight|OrderByWeight' pkg/controllers/disruption/ | grep -v _test | wc -l
0
```

`NodeClaimTemplate`에 `NodePoolWeight` 필드가 있긴 하지만(`nodeclaimtemplate.go:60,71`) 읽는 곳이 없습니다. weight로 저-weight 풀 폴백을 막는 분기는 코드 전체에 하나뿐이고, 그건 예약 용량 전용입니다.

```go
// pkg/controllers/provisioning/scheduling/scheduler.go:736-751 (요지)
// If the pod is compatible with a NodePool with reserved offerings available,
// we shouldn't fall back to a NodePool with a lower weight.
if IsReservedOfferingError(err) { ... }
```

그 외 실패는 `errs[i] = err; return true`로 스킵되고 다음(=더 낮은 weight) 템플릿이 이깁니다. 교체 NodeClaim은 **그 풀의 라벨을 그대로 달고** 생성됩니다.

```go
// pkg/controllers/provisioning/scheduling/nodeclaimtemplate.go:79-82
nct.Labels = lo.Assign(nct.Labels, map[string]string{
	v1.NodePoolLabelKey: nodePool.Name, ...
})
```

코어가 크로스 풀 이동을 "막아야 할 사고"가 아니라 **정상 경로로 인지한다**는 증거도 있습니다 — `Balanced` 절감액 정산 로직의 주석입니다.

```go
// pkg/controllers/disruption/balanced.go:149-151
// For cross-pool moves, attribute net savings proportionally to each
// pool's share of source cost. EstimatedSavings already subtracts
// replacement cost, so this splits the net benefit by source contribution.
```

## 3. 그런데 크로스 풀 다운그레이드는 생각보다 좁다

**대체안을 만드는 시뮬레이션이 프로비저닝과 완전히 같은 스케줄러이기 때문입니다.**

`SimulateScheduling`은 `provisioner.NewScheduler`를 그대로 호출합니다(`disruption/helpers.go:113-121`). 이 스케줄러는 NodePool을 weight 내림차순으로 정렬하고(`provisioner.go:287-289`) 성공한 템플릿 중 **인덱스가 가장 앞선 것**을 채택합니다(`scheduler.go:757-761`). gen8 풀이 파드를 수용하는 한 대체안은 gen8 안에서만 나옵니다. 같은 세대끼리는 strict 부등호를 넘기 어려워 대개 no-op입니다.

{{< seq src="_seq/3-그런데-크로스-풀-다운그레이드는.json" />}}

**경계를 정확히 그으면 이렇습니다.** 크로스 풀 다운그레이드는 gen8 풀 템플릿이 `CanAdd`에 실패할 때만 일어납니다. 실패 사유는 넷입니다 — 오퍼링 전멸(ICE 마킹), NodePool limits 소진, `minValues` 불충족, 요구사항 비호환. 어느 쪽이든 **그 순간은 정확히 "gen7을 띄우고 싶은 순간"**입니다. 이 경로 자체는 버그가 아니라 폴백이 의도대로 작동한 것입니다.

## 4. 한 번 내려가면 consolidation은 되돌리지 않는다

폴백으로 뜬 gen7 노드는 용량이 회복돼도 gen7로 남습니다. 이유는 단순합니다 — **"더 비싼 것으로 교체한다"는 분기가 코드에 없습니다.** 가격 필터는 상한만 받습니다. 필터 후 목록이 비면 `Command{}`를 반환합니다.

업스트림에도 이 방향의 기능은 없습니다. 요청은 두 건 다 닫혔습니다.

| 이슈 | 내용 | 상태 |
|---|---|---|
| [kubernetes-sigs/karpenter#1829](https://github.com/kubernetes-sigs/karpenter/issues/1829) | 저-weight 폴백 노드를 고-weight로 되돌리는 정책 제안 | **closed as not planned** |
| [aws/karpenter-provider-aws#6721](https://github.com/aws/karpenter-provider-aws/issues/6721) | 가격보다 세대 우선순위를 앞세우는 축 요청 | **closed** |

#1829는 저-weight 폴백 노드를 되돌리는 `consolidationPolicy: Underweight`를 제안했습니다 — 스팟 부재로 온디맨드 폴백한 뒤 안 돌아오는 문제입니다. 우리 문제와 **동형**이지만 답은 "계획 없음"입니다. #6721("Ability to prefer generation over price")도 같은 이유로 닫혔습니다.

### 4.1 복귀 경로는 가격 필터가 없는 두 트리거뿐

Karpenter에서 노드를 교체하는 트리거는 consolidation 말고도 있습니다. 그중 둘은 가격을 전혀 보지 않고, 이 둘이 사실상 유일한 복귀 장치입니다.

| 트리거 | 가격 필터 | 예산(`disruption.budgets`) | 복귀 장치로서 |
|---|---|---|---|
| consolidation (`Underutilized`) | **있음** — 더 싼 쪽으로만 | 적용 | ✗ 방향이 반대다 |
| drift (`Drifted`) | 없음 | 적용 | ○ 단 스펙을 바꿔야 발동 |
| **`expireAfter` (만료)** | 없음 | **적용 안 됨** | ◎ 시간만으로 자동 발동 |
| NodeRepair | 없음 | — | 장애 대응용, 통제 불가 |

넷 중 시간만으로 도는 만료를 먼저 봅니다. 만료는 disruption 컨트롤러가 아니라 별도 nodeclaim 컨트롤러가 처리합니다. NodeClaim을 **그냥 삭제**합니다.

```go
// pkg/controllers/nodeclaim/expiration/controller.go:75-86 (요지)
expirationTime := nodeClaim.CreationTimestamp.Add(*nodeClaim.Spec.ExpireAfter.Duration)
if c.clock.Now().Before(expirationTime) { return reconcile.Result{RequeueAfter: ...}, nil }
// 3. Otherwise, if the NodeClaim is expired we can forcefully expire the nodeclaim (by deleting it)
if err := c.kubeClient.Delete(ctx, nodeClaim); err != nil { ... }
```

삭제된 노드의 파드는 재-pending돼 **새 프로비저닝 루프**에 들어갑니다. 그 루프는 `OrderByWeight`를 타므로 **weight 100인 gen8 풀이 다시 먼저 평가됩니다.** 용량이 회복돼 있으면 gen8이 이기고 아직 없으면 다시 gen7이 됩니다 — 어느 쪽이든 우리가 원하는 판정입니다.

만료는 **`disruption.budgets`를 소비하지 않습니다** — 예산 소비 지점은 disruption 컨트롤러 안에만 있고(`singlenodeconsolidation.go:82`, `multinodeconsolidation.go:70`, `disruption/drift.go:80`) 만료는 그 경로 밖입니다. 삭제 후 드레인은 termination 컨트롤러가 처리하며 PodDisruptionBudget(PDB)은 존중됩니다(`terminator/eviction.go:200-205`). `expireAfter`는 `Spec.Template.Spec` 안에 있어 **나중에 바꾸면 그 자체가 NodePoolDrifted를 유발합니다** — 처음부터 정해 두는 게 낫습니다.

기본값은 `720h`입니다(`pkg/apis/v1/nodeclaim.go:78`, `+kubebuilder:default:="720h"`). 30일은 폴백 회수 주기로는 너무 깁니다.

```yaml
# gen7 폴백 풀에만 짧게 건다. gen8 주 풀은 기본값(720h) 그대로 두는 게 맞다.
spec:
  template:
    spec:
      expireAfter: 48h   # 24~72h 권장
```

**트레이드오프는 churn입니다.** 48h면 gen7 노드가 이틀마다 통째로 교체됩니다. 용량 부족이 길어지면 "만료 → 다시 gen7" 왕복마다 재스케줄 비용이 듭니다. 짧을수록 복귀는 빠르므로 폴백 빈도를 관측(§7)한 뒤 조정합니다 — 12h 미만은 권하지 않습니다.

### 4.2 내려가는 것 자체를 막고 싶다면 — 임시 방어선 둘

복귀가 없으니 애초에 내려가지 않게 하려는 발상은 자연스럽습니다. 두 수단 다 **"다운그레이드를 막는" 게 아니라 "consolidation을 끄는" 것**임을 알고 써야 합니다.

- `budgets:[{reasons:[Underutilized],nodes:"0"}]` — 교체형 consolidation 전부 skip(`singlenodeconsolidation.go:81-85`, `multinodeconsolidation.go:70-77`); Empty·Drifted는 계속 동작. 잃는 것: gen8 **내부**의 정당한 축소도 같이 죽습니다.
- `consolidationPolicy: WhenEmpty` — 비어있지 않은 노드는 후보 탈락(`consolidation.go:130-134`); Emptiness Command는 `Replacements`가 없어 삭제만(`emptiness.go:97-100`). 잃는 것: 언더유틸 절감 전부.

크로스 풀 다운그레이드는 gen8이 스케줄에 실패할 때만 일어나므로(§3) 상시 방어선은 대개 과잉입니다 — gen7 비중이 튄 뒤 임시로 거는 용도가 맞습니다.

## 5. weight는 "보장"이 아니다 — 공식 문서가 그렇게 쓴다

여기가 가장 오해가 잦습니다. 공식 문서에 문장이 그대로 있습니다.

> "Based on the way that Karpenter performs pod batching and bin packing, it is not guaranteed that Karpenter will always choose the highest priority NodePool given specific requirements."
> — <https://karpenter.sh/docs/concepts/scheduling/#weighted-nodepools>

소스상의 원인은 **단일 프로비저닝 루프 내부의 빈패킹**입니다 — "이미 떠 있는 노드가 있어서"가 아닙니다.

```go
// pkg/controllers/provisioning/scheduling/scheduler.go:593-607
// first try to schedule against an in-flight real node
if err := s.addToExistingNode(ctx, pod); err == nil { return nil }

sort.Slice(s.newNodeClaims, func(a, b int) bool {
	return len(s.newNodeClaims[a].Pods) < len(s.newNodeClaims[b].Pods)
})

// Pick existing node that we are about to create
if err := s.addToInflightNode(ctx, pod); err == nil { return nil }
...
err := s.addToNewNodeClaim(ctx, pod)
```

읽을 지점은 둘입니다.

1. `s.newNodeClaims`는 **이번 시뮬레이션 안에서 방금 만든** NodeClaim들입니다. 아직 EC2에 존재하지도 않습니다.
2. 그 목록의 정렬 키는 **weight가 아니라 파드 수 오름차순**입니다. 거기 얹는 시도(`addToInflightNode`)가 새 NodeClaim 생성(`addToNewNodeClaim`)보다 **먼저** 옵니다.

`addToNewNodeClaim`의 weight 우선 채택(`scheduler.go:757-761`)은 **세 번째 단계에서만** 도달합니다. 파드 100개가 한 배치로 pending → 첫 파드가 gen8 풀에서 오퍼링 없음으로 실패해 gen7 NodeClaim이 하나 생김 → **뒤따르는 99개 파드는 그 gen7 NodeClaim에 빈패킹으로 얹힙니다.** gen8 용량이 그새 회복됐어도 마찬가지입니다 — in-flight NodeClaim이 앞 단계에서 이미 걸립니다.

실무 함의는 하나입니다. **대규모 스케일아웃 한 번이 gen7 비중을 크게 밀어 올릴 수 있습니다. 그 노드들은 §4의 만료 전까지 그대로 남습니다.** 배치 창은 idle 1초 / 최대 10초입니다(`pkg/operator/options/options.go:129-130`). 한 배치에 들어가는 파드 수가 생각보다 큽니다.

## 6. drift — 값 추가는 침묵, 값 제거는 폭발

세대별 NodePool로 이행할 때 가장 위험한 편집이 여기 있습니다. 드리프트 판정은 해시 비교가 아니라 **호환성 판정**입니다.

```go
// pkg/controllers/nodeclaim/disruption/drift.go:170-180
func areRequirementsDrifted(nodePool *v1.NodePool, nodeClaim *v1.NodeClaim) cloudprovider.DriftReason {
	nodepoolReq := scheduling.NewNodeSelectorRequirementsWithMinValues(nodePool.Spec.Template.Spec.Requirements...)
	nodeClaimReq := scheduling.NewLabelRequirements(nodeClaim.Labels)
	// Every nodepool requirement is compatible with the NodeClaim label set
	if nodeClaimReq.Compatible(nodepoolReq) != nil {
		return RequirementsDrifted
	}
	return ""
}
```

`requirements`는 정적 해시에서도 빠져 있습니다(`pkg/apis/v1/nodepool.go:234`, `hash:"ignore"`). 그래서 방향에 따라 결과가 극단적으로 갈립니다.

| 편집 | 드리프트? | 이유 |
|---|---|---|
| `values`에 `c7i` **추가** | ✗ | 기존 8세대 노드의 라벨이 여전히 새 requirements와 호환 |
| `values`에서 `c8i` **제거** | ✅ **전량** | 그 세대로 떠 있던 노드가 전부 비호환 → RequirementsDrifted |
| `spec.weight` 변경 | ✗ | `Spec.Template` 밖 |
| `spec.disruption.*` (정책·예산·`consolidateAfter`) | ✗ | `Spec.Template` 밖 + Budget 필드는 `hash:"ignore"` |
| `spec.limits` 변경 | ✗ | `Spec.Template` 밖 |
| `spec.template.spec.expireAfter` 변경 | ✅ | `Spec.Template` 안 → NodePoolDrifted |

교체 속도를 제어하는 손잡이는 `disruption.budgets` 하나뿐입니다. drift의 `ComputeCommands`는 한 번에 커맨드를 **하나만** 반환하지만(`drift.go:75-107`) 컨트롤러가 커맨드를 낸 직후 **즉시 재큐**합니다.

```go
// pkg/controllers/disruption/controller.go:71,177,182
const pollingPeriod = 10 * time.Second
...
return reconciler.Result{RequeueAfter: singleton.RequeueImmediately}, nil   // 커맨드를 냈을 때
...
return reconciler.Result{RequeueAfter: pollingPeriod}, nil                  // 낼 게 없을 때
```

"한 번에 하나씩"이 곧 "천천히"를 뜻하지는 않습니다. 예산을 안 걸면 전체 노드가 연쇄적으로 교체됩니다.

### 6.1 안전한 이행 순서

기존 단일 NodePool에서 세대를 빼는 편집으로 시작하면 안 됩니다. 위 표의 두 번째 행이 바로 그것입니다.

1. **`gen8-primary`(weight 100)와 `gen7-fallback`(weight 10)을 새로 만듭니다.** 기존 풀의 `requirements`는 **손대지 않습니다.**
2. 새 풀들에 `disruption.budgets`를 먼저 걸어 둡니다 — 나중에 걸면 늦습니다.
3. 기존 풀의 `spec.limits`를 0에 가깝게 낮춰 신규 프로비저닝을 새 풀 쪽으로 유도합니다(`limits` 변경은 드리프트가 아닙니다).
4. 기존 풀의 노드가 자연 만료·축소로 빠질 때까지 기다리거나 통제된 속도로 drain합니다.
5. 노드가 0이 된 뒤 기존 NodePool을 **삭제**합니다. NodePool 삭제는 소유 NodeClaim도 함께 삭제하므로 4번을 건너뛰면 안 됩니다.

```yaml
# 3~4단계 동안 새 풀 양쪽에 걸어 두는 예산.
# 시간대 제한을 같이 쓰면 교체를 업무시간 밖으로 밀 수 있다.
disruption:
  consolidationPolicy: WhenEmptyOrUnderutilized
  consolidateAfter: 1m
  budgets:
    - nodes: "10%"                       # 전체 상한
    - reasons: ["Drifted"]               # 드리프트 교체만 더 조인다
      nodes: "1"
    - nodes: "0"                         # 업무시간(평일 09~19시) 전면 정지
      schedule: "0 9 * * mon-fri"
      duration: 10h
```

## 7. 무엇을 봐야 조용한 침식을 알아채는가

이 문서의 실패 모드는 전부 "조용합니다" — 알람 없이 노드 구성만 서서히 바뀝니다. 최소한 다음은 봐야 합니다.

- `karpenter_nodeclaims_disrupted_total{reason="insufficient_capacity"}` — gen8 런치가 ICE로 실패한 횟수. 폴백이 실제로 발생한 지점입니다. 근거: `nodeclaim/lifecycle/launch.go:93`.
- `karpenter_nodeclaims_disrupted_total{reason="expired", nodepool="gen7-fallback"}` — 복귀 장치(§4.1)가 돌고 있는가. 0이면 `expireAfter`가 안 걸린 것입니다. 근거: `expiration/controller.go:88` (`ExpiredReason = "expired"`).
- `karpenter_nodeclaims_disrupted_total{reason="underutilized"}` — 교체형 consolidation 발생량. 급증하면 §4.2 방어선을 검토합니다. 근거: `disruption/queue.go:167` (`ToSnakeCase`).
- `kubectl get events --field-selector reason=InsufficientCapacityError` — 위 메트릭의 사람이 읽을 수 있는 버전. 어떤 인스턴스 타입이 왜 실패했는지. 근거: `nodeclaim/lifecycle/events.go:28-32`.
- 로그 `"skipping, nodepool requirements filtered out all instance types"` — gen8 풀이 조용히 사라지는 경로입니다. requirements 조합이 인스턴스 타입을 전부 걸러 냈습니다. 근거: `scheduler.go:159-166`.
- 로그 `"ignoring nodepool, not ready"` — NodeClass 오류로 gen8 풀이 통째로 빠졌습니다. 이 상태면 weight고 뭐고 없습니다. 근거: `provisioner.go:277`.
- 로그 `"skipping, awaiting nodeoverlay evaluation"` — NodeOverlay를 쓴다면 — 게이트를 켠 직후 그 풀이 프로비저닝·disruption 양쪽에서 빠지는 창. 근거: `provisioner.go:295-298`.
- NodePool별 노드 수 비율 — 가장 중요한 지표. gen7 비중이 튀면 ICE 지속 또는 §5의 빈패킹이 일어난 것입니다. 근거: `count by (nodepool) (karpenter_nodes_current_lifetime_seconds)` — 이 게이지는 WellKnownLabels(=`nodepool` 포함)를 라벨로 답니다(`controllers/metrics/node/controller.go:156`). 코어에 `karpenter_nodes_total` 같은 노드 수 게이지는 없습니다.

마지막 항목이 핵심입니다. 앞의 메트릭들은 전부 "사건이 일어난 순간"을 잡지만 이 문서가 다루는 실패는 **사건이 아니라 상태의 표류**입니다. gen7 비중을 시계열로 그려 놓고 "폴백 후 며칠 안에 다시 내려오는가"를 보는 게 §4의 복귀 장치가 작동한다는 유일한 증거입니다.

{{< callout type="warning" >}}
**확인 필요 — 이 문서가 끝까지 내려가지 못한 지점**

**NodeOverlay를 쓸 경우의 자동 복귀.** 오버레이로 부풀린 gen7 가격은 consolidation의 후보 가격 산정에도 쓰이므로(`disruption/types.go:113-121` `resolveNodePrice` → `instanceType.OfferingPrice`) 용량 회복 시 gen7이 "비싼 노드"로 인식돼 gen8로 교체될 **가능성**이 있습니다 — 사실이면 `expireAfter` 없이도 복귀되는 경로가 생깁니다. 배선은 확인됐습니다: provider-aws `cmd/controller/main.go:44-45,53-63`가 오버레이로 감싼 `cloudProvider`를 코어 컨트롤러에 그대로 넘깁니다. **코드 경로는 확인했으나 실제 교체는 재현하지 못했습니다** — 오버레이가 알파 기능이라 테스트 환경이 없었습니다.
{{< /callout >}}
