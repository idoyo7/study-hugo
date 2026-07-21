---
title: "EKS 버전 업그레이드"
weight: 8
cascade:
  type: docs
---

# EKS 버전 업그레이드 — finance 클러스터 blue-green 이관 케이스

yogiyo finance(금융) 도메인 EKS 클러스터의 버전 업그레이드 실전 기록이다. [HyperDX 내재화]({{< relref "../hyperdx/_index.md" >}})가 "신규 스택을 어떻게 얹나"의 실전 케이스였다면, 이 챕터는 "**이미 돌아가는 클러스터를 어떻게 안전하게 갈아타나**"의 실전 케이스다 — 그리고 그 답을 찾는 과정에서 진단 결과가 두 번 뒤집혀 최초 계획과 최종 실행이 완전히 다른 방식이 된, 흔치 않은 기록이기도 하다. 대상은 finance **워크로드** 클러스터(`prod-finance-green`, `staging-finance-green`, 조사 시점 k8s v1.30)이며, 이들을 관리하는 허브 클러스터 `ring0-blue`는 이미 별건으로 1.33을 완료(2025-12-18)했으므로 이 챕터의 주 대상에서 제외한다.

{{< callout type="info" >}}
**한눈에** — 핵심 결정 한 장.

- **대상**: finance 워크로드(prod/staging-finance-green, 조사 시점 k8s v1.30). 관리 클러스터 ring0-blue(이미 1.33)는 별건 `✓`.
- **채택안(2026-07-21 기준)**: 기존 green을 그대로 두고 **신규 blue 클러스터를 Terraform으로 EKS 1.35 생성**하는 blue-green 이관. 애초 시도했던 **CAPI(Cluster API) GitOps in-place 업그레이드는 폐기** — 클러스터를 관리하던 CAPA 크로스계정 컨트롤러 롤이 2025-10-21부터 삭제된 채 방치돼 있었다는 사실이 드러나서다 `✓`.
- **목표 버전 1.35**: 전 컴포넌트 세트가 공식 지원하는 최고 버전. 1.36은 서드파티 애드온 6종(KEDA·kube-state-metrics·external-secrets·ArgoCD·argo-rollouts·aws-load-balancer-controller)이 아직 1.36 지원 릴리스를 내지 않아 막혀 있다 — 라이브 재검증은 {{< relref "07-version-verification-135-136.md" >}} `✓`.
- **신규 토폴로지**: managed nodegroup을 없애고 **Fargate(coredns + karpenter)** + 나머지는 **karpenter system nodepool**로 구성한다 `✓`.
- **긴급도**: green(1.30)의 확장지원 종료가 **2026-07-23**로 임박했고, 한때 대안이던 1.33도 표준지원 종료가 **2026-07-29**라 폐기됐다. 이 챕터의 날짜는 전부 절대 날짜이며, 카운트다운 표현("D-2" 등)은 발행 시점이 지나면 의미가 없으므로 쓰지 않는다 — **조사 시점 2026-07** 기준으로 읽는다 `✓`.
{{< /callout >}}

## 왜 세 번 방향이 바뀌었나 — 변천 서사

이 챕터가 참조하는 원본 조사 기록은 2026년 7월 한 달 안에서 세 번 방향을 바꿨다. 이 변천을 모르고 개별 페이지만 읽으면 "왜 CAPI 복구 절차를 이렇게 상세히 다뤄놓고 결론은 Terraform이냐"는 모순으로 보인다 — 실제로는 각 단계의 결론이 다음 단계의 전제를 뒤집은, 정상적인 조사 과정이다.

| 단계 | 시기 | 무엇을 시도했나 | 무엇이 뒤집었나 |
|---|---|---|---|
| **1기 — CAPI GitOps in-place** | 2026-07-01~02 | 워크로드 클러스터의 버전 SSOT인 `clusterapi.yaml`의 `k8sVersion`을 bump하고 ArgoCD sync로 1.30→1.33 in-place 업그레이드를 계획 | 실측 진단(07-02)에서 **CAPA가 죽어 있음을 발견**: stage/prod 계정의 크로스계정 컨트롤러 롤이 2025-10-21부터 삭제돼 있어 `AssumeRole AccessDenied`가 반복되고 있었다 `✓` → {{< relref "01-architecture-capi.md" >}} |
| **2기 — CAPI 복구 + Fargate 이관** | 2026-07-07~08 | 보안팀 로그 아카이브에서 **롤이 2025-10-21 콘솔에서 수동 삭제**됐음을 확인 → 방향을 "CAPI 복구"로 전환. 롤을 재생성하고, 시스템 노드그룹을 카펜터+coredns만 Fargate로 옮기는 이관을 실행 | 복구 자체는 성공했지만, CAPA v2.6.1이 **addon의 config-only 변경을 절대 반영하지 않는 결함**(버전 비교만 하고 Configuration은 비교 안 함, 공개 이슈 #4226)이 드러나 addon 설정의 SSOT로 CAPA를 계속 쓰기 어렵다는 결론에 도달 `✓` → {{< relref "01-architecture-capi.md" >}} |
| **3기 — blue-green 신규 클러스터 + 1.35** | 2026-07-20~21 | in-place 자체를 버리고 **신규 blue 클러스터를 Terraform으로 EKS 1.35에 생성**하는 blue-green 이관으로 대전환. 카펜터 0.36.2도 EKS 1.33+에서 더는 지원되지 않아 어차피 대규모 버전업이 필요했던 참이었다 | (현재 채택안 — 이 챕터 전체가 이 관점 위에 있다) `✓` |

**핵심은 CAPA 롤 사망 자체가 아니라, 그 죽음이 두 번 다른 의미로 읽혔다는 점이다.** 1기에서는 "복구해야 할 장애"였고, 2기에서는 "복구 가능한 장애"였으며, 3기에 이르러서는 오히려 **"blue-green 전환 중 실수로 green을 건드리지 못하게 막아주는 안전판"**으로 재해석됐다. CAPA 진단·복구·함정의 전체 흐름은 {{< relref "01-architecture-capi.md" >}}에서 이어받는다.

## 3대 확정 결정 (2026-07-21)

3기에서 확정된 결정은 세 가지다. 이 결정들이 02~06 챕터 전체를 지배한다.

1. **목표 버전 = k8s 1.35**(기존 조사의 1.33에서 상향). 1.36은 서드파티 애드온 6종(KEDA·kube-state-metrics·external-secrets·ArgoCD·argo-rollouts·aws-load-balancer-controller)이 아직 지원 릴리스를 내지 않아 막혀 있고, 1.33은 표준지원 종료가 2026-07-29로 임박해 폐기했다. 근거는 {{< relref "02-strategy-target-version.md" >}}·{{< relref "07-version-verification-135-136.md" >}}.
2. **managed nodegroup 없이 Fargate(coredns + karpenter) + 나머지는 karpenter system nodepool**. Fargate는 amd64 전용·DaemonSet 미부착·동적 EBS 불가라는 세 가지 물리 제약이 토폴로지 전체를 지배한다. 상세는 {{< relref "03-fargate-karpenter-topology.md" >}}.
3. **클러스터 생성을 CAPA 대신 Terraform으로 한다.** CAPA는 addon config의 SSOT로 부적합하다는 게 2기의 결론이었고, 3기는 아예 클러스터 생성 자체를 Terraform으로 옮겨 CAPA 의존을 없앤다. 근거는 {{< relref "04-terraform-cluster-settings.md" >}}.

## 이 챕터 구성 (블록 지도)

| 페이지 | 다루는 것 |
|---|---|
| {{< relref "01-architecture-capi.md" >}} | 허브-스포크 GitOps+CAPI 아키텍처, ArgoCD 3-tier 부트스트랩, 3레포·버전 SSOT, CAPA 단절 진단과 v2.6.1의 함정, 그래서 왜 blue-green Terraform인가 |
| {{< relref "02-strategy-target-version.md" >}} | in-place→blue-green 방식 변천, 이전 업그레이드 교훈, 목표 1.35 판정(EOL 캘린더·1.36 차단 근거) |
| {{< relref "03-fargate-karpenter-topology.md" >}} | Fargate+karpenter 목표 토폴로지, amd64 전용·DaemonSet 미부착·EBS 불가 3제약, 부트스트랩 순서 |
| {{< relref "04-terraform-cluster-settings.md" >}} | CAPA→Terraform 대체, karpenter 인프라 신규 작성, 인증·OIDC·클러스터 설정 |
| {{< relref "05-managed-addons.md" >}} | EKS managed addon 4종+cloudwatch 버전 diff, ebs-csi IRSA 리스크, 부트스트랩 설치 순서 |
| {{< relref "06-addon-inventory-drift.md" >}} | 애드온 전수 인벤토리, ArgoCD 3-tier 토폴로지 상세, 워킹트리-실배포 드리프트 |
| {{< relref "07-version-verification-135-136.md" >}} | 1.35 vs 1.36 목표 버전 실검증(2026-07-21 라이브 확인), 1.36 차단 6종 재산정, kube-proxy nftables 활성화 절차, 직행 breaking 체크리스트 |
| {{< relref "components/_index.md" >}} | 컴포넌트별 마이그레이션(karpenter·istio·argocd·argo-rollouts·external-secrets·keda·alb·관측성 스택·descheduler) |

## 자매 챕터

- [Istio]({{< relref "../istio/_index.md" >}}) — 서비스 메시 운영. 이 챕터의 [03]({{< relref "03-fargate-karpenter-topology.md" >}})·[components]({{< relref "components/_index.md" >}})가 istio 1.30.3 sidecar 이관을 다룬다.
- [모니터링]({{< relref "../monitoring/_index.md" >}}) — VictoriaMetrics 운영. 이 챕터의 [06]({{< relref "06-addon-inventory-drift.md" >}})·components가 victoria-metrics-k8s-stack 버전업을 다룬다.

## 우리 케이스에서는

**신규 blue 클러스터를 Terraform으로 EKS 1.35에 생성**하고, **managed nodegroup 없이 Fargate(coredns+karpenter) + karpenter system nodepool**로 띄운다. CAPI(CAPA) 기반 GitOps in-place는 폐기한다 — 크로스계정 컨트롤러 롤이 2025-10-21부터 죽어 있었다는 사실 자체보다, 그 위에서 드러난 "CAPA v2.6.1은 addon config 변경을 절대 반영하지 않는다"는 구조적 결함이 CAPI를 addon 관리의 SSOT로 계속 쓰기 어렵게 만들었다는 게 더 근본적인 이유다. 목표 버전은 전 컴포넌트 세트가 공식 지원하는 최고인 1.35다.

이 서사에서 반드시 못박아야 할 것은 두 가지다. 첫째, **CAPI 복구 자체는 기술적으로 성공했다** — "CAPA가 고장나서 blue-green으로 갔다"는 단순화는 틀렸다. 롤을 재생성하니 reconcile은 정상적으로 재개됐고, 문제는 그다음 단계에서 addon config가 CAPA를 거쳐서는 절대 반영되지 않는다는 별개의 결함이 드러난 것이다. 둘째, **1.33이라는 목표는 조사 도중 폐기된 값**이다. 하위 컴포넌트별 마이그레이션 문서 다수가 여전히 1.33 기준으로 작성돼 있으나, 이 챕터 전체는 **1.35로 통일**해 서술한다. 조사 시점 2026-07.
