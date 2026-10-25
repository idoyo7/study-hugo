---
title: "GPU 체크포인트를 위한 병렬 파일시스템·오브젝트·Kubernetes 선택"
linkTitle: "03 관리형·오브젝트·Kubernetes"
description: "동기·비동기 체크포인트의 대역폭 요구를 기준으로 관리형 병렬 파일시스템, 오브젝트 캐시, 파일 서비스와 Kubernetes 공유 볼륨의 적용 범위를 비교한다."
weight: 3
date: 2026-10-21
lastmod: 2026-10-21
url: "/gpu-storage/03-managed-object-kubernetes/"
---

# 03 · GPU 체크포인트를 위한 병렬 파일시스템·오브젝트·Kubernetes 선택

병렬 파일시스템의 필요성은 체크포인트 저장 방식에서 갈립니다. 동기 저장은 GPU가 멈춘 동안 전체 체크포인트를 받아 줄 피크 대역폭이 필요합니다. 이 글에서 비교하는 비동기 저장은 호스트 메모리로 복사한 뒤 학습을 재개하는 방식입니다. 다음 체크포인트까지 저장을 끝낼 평균 대역폭을 기준으로 삼습니다. 이 글의 해석으로는 짧은 정지 시간을 요구하는 동기 저장에는 병렬 파일시스템이 필요하지만 비동기 저장의 필수 조건은 아닙니다.

관리형 Lustre는 대역폭에 맞춰 용량까지 늘리는 방식입니다. 오브젝트 원본과 캐시를 조합하면 비용과 데이터 배치가 달라집니다. 두 방식을 같은 조건에서 비교한 자료는 확인하지 못했으므로, 여기서는 체크포인트 경로와 접근 방식, 공개 측정의 구성을 각각 따져 봅니다.

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인. 각 절 끝의 '근거와 측정 조건'에 수치와 조건을 모았습니다.

워크로드별 I/O 패턴은 [01]({{< relref "/data/gpu-storage/01-workload-io-patterns/index.md" >}}), GDS(GPUDirect Storage)와 병렬 파일시스템 구조는 [02]({{< relref "/data/gpu-storage/02-data-path-and-filesystems/index.md" >}})에 있습니다. 로컬 디스크가 노드와 함께 사라지는 문제는 [블록 스토리지 03]({{< relref "/data/block-storage/03-local-disk-ha/index.md" >}})과 이어집니다. iSCSI·NVMe-oF의 RWO(한 노드의 읽기·쓰기 접근)는 [블록 스토리지 01]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}})에서 다룹니다.

## 1. 저장 방식에 따라 필요한 대역폭이 달라진다 {#1-대역폭은-정지-시간으로-비용은-용량으로-정해진다}

SuperPOD 참조 아키텍처(RA)는 체크포인트 기록 중 학습이 멈추는 동기 방식을 전제합니다. LLM의 쓰기 성능을 읽기 성능의 절반 이상으로 권장하는 기준도 이 조건에서 나왔습니다. 정지 시간을 줄이려면 체크포인트 전체를 짧은 시간에 기록할 피크 대역폭이 필요합니다.

이 비교의 비동기 저장에서는 GPU 데이터를 호스트 메모리로 복사하는 동안만 학습을 멈춥니다. 스토리지는 학습이 재개된 뒤에도 기록을 계속해 다음 체크포인트 전에 끝내야 합니다. 5.29 TiB를 10분마다 저장하는 계산에서는 평균 약 9 GiB/s가 필요합니다. 10분은 비교를 위한 가정이며 업계 표준 주기가 아닙니다.

병렬 파일시스템만 가능한 선택은 아닙니다. NSDI '25의 ByteCheckpoint 논문은 HDFS를 주 백엔드로 사용한 405B 모델·GPU 8,960개 구성에서 정지 시간 0.59초를 보고했습니다.

관리형 Lustre의 처리량은 대체로 할당 용량과 연결됩니다. AWS FSx for Lustre, GCP Managed Lustre, Azure Managed Lustre는 MBps/TiB 티어나 용량 증분으로 처리량을 정해 더 높은 대역폭에 필요 이상의 용량이 따라올 수 있습니다. FSx Intelligent-Tiering과 GCP Dynamic 티어에서는 용량과 대역폭을 분리하려는 변화가 보입니다. 표에서 CSI는 스토리지 연결 표준 인터페이스, RWX는 여러 노드의 읽기·쓰기, ROX는 여러 노드의 읽기 전용 접근을 뜻합니다.

| 서비스 | 상태 | 처리량 단위 | GPU 연계 | 등급 |
|---|---|---|---|---|
| FSx for Lustre | GA | Persistent 2 SSD는 125·250·500·1000 MBps/TiB. Intelligent-Tiering은 파일시스템 단위로 4,000 MBps 배수, 최대 2,000,000 MBps | EFA를 켜면 클라이언트당 700 Gbps, EFA+GDS면 1200 Gbps. ENA는 100 Gbps이고 클라이언트-OSS 쌍당 5 Gbps 제한. 10 GBps 넘는 파일시스템에는 EFA 권장 | ✓ |
| Managed Lustre | 2025-06-30 GA(DDN EXAScaler 기반) | 125·250·500·1000 MBps/TiB 티어와 Dynamic 티어(25 MBps/TiB 기준, 통합 캐시, 최대 80.1 PiB). 최대 10 TBps(2026-04) | GKE CSI가 RWX·ROX·RWO, 동적·정적 프로비저닝 지원. GKE 1.33.2+ | ✓ |
| Parallelstore(DAOS 기반) | URL이 Managed Lustre로 리다이렉트. 공식 EOL은 ? | — | — | ✓(리다이렉트) / ? |
| Azure Managed Lustre | GA(40·500 티어는 2023 GA, 125·250도 제공). 20 MB/s/TiB 티어는 2025-11 퍼블릭 프리뷰(최대 25 PiB) | 용량 증분당 2,000 MB/s(20 티어는 96 TiB 증분) | AKS 전용 Lustre CSI 드라이버. Blob과 HSM 연동(import/export) | ✓ |

Azure Managed Lustre의 MLPerf v3.0 결과는 용량과 대역폭의 결합을 보여 줍니다. 405B 체크포인트 5.29 TiB를 12초 안에 기록한 파일시스템의 용량은 4 PiB였습니다. 실제 저장 공간보다 처리량을 확보하려고 큰 용량을 할당한 구성으로 해석했습니다. 아래 결과는 모두 125 티어와 데이터 병렬 2개를 사용했습니다.

| 모델 | 용량 | 쓰기 | 쓰기 시간 | 복구 읽기 |
|---|---|---|---|---|
| 8B | 160 TiB | 13.3 GiB/s | 7.86초 | 14.8 GiB/s |
| 70B | 1,280 TiB | 105.5 GiB/s | 8.65초 | 123.6 GiB/s |
| 405B | 4,096 TiB | 457.0 GiB/s | 11.76초 | 438.1 GiB/s |
| 1250B | 4,096 TiB | 642.2 GiB/s | 24.63초 | 489.6 GiB/s |

관리형 병렬 파일시스템의 비용은 필요한 저장량만이 아니라 목표 대역폭을 얻기 위해 할당해야 하는 용량으로 계산해야 합니다. 리전과 약정에 따라 가격이 달라 절대 비용 비교는 제외했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| SuperPOD RA의 동기 체크포인트 전제 | 체크포인트가 수 TB일 수 있고 동기 작업이라 학습이 멈춤. LLM에는 읽기 성능의 절반 이상을 쓰기 성능으로 권장 | DGX SuperPOD B300 RA | `✓` |
| 동기 쓰기 필요 대역폭 | 405B 5.29 TiB를 457 GiB/s로 쓰면 11.76초 | Azure Managed Lustre MLPerf v3.0 결과 | `Ⓑ` |
| 비동기 평균 대역폭 | 5.29 TiB를 10분 간격으로 저장하면 평균 9 GiB/s 정도 | — | `≈` |
| ByteCheckpoint | 405B, GPU 8,960개, 정지 0.59초. 주 백엔드 HDFS | NSDI '25 논문 | `Ⓑ` / `✓` |
| 용량 비례 처리량 | FSx·GCP·Azure 모두 MBps/TiB 티어 또는 용량 증분 구조 | 각 클라우드 문서 | `✓` |
| FSx for Lustre의 EFA+GDS 1200 Gbps | 클라이언트당 최대. GDS는 문서로 확인 | FSx for Lustre performance | `✓` |
| 405B 체크포인트 크기 | 5.29 TiB | MLPerf Storage 규칙(에디션 3.0) | `✓` |
| 405B 쓰기에 4 PiB를 빌림 | 125 티어, 데이터 병렬 2개, 4,096 TiB에서 457.0 GiB/s, 11.76초 | Azure Managed Lustre MLPerf v3.0 결과 | `Ⓑ` |
| 대역폭 때문에 용량을 사는 구조 | 위 두 사실을 이은 해석 | — | `≈` |

{{% /details %}}

## 2. 읽기와 배포에는 파일 서비스와 오브젝트 캐시를 조합한다 {#2-읽기배포에는-파일-서비스와-오브젝트-캐시도-있다}

모든 공유 데이터에 병렬 파일시스템이 필요한 것은 아닙니다. FSx for OpenZFS, EFS, ANF(Azure NetApp Files)는 NFS로 연결합니다. EFS는 클라이언트당 상한이 낮아 학습 데이터 경로보다 홈 디렉터리와 공유 설정에 알맞습니다. Hyperdisk ML은 읽기 전용 볼륨을 여러 노드에 연결해 모델 가중치를 배포합니다.

오브젝트 저장소를 원본으로 삼을 때는 앞단에 파일 인터페이스나 캐시를 둡니다. 첫 캐시 미스에서는 백엔드에서 데이터를 가져와 GPU 가까이에 저장하고 이후 요청은 그 사본을 읽습니다. 관리형 Lustre와 Blob·GCS의 HSM(계층형 스토리지 관리) 연동도 이 구조입니다. S3 Express One Zone, Mountpoint, GCS FUSE, Anywhere Cache, BlobFuse2는 오브젝트 원본을 가까운 경로로 제공하지만 쓰기 동작에는 제약이 있습니다.

| 서비스 | 상태 | 처리량 단위 | GPU 연계 | 등급 |
|---|---|---|---|---|
| FSx for OpenZFS | GA | 캐시 데이터 최대 21 GB/s, 디스크 데이터 최대 10 GB/s | NFS 클라이언트. Intelligent-Tiering 캐시 미스는 첫 바이트까지 수십 ms | Ⓥ(제품 페이지) |
| EFS | GA | Elastic 읽기 파일시스템당 20~60 GiBps(리전별), 쓰기 1~5 GiBps, 클라이언트당 1,500 MiBps | 홈·공유 설정용. 학습 데이터 경로로는 클라이언트당 상한이 낮음 | ✓ |
| Azure NetApp Files | GA. breakthrough mode GA 2026-09-24 | 볼륨당 최대 80 GiB/s(전용 용량, 엔드포인트 6개) | NFS | Ⓥ |
| Hyperdisk ML | GA | 볼륨당 최대 1.2 TiB/s, 읽기 전용으로 최대 2,500 노드 | 모델 가중치 배포. 갱신할 때마다 미리 적재 필요 | ✓ |
| S3 Express One Zone | 2023-11 GA | 디렉터리 버킷당 초당 최대 200만 요청, 한 자릿수 ms 지연, 단일 AZ | Mountpoint 공유 캐시(1 MB 이하 객체)로 쓸 수 있음 | ✓ |
| Mountpoint for S3 (CSI v2) | GA | 순차·랜덤 읽기, 새 파일의 순차 쓰기만 지원 | CSI v2에서 여러 Pod가 캐시를 공유 | ✓ |
| Cloud Storage FUSE CSI | GA | 파일 캐시(로컬 SSD·부트 디스크)와 병렬 다운로드(2.12+에서 캐시를 켜면 자동) | 데이터셋·모델·체크포인트 용도로 안내 | ✓ |
| Anywhere Cache / Rapid Storage | 2025-04 발표. Anywhere Cache는 같은 존 SSD 읽기 캐시, Rapid는 존 단위 버킷 | 발표 수치는 Rapid 6 TB/s·1 ms 미만 지연, Anywhere Cache 2.5 TB/s | GA 상태 ?. 이름이 Rapid Cache로 바뀌었다는 말은 서드파티 출처뿐 | Ⓥ / ? |
| Blob + BlobFuse2 | GA. BlobFuse v1 지원은 2026-09 종료 | 파일 캐시는 열 때 파일 전체를 받음. 미리 적재(preload)하면 읽기 전용이 됨 | 학습 데이터 적재와 체크포인트 저장 용도로 안내 | ✓ |
| 인스턴스 로컬 NVMe | — | p6-b200.48xlarge 기준 3.84 TB × 8 | 데이터셋 캐시, 체크포인트 1차 저장 | Ⓥ(제품 페이지) |

Mountpoint는 새 파일의 순차 쓰기만 지원하며 덮어쓰기와 추가 쓰기는 지원하지 않습니다. 체크포인트를 매번 새 파일로 만드는 방식은 이 제약에 맞습니다. 라이브러리가 임시 파일을 만든 뒤 `rename`하는 등 다른 POSIX 동작을 사용한다면 호환성을 별도로 확인해야 합니다.

Alluxio와 JuiceFS는 GPU 노드의 남는 NVMe 또는 전용 노드에 캐시를 배치합니다. NVIDIA AIStore는 관리형 서비스가 아닌 오픈소스 소프트웨어입니다. cuObject는 S3 요청의 데이터 경로에 RDMA(원격 직접 메모리 접근)를 사용합니다.

DGX 노드의 로컬 NVMe는 데이터셋 첫 읽기 캐시, 체크포인트의 1차 기록, KV cache(추론 중 재사용하는 키·값 캐시)의 G3 계층으로 사용할 수 있다고 해석했습니다. 로컬에만 기록한 체크포인트는 노드 장애 때 함께 사라질 수 있어 원격 복사나 이웃 노드 복제가 필요합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| AIStore의 캐시 동작 | 콜드 읽기 때 백엔드(S3, GCS, Azure Blob, OCI, 다른 AIStore)에서 가져와 로컬 사본을 둠. 사전 적재도 가능 | NVIDIA AIStore 블로그 | `✓` |
| Mountpoint의 쓰기 제약 | 덮어쓰기와 추가 쓰기 미지원. 새 파일의 순차 쓰기만 지원 | Mountpoint 사용 문서 | `✓` |
| 체크포인트 라이브러리의 rename 사용 여부 점검 | 임시 파일 rename 같은 POSIX 동작 사용 여부 | — | `≈` |
| Alluxio·JuiceFS 구성 | 남는 NVMe나 전용 CPU 노드에 캐시, S3 API·POSIX·Python SDK 노출(Alluxio). 메타데이터 엔진과 분산 캐시, 오브젝트 백엔드(JuiceFS) | 각 제품 페이지 | `Ⓥ` |
| DGX B300 로컬 NVMe | 3.84 TB E1.S 8개, 약 30 TB. SuperPOD RA는 캐싱·스테이징 공간으로 설명 | Colfax 요약, SuperPOD RA | `Ⓥ` / `✓` |
| 로컬 NVMe의 세 가지 쓰임새, 노드 장애 위험 | 데이터셋 캐시, 체크포인트 1차 쓰기, KV cache G3. 로컬에만 두면 노드 장애 때 소실 | — | `≈` |

{{% /details %}}

## 3. 공개 성능은 처리량과 시스템 구성을 함께 읽는다 {#3-공개-성능은-처리량과-구성을-함께-읽는다}

MLPerf Storage v3.0은 각 제출 구성이 처리한 규모를 공개합니다. 벤더가 제출하고 MLCommons가 감사했지만 노드 수와 용량이 서로 달라 결과를 벤더 순위로 읽을 수는 없습니다.

2026-09-01 공개된 v3.0에는 학습, 체크포인트, KVCache, 벡터 DB 워크로드가 포함됩니다. 학습은 UNet3D와 RetinaNet을 사용하고 AU(가속기 활용률)를 각각 90% 이상, 85% 이상으로 유지해야 합니다. 체크포인트 모델은 Llama 3 8B·70B·405B·1T, KVCache는 Llama 3.1 8B·70B, 벡터 DB는 Milvus 계열입니다. 가상 가속기가 B200 또는 MI355이므로 H100 기반 v2.0과 직접 비교할 수 없습니다.

| 시스템 | 워크로드 | 결과 | 구성 |
|---|---|---|---|
| Everpure FlashBlade//EXA | 1.25T 체크포인트 | 쓰기 877.52 GiB/s(17.74초), 읽기 588.28 GiB/s(28.99초) | 데이터 노드 30대, 가속기 1,024개. 데이터 노드 10대에서는 327.65 GiB/s |
| Azure Managed Lustre | 1.25T 체크포인트 | 쓰기 642.2 GiB/s | 4,096 TiB |
| YanRongTech F9000X | UNet3D | 543.9 GiB/s, B200 99개 | 클라이언트 8대 |
| TuringData F9200 | UNet3D / 70B 체크포인트 | 541.5 GiB/s(B200 96개) / 읽기 539.9·쓰기 307.1 GiB/s | 스토리지 노드 3대 |
| UBIX UbiPower18000 | UNet3D | 454.1 GiB/s, B200 80개 | 스토리지 노드 3대, 15.36 TB NVMe 16개, NDR400 4개 |
| Azure Managed Lustre | UNet3D | 379.1 GiB/s, B200 70개 | 125 티어 4,096 TiB |
| NVIDIA AIStore(S3) | 1T 체크포인트 | 쓰기 133.27 GiB/s | OCI 노드 12대 |
| Everpure | KVCache | 1,623.4 GiB/s | 호스트 51대 |

오브젝트 경로도 네트워크 용량에 가까운 처리량을 낼 수 있습니다. NVIDIA AIStore의 Llama 3 1T 체크포인트 측정은 쓰기와 복구 읽기에서 NIC(네트워크 인터페이스 카드) 합산 대역폭의 95% 이상을 사용했습니다. OCI 베어메탈 노드를 3대에서 12대로 늘리자 처리량이 3.97~3.99배로 증가해, 이 시험에서는 S3 프로토콜보다 네트워크가 한계였던 것으로 해석했습니다. Blocks & Files는 MLPerf v3.0 제출의 약 6분의 1이 S3 데이터 계층을 사용했다고 보도했습니다.

높은 처리량을 기록한 구성은 대체로 스토리지 노드 3대 안팎의 NVMe 서버와 여러 개의 400 Gbps급 NIC를 사용했습니다. 지원 가능한 가속기 수는 클라이언트 NIC 대역폭의 영향을 받았고, 대규모 체크포인트 처리량은 데이터 노드 수에 거의 비례해 증가했습니다.

보도 자료 사이에는 수치가 맞지 않는 항목도 있습니다. Everpure 읽기 값은 StorageReview의 도입부와 본문이 다르며, 표에는 Blocks & Files도 인용한 본문 값 588.28 GiB/s를 사용했습니다. 원 결과표는 확인하지 못했습니다. Argonne Aurora DAOS의 v2.0 결과는 가속기 모델이 달라 이번 표에서 제외했습니다.

DDN, Huawei, Hammerspace, Lightbits, VAST, WEKA, Dell, IBM, NetApp은 이번 라운드에 결과를 제출하지 않았습니다. 제출하지 않았다는 사실은 해당 벤더의 성능을 평가할 근거가 아닙니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 워크로드 정의 | UNet3D AU 90% 이상, RetinaNet AU 85% 이상. 체크포인트는 쓰기 10회·읽기 10회, 쓰기마다 fsync, 호스트당 데이터가 호스트 메모리의 3배 초과. 가상 가속기 B200(180 GB)·MI355(288 GB), H100·A100은 whatif 전용 | MLPerf Storage 규칙, Blocks & Files | `✓` |
| 표의 결과 | 벤더 제출, MLCommons 감사 | StorageReview, Blocks & Files, Azure, AIStore | `Ⓑ` |
| AIStore UNet3D | 115.58 GiB/s, 가상 B200 20개, AU 98%. OCI 베어메탈(NVMe 12개, 100 Gbps NIC 1개) 노드 12대 | AIStore MLPerf v3.0 글 | `Ⓑ` |
| AIStore 1T 체크포인트 | 쓰기 133.27 GiB/s, 복구 읽기 136.54 GiB/s. NIC 합산 대역폭의 95~98% | AIStore MLPerf v3.0 글 | `Ⓑ` |
| AIStore의 NIC 활용 | NIC 합산 대역폭의 95~98% | AIStore MLPerf v3.0 글 | `Ⓑ` |
| 노드 3대에서 12대 | 처리량 3.97~3.99배 | AIStore MLPerf v3.0 글 | `Ⓑ` |
| 병목이 프로토콜보다 네트워크 | 위 결과에 대한 해석 | — | `≈` |
| 제출의 약 6분의 1이 S3 사용 | MLPerf v3.0 | Blocks & Files 보도 | `✓`(보도) |
| 가속기 수가 NIC 대역폭으로 정해짐 | 상위 학습 결과의 구성에서 읽은 경향 | — | `≈` |
| Everpure 10대에서 30대 | 2.68배, 쓰기 327.65에서 877.52 GiB/s | StorageReview | `Ⓑ` |
| Everpure 읽기 수치 불일치 | 기사 도입부 833.0, 본문 588.28. 원 결과표 미확인 | StorageReview, Blocks & Files | `Ⓑ` |
| v2.0 Aurora DAOS | 서버 128대, 쓰기 약 1 TB/s, 읽기 600 GB/s, 405B 체크포인트 10초 이내 주장. v3.0과 비교 불가 | Argonne 발표(HPCwire 보도) | `Ⓥ` |
| 참가·불참 | 19개 조직, 결과 143건. 아홉 곳 불참 | StorageReview, Blocks & Files | `✓`(보도) |

{{% /details %}}

## 4. Kubernetes에서는 접근 모드와 노드 조건을 먼저 확인한다 {#4-kubernetes에서는-공유-접근과-노드-조건이-적용-범위를-정한다}

여러 Pod가 같은 데이터셋을 읽고 여러 랭크가 한 체크포인트 디렉터리에 쓰려면 공유 접근이 필요합니다. 파일 볼륨에서는 RWX가 이를 제공합니다. iSCSI·NVMe-oF의 RWO만으로는 이런 공유를 만들 수 없으므로 병렬 파일시스템·NFS 같은 파일 서비스나 오브젝트 계층을 함께 사용해야 한다고 해석했습니다.

GKE Managed Lustre CSI는 RWX와 동적 프로비저닝을 지원하지만 기본 설정에서는 비활성화돼 있습니다. Azure Lustre CSI의 지원 대상은 AKS이며 Hyperdisk ML은 ROX로 연결됩니다. WEKA, VAST, IBM Storage Scale, DDN EXAScaler, BeeGFS, NetApp Trident, Dell CSM도 CSI 저장소를 공개했지만 이번 조사에서는 버전을 확인하지 못했습니다.

GDS를 사용하려면 노드 조건도 충족해야 합니다. GPU Operator의 드라이버 DaemonSet이 `nvidia-fs`를 로드하며, 23.9.1부터 GDS 드라이버 2.17.5 이상과 오픈 커널 모듈이 필요합니다. 파일시스템 클라이언트 커널 모듈까지 설치해야 해 불변 OS 이미지나 관리형 노드에서는 제약이 생깁니다. GKE Managed Lustre CSI는 사용자 정의 노드 이미지를 지원하지 않습니다. FSx for Lustre는 문서에서 GDS 지원을 확인했지만 GCP와 Azure 관리형 Lustre 문서에는 직접 경로가 언급되지 않습니다.

읽기 경로에는 노드 캐시와 스트리밍을 사용할 수 있습니다. GCS FUSE CSI 문서는 GPU 머신의 Local SSD를 캐시로 구성하도록 안내합니다. vLLM은 `--load-format=runai_streamer`로 GCS·S3의 safetensors를 스트리밍합니다. 추론 KV cache용 Dynamo는 Kubernetes 배포를 전제로 LMCache와 FlexKV를 vLLM 커넥터에 연결합니다. Dynamo 0.7.0에 있던 LMCache의 x86 지원 제한이 현재 버전에도 남아 있는지는 확인하지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| RWX와 블록 스토리지의 RWO | 공유 계층이 파일이나 오브젝트가 된다는 해석 | — | `≈` |
| 관리형 CSI 현황 | GKE Managed Lustre CSI는 RWX, 동적 프로비저닝, 기본 비활성. Azure Lustre CSI는 AKS만. Mountpoint CSI v2, GCS FUSE CSI, Hyperdisk ML(ROX) | 각 클라우드 문서 | `✓` |
| 벤더 CSI 목록 | WEKA, VAST, IBM Storage Scale(CNSA·CSI), DDN EXAScaler, BeeGFS, NetApp Trident, Dell CSM. 저장소 존재는 알려져 있으나 버전 미확인 | — | `≈` |
| GPU Operator의 GDS 조건 | 드라이버 DaemonSet이 `nvidia-fs` 로드. 23.9.1부터 GDS 드라이버 2.17.5 이상, 오픈 커널 모듈 필수. NIC 드라이버와 디바이스 플러그인은 Network Operator | GPU Operator 문서 | `✓` |
| GKE Managed Lustre CSI의 이미지 제약 | 사용자 정의 노드 이미지 미지원 | GKE Managed Lustre 문서 | `✓` |
| GCP·Azure 관리형 Lustre의 GDS 직접 경로 | GCP 문서는 RDMA·GPUDirect 지원을 언급하지 않음. Azure도 문서에 언급 없음 | GKE Managed Lustre CSI 문서 | `?` |
| 모델 로딩 | vLLM `--load-format=runai_streamer`로 GCS·S3 스트리밍. Azure Blob도 지원 | GKE 문서 / Azure SDK 블로그 | `✓` / `Ⓥ` |
| Dynamo의 LMCache x86 문구 | 0.7.0 문서에 있었음. 현재 버전은 미확인 | Dynamo 0.7.0 아카이브 | `?` |

{{% /details %}}

## 확인하지 못한 것

- 관리형 Lustre의 GDS 직접 경로. FSx는 문서로 확인했지만 GCP와 Azure 문서에는 언급이 없다.
- Parallelstore의 공식 지원 종료 일정은 확인하지 못했고 URL 리다이렉트만 관찰했다. Azure 20 MB/s/TiB 티어는 2025-11 퍼블릭 프리뷰까지만 확인했으며 GA 여부는 미확인이다.
- 절대 비용 비교는 제외했다. 가격이 리전·약정에 따라 달라 이번 조사 범위를 벗어난다.
- Google Anywhere Cache·Rapid Storage의 GA 상태와 Dynamo의 LMCache x86 제한이 현재 버전에도 남아 있는지.
- MLPerf v3.0 Everpure 읽기 수치의 원 결과표.
- 체크포인트 주기의 업계 표준값과 벤더 간 같은 조건의 성능 비교.

## 참고 자료

- [Amazon FSx for Lustre performance](https://docs.aws.amazon.com/fsx/latest/LustreGuide/performance.html) · [throughput capacity](https://docs.aws.amazon.com/fsx/latest/LustreGuide/managing-throughput-capacity.html) — AWS. 티어, EFA·GDS 대역폭
- [FSx for OpenZFS features](https://aws.amazon.com/fsx/openzfs/features) · [Amazon EFS quotas](https://docs.aws.amazon.com/efs/latest/ug/limits.html) · [S3 Express One Zone](https://aws.amazon.com/s3/storage-classes/express-one-zone) · [Amazon EC2 P6](https://aws.amazon.com/ec2/instance-types/p6) — AWS. 처리량 상한
- [Mountpoint for Amazon S3 사용 문서](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mountpoint-usage.html) · [CSI v2 발표](https://aws.amazon.com/about-aws/whats-new/2025/08/mountpoint-amazon-s3-csi-driver-performance-selinux) — AWS. 쓰기 제약, 공유 캐시
- [Google Cloud Managed Lustre release notes](https://docs.cloud.google.com/managed-lustre/docs/release-notes) · [performance tiers](https://docs.cloud.google.com/managed-lustre/docs/performance-tiers) · [GKE Managed Lustre CSI driver](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/managed-lustre) — Google Cloud. 티어, CSI 조건
- [GKE Hyperdisk ML](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/persistent-volumes/hyperdisk-ml) · [Cloud Storage FUSE CSI driver](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/cloud-storage-fuse-csi-driver) · [GKE, Run:ai Model Streamer](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/persistent-volumes/run-ai-model-streamer) — Google Cloud. 모델 배포, 파일 캐시
- [Google Cloud 블로그, AI·HPC 스토리지 발표](https://cloud.google.com/blog/products/storage-data-transfer/high-performance-storage-innovations-for-ai-hpc) — 2025-04. Anywhere Cache·Rapid 수치
- [What is Azure Managed Lustre](https://learn.microsoft.com/en-us/azure/azure-managed-lustre/amlfs-overview) · [Azure Managed Lustre MLPerf Storage v3.0 results](https://docs.azure.cn/en-us/azure-managed-lustre/mlperf-storage-v3-results) — Microsoft. 티어, 체크포인트 표
- [NVIDIA AIStore at MLPerf Storage v3.0](https://aistore.nvidia.com/blog/2026/09/01/mlperf-storage-v3) — 2026-09-01. 오브젝트 원본 실측
- [MLPerf Storage Rules](https://github.com/mlcommons/storage/blob/main/Rules.md) — 에디션 3.0. 워크로드 정의
- [StorageReview, MLPerf Storage v3.0](https://storagereview.com/news/mlperf-storage-v3-0-877-gib-s-checkpoints-a-cloud-first-and-a-leaderboard-turned-over) · [Blocks & Files, MLPerf Storage v3.0](https://www.blocksandfiles.com/ai-ml/2026/09/01/mlperf-storage-benchmark-updated-for-modern-ai/5293617) — 결과 표, 참가·불참
- [DGX SuperPOD B300 RA, High Performance Storage Architecture](https://docs.nvidia.com/dgx-superpod/reference-architecture/scalable-infrastructure-b300/latest/storage-architecture.html) — NVIDIA. 동기 체크포인트 전제, 로컬 NVMe
- [ByteCheckpoint, NSDI '25](https://www.usenix.org/conference/nsdi25/presentation/wan-borui) — 정지 시간, HDFS 백엔드
- [NVIDIA GPU Operator, GPUDirect RDMA and GPUDirect Storage](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-operator-rdma.html) — NVIDIA. nvidia-fs 로드 조건
- [NVIDIA Dynamo, KV cache offloading](https://docs.dynamo.nvidia.com/dynamo/backends/v-llm/kv-cache-offloading.md) · [Dynamo LMCache integration(0.7.0 아카이브)](https://docs.nvidia.com/dynamo/archive/0.7.0/backends/vllm/LMCache_Integration.html) — NVIDIA. KV cache 커넥터
- [ANF breakthrough mode](https://www.netapp.com/product-updates/anf-large-volumes-breakthrough-mode/) · [BlobFuse2 개요](https://learn.microsoft.com/en-us/azure/storage/blobs/blobfuse2-what-is) · [캐시 설정](https://learn.microsoft.com/en-us/azure/storage/blobs/blobfuse2-configure-caching) · [Azure SDK 블로그, Blob + Run:ai Model Streamer](https://devblogs.microsoft.com/azure-sdk/eliminate-llm-cold-starts-load-models-up-to-6x-faster-with-azure-blob-storage-and-runai-model-streamer/) — 볼륨당 상한, 파일 캐시, 모델 스트리밍
- [JuiceFS MLPerf Storage 결과](https://juicefs.com/docs/cloud/benchmark/mlperf_storage) · [Alluxio AI](https://www.alluxio.io/enterprise-ai) · [SNIA SDC25 Hammerspace Tier 0](https://www.snia.org/sites/default/files/2025-10/SNIA-SDC25-Christofferson-Activating-Tier0-Storage.pdf) · [DGX B300 사양(Colfax)](https://www.colfax-intl.com/nvidia/nvidia-dgx-b300) — 캐시 계층, 로컬 NVMe
- [MLPerf Storage v2.0 보도(HPCwire)](https://www.hpcwire.com/aiwire/2025/08/05/mlperf-storage-v2-0-results-highlight-storages-role-in-ai-training-at-scale/) · [Blocks & Files, Storage Scale 6.0.0](https://www.blocksandfiles.com/ai-ml/2025/10/20/storage-scale-accelerates-data-for-ai/1615704) · [NVIDIA cuObject](https://docs.nvidia.com/gpudirect-storage/cuobject) — Aurora DAOS, CNSA의 GDS, S3 over RDMA
