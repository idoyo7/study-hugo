---
title: "consolidation은 무엇을 하는가"
weight: 11
---

# 11 · consolidation은 무엇을 하는가 — 세 Method와 비용 모델

{{< callout type="info" >}}
**한눈에**
- consolidation은 단일 알고리즘이 아니라 **세 개의 독립 Method**(Emptiness · MultiNode · SingleNode)가 `Command` 하나를 공유하는 구조다.
- **대체 노드는 액션당 최대 1대다** — *"all of our node replacement is m→1, never m→n"*.
- **`Emptiness`는 `consolidationPolicy`를 읽지 않는다.** 세 정책 어디서든 빈 노드는 Emptiness가 지우고, **`Balanced`에서도 스코어링을 우회한다.**
- **예산 `1`은 multi-node consolidation을 죽인다** — 예산이 실행 속도만이 아니라 **후보 풀 자체를 자르기** 때문이다(§2.4).
- **`Balanced`는 `WhenEmptyOrUnderutilized`의 부분집합**이라 거부만 할 수 있고, 임계 `k=2`는 **상수라 바꿀 수 없다**(§5).
{{< /callout >}}

> **왜 이 문서인가.** "consolidation이 왜 이 노드를 골랐나"는 정책 이름만으로 답이 안 나온다. 어떤 Method가 후보를 만들었는지, 삭제인지 교체인지, 비용 모델이 무엇을 셌는지가 갈린다.
>
> 세대가 내려가고 안 돌아오는 문제는 [06]({{< relref "06-consolidation-traps.md" >}})이, 실행 속도를 예산으로 조이는 축은 [08]({{< relref "08-disruption-budgets.md" >}})이 소유한다. **정책은 생성기이고 예산은 조리개다**(§7).

## 1. 두 형태 — 삭제와 교체

`Command`가 `Replacements`를 가지는지로 갈린다(`types.go:257-266`).

| 형태 | 조건 | 가격 검사 |
|---|---|---|
| **삭제** | 후보의 파드가 전부 기존 노드에 들어감 | **없음** |
| **교체** | 대체 NodeClaim 1대가 필요함 | `launchPrice < candidatePrice` (strict) |

**삭제형에 가격 검사가 없다**는 게 자주 오해되는 지점이다. 새 NodeClaim이 0개면 그 자리에서 반환하고(`consolidation.go:181-187`) 가격 필터(`:221`)에 도달하지 않는다 — 가격 조회가 실패해 `Price == 0`인 노드도 삭제된다.

## 2. 세 Method

```
Emptiness → StaticDrift → Drift → MultiNode → SingleNode
```

등록 순서이고 **첫 성공 Method에서 루프가 끝난다**(`controller.go:101-115, 167-179`). 폴링은 10초다.

### 2.1 Emptiness는 정책을 읽지 않는다

`Emptiness.ShouldDisrupt`(`emptiness.go:42-59`)가 보는 것은 셋뿐이다 — static NodePool이 아닌가, `consolidateAfter`가 `nil`이 아닌가, 버퍼 파드가 없는가. **`consolidationPolicy`는 조회조차 하지 않는다.**

```go
// This emptiness should run for both WhenEmpty and WhenEmptyOrUnderutilized
```

반대로 consolidation 쪽은 빈 노드를 배제한다(`consolidation.go:126-129`). 담당이 겹치지 않게 갈라져 있고, 결과가 §4의 핵심이다 — **`Balanced` 풀에서도 빈 노드 삭제는 스코어를 거치지 않는다.** Emptiness의 Command는 `Replacements`를 채우지 않아 항상 삭제형이다(`emptiness.go:97-100`).

### 2.2 대체 노드는 최대 1대

새 NodeClaim이 2개 이상 필요하면 **커맨드 자체가 만들어지지 않는다**(`consolidation.go:189-195`). 재검증 단계 주석이 가장 분명하다.

```go
// validation.go:326-329
// (all of our node replacement is m->1, never m->n)
```

### 2.3 multi-node는 prefix 이진 탐색이다

| 항목 | 값 |
|---|---|
| 정렬 키 | `SavingsRatio` = `Price / RescheduleDisruptionCost` 내림차순 |
| 탐색 대상 | `candidates[0:mid+1]` — **prefix만** |
| 배치 범위 | 최소 2대, 최대 100대 |
| 타임아웃 | 1분. single-node는 3분 |

**임의 부분집합을 시도하지 않는다.** 게다가 이진 탐색은 단조성을 전제하는데 코드에 그 보장이 없어 **최적해를 놓칠 수 있다.**

### 2.4 예산이 후보 풀 자체를 자른다

탐색 **전에** 예산이 후보를 걸러낸다 — 예산이 0인 NodePool의 후보는 건너뛰고, 넣을 때마다 그 풀의 예산을 하나씩 깎는다(`multinodeconsolidation.go:65-77`). 그리고 `firstNConsolidationOption`은 **후보가 2개 미만이면 즉시 빈 커맨드를 반환**한다.

**둘을 겹치면 — 한 NodePool의 예산이 `1`이면 그 풀의 multi-node consolidation은 아예 성립하지 않는다.** `nodes: "1"`은 흔한 보수적 설정인데 의도는 대개 "천천히 줄이자"이지 "합치기를 끄자"가 아니다. 퍼센트는 올림이라 작은 풀에서는 `20%`도 1이 될 수 있다([08 §2]({{< relref "08-disruption-budgets.md" >}})).

## 3. disruption cost 모델

```go
// types.go:136-141
cost := PerNodeBaseDisruptionCost          // = 1.0
for _, p := range reschedulablePods {
    cost += math.Max(0, disruptionutils.EvictionCost(ctx, p))
}
```

base `1.0`은 cordon·drain·대체 노드 기동 지연 자체의 비용이다. **그래서 비용은 어떤 경우에도 1.0 미만이 되지 않는다** — §4의 근거다. 파드별 비용은 기본 `1.0`에 `pod-deletion-cost / 2^27`과 `priority / 2^25`를 더하고 `[-10, 10]`으로 클램프한다(`utils/disruption/disruption.go:47-69`). 대상은 `IsReschedulable` 통과분뿐이라 **DaemonSet은 세지 않는다.**

**시간 가중치는 없다.** `LifetimeRemaining`이 곱해지는 `Candidate.DisruptionCost`는 읽는 비테스트 코드가 없는 dead field다(`types.go:207`). "만료 임박 노드가 먼저 지워진다"는 서술은 v1.14.0 기준으로 틀렸다.

## 4. 세 정책은 "같은 모델의 서로 다른 k"가 아니다

설계 문서를 따라 세 정책을 하나의 스코어식에 다른 `k`를 넣은 것으로 읽는 설명이 흔하다. **코드는 그렇게 되어 있지 않다.** 실제 경로는 §5.1~5.2의 도식 둘이 보여준다.

| 정책 | 실제로 무엇을 하나 |
|---|---|
| `WhenEmpty` | consolidation 경로를 **통째로 차단**하고 Emptiness만 남긴다 |
| `WhenEmptyOrUnderutilized` | consolidation을 열되 **스코어 게이트가 없다** |
| `Balanced` | 위 게이트 **위에** 스코어 조건을 얹는다 |

`WhenEmpty`의 판정은 비율이 아니라 **원시 비용에 대한 절대 임계**다 — `IsEmpty()`는 `RescheduleDisruptionCost <= 1.0`이고(`types.go:155-157`) 분모도 savings도 등장하지 않는다.

`k→0`으로 표현할 수도 없다. 임계 `1/k`가 무한대가 되어 `Score`가 `+Inf`여야 통과하는데 §3에서 봤듯 **비용은 절대 0이 되지 않는다.** `k→0`은 "빈 노드를 지운다"가 아니라 **"아무것도 지우지 않는다"** 에 수렴한다.

## 5. Balanced — 기존과 무엇이 다른가

### 5.1 먼저 기준선 — `WhenEmptyOrUnderutilized`가 하는 일

Balanced를 이해하려면 그 아래 깔린 경로부터 봐야 한다. 스코어는 여기 없다.

{{< flow caption="WhenEmptyOrUnderutilized — 빈 노드는 Emptiness가, 나머지는 시뮬레이션이 처리한다. 삭제 경로에는 가격 검사가 아예 없고, 교체 경로만 엄격한 가격 부등식을 통과해야 한다" >}}
{
  "nodes": [
    { "id": "C", "col": 0, "row": 1, "label": "후보 노드", "sub": "Consolidatable = true", "kind": "src" },
    { "id": "E", "col": 1, "row": 0, "label": "Emptiness", "sub": "정책을 읽지 않는다", "kind": "query" },
    { "id": "S", "col": 1, "row": 1, "label": "시뮬레이션", "sub": "파드가 어디로 가나", "kind": "proc" },
    { "id": "D", "col": 2, "row": 0, "label": "삭제", "sub": "가격 검사 없음", "kind": "sink" },
    { "id": "P", "col": 2, "row": 1, "label": "가격 필터", "sub": "launchPrice < 현재가", "kind": "proc" },
    { "id": "R", "col": 3, "row": 1, "label": "교체", "sub": "대체는 최대 1대", "kind": "sink" },
    { "id": "B", "col": 4, "row": 0, "label": "예산", "sub": "이유별 허용량이 다시 조인다", "kind": "store" }
  ],
  "edges": [
    { "from": "C", "to": "E", "label": "IsEmpty", "rate": 900, "speed": "fast" },
    { "from": "C", "to": "S", "label": "비어있지 않음", "rate": 520 },
    { "from": "E", "to": "D", "label": "스코어 없음", "rate": 900, "speed": "fast" },
    { "from": "S", "to": "D", "label": "파드가 다 들어감", "rate": 420 },
    { "from": "S", "to": "P", "label": "대체 1대 필요", "rate": 420 },
    { "from": "P", "to": "R", "label": "더 싸다", "rate": 640 },
    { "from": "D", "to": "B", "dashed": true },
    { "from": "R", "to": "B", "dashed": true }
  ]
}
{{< /flow >}}

**게이트가 둘뿐이다** — "모든 파드가 다른 데 들어가는가", 그리고 교체라면 "엄격히 더 싼가". 절감의 **규모**를 묻는 곳이 없다. "10원 아끼려고 파드 40개를 옮긴다"가 여기서 나온다.

### 5.2 Balanced는 그 위에 게이트를 하나 얹는다

Balanced는 새로운 통합을 **만들지 않는다.** 위 경로가 만든 커맨드를 받아 심사할 뿐이라 **거부만 할 수 있다.**

{{< flow caption="Balanced는 WhenEmptyOrUnderutilized의 승인분을 입력으로 받는다 — 빈 노드 삭제는 Emptiness 출신이라 스코어를 우회하고, 나머지만 채점된다" >}}
{
  "nodes": [
    { "id": "W", "col": 0, "row": 1, "label": "WEOU 승인분", "sub": "5.1 도식의 결과", "kind": "src" },
    { "id": "EM", "col": 1, "row": 0, "label": "Emptiness 출신", "sub": "ApproveCommand를 안 탄다", "kind": "query" },
    { "id": "SC", "col": 1, "row": 1, "label": "ScoreMove", "sub": "NodePool별로 채점", "kind": "proc" },
    { "id": "OK", "col": 2, "row": 0, "label": "승인", "sub": "예산 단계로", "kind": "sink" },
    { "id": "NO", "col": 2, "row": 1, "label": "거부", "sub": "메트릭만 · 이벤트 없음", "kind": "store" }
  ],
  "edges": [
    { "from": "W", "to": "EM", "label": "빈 노드 삭제", "rate": 900, "speed": "fast" },
    { "from": "W", "to": "SC", "label": "그 외 전부", "rate": 520 },
    { "from": "EM", "to": "OK", "label": "무조건 통과", "dashed": true },
    { "from": "SC", "to": "OK", "label": "score ≥ 0.5", "rate": 640 },
    { "from": "SC", "to": "NO", "label": "score < 0.5", "rate": 640 }
  ]
}
{{< /flow >}}

승인 조건은 이것뿐이다.

```
score = (savings / disruptionCost) ÷ (TotalCost / TotalDisruptionCost)  ≥  1/k = 0.5

  savings              삭제 노드 가격 합 − 생성 노드 가격
  disruptionCost       후보들의 RescheduleDisruptionCost 합
  TotalCost            그 NodePool의 총비용
  TotalDisruptionCost  그 NodePool에 속한 **모든 노드**의 disruption cost 합
```

크로스풀 커맨드면 `savings`를 소스 풀의 비용 비율로 안분해 **풀마다 따로** 심사하고, 한 풀이라도 미달이면 커맨드 전체가 거부된다.

```
Balanced 승인 집합  ⊂  WhenEmptyOrUnderutilized 승인 집합
```

"Balanced로 바꾸면 통합이 더 될까"는 방향이 틀린 질문이다. 항상 덜 된다. 물어야 할 것은 **무엇이 덜 되는가**다.

### 5.3 그 조건이 실제로 뜻하는 것

식을 옮겨 쓰면 무엇을 재는지가 분명해진다.

```
score = (savings / disruptionCost) ÷ (TotalCost / TotalDisruptionCost)
         └─ 이 액션의 효율 ─┘         └─ 풀의 평균 효율 ─┘
```

**풀의 "파괴 1단위당 비용"이 기준선이고, 액션은 그 절반 이상의 효율을 내야 한다.** 분모가 풀 전체라 **풀 크기는 약분되어 영향이 없고**, 한산하고 비싼 노드가 많은 풀일수록 기준선이 높아 통과가 어렵다.

균질한 풀에 평균 파드밀도를 가정하면 `score ≈ 절감률 × (평균 밀도 / 그 노드의 밀도)`로 줄어든다. **평균 밀도 노드라면 50% 이상 싸지는 교체만 통과**하고, 한산한 노드는 쉬워지며 빽빽한 노드는 보호된다. 코드 인용이 아니라 유도다.

### 5.4 `k`는 바꿀 수 없다

Go `const`이고 호출부 두 곳 모두 상수를 그대로 넘긴다. NodePool 필드도, 플래그도, feature gate도 없다.

```go
// apis/v1/nodepool.go:167-171
// k=2 is the smallest value where within-family replaces pass, with 4-step max churn.
const BalancedK int32 = 2
```

주석이 선택 근거를 밝힌다 — **같은 패밀리 한 단계 다운사이징(4xlarge → 2xlarge)이 정확히 50% 절감**이라, 그 교체가 겨우 통과하는 지점이다. **조절하려면 임계가 아니라 분모(`pod-deletion-cost`, §6)를 건드려야 한다.**

### 5.5 언제 효과가 없나

| 증상 | Balanced의 효과 |
|---|---|
| 한계 절감 통합으로 churn이 잦다 | **정확히 겨냥한다** |
| 바쁜 노드가 자꾸 흔들린다 | **자동 보호** — 파드밀도가 분모다 |
| 빈 노드 정리가 시끄럽다 | **없음** — Emptiness가 우회(§2.1) |
| drift로 노드가 갈린다 | **없음** — 통합 경로가 아니다 |
| 세대가 자꾸 내려간다 | **없음** — 스코어에 세대·weight가 없다 |
| 비용 절감이 최우선이다 | **손해** — 한계 절감이 거부된다 |

가운데 셋이 중요하다. **"노드가 자꾸 교체된다"의 원인이 통합이 아니면 Balanced는 아무것도 바꾸지 않는다.** `karpenter_nodeclaims_disrupted_total{reason}`으로 원인을 먼저 가른다([09 §3]({{< relref "09-metrics-logs-events.md" >}})).

### 5.6 켜기

```yaml
spec:
  disruption:
    consolidationPolicy: Balanced
    consolidateAfter: 1m
```

feature gate가 없다 — 설계 RFC는 `BalancedConsolidation` 게이트로 옵트인한다고 적었지만 **구현에는 없다.** 코어 **v1.14.0이 최초**이고(core#2962) 그 이하에서는 enum에 없어 admission에서 거부된다. 도입 판정은 [02 §7.2]({{< relref "02-changelog-maturity.md" >}})가 소유한다.

## 6. `pod-deletion-cost`로 개입하기

값을 키우면 그 파드의 `EvictionCost`가 올라 노드의 disruption cost가 오른다. 알아야 할 것 셋이다.

- **`Balanced`에서만 보호로 작동한다.** 다른 두 정책은 스코어 게이트가 없어 삭제 여부가 안 바뀌고, 바뀌는 건 `SavingsRatio` 정렬 **순서**뿐이다.
- **제로섬이다.** 노드 A의 분자만 오르는 게 아니라 **풀 분모도 함께 오른다.** A는 불리해지지만 같은 풀의 B는 오히려 삭제되기 쉬워진다 — "이 파드를 보호하면 끝"이 아니라 "압력을 옮긴다"가 정확하다.
- **큰 음수는 역효과다.** `EvictionCost`가 `-10`으로 클램프되고 노드 합산에서 `max(0,·)`로 0이 되어 그 노드가 `IsEmpty() == true`가 된다. 그러면 **정책과 무관하게 Emptiness가 지운다.**

아무 설정도 안 하면 파드별 비용이 전부 `1.0`이라 스코어는 사실상 **"절감 비율 대 파드 개수 비율"** 비교로 축퇴한다.

## 7. 정책과 예산 — 두 축이다

| | `consolidationPolicy` | `budgets[].reasons` |
|---|---|---|
| 값 | `WhenEmpty` · `WhenEmptyOrUnderutilized` · `Balanced` | `Empty` · `Underutilized` · `Drifted` |
| 정하는 것 | **후보를 만들지 말지** | **몇 대나 실행할지** |
| 시간축 | 없음 | `schedule` · `duration` |

`Drifted`는 consolidation이 만들지 않는다. drift는 별도 Method이고 v1에서 끌 수 없어, 정책을 뭘로 두든 계속 판정된다.

예산 쪽 허용량이 **이유별로 어떻게 계산되고 합쳐지는지**는 [08 §2]({{< relref "08-disruption-budgets.md" >}})의 도식이 소유한다 — `MaxInt32`에서 시작해 조건을 통과한 예산들의 `min()`으로 좁혀지는 구조다.

**흔적이 다른 것이 실무적으로 중요하다.** `consolidationPolicy: WhenEmpty`로 막으면 후보 단계에서 탈락해 **이벤트가 안 남고**, 예산 `0`으로 막으면 후보는 만들어지고 실행만 차단되어 `DisruptionBlocked`가 쌓인다. **예산 쪽이 진단 가능성 면에서 낫다** — [08 §6]({{< relref "08-disruption-budgets.md" >}})이 예산을 진단 1순위에 두는 이유다.

## 8. 관측

`Unconsolidatable` 이벤트의 message가 사유를 그대로 말한다.

| message | 뜻 |
|---|---|
| `NodePool %q has consolidation policy WhenEmpty, but node is not empty` | 정책이 막았다 |
| `Can't replace with a cheaper node` | 가격 부등식에서 탈락 |
| `Can't remove without creating %d candidates` | 대체가 2대 이상 필요(§2.2) |
| `Node %q has buffer pods` | Capacity Buffers가 잡고 있다 |
| `NodePool %q has consolidation disabled` | `consolidateAfter`가 `nil` |

**제약이 하나 있다 — 위 사유들은 후보가 1대일 때만 발행된다.** multi-node가 왜 실패했는지는 `--log-level debug`의 판정 로그를 봐야 한다([09 §5]({{< relref "09-metrics-logs-events.md" >}})).

Balanced는 **승인만 이벤트를 남기고 거부는 메트릭만 남긴다**(`balanced.go:218-219`). 거부 사유는 `karpenter_consolidation_score`와 debug 로그의 `consolidation score` 줄로 본다.

## 9. 근거

`kubernetes-sigs/karpenter` **v1.14.0-6-gac7a021e** 로컬 체크아웃. 경로는 `pkg/` 기준.

- 삭제/교체 판정 · 가격 검사 부재 — `controllers/disruption/types.go:257-266`, `consolidation.go:181-187, 221`
- Method 등록 순서 · 첫 성공 종료 · 폴링 10초 — `controllers/disruption/controller.go:71, 101-115, 167-179`
- **Emptiness가 정책을 안 읽음** — `emptiness.go:42-59`, Command `:97-100`
- **대체 최대 1대** — `consolidation.go:189-195`, 주석 `validation.go:326-329`
- multi-node prefix 이진 탐색 · 예산 사전 필터 — `multinodeconsolidation.go:35, 65-81, 117-191`. single-node 타임아웃은 `singlenodeconsolidation.go:33`
- base cost `1.0` · `IsEmpty` · `SavingsRatio` — `types.go:134, 136-142, 145, 155-157`
- `EvictionCost` · `IsReschedulable` — `utils/disruption/disruption.go:47-69`, `utils/pod/scheduling.go:44-51`
- `Score` · `Threshold` · `Approved` — `types.go:99-111`
- **`LifetimeRemaining`이 dead field에만 곱해짐** — `types.go:207` 대 읽기 지점 부재
- `ScoreMove` · `BalancedK` — `balanced.go:47-121`, `apis/v1/nodepool.go:167-176`
- `Balanced` 도입 — core#2962, 최초 태그 `v1.14.0`
- `Unconsolidatable` message · 거부는 이벤트 없음 — `consolidation.go:111-313`, `balanced.go:218-219`

**확인하지 못한 것** — `controller.kubernetes.io/pod-deletion-cost`의 상수 원문은 `k8s.io/api` 모듈 소스가 로컬에 없어 확인하지 못했다.
