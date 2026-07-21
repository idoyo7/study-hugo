---
title: "Terraform 클러스터 생성과 설정 — CAPA 대체·karpenter 인프라·access entries"
weight: 4
---

# Terraform 클러스터 생성과 설정 — CAPA 대체·karpenter 인프라·access entries

{{< callout type="info" >}}
**한눈에**
- CAPA가 하던 것을 Terraform으로 대체한다 — `modules/clusters/eks`는 무호출 dead code이자 **관리형 노드그룹 시대 유산**이라 골격(`aws_eks_cluster` 셸 + OIDC provider)만 참조하고 노드그룹/런치템플릿 블록은 통째로 삭제한다 `✓`.
- **karpenter 인프라가 Terraform에 전무하다** — 컨트롤러 IRSA(v1 정책 6묶음)·노드 IAM 역할 4종·interruption SQS+EventBridge 5규칙·`karpenter.sh/discovery` 태그를 전부 신규 작성해야 한다 `✓`.
- 신규 OIDC provider는 **워크로드 계정과 management 계정 양쪽에 등록**해야 한다 — external-secrets IRSA가 OIDC를 management 계정에서 조회하기 때문이다 `✓`.
- ⚠️ **prod용 Fargate 스택과 prod blue subnet이 아직 정의돼 있지 않다.** stage는 이미 Terraform 프로토타입이 있어 재활용 가능하지만 prod는 신규 작성이 필요하고, **ebs-csi의 IRSA 롤이 스펙에 아예 없다**(최대 리스크) `✓`.
{{< /callout >}}

[아키텍처와 CAPI 진단]({{< relref "01-architecture-capi.md" >}})이 CAPA가 왜 죽었고 왜 신뢰할 수 없는 SSOT인지를, [이관 전략과 목표 버전]({{< relref "02-strategy-target-version.md" >}})이 왜 blue-green·1.35인지를 다뤘다면, 이 페이지는 그 결정을 실제로 **Terraform 코드로 어떻게 실현하나**를 다룬다. 조사 시점은 2026-07이며, 사내 값은 파일 실측(레포·파일 단위 그룹핑)을, 공식 규격은 AWS·karpenter 공식 문서를 근거로 삼는다. Fargate와 karpenter system nodepool의 토폴로지 자체는 [Fargate + karpenter 토폴로지]({{< relref "03-fargate-karpenter-topology.md" >}})가 이미 다뤘으므로 여기서는 **그 토폴로지를 만드는 Terraform 리소스**에 집중한다.

## 1. 기존 Terraform 자산 실사 — 무엇을 재활용하고 무엇을 버리나

IaC 레포에는 EKS 클러스터를 만드는 모듈이 이미 존재하지만, 실제로 쓰이는 것은 거의 없다. 호출 여부(`grep`으로 참조 카운트)를 기준으로 재활용 판정을 내린다.

| 모듈 | 무엇을 만드나 | 호출처 | 판정 |
|---|---|---|---|
| `modules/clusters/eks` | `aws_eks_cluster`(버전·VPC·SG·로깅·태그) + `aws_eks_node_group`(관리형 노드그룹, **`AL2_ARM_64` 하드코딩**) + 런치템플릿 + OIDC provider | **0건** | **부분 재활용** — 클러스터 셸은 유효하나 `access_config`(인증 모드)·`encryption_config`(KMS) 필드가 없어 추가 필요. 노드그룹·런치템플릿은 **삭제 대상**(Fargate-only 방향과 정면 충돌 + AL2 amiType는 1.33+에서 신규 노드그룹에 선택 불가) |
| `modules/clusters/addons` | `aws_eks_addon` 4종(vpc-cni/kube-proxy/coredns/ebs-csi) generic for_each + config JSON `file()` 주입 | **0건** | **재활용 가치 높음(구조)** — [managed addon 4종]({{< relref "05-managed-addons.md" >}})의 값 스키마와 그대로 정합, 버전 문자열만 1.35로 올리면 재사용 가능. ⚠️ ebs-csi 전용 블록엔 `service_account_role_arn` 인자가 없어 **IRSA 롤은 generic 블록 경유로 주입**해야 함 |
| `modules/clusters/security_groups` | cluster SG에 ALB→8080-15021 ingress 등 **SG 규칙만**(SG 리소스 자체는 입력) | 0건 | 재활용 가능. SG 리소스 정의는 여전히 이 레포 밖 |
| `modules/clusters/sqs` | 범용 애플리케이션 DLQ(main+dead-letter, redrive, `prevent_destroy`) | 0건 | ❌ **karpenter interruption 큐로 재활용 불가** — EventBridge 배선·`events.amazonaws.com` 큐 정책이 없다. karpenter용은 §3에서 전용 신규 작성 |
| `modules/irsa` | IRSA 롤 팩토리 — 트러스트 정책이 `data.aws_eks_cluster[name].identity[0].oidc.issuer`로 **동적 바인딩** | 실사용(다수) | 재활용 — §5의 재바인딩 메커니즘 자체 |

**dead code의 시대감각**: `modules/clusters/eks/variables.tf`의 `eks_version` 기본값이 `"1.31"`이다. 즉 이 모듈은 관리형 노드그룹이 표준이던 2024년경 코드이고, Fargate-only·karpenter-only 방향이 확정된 지금은 "그대로 재활용"이 아니라 **골격 참조 후 재작성**이 현실적이다.

### 이미 존재하는 Fargate 프로토타입 (stage)

원하는 "Fargate로 coredns+karpenter만" 패턴은 사실 이미 Terraform으로 작성돼 있다(`infra/stage/eks-fargate`, 내부 이관 티켓 참조 — ring0-blue의 Fargate 패턴을 그대로 따랐다는 주석이 남아 있다).

| 리소스 | 정의 |
|---|---|
| Fargate pod-exec **trust** | `eks-fargate-pods.amazonaws.com`, `aws:SourceArn = fargateprofile/${cluster_name}/*`로 스코핑 |
| Fargate pod-exec **role** | `${cluster_name}-fargate-role` + `AmazonEKSFargatePodExecutionRolePolicy` attach |
| `aws_eks_fargate_profile` | `${cluster_name}-fargate`, subnet = `endswith(key,"-green")`(private only), selector 2종 |
| selector | `{ns: karpenter}` + `{ns: kube-system, labels:{k8s-app: kube-dns}}` |

재활용 판정은 매우 높다. `cluster_name`을 blue 이름으로, subnet 필터를 **`endswith(key,"-blue")`**로만 바꾸면 그대로 동작한다. blue subnet은 stage에서는 이미 선provisioned 상태다(`subnet-0124…153`(2a-blue), `subnet-098a…8b4`(2c-blue)).

⚠️ 두 가지가 걸린다. 첫째, **prod에는 이 Fargate 스택 자체가 없다** — stage 패턴을 그대로 복제해 신규 작성해야 한다. 둘째, **prod blue/green 클러스터용 subnet이 아직 어디에도 정의돼 있지 않다** — 클러스터 registry에는 private/public/firmbanking subnet만 있고 blue/green 분리 subnet이 없어, prod 재구축 전에 subnet 확보가 선행돼야 한다. 셋째(운영상 주의), selector는 **파드 생성 시점에만 평가**되므로 프로필을 만든 뒤 대상 워크로드를 rollout restart해야 하고, coredns의 arm64 nodeAffinity를 먼저 제거해야 한다(Fargate=amd64 전용, [토폴로지 페이지]({{< relref "03-fargate-karpenter-topology.md" >}}) 참조).

### kube-proxy addon mode 변수화 — nftables opt-in 준비

`modules/clusters/addons`는 각 addon의 `configuration_values`를 정적 JSON `file()`로 주입하는 구조라, kube-proxy의 `mode`도 현재는 값이 코드에 박혀 있다. [managed addon]({{< relref "05-managed-addons.md" >}})에서 확인했듯 이번 이관은 `iptables`를 유지하지만, 향후 전환을 한 줄 변수 변경으로 끝내기 위해 kube-proxy 블록만 변수화해 둔다.

```hcl
variable "kube_proxy_mode" {
  description = "kube-proxy 프록시 모드. EKS addon 기본값은 iptables이며, v1.31+ addon 계열부터 nftables를 opt-in 가능(ipvs는 1.35 deprecated, 코드 삭제는 KEP-5495 기준 v1.43 예정)."
  type        = string
  default     = "iptables"

  validation {
    condition     = contains(["iptables", "nftables"], var.kube_proxy_mode)
    error_message = "kube_proxy_mode는 iptables 또는 nftables만 허용한다."
  }
}

resource "aws_eks_addon" "kube_proxy" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "kube-proxy"
  addon_version               = var.kube_proxy_addon_version # 예: v1.35.3-eksbuild.13
  resolve_conflicts_on_update = "PRESERVE"                   # §3 conflict resolution 관례

  configuration_values = jsonencode({
    mode = var.kube_proxy_mode
  })
}
```

기본값은 `iptables`로 두고, 실제 전환 시에는 `kube_proxy_mode = "nftables"`로 apply한 뒤 `kubectl -n kube-system rollout restart ds kube-proxy`로 기존 노드의 규칙셋을 정리해야 한다(모드 전환이 이전 규칙셋을 자동 정리하지 않는다).

## 2. CAPA → Terraform 매핑

CAPI 스펙(`clusterapi.yaml`)이 CAPA 리컨사일로 만들던 것을 Terraform 리소스로 1:1 대응시킨다.

| # | CAPA가 하던 것 | Terraform 대체 | 비고 |
|---|---|---|---|
| 1 | 클러스터 IAM role(CAPA가 관리 롤로 생성) | `aws_iam_role` + `AmazonEKSClusterPolicy` attach(신규) | 기존 모듈은 `role_arn`을 **입력**만 받아 롤 자체는 신규 작성 필요 |
| 2 | `aws_eks_cluster`(버전·VPC/subnet·endpoint·로깅·태그) | 기존 모듈 골격 재사용 — `version`은 목표(1.35), `vpc_config`는 blue subnet, `endpoint_private_access=true`/`endpoint_public_access=false`, `enabled_cluster_log_types=["audit"]`, 태그 `creator=sre` | |
| 3 | OIDC provider(워크로드 계정에만 등록) | `aws_iam_openid_connect_provider` — **워크로드 계정 + management 계정 양쪽** | §5 |
| 4 | 인증/roleMapping(aws-auth 자동 매핑) | `access_config { authentication_mode = "API_AND_CONFIG_MAP" }` + `aws_eks_access_entry` | §4 |
| 5 | managed addon 4종 | `aws_eks_addon` ×4(addons 모듈 재활용, 버전 1.35로) | [05]({{< relref "05-managed-addons.md" >}})가 상세를 다룬다 |
| 6 | ebs-csi SA-role(스펙에 없어 위태로운 상태) | `modules/irsa`로 `ebs-csi-controller-sa` IRSA + `AmazonEBSCSIDriverPolicyV2`(신규) | [05]({{< relref "05-managed-addons.md" >}}) 최우선 리스크와 동일 |
| 7 | Fargate 프로필 2셀렉터(CAPA 미관리, 별도 스택이 붙어 있음) | `aws_eks_fargate_profile` + pod-exec role(§1 프로토타입 재활용, blue 필터) | |
| 8 | 부트스트랩 관리형 노드그룹(AL2_ARM_64, min2 max40) | **없음(삭제)** — Fargate가 coredns+karpenter를 호스팅하고 karpenter가 나머지 system nodepool을 프로비저닝 | Fargate-only 방향의 직접 결과 |
| 9 | securityGroupOverrides(stage는 전용 SG 고정, prod는 미지정) | `vpc_config.security_group_ids` + `security_groups` 모듈(ALB 규칙) | 전용 SG 정의 자체는 여전히 이 TF 레포 밖 → SSOT 편입 여부 판단 필요 |
| 10 | additionalControlPlaneIngressRules(VPC간 CIDR 허용) | `aws_security_group_rule`(cluster SG ingress) 또는 `vpc_config` 기본 SG 규칙 | |
| 11 | secrets KMS 암호화(현재 미설정) | (선택) `aws_eks_cluster.encryption_config` + `aws_kms_key` | 신규 클러스터에서 보안 baseline으로 추가 권장 |
| 12 | bastion | **해당 없음** | CAPI 스펙에 클러스터 bastion이 없고, TF의 bastion 참조는 전부 DB/CI용이라 클러스터 bastion은 신규 작성 불필요 |

## 3. karpenter 인프라 신규 작성 — Terraform에 전무한 부분

컨트롤러 IRSA·노드 롤·interruption SQS·discovery 태그 어느 것도 이 IaC 레포에 존재하지 않는다(`grep -rn "karpenter\|interruption\|karpenter.sh/discovery"`가 dead code·주석·무관 리소스 외엔 0건). 아래는 karpenter 공식 CloudFormation 레퍼런스와 getting-started 가이드를 근거로 전부 신규 작성해야 하는 목록이다.

### 3-1. 컨트롤러 IRSA role

finance는 karpenter 컨트롤러를 **Fargate**로 호스팅하므로 인증 경로는 **IRSA(OIDC)** 다 — Pod Identity는 DaemonSet 기반 Agent가 필요해 Fargate를 지원하지 않는다. 트러스트는 신규 클러스터 OIDC issuer + `system:serviceaccount:karpenter:karpenter`로, `modules/irsa`의 동적 바인딩 패턴 그대로 작성 가능하다. karpenter 1.14 기준 컨트롤러 정책은 6개 묶음이다.

```
NodeLifecyclePolicy      # RunInstances/CreateFleet/CreateLaunchTemplate/TerminateInstances
                          # eks:eks-cluster-name + kubernetes.io/cluster/<name>=owned 로 태그 스코핑
IAMIntegrationPolicy      # PassRole(노드 롤), CreateInstanceProfile/AddRoleToInstanceProfile/... — 클러스터명 스코핑
EKSIntegrationPolicy      # eks:DescribeCluster
InterruptionPolicy        # sqs:DeleteMessage/GetQueueUrl/ReceiveMessage
ZonalShiftPolicy          # arc-zonal-shift:GetManagedResource
ResourceDiscoveryPolicy   # ec2:Describe*, ssm:GetParameter, pricing:GetProducts,
                          # iam:ListInstanceProfiles(v1.7+), iam:GetInstanceProfile
```

v1.11+에서 `ec2:DescribePlacementGroups`, v1.12+에서 `ec2:DescribeInstanceStatus`가 추가로 필요하다([karpenter 컴포넌트 문서]({{< relref "components/_index.md" >}})가 karpenter 자체의 v1beta1→v1 마이그레이션 상세를 잇는다).

### 3-2. 노드 IAM role + instance profile

EC2 trust의 `aws_iam_role` + managed policy 4종 attach: `AmazonEKSWorkerNodePolicy`, `AmazonEKS_CNI_Policy`, **`AmazonEC2ContainerRegistryPullOnly`**(구 ReadOnly 대체), `AmazonSSMManagedInstanceCore`. instance profile은 karpenter v1.7+가 자동 생성·관리할 수 있으나, finance는 현재 정적 instance profile을 참조하는 방식이라 그대로 유지한다. vpc-cni가 spec에 SA-role이 없는 구조라, 노드 롤에는 `AmazonEKS_CNI_Policy`를 계속 유지하는 편이 안전하다.

### 3-3. Interruption SQS + EventBridge

`aws_sqs_queue`(큐 이름은 차트의 `settings.interruptionQueue` 값과 정확히 일치해야 소비된다) + `aws_sqs_queue_policy`(principal `events.amazonaws.com`+`sqs.amazonaws.com`, `sqs:SendMessage`, `aws:SecureTransport:false` deny). `aws_cloudwatch_event_rule`+`aws_cloudwatch_event_target` 5종을 큐로 연결한다.

| 규칙 | source | detail-type |
|---|---|---|
| ScheduledChange | `aws.health` | `AWS Health Event` |
| SpotInterruption | `aws.ec2` | `EC2 Spot Instance Interruption Warning` |
| Rebalance | `aws.ec2` | `EC2 Instance Rebalance Recommendation` |
| InstanceStateChange | `aws.ec2` | `EC2 Instance State-change Notification` |
| CapacityReservationInterruption | `aws.ec2` | `EC2 Capacity Reservation Instance Interruption Warning` |

기존 `modules/clusters/sqs`는 범용 앱 DLQ라 EventBridge 배선이 없어 **재활용 불가** — 전용으로 새로 짠다.

### 3-4. subnet / SG의 discovery 태그

karpenter는 subnet과 보안그룹에 `karpenter.sh/discovery: ${CLUSTER_NAME}` 태그로 프로비저닝 대상을 발견한다(EC2NodeClass의 `subnetSelectorTerms`/`securityGroupSelectorTerms`). 현재 이 태그는 TF에 0건이라, 신규 클러스터의 노드용 subnet(blue subnet)·SG에 `aws_ec2_tag` 또는 리소스 `tags`로 추가해야 karpenter가 노드를 띄울 수 있다. ALB용 `kubernetes.io/role/internal-elb=1` 태그도 같은 subnet에 함께 붙어야 한다(내부 private endpoint + internal ALB 전제).

### 3-5. karpenter 노드 롤의 클러스터 접근

공식 getting-started는 노드 롤을 aws-auth identityMapping으로 join시키지만, access entries를 채택하면(§4) **`aws_eks_access_entry(type=EC2_LINUX)`**로 대체해야 한다. 관리형 노드그룹·Fargate profile 롤은 EKS가 access entry를 자동 생성해주지만, **karpenter가 띄우는 노드는 self-managed 취급**이라 이 access entry만은 명시적으로 작성해야 노드가 조인한다.

## 4. 인증 모드 — aws-auth에서 access entries로

CAPA를 쓰지 않으므로 `IAMAuthenticator`(aws-auth ConfigMap) 강제가 사라진다. AWS는 access entries를 "주체에 접근을 부여하는 권장 방법"으로 명시하고 aws-auth는 deprecated로 표기한다. 신규 클러스터는 **`authentication_mode = API_AND_CONFIG_MAP`**로 만들고 주체를 access entry로 등록하는 방향을 권장한다.

| 대상 | 리소스 | type | 비고 |
|---|---|---|---|
| 클러스터 인증 모드 | `access_config { authentication_mode = "API_AND_CONFIG_MAP" }` | — | access entry + 기존 aws-auth 병행, 레거시 호환을 위한 안전한 전환 |
| karpenter 노드 롤 | `aws_eks_access_entry` | **EC2_LINUX** | 노드 join 자동 권한. `kubernetes_groups`·access policy는 지정 불가(비-STANDARD) |
| CI/admin 롤 | `aws_eks_access_entry` + `aws_eks_access_policy_association` | **STANDARD** | policy는 `AmazonEKSClusterAdminPolicy` 등 — cross-account ARN도 STANDARD에서만 허용 |
| 개발자 조회 | `aws_eks_access_entry`(STANDARD) + policy assoc | STANDARD | `AmazonEKSViewPolicy` 등, namespace scope 가능 |

Fargate pod-exec role은 별도 조치가 필요 없다 — **AWS 공식으로 Fargate profile 롤은 access entry를 자동 생성**해주므로 karpenter 노드 롤(EC2_LINUX)만 명시 작성하면 된다. `bootstrapClusterCreatorAdminPermissions`는 기본 true라 클러스터 생성 principal(CI 실행 롤)이 자동으로 admin이 되는데, 명시적으로 관리하려면 false로 두고 그 롤을 access entry로 별도 등록하는 편이 감사성 측면에서 낫다.

## 5. OIDC 이중등록과 IRSA 재바인딩

신규 blue 클러스터는 신규 OIDC issuer URL + 신규 OIDC provider ARN을 갖는다. 여기서 걸리는 지점이 이 프로젝트에서 가장 파급이 큰 함정이다.

기존 IRSA 롤들은 `data.aws_eks_cluster[name].identity[0].oidc.issuer`로 **동적 바인딩**돼 있어, 클러스터 이름이 같으면(green 재생성) `apply`만으로 자동 갱신된다. 하지만 **OIDC provider의 lookup은 항상 management 계정에서 수행**된다 — 실사용 IRSA 스택의 데이터 소스가 명시적으로 "OIDC provider는 항상 management 계정에서 조회"라고 주석돼 있다. 반면 이전까지 CAPA가 수행하던 `associateOIDCProvider`는 **워크로드 계정에만** OIDC provider를 등록해왔다.

따라서 신규 blue 클러스터를 만들 때는 **워크로드 계정 + management 계정 양쪽에 `aws_iam_openid_connect_provider`를 등록**해야 external-secrets를 포함한 IRSA 전체가 붙는다. 이름이 다른 신규 클러스터(green→blue)라면 클러스터 registry에 신규 이름을 추가하는 작업까지 병행해야 재바인딩이 트리거된다.

재바인딩이 필요한 대상은 정리하면 다음과 같다.

- **Terraform 관리(동적 재바인딩, `apply`만으로 갱신)**: 워크로드·management 양쪽의 시크릿 관리용 IRSA 롤 — registry에 신규 클러스터명만 추가하면 자동.
- **Terraform 레포 밖(외부 관리, 별도 재발급 경로 확인 필요)**: karpenter 컨트롤러 IRSA, ALB controller IRSA, argo-rollouts IRSA, fluentbit·datadog·cloudwatch-agent IRSA, 그리고 **ebs-csi IRSA**(스펙에 SA-Role이 아예 없어 신규 OIDC로 wiring됐는지부터 확인해야 하는 상태).
- **ArgoCD**: 신규 blue API endpoint로 클러스터 등록 secret을 새로 발급해야 한다(정적 SA bearerToken 방식). tier-3 앱(`kubernetes.default.svc`로 도는 앱)은 재지정이 불필요하지만, tier-1 허브 push 앱은 §6의 하드코딩 endpoint 교체가 선행돼야 한다.

## 6. amiType·IMDS·하드코딩 endpoint

세 가지는 각각 "필수 변경", "필수 변경", "재바인딩 작업량"이라는 다른 성격의 이슈지만 신규 클러스터 설정에서 함께 처리해야 한다.

**amiType — AL2_ARM_64에서 AL2023_ARM_64_STANDARD로(필수, blocking).** EKS는 2025-11-26부로 AL2(AL2_ARM_64 포함) AMI 발행을 중단했고 1.32가 AL2 AMI의 마지막 버전이다. 즉 1.33 이상에서는 신규 관리형 노드그룹에 AL2 amiType을 아예 선택할 수 없다. karpenter EC2NodeClass는 이미 AL2023 amiFamily라 마이너별 AMI 핀만 목표 버전용으로 갱신하면 된다. 라이브 노드는 이미 콘솔에서 AL2023으로 교체가 끝난 상태라 OS 자체의 리스크는 낮고, 스펙-라이브 정합의 문제로 남는다.

**IMDS hop limit = 2(필수).** AL2023 신규 노드그룹은 hop limit이 1이면 IRSA 토큰 취득이 실패해 vpc-cni·ebs-csi가 함께 깨진다. 신규 노드그룹/런치템플릿 생성 시 반드시 2로 설정한다.

**하드코딩 endpoint(재바인딩 작업량).** 워크로드 API endpoint가 ArgoCD app-of-apps 레포의 **8개 매니페스트, 총 19곳**에 하드코딩돼 있다(tier-1 허브가 워크로드로 직접 push하는 앱들). 신규 클러스터를 세울 때마다 이 19곳을 새 endpoint로 교체하고 ArgoCD cluster 등록 secret을 새로 발급해야 한다. 파일별 분포와 정확한 목록은 [애드온 인벤토리·드리프트]({{< relref "06-addon-inventory-drift.md" >}})에서 다룬다.

## 7. Terraform 체크리스트

**클러스터 코어**
- [ ] `aws_iam_role`(클러스터) + `AmazonEKSClusterPolicy` — CAPA 롤 대체
- [ ] `aws_eks_cluster` — version(1.35), vpc_config(blue subnet + endpoint private-only), `enabled_cluster_log_types=["audit"]`. 기존 모듈 골격에서 **노드그룹/런치템플릿 제거**
- [ ] `access_config { authentication_mode = "API_AND_CONFIG_MAP" }`
- [ ] (선택) `encryption_config` + `aws_kms_key` — secrets envelope 암호화
- [ ] `aws_iam_openid_connect_provider` **×2**(워크로드 계정 + management 계정)

**Fargate(coredns + karpenter 호스팅)**
- [ ] `aws_iam_role`(pod-exec) + `AmazonEKSFargatePodExecutionRolePolicy` — stage 프로토타입 재활용
- [ ] `aws_eks_fargate_profile` — selector `{ns:karpenter}`+`{ns:kube-system,k8s-app:kube-dns}`, subnet `endswith("-blue")`
- [ ] **prod Fargate 스택 신규 작성** + **prod blue subnet 신규 확보**(둘 다 현재 부재)

**managed addon 4종 + SA-role**
- [ ] `aws_eks_addon` ×4 — addons 모듈 재활용, 버전 1.35, coredns/ebs-csi config 재전달
- [ ] `modules/irsa` → `ebs-csi-controller-sa` + `AmazonEBSCSIDriverPolicyV2`, addon `service_account_role_arn`에 주입
- [ ] kube-proxy `configuration_values.mode`를 변수화(`kube_proxy_mode`, 기본 `iptables`) — nftables 전환 준비

**karpenter 인프라(전부 신규)**
- [ ] 컨트롤러 IRSA(v1 6정책, 클러스터명 스코핑)
- [ ] 노드 IAM role + 4 managed policy + instance profile
- [ ] interruption SQS + queue policy(events/sqs principal)
- [ ] EventBridge 규칙 ×5 → 큐
- [ ] subnet/SG `karpenter.sh/discovery=<cluster>` 태그
- [ ] `aws_eks_access_entry(type=EC2_LINUX)` 노드 롤

**인증/접근**
- [ ] `aws_eks_access_entry(STANDARD)` + policy association — CI/admin/개발자
- [ ] 클러스터 registry에 신규 클러스터명 추가 → IRSA 재바인딩 트리거

**SG/네트워크**
- [ ] `vpc_config.security_group_ids` 결정(전용 SG 유지 vs 기본 SG)
- [ ] `security_groups` 모듈 — ALB→cluster ingress 규칙
- [ ] additionalControlPlaneIngressRules 재현(VPC간 CIDR)
- [ ] ALB subnet 태그 `kubernetes.io/role/elb`·`internal-elb`

**클러스터 밖(Terraform 아님 — 인지용)**
- [ ] ArgoCD cluster 등록(정적 SA 토큰) — 수동/별도 경로
- [ ] 하드코딩 endpoint 19곳 교체
- [ ] 기존 CAPA 관리 ApplicationSet에서 finance 분리
- [ ] green 클러스터 통제 삭제(CAPA 롤이 죽어 있어 수동으로만 가능)

## 우리 케이스에서는

Terraform으로 신규 blue 클러스터를 세우는 작업은 "새로 만드는 것"보다 "CAPA가 암묵적으로 해오던 12가지를 명시적으로 재현하는 것"에 가깝다. 클러스터 셸·addon 스키마·Fargate 프로필은 기존 자산을 재활용할 수 있어 상대적으로 손이 덜 가지만, **karpenter 인프라 전체(IRSA·노드 롤·interruption·discovery 태그)는 이 레포에 전혀 없어 처음부터 짜야 한다.**

가장 위험한 두 지점은 순서가 다르다. **OIDC 이중등록**은 빠뜨리면 external-secrets를 포함한 cross-account IRSA 전체가 조용히 깨지는 blocking 이슈이고, **ebs-csi IRSA 롤**은 스펙에 아예 필드가 없어 존재 자체를 놓치기 쉬운 최대 리스크다. 두 항목 모두 "TF 코드가 있으니 되겠지"로 넘길 수 없는, 신규 OIDC 기준으로 실제 wiring을 확인해야 하는 항목이다. 여기에 **prod Fargate 스택과 prod blue subnet이 아직 존재하지 않는다**는 사실까지 더하면, prod 이관은 stage 검증이 끝난 뒤에도 별도의 신규 작성 작업이 남는다는 뜻이 된다.
