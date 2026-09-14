---
title: "로컬 NVMe 하드 유저들 — 데이터스토어 횡단 벤치마킹"
date: 2026-07-14
lastmod: 2026-08-24
weight: 7
---

# 데이터스토어별 로컬 NVMe 운영과 복구 {#로컬-nvme-하드-유저들--데이터스토어-횡단-벤치마킹}

로컬 NVMe를 데이터스토어의 주 디스크로 쓰면 노드 장애 뒤에 데이터를 다시 채우는 작업이 따라옵니다. ClickHouse만의 문제는 아닙니다. ScyllaDB는 스트리밍 속도를 개선하고, CockroachDB는 작은 노드에 데이터를 분산하도록 권하며, 일부 TiDB 사용자는 복구 시간 때문에 EBS를 검토합니다.

이 글은 ScyllaDB·Cassandra·Kafka·Redpanda·ES/OpenSearch·Aerospike·TiKV/TiDB·CockroachDB를 ClickHouse와 비교합니다. 디스크 사용 방식, 복제·백업, S3 저장, Kubernetes 볼륨, 노드 교체 절차를 살펴봅니다. WarpStream류 diskless 설계도 S3 활용 방식의 차이를 설명하는 데 참고했습니다.

로컬 NVMe를 사용한다는 공통점이 있어도 각 시스템의 내구성과 S3 사본 구조까지 같지는 않습니다. 비교 결과는 [ClickHouse 스토리지 설계]({{< relref "02-storage-local-nvme.md" >}})의 복구 절차와 비용 계산에 반영합니다. 근거 등급은 기존 조사의 `✓`·`Ⓥ`·`≈`·`?`를 유지하며, 이 글의 해석은 `Σ`입니다. 원문은 [출처]({{< relref "10-sources.md" >}})에 있습니다.

## 로컬 디스크·복제·S3를 결합하는 방식 {#결론-먼저--세-층위로-나눈-표준}

고성능 데이터스토어에서 로컬 NVMe와 애플리케이션 복제는 널리 쓰입니다. 다만 백업이나 영속 미러를 추가하는 방식, S3에 보존하는 방식은 제품에 따라 다릅니다. 디스크 선택과 복구 설계를 함께 비교해야 합니다.

### 로컬 NVMe를 사용하는 시스템 {#확실히-표준인-것-거의-만장일치}

- 로컬 NVMe를 1차 스토리지로 쓰는 사례가 널리 확인됩니다. Aerospike·ScyllaDB·CockroachDB·(대규모)TiDB·ES hot 티어·Redpanda·클래식 Kafka·MongoDB Atlas NVMe가 모두 성능 극단에서 휘발성 로컬 NVMe를 1차로 씁니다 `✓`. ScyllaDB Operator는 네트워크 스토리지를 아예 "프로덕션 부적합"으로 명시합니다 `✓`.
- 인스턴스 패밀리까지 수렴합니다. Aerospike(i3en/i4i)·ScyllaDB(i3en/i4i/i7i/i7ie/i8g/i8ge)·ES(i3→i3en→i4i→i7i→i8g→i8ge)·TiDB(i4i)가 동일한 storage-optimized 계보를 탑니다. i7i/i8g가 "SSD-native 데이터스토어의 사실상 표준 인스턴스"입니다 `✓`. 인스턴스 선택에 참고할 수 있지만 하드웨어 장애와 복구 위험은 남습니다.
- 내구성은 디스크가 아니라 애플리케이션 계층 복제(RF)로 만듭니다. "노드 소실 = 데이터 소실, 하지만 복제본이 있으니 괜찮다"가 공통 설계입니다 `✓`.
- 로컬 디스크의 정직한 대가는 복제 팩터 상향입니다. CockroachDB는 "로컬 디스크는 네트워크 스토리지보다 잘 죽으니 RF를 3→5로 올려라"라고 명문화합니다. ClickHouse의 "로컬이면 replica 2→3"와 같은 논리입니다 `✓`.

### 복제 외에 남겨두는 백업과 영속 사본 {#표준이지만-오해되는-것--복제만으로-충분은-거짓에-가깝다}

복제본은 노드 장애에는 유용하지만 잘못된 삭제나 논리 손상도 전파할 수 있습니다. 조사한 시스템들은 백업, 스냅샷, 별도 영속 미러를 제공합니다. 각 방식의 RPO와 복구 대상은 다릅니다 `Σ`.

| 시스템 | 복제 위에 얹는 지속 티어 |
|---|---|
| Aerospike | **shadow device** — 로컬 NVMe(primary) + EBS(shadow)에 동기 write 미러(RPO≈0) `✓` |
| MongoDB Atlas NVMe | **Cloud Backup 강제** — NVMe 클러스터는 백업 비활성화 불가 `✓` |
| ScyllaDB | Scylla Manager 스냅샷 → S3/GCS 백업 `✓` |
| Netflix (Cassandra) | EBS 스냅샷 S3 플래싱(datastore flash upgrades) `✓` |
| ClickHouse | **clickhouse-backup → S3**(주간 full + 일간 incremental) `✓` |

{{< callout type="warning" >}}
[ClickHouse 스토리지 설계]({{< relref "02-storage-local-nvme.md" >}})에서도 replica와 별도로 S3 백업을 유지합니다. 주기 백업과 영속 미러는 보호하는 장애·RPO가 다르므로 같은 보장으로 계산하지 않습니다.

{{< /callout >}}

### S3 사본과 캐시의 관계 {#표준이-갈라지는-것--s3-티어링의-두-얼굴}

S3 활용 방식을 비교할 때는 누가 원본을 쓰고 어떤 사본을 공유하는지 확인해야 합니다. ClickHouse self-host RMT는 replica별 S3 경로를 유지합니다. SharedMergeTree는 공유 스토리지를 사용합니다. 아래 모델 구분은 이 차이를 설명하기 위한 것이며 제품별 복제 구현을 대신하지 않습니다.

- 모델 A — shared-nothing 티어링(사본 배수 유지): 각 replica가 S3에도 자기 사본을 둡니다. RF2면 S3에 2벌. 이 글의 ClickHouse RMT 구성은 이 방식입니다. ClickHouse self-host S3 cold의 비용은 이 사본 수를 반영합니다. Kafka KIP-405와 Redpanda의 원격 사본 수는 이 조사에서 확인하지 못했으므로 RMT와 같은 RF배수를 적용하지 않습니다 `?`.
- 모델 B — shared-storage(사본 1벌 + 컴퓨트 캐시): S3에 단일 사본, 로컬은 순수 캐시, replica 불필요. 거의 전부 관리형·유료·독점입니다. OpenSearch UltraWarm·OR1, ClickHouse Cloud SharedMergeTree, WarpStream류 diskless가 여기 속합니다.

> ClickHouse OSS의 `plain_rewritable` + readonly part refresh는 S3의 한 사본을 여러 서버가 읽는 경로입니다. mutation과 테이블 복제를 지원하지 않아 이 글의 RMT 구성에는 적용하지 않았습니다. 제약은 [S3 primary 검토]({{< relref "02-storage-local-nvme.md" >}})에 있습니다.

스트리밍 진영이 정리한 "로컬 hot ↔ S3 cold" 5단계 스펙트럼에 놓고 보면 ClickHouse self-host의 좌표가 분명해집니다 `Σ`:

```
① 로컬 only       ② 로컬 hot + S3 cold      ③ WAL 로컬 + 데이터 S3   ④ S3 only(diskless)   ⑤ 서버리스
  (── 모델 A: 사본 배수 유지 ──)             (──────── 모델 B: 사본 1벌 / 벤더 관리 ────────)
 클래식 Kafka      Kafka KIP-405             AutoMQ                WarpStream/Freight     MSK Express*
 Cassandra         Redpanda Tiered Storage                        KIP-1150 Diskless      CH Cloud SMT
 Aerospike(로컬)   ES hot + searchable snap                                              UltraWarm / OR1*
 ScyllaDB          ★ ClickHouse self-host ★                       (µs 지연과 충돌)       (*=관리형/독점)
```

위 도식의 ②는 hot/cold 배치만 비교한 것입니다. 모델 A의 사본 배수 표시는 이 글의 ClickHouse RMT에 한정하며 Kafka·Redpanda의 S3 사본 수를 뜻하지 않습니다 `?`. 이 글의 ClickHouse 구성은 ②처럼 로컬 hot과 S3 cold를 나눕니다. 스트리밍 시스템에도 비슷한 배치가 있지만 적재 지연과 쿼리 방식은 다릅니다. [OpenSearch UltraWarm]({{< relref "../logging/01-opensearch.md" >}})의 공유 S3 사본 절감을 RMT 비용표에 적용할 수 없는 이유도 복제 구조가 다르기 때문입니다.

## 9개 시스템 횡단 비교표

같은 다섯 축(로컬 디스크 활용·내구성 모델·S3 티어링 대응물·k8s local PV 성숙도·노드 교체 런북)으로 9개 시스템을 나란히 놓습니다. ClickHouse도 그 벤치마킹 대상들과 같은 표에 편입합니다.

### 로컬 디스크 활용 · 내구성 모델

| 시스템 | 로컬 디스크 활용 방식 |
|---|---|
| **ScyllaDB** | 로컬 NVMe **1차 강제**(RAID0+XFS 자동). 네트워크 스토리지=프로덕션 부적합 명시 |
| **Cassandra** | 인스턴스 스토어가 범용 배포 최선(성능). EBS는 운영편의·읽기편중용 이분법 |
| **Kafka(클래식)** | 로컬 NVMe 또는 EBS(순차 I/O라 EBS도 실용적) |
| **Redpanda** | 로컬 NVMe **극한 활용**(XFS + thread-per-core + 직접 I/O) |
| **ES / OpenSearch** | hot 티어의 로컬 NVMe 사용 사례가 있음. frozen 노드에서는 S3 원본을 위한 로컬 캐시로 활용 |
| **Aerospike** | 로컬 NVMe를 **raw device로 직접**(파일시스템 우회). index=RAM |
| **TiKV / TiDB** | Operator: **TiKV엔 로컬 SSD 강력 권장**, PD(메타)만 gp3 |
| **CockroachDB** | 로컬 SSD가 네트워크 부착보다 **우수**하다고 명시 |
| **ClickHouse (self-host)** | 로컬 NVMe(i7i/i8g, RAID0) 1차. gp3는 Keeper 데이터용 |

같은 시스템의 내구성 모델은 표를 나눠 봅니다:

| 시스템 | 내구성 모델 |
|---|---|
| **ScyllaDB** | RF3 + 멀티 AZ rack awareness. "노드 소실=데이터 소실, 복제가 durability" |
| **Cassandra** | RF3 + NetworkTopologyStrategy(1 AZ=1 rack) + hinted handoff·repair |
| **Kafka(클래식)** | RF3 복제(3 AZ), ISR·acks. 휘발성은 앱 계층 복제로 방어 |
| **Redpanda** | Raft 기반 파티션 replica 복제(ClickHouse RMT와 동일 원칙) |
| **ES / OpenSearch** | hot=replica로 내구성(shard≤50GB). cold/frozen=snapshot이 durability |
| **Aerospike** | RF + rack awareness + **shadow device(EBS 동기 미러)** + SC 모드 |
| **TiKV / TiDB** | RocksDB(LSM) + Raft 3중 복제 |
| **CockroachDB** | Pebble(LSM) + Raft. **로컬이면 RF 3→5** 상향 |
| **ClickHouse (self-host)** | ReplicatedMergeTree replica 2~3 멀티 AZ + Keeper |

### S3 티어링 대응물 · k8s local PV 성숙도 · 노드 교체 런북

| 시스템 | S3 티어링(모델 A/B) |
|---|---|
| **ScyllaDB** | 로드맵/experimental(S3-backed keyspace). 백업은 Manager→S3 **(모델 미확정)** |
| **Cassandra** | **네이티브 없음**. TWCS + 외부백업(Medusa→S3) (모델 A 미만) |
| **Kafka** | KIP-405 GA(3.9). 원격 사본 수와 RMT식 RF배수 적용 여부는 미확인 `?`. RSM(S3 어댑터)은 별도 필요 |
| **Redpanda** | Tiered Storage(Shadow Indexing)와 `cache_service` 사용. 원격 사본 수와 RMT식 RF배수 적용 여부는 미확인 `?` |
| **ES / OpenSearch** | searchable snapshots — **OpenSearch=무료(모델 B)**, **ES=Enterprise 유료**. UltraWarm/OR1=관리형 모델 B |
| **Aerospike** | shadow device는 EBS 동기 미러(RPO≈0). S3 cold 티어와는 별도 방식 |
| **TiKV / TiDB** | TiDB Cloud(관리형)만 EBS+S3. self-host엔 네이티브 S3 티어 부재 |
| **CockroachDB** | 네이티브 S3 데이터 티어 부재(백업은 S3) |
| **ClickHouse (self-host)** | **S3 cold tier(TTL MOVE)=모델 A, 코어내장**. fs cache 필수, 사본배수 유지(zero-copy 금지) |

같은 시스템의 k8s local PV 성숙도:

| 시스템 | k8s local PV 성숙도 |
|---|---|
| **ScyllaDB** | **높음** — Operator가 RAID0/XFS + Local CSI + AZ=rack 자동 |
| **Cassandra** | 중 — cass-operator, 로컬은 PVC-노드 고정 함정 |
| **Kafka** | 중 — Strimzi + Local Volume Static Provisioner. 정적 프로비저닝 함정 → Local PVC Releaser |
| **Redpanda** | 중~높음 — 로컬 NVMe 중심 설계 |
| **ES / OpenSearch** | 중 — ECK/OpenSearch operator. "돌아가지만 아프다"(노드 소실 시 PVC/Pod 수동 삭제) |
| **Aerospike** | **높음** — AKO + local-static-provisioner + raw block(volumeMode: Block) |
| **TiKV / TiDB** | 중~높음 — TiDB Operator + local-volume-provisioner |
| **CockroachDB** | 중 — cockroach-operator, ephemeral-only 수요 |
| **ClickHouse (self-host)** | 중 — Altinity operator + local-path/TopoLVM. Karpenter consolidation stateful 위험 |

같은 시스템의 노드 교체 런북 핵심:

| 시스템 | 노드 교체 런북 핵심 |
|---|---|
| **ScyllaDB** | replace-dead-node → RBNO(재개가능) → file-based streaming(25×) → tablets. **클러스터 먼저 삭제**(순서 함정) |
| **Cassandra** | repair로 RF 복원 "hours to days". 완전 소실 시 전량 재스트리밍 |
| **Kafka** | Grab식 3-part: graceful drain → LB 재구성 → 스토리지 재부착/재sync |
| **Redpanda** | Raft 리더십 이양 + replica 재복제. 미업로드 세그먼트 로컬 삭제 방지 |
| **ES / OpenSearch** | replica≥1 + shard≤50GB + `delayed_timeout`. remote-backed면 S3→replica 다운로드로 재수화 경감 |
| **Aerospike** | roster 제외 → 새 노드 파티션 재동기화. shadow 있으면 같은 AZ에서 EBS→로컬 복원 |
| **TiKV / TiDB** | Raft 재복제. **Pinterest는 MTTR 때문에 Graviton+EBS 전환 검토** |
| **CockroachDB** | 단기=Raft 무중단. 장기=자동 rebalance. **작은 노드·넓은 분산이 MTTR 최소화 원칙** |
| **ClickHouse (self-host)** | replica에서 파트 재fetch. 재수화 TB당 시간 미측정 `?`. drain→종료→PV/PVC청소→모니터→RF검증 |

ScyllaDB의 노드 교체는 인프라(EC2 인스턴스 등)를 내리기 전에 클러스터에서 먼저 삭제해야 하는 순서 함정이 있습니다. ClickHouse의 재수화 TB당 시간은 미측정이라 스테이징 벤치마크가 필요합니다. drain 이후 청소 대상은 stuck 상태의 PV/PVC이고 그다음 단계는 재수화 진행 모니터링입니다.

## 수렴점 5개와 시스템별 예외

### 복구 시간에 맞춰 데이터 배치를 바꾼다 {#5개-수렴점}

ScyllaDB의 file-based streaming(25×)·tablets, CockroachDB의 작은 노드 권고, ES의 shard≤50GB, Netflix의 스냅샷 플래싱은 모두 복구할 데이터량이나 전송 시간을 줄이는 방법입니다. 로컬 NVMe는 평상시 처리량을 높이지만, 노드 한 대를 통째로 복구하는 시간도 운영 목표 안에 들어와야 합니다.

Kubernetes의 local PV는 특정 노드에 묶입니다. 노드가 영구 소실되면 볼륨을 다른 노드에 재부착할 수 없어, 파드와 PVC/PV 정리 뒤 DB 복제로 데이터를 채우는 절차가 필요합니다. static provisioner와 `WaitForFirstConsumer`는 배치를 돕지만 데이터 복구까지 수행하지는 않습니다.

### 제품별로 가져올 수 있는 운영 방법 {#시스템별-예외특이점}

ScyllaDB Operator는 RAID0/XFS, Local CSI, rack 배치와 orphaned 리소스 정리를 자동화합니다. ClickHouse의 [operator 구성]({{< relref "03-operator.md" >}})에서도 노드 준비와 볼륨 정리를 어디까지 자동화할지 참고할 만합니다 `✓`.

TiKV/TiDB는 self-host에서 로컬 SSD를 권하지만 TiDB Cloud는 EBS+S3를 사용합니다. Pinterest가 MTTR 때문에 Graviton+EBS를 검토한 사례는 복구 시간이 디스크 성능보다 우선할 수 있음을 보여줍니다 `✓`.

Kafka의 diskless 설계는 inter-AZ 비용을 줄이려는 시도입니다. 클라우드 Kafka 비용의 70~90%라는 수치는 해당 진영의 주장입니다 `Ⓥ`. ClickHouse에 같은 비율을 적용할 수는 없지만 RMT의 AZ 간 복제료를 빠뜨리지 말아야 한다는 점은 참고할 수 있습니다.

Redpanda는 로컬 NVMe, S3 tier, `cache_service`를 함께 사용합니다. 미업로드 세그먼트를 로컬에서 지우지 않는 절차처럼 원본 보존 조건을 명확히 하는 점이 유용합니다. Aerospike의 EBS shadow는 동기 미러(RPO≈0)여서 주기적으로 만드는 clickhouse-backup과 복구 시점이 다릅니다 `✓`.

ES/OpenSearch는 S3 조회 기능의 라이선스와 배포 범위를 확인해야 합니다. 조사 당시 OpenSearch searchable snapshots는 무료, Elasticsearch의 대응 기능은 Enterprise였습니다 `✓`. UltraWarm/OR1과 self-managed 기능도 구분합니다.

## ClickHouse 노드 교체 절차 {#대가--clickhouse의-node-lifecycle-운영}

ClickHouse에서 노드를 교체하려면 남은 사본 상태, 대상 PVC/PV, 새 노드의 스토리지 준비 상태를 확인해야 합니다. 로컬 NVMe가 빠르더라도 이 절차를 생략할 수는 없습니다.

- 재복제(re-replication): 소실 노드의 데이터는 다른 노드의 replica에서 전량 재전송받아 복구합니다. 재복제 동안 클러스터 용량·부하에 영향이 갑니다. 노드당 데이터가 크면(예: 40TB) 재수화가 길어져 그동안 redundancy가 줍니다 → 노드당 데이터량과 replica 수, shard 수의 균형 설계가 필요합니다.
- drain / upgrade 절차: 로컬 NVMe + node affinity 조합에서는 노드 drain이 곧 데이터 재복제를 유발할 수 있어 rolling 업그레이드 절차 설계가 까다롭습니다. Altinity operator issue #1859(로컬 NVMe 전환 질의)는 "노드 장애 시 CH 복제가 교체 노드로 자동 복구되는가"에 스레드가 명확한 답을 남기지 않은 채 종료됐습니다. 로컬 스토리지 노드 교체 절차가 잘 문서화돼 있지 않다는 방증입니다. 위 표에서 ScyllaDB Operator가 노드 교체를 자동화한 성숙도와 대비됩니다.
- `reclaimPolicy: Retain`: CH 클러스터/Helm 삭제 시 PVC가 함께 삭제돼 데이터가 날아가는 사고를 막는 필수 설정입니다. 노드 장애 복구 베스트 프랙티스는 "0 replica로 스케일다운 → 노드 재부팅 → 스케일업"이며 사전에 모든 PVC가 retain인지 확인해야 합니다.

{{< callout type="warning" >}}
pulse.support는 ClickHouse의 안정적인 노드 식별자와 Kubernetes의 파드 교체 방식 사이에 운영상 마찰이 있다고 설명합니다. local PV를 쓰면 파드 재배치와 데이터 복원을 별도로 처리해야 합니다.

스토리지 내구성 3종 세트(멀티 AZ replica·clickhouse-backup·Keeper)와 Karpenter 주의는 [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}}), operator 채택 근거는 [Altinity operator]({{< relref "03-operator.md" >}}), 실제 재수화·PVC 청소 절차는 [변경관리·복구 §복구 런북]({{< relref "05-altinity-operations.md" >}})에서 다룹니다.
{{< /callout >}}

## 실제 사용자의 성능과 복구 사례 {#named-프로덕션-사례-간결-인용}

각 사례가 "무엇을 증명하는가"만 압축합니다 — 상세 수치·출처는 [출처]({{< relref "10-sources.md" >}}).

| 사례 | 시스템 | 무엇을 증명하나 | 등급 |
|---|---|---|---|
| **Discord** | Cassandra→ScyllaDB | 조(兆) 단위 메시지, 로컬 NVMe RAID0 + persistent disk RAID1 미러 하이브리드 | `✓` |
| **Apple** | Cassandra | 세계 최대급 Cassandra 플릿(약 300,000 노드, 1,000+ 클러스터) — 로컬 디스크 검증 | `≈`(컨퍼런스·HN) |
| **Netflix** | Cassandra / CockroachDB | 재스트리밍 우회용 EBS 스냅샷 플래싱(C축 지속 티어의 대표형) | `✓`/`Ⓥ` |
| **Uber** | Cassandra | tens of millions QPS, 단일 존 장애 내성 설계 | `✓` |
| **Pinterest** | TiDB | i4i.4xlarge 로컬 NVMe 운영 중 **MTTR 때문에 Graviton+EBS 검토**(반례) | `✓` |
| **Flipkart** | TiDB | 1M QPS를 direct NVMe로. 노이즈 네이버 → anti-affinity 필요 교훈 | `✓` |
| **The Trade Desk** | Aerospike | 로컬 NVMe로 노드 500→60 통합(성능 밀도) | `Ⓥ` |
| **Criteo** | Aerospike | 1.2조 객체·50ms SLA를 로컬 SSD로 | `Ⓥ` |

{{< callout type="important" >}}
Pinterest의 EBS 검토는 복구 시간이 디스크 성능보다 우선할 수 있음을 보여줍니다. 우리 환경에서도 복구 시간이 요구치를 넘으면 노드당 데이터를 줄이거나 스토리지를 다시 비교해야 합니다 `Σ`.

{{< /callout >}}

## ClickHouse 런북에 반영할 항목 {#우리-케이스에서는}

[ClickHouse 운영]({{< relref "_index.md" >}})에서 검토한 로컬 NVMe 구성에는 다른 시스템에서 참고할 운영 사례가 충분합니다. 그중 바로 필요한 것은 노드당 데이터 상한, TB당 재수화 시간, AZ 간 전송료입니다. 동일한 인스턴스 계열을 쓰는 사례가 많다는 이유로 하드웨어나 복구 위험이 없어지는 것은 아닙니다.

스테이징에서는 노드 한 대를 잃은 뒤 PVC/PV를 정리하고 새 replica의 사본 수가 복원될 때까지 시간을 잽니다. graceful drain, 엔드포인트 변경, 재수화, RF 확인을 한 절차로 연결합니다. ScyllaDB의 자동화와 Kafka의 Local PVC Releaser는 이 중 볼륨 정리를 자동화할 때 참고할 수 있습니다.

견적에는 RMT의 cross-AZ 복제료와 S3 cold의 replica별 사본을 넣습니다. cold 데이터를 S3 한 벌로 계산하면 현재 RMT 구성과 맞지 않습니다. 백업은 별도 사본으로 계산합니다. 복구 시간이 SLA를 넘으면 EBS를 사용하는 대안도 다시 비교합니다.

구체적인 디스크 구성은 [스토리지 설계]({{< relref "02-storage-local-nvme.md" >}}), 실제 교체 명령은 [변경관리·복구]({{< relref "05-altinity-operations.md" >}})에서 이어집니다. 시점 기준 2026-08.
