---
title: "MySQL InnoDB Redo Log에 모이는 MTR의 기록"
description: "데이터 파일에 아직 쓰지 못한 변경을 InnoDB는 어떻게 복구할까요? 디스크에 먼저 저장한 Redo Log가 복구의 근거가 되며, MySQL 5.7은 세션별 MTR의 기록을 공유 로그 버퍼로 모을 때 Mutex로 충돌을 막습니다."
date: 2026-11-14
weight: 4
---

# MySQL InnoDB Redo Log에 모이는 MTR의 기록 (2025-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [MySQL InnoDB Log에 대한 이해 - (1)](https://tech.kakao.com/posts/721)
- 매체 · 게시일: 카카오 기술블로그 · 2025-08-11
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 데이터 파일보다 먼저 남기는 Redo Log {#redo-log-as-wal}

트랜잭션이 커밋돼도 변경된 Page가 데이터 파일에 모두 반영된 상태는 아닙니다. 데이터 파일 기록은 뒤따르는 작업입니다. 그 전에 인스턴스가 비정상 종료되면, InnoDB는 디스크에 남겨 둔 Redo Log로 아직 반영하지 못한 변경을 다시 적용해 Crash Recovery를 진행합니다.

이 순서가 WAL(Write-Ahead Log)의 바탕입니다. 변경 내용을 로그에 먼저 쓰고 디스크에 순차적으로 기록하며, 로그를 디스크에 동기화한 시점을 트랜잭션 커밋 완료로 봅니다. 실제 데이터 파일에는 백그라운드 프로세스가 나중에 변경을 반영합니다. InnoDB의 Redo Log도 이러한 WAL의 일종입니다.

시리즈의 1편은 Redo Log의 기본 동작과 MySQL 5.7의 구현까지 다룹니다. MySQL 8.0의 성능 개선은 2편으로 이어집니다.

## 여러 MTR로 나뉘는 한 번의 UPDATE {#mtr-in-transaction}

사용자 트랜잭션 하나는 여러 MTR로 나뉩니다. MTR(mini-Transaction)은 단일 Page 또는 소수의 Page 변경을 Redo Log에 기록하는 가장 작은 작업 단위이자 실제 I/O의 최소 단위입니다. 각 MTR에 포함된 변경은 모두 기록되거나 하나도 기록되지 않아 원자성을 지킵니다.

DML을 수행하면 Page를 Buffer Pool에 복사해 그곳에서 변경하고, 변경 내역은 세션별 메모리의 MTR에 기록합니다. UPDATE 쿼리 하나도 데이터 Page의 변경만 남기지는 않습니다. 원문의 그림은 Buffer Pool의 Page 변경을 초록색 MTR로, Undo Tablespace의 Page 변경을 주황색 MTR로, 커밋 관련 정보를 노란색 MTR로 구분합니다.

작업을 MTR로 나누면 여러 내부 작업을 병렬로 진행할 수 있습니다. 기록 방식에도 이점이 있습니다. 논리적인 SQL보다 물리적 변경 단위를 기록하는 편이 Redo Log Record를 간결하게 만들 수 있어, 로그 크기와 Disk I/O를 줄이는 데 도움이 됩니다.

## 기록 모드와 생애 주기를 담은 mtr_t {#mtr}

MySQL 소스에서 MTR을 구현하는 구조체는 `mtr_t`입니다. 세션 메모리의 Heap에서 처음 64byte로 할당받고, 공간이 더 필요하면 Linked List로 연결해 사용합니다. 잠금 정보는 `m_memo`에, MTR 로그는 `m_log`에 담습니다.

MTR마다 기록 범위는 다릅니다. `m_log_mode`는 Redo Log를 남길지, 변경된 dirty page를 Buffer Pool의 Flush List에 추가할지 등을 구분하는 모드입니다.

| 로그 모드 | 동작 |
| --- | --- |
| `MTR_LOG_ALL`(기본) | Redo Log 기록과 dirty page의 Flush List 추가 |
| `MTR_LOG_NONE` | Redo Log 기록과 Flush List 추가 모두 생략 |
| `MTR_LOG_NO_REDO` | Redo Log 기록 없이 dirty page를 Flush List에 추가 |
| `MTR_LOG_SHORT_INSERTS` | 로그 크기를 줄여 사용 |

생애 주기 상태는 `m_state`에 저장합니다. `MTR_STATE_INIT`, `MTR_STATE_ACTIVE`, `MTR_STATE_COMMITTING`, `MTR_STATE_COMMITTED`는 각각 초기 상태, 변경 내용을 작성하는 상태, 커밋을 수행하는 상태, 커밋이 끝난 상태입니다.

MTR은 `start()`로 초기화한 뒤 변경 내용을 기록합니다. `commit()`에서는 그 내용을 Redo Log Buffer로 넘길지 판단하고 모드에 맞게 처리하며, 마지막에 `release_resource()`로 자원을 반환합니다. 사용자 트랜잭션 안에서 이 작은 작업들의 생성과 기록, 종료가 이어집니다.

## 공유 버퍼 앞에서 확보하는 log_sys_mutex {#mysql-57-mutex}

세션별 메모리에 모인 기록의 다음 목적지는 Global Redo Log Buffer입니다. 여러 세션이 함께 쓰는 메모리 영역이므로 쓰기 충돌을 막아야 합니다. MySQL 5.7은 이 작업을 Mutex로 보호합니다.

`mtr.commit()`이 호출되고 커밋 작업이 취소되지 않으면 `execute()`가 실행됩니다. 내부에서는 `prepare_write()`로 기록을 준비하고 작업량을 계산한 뒤, `finish_write()`에서 `memcpy`로 MTR 정보를 복사합니다. 이때 공유 버퍼에 쓰기 전에 확보해야 하는 Mutex가 `log_sys_mutex`입니다.

MTR 정보를 버퍼에 모두 쓴 뒤에는 Mutex를 반환합니다. 이어서 변경된 Page를 Buffer Pool의 Flush List에 추가하고 MTR 자원을 해제합니다. MySQL 5.7은 로그 버퍼 쓰기를 비롯해 자원 경합을 관리해야 하는 단계마다 Mutex를 확보한 뒤 작업합니다.

이 기록은 트랜잭션을 롤백할 때도 이어집니다. 쿼리마다 MTR의 `commit()`을 거쳐 변경이 이미 Redo Log에 저장됐으므로, 이를 되돌리는 변경 역시 Redo Log에 남겨야 합니다. 롤백도 로그를 기록하는 작업입니다.

## 로그를 디스크에 남기는 Flush 주기 {#basic-flow}

Redo Log Buffer에 썼다고 디스크에 저장된 것은 아닙니다. Buffer는 메모리 영역입니다. 기본 크기는 16MB이며 `innodb_log_buffer_size`로 조절합니다. 디스크의 Redo Log File은 기본 2개이고, 개수는 `innodb_log_files_in_group`, 파일 크기는 `innodb_log_file_size`로 바꿉니다.

디스크에 기록할 때도 로그가 먼저입니다. Flush 이벤트나 Buffer Pool의 Checkpoint가 발생하면 Redo Log Buffer의 내용을 Redo Log File에 쓰고, 그 뒤 Flush List의 Page를 데이터 파일에 반영합니다. 이 논리적인 순서는 모든 InnoDB 버전에서 같습니다.

Flush List의 dirty page는 여러 기준에 따라 동기·비동기 방식으로 Flush됩니다. 마지막에 데이터 파일을 기록할 때 호출하는 함수는 `file_io()`입니다. 로그를 남기는 작업과 변경된 Page를 데이터 파일에 쓰는 작업은 이렇게 순서를 지키며 이어집니다.

Flush 주기는 성능과 트랜잭션의 안정성에 영향을 줍니다. 모든 Flush 이벤트를 제어할 수는 없지만, 트랜잭션 처리와 관련된 주기는 `innodb_flush_log_at_trx_commit`으로 조절합니다. 안정성을 우선하면 1로 설정해 커밋마다 디스크에 Flush하고, 성능을 우선하면 0 또는 2를 선택합니다. 이 변수는 내구성과 성능 사이의 균형을 정하는 설정이며, 세부 동작은 이번 1편에서 다루는 범위 밖입니다.
