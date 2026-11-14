---
title: "PostgreSQL Vacuum으로 달라진 1건짜리 테이블"
description: "한 건만 남은 PostgreSQL 테이블이 크고 느린 이유는 MVCC가 남긴 Dead Tuple에 있습니다. Vacuum의 공간 정리와 Transaction ID Wraparound 방지 원리를 바탕으로 AutoVacuum의 실행 조건, 튜닝 기준과 실패 원인을 짚습니다."
date: 2026-11-14
weight: 3
---

# PostgreSQL Vacuum으로 달라진 1건짜리 테이블 (2022-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [PostgreSQL Vacuum에 대한 거의 모든 것](https://techblog.woowahan.com/9478/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2022-12-05
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다. 앞선 글 "Aurora MySQL vs Aurora PostgreSQL"에서 Vacuum을 잠깐 소개했고 이번 글이 그 상세편이라고 밝힙니다.
{{< /callout >}}

## 1건을 세는 데 0.5초가 걸린 테이블 {#dead-tuple}

원문의 테스트는 1천만 건을 담은 `tb_test`에서 시작합니다. AutoVacuum을 끄고 1건만 남겨 삭제했는데도, 그 1건을 세는 데 약 0.5초가 걸렸습니다. live Tuple은 1개인데 Dead Tuple은 9,999,999개가 남았고, 테이블 크기는 1912MB였습니다.

`vacuum`을 실행하자 Dead Tuple은 0개가 됐고, 같은 1건을 세는 시간도 497ms에서 10ms로 줄었습니다. 조회는 빨라졌습니다. 그런데 테이블은 여전히 1912MB입니다. 데이터를 정리한 뒤에도 디스크에 할당된 크기는 그대로 남은 결과입니다.

## 이전 버전까지 담아 둔 PostgreSQL 페이지 {#mvcc}

지운 데이터가 공간을 차지하는 이유는 PostgreSQL의 MVCC 구현에 있습니다. MVCC는 여러 트랜잭션이 실행되는 환경에서 각 트랜잭션에 쿼리 시점의 데이터를 보여 주어 읽기 일관성을 지키고, 읽기와 쓰기의 충돌과 lock을 줄이는 기능입니다.

Oracle은 쿼리 시작 뒤 변경된 블록을 만나면 복사본인 CR copy를 만들고, UNDO segment를 적용해 쿼리 시작 시점으로 되돌려 읽습니다. MySQL도 UNDO를 사용합니다. 이전 변경 내역을 가리키는 포인터로 연결된 History List를 따라가며 `trx_id`를 비교해 읽을 데이터를 찾는 방식입니다.

PostgreSQL은 이전 버전을 데이터 페이지 안에 둡니다. 레코드에 해당하는 Tuple의 변경 전 버전과 변경 후 버전을 같은 페이지에 저장하고, `xmin`과 `xmax`에 기록한 Transaction ID로 읽을 버전을 판단합니다. UPDATE가 발생하면 이전 Tuple의 `xmax`와 새 Tuple의 `xmin`에 해당 시점의 Transaction ID가 들어갑니다. 새 Tuple의 `xmax`는 NULL입니다.

UPDATE는 사용 가능한 공간을 표시한 FSM(Free Space Map)에서 빈자리를 찾아 새 데이터를 insert처럼 기록한 뒤, 포인터를 새 Tuple로 바꿉니다. 이 과정에서 쓸모가 없어진 이전 Tuple이 Dead Tuple로 남습니다. 별도 정리 없이 공간을 계속 차지하는 데이터입니다.

페이지 크기는 기본 8KB로 한정돼 있습니다. 그 안에 Dead Tuple이 많으면 필요한 live Tuple을 읽기 위해 더 많은 페이지를 읽어야 하고, 디스크 I/O도 늘어납니다. 원문의 그림에서는 같은 데이터를 읽는 데 페이지 2개면 충분하던 것이 Dead Tuple 때문에 2배로 늘어납니다. 테이블이 커지는 문제와 조회가 느려지는 문제가 연결되는 지점입니다.

Vacuum은 이 Dead Tuple을 정리해 공간을 FSM으로 돌려주는 진공청소기 역할을 합니다. DB가 임계치에 따라 자동으로 실행하는 Vacuum이 AutoVacuum입니다. 통계 정보를 갱신하고, visibility map을 갱신해 index scan 성능을 높이는 일도 Vacuum의 역할에 들어갑니다.

## vacuum full의 잠금 앞에 대기하는 SELECT {#disk-space}

FSM으로 돌아온 공간은 다시 사용할 수 있습니다. 하지만 앞선 테스트에서 확인했듯, 재사용할 공간이 생겼다고 OS에 디스크 공간까지 반환한 것은 아닙니다. 일반 Vacuum으로도 물리 공간을 회수하는 경우가 있지만, 원문은 그 경우를 다루지 않습니다. 테스트의 테이블 크기가 1912MB에서 40KB로 줄어든 것은 `vacuum full`을 실행한 뒤입니다.

공간을 돌려받는 데에는 비용이 따릅니다. 일반 Vacuum과 AutoVacuum은 DML을 허용하는 온라인 작업이며 DDL은 허용하지 않습니다. `vacuum full`은 Access Exclusive Lock을 획득해 DML뿐 아니라 SELECT도 대기시킵니다. 운영 중에 실행하기 어려운 이유입니다. 대상 테이블을 한 벌 더 복사하므로, 디스크 여유가 부족하면 시도조차 할 수 없습니다.

대안으로 쓰는 오픈소스 pg_repack에도 조건이 붙습니다. 작업용 디스크 공간이 필요하고 작업 도중 여러 번의 metadata lock을 잡으며, CPU와 I/O 부하도 발생합니다. 피크 시간대에 사용하기에는 부담이 있는 작업입니다. 나중에 pg_repack으로 처리하겠다고 미루기보다, 평소 Vacuum의 임계치와 처리 속도를 조정해 Dead Tuple이 불필요한 공간을 늘리지 않도록 관리하라는 것이 원문의 권고입니다.

## PostgreSQL의 종말을 막는 freeze {#wraparound}

Vacuum에는 공간 정리보다 더 긴급한 역할도 있습니다. Transaction ID를 제때 정리하지 못하면 DB의 모든 write 작업이 멈출 수 있습니다. Transaction ID Wraparound를 막기 위한 Vacuum은 AutoVacuum을 꺼 두었어도 임계치를 넘으면 강제로 실행됩니다.

`xmin`과 `xmax`에는 각각 4바이트를 할당합니다. 약 40억(2^32)개의 Transaction ID를 표현하며, 20억은 과거에, 20억은 미래에 사용합니다. ID를 모두 쓰고 처음으로 돌아가면 새 데이터의 ID가 기존 데이터보다 작아집니다. 과거 데이터가 미래의 데이터처럼 보이면서 읽을 수 없게 되는 현상이 Transaction ID Wraparound입니다. 소스 코드의 `xidWrapLimit; /* where the world ends */`라는 주석은 PostgreSQL에 이 상황이 얼마나 치명적인지 보여 줍니다.

이를 막는 작업이 freeze, 곧 Anti Wraparound Vacuum입니다. 과거 데이터의 Transaction ID를 계속 증가시키는 대신 특정 시점에 `frozen XID = 2`라는 특별한 값으로 바꿉니다. 원문이 말하는 데이터의 회춘입니다.

freeze 시점을 판단하는 기준은 age입니다. 객체나 Tuple을 처음 만들 때 1에서 시작하며, 해당 테이블과 관계없는 트랜잭션이라도 DB에서 발생할 때마다 모든 객체와 Tuple의 age가 1씩 늘어납니다. Table age는 그 테이블에 속한 Tuple age의 최댓값입니다. 테이블 자체를 freeze하는 것은 아니지만, Table age만으로도 오래된 Tuple이 있는지 판단하게 해 주는 대표값입니다.

Tuple age가 `vacuum_freeze_min_age`보다 높으면 freeze 대상이며, 원문에 나온 기본값은 5천만입니다. 테이블 age가 `autovacuum_freeze_max_age`의 기본값인 2억을 넘으면 강제로 Anti Wraparound AutoVacuum을 수행합니다. 작업 후 테이블 age는 최대 `vacuum_freeze_min_age` 값으로 설정됩니다.

2억에 도달하기 전에도 freeze할 기회가 있습니다. 테이블 age가 `vacuum_freeze_table_age`의 기본값인 1억 5천만과 `autovacuum_freeze_max_age` 사이일 때 그 테이블에 Vacuum이 호출되면 freeze도 함께 수행합니다. 여러 테이블이 한꺼번에 강제 실행 임계치에 도달하기 전에 작업을 분산하는 장치입니다.

## Vacuum이 실행돼도 남는 Dead Tuple {#failures}

Vacuum이 실행됐다는 사실만으로 정리가 끝났다고 볼 수는 없습니다. 원문의 로그에는 oldest xmin 10674654인 트랜잭션 때문에 Dead Tuple 1,041,608개가 “Dead but not yet removable”로 남은 사례가 있습니다. 죽은 데이터로 분류했지만 아직 지울 수는 없다는 뜻입니다.

오래 실행되는 쿼리나 commit되지 않은 idle 트랜잭션이 그 데이터를 참조하고 있으면 정리를 진행하지 못합니다. long transaction과 미커밋 트랜잭션을 모니터링해야 하는 이유입니다. `statement_timeout`과 `idle_in_transaction_session_timeout`으로 쿼리나 트랜잭션이 오래 방치되는 상황을 예방할 수 있지만, 이 값으로 제어하려면 서비스 개발팀과 협의해야 합니다.

복제 구성에서도 정리가 막힙니다. physical replication slot을 사용하는 streaming replication에서 standby가 지연되거나 내려가면, slot은 복제에 필요한 데이터를 계속 보관합니다. 이렇게 남겨진 replication slot이 해당 데이터를 Dead Tuple로 정리하는 것도 방해합니다.

`hot_standby_feedback = ON` 역시 확인할 설정입니다. Master에서 정리할 Tuple을 Replica가 복제 지연이나 long transaction 때문에 아직 필요로 할 수 있습니다. 이때 Master가 먼저 지우면 replication conflict가 발생합니다. 이를 막으려고 Replica가 쿼리와 가장 오래된 트랜잭션 정보를 Master에 전달하면, Master는 그 데이터의 정리를 미룹니다. 원문에서 설명하는 Aurora PostgreSQL은 이 값이 기본 ON이며 변경할 수 없습니다.

## 커진 테이블에 맞춰 조정할 AutoVacuum {#tuning}

새벽이나 점검 시간에 Vacuum을 돌려야 하는 테이블도 있습니다. 그러나 일반적으로 실행을 미룰수록 정리할 Dead Tuple과 freeze 작업이 쌓여 나중에 더 큰 부하를 일으킬 수 있습니다. 너무 자주 실행해도 문제가 생깁니다. Vacuum의 부하가 쿼리 성능에 영향을 주고, DDL과 겹치면 예상하지 못한 metadata lock 대기로 장애가 발생할 수도 있습니다.

### 많은 데이터를 기다리는 호출 임계치

Dead Tuple 기준으로 AutoVacuum을 호출하는 임계치는 `autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor * Tuple 수`입니다. 기본값은 각각 50과 0.2입니다. 테이블 전체 Tuple 수의 20%에 50개를 더한 만큼 Dead Tuple이 쌓여야 호출되는 설정입니다.

이를 데이터 크기에 빗대면 10GB 테이블에서는 2GB, 1TB 테이블에서는 200GB가 쌓인 뒤 청소하는 모습입니다. 실제 기준인 Tuple 개수의 비율을 크기로 바꿔 설명한 원문의 비유입니다. 작은 테이블에서는 드러나지 않던 부담이 테이블이 커지면서 커질 수 있습니다.

원문은 `autovacuum_vacuum_threshold`를 50으로 유지하고 `autovacuum_vacuum_scale_factor`를 0.2에서 0.1로 낮추는 조정안을 제시합니다. 문제가 되는 테이블에는 개별 임계치를 지정해 더 세밀하게 관리할 수 있습니다. PostgreSQL 13부터는 insert에 대한 Vacuum threshold도 추가됐습니다. 이 값들은 서비스 상태를 모니터링하며 정할 대상입니다.

### 정리 속도에 관여하는 credit과 worker

호출이 충분히 잦아도 정리 속도가 느릴 수 있습니다. `autovacuum_vacuum_cost_limit`과 `autovacuum_vacuum_cost_delay`는 이때 살펴볼 설정입니다. 원문은 비용 한도를 credit으로 설명합니다. 기본 200의 credit을 기준으로 page hit은 1, miss는 10, dirty는 20씩 소모합니다. 비용 한도가 너무 작으면 Dead Tuple을 충분히 정리하지 못해 계속 누적되는 상황이 생길 수 있습니다.

제시한 조정값은 cost_limit 1000 또는 `200 * (autovacuum_max_workers / 3)`, cost_delay 5ms입니다. cost_delay의 기본값은 20ms입니다. 한 번에 처리할 비용 한도를 늘리고 작업 사이의 대기를 줄이려는 설정이며, AWS RDS는 인스턴스 스펙에 따라 cost_limit을 자동으로 설정합니다.

실행 간격과 작업 자원도 함께 조정할 수 있습니다.

- `autovacuum_naptime`: AutoVacuum 실행 사이의 최소 지연을 기본 60초에서 5초로 줄이는 조정안
- `autovacuum_max_workers`: 큰 테이블의 Vacuum 때문에 작은 테이블이 기다리거나, 파티션별로 worker를 배정할 때 늘려 볼 값. worker를 2배로 늘려도 처리량이 곧바로 2배가 되지는 않음. 원문이 제시한 기준은 CPU 코어 수 / 2~4 정도
- `max_parallel_maintenance_workers`: 인덱스 생성이나 Vacuum이 너무 느릴 때 기본 2에서 4~8로 늘려 볼 값. CPU 코어 수와 다른 parallel 파라미터도 함께 확인
- `autovacuum_work_mem`(`maintenance_work_mem`): 힙을 스캔하며 메모리에 모을 수 있는 Dead Tuple 수를 결정하는 설정. 값을 늘리면 주기당 더 많이 수집할 수 있으며, 서버 메모리 크기를 고려해 조정

{{% details title="원문이 제시한 파라미터 기본값과 권장값" closed="true" %}}

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
