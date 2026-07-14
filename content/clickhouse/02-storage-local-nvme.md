---
title: "스토리지 아키텍처 — 로컬 NVMe(i7i/i8g)"
weight: 2
---

# 스토리지 아키텍처 — 로컬 NVMe(i7i/i8g)

{{< callout type="info" >}}
**한눈에**
- **로컬 NVMe(hot) + S3(cold) 2티어**가 관측성 표준. EBS로는 물리적으로 불가능한 수 GB/s·수십만 IOPS를 스토리지 한계비용 $0에 얻는다.
- **기본 인스턴스는 i8g**(Graviton4) — i7i와 IOPS 동률에 ~9% 저렴. x86 의존 바이너리가 있으면 i7i, 초고밀도는 i7ie/i3en.
- **내구성은 디스크가 아니라 복제로** 산다: 멀티 AZ replica 2~3 + clickhouse-backup(S3) + Keeper(gp3 영속). zero-copy replication은 금지.
- **티어링 ≠ 내구성.** self-host는 shared-nothing이라 UltraWarm식 "S3 단일 사본" 절감이 없다 — 사본 배수(RF)는 그대로 낸다.
- **"크게"의 상한은 디스크 용량이 아니라 재수화 시간**(재수화 위험 창)이 정한다.
{{< /callout >}}

"i7i 같은 로컬 스토리지를 크게 가져가는 구성이 실제 가능한가"에 대한 답은 **가능하고, 일정 조건에서는 EBS보다 명백히 낫다** — 단 "크게"의 상한은 디스크 용량이 아니라 **노드 소실 시 재수화 시간**이 정한다. 로컬 NVMe(instance store)는 network block storage보다 5~10배 빠르지만 `[벤치]` 휘발성이라, ClickHouse에서 내구성은 **디스크가 아니라 복제(replication)로 확보**한다. 즉 로컬 NVMe 전략의 본질은 "빠른 휘발성 디스크 + 멀티 AZ replica + S3 백업"의 3종 세트다. 이 페이지는 스토리지 4전략 비교 → i7i/i8g 상세 → 내구성 설계 → 티어링(OpenSearch UltraWarm과의 구조 대응) → k8s local PV·Karpenter 운영 → 재수화까지를 의사결정 순서로 정리한다. managed vs self-host의 큰 그림과 달러 TCO는 [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}})가 담당한다.

## 스토리지 4전략 — 무엇을 고르나

self-host ClickHouse의 스토리지 매체는 네 갈래다. 로컬 NVMe만 놓고 결정하지 말고 tradeoff 축(성능·비용·내구성·운영 복잡도)을 한 표로 본다.

| 지표 | (a) 로컬 NVMe | (b) EBS gp3 | (b) EBS io2 Block Express | (c) S3 + local cache | (d) tiered(hot NVMe/cold S3) |
|---|---|---|---|---|---|
| 지연(latency) | **µs 단위(최저)** | 100~500 µs | **<500 µs @16KiB** | hot=캐시급 / cold=수십~수백 ms | hot=NVMe / cold=S3 |
| 최대 IOPS | 인스턴스 물리한계(수백만급) | 80,000/vol | **256,000/vol** | 캐시 히트 시 로컬급 | 티어별 |
| 최대 처리량 | 인스턴스 한계(수 GB/s, RAID로↑) | 2,000 MiB/s | **4,000 MB/s/vol** | 캐시+S3 대역 | 티어별 |
| 내구성 | **없음(휘발성)** — 복제로 보완 | 99.8~99.9% | **99.999%** | S3 11 nines | 티어별 |
| GB당 비용 | **인스턴스 가격에 포함($0 별도)** | $0.08/GB-mo + IOPS·throughput 초과분 | gp3보다 크게 비쌈 | S3 최저(~$0.023/GB-mo) | hot 비쌈/cold 저렴 |
| 노드 이동 시 데이터 | **소실** | 재부착 가능(같은 AZ) | 재부착 가능 | S3에 보존 | hot 소실/cold 보존 |
| 운영 복잡도 | **높음**(RAID·재수화·백업 설계) | 낮음(EBS CSI 표준) | 낮음 | 중간(캐시 튜닝) | **가장 높음**(정책·TTL·이동 감시) |
| 적합 워크로드 | 고QPS·저지연·대규모 스캔 | 일반 프로덕션·중규모 | 극한 IOPS DB | 콜드/아카이브·비용 최적 | 관측성(hot 최근/cold 장기) |

*(위 성능·내구성 수치는 AWS 공식 스펙 기준 `[확인됨]`, GB당 비용은 us-east-1 2026-07 시점.)*

핵심 판단:

- **EBS(gp3/io2)는 인스턴스의 EBS 대역폭 한계에 묶인다.** gp3 볼륨을 아무리 붙여도 인스턴스 EBS 파이프(예: i7i는 EBS 최대 60 Gbps, 중형은 1,250 MB/s급)가 병목이라 `[확인됨]` 로컬 NVMe의 수 GB/s를 못 낸다. "스토리지 성능을 강하게"라는 요구는 EBS 경로로는 **월 수천 달러를 써도 물리적으로 도달 불가**하다(정량 근거는 [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}})).
- **S3-backed MergeTree(c)는 self-host에서 진짜 storage-compute 분리가 아니다.** SharedMergeTree는 Cloud 전용이고, self-host의 S3 disk는 part metadata가 로컬에 남아 filesystem_cache가 사실상 필수이며 콜드 쿼리는 느리다. self-host에서 S3는 **primary가 아니라 cold tier로만** 쓴다.
- **관측성 워크로드의 정석은 (d) tiered**: 최근 데이터는 hot(로컬 NVMe), 오래된 데이터는 `TTL ... TO VOLUME 'cold'`로 S3에 내린다. 성능은 hot에서 얻고 비용은 cold에서 아낀다. 스토리지 티어링 프리미티브 자체는 [로깅 챕터의 ClickHouse]({{< relref "../logging/04-clickhouse.md" >}}) 페이지에서도 다룬다.

### 로컬 NVMe가 정당화되는 신호

로컬 NVMe는 운영 부담(RAID·재수화·백업 설계)이 크므로 "빠르니까 무조건"이 아니라 아래 신호가 겹칠 때 고른다. Altinity는 운영 단순성 때문에 32 vCPU 이하 노드에는 gp3 단일 볼륨을 기본 권장할 만큼 보수적이지만 `[벤더]`, PostHog 같은 대규모 사용자는 로컬 NVMe로 이동했다 — 규모·성능 요구가 임계를 넘으면 로컬 NVMe가 정당화된다.

| 신호 | 로컬 NVMe 정당화 |
|---|---|
| **데이터 규모** | 노드당 수 TB~수십 TB, 클러스터 총 10TB+ 압축 |
| **쿼리 패턴** | 대규모 full/range scan, 고QPS 대시보드, 저지연(<수십ms), 무거운 aggregation |
| **처리량 요구** | EBS 단일/다중 볼륨(~2GB/s대)으로 부족, 수 GB/s 필요 |
| **워크로드 안정성** | 24/7 always-on(로컬 NVMe 노드는 상시 가동 전제) |

반대로 소규모(<5~10TB)·bursty·운영 인력 부족·강한 내구성 단순화 요구면 gp3나 managed가 합리적이다.

> **반론도 있다 `[벤더]`.** Altinity는 ClickHouse가 보통 IOPS가 아닌 throughput-bound라 gp3 1~3개면 충분한 경우가 많다고 보며, 자체 벤치마크에서 EBS 기반 m6i.4xlarge가 로컬 NVMe i3.4xlarge를 캐시드 쿼리 전반에서 앞선 사례를 보고했다(원인은 스토리지가 아니라 **39% 빠른 CPU 클럭** — 데이터가 페이지 캐시에 오르면 디스크 종류보다 CPU 세대가 성능을 좌우한다). KubeCon 2023 발표의 권장 아키텍처도 스토리지/컴퓨트 분리형 EBS gp3였고 로컬 NVMe는 오브젝트 스토리지 캐시 계층으로 뒀다. 다만 이 반론의 실체는 **"구세대 로컬 NVMe(i3) vs 신세대 CPU+EBS(m6i)"** 비교이지 i7i/i8g(신세대 CPU+신세대 NVMe) 자체를 반박하는 것은 아니다 — 워킹셋이 페이지 캐시에 다 올라가는 워크로드에서는 로컬 NVMe 프리미엄이 무의미해진다는 신호로 읽어야 하고, 이 페이지의 로컬 NVMe-primary 권고를 뒤집지는 않는다.

## i7i / i8g — 로컬 NVMe 인스턴스 상세

**i7i (2025-04-28 출시 `[확인됨]`)** 는 x86 스토리지 최적화 인스턴스의 현행 최강이다. **3세대 AWS Nitro SSD**(상시 AES-256 암호화) + **5세대 Intel Xeon**(Emerald Rapids, 전코어 터보 3.2GHz) + DDR5, 최상위 **i7i.48xlarge**는 192 vCPU / 1,536 GiB RAM / 로컬 NVMe 45TB(12×3,750GB) / 네트워크 100Gbps / **EBS 대역폭 60Gbps**, 스토리지밀집형 **i7ie.48xlarge**는 120TB(16×7,500GB)까지 올라간다 `[확인됨]`. AWS는 이전 세대 i4i 대비 **컴퓨트 성능 ~23%↑·실시간 스토리지 성능 ~50%↑·I/O 지연 ~50%↓·지연 변동성 ~60%↓**를 주장하며, 이 % 수치들은 AWS 마케팅 자료 기준으로 절대 IOPS·처리량·가격은 공식 페이지에 없다 `[벤더]`.

로컬 NVMe 성능의 결정적 사실: **3.75TB Nitro SSD 드라이브 1개 = random read 600,000 IOPS / write 330,000 IOPS**(4KB 블록, 큐 깊이 포화) `[확인됨]`. 총 IOPS는 드라이브 수에 **완전 선형**으로 증가한다. 요금도 vCPU당 단가가 사이즈 전체에서 동일해 가격 페널티 없이 필요한 NVMe·RAM으로만 사이즈를 고르면 된다.

| 사이즈 | vCPU | Mem(GiB) | 로컬 NVMe | random read/write IOPS | $/hr(OD) | $/mo(×730) |
|---|---|---|---|---|---|---|
| i7i.large | 2 | 16 | 1×468 GB | 75,000 / 41,250 | $0.1888 | $138 |
| i7i.xlarge | 4 | 32 | 1×937 GB | 150,000 / 82,500 | $0.3775 | $276 |
| i7i.2xlarge | 8 | 64 | 1×1,875 GB | 300,000 / 165,000 | $0.7550 | $551 |
| i7i.4xlarge | 16 | 128 | 1×3,750 GB | **600,000 / 330,000** | $1.5101 | $1,102 |
| i7i.8xlarge | 32 | 256 | 2×3,750 GB | 1,200,000 / 660,000 | $3.0202 | $2,205 |
| i7i.12xlarge | 48 | 384 | 3×3,750 GB | 1,800,000 / 990,000 | $4.5302 | $3,307 |
| i7i.16xlarge | 64 | 512 | 4×3,750 GB | 2,400,000 / 1,320,000 | $6.0403 | $4,409 |
| i7i.24xlarge | 96 | 768 | 6×3,750 GB | 3,600,000 / 1,980,000 | $9.0605 | $6,614 |
| i7i.48xlarge | 192 | 1,536 | 12×3,750 GB (45TB) | 7,200,000 / 3,960,000 | $18.121 | $13,228 |

*(사양·IOPS `[확인됨]`, us-east-1 on-demand 요금 `[확인됨]`, 2026-07 시점. metal-24xl/48xl은 각각 24xl/48xl과 동일 스펙.)*

순차(sequential) 대역은 random 4K보다 높다 — PostHog는 4×7.5TB NVMe RAID10에서 **쓰기 ~1,000 MB/s + 읽기 ~4,000 MB/s 동시 달성**을 실측했고 "어떤 EBS 조합으로도 불가능"이라 평했다 `[확인됨]`. 즉 i7i.4xlarge 단일 노드만으로도 random 4K ~2.46 GB/s `[추정]`, 대형 노드는 수십 GB/s 대역이 나온다.

**i8g 우선 권고.** i8g는 **Graviton4 + 동일한 3세대 Nitro SSD**라 **드라이브당 IOPS가 i7i와 완전히 동일**(3.75TB당 600,000/330,000)하면서 **동일 사이즈 기준 ~9% 저렴**하다 `[확인됨]`(i8g.8xlarge $2.7456 vs i7i.8xlarge $3.0202). ClickHouse는 ARM64 바이너리를 제공하고 "클럭보다 코어 수"를 선호해 Graviton 궁합이 좋다. 성능/달러가 명백히 i8g 우위이므로 **기본은 i8g**로 간다.

| 인스턴스 | 아키텍처 | 드라이브 | 드라이브당 read/write IOPS | 언제 |
|---|---|---|---|---|
| **i8g** | Graviton4(ARM64) | 3.75 TB | **600,000 / 330,000** | **기본 후보** — IOPS 동률, ~9% 저렴 |
| **i7i** | Intel x86 | 3.75 TB | 600,000 / 330,000 | x86 의존(사이드카·에이전트 바이너리) 있을 때 |
| **i7ie / i3en** | Intel x86 | 7.5 TB / 대용량 | TB당 IOPS는 i7i/i8g보다 낮음 | 초고밀도(45~60TB+/노드)가 목적일 때만 |

주의: i7ie는 7.5TB 드라이브라 용량 밀도는 높지만 **TB당 IOPS 밀도는 i7i/i8g보다 낮다** `[확인됨]`. 초고밀도 저장이 목적일 때만 i7ie/i3en을 쓰고, **IOPS 성능 극대화가 목적이면 i7i/i8g**가 맞다. i8g는 최대 22.5TB/노드로 i7i(45TB)보다 밀도 상한이 낮다는 점도 사이즈 계획에 반영한다 `[확인됨]`.

## 휘발성을 복제로 덮는다 — 내구성 3종 세트

로컬 NVMe는 인스턴스 stop/terminate/하드웨어 장애 시 **데이터가 영구 소실**된다. 그래서 로컬 NVMe 전략을 채택하는 순간 아래 3종 세트는 **선택이 아니라 전제**다.

1. **멀티 AZ replica 2~3개(shard당).** ReplicatedMergeTree(RMT)에서 각 replica가 데이터 파트 전체 사본을 보유하고 Keeper로 조정한다 — 단일 노드 로컬 디스크 소실을 복제가 방어한다 `[확인됨]`. k8s에서는 pod anti-affinity(hostname) + topologySpreadConstraints(zone)로 replica를 AZ에 분산한다. "멀티 AZ 복제는 모든 설치의 기본"이다. 복제본 수(RF)가 곧 견디는 동시 유실 대수를 정하며(RF2=shard당 1대·RF3=2대), "임의 2대 유실에도 무손실"을 원하면 RF3다 — 임의 2대 유실 확률·비용 트레이드오프는 [배포 플레이북 §RF 선택]({{< relref "04-deployment-playbook.md" >}})이 결정 홈이다.
2. **clickhouse-backup → S3(주간 full + 일간 incremental, shard별).** Altinity clickhouse-backup이 사실상 표준이다 `[확인됨]`. (incremental 체인 취약성·S3 lifecycle 함정은 아래 콜아웃)
3. **Keeper 3(최소)/5(HA) 노드, 멀티 AZ, 전용 노드.** 조율 계층이 소실되면 메타데이터 복구가 번거로우므로 **Keeper 데이터만은 gp3(영속) 디스크**에 둔다 `[확인됨]`. Keeper는 소량 데이터라 4GB RAM·gp3로 충분하고, AZ 간 round-trip이 50ms를 넘으면 replication throughput이 악화되니 지연을 확인한다.

{{< callout type="warning" >}}
**incremental 백업 체인은 fragile** — 이전 백업 전체 체인에 의존하므로 하나라도 손상되면 이후 복구 불가다. S3 lifecycle로 base를 Glacier에 넣으면 체인이 붕괴하니 lifecycle 규칙과 정기 restore drill을 직접 소유해야 한다.
{{< /callout >}}

{{< callout type="error" >}}
**zero-copy replication은 프로덕션 금지다.** 22.8+부터 기본 비활성이며, mutation 중 데이터 손실(#39560)·merge 중 손상·TTL 이동 시 NOT_ENOUGH_SPACE·Keeper 부하 증가 등 이슈가 다수 보고됐다 `[확인됨]`. 실사례로 issue #45346은 CH 22.3·4 리플리카·S3 구성에서 소스 파트가 ZooKeeper의 zero-copy 메타데이터엔 있으나 4개 리플리카 어디에도 물리적으로 없어 머지가 무한 정지된 사고를 보고했다 — ClickHouse 메인테이너 Milovidov가 'experimental feature'로 not-planned 종결했고, 그 라벨의 의미는 "프로덕션에 쓰면 안 되는 기능의 버그"라는 것이다(원 스택트레이스가 로그 로테이션으로 소실돼 정확한 root cause는 미확정 `[추정]` — 완전 진단이 아니라 보고된 인시던트로 취급). 공식 문서도 "zero-copy replication is not ready for production"이라 명시한다. S3 tier를 쓰더라도 이 기능에 의존하지 말고, **각 replica가 자기 경로에 독립 저장하는 표준 RMT 복제**를 유지한다. (self-host가 SharedMergeTree를 못 쓴다는 제약과 그 배경은 [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}}) 참고.)
{{< /callout >}}

## 티어링 설계 — OpenSearch와 같은 구조인가

자연스러운 질문 하나: **"로컬 NVMe를 써도 실데이터는 gp3나 S3로 티어링해야 맞지 않나 — 지금 [OpenSearch]({{< relref "../logging/01-opensearch.md" >}})를 hot 10× i7i.4xlarge + UltraWarm 8노드로 굴리는 것과 같은 구조 아니냐"**. 답은 **절반은 맞고 절반은 위험한 오해**다 `[확인됨]`. "hot NVMe에 최근 데이터만 짧게, 오래된 데이터는 S3로 티어링"이라는 골격은 정확히 ClickHouse 관측성 표준이다(공식 플레이북이 *"recent 'hot' data on NVMe … moves data older than 7 days to object storage"*, TTL 예시 `INTERVAL 7 DAY TO VOLUME 'cold'`). 그러나 (a) gp3 중간(warm) 티어는 대체로 불필요하고, (b) UltraWarm과 self-host CH의 S3 티어는 **사본 경제가 정반대**이며, (c) "티어링하면 내구성이 해결된다"는 UltraWarm식 사고를 self-host에 그대로 옮기면 데이터를 잃는다.

### 구조 대응표

겉보기 유사하나 사본 경제·쿼리 경로가 결정적으로 다르다.

| OpenSearch(현행 도메인) | ClickHouse self-host 대응 | 유사점 | 결정적 차이 |
|---|---|---|---|
| **Hot 데이터노드** 10× i7i.4xlarge.search(로컬 색인 + replica) | **hot 볼륨** = 로컬 NVMe(RMT replica) | 둘 다 로컬 매체 + replica로 내구성 | 거의 동일 — 직관이 옳다 |
| **UltraWarm** 8노드(S3-backed + 캐시 레이어) | **S3 cold 볼륨**(`TTL MOVE TO VOLUME 'cold'` + filesystem cache) | 둘 다 오래된 데이터를 S3+로컬캐시로 | **사본 경제 반대**: UltraWarm=S3 단일 사본 / CH cold=replica별 사본 |
| **OR1/OR2**(EBS primary + 동기 S3, 11 nines·zero RPO — 로컬 NVMe 아님, NVMe 관리형은 OI2) `[확인됨]` | **ClickHouse Cloud SharedMergeTree**(self-host 불가) | shared durable S3 + 컴퓨트 로컬 캐시 | self-host RMT로는 재현 불가 |

핵심: **UltraWarm의 진짜 구조적 사촌은 self-host CH의 S3 cold가 아니라, S3 단일 사본 + 컴퓨트 캐시를 쓰는 ClickHouse Cloud SharedMergeTree / OpenSearch OR1**이다 — 둘 다 Cloud·관리형 전용이라 self-host로는 못 쓴다 `[확인됨]`. (SharedMergeTree가 Cloud 전용인 배경은 [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}}).)

### 결정적 차이 — S3 사본 경제

- **UltraWarm**은 warm 데이터를 S3에 **1벌**만 두고 warm 전용 노드가 그 공유 단일 사본을 캐시로 서빙하며 **replica가 필요 없다**(*"The durability of data in S3 removes the need for replicas … only one copy is needed"*) `[확인됨]` — shared-storage 모델.
- **CH self-host의 S3 cold**는 cold 데이터도 **replica마다 자기 S3 경로에 사본**을 둔다(shared-nothing). RF2면 S3에도 2벌이고, zero-copy로 1벌로 줄이는 건 프로덕션 금지(위 §내구성 3종 세트)라 **UltraWarm식 절감이 성립하지 않는다** `[확인됨]`.
- 따라서 "UltraWarm처럼 S3로 밀면 사본이 줄어 싸진다"는 기대는 **틀린다**. self-host의 절감은 **NVMe↔S3 GB단가 차이**에서만 오고 **사본 배수(RF)는 그대로** 지불한다.

사본 경제 외에 두 지점이 더 다르다 `[확인됨]`. **쿼리 경로**: UltraWarm은 hot과 warm이 **물리적으로 다른 노드**라 warm 쿼리가 hot 노드를 굶기지 않는(리소스 격리) 반면, CH self-host의 hot(NVMe)·cold(S3) 볼륨은 **같은 서버**에 붙어 한 쿼리가 두 티어를 투명하게 가로질러 읽어 컴퓨트 격리가 없다. **rehydrate**: UltraWarm은 다시 쓰려면 `_hot` API로 명시적 승격(shard relocation)이 필요하지만, CH의 S3 cold는 rehydrate 개념 없이 **항상 online**이라 쿼리가 닿으면 캐시 미스 시 S3에서 읽어 로컬 캐시에 자동 적재된다(노드 소실 후 replica 복구=재수화는 별개 개념, 아래 §노드 소실과 재수화).

### 티어링 ≠ 내구성

가장 위험한 오해가 여기 있다. self-host RMT에서 셋은 목적이 다르며 혼동하면 데이터를 잃는다 `[확인됨]`:

| 수단 | 목적 |
|---|---|
| **복제**(RMT replica, 멀티AZ) | 가용성 + 내구성(노드/AZ 소실 방어) |
| **백업**(clickhouse-backup → S3 별도 버킷) | DR(실수 삭제·손상·논리 오류 복구) |
| **티어링**(TTL MOVE → S3 cold) | 비용·보존 확장(GB단가↓) |

- 티어링은 DR이 아니다. S3 cold로 옮긴 데이터도 **살아있는 테이블의 일부**라 `DROP`·잘못된 `ALTER`·논리 손상은 hot이든 cold든 똑같이 파괴한다 — 별도 백업만이 복구한다.
- 그래서 cold 데이터의 물리 사본은 **replica 수(RF) + 백업(1)** 로 계상해야 공정하다. "S3니까 싸다"는 맞지만 "1벌이라 싸다"는 아니다 — UltraWarm 단일 사본 경제와 헷갈리지 말 것.

### gp3의 자리 · 권고 설계

- **gp3는 티어링 매체가 아니라 Keeper 데이터 디스크다**(영속 필요, 위 §내구성 3종 세트). 관측성 표준과 ClickHouse 공식 플레이북 모두 **hot NVMe + S3 cold 2티어**를 권하고 gp3 warm 중간 티어를 언급조차 않는다 — Altinity도 *"no reason to have more than 1-3 gp3 volume per node"*라며 볼륨 단순화를 권한다 `[확인됨]`. NVMe+gp3+S3 3티어를 동시에 굴릴 실익은 대개 없다(PostHog만 예외적으로 S3 없이 NVMe hot→EBS warm 2티어를 수동 운영 `[확인됨]`).
- 권고 티어링 설계(내구성 3종 세트와 **별개로** 얹는다):

```
storage_policy 'hot_to_s3'
  volume 'hot'  = 로컬 NVMe(i7i/i8g)                  ← 최근 데이터
  volume 'cold' = S3 disk + cache disk(로컬 LRU 캐시)  ← 오래된 데이터

TTL (관측성 예)
  timestamp + INTERVAL 7   DAY TO VOLUME 'cold'   -- 7일 후 S3로 이동
  timestamp + INTERVAL 365 DAY DELETE             -- 365일 후 삭제

hot 볼륨 : move_factor 0.9 (안전판) — 주 이동은 위 시간기반 TTL
S3 cold  : prefer_not_to_merge 미설정 — 병합은 hot에서 끝내고 이동
캐시     : cache_on_write 활성 (없으면 cold 쿼리가 S3 지연에 직접 노출)
```

- **주 이동은 시간 기반 TTL MOVE**로 하고, `move_factor`는 hot이 가득 차 머지·인서트가 멈추는 것을 막는 안전판으로만 쓴다(어떤 파트가 먼저 갈지 보장 못 하고 갓 인서트한 데이터가 곧장 S3로 갈 수도 있다) `[확인됨]`. `prefer_not_to_merge=true`는 작은 파트 폭증 → TOO_MANY_PARTS를 부르니 기본값(false)을 유지한다 `[확인됨]`.

사용자 명제를 조각별로 판정하면:

| 명제 조각 | 판정 |
|---|---|
| "로컬 NVMe라도 실데이터를 전부 로컬에 두면 안 된다" | ✅ 맞다 — hot엔 최근 데이터만, 나머지는 티어링 |
| "gp3 **혹은** S3에 티어링" | △ 절반 — 관측성/대규모는 S3, gp3는 Keeper용. 3티어는 불필요 |
| "OpenSearch(hot i7i + UltraWarm)와 동일 구조" | ❌ 부정확 — UltraWarm=단일 사본 shared-storage, CH cold=replica별 shared-nothing |
| (암묵) "S3로 티어링하면 내구성이 해결된다" | ❌ 위험 — 내구성은 복제+백업. cold도 RF배수로 중복 저장 |

## 로컬 PV를 k8s에 얹기

**instanceStorePolicy: RAID0 — ephemeral-storage 스케줄링 인식용.** Karpenter EC2NodeClass에 `instanceStorePolicy: RAID0`를 설정하면 노드의 로컬 NVMe들이 자동으로 RAID0(`/dev/md/0`, 마운트 `/mnt/k8s-disks/0`)로 묶여 kubelet의 **ephemeral-storage**로 인식된다 — 이 설정이 없으면 Karpenter가 instance-store를 스케줄링 시 고려하지 않는다 `[확인됨]`. 다만 이렇게 묶인 배열은 ephemeral일 뿐이라 **ClickHouse 데이터 PV에는 별도 provisioner가 필요**하고, 전용 데이터 노드라면 instanceStorePolicy를 아예 쓰지 않는 편이 낫다(아래 § 참조). Bottlerocket은 Karpenter v1.1.0+부터 자동 구성된다.

마운트된 NVMe 위에 local PV provisioner를 얹는다. 공통적으로 로컬 스토리지는 **데이터 경로 오버헤드가 없어(컨테이너 없이 직접 쓰는 것과 동일 throughput)** 성능은 좋지만, **노드 장애 = 해당 볼륨/데이터 소실**이라는 성질은 도구가 바꿔주지 않는다 — 내구성은 위 3종 세트가 담당한다.

| 도구 | 방식 | 스냅샷/LVM | 특징 |
|---|---|---|---|
| **Rancher local-path-provisioner** | hostPath 디렉토리 | 없음 | 가장 단순. 마운트된 NVMe(단일 또는 RAID0) 위에 바로 |
| **OpenEBS Hostpath LocalPV** | `/var/openebs/local` 하위 | 없음 | 설치 즉시 OOB, 오버헤드 없음 |
| **OpenEBS LVM LocalPV** | 노드 LVM VG에서 LV | **LVM 스냅샷/thin** | 여러 NVMe를 VG로 묶고 PV 동적 할당·온라인 확장 |
| **TopoLVM** | LVM + 용량 인식 스케줄링 | LVM | 용량 aware 스케줄링이 필요할 때 |

권고 `[추정]`: 전용 데이터 노드에는 **설계 (A)**(아래 §) — instanceStorePolicy 없이 userData로 NVMe를 포맷·마운트한 뒤 **local-static-provisioner**(AWS 공식 DB PV 레시피)로 노출 — 가 깔끔하다. 더 단순하게는 **local-path-provisioner**(마운트 위에 바로), **용량 인식 스케줄링·LVM 유연성**이 필요하면 **TopoLVM 또는 OpenEBS LVM LocalPV**. Altinity operator는 local StorageClass + node affinity를 지원하지만 노드 소실 재수화는 operator가 해결하지 않으므로 replica·백업 설계는 여전히 사용자 몫이다(operator 상세는 [clickhouse-operator]({{< relref "03-operator.md" >}})).

### instanceStorePolicy는 ephemeral — ClickHouse 데이터는 PV가 필요하다

뉘앙스 하나를 못박는다. `instanceStorePolicy: RAID0`이 만드는 것은 **kubelet·containerd의 ephemeral-storage**(emptyDir·컨테이너 레이어·pod 로그)로 bind mount된 배열이지 **PersistentVolume이 아니다** `[확인됨]`. 반면 ClickHouse(Altinity operator)는 `volumeClaimTemplates` → StorageClass → **PV**를 요구한다. 그래서 로컬 NVMe를 ClickHouse **데이터**로 쓰려면 RAID0(또는 단일) 마운트 **위에 local PV provisioner를 얹어야** 한다 — 위 표의 도구들이 그 역할이다. DB 용도의 사실상 표준은 AWS 공식 레시피인 **local-static-provisioner + `WaitForFirstConsumer`**(1 PV = 1 디스크/배열이라 용량·성능 격리가 명확) `[확인됨]`.

설계는 두 축이다 `[추정]`: **(A) NVMe를 PV 전용으로 헌납** — instanceStorePolicy를 쓰지 않고 userData로 포맷·마운트해 discovery 경로로만 노출하고 kubelet ephemeral은 루트 gp3에 둔다(전용 데이터 노드에 깔끔, 권장). **(B) 배열 공유** — instanceStorePolicy로 ephemeral을 NVMe에 얹고 같은 마운트 하위를 PV로도 노출; 물리 디스크는 같아 성능은 나오지만 **용량 이중계상**으로 capacity 관리가 꼬여 전용 노드엔 비권장.

{{% details title="도입 버전·구버전 우회 — Karpenter 버전별 userData 부트스트랩 [확인됨]" closed="true" %}}
`instanceStorePolicy`는 Karpenter **v0.34.0(2024-02-06)** 부터 유효하고 **`EC2NodeClass`(v1beta1)에만 존재**한다 — 구버전 `AWSNodeTemplate`(v1alpha5)에는 필드 자체가 없다. 필드가 없거나 (A)를 택해 안 쓰기로 했다면 **`userData`로 NVMe를 직접 포맷·마운트**한다: AL2는 `/bin/setup-local-disks mount|raid0` 또는 수동 `mkfs.xfs`+`fstab`, AL2023은 nodeadm `NodeConfig`의 `localStorage.strategy: RAID0`(또는 MIME 스크립트), Bottlerocket은 `settings.bootstrap-commands`(단 Karpenter v1.1.0+는 자동 주입하므로 중복 시 부팅 실패). 이 **userData + local PV provisioner 조합은 v1alpha5를 포함한 전 Karpenter 버전에서 동작**한다.
{{% /details %}}

{{< callout type="warning" >}}
**단일 디스크 주의 `[확인됨]`** — i7i/i8g.4xlarge는 NVMe가 정확히 1×3,750GB다. RAID0는 ≥2 디스크 striping에서만 이득이라 단일 디스크엔 `mkfs.xfs` 후 직접 마운트가 단순·안전하고, 신형 AL2023 AMI(≥v20250620)에서 단일 NVMe RAID0가 노드 부팅에 실패하는 회귀(issue #2386)까지 있어 더욱 그렇다. striping용 RAID0는 8xlarge+(2디스크↑)에서만 쓴다 — 4xlarge를 shard/replica로 넓게 펴는 편이 재수화·blast radius 관점에서도 유리하다.
{{< /callout >}}

## Karpenter가 노드를 지우는 문제

로컬 NVMe 노드에서 가장 위험한 것은 하드웨어 장애가 아니라 **Karpenter consolidation**이다. consolidation은 pod request만 보고 팩킹하므로 **데이터 지역성·스토리지 제약을 무시하고 노드를 없앨 수 있다** — 로컬 스토리지 워크로드에 특히 치명적이다 `[확인됨]`. 게다가 `karpenter.sh/do-not-disrupt` 애노테이션은 **voluntary disruption만 방지**하고 **expiration·Spot interruption·수동 삭제는 우회한다** `[확인됨]`.

방어 조합:

- ClickHouse 데이터 pod에 `do-not-disrupt` + `consolidationPolicy: WhenEmpty`(또는 `consolidateAfter`를 10분+로 길게).
- **On-Demand / Savings Plan 사용, Spot 데이터 노드 금지** — Spot 중단 → 노드 종료 → 로컬 NVMe 전소 → replica 재수화 비용이 할인분을 초과한다. (요금·SP 할인은 [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}}))
- 노드 **expiration 비활성 또는 매우 길게**, PDB `maxUnavailable: 1`, disruption budget으로 rate limit.
- taint(`dedicated=clickhouse:NoSchedule`) + toleration으로 전용 NodePool 격리, Keeper는 별도 소형 NodePool(gp3).
- **완전 안정성 우선이면 Karpenter 대신 고정 ASG/노드그룹 + local PV**로 ClickHouse만 별도 운용한다 — 노드 IP·디스크 안정성이 올라간다. Karpenter의 탄력성보다 stateful 안정성이 중요하다면 이쪽이 정답이다.
- **업그레이드는 로컬 NVMe 도입의 전제가 아니다** `[추정]`. `instanceStorePolicy`는 ephemeral 전용이라 ClickHouse PV에는 어차피 안 쓰고(위 §로컬 PV), userData + local PV provisioner는 v1alpha5 포함 전 버전에서 동작한다 — "로컬 디스크 때문에" Karpenter를 서둘러 올릴 이유는 없다. 다만 v1alpha5→v1 마이그레이션은 **v0.32.x를 반드시 경유**(alpha/beta dual, skip 불가)해 공수가 크므로, 지원종료·CVE 대응 업그레이드는 **스토리지 도입과 분리해 별도 유지보수로** 계획한다.

## 노드 소실과 재수화

노드가 소실되면 그 노드의 로컬 NVMe 데이터는 사라지고, ClickHouse는 healthy replica에서 데이터를 다시 당겨온다(rehydration).

- **부분 복구**: replica가 잠깐 빠졌다 복귀하면 lag를 감지해 누락 파트만 fetch하고, 로컬에 남아있던 파트는 재다운로드 없이 re-attach한다 `[확인됨]`. 수동으로는 `SYSTEM RESTART REPLICA` / `SYSTEM SYNC REPLICA`.
- **완전 소실**(로컬 NVMe 전소한 신규 노드): 전체 데이터를 healthy replica에서 재전송한다. 소요 ≈ (노드 데이터량) / (네트워크 대역). 예: 10TB를 25Gbps 링크로 → 이론상 ~1시간, 실전은 압축 해제·머지·디스크 쓰기로 **수 시간** `[추정]`.
- **TB당 정확한 재수화 시간은 공식 수치가 없다** `[미확인]` — 인프라·네트워크·머지 부하에 의존하므로 실환경 측정이 필수다.

이것이 "로컬 스토리지를 얼마나 크게 가져갈 수 있나"의 실질 상한이다. **노드당 데이터를 너무 크게(예: 45TB) 채우면 재수화가 길어지고 그동안 redundancy가 줄어든다.** 45TB 노드 하나를 통째로 재수화하는 동안 남은 replica가 하나뿐이면 그 shard는 위태롭다. 따라서 **노드당 데이터량과 replica 수의 균형**이 설계의 핵심이다 — shard를 늘려 노드당 데이터를 줄이면 재수화가 빨라지고 병렬 복구도 쉬워진다. "45TB i7i.48xlarge 몇 대"보다 "적당 용량 노드를 shard로 넓게 편" 구성이 재수화 관점에서 안전하다.

{{< callout type="important" >}}
**재수화 위험 창(rehydration risk window)** `[추정]` — 이 페이지가 정본으로 삼는 명명된 설계 변수다. `위험 창 ≈ 노드당 데이터량 / 재복제 실효 대역`. 노드 소실부터 살아있는 replica에서 파트를 다 받아 redundancy가 원복될 때까지의 시간으로, 이 창 안에 **같은 shard의 다른 replica가 죽으면 데이터를 잃는다**(그 shard가 창 동안 실질 RF1로 떨어져 있기 때문).

줄이는 두 레버: (1) **창을 짧게** — shard를 잘게 쪼개 노드당 데이터를 줄이면 재복제가 빨라진다, (2) **창 동안 여유** — RF3면 창 중에도 2사본이 남아 2차 장애를 견딘다. PDB는 자발적 중단만, anti-affinity는 같은 shard의 공간 co-location만 막을 뿐, 이 창의 시간차 독립 2차 하드웨어 장애는 둘 다 못 막는다는 점이 핵심이다. RF2 vs RF3의 확률·비용 결정은 [배포 플레이북 §RF 선택]({{< relref "04-deployment-playbook.md" >}})이, insert_quorum이 창 동안 쓰기에 미치는 영향은 같은 페이지 §쓰기 내구성 노브가 다룬다.
{{< /callout >}}

## 참조 아키텍처

스토리지 관점의 참조 배치(조사 §4.3에서 발췌):

```
AWS EKS
├─ NodePool: clickhouse-data (Karpenter, do-not-disrupt, On-Demand/1yr SP)
│   ├─ i8g.4xl~8xl (또는 i7i) — userData로 NVMe 포맷·마운트 (instanceStorePolicy 미설정)
│   ├─ taint dedicated=clickhouse:NoSchedule
│   ├─ local-static-provisioner(또는 TopoLVM) → local PV
│   └─ ClickHouse (Altinity operator, ReplicatedMergeTree)
│       ├─ shard N × replica 2~3 (AZ 분산, anti-affinity + topologySpread)
│       └─ storage_policy: hot=로컬 NVMe → cold=S3 (TTL MOVE)
├─ NodePool: clickhouse-keeper
│   └─ 소형 노드 × 3 (멀티 AZ), Keeper 데이터 = gp3(영속)
└─ 백업: clickhouse-backup → S3 (주간 full + 일간 incremental, shard별)
```

관측성의 대량 ingest가 분석 쿼리 지연을 오염시키지 않도록, 쿼리 패턴·보존정책이 다르면 **관측성용과 범용 분석용을 별도 클러스터(또는 shard/DB)로 분리**한다.

## 우리 케이스에서는

**전제 차이부터 분명히 한다.** 로깅 챕터([우리 케이스 · 권장안]({{< relref "../logging/08-recommendation.md" >}}))는 **로그 내재화 관점**이라 로그 1차 저장은 VictoriaLogs(D1/D2), 메트릭은 VM, ClickHouse 통합(D4)은 "여러 신호를 한 팀에 수렴시킬 명분이 섰을 때 earn it last"로 미룬다 — 신호 하나만 내재화하면 인건비가 절감을 상쇄하기 때문이다. 반면 이 조사는 **RUM 대체 + 범용 분석 + 이미 인력을 보유했다는 전제**에서 출발한다. 이 페이지의 로컬 NVMe 스토리지 청사진은 **그 D4가 실제로 발동됐을 때(RUM 웹 코어 + 범용 분석이 같은 CH·같은 팀에 얹히는 상황)의 저장소 설계도**이지, 로그를 VictoriaLogs에서 CH로 옮기라는 말이 아니다. 두 결론은 층위가 달라 모순되지 않는다 — 로그 1차 = VictoriaLogs, 모바일 RUM = Datadog 잔류는 그대로 유지된다.

그 전제 위에서, 이 조사의 권고를 스토리지 주제로 좁히면:

- **인스턴스: i8g 우선.** i7i와 IOPS가 동률이고 ~9% 저렴하며 ClickHouse ARM64 궁합이 좋다. x86 의존 바이너리가 있으면 i7i, 초고밀도가 목적이면 i7ie/i3en.
- **성능은 살 수 있다.** 원하는 수 GB/s·수십만 IOPS는 EBS로는 물리적으로 불가능하지만 로컬 NVMe로는 스토리지 한계비용 $0에 얻는다 — "로컬 스토리지를 크게"라는 요구의 물리적 해답은 로컬 NVMe self-host뿐이다.
- **내구성은 3종 세트로 산다.** 멀티 AZ replica 2~3 + clickhouse-backup(S3, 주간full·일간incr) + Keeper(gp3 영속). zero-copy replication은 금지.
- **티어링은 얹되 OpenSearch 경제를 기대하지 않는다.** hot NVMe(짧은 TTL) + S3 cold 2티어 + filesystem cache가 표준이고 gp3는 Keeper용이다. self-host는 shared-nothing이라 UltraWarm식 "S3 단일 사본" 절감이 없어 사본 배수(RF)를 그대로 내며, 티어링은 비용·보존 수단이지 내구성 대체가 아니다(우리 도메인 hot 10 + UltraWarm 8과의 구조 대응은 위 §티어링 설계).
- **"크게"의 상한은 재수화가 정한다.** 노드당 데이터량과 replica 수의 균형, shard 확장으로 재수화 시간을 관리하고, TB당 재수화 시간은 스테이징에서 반드시 실측한다 `[미확인]`.
- **Karpenter는 길들여서 쓰거나 고정 ASG로 대체한다.** do-not-disrupt(voluntary만 방지임을 인지) + On-Demand/SP + Spot 데이터 노드 금지 + PDB. 안정성이 최우선이면 고정 ASG.

이 스토리지 결정이 managed와 어떻게 갈리는지, 달러 TCO 크로스오버는 [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}}), operator 운영은 [clickhouse-operator]({{< relref "03-operator.md" >}})에서 이어진다.
