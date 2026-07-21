---
title: "EKS managed addon — 5종 버전·nftables 정정·ebs-csi 연결"
weight: 4
---

# EKS managed addon — 5종 버전·nftables 정정·ebs-csi 연결

{{< callout type="info" >}}
**한눈에**
- managed addon은 **버전 문자열만 diff**한다 — AWS가 차트를 관리하므로 워크로드 차트 리워크 대상이 아니다. 최종 eksbuild suffix는 **작업 당일 `describe-addon-versions --kubernetes-version 1.35`로 확정**한다.
- **coredns만 하드 blocking**(1.35는 v1.14.x 계열만 서빙). kube-proxy는 컨트롤플레인 버전락(v1.35.x), vpc-cni·ebs-csi는 version-agnostic이라 권장 사항이다.
- **ebs-csi는 IRSA 롤이 스펙에 없다** — 롤 자체는 [02 클러스터 설정]({{< relref "02-cluster-config.md" >}})에서 만들고, 여기서는 addon에 연결하고 PVC로 검증한다(최대 리스크).
- vpc-cni는 노드 join **전에 반드시 먼저** 설치해야 하는 유일한 hard 선행 의존이다.
{{< /callout >}}

클러스터 껍데기를 [02 클러스터 설정]({{< relref "02-cluster-config.md" >}})이 다뤘다면, 이 페이지는 그 위에 올라가는 **EKS managed addon 5종**(SSOT는 CAPI 스펙의 `addons[]` 4종 + 콘솔 설치 이력이 있는 amazon-cloudwatch-observability)의 버전과 성격을 다룬다. green은 in-place로 1.31까지 올라와 있지만 blue는 목표값으로 **직행 create**하므로 green의 현재 addon 값은 이관에 직접 쓰이지 않는다. 아래는 목표 1.35 기준이다.

## 1. 버전 diff (1.35 기준)

| addon | 목표(1.35) | 성격·변경 |
|---|---|---|
| **coredns** | **v1.14.3-eksbuild.3**(1.35=1.36 공용) | **필수 — 라인 자체가 이동**(v1.11.x→v1.14.x). create 직행 + config 재전달 |
| **kube-proxy** | **v1.35.3-eksbuild.13** | **필수 — 컨트롤플레인 버전락.** nftables는 opt-in, 기본 iptables라 동작 변화 없음(§3) |
| **vpc-cni** | 당일 describe(조사 시점 카탈로그 `v1.22.3-eksbuild.1`, k8s 1.30~1.36 공통) | 권장 — version-agnostic. 노드 join 전 최우선(hard 선행) |
| **aws-ebs-csi-driver** | 당일 describe(조사 시점 `v1.62.0-eksbuild.1`) | 권장 — version-agnostic. ⚠️ **IRSA 롤 필수인데 스펙에 없음**(§4). controller를 karpenter system 풀로 재타깃 + `arch=arm64` toleration → config 값은 [02]({{< relref "02-cluster-config.md" >}}) |
| **amazon-cloudwatch-observability** | 당일 describe(1.35) | 신규 클러스터에 **반드시 설치**(누락 시 관측 공백) + CloudWatch agent IRSA 필요 |

config 스키마는 신 버전에서도 제거·리네임된 키가 없어 그대로 유효하다. 단 Fargate 방향 때문에 **값 자체는 바뀐다**(coredns의 `computeType: Fargate`·affinity 제거, ebs-csi의 system 풀 재타깃) — 그 값 변경의 단일 소유는 [02 클러스터 설정]({{< relref "02-cluster-config.md" >}}) §5다.

## 2. 성격 구분 — coredns 하드blocking · kube-proxy 버전락 · vpc-cni/ebs-csi version-agnostic

네 addon은 업그레이드 압박의 성격이 전혀 다르다. 이 구분을 놓치면 "전부 최신으로 올리면 된다"는 단순화로 위험도를 오판한다.

- **coredns — 유일한 하드 blocking.** k8s 버전별 addon 카탈로그에서 coredns만 마이너 경계에서 서빙 라인이 완전히 바뀐다(1.30~1.32=v1.11.x / 1.33=v1.12.x / 1.34=v1.13.x / **1.35=1.36 공용=v1.14.3-eksbuild.3**). 즉 1.35 클러스터엔 v1.14.x가 최소이자 필수다. finance는 Corefile을 커스터마이즈하지 않고 replicaCount·affinity·tolerations·topologySpread만 설정하므로 업스트림 Corefile 파괴적 변경은 영향이 없다. 다만 finance는 `topologySpreadConstraints`를 `DoNotSchedule`로 override하고 있어 replicaCount 2 + maxSkew 1 조합에서 **대상 노드가 2 AZ에 각각** 있어야 두 번째 replica가 Pending되지 않는다. addon 업데이트가 PDB를 자동 배치하는데 기존 PDB가 있으면 실패할 수 있어 conflict resolution을 `overwrite`로 두는 편이 안전하다.
- **kube-proxy — 컨트롤플레인 버전락.** 컨트롤플레인 버전을 초과할 수 없고 최대 3마이너 뒤까지만 허용된다. 1.35 CP엔 v1.35.x가 필수라 신규 클러스터는 v1.35.3-eksbuild.13으로 직접 create한다. config가 없어 기본값으로 동작하므로 파괴적 config 변경은 해당 없음.
- **vpc-cni — version-agnostic, 기본 동작 불변.** config가 없어 기본 env 그대로 동작한다. 구간별 주요 변경(SDK v2 내부 마이그레이션, Multi-NIC opt-in, Network Policy Agent unix socket 이동)은 전부 opt-in이거나 finance 미사용 범위라 실질 영향이 없다. 단 vpc-cni는 `AmazonEKS_CNI_Policy`를 노드 롤 또는 IRSA로 요구하는데 finance는 스펙에 SA-Role이 없어, 신규 클러스터의 노드 롤/IRSA에 이 정책이 실제로 바인딩됐는지 확인이 필요하다.
- **ebs-csi — version-agnostic이지만 IRSA가 최대 리스크(§4).** controller의 affinity/tolerations/nodeSelector 스키마는 이 구간에서 변경이 없어 finance config가 그대로 유효하고, arm64(Graviton)는 완전 지원 대상이다.

## 3. kube-proxy nftables (정정)

2026-07-21 라이브 재확인 결과를 정정본으로 못박는다.

- **기본값은 여전히 iptables다.** upstream 1.35/1.36 모두 기본 프록시 모드는 iptables이고, nftables는 1.33에서 GA됐을 뿐 default 전환 계획이 없다 — 쓰려면 명시 설정해야 한다.
- **EKS kube-proxy managed addon도 기본값 iptables.** 다만 `configurationSchema`의 `mode` enum에 `nftables`가 addon **v1.31 계열부터** 포함됐다(1.30 계열엔 없다). 1.33~1.36 전 구간 최신 addon은 `mode` enum이 `["iptables","ipvs","nftables"]`로 확인된다(`aws eks describe-addon-configuration` 직접 확인).
- **활성화 절차**는 아래 한 줄이면 끝난다(별도 하위필드 없음. ipvs만 `scheduler` 하위필드를 갖는다).

  ```bash
  aws eks update-addon \
    --cluster-name $CLUSTER \
    --addon-name kube-proxy \
    --configuration-values '{"mode":"nftables"}' \
    --resolve-conflicts OVERWRITE
  ```

  신규 생성 시에는 `create-addon`에 동일한 `--configuration-values`를 넘긴다.
- **커널 요구사항**: 5.13+. AL2023은 6.x 커널이라 조건을 충족한다.
- **IPVS 서술 정정**: 1.35에서 deprecated된 것은 맞지만 **"1.36에서 제거"는 부정확**하다. 실제 코드 삭제는 KEP-5495 기준 **~v1.43** 예정이며(1.37 feature gate → 1.40 default off → 1.43 삭제), 1.35·1.36 어느 쪽에서도 IPVS는 deprecated 경고와 함께 여전히 동작한다. 즉 nftables 전환은 강제가 아니라 성능·권장 사유로 고르는 선택이다.
- **주의 두 가지**: AWS `best-practices/ipvs.html` 본문은 stale하다 — 상단 경고 박스(1.33 GA·1.35 deprecated 명시)만 신뢰한다. 그리고 **VPC CNI × nftables 상호작용은 1차 소스로 확인되지 않은 unknown 영역**이라, 전체 적용 전에 **카나리 노드로 먼저 검증**하는 것을 권장한다.

## 4. ebs-csi IRSA — addon 연결·PVC 검증

ebs-csi addon은 IAM 롤(`ebs-csi-controller-sa`)이 반드시 필요한데 finance 스펙에는 SA-Role이 없다. 미설정으로 두면 PVC 생성 시 `UnauthorizedOperation`이 떨어지며 동적 프로비저닝이 전면 실패한다. **롤 자체(IRSA 리소스 + `AmazonEBSCSIDriverPolicyV2`)를 만드는 것은 [02 클러스터 설정]({{< relref "02-cluster-config.md" >}}) §10의 소관**이고, 이 페이지는 그 롤을 addon에 **연결하고 검증**하는 두 가지를 다룬다.

- **연결**: create/update-addon 시 `--service-account-role-arn`에 신규 OIDC로 wiring된 IRSA 롤 ARN을 주입한다. 롤이 addon 설치 시점에 이미 존재하고 신규 OIDC로 바인딩까지 끝나 있어야 이 플래그가 의미를 가진다. 롤 없이 addon만 먼저 설치하면 "설치는 성공했는데 PVC가 하나도 안 붙는" 상태로 조용히 넘어간다.
- **검증**: gp3 테스트 PVC를 생성해 `Bound` 상태가 되는지 확인한다 — `UnauthorizedOperation`이 없다는 것이 IRSA 정상 wiring의 증거다. AL2023 노드의 IMDS hop limit이 2여야 하는 이유도 여기서 겹친다(IRSA 토큰 취득이 vpc-cni·ebs-csi 공통으로 이 홉 수에 의존).

## 5. config 재전달과 conflict resolution

managed addon 갱신에서 자주 놓치는 함정은 "버전만 올리면 config는 유지된다"는 가정이다. 이번 이관은 CAPA를 신뢰할 수 없는 SSOT로 판정했으므로([배경]({{< relref "00-background.md" >}})) create/update-addon CLI를 authoritative로 삼고 **config를 매번 명시 재전달**하는 것을 원칙으로 한다.

- **coredns**: `--configuration-values` 누락 시 affinity·tolerations·topologySpread가 미적용돼 대상 노드 밖으로 스케줄되거나 기본 PDB가 붙는다. 재전달은 옵션이 아니라 필수.
- **ebs-csi**: 마찬가지로 `--configuration-values`를 재전달해야 controller 노드 타깃팅이 유지된다.
- **conflict resolution 검증값**: 사내 이전 이관 사례들이 검증한 값은 vpc-cni·coredns·ebs-csi가 **Overwrite**, kube-proxy만 **Preserve**다(kube-proxy에 `None`을 쓰면 실패한 이력이 있다). 신규 클러스터는 create-addon 직행이라 대부분 Overwrite로 통일해도 되지만, kube-proxy는 관례를 존중해 Preserve를 유지한다.

## 6. 검증 체크

- `describe-addon`으로 5종 전부 `status: ACTIVE`, `addonVersion` 일치, `health.issues` 비어 있음 확인.
- `kube-system`에서 coredns(2/2 Ready, 2 AZ 분산·`DoNotSchedule` 위반 없음)·`aws-node`(전 노드)·`kube-proxy`(전 노드, 모드 iptables)·ebs-csi controller/node 정상 확인.
- **coredns**: 테스트 파드에서 DNS 조회 성공, `/ready` 200.
- **vpc-cni**: 노드 `Ready`, 신규 파드가 VPC IP 정상 수신.
- **ebs-csi**: gp3 테스트 PVC `Bound`(§4).

vpc-cni는 노드/Fargate join 전에 반드시 먼저 설치해야 하는 유일한 hard 선행 의존이다 — 없으면 노드가 Ready로 올라오지 않는다. 이 사실을 포함한 전체 설치 순서는 [04 부트스트랩]({{< relref "04-cluster-bootstrap.md" >}})이 다룬다.

## 우리 케이스에서는

다섯 addon 중 실제로 "판단이 필요한" 항목은 **ebs-csi 하나**다 — coredns는 라인이 이동하니 직행, kube-proxy는 버전락이라 선택의 여지가 없고, vpc-cni는 노드 join 전 최우선 순서만 지키면 된다. ebs-csi는 스펙에 IRSA 롤이 없다는 사실 자체가 눈에 잘 띄지 않아, [02]({{< relref "02-cluster-config.md" >}})의 롤 생성과 이 페이지의 연결·PVC 검증을 부트스트랩 체크리스트 최상단에 놓아야 한다.
