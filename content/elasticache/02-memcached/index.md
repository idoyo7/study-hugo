---
title: "memcached — 같은 문제를 다르게 푼 6년 선배"
weight: 2
---

# 02 · memcached — 같은 문제를 다르게 푼 6년 선배

{{< callout type="info" >}}
**한눈에**
- **memcached 는 Redis 의 열등한 과거가 아니다.** "캐시는 캐시여야 한다"를 끝까지 밀어서 Redis 가 갖지 못한 성질(한 프로세스로 코어를 먹는 확장, 느린 커맨드가 존재할 수 없는 지연 예측성, 값을 NVMe 로 내리는 용량 확장)을 얻고 자료구조·영속성·복제·다중 키 원자성을 포기했다 `Σ`
- **첫 커밋(2003-05-27)에는 slab allocator 도 자체 해시 테이블도 없었다.** `malloc()` + Judy 트라이 + 전역 단일 LRU 였고, slab 은 3일 뒤·자체 해시는 3주 뒤에 **둘 다 파편화 때문에** 들어왔다 `✓`
- **slab allocator 의 대가가 calcification 이고, 그것을 갚는 데 21년이 걸렸다.** 문제 인지 2003-06-24, 첫 공식 해법 1.4.11(2012-01-16), 기본값 승격 1.5.0(2017-07-21), 그리고 **1.6.34(2024-12-22)의 mover 전면 재작성이 "페이지를 옮기면 아이템을 잃는다"는 대가 자체를 제거**했다 `✓`
- **LRU 는 HOT/WARM/COLD/TEMP 4단 segmented LRU** 이고 1.5.0 부터 기본이다. Redis 와 근사의 **위치가 반대다** — memcached 는 접근 기록을 스레드별 bump buffer 에 비동기로 쌓고 넘치면 버리며, Redis 는 축출 시점에 표본을 뽑는다(`maxmemory-samples 5`) `✓`
- **워커 스레드 N개가 각자 이벤트 루프를 돌려 read·parse·execute·write 를 끝낸다.** `-t 16` 한 프로세스가 16코어를 쓴다. Redis 8.10.0 `redis.conf` 는 2026년에도 "Redis is mostly single threaded" 이고 io-threads 는 소켓 읽기·쓰기와 **프로토콜 파싱까지**다 — 커맨드 실행은 메인 스레드다 `✓`
- **그 대가가 원자성이다.** 보장 단위가 아이템 하나뿐이라 MULTI/EXEC·Lua·다중 키 트랜잭션에 대응하는 것이 원리적으로 없다 `✓`
- **binary protocol 은 1.6.0(2020-03-08)에 공식 deprecated 됐고 후계는 meta 커맨드**이다. 2026년에 클라이언트를 고를 때 meta 지원 여부가 1순위인 이유는 stampede 방어(`W`/`Z`)와 serve-stale 이 **서버에서 원자적으로** 되는 유일한 경로이기 때문이다 `✓`
- **프로젝트는 살아 있지만 기능 개발은 멈춰 있다.** 2026년 릴리스 4개(1.6.42~1.6.45)가 전부 보안·안정화이고, 최근 1년의 사용자 노출 신기능은 1.6.40 의 `mg` 조건부 CAS 페치 하나다 `✓`
- **memcached 와 Redis 를 같은 하드웨어에서 1:1 로 측정한 1차 벤치마크는 없다.** 그래서 이 문서는 "몇 배 빠르다"를 쓰지 않고 구조와 단독 측정치만 쓴다 `?`
{{< /callout >}}

> **왜 이 문서인가.** memcached 를 "Redis 가 나오기 전에 쓰던 것"으로 읽으면 두 번 틀린다. 먼저 memcached 는 2003년에 멈춘 소프트웨어가 아니다 — segmented LRU(1.4.23), SSD 확장(1.5.4), 재시작 생존 캐시(1.5.18), meta 프로토콜(1.6.0), 내장 proxy(1.6.13), slab mover 재작성(1.6.34)이 전부 그 뒤에 들어왔다. 그리고 둘의 차이는 기능 개수가 아니라 **선택한 축**이다. memcached 는 값을 해석하지 않기로 한 대가로 스레드를 열었고, Redis 는 자료구조를 서버에서 실행하기로 한 대가로 실행 스레드를 하나로 묶었다. 이 문서는 그 교환을 소스와 릴리스노트로 확인한다.

> 근거 기준: 로컬 blobless 클론 `~/evejuni/memcached` 태그 **1.6.45(2026-07-09, 최신)** 와 `~/evejuni/redis` 태그 **8.10.0**, GitHub wiki 릴리스노트, `docs.memcached.org`, 기준일 **2026-08-06**. 릴리스일은 1.4.0 이후는 태그 `creatordate`(wiki 릴리스노트와 교차 확인), 1.2.x 이하는 `ChangeLog.txt` 항목이다 — 1.2.x 태그는 git-svn 이관 때 2009-03 에 소급 생성돼 릴리스일 근거가 되지 못한다 `✓`

## 1. 2003, LiveJournal — 첫 커밋이 갖고 있지 않았던 것

첫 커밋 `32f382b`(2003-05-27, Brad Fitzpatrick `<brad@danga.com>`, "committing memcached")은 파일 세 개다 — `Makefile`(10줄), `README`(20줄), `memcached.c` **1195줄**. Makefile 은 `-levent -lJudy` 로 링크한다. 아이템 할당은 평범한 `malloc(ntotal)` 이다. 인덱스는 Judy 의 문자열 트라이(`JSLG`/`JSLI`/`JSLD`)다. LRU 는 슬랩 클래스별이 아닌 **전역 단일 이중연결리스트**(`items_head`/`items_tail`)에 축출 함수 `drop_tail()` 하나다 `✓`

커맨드 세트는 `process_command()` 의 `strncmp` 분기 순서 그대로 일곱 개다 `✓`

```text
add     <key> <flags> <exptime> <bytes>   → STORED / NOT_STORED
set     <key> <flags> <exptime> <bytes>
replace <key> <flags> <exptime> <bytes>
get     <key>*                            → VALUE ... / END      (첫 커밋부터 멀티키)
delete  <key>                             → DELETED / NOT_FOUND
stats
version                                   → "VERSION 2.0" 이 하드코딩돼 있다(당시 버전은 1.0.x)
```

폴백은 `ERROR` 이고 `CLIENT_ERROR bad command line format` · `SERVER_ERROR out of memory` 문자열도 이때 이미 있다. CLI 옵션은 `-p -l -s -m -c -k -d -h` 여덟 개이고 기본 메모리는 **5MB**, 기본 포트 11211 은 첫 커밋부터 지금까지 같다 `✓` 23년 뒤 `mg`/`ms` 가 플래그로 하는 일(§5)을 이때는 커맨드 이름으로 나눠 했다는 것이 보인다 — `add`/`set`/`replace` 는 "존재 여부에 대한 조건"만 다른 세 커맨드다 `Σ`

없던 것을 보는 게 더 빠르다. `incr`/`decr` 는 다음 날(2003-05-28) avva 가 넣었고, `flush_all` 은 2003-12-01, `append`/`prepend`/`cas` 는 2007-10-03, `touch` 는 1.4.8, meta 계열은 1.5.19 다 `✓` 그리고 README 의 한 문장이 이 프로젝트의 헌법이다 — "memcached does non-blocking network I/O, but **not disk. (it should never go to disk, or you've lost the whole point of it)**". 이 문장이 있었기 때문에 14년 뒤 extstore(§5)가 얼마나 큰 전환이었는지 알 수 있다 `Σ`

메인테이너 이행은 문서적으로 추적된다. 2003\~2005 는 Brad Fitzpatrick + Anatoly Vorobey(avva) + Evan Martin, 2006\~2008 은 Steven Grimm(Facebook)·Dustin Sallings·Trond Norbye(Sun)·Brian Aker 가 대거 참여한 구간이다. dormando(Alan Kasindorf)의 첫 커밋은 **2007-09-18**, ChangeLog 에 그의 명의가 처음 박히는 것은 **2007-11-19 "Prepping for 1.2.4 release."** 이고 **2011년 이후로는 매년 커밋 1위**다 — 2024년 127/139, 2025년 65/75, 2026년 60/76, 1.6.45 는 33 커밋 전부 그 한 사람이다 `✓` `LICENSE` 의 저작권 표기는 여전히 "Copyright (c) 2003, Danga Interactive, Inc." 이고, 2003-06-15 에 GPL 에서 BSD-3 로 바꾼 뒤 **23년간 변경이 없다** — Redis 진영의 라이선스 이동([03 · 왜 찢어졌나]({{< relref "../03-license-and-fork.md" >}}))과 대비되는 memcached 의 조용한 자산이고, 동시에 **버스 팩터 1** 이라는 부채다 `Σ`

## 2. slab allocator — `malloc` 을 버린 대가와 그것을 갚은 21년

이유는 커밋 메시지에 남아 있다. `60d7094`(2003-05-30, avva)는 "new allocation policy: bunches of power-of-two slab classes. **no external fragmentation**... always allocate slabs of 1MB", `f6d334e`(2003-06-20)는 "**judy caused memory fragmentation**" 이다. 이론이 아니라 LiveJournal 운영에서 본 파편화가 근거였다 `✓`

현재 구조는 `slabs.c` 헤더 주석이 정의한다 — "Slabs are up to 1MB in size and are divided into chunks. The chunk sizes start off at the size of the 'item' structure plus space for a small key and value. They increase by a multiplier factor from there, up to half the maximum slab size"(`memcached 1.6.45:slabs.c:1-7`). 기본값은 `factor 1.25` · `chunk_size 48` · `item_size_max 1MB`("The famous 1MB upper limit.", `memcached 1.6.45:memcached.c:240`) · `slab_chunk_size_max 512KB` · 8바이트 정렬이다 `✓` 시작 청크는 `sizeof(item) + chunk_size` = 48 + 48 = 96바이트다. 여기서 1.25배씩 올려 기본 설정에서 **38개 클래스**(96, 120, 152, 192, 240, 304, … 394840)가 만들어진다 `≈`(소스 기본값으로 계산한 값이며 `-vv` 출력을 관측한 것은 아니다). 클래스 상한 `MAX_NUMBER_OF_SLAB_CLASSES` 는 63+1 인데, 이 6비트 제약은 `item->slabs_clsid` 의 **상위 2비트를 LRU 종류에 쓰기 때문**이다(§3) `✓`

교환 조건이 여기서 확정된다. 청크는 항상 요청보다 크므로 **내부 파편화(슬랙)를 구조적으로 안고 가고**, 대신 외부 파편화와 `malloc` 경합이 사라진다. `factor 1.25` 는 "슬랙 최대 25%"와 "클래스 개수" 사이의 타협값이라, 아이템 크기 분포가 좁으면 `-f` 를 낮춰 슬랙을 줄이는 게 실이득이고 넓으면 클래스 폭증으로 페이지가 낭비된다 `Σ` 실측은 `stats slabs` 의 `chunk_size`/`used_chunks`/`free_chunks` 와 `stats sizes`(`-o track_sizes`)로 한다 `✓`

**1MB 는 고정 상한이 아니다.** 주석이 "famous" 라고 부를 만큼 유명해서 상수로 오해되지만 `-I/--max-item-size` 로 조정된다. 범위는 `ITEM_SIZE_MAX_LOWER_LIMIT`(1KB)부터 `ITEM_SIZE_MAX_UPPER_LIMIT`(1GB)까지다 `✓` 다만 `slab_chunk_size_max`(기본 512KB)를 넘는 아이템은 청크 하나에 안 들어가므로 여러 청크를 **chained** 로 쓴다(1.5.0). 큰 아이템을 담을 수 있다는 것과 담아도 되는 것은 다른 얘기다 — 값이 커지면 네트워크와 슬랙이 같이 커지고, 캐시 한 대가 큰 아이템 몇 개로 채워진다 `Σ`

### 2.1 calcification — 인지 2003, 해법 2012, 재작성 2024

한 번 어떤 클래스에 배정된 1MB 페이지는 **그 클래스 소유로 굳는다**. 100바이트 아이템으로 메모리를 채운 뒤 워크로드가 200바이트로 바뀌면, 200바이트 클래스는 페이지가 없어 계속 축출·OOM 하는데 100바이트 클래스는 놀고 있다. 이것이 slab calcification 이다. 해법의 연대기가 곧 memcached 의 성격이다.

| 시점 | 버전 | 무엇을 했나 | 남은 대가 |
|---|---|---|---|
| 2003-06-24 | — | `d72b1a2` "slab reassignment command" — 문제 인지와 첫 시도. 2003-09-05 커밋은 "on the road to making slab page reassignment work fully" | **9년간 미완성 방치** |
| 2012-01-16 | **1.4.11** | `-o slab_reassign`(`slabs reassign <src> <dst>`) + `-o slab_automove`. 자동 판정은 보수적 — 축출 1위 클래스가 10초 간격 3연속 1위이면 최근 30초 축출 0인 클래스에서 페이지 1장을 뺏는다 | 옮기는 페이지의 **아이템은 축출된다**, 백그라운드 스레드 1개 추가, 기본 off |
| 2017-06-24 | **1.4.38** | `slab_automove.c` 신규(`5c43b80` "add a real slab automover algorithm", Facebook 저작권). 축출 카운트 대신 윈도우 기반 — `slab_automove_window 10`, `slab_automove_ratio 0.8` | 여전히 기본 off |
| 2017-07-21 | **1.5.0** | `slab_reassign=true`, `slab_automove=1` **기본값 승격**(`memcached 1.6.45:memcached.c:258-259`) | 이 시점부터 "memcached 가 calcification 을 방치한다"는 말은 사실이 아니다 |
| 2017-12-20 | **1.5.4** | `slab_automove_extstore.c` — 메모리↔플래시 균형 전용 알고리즘 | extstore 전용 |
| 2024-12-22 | **1.6.34** | `4c56c8d` — `slabs.c` 를 702줄 줄이고 `slabs_mover.c` 756줄 신규. 커밋 본문: "**Removes `slabs_evictions_nomem` case entirely.** Instead of sometimes evicting random memory when re-assigning memory, it will pull from the LRU tail" | **12년 만에 "재배치는 아이템을 잃는다"가 사라졌다.** 새 지표 `extstore_memory_pressure`(0~100) |
| 2026-03-06 | **1.6.41** | 1.6.34 회귀 수정 — mover 정지, `slabs_mover=2` 크래시 | 큰 재작성의 청구서 |

`slabs_mover.c` 는 상태를 그대로 노출한다 — `enum move_status{MOVE_NONE, MOVE_PASS, MOVE_FROM_SLAB, MOVE_FROM_LRU, MOVE_BUSY, MOVE_BUSY_UPLOADING, MOVE_BUSY_ACTIVE, MOVE_BUSY_FLOATING, MOVE_LOCKED}` 와 `struct slab_rebalance{... busy_items, rescues, chunk_rescues, busy_nomem, busy_deletes, busy_loops}` 가 `move_status_text[]` 로 문자열까지 붙어 있다 `✓` 운영 판단은 두 줄로 끝난다 — **1.5.0 미만이면 calcification 이 여전히 실전 리스크**다. **1.6.34 이상이면 아이템 크기 분포가 시간에 따라 변해도 재시작 없이 버틴다**. 그런데 관리형에서 만나는 버전은 여전히 그 앞이다(§9) `Σ`

## 3. LRU 의 진화 — 4단 segmented LRU, 그리고 근사의 위치

`items.h` 첫 일곱 줄이 설계 전부다(`memcached 1.6.45:items.h:1-7`) `✓`

```c
#define HOT_LRU 0
#define WARM_LRU 64
#define COLD_LRU 128
#define TEMP_LRU 192

#define CLEAR_LRU(id) (id & ~(3<<6))
#define GET_LRU(id) (id & (3<<6))
```

LRU 종류를 `item->slabs_clsid` 의 상위 2비트에 인코딩하므로 **아이템당 추가 바이트가 0** 이고, 그 대가로 슬랩 클래스가 6비트(63개)로 제한된다(§2). 동작은 `doc/new_lru.txt` 와 `items.c` 가 정의한다 — 새 아이템은 HOT 으로 들어간다(`memcached 1.6.45:items.c:309-311`). 두 번 이상 히트된 것만 `ITEM_ACTIVE` 가 된다. **LRU 갱신은 아이템이 리스트 바닥에 도달할 때만** 일어난다. HOT/WARM 은 클래스 메모리의 20%/40%로 캡되고(`hot_lru_pct 20`, `warm_lru_pct 40`) 나이로도 캡된다 — `hot_age = cold_age × 0.2`, `warm_age = cold_age × 2.0`(`memcached 1.6.45:memcached.c:250-253`) `✓` TEMP_LRU 는 `temporary_ttl`(기본 61초) 이하 아이템 전용이고 "never bumped ... also cannot be evicted" 라, 짧은 TTL 아이템이 LRU 에 구멍을 내고 crawler 부하를 만드는 것을 차단한다 `✓`

목적은 문서에 명시돼 있다 — "The primary goal is to better protect active items from '**scanning**'" 과 "A secondary goal is to improve latency. **The LRU locks are no longer used on most item reads**" `✓` 뒤쪽이 실현되는 방식이 중요하다. 읽기 경로에서 워커는 LRU 락을 잡지 않고 스레드별 `lru_bump_buf`(bipbuf, `LRU_BUMP_BUF_SIZE 8192`)에 `{it, hv}` 를 적고 끝낸다. 배경의 `lru_maintainer_bumps()` 가 그것을 소비해 `do_item_update()` 를 실행한다. **버퍼가 꽉 차면 bump 를 그냥 버린다**(`b->dropped++`) `✓`

여기서 Redis 와의 대비가 선명해진다. Redis 8.10.0 `redis.conf` 는 정책 10개(`noeviction` + {volatile,allkeys}×{lru,lfu,lrm,random} + `volatile-ttl`)를 두고 "LRU, LFU, LRM and volatile-ttl are implemented using **approximated randomized algorithms**" 라고 적으며 `maxmemory-samples 5` 로 정확도-비용을 조절한다(`redis 8.10.0:redis.conf:1221-1240,1269`) `✓` `volatile-lrm`/`allkeys-lrm` 은 **8.6.0 신설**이다(8.4.0 `src/config.c` 에는 없고 8.6.0 에 있다) `✓`

| 축 | memcached | Redis |
|---|---|---|
| 근사가 일어나는 지점 | **접근 기록 쪽** — bump 를 비동기·손실 허용으로 미룬다. 축출 판정은 실제 LRU tail 에서 정확히 | **축출 판정 쪽** — 접근 시각은 키마다 정확히 기록하고, 버릴 대상만 표본으로 고른다 |
| 리스트 범위 | 슬랩 클래스별 × LRU 종류별 **독립 리스트**(`lru_locks[POWER_LARGEST]`) | 키스페이스 전역 표본 |
| 빈도 정보 | `ITEM_ACTIVE` **1비트**(2회 이상 히트). LFU 없음 | LFU 정책 존재(`allkeys-lfu` 등) |
| 만료 회수 | LRU crawler 전담 스레드. "만료 예상 아이템의 1% 이상을 회수할 수 있을 때만" 크롤하고 할 일이 없으면 최대 1시간(`MAX_MAINTCRAWL_WAIT`)까지 백오프 | lazy expire + active expire cycle |

그래서 memcached 에서는 "특정 크기대 아이템만 축출 압력을 받는" 현상이 생긴다. 그것이 §2 의 slab automove 를 **필수 부품으로** 만든다 — 두 메커니즘은 따로 배우면 안 된다 `Σ` 관측은 `stats items` 의 `moves_to_cold` / `moves_to_warm` / `moves_within_lru` / `evicted_active` / `direct_reclaims` 로 한다. 특히 `evicted_active` 가 크면 `hot_lru_pct`/`warm_lru_pct` 캡이 워크로드와 안 맞는다는 신호다 `✓`

## 4. 멀티스레드 — 왜 "코어를 수직으로 먹는다" 인가

{{< flow src="_flow/4-스레드-per-코어-대-단일-스레드.json" />}}

멀티스레드는 2006-11-22 Steven Grimm(Facebook)의 `--enable-threads` 로 들어왔고 2007-04 에 기본 경로가 됐다 `✓` 현재 구조에서 중요한 것은 세 가지다.

**첫째, 실행이 워커에서 끝난다.** `settings.num_threads` 기본 4(`-t N`)이고 `memcached_thread_init()` 이 `LIBEVENT_THREAD threads[nthreads]` 를 만들면 각 스레드가 `worker_libevent()`("Worker thread: main event loop", `memcached 1.6.45:thread.c:505-507`)에서 **자기 event base** 를 돌린다. 메인은 accept 만 하고 `dispatch_conn_new()` → `select_thread_round_robin()` 으로 배분한다. `settings.num_napi_ids` 가 있으면 `select_thread_by_napi_id(sfd)` 로 **NIC 큐와 워커를 맞춘다**(1.6.9) `✓`

**둘째, 경쟁은 해시값으로 샤딩된다.** `item_lock(hv)` 는 `item_locks[hv & hashmask(item_lock_hashpower)]` 를 잡는다. 락 테이블 크기는 워커 수로 결정된다 — 3 미만 1k, 4 미만 2k, 5 미만 4k, 10 이하 8k, 20 이하 16k, 그 외 32k. 소스 주석이 의도를 적는다 — "Want a wide lock table, but don't waste memory". 그리고 락 테이블이 해시 테이블보다 커지면 **시작 시 에러로 죽는다** `✓` 나머지 락은 `lru_locks[]`(클래스×LRU 종류), `slabs_lock` 하나, `stats_lock`, `conn_lock` 이고 통계는 per-thread 로 모아 필요할 때만 합산한다 `✓`

**셋째, 그래서 지는 지점도 정해진다.** 아이템 락은 해시값 샤딩이므로 **핫 키 하나는 결국 락 하나에 몰린다** — 단일 핫 키 워크로드에서는 `-t` 를 올려도 안 늘어난다 `Σ` 그리고 `-t` 는 코어 수보다 조금 적게 잡는다. lru_maintainer · lru_crawler · assoc 확장 · logger · slab mover · extstore IO 스레드가 별도로 코어를 먹기 때문이다 `Σ`

Redis 쪽 경계는 `redis.conf` 원문이 직접 그어 준다 — "Redis is **mostly single threaded**, however there are certain threaded operations such as UNLINK, slow I/O accesses and other things that are performed on side threads"(`redis 8.10.0:redis.conf:1381-1383`), 그리고 io-threads 는 "threads for **reads and protocol parsing**" 까지다. 같은 파일이 권하는 스케일 방식도 "spawn multiple instances in order to scale more" 다 `✓` Redis 6.0 threaded I/O 의 내부 경계(fan-out/fan-in 배리어)는 [01 · 2009 첫 커밋부터 6.2 까지]({{< relref "../01-origins-and-design/index.md" >}})가, Valkey 8.0 이 그것을 어떻게 바꿨는지는 [05 · Valkey 8.0 → 9.1]({{< relref "../05-valkey-8-to-9/index.md" >}})가 소유한다.

운영 모델의 차이가 성능 숫자보다 앞선다. **memcached 16코어 = 프로세스 1개 = 설정 1벌**이고, **Redis 16코어 = 프로세스 여러 개 = 슬롯·리샤딩·클라이언트 인식**이다([06 · cluster mode]({{< relref "../06-cluster-mode/index.md" >}})) `Σ` 반대로 Redis 의 단일 실행 스레드는 MULTI/EXEC·Lua·다중 키 커맨드의 원자성을 공짜로 준다. memcached 는 그것을 원리적으로 줄 수 없다 `✓`

### 4.1 해시 테이블 — 확장에 STW 가 없다

스레드 모델을 떠받치는 부품이 인덱스다. `assoc.c` 는 `primary_hashtable` 과 `old_hashtable` **두 개를 동시에 유지**한다. 기본 `HASHPOWER_DEFAULT 16`(65536 버킷), 상한 32 이고, `curr_items > (hashsize(hashpower) * 3) / 2`(**로드 팩터 1.5 초과**)이면 확장이 시작된다 `✓` 확장 중 조회·삽입·삭제는 `expanding && (hv & hashmask(hashpower - 1)) >= expand_bucket` 로 분기해 **아직 안 옮긴 구간은 옛 테이블에서, 옮긴 구간은 새 테이블에서** 읽는다. 실제 이동은 `assoc_maintenance_thread` 가 `hash_bulk_move`(기본 1) 버킷씩 한다. 소스 주석이 요령을 자랑한다 — "So we can process expanding with only one item_lock. **cool!**" 새 테이블의 두 후보 버킷이 같은 아이템 락 샤드에 들어가도록 비트를 잡았기 때문이다 `✓`

대가는 두 곳에 있다. 기본 `hash_bulk_move 1` 은 매우 보수적이라 아이템이 수억 개면 확장이 길게 늘어지고, 해시 테이블 메모리(`hashsize(hashpower) × 8B` — hashpower 26이면 512MB)는 **`-m` 과 별도로** 잡힌다 `✓` 그래서 캐시 규모를 알면 `-o hashpower=N` 으로 처음부터 크게 잡는 것이 정석이다(`--help` 도 "set based on 'STAT hash_power_level'" 로 안내한다). 감시는 `stats` 의 `hash_power_level`·`hash_is_expanding`·`hash_bytes` 로 한다. `-o no_hashexpand` 는 help 가 직접 "(dangerous)" 라고 적어 둔 스위치다 `✓`

## 5. 버전별 진화 — ChangeLog 가 끊긴 뒤는 태그로 확정한다

먼저 함정을 치운다. `ChangeLog.txt` 로 전 버전 변경 내역을 알 수는 **없다.** 파일이 2009-04-10 항목에서 실질적으로 끊긴다. 자기 최상단에 "2010-10-11 ChangeLog is no longer being updated" 와 "2016-08-23 ChangeLog moved from Google Code to Github Wiki" 를 적어 둔다 `✓` 그래서 아래 표에서 1.4 중반 이후 항목의 도입 버전은 **wiki 릴리스노트 + `git tag --contains <commit>` + 태그 creatordate** 로 확정한 것이다 — ChangeLog 에는 한 줄도 없다 `✓`

| 버전 | 릴리스 | 무엇이 추가됐나 | 왜 |
|---|---|---|---|
| 1.0.2 | 2003-06-15 | GPL → **BSD-3** | 이후 23년 무변경 |
| 1.1.0 | 2003-06-20 | Judy 제거, **자체 해시 테이블** | "judy caused memory fragmentation" |
| 1.2.0 | 2006-09-09 | **UDP 인터페이스**, **멀티스레드**(`--enable-threads`), 해시 테이블 동적 확장, LRU 재배치를 분당 1회로 제한 | Facebook·LiveJournal 규모의 CPU·커넥션 압력 |
| 1.2.4 | 2007-12-06 | **CAS**, `append`/`prepend`, 64bit incr/decr | 다중 클라이언트 read-modify-write 를 원자화 |
| 1.2.5-rc1 | 2008-03-02 | `noreply`, IPv6, UDP 기본 활성 | 왕복 제거 |
| **1.4.0** | 2009-07-09 | **binary protocol 정식 라인 시작**(`protocol_binary.h` 초안 2008-04-29, "Protocol: Binary complete" 2009-03-11) | 텍스트 파싱 비용과 엄격한 포맷 요구 |
| **1.4.8** | 2011-10-04 | ASCII **`touch`** + binary **TOUCH/GAT/GATQ** | TTL 연장을 위해 값을 다시 쓰지 않게 |
| 1.4.11 | 2012-01-16 | `slab_reassign` + `slab_automove` | calcification 첫 공식 해법(§2.1) |
| **1.4.18** | 2014-04-17 | **LRU crawler**, 해시 알고리즘 선택(jenkins/murmur3) | 만료 아이템을 축출 없이 배경 회수 |
| **1.4.23** | 2015-04-19 | **lru_maintainer = HOT/WARM/COLD segmented LRU**(opt-in `-o lru_maintainer`) | scanning 워크로드에서 active 아이템 보호 |
| 1.4.26 | 2016-06-17 | `logger.c` — `watch` 라이브 로깅 | 집계 카운터로 안 보이는 이벤트 |
| 1.4.35 | 2017-02-26 | **TEMP_LRU** + `temporary_ttl` | 짧은 TTL 아이템의 LRU·crawler 오염 차단 |
| 1.4.38 | 2017-06-24 | 윈도우 기반 slab automove 알고리즘 | 축출 카운트 판정의 오작동 |
| **1.5.0** | 2017-07-21 | `-o modern` 을 **기본값으로 승격** — `lru_segmented`·`slab_reassign`·`slab_automove`·lru_maintainer·lru_crawler·murmur3 | "새 기본값을 미리 켜 보게" 한 1.4.39 의 후속 |
| **1.5.4** | 2017-12-20 | **extstore**(실험, `--enable-extstore`) — 값만 SSD/NVMe 로 | DRAM 가격을 NVMe 가격으로 치환(Netflix 프로덕션 검증) |
| 1.5.6 | 2018-02-27 | **UDP 기본 off** | 증폭 DDoS 반사체 + extstore 비호환 |
| **1.5.13** | 2019-04-15 | **TLS**(실험, OpenSSL 1.1.0+, Netflix 기여) | 신뢰 경계 밖 트래픽 |
| **1.5.18** | 2019-09-17 | **restartable cache**(`-e`, SIGUSR1) | 재시작 시 cold cache thundering herd 회피 |
| **1.5.19** | 2019-09-30 | **meta 커맨드**(실험, 문법 변경 가능 명시) | 고수준 커맨드 폭발을 플래그 시스템으로 대체 |
| **1.6.0** | 2020-03-08 | **meta 정식화 + binary protocol 공식 deprecated**, extstore 기본 컴파일, 응답 syscall 배칭(CPU 최대 25%↓), 유휴 커넥션 4.5KB → 400~500B | binprot 은 "ASCII 래퍼" 이상이 못 됐고 확장이 어색했다 |
| 1.6.9 | 2020-11-20 | NAPI ID 기반 워커 선택 | NIC 큐 ↔ 워커 친화도 |
| **1.6.13** | 2022-01-12 | **내장 proxy**(Lua, "non production ready" 명시) | mcrouter/twemproxy 를 같은 바이너리로 흡수 |
| **1.6.23** | 2024-01-09 | **proxy API v2 + routelib** — 백엔드 I/O 기본을 워커 스레드로(`mcp.backend_use_iothread`) | 공식 문서가 proxy 를 "starting with version 1.6.23" 으로 안내 |
| **1.6.34** | 2024-12-22 | **`slabs_mover.c` 재작성** — 페이지 이동 시 랜덤 축출 제거, `extstore_memory_pressure` 신설 | §2.1 |
| 1.6.38~1.6.39 | 2025-03-19 / 2025-07-28 | extstore 누수·TLS 파이프라인 hang·ARM alignment 수정. 신기능 없음 | — |
| **1.6.40** | 2025-12-16 | **`mg` 조건부 CAS 값 페치**(CAS 일치 시 값 생략), SIGHUP TLS 인증서 리로드 | tiered cache 재검증에서 대역폭 절감 |
| 1.6.41 | 2026-03-06 | 1.6.34/1.6.40 회귀 수정(mover 정지, extstore 압축 중 데이터 손실) | — |
| 1.6.42 | 2026-05-18 | **보안 릴리스 12건** — SASL 타이밍 사이드채널, binprot 오버플로, proxy 언더플로 | "보안 리포트 물량이 너무 많아 개별 정밀 검토를 못 했다" |
| 1.6.43 | 2026-07-02 | binprot refcount 오버플로. **`lru_crawler metadump`/`mgdump` 가 스트림 앞에 `OK\r\n` 을 붙인다** | 스펙 준수지만 **기존 툴링이 깨진다** |
| 1.6.44 | 2026-07-06 | proxy 대용량 값 오버플로, crawler 버퍼 오버플로 | — |
| **1.6.45** | 2026-07-09 | 30여 건 수정, 신기능 없음, dormando 단독 33 커밋 | "I'm trying to find every bug possible in hopes of slowing down the deluge of security reports" |

세 개는 별도로 붙여 둔다.

**extstore 는 영속성이 아니다.** 키·메타데이터·해시 테이블은 RAM 에 남고 값만 플래시로 내려가며(RAM 에 12바이트 위치 헤더 + bucket 당 8MB write buffer), 공식 문서가 "**All data is tracked in memory. A restart of memcached effectively empties flash**" 라고 못박는다 `✓` `ext_item_size` 기본 512B 미만은 안 내린다. `ext_recache_rate` 로 뜨거운 아이템이 RAM 으로 복귀한다. `ext_max_frag`(0.9) 기준으로 compaction 이 돈다. UDP·restartable cache 와 **동시 사용 불가**다 `✓`

**restartable cache 도 영속성이 아니다.** `-e /tmpfs_mount/file` 로 아이템 메모리를 mmap 파일에 두고 SIGUSR1 로 종료하면 재시작이 캐시를 물려받는다(10억 아이템급 2~3분). 그런데 `-m`·최대 아이템 크기·청크 설정·CAS 활성 여부·slab reassign 허용 여부를 **바꾸면 캐시가 통째로 빈다**. 죽어 있는 동안 시스템 시계가 튀면 `rel_time_t` 기반 TTL 계산이 깨진다. 무엇보다 "**Deletes, sets, adds, incr/decr/etc commands will be missed while instance restarts**" — 재시작 창의 무효화를 놓친다 `✓` 목적은 복구가 아니라 **버전 업그레이드 시 cold cache 회피**이고, stale 을 감당할 수 있는 워크로드에서만 쓸 수 있다 `Σ`

**meta 는 문법 설탕이 아니다.** `mg`/`ms`/`md`/`ma`/`mn`/`me` 는 `<cm> <key> <datalen*> <flag1> <flag2>...` 형태에 2문자 응답 코드(`HD`/`VA`/`EN`/`NS`/`EX`)를 쓴다. dormando 가 PR #484(2019-04-30)에 적은 이유가 설계를 설명한다 — 고수준 커맨드를 계속 추가하면 "a **slow command with compatibility issues**" 가 되므로 플래그 시스템으로 갔다는 것이다 `✓` 그 결과로 얻은 것이 **프로토콜에 내장된 캐시 정합성 원시연산**이다 — 미스 시 한 클라이언트만 `W`(win) 을 받아 재계산 권한을 갖고 나머지는 `Z` 를 받는 **원자적 stampede 방어**, `md` 로 stale 표시 후 serve-stale/재검증, `q`+`O<token>` 파이프라이닝과 `mn` 배리어, base64 키, `h`/`l` 핫키 힌트, 서버가 **완전히 무시하는** `P`/`L` 프록시 힌트 `✓` binary protocol 은 1.6.0 이후 "will be supported and fixes provided for years to come, but it **will not receive new commands or updates**" 다. 실제로 2026년 binprot 커밋은 전부 크래시·오버플로 수정이다 `✓`

## 6. 내장 proxy — mcrouter 를 서버 바이너리 안으로

memcached 에는 복제도 클러스터 버스도 없으므로(§7) 샤딩은 전통적으로 **클라이언트의 consistent hashing**(ketama 등) 몫이었고, 그 위에 mcrouter(Facebook)·twemproxy 같은 별도 라우팅 계층을 얹는 것이 관행이었다. 1.6.13(2022-01-12)부터 **같은 바이너리가 프록시 모드로 뜬다** — `proto_proxy.c` + Lua 설정이다. 1.6.45 트리의 proxy 파일은 19개(`proxy_config.c`·`proxy_lua.c`·`proxy_network.c`·`proxy_ring_hash.c`·`proxy_jump_hash.c`·`proxy_ratelim.c`·`proxy_tls.c` 등)다. 링크에 `vendor/lua/src/liblua.a` 와 `vendor/routelib/routelib.h` 가 들어간다 `✓`

하는 일은 라우팅이다 — 공식 문서 표현으로 "forwards cache requests to pools of backends that you define" 다. 클라이언트는 엔드포인트 하나만 알면 된다. 키 프리픽스·TCP 포트·핸들러 인자로 경로를 정하고, 백엔드 풀에 consistent hashing 으로 분배하고, **pool → set → zone 계층으로 failover 우선순위**를 구성한다. 텍스트·meta 프로토콜 모두 지원한다. 관측은 `watch` 의 proxy 전용 채널 세 개(`proxyreqs`·`proxyevents`·`proxyuser`)와 `proxy_ustats.c` 의 사용자 정의 카운터로 한다 `✓` 도입 버전이 두 개로 읽히는 이유도 여기 있다 — 코드가 처음 릴리스에 들어간 것은 1.6.13("non production ready" 명시)이다. **공식 문서가 안내하는 기준선은 API v2·routelib 가 들어온 1.6.23** 이다 `✓`

**그래도 이것은 복제가 아니다.** 백엔드 사이에 데이터 동기화가 없으므로 노드가 죽으면 그 데이터는 여전히 사라진다 `✓` 그리고 두 가지 경고가 붙는다. `configure.ac` 는 1.6.45 에서도 proxy 를 `EXPERIMENTAL` 로 표기하고 기본 빌드에 넣지 않는다 — **배포판 패키지로는 못 쓰고 직접 빌드해야 한다** `✓` 또 2026년 보안·크래시 수정이 **proxy 코드에 몰려 있다**(1.6.42 버퍼 언더플로, 1.6.44 대용량 값 오버플로, 1.6.45 의 33 커밋 중 절대다수가 `proxy:` 접두사). 신뢰 경계 밖에 노출하는 구성은 아직 이르고, 켠다면 패치 추적이 상시 업무가 된다 `Σ`

커넥션 수가 문제라서 UDP 를 떠올린다면 그 길은 이미 닫혀 있다 — **UDP 포트는 1.5.6(2018-02-27)부터 기본 off** 이고(`dbb7a8a` "disable UDP port by default"), extstore 와 병용도 불가하며, `protocol.txt` 자체가 "실패해도 되는 연산에만" 쓰라고 못박는다. 2026년의 답은 proxy 나 커넥션 풀링이다 `✓`

## 7. Redis 와의 구조 대비 — 이 문서의 결론표

| 축 | memcached 1.6.45 | Redis 8.10.0 / Valkey 9.1.1 |
|---|---|---|
| **자료 모델** | 불투명 blob 하나. key(≤250B) → value(기본 ≤1MB, `-I` 로 1KB~1GB) + client flags + TTL + CAS. **서버가 값을 해석하지 않는다** | String/List/Hash/Set/ZSet/Stream/Bitmap/HLL/Geo + 모듈(JSON·Search·Vector 등). **서버가 자료구조 연산을 수행** |
| **커맨드 표면** | 텍스트 기본 ~15개 + meta 6개(플래그 조합) + 관리 커맨드. `protocol.txt` 25 섹션 | 240+ 커맨드 + 모듈 커맨드 |
| **스레드** | 워커 N개(`-t`, 기본 4)가 **각자 이벤트 루프**. read·parse·execute·write 전부 워커에서. 한 프로세스가 N 코어 | "mostly single threaded". io-threads 는 소켓 read/write + 프로토콜 파싱까지, **커맨드 실행은 메인 스레드**. 권고 스케일은 인스턴스 다중화 |
| **락** | 아이템 락 샤딩(1k~32k mutex, 워커 수로 결정) + LRU 락(클래스×종류) + slab 락 1개 | 실행 경로에 락 없음. 대신 **커맨드 하나가 길면 전체가 막힌다** |
| **원자성 단위** | **아이템 1개.** CAS·incr/decr·add/replace·append/prepend·meta 플래그. 다중 키 트랜잭션·스크립팅 **없음** | MULTI/EXEC/WATCH, Lua `EVAL`, Functions. 다중 키 원자성이 자연스럽다 |
| **할당** | **자체 slab allocator.** 1MB 페이지, 청크 클래스 기본 38개, factor 1.25. calcification 을 `slab_reassign`+`automove`+`slabs_mover` 로 상쇄 | jemalloc + `activedefrag`. `MEMORY USAGE`/`MEMORY DOCTOR` 로 진단 |
| **아이템 오버헤드** | 헤더 **48B**(CAS 시 **56B**) + key+1 + (flags≠0 이면 4B) + value + **청크 반올림 슬랙**. 해시 테이블은 `hashsize(hashpower)×8B` 별도 | robj + sds + dict entry + expire dict entry + jemalloc 반올림. **1:1 대응 수치는 미확인** `?` |
| **축출** | 슬랩 클래스별 **4단 segmented LRU** + age 캡 + `ITEM_ACTIVE` 1비트. **LFU 없음.** `-M` 로 축출 대신 OOM 에러. crawler 가 만료 배경 회수 | 정책 10개(`{volatile,allkeys}×{lru,lfu,lrm,random}` + `volatile-ttl` + `noeviction`), 전부 approximated randomized, `maxmemory-samples 5`. `lrm` 은 8.6.0 신설 |
| **영속성** | **없음.** extstore 는 재시작하면 플래시도 비고, restartable cache 는 프로세스 재시작만 생존한다(노드 사망 시 소실). 둘은 동시 사용 불가 | RDB 스냅샷 + AOF(`everysec`/`always`/`no`) + 하이브리드. **실제 복구 가능** |
| **복제** | **없음.** 서버는 자기가 클러스터의 일부인지 모른다. 2008-09 에 "managed instance code" 를 제거한 이력이 있다 | 비동기 복제(`REPLICAOF`), 부분 재동기(PSYNC/PSYNC2), Sentinel 자동 failover |
| **클러스터링** | **클라이언트 consistent hashing**(ketama)이 정석. 1.6.13+ 내장 proxy 가 백엔드 풀·ring/jump hash·set/zone failover 를 서버로 가져왔지만 **라우팅이지 복제가 아니다** | Redis Cluster **16384 슬롯**, gossip 버스, MOVED/ASK, 슬롯 마이그레이션 |
| **프로토콜** | 텍스트(2003~) / binary(1.4.0 정식 → **1.6.0 deprecated**) / **meta**(1.5.19 → 1.6.0 정식). 한 커넥션에서 텍스트·meta 혼용, 리스너별 프로토콜 지정 | RESP2 / RESP3(6.0+, `HELLO 3`) — push·map·set 타입 |
| **캐시 원시연산** | meta 에 **stampede 방어(`W`/`Z`)**, serve-stale, quiet+opaque 파이프라이닝, base64 키, `mg` 조건부 CAS 페치(1.6.40) | 동등 기능은 Lua·애플리케이션 레벨. **프로토콜 내장 stampede 방어는 없다** |
| **TLS** | 1.5.13(2019-04-15) 실험 도입. 리스너별 `notls`/`btls`/`mtls` 혼용, SIGHUP 인증서 리로드(1.6.40). proxy 백엔드 TLS 는 별도 EXPERIMENTAL 플래그 | 6.0(2020-04) GA. 클라이언트·복제·클러스터 버스 각각 설정 |
| **인증·인가** | SASL(`-S`, binprot 기반) + ASCII auth(`-Y`, **EXPERIMENTAL**, 2026년까지 크래시 수정). **ACL 없음** | `requirepass` + **ACL**(6.0+): 유저·커맨드 카테고리·키 패턴·채널 단위 |
| **멀티테넌시** | 네임스페이스·DB **없음.** 키 프리픽스 규약 + `-D` 프리픽스 stats + 인스턴스 분리 + proxy 라우팅. `-X`/`-W`/`-F` 로 덤프·워치·flush_all 차단이 사실상 유일한 하드닝 | 논리 DB(`SELECT`) + ACL 로 실질 격리 |
| **관측성** | `stats`/`settings`/`items`/`slabs`/`sizes`/`conns`/`detail`, `lru_crawler metadump`, **`watch` 라이브 스트림**(fetchers·mutations·evictions·connevents·deletions·proxy×3, 링버퍼라 **유실 가능**), DTrace. **키별 메모리·slowlog·레이턴시 히스토그램 없음** | `INFO`, `MONITOR`, `SLOWLOG`, `LATENCY`, `CLIENT LIST`, keyspace notification, `MEMORY USAGE/DOCTOR` |
| **라이선스** | **BSD-3(Danga Interactive, 2003)** — 23년 무변경, 라이선스 유발 포크 없음 | Redis 7.4.0 RSALv2+SSPLv1 → 8.0.0 +AGPLv3 트라이 / Valkey BSD-3(→ [03]({{< relref "../03-license-and-fork.md" >}})) |
| **거버넌스** | dormando **단독**(2026년 커밋 60/76). 날짜 박힌 EOL 캘린더 없음 — EOL 정책은 2020-07-08 메일링리스트 답변으로만 존재 | Redis: 짝수 마이너 케이던스 + Standard/Extended 지원선 / Valkey: Linux Foundation `GOVERNANCE.md` |

관측성 행에 한 줄 덧붙인다. memcached 에 slowlog 가 없는 것은 누락이 아니다 — 모든 커맨드가 단일 아이템 연산이라 **"느린 커맨드"라는 개념 자체가 성립하지 않는다.** `KEYS *`·큰 `ZRANGE`·`SORT`·오래 도는 Lua 에 대응하는 것이 없다 `Σ`

## 8. 언제 memcached 가 이기고, 언제 지나

### 이기는 자리

**① 순수 캐시 워크로드에서 CPU 가 아니라 NIC 가 병목이 된다.** ScyllaDB 의 3자 벤치마크(2024-10-08, i4i.4xlarge 16 vCPU, memcached 1.6.25, 14 스레드 pin)는 RAM-only read 에서 **3M GET/s** 로 "fully maximizing AWS NIC bandwidth (25 Gbps)", p99.999 < 1ms 를 보고한다 `Ⓑ`(발행 주체가 경쟁 제품 벤더라는 점, 측정 조건이 위와 같다는 점을 함께 읽어야 한다). dormando 자체 측정은 Xeon 32코어에서 순수 RAM multiget **18M keys/s** 다 `Ⓥ`(2018-06-12, 자체 블로그). **memcached 와 Redis 를 같은 하드웨어에서 1:1 로 측정한 1차 출처는 없다** — 그래서 배수 주장은 하지 않고, 구조적 근거(§4)만 쓴다 `?`

**② extstore 는 캐시 용량을 DRAM 가격이 아니라 NVMe 가격으로 산다.** dormando 의 측정(2018-06-12, Xeon 32코어 / 192GB RAM / Optane 750GB, **IO 스레드 4개·클라이언트 4개**)은 Optane **230k ops/s**(레이턴시 10μs 대), SSD **40k ops/s**(100μs\~1ms)이고, 비용 근거는 "DRAM costs are 3-4x Optane, and 4-8x SSD" → RAM 지출 1/3, 워크로드에 따라 총비용 최대 80% 절감이다 `Ⓥ` 3자 측정(ScyllaDB, 2024-10-08, i4i.4xlarge, memcached 1.6.25, **extstore IO 스레드 32개**)은 1KB 값 **182k GET/s**(개별 요청, P99 < 1ms), 8KB 값 **105k GET/s** 다 `Ⓑ` 조건이 좁다 — 값이 키보다 훨씬 커야 하고(`ext_item_size` 기본 512B 미만은 안 내려간다), 저장 효율 기대치가 80\~90% 이고, 파이프라인 구성에서는 P99 가 3\~5ms 로 올라간다. **sub-ms SLO 경로에는 못 쓴다** `Σ` 오픈소스 Redis 에는 동등 기능이 없다 — 릴리스노트 7.x/8.x 전체와 `redis 8.10.0:redis.conf` 에 `flash`/`tiering` 계열 문자열이 0건이고, Redis on Flash 는 Redis Software 문서 경로에만 있는 상용 기능이다 `✓`

**③ 아이템당 메타데이터가 얇다 — 48B, CAS 포함 56B.** `struct _stritem` 을 세면 그대로 나오고(`memcached 1.6.45:memcached.h:613-636`), 레포에 이 값을 찍는 전용 툴 `sizes.c` 가 있다 `✓` 다만 "얇다"는 **헤더가 얇다**는 뜻이고 총 오버헤드가 작다는 뜻이 아니다 — 키 20B + 값 100B + CAS 는 `48+8+20+1+100 = 177B` 라서 **192B 청크**에 담기고, 순수 데이터 120B 대비 **오버헤드 60%** 다 `≈` 값이 1KB 면 1184B 청크로 약 15% 다 `≈` 그래서 작은 값 위주 워크로드에서는 `-f` 를 낮추고, 값을 묶고, 필요하면 `-C` 로 CAS 8B 를 뺀다(단 restartable cache 와의 호환에 영향) `Σ`

**④ 지연이 예측 가능하다.** 전체를 멈추는 커맨드가 없고, 백그라운드 작업은 전부 스레드로 분리된 뒤 백오프한다 — lru_maintainer 는 1ms~1s 슬립을 `backoff_juggles` 로 증감하고(주석: "1000 loops with 1ms min sleep gives us under 1m items shifted/sec. **The locks can't handle much more than that**"), crawler 는 할 일이 없으면 최대 1시간까지 물러나고, 해시 확장은 STW 없이 두 테이블을 동시에 서비스한다(§4.1) `✓` 즉 "느린 커맨드가 없다"는 것은 커맨드 표면이 좁다는 사실의 결과이고, 그 대신 배경 작업의 진척을 지표로 봐야 한다는 뜻이다 `Σ`

**⑤ 운영 표면적이 작다.** 프로세스 1개, 설정 파일 없이 CLI 플래그, 복제·AOF/RDB·클러스터 버스·Sentinel 없음 — **틀릴 수 있는 것이 적다.** 최소 구성(사설망 + 텍스트/meta, proxy·SASL·TLS·extstore 미사용)이면 2026년 보안 릴리스가 건드린 표면(proxy·binprot·auth)을 거의 스치지 않는다 `Σ`

**⑥ 캐시 무효화 원시연산이 프로토콜 안에 있다.** stampede 방어와 serve-stale 이 서버에서 원자적이다(§5). Redis 에서 같은 것을 하려면 Lua 나 SETNX 락 패턴을 애플리케이션에 짜야 한다 `Σ`

### 지는 자리

| 무엇 | 왜 |
|---|---|
| **자료구조가 필요한 순간** | 리더보드·큐·셋 연산·카운터 집계·지리 검색·벡터 검색은 값 전체를 읽어 앱에서 고치고 다시 쓰는 방법밖에 없고, 그건 원자적이지 않다(CAS 재시도 루프가 최선이다) `✓` |
| **다중 키 원자성** | MULTI/EXEC·Lua·Functions 에 대응하는 것이 **전혀** 없다 `✓` |
| **복제·failover** | 노드가 죽으면 그 데이터는 사라진다. consistent hashing 이면 영향 범위는 1/N 이지만 **thundering herd** 가 온다 — 그래서 meta 의 `W`/`Z` 와 `-e` 가 실전에서 중요해진다 `Σ` |
| **영속성** | extstore·restartable cache 둘 다 영속성이 아니고 동시 사용도 못 한다(§5) `✓` |
| **인증·인가·격리** | ACL 없음, 네임스페이스 없음, ASCII auth 는 1.6.45 에서도 EXPERIMENTAL 이고 2026-07 까지 크래시 수정이 나왔다. **멀티테넌트 공유 환경에 부적합** `✓` |
| **진단 도구** | slowlog·레이턴시 히스토그램·키별 메모리 조회가 없고 `watch` 스트림은 링버퍼라 유실된다 `✓` |
| **클라이언트 생태계** | meta 를 지원하는 클라이언트가 제한적이라, memcached 의 최신 강점을 쓰려면 선택지가 좁아진다 `Σ` |
| **관리형 경로** | §9 |
| **버스 팩터** | 2026년 커밋의 79%가 한 사람이고, 날짜가 박힌 EOL 캘린더가 없다 — 컴플라이언스가 "지원 종료일 문서"를 요구하면 실제 장애물이 된다 `Σ` |

판정은 한 문장으로 압축된다. **memcached 는 "캐시 이외의 요구가 하나도 없을 때" 이기고, 그 조건이 하나라도 깨지면 진다** — 값이 blob 이고, 잃어도 되고, 다중 키 원자성이 필요 없고, 코어당 처리량과 지연 예측성이 중요하고, 배포·업그레이드를 직접 감당할 수 있을 때다 `Σ` 3자 판단표는 [08 · 무엇을 고를 것인가]({{< relref "../08-choosing.md" >}})가 소유한다.

## 9. 관리형 현황 — 두 줄

**ElastiCache for Memcached** 에서 웹으로 확인 가능한 최신 지원 발표는 **1.6.22(2024-01-11)** 이고 그 뒤 발표는 재검색으로도 찾지 못했다 — 오픈소스 최신 1.6.45 와 23개 마이너 차이이며 그 사이의 1.6.34 mover 재작성·1.6.40 `mg` 조건부 CAS·1.6.42/43/45 보안 수정을 받지 못한다는 뜻이다 `✓` **GCP Memorystore for Memcached 는 deprecated** 다 — **2027-02-01** 부터 신규 프로젝트에서 생성 불가, **2029-01-31** 완전 종료, Valkey 이관 권고이고 지원 버전은 1.5.16(기본)/1.6.15 두 개뿐이다 `✓` 엔드포인트·auto-discovery(`.cfg.` CNAME)·모드 전환 등 AWS 쪽 상세는 [07 · AWS 엔드포인트]({{< relref "../07-aws-endpoints/index.md" >}})가 소유한다.

## 10. 근거

- **소스**: 로컬 blobless 클론 `~/evejuni/memcached`(태그 1.6.45) — `items.h:1-7`(4단 LRU 인코딩), `items.c:309-311`(신규 아이템 = HOT), `memcached.h:613-636`(`struct _stritem`, 48/56B), `memcached.c:240`("The famous 1MB upper limit."), `memcached.c:250-253`(LRU 캡·age factor), `memcached.c:258-259`(1.5.0 이 승격한 slab 기본값), `slabs.c:1-7`(slab 정의 주석), `slabs_mover.c`(`move_status` 열거), `slab_automove.c`(윈도우 알고리즘), `thread.c:505-507`(`worker_libevent`), `assoc.c`(점진적 리해시), `sizes.c`, `doc/new_lru.txt`, `doc/protocol.txt`, `doc/storage.txt`, `LICENSE`. 대비군은 `~/evejuni/redis`(태그 8.10.0) — `redis.conf:1221-1240`(축출 정책·approximated randomized)과 `redis.conf:1269`(`maxmemory-samples`), `redis.conf:1381-1383`("mostly single threaded"), `src/config.c`(8.4.0 에 없고 8.6.0 에 있는 `lrm`).
- **커밋**: `32f382b`(2003-05-27 첫 커밋), `60d7094`(slab 도입), `f6d334e`(Judy 제거), `d72b1a2`(slab reassignment 첫 시도), `5c43b80`(automove 알고리즘), `3f3e137`(1.5.0 기본값 전환), `f593a59`(extstore base), `ee1cfe3`(TLS), `1e14628`(meta), `d22b664`(proxy 초기), `4c56c8d`(1.6.34 mover 재작성), `dbb7a8a`(UDP 기본 off).
- **릴리스일**: `git for-each-ref --format='%(creatordate:short)'` 로 1.4.0 이후 태그를 직접 확인하고 wiki 릴리스노트와 교차 검증했다. 1.2.x 이하는 `ChangeLog.txt` 항목 기준이다(태그가 2009-03 에 소급 생성됨). `ChangeLog.txt` 는 2009-04-10 에서 끊기므로 1.4 중반 이후 도입 버전은 wiki 릴리스노트 + `git tag --contains` 로 확정했다.
- **문서·발표**: GitHub wiki `ReleaseNotes` 1411 / 150 / 154 / 160 / 1513 / 1518 / 1519 / 1613 / 1623 / 1634 / 1638~1645, `docs.memcached.org` 의 flashstorage · restart · proxy · meta 페이지, memcached.org 블로그 "NVM caching"(2018-06-12), PR #484(meta 제안, 2019-04-30), memcached 메일링리스트 EOL 답변(2020-07-08).
- **3자 측정**: ScyllaDB "ScyllaDB and Memcached"(2024-10-08) — i4i.4xlarge, memcached 1.6.25, 14 스레드 pin. 벤더 발행물이므로 조건과 함께만 인용했다.
- **미확인으로 남긴 것**: Redis 의 아이템당 메모리 오버헤드를 memcached 의 48/56B 와 1:1 로 대응시킬 1차 출처 `?` · memcached 와 Redis 를 동일 하드웨어에서 비교한 1차 벤치마크 `?` · proxy 가 "production ready" 로 선언된 버전(`configure.ac` 는 1.6.45 에서도 EXPERIMENTAL) `?` · restartable cache 의 DAX/persistent memory 경로가 Optane PMEM 단종 이후에도 실용적인지 `?` · ElastiCache for Memcached 의 날짜 박힌 EOL 캘린더 `?` · 1.6.42 보안 수정의 CVE 매핑(릴리스노트가 개별 부여하지 않았다) `?`
- 챕터 전체 URL 목록은 [99 · 출처]({{< relref "../99-sources.md" >}})가 모은다.

