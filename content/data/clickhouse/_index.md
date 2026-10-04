---
title: "ClickHouse 운영"
date: 2026-07-13
lastmod: 2026-08-24
weight: 10
cascade:
  type: docs
comments: false
url: "/clickhouse/"
linkTitle: "ClickHouse"
---

# ClickHouse 운영

## 이 분류에서 찾기 {#section-navigation}

- [도입·구축]({{< relref "/data/clickhouse/deployment/_index.md" >}})
- [운영·사례]({{< relref "/data/clickhouse/operations/_index.md" >}})
- [스토리지·레이크하우스]({{< relref "/data/clickhouse/storage/_index.md" >}})

참고 자료: [출처]({{< relref "/data/clickhouse/10-sources.md" >}})

ClickHouse를 직접 운영하면 테이블 설계부터 복제, 백업, 노드 교체까지 맡게 됩니다. 이 시리즈는 EKS에서 분석용 ClickHouse를 운영할 때 필요한 선택과 절차를 다룹니다. RUM 내재화와 범용 분석 수요가 있고, 이를 담당할 인력이 있다는 전제입니다.

<span id="우리-케이스에서는"></span>

로그 저장소만 필요한 상황에서는 판단이 달라집니다. [로깅 시리즈]({{< relref "/observability/logs/_index.md" >}})에서는 운영 부담을 고려해 [VictoriaLogs]({{< relref "/observability/logs/comparison/03-victorialogs.md" >}})를 우선 검토했습니다. ClickHouse 도입을 아직 결정하지 않았다면 [로그 저장소로서의 평가]({{< relref "/observability/logs/comparison/04-clickhouse.md" >}})와 [관리형·직접 운영 비교]({{< relref "/data/clickhouse/deployment/01-managed-vs-selfhosted.md" >}})부터 읽으면 됩니다.

<span id="핵심-결정-요약"></span>

## 배포 방식을 정할 때 {#이-챕터의-위치--전제-차이}

관리형과 직접 운영의 비용 차이는 데이터 크기만으로 정해지지 않습니다. 장애 대응과 업그레이드를 맡을 사람이 있는지, 상시 부하와 스토리지 성능 요구가 얼마나 큰지가 함께 작용합니다. [Managed vs Self-hosted]({{< relref "/data/clickhouse/deployment/01-managed-vs-selfhosted.md" >}})에서 Cloud·BYOC·Altinity 등 운영 형태와 비용 모델을 비교합니다. 20TB 이상이라는 수치도 그 모델의 조건이지 보편적인 손익분기점은 아닙니다.

직접 운영하는 구성에서는 로컬 NVMe를 hot 저장소로, S3를 cold 저장소로 검토합니다. 빠른 로컬 디스크를 쓰는 대신 노드를 잃었을 때 데이터를 다시 채워야 합니다. [스토리지와 로컬 NVMe]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})는 이 복구 시간과 replica 수, 백업, Karpenter 설정을 함께 다룹니다. 월 0.7TB RUM처럼 규모가 작은 EBS 구성은 [HyperDX 내재화]({{< relref "/observability/hyperdx/design/_index.md" >}})에서 따로 다룹니다.

[Altinity operator]({{< relref "/data/clickhouse/deployment/03-operator.md" >}})에서는 operator를 선택하고 ClickStack을 기존 ClickHouse에 연결하는 방법을 설명합니다. 실제 클러스터를 만들 때 필요한 CHI·CHK와 local PV 설정은 [배포 플레이북]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}})에 모았습니다.

## 배포 후 변경과 복구 {#운영에서-놓치기-쉬운-것}

[변경관리와 복구]({{< relref "/data/clickhouse/operations/05-altinity-operations.md" >}})는 shard·replica 추가, 롤링 업그레이드, 노드 소실, Keeper 정족수 상실을 다룹니다. replica 추가와 shard 추가는 데이터 배치에 미치는 영향이 다르며, operator를 설치했다고 리밸런싱까지 자동으로 해결되지는 않습니다.

S3 티어링을 백업으로 간주해서도 안 됩니다. 직접 운영하는 ReplicatedMergeTree는 replica마다 데이터를 보관하고, S3의 part를 읽는 데 필요한 메타데이터도 복구 계획에 들어갑니다. zero-copy와 Glacier 전환의 제약은 [스토리지 글]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})에서 확인할 수 있습니다.

## 다른 팀의 선택을 비교할 때 {#이-챕터-구성-문서-지도}

| 글 | 살펴볼 내용 |
|---|---|
| [프로덕션 운영 사례]({{< relref "/data/clickhouse/operations/06-production-usecases.md" >}}) | Kubernetes·operator·로컬 NVMe를 실제로 운영한 사례와 팀 규모 |
| [다른 데이터스토어의 로컬 NVMe 운영]({{< relref "/data/clickhouse/storage/07-local-nvme-datastore-patterns.md" >}}) | ScyllaDB·Kafka 등에서 복제와 노드 교체를 다루는 방식 |
| [무신사 CDP]({{< relref "/data/clickhouse/operations/08-musinsa-cdp.md" >}}) | 직접 운영하던 ClickHouse를 Cloud로 옮긴 배경과 비용 수치의 적용 범위 |
| [Iceberg·레이크하우스]({{< relref "/data/clickhouse/storage/09-iceberg-lakehouse.md" >}}) | MergeTree와 Iceberg의 용도, S3를 저장소로 쓰는 여러 방식 |
| [참고 자료]({{< relref "/data/clickhouse/10-sources.md" >}}) | 주제별 공식 문서·발표·운영 사례 |

<span id="자매-챕터"></span>

HyperDX를 이 저장소에 연결하려면 [플랫폼 분석]({{< relref "/observability/apm-rum/01-hyperdx-deep-dive.md" >}})에서 UI와 수집 경로, MongoDB 의존성을 함께 확인해야 합니다.

본문의 버전·가격·제품 상태는 각 글에 적힌 조사 시점을 따릅니다. 근거 표시는 `✓` 확인된 내용, `≈` 추정, `Ⓥ` 벤더 주장, `?` 미확인, `Ⓑ` 공개 벤치마크, `Σ` 자료를 종합한 판단을 뜻합니다.
