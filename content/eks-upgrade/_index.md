---
title: "EKS 버전 업그레이드"
weight: 8
cascade:
  type: docs
---

# EKS 버전 업그레이드 — finance 클러스터 blue-green 이관 케이스

yogiyo finance(금융) 도메인 EKS 클러스터를 신규 blue 클러스터로 갈아타는 실전 기록이다. [HyperDX 내재화]({{< relref "../hyperdx/_index.md" >}})가 "신규 스택을 어떻게 얹나"의 케이스였다면, 이 챕터는 "**이미 돌아가는 클러스터를 어떻게 안전하게 갈아타나**"의 케이스다.

{{< callout type="info" >}}
**한눈에**

- **대상**: finance 워크로드(`prod-finance-green`·`staging-finance-green`, 현재 **k8s 1.31**). 관리 클러스터 `ring0-blue`는 별건으로 완료.
- **채택안**: green을 그대로 두고 **신규 blue 클러스터를 Terraform으로 EKS 1.35 생성**하는 blue-green 이관. CAPI(CAPA) in-place는 폐기 → [배경]({{< relref "00-background.md" >}}).
- **목표 1.35**: 전 컴포넌트 세트가 공식 지원하는 최고 버전. **1.36은 서드파티 6종이 차단** → [목표버전]({{< relref "01-target-version.md" >}}).
- **토폴로지**: managed nodegroup 0 + Fargate(coredns·karpenter) + karpenter system nodepool → [클러스터 설정]({{< relref "02-cluster-config.md" >}}).
- **런웨이**: green 확장지원 종료가 **2026-11-26**이라 약 4개월 여유가 있다(임박한 절벽 아님).
{{< /callout >}}

## 4레이어 지도

| 레이어 | 페이지 | 다루는 것 |
|---|---|---|
| 배경 | [00 배경]({{< relref "00-background.md" >}}) | 왜 CAPI in-place를 버리고 blue-green Terraform인가 |
| 목표버전 | [01 목표버전]({{< relref "01-target-version.md" >}}) | 1.35 판정·1.36 차단 6종·EOL 캘린더·직행 breaking |
| 클러스터 설정 | [02 클러스터 설정]({{< relref "02-cluster-config.md" >}}) | Fargate+karpenter 토폴로지와 Terraform 리소스 |
| managed addon | [03 managed addon]({{< relref "03-managed-addons.md" >}}) | EKS managed addon 5종·nftables 정정·ebs-csi 연결 |
| 부트스트랩 | [04 부트스트랩]({{< relref "04-cluster-bootstrap.md" >}}) | 설치 순서·ArgoCD 3-tier·endpoint 재바인딩 |
| 컷오버·롤백 | [05 컷오버·롤백]({{< relref "05-cutover-rollback.md" >}}) | ALB 가중치 트래픽 전환·롤백 계약 |
| 컴포넌트별 | [components]({{< relref "components/_index.md" >}}) | 직접배포 애드온의 버전 마이그레이션 |

## 자매 챕터

- [Istio]({{< relref "../istio/_index.md" >}}) — 서비스 메시 운영. 이 챕터의 [components]({{< relref "components/_index.md" >}})가 istio sidecar 이관을 다룬다.
- [모니터링]({{< relref "../monitoring/_index.md" >}}) — VictoriaMetrics 운영. 이 챕터의 [components]({{< relref "components/_index.md" >}})가 victoria-metrics-k8s-stack 버전업을 다룬다.
