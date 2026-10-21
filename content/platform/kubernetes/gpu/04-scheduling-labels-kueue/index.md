---
title: "04 학습 잡을 가까운 노드에 모으려면 — 토폴로지 라벨과 Kueue TAS"
description: "분산 학습 잡을 가까운 노드에 모으려면 환경별 토폴로지 라벨을 Kueue TAS의 배치 제약에 연결한다. 2026-10-21 기준 코어 Kubernetes의 gang은 beta지만 기본 비활성이며, 토폴로지 인지 스케줄링은 alpha다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 4
url: "/kubernetes/gpu/04-scheduling-labels-kueue/"
---

# 04 · 학습 잡을 가까운 노드에 모으려면 — 토폴로지 라벨과 Kueue TAS

## 1. 학습 잡이 흩어질 때 생기는 비용

분산 학습 잡을 배치할 때는 GPU 수와 함께 노드 사이의 네트워크도 봐야 합니다. 파드 수십 개가 한 잡을 이룬다면, 이들이 어느 네트워크 경계를 넘어 통신하는지가 성능에 영향을 줍니다. [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}})에서 다룬 노드 안의 NVLink·PCIe 거리, [02편]({{< relref "/platform/kubernetes/gpu/02-allocation-device-plugin/index.md" >}})과 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에서 다룬 GPU 할당 다음에 풀어야 할 배치 문제입니다.

Meta의 SIGCOMM 2024 논문은 잡이 흩어졌을 때 어떤 비용이 생기는지 보여 줍니다. Meta의 백엔드 RoCE 망은 랙 스위치와 클러스터 스위치로 이루어진 2단 Clos 구조이며, 이 묶음을 AI Zone이라고 부릅니다. AI Zone 내부는 non-blocking이지만, LLM 규모가 커져 추가한 상위 집계 계층의 AI Zone 간 연결은 설계상 oversubscribed입니다. 논문에 따르면 학습 잡 스케줄러는 노드를 AI Zone으로 나눌 때 최소 컷(minimum cut)을 찾아 경계를 넘는 트래픽을 줄입니다. 서버의 논리적 위치를 학습해 rank 배정도 추천합니다.

랙을 통째로 할당하지 않고 일부만 쓸 때도 손실이 나왔습니다. 랙을 한 잡에 통째로 할당하지 않고 일부만 쓰면 특정 랙 스위치의 업링크에 트래픽이 몰렸고, 당시 path pinning(경로 고정) 라우팅에서는 학습 성능이 30% 넘게 떨어졌습니다. Meta가 택한 단기 대응은 업링크 대역을 두 배로 늘려 1:2 under-subscription을 만드는 것이었습니다. 배치 문제를 대역폭 증설로 보완한 비싼 해법입니다.

이 결과에서 성능을 가르는 요인은 홉 수 자체보다 oversubscribed 경계를 넘는 배치와 랙의 부분 할당입니다. 이 해석은 논문의 서술에서 이끌어 낸 추정입니다.

vClos 논문은 V100 테스트베드에서 ECMP 해시 충돌로 flow 네 개가 겹치면 학습 처리량이 최대 약 60% 줄었다고 보고합니다. 이 역시 공유 링크 경합의 효과이며, 홉 수만 바꿔 비교한 결과는 아닙니다. Koordinator 매뉴얼에는 spine에 흩어지면 학습 시간이 3~5배 늘 수 있다는 문장이 있으나 측정 조건과 출처가 없어 인용하지 않았습니다.

토폴로지를 실제로 설계하고 검증하는 일은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})과 [11편]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}})에서 이어집니다.

이 글은 AI가 조사 노트를 바탕으로 쓴 초안입니다. 노트에 없는 사실은 넣지 않았고, 확인하지 못한 것은 6절에 모았습니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-21이며 Kubernetes v1.37.1, Kueue v0.20.2, NVIDIA Topograph v1.0.0 문서를 봤습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 조사한 버전 | Kubernetes v1.37.1(2026-09-23), Kueue v0.20.2(2026-10-15), Topograph v1.0.0(2026-08-18) | 각 프로젝트 GitHub releases | `✓` |
| AI Zone 구조 | 랙 스위치 + 클러스터 스위치 2단 Clos, 내부 non-blocking, AI Zone 간은 설계상 oversubscribed | Meta SIGCOMM 2024 | `✓` |
| 스케줄러의 대응 | AI Zone 분할 시 minimum cut으로 cross-zone 트래픽을 줄이고 rank 배정을 추천 | Meta SIGCOMM 2024 | `✓` |
| 랙 부분 할당의 손실 | 학습 성능 최대 30% 넘게 저하. 랙 일부만 할당, path pinning 라우팅, 당시 업링크 대역 조건 | Meta SIGCOMM 2024 | `✓` |
| 단기 대응 | 업링크 대역 2배, 1:2 under-subscription | Meta SIGCOMM 2024 | `✓` |
| 성능 손실의 원인 해석 | 홉 수보다 oversubscribed 경계와 파편화 | Meta SIGCOMM 2024에서 이끌어 냄 | `≈` |
| ECMP 해시 충돌 | flow 4개 겹침 시 처리량 최대 약 60% 감소. V100 테스트베드, 공유 링크 경합 효과 | vClos 논문 | `≈` |
| spine 분산 시 3~5배 | 측정 조건·출처 없음. 본문에서 인용하지 않음 | Koordinator 매뉴얼 | `Ⓥ` |

{{% /details %}}

## 2. 가까운 노드의 범위를 라벨로 표현한다

스케줄러가 잡을 가까이 모으려면 노드가 속한 네트워크 계층을 읽을 수 있어야 합니다.

NVIDIA DGX SuperPOD GB200 참조 아키텍처는 각 컴퓨트 랙을 rail-aligned로 설명합니다. 같은 Scalable Unit(SU) 안에서 같은 rail의 트래픽은 leaf 한 홉 거리이고, 서로 다른 랙이나 다른 rail 사이는 spine을 지납니다. GB200 NVL72 같은 NVLink 도메인은 랙 하나 안의 scale-up 영역으로, 이 scale-out 패브릭 트리와 물리적으로 별개입니다. GB200 이후의 스케줄러는 어느 NVLink 도메인에 속하는지와 패브릭에서 얼마나 가까운지를 함께 다뤄야 합니다.

문서들을 종합하면 스케줄러가 읽을 계층은 "같은 leaf(랙이나 블록), 같은 spine 그룹(SU나 AI Zone), 그 위"라는 3~4단 트리로 축약할 수 있습니다. 클라우드는 이 계층을 2~4단 라벨로 노출합니다.

계층을 담을 키는 환경마다 다릅니다. 코어 Kubernetes가 정의한 토폴로지용 well-known 라벨은 `topology.kubernetes.io/region`과 `zone`뿐이며, 랙이나 블록용 표준 키는 없습니다. sig-network의 KEP-4962가 클러스터 네트워크 토폴로지 표현을 표준화하려 했지만 2026-05-08에 not_planned로 닫혔습니다.

그 결과 스케줄러들은 "임의 라벨 키의 목록이 곧 계층"이라는 방식으로 수렴한 것으로 보입니다. Kueue의 `Topology.levels`, KAI의 `Topology.levels`, 코어 WAS의 `topology[].key`와 Koordinator, Grove가 이 방식을 씁니다. Volcano만 별도의 트리 CRD를 씁니다.

아래 도식은 GKE의 네트워크 계층이 노드 라벨과 Kueue `levels`에 어떻게 대응하는지 보여 줍니다.

{{< flow src="_flow/2-계층과-라벨-대응.json" />}}

| 환경 | 라벨 키 | 누가 붙이나 |
|---|---|---|
| GKE | `cloud.google.com/gce-topology-block`, `-subblock`, `-host` | GKE 자동. Spot으로 띄우는 A4X·A4·A3 계열은 compact placement를 지정해야 노출 |
| EKS | `topology.k8s.aws/network-node-layer-1`~`-N`, `topology.k8s.aws/zone-id` | AWS cloud-controller-manager. 기본 대상은 p, trn, hpc 계열 인스턴스 |
| CoreWeave | `backend.coreweave.cloud/fabric`, `/leafgroup`, `/superpod`, `node.coreweave.cloud/rack`, `ds.coreweave.com/nvlink.domain` | CoreWeave 자동. 옛 `ib.coreweave.cloud/*`도 병존 |
| Nebius | `topology.nebius.com/gpu-cluster-id`, `/tier-0`, `/tier-1`, `/tier-2` | Nebius 자동 |
| 온프레미스 | `fabric.topograph.run/tier-N`, `accelerator.topograph.run/domain` | NVIDIA Topograph |

EKS에서는 인스턴스 하나에 network node가 3개 또는 4개 보입니다. 번호는 위에서 아래 순서로 매겨지며, 맨 아래 노드가 같을수록 가깝습니다. 지원하지 않는 리전이거나 권한이 없으면 AWS cloud-controller-manager(CCM)는 24시간 캐시로 백오프합니다.

`ultraserver-id` 라벨은 SageMaker HyperPod 문서와 llm-d 문서에서만 봤고 일반 EKS 공식 문서에서는 확인하지 못했습니다. Azure AKS의 라벨 키와 OCI OKE의 네이티브 라벨 키도 찾지 못했습니다.

NVLink 도메인만 알려 주는 벤더 중립 라벨도 있습니다. GPU Operator가 붙이는 `nvidia.com/gpu.clique`는 `<ClusterUUID>.<CliqueID>` 형식이며, Fabric Manager 초기화가 끝난 MNNVL 노드에만 붙습니다. 이 값으로 같은 NVLink 도메인인지는 알 수 있지만 랙 사이 근접성은 알 수 없습니다. IMEX와 ComputeDomain은 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에서 다뤘습니다.

온프레미스에서는 라벨을 채울 주체가 필요합니다. NVIDIA Topograph v1.0.0은 aws, gcp, oci, nebius 같은 클라우드 provider와 InfiniBand(`ibnetdiscover`), Spectrum-X(NetQ) provider를 지원합니다. 수집한 결과는 Kubernetes 노드 라벨, Slurm `topology.conf`, Slinky ConfigMap 같은 형태로 내보냅니다.

LLDP나 SR-IOV 기반의 범용 라벨러는 찾지 못했습니다. 실무 선택지는 UFM, NetQ, `ibnetdiscover` 중 하나에서 Topograph로 가거나, CMDB에서 수동으로 라벨을 붙이는 쪽으로 보입니다.

Topograph의 기본 패브릭 라벨은 `fabric.topograph.run/tier-N`이며, 0이 노드에 가장 가까운 스위치입니다. NVLink 도메인에는 `accelerator.topograph.run/domain`, `sub-domain`을 쓰고, 63자를 넘는 값은 해시로 바꿉니다. Koordinator 문서는 아직 옛 키인 `network.topology.nvidia.com/block`, `/spine`을 사용하므로 현재 Topograph의 키와 구분해야 합니다. 제공자 설정과 패브릭 구성은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})에서 이어 봅니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| rail-aligned 구조 | 같은 SU 같은 rail은 leaf 1홉, 랙·rail을 넘으면 spine 경유. SU는 DGX GB200 8대 | DGX SuperPOD GB200 참조 아키텍처 | `✓` |
| NVLink 도메인은 별도 패브릭 | 랙 하나 72 GPU full mesh, Compute InfiniBand와 별개 | DGX SuperPOD GB200 참조 아키텍처 | `✓` |
| 3~4단 트리로 축약 | 용어 정리 | 위 문서 종합 | `≈` |
| 표준 라벨 없음 | KEP-4962가 2026-05-08 not_planned(lifecycle/rotten)로 닫힘. 코어 well-known은 region·zone뿐 | KEP-4962 이슈 | `✓` |
| 스케줄러들이 라벨 목록 방식으로 수렴 | Kueue, KAI, 코어 WAS, Koordinator, Grove가 임의 키 목록. Volcano만 HyperNode | 각 프로젝트 문서 종합 | `≈` |
| GKE 라벨 | block·subblock·host. Spot A4X·A4·A3 Ultra·Mega·High는 compact placement 필요. 문서 최종 수정 2026-10-16 | GKE TAS 문서 | `✓` |
| A4X의 subblock이 NVL72 도메인 | llm-d 문서의 설명 | llm-d 문서 | `Ⓥ` |
| EKS 라벨 | CCM이 `DescribeInstanceTopology` 결과로 부여(2024-09 추가). 기본 정규식 `^(hpc\|trn\|p)[0-9]+...`. 24시간 캐시 백오프 | cloud-provider-aws 소스 | `✓` |
| EC2 network node | 인스턴스당 3개 또는 4개, 위에서 아래. Capacity Reservation은 1~3개 | EC2 문서 | `✓` |
| `ultraserver-id` | HyperPod CLI·llm-d 문서에서만 확인. 일반 EKS 공식 문서는 미확인 | HyperPod, llm-d | `≈` |
| CoreWeave 라벨 | `backend.*` 권장, 구 `ib.*` 병존 | CoreWeave 문서 | `✓` |
| Nebius 라벨 | gpu-cluster-id, tier-0(MNNVL), tier-1(rack 스위치), tier-2(spine) | Nebius 문서 | `✓` |
| AKS, OKE 네이티브 라벨 | 확인하지 못함 | — | `?` |
| `nvidia.com/gpu.clique` | `<ClusterUUID>.<CliqueID>`. `GPU_FABRIC_STATE_COMPLETED`인 MNNVL 노드에만. 랙 간 근접성은 없음 | Topograph 라벨 레퍼런스 | `✓` |
| Topograph 저장소 이전 | `NVIDIA/topograph`에서 `dsx-ai-factory/topograph`로 이동. 옛 링크는 리다이렉트 | GitHub releases | `✓` |
| Topograph | v1.0.0, provider·engine·기본 라벨 이름, 63자 초과 시 FNV-64a 해시 | Topograph 문서 | `✓` |
| Koordinator의 옛 키 | `network.topology.nvidia.com/block`, `/spine`은 Topograph v0.1.0 시절 이름 | Koordinator 매뉴얼 | `✓` |
| 실무 선택지 | UFM·NetQ·ibnetdiscover에서 Topograph, 또는 CMDB 수동 라벨. 범용 LLDP 라벨러는 못 찾음 | 위 자료 종합 | `≈` |

{{% /details %}}

## 3. Kueue에 잡을 얼마나 가까이 묶을지 지정한다

노드 라벨이 준비됐다면 Kueue에 계층을 정의하고, 워크로드에 허용할 배치 범위를 적을 수 있습니다. Kueue의 Topology Aware Scheduling(TAS, 토폴로지 인지 스케줄링)은 0.9(2024-11)에 alpha로 들어왔고, 0.14(2025-09)에서 beta가 되어 기본 활성화됐습니다. 2024년과 2025년 초의 글에 나오는 "alpha라서 feature gate가 필요하다"는 설명은 현재 상태와 다릅니다. 저장 API 버전은 0.16부터 `v1beta2`입니다.

`Topology`는 계층을 정의합니다. `ResourceFlavor`는 그 계층을 특정 노드 집합에 연결하는 리소스입니다.

```yaml
apiVersion: kueue.x-k8s.io/v1beta2
kind: Topology
metadata:
  name: default
spec:
  levels:                       # 위(굵은)에서 아래(가는) 순서, 1~16개
  - nodeLabel: "topology.kubernetes.io/zone"
  - nodeLabel: "cloud.provider.com/topology-block"
  - nodeLabel: "cloud.provider.com/topology-rack"
  - nodeLabel: "kubernetes.io/hostname"   # 쓰려면 반드시 맨 아래
---
apiVersion: kueue.x-k8s.io/v1beta2
kind: ResourceFlavor
metadata:
  name: tas-flavor
spec:
  nodeLabels:                   # topologyName을 쓰면 최소 1개 필수
    cloud.provider.com/node-group: "tas-group"
  topologyName: "default"       # 설정 뒤에는 nodeLabels·topologyName 변경 불가
```

레벨을 추가할 때는 노드 라벨을 먼저 붙이고 레벨은 나중에 넣어야 합니다. 모든 레벨 라벨이 있는 노드만 계산에 들어가기 때문입니다. `levels` 자체는 `kubernetes.io/hostname`이 최하위일 때만 바꿀 수 있습니다. 라벨 값은 레벨마다 전역 유일할 필요가 없어, 다른 block에서 같은 rack 이름을 써도 됩니다.

워크로드는 파드 템플릿 어노테이션으로 배치 요구를 전달합니다. 한 도메인에 반드시 모을지, 더 넓은 범위까지 허용할지, 일정 크기로 나눠 묶을지를 지정하는 방식입니다.

- `kueue.x-k8s.io/podset-required-topology` — 지정한 레벨의 도메인 하나에 모두 넣는다.
- `kueue.x-k8s.io/podset-preferred-topology` — 안 되면 한 단계씩 위로 올라가고, 최상위에서도 안 되면 여러 도메인에 나눠 admit한다.
- `kueue.x-k8s.io/podset-unconstrained-topology` — 토폴로지를 무시하고 남은 용량을 채운다.
- `kueue.x-k8s.io/podset-slice-required-topology`와 `podset-slice-size` — PodSet을 고정 크기 slice로 쪼개고 slice마다 도메인 하나를 쓴다.
- `kueue.x-k8s.io/podset-slice-required-topology-constraints` — slice를 최대 3층까지 겹쳐 적는다. 위 두 slice 어노테이션과 함께 쓸 수 없다.
- `kueue.x-k8s.io/podset-group-name` — leader와 worker 같은 여러 PodSet을 같은 도메인에 둔다.
- `kueue.x-k8s.io/podset-topology-spreading` — 추론 replica처럼 워크로드끼리는 흩는다. required와 함께 써야 한다.

예를 들어 JobSet을 block 하나 안에 두되 rack 단위로 4개씩 묶으려면, 전체 PodSet의 범위와 slice의 범위를 함께 지정합니다.

```yaml
template:
  metadata:
    annotations:
      kueue.x-k8s.io/podset-required-topology: "cloud.provider.com/topology-block"
      kueue.x-k8s.io/podset-slice-required-topology: "cloud.provider.com/topology-rack"
      kueue.x-k8s.io/podset-slice-size: "4"
```

아래 도식은 Kueue가 워크로드의 요구를 읽고 배치할 도메인을 고르는 순서를 보여 줍니다.

{{< flow src="_flow/5-kueue가-도메인을-고르는-순서.json" />}}

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| TAS 성숙도 | 0.9 alpha(2024-11-05), 0.14 beta·기본 활성(2025-09-30), 0.16부터 `v1beta2` 저장 | Kueue 릴리스 노트 | `✓` |
| Topology·ResourceFlavor 규칙 | levels 1~16개, hostname은 최하위, 설정 후 변경 불가 항목, 라벨 먼저·레벨 나중, 값 유일성 불필요 | Kueue TAS 개념 문서(v0.20.2) | `✓` |
| 어노테이션 | required, preferred, unconstrained, slice, slice constraints(최대 3층), group-name, topology-spreading | 같은 문서 | `✓` |

{{% /details %}}

## 4. 배치 제약을 정한 뒤에는 용량과 장애 처리를 본다

다음 제약이 있습니다. 앞의 셋은 Kueue TAS 문서의 설명이고 4번은 문서를 종합한 추정입니다.

1. 용량을 직접 추적합니다. Ready이고 스케줄 가능한 노드의 allocatable에서 다른 TAS 워크로드와 DaemonSet 같은 비-TAS 파드의 사용량을 뺍니다. 모든 Pod와 Node를 추적해야 하므로 메모리 사용량 증가와 스케줄 지연이 생긴다고 문서에 명시돼 있습니다.
2. 오토스케일에는 정해진 순서가 있습니다. quota를 예약하고, Provisioning AdmissionCheck로 노드를 확보한 뒤 토폴로지를 할당합니다. 새 노드가 붙은 다음에 배치를 계산하는 방식입니다.
3. 최하위 레벨이 hostname이면 Kueue가 파드와 노드의 대응을 고정하고 nodeSelector를 주입합니다. 해당 노드가 죽으면 파드는 같은 자리에만 갈 수 있으므로 hot swap(장애 노드 교체)이 필요합니다. 기본 동작은 단일 노드 장애만 교체하며, 여러 노드가 죽으면 evict합니다. 블록 전체를 쓰는 워크로드는 교체할 수 없어, 문서는 FailFast나 `waitForPodsReady.recoveryTimeout`을 권합니다.
4. 실제 바인딩은 kube-scheduler가 담당합니다. 문서 설명을 종합하면 Kueue는 admission 시점에 배치를 계산해 파드에 주입하고, preemption도 quota와 admission 수준에서 처리하는 것으로 보입니다. 이는 추정입니다.

이 동작은 버전별로 확장됐습니다. 0.11에는 ClusterQueue와 cohort 안의 preemption, 0.12에는 ProvisioningRequest 연동과 노드 교체가 들어왔습니다. 0.15는 Kubeflow TrainJob과 MultiKueue를 지원했고, 0.19에서는 다층 slice가 beta로 올라갔습니다. 0.20(2026-09-30)에 추가된 여러 노드 장애의 점진 교체, DRA 장치 가능성 검사, Topology Spreading은 alpha입니다.

0.20.2 기준으로 `TopologyAwareScheduling`, `TASMultiLayerTopology`, `TASGroupedPodSetSlicing`, 노드 교체 계열 gate는 beta로 기본 활성입니다. `TASBalancedPlacement`, `TASTopologySpreading`, `KueueDRADeviceFeasibility`, `TASReplaceMultipleFailedNodes`는 alpha이며 기본 비활성입니다.

다층 slice의 상태는 문서끼리도 다르게 적혀 있습니다. tasks/run 페이지는 `TASMultiLayerTopology`를 아직 alpha로 설명하지만, 개념 페이지와 0.19 릴리스 노트는 beta로 명시합니다. 이 항목은 릴리스 노트의 상태를 따르는 편이 맞습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 용량 계산과 추적 비용 | allocatable − 다른 TAS 워크로드 − 비-TAS 파드. 메모리·지연 단점을 문서가 명시 | Kueue TAS 개념 문서 | `✓` |
| 오토스케일 순서 | quota 예약, admission check, 토폴로지 할당 | 같은 문서 | `✓` |
| hostname 고정과 hot swap | nodeSelector 주입, 단일 노드 교체가 기본, 블록 전체 워크로드는 교체 불가 | 같은 문서 | `✓` |
| Kueue preemption 수준 | quota·admission 수준이고 바인딩은 kube-scheduler | 문서 설명 종합 | `≈` |
| 기능 연표 | 0.11 preemption, 0.12 ProvisioningRequest·노드 교체, 0.15 TrainJob·MultiKueue, 0.19 다층 slice beta, 0.20 다중 노드 장애·DRA 검사·Spreading alpha | Kueue 릴리스 노트 | `✓` |
| feature gate 상태 | v0.20.2 기준 beta·alpha 분류 | Kueue 문서(v0.20.2) | `✓` |
| gate 문서 불일치 | tasks/run은 alpha, concepts·0.19 릴리스 노트는 beta | 같은 자료 | `✓` |

{{% /details %}}

## 5. 코어 Kubernetes는 어디까지 맡을 수 있나

코어 Kubernetes에도 gang(파드를 그룹으로 묶어 스케줄링하는 기능)이 들어왔습니다. Workload-Aware Scheduling 작업 그룹이 만든 Workload와 PodGroup API, KEP-4671은 1.35에서 alpha로 시작해 1.37에서 beta가 됐습니다. beta여도 `GenericWorkload` feature gate는 기본 비활성이므로 사용하려면 켜야 합니다.

토폴로지 인지 워크로드 스케줄링인 KEP-5732는 1.37에서도 alpha입니다. gate 이름은 `TopologyAwareWorkloadScheduling`입니다. 1.36에서는 PodGroup에 토폴로지 제약을 걸면 후보 배치를 만들고 점수를 매겼으며, 이 과정에서 preemption은 일어나지 않았습니다. 1.37은 여러 계층을 위에서 아래로 해석하고 단일 레벨 성능을 개선했습니다. PodGroup도 스케줄링 큐의 1급 객체가 되어, 멤버 파드를 개별로 큐잉하던 방식에서 PodGroup 단위 큐잉으로 바뀌었습니다.

1.37 기준 관련 항목은 다음과 같습니다.

| KEP·기능 | 내용 | 1.37 상태 |
|---|---|---|
| KEP-4671 | Workload, PodGroup, gang | Beta, 기본 비활성 |
| KEP-5710 | Workload 인지 preemption | Beta |
| KEP-5732 | 토폴로지 인지 스케줄링 | Alpha |
| CompositePodGroup | 계층형 gang과 다단 토폴로지 | Alpha |
| KEP-5547 | Job 컨트롤러 통합 | Alpha |
| KEP-5729 | PodGroup 단위 공유 DRA ResourceClaim | Beta |

Job에 gang과 토폴로지를 직접 지정하는 형태도 나왔습니다. 다음은 1.37 블로그의 예시를 줄인 것으로, alpha 기능입니다.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: distributed-training-job
spec:
  parallelism: 8
  completions: 8
  scheduling:
    schedulingPolicy:
      gang: {}              # minCount 생략 시 parallelism
    schedulingConstraints:
      topology:
      - key: topology.kubernetes.io/zone
    disruptionMode:
      all: {}
  template: ...
```

Kubernetes v1.37 WAS 블로그는 1.38에서 Workload와 PodGroup을 GA로, 토폴로지와 CompositePodGroup을 beta로 올리고 JobSet을 통합할 계획이라고 밝힙니다. 장기적으로 Kueue가 이 API를 gang과 TAS 엔진으로 활용하는 방향도 제시했습니다. 이는 계획이므로 일정은 바뀔 수 있습니다.

현재 코어만으로 노드 간 토폴로지 배치를 운영하기에는 아직 이른 단계이며, 대부분의 구성은 애드온 스케줄러에 배치를 맡깁니다. Volcano, KAI Scheduler, Slurm과 공존 방식은 [05편]({{< relref "/platform/kubernetes/gpu/05-scheduling-volcano-kai-slurm/index.md" >}})에서 이어집니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Workload/PodGroup gang | 1.35 alpha, 1.37 beta(`scheduling.k8s.io/v1beta1`), 기본 비활성, gate `GenericWorkload` | Kubernetes v1.37 WAS 블로그 | `✓` |
| KEP-5732 | 1.37 alpha, gate `TopologyAwareWorkloadScheduling` | 같은 블로그 | `✓` |
| 1.36 TAS 방식 | PodGroup 제약, PlacementGenerate, 점수. preemption 미발생 | 1.36 WAS 블로그 | `✓` |
| 1.37 변경 | 다단 top-down 해석, 단일 레벨 성능 개선, PodGroup 1급 큐잉, `minCount` mutable | 1.37 WAS 블로그 | `✓` |
| 기타 KEP 상태 | KEP-5710 beta, CompositePodGroup alpha(`v1alpha3`), KEP-5547 alpha(`WorkloadWithJob`), KEP-5729 beta | 같은 블로그 | `✓` |
| 1.38 계획 | Workload·PodGroup GA, TAS·CompositePodGroup beta, JobSet 통합, 장기적으로 Kueue가 WAS 활용 | 같은 블로그 | `Ⓥ` |

{{% /details %}}

## 6. 확인하지 못한 것

- 같은 조건에서 "같은 leaf와 spine 경유"만 바꾼 NCCL all-reduce나 학습 처리량의 공개 측정. Meta의 30%와 vClos의 60%는 각각 파편화와 경합의 효과라서 홉 수 효과를 분리하지 않습니다.
- Google, NVIDIA, AWS가 TAS 적용 전후를 수치로 공개한 자료.
- Azure AKS와 OCI OKE의 네이티브 토폴로지 라벨 키.
- `topology.k8s.aws/ultraserver-id`를 HyperPod 밖의 일반 EKS가 붙이는지.
- KubeCon Japan 2026의 Kueue 토폴로지 발표 내용. 제목과 초록만 확인했습니다.

## 참고 자료

- [Kubernetes v1.37 — Workload-Aware Scheduling](https://kubernetes.io/blog/2026/09/08/kubernetes-v1-37-advancing-workload-aware-scheduling/)
- [Kubernetes v1.36 WAS 블로그 원문](https://github.com/kubernetes/website/blob/main/content/en/blog/_posts/2026/workload-aware-scheduling-1-36.md)
- [KEP-4962 (not_planned)](https://github.com/kubernetes/enhancements/issues/4962)
- [KEP-4671](https://kep.k8s.io/4671) · [KEP-5732](https://kep.k8s.io/5732) · [KEP-5710](https://kep.k8s.io/5710) · [KEP-5729](https://kep.k8s.io/5729) · [KEP-5547](https://kep.k8s.io/5547)
- [Kueue — Topology Aware Scheduling (v0.20.2)](https://github.com/kubernetes-sigs/kueue/blob/v0.20.2/site/content/en/docs/concepts/topology_aware_scheduling.md)
- [Kueue — Topology (v0.20.2)](https://github.com/kubernetes-sigs/kueue/blob/v0.20.2/site/content/en/docs/concepts/topology.md)
- [Kueue — JobSet TAS 예시](https://github.com/kubernetes-sigs/kueue/blob/v0.20.2/site/static/examples/jobs/sample-jobset-tas-combined.yaml)
- [Kueue — 릴리스](https://github.com/kubernetes-sigs/kueue/releases)
- [NVIDIA Topograph](https://github.com/dsx-ai-factory/topograph) · [노드 라벨 레퍼런스](https://github.com/dsx-ai-factory/topograph/blob/main/docs/reference/node-labels.md)
- [GKE — TAS 워크로드 스케줄링](https://docs.cloud.google.com/ai-hypercomputer/docs/workloads/schedule-gke-workloads-tas)
- [AWS — EC2 인스턴스 토폴로지](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/how-ec2-instance-topology-works.html)
- [cloud-provider-aws — 라벨 소스](https://github.com/kubernetes/cloud-provider-aws/blob/master/pkg/providers/v1/well_known_labels.go) · [topology.go](https://github.com/kubernetes/cloud-provider-aws/blob/master/pkg/providers/v1/topology.go)
- [CoreWeave — InfiniBand·RoCE 라벨](https://docs.coreweave.com/products/networking/hpc-interconnect/infiniband-roce-labels)
- [Nebius — TAS](https://docs.nebius.com/kubernetes/gpu/topology-aware-scheduling)
- [llm-d — DisaggregatedSet](https://github.com/llm-d/llm-d/blob/main/docs/operations/disaggregation/disaggregatedset.md)
- [Meta — SIGCOMM 2024 RoCE 백엔드 논문](https://engineering.fb.com/wp-content/uploads/2024/08/sigcomm24-final246.pdf)
- [NVIDIA DGX SuperPOD GB200 — 네트워크 패브릭](https://docs.nvidia.com/dgx-superpod/reference-architecture-scalable-infrastructure-gb200/latest/network-fabrics.html)
- [vClos](https://jhc.sjtu.edu.cn/~shizhenzhao/vclos_tech.pdf)
- [Koordinator — 네트워크 토폴로지 인지 스케줄링](https://github.com/koordinator-sh/koordinator.sh/blob/main/docs/user-manuals/network-topology-aware-scheduling.md)
