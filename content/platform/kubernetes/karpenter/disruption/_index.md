---
title: "통합·중단 제어"
date: 2026-10-04
weight: 30
comments: false
cascade:
  type: docs
---

# 통합·중단 제어

## 이 분류에서 찾기 {#section-navigation}

- [consolidation이 되돌리는 것]({{< relref "/platform/kubernetes/karpenter/disruption/06-consolidation-traps/index.md" >}})
- [언제 무엇을 멈출 것인가 — disruption 예산]({{< relref "/platform/kubernetes/karpenter/disruption/08-disruption-budgets/index.md" >}})
- [13 consolidation 처리 흐름]({{< relref "/platform/kubernetes/karpenter/disruption/13-consolidation-models/index.md" >}})
- [14 MultiNode 예산과 후보 탐색]({{< relref "/platform/kubernetes/karpenter/disruption/14-multinode-budget-search/index.md" >}})
- [15 NodePool별 MultiNode 구현계획]({{< relref "/platform/kubernetes/karpenter/disruption/15-nodepool-multinode-plan/index.md" >}})
- [16 MultiNode upstream 이슈 조사]({{< relref "/platform/kubernetes/karpenter/disruption/16-multinode-upstream-issue-review/index.md" >}})

Consolidation 후보와 중단 예산, MultiNode 탐색을 코드와 운영 조건으로 살펴봅니다.
