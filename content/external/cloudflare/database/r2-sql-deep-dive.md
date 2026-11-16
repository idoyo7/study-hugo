---
title: "객체의 바다에서 읽을 범위를 좁히고 일찍 멈추는 R2 SQL"
description: "페타바이트 규모의 Iceberg 테이블을 별도 클러스터 운영 없이 어떻게 조회할까요? R2 SQL은 메타데이터로 읽을 범위를 줄이고, 계획 중에도 작업을 분산 실행하며 상위 결과가 확정되면 남은 탐색을 멈춥니다."
date: 2026-11-16
weight: 7
---

# 객체의 바다에서 읽을 범위를 좁히고 일찍 멈추는 R2 SQL (2025-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [R2 SQL: a deep dive into our new distributed query engine](https://blog.cloudflare.com/r2-sql-deep-dive)
- 매체 · 게시일: The Cloudflare Blog · 2025-09-25
- 저자: Yevgen Safronov, Nikita Lapkov, Jérôme Schneider
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 객체의 바다에 남은 조회 문제 {#serverless-query-engine}

R2의 논리 테이블 하나는 크고 작은 파일 수백만 개로 이뤄질 수 있습니다. 새 파일도 매초 들어옵니다. Cloudflare가 ‘객체의 바다’라고 부르는 이 저장소에서는 쿼리에 필요한 데이터만 찾아 읽는 일부터 해결해야 합니다.

R2 버킷에 내장된 관리형 Apache Iceberg 카탈로그인 R2 Data Catalog는 여기에 논리적인 질서를 제공합니다. Iceberg는 데이터 파일을 다시 쓰는 대신 가벼운 메타데이터 파일을 조작하며, 테이블 상태를 불변 스냅샷의 연속으로 관리합니다. 트랜잭션과 스키마 진화도 지원하지만 SQL을 실행할 엔진까지 제공하지는 않습니다.

그동안 조회에는 Apache Spark나 Trino 같은 별도 서비스가 필요했습니다. 클러스터를 마련하고 자원 사용량과 가용성을 관리하는 일이 사용자의 부담이었습니다. R2 SQL은 데이터가 있는 곳에서 Iceberg 테이블을 조회하는 서버리스 엔진으로 이 운영 단계를 없앱니다.

조회 엔진이 풀어야 할 문제는 남아 있습니다. 필요한 데이터만 읽어도 그 양이 여전히 클 수 있으므로, 몇 초 동안 필요한 계산 자원을 확보했다가 곧바로 0까지 줄일 방법도 필요합니다. R2 SQL은 Query Planner가 읽을 범위를 줄이고 Query Execution이 남은 작업을 Cloudflare 네트워크에 나눠 처리하도록 설계됐습니다.

## 상위 5개가 확정되는 순간 {#early-query-termination}

`ORDER BY timestamp DESC LIMIT 5`가 붙은 쿼리는 후보 데이터를 전부 읽기 전에 끝날 수 있습니다. 5개를 찾기만 하면 되는 것은 아닙니다. 남은 파일에서 현재 상위 5개를 바꿀 결과가 나올 가능성까지 배제해야 합니다.

Query Planner는 메타데이터 통계를 바탕으로 `ORDER BY`에 맞춰 작업 순서를 정하고, 최종 결과에 들어갈 가능성이 높은 데이터를 먼저 실행 엔진에 보냅니다. 결과가 돌아올 때마다 지금까지의 최상위 5개를 크기가 제한된 heap에 유지합니다. 함께 추적하는 값은 아직 처리하지 않은 파일 전체에 있을 수 있는 가장 최신 timestamp, 즉 high-water mark입니다.

Heap에서 가장 오래된 timestamp조차 이 상한보다 최신이면 남은 어떤 작업에서도 상위 5개에 들어갈 결과가 나올 수 없습니다. 이제 파이프라인을 멈춰도 됩니다. 실행을 중단하고 완전하고 올바른 결과를 반환하며, 이 방식으로 후보 데이터의 일부만 읽고 끝나는 경우가 많습니다.

게시 시점에는 테이블의 파티션 키에 포함된 열만 정렬할 수 있었습니다. 이 제한을 없애는 작업은 진행 중이었습니다.

## 읽을 파일을 좁혀 주는 Iceberg 지도 {#metadata-pruning}

파일을 읽지 않고도 이런 판단을 내릴 수 있는 근거는 Iceberg의 통계입니다. 파일 내용을 거칠게 그린 지도에 해당합니다. Query Planner는 이 지도를 위에서 아래로 따라가며 쿼리와 관계없는 범위를 제외합니다.

출발점은 카탈로그가 알려 주는 현재 테이블 메타데이터의 위치입니다. 그곳의 JSON에는 스키마, 파티션 명세, 스냅샷 이력이 담겨 있습니다. Planner는 최신 스냅샷을 선택하고, 스냅샷이 가리키는 manifest list를 읽습니다. 여기에는 각 manifest가 다루는 파티션 값의 범위가 들어 있습니다. 예를 들어 `day(event_timestamp)`로 파티션을 나눈 테이블이라면 가장 이른 날짜와 가장 늦은 날짜를 확인해, 조회 날짜와 겹치지 않는 manifest를 제외합니다.

남은 manifest를 열면 개별 Parquet 파일의 열별 통계를 얻습니다. `http_status = 500`을 찾는데 어떤 파일의 해당 열은 최솟값이 200, 최댓값이 404라면 그 파일은 통째로 건너뜁니다. Null 개수도 판단에 쓰입니다. `WHERE error_code IS NOT NULL` 조건에서 `error_code`가 전부 null인 파일을 읽을 이유는 없습니다.

여기까지 남은 파일에서는 Parquet footer의 통계로 행 묶음인 row group을 더 걸러 냅니다. 최종 작업 단위는 이렇게 좁힌 파일 안의 row group입니다. 수 GB짜리 Parquet 파일도 필요한 일부만 읽도록 나눌 수 있습니다.

이 통계 계층은 앞서 본 처리 순서에도 쓰입니다. Manifest 사이의 순서는 파티션 통계로 정하고, 각 manifest 안에서는 더 세밀한 열별 통계로 Parquet 파일의 순서를 정합니다. 읽을 대상을 줄이는 정보가 먼저 읽을 대상을 고르는 데도 쓰이는 것입니다.

## 계획 도중에 작업을 받는 query worker {#streaming-planning-pipeline}

수백만 파일의 메타데이터를 모두 검사한 뒤 실행한다면, 읽을 양을 줄이고도 시작이 늦어집니다. 계획 자체가 오래 걸릴 수 있기 때문입니다. R2 SQL은 스냅샷과 manifest list를 가져온 다음부터 계획과 실행을 함께 진행합니다. Planner가 manifest와 파일을 살피다가 조건에 맞는 파일이나 row group을 찾으면 곧바로 실행 큐에 보냅니다. 전체 탐색이 끝나기 훨씬 전부터 계산 노드가 데이터 I/O를 시작하는 방식입니다.

사용자 요청을 받아 계획을 세우는 서버가 query coordinator입니다. 실행 요청을 받는 서버는 query worker 역할을 맡습니다. Coordinator는 row group 묶음을 여러 worker에 배분하고 돌아온 결과를 모읍니다. Worker는 수평 확장의 단위이므로, 특히 파일 수가 많은 쿼리에서 여러 서버에 일을 나눠 실행 시간을 줄일 수 있습니다.

Coordinator와 worker는 모두 Cloudflare의 분산 네트워크에서 동작합니다. 그중에는 유지보수 중인 서버도 있으므로 coordinator는 내부 API로 정상 동작하는 서버를 고릅니다. 서버 사이의 빠르고 안정적인 연결에는 Cloudflare Argo Smart Routing을 사용합니다.

Worker가 받는 것은 row group 묶음과 SQL만이 아닙니다. Coordinator는 해당 row group이 속한 Parquet 파일의 메타데이터도 직렬화해 보냅니다. 정확한 바이트 오프셋이 포함돼 있어, worker는 row group의 위치를 알아내려고 R2에서 같은 정보를 다시 읽지 않아도 됩니다.

## 행을 묶고 열을 골라 읽는 DataFusion {#datafusion-execution}

Worker 안에서 SQL을 실행하는 엔진은 Rust로 작성된 Apache DataFusion입니다. DataFusion은 쿼리를 독립적인 partition 스트림으로 나누며, R2 SQL에서는 row group 하나를 독립 partition으로 처리합니다. 여기서 partition은 메모리에서 쿼리를 처리하기 위한 구분입니다. 객체 스토리지의 물리적 데이터 배치에 쓰이는 Iceberg partition과 항상 일치하지는 않습니다.

Row group은 보통 최소 1,000행을 담습니다. 각 partition 안에서는 여러 행을 묶어 처리합니다. 이 벡터화 실행으로 쿼리 계획을 거치는 횟수를 줄여 해석 비용을 분산하고, CPU 캐시 지역성도 높입니다. Partition끼리는 병렬로 실행해 여러 CPU에 작업을 나눕니다. 큰 묶음을 순차 처리할 때의 효율과 여러 코어를 사용하는 병렬 처리의 이점을 함께 얻는 방식입니다.

읽을 열도 골라냅니다. Parquet는 열을 물리적으로 분리해 저장하므로, 가령 쿼리에 필요한 열이 5개라면 나머지 50개는 건너뛸 수 있습니다. DataFusion은 R2의 범위 읽기로 필요한 열의 데이터만 가져와 읽기량과 압축 해제에 드는 CPU 시간을 줄입니다. 필터는 쿼리 계획의 낮은 단계로 내려 Parquet 값을 읽는 시점에 적용합니다. 반환하지 않을 결과를 메모리에 구체화하는 작업까지 줄일 수 있습니다.

Worker의 내부 데이터와 쿼리 결과는 Apache Arrow 배열로 표현합니다. 결과를 coordinator에 보낼 때는 프로세스 간 통신을 위한 Arrow IPC 형식으로 직렬화해 gRPC 응답에 담습니다. Coordinator는 이를 역직렬화한 뒤 다시 Arrow 배열로 처리합니다.

## open beta로 공개한 R2 SQL의 다음 과제 {#performance-and-future-work}

Cloudflare는 R2 SQL을 거대한 데이터셋에서 수초 안에 결과를 돌려주는 엔진으로 소개했습니다. 특정 데이터셋의 처리 시간이나 처리량, 비용을 비교한 벤치마크 수치는 제시하지 않았습니다.

게시 시점의 R2 SQL은 open beta였으며 필터 쿼리 실행에 강점을 두고 있었습니다. 분산 환경에서 확장 가능한 복잡한 집계, 쿼리 실행 과정을 살펴 성능을 개선할 도구, Apache Iceberg의 여러 설정 옵션 지원은 향후 추가할 기능으로 계획했습니다. Cloudflare Dashboard에서 R2 Data Catalog를 조회하는 기능도 계획에 포함됐습니다.

쿼리 속도를 더 높일 여러 종류의 인덱스는 검토 중이었습니다. 전문 검색과 지리 공간 쿼리 같은 기능도 이 탐색의 대상이며, 이미 제공하는 기능으로 소개한 것은 아닙니다.

{{% details title="원문의 조건부 수치와 실행 예시" closed="true" %}}
| 항목 | 값 |
|---|---|
| 파티션 통계 예시 | `day(event_timestamp)` 파티션에서 manifest가 다루는 가장 이른 날짜와 가장 늦은 날짜 사용 |
| 파일 제외 예시 | `http_status = 500` 조회에서 열의 최솟값이 200, 최댓값이 404인 파일 전체 제외 |
| 조기 종료 예시 | `ORDER BY timestamp DESC LIMIT 5`에서 최상위 5개 결과를 heap에 유지 |
| 조기 종료의 판단 조건 | Heap의 가장 오래된 timestamp가 미처리 파일 전체의 최신 timestamp 상한보다 최신인 경우 |
| row group의 일반적 크기 설명 | 보통 최소 1,000행을 포함하며, 여러 행을 묶는 벡터화 실행에 활용 |
| 선택적 열 읽기 예시 | 쿼리에 필요한 5개 열만 읽고 나머지 50개 열은 건너뛰는 경우 |
{{% /details %}}
