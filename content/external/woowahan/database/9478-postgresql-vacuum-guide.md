---
title: "PostgreSQL Vacuum의 동작 원리와 AutoVacuum 튜닝"
description: "우아한형제들이 PostgreSQL의 MVCC 구현에서 Vacuum이 필요한 이유, AutoVacuum이 호출되는 조건, 파라미터 튜닝, 실패 사례를 정리한 글입니다. Dead Tuple 정리와 Transaction ID Wraparound 방지가 중심입니다."
date: 2026-11-14
weight: 3
---

# PostgreSQL Vacuum의 동작 원리와 AutoVacuum 튜닝 (2022-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [PostgreSQL Vacuum에 대한 거의 모든 것](https://techblog.woowahan.com/9478/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2022-12-05
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다. 앞선 글 "Aurora MySQL vs Aurora PostgreSQL"에서 Vacuum을 잠깐 소개했고 이번 글이 그 상세편이라고 밝힙니다.
{{< /callout >}}

## Vacuum이란 {#overview}

Vacuum은 PostgreSQL의 진공청소기 역할을 하는 동작이고, 개발자에게 친숙한 GC에 비유됩니다. PostgreSQL의 MVCC 구현이 Oracle이나 MySQL과 달라서 생기는 문제를 풀려는 PostgreSQL만의 동작입니다. DB가 자동으로 수행하는 것이 AutoVacuum이며, 원문은 둘을 묶어 Vacuum이라 부릅니다. 하는 일은 네 가지입니다.

- 임계치 이상 쌓인 Dead Tuple을 정리해 FSM(Free Space Map)으로 반환
- Transaction ID Wraparound 방지
- 통계 정보 갱신
- visibility map을 갱신해 index scan 성능 향상

이 글은 이 중 Dead Tuple 정리와 Wraparound 방지를 다룹니다.

## MVCC 구현 방식의 차이 {#mvcc}

MVCC는 여러 트랜잭션이 동시에 도는 환경에서 각자에게 쿼리 시점의 데이터를 보여 읽기 일관성을 보장하고, 읽기와 쓰기의 충돌과 lock을 줄이는 기능입니다. Oracle은 UNDO segment를 써서 쿼리 시작 뒤에 바뀐 블록을 만나면 복사본(CR copy)을 만들어 UNDO로 시작 시점까지 되돌려 읽습니다. MySQL도 UNDO를 쓰며 변경 내용이 앞선 내용을 포인터로 가리키는 리스트(History List)를 따라가며 trx_id를 비교합니다.

PostgreSQL은 변경 전 Tuple과 변경 후 새 Tuple을 같은 데이터 페이지에 저장하고, Tuple마다 생성·변경 시점을 xmin과 xmax에 기록해 어떤 Tuple을 읽을 수 있는지 판단합니다. UPDATE에서는 이전 Tuple의 xmax와 새 Tuple의 xmin에 해당 시점의 Transaction ID가 들어가고 새 Tuple의 xmax는 NULL입니다.

## Dead Tuple 정리 {#dead-tuple}

UPDATE는 FSM에서 빈 공간을 찾아 새 데이터를 insert처럼 쓰고 포인터를 새 Tuple로 바꿉니다. 이전 Tuple은 어디서도 참조되지 않는 Dead Tuple이 되고, 자동으로 정리되거나 FSM에 반환되지 않습니다. Dead Tuple도 같은 page(기본 8KB)에 있으므로 필요한 live Tuple을 읽으려면 더 많은 page를 읽어야 해 디스크 I/O가 늘고 쿼리 성능이 떨어집니다. 원문의 그림에서는 같은 데이터를 읽는 데 페이지 2개로 충분하던 것이 Dead Tuple이 많으면 2배가 됩니다.

테스트는 1천만 건 테이블에서 autovacuum을 끄고 1건만 남기고 지운 뒤 비교했습니다. 삭제 직후에는 Dead Tuple이 9,999,999개, live Tuple이 1개이고 테이블 크기는 1912MB, 1건을 count하는 데 약 0.5초가 걸렸습니다. `vacuum`을 하자 Dead Tuple이 0이 되어 count가 약 10ms로 빨라졌습니다(497ms에서 10ms). 하지만 테이블 크기는 1912MB 그대로였고, `vacuum full`을 해야 40KB로 줄었습니다.

일반 Vacuum과 AutoVacuum은 공간을 FSM에 반환해 재사용만 가능하게 하고 OS 디스크로는 돌려주지 않습니다. 디스크 공간까지 회수하는 `vacuum full`은 Access Exclusive Lock을 잡아 SELECT까지 대기시켜 운영 중에는 쓸 수 없고, 테이블을 한 벌 더 복사하므로 디스크가 넉넉하지 않으면 시도조차 어렵습니다. 대안인 오픈소스 pg_repack도 여유 디스크, 여러 번의 metadata lock, CPU와 I/O 부하가 있어 피크 시간대에는 검토가 필요합니다. 그래서 "나중에 pg_repack으로 조치"보다 평소에 파라미터와 정책으로 Dead Tuple을 잘 정리해 두는 편이 가장 중요하다고 합니다.

## Transaction ID Wraparound 방지 {#wraparound}

Dead Tuple은 성능과 디스크 문제를 일으키지만 서비스를 멈추지는 않습니다. Transaction ID Wraparound는 다릅니다. 제때 Vacuum이 안 돌면 DB의 모든 write가 멈출 수 있어, AutoVacuum을 꺼 둬도 임계치를 넘으면 DB가 강제로 수행합니다.

xmin과 xmax는 각각 4바이트라 약 40억(2^32)개의 트랜잭션 ID를 표현하고, 20억은 과거용, 20억은 미래용입니다. ID를 다 쓰고 처음으로 돌아가면 새 데이터의 ID가 기존 데이터보다 작아져, 과거 데이터가 모두 미래에 있는 것처럼 보이지 않게 됩니다. 소스 코드의 주석(`xidWrapLimit; /* where the world ends */`)을 인용하며 PostgreSQL에게는 종말과 같은 일이라고 합니다. 이를 막으려고 특정 시점에 과거 데이터의 ID를 frozen XID = 2라는 특별한 값으로 바꾸는데, 이 동작이 freeze, 곧 Anti Wraparound Vacuum입니다.

age는 객체와 Tuple의 나이로, 처음 만들어지거나 insert될 때 1에서 시작해 DB에서 트랜잭션이 생길 때마다 모든 객체와 Tuple에서 1씩 올라갑니다. Tuple age는 freeze의 대상이고, 기준은 `vacuum_freeze_min_age`보다 높은 Tuple입니다. Table age는 속한 Tuple age 중 최댓값이라 freeze가 필요한 Tuple이 있는지 알려 주는 대표값이며, freeze 관련 임계치 파라미터는 Table age를 기준으로 합니다.

## AutoVacuum이 호출되는 때 {#autovacuum-trigger}

AutoVacuum은 Dead Tuple 누적치가 임계치에 닿거나 Table·Tuple의 age가 임계치에 닿을 때 수행됩니다.

Dead Tuple 기준은 `autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor * Tuple 수`입니다. 기본값은 50행과 20%라 변경분이 전체의 20%와 50개를 넘으면 호출됩니다.

age 기준에서 freeze는 두 경우에 수행됩니다. 테이블 age가 `autovacuum_freeze_max_age`를 넘었을 때, 또는 테이블 age가 `vacuum_freeze_table_age`와 `autovacuum_freeze_max_age` 사이이면서 그 테이블에 Vacuum이 호출됐을 때입니다. 뒤의 경우는 많은 테이블이 한꺼번에 freeze_max_age에 걸리기 전에 분산시키는 효과가 있습니다.

## 파라미터 튜닝 {#tuning}

"한가한 새벽에만 돌리면 안 되나"라는 생각이 들 수 있지만, 보통은 Vacuum이 드물수록 정리할 Dead Tuple과 freeze 작업이 쌓여 부하가 더 커집니다. 반대로 너무 자주 돌면 쿼리 성능에 영향을 주고, DDL과 겹치면 예상 못 한 metadata lock 대기로 장애가 날 수도 있습니다. 정답은 없지만 Dead Tuple 정리와 Vacuum 부하 사이의 균형을 찾아야 하며, 원문은 최소한 다음 두 묶음은 기본값 대신 서비스에 맞게 모니터링하며 정하라고 권합니다.

- `autovacuum_vacuum_scale_factor`와 `autovacuum_vacuum_threshold`. 기본값이면 10GB 테이블은 2GB, 1TB 테이블은 200GB의 Dead Tuple이 쌓여야 호출됩니다. 테이블이 클수록 한 번에 정리할 양이 너무 커져 부하가 되므로 scale_factor를 0.1로 낮추는 것을 권장하고, 문제가 되는 테이블은 개별로 낮은 값을 줄 수 있습니다. PostgreSQL 13부터는 insert에 대한 threshold도 추가됐습니다.
- `autovacuum_vacuum_cost_limit`과 `autovacuum_vacuum_cost_delay`. Vacuum 프로세스는 호출될 때마다 credit(기본 200)을 받아 page hit은 1, miss는 10, dirty(Dead Tuple 정리)는 20씩 소모하다가 다 쓰면 종료합니다. 값이 작으면 Dead Tuple을 다 못 치우고 끝나 계속 쌓일 수 있습니다. 권장은 cost_limit 1000(또는 `200 * (autovacuum_max_workers / 3)`), cost_delay 5ms입니다. AWS RDS는 인스턴스 스펙에 따라 값을 자동 설정합니다.

더 공격적으로 돌리려면 다음도 고려합니다.

- `autovacuum_naptime`을 기본 60초에서 5초로 줄입니다.
- `autovacuum_max_workers`를 늘립니다. 2배로 늘려도 처리량이 2배가 되지는 않지만, 큰 테이블 때문에 작은 테이블이 Vacuum을 못 받을 때, 그리고 파티션 테이블에서 유효합니다. CPU 코어 수 / 2~4 정도로 과하지 않게 잡습니다.
- `max_parallel_maintenance_workers`를 기본 2에서 4~8로 늘립니다. 작업이 너무 느릴 때만 쓰고 다른 parallel 파라미터도 함께 봅니다.
- `autovacuum_work_mem`(`maintenance_work_mem`)을 키워 주기당 더 많은 Dead Tuple을 모으게 합니다. 서버 메모리를 보고 과하지 않게 잡습니다.

정리하면, AutoVacuum이 너무 드물면 scale_factor와 threshold(insert 쪽 포함)를, 너무 느리면 cost_delay, cost_limit, naptime, max_workers, work_mem, 병렬 worker 파라미터를 봅니다.

## Vacuum이 실패하는 경우 {#failures}

Vacuum이 돌아도 Dead Tuple을 못 지우는 경우가 세 가지 있습니다.

- Long transaction. 오래 도는 쿼리와 commit되지 않은 idle 트랜잭션이 참조하는 Dead Tuple은 지울 수 없습니다. 원문의 로그에서는 oldest xmin 10674654 트랜잭션 때문에 1,041,608개가 "Dead but not yet removable"이었습니다. long transaction과 미커밋 트랜잭션을 모니터링하고 `statement_timeout`, `idle_in_transaction_session_timeout`으로 예방할 수 있지만 서비스 개발팀과 협의가 필요합니다.
- 버려진 replication slot. physical replication slot을 쓰는 streaming replication에서 standby가 지연되거나 내려가면 slot이 복제용 데이터를 계속 붙들어 Vacuum 정리를 막습니다.
- `hot_standby_feedback = ON`. Master가 지운 Tuple을 Replica가 아직 쓰면 replication conflict가 나므로, Replica의 가장 오래된 트랜잭션 정보를 Master에 알려 그때까지 정리를 미룹니다. Aurora PostgreSQL은 이 값이 기본 ON이고 바꿀 수 없다고 합니다.

## 마무리 {#closing}

원문은 Vacuum이 DBA에게 PostgreSQL을 까다롭게 만드는 허들이지만, 그 때문에 PostgreSQL을 배제하는 것은 아쉽지 않겠느냐고 반문하며, 도입을 망설이는 사람에게 도움이 되기를 바란다고 맺습니다. 지속 운영 관점에서는 성능과 디스크 효율을 위한 Dead Tuple 정리보다 Wraparound 방지가 더 중요하다고 정리합니다.

{{% details title="파라미터 기본값과 권장값" closed="true" %}}

| 파라미터 | 기본값 | 원문 권장값 |
|---|---|---|
| autovacuum_vacuum_threshold | 50 | 50 |
| autovacuum_vacuum_scale_factor | 0.2 | 0.1 |
| autovacuum_vacuum_cost_limit | 200 | 1000 또는 `200 * (autovacuum_max_workers / 3)` |
| autovacuum_vacuum_cost_delay | 20ms | 5ms |
| autovacuum_naptime | 60초 | 5초 |
| autovacuum_freeze_max_age | 2억 | 원문에 변경 권장 없음 |
| vacuum_freeze_min_age | 5천만 | 원문에 변경 권장 없음 |
| vacuum_freeze_table_age | 1억 5천만 | 원문에 변경 권장 없음 |
| max_parallel_maintenance_workers | 2 | 느릴 때 4~8 |
| vacuum_cost_page_hit / miss / dirty | 1 / 10 / 20 | 원문에 변경 권장 없음 |

테스트 수치는 1천만 건 테이블에서 delete 후 Dead Tuple 9,999,999개, 테이블 크기 1912MB, count 약 498ms였고, vacuum 뒤 count는 약 10ms, vacuum full 뒤 크기는 40KB였습니다.

{{% /details %}}
