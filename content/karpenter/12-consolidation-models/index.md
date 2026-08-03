---
title: “consolidation은 무엇을 하는가”
weight: 12
---

# 12 · consolidation은 무엇을 하는가

## 1. 10초마다 무슨 일이 일어나나

Karpenter가 프로비저닝했던 노드들은 다음과 같은 루프를 돌며 “잘 쓰고 있었는가”를 평가합니다.

```
① 삭제 대상 검사    전체 노드를 훑어 손대도 되는 것만 남긴다
② 삭제 분류        Empty · Drifted · Underutilized 중 어디에
③ 시뮬레이션       지우면 새 노드가 몇 대 필요한가
④ 수행            삭제는 바로 · 교체는 대체 노드 기동 후 · 아니면 그대로

이 네 단계들을 매번 반복합니다.
Emptiness → Drift → MultiNode → SingleNode
```

{{< flow src="_flow/1-한-바퀴.json" />}}

## 2. 어떤 노드가 검사 대상인가

검사는 **클러스터의 모든 Karpenter 노드**들이 대상입니다. 
매 바퀴 모든 노드들을 검사하면서, **결격 사유 있는 노드들을 배제**하는 형태로 동작합니다.

### 2.1 검사 대상에 예외가 있는데

중간에 노드 삭제 대상으로 분류하지 않는 케이스는 이렇습니다.

| 삭제 방지 조건 | 상세 설명 |
|---|---|
| **PDB에 걸림** | 파드를 노드에서 축출 불가능 |
| 파드에 `do-not-disrupt` | 사용자가 명시적으로 제한 |
| 노드에 `do-not-disrupt` | 사용자가 명시적으로 제한 |
| `Initialized` 상태가 아님 | 기동 중인 노드는 대상에서 배제 |

외에도 새로운 파드들을 스케줄링 중이거나, NodePool 자체의 상태가 변경되는 엣지 케이스들이 있지만 여기서는 다루지 않겠습니다.

검사에서 떨어지면 `DisruptionBlocked` 이벤트가 남습니다.
여기서는 “죽일까?” 정도의 분류만 진행한 것이고 이제 “왜?”를 찾게 되는 단계로 넘어갑니다.

### 2.2 삭제 후보는 어떤 것들을 볼까

검사를 통과하면 그 노드는 `Candidate`가 되고, 이때 다음 값들이 함께 계산됩니다.

| 키워드 | 설명 | 비고 |
|---|---|---|
| `Price` | 그 노드의 **시간당 가격** | 교체 시 “더 싼가” 비교 |
| `reschedulablePods` | 실제로 옮겨야 할 파드 목록 | **DaemonSet은 제외** |
| `RescheduleDisruptionCost` | 노드 몫 `1.0` + 위 파드들의 비용 합 | 노드 자체를 교체하는데 가중치 부여. `Balanced` 스코어 계산에 사용 |
| `instanceType`<br>`capacityType`<br>`zone` | `Price`를 조회하는 **복합 키** | 셋 중 하나라도 없으면 통합 후보에서 탈락 |


`RescheduleDisruptionCost`는 v1.14에서 `Balanced` 모드 계산을 위해 추가된 필드입니다.
같은 `m8g.xlarge`라도 AZ, `spot` 혹은 `on-demand` 상태의 노드가 또 다르기 때문에, 하나라도 다르다면 비교를 진행하지 않습니다.

```
Price / RescheduleDisruptionCost  =  $/시간 ÷ 파드 수  =  파드 하나 옮기는 대가로 시간당 아끼는 돈
```

**파드 하나 옮기는 비용이 얼마나 되는가**를 Karpenter 내부적으로 계산합니다.
이 비율이 큰 노드부터 정렬하니, **비싸면서 한산한 노드가 먼저** 정리됩니다.

`RescheduleDisruptionCost`는 **DaemonSet은 모두 제외하고**
노드 자체를 삭제하는 비용을 base로 `1` 설정해 cordon·drain·대체 노드 기동 지연 자체의 비용으로 계산합니다.
파드별 비용은 기본 `1`에 `pod-deletion-cost`로 같이 합산되어 계산합니다.

## 3. 어떤 이유로 노드를 삭제할까

앞에서 검사 대상으로 확인된 노드는 아직 어떻게 할지를 결정하지 않았었습니다.
노드는 세 가지 중 하나로 분류되고, **Reason**으로 기록을 합니다.

| Reason의 종류 | 세부 설명 |
|---|---|
| `Empty` | 파드가 없는 노드 |
| `Drifted` | NodePool 스펙과 어긋난 노드 |
| `Underutilized` | 합쳐서 줄일 수 있는 노드 |

이 셋을 위에서부터 차례로 시도하고, 먼저 걸리는 쪽이 그 노드의 Reason이 됩니다.

{{< flow src="_flow/3-세-분류.json" />}}

`Underutilized`는 두 가지로 나뉘는데요, `SingleNode`와 `MultiNode`로 나눠집니다.

**`SingleNode` — 맨 앞 한 대의 파드를 새 노드로 옮깁니다.** 
실패하면 다음 후보로 내려가고, 삭제가 가능한 노드를 찾을 때까지 수행합니다.

{{< mnode variant="single" >}}

**`MultiNode` — 앞에서부터 여러 대를 한꺼번에 집습니다.** 
여러 대를 동시에 묶은 만큼 비용도 합쳐지지만, **한 대씩 정리하는 것만으로는 나오지 않을 조합**이 여기서 나옵니다.

{{< mnode variant="multi" >}}

두 도식 모두 **집는 순간 비용 합계가 확정되고**(옅은 칸), 파드를 옮기면서 그 값을 치릅니다(진한 칸). 옮기면서 계산하는 게 아니라 **후보를 만들 때 이미 정해진 값**입니다.

**실행 순서는 `MultiNode` → `SingleNode` 순서대로 진행됩니다.** 
`MultiNode`가 먼저 돌고, 수행 가능한 시나리오를 찾으면 그 라운드는 거기서 끝납니다. 
`SingleNode`는 `MultiNode`가 실패했을 때, 후보를 다 훑기 전에 3분이 지나면 중단합니다 — 이때 못 본 NodePool이 있었다면, 다음 라운드에 먼저 봅니다.

## 4. 정책 셋은 무엇이 다른가

앞에서 본 `Underutilized`의 실행이 실제로는 세 가지 정책에 맞게 갈라집니다.
표에 나오는 "삭제 또는 교체"가 무엇에서 갈리는지는 뒤에서 따로 봅니다.


| 정책 | 빈 노드 | 그 외 후보 | 통과해야 할 게이트 |
|---|---|---|---|
| `WhenEmpty` | 삭제 | **그냥 삭제 대상임** | 없음 |
| `WhenEmptyOrUnderutilized` | 삭제 (같음) | 시뮬레이션 후 삭제 또는 교체 | 파드 재배치 + (교체면) 가격 |
| `Balanced` | 삭제 (같음) | 시뮬레이션 후 **스코어 심사** | `WhenEmptyOrUnderutilized` 방식 + `score ≥ 0.5` |

```
적게 지움  ←────────────────────────────────────→  많이 지움

WhenEmpty        Balanced        WhenEmptyOrUnderutilized
```

**세 정책은 “얼마나 지우느냐” 정도로 보시면 될 것 같습니다.**
`Empty` 노드가 아닌 `WhenEmptyOrUnderutilized` 개념이 Karpenter의 강점이었다고 생각합니다.
오른쪽으로 갈수록 삭제 강도가 커지는 개념이지만, 너무 공격적인 축출을 방지하기 위해 1.14 버전에서 생긴 `Balanced`가 새로운 기준들을 보강했습니다.

## 5. 새로 추가된 `Balanced` 정책

어떻게 보수적으로 노드를 제거할 수 있을까요?

### 5.1 기준선 — `WhenEmptyOrUnderutilized`가 하는 일

`Balanced`를 이해하려면 기존에 `WhenEmptyOrUnderutilized`가 수행되는 방식을 먼저 봐야 합니다.

{{< flow src="_flow/5-1-기준선-whenemptyorunderutilized.json" />}}

"파드들을 전부 다른 노드에 배치할 수 있을까?", 그리고 "새로운 노드로 교체하면 저렴해?"
두 개의 조건으로만 필터링을 한다면, 10원 아끼려고 파드 40개를 옮겨버리는 케이스가 발생합니다.
- init 단계에서 부하가 더 발생되는 경우나, PDB로 보호를 하고 있어도 서비스의 안정성이 더 떨어지는 것들이죠.

### 5.2 `Balanced`가 얹는 게이트

`Balanced`는 이런 심한 Drift를 방지하기 위해 v1.14.0에서 추가됐습니다. 
`WhenEmptyOrUnderutilized`가 놓치는 걸 잡고, Drift를 조금 더 조심스럽게 수행하기로 했습니다.
기존에는 삭제 대상으로 잡힌 노드여도, 검증을 한 차례 더 수행하여 "절감을 수행하는 것" 자체의 비용을 따집니다.

```
Balanced 승인 집합  ⊂  WhenEmptyOrUnderutilized 승인 집합
```
애초에 추가 검증을 한 단계 더 추가한 만큼, `WhenEmptyOrUnderutilized`가 10개를 지운다고 해도, `Balanced` 모드는 10개를 초과해 삭제하는 일은 없을 겁니다.

{{< flow src="_flow/5-2-balanced-는-그-위에.json" />}}

추가된 검증 과정입니다.
기존의 `WhenEmptyOrUnderutilized` 말고 `WhenEmpty` 조건에서부터 삭제 대상으로 잡히는 `Empty` 노드는 볼 필요가 없고
`ScoreMove`라는 검증을 통해 0.5점 이상이 기록되어야 삭제를 수행합니다.

```
score = (savings / disruptionCost) ÷ (TotalCost / TotalDisruptionCost)  ≥  1/k = 0.5

  savings              삭제 노드 가격 합 − 생성 노드 가격
  disruptionCost       후보들의 RescheduleDisruptionCost 합
  TotalCost            그 NodePool의 총비용
  TotalDisruptionCost  그 NodePool에 속한 모든 노드의 disruption cost 합
```

공식에 들어가는 변수가 좀 많지만, 조금 더 간단하게 풀어보겠습니다.

### 5.3 그 조건이 실제로 뜻하는 것

식에 담겨있는 변수들은 크게 두 가지 관점에서 볼 수 있습니다.

```
score = (savings / disruptionCost) ÷ (TotalCost / TotalDisruptionCost)
           └─ 이 액션의 효율 ─┘                └─ 풀의 평균 효율 ─┘
```

| 위치 | 항목 | 정체 | 커지는 경우 |
|---|---|---|---|
| 분자 | `savings` | 삭제면 후보 가격 **전액**<br>교체면 −대체 노드 최저가 | 순수 삭제 |
| 분자 | `TotalDisruptionCost` | 풀 **전체 노드**의 비용 합 | 파드가 빽빽한 풀 |
| 분모 | `TotalCost` | 풀 총비용 | 큰 타입 · 온디맨드 |
| 분모 | `disruptionCost` | **이 커맨드** 후보들의 합 | 빽빽한 노드 · `MultiNode` 묶음 |

`savings`와 `TotalCost`는 달러이고, `disruptionCost`와 `TotalDisruptionCost`는 사실상 파드 개수입니다.

분모가 작고 분자가 클수록 점수가 높으니, **적은 파드를 옮기면서 절감액이 큰** 통합이 가장 잘 통과합니다.

균질한 풀에 평균 파드밀도를 가정하면 `score ≈ 절감률 × (평균 밀도 / 그 노드의 밀도)`로 줄어듭니다. 
**평균 밀도 노드라면 50% 이상 싸지는 교체만 통과**하고, 한산한 노드는 쉬워지며 빽빽한 노드는 보호됩니다.

{{< bscore >}}
<!-- 
**`k`는 바꿀 수 없습니다.** `BalancedK`는 Go `const int32 = 2`이고 호출부 두 곳 모두 상수를 그대로 넘겨(`balanced.go:159, 297`) NodePool 필드도 플래그도 feature gate도 없습니다 — 설계 문서는 `consolidationPolicy: 3`으로 `k`를 노출한다고 적었지만(`balanced-consolidation.md:361`) enum이 문자열 셋뿐이라(`nodepool.go:100`) admission에서 거부됩니다. `0.5`라는 값 자체는 **같은 인스턴스 패밀리 한 단계 다운사이징이 정확히 50% 절감**이라는 가격 구조에 맞춘 것이고, `k=1`이면 대체 노드가 무료여야 통과라 아무 교체도 못 지나갑니다. 그래서 세 정책을 “같은 스코어식에 다른 `k`”로 읽는 설명은 틀립니다 — `WhenEmpty`의 판정은 비율이 아니라 `IsEmpty()`의 **절대 임계**입니다(`types.go:155-157`). 조절하려면 임계가 아니라 분모(`pod-deletion-cost`)를 건드려야 합니다. -->


### 5.6 언제 효과가 있을까?

노드 교체가 잦다.
- 기존에 "더 싸기만 하면 Drift"에서 추가된 안전한(보수적인) 절감입니다.
파드가 많이 떠 있는 노드도 교체를 실시한다.
- 옮길 파드 수를 같이 고려해 아무 노드나 교체하지 않습니다.


## 6. 삭제냐 교체냐

앞에서 계속 나온 **삭제와 교체**를 세부적으로 살펴보겠습니다.
절감 가능한 노드로 분류된 노드들은 **시뮬레이션 한 번**으로 셋 중 하나 — 아무것도 안 하거나(`no-op`), 그냥 지우거나(`delete`), 대신 한 대를 띄우고 지우거나(`replace`) 결정합니다.

### 6.1 시뮬레이션 — 새 노드가 몇 대 필요한가

`no-op`: 아무것도 하지 않음
`delete`: 그저 삭제함 
`replace`: 교체 대상은 신규 노드일까? 기존 노드일까?

후보로 선정된 노드를 클러스터에서 **가상으로 지우고**, 파드를 다시 스케줄해본 뒤 **새로 띄워야 할 노드가 몇 대인가**를 계산해봅니다.

파드가 하나라도 갈 곳이 없으면 그 자리에서 끝납니다.

### 6.2 얼마짜리를 몇 대?

시뮬레이션이 요구한 새 노드 대수가 그대로 형태를 정합니다.

{{< flow src="_flow/6-2-두-형태-삭제와-교체.json" />}}

신규로 필요한 노드가 0대면 `Replacements`를 비운 채 반환(곧장 삭제)하고, 
1대면 가격 필터를 거쳐 **새로 띄울 노드가 지울 노드들의 가격 합보다 싼지 가격**을 채웁니다. 

```
launchPrice  <  Σ Price(후보들)
```

### 6.3 분류가 된 이후에


| | 정하는 주체 | 값 |
|---|---|---|
| **Reason** | 어떤 분류인가 | `Empty` · `Drifted` · `Underutilized` |
| **Decision** | 어떻게 처리할 것인가 | `delete` · `replace` · `no-op` |

{{< flow src="_flow/6-3-reason에서-decision까지.json" />}}

시뮬레이션을 거치는 두 갈래에서는 네 조합이 전부 정상적으로 나옵니다.

| Reason | Decision | 언제 이렇게 되나 | 가격 검사 |
|---|---|---|---|
| `Drifted` | `delete` | 파드가 남은 노드에 전부 들어감 | X |
| `Drifted` | `replace` | 받아줄 자리가 없어 새 노드가 필요함 | X |
| `Underutilized` | `delete` | 여러 대를 지우고 기존 노드가 흡수함 | X |
| `Underutilized` | `replace` | `4xlarge` 한 대를 `2xlarge` 한 대로 | **O** — 엄격히 더 싸야 합니다 |

`Empty`는 빈 노드라 옮길 파드가 없어 **대체 시뮬레이션 자체를 하지않습니다.**

<!-- 보류 — 부록으로 옮겨 다시 쓸 것. 점수 환산 수치는 소스 재검증 완료본이다.

## 7. 어떻게 개입하나

### 7.1 `pod-deletion-cost`로 비용을 조절한다

먼저 점수판부터 봅니다. 노드 하나의 무게는 이렇게 쌓입니다.

| 항목 | 점수 |
|---|---|
| 노드 자체 | **1점** — cordon·drain·새 노드 기동 |
| 재배치 대상 파드 하나 | **1점** |
| DaemonSet 파드 | **0점** — 옮길 필요가 없어 세지 않습니다 |

그래서 **노드 무게 ≈ 1 + 옮겨야 할 파드 수**입니다. 파드 4개짜리 노드는 5점입니다.

여기에 파드 점수를 바꾸는 손잡이가 둘 붙는데, **둘 다 억 단위를 넣어야 1점이 움직입니다.**

| 손잡이 | 1점을 만드는 값 | 상한에 닿는 값 |
|---|---|---|
| `pod-deletion-cost` | **1.3억** | 12억 |
| `priority` | **0.34억** | 3억 |

억 단위로 읽으면 `1.3`과 `0.34` — 이 두 숫자가 이 절의 전부입니다.

#### 그래서 흔히 쓰는 값은 0점입니다

| 넣은 값 | 점수 | |
|---|---|---|
| `1000` | 0.000007점 | 사실상 0 |
| `100만` | 0.007점 | 여전히 0 |
| `1300만` | 0.1점 | 겨우 보이기 시작 |
| **`1.3억`** | **1점** | 파드 하나가 둘이 됨 |
| `12억` 이상 | **10점에서 멈춤** | 더 넣어도 소용없음 |

k8s 문서가 ReplicaSet 다운스케일 예시로 드는 `100`·`1000`은 **Karpenter 비용 계산에서 no-op입니다.** 파드 4개짜리 노드(5점)를 6점으로 만들려면 어느 파드 하나에 **1.35억**을 넣어야 합니다.

**파드 하나는 아무리 무거워도 10점입니다.** 12.1억에서 상한에 닿으니, int32 최대인 21억을 넣어도 결과는 같습니다.

#### `priority` — 안 만져도 이미 걸려 있습니다

`priority`는 나눗수가 작아 `pod-deletion-cost`보다 **4배 강합니다.** 그런데도 **사람이 만드는 PriorityClass로는 점수가 움직이지 않습니다.**

| PriorityClass | 값 | 파드 점수 |
|---|---|---|
| 사용자 정의 (흔한 범위) | 1,000 ~ 100만 | 1.00003 ~ **1.03점** |
| 사용자 정의 최대 | 10억 | 계산상 30.8점 → **10점** |
| `system-cluster-critical` | **20억** | 계산상 60.6점 → **10점** |
| `system-node-critical` | 20억 + 1,000 | **10점** |

**유의미한 점수가 나오는 것은 system-critical 급뿐입니다.** 나눗수가 억 단위라(`2^25` ≈ 0.34억) 그 아래 값은 전부 소수점에서 사라집니다. `pod-deletion-cost`도 같은 자릿수(`2^27` ≈ 1.3억)와 비교되니, 두 손잡이 모두 **"억을 넣어야 점수가 된다"**는 성질이 같습니다.

실무에서 이게 눈에 띄는 이유는 coredns 때문입니다. coredns는 **DaemonSet 소유가 아니라 재배치 대상에 들어가고**, `system-cluster-critical`을 쓰니 **파드 하나가 10점**입니다. coredns 2개가 뜬 노드는 그것만으로 `1 + 10 + 10 = 21점`이라, 평범한 파드 20개짜리 노드와 같은 무게가 됩니다.

즉 5.6의 "바쁜 노드도 함부로 교체하지 않는다"는 파드 개수만이 아니라 **`priority`로도 기본 작동합니다.** 단 `priority`는 스케줄링과 preemption을 함께 바꾸므로, **비용 조절용 손잡이가 아니라 이미 걸려 있는 값으로 읽어야 합니다.**

#### 손대기 전에 알아야 할 셋

- **`Balanced`에서만 보호로 작동합니다.** 다른 두 정책은 스코어 게이트가 없어 삭제 여부가 안 바뀌고, 바뀌는 건 정렬 **순서**뿐입니다.
- **제로섬입니다.** 올린 점수는 노드 A에만 쌓이는 게 아니라 **풀 전체 합계에도 그대로 더해집니다.** A는 점수가 내려가 보호되지만, 그만큼 풀 기준선이 낮아져 **같은 풀의 B는 오히려 지워지기 쉬워집니다** — "이 파드를 보호하면 끝"이 아니라 "압력을 옆으로 옮긴다"가 정확합니다.
- **큰 음수는 역효과입니다.** **`-1.35억`이면 그 파드 점수가 0 이하로 내려가고**, 노드 합산이 음수 기여를 0으로 깎아 그 파드는 점수판에서 사라집니다. 재배치 대상 파드가 **전부** 그렇게 되면 노드가 정확히 1점이 되고, `IsEmpty()`가 **1점 이하**라 빈 노드로 판정됩니다. 보호하려던 파드가 얹힌 노드가 **정책과 무관하게 가장 먼저 지워집니다.**

아무 설정도 없고 system 우선순위 파드도 없으면 파드가 전부 1점이라, 스코어는 사실상 **"절감 비율 대 파드 개수 비율"** 비교로 축퇴합니다.

### 7.2 예산으로 실행량을 조인다

정책과 예산은 **다른 축입니다.**

| | `consolidationPolicy` | `budgets[].reasons` |
|---|---|---|
| 값 | `WhenEmpty` · `WhenEmptyOrUnderutilized` · `Balanced` | `Empty` · `Underutilized` · `Drifted` |
| 정하는 것 | **후보를 만들지 말지** | **몇 대나 실행할지** |
| 시간축 | 없음 | `schedule` · `duration` |

`Drifted`는 통합이 만들지 않습니다. `Drift`는 별도 경로라 v1에서 끌 수 없어, 정책을 뭘로 두든 계속 판정됩니다.

예산은 실행 속도만 조이는 게 아니라 **후보 풀 자체를 자릅니다.** 탐색 전에 예산이 0인 NodePool의 후보는 건너뛰고, 넣을 때마다 그 풀의 예산을 하나씩 깎습니다(`multinodeconsolidation.go:65-77`). multi-node는 후보가 2개 미만이면 즉시 빈 커맨드를 반환하므로, **한 NodePool의 예산이 `1`이면 그 풀의 multi-node 통합은 아예 성립하지 않습니다.** `nodes: "1"`은 흔한 보수적 설정인데 의도는 대개 “천천히 줄이자”이지 “합치기를 끄자”가 아닙니다. 퍼센트는 올림이라 작은 풀에서는 `20%`도 1이 될 수 있습니다.

**흔적이 다른 것이 실무적으로 중요합니다.** `consolidationPolicy: WhenEmpty`로 막으면 후보 단계에서 탈락해 **이벤트가 안 남고**, 예산 `0`으로 막으면 후보는 만들어지고 실행만 차단되어 `DisruptionBlocked`가 쌓입니다. **진단 가능성 면에서는 예산 쪽이 낫습니다** — 막힌 흔적이 이벤트로 남기 때문입니다.

-->

## 8. 어떻게 관측하나

`Unconsolidatable` 이벤트의 `message`가 사유를 그대로 말합니다.

| message | 뜻 |
|---|---|
| `NodePool %q has consolidation policy WhenEmpty, but node is not empty` | 정책이 막았다 |
| `Can't replace with a cheaper node` | 가격 부등식에서 탈락 |
| `Can't remove without creating %d candidates` | 대체가 2대 이상 필요 |
| `Node %q has buffer pods` | Capacity Buffers가 잡고 있다 |
| `NodePool %q has consolidation disabled` | `consolidateAfter`가 `nil` |

**제약이 하나 있습니다 — 위 사유들은 후보가 1대일 때만 발행됩니다.** `MultiNode`가 왜 실패했는지는 `--log-level debug`의 판정 로그를 봐야 합니다.

`Balanced`는 **승인만 이벤트를 남기고 거부는 메트릭만 남깁니다**(`balanced.go:218-219`). 거부 사유는 `karpenter_consolidation_score`와 debug 로그의 `consolidation score` 줄로 봅니다.

## 9. 근거

`kubernetes-sigs/karpenter` **v1.14.0** 로컬 체크아웃. 경로는 `pkg/` 기준이고, 별도 표기가 없으면 `controllers/disruption/`입니다.

- 한 바퀴 순서 — `controller.go:150-181`(루프), `:184-231`(`disrupt()`), 폴링 `:71`
- Method 등록 순서 · 인터페이스 — `controller.go:101-118`, `types.go:63-69`
- `Reason()` 구현 — `emptiness.go:112`, `drift.go:110`, `multinodeconsolidation.go:248`, `singlenodeconsolidation.go:128`
- 후보 1차 관문 · `Candidate` 구성 — `types.go:160-208`, 수집은 `helpers.go:196-216`
- **Emptiness가 정책을 안 읽음** — `emptiness.go:42-59`, Command `:97-100`
- 시뮬레이션 · 삭제/교체 판정 · 가격 필터 — `consolidation.go:162, 172-178, 181-195, 221`, `types.go:257-266`
- **대체 최대 1대** — `consolidation.go:189-195`, 주석 `validation.go:326-329`
- **Drift도 교체형을 만듦** — `drift.go:58`(자격), `:84`(시뮬레이션), `:98-100`(Command)
- **Emptiness는 시뮬레이션을 타지 않음** — `emptiness.go:96-99`(`Replacements` 미설정 → 항상 삭제). `SimulateScheduling` 호출은 `drift.go`와 `consolidation.go` 두 곳뿐
- **`SavingsRatio` 정렬은 multi-node 전용이 아님** — `consolidation.go:138-153`(`Price / RescheduleDisruptionCost` 내림차순), 호출부는 `emptiness.go:68` · `singlenodeconsolidation.go:142` · `multinodeconsolidation.go:56` 셋
- multi-node 탐색·예산 사전 필터 — `multinodeconsolidation.go:65-81, 117-191`. single-node 타임아웃은 `singlenodeconsolidation.go:33`
- 실행 · 재검증 — `queue.go:196-223, 293`, `validation.go:192-204`
- base cost `1.0` · `IsEmpty` · `SavingsRatio` — `types.go:134, 136-142, 145, 155-157`
- `EvictionCost` · `IsReschedulable` — `utils/disruption/disruption.go:47-69`, `utils/pod/scheduling.go:44-51`
- `Score` · `Threshold` · `Approved` — `types.go:99-111`
- **`LifetimeRemaining`이 dead field에만 곱해짐** — `types.go:207` 대 읽기 지점 부재. 단 동명이인 `state.StateNode.DisruptionCost()`는 살아있음(`state/statenode.go:430`, 호출 `balanced.go:84`), 공식 자체도 `controllers/static/deprovisioning/controller.go:302-303`에서 계속 쓰임
- `ScoreMove` · `BalancedK` — `balanced.go:47-121`, `apis/v1/nodepool.go:167-176`
- `Balanced` 도입 — core#2962, 최초 태그 `v1.14.0`
- `Unconsolidatable` message · 거부는 이벤트 없음 — `consolidation.go:111-313`, `balanced.go:218-219`

**1.14 이전 대조** — v1.13.0 태그 기준. `Candidate` 구조체 `types.go:72-79`, 비용 대입 `types.go:133-134`(`ReschedulingCost(모든 파드) × LifetimeRemaining`), 정렬 `consolidation.go:125-131`(오름차순) · `singlenodeconsolidation.go:138-148`. `Price` · `RescheduleDisruptionCost` · `PerNodeBaseDisruptionCost` · `SavingsRatio`는 v1.13.0 `pkg/` 전체에 심볼 부재 — 넷 다 커밋 `43964dc5`(#2962)로 함께 유입, 포함 태그는 `v1.14.0`뿐. v1.0.0~v1.13.0 사이 수식 변경 없음(필드 export 리네임 `4372b529`, 로깅 정리 `a1aedde7`, 접근자 변경 `1b5824bc`뿐). single-node의 NodePool 교차배치·3분 타임아웃은 v1.4.0(#2035) 산이라 1.14 경계와 무관.

**가중치 자릿수** — 나눗수가 int32 극단에 맞춰져 `pod-deletion-cost`는 ±16파드분(`2^27` = 134,217,728), `priority`는 −64~+29.8파드분(`2^25` = 33,554,432)으로 사상됩니다. 파드 하나를 2.0으로 만들려면 각각 134,217,728 / 33,554,432가 필요해 `1000` 수준의 값은 사실상 no-op입니다. `priority` 상한은 `HighestUserDefinablePriority = int32(1000000000)`, `system-cluster-critical`은 그 두 배라 클램프에 걸려 `10.0`이 됩니다(kubernetes `v1.35.1 pkg/apis/scheduling/types.go:30, 32`). 어노테이션 상수 원문은 `v1.35.1 staging/src/k8s.io/api/core/v1/annotation_key_constants.go:142` — karpenter-core v1.14.0이 핀한 `k8s.io/api v0.35.1`과 같은 소스입니다.

## 부록 · 운영자는 어떻게 개입하나

`consolidateAfter`(후보가 되기까지의 대기), `pod-deletion-cost`(파드 하나의 무게), `disruption.budgets`(실행량) — 세 수단이 각각 다른 축을 제어합니다. 이 자리에 다시 정리합니다.
