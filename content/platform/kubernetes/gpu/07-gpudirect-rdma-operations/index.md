---
title: "07 GPUDirect RDMA가 실제로 쓰이는지 확인하고 클라우드별 차이를 읽기"
description: "GPUDirect RDMA의 실제 사용 여부는 NCCL 채널 로그로 확인하고, busbw는 측정 조건과 함께 읽어야 한다. 클라우드별 제공 경로, DRA로 옮겨가는 NIC 할당, 운영 함정을 2026-10-21 기준으로 정리한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 7
url: "/kubernetes/gpu/07-gpudirect-rdma-operations/"
---

# 07 · GPUDirect RDMA가 실제로 쓰이는지 확인하고 클라우드별 차이를 읽기

## 1. NCCL 채널 로그에서 직접 전송을 확인한다

[06편]({{< relref "/platform/kubernetes/gpu/06-gpudirect-rdma-basics/index.md" >}})의 호스트와 파드 구성을 마쳤어도 통신이 호스트 메모리를 경유할 수 있습니다. NIC(네트워크 인터페이스 카드)이 GPU 메모리에 직접 접근할 수 있도록 준비하는 일과 NCCL(GPU 간 통신 라이브러리)이 그 경로를 사용하는 일은 구분해야 합니다. 실제 선택은 `NCCL_DEBUG=INFO`의 채널 연결 로그에서 확인합니다.

NCCL 2.32.3의 `transport/net.cc`는 `[send] via NET/IB/0` 형태의 로그를 채널마다 남깁니다. GDR(GPUDirect RDMA)이 켜졌다면 `/GDRDMA`가 붙어 `via NET/IB/0/GDRDMA`로 표시됩니다. 이 표시는 GPU 메모리에서 직접 전송하는 경로이고, `via NET/IB/0`만 있으면 호스트 메모리를 경유합니다. 소스의 로그 형식은 `[send] via NET/%s/%d%s%s%s`이며 C2C 플랫폼에서 PCI 강제 매핑을 쓰면 `(PCI)`, 공유 연결이면 `/Shared`도 붙습니다.

장치 선택과 채널 연결은 로그의 서로 다른 부분입니다. `NET/IB : Using [0]mlx5_0:1/IB [1]mlx5_1:1/RoCE [RO]; OOB eth0:<ip>`에서는 선택한 장치, IB/RoCE 링크 계층, 부트스트랩 인터페이스를 읽습니다. `[RO]`는 relaxed ordering입니다. init.cc 소스의 형식은 `NET/IB : Using%s %s; OOB %s:%s`입니다. 공식 로깅 문서에는 `Using network IB`, 소켓 폴백을 나타내는 `via NET/Socket/0`, `DMA-BUF is available on GPU device 0` 예시도 있습니다.

GDR이 꺼진 이유까지 항상 로그에 나오는 것은 아닙니다. paths.cc의 `GPU Direct RDMA Enabled for ...` 또는 `Disabled for ... (distance X > Y)` 문구는 `NCCL_DEBUG_SUBSYS`에 GRAPH와 NET을 켜더라도 TRACE 빌드에서만 출력됩니다. 일반 빌드의 INFO 로그에서는 채널의 경로를 확인하되, 거리 판정 사유가 없다는 이유로 거리 문제를 배제해서는 안 됩니다.

다음 도식은 C2C 플랫폼의 예외를 제외한 기본 경로에서 GPU와 NIC 사이 거리가 PXB 이내이고 GDR 경로가 있는지를 확인하는 흐름입니다.

{{< flow src="_flow/2-nccl-gdr-판정.json" />}}

조사 기준일은 2026-10-21입니다. NCCL v2.32.3-1, nccl-tests v2.21.1, Kubernetes v1.37.1, DraNet v1.5.0, k8s-device-plugin v0.20.1, aws-ofi-nccl v1.21.1의 릴리스·태그와 문서를 사용했습니다. GitHub가 릴리스 연도를 표시하지 않은 경우에는 태그 순서와 문서 날짜로 연도를 추정했습니다.

## 2. busbw를 비교할 때는 통신 종류와 규모를 맞춘다 {#2-busbw는-측정-조건과-함께-읽는다}

직접 경로를 확인한 뒤에는 nccl-tests의 `all_reduce_perf` 등으로 처리량을 측정할 수 있습니다. 이때 busbw는 NIC의 링크 속도를 그대로 출력한 값이 아닙니다. nccl-tests의 PERFORMANCE.md는 all_reduce에서 `busbw = algbw × (2(n-1)/n)`로 계산하며, NVLink·PCI·QPI·네트워크 중 하드웨어 병목의 속도를 반영해야 하는 값이라고 설명합니다. 출력에는 메시지 크기별 out-of-place와 in-place의 시간, algbw, busbw가 나오고 마지막에 `# Avg bus bandwidth`가 붙습니다.

AWS EKS 문서의 실행 예시는 p5.48xlarge 2대에 `mpirun -np 16 -N 8`을 사용하고 `all_reduce_perf -b 8 -e 16G -f 2 -g 1 -c 1 -n 100`을 실행합니다. 워커마다 `nvidia.com/gpu: 8`, `vpc.amazonaws.com/efa: 32`, `hugepages-2Mi: 5120Mi`를 요청합니다. 명령만 복사하기보다 GPU·NIC 수와 메모리 요청까지 함께 확인해야 합니다.

확보한 공개 측정값은 사업자나 도구 제작자가 낸 자료입니다. NVIDIA 공식 문서의 DGX H100 기준 nccl-tests 값은 찾지 못했습니다. 다음 수치도 각 출처가 밝힌 조건 안에서 읽어야 합니다.

| 출처 | 측정 조건 | 보고된 busbw |
|---|---|---|
| Crusoe | `h100-80gb-sxm-ib.8x` VM 2대, H100 SXM 8장씩, IB, `-b 8 -e 2G`, `NCCL_IB_HCA`로 8포트 지정 | 2GB에서 361.06(out-of-place) / 361.87(in-place) GB/s, 1GB에서 354.78 GB/s. 2GB 값은 약 361 GB/s |
| SkyPilot의 CoreWeave 예제 | H200 8장씩 2노드, NCCL 2.26.2, all_reduce, `-b 512M -e 8G` | 평균 462.453 GB/s(약 462), 8GB in-place 피크 482.49 GB/s. IB를 끄면 3.7478 GB/s(약 3.7) |
| DraNet GKE 문서 | A4(B200) 8장씩 2노드, GKE RDMA, DraNet, NCCL 2.26.6, all_gather `-b 1K -e 8G` | 평균 59.36 GB/s, 4GiB 피크 약 261.57 GB/s(큰 메시지에서 약 262) |

all_reduce와 all_gather를 섞거나 메시지 크기·노드 수·하드웨어 세대가 다른 상태에서 값의 크기만으로 구성을 평가할 수는 없습니다. 2노드 all_reduce의 busbw에는 노드 내부 NVLink로 축약되는 비율도 반영됩니다. H200 사례의 약 482 GB/s처럼 NIC 합계 8×400Gb/s, 약 400GB/s보다 큰 값이 나올 수 있습니다. 이 설명은 공개 수치와 NIC 합계를 비교한 해석입니다.

같은 이유로 노드 사이 네트워크 성능을 따로 보려면 노드 수를 늘리거나 노드당 rank 하나로 측정하는 편이 나아 보입니다. 이는 위 수치에서 이끌어 낸 측정 제안이며, 이 글에서 별도로 검증한 결과는 아닙니다.

## 3. 경로와 성능이 예상과 다를 때 확인할 설정 {#3-느려지는-지점을-호스트와-파드에서-찾는다}

GPUDirect RDMA가 켜지지 않아도 오류 없이 통신이 이어지고 처리량만 낮아질 수 있습니다. 채널 로그에서 선택한 경로를 확인한 다음에는 거리 제한, PCIe 설정, 파드 메모리 권한, 패브릭 혼잡 상태를 구분해서 살펴보아야 합니다.

### 환경변수로 거리 제한을 풀 때

다음 항목은 NCCL 2.32.3 환경변수 문서에 정의돼 있습니다.

| 변수 | 뜻 |
|---|---|
| `NCCL_IB_HCA` | `<hca>[:<port>[:<rail>[:<plane>]]]`의 쉼표 목록. `^`는 제외, `=`는 정확 일치. 예 `^=mlx5_1,mlx5_4` |
| `NCCL_NET_GDR_LEVEL` | GDR을 허용할 최대 거리. LOC(끔), PIX, PXB, PHB, SYS(항상 켬). 미설정이면 자동 선택 |
| `NCCL_SOCKET_IFNAME` | 부트스트랩·소켓용 인터페이스 접두어 목록. 기본으로 `lo`와 `docker*`를 제외 |
| `NCCL_IB_DISABLE` | IB/RoCE 전송을 끄고 소켓으로 폴백 |
| `NCCL_IB_GID_INDEX` | 2.32u1부터 기본 AUTO. 2.21 이후에는 설정하지 말 것 |
| `NCCL_NET_GDR_READ` | 2.4.2부터 NVLink 플랫폼 기본 1, 그 외 0 |

`NCCL_NET_GDR_LEVEL`에 숫자를 넣으면 소스의 `levelsOldToNew`에 있는 옛 번호 체계로 해석합니다. 0은 LOC, 1은 PIX, 2는 PXB, 3은 PHB, 4 이상은 SYS입니다. Red Hat OpenShift AI 예시의 `NCCL_NET_GDR_LEVEL: "5"`도 SYS이므로 기본 PXB 거리 제한을 해제합니다. 환경변수로 바뀐 값은 `NCCL_NET_GDR_LEVEL set by environment to SYS`처럼 로그에 표시됩니다.

거리 제한을 풀어도 물리적 PCIe 경로는 바뀌지 않습니다. 06편에서 본 CUDA 문서의 QPI 경고를 고려하면, 먼 NIC에서 GDR을 강제하는 설정은 위험할 수 있다고 해석할 수 있습니다.

`NCCL_IB_GID_INDEX`는 오래된 예시에서 특히 주의할 값입니다. 2.21 이전에는 `show_gids`로 RoCE v2 GID를 골랐고 `NCCL_IB_GID_INDEX=3` 같은 고정값이 블로그에 남아 있습니다. 환경변수 문서의 기본값은 2.32u1부터 AUTO이며, 현재 네트워킹 트러블슈팅 문서는 "With NCCL 2.21 and later releases, this environment variable should not be set."라고 명시합니다.

### PCIe 경로를 바꾸는 ACS와 IOMMU

NCCL GPU 트러블슈팅 문서는 IO 가상화(ACS)가 PCI 피어 투 피어 트래픽을 CPU root complex로 돌려 큰 성능 저하나 멈춤을 일으킬 수 있다고 설명합니다. `sudo lspci -vvv | grep ACSCtl`에서 `SrcValid+`가 보이면 ACS가 켜져 있을 가능성이 있습니다. 문서는 BIOS 또는 `setpci`로 해제하는 방법을 안내하며 예시 명령은 `setpci -s 03:00.0 ECAP_ACS+0x6.w=0000`입니다. PLX 스위치는 재부팅할 때마다 다시 설정해야 합니다. VM에서는 ACS가 필수이므로 NIC의 ATS를 켜야 합니다.

IOMMU에 대해서는 "CUDA and the NVIDIA driver stack do not support IOMMU-enabled PCIe peer-to-peer memory transfer"라고 명시합니다. 베어메탈에서는 메모리 손상을 막기 위해 IOMMU를 꺼야 한다는 설명입니다. 활성 상태는 `dmesg | grep -i -E "iommu|dmar|default domain"`의 `Default domain type: Translated`로 확인합니다. CUDA 문서가 요구하는 구성은 disabled 또는 pass-through이며, 확인한 두 문서에는 `iommu=pt`라는 파라미터 이름이 나오지 않습니다.

### 메모리 고정 권한과 공유 메모리

Linux의 drivers/infiniband/core/umem.c에서 `ib_umem_get()`은 고정하려는 페이지가 `RLIMIT_MEMLOCK`을 넘고 `CAP_IPC_LOCK`도 없으면 요청을 거부합니다. NVIDIA와 Azure의 파드 예시는 privileged 대신 `capabilities.add: ["IPC_LOCK"]`을 사용합니다. 이 권한으로 해결하는 것은 메모리 고정 제한이며, Azure 가이드 주석의 설명처럼 `ulimit -l` 표시값까지 unlimited가 되는지는 확인하지 못했습니다. 커널은 limit을 무시하고 표시값은 런타임 설정에 달린 것으로 추정합니다.

공유 메모리도 별도 조건입니다. NCCL 런타임 트러블슈팅 문서는 Docker에서 `--shm-size=1g --ulimit memlock=-1`을 권합니다. `/dev/shm`이 부족하면 `failed to extend /dev/shm/nccl-...` 경고와 함께 초기화가 실패합니다. Kubernetes에서는 `emptyDir: {medium: Memory}` 또는 hostPath `/dev/shm`을 사용합니다.

EFA에는 hugepages가 필수입니다. Mellanox verbs 경로 전체에 공통으로 필요하다는 근거는 찾지 못했고, Network Operator deployment guide는 DPDK 애플리케이션에 hugepage 구성이 필요하다고 설명합니다. Azure 가이드의 Operator 네임스페이스에는 `pod-security.kubernetes.io/enforce=privileged` 라벨이 필요하지만 워크로드 파드의 예시는 IPC_LOCK을 사용합니다. NUMA 관련 cuMem 호스트 할당에는 `SYS_NICE`가 필요할 수 있다는 점도 NCCL 문서에 나옵니다.

### RoCE의 지연과 처리량이 흔들릴 때

NCCL 네트워킹 트러블슈팅 문서는 PFC·ECN·CNP·큐 드롭 카운터가 오르고 지연 꼬리가 길어지거나 처리량이 흔들리면 혼잡 제어와 lossless 설정을 먼저 확인하도록 안내합니다. pause와 PFC 카운터는 `ethtool -S`로 봅니다.

재전송 한도를 넘으면 NCCL은 `NET/IB: Got completion from peer ... with status=...` 경고를 내고 통신에 실패합니다. p2p.cc와 connect.cc 소스의 기본값은 `NCCL_IB_TIMEOUT` 20, `NCCL_IB_RETRY_CNT` 7입니다. 이 경고를 lossless 미설정과 연결하는 것은 추정이므로, `status=`만으로 원인을 확정하지는 않습니다.

패브릭의 설정·검증은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})과 [11편]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}}), 스토리지 RDMA는 [08편]({{< relref "/platform/kubernetes/gpu/08-storage-gds-nvmeof/index.md" >}})에서 이어집니다.

## 4. 클라우드의 제품명과 장치 요청을 실제 경로에 대응시킨다 {#4-클라우드의-이름을-실제-전송-경로와-연결한다}

클라우드에서는 같은 GPU 직접 전송이라도 프로토콜과 장치 할당 방법이 다릅니다. Mellanox IB 로그만 찾거나 리소스 이름의 숫자를 NIC 개수로 읽으면 구성을 잘못 해석할 수 있습니다.

### AWS EFA는 libfabric 전송을 확인한다

AWS EFA는 SRD 프로토콜과 libfabric API를 사용합니다. AWS가 부르는 GPU-NIC 직접 경로의 이름은 ADT(Accelerator Data Transfer)이며 EC2 문서는 NVIDIA GPU 인스턴스에서 이를 "referred to as GPUDirect RDMA on NVIDIA GPU instances"라고 설명합니다.

지원 인스턴스는 p5.48xlarge, p5e.48xlarge, p5en.48xlarge, p6-b200, p6-b300, p6e-gb200입니다. p5.4xlarge는 ADT를 지원하지 않습니다. EC2 EFA 가속 인스턴스 문서와 EKS 문서는 카드 수·대역폭·GPU 연결 관계를 인스턴스별로 설명합니다.

| 인스턴스 | 카드·대역폭·토폴로지 |
|---|---|
| p5/p5e | 네트워크 카드 32개, 총 3,200 Gbps |
| p5.48xlarge | GPU 하나와 같은 PCIe root를 공유하는 EFA 장치가 4개 |
| p6-b200 | GPU 8개, 카드 8개, 카드당 400 Gbps, 총 3,200 Gbps |
| p6-b300 | 카드 17개, EFA 최대 6,400 Gbps |

Kubernetes에서는 EFA 디바이스 플러그인의 `vpc.amazonaws.com/efa` 또는 EFA DRA 드라이버를 사용합니다. 디바이스 플러그인 요청은 정수 개수이며 파드가 장치를 독점합니다. DRA(Dynamic Resource Allocation)는 Kubernetes의 장치 할당 기능입니다. EKS 문서의 EFA DRA 구현은 DRANET으로, Helm `eks/aws-dranet`과 DeviceClass `efa.networking.k8s.aws`를 사용합니다. EKS는 1.34 이상 신규 배포에 DRA를 권장하며 두 방식을 한 노드에 함께 설치하면 과다 할당 위험이 있다고 경고합니다.

EFA 드라이버는 2MiB 페이지 5128개를 미리 할당하므로 파드도 `hugepages-2Mi`를 요청해야 합니다. NCCL은 aws-ofi-nccl 플러그인을 쓰고 EKS 예시에는 `NCCL_TUNER_PLUGIN`도 지정돼 있습니다. 이 구성에서는 libfabric(`ofi`) 전송 로그로 성공 여부를 확인합니다.

### GKE는 GPU 세대에 따라 경로가 달라진다

GKE의 A3 High는 보조 NIC 4개, `nccl-tcpx-installer` DaemonSet, 파드별 `tcpx-daemon` 사이드카로 GPUDirect-TCPX를 구성합니다. A3 Mega는 보조 NIC 8개와 `nccl-tcpxo-installer`를 쓰는 GPUDirect-TCPXO입니다. 두 경로 모두 `nri-device-injector`, `networking.gke.io/interfaces` 어노테이션, gVNIC가 필요합니다.

GKE 문서는 TCPX/TCPXO가 RDMA인지를 명시하지 않습니다. 이름으로는 TCP 기반 GPU 직접 수신 계열로 해석되므로 GPUDirect RDMA와 구분했습니다.

GPUDirect RDMA(RoCE)는 A3 Ultra, A4, A4X, A4X Max부터 제공됩니다. GKE AI Hypercomputer 문서에서 A3 Ultra와 A4의 구성은 GPU용 400 Gbps CX-7 NIC 8개와 외부용 200 Gbps Titanium NIC 2개이며, non-blocking 3.2 Tbps로 설명합니다.

RDMA VPC는 `--network-profile=${ZONE}-vpc-roce`로 만들고 `nccl-rdma-installer`로 gIB NCCL 플러그인을 설치합니다. 멀티네트워크 API에서는 `deviceMode: RDMA`인 `GKENetworkParamSet`과 `type: "Device"`인 `Network`를 구성합니다.

다른 할당 경로인 GKE managed DRANET은 DeviceClass `mrdma.google.com`을 사용합니다. Standard 1.34.1-gke.1829001 이상 또는 Autopilot 1.35.2-gke.1842000 이상이어야 하며 노드 풀에 `cloud.google.com/gke-networking-dra-driver=true` 라벨을 붙입니다. DRA 네트워크 할당 문서는 managed DRANET과 멀티네트워크 API를 함께 쓰지 말라고 명시합니다. GA 시점을 2026-04로 설명한 릴리스 노트는 검색 요약에서만 보았으며 원문은 확인하지 못했습니다.

### Azure와 CoreWeave의 리소스 이름을 읽는 법

Azure ND H100 v5 문서는 GPU마다 전용 400 Gbps Quantum-2 CX7 InfiniBand, VM당 3.2 Tbps, GPU Direct RDMA 지원을 명시합니다. AKS 구성은 aks-rdma-infiniband 저장소에서 `AKSInfinibandSupport` 기능 등록과 노드풀의 `--gpu-driver none`을 안내합니다. 이 저장소는 아직 작성 중이라고 밝히며 AKS 공식 지원 범위 밖의 구성도 포함합니다.

가이드의 Network Operator 선택지는 SR-IOV `rdma/ib`, shared `rdma/shared_ib`, IPoIB입니다. `rdma/ib`는 NIC당 1개를 파드가 독점하는 요청이고 `rdma/shared_ib`는 기본 63슬롯을 공유하는 요청입니다.

CoreWeave의 같은 이름은 다르게 해석해야 합니다. CoreWeave 문서는 `rdma/ib: 1`을 장치 개수가 아닌 IB 노드 스케줄링용 플래그라고 설명합니다. NCCL 설정은 `NCCL_IB_HCA=ibp`, `NCCL_SOCKET_IFNAME=eth0`을 사용합니다.

Oracle OCI에 대해서는 DraNet v1.5.0 릴리스가 OKE의 native InfiniBand 지원을 추가했다는 사실을 확인했습니다. OCI OKE와 Lambda의 Kubernetes GPUDirect RDMA 공식 문서는 찾지 못했습니다.

## 5. DRA로 GPU와 NIC의 PCIe root를 맞춘다 {#5-gpu와-nic의-정렬을-할당-조건으로-만든다}

NIC 할당에서 토폴로지를 고려한 효과는 DraNet의 GKE RDMA 문서에도 나옵니다. 4워커가 각각 GPU 4개와 NIC 4개를 사용하는 구성에서 정렬했을 때 평균 22.2173, 정렬하지 않았을 때 11.2291로 보고했습니다. 반올림하면 22.2 대 11.2이며 비정렬 결과가 절반 수준입니다. 벤더 문서의 측정값이므로 이 구성 밖의 효과를 보장하지는 않습니다.

Kubernetes의 표준 장치 속성 `resource.kubernetes.io/pcieRoot`는 `pci<domain>:<bus>` 형태입니다. `matchAttribute`로 GPU와 NIC의 속성값을 같게 제한하면 같은 PCIe root에 속하는 장치를 요청할 수 있습니다. 같은 root라는 조건이 같은 PCIe 스위치 하나 아래에 있다는 뜻은 아닙니다. 06편의 PIX·PXB·PHB 구분처럼 실제 GPU-NIC 경로도 확인해야 합니다.

노드 내부 토폴로지는 [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}}), DRA의 일반적인 할당 방식은 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에서 다뤘습니다. 다음 ResourceClaimTemplate은 DRA Driver for SR-IOV를 사용해 GPU와 VF의 PCIe root를 맞춥니다.

```yaml
apiVersion: resource.k8s.io/v1
kind: ResourceClaimTemplate
metadata:
  name: resource-alignment
spec:
  spec:
    devices:
      requests:
      - name: vf
        exactly:
          deviceClassName: sriovnetwork.k8snetworkplumbingwg.io
          selectors:
          - cel:
              expression: >
                device.attributes["k8s.cni.cncf.io"].resourceName == "nvidia.com/sriov_resource"
      - name: gpu
        exactly:
          deviceClassName: gpu.nvidia.com
          count: 1
      constraints:
      - matchAttribute: "resource.kubernetes.io/pcieRoot"
        requests: [vf, gpu]
```

### DRA 코어와 NIC 드라이버의 지원 단계

DRA 코어의 GA와 개별 NIC 드라이버의 지원 상태는 별개입니다. Kubernetes 공식 v1.34 DRA 블로그는 코어가 v1.34에서 GA가 됐고 `resource.k8s.io/v1`이 기본이라고 설명합니다. DraNet README의 stable 시점은 v1.35로 한 버전 다르게 적혀 있으므로 여기서는 공식 블로그를 따릅니다.

Kubernetes v1.37 DRA 블로그(2026-09-03)에 따르면 KEP-4817의 ResourceClaim `.status.devices`가 Stable이 됐습니다. 이 필드로 네트워크 장치의 인터페이스 이름, MAC, IP를 보고합니다. 같은 버전에서 DRA Extended Resource(KEP-5004)도 GA가 되어 파드가 `example.com/gpu` 같은 기존 extended resource 이름으로 요청해도 DRA 드라이버가 처리할 수 있습니다. 드라이버별로 다른 토폴로지 속성 이름을 CEL로 맞추는 Derived Attributes(KEP-6080)는 v1.37 Alpha입니다.

DraNet은 RDMA NIC을 파드에 할당하는 Kubernetes Network Driver입니다. 저장소는 google/dranet에서 kubernetes-sigs/dranet으로 이동했고, SIG Network 하위 프로젝트 이관 요청은 kubernetes/org#5979에 있습니다. google/dranet은 archived 상태입니다. v1.5.0은 Broadcom과 Mellanox RoCE SR-IOV VF에 `dra.net/rdmaDevice` 속성을 추가했습니다. 앞서 본 GKE managed DRANET(`mrdma.google.com`)과 EKS EFA DRA 드라이버도 클라우드의 제공 경로입니다.

NVIDIA GPU DRA 드라이버 k8s-dra-driver-gpu v0.5.1은 ComputeDomain과 IMEX를 중심으로 설명하며 네트워크·RDMA 기능은 언급하지 않습니다. NIC은 별도 DRA Driver for SR-IOV인 k8snetworkplumbingwg/dra-driver-sriov가 맡습니다. 이 드라이버는 Network Operator 26.7에서 Tech Preview이며 프로덕션에 권장되지 않습니다. 조사 시점에 태그도 없습니다.

NVIDIA SR-IOV 구성에서 DRA를 켜면 디바이스 플러그인은 실행되지 않습니다. GB300 NVL72, Vera Rubin NVL72, HGX Rubin NVL8(CX-8 이상)은 NIC-GPU 매칭용 PCIe root가 Data Direct 하위 인터페이스에 있어 아직 지원하지 않습니다. 이 제약은 Network Operator의 dra-sriov-driver 문서에 따른 것입니다.

### 전환 전에 맞춰 볼 버전과 구성요소

Network Operator 26.7 Platform Support의 지원 범위는 Kubernetes 1.32~1.36, DOCA 3.5.0 GA와 3.2.2 LTS, Ubuntu 22.04/24.04/26.04, RHEL 8.8~10.2, OpenShift 4.17~4.22입니다. Ubuntu generic 커널만 GA이며 aws/azure/oracle/nvidia 커널 flavor는 Tech Preview입니다. Kubernetes 코어의 DRA 상태만 보고 이 지원 범위를 넘겨 판단해서는 안 됩니다.

GPU 디바이스 플러그인의 장치 주입 동작도 맞춰 보아야 합니다. k8s-device-plugin v0.19.0~v0.19.2에서는 MOFED가 기본으로 켜져 GPU 컨테이너에 `/dev/infiniband/uverbs*`를 모두 마운트했습니다. v0.19.3 CHANGELOG의 "revert default enablement of features mofed, gdrcopy and mofed (#1837)"가 이 변경을 되돌린 기록입니다. 조사 시점의 stable은 v0.20.1입니다.

할당 주체를 중복 설치하는 구성도 피해야 합니다. EFA 디바이스 플러그인과 EFA DRA 드라이버는 같은 노드에서 함께 운용하면 안 됩니다. NVIDIA SR-IOV 디바이스 플러그인과 DRA SR-IOV 드라이버는 같은 클러스터에서 함께 운용할 수 없습니다. 각각 AWS EKS와 Network Operator 문서가 정한 제한입니다.

이 자료들로 보면 2026-10의 클라우드 RDMA NIC 할당은 GKE와 EKS를 중심으로 DRA로 이동하는 중이라고 판단할 수 있습니다. 온프렘 NVIDIA 스택에서는 shared·SR-IOV·hostdev 디바이스 플러그인이 여전히 주력으로 보이며 NIC용 DRA 드라이버는 Tech Preview입니다. 이는 제품별 문서를 종합한 판단입니다.

## 6. 배포 레퍼런스와 실제 운영 사례를 구분한다 {#6-이-기능은-지금-얼마나-쓰이나}

공개 자료에서 확인한 것은 주로 벤더의 배포 레퍼런스와 클라우드의 제공 경로입니다. 이를 종합하면 2026-10의 대형 학습 클러스터에서 GPUDirect RDMA는 벤더·클라우드가 전제로 문서화하는 기본 경로로 볼 수 있습니다. 회사 이름이 붙은 1차 운영 사례는 확보하지 못했으므로 채택 규모를 직접 확인한 결론은 아닙니다.

NVIDIA Network Operator 문서에는 "Network Operator Deployment for GPUDirect Workloads"라는 표준 예시와 "AI Training at Scale: ... GPUDirect RDMA between GPUs and NICs"라는 사용 사례 설명이 있습니다. DGX SuperPOD·BasePOD 문서는 Network Operator가 DOCA/OFED와 nvidia_peermem 배포를 자동화해 GPUDirect RDMA를 켠다고 설명합니다. SuperPOD의 테스트 스택은 DGX H100, DOCA OFED 3.1.0, Network Operator 25.10, GPU Operator 25.10, MPI Operator 0.6.0이며 Base Command Manager로 설치합니다. Spectrum-X Reference Architecture 2.3은 Network Operator 26.7과 K8s 1.35+로 지원됩니다.

Red Hat OpenShift는 shared device·host device·SR-IOV legacy와 RoCE·IB의 조합을 문서화합니다. OpenShift AI 3.5의 llm-d RoCE 분산 추론은 Tech Preview입니다. NVIDIA는 Cloud Native Stack도 업스트림 Kubernetes에서 GPU/Network Operator를 실행하는 레퍼런스 아키텍처로 소개합니다. 매니지드 환경에는 GKE(A3 Ultra 이상과 managed DRANET), EKS(EFA와 nccl-tests 확인 절차), AKS(ND H100 v5 IB), CoreWeave CKS(`rdma/ib`)의 제공 경로가 있습니다. AKS 가이드에는 앞 절에서 본 공식 지원 범위의 제한이 따릅니다.

이 배포 방식들이 하나로 통일된 것은 아닙니다. 온프렘은 Network Operator와 SR-IOV·hostdev·shared 디바이스 플러그인을 사용하고, 클라우드는 EFA ADT, GKE RDMA, TCPX와 DRANET 기반 드라이버를 제공합니다. 메모리 등록은 nvidia-peermem에서 dma-buf로 옮겨가는 중이지만 DGX SuperPOD·Azure·OpenShift AI 예시는 여전히 peermem을 사용합니다. 자기 환경을 검증할 때도 채널 로그와 busbw뿐 아니라 그 환경이 제공하는 전송·할당 경로를 함께 기록해야 합니다.

OpenAI의 7,500노드 글(2021-01)은 이 기능의 운영 사례로 사용하지 않았습니다. 원문은 403으로 접근하지 못했고, 확인한 미러는 flannel에서 네이티브 파드 네트워킹으로 옮긴 내용으로 InfiniBand나 GPUDirect 언급이 없었습니다. 이 조사에서는 클라우드 사업자 문서가 사례를 대신하는 자료였습니다.

## 7. 확인하지 못한 것

- NVIDIA 공식 문서의 DGX H100 노드 간 nccl-tests 기준 busbw. Crusoe·SkyPilot 등 사업자 값만 확보했습니다.
- GKE TCPX/TCPXO가 RDMA인지 여부. GKE 문서는 이를 명시하지 않습니다.
- GKE managed DRANET의 GA 공지 원문. 검색 요약에서만 2026-04와 1.35.2-gke.1842000을 확인했습니다.
- p5en의 EFA 개수와 대역폭. 조사한 EC2 문서 페이지에 해당 절이 없었습니다.
- OCI OKE와 Lambda의 Kubernetes GPUDirect RDMA 공식 문서.
- NVIDIA DRA SR-IOV 드라이버의 GA 일정과 회사 이름이 있는 Kubernetes GPUDirect RDMA 운영 사례의 1차 출처.
- IPC_LOCK을 추가하면 `ulimit -l`이 unlimited가 된다는 Azure 가이드 주석의 설명. 커널의 제한 우회와 런타임의 표시값은 구분해서 확인해야 합니다.

## 참고 자료

- [NCCL 환경변수 문서](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/env.html)
- [NCCL 로깅 문서](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/logging.html)
- [NCCL GPU 트러블슈팅](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/gpu_troubleshooting.html)
- [NCCL 네트워킹 트러블슈팅](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/networking_troubleshooting.html)
- [NCCL 런타임·MPI 트러블슈팅](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/runtime_and_mpi_issues.html)
- [nccl-tests — PERFORMANCE.md](https://github.com/NVIDIA/nccl-tests/blob/master/doc/PERFORMANCE.md)
- [Linux — drivers/infiniband/core/umem.c](https://raw.githubusercontent.com/torvalds/linux/master/drivers/infiniband/core/umem.c)
- [AWS EC2 — EFA](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/efa.html)
- [AWS EC2 — EFA 가속 인스턴스 유형](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/efa-acc-inst-types.html)
- [AWS EKS — EFA 노드](https://docs.aws.amazon.com/eks/latest/userguide/node-efa.html)
- [GKE — GPUDirect-TCPX 대역폭](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/gpu-bandwidth-gpudirect-tcpx)
- [Google Cloud — GKE AI Hypercomputer 커스텀 클러스터](https://docs.cloud.google.com/ai-hypercomputer/docs/create/gke-ai-hypercompute-custom)
- [GKE — DRA로 네트워크 리소스 할당](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/allocate-network-resources-dra)
- [Azure — ND H100 v5 시리즈](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/ndh100v5-series)
- [Azure aks-rdma-infiniband](https://github.com/Azure/aks-rdma-infiniband)
- [CoreWeave — GPUDirect RDMA 사용](https://docs.coreweave.com/products/networking/hpc-interconnect/use-gpudirect-rdma)
- [SkyPilot — CoreWeave InfiniBand 예제](https://docs.skypilot.ai/en/latest/examples/performance/coreweave_infiniband.html)
- [Crusoe — InfiniBand 성능 검증](https://docs.crusoecloud.com/networking/infiniband/validating-infiniband-performance)
- [DraNet 저장소](https://github.com/kubernetes-sigs/dranet)
- [DraNet 릴리스](https://github.com/kubernetes-sigs/dranet/releases)
- [kubernetes/org#5979](https://github.com/kubernetes/org/issues/5979)
- [DraNet — GKE RDMA](https://dranet.sigs.k8s.io/docs/user/gke-rdma/)
- [Kubernetes v1.34 DRA 업데이트](https://kubernetes.io/blog/2025/09/01/kubernetes-v1-34-dra-updates/)
- [Kubernetes v1.37 DRA 업데이트](https://kubernetes.io/blog/2026/09/03/kubernetes-v1-37-dra-updates/)
- [Kubernetes DRA 표준 장치 속성](https://kubernetes.io/docs/reference/node/dra-standard-device-attributes/)
- [NVIDIA k8s-dra-driver-gpu 릴리스](https://github.com/NVIDIA/k8s-dra-driver-gpu/releases)
- [dra-driver-sriov](https://github.com/k8snetworkplumbingwg/dra-driver-sriov)
- [k8s-device-plugin CHANGELOG](https://github.com/NVIDIA/k8s-device-plugin/blob/main/CHANGELOG.md)
- [Network Operator 26.7 Platform Support](https://docs.nvidia.com/networking/display/kubernetes2670/platform-support.html)
- [Network Operator 26.7 릴리스 노트](https://docs.nvidia.com/networking/display/kubernetes2670/release-notes.html)
- [DGX SuperPOD — Network Operator 설치](https://docs.nvidia.com/dgx-superpod/dgx-explained/network-operator/latest/network-operator-installation.html)
- [NVIDIA EGX stack](https://developer.nvidia.com/egx-stack)
- [Red Hat OpenShift — RDMA](https://docs.redhat.com/en/documentation/openshift_container_platform/4.18/html/hardware_accelerators/rdma-remote-direct-memory-access)
- [Red Hat OpenShift AI 3.5 — RoCE 분산 추론 구성](https://docs.redhat.com/en/documentation/red_hat_openshift_ai_self-managed/3.5/html/working_with_distributed_workloads/configuring-roce-networking-for-distributed-llm-deployments_distributed-llm-roce)
- [OpenAI — Scaling Kubernetes to 7,500 nodes](https://openai.com/index/scaling-kubernetes-to-7500-nodes/)
