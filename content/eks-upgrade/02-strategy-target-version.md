---
title: "이관 전략과 목표 버전 — blue-green 결정과 EKS 1.35 판정"
weight: 2
---

# 이관 전략과 목표 버전 — blue-green 결정과 EKS 1.35 판정

{{< callout type="info" >}}
**한눈에**
- 이전 사내 업그레이드는 전부 **콘솔 in-place로 1.33까지** — addon 선행·Fargate·karpenter 수동 drain이 검증된 패턴 `✓`
- 이번엔 **blue-green 신규 생성**으로 전환한다(CAPA 死 · 노드가 이미 콘솔에서 AL2023으로 드리프트 · 전 컴포넌트가 어차피 대점프) `✓`
- **1.35 = 전 컴포넌트 세트가 공식 지원하는 최고 버전.** 1.36은 KEDA·kube-state-metrics·external-secrets·Argo CD 4종이 지원 릴리스를 아직 안 내서 막힌다 `✓`
- **1.33은 폐기** — 표준지원 종료가 2026-07-29로 코앞이라 신규 클러스터를 올리는 순간 EOL 코너에 몰린다. 1.35는 이전 계획의 최대 정책 리스크였던 ESO EOL 딜레마까지 해소한다 `✓`
{{< /callout >}}

이 페이지는 finance 워크로드 클러스터(prod/staging) 업그레이드가 **어떤 방식으로, 어떤 버전을 향해** 가는지를 다룬다. CAPA가 왜 죽었고 그것이 방식 결정에 어떻게 영향을 줬는지는 [아키텍처와 CAPI 진단]({{< relref "01-architecture-capi.md" >}})이, 목표 버전을 실제로 어떤 인프라·토폴로지로 구현하는지는 [Fargate + karpenter 토폴로지]({{< relref "03-fargate-karpenter-topology.md" >}})·[Terraform 생성 & 클러스터 설정]({{< relref "04-terraform-cluster-settings.md" >}})이 이어받는다.

## 1. 이관 방식 변천 — in-place 런북에서 blue-green 결정까지

이 프로젝트의 이관 방식은 한 번에 정해지지 않았다. 사내에 이미 쌓여 있던 **in-place 방법론과 4건의 실행 사례**를 먼저 참고해 in-place로 계획했다가, 진단 과정에서 드러난 사실들 때문에 **blue-green 신규 생성**으로 방향을 틀었다.

### 1.1 출발점 — in-place 방법론

사내 In-Place 업그레이드 방법론은 순서가 명확하다.

1. **업그레이드 인사이트 검토** — 다음 마이너에서 제거 예정인 deprecated API 사용 여부를 먼저 확인한다.
2. **Add-on 버전 업그레이드 선행** — 클러스터 버전을 올리기 전에 addon을 먼저 올린다. patch만 오르는 경우는 생략 가능하지만 **마이너가 오르면 필수**다. 실패하면 대개 addon의 "선택적 구성 설정" 누락이 원인이라 구성을 재정의 후 재시도한다.
3. **노드 그룹 업그레이드** — 노드 그룹과 클러스터 버전은 마이너 기준 2버전 이상 벌어지면 안 된다. 관리형 노드그룹은 `지금 업데이트`를 누르면 자동으로 cordon되며 순차 교체되지만, **karpenter가 만든 노드는 cordon이 걸리지 않는다** — 직접 cordon 후 drain해야 한다.
4. **클러스터 업그레이드** — 노드가 전부 올라간 뒤에만 수행한다.

AL2 → AL2023 전환도 별도 방법론으로 정리돼 있다. 핵심은 **기존 AL2의 `bootstrap.sh` 방식과 신규 AL2023의 `nodeadm`(NodeConfig) 방식이 달라 같은 Launch Template을 재사용할 수 없다**는 것이다. 새 AMI + NodeConfig User Data로 새 Launch Template을 만들고, 새 Nodegroup을 생성한 뒤 기존 노드를 drain하는 순서로 진행한다.

```yaml
apiVersion: node.eks.aws/v1alpha1
kind: NodeConfig
spec:
  cluster:
    name: <cluster-name>
    apiServerEndpoint: <cluster-api-endpoint>
    certificateAuthority: <cluster-ca>
    cidr: 172.20.0.0/16
```

이 방법론 위에서 최초 계획은 **CAPI GitOps로 1.30→1.33을 in-place로 올리는 것**이었다. finance 워크로드는 `clusterapi.yaml`의 `k8sVersion`을 bump하고 ArgoCD sync로 CAPA(Cluster API Provider AWS)가 컨트롤 플레인을 순차 업그레이드하게 하는 그림이었다.

### 1.2 궤도 수정 — 콘솔 in-place로

그러나 실측 진단에서 **CAPA가 이미 죽어 있음**이 드러났다. stage/prod 계정에서 CAPA가 assume해야 할 크로스계정 롤이 2025-10-21부터 삭제된 상태였고, 이 때문에 reconcile이 전면 실패(`VpcReconciliationFailed`) 중이었다. 노드그룹도 이미 콘솔에서 수동으로 AL2023으로 교체돼 있어 CAPI 스펙과 드리프트가 난 상태였다. 진단 결과, 계획은 **"콘솔 in-place로 진행 + `clusterapi.yaml`은 사후 실상태 정합"**으로 선회했다. 이 CAPA 단절의 원인·증거 체인은 [아키텍처와 CAPI 진단]({{< relref "01-architecture-capi.md" >}})에서 다룬다.

이 시점에 함께 확정된 것이 **Fargate 방향**이다. system-primary 노드그룹을 재생성하는 대신 CoreDNS·karpenter를 Fargate 프로필로 옮기기로 했다 — 팀 논의에서 노드그룹(EC2) 교체 방식을 다시 밟고 싶지 않다는 공감대가 있었고, Fargate 기반 클러스터가 실제로 업그레이드 절차를 크게 단순화한다는 사내 실증(§2)이 있었기 때문이다. 다만 이 시점의 결론은 여전히 **1.30→1.33을 마이너 하나씩 순차로(1.31→1.32→1.33) 사이클 도는** in-place 그림이었다.

### 1.3 최종 결정 — blue-green + Terraform + 1.35

가장 최근(현재 채택안)에 방향이 다시 한번 크게 바뀌었다. **in-place를 버리고 신규 blue 클러스터를 Terraform으로 생성하는 blue-green 이관**으로 전환했다. 세 가지가 동시에 결정됐다.

1. 목표 버전을 **1.33에서 1.35로 상향**(§3).
2. **managed nodegroup 없이 Fargate(CoreDNS+karpenter)만 두고 나머지는 karpenter system nodepool**이 프로비저닝하는 토폴로지(상세는 [Fargate + karpenter 토폴로지]({{< relref "03-fargate-karpenter-topology.md" >}})).
3. **CAPA 대신 Terraform으로 클러스터를 생성**(상세는 [Terraform 생성 & 클러스터 설정]({{< relref "04-terraform-cluster-settings.md" >}})).

이 전환의 방법론적 근거는 사내 Blue/Green 방법론이다. 요지는 신규 버전 클러스터(예: `stage-blue`)를 **Terraform으로 통째로 생성**한 뒤 트래픽을 옮기는 것이며, 트래픽 전환은 Route53 가중치가 아니라 **ALB target group 가중치**로 한다. 클러스터 하나에는 system-primary 노드그룹(CoreDNS·karpenter)·EKS managed addon 5종(kube-proxy/CoreDNS/VPC CNI/EBS CSI/EFS CSI)·OIDC provider·공용 Role·보안그룹·karpenter spot 중단용 SQS가 Terraform 리소스로 묶인다. Helm Chart 배포 순서는 **karpenter → cluster-bootstrap(ALB controller·external-secrets·argo-rollouts·keda) → network(istio+kiali+node-local-dns) → monitoring(datadog·fluentbit·victoria-metrics) → management(airflow-operator·eks-rbac·descheduler) → 서비스(API→consumer→batch)**다. 서비스 이벤트로 warm-up 시 파드가 급증해 DB 커넥션 한도에 도달할 위험이 있어 **이벤트 없는 시간대에 수행**하는 것이 원문에서부터 강조된다.

blue-green을 최종 채택한 이유는 세 가지가 겹친다. **CAPA가 죽어 있어** GitOps 경로로 순차 마이너 업그레이드를 태울 신뢰 기반 자체가 없고, **노드는 이미 콘솔 조작으로 AL2023까지 드리프트**돼 있어 레포와 실 상태가 어긋난 상태이며, **전 컴포넌트 세트가 관측 스택까지 포함해 대규모 버전 점프**를 해야 하는 상황이라 마이너 3단계를 순차로 밟는 것보다 목표 상태를 한 번에 새로 짓는 편이 정합성 관리가 쉽다. 특히 CAPA의 죽은 상태는 blue-green 전환 중 **green을 실수로 건드리지 않게 막아 주는 안전판**으로 재해석됐다 — CAPA가 살아 있었다면 green의 `clusterapi.yaml`을 잘못 건드릴 때 reconcile이 실제로 반응해 버렸을 것이다.

## 2. 이전 사내 업그레이드에서 얻은 교훈

방식은 바뀌었지만 실행 세부 패턴은 여전히 유효하다. 4건의 실제 업그레이드 사례에서 재사용 가능한 교훈만 압축한다.

| 교훈 | 근거 | 이번 이관 적용 |
|---|---|---|
| **addon conflict resolution 검증값** | Fargate 클러스터(EC2 노드 없음) 업그레이드 사례에서 실측: VPC CNI = `Overwrite`, kube-proxy = `Preserve`, CoreDNS = `Overwrite`. `None`으로 두면 실패한다 | 신규 blue의 EKS managed addon 4종 생성 시 동일 conflict resolution 값을 적용 |
| **kube-proxy addon 업그레이드 실패 이력** | staging 리허설 클러스터에서 kube-proxy addon 업그레이드 단계가 실제로 실패했고, prod 실행에서는 이를 미리 알고 override 재설치로 대응 | finance도 kube-proxy addon 실패 가능성을 사전에 인지하고 conflict resolution override를 준비해 둔다 |
| **Fargate 클러스터의 절차 단순성** | 동일 시점에 EC2 노드 클러스터와 Fargate 클러스터를 나란히 업그레이드한 사례 비교: EC2 클러스터는 Launch Template 재정의(NodeConfig)·AMI 교체·cordon/drain이 전부 필요했지만, Fargate 클러스터는 **AL2023 노드 교체 자체가 불요**했고 addon 업그레이드 후 ALB controller·CoreDNS·metrics-server 세 개만 `rollout restart`하면 끝났다 | finance가 Fargate 방향을 선호하는 실증 근거. 신규 blue는 애초에 managed nodegroup을 두지 않는다 |
| **karpenter 노드는 수동 cordon/drain** | in-place 방법론 원문 + 관리 클러스터 업그레이드 사례: 관리형 노드그룹은 업그레이드 시 자동 cordon되지만 **karpenter가 만든 노드는 걸리지 않는다** | blue-green이라도 향후 마이너 업그레이드 시 karpenter 노드는 여전히 직접 cordon → drain해야 하는 원칙은 그대로 유효 |

관리 클러스터(ring0) 업그레이드 사례가 남긴 버전 매트릭스(kube-proxy/CoreDNS/VPC CNI의 k8s 마이너별 버전)도 이후 §3의 목표 버전 산정과 addon 부트스트랩 절차([EKS managed addon]({{< relref "05-managed-addons.md" >}}))의 원출처였다. 다만 그 매트릭스는 1.33까지만 다루므로, 1.35 채택 후에는 값을 그대로 옮기지 않고 §3~4에서 다시 확정한다.

## 3. 목표 1.35 판정

### 3.1 EKS 지원 종료 캘린더 (조사 시점 2026-07-21 기준)

| k8s | EKS 릴리스 | 표준지원 종료 | 확장지원 종료 | 상태(조사 시점) |
|---|---|---|---|---|
| **1.36** | 2026-06-02 | 2027-08-02 | 2028-08-02 | 표준지원(최신 GA) |
| **1.35** | 2026-01-27 | **2027-03-27** | 2028-03-27 | 표준지원 |
| **1.34** | 2025-10-02 | 2026-12-02 | 2027-12-02 | 표준지원 |
| **1.33** | 2025-05-29 | **2026-07-29** | 2027-07-29 | 표준지원(임박) |
| 1.32 | 2025-01-23 | 2026-03-23(경과) | 2027-03-23 | 확장지원 |
| 1.31 | 2024-09-26 | 2025-11-26(경과) | 2026-11-26 | 확장지원 |
| **1.30**(현행 green) | 2024-05-23 | 2025-07-23(경과) | **2026-07-23** | 확장지원(임박) |

1.36은 이미 GA된 최신 버전이라 "1.35가 최고"가 아니라 "1.36이 최신"이 정확한 표현이다. 다만 컨트롤플레인 자체는 1.36을 지원해도 **애드온 세트가 막는다**(§3.2).

### 3.2 컴포넌트별 k8s 상한 — 1.36을 막는 4종

목표를 1.35 또는 1.36으로 놓았을 때, 각 컴포넌트가 **공식적으로 지원한다고 명시한 최고 k8s 마이너**를 확인하면 판정이 갈린다.

| 컴포넌트 | 1.35 | 1.36 | 판정 |
|---|---|---|---|
| EKS 컨트롤플레인 / Karpenter / CoreDNS / kube-proxy / vpc-cni / ebs-csi | 지원 | 지원 | 무관 |
| Istio(sidecar) / ALB LBC / metrics-server / argo-rollouts | 지원 | 지원(또는 미확인이나 낮은 리스크) | 무관 |
| 🔴 **KEDA** | 지원(최신 2.20 = 1.33~1.35) | **지원 릴리스 없음**(2.21 미출시) | **1.36 차단** |
| 🔴 **kube-state-metrics**(VM-stack 서브) | 지원(정식 v2.19.x) | **정식 릴리스 없음**(`main` 브랜치만 존재) | **1.36 차단** |
| 🔴 **external-secrets** | 지원(최신 2.8 = 1.35) | **지원 버전 없음** | **1.36 차단** |
| 🔴 **Argo CD**(spoke) | 지원(3.4 tested = 1.32~1.35) | **3.5는 RC만** — GA 필요 | **1.36 미검증** |

핵심은 **1.35에서는 전 세트가 지원 릴리스를 갖는다**는 점이다. 1.36으로 가려면 KEDA 2.21, kube-state-metrics의 정식 1.36 릴리스, external-secrets의 1.36 지원 버전, Argo CD 3.5 GA — 이 네 가지가 나오길 기다려야 한다. 신 마이너 GA 후 서드파티 Helm 생태계가 인증을 따라잡는 데 통상 수주~수개월이 걸리는 관행을 감안하면, 1.36은 **현재로선 시기상조**다.

### 3.3 ESO EOL 딜레마 해소 — 1.35를 미는 결정적 이유

이전 계획(1.33 목표)의 가장 큰 정책 리스크는 external-secrets(ESO)였다. 1.33이 지원하는 ESO 라인(0.17~0.19)이 **전부 EOL** 상태였기 때문이다. ESO는 GA 이후 **2.x 라인**으로 전환됐고, 프로젝트 정책상 **가장 최신 마이너 1개만 non-EOL**로 유지된다. 조사 시점 기준 최신은 **2.8**이며(2.7을 밀어내고 EOL 처리한 직후 릴리스), 이 2.8이 **정확히 k8s 1.35를 지원**한다. 즉 **1.35를 택하면 최신·non-EOL인 ESO 2.8을 그대로 운영**할 수 있다 — 1.33을 고집했다면 EOL 버전을 강제로 써야 했을 상황이 1.35에서는 자연스럽게 해소된다. ESO 하나만 놓고 봐도 **1.35 > 1.34 > 1.33** 순으로 유리하다.

여기에 **표준지원 런웨이**도 1.35가 가장 길다(≈20개월, 1.34는 ≈16개월, 1.33은 사실상 즉시 확장지원 진입) — 아래 §4에서 이어 정리한다.

### 3.4 판정

**목표 = EKS 1.35.** 전 컴포넌트 세트가 공식 지원 릴리스를 갖는 최고 버전이자, ESO EOL 딜레마까지 해소하는 지점이다.

## 4. 1.34 폴백 / 1.33 폐기 근거

- **1.34는 폴백으로 남긴다.** 1.35가 부담스러우면 1.34로 내려갈 수 있지만, (a) ESO 정렬이 1.35보다 나쁘고 (b) 표준지원 종료가 4개월 더 이르며(2026-12-02) (c) 그 대가로 얻는 안정성 이득이 크지 않다. 적극 권장은 1.35이고, 1.34는 어디까지나 대안이다.
- **1.33은 폐기한다.** 이전 계획(§1.2)의 기준값이었지만 표준지원 종료가 2026-07-29로 임박해, 신규 클러스터를 1.33으로 올리는 순간 사실상 곧바로 확장지원(유료) 구간에 들어간다. AWS 릴리스 노트에도 "1.33 표준지원 종료 시점까지만 EBS CSI 관련 사이드카를 패치한다"는 식의 종료 시점 종속 문구가 있어, 신규 생성 목표로는 부적합하다. 1.33 조사 산출물 자체는 컴포넌트별 CRD·차트 리워크 방법론으로는 여전히 유효하지만, **목표 k8s 값만은 1.35로 통일**해서 읽어야 한다 — 하위 컴포넌트 문서들의 버전 diff는 [Terraform 생성 & 클러스터 설정]({{< relref "04-terraform-cluster-settings.md" >}})·[EKS managed addon]({{< relref "05-managed-addons.md" >}})과 `components/` 하위 섹션에서 1.35 값으로 정리한다.

## 5. 긴급도

이 문서 세트는 **조사 시점 2026-07-21 전후**의 스냅샷이다. 아래 두 날짜가 이 이관 계획 전체의 시간표를 결정한다.

- **green(현행 1.30) 확장지원 종료 = 2026-07-23.** 조사 시점 기준 이틀 뒤다. 이 날짜를 넘기면 AWS가 컨트롤 플레인을 **자동으로 업그레이드**한다(가장 오래된 지원 버전으로) — 이관의 시점·순서를 팀이 통제할 수 없게 된다는 뜻이라, blue-green 이관 자체가 여유 없이 시급하다.
- **1.33 표준지원 종료 = 2026-07-29.** 조사 시점 기준 8일 뒤다. §4에서 다룬 대로 이 날짜가 1.33 폐기의 직접 근거다.

문서를 읽는 시점이 이 조사 시점과 다르면 위 카운트다운은 이미 지났을 수 있다 — 판단 기준은 **날짜 자체**이지 "임박했다"는 서술이 아니다. 버전 카탈로그 값(addon eksbuild suffix 등)도 조사 시점 값이므로, 실제 작업 시에는 당일 `describe-addon-versions`로 재확인하는 것이 원칙이다.

## 우리 케이스에서는

finance 워크로드(prod/staging-finance-green)는 in-place 3사이클(1.31→1.32→1.33)로 계획됐다가, CAPA 단절·노드 드리프트·전 컴포넌트 대점프라는 세 조건이 겹치며 **신규 blue 클러스터를 Terraform으로 EKS 1.35에 생성하는 blue-green**으로 최종 전환됐다. 실행 세부(addon conflict resolution·kube-proxy 실패 대비·karpenter 수동 drain)는 이전 in-place 사례들에서 그대로 승계한다. 목표 버전은 전 컴포넌트 세트가 공식 지원하는 최고 지점이자 ESO EOL 리스크를 없애는 **1.35**로 확정했고, 1.33은 표준지원 종료가 임박해 폐기, 1.34는 폴백으로만 남긴다. 이관 자체는 green의 확장지원 종료(2026-07-23)에 묶여 있어 시급하다. 구체적으로 무엇을 어떤 토폴로지·인프라로 짓는지는 다음 페이지들이 이어받는다.
