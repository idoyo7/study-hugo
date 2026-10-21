---
title: "01 GPU 조합이 성능을 바꾸는 조건"
description: "GPU 네 장을 고를 때 조합까지 따져야 하는지는 노드 안의 연결 구조에 달려 있다. 2026-10-21 기준으로 HGX와 PCIe 서버의 차이에서 출발해 토폴로지 출력과 NCCL 로그로 경로와 제약을 확인하는 방법을 설명한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 1
url: "/kubernetes/gpu/01-node-topology/"
---

# 01 · GPU 조합이 성능을 바꾸는 조건

## 1. GPU 수만으로는 통신 조건이 정해지지 않는다

파드에 `nvidia.com/gpu: 4`를 요청하면 GPU 수는 정해집니다. 어느 네 장을 받아도 집합통신 성능이 같을까요? 답은 노드 안 토폴로지(장치 사이의 연결 구조)가 균일한지에 달려 있습니다. GPU 사이 경로가 균일한 노드에서는 선택의 영향이 작습니다. 쌍마다 경로가 다른 노드에서는 조합이 성능을 바꿉니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-21이며 NVIDIA 공식 문서(Fabric Manager, NCCL, MIG, DGX 가이드)와 각 프로젝트 릴리스 페이지를 봤습니다.

HGX H100·H200 8 GPU 베이스보드는 GPU 8장과 NVSwitch(NVLink 스위치) 4개로 이뤄집니다. Fabric Manager 사용자 가이드에 따르면 GPU마다 NVSwitch 두 개에 NVLink를 4개씩, 나머지 두 개에 5개씩 연결해 모두 18링크를 씁니다. DGX H100의 `nvidia-smi topo -m` 출력에서도 모든 GPU 쌍이 `NV18`로 표시됩니다. 스위치 구성과 균일한 출력을 근거로, 8장 중 어느 쌍을 골라도 GPU 사이 대역폭이 같다고 추정할 수 있습니다.

{{< flow src="_flow/2-hgx-nvswitch-구성.json" />}}

Blackwell HGX B200·B300은 NVSwitch 2개를 쓰며, GPU마다 각 스위치에 NVLink를 9개씩 연결합니다. GPU당 18링크라는 수는 같고 링크당 속도가 달라집니다. NVIDIA 제품 페이지가 제시하는 GPU당 NVLink 대역폭은 Hopper 900 GB/s, Blackwell 1,800 GB/s입니다. 두 수치에는 모두 "Preliminary specifications" 표기가 붙어 있습니다.

PCIe 전용 서버는 사정이 다릅니다. NVIDIA L40S 제품 페이지에 따르면 L40S는 NVLink를 지원하지 않으며, PCIe Gen4 x16의 64GB/s 양방향이 GPU 간 경로의 상한입니다. NVIDIA H100 제품 페이지가 제시하는 H100 NVL의 브리지 NVLink 대역폭은 600 GB/s이지만, 이 연결은 짝을 이룬 카드 사이에만 해당합니다.

PCIe 서버의 GPU 쌍은 같은 PCIe 스위치 아래에 있을 수도 있고, 여러 스위치나 서로 다른 루트 컴플렉스를 거쳐 연결될 수도 있습니다. 소켓까지 건너는 경로도 있으므로, 쌍마다 지연과 대역폭이 달라집니다.

{{< flow src="_flow/2-pcie-서버-구성.json" />}}

구조로 보면 HGX에서는 GPU 선택이 성능에 거의 영향을 주지 않아 CPU와 NIC(네트워크 인터페이스 카드)의 NUMA(불균일 메모리 접근) 정렬이 남습니다. PCIe 서버나 NVLink 브리지 페어에서는 GPU 조합 자체가 중요합니다. 이는 NVIDIA 문서의 서술이 아니라 위 구조에서 끌어낸 판단입니다. 이 구조를 Kubernetes가 어떻게 알고 GPU를 나눠 주는지는 [02편]({{< relref "/platform/kubernetes/gpu/02-allocation-device-plugin/index.md" >}})과 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에서 이어집니다.

GB200 NVL72에서는 NVLink 연결이 노드 경계를 넘습니다. AWS 문서에 따르면 `p6e-gb200.36xlarge` 인스턴스 하나에 GPU 4장이 있고, UltraServer는 이런 인스턴스 18개로 구성됩니다. 인스턴스 사이를 NVLink로 묶는 방식은 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에서 다룹니다. IMEX와 ComputeDomain도 그 범위에 속합니다.

노드 사이를 잇는 NIC과 GPUDirect RDMA는 [06편]({{< relref "/platform/kubernetes/gpu/06-gpudirect-rdma-basics/index.md" >}})부터, 제공자가 Fabric Manager를 운영하는 쪽은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})에서 봅니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 조사 시점의 stable 버전 | Kubernetes v1.37.1, GPU Operator v26.7.2, NCCL v2.32.3-1 | 각 프로젝트 GitHub 릴리스 | `✓` |
| 드라이버 브랜치 | R580 LTSB(EOL 2028-06), R595 Production(EOL 2027-03), R610 New Feature(EOL 2026-08) | NVIDIA 지원 드라이버 표(2026-09-09 갱신) | `✓` |
| CUDA Toolkit | 13.4 Update 2 | CUDA Toolkit 릴리스 노트 | `✓` |
| HGX H100·H200 구성 | GPU 8장, NVSwitch 4개, GPU당 18링크(4개씩 두 스위치, 5개씩 두 스위치) | Fabric Manager User Guide | `✓` |
| H100 세대 베이스보드 두 장 연결 | NVLink로 잇는 구성은 미지원 | Fabric Manager User Guide | `✓` |
| DGX H100 topo 출력 | GPU0 행이 `X NV18 NV18 NV18 NV18 NV18 NV18 NV18`, CPU Affinity `0-55,112-167`, NUMA Affinity `0` | DGX BasePOD 배포 가이드 | `✓` |
| 8장 중 어느 쌍이든 대역폭 동일 | NV18 균일 출력과 스위치 구조에서 도출 | — | `≈` |
| HGX B200·B300 구성 | GPU마다 NVSwitch 2개 각각에 NVLink 9개 | Fabric Manager User Guide | `✓` |
| DGX B200 NVLink | 5세대 NVLink 스위치 2개, 8 GPU 합계 14.4 TB/s | DGX B200 사용자 가이드 | `Ⓥ` |
| 세대별 GPU당 NVLink 대역폭 | Hopper 900 GB/s(18링크), Blackwell 1,800 GB/s(18링크), Vera Rubin 3,000 GB/s(36링크). "Preliminary specifications" | NVIDIA NVLink 제품 페이지 | `Ⓥ` |
| L40S | PCIe Gen4 x16 64GB/s 양방향, NVLink 미지원 | NVIDIA L40S 제품 페이지 | `Ⓥ` |
| H100 NVL | 브리지 NVLink 600 GB/s, PCIe Gen5 128 GB/s. H100 SXM은 NVLink 900 GB/s | NVIDIA H100 제품 페이지 | `Ⓥ` |
| PCIe 서버에서 쌍마다 경로가 갈림 | PIX·PXB·NODE·SYS 구분에서 종합 | topo 범례와 NCCL P2P 레벨 정의 | `≈` |
| HGX와 PCIe 서버의 스케줄링 관점 차이 | HGX는 NUMA 정렬만, PCIe 서버는 GPU 조합이 중요 | — | `≈` |
| GB200 NVL72 인스턴스 구성 | `p6e-gb200.36xlarge` = GPU 4장, `u-p6e-gb200x72` UltraServer = 인스턴스 18개 | AWS EKS 문서 NVIDIA UltraServer | `✓` |

{{% /details %}}

## 2. NVSwitch 연결을 사용할 수 있게 만드는 조건

NVSwitch로 연결된 GPU를 애플리케이션이 사용하려면 Fabric Manager(FM)의 초기화가 끝나 있어야 합니다. FM 사용자 가이드는 FM이 NVSwitch 메모리 패브릭을 설정해 참여 GPU를 하나의 메모리 패브릭으로 묶고, NVLink를 감시한다고 설명합니다. 적용 대상은 NVSwitch 기반 단일 노드 HGX와 DGX의 A100, H100·H200, B100·B200·B300 계열입니다. PCIe 서버나 NVLink 브리지 카드 구성은 이 적용 대상에 들지 않는 것으로 읽힙니다.

FM 초기화 전에 애플리케이션이 뜨면 CUDA 초기화가 `cudaErrorSystemNotReady`로 실패합니다. FM 서비스를 멈추면 패브릭 상태를 잃으므로 GPU 리셋이 필요합니다. GPU 노드의 기동 순서에 드라이버와 FM 서비스를 함께 넣어야 하는 이유입니다.

Blackwell HGX에는 NVLink Subnet Manager(NVLSM)도 필요합니다. 4세대 NVSwitch(Blackwell)부터는 NVSwitch가 호스트에서 PCIe 장치로 보이지 않고 CX7 브리지 장치로 접근합니다. FM 가이드가 정한 역할에 따라 NVLSM은 스위치 라우팅 테이블을, FM은 GPU 쪽 라우팅과 파티션 API를 맡습니다. 이 운영 방식은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})에서 제공자 관점으로 다시 다룹니다.

가상화 환경에서는 패브릭을 어디에서 관리하는지에 따라 게스트에 넘기는 장치의 범위가 달라집니다.

- Full passthrough: GPU와 NVSwitch를 함께 게스트에 넘긴다.
- Shared NVSwitch: GPU만 게스트에 넘기고 패브릭은 신뢰된 Service VM이 관리한다. 문서가 권장 옵션으로 표기한다.
- vGPU 멀티테넌시: SR-IOV VF만 게스트에 넘긴다.

설정 키는 `FABRIC_MODE=1`(Shared NVSwitch)과 `FABRIC_MODE=2`(vGPU)입니다. FM 가이드 일부 절에서는 `SHARED_FABRIC_MODE`라는 이름을 써서 문서 안에서도 표기가 일치하지 않습니다.

Shared NVSwitch에서 테넌트에게 줄 GPU 조합은 미리 정한 파티션 표로 제한됩니다. FM 가이드는 파티션을 NVLink P2P(GPU 사이 직접 통신)가 허용된 GPU 집합으로 정의하고, 미리 정한 파티션 표 안에서 GPU 조합을 제한합니다. 8 GPU 기본 파티션은 8장짜리 1개, 4장짜리 2개, 2장짜리 4개, 1장짜리 8개입니다. Koordinator의 GPU Partition API와 DRA 드라이버의 `FabricManagerPartitioning` 게이트는 이런 제약을 배경으로 나왔습니다. 이 파티션을 GPU 할당에 반영하는 방식은 [02편]({{< relref "/platform/kubernetes/gpu/02-allocation-device-plugin/index.md" >}})과 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에서 다룹니다.

MIG(GPU를 여러 인스턴스로 나누는 기능)를 쓸 때도 링크의 활성 상태와 인스턴스 사이 통신 지원을 구분해야 합니다. FM 가이드에 따르면 A100은 MIG를 켜면 GPU NVLink가 꺼지고, H100부터는 MIG 모드에서도 NVLink가 활성 상태로 남습니다.

MIG 사용자 가이드는 서로 다른 GPU에 있는 MIG 인스턴스 사이, 그리고 MIG 인스턴스와 비MIG GPU 사이의 P2P를 지원하지 않는다고 명시합니다. NCCL(GPU 집합통신 라이브러리)도 MIG를 지원하지 않습니다. CUDA IPC(프로세스 사이 통신)는 GPU 인스턴스 사이에서는 사용할 수 없고 컴퓨트 인스턴스 사이에서는 사용할 수 있습니다. 이 제약에서 도출되는 판단은 MIG를 추론이나 작은 작업의 분할에 쓰고, 분산 학습은 GPU 한 장 단위로 다뤄야 한다는 것입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| FM의 역할 | NVSwitch 메모리 패브릭을 설정해 참여 GPU를 하나의 메모리 패브릭으로 묶고 NVLink를 감시 | Fabric Manager User Guide | `✓` |
| FM 대상 | NVSwitch 기반 단일 노드 HGX/DGX(A100, H100·H200·H20·H800, B100·B200·B300) | Fabric Manager User Guide | `✓` |
| PCIe 서버·브리지 카드에는 해당 없음 | 대상 목록에서 도출 | — | `≈` |
| FM 없이 기동 | FM 초기화 전에 앱이 뜨면 `cudaErrorSystemNotReady`. FM 서비스를 멈추면 패브릭 상태를 잃어 GPU 리셋 필요 | Fabric Manager User Guide | `✓` |
| Blackwell HGX | FM과 NVLSM 필요. NVLSM은 스위치 라우팅 테이블, FM은 GPU 쪽 라우팅·파티션 API | Fabric Manager User Guide | `✓` |
| 4세대 NVSwitch 접근 | PCIe 장치로 보이지 않고 CX7 브리지 장치로 접근. 라우팅 테이블은 NVLSM, GPU 쪽 라우팅·파티션 API는 FM | Fabric Manager User Guide | `✓` |
| 가상화 모드 세 가지 | Full passthrough, Shared NVSwitch(권장 옵션으로 표기), vGPU 멀티테넌시. `FABRIC_MODE=1`/`2`, 일부 절은 `SHARED_FABRIC_MODE` 표기 | Fabric Manager User Guide | `✓` |
| 파티션 정의와 기본 표 | NVLink P2P가 허용된 GPU 집합. 8 GPU 기본: 8장 1개, 4장 2개, 2장 4개, 1장 8개 | Fabric Manager User Guide | `✓` |
| MIG 모드의 NVLink | A100은 MIG를 켜면 NVLink가 꺼짐, H100 이후는 활성 유지 | Fabric Manager User Guide | `✓` |
| MIG의 P2P·NCCL 제약 | 다른 GPU의 MIG 인스턴스 사이, MIG와 비MIG 사이 P2P 미지원. NCCL은 MIG 미지원. CUDA IPC는 GI 간 불가, CI 간 가능. GPUDirect RDMA는 GI에서 지원 | MIG User Guide deployment considerations | `✓` |
| MIG는 분산 학습에 맞지 않음 | 위 제약에서 도출 | — | `≈` |
| Fabric Manager와 드라이버 버전 일치 요건 | 원문 확인 못 함 | — | `?` |

{{% /details %}}

## 3. GPU에서 CPU와 NIC까지 경로를 읽는다

`nvidia-smi topo -m`은 GPU끼리의 연결뿐 아니라 GPU에서 CPU와 NIC으로 가는 경로를 읽는 출발점입니다. GPU와 NIC을 행과 열에 놓고 각 쌍의 연결을 기호로 표시하며, 오른쪽 끝에는 `CPU Affinity`, `NUMA Affinity`, `GPU NUMA ID` 열을 보여 줍니다. DGX BasePOD 배포 가이드의 DGX H100 예시에서 GPU0과 NIC0은 `PXB`, 다른 NIC은 `NODE`로 표시됩니다.

아래 범례는 NVIDIA 문서에서 원문을 찾지 못해 도구 출력과 HPC Advisory Council 위키로 대조한 것입니다.

| 기호 | 경로 | 위치 |
|---|---|---|
| X | 자기 자신 | |
| NV# | NVLink # 개를 묶은 연결 | 가장 빠름. NV18은 18링크 |
| PIX | PCIe 브리지를 최대 1개 통과 | 같은 PCIe 스위치 아래 |
| PXB | PCIe 브리지를 여러 개 통과, 호스트 브리지는 통과 안 함 | 다단 PCIe 스위치 |
| PHB | PCIe 호스트 브리지(보통 CPU)를 통과 | 루트 컴플렉스를 거침 |
| NODE | 같은 NUMA 노드 안에서 호스트 브리지 사이를 통과 | 같은 소켓, 다른 루트 |
| SYS | NUMA 노드 사이 SMP 인터커넥트(QPI/UPI)를 통과 | 소켓을 건넘, 가장 느림 |

NCCL의 `NCCL_P2P_LEVEL`도 LOC, NVL, PIX, PXB, PHB, SYS라는 값을 씁니다. 같은 어휘를 사용하므로 topo 출력은 NCCL이 노드 안에서 어디까지 P2P를 허용할지 정하는 기준표로도 읽힙니다. P2P 가능 여부만 따로 확인할 때는 `nvidia-smi topo -p2p p`를 씁니다.

GPU 사이 경로를 확인했어도 CPU와 메모리의 NUMA 배치는 남습니다. NCCL 성능 문서는 프로세스의 CPU·메모리 배치가 틀리면 성능에 심각한 영향이 있다고 경고합니다. 각 rank(통신에 참여하는 프로세스)는 자기 GPU에 가까운 코어와 메모리를 써야 하며, 멀티노드에서는 NIC의 위치도 고려해야 합니다.

NCCL은 기본적으로 런처가 물려준 CPU 어피니티와 GPU 어피니티의 교집합을 사용합니다. `NCCL_IGNORE_CPU_AFFINITY=1`을 주면 GPU 어피니티만 쓰지만, cpuset과 cgroup, 컨테이너 제한을 넘을 수는 없습니다. 이 동작에서 추정하면 CPU Manager의 static 정책 없이 파드가 모든 코어를 쓸 수 있을 때 교집합이 넓어져 먼 NUMA 노드의 코어가 섞일 수 있습니다. 문서에 이 시나리오가 직접 쓰여 있지는 않습니다.

배치를 확인하려면 NCCL이 GPU마다 고른 CPU 어피니티 로그와 코어의 NUMA·소켓 소속을 대조합니다.

```bash
# NCCL이 GPU마다 고른 CPU 어피니티 로그
NCCL_DEBUG=INFO NCCL_DEBUG_SUBSYS=INIT,GRAPH,ENV ./my_app
# 로그에서 "ncclTopoGetCpuAffinity: Affinity for GPU ..." 줄 확인

# 코어가 어느 NUMA 노드와 소켓에 속하는지
lscpu --extended=CPU,NODE,SOCKET,CORE
```

같은 소켓과 원격 소켓 사이의 대역폭 차이를 수치로 확인하려면 `nvbandwidth`나 `nccl-tests`로 직접 재야 합니다. 이 차이를 보여 주는 NVIDIA 1차 자료는 찾지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| topo 출력 구성 | GPU·NIC 행열, 끝에 CPU Affinity·NUMA Affinity·GPU NUMA ID 열. GPU0–NIC0 `PXB`, 다른 NIC `NODE` | DGX BasePOD 배포 가이드 | `✓` |
| 범례 해석 | X, NV#, PIX, PXB, PHB, NODE, SYS의 뜻. 단일 공식 페이지에서 원문을 못 찾아 대조함 | HPC Advisory Council 위키 | `Ⓥ` |
| P2P 레벨 어휘 | `NCCL_P2P_LEVEL`이 LOC/NVL/PIX/PXB/PHB/SYS를 씀 | NCCL env 문서 | `✓` |
| P2P 가능 여부 확인 명령 | `nvidia-smi topo -p2p p` | NCCL GPU troubleshooting | `✓` |
| NUMA 배치의 영향 | "Incorrect process placement ... serious performance impact". rank는 자기 GPU·NIC에 가까운 코어를 써야 함 | NCCL performance and tuning | `✓` |
| CPU 어피니티 결정 방식 | 런처 어피니티와 GPU 어피니티의 교집합. `NCCL_IGNORE_CPU_AFFINITY=1`이어도 cpuset·cgroup 제한은 못 넘음 | NCCL performance and tuning | `✓` |
| CPU Manager static 없이 교집합이 넓어짐 | 위 동작에서 도출 | — | `≈` |
| 어피니티 확인 방법 | `NCCL_DEBUG_SUBSYS=INIT,GRAPH,ENV`의 `ncclTopoGetCpuAffinity` 로그, `lscpu --extended` | NCCL performance and tuning | `✓` |
| 같은 소켓과 원격 소켓의 정량 차이 | NVIDIA 1차 수치 없음 | — | `?` |

{{% /details %}}

## 4. NCCL이 실제로 고른 길을 로그에서 찾는다

NCCL은 `/sys`에서 GPU와 NIC의 PCI 토폴로지를 읽습니다. NCCL GPU troubleshooting 문서는 컨테이너나 VM에서 `/sys`가 제대로 마운트되지 않거나 가상 PCI 토폴로지만 보이면 탐지가 어긋나 성능이 떨어질 수 있다고 설명합니다. Kubernetes에서 GPU 파드를 격리형 런타임이나 VM 기반으로 실행할 때 확인할 항목입니다.

NCCL은 탐지한 토폴로지를 바탕으로 Ring, Tree, NVLS(NVLink SHARP) 같은 통신 그래프를 만들고 연결마다 transport(데이터 전송 경로)를 고릅니다. 거리가 `NCCL_P2P_LEVEL` 이내이면 P2P를 사용하고, 그 범위를 벗어나거나 P2P가 막혀 있으면 다른 경로를 사용합니다.

거리 판정 흐름을 단순화한 도식입니다.

{{< flow src="_flow/4-nccl-경로-판정.json" />}}

선택 결과는 `NCCL_DEBUG=INFO NCCL_DEBUG_SUBSYS=GRAPH`로 켠 로그에서 확인합니다. NCCL 로깅 문서에는 통신 그래프와 전송 경로를 보여 주는 다음 예시가 있습니다.

```text
node-01:1895811:1895822 [0] NCCL INFO Tree 0 : -1 -> 0 -> 1/-1/-1
node-01:1895811:1895822 [0] NCCL INFO Ring 00 : 1 -> 0 -> 1
node-01:631398:631398 [0] NCCL INFO Channel 00/0 : 0[0] -> 1[1] via P2P/CUMEM
node-01:1538174:1538174 [0] NCCL INFO NVLS Creating Multicast group nranks 8 size 2097152 on rank 0
```

여러 파드의 로그가 섞이면 경로를 읽기 어렵습니다. NCCL 로깅 문서는 `NCCL_DEBUG_FILE=/tmp/nccl_%h_%p.log`처럼 프로세스별 파일로 나누는 방법도 안내합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 토폴로지 탐지 방식 | `/sys`로 GPU·NIC의 PCI 토폴로지를 탐지. 컨테이너·VM에서 `/sys`가 제대로 마운트돼야 하고 가상 PCI 토폴로지는 성능을 낮출 수 있음 | NCCL GPU troubleshooting | `✓` |
| 거리 판정 도식 | 문서의 P2P 레벨 정의와 환경변수 설명에서 판정 흐름을 단순화함 | — | `Σ` |
| 그래프 확인 | `NCCL_DEBUG=INFO NCCL_DEBUG_SUBSYS=GRAPH`. 로그 예시 4줄은 문서 원문 | NCCL logging | `✓` |
| 프로세스별 로그 | `NCCL_DEBUG_FILE=/tmp/nccl_%h_%p.log` | NCCL logging | `✓` |
| `NCCL_GRAPH_FILE`, `NCCL_GRAPH_DUMP_FILE` | 현행 env 문서에서 확인하지 못함 | — | `?` |

{{% /details %}}

## 5. 기대한 경로가 나오지 않을 때 확인할 설정

예상한 P2P 경로가 보이지 않으면 호스트의 IOMMU와 PCIe 스위치의 ACS 설정을 확인합니다. NCCL GPU troubleshooting 문서는 베어메탈에서 IOMMU가 translated 모드이면 PCIe P2P를 지원하지 않는다고 명시합니다. PCIe 스위치의 ACS는 꺼야 하지만 VM에는 ACS가 필요합니다. 문서에 나온 확인 명령은 다음과 같습니다.

```bash
dmesg | grep -i -E "iommu|dmar|default domain"
sudo lspci -vvv | grep ACSCtl
```

NCCL이 탐지한 구조 자체를 점검할 때는 `NCCL_TOPO_DUMP_FILE`로 결과를 덤프하고, 점검한 파일을 `NCCL_TOPO_FILE`로 지정할 수 있습니다. 가상화 환경에서 쓸모가 있는 방법입니다. MNNVL(멀티노드 NVLink) 환경의 덤프에는 NVLink 도메인 전체가 들어갑니다. 이를 `NCCL_TOPO_FILE`로 다시 쓰려면 한 호스트 분량으로 줄여야 합니다.

경로 허용 범위, 알고리즘과 프로토콜, 어피니티를 조정하는 환경변수는 아래와 같습니다. 기본값은 NCCL 2.32 문서 기준입니다.

| 변수 | 의미 | 기본값 |
|---|---|---|
| `NCCL_P2P_LEVEL` | P2P를 쓸 최대 GPU 거리 | 아키텍처와 환경에 따라 자동 |
| `NCCL_P2P_DISABLE` | P2P transport 끔 | 켜짐 |
| `NCCL_SHM_DISABLE` | 공유메모리 transport 끔, 소켓 간은 네트워크로 | 켜짐 |
| `NCCL_TOPO_FILE` | 탐지 전에 읽을 토폴로지 XML | `/var/run/nvidia-topologyd/virtualTopology.xml`이 있으면 자동 로드 |
| `NCCL_TOPO_DUMP_FILE` | 탐지 결과를 XML로 덤프 | 미설정 |
| `NCCL_NVLS_ENABLE` | NVLink SHARP(NVSwitch 인스위치 리덕션) 사용, 2.17부터 | 2 |
| `NCCL_ALGO`, `NCCL_PROTO` | 알고리즘과 프로토콜 제한 | 미설정이면 토폴로지 기반 자동 |
| `NCCL_NET_GDR_LEVEL` | NIC과 GPU 거리가 얼마까지 GPUDirect RDMA를 쓸지 | 자동 |
| `NCCL_CROSS_NIC` | 링과 트리가 노드마다 다른 NIC을 써도 되는지 | 2 |
| `NCCL_IGNORE_CPU_AFFINITY` | 상속된 CPU 어피니티 무시 | 0 |

GPUDirect RDMA에서는 NCCL이 DMA-BUF를 자동으로 탐지하면 `nvidia-peermem`이 필요 없다고 NCCL GPU troubleshooting 문서가 설명합니다. NIC을 파드에 붙이는 방법은 [06편]({{< relref "/platform/kubernetes/gpu/06-gpudirect-rdma-basics/index.md" >}})과 [07편]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}})에서 이어집니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| P2P 장애 요인 | 베어메탈 IOMMU translated 모드는 PCIe P2P 미지원, PCIe 스위치 ACS는 꺼야 하나 VM은 ACS 필요 | NCCL GPU troubleshooting | `✓` |
| 확인 명령 | `dmesg \| grep -i -E "iommu\|dmar\|default domain"`, `sudo lspci -vvv \| grep ACSCtl` | NCCL GPU troubleshooting | `✓` |
| `NCCL_TOPO_FILE`·`NCCL_TOPO_DUMP_FILE`과 MNNVL | MNNVL에서는 덤프에 NVLink 도메인 전체가 들어가므로 한 호스트로 줄여야 재사용 가능 | NCCL env 문서 | `✓` |
| 환경변수 의미와 기본값 | 본문 표의 열 | NCCL env 문서 | `✓` |
| DMA-BUF와 `nvidia-peermem` | NCCL이 DMA-BUF를 자동 탐지하면 `nvidia-peermem` 불필요 | NCCL GPU troubleshooting | `✓` |

{{% /details %}}

## 6. 확인하지 못한 것

- `nvidia-smi topo -m` 범례 원문을 NVIDIA 공식 문서 한 페이지에서 찾지 못했다. 도구 출력과 커뮤니티 위키로 대조했으므로 실제 노드의 출력을 캡처해 확인하는 편이 좋다.
- 같은 소켓과 원격 소켓에 배치한 GPU와 NIC의 정량적 성능 차이를 보여 주는 NVIDIA 1차 수치는 찾지 못했다.
- Fabric Manager 버전과 드라이버 버전의 정확한 일치 요건은 원문으로 확인하지 못했다.
- GB200 NVL72에서 FM과 NMX가 어느 트레이에서 도는지, NVLSM의 정확한 배치는 문서 일부만 확인했다.
- `NCCL_MNNVL_ENABLE`의 기본값과 `NCCL_GRAPH_FILE`, `NCCL_GRAPH_DUMP_FILE`이 현행 문서에 있는지는 확인하지 못했다.
- NVLS를 컨테이너에서 쓸 때 추가로 필요한 것(IMEX 채널 등)은 확인하지 못했다.

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
