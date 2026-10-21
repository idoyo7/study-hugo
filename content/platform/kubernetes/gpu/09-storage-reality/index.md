---
title: "09 스토리지 — 학습·추론의 GDS 활용과 패브릭 분리"
description: "2026-10-21 기준 학습과 추론의 실제 데이터 경로에서 GDS가 어디에 선택적으로 쓰이는지 살펴본다. 프레임워크 기본값과 지원 범위, 스토리지 패브릭 구성을 바탕으로 GDS가 가치 있는 조건과 도입 후 점검할 항목을 설명한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 9
url: "/kubernetes/gpu/09-storage-reality/"
---

# 09 · 스토리지 — 학습·추론의 GDS 활용과 패브릭 분리

## 1. GDS를 검토할 자리는 애플리케이션이 정한다

GPU 클러스터에 CPU를 우회하는 스토리지 경로를 마련해도 애플리케이션이 그 경로를 쓴다는 보장은 없습니다. [08편]({{< relref "/platform/kubernetes/gpu/08-storage-gds-nvmeof/index.md" >}})에서 살펴본 기술적 조건을 갖췄다면, 이제 학습과 추론이 데이터를 실제로 어디에 내려놓고 어디에서 읽는지 봐야 합니다.

GDS(GPUDirect Storage)와 NVMe-oF RDMA를 클러스터의 기본 구성으로 둘지 판단할 때, 이 글의 판단으로는 특정 워크로드에 맞춰 선택하는 쪽의 근거가 더 많습니다. 가치가 생길 만한 조건은 다음과 같습니다.

- Lustre/EXAScaler, GPFS, WekaFS, BeeGFS 같은 병렬 파일시스템이나 NFS over RDMA가 이미 RDMA 스토리지 패브릭 위에 있고, 벤더가 GDS 클라이언트를 지원할 때. AWS라면 FSx for Lustre와 P5 이상의 EFA 조합이 해당합니다.
- 추론 노드의 로컬 NVMe를 KV 캐시 계층으로 쓰고, GPU 메모리 여유로 cuFile 버퍼를 감당할 수 있을 때.
- 데이터 로딩이 GPU 파이프라인으로 끝나고 I/O가 크고 정렬되어 있을 때.

각 조건의 근거는 2~6절에 있습니다.

RDMA 자체와 파드에 NIC을 주는 방법은 [06편]({{< relref "/platform/kubernetes/gpu/06-gpudirect-rdma-basics/index.md" >}})과 [07편]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}}), 패브릭의 InfiniBand와 RoCE 선택은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})과 [11편]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}})에서 이어집니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-21이며 PyTorch 2.14, Dynamo 1.5, vLLM 0.32, LMCache 0.5, NIXL 1.5 문서와 소스를 봤습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 조건부 판단 | 위 근거를 종합했을 때 특정 조건에서만 가치가 있다는 쪽이 우세 | — | `Σ` |
| 가치가 생기는 조건 | 병렬 파일시스템·NFS over RDMA 위, 추론 로컬 NVMe의 KV 계층, GPU 파이프라인 로딩 | — | `≈` |

{{% /details %}}

## 2. 체크포인트는 CPU에 내려놓고 저장한다

PyTorch의 기본 비동기 체크포인트 경로는 CPU 메모리를 거칩니다. Distributed Checkpoint(DCP)의 `async_save`는 state_dict를 staging storage에 내려놓은 뒤 백그라운드에서 저장합니다. 저장 전에 데이터를 임시로 두는 staging의 기본 위치가 CPU 메모리입니다. `StagingOptions.use_pinned_memory`로 pinned memory를 쓸 수 있으며, 기본 `FileSystemWriter`는 일반 파일 I/O를 사용합니다.

문서 앞쪽 일부만 확인했지만 GDS·cuFile 기반 writer는 보지 못했습니다. GPU에서 CPU로 복사한 뒤 저장하는 이 방식은 GDS의 직접 경로와 반대 방향의 최적화로 보입니다. PyTorch에 GDS API가 없는 것은 아닙니다. `torch.cuda.gds`는 2.7에서 도입됐고, 2.14에서도 prototype으로 표시됩니다.

실제 대규모 학습에서 체크포인트가 만드는 부하는 Meta의 Llama 3 논문에 구체적으로 나옵니다. 학습 스토리지는 범용 분산 파일시스템 Tectonic이며, SSD 서버 7,500대가 240 PB 용량과 지속 2 TB/s·피크 7 TB/s 처리량을 제공합니다. 최대 16K H100으로 학습했고 GPU당 체크포인트 크기는 1 MB에서 4 GB였습니다.

논문은 이 부하를 "highly bursty checkpoint writes that saturate the storage fabric for short durations"라고 설명합니다. 짧은 시간에 스토리지 패브릭을 포화시키는 쓰기라는 뜻입니다. GDS 사용이나 스토리지 트래픽의 패브릭 분리는 논문에 언급되지 않습니다.

체크포인트 성능을 다루는 자료로는 MLPerf Storage도 있습니다. HPCwire는 MLPerf Storage v2.0이 2025-08에 체크포인트 워크로드를 추가했으며, Argonne Aurora의 DAOS가 서버 128대로 쓰기 약 1 TB/s를 냈다고 보도했습니다. 제출 결과에 GDS 사용 여부가 표시되는지는 확인하지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| PyTorch | 문서 2.14. `torch.cuda.gds`는 여전히 prototype | PyTorch 문서 | `✓` |
| DCP `async_save` | staging 기본값 CPU 메모리, `StagingOptions.use_pinned_memory` 가능, 기본 `FileSystemWriter`는 일반 파일 I/O. GDS·cuFile writer는 보지 못함(문서 앞쪽 일부만 확인) | PyTorch DCP 문서 | `✓` (일부 확인) |
| 주류 체크포인트와 GDS의 방향 | GPU에서 CPU 복사 후 쓰는 구조는 GDS 직접 경로와 반대 방향 | — | `≈` |
| `torch.cuda.gds` | `is_available`, `gds_register_buffer`, `gds_deregister_buffer`, `GdsFile`. 2.7 도입, 2.14에서도 prototype | PyTorch CUDA 문서 | `✓` |
| Llama 3 학습 스토리지 | Tectonic, SSD 서버 7,500대, 240 PB, 지속 2 TB/s·피크 7 TB/s | Llama 3 논문 | `✓` |
| 체크포인트 부하 | 원문 "highly bursty checkpoint writes that saturate the storage fabric for short durations". GPU당 1 MB~4 GB, 최대 16K H100 | Llama 3 논문 | `✓` |
| 논문이 다루지 않은 것 | GDS와 스토리지 패브릭 분리는 언급 없음 | Llama 3 논문 | `✓` (부재) |
| MLPerf Storage v2.0 | 2025-08 체크포인트 워크로드 추가. Aurora DAOS 서버 128대, 쓰기 약 1 TB/s·읽기 600 GB/s, LLaMA3-405B 체크포인트 10초 내 저장. GDS 사용 표시 여부 미확인 | HPCwire 보도 | `Ⓥ` |
| GDS 도입률의 중립 근거 | 찾지 못함. 추적 불가능한 수치는 제외 | — | `?` |

{{% /details %}}

## 3. GPU로 바로 읽으려면 리더와 스토리지가 맞아야 한다

학습 데이터를 읽을 때도 CPU 메모리를 거치는 경로를 만납니다. `s3-connector-for-pytorch` v1.5.0은 S3 객체 전체를 호스트 메모리로 내려받아 버퍼링합니다. DCP용 `S3StorageWriter`와 `S3StorageReader`도 이 커넥터 위에서 동작합니다.

GDS를 쓰는 리더는 조건이 명확합니다. NVIDIA DALI의 `fn.readers.numpy` GPU 백엔드는 cuFile을 요구합니다. KvikIO는 4096바이트 배수 오프셋에 정렬된 읽기에서만 GDS를 사용합니다.

중간에 캐시 계층을 두는 경우도 살펴봐야 합니다. GDS 지원 파일시스템 목록에는 FUSE가 없습니다. 이 목록을 Alluxio나 JuiceFS 같은 FUSE 캐시 계층에 적용하면, GDS 직접 경로 대신 호환 모드나 일반 경로를 쓰게 되는 것으로 보입니다.

오브젝트 스토리지에는 cuObject라는 새 경로가 생겼습니다. NVIDIA 문서에 따르면 cuObject는 2026-01부터 S3 호환 스토리지에 RDMA 데이터 경로를 제공합니다. 파트너 S3 SDK의 표준 GET과 PUT이 제어를 맡고, 페이로드는 스토리지 노드와 GPU 메모리 사이에서 RDMA로 오갑니다. CUDA 13.1.1 이상이 필요하며 InfiniBand나 RoCEv2의 DC 전송을 사용합니다.

cuObject를 적용하려면 클라이언트 S3 SDK와 서버 스토리지 소프트웨어를 모두 수정해야 합니다. 문서가 명시한 통합 조건이며, 아직 적용 범위가 좁은 신생 경로입니다.

확인한 학습 경로를 종합하면, 데이터셋 읽기는 S3 호환 오브젝트 스토리지나 병렬 파일시스템에서 CPU 메모리로 받고 체크포인트는 CPU에 staging한 뒤 저장하는 방식이 기본으로 보입니다. GDS는 병렬 파일시스템 벤더 클라이언트, DALI numpy 리더, KvikIO처럼 직접 경로를 지원하는 곳에서 선택적으로 쓰이는 것으로 보입니다.

스토리지 종류별 I/O 패턴과 선택 기준은 [GPU 클러스터 스토리지]({{< relref "/data/gpu-storage/_index.md" >}}) 시리즈에 있습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| s3-connector-for-pytorch | v1.5.0(2026-02-20) | 저장소 릴리스 | `✓` |
| s3-connector-for-pytorch | 객체 전체를 호스트 메모리에 버퍼링. `S3Checkpoint`와 DCP용 `S3StorageWriter`·`S3StorageReader`(PyTorch 2.3 이상). GPU 직접 경로 언급 없음 | s3-connector-for-pytorch 저장소 | `✓` |
| DALI numpy 리더 | GPU 백엔드는 cuFile/GDS 요구, `DALI_GDS_CHUNK_SIZE` 4096~16M 기본 2M, `use_o_direct` 옵션 | NVIDIA DALI 문서 | `✓` |
| KvikIO | v26.10.00(2026-10-07) | KvikIO 릴리스 | `✓` |
| KvikIO | 4096바이트 배수 오프셋의 정렬된 읽기에서만 GDS 사용 | KvikIO 문서 | `✓` |
| FUSE 캐시와 GDS | GDS 지원 목록에 FUSE 없음. 직접 경로가 성립하지 않는다는 해석 | GDS 1.19.1 릴리스 노트 | `✓` (목록), `≈` (적용) |
| Alluxio·JuiceFS의 GDS 공식 입장 | 확인하지 못함 | — | `?` |
| cuObject(S3 over RDMA) | 문서 v1.3.1(갱신 2026-10-02) | NVIDIA cuObject 문서 | `✓` |
| cuObject | CUDA 13.1.1 이상, DC 전송(IB·RoCEv2). 제어는 S3 SDK, 페이로드는 RDMA. 클라이언트 SDK와 서버 소프트웨어 양쪽 수정 필요 | NVIDIA cuObject 문서 | `✓` |
| 주류 경로가 GDS 밖 | S3 커넥터·FUSE 캐시·DCP async는 CPU 메모리 경유. cuObject는 2026년 신생이고 양쪽 수정 필요 | s3-connector 저장소, PyTorch DCP 문서, NVIDIA cuObject 문서 | `✓` |
| 경로 종합 | 읽기는 CPU 메모리 수신이 기본, 체크포인트는 CPU staging이 기본, GDS는 선택적 | — | `≈` |

{{% /details %}}

## 4. 추론은 가중치 로더와 KV 캐시를 따로 봐야 한다

추론에서 GDS를 검토할 때는 가중치를 읽는 로더와 KV 캐시를 저장하는 계층을 구분해야 합니다. GDS를 지원하더라도 기본 설정에서는 대개 꺼져 있는 것으로 보입니다.

vLLM 0.32의 load format에는 `fastsafetensors`, `instanttensor`, `runai_streamer`, `tensorizer`, `modelexpress`, 새로 추가된 `ipc_cache` 등이 있습니다. 이 가운데 fastsafetensors는 텐서 병렬(TP)이 둘 이상이면 GDS를 끕니다. 소스의 조건은 `nogds = pg.size() > 1`입니다. `cuFileDriverOpen()`이 보이는 모든 GPU에 CUDA 컨텍스트를 만들기 때문입니다. GDS 오류가 발생하면 첫 텐서를 내보내기 전까지는 nogds로 재시도합니다.

fastsafetensors README는 Llama-70B를 GPU 4개에서 GDS로 읽었을 때 NVMe 읽기 26.4 GB/s, 기본 safetensors 대비 4.8~7.5배 성능을 주장합니다. 이 벤더 측 수치는 vLLM이 TP>1에서 GDS를 끄는 조건과 함께 읽어야 합니다.

Dynamo v1.5의 KV 블록 매니저(KVBM)는 GPU, 호스트 메모리, 디스크, 오브젝트 스토리지를 사용합니다. `DYN_KVBM_DISK_CACHE_GB`로 디스크 계층을 켜며, GDS를 쓰려면 TOML에 `[cache.disk] use_gds = true`를 설정합니다. 대응하는 환경변수는 `KVBM_CACHE_DISK_USE_GDS`이고 기본값은 false입니다. NIXL의 기본 백엔드도 UCX와 POSIX입니다.

가장 아래 계층은 문서 버전에 따라 뜻이 다릅니다. v1.2 설계 문서는 NFS, Lustre, GPFS 같은 원격 디스크를 가리키고, v1.5 구성 문서는 S3 호환 오브젝트 스토리지를 가리킵니다.

로컬 NVMe를 쓰는 LMCache의 GDS 백엔드는 GPU 메모리 여유도 요구합니다. `gds_path`에 로컬 NVMe 여러 개를 쉼표로 지정하고, `gds_buffer_size`만큼의 버퍼를 VRAM에 등록합니다. 버퍼가 GPU 메모리를 차지하므로 vLLM의 `--gpu-memory-utilization`을 낮춰야 합니다. 문서 예시는 H100 80GiB에서 버퍼 8GiB와 활용률 0.85를 사용합니다.

LMCache 문서는 일부 libcufile 버전이 백엔드 모르게 POSIX로 폴백할 수 있다고 경고합니다. `use_gds: false`로 POSIX를 강제하는 옵션도 있습니다. 문서가 제시하는 성능 수치는 측정 결과가 아닌 대역폭 계산입니다. PCIe Gen4 x4 NVMe 하나가 약 7 GB/s이므로 네 개면 약 28 GB/s라는 계산입니다. 이 문서의 in-process 모드 자체는 deprecated이고 MP 모드가 권장됩니다.

이 엔진들 사이에서 전송을 맡는 공통 계층이 NIXL v1.5.0입니다. NIXL은 vLLM, SGLang, Dynamo에 통합되어 있으며, IIT 논문도 널리 쓰이는 추론 엔진들에 통합됐다고 서술합니다. GDS는 여러 플러그인 중 `cuda_gds` 백엔드에 해당합니다. 기본은 cuFile batch이고 `mode=mt`로 멀티스레드를 선택합니다.

여기서 GPU 사이 KV 전송과 스토리지 I/O를 구분해야 합니다. prefill에서 decode로 보내는 GPU 간 KV 전송은 UCX 위의 RDMA가 기본이며, NIXL 저장소는 GDRCopy가 있으면 최대 성능을 낼 수 있다고 설명합니다.

최근 1년 동안 KV 오프로드 계층은 CPU에서 로컬 NVMe, 원격 파일시스템과 오브젝트 스토리지로 넓어졌고 cuObject RDMA 경로도 생겼습니다. GDS 자체는 여전히 대부분 선택 옵션이며 기본값은 꺼져 있는 것으로 보입니다. KVBM의 기본 false, vLLM의 TP>1 nogds, LMCache의 폴백 경고가 그 판단의 근거입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| vLLM | v0.32.0(2026-10-18) | vLLM 릴리스 | `✓` |
| vLLM load format | `fastsafetensors`, `instanttensor`, `runai_streamer`, `tensorizer`, `modelexpress`, `ipc_cache` 등 | vLLM v0.32.0 `load.py` | `✓` |
| fastsafetensors의 TP>1 | `nogds = pg.size() > 1`. `cuFileDriverOpen()`이 보이는 모든 GPU에 CUDA 컨텍스트를 만들기 때문. 오류 시 첫 텐서 전에 한해 nogds 재시도 | vLLM v0.32.0 `weight_utils.py` | `✓` |
| fastsafetensors 성능 주장 | Llama-70B, GPU 4개, GDS로 NVMe 읽기 26.4 GB/s, 기본 safetensors 대비 4.8~7.5배 | fastsafetensors README | `Ⓥ` |
| NVIDIA Dynamo | v1.5.1(2026-10-07, latest stable) | Dynamo 릴리스 | `✓` |
| KVBM 계층 | G1 GPU, G2 호스트, G3 디스크, G4 오브젝트. 디스크는 `DYN_KVBM_DISK_CACHE_GB`·`DYN_KVBM_DISK_CACHE_DIR`, O_DIRECT 불가 시 `DYN_KVBM_DISK_DISABLE_O_DIRECT` | Dynamo v1.5.0 KVBM 구성 문서 | `✓` |
| KVBM의 GDS | `[cache.disk] use_gds`(`KVBM_CACHE_DISK_USE_GDS`) 기본 false. NIXL 기본 백엔드는 UCX와 POSIX | Dynamo v1.5.0 KVBM 구성 문서 | `✓` |
| G4 정의의 버전 차이 | v1.2 설계 문서는 원격 디스크, v1.5 구성 문서는 S3 호환 오브젝트 스토리지 | Dynamo 문서 | `✓` (차이 자체) |
| LMCache | v0.5.6(2026-10-14) | LMCache 릴리스 | `✓` |
| LMCache GDS 백엔드 | `gds_path`(`by_gpu` 샤딩), `gds_buffer_size` MiB를 VRAM에 등록, `local_cpu: false` 권장. H100 80GiB 예시 8GiB와 0.85 | LMCache 문서 | `✓` |
| LMCache의 POSIX 폴백과 강제 | 일부 libcufile 버전이 모르게 폴백. `use_gds: false`로 강제 POSIX | LMCache 문서 | `✓` |
| LMCache 문서의 성능 서술 | 측정 없이 대역폭 산술만(Gen4 x4 NVMe 약 7 GB/s, 4개 약 28 GB/s). in-process 모드는 deprecated | LMCache 문서 | `Ⓥ` |
| NIXL | v1.5.0(2026-09-30) | NIXL 릴리스 | `✓` |
| NIXL의 통합 범위 | vLLM·SGLang·Dynamo의 공통 전송 계층. IIT 논문이 "integrated into most popular inference engines"라고 서술 | NIXL 저장소, IIT NIXL 벤치마크 논문 | `✓` |
| NIXL 플러그인 | `ucx`, `cuda_gds`(GDS·GDS_MT), `posix`, `obj`, `azure_blob`, `hf3fs`, `mooncake`, `gpunetio`, `libfabric`, `uccl`, `gusli`, `infinia`, `redis`. GDS는 기본 cuFile batch, `mode=mt`면 멀티스레드, `GDS_MT` 이름은 폐지 예정 | NIXL 저장소, cuda_gds README | `✓` |
| GPU 간 KV 전송 | UCX(RDMA)가 기본, GDRCopy가 있으면 최대 성능 | NIXL 저장소 | `✓` |
| 최근 1년의 방향 | KV 오프로드 계층의 확장, cuObject 경로 등장, GDS는 대부분 선택 옵션이고 기본 off | — | `≈` |

{{% /details %}}

## 5. 스토리지와 집합통신이 패브릭을 나누는 방식

RDMA 스토리지를 쓰기로 했다면 스토리지 트래픽이 NCCL 집합통신과 고속 패브릭에서 경합할지도 살펴봐야 합니다. 공개 자료에는 패브릭을 따로 구성하는 설계, NIC의 용도를 나누는 설계, 같은 장치나 패브릭을 공유하는 것으로 보이는 설계가 있습니다.

NVIDIA DGX SuperPOD 레퍼런스 아키텍처는 Compute, Storage, In-band, Out-of-band 패브릭을 구분합니다. 스토리지 패브릭은 컴퓨트 패브릭과 독립적으로 두며, 스토리지에는 InfiniBand(RDMA)나 RoCE를 사용합니다.

스토리지 I/O 요구량을 읽을 때는 문서의 단위도 확인해야 합니다. B300 XDR 페이지는 노드 I/O가 80 GBps를 넘어야 한다고 쓰지만, 다른 절에서는 SU당으로 적어 단위가 엇갈립니다. H100과 B200 세대의 요구량은 노드당 최소 40 GBps였습니다.

GCP는 NIC의 용도를 나눕니다. A4와 A3 Ultra의 ConnectX-7 8개(3,200 Gbps)는 GPU 간 고대역폭 통신 전용이며, 다른 네트워크 용도로는 쓸 수 없다고 명시합니다. 일반 트래픽은 gVNIC 2개(400 Gbps)가 처리합니다. A4X에서는 ConnectX-7 4개(1,600 Gbps, RoCE)가 GPU 전용이고, Titanium NIC 2개(400 Gbps)가 스토리지·관리·외부 트래픽을 맡습니다.

AWS FSx for Lustre의 EFA·GDS 구성은 인스턴스의 EFA 인터페이스를 Lustre의 LNet에 연결합니다. p5의 기본 EFA 인터페이스는 8개입니다. EFA는 NCCL이 쓰는 장치와 같은 종류이므로, 이 구성에서는 스토리지와 집합통신이 같은 EFA 장치나 패브릭을 공유하는 것으로 보입니다. AWS 문서가 경합이나 QoS를 언급하지 않으므로 이 해석은 추정이며, 경합을 다루는 공식 가이드도 찾지 못했습니다.

{{< flow src="_flow/4-패브릭-분리.json" />}}

온프레미스 레퍼런스와 GCP는 패브릭을 분리하고, AWS의 FSx와 EFA 경로는 공유하는 것으로 보입니다. 이 정리는 추정입니다.

RoCE 패브릭을 분리하지 않는다면 최소한 트래픽 클래스를 나눠야 합니다. Mayastor 차트의 `transportTos`는 RDMA 트래픽에 DSCP 값을 지정하는 옵션입니다. values.yaml 주석은 공유 RoCE 패브릭에서 스토리지 트래픽을 별도 PFC 큐로 분류하기 위한 용도라고 설명합니다.

Meta의 Llama 3 논문은 RoCE 클러스터를 설명하면서 스토리지 트래픽의 분리 여부는 적지 않았습니다.

패브릭 구성의 세부는 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})에서 이어 보겠습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| DGX SuperPOD의 패브릭 | Compute, Storage, In-band, Out-of-band 네 개 | NVIDIA DGX SuperPOD 레퍼런스(B300 XDR) | `✓` |
| 스토리지 패브릭의 독립 | H100·B200·B300 Key Components 페이지가 독립으로 둔다고 서술. 본문 직접 대조는 B300 network-fabrics 페이지뿐 | NVIDIA DGX SuperPOD 레퍼런스 | `✓` (검색 스니펫 포함) |
| 스토리지 노드 I/O 요구 | B300 XDR는 80 GBps 초과라 쓰지만 다른 절은 SU당으로 적어 단위가 엇갈림. H100·B200 세대는 노드당 최소 40 GBps | NVIDIA DGX SuperPOD 레퍼런스 | `✓` |
| GCP A4·A3 Ultra | ConnectX-7 8개 3,200 Gbps는 GPU 간 통신 전용, gVNIC 2개 400 Gbps가 일반 트래픽 | GCP GPU 네트워크 대역폭 문서 | `✓` |
| GCP A4X | ConnectX-7 4개 1,600 Gbps RoCE는 GPU 전용, Titanium NIC 2개 400 Gbps가 스토리지·관리·외부 | GCP GPU 네트워크 대역폭 문서 | `✓` |
| AWS FSx for Lustre | EFA 인터페이스(p5 기본 8개)를 LNet에 붙이는 설정(`lnetctl net add --net efa`) | AWS FSx for Lustre 가이드 | `✓` |
| AWS의 공유 해석 | EFA가 NCCL과 같은 종류라 같은 장치나 패브릭을 공유하는 구성으로 보임 | — | `≈` |
| AWS의 경합·QoS 서술 | 문서에 없음. 경합 공식 가이드는 찾지 못함 | — | `?` |
| Mayastor `transportTos` | RDMA DSCP 마킹, 공유 RoCE 패브릭에서 별도 PFC 큐로 분류하는 용도 | Mayastor 차트 values.yaml | `✓` |
| Llama 3 논문의 서술 | RoCE 클러스터 설명에 스토리지 트래픽 분리 여부 없음 | Llama 3 논문 | `✓` (부재) |
| 제공자별 분리 정리 | 온프레미스 레퍼런스와 GCP는 분리, AWS FSx·EFA는 공유로 보임 | — | `≈` |

{{% /details %}}

## 6. GDS와 NVMe-oF RDMA의 지원 범위·이득·점검 순서

애플리케이션에 GDS를 쓸 자리가 있어도 지원 범위와 성능 조건을 확인해야 합니다. GPU Operator가 공식 지원하는 GDS 스토리지는 로컬 NVMe와 NFS입니다. 플랫폼 지원표에는 Ubuntu와 OpenShift가 있으며 RHEL은 없고, secure boot는 지원하지 않습니다. 업스트림 P2PDMA 경로는 x86_64 로컬 NVMe에 한정됩니다. NVMe-oF와 GDS를 조합하려면 DOCA의 `mlnx-nvme` 아웃오브트리 모듈이 필요합니다.

직접 경로가 성립해도 모든 I/O에서 빨라지지는 않습니다. 벤더 밖 자료인 IIT 측정에서는 큰 쓰기가 CPU 경로에서 더 빨랐고, 배치·비동기 API는 이득이 없거나 손해였습니다. NVIDIA GDS 개요 가이드도 이득을 얻는 조건을 큰 순차 스트리밍과 GPU 파이프라인으로 한정합니다. 노드 안 PCIe 경로가 성능에 미치는 영향은 [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}})을 참고하면 됩니다.

NVMe-oF RDMA를 검토하는 이유에는 Target 측 CPU 효율도 있습니다. SPDK 24.05 보고서의 4KiB 랜덤 읽기에서는 포화에 도달하는 데 RDMA가 약 8코어, TCP가 24~32코어를 사용했습니다. QD가 달라 경향을 비교하는 수치로 읽어야 합니다.

확인한 문서 범위에서 Kubernetes 블록 CSI의 RDMA 공식 지원은 Mayastor와 Portworx/FlashArray 정도로 보입니다. 대부분은 NVMe/TCP를 기본으로 제시하며, RoCE를 선택하면 PFC와 DSCP 같은 무손실 패브릭 설정도 필요합니다.

설정을 켠 뒤에도 cuFile은 `allow_compat_mode` 기본값이 true라서 조용히 POSIX로 폴백할 수 있습니다. 점검 순서는 다음과 같습니다.

1. 노드에서 오픈 커널 모듈 드라이버, DOCA-OFED, secure boot off를 확인한다. P2PDMA를 쓴다면 IOMMU pt 또는 off도 점검한다.
2. GPU Operator에서 `gds.enabled=true`로 켜고, 볼륨을 GDS 지원 파일시스템으로 마운트한다. overlayfs, FUSE, ZFS, btrfs는 호환 모드가 된다는 점을 고려해야 한다.
3. `gdscheck -p`의 `NVMe`, `NVMeOF`, `NVMe P2PDMA` 줄을 확인한다. `cufile.log`의 `cufile IO mode: POSIX`와 gdsio 처리량도 살펴 호환 모드로 동작하고 있지는 않은지 확인한다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 공식 지원 범위 | 로컬 NVMe와 NFS, Ubuntu·OpenShift, RHEL 없음, secure boot 불가 | GPU Operator 플랫폼 지원표 26.7 | `✓` |
| P2PDMA와 NVMe-oF | x86_64 로컬 NVMe에 한정, NVMe-oF는 DOCA `mlnx-nvme` 필요 | NVIDIA GDS NVMe 지원 문서, GDS 트러블슈팅 가이드 | `✓` |
| 이득이 조건부 | IIT 측정에서 큰 쓰기는 CPU 경로가 우세, 배치·비동기 이득 없음. NVIDIA 문서는 큰 순차 스트리밍과 GPU 파이프라인으로 한정 | IIT NIXL 벤치마크 논문, NVIDIA GDS 개요 가이드 | `✓` |
| RDMA와 TCP의 코어 효율 | SPDK 24.05, 4KiB 랜덤 읽기, RDMA 약 8코어 포화, TCP 24~32코어. QD가 달라 경향 비교만 | SPDK 성능 보고서 24.05 | `✓` (보고서), 비교는 `≈` |
| Kubernetes 블록 CSI의 RDMA 지원 | Mayastor와 Portworx/FlashArray 정도 | Mayastor·Portworx·Trident·Lightbits 문서 | `≈` |
| 기본값이 꺼져 있다 | KVBM `use_gds` false, vLLM fastsafetensors TP>1 nogds, `torch.cuda.gds` prototype, DCP는 CPU staging 기본, cuFile `allow_compat_mode` true | Dynamo KVBM 문서, vLLM 소스, PyTorch 문서, GDS 구성 가이드 | `✓` |
| 켠 뒤의 점검 항목 | 오픈 커널 모듈, DOCA-OFED, secure boot off, IOMMU pt/off, `gds.enabled=true`, `gdscheck -p`, `cufile.log`, gdsio | GPU Operator RDMA 문서, GDS 트러블슈팅 가이드 | `✓` |

{{% /details %}}

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
