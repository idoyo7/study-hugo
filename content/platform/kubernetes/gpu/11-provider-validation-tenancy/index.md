---
title: "11 GPU 클러스터 인수 검증과 테넌트 격리 기준"
description: "GPU 클러스터를 사용자에게 제공하기 전에 확인할 토폴로지, NCCL, 성능 합격선, 관측, 격리 조건을 정리한다. 하드웨어별 기준을 세우고 테넌트 경계를 구성하는 방법을 2026-10-21 기준으로 설명한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 11
url: "/kubernetes/gpu/11-provider-validation-tenancy/"
---

# 11 · GPU 클러스터 인수 검증과 테넌트 격리 기준

[10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})에서 FM·IMEX와 노드 간 패브릭을 구성했다면, 이제 사용자에게 제공할 범위를 정하고 그 구성으로 검증해야 합니다. 배선과 토폴로지 정보를 Kubernetes에 전달하고, 테넌트 경계와 NCCL 경로를 맞춘 뒤, 하드웨어별 합격선을 측정합니다. 운영 중에는 관측 결과가 어느 조건에서 격리로 이어질지도 정해야 합니다.

이 글은 2026-10-21에 확인한 문서를 기준으로 합니다. 조사 버전은 NCCL 2.32.3, nccl-tests v2.21.1, DCGM 4.6.1, dcgm-exporter 4.8.4, GPU Operator 26.7.2, NVIDIA Cluster Readiness Engine(NVCRE) v0.8.1, NVSentinel v1.28.0, topograph v1.0.0, perftest 26.07.8입니다. 문서의 요구 사항과 이를 종합한 운영상 판단을 구분합니다.

## 1. 배선한 토폴로지를 Kubernetes와 NCCL에 전달한다 {#2-배선-규칙과-kubernetes로-내려오는-토폴로지-정보}

NCCL 2.12 블로그에서 rail-optimized(레일 최적화)는 각 DGX의 NIC-0을 같은 리프에, NIC-1을 다른 리프에 연결하는 배선입니다. NCCL의 PXN은 노드 안 NVSwitch를 통해 데이터를 목적지와 같은 레일의 GPU로 옮긴 뒤 내보냅니다. SHARP(인네트워크 리덕션)도 같은 레일의 HCA가 같은 리프에 연결돼야 합니다. NCCL이 HCA 레일마다 집계 플로를 만들기 때문입니다.

{{< flow src="_flow/2-rail-optimized-배선.json" />}}

이 배선 원칙을 실제 규모로 옮길 때는 SU(Scalable Unit)와 스위치 수를 해당 레퍼런스에서 확인해야 합니다. H100 SuperPOD는 SU당 32노드이며 UFM 연결이 들어간 한 SU는 31노드입니다. 노드당 8 GPU, SU당 리프 8대이고 1·2·3·4 SU의 스파인 수는 각각 4·8·16·16대입니다. 4 SU는 127노드, 1,016 GPU, 리프 32대, 스파인 16대로 구성됩니다.

H100 문서는 SU 안에서 같은 레일이 다른 31노드와 1홉으로 연결되고, 노드와 레일을 넘는 트래픽은 스파인을 지난다고 설명합니다. 레일 최적화는 최상위 계층까지 이어지며 전체는 균형 잡힌 full fat-tree입니다. B300의 구성 단위는 패브릭에 따라 달라집니다.

| 레퍼런스 | rail-aligned 단위 | 전체 규모 | 특징 |
|---|---|---|---|
| B300 + Quantum-X800 XDR(2026-09-02 갱신) | 72노드 | 576노드(8 × 72) | SU 간·레일 간 트래픽은 스파인 경유. UFM 3.5 노드가 Q3400의 FNM 포트 4개에 연결 |
| B300 + Spectrum-4(2025-11-19 갱신) | 64노드 | 512노드 | GPU당 2 × 400GbE를 두 plane으로 나눈 twin-planar. plane마다 2단 spine-leaf이고 코어로 묶지 않음 |

Spectrum-4판은 스위치·트랜시버·케이블 하나의 장애에도 잡이 중단되지 않고 약 절반 대역폭으로 계속 실행된다고 설명합니다. Quantum-X800 매뉴얼은 Q3400(144 × 800G)으로 2단 fat-tree에 최대 10,368 NIC을 연결할 수 있다고 제시하며, 데이터시트는 "10,000개 이상"으로 표현합니다. 144포트 중 절반인 72포트를 아래로 쓰는 리프 144대라고 계산해도 10,368이 나옵니다. 이 계산은 문서 수치에서 도출한 값입니다. 문서가 직접 설명한 홉 수는 "1홉"과 "스파인 경유"이며, 리프-스파인-리프를 3홉, 3단 코어 경유를 5홉으로 보는 일반식은 추정입니다.

### 노드 라벨과 NIC 레일의 구분

topograph v1.0.0은 스위치 계층을 `fabric.topograph.run/tier-N`으로 나타냅니다. 0은 노드에 가장 가까운 스위치이고 깊이 제한은 없습니다. NVLink 도메인은 `accelerator.topograph.run/domain`, 하위 구분은 `accelerator.topograph.run/sub-domain`입니다. 문서 예시는 `tier-0: s1`, `tier-1: s2`, `tier-2: s3`, `domain: nvl1`, `sub-domain: nvl1.rack01`입니다.

입력 소스는 AWS·GCP·OCI·Nebius·Nscale·Crusoe·Lambda API, NetQ, InfiniBand `ibnetdiscover`, DRA이며 출력 엔진은 slurm, k8s(라벨), nfd, slinky입니다. 옛 `network.topology.nvidia.com/*` 키는 현행 문서에 없고 개명 시점도 확인하지 못했습니다. 예전 예시의 키를 그대로 가져오기보다 사용 버전의 키를 확인해야 합니다.

NVLink 파티션 ID `ClusterUUID.CliqueId`는 GPU Operator의 `nvidia.com/gpu.clique` 라벨과 같습니다. MNNVL에서 FM이 작업을 마치지 않으면 라벨도 생성되지 않습니다. 10편의 `system not yet initialized` 오류와 Fabric State `In Progress`가 이 단계에서는 라벨 부재로 드러날 수 있습니다. FM의 드라이버 620 이후 분리 배포 조건 역시 10편에서 다뤘습니다.

레일은 노드보다 NIC 단위의 정보입니다. Spectrum-X의 `SpectrumXRailPoolConfig`는 `railTopology[].nicSelector.pfNames`로 레일을 지정하고 RDMA 디바이스 이름을 `rdma_<rail topology name>`으로 만듭니다. NCCL의 `NCCL_IB_HCA` 형식도 `<hca>[:<port>[:<rail>[:<plane>]]]`입니다. 이를 종합하면 블록·리프·스파인·NVLink 도메인은 노드 라벨로, 레일은 NIC 이름과 설정으로 전달하는 구성이 적합해 보입니다.

토폴로지를 읽는 방법은 [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}}), 라벨을 이용한 스케줄링은 [04편]({{< relref "/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md" >}})에 있습니다.

## 2. 테넌트 경계와 공유 트래픽의 범위를 정한다 {#6-테넌트-경계를-만드는-디바이스와-패브릭-계층}

사용자에게 파드를 내주기 전에 RDMA 디바이스의 소유 범위, InfiniBand·NVLink 파티션, 스토리지와 관리 트래픽의 분리를 정해야 합니다. 각 계층의 분리 수단은 목적과 보장 범위가 다릅니다.

### 노드 안 RDMA 디바이스 {#노드-안-rdma-디바이스}

RDMA CNI는 SR-IOV 인터페이스의 RDMA 디바이스를 컨테이너 netns(네트워크 네임스페이스)로 옮깁니다. RDMA 서브시스템은 exclusive 모드여야 하며 `ib_core`의 `netns_mode=0` 또는 `rdma system set netns exclusive`로 설정합니다. 모드를 바꾸려면 초기 호스트 네트워크 네임스페이스(`init_net`) 외에 다른 netns가 없어야 합니다. Linux v6.18의 RDMA 코어는 다른 netns가 있으면 모드 변경을 `-EBUSY`로 거부합니다. 요구 버전은 커널 5.3 이상 또는 MOFED 4.7 이상입니다.

`k8s-rdma-shared-dev-plugin`은 HCA 하나를 `rdmaHcaMax`개 리소스로 광고해 여러 파드가 공유하게 합니다. README는 이 방식의 격리를 보장하지 않습니다. 이 차이를 근거로 보면 멀티테넌트 풀에는 SR-IOV VF와 exclusive 모드 RDMA CNI를, 공유 플러그인은 단일 테넌트 풀에 두는 편이 적합해 보입니다. 이는 플러그인 동작에서 도출한 운영상 판단입니다.

Spectrum-X는 SR-IOV Device Plugin이 VF를 `nvidia.com/...` 리소스로 광고하고, OVS-CNI가 VF를 레일 OVS 브리지에 연결합니다. NV-IPAM이 주소를 배정한 뒤 RDMA-CNI가 RDMA 디바이스를 파드 netns로 옮기며 여기에도 exclusive 모드가 필요합니다. ResourceQuota로 네임스페이스별 VF 개수를 제한하는 것은 Kubernetes의 일반 기능이지만, 패브릭 문서에서 이 구성을 직접 권한 근거는 찾지 못했습니다.

### InfiniBand와 NVLink의 파티션 {#infiniband와-nvlink의-파티션}

InfiniBand에서는 PKey(파티션 키)를 만들고 GUID를 배정합니다. UFM REST API의 PKey 범위는 0x0~0x7fff입니다. full 멤버는 파티션의 모든 멤버와 통신할 수 있고 limited 멤버끼리는 통신하지 못합니다. UFM 6.25.1·6.26.1 가이드의 API 경로는 버전에 따라 `/ufmRest/resources/pkeys` 또는 `/ufmRestV2/plugin/fast_api/resources/pkeys/`입니다.

파드를 PKey에 연결하는 `ib-kubernetes` 데몬은 `mellanox.infiniband.app` 어노테이션이 있는 파드의 GUID를 UFM 플러그인으로 등록합니다. IB SR-IOV CNI와 Multus를 함께 사용하며, 노드당 PKey는 커널 제약으로 최대 128개입니다. 설정은 `DAEMON_SM_PLUGIN: "ufm"`, `DAEMON_PERIODIC_UPDATE`, `GUID_POOL_RANGE_START`, `GUID_POOL_RANGE_END`입니다. Network Operator 26.x에는 `IBKubernetesSpec` CRD로 포함됩니다. NCCL에서는 `NCCL_IB_PKEY`로 인덱스, `NCCL_IB_PKEY_VALUE`로 값을 지정하며 값이 우선합니다.

NVL72에서는 `nv action create sdn partition`으로 만드는 NMX 사용자 파티션이 하드 분리를 맡고 ComputeDomain은 잡 단위 IMEX 분리를 맡습니다. 여러 테넌트가 Default Partition을 공유하면 IMEX·ComputeDomain에 의한 논리 분리가 적용됩니다. Mission Control 2.0 문서는 보안 요구가 강한 경우 NVLink 파티션을 권합니다.

이더넷 compute 패브릭을 테넌트별 VRF·VXLAN으로 나누는 NVIDIA 레퍼런스는 확인하지 못했습니다. 확인한 Spectrum-X Kubernetes 문서는 VF를 레일별 OVS 브리지에 연결하는 구성까지 설명합니다.

### 스토리지와 다른 잡의 트래픽 {#스토리지와-다른-잡의-트래픽}

SuperPOD 레퍼런스는 compute, storage, in-band, out-of-band 네트워크를 구분합니다. 스토리지 패브릭을 별도로 두어 노드 간 compute 통신과 분리합니다. B300판의 스토리지 선택지는 InfiniBand(MQM9700 NDR)와 RoCE(SN5610·SN5600)이며, 스토리지 장치 쪽은 1:1, DGX 쪽은 약 4:3으로 오버서브스크립션합니다.

네 가지를 구분한다고 해서 모두 별도 물리망이라는 뜻은 아닙니다. in-band와 OOB 이더넷은 하나의 물리망에서 VXLAN/EVPN으로 분리합니다. OOB에는 BMC, BlueField-3 BMC, 스위치 관리 포트, PDU와 InfiniBand 관리 트래픽이 들어갑니다. in-band는 Mission Control, BCM, Slurm, Kubernetes 서비스, NFS 계층을 담당합니다. Meta는 프론트엔드·백엔드를 물리적으로 나누며, Google Cloud의 A3 Ultra·A4는 GPU 전용 NIC 8개와 별도 gVNIC를 둡니다.

다른 잡의 all-reduce가 간섭하는 문제에는 레일 최적화와 토폴로지 인지 배치로 교차 트래픽을 줄이는 접근이 사용됩니다. Meta는 이를 "minimum cut" 배치라고 부릅니다. NVIDIA는 InfiniBand의 SL/VL·적응형 라우팅·혼잡 제어, Spectrum-X의 "노이즈 격리"를 기능으로 제시하지만 효과를 측정한 자료는 확보하지 못했습니다.

ComputeDomain의 동작은 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}}), RDMA 운영 제약은 [07편]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}}), 스토리지 패브릭은 [09편]({{< relref "/platform/kubernetes/gpu/09-storage-reality/index.md" >}})에서 더 살펴볼 수 있습니다.

## 3. NCCL에는 실제 토폴로지와 지원 조건을 전달한다 {#3-nccl-기본값과-가속-기능의-동작-조건}

GB200 튜닝 가이드는 피크 성능을 위해 NCCL(GPU 집합 통신 라이브러리) 환경 변수를 튜닝할 필요가 대개 없다고 설명합니다. 환경 변수 문서도 디버깅용 `NCCL_ALGO`·`NCCL_PROTO`를 프로덕션 코드에서 일반적으로 설정하지 말라고 안내합니다. 특히 지원하지 않는 플랫폼에 `NCCL_PROTO`로 LL128을 강제하면 데이터가 손상될 수 있습니다.

오래된 예시에서는 이름도 확인해야 합니다. `NCCL_MIN_NCHANNELS`·`NCCL_MAX_NCHANNELS`는 2.17에서 deprecated됐고 `NCCL_MIN_CTAS`·`NCCL_MAX_CTAS`로 대체됐습니다. 제공자가 우선 지정할 값은 이러한 성능 조정값보다 실제 배선과 인터페이스에 관한 값입니다.

### 토폴로지 파일, 인터페이스, 네트워크 플러그인 {#제공자가-전달할-토폴로지와-전송-경로}

`NCCL_TOPO_FILE`은 단일 호스트를 기술해야 합니다. 미설정 상태에서는 `/var/run/nvidia-topologyd/virtualTopology.xml`이 있으면 해당 파일을 사용합니다. 관련 변수는 `NCCL_TOPO_DUMP_FILE`, `NCCL_IB_HCA`, `NCCL_SOCKET_IFNAME`, `NCCL_CROSS_NIC`, `NCCL_NET_GDR_LEVEL`입니다. `NCCL_CROSS_NIC`의 기본값은 2이며, `NCCL_NET_GDR_LEVEL`에는 정수보다 LOC/PIX/PXB/PHB/SYS 문자열이 권장됩니다.

2.32u1부터 `NCCL_IB_GID_INDEX`·`NCCL_IB_TC`·`NCCL_IB_SL`은 기본 AUTO입니다. RoCE의 스위치 분류와 일치시키는 방법은 10편의 RoCE 절에서 다뤘습니다.

네트워크 플러그인은 `NCCL_NET_PLUGIN` 값, `libnccl-net-<suffix>.so`, `libnccl-net.so`, 내장 구현 순서로 찾습니다. 튜너 플러그인도 같은 탐색 규칙을 사용합니다. AWS EFA는 `aws-ofi-nccl` v1.21.1, Google Cloud A3 Mega는 GPUDirect-TCPXO, A3 Ultra 이후는 RoCE 기반 GPUDirect RDMA를 사용합니다. GB200 가이드 목차는 UCX를 "Communication Libraries (UCX)"라는 별도 절로 다룹니다. 이를 보면 UCX는 NCCL 집합 통신 경로와 별개인 MPI·NVSHMEM 쪽 라이브러리로 보이지만, 해당 절 본문은 확인하지 못했습니다.

장애 진단용 RAS는 `NCCL_RAS_ENABLE`이 기본 1이며 `NCCL_RAS_ADDR`는 localhost:28028입니다. 문서는 외부 인터페이스에 바인딩할 경우 보안 영향을 경고합니다. 2.31부터는 `NCCL_RUN_RAS_DIAGNOSTICS=1`·`NCCL_RUN_DIAGNOSTICS=1`도 제공합니다.

### SHARP와 NVLS의 조건 및 버전 변화 {#sharp와-nvls가-동작하는-조건}

SHARP는 InfiniBand 전용 인네트워크 리덕션이며 NCCL에서는 NCCL-SHARP 플러그인을 사용합니다. HPC-X에 포함된 플러그인이나 `Mellanox/nccl-rdma-sharp-plugins` 소스를 사용할 수 있습니다. 문서에 나온 요구 조건은 ConnectX-6 HDR 이상, Quantum HDR 스위치 이상, MLNX_OFED, GPUDirect RDMA, NCCL 2.7.3 이상입니다.

`NCCL_COLLNET_ENABLE=1`로 활성화하며 플러그인 2.1 이상에서는 기본값입니다. 초기화 때 자원을 확보하는 선택 설정은 `SHARP_COLL_LOCK_ON_COMM_INIT=1`, `SHARP_COLL_NUM_COLL_GROUP_RESOURCE_ALLOC_THRESHOLD=0`입니다. SHARP 2.6.1 문서는 스트리밍 집계를 NCCL 통신자 하나에서만 사용할 수 있고 스위치당 스트리밍 집계 플로는 최대 2개라고 설명합니다. Aggregation Manager·UFM 요건 원문과 조건이 명시된 효과 수치는 확보하지 못했습니다.

NCCL 알고리즘 이름은 CollnetChain과 CollnetDirect(2.14 이상)입니다. 2.30 이상에서 `NCCL_IGNORE_COLLNET_MISMATCH` 기본값은 0이므로 랭크마다 CollNet 디바이스 수가 다르면 초기화에 실패합니다.

NVLS(NVLink SHARP)의 `NCCL_NVLS_ENABLE`은 0이면 꺼지고, 1이면 켜지며 자원 할당 실패 때 초기화도 실패합니다. 기본값 2도 1과 같이 동작합니다. 2.27·2.28에서는 할당 실패 시 다른 전송으로 폴백했으나 일부 랭크만 실패하면 hang이 생길 수 있어 2.29에서 되돌렸습니다.

NVLS의 지원 조건으로 제시할 수 있는 근사치는 Hopper 이후 GPU, 3세대 이상 NVSwitch, CUDA 12.1 이상, 드라이버 530.30.02 이상입니다. 이는 NCCL의 명시적 요구 목록을 확인한 값이 아니라 NVSHMEM 설치 가이드에서 가져온 조건입니다.

NCCL 2.18.1은 NVLS·NVLSTree를 노드 간으로 확장했고, 2.31은 AllGather에 NVLink 멀티캐스트와 계층형 PAT 커널을 추가했습니다. 2.32는 여러 통신자의 NVLS 슬롯 소진을 완화하고 H100의 PAT+NVLS 성능 저하를 고쳤습니다. GB200 튜닝 가이드는 지원 시스템에서 NVLS가 기본으로 켜지고 all-reduce 비중이 큰 워크로드에 유리하다고 설명합니다. 메모리 사용이 걱정되면 끌 수 있으며, 켠 상태와 끈 상태를 모두 벤치마크하도록 권합니다. 효과를 수치로 비교한 공식 벤치마크는 찾지 못했습니다.

## 4. 하드웨어별 합격선을 만들고 실패 그룹을 좁힌다 {#4-인수-합격선은-자기-하드웨어의-측정에서-세운다}

NVIDIA가 공식으로 제시한 nccl-tests 기대 busbw나 perftest(`ib_write_bw`, 26.07.8) 기대값의 1차 출처는 확인하지 못했습니다. H100 8 GPU 단일 노드의 대용량 all-reduce에 대해 2차 가이드 한 곳은 약 450~480 GB/s, 다른 곳은 400~450 GB/s를 제시합니다. NVCRE도 기본 임계값을 제공하지 않습니다. 제공자는 자신의 하드웨어에서 먼저 측정해 합격선을 정해야 합니다.

### GPU 진단에서 노드 간 통신으로 범위를 넓힌다

DCGM의 `dcgmi diag -r 1`부터 `-r 4`까지는 네 단계 진단입니다. 2026-06-17 갱신 문서가 제시한 Hopper 8 GPU 기준 시간은 level 1이 2.5초 미만, 2가 10.5분 미만, 3이 35분 미만, 4가 2.25시간 미만입니다. level 3부터 Targeted Stress·Targeted Power·NVBandwidth가 포함되고 `DCGM_NCCL_TESTS_BIN_PATH`를 설정하면 NCCL Tests 플러그인도 실행합니다. level 4에는 Memtest·Pulse가 추가됩니다.

통신 성능은 nccl-tests의 busbw로 읽습니다. AllReduce의 식은 busbw = algbw × 2(n−1)/n이며, 문서는 이 값이 NVLink·PCI·QPI·네트워크 등 하드웨어 병목의 속도를 반영해야 한다고 설명합니다. perftest의 기대치는 라인 레이트에 가까운지 살피는 정도로 잡을 수 있지만 공식 합격선으로 확인한 것은 아닙니다.

2차 가이드는 `ibstat`의 Active 상태를 확인한 뒤 단일 노드에서 시작해 노드 수를 늘리도록 안내합니다. 특정 규모에서 busbw가 떨어지면 그 범위의 링크·스위치를 의심할 수 있습니다. GB200 튜닝 가이드의 Slurm 예시는 `MPI=1`로 빌드하고 GPU 하나에 프로세스 하나를 배정한 뒤, 노드 수를 절반씩 줄여 반복합니다.

```bash
export NCCL_DEBUG=WARN
TEST_ARGS="-dfloat -b8 -e32G -f2"
srun --ntasks-per-node ${GPUS_PER_NODE} --cpu-bind=none --mpi=pmix \
  all_reduce_perf ${TEST_ARGS}
# reduce_scatter_perf, all_gather_perf, alltoall_perf도 같은 방식으로 실행
```

### NVCRE의 검증 결과와 격리 동작

NVIDIA Cluster Readiness Engine은 2026-09-23에 공개된 오픈소스 Kubernetes 컨트롤러이며 조사 버전은 v0.8.1(2026-10-20)입니다. NCCL 5종(all-reduce, all-gather, all-to-all, loopback, NVSwitch 경유 loopback), DCGM level-4, NeMo 사전학습을 실행합니다. DCGM 진단에는 단독 DCGM 서비스가 필요합니다.

NVIDIA 블로그의 GB200 NVL72급 예시 임계값은 `busBandwidthGBps: "value >= 900"`, `goodputRatio >= 0.9`, `avgTFLOPsPerGPU >= 800`입니다. 샘플 리포트는 16노드 GB300 NVL72의 all-reduce busbw 932.09 GB/s, 3분 56초, PASSED를 보여 줍니다. 이 예시를 다른 클러스터의 합격 기준으로 사용해서는 안 됩니다.

랙 안 테스트는 `nvidia.com/gpu.clique`로 노드를 나눕니다. `testScale: diagnose`는 실패 그룹을 절반씩 나눠 `minGroupSize`에 이를 때까지 재실행하며, 목표에 못 미치면 `ValidationFailed` 조건을 기록합니다.

{{< flow src="_flow/4-nvcre-이분-탐색.json" />}}

NVCRE는 노드를 cordon·taint하거나 노드 조건을 패치하지 않습니다. NVSentinel의 NVCRE Certification Monitor가 실패 결과를 health event로 변환하고 이후 격리·drain으로 연결합니다. 따라서 검증을 먼저 실행해 결과를 확인한 다음 자동 격리를 연결할 수 있습니다. NVCRE API는 `nvcre.nvidia.com/v1alpha1`의 `Certification`, `Workflow`, `Job`, `WorkloadRun`이며 CLI는 `nvcrectl`입니다.

## 5. 필요한 카운터를 켜고 자동 조치는 단계별로 연결한다 {#5-관측할-카운터와-자동-조치-범위의-분리}

인수 검증을 통과한 뒤에도 링크 오류와 GPU 상태를 계속 관측해야 합니다. dcgm-exporter 4.8.4는 DCGM 4.6.1 기반이지만, 기본 CSV의 NVLink 에러 카운터 계열은 주석 처리돼 있습니다. GPU 세대에 맞는 카운터를 선택하지 않으면 NVLink 열화가 기본 대시보드에 드러나지 않을 수 있다는 판단이 나옵니다.

아래 필드 ID는 `dcgm_fields.h`(master), 기본 수집 여부는 dcgm-exporter `default-counters.csv`에서 확인한 내용입니다. Hopper 이전은 409~439번대, Hopper는 497~499, Blackwell 이후는 1211~1213을 사용합니다.

| 필드 | ID | exporter 기본 | 비고 |
|---|---|---|---|
| `DCGM_FI_DEV_XID_ERRORS` | 230 | 켜짐 | 마지막 XID 값 |
| `DCGM_FI_DEV_PCIE_REPLAY_COUNTER` | 202 | 켜짐 | PCIe 재시도 |
| `DCGM_FI_DEV_NVLINK_BANDWIDTH_TOTAL` | — | 켜짐 | MB/s |
| `DCGM_FI_DEV_UNCORRECTABLE_REMAPPED_ROWS` | 393 | 켜짐 | 395는 행 재매핑 실패 |
| `DCGM_FI_DEV_FABRIC_MANAGER_STATUS` | 170 | 꺼짐 | 171은 오류 코드 |
| `DCGM_FI_DEV_FABRIC_CLUSTER_UUID` / `CLIQUE_ID` | 172 / 173 | 꺼짐 | `nvidia.com/gpu.clique`의 원천 |
| `DCGM_FI_DEV_FABRIC_HEALTH_MASK` / `SUMMARY` | 174 / 175 | 주석 처리 | |
| `DCGM_FI_DEV_NVLINK_CRC_ERROR_TOTAL` 등 | 497 / 498 / 499 | 주석 처리 | Hopper data-link 카운터 |
| `DCGM_FI_DEV_NVLINK_CRC_FLIT_ERROR_COUNT_TOTAL` 등 | 409 / 419 / 429 / 439 | 주석 처리 | Hopper 이전 |
| `DCGM_FI_DEV_NVLINK_RECOVERY_*_TOTAL` | 1211 / 1212 / 1213 | 주석 처리 | Blackwell 이후 |
| `DCGM_FI_PROF_NVLINK_TX_BYTES` / `RX_BYTES` | 1011 / 1012 | 꺼짐 | |

exporter 자체 메트릭 `DCGM_EXP_XID_ERRORS_COUNT`, `DCGM_EXP_XID_ERRORS_TOTAL`, `DCGM_EXP_GPU_HEALTH_STATUS`와 피어 링크별 P2P 상태를 보여 주는 `DCGM_EXP_P2P_STATUS`도 기본 CSV에서 주석 처리돼 있습니다. 필드 이름은 `_ERRORS`에서 `_ERROR`, `_COUNTER`에서 `_TOTAL`로 정리되는 중이며 옛 이름은 헤더의 별칭으로 남습니다. 수집 설정과 대시보드·알림 규칙의 필드 이름을 함께 맞춰야 합니다.

NVL72는 10편의 NMX-M 헬스 메트릭으로 패브릭 상태를 보완하고, Spectrum-X는 NetQ, InfiniBand는 UFM으로 패브릭을 관측합니다. 이 관측 경로와 NVSentinel의 입력 경로는 다릅니다. NVSentinel은 dcgm-exporter를 거치지 않고 DCGM을 직접 조회하며 syslog(journalctl), 클라우드 사업자 유지보수 이벤트, NIC 헬스, Health Events Analyzer, Kubernetes Object Monitor도 입력으로 사용합니다.

NVSentinel v1.28.0은 기본 설치에서 모니터링만 수행합니다. 자동 조치를 하려면 `global.faultQuarantine.enabled`, `global.nodeDrainer.enabled`, `global.faultRemediation.enabled`를 각각 켭니다. 장애를 노드 조건으로 보고한 뒤 cordon·taint, drain, GPU 리셋·재부팅 순으로 처리합니다. 5분 창 안에 cordon된 노드가 클러스터의 50%에 이르면 격리 처리를 멈추는 회로 차단기도 있습니다.

설치에는 Kubernetes 1.34 이상, Helm 3 이상, GPU Operator의 `dcgm.enabled=true`, cert-manager 1.21 이상, 영속 스토리지 MongoDB가 필요합니다. node-problem-detector와의 연동은 1차 자료를 확보하지 못했습니다.

## 6. 제공할 구성과 버전 조합을 마지막으로 대조한다 {#1-패브릭-설정이-끝나도-남는-인수-조건}

배선·테넌트 경계·NCCL·검증·관측은 서로 의존합니다. 아래 표는 SuperPOD 레퍼런스와 관련 문서를 종합한 인수 체크리스트이며 합의된 표준은 아닙니다. 문서의 요구 조건과 이 글의 운영상 판단을 함께 담았습니다.

| 영역 | 갖출 것 | 근거 |
|---|---|---|
| 네트워크 분리 | compute, storage, in-band, OOB 네 개 | SuperPOD 레퍼런스, Meta, Google Cloud |
| compute 패브릭 | rail-optimized, non-blocking을 SU 단위로 설계 | SuperPOD 레퍼런스, Google Cloud의 rail-aligned 표기 |
| 노드 안 소프트웨어 | FM(Blackwell은 NVLSM), NVL72는 IMEX와 NMX의 버전 정합 | 10편 1·3·4절 |
| 토폴로지 노출 | `nvidia.com/gpu.clique`, topograph의 `fabric.topograph.run/tier-N`과 `accelerator.topograph.run/domain` | GPU Operator, topograph |
| 테넌트 분리 | SR-IOV + exclusive 모드 RDMA CNI, IB는 PKey, NVL72는 NVLink 파티션이나 ComputeDomain | 2절 |
| RoCE 정합 | PFC, ECN, DSCP 매핑을 스위치, NIC, NCCL까지 일치. DCQCN을 끄는 선택지도 있음 | 10편 6절, Meta |
| 인수 검증 | DCGM diag r3~r4, 노드 안에서 노드 간으로 넓히는 nccl-tests, NVCRE의 이분 탐색 | 4절 |
| 관측과 격리 | NVLink 카운터를 세대에 맞춰 켜기, XID·PCIe replay·row remap 수집, NVSentinel은 단계별 opt-in | 5절 |
| NCCL | 기본값 우선. 구성에 맞춰 지정할 값은 토폴로지 파일, HCA 필터, TC·PKey 정도 | 3절 |
| 버전 조합 | RDMA 패브릭을 쓰면 Kubernetes 버전을 Network Operator 지원 범위에 맞추기 | Cloud Native Stack |

SuperPOD는 노드를 아직 덜 채웠더라도 SU 전체를 기준으로 패브릭을 구축하도록 설명하며 Google Cloud도 rail-aligned 구성을 표기합니다. 처음 측정한 합격선을 이후 증설 구성에 적용하려면 이 설계 범위까지 함께 봐야 합니다. NCCL에서 토폴로지 파일·HCA 필터·TC·PKey를 우선 지정한다는 내용도 환경 변수 문서를 종합한 판단입니다.

버전 조합은 발표 시점을 붙여 확인해야 합니다. Cloud Native Stack(CNS) 19.0, Batch 26.6.0(2026-07-01 GA)은 Kubernetes 1.36.2, GPU Operator 26.3.2, 드라이버 580.126.20, KAI Scheduler 0.14.2를 검증했습니다. [CNS README](https://github.com/NVIDIA/cloud-native-stack)의 당시 구성에는 Network Operator가 빠져 있습니다. Network Operator 26.4.0의 Kubernetes 지원 범위가 1.31~1.35였기 때문입니다.

이를 현재 Network Operator가 Kubernetes 1.36을 지원하지 않는다는 뜻으로 읽으면 안 됩니다. [26.7 플랫폼 지원표](https://docs.nvidia.com/networking/display/kubernetes2670/platform-support.html)는 1.32~1.36을 지원합니다. RDMA 패브릭을 제공할 때는 선택한 Network Operator 버전에 Kubernetes를 맞춰야 한다는 결론이며, 현행 조합은 07편의 지원 범위와 함께 대조하면 됩니다.

## 7. 확인하지 못한 것

- NVIDIA가 공식으로 낸 nccl-tests 기대 busbw(H100, B200, B300의 노드 안과 노드 간). NVCRE도 기본 임계값을 싣지 않습니다
- perftest(`ib_write_bw`)의 기대값 1차 출처
- SHARP의 활성 요건 원문과 효과의 조건부 수치. SHARP 3.x 문서 페이지는 열리지 않았습니다
- NVLS 효과를 보여 주는 공식 수치
- node-problem-detector와 DCGM·XID를 묶은 공개 운영 사례. NVSentinel이 노드 조건을 직접 보고하므로 별도 연동이 필요한지도 확인하지 못했습니다
- 이더넷 compute 패브릭을 테넌트별 VRF로 나누는 NVIDIA 레퍼런스
- topograph의 옛 라벨 키가 언제 바뀌었는지
- UCX 절의 본문. 목차만 확인했습니다
- Spectrum-X 노이즈 격리의 효과를 잰 자료

## 참고 자료

- [NCCL 2.12 rail-optimized·PXN 블로그](https://developer.nvidia.com/blog/doubling-all2all-performance-with-nvidia-collective-communication-library-2-12/)
- [SuperPOD B300 XDR Network Fabrics](https://docs.nvidia.com/dgx-superpod/reference-architecture/scalable-infrastructure-b300-xdr/latest/network-fabrics.html)
- [SuperPOD B300 Spectrum-4 Network Fabrics](https://docs.nvidia.com/dgx-superpod/reference-architecture/scalable-infrastructure-b300/latest/network-fabrics.html)
- [SuperPOD H100 Network Fabrics](https://docs.nvidia.com/dgx-superpod/reference-architecture-scalable-infrastructure-h100/latest/network-fabrics.html)
- [SuperPOD H100 Components](https://docs.nvidia.com/dgx-superpod/reference-architecture-scalable-infrastructure-h100/latest/dgx-superpod-components.html)
- [Quantum-X800 스위치 매뉴얼](https://docs.nvidia.com/networking/display/XDRSwitchesUM/Introduction)
- [topograph](https://github.com/NVIDIA/topograph)
- [NCCL 환경 변수(2.32.3)](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/env.html)
- [NCCL 2.18.1 릴리스 노트](https://docs.nvidia.com/deeplearning/nccl/archives/nccl_2265/release-notes/rel_2-18-1.html)
- [NCCL 릴리스](https://github.com/NVIDIA/nccl/releases)
- [SHARP + NCCL(v3.0.0)](https://docs.nvidia.com/networking/display/sharpv300/using+nvidia+sharp+with+nvidia+nccl)
- [SHARP + NCCL(v2.6.1)](https://docs.nvidia.com/networking/display/SHARPv261/Using+NVIDIA+SHARP+with+NVIDIA+NCCL)
- [Mellanox/nccl-rdma-sharp-plugins](https://github.com/Mellanox/nccl-rdma-sharp-plugins)
- [NVSHMEM 설치 가이드](https://docs.nvidia.com/nvshmem/release-notes-install-guide/install-guide/abstract.html)
- [GB200 Multi-Node Tuning Guide(NCCL)](https://docs.nvidia.com/multi-node-nvlink-systems/multi-node-tuning-guide/nccl.html)
- [aws-ofi-nccl](https://github.com/aws/aws-ofi-nccl)
- [DCGM 진단](https://docs.nvidia.com/datacenter/dcgm/latest/user-guide/dcgm-diagnostics.html)
- [nccl-tests PERFORMANCE.md](https://github.com/NVIDIA/nccl-tests/blob/master/doc/PERFORMANCE.md)
- [Cluster Readiness Engine NCCL 벤치마크](https://docs.nvidia.com/cluster-readiness-engine/how-to-guides/run-nccl-benchmarks)
- [Cluster Readiness Engine 블로그](https://developer.nvidia.com/blog/validate-gpu-cluster-readiness-before-ai-workloads-land/)
- [cluster-readiness-engine](https://github.com/NVIDIA/cluster-readiness-engine)
- [dcgm-exporter 기본 카운터](https://raw.githubusercontent.com/NVIDIA/dcgm-exporter/main/etc/default-counters.csv)
- [DCGM dcgm_fields.h](https://raw.githubusercontent.com/NVIDIA/DCGM/master/dcgmlib/dcgm_fields.h)
- [NVSentinel](https://github.com/NVIDIA/NVSentinel)
- [UFM REST API PKey 6.26.1](https://networking-docs.nvidia.com/ufmenterpriserestapi/6.26.1/pkey-guids-rest-api)
- [UFM REST API PKey 6.25.1](https://networking-docs.nvidia.com/ufmenterpriserestapi/6251/pkey-guids-rest-api)
- [ib-kubernetes](https://github.com/Mellanox/ib-kubernetes)
- [rdma-cni](https://github.com/k8snetworkplumbingwg/rdma-cni)
- [k8s-rdma-shared-dev-plugin](https://github.com/Mellanox/k8s-rdma-shared-dev-plugin)
- [Network Operator 26.7 Spectrum-X](https://docs.nvidia.com/networking/display/kubernetes2670/spectrum-x/spectrum-x.html)
- [Mission Control 2.0 High-Speed Fabric Management](https://docs.nvidia.com/mission-control/docs/systems-administration-guide/2.0.0/high-speed-fabric-management.html)
- [k8s-dra-driver-gpu](https://github.com/NVIDIA/k8s-dra-driver-gpu)
- [Cloud Native Stack](https://github.com/NVIDIA/cloud-native-stack)
- [Meta RoCE 블로그](https://engineering.fb.com/2024/08/05/data-center-engineering/roce-network-distributed-ai-training-at-scale/)
- [Google Cloud GPU 네트워크 대역](https://docs.cloud.google.com/compute/docs/gpus/gpu-network-bandwidth)
- [nccl-tests 기대값(2차)](https://saturncloud.io/blog/crusoe-nccl-cluster-validation/)

- [Linux v6.18 — RDMA 네트워크 네임스페이스 모드 변경](https://github.com/torvalds/linux/blob/v6.18/drivers/infiniband/core/device.c#L1120-L1149)
