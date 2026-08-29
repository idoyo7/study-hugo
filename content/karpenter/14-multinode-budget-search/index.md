---
title: "14 · MultiNode consolidation — NodePool 예산과 전역 후보 탐색"
date: 2026-08-04
linkTitle: "14 MultiNode 예산과 후보 탐색"
weight: 14
---

{{< callout type="info" >}}
**먼저 결론**

- MultiNode의 disruption budget은 NodePool별로 계산하고 소비합니다.
- 하지만 후보 탐색에는 NodePool·AZ 경계가 없습니다. 모든 후보를 전역 정렬한 뒤 각 Pool의 budget만큼 남깁니다. 그렇게 섞인 목록의 prefix를 시뮬레이션합니다.
- 최종 validation은 선택된 커맨드의 안전성만 다시 확인합니다. 전역 prefix 탐색에서 놓친 NodePool/AZ 조합을 찾아 주지는 않습니다.
- 주된 위험은 budget 위반보다 탐색 누락, Pool 간 간섭, 후보 기회 편향입니다.
- 이 글은 코어 v1.14.0 체크아웃(`v1.14.0-6-gac7a021e`)을 기준으로 확인했습니다.
{{< /callout >}}

## 1. 확인하려는 질문

`MultiNodeConsolidation.ComputeCommands()`는 후보를 전역 정렬한 뒤 `disruptionBudgetMapping[candidate.NodePool.Name]`을 확인하고 차감합니다.

```go
if disruptionBudgetMapping[candidate.NodePool.Name] == 0 {
    constrainedByBudgets = true
    continue
}
disruptableCandidates = append(disruptableCandidates, candidate)
disruptionBudgetMapping[candidate.NodePool.Name]--
```

이 코드에 물어야 할 것은 둘입니다.

1. NodePool별 budget을 지키는가
2. NodePool 또는 AZ별로 독립된 후보군을 만들어 탐색하는가

현재 답은 각각 예, 아니오입니다. 예산의 경계와 탐색의 경계가 다릅니다.

## 2. 현재 후보 탐색 흐름

```text
모든 Pool의 Candidate
  → SavingsRatio 전역 정렬
  → Candidate가 속한 Pool의 budget 확인·차감
  → 살아남은 Candidate를 다시 한 배열에 보관
  → 배열의 prefix [0:n]을 이진 탐색하며 SimulateScheduling
```

정렬 결과와 예산이 아래와 같다고 가정합니다.

```text
정렬: A/a1, B/b1, A/a2, C/c1, B/b2
예산: A=2, B=1, C=1
결과: A/a1, B/b1, A/a2, C/c1
```

살아남은 네 후보는 Pool별 세 목록으로 나뉘지 않습니다. 하나의 multi-node command 후보군이 됩니다. 이진 탐색은 `[a1,b1,a2]` 같은 prefix를 시뮬레이션하지만 `[a1,a2]`, `[b1,c1]`처럼 prefix가 아닌 조합은 직접 시도하지 않습니다.

최대 100개 제한도 Pool마다 걸리지 않고 이 전역 목록에 한 번 걸립니다. 높은 점수의 대형 Pool이 앞부분을 많이 차지하면 작은 Pool은 budget이 남아 있어도 탐색 기회를 얻지 못할 수 있습니다.

## 3. budget은 무엇을 보장하는가

이 구조가 곧바로 budget 위반을 뜻하지는 않습니다. 허용량은 아래 세 지점에서 확인하고 차감합니다.

- 후보를 전역 목록에 담을 때 각 후보가 속한 NodePool의 허용량을 차감합니다.
- 실행 직전 validation에서도 최신 budget map을 다시 만듭니다.
- 선택된 후보마다 자기 `NodePool.Name`의 budget을 다시 차감합니다.

따라서 여러 Pool이 섞인 커맨드도 각 Pool의 허용량 안이면 정상적으로 통과합니다. 현재 budget의 의미는 “한 커맨드는 반드시 한 Pool이어야 한다”가 아니라 “그 커맨드가 각 Pool에서 제거하는 노드 수가 해당 Pool의 허용량 이하여야 한다”에 가깝습니다.

## 4. validation은 무엇을 확인하는가

{{< callout type="warning" >}}
validation은 NodePool/AZ 동질성 검사기가 아닙니다. 선택된 후보가 모두 같은 NodePool 또는 같은 AZ인지 요구하는 코드는 없습니다.
{{< /callout >}}

실행 직전 validation은 다섯 가지를 확인합니다.

1. 선택했던 NodeClaim들이 아직 유효한 consolidation 후보인가
2. 후보가 nominated되거나 삭제 중인 상태로 바뀌지 않았는가
3. 각 후보가 속한 NodePool의 최신 budget을 넘지 않는가
4. 후보들을 지금 다시 제거해도 모든 파드를 스케줄할 수 있는가
5. 삭제/교체 대수와 교체 인스턴스 타입 집합이 처음 계산한 결과와 양립하는가

Candidate에는 `NodePool`, zone, capacity type, instance type 정보가 들어 있습니다. 스케줄링 시뮬레이션은 이 정보와 파드의 affinity, topology spread, volume topology, taint/toleration 등을 사용합니다. 이 검사는 “후보들의 Pool/AZ가 서로 같아야 한다”를 요구하지 않습니다. 서로 다른 Pool과 AZ의 후보가 섞였어도 파드가 유효하게 재배치되고 budget을 지키면 커맨드는 통과합니다.

## 5. validation이 해결하지 못하는 것

validation은 선택된 커맨드가 지금도 안전한지를 판정합니다. 후보 탐색이 충분했는지는 판정하지 않습니다. 전역 prefix 탐색 때문에 가능한 조합을 놓쳤다면 validation은 다른 조합을 찾아 주지 않습니다. 선택된 조합이 현재 상태에서 실패하면 커맨드를 거부할 뿐입니다.

그래서 예상되는 문제는 안전 위반보다 탐색 누락과 편향에 가깝습니다.

| 여지 | 어떻게 나타나는가 |
|---|---|
| prefix 오염 | 앞쪽 후보 하나가 topology·volume·리소스 제약 때문에 묶음을 실패시키면 뒤에 있는 잘 맞는 조합을 시도하지 못할 수 있습니다 |
| Pool 간 결합 | Pool A의 실패하기 쉬운 후보가 앞에 끼어 Pool B만으로 가능한 통합까지 같은 simulation 결과에 묶입니다 |
| 100개 편향 | 높은 점수의 대형 Pool 후보가 앞 100개를 차지하면 작은 Pool의 탐색 기회가 줄어듭니다 |
| budget 1의 교차 Pool 묶음 | 한 Pool 안에서는 MultiNode가 불가능하지만 다른 Pool의 후보와 섞여 `m→1` 커맨드가 만들어질 수 있습니다 |
| AZ 조합 누락 | 스케줄러가 AZ 제약을 정확히 검사해도 성공 가능한 다른 AZ 조합이 prefix가 아니면 발견하지 못합니다 |

예를 들어 아래 목록에서 `[A/a1,B/b1,A/a2]`가 실패하면 이진 탐색은 prefix 크기를 줄입니다.

```text
A/a1, B/b1, A/a2, B/b2, C/c1
```

그러나 실제로는 `[A/a1,A/a2]` 또는 `[B/b1,B/b2]`가 성공할 수 있습니다. 현재 탐색은 이 조합들을 별도 후보군으로 만들어 비교하지 않습니다. 뒤의 validation 역시 이 대안을 생성하지 않습니다.

## 6. 그렇다면 NodePool/AZ로 항상 나누는 것이 맞는가

NodePool이나 AZ로 무조건 쪼개는 것도 항상 더 좋은 결과를 보장하지는 않습니다.

- 서로 다른 Pool의 남는 용량을 함께 써야 delete-only consolidation이 되는 경우가 있습니다.
- 여러 AZ를 함께 제거해야 topology spread를 유지하면서 더 작은 replacement를 만들 수 있습니다.
- cross-pool 후보의 비용 합이 한 대의 더 싼 replacement로 이어지기도 합니다.

혼합 후보군 자체는 안전하지 않은 동작이 아닙니다. 계산량을 제한하면서 어떤 조합을 먼저 탐색할지 정하는 정책 선택입니다. 현재 구현은 조합 탐색의 폭보다 전역 고득점 prefix와 제한된 simulation 횟수를 우선합니다.

## 7. NodePool별 탐색으로 바꿀 때의 범위

가장 작은 구조는 이렇습니다.

```text
Candidate를 NodePool별 group
  → Pool 내부 정렬
  → Pool budget만큼 제한
  → Pool별 firstNConsolidationOption
  → Pool별 결과를 같은 기준으로 비교
  → 한 라운드에 가장 좋은 Command 하나 선택
```

grouping보다 Pool별 결과 비교 기준을 정하는 일이 더 까다롭습니다.

- 예상 절감액이 가장 큰 command
- 절감액/중단비용 비율이 가장 큰 command
- 제거 노드 수가 가장 많은 command
- Pool 라운드로빈

어느 것을 선택하느냐에 따라 starvation과 consolidation 결과가 달라집니다. map iteration에서 처음 성공한 결과를 반환하면 비결정적인 Pool 편향이 생깁니다.

현재 인터페이스를 유지해 한 라운드에 command 하나만 고른다면 예상 변경 범위는 다음 정도입니다.

| 범위 | 예상 규모 |
|---|---|
| 프로덕션 코드 | 약 60–120줄 |
| 테스트 | 약 150–300줄 |
| 변경 파일 | 2–4개 |

Pool별 command를 여러 개 한꺼번에 반환하면 동일 destination capacity를 가정하는 simulation 간 경쟁과 validation race까지 다뤄야 합니다. 그만큼 변경 범위가 더 커집니다.

## 8. AZ까지 나눌 때의 범위

AZ는 두 문제로 나눠서 봐야 합니다.

### 8.1 `NodePool+AZ`를 탐색 경계로만 사용

후보 grouping key만 `NodePool+AZ`로 만드는 변경입니다. budget은 여전히 NodePool 전체에서 공유합니다. 이 경우에도 결정할 것이 남습니다.

- Pool budget을 AZ 사이에 균등 배분할 것인가
- 모든 AZ가 같은 Pool budget을 공유하며 점수순으로 소비할 것인가
- AZ별 command를 만든 뒤 가장 좋은 하나를 고를 것인가

source 후보를 같은 AZ로 묶어도 replacement AZ까지 같아지지는 않습니다. replacement의 zone은 스케줄링 requirements와 offerings가 정합니다.

### 8.2 AZ별 독립 budget 지원

AZ별 독립 budget은 후보 grouping과 다른 API 기능입니다. 현재 `Budget`에는 selector나 topology scope가 없습니다. AZ별 budget을 실제로 표현하려면 다음이 바뀝니다.

- `Budget` API와 CRD schema
- validation/defaulting 및 generated artifacts
- NodePool/AZ별 전체 노드와 disrupting 노드 집계
- budget mapping key와 모든 소비 지점
- 실행 직전 validation
- metrics와 테스트 및 문서

수작업 코드와 테스트만 약 400–800줄 이상, 영향 파일은 8–15개 이상으로 커집니다.

## 9. 판단

1. 높은 확신: NodePool별 budget 제한은 지킵니다.
2. 높은 확신: MultiNode 후보 생성과 simulation은 NodePool/AZ별로 격리되지 않습니다.
3. 높은 확신: validation은 불가능한 실행을 막지만 놓친 후보 조합을 복구하지 않습니다.
4. 중간 이상 확신: 실제 문제는 budget 위반보다 가능한 통합을 찾지 못하는 일과 Pool별 기회 편향으로 나타날 가능성이 큽니다.
5. 높은 확신: AZ별 후보 grouping과 AZ별 disruption budget은 별도의 변경입니다.

첫 변경은 NodePool별로 후보를 탐색하되 매 reconcile마다 가장 좋은 command 하나만 고르는 방식이 경계가 가장 작습니다. AZ grouping은 그 결과와 실제 workload topology를 확인한 뒤 별도 정책으로 다루는 편이 안전합니다.

## 10. 코드 근거

- 전역 정렬 시작 — `pkg/controllers/disruption/multinodeconsolidation.go:52-56`
- NodePool budget 확인과 차감 — `multinodeconsolidation.go:65-77`
- 전역 후보 목록의 100개 제한과 단일 탐색 호출 — `multinodeconsolidation.go:79-83`
- prefix 이진 탐색 — `multinodeconsolidation.go:117-182`
- 실제 스케줄링 시뮬레이션 — `consolidation.go:159-195`
- Candidate의 NodePool·zone 정보 — `types.go:199-210`
- validation의 NodePool별 최신 budget 검사 — `validation.go:268-293`
- validation의 재시뮬레이션과 replacement 호환성 검사 — `validation.go:296-355`
- Budget API가 NodePool 단위임 — `apis/v1/nodepool.go:117-150, 363-410`
- cross-pool Balanced 심사 — `balanced.go:128-180`
