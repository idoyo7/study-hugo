---
title: "레이어 1 — 클러스터 파라미터와 가변성 3분류"
date: 2026-08-15
weight: 1
---

# 레이어 1 — 클러스터 파라미터와 가변성 3분류

{{< callout type="info" >}}
- finance blue를 만들 때 정해둘 것 셋 — `upgradePolicy.supportType = STANDARD`(기본값이 EXTENDED입니다), `deletionProtection = true`, 그리고 `serviceIpv4Cidr`·`ipFamily`·`bootstrapClusterCreatorAdminPermissions`. 뒤 셋은 지금 틀리면 재생성뿐입니다.
- 최상위 29개 파라미터는 **create-only 8 · 단방향 불가역 6 · day-2 가변 15**로 갈립니다(§1).
- `upgradePolicy.supportType` 기본값은 `EXTENDED`입니다. 명시하지 않으면 표준지원 종료일부터 시간당 $0.60이 자동으로 붙고 확장지원에 실제로 진입한 뒤에는 STANDARD로 못 돌아옵니다(§4).
- 되돌릴 수 없는 문 넷 — `controlPlaneEgressMode`(CUSTOMER_ROUTED 진입), `encryptionConfig`(`DisassociateEncryptionConfig` API가 아예 없습니다), `authenticationMode`(전진만), `ipFamily`(생성 시 영구 고정)(§2).
- Terraform은 되돌리기를 **클러스터 재생성으로 모델링**합니다 — `plan`에 뜨는 `# forces replacement`는 버그가 아니라 안전장치입니다(§3).
- 버전은 2026-07부터 되돌릴 수 있습니다(7일 창·마이너 1단계·컨트롤 플레인만). 단 `--force`는 PDB도 어드미션 웹훅도 우회하지 않습니다(§5).
{{< /callout >}}

이 페이지가 다루는 범위는 `CreateCluster`·`UpdateClusterConfig`·`UpdateClusterVersion`이 받는 **클러스터 레벨 최상위 필드**입니다. 판정하는 것은 하나뿐입니다. 그 값을 언제 정할 수 있고 정한 뒤에 되돌릴 수 있는가. 2026-08에 새로 열린 컨트롤 플레인 컴포넌트 파라미터의 내부 동작과 튜닝 판단은 [레이어 2]({{< relref "02-component-parameters.md" >}}), 용량 축인 Provisioned Control Plane 티어는 [용량 축]({{< relref "03-provisioned-control-plane.md" >}}), 애초에 손댈 수 없는 영역은 [레이어 3]({{< relref "04-not-tunable.md" >}})이 갖습니다.

사실 기준 시점은 **2026-08-14**입니다. 이 페이지의 모든 `path:line` 인용은 terraform-provider-aws `main` 브랜치를 그날 내려받은 스냅샷(`internal/service/eks/cluster.go`, 2582줄)을 가리킵니다. 실제로 쓰는 provider 릴리스에서는 줄번호가 다를 수 있습니다.

## 1. 가변성 3분류 마스터 표

범례 — **create-only**: 생성 시에만 지정, 이후 API로 변경 불가 / **one-way**: 특정 방향으로만 전환 가능, 복귀 불가 / **mutable**: `UpdateClusterConfig`(또는 별도 API)로 언제든 양방향.

| 파라미터 (API 필드 경로) | Terraform 인자 | 가변성 | 기본값 | 한 줄 함정 |
|---|---|---|---|---|
| `name` | `name` | create-only ⚠️ | 필수 | 이름을 바꾸는 API가 없다. 재생성뿐 |
| `roleArn` | `role_arn` | create-only ⚠️ | 필수 | `UpdateClusterConfig` 어디에도 필드가 없어 영구 고정(§7.1) |
| `kubernetesNetworkConfig.serviceIpv4Cidr` | `kubernetes_network_config.service_ipv4_cidr` | create-only ⚠️ | 미지정 시 자동 할당(§7.6) | Update 스키마에 필드는 있지만 문서가 변경 불가라고 못 박는다 |
| `kubernetesNetworkConfig.ipFamily` | `kubernetes_network_config.ip_family` | create-only ⚠️ | `ipv4` | IPv4↔IPv6 전환 불가 — 새 클러스터로 워크로드를 옮기는 것이 유일한 경로 |
| `accessConfig.bootstrapClusterCreatorAdminPermissions` | `access_config.bootstrap_cluster_creator_admin_permissions` | create-only ⚠️ | `true` | `UpdateAccessConfigRequest`에 필드 자체가 없다. Terraform은 ForceNew(§3.1) |
| `bootstrapSelfManagedAddons` | `bootstrap_self_managed_addons` | create-only ⚠️ | `true` | 생성 시점 1회성 부트스트랩. 값을 바꾸면 Terraform이 클러스터를 재생성한다 |
| `outpostConfig.*`(`controlPlaneInstanceType`·`etcdInstanceType`·`controlPlanePlacement`·`etcdPlacement`·`outpostArns`) | `outpost_config.*` | create-only ⚠️ | — | AWS 클라우드 클러스터엔 이 블록이 적용되지 않는다. provider update 경로가 없어 drift만 남는다 |
| `resourcesVpcConfig`가 속한 VPC | `vpc_config.vpc_id`(Computed) | 완전 불변 ⚠️ | `subnetIds`로 암묵 결정 | 서브넷은 갈아도 VPC는 못 바꾼다 |
| `resourcesVpcConfig.controlPlaneEgressMode` | `vpc_config.control_plane_egress_mode` | one-way ⚠️ | `AWS_MANAGED` | `CUSTOMER_ROUTED`로 가면 같은 클러스터에서 복귀 불가(§2) |
| `encryptionConfig` | `encryption_config` | one-way(추가만) ⚠️ | 미설정 | 제거 API가 존재하지 않는다(§2) |
| `accessConfig.authenticationMode` | `access_config.authentication_mode` | one-way 전진 ⚠️ | API·SDK·CFN 생성 시 `CONFIG_MAP`, 콘솔 생성 시 `API_AND_CONFIG_MAP` | `API`로 생성하면 ConfigMap 경로를 영구히 못 연다(§2) |
| `upgradePolicy.supportType` | `upgrade_policy.support_type` | 조건부 one-way ⚠️ | **`EXTENDED`** | 확장지원에 진입한 뒤엔 STANDARD 복귀 불가(§4) |
| `computeConfig.nodeRoleArn` | `compute_config.node_role_arn` | 교체만 잠금 ⚠️ | 미설정 | 최초 설정·해제는 인플레이스, 롤 교체만 재생성(§3.2) |
| `version` | `version` | 단조 증가(7일 롤백 창 예외) | 미지정 시 EKS 기본값 | 다운그레이드 불가. 별도 `UpdateClusterVersion` API(§5) |
| `resourcesVpcConfig.subnetIds`·`.securityGroupIds` | `vpc_config.subnet_ids`·`.security_group_ids` | mutable | subnet 2개 이상(서로 다른 AZ), SG 5개까지 | 같은 VPC·처음 지정한 AZ 세트 안에서만. 교체하면 EKS가 ENI를 새로 만든다 |
| `resourcesVpcConfig.endpointPublicAccess`·`.endpointPrivateAccess`·`.publicAccessCidrs` | `vpc_config.endpoint_public_access`·`.endpoint_private_access`·`.public_access_cidrs` | mutable 양방향 | `true` / `false` / `["0.0.0.0/0"]` | private-only 전환은 API가 막지 않는다 — 락아웃은 준비 부족에서 온다(§7.3). CIDR은 클러스터당 40개 |
| `kubernetesNetworkConfig.elasticLoadBalancing.enabled` | `kubernetes_network_config.elastic_load_balancing.enabled` | mutable, 단독 토글 불가 ⚠️ | `false` | Auto Mode 3-잠금 — 혼자 켜면 plan이 실패한다(§7.4) |
| `logging.clusterLogging` | `enabled_cluster_log_types` | mutable | 5종 전부 비활성 | 로그 그룹 retention 기본이 무기한이라 audit을 켜두면 비용이 계속 는다 |
| `tags` | `tags` / `tags_all` | mutable, 다른 API | 없음 | `UpdateClusterConfig`가 아니라 `TagResource`/`UntagResource`(§7.2) |
| `zonalShiftConfig.enabled` | `zonal_shift_config.enabled` | mutable 양방향 | 문서화된 기본값 없음 | Fargate 파드는 보호 대상이 아니다 — CoreDNS·karpenter가 제외된다 |
| `remoteNetworkConfig.remoteNodeNetworks`·`.remotePodNetworks` | `remote_network_config.*.cidrs` | mutable(추가·변경·제거) | 미설정 | 제거는 빈 배열을 명시해야 된다. 필드를 생략하면 기존 값이 유지된다 |
| `computeConfig.enabled`·`.nodePools` | `compute_config.enabled`·`.node_pools` | mutable | `false` / — | Auto Mode 3-잠금(§7.4). `nodePools` 자유 조정 여부는 문서에 명시가 없다 |
| `storageConfig.blockStorage.enabled` | `storage_config.block_storage.enabled` | mutable | `false` | Auto Mode 3-잠금(§7.4) |
| `deletionProtection` | `deletion_protection` | mutable 양방향 | `false` | 네이티브로 존재한다. 단 `ACTIVE` 상태에서만 실제로 막는다(§7.5) |
| `controlPlaneScalingConfig.tier` | `control_plane_scaling_config.tier` | mutable 양방향, 빈도 제한 없음 | `standard` | 내려올 때 etcd 8GB·HPA sync 두 탈출 제약이 걸린다 → [용량 축]({{< relref "03-provisioned-control-plane.md" >}}) |
| `kubeApiServerConfig.eventTtl` | `kube_api_server_config.event_ttl` | mutable | `60m`(Terraform 표기 `1h`) | 신규 이벤트에만 적용된다 → [레이어 2]({{< relref "02-component-parameters.md" >}}) |
| `kubeApiServerConfig.serviceNodePortRange.{minPort,maxPort}` | `kube_api_server_config.service_node_port_range.{min_port,max_port}` | mutable | `30000` / `32767` | 범위를 좁혀도 기존 서비스가 점유한 포트는 유지된다 → [레이어 2]({{< relref "02-component-parameters.md" >}}) |
| `kubeControllerManagerConfig.horizontalPodAutoscalerControllerConfig.horizontalPodAutoscalerSyncPeriod` | `kube_controller_manager_config.horizontal_pod_autoscaler_controller_config.horizontal_pod_autoscaler_sync_period` | mutable, Provisioned 티어 필수 ⚠️ | `15s` | `standard` 티어에서 설정하면 호출이 실패한다 → [레이어 2]({{< relref "02-component-parameters.md" >}}) |
| `kubeSchedulerConfig.nodeResourcesFit.scoringStrategy` | `kube_scheduler_config.node_resources_fit.scoring_strategy` | mutable | `LeastAllocated`, `resources=[cpu:1, memory:1]` | 이미 스케줄된 파드는 재배치되지 않는다 → [레이어 2]({{< relref "02-component-parameters.md" >}}) |

`UpdateClusterVersion`의 `force`·`rollbackConfig.timeoutMinutes`는 이 표에 없습니다. 둘 다 클러스터 상태가 아닌 **호출 파라미터**입니다. §5에서 따로 다룹니다.

`DescribeClusterVersions` 응답은 `controlPlaneComponentConfig`(컴포넌트별 `constraints`+`defaultValue`)를 **k8s 버전별로** 돌려주고 `controlPlaneScalingTiers[]` 안에 `controlPlaneComponentConfigOverrides`라는 필드를 따로 둡니다. 같은 파라미터의 기본값·허용범위가 **버전과 티어에 따라 달라질 수 있는 구조**입니다(스키마로 확인한 사실이며 실제로 어떤 값이 티어별로 덮이는지는 확인되지 않았습니다). 위 표의 기본값 열에 유보가 남는 이유가 여기입니다. AWS 문서도 자동화를 짤 때는 이 API를 source of truth로 쓰라고 직접 권합니다.

## 2. 단방향 불가역 — 한 번 열면 닫히지 않는 문

여기 있는 값은 "나중에 고치자"가 성립하지 않습니다. create 시점 또는 전환 승인 시점에 결론을 내야 합니다. 표는 위험도 순입니다.

| # | 파라미터 | 허용되는 전환 | 되돌리기 | 1차 문서 근거 |
|---|---|---|---|---|
| 1 | `encryptionConfig` | 미설정 → 설정(생성 시 또는 `AssociateEncryptionConfig`) | **불가.** `DisassociateEncryptionConfig`라는 오퍼레이션이 EKS API·CLI 어디에도 없다 | User Guide "이 작업은 되돌릴 수 없다". provider 소스 주석도 동일 |
| 2 | `resourcesVpcConfig.controlPlaneEgressMode` | `AWS_MANAGED` → `CUSTOMER_ROUTED`(생성 시에도, 기존 클러스터에서도) | **불가.** "Switching to `CUSTOMER_ROUTED` is a one-way operation" | `API_VpcConfigRequest`, `control-plane-egress.html` |
| 3 | `accessConfig.authenticationMode` | `CONFIG_MAP` → `API_AND_CONFIG_MAP` → `API` 전진만 | **불가.** access entry를 한 번 켜면 못 끄고, 생성 시 ConfigMap을 켜두지 않았으면 나중에 추가할 수 없다 | `grant-k8s-access.html` Important 콜아웃 |
| 4 | `upgradePolicy.supportType` | `STANDARD` → `EXTENDED` 언제든. 역방향은 **표준지원 기간 중에만** | 확장지원에 실제로 진입한 뒤에는 불가(§4) | `API_UpgradePolicyRequest`, `disable-extended-support.html` |
| 5 | `kubernetesNetworkConfig.ipFamily` | 없음(생성 시 확정) | 불가. 다른 값이 필요하면 새 클러스터를 만들어 워크로드를 옮긴다 | `network_reqs.html` |
| 6 | `computeConfig.nodeRoleArn` | 미설정 → 설정, 설정 → 해제 | 이미 값이 있는 롤을 **다른 롤로 교체**하는 것만 잠긴다(§3.2) | provider `validateAutoModeComputeConfigCustomizeDiff` |

**`encryptionConfig`는 키 교체 경로도 없습니다.** `UpdateClusterConfig` 요청에 이 필드가 없고 `AssociateEncryptionConfig`는 "아직 암호화가 켜지지 않은 클러스터에 켜는 용도"로만 문서화돼 있습니다. provider도 0개→1개일 때만 `AssociateEncryptionConfig`를 호출합니다. 이미 설정된 키를 다른 키로 바꾸는 경로는 구현 자체가 없습니다.

위험은 KMS 쪽에도 있습니다. 연결된 CMK를 **삭제**하면 EKS FAQ 표현대로 클러스터 상태가 "복구 불가능한 수준으로 저하"됩니다. **비활성화**한 경우 AWS는 30일 안에 재활성화하라고 강하게 권합니다(기술적으로 보장된 데드라인이 아니라 권고 기한입니다). 참고로 k8s 1.28 이상 클러스터는 이 필드와 무관하게 기본 봉투 암호화가 상시 켜져 있어 이 파라미터는 "AWS 소유 키 대신 우리 CMK를 쓸 것인가"의 선택에 가깝습니다.

**`CUSTOMER_ISOLATED`는 판정하지 않습니다.** `controlPlaneEgressMode`의 유효값 열거에는 `AWS_MANAGED | CUSTOMER_ROUTED | CUSTOMER_ISOLATED` 세 개가 실려 있지만 전용 기능 문서와 Terraform 문서는 앞의 두 개만 설명합니다. 이미 출시된 기능인지 미문서화 예약값인지는 1차 문서로 확인되지 않았습니다.

**`authenticationMode`는 Terraform 관점에서 "mutable"로 보이는데 실제로는 3단 래칫입니다.** provider 스키마에 ForceNew가 없어 `plan`은 아무 경고 없이 인플레이스 갱신을 계획하지만 역방향 요청은 EKS API가 그 순간 거절해 `apply`가 에러로 죽습니다. 되돌리기를 시도했을 때 나오는 정확한 에러 코드는 1차 문서로 확인되지 않았습니다.

## 3. Terraform ForceNew — 어떤 인자를 고치면 클러스터가 재생성되는가

`aws_eks_cluster`의 ForceNew는 두 층으로 나뉩니다. **위험한 쪽은 스키마에 안 보이는 아래층**입니다. 프로덕션 사고 1순위가 여기입니다.

### 3.1 정적 `ForceNew: true` — 스키마에 고정

| Terraform 인자 | `cluster.go` | 비고 |
|---|---|---|
| `name` | `:424` | `role_arn`과 함께 이 리소스의 두 순수 `Required`+`ForceNew` 필드 |
| `role_arn` | `:559` | AWS API에 update 경로가 없어서 나온 정직한 반영(§7.1) |
| `bootstrap_self_managed_addons` | `:120` | `Default: true`. Auto Mode를 나중에 켜려고 `false`로 돌리면 클러스터가 통째로 재생성된다 |
| `access_config.0.bootstrap_cluster_creator_admin_permissions` | `:108` | 아래 함정 문단 참조 |
| `kubernetes_network_config.0.ip_family` | `:401` | AWS API도 create-only |
| `kubernetes_network_config.0.service_ipv4_cidr` | `:408` | AWS API도 create-only |
| `outpost_config.0.control_plane_instance_type` | `:437` | Outposts 로컬 클러스터 전용 |
| `outpost_config.0.control_plane_placement.0.group_name` | `:448` | |
| `outpost_config.0.control_plane_placement.0.spread_level` | `:453` | provider v6.51.0(2026-06-17) 신규 |
| `outpost_config.0.etcd_instance_type` | `:470` | v6.51.0 신규. 필드 자체는 확인되지만 개별 GA 시점은 1차 문서로 특정되지 않는다 |
| `outpost_config.0.etcd_placement.0.spread_level` | `:482` | v6.51.0 신규 |

`outpost_config` 블록에는 top-level ForceNew가 없는데 `resourceClusterUpdate`에 이 블록을 다루는 코드 경로가 아예 없습니다. update가 API를 호출하지 않으니 ForceNew 표시가 없는 `outpost_arns`조차 실질적으로 변경할 수 없습니다. drift만 남거나 빈 diff가 납니다. 스키마 선언과 실제 동작이 여기서 어긋납니다.

`bootstrap_cluster_creator_admin_permissions`를 두고 provider 소스는 "이 값은 AWS API가 반환하지 않는다"는 주석을 유지하며 값이 없으면 하위 호환을 지키려고 로컬 상태에 `true`를 채워 넣습니다. 이 백필이 함정입니다. **이미 존재하는 `aws_eks_cluster`에 `access_config` 블록만 뒤늦게 추가하면**(이 필드는 쓰지 않고) 백필된 기본값과 서버 상태가 어긋나 클러스터 전체 재생성이 계획되는 사례가 보고돼 있습니다(이슈 #38967, 2026-08-14 기준 미해결). "AWS API가 이 값을 조회로도 돌려주지 않는다"는 단정까지 하지는 않습니다. API Reference의 `AccessConfigResponse`에는 이 필드가 `DescribeCluster` 응답 항목으로 문서화돼 있어 문서와 provider 구현이 엇갈립니다.

### 3.2 `CustomizeDiff` 조건부 ForceNew — 스키마에 안 보인다

`resourceCluster()`의 `CustomizeDiff: customdiff.Sequence(...)`(`cluster.go:61-72`)와 `validateAutoModeComputeConfigCustomizeDiff`(`:2544-2581`)가 방향에 따라 재생성을 겁니다.

| Terraform 인자 | 정적 ForceNew | 재생성 트리거 | 정방향은 |
|---|---|---|---|
| `encryption_config` | 없음(`Optional`, `MaxItems:1`) | **제거**할 때만(1개→0개) | 추가는 인플레이스 — `AssociateEncryptionConfig` 호출 |
| `vpc_config.0.control_plane_egress_mode` | 없음(`Optional`+`Computed`) | `CUSTOMER_ROUTED` → `AWS_MANAGED`로 되돌릴 때만 | `AWS_MANAGED` → `CUSTOMER_ROUTED`는 인플레이스(약 10분) |
| `compute_config.0.node_role_arn` | 없음(`Optional`) | 이미 값이 있는 롤을 **다른 롤로 교체**할 때만 | 최초 설정·해제 둘 다 인플레이스 |

패턴이 같습니다. **AWS API가 되돌리기를 거부하는 자리에서 Terraform이 대신 재생성으로 처리합니다.** 그래서 `plan`에 뜨는 `# forces replacement`는 provider 버그가 아니라 "이 방향으로는 in-place가 원리적으로 불가능하다"는 신호입니다. 공식 문서의 `node_role_arn` 문구("Auto Mode 컴퓨트를 활성화한 뒤에는 이 값을 바꿀 수 없다")는 이 3분기를 뭉뚱그렸습니다. 실제로는 최초 설정과 해제는 봐주고 교체만 잠급니다. Auto Mode를 쓰면서 권한을 재설계할 때 여기 걸립니다.

## 4. `upgradePolicy.supportType` — 기본값이 EXTENDED다

API Reference(`UpgradePolicyRequest`)는 "The default value is EXTENDED. Use STANDARD to disable extended support."라고 쓰고 User Guide는 "By default, for all new and existing clusters, the upgrade policy is set to EXTENDED, unless specified otherwise"라고 확인합니다. **아무것도 쓰지 않으면 확장지원이 켜진 클러스터가 만들어집니다.** 값을 STANDARD로 두려면 직접 써 넣어야 합니다. 표준지원이 끝난 뒤에는 그 기회가 사라집니다. 이 페이지에서 비용에 직접 걸리는 유일한 파라미터이자 가장 자주 틀리는 자리입니다.

| 선택 | 표준지원 기간 중 | 표준지원 종료 시점 | 되돌리기 |
|---|---|---|---|
| `EXTENDED`(기본값 방치 포함) | 추가 비용 없음 | **확장지원 자동 진입** — 시간당 $0.60이 기본 클러스터 요금에 가산된다(2024-04-01 시행) | 진입 전까지만 STANDARD로 변경 가능. **진입 후에는 불가** ⚠️ |
| `STANDARD`(명시) | 추가 비용 없음 | AWS가 컨트롤 플레인을 자동 업그레이드한다 | 표준지원 종료 전이면 언제든 EXTENDED로 전환 가능 |

되돌리기의 잠금은 "EXTENDED로 설정한 순간"에 걸리지 않습니다. "클러스터 버전이 실제로 확장지원 구간에 들어간 뒤"입니다. AWS 문구는 "You cannot disable extended support once it starts. You can only disable extended support for clusters on standard support."입니다. STANDARD 운영을 원한다면 **표준지원 종료일 전에** 값을 박아둬야 합니다. 그 날짜를 넘기면 유료 구간에 굳습니다.

STANDARD를 골랐을 때 벌어지는 자동 업그레이드에서 이동하는 것은 **컨트롤 플레인뿐**입니다. managed node group·self-managed 노드는 이전 버전에 남아 스큐가 벌어집니다. 시점도 예고되지 않습니다("You won't receive any notification before the update"). 여러 마이너를 건너뛰지 않고 그 다음 하나로만 갑니다. 확장지원이 만료돼(총 26개월) 강제로 이동한 클러스터는 §5의 버전 롤백 대상에서도 제외됩니다.

green은 1.31이고 **확장지원 종료가 2026-11-26**입니다([목표버전]({{< relref "../01-target-version.md" >}})). green은 이미 확장지원 구간에 있어 이 값을 STANDARD로 되돌릴 수 없습니다. 지금 새로 만드는 blue만 선택권이 남아 있습니다. 롤백과도 맞물립니다. 롤백 대상 버전이 확장지원 버전이면 **먼저** `upgradePolicy`를 EXTENDED로 바꿔야 롤백이 시작됩니다. 표준지원 버전에서 확장지원 버전으로 되돌리면 확장지원 과금이 즉시 재개됩니다.

기본값이 언제 STANDARD에서 EXTENDED로 바뀌었는지는 1차 문서로 확인되지 않았습니다. 2024-04 GA 초기에는 STANDARD였다는 커뮤니티 기록이 있지만 전환 날짜를 명시한 문서는 찾지 못했습니다. 확정된 것은 현재값이 EXTENDED라는 사실 하나입니다.

## 5. `version` — 별도 API, 단조 증가, 그리고 7일의 예외

클러스터 버전을 담당하는 API는 `UpdateClusterConfig`가 아닙니다. **`UpdateClusterVersion`**이 따로 있습니다. 마이너 1단계씩만 오르고 일반 다운그레이드는 API 자체가 지원하지 않습니다. managed node group이 붙어 있으면 노드그룹 버전이 클러스터 버전과 일치해야 업그레이드가 시작됩니다.

그런데 **2026-07부터 롤백이 생겼습니다.** 새 API가 열린 것은 아닙니다. 같은 `UpdateClusterVersion`에 N-1 버전을 지정하면 서버가 `type: "VersionRollback"`으로 인식합니다. 되돌리는 대상은 kube-apiserver·컨트롤 플레인 컴포넌트·platform version이고 etcd 데이터·워크로드·PV는 보존됩니다. `rollbackConfig.timeoutMinutes`가 요청 스키마에 함께 들어 있습니다(로컬 aws-cli 2.27.5에는 이 플래그가 없습니다 — §7.7).

| 조건 | 내용 |
|---|---|
| 7일 창 | 업그레이드 완료 후 7일 이내에만 시작할 수 있다. 지나면 영구 불가 |
| 마이너 1단계 | N→N-1만. 1.31→1.32→1.33을 거쳤다면 1.32까지고 1.31로는 못 간다 |
| in-place로 올라온 클러스터만 | **처음부터 그 버전으로 생성된 클러스터는 롤백 대상이 아니다** |
| 확장지원 정책 | 롤백 대상이 확장지원 버전이면 먼저 `upgradePolicy`를 EXTENDED로 바꿔야 한다(§4) |
| 자동 업그레이드 이력 | 확장지원 만료로 강제 이동된 클러스터는 롤백 자체가 봉쇄된다 |
| `ACTIVE` 상태 | 다른 업데이트가 진행 중이면 불가 |
| 기능 호환성 | 현재 버전에서 켠 EKS 기능이 이전 버전에서 미지원이면 요청이 실패한다 |

데이터 플레인은 따라오지 않습니다. Auto Mode 노드는 자동으로 함께 롤백되지만 managed node group·self-managed·하이브리드 노드·addon 버전은 수동입니다. **Fargate는 롤백 자체가 미지원**입니다(컨트롤 플레인만 내려가면 Fargate 파드가 새 kubelet 버전으로 남아 skew 에러가 납니다. 워크어라운드는 그 파드를 지우고 롤백 후 재배포입니다). finance blue는 CoreDNS·karpenter를 Fargate에 올리는 토폴로지라([클러스터 설정]({{< relref "../02-cluster-config.md" >}})) 이 제약이 그대로 걸립니다.

**`--force`(`force_update_version`)는 PodDisruptionBudget도, 어드미션 웹훅도 우회하지 않습니다.** 우회하는 것은 EKS 자체의 인사이트(readiness) 검사뿐입니다. 7일 창·생성 시점 버전 확인·순차 롤백 확인·기능 호환성 검사는 우회하지 못하고 Auto Mode에서도 NodePool 디스럽션 버짓·PDB·`do-not-disrupt`는 그대로 존중됩니다. 게다가 **전진 업그레이드의 인사이트 강제 자체가 2025-03-28 임시 롤백**됐습니다. 2026-08-14 기준 User Guide가 그 "temporarily rolled back" 문구를 현재 시제로 유지하고 있어 재활성화가 확인되지 않습니다. 지금 전진 업그레이드에서 `--force`는 실질적으로 거의 무효이고 의미가 남는 자리는 롤백 준비성 인사이트를 우회할 때입니다.

## 6. `Update.type` 21종 — day-2 가변 집합의 전수 목록

`UpdateClusterConfig`·`UpdateClusterVersion`은 비동기입니다. 응답으로 `update.id`가 오고 클러스터가 `UPDATING`으로 넘어갑니다. 완료는 `DescribeUpdate`로 폴링해 `Successful`/`Failed`/`Cancelled`를 확인합니다. 성공 응답이 곧 반영은 아닙니다 — 컨트롤 플레인 롤링 업데이트를 거쳐 수 분 뒤 `ACTIVE`로 돌아오면 끝입니다.

`Update.type` 열거값은 사실 **day-2에 손댈 수 있는 것의 전수 목록**입니다. 이 목록에 없는 변경은 API가 받아주지 않는 변경이라고 읽으면 대체로 맞습니다. 2026-08-14 기준 `API_Update.html`의 `type` 열거값은 21개입니다.

| `Update.type` | 대응하는 변경 |
|---|---|
| `VersionUpdate` / `VersionRollback` | k8s 버전 전진 / 7일 창 롤백(§5) |
| `EndpointAccessUpdate` | `endpointPublicAccess`·`endpointPrivateAccess`·`publicAccessCidrs` |
| `VpcConfigUpdate` | `subnetIds`·`securityGroupIds` |
| `ControlPlaneEgressUpdate` | `controlPlaneEgressMode` |
| `AccessConfigUpdate` | `authenticationMode` |
| `UpgradePolicyUpdate` | `upgradePolicy.supportType` |
| `LoggingUpdate` | `logging.clusterLogging` |
| `VendedLogsUpdate` | 별도 설명이 없다 — 어떤 기능에 대응하는지 확인되지 않았다 |
| `AssociateEncryptionConfig` | `AssociateEncryptionConfig` 호출. **대칭인 Disassociate 값이 없다**(§2) |
| `AssociateIdentityProviderConfig` / `DisassociateIdentityProviderConfig` | 외부 OIDC identity provider 연결·해제 |
| `ZonalShiftConfigUpdate` | `zonalShiftConfig.enabled` |
| `AutoModeUpdate` | `computeConfig`·`storageConfig`·`elasticLoadBalancing`(§7.4) |
| `RemoteNetworkConfigUpdate` | `remoteNetworkConfig` |
| `DeletionProtectionUpdate` | `deletionProtection` |
| `ControlPlaneScalingConfigUpdate` | `controlPlaneScalingConfig.tier` |
| `ControlPlaneComponentConfigUpdate` | `kubeApiServerConfig`·`kubeSchedulerConfig`·`kubeControllerManagerConfig` |
| `AddonUpdate` | managed addon 변경 |
| `CapabilityUpdate` | EKS Capabilities 계열로 보이나 매핑이 확인되지 않았다 |
| `ConfigUpdate` | 매핑이 확인되지 않았다 |

유보가 둘 있습니다. Provisioned 티어 전환의 type 이름이 문서 사이에서 엇갈립니다. getting-started 문서는 `ScalingTierConfigUpdate`라고 적고 `API_Update.html` 열거값은 `ControlPlaneScalingConfigUpdate`입니다. 응답의 `type`은 배열이 아니라 **단일 문자열**입니다.

**서로 다른 카테고리를 한 호출에 섞지 말고 호출을 나누는 편이 안전합니다.** 요청 스키마상으로는 모든 카테고리가 한 JSON 바디에 공존할 수 있게 정의돼 있고 섞는 것을 금지하는 문구를 AWS 문서에서 찾지는 못했습니다. 이 권고는 (1) 응답 `type`이 단일값이라는 점, (2) 공식 예시가 전부 한 카테고리만 보여준다는 점, (3) terraform-provider-aws가 카테고리 그룹별로 `UpdateClusterConfig` 호출을 쪼개 보내는 구현을 택했다는 점을 근거로 한 **정황 기반 권고이며 확정된 API 제약이 아닙니다.**

동시성 규칙도 분명하지 않습니다. 진행 중인 업데이트가 있는 클러스터에 또 호출을 걸면 `ResourceInUseException`(HTTP 409)이 나지만 "같은 카테고리끼리만 충돌하는지 모든 업데이트가 충돌하는지"의 규칙은 문서화돼 있지 않습니다.

`kubeApiServerConfig`·`kubeSchedulerConfig`·`kubeControllerManagerConfig` 세 묶음만 갱신 시맨틱이 다릅니다. 문서가 "Updates merge with your existing configuration. Only the fields you specify change, and fields you omit keep their current values."라고 명시해 부분 갱신(PATCH형)으로 동작합니다. **기본값으로 되돌리는 전용 reset API는 없습니다** — 기본값을 다시 명시해 써야 합니다.

## 7. 나머지 주요 함정

### 7.1 `roleArn` — update 경로가 어디에도 없다

`roleArn`은 `CreateCluster` 요청에만 있습니다. `UpdateClusterConfig` 요청 바디와 그 하위 모든 구조체(`accessConfig`·`computeConfig`·`controlPlaneScalingConfig`·`kubernetesNetworkConfig`·`resourcesVpcConfig`·`upgradePolicy` 등)를 훑어도 이 필드가 없고 `tags`처럼 우회하는 별도 API도 없습니다. **클러스터 실행 역할을 바꾸는 EKS API는 2026-08 기준 존재하지 않습니다.** provider가 `role_arn`에 ForceNew를 건 것도 그래서입니다. 롤 네이밍은 생성 전에 확정해야 합니다. create 이후에 롤 이름 규칙을 정비하고 싶어지면 답은 재생성뿐입니다.

### 7.2 `tags` — 별도 API를 쓴다

`tags`는 `CreateCluster`에는 있고 `UpdateClusterConfig`에는 없습니다. day-2 변경은 가능하지만 `TagResource`/`UntagResource`라는 **다른 API**를 거칩니다(Terraform은 내부에서 이 경로를 알아서 처리합니다). 최대 50개, key 1~128자, value 256자까지이고 다른 리소스로 전파되지 않습니다. "가변인데 같은 API가 아니다"라는 예외라 자동화에서 종종 빠뜨립니다.

### 7.3 private-only 전환 — API가 막는 게 아니라 준비가 문제

`endpointPublicAccess=false` + `endpointPrivateAccess=true`는 User Guide의 엔드포인트 조합표에 **정상 지원 조합으로 등재된 구성**입니다. 이 전환 자체를 API가 거부하지는 않습니다. 실제 락아웃은 전환 **전에** 챙겨야 할 것을 빼먹은 운영 실수에서 옵니다. VPC 안에서 API 서버에 닿을 경로(커넥티드 네트워크·bastion·CloudShell 등), 그리고 IAM/RBAC 매핑입니다. 서술도 "전환을 막아라"가 아니라 **"전환 전에 사설 경로와 권한을 먼저 갖춰라"**가 맞습니다. 복구 자체는 IAM 권한만 있으면 VPC 밖에서도 `update-cluster-config`로 퍼블릭을 되살릴 수 있습니다.

public·private 둘 다 `false`인 조합은 조합표에 아예 등재돼 있지 않은데 API가 이를 명시적으로 거부한다는 문구를 1차 문서에서 직접 확인하지는 못했습니다(표에 없다는 간접 근거뿐입니다). 그리고 private access를 끈 상태에서 `publicAccessCidrs`를 좁힐 때는 노드가 나가는 NAT Gateway EIP를 목록에 반드시 넣어야 합니다 — 빠지면 노드 조인이 실패합니다.

### 7.4 Auto Mode 3-잠금

`compute_config.enabled`·`kubernetes_network_config.elastic_load_balancing.enabled`·`storage_config.block_storage.enabled` 세 값은 **전부 `true`이거나 전부 `false`**여야 합니다. provider의 `validateAutoModeCustomizeDiff`(`cluster.go:2524`)가 plan 단계에서 "must all be set to either true or false" 에러로 막습니다. `elasticLoadBalancing.enabled`만 독립적으로 켜는 시나리오는 성립하지 않습니다. Auto Mode를 부분적으로만 켜려다 `apply`가 통째로 실패하는 흔한 패턴입니다. provider v6.15.0(2025-10-02)부터 이 세 필드가 `Optional`+`Computed`로 완화돼 블록 제거도 가능해졌습니다.

### 7.5 `deletionProtection`은 네이티브로 존재한다

"EKS에는 삭제 방지가 없어 Terraform `prevent_destroy`가 유일한 방어"라는 서술은 2025-08-07 이후 사실이 아닙니다. `CreateCluster`·`UpdateClusterConfig` 양쪽에 `deletionProtection` 불리언이 있고(기본 `false`), 켜두면 `DeleteCluster` 전에 반드시 `UpdateClusterConfig`로 보호를 해제해야 합니다. 둘의 차이가 결정적입니다 — `prevent_destroy`는 Terraform plan 레벨 방어라 콘솔·CLI 직접 삭제를 못 막지만 `deletionProtection`은 **API 자체를 막아 콘솔·API·CLI·eksctl·CFN·Terraform 전 경로**에 걸립니다. 부수 효과로 "삭제 권한은 있지만 보호 해제 권한은 없는" 역할 분리가 가능해집니다.

클러스터 상태가 `creating`·`failed`·`deleting`이면 보호가 켜져 있어도 삭제됩니다 — 실제로 막는 것은 `ACTIVE` 상태뿐입니다. 그리고 2026-04에 조직 차원에서 보호를 강제하는 IAM 조건 키가 추가됐는데 조건 키 이름 자체는 확인되지 않았습니다.

### 7.6 `serviceIpv4Cidr` 기본값 — 하이브리드 예외가 있다

미지정 시 EKS는 대부분 `10.100.0.0/16` 또는 `172.20.0.0/16` 중 하나를 할당합니다. 단 **하이브리드 노드의 `remoteNodeNetworks`/`remotePodNetworks`가 이 두 기본 대역과 충돌하면 제3의 대역(예: `172.16.0.0/16`)을 자동 선택할 수 있습니다.** "항상 둘 중 하나"로 단정하면 하이브리드 환경에서 틀립니다. 선택 알고리즘 자체는 공개돼 있지 않습니다. create-only라서 이 값은 생성 시 한 번에 맞춰야 합니다. 명시할 때는 `/24`~`/12` 범위이고 `10.0.0.0/8`·`172.16.0.0/12`·`192.168.0.0/16` 중 하나 안에 들어야 합니다(CGNAT 대역도 provider v6.47.0부터 유효 범위로 인정됩니다).

### 7.7 로컬 CLI로 필드 부재를 판정하면 안 된다

2026-08-14 기준 로컬 aws-cli **2.27.5**(2025-04-30 태깅)의 `create-cluster`·`update-cluster-config`·`update-cluster-version` help에는 `deletionProtection`·`controlPlaneScalingConfig`·`kubeApiServerConfig`·`kubeSchedulerConfig`·`kubeControllerManagerConfig`·`resourcesVpcConfig.controlPlaneEgressMode`·`rollbackConfig`가 **전부 나오지 않습니다.** 그런데 같은 날 API Reference에는 이 필드들이 모두 정식 요청 파라미터로 실려 있습니다. **"CLI help에 없다"는 "API에 없다"가 아닙니다.** 이 페이지에서 가장 실무적인 경고입니다. 필드 존재 여부는 항상 실시간 API Reference로 대조하고 CLI가 못 받는 필드는 `--cli-input-json`이나 CLI 업그레이드로 우회합니다.

문서 사이의 시차는 반대 방향으로도 납니다. User Guide는 2026-08-14 현재도 `controlPlaneEgressMode`의 "Terraform 지원은 향후 릴리스에서 제공될 예정"이라는 문구를 유지하지만 provider는 이미 v6.52.0(2026-06-24)부터 `vpc_config.control_plane_egress_mode`를 지원합니다. 이런 충돌에서는 provider 소스와 CHANGELOG가 User Guide 산문보다 최신입니다.

## 우리 케이스에서는

finance blue를 Terraform으로 새로 세우는 맥락([클러스터 설정]({{< relref "../02-cluster-config.md" >}}))에서 create 시점에 정해둬야 하는 값은 세 갈래입니다. 첫째, **`upgrade_policy.support_type`을 명시적으로 `STANDARD`로 둡니다.** 기본이 EXTENDED라 비워두면 blue가 1.35 표준지원 종료일(2027-03-27)부터 확장지원 유료 구간에 자동 진입합니다. 그 시점을 넘기면 되돌릴 수도 없습니다. green이 1.31 확장지원 구간에서 2026-11-26을 안고 있는 상황을 blue에서 반복할 이유가 없습니다. STANDARD는 "표준지원이 끝나면 AWS가 컨트롤 플레인을 예고 없이 자동 업그레이드한다"는 뜻이기도 하니 이관 후 정기 업그레이드 캘린더를 돌린다는 전제에서 골라야 합니다.

둘째, **`deletion_protection = true`를 켭니다.** 네이티브 기능이 존재하므로 `prevent_destroy`에 의존할 이유가 없습니다. blue-green 기간에는 두 클러스터가 나란히 떠 있으니 콘솔·CLI 경로까지 막아두는 편이 실수 비용을 줄입니다.

셋째가 되돌릴 수 없는 몫입니다. `service_ipv4_cidr`·`ip_family`·`bootstrap_cluster_creator_admin_permissions`는 create-only라 지금 틀리면 클러스터 재생성뿐입니다. `role_arn`은 update 경로 자체가 없어 롤 네이밍까지 생성 전에 확정해야 합니다. `authentication_mode`는 02가 정한 `API_AND_CONFIG_MAP`이 이 관점에서도 맞는 선택입니다. `API`로 생성하면 aws-auth 경로를 영구히 못 열게 되므로 되돌릴 여지를 남기는 값이 `API_AND_CONFIG_MAP`입니다. `bootstrap_cluster_creator_admin_permissions`를 02의 판단대로 `false`로 둘 경우에는 순서 제약이 하나 생깁니다. 생성 principal을 access entry로 먼저 등록해두지 않으면 생성 직후 클러스터에 들어갈 주체가 없습니다.

반대로 지금 결정을 미뤄도 되는 것들도 분명합니다. 엔드포인트 접근·로깅·태그·`deletionProtection`·Provisioned 티어는 전부 day-2 가변입니다. create 시점의 검토 예산은 위의 create-only·불가역 항목에 몰아주는 편이 낫습니다.
