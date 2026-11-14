---
title: "MySQL ALTER DDL의 수행 흐름과 알고리즘별 Metadata Lock"
description: "MySQL의 Copy, In-Place, Instant 세 가지 ALTER DDL 알고리즘이 내부에서 어떻게 동작하는지 정리한 글입니다. 알고리즘마다 Metadata Lock이 걸리는 시점을 비교하고 운영 습관 두 가지를 제안합니다."
date: 2026-11-14
weight: 6
---

# MySQL ALTER DDL의 수행 흐름과 알고리즘별 Metadata Lock (2025-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [MySQL ALTER DDL 수행 방식에 대한 이해](https://tech.kakao.com/posts/703)
- 매체 · 게시일: 카카오 기술블로그 · 2025-05-14
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 문제 배경 {#background}

MySQL은 서비스가 잘되고 사용자가 늘수록 운영하기가 쉽지 않았고, 그중 하나가 운영 중에 Online DDL을 수행하기 어렵다는 점이었다고 원문은 말합니다. 그래서 5.6에서 기존 COPY 알고리즘을 개선한 In-Place 알고리즘이 생겼습니다. 테이블 가용성은 높아졌지만 DDL 시작과 종료 시점에 메타 락을 잡아야 하고, 작업에 따라서는 Copy처럼 임시 테이블을 만들고 데이터를 복제해야 했습니다. 8.0에서는 테이블 크기와 상관없이 간단한 DDL을 처리하는 Instant 알고리즘이 추가되었습니다. 이 글은 세 알고리즘의 주요 함수, 동작, Meta Lock 사용을 내부 동작 수준에서 살펴봅니다.

## ALTER DDL의 세 단계 {#three-phases}

알고리즘과 관계없이 ALTER DDL은 세 단계로 진행됩니다. 이후의 함수 설명은 In-Place와 Instant 중심입니다.

Initialization 단계에서는 사용할 알고리즘과 Lock 유형을 고릅니다. 사용자가 지정한 알고리즘으로 실행할 수 있는지 메타데이터로 확인하고, `handler::check_if_supported_inplace_alter()`가 알려 주는 Lock 모드를 사용자가 지정한 모드와 비교합니다. 둘이 충돌하면 오류를 내고 멈춥니다. 예컨대 필요한 모드가 `HA_ALTER_INPLACE_SHARED_LOCK_AFTER_PREPARE`인데 `LOCK=none`을 준 경우입니다.

Execution 단계에서는 선택한 알고리즘과 Lock 모드를 실제로 수행합니다. 순서는 이렇습니다.

- `MDL_SHARED_UPGRADABLE` Metadata Lock을 얻습니다.
- In-Place라면 Lock을 `MDL_EXCLUSIVE`로 승격해 다른 세션의 접근을 막습니다.
- `ha_prepare_inplace_alter_table()`로 제약사항을 확인하고 인덱스와 외래키 Metadata를 갱신합니다. Instant는 이 단계를 하지 않습니다.
- In-Place라면 Lock을 강등합니다. DDL 도중 DML을 막아야 하면 `MDL_SHARED_NO_WRITE`로, 아니면 `MDL_SHARED_UPGRADABLE`로 내립니다.
- `ha_inplace_alter_table()`로 실제 변경을 실행합니다. Instant는 하지 않습니다.
- Lock을 `MDL_EXCLUSIVE`로 승격하고 `ha_commit_inplace_alter_table()`로 테이블 Metadata를 바꿉니다.

Final 단계에서는 Data Dictionary를 갱신해 커밋하고, 쓴 객체와 메모리를 정리한 뒤 `MDL_SHARED_READ` Lock으로 변경된 Metadata를 최종 확인합니다. Atomic DDL을 지원하는 스토리지 엔진은 테이블 이름 교체를 먼저 하고 Data Dictionary를 갱신해 커밋합니다. 지원하지 않는 엔진은 Data Dictionary를 갱신한 뒤 이름을 바꿉니다.

## 주요 함수 {#key-functions}

`ha_prepare_inplace_alter_table`은 ALTER 문과 현재 테이블 명세를 비교해 인덱스 이름과 컬럼 이름 제약을 확인합니다. Instant로 지정된 문장은 아무 일도 하지 않고 바로 반환됩니다.

`ha_inplace_alter_table`에서는 테이블 리빌드, DML 로그 적용, 인덱스 구성이 일어납니다. Instant이거나, In-Place지만 인덱스 구성도 리빌드도 필요 없는 경우에는 이 함수 안에서 하는 일이 없습니다.

`ha_commit_inplace_alter_table`은 Execution의 마지막에 호출되어 Data Dictionary를 고치고 작업을 최종 커밋합니다. 엔진이 Atomic DDL을 지원하면 실제 커밋은 Final 단계에서 이뤄집니다. 이 함수는 이름 변경에 쓸 임시 이름을 만들고, 통계 수집 스레드가 대상 테이블에 접근하지 못하게 하고, 원본과 변경된 테이블의 Metadata를 동기화합니다. Instant에서는 `dd_add_instant_columns`가 Metadata의 `row_version` 값을 바꾸고 Default Value를 설정합니다.

## 세 알고리즘의 동작과 한계 {#algorithms}

Copy는 가장 먼저 쓰인 단순한 방식입니다. 읽기는 되지만 쓰기는 안 됩니다. 8.0 기준으로 Primary Key Drop, Column Type 변경, Character Set 변환, 엔진이 Copy만 지원하는 경우는 Copy로만 진행됩니다. 새 테이블을 만들고, 데이터를 복사하고, 이름을 바꾼 뒤 기존 테이블을 지웁니다. 원문이 든 단점은 쓰기 차단, 큰 디스크 공간, 많은 Disk I/O, 테이블 크기에 따른 작업 시간, Source/Replica 간 Gap, 롤백에 걸리는 긴 시간입니다.

In-Place는 5.6에 추가되었고, 일부 경우를 빼면 DDL 중에도 다른 세션의 읽기와 쓰기가 가능합니다. 리빌드가 필요한 작업은 임시 테이블을 만들어 데이터를 옮기고, 그동안 들어온 쓰기는 별도 버퍼에 DML Log로 쌓았다가 복사가 끝나면 새 테이블에 적용합니다. 그다음 이름을 바꾸고 기존 테이블과 DML Log를 지웁니다. 원문은 내부 테스트에서 In-Place의 임시 테이블 작업이 Copy의 전체 복사와는 다른 작업으로 추정된다고 하며, 공간은 원본 크기에 버금갈 수 있어도 Copy보다 빠르게 동작했다고 적습니다. 단점으로는 리빌드가 필요한 일부 작업의 긴 시간, 일부 경우의 쓰기 차단, 처리량이 많은 서버의 높은 I/O, Replication Gap, 두 번의 Exclusive Metadata Lock, 작업 공간 확보, `innodb_online_alter_log_max_size` 설정을 듭니다.

Instant는 8.0에서 추가되었고 Metadata만 바꿉니다. 컬럼 추가와 삭제, 컬럼 Default Value 설정, ENUM 컬럼 명세 변경을 지원하며 범위가 넓어지는 중입니다. 대상 테이블의 Metadata와 Row Version 값을 바꾸는 것이 전부입니다. 한계도 있습니다. 지원 작업이 적고, 64번 작업한 뒤에는 테이블을 리빌드해야 다시 쓸 수 있고, FULLTEXT 인덱스가 있거나 `ROW_FORMAT=COMPRESSED`인 테이블에서는 컬럼 추가와 삭제가 안 되며, Exclusive Metadata Lock이 한 번 걸려 잠깐이나마 서비스에 영향을 줄 수 있습니다.

## In-Place와 Instant의 Metadata Lock 비교 {#metadata-lock}

두 알고리즘 모두 `MDL_SHARED_UPGRADABLE`로 시작하며, 이 Lock은 다른 세션의 읽기와 쓰기를 허용합니다. 차이는 `prepare_inplace_alter` 단계에서 납니다. In-Place는 이 함수에 들어가기 전에 Lock을 `MDL_EXCLUSIVE`로 승격하므로 이때부터 다른 세션이 Meta-Lock 대기에 빠질 수 있고, 함수가 끝나면 `MDL_SHARED_UPGRADABLE`로 강등합니다. `inplace_alter_table` 실행 중에는 두 알고리즘 모두 `MDL_SHARED_UPGRADABLE`를 쥐고 있습니다. `commit_inplace_alter_table`에 들어가기 전에는 둘 다 `MDL_EXCLUSIVE`로 승격해 이 함수가 끝날 때까지 다른 세션을 막습니다. Final 단계에서는 `MDL_SHARED_READ`를 잡습니다.

예외가 하나 있습니다. Auto_increment 속성의 INT 컬럼을 추가하는 In-Place 작업은 `MDL_SHARED_UPGRADABLE`가 아니라 `MDL_SHARED_NO_WRITE`로 강등합니다.

원문은 Metadata만 고치는 작업을 In-Place로 수행해도 Instant와 같을지 디버깅으로 확인했습니다. 결과는 같지 않았습니다. 그런 작업도 `prepare_inplace_alter` 때 `MDL_EXCLUSIVE`로 승격했고, 소스(`mysql_inplace_alter_table()`)는 알고리즘만 보고 Lock을 승격하므로 Metadata만 수정해도 In-Place의 Lock 동작은 달라지지 않는다고 설명합니다. 따라서 Exclusive Metadata Lock은 In-Place에서 두 번, Instant에서 한 번 쓰입니다.

## 운영 습관 {#practice}

원문은 작업에 따라 쓸 수 있는 알고리즘이 달라서 Instant를 고를 수 없는 경우가 많다고 인정합니다. 그래도 어떤 알고리즘이든 두 가지 습관을 권합니다.

- ALTER 문에 ALGORITHM 구문을 명시합니다. 예기치 않게 느린 알고리즘으로 대체되는 일을 막는 방어적 방식입니다.
- 실행 전에 오래 도는 트랜잭션과 쿼리를 확인합니다. 어떤 DDL이든 Exclusive Metadata Lock이 잠깐이라도 걸리기 때문입니다.

{{% details title="알고리즘별 비교" closed="true" %}}

| 항목 | Copy | In-Place | Instant |
|---|---|---|---|
| 테이블 복사 | 필요 | 부분적, 내부 중간 구조 사용 | 불필요 |
| 데이터 재구축 | 함 | 작업에 따라 다름 | 안 함 |
| 동시 DML | 불가 | 작업에 따라 다름 | 가능 |
| Lock | 작업 완료까지 Exclusive DML Lock | 작업에 따라 다름 | 짧은 Metadata Lock |
| 디스크 공간 | 높음, 전체 복사 | 중간, 임시 파일과 로그 | 매우 낮음 |
| 시간 | 가장 느림 | 작업과 테이블 크기에 따라 다름 | 가장 빠름 |
| CPU/IO | 높음 | 중간 | 낮음 |
| 사용 가능 버전 | 모든 버전 | 5.6 이상 | 8.0.12 이상, 컬럼 추가 외 기능은 8.0.29부터 |
| Exclusive Metadata Lock 횟수 | 해당 없음 | 2회 | 1회 |

{{% /details %}}
