---
title: "11 GPU 클러스터를 사용자에게 내주기 위한 조건"
description: "GPU 클러스터를 사용자에게 내주려면 무엇을 준비해야 하는지 2026-10-21 기준으로 정리한다. 패브릭과 테넌트 경계를 설정하고 하드웨어별 측정으로 합격선을 세운 뒤, 관측과 격리를 연결한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 11
url: "/kubernetes/gpu/11-provider-validation-tenancy/"
---

# 11 · GPU 클러스터를 사용자에게 내주기 위한 조건

## 1. 패브릭 설정이 끝나도 남는 인수 조건

GPU 클러스터를 사용자에게 내주려면 패브릭 설정에 더해 인수 검증, 테넌트 분리, 관측과 격리 조건을 정해야 합니다. [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})은 노드 안의 Fabric Manager와 NVL72의 IMEX, 그리고 InfiniBand와 RoCE의 선택과 설정을 다뤘습니다. 그 설정을 마친 제공자가 확인할 항목을 아래에 모았습니다.

이 표는 SuperPOD 레퍼런스와 관련 문서에서 반복되는 요구 사항을 겹쳐 만든 체크리스트입니다. 문서에 명시된 조건과 그 조건에서 이끌어 낸 판단을 함께 담았으며, 합의된 표준은 아닙니다.

| 영역 | 갖출 것 | 근거 |
|---|---|---|
| 네트워크 분리 | compute, storage, in-band, OOB 네 개 | SuperPOD 레퍼런스, Meta, Google Cloud |
| compute 패브릭 | rail-optimized, non-blocking을 SU 단위로 설계 | SuperPOD 레퍼런스, Google Cloud의 rail-aligned 표기 |
| 노드 안 소프트웨어 | FM(Blackwell은 NVLSM), NVL72는 IMEX와 NMX의 버전 정합 | 10편 2~4절 |
| 토폴로지 노출 | `nvidia.com/gpu.clique`, topograph의 `fabric.topograph.run/tier-N`과 `accelerator.topograph.run/domain` | GPU Operator, topograph |
| 테넌트 분리 | SR-IOV + exclusive 모드 RDMA CNI, IB는 PKey, NVL72는 NVLink 파티션이나 ComputeDomain | 6절 |
| RoCE 정합 | PFC, ECN, DSCP 매핑을 스위치, NIC, NCCL까지 일치. DCQCN을 끄는 선택지도 있음 | 10편 6절, Meta |
| 인수 검증 | DCGM diag r3~r4, 노드 안에서 노드 간으로 넓히는 nccl-tests, NVCRE의 이분 탐색 | 4절 |
| 관측과 격리 | NVLink 카운터를 세대에 맞춰 켜기, XID·PCIe replay·row remap 수집, NVSentinel은 단계별 opt-in | 5절 |
| NCCL | 기본값 우선. 박을 값은 토폴로지 파일, HCA 필터, TC·PKey 정도 | 3절 |
| 버전 조합 | RDMA 패브릭을 쓰면 Kubernetes 버전을 Network Operator 지원 범위에 맞추기 | Cloud Native Stack |

Cloud Native Stack 19.0은 Kubernetes 1.36.2, GPU Operator 26.3.2, 드라이버 580.126.20 조합을 검증했지만, Network Operator는 Kubernetes 1.36을 지원하지 않아 구성에서 빠졌습니다. RDMA 패브릭을 쓰는 제공자는 Kubernetes 버전을 Network Operator가 지원하는 범위에 맞춰야 할 것으로 보입니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-21이며 NCCL 2.32.3, DCGM 4.6.1, dcgm-exporter 4.8.4, NVIDIA Cluster Readiness Engine v0.8.1, NVSentinel v1.28.0, topograph v1.0.0 문서와 SuperPOD 레퍼런스 아키텍처를 봤습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 조사 범위 | NCCL 2.32.3, nccl-tests v2.21.1, DCGM 4.6.1, dcgm-exporter 4.8.4, GPU Operator 26.7.2, NVCRE v0.8.1, NVSentinel v1.28.0, topograph v1.0.0, perftest 26.07.8 | 각 프로젝트 릴리스 | `✓` |
| Cloud Native Stack | CNS 19.0은 K8s 1.36.2, GPU Operator 26.3.2, 드라이버 580.126.20을 검증. Network Operator는 K8s 1.36 미지원이라 빠짐 | Cloud Native Stack README | `✓` |
| 네 개 분리 | 모든 SuperPOD 레퍼런스가 네 개로 분리. Meta의 프론트엔드/백엔드 분리, GCP의 GPU 전용 NIC | SuperPOD 레퍼런스, Meta, Google Cloud | `✓` |
| SU 단위 설계 | 노드를 덜 채워도 SU 전체 기준으로 패브릭을 깔라는 문구. GCP는 rail-aligned 표기 | SuperPOD 레퍼런스, Google Cloud 문서 | `✓` |
| 체크리스트 구성 | 위 자료를 겹쳐 본 정리 | — | `Σ` |
| NCCL에서 박을 값 | 토폴로지 파일, HCA 필터, TC·PKey 정도 | NCCL 환경 변수 문서를 종합 | `≈` |
| Cloud Native Stack | CNS 19.0(Batch 26.6.0, 2026-07-01 GA): K8s 1.36.2, GPU Operator 26.3.2, 드라이버 580.126.20, KAI Scheduler 0.14.2. Network Operator는 K8s 1.36 미지원 | Cloud Native Stack README | `✓` |
| Kubernetes 버전 정렬 | 위 사실에서 이끌어 낸 결론 | — | `≈` |

{{% /details %}}

## 2. 배선 규칙과 Kubernetes로 내려오는 토폴로지 정보

NVIDIA의 NCCL 2.12 블로그는 각 DGX의 NIC-0을 같은 리프에, NIC-1을 다른 리프에 연결하는 배선을 rail-optimized(레일 최적화)라고 부릅니다. NCCL의 PXN은 노드 안 NVSwitch로 데이터를 목적지와 같은 레일의 GPU에 먼저 옮긴 뒤, 레일을 넘지 않고 내보냅니다. SHARP(인네트워크 리덕션) 문서도 같은 배선 조건을 요구합니다. NCCL이 HCA 레일마다 집계 플로를 만들기 때문에 같은 레일의 HCA가 같은 리프에 연결돼야 합니다.

다음 도식은 SU(Scalable Unit) 하나 안의 레일 배선을 보여 줍니다.

{{< flow src="_flow/2-rail-optimized-배선.json" />}}

배선 규칙이 같아도 SU의 크기와 스위치 수는 레퍼런스마다 다릅니다. DGX H100 SuperPOD는 SU당 32노드이며, UFM 연결 때문에 한 SU는 31노드입니다. 노드당 8 GPU, SU당 리프 8대가 들어가고, 스파인은 1·2·3·4 SU에서 각각 4·8·16·16대입니다. 4 SU를 구성하면 127노드, 1,016 GPU에 리프 32대와 스파인 16대가 필요합니다.

H100 레퍼런스는 SU 안에서 같은 레일이 다른 31노드와 1홉으로 연결되고, 노드와 레일을 넘는 트래픽은 스파인을 지난다고 설명합니다. 레일 최적화는 최상위 계층까지 이어지며, 전체 토폴로지는 균형 잡힌 full fat-tree입니다. B300 레퍼런스에서는 패브릭에 따라 규모와 연결 방식이 달라집니다.

| 레퍼런스 | rail-aligned 단위 | 전체 규모 | 특징 |
|---|---|---|---|
| B300 + Quantum-X800 XDR(2026-09-02 갱신) | 72노드 | 576노드(8 × 72) | SU 간·레일 간 트래픽은 스파인 경유. UFM 3.5 노드가 Q3400의 FNM 포트 4개에 연결 |
| B300 + Spectrum-4(2025-11-19 갱신) | 64노드 | 512노드 | GPU당 2 × 400GbE를 두 plane으로 나눈 twin-planar. plane마다 2단 spine-leaf이고 코어로 묶지 않음 |

Spectrum-4판은 스위치, 트랜시버, 케이블 하나가 고장 나도 잡이 중단되지 않고 약 절반의 대역폭으로 계속 실행된다고 설명합니다. NVIDIA 스위치 매뉴얼은 포트 144개인 Q3400으로 2단 fat-tree에서 최대 10,368 NIC을 연결할 수 있다고 설명합니다. 144포트 리프의 절반인 72포트를 아래로 쓰고 리프를 144대 둔다고 계산하면 같은 수가 나옵니다. 문서는 “1홉”과 “스파인 경유”까지만 설명하며, 리프-스파인-리프가 3홉이고 3단에서 코어를 거치면 5홉이라는 일반식은 추정입니다.

이 배선 정보가 Kubernetes에 전달되는 지점은 노드 라벨입니다. topograph v1.0.0은 스위치 계층에 `fabric.topograph.run/tier-N`을 씁니다. 0이 노드에 가장 가까운 스위치이고 깊이 제한은 없습니다. NVLink 도메인은 `accelerator.topograph.run/domain`, 그 하위 구분은 `accelerator.topograph.run/sub-domain`으로 나타냅니다. 문서의 예는 `tier-0: s1`, `tier-1: s2`, `tier-2: s3`, `domain: nvl1`, `sub-domain: nvl1.rack01`입니다.

topograph가 토폴로지를 읽는 소스는 AWS, GCP, OCI, Nebius, Nscale, Crusoe, Lambda의 API, NetQ, InfiniBand의 `ibnetdiscover`, DRA입니다. 출력 엔진은 slurm, k8s(라벨), nfd, slinky입니다. 옛 topograph의 `network.topology.nvidia.com/*` 키는 현행 문서에 나오지 않으므로 오래된 블로그의 키를 그대로 옮기지 않도록 주의해야 합니다.

NVLink 파티션 ID는 `ClusterUUID.CliqueId` 형식이며 GPU Operator의 `nvidia.com/gpu.clique` 라벨과 같습니다. MNNVL 환경에서 Fabric Manager(FM)가 아직 작업을 마치지 않았다면 이 라벨은 생성되지 않습니다. 10편에서 다룬 Fabric State `In Progress`가 라벨 부재로 드러나는 경우입니다.

레일은 노드 전체보다 NIC 단위에서 정의합니다. Network Operator의 Spectrum-X는 `SpectrumXRailPoolConfig`의 `railTopology[].nicSelector.pfNames`로 레일을 지정하고, RDMA 디바이스 이름을 `rdma_<rail topology name>`으로 만듭니다. NCCL의 `NCCL_IB_HCA`도 `<hca>[:<port>[:<rail>[:<plane>]]]` 형식을 받습니다. 운영자가 노드 라벨에 남길 범위는 블록, 리프, 스파인, NVLink 도메인까지이고, 레일은 NIC 이름과 설정으로 다루는 편이 맞아 보입니다.

토폴로지 자체를 읽는 방법은 [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}}), 토폴로지 정보를 라벨로 받아 스케줄러가 쓰는 방식은 [04편]({{< relref "/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md" >}})에 있습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| rail-optimized와 PXN | NIC-0은 같은 리프, NIC-1은 다른 리프. PXN은 NVSwitch로 같은 레일 GPU에 먼저 전달 | NCCL 2.12 블로그 | `✓` |
| SHARP의 토폴로지 요구 | NCCL이 HCA 레일마다 집계 플로를 만들므로 같은 레일은 같은 리프 | SHARP 문서 | `✓` |
| H100 SuperPOD | SU당 32노드(UFM 때문에 31), 리프 8대, 스파인 4/8/16/16대(1~4 SU), 4 SU 127노드 1,016 GPU에 리프 32·스파인 16 | SuperPOD H100 레퍼런스 | `✓` |
| 1홉과 스파인 경유 | 같은 레일 1홉, 노드·레일 간은 스파인 경유, 균형 full fat-tree | SuperPOD H100 레퍼런스 | `✓` |
| B300 XDR / Spectrum-4 | 위 표의 단위와 규모 | SuperPOD B300 레퍼런스 두 판 | `✓` |
| 2단 fat-tree 규모 | Q3400(144 × 800G)로 최대 10,368 NIC. 데이터시트는 "10,000개 이상" | Quantum-X800 스위치 매뉴얼 | `Ⓥ` |
| 10,368의 계산 | 144포트의 절반 72 × 리프 144대 | 위 수치로 계산 | `≈` |
| 홉 수 일반식 | 3홉, 3단이면 5홉 | 위 자료를 종합 | `≈` |
| topograph 라벨 | `fabric.topograph.run/tier-N`, `accelerator.topograph.run/domain`, `.../sub-domain`. 소스·엔진 목록 | topograph 문서 | `✓` |
| 옛 키 | `network.topology.nvidia.com/*`가 현행 문서에 없음. 개명 시점은 미확인 | topograph 문서 | `≈` |
| clique 라벨 | `ClusterUUID.CliqueId`, `nvidia.com/gpu.clique`와 동일. FM 미완료면 라벨 없음 | topograph 문서, GPU Operator | `✓` |
| 증상 인지 | `system not yet initialized`, Fabric State `In Progress`. 620부터 FM 분리 배포 | GPU Operator 트러블슈팅, FM 사용자 가이드 | `✓` |
| 레일 정의 | `SpectrumXRailPoolConfig`의 `railTopology[].nicSelector.pfNames`, 디바이스 이름 `rdma_<rail topology name>`, `NCCL_IB_HCA` 형식 | Network Operator 26.7, NCCL 환경 변수 문서 | `✓` |
| 레일은 라벨이 아니라 NIC 속성 | 위 사실에서 이끌어 낸 정리 | — | `≈` |

{{% /details %}}

## 3. NCCL 기본값과 가속 기능의 동작 조건

NCCL(GPU 집합 통신 라이브러리)을 설치한 뒤 환경 변수부터 조정할 필요는 대개 없습니다. GB200 튜닝 가이드는 피크 성능을 위해 NCCL 환경 변수를 튜닝할 필요가 대개 없다고 명시합니다. NCCL 환경 변수 문서도 디버깅 섹션의 `NCCL_ALGO`와 `NCCL_PROTO`를 일반적으로 프로덕션 코드에서 설정하지 말라고 안내합니다. 특히 `NCCL_PROTO`로 LL128을 지원하지 않는 플랫폼에 강제하면 데이터가 손상될 수 있습니다.

설정 이름도 버전에 맞춰 읽어야 합니다. `NCCL_MIN_NCHANNELS`와 `NCCL_MAX_NCHANNELS`는 2.17에서 deprecated되어 `NCCL_MIN_CTAS`, `NCCL_MAX_CTAS`로 바뀌었습니다.

### 제공자가 전달할 토폴로지와 전송 경로

제공자가 실제 구성에 맞춰 지정하는 값은 토폴로지와 인터페이스 쪽입니다. `NCCL_TOPO_FILE`은 단일 호스트를 기술해야 하며, 이 변수를 설정하지 않으면 `/var/run/nvidia-topologyd/virtualTopology.xml`이 있을 때 해당 파일을 사용합니다. 관련 변수로 `NCCL_TOPO_DUMP_FILE`, `NCCL_IB_HCA`, `NCCL_SOCKET_IFNAME`, `NCCL_CROSS_NIC`, `NCCL_NET_GDR_LEVEL`이 있습니다. `NCCL_CROSS_NIC`의 기본값은 2이고, `NCCL_NET_GDR_LEVEL`은 정수보다 LOC/PIX/PXB/PHB/SYS 문자열을 쓰도록 문서가 권장합니다.

2.32u1부터는 `NCCL_IB_GID_INDEX`, `NCCL_IB_TC`, `NCCL_IB_SL`의 기본값이 AUTO가 됐습니다. 이 변화가 RoCE 설정에 미치는 영향은 10편의 RoCE 절에서 다뤘습니다.

네트워크 플러그인은 `NCCL_NET_PLUGIN` 값, `libnccl-net-<suffix>.so`, `libnccl-net.so`, 내장 구현 순서로 찾으며 튜너 플러그인도 같은 규칙을 따릅니다. AWS는 EFA용 `aws-ofi-nccl`(v1.21.1)을 쓰고, Google Cloud의 A3 Mega는 GPUDirect-TCPXO, A3 Ultra 이후는 RoCE 기반 GPUDirect RDMA를 사용합니다. GB200 튜닝 가이드 목차는 UCX를 "Communication Libraries (UCX)"라는 별도 절로 다룹니다. UCX는 NCCL 집합 통신 경로와 별개인 MPI와 NVSHMEM 쪽 라이브러리로 보입니다.

장애 진단용 RAS는 `NCCL_RAS_ENABLE`이 기본으로 켜져 있고, `NCCL_RAS_ADDR`의 기본값은 localhost:28028입니다. NCCL 문서는 이를 외부 인터페이스에 바인딩하면 보안 영향이 생긴다고 경고합니다. 2.31에서는 `NCCL_RUN_RAS_DIAGNOSTICS=1`과 `NCCL_RUN_DIAGNOSTICS=1`이 추가됐습니다.

### SHARP와 NVLS가 동작하는 조건

SHARP는 InfiniBand 전용 인네트워크 리덕션입니다. NCCL에서는 HPC-X에 포함되거나 `Mellanox/nccl-rdma-sharp-plugins` 소스로 받는 NCCL-SHARP 플러그인을 사용합니다. 요구 조건은 ConnectX-6 HDR 이상, Quantum HDR 스위치 이상, MLNX_OFED, GPUDirect RDMA, NCCL 2.7.3 이상입니다.

활성화에는 `NCCL_COLLNET_ENABLE=1`을 쓰며, 플러그인 2.1 이상에서는 이 값이 기본입니다. 초기화 때 자원을 확보하는 선택값으로 `SHARP_COLL_LOCK_ON_COMM_INIT=1`과 `SHARP_COLL_NUM_COLL_GROUP_RESOURCE_ALLOC_THRESHOLD=0`도 있습니다. 스트리밍 집계는 NCCL 통신자 하나에서만 가능하고, 스위치당 스트리밍 집계 플로는 최대 2개입니다.

`NCCL_ALGO`에서 이 경로에 해당하는 알고리즘은 CollnetChain과 CollnetDirect(2.14 이상)입니다. 2.30 이상에 있는 `NCCL_IGNORE_COLLNET_MISMATCH`의 기본값은 0이므로 랭크마다 CollNet 디바이스 수가 다르면 초기화에 실패합니다.

NVLS(NVLink SHARP)는 `NCCL_NVLS_ENABLE`로 제어합니다. 0은 끔, 1은 켬이며 1에서는 할당 실패 시 초기화도 실패합니다. 기본값인 2는 1과 같게 동작합니다. 2.27과 2.28에서는 할당 실패 시 조용히 다른 전송으로 넘어갔는데, 일부 랭크만 실패하면 hang이 날 수 있어 2.29에서 이 동작을 되돌렸습니다.

NVLS의 지원 조건은 3세대 NVSwitch 이상을 쓰는 Hopper 이후 GPU, CUDA 12.1 이상, 드라이버 530.30.02 이상으로 보입니다. 이 조건은 NCCL 자체의 명시적인 요구 목록이 아니라 NVSHMEM 설치 문서에서 가져온 근사치입니다.

알고리즘과 자원 사용 방식도 바뀌어 왔습니다. NCCL 2.18.1은 NVLS와 NVLSTree 알고리즘을 노드 간으로 확장했고, 2.31은 AllGather에 NVLink 멀티캐스트와 계층형 PAT 커널을 넣었습니다. 2.32는 여러 통신자가 NVLS 슬롯을 소진하던 문제를 줄이고 H100의 PAT+NVLS 성능 저하를 고쳤습니다. GB200 튜닝 가이드는 지원 시스템에서 NVLS가 기본으로 켜지며 all-reduce 비중이 큰 워크로드에 유리하다고 설명합니다. 메모리 사용이 걱정되면 끌 수 있으므로, 가이드는 켠 상태와 끈 상태를 모두 벤치마크하도록 권합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 튜닝 불필요 | 피크 성능을 위해 NCCL 환경 변수를 튜닝할 필요는 대개 없음 | GB200 Multi-Node Tuning Guide | `✓` |
| 디버깅 변수 경고 | `NCCL_ALGO`·`NCCL_PROTO`는 프로덕션 설정 비권장. LL128 강제 시 데이터 손상 가능 | NCCL 환경 변수 문서 | `✓` |
| 채널 변수 | `NCCL_MIN/MAX_NCHANNELS`는 2.17에서 deprecated, `NCCL_MIN/MAX_CTAS`로 대체 | NCCL 환경 변수 문서 | `✓` |
| 토폴로지 변수 | `NCCL_TOPO_FILE`, `NCCL_TOPO_DUMP_FILE`, `NCCL_IB_HCA`, `NCCL_SOCKET_IFNAME`, `NCCL_CROSS_NIC` 기본 2, `NCCL_NET_GDR_LEVEL` | NCCL 환경 변수 문서 | `✓` |
| 2.32u1 기본값 | `NCCL_IB_GID_INDEX`·`NCCL_IB_TC`·`NCCL_IB_SL` 기본 AUTO | NCCL 릴리스, 환경 변수 문서 | `✓` |
| RAS | `NCCL_RAS_ENABLE` 기본 1, `NCCL_RAS_ADDR` 기본 localhost:28028. 2.31에 진단 변수 추가 | NCCL 환경 변수 문서 | `✓` |
| SHARP 요구 | ConnectX-6 HDR+, Quantum HDR+, MLNX_OFED, GPUDirect RDMA, NCCL 2.7.3+ | SHARP 문서 | `✓` |
| SHARP 설정과 제약 | `NCCL_COLLNET_ENABLE=1`, `SHARP_COLL_*`, 통신자 하나, 스위치당 스트리밍 플로 최대 2(SHARP 2.6.1) | SHARP 문서 | `✓` |
| CollNet 알고리즘 | CollnetChain·CollnetDirect(2.14+), `NCCL_IGNORE_COLLNET_MISMATCH`(2.30+) | NCCL 환경 변수 문서 | `✓` |
| SHARP 효과 수치 | 조건 있는 1차 수치 없음. Aggregation Manager·UFM 요건 원문 미확인 | — | `?` |
| NVLS 변수 | `NCCL_NVLS_ENABLE` 0/1/2. 2.27·2.28의 조용한 폴백과 hang, 2.29에서 되돌림 | NCCL 환경 변수 문서 | `✓` |
| NVLS 지원 조건 | NVSwitch 3세대 이상, Hopper 이후, CUDA 12.1+, 드라이버 530.30.02+ | NVSHMEM 설치 가이드 | `≈` |
| NVLS 알고리즘 변화 | 2.18.1 NVLS·NVLSTree, 2.31 AllGather 멀티캐스트와 계층형 PAT, 2.32 슬롯 소진 완화 | NCCL 릴리스 노트 | `✓` |
| GB200의 NVLS | 지원 시스템에서 기본 켜짐. 켠 상태와 끈 상태 모두 벤치마크 권고 | GB200 Multi-Node Tuning Guide | `✓` |
| NVLS 효과 | 공식 벤치마크 없음 | — | `?` |
| 플러그인 탐색 | `NCCL_NET_PLUGIN` → `libnccl-net-<suffix>.so` → `libnccl-net.so` → 내장 | NCCL 환경 변수 문서 | `✓` |
| 클라우드별 경로 | aws-ofi-nccl v1.21.1, GCP A3 Mega TCPXO, A3 Ultra 이후 RoCE GPUDirect RDMA | aws-ofi-nccl 릴리스, Google Cloud 문서 | `✓` |
| UCX의 위치 | NCCL 경로와 별개라는 정리. 절 본문 미확인 | GB200 Multi-Node Tuning Guide 목차 | `≈` |

{{% /details %}}

## 4. 인수 합격선은 자기 하드웨어의 측정에서 세운다

NVIDIA가 공식으로 낸 nccl-tests 기대 busbw와 perftest(26.07.8)의 기대값을 뒷받침하는 1차 출처는 확인하지 못했습니다. 단일 노드 H100 8 GPU에서 대용량 메시지 all-reduce가 약 450~480 GB/s라는 2차 가이드가 있고, 다른 2차 가이드는 400~450 GB/s를 제시합니다. 이 값들을 공식 합격 기준으로 쓸 수는 없습니다. NVCRE에도 기본 임계값은 없습니다. 제공자가 자기 하드웨어의 첫 측정으로 기준을 정해야 합니다.

검증 범위는 GPU 자체에서 통신으로 넓혀 갑니다. DCGM 진단은 `dcgmi diag -r 1`부터 `-r 4`까지 네 단계입니다. Hopper의 8 GPU를 기준으로 측정한 소요 시간은 level 1이 2.5초 미만, 2가 10.5분 미만, 3이 35분 미만, 4가 2.25시간 미만입니다. level 3부터 Targeted Stress, Targeted Power, NVBandwidth가 실행되고, `DCGM_NCCL_TESTS_BIN_PATH`를 설정하면 NCCL Tests 플러그인도 동작합니다. level 4는 여기에 Memtest와 Pulse를 더합니다.

통신 검증에서는 nccl-tests의 busbw를 읽어야 합니다. AllReduce에서 busbw는 algbw × 2(n−1)/n입니다. nccl-tests 문서는 이 값이 NVLink, PCI, QPI, 네트워크 등 하드웨어 병목의 속도를 반영해야 한다고 설명합니다. `ib_write_bw`로 대표되는 perftest에서는 라인 레이트에 근접하는지 확인하는 정도로 기대치를 잡을 수 있습니다.

2차 가이드는 테스트 전에 `ibstat`로 링크가 Active인지 확인하고, 단일 노드에서 시작해 노드 수를 늘리도록 안내합니다. 특정 규모에서 busbw가 떨어지면 해당 링크나 스위치를 의심하는 방식입니다. GB200 튜닝 가이드의 Slurm 실행 예는 `MPI=1`로 빌드한 뒤 GPU 하나에 프로세스 하나를 배정합니다. 아래와 같이 실행하고 노드 수를 절반씩 줄여 가며 반복합니다.

```bash
export NCCL_DEBUG=WARN
TEST_ARGS="-dfloat -b8 -e32G -f2"
srun --ntasks-per-node ${GPUS_PER_NODE} --cpu-bind=none --mpi=pmix \
  all_reduce_perf ${TEST_ARGS}
# reduce_scatter_perf, all_gather_perf, alltoall_perf도 같은 방식으로 실행
```

이 검증을 Kubernetes에서 실행하는 도구가 NVIDIA Cluster Readiness Engine(NVCRE, v0.8.1)입니다. 2026-09-23에 공개된 오픈소스 Kubernetes 컨트롤러로, NCCL 5종(all-reduce, all-gather, all-to-all, loopback, NVSwitch 경유 loopback), DCGM level-4 진단, NeMo 사전학습을 실행합니다. DCGM 진단에는 단독 DCGM 서비스가 필요합니다.

NVIDIA 블로그의 GB200 NVL72급 예시는 `busBandwidthGBps: "value >= 900"`, `goodputRatio >= 0.9`, `avgTFLOPsPerGPU >= 800`을 사용합니다. 샘플 리포트에는 16노드 GB300 NVL72에서 all-reduce busbw 932.09 GB/s, 실행 시간 3분 56초, PASSED가 나옵니다. 이 수치는 예시이며 다른 클러스터의 합격 기준이 아닙니다.

합격선에 못 미친 그룹을 좁히는 과정은 NVCRE가 자동화합니다. 랙 안 테스트는 `nvidia.com/gpu.clique` 라벨로 노드를 나누고, `testScale: diagnose`에서는 실패한 그룹을 반으로 나눠 다시 실행합니다. 이 과정을 `minGroupSize`까지 반복하며, 목표에 못 미치면 `ValidationFailed` 조건이 붙습니다.

다음 도식은 실패 그룹을 좁혀 가는 과정과 검증 결과가 격리 동작으로 이어지는 경계를 보여 줍니다.

{{< flow src="_flow/4-nvcre-이분-탐색.json" />}}

NVCRE 자체는 노드를 cordon하거나 taint하지 않고 노드 조건도 패치하지 않습니다. NVSentinel의 NVCRE Certification Monitor가 실패 결과를 health event로 바꾸고, 이후 격리와 drain이 일어납니다. 검증과 격리가 분리돼 있으므로 검증을 먼저 켜 두고 결과에 신뢰가 쌓인 뒤 격리를 연결할 수 있습니다. NVCRE 리소스는 `nvcre.nvidia.com/v1alpha1`의 `Certification`, `Workflow`, `Job`, `WorkloadRun`이며, CLI는 `nvcrectl`입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 규모 확대 순서 | 단일 노드부터 늘리고 `ibstat`로 Active 확인 | 2차 가이드 | `≈` |
| DCGM 진단 시간 | r1 2.5초 미만, r2 10.5분 미만, r3 35분 미만, r4 2.25시간 미만. Hopper, 8 GPU 기준 | DCGM 진단 문서(2026-06-17 갱신) | `✓` |
| DCGM 진단 구성 | r3부터 Targeted Stress·Targeted Power·NVBandwidth, `DCGM_NCCL_TESTS_BIN_PATH` 설정 시 NCCL Tests 플러그인, r4에 Memtest·Pulse | DCGM 진단 문서 | `✓` |
| busbw 정의 | busbw = algbw × 2(n−1)/n(AllReduce). 하드웨어 병목 속도를 반영해야 함 | nccl-tests PERFORMANCE.md | `✓` |
| 실행 예 | `MPI=1` 빌드, `NCCL_DEBUG=WARN`, `-dfloat -b8 -e32G -f2`, `srun --ntasks-per-node ${GPUS_PER_NODE} --cpu-bind=none --mpi=pmix`, 노드 수를 절반씩 줄여 반복 | GB200 Multi-Node Tuning Guide | `✓` |
| 단일 노드 H100 기대값 | 450~480 GB/s, 다른 가이드는 400~450 GB/s | 2차 가이드 | `≈` |
| 공식 기대값 | NVIDIA 1차 수치 없음. perftest 기대값 1차 출처도 없음 | — | `?` |
| NVCRE 공개 | 2026-09-23, v0.8.1(2026-10-20). 오픈소스 Kubernetes 컨트롤러 | NVIDIA 블로그, GitHub 릴리스 | `✓` |
| NVCRE 테스트 | NCCL 5종, DCGM level-4(단독 DCGM 필요), NeMo 사전학습 | NVCRE 문서 | `✓` |
| 이분 탐색 | `testScale: diagnose`, 실패 그룹을 반으로 나눠 `minGroupSize`까지, 미달 시 `ValidationFailed` | NVCRE 문서 | `✓` |
| 격리 권한 | 노드를 cordon·taint하지 않고 조건도 패치하지 않음. NVSentinel Certification Monitor가 health event로 변환 | NVCRE 문서 | `✓` |
| 임계값 예시 | `busBandwidthGBps >= 900`, `goodputRatio >= 0.9`, `avgTFLOPsPerGPU >= 800`. 기본 임계값 없음. 샘플은 16노드 GB300 932.09 GB/s, 3분 56초, PASSED | NVIDIA 블로그 | `✓` |
| CRD와 CLI | `Certification`·`Workflow`·`Job`·`WorkloadRun`, `nvcrectl` | NVCRE GitHub | `✓` |

{{% /details %}}

## 5. 관측할 카운터와 자동 조치 범위의 분리

dcgm-exporter를 기본 설정으로 설치해도 모든 NVLink 에러 카운터가 수집되지는 않습니다. dcgm-exporter 4.8.4는 DCGM 4.6.1을 기반으로 하며, 기본 CSV에서 NVLink 에러 카운터 계열은 주석 처리돼 있습니다. GPU 세대에 따라 필드도 달라집니다. Hopper 이전은 409~439번대, Hopper는 497~499, Blackwell은 1211~1213입니다. 기본 설정에서 NVLink 열화가 대시보드에 드러나게 하려면 운영자가 해당 세대의 카운터를 직접 켜야 할 것으로 보입니다.

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

exporter 자체 메트릭인 `DCGM_EXP_XID_ERRORS_COUNT`, `DCGM_EXP_XID_ERRORS_TOTAL`, `DCGM_EXP_GPU_HEALTH_STATUS`도 기본 CSV에서 주석 처리돼 있습니다. 피어 링크별 NVLink P2P 상태를 보여 주는 `DCGM_EXP_P2P_STATUS` 역시 기본 주석입니다. 필드 이름은 `_ERRORS`가 `_ERROR`로, `_COUNTER`가 `_TOTAL`로 정리되는 중이며, 옛 이름은 헤더에 별칭으로 남아 있습니다. 대시보드와 알림 규칙을 작성할 때는 이 이름 변화도 고려해야 합니다.

NVL72 환경에서는 10편의 NMX-M 헬스 메트릭이 패브릭 상태 관측을 채웁니다. Spectrum-X는 NetQ, InfiniBand는 UFM이 패브릭 쪽 관측을 맡습니다.

NVSentinel의 GPU 상태 입력은 dcgm-exporter를 거치지 않습니다. DCGM을 직접 조회하며, syslog(journalctl), 클라우드 사업자의 유지보수 이벤트, NIC 헬스, Health Events Analyzer, Kubernetes 오브젝트 모니터도 입력으로 사용합니다.

자동 격리는 NVSentinel(v1.28.0)이 맡습니다. 기본 설치는 모니터링만 수행하며, `global.faultQuarantine.enabled`, `global.nodeDrainer.enabled`, `global.faultRemediation.enabled`로 격리, drain, 복구를 활성화합니다. 동작 순서는 장애를 노드 조건으로 보고한 뒤 cordon과 taint, drain, GPU 리셋이나 재부팅으로 이어집니다. 5분 창 안에 격리된 노드가 클러스터의 50%에 이르면 격리 처리를 멈추는 회로 차단기도 있습니다.

설치에는 Kubernetes 1.34 이상, Helm 3 이상, GPU Operator의 `dcgm.enabled=true`, cert-manager 1.21 이상, 영속 스토리지(MongoDB)가 필요합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 필드 ID | 위 표의 ID와 이름 | `dcgm_fields.h`(master) | `✓` |
| exporter 기본 수집 | XID 오류, PCIe replay, NVLink 대역, row remap은 켜짐. FM 상태 필드는 꺼짐. FM 헬스 마스크, NVLink 카운터 계열은 주석 처리 | dcgm-exporter `default-counters.csv` | `✓` |
| 세대별 NVLink 필드 | Hopper 이전 409~439, Hopper 497~499, Blackwell 1211~1213 | `dcgm_fields.h`, `default-counters.csv` | `✓` |
| 기본 설정에서 보이지 않는다는 결론 | 주석 구조에서 이끌어 낸 판단 | — | `≈` |
| exporter 자체 메트릭 | `DCGM_EXP_XID_ERRORS_COUNT`, `DCGM_EXP_XID_ERRORS_TOTAL`, `DCGM_EXP_GPU_HEALTH_STATUS`, `DCGM_EXP_P2P_STATUS`. 기본 주석 | dcgm-exporter `default-counters.csv` | `✓` |
| 필드 이름 정리 | `_ERRORS` → `_ERROR`, `_COUNTER` → `_TOTAL`. 옛 이름은 별칭 | `dcgm_fields.h` | `✓` |
| NVSentinel 입력과 동작 | DCGM 직접 조회, syslog, CSP 유지보수 이벤트, NIC 헬스, Health Events Analyzer, K8s Object Monitor. 조건 보고, cordon/taint, drain, 리셋·재부팅 | NVSentinel README | `✓` |
| NVSentinel 요구 | K8s 1.34+, Helm 3+, `dcgm.enabled=true`, cert-manager 1.21+, MongoDB | NVSentinel README | `✓` |
| 단계별 opt-in | 기본 모니터링만. `global.faultQuarantine.enabled`·`nodeDrainer`·`faultRemediation` | NVSentinel README | `✓` |
| 회로 차단기 | 5분 창 안에 cordon된 노드가 50%에 이르면 격리 처리 중단 | NVSentinel README | `✓` |
| node-problem-detector 연동 | 1차 자료 확보하지 못함 | — | `?` |

{{% /details %}}

## 6. 테넌트 경계를 만드는 디바이스와 패브릭 계층

테넌트를 나누는 수단은 패브릭 계층마다 다릅니다. 노드 안에서는 RDMA 디바이스를 어떻게 파드에 배정하는지, InfiniBand와 NVLink에서는 어떤 파티션을 쓰는지 확인해야 합니다.

### 노드 안 RDMA 디바이스

이 글의 판단으로는 멀티테넌트 노드 풀에는 SR-IOV VF와 exclusive 모드의 RDMA CNI를 쓰고, 공유 플러그인은 단일 테넌트 노드 풀에 두는 구성이 맞아 보입니다. 근거는 각 플러그인이 디바이스를 다루는 방식과 문서가 설명하는 보장 범위입니다.

RDMA CNI는 SR-IOV 인터페이스의 RDMA 디바이스를 컨테이너 netns(네트워크 네임스페이스)로 옮깁니다. 이때 RDMA 서브시스템은 exclusive 모드여야 합니다. `ib_core`의 `netns_mode=0` 또는 `rdma system set netns exclusive`로 설정하며, 모드를 바꾸려면 시스템에 netns가 하나도 없어야 합니다. 요구 버전은 커널 5.3 이상이나 MOFED 4.7 이상입니다.

`k8s-rdma-shared-dev-plugin`은 HCA 하나를 `rdmaHcaMax`개 리소스로 광고해 여러 파드가 공유하게 합니다. README는 이 방식이 격리를 보장한다고 쓰지 않습니다.

Spectrum-X 경로에서는 SR-IOV Device Plugin이 VF를 `nvidia.com/...` 리소스로 광고합니다. 이어 OVS-CNI가 VF를 레일 OVS 브리지에 연결하고, NV-IPAM이 주소를 배정하며, RDMA-CNI가 RDMA 디바이스를 파드 netns로 옮깁니다. 이 구성도 exclusive 모드가 필요합니다. VF 리소스 개수를 ResourceQuota로 네임스페이스마다 제한하는 것은 Kubernetes의 일반 기능이지만, 패브릭 문서에서 이를 직접 권하는 근거는 찾지 못했습니다.

### InfiniBand와 NVLink의 파티션

InfiniBand에서는 PKey(파티션 키)가 기본 분리 수단입니다. UFM REST API로 0x0에서 0x7fff 사이의 16진 값인 PKey를 만들고 GUID를 넣습니다. full 멤버는 파티션 안의 모두와 통신할 수 있지만 limited 멤버끼리는 통신하지 못합니다. UFM 버전에 따라 API 경로는 `/ufmRest/resources/pkeys` 또는 `/ufmRestV2/plugin/fast_api/resources/pkeys/`입니다.

Kubernetes 파드와 PKey를 잇는 구성 요소는 `ib-kubernetes` 데몬입니다. `mellanox.infiniband.app` 어노테이션이 붙은 파드의 GUID를 UFM 플러그인으로 PKey에 넣으며, IB SR-IOV CNI와 Multus를 함께 사용합니다. 노드당 PKey는 커널 제약으로 최대 128개입니다. 설정에는 `DAEMON_SM_PLUGIN: "ufm"`, `DAEMON_PERIODIC_UPDATE`, `GUID_POOL_RANGE_START`, `GUID_POOL_RANGE_END`를 씁니다. Network Operator 26.x에는 `IBKubernetesSpec` CRD로 들어와 있습니다. NCCL은 `NCCL_IB_PKEY`로 인덱스를, `NCCL_IB_PKEY_VALUE`로 값을 지정하며 값이 우선합니다.

NVL72의 NVLink에서는 NMX 사용자 파티션(`nv action create sdn partition`)이 하드 분리를 맡고, ComputeDomain이 잡 단위 IMEX 분리를 맡습니다. 여러 테넌트가 Default Partition을 공유하면 IMEX와 ComputeDomain에 의한 논리 분리가 적용됩니다. Mission Control 문서는 보안 요구가 강한 경우 NVLink 파티션을 쓰도록 권고합니다.

이더넷 compute 패브릭을 테넌트별 VRF나 VXLAN으로 나누는 NVIDIA 레퍼런스는 확인하지 못했습니다. 문서에서 확인한 Spectrum-X Kubernetes 구성은 OVS-CNI가 VF를 레일별 OVS 브리지에 연결하는 방식입니다.

### 스토리지와 다른 잡의 트래픽

SuperPOD 레퍼런스는 모두 compute 패브릭, 스토리지 패브릭, in-band 관리, out-of-band 관리로 네트워크를 나눕니다. 스토리지 패브릭을 따로 두어 노드 간 compute 패브릭에서 스토리지 트래픽을 떼어냅니다. B300판은 스토리지용으로 InfiniBand(MQM9700 NDR)나 RoCE(SN5610·SN5600)를 선택합니다. 스토리지 장치 쪽은 1:1이며 DGX 쪽은 약 4:3으로 오버서브스크립션합니다.

in-band와 OOB 이더넷은 한 물리망에서 VXLAN/EVPN으로 분리합니다. OOB는 BMC, BlueField-3 BMC, 스위치 관리 포트, PDU를 연결하고 InfiniBand 패브릭 관리 트래픽도 실어 나릅니다. in-band는 Mission Control, BCM, Slurm, Kubernetes 서비스와 NFS 계층을 담당합니다. Meta는 프론트엔드와 백엔드를 물리적으로 분리했으며, Google Cloud의 A3 Ultra와 A4는 GPU 통신 전용 NIC 8개와 별도의 gVNIC를 둡니다.

다른 잡의 all-reduce가 간섭하는 문제에는 레일 최적화와 토폴로지를 아는 배치로 교차 트래픽을 줄이는 방식이 쓰입니다. Meta는 이를 minimum cut 배치라고 부릅니다. NVIDIA 제품·문서는 InfiniBand의 SL/VL, 적응형 라우팅, 혼잡 제어와 Spectrum-X의 “노이즈 격리”를 기능으로 제시합니다.

ComputeDomain은 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}}), RDMA 운영 함정은 [07편]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}}), 스토리지 패브릭을 compute와 나누는 이유는 [09편]({{< relref "/platform/kubernetes/gpu/09-storage-reality/index.md" >}})에서 이어 보면 됩니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| IB PKey | 0x0~0x7fff, full 멤버는 전원 통신, limited끼리는 불가. UFM 버전별 경로 두 가지 | UFM REST API 가이드 6.25.1·6.26.1 | `✓` |
| ib-kubernetes | `mellanox.infiniband.app` 어노테이션, UFM 플러그인, 노드당 PKey 최대 128, 설정 키 `DAEMON_SM_PLUGIN`·`DAEMON_PERIODIC_UPDATE`·`GUID_POOL_RANGE_START/END` | ib-kubernetes README | `✓` |
| `IBKubernetesSpec` | Network Operator 26.x CRD | Network Operator 문서 | `✓` |
| NCCL의 PKey | `NCCL_IB_PKEY`(인덱스), `NCCL_IB_PKEY_VALUE`(값 우선) | NCCL 환경 변수 문서 | `✓` |
| 이더넷 분리 | in-band·OOB를 VXLAN/EVPN으로 분리. Spectrum-X 구성에서 OVS-CNI가 VF를 레일 OVS 브리지에 연결 | SuperPOD B300 레퍼런스, Network Operator 26.7 | `✓` |
| 테넌트별 VRF 설계 | NVIDIA 레퍼런스를 찾지 못함 | — | `?` |
| NVLink 분리 | NMX 사용자 파티션은 하드 분리, ComputeDomain은 잡 단위 IMEX 분리, 강한 보안은 NVLink 파티션 권고 | Mission Control 2.0 관리 가이드, k8s-dra-driver-gpu | `✓` |
| RDMA CNI | RDMA 디바이스를 컨테이너 netns로 이동. exclusive 모드 필요(`netns_mode=0`), 모드 변경 시 netns 없어야 함. 커널 5.3+ 또는 MOFED 4.7+ | rdma-cni README | `✓` |
| 공유 플러그인 | HCA를 `rdmaHcaMax`개로 광고해 공유. README는 격리를 보장한다고 쓰지 않음 | k8s-rdma-shared-dev-plugin README | `✓` |
| 멀티테넌트 풀 구성 | SR-IOV VF + exclusive 모드 RDMA CNI, 공유 플러그인은 단일 테넌트 풀 | 위 사실에서 이끌어 낸 정리 | `≈` |
| Spectrum-X 경로 | SR-IOV Device Plugin → OVS-CNI → NV-IPAM → RDMA-CNI, exclusive 모드 필요 | Network Operator 26.7 | `✓` |
| ResourceQuota | 확장 리소스 개수 제한은 Kubernetes 일반 기능. 패브릭 문서의 직접 근거는 못 찾음 | — | `≈` |
| 네트워크 네 개 | compute, storage, in-band, OOB. 스토리지 IB(NDR)/RoCE 선택, 1:1과 약 4:3, in-band·OOB는 VXLAN/EVPN | SuperPOD B300 레퍼런스 | `✓` |
| Meta의 분리 | 프론트엔드와 백엔드를 물리적으로 분리 | Meta 엔지니어링 블로그 | `✓` |
| 스토리지 분리 | compute 패브릭에서 스토리지 트래픽을 분리. GCP는 GPU 전용 NIC 8개와 gVNIC | SuperPOD 레퍼런스, Google Cloud 문서 | `✓` |
| 교차 트래픽 감소 | 레일 최적화와 토폴로지 인지 배치(Meta "minimum cut") | Meta 엔지니어링 블로그 | `✓` |
| 문서상 노이즈 격리 | IB의 SL/VL·적응형 라우팅·혼잡 제어, Spectrum-X "노이즈 격리". 효과 측정은 없음 | NVIDIA 제품·문서 | `Ⓥ` |
| NVL72 공유 | Default Partition을 공유하면 IMEX/ComputeDomain으로 논리 분리 | Mission Control 2.0 관리 가이드 | `✓` |

{{% /details %}}

## 7. 확인하지 못한 것

- NVIDIA가 공식으로 낸 nccl-tests 기대 busbw(H100, B200, B300의 노드 안과 노드 간). NVCRE도 기본 임계값을 싣지 않는다
- perftest(`ib_write_bw`)의 기대값 1차 출처
- SHARP의 활성 요건 원문과 효과의 조건부 수치. SHARP 3.x 문서 페이지는 열리지 않았다
- NVLS 효과를 보여 주는 공식 수치
- node-problem-detector와 DCGM·XID를 묶은 공개 운영 사례. NVSentinel이 노드 조건을 직접 보고하므로 별도 연동이 필요한지도 확인하지 못했다
- 이더넷 compute 패브릭을 테넌트별 VRF로 나누는 NVIDIA 레퍼런스
- topograph의 옛 라벨 키가 언제 바뀌었는지
- UCX 절의 본문. 목차만 확인했다
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
