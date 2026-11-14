---
title: "토스의 Feature Store와 학습 파이프라인 도구 Trainkit"
description: "토스 ML Platform 팀이 Feature Store를 직접 만든 이유와 구조, 그 위에서 학습 데이터셋을 만드는 Trainkit을 요약했습니다. 멀티 Feature Package 조인, 시간 Shift, 런타임 PIT 조인 세 가지 기능을 다룹니다."
date: 2026-11-14
weight: 3
---

# 토스의 Feature Store와 학습 파이프라인 도구 Trainkit (2025-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [토스가 다양한 ML 모델을 만드는 법: Feature Store & Trainkit](https://toss.tech/article/feature-store-trainkit)
- 매체 · 게시일: 토스 기술 블로그 · 2025-08-14
- 저자: 우종호, 송석현 (토스 ML Platform 팀)
- 원문은 "이번 시리즈"라고 소개하며, Feature Serving과 Model Registry, Inference, Monitoring 등은 다른 글에서 다룰 내용으로 남겨 둡니다.
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 두 도구가 맡은 문제 {#problem}

토스에는 신용평가, 이상거래탐지, 마케팅 최적화, 고객 경험 개선처럼 서로 다른 ML 서비스가 많습니다. ML Platform 팀은 Feature Store, Model Registry, Training Pipeline, Model Serving 같은 구성요소를 오픈소스와 자체 개발로 만들고 있으며, 이 글은 그중 Feature 관리의 Feature Store와 학습 자동화 도구 Trainkit을 소개합니다. 목표는 모델 학습과 Feature 관리를 정형화하고, 학습과 서빙 사이의 불일치(Training-Serving skew)를 막고, 실험 효율을 높이는 것입니다.

원문이 말하는 Feature Store의 역할은 네 가지입니다. 학습과 서빙에 같은 Feature를 줘서 skew를 막고, 정의된 Feature를 재사용하게 하고, 실시간과 배치 Feature를 모두 지원하며, Feature 수준의 메타데이터와 품질 모니터링, 권한 관리를 제공합니다. Feature Store가 없으면 데이터 엔지니어, 데이터 사이언티스트, ML 엔지니어가 서로의 정보를 구두와 수작업으로 맞추게 되고 사람 실수가 늘어납니다.

## 직접 개발한 이유 {#why-build}

토스에는 도메인마다 모델이 있고 팀, 데이터 소스, 서빙 요구가 제각각입니다. 기존에는 오프라인에서 Feature를 만들고 학습한 뒤 모델마다 API 서버에서 Feature를 제공하도록 따로 개발해야 했습니다. 개발이 느리고, 의도와 다른 Feature가 만들어져 온라인 성능이 떨어질 수 있었습니다. 잘 쓰이는 Feature도 프로젝트마다 새로 만들어 일관성이 깨지고 자원이 낭비됐습니다. Feature 품질이 틀어지면 서비스 결과에 치명적일 수 있어 분포, Min-Max, Null 비율 같은 품질을 Feature 단위로 모니터링할 필요도 있었습니다. 학습용 데이터 접근 지점을 하나로 모아 권한을 관리하면 보안도 강해지고, 학습에는 익명화된 데이터를 쓰는 경우가 많아 Feature Store로 익명화 데이터를 쉽게 공급할 수 있다는 점도 꼽습니다.

오픈소스(Feast, Tecton, Hopsworks)를 쓰지 않은 이유로는 다음을 듭니다.

- 니즈에 딱 맞는 오픈소스가 없었습니다. 데이터 소스가 단순한 편이라 복잡한 회사 요구를 채우지 못한다고 봤습니다.
- 오픈소스나 엔터프라이즈 버전을 써도 비슷한 수준의 자원이 들 것으로 예상했습니다.
- 자체 개발하면 현재 시스템을 유지한 채 최소한의 개발로 가능합니다.
- ML에서 가장 중요한 플랫폼이라 팀 니즈에 맞춰 계속 개발하고 운영해야 합니다.

그래도 Feast의 개념과 구조는 많이 참고했습니다.

## Feature Store 구조 {#feature-store-architecture}

사용자는 Admin Dashboard와 SDK로 Feature를 메타데이터와 함께 등록합니다. 구성요소는 학습용 데이터를 담는 Offline Storage, 온디맨드 서빙용 Online Storage, Feature Serving API 서버이고, 학습에서는 Trainkit이 Feature Store 정보를 씁니다.

Online Storage는 Redis, ScyllaDB, Cassandra 같은 선택지가 있고, 토스는 과거에 HBase와 Redis를 썼으며 현재는 Aerospike 클러스터를 씁니다. 여러 도메인의 Feature를 서빙하기 좋은 형태로 가공해 배치와 실시간으로 Aerospike에 써야 하는데, Aerospike는 Key를 메모리에, Record를 디스크에 두는 메모리 & SSD(HDD) 하이브리드 구조로 대용량 트래픽에서 낮은 지연을 보장하는 Key-Value 저장소라고 설명합니다.

Data Model은 Feast를 토스 사정에 맞게 고쳤습니다. Feature를 하나씩 정의하는 대신 Feature Set 단위가 필요해 FeatureTable과 FeatureService를 둡니다.

- Entity: 학습 데이터에서 Example을 나누는 키로, 테이블 안에서 유일합니다.
- Feature: 테이블의 컬럼이며 데이터를 관리하는 단위입니다.
- FeatureTable: 오프라인(배치)으로 만든 테이블에 대한 명세입니다. Impala 테이블이면 Entity, Feature, Partition 컬럼으로 구성되고, 메타데이터에 등록해 테이블 간 조인 정보를 줍니다.
- FeatureService: 학습과 추론에 쓰이는 최종 데이터 모델로, FeatureTable 목록과 Entity로 정의됩니다. Trainkit과 Servingkit에서도 쓰입니다.

보안 정책 같은 컴플라이언스와 사내 요구를 반영하려고 Feature Store Admin도 직접 만들었습니다. 사내 도구 Data Center와 연동돼 테이블 데이터를 확인하며 Feature Table을 등록하고, 컬럼을 Entity, Feature, Partition으로 구조화합니다. Data Center는 Data Quality도 계속 관리하고 있습니다.

## Trainkit의 배경 {#trainkit-background}

학습 파이프라인은 데이터 로딩, 전처리, 모델 학습, 후처리, 평가로 표준화돼 있지만 실제로는 모델 학습을 뺀 나머지가 팀마다 제각각입니다. 같은 데이터셋도 어떤 팀은 Impala SQL로, 어떤 팀은 HDFS에서 Parquet를 직접 읽습니다. 원문이 드는 문제는 세 가지입니다.

- 중복 코드: 데이터 로딩과 전처리 스크립트를 프로젝트마다 새로 써서, 작은 버그 수정도 여러 곳에서 반복합니다.
- 재현성 저하: 셔플링 방식이나 체크포인트 저장 로직이 달라 같은 실험의 결과가 미묘하게 다릅니다.
- 기술 부채: 신규 입사자가 프로젝트별 구조를 이해하기 어렵고, 담당자가 없으면 유지보수가 어렵습니다.

데이터 준비부터 실험 관리까지의 인터페이스를 정해 공유하면 모델러가 모델 설계에 집중할 수 있다는 생각에서 Trainkit이 나왔습니다.

## Trainkit의 구성과 워크플로 {#trainkit-structure}

Trainkit은 Feature Store와 강하게 결합돼 있고, Feature 메타와 Entity 정보를 Feature Store에서 조회합니다. 구성은 다섯 가지입니다.

- Data Module: PyTorch Lightning의 LightningDataModule을 상속한 객체로, 데이터 로딩부터 전처리, 배치 생성까지 전체 파이프라인을 맡습니다.
- Target: 여러 Feature를 조인할 때 기준이 되는 데이터 스펙입니다. 추천 시스템이라면 사용자 반응을 가진 데이터셋입니다.
- Feature Service: Feature Store API와 연동해 메타정보와 Entity를 읽고, Target 데이터와 Entity를 Join Key로 삼아 Feature를 병합하는 Join SQL을 만듭니다.
- Feature Processor: Casting, Imputation, Scaling, Encoding 전처리를 수행합니다. Fit과 Transform 함수만 정의하면 새 전처리를 추가할 수 있습니다.
- Feature Package: Feature Service와 Feature Processor를 가진 Facade 계층으로, 데이터 로딩 속도를 위한 캐싱, Feature 유효성 검사, 데이터 로딩 API를 담당합니다.

데이터셋은 Data Module에 필요한 정보를 준비하고, Target으로 조인 기준 데이터를 가져와 전처리하고, n개의 Feature Package에서 Feature를 가져와 전처리한 뒤, Train, Validation, Test용 Dataset과 Dataloader를 만드는 순서로 생성됩니다.

## 세 가지 핵심 기능 {#key-features}

원문은 가장 많이 쓰이는 기능 세 가지를 소개합니다.

멀티 Feature Package 조인. 토스는 추천 모델의 Feature 카테고리를 Feedback, User, Item으로 나눕니다. 광고 소재 추천이면 Feedback은 클릭 여부, User는 사용자 Feature, Item은 광고 소재 Feature입니다. 이 구분을 데이터 소스 구조에까지 그대로 옮기면 확장성이 막히므로, Trainkit은 Target 하나를 기준으로 FeaturePack을 얼마든지 결합하는 구조로 만들었습니다. 사용자 프로파일, 행동 이력, 쇼핑 상품 카탈로그, 상품 메타 정보가 등록돼 있다면 예전에는 네 데이터셋을 세 개로 재가공해야 했지만, 이제는 쓸 Feature Service만 지정하면 Feature Store 메타데이터로 Join Key와 SQL이 만들어집니다. 다른 사람이 만든 Feature를 가져다 쓰기도 쉬워졌습니다.

Training-Serving skew 해소. 온라인 서빙은 현재 시각 기준 2시간 전까지의 Feature만 쓰는데 학습에서 1시간 전 데이터까지 쓰면 미래 정보가 들어가 데이터 누수가 됩니다. 00시에서 01시 사이 데이터를 00시 파티션에 넣을지 01시 파티션에 넣을지 등록자마다 해석이 달라 Target과 Feature의 파티션이 어긋나기도 합니다. Trainkit은 Target을 기준으로 시간 파티션을 Shift하는 기능을 넣어, 01시 피드백 데이터를 00시 Feature와 조인하는 식으로 누수를 막습니다. 예전에는 Feature를 다시 만들어야 했던 문제를 설정 변경 하나로 해결합니다.

런타임 PIT(Point-In-Time) 조인. Feature는 시간에 따라 변하므로, 반응 데이터를 학습에 쓰려면 그 시점에 가장 최근이던 Feature 값을 찾아 병합해야 합니다. PIT 조인은 구현이 까다롭고 비용도 큽니다. Trainkit은 데이터셋 객체를 만들 때 조인하지 않고 준비만 합니다. Target으로 PIT용 join key를 만들고 각 Feature Package와 매핑한 딕셔너리를 만들어 두었다가, Data Module이 특정 index를 요청할 때 join key로 Feature를 조회해 이어 붙입니다. 원문의 계산 예에서 타깃 6건, 각 pack당 Feature 6개, 각 pack이 3번 반복되는 상황이면 미리 조인할 때 42, 런타임 조인은 12입니다. Feature Package와 Feature가 늘수록 사전 조인의 메모리는 기하급수적으로 커지므로 런타임 조인을 택했다고 합니다.

## 남은 방향 {#direction}

원문은 학습뿐 아니라 ServingKit으로 학습부터 서빙까지 일원화하는 플랫폼화를 진행 중이라고 말합니다. ML Platform 팀은 Model Registry, Inference System, Monitoring System까지 데이터 준비에서 모니터링에 이르는 End-to-End 파이프라인 구축에 힘쓰고 있다고 맺습니다.

{{% details title="런타임 조인 메모리 계산 예와 구성요소" closed="true" %}}

| 항목 | 값 |
|---|---|
| 예시 Target 건수 | 6건 (user_pack_1, user_pack_2, item_pack_1, item_pack_2가 각각 3번 반복) |
| pack당 Feature 수 | 6개 |
| 사전 조인 시 적재량 | target 6 + User Feature 6×3 + Item Feature 6×3 = 42 |
| 런타임 조인 시 적재량 | target 6 + 3 + 3 = 12 |
| Online Storage | Aerospike 클러스터 (과거에는 HBase, Redis) |
| Feature Processor 전처리 | Casting, Imputation, Scaling, Encoding |
| 시간 Shift 예 | 01시 피드백 데이터를 00시 Feature와 조인 |

{{% /details %}}
