---
title: "Iceberg·레이크하우스 — 테이블 포맷이 뭐고, S3 메인의 답이 되는가"
weight: 9
---

# Iceberg·레이크하우스 — 테이블 포맷이 뭐고, S3 메인의 답이 되는가

{{< callout type="info" >}}
**한눈에** — Iceberg 는 "S3 를 싸게 쓰는 방법"이 아니라 "여러 엔진이 공유하는 개방 테이블을 만드는 방법"이고, 그래서 우리의 "S3 를 메인 스토리지로" 문제의 답이 아니다 `Σ`.

- **층을 나누면 간단하다** — 파일 포맷(Parquet) / 테이블 포맷(Iceberg) / 카탈로그(Glue·REST·Unity·Nessie) / 쿼리 엔진(ClickHouse·Spark·Trino)의 4층이고, Iceberg 는 2층이다. 커밋의 원자성은 3층(카탈로그 포인터 교체)이 만든다 `✓`.
- **ClickHouse 는 이미 읽고 쓴다 — 다만 게이트 뒤에 있다** — INSERT 는 25.7 `✓`, CREATE·ALTER DELETE·DROP TABLE 은 25.8 `✓`, ALTER UPDATE 는 25.9 `✓`, 매니페스트 compaction 은 26.7 에 들어왔고 아직 Experimental `✓`.
- **성능 격차는 층 차이에서 온다** — ClickBench 콜드 43쿼리 합산 MergeTree 28초 vs Parquet 56초, 개별 쿼리는 최대 약 5배 `Ⓑ`/`Ⓥ`. MergeTree 는 정렬키+sparse index 로 스킵하고 Iceberg 는 파일·row group 통계로 스킵한다 — 해상도가 다르다 `✓`.
- **관측성 메인 스토리지로는 공식적으로도 비권장** — ClickHouse 저자들이 포인트 조회 지연·JSON 비효율·매니페스트 폭증·커밋 컨텐션·요청 증폭 다섯 가지를 직접 열거하고, 현실 대안으로 "핫=MergeTree, 콜드=오픈 테이블 포맷" 이중 쓰기를 든다 `✓`.
- **우리는 지금 도입하지 않는다** — 재검토 트리거는 "보존 1년+ 이면서 콜드 데이터를 관측성 UI 가 아닌 다른 엔진이 읽어야 할 때"이고, 그때의 형태는 이전이 아니라 아카이브 경로다 `Σ`.
{{< /callout >}}

이 페이지는 질문 하나에 답합니다 — **"Iceberg 가 대체 뭔가. 그리고 그게 'self-host 에서 S3 를 메인 스토리지로' 문제의 답이 되는가."** [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}})가 self-host 의 스토리지 매체를 고르고 "S3 는 primary 가 아니라 cold tier"라고 결론냈고, [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}})가 그 이유를 아키텍처(SharedMergeTree 는 Cloud 전용)로 설명했습니다. 그 두 페이지를 읽고 나면 자연스럽게 남는 미련이 하나 있습니다 — "업계가 다 한다는 그 레이크하우스로 가면 S3 를 메인으로 쓸 수 있는 거 아닌가."

답은 "아니다"인데, 그 이유가 "Iceberg 가 미성숙해서"가 아니라 **애초에 다른 문제를 푸는 기술이기 때문**이라는 점이 이 장의 핵심입니다. 그래서 결론을 먼저 던지지 않고 층을 쌓아 올립니다. Iceberg 를 한 번도 안 다뤄봤다는 독자를 전제로 §1~§2 에서 개념을 세우고, §3 에서 ClickHouse 가 실제로 할 수 있는 일을 버전·설정키 단위로 확정하고, §4~§6 에서 성능·워크로드 적합성을 따진 뒤, §7 에서 "S3 메인"의 세 갈래를 분리합니다.

{{% details title="근거 등급 태그 · 출처 규칙" closed="true" %}}
근거 등급 태그는 입력 조사의 판정을 이어받습니다(`✓`·`Ⓥ`·`Ⓑ`·`≈`·`?`, 이 페이지의 신규 종합 판단은 `Σ`). ClickHouse Inc./Altinity 블로그의 자사 유리한 수치는 `Ⓥ`로 격하하고 `✓`로 승격하지 않습니다. URL 출처는 이 페이지가 아니라 [출처]({{< relref "10-sources.md" >}})가 담당합니다.

**1차 출처 범위** — 버전 게이트는 로컬 CHANGELOG 원문으로 축어 검증했습니다. 2023·2024·2025 연도별 changelog 와 26.1~26.7(2026-01-29~2026-07-22)을 모두 사용했고, 25.7~25.9 항목은 2025 changelog 의 해당 릴리스 섹션에 그대로 있습니다 — 25.7 #82692 / 25.8 #83983·#85549·#85843·#85395·#85848 / 25.9 #86059·#86783 `✓`. 이 장에서 `≈`·`?` 로 남은 것은 CHANGELOG 가 다루지 않는 항목(설정키 리네임의 새 이름, 카탈로그 커넥터의 self-host 성숙도, Antalya 준비도)에 한합니다.

§7-② 의 축어 인용은 공식 "Separation of storage and compute" 가이드, 아래 25.7 인용은 PR #82692 본문에서 가져왔습니다 — URL 은 [출처]({{< relref "10-sources.md" >}}).
{{% /details %}}

## S3 에 없는 것 — Iceberg 가 존재하는 이유

S3 는 데이터베이스가 아닙니다. 그리고 파일시스템도 아닙니다. S3 에 없는 것을 세 개만 꼽으면 이렇습니다 `Σ`.

- **디렉토리가 없다.** `s3://bucket/a/b/c.parquet` 의 슬래시는 그냥 키 문자열의 일부이고, "폴더"는 접두사 조회(LIST)를 예쁘게 보여주는 클라이언트의 착시다.
- **여러 파일에 걸친 원자적 변경이 없다.** 파일 하나의 PUT 은 원자적이지만, "파일 200개를 지우고 새 파일 150개를 추가한다"를 한 번에 성공/실패시킬 방법이 없다.
- **"이 테이블의 현재 상태"라는 개념이 없다.** 지금 이 접두사 아래 있는 파일 중 어느 것이 유효한 데이터인지 S3 는 모른다.

Hive 시절엔 이걸 **경로 규약**으로 때웠습니다. `s3://bucket/tbl/dt=2026-08-12/*.parquet` 같은 디렉토리 관례를 쿼리 엔진이 알아서 해석하게 하는 방식입니다. 결과는 세 가지 고질병이었습니다 `Σ` — 파티션을 찾으려면 LIST 를 반복해야 해서 느리고, 쓰는 중에 읽으면 절반만 올라간 파일 집합을 테이블로 착각하고, 스키마를 바꾸면 과거 파일과 현재 쿼리의 계약이 깨집니다.

**Iceberg 는 그 경로 규약을 명시적 메타데이터로 승격시킨 것입니다.** "어디에 뭐가 있는지"를 디렉토리 구조에 암묵적으로 인코딩하는 대신, 유효한 파일 목록·스키마·파티션 규칙·파일별 통계를 메타데이터 파일에 적어두고, "지금 유효한 메타데이터는 이것"이라는 포인터를 한 곳에 둡니다. 이게 전부입니다. 나머지 성질(스냅샷 격리·time travel·스키마 진화)은 이 설계에서 자동으로 따라 나오는 부산물입니다 `Σ`.

ClickHouse 저자들의 표현을 그대로 옮기면, 테이블 포맷은 "loose collections of files"를 "coherent, mutable tables"로 바꿉니다 `✓`.

## 4층 케이크 — 파일 포맷 / 테이블 포맷 / 카탈로그 / 엔진

레이크하우스 논의가 어려운 이유의 절반은 이 네 층을 섞어 부르는 데서 옵니다. "Parquet 로 갈까 Iceberg 로 갈까"는 애초에 성립하지 않는 질문입니다 — Iceberg 는 Parquet 위에 얹히는 층입니다 `✓`.

| 층 | 대표 구현 | 무엇을 담당하나 | 없으면 무슨 일이 생기나 |
|---|---|---|---|
| **① 파일 포맷** | Parquet, ORC | 열 지향 파일 **한 개**. 컬럼 청크·page 분할, page 단위 압축(ZSTD·Snappy), footer 의 스키마·컬럼 min/max 통계, row group 단위 Bloom filter `✓` | 열 지향의 압축·필터 이득 자체가 없다 |
| **② 테이블 포맷** | Iceberg, Delta Lake, Hudi | Parquet 수천 개를 논리적 "테이블" 하나로. 현재 스냅샷의 유효 파일 목록(manifest), 스키마 버전 이력, 파티션 규칙, 파일·컬럼 단위 통계 `✓` | 파일 뭉치일 뿐 — 쓰는 중 읽기·스키마 변경이 깨진다 |
| **③ 카탈로그** | AWS Glue, Iceberg REST, Unity, Hive Metastore, Nessie `✓` | "테이블 이름 → 지금 유효한 메타데이터 파일"의 포인터. 커밋 = 이 포인터의 **원자적 교체** `✓` | 테이블을 이름으로 못 찾고, 커밋의 원자성이 사라진다 |
| **④ 쿼리 엔진** | Spark, Trino, Flink, DuckDB, **ClickHouse** | ①~③ 을 해석해 실제 계산 수행. **여러 엔진이 같은 테이블을 동시에 붙을 수 있다** `✓` | 계산 주체가 없다 |

① 을 조금 더 풀면 ② 가 왜 필요한지가 선명해집니다. Parquet 파일 하나는 컬럼별 **column chunk** 로 나뉘고, chunk 는 다시 수 MB 규모의 **page** 로 쪼개져 page 단위로 압축됩니다. 그리고 chunk 들을 데이터셋의 가로 슬라이스인 **row group** 으로 묶습니다 — 대부분의 엔진이 이 row group 을 병렬 처리 단위로 씁니다 `✓`. 파일 맨 뒤 **footer** 에 스키마·인코딩·컬럼 min/max 가 들어가고, page 에도 min/max 가 붙고, row group 단위로 Bloom filter 를 지원합니다 `✓`. 여기까지가 "파일 한 개"의 이야기이고, **파일 여러 개를 하나의 테이블로 취급하는 규칙은 Parquet 스펙에 없습니다** — 그 공백이 ② 의 존재 이유입니다 `Σ`.

층 구분에서 가장 실용적인 결론은 **③ 이 원자성의 소재지**라는 것입니다. 쓰는 쪽은 새 데이터 파일과 새 메타데이터 파일을 다 써놓고 마지막에 카탈로그 포인터만 바꿉니다. 읽는 쪽은 쿼리 시작 시점의 포인터를 잡고 그 스냅샷만 봅니다. 그래서 전환 순간에도 반쪽 데이터가 보이지 않습니다 — 저자들의 표현으로 "commits are handled atomically by the catalog" `✓`.

그리고 ④ 의 "여러 엔진 공유"가 Iceberg 의 **정치적** 존재 이유입니다. ClickHouse 저자들조차 이 점은 명확히 인정합니다 — 테이블 포맷은 "eliminate vendor lock-in"하고 "decouple storage from compute, creating a neutral storage layer that any query engine can attach to" 합니다 `✓`. Iceberg 를 도입하는 회사가 실제로 사는 것은 성능이 아니라 **엔진 교체 자유**입니다 `Σ`.

### 층에서 파생되는 네 가지 성질

| 성질 | 어떻게 나오나 | 근거 |
|---|---|---|
| **스냅샷 격리** | 읽기가 시작 시점 포인터를 고정 → 동시 쓰기에도 일관된 뷰 | `✓` "consistent view across large, distributed writes" |
| **time travel** | 과거 스냅샷의 메타데이터가 남아 있음 → 그 시점 파일 목록으로 조회 | `✓` |
| **스키마 진화** | 스키마 버전을 메타데이터에 기록 → 과거 파일 재작성 없이 컬럼 추가·변경 | `✓` "older data remains queryable even as the schema grows" |
| **hidden partitioning** | 파티션 규칙을 메타데이터가 소유 → 쿼리가 파티션 컬럼을 몰라도 프루닝 | `?` 이 조사의 1차 출처가 다루지 않았다 |

{{< callout type="important" >}}
스키마 진화가 **관측성에 특히 값비싼 기능**이라는 점은 짚어둬야 공정합니다. 텔레메트리는 속성이 계속 새로 생기고, 그걸 커스텀 메타데이터 레이어로 직접 관리하는 것이 원래 로그 파이프라인의 고질적 부채입니다. 테이블 포맷은 그 부채를 표준화해서 없앱니다 `✓`. Iceberg 를 깎을 이유가 없는 영역입니다.
{{< /callout >}}

### 층이 청구하는 것 — 정렬·compaction·row group 크기는 누가 하나

②③ 이 데이터베이스 같은 의미론을 주지만, 데이터베이스가 자동으로 해주던 일 몇 가지를 **사용자에게 되돌려줍니다**. 이게 레이크하우스 도입의 실제 비용이고, 이 장의 결론이 걸리는 지점입니다.

| 유지보수 작업 | Iceberg 레이크하우스 | MergeTree |
|---|---|---|
| **쓰기 전 배치·정렬** | 들어오는 데이터를 파티션 키(타임스탬프·서비스명 등)에 맞춰 미리 모아 정렬해야 한다. 보통 Kafka·Flink·Spark 같은 **외부 시스템으로 조정** `✓` | 엣지 에이전트·컬렉터의 작은 INSERT 를 **자동 배치·정렬** `✓` |
| **compaction** | 시간이 지나면 정렬이 흐트러지고(늦게 도착한 이벤트) 작은 파일이 쌓인다 → 주기적 compaction 필수. 실행 주체는 보통 **Spark·Athena 같은 외부 엔진**, 관리형(Databricks)은 백그라운드 자동 `✓` | 백그라운드 merge 가 계속 큰 정렬 파일로 합침 — **사용자에게 투명** `✓` |
| **compaction 파라미터** | 파일 개수, 최소/최대 파일 크기, 파일 그룹당 총 바이트를 사용자가 정해야 한다 `✓` | 해당 없음 |
| **파티션 전략** | 과분할 → 작은 파일 폭발, 과소분할 → 불필요하게 넓은 스캔. 외부 프로세스나 관리형 서비스로 직접 해결해야 한다 `✓` | 파티셔닝도 지원하지만 **프라이머리 키**로 훨씬 고운 해상도의 정렬·필터를 얻는다 `✓` |
| **row group 크기 선택** | 작게 잡으면 통계가 촘촘해져 스킵·병렬성이 좋아지지만 footer 가 커져 플래닝이 느려지고, 크게 잡으면 메타데이터는 줄지만 프루닝·병렬성이 떨어지고 압축 해제 메모리가 늘어난다. **최적값은 워크로드 의존이고 자명하지 않다** `✓` | 해당 없음 |
| **메타데이터 관리** | 매니페스트 병합, 스냅샷 만료, 가비지 컬렉션을 주기적으로 돌려야 하고 조정·컴퓨트 자원이 든다 `✓` | 해당 없음 |

저자들이 이 대목에 붙인 문장이 이 표의 요약입니다 — row group 크기 같은 최적화는 "low-level and often extremely time-consuming to get right"이며 "well beyond the interests or responsibilities of most observability teams, who generally want a storage engine that simply works" `✓`. 벤더 편향을 감안해도, **위 표의 왼쪽 열은 우리가 새로 소유해야 하는 운영 항목 목록**이라는 사실 자체는 편향과 무관합니다 `Σ`.

## ClickHouse 는 Iceberg 로 무엇을 할 수 있나 (2026-08 기준)

여기서부터는 추측을 섞지 않습니다. 확인된 버전·설정키만 쓰고, 확인 못 한 것은 `?`로 남깁니다.

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

25.7 도입 당시 PR 본문은 범위를 스스로 못박았습니다 — "The current version supports only `insert` operations for local tables ... Integration with catalogs and support for `create` will be in next MRs" `✓`. 즉 **쓰기는 처음부터 단계적으로 열렸고, 그 계단이 25.7 → 25.8 → 25.9 입니다**.

성숙도를 읽는 다른 신호도 있습니다. 26.7 CHANGELOG 에는 "Fix a crash when reading Iceberg tables with equality delete files"(#109551)가 버그픽스로 올라와 있습니다 `✓`. equality delete 읽기가 25.8 에 들어온 뒤 1년가량 지난 시점에도 크래시 수정이 나온다는 뜻입니다 — 기능 존재와 프로덕션 신뢰도는 별개라는 판단의 근거가 됩니다 `Σ`.

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

`DataLakeCatalog` 데이터베이스 엔진이 Glue·Unity Catalog·Hive Metastore·Iceberg REST·OneLake 를 붙입니다. 활성화에는 카탈로그별 설정이 필요합니다 — `allow_experimental_database_iceberg`, `allow_experimental_database_unity_catalog`, `allow_experimental_database_glue_catalog`, `allow_experimental_database_hms_catalog`, `allow_experimental_database_paimon_rest_catalog` `≈`. 이 중 Unity·Glue·REST·Hive Metastore 네 개는 PR #85848(25.8 반영)로 experimental → beta 승격됐습니다 — 2025 CHANGELOG 25.8 섹션 축어로 "Unity, Glue, Rest, and Hive Metastore data lake catalogs are promoted from experimental to beta" `✓`. 승격과 함께 `allow_experimental_database_*` 에 `allow_database_*` 별칭이 붙었으나, 문서 축어로 확인되는 것은 `allow_experimental_database_iceberg` ↔ `allow_database_iceberg` 한 쌍이고 나머지는 같은 규칙의 유추입니다 `≈`. 이름에는 아직 experimental 이 남아 있습니다. 공식 설정 레퍼런스의 Beta 표 등재 여부는 원문을 확보하지 못했습니다 `?`.

{{< callout type="important" >}}
**여기서 정직해야 할 지점이 있습니다.** 엔진 코드 자체는 OSS 이지만, 카탈로그 통합을 소개하는 ClickHouse 공식 자료는 Cloud 맥락에 치우쳐 있습니다 — 대표 블로그가 "엔진 자체는 오픈소스이나 이 글은 Cloud 에 초점을 둔다"고 스스로 명시합니다 `≈`. 그래서 **self-host 에서 Glue/Unity 연동이 실제로 얼마나 매끄러운지에 대한 1차 근거가 우리에게 없습니다** — 도입을 검토한다면 이 부분은 반드시 스테이징 실측으로 메워야 하는 공백입니다 `Σ`.
{{< /callout >}}

Unity Catalog 데뷔는 24.12 무렵, Glue + Delta-on-Unity 는 25.3 언급으로 보이지만 정확한 마이너 버전은 확인하지 못했습니다 `?`.

### 인접 경로 — Delta/Hudi, s3/s3Cluster, S3Queue

Iceberg 만 보면 시야가 좁아집니다. S3 를 데이터 소스로 쓰는 경로가 여럿이고, 층이 서로 겹칩니다.

| 경로 | 무엇인가 | 상태 |
|---|---|---|
| **Delta Lake** | `deltaLake`·`deltaLakeAzure`·`deltaLakeLocal`·`deltaLakeCluster` 테이블 함수. 쓰기(`allow_experimental_delta_lake_writes`)는 **26.7 에 Beta 승격** `✓` | Iceberg 보다 덜 성숙 `≈` |
| **Hudi** | `hudi` 테이블 함수. min/max 파일 통계·파티션 프루닝이 표준 수단으로 문서에 언급되나 ClickHouse 측 최적화 수준의 공식 자료가 빈약 | `≈` |
| **프루닝 미해결 이슈** | `deltaLakeCluster`를 직접 호출하면 파티션 프루닝이 동작하는데, **뷰나 CTE 를 경유하면** `DeltaLakePartitionPrunedFiles`가 0 이 되고 무관한 파일까지 읽는다(#85093, 미해결) | `≈` |
| **`s3`/`s3Cluster`** | Hive 스타일 파티셔닝(`use_hive_partitioning=1`)으로 `/name=value/` 를 가상 컬럼화, glob(`*`,`**`,`?`,`{a,b}`,`{N..M}`) 지원, `s3Cluster`는 여러 replica 에 분산 | `≈` |
| 같은 경로의 한계 | Parquet **파일 레벨 min/max 통계 기반 프레디케이트 푸시다운**이 `s3` 함수 문서에 명시되지 않았다 — 이건 s3 함수의 기능이 아니라 Parquet 리더의 일반 기능으로 봐야 한다(층이 겹치는 지점) | `?` |

**`S3Queue` 는 성격이 다릅니다.** 위 경로들이 S3 를 "쿼리 대상"으로 쓰는 반면, S3Queue 는 S3 를 **인제스트 소스**로 씁니다 — 버킷에 새로 떨어진 파일을 감지해 MergeTree 로 밀어 넣는 경로입니다. 23.8 실험 도입, 23.11 릴리스 블로그에서 "significantly improved since its experimental release and is now production ready"로 공식 발표됐고, Keeper 의존(`keeper_path`)이 필수입니다 `✓`.

{{< callout type="important" >}}
**S3Queue 의 exactly-once 를 Cloud 의 S3 ClickPipes 와 혼동하면 안 됩니다.** 공식 문서는 S3Queue 가 exactly-once 를 보장하지 **않는다**고 명시하고 중복 시나리오를 열거합니다 — (1) 파싱 실패 후 재시도, (2) 멀티서버 환경에서 Keeper 세션 만료(25.8 부터 영구 처리 노드 사용으로 완화), (3) 서버 비정상 종료 `✓`. 또 `after_processing='delete'` 이면서 `fsync_after_insert=1` 이 아니면 전력 손실 시 행 유실이 가능하고, Ordered 모드는 파일명이 알파뉴메릭 오름차순이어야 하며 멀티서버에서 `loading_retries` 를 지원하지 않습니다(문서가 향후 수정 필요로 인정) `✓`.

반면 ClickHouse Cloud 의 S3 ClickPipes 는 "S3 ClickPipe guarantees exactly-once semantics, so no duplicates make it into your target table"라고 광고합니다 `Ⓥ`. **이건 Cloud 관리형 레이어의 보장이고 OSS S3Queue 의 보장이 아닙니다** — 두 문장을 같은 근거로 쓰면 설계가 틀어집니다 `Σ`.
{{< /callout >}}

## 성능 — MergeTree 와 Parquet-on-S3 의 실제 격차

숫자는 두 진영에서 나오고, 두 진영 모두 자기에게 유리한 조건을 깔았습니다. 그래서 등급을 나눠 읽어야 합니다.

| 측정 | 결과 | 등급 |
|---|---|---|
| ClickBench 43쿼리 **콜드 합산** | MergeTree **28초** vs Parquet **56초** (약 2배) | `Ⓑ`/`Ⓥ` |
| ClickBench 개별 Q41 | MergeTree 콜드 30ms / 핫 10ms vs Parquet 콜드 170ms / 핫 140ms (약 5배) | `Ⓑ`/`Ⓥ` |
| 25.8 신규 Parquet 리더 v3 | ClickBench 쿼리 **평균 1.81배** 개선, 예시 쿼리 1.513s→0.703s | `Ⓑ`/`Ⓥ` |
| Altinity 벤치마크(NYC Taxi 13억 행, c7g.8xlarge, 5쿼리) | Iceberg/Parquet 가 MergeTree 와 비슷하거나 **더 빠름**(Q1: MergeTree 1.5s vs Iceberg 0.7s) | `Ⓥ` |

**ClickBench 수치에는 저자들이 직접 단 면책이 붙어 있습니다** — 공정한 비교가 아니라는 것입니다. Parquet 은 범용 포맷이고 MergeTree 는 전용 튜닝된 엔진이라는 취지입니다 `✓`. 이 면책을 떼고 "2배 느리다"만 인용하면 부정확합니다. 리더 v3 개선(Arrow 중간 레이어 제거, row group 내 컬럼 병렬 처리, PREWHERE 지원)은 격차가 **좁혀지는 방향**이라는 신호로 읽는 게 맞습니다 `Σ`.

**Altinity 수치는 `Ⓥ`로 격하해야 합니다.** 이유는 셋입니다 `Σ` — (1) MergeTree 쪽을 튜닝하지 않은 기본 설정으로 두고 비교했습니다(ZSTD 압축·pread 등 수동 설정이 필요한데 그걸 하지 않았습니다), (2) Iceberg 쪽에는 4노드 swarm 을 동원했습니다, (3) 애초에 바닐라 OSS 가 아니라 **Antalya 라는 별도 배포판** 자료입니다. 비교 대상 버전도 특정이 어렵습니다 `?`. "Iceberg 가 MergeTree 를 이겼다"는 헤드라인을 우리 결정의 근거로 쓸 수 없다는 뜻이지, 측정이 거짓이라는 뜻은 아닙니다.

## 왜 Iceberg 가 MergeTree 를 대체하지 못하는가 — 같은 층이 아니다

성능 차이의 원인을 "Iceberg 가 덜 최적화돼서"로 요약하면 틀립니다. 둘은 **다른 층에서 다른 일**을 합니다.

| 축 | MergeTree | Iceberg (+ Parquet) |
|---|---|---|
| **빠른 이유** | 정렬키 + sparse index → 인메모리 인덱스가 값이 든 블록을 짚어낸다. 프라이머리 키 기반으로 훨씬 고운 해상도의 스킵 `✓` (granule 기본 크기는 이 조사 범위 밖 `?`) | 파일·row group·page 단위 min/max 통계와 Bloom filter → **스킵 해상도가 파일/row group 단위로 거칠다** `✓`. Iceberg 스펙에는 sparse primary index·inverted index 가 **네이티브로 없다** `✓` |
| **실시간 인제스트** | 작은 INSERT 를 자동 배치·정렬해 쓰고, 백그라운드 merge 가 계속 큰 파일로 합친다 — 사용자에게 투명 `✓` | 커밋마다 파일이 생겨 **small file 이 폭증**하고, compaction 을 외부에서 돌려야 한다(§2 의 유지보수 표) `✓` |
| **데이터 소유** | 엔진 배타 — 그 데이터는 ClickHouse 것이다 | **여러 엔진 공유** — 중립 스토리지 층이고, 이게 존재 이유다 `✓` |
| **잘 맞는 워크로드** | 고카디널리티 포인트 조회 + 실시간 인제스트 + 대시보드 저지연 `Σ` | 대규모 순차 스캔, 장기 아카이브, 스키마가 계속 변하는 데이터, 여러 팀·여러 엔진이 같은 데이터를 읽는 조직 `Σ` |

한 문장으로: **MergeTree 는 "빠른 엔진"이고 Iceberg 는 "중립 테이블"입니다.** 전자를 후자로 바꾸는 것은 업그레이드가 아니라 **교환**이며, 교환의 대가는 포인트 조회 지연과 compaction 운영이고 얻는 것은 엔진 자유와 저장 비용입니다 `Σ`.

## 관측성에는 맞는가 — 저자들이 열거한 다섯 가지 한계

ClickHouse 공식 블로그 "Are open-table-formats + lakehouses the future of observability?"(Melvyn Peignon, Dale McDiarmid, 2025-10-16)가 이 질문을 정면으로 다룹니다(저자·게재일 원문 확인 `✓`). 결론부터 정확히 옮기면, **저자들은 장기적으로 낙관하지만 현재의 관측성 메인 스토리지로는 다섯 가지 한계를 듭니다** `✓`. TL;DR 은 "becoming viable"이고 본문 후반은 "open table formats will ultimately become a central component of open, cost-efficient observability architectures"라고 씁니다 — 즉 "안 된다"가 아니라 "아직 아니다"입니다 `✓`.

| # | 한계 | 원문(발췌) | 등급 |
|---|---|---|---|
| 1 | **포인트 조회 지연** | "When investigating a specific trace or log event, analysts often query by unique identifiers such as trace_id or span_id. These lookups are high-selectivity with Parquet's structure simply not built for this access pattern." / "high latency point reads represent a limitation for using lakehouses for observability" | `✓` |
| 2 | **준정형 JSON 비효율** | "working with semi-structured data in Parquet often requires reading and decompressing entire pages of encoded data just to access a single field" | `✓` |
| 3 | **메타데이터 폭증** | "In high-ingest environments such as observability, these structures can grow to millions of entries, increasing query planning latency, memory use, and lowering insert performance." | `✓` |
| 4 | **커밋 컨텐션** | "at very high ingestion rates common in observability workloads, contention on the table's metadata pointer can become a bottleneck, leading to repeated retries and slower commit throughput" | `✓` |
| 5 | **요청 증폭** | "even a small query can trigger dozens of sequential HTTP range requests before any data is processed. This “request amplification” effect makes Parquet inherently “chatty” on object stores." | `✓` |

**편향을 먼저 밝힙니다.** 이 글은 MergeTree 를 만든 회사가 썼고, 같은 글에서 MergeTree 가 "combines many of the strengths of lakehouse and open table formats while also addressing and simplifying their challenges"라고 자사 엔진을 옹호합니다 `✓`. 열거된 한계가 자사에 유리한 방향으로 선택됐을 가능성을 배제할 수 없습니다.

**그럼에도 다섯 개 모두 메커니즘상 타당합니다** `Σ`. 1·2·5 는 Parquet 의 물리 레이아웃(page 단위 압축, footer 선행 읽기, definition/repetition level 순차 디코딩)에서 직접 따라 나오는 결과이고, 3·4 는 §2 에서 본 "카탈로그 포인터 원자 교체"라는 커밋 모델의 필연적 부산물입니다. 관측성 워크로드가 요구하는 것(`trace_id` 한 건 조회, 초당 수만 건 인제스트, 계속 새로 생기는 속성)이 정확히 이 다섯 지점을 때립니다.

그리고 저자들이 제시하는 **현실 대안이 이중 쓰기**라는 점이 결정적입니다. "In real-world observability deployments, some users have adopted a dual-write architecture. Observability data is written both to ClickHouse's MergeTree tables for hot, real-time analysis and to open table formats for long-term cold retention." `✓` 이 패턴을 Netflix 같은 조직이 쓰고 있지만, 저자들 스스로 비효율을 인정합니다 — "remains popular but introduces inefficiency - data must be written twice and managed separately" `✓`.

즉 **관측성 진영에서 검증된 Iceberg 활용형은 "메인 스토리지 교체"가 아니라 "핫은 MergeTree, 콜드는 오픈 테이블 포맷"의 병행**이고, 그 병행조차 데이터를 두 번 쓰는 대가를 냅니다 `Σ`.

### 격차를 좁히는 것들 — 재검토의 기술적 조건

같은 글이 다섯 한계를 메우려는 움직임도 정리해 둡니다. 이것들이 어디까지 왔는지가 곧 §8 의 재검토 시점을 정하므로, 항목별로 무엇을 해결하는지 붙여 읽습니다.

| 움직임 | 무슨 한계를 겨냥하나 | 상태 |
|---|---|---|
| **liquid clustering** (Databricks 발) | 전체 재작성 없이 백그라운드에서 점진 재클러스터링 → compaction·정렬 운영 부담 `✓` | 생태계로 확산 중, 우리 조사에 self-host 적용 근거 없음 `?` |
| **Parquet `VARIANT` 타입** | 준정형 JSON 비효율(§6-2). 한 컬럼에 객체·배열·스칼라를 담고, 필드명은 딕셔너리 인코딩하며, **shredding** 으로 중첩 필드를 별도 컬럼으로 물질화 — ClickHouse `JSON` 타입이 하는 일과 유사 `✓` | "still early in adoption" `✓` |
| **Lance·Vortex·FastLanes·BtrBlocks** | row group 이라는 고정 단위 자체를 폐기. Lance 는 컬럼별로 독립 flush 되는 fragment 로 저장해 대규모 스캔과 세밀한 랜덤 읽기를 동시에 노리고, 인코딩·통계를 플러그인으로 분리한다 `✓` | 전부 라이프사이클 초기 `✓` |
| **인덱스 층 보강** | Iceberg 에는 sparse primary index·inverted index 가 **스펙상 없다**. 일부 상용 구현이 외부 인덱스 층을 얹지만 **벤더 종속이고 오픈소스 표준이 아니다** `✓` | 오픈소스 프로젝트가 등장하는 단계 `✓` |
| **ClickHouse 의 수렴 비전** | 개방 포맷 테이블을 "그냥 또 하나의 ClickHouse 테이블"로 취급해 머티리얼라이즈드 뷰까지 쓰게 한다는 방향 `✓` | 비전 서술이며 구현 시점 미확인 `?` |

저자들 스스로 신규 포맷들에 대해 "none have yet been tested at the full scale or complexity of production observability pipelines"라고 못박습니다 `✓`. **다섯 한계가 사라지는 게 아니라 옮겨가는 중이고, 지금 결정을 내리는 사람에게는 아직 존재하는 한계입니다** `Σ`.

## 그래서 S3 메인의 답인가 — 세 갈래를 분리한다

"S3 를 메인으로"라는 한 문장 안에 서로 다른 세 가지가 뭉쳐 있습니다. 이걸 분리하는 것이 이 장이 독자에게 남기려는 결론입니다 `Σ`.

| 갈래 | 무엇인가 | self-host 가능성 | 우리 판단 |
|---|---|---|---|
| **① cold tier** | 로컬 NVMe hot + `TTL ... TO VOLUME 'cold'` 로 S3 이동 | 코어 내장, 검증된 표준 `✓` | **이미 고른 것.** 상세는 [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}}) |
| **② S3 primary** | storage policy 로 S3 단독 볼륨 구성 | 문법적으로 가능. 단 3중 제약 | 비권장 — 아래. OSS 경로(`plain_rewritable`)의 기각 판정은 [스토리지 · S3 primary 의 OSS 경로]({{< relref "02-storage-local-nvme.md" >}}) |
| **③ 데이터레이크** | Iceberg 테이블을 만들고 여러 엔진이 공유 | 기능은 있음(§3), 성숙도 편차 | **다른 축.** 지금은 도입 안 함 |

**② 는 문법적으로 가능하지만 이름부터 정정해야 합니다.** ClickHouse 공식 가이드가 산문에서 쓰는 "S3BackedMergeTree"는 **등록된 테이블 엔진 이름이 아닙니다**. 같은 가이드의 DDL 예제가 그 증거입니다 `✓`.

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

`ENGINE =` 뒤에 오는 것은 `MergeTree` 뿐이고, S3 는 `storage_policy` 로 붙습니다(디스크 정의는 `storage_configuration` 의 `<type>s3</type>` 디스크 + `<type>cache</type>` 캐시 디스크 조합) `✓`. 문서 자신이 "Note that we didn't have to specify the engine as `S3BackedMergeTree`. ClickHouse automatically converts the engine type internally if it detects the table is using S3 for storage"라고 설명합니다 — 문서 산문 속 설명어일 뿐 엔진 클래스가 아닙니다 `✓`. 따라서 자료에서 이 이름을 보면 엔진명이 아니라 설명어로 읽어야 하고, `system.tables` 의 engine 컬럼에 그 이름이 나온다는 서술은 근거가 없습니다 `Σ`.

같은 가이드가 명시하는 제약은 셋입니다 `✓` — (1) "Don't configure any AWS/GCS life cycle policy. This isn't supported and could lead to broken tables.", (2) "implementing and managing a separation of storage and compute architecture is more complicated compared to standard ClickHouse deployments", (3) 적합 사용 사례를 "use cases where query performance on 'cold' data is less critical"로 한정. 그리고 self-host 로 이 구성을 하는 독자에게 "we recommend using ClickHouse Cloud, which allows you to use ClickHouse in this architecture without configuration using the SharedMergeTree table engine"라고 권합니다 `✓` — self-host 를 금지하는 문장은 아니고 "설정 없이 하려면 Cloud"라는 뜻입니다.

여기에 우리 도메인이 이미 확정한 3중 제약이 겹칩니다 — **사본 배수**(shared-nothing 이라 RF2 면 S3 에도 2벌), **메타데이터 지역성**(part metadata 가 로컬에 남아 filesystem cache 가 사실상 필수), **지연**(콜드 쿼리가 느립니다). 상세는 반복하지 않고 [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}})와 [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}})에 위임합니다. 그리고 "S3 를 1벌만 두고 컴퓨트가 캐시로 읽는" OSS 경로(`plain_rewritable` + readonly part refresh)를 왜 기각하는지 — mutation·테이블 복제 미지원으로 RMT 와 배타라는 결정적 사유를 포함한 기각 사유 6개 — 는 [스토리지 · S3 primary 의 OSS 경로]({{< relref "02-storage-local-nvme.md" >}})가 소유합니다.

**③ 은 아예 다른 축입니다.** ①② 가 "S3 를 싸게 쓴다"는 비용 문제라면, ③ 은 "여러 엔진이 공유하는 개방 테이블을 만든다"는 **거버넌스·lock-in 문제**를 푸니다. 목적이 다르므로 ③ 을 ② 의 우회로로 쓰려는 발상 자체가 층위 혼동입니다 `Σ`. 그리고 관측성 메인 스토리지로서의 ③ 은 §6 대로 공식적으로도 비권장입니다.

### Altinity Antalya 는 어디에 놓나

"Iceberg 를 메인으로"가 실제로 통한다는 주장의 출처는 바닐라 OSS 가 아니라 대부분 **Altinity Antalya** 입니다. Antalya 는 ClickHouse 에 stateless compute swarm, 분산 캐싱, tiered storage-on-Iceberg 를 얹은 **별도 브랜치/배포판**이고, Altinity.Cloud(관리형/BYOC)와 self-managed 설치 양쪽에 쓰입니다 `≈`. "10배 저렴한 Iceberg 스토리지 위에서 무한 확장 쿼리"는 그 배포판의 아키텍처 산물이고 OSS 표준 기능이 아닙니다 `Ⓥ`.

실무적 함의는 단순합니다 `Σ` — **바닐라 OSS 로 가면 Antalya 의 swarm·캐싱 최적화 없이 §3 의 기본 Iceberg 읽기/쓰기 기능만 갖습니다.** 따라서 Antalya 벤치마크를 근거로 바닐라 OSS 의 성능을 기대하면 안 됩니다. Antalya 자체의 프로덕션 준비도 등급(벤더가 프로덕션 레디로 표기하는지 여부)은 이 조사에서 확인하지 못했습니다 `?` — 별도 배포판이라는 사실만 확정된 것이고, 채택 검토를 한다면 이 등급부터 벤더에게 확인해야 합니다.

{{% details title="후속 조사거리 (지금은 근거가 없어 결론을 내리지 않은 것들)" closed="true" %}}
- `DataLakeCatalog` 의 Glue/Unity/REST/HMS 커넥터가 **self-host OSS** 환경에서 실제로 얼마나 안정적인가 — 공식 자료가 Cloud 맥락에 치우쳐 self-host 실사용 보고가 없다 `?`.
- `allow_experimental_iceberg_compaction` 이 프로덕션에서 small file 폭증을 얼마나 억제하는가 — 수치 근거가 없다 `?`.
- `s3`/`deltaLake`/`hudi` 테이블 함수가 Parquet 파일 레벨 min/max 통계로 프레디케이트 푸시다운을 실제로 수행하는가 — 문서에 명시가 없어 실측이 필요하다 `?`.
- "핫=MergeTree, 콜드=Iceberg" 이중 쓰기를 운용하는 프로덕션 사례(Netflix 외)의 구체적 SLA·비용 수치 `?`.
- 26.2(PR #97483)에서 추가된 `allow_experimental_insert_into_iceberg` 별칭의 새 이름이 `allow_insert_into_iceberg` 인지 — CHANGELOG 가 이름을 적지 않아 축어 확인이 필요하다 `?`.
{{% /details %}}

## 우리 케이스에서는

우리 스택은 EKS self-host + ReplicatedMergeTree 이고 콜드는 S3 tier 입니다. hot 매체는 전제에 따라 갈립니다 — 이 챕터의 전제(인력·20TB+·스토리지 성능 세 조건)에서는 로컬 NVMe([스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}})), 실제 현 시점 RUM 규모(월 유입 약 0.7TB)에서는 EBS-first 가 결론입니다([HyperDX 내재화]({{< relref "../hyperdx/_index.md" >}})). 이 장의 판단은 두 경우 모두 같습니다 — **Iceberg 를 지금 도입하지 않습니다** `Σ`. 근거는 성숙도가 아니라 **워크로드 불일치와 규모**입니다.

- **워크로드가 §6 의 다섯 한계를 정면으로 때린다.** RUM/트레이스 조사는 `trace_id`·`session_id` 포인트 조회가 주 동작이고, 속성은 계속 새로 생기는 준정형 JSON 이고, 인제스트는 상시다 — Parquet 이 가장 약한 세 지점과 정확히 겹친다.
- **월 0.7TB 규모에서 얻을 것이 없다.** Iceberg 가 주는 것은 저장 단가와 엔진 자유인데, 우리는 이미 S3 cold tier 로 단가를 잡았고 엔진을 바꿀 계획이 없다. 반대로 지불할 것은 확실하다 — 외부 compaction 운영, 매니페스트 관리, experimental 플래그 추적, 그리고 이중 쓰기 파이프라인이다 `Σ`.
- **HyperDX 가 스키마를 소유한다는 제약도 있다.** ClickStack OTel collector 가 `otel_logs`·`otel_traces`·`hyperdx_sessions` 등을 MergeTree 로 생성하고 HyperDX 는 그 테이블을 전제로 쿼리한다 — 관측성 메인을 Iceberg 테이블로 바꾸면 UI 쪽 계약을 우리가 직접 떠안는다 `✓`([HyperDX 내재화]({{< relref "../hyperdx/_index.md" >}})). 제품 선택의 맥락은 [로깅 · HyperDX/ClickStack]({{< relref "../logging/05-hyperdx-clickstack.md" >}})에 있다.
- **S3 primary(② 갈래)도 여전히 아니다.** 이 장이 확인한 것은 "문법적으로 가능하다"와 "이름이 엔진명이 아니다"까지이고, 사본 배수·메타데이터 지역성·지연 3중 제약은 그대로다. OSS 경로의 기각 근거는 [스토리지 · S3 primary 의 OSS 경로]({{< relref "02-storage-local-nvme.md" >}}) 에 있다.

**언제 재검토할 가치가 생기는가** — 조건을 미리 못박아 둡니다 `Σ`. (1) 보존이 1년+ 로 늘어 콜드 데이터가 hot 대비 수 배로 커지고, (2) 그 콜드 데이터를 관측성 UI 가 아니라 **배치 분석·ML 이 다른 엔진(Spark/Trino/DuckDB 등)으로** 읽어야 하는 요구가 실제로 생기고, (3) 그 요구를 ClickHouse 에서 뽑아 쓰는 것(SELECT → 외부 전달)보다 개방 포맷으로 두는 것이 명백히 싸질 때. 세 조건이 함께 서야 하고, 하나만 서면 재검토 트리거가 아닙니다.

그때의 형태도 미리 정해둡니다. **"관측성 메인을 Iceberg 로 이전"이 아니라 "MergeTree 에서 TTL 로 만료되는 데이터를 Iceberg 로 내보내는 아카이브 경로"** 입니다 `Σ`. 이 형태는 §6 의 이중 쓰기와 달리 같은 데이터를 두 번 쓰지 않고, 관측성 조회 경로(HyperDX → MergeTree)를 건드리지 않으며, 실패해도 되돌릴 수 있습니다. 검토를 시작할 때의 첫 두 작업은 (a) self-host 에서 `DataLakeCatalog` + Glue 연동 스테이징 실측, (b) 그 시점의 Iceberg 쓰기 설정 등급(Beta/Experimental) 재확인입니다 — 이 장의 `?` 항목들이 그때까지 `✓`로 승격돼 있을지가 판단을 가릅니다. 시점 기준 2026-08.
