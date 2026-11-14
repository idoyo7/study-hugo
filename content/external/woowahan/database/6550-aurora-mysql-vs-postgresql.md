---
title: "Aurora MySQL과 Aurora PostgreSQL 비교와 정산 DB 이관 검토"
description: "대량 통계성 정산 DB를 Aurora PostgreSQL로 옮길지 검토하며 두 엔진을 비교한 결과를 정리했습니다. 단순 CRUD, 조인, Partial Index, 대용량 DDL 테스트를 요약합니다."
date: 2026-11-14
weight: 4
---

# Aurora MySQL과 Aurora PostgreSQL 비교와 정산 DB 이관 검토 (2021-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Aurora MySQL vs Aurora PostgreSQL](https://techblog.woowahan.com/6550/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2021-12-07
- 저자: 정지원 (클라우드스토리지개발팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 이관을 검토한 배경 {#background}

클라우드스토리지개발팀은 Aurora MySQL로 운영 중인 대량 통계성 DB를 Aurora PostgreSQL로 옮기는 일을 검토하고 있었습니다. 원문은 그 준비 과정에서 정리한 내용입니다.

데이터가 쌓일수록 통계와 정산 같은 대량 배치는 느려집니다. 팀이 관리하는 정산 서비스도 그랬고, MySQL 환경에서 쿼리를 개선해 봤지만 극적인 효과는 없었습니다. 원문은 MySQL이 멀티쓰레드 환경과 제한된 join 방식 때문에 복잡한 쿼리나 대량 처리에 불리하고, 데이터가 커질수록 테이블 구조 변경이나 인덱스 생성에도 시간이 많이 든다고 봅니다. 대량 데이터 처리에 특화되었다고 알려진 PostgreSQL로의 이관을 고민한 이유입니다.

## 기능 비교 {#features}

비교 대상은 Aurora MySQL 5.7과 Aurora PostgreSQL 11입니다. MySQL은 RDBMS에 멀티쓰레드 방식으로 OLTP에 적합하고, PostgreSQL은 ORDBMS에 멀티프로세스 방식으로 OLTP와 OLAP에 두루 쓰입니다. PostgreSQL은 확장 타입을 정의할 수 있고 테이블 상속도 지원합니다.

MVCC도 다릅니다. MySQL은 최신 값을 기존 블록에 반영하고 변경 전 값을 undo 영역에 두는 Undo Segment 방식입니다. PostgreSQL은 MGA(Multi Generation Architecture) 방식이라 UPDATE가 새 튜플을 추가하고 이전 튜플에 유효 범위를 표시하는 식으로 처리됩니다. 모든 인덱스가 행의 위치를 가리키므로 UPDATE 때 인덱스 정보도 갱신해야 하고, 그래서 UPDATE는 MySQL보다 느립니다. 기본 트랜잭션 격리 수준은 MySQL이 REPEATABLE READ, PostgreSQL이 READ COMMITTED이며, 테이블 기본 인덱스는 MySQL이 clustered, PostgreSQL이 non-clustered입니다.

성능 개선의 열쇠로 본 것은 join과 parallel query입니다. MySQL 8.0에서 정식 지원하는 hash join과 parallel query가 Aurora MySQL 5.7에도 일부 또는 조금 다른 방식으로 있지만 지원 불가 조건이 있어 쓰기 쉽지 않았습니다. 반면 PostgreSQL은 오래전부터 대부분의 select에서 parallel을 지원하고 join 방식도 다양해, 개선이 필요한 정산 쿼리에서 이점을 기대할 만하다고 판단했습니다.

## 성능 비교 결과 {#benchmarks}

단순 CRUD는 예상대로 MySQL이 좋았습니다. 원문은 PostgreSQL의 UPDATE 방식, 곧 이전 값에 삭제 표시를 하고 새 행을 추가하는 구조가 큰 요인으로 보인다고 하며, 그래서 PostgreSQL은 INSERT와 SELECT 위주의 서비스에 선호된다고 설명합니다. 테스트는 sysbench 1.0.15 tpcc로 스레드 수를 단계적으로 늘리며 진행했습니다.

복잡한 쿼리에서는 차이가 컸습니다. 1000만 건 테이블의 self join을 HASH JOIN으로 비교하자 Aurora MySQL은 22초, Aurora PostgreSQL은 3초가 걸려 7배 이상 빨랐습니다. PostgreSQL 실행계획은 Parallel Hash Join이었습니다. MySQL이 일반적인 Nested Loop Join을 택하면 훨씬 느려져, r5.2xlarge에서는 2시간 이상 걸렸다고 합니다.

PostgreSQL에는 데이터의 부분집합에만 인덱스를 만드는 Partial Index가 있어, 5000만 건 쿠폰 테이블에서 사용 여부가 1인 약 3.1%에만 인덱스를 만들어 MySQL의 일반 B-tree 인덱스와 비교했습니다. 조회 속도는 눈에 띄는 차이가 없었습니다. 인덱스 크기는 차이가 컸고, 원문은 약 10배 차이로 서술하며 필요한 부분만 인덱싱하므로 저장공간뿐 아니라 삭제·추가·갱신에 따른 인덱스 유지 비용도 줄 수 있다고 봅니다.

대용량 테이블의 DDL도 비교했습니다. MySQL 5.7은 Online DDL 범위가 넓어졌지만 대량 테이블의 인덱스 생성과 컬럼 추가는 DBA에게 여전히 부담입니다. 시간을 예측하기 어렵고, 백업 데이터로 테스트해도 라이브에서는 더 오래 걸리는 경우가 많고, 실패하면 rollback 위험이 크기 때문입니다. 같은 환경의 PostgreSQL에서 약 200G 규모 테이블(확인 출력상 약 220G)에 인덱스를 만들자 44분 남짓 걸렸습니다. 원문은 MySQL이 100G만 넘어도 인덱스 생성에 1시간이 넘는다고 대비합니다. 컬럼 추가는 시스템 카탈로그의 메타데이터만 반영하므로 바로 끝났습니다.

## 그 밖의 PostgreSQL 특징 {#other-features}

원문은 여러 언어로 stored procedure를 만들 수 있는 점, PostGIS, Materialized View, 테이블 상속, 연산자·복합 자료형·집계함수 같은 DB 객체를 사용자가 만들 수 있는 확장성, trigram 매칭 기반의 pg_trgm을 짚습니다. 운영에서 신경 쓸 점으로 Vacuum도 적습니다. MGA 방식이라 UPDATE와 DELETE 뒤에 재사용되지 못하는 dead tuple이 남고, 쌓이면 공간 부족과 IO 비효율로 성능이 떨어지므로 주기적으로 vacuum을 돌려야 합니다.

## 이관 결정과 남은 일 {#decision}

팀은 복잡한 쿼리의 수행 속도와 대용량 테이블 관리 이슈를 크게 덜 수 있다고 보고 정산 DB를 Aurora PostgreSQL로 이관을 시도하기로 했습니다. 아직 테스트 단계라 실서비스에서는 예상치 못한 변수가 나올 수 있고, 성공 여부와 별개로 의미 있는 시도가 되리라 기대한다고 합니다. 이관을 마무리하면 후속 글로 공유하겠다는 말로 맺습니다.

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
