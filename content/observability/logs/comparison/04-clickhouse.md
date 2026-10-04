---
title: "ClickHouse (self-hosted)"
date: 2026-07-12
lastmod: 2026-08-24
weight: 4
url: "/logging/04-clickhouse/"
---

# ClickHouse를 로그 저장소로 운영한다면

ClickHouse는 로그를 SQL로 검색하고 집계할 수 있는 컬럼형 OLAP 데이터베이스입니다. Yandex에서 시작한 Apache-2.0 프로젝트로, 로그·트레이스·이벤트를 함께 저장하는 용도로도 쓰입니다. 저장량을 줄이고 대규모 집계를 빠르게 처리할 여지가 있지만, 직접 운영하려면 스키마와 복제, 백업을 담당할 사람이 필요합니다.

이 글은 로그 내재화 후보로 ClickHouse를 평가한 기록입니다. 이미 도입을 결정한 뒤의 EKS 구성은 [ClickHouse 운영]({{< relref "/data/clickhouse/_index.md" >}})에서 다룹니다. 아래 성능·비용 수치는 조사 당시의 벤치마크와 사례이며 우리 로그로 측정한 결과는 아닙니다.

## 압축과 집계에서 얻는 것 {#강점}

ClickHouse는 컬럼의 타입과 값 분포에 맞춰 codec을 적용하고 LZ4·ZSTD로 압축합니다. timestamp에 DoubleDelta, 변동이 적은 float에 Gorilla, 정수에 Delta 등을 조합할 수 있습니다. Elasticsearch의 `_source`와 역색인 구성과는 저장 방식이 달라, 같은 로그라도 디스크 사용량에 큰 차이가 날 수 있습니다.

2026-04-23의 OTel 로그 벤치마크(ClickHouse OSS v26.3)는 내부 압축비 약 16.3배, Elasticsearch 대비 약 4.95배 작은 디스크 사용량을 보고했습니다 `Ⓑ`. 구조화 로그의 10~20배 압축, 반복적인 nginx 로그의 100배 이상 압축도 보고돼 있지만 `Ⓥ`, 이를 그대로 용량 계산에 넣지는 않습니다. 기존 산정에서는 raw 대비 8~12배를 보수적인 가정으로 두었으며 실제 schema로 확인해야 합니다 `≈`.

컬럼 스캔과 벡터화 실행은 많은 행을 읽어 집계하는 쿼리에 유리합니다. Uber는 단일 노드 300K logs/s, Elasticsearch 대비 약 10배 처리량과 타입을 지정한 schema에서 약 50배 빠른 집계를 보고했습니다 `Ⓥ`. Trip.com의 4~30배 쿼리 개선, Cloudflare의 96조 이벤트 2초 미만 스캔도 각 워크로드의 결과입니다 `Ⓥ`. Trip.com의 4PB에서 50PB 이상으로의 성장과 Cloudflare의 대규모 운영은 확장 사례로 참고할 수 있습니다.

비용 사례도 같은 조건부로 읽어야 합니다. Didi의 장비 비용 약 30% 절감은 엔지니어링·마이그레이션 비용을 제외한 2024-04 기록입니다 `Ⓥ`. OTel 통합으로 연간 관측성 비용을 약 $50K까지 줄인 플랫폼 사례도 있지만 `Ⓥ`, 저장 엔진 하나의 효과로 분리할 수는 없습니다. 원문을 확인하지 못한 Uber의 하드웨어 50% 이상 절감 주장은 비용 근거에서 제외합니다.

## 직접 설계하고 유지할 부분 {#약점--한계}

`ORDER BY`, partition, codec, TTL, materialized view를 쿼리와 데이터 형태에 맞춰 정해야 합니다. 자주 찾는 필드와 집계 패턴이 알려져 있을수록 설계하기 쉽습니다. 필드가 자주 바뀌는 로그에서는 검색 방식과 schema를 함께 시험해야 합니다. 조사에 반영한 native JSON GA(25.3)와 text index GA(2026-03)가 있어도 이 설계 작업이 사라지지는 않습니다.

ReplicatedMergeTree 복제와 Keeper, 업그레이드, 대용량 backfill, 백업 복원도 운영 범위에 들어갑니다. `clickhouse-backup`의 증분 복원은 앞선 백업에 의존하므로 주간 full·일간 incremental 같은 정책과 복원 리허설을 함께 운영해야 합니다. 기존 TCO 모델의 엔지니어 시간 10~20%, 월 $2~4K는 인건비와 역할 분담을 가정한 값입니다 `≈`.

Altinity operator, 드라이버·BI·OTel·Vector 연동 등 도구는 갖춰져 있습니다. Keeper로 ZooKeeper를 대체해 CPU·메모리와 I/O 부담을 줄였다는 Bonree 사례도 있습니다 `Ⓥ`. 다만 operator가 모든 변경의 데이터 이동과 복원을 대신 판단하지는 않습니다. 실제 변경 절차는 [Altinity 운영]({{< relref "/data/clickhouse/operations/05-altinity-operations.md" >}})에서 설명합니다.

## 저장소 선택은 복구 방식까지 바꾼다

EBS는 노드 교체 후 볼륨을 다시 연결할 수 있지만 AZ에 묶입니다. StorageClass의 `WaitForFirstConsumer`와 노드 배치 조건을 맞춰야 합니다. 로컬 NVMe는 높은 처리량을 얻는 대신 인스턴스 소실 후 살아 있는 replica에서 데이터를 복구해야 합니다. 인스턴스 선택과 Karpenter 설정은 [스토리지·로컬 NVMe]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})를 참고합니다.

S3 cold 티어링으로 오래된 데이터를 옮겨도 로컬 part 메타데이터와 cache 운영이 남습니다. 이 시리즈의 직접 운영 구성은 replica별로 S3 사본을 저장하므로 RF2라면 그 비용도 두 벌로 계산합니다. Cloud의 SharedMergeTree와 같은 저장소 공유를 전제로 잡으면 비용과 복구 계획이 달라집니다. zero-copy는 실험 기능으로 남아 있으나 이 구성의 프로덕션 대안으로 삼지 않습니다.

ClickHouse가 사용하는 S3 객체를 외부 lifecycle 규칙으로 삭제하거나, 즉시 읽을 수 없는 Glacier 계층으로 옮기면 쿼리가 실패할 수 있습니다. 테이블의 TTL과 백업 버킷 정책을 구분해 관리합니다. S3·Iceberg 기반의 다른 운영 방식은 [레이크하우스 글]({{< relref "/data/clickhouse/storage/09-iceberg-lakehouse.md" >}})에서 다룹니다.

로그 검색 UI도 따로 필요합니다. Grafana나 [HyperDX / ClickStack]({{< relref "/observability/logs/comparison/05-hyperdx-clickstack.md" >}})을 연결할 수 있으며, 각각의 사용자 관리와 설정·백업이 추가됩니다.

<span id="우리-케이스에서는"></span>

## 이 팀의 로그 저장소로 선택할 것인가 {#적합--부적합}

대규모 로그를 SQL로 분석하고, 반복되는 집계가 많고, 전담 운영자가 있다면 ClickHouse를 검토할 이유가 있습니다. 반대로 로그 규모가 작거나 관리 책임이 불분명하면 저장 효율만으로 도입을 정당화하기 어렵습니다. 저장소·컴퓨트 분리가 필수 요구라면 [StarRocks와의 비교]({{< relref "/observability/logs/comparison/07-clickhouse-vs-starrocks.md" >}})도 함께 봐야 합니다.

우리 로깅 조사에서는 기존 PLG 운영이 방치된 이력과 작은 플랫폼 팀 규모를 고려했습니다. ClickHouse를 추가하기 전에 담당자, 런북, 정기 리뷰를 정할 수 있는지가 문제였습니다. 이 조건에서 self-hosted ClickHouse를 첫 후보로 선택하지 않았고, 변동이 많은 Istio access log에는 [VictoriaLogs]({{< relref "/observability/logs/comparison/03-victorialogs.md" >}})를 우선 검토했습니다.

RUM과 범용 분석까지 ClickHouse로 운영할 계획이 생기면 비용을 나눠 볼 수 있습니다. 그때도 관리형 견적과 직접 운영 인건비·복구 부담을 함께 비교해야 합니다.
