---
title: "토스의 Feature Store와 Trainkit으로 맞춘 학습 데이터"
description: "토스는 프로젝트마다 반복하던 Feature 생성과 학습 데이터 준비를 줄이려고 Feature Store와 Trainkit을 직접 만들었습니다. Feature를 재사용하고 학습·서빙의 시간 기준을 맞추는 방법, PIT 조인의 메모리 부담을 줄인 설계를 담았습니다."
date: 2026-11-14
weight: 4
---

# 토스의 Feature Store와 Trainkit으로 맞춘 학습 데이터 (2025-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [토스가 다양한 ML 모델을 만드는 법: Feature Store & Trainkit](https://toss.tech/article/feature-store-trainkit)
- 매체 · 게시일: 토스 기술 블로그 · 2025-08-14
- 저자: 우종호, 송석현 (토스 ML Platform 팀)
- 원문은 "이번 시리즈"라고 소개하며, Feature Serving은 추후 공유하겠다고 밝힙니다. Model Registry, Inference System, Monitoring System은 팀이 플랫폼화에 힘쓰는 영역으로만 언급합니다.
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 프로젝트마다 되풀이하던 데이터 준비 {#problem}

새 프로젝트에서도 잘 쓰이던 Feature를 처음부터 다시 만들었습니다. 토스에서는 신용평가, 이상거래탐지, 마케팅 최적화, 고객 경험 개선 등 여러 도메인에 걸쳐 수십 개의 ML 모델을 운영하는데, 팀과 데이터 소스, 서빙 요구가 제각각이었습니다. 오프라인에서 Feature를 만들고 학습을 마친 뒤에도 모델마다 API 서버에서 Feature를 제공하도록 따로 개발해야 했습니다.

개발 속도만의 문제는 아닙니다. 학습 때 의도한 것과 다른 Feature가 온라인에서 만들어지면 모델 성능까지 떨어질 수 있었습니다. 다른 프로젝트에서 이미 잘 쓰는 Feature를 다시 구현하면서 일관성이 깨지고 자원도 낭비됐습니다.

학습 파이프라인에도 반복이 있었습니다. 같은 데이터셋을 어떤 팀은 Impala SQL로 가져오고, 다른 팀은 HDFS에서 Parquet 파일을 직접 읽는 식입니다. 로딩과 전처리 스크립트가 흩어져 있으니 작은 버그도 여러 곳에서 고쳐야 했고, 셔플링이나 체크포인트 저장 방식이 달라 같은 실험의 결과마저 미묘하게 달라졌습니다. 새로 합류한 사람은 프로젝트마다 파이프라인을 익혀야 했으며, 담당자가 없으면 유지보수도 어려웠습니다.

Feature Store와 Trainkit은 이 반복을 줄이려는 도구입니다. Feature Store에는 학습과 서빙에서 함께 쓸 Feature와 그 정보를 모으고, Trainkit은 이를 바탕으로 학습 데이터를 준비합니다. 데이터 준비부터 실험 관리까지 인터페이스를 공유해 모델러가 모델 설계에 집중하도록 하려는 선택이었습니다.

## 자체 구축을 택한 토스의 운영 조건 {#why-build}

Feature Store가 사내 환경에 맞지 않으면 운영 부담이 커질 수 있습니다. 토스는 Feast, Tecton, Hopsworks 같은 기존 도구가 회사의 복잡한 요구를 충분히 채우지 못한다고 봤습니다. 오픈소스나 엔터프라이즈 버전을 도입하더라도 비슷한 수준의 자원이 들 것으로 예상했습니다.

자체 개발은 기존 시스템을 최대한 유지하면서 필요한 부분을 최소한으로 개발할 수 있는 선택이었습니다. ML 인프라의 중심인 만큼 토스 팀의 요구에 맞춰 계속 개발하고 운영해야 한다는 판단도 있었습니다. 직접 만들되, Feast의 개념과 구조는 많이 참고했습니다.

재사용 외에도 관리할 일이 있었습니다. Feature 품질이 나빠지면 ML 서비스의 결과에 치명적인 영향을 줄 수 있어, Feature별 분포와 Min-Max, Null Value의 크기를 살펴야 했습니다. 학습 데이터에 접근하는 지점을 하나로 모아 권한을 관리하면 보안을 강화할 수 있고, 대부분의 모델 학습에 사용할 수 있는 익명화된 데이터를 공급하기도 쉬워집니다.

## 테이블에서 모델로 이어지는 Feature Store {#feature-store-architecture}

등록의 출발점은 이미 있는 테이블입니다. 사용자는 Admin Dashboard와 SDK로 Feature를 메타데이터와 함께 등록합니다. 보안 정책과 사내 요구를 반영해 직접 만든 Feature Store Admin은 사내 데이터 도구인 Data Center와 연동됩니다. Data Center에서는 테이블 데이터를 확인할 수 있고, Data Quality도 지속적으로 관리합니다.

Feature Table을 등록할 때는 컬럼을 Entity, Feature, Partition으로 구분합니다. Entity는 학습 데이터의 Example을 나누는 키로 테이블 안에서 유일하며, Feature는 컬럼이자 Feature Store가 데이터를 관리하는 단위입니다. FeatureTable은 이렇게 오프라인으로 만든 물리 테이블의 명세입니다. 기존 Impala 테이블 등의 메타데이터를 등록해 테이블 간 조인에 필요한 정보를 제공합니다.

모델에는 테이블보다 큰 묶음도 필요합니다. FeatureTable 목록과 Entity로 정의하는 FeatureService는 모델 학습과 추론에 쓰는 논리적인 단위이며, Trainkit과 Servingkit에서도 사용합니다. 개별 Feature뿐 아니라 이런 Feature Set을 다루도록 Feast의 Data Model을 토스 환경에 맞게 수정했습니다.

저장소는 용도에 따라 나뉩니다. 학습용 데이터는 Offline Storage에 두고, 온디맨드 Feature 제공에는 Online Storage와 Feature Serving API 서버를 사용합니다. 학습 과정에서는 Trainkit이 Feature Store의 정보를 읽습니다.

Online Storage에는 Redis, ScyllaDB, Cassandra 같은 선택지가 있습니다. 토스는 과거에 HBase와 Redis를 썼고, 현재는 대용량 트래픽에서 낮은 지연을 보장하는 Key-Value 저장소인 Aerospike 클러스터를 사용합니다. 여러 도메인에서 만든 Feature를 서빙하기 좋은 형태로 가공해 배치와 실시간으로 기록합니다. Aerospike는 Key를 메모리에, Record를 디스크에 두는 메모리 & SSD(HDD) 하이브리드 구조입니다.

## Target을 기준으로 모이는 Feature Package {#trainkit-structure}

토스는 추천 모델의 Feature를 Feedback, User, Item으로 나눕니다. 광고 소재 추천이라면 사용자 클릭 여부가 Feedback, 사용자 Feature가 User, 광고 소재 Feature가 Item입니다. 하지만 이 분류를 데이터 소스 구조에도 그대로 적용하면 확장성이 제한됩니다.

예를 들어 Feature Store에 사용자 프로파일, 사용자 행동 이력, 쇼핑 상품 카탈로그, 쇼핑 상품 메타 정보가 등록돼 있다고 가정해 보겠습니다. 기존 방식에서는 이 네 데이터셋을 다시 가공해 Feedback, User, Item으로 재분류해야 했습니다. Trainkit에서는 사용할 Feature Service만 지정하면 됩니다.

그 기준이 Target입니다. Target은 여러 Feature를 조인할 기준 데이터의 스펙을 정의하며, 추천 시스템에서는 실제 사용자 반응을 담은 데이터셋이 그 역할을 합니다. Trainkit은 Target 하나에 FeaturePack을 개수 제한 없이 결합하도록 만들었습니다. 다른 사람이 이미 만든 Feature도 데이터 소스를 다시 분류하지 않고 학습에 가져다 쓸 수 있습니다.

조인에 필요한 정보는 Feature Store에서 가져옵니다. Trainkit의 Feature Service 컴포넌트는 Feature Store API로 메타정보와 Entity를 읽고, Target 데이터와 Entity를 Join Key로 삼아 Feature를 병합할 Join SQL을 만듭니다. 이 때문에 Feature Store는 Trainkit에 필수적인 컴포넌트입니다.

데이터를 읽을 때는 Feature Processor가 지정된 전처리를 적용합니다. Casting, Imputation, Scaling, Encoding을 지원하며, Fit과 Transform 함수만 정의하면 새 전처리를 추가할 수 있습니다. Feature Service와 Feature Processor를 감싼 Facade 계층인 Feature Package는 데이터 로딩 API를 제공하고, 캐싱과 Feature 유효성 검사도 맡습니다.

전체 데이터 파이프라인은 Data Module이 담당합니다. PyTorch Lightning의 LightningDataModule을 상속한 객체로, Target에서 기준 데이터를 가져와 전처리하고 n개의 Feature Package에서도 Feature를 가져와 전처리합니다. 이후 Train, Validation, Test용 Dataset과 Dataloader를 생성하면, 모델러는 이 Dataloader로 학습을 진행합니다.

## 서빙 시점에 학습 데이터를 맞추는 Shift {#key-features}

같은 Feature를 쓰더라도 시점이 다르면 문제가 생깁니다. 예를 들어 온라인 서빙에서는 현재 시각 기준 2시간 전까지의 Feature만 쓰는데, 학습에는 1시간 전 데이터까지 포함했다고 가정해 보겠습니다. 서빙 때 쓸 수 없던 미래 정보가 학습에 들어간 것입니다.

이런 데이터 누수(Data Leakage)는 오프라인 실험 결과와 온라인 서비스 성능을 크게 벌릴 수 있습니다. 학습과 서빙이 서로 다른 시점의 Feature 값을 보는 것은 Training-Serving skew가 발생하는 원인입니다.

시간 파티션을 해석하는 기준도 어긋날 수 있습니다. 00시에서 01시 사이에 발생한 데이터를 누군가는 00시 파티션에, 다른 누군가는 01시 파티션에 넣을 수 있습니다. 그러면 Target과 Feature의 파티션이 달라 조인이 어려워집니다.

Trainkit은 Target을 기준으로 시간 파티션을 Shift하는 기능을 넣었습니다. 예를 들어 01시에 발생한 피드백을 00시 Feature와 조인해 데이터 누수를 막을 수 있습니다. 기존에는 이런 문제를 해결하려고 Feature를 재생성하거나 누수를 발견한 뒤에도 대응에 오랜 시간이 들었지만, Shift를 쓰면 설정 변경 하나로 처리합니다.

## 필요한 index에서 실행하는 PIT 조인 {#runtime-pit}

온라인에서 추론에 쓰는 Feature 값은 계속 바뀝니다. 그때 얻은 반응을 나중에 학습에 쓰려면, 반응이 발생한 시점의 가장 최근 Feature 값을 찾아 병합해야 합니다. 이 작업이 PIT(Point-In-Time) 조인입니다.

구현도 까다롭고 비용도 큽니다. Trainkit은 메모리를 적게 쓰기 위해 데이터셋 객체를 만들 때 조인을 끝내지 않고, 실제 데이터를 요청하는 런타임에 실행합니다.

객체를 생성할 때는 준비만 합니다. Target으로 PIT에 필요한 join key를 만들고, 각 Feature Package와 매핑한 딕셔너리를 구성합니다. 이후 Data Module이 특정 index의 데이터를 요청하면 Target에서 join key를 찾고, 준비한 딕셔너리에서 해당 Feature를 조회합니다. 각 Feature Package에서 가져온 Feature를 이어 붙여 반환하는 흐름입니다.

미리 조인하면 같은 Feature가 반복해서 들어갑니다. Target 6건, pack당 Feature 6개, 각 pack이 3번 반복된다고 가정한 계산 예에서 사전 조인의 적재량은 42, 런타임 조인은 12입니다. 운영 환경의 실측치가 아니라 중복 적재의 차이를 보여주는 예입니다. Feature Package와 Feature가 늘수록 사전 조인의 메모리 점유율이 기하급수적으로 커지므로 런타임 조인을 선택했습니다.

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

## 학습 다음 단계로 이어지는 ServingKit {#direction}

토스 ML Platform 팀은 ServingKit을 활용해 학습부터 서빙까지 일원화하는 플랫폼화를 진행 중입니다. Model Registry, Inference System, Monitoring System도 포함해 데이터 준비·학습·서빙·배포·모니터링을 잇는 End-to-End 파이프라인을 구축하고 있습니다. 모델 추론에 필요한 Feature Serving의 자세한 내용은 후속 글에서 다룰 내용으로 남겨 뒀습니다.
