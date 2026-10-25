---
title: "06 GPUDirect RDMA 1부: 파드에서 쓰기 위한 조건"
description: "파드에서 GPUDirect RDMA를 쓰려면 GPU와 NIC의 PCIe 거리를 맞추고 호스트 드라이버와 RDMA 장치 할당을 준비해야 한다. 2026-10-21 기준 DMA-BUF 조건과 NIC 공유·독점 방식, 설치와 검증 순서를 설명한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 6
url: "/kubernetes/gpu/06-gpudirect-rdma-basics/"
---

# 06 · GPUDirect RDMA 1부: 파드에서 쓰기 위한 조건

## 1. GPU에서 NIC까지의 경로를 확인한다 {#1-gpu-할당-뒤에-남는-통신-경로}

GPU를 할당받은 파드가 노드 밖으로 데이터를 보내려면 NIC(네트워크 인터페이스 카드)까지 데이터를 전달해야 합니다. 일반 경로에서는 GPU 메모리의 데이터를 호스트의 고정 메모리로 복사하고 NIC이 그 버퍼를 읽습니다. GPUDirect RDMA는 NIC이 GPU 메모리를 직접 읽고 쓰게 하는 PCIe 기능입니다. 파드가 GPU를 할당받는 것만으로 이 직접 경로까지 준비되지는 않습니다. 장치 할당의 일반 원리는 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에서 다뤘습니다.

CUDA GPUDirect RDMA 문서는 PCIe 장치가 상대 장치의 BAR 주소에 직접 읽기와 쓰기를 낸다고 설명합니다("issues reads and writes to a peer device's BAR addresses"). GPU Operator 문서의 표현은 "without going through host memory"입니다. 두 설명을 종합하면 생략되는 작업은 호스트 고정 메모리로의 복사와 그 복사를 지시하는 CPU의 개입입니다. GPUDirect Storage 문서는 이를 "bypassing a CPU bounce buffer"라고 표현합니다. CPU 개입의 범위에 관한 설명은 이 문서들을 풀어 쓴 해석입니다.

{{< flow src="_flow/2-호스트-메모리-경유.json" />}}

{{< flow src="_flow/2-gpudirect-rdma-경로.json" />}}

NIC이 GPU 메모리를 읽는 창은 GPU의 BAR1입니다. CUDA 문서 3.5절에 따르면 일부 데이터센터 GPU의 BAR1은 16GB 이상이지만, 드라이버가 내부용으로 예약한 부분은 사용할 수 없습니다. GDR(GPUDirect RDMA)에서 BAR1 크기를 확인해야 하는 이유입니다.

조사 기준일은 2026-10-21입니다. Network Operator v26.7.1, GPU Operator v26.7.2, CUDA GPUDirect RDMA 문서 13.4, DOCA-OFED GA doca3.5.0-26.07-0.7.7.0-1, GDRCopy v2.6, Kubernetes v1.37.1을 기준으로 릴리스와 Platform Support를 확인했습니다. GitHub 릴리스 페이지가 연도를 표시하지 않은 경우에는 태그 순서와 문서 날짜로 연도를 추정했습니다.

### 직접 접근할 수 있는지는 PCIe 경로에 달려 있습니다

[01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}})에서 본 노드 내부의 NVLink·PCIe 거리는 NIC을 고를 때도 중요합니다. CUDA 문서가 제시하는 이론적 요구는 GPU와 NIC이 같은 upstream PCIe root complex를 공유하는 것입니다. 그 안에서도 PCIe 스위치만 지나는 경로가 가장 좋습니다. 소켓 사이 링크(QPI/HT)를 건너면 성능이 크게 제한되거나 안정적으로 동작하지 않을 수 있다고 문서는 경고합니다.

`nvidia-smi topo -m`에서 GPU와 NIC 사이의 표기를 읽으면 경로를 구분할 수 있습니다. 다음 정의는 HPC Advisory Council의 정리를 따릅니다.

| 표기 | 뜻 |
|---|---|
| PIX | PCIe 브리지(스위치) 하나만 건넘 |
| PXB | PCIe 브리지 여러 개를 건너되 Host Bridge는 건너지 않음 |
| PHB | PCIe Host Bridge(대개 CPU)를 건넘 |
| NODE | 같은 NUMA 노드 안 Host Bridge 사이 인터커넥트를 건넘 |
| SYS | NUMA 노드 사이 SMP 인터커넥트(QPI/UPI)를 건넘 |

NCCL의 `ncclTopoCheckGdr()`도 이 거리를 확인합니다. 소스 paths.cc의 기본값은 `netGdrLevel = PATH_PXB`이며 C2C 플랫폼에는 예외가 있습니다. 이 예외를 제외하면 PXB 이내에서만 GDR을 켜고 PHB, NODE, SYS에서는 호스트 메모리를 경유합니다. 노드를 고르거나 설계할 때는 NIC과 GPU가 같은 스위치 아래에 있는지부터 살펴보아야 합니다.

## 2. 호스트에서 GPU 메모리를 등록할 경로를 준비한다 {#5-메모리-등록은-dma-buf가-권장-경로입니다}

GPU와 NIC의 PCIe 연결을 확인한 뒤에는 NIC이 GPU 메모리에 접근하도록 등록하는 경로를 정합니다. GPU Operator 26.7 문서는 DMA-BUF를 권장하고 nvidia-peermem을 legacy로 분류합니다. 이 선택에 따라 GPU 드라이버와 네트워크 드라이버의 요구사항이 달라집니다.

DMA-BUF에는 커널 5.12 이상, open kernel module 드라이버, CUDA 11.7 이상, Turing 이상의 GPU가 필요합니다. MLNX_OFED나 DOCA-OFED를 반드시 설치할 필요는 없으며, 배포판의 인박스 드라이버를 쓸 때는 rdma-core 패키지를 설치합니다. CUDA 13.0부터는 cuMemAlloc으로 할당한 메모리도 dma_buf로 내보낼 수 있습니다.

NVIDIA 개발자 블로그(2024-07-17)에 따르면 R560부터 Turing 이상 GPU의 패키지 매니저·runfile 기본 설치가 open 모듈로 바뀌었습니다. GPU Operator 문서에서는 v25.3.0부터 `driver.kernelModuleType`의 기본값을 `auto`로 두며 신규 드라이버는 open이 기본입니다. R570 미만 브랜치에서 DMA-BUF를 사용하려면 `driver.kernelModuleType=open`을 명시해야 합니다.

### nvidia-peermem을 쓰는 호스트의 조건

legacy 경로에는 MLNX_OFED 또는 DOCA-OFED가 필수입니다. Mellanox의 out-of-tree 모듈 nv_peer_mem에서 이어진 경로로, CUDA 11.4부터 GPU 드라이버에 nvidia-peermem이 포함됐습니다. R470 이상에서는 이전 nv_peer_mem이 deprecated이며 제거가 권장됩니다.

CUDA 문서 2.3/4.7절에 따르면 nvidia-peermem에는 자동 로드 서비스가 없습니다. 직접 설치한 환경에서는 `modprobe nvidia-peermem`을 실행해야 합니다. GPU Operator는 드라이버 파드의 `nvidia-peermem-ctr` 컨테이너로 이 작업을 수행합니다.

지원 종료에 관한 문구는 적용 대상을 함께 읽어야 합니다. CUDA 문서 2.1절의 nv-p2p 커널 API deprecation은 Tegra(Orin L4T)에 한정돼 있습니다. CUDA 13.0에서 deprecated, 14.0에서 제거한다는 설명이며 x86 dGPU에는 해당 언급이 없습니다. 이를 nvidia-peermem 전체의 폐기로 해석할 수는 없습니다.

패키지 이름도 구별해야 합니다. DGX SuperPOD 문서에서 nvidia_peermem은 `nvidia-driver-580-server`와 `nvidia-driver-580-server-open`에는 있지만 `nvidia-driver-580-open`에는 없습니다. 문서의 `-server`, `-server-open`, `-open` 구분을 설치할 패키지와 맞춰 보아야 합니다.

### NCCL은 준비된 경로를 감지합니다

NCCL 2.32.3은 peermem과 dma-buf를 모두 감지합니다. gdr.cc 소스에서는 `/sys/module/nvidia_peermem/version` 같은 흔적을 확인해 peermem 경로를 사용하고, `ibv_reg_dmabuf_mr(fd=-1)` 더미 호출이 지원 안 함 오류를 반환하는지로 dma-buf 경로를 확인합니다.

`NCCL_DMABUF_ENABLE`의 기본값은 1이며 커널·CUDA·NIC 드라이버가 지원하지 않으면 자동으로 꺼집니다. NCCL 트러블슈팅 문서는 DMA-BUF가 자동 감지되면 nvidia-peermem 모듈이 필요 없다고 설명합니다. 모듈 설치 여부와 NCCL이 실제로 선택한 경로는 구분해서 확인해야 합니다.

### GDRCopy는 별도 최적화로 구분합니다

GDRCopy는 CPU가 BAR1으로 GPU 메모리를 매핑해 직접 복사하는 저지연 라이브러리입니다. README는 cudaMemcpy의 고정 오버헤드인 6~7us를 피하려는 용도로 설명합니다. 호스트에서 GPU로 쓰기는 write-combining 덕분에 빠르지만, GPU에서 읽기는 prefetch가 안 돼 느립니다.

기본 백엔드는 `gdrdrv` 커널 모듈입니다. v2.6에 추가된 DMA-BUF 백엔드는 gdrdrv가 필요 없는 대신 CUDA 드라이버 13.3 이상을 요구합니다. NCCL 환경변수 문서에 따르면 `NCCL_GDRCOPY_ENABLE`의 기본값은 0이고, 활성화해도 GDRCopy를 내부 제어 구조에만 사용합니다. 이를 종합하면 GDRCopy는 GPUDirect RDMA를 구성하기 위한 필수 요소보다는 소형 메시지 지연을 줄이기 위한 별도 최적화로 보입니다.

## 3. 파드의 격리 요구에 맞춰 NIC 할당 방식을 고른다 {#2-파드끼리-nic을-어디까지-나눌-것인가}

호스트의 직접 전송 경로를 준비했으면 파드가 NIC과 RDMA 장치 파일에 접근할 수 있게 해야 합니다. k8s-rdma-shared-dev-plugin 소스는 장치별 `ucmN`, `issmN`, `umadN`, `uverbsN`과 공통 `rdma_cm`을 `rwm` 권한으로 주입합니다. 필수로 검사하는 파일은 `rdma_cm`, `umad`, `uverbs`입니다. 이 가운데 `uverbsN`은 HCA(RDMA 어댑터)의 사용자 공간 제어 경로 인터페이스입니다. DraNet의 dra_hooks.go도 같은 rdmamap 함수를 사용하고 `rdma_cm`을 더합니다.

파드 간 격리는 RDMA 서브시스템의 netns(네트워크 네임스페이스) 모드와 관련이 있습니다. 기본값 shared에서는 RDMA 장치가 모든 network namespace에 보이고, exclusive에서는 한 netns에만 할당됩니다. DraNet RDMA modes 문서는 shared를 "soft", exclusive를 "hard" 격리라고 부릅니다. shared 모드에서는 char 장치와 netdev만 파드로 옮기고 RDMA link 장치는 호스트에 남기 때문입니다.

Spiderpool 문서는 Macvlan/IPVLAN과 공유 플러그인에 shared 모드가, SR-IOV와 rdma-cni에 exclusive 모드가 필요하다고 설명합니다. Network Operator의 shared mode 주석에서도 이를 간접 확인했지만, NVIDIA가 같은 요구를 직접 명시한 문장은 찾지 못했습니다.

exclusive 모드는 `rdma system set netns exclusive` 또는 `ib_core`의 `netns_mode=0`으로 설정합니다. 변경 시 시스템에 다른 netns가 없어야 합니다. Network Operator에서는 `SriovNetworkPoolConfig`의 `rdmaMode: exclusive`로 지정합니다. 이 조건은 Network Operator deployment guide와 rdma-cni README를 기준으로 합니다.

{{< flow src="_flow/5-격리-경계.json" />}}

아래 표는 NIC 공유와 IP 구성을 비교한 것입니다. 격리 평가는 앞의 문서들을 종합한 해석이며 성능 열은 직접 비교 측정값이 없는 추정입니다.

| | hostNetwork | shared 플러그인 | hostdev | SR-IOV VF |
|---|---|---|---|---|
| 파드 간 격리 | 없음 | 약함(shared netns) | NIC 독점 | 강함(VF, exclusive, PKey/VLAN) |
| NIC 공유 | 노드 전체 | 여러 파드가 공유 | 불가 | VF 수만큼 분할 |
| 성능 | 베어메탈 | 베어메탈에 가까움 | 베어메탈 | VF 경유, 대체로 근접 |
| IP | 노드 IP | macvlan/IPoIB + IPAM | host-device + nv-ipam | sriov/ib-sriov CNI + IPAM |
| 리소스 키 예 | 없음 | `rdma/rdma_shared_device_a` | `nvidia.com/hostdev` | `nvidia.com/<resourceName>`, `mellanox.com/sriov_rdma` |

## 4. NIC을 여러 파드가 공유하는 구성 {#3-nic을-파드에-주는-두-가지-방식}

### hostNetwork에서 필요한 장치 노출

hostNetwork를 쓰면 파드는 노드 IP와 노드의 모든 netdev를 사용합니다. 그러나 hostNetwork 설정만으로 `/dev/infiniband`가 생기지는 않으므로 privileged나 별도 장치 마운트가 필요할 것으로 보입니다. 이 장치 노출 요건은 직접 확인한 문서가 없는 해석입니다. 파드 간 격리와 멀티테넌시가 없고 포트 충돌도 직접 관리해야 합니다.

GKE TCPX 문서는 어노테이션 방식을 사용하지 않으면 파드에 `hostNetwork: true`, 데몬 컨테이너에 `privileged: true`를 지정하도록 합니다. TCPX에 관한 조건이므로 다른 RDMA 구성의 일반 요구사항으로 확대해서는 안 됩니다.

장치 노출은 GPU 디바이스 플러그인의 버전에도 영향을 받았습니다. NVIDIA k8s-device-plugin v0.19.0은 `--mofed-enabled` 기본값을 true로 바꾸면서 GPU를 요청한 컨테이너에 `/dev/infiniband/uverbs*`를 모두 마운트했습니다. AWS EKS 문서는 이 동작이 EFA 디바이스 플러그인과 충돌했다고 설명합니다. v0.19.3 CHANGELOG에는 기본값을 되돌린 기록이 있으므로 AWS 문서의 설명은 되돌림 이전에 해당합니다.

### shared 플러그인이 할당하는 것은 슬롯입니다

k8s-rdma-shared-dev-plugin은 여러 파드가 요청할 수 있는 공유 리소스를 만듭니다. 기본 prefix는 `rdma`이고 리소스 이름은 `rdma/rdma_shared_device_a` 같은 형태입니다. 설정에 필수인 `resourceName`과 `rdmaHcaMax` 가운데 후자는 한 시점에 붙을 수 있는 파드 수를 나타냅니다.

공유할 장치는 `selectors`의 vendors, deviceIDs, drivers, ifNames, linkTypes 또는 `devices`로 고릅니다. Network Operator 예시는 `rdmaHcaMax: 63`, `ifNames: ["ens1f0"]`을 사용합니다. Azure의 aks-rdma-infiniband 저장소도 `rdma/shared_ib: 1`을 NIC 한 개가 아닌 63개 슬롯 중 하나를 사용하는 요청으로 설명하며, 이때 모든 NIC에 접근한다고 적습니다.

IP는 보통 RoCE의 MacvlanNetwork 또는 IB의 IPoIBNetwork 보조 인터페이스에 whereabouts나 nv-ipam으로 할당합니다. NIC 하나를 여러 파드가 쓸 수 있지만 shared netns에서는 같은 HCA가 다른 파드에도 보입니다. 이 점에서 멀티테넌시 격리가 약한 구성으로 판단했습니다.

플러그인의 example/test-hca-pod.yaml은 공유 리소스와 `IPC_LOCK`을 함께 요청합니다.

```yaml
securityContext:
  capabilities:
    add: [ "IPC_LOCK" ]
resources:
  limits:
    rdma/hca_shared_devices_a: 1
```

## 5. NIC 전체 또는 VF를 파드에 할당하는 구성 {#4-nic-하나를-넘길지-vf로-나눌지}

host-device CNI는 NIC의 netdev를 파드에 통째로 넘기는 경로이고, SR-IOV와 Multus는 NIC을 VF로 나누어 할당하는 경로입니다. Red Hat OpenShift AI 3.5 문서의 RoCE 구성은 IBM Cloud에서 host-device CNI를, 베어메탈에서 SR-IOV VF를 사용합니다. 이 기능의 상태는 Tech Preview입니다.

### hostdev는 netdev를 통째로 옮깁니다

NVIDIA의 "Network Operator Deployment for GPUDirect Workloads" 기본 예시는 host-device CNI와 `nvidia.com/hostdev`를 사용합니다. SR-IOV 디바이스 플러그인에서 `resourcePrefix: "nvidia.com"`, `resourceName: "hostdev"`, selectors `vendors: ["15b3"]`, `isRdma: true`로 리소스를 만듭니다.

네트워크 정의는 `HostDeviceNetwork` CR에 두고 IPAM에는 `nv-ipam`과 `poolName`을 사용합니다. host-device CNI가 PF(물리 기능) 또는 VF의 netdev를 파드 netns로 옮기므로, 파드에는 네트워크 어노테이션과 장치 리소스를 모두 지정해야 합니다.

```yaml
metadata:
  annotations:
    k8s.v1.cni.cncf.io/networks: hostdevice-net
spec:
  containers:
  - securityContext:
      capabilities:
        add: ["IPC_LOCK"]
    resources:
      requests:
        nvidia.com/hostdev: '1'
        nvidia.com/gpu: '1'
      limits:
        nvidia.com/hostdev: '1'
        nvidia.com/gpu: '1'
```

이 구성에서는 NIC 하나를 파드 하나가 독점합니다. Network Operator 문서는 같은 NIC에 서로 다른 네트워킹 방식을 섞을 수 없다고 명시합니다.

### SR-IOV에서는 VF의 RDMA 장치를 이동합니다

RoCE에서는 `SriovNetworkNodePolicy`에 `deviceType: netdevice`, `isRdma: true`, `numVfs: 8`을 지정합니다. `SriovNetwork`가 만든 NAD(네트워크 연결 정의)의 체인에 `sriov`와 `rdma` CNI를 연결합니다. exclusive 모드에서는 rdma-cni가 VF의 RDMA 장치를 파드 netns로 옮깁니다.

다음은 rdma-cni 저장소의 NAD 예시입니다.

```yaml
apiVersion: "k8s.cni.cncf.io/v1"
kind: NetworkAttachmentDefinition
metadata:
  name: sriov-rdma-net
  annotations:
    k8s.v1.cni.cncf.io/resourceName: mellanox.com/sriov_rdma
spec:
  config: '{
             "cniVersion": "0.3.1",
             "name": "sriov-rdma-net",
             "plugins": [{
                          "type": "sriov",
                          "ipam": {
                            "type": "host-local",
                            "subnet": "10.56.217.0/24",
                            "routes": [{"dst": "0.0.0.0/0"}],
                            "gateway": "10.56.217.1"
                          }
                        },
                        {"type": "rdma"}]
           }'
```

파드는 `k8s.v1.cni.cncf.io/networks: sriov-rdma-net` 어노테이션과 `mellanox.com/sriov_rdma: '1'` 요청을 함께 지정합니다.

InfiniBand에서는 `SriovNetworkNodePolicy`의 `linkType: IB`와 IPAM이 `nv-ipam`인 `SriovIBNetwork`를 사용합니다. Network Operator deployment guide가 요구하는 전제는 DOCA-OFED와 OpenSM이며, OpenSM 파티션에는 `defmember=full`이 필요합니다. ib-kubernetes 데몬은 SM 플러그인(UFM 또는 NOOP)으로 파드 VF의 GUID를 PKey에 등록합니다.

이 구성을 종합하면 RoCE VF는 이더넷 MAC·VLAN·IP로 식별되고 스위치의 lossless 설정에 의존하며, IB VF는 GUID·PKey로 식별되고 SM이 파티션을 관리한다고 해석할 수 있습니다. VF 할당에 exclusive netns와 PKey 또는 VLAN을 사용하는 SR-IOV는 비교한 네 경로 중 격리가 가장 강할 것으로 추정됩니다. 할당 가능한 파드 수는 하드웨어 VF 수에 제한됩니다.

DGX SuperPOD 레퍼런스는 레일마다 `sriovib_resource_a`, `_b` 같은 SR-IOV IB 리소스를 사용합니다. 이 예시의 스택은 DGX H100, Network Operator 25.10, GPU Operator 25.10, DOCA OFED 3.1.0입니다. InfiniBand·RoCE 패브릭의 설정은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})과 [11편]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}}), 스토리지 쪽 RDMA는 [08편]({{< relref "/platform/kubernetes/gpu/08-storage-gds-nvmeof/index.md" >}})에서 다룹니다.

## 6. 네트워크 드라이버부터 설치하고 파드로 검증하기

NIC 할당 방식과 메모리 등록 경로를 정했으면 네트워크 드라이버부터 설치합니다. Network Operator의 DOCA-OFED 컨테이너를 사용하거나 호스트에 직접 설치할 수 있으며 GPU Operator 설정도 이 선택에 맞춥니다.

드라이버 수명과 호스트 스토리지 사용 여부를 함께 확인해야 합니다. MLNX_OFED to DOCA-OFED 전환 가이드에 따르면 MLNX_OFED의 마지막 단독 릴리스는 2024-10 LTS입니다. 2027-10까지 버그·보안 수정만 제공하고 이후 DOCA-OFED로 대체합니다. Network Operator Platform Support는 DOCA-OFED의 `ib_core`가 인박스 `nvme_rdma`와 충돌하므로 드라이버 컨테이너와 호스트 NVMe-over-RDMA를 함께 사용할 수 없다고 명시합니다.

Network Operator 릴리스 노트의 26.1 항목에서 검증한 DOCA 드라이버 컨테이너의 호스트 커널은 6.8.0-100까지입니다. 이 제한을 고려하면 커널 업그레이드 때 컨테이너의 재빌드와 검증도 필요할 것으로 보입니다. 이는 지원 문서에서 이끌어 낸 운영 판단입니다.

### Network Operator가 준비하는 NIC 구성

Network Operator의 `NicClusterPolicy`는 NIC 쪽 구성요소를 관리합니다. CRD 레퍼런스에서 `ofedDriver`는 인박스 드라이버를 대체할 DOCA-OFED 드라이버 컨테이너, `rdmaSharedDevicePlugin`과 `sriovDevicePlugin`은 파드 장치 할당을 맡습니다. `secondaryNetwork`에는 Multus, CNI plugins, IPoIB CNI가 들어갑니다. 그 밖에 `nvIpam`, `ibKubernetes`, `nicFeatureDiscovery`, `docaTelemetryService`, `nicConfigurationOperator`, `spectrumXOperator` 항목이 있습니다.

SR-IOV Network Operator를 함께 설치하려면 Helm 값 `sriovNetworkOperator.enabled: true`를 사용합니다. 26.7.0 기준 지원 Kubernetes 버전은 1.32~1.36이고 1.32 미만에서는 Helm 설치가 실패합니다. GPUDirect RDMA에는 GPU Operator v25.3.x 이상이 필요합니다. 26.7부터는 구성요소별 readiness condition을 제공합니다.

### GPU Operator 설정과 드라이버 준비 대기

GPU Operator 26.7 RDMA 문서의 설정값은 호스트 드라이버 구성과 연결해서 읽어야 합니다.

| 값 | 효과 |
|---|---|
| 플래그 없음 | DMA-BUF 경로. NIC 드라이버는 Network Operator가 관리한다고 가정 |
| `driver.rdma.useHostMofed=true` | 호스트에 직접 설치한 네트워크 드라이버를 사용 |
| `driver.rdma.enabled=true` | legacy nvidia-peermem 경로. 드라이버 파드에 `nvidia-peermem-ctr`가 추가됨 |
| `driver.kernelModuleType=open` | R570 미만 브랜치에서 DMA-BUF를 쓰기 위한 지정 |

과거 이름인 `driver.useOpenKernelModules`는 현재 문서에 없습니다. `mofed-validation` init 컨테이너는 Mellanox NIC과 네트워크 커널 심볼 export를 확인할 때까지 기다립니다. 문서의 설치 순서도 이 의존성을 따릅니다.

1. Network Operator의 DOCA-OFED 컨테이너 또는 호스트 직접 설치로 네트워크 드라이버를 준비합니다.
2. GPU Operator를 설치합니다. 드라이버 파드의 init 컨테이너가 네트워크 드라이버 준비를 기다립니다.
3. legacy 경로를 선택했다면 `nvidia-peermem-ctr`가 모듈을 로드합니다.

legacy 경로의 로드 성공 로그는 "successfully loaded nvidia-peermem module"입니다. DaemonSet과 해당 컨테이너의 로그는 다음 명령으로 확인합니다. 문서에서 노드의 `lsmod | grep nvidia`를 실행한 예시에는 `nvidia_peermem`, `nvidia_fs`가 보입니다.

```bash
kubectl describe ds -n gpu-operator nvidia-driver-daemonset
kubectl logs -n gpu-operator ds/nvidia-driver-daemonset -c nvidia-peermem-ctr
```

### 문서의 파드 예시로 연결 확인하기

GPU Operator RDMA 문서의 end-to-end 예시는 whereabouts IPAM을 쓰는 MacvlanNetwork `demo-macvlannetwork`와 파드 두 개를 사용합니다. 각 파드는 `nvidia.com/gpu: 1`, `rdma/rdma_shared_device_a: 1`, `IPC_LOCK`을 요청하고, `mellanox/cuda-perftest` 이미지에서 `ib_write_bw --use_cuda=0 --use_cuda_dmabuf`를 실행합니다.

예시 출력은 약 92 Gbps이지만 링크 속도 등 측정 조건이 밝혀져 있지 않습니다. 연결 검증 절차로 참고할 수는 있어도 자기 환경의 목표 성능으로 삼을 수는 없습니다. NCCL이 실제 GDR 경로를 사용하는지 확인하는 방법과 클라우드별 제공 형태, 운영 중 진단할 항목은 [07편]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}})에서 이어집니다.

## 7. 확인하지 못한 것

- NVIDIA가 공유 플러그인에 shared netns 모드가 필요하다고 직접 명시한 문장. Spiderpool 문서와 Network Operator 주석으로 간접 확인했습니다.
- Blackwell이 open 커널 모듈만 지원한다는 설명의 1차 출처.
- hostNetwork 경로의 `/dev/infiniband` 노출 방법을 다룬 문서.
- 네 가지 NIC 할당 경로의 성능을 직접 비교한 측정값.
- GPU Operator 예시의 약 92 Gbps에 해당하는 링크 속도와 측정 조건.

## 참고 자료

- [CUDA GPUDirect RDMA 문서](https://docs.nvidia.com/cuda/gpudirect-rdma/index.html)
- [GPU Operator — GPUDirect RDMA](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-operator-rdma.html)
- [NVIDIA 개발자 블로그 — 오픈소스 GPU 커널 모듈로의 전환](https://developer.nvidia.com/blog/nvidia-transitions-fully-towards-open-source-gpu-kernel-modules/)
- [DOCA — MLNX_OFED to DOCA-OFED 전환 가이드](https://docs.nvidia.com/doca/sdk/MLNX_OFED-to-DOCA-OFED-Transition-Guide/index.html)
- [GDRCopy](https://github.com/NVIDIA/gdrcopy)
- [NCCL 환경변수 문서](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/env.html)
- [NVIDIA Network Operator 릴리스](https://github.com/Mellanox/network-operator/releases)
- [Network Operator 26.7 Platform Support](https://docs.nvidia.com/networking/display/kubernetes2670/platform-support.html)
- [Network Operator 26.7 릴리스 노트](https://docs.nvidia.com/networking/display/kubernetes2670/release-notes.html)
- [Network Operator 문서 저장소](https://github.com/Mellanox/network-operator-docs)
- [k8s-rdma-shared-dev-plugin](https://github.com/Mellanox/k8s-rdma-shared-dev-plugin)
- [rdma-cni](https://github.com/k8snetworkplumbingwg/rdma-cni)
- [ib-kubernetes](https://github.com/Mellanox/ib-kubernetes)
- [k8s-device-plugin CHANGELOG](https://github.com/NVIDIA/k8s-device-plugin/blob/main/CHANGELOG.md)
- [DraNet — RDMA 모드](https://dranet.sigs.k8s.io/docs/concepts/rdma-modes/)
- [DGX SuperPOD — Network Operator 설치](https://docs.nvidia.com/dgx-superpod/dgx-explained/network-operator/latest/network-operator-installation.html)
- [GKE — GPUDirect-TCPX 대역폭](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/gpu-bandwidth-gpudirect-tcpx)
- [AWS EKS — EFA 노드](https://docs.aws.amazon.com/eks/latest/userguide/node-efa.html)
- [Azure aks-rdma-infiniband](https://github.com/Azure/aks-rdma-infiniband)
- [Spiderpool RDMA 파라미터 (DaoCloud)](https://docs.daocloud.io/en/network/modules/spiderpool/install/rdmapara)
- [HPC Advisory Council — PCI Switch, CPU and GPU Direct server topology](https://hpcadvisorycouncil.atlassian.net/wiki/spaces/HPCWORKS/pages/1675034639/PCI+Switch+CPU+and+GPU+Direct+server+topology)
- [Red Hat OpenShift AI 3.5 — RoCE 분산 추론 구성](https://docs.redhat.com/en/documentation/red_hat_openshift_ai_self-managed/3.5/html/working_with_distributed_workloads/configuring-roce-networking-for-distributed-llm-deployments_distributed-llm-roce)
