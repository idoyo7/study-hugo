---
title: "컴포넌트별 마이그레이션"
weight: 7
---

# 컴포넌트별 마이그레이션 — 10종 애드온을 1.35로

[EKS 버전 업그레이드]({{< relref "../_index.md" >}}) 챕터의 정본 6페이지가 "왜 blue-green Terraform으로 1.35까지 가는가"를 다뤘다면, 이 하위 섹션은 그 위에서 실제로 **워크로드 위에 얹힌 애드온 10종을 어떻게 목표 버전까지 올리는가**를 다룬다. 대상은 karpenter·istio·argocd·argo-rollouts·external-secrets·keda·aws-load-balancer-controller·victoria-metrics-k8s-stack(+metrics-server·kube-state-metrics·node-exporter)·descheduler·fluentbit — [Fargate + karpenter 토폴로지]({{< relref "../03-fargate-karpenter-topology.md" >}})·[EKS managed addon]({{< relref "../05-managed-addons.md" >}})이 다루는 EKS 자체 관리형 애드온(vpc-cni·kube-proxy·coredns·ebs-csi)은 이 섹션 밖이다.

{{< callout type="info" >}}
**한눈에**
- 전부 **blue-green 신규 클러스터라 목표 버전 직행 설치**다 — 기존 클러스터 in-place처럼 마이너를 한 단계씩 밟는 conversion 체인이 필요 없다 `✓`
- umbrella 서브차트로 배포되는 컴포넌트(external-secrets·aws-load-balancer-controller·argo-rollouts)는 **독립 bump가 불가능** — `yo-charts` 쪽 umbrella `Chart.yaml`의 dependency 핀을 리워크하고 ECR에 재퍼블리시해야 targetRevision 변경이 의미를 가진다 `✓`
- 이번 이관의 최대 CRD 경계는 두 곳 — **karpenter `v1beta1→v1`**(NodePool/EC2NodeClass), **external-secrets `v1beta1→v1`**(ExternalSecret/SecretStore, 매니페스트 전량 재작성) `✓`
- **ECR 미러 태그를 사전에 확보하지 않으면 배포 즉시 ImagePullBackOff**다 — 다수 컴포넌트가 이미지 태그를 명시 핀하지 않고 차트 기본값을 그대로 상속하므로, 차트 버전만 올려도 이미지가 자동으로 몇 년치 점프한다(victoria-metrics-k8s-stack·fluentbit가 대표적) `✓`
{{< /callout >}}

이 섹션의 소스는 3기(2026-07) 조사 당시 개별 컴포넌트별로 작성된 업그레이드 노트 10종이다. 대부분 **k8s 1.33을 목표로 조사**됐으나 상위 결정이 **1.35로 상향**됐으므로, 이 섹션의 모든 페이지는 1.35 기준으로 버전을 통일해 서술한다. 원 조사가 1.33 기준이었던 항목(특히 external-secrets·descheduler)은 "이전 조사(1.33 기준)"로 명기하고 1.35 값을 별도로 확정한다. 조사 시점은 2026-07이다.

## 색인

| 컴포넌트 | 현재 → 목표 | 리스크 핵심 | 페이지 |
|---|---|---|---|
| karpenter | 0.36.2 → **1.14.0** | 이미 v1beta1(Provisioner 아님)에서 출발 → v1beta1→v1 CRD 마이그레이션, `amiSelectorTerms` 필수화, drift GA로 강제 ON | {{< relref "01-karpenter.md" >}} |
| istio | (라이브 미확인) → **1.30.3** | sidecar 유지·ambient 전환 금지, 선행 필수로 라이브 버전부터 확정, native sidecar(1.27+), base/istiod 차트 통합(1.29) | {{< relref "02-istio.md" >}} |
| argocd (spoke) | 7.5.2(v2.12) → **10.1.4(v3.4.5)** | logs RBAC 강제 기본화, 리소스 추적 label→annotation, 3.3의 Server-Side Apply 필수, `networkPolicy` 기본 true, 허브 버전 미확인 | {{< relref "03-gitops-argocd-rollouts.md" >}} |
| argo-rollouts | 2.37.2(v1.7.1) → **2.41.1(v1.9.1)** | CVE-2026-35469(HIGH DoS) 수정, istio canary weight/서브셋 전환 순서 변화, cluster-bootstrap-v2 umbrella 커플링 | {{< relref "03-gitops-argocd-rollouts.md" >}} |
| external-secrets | 0.9.20 → **2.8.x**(이전 조사 0.19.2) | CRD `v1beta1→v1` 전량 재작성, umbrella `Chart.yaml` 리워크, blue-green fresh 설치로 스토리지 마이그레이션 우회 | {{< relref "04-secrets-autoscaling.md" >}} |
| keda | 2.10.2 → **2.20.1** | CRD apiVersion 불변, admission webhook 검증 강화로 기존 ScaledObject dry-run 선행 필요 | {{< relref "04-secrets-autoscaling.md" >}} |
| aws-load-balancer-controller | chart 1.8.1(v2.8.x) → **chart 3.4.2(v3.4.2)** | v3.0.0의 chartVersion=appVersion 정렬, IAM 정책 8액션 추가, CRD storage 버전 불변, umbrella 리워크 | {{< relref "05-networking-ingress.md" >}} |
| victoria-metrics-k8s-stack | 0.19.4 → **0.87.0** | CRD 관리 스키마 개편(`crds` 서브차트 제거), 0.85.0의 대시보드/룰 sync-job 전환(egress 리스크), 이미지 태그 미핀 → v1.148.0 자동 점프, prod 오설정(externalLabels·root_url) 동반 정정 | {{< relref "06-observability.md" >}} |
| metrics-server | v0.7.2 → **v0.9.0** | raw manifest 배포라 ArgoCD 앱 스캔·Helm 인벤토리 어디에도 안 잡힘(누락 아님) | {{< relref "06-observability.md" >}} |
| fluentbit(aws-for-fluent-bit) | chart 0.1.34 → **chart 0.2.0** | 이미지 태그 미핀 → 차트 버전 하나 올리는 것이 곧 FB 1.9.10→4.2.2·AL2→AL2023 major 점프 | {{< relref "06-observability.md" >}} |
| descheduler | 0.28.0 → **0.35.x**(이전 조사 0.33.x) | values `strategies` 블록이 v1alpha1 잔재로 현재 무시되고 있을 가능성 — 보존(옵션 A) vs 원의도 복원(옵션 B) 팀 결정 필요 | {{< relref "06-observability.md" >}} |

카드마다 원 조사 노트의 5절 구조(버전 diff·경로상 breaking·finance 적용 절차·리스크 체크리스트·근거)를 승계하되, 페이지 안에서 자연스러운 서술로 재구성했다. 공식 문서 URL·CVE 번호·공개 GitHub 이슈 번호는 검증 가능하도록 그대로 보존했고, 계정 ID·내부 endpoint·VPC/subnet ID·사람 이름·Slack/Jira/Confluence 링크는 마스킹하거나 제거했다.

## 우리 케이스에서는

10종 중 8종이 **umbrella 서브차트 아니면 태그 미핀**이라는 두 가지 함정 중 하나에 걸린다. external-secrets·aws-load-balancer-controller·argo-rollouts는 `cluster-bootstrap-v2` umbrella의 서브차트라 ArgoCD `targetRevision` 하나만 올려서는 아무 일도 안 일어나고, `yo-charts` 쪽 `Chart.yaml` dependency를 고쳐 새 차트를 퍼블리시해야 한다. victoria-metrics-k8s-stack·fluentbit·keda·karpenter는 컴포넌트 이미지 태그를 명시 핀하지 않아 **차트 버전을 올리는 순간 이미지가 차트 기본값(=대개 최신)으로 자동 점프**한다 — 편리하지만 사전에 ECR 미러가 그 태그를 갖고 있지 않으면 즉시 ImagePullBackOff다. 두 함정 다 blue-green 신규 클러스터라서 드러나는 게 아니라 원래도 있던 구조인데, 신규 설치 시점에 한꺼번에 터진다는 점이 이 섹션 전체를 관통하는 리스크다. 배포 순서는 [Fargate + karpenter 토폴로지]({{< relref "../03-fargate-karpenter-topology.md" >}})의 부트스트랩 순서를 따르고, ECR 미러 인벤토리는 [애드온 인벤토리·드리프트]({{< relref "../06-addon-inventory-drift.md" >}})와 함께 확인한다. 시점 기준 2026-07.
