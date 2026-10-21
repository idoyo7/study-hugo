---
title: "04 학습 잡을 가까운 노드에 모으려면 — 토폴로지 라벨과 Kueue TAS"
description: "분산 학습 잡을 가까운 노드에 모으려면 환경별 토폴로지 라벨을 Kueue TAS의 배치 제약에 연결한다. 2026-10-21 기준 코어 Kubernetes의 gang은 beta지만 기본 비활성이며, 토폴로지 인지 스케줄링은 alpha다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 4
url: "/kubernetes/gpu/04-scheduling-labels-kueue/"
---

# 04 · 학습 잡을 가까운 노드에 모으려면

## 노드 사이에서 어떤 경계를 넘는지가 중요합니다 {#1-학습-잡이-흩어질-때-생기는-비용}

분산 학습 잡이 GPU를 충분히 확보했어도 파드들이 혼잡한 링크를 사이에 두고 흩어지면 성능이 떨어질 수 있습니다. [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}})의 노드 안 NVLink·PCIe 경로와 [02편]({{< relref "/platform/kubernetes/gpu/02-allocation-device-plugin/index.md" >}})·[03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})의 GPU 할당을 확인한 뒤에는, 한 잡의 파드들이 노드 사이에서 어느 네트워크 경계를 넘는지 살펴야 합니다.

Meta의 SIGCOMM 2024 논문은 이 문제를 망 구조와 함께 설명합니다. Meta의 RoCE 백엔드는 랙 스위치와 클러스터 스위치로 구성된 2단 Clos 묶음을 AI Zone이라고 부릅니다. AI Zone 내부는 non-blocking이지만, LLM 규모가 커지면서 추가한 상위 집계 계층의 Zone 간 연결은 설계상 oversubscribed입니다. 스케줄러는 노드를 AI Zone으로 나눌 때 최소 컷(minimum cut)을 찾아 경계를 넘는 트래픽을 줄이고, 서버의 논리적 위치를 학습해 rank 배정도 추천합니다.

같은 논문에서 랙을 한 잡에 통째로 할당하지 않고 일부만 사용하자 특정 랙 스위치 업링크로 트래픽이 몰렸습니다. 당시 path pinning(경로 고정) 라우팅과 업링크 대역 조건에서는 학습 성능이 30% 넘게 떨어졌습니다. Meta는 단기 대응으로 업링크 대역을 두 배로 늘려 1:2 under-subscription을 만들었습니다. 배치를 바꾸는 대신 대역폭을 증설해 병목을 보완한 사례입니다.

이 결과는 홉 수 하나를 줄였을 때의 효과로 읽기 어렵습니다. oversubscribed 경계를 넘는 배치와 랙의 부분 할당이 손실에 영향을 줬다는 해석이 논문의 조건에 더 가깝습니다. vClos 논문도 V100 테스트베드에서 ECMP 해시 충돌로 flow 네 개가 겹쳤을 때 처리량이 최대 약 60% 감소했다고 보고합니다. 이 수치 역시 공유 링크 경합의 효과이며 홉 수만 비교한 결과는 아닙니다.

Koordinator 매뉴얼에는 spine에 흩어지면 학습 시간이 3~5배 늘 수 있다는 주장이 있지만 측정 조건과 출처를 찾지 못했습니다. 따라서 배치 효과의 정량 근거로 사용하지 않았습니다. 실제 패브릭 설계와 검증은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})과 [11편]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}})에서 다룹니다.

## 배치에 쓸 거리를 노드 라벨로 표현합니다 {#2-가까운-노드의-범위를-라벨로-표현한다}

스케줄러가 파드를 가까이 모으려면 어떤 노드들이 같은 네트워크 계층에 속하는지 알아야 합니다. NVIDIA DGX SuperPOD GB200 참조 아키텍처의 컴퓨트 랙은 rail-aligned 구성입니다. DGX GB200 8대로 이뤄진 Scalable Unit(SU) 안에서 같은 rail의 트래픽은 leaf 한 홉 거리이며, 랙이나 rail을 넘으면 spine을 지납니다.

GB200 NVL72의 NVLink 도메인은 이 Compute InfiniBand 패브릭과 물리적으로 별개입니다. 랙 하나의 72 GPU를 full mesh로 묶는 scale-up 영역이므로, 스케줄러는 NVLink 도메인과 scale-out 패브릭의 근접성을 구분해야 합니다. 자료를 종합하면 후자는 같은 leaf(랙·블록), 같은 spine 그룹(SU·AI Zone), 그 위의 계층으로 이루어진 3~4단 트리로 표현할 수 있습니다. 클라우드가 공개하는 라벨은 2~4단입니다.

이 계층의 라벨 키는 표준화돼 있지 않습니다. Kubernetes의 토폴로지용 well-known 키는 `topology.kubernetes.io/region`과 `zone`뿐이며 랙·블록용 키는 없습니다. 이를 표준화하려던 sig-network의 KEP-4962는 2026-05-08에 not_planned로 닫혔고 lifecycle/rotten으로 표시됐습니다.

Kueue와 KAI의 `Topology.levels`, 코어 WAS의 `topology[].key`, Koordinator와 Grove는 관리자가 지정한 라벨 키 목록으로 계층을 읽습니다. 프로젝트 문서를 종합하면 임의의 라벨 목록을 사용하는 방식으로 수렴한 것으로 보입니다. Volcano는 별도 HyperNode 트리 CRD를 사용합니다. 다음 도식은 GKE 계층과 라벨을 Kueue의 `levels`에 연결하는 예입니다.

{{< flow src="_flow/2-계층과-라벨-대응.json" />}}

| 환경 | 라벨 키 | 누가 붙이나 |
|---|---|---|
| GKE | `cloud.google.com/gce-topology-block`, `-subblock`, `-host` | GKE 자동. Spot으로 띄우는 A4X·A4·A3 계열은 compact placement를 지정해야 노출 |
| EKS | `topology.k8s.aws/network-node-layer-1`~`-N`, `topology.k8s.aws/zone-id` | AWS cloud-controller-manager. 기본 대상은 p, trn, hpc 계열 인스턴스 |
| CoreWeave | `backend.coreweave.cloud/fabric`, `/leafgroup`, `/superpod`, `node.coreweave.cloud/rack`, `ds.coreweave.com/nvlink.domain` | CoreWeave 자동. 옛 `ib.coreweave.cloud/*`도 병존 |
| Nebius | `topology.nebius.com/gpu-cluster-id`, `/tier-0`, `/tier-1`, `/tier-2` | Nebius 자동 |
| 온프레미스 | `fabric.topograph.run/tier-N`, `accelerator.topograph.run/domain` | NVIDIA Topograph |

GKE 문서(2026-10-16 갱신)는 Spot A4X·A4·A3 Ultra·Mega·High에서 compact placement를 지정해야 라벨이 노출된다고 설명합니다. A4X의 subblock이 NVL72 도메인에 해당한다는 설명은 llm-d 문서에서 확인한 것으로, GKE 문서의 직접 서술과는 구분해야 합니다.

EKS의 AWS cloud-controller-manager(CCM)는 `DescribeInstanceTopology` 결과로 라벨을 붙입니다. 이 경로는 2024-09에 추가됐으며 기본 대상 정규식은 `^(hpc|trn|p)[0-9]+...`입니다. EC2 인스턴스에는 network node가 3개 또는 4개 표시되고 Capacity Reservation에는 1~3개가 표시됩니다. 번호는 위에서 아래로 매겨지므로 최하위 network node가 같을수록 가깝습니다. 지원하지 않는 리전이거나 권한이 없으면 CCM은 24시간 캐시로 백오프합니다.

`topology.k8s.aws/ultraserver-id`는 SageMaker HyperPod CLI 문서와 llm-d에서만 확인했습니다. 일반 EKS가 붙이는지는 확인하지 못했습니다. Azure AKS와 OCI OKE의 네이티브 라벨 키도 찾지 못했습니다. CoreWeave는 `backend.*` 키를 권장하지만 구 `ib.*` 키도 함께 남아 있습니다. Nebius는 tier-0을 MNNVL, tier-1을 rack 스위치, tier-2를 spine으로 설명합니다.

GPU Operator가 붙이는 벤더 중립 라벨 `nvidia.com/gpu.clique`는 `<ClusterUUID>.<CliqueID>` 형식입니다. Topograph 라벨 레퍼런스에 따르면 Fabric Manager 초기화가 끝나 `GPU_FABRIC_STATE_COMPLETED`인 MNNVL 노드에만 붙습니다. 같은 NVLink 도메인을 식별할 수 있지만 랙 사이의 근접성까지 알려 주지는 않습니다. IMEX와 ComputeDomain의 사용은 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에 설명했습니다.

온프레미스에서는 라벨을 수집하고 갱신할 주체도 마련해야 합니다. NVIDIA Topograph v1.0.0은 aws·gcp·oci·nebius 등의 클라우드 provider와 InfiniBand의 `ibnetdiscover`, Spectrum-X의 NetQ provider를 지원합니다. 결과는 Kubernetes 노드 라벨, Slurm `topology.conf`, Slinky ConfigMap으로 내보낼 수 있습니다. 저장소는 `NVIDIA/topograph`에서 `dsx-ai-factory/topograph`로 옮겼으며 기존 링크는 리다이렉트됩니다.

Topograph의 기본 패브릭 키는 `fabric.topograph.run/tier-N`이고 0이 노드에 가장 가까운 스위치입니다. NVLink 도메인에는 `accelerator.topograph.run/domain`과 `sub-domain`을 사용하며, 값이 63자를 넘으면 FNV-64a 해시로 바꿉니다. Koordinator 매뉴얼의 `network.topology.nvidia.com/block`·`/spine`은 Topograph v0.1.0 시절 키이므로 현재 키와 구분해야 합니다.

LLDP나 SR-IOV를 이용하는 범용 라벨러는 찾지 못했습니다. 확인한 자료로는 UFM·NetQ·`ibnetdiscover`의 정보를 Topograph로 전달하거나 CMDB를 바탕으로 수동 라벨을 붙이는 방법을 검토할 수 있습니다. 이는 자료를 종합한 선택지이며, 제공자 측 구성은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})에서 이어집니다.

## Kueue에 계층과 허용 배치 범위를 지정합니다 {#3-kueue에-잡을-얼마나-가까이-묶을지-지정한다}

노드 라벨이 준비되면 Kueue의 Topology Aware Scheduling(TAS)에서 배치 제약으로 사용할 수 있습니다. TAS는 0.9(2024-11-05)에 alpha로 도입됐고 0.14(2025-09-30)에서 beta와 기본 활성 상태가 됐습니다. 2024년이나 2025년 초 자료의 “alpha이므로 feature gate를 켜야 한다”는 설명은 조사 시점의 상태와 다릅니다. 0.16부터 저장 API는 `v1beta2`입니다.

`Topology`에는 위에서 아래 순서로 계층을 정의하고, `ResourceFlavor`에서 특정 노드 집합과 그 계층을 연결합니다.

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

레벨은 1~16개를 정의할 수 있으며 `kubernetes.io/hostname`을 사용하면 최하위에 둬야 합니다. `topologyName`을 지정한 ResourceFlavor는 `nodeLabels`가 최소 하나 필요하고, 설정 후에는 `nodeLabels`와 `topologyName`을 바꿀 수 없습니다. `levels`는 hostname이 최하위일 때만 변경할 수 있습니다.

레벨을 추가할 때는 노드 라벨부터 붙여야 합니다. 모든 레벨의 라벨을 가진 노드만 TAS 용량 계산에 들어가므로, 레벨부터 추가하면 라벨이 빠진 노드를 계산에서 제외하게 됩니다. 라벨 값은 레벨마다 전역 유일할 필요가 없어 서로 다른 block에 같은 rack 이름을 써도 됩니다.

워크로드는 파드 템플릿 어노테이션으로 모일 범위를 정합니다.

| 어노테이션 | 배치 요구 |
|---|---|
| `kueue.x-k8s.io/podset-required-topology` | 지정한 레벨의 도메인 하나에 모두 배치 |
| `kueue.x-k8s.io/podset-preferred-topology` | 해당 레벨에 들어가지 않으면 한 단계씩 위로 확대. 최상위에서도 안 되면 여러 도메인에 나누어 admit |
| `kueue.x-k8s.io/podset-unconstrained-topology` | 토폴로지 제약 없이 남은 용량 사용 |
| `kueue.x-k8s.io/podset-slice-required-topology`와 `podset-slice-size` | PodSet을 고정 크기 slice로 나누고 각 slice를 도메인 하나에 배치 |
| `kueue.x-k8s.io/podset-slice-required-topology-constraints` | slice를 최대 3층으로 정의. 앞의 두 slice 어노테이션과 함께 사용할 수 없음 |
| `kueue.x-k8s.io/podset-group-name` | leader와 worker 등 여러 PodSet을 같은 도메인에 배치 |
| `kueue.x-k8s.io/podset-topology-spreading` | 추론 replica 등 워크로드 사이를 분산. required와 함께 사용 |

예를 들어 JobSet 전체는 block 하나에 두면서 rack마다 4개씩 묶으려면 전체 PodSet과 slice의 범위를 함께 지정합니다.

```yaml
template:
  metadata:
    annotations:
      kueue.x-k8s.io/podset-required-topology: "cloud.provider.com/topology-block"
      kueue.x-k8s.io/podset-slice-required-topology: "cloud.provider.com/topology-rack"
      kueue.x-k8s.io/podset-slice-size: "4"
```

다음 도식은 Kueue가 요청에 맞는 도메인을 선택하는 과정을 보여 줍니다.

{{< flow src="_flow/5-kueue가-도메인을-고르는-순서.json" />}}

## 용량 계산과 노드 장애까지 배치 정책에 포함합니다 {#4-배치-제약을-정한-뒤에는-용량과-장애-처리를-본다}

TAS는 Ready이고 스케줄 가능한 노드의 allocatable에서 다른 TAS 워크로드와 DaemonSet 등 비-TAS 파드의 사용량을 빼 용량을 계산합니다. 모든 Pod와 Node를 추적하므로 메모리 사용량과 스케줄 지연이 늘어난다는 점도 Kueue 개념 문서에 명시돼 있습니다.

오토스케일이 필요한 워크로드는 quota를 예약하고 Provisioning AdmissionCheck로 노드를 확보한 뒤 토폴로지를 할당합니다. 새 노드가 실제로 추가된 다음 배치를 계산하는 순서입니다. 문서를 종합하면 Kueue는 admission 시점의 배치를 파드에 주입하고 quota·admission 수준에서 preemption을 처리하며, 실제 바인딩은 kube-scheduler가 맡는 것으로 해석됩니다.

최하위 레벨을 hostname으로 지정하면 Kueue가 파드와 노드의 대응을 고정해 nodeSelector를 주입합니다. 노드가 죽어도 파드는 지정된 곳에만 배치될 수 있으므로 hot swap(장애 노드 교체)이 필요합니다. 기본 동작은 단일 노드 장애만 교체하며, 여러 노드가 죽으면 워크로드를 evict합니다. 블록 전체를 점유하는 워크로드는 교체할 수 없어 문서는 FailFast 또는 `waitForPodsReady.recoveryTimeout`을 권합니다.

관련 기능의 도입 시점과 v0.20.2 상태는 함께 읽어야 합니다.

| 버전 | 추가·변경된 기능 |
|---|---|
| 0.11 | ClusterQueue·cohort 안의 preemption |
| 0.12 | ProvisioningRequest 연동, 노드 교체 |
| 0.15 | Kubeflow TrainJob TAS, MultiKueue 지원 |
| 0.19 | 다층 slice beta |
| 0.20(2026-09-30) | 여러 노드 장애의 점진 교체, DRA 장치 가능성 검사, Topology Spreading을 alpha로 추가 |

v0.20.2에서 `TopologyAwareScheduling`, `TASMultiLayerTopology`, `TASGroupedPodSetSlicing`, 노드 교체 계열 gate는 beta이며 기본 활성입니다. `TASBalancedPlacement`, `TASTopologySpreading`, `KueueDRADeviceFeasibility`, `TASReplaceMultipleFailedNodes`는 alpha이며 기본 비활성입니다. 따라서 다중 장애 교체나 spreading을 기존 TAS와 같은 기본 기능으로 가정해서는 안 됩니다.

다층 slice에 관한 문서 표기도 다릅니다. tasks/run 페이지는 `TASMultiLayerTopology`를 alpha로 설명하지만 개념 페이지와 0.19 릴리스 노트는 beta로 명시합니다. 이 글은 릴리스 노트의 상태를 따릅니다.

## 코어 Kubernetes의 gang과 토폴로지 기능은 단계가 다릅니다 {#5-코어-kubernetes는-어디까지-맡을-수-있나}

코어 Kubernetes의 Workload와 PodGroup API도 파드를 그룹으로 묶어 스케줄링하는 gang을 지원합니다. Workload-Aware Scheduling(WAS) 작업 그룹의 KEP-4671은 1.35에서 alpha로 시작해 1.37에서 `scheduling.k8s.io/v1beta1` beta가 됐습니다. `GenericWorkload` 게이트는 여전히 기본 비활성이므로 사용하려면 직접 켜야 합니다.

토폴로지 인지 워크로드 스케줄링인 KEP-5732와 `TopologyAwareWorkloadScheduling` 게이트는 1.37에서도 alpha입니다. 1.36 구현은 PodGroup의 토폴로지 제약에 따라 PlacementGenerate로 후보를 만들고 점수를 매겼으며 이 과정에서는 preemption이 일어나지 않았습니다. 1.37은 여러 계층을 위에서 아래로 해석하고 단일 레벨 성능을 개선했습니다. 개별 멤버 파드를 큐에 넣던 방식도 PodGroup 자체를 큐잉하는 방식으로 바뀌었고, `minCount`는 변경할 수 있게 됐습니다.

| KEP·기능 | 내용 | 1.37 상태 |
|---|---|---|
| KEP-4671 | Workload, PodGroup, gang | Beta, 기본 비활성 |
| KEP-5710 | Workload 인지 preemption | Beta |
| KEP-5732 | 토폴로지 인지 스케줄링 | Alpha |
| CompositePodGroup | 계층형 gang과 다단 토폴로지 | Alpha |
| KEP-5547 | Job 컨트롤러 통합 | Alpha |
| KEP-5729 | PodGroup 단위 공유 DRA ResourceClaim | Beta |

CompositePodGroup의 API는 `v1alpha3`이며 KEP-5547의 Job 통합 게이트는 `WorkloadWithJob`입니다. 다음 YAML은 1.37 WAS 블로그의 Job 예시를 줄인 것으로 alpha 기능입니다.

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

같은 블로그는 1.38에서 Workload·PodGroup을 GA로, 토폴로지·CompositePodGroup을 beta로 올리고 JobSet을 통합할 계획을 제시합니다. Kueue가 장기적으로 이 API를 gang과 TAS 엔진으로 활용하는 방향도 포함돼 있습니다. 계획을 설명한 것이므로 일정이 확정된 지원 조건은 아닙니다.

조사 시점에는 코어만으로 노드 간 토폴로지 배치를 운영하기에 이른 단계라고 판단합니다. 애드온이 배치를 맡는 구성과 Volcano·KAI Scheduler·Slurm의 선택은 [05편]({{< relref "/platform/kubernetes/gpu/05-scheduling-volcano-kai-slurm/index.md" >}})에서 비교합니다.

## 측정 결과와 지원 범위에서 남은 확인 사항 {#6-확인하지-못한-것}

이 글은 AI가 조사 노트를 바탕으로 작성한 초안입니다. 조사 기준일은 2026-10-21이며 Kubernetes v1.37.1(2026-09-23), Kueue v0.20.2(2026-10-15), NVIDIA Topograph v1.0.0(2026-08-18)의 문서와 릴리스를 참고했습니다. 문서로 확인한 동작과 논문 측정, 벤더 설명, 자료에서 도출한 해석을 구분했습니다.

배치 성능의 정량 효과와 다음 지원 범위는 확인이 남아 있습니다.

- 같은 조건에서 같은 leaf 배치와 spine 경유 배치만 바꾼 NCCL all-reduce 또는 학습 처리량의 공개 측정. Meta의 30%와 vClos의 60%는 파편화·경합 조건의 결과여서 홉 수 효과를 분리하지 못합니다.
- Google·NVIDIA·AWS가 공개한 TAS 적용 전후의 정량 비교.
- Azure AKS와 OCI OKE의 네이티브 토폴로지 라벨 키, 일반 EKS의 `topology.k8s.aws/ultraserver-id` 부여 여부.
- KubeCon Japan 2026 Kueue 토폴로지 발표의 실제 내용. 제목과 초록만 확인했습니다.

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
