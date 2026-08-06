---
title: "cluster mode — 16384 슬롯이 강제하는 것"
weight: 6
---

# 06 · cluster mode — 16384 슬롯이 강제하는 것

{{< callout type="info" >}}
**한눈에**
- **cluster mode 는 스케일을 주는 대신 애플리케이션의 자유를 뺏는다.** 프록시를 두지 않기로 한 2015-04-01(3.0.0)의 결정이 그 대가의 근원이다 — 라우팅 비용을 클라이언트로 옮겨 hop 을 하나 없앤 대신, **smart client 가 없으면 아무것도 동작하지 않는다** `✓`.
- `MOVED` 와 `ASK` 는 같은 코드 경로에서 접두어만 갈려 나오는데 의미는 정반대다. `MOVED` 는 영구 재배치라 **슬롯 맵을 갱신**해야 하고, `ASK` 는 단발이라 **슬롯 맵을 갱신하면 안 되고** `ASKING` 을 앞세워 한 번만 재시도해야 한다. 이 구분을 못 하는 클라이언트는 리샤딩 중 슬롯 맵을 오염시킨다 `✓`.
- **16384 는 미학이 아니라 gossip 헤더 예산이다.** 모든 PING/PONG/MEET 헤더에 슬롯 비트맵이 raw 로 실리고 그게 정확히 2048바이트다 — `clusterMsg` 의 `myslots` 오프셋 80, `replicaof` 오프셋 2128 이 `static_assert` 로 못 박혀 있다 `✓`.
- 슬롯 계산은 `mod` 가 아니라 `crc16(key) & 0x3FFF` 다. 해시 태그는 **첫 `{` 와 그 뒤 첫 `}`** 만 본다 — `{a}{b}` 는 `a` 로 해시되고, `{}` 나 `}` 없는 경우는 태그가 **무시되고 키 전체**가 해시된다 `✓`.
- 잃는 것은 cross-slot 다중 키 연산·단일 슬롯 트랜잭션·pub/sub 브로드캐스트 비용·`KEYS`/`SCAN`/`DBSIZE` 의 의미·커넥션 수 곱셈이다. **"DB 0 하나뿐"만은 진영이 갈렸다** — Valkey 9.0.0 이 `cluster-databases` 를 열었고 Redis 8.10.0 에는 그 설정이 없다 `✓`.
- 가장 아팠던 슬롯 마이그레이션을 **양쪽이 각자 원자적으로 고쳤고 방향이 반대다** — Valkey 9.0.0(2025-10-21) `CLUSTER MIGRATESLOTS` 는 source 에서 push, Redis 8.4.0(2025-11-18) `CLUSTER MIGRATION IMPORT` 는 destination 에서 pull. **리샤딩 자동화가 두 진영 호환되지 않는 첫 사례**다 `✓`.
- `cluster_state:ok` 는 세 가지 방식으로 거짓 안심을 준다 — `cluster-require-full-coverage no` 면 커버리지 검사를 아예 하지 않는다. 커버리지 검사는 **PFAIL 을 안 본다**. 값은 **그 노드의 로컬 gossip 시야**로 계산된다 `✓`.
- Valkey 에서 **모듈을 하나라도 로드하면 ASM 이 아예 거부된다.** 공식 모듈 4개(search/json/bloom/ldap) 전부가 `VALKEYMODULE_OPTIONS_HANDLE_ATOMIC_SLOT_MIGRATION` 을 선언하지 않는다 `✓`.
{{< /callout >}}

> **왜 이 문서인가.** cluster mode 를 "샤딩 켜기"로 읽으면 매니페스트는 통과하고 애플리케이션이 나중에 터진다. 실제로 켜지는 것은 **애플리케이션 계약의 변경**이다 — 같이 읽던 키를 같이 읽을 수 없다. standalone 에서 통과한 트랜잭션이 `EXEC` 에서만 실패한다. 모니터링이 보던 `DBSIZE` 가 다른 뜻이 된다. 이 문서는 그 제약이 **어느 코드에서 어떤 조건으로 발생하는지**와, 11년간 가장 아팠던 슬롯 마이그레이션이 2025년에 어떻게 바뀌었는지를 다룬다.

> 근거 기준: 소스는 `valkey 9.1.0`/`9.1.1`, `redis 8.10.0`, `redis 3.0.0` 로컬 클론과 각 릴리스노트다. 릴리스일은 GitHub `published_at` 이고 사건 시각은 UTC 로 통일했다. 기준일 2026-08-06. 줄 번호는 해당 태그 스냅샷이다.

AWS 에서 이 구조가 어떤 엔드포인트로 노출되는지, CMD → CME 전환에서 무엇이 바뀌는지는 이 문서 소유가 아니다 → [07 · AWS 엔드포인트]({{< relref "../07-aws-endpoints/index.md" >}}). 버전별 신기능 나열은 [04 · Redis 7.0 → 8.10]({{< relref "../04-redis-7-to-8.md" >}})(Redis)와 [05 · Valkey 8.0 → 9.1]({{< relref "../05-valkey-8-to-9/index.md" >}})(Valkey)가 소유한다.

## 1. 왜 프록시가 아니었나

Redis Cluster 는 3.0.0(2015-04-01)에 "a distributed implementation of a subset of Redis" 로 나왔다(`redis:RELEASENOTES-3.0.0.txt:19`) `✓`. 2.6 릴리스노트가 이미 "2.6 에서 cluster 코드를 전부 제거했고 3.0 에서 낸다"고 예고했으므로, 이 설계는 4년 가까이 벼려진 결정이다(`redis 2.6.0:00-RELEASENOTES:180-183`) `✓`.

핵심 결정은 하나다. **서버는 자기 슬롯이 아닌 키 요청을 대신 처리하지 않는다.** `getNodeByQuery()` 가 노드를 판정하고, 내 것이 아니면 `clusterRedirectClient()` 가 에러 문자열을 되돈다 — 두 에러가 완전히 같은 포맷으로 같은 줄에서 만들어진다.

```c
addReplyErrorSds(c, sdscatprintf(sdsempty(), "-%s %d %s:%d",
    (error_code == CLUSTER_REDIR_ASK) ? "ASK" : "MOVED",
    hashslot, clusterNodePreferredEndpoint(n, c), port));
```

`valkey 9.1.0:src/cluster.c:1049-1306`(판정), `:1332-1334`(리다이렉트 응답), `redis 8.10.0:src/cluster.c:1517-1520` `✓`. Redis 쪽은 같은 호출의 인수가 `clusterNodePreferredEndpoint(n)` 하나뿐이라는 차이만 있고 만들어지는 문자열은 동일하다 `✓`.

| 축 | 프록시 방식(twemproxy·codis) | 클라이언트 리다이렉트(Redis Cluster) |
|---|---|---|
| hop | 2 (앱 → 프록시 → 노드) | **1** |
| 앱이 보는 것 | 단일 엔드포인트 — dumb client 가능 | 노드 목록 + 슬롯 맵 |
| SPOF | 프록시 자체를 HA 로 이중화해야 함 | 없음 |
| failover·리샤딩 | twemproxy 는 하지 않음(외부 도구 필요), codis 는 ZooKeeper/etcd 의존 | cluster bus 가 자체 수행 |
| 커넥션 수 | 프록시가 흡수 | **노드 수만큼 곱해짐** |
| 오늘의 유지보수 | twemproxy 마지막 push 2024-03-29, codis 2024-04-15 — 2년 넘게 커밋 없음 `✓` | 양 진영 활발 |

프록시 계열은 사실상 정지했다. 두 리포 모두 아카이브 표시는 없지만 2026-08-06 기준 마지막 push 가 2024년이다(`gh api repos/twitter/twemproxy`, `gh api repos/CodisLabs/codis`) `✓`. 오늘 프록시 계층이 필요하다면 이 둘은 후보가 아니고, 대안(Envoy Redis proxy 등)이 cluster 의 어떤 제약을 실제로 흡수해주는지는 이 문서의 조사 범위에 없다 `?`.

**전제를 정확히 적어둘 필요가 있다.** 이 설계는 "클라이언트가 슬롯 맵을 캐시하고, 낡으면 스스로 갱신한다"를 **가정**한다. 가정이 깨지면 클러스터가 아니라 애플리케이션이 죽는다(§8).

## 2. MOVED 와 ASK

두 에러를 만드는 **조건**이 다르다. `MOVED` 는 함수의 base case 다 — "이 슬롯의 정당한 주인은 `n` 이고 그건 내가 아니다"(`valkey 9.1.0:src/cluster.c:1302-1305`) `✓`. `ASK` 는 훨씬 좁다: 슬롯이 `migrating` 상태이고 **요청한 키가 지금 나에게 하나도 없을 때만** 난다.

```c
if (migrating_slot && missing_keys) {
    if (existing_keys) { *error_code = CLUSTER_REDIR_UNSTABLE; return NULL; }  /* TRYAGAIN */
    else { *error_code = CLUSTER_REDIR_ASK; return getMigratingSlotDest(c->slot); }
}
```

`valkey 9.1.0:src/cluster.c:1268-1277` `✓`.

{{< seq src="_seq/2-moved-와-ask.json" />}}

`ASKING` 은 커넥션 단위 모드가 아니다. 클라이언트 플래그를 세우는 것뿐이고(`c->flag.asking = 1`), 소멸 조건이 소스에 명시돼 있다 — "MULTI 안이 아니고, 직전에 실행한 것이 ASKING 자신이 아니면 지운다"(`valkey 9.1.0:src/networking.c:3345-3346`, `redis 8.10.0:src/networking.c:3050-3056`) `✓`. 즉 **다음 커맨드 1개 전용**이며, MULTI 안에서는 유지되므로 트랜잭션 전체가 한 번의 `ASKING` 으로 커버된다. 레거시 `MIGRATE` 가 내부적으로 `RESTORE-ASKING` 을 쓰는 것도 같은 이유다(`redis 3.0.0:src/cluster.c`) `✓`.

**슬롯 맵이 낡았을 때 클라이언트가 해야 하는 일**은 세 단계다. (1) `MOVED` 를 받으면 그 슬롯만 고치는 것으로 끝내지 말고 토폴로지 전체를 재조회한다 — `MOVED` 하나는 보통 failover 나 리샤딩 완료를 뜻하고 다른 슬롯도 함께 움직였을 확률이 높다. (2) 재조회는 `CLUSTER SHARDS`(Redis 7.0+ 권장) 또는 `CLUSTER SLOTS` 로 한다(§9 — 두 진영의 deprecation 상태가 다르다). (3) 갱신 중 들어오는 요청은 리다이렉트 횟수 상한을 두고 재시도한다. 상한이 없으면 토폴로지가 흔들리는 동안 무한 리다이렉트가 된다.

`TRYAGAIN` 은 별종이다. `-TRYAGAIN Multiple keys request during rehashing of slot` 은 요청 키 중 일부는 아직 source 에 있고 일부는 이미 넘어간 상태에서 나며, **백오프 재시도로 넘길 수 있는 에러가 아니다** — 그 슬롯의 이동이 끝날 때까지 그 다중 키 커맨드는 계속 실패한다(`valkey 9.1.0:src/cluster.c:1268-1290`, `:1187-1191`) `✓`. 이것은 **레거시 키 단위 마이그레이션 고유의 병**이고 §6 의 ASM 에서는 원리적으로 사라진다.

## 3. 16384 인 이유

antirez 가 2015-05-12 에 직접 답했다(`redis/redis` issue #2576, 2015-05-12T12:23:35Z) `✓`:

> "Normal heartbeat packets carry the full configuration of a node … they contain the slots configuration for a node, in raw form, that uses 2k of space with 16k slots, but would use a prohibitive 8k of space using 65k slots. … At the same time it is unlikely that Redis Cluster would scale to more than 1000 master nodes because of other design tradeoffs."

소스가 이 숫자를 그대로 못 박아 둔다.

```c
#define CLUSTER_SLOT_MASK_BITS 14
#define CLUSTER_SLOTS (1 << CLUSTER_SLOT_MASK_BITS)   /* 16384 */
unsigned char myslots[CLUSTER_SLOTS / 8];             /* clusterMsg 안 */
static_assert(offsetof(clusterMsg, myslots)   == 80,   "unexpected field offset");
static_assert(offsetof(clusterMsg, replicaof) == 2128, "unexpected field offset");
```

2128 − 80 = **2048 바이트**. `valkey 9.1.0:src/cluster.h:9-10`, `:src/cluster_legacy.h:285`, `:303-322` `✓`.

함의는 두 가지로 나뉜다. 첫째, 이 비트맵은 압축되지 않은 raw 이고 노드 쌍마다 주기적으로 흐르므로 cluster bus 트래픽이 노드 수에 대해 대략 O(N²) 로 늘어난다 `≈` — 1000 primary 가 실무 상한으로 언급되는 이유다. 다만 antirez 가 말한 "other design tradeoffs" 가 정확히 무엇인지는 본인도 밝히지 않았고, gossip O(N²) 추정 외의 근거는 확인하지 못했다 `?`. 둘째, 필드 오프셋이 `static_assert` 로 잠겨 있다는 것은 **rolling upgrade 중 서로 다른 버전이 같은 wire format 을 읽어야 한다는 제약이 코드로 강제된다**는 뜻이다(구조체 주석: "fields in this struct should remain at the same offset from release to release") `✓`.

슬롯 계산은 흔히 `crc16(key) mod 16384` 로 설명되지만 실제 코드는 비트마스크다. 16384 가 2의 거듭제곱이라 등가이고, 나눗셈이 사라지는 것도 2^14 를 고른 이유 중 하나다.

```c
unsigned int keyHashSlot(const char *key, int keylen) {
    int s, e;
    for (s = 0; s < keylen; s++) if (key[s] == '{') break;
    if (s == keylen) return crc16(key, keylen) & 0x3FFF;                /* '{' 없음 → 키 전체 */
    for (e = s + 1; e < keylen; e++) if (key[e] == '}') break;
    if (e == keylen || e == s + 1) return crc16(key, keylen) & 0x3FFF;  /* '}' 없음 또는 {} → 키 전체 */
    return crc16(key + s + 1, e - s - 1) & 0x3FFF;                      /* 첫 {} 사이만 */
}
```

`valkey 9.1.0:src/cluster.c:58-77`. 이 함수는 `redis 3.0.0:src/cluster.c` 의 것과 로직상 동일하다 — **11년간 바뀌지 않았다** `✓`.

| 키 | 해시 대상 | 흔한 오해 |
|---|---|---|
| `user:123` | `user:123` 전체 | — |
| `{user123}:profile` | `user123` | 의도대로 동작 |
| `{a}{b}:x` | **`a`** | "둘 다 본다"고 착각하면 슬롯이 어긋난다 |
| `{}:x` | **`{}:x` 전체** | 빈 태그는 무시된다 |
| `user{123` | **`user{123` 전체** | `}` 가 없으면 태그가 아니다 |

해시 태그를 남용하면 슬롯 하나에 키가 몰려 hot slot 이 된다. **슬롯이 최소 단위이므로 ASM 으로도 그 슬롯은 쪼갤 수 없다** — 해시 태그 설계는 나중에 되돌리기가 매우 비싸다 `Σ`.

## 4. cluster bus

노드 간 제어 채널은 별도 포트를 쓴다. 오프셋이 `CLUSTER_PORT_INCR` 로 고정돼 있고 리스너·노드 정보 파싱·MEET 처리에 일관되게 적용된다.

```c
listener->port = server.cluster_port ? server.cluster_port : port + CLUSTER_PORT_INCR;
if (!server.cluster_port && port > (65535 - CLUSTER_PORT_INCR)) { /* 기동 거부 */ }
```

`valkey 9.1.0:src/cluster_legacy.c:878-880`, `:1500`, `:1554` `✓`. Redis 7.0 의 `cluster-port`(IMMUTABLE)로 오프셋을 벗어난 임의 포트를 지정할 수 있고(`redis:RELEASENOTES-7.0.0.txt:495,500`), NAT·컨테이너 환경용으로 `cluster-announce-ip`/`-port`/`-bus-port`/`-hostname` 이 있다(`valkey 9.1.0:src/config.c:3323-3328`, `:3404-3406`) `✓`.

운영 함정 셋. (1) 방화벽·SecurityGroup·NetworkPolicy 에 **두 포트를 다 열어야** 한다 — 6379 만 열고 16379 를 막으면 노드가 서로를 PFAIL 로 보다가 클러스터가 형성되지 않는다. (2) 데이터 포트가 55535 를 넘으면 기동이 거부되므로 높은 포트를 쓸 때 `cluster-port` 를 명시해야 한다. (3) **announce 값은 신뢰 경계다** — Valkey 9.1.1 이 cluster AUX 필드의 제어문자·구분자를 거부하고 `cluster-announce-ip` 를 검증하도록 고친 이유가 `nodes.conf` injection 방지다(`valkey:RELEASENOTES-9.1.1.txt:45`) `✓`.

버스에 흐르는 것은 PING/PONG/MEET/FAIL 계열이고, 장애 판정은 2단계다. `cluster-node-timeout`(Valkey 9.1.0 기본 **15000ms**, `valkey 9.1.0:src/config.c:3449`) 동안 PONG 이 없으면 그 노드를 로컬에서 PFAIL 로 찍는다. gossip 으로 모인 failure report 가 정족수를 넘으면 FAIL 로 승격 + 브로드캐스트한다.

```c
void markNodeAsFailingIfNeeded(clusterNode *node) {
    int needed_quorum = (server.cluster->size / 2) + 1;
    if (!nodeTimedOut(node)) return;
    if (nodeFailed(node)) return;
    failures = clusterNodeFailureReportsCount(node);
    if (clusterNodeIsVotingPrimary(myself)) failures++;   /* 나도 한 표 */
    if (failures < needed_quorum) return;
    markNodeAsFailing(node);
    clusterSendFail(node->name);
}
```

`valkey 9.1.0:src/cluster_legacy.c:2582-2605`, `:6650-6665` `✓`.

`server.cluster->size` 는 **슬롯을 1개 이상 가진 primary 의 수**다(`clusterNodeIsVotingPrimary`). 결과가 세 가지다 — (a) replica 를 아무리 늘려도 정족수는 변하지 않는다, (b) **슬롯을 다 빼낸 primary 는 투표 인원에서 빠진다** 그래서 리샤딩 후 방치한 노드가 정족수를 흔든다, (c) 3-shard 클러스터는 size=3·정족수 2 이므로 primary 2대 동시 장애 시 FAIL 판정 자체가 불가능해진다 `✓`. `cluster-replica-no-failover`(기본 0 = failover 함, `valkey 9.1.0:src/config.c:3287`)를 1 로 두면 그 replica 는 승격을 시도하지 않는다 — cross-DC 대기 replica 를 의도적으로 묶어둘 때 쓰지만 켜둔 걸 잊으면 장애 시 승격이 안 된다 `✓`.

`cluster-require-full-coverage`(양 진영 기본 **1** = yes, `valkey 9.1.0:src/config.c:3282`, `redis 8.10.0:src/config.c:3310`)의 트레이드오프는 통상 설명과 방향이 다르다 `✓`.

| 값 | 슬롯이 비었을 때 | 대가 |
|---|---|---|
| `yes`(기본) | 클러스터 전체가 `CLUSTER_FAIL` — 모든 요청 거부 | 부분 장애가 전체 장애로 번진다 |
| `no` | 없는 슬롯 요청만 `-CLUSTERDOWN Hash slot not served` | **`cluster_state` 는 `ok` 를 보고한다 → 모니터링이 눈이 먼다** |

`no` 로 두면 가용성이 좋아지는 것이 아니라 **장애가 관측되지 않는 형태로 바뀐다.** `clusterUpdateState()` 가 이 설정이 꺼져 있으면 커버리지 검사 자체를 하지 않기 때문이다(§9).

과거의 wire 호환성 사고도 여기 속한다. Redis 4.0 은 NAT/Docker 지원을 넣으면서 버스 프로토콜을 깨뜨렸다 — "Redis 4.0 cluster bus protocol is not compatible with Redis 3.2, so in order to upgrade, a mass reboot of the instances is needed and rolling upgrades are not possible"(`redis:RELEASENOTES-4.0.0.txt:51-57`) `✓`. 오늘의 `static_assert` 블록(§3)이 이 사고의 재발 방지 장치다 `Σ`.

## 5. cluster 를 쓰면 잃는 것

각 행의 마지막 열이 이 절의 요점이다 — 제약을 아는 것과 애플리케이션을 고치는 것은 다른 일이다.

| 잃는 것 | 정확한 동작과 발생 조건 | 애플리케이션이 무엇을 고쳐야 하나 |
|---|---|---|
| **cross-slot 다중 키 연산** | `MGET`/`MSET`/`SUNION`/`ZUNIONSTORE`/`SINTERSTORE`/`PFMERGE`/`BITOP`/`RENAME`/`SMOVE`/`LMOVE`/`GEOSEARCHSTORE` 등이 `-CROSSSLOT`. 판정은 `clusterSlotByCommand()` 의 **커맨드 파싱 단계**이고 **키 존재 여부를 보지 않는다** `✓` | 같이 읽는 키를 해시 태그로 묶거나, 클라이언트가 슬롯별로 쪼개 병렬 전송 후 재조립한다. "빈 키니까 괜찮겠지"는 통하지 않는다 |
| **트랜잭션** | `MULTI` 큐잉은 `QUEUED` 로 정상 통과하고 **`EXEC` 시점에** 전체 슬롯을 훑어 하나라도 다르면 `-CROSSSLOT`. 같으면 EXEC 의 슬롯을 그 값으로 덮어쓴다 `✓` | 트랜잭션 경계를 단일 슬롯으로 재설계한다. **standalone 테스트는 통과하므로 cluster 통합 테스트가 필수다** |
| **Lua / Function** | shebang 스크립트·Function(7.0+)은 선언 키가 한 슬롯이어야 한다. 그런데 **shebang 없는 레거시 `EVAL` 은 `SCRIPT_FLAG_EVAL_COMPAT_MODE` 로 cross-slot 이 허용된다** `✓` | 레거시 EVAL 에 의존하고 있었다면 그건 우연히 통과한 것이다. shebang 을 붙이면 엄격 모드가 켜져 **기존에 돌던 스크립트가 깨질 수 있으니** 붙이기 전에 키 접근을 감사한다 |
| **DB 0 하나뿐 — 진영별로 갈림** | Redis 8.10.0: `cluster-databases` 가 **없다**, cluster 는 DB 0 뿐 `✓` · Valkey 9.0.0+: `cluster-databases`(IMMUTABLE, **기본 1**) 를 올리면 `SELECT`/`MOVE`/`COPY` 가 동작하고 `SWAPDB` 만 금지 `✓` | Redis 라면 DB 를 하나로 합치는 것이 이관 전제다. Valkey 라면 필수는 아니지만 (a) IMMUTABLE 이라 재시작이 필요하고 (b) 레거시 리샤딩이 DB 수만큼 늘어나고 (c) **Redis 로 되돌릴 수 없는 편도 티켓**이다 |
| **pub/sub 전파** | 일반 `PUBLISH` 는 `clusterNodeIterInitAllNodes()` 로 **모든 노드에 브로드캐스트**된다 — 노드를 늘려도 처리량이 늘지 않고 bus 부하만 커진다. 7.0 의 sharded pub/sub(`SPUBLISH`/`SSUBSCRIBE`)이 고친 것이 정확히 이 이터레이터 한 줄이다 `✓` | `SPUBLISH`/`SSUBSCRIBE` 로 전환한다. 대가는 **채널명이 슬롯에 묶이는 것** — 구독자도 그 슬롯 소유 노드에 붙어야 하고 채널명을 바꾸면 대상 노드가 바뀐다. 채널 그룹을 한 노드에 모으려면 채널명에도 해시 태그를 쓴다 |
| **`KEYS`/`SCAN`/`DBSIZE`/`RANDOMKEY`/`FLUSHALL`** | 키가 없어 `READ_FLAGS_NO_KEYS` 로 분류되고 "리다이렉트 없이 로컬 처리"로 즉시 통과한다 → **접속한 그 노드의 데이터만** 본다 `✓` | 전역 뷰가 필요하면 모든 primary 를 순회해 합산한다. `DBSIZE` 를 그대로 모니터링에 꽂아두면 값이 조용히 틀린다. Valkey 9.1.0 의 `CLUSTERSCAN` 이 서버측 전역 스캔을 제공한다 |
| **커넥션 수 곱셈** | 클라이언트가 노드마다 풀을 따로 유지한다 | `maxclients` 를 클라이언트 인스턴스 수 × 풀 크기 × primary 수(replica 읽기까지 하면 전체 노드 수)로 재산정한다 `≈` |
| **모듈 + ASM (Valkey)** | `moduleVerifyAllAllowAtomicSlotMigrationOrReply()` 가 전체 모듈을 순회해 **하나라도** `VALKEYMODULE_OPTIONS_HANDLE_ATOMIC_SLOT_MIGRATION` 이 없으면 `CLUSTER MIGRATESLOTS` 를 거부한다. **공식 4개 모듈(search/json/bloom/ldap) 전부 미선언** `✓` | ASM 을 쓰려면 모듈을 로드하지 않은 순수 서버여야 한다. `valkey-bundle` 이미지는 4개를 모두 로드하므로 ASM 이 불가능하다. 운영 중 확인은 `INFO modules` 의 `handle-atomic-slot-migration` 토큰 유무로 한다 |

`per-slot kvstore` 는 이 표의 여러 행을 가능하게 만든 하부 구조다. **왜 만들었나**(메모리·엔진 관점)는 [05 · Valkey 8.0 → 9.1]({{< relref "../05-valkey-8-to-9/index.md" >}})가 소유하고, cluster 관점에서 달라진 것은 슬롯 단위 순회가 실용적이 됐다는 점이다 — `CLUSTER COUNTKEYSINSLOT`/`GETKEYSINSLOT`, per-slot 메모리 회계(`CLUSTER SLOT-STATS`), 그리고 **§6 의 ASM 이 슬롯을 통째로 떼어내는 동작**이 여기서 나온다. `kvstore.c` 는 Redis 7.4.0 에 먼저 등장했고 Valkey 8.0.0 은 그것을 이어받았다 — 릴리스노트가 출처를 `Redis#12822` 로 명시하므로 "Valkey 가 만든 것"이 아니다(`redis 7.4.0:src/kvstore.c:1-10`, `valkey 8.0.0:src/kvstore.c:1-11`, `valkey:RELEASENOTES-8.0.0.txt:361-362`) `✓`. 포크 기점인 7.2.4 에는 없었다(`valkey 7.2.4:src/server.h:967-977` — 단일 `dict *dict`) `✓`.

sharded pub/sub 이 7.0 에 추가된 경위와 릴리스 맥락은 [04 · Redis 7.0 → 8.10]({{< relref "../04-redis-7-to-8.md" >}})가 소유한다(`redis:RELEASENOTES-7.0.0.txt:316,343`).

## 6. 슬롯 마이그레이션 — 가장 아팠던 곳

### 6.1 레거시 방식과 그 실패 모드

11년간 쓰인 절차는 **서버 밖의 오케스트레이션**이다. target 에 `CLUSTER SETSLOT <slot> IMPORTING <src>`, source 에 `CLUSTER SETSLOT <slot> MIGRATING <dst>`, 그다음 `CLUSTER GETKEYSINSLOT <slot> <count>` → `MIGRATE <host> <port> "" 0 <timeout> KEYS k1 k2 …` 를 `CLUSTER COUNTKEYSINSLOT` 이 0 이 될 때까지 반복, 마지막에 `CLUSTER SETSLOT <slot> NODE <dst>`.

Redis 가 자기 블로그에서 이 방식의 문제를 6개로 정리했다(2026-04-02) `✓`:

1. `ASK` 리다이렉트로 네트워크 지연·클라이언트 복잡도 증가, **naive pipeline 이 깨짐**
2. 다중 키 커맨드가 `TRYAGAIN` — "The client could complete this command until the whole slot was migrated"
3. **중간 실패 시 수동 복구 필요, 종종 데이터 유실**("led to data loss")
4. replica 가 마이그레이션 중임을 몰라 `ASK` 대신 "그냥 키 없음"으로 응답
5. 키 단위라 본질적으로 느림(per-key 조회 + RTT)
6. **큰 키 하나가 `MIGRATE` 타임아웃과 양쪽 지연 스파이크**를 유발

그래서 리샤딩은 "안전하지만 느린" 작업이 아니라 **위험하고 느린** 작업이었다. 실무에서 리샤딩을 미루고 오버프로비저닝하는 관행이 여기서 나왔다 `Σ`. 도구가 서버 밖(`redis-cli --cluster reshard`/`rebalance`)에 있어 실패하면 슬롯이 걸친 상태(`MIGRATING`/`IMPORTING` 잔존)를 사람이 `--cluster fix` 로 풀어야 했다.

### 6.2 Valkey 9.0 atomic slot migration

Valkey 9.0.0(2025-10-21, PR #1949 머지 2025-08-12Z)이 이걸 바꿨다. 설계 문서가 원리를 한 줄로 밝힌다 — "adapting existing replication and failover primitives" `✓`. 새 프로토콜을 만든 것이 아니라 **replication + manual failover 를 슬롯 범위로 좁혀 재사용**한다.

{{< seq src="_seq/6-atomic-slot-migration.json" />}}

커맨드 표면은 4개다. `CLUSTER MIGRATESLOTS SLOTSRANGE <s> <e> [<s> <e> …] NODE <node-id> [SLOTSRANGE … NODE …]`(source 에서 실행, `SLOTSRANGE … NODE …` 블록을 반복해 **여러 target 을 한 번에** 지정 가능), `CLUSTER GETSLOTMIGRATIONS`, `CLUSTER CANCELSLOTMIGRATIONS`, 그리고 내부용 `CLUSTER SYNCSLOTS`. `MIGRATESLOTS`/`CANCELSLOTMIGRATIONS` 는 `alldbs` ACL 권한을 요구한다(`valkey 9.1.1:src/commands/cluster-migrateslots.json`) `✓`. 설정은 `cluster-slot-migration-log-max-len`(기본 1000, MODIFIABLE)과 `slot-migration-max-failover-repl-bytes` 두 개다(`valkey 9.1.1:src/config.c:3457`, `:3490`) `✓`.

**실패는 자동 롤백이다 — 자동 재시도는 없다.** 설계 문서가 6가지 실패 원인을 명시하고(링크 단절, 노드 crash/halt/파티션, 어느 쪽이든 failover, target OOM, source 클라이언트 출력 버퍼 과대, 어느 쪽이든 `FLUSHDB`), 소스 주석은 11가지로 더 세분한다(+ AUTH 실패, ESTABLISH ERR, failover 전 unpause, 스냅샷 child OOM, ack 타임아웃). 롤백 시 target 이 `UNLINK` 로 받은 키를 지운다. 상태 기계는 21개 상태로 명시돼 있다 — export 측 11개, import 측 7개, terminal 3개(`valkey 9.1.0:src/cluster_migrateslots.c:15-41`, `:1050-1110`) `✓`. **리샤딩 자동화 도구는 `CLUSTER GETSLOTMIGRATIONS` 의 `state`/`message` 를 폴링해 재시도 루프를 직접 구현해야 한다** `Σ`.

정리 책임 규칙이 failover 와 겹칠 때 함정이다 — 설계 문서 원문: "Primaries demoted during migration do not clean up previously active slot imports. The promoted replica is responsible for both cleaning up the slot and sending a `SYNCSLOTS FINISH`." `✓`

RDB 통합도 차단선을 만든다. 진행 중 import 는 **새 RDB opcode 로 직렬화되며 mandatory** 다 — "If the opcode is not recognized, the RDB load will fail." 즉 ASM 진행 중 만든 RDB 는 구버전에서 로드가 실패한다. 9.0.0-rc3 에 `SYNCSLOTS CAPA`(#2688)가 forwards compatibility 목적으로 추가된 배경이다 `✓`.

### 6.3 Redis 8.4 에도 있다 — 방향이 반대다

Redis 8.4.0(2025-11-18, PR #14414 머지 2025-10-22)의 `CLUSTER MIGRATION` 은 `IMPORT`/`CANCEL`/`STATUS` 3개 서브커맨드이고 **destination primary 에서 실행**한다. 소스 주석이 명시한다 — "Sent by operator to the destination node to start the migration", 블로그도 "The migration is initiated from the destination node, just like the `REPLICAOF` command" `✓`.

| | Valkey 9.0.0 (2025-10-21) | Redis 8.4.0 (2025-11-18) |
|---|---|---|
| 파일 | `cluster_migrateslots.c` (2641줄) | `cluster_asm.c` (3889줄) |
| 개시 커맨드 | `CLUSTER MIGRATESLOTS SLOTSRANGE … NODE <target>` | `CLUSTER MIGRATION IMPORT <s> <e> …` |
| 실행 노드 | **source** (push) | **destination** (pull) |
| 조회 | `CLUSTER GETSLOTMIGRATIONS` | `CLUSTER MIGRATION STATUS [ID id\|ALL]` |
| 취소 | `CLUSTER CANCELSLOTMIGRATIONS` | `CLUSTER MIGRATION CANCEL <ID id\|ALL>` |
| 내부 프로토콜 | `CLUSTER SYNCSLOTS` | `CLUSTER SYNCSLOTS CONF ASM-TASK` |
| 스냅샷 포맷 | AOF 형식 커맨드 스트림 | per-key `RESTORE`, 큰 키만 AOF-style chunked |
| 주요 노브 | `cluster-slot-migration-log-max-len`(1000) · `slot-migration-max-failover-repl-bytes` | `cluster-slot-migration-handoff-max-lag-bytes`(1MB) · `-write-pause-timeout`(10s) · `-max-archived-tasks`(32, HIDDEN) · `-sync-buffer-drain-timeout`(60s, HIDDEN) |
| CLI 기본값 | `valkey-cli --cluster-use-atomic-slot-migration` 을 **명시해야** ASM 경로 | **8.10.0 부터 `redis-cli --cluster reshard`/`rebalance` 가 내부적으로 서버측 ASM 사용**(#15338) |
| 관리형 지원 | — | Redis Software·Redis Cloud **양쪽 미지원**(문서에 ❌ 표기) |
| 진행 중 추가 에러 | 없음 (redir code 0~7) | **`-TRYAGAIN Slot is being trimmed`**(`CLUSTER_REDIR_TRIMMING 8`) |

근거: `redis 8.10.0:src/cluster_asm.c:9-42`, `:901-903`, `:925-1000`; `redis 8.10.0:src/config.c:3433`, `:3465`, `:3466`, `:3467`; `redis 8.10.0:src/cluster.h:32-40`; `valkey 9.1.0:src/cluster.h:21-29`; `valkey 9.1.1:src/valkey-cli.c:2800`, `:4689`; `redis:RELEASENOTES-8.4.0.txt:33,104`; `redis:RELEASENOTES-8.10.0.txt:245` `✓`.

**여기서 나오는 운영 결론이 이 절의 핵심이다.** (1) 리샤딩 자동화 스크립트는 커맨드명·인수·실행 노드·조회 커맨드가 전부 달라 **두 진영 호환이 안 된다** — 엔진을 갈아탈 때 런북을 다시 쓴다. (2) Redis 는 **같은 CLI 명령이 8.8 이하와 8.10 이상에서 다른 메커니즘으로 동작한다**. 버전 확인 없이 런북을 재사용하면 안 된다. (3) Redis 는 ASM "완료" 후에도 trim 구간에 `-TRYAGAIN Slot is being trimmed` 를 낼 수 있다 — 마이그레이션 완료 시점과 에러가 멈추는 시점이 다르다. 클라이언트가 이 새 문자열을 재시도 대상으로 인식하지 못하면 애플리케이션 예외가 된다 `✓`. (4) trim 은 모듈 미지원이나 `CLIENT TRACKING` 활성 시 메인 스레드 active trimming 으로 폴백한다 — ASM 이후 지연 스파이크의 숨은 원인이다 `✓`.

**관측 지표가 ASM 중에 거짓말을 한다.** importing/trimming 진행 중 `KEYS`·`SCAN`·`RANDOMKEY`·`CLUSTER GETKEYSINSLOT`·`DBSIZE`·`CLUSTER COUNTKEYSINSLOT` 이 미소유 슬롯 키를 **필터링**하지만 `INFO KEYSPACE` 는 실제 키 수(import 중인 것 포함)를 보여준다 → 같은 순간 두 값이 불일치한다. Redis 8.4 릴리스노트는 `FT.SEARCH`/`FT.AGGREGATE`/`TS.MGET`/`TS.MRANGE` 등이 ASM 중 **부분 결과 또는 중복**을 낼 수 있다고 추가로 경고한다 `✓`.

### 6.4 성능 — 벤더 자체 측정임을 전제로

Redis 가 공개한 수치다. 측정 조건: 1000만 키 / 512B 값(약 5GB), write:read = 1:10, 500 커넥션, GCP `c4-standard-8`, **같은 존, 균등 키 분포** `Ⓥ`.

| 항목 | ASM | 레거시 |
|---|---|---|
| 3→4 shard scale-out | **6.4초**(shard 별 0.9 / 2.7 / 2.8초) | 192~219초 |
| 4→3 shard scale-in | **8.6초**(3.1 / 2.8 / 2.7초) | 〃 |
| 슬롯 처리율 | 640 slots/s | 21 slots/s (**약 30배 차**) |
| `-MOVED` 발생률 | 2.1/s | 최대 241.6/s (총량 최대 116배) |
| 최대 지연 스파이크 | 70ms 미만 | 127ms |
| cluster 메시지 | 212개 | 최대 5.4K개 |

이 수치는 **Redis Ltd 자체 벤치마크**이고 독립 검증 자료를 찾지 못했다 `Ⓥ`. 큰 값·존 간·hot slot 편중·모듈 사용 환경에서는 재현되지 않을 수 있다 `?`. 그럼에도 방향은 분명하다 — 리샤딩의 성격이 "수분~수십분짜리 위험 작업"에서 "수초짜리 일상 작업"으로 바뀌면, 오버프로비저닝 대신 실제 스케일링을 전제로 캐패시티 계획을 다시 짤 수 있다 `Σ`. 단 **"무중단"이 아니라 "매우 짧은 중단"** 이다 — handoff 순간에 해당 슬롯 쓰기를 실제로 정지하고, Redis 는 그 시간을 `write_pause_ms` 로 노출한다.

Valkey 9.1.0 이 ASM 후속으로 **실제로 넣은 것은 둘**이다 — `CLUSTER GETSLOTMIGRATIONS` 의 `remaining_repl_size` 필드(#3135)와 valkey-cli 의 ASM 경로 지원(#2755)(`valkey:RELEASENOTES-9.1.0.txt:115,129`) `✓`. 흔히 9.1 기능으로 같이 묶여 언급되는 **dual-channel atomic slot migration**(#2957, 스냅샷 채널을 자식 프로세스에서 target 으로 직접 write)과 `CLUSTER MIGRATESLOTS` 의 **AUTH/AUTH2 옵션**(#2392, #3538)은 2026-08-06 기준 **전부 open 이고 어떤 릴리스에도 들어가지 않았다**(`gh api repos/valkey-io/valkey/issues/{2957,2392,3538}` → 모두 `state: open`) `✓`. ASM 의 export 상태 기계에 `SLOT_EXPORT_SEND_AUTH`/`READ_AUTH_RESPONSE` 가 이미 9.0.0 부터 있으므로 내부 인증 단계 자체는 존재하고, 미해결인 것은 **운영자가 자격증명을 설정으로 넣는 경로**다 `✓`. `MIGRATE`/`CLUSTER SETSLOT` 기반 레거시 경로는 **제거되지 않았다** — ASM 은 opt-in 이고 기존 리샤딩 스크립트는 계속 동작한다 `✓`.

## 7. Sentinel vs Cluster

둘은 대체 관계가 아니라 축이 다르다. Redis 공식 문서가 Sentinel 을 스스로 "**High availability for non-clustered Redis**" 로 규정하고 4가지 역할을 명시한다 — Monitoring, Notification, Automatic failover, **Configuration provider**(클라이언트가 Sentinel 에 물어 현재 primary 주소를 얻는 서비스 디스커버리 권위) `✓`.

| | Sentinel | Cluster |
|---|---|---|
| 샤딩 | **하지 않는다** — 데이터셋 전체가 한 primary 에 들어가야 한다 | 16384 슬롯으로 샤딩 |
| 스케일 한계 | replica 읽기 분산까지 | 노드 추가로 메모리·처리량 확장 |
| 장애 판정 | SDOWN → ODOWN (`sentinel monitor … <quorum>` 의 quorum 은 **감지 전용**) | PFAIL → FAIL (슬롯 보유 primary 과반) |
| failover 실행 | **Sentinel 프로세스 과반의 투표로 리더를 뽑아야** 수행 | replica 가 cluster bus 로 자체 수행 |
| 별도 프로세스 | Sentinel 3대 이상 필요 | 없음 — Cluster 는 Sentinel 을 쓰지 않는다 |
| 애플리케이션 제약 | standalone 과 동일 (cross-slot·멀티 DB·`KEYS`·트랜잭션 자유) | §5 전부 |
| acked write 유실 | 비동기 복제라 가능 | **동일하게 가능** |

판정은 단순하다. 데이터가 한 노드에 들어가고 §5 의 자유도가 필요하면 **Sentinel**, 메모리·처리량이 한 노드를 넘거나 넘을 예정이면 **Cluster** 다 `Σ`. "Cluster 가 Sentinel 을 대체하는가"는 HA 기능 축에서는 그렇다. 하지만 **Sentinel 을 쓰던 앱을 Cluster 로 옮기는 것은 HA 방식 교체가 아니라 §5 의 데이터 모델 제약을 애플리케이션에 도입하는 일**이고, 그것이 이 마이그레이션의 실제 비용이다. 둘 다 비동기 복제라 acked write 유실 가능성은 그대로 남는다 — Sentinel 문서 원문: "Sentinel + Redis distributed system does not guarantee that acknowledged writes are retained during failures, since Redis uses asynchronous replication" `✓`.

Sentinel 은 죽은 기능이 아니다. Valkey 도 계속 유지·수정한다(9.1.1 에서 coordinated failover 중 Sentinel crash 수정, #4068, `valkey:RELEASENOTES-9.1.1.txt:32`) `✓`.

## 8. 클라이언트 라이브러리

`MOVED`/`ASK` 는 **RESP 에러 응답**이다(`addReplyErrorSds`). 프로토콜 레벨의 특별한 리다이렉트가 아니라 그냥 에러 문자열이다 `✓`. 그래서 비-cluster 클라이언트로 붙으면 다음이 순서대로 일어난다.

| 증상 | 원인 | 관측되는 모습 |
|---|---|---|
| 접속 노드가 소유하지 않은 모든 키 접근이 실패 | `MOVED …` 가 **애플리케이션 예외로 그대로 올라간다** — 자동 재시도가 없다 | 슬롯이 균등 분배된 3-shard 라면 대략 요청의 2/3 `≈` (산술 추정이며 실측이 아니다 `?`) |
| 리샤딩 중 전체 트래픽이 잘못된 노드로 | `MOVED`/`ASK` 를 구분하지 않아 `ASK` 로 **슬롯 맵을 오염**시킴 | 리샤딩이 끝난 뒤에도 잘못된 맵이 남는다 |
| 무한 왕복 | `ASK` 앞에 `ASKING` 을 보내지 않음 → target 은 `MOVED` 로 source 를 가리키고 source 는 다시 `ASK` | source↔target **핑퐁 루프** |
| 멀쩡한 `MGET` 이 죽는다 | 다중 키를 슬롯별로 쪼개지 않음 | `-CROSSSLOT` |
| `maxclients` 소진 | 커넥션 풀이 노드 수만큼 곱해짐 | 스케일아웃 직후 커넥션 고갈 |

따라서 **cluster 지원 클래스를 쓰는 것이 선택이 아니다.** 각 언어의 주요 클라이언트가 cluster 전용 진입점을 따로 두고 있고, 그 진입점이 슬롯 맵 캐시·`MOVED`/`ASK` 구분·`ASKING` 선행·다중 키 분해 재조립을 대신한다. **구체적 클래스명(redis-py `RedisCluster`, Jedis `JedisCluster`, Lettuce `RedisClusterClient`, ioredis `Cluster`, go-redis `ClusterClient`)은 이번 조사에서 각 라이브러리 문서로 검증하지 않았다** `?` — 실제 이름과 최소 버전은 쓰는 라이브러리의 현행 문서에서 확인해야 한다.

진영별 공식 클라이언트 정책은 확인됐다. Redis 는 6개를 공식으로 유지하고(Jedis, node-redis, redis-py, NRedisStack, go-redis, 그리고 나중에 합류한 Lettuce), Valkey 는 **valkey-glide** 를 공식 다국어 클라이언트로 밀고 있다 — Rust 코어(`glide-core`) + 언어 바인딩 구조다 `✓`. valkey.io 의 clients 페이지는 glide 외에 valkey-py / iovalkey / valkey-java / valkey-go / valkey-swift 를 "regularly tested and recommended" 로, redisson·phpredis·predis 를 커뮤니티로 분류한다 `✓`. **glide 의 언어별 버전 숫자와 언어별 cluster 기능 격차(예: `CLUSTERSCAN` 지원 여부)는 확인하지 못했다** `?`.

## 9. 운영 지표

`CLUSTER INFO` 가 노출하는 필드 전량(Valkey 9.1.0 `genClusterInfoString` 기준): `cluster_state`, `cluster_slots_assigned`, `cluster_slots_ok`, `cluster_slots_pfail`, `cluster_slots_fail`, `cluster_nodes_pfail`, `cluster_nodes_fail`, `cluster_voting_nodes_pfail`, `cluster_voting_nodes_fail`, `cluster_known_nodes`, `cluster_size`, `cluster_current_epoch`, `cluster_my_epoch`, 메시지 타입별 `cluster_stats_messages_<type>_sent/received`, `cluster_stats_bytes_sent/received`, `cluster_stats_pubsub_bytes_sent/received`, `cluster_stats_module_bytes_sent/received`, `total_cluster_links_buffer_limit_exceeded`(`valkey 9.1.0:src/cluster_legacy.c:7325-7415`) `✓`.

**`cluster_state:ok` 를 단독으로 알럿에 걸면 안 된다.** `clusterUpdateState()` 는 OK 를 가정하고 두 조건에서만 FAIL 로 내린다.

```c
new_state = CLUSTER_OK;
if (server.cluster_require_full_coverage) {          /* ← 꺼져 있으면 커버리지 검사 자체를 안 한다 */
    for (j = 0; j < CLUSTER_SLOTS; j++) {
        if (server.cluster->slots[j] == NULL || server.cluster->slots[j]->flags & (CLUSTER_NODE_FAIL)) {
            new_state = CLUSTER_FAIL; new_reason = CLUSTER_FAIL_NOT_FULL_COVERAGE; break; } } }
...
int needed_quorum = (server.cluster->size / 2) + 1;
if (reachable_primaries < needed_quorum) { new_state = CLUSTER_FAIL; new_reason = CLUSTER_FAIL_MINORITY_PARTITION; }
```

`valkey 9.1.0:src/cluster_legacy.c:6606-6680` `✓`. 구멍은 세 군데서 난다. (1) `cluster-require-full-coverage no` 면 슬롯이 비어 있어도 state 는 `ok` 이고 그 슬롯 요청만 `-CLUSTERDOWN Hash slot not served` 로 실패한다 — 그리고 `getNodeByQuery()` 는 이 검사를 healthy 검사보다 **먼저** 한다("This check is done early to preserve historical behavior"). (2) 커버리지 검사가 `CLUSTER_NODE_FAIL` 만 보고 **PFAIL 은 보지 않는다** → `cluster_slots_pfail > 0` 인데 `cluster_state:ok` 가 정상 출력이다. (3) `reachable_primaries` 는 **그 노드의 로컬 gossip 시야**로 계산된다 — 파티션 양쪽이 서로 다른 답을 낸다.

알럿은 조합으로 걸고 **모든 노드에서 수집해 불일치를 잡는다** `Σ`.

| 지표 | 기대값 | 어긋나면 |
|---|---|---|
| `cluster_slots_ok` | `16384` | 슬롯 공백 또는 소유 노드 장애 |
| `cluster_slots_pfail` · `cluster_slots_fail` | `0` | `cluster_state` 가 아직 `ok` 여도 장애 진행 중 |
| `cluster_voting_nodes_pfail` · `_fail` | `0` | **정족수에 실제로 영향을 주는 수치** — Valkey 9.0.0 이 `cluster_nodes_pfail`/`_fail` 과 함께 신설(#1910). 8.x 에는 없으므로 알럿을 옮길 때 확인해야 한다 |
| `cluster_size` | 기대 shard 수 | 다르면 **슬롯 없는 primary 가 생겨 정족수가 흔들린다** |
| `cluster_current_epoch` | 정상 상태에서 정지 | 계속 오르면 failover·설정 경합 반복 |
| `total_cluster_links_buffer_limit_exceeded` | `0` | `cluster-link-sendbuf-limit` 에 걸려 링크가 끊긴 것 — 대량 pub/sub 브로드캐스트가 흔한 원인(§5) |

토폴로지 조회 커맨드는 **deprecation 상태가 진영별로 반대다.** Redis 는 7.0.0 에서 `CLUSTER SLOTS` 를 deprecate 하고 `CLUSTER SHARDS` 로 대체했으며 **8.10.0 에도 여전히 deprecated** 다(`redis 8.10.0:src/commands/cluster-slots.json` 의 `"deprecated_since": "7.0.0"`, `"replaced_by": "CLUSTER SHARDS"`). Valkey 는 7.2.4 까지 deprecated 였다가 **8.0.0 에서 un-deprecate**(#536)하고 9.1.0 에 `availability-zone` 필드까지 추가했다(`valkey 8.0.0`/`9.1.0:src/commands/cluster-slots.json` 에 deprecated 표기 없음) `✓`. 즉 "`CLUSTER SLOTS` 는 쓰지 말아야 한다"는 조언은 Valkey 에서 틀리다.

hot slot 탐지는 `CLUSTER SLOT-STATS` 다 — `KEY-COUNT`/`CPU-USEC`/`NETWORK-BYTES-IN`/`OUT`, Redis 8.4+ 는 `MEMORY-BYTES` 추가. Valkey 8.0.0(#20, #351)이 먼저이고 Redis 는 8.2.0 이다(`redis 8.2.0:src/commands/cluster-slot-stats.json` 의 `"since": "8.2.0"`) `✓`. Redis 8.6 은 `cluster-slot-stats-enabled` 로 수집 항목을 제어한다(#14719).

**리샤딩 중에 추가로 볼 것**은 방식별로 다르다.

| 방식 | 보는 것 |
|---|---|
| 레거시 | `CLUSTER COUNTKEYSINSLOT <slot>` 이 0 으로 수렴하는지, `CLUSTER NODES` 에 `[slot-><-node]`/`[slot->-node]` 표기가 남아 있지 않은지 |
| ASM · Valkey | `CLUSTER GETSLOTMIGRATIONS` 의 `state`/`message`, 9.1.0 에 추가된 `remaining_repl_size`(#3135) |
| ASM · Redis | `CLUSTER MIGRATION STATUS ALL` 의 `state`·`last_error`·`retries`·**`write_pause_ms`** — `write_pause_ms` 가 핵심 SLO 지표다(handoff 동안 실제로 쓰기가 멈춘 시간) |

cluster bus 부하 자체는 Valkey 9.1.0 이 바이트 단위 지표를 추가했고(#3396), `mem_cluster_links` 와 `total_cluster_links_buffer_limit_exceeded`(Redis 7.0, #9774)가 링크 버퍼 압박 신호다 `✓`. ASM 도입 후에는 `write_pause_ms` 와 trim 지연을 **새 SLO 항목으로 넣는다** — §6.3 의 trim 구간이 "완료" 이후에도 에러를 내는 구간이기 때문이다 `Σ`.

## 10. 근거

**로컬 클론 소스** (`~/evejuni/{redis,valkey}`, blobless·no-checkout 이라 `git show <tag>:<path>` 로만 읽음)

- 리다이렉트·슬롯 판정: `valkey 9.1.0:src/cluster.c:58-77`(keyHashSlot), `:982-1001`(clusterSlotByCommand), `:1049-1306`(getNodeByQuery), `:1071-1084`(MULTI/EXEC 검증), `:1090-1092`(NO_KEYS 로컬 처리), `:1096-1101`(full-coverage 선검사), `:1268-1290`(ASK/TRYAGAIN), `:1302-1305`(MOVED base case), `:1308-1336`(clusterRedirectClient), `:1593-1600`(askingCommand), `:1738-1822`(clusterscanCommand); `redis 8.10.0:src/cluster.c:1498-1526`, `:1521-1522`; `redis 3.0.0:src/cluster.c`(keyHashSlot·RESTORE-ASKING)
- 상수·wire format: `valkey 9.1.0:src/cluster.h:9-10`, `:21-29`; `redis 8.10.0:src/cluster.h:32-40`(`CLUSTER_REDIR_TRIMMING`); `valkey 9.1.0:src/cluster_legacy.h:285`, `:303-322`(static_assert 블록)
- gossip·failover·상태: `valkey 9.1.0:src/cluster_legacy.c:878-880`, `:1500`, `:1554`(cluster port), `:2582-2605`·`:6650-6665`(markNodeAsFailingIfNeeded), `:5195-5230`(clusterPropagatePublish), `:6606-6680`(clusterUpdateState), `:7325-7415`(genClusterInfoString — `cluster_voting_nodes_pfail`/`_fail` 은 `:7367-7370`); `valkey 9.0.0:src/cluster_legacy.c:7002-7005`(그 네 필드의 최초 등장 — `valkey 8.0.0:src/cluster_legacy.c` 에는 `cluster_slots_pfail` 만 있다)
- pub/sub: `valkey 9.1.0:src/pubsub.c:288-327`
- 스크립트: `redis 8.10.0:src/script.c:502-556`; `valkey 9.1.0:src/script.c:237-239`, `:340-343`
- ASM: `valkey 9.1.0:design-docs/atomic-slot-migration.md`(§3.1 시퀀스, §3.2 와이어, §3.3 롤백, §3.4.1 RDB opcode), `:src/cluster_migrateslots.c:15-41`·`:1050-1110`; `valkey 9.1.1:src/cluster_migrateslots.c:507-510`, `:src/commands/cluster-migrateslots.json`, `:src/config.c:3457`·`:3490`, `:src/valkey-cli.c:2800`·`:4689`; `redis 8.10.0:src/cluster_asm.c:9-42`·`:901-903`·`:925-1000`·`:958-990`, `:src/config.c:3433`·`:3465`·`:3466`·`:3467`
- 모듈 게이트: `valkey 9.1.1:src/valkeymodule.h:343`, `:src/module.c:2631-2640`·`:7624-7638`·`:13754`
- 설정 기본값: `valkey 9.1.0:src/config.c:3282`(require-full-coverage 1), `:3287`(replica-no-failover 0), `:3323-3328`·`:3404-3406`(announce 계열), `:3376-3377`(databases/cluster-databases), `:3449`(node-timeout 15000); `redis 8.10.0:src/config.c:3310`, `:3394`(cluster-databases 부재)
- kvstore: `redis 7.4.0:src/kvstore.c:1-10`; `valkey 8.0.0:src/kvstore.c:1-11`; `valkey 7.2.4:src/server.h:967-977`(포크 기점엔 단일 `dict *dict`)
- 커맨드 메타: `redis 8.10.0:src/commands/cluster-slots.json`; `valkey 8.0.0`/`9.1.0`/`7.2.4:src/commands/cluster-slots.json`; `redis 8.2.0:src/commands/cluster-slot-stats.json`

**릴리스노트**

`redis:RELEASENOTES-3.0.0.txt:19,27,273` · `redis 2.6.0:00-RELEASENOTES:180-183` · `redis:RELEASENOTES-4.0.0.txt:51-57`(cluster bus 비호환) · `redis:RELEASENOTES-7.0.0.txt:48,115,316,326,343,363,364,495,500,502,514` · `redis:RELEASENOTES-8.4.0.txt:33,71,104,148` · `redis:RELEASENOTES-8.6.0.txt:72,126,127,132,134` · `redis:RELEASENOTES-8.8.0.txt:291,315,316` · `redis:RELEASENOTES-8.10.0.txt:173,180,245` · `valkey:RELEASENOTES-8.0.0.txt:124,141,204,220,223,224,307,361` · `valkey:RELEASENOTES-8.1.0.txt:41,156,159,160` · `valkey:RELEASENOTES-9.0.0.txt:48,112,118,130,151,152,153` · `valkey:RELEASENOTES-9.1.0.txt:26,46,55,83,87,89,115,129` · `valkey:RELEASENOTES-9.1.1.txt:28,32,35,45`

**웹 1차 출처** (URL 은 [99 · 출처]({{< relref "../99-sources.md" >}}) 가 모은다)

- antirez 의 16384 설명 — `redis/redis` issue #2576 코멘트, 2015-05-12T12:23:35Z (`gh api repos/redis/redis/issues/2576/comments` 로 취득)
- Redis ASM 블로그(2026-04-02) — 레거시 6개 문제 목록, 7단계 절차, 성능 수치. **벤더 자체 측정** `Ⓥ`
- `CLUSTER MIGRATION` 커맨드 문서 — `"since": "8.4.0"`, ASM 중 키 가시성, Redis Software/Cloud 미지원 표
- `CLUSTER MIGRATESLOTS` 커맨드 문서 — since 9.0.0, `alldbs` ACL 요구
- Redis Sentinel 문서 — "High availability for non-clustered Redis", 4역할, quorum 의 감지 전용 성격, 비동기 복제 경고
- valkey.io clients 페이지 · `valkey-io/valkey-glide` · Redis 공식 클라이언트 발표 2건
- `gh api repos/twitter/twemproxy`, `gh api repos/CodisLabs/codis` (2026-08-06 조회) — 마지막 push 2024-03-29 / 2024-04-15, 양쪽 `archived: false`
- Valkey ASM 후속 항목의 미출시 확인 — `gh api repos/valkey-io/valkey/issues/{2957,2392,3538}` (2026-08-06 조회) 전부 `state: open`, milestone 없음. 반면 `issues/2755`(valkey-cli ASM) 는 `closed_at: 2025-12-22Z` 로 9.1.0 에 실렸다 `✓`
- Valkey 모듈 ASM opt-in 실측 — `valkey-io/{valkey-search,valkey-json,valkey-bloom,valkey-ldap}` 를 `--depth 1` 클론해 `grep -rn 'ATOMIC_SLOT_MIGRATION'` → 전부 0건. 교차 확인 `gh api "search/code?q=…"` 도 0건. 업스트림도 인지 상태(valkey-ldap #73, valkey-search #473, valkey-json #84 open) `✓`

**미확인으로 남긴 것** — 클라이언트 라이브러리의 정확한 cluster 클래스명과 최소 버전 `?` · valkey-glide 의 언어별 버전과 cluster 기능 격차 `?` · 비-cluster 클라이언트의 실패 비율(2/3 은 균등 분배 가정의 산술 추정) `?` · Redis ASM 벤치마크의 독립 재현 `?` · antirez 가 말한 "other design tradeoffs" 의 내용 `?` · `CLUSTER SYNCSLOTS` 페이로드의 두 진영 wire 호환성(혼합 클러스터는 애초에 지원 대상이 아니다) `?` · `cluster-databases` 를 1보다 올렸을 때의 실제 메모리·순회 비용 `?` · 프록시 대안(Envoy Redis proxy 등)이 흡수해주는 제약 범위 `?`

