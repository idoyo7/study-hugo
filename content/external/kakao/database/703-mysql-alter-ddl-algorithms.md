---
title: "서비스 중 MySQL ALTER DDL이 다른 세션을 막는 순간"
description: "Online DDL도 짧게나마 Exclusive Metadata Lock을 획득하기 때문에 다른 세션의 접근을 막습니다. Copy, In-Place, Instant의 데이터 처리와 락 획득 시점을 비교하고, 실행 전에 확인할 조건을 설명합니다."
date: 2026-11-14
weight: 6
---

# 서비스 중 MySQL ALTER DDL이 다른 세션을 막는 순간 (2025-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [MySQL ALTER DDL 수행 방식에 대한 이해](https://tech.kakao.com/posts/703)
- 매체 · 게시일: 카카오 기술블로그 · 2025-05-14
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 쓰기 차단을 줄여 온 MySQL의 알고리즘 {#algorithms}

서비스를 운영하면서 테이블을 바꾸는 일은 MySQL의 오랜 어려움이었습니다. 기존 Copy 방식은 DDL 작업이 끝날 때까지 다른 세션의 쓰기를 막았습니다. 이를 개선하려고 MySQL은 5.6에서 In-Place를, 8.0에서 Instant를 추가했습니다.

쓰기 차단은 줄었지만 락은 남았습니다. In-Place는 일부 작업을 제외하면 DDL 중에도 다른 세션의 읽기와 쓰기를 허용하고, Instant는 Metadata만 바꿔 테이블 크기와 관계없이 간단한 변경을 처리합니다. 그래도 다른 세션의 접근을 잠깐 막는 시점은 있습니다.

### 테이블 전체를 옮기는 Copy

Copy는 DDL을 적용한 새 테이블을 만든 뒤 기존 데이터를 모두 복사합니다. 복사가 끝나면 테이블 이름을 바꾸고 기존 테이블을 삭제합니다. 복사하는 동안 읽기는 가능하지만, 다른 세션의 쓰기는 작업이 끝날 때까지 차단됩니다.

전체 데이터를 옮기는 비용도 큽니다. 디스크 공간과 Disk I/O를 많이 사용하며, 작업 시간은 테이블 크기의 영향을 받습니다. Replication을 구성했다면 Source/Replica 간 Gap이 커질 수 있고, 롤백에도 긴 시간이 필요할 수 있습니다.

그렇다고 언제나 Copy를 피할 수 있는 것은 아닙니다. MySQL 8.0 기준으로 Primary Key Drop, Column Type 변경, Character Set 변환은 Copy로만 진행됩니다. 스토리지 엔진이 Copy만 지원하는 경우도 여기에 해당합니다.

### 쓰기를 DML Log에 쌓는 In-Place

In-Place라는 이름이 테이블 재구축까지 없다는 뜻은 아닙니다. 리빌드가 필요한 작업이라면 임시 테이블을 만들고 기존 데이터를 복사합니다. 그동안 들어오는 쓰기는 별도 버퍼에 DML Log로 적재했다가, 복사가 끝나면 새 테이블에 적용합니다. 이후 테이블 이름을 바꾸고 기존 테이블과 DML Log를 삭제합니다.

카카오의 내부 테스트에서는 In-Place가 Copy보다 빠르게 동작했습니다. In-Place의 임시 테이블 작업은 Copy의 전체 데이터 복사와 다른 작업으로 추정되지만, 작업에 따라 원본 테이블 크기에 버금가는 공간이 필요할 수 있습니다. 작업 전에 리빌드 여부를 확인하고 작업 공간을 확보해야 하는 이유입니다.

일부 경우에는 여전히 쓰기가 차단됩니다. 테이블이 크면 작업이 오래 걸리고 트랜잭션에도 영향을 줄 수 있으며, 처리량이 많은 서버에서는 높은 I/O 사용량이 서비스에 부담을 줄 수 있습니다. 장시간 작업에 따른 Replication Gap도 남아 있는 문제입니다. 작업 성공 여부에는 `innodb_online_alter_log_max_size` 설정도 영향을 줍니다.

### Metadata만 바꾸는 Instant

Instant는 대상 테이블의 Metadata와 Row Version 값을 수정해 변경을 처리합니다. 데이터를 재구축하지 않아 테이블 크기에 좌우되지 않고, 세 알고리즘 중 가장 빠르며 서비스에 거의 영향을 주지 않습니다. 컬럼 추가와 삭제, 컬럼의 Default Value 설정, ENUM 타입 컬럼의 명세 변경을 지원하며 지원 범위는 넓어지고 있습니다.

제약은 남아 있습니다. Instant로 64번 작업한 뒤에는 테이블을 리빌드해야 다시 사용할 수 있고, FULLTEXT 인덱스가 있거나 `ROW_FORMAT=COMPRESSED`인 테이블에서는 컬럼을 추가하거나 삭제할 수 없습니다. Exclusive Metadata Lock도 한 번 획득하므로 잠깐이나마 서비스에 영향을 줄 수 있습니다.

{{% details title="알고리즘별 데이터 처리와 자원 사용 비교" closed="true" %}}

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
| Exclusive Metadata Lock 횟수 | 원문에 언급 없음 | 2회 | 1회 |

{{% /details %}}

## 실행 조건을 확인하는 Initialization {#three-phases}

ALTER DDL은 알고리즘과 관계없이 Initialization, Execution, Final을 거칩니다. 사용할 알고리즘과 Lock 모드를 고른 뒤 실제 변경을 수행하고, Data Dictionary 갱신과 커밋, 자원 정리로 마무리하는 흐름입니다. 세부 함수와 락 동작은 In-Place와 Instant를 기준으로 살펴보겠습니다.

Initialization에서는 사용자가 명시한 알고리즘으로 DDL을 실행할 수 있는지 확인합니다. 중복된 컬럼 이름이나 존재하지 않는 컬럼의 수정처럼 테이블 Metadata만 조회해도 알 수 있는 문제를 이때 검사합니다.

Lock 모드도 여기서 맞춰 봅니다. `handler::check_if_supported_inplace_alter()`가 반환한 모드와 사용자가 지정한 모드가 충돌하면 오류를 내고 작업을 중지합니다. 예를 들어 필요한 모드가 `HA_ALTER_INPLACE_SHARED_LOCK_AFTER_PREPARE`인데 `LOCK=none`을 지정한 경우입니다. 알고리즘을 선택했더라도 해당 작업이 요구하는 락 조건을 만족해야 실행으로 넘어갑니다.

## 준비와 커밋 단계에서 획득하는 Metadata Lock {#metadata-lock}

Execution에 들어가면 In-Place와 Instant 모두 `MDL_SHARED_UPGRADABLE`을 획득합니다. 다른 세션의 읽기와 쓰기를 허용하는 락이므로, 이 단계까지는 다른 세션의 작업을 막지 않습니다.

In-Place는 준비 단계부터 달라집니다. `ha_prepare_inplace_alter_table()`에 들어가기 전에 락을 `MDL_EXCLUSIVE`로 승격해 다른 세션의 접근을 모두 차단합니다. 함수 안에서는 ALTER 문과 현재 테이블 명세를 비교해 인덱스 이름과 컬럼 이름의 제약을 확인하고, 인덱스와 외래키 Metadata를 갱신합니다. Instant는 이 준비 작업을 수행하지 않고 반환하므로 이 시점의 락 승격을 거치지 않습니다.

준비가 끝난 In-Place는 락을 다시 낮춥니다. 보통은 `MDL_SHARED_UPGRADABLE`로 강등하지만, DDL 도중 다른 세션의 쓰기를 막아야 하는 작업은 `MDL_SHARED_NO_WRITE`로 낮춰 읽기만 허용합니다. `Auto_increment` 속성의 INT 컬럼을 추가하는 작업이 그 예입니다.

실제 리빌드와 DML 로그 적용, 인덱스 구성은 `ha_inplace_alter_table()`에서 진행됩니다. Instant이거나, In-Place라도 인덱스 구성과 테이블 리빌드가 모두 필요 없는 작업이면 이 함수 안에서 변경 작업을 수행하지 않습니다.

그렇다고 In-Place의 준비 단계 락까지 생략되지는 않습니다. 카카오가 Metadata만 수정하는 In-Place 작업을 디버깅한 결과, 준비 함수에 들어가기 전에 여전히 `MDL_EXCLUSIVE`로 승격했습니다. `mysql_inplace_alter_table()`은 알고리즘에 따라 락을 승격하므로, 데이터 재구축이 없는 작업도 In-Place의 락 동작을 그대로 따릅니다.

변경을 마무리할 때는 다시 접근이 막힙니다. In-Place와 Instant 모두 `MDL_EXCLUSIVE`로 승격한 뒤 `ha_commit_inplace_alter_table()`을 실행하며, 이 함수가 끝날 때까지 다른 세션은 대상 테이블에 접근할 수 없습니다. 준비와 커밋 단계에 락이 필요한 In-Place는 Exclusive Metadata Lock을 두 번, 준비 작업을 생략하는 Instant는 한 번 획득합니다.

`ha_commit_inplace_alter_table()`은 이름 교체에 사용할 임시 이름을 만들고, 통계 수집 스레드의 대상 테이블 접근을 막으며, 원본과 변경된 테이블의 Metadata를 동기화합니다. Instant에서는 `dd_add_instant_columns`가 Metadata의 `row_version` 값을 바꾸고 Default Value를 설정합니다. Data Dictionary 수정과 커밋도 이 함수가 담당하지만, Atomic DDL을 지원하는 엔진에서는 실제 커밋이 Final 단계에서 이뤄집니다.

Final 단계의 처리 순서도 엔진에 따라 다릅니다. Atomic DDL을 지원하면 테이블 이름을 먼저 교체한 뒤 Data Dictionary를 갱신하고 커밋합니다. 지원하지 않으면 Data Dictionary를 갱신한 뒤 이름을 바꿉니다. 마지막으로 사용한 객체와 메모리를 정리하고, `MDL_SHARED_READ`를 획득해 변경된 Metadata를 확인합니다.

## 실행 전에 명시할 ALGORITHM {#practice}

Instant를 선택할 수 없는 작업도 많습니다. 작업이 허용하는 알고리즘을 선택하되, ALTER 문에 `ALGORITHM`을 명시해야 예기치 않게 느린 알고리즘으로 대체되는 일을 막을 수 있습니다. DBA가 예상하지 못한 서비스 장애를 막기 위한 방어적 실행 방식입니다.

실행 전에는 세션에서 오래 수행 중인 트랜잭션과 쿼리를 확인해야 합니다. 어떤 DDL이든 짧게라도 Exclusive Metadata Lock을 획득하므로, ALTER 작업 시 장시간 실행되는 트랜잭션이 없어야 합니다.
