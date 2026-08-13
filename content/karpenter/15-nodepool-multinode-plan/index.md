---
title: "15 · NodePool별 MultiNode consolidation — 최소 변경 구현계획"
linkTitle: "15 NodePool별 MultiNode 구현계획"
weight: 15
---

{{< callout type="info" >}}
**이 문서의 범위**

- AZ grouping에 앞서 NodePool별 disruption budget이 독립된 MultiNode 후보 탐색으로 이어지게 만드는 최소 변경계획입니다.
- 기존 `Cluster` 동작은 기본값으로 그대로 두고 그 위에 `NodePool` coverage를 opt-in으로 추가합니다.
- source 후보만 같은 NodePool로 제한하고 replacement NodePool과 기존 destination node는 기존 scheduler 동작을 유지합니다.
- Pool별 command를 전부 병렬 실행하지는 않습니다. 유효한 결과 중 하나만 선택합니다.
{{< /callout >}}

## 1. 목표

각 NodePool의 잔여 disruption budget 안에서 MultiNode consolidation이 **독립된 후보 묶음 하나를 실제로 simulation할 기회**를 갖게 하는 것이 목표입니다.

> 한 NodePool의 후보가 다른 NodePool 후보와 같은 전역 prefix에 섞였다는 이유로 해당 Pool 안에서 가능한 MultiNode consolidation이 평가조차 되지 않는 상황을 없앱니다.

## 2. 현재 탐색이 놓치는 것

```text
전체 Candidate
  → SavingsRatio 전역 정렬
  → 후보마다 NodePool budget 확인·차감
  → 단일 disruptableCandidates 배열
  → candidates[0:n] prefix만 이진 탐색
```

후보가 약 30개인데 큰 prefix가 계속 실패하면 실제로 평가되는 prefix는 대략 크기 16·8·4·2의 네 개뿐입니다. 같은 크기의 다른 부분집합, Pool별 묶음, 뒤쪽 후보끼리의 묶음은 평가하지 않습니다.

| 구분 | 판정 |
|---|---|
| 전역 prefix 이외 조합을 평가하지 않음 | 코드로 확인 |
| 가능한 탐색 공간에 비해 실제 probe가 매우 적음 | 코드와 산술로 확인 |
| 이것이 특정 클러스터 consolidation 부족의 주원인 | 운영 metric 확인 필요 |

근거:

- 전역 정렬 — `pkg/controllers/disruption/multinodeconsolidation.go:52-56`
- NodePool budget 사전 필터 — `multinodeconsolidation.go:65-77`
- 단일 탐색 호출 — `multinodeconsolidation.go:79-83`
- prefix-only slice — `multinodeconsolidation.go:136-141`
- 성공/실패에 따라 크기만 변경 — `multinodeconsolidation.go:176-182`

## 3. 제안 동작

```text
전체 Candidate
  → NodePool별 group
  → Pool 내부 결정적 정렬
  → Pool별 실효 budget만큼 제한
  → Pool별 기존 firstNConsolidationOption
  → 유효 command 비교
  → winner 하나만 기존 validation과 queue로 전달
```

### 3.1 포함 범위

1. `Candidate.NodePool.Name` 기준 grouping
2. Pool 내부 `SavingsRatio` 정렬
3. `BuildDisruptionBudgetMapping()`이 계산한 Pool별 잔여 budget 적용
4. Pool별 기존 prefix simulation
5. 결정적 winner 선택
6. 전체 1분 timeout 공유
7. 기존 15초 validation 재사용
8. timeout으로 미방문 Pool이 있으면 consolidated mark 금지

### 3.2 이번에 제외하는 범위

- AZ grouping
- Pool 내부 비-prefix subset 탐색
- replacement NodePool/AZ 제한
- destination 기존 노드 범위 제한
- 여러 Pool command 동시 실행
- AZ별 disruption budget

## 4. 설정 계약

기본값은 기존 동작입니다.

```yaml
settings:
  consolidationCoverage: Cluster
```

| 값 | 동작 |
|---|---|
| `Cluster` | 기존 전역 후보·전역 prefix 탐색 |
| `NodePool` | source 후보를 NodePool별로 나눠 독립 탐색 |

여기서 `NodePool`은 source coverage를 뜻합니다.

```text
source candidates       = 동일 NodePool
destination existing    = 클러스터 전체
replacement NodePool    = 전체 managed NodePool에서 scheduler 선택
```

핵심 알고리즘은 먼저 생성자 option으로 구현해 검토하고 승인 후에 CLI/env/Helm 연결을 별도 커밋으로 붙입니다.

## 5. Pool별 후보와 winner

Pool 내부 정렬:

1. `SavingsRatio` 내림차순
2. `RescheduleDisruptionCost` 오름차순
3. Node 이름 오름차순

Pool별 유효 command 비교:

1. `EstimatedSavings()` 내림차순
2. 제거 후보 수 내림차순
3. Pool disruption cost 오름차순
4. NodePool 이름 오름차순

마지막 항목인 NodePool 이름이 map iteration에 따른 비결정성을 제거하는 최종 tie-breaker입니다.

## 6. timeout과 consolidated 상태

Pool마다 1분 timeout을 따로 만들면 Pool 수만큼 reconcile이 늘어날 수 있습니다. 그래서 전체 탐색에는 기존 1분 deadline 하나만 만들고 모든 Pool이 이를 공유합니다.

```text
전체 1분
  ├ Pool A
  ├ Pool B
  └ Pool C
```

다음 경우에는 `markConsolidated()`를 호출하지 않습니다.

- 어떤 Pool이 budget 때문에 충분한 후보를 제공하지 못함
- timeout으로 미방문 Pool이 있음
- context cancellation

모든 eligible Pool을 평가했고 budget 제약 없이 전부 NoOp이었을 때만 consolidated 상태로 표시합니다.

## 7. 구현 단위

### 커밋 1 — 회귀 테스트

- 전역 prefix 간섭 재현
- Pool별 budget 상한
- 한 Pool 실패 후 다른 Pool 성공
- timeout 미방문 Pool과 consolidated 래치
- 입력 순서가 달라도 같은 winner

### 커밋 2 — 핵심 알고리즘

대상:

- `pkg/controllers/disruption/multinodeconsolidation.go`
- 기존 `MethodOptions` 위치
- disruption consolidation 테스트

예상 규모:

| 구분 | 규모 |
|---|---:|
| 프로덕션 | 120–220 LOC |
| 테스트 | 180–300 LOC |
| 파일 | 2–4개 |

### 커밋 3 — 사용자 설정

- core option enum, CLI, env
- AWS Helm values와 deployment env
- 파싱·렌더 테스트와 문서

## 8. 핵심 테스트

### 전역 prefix 간섭

```text
global order: A1, B1, A2, B2
Cluster: [A1,B1] → NoOp
NodePool A: [A1,A2] → valid command
```

### Pool별 budget

```text
Pool A: 후보 5, budget 2 → simulation 후보 ≤ 2
Pool B: 후보 6, budget 3 → simulation 후보 ≤ 3
```

### 실패 격리

- Pool A는 topology/volume 조건으로 NoOp
- Pool B는 valid command
- 최종 결과는 Pool B command

### validation

- command 계산 후 15초 사이 선택 Pool budget이 0으로 감소
- 기존 validator가 command를 거부

### timeout

- Pool A 이후 전체 deadline 만료
- Pool B 미방문
- command가 없더라도 `IsConsolidated()`는 false

## 9. 수용 기준

1. 기본 Cluster mode 결과가 기존 테스트와 동일합니다.
2. NodePool mode command의 모든 source candidate가 같은 Pool입니다.
3. 각 Pool simulation 후보 수가 잔여 budget을 넘지 않습니다.
4. 한 Pool의 NoOp이 다음 Pool 탐색을 막지 않습니다.
5. winner 선택이 입력/map 순서와 무관하게 결정적입니다.
6. 전체 탐색이 기존 1분 deadline 하나를 공유합니다.
7. timeout으로 미방문 Pool이 있으면 consolidated mark를 하지 않습니다.
8. 최종 command만 기존 validation과 queue로 전달합니다.
9. 한 reconcile의 MultiNode command는 최대 하나입니다.
10. AZ grouping과 replacement 격리는 포함하지 않습니다.

## 10. 구현 전 운영 확인

```text
karpenter_voluntary_disruption_eligible_nodes{reason="underutilized"}
karpenter_voluntary_disruption_consolidation_timeouts_total{consolidation_type="multi"}
karpenter_nodepools_allowed_disruptions{reason="underutilized"}
karpenter_nodepools_nodes_consuming_budgets{reason="underutilized"}
karpenter_voluntary_disruption_failed_validations_total{consolidation_type="multi"}
```

- eligible 후보가 2 미만이면 grouping보다 후보 자격과 `consolidateAfter`가 먼저입니다.
- 실효 budget이 2 미만이면 MultiNode가 성립하지 않습니다.
- timeout이 증가한다면 Pool별 순차 simulation 비용을 먼저 제어해야 합니다.
- failed validation만 높다면 후보 탐색보다 15초 동안의 churn이나 budget 변화가 핵심일 수 있습니다.

## 11. 구현 전 피드백 항목

1. `NodePool`을 source 후보 coverage로 정의하는가
2. winner를 예상 절감액 우선으로 고르는가
3. 알고리즘과 CLI/Helm 연결을 별도 커밋으로 나누는가
4. 전체 timeout을 기존 1분으로 유지하는가
5. Cluster 기본값, NodePool opt-in으로 출시하는가

## 12. 후속 TODO

### P1 — `NodePoolAZ` grouping

이어서 가장 먼저 손댈 기능입니다.

```text
전체 후보
  → NodePool별 group
  → AZ별 subgroup
  → 각 NodePool+AZ group을 Pool 잔여 budget까지 독립 simulation
  → NodePool 전체 lane 결과와 함께 winner 비교
```

- same-AZ 후보 탐색 기회를 보장합니다.
- NodePool 전체 lane도 그대로 둡니다. 혼합 AZ도 delete-only로 성공할 수 있기 때문입니다.
- winner 하나만 실행하므로 budget을 AZ별로 미리 나누지 않습니다.
- source가 같은 AZ여도 replacement AZ까지 같아지는 것은 아닙니다.

### P2 — bounded multi-lane subset 탐색

- SavingsRatio lane
- disruption cost lane
- 여러 deterministic anchor
- 전체 deadline 안에서 제한된 simulation

### P3 — reconcile 간 Pool 공정성

- 미방문 Pool 우선 cursor
- 성공 Pool 독점 방지 rotation
- 방문·미방문·선택 Pool 관측

### P4 — Hybrid coverage

- Cluster와 NodePool/NodePoolAZ 결과 동시 비교
- cross-pool 절감 기회 보존

### P5 — Strict 격리

- `NodePoolStrict`: replacement Pool 제한
- `NodePoolAZStrict`: replacement Pool과 AZ 제한
- destination 기존 노드 범위 결정

### P6 — 여러 Pool command 동시 실행

- budget reservation
- simulation 간 destination capacity 경쟁 처리
- validation/queue race 방지

### P7 — AZ별 독립 budget

- Budget topology selector
- CRD와 validation/defaulting
- NodePool+AZ별 disrupting 집계
- 모든 disruption method와 metrics 변경

AZ별 budget은 후보 grouping과 분리된 API 기능이라 별도 RFC로 다룹니다.

## 13. 코드·분석 근거

- `addons/karpenter/pkg/controllers/disruption/multinodeconsolidation.go`
- `addons/karpenter/pkg/controllers/disruption/consolidation.go`
- `addons/karpenter/pkg/controllers/disruption/validation.go`
- `karpenter-consolidation-analysis/reports/karpenter-consolidation-crosscheck.md`
- `karpenter-consolidation-analysis/reports/karpenter-multinode-az-grouping.md`
