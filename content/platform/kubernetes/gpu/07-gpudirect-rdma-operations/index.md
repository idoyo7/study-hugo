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

[06편]({{< relref "/platform/kubernetes/gpu/06-gpudirect-rdma-basics/index.md" >}})의 호스트와 파드 구성을 마쳤다면, 이제 NCCL(GPU 간 통신 라이브러리)이 선택한 전송 경로를 확인할 차례입니다. GPU와 NIC(네트워크 인터페이스 카드) 사이의 직접 전송인 GPUDirect RDMA를 준비했어도, 실제 통신은 호스트 메모리를 경유할 수 있습니다. 가장 직접적인 증거는 `NCCL_DEBUG=INFO`로 남기는 채널 연결 로그입니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-21이며 NCCL 2.32.3, Kubernetes 1.37, DraNet 1.5.0 시점의 문서를 봤습니다.

NCCL 2.32.3 소스의 `transport/net.cc`는 채널마다 `[send] via NET/IB/0` 형태의 로그를 남깁니다. GPUDirect RDMA를 줄여 부르는 GDR이 켜지면 뒤에 `/GDRDMA`가 붙습니다. `via NET/IB/0/GDRDMA`는 GPU 메모리에서 직접 전송하는 경로이고, `via NET/IB/0`만 있으면 호스트 메모리를 경유하는 경로입니다. C2C 플랫폼에서 PCI 강제 매핑을 쓰면 `(PCI)`, 공유 연결이면 `/Shared`도 붙습니다.

어느 장치를 골랐는지는 `NET/IB : Using [0]mlx5_0:1/IB [1]mlx5_1:1/RoCE [RO]; OOB eth0:<ip>` 형식의 줄에서 읽을 수 있습니다. 공식 로그 문서는 소켓으로 폴백했을 때의 `via NET/Socket/0`과 `DMA-BUF is available on GPU device 0`도 예시로 보여 줍니다.

거리 때문에 GDR이 꺼졌는지 확인하려면 로그 수준에도 주의해야 합니다. `NCCL_DEBUG_SUBSYS`에 GRAPH와 NET을 켜면 해당 사유를 출력하도록 되어 있지만, 그 문구는 TRACE 빌드에서만 나옵니다. 일반 빌드에서는 거리 판정 사유를 볼 수 없습니다.

아래 도식은 NCCL이 GDR 사용 여부를 결정하는 흐름입니다. 기본값에서는 GPU와 NIC 사이 거리가 PXB 이내이고 GDR 경로가 있을 때만 켜집니다.

{{< flow src="_flow/2-nccl-gdr-판정.json" />}}

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 조사한 버전 | NCCL v2.32.3-1, nccl-tests v2.21.1, Kubernetes v1.37.1, DraNet v1.5.0, k8s-device-plugin v0.20.1, aws-ofi-nccl v1.21.1 | 각 프로젝트 릴리스와 태그 | `✓` |
| 릴리스 날짜의 연도 | GitHub가 연도를 표시하지 않아 태그 순서와 문서 날짜로 추정 | GitHub 릴리스 | `≈` |
| GDR 로그 표시 | 채널 로그 `[send] via NET/%s/%d%s%s%s`에서 GDR이면 `/GDRDMA`, C2C 강제 PCI면 `(PCI)`, 공유 연결이면 `/Shared` | NCCL 2.32.3 소스 transport/net.cc | `✓` |
| 장치 선택 로그 | `NET/IB : Using%s %s; OOB %s:%s`, 링크 계층 IB/RoCE, `[RO]`는 relaxed ordering | NCCL 2.32.3 소스 init.cc | `✓` |
| 공식 로그 예시 | `Using network IB`, `via NET/Socket/0`, `DMA-BUF is available on GPU device 0` | NCCL 로깅 문서 | `✓` |
| 거리 사유 로그는 TRACE 빌드에서만 | `GPU Direct RDMA Enabled for ...` / `Disabled for ... (distance X > Y)` | NCCL 소스 paths.cc | `✓` |

{{% /details %}}

## 2. busbw는 측정 조건과 함께 읽는다

nccl-tests의 `all_reduce_perf` 같은 도구로 busbw를 측정할 수 있지만, 공개된 기준값을 그대로 기준으로 삼기는 어렵습니다. 알고리즘과 메시지 크기, 노드 수, 하드웨어가 결과에 함께 반영되기 때문입니다.

nccl-tests 문서는 all_reduce의 버스 대역폭을 `busbw = algbw × (2(n-1)/n)`로 정의합니다. 이 값은 NVLink, PCI, QPI, 네트워크 가운데 하드웨어 병목의 속도를 반영해야 한다는 설명입니다. 출력에는 메시지 크기별로 out-of-place와 in-place의 시간, algbw, busbw가 나오고, 끝에 `# Avg bus bandwidth` 줄이 붙습니다.

AWS EKS 문서의 예시는 `all_reduce_perf -b 8 -e 16G -f 2 -g 1 -c 1 -n 100`을 `mpirun -np 16 -N 8`로 실행합니다. p5.48xlarge 2대를 쓰며, 워커마다 `nvidia.com/gpu: 8`, `vpc.amazonaws.com/efa: 32`, `hugepages-2Mi: 5120Mi`를 요청하는 구성입니다.

확보한 공개 측정값은 모두 사업자나 도구 제작자가 낸 값입니다. NVIDIA가 DGX H100 기준치를 공식 문서로 낸 것은 찾지 못했습니다. 숫자 옆의 조건까지 함께 읽어야 합니다.

| 출처 | 조건 | 값 |
|---|---|---|
| Crusoe 문서 | H100 SXM 8장 2대, IB, VM, `-b 8 -e 2G`, `NCCL_IB_HCA`로 8포트 지정 | 2GB에서 busbw 약 361 GB/s |
| SkyPilot 예제(CoreWeave) | H200 8장 2노드, NCCL 2.26.2, `-b 512M -e 8G` | 평균 약 462 GB/s. IB를 끄면 약 3.7 GB/s |
| DraNet GKE 문서 | B200 8장 2노드, GKE RDMA, NCCL 2.26.6, all_gather | 큰 메시지 피크 약 262 GB/s |

이 표에서 값이 큰 순서로 구성을 평가할 수는 없습니다. all_reduce와 all_gather가 섞여 있고, 메시지 크기와 노드 수, 하드웨어 세대도 비교 조건입니다. 특히 2노드 all_reduce의 busbw에는 노드 안 NVLink 축약 비율이 섞입니다. H200 사례처럼 NIC 총합인 8×400Gb/s, 약 400GB/s를 넘는 값도 나올 수 있습니다.

노드 사이 네트워크 성능을 따로 보려면 노드 수를 늘리거나 노드당 rank를 하나로 측정하는 편이 나아 보입니다. 이는 수치와 NIC 합계를 비교한 해석입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| busbw 정의 | all_reduce `busbw = algbw × (2(n-1)/n)`, 하드웨어 병목을 반영 | nccl-tests PERFORMANCE.md | `✓` |
| EKS 예시 명령 | `-b 8 -e 16G -f 2 -g 1 -c 1 -n 100`, `-np 16 -N 8`, p5.48xlarge 2대, `vpc.amazonaws.com/efa: 32`, `hugepages-2Mi: 5120Mi` | AWS EKS 문서 | `✓` |
| Crusoe 값 | `h100-80gb-sxm-ib.8x` 2대, busbw 361.06(out-of-place)/361.87(in-place) GB/s, 1GB에서 354.78 | Crusoe 문서 | `Ⓥ` |
| SkyPilot 값 | H200 8장×2노드, 평균 462.453 GB/s, 피크 482.49 GB/s(8GB in-place), IB 끔 3.7478 GB/s | SkyPilot 문서 | `Ⓥ` |
| DraNet GKE 값 | A4(B200) 8장×2노드, DraNet, NCCL 2.26.6, all_gather `-b 1K -e 8G`, 평균 59.36, 피크 약 261.57 GB/s(4GiB) | DraNet GKE RDMA 문서 | `Ⓥ` |
| 2노드 busbw가 NIC 총합을 넘을 수 있음, 측정 방식 권고 | H200 사례 482 GB/s와 NIC 합계 비교에 의한 해석 | — | `≈` |
| NVIDIA 공식 기준치 | DGX H100 기준 nccl-tests 값은 찾지 못함 | — | `?` |

{{% /details %}}

## 3. 느려지는 지점을 호스트와 파드에서 찾는다

GPUDirect RDMA가 켜지지 않았을 때는 오류보다 성능 저하가 먼저 드러나는 경우가 많습니다. NCCL 설정뿐 아니라 PCIe 경로, 메모리 고정 권한, 공유 메모리, RoCE 혼잡 제어까지 확인해야 하는 이유입니다.

### 환경변수로 거리 제한을 풀 때

NCCL 2.32.3 환경변수 문서에서 자주 조절하는 항목은 다음과 같습니다.

| 변수 | 뜻 |
|---|---|
| `NCCL_IB_HCA` | `<hca>[:<port>[:<rail>[:<plane>]]]`의 쉼표 목록. `^`는 제외, `=`는 정확 일치. 예 `^=mlx5_1,mlx5_4` |
| `NCCL_NET_GDR_LEVEL` | GDR을 허용할 최대 거리. LOC(끔), PIX, PXB, PHB, SYS(항상 켬). 미설정이면 자동 선택 |
| `NCCL_SOCKET_IFNAME` | 부트스트랩·소켓용 인터페이스 접두어 목록. 기본으로 `lo`와 `docker*`를 제외 |
| `NCCL_IB_DISABLE` | IB/RoCE 전송을 끄고 소켓으로 폴백 |
| `NCCL_IB_GID_INDEX` | 2.32u1부터 기본 AUTO. 2.21 이후에는 설정하지 말 것 |
| `NCCL_NET_GDR_READ` | 2.4.2부터 NVLink 플랫폼 기본 1, 그 외 0 |

`NCCL_NET_GDR_LEVEL`에 숫자를 넣으면 옛 번호 체계로 해석됩니다. 0은 LOC, 1은 PIX, 2는 PXB, 3은 PHB, 4 이상은 SYS입니다. Red Hat OpenShift AI 문서 예시의 `NCCL_NET_GDR_LEVEL: "5"`도 SYS에 해당하므로, NCCL의 기본 PXB 안전장치를 해제합니다.

거리가 먼 NIC에서 GDR을 강제할 때는 06편에서 본 CUDA 문서의 QPI 경고가 이 설정에도 적용된다고 보는 편이 안전합니다.

오래된 예시를 복사할 때는 `NCCL_IB_GID_INDEX`도 확인해야 합니다. NCCL 2.21 이전에는 `show_gids`로 RoCE v2 GID를 골라 지정했고, 블로그에도 `NCCL_IB_GID_INDEX=3` 같은 고정값 조언이 남아 있습니다. 현재 트러블슈팅 문서는 2.21 이후에는 이 변수를 설정하지 말라고 명시합니다.

### PCIe 경로를 바꾸는 ACS와 IOMMU

NCCL 트러블슈팅 문서는 IO 가상화(ACS)가 PCI 피어 투 피어 트래픽을 CPU root complex로 돌려 큰 성능 저하나 멈춤을 일으킬 수 있다고 설명합니다. `sudo lspci -vvv | grep ACSCtl` 결과에 `SrcValid+`가 있으면 ACS가 켜져 있을 가능성이 있습니다. BIOS에서 끄거나 `setpci`로 해제할 수 있으며, PLX 스위치는 재부팅할 때마다 다시 설정해야 합니다. VM에서는 ACS가 필수이므로 NIC의 ATS를 켜야 합니다.

같은 문서는 CUDA와 NVIDIA 드라이버가 IOMMU 활성 상태의 PCIe 피어 투 피어 전송을 지원하지 않는다고 밝힙니다. 베어메탈에서는 조용한 메모리 손상을 막으려면 IOMMU를 꺼야 합니다. `dmesg | grep -i -E "iommu|dmar|default domain"` 결과의 `Default domain type: Translated`로 활성 상태를 확인합니다. CUDA 문서가 요구하는 구성은 disabled 또는 pass-through입니다. `iommu=pt`라는 파라미터 이름은 이 문서들에 나오지 않습니다.

### 메모리 고정 권한과 공유 메모리

커널의 RDMA `ib_umem_get()`은 고정하려는 페이지 수가 `RLIMIT_MEMLOCK`을 넘으면 `CAP_IPC_LOCK`이 없는 요청을 거부합니다. NVIDIA와 Azure의 예시가 privileged 대신 `capabilities.add: ["IPC_LOCK"]`을 부여하는 이유입니다.

NCCL 문서는 Docker에서 `--shm-size=1g --ulimit memlock=-1`을 권합니다. `/dev/shm`이 부족하면 `failed to extend /dev/shm/nccl-...` 경고와 함께 초기화가 실패합니다. Kubernetes에서는 `emptyDir: {medium: Memory}`나 hostPath `/dev/shm`을 사용합니다.

hugepages는 EFA에서 필수입니다. Mellanox verbs 경로의 일반 요구사항이라는 근거는 찾지 못했으며, Network Operator 문서는 DPDK 애플리케이션을 실행할 때만 hugepage 구성이 필요하다고 적습니다.

Azure 가이드는 Operator 네임스페이스에 `pod-security.kubernetes.io/enforce=privileged` 라벨이 필요하다고 설명합니다. 워크로드 파드는 IPC_LOCK이면 충분하며, NUMA 관련 cuMem 호스트 할당에는 `SYS_NICE`가 필요할 수 있습니다.

### RoCE의 지연과 처리량이 흔들릴 때

NCCL 네트워킹 트러블슈팅 문서는 PFC, ECN, CNP, 큐 드롭 카운터가 오르면서 지연 꼬리가 길어지거나 처리량이 흔들리면, NCCL 튜닝보다 혼잡 제어와 lossless 설정을 먼저 확인하라고 안내합니다. pause와 PFC 카운터는 `ethtool -S`로 확인합니다.

재전송이 한도를 넘으면 NCCL은 `NET/IB: Got completion from peer ... with status=...` 경고를 내고 통신에 실패합니다. 기본값은 `NCCL_IB_TIMEOUT` 20과 `NCCL_IB_RETRY_CNT` 7입니다. 이 오류를 lossless 미설정과 연결하는 설명은 추정입니다.

패브릭 쪽 설정과 검증은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})과 [11편]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}}), 스토리지 RDMA는 [08편]({{< relref "/platform/kubernetes/gpu/08-storage-gds-nvmeof/index.md" >}})에서 이어집니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 환경변수로 레벨을 바꾸면 로그에 표시 | `NCCL_NET_GDR_LEVEL set by environment to SYS` | NCCL 소스 paths.cc | `✓` |
| 환경변수 정의 | `NCCL_IB_HCA` 형식, `NCCL_NET_GDR_LEVEL` 값 정의, `NCCL_SOCKET_IFNAME` 기본 제외, `NCCL_IB_DISABLE`, `NCCL_NET_GDR_READ` | NCCL 2.32.3 env 문서 | `✓` |
| 숫자 레벨의 해석 | 0=LOC, 1=PIX, 2=PXB, 3=PHB, 4 이상=SYS | NCCL 소스 `levelsOldToNew` | `✓` |
| 숫자 5가 PXB 안전장치를 끈다 | OpenShift AI 예시 값 5는 SYS에 해당 | Red Hat OpenShift AI 문서, NCCL 소스 | `✓` |
| GID 인덱스 | 2.32u1부터 AUTO, "With NCCL 2.21 and later releases, this environment variable should not be set." | NCCL env 문서, 네트워킹 트러블슈팅 문서 | `✓` |
| 거리가 먼 NIC에서의 강제는 위험 | CUDA 문서의 QPI 경고를 NCCL 설정에 적용한 해석 | CUDA 문서 | `≈` |
| ACS | P2P가 CPU root complex로 돌며 성능 저하·멈춤. `lspci -vvv`의 ACSCtl 줄, BIOS 또는 `setpci -s 03:00.0 ECAP_ACS+0x6.w=0000`, PLX는 재부팅마다, VM은 ACS 필수라 ATS 활성 | NCCL GPU 트러블슈팅 문서 | `✓` |
| IOMMU | "CUDA and the NVIDIA driver stack do not support IOMMU-enabled PCIe peer-to-peer memory transfer", `Default domain type: Translated` 확인 | NCCL GPU 트러블슈팅 문서, CUDA 문서 | `✓` |
| `iommu=pt` 언급 없음 | 위 두 문서에 파라미터 이름이 없음 | — | `≈` |
| memlock | `ib_umem_get()`이 `RLIMIT_MEMLOCK` 초과 시 `CAP_IPC_LOCK` 없으면 거부 | linux drivers/infiniband/core/umem.c | `✓` |
| IPC_LOCK만 사용 | NVIDIA·Azure 예시 모두 privileged 없이 `IPC_LOCK` | Network Operator 문서, Azure aks-rdma-infiniband | `✓` |
| Docker 옵션 | `--shm-size=1g --ulimit memlock=-1` | NCCL runtime 트러블슈팅 문서 | `✓` |
| /dev/shm | 부족 시 `failed to extend /dev/shm/nccl-...` | NCCL 트러블슈팅 문서 | `✓` |
| hugepages | EFA 필수. Mellanox verbs 일반 요구사항이라는 근거는 못 찾음. DPDK에서만 필요 | AWS EKS 문서, Network Operator deployment guide | `✓` |
| 네임스페이스 라벨 | `pod-security.kubernetes.io/enforce=privileged` | Azure aks-rdma-infiniband | `Ⓥ` |
| `SYS_NICE` | NUMA 관련 cuMem 호스트 할당에 필요할 수 있음 | NCCL runtime 트러블슈팅 문서 | `✓` |
| RoCE lossless 증상 | PFC/ECN/CNP/큐 드롭 카운터, `ethtool -S` | NCCL 네트워킹 트러블슈팅 문서 | `✓` |
| 재전송 한도 오류 | `status=` 경고, `NCCL_IB_TIMEOUT` 20, `NCCL_IB_RETRY_CNT` 7 | NCCL 소스 p2p.cc, connect.cc | `✓` |
| 위 오류와 lossless 미설정의 연결 | — | — | `≈` |

{{% /details %}}

## 4. 클라우드의 이름을 실제 전송 경로와 연결한다

### AWS EFA는 libfabric 전송을 확인한다

AWS EFA의 프로토콜은 SRD이고 API는 libfabric입니다. AWS는 GPU와 NIC 사이 직접 경로를 ADT(Accelerator Data Transfer)라고 부릅니다. EC2 문서는 NVIDIA GPU 인스턴스에서 ADT를 GPUDirect RDMA로 부른다고 설명합니다.

ADT를 지원하는 인스턴스는 p5.48xlarge, p5e.48xlarge, p5en.48xlarge, p6-b200, p6-b300, p6e-gb200이며, p5.4xlarge는 지원하지 않습니다.

- p5/p5e는 네트워크 카드 32개에 총 3,200 Gbps
- p6-b200은 GPU 8개에 카드 8개, 카드당 400 Gbps, 총 3,200 Gbps
- p6-b300은 카드 17개에 EFA 최대 6,400 Gbps
- p5.48xlarge는 GPU 하나와 같은 PCIe root를 공유하는 EFA 장치가 4개

Kubernetes에서는 EFA 디바이스 플러그인의 `vpc.amazonaws.com/efa`나 EFA DRA 드라이버를 사용합니다. 디바이스 플러그인의 리소스는 정수 개수로 요청하며 파드가 독점합니다. DRA(Dynamic Resource Allocation)는 장치 할당을 다루는 Kubernetes 기능입니다. EKS 문서에 나오는 EFA DRA 드라이버는 DRANET이며, Helm `eks/aws-dranet`과 DeviceClass `efa.networking.k8s.aws`를 사용합니다. EKS는 1.34 이상 신규 배포에 DRA를 권장하고, 두 할당 방식을 한 노드에 함께 설치하면 과다 할당 위험이 있다고 경고합니다.

EFA 드라이버는 2MiB 페이지 5128개를 미리 할당하므로 파드가 `hugepages-2Mi`를 요청해야 합니다. NCCL은 aws-ofi-nccl 플러그인을 사용하고, EKS 예시는 `NCCL_TUNER_PLUGIN`도 지정합니다. 성공 여부는 libfabric(`ofi`) 전송 로그로 확인합니다.

### GKE는 GPU 세대에 따라 경로가 달라진다

GKE의 A3 High는 GPUDirect-TCPX를 사용합니다. 보조 NIC 4개와 `nccl-tcpx-installer` DaemonSet, 파드별 `tcpx-daemon` 사이드카를 두는 구성입니다. A3 Mega는 보조 NIC 8개와 `nccl-tcpxo-installer`를 쓰는 GPUDirect-TCPXO입니다. 공통으로 `nri-device-injector`, 어노테이션 `networking.gke.io/interfaces`, gVNIC가 필요합니다.

GKE 문서는 TCPX/TCPXO가 RDMA인지 명시하지 않습니다. 이름상 TCP 기반 GPU 직접 수신 계열로 보이므로 GPUDirect RDMA와 구분해서 읽어야 합니다.

GPUDirect RDMA(RoCE)는 A3 Ultra, A4, A4X, A4X Max부터 제공됩니다. A3 Ultra와 A4는 GPU용 400 Gbps CX-7 NIC 8개와 외부용 200 Gbps Titanium NIC 2개를 갖추며, 문서는 이를 non-blocking 3.2 Tbps라고 설명합니다.

RDMA VPC는 `--network-profile=${ZONE}-vpc-roce`로 만들고, `nccl-rdma-installer`가 gIB NCCL 플러그인을 설치합니다. 멀티네트워크 API를 쓸 때의 구성은 `deviceMode: RDMA`의 `GKENetworkParamSet`과 `type: "Device"`의 `Network`입니다.

GKE managed DRANET은 DeviceClass `mrdma.google.com`을 사용합니다. Standard 1.34.1-gke.1829001 이상 또는 Autopilot 1.35.2-gke.1842000 이상이어야 하며, 노드 풀에 `cloud.google.com/gke-networking-dra-driver=true` 라벨이 필요합니다. 문서는 managed DRANET과 멀티네트워크 API를 함께 쓰지 말라고 명시합니다.

### Azure와 CoreWeave의 리소스 이름을 읽는 법

Azure ND H100 v5는 GPU마다 전용 400 Gbps Quantum-2 CX7 InfiniBand를 갖추며, VM당 대역폭은 3.2 Tbps입니다. Azure 문서는 GPU Direct RDMA 지원을 명시합니다.

AKS 구성에는 `AKSInfinibandSupport` 기능 등록과 노드풀 `--gpu-driver none`이 필요합니다. Network Operator에서는 SR-IOV `rdma/ib`, shared `rdma/shared_ib`, IPoIB 중에서 고릅니다. `rdma/ib`는 NIC당 1개를 파드가 독점하고, `rdma/shared_ib`는 기본 63슬롯입니다. 이 구성의 출처는 아직 작성 중이라고 밝힌 오픈소스 가이드 저장소이며, AKS 공식 지원 범위 밖의 구성도 포함합니다.

CoreWeave의 `rdma/ib: 1`은 의미가 다릅니다. CoreWeave 문서는 이를 장치 개수가 아닌 IB 노드 스케줄링용 플래그로 설명합니다. NCCL 설정은 `NCCL_IB_HCA=ibp`, `NCCL_SOCKET_IFNAME=eth0`을 사용합니다.

Oracle OCI에서 확인한 사실은 DraNet v1.5.0이 OKE의 native InfiniBand 지원을 추가했다는 내용입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| EFA의 ADT | "referred to as GPUDirect RDMA on NVIDIA GPU instances". 지원 인스턴스 목록, p5.4xlarge는 미지원 | AWS EC2 EFA 문서 | `✓` |
| 인스턴스별 대역폭 | p5/p5e 32카드 3,200 Gbps, p6-b200 8카드 3,200 Gbps, p6-b300 17카드 최대 6,400 Gbps | AWS EFA 가속 인스턴스 문서 | `✓` |
| p5.48xlarge의 PCIe root 공유 | GPU 하나당 EFA 4개 | AWS EKS 문서 | `✓` |
| EFA 플러그인과 DRA | `vpc.amazonaws.com/efa`, `eks/aws-dranet`, `efa.networking.k8s.aws`, 1.34+ 신규 배포 DRA 권장, 동시 설치 시 과다 할당 위험 | AWS EKS 문서 | `✓` |
| EFA hugepages | 2MiB 페이지 5128개 선할당, 파드 `hugepages-2Mi` 요청 | AWS EKS 문서 | `✓` |
| GKE TCPX/TCPXO | A3 High NIC 4개, A3 Mega NIC 8개, installer·daemon, gVNIC 필요 | GKE GPUDirect-TCPX 문서 | `✓` |
| TCPX가 RDMA인지는 문서가 밝히지 않음 | 이름상 TCP 계열이라는 해석 | — | `≈` |
| GKE RDMA | A3 Ultra/A4/A4X/A4X Max, 400 Gbps CX-7 8개, `--network-profile=${ZONE}-vpc-roce`, `nccl-rdma-installer`, `GKENetworkParamSet` | GKE AI Hypercomputer 문서 | `✓` |
| GKE managed DRANET | `mrdma.google.com`, Standard 1.34.1-gke.1829001+, Autopilot 1.35.2-gke.1842000+, 노드 풀 라벨, 멀티네트워크 API와 병용 금지 | GKE DRA 네트워크 할당 문서 | `✓` |
| managed DRANET의 GA 시점 | 2026-04 릴리스 노트로 검색 요약에서만 확인, 원문 미확인 | — | `Ⓥ` |
| Azure ND H100 v5 | GPU마다 400 Gbps CX7 IB, VM당 3.2 Tbps, GPU Direct RDMA 지원 | Azure ND H100 v5 문서 | `✓` |
| AKS 구성 | `AKSInfinibandSupport`, `--gpu-driver none`, `rdma/ib`, `rdma/shared_ib`(63슬롯), README는 작성 중 | Azure aks-rdma-infiniband | `Ⓥ` |
| OCI | DraNet v1.5.0이 OKE의 native InfiniBand 지원을 추가 | DraNet 릴리스 | `✓` |
| CoreWeave | `rdma/ib: 1`은 개수가 아닌 플래그, `NCCL_IB_HCA=ibp`, `NCCL_SOCKET_IFNAME=eth0` | CoreWeave 문서 | `Ⓥ` |
| OCI 공식 문서, Lambda 문서 | 찾지 못함 | — | `?` |

{{% /details %}}

## 5. GPU와 NIC의 정렬을 할당 조건으로 만든다

DraNet GKE 문서가 제시한 값으로는 4워커가 각각 GPU 4개와 NIC 4개를 쓰는 구성에서, 정렬했을 때 평균 22.2, 정렬하지 않았을 때 11.2였습니다. 해당 문서의 측정에서는 정렬하지 않은 결과가 절반 수준이었습니다. 벤더 문서의 값입니다.

Kubernetes DRA에서는 표준 속성 `resource.kubernetes.io/pcieRoot`로 이 정렬을 표현합니다. `matchAttribute` 제약으로 GPU와 NIC을 같은 PCIe root에 묶으면, 06편에서 본 "같은 스위치 아래" 조건을 스케줄링 단계에서 보장할 수 있습니다.

노드 안의 토폴로지는 [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}}), DRA 일반론은 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에 있습니다.

다음 ResourceClaimTemplate은 DRA Driver for SR-IOV를 사용해 GPU와 VF를 같은 PCIe root에 묶습니다.

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

Kubernetes 공식 블로그에 따르면 DRA 코어는 v1.34에서 GA가 됐고 `resource.k8s.io/v1`이 기본입니다. DraNet README는 stable 시점을 v1.35로 적어 한 버전 어긋나므로, 여기서는 공식 블로그를 따릅니다.

v1.37 블로그(2026-09-03)는 ResourceClaim `.status.devices`가 Stable이 됐다고 설명합니다. KEP-4817의 이 기능은 네트워크 장치의 인터페이스 이름, MAC, IP를 보고합니다. 같은 버전에서 DRA Extended Resource(KEP-5004)도 GA가 됐습니다. 파드가 `example.com/gpu` 같은 기존 extended resource 이름으로 요청해도 DRA 드라이버가 처리할 수 있어, 디바이스 플러그인에서 점진적으로 전환할 길이 생겼습니다.

드라이버마다 다른 토폴로지 속성 이름을 CEL로 맞추는 Derived Attributes(KEP-6080)는 v1.37에서 Alpha로 들어왔습니다. 실제 NIC 할당 구현체의 상태는 다음과 같습니다.

- DraNet은 Kubernetes Network Driver로 RDMA NIC을 파드에 할당한다. google/dranet에서 kubernetes-sigs/dranet으로 옮겼고, SIG Network 하위 프로젝트 이관 요청은 kubernetes/org#5979에 있다. google/dranet은 archived 상태이며, v1.5.0은 Broadcom과 Mellanox RoCE SR-IOV VF에 `dra.net/rdmaDevice` 속성을 추가했다.
- 클라우드에서는 4절의 GKE managed DRANET(`mrdma.google.com`)과 EKS EFA DRA 드라이버(DRANET)를 제공한다.
- NVIDIA GPU DRA 드라이버(k8s-dra-driver-gpu v0.5.1)는 ComputeDomain과 IMEX 중심이며 네트워크 기능은 언급하지 않는다. NIC은 별도 DRA Driver for SR-IOV(k8snetworkplumbingwg/dra-driver-sriov)가 맡는다. Network Operator 26.7에서는 Tech Preview이며 프로덕션에 권장되지 않는다.

NVIDIA SR-IOV 구성에서 DRA를 켜면 디바이스 플러그인은 실행되지 않습니다. GB300 NVL72, Vera Rubin NVL72, HGX Rubin NVL8(CX-8 이상)은 NIC-GPU 매칭용 PCIe root가 Data Direct 하위 인터페이스 쪽에 있어 아직 지원되지 않습니다. 이 드라이버에는 태그도 없습니다.

### 전환 전에 맞춰 볼 버전과 구성요소

- Network Operator 26.7은 Kubernetes 1.32~1.36, DOCA 3.5.0 GA와 3.2.2 LTS, Ubuntu 22.04/24.04/26.04, RHEL 8.8~10.2, OpenShift 4.17~4.22를 지원한다. Ubuntu generic 커널만 GA이며 aws/azure/oracle/nvidia 커널 flavor는 Tech Preview이다.
- k8s-device-plugin v0.19.0에서 v0.19.2까지는 MOFED가 기본으로 활성화돼 GPU 컨테이너에 `/dev/infiniband/uverbs*`가 전부 마운트됐다. 이 변경은 v0.19.3에서 되돌려졌고, 현재 stable은 v0.20.1이다.
- EFA 디바이스 플러그인과 EFA DRA 드라이버는 한 노드에서 함께 운용하면 안 된다. NVIDIA SR-IOV 디바이스 플러그인과 DRA SR-IOV 드라이버도 같은 클러스터에서 함께 운용할 수 없다.

이 글의 판단으로는 2026-10 기준으로 클라우드의 RDMA NIC 할당은 GKE와 EKS를 중심으로 DRA로 이동하는 중입니다. 온프렘 NVIDIA 스택에서는 shared, SR-IOV, hostdev 디바이스 플러그인이 여전히 주력으로 보이며, NIC용 DRA 드라이버는 Tech Preview 단계입니다.

## 6. 이 기능은 지금 얼마나 쓰이나

이 글의 판단으로는 2026-10 시점에 대형 학습 클러스터를 Kubernetes로 운영한다면, GPUDirect RDMA는 벤더와 클라우드가 전제로 문서화한 기본 경로입니다. 그 근거는 다음 레퍼런스에 있습니다.

- NVIDIA Network Operator 문서에는 GPUDirect 워크로드용 표준 배포 예시가 있고, overview도 GPU와 NIC 사이 GPUDirect RDMA를 AI 학습 사례로 든다.
- DGX SuperPOD와 BasePOD 문서는 Network Operator가 DOCA/OFED와 nvidia_peermem 배포를 자동화해 GPUDirect RDMA를 켠다고 설명한다. 테스트 스택은 DGX H100, DOCA OFED 3.1.0, Network Operator 25.10, GPU Operator 25.10이다.
- Spectrum-X Reference Architecture 2.3은 Network Operator 26.7로 지원된다.
- Red Hat OpenShift는 shared device, host device, SR-IOV의 RoCE와 IB 조합을 문서화한다. OpenShift AI 3.5의 RoCE 분산 추론은 Tech Preview이다.
- 매니지드 Kubernetes는 GKE(A3 Ultra 이상과 managed DRANET), EKS(EFA와 nccl-tests 확인 절차), AKS(ND H100 v5 IB), CoreWeave CKS(`rdma/ib`)가 각자의 공식 경로를 갖고 있다.
- NVIDIA는 Cloud Native Stack도 업스트림 Kubernetes에서 GPU/Network Operator를 실행하는 레퍼런스 아키텍처로 소개한다.

구현은 하나로 모이지 않았습니다. 온프렘은 Network Operator와 디바이스 플러그인(SR-IOV, hostdev, shared)을 사용하고, 클라우드는 EFA ADT나 GKE RDMA, TCPX 같은 각자의 경로와 DRANET 기반 드라이버를 제공합니다. 커널 쪽은 nvidia-peermem에서 dma-buf로 전환 중이지만, DGX SuperPOD와 Azure, OpenShift AI 예시는 여전히 peermem을 사용합니다.

회사 이름이 붙은 1차 사례는 확보하지 못했습니다. 이 글에서는 클라우드 사업자 문서가 사실상 사례 역할을 한다고 보았습니다. OpenAI의 7,500노드 글(2021-01)도 확인했으나 GPUDirect RDMA 운영 사례의 근거로 삼지는 못했습니다. 이 글은 flannel에서 네이티브 파드 네트워킹으로 옮긴 이야기입니다. 확인한 미러 본문에는 InfiniBand나 GPUDirect 언급이 없었고 원문은 403이었습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 정렬 효과 수치 | 정렬 22.2 대 비정렬 11.2 | DraNet GKE RDMA 문서 | `Ⓥ` |
| 정렬 대 비정렬 | 4워커×4GPU/4NIC, 평균 22.2173 대 11.2291 | 같은 문서 | `Ⓥ` |
| 표준 속성 | `resource.kubernetes.io/pcieRoot`(`pci<domain>:<bus>`)로 `matchAttribute` 제약 | Kubernetes DRA 표준 장치 속성 문서 | `✓` |
| DRA 코어 GA | v1.34 GA, `resource.k8s.io/v1` 기본. DraNet README는 v1.35라고 적어 어긋남 | Kubernetes v1.34 DRA 블로그 | `✓` |
| v1.37 DRA | KEP-4817 `.status.devices` Stable, KEP-5004 Extended Resource GA, KEP-6080 Derived Attributes Alpha | Kubernetes v1.37 DRA 블로그 | `✓` |
| DraNet | kubernetes-sigs/dranet 이관(org#5979), google/dranet archived, v1.5.0의 `dra.net/rdmaDevice` | DraNet 저장소와 릴리스 | `✓` |
| NVIDIA GPU DRA 드라이버 | v0.5.1, 네트워크·RDMA 기능 언급 없음 | k8s-dra-driver-gpu 릴리스 | `✓` |
| SR-IOV DRA 드라이버 | Network Operator 26.7 Tech Preview, 프로덕션 비권장, 디바이스 플러그인과 동시 운용 불가, GB300/Vera Rubin/HGX Rubin 미지원, 태그 없음 | Network Operator 문서 dra-sriov-driver | `✓` |
| 버전 매트릭스 | Kubernetes 1.32~1.36, DOCA 3.5.0/3.2.2, Ubuntu·RHEL·OpenShift 범위, 비-generic 커널은 Tech Preview | Network Operator 26.7 Platform Support | `✓` |
| device plugin 되돌림 | v0.19.3 CHANGELOG의 "revert default enablement of features mofed, gdrcopy and mofed (#1837)" | k8s-device-plugin CHANGELOG | `✓` |
| 동시 설치 금지 | EFA 플러그인과 EFA DRA, SR-IOV 플러그인과 SR-IOV DRA | AWS EKS 문서, Network Operator 문서 | `✓` |
| 클라우드는 DRA로 이동, 온프렘은 디바이스 플러그인 주력 | 위 사실을 묶은 판단 | — | `≈` |
| SR-IOV DRA의 GA 일정 | 찾지 못함 | — | `?` |
| NVIDIA 표준 배포 예시 | "Network Operator Deployment for GPUDirect Workloads", "AI Training at Scale: ... GPUDirect RDMA between GPUs and NICs" | Network Operator 문서 | `✓` |
| DGX SuperPOD 스택 | DGX H100, DOCA OFED 3.1.0, Network Operator 25.10, GPU Operator 25.10, MPI Operator 0.6.0, Base Command Manager 설치 | DGX SuperPOD 문서 | `✓` |
| Spectrum-X RA 2.3 | Network Operator 26.7(K8s 1.35+)로 지원 | Network Operator 26.7 릴리스 노트 | `✓` |
| NVIDIA Cloud Native Stack | 업스트림 Kubernetes에서 GPU/Network Operator를 돌리는 레퍼런스 아키텍처 | NVIDIA EGX stack 페이지 | `Ⓥ` |
| OpenShift | shared device·host device·SR-IOV legacy × RoCE/IB 문서. OpenShift AI 3.5 llm-d RoCE GDR은 Tech Preview | Red Hat 문서 | `✓` |
| 매니지드 Kubernetes의 공식 경로 | GKE, EKS, AKS, CoreWeave CKS | 4절의 각 문서 | `✓` |
| OpenAI 글 | 미러 본문에 InfiniBand/GPUDirect 언급 없음, 원문 403 | OpenAI 블로그 | `?` |
| 회사명이 붙은 1차 사례 | 확보하지 못함 | — | `?` |
| 선택 기능이 아닌 기본 경로, 구현 미수렴 | 위 사실을 종합한 판단 | — | `Σ` |

{{% /details %}}

## 7. 확인하지 못한 것

- NVIDIA가 공식 문서로 낸 DGX H100 노드 간 nccl-tests 기준 busbw. Crusoe와 SkyPilot 같은 사업자 값만 확보했습니다.
- GKE TCPX/TCPXO가 RDMA인지 여부. GKE 문서가 명시하지 않습니다.
- GKE managed DRANET의 GA 공지 원문. 검색 요약에서만 2026-04, 1.35.2-gke.1842000을 봤습니다.
- p5en의 EFA 개수와 대역폭. EC2 문서의 해당 절이 이번 조사 페이지에 없었습니다.
- OCI OKE와 Lambda의 Kubernetes GPUDirect RDMA 공식 문서
- NVIDIA DRA SR-IOV 드라이버의 GA 일정
- 회사 이름이 있는 Kubernetes GPUDirect RDMA 운영 사례의 1차 출처
- Azure 가이드 주석에서 IPC_LOCK을 추가하면 `ulimit -l`이 unlimited가 된다는 설명. 커널은 limit을 무시할 뿐이고 표시값은 런타임 설정에 달린다고 추정합니다.

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
