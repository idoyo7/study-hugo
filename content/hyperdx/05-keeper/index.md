---
title: "ClickHouse Keeper — 조정 계층이지 durable queue가 아니다"
date: 2026-08-01
lastmod: 2026-08-24
weight: 5
---

# ClickHouse Keeper와 수집 데이터의 내구성

ClickHouse에 이벤트를 보낸 직후 서버가 꺼졌다고 가정해 봅니다. Keeper 세 대가 모두 살아 있어도 수신 중이던 이벤트를 대신 보관해 주지는 않습니다. 이벤트 본문은 ClickHouse 서버로 직접 들어가고, Keeper에는 복제를 진행하는 데 필요한 메타데이터만 남기 때문입니다.

이 차이는 수집 경로를 설계할 때 드러납니다. 서버가 응답하지 않을 때 누가 데이터를 보관할지, 성공 응답은 어느 시점에 보낼지, 재시도한 배치를 어떻게 중복 없이 넣을지를 각각 정해야 합니다. 여기서는 HyperDX의 RUM 수집 경로를 따라 이 세 가지를 살펴봅니다.

Keeper는 Altinity CHK(`ClickHouseKeeperInstallation`)로 데이터 노드와 분리해 운영합니다. gp3 영속 볼륨과 배치는 [스토리지·로컬 NVMe]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}}), 정족수와 `insert_quorum` 설정은 [배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}}), CHK 업그레이드는 [Altinity operator 운영]({{< relref "../../clickhouse/05-altinity-operations.md" >}})에 정리해 두었습니다.

## Keeper에 남는 정보 {#keeper-기초--무엇이고-무엇을-저장하나}

복제 로그를 각 replica가 읽고 작업을 실행하는 과정은 [복제·멀티마스터·failover]({{< relref "06-replication-failover.md" >}})에서 이어집니다.

Keeper는 C++로 구현한 분산 조정 서비스이며 NuRaft를 사용해 Raft 합의를 수행합니다. ZooKeeper 클라이언트 프로토콜과 호환되어 기존 클라이언트가 접속할 수 있습니다. 다만 스냅샷·로그 포맷과 서버 간 프로토콜까지 호환되지는 않아 ZooKeeper에서 이전할 때는 변환 절차가 필요합니다. 기본 읽기는 선형화되지 않으며, 선형화된 읽기를 지원한다는 설명과 기본 동작을 구분해야 합니다.

Keeper가 쓰기를 처리하려면 `floor(N/2)+1`대가 필요합니다. 3대 구성은 1대, 5대 구성은 2대의 손실을 견딥니다. 4대는 3대와 같은 수의 장애만 견디므로 이 구성을 택할 이점이 작습니다. 과반을 잃으면 복제 테이블의 새 쓰기와 조정 작업이 멈추며, 이미 저장된 로컬 데이터는 읽을 수 있습니다. AZ 분산과 정족수 복구 절차는 [operator 토폴로지·다운타임]({{< relref "04-operator-topology-downtime.md" >}})을 참고합니다.

### 복제와 DDL의 조정 상태 {#keeper가-저장하는-것-사용자-데이터-아님}

Keeper는 znode 트리(작은 키-값)로 복제·분산 실행의 조정 상태만 담습니다. 실제 테이블 행·파트 바이트는 담지 않습니다.

| 저장 대상 | 내용 | znode 경로(예) |
|---|---|---|
| **복제 로그(replication log)** | 로그 엔트리(파트·소비 추적)¹ | `/clickhouse/tables/{shard}/{table}/log/log-000…` `✓` |
| **replica별 큐(queue)** | 각 replica가 아직 안 가져온 작업(파트 fetch·머지 지시) | `.../replicas/{r}/queue/…` `✓` |
| **part 할당·블록 번호** | 중복 방지용 블록 번호 배정, 어느 파트가 존재하는지 | `.../block_numbers/`, `.../parts/` `✓` |
| **INSERT dedup 체크섬** | 블록 해시섬(파티션별 znode) → 재시도 멱등의 근거 | `/clickhouse/tables/…/blocks/<hash>` `✓` |
| **분산 DDL 큐(ON CLUSTER)** | DDL 태스크(직렬 znode 순서) + 노드별 완료 | `/clickhouse/task_queue/ddl/query-000…` `✓` |
| **leader election / ephemeral 락** | 머지·mutation 리더, 세션 소멸 시 자동 삭제되는 임시 노드 | ephemeral znodes `✓` |

¹ INSERT·MERGE·MUTATION을 로그 엔트리로 기록 — 어떤 파트가 생겼고 각 replica가 어디까지 소비했는지 추적합니다.

파트 본문은 replica끼리 직접 전송합니다. Keeper에는 어느 replica가 어떤 파트를 갖고 있는지, 각 replica가 어떤 작업을 해야 하는지가 기록됩니다. 로컬 파트를 읽는 SELECT는 Keeper를 거치지 않습니다.

따라서 Keeper 부하는 저장한 GB보다 INSERT와 파트 생성 빈도에 더 민감합니다. 공식 복제 설명의 근사치는 INSERT당 약 10개 엔트리입니다. 같은 데이터량이라도 작은 INSERT로 쪼개면 조정 작업이 늘어나므로 배칭은 데이터 디스크와 Keeper 양쪽의 부하를 줄입니다. 아직 파트가 되지 않은 수신 버퍼와 쿼리 결과·캐시는 이 znode 트리에 저장되지 않습니다.

{{< flow src="_flow/keeper-가-저장하는-것.json" />}}

## 이벤트 큐가 필요한 자리 {#핵심-정정--keeper는-kafka큐가-아니다}

Keeper의 `task_queue`, replica `queue`, replication `log`에는 모두 큐라는 이름이 붙습니다. 하지만 그 안에 들어가는 것은 DDL, 파트 참조, 머지 지시입니다. Kafka에 저장된 이벤트는 retention 안에서 다시 읽을 수 있지만, Keeper의 복제 로그만으로 이벤트 본문을 재생할 수는 없습니다.

### Kafka·ZooKeeper·Keeper 비교 {#kafka-vs-zookeeper-vs-clickhouse-keeper--3자-비교}

| 축 | **Kafka (로그/큐)** | **ZooKeeper** | **ClickHouse Keeper** |
|---|---|---|---|
| 근본 목적 | 메시지 **본문** durable 적재·보존·재생 | 분산 조정(구성·락·리더) | 분산 조정(복제 메타·DDL, ZK의 CH 특화) |
| 담는 것 | **프로듀서가 보낸 데이터 그 자체** | 소량 조정 상태(znode) | 소량 조정 상태(znode) — 파트 참조·로그·체크섬 |
| 데이터 보존 | retention 기간 동안 디스크 보존, **replay 가능** | 조정 상태만(작음) | 조정 상태만(작음) |
| 합의 | ISR/replication (Raft: KRaft) | ZAB | **NuRaft(Raft)** |
| CH ingest에서 위치 | (선택) CH **앞단** 버퍼·디커플링 | (구) CH 조정 백엔드 | CH 조정 백엔드(기본) |
| "이벤트 유실 방어" | ✅ 앞단에서 스파이크·다운타임 흡수·재생 | ❌ 이벤트 데이터 안 담음 | ❌ **이벤트 데이터 안 담음** |

수집 중단을 흡수하려면 데이터를 보관하는 큐가 ClickHouse 앞에 있어야 합니다. Keeper를 늘리는 것으로 그 역할을 대신할 수는 없습니다.

### 서버 종료 시 수신 중이던 데이터 {#ch가-죽으면-in-flight-insert는-어디에도-큐잉되지-않는다}

데이터 경로를 그려 보면 유실 지점이 드러납니다.

{{< seq src="_seq/ch-가-죽으면-in.json" />}}

동기 INSERT는 서버에서 파트를 기록하고, `async_insert`는 여러 요청을 서버 메모리에 모았다가 flush합니다. 서버가 이 과정에서 종료되면 메모리에만 있던 이벤트는 사라집니다. 송신자가 아직 응답을 기다리며 원본을 보관하고 있다면 재시도할 수 있지만, Keeper에서 찾아 복구할 수는 없습니다.

이미 기록한 파트도 어느 replica에 남아 있는지에 따라 결과가 달라집니다. 다른 replica가 가져갈 수 있는 사본이 있으면 복제 로그를 따라 복구하고, 유일한 사본을 잃었다면 로그에 파트 이름이 남아 있어도 본문은 돌아오지 않습니다.

## 비동기 INSERT의 성공 응답 시점 {#async_insert-세만틱--메모리-버퍼는-휘발이다}

이 절의 dedup 설정은 배포안의 ClickHouse 24.8을 전제로 합니다. RUM은 작은 이벤트가 많아 서버 측 배칭이 유용합니다. `async_insert`를 사용할 때는 배칭 여부와 함께 `wait_for_async_insert`를 확인해야 합니다. 이 값이 성공 응답의 시점을 바꿉니다. [공식 비동기 INSERT 문서](https://clickhouse.com/docs/concepts/features/operations/insert/asyncinserts)의 응답 모드 설명을 참고했습니다.

| 설정 | ack 시점 | 유실 성격 |
|---|---|---|
| `async_insert=1, wait_for_async_insert=1` (기본·권장) | **디스크 flush 후** ack | 메모리 버퍼에만 남은 상태에서 성공 응답하지 않음 |
| `async_insert=1, wait_for_async_insert=0` (fire-and-forget) | **버퍼링 즉시** ack | **ack 받아도 크래시 시 유실 가능** `✓/Ⓥ` |

`wait_for_async_insert=1`이면 flush 전 크래시는 성공 여부가 확정되지 않은 요청으로 남습니다. 송신자는 원본을 보관하고 재시도해야 합니다. 반면 `=0`은 메모리에 넣자마자 응답하므로 성공 응답 뒤에도 버퍼 데이터를 잃을 수 있고, 이후 flush 오류를 원래 요청에 전달하기도 어렵습니다. RUM에서도 `=1`을 유지하는 이유입니다. 다만 flush 완료가 여러 replica에 복제됐다는 뜻은 아니며, 사본 수에 대한 보장은 `insert_quorum`과 함께 판단합니다.

버퍼는 서버 in-memory이고 insert 쿼리 shape+settings 조합마다 따로 쌓입니다. flush는 아래 트리거 중 먼저 도달한 것에서 일어납니다(값은 도입 CH 버전·Cloud 여부에 따라 다르므로 재확인).

| 설정 | 기본값 | 의미 |
|---|---|---|
| `async_insert_max_data_size` | **100 MiB** | 버퍼 누적 크기 상한 |
| `async_insert_busy_timeout_ms` | **200 ms** (Cloud 1000 ms) | 시간 상한(24.2+ 적응형: 유입률 따라 50~200 ms 동적) |
| `async_insert_max_query_number` | **450** | 누적 INSERT 쿼리 수 상한 |

`Buffer` 엔진 역시 메모리에 남은 데이터가 크래시로 사라질 수 있습니다. 재시도 중복도 따로 처리해야 합니다. 비동기 INSERT의 dedup을 사용할 때는 `async_insert_deduplicate=1`을 확인하고, 사용 버전과 수집 경로에서 재시도 결과를 시험합니다.

{{< flow src="_flow/async-insert-세만틱-메모리.json" />}}

## 사본 확정과 재시도 설정 {#내구성-노브--유실-확률을-줄이는-도구지-큐-대체가-아니다}

`insert_quorum`은 성공 응답 전에 확보할 사본 수를 정합니다. RF3와 함께 쓰는 이유와 profiles/users.xml에 넣는 방법은 [배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})에 있습니다. 아래 설정은 복제 확정과 재시도를 다루며, ClickHouse가 요청을 받지 못하는 동안 이벤트를 보관해 주지는 않습니다.

| 설정 | 기본값 | 역할 |
|---|---|---|
| `insert_quorum = N` | 0(비활성) `✓` | 최소 N replica가 파트를 확정한 뒤 ack |
| `insert_quorum_parallel` | 1(병렬 허용) `✓` | 같은 테이블 동시 quorum INSERT 허용 |
| `select_sequential_consistency` | 0 `✓` | quorum 확정 데이터만 읽음 |
| `replicated_deduplication_window`(값 재확인 권장) | **1000**(블록) `✓` | 최근 N개 블록 해시를 Keeper에 보관(재시도 멱등) |
| `replicated_deduplication_window_seconds`(값 재확인 권장) | **604800**(7일) `✓` | dedup 해시의 시간 창 |

`insert_quorum=N`이면 N개 replica의 확정을 기다립니다. 그만큼 사본을 확보할 수 없는 동안은 쓰기를 완료할 수 없으므로, RF2에서 한 대를 정비하며 quorum 2를 유지하면 쓰기가 막힙니다.

읽기 일관성 설정은 별도의 선택입니다. `insert_quorum_parallel`과 `select_sequential_consistency`의 조합은 읽을 수 있는 replica와 동시 INSERT 동작에 영향을 줍니다. 엄격한 read-after-write가 필요한 경로에서 사용 버전의 제약을 확인해 적용합니다.

Dedup window는 재시도 시 같은 블록을 알아볼 수 있는 범위입니다. 블록 수나 시간 한도를 넘으면 이미 처리한 배치도 새 입력으로 들어갈 수 있습니다.

### 중복 제거가 성립하는 조건 {#at-least-once--exactly-once의-실제-조건}

ReplicatedMergeTree는 최근 INSERT 블록의 해시를 Keeper에 보관합니다. 같은 크기·행·순서로 만든 블록을 다시 보내면 이 기록으로 중복을 제거합니다. 따라서 재시도 안전성은 서버 설정만으로 완성되지 않습니다. 클라이언트가 같은 배치를 다시 만들 수 있어야 하고, 서버가 그 배치의 기록을 아직 갖고 있어야 합니다.

1. 재시도 시 배치 내용·순서가 같아야 dedup이 성립합니다(블록 해시 기반).
2. 재시도 사이에 dedup window(1000블록/7일)를 넘는 다른 INSERT가 끼면 dedup이 안 될 수 있습니다.
3. `insert_deduplication_token`을 주면 데이터 해시 대신 토큰이 우선 → 재시도 안전성을 클라이언트가 통제합니다.
4. async_insert는 `async_insert_deduplicate=1` 없이는 dedup이 안 됩니다(위 async 절).

이 조건 안에서는 다른 replica로 재시도해도 중복을 제거할 수 있습니다. 무제한의 exactly-once 보장으로 해석해서는 안 됩니다. 성공 응답까지 원본을 보관하는 책임은 송신자에게 남고, ClickHouse 중단이 길어질 가능성이 있으면 디스크 큐가 필요합니다.

### 유실 지점과 대응 {#유실이-발생하는-지점-정리}

| 유실 지점 | 언제 | Keeper가 막아주나 | 방어 |
|---|---|---|---|
| 클라 → 서버 전송 중 네트워크 끊김 | 항상 가능 | ❌ | 클라 재시도 + dedup |
| async 버퍼 flush 전 크래시 | async_insert 사용 시 | ❌ | `wait_for_async_insert=1`(미ack→재시도)/앞단 큐 |
| fire-and-forget ack 후 크래시 | `wait=0` | ❌ | `wait=0` 지양 |
| 파트 커밋 후·복제 전 소실 | 단일 사본 창 | 부분(지시 복원, 단독보유 파트 유실) | `insert_quorum`, RF↑ → [로컬 NVMe]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}}) |
| Keeper 정족수 상실 | Keeper 과반 소실 | — (쓰기 자체 차단) | 3/5노드·gp3·AZ 분산 → [operator 배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}}) |
| 앞단 없음(직결) + 다운타임 | CH 유지보수·과부하 | ❌ | OTel persistent queue / Kafka(아래) |

## Collector에 이벤트를 보관하기 {#유실-방지-설계--신뢰-ingest는-앞단이-만든다}

수집기가 재시도를 맡더라도 재시작하면서 메모리 큐를 잃으면 이벤트를 보낼 수 없습니다. ClickHouse 유지보수와 수집기 재시작을 함께 고려하면 앞단 큐를 영속화할 필요가 생깁니다.

### OTel Collector 영속 큐 {#옵션-a--otel-collector-persistent-queue-rum-규모-1순위}

OTel Collector의 `sending_queue`는 기본적으로 메모리에 배치를 보관합니다. `file_storage`를 연결하면 디스크에 기록해 수집기 재시작 후에도 남은 배치의 전송을 이어갈 수 있습니다. 이 글이 확인한 설정의 기본 큐 크기는 1,000배치, 소비자는 10개입니다. 큐가 찼을 때 `block_on_overflow=false`이면 드롭하고, `true`이면 공간을 기다립니다. 디스크 용량과 상류의 대기·재시도 동작도 함께 맞춰야 합니다.

배포할 Collector 빌드에 `file_storage`가 포함되어 있는지와 `sending_queue.storage`, `block_on_overflow` 키를 지원하는지는 아직 확인이 필요합니다. 도입 버전의 `exporterhelper` 문서와 실제 설정 검증으로 확정합니다. 큐는 해당 Collector의 디스크에 묶이며 장기 replay나 여러 소비자를 위한 저장소는 아닙니다. export 성공 뒤 응답만 유실되면 중복 전송이 가능하고, Auth 확장 컨텍스트가 영속 큐를 통과하지 못한다는 제약도 있습니다.

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
Kafka를 쓰는 구성은 Kafka engine 테이블에서 읽은 데이터를 Materialized View로 MergeTree에 넣습니다. Kafka engine의 소비 offset과 MergeTree의 저장 결과를 함께 관리하며 `system.kafka_consumers`의 consumer lag를 관찰합니다. Kafka는 ClickHouse 중단 중의 버퍼링, retention 안의 replay, 다중 소비자에 유용하지만 별도 클러스터 운영이 추가됩니다. 이 RUM 경로에서는 우선 Collector 영속 큐의 용량과 복구 동작을 검증합니다.

{{% /details %}}

### 월 0.7TB RUM에서의 큐 선택 {#우리-rum-케이스-결정-프레임}

| 판단 축 | RUM 0.7TB/월 상황 | 결론 |
|---|---|---|
| 규모 | 소~중규모(월 0.7TB ≈ 일 ~23GB, 이벤트/초 낮음) | Kafka의 초고 throughput 명분 부재 `≈` |
| replay·다중 소비자 필요? | RUM 단일 소비(HyperDX/CH) | 불필요 → Kafka 명분 약함 `≈` |
| 다운타임 흡수 | CH 롤링·재수화 창 동안 이벤트 보호 필요 | **OTel persistent queue로 충분** `≈` |
| 운영 단순성(EBS-first 전제) | 운영 단순성 우선 | Kafka 추가 운영 회피 우선 `≈` |

## 수집 경로에 적용할 설정 {#우리-케이스에서는}

월 0.7TB RUM 모델에서는 Collector의 영속 큐로 ClickHouse 유지보수 시간을 흡수하는 구성을 검토합니다. 배포판에 `file_storage`가 있는지 확인한 뒤 큐를 PVC에 두고, ClickHouse를 잠시 중단해 배치가 남는지와 재개 후 전송되는지를 시험합니다. Collector 배치 크기는 [스택 토폴로지]({{< relref "01-stack-topology.md" >}}), 디스크 산정은 [용량 산정]({{< relref "07-capacity-planning.md" >}})과 연결해 정합니다.

ClickHouse는 `async_insert=1`, `wait_for_async_insert=1`로 배칭하되 비동기 dedup 설정과 재시도 배치의 동일성을 함께 확인합니다. 더 강한 쓰기 내구성이 필요한 경로에는 RF3와 `insert_quorum`을 검토합니다. Keeper는 gp3에 영속화한 3노드를 AZ와 데이터 노드에 분산해 조정 계층을 유지합니다.

설정 기본값과 Collector 확장 지원 여부는 2026-07에 정리한 내용입니다. 도입 버전에서 dedup window와 비동기 INSERT 설정을 확인해야 하며, 다중 소비자나 장기 replay가 필요해지면 Kafka를 다시 검토합니다.
