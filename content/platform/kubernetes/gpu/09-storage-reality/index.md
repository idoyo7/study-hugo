---
title: "09 스토리지 — 학습·추론의 GDS 활용과 패브릭 분리"
description: "2026-10-21 기준 학습과 추론의 실제 데이터 경로에서 GDS가 어디에 선택적으로 쓰이는지 살펴본다. 프레임워크 기본값과 지원 범위, 스토리지 패브릭 구성을 바탕으로 GDS가 가치 있는 조건과 도입 후 점검할 항목을 설명한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 9
url: "/kubernetes/gpu/09-storage-reality/"
---

# 09 · 스토리지 — 학습·추론의 GDS 활용과 패브릭 분리

## 1. GDS를 켜기 전에 애플리케이션의 I/O를 본다 {#1-gds를-검토할-자리는-애플리케이션이-정한다}

노드가 GDS(GPUDirect Storage)를 지원해도 학습 프레임워크가 데이터를 CPU 메모리에 받아 처리한다면 GPU로 바로 읽는 경로를 쓰지 않습니다. [08편]({{< relref "/platform/kubernetes/gpu/08-storage-gds-nvmeof/index.md" >}})의 드라이버·파일시스템 조건을 갖춘 뒤에는 데이터셋 리더, 체크포인트 writer, 추론 로더와 KV 캐시가 각각 어떤 API와 메모리를 사용하는지 확인해야 합니다.

2026-10-21에 확인한 PyTorch 2.14, Dynamo 1.5, vLLM 0.32, LMCache 0.5, NIXL 1.5의 문서와 소스에서는 GDS가 선택 기능으로 남아 있는 경우가 많았습니다. 이것만으로 전체 도입률을 판단할 수는 없습니다. 지원 기능과 기본값을 구분해서 읽어야 하는 이유입니다.

RDMA와 파드의 NIC 할당은 [06편]({{< relref "/platform/kubernetes/gpu/06-gpudirect-rdma-basics/index.md" >}})·[07편]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}}), InfiniBand와 RoCE의 선택·운영은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})·[11편]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}})에 있습니다.

## 2. 학습 데이터 리더가 GPU 직접 전송을 지원하는가 {#3-gpu로-바로-읽으려면-리더와-스토리지가-맞아야-한다}

학습 데이터를 S3에서 읽는 경로부터 보면, `s3-connector-for-pytorch` v1.5.0(2026-02-20)은 객체 전체를 호스트 메모리에 내려받아 버퍼링합니다. `S3Checkpoint`와 PyTorch 2.3 이상에서 쓰는 DCP용 `S3StorageWriter`·`S3StorageReader`도 이 커넥터를 사용합니다. 저장소에는 GPU 직접 전송 경로가 언급되지 않습니다.

GPU로 바로 읽는 리더에는 별도의 지원 조건이 있습니다. NVIDIA DALI의 `fn.readers.numpy` GPU 백엔드는 cuFile/GDS를 요구합니다. `DALI_GDS_CHUNK_SIZE`의 범위는 4096~16M, 기본값은 2M이며 `use_o_direct` 옵션이 있습니다. KvikIO v26.10.00(2026-10-07)은 4096바이트 배수 오프셋에 정렬된 읽기에서만 GDS를 사용한다고 문서화합니다.

스토리지와 리더 사이의 캐시도 경로에 영향을 줍니다. GDS 1.19.1의 지원 파일시스템 목록에는 FUSE가 없습니다. 이 목록을 Alluxio나 JuiceFS 같은 FUSE 캐시에 적용하면 직접 경로 대신 호환 모드나 일반 경로를 쓰게 된다는 해석입니다. 두 프로젝트의 GDS 관련 공식 입장은 확인하지 못했으므로, 지원 목록에서 이끌어 낸 판단과 제품별 검증 결과를 구분해야 합니다.

오브젝트 스토리지에도 GPU 직접 전송을 위한 cuObject 경로가 생겼습니다. NVIDIA 문서 v1.3.1(갱신 2026-10-02)은 2026-01부터 S3 호환 스토리지에 RDMA 데이터 경로를 제공한다고 설명합니다. 파트너 S3 SDK의 표준 GET·PUT이 제어를 맡고, 페이로드는 스토리지 노드와 GPU 메모리 사이에서 RDMA로 전송합니다. CUDA 13.1.1 이상과 InfiniBand 또는 RoCEv2의 DC 전송을 사용합니다.

cuObject는 클라이언트 S3 SDK와 서버 스토리지 소프트웨어를 모두 수정해야 합니다. 기존 S3 커넥터에 GDS 설정 하나를 더하는 구성으로 볼 수 없으며, 문서가 제시한 통합 조건을 충족해야 하는 신생 경로입니다. 스토리지 종류별 I/O 패턴은 [GPU 클러스터 스토리지]({{< relref "/data/gpu-storage/_index.md" >}}) 시리즈에서 비교합니다.

## 3. 체크포인트의 CPU staging과 순간 쓰기 부하 {#2-체크포인트는-cpu에-내려놓고-저장한다}

학습 결과를 저장할 때는 GPU 메모리의 state_dict를 어디에 임시로 옮기는지 봐야 합니다. PyTorch Distributed Checkpoint(DCP)의 `async_save`는 staging storage에 데이터를 내려놓은 뒤 백그라운드에서 저장하며, staging의 기본 위치는 CPU 메모리입니다. `StagingOptions.use_pinned_memory`로 pinned memory를 사용할 수 있고 기본 `FileSystemWriter`는 일반 파일 I/O를 사용합니다.

확인한 DCP 문서 앞부분에서는 GDS·cuFile 기반 writer를 보지 못했습니다. 문서 후반까지 확인한 것은 아니므로 기능 부재로 단정할 수는 없습니다. CPU에 staging한 뒤 저장하는 기본 경로는 GPU 메모리에서 직접 전송하는 GDS와 다른 방식의 최적화로 해석됩니다. PyTorch 자체에는 2.7에서 도입한 `torch.cuda.gds`가 있으며, `is_available`, `gds_register_buffer`, `gds_deregister_buffer`, `GdsFile`을 제공합니다. 2.14에서도 prototype으로 표시됩니다.

대규모 체크포인트가 스토리지에 주는 부하는 Meta의 Llama 3 논문에서 확인할 수 있습니다. 최대 16K H100을 사용한 학습에서 GPU당 체크포인트는 1 MB~4 GB였습니다. Tectonic은 SSD 서버 7,500대로 240 PB를 제공하고, 처리량은 지속 2 TB/s·피크 7 TB/s였습니다. 논문은 부하를 "highly bursty checkpoint writes that saturate the storage fabric for short durations"라고 설명합니다. 짧은 시간에 쓰기가 몰려 스토리지 패브릭을 포화시킨다는 뜻입니다. GDS 사용 여부와 스토리지 트래픽의 패브릭 분리는 언급되지 않습니다.

HPCwire 보도에 따르면 MLPerf Storage v2.0은 2025-08에 체크포인트 워크로드를 추가했습니다. Argonne Aurora의 DAOS는 서버 128대에서 쓰기 약 1 TB/s·읽기 600 GB/s를 냈고, LLaMA3-405B 체크포인트를 10초 내 저장했다고 합니다. 이는 보도로 전달된 결과이며 제출 자료의 GDS 사용 표시 여부는 확인하지 못했습니다.

확인한 리더와 writer를 종합하면 데이터셋을 CPU 메모리에 받고 체크포인트를 CPU에 staging하는 경로가 기본으로 보입니다. GDS는 병렬 파일시스템 벤더 클라이언트, DALI numpy 리더, KvikIO처럼 직접 경로를 지원하는 곳에서 선택적으로 사용된다는 판단입니다. 중립적인 GDS 도입률 자료를 찾지 못했으므로 이 판단을 시장 전체의 사용 비율로 확대하지는 않습니다.

## 4. 추론에서는 가중치 로딩과 KV 캐시를 구분한다 {#4-추론은-가중치-로더와-kv-캐시를-따로-봐야-한다}

모델 가중치를 한 번 읽는 일과 추론 중 KV 캐시를 여러 계층 사이에 옮기는 일은 서로 다른 경로를 사용합니다. 같은 엔진에 GDS 기능이 있어도 어느 경로에, 어떤 기본값으로 적용되는지 확인해야 합니다.

### 가중치 로더의 벤치마크와 vLLM 설정

vLLM v0.32.0(2026-10-18)의 load format에는 `fastsafetensors`, `instanttensor`, `runai_streamer`, `tensorizer`, `modelexpress`, 새로 추가된 `ipc_cache` 등이 있습니다. 이 중 fastsafetensors를 쓰는 코드는 `nogds = pg.size() > 1`로 텐서 병렬(TP)이 둘 이상이면 GDS를 끕니다. `cuFileDriverOpen()`이 보이는 모든 GPU에 CUDA 컨텍스트를 만들기 때문입니다. GDS 오류가 나면 첫 텐서를 내보내기 전까지 nogds로 재시도합니다.

fastsafetensors README는 Llama-70B를 GPU 4개에서 GDS로 읽을 때 NVMe 읽기 26.4 GB/s, 기본 safetensors 대비 4.8~7.5배 성능을 주장합니다. 이 수치는 벤더 측 벤치마크입니다. vLLM의 TP>1 조건에서는 GDS가 꺼지므로 해당 결과를 그 설정의 기대 성능으로 가져올 수는 없습니다.

### KV 캐시의 디스크 계층과 GPU 메모리 비용

NVIDIA Dynamo의 조사 당시 latest stable은 v1.5.1(2026-10-07)이며, 아래 설정은 v1.5.0 KVBM 구성 문서 기준입니다. KV 블록 매니저는 G1 GPU, G2 호스트 메모리, G3 디스크, G4 오브젝트 스토리지를 사용합니다. `DYN_KVBM_DISK_CACHE_GB`로 디스크 계층을 켜고 `DYN_KVBM_DISK_CACHE_DIR`로 경로를 정합니다. O_DIRECT를 쓸 수 없을 때는 `DYN_KVBM_DISK_DISABLE_O_DIRECT`를 사용합니다.

디스크를 켜는 것과 GDS를 켜는 설정은 별개입니다. TOML의 `[cache.disk] use_gds = true` 또는 환경변수 `KVBM_CACHE_DISK_USE_GDS`가 GDS를 선택하며 기본값은 false입니다. NIXL 기본 백엔드는 UCX와 POSIX입니다. G4의 뜻도 버전에 따라 달라 v1.2 설계 문서는 NFS·Lustre·GPFS 같은 원격 디스크를, v1.5 구성 문서는 S3 호환 오브젝트 스토리지를 설명합니다.

LMCache v0.5.6(2026-10-14)의 GDS 백엔드는 로컬 NVMe를 사용합니다. `gds_path`에 여러 NVMe 경로를 쉼표로 지정할 수 있고 `by_gpu` 샤딩도 지원합니다. `gds_buffer_size`의 단위는 MiB이며, 지정한 크기만큼 VRAM에 버퍼를 등록합니다. 문서는 `local_cpu: false`를 권장합니다. GPU 메모리를 버퍼가 차지하므로 vLLM의 `--gpu-memory-utilization`도 낮춰야 합니다. 예시는 H100 80GiB에 버퍼 8GiB와 활용률 0.85입니다.

LMCache 문서는 일부 libcufile 버전이 백엔드에 알리지 않고 POSIX로 폴백할 수 있다고 경고합니다. `use_gds: false`는 POSIX를 강제하는 옵션입니다. 성능 설명의 PCIe Gen4 x4 NVMe 약 7 GB/s, 네 개 약 28 GB/s는 측정값이 아니라 대역폭을 더한 계산입니다. 이 문서의 in-process 모드는 deprecated이며 MP 모드가 권장됩니다.

### NIXL의 스토리지 I/O와 GPU 간 KV 전송

NIXL v1.5.0(2026-09-30)은 vLLM·SGLang·Dynamo에 통합된 전송 계층입니다. IIT 논문도 "integrated into most popular inference engines"라고 서술합니다. 지원 플러그인은 `ucx`, `cuda_gds`(GDS·GDS_MT), `posix`, `obj`, `azure_blob`, `hf3fs`, `mooncake`, `gpunetio`, `libfabric`, `uccl`, `gusli`, `infinia`, `redis`입니다.

스토리지의 GDS는 이 중 `cuda_gds` 백엔드에 해당합니다. 기본은 cuFile batch이며 `mode=mt`로 멀티스레드를 선택합니다. `GDS_MT`라는 이름은 폐지 예정입니다. prefill에서 decode로 보내는 GPU 간 KV 전송은 UCX 위의 RDMA가 기본이고, NIXL 저장소는 GDRCopy가 있으면 최대 성능을 낼 수 있다고 설명합니다. GPU 간 전송이 RDMA를 사용한다는 사실만으로 디스크 I/O에도 GDS가 켜졌다고 볼 수는 없습니다.

최근 1년 동안 공개된 KV 오프로드 계층은 CPU에서 로컬 NVMe, 원격 파일시스템, 오브젝트 스토리지로 넓어졌고 cuObject RDMA 경로도 생겼습니다. 그러나 KVBM의 기본 false, vLLM의 TP>1 nogds, LMCache의 폴백 경고를 보면 GDS는 여전히 선택 옵션으로 쓰이는 경우가 많다는 해석이 가능합니다.

## 5. 스토리지 트래픽을 어느 패브릭에 보낼 것인가 {#5-스토리지와-집합통신이-패브릭을-나누는-방식}

애플리케이션의 RDMA 스토리지 경로를 정했다면 NCCL 집합통신과 네트워크를 공유하는지도 확인해야 합니다. 공개 자료에서는 독립된 스토리지 패브릭, 용도가 분리된 NIC, 같은 EFA 장치나 패브릭을 공유하는 것으로 보이는 구성을 찾을 수 있습니다.

NVIDIA DGX SuperPOD는 Compute, Storage, In-band, Out-of-band를 구분하고 스토리지 패브릭을 컴퓨트 패브릭과 독립적으로 구성합니다. 스토리지에는 InfiniBand(RDMA)나 RoCE를 사용합니다. H100·B200·B300의 Key Components 페이지에서 독립 구성이라는 설명을 확인했지만, 일부는 검색 스니펫이었고 본문을 직접 대조한 것은 B300 network-fabrics 페이지입니다.

I/O 요구량에는 문서 내부의 차이가 남아 있습니다. B300 XDR 페이지는 노드 I/O가 80 GBps를 넘어야 한다고 쓰면서 다른 절에서는 SU당으로 적습니다. H100·B200 세대의 요구량은 노드당 최소 40 GBps였습니다. B300의 단위를 임의로 하나로 맞추면 안 됩니다.

GCP는 NIC 용도를 명시적으로 나눕니다. A4·A3 Ultra의 ConnectX-7 8개(3,200 Gbps)는 GPU 간 통신 전용이며 다른 네트워크 용도로 사용할 수 없습니다. 일반 트래픽은 gVNIC 2개(400 Gbps)가 맡습니다. A4X는 ConnectX-7 4개(1,600 Gbps, RoCE)가 GPU 전용이고 Titanium NIC 2개(400 Gbps)가 스토리지·관리·외부 트래픽을 처리합니다.

AWS FSx for Lustre 가이드는 EFA 인터페이스를 `lnetctl net add --net efa`로 Lustre LNet에 연결합니다. p5의 기본 EFA 인터페이스는 8개입니다. NCCL도 같은 종류의 장치를 쓰므로 이 구성에서는 스토리지와 집합통신이 EFA 장치나 패브릭을 공유하는 것으로 보입니다. AWS 문서는 경합과 QoS를 설명하지 않으며 이를 다룬 공식 가이드도 찾지 못했습니다. 공유 여부는 이 자료에서 이끌어 낸 추정입니다.

{{< flow src="_flow/4-패브릭-분리.json" />}}

따라서 온프레미스 레퍼런스와 GCP는 분리, AWS FSx·EFA는 공유로 보인다는 정리에도 문서 확인 범위의 차이가 있습니다. Meta의 Llama 3 논문은 RoCE 클러스터를 설명하지만 스토리지 트래픽의 분리 여부는 밝히지 않습니다.

RoCE 패브릭을 공유한다면 최소한 스토리지와 집합통신의 트래픽 클래스를 나누는 구성을 검토해야 합니다. Mayastor의 `transportTos`는 RDMA 패킷에 DSCP 값을 지정합니다. 차트 values.yaml 주석은 공유 패브릭에서 스토리지 트래픽을 별도 PFC 큐로 분류하는 용도라고 설명합니다. 스위치·NIC의 세부 설정은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})에서 이어집니다.

## 6. 적용할 워크로드를 고르고 실제 전송을 점검한다 {#6-gds와-nvme-of-rdma의-지원-범위이득점검-순서}

확인한 기본값과 제약을 종합하면 GDS와 NVMe-oF RDMA는 워크로드별로 선택하는 편에 근거가 더 많습니다. 특히 다음 조건에서는 GDS를 검토할 이유가 있습니다. 이는 문서들을 종합한 판단이며 보편적인 성능 보장은 아닙니다.

- Lustre/EXAScaler, GPFS, WekaFS, BeeGFS 같은 병렬 파일시스템이나 NFS over RDMA가 이미 RDMA 스토리지 패브릭 위에 있고 벤더가 GDS 클라이언트를 지원합니다. AWS의 FSx for Lustre와 P5 이상 EFA 조합도 여기에 해당합니다.
- 추론 노드의 로컬 NVMe를 KV 캐시 계층으로 사용하며 cuFile 버퍼를 둘 GPU 메모리가 남아 있습니다.
- 데이터 로딩이 GPU 파이프라인으로 끝나고 I/O가 크고 정렬돼 있습니다.

지원 범위는 애플리케이션의 요구와 따로 대조합니다. GPU Operator 26.7의 공식 GDS 스토리지는 로컬 NVMe와 NFS이며, 플랫폼 지원표는 Ubuntu·OpenShift를 포함하고 RHEL과 secure boot는 포함하지 않습니다. 업스트림 P2PDMA는 x86_64 로컬 NVMe 경로입니다. NVMe-oF와 GDS를 결합하려면 DOCA `mlnx-nvme` 아웃오브트리 모듈이 필요합니다.

성능을 평가할 때는 읽기와 쓰기를 나눠 측정해야 합니다. IIT의 제한된 측정에서는 큰 쓰기가 CPU 경로에서 더 빨랐고 배치·비동기 API는 이득이 없거나 손해였습니다. NVIDIA GDS 개요 가이드도 큰 순차 스트리밍과 GPU 파이프라인을 이득을 얻는 조건으로 설명합니다. 노드 안 PCIe 경로의 영향은 [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}})을 참고할 수 있습니다.

NVMe-oF RDMA의 Target 측 CPU 효율은 또 다른 평가 항목입니다. SPDK 24.05의 4KiB 랜덤 읽기에서 RDMA는 약 8코어로 포화했고 TCP는 24~32코어를 사용했습니다. QD가 달라 경향 비교에 그칩니다. Kubernetes 블록 CSI의 RDMA 공식 지원은 조사 범위상 Mayastor와 Portworx/FlashArray 정도였고 대부분은 NVMe/TCP를 기본으로 제시했습니다. RoCE를 선택하면 PFC와 DSCP 등 무손실 패브릭 설정도 준비해야 합니다.

마지막 확인은 설치 성공보다 실제 I/O 경로에 둡니다. cuFile의 `allow_compat_mode`는 기본 true라 POSIX로 전환될 수 있습니다.

1. 노드의 오픈 커널 모듈 드라이버와 secure boot off를 확인합니다. DOCA-OFED는 nvidia-fs 또는 NVMe-oF를 사용하는 등 선택한 전송 경로가 요구하는 경우에 점검합니다. 로컬 NVMe의 업스트림 P2PDMA 경로는 nvidia-fs와 MOFED의 NVMe 패치가 필요하지 않으며, IOMMU pt 또는 off 조건을 확인해야 합니다.
2. GPU Operator의 `gds.enabled=true`를 확인하고 데이터를 GDS 지원 파일시스템으로 마운트합니다. overlayfs, ZFS, btrfs는 호환 모드 대상입니다. FUSE도 앞서 살핀 지원 목록에 근거하면 직접 경로가 성립하지 않는 것으로 해석됩니다.
3. `gdscheck -p`의 `NVMe`, `NVMeOF`, `NVMe P2PDMA` 줄을 읽고, `cufile.log`의 `cufile IO mode: POSIX`와 gdsio 처리량을 함께 확인합니다. 설정을 켰다는 사실만으로 직접 전송을 판정하지 않습니다.

## 7. 확인하지 못한 것

- MLPerf Storage 제출 결과에서 GDS 사용 비율, 2026 라운드 존재 여부.
- GDS 채택률에 관한 벤더 외 서베이나 운영 사례. EKS, GKE, 온프레미스 Kubernetes 어디에서도 찾지 못했습니다. 검색에 잡힌 "Meta 3.8배" 같은 채택 수치는 1차 출처를 추적할 수 없어 제외했습니다.
- Alluxio와 JuiceFS의 GDS 관련 공식 입장.
- PyTorch DCP 문서 후반부의 GDS 관련 언급 여부. 앞쪽 일부만 확인했습니다.
- AWS에서 FSx for Lustre의 EFA 트래픽과 NCCL 트래픽의 경합을 다루는 공식 가이드.
- DGX SuperPOD B300 Key Components 페이지의 스토리지 패브릭 독립 문장 원문. 검색 스니펫으로만 확인했습니다.

## 참고 자료

- [The Llama 3 Herd of Models](https://arxiv.org/html/2407.21783v3)
- [PyTorch Distributed Checkpoint 2.14](https://docs.pytorch.org/docs/2.14/distributed.checkpoint.html)
- [PyTorch CUDA 문서 2.14 (torch.cuda.gds)](https://docs.pytorch.org/docs/2.14/cuda.html)
- [s3-connector-for-pytorch](https://github.com/awslabs/s3-connector-for-pytorch)
- [NVIDIA DALI readers.numpy](https://docs.nvidia.com/deeplearning/dali/user-guide/docs/operations/nvidia.dali.fn.readers.numpy.html)
- [NVIDIA KvikIO 문서](https://docs.nvidia.com/kvikio/latest/python/)
- [NVIDIA cuObject](https://docs.nvidia.com/gpudirect-storage/cuobject)
- [MLPerf Storage v2.0 결과 (HPCwire)](https://www.hpcwire.com/aiwire/2025/08/05/mlperf-storage-v2-0-results-highlight-storages-role-in-ai-training-at-scale/)
- [NIXL](https://github.com/ai-dynamo/nixl)
- [NIXL cuda_gds 플러그인](https://github.com/ai-dynamo/nixl/blob/main/src/plugins/cuda_gds/README.md)
- [Dynamo KVBM 구성 (v1.5.0)](https://docs.nvidia.com/dynamo/v1.5.0/reference/components/kvbm-configuration.md)
- [LMCache GDS 백엔드](https://docs.lmcache.ai/kv_cache/storage_backends/gds.html)
- [vLLM load.py (v0.32.0)](https://github.com/vllm-project/vllm/blob/v0.32.0/vllm/config/load.py)
- [vLLM weight_utils.py (v0.32.0)](https://github.com/vllm-project/vllm/blob/v0.32.0/vllm/model_executor/model_loader/weight_utils.py)
- [fastsafetensors](https://github.com/foundation-model-stack/fastsafetensors)
- [Insights into GPUDirect Data Transfer through NIXL Benchmarking (IIT, 2025)](http://cs.iit.edu/~scs/assets/files/muradli2025gpudirect.pdf)
- [NVIDIA DGX SuperPOD 네트워크 패브릭 (B300 XDR)](https://docs.nvidia.com/dgx-superpod/reference-architecture/scalable-infrastructure-b300-xdr/latest/network-fabrics.html)
- [NVIDIA DGX SuperPOD 구성요소 (B300 XDR)](https://docs.nvidia.com/dgx-superpod/reference-architecture/scalable-infrastructure-b300-xdr/latest/dgx-superpod-components.html)
- [GCP GPU 네트워크 대역폭](https://docs.cloud.google.com/compute/docs/gpus/gpu-network-bandwidth)
- [AWS FSx for Lustre EFA 클라이언트 구성](https://docs.aws.amazon.com/fsx/latest/LustreGuide/configure-efa-clients.html)
- [Mayastor 차트 values.yaml](https://github.com/openebs/mayastor-extensions/blob/v2.12.2/chart/values.yaml)
- [SPDK NVMe-oF RDMA 성능 보고서 24.05](https://review.spdk.io/download/performance-reports/SPDK_rdma_mlx_perf_report_2405.pdf)
- [SPDK NVMe-oF TCP 성능 보고서 24.05](https://review.spdk.io/download/performance-reports/SPDK_tcp_mlx_perf_report_2405.pdf)
- [NVIDIA GDS 릴리스 노트](https://docs.nvidia.com/gpudirect-storage/release-notes/index.html)
- [NVIDIA GDS 구성 가이드](https://docs.nvidia.com/gpudirect-storage/configuration-guide/index.html)
- [NVIDIA GDS 트러블슈팅 가이드](https://docs.nvidia.com/gpudirect-storage/troubleshooting-guide/index.html)
- [GDS support for NVMe (P2PDMA)](https://docs.nvidia.com/deploy/gds-support-for-nvme/intro.html)
- [GPU Operator RDMA 문서](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-operator-rdma.html)
- [GPU Operator 플랫폼 지원](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/platform-support.html)
