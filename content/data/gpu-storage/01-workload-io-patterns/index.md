---
title: "GPU 워크로드의 I/O 요구: 데이터 읽기부터 체크포인트와 캐시까지"
linkTitle: "01 워크로드별 I/O"
description: "GPU 학습·추론에서 데이터 읽기와 모델 적재, 동기·비동기 체크포인트, 데이터·KV 캐시가 스토리지 대역폭과 지연 요구를 어떻게 바꾸는지 설명한다."
weight: 1
date: 2026-10-21
lastmod: 2026-10-21
url: "/gpu-storage/01-workload-io-patterns/"
---

# 01 · GPU 워크로드의 I/O 요구: 데이터 읽기부터 체크포인트와 캐시까지

GPU 클러스터에는 하나의 스토리지 성능 목표를 적용할 수 없습니다. 학습 데이터와 모델을 읽을 때는 대역폭뿐 아니라 CPU 전처리, 파일 수, 로더 구현이 속도를 제한합니다. 체크포인트(복구를 위해 저장하는 학습 상태)는 동기식이면 GPU 정지 시간이, 비동기식이면 다음 체크포인트까지 저장을 끝낼 평균 처리량이 기준이 됩니다.

캐시가 원격 스토리지 부하를 얼마나 줄이는지는 재사용률에 달려 있습니다. 학습 데이터를 로컬에서 다시 읽을 수 있으면 반복 읽기가 공유 스토리지에 도달하지 않을 수 있습니다. KV cache(재계산 가능한 파생 데이터)를 디스크에 둘지는 적중률과 재계산 비용, 저장소에서 다시 읽는 비용을 함께 비교해 판단해야 합니다.

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인. 각 절 끝의 '근거와 측정 조건'에 수치와 조건을 모았습니다. 이 요구를 받아 주는 데이터 경로와 파일시스템은 [02]({{< relref "/data/gpu-storage/02-data-path-and-filesystems/index.md" >}}), 관리형 서비스와 오브젝트, Kubernetes는 [03]({{< relref "/data/gpu-storage/03-managed-object-kubernetes/index.md" >}})에서 다룹니다.

## 1. 데이터 읽기와 모델 적재의 병목을 분리한다 {#1-읽기-대역폭만으로는-설명되지-않는-병목}

GPU 한 대에 필요한 읽기 대역폭은 워크로드마다 다릅니다. DGX SuperPOD 참조 아키텍처는 자율주행·컴퓨터 비전 데이터셋에 GPU당 4 GBps를 제시합니다. MLPerf Storage v3.0의 UNet3D 결과는 가속기 이용률 90% 이상을 유지할 때 가상 B200당 약 5.4~5.8 GiB/s였습니다. MLPerf 값은 시뮬레이터의 연산 시간 모델에서 나온 결과이므로 실제 GPU 요구량으로 일반화하지 않고 스토리지 경로를 상대 비교하는 기준으로만 사용합니다.

같은 데이터양이라도 파일 구성에 따라 읽기 패턴이 바뀝니다. 학습 과정에는 큰 파일의 순차 읽기와 수백 KB 객체의 랜덤 읽기가 모두 나타납니다. SuperPOD 문서는 고성능 스토리지를 작은 랜덤 I/O에 맞추도록 요구합니다.

스토리지가 충분히 빨라도 CPU 전처리나 모델 로더에서 적재가 지연될 수 있습니다. 이미지·비디오 디코딩 부하는 CPU에, 많은 소파일은 메타데이터 서버에, 캐시되지 않은 대규모 데이터는 스토리지 네트워크에 부담을 줍니다. 실제 병목은 이 조건을 나눠 측정해야 찾을 수 있습니다.

NVIDIA의 Run:ai Model Streamer 벤치마크는 같은 모델과 저장소에서도 로더가 적재 시간을 바꿀 수 있음을 보여 줍니다.

| 스토리지 | 기본 Safetensors 로더 | Model Streamer 최적 | 조건 |
|---|---|---|---|
| GP3 SSD(1,000 MiB/s 프로비저닝) | 47.99초 | 14.34초(동시성 16) | 디스크 상한에 근접 |
| IO2 SSD(4,000 MiB/s) | 47초 | 7.53초(동시성 8) | |
| S3 같은 리전 | 지원 안 함 | 4.88초(동시성 32) | Tensorizer는 37.36초 |

GP3 SSD의 적재 시간은 기본 로더 47.99초에서 Model Streamer 14.34초로 줄었습니다. Model Streamer는 여러 스레드가 텐서를 CPU 버퍼로 읽는 동안 다른 텐서를 GPU로 복사해 두 작업을 겹칩니다. 이 시험에서 GP3는 프로비저닝한 처리량에 도달했고, S3는 동시 연결을 늘리자 로컬 SSD보다 짧은 적재 시간을 기록했습니다.

모델 배포 경로도 여러 형태입니다. GCP Hyperdisk ML 문서는 볼륨 하나를 최대 2,500개 노드에 읽기 전용으로 연결해 합산 1.2 TiB/s를 제공한다고 설명합니다. Google은 GCS FUSE 병렬 다운로드가 모델 적재를 최대 9배 단축한다고 주장하고, Azure SDK 블로그는 vLLM이 `az://` URI에서 가중치를 직접 스트리밍하는 방식을 소개합니다. 두 자료 모두 벤더가 공개한 설명입니다.

학습 데이터가 GPU에 도착하기 전에는 CPU 전처리도 거칩니다. NVIDIA DALI 문서는 이 단계가 학습과 추론을 제한했다고 설명합니다. Meta의 DSI 논문은 추천 모델의 전처리 연산이 커서 별도 서비스로 분리한 사례를 보고합니다.

전처리는 대용량 순차 스캔과 셔플, 중간 산출물 쓰기를 반복합니다. 전처리 파이프라인은 주로 S3 API를 사용하고 학습은 POSIX를 선호하므로, 두 경로를 잇는 캐시나 파일 계층이 필요하다고 해석했습니다. 전처리를 CPU 노드에서 실행하는 구성이라면 공유 스토리지에 CPU 분석 클러스터도 접근할 수 있어야 한다고 해석했습니다. 관련 구성은 [03]({{< relref "/data/gpu-storage/03-managed-object-kubernetes/index.md" >}})에서 이어집니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 스토리지 | 기본 Safetensors 로더 | Model Streamer 최적 | 조건 |
|---|---|---|---|
| GP3 SSD(1,000 MiB/s 프로비저닝) | 47.99초 | 14.34초(동시성 16) | 디스크 상한에 근접 |
| IO2 SSD(4,000 MiB/s) | 47초 | 7.53초(동시성 8) | |
| S3 같은 리전 | 지원 안 함 | 4.88초(동시성 32) | Tensorizer는 37.36초 |

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 위 표의 측정 조건 | AWS g5.12xlarge, A10G GPU 1개, Llama 3 8B 15 GB 단일 safetensors. GPU 적재 시간 | NVIDIA 블로그, Run:ai Model Streamer | `Ⓑ` |
| 엔진 준비까지의 총 시간 | vLLM 엔진이 준비될 때까지 GP3에서 66.13초가 35.08초로, S3에서 23.18초로 감소 | NVIDIA 블로그, Run:ai Model Streamer | `Ⓑ` |
| Model Streamer의 구조 | 여러 스레드가 텐서를 CPU 버퍼로 읽는 동안 다른 텐서를 GPU로 복사해 두 단계를 겹침 | NVIDIA 블로그, Run:ai Model Streamer | `✓` |
| 70B 모델의 크기와 읽기 시간 | BF16 약 140 GB. 1 GB/s 디스크로 2분 초과 | 보고서 계산 | `≈` |
| S3 경로의 처리량 | 15 GB를 4.88초에 읽으면 약 3 GB/s. 네트워크 쪽 한계에 가까웠다는 추정 | 위 수치에서 계산 | `≈` |
| Hyperdisk ML의 규모 | 볼륨 하나를 최대 2,500 노드에 읽기 전용으로 연결, 합산 1.2 TiB/s | GKE Hyperdisk ML 문서 | `✓` |
| GCS FUSE 병렬 다운로드 | 1 GB 넘는 파일 읽기와 모델 로딩용. 모델 로딩이 최대 9배 빨라진다는 Google의 주장 | Cloud Storage FUSE CSI driver 문서 | `Ⓥ` |
| Azure Blob 직접 스트리밍 | vLLM이 `az://` URI로 Blob에서 가중치를 바로 스트리밍 | Azure SDK 블로그 | `Ⓥ` |
| 학습 로딩 병목의 세 후보 | CPU 디코딩, 메타데이터 서버, 스토리지 네트워크 대역폭. 순서는 워크로드마다 다름 | 보고서 해석 | `≈` |
| CPU 전처리가 병목이 됨 | CPU에서 도는 전처리 파이프라인이 학습과 추론의 병목이 됐다는 서술 | NVIDIA DALI 문서 | `✓` |
| DGX-2 ResNet-50 사례 | 실제 파이프라인 초당 12,586장, 합성 데이터 초당 22,656장. 구세대 하드웨어 | NVIDIA DALI ResNet50 사례 | `Ⓥ` |
| 전처리 분리 서비스 | 추천 모델 학습에서 전처리를 분리된 서비스(DPP)로 빼야 할 만큼 연산이 큼. 전력 수치는 원문에서 확인하지 못함 | Meta, DSI 논문(ISCA 2022) | `✓` |
| 대부분의 DL 워크로드는 읽기 지배적 | 고성능 스토리지는 작은 랜덤 I/O에 최적화돼야 한다고 요구 | DGX SuperPOD B300 RA, 스토리지 아키텍처 | `✓` |
| GPU당 읽기 대역폭 기준점 | 자율주행·컴퓨터 비전 데이터셋에 GPU당 4 GBps 읽기 | DGX SuperPOD B300 RA, 스토리지 아키텍처 | `✓` |
| MLPerf v3.0 UNet3D 가상 B200당 대역폭 | Azure Managed Lustre는 B200 70개에 379.1 GiB/s. AIStore는 B200당 5.77~5.83 GiB/s. 가속기 이용률 90% 이상 유지 조건 | Azure Managed Lustre MLPerf v3.0 결과, AIStore 블로그 | `Ⓑ` |
| 위 수치는 시뮬레이터 모델의 값 | 실제 GPU 연산 속도가 아니라 시뮬레이터가 정한 연산 시간 모델에서 나옴 | 보고서 해석 | `≈` |
| 샘플 크기 기본값 | OPEN 기본값은 3D U-Net이 `.npz` 하나에 샘플 1개, ResNet-50이 `.tfrecord` 하나에 샘플 1251개 | MLPerf Storage Rules(에디션 3.0) | `✓` |
| 3D U-Net 샘플은 약 140 MB | 2차 자료 여럿의 설명 | 2차 자료 | `≈` |
| RetinaNet 객체 크기 | 약 315 KiB | AIStore 블로그 | `Ⓑ` |
| 전처리의 I/O 패턴 | 대용량 순차 스캔, 셔플, 중간 산출물 쓰기 반복 | 보고서 해석 | `≈` |
| 3FS GraySort | 110.5 TiB를 30분 14초에 정렬. 스토리지 노드 25대(400 Gbps NIC 2개씩), 컴퓨트 노드 50대. 자체 측정 | DeepSeek 3FS README | `Ⓑ` |
| 전처리는 CPU 노드에서 도는 경우가 많음 | 공유 스토리지는 CPU 분석 클러스터에서도 접근 가능해야 함 | 보고서 해석 | `≈` |
| 오브젝트가 원본이 되는 이유 | 전처리 파이프라인(Spark 등)은 S3 API 기본, 학습은 POSIX 선호. 만나는 곳에 캐시·파일 계층 | 보고서 해석 | `≈` |

{{% /details %}}

## 2. 체크포인트는 정지 시간과 최종 저장 시간을 나눠 계산한다 {#2-체크포인트는-학습-정지와-저장-완료를-나눠-본다}

동기 체크포인트는 기록이 끝날 때까지 학습을 멈추므로 스토리지 쓰기 시간이 곧 GPU 대기 시간이 됩니다. 비동기 체크포인트는 저장이 끝나기 전에 학습을 재개하고 기록을 이어 갑니다.

MLPerf Storage 규칙에서 정의한 Llama 3 계열 체크포인트 크기는 파라미터 수에 거의 비례합니다.

| 모델 | 체크포인트 크기 | CLOSED 프로세스 수 | 병렬화 TP×PP×DP | 출처 | 근거 |
|---|---|---|---|---|---|
| 8B | 105 GiB | 8 | 1×1×8 | MLPerf Storage Rules(에디션 3.0) | `✓` |
| 70B | 912 GiB | 64 | 8×1×8 | MLPerf Storage Rules(에디션 3.0) | `✓` |
| 405B | 5.29 TiB | 512 | 8×32×2 | MLPerf Storage Rules(에디션 3.0) | `✓` |
| 1T | 18 TiB | 1024 | 8×64×2 | MLPerf Storage Rules(에디션 3.0) | `✓` |

Llama 3 논문은 짧은 시간에 쓰기가 몰리는 체크포인트를 스토리지 패브릭에서 처리하기 어려운 부하로 설명합니다. 405B 사전학습은 54일 동안 466번 중단됐습니다. 체크포인트 간격을 늘리면 저장 부하는 줄지만 중단 뒤 다시 계산해야 할 작업량은 커집니다.

PyTorch DCP의 `async_save`는 GPU 데이터를 CPU 메모리로 복사할 때만 학습을 멈추고, 이후 디스크 기록을 CPU 스레드에 맡깁니다. PyTorch 블로그의 IBM 7B 사례에서 정지 시간은 148.8초에서 6.3초로 줄었습니다. ByteCheckpoint 논문도 70B와 405B 실험에서 1초 미만의 정지 시간을 보고했습니다.

비동기 방식에서도 백그라운드 쓰기는 다음 체크포인트 전에 끝나야 합니다. 필요한 평균 대역폭은 체크포인트 크기를 저장 간격으로 나눠 구합니다. 5.29 TiB를 10분마다 저장하는 계산에서는 약 9 GiB/s가 필요합니다. Azure Managed Lustre의 MLPerf v3.0 결과는 같은 크기를 457 GiB/s로 11.76초에 기록했습니다. 동기 방식은 이와 같은 피크 처리량으로 정지 시간을 줄이고, 비동기 방식은 저장 간격 안에 완료할 평균 처리량을 확보합니다. SuperPOD 참조 아키텍처는 LLM의 쓰기 성능으로 읽기 성능의 절반 이상을 권장합니다.

복구 시에는 모든 랭크(분산 학습 프로세스)가 체크포인트를 동시에 읽어 읽기 부하도 짧은 시간에 집중됩니다. MLPerf v3.0은 쓰기와 복구 읽기를 모두 측정하며 각 쓰기를 `fsync`로 마치도록 규정합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 모델 | 체크포인트 크기 | CLOSED 프로세스 수 | 병렬화 TP×PP×DP | 출처 | 근거 |
|---|---|---|---|---|---|
| 8B | 105 GiB | 8 | 1×1×8 | MLPerf Storage Rules(에디션 3.0) | `✓` |
| 70B | 912 GiB | 64 | 8×1×8 | MLPerf Storage Rules(에디션 3.0) | `✓` |
| 405B | 5.29 TiB | 512 | 8×32×2 | MLPerf Storage Rules(에디션 3.0) | `✓` |
| 1T | 18 TiB | 1024 | 8×64×2 | MLPerf Storage Rules(에디션 3.0) | `✓` |

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 파라미터당 약 14바이트 | BF16 가중치 2바이트 + FP32 마스터 가중치 4바이트 + Adam 모멘트 두 개 8바이트와 맞음 | 위 표에서 계산 | `≈` |
| 버스트성 쓰기가 가장 어려운 문제 | 스토리지 패브릭은 Tectonic, SSD 서버 7,500대, 240 PB, 지속 2 TB/s, 피크 7 TB/s. GPU 하나가 저장하는 상태는 1 MB~4 GB. 학습 규모는 H100 최대 16K개 | Llama 3 논문 3.3절 | `✓` |
| 작업 중단 466번 | Llama 3 405B 사전학습 54일 구간. 예기치 않은 중단 419번, 약 78%가 하드웨어 원인 | Llama 3 논문 3.3절 | `✓` |
| 하루 평균 8번 넘게 멈춤 | 466번을 54일로 나눈 값 | 위 수치에서 계산 | `≈` |
| 동기 체크포인트는 학습을 멈춤 | 체크포인트가 수 TB일 수 있음. LLM 용도에는 읽기 성능의 절반 이상을 쓰기 성능으로 권장 | DGX SuperPOD B300 RA, 스토리지 아키텍처 | `✓` |
| DCP `async_save`의 구조 | GPU에서 CPU 메모리로 복사하는 동안만 학습이 멈추고(7B~13B 기준 6~14초), 디스크 기록은 CPU 스레드가 처리 | PyTorch 블로그 | `✓` |
| IBM 7B 사례의 정지 시간 | 148.8초에서 6.3초. 단일 사례 | PyTorch 블로그 | `Ⓑ` |
| ByteCheckpoint의 정지 시간 | 70B를 GPU 4,800개로 학습할 때 0.36초, 405B를 GPU 8,960개로 학습할 때 0.59초. 같은 405B 구성에서 저장 완료까지 51.06초, 로드 129.49초 | ByteCheckpoint, NSDI '25 | `Ⓑ` |
| ByteCheckpoint의 주 백엔드 | HDFS | ByteCheckpoint, NSDI '25 | `✓` |
| 스토리지가 감당할 평균 쓰기 대역폭 | 체크포인트 크기 ÷ 체크포인트 간격 | 보고서 해석 | `≈` |
| 405B 체크포인트 쓰기 시간 | 5.29 TiB를 457 GiB/s로 11.76초. Azure Managed Lustre의 MLPerf v3.0 결과 | Azure Managed Lustre MLPerf v3.0 결과 | `Ⓑ` |
| 10분 간격 비동기 저장의 평균 대역폭 | 같은 5.29 TiB 기준 약 9 GiB/s | 위 수치에서 계산 | `≈` |
| 복구 읽기 측정 방식 | 쓰기 10회 뒤 읽기 10회. 각 쓰기는 fsync로 끝나야 함 | MLPerf Storage Rules(에디션 3.0) | `✓` |

{{% /details %}}

## 3. 데이터 캐시와 KV cache는 재사용률로 평가한다 {#3-캐시-재사용과-kv-cache-계층}

학습 데이터가 노드 RAM이나 로컬 NVMe에 들어가는 구성에서는 첫 에포크(데이터셋을 한 번 읽는 학습 구간) 뒤 공유 스토리지 부하가 크게 줄어들 것으로 추정했습니다. SuperPOD 문서는 로컬 NVMe를 캐싱과 스테이징에 쓰고 첫 읽기 뒤에는 데이터를 로컬에서 재사용하는 구성을 권합니다. MLPerf는 이런 페이지 캐시 효과가 측정에 섞이지 않도록 충분히 큰 데이터셋을 요구합니다.

KV cache는 저장된 값을 읽는 비용과 다시 계산하는 비용을 비교해야 합니다. 공개 모델 설정으로 계산하면 Llama 3.1 70B의 KV cache는 토큰당 약 320 KiB이며 128K 토큰 문맥 하나는 약 40 GiB입니다. 디스크 계층의 이득은 캐시 적중률, prefill 재계산 시간, 스토리지 읽기 시간을 함께 측정해야 판단할 수 있습니다.

LMCache 논문은 약 10K 토큰 문맥의 다중 라운드 Q&A에서 QPS(초당 요청 수)가 낮을 때 TTFT(첫 토큰까지의 시간)가 1.9~8.1배 짧아졌다고 보고합니다. 이 결과는 CPU 메모리를 저장 계층으로 사용한 조건입니다.

NVIDIA는 KV cache 저장 위치를 G1 HBM, G2 호스트 DRAM, G3 로컬 SSD, G4 공유 스토리지로 구분합니다. 로컬 SSD는 노드에 종속되고 공유 스토리지의 지연은 밀리초 단위입니다. 2026년에는 두 계층 사이에 이더넷 연결 플래시인 G3.5 CMX(이전 이름 ICMS)를 추가했습니다. BlueField-4 DPU가 NVMe-oF와 오브젝트·RDMA 프로토콜을 종단하고, Dynamo의 KV 블록 매니저는 다음 decode 전에 G3.5 블록을 G2·G1으로 올립니다. 계층 간 전송은 NIXL이 담당하며 vLLM 백엔드에는 LMCache와 FlexKV를 연결합니다.

WEKA는 Augmented Memory Grid를, DDN은 Dynamo와 연동하는 Infinia·EXAScaler KV cache를, VAST는 BlueField-4에서 CNode를 실행하는 구성을 소개합니다. IBM은 KV cache Redbook을 공개했습니다. 관련 성능 수치는 모두 벤더 주장입니다.

NVIDIA는 재계산할 수 있는 KV cache를 G4에서 복제·보호하면 지연과 전력 비용만 늘어난다고 주장합니다. CMX가 TPS(초당 토큰 수)를 최대 5배 높인다는 수치도 NVIDIA가 제시한 값입니다. MLPerf Storage v3.0은 KVCache를 별도 워크로드로 두고 집계 읽기 대역폭, P95 지연, tokens/s를 측정합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 첫 읽기 후 로컬 재사용 | DGX 로컬 NVMe를 캐싱·스테이징에 사용. 이상적으로는 처음 읽을 때 캐시해 네트워크로 다시 가져오지 않음 | DGX SuperPOD B300 RA, 스토리지 아키텍처 | `✓` |
| MLPerf의 캐시 효과 차단 | 데이터셋 크기는 클라이언트 호스트 메모리 합의 5배와 에포크당 500 스텝 중 큰 값 이상 | MLPerf Storage Rules(에디션 3.0) | `✓` |
| 데이터셋이 RAM·로컬 NVMe에 들어가면 공유 스토리지 부하가 줄어듦 | 첫 에포크 뒤 크게 감소 | 보고서 해석 | `≈` |
| 토큰당 KV 크기 | 2 × 레이어 수 × KV 헤드 수 × 헤드 차원 × 바이트. Llama 3.1 70B(80 레이어, KV 헤드 8개, 헤드 차원 128, BF16)는 토큰당 약 320 KiB, 128K 토큰 문맥 하나가 약 40 GiB. 8B(32 레이어)는 토큰당 약 128 KiB | 공개 모델 설정으로 계산 | `≈` |
| KV cache 계층 G1~G4 | G1 HBM, G2 호스트 DRAM, G3 로컬 SSD, G4 공유 스토리지. G3는 노드에 묶여 확장이 어렵고 G4는 밀리초 단위 지연 | NVIDIA 기술 블로그, BlueField-4 CMX(2026-03-16) | `✓` |
| G3.5 계층 | BlueField-4 DPU가 NVMe-oF와 오브젝트·RDMA 프로토콜을 종단하는 이더넷 연결 플래시 계층(CMX, 이전 이름 ICMS) | NVIDIA 기술 블로그, BlueField-4 CMX | `✓` |
| KV cache는 내구성이 필요 없다는 논리 | 일시적이고 파생된 데이터이며 재계산 가능. G4의 복제·보호는 KV에 지연과 전력만 더한다는 NVIDIA의 주장 | NVIDIA 기술 블로그, BlueField-4 CMX | `✓` |
| CMX의 성능 | 최대 5배 TPS | NVIDIA 기술 블로그, BlueField-4 CMX | `Ⓥ` |
| 소프트웨어 경로 | Dynamo의 KV 블록 매니저가 다음 decode 전에 블록을 G3.5에서 G2·G1로 미리 올림. 계층 간 전송은 NIXL | NVIDIA 기술 블로그, BlueField-4 CMX | `✓` |
| vLLM 백엔드의 확장 | LMCache(CPU RAM, 로컬 스토리지, Redis, GDS, InfiniStore/Mooncake), FlexKV(GPU·CPU·SSD 다단 캐시, io_uring과 GDS 사용) | Dynamo KV cache offloading 문서, LMCache 문서 | `✓` |
| LMCache의 TTFT 효과 | 약 10K 토큰 문맥의 다중 라운드 Q&A, CPU 메모리 최대 500 GB 오프로드, 낮은 QPS에서 TTFT 1.9~8.1배 감소 | LMCache 논문 arXiv 2510.09665 | `Ⓑ` |
| 이득의 출처 | 캐시 적중률. 디스크 계층의 이득은 prefill 재계산 비용 대 스토리지 읽기 비용의 비교 | 보고서 해석 | `≈` |
| MLPerf v3.0 KVCache 워크로드 | Llama 3.1 8B·70B. 집계 읽기 대역폭, P95 지연, tokens/s. 캐시와 결과 디렉터리는 다른 파일시스템. S3는 POSIX 마운트로만 사용 | MLPerf Storage Rules(에디션 3.0) | `✓` |
| FlashBlade//EXA의 KVCache 결과 | 51 호스트 구성에서 1,623.4 GiB/s. 벤더 제출, 감사됨 | StorageReview, MLPerf Storage v3.0 | `Ⓑ` |
| 스토리지 벤더 대응 | WEKA Augmented Memory Grid, DDN의 Dynamo 연동 KV cache(Infinia·EXAScaler), IBM의 KV cache Redbook(존재 확인), VAST의 BlueField-4 위 CNode 실행 | 벤더 자료 | `Ⓥ` |
| DeepSeek 3FS의 KVCache 용도 | 클라이언트 노드당 최대 40 GiB/s 읽기(400 Gbps NIC 1개). 자체 측정 | DeepSeek 3FS README | `Ⓑ` |

{{% /details %}}

## 확인하지 못한 것

- 체크포인트 주기의 업계 표준값. 논문은 "100 스텝마다" 같은 실험 조건을 밝히지만, 이를 일반적인 저장 주기로 볼 근거는 없다.
- CMX(G3.5)의 실제 성능과 출하 시점. NVIDIA 블로그의 성능 수치는 "최대 5배"이며, 측정 조건·파트너 목록·출하 일정은 원문에 없다.
- GB300 NVL72와 Vera Rubin 랙의 스토리지 요구 수치. 확인한 것은 B300 참조 아키텍처의 표다. DGX B300과 GB300 NVL72는 다른 플랫폼이므로 수치를 옮겨 적용할 수 없다.

## 참고 자료

- [DGX SuperPOD B300 RA, High Performance Storage Architecture](https://docs.nvidia.com/dgx-superpod/reference-architecture/scalable-infrastructure-b300/latest/storage-architecture.html) — 읽기 지배적 워크로드, GPU당 4 GBps, 동기 체크포인트와 쓰기 권장 비율
- [The Llama 3 Herd of Models](https://arxiv.org/abs/2407.21783) — 3.3절. 스토리지 패브릭, 버스트성 체크포인트, 작업 중단 466번
- [MLPerf Storage Rules(에디션 3.0)](https://github.com/mlcommons/storage/blob/main/Rules.md) — 체크포인트 크기 표, 데이터셋 크기 규칙, KVCache 워크로드
- [Azure Managed Lustre MLPerf Storage v3.0 results](https://docs.azure.cn/en-us/azure-managed-lustre/mlperf-storage-v3-results) — UNet3D 379.1 GiB/s, 405B 체크포인트 쓰기 457 GiB/s
- [NVIDIA AIStore at MLPerf Storage v3.0](https://aistore.nvidia.com/blog/2026/09/01/mlperf-storage-v3) — B200당 읽기 대역폭, RetinaNet 객체 크기
- [StorageReview, MLPerf Storage v3.0](https://storagereview.com/news/mlperf-storage-v3-0-877-gib-s-checkpoints-a-cloud-first-and-a-leaderboard-turned-over) — FlashBlade//EXA KVCache 결과
- [PyTorch 블로그, Reducing Model Checkpointing Times](https://pytorch.org/blog/reducing-checkpointing-times/) — DCP `async_save`, IBM 7B 사례
- [ByteCheckpoint, NSDI '25](https://www.usenix.org/conference/nsdi25/presentation/wan-borui) · [arXiv 본문](https://arxiv.org/html/2407.20143v4) — 비동기 체크포인트 정지 시간, HDFS 백엔드
- [NVIDIA 블로그, Run:ai Model Streamer](https://developer.nvidia.com/blog/reducing-cold-start-latency-for-llm-inference-with-nvidia-runai-model-streamer) — 모델 로딩 벤치마크
- [GKE Hyperdisk ML](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/persistent-volumes/hyperdisk-ml) — 볼륨 하나를 2,500 노드에 읽기 전용으로 연결
- [Cloud Storage FUSE CSI driver, file cache](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/cloud-storage-fuse-csi-driver) — 병렬 다운로드와 모델 로딩 가속 주장
- [Azure SDK 블로그, Blob + Run:ai Model Streamer](https://devblogs.microsoft.com/azure-sdk/eliminate-llm-cold-starts-load-models-up-to-6x-faster-with-azure-blob-storage-and-runai-model-streamer/) — Blob에서 가중치 직접 스트리밍
- [NVIDIA 기술 블로그, BlueField-4 CMX](https://developer.nvidia.com/blog/introducing-nvidia-bluefield-4-powered-inference-context-memory-storage-platform-for-the-next-frontier-of-ai/) — G1~G4 계층, G3.5, KV cache 내구성 논리
- [NVIDIA Dynamo, KV cache offloading](https://docs.dynamo.nvidia.com/dynamo/backends/v-llm/kv-cache-offloading.md) · [LMCache storage backends](https://docs.lmcache.ai/kv_cache/storage_backends/index.html) — KV 오프로드 소프트웨어 경로
- [LMCache 논문](https://arxiv.org/abs/2510.09665) — TTFT 감소 실측
- [DeepSeek 3FS README](https://github.com/deepseek-ai/3FS) — KVCache 읽기 대역폭, GraySort
- [NVIDIA DALI 문서](https://docs.nvidia.com/deeplearning/dali/main-user-guide/docs/index.html) · [ResNet50 DALI 사례](https://developer.nvidia.com/blog/case-study-resnet50-dali) — CPU 전처리 병목
- [Meta, Understanding Data Storage and Ingestion for Large-Scale Deep Recommendation Model Training](https://arxiv.org/abs/2108.09373) — 전처리 분리 서비스
