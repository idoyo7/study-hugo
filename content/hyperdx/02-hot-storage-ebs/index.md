---
title: "hot 스토리지 — EBS gp3 / io2 실전 (로컬 NVMe는 옵셔널)"
date: 2026-08-01
weight: 2
---

# hot 스토리지 — EBS gp3 / io2 실전 (로컬 NVMe는 옵셔널)

{{< callout type="info" >}}
- hot 데이터의 정답은 **노드당 단일 gp3 볼륨 + 인스턴스 baseline에 맞춘 소량 provisioned throughput**입니다. 0.7TB/월 RUM 스케일에서 gp3를 80,000 IOPS/2,000 MiB/s까지 올릴 이유도, 여러 개 스트라이핑할 이유도 없습니다.
- ClickHouse는 대형 순차 머지가 지배적인 **throughput-bound** 워크로드이고 **인스턴스 EBS 파이프(mid-size는 baseline 수백 MB/s)가 볼륨보다 먼저 병목**입니다 — 볼륨을 더 붙여도 인스턴스 파이프 이상은 못 냅니다.
- io2 / io2 Block Express(256,000 IOPS·4,000 MiB/s·99.999%·<500µs)는 이 스케일엔 과잉입니다. 극한 IOPS·sub-ms·볼륨 단위 초고내구성이 걸릴 때만 각주.
- EBS-first의 값어치는 성능보다 운영 단순성·내구성입니다 — **재부팅·재스케줄 시 재수화 불필요**(볼륨 detach/attach). 로컬 NVMe와 근본적으로 다른 다운타임 프로파일은 {{< relref "04-operator-topology-downtime.md" >}}에서 이어받습니다.
- operator 연동은 **gp3 StorageClass(EBS CSI) + volumeClaimTemplate `reclaimPolicy: Retain` + `allowVolumeExpansion`(온라인 확장)** 세 축입니다.
{{< /callout >}}

이 카테고리는 **EBS(gp3/io2) 1차** 전제입니다. 로컬 NVMe(i7i/i8g) 1차 전제와 스토리지 4전략·티어링≠내구성·**재수화 위험 창의 정의와 MTTR 산식**은 {{< relref "../../clickhouse/02-storage-local-nvme.md" >}}가 기준 문서라 여기서 반복하지 않습니다. 이 페이지는 **왜 우리 스케일에선 EBS가 1차인지**와 **gp3/io2를 operator에 어떻게 붙이는지**만 실전 관점으로 깊게 팝니다. cold 티어링(S3)은 {{< relref "03-s3-cold-tiering.md" >}}, hot 창별 캐파 산정은 {{< relref "07-capacity-planning.md" >}}가 전담합니다.

**이 페이지가 단일 출처로 소유하는 것** — 다른 장은 결론만 인용하고 아래 네 축을 재서술하지 않습니다:

- **gp3 2025-09 상향 스펙**과 상향 이전 값과의 구분(80,000 IOPS / 2,000 MiB/s / 64 TiB) — §1.1·§1.2.
- **인스턴스 EBS 파이프 천장** — 인스턴스별 baseline·burst 수치와 "볼륨을 더 붙여도 파이프 이상은 못 낸다"는 판정 — §1.4·§3.1.
- **이벤트별 재수화 필요 여부**(재부팅·재스케줄·인스턴스 교체·AZ 장애·볼륨 장애를 로컬 NVMe와 대조)와 **EBS의 AZ 종속 경계** — §5.1.
- **GB 단가 rate(서울)**와 블록↔오브젝트 배수 — §1.3. 절대 금액·워크드 모델은 {{< relref "07-capacity-planning.md" >}}가 이 rate를 인용해 계산합니다.

## 1. gp3 상세 — 2025-09 상향으로 스트라이핑이 필요 없어졌다

### 1.1 현행 스펙 (2026-07, AWS EBS User Guide) `✓`

gp3는 EBS SSD 중 최저가이며 **성능을 용량과 독립적으로** 프로비저닝합니다. 로그·트레이스처럼 "용량은 큰데 성능 요구는 순차 throughput 위주"인 워크로드에 이 성질이 그대로 들어맞습니다.

| 항목 | 값 | 비고 |
|---|---|---|
| **baseline IOPS** | **3,000** (무료, 스토리지 가격에 포함) | 버스트 아님 — 무기한 지속 |
| **baseline throughput** | **125 MiB/s** (무료) | 버스트 아님 |
| **최대 IOPS/볼륨** | **80,000** (Nitro 전제) | 500 IOPS/GiB 비율 → 160 GiB 이상에서 도달. 비-Nitro는 §1.2 |
| **최대 throughput/볼륨** | **2,000 MiB/s** (≈2,097 MB/s) | 0.25 MiB/s/IOPS → 8,000 IOPS & 16 GiB 이상에서 도달 |
| **볼륨 크기** | **1 GiB ~ 64 TiB** | |
| **볼륨 내구성** | **99.8~99.9%** (AFR ≤0.2%) | 볼륨 단위 — 데이터 내구성(복제+백업)과 별개(§5.2) |
| **지연** | single-digit ms | sub-ms가 필요하면 io2 BE |
| **버스트 여부** | **없음** — provisioned 성능을 무기한 지속 | gp2와 결정적 차이 |

- 비율 제약: **IOPS ≤ 500 × 볼륨GiB**, **throughput(MiB/s) ≤ 0.25 × provisioned IOPS**. 2,000 MiB/s를 쓰려면 IOPS를 8,000 이상, 80,000 IOPS를 쓰려면 볼륨을 160 GiB 이상 프로비저닝해야 합니다 `✓`.
- gp2 대비 **GiB당 20% 저렴**하고 성능이 크기와 분리돼 예측 가능 `✓`.
- **최대치를 읽는 I/O 크기 주의**: gp3의 최대 IOPS(80,000)와 최대 throughput(2,000 MiB/s)을 **동시에** 달성하는 지점의 I/O 크기는 `2,000 MiB/s ÷ 80,000 = 25.6 KiB`입니다 — AWS가 gp3 Max IOPS를 명시할 때 기준으로 삼는 I/O 크기가 25.6 KiB입니다 `✓`. ClickHouse 머지의 순차 read/write는 이보다 훨씬 큰 블록입니다. 실전에서 우리를 먼저 제약하는 축은 throughput입니다. IOPS가 아닙니다(§3).

### 1.2 통념 정정 — "gp3 최대 16,000 IOPS / 1,000 MiB/s / 16 TiB"는 상향 이전 값 `✓`

{{< callout type="warning" >}}
**정정**: 흔히 인용되는 "gp3 볼륨당 최대 16,000 IOPS · 1,000 MiB/s · 16 TiB"는 **2020-12 출시 시점 스펙**입니다. AWS는 **2025-09-26** 리전 gp3의 상한을 **80,000 IOPS(5배) / 2,000 MiB/s(2배) / 64 TiB(4배)** 로 올렸습니다. 이 상향은 **전 상용 리전 + GovCloud**(서울 `ap-northeast-2` 포함)에 적용됩니다 `✓`.

- **80,000 IOPS는 Nitro 인스턴스 전제**입니다. 비-Nitro 인스턴스에 붙인 gp3는 여전히 **최대 64,000 IOPS까지만 프로비저닝**되고 실제 달성 상한은 **32,000 IOPS**로 잘립니다 `✓`. 우리 데이터 노드는 Graviton(전부 Nitro)이라 80,000까지 열리지만 어차피 인스턴스 EBS 파이프에서 먼저 잘립니다(§1.4·§3).
- **AWS Outposts는 예외**로 종전 상한(16 TiB / 16,000 IOPS / 1,000 MiB/s)이 그대로 남아 있습니다 `✓`. "16,000/1,000"을 보면 출시 시점 문서이거나 Outposts를 참조한 것입니다.
{{< /callout >}}

이 상향으로 ClickHouse 운영에서는 **스트라이핑이 대부분 불필요해졌습니다** `≈`:

- 과거엔 2,000 MiB/s 이상을 원하면 gp3 여러 개를 RAID0로 묶어야 했습니다. 이제 단일 gp3가 80,000 IOPS / 2,000 MiB/s / 64 TiB를 커버합니다.
- RAID0는 **볼륨 하나만 죽어도 배열 전체가 죽어** 실효 내구성이 떨어집니다. AWS는 상향의 이점을 "복잡한 다중 볼륨 스트라이핑을 단일 볼륨으로 대체해 개별 볼륨의 99.9% 내구성을 온전히 유지"라고 명시합니다 `Ⓥ`. → **단일 gp3가 스트라이핑보다 단순하고 내구성도 높습니다**(§3.3).
- 요금은 상향 후에도 모든 차원(크기·IOPS·throughput)에서 동일 `✓`.

### 1.3 gp3 요금 3분해 — GB 단가는 서울 실단가가 정본 `✓`

| 차원 | 무료 포함분 | 초과분 요금 (us-east-1, 2026-07) | 초과분 요금 (서울 `ap-northeast-2`, 2026-08) |
|---|---|---|---|
| 스토리지 | — | **$0.08 / GB-월** `✓` | **$0.0912 / GB-월** `✓` |
| provisioned IOPS | 3,000 IOPS | **$0.005 / provisioned IOPS-월** (3,000 초과분) `✓` | 미확인 `?` |
| provisioned throughput | 125 MiB/s | **$0.04 / provisioned MiB/s-월** (125 초과분) `✓` | 미확인 `?` |

- 과금은 초 단위(60초 최소) `✓`. gp3의 provisioned IOPS/throughput 요금은 **단일 구간(tier 없음)** — io2와 달리 계단식이 아닙니다 `✓`.
- **우리 배포 리전은 서울이고 GB 단가의 기준도 서울입니다** `✓` — gp3 **$0.0912/GB-월**, S3 Standard(첫 50TB) **$0.025/GB-월** ⇒ **gp3가 S3의 3.65배**(AWS Price List Bulk API 직접 조회, 2026-08). 이 배수가 hot↔cold 크로스오버 판단({{< relref "03-s3-cold-tiering.md" >}}·{{< relref "08-block-only-tuning.md" >}})의 입력이고 그 두 장은 배수를 재산출하지 않고 이 rate를 인용합니다.
- 서울 스토리지 단가는 us-east-1 $0.08 대비 **약 14% 상향**입니다. 종전에 쓰던 "서울은 us-east-1 대비 대략 10~15% 비싸다" `≈`는 스토리지 차원에서 실단가로 확인됐습니다. **provisioned IOPS·throughput의 서울 단가는 아직 미확인** `?`이므로 그 두 차원은 여전히 어림값(us-east-1 rate + 10~15% `≈`)으로 다루고, 필요하면 Price List Bulk API로 같은 방식으로 확정합니다.
- 달러 워크드 모델·3개월/1년 비용은 {{< relref "07-capacity-planning.md" >}}가 전담하고 여기선 단가 rate만 제공합니다.

### 1.4 언제 baseline로 충분한가 — 인스턴스 EBS 파이프에 묶어 판정 (핵심)

gp3 볼륨 성능을 아무리 올려도 **인스턴스 EBS 대역폭이 먼저 천장**입니다. 판정 기준은 "IOPS를 얼마나 사느냐"가 아니라 "인스턴스가 sustain하는 throughput이 얼마냐"입니다. 데이터 노드는 EBS 기반 Graviton **메모리 최적화 r7g**(ClickHouse의 8GB:1core 궁합)를 기준으로 봅니다 `✓` (AWS EBS-optimized 표):

| 인스턴스 | baseline throughput | **burst 최대 throughput** | baseline / 최대 EBS IOPS |
|---|---|---|---|
| r7g.xlarge (4 vCPU/32 GiB) | **156 MB/s** | 1,250 MB/s | 6,000 / 40,000 |
| r7g.2xlarge (8 vCPU/64 GiB) | **312 MB/s** | 1,250 MB/s | 12,000 / 40,000 |
| r7g.4xlarge (16 vCPU/128 GiB) | **625 MB/s** | 1,250 MB/s | 20,000 / 40,000 |
| r7g.8xlarge (32 vCPU/256 GiB) | **1,250 MB/s** | 2,500 MB/s | 40,000 / 80,000 |

*(r7g는 ≤4xlarge에서 baseline이 크기 비례로 오르고 burst 최대는 10 Gbps/1,250 MB/s로 공통, 8xlarge에서 baseline이 10 Gbps로 점프합니다. baseline은 무기한 지속, burst는 24h 중 일부만. r8g(Graviton4)는 같은 크기에서 대역이 대체로 상향이나 이 카테고리 기준은 r7g입니다.)* `✓`

**판정**(수치는 `✓`, 결론은 `≈`):

- r7g.2xlarge는 **baseline 312 MB/s만 무기한 지속**하고 1,250 MB/s로는 일부만 버스트합니다. gp3 무료 baseline(125 MiB/s ≈ 131 MB/s)이 인스턴스 baseline보다 낮으니 **throughput만 소량 provision해 인스턴스 baseline에 맞추면**(예: 300 MiB/s ⇒ 175 MiB/s 초과분 × $0.04 ≈ 월 $7) 됩니다. **IOPS는 baseline 3,000으로 충분**합니다(인스턴스 EBS IOPS 자체가 12,000이 상한).
- gp3를 80,000 IOPS / 2,000 MiB/s로 올려도 r7g ≤4xlarge에선 **인스턴스가 40,000 IOPS / 1,250 MB/s(버스트)에서 잘라먹어 돈만 버립니다**. 2,000 MiB/s gp3는 r7g.8xlarge(burst 2,500 MB/s)에서야 의미가 생깁니다.
- 우리 스케일의 sweet spot은 **baseline IOPS + 인스턴스 baseline에 맞춘 소량 provisioned throughput**입니다. Altinity의 "7,000 IOPS + 1,000 MiB/s가 safe"는 상한 가이드일 뿐, 0.7TB/월엔 그보다 낮게 시작해 `system.asynchronous_metrics`·EBS 대역 지표로 모니터링하며 올립니다.

{{% details title="io2 / io2 Block Express 상세 — 우리 스케일엔 과잉, 그러나 정확히 알아둔다" closed="true" %}}
### 2.1 현행 스펙 (2026-07) `✓`

기존 io2 볼륨은 io2 Block Express 아키텍처로 통합돼 사실상 "io2 = io2 Block Express"로 봐도 됩니다. io1은 남아있지만 io2 BE 대비 이점이 없습니다.

| 항목 | io2 Block Express | io1 (구형) |
|---|---|---|
| 최대 IOPS/볼륨 | **256,000** | 64,000 |
| 최대 throughput/볼륨 | **4,000 MiB/s** | **1,000 MiB/s** |
| 최대 크기 | 64 TiB | 16 TiB |
| 볼륨 내구성 | **99.999%** (AFR 0.001%) | 99.8~99.9% |
| 지연 | **16 KiB I/O 평균 <500 µs** | single-digit ms |
| 최대 IOPS:GiB | **1,000 IOPS/GiB** | 50 |
| Multi-attach / NVMe reservation | **지원**(동일 AZ 다중 인스턴스 공유·예약) | 제한적 |
| 지원 인스턴스 | **모든 Nitro 기반 EC2** | — |

io1 대비 io2 BE는 throughput이 4배(1,000→4,000 MiB/s), IOPS:GiB가 20배(50→1,000), 내구성이 두 자릿수 나인 더 높습니다. **가끔 인용되는 "io2 max 500 MiB/s"는 Block Express 이전 구 io2 수치이며 현행은 4,000 MiB/s입니다** — 결론(ClickHouse엔 io2 불필요)은 옳지만 근거로 "throughput이 낮아서"를 대면 낡은 근거입니다(진짜 이유는 §2.3) `✓`.

### 2.2 io2 tiered IOPS 요금 (us-east-1) `✓`

| 차원 | 요금 |
|---|---|
| 스토리지 | **$0.125 / GB-월** (gp3의 ~1.56배) |
| IOPS ≤ 32,000 | $0.065 / provisioned IOPS-월 |
| IOPS 32,001 ~ 64,000 | $0.046 / provisioned IOPS-월 |
| IOPS > 64,000 | $0.032 / provisioned IOPS-월 |

- IOPS를 많이 살수록 한계단가가 내려가는 **계단식** — 단일 볼륨에 IOPS를 몰아줄 때 유리하게 설계됐습니다 `✓`.
- io2는 **throughput 요금이 별도로 없습니다**(IOPS에 비례해 throughput이 따라옴). gp3처럼 throughput만 싸게 살 수 없습니다 — throughput-bound인 ClickHouse엔 요금 구조부터 불리합니다 `✓`.

### 2.3 io2가 gp3 대비 정당화되는 조건 — 우리는 해당 없음 `≈`

io2 BE가 gp3를 이기는 축은 셋뿐이고 셋 다 RUM 분석엔 무관합니다:

1. **극한 IOPS**(단일 볼륨 80,000 초과, 최대 256,000) — OLTP·초고QPS 랜덤 액세스. ClickHouse는 throughput-bound라 무관.
2. **볼륨 내구성 99.999%**(gp3의 100배) — ClickHouse 데이터 내구성은 **복제(RF)+백업**이 담당하지 단일 볼륨 내구성이 아닙니다({{< relref "../../clickhouse/02-storage-local-nvme.md" >}} "티어링≠내구성"). RF2+ 위에서 gp3 99.9%와 io2 99.999%의 실차이는 미미합니다.
3. **sub-ms 저지연**(<500 µs) — 지연에 극도로 민감한 트랜잭션 DB. 관측성/RUM 분석 쿼리는 single-digit ms로 충분합니다.

→ **0.7TB/월 RUM에서 io2는 GiB당 1.56배 + 비싼 IOPS를 내면서 얻는 게 없습니다.** io2는 "미래에 초저지연 SLA가 걸린 트랜잭션성 워크로드를 얹을 때"의 옵션으로만 각주 처리하고 hot = gp3로 갑니다.
{{% /details %}}

## 3. ClickHouse I/O 특성 — throughput-bound, 볼륨 개수보다 인스턴스 파이프

- Altinity는 ClickHouse를 *"limited by throughput of volumes"* 로 규정하고 gp3/gp2가 *"the most native choice"* 라고 명시합니다. **IOPS는 일정 수준을 넘으면 성능 차이를 거의 안 만듭니다** `Ⓥ`.
- 이유는 MergeTree의 저장 방식입니다 `≈`. 컬럼을 큰 파트로 순차 저장하고 백그라운드 머지가 대형 순차 read+write입니다. 랜덤 소액 I/O(IOPS 바운드)가 아니라 **대역폭(순차 throughput) 바운드**이며, 압축·페이지 캐시가 랜덤 접근을 더 줄입니다.
- Altinity 볼륨 개수 권고: *"no reason to have more than 1–3 gp3 volume per node."* EBS 대역 <10 Gbps 노드(≤32 vCPU)는 **gp3 단일 볼륨**을 권합니다 `Ⓥ`. 2025-09 상향으로 단일 gp3가 80,000 IOPS/2,000 MiB/s까지 커버하므로 이 권고는 더 강해집니다.

### 3.1 단일 gp3 vs 다중 gp3 스트라이핑 — 우리 판정 `≈`

| | 단일 gp3 | 다중 gp3 RAID0 |
|---|---|---|
| 성능 상한 | 80,000 IOPS / 2,000 MiB/s (**인스턴스 파이프에 재차 제한**) | 볼륨 수배 (단, **인스턴스 EBS 대역이 총합 상한**) |
| 실효 내구성 | **99.9%** | **낮아짐** (볼륨 1개 실패 → 배열 전체 손실) |
| 운영 복잡도 | 낮음(EBS CSI 단일 PVC) | 높음(RAID 구성·복구·확장) |
| 온라인 확장 | `allowVolumeExpansion`로 단순 | RAID 재구성 필요 |
| 우리 스케일 적합 | **✅ 정답** | ❌ 불필요 |

인스턴스 EBS 파이프가 어차피 총 throughput의 천장이라 볼륨을 여러 개 붙여도 인스턴스 대역 이상은 못 냅니다(§1.4). 우리 스케일에선 **단일 gp3**가 성능·내구성·운영 모두에서 우위입니다. 인스턴스 EBS 파이프 천장의 수치와 이 판정은 **이 페이지 §1.4가 정본**이고 같은 천장이 20TB+ 전제에서 로컬 NVMe를 유리하게 만드는 논거는 {{< relref "../../clickhouse/02-storage-local-nvme.md" >}}가 이어받습니다.

## 4. 로컬 NVMe — 옵셔널 업그레이드 경로 (relref)

> 반대 방향의 변형 — **S3 콜드 티어링을 아예 쓰지 않고** EBS 단일 티어로만 운영하기(단일 `default` 정책·TTL DELETE-only·gp3 온라인 확장·merge 풀 튜닝) — 는 [블록 온리 튜닝]({{< relref "08-block-only-tuning.md" >}})이 기준 문서입니다.

로컬 NVMe(i7i/i8g)는 **성능 극대화·대규모(20TB+)·상시 가동** 전제에서 EBS로는 물리적으로 불가능한 수 GB/s·수십만 IOPS를 스토리지 한계비용 $0에 줍니다. 그 대가는 **휘발성 → 재수화 위험 창 + Karpenter 길들이기 + local PV 특수 운영 + Spot 금지**이고 0.7TB/월 RUM에는 과한 복잡도입니다.

로컬 NVMe는 "우리 CH에 범용 대규모 분석이 얹혀 hot 데이터가 수 TB/노드로 커지고 저지연 대규모 스캔이 SLA가 될 때"의 **업그레이드 경로**로만 열어둡니다. 인스턴스 선택(i8g 우선)·내구성 3종 세트·재수화·Karpenter·local PV provisioner 상세는 전부 {{< relref "../../clickhouse/02-storage-local-nvme.md" >}}가 기준 문서입니다 — 이 페이지는 그 문을 가리키기만 합니다.

## 5. 왜 우리 스케일(0.7TB/월 RUM)에선 EBS-first인가

### 5.1 EBS-first의 진짜 이점은 성능이 아니라 **재수화 불필요** (핵심)

로컬 NVMe 전략의 가장 큰 운영 리스크는 **노드 소실 = 데이터 소실 → 재수화 위험 창**입니다({{< relref "../../clickhouse/02-storage-local-nvme.md" >}}). EBS는 볼륨이 노드와 독립적으로 살아남아 이 창을 대부분 없앱니다:

경계를 먼저 정합니다 — **창의 정의와 MTTR 산식은 clickhouse/02가, "어느 이벤트에서 재수화가 필요한가"는 아래 표가 정본**입니다. 챕터 대문의 두 스토리지 전략 콜아웃과 {{< relref "04-operator-topology-downtime.md" >}}·{{< relref "08-block-only-tuning.md" >}}는 결론 한 줄만 인용하고 이 표를 복제하지 않습니다.

| 이벤트 | 로컬 NVMe | EBS gp3 |
|---|---|---|
| **노드 재부팅** | 소실 → healthy replica에서 전량 재수화(수 시간) | **볼륨 그대로 재부팅, 재수화 0** `≈` |
| **pod 재스케줄(같은 AZ)** | 소실 → 재수화 | **EBS detach → 새 노드에 attach, 데이터 보존** `✓` |
| **인스턴스 교체(같은 AZ)** | 소실 → 재수화 | 볼륨 재부착, 재수화 0 `≈` |
| **AZ 장애** | 소실 → 타 AZ replica에서 재수화 | **재수화 필요**(EBS는 AZ 종속, 타 AZ 재부착 불가) — replica가 방어 |
| **볼륨 자체 장애(연 ≤0.2%)** | (해당 없음) | replica에서 재수화 |

- EBS는 재부팅/재스케줄/인스턴스 교체(모두 같은 AZ)에서 재수화가 필요 없어 로컬 NVMe 대비 **재수화 위험 창을 근본적으로 짧게** 만듭니다. 창이 없으면 그 사이 2차 장애로 데이터를 잃을 확률도 없습니다. detach → 재attach 실소요 시간(재스케줄 지연 등)은 배포 후 실측이 필요합니다 `?`.
- **단, EBS는 AZ 종속**입니다. 볼륨은 생성된 AZ 밖으로 attach하지 못하므로 **AZ 전체 장애 시에는 여전히 타 AZ replica에서 재수화**합니다. EBS가 없애는 것은 "노드 레벨 재수화"뿐이고 "AZ 레벨 재수화"는 그대로 남습니다. 그래서 **멀티 AZ RF2+ 복제는 EBS에서도 여전히 필수**입니다. 다운타임 시나리오(rolling restart·reconcile·PDB·노드 재부팅·AZ 장애)의 상세 프로파일은 {{< relref "04-operator-topology-downtime.md" >}}가 이어받습니다.

### 5.2 내구성 계층 정리 `✓`

EBS-first에서도 "볼륨 내구성 ≠ 데이터 내구성"은 그대로입니다:

- **볼륨 단위**: gp3 99.8~99.9%(AFR ≤0.2%), io2 99.999%. 이건 EBS가 볼륨을 안 잃을 확률이지 우리 데이터 안전이 아닙니다.
- **데이터 내구성/가용성**: **멀티 AZ RF2~3 ReplicatedMergeTree**(SharedMergeTree는 Cloud 전용이라 self-host는 RMT 강제) + **clickhouse-backup → S3**. RF 선택 확률·insert_quorum·쓰기 내구성 노브는 {{< relref "../../clickhouse/04-deployment-playbook.md" >}}가 기준 문서입니다.
- **비용 관점**: EBS도 RF배수로 사본을 냅니다(RF2면 hot EBS도 2벌). EBS-first의 논지는 "EBS라 싸다"가 아니라 "재수화가 없어 운영이 싸다"입니다.

### 5.3 hot 매체 4자 비교 (2026-07)

| 지표 | gp3 (단일) | io2 Block Express | 로컬 NVMe (i8g) | S3 (참고: cold 전용) |
|---|---|---|---|---|
| 최대 IOPS/볼륨 | 80,000 `✓` | **256,000** `✓` | 인스턴스 물리한계 | — |
| 최대 throughput/볼륨 | 2,000 MiB/s `✓` | **4,000 MiB/s** `✓` | 수 GB/s(RAID로↑) | S3 대역 |
| 실효 천장 | **인스턴스 EBS 파이프** | 인스턴스 EBS 파이프 | 인스턴스 물리 NVMe | 네트워크 |
| 지연 | single-digit ms | **<500 µs** | µs 단위 | 수십~수백 ms |
| 볼륨 내구성 | 99.8~99.9% | **99.999%** | 없음(휘발성) | 11 nines |
| GB당 요금(us-east-1 · **서울**) | **$0.08 · $0.0912** `✓` | $0.125 · 미확인 `?` | 인스턴스가에 포함 | ~$0.023 · **$0.025** `✓` |
| 노드 재부팅 시 데이터 | **보존(재수화 0)** | 보존 | **소실→재수화** | 보존 |
| AZ 장애 시 | 재수화(AZ 종속) | 재수화 | 재수화 | 보존 |
| 운영 복잡도 | **낮음** | 낮음 | 높음(RAID·재수화·Karpenter) | 중간 |
| 0.7TB/월 RUM 적합 | **✅ 정답** | ❌ 과잉 | ❌ 과한 복잡도 | (cold 티어로만) |

{{< flow src="_flow/5-3-hot-매체-자-비교.json" />}}

**표 각주 — S3 Express One Zone은 이 표의 후보가 아닙니다.** 2026-08 기준 Express One Zone은 **서울(`ap-northeast-2`)에 없습니다** `✓`(지원 8리전: us-east-1 · us-east-2 · us-west-2 · ap-south-1 · ap-northeast-1 · eu-central-1 · eu-west-1 · eu-north-1). ClickHouse는 `storage_class_name=EXPRESS_ONEZONE`을 문법상 허용하지만 디렉터리 버킷 엔드포인트에서 `IncompleteBody` 오류가 보고돼 있습니다(issue #72078, 24.10.2.80) `≈`. "cold를 Express One Zone으로 빨라지게 하면?"이라는 물음은 우리 리전에서 논외이고 리전이 열려도 위 버그가 먼저 닫혀야 합니다.

한 겹 더 — ClickHouse가 Express One Zone 기반 구성으로 발표한 **콜드 쿼리 평균 36% 개선(최대 283%)·캐시 계층 TCO 최대 65% 개선**은 **Cloud SaaS 전용 측정**입니다 `✓`. 그 수치를 만든 Distributed Cache 자체가 Cloud 부품이라 self-host로 그대로 오지 않고({{< relref "../../clickhouse/01-managed-vs-selfhosted.md" >}}), 설령 OSS로 풀려도 서울에 Express One Zone이 없어 같은 수치가 재현되지 않습니다. **이 두 문단이 레포에서 Express One Zone·Cloud 캐시 수치의 단독 소유 지점**이므로 다른 장은 여기로 위임합니다.

## 6. Altinity operator 연동 — gp3 StorageClass + volumeClaimTemplate

### 6.1 gp3 StorageClass (EBS CSI 드라이버) `✓`

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: clickhouse-gp3
provisioner: ebs.csi.aws.com            # AWS EBS CSI 드라이버 (별도 설치 필요)
parameters:
  type: gp3
  iops: "3000"                          # baseline (무료). 필요 시 상향
  throughput: "300"                     # MiB/s. 인스턴스 baseline에 맞춰 조정 (§1.4)
  fsType: ext4                          # 또는 xfs
  encrypted: "true"                     # KMS 저장 암호화 권장
allowVolumeExpansion: true              # ★ 온라인 확장 활성화 (필수)
volumeBindingMode: WaitForFirstConsumer # pod 스케줄 후 바인딩 → AZ 정합성 확보
reclaimPolicy: Retain                   # StorageClass 레벨 (아래 operator 레벨과 이중 방어)
```

- `iops`/`throughput`은 StorageClass에 박거나 생략하고 나중에 EBS Elastic Volumes로 조정할 수 있습니다 `✓`.
- `volumeBindingMode: WaitForFirstConsumer`는 **pod가 스케줄된 AZ에 볼륨을 만들도록** 지연 바인딩합니다 — 멀티 AZ에서 volume/pod AZ 불일치를 막는 필수 설정입니다(EBS는 AZ 종속, §5.1) `✓`.
- `encrypted: "true"` + KMS 키로 저장 암호화 `✓`.

### 6.2 ClickHouseInstallation volumeClaimTemplate + reclaimPolicy: Retain `✓`

operator의 volumeClaimTemplate에는 StorageClass의 reclaimPolicy와 별개로 **operator 레벨 `reclaimPolicy` 필드**가 따로 있습니다. `Retain`이면 **CHI/클러스터를 지워도 PVC가 살아납니다** — EBS-first에서 실수로 데이터 볼륨이 증발하는 것을 막는 안전장치입니다.

```yaml
apiVersion: "clickhouse.altinity.com/v1"
kind: "ClickHouseInstallation"
metadata:
  name: rum-hyperdx
  namespace: clickhouse
spec:
  configuration:
    clusters:
      - name: rum
        layout:
          shardsCount: 1
          replicasCount: 2            # 멀티 AZ RF2 (기본); RF3 결정은 04·06
  templates:
    podTemplates:
      - name: ch-pod
        podDistribution:
          - type: ClickHouseAntiAffinity           # replica를 다른 노드로
          - type: ReplicaAntiAffinity
            topologyKey: topology.kubernetes.io/zone   # 다른 AZ로 (AZ 장애 방어)
        spec:
          containers:
            - name: clickhouse
              image: "clickhouse/clickhouse-server:24.8"   # ClickStack 24.8+ 요구
    volumeClaimTemplates:
      - name: data-volume
        reclaimPolicy: Retain          # ★ operator 레벨 — CHI 삭제 시에도 PVC 보존
        spec:
          storageClassName: clickhouse-gp3
          accessModes:
            - ReadWriteOnce
          resources:
            requests:
              storage: 1000Gi         # prod 노드당 hot 창 산정치 — 06 워크드 모델 정합
                                       # 스테이징은 소규모(예: 100Gi)로 시작
    # 위 volumeClaimTemplate을 pod의 /var/lib/clickhouse에 마운트
```

- `reclaimPolicy: Retain`은 **`spec:`과 같은 레벨**에 둬야 합니다. 위치가 틀리면 operator가 무시합니다 `✓`. operator는 PVC에 커스텀 라벨을 붙여 Retain을 구현하므로 **라벨을 지우면 보호가 풀립니다**. 완전 삭제는 CHI 삭제 후 `kubectl delete pvc`로 **수동**으로 처리합니다 `✓`.
- PVC 크기는 hot 창(로그·트레이스 14일, 메트릭·세션 30일)으로 산정한 prod 노드당 order ~1TB를 기준으로 합니다. 실제 산정 워크드와 스테이징 대비 prod 비례는 {{< relref "07-capacity-planning.md" >}}가 전담합니다. 03/04와 임의로 다른 크기를 쓰지 않습니다.

### 6.3 온라인 볼륨 확장 (allowVolumeExpansion) `✓`

- StorageClass에 `allowVolumeExpansion: true`가 있으면, **PVC의 `resources.requests.storage`를 키우는 것만으로** EBS 볼륨이 온라인 확장됩니다(EBS Elastic Volumes). ClickHouse 재시작이 필요 없습니다 `✓`.
- EBS-first는 이렇게 성장을 흡수합니다: 0.7TB/월로 시작해 hot 창이 커지면 볼륨을 다운타임 없이 늘립니다.

{{< callout type="error" >}}
**운영 함정 2건** `✓`:

1. **reclaimPolicy: Retain 미준수 버그** — operator issue #1619에서 CHI/CHK에 Retain을 걸어도 클러스터 삭제 시 볼륨이 지워진 사례가 보고됐습니다. 기준 버전 0.27.1에서 수정됐는지는 릴리스 노트로 확인하고 `?`, 그 전까지는 **StorageClass `reclaimPolicy: Retain`도 이중으로** 걸어 방어합니다. 생성 후 실제 PV 정책을 반드시 확인합니다.
2. **PVC 볼륨 템플릿 확장 시 데이터 손실** — issue #1385에서 volumeClaimTemplate의 storage를 키우는 방식이 데이터 손실을 유발한 사례가 있습니다. 확장은 **PVC를 직접 수정**하는 경로로 하고 **스테이징에서 리허설한 뒤** 프로덕션에 적용합니다. 확장 전 백업은 필수입니다. 여기까지가 결론이고 **볼륨 성장 계열의 기준 문서는 {{< relref "08-block-only-tuning.md" >}}**입니다 — #1385의 재현 조건(`storageManagement` 미설정 시 무한 delete/recreate)·`provisioner: Operator` in-place 리사이즈·Elastic Volumes 수정 한도를 그 장이 단독으로 소유합니다. 성장이 상시 운영 축이 되는 형상이 블록 온리이기 때문입니다.
{{< /callout >}}

## 우리 케이스에서는

- **hot = 노드당 단일 gp3, baseline IOPS(3,000) + 인스턴스 baseline에 맞춘 소량 provisioned throughput(예: 300 MiB/s).** ClickHouse는 throughput-bound이고 인스턴스 EBS 파이프가 먼저 천장이라, 0.7TB/월엔 gp3를 80,000 IOPS/2,000 MiB/s까지 올릴 이유도, 여러 개 스트라이핑할 이유도 없습니다. mid-size Graviton **r7g**(메모리 최적화)에 gp3 단일 볼륨으로 시작하고 필요 시 r8g로 올립니다.
- **io2 / io2 BE는 각주.** 극한 IOPS·sub-ms·볼륨 단위 99.999% 내구성이 필요할 때만. RUM 분석엔 gp3 99.9% + 멀티 AZ RF 복제로 충분하고 io2는 GiB 1.56배 + 비싼 IOPS만 냅니다. io1은 검토 대상 자체가 아닙니다(throughput 1,000 MiB/s).
- **EBS-first의 값어치는 성능보다 재수화 불필요입니다.** 노드 재부팅·재스케줄·인스턴스 교체(같은 AZ)에서 볼륨 detach/attach로 데이터가 보존돼 재수화 위험 창이 근본적으로 짧습니다. 단 EBS는 AZ 종속이라 **멀티 AZ RF2+ 복제는 여전히 필수**이고(AZ 장애 방어), 다운타임 프로파일은 {{< relref "04-operator-topology-downtime.md" >}}에서 이어받습니다.
- **operator는 gp3 StorageClass(EBS CSI, `WaitForFirstConsumer`) + volumeClaimTemplate `reclaimPolicy: Retain` + `allowVolumeExpansion`.** 성장은 온라인 볼륨 확장으로 흡수하고 reclaimPolicy 미준수 버그(#1619)·PVC 확장 데이터 손실(#1385)은 StorageClass 이중 Retain + 스테이징 리허설 + 백업으로 방어합니다.
- **단가는 서울 기준으로 봅니다** — gp3 **$0.0912/GB-월** vs S3 Standard **$0.025/GB-월** = **3.65x** `✓`(§1.3). 이 배수가 03·08의 크로스오버 판단 입력이고 절대 금액은 {{< relref "07-capacity-planning.md" >}}가 계산합니다. provisioned IOPS·throughput의 서울 단가는 미확인 `?`이라 그 두 차원만 어림값으로 씁니다. **S3 Express One Zone은 서울 미제공** `✓`이므로 cold를 빠르게 하는 선택지로 검토 대상이 아닙니다(§5.3 각주).
- **로컬 NVMe는 업그레이드 경로로만** 열어두고 상세는 {{< relref "../../clickhouse/02-storage-local-nvme.md" >}}에 위임합니다. 시점 기준 2026-08.
