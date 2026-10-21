---
title: "01 GPU 조합이 성능을 바꾸는 조건"
description: "GPU 네 장을 고를 때 조합까지 따져야 하는지는 노드 안의 연결 구조에 달려 있다. 2026-10-21 기준으로 HGX와 PCIe 서버의 차이에서 출발해 토폴로지 출력과 NCCL 로그로 경로와 제약을 확인하는 방법을 설명한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 1
url: "/kubernetes/gpu/01-node-topology/"
---

# 01 · GPU 조합이 성능을 바꾸는 조건

## 같은 네 장이어도 연결은 다를 수 있습니다 {#1-gpu-수만으로는-통신-조건이-정해지지-않는다}

파드에 `nvidia.com/gpu: 4`를 요청하면 GPU 네 장을 받습니다. 이 요청에는 어느 GPU끼리 연결돼 있어야 하는지까지 담겨 있지 않습니다. 노드 안의 GPU 쌍이 모두 같은 경로로 통신한다면 선택에 따른 차이는 작겠지만, PCIe 스위치나 CPU 소켓을 건너야 하는 쌍이 섞여 있다면 조합에 따라 지연과 대역폭이 달라질 수 있습니다.

HGX H100·H200의 8 GPU 베이스보드는 비교적 균일한 쪽입니다. NVIDIA Fabric Manager 사용자 가이드에 따르면 GPU 8장과 NVSwitch(NVLink 스위치) 4개로 구성되며, GPU마다 NVSwitch 두 개에는 NVLink를 4개씩, 나머지 두 개에는 5개씩 연결합니다. GPU당 18링크를 쓰는 구성입니다. H100 세대의 베이스보드 두 장을 NVLink로 잇는 구성은 지원하지 않습니다.

{{< flow src="_flow/2-hgx-nvswitch-구성.json" />}}

DGX BasePOD 배포 가이드의 DGX H100 예시도 GPU0 행을 `X NV18 NV18 NV18 NV18 NV18 NV18 NV18`로 보여 줍니다. 이 출력과 스위치 구조로부터 8장 중 어느 쌍을 골라도 GPU 사이 대역폭이 같을 것이라고 추정할 수 있습니다. 모든 조합을 측정해 확인한 결과는 아닙니다.

Blackwell HGX B200·B300은 NVSwitch 2개에 GPU당 NVLink를 각각 9개씩 연결합니다. 18링크라는 수는 Hopper와 같지만 링크당 속도는 다릅니다. 아래 표는 NVIDIA 제품 페이지와 DGX B200 사용자 가이드의 사양을 비교한 것입니다.

| 제품·세대 | NVIDIA가 제시한 연결 대역폭 | 조건 |
|---|---|---|
| Hopper | GPU당 NVLink 900 GB/s, 18링크 | NVLink 제품 페이지, "Preliminary specifications" |
| Blackwell | GPU당 NVLink 1,800 GB/s, 18링크 | 같은 페이지, "Preliminary specifications" |
| Vera Rubin | GPU당 NVLink 3,000 GB/s, 36링크 | 같은 페이지, "Preliminary specifications" |
| DGX B200 | 8 GPU 합계 14.4 TB/s | DGX B200 사용자 가이드, 5세대 NVLink 스위치 2개 |
| L40S | PCIe Gen4 x16 64GB/s 양방향 | L40S 제품 페이지, NVLink 미지원 |
| H100 NVL | 브리지 NVLink 600 GB/s, PCIe Gen5 128 GB/s | H100 제품 페이지, NVLink는 짝을 이룬 카드 사이의 연결 |
| H100 SXM | NVLink 900 GB/s | H100 제품 페이지 |

이 표의 값은 벤더 사양입니다. 특히 L40S처럼 NVLink가 없는 서버에서는 PCIe 링크의 대역폭 외에 GPU 사이에서 어떤 장치를 거치는지도 봐야 합니다. 같은 PCIe 스위치 아래의 GPU와 여러 스위치·루트 컴플렉스·소켓을 거치는 GPU는 통신 경로가 다릅니다.

{{< flow src="_flow/2-pcie-서버-구성.json" />}}

이 구조를 스케줄링에 적용하면 HGX에서는 GPU 조합보다 CPU와 NIC(네트워크 인터페이스 카드)의 NUMA(불균일 메모리 접근) 정렬을 살피게 됩니다. PCIe 서버와 NVLink 브리지 페어에서는 GPU 조합도 함께 살펴야 합니다. 이는 NVIDIA의 직접적인 권고가 아니라 앞의 구성에서 도출한 판단입니다. Kubernetes에서 실제 장치를 고르는 과정은 [02편]({{< relref "/platform/kubernetes/gpu/02-allocation-device-plugin/index.md" >}})과 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에 이어집니다.

GB200 NVL72에서는 NVLink가 노드 경계를 넘으므로 한 노드의 조합만으로 설명할 수 없습니다. AWS EKS 문서의 `p6e-gb200.36xlarge`는 인스턴스당 GPU 4장이고, `u-p6e-gb200x72` UltraServer는 이 인스턴스 18개를 묶습니다. 그 사이의 IMEX와 ComputeDomain은 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에서 다룹니다. NIC을 통한 노드 간 통신과 GPUDirect RDMA는 [06편]({{< relref "/platform/kubernetes/gpu/06-gpudirect-rdma-basics/index.md" >}})부터 설명합니다.

## NVSwitch 패브릭이 준비돼야 통신할 수 있습니다 {#2-nvswitch-연결을-사용할-수-있게-만드는-조건}

물리적으로 연결돼 있어도 Fabric Manager(FM)가 초기화하기 전에는 NVSwitch 패브릭을 사용할 수 없습니다. FM 사용자 가이드는 FM이 참여 GPU를 하나의 메모리 패브릭으로 묶고 NVLink를 감시한다고 설명합니다. 적용 대상은 NVSwitch 기반 단일 노드 HGX·DGX의 A100, H100·H200·H20·H800, B100·B200·B300 계열입니다. 대상 목록으로 볼 때 PCIe 서버와 NVLink 브리지 카드 구성은 여기에 포함되지 않는 것으로 해석됩니다.

애플리케이션이 FM보다 먼저 시작하면 CUDA 초기화가 `cudaErrorSystemNotReady`로 실패합니다. FM 서비스를 중지하면 패브릭 상태를 잃어 GPU 리셋도 필요합니다. GPU 노드를 기동할 때 드라이버뿐 아니라 FM 서비스의 준비 상태를 확인해야 하는 이유입니다.

Blackwell의 4세대 NVSwitch는 호스트에서 PCIe 장치로 보이지 않으며 CX7 브리지 장치로 접근합니다. 이 세대의 HGX에는 NVLink Subnet Manager(NVLSM)도 필요합니다. NVLSM은 스위치 라우팅 테이블을 관리하고, FM은 GPU 쪽 라우팅과 파티션 API를 담당합니다. 제공자가 이 서비스를 구성하는 과정은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})에서 다룹니다.

가상화에서는 패브릭을 관리하는 위치에 따라 게스트에 넘길 장치가 달라집니다.

| 모드 | 게스트에 넘기는 장치 | 패브릭 관리와 설정 |
|---|---|---|
| Full passthrough | GPU와 NVSwitch | GPU와 스위치를 함께 전달 |
| Shared NVSwitch | GPU | 신뢰된 Service VM에서 관리. FM 문서의 권장 옵션이며 `FABRIC_MODE=1` 사용 |
| vGPU 멀티테넌시 | SR-IOV VF | `FABRIC_MODE=2` 사용 |

FM 가이드 일부 절은 설정 키를 `SHARED_FABRIC_MODE`로 적고 있어 문서 안에서도 이름이 일치하지 않습니다.

Shared NVSwitch에서는 테넌트가 받을 GPU 조합을 미리 정한 파티션 표로 제한합니다. FM에서 파티션은 NVLink P2P(GPU 사이 직접 통신)를 허용하는 GPU 집합입니다. 8 GPU의 기본 표에는 8장짜리 1개, 4장짜리 2개, 2장짜리 4개, 1장짜리 8개가 있습니다. Koordinator의 GPU Partition API와 DRA의 `FabricManagerPartitioning` 게이트는 이 제약을 할당에 반영하기 위한 기능입니다. 각각 [02편]({{< relref "/platform/kubernetes/gpu/02-allocation-device-plugin/index.md" >}})과 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에서 확인할 수 있습니다.

MIG(GPU를 여러 인스턴스로 나누는 기능)를 켰다면 NVLink의 활성 상태와 MIG 인스턴스의 통신 지원을 별도로 확인해야 합니다. FM 가이드의 일반 MIG 상호운용 절(Interoperability With Multi-Instance GPUs)은 A100에서 MIG를 켜면 NVLink가 꺼지고 H100 이후에는 활성 상태를 유지한다고 설명합니다. 가상화 모드별 조건까지 모두 같다는 뜻으로 확대해서는 안 됩니다. 링크가 활성 상태여도 MIG 인스턴스 사이에서 GPU 전체를 쓸 때와 같은 통신이 가능한 것은 아닙니다.

MIG 사용자 가이드는 서로 다른 GPU의 MIG 인스턴스 사이와 MIG·비MIG GPU 사이의 P2P를 지원하지 않는다고 명시합니다. NCCL(GPU 집합통신 라이브러리)도 MIG를 지원하지 않습니다. CUDA IPC(프로세스 사이 통신)는 GPU 인스턴스(GI) 사이에서는 사용할 수 없고 컴퓨트 인스턴스(CI) 사이에서는 사용할 수 있습니다. GPUDirect RDMA는 GI에서 지원합니다. 이 제약을 고려하면 MIG는 추론이나 작은 작업을 나누는 용도로, 분산 학습은 GPU 한 장 단위로 다루는 편이 적합하다고 판단됩니다.

## topo 출력으로 GPU·CPU·NIC의 위치를 확인합니다 {#3-gpu에서-cpu와-nic까지-경로를-읽는다}

`nvidia-smi topo -m`은 GPU와 NIC을 행과 열에 놓고 각 쌍의 경로를 기호로 표시합니다. 오른쪽의 `CPU Affinity`, `NUMA Affinity`, `GPU NUMA ID` 열은 CPU와의 관계를 보여 줍니다. DGX BasePOD 가이드의 DGX H100 예시에서 GPU0의 CPU Affinity는 `0-55,112-167`, NUMA Affinity는 `0`입니다. GPU0–NIC0 경로는 `PXB`이고 다른 NIC으로 가는 경로는 `NODE`입니다.

다음 범례는 NVIDIA 공식 문서 한 페이지에서 원문을 찾지 못해 도구 출력과 HPC Advisory Council 위키를 대조한 것입니다.

| 기호 | 경로 | 위치 |
|---|---|---|
| X | 자기 자신 | |
| NV# | NVLink # 개를 묶은 연결 | 가장 빠름. NV18은 18링크 |
| PIX | PCIe 브리지를 최대 1개 통과 | 같은 PCIe 스위치 아래 |
| PXB | PCIe 브리지를 여러 개 통과, 호스트 브리지는 통과 안 함 | 다단 PCIe 스위치 |
| PHB | PCIe 호스트 브리지(보통 CPU)를 통과 | 루트 컴플렉스를 거침 |
| NODE | 같은 NUMA 노드 안에서 호스트 브리지 사이를 통과 | 같은 소켓, 다른 루트 |
| SYS | NUMA 노드 사이 SMP 인터커넥트(QPI/UPI)를 통과 | 소켓을 건넘, 가장 느림 |

NCCL의 `NCCL_P2P_LEVEL`은 LOC, NVL, PIX, PXB, PHB, SYS로 P2P를 허용할 최대 거리를 지정합니다. topo 출력과 이 값을 함께 읽으면 NCCL이 노드 안의 어느 경로까지 P2P로 사용할 수 있는지 판단하는 데 도움이 됩니다. P2P 가능 여부만 확인하려면 `nvidia-smi topo -p2p p`를 씁니다.

CPU와 메모리의 배치도 통신 성능에 영향을 줍니다. NCCL performance and tuning 문서는 "Incorrect process placement ... serious performance impact"라고 경고하며, 각 rank(통신에 참여하는 프로세스)를 해당 GPU와 NIC에 가까운 코어에 두도록 설명합니다. 메모리도 GPU에 가까운 NUMA 노드에 배치해야 합니다.

NCCL은 기본적으로 런처가 물려준 CPU 어피니티와 GPU 어피니티의 교집합을 사용합니다. `NCCL_IGNORE_CPU_AFFINITY=1`은 GPU 어피니티만 사용하게 하지만 cpuset·cgroup·컨테이너 제한을 넘지는 못합니다. CPU Manager의 static 정책 없이 파드에 모든 코어를 허용하면 교집합에 먼 NUMA 노드의 코어가 섞일 가능성이 있습니다. 이 시나리오는 문서에 직접 나온 설명이 아니라 어피니티 동작에서 추정한 것입니다.

실제 배치는 NCCL이 GPU마다 선택한 CPU 어피니티 로그와 코어의 NUMA·소켓 소속을 대조합니다.

```bash
# NCCL이 GPU마다 고른 CPU 어피니티 로그
NCCL_DEBUG=INFO NCCL_DEBUG_SUBSYS=INIT,GRAPH,ENV ./my_app
# 로그에서 "ncclTopoGetCpuAffinity: Affinity for GPU ..." 줄 확인

# 코어가 어느 NUMA 노드와 소켓에 속하는지
lscpu --extended=CPU,NODE,SOCKET,CORE
```

같은 소켓과 원격 소켓의 대역폭 차이는 `nvbandwidth`나 `nccl-tests`로 측정해야 합니다. 이 차이의 정량값을 제시한 NVIDIA 1차 자료는 찾지 못했습니다.

## NCCL 로그에서 선택한 전송 경로를 확인합니다 {#4-nccl이-실제로-고른-길을-로그에서-찾는다}

NCCL은 `/sys`에서 GPU와 NIC의 PCI 토폴로지를 읽습니다. NCCL GPU troubleshooting 문서에 따르면 컨테이너나 VM에 `/sys`가 제대로 마운트되지 않거나 가상 PCI 토폴로지만 보일 때 탐지가 어긋나 성능이 떨어질 수 있습니다. 격리형 런타임이나 VM에서 GPU 파드를 실행한다면 호스트에서 확인한 구조가 컨테이너에도 보이는지 점검할 필요가 있습니다.

탐지한 구조를 바탕으로 NCCL은 Ring, Tree, NVLS(NVLink SHARP) 같은 통신 그래프를 만들고 연결마다 transport(데이터 전송 경로)를 선택합니다. GPU 거리가 `NCCL_P2P_LEVEL` 이내이면 P2P를 사용하며, 범위를 벗어나거나 P2P가 막혀 있으면 다른 경로를 사용합니다. 다음 도식은 P2P 레벨 정의와 환경변수 설명을 종합해 단순화한 판정 흐름입니다.

{{< flow src="_flow/4-nccl-경로-판정.json" />}}

선택 결과는 `NCCL_DEBUG=INFO NCCL_DEBUG_SUBSYS=GRAPH`로 확인합니다. 다음 네 줄은 NCCL logging 문서의 예시 로그입니다.

```text
node-01:1895811:1895822 [0] NCCL INFO Tree 0 : -1 -> 0 -> 1/-1/-1
node-01:1895811:1895822 [0] NCCL INFO Ring 00 : 1 -> 0 -> 1
node-01:631398:631398 [0] NCCL INFO Channel 00/0 : 0[0] -> 1[1] via P2P/CUMEM
node-01:1538174:1538174 [0] NCCL INFO NVLS Creating Multicast group nranks 8 size 2097152 on rank 0
```

여러 파드의 출력이 섞일 때는 같은 문서가 안내하는 `NCCL_DEBUG_FILE=/tmp/nccl_%h_%p.log`를 사용해 프로세스별 파일로 나눌 수 있습니다. `NCCL_GRAPH_FILE`과 `NCCL_GRAPH_DUMP_FILE`은 현행 환경변수 문서에서 확인하지 못했습니다.

## 예상과 다른 경로가 선택됐을 때 {#5-기대한-경로가-나오지-않을-때-확인할-설정}

예상한 P2P 경로가 보이지 않으면 호스트의 IOMMU와 PCIe 스위치의 ACS를 확인합니다. NCCL GPU troubleshooting 문서는 베어메탈의 IOMMU translated 모드에서 PCIe P2P를 지원하지 않는다고 명시합니다. PCIe 스위치의 ACS는 꺼야 하지만 VM에서는 ACS가 필요하므로 환경을 구분해야 합니다. 다음 명령으로 IOMMU 로그와 ACS 상태를 확인합니다.

```bash
dmesg | grep -i -E "iommu|dmar|default domain"
sudo lspci -vvv | grep ACSCtl
```

NCCL의 탐지 결과는 `NCCL_TOPO_DUMP_FILE`로 XML에 저장할 수 있고, 점검한 파일은 `NCCL_TOPO_FILE`로 지정해 읽을 수 있습니다. 가상화 환경에서 토폴로지를 점검할 때 사용할 수 있는 방법입니다. MNNVL(멀티노드 NVLink)의 덤프에는 NVLink 도메인 전체가 포함되므로, 재사용하려면 한 호스트 분량으로 줄여야 합니다.

경로와 알고리즘을 조정하는 변수는 아래 표와 같습니다. 의미와 기본값은 NCCL 2.32 환경변수 문서 기준입니다.

| 변수 | 의미 | 기본값 |
|---|---|---|
| `NCCL_P2P_LEVEL` | P2P를 쓸 최대 GPU 거리 | 아키텍처와 환경에 따라 자동 |
| `NCCL_P2P_DISABLE` | 1이면 P2P transport 비활성화 | 미설정 시 P2P 사용 허용 |
| `NCCL_SHM_DISABLE` | 1이면 공유메모리 transport 비활성화, 소켓 간은 네트워크로 | 미설정 시 SHM 사용 허용 |
| `NCCL_TOPO_FILE` | 탐지 전에 읽을 토폴로지 XML | `/var/run/nvidia-topologyd/virtualTopology.xml`이 있으면 자동 로드 |
| `NCCL_TOPO_DUMP_FILE` | 탐지 결과를 XML로 덤프 | 미설정 |
| `NCCL_NVLS_ENABLE` | NVLink SHARP(NVSwitch 인스위치 리덕션) 사용, 2.17부터 | 2 |
| `NCCL_ALGO`, `NCCL_PROTO` | 알고리즘과 프로토콜 제한 | 미설정이면 토폴로지 기반 자동 |
| `NCCL_NET_GDR_LEVEL` | NIC과 GPU 거리가 얼마까지 GPUDirect RDMA를 쓸지 | 자동 |
| `NCCL_CROSS_NIC` | 링과 트리가 노드마다 다른 NIC을 써도 되는지 | 2 |
| `NCCL_IGNORE_CPU_AFFINITY` | 상속된 CPU 어피니티 무시 | 0 |

GPUDirect RDMA에서는 NCCL이 DMA-BUF를 자동 탐지하면 `nvidia-peermem`이 필요 없다고 GPU troubleshooting 문서가 설명합니다. NIC을 파드에 연결하는 과정과 직접 전송 여부의 확인은 [06편]({{< relref "/platform/kubernetes/gpu/06-gpudirect-rdma-basics/index.md" >}})과 [07편]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}})으로 이어집니다.

## 조사 범위와 아직 확인하지 못한 조건 {#6-확인하지-못한-것}

조사 기준일은 2026-10-21입니다. 당시 프로젝트 릴리스에서 확인한 stable 버전은 Kubernetes v1.37.1, GPU Operator v26.7.2, NCCL v2.32.3-1이며 CUDA Toolkit은 13.4 Update 2입니다. NVIDIA 지원 드라이버 표(2026-09-09 갱신)는 R580 LTSB의 EOL을 2028-06, R595 Production을 2027-03, R610 New Feature를 2026-08로 표기합니다.

이 글은 NVIDIA 공식 문서와 프로젝트 릴리스를 바탕으로 작성했으며, 제품 사양과 문서에서 도출한 추정은 실측과 구분했습니다. 다음 항목은 이번 자료에서 확인하지 못했습니다.

- `nvidia-smi topo -m` 범례를 모은 NVIDIA 공식 원문. 위 범례는 도구 출력과 커뮤니티 위키를 대조했으므로 실제 노드 출력도 확인해야 합니다.
- 같은 소켓과 원격 소켓에 놓인 GPU·NIC의 성능 차이를 보여 주는 NVIDIA 1차 수치.
- Fabric Manager와 드라이버 버전의 정확한 일치 요건.
- GB200 NVL72에서 FM과 NMX가 실행되는 트레이, NVLSM의 정확한 배치.
- `NCCL_MNNVL_ENABLE`의 기본값, `NCCL_GRAPH_FILE`·`NCCL_GRAPH_DUMP_FILE`의 현행 문서 수록 여부.
- NVLS를 컨테이너에서 사용할 때 IMEX 채널 등이 추가로 필요한지.

## 참고 자료

- [NVIDIA NVLink](https://www.nvidia.com/en-us/data-center/nvlink/)
- [NVIDIA GB200 NVL72](https://www.nvidia.com/en-us/data-center/gb200-nvl72/)
- [NVIDIA H100](https://www.nvidia.com/en-us/data-center/h100/)
- [NVIDIA L40S](https://www.nvidia.com/en-us/data-center/l40s/)
- [Fabric Manager User Guide](https://docs.nvidia.com/datacenter/tesla/fabric-manager-user-guide/index.html)
- [DGX B200 User Guide](https://docs.nvidia.com/dgx/dgxb200-user-guide/introduction-to-dgxb200.html)
- [DGX BasePOD — NVLink](https://docs.nvidia.com/dgx-basepod/deployment-guide-dgx-basepod/latest/nvlink.html)
- [MIG User Guide — Deployment Considerations](https://docs.nvidia.com/datacenter/tesla/mig-user-guide/deployment-considerations.html)
- [HPC Advisory Council — PCI Switch, CPU and GPU Direct server topology](https://hpcadvisorycouncil.atlassian.net/wiki/spaces/HPCWORKS/pages/1675034639/PCI+Switch+CPU+and+GPU+Direct+server+topology)
- [NCCL — Environment Variables](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/env.html)
- [NCCL — Logging](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/logging.html)
- [NCCL — GPU Troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/gpu_troubleshooting.html)
- [NCCL — Performance and Tuning](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/performance_and_tuning.html)
- [AWS EKS — NVIDIA UltraServer](https://docs.aws.amazon.com/eks/latest/userguide/ml-eks-nvidia-ultraserver.html)
- [Kubernetes 릴리스](https://github.com/kubernetes/kubernetes/releases)
- [NVIDIA GPU Operator 릴리스](https://github.com/NVIDIA/gpu-operator/releases)
- [NCCL 릴리스](https://github.com/NVIDIA/nccl/releases)
- [NVIDIA 지원 드라이버와 CUDA Toolkit 버전](https://docs.nvidia.com/datacenter/tesla/drivers/supported-drivers-and-cuda-toolkit-versions.html)
- [CUDA Toolkit 릴리스 노트](https://docs.nvidia.com/cuda/cuda-toolkit-release-notes/index.html)
