---
title: "복제·멀티마스터·failover — 승격 없는 다중 마스터 복구 모델"
date: 2026-08-01
weight: 6
---

# 복제·멀티마스터·failover — 승격 없는 다중 마스터 복구 모델

HyperDX 스택의 self-host ClickHouse는 `ReplicatedMergeTree`(RMT)가 강제됩니다. 그 복제 모델은 PostgreSQL·MySQL의 primary-replica와 아예 다릅니다 — 멀티마스터입니다. 이 차이가 우리 운영에서 무엇을 바꾸는지, 특히 "노드 하나가 죽으면 무슨 일이 벌어지나"와 "RF2에서 노드 작업이 안전한가"에 답하려고 이 페이지를 씁니다.

이 페이지는 이미 다른 문서가 깊게 다룬 것을 반복하지 않습니다. 다운타임 시나리오의 물리 역학·EBS 재부착 절차는 [operator 토폴로지·다운타임]({{< relref "04-operator-topology-downtime.md" >}})(S1~S9)이, Keeper 자체(NuRaft·정족수 산술·"큐가 아니다"·async_insert)는 [Keeper]({{< relref "05-keeper.md" >}})가, 재수화 위험 창·zero-copy 금지는 [스토리지·로컬 NVMe]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})가, `insert_quorum` 주입 위치·RF2/RF3 산술은 [배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})이, 스케일·롤링 업그레이드는 [operator 운영]({{< relref "../../clickhouse/05-altinity-operations.md" >}})이 기준 문서입니다. 여기서는 그 내용을 링크로 위임하고 복제 메커니즘 자체와 멀티마스터 데이터 모델, 승격 없는 failover 의미론 한 축만 본문으로 씁니다.

{{< callout type="info" >}}
- 멀티마스터입니다. 모든 replica가 INSERT를 수용하고 단일 primary/leader가 없습니다. 그래서 replica 하나가 죽어도 "승격(promotion) failover" 절차 자체가 없습니다 — 살아있는 replica가 read+write를 그대로 계속합니다 `✓`.
- Keeper는 복제를 조율할 뿐 데이터를 저장하지 않습니다. 복제 로그·part 참조·블록 dedup 체크섬만 담고 part 바이트는 replica끼리 직접 fetch합니다. SELECT은 Keeper를 아예 타지 않습니다 `✓`.
- Keeper 정족수를 잃으면 테이블이 read-only로 전락합니다(INSERT/DDL 거부, SELECT은 계속). 데이터 노드가 전부 멀쩡해도 조정 계층 과반을 잃는 것만으로 쓰기가 멈춥니다 — 이 아키텍처의 진짜 SPOF입니다 `✓`.
- RF2에 anti-affinity(hostname)·topologySpread(AZ)·PDB(maxUnavailable 1)를 걸면 consolidation·노드 작업이 안전합니다. 한 번에 한 replica만 내려갑니다. EBS라 재수화(로컬 NVMe면 수 시간) 대신 reattach로 끝나 실질 RF1 창이 수 분입니다. 2차 하드웨어 장애까지 견디려면 RF3, 창 발생 빈도를 줄이려면 LTS 고정입니다.
{{< /callout >}}

## ReplicatedMergeTree 복제 구조

### 각 replica = 완전한 사본, part 단위 복제

RMT 복제의 단위는 shard 안의 replica입니다. 같은 shard의 replica들은 각자 완전한 데이터 사본을 자기 로컬 디스크(우리 전제로는 EBS 볼륨)에 보유합니다 — shared-nothing입니다 `✓`. 스토리지를 공유하지 않고 replica마다 사본이 물리적으로 독립돼 있으므로, S3 cold 티어에서도 데이터가 RF만큼 중복 저장됩니다(티어링≠내구성의 근거는 [스토리지·로컬 NVMe]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})로 위임).

복제는 테이블(엔진) 레벨에서 선언합니다. 첫 인자가 shard별로 유일한 Keeper znode 경로, 둘째가 replica 식별자입니다 `✓`.

```sql
CREATE TABLE otel_logs (...)
ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/{table}', '{replica}')
ORDER BY (...);
-- {shard}/{replica}는 operator가 host별 macros로 자동 렌더 → 수동 config.d 불필요
```

정정할 게 하나 있습니다. RMT 복제는 PostgreSQL WAL·MySQL binlog처럼 row/statement 스트림을 흘리지 않고 data part 단위로 동작합니다 `✓`. INSERT는 로컬에서 즉시 하나의 part로 굳습니다. 그 part의 존재·이름·블록번호·체크섬만 Keeper 로그에 등록되고, 다른 replica가 그 로그를 보고 part 바이트를 sibling에서 직접 당겨옵니다. 공식 복제 문서 원문 `✓`:

> *"During replication, only the source data to insert is transferred over the network. Further data transformation (merging) is coordinated and performed on all the replicas in the same way."*

INSERT로 들어온 원천 데이터만 네트워크로 오가고 머지(part 재조합)는 각 replica가 동일한 방식으로 독립 수행합니다 — 머지 결과 part를 통째로 다시 복제하지 않습니다.

### 동기화 메커니즘 — /log → replication_queue → 실행 (pull 모델)

각 replica는 스스로 다음 루프를 돕니다. 쓰기를 받은 replica가 다른 replica로 push하지 않고 각 replica가 공용 `/log`를 보고 스스로 당겨오는 pull 모델입니다 `✓`. 그래서 잠깐 offline이던 replica가 돌아오면 자기 `log_pointer` 이후 밀린 엔트리만 이어 소비하면 됩니다(catch-up).

{{< flow src="_flow/동기화-메커니즘-log-replication.json" />}}

`system.replication_queue.type`의 주요 enum `✓`:

| type | 의미 |
|---|---|
| `GET_PART` | 다른 replica에서 part를 가져와라(INSERT 복제의 기본) |
| `MERGE_PARTS` | 지정 part들을 머지해 새 part 생성 |
| `MUTATE_PART` | part에 mutation(ALTER UPDATE/DELETE) 적용 |
| `DROP_RANGE` / `REPLACE_RANGE` | 파티션/범위 삭제·교체 |
| `ATTACH_PART` / `CLEAR_COLUMN` / `CLEAR_INDEX` / `ALTER_METADATA` | attach·컬럼/인덱스 제거·스키마 변경 |

### 진단 — system.replicas / system.replication_queue

lag과 이상 징후는 이 두 테이블로 봅니다 `✓`. 멀티마스터라 "primary lag" 개념이 없고 replica별 로그 소비 진행도(`log_pointer` vs `log_max_index`)와 `absolute_delay`(초)로 뒤처짐을 잽니다.

| 컬럼(`system.replicas`) | 의미 |
|---|---|
| `is_readonly` | **read-only 여부** — Keeper 연결·정족수 문제 시 켜짐(§중단과 failover) |
| `absolute_delay`(정밀 정의는 버전 확인 권장) | 복제 지연(초) — 가장 앞선 replica 대비 이 replica가 얼마나 뒤졌나 `✓` |
| `log_max_index` / `log_pointer` | `/log` 최대 엔트리 번호 / 소비 위치. `log_pointer` ≪ `log_max_index`면 못 따라가는 중 |
| `queue_size` / `inserts_in_queue` / `merges_in_queue` | 대기 작업 총수·유형별 |
| `total_replicas` / `active_replicas` | 전체 / Keeper 세션 보유(활성) replica 수 |
| `is_leader` / `can_become_leader` | 머지 할당자 여부(primary 아님, §멀티마스터) |

```sql
-- 지연·read-only·큐 적체 한눈에
SELECT database, table, is_readonly, absolute_delay,
       queue_size, log_pointer, log_max_index,
       (log_max_index - log_pointer) AS behind
FROM system.replicas
WHERE absolute_delay > 60 OR is_readonly OR (log_max_index - log_pointer) > 100;

-- 막힌 큐 엔트리(num_tries↑·오래된 create_time = 적체)
SELECT database, table, replica_name, type, num_tries, num_postponed,
       postpone_reason, last_exception, create_time
FROM system.replication_queue
WHERE num_tries > 10 OR create_time < now() - INTERVAL 1 HOUR
ORDER BY create_time;
```

복구 명령 `✓`: `SYSTEM SYNC REPLICA db.table`(현재 `/log`의 모든 엔트리를 소비할 때까지 블록), `SYSTEM RESTART REPLICA`(Keeper 상태 재초기화 — 큐 이상 시 Altinity KB가 *"simplest approach"*로 제시), `SYSTEM RESTORE REPLICA`(Keeper 메타 소실 시 로컬 part로 복구), `SYSTEM DROP REPLICA 'name'`(죽은 replica의 stale 등록 정리 — 활성 replica엔 금지). (`SYSTEM SYNC REPLICA`의 LIGHTWEIGHT/STRICT/PULL 모드는 버전 의존이라 도입 CH 버전 문서로 재확인 `?`. operator scale-in의 DROP REPLICA 리드는 [operator 운영]({{< relref "../../clickhouse/05-altinity-operations.md" >}})로 위임.)

## 멀티마스터 — 단일 리더가 없다

### 모든 replica가 INSERT를 수용한다

공식 복제 문서 원문 `✓`:

> *"Replication is asynchronous and multi-master. `INSERT` queries (as well as `ALTER`) can be sent to any available server."*

RMT는 비동기·멀티마스터입니다. INSERT도 ALTER도 아무 살아있는 서버(replica)로나 보낼 수 있습니다. 어느 replica가 받든 ① 자기 로컬 디스크에 part로 쓰고 ② Keeper `/log`에 `GET_PART` 엔트리 + 블록번호 + dedup 체크섬을 등록하고 ③ 다른 replica들이 그 로그를 보고 fetch합니다. "어느 노드가 primary인가"라는 질문 자체가 없습니다 — failover가 단순한 근본 이유입니다.

### "leader"는 20.6에서 제거된 레거시 개념

가장 흔한 오해: "replica 중 하나가 leader이고, 걔가 죽으면 leader election으로 새 leader를 뽑는다." 틀렸습니다. `system.replicas`에 `is_leader`/`can_become_leader` 컬럼이 남아 오해를 부릅니다. 여기서 leader는 primary를 가리키지 않고 "머지/뮤테이션 할당자"를 뜻하며, 20.6부터는 여러 replica가 함께 leader가 될 수 있습니다 `✓`.

{{% details title="leader election 제거 역사 — 1차 소스(issue #10367·PR #11639·#11795)" closed="true" %}}
- issue #10367 — *"Get rid of leader election in ReplicatedMergeTree tables"*.
- PR #11639 — *"Remove leader election, step 2: allow multiple leaders"*. 원문 취지는 과거 단일 leader만 하던 merge/mutation/partition drop·move·replace 할당을 여러 replica가 함께 하도록 바꾼 것입니다(20.6부터 multiple leaders).
- PR #11795 — *"...step 3: remove yielding of leadership; remove sending queries to leader"*(leader에게 쿼리를 몰아주던 잔재까지 제거).

leader가 (과거에) 하던 일은 머지·뮤테이션·파티션 조작 할당뿐이고 데이터 쓰기는 원래부터 아무 replica나 받았습니다. `can_become_leader`는 `replicated_can_become_leader` 설정으로 특정 replica(예: 사양 낮은 노드)를 머지 할당에서 빼는 용도로 여전히 유효합니다 `✓`. 함정 하나. 모든 replica가 `is_leader=0`이면 머지 스케줄링이 정지합니다. failover와는 무관한 조정 이상 징후입니다 `✓`.
{{% /details %}}

{{< callout type="error" >}}
정정. ClickHouse RMT에는 "쓰기를 받는 primary"가 없습니다. `is_leader`는 primary 표시가 아니라 머지/뮤테이션 할당 참여 여부입니다. 20.6+부터는 여러 replica가 함께 leader입니다. leader가 죽어도 "승격" 절차가 필요 없습니다 — 살아있는 다른 replica가 이미 leader이거나 leader가 될 수 있고 어차피 INSERT는 아무 replica나 받습니다. 우리 배포(24.8 LTS)에서 `SELECT is_leader FROM system.replicas`로 여러 개가 1인지 배포 후 1회 실측 확인은 권장 `?`.
{{< /callout >}}

### 3자 비교 — 쓰기 토폴로지와 자동 failover

이 표의 축은 [Keeper]({{< relref "05-keeper.md" >}})의 "durable queue인가"(Kafka vs ZK vs Keeper) 축과 다릅니다. 여기선 "쓰기 수용 노드·자동 failover 필요 여부·조율 주체"만 봅니다.

| 축 | **전통 primary-replica**(PostgreSQL / MySQL) | **Kafka**(파티션 리더) | **ClickHouse RMT** |
|---|---|---|---|
| 쓰기 수용 노드 | **primary 1개만** | 파티션당 **leader 1개** | **모든 replica**(멀티마스터) `✓` |
| 복제 방향·단위 | primary→standby(WAL/binlog)¹ | leader→follower(ISR) | **양방향 pull**, `/log` 소비 — **part 단위** `✓` |
| 자동 failover 필요? | **필요** — standby→primary promote | **필요** — 새 파티션 leader election | **불필요** — 승격 개념 없음 `✓` |
| failover 오케스트레이터 | Patroni·repmgr·Orchestrator 등 **외부** | 브로커 내장 | **없음**(살아있는 replica가 계속) `✓` |
| 조율 주체 | 없음(또는 외부 합의) | KRaft/ZooKeeper | **Keeper**(복제 로그·dedup) — 파티션 leader election 없음 `✓` |
| split-brain 방지 | fencing/STONITH·외부 합의 | 컨트롤러 합의 | **Keeper Raft 정족수 = 단일 진실원**, 소수파 쓰기 불가 `✓` |
| 쓰기 라우팅 | 클라가 **primary 주소** 인지 필요 | 프로듀서가 파티션 leader로 | **아무 replica**(라우터가 dead만 회피) `✓` |

¹ PostgreSQL/MySQL의 복제 단위는 row 또는 statement 방식(엔진·설정에 따라 다름).

명제는 이렇습니다 `✓`. RMT가 "자동 failover 컨트롤러가 필요 없다"는 맞지만 그 이유는 "장애를 자동 감지해 승격하기 때문"이 아닙니다. 애초에 승격할 primary가 없어서 살아있는 replica가 그냥 계속 일하는 것입니다. ClickHouse에서 failover는 "라우팅 회피" 문제로 좁혀집니다.

## ZooKeeper/Keeper의 복제 역할

Keeper znode 전체 인벤토리와 "Keeper는 durable queue가 아니다"(CH가 죽어도 in-flight INSERT는 큐잉되지 않는다)는 정정은 [Keeper]({{< relref "05-keeper.md" >}})가 기준 문서입니다. 여기서는 그 경로들이 복제를 어떻게 구동하는가(role)만 짚습니다(경로는 05-keeper 표와 정합) `✓`.

| znode(shard별 `/clickhouse/tables/{shard}/{table}/…`) | 복제에서의 역할 |
|---|---|
| `/log` | **복제 로그(공용)** — 모든 replica가 공유하는 "무슨 일이 일어났나"의 단일 순서열. 복제의 심장 |
| `/replicas/{r}/queue` | replica별 실행 큐 — `/log`에서 복사해 온, 아직 실행 안 한 작업 |
| `/replicas/{r}` | replica 등록·liveness(ephemeral `is_active`)·`log_pointer` |
| `/blocks/<hash>` | **INSERT 블록 dedup 체크섬** — 재시도 멱등의 근거(아래) |
| `/block_numbers`, `/parts` | 블록번호 배정·존재하는 part 목록 |
| `/mutations/<id>` | mutation 지시(ALTER UPDATE/DELETE) — replica들이 `MUTATE_PART`로 소비 |

확실히 해 둡니다 `✓`:

- 데이터(part 바이트)는 Keeper에 없습니다. Keeper는 "누가 무엇을 가졌나"의 포인터·지시만 갖고 실제 바이트는 replica끼리 직접 fetch합니다. insert_quorum 조율도 Keeper의 quorum znode를 통하지만 여기 흐르는 것도 조정 상태지 사용자 데이터가 아닙니다.
- SELECT은 Keeper를 타지 않습니다(*"ZooKeeper is not used in SELECT queries"*). Keeper는 쓰기·조정 경로의 SPOF입니다. 읽기 병목은 아닙니다. 그래서 정족수를 잃어도 읽기는 살아 있습니다(§중단과 failover).

dedup의 복제 역할 `✓`. 각 INSERT 블록의 해시가 `/blocks/<hash>`(파티션별)에 저장돼, 같은 크기·같은 행·같은 순서의 블록이 다시 오면 한 번만 씁니다. 이 체크섬이 공용 Keeper에 있으므로 INSERT를 어느 replica로 재시도해도 dedup이 성립합니다 — primary가 없어도 재시도 안전성(at-least-once → 사실상 exactly-once)이 유지되는 이유입니다. dedup window 기본값(1000블록/7일)·`async_insert_deduplicate`·`insert_deduplication_token`은 [Keeper]({{< relref "05-keeper.md" >}})가 기준 문서입니다.

## 중단과 failover

### 승격 절차가 없다

멀티마스터라 replica 하나가 죽어도 primary 승격이나 클러스터 재구성이 없습니다 `✓`. 살아있는 replica가 read와 write를 모두 그대로 계속합니다. 죽은 replica가 복구되면 자기 `log_pointer` 이후 밀린 엔트리를 catch-up으로 소비합니다. EBS 전제에선 볼륨이 reattach돼 기존 part가 남아 델타만 catch-up합니다 — 재수화 아님·reattach 역학 상세는 [operator 토폴로지·다운타임]({{< relref "04-operator-topology-downtime.md" >}}) S1~S9(reattach+part-load 실소요와 델타 catch-up 실 fetch량은 아직 `?`, staging 실측).

"failover 절차 없음"이 "아무것도 안 해도 된다"는 뜻은 아닙니다. 단서가 붙습니다 `✓`: ① 클라이언트 라우팅은 누군가 해야 하고(아래), ② 쓰기는 Keeper 정족수에 묶이며(아래), ③ 기본 async 쓰기는 ack 직후 그 replica가 죽으면 미복제 part를 잃을 수 있습니다(insert_quorum으로 좁힘).

### 클라이언트 라우팅 — 죽은 replica 회피

failover가 "승격 없음"이어도 클라이언트가 죽은 replica를 안 때리게 하는 라우팅은 필요합니다.

- ClickHouse Distributed 테이블 / `remote_servers`: `load_balancing`(`random`(기본)·`nearest_hostname`·`in_order`·`first_or_random`·`round_robin`)으로 살아있는 replica를 고르고 연결 실패 시 짧은 타임아웃으로 다음 replica를 시도합니다(native connection failover) `✓`. 단 우리는 1 shard라 데이터 분산용 Distributed는 사실상 불필요합니다 `≈`.
- 외부 프록시: HTTP(8123)는 chproxy·HAProxy·nginx 모두 가능하고 chproxy가 CH 특화입니다. native TCP(9000)는 프록시가 프로토콜을 몰라 한 연결을 여러 서버로 못 쪼개므로 연결 회전·`idle_connection_timeout`·Distributed 프록시 중 하나가 필요합니다 `✓`.
- Kubernetes Service / HyperDX CH endpoint(우리 기본): HyperDX는 operator가 만든 cluster Service(ClusterIP, http 8123 / tcp 9000)로 붙고 readiness probe(`/ping`)가 죽은 replica를 엔드포인트에서 뺍니다 `≈`. 이게 사실상 K8s 레벨 failover 라우팅입니다. Service readiness 기반 replica 제거 타이밍·native 연결 지속성과의 상호작용은 배포 후 `kubectl get endpoints`로 실측 `?`.

### 시나리오별 가용성 (failover 라우팅 관점)

다운타임의 물리 역학·복구 절차는 [operator 토폴로지·다운타임]({{< relref "04-operator-topology-downtime.md" >}})(S1~S9)가 기준 문서입니다. 여기선 read/write 가용성과 라우팅 관점만 압축합니다. 전제는 1 shard × RF2(2 AZ) + CHK 3노드(3 AZ), 기본 async 쓰기입니다.

| 시나리오 | 읽기 | 쓰기 | failover 라우팅 | 상세 |
|---|---|---|---|---|
| **replica 1대 소실** | 무중단 | 무중단(async, 남은 replica가 수용) | LB/Service가 죽은 replica 제거 | [04]({{< relref "04-operator-topology-downtime.md" >}}) S4~S7 |
| **EBS reattach 복귀** | 복귀 replica는 startup 후 재합류 | 무중단 | 복귀까지 해당 replica만 offline | [04]({{< relref "04-operator-topology-downtime.md" >}})·[../clickhouse/02]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}}) |
| **AZ 1개 장애** | 다른 AZ replica가 서빙 | 다른 AZ replica로 무중단 | topologySpread 전제로 cross-AZ replica 존재 | [04]({{< relref "04-operator-topology-downtime.md" >}}) S8 |
| **Keeper 정족수 상실** | **로컬 part read OK** | **INSERT/DDL 거부(read-only 전락)** | 라우팅 무관, 쓰기 정지 | [05-keeper]({{< relref "05-keeper.md" >}})·[ch/04]({{< relref "../../clickhouse/04-deployment-playbook.md" >}}) |

EBS 함의(상세 04) `✓`. replica 소실은 EBS에선 전량 재수화가 아니라 reattach + 델타 catch-up입니다(수 분 vs 수 시간 대비는 이 문서 서두와 상세 04). AZ 장애는 다릅니다. EBS가 AZ-bound라 볼륨을 다른 AZ로 못 옮기므로 cross-AZ replica(복제)만이 유일 방어입니다 — 여기서는 EBS·로컬 NVMe 처방이 수렴합니다.

### Keeper 정족수 상실 = 진짜 SPOF (read-only 전락)

"자동 failover 불필요"가 유일하게 깨지는 대목입니다 `✓`. Keeper 과반을 잃으면(3노드 중 2) 데이터 replica가 전부 멀쩡해도:

- SELECT은 계속됩니다 — 로컬 part 읽기에 Keeper가 필요 없습니다.
- INSERT/DDL/머지/뮤테이션은 정지합니다 — `TABLE_IS_READ_ONLY`(에러 코드 242, *"Table is in readonly mode (zookeeper path: …)"*). part 등록·블록번호 배정·복제 로그 기록이 전부 Keeper 쓰기를 요구하므로 쓰기 경로가 통째로 멈춥니다. `system.replicas.is_readonly=1`로 드러납니다.
- 정족수 없이 쓰기를 허용하면 일관성을 보장할 수 없으므로 일부러 막는 보호 장치입니다.

정족수 산술은 [Keeper]({{< relref "05-keeper.md" >}})·[operator 토폴로지·다운타임]({{< relref "04-operator-topology-downtime.md" >}})(S9)과 [배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})이, 복구 런북은 [Altinity operator 운영]({{< relref "../../clickhouse/05-altinity-operations.md" >}})이 소유합니다(정족수 상실 복구 절차가 배포 장에서 이 장으로 옮겨졌습니다).

### split-brain 방지 — Raft 정족수가 단일 진실원

"멀티마스터인데 네트워크 분할 시 양쪽이 각자 쓰면 split-brain 아니냐"는 물음이 자연스럽게 나오지만 그런 일은 생기지 않습니다 `✓`. part를 커밋하려면 Keeper 로그에 등록해야 하고 Keeper 쓰기는 Raft 과반 승인을 요구합니다. 네트워크 분할이 나면 Keeper 앙상블이 다수파/소수파로 나뉘고 과반을 가진 쪽만 로그에 쓸 수 있습니다. 소수파에 붙은 CH replica는 Keeper 쓰기가 안 돼 read-only로 전락합니다 → 두 파가 각자 쓰는 divergence가 원천 차단됩니다.

{{< flow src="_flow/split-brain-방지-raft.json" />}}

전통 primary-replica는 승격 오판으로 두 primary가 생기는 split-brain을 펜싱(STONITH)으로 따로 막아야 합니다. RMT는 쓰기 자격 자체가 Raft 정족수에 종속돼 이 문제를 원천 차단합니다 `✓`. 대가는 위 §정족수 상실입니다 — 정족수를 잃은 쪽은 그냥 못 씁니다(가용성보다 일관성 우선, CP 성향).

### insert_quorum ↔ failover 일관성

기본 INSERT는 1개 replica 확정 후 즉시 ack하므로(async, 멀티마스터의 최고 가용성), ack 직후 그 replica가 죽고 아직 복제 전이면 미복제 part 유실이 가능합니다 `✓`. `insert_quorum: N`을 켜면 N개 replica 확정 후 ack라 failover 시 손실 확률이 낮아지되 확정 가능 replica가 N 미만이면 쓰기가 차단됩니다(내구성↔가용성). 개념 축만 보면 insert_quorum은 "failover 시 얼마나 데이터를 보장하나"를 가용성과 맞바꾸는 노브입니다. 주입 위치(profiles/users.xml)·RF3와 왜 짝인가·재수화 창 중 쓰기 차단 트레이드오프는 [배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})이 기준 문서입니다. 관측성 RUM은 append-only·소량 손실 허용이라 기본 async로 시작하고 신뢰가 더 필요한 경로만 quorum(+RF3)을 선택 적용합니다 `≈`.

## RF2에서 consolidation·노드 작업은 안전한가

안전합니다 — 단 "한 번에 한 replica만" 내리도록 강제될 때만입니다.

- 왜 안전한가 `✓`. RF2에서 replica A를 consolidation·재부팅·드레인하는 동안 replica B가 read+write를 그대로 서빙합니다 — 멀티마스터라 B로의 승격 절차조차 없이 그냥 계속 씁니다. consolidation·노드 작업은 자발적(voluntary) 중단입니다. operator 자동 PDB `pdbMaxUnavailable: 1`이 같은 클러스터에서 한꺼번에 1개 초과 replica가 내려가는 것을 막아 drain·롤링·Karpenter consolidation을 직렬화합니다. Karpenter(≥v1.0)는 PDB를 준수하고 VolumeAttachment 삭제까지 대기한 뒤 노드를 종료해 EBS graceful detach를 보장합니다.
- 그 창 동안 그 shard는 실질 RF1입니다 `✓`. 사본이 하나뿐이라 이 창 안에 B까지 시간차 독립 하드웨어 장애로 죽으면 위험합니다 — PDB·anti-affinity로는 못 막는 2차 타격입니다. 창을 짧게 유지하고 2차 장애를 막아야 합니다.
- EBS라 이 창이 짧습니다(상세 04) `✓`. consolidation으로 노드가 바뀌어도 데이터는 EBS 볼륨에 남아 재수화가 아니라 reattach입니다(상세 04) → 실질 RF1 창이 수 분으로 줄어 RF2가 방어 가능한 기본값이 됩니다.
- 동시 disruption 방지는 [operator 토폴로지·다운타임]({{< relref "04-operator-topology-downtime.md" >}})의 배치 강제 3종(anti-affinity/topologySpread/PDB)이 맡아 같은 클러스터에서 둘이 겹쳐 내려가는 것을 직렬화합니다 → 상세 04. 06의 자기 축은 멀티마스터라 그 직렬화된 창 동안 승격 없이 잔여 replica가 read+write를 서빙한다는 데 있습니다 `✓`. 단 EBS-first에선 AZ 분산의 무게가 특히 큽니다. AZ 장애는 reattach로 못 풀고 cross-AZ replica만이 방어하기 때문입니다. 데이터 노드는 Karpenter `do-not-disrupt` + `consolidationPolicy: WhenEmpty`로 불필요한 churn을 막습니다(상세 04).
- RF3가 답이 되는 경우 `✓/≈`. consolidation 창 중에도 2사본을 유지해 2차 장애를 견디거나, `insert_quorum: 2`를 상시 켜거나(RF2면 reattach 중 확정 가능 replica가 1이라 quorum:2가 쓰기를 막습니다), AZ 무저하가 요구일 때입니다. LTS(24.8) 고정이면 CH minor 롤링 빈도가 줄어 consolidation·롤링 이벤트 자체가 감소해 실질 RF1 창 노출 횟수가 줍니다 `≈`(one-year/2 LTS 호환 창·minor 스킵 금지는 [operator 운영]({{< relref "../../clickhouse/05-altinity-operations.md" >}})).

멀티마스터라 RF2 consolidation은 "1개씩 내리면 승격 없이 안전"하되 그 창 동안은 실질 RF1이므로 anti-affinity+topologySpread+PDB로 동시성만 막으면 됩니다. EBS면 창이 수 분이라 RF2로 충분하고 2차 하드웨어 장애 무손실이 요구면 RF3입니다.

## 우리 케이스에서는

- failover 절차는 "없음"이 기본값입니다. RMT 멀티마스터라 승격이 없고 replica 하나가 죽어도 남은 replica가 read+write를 계속 받습니다. 우리가 할 일은 라우팅 계층이 살아있는 replica를 고르게 하는 것뿐입니다 — 1 shard × RF2에서는 HyperDX → cluster Service(readiness 기반 replica 제거) + HTTP 8123으로 시작하고 chproxy/Distributed 프록시는 사용자별 쿼터나 shard 2+ 같은 실제 요구가 생길 때 추가합니다 `≈`.
- 토폴로지는 `shardsCount: 1` × `replicasCount: 2`(RF2)에 anti-affinity(hostname), topologySpread(AZ, DoNotSchedule), PDB(maxUnavailable 1)입니다. 데이터 노드는 EBS 기반 Graviton r7g로 가고 로컬 NVMe i7i/i8g는 이 카테고리 기본이 아닙니다. CHK는 3노드 3 AZ로 정족수를 사수합니다 — 이 조정 계층이 전체 쓰기 가용성의 SPOF이므로 gp3 영속·CH와 분리 배치가 방어의 전부입니다.
- split-brain은 아예 일어나지 않습니다. Raft 정족수가 단일 진실원이라 소수파는 쓰기가 불가능하고 펜싱 장치도 필요 없습니다. 대가는 정족수를 잃은 쪽이 그냥 못 쓴다는 것입니다(일관성 우선).
- RF2로 시작하고 RF3는 트리거 기반으로 승급합니다. "AZ 1개 소실 중에도 무저하" 또는 "`insert_quorum: 2` 상시"가 요구가 되는 순간에만 RF3입니다. EBS는 노드 급사가 데이터 소실이 아니라 reattach라 RF3를 공격적으로 강제할 이유가 약합니다.
- insert_quorum은 선택 적용합니다. 관측성 append-only라 기본 async로 시작하고 신뢰 필요 경로만 quorum(+RF3)을 씁니다.
- LTS(24.8)를 고정해 롤링 업그레이드 빈도를 낮추고 RF2의 실질 RF1 노출 창 발생 횟수 자체를 줄입니다.
- staging에서 실측할 것 `?`: reattach + CH startup(part-load) 실소요, 델타 catch-up 실 fetch량, `is_leader` 다중 여부, Service readiness 기반 replica 제거 타이밍. 이 공백을 리허설로 메웁니다.
- 시점 기준 2026-07.
