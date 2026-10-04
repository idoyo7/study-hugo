---
title: "ClickHouse vs StarRocks"
date: 2026-07-12
lastmod: 2026-08-24
weight: 7
url: "/logging/07-clickhouse-vs-starrocks/"
---

# 로그 저장소로 비교하는 ClickHouse와 StarRocks

로그가 계속 추가되는 큰 테이블을 검색·집계하려는지, 다른 업무 테이블과 JOIN하고 자주 수정하려는지에 따라 선택이 달라집니다. 이 비교는 2026-07~08 조사 당시의 기능과 로그·관측성 워크로드를 기준으로 합니다.

## 저장 방식과 질의의 차이

| 비교 항목 | ClickHouse | StarRocks |
|---|---|---|
| 직접 운영하는 저장소·컴퓨트 분리 | 이 시리즈의 ReplicatedMergeTree 구성은 replica별 저장. SharedMergeTree는 Cloud 전용 | OSS shared-data 모드에서 S3와 stateless CN 사용 |
| 단일 테이블 스캔·압축 | MergeTree 기반 대량 스캔·집계에 적합. ClickBench hot 비교에서 약 20~33% 우세한 결과 `Ⓑ` | 실제 schema와 쿼리로 비교 필요 |
| JOIN·변경 데이터 | 선택한 엔진과 데이터 모델에 따라 설계 | Primary-Key upsert와 JOIN, Iceberg 연계가 주요 검토 이유 |
| 풀텍스트·JSON | 조사에 반영한 text index는 2026-03 GA | 비교 대상 shared-data 모드의 풀텍스트는 Beta |
| Kubernetes 확장 | shard 추가 시 기존 데이터 재분배 계획 필요 | CN을 확장하는 shared-data 구성 가능 |
| 관측성 UI | ClickStack·HyperDX 연결 가능 | 별도 조회 UI 구성 필요 |

벤치마크 차이만으로 선택하지는 않습니다. 특정 조건의 hot 쿼리 결과가 cold 조회, 동시성, 비용까지 대표하지 않기 때문입니다. 기능이 GA인지 Beta인지도 실제 사용할 버전과 배포 모드에서 확인해야 합니다.

## 이 로그 워크로드에서는 ClickHouse를 우선 검토한다

append-only 로그에서 시간 범위를 좁혀 특정 이벤트를 찾거나 대량 집계를 수행하는 패턴은 ClickHouse를 검토하기에 적합합니다. 기존 조사에서는 풀텍스트 지원 상태와 관측성 UI 생태계도 선택 이유였습니다. StarRocks의 JOIN·upsert가 중요한 업무라면 별도 쿼리 집합으로 비교해야 하지만, 여기서 다루는 로그의 주된 요구는 아니었습니다.

자체 인프라의 S3 위에서 컴퓨트만 탄력적으로 늘리는 것이 필수라면 StarRocks를 후보에 남겨야 합니다. 반대로 그 요구가 없다면 로그 검색과 운영 도구를 중심으로 ClickHouse를 평가할 수 있습니다.

조사 당시 두 엔진의 비교에서 Elasticsearch식 BM25·relevance 랭킹을 대체할 근거는 확보하지 못했습니다. 관련도 순 검색이 필수라면 전용 검색층을 함께 검토합니다. 두 엔진을 함께 쓰는 경우에는 ClickHouse에 관측성 이벤트를, StarRocks에 Iceberg 기반 BI·변경 데이터를 두는 분담도 가능하지만, 공유 S3만으로 두 엔진의 데이터 관리가 자동 통합되지는 않습니다.

각 엔진의 운영 부담은 [ClickHouse]({{< relref "/observability/logs/comparison/04-clickhouse.md" >}})와 [StarRocks]({{< relref "/observability/logs/comparison/06-starrocks.md" >}}) 평가에서 이어집니다.
