---
title: "애드온 인벤토리와 ArgoCD 토폴로지 — 드리프트·신규 클러스터 체크리스트"
weight: 6
---

# 애드온 인벤토리와 ArgoCD 토폴로지 — 드리프트·신규 클러스터 체크리스트

{{< callout type="info" >}}
**한눈에**
- **metrics-server는 cluster-bootstrap 차트 안의 raw manifest, kube-state-metrics는 VM 스택의 서브차트**다 — 어떤 ArgoCD Application 스캔에도 독립 앱으로 안 잡힌다. "누락"으로 오독하기 쉬운 지점이다 `✓`.
- **ArgoCD 토폴로지는 3-tier**다 — 허브가 워크로드 엔드포인트를 **하드코딩해 push**하는 tier-1과, 워크로드 자체 ArgoCD가 `kubernetes.default.svc`로 도는 tier-3이 완전히 다른 재지정 부담을 진다 `✓`.
- **워킹트리 차트 ≠ 실배포 핀**이다 — 레포를 그대로 읽으면 최신 차트가 보이지만 실제 배포는 ECR에 핀된 옛 버전이다. diff는 실배포 핀 기준으로만 유효하다 `✓`.
- 워크로드 API endpoint가 **8개 매니페스트, 총 19곳**에 하드코딩돼 있어, 신규 클러스터를 세울 때마다 전량 교체 + ArgoCD cluster secret 재발급이 필요하다 `✓`.
{{< /callout >}}

[Terraform 클러스터 생성과 설정]({{< relref "04-terraform-cluster-settings.md" >}})과 [managed addon 4종]({{< relref "05-managed-addons.md" >}})이 클러스터 자체와 EKS-managed addon을 다뤘다면, 이 페이지는 **그 위에 올라가는 애드온 전체를 전수 조사한 결과**다. 소스는 애드온 인벤토리 조사(2026-07)이며, 조사 당시엔 "기존 green 클러스터 in-place"가 임시 채택안이었으나 [이관 전략]({{< relref "02-strategy-target-version.md" >}})에서 최종적으로 blue-green Terraform 신규 생성으로 확정됐다. 아래 인벤토리·토폴로지·드리프트 분석 자체는 방식과 무관하게 유효한 사실이므로, 신규 blue 클러스터 부트스트랩 체크리스트로 그대로 재사용한다.

## 1. 애드온 전수 분류

| 분류 | 개수 | 구성 |
|---|---|---|
| **EKS-managed addon(실설치)** | 5 | kube-proxy · coredns · vpc-cni · aws-ebs-csi-driver · amazon-cloudwatch-observability |
| EKS-managed 판정(미설치·부재) | 5 | aws-efs-csi-driver(finance 아님) · pod-identity-agent · snapshot-controller · external-dns · cert-manager(워크로드) |
| **직접설치 addon — 워크로드(stage+prod)** | 16+ | cluster-bootstrap-v2 번들 · karpenter · keda · node-local-dns · argocd(spoke) · argocd-external-secrets · istio-operator · datadog · descheduler · victoria-metrics-k8s-stack · vm-scrape · vm-extras · yotrics · app-project · virtual-service · fluentbit · service-app |
| **직접설치 addon — ring0-blue(in-cluster)** | 11 | clusterapi · cluster-bootstrap(v1) · argocd-external-secrets · actions-runner-controller · actions-runner · karpenter · keycloak · istio(git) · virtual-service · common-config · root-app |
| **관측성(observability) 구성** | 8 | metrics-server · kube-state-metrics · prometheus-node-exporter · victoria-metrics-k8s-stack(grafana 포함) · vm-scrape/extras · datadog · fluentbit · grafana |

EKS-managed 5종은 [managed addon 4종]({{< relref "05-managed-addons.md" >}})에서 이미 다룬 4종에 amazon-cloudwatch-observability가 더해진 구성이다. cloudwatch observability는 콘솔에서 수동 설치된 이력이 있어 CAPI 스펙 밖에 있었고(이게 CAPA가 죽게 된 사건의 추정 근원이다 — CAPA가 되살아나면 스펙에 없는 이 addon을 삭제하려 들어 충돌이 생긴다), 신규 클러스터에서는 이 사실 자체를 재현하지 말고 처음부터 스펙에 명시적으로 등재해야 한다.

## 2. metrics-server=raw manifest·KSM=VM 서브차트 — 오독 주의

관측성 구성 8종 중 두 개는 "ArgoCD Application을 스캔했는데 안 보인다"는 이유로 누락으로 오판하기 쉽다.

- **metrics-server**(`v0.7.2` 계열, [managed addon 페이지]({{< relref "05-managed-addons.md" >}})의 목표 이미지는 별도)는 cluster-bootstrap(v1/v2) 차트 안에 **raw manifest**(Deployment+RBAC+Service+`v1beta1.metrics.k8s.io` APIService)로 박혀 있다. 서브차트도 EKS addon도 독립 ArgoCD 앱도 아니다. arm64-only nodeAffinity로 무조건 렌더되며, `kubectl top`과 HPA의 필수 컴포넌트다. ⚠️ 이미지가 devops ECR 계정(`176…676`)에서 pull되는데 차트 자체는 finance ECR 계정(`099…718`)에서 오므로, **신규 클러스터에서 cross-account ECR pull 권한이 유지되는지**를 확인해야 한다.
- **kube-state-metrics**(`v2.12.0`)는 victoria-metrics-k8s-stack의 **서브차트**로, 워크로드 양쪽에 이미 활성화돼 있다. ⚠️ datadog에도 자체 `kubeStateMetricsCore`가 켜져 있어 **KSM이 두 곳에서 동시에 구동**된다 — 스크레이프·비용 중복이며, 신규 클러스터에서도 둘 다 자동으로 따라온다.

두 항목 모두 "누락이 아니라 다른 경로로 설치돼 있을 뿐"이라는 점이 핵심이다. 신규 클러스터 체크리스트에서 이 둘을 별도 ArgoCD 앱으로 찾으려 하면 항상 실패한다.

## 3. ArgoCD 3-tier 토폴로지

ArgoCD 배선은 세 겹이다. **tier-1**은 ring0-blue 허브의 app-of-apps가 워크로드 엔드포인트를 **하드코딩**해 push하는 앱들(cluster-bootstrap·karpenter·keda·node-local-dns·argocd·argocd-external-secrets·istio-operator)이고, **tier-2**는 워크로드에 root 앱을 생성하는 중간 계층, **tier-3**는 워크로드 자체 ArgoCD가 `kubernetes.default.svc`로 reconcile하는 앱들(datadog·VM 스택·descheduler·fluentbit·yotrics·app-project·virtual-service·service-app)이다.

| 앱 | destination | tier | 신규 클러스터 재지정 부담 |
|---|---|---|---|
| cluster-bootstrap(v1/v2), karpenter, keda, node-local-dns, argocd(spoke), argocd-external-secrets, istio-operator | 하드코딩 endpoint | **tier-1** | 파일 수정 + cluster secret 재발급 |
| datadog, descheduler, victoria-metrics-k8s-stack, vm-scrape/extras, fluentbit, yotrics, app-project, virtual-service, service-app | `kubernetes.default.svc` | **tier-3** | **재지정 불필요** — 신규 워크로드 ArgoCD가 자동 승계(단 spoke argocd 등록이 선행돼야 함) |

이 구분이 신규 클러스터 부트스트랩 순서를 결정한다 — tier-1 앱을 신규 endpoint로 먼저 밀어넣고 spoke ArgoCD(argocd+argocd-external-secrets)가 조인해야, tier-3 앱들이 "자동으로 따라오는" 단계에 들어갈 수 있다.

## 4. 워킹트리 차트 ≠ 실배포 핀

차트 레포의 워킹트리를 그대로 읽으면 "최신 차트"가 보이지만, finance는 ECR에 핀된 옛 버전을 배포 중이다. 서브차트 버전은 워킹트리 기준으로만 확인 가능해 실배포와의 diff가 성립하지 않는 경우가 있다.

| 항목 | 워킹트리(desired) | 실배포(live) |
|---|---|---|
| cluster-bootstrap-v2 | 2.0.11 | **2.0.8** |
| cluster-bootstrap v1(ring0) | 3.0.3(major 격차) | **1.4.75** |
| karpenter 차트 | 2.0.21 | 워크로드 2.0.18 / ring0 2.0.19 |
| karpenter 컨트롤러 | — | **0.36.2**(차트 버전과 별개) |
| node-local-dns | 차트 tip 3.0.1 | stage 3.0.1 / **prod 2.0.6**(분기) |
| keda | v1 번들 2.16.0 | 워크로드 독립 앱 **2.10.2** |

cluster-bootstrap-v2/v1의 서브차트(aws-load-balancer-controller·external-secrets·argo-rollouts)는 워킹트리 Chart.yaml 기준으로만 버전을 알 수 있고, 실배포가 2.0.8/1.4.75로 핀돼 있어 정확한 서브차트 버전은 diff가 불가능하다 — **실제 서브차트 버전을 확인하려면 핀 버전의 차트를 pull하거나 `helm list -A`로 라이브를 직접 봐야 한다.** 이 격차는 신규 클러스터에서 목표 버전으로 직행 설치하면 자연히 해소되지만, 마이그레이션 대상 범위를 가늠할 때는 워킹트리가 아니라 이 표의 "실배포" 열을 기준으로 삼아야 한다.

## 5. 드리프트/오설정 표

버전 격차 외에, 클러스터 이름·도메인·라벨이 실제와 어긋난 사례들이다. 신규 blue 클러스터로 이관하면 자연히 해소되는 것과, 별도로 고쳐야 하는 것이 섞여 있다.

| 항목 | 현재 상태 | 신규 blue에서 |
|---|---|---|
| `clusterName` 태그(datadog·alb) | 실제로는 green 클러스터인데 `*-finance-blue`로 태깅(stale) | **오히려 정합** — blue로 이관하면 값이 맞아떨어진다 |
| istio 게이트웨이 endpoint | GREEN 지향(내부 불일치) | 이관 시 재정렬 필요 |
| grafana `root_url`(prod) | staging 도메인을 가리킴(copy-paste 오류) | 신규 세팅 전 정정 필수 |
| `externalLabels.cluster`(prod VM 스택) | `ring0`(prod 값인데 다른 클러스터명) | 정정 필요 — 초기 조사에서 stage 쪽으로 잘못 짚었다가 이후 prod로 정정된 이력이 있다 |
| alertmanager | stage 켜짐 / prod 꺼짐(copy-paste 추정) | 의도 확인 후 정정 |
| CAPI 스펙 vs 라이브 CP 버전 | 스펙 v1.30.0(READY=true 표시) vs 라이브는 실제로 더 앞서 있음 | 신규 클러스터는 Terraform이 SSOT라 이 종류의 스펙-라이브 괴리 자체가 구조적으로 사라짐 |
| managed nodegroup 이름 | 스펙상 이름과 라이브 노드그룹 이름이 다름(AL2023 전환 이력) | Fargate-only 방향이므로 관리형 노드그룹 자체가 없어져 해당 없음 |

## 6. 신규 클러스터 체크리스트

**부트스트랩 의존 순서**

1. **(선행) Terraform** — VPC/IAM/IRSA/OIDC provider, Fargate 프로필+pod-execution role([Terraform 페이지]({{< relref "04-terraform-cluster-settings.md" >}}) §1의 selector 2종). Fargate 프로필은 karpenter/coredns Fargate의 hard precondition이다.
2. **EKS managed addon 5종 선행 시딩** — vpc-cni/kube-proxy/aws-ebs-csi-driver/coredns를 목표 버전으로([managed addon 페이지]({{< relref "05-managed-addons.md" >}})), **+ amazon-cloudwatch-observability**를 5번째로 반드시 포함(누락 시 관측 공백).
3. **cluster-bootstrap-v2**(aws-load-balancer-controller → external-secrets → argo-rollouts → metrics-server raw manifest) — 이후 모든 IRSA/Ingress/Secret 동작의 토대. v2는 keda를 포함하지 않으므로 **keda는 독립 앱으로 별도 설치**한다.
4. **argocd(spoke) + argocd-external-secrets** — 워크로드 자체 ArgoCD가 tier-3를 reconcile하려면 필수. 정적 SA bearerToken/cluster 등록 secret을 신규 발급한다.
5. **karpenter(+ NodeClass AMI 핀 갱신)** — AMI 핀을 목표 마이너로 갱신하지 않으면 신규 노드가 구버전 kubelet으로 생성된다. Fargate 프로필 이후에 설치한다.
6. **node-local-dns → istio → 관측성(VM 스택/datadog/fluentbit) → descheduler/keda → service-app**.

**하드코딩 endpoint 재지정(8개 매니페스트, 19곳)**

| 파일 | occurrence |
|---|---|
| karpenter.yaml | 5(clusterEndpoint 포함) |
| app-root.yaml | 2 |
| cluster-bootstrap.yaml | 2 |
| keda.yaml | 2 |
| argocd.yaml | 2 |
| argocd-external-secrets.yaml | 2 |
| istio.yaml | 2 |
| node-local-dns.yaml | 2 |

값은 stage `6C16…yl4`, prod `BC8F…gr7` 형태의 클러스터 API endpoint 문자열이다. 신규 클러스터마다 (a) 위 8파일의 endpoint를 전량 교체하고 (b) 새 server URL 키로 ArgoCD cluster 등록 secret을 신규 생성해야 한다. tier-3 앱은 §3에서 다룬 대로 재지정이 불필요하다 — 단 (a)(b)가 끝나 spoke argocd가 조인한 뒤라야 tier-3가 자동 승계된다.

**karpenter 버전 결정**

karpenter는 컨트롤러 0.36.2로 오래 운영돼 왔고, 조직 내 다른 클러스터는 이미 nodePool/nodeClass 스키마를 쓰는 최신 라인으로 넘어간 사례가 있어 두 방향이 상충해왔다. [이관 전략]({{< relref "02-strategy-target-version.md" >}})에서 최종적으로 **1.14.0으로 이관**하는 쪽으로 확정됐고, 0.36.2 유지는 이관이 막힐 경우의 롤백 여지로만 남는다. v1beta1→v1 CRD 마이그레이션과 Fargate 컨트롤러 재작성 상세는 [컴포넌트별 마이그레이션]({{< relref "components/_index.md" >}})이 잇는다.

## 7. 미설치 판정

신규 클러스터에 "넣을지 말지" 판단이 필요한 후보들이다. 실제로 설치할 필요가 없는 것과, 존재 자체가 확인되지 않아 신규 인프라 조사에서 재확인이 필요한 것을 구분한다.

| addon | 판정 | 근거 |
|---|---|---|
| **aws-efs-csi-driver** | ❌ finance 미설치 | 관련 role-arn이 다른 팀 계정을 가리켜 finance 클러스터용이 아니다. finance 레포 전체에서 참조가 없다 |
| **pod-identity-agent** | ❌ 부재(의도적) | finance는 전부 IRSA 경로(`associateOIDCProvider` + 다수 role-arn). Fargate가 Pod Identity를 지원하지 않는다는 구조적 이유도 겹친다([토폴로지 페이지]({{< relref "03-fargate-karpenter-topology.md" >}})) |
| **snapshot-controller** | ⚠️ 부재(실 gap 가능성) | EKS의 aws-ebs-csi-driver managed addon은 external snapshot-controller를 번들하지 않는다. `VolumeSnapshot`을 쓰는 워크로드가 있다면 깨진다 — 저위험이지만 라이브 확인 권장 |
| **external-dns** | ❌ 부재(추정 정상) | finance 레포에 참조가 없다. Route53 + istio external 라우팅으로 DNS를 관리하는 것으로 추정된다 |
| **cert-manager**(워크로드) | ❌ 부재(추정 정상) | ring0의 CI 러너 번들에만 존재. 워크로드 TLS는 ALB 오프로드 + istiod self-sign 조합이다 |

metrics-server는 managed addon으로 추가 설치하지 않는다 — cluster-bootstrap의 raw manifest와 충돌한다.

## 우리 케이스에서는

이 인벤토리에서 가장 실무적으로 중요한 문장은 "누락이 아니라 다른 경로로 설치돼 있을 뿐"이다. metrics-server·kube-state-metrics를 ArgoCD Application 스캔만으로 확인하면 항상 빠진 것처럼 보이고, 실제로는 각각 raw manifest와 서브차트로 다른 곳에 숨어 있다. 신규 클러스터 체크리스트를 짤 때 이 둘을 별도 배포 대상으로 다시 만들면 중복 설치가 되므로, **먼저 cluster-bootstrap과 VM 스택이 이 둘을 이미 포함하고 있다는 것을 확인하는 절차**가 앞서야 한다.

두 번째로 중요한 것은 tier-1/tier-3 구분이다. 신규 클러스터 부트스트랩에서 실제로 손이 가는 것은 **tier-1의 8개 파일 19곳**뿐이고, tier-3의 절반 이상은 spoke ArgoCD 조인만 끝나면 자동으로 따라온다. 작업량을 가늠할 때 "애드온이 몇 개나 되나"가 아니라 "하드코딩 endpoint가 몇 곳인가"로 물어야 정확한 그림이 나온다. 워킹트리 차트와 실배포 핀의 괴리, `clusterName` 등의 blue/green 태그 드리프트는 신규 blue 클러스터로 이관하는 순간 대부분 자연 해소되거나 처음부터 다시 쓰는 문제이므로, 굳이 기존 값을 그대로 옮기려 하지 말고 [managed addon 페이지]({{< relref "05-managed-addons.md" >}})·[Terraform 페이지]({{< relref "04-terraform-cluster-settings.md" >}})에서 확정한 목표값으로 직행하는 편이 낫다.
