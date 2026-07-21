---
title: "EKS managed addon 4종과 부트스트랩 순서 — coredns 하드blocking·ebs-csi IRSA"
weight: 5
---

# EKS managed addon 4종과 부트스트랩 순서 — coredns 하드blocking·ebs-csi IRSA

{{< callout type="info" >}}
**한눈에**
- managed addon은 **버전 문자열만 diff**한다 — AWS가 차트를 관리하므로 워크로드 차트 리워크 대상이 아니다. 최종 eksbuild suffix는 **작업 당일 `describe-addon-versions --kubernetes-version 1.35`로 확정**한다 `✓`.
- **coredns만 하드 blocking**이다 — 1.35는 v1.14.x 계열만 서빙하므로 create-addon 시 반드시 직행해야 한다. kube-proxy는 컨트롤플레인 버전락(1.35 CP엔 v1.35.x 필수), vpc-cni·ebs-csi는 version-agnostic이라 권장 사항이다 `✓`.
- **ebs-csi는 IRSA 롤이 스펙에 아예 없다** — wiring하지 않으면 동적 프로비저닝이 전면 실패한다(가장 큰 리스크) `✓`.
- vpc-cni는 노드가 join하기 **전에 반드시 먼저** 설치해야 하는 유일한 hard 선행 의존이다 `✓`.
{{< /callout >}}

[Terraform 클러스터 생성과 설정]({{< relref "04-terraform-cluster-settings.md" >}})이 클러스터 껍데기를 어떻게 짓는지 다뤘다면, 이 페이지는 그 위에 올라가는 **EKS managed addon 4종 + cloudwatch**의 버전과 설치 순서를 다룬다. 조사 시점은 2026-07이며, [이관 전략과 목표 버전]({{< relref "02-strategy-target-version.md" >}})에서 확정한 목표 1.35 기준으로 통일했다 — addon 자체의 하드 blocking 여부·config 재전달 원리 같은 방법론은 1.33 기준으로 먼저 조사됐다가 1.35로 값만 상향된 것이므로, 판단 구조는 그대로 유효하다.

## 1. managed addon 4종 + cloudwatch 버전 diff(1.35 기준)

SSOT는 CAPI 스펙의 `addons[]`이며, 여기 등재된 것은 정확히 4종(vpc-cni·kube-proxy·aws-ebs-csi-driver·coredns)이다. cloudwatch observability는 이 스펙에 없는 5번째 addon으로, 콘솔에서 수동 설치된 이력이 있어 신규 클러스터에는 명시적으로 챙겨 넣어야 한다.

| addon | 현재(1.30) | 목표(1.35) | 변경 |
|---|---|---|---|
| **coredns** | v1.11.1-eksbuild.9 | **v1.14.3-eksbuild.3**(1.35=1.36 공용) | **필수 — 라인 자체가 이동**. v1.11.x에서 v1.14.x로 create 직행 + config 재전달 |
| **kube-proxy** | v1.30.0-eksbuild.3 | **v1.35.3-eksbuild.13** | **필수 — 컨트롤플레인 버전락.** nftables가 1.33에서 GA됐지만 EKS 기본은 여전히 iptables라 동작 변화 없음 |
| **vpc-cni** | v1.18.2-eksbuild.1 | 당일 describe(조사 시점 카탈로그 최신 `v1.22.3-eksbuild.1`, k8s 1.30~1.36 전 버전 공통) | 권장 — version-agnostic. 노드 join 전 최우선 설치(hard 선행) |
| **aws-ebs-csi-driver** | v1.30.0-eksbuild.1(+config, **SA-Role 없음**) | 당일 describe(조사 시점 카탈로그 `v1.62.0-eksbuild.1`) | 권장 — version-agnostic. ⚠️ **IRSA 롤 필수인데 스펙에 없음** — `--service-account-role-arn`+`AmazonEBSCSIDriverPolicyV2` 명시 필요. controller를 karpenter system 풀로 재타깃 + `arch=arm64` toleration 필수 |
| **amazon-cloudwatch-observability** | v4.5.0-eksbuild.1(콘솔 설치, 스펙 미등재) | 당일 describe(1.35) | 신규 클러스터에 **반드시 설치**(누락 시 관측 공백) + CloudWatch agent IRSA 필요 |

config 스키마는 신 버전에서도 제거·리네임된 키가 없어 그대로 유효하다. 단 이번 이관에서 채택한 Fargate 방향 때문에 **값 자체는 바뀐다** — coredns는 arm64/system-primary nodeAffinity·tolerations를 제거하고 `computeType: Fargate`를 추가하며, ebs-csi는 karpenter system 풀로 타깃을 옮기고 `arch=arm64` toleration을 추가한다. Fargate 토폴로지의 세 가지 물리 제약(amd64 전용·DaemonSet 미부착·동적 EBS 불가)은 [Fargate + karpenter 토폴로지]({{< relref "03-fargate-karpenter-topology.md" >}})에서 이미 다뤘다.

## 2. coredns 하드blocking · kube-proxy 버전락 · vpc-cni/ebs-csi version-agnostic

네 addon은 업그레이드 압박의 성격이 전혀 다르다. 이 구분을 놓치면 "전부 최신으로 올리면 된다"는 단순화로 위험도를 오판하게 된다.

### 2-1. coredns — 유일한 하드 blocking

k8s 버전별 addon 카탈로그를 보면 coredns만 마이너 경계에서 서빙 라인이 완전히 바뀐다.

| k8s | coredns addon 계열 |
|---|---|
| 1.30 / 1.31 / 1.32 | v1.11.x |
| 1.33 | v1.12.x |
| 1.34 | v1.13.x |
| **1.35(=1.36 공용)** | **v1.14.3-eksbuild.3** |

즉 1.35 클러스터에는 v1.14.x가 최소이자 필수다. finance는 `core-dns-config`에서 Corefile을 커스터마이즈하지 않고 replicaCount·affinity·tolerations·topologySpreadConstraints만 설정하므로, 업스트림의 Corefile 파괴적 변경은 영향이 없다. 다만 EKS 기본 `topologySpreadConstraints`는 `whenUnsatisfiable: ScheduleAnyway`인데 finance는 `DoNotSchedule`로 override하고 있어, replicaCount 2 + maxSkew 1 조합에서는 **대상 노드가 2개 AZ에 각각 있어야** 두 번째 replica가 Pending되지 않는다. addon 업데이트는 `PodDisruptionBudget`을 자동 배치하는데, 기존 PDB가 있으면 실패할 수 있어 conflict resolution을 `overwrite`로 유지하는 편이 안전하다.

### 2-2. kube-proxy — 컨트롤플레인 버전락

kube-proxy는 컨트롤플레인 버전을 초과할 수 없고 최대 3마이너 뒤까지만 허용된다. 1.35 CP에는 v1.35.x가 필수이며, 신규 클러스터는 v1.35.3-eksbuild.13으로 직접 create한다. finance는 config가 없어 기본값으로 동작하므로 파괴적 config 변경은 해당하지 않는다. nftables 백엔드는 1.33에서 GA됐지만 GA 이후에도 EKS 기본 모드는 여전히 iptables다 — nftables는 `configurationValues`의 `mode: nftables`로 opt-in해야 하는데, 이번 이관에서는 채택하지 않는다. (2026-07-21 재조사) upstream 1.35·1.36 모두 default는 여전히 `iptables`이고, EKS kube-proxy addon도 `v1.31` 계열부터 `mode` enum에 `nftables`가 노출돼 있어(`describe-addon-configuration` 실측 `✓`) 필요 시 `{"mode": "nftables"}`만으로 opt-in 가능하다. 단 IPVS는 "1.35 deprecated"일 뿐 **1.36에서 removed는 아니다** — 실제 코드 삭제는 KEP-5495 기준 v1.43 예정이라 두 버전 모두 IPVS가 경고 로그와 함께 여전히 동작한다 `✓`. ⚠️ AWS `best-practices/ipvs.html` 문서 본문은 아직 "nftables가 under development"라는 outdated 문구가 남아 있으니 상단 경고 박스(1.33 GA·1.35 deprecated 명시)만 신뢰한다.

### 2-3. vpc-cni — version-agnostic, 기본 동작 불변

config가 없어 기본 env 그대로 동작한다. 네트워크 정책은 여전히 기본 비활성이고, Prefix Delegation도 기본 false다. 구간별 주요 변경(SDK v2 내부 마이그레이션, Multi-NIC opt-in, Network Policy Agent의 unix socket 이동, 일부 번들 CNI 플러그인 제거)은 전부 opt-in이거나 finance 미사용 범위(Multus 미사용) 밖이라 실질 영향이 없다. IAM 요구사항도 이 구간에서 신규 필수 권한 추가가 없다 — 단 vpc-cni는 `AmazonEKS_CNI_Policy`를 노드 롤 또는 IRSA로 요구하는데, finance는 IRSA 경로면서 스펙에 SA-Role이 없어 신규 클러스터의 노드 롤/IRSA에 이 정책이 실제로 바인딩됐는지 확인이 필요하다.

### 2-4. ebs-csi — version-agnostic이지만 IRSA가 최대 리스크

controller의 affinity/tolerations/nodeSelector 스키마는 이 버전 구간에서 변경이 없어 finance의 `csi-driver-config`가 그대로 유효하다. arm64(Graviton)는 완전 지원 대상이라 노드 아키텍처 문제도 없다. StorageClass 관련 기능 변화(동적 IOPS 한도 조회, 즉시 볼륨 복사, `blockExpress` deprecated로 io2가 항상 최대 IOPS cap 적용 등)는 별도 SC 오브젝트의 문제라 addon config에는 영향이 없다.

⚠️ 진짜 리스크는 따로 있다. **ebs-csi addon은 IAM 롤(`ebs-csi-controller-sa`)이 반드시 필요한데, finance 스펙에는 SA-Role이 없다.** 미설정 상태로 두면 PVC 생성 시 `UnauthorizedOperation`이 떨어지며 동적 프로비저닝이 전면 실패한다. 현행 권장 정책은 `AmazonEBSCSIDriverPolicyV2`(구 `AmazonEBSCSIDriverPolicy`에서 마이그레이션)다. AL2023 노드의 IMDS hop limit이 2여야 하는 이유도 여기서 겹친다 — IRSA 토큰 취득이 vpc-cni·ebs-csi 공통으로 이 홉 수에 의존한다.

## 3. config 재전달과 conflict resolution 검증값

managed addon 갱신에서 자주 놓치는 함정은 "버전만 올리면 config는 유지된다"는 가정이다. 이번 이관은 CAPA를 신뢰할 수 없는 SSOT로 판정했으므로([아키텍처와 CAPI 진단]({{< relref "01-architecture-capi.md" >}}) 참조) create-addon/update-addon CLI를 authoritative로 삼고, **config를 매번 명시적으로 재전달**하는 것을 원칙으로 한다.

- **coredns**: `--configuration-values` 누락 시 affinity·tolerations·topologySpread가 미적용돼 대상 노드 밖으로 스케줄되거나 기본 PDB가 붙는다. config 재전달은 옵션이 아니라 필수다.
- **ebs-csi**: 마찬가지로 `--configuration-values`를 재전달해야 controller의 노드 타깃팅이 유지된다.
- **conflict resolution 값**: 사내 이전 이관 사례들이 검증한 값은 vpc-cni·coredns·ebs-csi가 **Overwrite**, kube-proxy만 **Preserve**다(kube-proxy에 None을 쓰면 실패 사례가 있었다). 이번 신규 클러스터는 in-place 마이너 체인이 아니라 create-addon 직행이라 대부분 Overwrite로 통일해도 되지만, kube-proxy는 관례를 존중해 Preserve를 유지한다.

## 4. ebs-csi IRSA 필수 — 최대 리스크

이 항목은 §2-4에서 이미 짚었지만, 신규 클러스터 부트스트랩 순서 전체를 좌우하는 blocking 항목이라 별도로 다시 강조한다. ebs-csi의 IAM 롤은 [Terraform 클러스터 생성과 설정]({{< relref "04-terraform-cluster-settings.md" >}})의 karpenter 인프라·OIDC 이중등록 작업과 같은 타이밍에 준비돼야 한다 — addon을 설치하는 시점에 IRSA 롤 ARN이 이미 존재하고 신규 OIDC로 바인딩까지 끝나 있어야, `--service-account-role-arn` 플래그가 의미를 가진다. 이 롤이 없는 채로 addon만 먼저 설치하면 "설치는 성공했는데 PVC가 하나도 안 붙는" 상태로 조용히 넘어가기 쉽다.

## 5. 부트스트랩 설치 순서 — vpc-cni 최우선

신규 클러스터는 in-place 마이너 체인(coredns v1.11→v1.12 경유, vpc-cni v1.7.0 경유 등)이 전부 불필요하다. 목표값 4종을 처음부터 직접 설치한다.

1. **(선행)** Terraform: OIDC/IRSA, ebs-csi 롤, vpc-cni CNI 정책, IMDS hop 2, Fargate 프로필.
2. **vpc-cni 최우선** — 노드/Fargate join 전에 반드시 먼저 설치해야 하는 유일한 hard 선행 의존. 없으면 노드가 Ready 상태로 올라오지 않는다.
3. **kube-proxy** — 버전 v1.35.x, Overwrite 대신 관례상 Preserve.
4. **coredns** — v1.14.x, `--configuration-values`로 config 필수 재전달(version-only 스펙에는 상속되지 않는다).
5. **aws-ebs-csi-driver** — `--service-account-role-arn` + `--configuration-values` 둘 다 명시.

이 순서는 [managed addon 4종 + cloudwatch 버전 diff]({{< relref "05-managed-addons.md" >}}) 표의 위→아래 순서가 아니라, "노드 없이도 뜨는 것 → 노드가 있어야 뜨는 것" 순서다. coredns·karpenter는 Fargate 위에서 노드 없이도 뜨고, 그 둘이 나머지 컴포넌트가 착지할 EC2 노드(karpenter system nodepool)를 만들어낸다. ebs-csi controller처럼 system 풀로 재타깃된 컴포넌트는 그 EC2 노드가 뜬 뒤에야 정상 스케줄된다.

## 6. 검증 체크

- `describe-addon`으로 4종 전부 `status: ACTIVE`, `addonVersion` 일치, `health.issues` 비어 있음을 확인한다.
- `kube-system` 네임스페이스에서 coredns(2/2 Ready, 목표 노드에 스케줄)·`aws-node`(전 노드)·`kube-proxy`(전 노드)·ebs-csi controller/node가 정상인지 확인한다.
- **coredns**: 테스트 파드에서 DNS 조회가 성공하고 `/ready`가 200을 반환하는지, 2개 replica가 2개 AZ에 분산돼(`DoNotSchedule` 위반 없이) 스케줄됐는지 확인한다.
- **vpc-cni**: 노드가 `Ready` 상태이고 신규 파드가 VPC IP를 정상 수신하는지 확인한다.
- **kube-proxy**: DaemonSet이 전 노드에 떠 있고 모드가 iptables인지 확인한다.
- **ebs-csi**: gp3 테스트 PVC를 생성해 `Bound` 상태가 되는지 확인한다(`UnauthorizedOperation`이 없다는 것이 IRSA 정상 wiring의 증거다).

## 우리 케이스에서는

네 addon 중 실제로 "일이 되는" 항목은 셋뿐이다 — coredns는 버전 라인이 이동하니 직행하면 되고, kube-proxy는 버전락이라 선택의 여지가 없으며, vpc-cni는 노드 join 전 최우선이라는 순서만 지키면 된다. 진짜 판단이 필요한 지점은 **ebs-csi 하나**다. 스펙에 IRSA 롤이 없다는 사실 자체가 눈에 잘 띄지 않기 때문에, [Terraform 페이지]({{< relref "04-terraform-cluster-settings.md" >}})의 karpenter 인프라·OIDC 작업과 함께 신규 클러스터 부트스트랩 체크리스트의 최상단에 놓아야 한다. 이번 이관은 Fargate 방향을 확정했으므로 coredns·ebs-csi의 config 값 자체도 arm64 전제에서 amd64(Fargate)·system 풀 전제로 다시 써야 한다는 점도, "버전만 올리면 끝"이라는 착각을 막는 지점이다.
