---
title: "consolidation은 무엇을 하는가"
weight: 12
---

# 12 · consolidation은 무엇을 하는가

## 1. 10초마다 무슨 일이 일어나나

Karpenter 가 프로비저닝했던 노드들은 다음과 같은 루프를 돌며 "잘 쓰고 있었는가" 를 평가합니다.

```
① 삭제 대상 검사    전체 노드를 훑어 손대도 되는 것만 남긴다
② 삭제 분류        Empty · Drifted · Underutilized 중 어디에
③ 시뮬레이션       지우면 새 노드가 몇 대 필요한가
④ 수행            삭제는 바로, 교체는 대체 노드 기동·대기 후

이 네 단계를 이유마다 한 번씩, 아래 순서로 다섯 번 반복한다
Emptiness → StaticDrift → Drift → MultiNode → SingleNode
첫 성공에서 멈추고, 전부 실패하면 10초 뒤 재시도
```

{{< flow src="_flow/1-한-바퀴.json" />}}

이 네 단계가 이 글의 뼈대입니다. **삭제냐 교체냐는 ③에서야 갈리고**, 그 앞의 둘은 "누구를" 고르는 단계입니다.

## 2. 어떤 노드가 검사 대상인가

출발점은 **클러스터의 모든 Karpenter 노드**입니다. 조건에 맞는 노드를 찾아오는 게 아니라, 매 바퀴 전부를 훑고 나서 **건드리면 안 되는 것을 떨어뜨립니다.**

### 2.1 전체 노드에서 대상을 추린다

떨어지는 경우는 이렇습니다.

| 걸리는 것 | 왜 |
|---|---|
| **PDB가 퇴거를 막는다** | 그 노드의 파드를 지금 뺄 수 없습니다 |
| 파드에 `do-not-disrupt` 어노테이션 | 사용자가 명시적으로 막았습니다 |
| 노드에 `do-not-disrupt` 어노테이션 | 위와 같고, 노드 단위입니다 |
| **이미 처리 대기열에 있다** | 앞선 바퀴가 이미 집어갔습니다 |
| 아직 `Initialized`가 아니다 | 기동 중인 노드는 건드리지 않습니다 |
| 방금 대기 파드 자리로 찜했다 | 프로비저닝이 이 노드에 파드를 넣으려는 중입니다 |
| NodePool을 못 찾는다 | 가격·스펙 비교의 기준이 없습니다 |

여기서 떨어지면 `DisruptionBlocked` 이벤트가 남습니다. **"왜 이 노드가 안 지워지나"를 물을 때 제일 먼저 볼 곳**이 여기입니다.

아직 **"왜 지울까"는 묻지 않았습니다.** 이 단계는 오직 "손대도 되는가"만 봅니다.

### 2.2 후보에 무엇이 담기나

검사를 통과하면 그 노드는 `Candidate`가 되고, 이때 다음 값들이 함께 계산돼 담깁니다.

| 담기는 값 | 나중에 쓰이는 곳 |
|---|---|
| `Price` — 그 노드의 가격 | 교체 시 가격 비교 |
| `RescheduleDisruptionCost` — 지울 때의 비용 | 정렬 키, 비용 모델 |
| `reschedulablePods` — 옮겨야 할 파드만 추린 목록 | 위 비용의 계산 대상. **DaemonSet은 제외!** |
| `instanceType` · `capacityType` · `zone` | 대체 노드를 고를 때의 비교 기준 |

이 중 앞의 두 값이 나눗셈 하나로 짝을 이룹니다 — `Price / RescheduleDisruptionCost`, 즉 **파드 하나 옮기는 대가로 얼마나 아끼는가**입니다(`types.go:145`). 후보를 훑는 쪽은 이 비율이 큰 노드부터 줄을 세우므로, **비싸면서 한산한 노드가 먼저** 손에 잡힙니다.

## 3. 어떤 이유로 분류되나

검사를 통과했다고 지워지는 건 아닙니다. **지울 이유가 있어야** 하고, 그 이유를 붙이는 게 이 단계입니다.

### 3.1 세 가지 분류

검사를 통과한 노드는 세 가지 중 하나로 분류됩니다. 이 분류가 그 노드의 **Reason**이 됩니다.

| 분류 | 세부 설명 |
|---|---|
| `Empty` | 파드가 없는 노드 |
| `Drifted` | NodePool 스펙과 어긋난 노드 |
| `Underutilized` | 합쳐서 줄일 수 있는 노드 |

이 셋은 실제로 다섯 개의 구현으로 나뉘어 차례로 돕니다.

{{< flow src="_flow/3-1-세-분류와-다섯-구현.json" />}}

`Underutilized` 분류 안에서는 MultiNode와 SingleNode로 나뉩니다. **MultiNode는 여러 대를 묶어서, SingleNode는 한 대씩** 후보로 놓고 평가하며, MultiNode가 먼저 돌아 성공하면 그 라운드에 SingleNode는 돌지 않습니다.

### 3.2 분류가 결과를 정하지 않는다

분류가 끝나면 그 노드의 결말은 셋 중 하나입니다 — 아무것도 안 하거나(`no-op`), 그냥 지우거나(`delete`), 대신 한 대를 띄우고 지우거나(`replace`).

**그런데 분류가 그걸 정하지는 않습니다.** "이 노드는 drift로 처리되나 교체로 처리되나"는 성립하지 않는 질문입니다 — 둘은 배타적 선택지가 아닙니다.

| | 정하는 주체 | 값 |
|---|---|---|
| **Reason** | 어느 분류가 잡았나 | `Empty` · `Drifted` · `Underutilized` |
| **Decision** | 그 뒤에 무슨 일이 있었나 | `delete` · `replace` · `no-op` |

{{< flow src="_flow/3-2-reason에서-decision까지.json" />}}

시뮬레이션을 거치는 두 갈래에서는 같은 규칙이 돌아 `Drifted`+삭제 · `Drifted`+교체 · `Underutilized`+삭제 · `Underutilized`+교체가 전부 정상적으로 나옵니다. 삭제·교체를 가르는 갈림목은 통합 전용이 아니라 **그 두 갈래가 함께 지나는 길**입니다.

나머지 둘은 아예 판별을 받지 않아 결과가 고정됩니다. `Empty`는 빈 노드라 옮길 파드가 없어 **대체를 요구할 일이 없고**, static 풀의 `Drifted`는 `replicas`가 고정이라 **대수를 유지해야 해서** 무조건 1:1 교체입니다.

## 4. 삭제냐 교체냐

분류까지 끝났으면 남은 건 **어떻게**입니다. 삭제인지 교체인지를 가르는 건 판정식 여러 개가 아니라 **시뮬레이션 한 번**입니다.

### 4.1 시뮬레이션 — 새 노드가 몇 대 필요한가

`no-op`과 `delete`는 어렵지 않습니다. 남는 건 `replace` 하나 — **대신 띄울 그 한 대가 어디서 나오는가.** 그걸 정하는 게 시뮬레이션입니다.

후보로 선정된 노드를 클러스터에서 **가상으로 지우고**, 그 위 파드를 다시 스케줄해본 뒤 **새로 띄워야 할 노드가 몇 대인가**를 셉니다.

파드가 하나라도 갈 곳이 없으면 그 자리에서 끝납니다.

### 4.2 갈림목은 한 곳뿐이다

시뮬레이션이 요구한 새 노드 대수가 그대로 형태를 정합니다.

{{< flow src="_flow/4-2-두-형태-삭제와-교체.json" />}}

0대면 `Replacements`를 비운 채 반환하고, 
1대면 가격 필터를 거쳐 채웁니다. 

그래서 **삭제와 교체는 대등한 두 개념이 아닙니다** — 둘 다 `Command`라는 지시서 한 장이고, `Replacements`가 비었는지에서 형태가 파생됩니다.

## 5. 비용은 어떻게 계산할까

위에서 노드 교체 후보를 선정할 때 `RescheduleDisruptionCost`라는 파라미터를 통해 비용을 계산합니다.

```go
// types.go:136-141
cost := PerNodeBaseDisruptionCost          // = 1.0
for _, p := range reschedulablePods {
    cost += math.Max(0, disruptionutils.EvictionCost(ctx, p))
}
```

코드로 살펴보면 다음과 같은데요, base `1.0`은 cordon·drain·대체 노드 기동 지연 자체의 비용입니다. **그래서 비용은 어떤 경우에도 1.0 미만이 되지 않습니다.**

파드별 비용은 기본 `1.0`에 `pod-deletion-cost / 2^27`과 `priority / 2^25`를 더하고 `[-10, 10]`으로 클램프합니다(`utils/disruption/disruption.go:47-69`). 대상은 `IsReschedulable` 통과분뿐이라 **DaemonSet은 세지 않습니다.**

**시간 가중치는 없습니다.** `LifetimeRemaining`이 곱해지는 `Candidate.DisruptionCost`는 읽는 비테스트 코드가 없는 dead field입니다(`types.go:207`). "만료 임박 노드가 먼저 지워진다"는 서술은 v1.14.0 기준으로 틀렸습니다.

## 6. 정책별 처리방식의 차이

### 6.1 분류한 것들을 어떻게 처리할까?

위에서 분류를 진행했었고, 이제 분류된 노드들을 처리하는 방식에 대해서 알아보겠습니다.

`consolidation` 정책은 세 개지만 **빈 노드를 처리하는 방법은 완전히 같습니다.**

| 정책 | 빈 노드 | 그 외 후보 | 통과해야 할 게이트 |
|---|---|---|---|
| `WhenEmpty` | 삭제 | **후보로 만들지 않음** | 없음 — 경로 자체가 없습니다 |
| `WhenEmptyOrUnderutilized` | 삭제 (같음) | 시뮬레이션 후 삭제 또는 교체 | 파드 재배치 + (교체면) 가격 |
| `Balanced` | 삭제 (같음) | 시뮬레이션 후 **스코어 심사** | 위 둘 + `score ≥ 0.5` |

빈 노드 열이 셋 다 같은 이유는 **빈 노드를 담당하는 쪽이 `consolidationPolicy`를 아예 읽지 않기 때문**입니다. 그래서 정책을 뭘로 두든 빈 노드는 똑같이 지워집니다. 실제로 갈리는 건 가운데 열 하나뿐입니다.

그리고 **세 정책은 "얼마나 지우느냐"로 한 줄에 세울 수 있습니다.**

```
적게 지움  ←────────────────────────────────────→  많이 지움

WhenEmpty        Balanced        WhenEmptyOrUnderutilized
```

단순히 양만 다른 게 아닙니다. **왼쪽이 지우는 노드는 오른쪽도 빠짐없이 지웁니다.** 반대는 성립하지 않습니다. 양끝을 각각 보면 이유가 나옵니다.

**`WhenEmpty`가 지우는 걸 `Balanced`도 지우는 이유** — `WhenEmpty`는 빈 노드만 지웁니다. 그런데 `Balanced`도 빈 노드는 그냥 지웁니다(위 표 첫 열). 그래서 `WhenEmpty`가 하는 일이 통째로 `Balanced` 안에 들어갑니다.

**`Balanced`가 지우는 걸 `WhenEmptyOrUnderutilized`도 지우는 이유** — `Balanced`는 새 통합을 스스로 만들지 않습니다. `WhenEmptyOrUnderutilized`가 만들어낸 것을 받아 **거부만** 하는 구조라 원본보다 많아질 수가 없습니다.

그래서 정책을 바꾸는 일은 이 줄 위에서 좌우로 움직이는 것과 같습니다. **`Balanced`로 바꾸면 통합은 반드시 줄어듭니다** — 늘어나는 경우는 없습니다.

### 6.2 그래도 "같은 스코어식의 서로 다른 k"는 아니다

설계 문서를 따라 세 정책을 하나의 스코어식에 다른 `k`를 넣은 것으로 읽는 설명이 흔합니다. 사슬은 맞지만 **식은 그렇게 되어 있지 않습니다.**

`WhenEmpty`의 판정은 비율이 아니라 **원시 비용에 대한 절대 임계**입니다 — `IsEmpty()`는 `RescheduleDisruptionCost <= 1.0`이고(`types.go:155-157`) 분모도 savings도 등장하지 않습니다.

`k→0`으로 표현할 수도 없습니다. 임계 `1/k`가 무한대가 되어 `Score`가 `+Inf`여야 통과하는데 앞에서 봤듯 **비용은 절대 0이 되지 않습니다.** `k→0`은 "빈 노드를 지운다"가 아니라 **"아무것도 지우지 않는다"** 에 수렴합니다.

## 7. 새로 추가된 Balanced 정책

### 7.1 기준선 — `WhenEmptyOrUnderutilized`가 하는 일

Balanced를 이해하려면 그 아래 깔린 경로부터 봐야 합니다. 스코어는 여기 없습니다.

{{< flow src="_flow/7-1-기준선-whenemptyorunderutilized.json" />}}

**게이트가 둘뿐입니다** — "모든 파드가 다른 데 들어가는가", 그리고 교체라면 "엄격히 더 싼가". 절감의 **규모**를 묻는 곳이 없습니다. "10원 아끼려고 파드 40개를 옮긴다"가 여기서 나옵니다.

### 7.2 Balanced가 얹는 게이트

Balanced는 코어 v1.14.0에서 추가됐습니다. 위 경로로도 충분히 많은 것을 할 수 있었지만, 절감 규모를 묻지 않는다는 구멍이 남아 있었습니다.

**Balanced는 새로운 통합을 만들지 않습니다.** 위 경로가 만든 커맨드를 받아 심사할 뿐이라 **거부만 할 수 있습니다.**

{{< flow src="_flow/7-2-balanced-는-그-위에.json" />}}

승인 조건은 이것뿐입니다.

```
score = (savings / disruptionCost) ÷ (TotalCost / TotalDisruptionCost)  ≥  1/k = 0.5

  savings              삭제 노드 가격 합 − 생성 노드 가격
  disruptionCost       후보들의 RescheduleDisruptionCost 합
  TotalCost            그 NodePool의 총비용
  TotalDisruptionCost  그 NodePool에 속한 **모든 노드**의 disruption cost 합
```

크로스풀 커맨드면 `savings`를 소스 풀의 비용 비율로 안분해 **풀마다 따로** 심사하고, 한 풀이라도 미달이면 커맨드 전체가 거부됩니다.

```
Balanced 승인 집합  ⊂  WhenEmptyOrUnderutilized 승인 집합
```

"Balanced로 바꾸면 통합이 더 될까"는 방향이 틀린 질문입니다. 항상 덜 됩니다. 물어야 할 것은 **무엇이 덜 되는가**입니다.

### 7.3 그 조건이 실제로 뜻하는 것

식을 옮겨 쓰면 무엇을 재는지가 분명해집니다.

```
score = (savings / disruptionCost) ÷ (TotalCost / TotalDisruptionCost)
         └─ 이 액션의 효율 ─┘         └─ 풀의 평균 효율 ─┘
```

**풀의 "파괴 1단위당 비용"이 기준선이고, 액션은 그 절반 이상의 효율을 내야 합니다.** 분모가 풀 전체라 **풀 크기는 약분되어 영향이 없고**, 한산하고 비싼 노드가 많은 풀일수록 기준선이 높아 통과가 어렵습니다.

균질한 풀에 평균 파드밀도를 가정하면 `score ≈ 절감률 × (평균 밀도 / 그 노드의 밀도)`로 줄어듭니다. **평균 밀도 노드라면 50% 이상 싸지는 교체만 통과**하고, 한산한 노드는 쉬워지며 빽빽한 노드는 보호됩니다. 코드 인용이 아니라 유도입니다.

### 7.4 `k`는 바꿀 수 없다

Go `const`이고 호출부 두 곳 모두 상수를 그대로 넘깁니다. NodePool 필드도, 플래그도, feature gate도 없습니다.

```go
// apis/v1/nodepool.go:167-171
// k=2 is the smallest value where within-family replaces pass, with 4-step max churn.
const BalancedK int32 = 2
```

주석이 선택 근거를 밝힙니다 — **같은 패밀리 한 단계 다운사이징(4xlarge → 2xlarge)이 정확히 50% 절감**이라, 그 교체가 겨우 통과하는 지점입니다. **조절하려면 임계가 아니라 분모(`pod-deletion-cost`)를 건드려야 합니다.**

### 7.5 언제 효과가 없나

| 증상 | Balanced의 효과 |
|---|---|
| 한계 절감 통합으로 churn이 잦다 | **정확히 겨냥한다** |
| 바쁜 노드가 자꾸 흔들린다 | **자동 보호** — 파드밀도가 분모다 |
| 빈 노드 정리가 시끄럽다 | **없음** — Emptiness가 우회한다 |
| drift로 노드가 갈린다 | **없음** — 통합 경로가 아니다 |
| 세대가 자꾸 내려간다 | **없음** — 스코어에 세대·weight가 없다 |
| 비용 절감이 최우선이다 | **손해** — 한계 절감이 거부된다 |

가운데 셋이 중요합니다. **"노드가 자꾸 교체된다"의 원인이 통합이 아니면 Balanced는 아무것도 바꾸지 않습니다.** `karpenter_nodeclaims_disrupted_total{reason}`으로 원인을 먼저 가릅니다([09 §3]({{< relref "09-metrics-logs-events.md" >}})).

### 7.6 켜기

```yaml
spec:
  disruption:
    consolidationPolicy: Balanced
    consolidateAfter: 1m
```

feature gate가 없습니다 — 설계 RFC는 `BalancedConsolidation` 게이트로 옵트인한다고 적었지만 **구현에는 없습니다.** 코어 **v1.14.0이 최초**이고(core#2962) 그 이하에서는 enum에 없어 admission에서 거부됩니다. 도입 판정은 [02 §6.2]({{< relref "02-changelog-maturity.md" >}})가 소유합니다.

## 8. 어떻게 개입하나

### 8.1 `pod-deletion-cost`로 비용을 조절한다

값을 키우면 그 파드의 `EvictionCost`가 올라 노드의 disruption cost가 오릅니다. 알아야 할 것 셋입니다.

- **`Balanced`에서만 보호로 작동합니다.** 다른 두 정책은 스코어 게이트가 없어 삭제 여부가 안 바뀌고, 바뀌는 건 정렬 **순서**뿐입니다.
- **제로섬입니다.** 노드 A의 분자만 오르는 게 아니라 **풀 분모도 함께 오릅니다.** A는 불리해지지만 같은 풀의 B는 오히려 삭제되기 쉬워집니다 — "이 파드를 보호하면 끝"이 아니라 "압력을 옮긴다"가 정확합니다.
- **큰 음수는 역효과입니다.** `EvictionCost`가 `-10`으로 클램프되고 노드 합산에서 `max(0,·)`로 0이 되어 그 노드가 `IsEmpty() == true`가 됩니다. 그러면 **정책과 무관하게 Emptiness가 지웁니다.**

아무 설정도 안 하면 파드별 비용이 전부 `1.0`이라 스코어는 사실상 **"절감 비율 대 파드 개수 비율"** 비교로 축퇴합니다.

### 8.2 예산으로 실행량을 조인다

정책과 예산은 **다른 축입니다.**

| | `consolidationPolicy` | `budgets[].reasons` |
|---|---|---|
| 값 | `WhenEmpty` · `WhenEmptyOrUnderutilized` · `Balanced` | `Empty` · `Underutilized` · `Drifted` |
| 정하는 것 | **후보를 만들지 말지** | **몇 대나 실행할지** |
| 시간축 | 없음 | `schedule` · `duration` |

`Drifted`는 consolidation이 만들지 않습니다. drift는 별도 경로라 v1에서 끌 수 없어, 정책을 뭘로 두든 계속 판정됩니다.

예산은 실행 속도만 조이는 게 아니라 **후보 풀 자체를 자릅니다.** 탐색 전에 예산이 0인 NodePool의 후보는 건너뛰고, 넣을 때마다 그 풀의 예산을 하나씩 깎습니다(`multinodeconsolidation.go:65-77`). multi-node는 후보가 2개 미만이면 즉시 빈 커맨드를 반환하므로, **한 NodePool의 예산이 `1`이면 그 풀의 multi-node 통합은 아예 성립하지 않습니다.** `nodes: "1"`은 흔한 보수적 설정인데 의도는 대개 "천천히 줄이자"이지 "합치기를 끄자"가 아닙니다. 퍼센트는 올림이라 작은 풀에서는 `20%`도 1이 될 수 있습니다([08 §2]({{< relref "08-disruption-budgets.md" >}})).

**흔적이 다른 것이 실무적으로 중요합니다.** `consolidationPolicy: WhenEmpty`로 막으면 후보 단계에서 탈락해 **이벤트가 안 남고**, 예산 `0`으로 막으면 후보는 만들어지고 실행만 차단되어 `DisruptionBlocked`가 쌓입니다. **예산 쪽이 진단 가능성 면에서 낫습니다** — [08 §5]({{< relref "08-disruption-budgets.md" >}})이 예산을 진단 1순위에 두는 이유입니다.

## 9. 어떻게 관측하나

`Unconsolidatable` 이벤트의 message가 사유를 그대로 말합니다.

| message | 뜻 |
|---|---|
| `NodePool %q has consolidation policy WhenEmpty, but node is not empty` | 정책이 막았다 |
| `Can't replace with a cheaper node` | 가격 부등식에서 탈락 |
| `Can't remove without creating %d candidates` | 대체가 2대 이상 필요 |
| `Node %q has buffer pods` | Capacity Buffers가 잡고 있다 |
| `NodePool %q has consolidation disabled` | `consolidateAfter`가 `nil` |

**제약이 하나 있습니다 — 위 사유들은 후보가 1대일 때만 발행됩니다.** multi-node가 왜 실패했는지는 `--log-level debug`의 판정 로그를 봐야 합니다([09 §5]({{< relref "09-metrics-logs-events.md" >}})).

Balanced는 **승인만 이벤트를 남기고 거부는 메트릭만 남깁니다**(`balanced.go:218-219`). 거부 사유는 `karpenter_consolidation_score`와 debug 로그의 `consolidation score` 줄로 봅니다.

## 10. 근거

`kubernetes-sigs/karpenter` **v1.14.0** 로컬 체크아웃. 경로는 `pkg/` 기준이고, 별도 표기가 없으면 `controllers/disruption/`입니다.

- 한 바퀴 순서 — `controller.go:150-181`(루프), `:184-231`(`disrupt()`), 폴링 `:71`
- Method 등록 순서 · 인터페이스 — `controller.go:101-118`, `types.go:63-69`
- `Reason()` 다섯 구현 — `emptiness.go:112`, `staticdrift.go:108`, `drift.go:110`, `multinodeconsolidation.go:248`, `singlenodeconsolidation.go:128`
- 후보 1차 관문 · Candidate 구성 — `types.go:160-208`, 수집은 `helpers.go:196-216`
- **Emptiness가 정책을 안 읽음** — `emptiness.go:42-59`, Command `:97-100`
- 시뮬레이션 · 삭제/교체 판정 · 가격 필터 — `consolidation.go:162, 172-178, 181-195, 221`, `types.go:257-266`
- **대체 최대 1대** — `consolidation.go:189-195`, 주석 `validation.go:326-329`
- **Drift도 교체형을 만듦** — `drift.go:58`(자격), `:84`(시뮬레이션), `:98-100`(Command)
- **Emptiness·StaticDrift는 시뮬레이션을 타지 않음** — `emptiness.go:96-99`(Replacements 미설정 → 항상 삭제), `staticdrift.go:92-99`(대체 1대를 무조건 생성 → 항상 교체). `SimulateScheduling` 호출은 `drift.go`와 `consolidation.go` 두 곳뿐
- **`SavingsRatio` 정렬은 multi-node 전용이 아님** — `consolidation.go:138-153`(`Price / RescheduleDisruptionCost` 내림차순), 호출부는 `emptiness.go:68` · `singlenodeconsolidation.go:142` · `multinodeconsolidation.go:56` 셋
- multi-node 탐색·예산 사전 필터 — `multinodeconsolidation.go:65-81, 117-191`. single-node 타임아웃은 `singlenodeconsolidation.go:33`
- 실행 · 재검증 — `queue.go:196-223, 293`, `validation.go:192-204`
- base cost `1.0` · `IsEmpty` · `SavingsRatio` — `types.go:134, 136-142, 145, 155-157`
- `EvictionCost` · `IsReschedulable` — `utils/disruption/disruption.go:47-69`, `utils/pod/scheduling.go:44-51`
- `Score` · `Threshold` · `Approved` — `types.go:99-111`
- **`LifetimeRemaining`이 dead field에만 곱해짐** — `types.go:207` 대 읽기 지점 부재
- `ScoreMove` · `BalancedK` — `balanced.go:47-121`, `apis/v1/nodepool.go:167-176`
- `Balanced` 도입 — core#2962, 최초 태그 `v1.14.0`
- `Unconsolidatable` message · 거부는 이벤트 없음 — `consolidation.go:111-313`, `balanced.go:218-219`

**확인하지 못한 것** — `controller.kubernetes.io/pod-deletion-cost`의 상수 원문은 `k8s.io/api` 모듈 소스가 로컬에 없어 확인하지 못했습니다.
