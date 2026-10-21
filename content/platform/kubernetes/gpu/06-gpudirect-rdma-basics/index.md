---
title: "06 GPUDirect RDMA 1부 — 파드의 NIC이 GPU 메모리에 닿는 조건과 준비"
description: "2026-10-21 기준, 파드에서 GPUDirect RDMA를 쓰려면 GPU와 NIC의 PCIe 조건을 맞추고 호스트 드라이버와 RDMA 장치 할당을 준비해야 한다. 권장 경로인 DMA-BUF의 조건과 NIC 공유·독점 요구에 따른 파드 구성을 설명한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 6
url: "/kubernetes/gpu/06-gpudirect-rdma-basics/"
---

# 06 · GPUDirect RDMA 1부 — 파드의 NIC이 GPU 메모리에 닿는 조건과 준비

## 1. GPU 할당 뒤에 남는 통신 경로

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-21이며 Network Operator 26.7.1, GPU Operator 26.7.2, CUDA GPUDirect RDMA 문서 13.4를 봤습니다.

GPU를 할당받은 파드가 노드 밖으로 데이터를 보낼 때는 GPU와 NIC 사이의 경로를 봐야 합니다. GPUDirect RDMA는 NIC(네트워크 인터페이스 카드)이 GPU 메모리를 직접 읽고 쓰게 하는 PCIe 기능입니다. 장치를 파드에 할당하는 일반 원리는 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에 있습니다.

CUDA 문서는 PCIe 장치가 상대 장치의 BAR 주소로 읽기와 쓰기를 직접 낸다고 설명합니다. GPU Operator 문서도 GPU가 호스트 메모리를 거치지 않고 제3의 PCIe 장치와 데이터를 주고받는다고 명시합니다.

일반 경로에서는 GPU 메모리의 데이터를 호스트의 고정 메모리로 복사하고, NIC이 그 버퍼를 읽어 갑니다. 문서의 표현을 해석하면, GPUDirect RDMA가 생략하는 것은 이 복사와 복사를 지시하는 CPU의 개입입니다. GPUDirect Storage 문서는 이를 CPU 바운스 버퍼를 건너뛴다고 직접 표현합니다.

아래 도식은 호스트 메모리를 경유하는 경로와 GPU 메모리에 직접 접근하는 경로를 같은 배치로 비교합니다.

{{< flow src="_flow/2-호스트-메모리-경유.json" />}}

{{< flow src="_flow/2-gpudirect-rdma-경로.json" />}}

NIC이 GPU 메모리를 읽는 창은 GPU의 BAR1입니다. CUDA 문서 3.5절에 따르면 일부 데이터센터 GPU의 BAR1은 16GB 이상입니다. 드라이버가 일부를 내부용으로 예약하므로 전부를 쓸 수는 없습니다. 그래서 BAR1 크기가 GDR에서 한계가 됩니다.

### 직접 접근할 수 있는지는 PCIe 경로에 달려 있습니다

앞의 [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}})은 노드 안의 NVLink와 PCIe 거리를 다뤘습니다. 노드 밖으로 데이터를 보낼 때는 같은 PCIe 거리가 GPU와 NIC 사이의 조건으로 다시 등장합니다.

CUDA 문서가 제시하는 이론적 요구는 GPU와 NIC이 같은 upstream PCIe root complex를 공유하는 것입니다. 그중 PCIe 스위치만 지나는 경로가 가장 좋습니다. 소켓 사이 링크(QPI/HT)를 건너면 성능이 크게 제한되거나 안정적으로 동작하지 않을 수 있다고 문서는 경고합니다.

`nvidia-smi topo -m`는 이 거리를 다섯 단계로 표시합니다. HPC Advisory Council이 정리한 표기의 뜻은 다음과 같습니다.

| 표기 | 뜻 |
|---|---|
| PIX | PCIe 브리지(스위치) 하나만 건넘 |
| PXB | PCIe 브리지 여러 개를 건너되 Host Bridge는 건너지 않음 |
| PHB | PCIe Host Bridge(대개 CPU)를 건넘 |
| NODE | 같은 NUMA 노드 안 Host Bridge 사이 인터커넥트를 건넘 |
| SYS | NUMA 노드 사이 SMP 인터커넥트(QPI/UPI)를 건넘 |

이 거리는 NCCL의 경로 선택에도 영향을 줍니다. NCCL 소스의 `ncclTopoCheckGdr()`는 C2C 플랫폼 예외를 제외하면 기본값으로 PXB 이내에서만 GDR을 켭니다. PHB, NODE, SYS 거리에서는 GPUDirect RDMA 대신 호스트 메모리를 경유합니다. 노드를 설계하거나 고를 때 NIC이 GPU와 같은 스위치 아래 붙어 있는지 확인해야 하는 이유입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 조사한 버전 | Network Operator v26.7.1, GPU Operator v26.7.2, DOCA-OFED GA doca3.5.0-26.07-0.7.7.0-1, GDRCopy v2.6, Kubernetes v1.37.1 | 각 프로젝트 GitHub 릴리스와 Platform Support | `✓` |
| 릴리스 날짜의 연도 | GitHub 릴리스 페이지가 연도를 표시하지 않아 태그 순서와 문서 날짜로 추정 | GitHub 릴리스 | `≈` |
| PCIe 기능으로 NIC이 GPU BAR 주소를 직접 읽고 씀 | "issues reads and writes to a peer device's BAR addresses" | CUDA GPUDirect RDMA 문서 | `✓` |
| 호스트 메모리를 거치지 않음 | "without going through host memory" | GPU Operator RDMA 문서 | `✓` |
| 생략되는 것은 호스트 고정 메모리 복사와 CPU 개입 | 위 두 문서를 풀어 쓴 해석. GPUDirect Storage는 "bypassing a CPU bounce buffer"라고 명시 | CUDA 문서, GPU Operator 문서 | `≈` |
| BAR1 한계 | 일부 데이터센터 GPU의 BAR1은 16GB 이상이며 일부는 드라이버가 예약 | CUDA 문서 3.5절 | `✓` |
| 같은 upstream root complex 요구, 스위치만 있는 경로가 최적 | QPI/HT를 건너면 성능이 크게 제한되거나 동작이 불안정할 수 있음 | CUDA 문서 | `✓` |
| PIX/PXB/PHB/NODE/SYS 범례 | `nvidia-smi topo -m` 표기 정의 | HPC Advisory Council 정리 | `✓` |
| NCCL 기본 GDR 거리 | `netGdrLevel = PATH_PXB`, C2C 플랫폼은 예외. PHB/NODE/SYS면 호스트 경유 | NCCL 소스 paths.cc | `✓` |

{{% /details %}}

## 2. 파드끼리 NIC을 어디까지 나눌 것인가

어느 경로든 파드가 RDMA를 쓰려면 NIC과 함께 `/dev/infiniband` 아래의 장치 파일이 컨테이너에 들어와야 합니다. k8s-rdma-shared-dev-plugin은 장치마다 `ucmN`, `issmN`, `umadN`, `uverbsN`과 공통 `rdma_cm`을 파드에 넘깁니다. 필수로 검증하는 파일은 `rdma_cm`, `umad`, `uverbs`이며, `uverbsN`은 HCA(RDMA 어댑터)의 사용자 공간 제어 경로 인터페이스입니다. DraNet도 같은 함수에 `rdma_cm`을 더해 주입합니다.

netns 모드가 격리 수준을 결정합니다. RDMA 서브시스템의 netns(네트워크 네임스페이스) 모드는 기본값이 shared여서 RDMA 장치가 모든 network namespace에서 보입니다. exclusive 모드에서는 한 netns에만 할당됩니다.

DraNet 문서는 shared를 "soft", exclusive를 "hard" 격리로 부릅니다. shared 모드에서는 char 장치와 netdev만 파드로 옮겨지고 RDMA link 장치는 호스트에 남기 때문입니다. Spiderpool 문서는 Macvlan/IPVLAN과 공유 플러그인에는 shared 모드가, SR-IOV와 rdma-cni에는 exclusive 모드가 필요하다고 설명합니다.

exclusive 모드는 `rdma system set netns exclusive` 또는 `ib_core`의 `netns_mode=0` 옵션으로 설정합니다. 모드를 바꿀 때 시스템에 다른 netns가 없어야 합니다. Network Operator에서는 `SriovNetworkPoolConfig`의 `rdmaMode: exclusive`로 지정합니다.

아래 도식은 각 경로에서 NIC이 호스트에 남는지 파드로 이동하는지를 보여줍니다.

{{< flow src="_flow/5-격리-경계.json" />}}

InfiniBand와 RoCE 패브릭 자체의 설정은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})과 [11편]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}}), 스토리지 쪽 RDMA는 [08편]({{< relref "/platform/kubernetes/gpu/08-storage-gds-nvmeof/index.md" >}})에서 다룹니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 주입되는 장치 파일 | 장치별 `ucmN`, `issmN`, `umadN`, `uverbsN`, 공통 `rdma_cm`(권한 `rwm`). 필수 검증은 `rdma_cm`, `umad`, `uverbs` | k8s-rdma-shared-dev-plugin 소스 | `✓` |
| DraNet의 주입 | 같은 rdmamap 함수에 `rdma_cm`을 더함 | DraNet 소스 dra_hooks.go | `✓` |
| netns 모드 | shared 기본, exclusive는 한 netns에 할당. `rdma system set netns exclusive` 또는 `netns_mode=0`, 변경 시 다른 netns 없어야 함 | Network Operator deployment guide, rdma-cni README | `✓` |
| soft/hard 격리 | shared는 char 장치와 netdev만 이동, RDMA link는 호스트에 남음 | DraNet RDMA modes 문서 | `✓` |
| Macvlan/IPVLAN + 공유 플러그인은 shared 필요, SR-IOV + rdma-cni는 exclusive | Network Operator 문서의 shared mode 주석이 간접 확인 | Spiderpool 문서(DaoCloud), Network Operator 문서 | `Ⓥ` |

{{% /details %}}

## 3. NIC을 파드에 주는 두 가지 방식

NIC을 공유하는 구성에서도 노드 네트워크를 그대로 쓰는 방식과 디바이스 플러그인으로 공유 슬롯을 할당하는 방식은 구분해야 합니다. hostNetwork는 파드가 노드 IP와 노드의 모든 netdev를 쓰게 합니다. k8s-rdma-shared-dev-plugin은 파드가 요청할 수 있는 공유 리소스를 만듭니다.

### hostNetwork에서 필요한 장치 노출

hostNetwork만으로 `/dev/infiniband`가 생기는 것은 아니어서 privileged나 별도 장치 마운트가 필요할 것으로 보입니다. 파드 간 격리와 멀티테넌시가 없고, 포트 충돌은 직접 관리해야 합니다.

GKE TCPX 문서는 어노테이션 방식을 쓰지 않으면 파드에 `hostNetwork: true`, 데몬 컨테이너에 `privileged: true`가 필요하다고 적습니다. 이 조건은 TCPX 맥락의 설명입니다.

장치가 의도하지 않게 노출된 사례도 있습니다. NVIDIA k8s-device-plugin v0.19.0은 `--mofed-enabled` 기본값을 true로 바꾸면서 GPU를 요청한 컨테이너에 `/dev/infiniband/uverbs*`를 전부 마운트했습니다. AWS EKS 문서는 이 동작이 EFA 디바이스 플러그인과 충돌했다고 설명합니다. v0.19.3 CHANGELOG에서는 기본값을 되돌렸으므로 AWS 문서는 되돌림 이전 기준으로 읽어야 합니다.

### shared 플러그인이 할당하는 것은 슬롯입니다

k8s-rdma-shared-dev-plugin 리소스의 기본 prefix는 `rdma`이며, 이름은 `rdma/rdma_shared_device_a` 같은 형태입니다. 설정에는 `resourceName`과 `rdmaHcaMax`가 필수입니다. `rdmaHcaMax`는 한 시점에 붙을 수 있는 파드 수를 나타냅니다.

장치는 `selectors`(vendors, deviceIDs, drivers, ifNames, linkTypes)나 `devices`로 고릅니다. Network Operator 예시는 `rdmaHcaMax: 63`과 `ifNames: ["ens1f0"]`을 사용합니다.

파드가 요청하는 숫자는 NIC 수가 아닙니다. Azure의 aks-rdma-infiniband 저장소는 `rdma/shared_ib: 1`이 63개 슬롯 중 하나를 사용하면서 모든 NIC에 접근한다는 뜻이라고 설명합니다.

IP는 보통 MacvlanNetwork(RoCE)나 IPoIBNetwork(IB) 보조 인터페이스에 whereabouts 또는 nv-ipam을 사용해 할당합니다. shared netns 모드에서는 같은 HCA가 다른 파드에도 보이므로 멀티테넌시는 약한 구성으로 보입니다. NIC 하나를 여러 파드가 나눠 쓸 수는 있습니다.

플러그인의 테스트 파드 예시는 `IPC_LOCK`과 공유 리소스를 다음처럼 요청합니다.

```yaml
securityContext:
  capabilities:
    add: [ "IPC_LOCK" ]
resources:
  limits:
    rdma/hca_shared_devices_a: 1
```

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| hostNetwork 요건 | 어노테이션 방식을 안 쓰면 `hostNetwork: true`와 데몬 `privileged: true`(TCPX 맥락) | GKE TCPX 문서 | `✓` |
| hostNetwork의 `/dev/infiniband` 노출 요건과 격리 없음 | privileged나 별도 장치 마운트가 필요할 것이라는 해석 | — | `≈` |
| device plugin v0.19.0의 MOFED 기본값 | `--mofed-enabled` 기본 true로 uverbs 전부 마운트, EFA 플러그인과 충돌. v0.19.3에서 되돌림 | AWS EKS 문서, k8s-device-plugin CHANGELOG | `✓` |
| shared 플러그인 설정 | prefix `rdma`, `resourceName`·`rdmaHcaMax` 필수, selectors, 예시 `rdmaHcaMax: 63` | k8s-rdma-shared-dev-plugin README, Network Operator 문서 | `✓` |
| 슬롯 개념 | `rdma/shared_ib: 1`은 63개 슬롯 중 1개 | Azure aks-rdma-infiniband | `Ⓥ` |
| 테스트 파드 예 | `IPC_LOCK`, `rdma/hca_shared_devices_a: 1` | 플러그인 example/test-hca-pod.yaml | `✓` |
| shared의 격리 평가 | 멀티테넌시 약함, NIC 공유 가능 | 위 근거를 종합 | `≈` |

{{% /details %}}

## 4. NIC 하나를 넘길지 VF로 나눌지

파드 하나가 NIC을 독점하게 하려면 host-device CNI를 사용할 수 있습니다. NIC을 VF로 나누어 파드에 할당하는 경로는 SR-IOV와 Multus입니다. Red Hat OpenShift AI 3.5(Tech Preview)는 IBM Cloud에서는 host-device CNI를, 베어메탈에서는 SR-IOV VF를 사용합니다.

### hostdev는 netdev를 통째로 옮깁니다

NVIDIA는 "Network Operator Deployment for GPUDirect Workloads"의 기본 예시로 host-device CNI와 `nvidia.com/hostdev`를 사용합니다. SR-IOV 디바이스 플러그인이 `resourcePrefix: "nvidia.com"`, `resourceName: "hostdev"`, selectors `vendors: ["15b3"]`와 `isRdma: true`로 리소스를 만듭니다.

네트워크는 `HostDeviceNetwork` CR로 정의하며 IPAM에 `nv-ipam`과 `poolName`을 사용합니다. host-device CNI는 PF(물리 기능) 또는 VF의 netdev를 파드 netns로 통째로 옮깁니다. 파드는 네트워크 어노테이션과 장치 리소스를 함께 지정합니다.

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

RoCE 구성에서는 `SriovNetworkNodePolicy`에 `deviceType: netdevice`, `isRdma: true`, `numVfs: 8`을 지정합니다. `SriovNetwork`가 만든 NAD(네트워크 연결 정의) 체인에 `sriov`와 `rdma` CNI를 연결하면, exclusive 모드에서 rdma-cni가 VF의 RDMA 장치를 파드 netns로 옮깁니다.

rdma-cni 저장소의 NAD 예시는 다음과 같습니다.

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

파드에는 `k8s.v1.cni.cncf.io/networks: sriov-rdma-net` 어노테이션과 `mellanox.com/sriov_rdma: '1'` 요청을 함께 지정합니다.

InfiniBand에서는 `SriovNetworkNodePolicy`에 `linkType: IB`를 쓰고, IPAM이 `nv-ipam`인 `SriovIBNetwork`를 만듭니다. DOCA-OFED와 OpenSM이 전제이며 OpenSM 파티션에는 `defmember=full`이 필요합니다. ib-kubernetes 데몬은 SM 플러그인(UFM 또는 NOOP)을 사용해 파드 VF의 GUID를 PKey에 등록합니다.

이 구성을 종합하면 RoCE VF는 이더넷 MAC, VLAN, IP로 식별되고 스위치의 lossless 설정에 의존합니다. IB VF는 GUID와 PKey로 식별되고 SM이 파티션을 관리합니다. 이 차이는 추정입니다.

VF 단위 할당에 exclusive netns와 PKey 또는 VLAN을 사용하는 SR-IOV는 네 경로 중 격리가 가장 강한 것으로 추정됩니다. 배치할 수 있는 파드 수는 하드웨어 VF 수로 제한됩니다. DGX SuperPOD 레퍼런스(DGX H100, Network Operator 25.10, GPU Operator 25.10, DOCA OFED 3.1.0)는 레일마다 `sriovib_resource_a`, `_b` 같은 SR-IOV IB 리소스를 사용합니다.

네 경로를 비교하면 다음과 같습니다. 성능 열은 직접 측정값이 없는 추정입니다.

| | hostNetwork | shared 플러그인 | hostdev | SR-IOV VF |
|---|---|---|---|---|
| 파드 간 격리 | 없음 | 약함(shared netns) | NIC 독점 | 강함(VF, exclusive, PKey/VLAN) |
| NIC 공유 | 노드 전체 | 여러 파드가 공유 | 불가 | VF 수만큼 분할 |
| 성능 | 베어메탈 | 베어메탈에 가까움 | 베어메탈 | VF 경유, 대체로 근접 |
| IP | 노드 IP | macvlan/IPoIB + IPAM | host-device + nv-ipam | sriov/ib-sriov CNI + IPAM |
| 리소스 키 예 | 없음 | `rdma/rdma_shared_device_a` | `nvidia.com/hostdev` | `nvidia.com/<resourceName>`, `mellanox.com/sriov_rdma` |

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| hostdev 구성 | `nvidia.com/hostdev`, `HostDeviceNetwork`, `nv-ipam`, 한 NIC에 다른 네트워킹 방식 혼합 불가 | Network Operator deployment guide(GPUDirect Workloads) | `✓` |
| OpenShift AI 3.5 | IBM Cloud는 host-device CNI, 베어메탈은 SR-IOV VF. Tech Preview | Red Hat 문서 | `✓` |
| SR-IOV RoCE 구성 | `isRdma: true`, `numVfs: 8`, NAD 체인 sriov + rdma, exclusive에서 rdma-cni가 RDMA 장치 이동 | Network Operator 문서, rdma-cni README | `✓` |
| IB SR-IOV | `linkType: IB`, `SriovIBNetwork`, OpenSM `defmember=full`, ib-kubernetes가 GUID를 PKey에 등록 | Network Operator deployment guide, ib-kubernetes | `✓` |
| IB VF와 RoCE VF의 식별 차이 | GUID·PKey 대 MAC·VLAN·IP | — | `≈` |
| DGX SuperPOD 스택 | DGX H100, Network Operator 25.10, GPU Operator 25.10, DOCA OFED 3.1.0, `sriovib_resource_a`... | DGX SuperPOD 문서 | `✓` |
| 네 경로의 비교표 | 위 근거 종합. 성능 열은 직접 측정값 없음 | — | `≈` |

{{% /details %}}

## 5. 메모리 등록은 DMA-BUF가 권장 경로입니다

파드에 NIC을 주는 구성을 정했다면 호스트에서 GPU 메모리를 NIC에 등록할 경로를 준비해야 합니다. GPU Operator 26.7 문서는 DMA-BUF를 권장하고 nvidia-peermem을 legacy로 분류합니다.

dma-buf 경로의 조건은 커널 5.12 이상, open kernel module 드라이버, CUDA 11.7 이상, Turing 이상의 GPU입니다. MLNX_OFED나 DOCA-OFED는 필수가 아니며 배포판의 인박스 드라이버로도 동작합니다. 인박스 드라이버를 쓸 때는 rdma-core 패키지가 필요합니다. CUDA 13.0부터는 cuMemAlloc으로 할당한 메모리도 dma_buf로 내보낼 수 있습니다.

NVIDIA 개발자 블로그는 R560부터 Turing 이상 GPU에서 패키지 매니저와 runfile의 기본 설치가 open 모듈로 바뀌었다고 설명합니다. GPU Operator는 v25.3.0부터 `driver.kernelModuleType` 기본값이 `auto`이고 신규 드라이버는 open이 기본입니다. R570 미만 브랜치에서 DMA-BUF를 쓰려면 `driver.kernelModuleType=open`을 지정해야 합니다.

### nvidia-peermem을 쓰는 호스트의 조건

legacy nvidia-peermem 경로에는 MLNX_OFED나 DOCA-OFED가 필수입니다. 이 경로는 Mellanox가 배포하던 out-of-tree 모듈 nv_peer_mem에서 이어졌습니다. CUDA 11.4부터 GPU 드라이버가 nvidia-peermem을 포함하며, R470 이상에서는 nv_peer_mem이 deprecated이고 제거가 권장됩니다.

nvidia-peermem에는 자동 로드 서비스가 없습니다. 직접 설치한 환경에서는 `modprobe nvidia-peermem`을 실행해야 하며, GPU Operator는 `nvidia-peermem-ctr` 컨테이너로 이 작업을 대신합니다.

모듈의 지원 범위와 패키지 이름은 구분해서 읽어야 합니다.

- nv-p2p 커널 API의 deprecation(CUDA 13.0 deprecated, 14.0 제거)은 Tegra(Orin L4T) 한정으로 서술되어 있다. x86 dGPU에는 해당 언급이 없으므로 "nvidia-peermem 폐기"로 읽으면 안 된다.
- DGX SuperPOD 문서에 따르면 nvidia_peermem은 `nvidia-driver-580-server`와 `-server-open` 패키지에는 있고 `nvidia-driver-580-open` 패키지에는 없다.

### NCCL은 준비된 경로를 감지합니다

NCCL 2.32.3은 peermem과 dma-buf를 모두 감지합니다. `/sys/module/nvidia_peermem/version` 같은 peermem 흔적이 있으면 peermem 경로를 쓰고, 더미 `ibv_reg_dmabuf_mr` 호출이 지원 안 함 오류를 내지 않으면 dma-buf 경로를 씁니다.

`NCCL_DMABUF_ENABLE` 기본값은 1입니다. 커널이나 CUDA, NIC 드라이버가 지원하지 않으면 자동으로 꺼집니다. NCCL 트러블슈팅 문서는 DMA-BUF가 자동 감지되면 nvidia-peermem 모듈이 필요 없다고 적습니다.

### GDRCopy는 별도 최적화로 구분합니다

GDRCopy는 CPU가 GPU 메모리를 BAR1으로 매핑해 직접 복사하는 저지연 라이브러리입니다. README는 cudaMemcpy의 고정 오버헤드(6~7us)를 피하려는 용도로 설명합니다. 호스트에서 GPU로 쓰는 동작은 write-combining으로 빠르지만, GPU에서 읽는 동작은 prefetch가 안 돼 느립니다.

기본 백엔드는 `gdrdrv` 커널 모듈입니다. v2.6에는 gdrdrv가 필요 없는 DMA-BUF 백엔드가 추가됐으며 CUDA 드라이버 13.3 이상을 요구합니다.

NCCL은 `NCCL_GDRCOPY_ENABLE`로 GDRCopy를 내부 제어 구조에만 사용하며 기본값은 0입니다. GDRCopy는 GPUDirect RDMA의 필수 요소가 아니라 소형 메시지 지연이 중요할 때 추가하는 최적화로 보입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| nv_peer_mem에서 nvidia-peermem으로 | CUDA 11.4부터 드라이버에 포함, R470 이상에서 nv_peer_mem deprecated | CUDA 문서 | `✓` |
| peermem 수동 로드 | 자동 로드 서비스 없음, `modprobe nvidia-peermem`. GPU Operator는 `nvidia-peermem-ctr`로 대신 로드 | CUDA 문서 2.3/4.7절, GPU Operator 문서 | `✓` |
| dma-buf 조건 | 커널 5.12+, open kernel module, CUDA 11.7+, Turing 이상, MLNX_OFED/DOCA-OFED 선택 | GPU Operator 26.7 문서 | `✓` |
| peermem 경로는 OFED 필수 | dma-buf 경로는 인박스 드라이버로도 가능 | GPU Operator 문서 표 | `✓` |
| 인박스 드라이버는 rdma-core 필요 | — | Network Operator deployment guide | `✓` |
| GPU Operator의 권장 | DMA-BUF 권장, nvidia-peermem은 legacy | GPU Operator 26.7 문서 | `✓` |
| cuMemAlloc 메모리의 dma_buf export | CUDA 13.0부터 | CUDA 문서 | `✓` |
| NCCL 감지 방식 | peermem 경로 파일 존재 또는 `ibv_reg_dmabuf_mr(fd=-1)` 더미 호출. `NCCL_DMABUF_ENABLE` 기본 1 | NCCL 2.32.3 소스 gdr.cc, env 문서 | `✓` |
| DMA-BUF가 자동 감지되면 peermem 불필요 | NCCL 트러블슈팅 문서 문장 | NCCL 트러블슈팅 문서 | `✓` |
| nv-p2p deprecation은 Tegra 한정 | CUDA 13.0 deprecated, 14.0 제거. x86 dGPU 언급 없음 | CUDA 문서 2.1절 | `✓` |
| nvidia_peermem 패키징 | `-server`, `-server-open`에는 있고 `-open`에는 없음 | DGX SuperPOD 문서 | `✓` |
| open 모듈 기본 전환 | R560부터 패키지 매니저·runfile 기본 설치(Turing 이상) | NVIDIA 개발자 블로그 2024-07-17 | `Ⓥ` |
| GPU Operator의 open 모듈 | v25.3.0부터 `driver.kernelModuleType` 기본 `auto`. R570 미만에서 DMA-BUF는 `open` 지정 | GPU Operator 문서 | `✓` |
| GDRCopy 동작 | BAR1 매핑 직접 복사, cudaMemcpy 오버헤드 6~7us, v2.6의 DMA-BUF 백엔드는 CUDA 드라이버 13.3+ | GDRCopy README | `✓` |
| NCCL의 GDRCopy 사용 | `NCCL_GDRCOPY_ENABLE` 기본 0, 내부 제어 구조용 | NCCL env 문서 | `✓` |
| GDRCopy는 별도 최적화 | 위 사실을 종합한 해석 | — | `≈` |

{{% /details %}}

## 6. 네트워크 드라이버부터 설치하고 파드로 검증하기

호스트 설치는 네트워크 드라이버를 준비하는 일부터 시작합니다. Network Operator의 DOCA-OFED 컨테이너를 사용할 수도 있고 호스트에 직접 설치할 수도 있습니다. 그 선택에 맞춰 GPU Operator 값을 지정합니다.

MLNX_OFED는 2024-10 릴리스가 마지막이며, 2027-10까지 버그와 보안 수정만 받은 뒤 DOCA-OFED로 대체됩니다. DOCA-OFED 드라이버 컨테이너를 선택할 때는 호스트의 NVMe-over-RDMA 사용 여부도 봐야 합니다. DOCA-OFED의 `ib_core`가 인박스 `nvme_rdma`와 충돌하므로 호스트의 NVMe-over-RDMA를 함께 쓸 수 없습니다.

Network Operator 26.1 릴리스 노트는 DOCA 드라이버 컨테이너를 호스트 커널 6.8.0-100까지만 검증했다고 적습니다. 커널을 올릴 때 드라이버 컨테이너의 재빌드와 검증도 운영 항목이 될 것으로 보입니다.

### Network Operator가 준비하는 NIC 구성

Network Operator는 `NicClusterPolicy` 하나로 NIC 쪽 구성요소를 관리합니다. CRD 레퍼런스에 있는 항목은 다음과 같습니다.

- `ofedDriver`: DOCA-OFED 드라이버 컨테이너. 인박스 드라이버를 대체
- `rdmaSharedDevicePlugin`, `sriovDevicePlugin`: 파드에 장치를 주는 디바이스 플러그인
- `secondaryNetwork`: Multus, CNI plugins, IPoIB CNI
- `nvIpam`, `ibKubernetes`, `nicFeatureDiscovery`, `docaTelemetryService`, `nicConfigurationOperator`, `spectrumXOperator`

SR-IOV Network Operator는 Helm 값 `sriovNetworkOperator.enabled: true`로 함께 배포합니다. 26.7.0 기준 지원 Kubernetes는 1.32에서 1.36이며, 1.32 미만에서는 Helm 설치가 실패합니다. GPUDirect RDMA에는 GPU Operator v25.3.x 이상이 필요합니다. 26.7에서는 컴포넌트별 readiness condition이 추가됐습니다.

### GPU Operator 설정과 드라이버 준비 대기

GPU Operator 26.7 RDMA 문서가 정하는 값은 다음과 같습니다.

| 값 | 효과 |
|---|---|
| 플래그 없음 | DMA-BUF 경로. NIC 드라이버는 Network Operator가 관리한다고 가정 |
| `driver.rdma.useHostMofed=true` | 호스트에 직접 설치한 네트워크 드라이버를 사용 |
| `driver.rdma.enabled=true` | legacy nvidia-peermem 경로. 드라이버 파드에 `nvidia-peermem-ctr`가 추가됨 |
| `driver.kernelModuleType=open` | R570 미만 브랜치에서 DMA-BUF를 쓰기 위한 지정 |

과거 이름인 `driver.useOpenKernelModules`는 현재 문서에 없습니다. 드라이버 DaemonSet의 `mofed-validation` init 컨테이너는 Mellanox NIC과 네트워크 커널 심볼 export가 확인될 때까지 기다립니다. legacy 경로에서 peermem 로드에 성공하면 `nvidia-peermem-ctr` 로그에 "successfully loaded nvidia-peermem module"이 남습니다.

GPU Operator 문서가 정하는 설치 순서는 다음과 같습니다.

1. 네트워크 드라이버를 먼저 올린다. Network Operator의 DOCA-OFED 컨테이너이거나 호스트 직접 설치이다.
2. GPU Operator를 설치한다. 드라이버 파드의 init 컨테이너가 네트워크 드라이버 준비를 기다린다.
3. legacy 경로라면 그 뒤에 `nvidia-peermem-ctr`가 모듈을 로드한다.

확인에는 다음 명령을 사용합니다. 노드에서 `lsmod | grep nvidia`를 실행한 문서 예시 출력에는 `nvidia_peermem`과 `nvidia_fs`가 보입니다.

```bash
kubectl describe ds -n gpu-operator nvidia-driver-daemonset
kubectl logs -n gpu-operator ds/nvidia-driver-daemonset -c nvidia-peermem-ctr
```

### 문서의 파드 예시로 연결 확인하기

GPU Operator 문서의 end-to-end 예시는 MacvlanNetwork(`demo-macvlannetwork`, whereabouts IPAM)와 파드 두 개로 구성됩니다. 파드는 `nvidia.com/gpu: 1`, `rdma/rdma_shared_device_a: 1`, `IPC_LOCK`을 요청합니다. `mellanox/cuda-perftest` 이미지에서 실행하는 명령은 `ib_write_bw --use_cuda=0 --use_cuda_dmabuf`입니다.

예시 결과는 약 92 Gbps입니다. 문서가 링크 속도 같은 측정 조건을 밝히지 않았으므로 이 수치를 성능 기준으로 사용할 수는 없습니다.

NCCL로 실제 GDR 사용 여부를 확인하는 방법, 클라우드별 제공 형태, 운영 함정은 [07편]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}})으로 넘깁니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| MLNX_OFED 종료 일정 | 2024-10 마지막 단독 릴리스(LTS), 2027-10까지 버그·보안 수정, 이후 DOCA-OFED | DOCA MLNX_OFED to DOCA-OFED 전환 가이드 | `✓` |
| DOCA-OFED와 인박스 nvme_rdma 충돌 | `ib_core` 충돌로 호스트 NVMe-over-RDMA 동시 사용 불가 | Network Operator Platform Support | `✓` |
| DOCA 드라이버 컨테이너 검증 커널 | 호스트 커널 6.8.0-100까지 | Network Operator 릴리스 노트(26.1 항목) | `✓` |
| 커널 업그레이드 시 재검증이 운영 항목 | 위 사실에서 이끌어 낸 판단 | — | `≈` |
| GPU Operator RDMA 값 | `driver.rdma.enabled`, `driver.rdma.useHostMofed`, `driver.kernelModuleType`, `mofed-validation` init 컨테이너 | GPU Operator 26.7 RDMA 문서 | `✓` |
| NicClusterPolicy 구성요소 | `ofedDriver`, `rdmaSharedDevicePlugin`, `sriovDevicePlugin`, `ibKubernetes`, `secondaryNetwork`, `nvIpam` 등 | NicClusterPolicy CRD 레퍼런스 | `✓` |
| 지원 범위 | Kubernetes 1.32~1.36(26.7.0), GPU Operator v25.3.x 이상 필요 | Network Operator Platform Support | `✓` |
| 설치 순서와 검증 명령 | 네트워크 드라이버, GPU Operator, peermem 순 | GPU Operator RDMA 문서 | `✓` |
| end-to-end 예시 | `ib_write_bw --use_cuda=0 --use_cuda_dmabuf`, 약 92 Gbps, 링크 속도 등 조건 미기재 | GPU Operator RDMA 문서 | `✓` |

{{% /details %}}

## 7. 확인하지 못한 것

- NVIDIA가 shared netns 모드가 필요하다고 명시한 문장. Spiderpool 문서와 Network Operator 주석으로 간접 확인
- Blackwell이 open 커널 모듈만 지원한다는 점의 1차 출처
- hostNetwork 경로에서 `/dev/infiniband`가 어떻게 노출되는지를 다룬 문서
- 네 경로의 성능 차이를 직접 비교한 측정값
- GPU Operator RDMA 문서 예시의 약 92 Gbps에 해당하는 링크 속도와 측정 조건

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
