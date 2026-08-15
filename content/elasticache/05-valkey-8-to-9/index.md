---
title: "Valkey 8.0 → 9.1 — 엔진이 갈라진 지점"
weight: 5
---

# 05 · Valkey 8.0 → 9.1 — 엔진이 갈라진 지점

{{< callout type="info" >}}
**한눈에**
- **Valkey 는 이름만 바꾼 Redis 7.2 가 아니다.** 8.0 에서 네트워크 스레딩(`src/io_threads.c` 신설)과 full sync 프로토콜(`capa dual-channel`)이, 8.1 에서 키 저장 자료구조(`src/hashtable.c` 신설)가 교체됐다. Redis 는 8.10.0 트리에도 `hashtable.c` 가 **없다** — `dict.c` + `no_value=1` 이다 `✓`.
- **8.0 의 async I/O 스레딩은 6.0 threaded I/O 를 통째로 교체한 결과다.** lock-free ring buffer(잡 2048개 고정) 기반 비동기 잡 큐로 바뀌고, read/parse/write 를 넘어 **poll-wait · command lookup · 메모리 free** 까지 워커로 넘어갔다 `✓`.
- **그래도 기본값은 `io-threads 1`(비활성)이다.** 8.0/8.1 에서는 `IMMUTABLE_CONFIG` 라 재시작 없이 켤 수도 없고, 런타임 변경은 **9.0 부터**다 `✓`. "올렸는데 안 빨라진다"의 1차 원인이 이것이다.
- **dual channel replication 은 기본 `no`** 다(8.0·8.1 모두). Redis 의 대응물 `repl-rdb-channel` 은 기본 on 이고 **와이어 문자열이 달라 서로 붙지 않는다** — Redis primary ↔ Valkey replica 를 섞으면 이 경로는 조용히 레거시 단일 채널로 폴백한다 `✓`.
- **8.1 은 재시작만으로 키당 20~30바이트를 회수한다.** 64바이트(= 캐시라인 1개) 버킷에 엔트리 7개를 담는 새 hashtable 로 `kvstore` 백엔드를 갈아끼웠다. 설정 변경이 없는 순수 이득이지만 `MEMORY USAGE`·`INFO memory` 절대값이 바뀌므로 알림 임계값 재보정이 필요하다 `✓`.
- **RDB 포맷은 9.0 에서 영구히 갈라졌다** — `RDB_VERSION 11` → **80**, magic `REDIS0011` → **`VALKEY080`**. 12~79 는 Redis 비-OSS 포맷용으로 **예약해 거부**한다. Redis **7.4 이상에서 만든 RDB·DUMP 페이로드는 Valkey 가 받지 않고, 우회 방법이 없다** `✓`.
- **9.0 은 breaking change 섹션이 없는 major 다.** 커맨드 제거 0건, 설정 제거 0건, behavior change 3건. 오히려 25개 커맨드의 deprecation 을 되돌렸다. 실질적 breaking 은 RDB 버전 하나다 `✓`.
- **2026-07-21 의 7.2.14 / 8.0.10 / 8.1.9 / 9.0.5 / 9.1.1 동시 릴리스는 보안 릴리스다** — CVE-2026-56684(TLS use-after-free, CVSS 7.5) · CVE-2026-63639(stream PEL use-after-free, CVSS 8.8, **모든 버전 영향**) `✓`.
{{< /callout >}}

> **왜 이 문서인가.** "Valkey = 리브랜딩된 Redis 7.2" 를 전제로 깔면 튜닝 가이드·모니터링 쿼리·마이그레이션 계획이 전부 어긋난다. 스레드 수를 올려도 안 빨라지고, 빠른 full sync 는 켜지지 않고, Redis 7.4 에서 뜬 RDB 를 올리면 `Can't handle RDB format version 12` 로 거절당한다. 이 문서는 그 어긋남을 **설정 이름·기본값·소스 경로**로 확정한다.

> 근거 기준: 로컬 blobless 클론 `~/evejuni/valkey`·`~/evejuni/redis` 의 태그별 소스(`git show <tag>:<path>`), 각 릴리스의 `RELEASENOTES-*.txt`, GitHub PR·릴리스·security advisory, valkey.io 공식 문서·블로그. **릴리스일은 GitHub `published_at`** 기준이며 기준일은 2026-08-05 다. 성능 수치는 발행 주체가 프로젝트 자신이므로 전부 `Ⓥ` 로 표기하고 측정 조건을 병기한다.

## 1. 한눈에 — 네 릴리스가 각각 무엇을 갈라놨나

| 버전 | 릴리스 | 엔진에서 갈라진 축 | RDB / magic |
|---|---|---|---|
| **8.0.0** | 2024-09-15 | 네트워크 스레딩 **교체**(비동기 잡 큐) · full sync 프로토콜 분기(dual channel) · 키를 dict entry 에 임베딩 | 11 / `REDIS0011` |
| **8.1.0** | 2025-03-31 | `dict` → **캐시라인 버킷 hashtable 전면 교체** · RDMA builtin · `COMMANDLOG` · CMake 도입 | 11 / `REDIS0011` (12~79 foreign 예약) |
| **9.0.0** | **2025-10-21** (태그 2025-10-16) | cluster 모드 numbered database · hash field expiration · atomic slot migration · **RDB 포맷 영구 분기** | **80 / `VALKEY080`** |
| **9.1.0** | 2026-05-19 | DB 단위 ACL · Lua 를 모듈로 분리 · I/O 스레드 통신 모델 재설계(lock-free queue) | 80 / `VALKEY080` |

마이그레이션 호환성은 한 줄로 끝납니다 — **Redis 7.2.x 이하에서만 RDB·복제로 넘어올 수 있고, Redis 7.4 이상과 Valkey 9.x → 8.x 는 소스 레벨에서 막혀 있습니다** `✓`. 상세는 §9.

버전 번호를 읽는 규칙도 진영별로 반대입니다. **Valkey 는 홀수 마이너(8.1, 9.1)를 정식 GA 로 씁니다** — Redis 의 홀수 마이너는 프리릴리스 전용 번호입니다([04 · Redis 7.0 → 8.10]({{< relref "../04-redis-7-to-8.md" >}})) `✓`. "Redis 9" 를 찾는 사람은 사실 Valkey 9 를 보고 있습니다.

## 2. 포크 직후의 선택 — 7.2.4 에서 무엇을 먼저 손댔나

Valkey 리포의 `7.2.4` 태그는 Redis 7.2.4 히스토리를 그대로 승계한 지점입니다. 라이선스 변경 커밋·거버넌스·Linux Foundation 발표의 시간선은 [03 · 왜 찢어졌나]({{< relref "../03-license-and-fork.md" >}}) 가 소유합니다. 여기서 볼 것은 **그 다음 5개월 동안 무엇을 먼저 건드렸는가**입니다.

| 머지 | 대상 | 무엇 |
|---|---|---|
| 2024-07-02 | `src/dict.c` | `dictEntryEmbedded` — 키를 dict entry 에 인라인 (#541) |
| 2024-07-09 | **`src/io_threads.c` 신설** | 비동기 I/O 스레드 (#758) |
| 2024-07-15 | **`src/rdma.c` 신설** | Valkey Over RDMA, 모듈 전용·experimental (#477) |
| 2024-07-17 | `src/replication.c` | dual channel replication (#60) |
| 2024-07-19 | `src/io_threads.c` | poll · command lookup · free 오프로드 (#763) |
| 2024-08-27 | **`src/memory_prefetch.c` 신설** | Memory Access Amortization (#861) |
| 2024-11-18 | **`src/hashtable.c` 최초 커밋** | 8.1 로 가는 자료구조 교체의 시작 (`c8ee5c2c`) |

리브랜딩 커밋(`pidfile` `redis.pid` → `valkey.pid`, `syslog-ident`, 에러 메시지의 "Redis" 제거)도 같은 기간에 들어갔지만 **신설 파일 4개가 전부 성능·전송 계층**입니다 `✓`. 이 선택이 이후 2년의 분기를 결정했습니다.

호환성 쪽으로는 반대 방향의 스위치가 하나 있습니다. `extended-redis-compatibility` — Valkey 가 자신을 "Redis" 로 보고하게 만드는 임시 노브입니다. 8.1 의 `valkey.conf` 는 "9.0 에서 무효화, 10.0 에서 제거" 를 예고했지만 **그 예고는 실행되지 않았습니다** — 9.0 의 conf 에서 문구가 "will be removed in a future version" 으로 완화되고 9.1.1 의 `config.c:3320` 에도 `MODIFIABLE_CONFIG` 로 살아 있습니다 `✓`. 이 스위치에 의존하는 툴은 여전히 시한폭탄입니다.

## 3. 8.0 (2024-09-15) — 스레딩·복제·메모리가 한 릴리스에서 갈라진다

### 3.1 비동기 I/O 스레딩 — 6.0 방식의 개선이 아니라 교체

Redis 6.0 threaded I/O 가 어디까지만 했고 왜 "안 켜는 게 낫다" 가 상식이 됐는지는 [01 · 2009 첫 커밋부터 6.2 까지]({{< relref "../01-origins-and-design/index.md" >}}) 가 소유합니다. 8.0 이 바꾼 것만 봅니다.

| 축 | Valkey 8.0 이 바꾼 것 | 그래서 |
|---|---|---|
| 메인↔워커 통신 | 단방향 **lock-free static ring buffer**(잡 2048개 고정). 큐가 차면 메인이 직접 처리 | 동기 배리어 소멸. 큐 포화 자체가 backpressure |
| 잡 포맷 | `[void* callback \| void* data]` | I/O 가 아닌 임의 작업도 워커로 보낼 수 있는 통로 |
| 워커가 만지는 범위 | client struct 의 **필요한 필드만**. 통계·에러·파싱 오류·reply 해제는 메인 | 락 없이 성립하는 불변식 |
| 클라이언트 배정 | `c->id % num_of_threads` **고정 바인딩** | 같은 클라이언트가 두 스레드에 동시 배정되는 일이 구조적으로 불가 → **TLS + I/O threads 조합이 지원된다** |
| 활성화 | pending 클라이언트 수에 비례한 부분 활성(기존은 all-or-nothing) | idle busy-wait 감소 |

세 번째로 넘긴 작업이 이 릴리스의 성격을 말합니다. PR #763 이 추가한 것은 셋입니다. **poll offload** — `aeEventLoop` 에 `custompoll` 콜백을 신설했고, PR 본문은 poll-wait 가 메인 스레드 시간의 최대 30% 를 먹는다고 측정했습니다. **command lookup offload** — 워커가 파싱하면서 커맨드 dict 조회까지 하고 `c->io_parsed_cmd` 에 넣습니다. 메인 런타임의 약 5% 입니다. **free offload** — argv 를 할당한 스레드에게 되돌려 free 시킵니다. 근거는 jemalloc 의 thread-local `tcache` 입니다 `✓`. 이름은 "I/O 스레드" 인데 하는 일은 이미 I/O 가 아닙니다.

PR #861 은 그 결과로 드러난 새 병목을 잡습니다. async I/O 도입 후 `lookupKey` 가 메인 스레드 시간의 약 50%(SET 기준)를 차지하게 됐고, 해법은 배치 prefetch 입니다 — 실행 준비된 커맨드를 최대 16개 모아 argv → dict entry → value 순으로 prefetch 한 뒤 실행합니다(`prefetch-batch-max-size`, 기본 16, 0 이면 비활성, 최대 128) `✓`. **이 최적화는 배치를 I/O 스레드가 만들어주므로 `io-threads` 를 켜지 않으면 사실상 작동하지 않습니다.**

설정으로 정리하면 이렇습니다.

| 설정 | 기본값 | 성격 | 주의 |
|---|---|---|---|
| `io-threads` | **1 = 비활성** | 8.0/8.1 `IMMUTABLE_CONFIG`, **9.0 부터 `MODIFIABLE`**(#2033) | 상한 128(8.0) → **256**(8.1). Redis 는 8.10.0 까지 IMMUTABLE·상한 128 |
| `prefetch-batch-max-size` | 16 | 0 = 비활성, 최대 128 | `io-threads` 가 꺼져 있으면 무의미 |
| `events-per-io-thread` | 2 | 8.1 에서 `HIDDEN_CONFIG` → **9.1 에서 deprecated 목록으로** | 튜닝 노브로 만든 게 아니다. 설정 파일에 남아 있으면 조용히 무시된다 |
| `io-threads-do-reads` | — | **8.1 에서 deprecated** | 새 구현은 항상 read 를 한다. 값을 주면 무시 |

공식 수치는 **360K → 1.19M rps, 평균 레이턴시 1.792ms → 0.542ms(-69.8%)** 습니다 `Ⓥ`. 측정 조건은 **AWS EC2 c7g.16xlarge(64 vCPU) · `io-threads 8` · 3M keys · value 512바이트 · 650 clients · sequential SET** 입니다. 블로그가 스스로 "these numbers include the Prefetch change" 라고 밝히므로 이 값은 #758 + #763 + #861 **합산치**이며 I/O 스레딩 단독 효과가 아닙니다. 파이프라인 깊이는 어떤 1차 출처에도 없습니다 `?`. 4 vCPU 인스턴스에서 재현되는 숫자가 아니고, `valkey.conf` 가 직접 경고하듯 벤치마크 클라이언트도 `--threads` 로 맞춰야 합니다.

같은 문제에 Redis 8.0 은 **다른 답**을 냈습니다. 두 구현의 튜닝 가이드는 서로 통하지 않습니다 `✓`.

| | Valkey 8.0 `src/io_threads.c` | Redis 8.0 `src/iothread.c` |
|---|---|---|
| 이벤트 루프 | 메인만 보유, poll 을 단발 잡으로 위임 | **각 I/O 스레드가 독립 event loop** |
| 통신 | lock-free 고정 ring buffer(2048), 단방향 | 양방향 큐 + `pthread_mutex` + `eventfd`/`pipe` |
| 워커의 커맨드 lookup | **한다** | 하지 않음 |
| prefetch 배치 · free offload | 8.0 부터 | **8.2 부터**(#14017, #13968) |
| 클라이언트 배정 | `c->id % num_threads` 고정 | 클라이언트 수 최소인 스레드에 동적 배정 |
| 관측 | `io_threads_active` **불리언 하나** | `INFO Threads` per-thread + `CLIENT LIST io-thread=N` |

관측성은 Redis 쪽이 낫습니다. Valkey 에서는 스레드별 부하 편중을 서버에서 볼 수 없습니다 — 9.1 이 active IO threads / main thread 사용률 누적 metric(#2463, #2931)을 붙이면서 겨우 완화됩니다 `✓`.

### 3.2 dual channel replication — 무엇이 아팠고, 그 아픔을 어디로 옮겼나

full sync 중 primary 는 RDB 를 보내는 동안 들어오는 쓰기를 **replica 별 client output buffer(COB)** 에 쌓습니다. RDB 전송이 길어지면 두 가지가 동시에 나빠집니다 — primary 메모리가 그만큼 부담을 받고, COB 가 `client-output-buffer-limit replica` 하드 리밋을 넘으면 primary 가 **replica 연결을 끊어서 복제 자체가 실패**합니다. 큰 데이터셋에서 full sync 가 반복 실패하는 고전적 실패 모드가 이것입니다 `✓`.

{{< seq src="_seq/3-2-dual-channel-replication.json" />}}

부수 효과가 성능의 실체입니다. 기존에는 TLS 제약 때문에 bgsave 자식이 RDB 바이트를 **파이프로 메인 프로세스에 넘기고 메인이 소켓에 다시 써야** 했습니다. 전용 커넥션이 생기면서 자식이 소켓에 직접 쓰게 되고, primary 메인 프로세스의 CPU 가 그만큼 풀립니다 `✓`. PR #60 자체 측정은 이렇습니다 `Ⓥ` — primary/replica 같은 머신, RDB 3.7GB, `valkey-benchmark -r 100000 -n 6000000 lpush my_list __rand_int__`. 클라이언트 50개 이하 경량 커맨드에서 sync 중 write 레이턴시 **5~7.5% 개선**, primary 가 `sdiff`/`sunion` 같은 무거운 읽기를 처리하는 상황에서는 **sync 시간 약 50% 단축**과 그에 따른 복제 diff 저장 메모리 **일부 케이스 60%+ 감소**. 즉 이 기능은 "복제가 빨라진다" 가 아니라 **"바쁜 primary 에서 full sync 가 덜 망가진다"** 쪽입니다.

켜기 전에 알아야 할 제약이 넷입니다.

| 항목 | 사실 |
|---|---|
| `dual-channel-replication-enabled` | **기본 `no`**(8.0·8.1 모두). 8.0.0-rc2 에서 제거된 것은 protected 플래그이고 기본값이 아니다 `✓` |
| `repl-diskless-sync` | primary 에 켜져 있어야 의미가 있다(기본 `yes`). 이 요구사항은 8.0/8.1 시점 `valkey.conf` 에 **없었고** 2026-01-19 커밋 `9735bac6` 에서야 문서화됐다 `✓` |
| replica 로컬 버퍼 상한 | **전용 config 가 없다.** `client-output-buffer-limit replica` 하드 리밋을 재사용하고, 초과하면 실패가 아니라 읽기 핸들러를 떼서 버퍼링을 멈춘다. 그 이후 누적은 **primary COB 로 되돌아가므로 결국 끊길 수 있다** `✓` |
| 적용 시점 | 켜고 끄는 것이 진행 중인 sync 에는 영향이 없다 — 다음 sync 부터 `✓` |

세 번째가 핵심 함정입니다. Redis 는 같은 자리에 전용 리밋 `replica-full-sync-buffer-limit` 을 뒀습니다 — 이 항목만은 Redis 쪽 설계가 낫습니다 `Σ`. 두 진영의 와이어도 다릅니다.

| | Valkey 8.0/8.1 | Redis 8.0+ |
|---|---|---|
| REPLCONF capa | `dual-channel` | `rdb-channel-repl` |
| primary 응답 | `+DUALCHANNELSYNC` | `+RDBCHANNELSYNC <client-id>` |
| 기본 활성 | **no** | **yes**(hidden config) |
| replica 버퍼 리밋 | 전용 config 없음 | `replica-full-sync-buffer-limit` |
| INFO 지표 | `replicas_repl_buffer_size` / `_peak` | `replica_full_sync_buffer_size` / `_peak` |
| replica state 표기 | slaveN 라인의 `type=rdb-channel` / `main-channel` | `state=send_bulk_and_stream` |

Redis PR #13732 "Rdb channel replication" 은 본문 첫 줄에 `valkey-io/valkey#60` 을 명시 참조합니다 — 설계를 가져다 재구현했지만 **capa 문자열이 서로에게 unrecognized 라 섞으면 조용히 레거시 단일 채널로 폴백**합니다 `✓`. 모니터링 대시보드·알림 쿼리도 필드명이 달라 진영을 옮기면 재작성해야 합니다.

### 3.3 메모리 효율 — 절감의 3분의 2는 Valkey 고유 기여가 아니다

8.0 의 절감은 두 층입니다. 공식 블로그 측정 조건은 **1 primary + 2 replica 단일 샤드, `valkey-benchmark` 로 만든 6,318,941 키, value 16바이트**입니다 `Ⓥ`.

| 층 | 무엇 | 수치 | 출신 |
|---|---|---|---|
| per-slot kvstore | 슬롯 소속 추적용 `slot-prev`/`slot-next` 포인터 **16바이트/엔트리 제거**. 엔트리당 오버헤드 40 → 24바이트 | 693.64MB → 598.77MB (**-13.68%**) | **포크 이전 공통 조상** |
| 키 임베딩 | `dictEntryEmbedded` — 키 포인터 8바이트를 없애고 bookkeeping 1바이트를 쓴다 | 598.77MB → 550.56MB (**-8.05%**) | Valkey #541 |
| 합계 | 7.2 → 8.0 업그레이드 시 노드당 | **약 -20.63%** | |

첫 행에 함정이 있습니다. `src/kvstore.c` 는 커밋 `8cd62f82`(2024-02-05, Redis #12822 "Refactor the per-slot dict-array db.c into a new kvstore data structure")에서 생겼고 이건 **포크 이전 Redis unstable 커밋**입니다 — `git merge-base --is-ancestor` 로 valkey 8.0.0 과 redis 7.4.0 **양쪽의 조상**임이 확인됩니다 `✓`. Valkey 8.0 릴리스노트도 이 항목을 `Redis#12822` 로 표기합니다. "Valkey 가 per-slot dict 로 클러스터 메모리를 줄였다" 는 서술은 절반만 맞습니다.

**엔진 측에서 per-slot 으로 쪼갠 이유**는 세 가지입니다 — 슬롯 소속 추적 연결리스트를 자료구조 자체로 대체해 엔트리당 16바이트를 없애고, 슬롯 단위 순회를 O(슬롯 크기)로 만들고, 해시 태그가 단일 슬롯을 함의하는 `KEYS`/`SCAN` 을 그 슬롯만 훑게 합니다. 대가는 노드당 약 1MB 의 Binary Indexed Tree(슬롯별 키 개수 누적합)입니다 `✓`. 그리고 이 16바이트 절감은 **cluster mode 에서만** 발생합니다 — standalone 에서 8.0 으로 올리면서 -20% 를 기대하면 틀립니다 `Σ`. **cluster 운영에서 무엇이 달라지는지는** [06 · cluster mode]({{< relref "../06-cluster-mode/index.md" >}}) 가 소유합니다.

Redis 도 같은 목표로 수렴했습니다. PR #13806 은 본문에 "This PR adopts Valkey's packing layout and logic for key, value, and TTL" 를 명시하고 `kvobj` 를 도입했습니다(8.2, 1M keys 77.34M→59.87M · 10M keys 883.98M→624.07M, 약 -29% `Ⓥ` 로컬 랩톱). **다만 hashtable 은 갈아끼우지 않았습니다** — 같은 PR 본문이 open addressing POC 를 해보고 `dict` + `no_value=1` 이 더 나은 균형이었다고 적습니다 `✓`. 이 갈림이 8.1 에서 결정적으로 벌어집니다.

## 4. 8.1 (2025-03-31) — dict 를 버린 릴리스

### 4.1 새 hashtable

PR #1186 은 `src/hashtable.c` 를 새로 써서 `src/dict.c`(chained hash)를 대체하고 `kvstore` 의 백엔드를 통째로 옮겼습니다. 버킷이 **정확히 64바이트 = 캐시라인 1개**입니다 — `presence` 비트 7개 + 해시 상위 1바이트 7개 + 엔트리 포인터 7개 `✓`(`valkey 8.1.0:src/hashtable.h:91` 의 `#define HASHTABLE_BUCKET_SIZE 64`, `src/hashtable.c:275-283` 의 `bucket` 구조체 + `static_assert`).

| 설계 결정 | 내용 |
|---|---|
| 버킷당 엔트리 | **7개, 순서 없음.** 조회 시 해시 1바이트로 false positive 를 걸러낸 뒤 실제 키 비교 → **캐시라인 1번 로드로 7개 후보 판정** |
| 충돌 해결 | **bucket chaining** — 꽉 찬 버킷의 마지막 엔트리 슬롯을 child bucket 포인터로 대체. 최초 설계(#169)는 probing 이었으나 머지 전에 변경됐다 |
| fill factor | soft max 100% / hard max 500% / soft min 13% / hard min 3%. 확장 시 최대 fill 91.43% |
| 리사이즈 정책 | `ALLOW` / `AVOID`(fork 중 — CoW 보호, insert 에서만 rehash step) / `FORBID`(자식 프로세스) |
| 엔트리 = 값 객체 | keyspace 엔트리가 `serverObject`(= `robj`) 자체다. 키와 옵션 expire 를 객체에 임베딩(`hasexpire:1`, `hasembkey:1` 비트 신설) → **dictEntry 라는 중간 할당이 완전히 사라진다** |

절감은 PR 본문 "roughly 20 bytes per key for short string keys", 공식 블로그는 **TTL 없는 key-value 당 약 20바이트, TTL 있으면 최대 30바이트**입니다 `Ⓥ`. 적용 범위는 keyspace + expires(#1186) → hash(#1502) → set(#1176) → sorted set(#1427) → command lookup 이고, 소스로는 `valkey 8.1.0:src/kvstore.h` 가 `#include "hashtable.h"` 로 바뀌고 모든 API 가 `kvstoreDict*` → `kvstoreHashtable*` 로 개명된 것이 확인됩니다 `✓`.

공식 8.1 GA 블로그의 성능 주장은 항목이 많습니다 `Ⓥ` — 파이프라인 처리량 8.0 대비 약 +10%, iterator prefetch 로 키 순회 3.5배, `ZRANK` +45%, `PFMERGE`/`PFCOUNT` 12배, `BITCOUNT` 최대 +514%, TLS full sync +18%, fork CoW 오버헤드 -47%, TLS 연결 수락률 +300%, `SET` +10% / `GET` +22%. **각 항목의 인스턴스·데이터셋 조건이 개별 공개되지 않았습니다** `?`. 그리고 `PFMERGE`/`PFCOUNT` 는 AVX, `BITCOUNT` 는 AVX2 의존이므로 **Graviton 같은 ARM 에서는 이 수치가 나오지 않을 가능성이 큽니다** `≈` — Graviton 인스턴스로 표준화한 환경이라면 이 두 항목은 계획에서 빼는 게 맞습니다.

운영 관점의 결론은 단순합니다. 8.0 → 8.1 은 **설정 변경 없이 재시작만으로 키당 20~30바이트를 회수**하는 업그레이드입니다. 대신 `MEMORY USAGE`·`INFO memory` 의 오버헤드 항목 절대값이 바뀌므로 메모리 알림 임계값을 재보정해야 합니다 `Σ`.

hash 타입도 별도로 최적화됐습니다 — PR #1579 는 hashtable-encoded hash 에서 field 와 value 를 2단 레이아웃으로 저장합니다. 합쳐서 128바이트 이하면 **한 번의 할당에 임베딩**하고, 더 크면 value 만 따로 할당합니다. 레이아웃 구분은 sds 헤더의 미사용 비트에 인코딩합니다 `✓`.

### 4.2 RDMA 의 실제 상태

| 항목 | 8.0.0 | 8.1.0 |
|---|---|---|
| 빌드 | `BUILD_RDMA=module\|no` 만 허용. `yes` 를 주면 Makefile 이 에러로 막는다 — **built-in 불가** | **`BUILD_RDMA=yes` builtin 지원**(#1209). 모듈 방식도 병행 |
| 설정 | 모듈 파라미터 `rdma.port` / `rdma.bind` | `valkey.conf` 정식 directive `rdma-port` / `rdma-bind` / `rdma-rx-size`(64K~16M, 기본 1M) / `rdma-completion-vector` |
| 테스트 | — | TCL 이 RDMA 를 못 다뤄 별도 C 하네스. `runtest-rdma` = `./tests/rdma/run.py`. CI 는 커널 RXE(soft RDMA) |
| 상태 | experimental | **여전히 experimental** — `valkey 8.1.0:valkey.conf:305` 가 "it may be changed or be removed in any minor or major version" 을 명시 |

성능 주장은 8.0 RC1 블로그의 처리량 **최대 +275%** 하나인데 **테스트 조건이 명시되지 않았습니다**(하드웨어인지 RXE 에뮬레이션인지, 페이로드도 없습니다) `Ⓥ`/`?`. conf 가 스스로 "언제든 제거 가능" 이라 적은 기능이므로 프로덕션 전제로 삼을 수 없습니다.

의미는 성능보다 구조에 있습니다. **Redis 8.10.0 트리에는 `rdma.c` 가 없습니다** `✓`. PR #1209 는 `bind` 설정 추상화와 `closeListener` 커넥션 타입 메서드를 새로 도입하며 본문에 "Even for QUIC in the future" 를 적습니다 — 두 진영의 커넥션 추상화 계층이 다르게 진화했다는 뜻입니다.

### 4.3 8.1 의 그 외 — 리브랜딩이 아니라 재구조화

`src/` 파일 목록 diff 가 성격을 드러냅니다 `✓`.

- **추가**: `CMakeLists.txt`(#1196 — **CMake 는 9.0 이 아니라 8.1 부터다**), `allocator_defrag.c/.h`(#1242 active defrag 재작성, `active-defrag-cycle-us` 기본 500us 신설), `commandlog.c/.h`, `hashtable.c/.h`, `scripting_engine.c/.h`(#1277·#1497 — 스크립팅 엔진을 모듈로 만드는 길의 시작), `valkey_strtod.h`, `lua/`
- **제거**: `slowlog.c/.h`(→ `commandlog`), `script_lua.c/.h`(→ `lua/`), `function_lua.c`, `atomicvar.h`(C11 `_Atomics` 로 교체)

`COMMANDLOG`(#1294)는 slowlog 의 일반화입니다 — slow execution + **large request** + **large reply** 3종. `slowlog-max-len`/`slowlog-log-slower-than` 은 `commandlog-slow-execution-max-len`/`commandlog-execution-slower-than` 의 별칭으로 남고, 신설 임계값 `commandlog-request-larger-than`·`commandlog-reply-larger-than`(둘 다 기본 1MB)과 `commandlog-large-request-max-len`·`commandlog-large-reply-max-len`(둘 다 기본 128)이 붙습니다 `✓`. Redis 에는 대응물이 없습니다.

마이그레이션 도구를 위한 장치도 8.1 입니다. `import-mode yes` + `CLIENT IMPORT-SOURCE ON`(#1185)은 redis-shake 같은 동기 툴을 쓸 때 destination 에서 expire/evict 가 데이터를 깨뜨리는 문제를 막습니다 — import-source 로 표시한 클라이언트의 커맨드만 예외 처리하고 그 외의 만료·축출을 정지시킵니다 `✓`. §9 에서 다시 씁니다.

기본값·동작 변경 중 운영에 걸리는 것들. 실제로 가장 흔한 경로가 7.2 에서 8.1 로 한 번에 올리는 것이므로 8.0 항목을 함께 놓고 **각 행에 도입 릴리스를 붙입니다** `✓`.

| 항목 | 변경 | 대가 |
|---|---|---|
| `repl-backlog-size` | 1MB → **10MB**(8.0.0-rc2, #911). Redis 는 8.10.0 까지 1MB | partial resync 성공률이 올라가는 대신 **노드당 상시 10MB 추가** |
| TCP_NODELAY | 8.1 부터 엔진이 개시하는 cluster·replication 커넥션에 활성(#1763) | 지연 감소 ↔ 소패킷 증가 |
| `hide-user-data-from-log` | **8.0** 부터 기본 **`yes`**(`valkey 8.0.0:src/config.c:3109` — Redis 는 8.10.0 도 기본 `no`). 8.1 에서 프로토콜 에러 시 입력 버퍼까지 확장(#1889) | 크래시 리포트에서 데이터가 가려진다 — 디버깅 시 일시적으로 꺼야 할 수 있다 |
| `MULTI` | **8.0** 부터 중첩 `MULTI` 또는 `MULTI` 안의 `WATCH` 가 **트랜잭션을 abort**(#723). 7.2 는 에러만 반환 | 클라이언트 라이브러리가 이 케이스를 삼키고 있었다면 동작이 바뀐다 |
| `BITCOUNT`/`BITPOS` | **8.0** 부터 없는 키·잘못된 인자에 0 대신 **에러**(Redis#11734), 인자 검증이 키 존재 확인보다 앞선다(Redis#12394) | 반환값 0 을 전제한 코드가 깨진다 |
| streams | **8.1** 부터 내부 크기 추적용으로 **키당 8바이트 추가**(#688) | 스트림이 많으면 메모리가 늘어난다 |
| disk-based replication | **8.0** 부터 replica 가 **RDB 유효성 확인 후에** 기존 데이터를 flush(#926) | 부분 데이터 손실 방지 — 순수 개선 |

## 5. 9.0 (2025-10-16 태그 · 2025-10-21 릴리스)

세 개 RC(2025-08-14 / 09-23 / 10-08)를 거쳤습니다. 릴리스노트 기준 신기능 전수는 이렇습니다 `✓`.

| 분류 | 무엇 |
|---|---|
| **cluster 모드 numbered database** (#1671) | `cluster-databases`(IMMUTABLE, 기본 1) + `SELECT`. 해싱은 그대로 — 같은 키는 모든 DB 에서 같은 슬롯. **`SWAPDB` 는 cluster 에서 에러**. `GETKEYSINSLOT`/`COUNTKEYSINSLOT`/`MIGRATE` 는 선택된 DB 컨텍스트에서만 동작. Redis 에는 `cluster-databases` 가 없다 |
| **hash field expiration** (#2089) | 커맨드 11개(`HEXPIRE` `HEXPIREAT` `HEXPIRETIME` `HGETEX` `HPERSIST` `HPEXPIRE` `HPEXPIREAT` `HPEXPIRETIME` `HPTTL` `HSETEX` `HTTL`). 자료구조는 `src/vset.c` = **"Volatile Set"**(vector set 이 아니다) |
| **atomic slot migration** (#1949) | `CLUSTER MIGRATESLOTS` 계열. 동작 원리·Redis 8.4 `CLUSTER MIGRATION` 과의 방향 차이는 [06]({{< relref "../06-cluster-mode/index.md" >}}) 가 소유한다 |
| `DELIFEQ key value` (#1975) | 값이 일치할 때만 삭제. 분산 락 해제를 Lua 없이 원자적으로 |
| MPTCP (#1811, #1961) | `mptcp` / `repl-mptcp`. Linux 5.6+ 필요 |
| `SHUTDOWN SAFE` (#2195) · `shutdown-on-sigterm failover` (#2292) | cluster 에서 "슬롯을 가진 primary 를 내리는 것" 이 unsafe 로 정의된다. `safe` 는 `force` 를 막지 못하고 로그만 남긴다 |
| TLS 인증서 기반 자동 인증 (#1920) | `tls-auth-clients-user`(`CN` 또는 `off`, 기본 `off`). 매칭 실패 시 미인증 default user 로 붙는다 |
| cluster 기타 | `CLUSTER FLUSHSLOT`(#1384) · `CLUSTER REPLICATE NO ONE`(#1674) · `cluster-announce-client-port`/`-tls-port`(#2429). **`cluster-manual-failover-timeout`(#1690)은 9.0 릴리스노트의 Cluster 섹션에도 실려 있지만 실제 도입은 8.1.0 이다** — `valkey 8.1.0:src/config.c:3328` 에 이미 있다 `✓` |
| `io-threads` 런타임 변경 (#2033) | 8.0/8.1 의 `IMMUTABLE_CONFIG` 가 **여기서 `MODIFIABLE` 로 바뀐다** |
| 성능 | BITCOUNT SIMD(#1741)·ARM NEON(#1867)·HyperLogLog NEON(#1859) · zero-copy 응답(#2078) · **파이프라이닝 선행 파싱 + prefetch**(#2092) · replica RDB 를 백그라운드 스레드로 저장(#1784) |
| 관측·툴링 | **lttng 기반 트레이싱**(#2070, `src/trace/` 신설) · `valkey-cli --hotkeys-count`(#1933) · `valkey-cli`/`valkey-benchmark` 의 RDMA·MPTCP 지원(#2059, #2067) |

블로그 수치는 BITCOUNT/HLL SIMD 최대 200%, zero-copy 최대 20%, 파이프라이닝 최적화 최대 40%, 그리고 "2,000노드 클러스터에서 초당 10억 요청 이상" 입니다 `Ⓥ`. **넷 다 측정 조건이 공개되지 않았습니다** `?`. 앞의 세 항목은 인스턴스·페이로드·클라이언트 수가 어디에도 없고, 특히 SIMD 항목은 구현이 x86 SIMD(#1741)와 ARM NEON(#1859·#1867)으로 나뉘어 있으므로 CPU 아키텍처를 고정하지 않으면 재현 대상조차 특정되지 않습니다. 마지막 것은 하드웨어·방법론이 아예 없으므로 단일 인스턴스 수치와 섞으면 안 됩니다. 네 항목 어느 것도 용량 계획의 입력값으로 쓸 수 없습니다 `Σ`.

### 5.1 HFE 는 Redis API 호환이지만 동작이 다르다

API 를 일부러 그대로 복사해 클라이언트 호환성을 유지했지만 PR #2089 이 명시한 설계 결정 때문에 동작이 갈립니다 `✓`.

- **lazy expiration 을 도입하지 않았다.** 메모리 회수는 active expiration 에만 의존한다.
- `HLEN` 은 **실제로 만료된 필드까지 포함**한 필드 수를 반영한다.
- `HRANDFIELD` 는 negative count 이거나 hash 가 count 보다 훨씬 클 때 **비만료 필드가 남아 있어도 빈 응답**을 줄 수 있다.
- TTL 이 0 이거나 과거면 즉시 삭제되고 `hdel` 이 아니라 **`hexpired`** keyspace 이벤트가 발행된다.
- `HSETEX` 를 제외한 만료 관련 커맨드에는 `DENYOOM` 이 없다.

메모리 쪽 갭도 열려 있습니다 — 작은 hash 에서 listpack 인코딩을 유지할 수 없어 hashtable 로 강제 전환됩니다(이슈 #2618, 9.2 계획에 "closes the 9.0 HFE gap" 으로 등재) `✓`. **그리고 9.0.2(urgency HIGH)의 버그 수정 17건 중 9건이 HFE 관련입니다** — 9.0.0/9.0.1 에서 필드 TTL 을 프로덕션에 쓰는 것은 위험합니다. 최소 9.0.2, 실무적으로는 9.0.5/9.1.1 입니다 `Σ`.

Redis 는 같은 기능을 **7.4.0(2024-07-29)** 에 냈습니다 — Valkey 가 약 15개월 늦었고 동작은 다릅니다([04 · Redis 7.0 → 8.10]({{< relref "../04-redis-7-to-8.md" >}})) `✓`.

### 5.2 breaking change — 실제로는 매우 보수적이다

9.0.0 릴리스노트에 **"Breaking changes" 섹션이 없습니다** `✓`. behavior change 로 분류된 것은 3건입니다 — auth 체크를 command exist/arity 검사보다 **앞으로** 이동(#1475, 미인증 클라이언트가 받는 에러 종류가 바뀝니다), MULTI/EXEC 내부 에러 메시지에 command fullname 포함(#2286), `SCRIPT EXISTS`/`SHOW`/`FLUSH` 에 `STALE` 플래그 추가(#2419). **커맨드 제거 0건, 설정 제거 0건**이고 오히려 #2546 이 **25개 커맨드의 deprecation 을 되돌렸습니다**.

실질적 breaking 은 **RDB_VERSION 11 → 80** 하나입니다. `src/rdb.h` 의 주석이 의도를 그대로 적습니다 — "RDB 12-79 are reserved for Redis non-compatible RDB formats. We start using high rdb version numbers since Valkey 9.0. This is in order to avoid collisions with non-OSS Redis RDB versions." `rdbUseValkeyMagic(rdbver)` 는 `rdbver > 79` 일 때 true 이므로 **9.0 부터 파일 magic 이 `VALKEY`** 입니다 `✓`.

다운그레이드 관점의 결론: 8.1.x 로더는 `rdb-version-check strict`(기본)에서 "Can't handle RDB format version 80" 으로 거부하고, `relaxed` 로 두면 버전 체크는 통과하지만 9.0 이 쓴 **mandatory opcode `RDB_OPCODE_SLOT_IMPORT`(243)** 나 HFE 인코딩을 만나면 로드가 중단됩니다. **9.0 → 8.x 다운그레이드와 9.0 primary → 8.x replica 의 full sync 는 신뢰할 수 없습니다** `✓`. 업그레이드는 replica 부터 잡고, 롤백 계획은 "RDB 되돌리기" 가 아니라 **"8.x 스냅샷 보관"** 으로 세워야 합니다 `Σ`.

### 5.3 빌드 요구사항

"9.0 에서 CMake 로 전환했다" 는 틀렸습니다 — **CMake 는 8.1.0 부터** 있고 9.x 는 Makefile 과 CMake 를 **둘 다** 유지합니다. `cmake_minimum_required(VERSION 3.10)` 은 8.1.0 / 9.0.0 / 9.1.1 이 동일합니다 `✓`. 9.0 의 실제 의존성 변화는 **`hiredis` → `libvalkey`** 입니다(`deps/` 목록 diff). 9.1 의 변화는 §6 에 있습니다.

## 6. 9.1 (2026-05-19) 과 패치 라인

| 축 | 무엇 | 수치·조건 |
|---|---|---|
| **DB 단위 ACL** (#2309) | `db=` 규칙. `ACL SETUSER app on >pw +@all ~* db=0,1`. 기본 `alldbs`, `resetdbs` 로 초기화. selector 안에도 쓸 수 있다. 거부 시 `NOPERM No permissions to access database` | `SWAPDB`/`SELECT`/`MOVE`/`COPY` 는 **커맨드 권한과 대상 DB 권한을 모두** 요구. `FLUSHALL`·`CLUSTER MIGRATESLOTS`·`CLUSTER CANCELSLOTMIGRATIONS` 는 **`alldbs` 요구**. 모듈 API `VM_ACLCheckCommandPermissions()` **지원 중단** |
| **Lua 를 모듈로 분리** (#2858) | `src/lua` → `src/modules/lua`. 공개 API 는 완전 호환(`EVAL`·`FUNCTION`/`FCALL` 사용법 불변). 서버 빌드 시 함께 빌드되고 시작 시 자동 로드 | `BUILD_LUA=no` 로 **Lua 없는 Valkey** 를 만들 수 있다. rc2 에서 기본을 dynamic → **static 링크**로 전환(#3392). 새 `INFO` 섹션 "Scripting Engines"(#2738) |
| **I/O 스레드 통신 재설계** (#3324) | client-list 폴링을 lock-free 큐 3종으로 교체 — main→IO SPMC 공유 큐(적응적 스케일링, main thread CPU 30% 초과 시 첫 IO thread 점화), IO→main MPSC 응답 큐, thread 별 SPSC private inbox. `src/queues.c`·`mutexqueue.c`·`fifo.c` 신설 | PR 벤치 `Ⓥ`: cluster SET **+16.67%** / GET +13.08%, standalone SET **+17.39%** / GET +7.89%. 조건 **8 IO threads · 400 clients · 512B · 3M keys**. 릴리스노트 표기는 "8-17% throughput gain" |
| 메모리 | embedded string 임계 **64 → 128바이트**(#3397), zset skiplist 에 element·header 임베딩(#2508, #2867), 작은 문자열의 server object 포인터 오버헤드 제거(#2516), rehashing 중 **incremental page release** 로 latency spike 완화(#3481) | 블로그 `Ⓥ`: 128B 미만 작은 문자열 메모리 최대 -20%, sorted set 최대 -10%. 릴리스노트는 embedded string 항목에 "30% GET throughput gain" |
| 신규 커맨드 | **`CLUSTERSCAN cursor [MATCH][COUNT][TYPE][SLOT]`**(#2934 — 클러스터 전체를 하나의 커서로), **`MSETEX`**(#3121), **`HGETDEL`**(#2851) | `MSETEX` 는 Redis 8.4(2025-11-18)가 약 6개월 앞섰다 |
| 관측 | **`log-format json`**(#1791 — 한 줄 = JSON 객체 하나) · cluster bus 트래픽 바이트 계측(#3396) · active IO threads / main thread 사용률 누적 metric(#2463, #2931) · `INFO` 의 `cluster_info` 에 클러스터 전체 정보(#2876, #2964) | — |
| 일관성 | `hash-seed`(#2608, IMMUTABLE) — 같은 seed 를 주면 재시작·failover 를 넘어 `SCAN` 순서가 일관된다 | cross-node `SCAN` 을 자동화에 쓰는 경우의 전제 조건 |
| TLS | 자동 리로드(`tls-auto-reload-interval`, 기본 0=off, #3020) · SAN URI 기반 인증(#3078) · 서버 인증서 만료 추적 + `INFO` telemetry(#2913) | — |

블로그 종합 수치는 **단일 서버 초당 210만 요청**이고 조건은 **512B payload · 9 IO threads · pipeline depth 10** 입니다 `Ⓥ`.

**릴리스노트를 그대로 읽으면 틀리는 항목이 하나 있습니다.** 9.1.0-rc1 은 "Prevent invalid TLS certificates from being loaded"(#2999)를 신기능으로 실었지만 rc2 에서 **"as it is a breaking change, deferred to next major version" 으로 revert 됐습니다**(#3572). GA 릴리스노트에 rc1 목록이 그대로 남아 있어 오독하기 쉽습니다 — **9.1.0/9.1.1 에는 이 동작이 없습니다** `✓`.

9.1 의 그 밖의 breaking 성 변경은 넷입니다 — `events-per-io-thread` 소멸(설정 파일 경로에는 shim 이 있어 조용히 무시됩니다. `CONFIG SET` 경로는 미검증 `?`), 모듈 API `VM_ACLCheckCommandPermissions()` 지원 중단, **querybuf CRLF 엄격 검사**(#2872 — 그동안 통과했던 malformed RESP 가 protocol error 가 됩니다. 9.0.5 에도 백포트됐습니다), `COMMAND INFO`(RESP3)에서 subcommand 없는 커맨드의 `subcommands` 필드가 Set → **Array**(#3939) `✓`.

빌드는 방향이 갈렸습니다. **서버는 순수 C 가 됐고, 유닛 테스트는 C++ 가 필요해졌습니다** `✓` — `deps/fast_float`(C++ 헤더) + `fast_float_c_interface` 가 `deps/fast_float/ffc.h`(C99 포트, #3329)로 대체되고 `src/Makefile` 의 `USE_FAST_FLOAT` 조건 블록 자체가 사라졌습니다. 반대로 `deps/gtest-parallel` 이 추가되고 CMake 옵션이 `BUILD_UNIT_TESTS` → **`BUILD_UNIT_GTESTS`** 로 바뀌었습니다. 선택적 빌드 옵션은 `BUILD_TLS=yes|module`, `BUILD_RDMA=yes|module`, `BUILD_LUA=static|module|no`, `USE_SYSTEMD=yes`, `USE_LIBBACKTRACE=yes`(#3034) 이고 **Sentinel 모드는 TLS module 빌드를 지원하지 않습니다**.

### 6.1 패치 라인과 2026-07-21 동시 릴리스

| 버전 | 발행 | urgency | 내용 |
|---|---|---|---|
| 9.0.1 | 2025-12-09 | MODERATE | 슬롯 마이그레이션 클라이언트를 internal user 로 인증(#2785), 32-bit ARM 에서 NEON 을 AArch64 에서만(#2873), IO-thread shutdown 데드락(#2898) |
| 9.0.2 | 2026-02-03 | **HIGH** | HFE 버그 집중 수정 + 9.0.1 이 만든 성능 회귀 완화(#3086, #3126) |
| 9.0.3 | 2026-02-24 | **SECURITY** | CVE-2025-67733(Lua `error_reply` 경유 RESP protocol injection) · CVE-2026-21863(malformed cluster bus message 원격 DoS) · CVE-2026-27623(malformed RESP 로 pre-auth DoS) |
| 9.0.4 | 2026-05-06 | **SECURITY** | CVE-2026-23479 · CVE-2026-25243 · CVE-2026-23631 |
| **9.1.1 · 9.0.5 · 8.1.9 · 8.0.10 · 7.2.14** | **2026-07-21** | **SECURITY** | 아래 두 건 |

동시 릴리스의 성격은 **보안**이고 두 건입니다 `✓`.

- **CVE-2026-56684** (GHSA-53mc-f3m3-99vh, CVSS 3.1 **7.5**, CWE-416) — TLS 커넥션 처리의 use-after-free. "읽을 데이터가 남은 커넥션" 목록을 처리하는 중 한 커넥션이 닫히면 방금 해제된 다른 커넥션의 메모리에 접근할 수 있다. 트리거는 **인증된 클라이언트가 `CLIENT KILL` 등으로 커넥션을 닫는 동안** 다른 TLS 커넥션에 버퍼된 데이터가 남아 있는 상황이고 heap grooming 으로 RCE 가 가능하다. **TLS 를 켠 배포만 영향**이며 완화책은 `ACL SETUSER <user> -client` / TLS 미사용 / 네트워크 격리 — **완전한 우회책은 없다**(수정 PR #4234).
- **CVE-2026-63639** (GHSA-mvcj-73cw-22m4, CVSS 3.1 **8.8**) — 인증된 사용자가 조작한 `RESTORE` 로 **중복 PEL(Pending Entry List) 할당**이 든 malformed payload 를 주입하면 stream consumer group 역직렬화 또는 consumer 삭제 중 use-after-free 가 나고 RCE 로 이어질 수 있다. advisory 원문은 **"The problem exists in all versions of Valkey"** 다. 완화책은 ACL 로 `RESTORE` 차단 또는 conf 에서 disable/rename(수정 PR #4073).

취약 범위는 `<= 9.1.0, <= 9.0.4, <= 8.1.8, <= 8.0.9, <= 7.2.13` 이고 패치 버전 문자열은 두 advisory 가 동일합니다. **`RESTORE` 를 애플리케이션에 허용했거나 TLS 를 쓰는 배포는 즉시 올려야 합니다** `Σ`.

CVE 출처가 두 갈래라는 점도 알아야 합니다. Valkey 자체 GHSA 는 총 10건뿐이고, CVE-2026-23479 / 25243 / 23631 과 CVE-2025-46817 / 46818 / 46819 는 **Redis 가 GHSA 를 발행하고 Valkey 는 릴리스노트로만 고지**했습니다 — **"valkey GHSA 목록에 없다" 가 "Valkey 는 영향 없다" 를 뜻하지 않습니다.** 정본은 릴리스노트의 Security fixes 섹션입니다 `✓`.

## 7. 버전 선택과 지원 정책

| 버전 | 릴리스 | 얻는 것 | 조심할 것 |
|---|---|---|---|
| **8.0.x** | 2024-09-15 | 비동기 I/O 스레딩 · dual channel · 키 임베딩. RDB 11 이라 **Redis ≤7.2 와 파일 호환** | `io-threads` 가 IMMUTABLE. **security 종료가 maintenance 와 같은 2027-09-15**(최신 minor 가 아니다) |
| **8.1.x** | 2025-03-31 | 새 hashtable(키당 -20~30B) · RDMA builtin · `COMMANDLOG` · `import-mode` · RDB 11 유지 | AVX 의존 성능 항목은 ARM 에서 안 나온다. `rdb-version-check` 기본 strict |
| **9.0.x** | 2025-10-21 | cluster multi-DB · HFE · ASM · `io-threads` 런타임 변경 | **RDB 80 — 8.x 로 되돌릴 수 없다.** HFE 는 **최소 9.0.2**. security 종료 **2028-10-21**(9.1 이 있어 5년 혜택 없음) |
| **9.1.x** | 2026-05-19 | DB 단위 ACL · Lua 모듈화 · I/O 통신 재설계(+8~17% `Ⓥ`) · 메모리 추가 절감 | rc1 의 엄격 TLS 인증서 검증은 **revert 됐다.** CRLF 엄격 검사로 malformed RESP 가 에러 |

지원 정책은 문서화돼 있고 **"LTS" 라는 라벨은 쓰지 않습니다** — **maintenance support 3년** + **각 major 의 "최신 minor" 에만 extended security support 5년** 입니다 `✓`.

| 버전 | 최초 릴리스 | maintenance 종료 | security 종료 |
|---|---|---|---|
| 9.1 | 2026-05-19 | 2029-05-19 | 2031-05-19 |
| 9.0 | 2025-10-21 | 2028-10-21 | **2028-10-21** |
| 8.1 | 2025-03-31 | 2028-03-31 | 2030-03-31 |
| 8.0 | 2024-09-15 | 2027-09-15 | **2027-09-15** |
| 7.2 | **2024-04-16** | 2027-04-16 | 2029-04-16 |

표를 읽는 법: security 종료가 maintenance 종료와 같은 줄(9.0, 8.0)은 **그 major 의 최신 minor 가 아니기 때문**입니다. 7.2 는 7.x 의 유일·최신 minor 라 5년을 받습니다. 7.2 의 기산일이 포크 기점 7.2.4(2024-01-09)가 아니라 **Valkey 가 처음 발행한 7.2 릴리스(7.2.5)의 2024-04-16** 인 점도 주의합니다 `✓`.

여기서 따라 나오는 위험이 하나 있습니다. **9.2.0 GA(목표 2026-11-15, 이슈 #4218)가 나오면 9.1 이 "최신 minor" 지위를 잃습니다.** 규칙을 그대로 적용하면 9.1 의 security 종료가 2031-05-19 → 2029-05-19 로 당겨집니다 — 다만 공식 문서에 "최신 minor 지위를 잃으면 5년을 되돌린다" 고 명시한 문장은 확인되지 않았습니다 `≈`/`?`. **"9.1 은 2031년까지 안전하다" 를 계획의 전제로 삼지 않는 편이 맞습니다** `Σ`.

케이던스는 "안정 major 를 연 1회, minor 는 필요에 따라 최소 연 1회" 이고, 버저닝이 보호하는 API 계약을 7개로 명시합니다 — 커맨드, Lua 에서 실행 가능한 함수·API, **RDB 버전**, **replication 프로토콜**, **cluster node 프로토콜**, Module API, AOF 디스크 포맷 `✓`. 9.0 이 RDB 를 80 으로 올린 것은 이 계약을 major 에서 깬 정당한 행사였다는 뜻입니다.

## 8. Redis 8.x 대비 기능 매트릭스 — Valkey 관점

기준은 **Valkey 9.1.1(2026-07-21)** vs **Redis Open Source 8.10.0(2026-07-29)**. Redis 쪽 릴리스별 서사는 [04 · Redis 7.0 → 8.10]({{< relref "../04-redis-7-to-8.md" >}}) 가 소유하므로 여기서는 **Valkey 를 고를 때 얻는 것과 포기하는 것**만 봅니다.

**Valkey 에만 있는 것** `✓`

| 축 | 무엇 | 도입 |
|---|---|---|
| 자료구조 | 캐시라인 버킷 `hashtable` 백엔드 (Redis 는 8.10.0 도 `dict.c` + `no_value=1`) | 8.1.0 |
| 전송 | **RDMA**(experimental) · **MPTCP**(서버·replica) | 8.0/8.1 · 9.0 |
| cluster | **numbered database**(`cluster-databases`) · `CLUSTER FLUSHSLOT` · `CLUSTER REPLICATE NO ONE` · `CLUSTERSCAN` · `CLUSTER SHARDS`/`SLOTS` 의 `availability-zone` | 9.0 / 9.1 |
| 보안 | **DB 단위 ACL**(`db=`) | 9.1.0 |
| 운영 | `COMMANDLOG`(large request/reply) · **lttng 트레이싱** · `log-format json` · `SHUTDOWN SAFE`/`FAILOVER` · `hash-seed`(cross-node `SCAN` 일관성) · TLS 인증서 자동 리로드 | 8.1 ~ 9.1 |
| 확장 | **플러그형 스크립팅 엔진**(Lua 를 모듈로, `BUILD_LUA=no`) | 9.1.0 |
| 커맨드 | `DELIFEQ`(Redis 8.4 의 `DELEX`/`SET` CAS 가 유사 기능이지만 이름·시맨틱이 다르다) · `GEOSEARCH BYPOLYGON` · standalone 에서 쓰는 `CLUSTER KEYSLOT` | 9.0 / 9.1 |
| 라이선스 | **BSD-3-Clause** — [03]({{< relref "../03-license-and-fork.md" >}}) | 포크 이후 전체 |

**Valkey 코어에 없는 것** `✓`

| 축 | Redis 쪽 | Valkey 쪽 상태 |
|---|---|---|
| 검색·벡터·JSON·시계열·확률형 | 8.0 부터 배포에 번들 | **코어에 없다.** 별도 모듈 `valkey-search` 1.2.1(2026-07-07) · `valkey-json` 1.0.2(2025-09-08) · `valkey-bloom` 1.0.1(2026-02-24) · `valkey-ldap` 1.1.1(2026-06-29). **공식 모듈은 이 4개뿐이고 TimeSeries·Cuckoo·Count-min·Top-k·t-digest 에 해당하는 공식 릴리스는 없다** — `valkey-bloom` 은 `BF.*` 9개 커맨드만 제공하고 `CF.*`/`CMS.*`/`TOPK.*`/`TDIGEST.*` 는 피처 브랜치에만 있다. TimeSeries 는 org 밖 서드파티(`opensource-for-valkey/valkey-timeseries`, 릴리스 0개)뿐이다 |
| stream 확장 | `XDELEX`/`XACKDEL`(8.2) · `XNACK`(8.8) · `XREADGROUP CLAIM`(8.4) · `XREAD MAXCOUNT`/`MAXSIZE`(8.10) | `XDELEX`/`XACKDEL` 은 **9.2 계획**(#3467, #3466), 나머지 없음 |
| 서버측 hot key | **`HOTKEYS`**(8.6) | 클라이언트 샘플링 `valkey-cli --hotkeys-count` 만. 서버측은 **9.2 계획**(#3708) |
| 자료구조·커맨드 | `Array`(8.8, 커맨드 18개) · **compact hashes + `HIMPORT`**(8.10) · `BACKUP`(8.10) · `INCREX`(8.8) · `DIGEST`/`DELEX`/`SET` CAS(8.4) · `BITOP` 새 연산자(8.2) · eviction `volatile-lrm`/`allkeys-lrm`(8.6) | 없음 |
| replica full-sync 버퍼 | 전용 `replica-full-sync-buffer-limit` | 전용 config 없음 — COB 재사용(§3.2) |
| I/O 스레드 관측 | `INFO Threads` per-thread · `CLIENT LIST io-thread=N` | 9.1 의 누적 metric 까지가 최대 |

번들 모듈이 없다는 사실에는 **cluster 운영 쪽 부작용**이 하나 붙습니다. Valkey 서버는 로드된 모듈 중 하나라도 `VALKEYMODULE_OPTIONS_HANDLE_ATOMIC_SLOT_MIGRATION` 을 선언하지 않으면 `CLUSTER MIGRATESLOTS` 를 거부하는데, **공식 4개 모듈 전부가 이 플래그를 선언하지 않습니다** — `valkey-bundle` 이미지처럼 모듈을 얹은 배포에서는 atomic slot migration 을 못 씁니다 `✓`. 판정 기준과 대안은 [06 · cluster mode]({{< relref "../06-cluster-mode/index.md" >}}) 로 넘깁니다.

**같은 기능, 다른 이름·시점** — 혼동이 실제로 사고를 만드는 지점입니다 `✓`.

| 기능 | Valkey | Redis | 방향 |
|---|---|---|---|
| fast full sync | 8.0 `dual-channel-replication`, 기본 **no** | 8.0 `repl-rdb-channel`, 기본 **yes** | Redis 가 Valkey PR #60 을 명시 참조. **와이어 비호환** |
| 키·값 임베딩 | 8.0 dict entry → **8.1 hashtable 전면 교체** | 8.2 `kvobj`("adopts Valkey's packing layout") | **가장 되돌릴 수 없는 분기** |
| atomic slot migration | 9.0.0 (2025-10-21), source push | 8.4.0 (2025-11-18), destination pull | Valkey 가 약 1개월 앞섰고 **방향이 반대라 자동화가 호환되지 않는다** → [06]({{< relref "../06-cluster-mode/index.md" >}}) |
| hash field TTL | 9.0.0, 커맨드 11개(+`HGETDEL` 9.1) | **7.4.0**, `HGETDEL`/`HGETEX`/`HSETEX` 는 8.0 | Redis 가 약 15개월 앞섰고 **Valkey 는 lazy expiration 이 없다** |
| `CLUSTER SLOT-STATS` | 8.0.0 | **8.2.0** | Redis PR #14039 가 Valkey PR 5개를 명시 참조 |
| `MSETEX` | 9.1.0 | **8.4.0** | Redis 가 약 6개월 앞섰다 |
| `io-threads` 가변성 | 8.0/8.1 IMMUTABLE → **9.0 MODIFIABLE**, 상한 256 | **8.10.0 까지 IMMUTABLE**, 상한 128 | 양쪽 다 기본값 1 |
| `CLUSTER SLOTS` | 7.2.4 까지 deprecated → **8.0 에서 un-deprecate**, 9.1 에 `availability-zone` | **8.10.0 도 deprecated**(`replaced_by: CLUSTER SHARDS`) | 진영별로 정반대 |

선택 기준은 성능이나 커맨드 개수가 아닙니다 — **(1) 라이선스, (2) 번들 모듈 필요 여부, (3) cluster 운영 도구** 셋이 결정합니다 `Σ`. 검색·벡터·JSON·시계열을 배포 하나로 끝내야 하면 Redis 8.x 고, BSD-3 유지·multi-DB cluster·DB 단위 ACL·MPTCP/RDMA 가 필요하면 Valkey 9.x 입니다. 다만 Valkey 의 모듈은 **코어와 별도 케이던스**라는 점을 감안해야 합니다 — `valkey-json` 은 2025-09-08 의 1.0.2 이후 11개월째 새 릴리스가 없습니다. 리포는 2026-08-01 까지 push 되고 archived 도 아니므로 `✓` 릴리스 케이던스가 느린 것으로 읽는 게 맞습니다 `Σ`.

## 9. Redis → Valkey 마이그레이션 사실관계

전부 RDB 버전 숫자 하나로 결정됩니다. 아래 표가 이 절의 전부입니다 `✓`.

| 방향 | 가능? | 이유 |
|---|---|---|
| Redis ≤ 7.2.x → Valkey 8.x/9.x | **가능** | 양쪽 RDB 11 / `REDIS0011` |
| **Redis 7.4+ (RDB 12) → Valkey 8.x** | **불가** | Valkey 8.1 이 **12~79 를 foreign 범위로 예약해 거부**. `rdb-version-check relaxed` 로도 우회되지 않는다 |
| Valkey 8.x (RDB 11) → Redis | 가능 | Redis 는 자기 버전 이하를 받는다 |
| **Valkey 9.x (RDB 80 / `VALKEY080`) → Valkey 8.x** | **불가** | strict 는 버전 거부, relaxed 는 mandatory opcode `RDB_OPCODE_SLOT_IMPORT`(243)·HFE 인코딩에서 중단 |

거부 로직은 소스에 그대로 있습니다 — `valkey 8.1.0:src/rdb.h:53-59` 의 `RDB_FOREIGN_VERSION_MIN 12` / `MAX 79`, 그리고 `src/rdb.c:3038-3053` 의 로더가 `rdbver >= RDB_FOREIGN_VERSION_MIN && !is_valkey_magic` 이면 `Can't handle RDB format version %d` 를 남기고 실패합니다 `✓`. **`DUMP`/`RESTORE`·`MIGRATE` 도 같은 규칙에 걸립니다** — `verifyDumpPayload`(`valkey 8.1.0:src/cluster.c:155-179`)가 같은 검사를 하고, **DUMP 페이로드에는 magic string 이 없고 RDB 버전 숫자만 있으므로 foreign 범위는 무조건 거부**됩니다.

`rdb-version-check`(8.1 신설, 기본 **`strict`**)를 `relaxed` 로 바꿔도 **foreign 범위는 받지 않습니다.** relaxed 는 Valkey 9.x RDB 를 8.1 이 읽어보게 하려고 만든 장치이고, 미래 RDB 를 알 수 없는 opcode 를 만날 때까지 best-effort 파싱하므로 **부분 로드 후 실패**가 가능합니다 — 프로덕션은 strict 를 유지하는 게 맞습니다 `Σ`.

**복제로 붙이기.** Redis **7.2 이하 primary ← Valkey 8.x/9.x replica** 는 됩니다. 공식 문서의 절차는 Redis 의 host/port 확인 → Valkey 에서 `REPLICAOF <host> <port>` → `INFO REPLICATION` 으로 동기 확인 → 애플리케이션 전환 → Redis 종료 → Valkey 에서 `REPLICAOF NO ONE` 승격이고, 사실상 무중단 컷오버입니다 `✓`. **Redis 7.4+ primary 에는 붙지 않습니다** — full sync 가 RDB 를 태워 보내므로 위 표의 두 번째 행에 그대로 걸립니다. 다만 이 실패가 핸드셰이크 어느 단계에서 어떤 메시지로 나타나는지는 실행으로 확인되지 않았습니다 `?`(코드 경로 추론).

공식 문서의 호환 범위 표현은 **"Valkey reads and writes RDB and AOF files compatible with Redis OSS 7.2. RDB files produced by Redis CE 7.4 and later are not compatible."** 입니다 `✓`. AOF 도 같은 경계로 보는 게 안전합니다 — AOF 는 base RDB 를 품으므로 RDB 버전 검사에 걸릴 것으로 추정되지만 MP-AOF manifest 레벨의 실패 양상은 소스로 추적되지 않았습니다 `≈`. 파일 복사 방식에는 문서가 명시한 함정도 있습니다 — **"If you enabled AOF in your Valkey configuration, disable it on the first start. Otherwise, the copied RDB file will not be imported into Valkey."**

**그래서 소스 Redis 의 마이너 버전이 경로를 완전히 갈라놓습니다.** 7.4 이상이면 RDB·복제·`DUMP`/`RESTORE` 세 경로가 모두 막히므로 남는 것은 (a) 애플리케이션 이중 쓰기, (b) 논리적 재적재(키를 읽어 타입별 커맨드로 재생성)뿐이고, 실질적으로 **(b) + `import-mode yes` + `CLIENT IMPORT-SOURCE ON`** 조합이 유일한 안전 경로입니다 `Σ` — import-mode 가 동기화 중 destination 의 expire/evict 가 데이터를 깨뜨리는 것을 막고, import-source 로 표시한 클라이언트에서 오는 커맨드만 예외 처리하기 때문입니다.

AWS 환경의 엔진 전환(ElastiCache 의 Redis → Valkey, 엔드포인트가 바뀌는가)은 [07 · AWS 엔드포인트]({{< relref "../07-aws-endpoints/index.md" >}}) 가 소유합니다.

## 10. 근거

- **소스**: 로컬 blobless 클론 `~/evejuni/valkey`·`~/evejuni/redis` 에서 `git show <tag>:<path>` 로 실측. 주요 인용은 `valkey 8.0.0:src/config.c`(`io-threads` 의 `IMMUTABLE_CONFIG`), `valkey 8.1.0:src/hashtable.h:91`·`src/hashtable.c:275-283`(64바이트 버킷 + `static_assert`), `valkey 8.1.0:src/kvstore.h`(`hashtable.h` 로 전환), `valkey 8.1.0:src/replication.c:1141`(`+DUALCHANNELSYNC`)·`:1392`(`capa dual-channel`)·`:2943-2948`(COB 하드 리밋 재사용), `valkey 8.1.0:src/rdb.h:53-59`·`src/rdb.c:3038-3053`·`src/cluster.c:155-179`(foreign 범위 거부), `valkey 8.1.0:src/Makefile:333-352`·`valkey.conf:303-320`(RDMA builtin·experimental 명시), `valkey 9.1.1:src/rdb.h`(RDB 80 주석)·`src/config.c:3320`(`extended-redis-compatibility` 생존)·`:3391`(`io-threads` MODIFIABLE), `redis 8.10.0:src/dict.c`·`src/config.c:3396`(hashtable 없음·io-threads 상한 128).
- **릴리스노트**: `RELEASENOTES-8.0.0.txt` · `-8.1.0.txt` · `-9.0.0.txt` · `-9.1.0.txt` · `-9.1.1.txt`(Valkey), `RELEASENOTES-8.{0,2,4,6,8,10}.0.txt`(Redis). 기능 유무·breaking 분류·Security fixes 는 **릴리스노트가 정본**이다.
- **PR 본문**: valkey #60(dual channel) · #477·#1209(RDMA) · #541(키 임베딩) · #758·#763(async I/O·오프로드) · #861(prefetch) · #1185(import-mode) · #1186(hashtable) · #1579(hash 임베딩) · #1604(`rdb-version-check`) · #1671(cluster multi-DB) · #2089·#2422(HFE·RDB bump) · #2309(DB ACL) · #2546(un-deprecate) · #2858(Lua 모듈화) · #3324(I/O 큐 재설계) · #3392·#3397·#3572(revert). redis #13695(I/O threading) · #13732(rdb channel, valkey#60 참조) · #13806(kvobj, Valkey packing 채택 명시) · #14039(`CLUSTER SLOT-STATS`).
- **날짜**: GitHub 릴리스의 `published_at`. 9.0.0 은 태그 커밋 2025-10-16 과 릴리스 발행 **2025-10-21** 이 다르므로 후자를 쓴다. 7.2 의 지원 기산일 2024-04-16 도 태그 커밋일이 아니다.
- **CVE**: `gh api repos/valkey-io/valkey/security-advisories`(GHSA-53mc-f3m3-99vh, GHSA-mvcj-73cw-22m4) 및 각 패치 릴리스의 Security fixes 섹션. Redis 발행 GHSA 를 Valkey 가 릴리스노트로만 고지한 케이스가 있어 **두 곳을 대조**했다.
- **모듈 생태계**: `gh api orgs/valkey-io/repos --paginate` 로 공식 모듈 4개(`valkey-search`/`valkey-json`/`valkey-bloom`/`valkey-ldap`) 확정, 각 리포 소스에서 ASM opt-in 플래그 선언 여부 확인.
- **공식 문서·블로그**: valkey.io 의 릴리스·지원 정책 페이지, 마이그레이션 문서, 8.0 메모리 효율 / 1M rps / 8.1 GA / 9.0 / 9.1 발표 블로그. 성능 수치는 전부 발행 주체가 Valkey 프로젝트 자신이므로 `Ⓥ` 로 표기하고 측정 조건 없는 값은 인용하지 않거나 `?` 를 붙였다.
- **URL 전량**은 [99 · 출처]({{< relref "../99-sources.md" >}}) 가 모은다.
