---
title: "정산 DB 이관 앞의 Aurora MySQL과 Aurora PostgreSQL"
description: "쿼리를 고쳐도 느린 정산 DB를 Aurora PostgreSQL로 옮기면 나아질까요? Aurora MySQL과 비교한 테스트에서는 조인과 대용량 DDL이 빨랐지만, 단순 CRUD는 MySQL이 앞섰습니다."
date: 2026-11-14
weight: 4
---

# 정산 DB 이관 앞의 Aurora MySQL과 Aurora PostgreSQL (2021-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Aurora MySQL vs Aurora PostgreSQL](https://techblog.woowahan.com/6550/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2021-12-07
- 저자: 정지원 (클라우드스토리지개발팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 쿼리를 고쳐도 느린 정산 배치 {#background}

쿼리를 손보는 것만으로는 부족했습니다. 우아한형제들 클라우드스토리지개발팀이 관리하던 정산 서비스는 MySQL에서 동작하고 있었는데, 데이터가 쌓이며 느려진 배치를 개선해 봐도 극적인 효과는 없었습니다. 팀은 MySQL의 멀티쓰레드 방식과 제한된 조인 방식이 복잡한 쿼리와 대량 데이터 처리에 불리하게 작용한다고 보았습니다.

고민은 조회에 그치지 않았습니다. 테이블이 커질수록 인덱스를 만들거나 컬럼을 추가하는 작업에도 시간이 오래 걸렸습니다. 정산 쿼리의 속도와 대용량 테이블의 관리 부담을 함께 줄일 후보로 Aurora PostgreSQL을 검토한 배경입니다.

## 1000만 건 조인에서 벌어진 간격 {#benchmarks}

조인에서는 차이가 컸습니다. Aurora MySQL 5.7과 Aurora PostgreSQL 11에서 1000만 건 테이블을 자기 자신과 조인하자, HASH JOIN 기준으로 각각 약 22초와 약 3초가 걸렸습니다. PostgreSQL이 7배 이상 빨랐습니다. MySQL에서 준비한 데이터를 DMS로 옮겨 비교했으며, PostgreSQL의 실행계획에는 Parallel Hash Join이 잡혔습니다.

팀이 성능 개선을 기대한 기능도 조인과 parallel query, 즉 병렬 쿼리였습니다. Aurora MySQL 5.7에도 이 기능들이 일부 또는 다른 방식으로 지원됐지만, 지원 불가 조건에 걸려 활용하기 어려웠습니다. PostgreSQL은 다양한 조인 방식과 대부분의 SELECT 쿼리에 적용할 수 있는 병렬 처리를 제공한다는 점에서 정산 쿼리를 개선할 여지가 있었습니다.

조인 방식에 따른 차이는 더 컸습니다. Aurora MySQL에서 일반적으로 사용하는 Nested Loop Join으로 실행했을 때는 r5.2xlarge에서도 2시간 이상 걸렸습니다.

## 5000만 건 중 일부만 담은 Partial Index {#partial-index}

조회 속도가 비슷해도 인덱스를 작게 유지할 방법은 있었습니다. PostgreSQL의 Partial Index는 조건에 맞는 데이터에만 인덱스를 만드는 기능입니다. 팀은 5000만 건 쿠폰 테이블에서 `use_yn = 1`인 행만 골라 `reg_date`에 인덱스를 만들었습니다. 대상은 1,500,265건으로, 원문에서 전체의 약 3.1%로 소개한 데이터입니다.

MySQL의 일반 B-tree 인덱스와 비교했을 때 조회 속도에는 눈에 띄는 차이가 없었습니다. 차이는 크기에서 드러났습니다. 원문 설명에는 MySQL 755M, PostgreSQL 57M으로 약 10배 차이가 난다고 적혀 있지만, 쿼리 출력은 각각 764MB와 41MB여서 수치가 일치하지 않습니다. 두 기록 모두 필요한 데이터만 담은 인덱스가 훨씬 작다는 결과는 같습니다. 팀은 저장공간을 줄이는 데 더해, 데이터 삭제·추가·갱신에 따른 인덱스 유지 비용도 절약할 수 있다고 보았습니다.

## 컬럼 추가가 바로 끝난 대용량 테이블 {#large-table-ddl}

대용량 DDL은 작업 시간을 예측하기부터 어려웠습니다. 백업 데이터로 미리 시험해도 라이브 환경에서는 더 오래 걸리는 경우가 많았고, 실패하면 rollback에 따른 위험도 컸습니다. Aurora MySQL 5.7에서 Online DDL의 지원 범위가 넓어졌어도, DBA에게 인덱스 생성과 컬럼 추가는 여전히 부담스러운 작업이었습니다.

같은 환경에서 PostgreSQL을 시험한 결과는 달랐습니다. 약 200G 규모의 테이블에 인덱스를 만드는 데 44분 28초가 걸렸습니다. 크기 확인 출력상으로는 약 220G였으며, 사용한 명령은 `CREATE INDEX CONCURRENTLY`입니다. 팀이 운영하던 Aurora MySQL에서는 100G만 넘어도 인덱스 생성에 1시간 이상 걸렸던 것과 비교되는 결과였습니다.

컬럼 추가는 바로 끝났습니다. PostgreSQL의 Online DDL 컬럼 추가는 메타데이터를 저장하는 시스템 카탈로그에 추가된 정보만 반영하므로 빠르게 처리할 수 있었습니다.

## 새 행과 dead tuple을 남기는 PostgreSQL {#other-features}

모든 테스트에서 PostgreSQL이 앞선 것은 아닙니다. sysbench 1.0.15 tpcc로 스레드 수를 단계적으로 늘린 단순 CRUD 테스트에서는 예상대로 MySQL의 성능이 좋았습니다. 팀은 PostgreSQL의 UPDATE 처리 방식이 이 차이를 만든 큰 요인으로 보았습니다.

MySQL은 최신 값을 기존 레코드에 반영하고 변경 전 값은 별도의 undo 영역에 보관하는 Undo Segment 방식을 씁니다. PostgreSQL의 MGA(Multi Generation Architecture) 방식은 새 행을 추가하고 이전 행에는 삭제 표시를 남깁니다. 행의 위치가 바뀌면 인덱스 정보도 갱신해야 합니다. 팀이 PostgreSQL을 INSERT와 SELECT 위주의 서비스에 선호되는 DB로 설명한 이유입니다.

이 방식은 운영 작업으로도 이어집니다. UPDATE와 DELETE 뒤에 남은 dead tuple이 쌓이면 공간 부족과 IO 비효율로 성능이 떨어질 수 있습니다. 주기적으로 Vacuum을 수행해 그 공간을 다시 사용할 수 있도록 관리해야 합니다.

통계 쿼리에 활용할 다른 기능도 있습니다. Materialized View는 쿼리 결과를 별도 공간에 저장하므로, 실시간 노출이 덜 필요하거나 갱신이 드문 테이블에서 성능 이점을 얻을 수 있습니다. 여러 언어로 stored procedure를 작성하는 기능, PostGIS, 테이블 상속과 사용자 정의 DB 객체도 지원합니다. pg_trgm은 trigram 매칭으로 데이터의 유사성을 파악하고 3자 이상의 `like %pattern%` 인덱스 검색을 지원하는 모듈입니다.

팀은 복잡한 정산 쿼리와 대용량 테이블 관리에서 확인한 이점을 바탕으로 Aurora PostgreSQL 이관을 시도하기로 했습니다. 아직 테스트 단계의 결정입니다. 실서비스에는 예상하지 못한 변수가 있을 수 있으며, 성공 여부와 별개로 의미 있는 시도가 되리라 기대했습니다. 이관을 성공적으로 마무리하면 후속 글로 경험을 공유하겠다는 계획도 남겼습니다.

{{% details title="테스트 환경과 측정값" closed="true" %}}

| 항목 | 값 |
|---|---|
| 엔진 버전 | Aurora MySQL 5.7.mysql_aurora.2.09.2, Aurora PostgreSQL 11.9 |
| 인스턴스 | r5.xlarge ~ r5.2xlarge |
| sysbench | 1.0.15 tpcc, 스레드 2·4·8·16·24·32·64, 10 tables·100 scale (약 90GB) |
| 1000만 건 self join (HASH JOIN) | MySQL 약 22초 / PostgreSQL 약 3초 |
| MySQL Nested Loop Join | r5.2xlarge에서 2시간 이상 |
| Partial Index 테스트 데이터 | 5000만 건, 사용 여부 1이 약 3.1% (1,500,265건) |
| 쿠폰 잔여 조회 | MySQL 0.06초 / 0.29초, PostgreSQL 0.06초 / 0.2초 (두 조건 순) |
| 인덱스 크기 | 원문 서술 MySQL 755M · PostgreSQL 57M (약 10배), 쿼리 출력상 764MB · 41MB |
| 대용량 인덱스 생성 | PostgreSQL 약 220G 테이블, 44분 28초 (CREATE INDEX CONCURRENTLY) |
| MySQL 인덱스 생성 | 100G 초과 시 1시간 이상 |
| 컬럼 추가 | PostgreSQL 즉시 |
| 기본 격리 수준 | MySQL REPEATABLE READ / PostgreSQL READ COMMITTED |

{{% /details %}}
