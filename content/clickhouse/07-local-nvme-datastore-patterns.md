---
title: "로컬 NVMe 하드 유저들 — 데이터스토어 횡단 벤치마킹"
weight: 7
---

# 로컬 NVMe 하드 유저들 — 데이터스토어 횡단 벤치마킹

{{< callout type="info" >}}
**한눈에** — "휘발성 로컬 NVMe 1차 + 복제 내구성 + 오래된 데이터 S3 티어링"이 업계에서 어디까지 표준인지 9개 데이터스토어로 검증한 페이지다.

- **로컬 NVMe 1차는 이단이 아니라 정설**이고, ClickHouse + EKS + i7i/i8g 결정은 이 정설과 정확히 부합한다.
- 단 **"복제만으로 충분"은 거짓** — 성숙한 시스템은 예외 없이 복제 위에 지속(durable) 티어를 하나 더 얹는다.
- **"S3 티어링하면 사본이 줄어 싸진다"는 UltraWarm식 기대는 self-host에서 틀린다** — shared-nothing이라 사본 배수가 유지된다.
- 새로 벼릴 것은 재수화 MTTR 실측 · cross-AZ 비용 반영 · 사본 오해 교정 · local PV 노드 교체 런북뿐이다.
{{< /callout >}}

이 페이지는 질문 하나에 답한다 — **"휘발성 로컬 NVMe를 1차 스토리지로 쓰고, 내구성은 복제로 확보하고, 오래된 데이터는 S3로 티어링한다"는 패턴이 업계에서 어디까지 표준인가.** [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}})가 이 결정을 **ClickHouse에서 어떻게 구현하나(how)**를 다룬다면, 이 페이지는 ScyllaDB·Cassandra·Kafka·Redpanda·WarpStream류·ES/OpenSearch·Aerospike·TiKV/TiDB·CockroachDB **9개 시스템을 같은 잣대로 놓고** "업계가 어디까지 하나"를 보여주는 **외부 강화 근거**다.

{{% details title="근거 등급 태그 · 출처 규칙" closed="true" %}}
근거 등급 태그는 입력 조사(11-1~11-4 및 종합)의 판정을 승계한다(`[확인됨]`·`[벤더]`·`[추정]`·`[미확인]`, 본 페이지의 신규 종합 판단은 `[종합]`). URL 출처는 이 페이지가 아니라 [출처]({{< relref "08-sources.md" >}})가 담당한다.
{{% /details %}}

## 결론 먼저 — 세 층위로 나눈 표준

한 문장으로: **"휘발성 로컬 NVMe 1차 + 복제 내구성"은 이제 고성능 데이터스토어의 주류 표준이다. 그러나 "복제만으로 충분"은 표준이 아니고, "S3 티어링"은 사본 경제가 정반대인 두 모델로 갈린다.**

### 확실히 표준인 것 (거의 만장일치)

- **로컬 NVMe 1차 스토리지 자체는 정설이다.** Aerospike·ScyllaDB·CockroachDB·(대규모)TiDB·ES hot 티어·Redpanda·클래식 Kafka·MongoDB Atlas NVMe가 모두 성능 극단에서 휘발성 로컬 NVMe를 1차로 쓴다 `[확인됨]`. ScyllaDB Operator는 네트워크 스토리지를 아예 "프로덕션 부적합"으로 못박는다 `[확인됨]`.
- **인스턴스 패밀리까지 수렴한다.** Aerospike(i3en/i4i)·ScyllaDB(i3en/i4i/i7i/i7ie/i8g/i8ge)·ES(i3→i3en→i4i→i7i→i8g→i8ge)·TiDB(i4i)가 동일한 storage-optimized 계보를 탄다 — **i7i/i8g는 "SSD-native 데이터스토어의 사실상 표준 인스턴스"** `[확인됨]`. 즉 우리 인스턴스 선택엔 별도 하드웨어 리스크가 없다.
- **내구성은 디스크가 아니라 애플리케이션 계층 복제(RF)로 만든다.** "노드 소실 = 데이터 소실, 하지만 복제본이 있으니 괜찮다"가 공통 설계다 `[확인됨]`.
- **로컬 디스크의 정직한 대가 = 복제 팩터 상향.** CockroachDB는 "로컬 디스크는 네트워크 스토리지보다 잘 죽으니 RF를 3→5로 올려라"라고 명문화한다 — ClickHouse의 "로컬이면 replica 2→3"와 동일 논리 `[확인됨]`.

### 표준이지만 오해되는 것 — "복제만으로 충분"은 거짓에 가깝다

성숙한 시스템은 복제 위에 **별도의 지속 티어를 반드시 하나 더 얹는다.** 형태는 다르지만 "복제 외 별도 durable 사본"이 **업계 최소 요구선(minimum bar)**이라는 것이 횡단 조사의 핵심 발견이다 `[종합]`.

| 시스템 | 복제 위에 얹는 지속 티어 |
|---|---|
| Aerospike | **shadow device** — 로컬 NVMe(primary) + EBS(shadow)에 동기 write 미러(RPO≈0) `[확인됨]` |
| MongoDB Atlas NVMe | **Cloud Backup 강제** — NVMe 클러스터는 백업 비활성화 불가 `[확인됨]` |
| ScyllaDB | Scylla Manager 스냅샷 → S3/GCS 백업 `[확인됨]` |
| Netflix (Cassandra) | EBS 스냅샷 S3 플래싱(datastore flash upgrades) `[확인됨]` |
| ClickHouse | **clickhouse-backup → S3**(주간 full + 일간 incremental) `[확인됨]` |

{{< callout type="warning" >}}
즉 [스토리지 페이지]({{< relref "02-storage-local-nvme.md" >}})의 "로컬 NVMe replica + S3 백업" 3종 세트는 사치가 아니라 **업계 최소선을 정확히 충족**하는 정본이다. **"replica만 믿고 백업 생략"은 어떤 성숙한 시스템도 하지 않는다** `[종합]`.
{{< /callout >}}

### 표준이 갈라지는 것 — "S3 티어링"의 두 얼굴

"hot 로컬 + cold S3"는 표준이 됐지만 **사본 경제(copy economics)가 근본적으로 다른 두 모델로 갈린다** `[확인됨]`.

- **모델 A — shared-nothing 티어링(사본 배수 유지)**: 각 replica가 S3에도 자기 사본을 둔다. RF2면 S3에 2벌. **self-host OSS의 유일한 선택지**. Kafka KIP-405·Redpanda Tiered Storage·ClickHouse self-host S3 cold가 여기. 절감 원천은 오직 **NVMe→S3 GB단가 차이**.
- **모델 B — shared-storage(사본 1벌 + 컴퓨트 캐시)**: S3에 단일 사본, 로컬은 순수 캐시, replica 불필요. **거의 전부 관리형/유료/독점**. OpenSearch UltraWarm·OR1, ClickHouse Cloud SharedMergeTree, WarpStream류 diskless가 여기.

스트리밍 진영이 정리한 "로컬 hot ↔ S3 cold" 5단계 스펙트럼에 얹으면 ClickHouse self-host의 좌표가 분명해진다 `[종합]`:

```
① 로컬 only       ② 로컬 hot + S3 cold      ③ WAL 로컬 + 데이터 S3   ④ S3 only(diskless)   ⑤ 서버리스
  (── 모델 A: 사본 배수 유지 ──)             (──────── 모델 B: 사본 1벌 / 벤더 관리 ────────)
 클래식 Kafka      Kafka KIP-405             AutoMQ                WarpStream/Freight     MSK Express*
 Cassandra         Redpanda Tiered Storage                        KIP-1150 Diskless      CH Cloud SMT
 Aerospike(로컬)   ES hot + searchable snap                                              UltraWarm / OR1*
 ScyllaDB          ★ ClickHouse self-host ★                       (µs 지연과 충돌)       (*=관리형/독점)
```

**ClickHouse self-host는 ②단계(모델 A)에 위치하며, 이는 Kafka Tiered Storage·Redpanda·ES hot+searchable snapshot과 정확히 같은 진영**이다. ③④(diskless)는 지연을 수백 ms~수 초로 희생하므로 µs 분석 쿼리를 요구하는 ClickHouse엔 이식 불가, ⑤(shared-storage 서버리스)는 self-host로 재현 불가 `[확인됨]`. **우리 도메인의 [OpenSearch]({{< relref "../logging/01-opensearch.md" >}}) UltraWarm 유추가 깨지는 지점이 바로 여기다** — 그건 모델 B라 self-host로 못 옮긴다.

## 9개 시스템 횡단 비교표

같은 다섯 축(로컬 디스크 활용·내구성 모델·S3 티어링 대응물·k8s local PV 성숙도·노드 교체 런북)으로 9개 시스템을 나란히 놓고, ClickHouse를 그 벤치마킹 대상들과 같은 표에 편입한다.

### 로컬 디스크 활용 · 내구성 모델

| 시스템 | 로컬 디스크 활용 방식 | 내구성 모델 |
|---|---|---|
| **ScyllaDB** | 로컬 NVMe **1차 강제**(RAID0+XFS 자동). 네트워크 스토리지=프로덕션 부적합 명시 | RF3 + 멀티 AZ rack awareness. "노드 소실=데이터 소실, 복제가 durability" |
| **Cassandra** | 인스턴스 스토어가 범용 배포 최선(성능). EBS는 운영편의·읽기편중용 이분법 | RF3 + NetworkTopologyStrategy(1 AZ=1 rack) + hinted handoff·repair |
| **Kafka(클래식)** | 로컬 NVMe 또는 EBS(순차 I/O라 EBS도 실용적) | RF3 복제(3 AZ), ISR·acks. 휘발성은 앱 계층 복제로 방어 |
| **Redpanda** | 로컬 NVMe **극한 활용**(XFS + thread-per-core + 직접 I/O) | Raft 기반 파티션 replica 복제(ClickHouse RMT와 동일 원칙) |
| **ES / OpenSearch** | hot 티어 = 로컬 NVMe 정설. frozen 노드조차 NVMe=S3 원본의 LFU 캐시 | hot=replica로 내구성(shard≤50GB). cold/frozen=snapshot이 durability |
| **Aerospike** | 로컬 NVMe를 **raw device로 직접**(파일시스템 우회). index=RAM | RF + rack awareness + **shadow device(EBS 동기 미러)** + SC 모드 |
| **TiKV / TiDB** | Operator: **TiKV엔 로컬 SSD 강력 권장**, PD(메타)만 gp3 | RocksDB(LSM) + Raft 3중 복제 |
| **CockroachDB** | 로컬 SSD가 네트워크 부착보다 **우수**하다고 명시 | Pebble(LSM) + Raft. **로컬이면 RF 3→5** 상향 |
| **ClickHouse (self-host)** | 로컬 NVMe(i7i/i8g, RAID0) 1차. gp3는 Keeper 데이터용 | ReplicatedMergeTree replica 2~3 멀티 AZ + Keeper |

### S3 티어링 대응물 · k8s local PV 성숙도 · 노드 교체 런북

| 시스템 | S3 티어링(모델 A/B) | k8s local PV 성숙도 | 노드 교체 런북 핵심 |
|---|---|---|---|
| **ScyllaDB** | 로드맵/experimental(S3-backed keyspace). 백업은 Manager→S3 **(모델 미확정)** | **높음** — Operator가 RAID0/XFS + Local CSI + AZ=rack 자동 | replace-dead-node → RBNO(재개 가능) → file-based streaming(25×) → tablets. **인프라 내리기 전 클러스터 먼저 삭제**(순서 함정) |
| **Cassandra** | **네이티브 없음**. TWCS + 외부백업(Medusa→S3) (모델 A 미만) | 중 — cass-operator, 로컬은 PVC-노드 고정 함정 | repair로 RF 복원 "hours to days". 완전 소실 시 전량 재스트리밍 |
| **Kafka** | **KIP-405 GA(3.9)=모델 A**. 단 RSM(S3 어댑터) 미제공 → 직접 구현 필요 | 중 — Strimzi + Local Volume Static Provisioner. 정적 프로비저닝 함정 → Local PVC Releaser | Grab식 3-part: graceful drain → LB 재구성 → 스토리지 재부착/재sync |
| **Redpanda** | **Tiered Storage(Shadow Indexing)=모델 A, 성숙**. `cache_service`=CH filesystem cache와 동형 | 중~높음 — 로컬 NVMe 중심 설계 | Raft 리더십 이양 + replica 재복제. 미업로드 세그먼트 로컬 삭제 방지 |
| **ES / OpenSearch** | searchable snapshots — **OpenSearch=무료(모델 B)**, **ES=Enterprise 유료**. UltraWarm/OR1=관리형 모델 B | 중 — ECK/OpenSearch operator. "돌아가지만 아프다"(노드 소실 시 PVC/Pod 수동 삭제) | replica≥1 + shard≤50GB + `delayed_timeout`. remote-backed면 S3→replica 다운로드로 재수화 경감 |
| **Aerospike** | **shadow device=모델 A의 원조**(EBS 동기 미러, RPO≈0) | **높음** — AKO + local-static-provisioner + raw block(volumeMode: Block) | roster 제외 → 새 노드 파티션 재동기화. shadow 있으면 같은 AZ에서 EBS→로컬 복원 |
| **TiKV / TiDB** | TiDB Cloud(관리형)만 EBS+S3. self-host엔 네이티브 S3 티어 부재 | 중~높음 — TiDB Operator + local-volume-provisioner | Raft 재복제. **Pinterest는 MTTR 때문에 Graviton+EBS 전환 검토** |
| **CockroachDB** | 네이티브 S3 데이터 티어 부재(백업은 S3) | 중 — cockroach-operator, ephemeral-only 수요 | 단기=Raft 무중단. 장기=자동 rebalance. **작은 노드·넓은 분산이 MTTR 최소화 원칙** |
| **ClickHouse (self-host)** | **S3 cold tier(TTL MOVE)=모델 A, 코어 내장·성숙**. filesystem cache 필수. zero-copy 금지(#45346)→사본 배수 유지 | 중 — Altinity operator + local-path/TopoLVM. Karpenter consolidation stateful 위험 | replica에서 파트 재fetch. **재수화 TB당 시간 미측정(벤치 필요)** `[미확인]`. drain→종료→stuck PV/PVC 청소→재수화 모니터→RF 검증 |

## 수렴점 5개와 시스템별 예외

### 5개 수렴점

1. **로컬 NVMe 1차는 만장일치** `[종합]`. 예외는 결이 다른 것뿐 — **Redis/Valkey**는 RAM이 1차라 애초에 벤치 대상이 아니고, **CERN**은 관리 용이성을 우선해 CephFS+SSD 캐시로 간 반대편 철학이다.
2. **내구성은 복제로.** 전 시스템이 디스크 durability를 사지 않고 앱 계층 N중 복제로 만든다. 멀티 AZ(rack/zone awareness)가 상관 장애 방어의 공통 수단이고, 로컬이면 RF를 올리는 것(Cockroach 3→5, ClickHouse 2→3)이 정직한 대가.
3. **복제 위에 지속 티어를 하나 더.** "복제만으로 충분"은 성숙 시스템에서 거짓에 가깝다(위 §표). shadow device·강제 백업·S3 백업·스냅샷 플래싱 — 형태만 다를 뿐 별도 durable 사본이 minimum bar.
4. **실전 병목은 언제나 재수화 MTTR** `[확인됨]`. 노드 소실 시 그 데이터를 복제본에서 재전송하는 시간이 로컬 NVMe 채택의 최대 운영 통증이고, 이를 줄이려는 투자가 각 시스템 로드맵을 지배한다 — ScyllaDB의 file-based streaming(25×)·tablets, Kafka의 Tiered Storage(로컬을 hot만 남김), CockroachDB의 작은 노드·넓은 분산, ES의 shard≤50GB, Netflix의 스냅샷 플래싱(재스트리밍 자체 우회).
5. **k8s local PV 운영은 단일 패턴으로 수렴** `[확인됨]`: (1) static provisioner로 물리 디스크를 PV로 노출(동적 프로비저닝 불가) → (2) `WaitForFirstConsumer` + node affinity로 파드를 디스크에 고정 → (3) 노드 소실 시 k8s는 데이터를 못 옮겨 PV/PVC가 stuck → (4) operator가 stuck 리소스 청소로 재스케줄 유도 → (5) **재수화는 100% DB 계층 복제가 담당**. 핵심 명제: **"local PV에서 operator의 역할은 스토리지 마이그레이션이 아니라 디스크 노출 + stuck 청소"**다.

### 시스템별 예외·특이점

{{% details title="6개 시스템 각론 펼치기 — ScyllaDB · TiKV/TiDB · Kafka · Redpanda · ES/OpenSearch · Aerospike" closed="true" %}}

- **ScyllaDB — 로컬 NVMe 자동화 성숙도 최고.** Operator가 RAID0/XFS/Local CSI/AZ=rack/orphaned cleanup을 프로덕션 기본으로 자동화한다 — Altinity operator가 벤치마킹할 정점 `[확인됨]`([operator 페이지]({{< relref "03-operator.md" >}})).
- **TiKV/TiDB — 관리형만 후퇴.** self-host Operator는 TiKV에 로컬 SSD를 강력 권장하지만, **TiDB Cloud(관리형)만** EBS+S3로 재설계했다 — self-host 권고와 별개인 관리형 독자 결정이다. **PingCAP/Pinterest가 MTTR 때문에 Graviton+EBS 전환을 검토**하는 현장 증거는 로컬 NVMe self-host의 대표적 반례로 유효하다 `[확인됨]`.
- **Kafka — diskless라는 별도 진화 축.** inter-AZ 트래픽이 클라우드 Kafka 비용의 **70~90%**라는 폭로가 WarpStream/AutoMQ/KIP-1150을 낳았다. 티어링(모델 A)이 못 줄이는 비용을 없애지만 지연을 희생 → ClickHouse엔 부적합하나 **cross-AZ 비용 경고는 그대로 유효** `[벤더]`.
- **Redpanda — ClickHouse의 가장 닮은꼴.** 로컬 NVMe 1차 + S3 티어 + 로컬 캐시(`cache_service`) + 앱 계층 복제. "미업로드 세그먼트 로컬 삭제 방지"가 ClickHouse의 "병합 완료 후 S3 이동" 철학과 동일하다 `[확인됨]`.
- **ES/OpenSearch — 라이선스 갈림길.** UltraWarm급 S3 티어링을 self-manage로 무료로 원하면 **OpenSearch가 유일한 무료 경로**(ES searchable snapshots는 Enterprise 유료)다. 그런데 그건 애초에 ClickHouse 전환 취지와 어긋난다 `[확인됨]`.
- **Aerospike — shadow device = 모델 A의 원조.** 로컬 primary + EBS shadow 동기 write 미러(RPO≈0)로, clickhouse-backup(주기 백업, RPO=간격)보다 강한 지속성을 준다 `[확인됨]`.

{{% /details %}}

## named 프로덕션 사례 (간결 인용)

각 사례가 "무엇을 증명하는가"만 압축한다 — 상세 수치·출처는 [출처]({{< relref "08-sources.md" >}}).

| 사례 | 시스템 | 무엇을 증명하나 | 등급 |
|---|---|---|---|
| **Discord** | Cassandra→ScyllaDB | 조(兆) 단위 메시지, 로컬 NVMe RAID0 + persistent disk RAID1 미러 하이브리드 | `[확인됨]` |
| **Apple** | Cassandra | 세계 최대급 Cassandra 플릿(수십만 노드 — 약 300,000, 1,000+ 클러스터) — 로컬 디스크 대규모 검증 | `[추정]`(컨퍼런스·HN) |
| **Netflix** | Cassandra / CockroachDB | 재스트리밍 우회용 EBS 스냅샷 플래싱(C축 지속 티어의 대표형) | `[확인됨]`/`[벤더]` |
| **Uber** | Cassandra | tens of millions QPS, 단일 존 장애 내성 설계 | `[확인됨]` |
| **Pinterest** | TiDB | i4i.4xlarge 로컬 NVMe 운영 중 **MTTR 때문에 Graviton+EBS 검토**(반례) | `[확인됨]` |
| **Flipkart** | TiDB | 1M QPS를 direct NVMe로. 노이즈 네이버 → anti-affinity 필요 교훈 | `[확인됨]` |
| **The Trade Desk** | Aerospike | 로컬 NVMe로 노드 500→60 통합(성능 밀도) | `[벤더]` |
| **Criteo** | Aerospike | 1.2조 객체·50ms SLA를 로컬 SSD로 | `[벤더]` |

{{< callout type="important" >}}
**핵심 독법** `[종합]`: **순수 자체운영의 최대 규모는 로컬 디스크 베어메탈**(위 사례 다수)이고, **Pinterest의 EBS 검토는 "로컬 NVMe가 MTTR로 되돌려지는 실제 힘"의 현장 증거**다. 우리는 이 반례를 런북으로 방어해야지, 없는 셈 쳐선 안 된다.
{{< /callout >}}

## 우리 케이스에서는

이 페이지는 [ClickHouse 운영]({{< relref "_index.md" >}}) 챕터의 게이트(RUM 대체 + 범용 분석 + 인력 보유)를 통과했다고 가정한 뒤, 스토리지 결정을 **업계 횡단 관점에서** 검증한다. [스토리지 페이지]({{< relref "02-storage-local-nvme.md" >}})의 ClickHouse 특화 설계(내구성 3종 세트·티어링·Karpenter·재수화)를 반복하지 않고, 그 결정에 대한 **외부 강화 근거와 신규 리스크만** 얹는다.

**강화되는 근거** `[종합]`:

- **로컬 NVMe(i7i/i8g) 1차 방향은 업계 정설과 정확히 일치.** 9개 시스템이 같은 선택을 하고 인스턴스 패밀리까지 동일 계보다 — 하드웨어 리스크 없음.
- **"로컬 NVMe replica + S3 백업" 3종 세트는 최소 요구선을 정확히 충족.** Aerospike shadow / Mongo Atlas Cloud Backup / CockroachDB RF5에 대응하는 ClickHouse의 정본이다.
- **RF 상향의 논리적 정당성 확보.** CockroachDB "로컬이면 RF 3→5"가 ClickHouse "로컬이면 replica 2→3"를 이론적으로 뒷받침한다.
- **S3 cold 티어링은 오히려 ClickHouse의 상대적 우위.** NoSQL 진영(Scylla=experimental, Cassandra=없음)이 아직 만드는 hot 로컬 + cold S3를 ClickHouse는 storage_policy로 코어에 내장·성숙시켰다. Kafka조차 RSM(S3 어댑터)을 직접 구현해야 하는데 ClickHouse는 완제품이다.

**새로 드러난 리스크(반드시 런북/TCO에 반영)** `[종합]`:

- **재수화 MTTR이 로컬 NVMe self-host의 최대 운영 부채 — 그리고 EBS로 되돌리는 실질적 힘.** Grab(Kafka NVMe→EBS, 재복제 hours→minutes)·Pinterest(TiDB, MTTR로 EBS 검토)는 **실제로 후퇴한 반례**다. ClickHouse는 스토리지 민감도가 더 높아 후퇴가 Kafka만큼 쉽지 않으므로, ① 노드당 데이터량 절제(작은 노드·넓은 분산·shard 증가), ② S3 cold로 로컬을 hot만 남겨 재수화 대상 축소, ③ **TB당 재수화 시간 실측**으로 방어한다. 조사가 `[미확인]`으로 남긴 재수화 시간은 반드시 스테이징에서 벤치마킹한다.
- **cross-AZ 복제 트래픽 비용을 TCO에서 누락하지 말 것.** diskless 진영이 폭로한 "클라우드 Kafka 비용의 70~90%가 inter-AZ"는 ClickHouse RMT 멀티 AZ 복제에도(정도는 다르나) 적용된다. RF2 검토·replica AZ 배치 최적화·cold는 S3 단일본으로 대응한다.
- **"S3 티어링=사본 절감"이라는 UltraWarm식 오해의 교정.** self-host RMT는 shared-nothing이라 S3 cold도 replica마다 사본(RF2=S3에 2벌), zero-copy는 프로덕션 금지다. 절감은 **NVMe→S3 GB단가 차이에서만** 오므로 비용 계산 시 S3 cold도 RF배수(+백업)로 계상해야 공정하다. **티어링 ≠ 내구성/DR** — S3 cold도 살아있는 테이블이라 DROP·잘못된 ALTER에 똑같이 파괴된다(상세는 [스토리지 페이지]({{< relref "02-storage-local-nvme.md" >}})).
- **k8s local PV 정적 프로비저닝 함정 + Karpenter + anti-affinity.** 노드 영구 소실 시 PVC는 Bound인데 PV 하부가 소실돼 파드가 영원히 Pending에 빠지는 문제를 Kafka·ES·Aerospike가 모두 겪었다 — Altinity operator + local PV에서도 동일하므로 **자동 remediation 또는 수동 청소 절차를 런북에 명시·검증**한다. Karpenter consolidation의 stateful 위험, Flipkart 노이즈 네이버(replica 몰림)를 막는 파드 배치 anti-affinity도 필수다.

**벤치마킹·이식할 런북** `[종합]`:

| 대상 | 벤치마킹 소스 | 이식할 내용 |
|---|---|---|
| 노드 교체 3-part 런북 | Grab(Kafka on EKS) | graceful drain(PDB) → LB·endpoint 재구성 → replica 재수화/백업 복원 |
| 재수화 MTTR 실측 | ScyllaDB streaming·CockroachDB 원칙 | 스테이징에서 노드를 죽여 TB당 재수화 시간 측정 → SLA·노드당 데이터 상한 결정 |
| 로컬 PV 자동화 | ScyllaDB Operator NodeConfig | RAID0/XFS 부트스트랩 + static provisioner + WaitForFirstConsumer + AZ=rack + stuck 청소 |
| stuck PVC 자동 청소 | Kafka Local PVC Releaser | 노드 종료 감시 → stuck PVC 자동 삭제 → operator claim 재생성 |
| MTTR 완화 하이브리드 | Pinterest EBS 검토·Aerospike shadow | MTTR이 SLA 위협 시 cold replica를 EBS로 두는 하이브리드 검토(성능 vs MTTR 저울질) |

**한 줄 결론** `[종합]`: **9개 데이터스토어의 대규모 프로덕션은 예외 없이 "로컬 NVMe 1차 + 복제 내구성 + 복제 위 지속 티어 + 노드 교체 자동화"로 수렴하며, ClickHouse + EKS + i7i/i8g self-host는 이 정설과 정확히 부합한다. 유일하게 새로 벼려야 할 것은 (a) 재수화 MTTR 실측·관리, (b) cross-AZ 비용의 TCO 반영, (c) UltraWarm식 "S3=사본 절감" 오해의 교정, (d) EKS local PV 노드 교체 런북의 사전 리허설이다.** 이 결정을 ClickHouse에서 구현하는 방법은 [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}})·[Altinity operator]({{< relref "03-operator.md" >}})가 이어받는다.
