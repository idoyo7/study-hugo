---
title: "consolidation은 무엇을 하는가"
weight: 11
---

# 11 · consolidation은 무엇을 하는가 — 세 Method와 비용 모델

{{< callout type="info" >}}
**한눈에**
- consolidation은 단일 알고리즘이 아니라 **세 개의 독립 Method**(Emptiness · MultiNode · SingleNode)가 `Command` 구조체 하나를 공유하는 구조다.
- **대체 노드는 액션당 최대 1대다.** 코드 주석이 그대로 말한다 — *"all of our node replacement is m→1, never m→n"*.
- **`Emptiness`는 `consolidationPolicy`를 읽지 않는다.** 세 정책 어디서든 빈 노드는 Emptiness가 지우고, **`Balanced`에서도 스코어링을 우회한다.**
- **삭제형에는 가격 검사가 없다.** "모든 파드가 다른 노드에 들어가는가"만 본다. 엄격한 가격 부등식은 교체형에만 걸린다.
- **disruption cost는 절대 0이 되지 않는다** — 노드 하나가 base `1.0`을 깔고 시작한다. 이 사실이 아래 §4의 근거다.
- **`pod-deletion-cost`는 `Balanced`에서만 보호 장치다.** 다른 두 정책에서는 평가 **순서**만 바꾼다. 그리고 풀 분모도 같이 올라 **같은 풀의 다른 노드로 압력이 옮겨간다.**
- **예산 `1`은 multi-node consolidation을 죽인다.** 예산이 실행 속도만이 아니라 **후보 풀 자체를 자르기** 때문이다(§2.4).
- **`Balanced`는 `WhenEmptyOrUnderutilized`의 부분집합**이라 거부만 할 수 있다. 판별식은 대략 **상대 절감률 × (평균 파드밀도 / 그 노드의 파드밀도) ≥ 0.5** 로 정리된다(§5.4).
{{< /callout >}}

> **왜 이 문서인가.** "consolidation이 왜 이 노드를 골랐나"는 정책 이름만으로 답이 안 나온다. 실제로는 어떤 Method가 후보를 만들었는지, 삭제인지 교체인지, 비용 모델이 무엇을 셌는지가 갈린다. 이 문서가 그 층을 소유한다.
>
> 세대가 내려가고 안 돌아오는 문제는 [06]({{< relref "06-consolidation-traps.md" >}})이, 실행 속도를 예산으로 조이는 축은 [08]({{< relref "08-disruption-budgets.md" >}})이 소유한다. **정책은 생성기이고 예산은 조리개다** — §7에서 두 축을 맞춰 본다.

## 1. 두 형태 — 삭제와 교체

`Command`가 `Replacements`를 가지는지로 갈린다(`types.go:257-266`).

| 형태 | 조건 | 가격 검사 |
|---|---|---|
| **삭제** | 후보의 파드가 전부 기존 노드에 들어감 | **없음** |
| **교체** | 대체 NodeClaim 1대가 필요함 | `launchPrice < candidatePrice` (strict) |

삭제형에 가격 검사가 없다는 게 자주 오해되는 지점이다. 시뮬레이션 결과 새 NodeClaim이 0개면 그 자리에서 반환하고(`consolidation.go:181-187`), 가격 필터(`:221`)에는 도달하지도 않는다. **가격 조회가 실패해 `Price == 0`인 노드도 삭제된다.**

## 2. 세 Method — 실행 순서와 제약

```
Emptiness → StaticDrift → Drift → MultiNode → SingleNode
```

`controller.go:101-115`의 등록 순서이고, **첫 성공 Method에서 루프가 끝난다**(`:167-179`). 폴링은 10초다.

### 2.1 Emptiness는 정책을 읽지 않는다

`Emptiness.ShouldDisrupt`(`emptiness.go:42-59`)가 보는 것은 셋뿐이다 — static NodePool이 아닌가, `consolidateAfter`가 `nil`이 아닌가, 버퍼 파드가 없는가. **`consolidationPolicy`는 조회조차 하지 않는다.** 코드 주석이 의도를 밝힌다.

```go
// If consolidation is disabled, don't do anything.
// This emptiness should run for both WhenEmpty and WhenEmptyOrUnderutilized
```

반대로 consolidation 쪽은 빈 노드를 **배제한다**(`consolidation.go:126-129`). 둘의 담당이 겹치지 않게 갈라져 있다.

결과가 §4의 핵심이다 — **`Balanced` 풀에서도 빈 노드 삭제는 스코어를 거치지 않는다.** Emptiness의 Command는 `Replacements`를 아예 채우지 않아 항상 삭제형이고(`emptiness.go:97-100`), 승인 게이트(`ApproveCommand`)를 한 번도 호출하지 않는다.

### 2.2 대체 노드는 최대 1대

시뮬레이션이 새 NodeClaim을 2개 이상 요구하면 **커맨드 자체가 만들어지지 않는다**(`consolidation.go:189-195`). 재검증 단계의 주석이 가장 분명하다.

```go
// validation.go:326-329
// we need more than one replacement node which is never valid currently
// (all of our node replacement is m->1, never m->n)
```

즉 "노드 여러 대를 여러 대로 재배치"는 한 액션으로 일어나지 않는다. 통과하는 경우는 `0`(삭제)과 `1`(교체)뿐이다.

### 2.3 multi-node는 prefix 이진 탐색이다

| 항목 | 값 |
|---|---|
| 정렬 키 | `SavingsRatio` = `Price / RescheduleDisruptionCost` 내림차순 |
| 탐색 대상 | `candidates[0:mid+1]` — **prefix만** |
| 배치 범위 | 최소 2대, 최대 100대 |
| 반환값 | 탐색 중 유효했던 **가장 큰 prefix** |
| 타임아웃 | 1분 (`const`) |

**임의 부분집합을 시도하지 않는다.** "이 3대와 저 2대를 묶으면 최적"같은 조합 탐색은 없다. 게다가 이진 탐색은 "prefix 길이 n이 유효하면 n−1도 유효"라는 단조성을 전제하는데 코드에 그 보장이 없다 — **최적해를 놓칠 수 있고, 코드도 최적성을 주장하지 않는다.**

### 2.4 예산이 후보 풀 자체를 자른다 — multi-node는 예산 1이면 죽는다

탐색에 들어가기 **전에** 예산이 후보를 먼저 걸러낸다. 순서는 보존하되, 넣을 때마다 그 NodePool의 예산을 하나씩 깎는다.

```go
// multinodeconsolidation.go:65-77
for _, candidate := range candidates {
    if disruptionBudgetMapping[candidate.NodePool.Name] == 0 {
        constrainedByBudgets = true
        continue
    }
    disruptableCandidates = append(disruptableCandidates, candidate)
    disruptionBudgetMapping[candidate.NodePool.Name]--
}
maxParallel := lo.Clamp(len(disruptableCandidates), 0, 100)
```

그리고 `firstNConsolidationOption`은 **후보가 2개 미만이면 즉시 빈 커맨드를 반환**한다.

**두 사실을 겹치면 결론이 하나 나온다 — 한 NodePool의 예산이 `1`이면 그 풀에서 후보가 하나만 들어가므로, 그 풀 안에서의 multi-node consolidation은 아예 성립하지 않는다.** "여러 대를 한 대로 합치는" 경로가 통째로 꺼진다.

`budgets: [{nodes: "1"}]`은 흔한 보수적 설정인데, 의도는 대개 "천천히 줄이자"이지 "합치기를 끄자"가 아니다. 노드를 줄이는 게 목적이라면 **최소 2 이상**이어야 하고, 퍼센트는 올림이므로([08 §2]({{< relref "08-disruption-budgets.md" >}})) 작은 풀에서는 `20%`도 1이 될 수 있다. 축소가 안 되는데 원인을 못 찾겠다면 여기를 먼저 본다.

single-node는 정렬 뒤 NodePool별로 **인터리브**하고, 직전 라운드에 타임아웃으로 못 본 풀을 앞에 놓는다(`singlenodeconsolidation.go:141-172`). 타임아웃은 3분이고 초과하면 아무것도 반환하지 않는다 — multi-node가 마지막 유효 커맨드를 반환하는 것과 다르다.

## 3. disruption cost 모델

노드 하나의 비용은 base에 파드별 비용을 더한 값이다.

```go
// types.go:136-141
cost := PerNodeBaseDisruptionCost          // = 1.0
for _, p := range reschedulablePods {
    cost += math.Max(0, disruptionutils.EvictionCost(ctx, p))
}
```

`PerNodeBaseDisruptionCost = 1.0`은 cordon·drain·API 호출·대체 노드 기동 지연 자체의 비용을 모델링한 상수다. **그래서 비용은 어떤 경우에도 1.0 미만이 되지 않는다.**

파드별 비용은 이렇게 계산된다(`utils/disruption/disruption.go:47-69`).

| 항 | 값 |
|---|---|
| 기본 | `1.0` |
| `pod-deletion-cost` | `+ 값 / 2^27` |
| priority | `+ priority / 2^25` |
| 최종 | `clamp(cost, -10.0, 10.0)` |

대상은 `IsReschedulable`을 통과한 파드뿐이라 **DaemonSet과 노드 소유 파드는 세지 않는다.** 파싱에 실패하면 그 항만 무시하고 `1.0`을 유지한다.

**시간 가중치는 없다.** `LifetimeRemaining`(만료까지 남은 비율)이 곱해지는 곳은 `Candidate.DisruptionCost` 한 곳인데, **그 필드를 읽는 비테스트 코드가 없다.** 정렬에도, `IsEmpty` 판정에도, Balanced 스코어에도 들어가지 않는다. "만료가 임박한 노드는 먼저 지워진다"는 서술은 v1.14.0 기준으로 틀렸다.

## 4. 세 정책은 "같은 모델의 서로 다른 k"가 아니다

업스트림 설계 문서의 서술을 따라 세 정책을 하나의 스코어식에 서로 다른 `k`를 넣은 것으로 읽는 설명이 흔하다. **코드는 그렇게 되어 있지 않다.**

{{< flow caption="Emptiness는 정책과 무관하게 먼저 돌고 스코어링을 우회한다 — Balanced가 심사하는 것은 교체형과 비어있지 않은 노드의 삭제형뿐이다" >}}
{
  "nodes": [
    { "id": "C", "col": 0, "row": 1, "label": "후보 노드", "sub": "Consolidatable 조건 true", "kind": "src" },
    { "id": "E", "col": 1, "row": 0, "label": "Emptiness", "sub": "정책을 읽지 않는다", "kind": "query" },
    { "id": "K", "col": 1, "row": 1, "label": "consolidation", "sub": "WhenEmpty면 여기서 차단", "kind": "proc" },
    { "id": "D", "col": 2, "row": 0, "label": "삭제", "sub": "가격 검사 없음", "kind": "sink" },
    { "id": "P", "col": 2, "row": 1, "label": "가격 필터", "sub": "launchPrice < candidatePrice", "kind": "proc" },
    { "id": "B", "col": 3, "row": 1, "label": "Balanced 스코어", "sub": "score ≥ 1/k = 0.5", "kind": "query" },
    { "id": "OK", "col": 4, "row": 0, "label": "실행", "sub": "budget이 다시 조인다", "kind": "sink" },
    { "id": "NO", "col": 4, "row": 1, "label": "거부", "sub": "메트릭만 남고 이벤트 없음", "kind": "store" }
  ],
  "edges": [
    { "from": "C", "to": "E", "label": "IsEmpty", "rate": 900, "speed": "fast" },
    { "from": "C", "to": "K", "label": "비어있지 않음", "rate": 520 },
    { "from": "E", "to": "D", "label": "스코어링 우회", "rate": 900, "speed": "fast" },
    { "from": "K", "to": "D", "label": "파드가 다 들어감", "rate": 400 },
    { "from": "K", "to": "P", "label": "교체 필요", "rate": 400 },
    { "from": "D", "to": "OK", "dashed": true },
    { "from": "P", "to": "B", "label": "Balanced만", "rate": 640 },
    { "from": "P", "to": "OK", "label": "다른 정책", "dashed": true },
    { "from": "B", "to": "OK", "label": "통과", "rate": 640 },
    { "from": "B", "to": "NO", "label": "미달", "rate": 640 }
  ]
}
{{< /flow >}}

### 4.1 각 정책의 실제 게이트

| 정책 | 실제로 무엇을 하나 |
|---|---|
| `WhenEmpty` | consolidation 경로를 **통째로 차단**하고 Emptiness만 남긴다 |
| `WhenEmptyOrUnderutilized` | consolidation을 열되 **스코어 게이트를 두지 않는다** |
| `Balanced` | 위 게이트 **위에** `savingsFraction / disruptionFraction ≥ 1/2`를 얹는다 |

`WhenEmpty`의 판정은 비율이 아니라 **원시 비용에 대한 절대 임계**다.

```go
// types.go:155-157
func (c *Candidate) IsEmpty() bool {
    return c.RescheduleDisruptionCost <= PerNodeBaseDisruptionCost
}
```

분모도 savings도 등장하지 않는다. Balanced의 스코어와는 **다른 양(quantity)에 대한 다른 술어**다.

### 4.2 왜 `k→0`이 성립하지 않나

`k→0`이면 임계값 `Threshold() = 1/k`가 무한대로 간다. 이걸 넘으려면 `Score()`가 `+Inf`여야 하고, 그건 `disruptionFraction == 0`, 즉 **노드의 disruption cost가 0**일 때뿐이다.

그런데 §3에서 봤듯 **비용은 `1.0`에서 시작하고 음수는 잘린다.** 0이 되는 후보는 존재하지 않는다. 따라서 `k→0`은 "빈 노드를 지운다"가 아니라 **"아무것도 지우지 않는다"** 에 수렴한다 — 실제 동작의 정반대다.

### 4.3 굳이 한 축에 놓으려면

`disruptionCost`를 **"base 초과분"** 으로 재정의해야 빈 노드의 분자가 0이 되어 `k→0`이 말이 된다. 하지만 `ScoreMove`는 base를 포함한 전체 비용을 쓴다. **그 통합은 코드가 아니라 재해석이다.** 이해를 돕는 비유로는 쓸 수 있지만 "Karpenter가 이렇게 계산한다"로 쓰면 틀린다.

`WhenEmptyOrUnderutilized = k=∞`도 결과만 우연히 맞는다. 스코어 자체가 계산되지 않고, 교체 경로에는 `k`로 환원되지 않는 별도 게이트(strict 가격, spot-to-spot 15종 하한, `filterOutSameInstanceType`)가 따로 있다.

## 5. Balanced — 기존과 무엇이 다른가

### 5.1 Balanced는 `WhenEmptyOrUnderutilized`의 부분집합이다

이게 가장 먼저 이해할 사실이다. Balanced는 새로운 통합을 **만들지 않는다.** `WhenEmptyOrUnderutilized`가 만들어낸 커맨드에 승인 게이트를 하나 더 얹을 뿐이라, **거부만 할 수 있고 추가로 승인할 수는 없다.**

```
Balanced가 승인하는 집합  ⊂  WhenEmptyOrUnderutilized가 승인하는 집합
```

그래서 "Balanced로 바꾸면 통합이 더 잘 될까"는 방향이 틀린 질문이다. 항상 **덜** 된다. 질문은 "무엇이 덜 되는가"다.

### 5.2 스코어는 커맨드가 만들어진 뒤에 얹힌다

```
computeConsolidation  →  Command 생성 (가격 필터까지 통과)
        ↓
ApproveCommand  →  후보를 NodePool별로 그룹핑
        ↓
   풀마다 ScoreMove   →  Balanced가 아닌 풀은 skip
        ↓
   모든 Balanced 풀이 통과해야 승인
```

크로스풀 커맨드면 `savings`를 **소스 풀의 비용 비율로 안분**해서 각 풀을 따로 심사한다. 한 풀이라도 미달이면 커맨드 전체가 거부된다.

single-node에는 사전 컷이 하나 더 있다. `CanPassThreshold`가 **"이 노드를 통째로 삭제해 전액을 절감한다"는 상한 시나리오**로 미리 스코어를 돌려, 그 최선의 경우조차 임계를 못 넘으면 계산 자체를 건너뛴다.

### 5.3 분모는 풀 전체다

```
savingsFraction    = savings / TotalCost
disruptionFraction = disruptionCost / TotalDisruptionCost
score = savingsFraction / disruptionFraction        승인: score ≥ 1/k = 0.5
```

`TotalDisruptionCost`가 후보의 합이 아니라 **그 NodePool에 속한 모든 노드의 합**이라는 게 핵심이다. 코드 주석이 명시한다 — *"Second pass over ALL nodes: sum disruption cost per pool."* 후보는 정확한 값을, 비후보는 증분 유지되는 값을 쓴다.

식을 옮겨 쓰면 무엇을 재는지가 분명해진다.

```
score = (savings / disruptionCost) ÷ (TotalCost / TotalDisruptionCost)
         └─ 이 액션의 효율 ─┘        └─ 풀의 평균 효율 ─┘
```

**풀의 "파괴 1단위당 비용"이 기준선이고, 액션은 그 절반 이상의 효율을 내야 한다.** 풀 크기 자체는 영향이 없다 — 노드 수는 분자·분모에서 약분된다. 영향을 주는 것은 풀의 **구성**이다. 한산하고 비싼 노드가 많은 풀은 기준선이 높아져 통과가 어려워지고, 빽빽하고 싼 노드가 많은 풀은 낮아져 쉬워진다.

한 가지 비대칭을 알아둘 것 — `TotalCost`는 `ClusterCost`가 주는 풀 총비용을 쓰되, 그게 없으면 **후보들의 가격 합**으로 폴백한다. 폴백이 걸리면 분모가 작아져 `savingsFraction`이 부풀고 통과가 쉬워진다.

경계 처리 둘도 있다. **`savingsFraction ≤ 0`이면 점수가 `0`** 이라 어떤 `k`에서도 거부되고, 두 총량 중 하나라도 `0` 이하면 zero-value가 반환되어 역시 거부된다.

### 5.4 실제로는 무엇이 걸러지나 — 판별식

공식만으로는 감이 안 오므로 균질한 풀을 가정해 풀어 본다. **아래는 코드 인용이 아니라 유도**다 — 노드 `N`대, 가격 모두 `p`, 파드 파괴비용 평균 `d̄`, 교체 대상 노드의 파괴비용 `d_A`로 두면:

```
savingsFraction    = Δ / (N·p)          Δ = p_old − p_new
disruptionFraction = d_A / (N·d̄)

score = (Δ/p) × (d̄/d_A)
```

즉 **스코어 ≈ 그 노드의 상대 절감률 × (풀 평균 파드밀도 / 그 노드의 파드밀도)** 이고, 임계는 `0.5`다. 세 가지가 따라 나온다.

| 상황 | 결과 |
|---|---|
| 평균 밀도 노드의 교체 | **50% 이상 싸져야** 통과 |
| 파드가 적게 실린 노드 | 배수가 1보다 커져 **통과하기 쉽다** |
| 파드가 빽빽한 노드 | 배수가 1보다 작아져 **보호된다** |

**"50%"가 어디서 오는지 헷갈리지 않게 출처를 분리해 둔다.** 코드에 박힌 숫자는 `k=2` 하나뿐이고, 나머지는 그것을 옮겨 쓴 것이다.

| 단계 | 출처 |
|---|---|
| `k = 2` | 코드 상수 `BalancedK` — **유일한 하드코딩 값** |
| 임계 `0.5` | `Threshold() = 1/k` |
| "50% 절감" | 위 두 가정 아래 임계를 풀어 쓴 **유도** |

즉 50%는 독립적인 기준이 아니라 **임계 0.5가 "균질한 풀 + 평균 파드밀도"에서 갖는 모습**이다. 밀도가 평균에서 벗어나면 그만큼 달라진다.

그런데 이 유도가 설계 의도와 맞아떨어진다. 상수 주석이 근거를 직접 적어 두었다.

```go
// apis/v1/nodepool.go:166-171
// A move is approved when score >= 1/k = 0.5. k=2 is the smallest value
// where within-family replaces pass, with 4-step max churn.
const BalancedK int32 = 2
```

**같은 패밀리에서 한 단계 다운사이징(4xlarge → 2xlarge)이 정확히 50% 절감**이다. `k=2`는 그 교체가 아슬아슬하게 통과하도록 고른 값이고, 유도가 같은 지점에 떨어진다.

삭제형은 `Δ = p`(노드 값 전체)라 `score ≈ d̄/d_A`가 된다. **평균의 2배를 넘게 파드를 이고 있는 노드는 삭제도 거부된다.**

### 5.5 언제 강점이고 언제 무의미한가

| 상황 | Balanced의 효과 |
|---|---|
| 한계 절감 통합으로 churn이 잦다 | **정확히 이걸 겨냥한다** |
| 바쁜 노드가 자꾸 흔들린다 | 파드밀도가 분모라 **자동으로 보호된다** |
| 빈 노드 정리가 시끄럽다 | **효과 없음** — Emptiness가 우회한다(§2.1) |
| drift로 노드가 갈린다 | **효과 없음** — consolidation 경로가 아니다 |
| 세대가 자꾸 내려간다 | **효과 없음** — 스코어에 세대·weight가 없다([06]({{< relref "06-consolidation-traps.md" >}})) |
| 비용 절감이 최우선이다 | **손해** — 한계 절감 액션이 거부되어 청구가 조금 오른다 |

아래 세 줄이 중요하다. **"노드가 자꾸 교체된다"의 원인이 통합이 아니면 Balanced는 아무것도 바꾸지 않는다.** 원인을 먼저 `karpenter_nodeclaims_disrupted_total{reason}`으로 가른 뒤에 정책을 건드리는 순서가 맞다([09 §3]({{< relref "09-metrics-logs-events.md" >}})).

**켜는 법은 한 줄이고 feature gate가 없다.**

```yaml
spec:
  disruption:
    consolidationPolicy: Balanced
    consolidateAfter: 1m
```

설계 RFC에는 `BalancedConsolidation` 게이트로 옵트인한다고 적혀 있지만 **실제 구현에는 그 게이트가 없다.** RFC와 구현의 불일치다. `Balanced`는 코어 **v1.14.0이 최초**이고(core#2962, 2026-07-01 머지) 그 이하에서는 enum에 없어 admission에서 거부된다.

**지금 켤 것인가의 판정은 [02 §7.2]({{< relref "02-changelog-maturity.md" >}})가 소유한다.** 여기서는 무엇이 어떻게 계산되는지까지만 다룬다.

## 6. `pod-deletion-cost`로 개입하기

`controller.kubernetes.io/pod-deletion-cost` 값을 키우면 그 파드의 `EvictionCost`가 오르고 노드의 disruption cost가 오른다. **다만 이게 보호로 작동하는 것은 `Balanced` 풀에서뿐이다.**

| 정책 | 값을 키우면 |
|---|---|
| `Balanced` | 분자가 커져 스코어가 낮아진다 → **실제로 보호** |
| `WhenEmptyOrUnderutilized` | 스코어 게이트가 없어 **삭제 여부는 안 바뀐다** |
| `WhenEmpty` | 같음 |

뒤의 둘에서 바뀌는 것은 **평가 순서**뿐이다. `SavingsRatio` 내림차순 정렬에서 뒤로 밀려 3분 타임아웃 안에 안 걸릴 확률이 올라갈 뿐, 보호 장치가 아니다.

**제로섬이라는 점도 알아야 한다.** 파드 X의 비용을 Δ 올리면 X가 있는 노드 A의 분자만 오르는 게 아니라 **풀 분모도 Δ 오른다.** A는 불리해지지만 같은 풀의 노드 B는 분모만 커져 **오히려 삭제되기 쉬워진다.** "이 파드를 보호하면 끝"이 아니라 "압력을 다른 노드로 옮긴다"가 정확하다.

**큰 음수는 역효과다.** `-2147483647` 같은 값을 주면 `EvictionCost`가 `-10`으로 클램프되고 노드 합산에서 `max(0,·)`로 0이 되어 그 노드가 `IsEmpty() == true`가 된다. 그러면 **정책과 무관하게 Emptiness가 지운다.** 설계 문서도 이를 의도된 동작으로 적어 두었다.

아무 설정도 안 하면 파드별 비용이 전부 `1.0`이라 스코어는 사실상 **"절감 비율 대 파드 개수 비율"** 비교로 축퇴한다.

## 7. 정책과 예산 — 두 축이다

| | `consolidationPolicy` | `budgets[].reasons` |
|---|---|---|
| 값 | `WhenEmpty` · `WhenEmptyOrUnderutilized` · `Balanced` | `Empty` · `Underutilized` · `Drifted` |
| 정하는 것 | **후보를 만들지 말지** | **만들어진 걸 몇 대나 실행할지** |
| 시간축 | 없음 | `schedule` · `duration` |

`Drifted`는 consolidation이 만드는 게 아니다. drift는 별도 Method이고 v1에서 끌 수 없으므로, 정책을 뭘로 두든 계속 판정된다.

**흔적이 다른 것이 실무적으로 중요하다.** "피크에 통합을 멈춘다"는 두 방법으로 달성되는데:

| 방법 | 무슨 일이 나나 | 이벤트 |
|---|---|---|
| `consolidationPolicy: WhenEmpty` | 후보 단계에서 탈락 | **없음** |
| 예산 `nodes: "0"` | 후보는 만들어지고 실행만 차단 | `DisruptionBlocked` 누적 |

예산으로 막는 쪽이 **진단 가능성 면에서 낫다.** [08 §6]({{< relref "08-disruption-budgets.md" >}})이 예산을 진단 1순위에 두는 이유가 이것이다 — 유일하게 증거를 남긴다.

## 8. 관측

`Unconsolidatable` 이벤트의 message가 사유를 그대로 말한다. 자주 보는 것들:

| message | 뜻 |
|---|---|
| `NodePool %q has consolidation policy WhenEmpty, but node is not empty` | 정책이 막았다 |
| `Can't replace with a cheaper node` | 가격 부등식에서 탈락 |
| `Can't remove without creating %d candidates` | 대체가 2대 이상 필요 (§2.2) |
| `Node %q has buffer pods` | Capacity Buffers가 잡고 있다 |
| `NodePool %q has consolidation disabled` | `consolidateAfter`가 `nil` |
| `SpotToSpotConsolidation requires 15 cheaper instance type options...` | spot→spot 하한 미달 |

**중요한 제약이 하나 있다 — 위 사유들은 후보가 1대일 때만 발행된다.** multi-node consolidation은 이 이벤트를 남기지 않는다. multi-node가 왜 실패했는지는 `--log-level debug`의 판정 로그를 봐야 한다([09 §5.1]({{< relref "09-metrics-logs-events.md" >}})).

Balanced는 **승인만 이벤트를 남기고 거부는 메트릭만 남긴다**(`balanced.go:218-219` 주석). 거부 사유를 보려면 `karpenter_consolidation_score`와 debug 로그의 `consolidation score` 줄을 본다.

## 9. 근거

`kubernetes-sigs/karpenter` **v1.14.0-6-gac7a021e** 로컬 체크아웃. 경로는 `pkg/` 기준.

- 삭제/교체 판정 · `Command` — `controllers/disruption/types.go:227-266`
- 삭제형에 가격 검사 없음 — `consolidation.go:181-187` (필터는 `:221`)
- Method 등록 순서 · 첫 성공 종료 · 폴링 10초 — `controllers/disruption/controller.go:71, 101-115, 167-179`
- **Emptiness가 정책을 안 읽음** — `emptiness.go:42-59`, Command에 `Replacements` 없음 `:97-100`
- consolidation이 빈 노드 배제 — `consolidation.go:126-134`
- **대체 최대 1대** — `consolidation.go:189-195`, 주석 `validation.go:326-329`
- multi-node prefix 이진 탐색 · 2~100 · 1분 — `multinodeconsolidation.go:35, 79-81, 117-191`
- single-node 인터리브 · 3분 · `CanPassThreshold` — `singlenodeconsolidation.go:33, 86-90, 141-172`
- base cost `1.0` · 노드 비용 식 · `IsEmpty` · `SavingsRatio` — `types.go:134, 136-142, 145, 155-157`
- `EvictionCost` 계산과 clamp — `utils/disruption/disruption.go:47-69`
- `IsReschedulable` — `utils/pod/scheduling.go:44-51`
- **`LifetimeRemaining`이 dead field에만 곱해짐** — `types.go:207`(대입) 대 읽기 지점 부재
- `ScoreMove` · `Score` · `Threshold` · `BalancedK` — `balanced.go:108-121`, `types.go:99-111`, `apis/v1/nodepool.go:167-176`
- 스코어 흐름 — `balanced.go:47-102, 130-182, 220-250`
- `Balanced` 도입 — core#2962, 커밋 `43964dc5`(2026-07-01), 최초 태그 `v1.14.0`
- `Unconsolidatable` message 15종 — `consolidation.go:111-313`, `emptiness.go:48, 55`; 생성기 `disruption/events/events.go:72-91`
- 거부는 이벤트 없음 — `balanced.go:218-219, 239`
- `Consolidatable` 조건 설정·해제 — `controllers/nodeclaim/disruption/consolidation.go:40-85`

**확인하지 못한 것** — `controller.kubernetes.io/pod-deletion-cost`의 상수 원문은 `k8s.io/api` 모듈 소스가 로컬에 없어 확인하지 못했다(저장소 내 근거는 `designs/balanced-consolidation.md`의 산문 언급). multi-node 이진 탐색의 단조성 위반이 실제로 최적해를 놓치는 사례는 코드상 가능성만 확인했고 실측하지 않았다.
