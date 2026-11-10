---
title: "ML 플랫폼·인프라"
description: "우버 엔지니어링 블로그의 ML 플랫폼·인프라 글 33편 목록입니다. 2020년 이후 글 20편은 한국어 요약으로, 나머지는 원문 링크로 정리했습니다."
date: 2026-11-10
weight: 2
comments: false
---

# ML 플랫폼·인프라

## 이 분류에서 찾기 {#section-navigation}

- [피처 일관성을 지키는 추론 시점 피처 로깅 (2026-09)]({{< relref "/external/uber/ml-platform/taming-ml-firehose.md" >}})
- [오픈소스와 자체 인프라로 최적화한 Uber의 LLM 학습 (2026-04)]({{< relref "/external/uber/ml-platform/open-source-and-in-house-how-uber-optimizes-llm-training.md" >}})
- [모델 카탈로그로 시작한 우버의 Responsible AI 프로그램 (2026-04)]({{< relref "/external/uber/ml-platform/scaling-responsible-ai.md" >}})
- [GPU를 놀리지 않는 Petastorm 데이터 로딩과 재현 가능한 학습 (2026-04)]({{< relref "/external/uber/ml-platform/accelerating-deep-learning.md" >}})
- [Michelangelo가 기본으로 깔아 둔 ML 모델 배포 안전망 (2025-10)]({{< relref "/external/uber/ml-platform/raising-the-bar-on-ml-model-deployment-safety.md" >}})
- [Kubernetes 위 Ray 작업을 위한 탄력적 자원 관리 (2025-04)]({{< relref "/external/uber/ml-platform/ubers-journey-to-ray-on-kubernetes-resource-management.md" >}})
- [Kubernetes 위에 세운 연합형 Ray 작업 관리 구조 (2025-04)]({{< relref "/external/uber/ml-platform/ubers-journey-to-ray-on-kubernetes-ray-setup.md" >}})
- [Spark와 Ray를 함께 쓴 라이드 마켓플레이스 예산 최적화 (2025-01)]({{< relref "/external/uber/ml-platform/how-uber-uses-ray-to-optimize-the-rides-business.md" >}})
- [예측 모델에서 생성형 AI까지 8년의 Michelangelo (2024-05)]({{< relref "/external/uber/ml-platform/from-predictive-to-generative-ai.md" >}})
- [우버 AI/ML 인프라의 확장 (2024-03)]({{< relref "/external/uber/ml-platform/scaling-ai-ml-infrastructure-at-uber.md" >}})
- [ML 모델 품질을 점수로 관리하는 Model Excellence Scores (2024-03)]({{< relref "/external/uber/ml-platform/enhancing-the-quality-of-machine-learning-systems-at-scale.md" >}})
- [Palette 피처 스토어의 메타 스토어 재설계 (2024-01)]({{< relref "/external/uber/ml-platform/palette-meta-store-journey.md" >}})
- [조용히 번지는 데이터 이상을 잡는 D3 자동 드리프트 감지 (2023-02)]({{< relref "/external/uber/ml-platform/d3-an-automated-system-to-detect-data-drifts.md" >}})
- [Michelangelo의 ML 모델 성능 튜닝 (2021-07)]({{< relref "/external/uber/ml-platform/tuning-model-performance.md" >}})
- [Ray 위에서 탄력적으로 돌리는 분산 XGBoost 학습 (2021-07)]({{< relref "/external/uber/ml-platform/elastic-xgboost-ray.md" >}})
- [ML 온라인 서빙과 모델의 지속적 통합·배포 (2021-06)]({{< relref "/external/uber/ml-platform/continuous-integration-deployment-ml.md" >}})
- [Ray 위에서 탄력적으로 돌리는 Horovod 딥러닝 학습 (2021-03)]({{< relref "/external/uber/ml-platform/horovod-ray.md" >}})
- [Horovod v0.21의 로컬 그래디언트 집계와 그룹 Allreduce (2020-11)]({{< relref "/external/uber/ml-platform/horovod-v0-21.md" >}})
- [딥러닝 프레임워크를 가리지 않는 추론 엔진 Neuropod (2020-06)]({{< relref "/external/uber/ml-platform/introducing-neuropod.md" >}})
- [자율주행 ML 모델의 생애주기와 버전 관리 플랫폼 VerCD (2020-03)]({{< relref "/external/uber/ml-platform/machine-learning-model-life-cycle-version-control.md" >}})

Michelangelo, Ray on Kubernetes, Horovod, GPU 학습 최적화, 피처 스토어, 모델 배포 안전장치처럼 모델을 학습·서빙하는 플랫폼 쪽 글입니다.

## 요약하지 않은 원문 {#original-only}

2019년 이전 글이거나 아직 요약하지 않은 글입니다. 원문 제목 그대로 링크합니다.

- [Enabling Offline Inferences at Uber Scale](https://www.uber.com/us/en/blog/enabling-offline-inferences-at-uber-scale/) · 2022-06-15
- [Building a Backtesting Service to Measure Model Performance at Uber-scale](https://www.uber.com/us/en/blog/backtesting-at-scale/) · 2020-02-13
- [Open Sourcing Manifold, a Visual Debugging Tool for Machine Learning](https://www.uber.com/us/en/blog/manifold-open-source/) · 2020-01-07
- [Productionizing Distributed XGBoost to Train Deep Tree Models with Large Data Sets at Uber](https://www.uber.com/us/en/blog/productionizing-distributed-xgboost/) · 2019-12-10
- [Evolving Michelangelo Model Representation for Flexibility at Scale](https://www.uber.com/us/en/blog/michelangelo-machine-learning-model-representation/) · 2019-10-16
- [Science at Uber: Powering Machine Learning at Uber](https://www.uber.com/us/en/blog/uber-science-machine-learning-platform/) · 2019-09-10
- [Accessible Machine Learning through Data Workflow Management](https://www.uber.com/us/en/blog/machine-learning-data-workflow-management/) · 2019-03-18
- [Using Machine Learning to Ensure the Capacity Safety of Individual Microservices](https://www.uber.com/us/en/blog/machine-learning-capacity-safety/) · 2019-03-07
- [Horovod Adds Support for PySpark and Apache MXNet and Additional Features for Faster Training](https://www.uber.com/us/en/blog/horovod-pyspark-apache-mxnet-support/) · 2019-02-21
- [Scaling Machine Learning at Uber with Michelangelo](https://www.uber.com/us/en/blog/scaling-michelangelo/) · 2018-11-02
- [Michelangelo PyML: Introducing Uber’s Platform for Rapid Python ML Model Development](https://www.uber.com/us/en/blog/michelangelo-pyml/) · 2018-10-23
- [Meet Horovod: Uber’s Open Source Distributed Deep Learning Framework for TensorFlow](https://www.uber.com/us/en/blog/horovod/) · 2017-10-17
- [Meet Michelangelo: Uber’s Machine Learning Platform](https://www.uber.com/us/en/blog/michelangelo-machine-learning-platform/) · 2017-09-05
