---
title: "무엇을 고를 것인가"
date: 2026-08-06
lastmod: 2026-08-24
weight: 8
---

# 08 · 무엇을 고를 것인가 — Redis · Valkey · memcached 판단표

{{< callout type="info" >}}
- 신규 채택은 Valkey 9.1.x 가 기본값입니다. BSD-3 이고 거버넌스가 라이선스 재변경을 2/3 super-majority + 조직 1/3 상한으로 묶어 두었고 ElastiCache 에서 7.1 위로 갈 수 있는 유일한 엔진입니다 `Σ` — 단 검색·벡터·JSON·시계열을 배포 하나로 끝내야 하면 이 선택은 성립하지 않습니다(§3.5).
- 이미 Redis 를 쓰고 있으면 대부분 그대로 두는 쪽이 맞습니다. 사내 캐시 용도는 RSALv2·SSPLv1·AGPLv3 어느 쪽에서도 금지되지 않고([03]({{< relref "03-license-and-fork.md" >}})), 7.4 이상에서 Valkey 로 넘어가는 파일·복제 경로는 전부 막혀 있습니다([05]({{< relref "05-valkey-8-to-9/index.md" >}})) — 이주 비용이 라이선스 리스크보다 큽니다 `Σ`. 움직여야 하는 조직은 재배포·외부 제공이 로드맵에 있는 곳뿐입니다 `✓`.
- 값이 blob 이고 잃어도 되는 순수 캐시는 memcached 1.6.45 가 여전히 이깁니다. 프로세스 하나가 코어를 다 먹고 느린 커맨드라는 개념이 없고 프로토콜에 stampede 방어가 들어 있습니다([02]({{< relref "02-memcached/index.md" >}})) `✓`. 지는 지점은 성능이 아니라 관리형 경로와 버스 팩터입니다 `Σ`.
- 판정 기준은 성능이 아닙니다. 세 진영의 성능 수치는 전부 발행 주체가 당사자이고 같은 하드웨어 1:1 측정이 없습니다([02]({{< relref "02-memcached/index.md" >}})·[04]({{< relref "04-redis-7-to-8.md" >}})·[05]({{< relref "05-valkey-8-to-9/index.md" >}})) `✓`. 실제로 결정하는 축은 라이선스·번들 모듈·RDB 버전·관리형 지원 버전 네 개입니다 `Σ`.
- 되돌릴 수 있는지가 대부분의 결정을 대신 내려 줍니다. Redis 8.6 부터 RDB 가 매 릴리스 오르고 Valkey 9.0 은 RDB 를 80 으로 올려 영구히 분리했고 ElastiCache 의 CMD → CME 는 단방향입니다 — 이 셋은 전부 편도 티켓입니다 `✓`.
- "9 를 기다린다" 는 전략이 없습니다. Redis 에 9.x 는 존재하지 않고 계획 문서도 확인되지 않았습니다([04]({{< relref "04-redis-7-to-8.md" >}})) `✓`. 9.x 를 가진 쪽은 Valkey 입니다.
{{< /callout >}}

> **왜 이 문서인가.** 앞 7개 문서는 각각 "무엇이 사실인가" 를 소유합니다. 이 문서는 새 사실을 도입하지 않고 그 사실들을 결정으로 압축합니다. 모든 행에 근거 문서로 가는 링크가 붙고 근거 없는 취향 서술은 넣지 않았습니다 — 근거가 부족한 자리는 §7 에 미확인으로 남겼습니다.

> **배지 규약.** `✓` = 앞 문서가 1차 근거(소스·릴리스노트·공식 문서 원문)로 확정한 사실에서 곧바로 나오는 판단. `≈` = 2차 근거이거나 조건이 붙어야 성립하는 판단. `Σ` = 여러 사실을 엮은 종합 판단 — 사실이 아니라 추론이므로 전제가 깨지면 결론도 깨집니다. 기준일 **2026-08-06**, 기준 버전은 **Redis Open Source 8.10.0**(2026-07-29) · **Valkey 9.1.1**(2026-07-21) · **memcached 1.6.45**(2026-07-09) 입니다.

## 1. 한눈에 — 세 줄 결론

| 상황 | 결론 | 확신 |
|---|---|---|
| **신규 채택** | **Valkey 9.1.x.** 라이선스가 BSD-3 이고 그것을 되돌릴 수 있는 주체가 단일 회사가 아니며([03]({{< relref "03-license-and-fork.md" >}})), 관리형에서 최신 엔진이 여기뿐이다([07]({{< relref "07-aws-endpoints/index.md" >}})). 예외는 **번들 모듈(Search/JSON/TimeSeries/확률형)이 요구사항일 때** — 그때는 Redis 8.x 다 | `Σ` |
| **기존 Redis** | **버전 라인부터 확인하고, 대부분 그대로 둔다.** 7.2 이하면 라이선스 경계에 걸리지도 않고 Valkey 로 넘어갈 수도 있다. **7.4 이상이면 이주 경로가 논리적 재적재뿐이므로**, 라이선스가 실제로 걸리지 않는 한 움직이는 것이 손해다 | `Σ` |
| **순수 캐시** | **memcached 1.6.45**(자체 운영 가능할 때). 자료구조·영속성·다중 키 원자성이 요구사항에 하나도 없고, 관리형에 얹어야 한다면 **ElastiCache 의 최신 확인 버전이 1.6.22(2024-01-11)** 라는 사실이 판정을 뒤집는다 — 그 경우 Valkey 를 캐시로 쓰는 편이 낫다 | `Σ` |

세 줄은 서로 다른 축을 봅니다. 신규 채택은 **거버넌스**가, 기존 Redis 는 **RDB 버전**이, 순수 캐시는 **관리형 지원 버전**이 결정합니다 `Σ`.

## 2. 3자 판단표

각 칸은 앞 문서가 확정한 사실이고 판정 열이 이 문서의 기여입니다.

| 기준 | Redis 8.x (8.10.0) | Valkey 9.x (9.1.1) | memcached 1.6 (1.6.45) | 판정 |
|---|---|---|---|---|
| **라이선스·거버넌스** | RSALv2 / SSPLv1 / AGPLv3 **트라이 — 사용자 선택**. AGPL 은 2025-05 에 **추가**된 것이고 앞의 둘은 철회되지 않았다. **CLA** 로 권리를 회사가 모으므로 옵션을 다시 뺄 수 있는 구조가 그대로다 ([03]({{< relref "03-license-and-fork.md" >}})) | **BSD-3.** LF 산하 TSC, **DCO**, 단일 조직 **1/3 상한**, 거버넌스 문서 수정에 **2/3 super-majority**. 재라이선스가 회사 결정 하나로 불가능하다 ([03]({{< relref "03-license-and-fork.md" >}})) | **BSD-3, 2003-06-15 이후 23년 무변경.** 라이선스 유발 포크가 없었다. 대신 2026년 커밋의 79%가 한 사람이고 **날짜 박힌 EOL 캘린더가 없다** ([02]({{< relref "02-memcached/index.md" >}})) | **Valkey.** 사내 캐시만 쓴다면 셋 다 걸리지 않는다 — 갈리는 것은 현재 문자열이 아니라 **그것을 바꿀 수 있는 주체**다. 컴플라이언스가 "지원 종료일 문서" 를 요구하면 memcached 가 탈락한다 `Σ` |
| **기능 표면 (JSON/Search/Vector)** | 8.0 부터 **배포에 번들** — Search·JSON·TimeSeries·Bloom + in-tree Vector Set. 단 "core 통합" 은 빌드 시 `git clone` → `.so` → `loadmodule` 이고, 소스 빌드는 코어만 나오며 `redis-full.conf` 를 써야 올라온다. **Vector Set 은 8.0 에서 beta 로 나온 뒤 GA 선언 문장이 없다** ([04]({{< relref "04-redis-7-to-8.md" >}})) | **코어에 없다.** 별도 모듈 4개 — `valkey-search` 1.2.1(2026-07-07) · `valkey-json` 1.0.2(**2025-09-08**) · `valkey-bloom` 1.0.1 · `valkey-ldap`. **TimeSeries·Cuckoo·Count-min·Top-K·t-digest 에 해당하는 공식 릴리스가 없다** ([05]({{< relref "05-valkey-8-to-9/index.md" >}})) | **없다.** 값이 불투명 blob 하나이고 서버가 값을 해석하지 않는다. 리더보드·집계·검색은 값 전체를 읽어 앱에서 고쳐 다시 쓰는 CAS 재시도 루프가 최선이다 ([02]({{< relref "02-memcached/index.md" >}})) | **Redis 8.x** — 이 축에서 유일하게 "배포 하나" 로 끝난다. Valkey 는 모듈 케이던스가 코어와 분리돼 있고 `valkey-json` 이 1년 가까이 멈춰 있다는 점이 실질 리스크다 `Σ` |
| **원자성·프로그래머빌리티** | MULTI/EXEC/WATCH · Lua `EVAL` · Functions(7.0+, RDB/AOF·복제를 타는 1급 아티팩트) ([04]({{< relref "04-redis-7-to-8.md" >}})) | 동일. 9.1 에서 **Lua 를 모듈로 분리**(`BUILD_LUA=no` 로 Lua 없는 서버 가능), 공개 API 는 호환 ([05]({{< relref "05-valkey-8-to-9/index.md" >}})) | **아이템 1개.** CAS·incr/decr·add/replace·meta 플래그가 전부이고 다중 키 트랜잭션·스크립팅이 **원리적으로 없다**. 반대로 프로토콜에 **stampede 방어(`W`/`Z`)와 serve-stale** 이 내장돼 있다 ([02]({{< relref "02-memcached/index.md" >}})) | **요구사항이 갈라놓는다.** 다중 키 원자성이 한 줄이라도 필요하면 memcached 는 후보가 아니다. 반대로 캐시 정합성(stampede·serve-stale)만 필요하면 memcached 가 서버측 원자성을 주는 유일한 선택이다 `✓` |
| **성능·메모리** | 8.0 의 "87% 빠르다" `Ⓥ` 는 7.2.5 대비 149개 테스트에서 p50 감소폭 5.4\~87.4% **분포의 최댓값**이고 중앙값은 16.7%. "2배 처리량" `Ⓥ` 은 `io-threads=8` + multi-core Intel 조건이며 **기본값은 `io-threads 1`, 8.10.0 까지 `IMMUTABLE_CONFIG`**. 8.2 가 Valkey packing 을 채택(`kvobj`), 8.10 이 compact hashes ([04]({{< relref "04-redis-7-to-8.md" >}})) | 8.1 의 캐시라인 버킷 `hashtable` 로 **재시작만으로 키당 20\~30B 회수**. 9.0 부터 `io-threads` **MODIFIABLE**(상한은 8.1 에서 이미 256). 9.1 의 I/O 통신 재설계가 +8\~17% `Ⓥ`(PR 벤치 조건 — 8 IO threads · 400 clients · 512B payload · 3M keys). 단 AVX 의존 항목은 ARM 에서 안 나온다 ([05]({{< relref "05-valkey-8-to-9/index.md" >}})) | 워커 N개가 각자 이벤트 루프를 돌려 **한 프로세스가 N 코어**. 느린 커맨드가 존재할 수 없어 지연이 예측 가능. 아이템 헤더 48B(CAS 56B) + 청크 슬랙 — 작은 값에서는 오버헤드 60% ([02]({{< relref "02-memcached/index.md" >}})) | **비교 불가로 판정한다.** 세 수치가 전부 당사자 발행이고 **같은 하드웨어 1:1 측정이 존재하지 않는다** `✓`. 굳이 고르면 (a) 코어를 수직으로 먹어야 하면 memcached, (b) 메모리 효율은 Valkey 8.1 이후, (c) 어느 쪽이든 **`io-threads` 를 켜지 않으면 8.x/9.x 의 성능 서술은 우리 것이 아니다** `Σ` |
| **cluster 운영** | atomic slot migration = `CLUSTER MIGRATION IMPORT`(8.4, **destination pull**). 8.10 부터 `redis-cli --cluster reshard` 가 서버측 ASM 을 쓴다 — **같은 CLI 가 8.8 이하와 다르게 동작한다**. cluster 는 **DB 0 뿐**(`cluster-databases` 없음). `CLUSTER SLOTS` 는 8.10.0 도 deprecated ([06]({{< relref "06-cluster-mode/index.md" >}})) | ASM = `CLUSTER MIGRATESLOTS`(9.0, **source push**). 9.1 이 실제로 더한 것은 `remaining_repl_size` 필드와 valkey-cli 지원뿐이고 **dual-channel ASM·`MIGRATESLOTS` AUTH 는 2026-08-06 기준 미출시(9.2 계획)** 다. **`cluster-databases` 로 cluster 에서 `SELECT` 가능**(IMMUTABLE). `CLUSTERSCAN` 으로 서버측 전역 스캔. `CLUSTER SLOTS` 는 8.0 에서 **un-deprecate**. 대신 **모듈을 하나라도 로드하면 ASM 이 거부된다** — 공식 4개 모듈 전부 미선언 ([06]({{< relref "06-cluster-mode/index.md" >}})) | **없다.** 복제도 클러스터 버스도 없고 서버는 자기가 클러스터의 일부인지 모른다. 샤딩은 클라이언트 consistent hashing, 또는 1.6.13+ 내장 proxy(라우팅이지 복제가 아니고 `configure.ac` 는 1.6.45 에서도 **EXPERIMENTAL**) ([02]({{< relref "02-memcached/index.md" >}})) | **리샤딩 자동화가 두 진영 호환되지 않는다** — 엔진을 갈아타면 런북을 다시 쓴다 `✓`. multi-DB cluster 가 필요하면 Valkey 뿐이고 **Redis 로 되돌릴 수 없는 편도 티켓**이다 `✓`. 번들 모듈 + ASM 을 동시에 원하면 **Valkey 에서는 불가능하다** `✓` |
| **관리형 지원** | **ElastiCache 에 Redis 8.x 는 없다** — Redis OSS 는 7.1 에서 멈췄다. MemoryDB 문서의 엔진 목록도 7.3 까지 ([07]({{< relref "07-aws-endpoints/index.md" >}})) | ElastiCache Valkey **9.1 / 9.0 / 8.2 / 8.1 / 8.0 / 7.2.6**. 단 **AWS 버전 번호는 업스트림과 1:1 이 아니다**(ElastiCache 8.2 ≈ Valkey 8.1). 9.1 은 발표문 기준 node-based 만 ([07]({{< relref "07-aws-endpoints/index.md" >}})) | ElastiCache for Memcached 의 웹 확인 최신은 **1.6.22(2024-01-11)** — 오픈소스 최신과 23개 마이너 차이. **GCP Memorystore for Memcached 는 deprecated**(2027-02-01 신규 불가 / 2029-01-31 종료) ([02]({{< relref "02-memcached/index.md" >}})) | **관리형을 전제하면 사실상 Valkey 단일 선택이다** `✓`. Redis 8.x 를 원하면 self-host 또는 다른 배포 경로를 전제해야 하고, memcached 는 관리형에서 **1.6.34 의 mover 재작성·1.6.4x 보안 수정을 받지 못한다** `✓` |
| **클라이언트 생태계** | 공식 6개(Jedis · node-redis · redis-py · NRedisStack · go-redis · Lettuce) ([06]({{< relref "06-cluster-mode/index.md" >}})) | **valkey-glide** 를 공식 다국어 클라이언트로 밀고(Rust 코어 + 바인딩), valkey-py/iovalkey/valkey-java/valkey-go/valkey-swift 를 recommended 로 분류. **RESP 는 그대로여서 기존 Redis 클라이언트가 대체로 붙는다** — Harbor 가 교체 후 "no application-level RESP changes were required" 를 보고했다 ([03]({{< relref "03-license-and-fork.md" >}})·[06]({{< relref "06-cluster-mode/index.md" >}})) | 텍스트 / binary(**1.6.0 에서 deprecated**) / **meta**. 문제는 meta 다 — **meta 를 지원하는 클라이언트가 제한적이라 최신 강점을 쓰려면 선택지가 좁아진다** ([02]({{< relref "02-memcached/index.md" >}})) | **Redis ≈ Valkey.** RESP 레벨 호환 덕에 이 축은 판정에 거의 기여하지 않는다 `≈`. 단 **7.4 이후 어느 한쪽의 신규 커맨드에 의존하면 그 순간부터 락인이 시작된다** `✓`. memcached 는 이 축에서 실점한다 — stampede 방어가 있어도 클라이언트가 meta 를 못 쓰면 없는 기능이다 `Σ` |
| **마이그레이션 비용** | 7.4+ 의 RDB 12 는 **Valkey 가 거부한다.** 8.6·8.8·8.10 은 RDB 13·14·15 로 매 릴리스 올라 **롤백이 사실상 불가능**하다 ([04]({{< relref "04-redis-7-to-8.md" >}})) | Redis **≤7.2 에서만** RDB·복제로 넘어올 수 있다. 9.0 이 RDB 를 **80 / `VALKEY080`** 로 갈랐고 12~79 를 foreign 으로 **예약해 거부**한다 ([05]({{< relref "05-valkey-8-to-9/index.md" >}})) | 영속성이 없으므로 **이주 비용이 0 에 가깝다** — extstore·restartable cache 둘 다 영속성이 아니다. 대신 전환 순간 cold cache 와 thundering herd 를 감당해야 한다 ([02]({{< relref "02-memcached/index.md" >}})) | **RDB 버전 숫자 하나가 대부분의 선택지를 미리 지운다** `✓`. 캐시로만 쓰는 워크로드는 이 축이 무의미해지고(§6), 그래서 **"캐시인가 데이터스토어인가" 가 이 표 전체에서 가장 강한 분기점**이다 `Σ` |

## 3. 케이스별 판단

### 3.1 신규로 캐시만 필요하다

- 조건 — 값이 blob 이고 잃어도 되고 다중 키 원자성이 필요 없고 TTL·CAS·incr 이면 표현이 끝납니다.
- 선택 — 자체 운영이면 memcached 1.6.45, 관리형으로 가야 하면 ElastiCache Valkey(캐시 용도로) `Σ`.
- 왜 — memcached 는 이 조건에서 Redis 계열에 없는 것을 줍니다 — 프로세스 하나로 코어를 먹는 확장, 느린 커맨드가 존재할 수 없는 지연 예측성, 프로토콜 내장 stampede 방어([02]({{< relref "02-memcached/index.md" >}})) `✓`. 그런데 관리형으로 가면 그 강점이 사라집니다 — ElastiCache 의 확인 최신이 1.6.22 이므로 1.6.34 의 slab mover 재작성(재배치 시 아이템 손실 제거)과 1.6.4x 보안 수정을 못 받습니다 `✓`. 아이템 크기 분포가 시간에 따라 변하는 캐시에서 calcification 리스크를 지고 갈 이유가 없습니다 `Σ`.
- 되돌릴 수 있나 — 거의 공짜로 되돌릴 수 있습니다. 영속성이 없어 이주 대신 재구축이 되고 대가는 cold cache 창의 thundering herd 하나입니다 `✓`. 이 케이스는 이 문서에서 리스크가 가장 낮은 결정이라 오래 고민할 가치가 없습니다 `Σ`.

### 3.2 신규로 자료구조·영속성이 필요하다

- 조건 — sorted set·stream·hash 필드 TTL 같은 서버측 자료구조 연산이 필요하고 RDB/AOF 로 복구할 수 있어야 합니다.
- 선택 — Valkey 9.1.x `Σ`.
- 왜 — 세 축이 같은 방향을 가리킵니다. (a) 라이선스가 BSD-3 이고 재변경 장벽이 조문으로 있습니다([03]({{< relref "03-license-and-fork.md" >}})) `✓`. (b) 8.1 의 새 hashtable 이 키당 20~30B 를 설정 변경 없이 회수하고 9.0 부터 `io-threads` 를 런타임에 켤 수 있습니다([05]({{< relref "05-valkey-8-to-9/index.md" >}})) `✓`. (c) ElastiCache 에서 7.1 위로 갈 수 있는 유일한 엔진이라 self-host → 관리형 경로가 열려 있습니다([07]({{< relref "07-aws-endpoints/index.md" >}})) `✓`.
- 되돌릴 수 있나 — Valkey 9.x 를 고르는 순간 파일 레벨 복귀는 끝납니다. RDB 80 은 Valkey 8.x 도 거부하고 12~79 예약 때문에 Redis 쪽으로 돌아가는 경로도 없습니다 `✓`. 롤백 계획은 "RDB 되돌리기" 대신 "전환 직전 스냅샷 보관 + 논리적 재적재" 로 세워야 합니다 `Σ`. 이 제약을 감당할 수 없다면 8.1.x 에 머무는 선택도 있습니다(RDB 11 이라 Redis 와 파일 호환) — 대가로 HFE·cluster multi-DB·DB 단위 ACL 을 포기합니다 `✓`.

### 3.3 이미 Redis 7.2 이하를 쓰고 있다

먼저 라이선스 경계에 걸리는지부터 판정합니다. 걸리지 않으면 이 절의 나머지는 읽을 필요가 없습니다 `Σ`.

| 우리 상황 | 걸리나 | 근거 |
|---|---|---|
| 사내 애플리케이션의 캐시·세션·큐 (계열사 포함) | **걸리지 않는다** | FAQ #20 "Hosting the products for the internal use of your organization is permitted. An organization includes its affiliates and subsidiaries." `✓` |
| 7.2.x 유지보수 라인을 계속 받는다 | **걸리지 않는다** | 7.2.15(2026-07-23)까지 루트에 `COPYING`(BSD-3)만 있다 `✓` |
| 제품에 엔진을 임베드해 고객에게 배포 | **걸린다** | RSALv2 가 "distribute … in a manner that makes the functionality available to third parties" 를 금지 `✓` |
| 캐시/데이터스토어 기능을 외부 고객에게 상품으로 노출 | **걸린다** | RSALv2 금지 / SSPLv1 은 Service Source Code 전량 공개 조건 `✓` |
| 그룹사·계열사에 유상으로 공용 캐시를 제공 | **원문으로 판정 불가** | affiliates 는 organization 에 포함되지만 별개 법인 유상 제공이 "third parties" 인지 원문에 없다 `?` |
| 사내 정책이 AGPL 을 금지한다 | **8.x 로 올릴 때만 걸린다** | AGPLv3 옵션을 못 고르므로 8.x 는 RSALv2/SSPLv1 로만 쓸 수 있고 위 두 제약이 살아난다. 7.2 라인은 `COPYING`(BSD-3) 단독이라 이 정책과 무관하다 `✓` |

- 선택 A — 위 표에서 하나도 걸리지 않습니다 → 7.2 라인에 머무르거나 Redis 8.2 로 올립니다 `Σ`. 7.2 는 Extended 로 EOL 2029-12-01 이고 6.2 도 2027-04-01 까지 살아 있습니다([04]({{< relref "04-redis-7-to-8.md" >}})) `✓`. 7.2 는 2023-08-15 이후 기능이 동결돼 있고 보안 유지의 실질 상류가 어디인지도 봐야 합니다 — Debian 의 redis 패키지는 CVE-2026-21863 패치를 Valkey 커밋에서 복사해 붙였는데 반환값 의미가 반대여서 새 DoS 가 생겼습니다. 이 계보에서 보안 패치가 실제로 어떻게 흐르는지가 이 사례(#1136392)에 그대로 드러납니다([03]({{< relref "03-license-and-fork.md" >}})) `✓`.
- 선택 B — 걸립니다 → Valkey 로 갑니다. 그리고 지금이 그 이주가 싼 마지막 구간입니다 `Σ`. 7.2 이하는 양쪽 RDB 11 이라 복제로 컷오버합니다 — Redis 의 host/port 를 확인해 Valkey 에서 `REPLICAOF` → `INFO REPLICATION` 동기 확인 → 애플리케이션 전환 → `REPLICAOF NO ONE` 승격, 사실상 무중단입니다([05]({{< relref "05-valkey-8-to-9/index.md" >}})) `✓`. Redis 를 7.4 로 한 번 올리면 이 경로가 영구히 닫힙니다 `✓`.
- 되돌릴 수 있나 — 선택 B 는 되돌릴 수 있습니다, 단 Valkey 8.x 에 머무는 동안만입니다. 8.x 는 RDB 11 이라 Redis 가 읽습니다 `✓`. 9.x 로 올리면 그 창이 닫힙니다(§3.2) `✓`.

### 3.4 이미 Redis 8.x 를 쓰고 있다

- 조건 — 7.4 이상, 즉 RDB 12 이상.
- 선택 — Redis 에 머뭅니다. 그리고 버전을 정리합니다 `Σ`.
- 왜 — 이주 경로가 사실상 없습니다. RDB·복제·`DUMP`/`RESTORE` 세 경로가 모두 막혀 있고([05]({{< relref "05-valkey-8-to-9/index.md" >}})) 남는 것은 애플리케이션 이중 쓰기 또는 논리적 재적재 + `import-mode yes` + `CLIENT IMPORT-SOURCE ON` 뿐입니다 `✓`. 이 비용을 지불할 이유는 §3.3 표의 라이선스 경계에 실제로 걸릴 때뿐이고 사내 캐시 용도라면 걸리지 않습니다 `Σ`.
- 정리해야 하는 것 — (a) 8.0 은 2026-12-01 에 지원이 끝납니다 `✓`. (b) 5년 지평이 필요하면 8.x 안에서 Extended 는 8.2 하나(EOL 2030-09-01)입니다 `✓`. (c) ACL 을 다중 테넌시 경계로 쓰고 있다면 8.6 의 `MSETEX` key-pattern 우회와 8.10 의 `SORT`/`GEORADIUS`/`XREAD` 계열 우회(#15478)를 받았는지 확인해야 합니다 — [04]({{< relref "04-redis-7-to-8.md" >}})는 이 근거로 "8.10 이 사실상 최소 버전" 이라고 판정합니다 `✓`. 8.2 유지보수 라인에 #15478 이 백포트됐는지는 앞 문서들에 근거가 없습니다 `?` — "5년 지원(8.2)" 과 "ACL 경계(8.10)" 가 충돌하면 백포트를 확인하기 전에 8.2 를 고르지 마십시오 `Σ`.
- 되돌릴 수 있나 — 8.6 이후로는 없습니다. RDB 가 13·14·15 로 매 릴리스 오르므로 다운그레이드는 replication 대신 논리적 재적재로 계획해야 하고 그 `RESTORE` 경로 자체가 8.8 CVE 목록이 지목한 공격면입니다 `Σ`.

### 3.5 벡터 검색·JSON·전문검색이 필요하다

- 조건 — Search/Vector/JSON/TimeSeries/확률형 자료구조 중 하나 이상이 애플리케이션 요구사항입니다.
- 선택 — Redis 8.x. 단 세 개의 조건을 받아들일 때만입니다 `Σ`.
- 왜 — 이 축에서만 Valkey 가 명확히 집니다. Valkey 코어에 검색·JSON·시계열·확률형이 없고 공식 모듈 4개에 TimeSeries·Cuckoo·Count-min·Top-K·t-digest 대응물이 아예 없으며 `valkey-json` 최신이 2025-09-08 로 1년 가까이 멈춰 있습니다([05]({{< relref "05-valkey-8-to-9/index.md" >}})) `✓`.
- 받아들여야 하는 조건 — (1) "core 통합" 은 번들입니다. 소스에서 `make` 만 하면 코어뿐이고 모듈을 원하면 8.0 계열은 빌드 중 네트워크와 Rust 1.80.1 을 요구합니다(에어갭은 8.10 의 tarball 경로) `✓`. 설정은 `redis.conf` 가 아니라 `redis-full.conf` 를 가리켜야 하고 그 파일은 `make modules-update` 마다 재생성됩니다 — 직접 넣은 설정이 사라집니다([04]({{< relref "04-redis-7-to-8.md" >}})가 빌드 구조를 소유합니다) `✓`. (2) Vector Set 은 8.0 에서 beta 로 나온 뒤 GA 선언 문장이 없습니다 — 8.6~8.8 에 SIMD 최적화와 크래시 수정이 집중됐고 문서에서 beta 문구가 사라진 것까지가 확인 가능한 성숙도입니다 `✓`. big-endian 에서 8.2 이전에 벡터셋을 썼다면 그 RDB 는 신뢰할 수 없습니다 `✓`. (3) 관리형이 아닙니다 — ElastiCache 에 Redis 8.x 가 없으므로 self-host 를 전제합니다([07]({{< relref "07-aws-endpoints/index.md" >}})) `✓`.
- Valkey 로 이 요구를 받으려면 — `valkey-search` 를 추가하는 선택은 있지만 모듈을 하나라도 로드하면 `CLUSTER MIGRATESLOTS` 가 거부됩니다 — 공식 4개 모듈 전부가 ASM opt-in 플래그를 선언하지 않고 `valkey-bundle` 이미지는 4개를 다 로드합니다([06]({{< relref "06-cluster-mode/index.md" >}})) `✓`. Valkey + 모듈 + atomic slot migration 은 함께 성립하지 않으므로, 리샤딩을 일상 작업으로 쓸 계획이면 이 조합을 배제해야 합니다 `Σ`.
- 되돌릴 수 있나 — 모듈 데이터는 RDB 롤백 논의 밖에 있습니다. 7.4~8.4 구간은 RDB 12 로 같아 코어 데이터의 롤백 여지가 있었지만 그것도 "모듈 데이터 제외" 조건이 붙습니다 `✓`. 검색 인덱스·벡터를 재구축하는 시간을 롤백 계획의 실제 소요로 잡아야 합니다 `Σ`.

### 3.6 AWS 관리형에 얹혀 있다

- 조건 — ElastiCache 또는 MemoryDB 를 쓰고 있고 엔진 선택을 다시 검토합니다.
- 선택 — ElastiCache Valkey. 사실상 선택지가 없습니다 `✓`.
- 왜 — Redis OSS 는 7.1 에서 멈췄고 그 위는 전부 Valkey 입니다. ElastiCache 에 Redis 8 은 없습니다([07]({{< relref "07-aws-endpoints/index.md" >}})) `✓`. 엔진 전환의 리스크는 모드 전환과 정반대로 낮습니다 — in-place 이고 *"including the endpoint DNS name, will remain unchanged"* 이며 바뀌는 것은 노드 IP 뿐입니다 `✓`. 다운타임은 Redis OSS 5.0.6 이상이면 failover 몇 초, 그 미만이면 DNS 전파 동안 30~60초입니다 `✓`.
- 섞으면 안 되는 두 작업 — 엔진 전환(Redis OSS → Valkey)과 모드 전환(CMD → CME)은 리스크 등급이 다릅니다 `Σ`. 전자는 엔드포인트가 유지되고 롤백 경로가 하나 있습니다(Valkey 7.2 → Redis OSS 7.1) `✓`. 후자는 엔드포인트 문자열 + 클라이언트 클래스 + 애플리케이션의 다중 키 연산 + 파라미터 그룹 네 층이 함께 바뀌고 AWS 문서가 *"Reverting this configuration is not possible"* 로 명시한 단방향입니다 `✓`. 두 작업을 한 변경 창에 넣으면 실패 원인을 분리할 수 없습니다 `Σ`.
- DNS TTL 을 먼저 손댑니다 — 엔진 전환에서 노드 IP 가 바뀌므로 [07]({{< relref "07-aws-endpoints/index.md" >}})의 `networkaddress.cache.ttl` 5~10초 지시가 그대로 걸립니다. 기본값이면 *"never refresh DNS entries until the JVM is restarted"* 이고 security property 라서 `-D` 로는 안 들어갑니다 `✓`. failover 자체는 몇 초이고 장애 시간을 만드는 것은 클라이언트 캐시라는 사실이 여기서 그대로 반복됩니다 `✓`.
- MemoryDB 는 판단 근거가 2026-06 에 바뀌었습니다 — AWS 자신의 권고가 *"multi-Region active-active replication with conflict-free data types (CRDTs)"* 로 좁아졌고 단일 리전 durable 워크로드는 durability 를 켠 ElastiCache 를 권합니다 `✓`. "내구성이 필요하면 MemoryDB" 는 더 이상 AWS 의 권고가 아닙니다 `✓`. 엔진 버전 격차도 실무 요소입니다(MemoryDB 문서 목록은 7.3 / Valkey 7.2.6 까지) `✓`.
- 관리형을 벗어날 이유가 있는지 — `config`·`debug`·`bgsave`·`replicaof` 가 막혀 있고 MemoryDB 는 `acl setuser`·`cluster setslot`·`module` 까지 막습니다 `✓`. 남는 유일한 설정 경로가 파라미터 그룹이므로 런타임 `CONFIG SET`·모듈·직접 슬롯 통제 셋 중 하나가 요구사항이면 self-host 가 후보가 됩니다 — 그 외에는 관리형을 벗어나는 것이 손해입니다 `Σ`.
- 되돌릴 수 있나 — 엔진 전환은 Valkey 7.2 → Redis OSS 7.1 한 경로만 있습니다(user/user group 이 `engine type REDIS` 여야 합니다) `✓`. 8.0 이상으로 올린 뒤에는 없습니다 `✓`. 모드 전환은 `compatible` 단계에서만 되돌릴 수 있고 `enabled` 를 넘으면 없습니다 `✓`.

## 4. 버전 선택 — 지금 무엇을 깔아야 하나

### 4.1 Redis 진영

| 목표 | 버전 | 왜 | 확신 |
|---|---|---|---|
| **5년 지평이 필요하다** | **8.2.x** | 8.x 중 **Extended 는 8.2 하나**, EOL **2030-09-01**. 그리고 정책 문서의 "마지막 마이너" 조항이 아직 발동하지 않았으므로 다음 Extended 는 미정이다 | `✓` |
| **ACL 을 테넌시 경계로 쓴다** | **8.10.x** | 8.6·8.8·8.10 세 릴리스 연속으로 ACL 을 건드리는 보안 수정이 나왔고, 8.10 의 #15478 이 `SORT`/`GEORADIUS`/`XREAD` 계열 우회를 막는다 | `✓` |
| **지금 8.0 을 쓰고 있다** | **즉시 이동** | **EOL 2026-12-01.** 2026-07-23 의 일괄 패치 웨이브(6.2.23/7.2.15/7.4.10/8.2.8/8.4.5/8.6.5/8.8.1)에 **8.0.x 만 없었다** — 정책이 말뿐이 아니라는 증거다 | `✓` |
| **9 를 기다린다** | **성립하지 않는다** | 태그·브랜치·마일스톤·`unstable` 의 `version.h`(= `8.9.241`) 전수 확인 결과 9.x 가 없고 계획 문서도 확인되지 않았다 | `✓` |

8.10 을 장기 지원으로 가정하면 안 됩니다 — 지원 표에 등재조차 되지 않았고 Standard/Extended 구분이 미정입니다 `✓`. 이 진영의 실제 선택은 "5년(8.2) vs 최신 보안 표면(8.10)" 이고, 둘이 충돌할 때 판정은 §3.4 의 마지막 줄에 있습니다 `Σ`.

### 4.2 Valkey 진영

| 목표 | 버전 | 왜 | 확신 |
|---|---|---|---|
| **기본 선택** | **9.1.1** | 최신 GA. DB 단위 ACL · Lua 모듈화 · I/O 통신 재설계(+8~17% `Ⓥ` — 8 IO threads · 400 clients · 512B · 3M keys 조건의 PR 벤치) · 메모리 추가 절감. 그리고 2026-07-21 보안 릴리스의 패치 버전이다 | `✓` |
| **hash field TTL 을 쓴다** | **최소 9.0.2, 실무적으로 9.1.1** | 9.0.2(urgency HIGH)의 버그 수정 17건 중 **9건이 HFE 관련**이다 — 9.0.0/9.0.1 에서 필드 TTL 을 프로덕션에 쓰는 것은 위험하다 | `✓` |
| **Redis 와 RDB 호환을 유지해야 한다** | **8.1.9** | 8.x 는 RDB 11 이라 Redis 가 읽는다. 새 hashtable(키당 -20~30B)·`COMMANDLOG`·`import-mode` 를 얻으면서 파일 호환을 지키는 유일한 지점 | `✓` |
| **`RESTORE` 를 앱에 허용했거나 TLS 를 쓴다** | **즉시 패치 라인으로** | CVE-2026-63639(CVSS 8.8, advisory 원문 "exists in **all versions**") · CVE-2026-56684(TLS UAF, CVSS 7.5, **완전한 우회책 없음**) | `✓` |

"9.1 은 2031년까지 안전하다" 를 계획의 전제로 삼지 않습니다 — security 5년은 각 major 의 "최신 minor" 에만 붙고 9.2.0 GA 목표가 2026-11-15입니다. 지위를 잃으면 규칙상 2029-05-19 로 당겨지지만 "되돌린다" 고 명시한 문장은 확인되지 않았습니다 `≈`. 지원 종료일을 계약이나 감사 근거로 써야 하면 이 불확실성을 그대로 문서에 남기는 편이 안전합니다 `Σ`.

### 4.3 memcached

| 목표 | 버전 | 왜 | 확신 |
|---|---|---|---|
| **기본 선택** | **1.6.45**(2026-07-09) | 1.6.42/43/44/45 가 전부 보안·안정화다. 특히 1.6.43 은 **`lru_crawler metadump`/`mgdump` 가 스트림 앞에 `OK\r\n` 을 붙이므로 기존 툴링이 깨진다** — 올릴 때 파서를 같이 본다 | `✓` |
| **최소 마지노선** | **1.5.0 이상** | `slab_reassign`·`slab_automove` 가 기본값으로 승격된 지점. 그 미만이면 **calcification 이 여전히 실전 리스크**다 | `✓` |
| **아이템 크기 분포가 변한다** | **1.6.34 이상** | mover 전면 재작성으로 "페이지를 옮기면 아이템을 잃는다" 가 사라졌다. 단 1.6.41 이 그 회귀(mover 정지·`slabs_mover=2` 크래시)를 고쳤으므로 **1.6.41 이상**이 실질 하한이다 | `✓` |
| **proxy 를 쓴다** | **보류 권고** | `configure.ac` 가 1.6.45 에서도 EXPERIMENTAL 로 표기해 **배포판 패키지로는 못 쓰고 직접 빌드해야** 하고, 2026년 보안·크래시 수정이 proxy 코드에 몰려 있다 | `✓` |

성숙도 판정은 한 줄입니다 — 프로젝트는 살아 있지만 기능 개발은 멈춰 있습니다. 최근 1년의 사용자 노출 신기능은 1.6.40 의 `mg` 조건부 CAS 페치 하나이고 1.6.45 는 33 커밋 전부가 한 사람입니다 `✓`. 이것을 "안정" 으로 읽을지 "정체" 로 읽을지가 이 진영 선택의 실제 쟁점입니다 `Σ`.

## 5. 마이그레이션 경로표

| 출발 | 도착 | 방법 | 다운타임 | 되돌릴 수 있나 | 함정 |
|---|---|---|---|---|---|
| Redis ≤ 7.2.x | **Valkey 8.1.x** | `REPLICAOF` 컷오버(→ `INFO REPLICATION` 확인 → 앱 전환 → `REPLICAOF NO ONE`) 또는 RDB 파일 복사 | 사실상 무중단 `✓` | **가능** — 8.x 는 RDB 11 이라 Redis 가 읽는다 `✓` | RDB 파일 복사 경로는 **첫 기동에서 AOF 를 끄지 않으면 RDB 가 import 되지 않는다**(공식 문서 명시) `✓` |
| Redis ≤ 7.2.x | **Valkey 9.1.x** | 같은 방법(9.x 도 Redis ≤7.2 를 읽는다) | 사실상 무중단 `✓` | **아니오** — RDB 80 은 8.x 도 Redis 도 못 읽는다 `✓` | 롤백 계획을 "RDB 되돌리기" 로 세우면 안 된다 → **전환 직전 스냅샷 보관** `Σ` |
| **Redis 7.4+ (RDB 12+)** | Valkey 어느 버전 | **RDB·복제·`DUMP`/`RESTORE` 세 경로 모두 차단.** 남는 것은 애플리케이션 이중 쓰기 또는 **논리적 재적재 + `import-mode yes` + `CLIENT IMPORT-SOURCE ON`** | 재적재 시간 전체 `Σ` | 원본 Redis 를 살려두면 가능 `Σ` | Valkey 8.1 이 **12~79 를 foreign 으로 예약해 거부**하고 `rdb-version-check relaxed` 로도 우회되지 않는다. **DUMP 페이로드에는 magic 이 없어 무조건 거부**된다 `✓`. 7.4+ primary 에 `REPLICAOF` 로 붙는 실패 양상은 실행으로 확인되지 않았다 `?` |
| Redis 7.2 | Redis 8.2 | in-place 업그레이드 | 재시작 `✓` | **아니오** — RDB 11 → 12 `✓` | 7.0 의 네 겹 파괴적 변경 중 **ACL pub/sub 기본 차단만 애플리케이션을 조용히 죽인다**. 나머지(RDB·AOF 디렉터리·`MODULE`/`DEBUG` protected)는 기동 시 드러난다 `✓` |
| Redis 8.4 | Redis 8.6 / 8.8 / 8.10 | in-place | 재시작 `✓` | **아니오** — RDB 13 / 14 / 15 `✓` | 명시적 breaking 섹션이 없는데 **에러 없이 결과가 달라지는** 변경이 들어 있다 — `SCAN` 필터 순서(8.2 도입 → 8.6 되돌림), 검색 기본 scorer BM25STD(8.4), 검색 타임아웃 강제(8.10) `✓` |
| Valkey 8.x | Valkey 9.x | in-place, **replica 부터** | 재시작 `✓` | **아니오** — RDB 11 → 80. relaxed 로도 mandatory opcode `RDB_OPCODE_SLOT_IMPORT`(243)·HFE 인코딩에서 중단 `✓` | 9.0 primary → 8.x replica 의 full sync 를 **신뢰할 수 없다** `✓`. HFE 를 쓸 계획이면 9.0.0/9.0.1 을 건너뛴다 `✓` |
| Valkey 9.x | Valkey 8.x / Redis | **불가** | — | — | `VALKEY080` magic + foreign 예약 구간이 양방향으로 닫혀 있다 `✓`. (9.x → Redis 를 직접 검증한 서술은 앞 문서에 없다 — 예약 규칙에서 나오는 추론이다 `Σ`) |
| memcached | Redis / Valkey | **이주가 아니라 재구축.** 프로토콜·자료 모델이 다르므로 클라이언트를 갈고 캐시를 다시 채운다 | cold cache 창 `Σ` | 되돌리는 것도 재구축 `✓` | 잃는 것이 있다 — **프로토콜 내장 stampede 방어(`W`/`Z`)와 serve-stale 의 대체물을 애플리케이션에 짜야 한다**(Lua 또는 SETNX 락 패턴) `✓` |
| **ElastiCache Redis OSS ≤7.1** | ElastiCache Valkey | `modify-replication-group --engine valkey --engine-version 9.0`(serverless 는 `modify-serverless-cache`) | 5.0.6+ 는 failover 몇 초, 그 미만은 DNS 전파 30\~60초 `✓` | **Valkey 7.2 → Redis OSS 7.1 한 경로만** `✓` | **엔드포인트 DNS 는 유지되고 노드 IP 만 바뀐다** → `networkaddress.cache.ttl` 을 먼저 5\~10초로 `✓`. 커스텀 파라미터 그룹을 쓰면 static 파라미터 값이 같은 Valkey 용 그룹을 함께 넘긴다 `✓` |
| **ElastiCache CMD** | ElastiCache CME | `ClusterMode: disabled → compatible → enabled` 2단계. `compatible` 창에서 클라이언트를 cluster 계열 + config endpoint 로 무중단 이전 | 계획대로면 없음 `✓` | **`compatible` 에서만.** `enabled` 를 넘으면 *"Reverting this configuration is not possible"* `✓` | 바뀌는 것이 네 층(엔드포인트·클라이언트 클래스·다중 키 연산·파라미터 그룹)이다. 전제조건 — **DB 0 만 사용 · cluster 프로토콜 클라이언트 · auto-failover + replica 1 이상 · Valkey 7.2 / Redis OSS 7.0 이상** `✓`. `enabled` 후 구 엔드포인트 삭제 여부와 config endpoint 이름의 동일성은 **AWS 문서에 없다** → 완료 후 `describe-replication-groups` 재조회 단계를 반드시 넣는다 `?` |
| self-host | ElastiCache / MemoryDB | 위 경로들 | — | 데이터는 되돌릴 수 있으나 운영 관행은 바뀐다 `Σ` | `config`·`debug`·`bgsave`·`replicaof` 차단을 수용해야 한다. MemoryDB 는 `acl setuser`·`cluster setslot`·`module` 까지 막는다 `✓` |
| ElastiCache / k8s self-host | (반대 방향) | — | — | — | **cluster mode 는 NAT 를 지원하지 않는다.** L4 LB·Ingress 로 감싸면 노드가 광고한 주소에 클라이언트가 도달할 수 없다 → `cluster-announce-*` 정밀 설정 또는 hostNetwork, 그리고 **6379 와 16379 를 함께 노출** `✓` |

표를 관통하는 규칙이 하나 있습니다. 되돌릴 수 없는 전환은 전부 버전 숫자 하나(RDB 12 / RDB 80 / `ClusterMode: enabled`)로 표시되고 그 숫자를 넘기 전에는 거의 모든 것을 되돌릴 수 있습니다 `Σ`. 마이그레이션 계획의 첫 항목은 방법을 고르는 일이 아닙니다. "이번 창에서 넘는 편도 경계가 몇 개인가" 를 먼저 셉니다 — 두 개 이상이면 창을 쪼갭니다 `Σ`.

## 6. 고르지 않아도 되는 것

이 절은 앞 다섯 절을 부분적으로 무력화합니다. 위 판단표가 거의 중요하지 않은 케이스가 있고 그 경우 이주 자체가 순손실입니다 `Σ`.

| 케이스 | 왜 선택이 덜 중요한가 | 그래서 |
|---|---|---|
| **작은 캐시 하나** (수 GB 미만, 단일 샤드, 세션·조회 캐시) | cluster 제약([06]({{< relref "06-cluster-mode/index.md" >}}))이 발동하지 않고, RDB 버전 차단선([04]({{< relref "04-redis-7-to-8.md" >}})·[05]({{< relref "05-valkey-8-to-9/index.md" >}}))도 "데이터를 버리면 되므로" 무의미해진다. 성능 축은 애초에 비교 불가다 | **엔진 선택보다 TTL 설계·stampede 방어·DNS TTL 이 SLO 를 더 많이 움직인다** `Σ`. 여기서 엔진을 갈아타는 프로젝트는 리스크만 사는 것이다 |
| **사내 캐시 용도로만 쓴다** | RSALv2·SSPLv1·AGPLv3 어느 쪽도 사내 사용을 금지하지 않는다(FAQ #20, affiliates·subsidiaries 포함) | **라이선스를 이주 사유로 쓸 수 없다** `✓`. 재배포·외부 제공이 로드맵에 없다면 §3.3 표는 전부 "걸리지 않는다" 로 끝난다 |
| **관리형에 이미 잠겨 있다** | ElastiCache 는 Redis OSS 가 7.1 에서 멈췄고 그 위는 Valkey 뿐이다 — **엔진 선택이라는 결정이 애초에 존재하지 않는다** | 고민할 것은 엔진이 아니라 **모드(CMD/CME)·durability·TLS 전환 순서**다([07]({{< relref "07-aws-endpoints/index.md" >}})) `✓` |
| **7.2 라인에 있고 기능 요구가 없다** | 7.2 는 Extended 로 EOL **2029-12-01**, 6.2 도 2027-04-01 까지 패치가 나온다(실제로 2026-07-23 에 7.2.15·6.2.23 릴리스) | **3년 이상의 유예가 이미 있다.** 다만 7.2 는 2023-08-15 이후 기능 동결이고 보안 유지의 실질 상류를 확인해야 한다 `✓` |
| **성능이 불만이다** | 8.x/9.x 성능 서술의 상당 부분이 `io-threads` 에 걸려 있고 **기본값은 양쪽 다 1(비활성)** 이다. Redis 는 8.10.0 까지 `IMMUTABLE_CONFIG` 라 재시작이 필요하다 | **엔진을 바꾸기 전에 `io-threads` 를 켜 본다** `✓`. Valkey 에서는 `prefetch-batch-max-size` 도 `io-threads` 가 꺼져 있으면 무의미하다 `✓` |
| **메모리가 불만이다** | Valkey 8.0 의 -20.63% 중 13.68%p 는 **포크 이전 공통 조상**(per-slot kvstore, Redis #12822)에서 오고, 그 16바이트 절감은 **cluster mode 에서만** 발생한다 | standalone 에서 8.0 으로 올리며 -20% 를 기대하면 틀린다 `Σ`. 실제 순이득은 **8.1 의 새 hashtable(키당 20~30B)** 이고 이것은 재시작만으로 얻는다 `✓` |
| **"곧 나올 9" 를 기다린다** | Redis 에 9.x 는 없다(전수 확인) | **유예의 근거가 없다.** 지금 결정해야 하는 것은 8.x 안의 선택이다 `✓` |

여기서 나오는 마지막 판정이 이 문서의 결론입니다. 엔진 선택은 라이선스·번들 모듈·관리형 지원 버전이 실제로 우리를 제약할 때만 결정으로서 존재하고 그 셋 중 아무것도 걸리지 않으면 지금 쓰는 쪽을 계속 쓰는 것이 정답입니다 `Σ`. 앞 7개 문서가 확정한 사실 중 이주를 강제하는 것은 딱 세 개입니다 — 8.0 의 EOL 2026-12-01, 외부 제공·재배포가 로드맵에 있는 경우의 라이선스 경계, 그리고 관리형에서 7.1 위로 가려는 경우 `✓`.

## 7. 근거

이 문서는 새 1차 근거를 만들지 않습니다. 모든 사실의 소유 문서는 다음과 같습니다.

- 자료구조 서버의 제약이 왜 이 모양인가(단일 스레드 = API 계약, threaded I/O 의 경계, RDB_VERSION 이 곧 다운그레이드 차단선) — [01 · 2009 첫 커밋부터 6.2 까지]({{< relref "01-origins-and-design/index.md" >}})
- memcached 의 구조와 2026년 상태(slab calcification 연대기, 4단 segmented LRU, 워커별 이벤트 루프, meta 프로토콜과 stampede 방어, extstore·restartable cache 가 영속성이 아닌 이유, 관리형 현황, 버스 팩터) — [02 · memcached]({{< relref "02-memcached/index.md" >}})
- 라이선스 원문과 거버넌스 구조(RSALv2 금지형 vs SSPLv1 조건형, AGPL 추가가 철회가 아닌 이유, CLA vs DCO + 1/3 상한 + 2/3 super-majority, 사내 사용 허용 FAQ #20, 걸리는 네 케이스, 배포판 반응) — [03 · 왜 찢어졌나]({{< relref "03-license-and-fork.md" >}})
- Redis 7.0 → 8.10 의 실제 내용(9.x 부재 전수 확인, 짝수 마이너 케이던스, 모듈 번들의 실제 형태, Vector Set 의 beta 상태, 성능 주장의 조건, Standard/Extended 지원선과 EOL, 릴리스별 breaking·CVE) — [04 · Redis 7.0 → 8.10]({{< relref "04-redis-7-to-8.md" >}})
- Valkey 8.0 → 9.1 의 실제 내용(async I/O 스레딩 교체, dual channel 의 와이어 비호환, 8.1 새 hashtable, RDB 80 분기와 foreign 예약, HFE 동작 차이, 지원 정책 3년+5년, 모듈 생태계, 마이그레이션 사실관계) — [05 · Valkey 8.0 → 9.1]({{< relref "05-valkey-8-to-9/index.md" >}})
- cluster mode 가 강제하는 것(16384 의 gossip 예산 근거, MOVED/ASK 구분, 잃는 것 8종, 양 진영 ASM 의 반대 방향, 모듈이 ASM 을 막는 게이트, `cluster_state:ok` 의 세 구멍) — [06 · cluster mode]({{< relref "06-cluster-mode/index.md" >}})
- AWS 엔드포인트·엔진·모드(엔드포인트 판별 규칙, CMD→CME 단방향, 엔진 전환의 in-place 성격, DNS TTL 지시, TLS 전환이 엔드포인트 마이그레이션인 이유, 관리형이 막는 커맨드, MemoryDB 포지셔닝 변화) — [07 · AWS 에서 엔드포인트는 어떻게 바뀌나]({{< relref "07-aws-endpoints/index.md" >}})

이 문서가 근거 없이 판정하지 않은 것 — 앞 문서들이 미확인으로 남긴 항목은 이 문서에서도 결론으로 쓰지 않았습니다.

- 성능 배수 비교 — memcached 와 Redis 계열을 같은 하드웨어에서 1:1 로 측정한 1차 출처가 없고([02]({{< relref "02-memcached/index.md" >}})), Redis·Valkey 의 수치는 전부 발행 주체가 당사자입니다(`Ⓥ`). 그래서 §2 의 성능 행은 판정을 "비교 불가" 로 적었고 어느 엔진이 몇 배 빠르다는 서술은 넣지 않았습니다 `?`
- Redis 8.2 유지보수 라인에 8.10 의 ACL 우회 수정(#15478)이 백포트됐는지 — 2026-07-23 일괄 패치 웨이브는 8.10.0(2026-07-29)보다 앞서므로 그 웨이브에 포함될 수 없습니다. 앞 문서에 이후 패치의 근거가 없어 §3.4·§4.1 에서 `?` 로 남겼습니다
- Vector Set 의 GA 시점 — 릴리스노트에 beta 해제 선언이 없고 `redis.io` 문서끼리 불일치합니다([04]({{< relref "04-redis-7-to-8.md" >}})). §3.5 는 "GA 선언 문장이 없다" 까지만 씁니다 `?`
- Valkey 9.1 의 security 종료일 — 9.2 GA 후 "최신 minor 지위를 잃으면 5년을 되돌린다" 고 명시한 문장이 확인되지 않았습니다([05]({{< relref "05-valkey-8-to-9/index.md" >}})). §4.2 는 2031-05-19 를 전제로 쓰지 말라는 형태로만 판정했습니다 `≈`
- Valkey 9.x → Redis 방향의 차단 — 앞 문서의 마이그레이션 표에 이 행이 없습니다. `VALKEY080` magic 과 foreign 예약 규칙에서 나오는 추론이라 §5 에서 `Σ` 로 표시했습니다
- 그룹사·계열사 간 유상 제공이 라이선스상 "third parties" 인지 — 원문으로는 판정되지 않습니다([03]({{< relref "03-license-and-fork.md" >}})). §3.3 표에서 `?` 로 남겼고 이 케이스는 원문만으로 판정하지 말라는 [03]({{< relref "03-license-and-fork.md" >}})의 경고를 그대로 승계합니다
- ElastiCache 의 `compatible` 상태 API 응답 · `enabled` 후 구 엔드포인트 삭제 여부 · config endpoint 이름의 동일성 — AWS 1차 문서에 없습니다([07]({{< relref "07-aws-endpoints/index.md" >}})). §5 의 CMD→CME 행은 "재조회 단계를 반드시 넣는다" 로만 처리했습니다 `?`
- ElastiCache for Memcached / MemoryDB 의 날짜 박힌 EOL 캘린더, MemoryDB 의 Valkey 8/9 지원 여부 — 확인되지 않았습니다([02]({{< relref "02-memcached/index.md" >}})·[07]({{< relref "07-aws-endpoints/index.md" >}})). §2 의 관리형 지원 행은 "웹 확인 최신" 이라는 한정을 붙였습니다 `?`
- AWS 가격 인하율의 현재성 — 2024-10-08 발표문 수치이고 2026-08 현재도 같은지 확인되지 않았습니다([03]({{< relref "03-license-and-fork.md" >}})·[07]({{< relref "07-aws-endpoints/index.md" >}})). 그래서 이 문서는 가격을 판정 축에 넣지 않았습니다 `?`
- 클라이언트 라이브러리의 cluster 클래스명·최소 버전, valkey-glide 의 언어별 기능 격차 — 검증되지 않았습니다([06]({{< relref "06-cluster-mode/index.md" >}})). §2 의 클라이언트 생태계 행은 "이 축은 판정에 거의 기여하지 않는다" 로 처리했습니다 `?`
