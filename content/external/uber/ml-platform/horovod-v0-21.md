---
title: "Horovod v0.21의 로컬 그래디언트 집계와 그룹 Allreduce"
description: "우버가 오픈소스로 공개한 분산 학습 프레임워크 Horovod v0.21의 새 기능을 요약합니다. 네트워크 대역폭을 아끼는 로컬 그래디언트 집계와 그룹 Allreduce, Ray와 Databricks 연동을 다룹니다."
date: 2026-11-10
weight: 18
---

# Horovod v0.21의 로컬 그래디언트 집계와 그룹 Allreduce (2020-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Horovod v0.21: Optimizing Network Utilization with Local Gradient Aggregation and Grouped Allreduce](https://www.uber.com/us/en/blog/horovod-v0-21/)
- 매체 · 게시일: Uber Engineering Blog · 2020-11-24
- 저자: Kerri Brown
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## v0.21의 네 가지 변화 {#overview}

Horovod는 2017년에 오픈소스로 공개된 뒤 수백 개 GPU로 딥러닝 학습을 확장하는 업계 표준이 됐습니다. 기존 TensorFlow, PyTorch, Apache MXNet 학습 스크립트에 파이썬 코드 몇 줄을 더하면 학습 시간이 며칠이나 몇 주에서 몇 시간이나 몇 분으로 줄어듭니다. GitHub 별은 1만 개를 넘었고 프로젝트는 Linux Foundation for AI & Data에서 졸업 단계에 올랐습니다.

v0.21은 협력 기업이 하나씩 맡아 기여한 기능으로 채워졌습니다. Determined AI는 TensorFlow v1·v2의 로컬 그래디언트 집계를, Nvidia는 지연을 줄이고 결정성을 높이는 그룹 Allreduce를, Anyscale은 Ray에서 Elastic Horovod 작업을 쉽게 띄우는 기능을, Databricks는 Databricks Runtime에서 Horovod Spark Estimator를 쓰는 기능을 만들었습니다.

## 로컬 그래디언트 집계 {#local-gradient-aggregation}

GPU가 배치를 처리하는 속도가 네트워크가 그래디언트를 실어 나르는 속도보다 훨씬 빠른 환경에서 통신 부담을 줄이는 기법입니다. 그래디언트 갱신을 GPU 메모리에 로컬로 누적하다가, 설정한 미니배치 N개가 쌓이면 그때 한 번 allreduce로 워커 간 평균을 내고 모델에 반영합니다.

효과는 유효 배치 크기를 키우는 것과 같습니다. 다만 실제 배치 크기를 키우면 GPU 메모리가 한계가 되는 반면, 로컬 집계는 그 한계를 받지 않습니다. 통신 한 번당 계산량이 늘어나므로 배치 크기는 커지고 통신 부담은 N분의 1로 줄어듭니다. 통신이 학습 성능의 병목이라면 켜서 처리량을 높일 수 있습니다.

이전에는 PyTorch만 지원했는데 v0.21에서 Determined AI가 TensorFlow v1·v2, eager·graph 모드, Keras까지 전부 지원하도록 기여했습니다. Horovod 옵티마이저를 초기화할 때 `backward_passes_per_step`에 원하는 집계 빈도를 주면 켜집니다.

## 그룹 Allreduce {#grouped-allreduce}

논문 "Exascale Deep Learning for Scientific Inverse Problems"에서 슈퍼컴퓨터 규모 학습의 성능을 끌어올리려고 제안한 아이디어를, Nvidia가 일반 API로 만들어 기여했습니다. `hvd.grouped_allreduce`에 텐서 목록을 주면 그 목록 전체를 논리적으로 하나의 요청으로 보고, 목록의 텐서가 모두 준비돼야 백엔드가 처리합니다. 준비되는 대로 작은 요청을 욕심껏 묶는 기존 텐서 퓨전과 대비됩니다.

이 제어가 필요한 경우는 두 가지입니다. 하나는 조율(negotiation) 지연을 줄이려고 `HOROVOD_CYCLE_TIME`을 낮추면서도 퓨전 메시지가 너무 작아지지 않게 하려는 경우입니다. 예전에는 퓨전 메시지 크기와 사이클 시간이 단단히 묶여 있어 불가능했습니다. 명시적 그룹을 쓰면 사이클 시간을 마음껏 줄이고 메시지 크기는 네트워크 효율에 맞게 유지할 수 있습니다.

다른 하나는 결정적인 결과가 필요한 경우입니다. 퓨전 버퍼를 동적으로 채우면 텐서 위치에 따라 합산 순서가 달라져 결과가 비결정적이 될 수 있습니다. 예전에는 `HOROVOD_FUSION_THRESHOLD=0`으로 퓨전을 끄는 수밖에 없었고 처리량 손실이 따랐습니다. 이제는 그룹을 명시하고 `HOROVOD_DISABLE_GROUP_FUSION`을 설정해 그룹이 더 큰 그룹으로 합쳐지지 않게 하면, 반복과 실행이 달라져도 같은 순서로 버퍼가 채워집니다.

사용법은 두 가지입니다. `DistributedOptimizer`의 `num_groups`를 지정하면 그래디언트 텐서 목록을 요청한 수만큼 자동으로 나눕니다. 그룹 구성을 직접 정하고 싶으면 텐서 목록에 `hvd.grouped_allreduce`를 바로 호출합니다.

## Ray 위의 Elastic Horovod {#elastic-on-ray}

v0.20에서 TensorFlow와 PyTorch용 자동 확장·장애 허용 API인 Elastic Horovod가 나왔습니다. v0.21은 Horovod on Ray의 ElasticRayExecutor로 이런 작업을 몇 줄 코드로 선점형 클라우드 인스턴스에 띄울 수 있게 합니다. 기존 Ray 클러스터에서 장애에 견디는 자동 확장 분산 학습이 가능해지고, 학습 도중 인스턴스가 들락날락하는 스팟·선점형 클러스터에서도 안전하게 학습할 수 있습니다.

## Databricks의 Horovod Spark Estimator {#spark-estimators}

Horovod Spark Estimator는 PySpark 파이프라인의 일부로 Horovod 학습을 돌리게 해 줍니다. v0.21.0부터 Databricks Runtime for Machine Learning(AWS, Azure)에서도 쓸 수 있습니다. 시작은 중간 학습 데이터를 저장할 `DBFSLocalStore`를 만드는 것입니다. 이 저장소는 Databricks File System의 로컬 파일 API로 중간 데이터와 학습 산출물을 보관합니다.

Apache Spark 3.0이 GPU 인식 스케줄링을 추가했고, Databricks Runtime 7.0 ML GPU 이상에는 이 기능이 미리 설정돼 있습니다. Estimator API를 쓰면 Horovod가 워커의 GPU 수만큼 태스크를 띄우고, 각 태스크는 Spark가 할당한 GPU 하나에 고정됩니다. 더 세밀한 제어가 필요하면 학습 로직을 람다로 넘기는 Run API가 있고, `horovod.spark.task`의 `get_available_devices()`가 호출한 Spark 태스크에 할당된 GPU 목록을 돌려줍니다. 예제는 `keras_spark3_rossmann.py`에 있습니다.

## 다음 단계와 기여자 {#next}

다음 이정표는 핵심 API와 새로 도입한 Elastic Horovod API를 굳히는 v1.0입니다. 우선순위는 탄력 학습과 데이터 로딩을 단순하게 하는 상위 API, TensorFlow·PyTorch·MXNet 사이의 기능 동등성, 오류 처리와 메시지와 디버깅 개선, Elastic Horovod에서 느린 워커를 완화하거나 제거하는 기능입니다. Anyscale과 협업한 Ray Tune 기반 분산 하이퍼파라미터 탐색도 앞으로 소개할 예정이라고 합니다.

원문은 기여자를 따로 적어 감사를 전합니다. 로컬 그래디언트 집계는 Determined AI의 Aaron Harlap과 Neil Conway, 그룹 Allreduce와 성능 개선은 Nvidia의 Josh Romero, Horovod on Ray와 Ray Tune 연동은 Anyscale의 Richard Liaw, Databricks Runtime 연동은 Databricks의 Liang Zhang과 Xiangrui Meng가 맡았습니다. G-Research의 Enrico Minack은 Spark 연동과 CI를, Amazon의 Leonard Lausen은 MXNet 연동과 빌드 시스템을, Intel의 Nicolas Castet은 CMake 이전을 도왔습니다.

{{% details title="v0.21에서 다루는 설정 항목" closed="true" %}}

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
