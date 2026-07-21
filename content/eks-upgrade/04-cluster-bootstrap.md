---
title: "부트스트랩 오케스트레이션 — 순서·ArgoCD 3-tier·endpoint 재바인딩"
weight: 5
---

# 부트스트랩 오케스트레이션 — 순서·ArgoCD 3-tier·endpoint 재바인딩

{{< callout type="info" >}}
**한눈에**
- **ArgoCD 토폴로지는 3-tier**다 — 허브가 워크로드 endpoint를 **하드코딩해 push**하는 tier-1과, 워크로드 자체 ArgoCD가 `kubernetes.default.svc`로 도는 tier-3이 완전히 다른 재지정 부담을 진다.
- **metrics-server=cluster-bootstrap의 raw manifest, kube-state-metrics=VM 스택 서브차트** — 어떤 ArgoCD 앱 스캔에도 독립 앱으로 안 잡힌다. "누락"으로 오독하기 쉽다.
- 워크로드 API endpoint가 **8개 매니페스트, 총 19곳**에 하드코딩돼 있어 클러스터를 세울 때마다 전량 교체 + cluster secret 재발급이 필요하다.
- 부트스트랩은 **Fargate 닭-달걀부터 service 배포까지** 하나의 마스터 순서로 흐른다.
{{< /callout >}}

[02 클러스터 설정]({{< relref "02-cluster-config.md" >}})이 클러스터가 무엇인지, [03 managed addon]({{< relref "03-managed-addons.md" >}})이 EKS addon을 다뤘다면, 이 페이지는 그것들을 **어떤 순서로 올리고 어떻게 배선하는가**를 모은다. 여러 곳에 흩어져 있던 순서·인벤토리·endpoint 재바인딩을 여기서 단일 소유한다.

## 1. 애드온 전수 분류

| 분류 | 개수 | 구성 |
|---|---|---|
| **EKS-managed(실설치)** | 5 | kube-proxy · coredns · vpc-cni · aws-ebs-csi-driver · amazon-cloudwatch-observability |
| EKS-managed 판정(미설치·부재) | 5 | aws-efs-csi-driver · pod-identity-agent · snapshot-controller · external-dns · cert-manager(워크로드) |
| **직접설치 — 워크로드** | 16+ | cluster-bootstrap-v2 번들 · karpenter · keda · node-local-dns · argocd(spoke) · argocd-external-secrets · istio-operator · datadog · descheduler · victoria-metrics-k8s-stack · vm-scrape/extras · yotrics · app-project · virtual-service · fluentbit · service-app |
| **직접설치 — ring0-blue** | 11 | clusterapi · cluster-bootstrap(v1) · argocd-external-secrets · actions-runner(-controller) · karpenter · keycloak · istio(git) · virtual-service · common-config · root-app |
| **관측성** | 8 | metrics-server · kube-state-metrics · prometheus-node-exporter · victoria-metrics-k8s-stack(grafana) · vm-scrape/extras · datadog · fluentbit · grafana |

EKS-managed 5종은 [03 managed addon]({{< relref "03-managed-addons.md" >}})이 다룬 4종에 amazon-cloudwatch-observability를 더한 구성이다. cloudwatch observability는 콘솔 수동 설치 이력이 있어 CAPI 스펙 밖에 있었고(신규 클러스터에서는 처음부터 스펙에 명시 등재), 직접설치 애드온의 실제 버전 마이그레이션은 [컴포넌트별 마이그레이션]({{< relref "components/_index.md" >}})이 잇는다.

## 2. 오독 주의 — metrics-server·kube-state-metrics

관측성 8종 중 둘은 "ArgoCD Application을 스캔했는데 안 보인다"는 이유로 누락으로 오판하기 쉽다.

- **metrics-server**는 cluster-bootstrap(v1/v2) 차트 안에 **raw manifest**(Deployment+RBAC+Service+`v1beta1.metrics.k8s.io` APIService)로 박혀 있다. 서브차트도 EKS addon도 독립 ArgoCD 앱도 아니다. arm64-only nodeAffinity로 렌더되며 `kubectl top`·HPA의 필수 컴포넌트다. ⚠️ 이미지가 devops ECR 계정에서 pull되는데 차트는 finance ECR 계정에서 오므로 **신규 클러스터에서 cross-account ECR pull 권한이 유지되는지** 확인해야 한다(§7).
- **kube-state-metrics**는 victoria-metrics-k8s-stack의 **서브차트**로 워크로드 양쪽에 이미 활성화돼 있다. ⚠️ datadog에도 자체 `kubeStateMetricsCore`가 켜져 있어 **KSM이 두 곳에서 동시 구동**된다(스크레이프·비용 중복, 신규 클러스터에도 자동 승계).

두 항목 다 "누락이 아니라 다른 경로로 설치돼 있을 뿐"이다. 신규 클러스터 체크리스트에서 별도 ArgoCD 앱으로 찾으려 하면 항상 실패하고, 별도 배포 대상으로 다시 만들면 중복 설치가 된다.

## 3. ArgoCD 3-tier 토폴로지

전 구성은 ring0-blue 허브의 `root-app`(app-of-apps)에서 시작해 3계층으로 퍼진다. **"어디서 reconcile되는가"** 기준으로 나뉜다.

- **tier-1(허브 push)**: ring0의 ArgoCD가 워크로드 클러스터 API endpoint를 **하드코딩한 destination**으로 직접 push한다(cluster-bootstrap·karpenter·keda·node-local-dns·argocd(spoke)·argocd-external-secrets·istio-operator). 클러스터를 재생성하면 이 endpoint를 전부 갱신해야 한다(§6).
- **tier-2**: `app-root` ApplicationSet이 워크로드 안에 `root-{env}` 앱을 심어 tier-3로 넘긴다.
- **tier-3(워크로드 로컬)**: 워크로드 자체 ArgoCD가 `kubernetes.default.svc`(in-cluster)로 reconcile한다(datadog·VM 스택·descheduler·fluentbit·yotrics·app-project·virtual-service·service-app).

| 앱 | destination | tier | 신규 클러스터 재지정 부담 |
|---|---|---|---|
| cluster-bootstrap, karpenter, keda, node-local-dns, argocd(spoke), argocd-external-secrets, istio-operator | 하드코딩 endpoint | **tier-1** | 파일 수정 + cluster secret 재발급 |
| datadog, descheduler, victoria-metrics-k8s-stack, vm-scrape/extras, fluentbit, yotrics, app-project, virtual-service, service-app | `kubernetes.default.svc` | **tier-3** | **재지정 불필요** — spoke argocd 조인 후 자동 승계 |

**3레포 SSOT 배경(축약)**: 구성 코드는 3레포로 나뉜다 — `sre-finance-terraform`(AWS 리소스·클러스터 registry), `finance-yoboard-charts`(ArgoCD 매니페스트, 워크로드 endpoint가 8파일 19곳에 하드코딩), `finance-yo-charts`(Helm values, `clusterapi.yaml`의 `k8sVersion`이 과거 클러스터 버전 SSOT였다 — 이제는 Terraform이 SSOT). 클러스터 버전(CAPI Cluster 리소스)만은 워크로드가 아니라 ring0 in-cluster에 갱신되고 실제 EKS 변경은 CAPA 크로스계정 호출에 위임됐던 구조이며, 그 함정 서사는 [배경]({{< relref "00-background.md" >}})이 다룬다.

## 4. 마스터 부트스트랩 순서

managed nodegroup이 없어 "첫 EC2 노드가 어떻게 생기는가"라는 순환 의존을 먼저 풀어야 한다. 답은 **CoreDNS와 karpenter만 Fargate로 노드 없이 띄우고, 그 둘이 나머지의 착지장을 만들게 하는 것**이다. 아래는 Fargate 닭-달걀부터 service 배포까지의 단일 통합 타임라인이다.

### 4.1 Fargate 닭-달걀 풀기

| # | 단계 | 노드 필요? | 이유 / 함정 |
|---|---|---|---|
| 0 | Fargate pod-execution-role 생성 | — | `AmazonEKSFargatePodExecutionRolePolicy` 부착이 전제. 로그를 CloudWatch로 보내려면 로깅 IAM 정책도 별도 부착([02]({{< relref "02-cluster-config.md" >}}) §4) |
| 1 | Fargate profile 생성: `{ns:karpenter}` + `{ns:kube-system,k8s-app:kube-dns}`(private subnet 전용) | — | selector는 **파드 생성 시점에만** 평가 — profile이 먼저 있어야 CoreDNS/karpenter가 Fargate로 붙는다 |
| 2 | vpc-cni addon 등록 | 노드 없어도 OK | Fargate 노드는 VPC CNI 자체 내장이라 무관하나, 첫 EC2 노드 join의 필수 선행이라 미리 등록 |
| 3 | kube-proxy addon 등록 | 노드 없어도 OK | DaemonSet이라 노드가 생기면 자동 배치 |
| 4 | CoreDNS addon(`computeType:Fargate` + arm64 affinity 제거) | 아니오 → Fargate | profile·computeType 없이 설치하면 addon이 degraded(`InsufficientNumberOfReplicas`). 설치 후 `rollout restart deployment coredns` |
| 5 | karpenter 컨트롤러(Fargate, IRSA) | 아니오 → Fargate | CoreDNS가 Ready여야 karpenter가 AWS API를 DNS로 푼다. Fargate엔 IMDS가 없어 IRSA 필수, `cpu=1/mem≥1Gi` |
| 6 | NodePool / EC2NodeClass(v1) CR 적용 | — | karpenter v1 CRD 선적용. `amiSelectorTerms`는 v1에서 필수 |
| 7 | 첫 system EC2 노드 탄생(arm64) | — | karpenter가 pending 파드를 보고 system 풀 노드를 provision |
| 8 | ebs-csi controller(system 풀 재타깃) + csi-node DaemonSet | 예 → system 풀 | IRSA wiring이 빠지면 동적 프로비저닝 전면 실패([03]({{< relref "03-managed-addons.md" >}})) |
| 9 | ALB controller / external-secrets / argo-rollouts / metrics-server | 예 → system 풀(arm64) | 전부 `arch=arm64` required affinity라 system 풀 착지 |
| 10 | 나머지 워크로드(amd64) | 예 → service/airflow 풀 | karpenter가 수요에 따라 amd64 노드 provision |

요약: **role → profile → vpc-cni/kube-proxy → CoreDNS(Fargate) → karpenter(Fargate) → NodePool CR → 첫 system 노드 → ebs-csi/플랫폼(system 풀) → 워크로드.**

### 4.2 Helm 배포 wave

첫 노드까지 뜬 뒤 애플리케이션 계층은 아래 순서로 배포한다(사내 blue-green 방법론의 wave).

1. **karpenter**
2. **cluster-bootstrap-v2**(aws-load-balancer-controller → external-secrets → argo-rollouts → metrics-server raw manifest) — 이후 모든 IRSA/Ingress/Secret 동작의 토대. v2는 keda를 포함하지 않으므로 **keda는 독립 앱으로 별도 설치**한다.
3. **argocd(spoke) + argocd-external-secrets** — 워크로드 자체 ArgoCD가 tier-3를 reconcile하려면 필수. 정적 SA bearerToken/cluster 등록 secret을 신규 발급한다.
4. **network**: istio(+kiali) → node-local-dns
5. **monitoring**: datadog → fluentbit → victoria-metrics(+scrape) → keda
6. **management**: airflow-operator → eks-rbac → descheduler → virtual-service
7. **service**: [05 컷오버·롤백]({{< relref "05-cutover-rollback.md" >}})의 배포 순서(API→consumer→batch)를 따른다.

karpenter NodeClass AMI 핀은 목표 마이너로 갱신하지 않으면 신규 노드가 구버전 kubelet으로 생성된다. karpenter 컨트롤러는 0.36.2→1.14.0 이관이며 상세는 [components/01]({{< relref "components/01-karpenter.md" >}})이 잇는다.

## 5. 하드코딩 endpoint 재지정 (8파일 19곳)

tier-1 허브 push 앱들은 워크로드 API endpoint를 하드코딩한다. 신규 클러스터마다 (a) 아래 8파일의 endpoint를 전량 교체하고 (b) 새 server URL 키로 ArgoCD cluster 등록 secret을 신규 발급해야 한다. **endpoint 실제 문자열은 마스킹**한다(축약 해시도 남기지 않는다 — "워크로드 API endpoint").

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

tier-3 앱은 §3대로 재지정이 불필요하다 — 단 (a)(b)가 끝나 spoke argocd가 조인한 뒤라야 tier-3가 자동 승계된다.

## 6. preflight — 미설치·확인 항목

신규 클러스터에 "넣을지 말지" 판단이 필요한 후보와, 신규 인프라 조사에서 재확인이 필요한 미해결 항목만 남긴다(일회성 감사표·자연 해소 드리프트는 제외).

**미설치 판정**

| addon | 판정 | 근거 |
|---|---|---|
| aws-efs-csi-driver | ❌ finance 미설치 | role-arn이 다른 팀 계정을 가리킴, 레포 참조 없음 |
| pod-identity-agent | ❌ 부재(의도적) | finance는 전부 IRSA 경로 + Fargate가 Pod Identity 미지원([02]({{< relref "02-cluster-config.md" >}})) |
| snapshot-controller | ⚠️ 부재(실 gap 가능성) | EKS ebs-csi managed addon은 external snapshot-controller를 번들 안 함. `VolumeSnapshot` 쓰는 워크로드가 있으면 깨짐 — **라이브 확인 권장** |
| external-dns | ❌ 부재(추정 정상) | 레포 참조 없음. Route53 + istio external 라우팅 추정 |
| cert-manager(워크로드) | ❌ 부재(추정 정상) | ring0 CI 러너 번들에만 존재. 워크로드 TLS는 ALB 오프로드 + istiod self-sign |

metrics-server는 managed addon으로 추가 설치하지 않는다 — cluster-bootstrap raw manifest와 충돌한다.

**미해결·확인 포인트**

- **오설정 정정**(→ [components/06]({{< relref "components/06-observability.md" >}})): prod VM 스택의 `externalLabels.cluster`가 `ring0`으로 잘못 박혀 있고, prod grafana `root_url`이 staging 도메인을 가리킨다(copy-paste 오류) — 신규 세팅 전 정정 필수.
- **snapshot-controller 부재** 라이브 확인(위 표).
- **metrics-server cross-account ECR pull** 권한이 신규 클러스터에서 유지되는지 확인(§2).

## 우리 케이스에서는

신규 클러스터 부트스트랩에서 실제로 손이 가는 것은 **tier-1의 8파일 19곳**뿐이고, tier-3의 절반 이상은 spoke ArgoCD 조인만 끝나면 자동으로 따라온다. 작업량을 가늠할 때 "애드온이 몇 개인가"가 아니라 **"하드코딩 endpoint가 몇 곳인가"**로 물어야 정확한 그림이 나온다. metrics-server·kube-state-metrics를 별도 앱으로 다시 만들지 않도록 cluster-bootstrap·VM 스택이 이미 포함한다는 것부터 확인하는 절차가 앞서야 한다.
