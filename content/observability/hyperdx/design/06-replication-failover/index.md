---
title: "복제·멀티마스터·failover — 승격 없는 다중 마스터 복구 모델"
date: 2026-08-01
lastmod: 2026-08-24
weight: 6
url: "/hyperdx/06-replication-failover/"
---

# ClickHouse replica 장애와 복구

ClickHouse replica 한 대가 내려가면 누가 쓰기를 이어받을까요. ReplicatedMergeTree에서는 남은 replica가 이미 쓰기를 받을 수 있으므로 primary를 승격하는 절차가 없습니다. 장애 대응에서 확인할 대상은 쓰기를 보낼 주소, Keeper 연결, 그리고 아직 복제되지 않은 파트입니다.

이 글의 구성은 1 shard × RF2, 각 replica의 gp3 볼륨, 3 AZ에 둔 Keeper 3대입니다. 이 환경에서 복제가 진행되는 과정부터 노드 정비 중의 제약까지 살펴봅니다. EBS 재부착과 실제 중단 시나리오는 [operator 토폴로지·다운타임]({{< relref "/observability/hyperdx/design/04-operator-topology-downtime/index.md" >}}), Keeper에 저장되는 정보는 [Keeper]({{< relref "/observability/hyperdx/design/05-keeper/index.md" >}}), 사본을 다시 만드는 동안의 위험은 [스토리지·로컬 NVMe]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})에 정리했습니다.

## ReplicatedMergeTree 복제 구조 {#replicatedmergetree-복제-구조}

### replica별 독립 사본 {#각-replica--완전한-사본-part-단위-복제}

같은 shard의 replica는 각자 완전한 데이터 사본을 보유합니다. 이 구성에서는 replica마다 별도의 EBS 볼륨을 사용합니다. self-host S3 cold 티어를 붙여도 사본은 replica별로 남으므로 저장량에 RF가 곱해집니다.

복제는 테이블(엔진) 레벨에서 선언합니다. 첫 인자가 shard별로 유일한 Keeper znode 경로, 둘째가 replica 식별자입니다.

```sql
CREATE TABLE otel_logs (...)
ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/{table}', '{replica}')
ORDER BY (...);
-- {shard}/{replica}는 operator가 host별 macros로 자동 렌더 → 수동 config.d 불필요
```

ReplicatedMergeTree는 파트 단위로 복제합니다. INSERT를 받은 서버가 로컬 파트를 기록하고 Keeper에 그 파트의 존재와 블록 정보를 등록하면, 다른 replica가 이를 읽고 파트 본문을 가져갑니다. 공식 문서는 INSERT 원천 데이터의 전송과 이후의 로컬 머지를 구분해 설명합니다.

각 replica는 복제된 원천 파트로 조정된 머지 작업을 수행합니다. 따라서 복제를 이해할 때는 데이터 파트의 전송과 머지 작업의 할당을 따로 볼 필요가 있습니다.

### 공용 로그에서 replica 실행 큐로 {#동기화-메커니즘--log--replication_queue--실행-pull-모델}

각 replica는 공용 `/log`를 자기 실행 큐로 가져와 처리합니다. 쓰기를 받은 서버가 모든 replica에 직접 밀어 넣는 방식이 아니므로, 잠시 내려갔다 돌아온 replica는 자기 `log_pointer` 뒤의 작업을 이어 처리할 수 있습니다.

{{< flow src="_flow/동기화-메커니즘-log-replication.json" />}}

`system.replication_queue.type`의 주요 enum:

| type | 의미 |
|---|---|
| `GET_PART` | 다른 replica에서 part를 가져와라(INSERT 복제의 기본) |
| `MERGE_PARTS` | 지정 part들을 머지해 새 part 생성 |
| `MUTATE_PART` | part에 mutation(ALTER UPDATE/DELETE) 적용 |
| `DROP_RANGE` / `REPLACE_RANGE` | 파티션/범위 삭제·교체 |
| `ATTACH_PART` / `CLEAR_COLUMN` / `CLEAR_INDEX` / `ALTER_METADATA` | attach·컬럼/인덱스 제거·스키마 변경 |

### 복제 지연과 막힌 작업 찾기 {#진단--systemreplicas--systemreplication_queue}

`system.replicas`에서 replica별 지연과 로그 소비 위치를 확인하고, `system.replication_queue`에서 막힌 작업을 찾습니다. `log_pointer`와 `log_max_index`의 차이가 줄지 않거나 `absolute_delay`가 계속 커지면 개별 큐의 실패 이유를 살펴봅니다.

| 컬럼(`system.replicas`) | 의미 |
|---|---|
| `is_readonly` | **read-only 여부** — Keeper 연결·정족수 문제 시 켜짐(아래 Keeper 과반 상실 절) |
| `absolute_delay`(정밀 정의는 버전 확인 권장) | 복제 지연(초) — 가장 앞선 replica 대비 이 replica가 얼마나 뒤졌나 `✓` |
| `log_max_index` / `log_pointer` | `/log` 최대 엔트리 번호 / 소비 위치. `log_pointer` ≪ `log_max_index`면 못 따라가는 중 |
| `queue_size` / `inserts_in_queue` / `merges_in_queue` | 대기 작업 총수·유형별 |
| `total_replicas` / `active_replicas` | 전체 / Keeper 세션 보유(활성) replica 수 |
| `is_leader` / `can_become_leader` | 머지 할당자 여부(쓰기 primary가 아님) |

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

복구 명령은 장애 종류에 맞춰 선택합니다. `SYSTEM SYNC REPLICA db.table`은 동기화를 기다리고, `SYSTEM RESTART REPLICA`는 Keeper 상태를 다시 초기화합니다. Keeper 메타데이터를 잃었을 때 로컬 파트로 복구하는 명령은 `SYSTEM RESTORE REPLICA`입니다. `SYSTEM DROP REPLICA`는 폐기한 replica의 등록을 정리할 때만 사용합니다. SYNC의 LIGHTWEIGHT·STRICT·PULL 모드는 버전에 따라 확인해야 합니다. scale-in 절차는 [operator 운영]({{< relref "/data/clickhouse/operations/05-altinity-operations.md" >}})을 따릅니다.

## 쓰기를 받는 replica {#멀티마스터--단일-리더가-없다}

### 어느 replica로 INSERT해도 되는 이유 {#모든-replica가-insert를-수용한다}

살아 있고 쓰기가 가능한 replica라면 INSERT와 ALTER를 받을 수 있습니다. 어느 서버가 받더라도 로컬 기록, Keeper 등록, 다른 replica의 fetch로 이어집니다. 이 비동기 멀티마스터 구조 때문에 별도의 primary 주소를 찾을 필요가 없습니다. [ReplicatedMergeTree 공식 설명](https://clickhouse.com/docs/engines/table-engines/mergetree-family/replication)도 이 동작을 명시합니다.

### is_leader가 가리키는 작업 {#leader는-206에서-제거된-레거시-개념}

`system.replicas.is_leader`는 쓰기를 독점하는 primary 표시가 아닙니다. 머지·뮤테이션 할당에 참여하는 replica를 나타냅니다. 20.6부터 여러 replica가 동시에 leader가 될 수 있으므로 이 컬럼을 보고 쓰기 라우팅 대상을 하나로 고르면 안 됩니다.

{{% details title="leader election 제거 역사 — 1차 소스(issue #10367·PR #11639·#11795)" closed="true" %}}
- issue #10367 — *"Get rid of leader election in ReplicatedMergeTree tables"*.
- PR #11639 — *"Remove leader election, step 2: allow multiple leaders"*. 원문 취지는 과거 단일 leader만 하던 merge/mutation/partition drop·move·replace 할당을 여러 replica가 함께 하도록 바꾼 것입니다(20.6부터 multiple leaders).
- PR #11795 — *"...step 3: remove yielding of leadership; remove sending queries to leader"*(leader에게 쿼리를 몰아주던 잔재까지 제거).

leader가 (과거에) 하던 일은 머지·뮤테이션·파티션 조작 할당뿐이고 데이터 쓰기는 원래부터 아무 replica나 받았습니다. `can_become_leader`는 `replicated_can_become_leader` 설정으로 특정 replica(예: 사양 낮은 노드)를 머지 할당에서 빼는 용도로 여전히 유효합니다. 함정 하나. 모든 replica가 `is_leader=0`이면 머지 스케줄링이 정지합니다. failover와는 무관한 조정 이상 징후입니다.
{{% /details %}}

24.8 LTS 배포에서는 `system.replicas`를 조회해 실제 leader 상태를 확인해 둡니다. 모든 replica의 `is_leader`가 0인 상황은 승격 장애보다 머지 할당이 진행되지 않는 문제로 조사해야 합니다.

### 다른 복제 모델과의 차이 {#3자-비교--쓰기-토폴로지와-자동-failover}

다른 복제 모델과 비교하면 장애 후 필요한 작업이 드러납니다.

| 축 | **전통 primary-replica**(PostgreSQL / MySQL) | **Kafka**(파티션 리더) | **ClickHouse RMT** |
|---|---|---|---|
| 쓰기 수용 노드 | **primary 1개만** | 파티션당 **leader 1개** | **모든 replica**(멀티마스터) `✓` |
| 복제 방향·단위 | primary→standby(WAL/binlog)¹ | leader→follower(ISR) | **양방향 pull**, `/log` 소비 — **part 단위** `✓` |
| 자동 failover 필요? | **필요** — standby→primary promote | **필요** — 새 파티션 leader election | **불필요** — 승격 개념 없음 `✓` |
| failover 오케스트레이터 | Patroni·repmgr·Orchestrator 등 **외부** | 브로커 내장 | **없음**(살아있는 replica가 계속) `✓` |
| 조율 주체 | 없음(또는 외부 합의) | KRaft/ZooKeeper | **Keeper**(복제 로그·dedup) — 파티션 leader election 없음 `✓` |
| split-brain 방지 | fencing/STONITH·외부 합의 | 컨트롤러 합의 | **Keeper Raft 정족수 = 공통 조정 상태**, 소수파 쓰기 불가 `✓` |
| 쓰기 라우팅 | 클라가 **primary 주소** 인지 필요 | 프로듀서가 파티션 leader로 | **아무 replica**(라우터가 dead만 회피) `✓` |

¹ PostgreSQL/MySQL의 복제 단위는 row 또는 statement 방식(엔진·설정에 따라 다름).

ClickHouse에 primary 승격 컨트롤러가 필요하지 않은 이유는 각 replica가 이미 쓰기를 받을 수 있기 때문입니다. 실제 요청이 살아 있는 replica에 도달하도록 라우팅하고 재시도하는 일은 남아 있습니다.

## Keeper 경로와 복제 작업 {#zookeeperkeeper의-복제-역할}

Keeper의 공용 로그와 replica별 큐는 아래처럼 연결됩니다. 이벤트 본문을 보관하지 않는다는 제약과 영속 수집 큐는 [Keeper]({{< relref "/observability/hyperdx/design/05-keeper/index.md" >}})에서 다룹니다.

| znode(shard별 `/clickhouse/tables/{shard}/{table}/…`) | 복제에서의 역할 |
|---|---|
| `/log` | **복제 로그(공용)** — 모든 replica가 공유하는 "무슨 일이 일어났나"의 단일 순서열. 복제의 심장 |
| `/replicas/{r}/queue` | replica별 실행 큐 — `/log`에서 복사해 온, 아직 실행 안 한 작업 |
| `/replicas/{r}` | replica 등록·liveness(ephemeral `is_active`)·`log_pointer` |
| `/blocks/<hash>` | **INSERT 블록 dedup 체크섬** — 재시도 멱등의 근거(아래) |
| `/block_numbers`, `/parts` | 블록번호 배정·존재하는 part 목록 |
| `/mutations/<id>` | mutation 지시(ALTER UPDATE/DELETE) — replica들이 `MUTATE_PART`로 소비 |

파트 본문과 SELECT는 이 조정 경로를 거치지 않습니다. 다만 새 파트를 등록하고 복제를 진행하려면 Keeper에 쓸 수 있어야 합니다.

Dedup 기록도 같은 Keeper에 있으므로 재시도 대상이 다른 replica여도 이전 블록을 알아볼 수 있습니다. 이 보장은 블록 내용과 순서, dedup window, 비동기 INSERT 설정에 의존합니다. 관련 설정은 [Keeper]({{< relref "/observability/hyperdx/design/05-keeper/index.md" >}})에서 설명합니다.

## 중단 이후의 요청과 데이터 {#중단과-failover}

### 복귀한 replica의 catch-up {#승격-절차가-없다}

replica 한 대가 중단되면 남은 replica로 요청을 보냅니다. 복구된 replica는 이전 로그 소비 위치부터 작업을 이어갑니다. EBS가 보존됐다면 기존 파트를 다시 사용할 수 있어 보통 누락된 부분을 catch-up합니다. 볼륨 재부착, 파트 로딩, 실제 fetch량과 소요 시간은 [operator 토폴로지·다운타임]({{< relref "/observability/hyperdx/design/04-operator-topology-downtime/index.md" >}})의 시나리오에 따라 측정해야 합니다.

그동안의 쓰기 가용성은 Keeper 정족수와 `insert_quorum` 설정에 달려 있습니다. 기본 비동기 복제에서는 응답한 replica의 유일한 사본이 복제 전에 사라질 수 있습니다. 장애 전에 열린 연결도 자동으로 다른 서버에 옮겨 붙는 것은 아니므로 클라이언트 재연결을 확인해야 합니다.

### 살아 있는 replica로 연결하기 {#클라이언트-라우팅--죽은-replica-회피}

라우팅 방법은 접속 프로토콜과 shard 구성에 맞춰 고릅니다.

- ClickHouse Distributed 테이블 / `remote_servers`: `load_balancing`(`random`(기본)·`nearest_hostname`·`in_order`·`first_or_random`·`round_robin`)으로 살아있는 replica를 고르고 연결 실패 시 짧은 타임아웃으로 다음 replica를 시도합니다(native connection failover). 단 우리는 1 shard라 데이터 분산용 Distributed는 사실상 불필요합니다.
- 외부 프록시: HTTP(8123)는 chproxy·HAProxy·nginx 모두 가능하고 chproxy가 CH 특화입니다. native TCP(9000)는 프록시가 프로토콜을 몰라 한 연결을 여러 서버로 못 쪼개므로 연결 회전·`idle_connection_timeout`·Distributed 프록시 중 하나가 필요합니다.
- Kubernetes Service: HyperDX는 operator의 cluster Service(HTTP 8123/TCP 9000)로 접속합니다. readiness에 실패한 Pod는 새 연결의 대상에서 제외되지만, 기존 연결의 재시도와 쓰기 가능 상태 판정은 별도로 확인해야 합니다. `/ping` 응답만으로 복제 테이블의 쓰기 가능 여부까지 단정하지 않고 `system.replicas.is_readonly`를 함께 봅니다. 실제 endpoint 제거 시간은 `kubectl get endpoints`로 측정합니다.

### 장애별 읽기·쓰기 가용성 {#시나리오별-가용성-failover-라우팅-관점}

아래 표는 요청을 정상 replica로 보낼 수 있고 기본 비동기 복제를 쓰는 경우의 가용성입니다. 연결 실패부터 재시도까지의 짧은 오류 구간은 따로 측정해야 합니다. 물리 복구 절차는 [operator 토폴로지·다운타임]({{< relref "/observability/hyperdx/design/04-operator-topology-downtime/index.md" >}})의 S1~S9에 있습니다.

| 시나리오 | 읽기 | 쓰기 | failover 라우팅 | 상세 |
|---|---|---|---|---|
| **replica 1대 소실** | 남은 replica에서 가능 | 남은 replica에서 가능(quorum 설정에 따름) | LB/Service가 죽은 replica 제거 | [04]({{< relref "/observability/hyperdx/design/04-operator-topology-downtime/index.md" >}}) S4~S7 |
| **EBS reattach 복귀** | 복귀 replica는 startup 후 재합류 | 다른 replica에서 가능 | 복귀까지 해당 replica만 offline | [04]({{< relref "/observability/hyperdx/design/04-operator-topology-downtime/index.md" >}})·[../clickhouse/02]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}}) |
| **AZ 1개 장애** | 다른 AZ replica가 서빙 | 다른 AZ replica에서 가능(quorum 설정에 따름) | topologySpread 전제로 cross-AZ replica 존재 | [04]({{< relref "/observability/hyperdx/design/04-operator-topology-downtime/index.md" >}}) S8 |
| **Keeper 정족수 상실** | **로컬 part read OK** | **INSERT/DDL 거부(read-only 전락)** | 라우팅 무관, 쓰기 정지 | [05-keeper]({{< relref "/observability/hyperdx/design/05-keeper/index.md" >}})·[ch/04]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}}) |

노드만 교체한 경우에는 EBS를 재부착해 기존 데이터를 사용할 수 있습니다. AZ 장애는 다릅니다. 장애 AZ의 볼륨을 그대로 다른 AZ에 붙일 수 없으므로 다른 AZ의 replica가 서비스를 이어가야 합니다. 이 차이가 데이터 replica를 AZ에 분산하는 이유입니다.

### Keeper 과반을 잃었을 때 {#keeper-정족수-상실--진짜-spof-read-only-전락}

Keeper 3대 중 2대를 잃으면 데이터 replica가 모두 살아 있어도 복제 테이블의 쓰기가 멈춥니다.

- SELECT은 계속됩니다 — 로컬 part 읽기에 Keeper가 필요 없습니다.
- INSERT/DDL/머지/뮤테이션은 정지합니다 — `TABLE_IS_READ_ONLY`(에러 코드 242, *"Table is in readonly mode (zookeeper path: …)"*). part 등록·블록번호 배정·복제 로그 기록이 전부 Keeper 쓰기를 요구하므로 쓰기 경로가 통째로 멈춥니다. `system.replicas.is_readonly=1`로 드러납니다.
- 정족수 없이 쓰기를 허용하면 일관성을 보장할 수 없으므로 일부러 막는 보호 장치입니다.

배치와 정족수는 [Keeper]({{< relref "/observability/hyperdx/design/05-keeper/index.md" >}}), [operator 토폴로지·다운타임]({{< relref "/observability/hyperdx/design/04-operator-topology-downtime/index.md" >}}), [배포 플레이북]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}})을 참고합니다. 정족수 상실 후 복구 절차는 [Altinity operator 운영]({{< relref "/data/clickhouse/operations/05-altinity-operations.md" >}})에 있습니다.

### 네트워크 분할과 Keeper 정족수 {#split-brain-방지--raft-정족수가-단일-진실원}

새 파트를 확정하려면 Keeper에 등록해야 하고, Keeper 쓰기에는 Raft 과반이 필요합니다. 네트워크가 분할되면 과반과 통신할 수 있는 쪽만 조정 로그에 기록할 수 있습니다. 과반에 닿지 못하는 ClickHouse replica는 이 경로로 쓰기를 확정할 수 없습니다.

{{< flow src="_flow/split-brain-방지-raft.json" />}}

이 구조에서는 서로 다른 두 primary를 승격하는 문제를 별도의 펜싱으로 해결할 필요가 없습니다. 대신 Keeper 정족수에 접근할 수 없는 쪽의 쓰기 가용성을 포기합니다.

### insert_quorum과 쓰기 가용성 {#insert_quorum--failover-일관성}

기본 복제 설정은 로컬 replica 기록 뒤 다른 사본의 완료를 기다리지 않습니다. `insert_quorum=N`은 N개 replica에 확정될 때까지 응답을 늦춰 미복제 사본 손실 위험을 줄입니다. 확보 가능한 replica가 N보다 적으면 쓰기를 완료할 수 없습니다. 설정 위치와 RF3 선택은 [배포 플레이북]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}})에 있습니다. RUM에서는 허용 가능한 손실과 중단 시간을 정한 뒤 경로별로 적용합니다.

## RF2에서 한 대씩 정비하기 {#rf2에서-consolidation노드-작업은-안전한가}

RF2에서 A를 정비하는 동안 B가 읽기와 쓰기를 처리할 수 있습니다. 그러나 A가 돌아오기 전에는 서비스 가능한 사본이 하나뿐입니다. 그 사이 B에도 장애가 생기면 PDB로 막을 수 없습니다.

[Kubernetes PDB](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/)는 eviction API를 사용하는 자발적 중단을 제한합니다. 갑작스러운 노드 장애나 모든 삭제·롤링 경로를 직렬화하는 장치는 아닙니다. anti-affinity와 AZ topology spread로 사본을 분산하고, operator와 Karpenter가 실제로 어떤 중단 경로를 쓰는지 확인해야 합니다. 데이터 노드의 `do-not-disrupt`와 `consolidationPolicy: WhenEmpty` 운영은 [operator 토폴로지·다운타임]({{< relref "/observability/hyperdx/design/04-operator-topology-downtime/index.md" >}})에서 다룹니다.

EBS가 남으면 전량 재수화 대신 재부착과 catch-up으로 복귀할 수 있지만 RF1로 서비스하는 시간이 항상 수 분으로 끝난다고 보장할 수는 없습니다. 대체 노드 준비, 볼륨 연결, 파트 로딩까지 포함한 시간을 측정해야 합니다.

정비 중에도 두 사본을 유지하거나 `insert_quorum=2`로 쓰기를 계속해야 한다면 RF3가 맞습니다. RF2를 택하면 단일 사본으로 서비스하는 시간을 받아들이는 대신 비용을 줄입니다. LTS를 고정해 불필요한 롤링 횟수를 줄일 수 있으며, 업그레이드 경로는 [operator 운영]({{< relref "/data/clickhouse/operations/05-altinity-operations.md" >}})을 따릅니다.

## 장애 리허설에서 확인할 것 {#우리-케이스에서는}

1 shard × RF2에서는 HyperDX가 cluster Service를 통해 접속하고 한 replica를 중단했을 때의 요청 결과를 확인합니다. endpoint에서 빠지기까지 걸린 시간, 기존 연결의 실패와 재시도, 남은 replica의 쿼리 부하를 기록합니다. 복구 시에는 EBS 재부착과 파트 로딩, 복제 큐가 비워지는 시간을 따로 잽니다.

Keeper 정족수 상실도 데이터 노드 장애와 별도로 시험해야 합니다. 로컬 SELECT는 되는 상태에서 INSERT가 실패하는지, `is_readonly`가 어떻게 변하는지 확인합니다. 이 경우 replica 주소를 바꾸는 것만으로 쓰기가 복구되지는 않습니다.

이 글의 RF2 운영안은 2026-07에 정리한 설계입니다. AZ 장애 중 성능 유지나 quorum 2의 상시 쓰기가 요구되면 RF3로 바꾸고, 그 비용과 내구성 조건을 함께 검토합니다.
