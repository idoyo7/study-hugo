---
title: "16 · NodePool-aware MultiNode consolidation — upstream 이슈 조사와 기여 경로"
linkTitle: "16 MultiNode upstream 이슈 조사"
weight: 16
---

{{< callout type="info" >}}
**먼저 결론**

- 이 문제는 AWS provider가 아니라 **provider-neutral Karpenter core**의 MultiNode 후보 탐색 알고리즘에 있습니다.
- 논의 장소도 `aws/karpenter-provider-aws`보다 `kubernetes-sigs/karpenter`가 맞습니다.
- 다만 새 Issue는 권장하지 않습니다. 같은 문제를 직접 다룬 `#853`, `#2434`, `#2814`가 이미 있습니다.
- 현재 기준점은 열린 채 `triage/accepted`된 **[#2434 Multinode consolidation delayed/stuck](https://github.com/kubernetes-sigs/karpenter/issues/2434)**입니다.
- 별도 `consolidationCoverage` 설정을 앞세우기보다 `#2434`에 재현 사례와 측정값을 추가하고 **설정 없는 후보 compatibility 개선**을 RFC에서 논의하는 편이 upstream 방향과 맞습니다.
- 조사 기준일은 **2026-08-04**입니다. Issue 상태와 라벨은 이후 변경될 수 있습니다.
{{< /callout >}}

## 0. 핵심 Issue 네 개를 먼저 비교

| 항목 | NodePool별 필터링과의 거리 | 현재 진전 | 역할 |
|---|---:|---:|---|
| [#2814 ConsolidationGroup](https://github.com/kubernetes-sigs/karpenter/issues/2814) | 가장 가까움 | 종료 | 구체적인 hard-grouping 해결안 |
| [PR #2871 node-group POC](https://github.com/kubernetes-sigs/karpenter/pull/2871) | 매우 가까움 | 코드 존재, 정체 | label·AZ grouping 실제 구현 |
| [#2434 Multinode delayed/stuck](https://github.com/kubernetes-sigs/karpenter/issues/2434) | 문제 정의가 직접적 | Accepted, 구현 없음 | canonical root-cause Issue |
| [#3141 priority-scored list](https://github.com/kubernetes-sigs/karpenter/issues/3141) | hard filter보다는 heuristic | Accepted, needs-design | 가장 활발한 장기 설계 |

### 0.1 NodePool별 필터링에 가장 가까운 것

Issue만 비교하면 `#2814`가 가장 가깝습니다.

```text
전체 Candidate
  → consolidationGroup별 grouping
  → group별 firstNConsolidationOption
  → group별 scheduling simulation
```

| 구현 | source 후보 경계 |
|---|---|
| 현재 로컬 POC | `NodePool.Name` |
| #2814 | 사용자가 지정한 `consolidationGroup` |
| PR #2871 | node type label + AZ |
| #3141 논의 | same-NodePool·architecture 등의 compatibility score |

코드까지 나와 있는 항목 중에서는 PR `#2871`이 가장 가깝습니다. 전역 100개 제한을 우회했고 bin-packing 결과가 개선됐다는 운영 결과도 함께 보고했습니다.

### 0.2 무엇이 가장 진전됐는가

진전의 의미를 나누어 봐야 합니다.

| 진전 기준 | 가장 앞선 항목 | 이유 |
|---|---|---|
| 문제의 공식 인정 | `#2434` | `triage/accepted`, `priority/important-soon` |
| NodePool-aware 구체 설계 | `#2814` | grouping API와 실행 흐름까지 제안 |
| 동작하는 코드 | PR `#2871` | 실제 grouping POC와 운영 결과 존재 |
| maintainer가 주도하는 장기 방향 | `#3141` | `help wanted`, `needs-design`, working group 논의 진행 |
| merge 가능성 | 아직 확정된 항목 없음 | RFC·승인·최종 구현이 아직 없음 |

PR `#2871`에는 코드가 있지만 현재 상태는 `lifecycle/stale`, `needs-rebase`, `do-not-merge/work-in-progress`입니다. 구현물이 있다는 점에서는 앞서 있어도 merge에 가깝지는 않습니다.

`#3141`은 가장 활발한 장기 방향입니다. 다만 NodePool별 hard grouping 대신 다음과 같은 pair/set heuristic을 논의합니다.

```text
pairScore(A, B)
  = priority(A)
  + priority(B)
  + sameNodePoolBonus
  + architecture/requirements compatibility
```

현재 upstream이 선호하는 방향은 이렇습니다.

NodePool을 유일한 강제 경계로 고정하기보다, NodePool·architecture·AZ·requirements를 compatibility 신호로 사용해 더 유망한 후보 pair/set을 우선 탐색합니다.

### 0.3 네 항목의 관계

```text
#2434
  문제: 전역 정렬·100개 제한·prefix 탐색으로 MultiNode 기회 누락
       │
       ├── #2814
       │     해결안: consolidationGroup별 hard grouping
       │     결과: 대안 비교는 RFC에서 하도록 안내 후 종료
       │
       ├── PR #2871
       │     POC: label + AZ별 grouping
       │     결과: bin-packing 개선, simulation 비용 증가, 현재 정체
       │
       └── #3141
             장기 방향: 통합 scored list + compatibility heuristic
             상태: accepted, needs-design, MultiNode는 follow-up
```

지금 기여할 때는 `#2814` 같은 새 Feature Issue를 반복하기보다 `#2434`에 근거를 보태고 `#3141`의 compatibility-aware MultiNode 후속 설계로 연결하는 편이 적절합니다.

## 1. 어느 저장소에 제안해야 하는가

### 1.1 Core Karpenter가 맞다

문제가 생기는 위치는 provider별 가격 조회나 EC2 API가 아닙니다.

```text
Karpenter core
  Candidate 수집
    → 전역 정렬
    → NodePool별 budget 확인
    → 혼합 prefix 생성
    → MultiNode scheduling simulation
```

`NodePool`, `NodeClaim`, disruption budget과 consolidation controller는 provider-neutral core API와 controller에 속합니다. AWS provider는 `EC2NodeClass`, offering 가격과 AWS 인프라 동작을 맡습니다.

| 변경 | 주 저장소 |
|---|---|
| MultiNode 후보 grouping·ranking·탐색 | `kubernetes-sigs/karpenter` |
| NodePool disruption budget 적용 방식 | `kubernetes-sigs/karpenter` |
| provider-neutral CLI 옵션 | `kubernetes-sigs/karpenter` |
| AWS Helm chart의 환경변수 전달 | core 옵션이 합의된 뒤 `aws/karpenter-provider-aws` |
| EC2 가격·offering·capacity reservation | `aws/karpenter-provider-aws` |

공식 NodePool 문서에도 NodePool은 cloud provider의 NodeClass를 참조하는 공통 Karpenter API로 적혀 있습니다.

- [Karpenter NodePools](https://karpenter.sh/preview/concepts/nodepools/)
- [Karpenter Getting Started — AWS, Azure, Alibaba Cloud](https://karpenter.sh/docs/getting-started/)

### 1.2 다른 managed cluster도 NodePool을 사용하는가

Karpenter를 도입한 provider라면 같은 `karpenter.sh/v1 NodePool` 개념을 사용합니다.

- AWS: `NodePool` + `EC2NodeClass`
- Azure/AKS Node Auto Provisioning: 공통 `NodePool` 모델 + Azure provider NodeClass
- Alibaba Cloud ACK provider: 공통 `NodePool` 모델 + provider별 NodeClass
- 기타 Karpenter provider도 core API와 cloud provider interface 위에 구현합니다.

`NodePool-aware MultiNode 후보 탐색`은 AWS 전용 문제가 아닙니다. ARM/x86, zone, capacity type, taint와 workload partition처럼 서로 scheduling-compatible하지 않은 노드가 하나의 전역 후보 목록에 섞이는 provider라면 어디서나 나타날 수 있습니다.

다만 모든 managed Kubernetes가 Karpenter의 `NodePool`을 쓰는 것은 아닙니다. Cluster Autoscaler의 node group이나 각 cloud의 managed node pool은 이름이 비슷해도 별도 API입니다. 여기서 말하는 범위는 Karpenter controller가 관리하는 `karpenter.sh/v1 NodePool`입니다.

## 2. Issue 검색 방법

GitHub core 저장소에서 open/closed Issue를 모두 대상으로 다음 검색어를 교차 검색했습니다.

```text
multinode consolidation
"multi-node" consolidation
consolidation binary search
consolidation candidate ordering
consolidation nodepool
consolidation "first 100"
consolidation grouping
```

검색 결과 중 `NodePool`이나 `consolidation`이라는 단어만 들어 있는 Issue는 제외했습니다. 아래 조건 중 하나를 만족한 항목은 본문과 maintainer 댓글까지 다시 확인했습니다.

1. 전역 후보 순서 또는 prefix-only 탐색
2. NodePool·architecture·AZ 등 compatibility boundary
3. 100개 후보 제한과 starvation
4. MultiNode simulation timeout 또는 대규모 클러스터 성능
5. 이 문제를 해결하려는 POC/RFC

## 3. 직접 중복되거나 계보상 이어지는 Issue

### 3.1 #853 — 최초의 직접적인 문제 제기

**[Partitioned NodePool Multi-node Consolidation #853](https://github.com/kubernetes-sigs/karpenter/issues/853)**

| 항목 | 내용 |
|---|---|
| 생성 | 2023-12-08 |
| 상태 | Closed — Not Planned |
| 종료 사유 | 기술적으로 기각된 것이 아니라 stale/rotten 자동 종료 |
| 직접성 | 매우 높음 |

이 Issue는 다음을 정확히 지적했습니다.

- 서로 독립적인 NodePool의 노드를 하나의 전역 MultiNode 후보로 수집
- pending pod가 다른 partition에 속하면 simulation이 실패할 수 있음
- NodePool별 또는 compatible NodePool group별로 독립 consolidation 필요

maintainer 댓글에서도 NodePool 수만큼 `n`개의 MultiNode consolidation을 수행하는 방향을 언급했습니다. 이후 댓글에서는 NodePool뿐 아니라 `amd64`와 `arm64`가 섞이는 문제까지 지적했습니다.

우리가 확인한 문제는 최소 2023년부터 upstream에 보고되어 있었습니다.

### 3.2 #2434 — 현재 유지해야 할 canonical problem Issue

**[Multinode consolidation delayed/stuck #2434](https://github.com/kubernetes-sigs/karpenter/issues/2434)**

| 항목 | 내용 |
|---|---|
| 생성 | 2025-08-13 |
| 상태 | Open |
| 라벨 | `kind/bug`, `triage/accepted`, `priority/important-soon`, `lifecycle/rotten` |
| 직접성 | 가장 높음 |

핵심 재현은 이렇습니다.

- 여러 NodePool이 있는 80노드 클러스터
- 특정 NodePool의 `2 × m7g.2xlarge → 1 × r7g.2xlarge`는 가능
- 다른 NodePool의 consolidation을 끄면 즉시 성공
- 전체 후보의 처음 100개만 대상으로 함
- 전역 정렬과 prefix binary search가 특정 NodePool 기회를 starvation시킴

maintainer는 binary search가 이상적이지 않다고 인정하면서 이 Issue를 `triage/accepted` 처리했습니다. `#2814`를 닫을 때도 이 Issue를 문제 정의의 기준점으로 지정했습니다.

{{< callout type="warning" >}}
`#2434`에는 현재 `lifecycle/rotten` 라벨도 붙어 있습니다. 하지만 2026-06-09에 maintainer가 다시 `triage accepted`를 적용했고 2026-07-31에도 진행 여부 질문이 올라왔습니다. 새 중복 Issue보다 이 Issue에 구체적인 운영 자료를 추가하는 편이 낫습니다.
{{< /callout >}}

### 3.3 #2814 — 우리가 생각한 해결안과 거의 같은 제안

**[ConsolidationGroup for NodePool-aware Multi-node Consolidation #2814](https://github.com/kubernetes-sigs/karpenter/issues/2814)**

| 항목 | 내용 |
|---|---|
| 생성 | 2026-01-22 |
| 상태 | Closed — Completed |
| 직접성 | 해결안 기준으로 거의 동일 |

제안 내용은 이렇습니다.

- 전역 후보에 다른 NodePool이 섞여 두 개 이상의 replacement가 필요해지는 문제
- `firstNConsolidationOption()`의 prefix binary search 한계
- 후보를 `consolidationGroup`별로 묶어 MultiNode simulation 수행
- group별 병렬 평가는 후속으로 고려

그러나 maintainer 피드백은 명확했습니다.

1. root cause는 `#2434`와 같습니다.
2. 별도 configuration 없이 Karpenter 후보 선택 알고리즘을 개선해야 합니다.
3. 해결안과 대안 비교는 Issue보다 RFC에서 수행해야 합니다.
4. NodePool 경계만으로는 충분하지 않습니다. 같은 NodePool 안에도 ARM/x86처럼 함께 consolidate할 수 없는 노드가 존재합니다.

2026-06-08에 위 이유로 닫혔습니다. 동일한 `consolidationCoverage` 또는 `consolidationGroup` Feature Issue를 새로 만들면 중복으로 판단될 가능성이 매우 높습니다.

## 4. 현재 진행 중인 상위 설계

### 4.1 #3141 — candidate scoring과 MultiNode compatibility의 향후 방향

**[Unify disruption methods into a single priority-scored candidate list #3141](https://github.com/kubernetes-sigs/karpenter/issues/3141)**

| 항목 | 내용 |
|---|---|
| 생성 | 2026-07-14 |
| 상태 | Open |
| 라벨 | `help wanted`, `needs-design`, `triage/accepted` |
| 관계 | 장기 설계와 직접 연결 |

이 Issue는 disruption method를 하나의 priority-scored candidate list로 통합하는 RFC 방향입니다. MultiNode는 별도 follow-up으로 두되 다음 아이디어를 명시합니다.

- sorted multi-node pair
- same-NodePool bonus
- 후보 쌍의 compatibility heuristic
- budget과 기존 validation gate는 계속 유지

working group 댓글에서는 `same nodepool`, `same architecture` 같은 compatibility 신호와 MultiNode 전용 heuristic이 필요하다고 논의했습니다.

우리의 NodePool별 budget coverage 아이디어는 단기적으로 `#2434`의 재현 가능한 완화책입니다. 장기적으로는 `#3141`의 **compatible candidate pair/set 탐색**과 합쳐질 가능성이 큽니다.

## 5. 관련 POC와 구현 시도

| PR | 상태 | 내용 | 평가 |
|---|---|---|---|
| [#2871 POC consolidate within each node-group](https://github.com/kubernetes-sigs/karpenter/pull/2871) | Open, WIP | label과 AZ 기준 grouping 후 group별 consolidation | 현재 구현과 가장 가까운 upstream POC |
| [#2873 POC disruption cost 변경](https://github.com/kubernetes-sigs/karpenter/pull/2873) | Closed, WIP | 비어 있는 노드를 먼저 보도록 정렬 변경 | 후보 ordering 개선 실험 |
| [#2910 single-node grouping POC](https://github.com/kubernetes-sigs/karpenter/pull/2910) | Open, WIP | node type과 pool grouping으로 single-node 탐색 단축 | grouping의 성능 효과 참고 |
| [#2645 MultiNode metrics POC](https://github.com/kubernetes-sigs/karpenter/pull/2645) | Closed, WIP | binary search iteration, batch size, failed simulation metric | 변경 전후 효과 측정에 유용 |

`#2871`은 `node-type + AZ`로 grouping하며 다음 효과를 보고했습니다.

- incompatible NodePool 간 계산 회피
- 100개 후보 제한 우회
- AZ 요구가 다른 pod 때문에 replacement가 2개 이상 생성되는 실패 완화

반면 simulation 수와 validation failure가 늘어날 수 있다는 단점도 확인했습니다. 현재 로컬 구현은 모든 NodePool을 공용 1분 deadline 안에서 순차 평가하는 설계이므로 성능 측정을 반드시 함께 해야 합니다.

## 6. 증상과 성능을 공유하는 주변 Issue

### 6.1 후보 탐색 누락·결과 부족

| Issue | 상태 | 관계 |
|---|---|---|
| [#1442 Can't remove without creating 2 candidates](https://github.com/kubernetes-sigs/karpenter/issues/1442) | Open | scheduling boundary가 섞였을 때 나타날 수 있는 대표 증상 |
| [#1962 cheaper combination이 있어도 consolidation 안 됨](https://github.com/kubernetes-sigs/karpenter/issues/1962) | Open, Accepted | 유효한 multi-node 조합을 탐색하지 못하는 결과 |
| [#2150 cheapest overall option 미선택](https://github.com/kubernetes-sigs/karpenter/issues/2150) | Closed | 후보 heuristic과 scheduling constraint의 관계 |
| [#2084 empty node보다 pod가 있는 node 선택](https://github.com/kubernetes-sigs/karpenter/issues/2084) | Open, Accepted | disruption cost 기반 ordering 문제 |

### 6.2 후보 수·timeout·대규모 클러스터

| Issue | 상태 | 관계 |
|---|---|---|
| [#1733 consolidation timeout 설정](https://github.com/kubernetes-sigs/karpenter/issues/1733) | Open, Accepted | 복잡한 NodePool에서 timeout 반복 |
| [#1970 큰 클러스터에서 consolidation 불가](https://github.com/kubernetes-sigs/karpenter/issues/1970) | Closed | 700노드 규모 timeout·직렬 처리 문제 |
| [#2826 MultiNode timeout 설정](https://github.com/kubernetes-sigs/karpenter/issues/2826) | Closed | `#1733` 중복으로 종료 |
| [#2972 scale에서 consolidation CPU 증가](https://github.com/kubernetes-sigs/karpenter/issues/2972) | Open, Accepted | 반복 scheduler construction 비용 측정 |
| [#3186 max candidate 수 설정](https://github.com/kubernetes-sigs/karpenter/issues/3186) | Open, Accepted | 100개 고정값과 timeout의 직접적인 후속 |

`#3186`의 maintainer 댓글은 특히 중요합니다. MultiNode roadmap을 계획 중이므로 장기 공개 설정을 늘리기보다 임시 undocumented flag 또는 timeout에 따라 후보 수를 동적으로 줄이는 방향을 선호한다고 밝혔습니다.

이 댓글이 `consolidationCoverage`를 정식 사용자 설정으로 바로 upstream하기보다 설정 없는 algorithm improvement나 실험적 내부 flag로 접근해야 한다는 근거입니다.

### 6.3 budget semantics 관련

| Issue | 상태 | 관계 |
|---|---|---|
| [#924 disruption reason별 budget](https://github.com/kubernetes-sigs/karpenter/issues/924) | Closed, Completed | 현재 reason별 NodePool budget의 기반 |
| [#2218 disruption budget 문서 불명확](https://github.com/kubernetes-sigs/karpenter/issues/2218) | Open, Accepted/Backlog | budget 의미와 실제 동작 설명 부족 |
| [#2344 allowed disruptions metric과 schedule 불일치](https://github.com/kubernetes-sigs/karpenter/issues/2344) | Open | budget 계산·관측 가능성 문제 |

이 항목들은 후보 grouping 문제와 직접 중복되지는 않습니다. 다만 “NodePool별 budget이 실행 제한뿐 아니라 탐색 기회도 의미해야 하는가”를 설명할 때 배경 자료로 사용할 수 있습니다.

## 7. 새 Issue를 만들 것인가

### 권장: 새 Issue를 만들지 않는다

현재는 다음 순서가 적절합니다.

1. `#2434`에 우리 운영 사례와 코드 분석을 댓글로 추가
2. `#853`, `#2814`, `#2871`을 연결
3. NodePool budget별 후보 coverage 부족을 새로운 관찰점으로 설명
4. 로컬 POC의 전후 metric을 첨부
5. 구현 참여 의사를 밝히고 RFC 또는 현재 MultiNode roadmap의 작업 단위를 질문
6. `#3141`에는 compatibility heuristic 관점의 설계 의견을 별도로 추가

새 Issue가 필요한 경우는 maintainer가 `#2434`의 범위와 다르다고 명시하거나 구체적 구현 단위를 별도 Issue로 분리해 달라고 요청할 때입니다.

## 8. Issue 댓글에 담아야 할 근거

설정 제안보다 다음 증거가 먼저입니다.

### 8.1 문제 정의

```text
NodePool별 disruption budget은 남아 있지만,
전역 후보 정렬과 prefix-only binary search 때문에
일부 NodePool의 내부 multi-node 조합은 simulation에 도달하지 못한다.
```

### 8.2 최소 재현

```text
Pool A: 후보 수가 많고 전역 정렬 앞부분을 차지하지만 조합은 실패
Pool B: 두 노드를 한 노드로 교체할 수 있고 budget=2

Cluster-wide prefix:
  Pool A 후보가 섞여 Pool B의 두 노드 조합을 독립적으로 평가하지 못함

Pool B 독립 탐색:
  2 nodes → 1 replacement simulation 성공
```

### 8.3 첨부할 metric

- 전체 candidate 수
- NodePool별 candidate 수
- NodePool별 allowed disruption budget
- simulation을 실제 수행한 prefix 크기와 NodePool 구성
- 성공/실패 simulation 횟수
- `Can't remove without creating N candidates` 횟수
- consolidation timeout 횟수
- loop duration과 controller CPU
- Cluster 방식과 grouping POC의 성공 command·절감액 비교

### 8.4 피해야 할 주장

- “NodePool별 grouping이 모든 문제를 해결합니다.”
- “AZ까지 나누면 항상 정확합니다.”
- “budget이 있으므로 반드시 그 수만큼 disruption해야 합니다.”
- “새 설정값이 유일한 해결책입니다.”

같은 NodePool 안에서도 architecture, zone-bound volume, taint, capacity type과 pod affinity 때문에 후보끼리 호환되지 않을 수 있습니다. NodePool grouping은 좋은 첫 필터지만 완전한 compatibility partition은 아닙니다.

## 9. Upstream에 제안할 해결안의 표현

### 로컬 실험 표현

```yaml
settings:
  consolidationCoverage: NodePool
```

이 설정은 기존 Cluster 동작과 POC를 비교하는 데 유용합니다.

### Upstream 표현

```text
Introduce a compatibility-aware pre-partitioning or candidate-pair heuristic
for multi-node consolidation, while preserving existing NodePool disruption
budgets and final scheduling validation.
```

upstream에서는 사용자 설정 자체보다 다음 계약을 제안하는 편이 좋습니다.

1. 모든 NodePool budget은 기존처럼 안전 제한으로 유지
2. 서로 호환될 가능성이 높은 source candidate가 함께 simulation될 기회 보장
3. 한 NodePool이나 compatibility group이 전역 prefix 때문에 starvation되지 않음
4. 최종 scheduling simulation과 validation은 그대로 유지
5. 전체 simulation 수와 controller CPU는 bounded
6. NodePool은 첫 번째 compatibility signal일 뿐 유일한 경계는 아님

## 10. 추천 기여 경로

```text
#2434에 재현·metric·POC 결과 추가
  → maintainer에게 RFC/roadmap 연결점 확인
  → 필요하면 designs/ RFC PR
  → core algorithm + KWOK regression test PR
  → core 릴리스/의존성 반영
  → 필요한 경우 provider별 chart PR
```

Karpenter 공식 Feature Lifecycle은 사용자에게 보이는 disruption 동작이나 주요 알고리즘 변경에 RFC가 필요할 가능성이 높다고 설명합니다.

- [Feature Lifecycle](https://github.com/kubernetes-sigs/karpenter/blob/main/FEATURE_LIFECYCLE.md)
- [Scope Guidelines](https://github.com/kubernetes-sigs/karpenter/blob/main/SCOPE.md)
- [Contributing](https://github.com/kubernetes-sigs/karpenter/blob/main/CONTRIBUTING.md)
- [Development Guide](https://karpenter.sh/docs/contributing/development-guide/)

## 11. 최종 판단

| 질문 | 판단 |
|---|---|
| AWS provider Issue로 올릴까 | 아니오. 후보 탐색은 core 문제 |
| 다른 Karpenter provider에도 NodePool이 있는가 | 예. NodePool은 provider-neutral core API |
| 새 core Issue를 만들까 | 현재는 아니오. `#2434`가 canonical Issue |
| 동일한 선행 제안이 있는가 | 예. `#853`, `#2814`가 거의 같은 문제를 다룸 |
| 로컬 NodePool grouping POC는 의미가 있는가 | 예. `#2871`과도 방향이 일치하며 실험 가치가 있음 |
| `consolidationCoverage`를 그대로 upstream할까 | 가능성 낮음. maintainer는 설정 없는 알고리즘 개선을 선호 |
| 다음 행동 | `#2434`에 측정 가능한 재현과 POC 비교 결과를 추가 |

가장 중요한 변화는 이것입니다.

새롭게 발견한 고립된 문제가 아니라, upstream이 이미 인정한 MultiNode 후보 탐색 문제를 놓고 NodePool budget coverage라는 구체적인 관찰과 검증 가능한 POC를 우리가 확보한 상태입니다.
