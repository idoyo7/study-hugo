---
title: "operator 토폴로지·다운타임 — EBS 재부착이 바꾸는 복구 모델"
weight: 4
aliases: ["/hyperdx-operating/03-availability/", "/hyperdx/operating/03-availability/"]
---

# operator 토폴로지·다운타임 — EBS 재부착이 바꾸는 복구 모델

어느 operator를 쓸지는 [operator 선택]({{< relref "../../clickhouse/03-operator.md" >}})이, CHI/CHK 매니페스트 필드·RF 선택 확률·`insert_quorum` 주입 위치는 [배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})이, 스케일 in/out 함정·롤링 업그레이드 순서·CRD 삭제 금지는 [operator 운영]({{< relref "../../clickhouse/05-altinity-operations.md" >}})이 이미 깊게 다뤘습니다. 그래서 이 페이지는 필드 전수·스케일·업그레이드를 그 세 페이지에 그대로 위임하고 **전제 스토리지를 EBS(gp3/io2)로 바꿨을 때 다운타임 프로파일이 어떻게 근본적으로 뒤집히는가** 한 축만 붙듭니다 — 본문으로 쓰는 것은 EBS 재부착 역학·시나리오별 다운타임·EBS 특유 함정뿐입니다.

**이 장은 "무엇이 죽었나"로 시작하는 사고 진입점입니다.** 컴포넌트별 가용성 종합(역할·다운타임·HA·무손실·스케일 매트릭스, blast radius, 무손실 2트랙)은 전에 [스택 토폴로지]({{< relref "01-stack-topology.md" >}}) §7과 운영 트랙 가용성 페이지로 갈라져 있었고, 원본과 파생이 동시에 존재하는 구조라 정정을 두 번 해야 했습니다. 그 축의 정본은 지금 이 장 §1이며, 01은 배치·흐름·MongoDB 최소 배포 한 질문에만 답합니다. 서사는 **무엇이 죽었나(§1 컴포넌트 축) → 어느 시나리오인가(§5 이벤트 축 S1~S9) → 무엇을 지켰나(§6 무손실 2트랙) → 어떻게 복구하나(§5.1 taint·reattach)** 순서로 읽습니다. 두 축의 표는 일부러 따로 둡니다 — 컴포넌트 축은 "무엇이 멈추나", 이벤트 축은 "어떤 사건에서 얼마나 걸리나"를 묻는 서로 다른 질문이고 한 표로 융합하면 둘 다 못 읽습니다.

{{< callout type="info" >}}
**한눈에**

- 표준 ClickStack Helm(2차트)은 [ClickHouse Inc. 공식 operator]({{< relref "01-stack-topology.md" >}})(`ClickHouseCluster`/`KeeperCluster` CRD)를 씁니다. 우리는 그걸 그대로 쓰지 않고 `clickhouse.enabled: false`(자체(self-hosted) ClickHouse에 연결하는 'HyperDX Only')로 CH/Keeper를 **Altinity CHI/CHK로 분리 운영**합니다 — 아래 매니페스트는 전부 Altinity CRD 기준입니다.
- **어느 컴포넌트 하나의 다운도 "전체 관측 정지"를 뜻하지 않습니다** `Σ`. app/api가 죽으면 UI·쿼리만, Collector가 죽으면 신규 ingest만(퍼시스턴트 큐가 완충), MongoDB가 죽으면 설정·알럿·UI만 멈춥니다. 광범위한 정지는 **CH 전체 다운**(저장·쿼리 원천)과 **Keeper 정족수 상실**(쓰기 경로) 둘뿐입니다 `Σ`.
- **EBS-first면 "노드=데이터" 결합이 끊긴다**: 노드가 죽어도 데이터는 EBS 볼륨에 살아남아 detach→(같은 AZ) 새 노드에 reattach됩니다. 로컬 NVMe에서 "노드 유실=전량 재수화(수 시간, RF2→실질 RF1)"였던 것이 EBS에선 "reattach+델타 catch-up(수 분, RF 온전)"이 됩니다.
- 기본 토폴로지는 **1 shard × RF2(2 AZ)** + CHK 3노드(3 AZ)입니다. 0.7TB/월 규모에서 shard는 부채입니다.
- EBS 함정 둘: ① **AZ-bound** — 볼륨은 다른 AZ로 못 옮깁니다. AZ 장애는 reattach로 못 풀고 cross-AZ replica만이 방어합니다. ② **ungraceful node death의 무한 Terminating** — StatefulSet+RWO는 자동 복구 안 됨, `out-of-service` taint 개입이 정석.
- multi-attach로 replica를 대체할 수 없습니다(CH의 XFS/ext4는 동시 마운트 시 손상).
- 무손실 방어는 성격이 다른 **두 트랙**으로 갈립니다: 트랙1(텔레메트리)=OTel `file_storage` 퍼시스턴트 큐 + RMT 복제(+`insert_quorum`), 트랙2(메타데이터)=MongoDB ReplicaSet + `mongodump`.
- **Keeper는 durable queue가 아니다** — 이벤트 데이터를 보관하지 않고 트랙1의 **쓰기 가용성**만 좌우합니다 `✓`.
{{< /callout >}}

## 1. 무엇이 죽으면 무엇이 멈추나 — 컴포넌트 축

이 절은 컴포넌트마다 (a)무슨 역할인지, (b)죽으면 무엇이 멈추는지, (c)HA·스케일이 가능한지, (d)데이터를 어떻게 무손실로 지키는지를 한 줄씩 맞춰 **가용성 한 장으로 종합**합니다 `Σ`. 세우려는 것은 **"어느 컴포넌트가 죽으면 관측이 어디까지 멈추나"** 라는 운영 판단 하나이고, 개별 메커니즘의 근거·매니페스트·시나리오는 아래 relref와 §5로 위임합니다.

종합하는 범위는 **가용성 전제**까지입니다. 각 컴포넌트를 실제로 **어떤 옵션으로 프로비저닝하나**(EBS hot/cold 스토리지·operator 노브·block-only 튜닝)는 [hot 스토리지·EBS]({{< relref "02-hot-storage-ebs.md" >}})·[S3 콜드 티어링]({{< relref "03-s3-cold-tiering.md" >}})·[블록 온리 튜닝]({{< relref "08-block-only-tuning.md" >}})과 이 장의 §2~§4가 잇습니다. 즉 "무엇을 지켜야 하나"가 이 절, "어떻게 프로비저닝하나"가 그 뒤입니다.

전제는 챕터 전체와 동일합니다: RUM-only 월 0.7TB, EBS(gp3)-first, HyperDX Only(`clickhouse.enabled:false`) + Altinity CHI/CHK, 1 shard × RF2(2 AZ), Keeper 3노드(gp3·3 AZ), MongoDB 메타데이터 전용.

### 1.1 컴포넌트별 종합 매트릭스

폭 제약 때문에 8열 한 표에는 담지 못해 속성별로 나눕니다. 컴포넌트 순서는 모든 표에서 동일합니다.

**역할·상태·HA 방식**

| 컴포넌트 | 역할(가용성 관점) | 상태 | HA 방식 |
|---|---|---|---|
| **HyperDX app/api** | 조회 UI(Next.js) + 백엔드(Node.js: 쿼리 오케스트레이션·알럿 평가·OpAMP 서버) | 무상태 | Service 뒤 replica 2+ |
| **OTel Collector** | RUM ingest 수집·배치·CH export(4318 인입) | 준무상태(+디스크 큐) | deployment ≥2 + `file_storage` 퍼시스턴트 큐 |
| **ClickHouse** | 모든 텔레메트리 저장·쿼리 원천 | 스테이트풀(EBS) | RMT 멀티마스터 RF2/3, 2~3 AZ 분산 |
| **ClickHouse Keeper** | 복제 조정 메타(로그·part 참조·dedup·DDL 큐) | 스테이트풀(메타·소량) | 3노드 정족수(1대 손실 허용), 3 AZ 분산 |
| **MongoDB** | 앱 메타데이터(대시보드·알럿·유저·소스) | 스테이트풀(소량) | ReplicaSet `members:3` 또는 Atlas |

**다운타임 시 거동 — 무엇이 멈추나**

| 컴포넌트 | 다운타임 시 거동 |
|---|---|
| **HyperDX app/api** | **UI·쿼리만 잠깐 blip** — 브라우저→Collector→CH 적재 경로는 그대로 흐른다(조회 대면일 뿐 ingest 경로 밖) `✓` |
| **OTel Collector** | 신규 ingest 정지 → 퍼시스턴트 큐로 완충, **큐 없으면 in-flight 유실** `✓/≈` |
| **ClickHouse** | replica 1대 죽어도 나머지가 read+write 계속(**승격 없음**), **전체 다운 시에만** 조회+수집 동시 정지 `✓` |
| **ClickHouse Keeper** | **정족수 상실 → CH 쓰기(INSERT/DDL/머지) 정지, 읽기 OK = 쓰기 SPOF** — 데이터 노드가 멀쩡해도 쓰기가 멎는 유일 지점 `✓` |
| **MongoDB** | **설정·알럿 평가·UI만 정지 — 관측(ingest) 데이터와 무관** `✓` |

**무손실 방어**

| 컴포넌트 | 무손실 방어 |
|---|---|
| **HyperDX app/api** | 상태 없음(메타=Mongo·텔레메트리=CH) → 자체 유실 개념 없음 `✓` |
| **OTel Collector** | persistent queue(at-least-once) + 백프레셔(`memory_limiter`) + 클라 재시도 `✓/≈` |
| **ClickHouse** | RF 복제 + `insert_quorum` + clickhouse-backup `✓` |
| **ClickHouse Keeper** | 사용자 데이터 아님 · gp3 영속(Raft 메타 생존) · 3노드 정족수 `✓` |
| **MongoDB** | 메타만 · ReplicaSet 복제 + `mongodump` CronJob(S3) `✓` |

**상세 문서**

| 컴포넌트 | 상세 |
|---|---|
| **HyperDX app/api** | [스택 토폴로지]({{< relref "01-stack-topology.md" >}}) §2 역할·포트·의존 · §4 K8s 배치 |
| **OTel Collector** | [스택 토폴로지]({{< relref "01-stack-topology.md" >}}) §5 배치·사이징 · [Keeper]({{< relref "05-keeper.md" >}})(유실 지점) |
| **ClickHouse** | 이 장 §2~§5 · [복제·멀티마스터·failover]({{< relref "06-replication-failover.md" >}}) |
| **ClickHouse Keeper** | [Keeper]({{< relref "05-keeper.md" >}}) · [복제·멀티마스터·failover]({{< relref "06-replication-failover.md" >}}) |
| **MongoDB** | [스택 토폴로지]({{< relref "01-stack-topology.md" >}}) §6 최소 규모 배포 · [MongoDB 최소 배포]({{< relref "../../rum/07-hyperdx-mongodb.md" >}}) |

### 1.2 blast radius — 어디까지 번지나

판단의 핵은 하나입니다: **관측 스택은 컴포넌트 하나가 죽어도 전체가 멎지 않도록 경계가 나뉘어 있습니다.**

- **HyperDX app/api 다운** → UI·쿼리만. 브라우저 → Collector → CH 적재 경로는 그대로 흐릅니다(app은 조회 대면일 뿐 ingest 경로 밖).
- **OTel Collector 다운** → 신규 ingest만 정지. `file_storage` 퍼시스턴트 큐가 있으면 in-flight를 디스크에 붙잡고 복귀 후 재개하며, 큐가 없으면 그 구간 이벤트만 유실됩니다.
- **MongoDB 다운** → 설정·알럿 평가·UI. 이미 적재 중인 관측 데이터는 무관합니다.
- **ClickHouse 전체 다운** → 조회 + 수집 **둘 다** 정지(저장·쿼리 원천이라 가장 광범위). replica 1대만 죽으면 나머지가 계속 서빙합니다.
- **Keeper 정족수 상실** → 쓰기(INSERT/DDL/머지) 정지, **읽기는 계속**. 데이터 노드가 멀쩡해도 조정 계층 과반 상실만으로 쓰기가 멈추는 유일한 지점입니다.

{{< callout type="warning" >}}
광범위 정지는 둘뿐입니다 `Σ`: **CH 전체 다운**(저장 원천), 그리고 **Keeper 정족수 상실**(쓰기 경로). app/api·Collector·MongoDB 다운은 조회·수집 일부 또는 설정에 국한되므로, "하나가 죽으면 관측 전체가 멎는다"는 통념은 이 두 지점에만 해당합니다.
{{< /callout >}}

사건별로 얼마나 걸리고 무엇이 필요한지는 §5의 S1~S9가, 정족수 상실이 왜 read-only 전락으로 나타나는지는 [복제·멀티마스터·failover]({{< relref "06-replication-failover.md" >}})가 이어받습니다.

## 2. 전제 뒤집기 — EBS면 "노드=데이터" 결합이 끊긴다

로컬 NVMe(i7i/i8g)를 전제한 기존 corpus 전체([스토리지·로컬 NVMe]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}}), 배포·운영 페이지)가 반복하는 명제는 **"노드 유실 = 데이터 유실 = 재수화(전량 재전송) 이벤트"**입니다. 재수화 시간 ≈ 노드당 데이터량 / 재복제 대역이고 RF2는 그 창 동안 실질 RF1로 떨어진다는 게 핵심 위험이었습니다(근거는 clickhouse/02·04) `✓`.

**EBS-first는 이 인과 사슬의 첫 고리를 끊습니다.** EBS 볼륨은 EC2 인스턴스와 독립된 네트워크 블록 스토리지라 노드(인스턴스)가 사라져도 볼륨과 그 안의 데이터는 그대로 남습니다 `✓`. Kubernetes/EBS CSI 관점에서 노드 유실은 "데이터 소실"이 아니라 **"볼륨을 죽은 노드에서 떼어(detach) 새 노드에 다시 붙이는(reattach) 작업"**이 됩니다 `✓`.

{{< flow src="_flow/전제-뒤집기-ebs-면.json" />}}

`*` 정확히는 reattach가 끝날 때까지 그 replica가 **일시 offline**인 것이지 유실이 아닙니다. 데이터가 온전하므로 RF는 "감소"가 아니라 "일시 미가용"이며, catch-up은 Keeper 로그가 가리키는 밀린 파트(델타)만 fetch합니다 — RMT가 로컬 파트 존재를 확인하고 누락분만 받는 표준 동작이라는 clickhouse/04 §무손실 지점의 EBS 귀결입니다 `≈`. 다만 **reattach + CH startup(part-load) 실소요 시간은 hot 데이터량·파트 수에 좌우되며 아직 실측 전입니다** `?`.

| 축 | 로컬 NVMe | EBS gp3/io2 |
|---|---|---|
| 노드 유실 시 데이터 | 소실 | **생존(볼륨에 잔존)** |
| 복구 동작 | 다른 replica에서 **전량 재fetch** | **볼륨 reattach + 델타 catch-up** |
| 복구 시간 지배 요인 | 노드당 데이터량 / 복제 대역 (수 시간) | detach/attach latency + CH startup (수 분) `≈` |
| 복구 중 redundancy | RF2 → 실질 RF1 (창 = 수 시간) | RF 온전(데이터 안 잃음), 그 replica만 수 분 offline |
| 2차 장애 노출 | 재수화 창 내내 (길다) | reattach 창만 (짧다) |
| AZ 이동 | 데이터 없으니 어느 AZ든 새로 채움 | **같은 AZ만 reattach 가능(볼륨이 AZ-bound)** |

**결론 `≈`**: 로컬 NVMe에서 "RF3·shard 수평 확장·On-Demand 강제"를 밀어붙인 이유의 상당 부분은 재수화 위험 창을 줄이려는 데 있었습니다. EBS-first에서는 그 창이 애초에 짧으므로 중소 규모(우리 RUM 0.7TB/월)에서는 **1 shard × RF2**가 훨씬 방어하기 쉬운 기본값이 됩니다. 대신 EBS 고유의 새 위험 두 개 — **AZ-bound**와 **ungraceful death의 무한 Terminating** — 이 전면에 옵니다.

## 3. EBS는 AZ에 묶인다 — reattach의 숨은 전제

EBS 볼륨은 **생성된 AZ에 물리적으로 고정**되는 zonal resource입니다 `✓`. Kubernetes에서 이 볼륨을 감싼 PV는 `nodeAffinity`로 `topology.ebs.csi.aws.com/zone: <az>` 라벨을 달고 이 제약은 **영구적**입니다 `✓`.

- **정상 바인딩은 `WaitForFirstConsumer`로** `✓`: 파드가 스케줄된 뒤 그 노드의 AZ에 볼륨을 프로비저닝해 topology mismatch를 피합니다. `Immediate` 바인딩은 "compute는 az-b, storage는 az-a" 데드락(`1 node(s) had volume node affinity conflict`)을 유발합니다. StorageClass 예제와 gp3/io2 스펙은 [hot 스토리지·EBS]({{< relref "02-hot-storage-ebs.md" >}})로 위임합니다.
- **reattach의 숨은 전제**: 죽은 노드의 파드를 재스케줄할 때 그 PVC에 묶인 EBS 볼륨은 **같은 AZ의 노드로만** 붙을 수 있습니다 `✓`. 같은 AZ에 여유 노드가 없으면(또는 그 AZ가 통째로 죽었으면) 파드는 **Pending에 무한정 걸립니다**. 즉 reattach는 "같은 AZ에 새 노드를 띄울 수 있다"는 전제 위에서만 자동 복구입니다.
- **그래서 AZ 장애는 여전히 replica로만 방어된다**: EBS는 다른 AZ로 못 옮기므로 AZ 하나가 죽으면 그 AZ의 모든 replica·볼륨이 접근 불가가 되고 **다른 AZ에 걸친 replica(cross-AZ RF)**만이 클러스터를 살립니다. 이 지점에서 EBS와 로컬 NVMe의 처방이 수렴합니다 — "replica를 서로 다른 AZ에" 강제하는 anti-affinity + `topologySpreadConstraints`는 둘 다 필수입니다.

{{< callout type="warning" >}}
**정정 — "EBS면 replica 없이도 내구성 99.999%면 충분"은 기각** `✓`. io2 Block Express 99.999% durability는 **단일 볼륨의 데이터 소실 확률**일 뿐입니다. replica가 방어하는 것은 그게 아니라 (a) **AZ 장애**(볼륨이 AZ에 묶여 못 옮김), (b) **노드/AZ 유지보수·급사 중 가용성**(볼륨은 살아도 그 replica는 수 분~무한 offline), (c) 볼륨 자체 장애(gp3 AFR ≤0.2% = 1,000볼륨당 연 2건 안팎)입니다 `✓`. RF는 EBS에서도 필수이되 **이유가 내구성에서 가용성·AZ 방어로 옮겨갑니다**.
{{< /callout >}}

### 3.1 EBS multi-attach로 replica를 대체할 수 없다

**통념 기각 `✓`**: "io2 multi-attach로 한 볼륨을 여러 노드가 공유하면 replica가 필요 없다"는 CH에 성립하지 않습니다.

- multi-attach는 **io1/io2만**, **같은 AZ**, Nitro 최대 16 인스턴스.
- **cluster-aware 파일시스템(GFS2/OCFS2)이나 자체 락킹(Oracle RAC류)**에서만 안전합니다. CH가 쓰는 표준 XFS/ext4를 multi-attach로 동시 마운트하면 **데이터 손상**이 발생합니다.
- 부팅 볼륨 불가, 부착 중 on/off 불가.
- 결론: ClickHouse의 shared-nothing RMT 복제와 근본적으로 안 맞습니다. multi-attach는 이 설계에서 **고려 대상이 아닙니다** `≈`.

## 4. EBS 기반 replication & sharding — 우리 스케일의 토폴로지

### 4.1 왜 1 shard × RF2 (또는 RF3)인가

우리 워크로드는 RUM-only, prod 세션 샘플링 100% = **월 0.7TB**입니다(사이징은 [용량 산정]({{< relref "07-capacity-planning.md" >}})으로 위임). 이 규모에서 shard는 용량·병렬성 문제가 아니라 **불필요한 복잡성**입니다 `≈`.

- **shard는 데이터 수평 분할** → 용량·쓰기 처리량·스캔 병렬성. 0.7TB/월이면 hot 티어를 EBS 단일 볼륨(gp3·io2 BE 모두 최대 64 TiB `✓`)에 몇 년치를 담고도 남습니다. shard를 늘리면 [자동 rebalance 없음·수동 리샤딩]({{< relref "../../clickhouse/05-altinity-operations.md" >}})이라는 운영 부채만 생깁니다.
- **replica는 내구성·가용성** → 로컬 NVMe에선 "노드=데이터 유실 방어"였지만 EBS에선 위 §3대로 **AZ 방어 + 가용성**이 목적. RF2(2 AZ)면 AZ 1개 소실에도 다른 AZ replica가 서빙합니다.

**→ 기본 토폴로지: `shardsCount: 1`, `replicasCount: 2`, 2 AZ 분산. CHK 3노드는 3 AZ 분산.**

![멀티 AZ에 걸친 ClickHouse RF2 복제와 Keeper 3노드 쿼럼 배치, 그리고 AZ 한 개가 다운됐을 때의 동작을 정상·장애 두 패널로 정리한 그림](/images/hyperdx/availability-keeper-rf.svg)
*멀티 AZ에 걸친 ClickHouse RF2 복제(ReplicatedMergeTree)와 Keeper 3노드 쿼럼의 배치, 그리고 AZ 하나가 다운돼도 남은 replica가 승격 없이 read+write를 잇고 Keeper 2/3 과반으로 쓰기가 지속되는 동작을 정상·장애 두 패널로 정리했습니다.*

### 4.2 replication 메커니즘 (EBS 관점 재해석)

`layout`을 선언하면 operator가 `remote_servers`와 per-host `macros`(`{shard}`/`{replica}`/`{cluster}`)를 자동 렌더하므로 수동 `config.d`가 불필요합니다(필드 상세는 clickhouse/04로 위임) `✓`. self-host는 `ReplicatedMergeTree`(SharedMergeTree는 Cloud 전용) 강제입니다 `✓`.

- **RMT 쓰기 경로(기본 async)**: Keeper 로그에 파트 등록 ack만 나면 클라이언트에 성공 반환, 나머지 replica는 뒤따라 fetch `✓`. EBS에서도 동일. 차이는 **한 replica가 offline(노드 교체)됐다 돌아왔을 때** — 로컬 NVMe면 볼륨이 비어 전량 fetch, EBS면 볼륨에 이전 파트가 그대로라 **Keeper 로그가 가리키는 누락 파트(델타)만** fetch합니다 `≈`.
- **1 shard이므로 Distributed 테이블·sharding key가 사실상 불필요** `≈`: 단일 shard면 모든 데이터가 한 shard에 있고 replica는 그 사본입니다. HyperDX/ClickStack이 만드는 테이블도 단일 클러스터/단일 shard에서 그대로 동작합니다. Distributed 테이블·`remote_servers` weight·`INSERT INTO SELECT` 리샤딩은 shard가 2+일 때만 의미가 있고 그 절차는 [operator 운영]({{< relref "../../clickhouse/05-altinity-operations.md" >}})으로 위임합니다.

### 4.3 RF2 vs RF3 — EBS에서 판단이 어떻게 달라지나

[배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})의 조합 산술(RF2 × 다중 shard에서 임의 2대 유실 시 손실 노출)·`insert_quorum` 주입 함정은 **로컬 NVMe에서 "2대 유실 = 2 데이터 소실"**을 전제합니다. EBS에선 노드 유실이 데이터 소실이 아니므로 그 산술이 그대로 적용되지 않습니다 `≈`. 확률·비용의 정량은 위 페이지로 위임하고 여기선 EBS 관점의 재해석만 정리합니다.

| | RF2 (2 AZ) — EBS 기본 | RF3 (3 AZ) — 승급 |
|---|---|---|
| shard당 사본 | 2 | 3 |
| 노드 급사 1대 | 데이터 생존(reattach), 그 replica 수 분 offline | 동일, 여유 큼 |
| AZ 1개 소실 | 다른 AZ 1 replica가 서빙(실질 RF1, 데이터 온전) | 다른 2 AZ에 2 replica 잔존 → 무손실·무저하 |
| 볼륨 자체 장애(AFR ≤0.2%) | 다른 replica가 방어 | 2 replica 방어 |
| 비용 배수(산정은 06) | ×2 (EBS $/GB + cross-AZ 복제 트래픽) `≈` | ×3 |

**EBS에서 RF3 승급 트리거 `≈`**:

1. **"AZ 1개 소실 중에도 무저하"**가 요구일 때 — RF2 2AZ는 AZ 소실 시 그 shard가 단일 AZ 단일 사본으로 떨어집니다(데이터는 안전하나 그 창 동안 그 AZ까지 죽으면 가용성 상실). RF3 3AZ는 AZ 하나 죽어도 2 사본.
2. **`insert_quorum: 2`를 상시 켜고 싶을 때** — RF2에서 한 replica가 reattach 중이면 확정 가능 replica가 1이라 `insert_quorum: 2`가 쓰기를 차단합니다. RF3면 reattach 중에도 2 사본이라 쓰기·내구성 양립(quorum 프로파일 주입 함정은 clickhouse/04로 위임).
3. 규제/무손실 요구.

**우리 RUM 기본값 `≈`: RF2 2AZ.** 0.7TB/월·관측성 append-only·재부착 창이 수 분이라 RF2의 노출이 실무상 수용 가능합니다. AZ 무저하 생존이 명시 요구가 되면 RF3로 승급합니다.

### 4.4 EBS 기반 CHI/CHK YAML 초안

매니페스트 전문은 길어서 접어 둡니다 — 필드 전수 설명은 [배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})이 소유하고 여기서는 **EBS·다운타임 관련 필드만** 주석한 초안을 둡니다.

{{% details title="EBS 기반 CHI(1 shard × RF2, gp3, 2 AZ) · CHK(3노드, gp3, 3 AZ) YAML 초안 전문" closed="true" %}}
> 필드 전수 설명은 [배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})으로 위임합니다. 여기선 **EBS·다운타임 관련 필드만** 주석합니다. 데이터 노드는 EBS 기반 Graviton **r7g**(메모리 최적화) 노드풀 기준입니다(r8g/Graviton4는 상위 옵션 `≈`). 로컬 NVMe(i7i/i8g)는 이 카테고리 기본이 아닙니다 → [스토리지·로컬 NVMe]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}}). **인스턴스별 EBS-optimized 대역폭 상한이 gp3 볼륨 스펙(2,000 MiB/s)보다 낮아 실효 병목이 될 수 있습니다** — 상세는 [hot 스토리지·EBS]({{< relref "02-hot-storage-ebs.md" >}}).

**CHI — 1 shard × RF2, gp3, 2 AZ**

```yaml
apiVersion: "clickhouse.altinity.com/v1"
kind: "ClickHouseInstallation"
metadata:
  name: hyperdx-ch
  namespace: clickhouse
spec:
  defaults:
    storageManagement:
      provisioner: StatefulSet     # EBS도 기본 StatefulSet. 온라인 확장이 필요하면 Operator provisioner(§노브 주의)
      reclaimPolicy: Retain        # CHI/STS 삭제·helm uninstall에도 EBS PVC 잔존(실수 삭제 방어)
    templates:
      podTemplate: ch-ebs
      dataVolumeClaimTemplate: data-gp3     # → /var/lib/clickhouse
      logVolumeClaimTemplate:  log-gp3      # → /var/log/clickhouse-server
      serviceTemplate: ch-svc
  configuration:
    zookeeper:
      keeper: { name: hyperdx-keeper }      # 아래 CHK를 이름으로 참조(0.27.0+). 고전 nodes 방식은 clickhouse/04
      session_timeout_ms: 30000
    clusters:
      - name: main
        pdbManaged: "yes"          # PDB 자동 생성(§9)
        pdbMaxUnavailable: 1       # 한 번에 replica 1개만 down → 자발적 중단 직렬화
        layout:
          shardsCount: 1           # 우리 스케일: 단일 shard로 충분(리샤딩 부채 회피)
          replicasCount: 2         # RF2. AZ 무저하 요구 시 3
    settings:
      max_concurrent_queries: 200
      logger/level: information
    users:
      app/k8s_secret_password: default/ch-secret/password_sha256   # 시크릿 참조(평문 금지)
      app/networks/ip: ["10.0.0.0/8"]
      app/profile: default
  templates:
    podTemplates:
      - name: ch-ebs
        podDistribution:
          - { type: ClickHouseAntiAffinity, topologyKey: "kubernetes.io/hostname" }   # replica를 서로 다른 노드에(1 shard라 ShardAntiAffinity와 동치)
        spec:
          # AZ 분산은 topologySpreadConstraints로 강제(EBS AZ-bound 방어의 핵심)
          topologySpreadConstraints:
            - maxSkew: 1
              topologyKey: "topology.kubernetes.io/zone"
              whenUnsatisfiable: DoNotSchedule
              labelSelector:
                matchLabels:
                  clickhouse.altinity.com/cluster: main   # [미확인] 정확한 라벨 키는 배포 후 kubectl get pod --show-labels로 확인
          nodeSelector: { workload: clickhouse }          # r7g 전용 노드풀
          tolerations:
            - { key: dedicated, operator: Equal, value: clickhouse, effect: NoSchedule }
          containers:
            - name: clickhouse
              image: clickhouse/clickhouse-server:24.8   # ClickStack 병용 요구: 24.8 LTS+. 차트 기본태그는 관찰값일 뿐
              resources:
                requests: { cpu: "4", memory: "32Gi" }
                limits:   { cpu: "4", memory: "32Gi" }
    volumeClaimTemplates:
      - name: data-gp3
        reclaimPolicy: Retain
        spec:
          accessModes: ["ReadWriteOnce"]           # EBS는 RWO(multi-attach 불가, §3.1)
          storageClassName: gp3                     # WaitForFirstConsumer gp3 SC(자매 02로 위임)
          resources: { requests: { storage: 1000Gi } }   # prod hot 티어 노드당 order ~1TB. staging은 훨씬 작게(10~100Gi). 실값은 06
      - name: log-gp3
        spec:
          accessModes: ["ReadWriteOnce"]
          storageClassName: gp3
          resources: { requests: { storage: 50Gi } }
    serviceTemplates:
      - name: ch-svc
        spec:
          type: ClusterIP
          ports:
            - { name: http, port: 8123 }
            - { name: tcp,  port: 9000 }
```

> **podDistribution enum(CRD 원문 확인) `✓`**: `ClickHouseAntiAffinity` / `ShardAntiAffinity` / `ReplicaAntiAffinity` / `MaxNumberPerNode` / `CircularReplication` 등. 우리는 1 shard라 `ClickHouseAntiAffinity`(hostname)로 replica를 분리하고 `topologySpreadConstraints`(zone)로 AZ 분산이면 충분합니다. shard가 2+로 커지면 `ShardAntiAffinity`(hostname+zone 이중)로 전환합니다(clickhouse/05로 위임).

**CHK — 3노드, gp3, 3 AZ**

```yaml
apiVersion: "clickhouse-keeper.altinity.com/v1"
kind: "ClickHouseKeeperInstallation"
metadata:
  name: hyperdx-keeper
  namespace: clickhouse
  annotations: { prometheus.io/port: "7000", prometheus.io/scrape: "true" }
spec:
  configuration:
    clusters:
      - name: keeper
        layout: { replicasCount: 3 }      # 홀수 3노드 정족수(1 장애 허용). Raft 산술은 05-keeper로 위임
    settings:
      keeper_server/tcp_port: "2181"
      listen_host: "0.0.0.0"
      keeper_server/four_letter_word_white_list: "*"   # ruok/imok 라이브니스(0.27.0+)
      prometheus/endpoint: "/metrics"
      prometheus/port: "7000"
      prometheus/metrics: "true"
  defaults:
    templates: { podTemplate: keeper-pod, dataVolumeClaimTemplate: keeper-data }
  templates:
    podTemplates:
      - name: keeper-pod
        spec:
          affinity:
            podAntiAffinity:
              requiredDuringSchedulingIgnoredDuringExecution:
                - labelSelector:
                    matchExpressions:
                      - { key: "app", operator: In, values: ["clickhouse-keeper"] }
                  topologyKey: "kubernetes.io/hostname"      # 3 Keeper를 서로 다른 노드(가능하면 3 AZ)
          containers:
            - name: clickhouse-keeper
              image: "clickhouse/clickhouse-keeper:24.8"     # CH와 버전 정렬(24.8 LTS+)
              resources:
                requests: { memory: "256M", cpu: "1" }
                limits:   { memory: "4Gi",  cpu: "2" }
    volumeClaimTemplates:
      - name: keeper-data
        spec:
          accessModes: ["ReadWriteOnce"]
          storageClassName: gp3      # Keeper는 gp3(영속) — 로컬 NVMe에 두면 노드 급사 시 Raft 메타 소실. 저지연 fdatasync가 관건, 20Gi급 충분(05-keeper로 위임)
          resources: { requests: { storage: 20Gi } }
```

> **EBS 관점의 Keeper 이점 `≈`**: Keeper 데이터를 gp3에 두면 노드가 급사해도 Raft 로그/스냅샷이 볼륨에 살아남아, 데이터 경로 CH와 마찬가지로 **reattach로 정족수를 되살립니다**. 로컬 NVMe였다면 Keeper 노드 급사가 곧 메타데이터 소실이라 앙상블 재구성이 훨씬 번거롭습니다. EBS-first는 데이터 경로와 조정 경로의 복구 모델을 통일합니다.
{{% /details %}}

## 5. 다운타임 상세 — 이벤트 축 S1~S9 (EBS 관점)

> 복제·멀티마스터 관점의 failover 의미론(왜 "승격" 절차가 없는지·split-brain 방지·정족수 상실 시 read-only)은 [복제·멀티마스터·failover]({{< relref "06-replication-failover.md" >}})가 기준 문서입니다. 이 절은 그 위에서 **EBS 물리 역학·복구 절차**만 다룹니다.

§1이 "무엇이 죽으면 무엇이 멈추나"(컴포넌트 축)였다면 이 절은 **"어떤 사건에서 얼마나 걸리고 무엇이 필요한가"**(이벤트 축)입니다. 두 축을 한 표로 합치지 않는 이유가 여기 있습니다 — 같은 CH 한 컴포넌트가 사건에 따라 무중단부터 무한 Terminating까지 갈립니다.

전제: 위 **1 shard × RF2(2 AZ)** + CHK 3노드(3 AZ), operator PDB 자동(`pdbMaxUnavailable: 1`), 쓰기는 기본 async(`insert_quorum` 미설정).

7열 매트릭스는 폭 제약을 넘어서므로 시나리오별 불릿으로 풉니다. 각 항목은 **무슨 일 → 읽기/쓰기 영향 → 대략 소요 → EBS 특유 포인트** 순서입니다.

- **S1 — 설정 변경 reconcile**(config.d) — ConfigMap 갱신 → 각 host 파드 순차 in-place 재시작. 읽기 무중단(다른 replica 서빙) · 쓰기 무중단(async) · 소요는 전파 대기 + replica 수 × 파드 재시작. EBS 특유: **볼륨 detach 안 함** — 같은 노드에서 파드만 재생성, EBS 그대로 유지.
- **S2 — CH 이미지 롤링 업그레이드** — replica 1개씩 restart, 분산쿼리에서 low-priority 제외. 읽기·쓰기 모두 무중단(async) · 소요는 replica 수 × (종료+startup+catch-up). EBS 특유: in-place restart, reattach 없음. 절차·혼합버전 창은 [clickhouse/05]({{< relref "../../clickhouse/05-altinity-operations.md" >}}).
- **S3 — operator 업그레이드** — operator Deployment 교체, 대개 CH 파드 불변. 읽기·쓰기 모두 무중단 · 소요는 분 단위. EBS 특유: 데이터 경로 무영향. minor 스킵·CRD 삭제 금지는 [clickhouse/05]({{< relref "../../clickhouse/05-altinity-operations.md" >}}).
- **S4 — 계획된 노드 교체**(drain / Karpenter voluntary) — cordon→drain(PDB 준수)→볼륨 detach→같은 AZ 새 노드 attach→startup→catch-up. 읽기 무중단(`pdbMaxUnavailable:1`) · 쓰기 무중단 · 소요는 detach+attach+startup ≈ **수 분** `≈`. EBS 특유: **재수화 없음**. Karpenter ≥ v1.0은 VolumeAttachment 삭제까지 대기 후 노드 종료 `✓`.
- **S5 — 노드 재부팅**(같은 노드 복귀) — 파드 잠깐 down → 같은 노드에서 복귀, 볼륨 유지. 읽기는 그 replica만 잠깐 offline · 쓰기 무중단(async) · 소요는 재부팅+CH startup. EBS 특유: 볼륨 detach조차 없음 — 가장 가벼운 케이스.
- **S6 — 파드 재스케줄**(graceful, `kubectl delete pod`) — 파드 정상 종료 → 볼륨 detach → 같은 AZ 노드에 reattach. 읽기는 그 replica만 수 분 offline · 쓰기 무중단(async) · 소요는 detach+attach+startup ≈ 수 분 `≈`. EBS 특유: graceful이라 CSI가 NodeUnstage를 정상 수행 → 자동 reattach 성공.
- **S7 — 노드 급사**(hardware/OS hang, **ungraceful**) — 파드 Terminating에 걸림; 6분 force-detach; out-of-service taint로 즉시화. 읽기는 그 replica offline, 나머지 서빙 → **읽기 무중단** · 쓰기는 **async면 무중단**(다른 replica로) · 소요는 **무개입 시 무한/6분+**, taint 개입 시 수 분 `✓`. EBS 특유: 아래 §5.1 상세. **자동 복구 안 됨 — 개입 필요**.
- **S8 — AZ 장애** — 그 AZ의 replica·EBS 접근 불가, **다른 AZ로 볼륨 못 옮김**. 읽기는 다른 AZ replica가 서빙(cross-AZ RF 전제) · 쓰기는 다른 AZ replica로 무중단 · 소요는 AZ 복구까지 그 replica 미가용. EBS 특유: **EBS AZ-bound** → reattach 불가. **RF(cross-AZ)만이 방어**. RF2 2AZ면 그 shard 실질 RF1.
- **S9 — Keeper 정족수 상실**(3노드 중 2 소실) — 조정 계층 정지. 읽기는 로컬 파트 read OK · 쓰기는 **INSERT/DDL 정지** — read-only 전락의 의미론·에러 코드·판별 컬럼은 [복제·멀티마스터·failover]({{< relref "06-replication-failover.md" >}})가 단일 정본이므로 여기서 재서술하지 않습니다 · 소요는 정족수 복구까지. EBS 특유: CHK gp3라 노드 급사해도 Raft 메타 생존 → reattach로 복구. 정족수 산술·Keeper 자체는 [05-keeper]({{< relref "05-keeper.md" >}}).

**핵심 대비**: S4~S6에서 로컬 NVMe였다면 "재수화 이벤트"(수 시간, RF2→실질 RF1)였을 것이 EBS에선 "reattach + 델타 catch-up"(수 분, RF 온전)이 됩니다. 반면 S8(AZ 장애)은 EBS·로컬 NVMe 모두 cross-AZ RF가 유일 방어라는 점에서 동일합니다.

### 5.1 S7 상세 — ungraceful node death의 진짜 다운타임 (EBS 최대 함정)

{{< callout type="error" >}}
**"EBS면 노드가 죽어도 자동으로 새 노드에 붙어 복구된다"는 절반만 맞습니다** `✓`. **graceful**(drain, `kubectl delete pod`, Karpenter voluntary)이면 맞습니다. 하지만 **ungraceful**(하드웨어 급사, OS hang, 네트워크 단절)이면 StatefulSet + RWO(EBS) 조합은 **자동 복구되지 않고 파드가 Terminating에 무한정 걸립니다**. 운영자 개입이 필요합니다.
{{< /callout >}}

{{% details title="S7 상세 — 무한 Terminating의 원인·시퀀스·복구 절차 전문" closed="true" %}}
**왜 무한 Terminating인가** `✓`: Kubernetes는 죽은 노드의 파드가 정말 멈췄는지 확인할 수 없습니다(kubelet 응답 없음). RWO 볼륨을 새 노드에 붙였는데 옛 노드에서 파드가 아직 살아 쓰고 있으면 **더블 마운트=데이터 손상**이므로, 컨트롤 플레인은 안전하게 "확인 불가"를 택하고 파드를 Terminating으로 남깁니다. StatefulSet은 at-most-one 보장 때문에 옛 파드가 완전히 사라지기 전엔 대체 파드를 만들지 않습니다.

{{< seq src="_seq/s7-상세-ungraceful-node.json" />}}

- **node-monitor-grace-period ≈ 40s**: 노드 NotReady 표시 `✓`. 단 EKS 관리형 컨트롤 플레인의 실제 기본값은 사용자가 못 바꾸는 값이라 배포 시 재확인 권장 `≈`.
- **기본 toleration `node.kubernetes.io/unreachable:NoExecute` tolerationSeconds=300(5분)**: 이후 파드 삭제 요청 `✓`.
- **Attach/Detach 컨트롤러 force-detach: 6분 대기** `✓`. 단 CSI 정합성(옛 노드에서 NodeUnstage/Unpublish 미확인) 때문에 실제로는 보류될 수 있고, 그 사이 새 노드 attach 시도는 `Multi-Attach error for volume ... already exclusively attached to one node` 이벤트를 냅니다 `✓`.
- **결과**: 개입 없으면 StatefulSet 대체 파드가 안 뜨고 그 replica는 무한 미가용. (읽기·쓰기 자체는 RF2의 다른 replica가 계속 서빙하므로 **클러스터 다운은 아니다** — 저하 상태.)

**복구(개입)** `✓`:

```bash
# 1. 노드가 정말 죽었음을 확인(재부팅 중이 아님) — 오판하면 더블 마운트 위험
# 2. out-of-service taint로 강제 정리(K8s 1.28 GA, NodeOutOfServiceVolumeDetach)
kubectl taint nodes <dead-node> node.kubernetes.io/out-of-service=nodeshutdown:NoExecute
#    → 파드 강제 삭제 + EBS 즉시 detach → 같은 AZ 새 노드에 reattach → CH startup → 델타 catch-up
# 3. 노드 복구 후 taint 제거
kubectl taint nodes <dead-node> node.kubernetes.io/out-of-service=nodeshutdown:NoExecute-
```

- taint 없이 `kubectl delete pod --force`도 파드는 지우지만 force-detach 6분과 CSI 정합성 문제를 우회하지 못할 수 있어 **out-of-service taint가 정석** `✓`.
- **자동화 고려 `≈`**: 프로덕션은 node-problem-detector + 자동 taint 부여(예: Medik8s NHC류)로 이 개입을 자동화합니다. 단 "정말 죽었나" 오판 시 더블 마운트 위험이 있어 도구·타이밍은 별도 검증이 필요합니다 `?`.

**EBS vs 로컬 NVMe의 역설 `≈`**: 로컬 NVMe는 노드 급사 시 데이터가 어차피 사라지므로 "새 노드에서 빈 볼륨으로 재수화"가 자연스러워 무한 Terminating이 상대적으로 덜 아픕니다(어차피 재구축). EBS는 데이터가 살아있어 reattach만 하면 되는데 **바로 그 RWO 안전장치 때문에 자동 reattach가 막혀** 개입이 필요합니다. EBS의 강점(데이터 생존)이 이 시나리오에선 운영 개입 요구로 되돌아옵니다.
{{% /details %}}

## 6. 무엇을 지켰나 — 무손실은 두 트랙으로 갈린다

무손실 방어는 **한 메커니즘이 아니라 성격이 다른 두 트랙**으로 나뉩니다. 이걸 뭉뚱그리면 "Keeper가 데이터를 지킨다" 같은 오해가 생깁니다.

{{< flow src="_flow/3-무손실은-두-트랙-텔레메트리.json" />}}

### 6.1 트랙 1 — 텔레메트리(대량·스트리밍)

경로는 브라우저 SDK → OTel Collector → ClickHouse이고 방어선은 이어붙인 두 겹입니다.

1. **Collector 앞단**: `sending_queue`는 기본 인메모리라 파드가 죽으면 in-flight가 소실됩니다 `✓`. `file_storage` extension을 붙이면 디스크 WAL이 되어 재시작 후에도 큐를 이어 처리합니다(배포 Collector 빌드에 기본 포함되는지는 도입 시 재확인) `✓/≈`. 큐가 가득 차면 `block_on_overflow`로 드롭 대신 블록시킵니다.

   ```yaml
   exporters:
     clickhouse:
       sending_queue:
         enabled: true
         storage: file_storage/otc   # 메모리 → 디스크 WAL
         block_on_overflow: true     # 가득 차면 드롭 대신 블록
   ```

2. **CH 내부**: RMT 복제(RF2/3)가 노드 손실을 흡수하고, 신뢰가 더 필요한 경로만 `insert_quorum`으로 확정 강도를 올립니다. 재시도가 중복을 안 만드는 건 블록 dedup 덕분입니다(at-least-once → 사실상 exactly-once) `✓`. 파트 자체의 백업은 clickhouse-backup이 맡습니다.

Keeper는 이 트랙 어디에도 이벤트 데이터를 들고 있지 않습니다 — **정족수를 잃으면 쓰기 자체가 막힐 뿐**, "Keeper가 데이터를 붙잡고 있다가 재개"하는 동작은 없습니다 `✓`. Kafka와의 구분·async_insert 세만틱·유실 지점 표는 [Keeper]({{< relref "05-keeper.md" >}})가, 멀티마스터·승격 없는 failover·split-brain 방지는 [복제·멀티마스터·failover]({{< relref "06-replication-failover.md" >}})가 기준 문서입니다.

### 6.2 트랙 2 — 메타데이터(소량·문서)

경로는 HyperDX api ↔ MongoDB입니다. 적재량과 무관하게 사용자·대시보드·알럿 설정만 지키면 되므로 스트리밍 큐 같은 장치가 필요 없습니다.

- **ReplicaSet `members:3`**: Primary + Secondary×2, 자동 failover(선출 수 초). `members:1`은 파드 재시작엔 버티지만 노드/AZ 상실·PVC 손상엔 메타 유실입니다 `✓`.
- **`mongodump` CronJob → S3**: MCK(Community Operator)에는 내장 백업이 없습니다 — Ops Manager PITR은 Enterprise 전용이라 self-host면 덤프를 직접 짭니다(메타 소용량이라 수 초·수 MB) `✓`.

메타 데이터셋 자체가 작아 `members:3`의 절대 비용은 미미합니다("값싼 보험") — 최소 형상 매니페스트·Atlas 위임 비교는 [MongoDB 최소 배포]({{< relref "../../rum/07-hyperdx-mongodb.md" >}})가 기준 문서입니다.

**두 트랙의 내구성 메커니즘은 완전히 다릅니다** `Σ`: 트랙 1은 스트리밍 파이프라인의 **큐 퍼시스턴스 + part 복제**로, 트랙 2는 소량 문서 스토어의 **ReplicaSet 복제 + 덤프**로 지킵니다. Keeper 정족수는 트랙 1의 **쓰기 가용성**을 좌우할 뿐, 그 자체가 이벤트 데이터를 보관하지는 않습니다.

## 7. 스케일 축 — 처리량 vs 가용성 vs 용량

스케일이 사는 이유는 컴포넌트마다 다릅니다 `Σ`.

| 축 | 대상 | 늘리면 얻는 것 |
|---|---|---|
| 수평 replica(처리량) | app/api, Collector — 무상태 | 동시 요청·ingest 처리량 |
| 복제(가용성) | CH replica, Keeper, MongoDB — 스테이트풀 | 고장 도메인 방어(승격·failover 절차 아님) |
| shard(용량) | CH만, **이 규모에선 불필요** | 데이터·쓰기 병렬 — 0.7TB/월엔 오히려 부채 |

같은 내용을 컴포넌트별로 옮겨 적으면 이렇습니다.

| 컴포넌트 | 스케일 축 |
|---|---|
| **HyperDX app/api** | 수평 replica |
| **OTel Collector** | 수평 replica |
| **ClickHouse** | shard(용량, 0.7TB/월엔 불필요) / replica(가용성) |
| **ClickHouse Keeper** | 3/5노드(내구성·정족수용, 처리량 아님) |
| **MongoDB** | 불필요(부하∝설정 수, 적재량 무관) `✓` |

**app·Collector는 수평 replica로 처리량**을 늘리고(무상태라 단순 복제), **CH replica·Keeper·Mongo는 복제로 가용성**을 얻습니다(처리량이 아니라 고장 도메인 방어). 용량·쓰기 병렬을 늘리는 축은 **CH shard 하나뿐인데, 0.7TB/월 규모에선 shard가 부채이므로 불필요**합니다 `Σ` — 즉 이 스케일에서 늘려야 할 것은 가용성용 replica이지 용량용 shard가 아니며 그 판단의 산술은 위 §4.1이 소유합니다.

이 가용성 전제 위에서 각 컴포넌트를 **어떤 옵션으로 프로비저닝하나**(hot/cold 스토리지·operator 노브·block-only 튜닝)는 [hot 스토리지·EBS]({{< relref "02-hot-storage-ebs.md" >}})·[S3 콜드 티어링]({{< relref "03-s3-cold-tiering.md" >}})·[블록 온리 튜닝]({{< relref "08-block-only-tuning.md" >}})과 이 장의 §8~§9가 잇습니다.

## 8. 배치 강제 — 노드/AZ 1개 소실이 shard 전멸이 되지 않게

replica를 2벌 두는 것만으로는 부족하고 **서로 다른 고장 도메인**에 놓여야 합니다. 규칙 자체는 EBS-first에서도 로컬 NVMe와 같되 **"AZ 분산"의 무게가 더 큽니다** — EBS가 AZ-bound라 AZ 방어가 유일하게 reattach로 못 푸는 축이기 때문입니다.

| 기제 | 필드 | 막는 것 | EBS 관점 |
|---|---|---|---|
| hostname 분산 | `podDistribution: ClickHouseAntiAffinity` | 같은 shard replica 노드 몰림 | 한 노드 죽어도 shard 생존 |
| AZ topology spread¹ | `topologySpreadConstraints` | shard replica AZ 몰림 | **EBS 핵심** — reattach 불가, cross-AZ만 방어 |
| PDB | `pdbManaged: yes` + `pdbMaxUnavailable: 1` | 자발적 중단의 shard 2대 동시 down | drain/롤링/consolidation 직렬화 |

¹ 필드는 `whenUnsatisfiable: DoNotSchedule`로 설정합니다. 다중 shard면 `ShardAntiAffinity`(zone)도 병용합니다.

- **RF2를 2 AZ에 펴면 AZ 1개 소실 시 그 shard가 단일 AZ 단일 사본으로 하락** `≈`. 데이터는 살아있는 AZ에 온전하나, 그 창 동안 그 AZ까지 흔들리면 가용성 상실. "AZ 무저하"가 요구면 RF3 3AZ.
- **PDB는 자발적 중단만 막습니다** `✓`. S7(급사) 같은 비자발적 시간차 장애는 PDB로 못 막고 그 방어는 RF(+빠른 out-of-service 복구)입니다.

## 9. PDB·probe·reconcile 노브가 롤링 다운타임에 미치는 영향

> 롤링 업그레이드의 **버전 호환 매트릭스·`compatibility` 설정·다운그레이드 비지원·EBS 스냅샷 롤백**은 [버전 호환·업그레이드]({{< relref "09-version-upgrade-compat.md" >}})가 기준 문서입니다. 이 절은 그 아래의 다운타임 물리 역학(PDB·probe·reconcile)만 다룹니다.

롤링·reconcile 중 "한 번에 얼마나 오래, 몇 개가 down되나"를 정하는 operator 노브들. CRD 원문(`clickhouse-operator-install-bundle.yaml`)으로 확인 `✓`.

이 노브들이 실제로 걸리는 자리는 operator 내부 reconcile 루프입니다. 이벤트는 ListenQueue → Add/DeleteCHI 핸들러로 들어와 WalkTillError로 CHI→Cluster→Shard→Host 단위까지 순차 reconcile되는데, host 단계의 마지막이 `waitStatefulSetGeneration`입니다 — 이름 그대로 **operator가 reconcile 전체 시간의 대부분을 이 대기 구간에서 소모합니다**. 아래 `reconcile.host.wait.probes`(readiness 게이팅)·`reconcile.host.wait.replicas`(catch-up 게이팅)가 바로 이 대기를 얼마나 길게·엄격하게 만들지 조절하는 노브입니다.

![clickhouse-operator의 reconcile 내부 흐름 — ListenQueue부터 waitStatefulSetGeneration까지](/images/hyperdx/altinity-operator-reconciler.png)
*clickhouse-operator의 reconcile 이벤트 처리 흐름: ListenQueue가 CHI Add/Update/Delete 이벤트를 받아 WalkTillError로 CHI → Cluster → Shard → Host 단위를 순차 reconcile하고, host 단계 마지막의 waitStatefulSetGeneration에서 새 StatefulSet generation이 준비될 때까지 대기한다("Waiting HERE most of the time"). 출처: [Altinity/clickhouse-operator](https://github.com/Altinity/clickhouse-operator) — © Altinity Ltd, Apache License 2.0*

- **PDB(자동 생성)**: `pdbManaged`(기본 enabled)로 operator가 cluster 단위 PDB를 자동 생성·reconcile합니다. `pdbMaxUnavailable: 1`이 표준 — drain/consolidation/롤링이 같은 shard 2대를 동시에 못 내리게 직렬화합니다. `0`이면 자발적 eviction 전면 차단.
- **probe와 host launch 대기(`reconcile.host.wait.probes`)**: `startup`은 **기본 대기 안 함**, `readiness`는 **기본 대기**. 즉 롤링에서 operator는 readiness 통과를 기본으로 게이팅합니다. **EBS reattach 후 CH가 파트를 로드해 readiness에 도달하는 시간이 곧 그 host의 "다음으로 넘어가기까지 지연"입니다.** hot 데이터가 크면 part-load가 길어져 롤링 총 시간이 늘 수 있습니다(part-load 실측 필요) `≈`. liveness/readiness는 CH `/ping`(HTTP 8123)에 GET하며, `suspend: true`면 probe가 비활성화됩니다 `✓`.
- **catch-up 게이팅(`reconcile.host.wait.replicas`)**: `.new`/`.all`/`.delay`로 reattach·scale-out 후 "따라잡을 때까지 다음 단계 보류"를 강제. EBS 델타 catch-up은 로컬 NVMe 전량 재수화보다 짧으므로 이 대기도 짧게 끝날 가능성이 높습니다 `≈`.
- **STS 업데이트 실패 안전장치(`reconcile.statefulSet.update`)**: `timeout`(0–3600s, Ready 대기 상한)·`pollInterval`(1–600s)·`onFailure`(`abort`|`rollback`|`ignore`). EBS reattach가 지연돼 timeout을 넘기면 이 정책이 발동하므로, hot 데이터가 큰 노드는 `timeout`을 넉넉히 잡습니다 `≈`.
- **볼륨 소실 처리(`reconcile.host.drop.replicas`)**: `onDelete`/`onLostVolume`/`active`. EBS에선 볼륨이 잘 안 사라지므로(reattach) 이 경로는 로컬 NVMe만큼 자주 타지 않지만 볼륨 자체 장애(AFR ≤0.2%)로 새 볼륨을 세울 땐 `onLostVolume: yes` + `active: no`(살아있는 replica는 절대 drop 안 함)로 Keeper 등록을 정리합니다 `≈`.
- shard 병렬 reconcile(`reconcileShardsThreadsNumber` 1 / `reconcileShardsMaxConcurrencyPercent` 50%)은 우리 1 shard에선 무의미하고 다중 shard로 커질 때의 조기 경보 역할은 [clickhouse/05]({{< relref "../../clickhouse/05-altinity-operations.md" >}})로 위임합니다.

## 우리 케이스에서는

- **가용성 판단은 두 갈래로 나눕니다.** **blast radius**(§1)는 "무엇이 죽으면 무엇이 멈추나"의 지도입니다 — app/api·Collector·MongoDB 다운은 조회·설정에 국한되므로 알럿 대응 우선순위에서 CH 전체 다운·Keeper 정족수 상실보다 급을 낮춰도 됩니다. **무손실 2트랙**(§6)은 "무엇을 지켜야 하나"의 지도입니다 — 텔레메트리는 OTel `file_storage` 큐 + RF 복제로, 메타데이터는 MongoDB ReplicaSet + `mongodump`로 별도로 지킵니다. 이 두 갈래가 실제 배치 위에서 어떻게 맞물리는지는 §4.1의 그림 한 장이 요약합니다.
- **Keeper를 "죽어도 데이터가 안전한 큐"로 착각하지 않는 것이 이 설계의 출발점이다**: Keeper는 CHK 3노드(gp3 영속·3 AZ 분산)로 **쓰기 가용성만** 좌우하고 이벤트 데이터의 내구성은 트랙 1의 큐·복제 층위에서 별도로 만듭니다.
- **토폴로지 기본값**: `shardsCount: 1` × `replicasCount: 2`(RF2, 2 AZ) + CHK 3노드(3 AZ). 0.7TB/월 규모에선 shard가 부채이므로 단일 shard로 시작하고 replica는 AZ 방어·가용성 목적으로 2 AZ에 흩뿌립니다. 데이터 노드는 r7g(메모리 최적화) 노드풀, hot PVC는 prod 노드당 order ~1TB(스테이징은 훨씬 작게).
- **RF2로 시작, RF3는 트리거 기반 승급**: "AZ 1개 소실 중에도 무저하" 또는 "`insert_quorum: 2` 상시"가 요구가 되는 순간에만 RF3. EBS는 노드 급사가 데이터 소실이 아니라 reattach라, 로컬 NVMe만큼 공격적으로 RF3를 강제할 이유가 약합니다.
- **다운타임 룰 3가지를 팀 룰로 못박는다**:
  1. **급사 노드 복구는 out-of-service taint가 정석** — 무개입 시 파드가 무한 Terminating. node-problem-detector 기반 자동 taint를 staging에서 먼저 검증합니다.
  2. **AZ 분산은 타협 불가** — EBS는 AZ-bound라 AZ 장애는 reattach로 못 풉니다. `ClickHouseAntiAffinity(hostname)` + `topologySpreadConstraints(DoNotSchedule, zone)` 병용.
  3. **Karpenter는 데이터 노드에 `do-not-disrupt` + `consolidationPolicy: WhenEmpty`** — voluntary consolidation이 불필요한 detach/reattach를 유발하지 않게. Karpenter ≥ v1.0은 VolumeAttachment 삭제까지 대기하므로 graceful 경로는 안전하나, churn을 줄이는 게 낫습니다 `≈`.
- **경보 우선순위**: Keeper 정족수 감시(3노드 중 1대 손실까지 정상, 2대째부터 쓰기 정지)와 CH replica 헬스가 최우선 경보 대상이고, app/api·Collector·MongoDB 다운은 사용자 영향은 있어도 관측 데이터 자체를 위협하지 않는 2차 경보로 분리합니다.
- **staging에서 반드시 리허설할 것**: (a) 노드 drain → reattach 시간 실측, (b) 노드 강제 종료(ungraceful) → out-of-service taint 복구 리허설, (c) AZ 1개 시뮬레이션 종료 → RF2 서빙 확인, (d) reattach 후 CH readiness(part-load) 소요 실측 → `reconcile.statefulSet.update.timeout` 튜닝. reattach+part-load 실소요와 델타 catch-up 실 fetch량은 아직 `?`이라 이 리허설이 그 공백을 메웁니다.
- **증상별 진입("노드가 죽었다")·우리 형상 파라미터·실행 순서는 이 장이 아니라 [운영 트랙]({{< relref "../../hyperdx-operating/_index.md" >}})의 런북이 소유합니다.** 이 장은 메커니즘·기준값·명령 정본이고 트랙은 "지금 무엇을 먼저 하나"를 소유합니다.
- 시점 기준 2026-08.
