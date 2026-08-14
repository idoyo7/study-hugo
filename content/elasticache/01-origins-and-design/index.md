---
title: "2009 첫 커밋부터 6.2 까지"
weight: 1
---

# 01 · 자료구조 서버는 왜 이렇게 생겼나 — 2009 첫 커밋부터 6.2 까지

{{< callout type="info" >}}
**한눈에**
- **최초 문제는 "캐시가 필요하다"가 아니라 "값이 blob 이면 안 된다"였다.** 첫 커밋에 동봉된 FAQ 가 프로젝트 시작 이유를 한 줄로 적는다 — `In order to scale LLOOGG.`(`redis ed9b544e1:doc/FAQ.html`) 그리고 같이 동봉된 `doc/README.html` 이 memcached 와의 차이를 자료형과 영속성 두 축으로만 설명한다 `✓`
- **첫 커밋(2009-03-22 `ed9b544e1`)은 캐시가 아니었다.** `saveDb()` 가 `.rdb` 로 쓰고 매직 `REDIS0000` 을 박고, `fork()` 기반 BGSAVE 와 `save 900 1 / save 300 10 / save 60 10000` 이 이미 있다 — 그 3줄은 6.0.0 의 기본값과 값까지 동일하다 `✓`
- **반대로 없던 것이 더 많다** — EXPIRE·hash·sorted set·AOF·epoll·RESP·MULTI·pub/sub·Lua·Cluster·`src/` 전부. 이벤트 루프는 연결 리스트 + `select(2)` 단일 구현이고 응답은 `nil\r\n`·`0\r\n` 같은 **타입 프리픽스 없는 raw 문자열**이다 `✓`
- **단일 스레드는 성능 최적화가 아니라 API 계약이었다.** "락을 지원하지 않는다, 대신 원자 프리미티브를 준다"가 day-1 문서의 답이고(`ed9b544e1:doc/README.html`), `INCR`·`LPUSH`·`SINTERSTORE` 가 별도 동기화 없이 원자인 이유가 이것뿐이다 `Σ`
- **MANIFESTO 는 두 판본이다.** v1 은 2011-03-01(`be14f38de`, 7개 항목)이고 스레딩 항목이 없다. **`7 - Threading is not a silver bullet` 은 2019-03-18 v2(`a5af648fd`)에서 추가됐다** — 6.0.0 GA(2020-04-30)보다 약 13개월 앞서, 같은 문단이 `we may explore parallelism only for I/O, which is the low hanging fruit` 라고 예고한다 `✓`
- **버린 것이 철학을 더 잘 보여준다.** Virtual Memory 는 2.0 에 `vm-enabled` 로 실렸고, 2.4 conf 가 `WARNING! Virtual Memory is deprecated in Redis 2.4` 를 붙였고, **2.6.0 에서 제거**됐다(`Virtual Memory removed (was deprecated in 2.4)`). 그 자리를 MANIFESTO 2번 `Memory storage is #1` 이 대신 지킨다 `✓`
- **6.0 threaded I/O 는 커맨드를 병렬로 돌리지 않는다.** 워커가 하는 일은 `writeToClient()` 또는 `readQueryFromClient()` 둘 중 하나뿐이고, 커맨드는 배리어 통과 뒤 메인 스레드의 `processCommandAndResetClient()` 가 실행한다. 기본값은 `io-threads 1`(비활성) + `io-threads-do-reads no`, 둘 다 `IMMUTABLE_CONFIG`, 그리고 **SSL 이 켜져 있으면 동작하지 않는다** `✓`
- 6.0 릴리스노트의 "2배" 주장에는 **인스턴스·코어 수·값 크기·클라이언트 수가 없다** — `when pipelining cannot be used` 라는 한정만 있다 `Ⓥ`
{{< /callout >}}

> **왜 이 문서인가.** Redis 를 기능 목록으로 읽으면 "왜 이 기능은 이렇게 생겼나"에 답할 수 없다. 이 구간(2009~2021)에서 정해진 것은 기능이 아니라 **제약**이다 — 값이 자료구조라는 결정이 단일 스레드를 불렀다. 단일 스레드가 원자성을 공짜로 줬고, 그 대가를 6.0 이 threaded I/O 로 처음 갚기 시작했다. 7.0 이후에 나오는 거의 모든 논쟁(스레딩·메모리 레이아웃·cluster 제약)의 전제가 여기서 굳었다.

> 근거 기준: 로컬 blobless 클론 `~/evejuni/redis`(2026-08-05 fetch)의 `git show`/`for-each-ref`/`cat-file`, 그리고 릴리스노트 원문(2.8.0~6.2.0은 `RELEASENOTES-*.txt`, 2.6 이하는 리포에 커밋된 `00-RELEASENOTES`/`Changelog`). 날짜는 태그 기준이고 **일자만** 인용한다 — 이 구간에서 릴리스노트 헤더·태그 커밋·태그 객체의 *시각*은 몇 시간씩 어긋난다(5.0.0 은 노트 헤더 `13:28:26 CEST` 와 태그 객체 `17:32:28+02:00`, 6.2.0 은 `14:00:00 IST` 와 `23:23:58+02:00`).

## 1. 왜 태어났나 — 값이 blob 이면 안 되는 워크로드

시작 이유는 첫 커밋에 동봉된 FAQ 에 그대로 적혀 있습니다 — `Why did you started the Redis project? / In order to scale LLOOGG.`(`redis ed9b544e1:doc/FAQ.html`) `✓`. 프로젝트 이름의 뜻도 같은 문서에 있습니다: `it means REmote DIctionary Server`, 그리고 `it's a joke on the word Redistribute` `✓`.

같은 FAQ 가 요구사항을 자료구조로 진술합니다 — 컴퓨터별 로그를 모으려면 `RPUSH computer_ID` 하고 `LTRIM computer_ID 0 999` 로 잘라내면 되고, 태그 검색은 태그마다 SET 을 두고 서버측 교집합을 시키면 됩니다. 결론 문장이 논지 전체입니다: `So what is Redis really about? The User interface with the programmer.` `✓` 값이 opaque blob 이면 이 중 아무것도 서버에서 할 수 없고, 클라이언트가 값 전체를 왕복시켜 직렬화·역직렬화·재저장해야 하며 그 사이에 경쟁이 생깁니다.

**memcached 로 안 됐던 지점**도 첫 커밋 문서가 스스로 두 축으로 정리합니다 — `Memcached is not persistent, it just holds everything in memory without saving since its main goal is to be used as a cache. Redis instead can be used as the main DB for the application.` 와 `while keys can just be strings, values in Redis can be lists and sets, and complex operations like intersections, set/get n-th element of lists, pop/push of elements, can be performed against sets and lists.`(`redis ed9b544e1:doc/README.html`) `✓`. memcached 쪽의 설계와 그 후 23년의 변화는 [02 · memcached]({{< relref "../02-memcached/index.md" >}})가 소유합니다.

**두 번째 결정: 락을 주지 않습니다.** day-1 문서의 답이 `Does Redis support locking? / No, the idea is to provide atomic primitives in order to make the programmer able to use redis with locking free algorithms.` 입니다(`redis ed9b544e1:doc/README.html`) `✓`. 이것이 단일 스레드의 원인이지 결과가 아닙니다 — 커맨드 하나가 곧 임계 구역이 되려면 서버가 커맨드를 겹쳐 실행하지 않아야 하고, 그러면 락도 트랜잭션도 필요 없어집니다. FAQ 의 다른 문장이 도달점을 그립니다: `this special kind of memory containing your data structures is shared, atomic, persistent`(`redis ed9b544e1:doc/FAQ.html`) `✓`.

첫 커밋의 실측치는 그 야심과 구현 사이 간격을 보여줍니다 `✓`.

| 항목 | 2009-03-22 `ed9b544e1` 실측 | 근거 |
|---|---|---|
| 규모 | 110 files / 13,641 insertions. `src/`·`deps/` 없이 루트 플랫 — `redis.c` 3,037줄 | `git show --stat ed9b544e1` |
| 커맨드 | **45개**. `GET SET SETNX DEL … SORT INFO` (`SMEMBERS` 는 `sinterCommand` 재사용) | `redis ed9b544e1:redis.c:289-335`, `:313` |
| 자료형 | **3종**(string/list/set). `REDIS_HASH 3` 은 정의·free 함수만 있는 사문이고 ZSET 은 정의조차 없다 | `:81-84`, `:1843-1848`, `:1428-1450` |
| 이벤트 루프 | `select(2)` 단일 구현. file event 를 연결 리스트로 관리 | `redis ed9b544e1:ae.c:202,218-220,264` |
| 프로토콜 | inline / bulk 2분류. 응답은 `nil\r\n`·`0\r\n`·`-1\r\n` 등 raw | `:77-78`, `:654-679` |
| 영속성 | `saveDb()` → `temp-<…>.rdb` + 매직 `REDIS0000`, `fork()` BGSAVE | `:1387,1396,1402,1502,1523,1536` |
| 복제 | `SYNC` = 동기 풀덤프(출력 flush → `saveDb()` → 파일 전송) | `:2876` |
| 없던 것 | `EXPIRE` `TTL` `SETEX` `MULTI` `SUBSCRIBE` `ZADD` `HSET` `appendonly` `APPEND` 전부 `redis.c` 안에서 0회. 트리에 `epoll`/`kqueue`/`aof`/`deps`/`src` 경로 없음 | grep |

EXPIRE 는 열흘 뒤(2009-04-01 `3305306f0`), AOF 는 7개월 뒤(2009-10-30 `44b38ef43`)에 들어옵니다 `✓`.

**세 번째 결정: 디스크를 기다리지 않습니다.** 이것도 day-1 에 논증돼 있습니다 — `If the data is larger then memory, and this data is stored on disk, what happens is that the bottleneck of the disk I/O speed will start to ruin the performances. Maybe not in benchmarks, but once you have real load with distributed key accesses the data must come from disk, and the disk is damn slow. Not only, but Redis supports higher level data structures than the plain values. To implement this things on disk is even slower.` 뒷문장이 핵심입니다 — **자료구조 연산은 blob get/put 보다 디스크에서 훨씬 더 불리합니다.** 값이 자료구조라는 첫 결정이 인메모리 전용을 요구한 것이고, 그 대신 FAQ 는 데이터가 메모리보다 크면 **Redis 와 MySQL 을 병행**하라고 권합니다 — 상태와 고빈도 접근은 Redis, 큰 데이터는 auto-increment ID + BLOB 컬럼의 MySQL 테이블(`redis ed9b544e1:doc/FAQ.html`) `✓`.

### 1.1 결정의 연쇄 — 이 문서의 뼈대

| 결정 | 즉시 따라온 것 | 나중에 청구된 것 |
|---|---|---|
| 값이 blob 이 아니라 자료구조다 | 서버가 값의 내부를 안다 → 서버측 연산(`LTRIM`·`SINTERSTORE`) | 인코딩 계층이 계속 늘어난다 — ziplist·quicklist·embstr (§6) |
| 락을 주지 않고 원자 프리미티브를 준다 | **커맨드 하나 = 임계 구역** → 단일 스레드 실행 (§3) | 느린 커맨드 하나가 전체를 세운다 → `SCAN`(2.8)·lazyfree(4.0) (§3·§6) |
| 자료구조 연산은 디스크에서 더 불리하다 | 인메모리 전용 + `fork()` 스냅샷 (§4) | 데이터셋이 RAM 을 넘으면 방법이 없다 → **VM 시도와 제거** (§4.1) |
| 수직 확장을 하지 않는다 | 상태 공유·동기화 코드 부재, MANIFESTO 6·7번 (§2) | 코어를 더 쓰려면 인스턴스를 늘려야 한다 → cluster ([06]({{< relref "../06-cluster-mode/index.md" >}})) |
| 병목은 실행이 아니라 소켓이다 | 파이프라이닝이 1차 처방 (§3) | **6.0 threaded I/O** — 한 바퀴의 양 끝만 병렬화 (§7) |

각 행의 오른쪽 칸이 이 문서의 절입니다. 왼쪽 칸을 바꾸지 않고 오른쪽을 갚아온 17년이라고 읽으면 7.0 이후의 논쟁도 같은 축에서 읽힙니다.

## 2. MANIFESTO — 원칙이 문서로 고정된 시점, 그리고 다시 쓰인 시점

MANIFESTO 는 첫 커밋에 없습니다. **v1 은 2011-03-01 `be14f38de` "Redis manifesto added"** 로 `src/MANIFESTO` 에 20줄로 들어왔고 항목이 **7개**였습니다. 2012-02-05 `7441fcdd5` 가 루트로 옮겼고, **2019-03-18 `a5af648fd` "MANIFESTO v2"** 가 41줄을 추가해 **10개**로 늘렸습니다(같은 날 `3eaa2cdc4` 가 6번에 lock-in 문장을 덧붙였습니다) `✓`. 태그 기준으로 스레딩 항목이 처음 실린 릴리스는 **6.0.0** 입니다 — 5.0.0 의 MANIFESTO 에는 0건, 6.0.0 에 1건이고 6.2.0 과 8.10.0 의 MANIFESTO 는 바이트 단위로 동일합니다 `✓`.

| 항목 | 원문(발췌) | 코드에서 무엇이 됐나 |
|---|---|---|
| **2 — Memory storage is #1** | `Redis will continue to explore alternative options (where data can be optionally stored on disk, say) but the main goal of the project remains the development of an in-memory database.` | VM 제거(§4)의 사후 정당화. "선택적 디스크는 탐색하되 목표는 인메모리" |
| **3 — Fundamental data structures for a fundamental API** | `Redis will avoid intermediate layers in API, so that the complexity is obvious and more complex operations can be performed as the sum of the basic operations.` | 커맨드가 곧 자료구조 연산. 쿼리 플래너·인덱스 계층이 없는 이유 |
| **6 — We're against complexity** | `One of the main Redis goals is to remain understandable, enough for a single programmer to have a clear idea of how it works in detail just reading the source code for a couple of weeks.` | 이벤트 루프 한 개·상태 공유 없음. §7 의 threaded I/O 가 굳이 배리어 방식인 이유 |
| **7 — Threading is not a silver bullet** *(v2 신설)* | `Instead of making Redis threaded we believe on the idea of an efficient (mostly) single threaded Redis core.` … `In the future we may explore parallelism only for I/O, which is the low hanging fruit: minimal complexity could provide an improved single process experience.` | 6.0 threaded I/O 의 범위를 **문서가 먼저 못 박았다**. "I/O 만" 이라는 한정이 §7 의 경계 그대로다 |

7번의 나머지 두 문장은 cluster 를 이 원칙의 짝으로 지목합니다 — `Multiple of such cores … are abstracted away as a single big system by higher order protocols and features: Redis Cluster and the upcoming Redis Proxy are our main goals.` **수직 확장을 포기하고 수평 확장에 위임한다**는 선언이고, 그 대가는 8번 항목이 스스로 적습니다: multi-key API 를 분산에서 투명하게 만들 방법은 없으니 `expose the trade-offs to the user` 합니다 `✓`. cluster 가 강제하는 제약은 [06 · cluster mode]({{< relref "../06-cluster-mode/index.md" >}})가 소유합니다.

{{< callout type="warning" >}}
MANIFESTO 를 "Redis 는 영원히 단일 스레드다"의 근거로 인용하는 것은 v1 과 v2 를 섞는 것입니다. 스레딩 항목 자체가 **threaded I/O 직전에 쓰였고**, 그 문단이 I/O 병렬화를 예고합니다. 이 문서에서 인용하는 문구는 전부 `git -C ~/evejuni/redis show 8.10.0:MANIFESTO`(= `6.2.0:MANIFESTO`) 기준입니다.
{{< /callout >}}

## 3. 단일 스레드 이벤트 루프 — 왜 이게 빨랐나

`ae.c` 는 첫 커밋부터 있었지만 백엔드 추상화는 아니었습니다. 지금의 형태는 컴파일 타임 단일 선택이고, 선택 순서에 이유가 주석으로 붙어 있습니다 — `Include the best multiplexing layer supported by this system. / The following should be ordered by performances, descending.` 그 아래가 `HAVE_EVPORT` → `HAVE_EPOLL` → `HAVE_KQUEUE` → `ae_select.c` 입니다(`redis 6.2.0:src/ae.c:49-63`). 이 블록은 `redis 8.10.0:src/ae.c:30-44` 와 동일합니다 `✓`. 리눅스는 epoll, BSD·macOS 는 kqueue, Solaris 계열은 event port 를 씁니다. **`select(2)` 는 첫 커밋의 유일한 구현이었다가 지금은 최후 폴백**입니다.

한 바퀴의 골격은 `aeMain()` → `aeProcessEvents(AE_ALL_EVENTS | AE_CALL_BEFORE_SLEEP | AE_CALL_AFTER_SLEEP)` 이고(`redis 6.2.0:src/ae.c:485-489`), 그 안에서 `beforesleep` 콜백 → `aeApiPoll()` → `aftersleep` 콜백 순으로 돕니다(`:391-400`) `✓`. 실제 작업 대부분은 poll 이 아니라 **`beforeSleep()` 안에 줄지어 있습니다** — `redis 6.0.0:src/server.c:2087` 부터 pending read 처리(`:2094`) → fast expire cycle(`:2111`) → unblocked client 처리(`:2124`) → tracking 무효화 브로드캐스트 → AOF 버퍼 flush(`:2149`) → pending write 처리(`:2152`) → async free 큐 정리(`:2155`) 순입니다 `✓`.

{{< flow src="_flow/3-이벤트-루프-한-바퀴.json" />}}

**왜 이게 빨랐나.** 이 구조가 이긴 이유는 CPU 를 잘 써서가 아니라 **커맨드 실행이 비싼 구간이 아니었기** 때문입니다. 6.0 의 `redis.conf` 가 병목을 직접 지목합니다 — `Since especially writing is so slow, normally Redis users use pipelining in order to speedup the Redis performances per core, and spawn multiple instances in order to scale more.`(`redis 6.0.0:redis.conf`) `✓`. 즉 시간은 `write(2)` 와 커널 왕복에서 새고, 해시 조회와 리스트 push 는 메모리 접근 몇 번입니다. MANIFESTO 2번이 같은 말을 성능 예측 가능성으로 표현합니다 — `Memory is fast, and allows Redis to have very predictable performance. Datasets composed of 10k or 40 millions keys will perform similarly.` `✓`

그래서 **단일 스레드가 준 것은 속도가 아니라 세 가지 부재**입니다 `Σ`.

| 공짜로 얻은 것 | 왜 성립하나 | 나중에 무엇을 청구했나 |
|---|---|---|
| **커맨드 단위 원자성** | 커맨드가 겹쳐 실행되지 않으므로 `INCR`·`LPUSH`·`SINTERSTORE`·`SETNX` 가 그 자체로 임계 구역 | 없음. 이 계약은 6.0 threaded I/O 이후에도 유지된다(§7) |
| **락·동기화 코드 부재** | 자료구조 구현에 뮤텍스가 없다 → MANIFESTO 6번의 "몇 주면 읽힌다"가 가능 | 코어를 더 쓰려면 인스턴스를 늘려야 한다 — `spawn multiple instances`(`redis 6.0.0:redis.conf`) |
| **결정적 지연** | 스케줄링·경쟁으로 인한 꼬리 지연이 없다 | **느린 커맨드 하나가 전체를 세운다.** 4.0 의 lazyfree/`UNLINK` 와 3.0 의 `blocked.c` 리팩터가 이 대가를 갚는 작업이다 |

세 번째 행의 대가가 이 구간 커맨드 설계의 절반을 설명합니다 `Σ`. `KEYS` 는 첫 커밋의 45개 커맨드 안에 있었고 키가 늘어나면 그만큼 루프가 길어집니다 — 단일 스레드에서 그 시간은 곧 전면 정지입니다. **`SCAN`/`SSCAN`/`HSCAN`/`ZSCAN` 이 2.8 GA 직전 RC6 에 뒤늦게 들어온 이유가 이것**이고(RN-2.8.0:32), 같은 논리가 4.0 의 `UNLINK`·`FLUSHALL ASYNC`(큰 값의 free 를 배경 스레드로)와 2.6 의 클라이언트 출력 버퍼 한도(느린 소비자가 메모리를 밀어올리는 것을 끊음)까지 이어집니다 `✓`. 이 구간의 신규 커맨드 상당수는 기능 추가가 아니라 **"단일 스레드를 오래 붙잡지 않는 버전"** 입니다.

첫 커밋 FAQ 가 이미 한계도 적었습니다 — `the price to pay is exactly this, that the dataset must fit on your computers RAM` `✓`. 그 문장을 뒤집으려던 시도가 §4 의 VM 입니다.

## 4. 영속성이 두 번 갈라진 이유 — 그리고 VM 을 버린 것

**RDB 와 AOF 는 따로 설계됐습니다.** 스냅샷은 day-1, AOF 는 **7개월 뒤 2009-10-30 `44b38ef43` "Initial implementation of append-only mode. Loading still not implemented."** 이고 로딩은 이틀 뒤에 붙습니다 `✓`. 같은 날 `appendfsync no|always|everysec` 3모드와 `EXPIRE`→`EXPIREAT` 변환이 함께 들어왔습니다 — 후자는 append 로그가 **재생 가능해야** 한다는 요구가 커맨드 표현을 바꾼 첫 사례입니다 `✓`.

| 시점 | 무엇 | 근거 |
|---|---|---|
| 2009-03-22 | 스냅샷: `SAVE`/`BGSAVE`/`LASTSAVE`, `save <sec> <changes>`, `.rdb` + `REDIS0000` | `redis ed9b544e1:redis.c:1387,1396,1402,1502,1523` |
| 2009-10-30 | AOF 최초 구현(로딩 미완) + `appendfsync` 3모드 | `44b38ef43`; `redis 2.0.0:Changelog:620-630` |
| 2011 (2.4) | `everysec` fsync 와 느린 `close(2)` 를 백그라운드 스레드로 | `redis 2.4.0:00-RELEASENOTES` (2.3.11 절) |
| 2017 (4.0) | **mixed RDB-AOF**: rewrite 결과가 `[RDB file][AOF tail]`. **기본 off** | `redis 4.0.0:redis.conf:774-782` |
| 2018 (5.0) | `aof-use-rdb-preamble yes` 로 기본값 전환 | `redis 5.0.0:redis.conf`; `redis 6.0.0:src/config.c:2111` |

4.0 의 conf 주석이 기본값을 off 로 둔 이유를 밝힙니다 — `This is currently turned off by default in order to avoid the surprise of a format change, but will at some point be used as the default.` `✓` 그래서 "Redis 4.0 부터 AOF 는 RDB 프리앰블을 쓴다"는 절반만 맞습니다. `appendonly` 자체의 기본값은 6.2 까지도 `no` 입니다(`redis 6.0.0:redis.conf`) `✓`.

**RDB_VERSION 이 곧 다운그레이드 차단선입니다** `✓`.

| Redis | RDB 식별 | 근거 |
|---|---|---|
| 첫 커밋 | 리터럴 `"REDIS0000"` | `redis ed9b544e1:redis.c:1402` |
| 2.0.0 / 2.2.0 | 리터럴 `"REDIS0001"` | `redis 2.0.0:redis.c:3710`; `redis 2.2.0:src/rdb.c:425` |
| 2.4.0 | 리터럴 `"REDIS0002"` | `redis 2.4.0:src/rdb.c:414` |
| 2.6.0 ~ 3.0.0 | `6` (2.4 의 `2` 에서 점프 — 3·4·5 는 2.5.x 개발 라인에서 소비) | `redis 2.6.0:src/rdb.h:12`; `3.0.0:src/rdb.h:41` |
| 3.2.0 | `7` (매크로 이름에서 `REDIS_` 접두 제거) | `redis 3.2.0:src/rdb.h:41` |
| 4.0.0 | `8` | `redis 4.0.0:src/rdb.h:41` |
| **5.0.0 / 6.0.0 / 6.2.0** | **`9` — 세 마이너 연속 고정** | `redis 5.0.0:src/rdb.h:41`; `6.0.0:41`; `6.2.0:41` |

5.0→6.2 가 세 마이너 내내 9 라는 것은 **이 구간이 RDB 호환 다운그레이드가 가능한 드문 구간**이라는 뜻입니다. 3.2→4.0→5.0 은 메이저마다 올랐고, 7.0·7.2·7.4 가 10·11·12 로 다시 마이너마다 오른 뒤 8.0~8.4 는 12 에 머물고 8.6 부터 또 마이너마다 오릅니다 — 그 이후의 차단선은 [04 · Redis 7.0 → 8.10]({{< relref "../04-redis-7-to-8.md" >}})가 소유합니다.

### 4.1 Virtual Memory — 유일하게 되돌린 설계

첫 커밋 FAQ 는 `Redis will always continue to hold the whole dataset in memory` 라고 단언했습니다 `✓`. 그런데 2.0.0 의 `redis.conf` 에는 `VIRTUAL MEMORY` 절이 있고 `vm-enabled no`(주석에는 `# vm-enabled yes`), `vm-swap-file /tmp/redis.swap`, `vm-max-memory` 가 있습니다. 설명 문구는 OS 의 페이지 스왑을 그대로 가져옵니다 — `very used keys are taken in memory while the other keys are swapped into a swap file, similarly to what operating systems do with memory pages.`(`redis 2.0.0:redis.conf:198-226`) `✓`

그 다음이 이 챕터에서 가장 깨끗한 반증 사례입니다.

| 단계 | 무엇이 있었나 | 근거 |
|---|---|---|
| 2.0.0 (2010-09-03) | `vm-enabled` / `vm-swap-file` / `vm-max-memory` 가 `redis.conf` 정식 절 | `redis 2.0.0:redis.conf:198-226` |
| 2.4.0 (2011-10-14) | 같은 절 머리에 경고만 남는다 — `### WARNING! Virtual Memory is deprecated in Redis 2.4` / `### The use of Virtual Memory is strongly discouraged.` | `redis 2.4.0:redis.conf:340-343` |
| **2.6.0 (2012-10-22)** | **제거.** 노트의 신기능 개요 둘째 줄이 `* Virtual Memory removed (was deprecated in 2.4)` — 첫 줄은 Lua 다. `redis.conf` 에서 `vm-` 0건 | `redis 2.6.0:00-RELEASENOTES:153`; `git show 2.6.0:redis.conf` |
| 2019-03-18 | MANIFESTO v2 2번이 입장을 문서화 — 디스크는 "선택적으로 탐색", 목표는 인메모리 | `a5af648fd`; `redis 8.10.0:MANIFESTO:17-26` |

읽는 법: **VM 은 §3 이 준 세 가지 부재를 전부 깹니다.** 값이 스왑 파일에 있으면 커맨드가 디스크를 기다리므로 결정적 지연이 사라집니다. 스왑 인/아웃을 하는 동안 다른 커맨드를 받으려면 락이 필요해지고, 그러면 "커맨드 = 임계 구역" 계약이 무너집니다 `Σ`. 같은 릴리스가 Lua 를 넣으면서 VM 을 뺐다는 것도 방향을 말해줍니다 — 서버 안에서 하는 일은 늘리고, 서버 밖(디스크)을 기다리는 일은 뺐습니다. 그리고 이 자리는 이후 OSS 에서 채워지지 않았습니다 — 7.x·8.x 릴리스노트와 `redis 8.10.0:redis.conf` 에 `flash`/`tiering`/`flex` 가 0건이고, 티어링은 상용 제품 쪽 기능으로만 남았습니다 `✓`.

## 5. 복제와 가용성 — SYNC 에서 PSYNC2 까지

첫 커밋의 복제는 `syncCommand()` 하나였습니다 — 출력 flush → `saveDb()` → 파일을 길이 헤더와 함께 전송. **단절되면 매번 전체를 다시 보냅니다** `✓`. 그 비용을 세 단계에 걸쳐 깎았습니다.

| 버전 | 무엇이 가능해졌나 | 무엇이 여전히 안 됐나 |
|---|---|---|
| 첫 커밋 (2009-03-22) | `SYNC` 동기 풀덤프, `# slaveof` 설정 | 부분 재동기화·백로그·타임아웃 감지 없음 |
| **2.8.0** (2013-11-22) | **PSYNC** — `repl_backlog` 링버퍼(`repl_backlog_size`/`_off`, `master_repl_offset`)로 짧은 단절 후 full resync 회피. replica → primary 명시 PING 으로 타임아웃 감지. `min-slaves-*` 로 "replica 부족 시 쓰기 거부" | **failover 로 primary 가 바뀌면** 부분 재동기화 불가. replica 재시작도 불가 |
| **3.0.0** (2015-04-01) | diskless replication(`repl-diskless-sync`) — primary 가 RDB 를 디스크 경유 없이 소켓으로. `WAIT` 로 동기 복제 대기 | replica 측은 여전히 디스크에 받아 로드 |
| **4.0.0** (2017-07-14) | **PSYNC2** — failover 후·replica 재시작 후에도 부분 재동기화. 강등된 primary 도, 새 primary 가 옛 primary 의 replica 였다면 성립. **sub-replica 가 최상위 primary 의 동일 스트림을 수신** | 노트가 스스로 "이 릴리스는 조심히 다루라"고 쓴다 — GA 직전까지 PSYNC2 버그 수정이 이어졌다 |
| **6.0.0** (2020-04-30) | **diskless replica loading**(`repl-diskless-load`) — 3값 `disabled`/`on-empty-db`/`swapdb` | **기본 `disabled`.** conf 주석이 `may cause data loss during failovers` 와 `Use only if your do what you are doing` 를 붙인다 |

5.0.0 의 `SLAVEOF` → `REPLICAOF` 는 커맨드 추가가 아니라 **개명**입니다. `redis 5.0.0:src/server.c:263-264` 에서 두 이름이 같은 `replicaofCommand` 를 가리키고, 노트도 `Slave removal: SLAVEOF -> REPLICAOF. SLAVEOF is now an alias.` 라고 씁니다 `✓`. 자동화 스크립트·INFO 파서를 `slave` 문자열에 맞춰 둔 쪽이 이 릴리스에서 조용히 깨집니다.

**Sentinel 의 자리.** Sentinel 은 cluster 와 무관하게 **다른 문제를 푸는 별개 프로세스**입니다 — 샤딩 없이 "primary 가 죽었을 때 replica 를 승격하고 클라이언트에게 새 주소를 알린다"만 합니다. 2.6.0-rc8 에 백포트되고 **2.8.0 에서 "더 신뢰성 있는 알고리즘으로" 재구현**됐습니다 `✓`. 그래서 이 구간의 가용성 선택지는 둘입니다 — 단일 샤드 + Sentinel, 또는 3.0 이후의 cluster. cluster 내부 동작과 Sentinel 대비는 [06 · cluster mode]({{< relref "../06-cluster-mode/index.md" >}})가 소유합니다.

## 6. 자료구조 서버가 넓어진 경로

넓힌 방식이 셋으로 갈립니다 — **커맨드를 더 줍니다**, **표현을 바꿔 메모리를 줄입니다**, **확장 지점을 팝니다**. 세 번째가 4.0 모듈 API 입니다.

| 버전 | 무엇이 들어왔나 | 어느 방식인가 · 대가 |
|---|---|---|
| **2.6.0** (2012-10-22) | **Lua `EVAL`/`EVALSHA`/`SCRIPT`**. ms 해상도 만료(`PEXPIRE`/`PTTL`), read-only replica, `BITCOUNT`/`BITOP`, 클라이언트 출력 버퍼 한도, `DUMP`/`RESTORE`/`MIGRATE` 백포트, RDB CRC64 | 확장 지점. **스크립트가 도는 동안 서버는 다른 커맨드를 못 받는다** — 단일 스레드 계약을 사용자 코드에 넘긴 것 |
| **3.2.0** (2016-05-06) | **GEO**(`GEOADD`/`GEORADIUS`…)와 **`BITFIELD`**. **quicklist**(list 새 인코딩), Lua effect replication + 디버거, SDS 개선, RDB AUX 필드·`RESIZEDB` opcode | GEO 는 커맨드 추가(sorted set 위에 얹음), quicklist 는 표현 변경. GEO 원본은 Redis 가 아니다 — 노트가 `Initially implemented in a fork of Redis called 'Ardb'` 로 출처를 밝힌다 |
| **4.0.0** (2017-07-14) | **모듈 API**(`module.c` + `redismodule.h`, thread-safe context). lazyfree/`UNLINK`/`FLUSHALL ASYNC`, `MEMORY` 커맨드, LFU eviction, active defrag, `SWAPDB` | 확장 지점. 대가는 **cluster 버스 프로토콜 비호환** — 3.2 → 4.0 은 rolling upgrade 가 불가하고 전 노드 mass-restart 가 필요하다 |
| **5.0.0** (2018-10-17) | **Stream 자료형**(`t_stream.c`, `XADD`/`XREAD`/`XGROUP`…). `ZPOPMIN`/`ZPOPMAX` + 블로킹 변형, cluster manager 를 Ruby → C(`redis-cli --cluster`)로 포팅, `CLIENT ID`/`UNBLOCK`, dynamic HZ | 커맨드 추가 + 새 타입. 노트가 GA 품질을 스스로 유보한다 — `handle it with some care for the first weeks`, GA 사유가 `Several fixes to streams AOF and replication.` |

`ziplist` → `quicklist` 전환이 이 표에서 가장 조용하고 가장 큽니다. 리스트 하나를 ziplist 한 덩어리로 두면 요소 추가마다 재할당·복사가 나고 커지면 O(N) 이 됩니다. quicklist 는 ziplist 노드들의 연결 리스트로 바꿔 그 상충을 끊었고, 노트가 효과를 `Very important memory savings and storage space in RDB gains (up to 10x sometimes).` 로 적지만 **요소 크기·개수·비교 대상을 밝히지 않습니다** `Ⓥ` — **설계·구현은 Matt Stancliff** 입니다 `✓`. 즉 "값이 자료구조"라는 결정의 청구서를 인코딩 계층에서 갚는 패턴이 3.2 에서 시작됩니다.

모듈 API 도 "코어를 안 건드리고 넓힌다"는 정확한 의도로 들어왔습니다 — `the module API implements a complete abstraction layer that separates the Redis core from the module implementation, allowing the same module to be loaded by different versions of Redis without modifications.` `✓` 이 결정이 8.x 의 번들 논쟁까지 이어집니다([04 · Redis 7.0 → 8.10]({{< relref "../04-redis-7-to-8.md" >}})).

## 7. 6.0 이 바꾼 표면 — threaded I/O 의 정확한 경계

6.0.0(2020-04-30)은 자료형을 하나도 안 늘리고 **접속 표면을 전부 갈았습니다**. 그리고 GA 노트의 마지막 줄이 `Enjoy Redis 6! :-) / Goodbye antirez` 입니다 `✓`.

| 기능 | 릴리스노트가 말한 것 | 소스·설정 실측 | 기본값 |
|---|---|---|---|
| **RESP3** | `Redis now supports a new protocol called RESP3, which returns more semantical replies` | 클라이언트 생성 시 `c->resp = 2`(`networking.c:107`), `HELLO` 가 `ver < 2 \|\| ver > 3` 이면 `-NOPROTO`(`:2460-2463`), 통과하면 `c->resp = ver`(`:2495`) | **RESP2. 커넥션 단위 opt-in** |
| **ACL** | 사용자·권한 도입 | `acl.c` 신설. GA 에서 `ACL GENPASS` HMAC-SHA256, `CLIENT KILL USER`, `MIGRATE AUTH2`, `ACL LOG` | `default` 유저가 `nopass` — 기존 배포는 그대로 동작 |
| **TLS** | `Redis now supports SSL on all channels` | `tls.c` + `connection.c`/`connhelpers.h` 로 연결 추상화 신설 | 별도 빌드·설정 필요 |
| **client-side caching** | `still experimental and will get more changes during the next release candidates` | `tracking.c` 신설. `CLIENT TRACKING (on\|off) [REDIRECT id] [BCAST] [PREFIX …] [OPTIN] [OPTOUT]`. RC2 에서 "caching slot" → key 단위로 재설계, GA 에서 `NOLOOP` 추가 | `tracking-table-max-keys 1000000` 이 conf 주석 상태 |
| **threaded I/O** | `allowing to serve 2 times as much operations per second in a single instance when pipelining cannot be used` `Ⓥ` — 인스턴스·코어·값 크기·클라이언트 수 없음 | `createIntConfig("io-threads", NULL, IMMUTABLE_CONFIG, 1, 128, …)`(`config.c:2148`), `createBoolConfig("io-threads-do-reads", NULL, IMMUTABLE_CONFIG, …, 0, …)`(`:2090`) | **`io-threads 1`(비활성) + `io-threads-do-reads no`, 둘 다 IMMUTABLE** |

**RESP3 와 client-side caching 이 같은 릴리스에 있는 것은 우연이 아닙니다** `Σ`. 캐시 무효화는 서버가 클라이언트에게 **요청 없이 밀어야** 하는 메시지인데 RESP2 의 응답 타입에는 그런 자리가 없습니다. 그래서 6.0 의 `CLIENT TRACKING` 은 `REDIRECT <id>` 로 무효화를 **다른 커넥션(보통 pub/sub 을 구독한 커넥션)** 에 보내는 우회를 함께 제공합니다 `✓`. RESP3 를 쓰면 같은 커넥션의 push 타입으로 받을 수 있습니다 — 6.2 가 `redis-cli` 에 RESP3 push 지원을 넣는 것도 같은 흐름입니다 `✓`. 다만 기본이 RESP2 로 남았으므로 **클라이언트 라이브러리가 `HELLO 3` 을 보내지 않으면 이 경로는 켜지지 않습니다.**

### 7.1 무엇이 병렬화됐고 커맨드 실행은 왜 여전히 직렬인가

경계를 소스로 못 박으면 이렇습니다 — 모두 `redis 6.0.0:src/networking.c` 실측입니다 `✓`.

| 질문 | 답 | 근거 |
|---|---|---|
| 워커가 하는 일은 | **`writeToClient()` 또는 `readQueryFromClient()` 둘 중 하나뿐.** 그 외 분기는 `serverPanic("io_threads_op value is unknown")` | `:2902-2908` |
| 커맨드는 누가 실행하나 | **메인 스레드.** 배리어 통과 후 `processCommandAndResetClient(c)` | `:3142-3144` |
| 워커의 read 는 어디까지 하나 | 버퍼를 채우고 **첫 커맨드만 파싱**해 `CLIENT_PENDING_COMMAND` 를 세운다 | `:3085-3090` 주석 |
| 읽기와 쓰기가 동시에 도나 | 아니다. `io_threads_op` 이 **전역 단일 변수**라 한 라운드에 한 종류만. 잡 큐가 없다 | `:2854-2867` |
| 워커 배정 키는 | `item_id % server.io_threads_num` — **pending 리스트 안의 위치**다. 클라이언트 ID 가 아니라서 같은 클라이언트가 라운드마다 다른 워커로 간다 | `:3011-3038` |
| 배리어는 어떻게 기다리나 | 메인이 `io_threads_pending[]` 합을 계속 다시 읽는 **busy-spin**. yield·condvar·futex 없음. 워커도 1,000,000회 스핀 후 mutex park | `:3040-3046`, `:3126-3132`, `:2878-2889` |
| 항상 켜져 있나 | 아니다. pending 클라이언트가 `io_threads_num*2` 미만이면 스레드를 전부 멈추고 동기 경로로 돌아간다 — **전부-또는-전무 스위치** | `:2982-2990`, `:3002-3007` |
| primary·replica 링크도 스레딩되나 | 아니다. `postponeClientRead()` 가 `CLIENT_MASTER\|CLIENT_SLAVE` 를 제외한다 | `:3071-3083` |
| TLS 와 같이 쓸 수 있나 | **못 쓴다.** conf 원문: `Aso this feature currently does not work when SSL is enabled.` | `redis 6.0.0:redis.conf` |

**그래서 커맨드 실행은 왜 직렬인가.** 병렬화하려면 §1 의 계약을 깨야 합니다 — 커맨드 하나가 임계 구역이라는 보장이 없어지고, 자료구조 구현마다 락이 들어가고, MANIFESTO 6번의 "몇 주면 읽힌다"가 무너집니다. 6.0 은 그 계약을 손대지 않는 쪽을 골랐고, 대신 **한 바퀴의 양 끝만 떼어냈습니다**. MANIFESTO 7번이 이 선택을 미리 적어둔 그대로입니다 — `parallelism only for I/O, which is the low hanging fruit: minimal complexity` `✓`.

대가는 두 갈래로 남았습니다. 첫째, `io-threads` 는 켜기 어려운 스위치입니다 — conf 스스로 기본 비활성, 4코어 이상에서만 권장(여유 코어 1개 남길 것), 8 초과는 무의미, `We also recommend using threaded I/O only if you actually have performance problems`, 읽기 스레딩은 `Usually threading reads doesn't help much.` 라고 안내합니다 `✓`. 둘째, busy-spin 배리어와 라운드마다 바뀌는 워커 배정이 구조적 한계로 남아, **Valkey 8.0 이 교체 대상으로 지목한 것이 정확히 이 배리어**입니다 — 그 차이는 [05 · Valkey 8.0 → 9.1]({{< relref "../05-valkey-8-to-9/index.md" >}})가 소유합니다.

### 7.2 6.2 — 큰 기능 없이 커맨드를 완성시킨 릴리스

6.2.0(2021-02-22)의 자기 규정이 그대로입니다 — `Redis 6.2 includes many new commands and improvements, but no big features. It mainly makes Redis more complete and addresses issues that have been requested by many users frequently or for a long time.` 그리고 이것을 6.0.x 패치로 못 넣은 이유도 밝힙니다: 새·확장 커맨드는 하위 호환이 아니라 **구버전 replica 로 복제되지 않습니다** `✓`. 같은 노트가 antirez 이후를 선언합니다 — `This release is the first significant Redis release managed by the core team under the new project governance model.` `✓`

들어온 것: `SMISMEMBER`·`ZMSCORE`·`LMOVE`/`BLMOVE`·`RESET`·`COPY`·`ZDIFF(STORE)`·`ZINTER`/`ZUNION`·`GEOSEARCH(STORE)`·`SET … GET`·`ZADD GT/LT`·`ZRANGESTORE` + `ZRANGE REV/BYLEX/BYSCORE`·`XAUTOCLAIM`·`XADD MINID/LIMIT/NOMKSTREAM`·`LPOP/RPOP COUNT`·`CLIENT PAUSE WRITE`·`CLIENT TRACKINGINFO`·`HRANDFIELD`/`ZRANDMEMBER`·`FAILOVER`·`GETEX`/`GETDEL`·`SET PXAT/EXAT`, dump payload sanitization, Pub/Sub 채널 ACL 패턴, INFO `errorstats` `✓`.

운영에서 걸리는 것은 커맨드가 아니라 **동작 변경 세 개, 그리고 6.0 에서 유입된 호환성 수정 둘**입니다 `✓`.

| 무엇이 바뀌었나 | 그래서 |
|---|---|
| `EXISTS` 가 LRU 를 건드리지 않는다 (5.0/6.0 은 건드렸다) | 존재 확인으로 키를 "살려두던" 코드가 6.2 에서 그 키를 잃는다 |
| `OBJECT` 가 논리적으로 만료된 키를 노출하지 않는다 | 만료 진단 스크립트의 응답이 달라진다 |
| `BITOPS` 길이 한도가 512MB → `proto-max-bulk-len` | conf 값에 따라 한도가 내려갈 수 있다 |
| RC2 에서 big-endian RDB CRC64 체크섬 버그 수정(#8270), Lua map 응답 키/값 순서 수정(#8266) | **둘 다 6.0 에서 유입된 버그** — 6.0 으로 만든 RDB 를 big-endian 에서 신뢰하지 말 것 |
| GA 에서 CVE-2021-21309 수정 | 32bit 빌드 + 큰 `proto-max-bulk-len` 조합의 정수 오버플로 → 힙 손상 |

## 8. 버전표 — 1.0 에서 6.2 까지

날짜는 태그 기준 **일자**입니다. 이 구간에서 2.6.0~6.0.0 태그는 annotated, 6.2.0 이후는 lightweight 이고, 일자 수준에서는 릴리스노트 헤더·태그 커밋·태그 객체가 모두 일치합니다(시각은 몇 시간씩 어긋납니다) `✓`.

| 버전 | 릴리스 | 무엇이 가능해졌나 | 대가 |
|---|---|---|---|
| 첫 커밋 `ed9b544e1` | 2009-03-22 | 자료구조 3종 + 커맨드 45개 + `.rdb` 스냅샷 + `SYNC` | EXPIRE·AOF·RESP·epoll 없음. 단절 시 항상 풀덤프 |
| 1.0.0 `26cdd4dd2` | 2009-09-03 | `EXPIRE`/`TTL`, `AUTH`, `MONITOR`, `SLAVEOF`. 커맨드가 45개 → **59개** | AOF(2009-10-30 `44b38ef43`)와 multi-bulk **요청** 프로토콜(2009-10-07 `e8a74421b`)은 아직 없다 — 둘 다 1.0.0 이후다. 리포에 1.0/1.2 태그가 없다 — 최초 태그는 1.3.6(2010-03-18) |
| 1.2 | `?` | RESP v1 이 **옵션으로** 등장 | 1.2 의 릴리스 일자를 1차 근거로 확정하지 못했다 `?` |
| 2.0.0 | 2010-09-03 | RESP2 가 표준 통신 방식. hash 자료형·pub/sub·`MULTI`/`EXEC`. RDB `REDIS0001` | **Virtual Memory 등장**(`vm-enabled`) — 2.6 에 제거된다 |
| 2.2.0 | 2011-02-22 | `src/`·`deps/` 분리(모노리식 `redis.c` 해체) | — |
| 2.4.0 | 2011-10-14 | `everysec` fsync 를 백그라운드로. RDB `REDIS0002` | **VM deprecated 경고.** "2.4 로 만든 RDB/AOF 를 2.2 에 못 넣는다"를 처음 명문화 |
| **2.6.0** | 2012-10-22 | **Lua `EVAL`**, ms 만료, read-only replica, `BITCOUNT`/`BITOP`, 출력 버퍼 한도, RDB CRC64, RDB **6** | **VM 제거.** 스크립트가 도는 동안 서버가 막힌다. cluster 코드를 통째로 빼고 "3.0 에 낸다"고 예고 |
| **2.8.0** | 2013-11-22 | **PSYNC**, keyspace notification, `SCAN` 계열, `CONFIG REWRITE`, `min-slaves-*`, Sentinel 재구현 | failover 후엔 여전히 full resync. 에러 접두가 `-ERR`→`-WRONGTYPE`/`-NOAUTH` 로 세분화(파서 수정) |
| **3.0.0** | 2015-04-01 | **Cluster GA**, embstr 인코딩, `WAIT`, `MIGRATE` 커넥션 캐싱, `CLIENT PAUSE`, `repl-diskless-sync` | cluster 를 쓰면 multi-key 가 제약된다 → [06]({{< relref "../06-cluster-mode/index.md" >}}) |
| **3.2.0** | 2016-05-06 | **GEO**, **`BITFIELD`**, **quicklist**, Lua effect replication·디버거, RDB AUX·`RESIZEDB`, RDB **7** | RDB 7 — 3.0 으로 되돌릴 수 없다 |
| **4.0.0** | 2017-07-14 | **모듈 API**, **PSYNC2**, lazyfree/`UNLINK`, `MEMORY`, LFU, active defrag, `SWAPDB`, mixed RDB-AOF(**기본 off**), RDB **8** | **cluster 버스 프로토콜 비호환 → 3.2 에서 rolling upgrade 불가.** `SLOWLOG` 엔트리 필드 수 변경 |
| **5.0.0** | 2018-10-17 | **Streams**, `SLAVEOF`→`REPLICAOF` 개명, `ZPOPMIN`/`MAX`, `redis-cli --cluster`, `aof-use-rdb-preamble yes`, RDB **9** | `slave` 문자열에 의존한 스크립트·파서가 깨진다. 노트가 Streams GA 품질을 스스로 유보 |
| **6.0.0** | 2020-04-30 | **RESP3(opt-in)**, **ACL**, **TLS**, **threaded I/O**, **client-side caching**, diskless replica loading, RDB **9** | threaded I/O 는 기본 off·IMMUTABLE·**TLS 와 병용 불가**. big-endian RDB CRC64 버그가 6.2 에서 수정된다 |
| **6.2.0** | 2021-02-22 | 커맨드 대량 보강, `FAILOVER`, `GETEX`/`GETDEL`, dump sanitization, INFO `errorstats`, RDB **9** | `EXISTS`·`OBJECT`·`BITOPS` 동작 변경. CVE-2021-21309 |
| 7.0 이후 | → [04]({{< relref "../04-redis-7-to-8.md" >}}) | Function·sharded pub/sub·listpack·Vector Set … | RDB 가 7.0·7.2·7.4 에서 10·11·12 로, 8.6 이후 다시 마이너마다 오른다 |

## 9. 근거

- **첫 커밋**: `git -C ~/evejuni/redis show --stat ed9b544e1` / `show ed9b544e1:{redis.c,ae.c,ae.h,redis.conf,README,TODO,doc/README.html,doc/FAQ.html}`. LLOOGG·`REmote DIctionary Server`·락 미지원·memcached 대비는 모두 `doc/FAQ.html` 과 `doc/README.html` 원문.
- **MANIFESTO**: `show be14f38de:src/MANIFESTO`(v1, 7항목) / `show a5af648fd -- MANIFESTO`(v2, +41줄) / `7441fcdd5`(루트 이동) / `show 8.10.0:MANIFESTO` = `show 6.2.0:MANIFESTO`(바이트 동일, 인용 근거). 태그별 항목 존재 확인은 `for t in 2.6.0 … 6.2.0; do git show $t:MANIFESTO | grep -c 'Threading is not a silver bullet'` — 6.0.0 부터 1건.
- **이벤트 루프**: `show 6.2.0:src/ae.c:49-63`(백엔드 선택), `:349-400`(`aeProcessEvents`), `:485-489`(`aeMain`). `show 8.10.0:src/ae.c:30-44` 로 동일성 확인. `show 6.0.0:src/server.c:2087-2161`(`beforeSleep` 순서).
- **threaded I/O**: `show 6.0.0:src/networking.c` — `:2854-2867`(전역 상태), `:2878-2914`(워커·스핀), `:3011-3046`(fan-out/배리어), `:3071-3090`(read opt-in·파싱 범위), `:3126-3144`(read 배리어·커맨드 실행), `:2982-3007`(전부-또는-전무). config 는 `show 6.0.0:src/config.c:2090,2148`. conf 원문은 `show 6.0.0:redis.conf` 의 `THREADED I/O` 절.
- **영속성·VM**: `show 2.0.0:redis.conf:198-226`, `show 2.4.0:redis.conf:340-343`, `show 2.6.0:redis.conf`(`vm-` 0건), `show 2.6.0:00-RELEASENOTES:153`. mixed RDB-AOF 는 `show 4.0.0:redis.conf:774-782`, `show 6.0.0:src/config.c:2111`.
- **RDB_VERSION**: `show <tag>:src/rdb.h | grep RDB_VERSION` (2.6.0 은 `:12`, 2.8.0~6.2.0 은 `:41`). 2.4 이하는 `rdb.c` 의 리터럴 매직.
- **릴리스노트**: 2.8.0·3.0.0·3.2.0·4.0.0·5.0.0·6.0.0·6.2.0 은 `RELEASENOTES-<tag>.txt` 원문. 2.6 이하는 리포에 커밋된 `show 2.6.0:00-RELEASENOTES`, `show 2.4.0:00-RELEASENOTES`, `show 2.0.0:Changelog`.
- **날짜 규약**: `git for-each-ref --format='%(refname:short) %(creatordate:iso-strict)' refs/tags/<tag>` 와 `git cat-file -t refs/tags/<tag>`. 2.6.0~6.0.0 = annotated, 6.2.0 이후 = lightweight. 이 구간은 일자 수준에서 세 소스가 일치하므로 **일자만** 인용했다.
- **URL 은 이 챕터의 [99 · 출처]({{< relref "../99-sources.md" >}})가 모은다.**

미확인으로 남긴 것:

- **1.1 · 1.2 의 릴리스 일자** `?` — 리포에 `1.0`/`1.1`/`1.2` 태그가 없다(최초 태그 `1.3.6`, 2010-03-18). RESP v1 이 1.2 에서 옵션으로 들어왔다는 사실은 redis.io 프로토콜 스펙에 있으나 일자는 1차 근거로 확정하지 못했다.
- **RDB_VERSION 3·4·5 의 도입 커밋** `?` — 2.4.0 이 리터럴 `REDIS0002`, 2.6.0-rc1 이 이미 `6`. 사이 번호는 2.5.x 개발 라인에서 소비된 것으로 보이나 커밋을 특정하지 않았다.
- **첫 커밋 이전의 이력** `?` — `ed9b544e1` 은 parent 없는 root commit 이지만, 같은 커밋의 `doc/FAQ.html` 이 `Update: redis SVN is able to know how much memory it is using` 라고 쓴다. git 이전에 SVN 작업 이력이 있었음을 시사하는 1차 흔적이고, **그 이력 자체는 이 리포에 없다**.
- **6.0 threaded I/O 의 "2배" 주장 조건** `Ⓥ` — 릴리스노트가 `when pipelining cannot be used` 외에 인스턴스 타입·코어 수·값 크기·클라이언트 수·파이프라인 깊이를 밝히지 않는다. conf 는 벤치마크 시 클라이언트도 `--threads` 로 맞추라고만 안내한다.
- **`REDIS_HASH 3` 이 첫 커밋에서 무엇을 위한 예약이었는지** `?` — 정의와 free 경로만 있고 생성 경로가 없다. 커밋 메시지("first commit")와 17줄 `TODO` 에 근거가 없다.

