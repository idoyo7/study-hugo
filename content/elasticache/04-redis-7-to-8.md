---
title: "Redis 7.0 → 8.10 — 그리고 9 는 왜 없나"
date: 2026-08-06
weight: 4
---

# 04 · Redis 7.0 → 8.10 — 그리고 9 는 왜 없나

{{< callout type="info" >}}
- Redis 에 9 는 없습니다. `redis/redis` 에 `9*` 태그가 하나도 없습니다. 숫자 브랜치는 `8.10` 이 끝이고 마일스톤 목록에도 `9.0` 이 없습니다. 8.10 GA 이후에도 `unstable` 의 `src/version.h` 는 여전히 `8.9.241` 입니다 `✓`. 9.0 계획을 공표한 문서는 찾지 못했습니다 — 9 를 기다려 업그레이드를 미루는 것은 근거 없는 유예입니다 `Σ`.
- "8.1·8.3·8.5 가 스킵됐다" 는 오해입니다. 홀수 마이너는 프리릴리스 전용 번호입니다 — 8.0 의 RC1 은 `7.9.240`, 8.10 의 RC1 은 `8.9.240` 으로 실재합니다 `✓`. GA 는 짝수만 나옵니다(8.0 → 8.2 → 8.4 → 8.6 → 8.8 → 8.10).
- 8.0 은 기능 릴리스가 아니라 제품 경계의 재편입니다. 이름(Community Edition → Open Source) · 라이선스(AGPLv3 추가) · 번들 구성(Redis Stack 흡수)이 한 릴리스에 겹쳤습니다 `✓`. 그 "core 통합" 은 빌드 시 각 모듈 upstream 을 `git clone` 해 `.so` 로 만들고 `loadmodule` 로 싣는 번들입니다 — 바이너리 내장이 아닙니다(`redis 8.0.0:modules/common.mk:34`) `✓`.
- 8.6 이후로 롤백 창이 닫혔습니다. RDB_VERSION 이 7.4~8.4 구간 12 로 고정이었다가 8.6=13 · 8.8=14 · 8.10=15 로 매 릴리스 올라갑니다(`redis 8.10.0:src/rdb.h:21`) `✓`. "가볍게 올려보고 안 되면 내리자" 가 8.6 부터 성립하지 않습니다.
- Redis 는 "LTS" 라는 말을 쓰지 않습니다. Standard(다음 마이너 후 6개월) / Extended(5년)이고 8.x 중 Extended 는 8.2 하나뿐(EOL 2030-09-01)입니다. 8.0 은 2026-12-01 에 끝납니다 `✓`. 최신인 8.10 은 지원 표에 아직 등재조차 되지 않았습니다 — 장기 지원을 전제하면 안 됩니다.
- "87% 빠르다" 는 분포의 최댓값입니다. 실제 수치는 7.2.5 대비 149개 테스트 중 90개 개선, p50 감소폭 5.4%~87.4%, 중앙값 16.7% `Ⓥ`. "2배 처리량" 은 `io-threads=8` + multi-core Intel 조건이고 기본값은 `io-threads 1` 입니다(`redis 8.10.0:src/config.c:3396` — 8.10.0 까지 `IMMUTABLE_CONFIG`) `✓`.
- 9 를 찾는 사람은 대개 Valkey 를 보고 있습니다. Valkey 는 홀수 마이너를 정식 GA 로 쓰고(8.1 · 9.1) 9.0.0 이 2025-10-21 에 나왔습니다 — Redis 의 짝수 전용 케이던스와 정반대입니다 `✓`. → [05]({{< relref "05-valkey-8-to-9/index.md" >}})
{{< /callout >}}

> **왜 이 문서인가.** "7·8·9 에 무엇이 추가되나" 라는 질문은 Redis 쪽에서는 전제가 하나 틀려 있습니다. 9 가 없다는 사실을 모르면 릴리스 표를 아무리 읽어도 "곧 나올 9 를 기다린다" 는 잘못된 결론에 이릅니다. 그래서 이 문서는 순서를 뒤집습니다 — 먼저 9 의 부재를 확증하고 그 다음에 7.0 부터 8.10 까지 실제로 무엇이 들어왔는지, 그중 운영자가 업그레이드 전에 손을 대야 하는 것이 무엇인지 봅니다.

> 근거 기준: 릴리스일은 GitHub `published_at`(= 태그의 creatordate)입니다. 소스 인용은 로컬 blobless 클론 `~/evejuni/redis` 에서 `git show <tag>:<path>` 로 실측한 값이고 릴리스노트는 각 태그의 `00-RELEASENOTES` 원문입니다. 확인 시점 2026-08-05(최신 GA = 8.10.0, 2026-07-29). 6.2 이하는 [01]({{< relref "01-origins-and-design/index.md" >}}), 라이선스 정치는 [03]({{< relref "03-license-and-fork.md" >}}), cluster 내부는 [06]({{< relref "06-cluster-mode/index.md" >}}) 이 소유합니다.

## 1. 한눈에 — 7.0 부터 8.10 까지

읽는 순서를 미리 정하면 이렇습니다. 7.0 은 파괴적 변경이 네 겹으로 겹친 유일한 마이너입니다. 7.2 는 변화가 적고 7.4 는 자료형 하나를 바꿉니다. 8.0 은 제품 경계가 바뀌고 8.2 이후는 "기능은 계속 늘지만 롤백이 막히는" 구간입니다.

| 버전 | 릴리스일 | 대표 변화 | RDB | 라이선스 | 지원 타입 |
|---|---|---|---|---|---|
| **7.0.0** | 2022-04-27 | Functions · ACLv2 selector · sharded pub/sub · listpack · multi-part AOF | **10** | BSD-3 | (종료) |
| **7.2.0** | 2023-08-15 | `WAITAOF` · `CLIENT NO-TOUCH` · set listpack 화 | **11** | BSD-3 (**BSD 로 출발한 마지막 라인**) | Extended · EOL 2029-12-01 |
| **7.4.0** | 2024-07-29 | **hash field TTL**(`HEXPIRE` 계열 9개) | **12** | RSALv2 + SSPLv1 (첫 적용) | Extended · EOL 2029-12-01 |
| **8.0.0** | 2025-05-02 | Stack 모듈 번들 · **Vector Set**(beta) · 이름·라이선스 재편 | 12 | + AGPLv3 (트라이) | Standard · **EOL 2026-12-01** |
| **8.2.0** | 2025-08-04 | `XDELEX`/`XACKDEL` · `CLUSTER SLOT-STATS` · `BITOP DIFF` 계열 | 12 | 트라이 | **Extended · EOL 2030-09-01** |
| **8.4.0** | 2025-11-18 | `CLUSTER MIGRATION`(atomic slot migration) · `MSETEX` · `SET IF*` | 12 | 트라이 | Standard · TBD |
| **8.6.0** | 2026-02-10 | `XADD` 멱등성 · `HOTKEYS` · `volatile-lrm` eviction | **13** | 트라이 | Standard · TBD |
| **8.8.0** | 2026-05-25 | 새 자료구조 **Array** · `INCREX` · `XNACK` | **14** | 트라이 | Standard · TBD |
| **8.10.0** | 2026-07-29 (최신) | **Compact hashes** · `BACKUP` · replication stream 압축 | **15** | 트라이 | **미등재** |
| **9.x** | — | **존재하지 않는다** | — | — | — |

날짜에 함정이 하나 있습니다. 7.4 이후 구간에서 `git log -1 <tag>` 가 찍는 author date 가 릴리스일과 다릅니다 — 7.4.0 은 author date 2024-07-28 / 릴리스 2024-07-29, 8.6.0 은 2026-02-08 / 2026-02-10 입니다 `✓`. 태그 객체 종류 때문이 아닙니다 — Redis 태그는 2.6.0~6.0.0 이 annotated, 6.2.0 이후는 전부 lightweight 이고(`git cat-file -t refs/tags/<tag>`), lightweight 에서 `creatordate` 는 가리키는 커밋의 committer date 를 따릅니다. 즉 벌어지는 것은 author date 와 committer date 이고 7.2.0 까지는 그 둘이 같아서 함정이 드러나지 않았습니다 `✓`. 인터넷에 떠도는 "7.4.0 = 2024-07-28" 은 author date 를 릴리스일로 인용한 결과입니다.

지원 표에는 한 줄이 더 있습니다. 6.2 는 Extended 로 EOL 2027-04-01 입니다. 실제로 2026-07-23 에 6.2.23 / 7.2.15 / 7.4.10 / 8.2.8 / 8.4.5 / 8.6.5 / 8.8.1 이 하루에 동시 릴리스됐습니다 `✓`. 이 웨이브에 8.0.x 만 없습니다(8.0.6 이 2026-02-22 로 마지막) — Standard 인 8.0 은 이미 유지보수 종료 국면이고 표에 적힌 정책이 말뿐이 아니라는 증거도 됩니다.

## 2. 7.0 (2022-04-27) — 프로그래머빌리티의 소유권이 옮겨간다

7.0 의 축은 다섯입니다. 그중 하나는 개발 모델을 바꾸고 넷은 업그레이드를 위험하게 만듭니다.

### 2.1 Functions vs EVAL — "스크립트는 애플리케이션 코드, 함수는 데이터베이스의 일부"

`FUNCTION LOAD` / `FCALL` / `FCALL_RO` 가 신설되어 EVAL 스크립트를 대체합니다. 라이브러리는 shebang 헤더(`#!lua name=mylib`)로 엔진과 이름을 선언하고 함수는 `redis.register_function()` 으로 등록합니다. 7.0-RC3 에서 `FUNCTION LOAD` 의 `ENGINE`/`NAME` 인자가 제거되어 스크립트 본문으로 옮겨졌고 `DESCRIPTION` 은 삭제됐습니다 `✓`.

차이는 문법이 아니라 소유권입니다. EVAL/EVALSHA 는 Redis 가 스크립트를 캐시만 하므로 `SCRIPT FLUSH`·재시작·replica 로 failover 하는 시점에 언제든 사라질 수 있고 재적재 책임이 애플리케이션에 있습니다. 공식 문서가 그 전제를 문장으로 명시합니다 — "The underlying assumption is that scripts are a part of the application and not maintained by the Redis server." 반대로 함수는 "first-class software artifacts of the database … persisted to the AOF file and replicated from master to replicas, so they are as durable as the data itself" 입니다 `✓`.

스크립트가 애플리케이션 소유였을 때 생기던 실무 문제도 같은 문서가 열거합니다 — (1) 모든 클라이언트 인스턴스가 사본을 유지해야 하고, (2) 트랜잭션 안에서 캐시 스크립트를 부르면 missing script 로 실패할 확률이 커지고, (3) SHA1 때문에 `MONITOR` 디버깅이 사실상 불가능하고, (4) 스크립트가 다른 스크립트를 호출할 수 없어 재사용이 안 됩니다 `✓`.

운영에서 달라지는 것은 이렇습니다. 함수는 RDB/AOF·replication 을 타므로 "함수 배포" 가 코드 배포보다 데이터 마이그레이션에 가까워집니다. Cluster 에서는 자동 전파되지 않습니다 — 문서가 `redis-cli --cluster-only-masters --cluster call host:port FUNCTION LOAD …` 를 쓰라고 명시적으로 안내하고 `--cluster add-node` 는 기존 노드에서 함수를 복사해 옵니다. ephemeral cache 로 쓰는 클러스터라면 `redis-cli --functions-rdb` 로 함수만 담은 RDB 를 만들어 부팅 시 적재하는 우회가 필요합니다 `✓`.

### 2.2 나머지 네 축과, 7.0 이 위험한 이유

| 항목 | 무엇 | 업그레이드에서 조용히 깨지는 것 |
|---|---|---|
| **ACLv2**(#9974) | key 단위 세분 권한 + **selector**(한 유저가 복수 command rule 세트). `ACL DRYRUN` 신설 | **pub/sub 채널이 기본 차단**으로 바뀝니다(`acl-pubsub-default=resetchannels`) — 기존 ACL 유저로 pub/sub 을 쓰던 앱이 죽습니다. `ACL GETUSER` 응답 포맷도 ACL 문법으로 변경 |
| **sharded pub/sub**(#8621) | `SPUBLISH`/`SSUBSCRIBE`/`SUNSUBSCRIBE`, `PUBSUB SHARDCHANNELS`/`SHARDNUMSUB` | 대가는 **채널명이 슬롯에 묶이는 것**입니다. cluster 에서 왜 필요했는지는 [06]({{< relref "06-cluster-mode/index.md" >}}) |
| **listpack 전환**(#8887·#9366·#9740) | Hash/List/Zset 의 ziplist 를 listpack 으로 교체. `hash-max-listpack-*`·`zset-max-listpack-*`·`list-max-listpack-size` config 등장 | `OBJECT ENCODING` 이 `ziplist` 대신 `listpack` 을 반환합니다 — 인코딩 문자열로 분기하는 모니터링·테스트가 깨집니다. 구 RDB 로딩·primary 복제 시 **on-the-fly 변환**이 일어나 로딩이 약간 느려집니다(릴리스노트 명시) |
| **multi-part AOF**(#9788) | AOF 가 단일 파일에서 **manifest + base + incr 파일들의 폴더**로. `appenddirname` 신설, `redis-check-aof` 대응(#10061) | `INFO` 의 `aof_rewrite_buffer_length` 가 사라집니다. 백업 스크립트가 `appendonly.aof` 단일 파일을 전제하면 전부 다시 써야 합니다. 7.0 자신이 이것을 "Potentially Breaking Changes" 로 분류했습니다 |

여기에 command introspection 이 붙습니다 — `COMMAND DOCS`·`COMMAND LIST`·`COMMAND GETKEYSANDFLAGS`·key-specs·command tips. 여기에도 눈에 잘 띄지 않는 변경이 하나 딸려 있습니다. `COMMAND` 응답에서 `random`/`sort-for-scripts` 플래그가 사라져 tips 로 이동했습니다 `✓`.

7.0 업그레이드의 위험은 (a) RDB v10 비호환, (b) AOF 디렉터리 구조 변경, (c) ACL pub/sub 기본 차단, (d) `MODULE`/`DEBUG` 기본 protected 로 네 겹입니다. 이 중 (c) 만이 런타임에 애플리케이션을 죽입니다 — 나머지 셋은 기동·복원 시점에 드러납니다 `Σ`.

흔한 오해 하나를 여기서 정정합니다. `CLIENT NO-TOUCH` 는 7.0 이 아니라 7.2 기능(#11483)입니다. 7.0 에 들어온 것은 `CLIENT NO-EVICT`(#8687)입니다 `✓`.

## 3. 7.2 (2023-08-15) — 조용한 릴리스, 그리고 BSD 로 출발한 마지막 라인

헤드라인 신규 기능이 `WAITAOF` 하나뿐입니다(디스크 fsync 완료까지 블록). 나머지는 최적화와 introspection 입니다 — `CLIENT NO-TOUCH`(LRU/LFU 를 건드리지 않고 커맨드 실행), `CLIENT SETINFO`(lib-name/lib-ver 보고), `CLUSTER MYSHARDID`/Shard ID, `ZRANK`/`ZREVRANK WITHSCORE` `✓`.

listpack 전환이 여기서 끝납니다. 7.0 은 Hash/List/Zset 까지였고 Set 은 7.2 입니다. 릴리스노트의 "Significant memory optimization for small set type keys (#11290)"·"for large sets (#11595)" 가 그것이고 코드 근거가 더 명확합니다 — `set-max-listpack-entries 128` / `set-max-listpack-value 64` 가 `redis 7.2.0:redis.conf` 에서 처음 등장합니다(7.0.0 에는 없습니다) `✓`. "listpack 전환은 7.0 에서 끝났다" 는 서술은 절반만 맞습니다.

RESP3 는 7.2 에서도, 8.10 에서도 기본이 아닙니다. 프로토콜 스펙이 "By default, the connection starts in RESP2 mode" 라고 명시하고 RESP3 로 가려면 클라이언트가 `HELLO 3` 로 승격해야 합니다 `✓`. 스펙은 "Future versions of Redis may change the default protocol version" 이라고 미래형으로만 언급합니다. 7 이후 RESP2/RESP3 양쪽에서 모든 core 커맨드를 부를 수 있지만 응답 타입이 프로토콜에 따라 달라집니다 — 클라이언트 라이브러리를 올릴 때 여기서 사고가 납니다. 7.2 에는 동작 변경이 하나 더 있습니다. RESP3 클라이언트가 자기가 구독한 채널에 `PUBLISH` 하면 응답과 메시지 순서가 바뀝니다(#12326) `✓`.

라이선스는 이 문서의 소유가 아니지만 버전 라인에 걸린 사실 하나는 여기서 적어 둡니다. 7.2 는 BSD-3 로 출발한 마지막 마이너 라인입니다 — 7.2.0 / 7.2.4 / 7.2.15(2026-07-23) 모두 루트에 `COPYING`(BSD-3)만 있고 `LICENSE.txt` 가 없습니다. 7.4.0 부터 `COPYING` 이 사라지고 `LICENSE.txt` 가 생깁니다 `✓`. 라이선스 판정은 릴리스 날짜가 아니라 버전 라인 단위로 해야 합니다. 그 판정표와 전환의 경위·조항은 [03]({{< relref "03-license-and-fork.md" >}}) 이 소유합니다.

## 4. 7.4 (2024-07-29) — hash field TTL, 그리고 앱이 하던 일을 엔진이 받는다

`HEXPIRE`·`HPEXPIRE`·`HEXPIREAT`·`HPEXPIREAT`·`HPERSIST`·`HEXPIRETIME`·`HPEXPIRETIME`·`HTTL`·`HPTTL` — 9개 커맨드가 한 번에 들어옵니다(#13303). 필드 만료 시 `hexpired` keyspace 이벤트(#13329), `INFO` 의 `subexpiry` 필드, `expired_subkeys` 메트릭이 붙습니다 `✓`.

왜 이게 필요했나. 그전까지 Redis 의 만료 단위는 키뿐이었습니다. 세션 스토어에서 "세션은 30분 유효하지만 CSRF 토큰 필드는 5분" 을 구현하려면 필드를 별도 키로 쪼개(`sess:{id}:csrf`) TTL 을 걸어야 했습니다. 해시 태그로 같은 슬롯에 묶은 뒤 애플리케이션이 두 키의 일관성까지 관리해야 했습니다. 레이트리밋도 같습니다 — 윈도별 카운터를 필드로 두고 싶어도 필드 단위 만료가 없으니 키를 윈도마다 새로 만들고 `EXPIRE` 를 걸었습니다. 7.4 는 그 우회를 엔진 안으로 들여옵니다. 세션은 살아 있는데 특정 필드만 사라지는 모델이 처음으로 서버 쪽에서 표현 가능해집니다 `Σ`.

대가도 있습니다. RDB 가 12 로 올라가 7.2 이하로 다운그레이드할 수 없습니다. 이 기능은 초기에 세부가 계속 흔들렸습니다 — RC1 → GA 사이에 RDB 파일 포맷이 또 바뀌었고(#13391, #13438) `HEXPIRE` 류의 `DENYOOM` 플래그가 8.0-M04 에서 제거됐습니다 `✓`. 프리릴리스로 개발해 프로덕션에 올린 경로가 있었다면 이 구간을 확인해야 합니다.

7.4 시점에 core 와 모듈은 아직 완전히 분리돼 있습니다. `git ls-tree --name-only 7.4.0` 에 `modules/` 디렉터리가 없습니다 — 8.0 에서 처음 생깁니다 `✓`. "Redis 7.4 + Redis Stack" 은 서로 다른 두 배포물이었습니다.

같은 기능이 Valkey 에는 9.0.0(2025-10-21) 에 들어왔습니다. Redis 가 약 15개월 앞섰고 두 진영의 동작이 다릅니다(Valkey 는 lazy expiration 이 없습니다) — 상세는 [05]({{< relref "05-valkey-8-to-9/index.md" >}}).

## 5. 8.0 (2025-05-02) — 분기점

8.0 은 앞뒤 마이너와 성격이 다릅니다. 릴리스노트 첫머리는 기능보다 이름 변경 · 라이선스 추가 · 번들 구성 변경을 먼저 나란히 놓습니다 — "Name change: Redis Community Edition is now Redis Open Source", "License change: … the GNU Affero General Public License (AGPLv3)", "Redis Query engine and 8 new data structures are now an integral part of Redis 8" `✓`.

### 5.1 "core 통합" 의 실제 형태 — 번들이지 내장이 아니다

이 절이 오해를 가장 많이 삽니다. `git ls-tree 8.0.0 modules/` 는 다섯 개의 트리를 보여줍니다(`redisbloom`·`redisearch`·`redisjson`·`redistimeseries`·`vector-sets`). 그런데 `modules/redisearch/` 의 내용은 `Makefile` 단 하나이고 그 Makefile 은 이렇게만 되어 있습니다 `✓`.

```make
SRC_DIR = src
MODULE_VERSION = v8.0.0
MODULE_REPO = https://github.com/redisearch/redisearch
TARGET_MODULE = $(SRC_DIR)/bin/$(FULL_VARIANT)/search-community/redisearch.so
include ../common.mk
```

실제 취득 규칙은 `modules/common.mk` 에 있습니다 — `git clone --recursive --depth 1 --branch $(MODULE_VERSION) $(MODULE_REPO) $(SRC_DIR)`(`redis 8.0.0:modules/common.mk:34`). `.gitmodules` 는 존재하지 않아 submodule 도 아닙니다 `✓`. 빌드 결과를 실으려고 8.0 은 `redis-full.conf` 라는 새 설정 파일을 함께 배포합니다(`redis 8.0.0:redis-full.conf:3-6`) `✓`.

```
loadmodule ./modules/redisbloom/redisbloom.so
loadmodule ./modules/redisearch/redisearch.so
loadmodule ./modules/redisjson/rejson.so
loadmodule ./modules/redistimeseries/redistimeseries.so
```

RediSearch/JSON/TimeSeries/Bloom 은 (a) redis/redis 트리에 벤더링된 것도 아니고 (b) `redis-server` 바이너리에 컴파일된 것도 아닙니다. 빌드 시 코어와 같은 버전 태그(`v8.0.0`)로 clone 되어 `.so` 가 되고 런타임에 `loadmodule` 로 올라갑니다. `MODULE LIST` 에 네 개가 그대로 보입니다 — 프로세스 모델은 여전히 모듈이고 "core 통합" 은 마케팅 표현입니다 `✓`.

예외는 Vector Set 하나입니다. `modules/vector-sets/` 는 실제 소스가 in-tree입니다(`vset.c`·`hnsw.c`·`expr.c`·`cJSON.c`). 8.10 의 매니페스트가 이걸 주석으로 명시합니다 — "`vector-sets` is intentionally absent — it lives in-tree under `modules/vector-sets/` and is not cloned"(`redis 8.10.0:modules/modules.yaml:60-61`) `✓`.

8.10 에서 구조가 한 번 더 정리됩니다. per-module Makefile 스텁이 사라지고 `modules.yaml` 단일 매니페스트 + `manifest.mk` 로 바뀝니다. 각 모듈은 `ref: v8.10.0` 으로 코어 버전에 핀되고 `make tarball` 이 네트워크 없이 빌드 가능한 소스 tarball 을 만듭니다 `✓`.

여기서 나오는 운영 함의는 이렇습니다.

| 함정 | 내용 |
|---|---|
| **`make` 만 하면 코어만 나온다** | 공식 `apt`/`rpm`/Docker 배포에는 네 개 `.so` 가 들어 있지만 소스에서 직접 빌드하면 코어뿐입니다. 모듈까지 원하면 `make modules-update && make build`(8.10) 또는 `make -C modules`(8.0)가 필요하고, 8.0 계열은 빌드 중 **네트워크와 Rust 툴체인(1.80.1)** 을 요구합니다. 에어갭 환경은 tarball 경로를 써야 합니다 `✓` |
| **`redis.conf` 를 가리키면 모듈이 안 올라온다** | `redis-full.conf` 를 써야 합니다. 8.10 문서는 이 파일이 **untracked 이고 `make modules-update` 마다 재생성**된다고 명시합니다 — 이 파일에 직접 손댄 설정은 사라집니다 `✓` |
| **구형 ARM 에서 RediSearch 가 SIGILL 로 죽는다** | 8.10 매니페스트의 `build_env: … INLINE_LSE_ATOMICS=0` 주석이 이유를 적어 놓았습니다 — "avoids SIGILL on pre-Armv8.1-a ARM cores — Cortex-A72, Graviton1, RPi4". 번들 빌드는 이 플래그를 강제하므로, 직접 빌드하면서 놓치면 재현될 수 있습니다 `✓` |

### 5.2 Vector Set — beta 로 나왔고, GA 선언이 없다

8.0-RC1(2025-04-07)에서 `#13915` 로 신설됐습니다. sorted set 에서 score 자리에 벡터를 연결한 자료형이고 antirez 가 개발했습니다. 8.0 GA 릴리스노트는 "(9) Vector set **[beta]**" 로 표기하고 "We may change, or even break, the features and the API in future versions" 라고 경고했습니다 `✓`.

그 다음이 문제입니다. 8.2 / 8.4 / 8.6 / 8.8 / 8.10 릴리스노트 전체를 훑어도 beta 해제나 GA 선언 문장이 없습니다 `✓`. 대신 기능·성능·버그 수정만 이어집니다 — 8.2 `VSIM WITHATTRIBS`·`VSIM … IN` 필터·`VISMEMBER`, 8.4 `VADD`/`VSIM` 의 AVX2/AVX512 dot product·`VRANGE`, 8.6 popcount 교체와 8-bit·바이너리 양자화 벡터화, 8.8 `VADD`/`VSET` 크래시 수정, 8.10 `VRANDMEMBER` 크래시 수정. 현재 `redis.io` 의 vector-sets 페이지에는 beta 경고가 없고 커맨드별 "Since" 표기만 있습니다. 같은 사이트의 `whats-new/8-0` 페이지는 아직 "Vector set is currently available in beta" 로 남아 문서끼리 불일치합니다 `✓`.

성숙도를 정직하게 말하면 "8.0 에서 beta 로 나왔고, 8.6~8.8 에 SIMD 최적화와 크래시 수정이 집중적으로 들어간 뒤 문서에서 beta 문구가 사라졌다" 까지입니다. 특정 버전을 GA 시점으로 지목할 근거가 없습니다 `?`. 실무적으로 하나는 확실합니다: 8.2 에서 big-endian 머신의 RDB 포맷 비호환이 수정됐습니다(#14144) — s390x 등에서 8.2 이전에 벡터셋을 썼다면 그 RDB 는 신뢰할 수 없습니다 `✓`.

### 5.3 성능 주장 — 조건을 붙이면 과장이 아니고, 조건을 떼면 틀린 문장이 된다

| 주장 | 실제 조건 | 판정 |
|---|---|---|
| "up to 87% faster" | **7.2.5 대비** 149개 테스트 중 **90개 커맨드**가 개선, p50 레이턴시 감소폭 **5.4%~87.4%**, **중앙값 16.7%**. 개별 예시 ZADD −36%, SMEMBERS −28%, HGETALL −10% | 과장은 아닙니다. 단 87.4% 는 **분포의 최댓값**이므로 "Redis 8 이 7 보다 87% 빠르다" 는 **틀린 문장**입니다 `Ⓥ` |
| "2x more ops/sec" | **`io-threads=8` + multi-core Intel CPU** 에서 최대 **112%** 처리량 향상. 공식 문장도 "Exact throughput improvements will vary, contingent on the commands being executed" 를 붙인다 | 기본값이 `io-threads 1` 이므로 **업그레이드만으로는 얻지 못한다** `Ⓥ` |
| "up to 18% faster replication / 35% less memory" | 10GB 데이터셋 full sync + 그 사이 26.84M write(25GB 변경). 결과는 primary 쓰기 처리율 +7.5%, 복제 시간 −18%, primary 측 replication buffer 피크 −35% | 조건이 구체적이라 인용 가능 `Ⓥ` |
| "up to 16x more query processing power" | Query Engine 의 수평(cluster)·수직(multi-thread) 스케일링을 **둘 다 켠** 경우. 1B × 768dim 에서 정밀도 ≥95% 시 66,000 insert/s, 정밀도를 낮추면 160,000/s. 검색 레이턴시는 **정밀도 90% → median 200ms, 95% → median 1.3s**(top-100, 동시 50쿼리) | 1.3초는 "실시간" 이라 부르기 어렵다 — **정밀도를 함께 쓰지 않으면 오독을 유발한다** `Ⓥ` |

8.x 성능 개선의 성격이 이 표에 드러납니다. 대부분 (a) prefetch·SIMD 같은 CPU 마이크로 최적화와 (b) `io-threads` 설정에 걸려 있습니다. 그런데 `io-threads` 는 8.10.0 까지도 `IMMUTABLE_CONFIG` 이고 기본 1, 상한 128 입니다(`redis 8.10.0:src/config.c:3396`) `✓` — 런타임에 못 바꾸므로 재시작 계획에 넣어야 하고 안 켜면 "8.x 로 올렸는데 왜 안 빠르냐" 가 그대로 나옵니다. diskless full sync 의 checksum 생략(#14851)이나 fork child 의 `MADV_DONTNEED`(#14979) 같은 것은 설정 없이 얻습니다 `✓`.

성능 주장의 서술 품질은 8.8 에서 크게 개선됩니다 — 기준선(8.6), 하드웨어(AWS m7i.metal-24xl x86 / m8g ARM), 재현 스펙(`redis/redis-benchmarks-specification`)이 모두 명시됩니다 `Ⓥ`.

### 5.4 7.4 다음이 왜 8.0 인가

공식 근거로 확인되는 것은 둘뿐입니다 `✓`. 8.0 이 담은 것이 제품 경계의 재편입니다 — 이름 변경, AGPLv3 추가, Redis Stack 흡수가 한 릴리스에 겹쳤고 공식 블로그가 "we're combining our Redis Stack and community offerings into a single Redis Open Source distribution" 이라고 씁니다. 버전 정책 문서의 정의상으로도 메이저 증가는 "breaking change 를 포함할 수 있는 중대한 변화" 이고 마이너는 "메이저 안에서의 신기능·개선" 입니다. Stack 흡수는 후자로 담기 어려운 규모였습니다.

정정할 서술이 하나 있습니다. "7.4 가 non-OSI 라이선스여서 배포판에서 퇴출당했고 그래서 7.6 을 건너뛰었다" 는 인과는 2차 출처(remirepo 블로그 등)의 해석입니다. Redis 공식 문서·블로그에서 "7.6 을 건너뛰었다" 는 문장을 찾지 못했습니다 `?`.

혼동하기 쉬운 것도 하나 정리해 둡니다. Redis 7.8 과 7.22 는 실재합니다. OSS 가 아니라 Redis Software(상용)의 번호입니다. Redis Software 는 `Major1.Major2.Minor-Build` 4자리 번호를 쓰고 7.8(2024-11)·7.22(2025-05)가 있으며 Redis Software 8.2.0 은 번들 DB 엔진으로 `6.2, 7.2, 7.4, 8.0, 8.2, 8.4, 8.6` 를 담고 기본값이 8.6 입니다 `✓`. 티켓이나 벤더 문서에서 "Redis 7.8" 을 봤다면 어느 축의 번호인지 먼저 구분해야 합니다.

같은 축의 오해로 Redis Flex / Auto Tiering / RDI 도 OSS 에 없습니다. 7.x·8.x 릴리스노트 전체를 `flex|tiering|auto-tier|flash` 로 grep 하면 0건이고 `redis 8.10.0:redis.conf` 에도 0건입니다 `✓`. "Redis 8 로 올리면 Flex 로 메모리 비용을 줄일 수 있다" 는 판단은 OSS 에서 성립하지 않습니다.

## 6. 8.2 ~ 8.10 — 릴리스별로 무엇이 오고 무엇을 해야 하나

이 표가 이 문서에서 가장 실용적인 부분입니다. "새 기능" 은 고를 수 있지만 "breaking" 과 "운영자가 할 일" 은 고를 수 없습니다.

| 버전 | 릴리스 | 새 기능 | breaking | 운영자가 할 일 |
|---|---|---|---|---|
| **8.2.0** | 2025-08-04 | `XDELEX`/`XACKDEL` + `XADD`/`XTRIM` 확장(#14130) · **`CLUSTER SLOT-STATS`**(#14039, 슬롯별 키 수·CPU 시간·네트워크 I/O) · `BITOP DIFF`/`DIFF1`/`ANDOR`/`ONE`(#13898) · `VSIM … IN` 필터(#14122) · Query Engine **SVS-VAMANA** 벡터 인덱스 · keyspace 알림 `OVERWRITTEN`/`TYPE_CHANGED`(#14141) | 명시적 breaking 섹션 **없음**. RDB 12 유지. 단 **문서화되지 않은 `SCAN` 필터 순서 변경**이 들어 있었고 8.6 이 되돌렸습니다(#14537) | ① **CVE 세 건이 필수 업그레이드 사유입니다** — CVE-2025-32023(HyperLogLog OOB write) · CVE-2025-48367(accept 오류 시 다른 연결 수용 중단) · CVE-2025-27151(`redis-check-aof` 스택 오버플로). ② `CLUSTER SLOT-STATS` 로 핫 슬롯을 처음 정량 측정할 수 있습니다 → 리샤딩 판단 지표로 도입. ③ **big-endian 에서 벡터셋을 썼다면 8.2 이전 RDB 는 신뢰 불가**. ④ `SHARD_K_RATIO` 는 릴리스노트가 "unstable feature" 로 표기 — 프로덕션 금지 |
| **8.4.0** | 2025-11-18 | **`CLUSTER MIGRATION` = atomic slot migration**(#14414, destination 에서 pull) · `DELEX`/`DIGEST`/`SET IF*` = 문자열 키의 **compare-and-set/delete**(#14435) · **`MSETEX`**(#14434) · `XREADGROUP … CLAIM min-idle-time`(#14402) · 부팅 시 손상된 AOF tail 자동 복구(#14058) · `FT.HYBRID`(#Q7076) | 명시적 breaking 섹션 없음, RDB 12 유지. **동작 기본값 2건이 바뀝니다** — `search-default-scorer` 기본값이 **BM25STD**(#Q7065)로 바뀌어 **검색 점수와 랭킹 순서가 달라집니다**, `search-on-oom` 기본값 `RETURN`(부분 결과 반환, #Q6769) 신설 | ① **atomic slot migration 과 검색·시계열 커맨드의 상호작용에 알려진 결함** — 마이그레이션 중 `FT.SEARCH`/`FT.AGGREGATE`/`FT.CURSOR`/`FT.HYBRID`/`TS.MGET`/`TS.MRANGE`/`TS.QUERYINDEX` 결과가 **부분적이거나 중복될 수 있습니다**(릴리스노트 known limitations). **리샤딩 윈도에 검색 트래픽을 흘리지 말 것.** ② 검색 랭킹 회귀 테스트 필수. ③ `FT.HYBRID` 는 GA 지만 `FT.PROFILE`/`FT.EXPLAIN` 미지원 등 제약이 많습니다. ④ `aof-load-corrupt-tail-max-size` 를 명시 설정해 자동 복구 범위를 통제. ⑤ `search-io-threads` 기본 20 — 코어 수 대비 과다한지 확인 |
| **8.6.0** | 2026-02-10 | `XADD` **멱등성**(at-most-once) — `IDMPAUTO`/`IDMP`(#14615) · 새 eviction **`volatile-lrm`/`allkeys-lrm`**(least recently **modified**, #14624) · **`HOTKEYS`**(#14680) · TLS 인증서 기반 클라이언트 자동 인증(#14610) · 키 메모리 히스토그램(#14695) · `cluster-slot-stats-enabled`(#14719) | **RDB 12 → 13. 8.4 이하로 다운그레이드 불가.** 그리고 8.2 의 `SCAN` 필터 순서 변경을 **되돌렸습니다**(#14537) — 8.2/8.4 에서 SCAN 순서에 의존한 코드는 여기서 또 바뀝니다. 제약: `appendonly yes` + `aof-use-rdb-preamble no` 조합에서 `XADD IDMP` 사용 금지 | ① **롤백 경로가 닫힙니다** — 카나리 계획을 RDB 가 아닌 수단으로 세워야 합니다. ② 보안 수정 다수, 그중 **`MSETEX` 의 key-pattern ACL 우회**(#14659)가 결정적입니다 — 8.4 에서 `MSETEX` 를 쓰며 ACL 로 키 패턴을 제한했다면 **그 제한은 실제로 우회 가능했습니다.** ③ **8.6 의 `HOTKEYS` 결과는 신뢰하지 말 것** — 8.8 에서 관련 버그 5건이 수정됩니다. ④ `volatile-lrm` 은 "최근 수정" 기준이라 읽기 위주 캐시에서 LRU 와 결과가 크게 다릅니다 → 전환 전 히트율 검증. ⑤ writable replica 에서 `FLUSHALL ASYNC` 가 main thread 를 장시간 막던 버그(#14583) 수정 |
| **8.8.0** | 2026-05-25 | **새 자료구조 `Array`**(#15162, @antirez — 커맨드 **18개**, ACL 카테고리 `ARRAY`) · **`INCREX`** = `INCR` + 상한/하한 + 만료를 합친 윈도 카운터(#15045) · `XNACK`(pending 메시지 명시 반납, #14797) · **hash 필드 단위 keyspace 알림**(#14958) · `ZUNION`/`ZINTER` 계열의 `COUNT` aggregator(#14892) · slowlog 절단 config(#15182) | **RDB 13 → 14.** 그리고 **Removed Features** — 8.8-M02 에 들어갔던 **GCRA rate limiter 가 RC1 에서 제거**(#15191)됐고 `INCREX` 자체도 GA 직전 문법이 변경(#15237)됐습니다 → M02/M03 프리릴리스로 개발했다면 이관 필요 | ① **CVE 5건이 RCE 급입니다** — CVE-2026-23479(unblock client UAF) · CVE-2026-25243(`RESTORE` 잘못된 메모리 접근) · CVE-2026-23631(Lua UAF) · CVE-2026-25588/25589(TimeSeries·Probabilistic 의 `RESTORE`). **`RESTORE` 를 외부 입력으로 받는 경로(마이그레이션 툴, 백업 복원 API)가 있으면 최우선 패치.** ② Sentinel `SENTINEL SET` config injection(#14970) 수정 — Sentinel 을 신뢰 경계 밖에 뒀다면 심각. ③ slowlog 절단 config 로 큰 argv 의 slowlog 메모리 점유를 통제. 새 메트릭(`slowlog_commands_count`, `slowlog_commands_time_ms_sum/max`) 대시보드 추가. ④ `commands_per_parse_batch_avg`(실효 파이프라인 깊이 근사)로 prefetch 개선의 수혜 여부를 판별 |
| **8.10.0** | 2026-07-29 | **Compact hashes**(#15364) — **스키마를 공유하는 여러 hash 키의 필드명을 한 번만 저장하는 새 인코딩** + `HIMPORT`(고속 대량 삽입) + config 3개 + metric 4개 · **replication stream 압축**(#15366) · **`BACKUP`**(MP-AOF 기반 노드 측 백업/복원, #15441) · `LMOVEM`/`BLMOVEM`(#15405) · `SUNIONCARD`/`SDIFFCARD`(결과를 materialize 하지 않고 카디널리티만) · `XREAD` 의 `MAXCOUNT`/`MAXSIZE`(#15282) · **JSONPath 대폭 확장** · TimeSeries `TS.NRANGE`/`TS.READ`/`TS.QUERYLABELS` | **RDB 14 → 15**(compact hashes). 명시적 breaking 섹션은 없지만 **검색 타임아웃 정책이 실질적으로 바뀐다** — `search-on-timeout` 이 `FAIL`/`RETURN`(기본)/**`RETURN_STRICT`(신규)** 3값이 되고 강제가 엄격해집니다. `search-workers 0` 이면 `search-_max-foreground-timeout-limit`(기본 60000ms)로 캡되고, 새 `search-global-timeout` 이 쿼리별 `TIMEOUT` 의 상한이 됩니다 → **8.8 에서 조용히 오래 돌던 쿼리가 8.10 에서 잘려 나갈 수 있습니다** | ① **최우선: ACL 우회 취약점 #15478** — `SORT`·`GEORADIUS`·`GEORADIUSBYMEMBER`·`XREAD`·`XREADGROUP` 에서 ACL permission bypass. 8.8 이하에서 이 커맨드들을 ACL 로 제한했다면 **제한이 실제로는 우회 가능했습니다.** 함께 BCAST client-side caching invalidation 의 ACL key-name leak(#15371)도 수정. ② RESP 에러 응답에 `\r\n` 을 주입해 다른 커맨드 응답을 위조할 수 있던 문제(RC2 수정). ③ **`MEMORY USAGE` 의 의미가 바뀝니다** — compact hash 키는 "자기 몫 + template 지분" 을 보고합니다. 이 값을 합산해 총량을 추정하던 용량 산정 스크립트는 재검토. ④ `search-global-timeout`/`search-on-timeout` 을 명시 설정해 새 강제 정책을 통제. ⑤ replication stream 압축은 대역폭을 줄이고 CPU 를 씁니다 — 크로스 AZ/리전에서 이득이 크고 CPU 포화 환경은 검증 필요. ⑥ **`redis-cli --cluster reshard`/`rebalance` 가 서버측 atomic slot migration 을 쓰도록 변경(#15338)** — 같은 CLI 가 8.8 이하와 다르게 동작하므로 리샤딩 런북과 소요 시간 가정을 다시 세워야 합니다 |

표에 담기지 않은 것을 덧붙입니다.

RDB_VERSION 이 업그레이드 전략을 결정합니다.

| 태그 | 6.2.0 | 7.0.0 | 7.2.0 | 7.4.0 | 8.0.0 | 8.2.0 | 8.4.0 | 8.6.0 | 8.8.0 | 8.10.0 |
|---|---|---|---|---|---|---|---|---|---|---|
| RDB_VERSION | 9 | 10 | 11 | **12** | 12 | 12 | 12 | **13** | **14** | **15** |

7.4 / 8.0 / 8.2 / 8.4 는 포맷이 같아 그 사이 롤백 여지가 있었습니다(모듈 데이터 제외). 8.6 · 8.8 · 8.10 은 릴리스마다 올라가므로 롤백이 사실상 불가능합니다 `✓`. 6개월 케이던스로 마이너가 나오는데 매번 포맷이 바뀌면 다운그레이드는 replication 대신 논리적 재적재(`DUMP`/`RESTORE` 또는 애플리케이션 레벨 재구성)로 계획해야 합니다 — 8.8 의 CVE 목록에서 보듯 `RESTORE` 경로 자체가 공격면입니다 `Σ`.

"마이너라서 안전하다" 는 8.x 에서 성립하지 않습니다. 명시적 breaking 섹션이 없는 릴리스가 (a) 문서화되지 않은 `SCAN` 필터 순서 변경(8.2, 8.6 에서 되돌림), (b) 검색 기본 scorer 변경(8.4), (c) 검색 타임아웃 강제(8.10)를 담았습니다. 이 셋은 모두 에러 없이 결과가 달라지는 종류입니다 `Σ`.

보안 패치가 세 릴리스 연속으로 ACL 을 건드립니다. 8.6 의 `MSETEX` key-pattern 우회, 8.8 의 RCE 급 5건, 8.10 의 `SORT`/`XREAD` 계열 우회. ACL 을 다중 테넌시의 경계로 쓰고 있다면 8.10 이 사실상 최소 버전입니다 `Σ`.

## 7. 케이던스와 지원 정책 — 그리고 9 의 부재를 확증한다

### 7.1 짝수 마이너와 홀수 마이너

공식 버전 관리 문서가 마이너 예시를 "for example, 8.2 → 8.4 → 8.6 → 8.8" 로 듭니다 `✓`. 홀수는 프리릴리스 번호로 쓰입니다. `src/version.h` 를 태그별로 뽑으면 규칙이 그대로 드러납니다 `✓`.

| 태그 | `REDIS_VERSION` | 태그일 |
|---|---|---|
| `8.0-m01` | `7.9.224` | 2024-09-12 |
| `8.0-rc1` | `7.9.240` | 2025-04-07 |
| `8.0.0` | `8.0.0` | 2025-05-02 |
| `8.2-m01` / `8.2-rc1` | `8.1.224` / `8.1.240` | 2025-06-19 / 2025-07-03 |
| `8.4-rc1` | `8.3.240` | 2025-11-04 |
| `8.6-rc1` | `8.5.240` | 2026-01-22 |
| `8.8-rc1` | `8.7.240` | 2026-05-14 |
| `8.10-rc1` / `rc2` | `8.9.240` / `8.9.241` | 2026-07-20 |

패치 번호 224 부터가 마일스톤(M01=224 … M04=227), 240 부터가 RC(RC1=240, RC2=241)이고 마이너는 목표 릴리스보다 1 작은 홀수입니다. 릴리스노트 헤더에도 그대로 적혀 있습니다 — `8.0-RC1 (v7.9.240)`.

`-m0N` 의 뜻은 릴리스노트가 직접 정의합니다 — "Milestones are non-feature-complete pre-releases. Pre-releases are not suitable for production use. Once we reach feature-completeness we will release RC1." RC 는 "feature-complete pre-releases" 입니다 `✓`.

`-int` 태그는 공식 정의를 찾지 못했습니다 `?`. 실측으로 확인되는 것만 적습니다. GitHub Releases 목록에 `-int` 태그가 없습니다(8.10 사이클은 `8.10-rc1`·`8.10-rc2`·`8.10.0` 만 등재). 그런 태그 상당수는 `version.h` = `255.255.255` 라는 센티넬을 담습니다(`8.4-int`, `8.10-m01-int`\~`m04-int`) `✓`. 사내·CI 빌드용 비공개 태그로 읽는 것이 합리적이지만 어디까지나 근거 있는 추정이지 확인된 정의는 아닙니다. 실제로 8.10 사이클에서는 M01\~M04 가 전부 `-int` 로만 존재해 공개 마일스톤이 아예 없었습니다 — 8.10 릴리스노트에도 M 섹션이 없습니다 `✓`.

### 7.2 지원 기간 — LTS 는 없고, 8.x 에서 5년은 8.2 뿐이다

Redis 는 "LTS" 라는 용어를 쓰지 않습니다. 릴리스 타입이 둘입니다 `✓`.

- Standard — 메이저 시리즈의 첫 릴리스(8.0)와 중간 마이너(8.4, 8.6, 8.8). 다음 마이너가 나온 뒤 6개월만 보안·치명 버그 수정.
- Extended — 메이저 시리즈의 두 번째 마이너(8.2)와 그 시리즈의 마지막 마이너. 릴리스일로부터 5년.

| 버전 | 타입 | EOL |
|---|---|---|
| 8.10 | **미등재** | — |
| 8.8 / 8.6 / 8.4 | Standard | TBD |
| **8.2** | **Extended** | **2030-09-01** |
| 8.0 | Standard | **2026-12-01** |
| 7.4 / 7.2 | Extended | 2029-12-01 |
| 6.2 | Extended | 2027-04-01 |

실무에서 제일 무거운 결론이 여기서 나옵니다. 8.0 을 표준으로 삼은 조직은 2026-12-01 에 지원이 끊깁니다. 5년 지평이 필요하면 8.x 안에서는 8.2 가 유일한 선택이고 다음 Extended 는 "8 시리즈의 마지막 마이너" 가 확정될 때 정해집니다. 8.10 을 장기 지원으로 가정하면 위험합니다 — 지원 표에 등재조차 되지 않았고 Standard/Extended 구분도 미정입니다 `✓`. 정책 문서의 "마지막 마이너" 조항이 아직 발동하지 않았다는 것은 뒤집어 보면 8.x 가 더 나올 예정이라는 뜻이 됩니다(추론이며 명시 근거는 아닙니다) `≈`.

보조 근거로 메인테이너 발언이 하나 있습니다. GitHub Discussion #13464 에서 "With the first release of a new stable major, we will also support the two latest minors of the previous stable major. So with 8.0 - it would be 7.4 and 7.2." 라고 답했고 후속으로 "for 8.0 we decided to continue supporting 6.2 till, at least, end of 2025" 라는 예외를 밝혔습니다 `✓`. 6.2 는 실제로 2026-07-23 까지 패치가 나왔으므로 그 예외가 더 연장됐습니다.

### 7.3 9.0 은 없다 — 전수 확인

| 확인 | 명령 | 결과 |
|---|---|---|
| 태그 | `git tag -l '9*'` | **빈 결과** (로컬 클론에 `v1.*`·`v2.*` 구 태그까지 다 있으므로 fetch 누락이 아닙니다) `✓` |
| 브랜치 | `gh api repos/redis/redis/branches --paginate` | 숫자 브랜치는 `2.2 … 8.8, 8.10` 까지. **9 로 시작하는 브랜치 없음** `✓` |
| 개발 브랜치 버전 | `gh api repos/redis/redis/contents/src/version.h` | **`8.9.241`** — 8.10 GA 이후에도 다음 메이저나 다음 프리릴리스로 bump 되지 않았습니다 `✓` |
| 이슈 | `gh api 'search/issues?q=repo:redis/redis+9.0+in:title'` | `total_count = 1`, 그 하나는 **`#14787 Support Tcl 9.0 in Redis test suite`**(Tcl 버전 얘기, Redis 9 와 무관) `✓` |
| 마일스톤 | `gh api repos/redis/redis/milestones` | `Redis >= 4.2`, `4.0 final`, `Urgent`, `Redis 6.0.x`, `Next minor backlog`, `Next major backlog`. **`9.0` 마일스톤 없음** `✓` |
| 공표 | 공식 블로그·문서 검색 | "Redis 9" 로드맵·릴리스 계획 문서를 **찾지 못했다** `?` |

그래서 "9 를 기다린다" 는 전략이 성립하지 않습니다. 다음 릴리스가 8.12 일지 9.0 일지는 알 수 없고 지금 결정할 것은 8.x 안의 선택뿐입니다 `Σ`. 8.0 은 2026-12-01 에 끝나고 8.2 는 2030-09-01 까지 가고 8.10 은 최신이지만 지원 기간이 미정입니다 — 이 세 줄이 실제 선택지입니다. 판단표는 [08]({{< relref "08-choosing.md" >}}).

## 8. 그런데 왜 "9" 를 찾게 되는가 — Valkey 와의 대조

버전 번호 혼동의 출처는 대부분 하나입니다. 9.x 가 있는 쪽은 Valkey 입니다. 두 진영은 7.2.4 를 공통 조상으로 두고 그 이후 번호를 독립적으로 굴렸습니다. 케이던스 규칙이 정반대여서 같은 숫자가 전혀 다른 뜻입니다.

| 축 | Redis | Valkey |
|---|---|---|
| 최신 GA (2026-08-05) | **8.10.0** (2026-07-29) | **9.1.1** (2026-07-21) |
| 홀수 마이너 | **프리릴리스 전용 번호** (8.9.240 = 8.10-RC1) | **정식 GA** (8.1, 9.1) |
| 9.x | **존재하지 않는다** | 9.0.0 (2025-10-21) · 9.1.0 (2026-05-19) · 9.2 는 GA 목표 2026-11-15 |
| 지원 용어 | Standard(다음 마이너 후 6개월) / Extended(5년). **LTS 없음** | maintenance 3년 + **각 major 의 "최신 minor" 에만** security 5년. **LTS 없음** |
| 모듈 | 8.0 부터 Search/JSON/TimeSeries/Bloom 을 **빌드 시 clone → `.so` → `loadmodule`** 로 번들. in-tree 는 `modules/vector-sets/` 하나 | 코어에 없음. 별도 리포 4개(`valkey-search`/`valkey-json`/`valkey-bloom`/`valkey-ldap`) — **TimeSeries·Cuckoo·CMS·Top-K·t-digest 에 해당하는 공식 릴리스는 없다**(valkey-io org 전수 + `valkey-bloom` 커맨드 목록 + valkey-rfc 실측) `✓` |
| hash field TTL | **7.4.0** (2024-07-29) | 9.0.0 (2025-10-21) — 약 15개월 뒤, 동작도 다르다 |
| atomic slot migration | 8.4.0, `CLUSTER MIGRATION IMPORT` — **destination 에서 pull** | 9.0.0, `CLUSTER MIGRATESLOTS` — **source 에서 push**. **자동화 스크립트가 서로 호환되지 않는다** |
| `io-threads` 가변성 | **8.10.0 까지 `IMMUTABLE_CONFIG`**, 상한 128 | 8.0/8.1 IMMUTABLE → **9.0.0 부터 MODIFIABLE**, 상한 256 |
| RDB 호환 | 7.4+ 는 12 이상 | 8.x 는 11(`REDIS0011`) → **9.x 는 80 / `VALKEY080`** |

마지막 행이 실무적으로 가장 뾰족합니다. Redis 7.4 이상(RDB 12)에서 만든 RDB 는 Valkey 8.x 가 거부합니다 — Valkey 8.1 이 12~79 를 foreign 으로 예약했고 `DUMP`/`RESTORE`·`MIGRATE` 도 같은 판정을 받습니다 `✓`. "Redis 8.x 를 쓰다가 Valkey 로 옮기겠다" 는 RDB 로는 불가능합니다. 마이그레이션 경로와 Valkey 쪽 신기능은 [05]({{< relref "05-valkey-8-to-9/index.md" >}}), 두 진영의 atomic slot migration 비교는 [06]({{< relref "06-cluster-mode/index.md" >}}) 이 소유합니다.

AWS 를 쓰는 경우 한 줄이 더 붙습니다 — ElastiCache 의 Redis OSS 는 7.1 에서 멈췄고 그 위는 전부 Valkey 입니다. ElastiCache 에 Redis 8 은 없습니다 `✓`. 이 문서의 8.x 서술은 self-host 또는 다른 배포 경로를 전제합니다. 상세는 [07]({{< relref "07-aws-endpoints/index.md" >}}).

## 9. 근거

로컬 blobless 클론 `~/evejuni/redis` 에서 `git show <tag>:<path>` 로 실측한 것과 각 태그의 `00-RELEASENOTES` 원문이 1차 근거입니다. 릴리스일은 GitHub `published_at`(= 태그의 creatordate)이며 `git log -1 <tag>` 의 author date 는 인용하지 않았습니다.

- 9.x 부재 — `git tag -l '9*'`(빈 결과) · `gh api repos/redis/redis/branches --paginate` · `gh api repos/redis/redis/contents/src/version.h`(= `8.9.241`, 2026-08-05 확인) · `gh api 'search/issues?q=repo:redis/redis+9.0+in:title'` · `gh api repos/redis/redis/milestones`
- 케이던스·프리릴리스 번호 — `git show <tag>:src/version.h`(§7.1 표 전량) · `git tag -l '8.*'` · `gh api repos/redis/redis/releases` · 릴리스노트의 milestone/RC 정의 문장 · `redis.io/docs/latest/operate/oss_and_stack/install/version-mgmt/`
- 모듈 번들 구조 — `git ls-tree 8.0.0 modules/` · `git ls-tree 8.0.0 modules/redisearch/`(Makefile 단 하나) · `redis 8.0.0:modules/redisearch/Makefile` · `redis 8.0.0:modules/common.mk:34`(clone 규칙) · `redis 8.0.0:redis-full.conf:3-6`(loadmodule 4행) · `git ls-tree 8.10.0 modules/` · `redis 8.10.0:modules/modules.yaml:60-61`(vector-sets in-tree 주석) · `redis 8.10.0:modules/MODULES.md`
- RDB_VERSION 이력 — `redis <tag>:src/rdb.h` 전 태그. 최신 확인값 `redis 8.10.0:src/rdb.h:21` = `#define RDB_VERSION 15`
- `io-threads` 불변성 — `redis 8.10.0:src/config.c:3396` = `createIntConfig("io-threads", NULL, DEBUG_CONFIG | IMMUTABLE_CONFIG, 1, 128, …)`
- `Array` 커맨드 수 — `git ls-tree 8.10.0 src/commands/ --name-only | grep -E '/ar[a-z]*\.json'` → 18개. `redis 8.10.0:src/commands/arget.json` 의 `"since": "8.8.0"`, `"acl_categories": ["ARRAY"]`
- listpack 전환 시점 — `redis 7.0.0:redis.conf` vs `redis 7.2.0:redis.conf`(`set-max-listpack-entries` 가 7.2.0 에서 처음 등장)
- BSD 라인 — `redis 7.2.0:COPYING` · `redis 7.2.4:COPYING` · `redis 7.2.15:COPYING` · `redis 6.2.23:COPYING`(모두 BSD-3, `LICENSE.txt` 없음) vs `redis 7.4.0:LICENSE.txt`
- 7.4 에 `modules/` 없음 — `git ls-tree --name-only 7.4.0`
- `Flex`/tiering 부재 — 7.x·8.x 릴리스노트 전체 `flex|tiering|auto-tier|flash` grep 0건 · `redis 8.10.0:redis.conf` 동일 grep 0건
- 버전별 신기능·breaking·CVE — 각 태그의 `00-RELEASENOTES`(7.0.0 / 7.2.0 / 7.4.0 / 8.0.0 / 8.2.0 / 8.4.0 / 8.6.0 / 8.8.0 / 8.10.0) 원문
- Functions 설계 의도 — `redis.io/docs/latest/develop/programmability/functions-intro/`(EVAL 의 전제 문장, 함수의 durability 문장, cluster 전파 안내)
- RESP3 기본값 — `redis.io/docs/latest/develop/reference/protocol-spec/`("By default, the connection starts in RESP2 mode")
- 성능 주장의 조건 — `redis.io/blog/redis-8-ga/`(149 테스트·90 커맨드·5.4~87.4%·중앙값 16.7%, io-threads=8 조건, 복제·RQE 벤치 조건) · `redis.io/blog/redis-88-performance-improvements-faster-mget-mset-streams-and-more/`(기준선 8.6, m7i.metal-24xl / m8g, `redis/redis-benchmarks-specification`)
- 지원 정책·EOL — `redis.io/docs/latest/operate/oss_and_stack/install/version-mgmt/` · `github.com/redis/redis/discussions/13464`(메인테이너 발언) · `gh api repos/redis/redis/releases`(2026-07-23 일괄 패치 웨이브)
- Redis Software 와의 번호 축 구분 — `redis.io/docs/latest/operate/rs/installing-upgrading/product-lifecycle/`
- Valkey 대조값 — Valkey 릴리스일·`config.c` 실측·모듈 커버리지는 [05]({{< relref "05-valkey-8-to-9/index.md" >}}) 가 소유하며 이 문서는 대조표에 필요한 최소값만 인용했습니다

미확인으로 남긴 것: Vector Set 의 GA 시점(릴리스노트에 선언이 없습니다) · `-int` 태그와 `255.255.255` 센티넬의 공식 정의 · 8.10 의 릴리스 타입과 EOL(version-mgmt 문서 미등재) · "7.6 을 건너뛰었다" 는 인과(공식 문장 없음, 2차 출처의 해석) · Compact hashes 의 실측 메모리 절감률(릴리스노트가 수치를 제시하지 않습니다) · replication stream 압축의 CPU 비용과 기본 활성 여부.
