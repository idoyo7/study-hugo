---
title: "05 노드 간 스케줄링 2부 — Volcano·KAI·Slurm 비교"
description: "GPU 잡의 배치 요구와 기존 운영 방식에 따라 어떤 스케줄러 조합을 고를지 설명한다. 2026-10-21 기준 공개 도입 자료와 워크로드 API를 바탕으로 Kubernetes 애드온과 Slurm 공존 경로를 비교한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 5
url: "/kubernetes/gpu/05-scheduling-volcano-kai-slurm/"
---

# 05 · 노드 간 스케줄링 2부 — Volcano·KAI·Slurm 비교

## 1. 스케줄러보다 먼저 정할 것

이 글은 여러 노드의 GPU를 가까이 모아 배치하려면 토폴로지 정보를 누가 채우는지부터 정해야 한다고 봅니다. 클라우드의 CCM(클라우드 컨트롤러 매니저)이 제공할지, Topograph가 채울지, Volcano의 자동 발견을 쓸지 결정한 뒤에 스케줄러를 선택하자는 뜻입니다. [04편]({{< relref "/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md" >}})은 토폴로지를 노드 라벨로 알리는 방법과 Kueue의 TAS(토폴로지 인지 스케줄링)를 다뤘습니다.

노드 안의 거리는 [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}}), GPU를 파드에 붙이는 DRA(동적 리소스 할당) 쪽은 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에서 다뤘습니다. 토폴로지를 설계하고 검증하는 방법은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})과 [11편]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}})으로 이어집니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-21이며 Volcano v1.16.0, KAI Scheduler v0.18.6, Koordinator v1.8.0, YuniKorn v1.10.0, Slinky v1.2.3, JobSet v0.13.0, LeaderWorkerSet v1.0.0, Kubeflow Trainer v2.3.0 문서를 봤습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 조사한 버전과 게시일 | Volcano v1.16.0(2026-10-14), KAI v0.18.6(2026-10-15), Koordinator v1.8.0(2026-04-16), YuniKorn v1.10.0(2026-10-06), JobSet v0.13.0(2026-10-12), LWS v1.0.0(2026-10-16), Trainer v2.3.0(2026-08-07) | 각 프로젝트 GitHub releases | `✓` |
| Slinky | slurm-operator와 slurm-bridge 모두 v1.2.3. GitHub release 객체 없이 태그만 있음 | Slinky 저장소 | `✓` |

{{% /details %}}

## 2. 공개 도입 사례에서 읽는 선택 기준

공개 자료에는 Kueue와 기본 스케줄러를 조합하는 경로, Volcano나 KAI를 중심에 두는 경로, Slurm을 병행하는 경로가 나타납니다. CNCF 2025 연례 서베이(2026-01-20 발표)는 컨테이너 사용자의 82%가 Kubernetes를 실제 서비스 운영에 쓰고, 생성형 AI 모델을 호스팅하는 조직의 66%가 추론의 일부 이상을 Kubernetes에서 돌린다고 보고합니다. 이 서베이에 스케줄러별 채택률은 없습니다. 어느 조합이 얼마나 많은지는 이 자료로 말할 수 없습니다.

다음 표는 공개 도입 자료를 조합별로 묶은 것입니다.

| 조합 | 공개된 근거 | 읽는 법 |
|---|---|---|
| Kueue(+JobSet·TrainJob·LWS)와 kube-scheduler, 토폴로지는 클라우드 라벨 | GKE 공식 TAS 가이드, SageMaker HyperPod task governance, Nebius 문서, CoreWeave CKS의 Kueue 지원. Kueue adopters 목록에 Canva, CyberAgent, Netflix, Krea, Wayve, Preferred Networks, LY Corp, IBM Research, Red Hat, Etsy. KubeCon Japan 2026에서 Google과 Meta가 다층 TAS 발표 | 가장 넓은 클라우드 채택. Krea 보고서는 Kueue를 gang 때문에 썼고 토폴로지는 언급하지 않음 |
| Volcano 단독(HyperNode) | adopters 목록에 Huawei Cloud, Tencent, Baidu, iQIYI, Xiaohongshu, DiDi, iFLYTEK, Kingsoft Cloud, Momenta, Zoom, Pinterest | HyperNode 예시가 Ascend 910B·910C 기준이라 화웨이 슈퍼노드 생태계의 색이 강함 |
| KAI(+Grove·Dynamo, Run:ai) | adopters에 NVIDIA Run:ai, OSMO, Cantina, Lightning AI. KubeRay, Kubeflow, vCluster, ZenML, NVCF, Dynamo와 통합 | NVIDIA 스택을 쓰면 자연스러운 선택 |
| Slurm 병행·Slurm on Kubernetes | CoreWeave SUNK, SchedMD Slinky, Topograph가 Slurm·Slinky 엔진을 1급으로 지원 | 사용자 경험이 Slurm 쪽에 있을 때 |

이 자료에서 읽히는 선택 기준은 필요한 기능과 기존 사용자 경험입니다. gang(파드 묶음 단위의 스케줄링)만 필요하면 코어 기능을, quota(할당 한도)와 공정성·admission(실행 허가)까지 필요하면 Kueue를 검토하는 흐름입니다. 하이퍼노드 트리나 Ascend 환경에는 Volcano, NVIDIA 스택에는 KAI, HPC식 사용자 경험을 유지하려는 경우에는 Slurm이 선택지로 보입니다. 이 분기는 위 자료를 이은 추정이며 서베이로 확인한 분포가 아닙니다.

gang을 지원한다고 해서 모두 GPU 토폴로지 배치 후보가 되는 것은 아닙니다. Apache YuniKorn v1.10.0은 `task-groups` 어노테이션과 placeholder 파드로 gang을 구현하며, `gangSchedulingStyle`의 기본값은 Soft입니다. 네트워크 토폴로지 인지 배치는 문서와 코어 저장소에서 찾지 못했고, 1.10.0 하이라이트에도 토폴로지와 GPU 항목이 없습니다. 이 글의 판단으로는 YuniKorn은 Spark 같은 배치 큐잉에 강점이 있는 선택지이며, GPU 학습의 토폴로지 배치 후보에는 들지 않습니다.

검증과 멀티테넌시는 [11편]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}})에서 이어 봅니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Kueue 조합의 클라우드 근거 | GKE `gke-default` Topology, HyperPod task governance(Kueue TAS), Nebius 문서, CoreWeave CKS | 각 클라우드 문서 | `✓` |
| Kueue adopters·talks | 열거한 회사와 KubeCon Japan 2026 발표 제목(Google, Meta). 발표 내용은 제목·초록만 확인 | Kueue adopters, talks 페이지 | `✓` |
| Krea | 기본 스케줄러와 Kueue 조합이면 충분했다는 서술. gang 때문에 Kueue 사용. 토폴로지 언급 없음 | Krea 2 기술 보고서 | `Ⓥ` |
| Volcano adopters | Production 표기 목록 | Volcano adopters | `✓` |
| Ascend 색이 강함 | HyperNode 라벨 예시가 910B·910C 기준이라는 해석 | Volcano 문서 | `≈` |
| KAI adopters·통합 | 열거한 이름 | KAI ADOPTERS, README | `✓` |
| Slurm 병행 | SUNK, Slinky, Topograph 엔진 | 각 문서 | `✓` |
| CNCF 서베이 | 82%, 66%. 스케줄러별 채택률 없음 | CNCF 발표 | `Ⓥ` |
| 분기 흐름 | 위 자료를 이은 해석 | — | `≈` |
| YuniKorn gang | `task-groups`, placeholder, `placeholderTimeoutInSeconds`, `Soft` 기본 | YuniKorn gang 문서 | `✓` |
| YuniKorn 토폴로지 | 찾지 못함. 1.10.0 하이라이트에도 없음 | YuniKorn 1.10.0 발표 | `?` |
| 후보군 판단 | Spark·배치 큐잉 강점, GPU 학습 토폴로지 후보 아님 | 위 자료 종합 | `Σ` |

{{% /details %}}

## 3. 배치 요구는 워크로드 API에서 스케줄러까지 이어져야 한다

사용자가 JobSet, TrainJob, LeaderWorkerSet으로 워크로드를 만든다면 토폴로지 요구도 이 API를 거쳐 스케줄러에 닿아야 합니다.

### 학습 잡이 넘기는 제약

JobSet v0.13.0에는 자식 Job을 토폴로지 그룹 하나에 독점 배치하는 기존 어노테이션 `alpha.jobset.sigs.k8s.io/exclusive-topology`가 있습니다. Kueue TAS를 쓸 때는 04편의 어노테이션을 replicatedJob의 파드 템플릿에 붙입니다.

새 alpha 기능인 `JobSetWorkloadAwareSchedulingAPI`는 `spec.scheduling`에 gang과 토폴로지 제약, disruption 정책을 적도록 합니다. JobSet은 이 설정으로 코어 Workload와 PodGroup을 만들어 냅니다. 계층형 PodGroup은 아직 구현되지 않았습니다.

Kubeflow Trainer v2.3.0은 `TrainingRuntime.spec.podGroupPolicy`에서 `coscheduling`이나 `volcano`를 고릅니다. volcano 쪽에는 `networkTopology` 필드가 있어 HyperNode 제약을 런타임에 직접 넣을 수 있습니다. Kueue는 0.15부터 TrainJob의 TAS를 어노테이션으로 지원하고, KAI는 레거시 v1 PyTorchJob의 세그먼트를 지원합니다. Kubeflow 문서에도 KAI 연동 설명이 있습니다.

### 추론에서 토폴로지가 쓰이는 방식

LeaderWorkerSet v1.0.0은 `leaderworkerset.sigs.k8s.io/exclusive-topology`와 `subgroup-exclusive-topology` 어노테이션을 지원합니다. Kueue에서는 `podset-group-name`으로 leader와 worker를 같은 도메인에 두며, 0.20부터 그룹과 slice를 함께 쓸 수 있습니다. Volcano는 LWS v0.7부터 PodGroup을 자동으로 만들고, KAI는 세그먼트를 자동으로 지원합니다. 코어 native gang 통합은 alpha이며 opt-in입니다.

추론에서도 토폴로지가 필요합니다. Kueue 0.20의 Topology Spreading은 replica 자체가 함께 배치된 파드 묶음이라 PodTopologySpread로 표현할 수 없다는 데서 출발합니다. Volcano 1.16의 anti-affinity(서로 떨어뜨리는 배치 제약)는 추론 replica가 한 supernode에 몰려 장애 도메인을 공유하는 상황을 다룹니다. Grove는 NVLink 도메인 안 배치를 주요 동기로 듭니다.

이 설명을 종합하면 학습은 모으는 요구가 중심이고, 추론은 replica 안의 파드를 모으면서 replica 사이를 흩는 요구를 함께 갖는 듯합니다.

llm-d의 DisaggregatedSet 문서는 prefill/decode 슬라이스를 NVLink 도메인 라벨(GKE subblock, `topology.k8s.aws/network-node-layer-3`, `ultraserver-id`, `ds.coreweave.com/nvlink.domain`, `nvidia.com/gpu.clique`)에 required affinity로 묶고, 라우터에도 topology-affinity 플러그인을 둔다고 설명합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| JobSet | `exclusive-topology` 어노테이션, Kueue 어노테이션, `JobSetWorkloadAwareSchedulingAPI` alpha, composite PodGroup 미구현 | JobSet v0.13.0 릴리스 | `✓` |
| LWS | exclusive-topology 두 어노테이션, Kueue의 group-name과 그룹+slice(beta), Spreading(alpha), Volcano PodGroup 자동 생성(LWS v0.7), 코어 통합 alpha(KEP-666) | LWS v1.0.0 릴리스, Kueue·Volcano 릴리스 | `✓` |
| Trainer | `podGroupPolicy`(coscheduling·volcano), volcano 쪽 `networkTopology` 필드 | Trainer v2.3.0 타입 정의 | `✓` |
| KAI와 Kubeflow 연동 문서 | 있음. 내용은 프로젝트 설명 | Kubeflow 문서 | `Ⓥ` |
| 추론의 토폴로지 요구 | Kueue Spreading, Volcano anti-affinity, Grove의 동기 설명 | 각 릴리스·문서 | `✓` |
| pack과 spread 이중 요구 | 위 설명을 종합 | — | `≈` |
| llm-d DisaggregatedSet | NVLink 도메인 라벨에 required affinity, 라우터 플러그인 | llm-d 문서 | `Ⓥ` |

{{% /details %}}

## 4. 토폴로지의 층을 배치 규칙으로 바꾸기

Volcano는 Node와 하위 HyperNode를 묶은 트리로 배치 범위를 표현합니다. Koordinator는 노드 라벨 키를 토폴로지의 층에 대응시키고, 층마다 파드를 모으는 전략을 정합니다.

### Volcano가 관리하는 HyperNode 트리

Volcano 가이드는 클러스터마다 노드 라벨의 의미가 제각각이라는 점을 들어 토폴로지를 별도 CRD(사용자 정의 리소스)로 표현한다고 설명합니다. 그 단위가 클러스터 범위의 `HyperNode`(`topology.volcano.sh/v1alpha1`)입니다. 정수 필드 `spec.tier`는 층을 나타내며, 값이 낮을수록 노드에 가깝습니다. 멤버는 Node나 하위 HyperNode이고, 이름 일치·정규식·라벨 선택 중 하나로 고릅니다.

{{< flow src="_flow/2-hypernode-계층.json" />}}

도식의 계층을 Go 타입 정의와 주석 예시를 조합한 YAML로 나타내면 다음과 같습니다. 설계 문서의 약식 YAML과는 필드 이름이 다릅니다.

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

이 트리를 채우는 자동 발견 경로는 InfiniBand의 UFM과 노드 라벨뿐입니다. RoCE는 자동 발견 가이드에 "Currently not supported"라고 명시되어 있습니다. 1.16부터는 `custom.hypernode_controller_mode=standalone`으로 HyperNode 컨트롤러만 따로 배포할 수 있습니다. 다른 스케줄러도 API를 재사용하라는 뜻으로 읽힙니다.

트리가 준비되면 잡이나 PodGroup의 `networkTopology`로 배치 범위를 제한합니다. `mode: hard`는 잡 전체가 한 HyperNode 안에 들어가야 한다는 뜻이고, `soft`는 가능한 한 그렇게 배치하라는 뜻입니다. hard에서는 정수인 `highestTierAllowed`나 문자열인 `highestTierName`으로 올라갈 수 있는 층의 상한을 정합니다. `highestTierName`은 1.16 문서 기준으로 추가됐으며, 둘 중 하나만 지정할 수 있습니다.

태스크를 나누는 `partitionPolicy`(SubGroup)를 쓰면 파티션마다 gang과 토폴로지 제약을 따로 적용할 수 있습니다.

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

스케줄러에는 `network-topology-aware` 플러그인을 넣고 gang, binpack 플러그인과 같은 tier 구성에 둡니다. `hypernode.binpack.*` 인자로 CPU·메모리·`nvidia.com/gpu`의 가중치와 tier별 감쇠를 조정합니다.

모으는 배치 외에 흩는 배치도 지원합니다. 1.16의 anti-affinity는 추론 replica를 supernode별로 나누는 용도입니다. 적용 시점은 allocate 단계로 한정되며, backfill로 들어간 BestEffort 파드에는 보장이 없습니다. 이미 실행 중인 파드를 옮기지도 않습니다.

HyperNode 관련 기능은 다음 순서로 추가됐습니다.

| 버전 | 토폴로지 관련 변화 |
|---|---|
| 1.11 (2025-01) | HyperNode, hard·soft, `highestTierAllowed` 미리 보기 |
| 1.12 (2025-05) | UFM 자동 발견(alpha), HyperNode 수준 점수, 멤버 매칭 세 가지 |
| 1.13 (2025-09) | 라벨 기반 자동 발견, LWS v0.7이 Volcano PodGroup을 자동 생성 |
| 1.14 (2026-01) | SubGroup 토폴로지, Job과 SubGroup의 다층 gang, HyperNode binpack |
| 1.15 (2026-06) | gang 인지 preemption·reclaim(alpha), 토폴로지를 켜면 victim 탐색을 HyperNode 범위로 제한 |
| 1.16 (2026-10) | PodGroup 토폴로지 anti-affinity, HyperNode 컨트롤러 단독 배포, fairshare |

### Koordinator는 층마다 모으는 전략을 정한다

Koordinator는 1.7부터 네트워크 토폴로지 인지를 기본으로 켭니다. v1.8.0에서는 기존 파드 인지와 binpack을 개선했습니다. 이름이 `default`인 `ClusterNetworkTopology`가 라벨 키를 `SpineLayer`, `BlockLayer`, `NodeTopologyLayer` 같은 층에 대응시킵니다.

워크로드는 PodGroup 어노테이션에 층마다 모으는 전략을 적습니다.

```yaml
gang.scheduling.koordinator.sh/network-topology-spec: |
  {"gatherStrategy": [
     {"layer": "BlockLayer", "strategy": "PreferGather"},
     {"layer": "SpineLayer", "strategy": "PreferGather"}]}
```

`MustGather`를 쓰면 자원이 부족할 때 GangGroup 단위로 토폴로지를 인지한 preemption(선점)이 일어나며, 그 결과를 `.status.nominatedNode`에 기록합니다. 파드에는 rank 순서를 위한 `network-topology-index` 어노테이션이 붙습니다. 문서는 라벨 공급자로 Topograph를 안내하며, 라벨 키에는 옛 이름이 남아 있습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| HyperNode 스키마 | `topology.volcano.sh/v1alpha1`, 클러스터 범위, `tier`, `tierName`, `members[]`(Node 또는 HyperNode, exactMatch·regexMatch·labelMatch) | Volcano apis 타입 정의 | `✓` |
| YAML 예시의 출처 | Go 타입과 주석 예시를 조합해 만듦. 설계 문서의 약식 YAML은 그대로 쓰면 안 됨 | — | `≈` |
| `networkTopology` | mode hard·soft, `highestTierAllowed`와 `highestTierName`은 동시 지정 불가·hard에서만, `partitionPolicy` | Volcano 사용자 가이드 | `✓` |
| 플러그인 설정 | `network-topology-aware`, `hypernode.binpack.*`(CPU·메모리·GPU 가중치, tier별 감쇠) | 같은 가이드 | `✓` |
| 버전별 변화 | 1.11~1.16 표의 내용 | Volcano 릴리스 노트 | `✓` |
| 자동 발견 범위 | UFM(1.12~), 라벨(1.13~), RoCE 미지원 | HyperNode 자동 발견 가이드 | `✓` |
| 컨트롤러 단독 배포의 의도 | 다른 스케줄러가 API를 재사용하라는 뜻으로 읽음 | v1.16.0 릴리스 | `≈` |
| anti-affinity 한계 | allocate 단계만, backfill의 BestEffort 파드는 보장 없음, 실행 중 재배치 없음 | v1.16.0 릴리스 | `✓` |
| 라벨 방식의 의미가 제각각 | HyperNode를 택한 이유로 문서가 제시 | Volcano 가이드 | `Ⓥ` |
| Koordinator 활성화 | 1.7부터 기본(`--enable-network-topology-manager=true`, `awareNetworkTopology: true`), 1.8에서 기존 파드 인지·binpack 개선 | Koordinator 매뉴얼 | `✓` |
| 토폴로지 정의와 전략 | `ClusterNetworkTopology`, Spine·Block·NodeTopology 층, `PreferGather`·`MustGather`, nominatedNode, 순서 어노테이션 | 같은 매뉴얼 | `✓` |

{{% /details %}}

## 5. KAI로 배치하고 Grove로 추론 묶음을 표현한다

KAI는 스케줄러에서 토폴로지 배치를 처리하고, Grove는 멀티 파드 추론의 배치·기동·확장 요구를 API로 표현합니다. NVIDIA는 Dynamo의 멀티노드 배포 기본 경로를 Grove와 KAI로 설명합니다.

KAI Scheduler는 Run:ai 스케줄링 엔진의 오픈소스판이며 Run:ai 제품에도 계속 들어 있습니다. Apache 2.0 라이선스이고 kube-batch를 기반으로 합니다. CNCF Sandbox에는 2025-12-21에 들어갔습니다. 릴리스 정책은 v0.12부터 짝수 버전에 1년짜리 LTS를 적용하며, 현재 LTS는 v0.18입니다.

README는 gang, 계층형 큐와 quota, DRF, reclaim, 시간 기반 fairshare, consolidation, GPU 공유, DRA, TAS, NUMA 인지를 기능으로 나열합니다. Karpenter 같은 오토스케일러와 호환된다는 설명도 README의 주장입니다.

### 라벨 계층과 파드 묶음을 연결하는 KAI

KAI의 토폴로지 표현은 Kueue와 비슷합니다. `kai.scheduler/v1alpha1`의 `Topology` CRD가 노드 라벨 목록으로 levels를 정의하고, 워크로드는 어노테이션에 배치 요구를 적습니다.

```yaml
kai.scheduler/topology: "cluster-topology"
kai.scheduler/topology-required-placement: "cloud.provider.com/topology-block"
kai.scheduler/topology-preferred-placement: "cloud.provider.com/topology-rack"
```

도메인은 bin-packing(자원을 모아 채우는 배치)으로 고릅니다. 요청 대비 여유가 적은 도메인을 먼저 쓰고, 그 안에서는 preferred 레벨의 하위 도메인 중 여유가 많은 곳부터 채워 근접성을 높입니다.

TP(텐서 병렬) 그룹 단위로 배치하는 세그먼트도 있습니다. `kai.scheduler/segment-size` 등이 여기에 쓰이며, PyTorchJob과 LWS만 자동으로 지원합니다. 다른 워크로드는 PodGroup SubGroup을 직접 작성해야 합니다. v0.17부터는 level에 `rack` 같은 별칭(alias)을 줄 수 있습니다.

JobSet 매핑은 v0.16부터 지원합니다. JobSet당 PodGroup 하나를 만들고, replicatedJob별 부모 SubGroup 아래에 replica별 leaf SubGroup을 둡니다.

GPU 분할 모드는 `Disabled`, `NonMemoryEnforced`, `HamiCore`, `NvFractions`입니다. 기본값인 `NonMemoryEnforced`는 메모리를 격리하지 않으며, `HamiCore`는 HAMi-core로 CUDA 메모리를 격리합니다. `NvFractions`에는 CDI와 NRI가 필요합니다. 워크로드는 `gpu-fraction`이나 `gpu-memory` 어노테이션으로 요청합니다.

DRA는 기본 비활성입니다. 활성화하면 binder가 `BindRequest` CR로 ResourceClaim을 처리합니다. GB200의 MNNVL(멀티노드 NVLink)은 NVIDIA `k8s-dra-driver-gpu`의 ComputeDomain(IMEX 채널)으로 요청하며, 설치 전제는 GPU Operator입니다.

### Grove가 표현하는 추론 서비스의 계층

Grove는 `PodCliqueSet`, `PodCliqueScalingGroup`, `PodClique`와 스케줄러용 `PodGang`으로 계층형 gang, 토폴로지 배치, 기동 순서, 다단 오토스케일을 표현합니다. 관리자가 `ClusterTopologyBinding`으로 도메인 이름과 라벨 키를 짝지으면, 워크로드는 `packDomain: rack` 같은 도메인 이름을 씁니다.

GREP-375는 처음에 KAI를 유일한 백엔드로 서술했습니다. 현재 main에는 `kai`, `kube`, `kueue`, `volcano` 백엔드 코드가 있으며, alpha.16에서는 Kueue prebuilt workload 백엔드가 추가됐습니다. Grove는 아직 alpha입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| KAI 출신과 지위 | Run:ai 엔진 오픈소스판, Apache 2.0, kube-batch 기반, CNCF Sandbox(2025-12-21) | KAI README, CNCF | `✓` |
| KAI 저장소 이전 | `NVIDIA/KAI-Scheduler`에서 `kai-scheduler/KAI-Scheduler`로 이동. 옛 링크는 리다이렉트 | GitHub | `✓` |
| 릴리스 정책 | v0.12부터 짝수 LTS(1년), 현재 v0.18 LTS(2026-09~2027-09) | KAI 문서 | `✓` |
| Karpenter 등 오토스케일러 호환 | 프로젝트의 주장 | KAI README | `Ⓥ` |
| KAI TAS | `Topology` CRD, 세 어노테이션, 도메인 선택 규칙 | KAI 문서(v0.18.6) | `✓` |
| 세그먼트 | PyTorchJob·LWS만 자동, 나머지는 SubGroup 수작업 | 같은 문서 | `✓` |
| alias, JobSet 매핑 | alias는 v0.17, JobSet PodGroup 구조는 v0.16 | 같은 문서 | `✓` |
| GPU 분할 | 모드 네 가지, `gpu-fraction`·`gpu-memory` | KAI GPU 공유 문서 | `✓` |
| DRA | 기본 비활성, `BindRequest`, MNNVL은 ComputeDomain, 설치 전제 GPU Operator | KAI DRA 문서 | `✓` |
| Grove | v0.1.0-alpha.16(2026-10-15), 아직 alpha | Grove 저장소 | `✓` |
| Grove 구조와 토폴로지 | CRD 이름, `ClusterTopologyBinding`, `packDomain` | Grove 저장소, GREP-244 | `✓` |
| Grove 백엔드 | GREP-375는 KAI 단독, main에 kai·kube·kueue·volcano 코드, alpha.16에 Kueue prebuilt | Grove 저장소, GREP-375 | `✓` |
| Dynamo 기본 경로 | Grove와 KAI | 벤더 설명 | `Ⓥ` |

{{% /details %}}

## 6. Slurm의 배치를 Kubernetes에 연결하는 경로

토폴로지를 엄격하게 맞춰야 하는 대규모 학습에서는 Slurm도 계속 쓰입니다. SchedMD의 Slinky README는 기간이 정해지지 않고 자원 요구가 모호하며 단일 노드에서 느슨한 정책으로 돌아가는 워크로드에 Kubernetes가 강하다고 설명합니다. Slurm의 강점으로는 기간이 유한하고 자원과 토폴로지가 명확하며 여러 노드에서 엄격한 정책으로 도는 워크로드를 듭니다.

NVIDIA의 2025-12-15 SchedMD 인수를 다룬 보도들은 Slurm의 오픈소스와 벤더 중립을 유지한다는 발표를 함께 전합니다.

### Kubernetes와 비교할 때 남는 차이

Kubernetes 쪽에서 부족하다고 지적받던 기능도 변해 왔습니다. 관련 자료를 모은 2026-10의 상태는 다음과 같습니다.

| 지적 | 2026-10 현황 |
|---|---|
| 토폴로지 | 코어는 KEP-5732 alpha. 애드온은 Kueue TAS beta, Volcano HyperNode, KAI TAS, Koordinator. 표준 라벨 KEP는 폐기되어 라벨은 Topograph나 클라우드 CCM이 채움 |
| gang | 코어 Workload·PodGroup beta(기본 비활성). 애드온은 이전부터 지원 |
| gang 단위 preemption | 코어 beta, Volcano 1.15 alpha, Kueue는 워크로드 단위 evict |
| 시간 기반 backfill | Kueue, Volcano, KAI에서 잡 실행 시간 기반의 예약 backfill은 확인하지 못함 |
| 이력 감쇠 fairshare | Volcano 1.16 fairshare, KAI 시간 기반 fairshare, Kueue Admission Fair Sharing |

시간 기반 backfill은 구분해서 볼 필요가 있습니다. Slurm의 기본 backfill은 잡의 time limit을 근거로 예약 뒤의 빈 시간에 작은 잡을 넣는 방식으로 알려져 있지만, 이번 조사에서 설정 문서를 다시 확인하지는 않았습니다. Volcano에도 `backfill` action이 있으나 BestEffort 파드용으로 보이며, Slurm의 시간 기반 예약과 같은 개념인지는 확인하지 못했습니다.

Slurm의 토폴로지 배치는 `topology/tree`와 `topology/block`으로 나뉩니다. `topology/tree`는 요청을 만족하는 가장 낮은 스위치를 찾고, 그 아래 leaf에서 best-fit으로 할당합니다. `--switches=count[@time]`으로 leaf 수의 상한과 기다릴 시간을 지정합니다.

`topology/block`은 고정 block 계층에 패킹해 파편화를 줄입니다. `BlockSizes`로 허용 크기를 정하고 `--segment`로 할당 단위를 줍니다. 25.05부터는 `topology.yaml`로 한 클러스터에 여러 토폴로지를 두고 파티션별로 선택할 수 있으며, 동적 토폴로지도 지원합니다.

### Slurm을 어디에 둘 것인가

공존 방식은 Slurm을 Kubernetes 위에서 실행할지, Kubernetes 워크로드의 배치를 Slurm에 맡길지에 따라 달라집니다.

- Slurm을 Kubernetes 위에 올리는 방식. Slinky의 slurm-operator는 컨트롤러, `NodeSet`(slurmd 파드), `LoginSet`을 CRD로 만들고 HA, scale-to-zero, HPA를 지원합니다. 노드 어노테이션 `topology.slinky.slurm.net/spec`을 Slurm 동적 토폴로지로 동기화합니다. CoreWeave의 SUNK도 slurmd를 파드로 띄우며, `SlurmCluster`가 노드 라벨로 `topology.conf`를 만듭니다. 자동 생성 시에는 NVLink 도메인 라벨을 기준으로 Block을 정의하므로 NVL72 시스템 하나가 18노드 Block이 됩니다.
- Slurm을 Kubernetes의 스케줄러로 쓰는 방식. Slinky의 slurm-bridge는 Pod, PodGroup, Job, JobSet, LWS를 Slurm external job으로 번역합니다. slurmctld가 배치하고 bridge가 바인딩합니다. 하이브리드 노드는 시간 분할 방식이므로 같은 시점에 Slurm 잡과 Kubernetes 잡이 함께 돌 수는 없습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Kubernetes와 Slurm의 강점 구분 | 인용 구분은 SchedMD의 설명 | Slinky README | `Ⓥ` |
| NVIDIA의 SchedMD 인수 | 2025-12-15, 오픈소스·벤더 중립 유지 선언. TOP500 상위 10·상위 100의 절반 이상에서 Slurm 사용 | 인수 보도(heise, evertiq) | `Ⓥ` |
| Slurm 토폴로지 | tree, block, `--switches`, `BlockSizes`, `--segment`, 25.05의 `topology.yaml`·동적 토폴로지 | Slurm 26.05 문서 | `✓` |
| Slinky | slurm-operator CRD, 지원 버전 1.35~1.37, 토폴로지 어노테이션, `spec.syncTopology`, slurm-bridge 번역 대상, 시간 분할 | Slinky 저장소·문서 | `✓` |
| SUNK | NodeSet, Syncer, 파드 스케줄러, `ds.coreweave.com/nvlink.domain` 기준 Block, NVL72 = 18노드, 기본 `--segment=1` 권장 | CoreWeave SUNK 문서 | `✓` |
| SUNK 오픈소스 여부 | 확인하지 못함 | — | `?` |
| Kubernetes 현황 표 | 토폴로지, gang, preemption, fairshare 항목 | 앞 절의 자료 종합 | `≈` |
| 시간 기반 backfill | Slurm 기본 동작은 알려진 사실이나 이번 조사에서 문서 미재확인. 세 스케줄러의 구현은 찾지 못함 | — | `?` |

{{% /details %}}

## 7. 확인하지 못한 것

- Kueue, Volcano, KAI에 Slurm식 walltime 기반 예약 backfill이 있는지. 찾지 못했을 뿐 없다고 단정하지 않습니다.
- 스케줄러별 채택률을 담은 서베이. CNCF 서베이에도 없습니다.
- SUNK의 오픈소스 여부.
- 분산 KV 캐시 배치에서 토폴로지 인지 효과를 정량으로 다룬 자료.
- KubeCon Japan 2026 Kueue 발표의 실제 내용. 제목과 초록만 확인했습니다.
- Azure AKS의 토폴로지 라벨 키. Topograph provider 목록에도 Azure가 없습니다.

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
