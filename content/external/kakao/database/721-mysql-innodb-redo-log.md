---
title: "MySQL InnoDB Redo Log와 MTR의 동작 방식 (1편)"
description: "InnoDB Redo Log가 WAL로서 어떻게 동작하는지, 그 최소 단위인 MTR이 무엇인지 정리한 글입니다. 이어서 MySQL 5.7에서 MTR 정보가 Mutex로 보호되며 Global Redo Log Buffer에 전달되는 과정을 설명합니다."
date: 2026-11-14
weight: 4
---

# MySQL InnoDB Redo Log와 MTR의 동작 방식 (1편) (2025-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [MySQL InnoDB Log에 대한 이해 - (1)](https://tech.kakao.com/posts/721)
- 매체 · 게시일: 카카오 기술블로그 · 2025-08-11
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 시리즈 위치와 글의 범위 {#series-scope}

InnoDB Redo Log를 다루는 시리즈의 1편입니다. 이 글은 Redo Log의 목적과 기초 요소, 가장 작은 작업 단위인 MTR(mini-Transaction), 그리고 MySQL 5.7의 동작 방식까지 설명합니다. MySQL 8.0에서 개선된 부분은 2편으로 넘깁니다. 관련 글로는 같은 블로그의 caching_sha2_password 글과 ALTER DDL 글이 걸려 있습니다.

## WAL로서의 Redo Log {#redo-log-as-wal}

InnoDB는 트랜잭션의 무결성과 영속성을 지키려고 Redo Log를 만들어 관리합니다. 원문은 Redo Log를 WAL(Write-Ahead Log)의 일종으로 보고, WAL이 갖춰야 할 네 가지를 듭니다.

- 데이터를 바꿀 때 WAL에 먼저 쓰고, 이어서 디스크에 순차적으로 기록한다.
- WAL에 쓰고 디스크에 동기화된 시점을 트랜잭션 커밋 완료로 본다.
- WAL의 변경 사항은 백그라운드 프로세스가 나중에 실제 데이터 파일에 반영한다.
- 인스턴스가 비정상 종료되면 WAL로 Crash Recovery를 하고, 데이터 파일에 아직 쓰지 못한 변경을 다시 적용한다.

원문은 Redo Log 동작을 이해하면 InnoDB 전반을 이해하는 데 도움이 된다고 말합니다.

## Redo Log의 구성과 기본 흐름 {#basic-flow}

Redo Log는 메모리의 Log Buffer와 디스크의 Log File로 이루어집니다. Log Buffer는 기본 16MB이고 `innodb_log_buffer_size`로 바꿉니다. Log File은 기본 2개이며 `innodb_log_files_in_group`으로 개수를, `innodb_log_file_size`로 크기를 바꿀 수 있습니다.

트랜잭션 하나가 지나가는 순서는 이렇습니다. DML로 Page가 바뀌면 Buffer Pool에 Page가 복사되어 거기서 변경이 일어납니다. 변경 내용은 MTR 단위로 세션별 메모리에 기록되고, MTR이 commit되면 Redo Log Buffer로 옮겨집니다. 변경된 Page는 Buffer Pool의 Flush List에 올라갑니다. Flush 이벤트나 Checkpoint가 오면 Log Buffer 내용이 Log File에 먼저 쓰이고, 그 뒤에 Flush List의 Page가 데이터 파일로 내려갑니다. 이 논리적 순서는 모든 InnoDB 버전에서 같습니다.

Flush 주기는 MySQL 성능에 큰 영향을 주는 요소입니다. 모든 Flush 이벤트를 제어할 수는 없지만, 트랜잭션 처리에 관해서는 `innodb_flush_log_at_trx_commit`으로 조절합니다. 안정성이 중요하면 1로 두어 커밋마다 디스크에 반영하고, 성능이 중요하면 0 또는 2를 고릅니다. 원문은 이 변수를 따로 공부해 보라고 권하고 자세한 설명은 생략합니다.

## MTR, Redo Log의 최소 작업 단위 {#mtr}

MTR은 단일 Page 또는 소수의 Page에 대한 변경을 Redo Log에 기록하는 가장 작은 단위이자 I/O의 최소 단위입니다. 사용자가 만든 트랜잭션 하나는 여러 MTR로 쪼개져 처리됩니다. MTR은 원자적이라서 포함된 변경이 모두 기록되거나 하나도 기록되지 않습니다. MTR도 WAL처럼 Redo Log Buffer에 먼저 쓰고 스케줄에 따라 Log File으로 Flush합니다.

원문이 꼽은 효과는 두 가지입니다. 트랜잭션을 MTR로 나누면 내부 작업을 동시에 진행할 수 있어 성능이 좋아집니다. 또 MTR은 논리적 SQL이 아니라 물리적 변경 단위로 기록하므로 Redo Log Record가 간결해지고 Disk I/O가 줄어듭니다.

MySQL 소스에서는 `mtr_t` 구조체로 구현됩니다. 잠금 정보를 담는 `m_memo`, MTR 로그를 담는 `m_log`, 로그 모드 `m_log_mode`, 생애 주기 상태 `m_state` 등이 들어 있습니다.

- 로그 모드는 `MTR_LOG_ALL`(기본), `MTR_LOG_NONE`, `MTR_LOG_NO_REDO`, `MTR_LOG_SHORT_INSERTS`입니다.
- 상태는 `MTR_STATE_INIT`, `ACTIVE`, `COMMITTING`, `COMMITTED` 네 가지입니다.

구조체는 세션 메모리의 Heap에 처음 64byte로 할당되고, 모자라면 Linked List로 이어 붙입니다. 생애 주기는 `start()`로 초기화하고, `commit()`으로 내용을 Redo Log Buffer에 넘길지 판단해 처리하고, `release_resource()`로 자원을 반환하며 끝납니다. `commit()`이 취소되지 않으면 `execute()`가 호출되어 `prepare_write()`로 기록을 준비하고 작업량을 계산한 뒤 `finish_write()`로 MTR 정보를 memcpy로 복사합니다.

## 트랜잭션 안에서 MTR이 쓰이는 방식 {#mtr-in-transaction}

UPDATE 쿼리 하나를 실행하면 MTR은 세 종류로 만들어집니다. Buffer Pool의 Page 변경을 담는 MTR, Undo Tablespace의 Page 변경을 담는 MTR, 커밋 관련 정보를 담는 MTR입니다. 작업량이 많으면 MTR을 더 만들어 Linked List로 잇습니다. 쿼리가 끝나면 `mtr.commit()`이 내용을 Redo Log Buffer로 넘기고 dirty page를 Flush List에 올린 뒤, `release_resource()`로 자원을 풉니다.

원문은 번외로 두 가지를 덧붙입니다. Flush List의 dirty page는 동기·비동기 방식으로 Flush되며 마지막에 `file_io()`로 데이터 파일에 쓰입니다. 롤백도 쿼리마다 MTR이 만들어져 Redo Log에 남기 때문에, 되돌리는 변경 역시 Redo Log로 저장되어야 합니다.

## MySQL 5.7의 Mutex 기반 동작 {#mysql-57-mutex}

5.7의 Redo Log는 한마디로 Mutex 기반입니다. `mtr.commit()`이 호출되면 먼저 Redo Log Buffer 쓰기용 Mutex(`log_sys_mutex`)를 잡고, MTR 정보를 Global Redo Log Buffer에 쓴 다음 Mutex를 풉니다. 그 뒤에 변경된 Page를 Flush List에 추가하고 자원을 해제합니다. 여러 세션의 쓰기가 서로 부딪히지 않게 하려는 장치입니다.

트랜잭션 전체로 보면 세 단계입니다. MTR의 변경을 Redo Log Buffer로 전달하고, dirty page를 Flush List에 추가하고, Log Buffer의 내용을 Log File에 쓰는 것입니다. 자원 경합을 관리해야 하는 단계마다 Mutex로 자원을 잡고 작업합니다. Log File에 쓰는 시점은 앞서 설명한 Flush 주기를 따릅니다.

원문은 이 글이 5.7의 로직까지 정리했고, 8.0의 성능 개선은 2편에서 다룬다고 맺습니다.
