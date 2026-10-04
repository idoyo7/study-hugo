---
title: "Iceberg·레이크하우스 — 테이블 포맷이 뭐고, S3 메인의 답이 되는가"
date: 2026-08-12
lastmod: 2026-08-24
weight: 9
url: "/clickhouse/09-iceberg-lakehouse/"
---

# Iceberg·레이크하우스 — 테이블 포맷이 뭐고, S3 메인의 답이 되는가

S3에 Parquet 파일을 쌓으면 여러 엔진이 읽을 수 있습니다. 하지만 파일을 추가하거나 교체하는 중에 어떤 파일 집합이 하나의 테이블인지 정하는 규칙이 필요합니다. Iceberg는 스냅샷, 스키마, 유효한 데이터 파일 목록을 메타데이터로 관리해 이 문제를 다룹니다.

ClickHouse도 Iceberg를 읽고 쓸 수 있습니다. 그렇다고 기존 MergeTree 테이블을 Iceberg로 바꾸는 것만으로 관측성 저장소가 더 단순해지지는 않습니다. `trace_id` 한 건 조회, 계속 추가되는 JSON 속성, 높은 적재율에서는 파일 배치와 인덱스, compaction 비용을 함께 비교해야 합니다.

이 글은 2026-08 조사 범위에서 Iceberg의 구조와 ClickHouse 지원 버전을 정리하고, 현재 RUM 저장소에 도입할 이득을 검토합니다. [S3 cold tier 설계]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})와 [Cloud의 공유 스토리지]({{< relref "/data/clickhouse/deployment/01-managed-vs-selfhosted.md" >}})는 각각 다른 구성이므로 뒤에서 구분합니다. 버전·출처 등급은 기존 조사 결과를 유지하며 원문은 [출처]({{< relref "/data/clickhouse/10-sources.md" >}})에 있습니다.

## S3 에 없는 것 — Iceberg 가 존재하는 이유

S3의 오브젝트 키에는 테이블의 상태를 나타내는 규칙이 없습니다. 파일을 여러 개 저장하는 것과 일관된 테이블을 제공하는 것 사이에 다음 작업이 남습니다 `Σ`.

- 디렉토리가 없습니다. `s3://bucket/a/b/c.parquet` 의 슬래시는 그냥 키 문자열의 일부입니다. "폴더"는 접두사 조회(LIST)를 예쁘게 보여주는 클라이언트의 착시입니다.
- 여러 파일에 걸친 원자적 변경이 없습니다. 파일 하나의 PUT 은 원자적이지만 "파일 200개를 지우고 새 파일 150개를 추가한다"를 한 번에 성공/실패시킬 방법이 없습니다.
- "이 테이블의 현재 상태"라는 개념이 없습니다. 지금 이 접두사 아래 있는 파일 중 어느 것이 유효한 데이터인지 S3 는 모릅니다.

Hive 스타일 배치는 `s3://bucket/tbl/dt=2026-08-12/*.parquet`처럼 경로에 파티션 정보를 담습니다. 엔진은 이 규칙을 해석하고 LIST로 파일을 찾습니다. 파일을 교체하는 중에 읽는 문제나 여러 스키마 버전의 파일을 함께 읽는 문제는 추가 조정이 필요합니다 `Σ`.

Iceberg는 유효한 파일 목록, 스키마, 파티션 규칙, 통계를 메타데이터 파일에 기록합니다. 읽는 쪽은 현재 스냅샷의 목록을 따라가므로 쓰기 중인 파일을 임의로 테이블에 포함하지 않습니다. 과거 스냅샷을 남기면 time travel에 사용할 수 있고, 필드 식별자와 스키마 이력으로 스키마 변경도 다룹니다 `Σ`.

ClickHouse 저자들의 표현을 그대로 옮기면, 테이블 포맷은 "loose collections of files"를 "coherent, mutable tables"로 바꿉니다 `✓`.

## Parquet·Iceberg·카탈로그·쿼리 엔진의 역할 {#4층-케이크--파일-포맷--테이블-포맷--카탈로그--엔진}

Parquet은 파일 내부의 저장 형식이고 Iceberg는 파일 여러 개를 테이블로 묶는 규칙입니다. 카탈로그는 현재 메타데이터를 가리키고 쿼리 엔진이 이를 읽어 계산합니다 `✓`. 같은 테이블을 Spark와 ClickHouse가 읽는 구조를 네 구성요소로 나누면 다음과 같습니다.

| 층 | 대표 구현 | 무엇을 담당하나 | 없으면 무슨 일이 생기나 |
|---|---|---|---|
| **① 파일 포맷** | Parquet, ORC | 열 지향 파일 **한 개**. 컬럼 청크·page 분할, page 단위 압축(ZSTD·Snappy), footer 의 스키마·컬럼 min/max 통계, row group 단위 Bloom filter `✓` | 열 지향의 압축·필터 이득 자체가 없다 |
| **② 테이블 포맷** | Iceberg, Delta Lake, Hudi | Parquet 수천 개를 논리적 "테이블" 하나로. 현재 스냅샷의 유효 파일 목록(manifest), 스키마 버전 이력, 파티션 규칙, 파일·컬럼 단위 통계 `✓` | 파일 뭉치일 뿐 — 쓰는 중 읽기·스키마 변경이 깨진다 |
| **③ 카탈로그** | AWS Glue, Iceberg REST, Unity, Hive Metastore, Nessie `✓` | "테이블 이름 → 지금 유효한 메타데이터 파일"의 포인터. 커밋 = 이 포인터의 **원자적 교체** `✓` | 테이블을 이름으로 못 찾고, 커밋의 원자성이 사라진다 |
| **④ 쿼리 엔진** | Spark, Trino, Flink, DuckDB, **ClickHouse** | ①~③ 을 해석해 실제 계산 수행. **여러 엔진이 같은 테이블을 동시에 붙을 수 있다** `✓` | 계산 주체가 없다 |

Parquet의 row group은 같은 행 범위에 속하는 컬럼 데이터를 묶습니다. 각 컬럼의 column chunk는 page로 나뉘며 page 단위로 압축됩니다. 파일 끝 footer에는 스키마와 인코딩, 통계 정보가 있습니다. 엔진은 통계와 Bloom filter 등을 사용해 읽을 범위를 줄입니다 `✓`. 이 구조는 파일 하나 안의 정보이므로, 여러 파일 중 현재 유효한 목록은 Iceberg 메타데이터에서 찾습니다.

쓰기 작업은 새 데이터 파일과 메타데이터 파일을 준비한 뒤 카탈로그가 가리키는 메타데이터 위치를 원자적으로 바꿉니다. 읽기는 선택한 스냅샷을 따라가므로 파일 교체 도중의 부분 상태를 보지 않습니다 `✓`.

동일한 테이블을 여러 엔진으로 읽을 수 있다는 점은 도입 목적과 직접 연결됩니다. ClickHouse 저자들도 테이블 포맷이 벤더 종속성을 낮추고 중립적인 스토리지 계층을 만든다고 설명합니다 `✓`. 분석·배치·ML 팀이 같은 데이터를 서로 다른 엔진으로 사용해야 한다면 이 이점이 커집니다 `Σ`.

### 스냅샷과 스키마 변경 {#층에서-파생되는-네-가지-성질}

| 성질 | 어떻게 나오나 | 근거 |
|---|---|---|
| **스냅샷 격리** | 읽기가 시작 시점 포인터를 고정 → 동시 쓰기에도 일관된 뷰 | `✓` "consistent view across large, distributed writes" |
| **time travel** | 과거 스냅샷의 메타데이터가 남아 있음 → 그 시점 파일 목록으로 조회 | `✓` |
| **스키마 진화** | 스키마 버전을 메타데이터에 기록 → 과거 파일 재작성 없이 컬럼 추가·변경 | `✓` "older data remains queryable even as the schema grows" |
| **hidden partitioning** | 파티션 규칙을 메타데이터가 소유 → 쿼리가 파티션 컬럼을 몰라도 프루닝 | `?` 이 조사의 1차 출처가 다루지 않았다 |

{{< callout type="important" >}}
텔레메트리에는 새 속성이 계속 추가됩니다. 이를 테이블 메타데이터로 관리하면 파이프라인마다 별도 스키마 관리 계층을 구현하는 부담을 줄일 수 있습니다 `✓`.

{{< /callout >}}

### 파일 배치와 compaction 운영 {#층이-청구하는-것--정렬compactionrow-group-크기는-누가-하나}

테이블의 일관성이 확보돼도 파일 크기와 배치는 관리해야 합니다. 적재가 작은 파일을 계속 만들면 compaction이 필요하고, 과거 스냅샷과 고아 파일도 정리해야 합니다. MergeTree와 비교하면 담당할 운영 작업이 다음과 같이 달라집니다.

| 유지보수 작업 | Iceberg 레이크하우스 | MergeTree |
|---|---|---|
| **쓰기 전 배치·정렬** | 들어오는 데이터를 파티션 키(타임스탬프·서비스명 등)에 맞춰 미리 모아 정렬해야 한다. 보통 Kafka·Flink·Spark 같은 **외부 시스템으로 조정** `✓` | 엣지 에이전트·컬렉터의 작은 INSERT 를 **자동 배치·정렬** `✓` |
| **compaction** | 시간이 지나면 정렬이 흐트러지고(늦게 도착한 이벤트) 작은 파일이 쌓인다 → 주기적 compaction 필수. 실행 주체는 보통 **Spark·Athena 같은 외부 엔진**, 관리형(Databricks)은 백그라운드 자동 `✓` | 백그라운드 merge 가 계속 큰 정렬 파일로 합침 — **사용자에게 투명** `✓` |
| **compaction 파라미터** | 파일 개수, 최소/최대 파일 크기, 파일 그룹당 총 바이트를 사용자가 정해야 한다 `✓` | 해당 없음 |
| **파티션 전략** | 과분할 → 작은 파일 폭발, 과소분할 → 불필요하게 넓은 스캔. 외부 프로세스나 관리형 서비스로 직접 해결해야 한다 `✓` | 파티셔닝도 지원하지만 **프라이머리 키**로 훨씬 고운 해상도의 정렬·필터를 얻는다 `✓` |
| **row group 크기 선택** | 작게 잡으면 통계가 촘촘해져 스킵·병렬성이 좋아지지만 footer 가 커져 플래닝이 느려지고, 크게 잡으면 메타데이터는 줄지만 프루닝·병렬성이 떨어지고 압축 해제 메모리가 늘어난다. **최적값은 워크로드 의존이고 자명하지 않다** `✓` | 해당 없음 |
| **메타데이터 관리** | 매니페스트 병합, 스냅샷 만료, 가비지 컬렉션을 주기적으로 돌려야 하고 조정·컴퓨트 자원이 든다 `✓` | 해당 없음 |

row group 크기는 프루닝, 병렬성, 메타데이터 크기와 메모리 사용량을 함께 바꿉니다. 한 값을 고정해 모든 워크로드에 적용하기 어렵습니다. 위 작업 중 어떤 것을 관리형 서비스가 맡고 어떤 것을 우리 팀이 맡을지 정해야 운영비를 비교할 수 있습니다 `Σ`.

## ClickHouse 는 Iceberg 로 무엇을 할 수 있나 (2026-08 기준)

아래는 조사 시점에 확인한 릴리스와 설정입니다. 이름 변경이나 self-host 동작을 확인하지 못한 부분에는 `?`를 남겼습니다.

### 읽기·쓰기 기능 매트릭스

| 기능 | 경로 / 설정키 | 도입 | 등급 |
|---|---|---|---|
| **읽기** | 테이블 엔진 `IcebergS3`·`Iceberg`, `iceberg` 테이블 함수 | ~23.2/23.3 무렵 | `≈` |
| **기존 테이블 INSERT** | `allow_experimental_insert_into_iceberg`(도입 당시 유일한 이름), Parquet·Avro·ORC 지원 | **25.7**(2025-07-24, PR #82692) | `✓` |
| 같은 기능의 현재 이름 | `allow_insert_into_iceberg`(별칭) — 공식 설정 레퍼런스 Beta 표 등재 여부·기본값은 페이지 원문을 확보하지 못했다 | 별칭 추가 **26.2**(2026-02-26, PR #97483) | `≈` / 등급표기 `?` |
| **신규 테이블 CREATE** | `IcebergLocal`·`IcebergS3` 엔진으로 CREATE TABLE (PR #83983) | **25.8**(2025-08-28) | `✓` |
| **ALTER DELETE**, equality delete 쓰기, **DROP TABLE** | PR #85549 · #85843 · #85395 | **25.8** | `✓` |
| **ALTER UPDATE**, 데이터레이크 대상 분산 INSERT SELECT | PR #86059 · #86783 | **25.9**(2025-09-25) | `✓` |
| **매니페스트 compaction** | `OPTIMIZE TABLE ... MANIFEST`, `allow_experimental_iceberg_compaction`, `iceberg_manifest_min_count_to_compact`(기본 30) | **26.7**(2026-07-22, PR #98178) — 현재도 **Experimental** | `✓` |
| **고아 파일 정리** | `ALTER TABLE ... EXECUTE remove_orphan_files` | **26.4**(2026-04-30, PR #99127) | `✓` |
| **스냅샷 만료** | `ALTER TABLE ... EXECUTE expire_snapshots('<timestamp>')` | **26.3**(2026-03-26, PR #97904) | `✓` |
| **파티션 프루닝** | `use_iceberg_partition_pruning=1` | 버전 미확인 | `✓` / 버전 `?` |

쓰기 지원은 25.7의 INSERT에서 시작해 25.8의 CREATE·DELETE·DROP, 25.9의 UPDATE로 추가됐습니다. PR #82692도 최초 범위를 local table의 insert로 제한하고 카탈로그 통합과 create를 후속 작업으로 설명했습니다 `✓`.

26.7 CHANGELOG에는 equality delete 파일을 가진 Iceberg 테이블을 읽을 때의 크래시 수정(#109551)이 있습니다 `✓`. 지원 기능표에 있어도 실제 파일·스키마 조합에서 오류가 날 수 있으므로 사용할 읽기·쓰기 경로를 스테이징에서 확인해야 합니다 `Σ`.

### 삭제·스키마 진화·타임트래블의 실제 경계

| 항목 | 지원 범위 | 등급 |
|---|---|---|
| position delete | 지원. 도입 버전은 문서에 명시 없음 | `✓` / 버전 `?` |
| equality delete | **읽기 25.8+**, 쓰기는 25.8 에서 추가 | `✓` / 쓰기 `≈` |
| **Iceberg v3 deletion vector** | **미지원**(현 시점 전부) | `✓` |
| 스키마 진화 — 되는 것 | 컬럼 추가·삭제·재배열, nullable 변경, `int→long`, `float→double`, `decimal(P,S)→decimal(P',S)`(P'>P) | `✓` |
| 스키마 진화 — 안 되는 것 | **nested/array/map 원소 타입 변경** | `✓` |
| time travel | `iceberg_timestamp_ms` 또는 `iceberg_snapshot_id`. **둘 동시 지정 불가** | `✓` |

### 카탈로그 통합 — DataLakeCatalog

`DataLakeCatalog` 데이터베이스 엔진이 Glue·Unity Catalog·Hive Metastore·Iceberg REST·OneLake 를 붙입니다. 활성화에는 카탈로그별 설정이 필요합니다 — `allow_experimental_database_iceberg`, `allow_experimental_database_unity_catalog`, `allow_experimental_database_glue_catalog`, `allow_experimental_database_hms_catalog`, `allow_experimental_database_paimon_rest_catalog` `≈`. 이 중 Unity·Glue·REST·Hive Metastore 네 개는 PR #85848(25.8 반영)로 experimental → beta 승격됐습니다 — 2025 CHANGELOG 25.8 섹션 축어로 "Unity, Glue, Rest, and Hive Metastore data lake catalogs are promoted from experimental to beta" `✓`. 승격과 함께 `allow_experimental_database_*` 에 `allow_database_*` 별칭이 붙었으나 문서 축어로 확인되는 것은 `allow_experimental_database_iceberg` ↔ `allow_database_iceberg` 한 쌍입니다. 나머지는 같은 규칙의 유추입니다 `≈`. 이름에는 아직 experimental 이 남아 있습니다. 공식 설정 레퍼런스의 Beta 표 등재 여부는 원문을 확보하지 못했습니다 `?`.

{{< callout type="important" >}}
카탈로그 엔진은 OSS에 있지만 조사한 공식 소개 자료는 Cloud 사용에 초점을 맞춥니다 `≈`. self-host의 Glue/Unity 연결, 권한과 실패 복구는 스테이징 검증이 남아 있습니다 `Σ`.

Unity Catalog 데뷔는 24.12 무렵, Glue + Delta-on-Unity 는 25.3 언급으로 보이지만 정확한 마이너 버전은 확인하지 못했습니다 `?`.

{{< /callout >}}

### 인접 경로 — Delta/Hudi, s3/s3Cluster, S3Queue

S3 파일을 읽거나 적재하는 용도라면 Iceberg 외의 경로도 있습니다. 테이블 포맷을 읽는 기능과 파일을 MergeTree로 가져오는 기능은 구분해서 선택합니다.

| 경로 | 무엇인가 | 상태 |
|---|---|---|
| **Delta Lake** | `deltaLake`·`deltaLakeAzure`·`deltaLakeLocal`·`deltaLakeCluster` 테이블 함수. 쓰기(`allow_experimental_delta_lake_writes`)는 **26.7 에 Beta 승격** `✓` | Iceberg 보다 덜 성숙 `≈` |
| **Hudi** | `hudi` 테이블 함수. min/max 파일 통계·파티션 프루닝이 표준 수단으로 문서에 언급되나 ClickHouse 측 최적화 수준의 공식 자료가 빈약 | `≈` |
| **프루닝 미해결 이슈** | `deltaLakeCluster`를 직접 호출하면 파티션 프루닝이 동작하는데, **뷰나 CTE 를 경유하면** `DeltaLakePartitionPrunedFiles`가 0 이 되고 무관한 파일까지 읽는다(#85093, 미해결) | `≈` |
| **`s3`/`s3Cluster`** | Hive 스타일 파티셔닝(`use_hive_partitioning=1`)으로 `/name=value/` 를 가상 컬럼화, glob(`*`,`**`,`?`,`{a,b}`,`{N..M}`) 지원, `s3Cluster`는 여러 replica 에 분산 | `≈` |
| 같은 경로의 한계 | Parquet **파일 레벨 min/max 통계 기반 프레디케이트 푸시다운**이 `s3` 함수 문서에 명시되지 않았다 — 이건 s3 함수의 기능이 아니라 Parquet 리더의 일반 기능으로 봐야 한다(층이 겹치는 지점) | `?` |

`S3Queue` 는 성격이 다릅니다. 위 경로들이 S3 를 "쿼리 대상"으로 쓴다면 S3Queue 는 S3 를 인제스트 소스로 씁니다. 버킷에 새로 떨어진 파일을 감지해 MergeTree 로 밀어 넣는 경로입니다. 23.8 실험 도입, 23.11 릴리스 블로그에서 "significantly improved since its experimental release and is now production ready"로 공식 발표됐습니다. Keeper 의존(`keeper_path`)이 필수입니다 `✓`.

{{< callout type="important" >}}
S3Queue 의 exactly-once 를 Cloud 의 S3 ClickPipes 와 혼동하면 안 됩니다. 공식 문서는 S3Queue 가 exactly-once 를 보장하지 않는다고 명시합니다. 그러면서 중복 시나리오를 열거합니다 — (1) 파싱 실패 후 재시도, (2) 멀티서버 환경에서 Keeper 세션 만료(25.8 부터 영구 처리 노드 사용으로 완화), (3) 서버 비정상 종료 `✓`. 또 `after_processing='delete'` 이면서 `fsync_after_insert=1` 이 아니면 전력 손실 시 행 유실이 가능합니다. Ordered 모드는 파일명이 알파뉴메릭 오름차순이어야 합니다. 멀티서버에서는 `loading_retries` 를 지원하지 않습니다(문서가 향후 수정 필요로 인정) `✓`.

ClickHouse Cloud 의 S3 ClickPipes 는 "S3 ClickPipe guarantees exactly-once semantics, so no duplicates make it into your target table"라고 광고합니다 `Ⓥ`. 이건 Cloud 관리형 레이어의 보장이고 OSS S3Queue 의 보장이 아닙니다. 두 문장을 같은 근거로 쓰면 설계가 틀어집니다 `Σ`.
{{< /callout >}}

## 성능 — MergeTree 와 Parquet-on-S3 의 실제 격차

ClickHouse와 Altinity가 공개한 벤치마크는 엔진, 노드 수, 튜닝 조건이 다릅니다. 아래 수치는 각 실험의 결과로 읽고 우리 쿼리의 속도 비율로 사용하지 않습니다.

| 측정 | 결과 | 등급 |
|---|---|---|
| ClickBench 43쿼리 **콜드 합산** | MergeTree **28초** vs Parquet **56초** (약 2배) | `Ⓑ`/`Ⓥ` |
| ClickBench 개별 Q41 | MergeTree 콜드 30ms / 핫 10ms vs Parquet 콜드 170ms / 핫 140ms (약 5배) | `Ⓑ`/`Ⓥ` |
| 25.8 신규 Parquet 리더 v3 | ClickBench 쿼리 **평균 1.81배** 개선, 예시 쿼리 1.513s→0.703s | `Ⓑ`/`Ⓥ` |
| Altinity 벤치마크(NYC Taxi 13억 행, c7g.8xlarge, 5쿼리) | Iceberg/Parquet 가 MergeTree 와 비슷하거나 **더 빠름**(Q1: MergeTree 1.5s vs Iceberg 0.7s) | `Ⓥ` |

ClickBench 작성자도 범용 Parquet과 전용 엔진 MergeTree의 비교가 완전히 공정하지 않다고 설명합니다 `✓`. 25.8 리더 v3는 Arrow 중간 레이어 제거, 컬럼 병렬 처리, PREWHERE 지원으로 성능을 개선했습니다. 버전에 따라 차이가 변하므로 “Parquet은 2배 느리다”처럼 고정된 비율로 볼 수 없습니다 `Σ`.

Altinity 실험은 MergeTree를 기본 설정으로 두고 Iceberg 쪽에 4노드 swarm을 사용했습니다. 바닐라 OSS가 아닌 Antalya 배포판의 결과이며 비교 버전도 확인이 필요합니다 `?`. 따라서 수치는 `Ⓥ`로 유지합니다. 이 결과만으로 단일 OSS ClickHouse의 Iceberg 쿼리 성능을 예측하기는 어렵습니다.

## 조회 패턴에 따른 MergeTree와 Iceberg 비교 {#왜-iceberg-가-mergetree-를-대체하지-못하는가--같은-층이-아니다}

MergeTree의 정렬키와 sparse index, Parquet의 파일·row group 통계는 데이터를 건너뛰는 단위가 다릅니다. Iceberg 도입으로 얻는 데이터 공유의 이점과 실제 조회 성능을 함께 비교해야 합니다.

| 축 | MergeTree | Iceberg (+ Parquet) |
|---|---|---|
| **빠른 이유** | 정렬키 + sparse index → 인메모리 인덱스가 값이 든 블록을 짚어낸다. 프라이머리 키 기반으로 훨씬 고운 해상도의 스킵 `✓` (granule 기본 크기는 이 조사 범위 밖 `?`) | 파일·row group·page 단위 min/max 통계와 Bloom filter → **스킵 해상도가 파일/row group 단위로 거칠다** `✓`. Iceberg 스펙에는 sparse primary index·inverted index 가 **네이티브로 없다** `✓` |
| **실시간 인제스트** | 작은 INSERT 를 자동 배치·정렬해 쓰고, 백그라운드 merge 가 계속 큰 파일로 합친다 — 사용자에게 투명 `✓` | 커밋마다 파일이 생겨 **small file 이 폭증**하고, compaction 을 외부에서 돌려야 한다(§2 의 유지보수 표) `✓` |
| **데이터 소유** | 엔진 배타 — 그 데이터는 ClickHouse 것이다 | **여러 엔진 공유** — 중립 스토리지 층이고, 이게 존재 이유다 `✓` |
| **잘 맞는 워크로드** | 고카디널리티 포인트 조회 + 실시간 인제스트 + 대시보드 저지연 `Σ` | 대규모 순차 스캔, 장기 아카이브, 스키마가 계속 변하는 데이터, 여러 팀·여러 엔진이 같은 데이터를 읽는 조직 `Σ` |

고카디널리티 식별자로 소량을 찾는 쿼리와 장기 데이터를 넓게 읽는 쿼리는 요구가 다릅니다. 엔진 공유가 필요해 Iceberg를 사용하더라도 조회 지연과 compaction 운영 비용은 별도로 측정해야 합니다 `Σ`.

## 관측성에는 맞는가 — 저자들이 열거한 다섯 가지 한계

ClickHouse 공식 블로그 "Are open-table-formats + lakehouses the future of observability?"(Melvyn Peignon, Dale McDiarmid, 2025-10-16)가 이 질문을 정면으로 다룹니다(저자·게재일 원문 확인 `✓`). 저자들은 장기적으로 낙관하지만 현재의 관측성 메인 스토리지로는 다섯 가지 한계를 듭니다 `✓`. TL;DR 은 "becoming viable"이고 본문 후반은 "open table formats will ultimately become a central component of open, cost-efficient observability architectures"라고 씁니다 — "안 된다"가 아니라 "아직 아니다"입니다 `✓`.

| # | 한계 | 원문(발췌) | 등급 |
|---|---|---|---|
| 1 | **포인트 조회 지연** | "When investigating a specific trace or log event, analysts often query by unique identifiers such as trace_id or span_id. These lookups are high-selectivity with Parquet's structure simply not built for this access pattern." / "high latency point reads represent a limitation for using lakehouses for observability" | `✓` |
| 2 | **준정형 JSON 비효율** | "working with semi-structured data in Parquet often requires reading and decompressing entire pages of encoded data just to access a single field" | `✓` |
| 3 | **메타데이터 폭증** | "In high-ingest environments such as observability, these structures can grow to millions of entries, increasing query planning latency, memory use, and lowering insert performance." | `✓` |
| 4 | **커밋 컨텐션** | "at very high ingestion rates common in observability workloads, contention on the table's metadata pointer can become a bottleneck, leading to repeated retries and slower commit throughput" | `✓` |
| 5 | **요청 증폭** | "even a small query can trigger dozens of sequential HTTP range requests before any data is processed. This “request amplification” effect makes Parquet inherently “chatty” on object stores." | `✓` |

이 글은 MergeTree를 개발한 ClickHouse가 작성했습니다. 자사 엔진의 장점을 설명하는 자료라는 점을 감안해, 아래 한계가 우리 쿼리에서도 나타나는지 확인해야 합니다.

포인트 조회와 JSON 필드 접근은 Parquet의 page 압축·디코딩과 관련되고, 적재율이 높으면 매니페스트 수와 메타데이터 갱신 빈도도 늘어납니다. 우리 RUM의 `trace_id` 조회, 계속 추가되는 속성, 상시 인제스트가 이 비용을 얼마나 만드는지는 실측 대상입니다 `Σ`.

무엇보다 저자들이 제시하는 현실 대안이 이중 쓰기입니다. "In real-world observability deployments, some users have adopted a dual-write architecture. Observability data is written both to ClickHouse's MergeTree tables for hot, real-time analysis and to open table formats for long-term cold retention." `✓` 이 패턴을 Netflix 같은 조직이 쓰고 있습니다. 저자들 스스로 비효율도 인정합니다 — "remains popular but introduces inefficiency - data must be written twice and managed separately" `✓`.

관측성 진영에서 검증된 Iceberg 활용형은 "메인 스토리지 교체"가 아니라 "핫은 MergeTree, 콜드는 오픈 테이블 포맷"의 병행입니다. 그 병행조차 데이터를 두 번 쓰는 대가를 냅니다 `Σ`.

### 격차를 좁히는 것들 — 재검토의 기술적 조건

같은 글은 포맷과 인덱스를 개선하는 움직임도 소개합니다. 현재 제약을 완화할 후보들이지만 조사 시점의 적용 가능성은 각각 다릅니다.

| 움직임 | 무슨 한계를 겨냥하나 | 상태 |
|---|---|---|
| **liquid clustering** (Databricks 발) | 전체 재작성 없이 백그라운드에서 점진 재클러스터링 → compaction·정렬 운영 부담 `✓` | 생태계로 확산 중, 우리 조사에 self-host 적용 근거 없음 `?` |
| **Parquet `VARIANT` 타입** | 준정형 JSON 비효율(§6-2). 한 컬럼에 객체·배열·스칼라를 담고, 필드명은 딕셔너리 인코딩하며, **shredding** 으로 중첩 필드를 별도 컬럼으로 물질화 — ClickHouse `JSON` 타입이 하는 일과 유사 `✓` | "still early in adoption" `✓` |
| **Lance·Vortex·FastLanes·BtrBlocks** | row group 이라는 고정 단위 자체를 폐기. Lance 는 컬럼별로 독립 flush 되는 fragment 로 저장해 대규모 스캔과 세밀한 랜덤 읽기를 동시에 노리고, 인코딩·통계를 플러그인으로 분리한다 `✓` | 전부 라이프사이클 초기 `✓` |
| **인덱스 층 보강** | Iceberg 에는 sparse primary index·inverted index 가 **스펙상 없다**. 일부 상용 구현이 외부 인덱스 층을 얹지만 **벤더 종속이고 오픈소스 표준이 아니다** `✓` | 오픈소스 프로젝트가 등장하는 단계 `✓` |
| **ClickHouse 의 수렴 비전** | 개방 포맷 테이블을 "그냥 또 하나의 ClickHouse 테이블"로 취급해 머티리얼라이즈드 뷰까지 쓰게 한다는 방향 `✓` | 비전 서술이며 구현 시점 미확인 `?` |

저자들 스스로 신규 포맷들을 두고 "none have yet been tested at the full scale or complexity of production observability pipelines"라고 적어 둡니다 `✓`. 다섯 한계는 사라지지 않고 자리를 옮기는 중입니다. 지금 결정을 내리는 사람에게는 아직 존재하는 한계입니다 `Σ`.

## S3 cold tier·주 볼륨·데이터레이크 비교 {#그래서-s3-메인의-답인가--세-갈래를-분리한다}

S3를 사용해도 데이터 형식과 복제 방식이 같지는 않습니다. 기존 MergeTree의 cold tier, S3를 주 볼륨으로 쓰는 MergeTree, Iceberg 데이터레이크를 구분하면 도입 목적이 분명해집니다 `Σ`.

| 갈래 | 무엇인가 | self-host 가능성 | 우리 판단 |
|---|---|---|---|
| **① cold tier** | 로컬 NVMe hot + `TTL ... TO VOLUME 'cold'` 로 S3 이동 | 코어 내장, 검증된 표준 `✓` | **이미 고른 것.** 상세는 [스토리지 · 로컬 NVMe]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}}) |
| **② S3 primary** | storage policy 로 S3 단독 볼륨 구성 | 문법적으로 가능. 단 3중 제약 | 비권장 — 아래. OSS 경로(`plain_rewritable`)의 기각 판정은 [스토리지 · S3 primary 의 OSS 경로]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}}) |
| **③ 데이터레이크** | Iceberg 테이블을 만들고 여러 엔진이 공유 | 기능은 있음(§3), 성숙도 편차 | **다른 축.** 지금은 도입 안 함 |

② 는 문법적으로 가능하지만 이름부터 정정해야 합니다. ClickHouse 공식 가이드가 산문에서 쓰는 "S3BackedMergeTree"는 등록된 테이블 엔진 이름이 아닙니다. 같은 가이드의 DDL 예제가 그 증거입니다 `✓`.

```sql
CREATE TABLE my_s3_table
  (
    `id` UInt64,
    `column1` String
  )
ENGINE = MergeTree
ORDER BY id
SETTINGS storage_policy = 's3_main';
```

`ENGINE =` 뒤에 오는 것은 `MergeTree` 뿐입니다. S3 는 `storage_policy` 로 붙습니다(디스크 정의는 `storage_configuration` 의 `<type>s3</type>` 디스크 + `<type>cache</type>` 캐시 디스크 조합) `✓`. 문서 자신이 "Note that we didn't have to specify the engine as `S3BackedMergeTree`. ClickHouse automatically converts the engine type internally if it detects the table is using S3 for storage"라고 설명합니다. 문서 산문 속 설명어일 뿐 엔진 클래스가 아닙니다 `✓`. 자료에서 이 이름을 보면 엔진명이 아니라 설명어로 읽어야 합니다. `system.tables` 의 engine 컬럼에 그 이름이 나온다는 서술은 근거가 없습니다 `Σ`.

같은 가이드가 명시하는 제약은 이렇습니다 `✓` — (1) "Don't configure any AWS/GCS life cycle policy. This isn't supported and could lead to broken tables.", (2) "implementing and managing a separation of storage and compute architecture is more complicated compared to standard ClickHouse deployments", (3) 적합 사용 사례를 "use cases where query performance on 'cold' data is less critical"로 한정. self-host 로 이 구성을 하는 독자에게는 "we recommend using ClickHouse Cloud, which allows you to use ClickHouse in this architecture without configuration using the SharedMergeTree table engine"라고 권합니다 `✓`. self-host 를 금지하는 문장은 아니고 "설정 없이 하려면 Cloud"라는 뜻입니다.

여기에 우리 도메인이 이미 확정한 3중 제약이 겹칩니다 — 사본 배수(shared-nothing 이라 RF2 면 S3 에도 2벌), 메타데이터 지역성(part metadata 가 로컬에 남아 filesystem cache 가 사실상 필수), 지연(콜드 쿼리가 느립니다). 상세는 반복하지 않고 [스토리지 · 로컬 NVMe]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})와 [Managed vs Self-hosted]({{< relref "/data/clickhouse/deployment/01-managed-vs-selfhosted.md" >}})에 위임합니다. "S3 를 1벌만 두고 컴퓨트가 캐시로 읽는" OSS 경로(`plain_rewritable` + readonly part refresh)를 왜 기각하는지는 [스토리지 · S3 primary 의 OSS 경로]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})에서 다룹니다. 기각 사유 6개 중 결정적인 것은 mutation·테이블 복제 미지원으로 RMT 와 배타라는 사유입니다.

Iceberg를 선택하면 Spark·Trino·DuckDB 등과 테이블을 공유할 수 있습니다. 현재 ClickHouse의 S3 저장 비용만 낮추려는 목적이라면 이 기능을 위해 카탈로그와 compaction을 추가할 이득이 있는지 따져야 합니다. 관측성 조회 성능과 HyperDX의 테이블 계약도 함께 검토합니다.

### Altinity Antalya 는 어디에 놓나

"Iceberg 를 메인으로"가 실제로 통한다는 주장의 출처는 바닐라 OSS 가 아니라 대부분 Altinity Antalya 입니다. Antalya 는 ClickHouse 에 stateless compute swarm, 분산 캐싱, tiered storage-on-Iceberg 를 더한 별도 브랜치/배포판입니다. Altinity.Cloud(관리형/BYOC)와 self-managed 설치 양쪽에 쓰입니다 `≈`. "10배 저렴한 Iceberg 스토리지 위에서 무한 확장 쿼리"는 그 배포판의 아키텍처 산물입니다. OSS 표준 기능이 아닙니다 `Ⓥ`.

Antalya의 swarm과 분산 캐시는 바닐라 OSS의 Iceberg 읽기·쓰기 기능과 별도 구성입니다. Antalya 벤치마크를 OSS의 성능 근거로 사용할 수 없는 이유입니다. 조사 당시 Antalya의 프로덕션 준비성 표기를 확인하지 못했으므로 `?`로 남깁니다. 채택 검토 시 설치 형태와 지원 범위를 확인해야 합니다.

{{% details title="후속 조사거리 (지금은 근거가 없어 결론을 내리지 않은 것들)" closed="true" %}}
- `DataLakeCatalog` 의 Glue/Unity/REST/HMS 커넥터가 self-host OSS 환경에서 실제로 얼마나 안정적인가 — 공식 자료가 Cloud 맥락에 치우쳐 self-host 실사용 보고가 없습니다 `?`.
- `allow_experimental_iceberg_compaction` 이 프로덕션에서 small file 폭증을 얼마나 억제하는가 — 수치 근거가 없습니다 `?`.
- `s3`/`deltaLake`/`hudi` 테이블 함수가 Parquet 파일 레벨 min/max 통계로 프레디케이트 푸시다운을 실제로 수행하는가 — 문서에 명시가 없어 실측이 필요합니다 `?`.
- "핫=MergeTree, 콜드=Iceberg" 이중 쓰기를 운용하는 프로덕션 사례(Netflix 외)의 구체적 SLA·비용 수치 `?`.
- 26.2(PR #97483)에서 추가된 `allow_experimental_insert_into_iceberg` 별칭의 새 이름이 `allow_insert_into_iceberg` 인지 — CHANGELOG 가 이름을 적지 않아 축어 확인이 필요합니다 `?`.
{{% /details %}}

## 현재 RUM에서는 도입을 미룬다 {#우리-케이스에서는}

현재 RUM 유입은 월 약 0.7TB이며 [HyperDX 내재화]({{< relref "/observability/hyperdx/design/_index.md" >}})에서는 EBS-first로 시작합니다. 대규모·상시 부하를 가정한 [로컬 NVMe 설계]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})와 매체는 다르지만, 두 경우 모두 RMT와 S3 cold tier를 사용하고 Iceberg 도입은 보류합니다.

RUM과 트레이스 조사에는 `trace_id`·`session_id` 조회가 필요하고 JSON 속성도 계속 늘어납니다. 현재 규모에서는 여러 엔진이 같은 테이블을 읽어야 한다는 요구가 없습니다. Iceberg를 추가하면 카탈로그, 파일 compaction, 메타데이터 정리를 운영해야 하는데 이를 감수할 이득은 아직 확인하지 못했습니다 `Σ`.

HyperDX의 조회 계약도 고려해야 합니다. ClickStack collector가 생성하는 `otel_logs`·`otel_traces`·`hyperdx_sessions` 등의 MergeTree 테이블을 Iceberg로 바꾸면 UI 쿼리와 스키마 호환성을 직접 유지해야 합니다. 제품 선택 배경은 [HyperDX/ClickStack]({{< relref "/observability/logs/comparison/05-hyperdx-clickstack.md" >}})에 있습니다.

보존 기간이 1년 이상으로 늘고 Spark·Trino·DuckDB에서 cold 데이터를 분석해야 한다면 아카이브 경로를 검토할 수 있습니다. 이때는 보존 종료 전에 MergeTree 데이터를 Iceberg로 내보내고, 내보내기 성공과 재처리·삭제 순서를 설계합니다. 이 경로도 MergeTree에 있던 데이터를 다시 기록하지만 hot 조회 경로를 유지한 채 장기 보존 형식을 바꾸는 방식입니다.

검토를 시작할 때는 self-host `DataLakeCatalog` + Glue 연동과 해당 버전의 Iceberg 쓰기 지원을 확인합니다. S3 primary를 원하는 경우의 `plain_rewritable` 제약은 [스토리지 글]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})에서 별도로 다룹니다. 시점 기준 2026-08.
