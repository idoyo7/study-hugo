---
title: "ClickHouse Keeper — 조정 계층이지 durable queue가 아니다"
weight: 5
---

# ClickHouse Keeper — 조정 계층이지 durable queue가 아니다

HyperDX 스택의 ClickHouse는 self-host이므로 `ReplicatedMergeTree`가 강제되고, 복제를 조정할 계층으로 **ClickHouse Keeper**가 반드시 붙습니다. 우리는 이 Keeper를 표준 ClickStack 차트의 공식 operator(KeeperCluster CRD)가 아니라 **Altinity CHK(`ClickHouseKeeperInstallation`)로 분리 운영**합니다 — 그 배치·gp3 영속 볼륨·정족수 매니페스트·업그레이드는 이미 clickhouse 카테고리가 깊게 다뤘으므로 여기서 반복하지 않고 [스토리지 · 로컬 NVMe]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})(Keeper gp3 영속·내구성 3종세트), [operator 배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})(정족수 산술·`insert_quorum` 주입·쓰기 내구성 노브), [Altinity operator 운영]({{< relref "../../clickhouse/05-altinity-operations.md" >}})(CHK 롤링 업그레이드), 그리고 같은 카테고리의 [operator 토폴로지·다운타임]({{< relref "04-operator-topology-downtime.md" >}})으로 위임합니다.

이 페이지가 새로 더하는 각도는 하나입니다: **"Keeper는 Kafka 같은 개념이지만, ClickHouse가 죽어도 큐잉되는 데이터가 아니다"** 를 정확히 해부합니다. 무엇을 저장하고 무엇을 저장하지 않는지, in-flight INSERT가 어디서 유실되는지, 그리고 신뢰 ingest를 만드는 것이 Keeper가 아니라 **클라이언트 재시도 + 멱등 + (필요 시) 앞단 실제 큐**임을 우리 RUM 워크로드 기준으로 정리합니다.

{{< callout type="info" >}}
**한눈에**
- Keeper는 **ZooKeeper의 ClickHouse판**(NuRaft/Raft 합의)이지 **Kafka의 ClickHouse판이 아니다**. 조정 메타데이터(복제 로그·part 참조·DDL 큐·dedup 체크섬·ephemeral 락)만 담고 **사용자 이벤트 데이터는 담지 않는다** `✓`.
- INSERT는 **클라이언트 → CH 서버로 직접** 갑니다. 동기면 파트로 디스크 기록, `async_insert`면 **서버 메모리 버퍼(휘발)**에 잠깐 머뭅니다. **커밋·복제 전에 서버가 죽으면 그 데이터는 어디에도 큐잉되지 않고 유실**됩니다 — Keeper가 붙잡아 두지 않습니다 `✓`.
- Keeper 안의 "큐"(DDL task_queue·replica queue·replication log)는 **메타데이터 큐**지 이벤트 데이터 큐가 아닙니다. "이미 디스크에 쓰인 파트를 가져가라"는 **지시**를 복원할 뿐, 아직 파트가 안 된 수신 중 이벤트를 복원하지 못한다 `✓`.
- 유실 방어는 CH 내부에서 **`insert_quorum` + 블록 dedup + 클라이언트 재시도**(at-least-once → 사실상 exactly-once)까지, 다운타임/버스트 흡수는 **CH 앞단의 실제 큐**(OTel Collector persistent queue / Kafka)가 담당합니다.
{{< /callout >}}

## Keeper 기초 — 무엇이고, 무엇을 저장하나

> Keeper가 저장하는 znode가 **복제를 어떻게 구동하는지**(`/log` pull 모델·멀티마스터·승격 없는 failover·split-brain 방지)는 [복제·멀티마스터·failover]({{< relref "06-replication-failover.md" >}})가 기준 문서입니다. 이 페이지는 Keeper **자체**(무엇을 저장/비저장하나, 왜 큐가 아닌가)에 집중합니다.

Keeper는 C++로 작성됐고 **eBay NuRaft**로 Raft 합의를 돌립니다 `✓`. ZAB(write만 linearizable)를 쓰던 ZooKeeper와 달리 **읽기·쓰기 모두 linearizable** 보장을 제공하며(기본 동작은 linearizable writes + non-linearizable reads), 클라이언트 프로토콜이 ZooKeeper와 호환되는 **drop-in 대체**입니다 — 기존 ZK 클라이언트가 그대로 붙습니다 `✓`. 단 스냅샷·로그 포맷과 피어 간(interserver) 프로토콜은 ZooKeeper와 비호환이라, ZK에서 넘어올 때는 별도 변환이 필요합니다 `✓`. Java 런타임이 필요 없어 운영이 가볍습니다 `Ⓥ/✓`.

정족수 산술은 clickhouse 카테고리가 기준 문서이므로 요지만 짚습니다: **홀수 노드**로 배치하고(`floor(N/2)+1`이 과반), **3노드는 1대 손실**을, **5노드는 2대 손실**을 견딥니다. 4노드는 견딜 수 있는 손실 수가 3노드와 같아 무의미합니다. **과반을 잃으면 Keeper는 쓰기를 받지 못하고, ClickHouse 클러스터는 read-only로 전락**합니다(신규 INSERT·머지·DDL 정지). 배치 근거(AZ 분산·CH와 분리·RTT<50ms)와 정족수 상실 런북은 [operator 배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})과 [operator 토폴로지·다운타임]({{< relref "04-operator-topology-downtime.md" >}})을 따릅니다.

### Keeper가 저장하는 것 (사용자 데이터 아님)

Keeper는 znode 트리(작은 키-값)로 **복제·분산 실행의 조정 상태만** 담습니다. 실제 테이블 행·파트 바이트는 담지 않습니다 `✓`.

| 저장 대상 | 내용 | znode 경로(예) |
|---|---|---|
| **복제 로그(replication log)** | 로그 엔트리(파트·소비 추적)¹ | `/clickhouse/tables/{shard}/{table}/log/log-000…` `✓` |
| **replica별 큐(queue)** | 각 replica가 아직 안 가져온 작업(파트 fetch·머지 지시) | `.../replicas/{r}/queue/…` `✓` |
| **part 할당·블록 번호** | 중복 방지용 블록 번호 배정, 어느 파트가 존재하는지 | `.../block_numbers/`, `.../parts/` `✓` |
| **INSERT dedup 체크섬** | 블록 해시섬(파티션별 znode) → 재시도 멱등의 근거 | `/clickhouse/tables/…/blocks/<hash>` `✓` |
| **분산 DDL 큐(ON CLUSTER)** | DDL 태스크(직렬 znode 순서) + 노드별 완료 | `/clickhouse/task_queue/ddl/query-000…` `✓` |
| **leader election / ephemeral 락** | 머지·mutation 리더, 세션 소멸 시 자동 삭제되는 임시 노드 | ephemeral znodes `✓` |

¹ INSERT·MERGE·MUTATION을 로그 엔트리로 기록 — 어떤 파트가 생겼고 각 replica가 어디까지 소비했는지 추적합니다.

여기서 반드시 붙잡을 사실 세 가지입니다.

- **데이터는 replica 간 직접 전송됩니다** `✓`. 공식 복제 문서 원문은 *"During replication, only the source data to insert is transferred over the network"* — Keeper는 "누가 무엇을 가졌나"의 **포인터·지시**만 갖고, 파트 바이트는 replica가 서로 직접 fetch합니다.
- **SELECT은 Keeper를 타지 않습니다** `✓`(*"ZooKeeper is not used in SELECT queries"*). 조회 경로에 Keeper가 없습니다 → Keeper는 **쓰기·조정 경로의 SPOF**지 읽기 병목이 아닙니다.
- **INSERT 1건당 Keeper에 약 10개 엔트리**가 추가됩니다(근사치) `✓/≈`. 즉 Keeper 부하는 데이터 GB가 아니라 **INSERT·파트 생성 빈도에 비례**합니다. 작은 INSERT를 남발해 파트가 폭증하면 디스크보다 Keeper가 먼저 비명을 지릅니다 — 배칭이 Keeper 건강에도 직결됩니다.

Keeper가 저장하지 **않는** 것을 못박아 둡니다: ❌ 테이블의 행·파트 바이트(디스크에 있고 replica 직송), ❌ **아직 커밋 안 된 in-flight INSERT 버퍼**(§큐가 아니다의 핵심), ❌ 쿼리 결과·캐시(SELECT 경로 밖).

{{< flow src="_flow/keeper-가-저장하는-것.json" />}}

## 핵심 정정 — "Keeper는 Kafka/큐가 아니다"

"ZooKeeper/Keeper = 큐 = Kafka 같은 것"이라는 직관은 **절반만 맞고 결정적으로 틀립니다**. Keeper 안에는 분명히 큐 구조가 있습니다 — DDL `task_queue`, replica `queue`, replication `log`. 그래서 "큐 맞지 않냐"는 물음의 절반은 참입니다. 그러나 **그 큐가 담는 것은 파트 참조·머지 지시·DDL 메타데이터이지, 사용자가 방금 보낸 이벤트 데이터가 아닙니다** `✓`. Kafka가 프로듀서 메시지 본문을 디스크에 durable하게 적재·보존·재생하는 것과는 층위가 다릅니다.

### Kafka vs ZooKeeper vs ClickHouse Keeper — 3자 비교

| 축 | **Kafka (로그/큐)** | **ZooKeeper** | **ClickHouse Keeper** |
|---|---|---|---|
| 근본 목적 | 메시지 **본문** durable 적재·보존·재생 | 분산 조정(구성·락·리더) | 분산 조정(복제 메타·DDL, ZK의 CH 특화) |
| 담는 것 | **프로듀서가 보낸 데이터 그 자체** | 소량 조정 상태(znode) | 소량 조정 상태(znode) — 파트 참조·로그·체크섬 |
| 데이터 보존 | retention 기간 동안 디스크 보존, **replay 가능** | 조정 상태만(작음) | 조정 상태만(작음) |
| 합의 | ISR/replication (Raft: KRaft) | ZAB | **NuRaft(Raft)** |
| CH ingest에서 위치 | (선택) CH **앞단** 버퍼·디커플링 | (구) CH 조정 백엔드 | CH 조정 백엔드(기본) |
| "이벤트 유실 방어" | ✅ 앞단에서 스파이크·다운타임 흡수·재생 | ❌ 이벤트 데이터 안 담음 | ❌ **이벤트 데이터 안 담음** |

한 문장으로: Keeper는 "Kafka의 CH판"이 아닙니다. Keeper는 **ZooKeeper의 CH판**이고, Kafka가 채우는 자리(ingest 버퍼)는 Keeper가 아니라 **CH 앞단의 실제 큐**가 채운다(아래 유실 방지 설계).

### CH가 죽으면 in-flight INSERT는 어디에도 큐잉되지 않는다

데이터 경로를 정확히 그리면 유실 지점이 드러납니다 `✓`.

{{< seq src="_seq/ch-가-죽으면-in.json" />}}

- INSERT는 **클라이언트 → CH 서버로 직접** 가고, 파트로 디스크에 동기 기록되거나(기본), `async_insert`면 **서버 메모리 버퍼(휘발)**에 잠깐 머문다 `✓`.
- **커밋·복제 전에 서버가 죽으면** 그 데이터는 유실됩니다. Keeper는 ingest를 버퍼링하지 않으므로, "CH가 죽어도 Keeper가 데이터를 붙잡고 있다가 재개"하는 일은 **없습니다** `✓`.
- Keeper의 DDL 큐·복제 로그가 살아남아도 그것은 "이미 디스크에 쓰인 파트를 다른 replica가 가져가라"는 **지시**를 복원할 뿐, **아직 파트가 안 된 수신 중 이벤트**를 복원하지 못한다 `✓`.

{{< callout type="error" >}}
**정정**: Keeper는 durable queue가 아닙니다. ClickHouse 서버가 죽으면 아직 커밋되지 않은 INSERT는 **Keeper에도, 다른 어디에도 큐잉되어 있지 않습니다.** 신뢰 ingest는 Keeper가 아니라 **클라이언트 재시도 + 멱등 + (필요 시) 앞단 실제 큐**가 만듭니다.
{{< /callout >}}

## async_insert 세만틱 — 메모리 버퍼는 휘발이다

RUM/관측성 ingest는 작은 이벤트가 대량이라 `async_insert`를 흔히 씁니다. 그런데 여기가 유실 오해가 가장 잦은 지점입니다. 두 모드의 계약을 정확히 구분해야 합니다.

| 설정 | ack 시점 | 유실 성격 |
|---|---|---|
| `async_insert=1, wait_for_async_insert=1` (기본·권장) | **디스크 flush 후** ack | ack 받은 데이터는 유실 없음 `✓` |
| `async_insert=1, wait_for_async_insert=0` (fire-and-forget) | **버퍼링 즉시** ack | **ack 받아도 크래시 시 유실 가능** `✓/Ⓥ` |

정확한 프레이밍이 중요합니다: `wait_for_async_insert=1`에서도 버퍼는 여전히 메모리(휘발)입니다. 다만 **"ack = 디스크에 있음"** 계약이 지켜지므로, flush 전 크래시는 *미확정(un-acked)* INSERT의 실패로 나타나고 **이미 acknowledged 된 데이터는 잃지 않습니다.** 반면 `=0`은 **"ack = 버퍼에 있음"**이라 ack와 내구성이 분리돼, ack를 받고도 유실될 수 있습니다 — 게다가 에러는 flush 시점에야 표면화되고 dead-letter 메커니즘도 없어 벤더 스스로 *"very risky"* `Ⓥ`라 표현합니다. → **RUM에서도 `wait_for_async_insert=1` 유지가 기본**입니다 `✓`.

버퍼는 서버 in-memory이고, insert 쿼리 shape+settings 조합마다 별도 버퍼로 쌓이며, 아래 트리거 중 먼저 도달하는 것에서 flush된다(값은 도입 CH 버전·Cloud 여부에 따라 다르므로 재확인) `✓`.

| 설정 | 기본값 | 의미 |
|---|---|---|
| `async_insert_max_data_size` | **100 MiB** | 버퍼 누적 크기 상한 |
| `async_insert_busy_timeout_ms` | **200 ms** (Cloud 1000 ms) | 시간 상한(24.2+ 적응형: 유입률 따라 50~200 ms 동적) |
| `async_insert_max_query_number` | **450** | 누적 INSERT 쿼리 수 상한 |

두 가지 함정을 명시합니다. (1) `Buffer` 테이블 엔진도 같은 성질이라 **크래시 시 버퍼 데이터 유실** `✓`. (2) **async_insert는 기본적으로 dedup이 꺼져 있습니다** — 동기 INSERT는 기본 멱등이지만 async는 `async_insert_deduplicate=1`을 켜기 전까지 dedup이 안 돼, 재시도가 **중복 적재**를 낳습니다 `✓`.

{{< flow src="_flow/async-insert-세만틱-메모리.json" />}}

## 내구성 노브 — 유실 확률을 줄이는 도구지 큐 대체가 아니다

`insert_quorum`을 **어디에 주입하나**(profiles/users.xml), **RF3와 왜 짝인가**, **재수화 창 중 쓰기 차단** 트레이드오프는 [operator 배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})의 쓰기 내구성 노브 절이 기준 문서입니다. 여기서는 "이 노브들이 왜 **큐 대체가 아니라 유실 확률을 줄이는 도구**인가"의 개념 축만 봅니다.

| 노브 | 기본값 | 무엇을 |
|---|---|---|
| `insert_quorum = N` | 0(비활성) `✓` | 최소 N replica가 파트를 확정한 뒤 ack |
| `insert_quorum_parallel` | 1(병렬 허용) `✓` | 같은 테이블 동시 quorum INSERT 허용 |
| `select_sequential_consistency` | 0 `✓` | quorum 확정 데이터만 읽음 |
| `replicated_deduplication_window`(값 재확인 권장) | **1000**(블록) `✓` | 최근 N개 블록 해시를 Keeper에 보관(재시도 멱등) |
| `replicated_deduplication_window_seconds`(값 재확인 권장) | **604800**(7일) `✓` | dedup 해시의 시간 창 |

각 노브가 "큐 관점"에서 뜻하는 것:

- **`insert_quorum`** — ack 전에 파트가 N벌 존재 보장 → 단일 노드 소실에도 손실↓. **그래도 앞단 버퍼는 아님**: quorum 미달이면 쓰기가 **차단**된다(내구성↔가용성 트레이드오프) `✓`.
- **`insert_quorum_parallel`** — read-after-write를 엄격히 원하면 0으로 직렬화 필요 `✓`.
- **`select_sequential_consistency`** — 읽기 일관성↑, 읽기 지연·가용성 일부 희생 `✓`.
- **`replicated_deduplication_window`** — 재시도가 중복이 안 되게 → **at-least-once를 사실상 exactly-once로** 만드는 근거.
- **`replicated_deduplication_window_seconds`** — 창을 넘겨 재시도하면 dedup 실패 → 중복 위험.

### at-least-once → exactly-once의 실제 조건

ReplicatedMergeTree는 **블록 단위 dedup이 기본 켜짐**이라, 같은 크기·같은 행·같은 순서의 블록은 한 번만 쓰입니다 — 해시섬은 Keeper `/clickhouse/tables/.../blocks/<hash>` znode(파티션별)에 저장됩니다 `✓`. 그래서 CH의 신뢰성 모델은 명시적으로 **"클라이언트가 재시도하고, 서버가 dedup으로 멱등을 보장"** 하는 조합입니다(*"client must retry"*) `✓`. 성립 조건은 다음과 같습니다 `✓`.

1. 재시도 시 **배치 내용·순서가 동일**해야 dedup이 성립한다(블록 해시 기반).
2. 재시도 사이에 dedup window(1000블록/7일)를 넘는 다른 INSERT가 끼면 dedup이 안 될 수 있습니다.
3. `insert_deduplication_token`을 주면 **데이터 해시 대신 토큰이 우선** → 재시도 안전성을 클라이언트가 통제합니다.
4. **async_insert는 `async_insert_deduplicate=1` 없이는 dedup 안 됨**(위 async 절).

핵심 명제는 이렇습니다: **Keeper는 "유실을 막는 큐"가 아니라 "재시도를 멱등으로 만들어 주는 dedup 저장소"** 입니다. 유실 자체를 막는 것은 (a) 클라이언트가 ack까지 데이터를 쥐고 재시도, (b) 필요하면 `insert_quorum`으로 확정 강도↑, (c) 그래도 부족하면 앞단의 실제 큐입니다.

### 유실이 발생하는 지점 정리

| 유실 지점 | 언제 | Keeper가 막아주나 | 방어 |
|---|---|---|---|
| 클라 → 서버 전송 중 네트워크 끊김 | 항상 가능 | ❌ | 클라 재시도 + dedup |
| async 버퍼 flush 전 크래시 | async_insert 사용 시 | ❌ | `wait_for_async_insert=1`(미ack→재시도)/앞단 큐 |
| fire-and-forget ack 후 크래시 | `wait=0` | ❌ | `wait=0` 지양 |
| 파트 커밋 후·복제 전 소실 | 단일 사본 창 | 부분(지시 복원, 단독보유 파트 유실) | `insert_quorum`, RF↑ → [로컬 NVMe]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}}) |
| Keeper 정족수 상실 | Keeper 과반 소실 | — (쓰기 자체 차단) | 3/5노드·gp3·AZ 분산 → [operator 배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}}) |
| 앞단 없음(직결) + 다운타임 | CH 유지보수·과부하 | ❌ | OTel persistent queue / Kafka(아래) |

## 유실 방지 설계 — 신뢰 ingest는 앞단이 만든다

CH 내부 노브로는 "재시도 멱등"과 "확정 강도"까지만 삽니다. **CH가 다운타임/과부하일 때 in-flight 이벤트를 붙잡아 둘 곳**은 CH 앞단의 실제 큐입니다.

### 옵션 A — OTel Collector persistent queue (RUM 규모 1순위)

OTel Collector `exporterhelper`의 `sending_queue`는 **기본이 in-memory**(크래시 시 유실, `queue_size=1000` 배치, `num_consumers=10`)이지만, **storage 확장(`file_storage`)을 붙이면 디스크 persistent queue(WAL)**가 됩니다 `✓`. 원문 요지: *"If the collector instance is killed while having some items in the persistent queue, on restart the items will be picked and the exporting is continued."* 큐가 가득 차면 기본 `block_on_overflow=false` → **드롭**, `true`면 공간이 날 때까지 블록합니다 `✓`.

주의할 점: `file_storage` 확장이 **배포하는 Collector 배포판/빌드에 기본 포함되는지는 `?`**(contrib 계열엔 있으나 배포판마다 다르며, persistent queue가 core로 승격되며 구성 키가 이동한 이력도 있습니다). 도입 Collector 버전의 `exporterhelper` README로 `sending_queue.storage`·`block_on_overflow` 키를 반드시 재확인합니다(버전별로 다를 수 있음) `?`. 한계도 명확합니다 — (1) 단일 Collector 인스턴스 로컬 디스크에 묶임(Kafka식 다중 소비자·장기 replay 아님), (2) export 성공 후 ack 유실 시 **중복 가능**(정확한 exactly-once 아님), (3) Auth 확장 컨텍스트는 persistent queue를 통과 못합니다 `✓`.

```yaml
# OTel Collector — CH 앞단 디스크 persistent queue (RUM ingest 유실 방어)
extensions:
  file_storage/otc:
    directory: /var/lib/otelcol/sending-queue   # PVC(영속) 위에
    timeout: 10s

exporters:
  clickhouse:
    endpoint: tcp://clickhouse:9000
    database: otel
    # CH 배칭·async는 CH쪽 노브와 함께 튜닝
    sending_queue:
      enabled: true
      storage: file_storage/otc      # ← 이 한 줄이 메모리→디스크 WAL로 바꾼다
      queue_size: 10000              # 배치 수(다운타임 흡수량 = queue_size × 배치)
      num_consumers: 10
      block_on_overflow: true        # 가득 차면 드롭 대신 블록(유실 방지 우선)
    retry_on_failure:
      enabled: true
      initial_interval: 5s
      max_interval: 30s
      max_elapsed_time: 300s         # 0이면 무한 재시도

service:
  extensions: [file_storage/otc]
  pipelines:
    logs:
      receivers: [otlp]
      processors: [batch]            # CH 파트 폭증 방지: 서버측 배칭
      exporters: [clickhouse]
```

Collector 배치·사이징(피크 MB/s 기준)은 [스택 토폴로지]({{< relref "01-stack-topology.md" >}})를, PVC 사이징은 [용량 산정]({{< relref "07-capacity-planning.md" >}})을 따릅니다.

{{% details title="옵션 B — 앞단 Kafka + Kafka table engine (대규모·강한 디커플링, 우리는 채택 안 함)" closed="true" %}}
전형 패턴은 **Kafka engine 테이블 → Materialized View → MergeTree** 입니다 `✓`. Kafka에서 읽기는 offset을 커밋하는 파괴적 읽기라 MV로 MergeTree에 흘려야 영속됩니다. Kafka가 주는 것: 스파이크·CH 유지보수 창 버퍼링, 프로듀서/소비자 디커플링, retention 내 replay, 다중 소비자, ingest 버스트로부터 CH 격리 `✓`. 신뢰성은 **Kafka가 데이터를 쥐고 있어** ingestor가 드레인까지 재시도하는 구조이고, consumer lag(`system.kafka_consumers`)이 1차 지표입니다 `✓`. 단 Kafka 클러스터 운영 오버헤드가 추가돼 **소~중규모 관측성엔 과합니다** `Ⓥ`.
{{% /details %}}

### 우리 RUM 케이스 결정 프레임

| 판단 축 | RUM 0.7TB/월 상황 | 결론 |
|---|---|---|
| 규모 | 소~중규모(월 0.7TB ≈ 일 ~23GB, 이벤트/초 낮음) | Kafka의 초고 throughput 명분 부재 `≈` |
| replay·다중 소비자 필요? | RUM 단일 소비(HyperDX/CH) | 불필요 → Kafka 명분 약함 `≈` |
| 다운타임 흡수 | CH 롤링·재수화 창 동안 이벤트 보호 필요 | **OTel persistent queue로 충분** `≈` |
| 운영 단순성(EBS-first 전제) | 운영 단순성 우선 | Kafka 추가 운영 회피 우선 `≈` |

## 우리 케이스에서는

Keeper를 "죽어도 데이터가 안전한 큐"로 착각하지 않는 것에서 설계를 시작합니다. Keeper는 **CHK 3노드**(gp3 영속·AZ 분산·CH와 분리 배치)로 조정만 담당하고, 이벤트 데이터의 내구성은 별도 층위에서 만듭니다. 배치·정족수 매니페스트·업그레이드는 clickhouse 카테고리 문서를 그대로 따릅니다.

이벤트 유실 방어는 세 겹으로 고정합니다. ① OTel Collector에 **`file_storage` persistent queue**를 붙여(`block_on_overflow: true`) CH 롤링·재수화·버스트 구간의 in-flight 이벤트를 디스크에 붙잡습니다 — 단, 이 확장이 배포 Collector 빌드에 포함되는지와 구성 키는 도입 시점에 재확인합니다(버전별로 다를 수 있음) `?`. ② CH쪽은 **`async_insert=1, wait_for_async_insert=1` + `async_insert_deduplicate=1`**로 배칭과 재시도 멱등을 함께 켭니다(작은 파트 폭증을 막아 Keeper 부하도 낮춥니다). ③ 신뢰가 더 필요한 경로에만 **`insert_quorum`(+RF3)**을 선택 적용합니다. **앞단 Kafka는 이 스케일에선 과투자**이므로, "여러 신호·다중 소비자·장기 replay·초고 throughput"이 실제로 요구될 때 earn-it-last로 미룹니다 `≈`.

마지막으로, 위 dedup 창 기본값(1000블록/7일)과 async_insert 기본값은 버전에 따라 달라질 수 있으니(값 재확인 권장) 배포 CH 버전의 `merge-tree-settings`/`SHOW CREATE TABLE`로 1회 실측 확인합니다 `✓`. 시점 기준 2026-07.
