---
title: "빠른 GPU와 느린 네트워크 사이의 Horovod v0.21"
description: "GPU 처리 속도를 네트워크가 따라가지 못할 때 Horovod v0.21은 그래디언트를 로컬에 누적해 통신 부담을 줄입니다. 그룹 Allreduce로 조율 지연과 비결정성을 줄이는 방법, Ray와 Databricks에서 학습을 실행하는 조건을 함께 설명합니다."
date: 2026-11-10
weight: 18
---

# 빠른 GPU와 느린 네트워크 사이의 Horovod v0.21 (2020-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Horovod v0.21: Optimizing Network Utilization with Local Gradient Aggregation and Grouped Allreduce](https://www.uber.com/us/en/blog/horovod-v0-21/)
- 매체 · 게시일: Uber Engineering Blog · 2020-11-24
- 저자: Kerri Brown
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

GPU는 배치를 빠르게 처리하는데, 네트워크는 그래디언트를 그만큼 빠르게 보내지 못하는 환경이 있습니다. 이때는 계산보다 통신이 학습 처리량을 제한합니다. Horovod v0.21은 이런 환경을 위한 로컬 그래디언트 집계를 TensorFlow까지 넓히고, 텐서를 묶는 방식을 사용자가 직접 정하는 그룹 Allreduce를 추가했습니다.

## 통신 한 번에 계산을 늘리는 로컬 그래디언트 집계 {#local-gradient-aggregation}

로컬 그래디언트 집계를 켜면 배치를 처리할 때마다 통신하지 않습니다. 이전 통신 이후 계산한 그래디언트를 GPU 메모리에 계속 더해 두었다가, 미니배치 N개를 처리한 뒤 한 번 allreduce로 워커 간 평균을 내고 모델을 갱신합니다.

통신 한 번당 계산량이 늘어납니다. 유효 배치 크기를 키우면서 통신 부담을 N분의 1로 줄이는 효과입니다. 실제 배치 크기를 늘릴 때와 달리, 이렇게 늘린 유효 배치 크기는 GPU 메모리 용량의 제한을 받지 않습니다. 통신이 학습 처리량을 제한하는 환경에서 이 기능을 켜도록 권하는 이유입니다.

이전까지는 PyTorch에서만 지원하던 기능이었습니다. Determined AI의 Aaron Harlap과 Neil Conway가 v0.21에서 TensorFlow v1·v2의 eager·graph 모드와 Keras까지 지원을 넓혔습니다. 사용할 때는 Horovod 옵티마이저의 `backward_passes_per_step`에 집계할 미니배치 수 N을 지정합니다.

## 버퍼에 들어갈 순서를 정하는 그룹 Allreduce {#grouped-allreduce}

기존 텐서 퓨전은 준비된 작은 요청부터 그때그때 묶습니다. 그룹 Allreduce는 묶을 텐서를 먼저 정합니다. `hvd.grouped_allreduce`에 넘긴 텐서 목록 전체가 논리적으로 하나의 요청이 되며, 백엔드는 목록의 텐서가 모두 준비될 때까지 기다린 뒤 처리합니다.

이 아이디어는 슈퍼컴퓨터 규모에서 Horovod를 최적화한 논문 “Exascale Deep Learning for Scientific Inverse Problems”에서 나왔습니다. Nvidia가 이를 v0.21의 일반 API로 만들었으며, Josh Romero가 그룹 Allreduce와 다른 성능 개선에 기여했습니다.

### 퓨전을 유지하면서 고정하는 합산 순서

퓨전 버퍼를 동적으로 채우면 텐서가 들어가는 위치가 달라집니다. 그 위치가 합산 순서에 영향을 주므로, allreduce 결과가 비결정적일 수 있습니다. 기존 대응은 `HOROVOD_FUSION_THRESHOLD=0`으로 퓨전을 끄는 것이었고, 처리량 손실이 따랐습니다.

명시적인 그룹을 쓰면 퓨전을 유지하면서 버퍼를 채우는 순서를 고정할 수 있습니다. 조건이 붙습니다. `HOROVOD_DISABLE_GROUP_FUSION`을 설정해 그룹들이 더 큰 그룹으로 합쳐지는 동작까지 막아야, 학습 반복이 바뀌거나 작업을 다시 실행해도 같은 순서를 유지합니다. 그룹을 다시 합치면 비결정성이 돌아올 수 있기 때문입니다.

### 짧은 사이클에도 유지되는 메시지 크기

조율 지연을 줄이려면 `HOROVOD_CYCLE_TIME`을 낮춰야 합니다. 그런데 기존에는 사이클 시간과 퓨전 메시지 크기가 밀접하게 묶여 있었습니다. 사이클을 짧게 하면서도 메시지가 너무 작아지지 않도록 유지하기 어려웠습니다.

그룹을 명시하면 이 제약을 풀 수 있습니다. 사이클 시간은 필요한 만큼 낮추고, 메시지 크기는 네트워크 효율에 맞게 유지합니다. 준비된 요청을 언제 모으느냐에 맡기던 텐서 구성을 사용자가 직접 정한 효과입니다.

그룹을 자동으로 나누려면 `DistributedOptimizer`의 `num_groups`에 그룹 수를 지정합니다. Horovod가 그래디언트 텐서 목록을 그 수만큼 나눕니다. 어느 텐서를 함께 처리할지 직접 정하려면 텐서 목록에 `hvd.grouped_allreduce`를 호출합니다.

## Ray와 Databricks에서 넓어진 Horovod의 실행 환경 {#spark-estimators}

### Spark가 GPU를 배정하는 Databricks

Horovod Spark Estimator는 PySpark 파이프라인 안에서 Horovod로 딥러닝 모델을 학습하게 해 줍니다. Databricks의 Liang Zhang과 Xiangrui Meng가 런타임 연동에 기여하면서, v0.21.0부터 Databricks Runtime for Machine Learning(AWS, Azure)에서도 사용할 수 있게 됐습니다.

시작할 때는 `DBFSLocalStore`를 만듭니다. Databricks File System의 로컬 파일 API를 이용해 중간 학습 데이터와 학습 산출물을 보관하는 저장소입니다.

GPU 배정은 Spark가 맡습니다. Apache Spark 3.0에서 도입한 GPU 인식 스케줄링이 Databricks Runtime 7.0 ML GPU 이상에는 미리 설정돼 있습니다. Estimator API를 쓰면 Horovod가 워커의 GPU 수만큼 태스크를 띄우고, 각 태스크를 Spark가 할당한 GPU 하나에 고정합니다.

더 세밀하게 제어하려면 Run API에 학습 로직을 담은 람다를 넘깁니다. 이때 `horovod.spark.task`의 `get_available_devices()`로 호출한 Spark 태스크에 할당된 GPU 목록을 얻습니다. `keras_spark3_rossmann.py`가 이 방식을 보여 주는 예제입니다.

### 인스턴스가 오가는 Ray의 Elastic Horovod

Elastic Horovod는 v0.20에서 도입한 TensorFlow·PyTorch용 자동 확장·장애 허용 API입니다. v0.21에서는 Horovod on Ray의 `ElasticRayExecutor`를 써서 기존 Ray 클러스터에 이런 학습 작업을 몇 줄의 코드로 띄울 수 있게 됐습니다.

학습 도중 인스턴스가 사라져도 됩니다. Elastic Horovod는 인스턴스가 들어오고 나가는 스팟·선점형 클라우드 환경에서도 안전하게 학습을 이어 가며, Ray 위에서 장애 허용과 자동 확장을 함께 제공합니다. Anyscale의 Richard Liaw가 Horovod on Ray, Elastic Horovod on Ray와 Ray Tune 연동에 기여했습니다.

## Horovod v1.0을 준비하는 커뮤니티 {#next}

Horovod는 2017년에 오픈소스로 공개된 뒤 수백 개 GPU로 딥러닝 학습을 확장하는 업계 표준으로 자리 잡았습니다. 기존 TensorFlow, PyTorch, Apache MXNet 스크립트에 파이썬 코드 몇 줄을 보태 며칠·몇 주 걸리던 학습을 몇 시간·몇 분으로 줄일 수 있는 도구입니다. v0.21을 소개할 무렵 GitHub 별은 1만 개를 넘었고, 프로젝트는 Linux Foundation for AI & Data에서 졸업 단계에 올랐습니다.

기여는 새 기능에만 머물지 않았습니다. G-Research의 Enrico Minack은 Spark 연동과 CI 개선을, Amazon의 Leonard Lausen은 MXNet 지원과 빌드 시스템 개선을 도왔습니다. Intel의 Nicolas Castet은 빌드 시스템을 CMake로 이전하는 작업에 기여했습니다.

당시 다음 이정표는 핵심 API와 새 Elastic Horovod API를 굳히는 v1.0이었습니다. 이를 위해 제시한 우선 과제에는 아래 작업이 포함됐습니다.

- 탄력 학습과 데이터 로딩을 단순하게 만드는 상위 API
- TensorFlow·PyTorch·MXNet 사이의 기능 동등성
- 오류 처리와 오류 메시지, 디버깅 편의성 개선
- Elastic Horovod를 이용한 느린 워커의 영향 완화 또는 해당 워커 제거

Anyscale과 협업한 Ray Tune 기반 분산 하이퍼파라미터 탐색도 후속 글로 소개할 예정이었습니다.

{{% details title="v0.21 기능별 설정과 실행 조건" closed="true" %}}

| 항목 | 값 |
|---|---|
| 로컬 그래디언트 집계 | `backward_passes_per_step`에 집계 빈도 N 지정 |
| 그룹 Allreduce 켜기 | `DistributedOptimizer`의 `num_groups` 또는 `hvd.grouped_allreduce` |
| 사이클 시간 | `HOROVOD_CYCLE_TIME` |
| 퓨전 끄기(예전 결정성 방법) | `HOROVOD_FUSION_THRESHOLD=0` |
| 그룹 간 합치기 방지 | `HOROVOD_DISABLE_GROUP_FUSION` |
| Ray 연동 | ElasticRayExecutor |
| Databricks 저장소 | `DBFSLocalStore` |
| GPU 인식 스케줄링 | Spark 3.0, Databricks Runtime 7.0 ML GPU 이상 |

{{% /details %}}
