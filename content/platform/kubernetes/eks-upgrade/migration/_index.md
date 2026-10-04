---
title: "이관 절차"
date: 2026-10-04
weight: 10
comments: false
cascade:
  type: docs
---

# 이관 절차

## 이 분류에서 찾기 {#section-navigation}

- [배경 — 왜 CAPI in-place를 버리고 blue-green인가]({{< relref "/platform/kubernetes/eks-upgrade/migration/00-background/index.md" >}})
- [목표 버전 — 1.35 판정과 1.36 차단 6종]({{< relref "/platform/kubernetes/eks-upgrade/migration/01-target-version.md" >}})
- [클러스터 설정 — Fargate+karpenter 토폴로지와 Terraform 리소스]({{< relref "/platform/kubernetes/eks-upgrade/migration/02-cluster-config/index.md" >}})
- [EKS managed addon — 5종 버전·nftables 정정·ebs-csi 연결]({{< relref "/platform/kubernetes/eks-upgrade/migration/03-managed-addons.md" >}})
- [부트스트랩 오케스트레이션 — 순서·ArgoCD 3-tier·endpoint 재바인딩]({{< relref "/platform/kubernetes/eks-upgrade/migration/04-cluster-bootstrap.md" >}})
- [컷오버·롤백 계약 — ALB 가중치 전환과 되돌리기]({{< relref "/platform/kubernetes/eks-upgrade/migration/05-cutover-rollback.md" >}})

이관 배경에서 목표 버전, 클러스터 설정, 부트스트랩과 컷오버·롤백까지 순서대로 읽습니다.
