---
title: "13 · consolidation은 무엇을 하는가 — 후보 선별부터 Balanced 심사까지"
linkTitle: "13 consolidation 처리 흐름"
weight: 13
---

{{< callout type="info" >}}
**먼저 결론**

- consolidation은 사용률이 낮은 노드를 골라 지우는 기능이 아닙니다. **후보 선별 → 사유 판정 → 스케줄링 시뮬레이션 → 삭제 또는 교체**의 네 단계를 매 라운드 반복하고 단계마다 서로 다른 이유로 후보가 떨어져 나갑니다.
- 삭제냐 교체냐를 정하는 것은 사용률이 아니라 **시뮬레이션 결과**입니다. 파드를 전부 다른 노드에 앉힐 수 있으면 삭제, 한 대가 더 필요한데 그게 더 싸면 교체, 두 대 이상 필요하면 아무것도 하지 않습니다.
- **`Balanced`는 기존 알고리즘을 대체하지 않습니다.** `WhenEmptyOrUnderutilized`가 만들어 낸 커맨드에 승인 조건을 하나 더 거는 정책이라, 통합이 늘어나는 경우는 없습니다.
- Drift는 consolidation과 **별개의 disruption method**입니다. 정책을 무엇으로 두든 계속 돌고 `Balanced`의 스코어도 받지 않습니다.
- 이 글은 코어 **v1.14.0** 기준입니다. 인용한 코드 위치는 `kubernetes-sigs/karpenter` 체크아웃(`v1.14.0-6-gac7a021e`)을 직접 열어 확인했습니다.
{{< /callout >}}

## 1. 전체 처리 흐름

### 1.1 Disruption Controller 안에서의 위치

consolidation에는 전용 컨트롤러가 없습니다. Disruption Controller 하나가 **다섯 개의 method**를 등록해 두고 순서대로 물어봅니다.

| 순서 | Method | 담당 | 붙는 Reason | 정책을 읽나 |
|---|---|---|---|---|
| 1 | `Emptiness` | 빈 노드 | `Empty` | **아니오** |
| 2 | `StaticDrift` | static NodePool(`spec.replicas`)의 drift | `Drifted` | 아니오 |
| 3 | `Drift` | 그 외 NodePool의 drift | `Drifted` | 아니오 |
| 4 | `MultiNodeConsolidation` | 여러 대를 한 대로 | `Underutilized` | **예** |
| 5 | `SingleNodeConsolidation` | 한 대씩 | `Underutilized` | **예** |

`consolidationPolicy`를 읽는 것은 **4번과 5번뿐**입니다. 그래서 정책을 `WhenEmpty`로 바꿔도 drift는 그대로 돌고 `Balanced`로 바꿔도 빈 노드는 채점 없이 지워집니다. 이 글의 범위는 1·4·5번입니다. drift가 왜 걸리고 어떻게 되돌리는지는 [consolidation이 되돌리는 것]({{< relref "06-consolidation-traps.md" >}})이 소유합니다.

2번과 3번은 서로 배타적입니다. `StaticDrift`는 `spec.replicas`가 지정된 NodePool의 노드만, `Drift`는 그렇지 않은 노드만 봅니다.

### 1.2 한 바퀴

{{< flow src="_flow/1-한-바퀴.json" />}}

- 등록 순서대로 method를 시도하고 **처음으로 커맨드를 만든 method에서 그 라운드가 끝납니다.** 뒤에 남은 method는 아예 돌지 않습니다.
- 한 라운드에 한 액션이 아니라 **한 라운드에 한 method**입니다. 한 method가 커맨드를 여러 개 만들면 그것들은 동시에 큐에 들어갑니다.
- 아무 method도 움직이지 않으면 10초 뒤에 다시 돕니다. 어느 하나가 성공하면 즉시 재큐되므로, 실제 주기는 "10초 고정"이 아니라 **"최대 10초"**로 읽는 편이 맞습니다.

## 2. 후보 선별과 제외 조건

### 2.1 두 단계로 걸러진다

후보 목록은 한 번에 만들어지지 않습니다. 클러스터의 **모든 노드**에 대해 먼저 `Candidate`를 만들어 보고 그다음 method별 필터가 한 번 더 걸러냅니다.

| 단계 | 하는 일 | 탈락하면 |
|---|---|---|
| **1차 — `NewCandidate`** | 손대도 되는 노드인가 | 어떤 method의 후보도 되지 못합니다 |
| **2차 — `ShouldDisrupt`** | 이 method가 다룰 노드인가 | 그 method에서만 빠집니다 |

1차에서 걸리는 대표적인 조건입니다.

| 제외 조건 | 설명 |
|---|---|
| 이미 실행 큐에 있음 | 직전 라운드가 처리 중인 노드입니다 |
| `Initialized` 상태가 아님 | 기동 중인 노드는 대상에서 뺍니다 |
| 삭제 표시됨 · 삭제 진행 중 | 이미 없어지는 중입니다 |
| Nominated | 직전 프로비저닝이 pending 파드용으로 찜해 둔 노드입니다 |
| 노드에 `do-not-disrupt` | 사용자가 명시적으로 막았습니다 |
| 파드에 `do-not-disrupt` | 같은 이유입니다 |
| PDB가 축출을 막음 | `disruptionsAllowed`가 0이거나, 한 파드에 PDB가 둘 이상 매칭됩니다 |
| `karpenter.sh/nodepool` 라벨 없음 · NodePool 조회 실패 | Karpenter가 관리하는 노드로 볼 수 없습니다 |

2차 조건은 method마다 다릅니다. consolidation 계열은 `consolidateAfter`가 `Never`인 NodePool, static NodePool, 인스턴스 타입이나 zone·capacity-type 라벨이 없는 노드, 그리고 **빈 노드**를 뺍니다. 빈 노드를 빼는 것은 예산 회계를 위해 `Emptiness`가 전담하도록 역할을 나눠 놓았기 때문입니다.

{{< callout type="warning" >}}
**제외됐다고 항상 이벤트가 남지는 않습니다.** `DisruptionBlocked`는 do-not-disrupt·PDB·NodePool 조회 실패 같은 일부 조건에서만 발행됩니다. 이미 실행 큐에 들어간 노드나 Karpenter 관리 노드가 아닌 경우는 조용히 탈락합니다. 2차 필터에서 떨어지면 `DisruptionBlocked`가 아니라 `Unconsolidatable`이 나가고 static NodePool과 빈 노드 탈락은 아예 이벤트가 없습니다.

또 하나 — PDB와 파드 `do-not-disrupt`는 **graceful 계열(`Emptiness`·consolidation)에만 무조건 걸립니다.** drift 계열은 eventual이라, NodeClaim에 `terminationGracePeriod`가 설정돼 있으면 이 둘을 무시하고 진행합니다.
{{< /callout >}}

### 2.2 disruption cost — 노드 하나를 지울 때 치르는 대가

1차를 통과한 노드는 `Candidate`가 되고 이때 이후 판단에 쓸 값이 함께 계산됩니다. 실제로 쓰이는 것은 넷입니다.

| 값 | 뜻 | 어디에 쓰나 |
|---|---|---|
| `Price` | 그 노드가 **실제로 돌고 있는 오퍼링**의 시간당 가격 | 교체 시 가격 비교, 스코어의 분자 |
| `reschedulablePods` | 옮겨야 할 파드 목록 | DaemonSet은 제외됩니다 |
| `RescheduleDisruptionCost` | 노드 몫 `1.0` + 위 파드들의 비용 합 | 후보 정렬, 빈 노드 판정, 스코어의 분모 |
| `instanceType` · `capacity-type` 라벨 | 가격을 조회할 수 있는가 | 없으면 consolidation 후보에서 탈락 |

`RescheduleDisruptionCost`는 **노드 한 대를 지울 때 치르는 대가에 가중치를 매긴 값**입니다.

```go
// controllers/disruption/types.go:136-141
cost := PerNodeBaseDisruptionCost          // = 1.0
for _, p := range reschedulablePods {
    cost += math.Max(0, disruptionutils.EvictionCost(ctx, p))
}
```

base `1.0`은 cordon·drain·대체 노드 기동 지연 그 자체의 비용입니다. `max(0, ·)`가 합계가 아니라 **파드 하나하나에** 걸리므로 음수 항이 합계를 깎지 못합니다. 그래서 이 값은 **어떤 경우에도 1.0 아래로 내려가지 않습니다.**

파드별 비용은 기본 `1.0`에 `pod-deletion-cost / 2²⁷`과 `priority / 2²⁵`를 더하고 `[-10, 10]`으로 자릅니다. 나누는 수가 워낙 커서 실무에서는 **`disruptionCost ≈ 1 + 재스케줄 대상 파드 수`**로 읽어도 대체로 맞습니다.

정렬 기준도 여기서 나옵니다.

> **`SavingsRatio` = `Price` ÷ `RescheduleDisruptionCost`** — 파드 하나를 옮기는 대가로 시간당 얼마를 아끼는가. 이 값이 큰 순서로 후보를 훑으므로 **비싸면서 한산한 노드가 먼저** 정리됩니다.

시간 가중치는 없습니다. `LifetimeRemaining`이 곱해지는 필드는 따로 있지만 읽는 코드가 없어 "만료가 임박한 노드가 먼저 지워진다"는 설명은 v1.14 기준으로 성립하지 않습니다.

## 3. 제거 사유 — Empty · Drifted · Underutilized

1차와 2차를 통과했다는 것은 "손대도 되는 노드"라는 뜻일 뿐, 아직 지울 이유는 없습니다. 이유는 어느 method가 그 노드를 집었는지로 정해집니다.

| Reason | 붙이는 method | 뜻 |
|---|---|---|
| `Empty` | `Emptiness` | 옮길 파드가 없는 노드 |
| `Drifted` | `StaticDrift` · `Drift` | NodePool 스펙과 어긋난 노드 |
| `Underutilized` | `MultiNode` · `SingleNode` | 합쳐서 줄일 수 있는 노드 |

{{< flow src="_flow/3-다섯-method.json" />}}

**`Drifted`는 consolidation의 하위 분류가 아닙니다.** 세 Reason이 한 줄에 놓여 같은 알고리즘의 세 갈래처럼 보이지만 drift는 정책을 읽지 않고 스코어도 받지 않는 별개의 경로입니다. `consolidationPolicy`로는 끌 수 없습니다. 막으려면 예산에 `reasons: [Drifted]`를 걸어야 합니다.

`Empty` 판정은 파드 개수가 아니라 **비용**을 봅니다. `RescheduleDisruptionCost`가 `1.0` 이하이기만 하면 빈 노드이므로 파드가 떠 있어도 그 파드들의 축출 비용이 전부 0으로 깎이면 `Empty`가 됩니다. 직관과 조금 다른 대목이고 이 성질이 뒤에서 함정 하나를 만듭니다([§8.2](#82-pod-deletion-cost로-비용을-조절한다)).

## 4. Underutilized 처리 — MultiNode와 SingleNode

`Underutilized`만 안에서 두 단계로 나뉩니다. 둘 다 `SavingsRatio`로 정렬한 **같은 후보 목록을 받아** 시작하고 다른 것은 **그 목록에서 몇 대를 집느냐**뿐입니다.

**SingleNode는 앞에서부터 한 대씩 집어 봅니다.** 그 노드의 파드를 다른 곳으로 옮길 수 있는지 확인하고 실패하면 다음 후보로 내려갑니다. 처음 성공한 노드로 커맨드를 만들고 빠져나옵니다.

{{< mnode variant="single" >}}

**MultiNode는 앞에서부터 여러 대를 한꺼번에 집습니다.** 묶은 만큼 비용도 합쳐지지만 **한 대씩 봐서는 나오지 않을 조합**이 여기서 나옵니다.

{{< mnode variant="multi" >}}

두 도식 모두 **집는 순간 비용 합계가 확정되고**(옅은 칸), 파드를 옮기면서 그 값을 치릅니다(진한 칸). 옮기면서 계산하는 값이 아니라 후보를 만들 때 이미 정해진 값입니다.

### 4.1 실행 순서는 설명 순서의 반대다

개념이 쉬워 SingleNode를 먼저 놓았지만 **실제로는 MultiNode가 먼저 돕니다.** MultiNode가 커맨드를 하나라도 만들면 그 라운드는 거기서 끝나고 SingleNode는 MultiNode가 빈손일 때만 내려옵니다.

두 경로는 성격이 꽤 다릅니다.

| | MultiNode | SingleNode |
|---|---|---|
| 집는 대수 | 정렬된 목록의 **앞쪽 prefix** | 한 대 |
| 탐색 방식 | 이진 탐색. **중간값에서 시작해 좁혀 갑니다** | 앞에서부터 순차 |
| 배치 범위 | 최소 2대, 최대 101대 | — |
| 타임아웃 | 1분 — 시뮬레이션 자체를 끊습니다 | 3분 — 후보 사이에서만 확인합니다 |
| 타임아웃 시 | 지금까지 찾은 **가장 큰 유효 배치를 반환** | 못 본 NodePool을 기억해 다음 라운드에 먼저 봅니다 |
| 예산 | 후보를 넣을 때마다 **깎습니다** | 0인지 확인만 하고 깎지 않습니다 |

"작은 배치부터 키워 간다"가 아니라는 점이 특히 오해하기 쉽습니다. 후보가 101개 이상이면 **첫 시뮬레이션이 51대짜리**이고 2대짜리 배치는 탐색이 끝까지 좁혀졌을 때만 시도됩니다.

SingleNode의 순회 순서도 정렬 결과 그대로가 아닙니다. `SavingsRatio`로 정렬한 뒤 NodePool별로 묶어 **번갈아 가며** 훑으므로 최종 순서는 "풀 안에서는 비율 내림차순, 풀 사이에서는 교대"입니다.

## 5. 삭제와 교체의 갈림목

결과는 셋 중 하나입니다 — 아무것도 하지 않거나(`no-op`), 그냥 지우거나(`delete`), 대신 한 대를 띄우고 지우거나(`replace`). 이를 가르는 것은 판정식 여러 개가 아니라 **시뮬레이션 한 번**입니다.

### 5.1 시뮬레이션이 세는 것

후보 노드를 클러스터에서 **가상으로 지우고** 그 위의 파드를 다시 스케줄해 본 뒤 **새로 띄워야 할 노드가 몇 대인가**를 셉니다.

{{< flow src="_flow/5-삭제와-교체.json" />}}

| 새 노드 | 결과 | 가격 검사 |
|---|---|---|
| **0대** | `delete` — 파드가 전부 기존 노드에 들어갑니다 | **없음** |
| **1대** | 가격 필터를 통과하면 `replace` | 있음 |
| **2대 이상** | `no-op` — 커맨드 자체를 만들지 않습니다 | — |

새 NodeClaim이 0개면 그 자리에서 반환하고 가격 필터에 도달하지 않습니다. 그래서 가격 조회에 실패해 `Price`가 0인 노드도 그냥 삭제됩니다 — 삭제형에 가격 검사가 없다는 점은 자주 오해되는 대목입니다. 다만 이것은 `WhenEmptyOrUnderutilized`에 한한 이야기입니다. `Balanced` 풀에서는 `Price`가 0이면 스코어가 0이 되어 삭제가 거부됩니다.

가격 필터가 요구하는 것은 부등식 하나입니다.

> 새로 띄울 노드가 **지울 노드들의 가격 합보다 엄격히 싸야** 합니다.

여기서 쓰는 "새 노드 가격"은 최저가가 아니라 **최악가**입니다. 후보 인스턴스 타입이 살아남으려면 가능한 오퍼링 중 가장 비싼 것조차 기존 합계보다 싸야 합니다.

그래서 **삭제와 교체는 대등한 두 개념이 아닙니다.** 둘 다 `Command`라는 지시서 한 장이고 `Replacements`가 비었는지에서 형태가 갈릴 뿐입니다. 이 제약은 커맨드를 만들 때와 15초 뒤 재검증 때 두 번 걸립니다.

```go
// controllers/disruption/validation.go:326-329
// we need more than one replacement node which is never valid
// currently (all of our node replacement is m->1, never m->n)
```

### 5.2 시뮬레이션이 실패하는 실제 이유

시뮬레이션은 파드 하나가 실패했다고 곧바로 멈추지 않습니다. 실패한 파드를 큐에 다시 넣고 선호 조건을 단계적으로 완화해 가며 끝까지 재시도합니다. 포기 판정은 시뮬레이션이 **끝난 뒤에** 이뤄집니다 — 그 시점까지도 자리를 못 찾은 파드가 하나라도 남아 있으면 통합을 접습니다.

파드가 갈 곳을 못 찾는 사유는 실무에서 대개 이 범위 안에 있습니다.

| 원인 | 전형적인 상황 |
|---|---|
| node affinity · nodeSelector | 남은 노드가 요구 라벨을 만족하지 못합니다 |
| pod anti-affinity | 같은 노드에 이미 같은 짝이 올라가 있습니다 |
| topology spread | 노드를 지우면 skew 제약이 깨집니다 |
| taint · toleration | 남은 노드의 taint를 견디지 못합니다 |
| volume topology | EBS가 묶인 AZ 밖으로는 옮길 수 없습니다 |
| hostPort 충돌 · 리소스 부족 | 남은 노드에 물리적으로 자리가 없습니다 |

반대로 **원래부터 Pending이던 파드는 통합을 막지 못합니다.** 통합 전에도 스케줄되지 않던 파드는 오류 집합에서 제외됩니다.

### 5.3 분류가 결과를 정하지는 않는다

"이 노드는 drift로 처리되나 교체로 처리되나"는 성립하지 않는 질문입니다. 둘은 배타적 선택지가 아니라 서로 다른 축입니다.

| | 정하는 것 | 값 |
|---|---|---|
| **Reason** | 어느 method가 집었나 | `Empty` · `Drifted` · `Underutilized` |
| **Decision** | 그 뒤에 무슨 일이 있었나 | `delete` · `replace` · `no-op` |

{{< flow src="_flow/5-reason과-decision.json" />}}

시뮬레이션을 거치는 두 갈래에서는 네 조합이 전부 정상적으로 나옵니다.

| Reason | Decision | 언제 이렇게 되나 | 가격 검사 |
|---|---|---|---|
| `Drifted` | `delete` | 파드가 남은 노드에 전부 들어감 | 없음 |
| `Drifted` | `replace` | 받아줄 자리가 없어 새 노드가 필요함 | **없음** — 더 비싸도 진행합니다 |
| `Underutilized` | `delete` | 여러 대를 지우고 기존 노드가 흡수함 | 없음 |
| `Underutilized` | `replace` | 4xlarge 한 대를 2xlarge 한 대로 | **있음** — 엄격히 더 싸야 합니다 |

**가격 검사 열이 갈리는 것이 핵심입니다.** drift는 스펙을 맞추는 것이 목적이라 가격 필터를 아예 타지 않습니다. 가격 부등식은 통합 전용입니다.

`Empty`만 판별을 받지 않아 결과가 고정됩니다 — 옮길 파드가 없으니 대체를 요구할 일 자체가 없기 때문입니다.

## 6. 세 정책의 차이

세 정책이 갈라지는 곳은 딱 한 군데입니다.

| 정책 | 빈 노드 | 그 외 후보 | 통과해야 할 게이트 |
|---|---|---|---|
| `WhenEmpty` | 삭제 | **후보로 만들지 않음** | 없음 — 경로 자체가 없습니다 |
| `WhenEmptyOrUnderutilized` | 삭제 (같음) | 시뮬레이션 후 삭제 또는 교체 | 파드 재배치 + (교체면) 가격 |
| `Balanced` | 삭제 (같음) | 시뮬레이션 후 **스코어 심사** | 위 둘 + `score ≥ 0.5` |

빈 노드 열이 셋 다 같은 것은 **그 일을 맡은 `Emptiness`가 `consolidationPolicy`를 아예 읽지 않기 때문**입니다. 정책을 무엇으로 두든 빈 노드는 똑같이 지워지고, 실제로 갈리는 것은 가운데 열 하나뿐입니다.

세 정책은 "정책의 강도"가 아니라 **승인 조건의 포함 관계**로 이해하는 편이 정확합니다.

- `WhenEmpty`가 승인하는 것은 `Balanced`도 전부 승인합니다. `WhenEmpty`는 빈 노드만 지우는데, `Balanced`도 빈 노드는 채점 없이 지우기 때문입니다.
- `Balanced`가 승인하는 것은 `WhenEmptyOrUnderutilized`도 전부 승인합니다. `Balanced`는 새 통합을 만들지 않고 앞 경로의 결과를 **거부만** 하기 때문입니다.

그래서 `Balanced`로 바꾸면 통합은 **반드시 줄어듭니다.** 늘어나는 경우는 없습니다. 물어야 할 것은 "더 될까"가 아니라 **"무엇이 덜 될까"**입니다.

## 7. Balanced 심층 분석

### 7.1 기준선 — `WhenEmptyOrUnderutilized`가 하는 일

{{< flow src="_flow/7-1-기준선.json" />}}

게이트가 둘뿐입니다 — "모든 파드가 다른 데 들어가는가", 그리고 교체라면 "엄격히 더 싼가". 절감의 **규모**를 묻는 곳이 없어서 "10원 아끼려고 파드 40개를 옮긴다"가 여기서 나옵니다.

### 7.2 Balanced가 얹는 게이트

{{< flow src="_flow/7-2-balanced-게이트.json" />}}

Balanced가 묻는 것을 말로 옮기면 이렇습니다.

> 이 통합이 **NodePool의 평균적인 비용 효율보다 충분히 좋은가.** 후보가 절감하는 시간당 비용을 파드 이동 비용으로 나누고 그 값을 NodePool 전체의 평균 비용 효율과 비교합니다. 절반에 못 미치면 거부합니다.

식으로는 이렇게 됩니다.

> **score** = ( `savings` ÷ `disruptionCost` ) ÷ ( `TotalCost` ÷ `TotalDisruptionCost` ) ≥ 1/`k` = **0.5**

| 변수 | 뜻 |
|---|---|
| `savings` | 삭제할 노드들의 가격 합 − 새로 띄울 노드 가격 |
| `disruptionCost` | 후보들의 `RescheduleDisruptionCost` 합 |
| `TotalCost` | 그 NodePool의 총비용 |
| `TotalDisruptionCost` | 그 NodePool에 속한 **모든 노드**의 disruption cost 합 |

분자는 **이 액션의 효율**, 분모는 **풀의 평균 효율**입니다. 분모가 풀 전체라 풀 크기는 약분되어 영향이 없습니다. 한산하고 비싼 노드가 많은 풀일수록 기준선이 높아 통과가 어려워집니다.

### 7.3 숫자를 넣어 보면

{{< callout type="info" >}}
아래 수치는 설명을 위해 지어낸 값입니다. **Karpenter의 기본값이 아닙니다.**
{{< /callout >}}

노드 10대짜리 NodePool을 가정합니다. 총비용은 시간당 $10이고 노드마다 파드가 4개씩 떠 있습니다.

- 노드 한 대의 disruption cost = `1.0`(노드 몫) + `4`(파드 4개) = **5**
- 풀 전체 disruption cost = 5 × 10 = **50**
- 풀의 평균 효율 = $10 ÷ 50 = **0.2** (파괴 1단위당 시간당 달러)

이제 시간당 $1.00짜리 노드 한 대(파드 4개)를 후보로 잡고 세 경우를 봅니다.

| 시나리오 | savings | 액션 효율 | score | 판정 |
|---|---|---|---|---|
| 그냥 삭제 | $1.00 | 1.00 ÷ 5 = 0.2 | 0.2 ÷ 0.2 = **1.0** | 승인 |
| $0.50짜리로 교체 (50% 절감) | $0.50 | 0.50 ÷ 5 = 0.1 | 0.1 ÷ 0.2 = **0.5** | 간신히 승인 |
| $0.60짜리로 교체 (40% 절감) | $0.40 | 0.40 ÷ 5 = 0.08 | 0.08 ÷ 0.2 = **0.4** | **거부** |

파드 밀도가 풀 평균과 같은 노드에서는 **`score`가 절감률과 그대로 같아집니다.** 그래서 "평균적인 노드는 50% 이상 싸지는 교체만 통과한다"가 됩니다.

밀도가 어긋나면 결과가 달라집니다. 같은 40% 절감이라도 파드가 1개뿐인 노드라면 disruption cost가 2로 줄어 `score`가 1.0이 되어 통과합니다. 파드 밀도가 분모에 들어 있어 **한산한 노드는 쉬워지고, 빽빽한 노드는 보호됩니다.**

한 건이 심사를 받는 과정입니다.

{{< bscore >}}

### 7.4 사전 컷 — 시뮬레이션조차 건너뛰는 경우

심사가 시뮬레이션 뒤에만 도는 것은 아닙니다. 교체는 새 노드 값을 빼야 하니 삭제보다 절감이 작을 수밖에 없습니다. 후보의 최선인 "그냥 삭제"조차 임계를 넘지 못하면 더 볼 것이 없어 **시뮬레이션 자체를 건너뜁니다.**

이 사전 컷에는 조건이 둘 붙습니다.

- **`Balanced` 풀에만 걸립니다.** 다른 정책에서는 무조건 통과합니다.
- **SingleNode 경로에만 있습니다.** MultiNode에는 없어서 멀티 노드 통합은 시뮬레이션을 다 돌린 뒤에야 거부됩니다.

### 7.5 "거부만 한다"의 예외

`Balanced`가 새 통합을 만들지 않는다는 것은 맞습니다. 다만 MultiNode 경로에서는 **거부가 단순한 veto로 끝나지 않습니다.**

이진 탐색 도중 어떤 배치가 거부되면 탐색 창이 그만큼 좁혀집니다. 그 결과 **더 작은 배치가 대신 채택될 수 있습니다.** 5대를 묶는 통합이 거부되고 3대를 묶는 통합이 선택되는 식입니다. 승인 집합이 넓어지는 것은 아니지만 "어떤 크기의 배치가 뽑히는가"는 바뀝니다.

한 가지 더 — **`Balanced` 도입은 모든 정책의 MultiNode 후보 정렬을 바꿨습니다.** 예전에는 disruption cost 오름차순이었는데 지금은 `Price / RescheduleDisruptionCost` 내림차순입니다. `WhenEmptyOrUnderutilized`를 쓰고 있어도 v1.14로 올리면 묶이는 조합이 달라질 수 있습니다.

### 7.6 여러 NodePool에 걸친 커맨드

한 커맨드가 여러 NodePool의 노드를 건드리면 `savings`를 각 풀의 비용 비율로 안분해 **풀마다 따로** 심사합니다. 한 풀이라도 미달이면 커맨드 전체가 거부됩니다.

단 심사 대상은 **정책이 `Balanced`인 풀뿐**입니다. `WhenEmptyOrUnderutilized` 풀의 노드는 안분 분모에는 들어가지만 채점은 받지 않습니다. 커맨드에 `Balanced` 풀이 하나도 없으면 무조건 승인됩니다.

### 7.7 `k`는 바꿀 수 없다

```go
// apis/v1/nodepool.go:167-171
// BalancedK is the scoring parameter for the Balanced policy. A move is
// approved when score >= 1/k = 0.5. k=2 is the smallest value where
// within-family replaces pass, with 4-step max churn.
const BalancedK int32 = 2
```

Go `const`이고 호출부 두 곳 모두 상수를 그대로 넘깁니다. NodePool 필드도, 플래그도, feature gate도 없습니다.

선택 근거는 주석에 적혀 있습니다 — **같은 패밀리에서 한 단계 다운사이징(4xlarge → 2xlarge)이 정확히 50% 절감**이라 그 교체가 겨우 통과하는 지점이 `k=2`입니다. 임계를 조절할 수 없으니 손댈 수 있는 것은 분모인 `pod-deletion-cost`뿐입니다.

### 7.8 흔한 오해 둘

**"세 정책은 같은 스코어식에 다른 `k`를 넣은 것입니다"** — 앞의 포함 관계는 맞지만 식은 그렇게 되어 있지 않습니다. `WhenEmpty`의 판정은 비율이 아니라 **원시 비용에 대한 절대 임계**입니다. `IsEmpty()`는 `RescheduleDisruptionCost <= 1.0`이고 분모도 savings도 등장하지 않습니다. `k→0`으로 표현할 수도 없습니다. 임계 `1/k`가 무한대가 되어 `score`가 `+Inf`여야 통과하는데 앞에서 봤듯 비용은 절대 0이 되지 않습니다. `k→0`은 "빈 노드를 지운다"가 아니라 **"아무것도 지우지 않는다"**에 수렴합니다.

**"`Balanced`니까 AZ나 spot 분산을 맞춰 주겠지"** — 이름과 달리 그런 일은 하지 않습니다. 스코어에 들어가는 것은 가격과 disruption cost뿐이고 AZ 균형, spot과 on-demand 비율, 인스턴스 세대는 **어느 항에도 등장하지 않습니다.** 여기서 말하는 균형은 "절감과 churn 사이의 균형"입니다.

### 7.9 언제 효과가 없나

| 증상 | `Balanced`의 효과 |
|---|---|
| 한계 절감 통합으로 churn이 잦다 | **정확히 겨냥합니다** |
| 바쁜 노드가 자꾸 흔들린다 | **자동 보호** — 파드 밀도가 분모입니다 |
| 빈 노드 정리가 시끄럽다 | **없음** — `Emptiness`가 우회합니다 |
| drift로 노드가 갈린다 | **없음** — 통합 경로가 아닙니다 |
| 세대가 자꾸 내려간다 | **없음** — 스코어에 세대나 weight가 없습니다 |
| 비용 절감이 최우선이다 | **손해** — 한계 절감이 거부됩니다 |

가운데 셋이 중요합니다. **"노드가 자꾸 교체된다"의 원인이 통합이 아니면 `Balanced`는 아무것도 바꾸지 않습니다.** 원인부터 가르고 판단해야 합니다.

### 7.10 켜기

```yaml
spec:
  disruption:
    consolidationPolicy: Balanced
    consolidateAfter: 1m
```

feature gate가 없습니다. 설계 RFC는 `BalancedConsolidation` 게이트로 옵트인한다고 적었지만 **구현에는 들어가지 않았습니다.** 코어 **v1.14.0이 최초**이고 그 이하 버전에서는 enum에 없어 admission에서 거부됩니다. 도입 시점 판정은 [지금 켤 만한 것과 미룰 것]({{< relref "02-changelog-maturity.md" >}})이 소유합니다.

## 8. 운영자의 개입 수단

세 가지 수단이 서로 다른 축을 제어합니다. 섞어서 이해하면 엉뚱한 곳을 만지게 됩니다.

| 수단 | 제어하는 것 | 시간축 |
|---|---|---|
| `consolidateAfter` | **언제부터** 후보가 될 수 있나 | 있음 |
| `consolidationPolicy` | **어떤 후보를** 승인할까 | 없음 |
| `disruption.budgets` | **언제, 몇 대까지** 실행할까 | 있음 |

### 8.1 `consolidateAfter` — 후보 자격의 대기 시간

노드가 `Consolidatable` 상태가 되기까지 기다리는 시간입니다. `Never`로 두면 `Empty`와 `Underutilized` **양쪽이 모두** 꺼집니다. drift에는 걸리지 않습니다.

### 8.2 `pod-deletion-cost`로 비용을 조절한다

값을 키우면 그 파드의 축출 비용이 올라 노드의 disruption cost가 오릅니다. 알아야 할 것이 셋입니다.

- **`Balanced`에서만 보호로 작동합니다.** 다른 두 정책은 스코어 게이트가 없어 삭제 여부가 바뀌지 않고, 바뀌는 것은 정렬 **순서**뿐입니다.
- **제로섬입니다.** 올린 점수는 노드 A에만 쌓이는 게 아니라 **풀 전체 합계에도 그대로 더해집니다.** A는 점수가 내려가 보호되지만 그만큼 풀 기준선이 낮아져 **같은 풀의 B는 오히려 지워지기 쉬워집니다.** "이 파드를 보호하면 끝"이 아니라 "압력을 옆으로 옮긴다"가 정확합니다.

{{< callout type="warning" >}}
**큰 음수는 의도와 정반대로 작동합니다.** 파드별 비용은 `1.0 + pod-deletion-cost / 2²⁷`이므로, `pod-deletion-cost`가 `-134217728`(= −2²⁷) 이하이면 그 파드의 기여가 0으로 깎입니다. 노드 위 **모든** 재스케줄 대상 파드가 그렇게 되면 노드의 `RescheduleDisruptionCost`가 정확히 `1.0`에 머뭅니다. `IsEmpty()`가 `<= 1.0`이므로 그 노드는 **빈 노드로 판정됩니다.**

그러면 파드가 멀쩡히 떠 있는데도 `Emptiness`가 **정책과 무관하게** 지웁니다. 파드를 보호하려고 넣은 값이 오히려 노드를 가장 먼저 지워지게 만드는 셈입니다. 보호가 목적이라면 **양수**를 쓰십시오.
{{< /callout >}}

아무 설정도 하지 않으면 파드별 비용이 전부 `1.0`이라 스코어는 사실상 **"절감 비율 대 파드 개수 비율"** 비교로 축퇴합니다.

### 8.3 예산으로 실행량을 조인다

정책은 **후보를 만들지 말지**를, 예산은 **몇 대나 실행할지**를 정합니다. 예산의 `reasons`로 쓸 수 있는 값은 `Empty` · `Underutilized` · `Drifted` 셋입니다.

예산은 실행 속도만 조이는 게 아니라 **후보 풀 자체를 자릅니다.** MultiNode는 탐색 전에 예산이 0인 NodePool의 후보를 건너뛰고 후보를 넣을 때마다 그 풀의 예산을 하나씩 깎습니다. 그런데 MultiNode는 후보가 2개 미만이면 즉시 빈 커맨드를 반환합니다.

{{< callout type="warning" >}}
**둘을 겹치면 — 한 NodePool의 예산이 `1`이면 그 풀의 노드를 2대 이상 묶는 통합이 아예 성립하지 않습니다.** `nodes: "1"`은 흔한 보수적 설정인데, 의도는 대개 "천천히 줄이자"이지 "합치기를 끄자"가 아닙니다. 퍼센트는 올림이라 작은 풀에서는 `20%`도 1이 될 수 있습니다.

풀이 여럿이면 그 1대가 다른 풀 후보와 함께 하나의 커맨드에 들어갈 수는 있습니다. 하지만 클러스터에 그 풀 하나뿐이라면 정말로 MultiNode가 성립하지 않습니다.
{{< /callout >}}

또 하나, **예산 차감은 reason을 가리지 않습니다.** 진행 중인 disruption을 전부 세어 각 reason의 몫에서 빼기 때문에 통합 한 건이 빈 노드 삭제의 예산을 잡아먹을 수 있습니다. 기본 예산은 `10%`라 10노드 풀에서 1입니다.

**막는 방법에 따라 흔적이 다릅니다.** `consolidationPolicy: WhenEmpty`로 막으면 후보 단계에서 탈락해 이벤트가 남지 않습니다. 예산 `0`으로 막으면 후보는 만들어지고 실행만 차단되어 `DisruptionBlocked`가 쌓입니다. **진단 가능성 면에서는 예산 쪽이 낫습니다** — [언제 무엇을 멈출 것인가]({{< relref "08-disruption-budgets.md" >}})가 예산을 진단 1순위에 두는 이유입니다.

## 9. 관측과 문제 해결

### 9.1 확인 순서

"노드가 안 줄어든다" 또는 "노드가 너무 자주 갈린다"를 만나면 이 순서로 좁히는 편이 가장 빠릅니다.

1. **원인이 무엇인가** — `karpenter_nodeclaims_disrupted_total{reason}`으로 `Empty`·`Underutilized`·`Drifted` 중 어느 쪽인지 먼저 가릅니다. 통합이 아니면 정책을 만져도 소용이 없습니다.
2. **예산이 막고 있나** — `karpenter_nodepools_allowed_disruptions{reason}`이 0이면 여기서 끝입니다.
3. **후보가 왜 떨어졌나** — 노드에 붙은 `Unconsolidatable` 이벤트 message를 봅니다.
4. **`Balanced` 풀이라면 스코어는 얼마였나** — `karpenter_consolidation_score`를 봅니다.
5. **그래도 모르겠으면** — `--log-level debug`의 판정 로그를 켭니다.

### 9.2 이벤트

`Unconsolidatable` 이벤트의 message가 사유를 그대로 말합니다.

| message | 뜻 |
|---|---|
| `NodePool %q has consolidation policy WhenEmpty, but node is not empty` | 정책이 막았습니다 |
| `NodePool %q has consolidation disabled` | `consolidateAfter`가 `Never`입니다 |
| `Can't replace with a cheaper node` | 가격 부등식에서 떨어졌습니다 |
| `Can't remove without creating %d candidates` | 대체가 2대 이상 필요합니다 |
| `Node %q has buffer pods` | Capacity Buffers가 잡고 있습니다 |
| `Node does not have label %q` | zone 또는 capacity-type 라벨이 없습니다 |
| `not all pods would schedule, ...` | 시뮬레이션에서 자리를 못 찾았습니다 |

{{< callout type="warning" >}}
**제약이 둘 있습니다.** 시뮬레이션 단계에서 나오는 사유(파드 재스케줄 실패, 대체 2대 이상, 가격 탈락)는 **후보가 1대일 때만 발행됩니다.** MultiNode가 왜 실패했는지는 이벤트로 알 수 없고 debug 로그를 봐야 합니다.

그리고 이 이벤트에는 **15분 dedupe**가 걸려 있습니다. `kubectl describe node`로 보는 사유가 최대 15분 지난 것일 수 있습니다.
{{< /callout >}}

### 9.3 메트릭

| 메트릭 | 성격 | 주의 |
|---|---|---|
| `karpenter_nodeclaims_disrupted_total{reason,nodepool,capacity_type}` | Counter | 원인 판별의 1순위입니다 |
| `karpenter_nodepools_allowed_disruptions{nodepool,reason}` | Gauge | 0이면 예산이 막고 있습니다 |
| `karpenter_consolidation_score` | Histogram | **`Balanced` 풀에서만 기록됩니다** |
| `karpenter_consolidation_moves_total{decision}` | Counter | 정책과 무관하게 셉니다 — 위와 **모수가 다릅니다** |
| `karpenter_voluntary_disruption_consolidation_timeouts_total{consolidation_type}` | Counter | 탐색이 시간에 쫓기고 있는지 봅니다 |

`Balanced`는 **승인만 이벤트를 남기고 거부는 메트릭만 남깁니다.** 거부량이 많아 승인이 파묻히는 것을 막으려는 설계입니다. 그래서 "왜 거부됐나"는 `karpenter_consolidation_score`와 debug 로그의 `consolidation score` 줄로만 확인할 수 있습니다.

거부율은 이 정도면 충분합니다.

```promql
# Balanced 풀에서 임계 미달로 거부된 비율
sum(rate(karpenter_consolidation_moves_total{decision="rejected"}[30m]))
  / sum(rate(karpenter_consolidation_moves_total[30m]))
```

메트릭 전량과 라벨 구성은 [무엇을 봐야 하나]({{< relref "09-metrics-logs-events.md" >}})가 소유합니다.

{{< callout type="warning" >}}
**가격 조회가 실패하면 `Balanced` 풀의 통합이 조용히 멈플 수 있습니다.** 풀 총비용이 0으로 계산되면 사전 컷은 통과시키지만 최종 심사는 전부 거부합니다. 이벤트가 남지 않으므로 `karpenter_consolidation_score`가 0에 몰려 있는지로 확인해야 합니다.
{{< /callout >}}

## 10. 정리

- **consolidation은 네 단계짜리 파이프라인입니다.** 후보 선별 → 사유 판정 → 시뮬레이션 → 수행. 단계마다 다른 이유로 후보가 떨어지므로, "왜 이 노드가 안 지워지나"는 어느 단계에서 걸렸는지부터 물어야 합니다.
- **삭제와 교체를 가르는 것은 시뮬레이션이 요구한 새 노드 대수 하나입니다.** 0대면 삭제, 1대면 가격을 보고 교체, 2대 이상이면 아무것도 하지 않습니다. 대체 노드는 언제나 최대 1대입니다.
- **Drift는 consolidation이 아닙니다.** 정책으로 끌 수 없고 스코어도 받지 않습니다. "노드가 자꾸 갈린다"의 원인부터 `reason` 라벨로 가르고 시작하십시오.
- **`Balanced`는 거부만 하는 층입니다.** 통합이 늘어나는 일은 없고 빈 노드와 drift에는 개입하지 않습니다. 임계 `k=2`는 상수라 바꿀 수 없습니다. AZ나 spot 분산과는 무관합니다.
- **예산 `1`은 "천천히"가 아니라 "MultiNode 끄기"에 가깝습니다.** 노드 수를 줄이는 것이 목적이라면 최소 2 이상이 나오도록 잡아야 합니다.

## 11. 코드와 문서 근거

`kubernetes-sigs/karpenter` **v1.14.0** 로컬 체크아웃(`v1.14.0-6-gac7a021e`). 경로는 `pkg/` 기준이고 별도 표기가 없으면 `controllers/disruption/`입니다.

**컨트롤러 루프**

- method 등록 순서(5개) · 첫 성공 종료 · 폴링 10초 — `controller.go:70-71, 103-114, 166-181`
- 한 라운드에 여러 커맨드 병렬 실행 — `controller.go:211-233`
- `Reason()` 구현 — `emptiness.go:112`, `staticdrift.go`, `drift.go:110`, `multinodeconsolidation.go:248`, `singlenodeconsolidation.go:128`
- graceful / eventual disruption class — `consolidation.go:48-50`, `drift.go:114-116`
- drift에 feature gate 없음 — `operator/options/options.go:134`

**후보와 비용**

- 1차 관문 전량 — `types.go:165-197`, 수집은 `helpers.go:207-216`
- `DisruptionBlocked` 발행 조건 — `types.go:166-196`, `events.go:117-126`
- eventual + `terminationGracePeriod`면 PDB·do-not-disrupt 무시 — `types.go:192-196`
- 2차 필터(consolidation) — `consolidation.go:100-134`. **빈 노드는 `Emptiness`가 전담** — `:126-129`
- base cost `1.0` · `IsEmpty` · `SavingsRatio` — `types.go:134-145, 151-157`
- `EvictionCost` · `IsReschedulable` — `utils/disruption/disruption.go:47-69`, `utils/pod/scheduling.go:44-51`
- `Price` 해석(최저가가 아니라 그 노드가 도는 오퍼링) — `types.go:116-129`
- `LifetimeRemaining`은 읽히지 않는 필드에만 곱해짐 — `types.go:206-207`

**MultiNode · SingleNode**

- prefix 이진 탐색 · 중간값에서 시작 — `multinodeconsolidation.go:118-141`
- 타임아웃(1분, hard) · 마지막 유효 배치 반환 — `multinodeconsolidation.go:35, 134, 144-152`
- 예산 사전 필터와 차감 — `multinodeconsolidation.go:65-77`
- SingleNode 타임아웃(3분, soft) · 미확인 NodePool 우선 · 예산 미차감 — `singlenodeconsolidation.go:33, 65-85`
- NodePool별 라운드로빈 순회 — `singlenodeconsolidation.go:140-171`
- 예산 차감이 reason을 가리지 않음 — `helpers.go:288-301`

**시뮬레이션과 판정**

- 삭제/교체/no-op 갈림 — `consolidation.go:180-195`
- 가격 필터 · 최악가 비교 — `consolidation.go:199-230`, `cloudprovider/types.go:587-598`
- **대체 최대 1대** — `consolidation.go:189-195`, 재검증 `validation.go:316-350`
- 시뮬레이션은 실패 파드를 재시도하고 멈추지 않음 — `controllers/provisioning/scheduling/scheduler.go:463-490, 521-552`
- 원래 Pending이던 파드는 통합을 막지 않음 — `scheduler.go:385-392`
- spot→spot 15개 요구는 단일 노드 전용 · 게이트 기본 off — `consolidation.go:212-215, 292-304`

**Balanced**

- `ScoreMove` · `ApproveCommand` · 거부는 이벤트 없음 — `balanced.go:47-121, 189-247`
- `BalancedK = 2` — `apis/v1/nodepool.go:167-171`
- 사전 컷 `CanPassThreshold`(SingleNode 전용) — `balanced.go:285-299`, 호출부 `singlenodeconsolidation.go:86-90`
- 이진 탐색 창을 좁히는 거부 — `multinodeconsolidation.go:166-189`
- 크로스풀 안분과 `Balanced` 풀 한정 심사 — `balanced.go:130-181`
- 총계 0일 때 `ScoreMove`는 거부 / `CanPassThreshold`는 통과 — `balanced.go:110-112` 대 `:291-294`
- 정렬 기준 변경이 모든 정책에 영향 — `consolidation.go:138-149`
- 메트릭 정의 — `metrics.go:132-150`
- `Balanced` 도입 — core#2962, 최초 태그 `v1.14.0`

**확인하지 못한 것**

- `controller.kubernetes.io/pod-deletion-cost`의 상수 원문은 `k8s.io/api` 모듈 소스가 로컬에 없어 확인하지 못했습니다.
- 이 체크아웃에는 upstream 태그에서 확인되지 않는 요소가 섞여 있을 수 있습니다. `Emptiness`의 buffer 파드 가드와 static NodePool 가드가 그 후보입니다. 자기 클러스터에서 확인할 때는 라인번호가 아니라 **함수명과 식별자로 검색**하십시오.
