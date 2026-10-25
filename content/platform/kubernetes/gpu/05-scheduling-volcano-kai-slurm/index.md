---
title: "05 노드 간 스케줄링에서 Volcano·KAI·Slurm을 고르는 기준"
description: "GPU 잡의 배치 요구, 토폴로지 표현 방식, 기존 운영 경험을 기준으로 Volcano·KAI·Slurm을 비교한다. 2026-10-21 기준 공개 도입 자료와 워크로드 API에서 각 조합이 맞는 조건을 정리한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 5
url: "/kubernetes/gpu/05-scheduling-volcano-kai-slurm/"
---

# 05 · 노드 간 스케줄링에서 Volcano·KAI·Slurm을 고르는 기준

## 1. 배치 요구와 토폴로지 정보의 공급자를 정한다 {#1-스케줄러보다-먼저-정할-것}

여러 노드의 GPU를 가까이 배치하려면 스케줄러에 물리적 위치를 알려 주어야 합니다. 클라우드의 CCM(클라우드 컨트롤러 매니저)이 라벨을 붙일지, Topograph가 정보를 수집할지, Volcano의 자동 발견을 쓸지부터 정해야 합니다. [04편]({{< relref "/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md" >}})에서는 노드 라벨로 토폴로지를 알리고 Kueue TAS(토폴로지 인지 스케줄링)에 연결했습니다. 여기서는 그 정보를 다른 스케줄러가 어떻게 배치 규칙으로 바꾸는지 비교합니다.

선택에는 워크로드 API와 기존 운영 방식도 영향을 줍니다. 같은 gang(파드 묶음 단위의 스케줄링)을 지원해도 학습 잡의 파드를 모으는 방법, 추론 replica를 흩는 방법, Slurm 사용자가 잡을 제출하는 방식까지 같지는 않습니다. 따라서 필요한 배치 제약이 워크로드 API를 거쳐 스케줄러에 전달되는지 함께 확인해야 합니다.

조사 기준일은 2026-10-21입니다. 비교에 사용한 버전과 게시일은 각 프로젝트의 GitHub releases에서 확인했습니다. Slinky는 slurm-operator와 slurm-bridge 모두 v1.2.3 태그를 사용했으며 GitHub release 객체는 없습니다.

| 프로젝트 | 조사 버전 | 게시일 |
|---|---|---|
| Volcano | v1.16.0 | 2026-10-14 |
| KAI Scheduler | v0.18.6 | 2026-10-15 |
| Slinky(slurm-operator·slurm-bridge) | v1.2.3 | release 없음(태그만) |
| Koordinator | v1.8.0 | 2026-04-16 |
| YuniKorn | v1.10.0 | 2026-10-06 |
| JobSet | v0.13.0 | 2026-10-12 |
| LeaderWorkerSet | v1.0.0 | 2026-10-16 |
| Kubeflow Trainer | v2.3.0 | 2026-08-07 |

노드 내부의 거리는 [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}}), GPU를 파드에 할당하는 DRA(동적 리소스 할당)는 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에서 다뤘습니다. 실제 패브릭의 설계와 검증은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})과 [11편]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}})으로 이어집니다.

## 2. 워크로드 API가 배치 제약을 전달하는 방법 {#3-배치-요구는-워크로드-api에서-스케줄러까지-이어져야-한다}

### 학습 잡이 넘기는 제약

JobSet, TrainJob, LeaderWorkerSet으로 워크로드를 만든다면 각 API가 어떤 제약을 스케줄러에 넘기는지 확인해야 합니다. JobSet v0.13.0의 기존 어노테이션 `alpha.jobset.sigs.k8s.io/exclusive-topology`는 자식 Job을 토폴로지 그룹 하나에 독점 배치합니다. Kueue TAS를 사용할 때는 04편의 어노테이션을 replicatedJob의 파드 템플릿에 붙입니다.

JobSet의 새 alpha 기능인 `JobSetWorkloadAwareSchedulingAPI`에서는 `spec.scheduling`에 gang, 토폴로지 제약, disruption 정책을 적습니다. JobSet이 이를 읽어 코어 Workload와 PodGroup을 만듭니다. 계층형 PodGroup(composite PodGroup)은 아직 구현되지 않았으므로, 여러 층의 파드 묶음을 이 API만으로 표현할 수 있다고 보아서는 안 됩니다.

Kubeflow Trainer v2.3.0 타입 정의에서는 `TrainingRuntime.spec.podGroupPolicy`로 `coscheduling`이나 `volcano`를 선택합니다. volcano 쪽의 `networkTopology` 필드에 HyperNode(Volcano의 토폴로지 트리 단위, 3절) 제약을 직접 넣을 수 있습니다. Kueue는 0.15부터 TrainJob TAS를 어노테이션으로 지원합니다. KAI가 세그먼트(TP 그룹을 배치 단위로 묶는 설정, 4절)를 지원하는 대상은 레거시 v1 PyTorchJob이며, Kubeflow 문서에도 KAI 연동에 관한 프로젝트 설명이 있습니다.

### 추론 replica 안에서는 모으고 replica 사이는 흩는다 {#추론에서-토폴로지가-쓰이는-방식}

추론 서비스에서는 replica 하나가 여러 파드로 구성될 수 있습니다. Kueue 0.20의 Topology Spreading은 이런 묶음을 PodTopologySpread로 표현할 수 없다는 문제에서 출발했습니다. Volcano 1.16의 anti-affinity는 추론 replica가 한 supernode(고속 인터커넥트로 묶인 노드 단위, HyperNode 한 층에 해당)에 몰려 장애 도메인을 공유하는 상황을 다룹니다. Grove(멀티 파드 추론 서비스를 표현하는 API, 4절)는 NVLink 도메인 안에 파드를 배치해야 한다는 점을 주요 동기로 제시합니다. 이 설명들을 종합하면 학습은 파드를 모으는 요구가 중심이고, 추론은 replica 내부를 모으면서 replica 사이를 흩는 요구를 함께 갖는 것으로 해석할 수 있습니다.

LeaderWorkerSet v1.0.0은 `leaderworkerset.sigs.k8s.io/exclusive-topology`와 `subgroup-exclusive-topology` 어노테이션을 지원합니다. Kueue에서는 `podset-group-name`으로 leader와 worker를 같은 도메인에 두며, 0.20부터 그룹과 slice를 함께 쓸 수 있습니다. 그룹과 slice의 조합은 beta, Spreading은 alpha입니다. Volcano는 LWS v0.7부터 PodGroup을 자동으로 생성하고 KAI는 세그먼트를 자동으로 지원합니다. LWS의 코어 native gang 통합(KEP-666)은 alpha이고 opt-in입니다. 이 상태는 LWS v1.0.0과 Kueue·Volcano 릴리스 설명을 기준으로 합니다.

llm-d의 DisaggregatedSet 문서는 prefill/decode 슬라이스에 required affinity를 걸어 NVLink 도메인으로 묶는다고 설명합니다. 사용하는 라벨은 GKE subblock, `topology.k8s.aws/network-node-layer-3`, `ultraserver-id`, `ds.coreweave.com/nvlink.domain`, `nvidia.com/gpu.clique`입니다. 라우터에도 topology-affinity 플러그인을 둡니다. 이는 llm-d가 제시한 구성입니다.

## 3. Volcano와 Koordinator로 토폴로지의 층을 지정한다 {#4-토폴로지의-층을-배치-규칙으로-바꾸기}

### Volcano가 관리하는 HyperNode 트리

Volcano는 노드와 하위 그룹을 트리로 묶어 배치 범위를 표현합니다. Volcano 가이드는 클러스터마다 라벨의 의미가 다르다는 점을 별도 CRD(사용자 정의 리소스)를 택한 이유로 설명합니다. 트리의 단위는 클러스터 범위의 `HyperNode`(`topology.volcano.sh/v1alpha1`)입니다.

Go 타입 정의에서 `spec.tier`는 정수이고, 값이 작을수록 노드에 가까운 층입니다. `tierName`으로 이름을 붙일 수 있으며 `members[]`에는 Node 또는 HyperNode가 들어갑니다. 멤버는 `exactMatch`, `regexMatch`, `labelMatch`로 선택합니다.

{{< flow src="_flow/2-hypernode-계층.json" />}}

다음 YAML은 Go 타입과 주석의 예시를 조합한 것입니다. 설계 문서에 실린 약식 YAML은 필드 이름이 다르므로 그대로 사용할 수 없습니다.

```yaml
apiVersion: topology.volcano.sh/v1alpha1
kind: HyperNode
metadata:
  name: s0
spec:
  tier: 1
  tierName: tor
  members:
  - type: Node
    selector:
      regexMatch:
        pattern: "^gpu-rack0-.*$"
---
apiVersion: topology.volcano.sh/v1alpha1
kind: HyperNode
metadata:
  name: s4
spec:
  tier: 2
  members:
  - type: HyperNode
    selector:
      exactMatch:
        name: s0
  - type: HyperNode
    selector:
      exactMatch:
        name: s1
```

트리의 자동 발견은 InfiniBand의 UFM과 노드 라벨을 지원합니다. 자동 발견 가이드의 RoCE 상태는 "Currently not supported"입니다. 1.16부터 `custom.hypernode_controller_mode=standalone`으로 HyperNode 컨트롤러만 배포할 수도 있습니다. 다른 스케줄러가 API를 재사용하도록 하려는 의도로 읽히지만, 이 부분은 릴리스 설명에 대한 해석입니다.

워크로드는 잡 또는 PodGroup의 `networkTopology`에 배치 제약을 적습니다. `mode: hard`는 잡 전체가 한 HyperNode에 들어가야 한다는 뜻이고, `soft`는 가능한 한 그렇게 배치하라는 뜻입니다. hard 모드에서만 `highestTierAllowed` 또는 `highestTierName`으로 허용할 최상위 층을 정할 수 있습니다. 전자는 정수, 후자는 문자열이며 둘을 함께 지정할 수 없습니다. `highestTierName`은 1.16 문서에 추가됐습니다.

잡 안에서도 묶음마다 다른 범위를 요구할 수 있습니다. `partitionPolicy`(SubGroup)를 사용하면 파티션별로 gang과 토폴로지 제약을 적용합니다.

```yaml
spec:
  schedulerName: volcano
  networkTopology:
    mode: hard
    highestTierAllowed: 2
  tasks:
  - name: t0
    replicas: 8
    partitionPolicy:
      totalPartitions: 2
      partitionSize: 4
      networkTopology:
        mode: hard
        highestTierAllowed: 1
```

스케줄러 설정에는 `network-topology-aware` 플러그인을 gang, binpack 플러그인과 같은 tier에 둡니다. `hypernode.binpack.*` 인자로 CPU·메모리·`nvidia.com/gpu`의 가중치와 tier별 감쇠를 조절합니다. 이 구성과 앞의 제약은 Volcano 사용자 가이드에 따른 것입니다.

1.16의 PodGroup 토폴로지 anti-affinity는 추론 replica를 supernode별로 나누는 기능입니다. 릴리스 노트가 보장하는 적용 시점은 allocate 단계뿐입니다. backfill로 들어오는 BestEffort 파드에는 보장이 없으며, 이미 실행 중인 파드를 재배치하지도 않습니다.

HyperNode를 도입할 때는 사용하는 버전에 필요한 기능이 있는지 확인해야 합니다.

| 버전 | 토폴로지 관련 변화 |
|---|---|
| 1.11 (2025-01) | HyperNode, hard·soft, `highestTierAllowed` 미리 보기 |
| 1.12 (2025-05) | UFM 자동 발견(alpha), HyperNode 수준 점수, 멤버 매칭 세 가지 |
| 1.13 (2025-09) | 라벨 기반 자동 발견, LWS v0.7이 Volcano PodGroup을 자동 생성 |
| 1.14 (2026-01) | SubGroup 토폴로지, Job과 SubGroup의 다층 gang, HyperNode binpack |
| 1.15 (2026-06) | gang 인지 preemption·reclaim(alpha), 토폴로지를 켜면 victim 탐색을 HyperNode 범위로 제한 |
| 1.16 (2026-10) | PodGroup 토폴로지 anti-affinity, HyperNode 컨트롤러 단독 배포, fairshare |

### Koordinator는 층마다 모으는 전략을 정한다

Koordinator는 노드 라벨 키를 토폴로지 층에 대응시킵니다. 이름이 `default`인 `ClusterNetworkTopology`에서 `SpineLayer`, `BlockLayer`, `NodeTopologyLayer` 등을 정의하고, 워크로드의 PodGroup 어노테이션에 층별 배치 전략을 적습니다.

```yaml
gang.scheduling.koordinator.sh/network-topology-spec: |
  {"gatherStrategy": [
     {"layer": "BlockLayer", "strategy": "PreferGather"},
     {"layer": "SpineLayer", "strategy": "PreferGather"}]}
```

`PreferGather` 대신 `MustGather`를 쓰면 자원이 부족할 때 GangGroup 단위로 토폴로지를 고려한 preemption(선점)이 일어납니다. 그 결과는 `.status.nominatedNode`에 기록되며 파드의 `network-topology-index` 어노테이션은 rank 순서를 표현합니다.

Koordinator 매뉴얼에 따르면 네트워크 토폴로지 인지는 1.7부터 기본 활성이라고 합니다. 한편 매뉴얼은 설정값으로 `--enable-network-topology-manager=true`와 `awareNetworkTopology: true`도 제시하는데, 기본 활성과 이 설정값의 관계는 확인하지 못했습니다. v1.8.0에서는 기존 파드 인지와 binpack을 개선했습니다. 매뉴얼이 안내하는 라벨 공급자는 Topograph이지만 라벨 키에는 옛 이름이 남아 있으므로, 현재 Topograph가 쓰는 키와 맞춰 보아야 합니다.

## 4. KAI로 배치하고 Grove로 추론 묶음을 표현한다 {#5-kai로-배치하고-grove로-추론-묶음을-표현한다}

KAI는 스케줄러에서 토폴로지 배치를 처리합니다. Grove는 멀티 파드 추론 서비스의 배치·기동·확장 요구를 API로 표현합니다. NVIDIA가 설명하는 Dynamo 멀티노드 배포의 기본 경로도 Grove와 KAI의 조합입니다.

KAI Scheduler는 Run:ai 스케줄링 엔진의 오픈소스판으로, Run:ai 제품에도 계속 사용됩니다. README와 CNCF 자료에 따르면 Apache 2.0 라이선스, kube-batch 기반이며 CNCF Sandbox에 들어간 날짜는 2025-12-21입니다. 저장소는 `NVIDIA/KAI-Scheduler`에서 `kai-scheduler/KAI-Scheduler`로 옮겼고 옛 링크는 리다이렉트됩니다. v0.12부터 짝수 버전에 1년 LTS를 적용하며, 조사 시점의 LTS는 v0.18(2026-09~2027-09)입니다.

README에는 gang, 계층형 큐와 quota, DRF, reclaim, 시간 기반 fairshare, consolidation, GPU 공유, DRA, TAS, NUMA(불균일 메모리 접근) 인지가 나열돼 있습니다. Karpenter 같은 오토스케일러와 호환된다는 설명 역시 프로젝트의 주장으로 읽어야 합니다.

### 라벨 계층과 파드 묶음을 연결하는 KAI

KAI v0.18.6 토폴로지 문서에서 계층은 `kai.scheduler/v1alpha1`의 `Topology` CRD로 정의합니다. Kueue처럼 노드 라벨 목록을 levels로 두고 워크로드의 어노테이션에 요구를 적습니다.

```yaml
kai.scheduler/topology: "cluster-topology"
kai.scheduler/topology-required-placement: "cloud.provider.com/topology-block"
kai.scheduler/topology-preferred-placement: "cloud.provider.com/topology-rack"
```

도메인을 선택할 때는 bin-packing(자원을 모아 채우는 배치)을 사용합니다. required 레벨에서는 요청 대비 여유가 적은 도메인을 먼저 고릅니다. 선택한 도메인 안에서는 preferred 레벨의 하위 도메인 가운데 여유가 많은 곳을 우선해 파드를 가까이 모읍니다.

TP(텐서 병렬) 그룹을 배치 단위로 삼으려면 `kai.scheduler/segment-size` 등의 세그먼트 설정을 사용합니다. PyTorchJob과 LWS는 자동으로 지원하고 JobSet은 아래 매핑으로 SubGroup을 만들며, 그 밖의 워크로드는 PodGroup SubGroup을 직접 작성해야 합니다. v0.17부터 level에 `rack` 같은 별칭(alias)을 줄 수 있습니다. v0.16에 추가된 JobSet 매핑은 JobSet당 PodGroup 하나를 만들고, replicatedJob별 부모 SubGroup 아래에 replica별 leaf SubGroup을 둡니다.

GPU 공유와 DRA는 토폴로지 배치와 함께 확인할 설정입니다. GPU 공유 문서의 분할 모드는 `Disabled`, `NonMemoryEnforced`, `HamiCore`, `NvFractions`입니다. 기본값 `NonMemoryEnforced`는 메모리를 격리하지 않고, `HamiCore`는 HAMi-core로 CUDA 메모리를 격리합니다. `NvFractions`에는 CDI와 NRI가 필요합니다. 파드는 `gpu-fraction` 또는 `gpu-memory` 어노테이션으로 요청합니다.

DRA는 기본 비활성이며, 켜면 binder가 `BindRequest` CR로 ResourceClaim을 처리합니다. KAI DRA 문서에서 GB200의 MNNVL(멀티노드 NVLink)은 NVIDIA `k8s-dra-driver-gpu`의 ComputeDomain(IMEX 채널)으로 요청합니다. 설치 전제는 GPU Operator입니다.

### Grove가 표현하는 추론 서비스의 계층

Grove는 `PodCliqueSet`, `PodCliqueScalingGroup`, `PodClique`, 스케줄러용 `PodGang`으로 계층형 gang, 토폴로지 배치, 기동 순서, 다단 오토스케일을 표현합니다. 관리자가 `ClusterTopologyBinding`으로 도메인 이름과 라벨 키를 연결하면 워크로드는 `packDomain: rack`처럼 도메인 이름을 사용합니다. 구조와 토폴로지 정의는 Grove 저장소와 GREP-244에 설명돼 있습니다.

백엔드는 제안 문서의 시점과 현재 코드를 구분해야 합니다. GREP-375는 처음에 KAI를 유일한 백엔드로 서술했지만, 조사 시점의 main에는 `kai`, `kube`, `kueue`, `volcano` 코드가 있습니다. v0.1.0-alpha.16(2026-10-15)에는 Kueue prebuilt workload 백엔드가 추가됐습니다. Grove 자체는 아직 alpha입니다.

## 5. Slurm을 유지하면서 Kubernetes와 연결한다 {#6-slurm의-배치를-kubernetes에-연결하는-경로}

SchedMD의 Slinky README는 Kubernetes와 Slurm의 강점을 워크로드 성격으로 구분합니다. 기간이 정해지지 않고 자원 요구가 모호하며 단일 노드에서 느슨한 정책으로 실행되는 작업은 Kubernetes에 강점이 있다고 봅니다. 기간이 유한하고 자원·토폴로지가 명확하며 여러 노드에 엄격한 정책을 적용하는 작업은 Slurm에 강점이 있다는 설명입니다. 토폴로지를 엄격하게 맞추는 대규모 학습에서 Slurm이 계속 쓰이는 배경을 이 설명으로 읽을 수 있습니다.

NVIDIA의 SchedMD 인수를 다룬 heise와 evertiq 보도는 인수일을 2025-12-15로 전하며, 오픈소스와 벤더 중립을 유지한다는 발표를 함께 소개합니다. TOP500 상위 10·상위 100의 절반 이상에서 Slurm을 사용한다는 내용도 인수 보도에 담긴 주장입니다.

### Kubernetes와 비교할 때 남는 차이

Kubernetes의 지원 상태도 달라지고 있습니다. 다음 표는 앞서 본 자료를 2026-10 시점으로 종합한 것으로, 기능명이 같다는 이유만으로 동작까지 같다고 판단할 수는 없습니다.

| 항목 | 2026-10 현황 |
|---|---|
| 토폴로지 | 코어는 KEP-5732 alpha. 애드온은 Kueue TAS beta, Volcano HyperNode, KAI TAS, Koordinator. 표준 라벨 KEP는 폐기되어 라벨은 Topograph나 클라우드 CCM이 채움 |
| gang | 코어 Workload·PodGroup beta(기본 비활성). 애드온은 이전부터 지원 |
| gang 단위 preemption | 코어 beta, Volcano 1.15 alpha, Kueue는 워크로드 단위 evict |
| 시간 기반 backfill | Kueue, Volcano, KAI에서 잡 실행 시간 기반의 예약 backfill은 확인하지 못함 |
| 이력 감쇠 fairshare | Volcano 1.16 fairshare, KAI 시간 기반 fairshare, Kueue Admission Fair Sharing |

특히 backfill은 구별해서 읽어야 합니다. Slurm의 기본 backfill은 잡의 time limit을 바탕으로 예약 뒤의 빈 시간에 작은 잡을 넣는 방식으로 알려져 있습니다. 이번 조사에서 Slurm 설정 문서를 다시 확인하지는 않았습니다. Volcano의 `backfill` action은 BestEffort 파드용으로 보이며, Slurm식 시간 기반 예약과 같은지 확인하지 못했습니다. Kueue·Volcano·KAI에서 이 기능을 찾지 못했다는 사실도 기능이 없다는 증거는 아닙니다.

Slurm 26.05 토폴로지 문서는 `topology/tree`와 `topology/block`을 설명합니다. `topology/tree`는 요청을 만족하는 가장 낮은 스위치를 찾고 그 아래 leaf에서 best-fit으로 할당합니다. `--switches=count[@time]`으로 leaf 수의 상한과 대기 시간을 정합니다. `topology/block`은 고정 block 계층에 패킹해 파편화를 줄이며 `BlockSizes`로 허용 크기, `--segment`로 할당 단위를 지정합니다. 25.05부터는 `topology.yaml`로 한 클러스터에 여러 토폴로지를 두고 파티션별로 선택할 수 있고 동적 토폴로지도 지원합니다.

### Slurm을 어디에 둘 것인가

Slurm을 Kubernetes 위에서 실행하는 방식과 Kubernetes 워크로드를 Slurm에 배치시키는 방식은 운영 주체가 다릅니다.

Slinky의 slurm-operator는 Slurm 컨트롤러, `NodeSet`(slurmd 파드), `LoginSet`을 CRD로 관리합니다. HA, scale-to-zero, HPA를 지원하며 문서의 지원 Kubernetes 버전은 1.35~1.37입니다. 노드 어노테이션 `topology.slinky.slurm.net/spec`을 Slurm 동적 토폴로지로 동기화하는 `spec.syncTopology` 설정도 제공합니다.

CoreWeave SUNK 역시 slurmd를 파드로 실행합니다. 문서에는 NodeSet, Syncer, 파드 스케줄러가 설명돼 있으며, `SlurmCluster`가 노드 라벨로 `topology.conf`를 만듭니다. 자동 생성 시에는 `ds.coreweave.com/nvlink.domain`을 기준으로 Block을 정의하므로 NVL72 시스템 하나가 18노드 Block이 됩니다. 기본 `--segment=1` 사용을 권장합니다. SUNK의 오픈소스 여부는 확인하지 못했습니다.

Kubernetes 워크로드의 배치를 Slurm에 맡기려면 Slinky의 slurm-bridge를 사용합니다. bridge가 Pod, PodGroup, Job, JobSet, LWS를 Slurm external job으로 번역하면 slurmctld가 배치하고 bridge가 바인딩합니다. 하이브리드 노드는 시간 분할 방식이어서 같은 시점에 Slurm 잡과 Kubernetes 잡을 함께 실행할 수 없습니다.

## 6. 공개 도입 자료로 선택지를 좁힌다 {#2-공개-도입-사례에서-읽는-선택-기준}

공개 도입 자료는 어떤 조합을 검토할지 알려 주지만 채택률을 보여 주지는 않습니다. CNCF 2025 연례 서베이(2026-01-20 발표)는 컨테이너 사용자의 82%가 Kubernetes를 실제 서비스 운영에 쓰고, 생성형 AI 모델을 호스팅하는 조직의 66%가 추론의 일부 이상을 Kubernetes에서 실행한다고 보고합니다. 스케줄러별 채택률은 이 서베이에 없습니다.

| 조합 | 공개된 근거 | 읽는 법 |
|---|---|---|
| Kueue(+JobSet·TrainJob·LWS)와 kube-scheduler, 토폴로지는 클라우드 라벨 | GKE 공식 TAS 가이드, SageMaker HyperPod task governance, Nebius 문서, CoreWeave CKS의 Kueue 지원. Kueue adopters 목록에 Canva, CyberAgent, Netflix, Krea, Wayve, Preferred Networks, LY Corp, IBM Research, Red Hat, Etsy. KubeCon Japan 2026에서 Google과 Meta가 다층 TAS 발표 | 조사 자료에서 클라우드 지원이 가장 넓게 확인된 조합. Krea 보고서는 Kueue를 gang 때문에 썼고 토폴로지는 언급하지 않음 |
| Volcano 단독(HyperNode) | adopters 목록에 Huawei Cloud, Tencent, Baidu, iQIYI, Xiaohongshu, DiDi, iFLYTEK, Kingsoft Cloud, Momenta, Zoom, Pinterest | HyperNode 예시가 Ascend 910B·910C 기준이라 화웨이 supernode 생태계의 색이 강함 |
| KAI(+Grove·Dynamo, Run:ai) | adopters에 NVIDIA Run:ai, OSMO, Cantina, Lightning AI. KubeRay, Kubeflow, vCluster, ZenML, NVCF, Dynamo와 통합 | NVIDIA 스택과의 통합을 검토할 조합 |
| Slurm 병행·Slurm on Kubernetes | CoreWeave SUNK, SchedMD Slinky, Topograph가 Slurm·Slinky 엔진을 1급으로 지원 | 사용자 경험이 Slurm 쪽에 있을 때 |

Kueue 조합의 클라우드 근거에는 GKE의 `gke-default` Topology, SageMaker HyperPod task governance의 Kueue TAS, Nebius 문서, CoreWeave CKS 지원이 있습니다. Kueue adopters와 talks에서 회사 이름과 발표 제목을 확인했지만 KubeCon Japan 2026 발표는 제목·초록까지만 읽었습니다.

Volcano adopters의 이름들은 운영 사용으로 표기된 목록에서 가져왔습니다. KAI의 이름과 통합 대상은 ADOPTERS와 README에, Slurm 공존 경로는 SUNK·Slinky·Topograph 문서에 근거합니다.

이 자료를 바탕으로는 gang만 필요할 때 코어 기능(Workload·PodGroup은 기본 비활성이라 켜야 함)을, quota(할당 한도)·공정성·admission(실행 허가)까지 필요할 때 Kueue를 검토할 수 있습니다. HyperNode 트리나 Ascend 환경은 Volcano, NVIDIA 스택은 KAI, HPC식 사용자 경험을 유지할 때는 Slurm을 우선 살펴볼 만합니다. 이는 기능과 공개 자료를 연결한 판단이며 시장의 분포나 채택률에 관한 결론은 아닙니다.

gang 지원만으로 GPU 토폴로지 배치 후보가 되는 것도 아닙니다. Apache YuniKorn v1.10.0은 `task-groups` 어노테이션과 placeholder 파드, `placeholderTimeoutInSeconds`를 사용하는 gang을 제공하며 `gangSchedulingStyle`의 기본값은 `Soft`입니다. 네트워크 토폴로지 인지 배치는 문서와 코어 저장소에서 찾지 못했고, 1.10.0 하이라이트에도 토폴로지·GPU 항목이 없습니다. 이 조사 범위에서는 YuniKorn을 Spark 같은 배치 큐잉의 선택지로 보고, GPU 학습의 토폴로지 배치 후보에서는 제외했습니다.

## 7. 확인하지 못한 것

- Kueue, Volcano, KAI의 Slurm식 walltime 기반 예약 backfill 지원 여부. 문서에서 찾지 못했으며 미지원으로 확정하지 않았다.
- 스케줄러별 채택률을 담은 서베이와 SUNK의 오픈소스 여부.
- 분산 KV 캐시 배치에서 토폴로지 인지 효과를 정량으로 다룬 자료.
- KubeCon Japan 2026 Kueue 발표의 실제 내용. 제목과 초록만 확인했다.
- Azure AKS의 토폴로지 라벨 키. Topograph provider 목록에도 Azure가 없다.

## 참고 자료

- [Volcano — 네트워크 토폴로지 인지 스케줄링](https://github.com/volcano-sh/volcano/blob/master/docs/user-guide/how_to_use_network_topology_aware_scheduling.md)
- [Volcano — HyperNode 자동 발견](https://github.com/volcano-sh/volcano/blob/master/docs/user-guide/how_to_use_hypernode_auto_discovery.md)
- [Volcano — HyperNode 타입 정의](https://github.com/volcano-sh/apis/blob/master/pkg/apis/topology/v1alpha1/hypernode_types.go)
- [Volcano v1.16.0](https://github.com/volcano-sh/volcano/releases/tag/v1.16.0) · [adopters](https://github.com/volcano-sh/community/blob/master/adopters.md)
- [KAI Scheduler — 토폴로지 (v0.18.6)](https://github.com/kai-scheduler/KAI-Scheduler/tree/v0.18.6/docs/topology)
- [KAI Scheduler — GPU 공유](https://github.com/kai-scheduler/KAI-Scheduler/blob/v0.18.6/docs/gpu-sharing/README.md) · [DRA](https://github.com/kai-scheduler/KAI-Scheduler/blob/v0.18.6/docs/dra/README.md) · [ADOPTERS](https://github.com/kai-scheduler/KAI-Scheduler/blob/main/ADOPTERS.md)
- [Grove](https://github.com/ai-dynamo/grove) · [TAS GREP-244](https://github.com/ai-dynamo/grove/blob/main/docs/proposals/244-topology-aware-scheduling/README.md) · [백엔드 GREP-375](https://github.com/ai-dynamo/grove/blob/main/docs/proposals/375-scheduler-backend-framework/README.md)
- [Koordinator — 네트워크 토폴로지 인지 스케줄링](https://github.com/koordinator-sh/koordinator.sh/blob/main/docs/user-manuals/network-topology-aware-scheduling.md)
- [YuniKorn — gang 스케줄링](https://github.com/apache/yunikorn-site/blob/master/docs/user_guide/gang_scheduling.md) · [1.10.0 발표](https://yunikorn.apache.org/release-announce/1.10.0)
- [Slurm — 토폴로지](https://slurm.schedmd.com/topology.html)
- [Slinky slurm-operator](https://github.com/SlinkyProject/slurm-operator) · [토폴로지](https://github.com/SlinkyProject/slurm-operator/blob/main/docs/usage/topology.md) · [slurm-bridge](https://github.com/SlinkyProject/slurm-bridge)
- [CoreWeave SUNK](https://docs.coreweave.com/products/sunk) · [토폴로지 스케줄링](https://docs.coreweave.com/products/sunk/optimize_workloads/topology-scheduling)
- [NVIDIA의 SchedMD 인수 — heise](https://heise.de/-11115881) · [evertiq](https://evertiq.com/design/2025-12-17-nvidia-acquires-slurm-developer-schedmd)
- [JobSet v0.13.0](https://github.com/kubernetes-sigs/jobset/releases/tag/v0.13.0) · [LeaderWorkerSet v1.0.0](https://github.com/kubernetes-sigs/lws/releases/tag/v1.0.0)
- [Kubeflow Trainer v2.3.0 API](https://github.com/kubeflow/trainer/blob/v2.3.0/pkg/apis/trainer/v1alpha1/trainingruntime_types.go)
- [llm-d — DisaggregatedSet](https://github.com/llm-d/llm-d/blob/main/docs/operations/disaggregation/disaggregatedset.md)
- [Kueue adopters](https://github.com/kubernetes-sigs/kueue/blob/main/site/data/adopters.yaml) · [Kueue talks](https://kueue.sigs.k8s.io/community/talks_and_presentations/)
- [Krea 2 기술 보고서](https://www.krea.ai/blog/krea-2-technical-report)
- [CNCF — Kubernetes는 AI의 사실상 운영체제](https://www.cncf.io/announcements/2026/01/20/kubernetes-established-as-the-de-facto-operating-system-for-ai)
