---
title: "hot 스토리지 — EBS gp3 / io2 실전 (로컬 NVMe는 옵셔널)"
date: 2026-08-01
lastmod: 2026-08-24
weight: 2
---

# ClickHouse hot 데이터를 gp3에 저장하기

월 0.7TB의 RUM 데이터를 저장하는 ClickHouse라면 노드마다 gp3 볼륨 하나를 붙이는 구성으로 시작할 수 있습니다. 볼륨의 최대 IOPS를 높이기 전에 확인할 것은 EC2 인스턴스가 지속적으로 처리할 수 있는 EBS 대역폭입니다. 중간 크기의 r7g에서는 볼륨보다 인스턴스 쪽 한도에 먼저 닿을 수 있습니다.

EBS를 선택한 또 다른 이유는 노드 교체입니다. 같은 AZ에서 볼륨을 다시 붙일 수 있으면 데이터를 전부 복사해 채우는 작업을 피할 수 있습니다. [로컬 NVMe 스토리지]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})와 비교할 때 성능뿐 아니라 이 복구 과정도 비용에 포함했습니다. S3에 내리는 오래된 데이터는 [콜드 티어링]({{< relref "03-s3-cold-tiering.md" >}}), 보존 기간별 볼륨 크기는 [용량 산정]({{< relref "07-capacity-planning.md" >}})에서 다룹니다.

## 1. gp3 성능과 비용 {#1-gp3-상세--2025-09-상향으로-스트라이핑이-필요-없어졌다}

### 1.1 볼륨 사양 {#11-현행-스펙-2026-07-aws-ebs-user-guide-}

gp3는 용량과 IOPS·throughput을 따로 지정합니다. 저장량이 늘 때 성능까지 같은 비율로 구매할 필요가 없어, 큰 파트를 읽고 병합하는 ClickHouse에 맞추기 쉽습니다. 아래는 2026-07 조사에서 확인한 사양입니다.

| 항목 | 값 | 비고 |
|---|---|---|
| baseline IOPS | 3,000 (무료, 스토리지 가격에 포함) | 버스트 아님 — 무기한 지속 |
| baseline throughput | 125 MiB/s (무료) | 버스트 아님 |
| 최대 IOPS/볼륨 | 80,000 (Nitro 전제) | 500 IOPS/GiB 비율 → 160 GiB 이상에서 도달. 비-Nitro는 §1.2 |
| 최대 throughput/볼륨 | 2,000 MiB/s (≈2,097 MB/s) | 0.25 MiB/s/IOPS → 8,000 IOPS & 16 GiB 이상에서 도달 |
| 볼륨 크기 | 1 GiB ~ 64 TiB | |
| 볼륨 내구성 | 99.8~99.9% (AFR ≤0.2%) | 볼륨 단위 — 데이터 내구성(복제+백업)과 별개(§5.2) |
| 지연 | single-digit ms | sub-ms가 필요하면 io2 BE |
| 버스트 여부 | 없음 — provisioned 성능을 무기한 지속 | gp2와 결정적 차이 |

성능에는 비율 제약이 있습니다. IOPS는 볼륨 GiB당 500 이하, throughput은 provisioned IOPS당 0.25 MiB/s 이하입니다. 따라서 2,000 MiB/s에는 최소 8,000 IOPS가, 80,000 IOPS에는 최소 160GiB가 필요합니다. gp2에 비해 GiB당 가격도 20% 낮습니다.

최대 IOPS와 throughput을 동시에 내는 I/O 크기는 `2,000 MiB/s ÷ 80,000 = 25.6 KiB`입니다. ClickHouse의 큰 순차 읽기·쓰기에서는 이보다 큰 블록을 처리하므로 IOPS 최대치보다 throughput 한도에 먼저 닿을 가능성이 큽니다.

### 1.2 2025년 상향된 한도와 적용 범위 {#12-통념-정정--gp3-최대-16000-iops--1000-mibs--16-tib는-상향-이전-값-}

2025-09-26에 gp3 상한은 16,000 IOPS·1,000 MiB/s·16TiB에서 80,000 IOPS·2,000 MiB/s·64TiB로 올라갔습니다. 전 상용 리전과 GovCloud에 적용됐으며 서울도 포함됩니다. 용량·IOPS·throughput 요금 체계는 유지됐습니다.

80,000 IOPS는 Nitro 인스턴스에 연결했을 때의 한도입니다. 비-Nitro에서는 최대 64,000 IOPS를 프로비저닝하더라도 실제 달성 상한은 32,000 IOPS입니다. Outposts는 종전 한도인 16TiB·16,000 IOPS·1,000 MiB/s가 남아 있습니다. 문서에서 낮은 수치를 만났다면 작성 시점과 Outposts 대상 여부를 확인해야 합니다.

단일 볼륨이 커지면서 여러 gp3를 RAID0로 묶어야 할 이유도 줄었습니다. RAID0는 구성 볼륨 하나의 장애가 배열 전체에 영향을 주므로, 단일 볼륨으로 요구 성능을 충족한다면 그쪽이 복구와 확장도 단순합니다. 다만 상향된 볼륨 사양을 모두 쓸 수 있는지는 인스턴스 한도를 다시 봐야 합니다.

### 1.3 서울 스토리지 단가 {#13-gp3-요금-3분해--gb-단가는-서울-실단가가-정본-}

| 차원 | 무료 포함분 | 초과분 요금 (us-east-1, 2026-07) | 초과분 요금 (서울 `ap-northeast-2`, 2026-08) |
|---|---|---|---|
| 스토리지 | — | $0.08 / GB-월 | $0.0912 / GB-월 |
| provisioned IOPS | 3,000 IOPS | $0.005 / provisioned IOPS-월 (3,000 초과분) | 미확인 |
| provisioned throughput | 125 MiB/s | $0.04 / provisioned MiB/s-월 (125 초과분) | 미확인 |

gp3는 최소 60초 이후 초 단위로 과금합니다. IOPS와 throughput의 초과분 단가는 단일 구간이며, io2의 계단식 IOPS 요금과 다릅니다.

서울의 스토리지 가격은 2026-08 AWS Price List Bulk API 조회에서 gp3 $0.0912/GB-월, S3 Standard 첫 50TB 구간 $0.025/GB-월로 확인했습니다. 저장 단가만 비교하면 gp3가 약 3.65배입니다. 이 값으로 [S3 티어링]({{< relref "03-s3-cold-tiering.md" >}})과 [블록 전용 운영]({{< relref "08-block-only-tuning.md" >}})의 비용을 비교합니다.

서울 gp3 스토리지는 us-east-1보다 약 14% 비쌉니다. IOPS·throughput의 서울 초과분 단가는 아직 확인하지 않았으므로 아래 예산 예시는 us-east-1 단가로 계산합니다. 서울 견적에서 두 항목까지 확정된 가격으로 읽지 않도록 주의해야 합니다. 총액 계산은 [용량 산정]({{< relref "07-capacity-planning.md" >}})에 있습니다.

### 1.4 r7g의 지속 성능에 맞추기 {#14-언제-baseline로-충분한가--인스턴스-ebs-파이프에-묶어-판정-핵심}

볼륨을 여러 개 붙여도 총 처리량은 인스턴스 EBS 대역폭을 넘지 못합니다. 이 글에서는 메모리 최적화 Graviton r7g를 사용하며, AWS EBS-optimized 표의 지속 성능과 버스트 성능을 함께 봅니다.

| 인스턴스 | baseline throughput | burst 최대 throughput | baseline / 최대 EBS IOPS |
|---|---|---|---|
| r7g.xlarge (4 vCPU/32 GiB) | 156 MB/s | 1,250 MB/s | 6,000 / 40,000 |
| r7g.2xlarge (8 vCPU/64 GiB) | 312 MB/s | 1,250 MB/s | 12,000 / 40,000 |
| r7g.4xlarge (16 vCPU/128 GiB) | 625 MB/s | 1,250 MB/s | 20,000 / 40,000 |
| r7g.8xlarge (32 vCPU/256 GiB) | 1,250 MB/s | 2,500 MB/s | 40,000 / 80,000 |

*(r7g는 ≤4xlarge에서 baseline이 크기 비례로 오르고 burst 최대는 10 Gbps/1,250 MB/s로 공통, 8xlarge에서 baseline이 10 Gbps로 점프합니다. baseline은 무기한 지속, burst는 24h 중 일부만. r8g(Graviton4)는 같은 크기에서 대역이 대체로 상향이나 이 카테고리 기준은 r7g입니다.)*

r7g.2xlarge의 지속 throughput은 312 MB/s입니다. gp3 기본 125 MiB/s는 약 131 MB/s이므로, 볼륨 throughput을 300 MiB/s 정도로 설정하면 인스턴스 지속 성능에 가까워집니다. 추가 175 MiB/s에 us-east-1 단가 $0.04를 적용하면 월 약 $7입니다. IOPS는 3,000으로 시작해 실제 병목을 확인합니다.

같은 인스턴스에 80,000 IOPS·2,000 MiB/s gp3를 붙여도 그 성능을 지속적으로 쓸 수 없습니다. r7g.2xlarge의 지속 IOPS는 12,000, 버스트 최대는 40,000이며 throughput도 버스트 최대 1,250 MB/s입니다. r7g.8xlarge부터는 버스트 대역폭이 2,500 MB/s로 올라가지만, 이때도 지속 부하와 버스트를 구분해야 합니다.

Altinity의 7,000 IOPS·1,000 MiB/s 예시는 여유 있게 잡은 가이드로 읽습니다. 월 0.7TB 환경에서는 낮은 설정으로 시작하고 `system.asynchronous_metrics`와 EBS 지표에서 대기와 대역폭 사용량을 확인한 뒤 올립니다.

{{% details title="io2 Block Express의 성능과 요금" closed="true" %}}
### 2.1 io2 Block Express 사양 {#21-현행-스펙-2026-07-}

기존 io2 볼륨은 io2 Block Express 아키텍처로 통합돼 사실상 "io2 = io2 Block Express"로 봐도 됩니다. io1은 남아있지만 io2 BE 대비 이점이 없습니다.

| 항목 | io2 Block Express | io1 (구형) |
|---|---|---|
| 최대 IOPS/볼륨 | 256,000 | 64,000 |
| 최대 throughput/볼륨 | 4,000 MiB/s | 1,000 MiB/s |
| 최대 크기 | 64 TiB | 16 TiB |
| 볼륨 내구성 | 99.999% (AFR 0.001%) | 99.8~99.9% |
| 지연 | 16 KiB I/O 평균 <500 µs | single-digit ms |
| 최대 IOPS:GiB | 1,000 IOPS/GiB | 50 |
| Multi-attach / NVMe reservation | 지원(동일 AZ 다중 인스턴스 공유·예약) | 제한적 |
| 지원 인스턴스 | 모든 Nitro 기반 EC2 | — |

io2 Block Express는 io1보다 throughput이 4배, IOPS:GiB 비율이 20배 높습니다. 과거 io2의 500 MiB/s 수치를 현행 4,000 MiB/s와 혼동하면 안 됩니다. 여기서 io2를 선택하지 않는 이유는 성능 부족이 아니라 필요한 성능에 비해 높은 비용입니다.

### 2.2 io2의 IOPS 요금 {#22-io2-tiered-iops-요금-us-east-1-}

| 차원 | 요금 |
|---|---|
| 스토리지 | $0.125 / GB-월 (gp3의 ~1.56배) |
| IOPS ≤ 32,000 | $0.065 / provisioned IOPS-월 |
| IOPS 32,001 ~ 64,000 | $0.046 / provisioned IOPS-월 |
| IOPS > 64,000 | $0.032 / provisioned IOPS-월 |

IOPS를 많이 프로비저닝할수록 추가분의 단가가 내려갑니다. throughput 요금은 별도로 없고 IOPS에 따라 성능이 올라갑니다. 따라서 throughput만 조금 더 필요한 경우에는 gp3처럼 그 항목만 추가하는 방식이 유리합니다.

### 2.3 io2를 검토할 조건 {#23-io2가-gp3-대비-정당화되는-조건--우리는-해당-없음-}

io2를 검토할 이유는 단일 볼륨에서 80,000을 넘는 IOPS, sub-ms 지연, 또는 99.999% 볼륨 내구성이 필요할 때입니다. 작은 랜덤 I/O와 응답 지연이 중요한 워크로드라면 비용을 지불할 근거가 생깁니다.

현재 RUM 분석에서는 그런 요구를 확인하지 못했습니다. gp3 대비 스토리지 단가 약 1.56배와 provisioned IOPS 비용을 추가하기 전에 gp3의 실제 한계부터 측정하는 편이 맞습니다. ClickHouse 데이터 보호는 별도로 멀티 AZ 복제와 백업을 구성합니다. 그 관계는 [스토리지와 내구성 설명]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})을 참고합니다.

{{% /details %}}

## 3. 머지가 만드는 I/O {#3-clickhouse-io-특성--throughput-bound-볼륨-개수보다-인스턴스-파이프}

MergeTree는 컬럼 데이터를 파트로 저장하고, 백그라운드에서 파트를 읽고 합쳐 다시 씁니다. 이 과정에서 큰 순차 I/O가 발생하므로 스토리지를 고를 때 throughput이 중요해집니다. 압축과 페이지 캐시, 쿼리 형태에 따라 양상은 달라지지만 IOPS를 계속 올린다고 머지가 같은 비율로 빨라지지는 않습니다.

Altinity도 볼륨 throughput을 주요 제약으로 설명하고 gp3/gp2를 적합한 선택으로 제시합니다. 노드당 gp3 1~3개, 특히 EBS 대역폭이 10Gbps 미만인 노드에서는 단일 gp3를 권하는 이유입니다.

### 3.1 단일 볼륨과 RAID0 비교 {#31-단일-gp3-vs-다중-gp3-스트라이핑--우리-판정-}

| | 단일 gp3 | 다중 gp3 RAID0 |
|---|---|---|
| 성능 상한 | 80,000 IOPS / 2,000 MiB/s (인스턴스 파이프에 재차 제한) | 볼륨 수배 (단, 인스턴스 EBS 대역이 총합 상한) |
| 실효 내구성 | 99.9% | 낮아짐 (볼륨 1개 실패 → 배열 전체 손실) |
| 운영 복잡도 | 낮음(EBS CSI 단일 PVC) | 높음(RAID 구성·복구·확장) |
| 온라인 확장 | `allowVolumeExpansion`로 단순 | RAID 재구성 필요 |
| 우리 스케일 적합 | 적합한 시작 구성 | 이 규모에서는 불필요 |

우리 규모에서는 단일 gp3가 관리할 볼륨 수를 줄이면서 필요한 성능을 제공할 것으로 봅니다. 더 큰 볼륨이나 더 높은 I/O가 필요해지면 §1.4의 인스턴스 한도를 함께 확인합니다. 수십 TB 분석에서 이 한도가 로컬 NVMe 선택에 어떤 영향을 주는지는 [로컬 NVMe 글]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})에서 비교합니다.

## 4. 로컬 NVMe를 다시 검토할 시점 {#4-로컬-nvme--옵셔널-업그레이드-경로-relref}

> 반대 방향의 변형 — S3 콜드 티어링을 아예 쓰지 않고 EBS 단일 티어로만 운영하기(단일 `default` 정책·TTL DELETE-only·gp3 온라인 확장·merge 풀 튜닝) — 는 [블록 온리 튜닝]({{< relref "08-block-only-tuning.md" >}})이 기준 문서입니다.

로컬 NVMe(i7i/i8g)는 대규모 스캔을 지속적으로 수행할 때 수 GB/s 대역폭을 얻을 수 있는 선택입니다. 스토리지 가격은 인스턴스 가격에 포함되지만, 인스턴스 교체로 데이터를 잃으면 복제본에서 다시 채워야 합니다. local PV 배치와 Karpenter의 노드 교체 정책도 함께 관리해야 합니다.

범용 분석 부하가 늘어 hot 데이터가 노드당 수 TB가 되고 대규모 스캔 지연을 줄여야 한다면 로컬 NVMe를 다시 검토합니다. 인스턴스 선택, 재수화 시간, Karpenter와 local PV 운영은 [별도 글]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})에 정리했습니다.

## 5. 노드 교체와 데이터 복구 {#5-왜-우리-스케일07tb월-rum에선-ebs-first인가}

### 5.1 재부팅·재스케줄·AZ 장애의 차이 {#51-ebs-first의-진짜-이점은-성능이-아니라-재수화-불필요-핵심}

인스턴스를 교체할 때 로컬 NVMe는 새 노드에 데이터를 채워야 합니다. EBS는 기존 볼륨을 같은 AZ의 새 노드에 붙여 남아 있는 파트를 재사용할 수 있습니다. 다만 단순 재부팅은 두 매체 모두 데이터를 보존합니다. AWS는 instance store의 reboot와 stop/terminate를 명확히 구분합니다. [EC2 instance store 데이터 수명](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-store-lifetime.html)

아래 표는 매체에 데이터가 남는지와 복구할 때 다시 복사해야 하는지를 구분한 것입니다. 복구 시간 계산은 [재수화 설명]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})을 참고합니다.

| 이벤트 | 로컬 NVMe | EBS gp3 |
|---|---|---|
| 노드 재부팅 | 보존(단순 reboot) | 보존 |
| 다른 노드로 pod 재스케줄(같은 AZ) | 새 노드에 데이터 복사 필요 | EBS detach → 새 노드에 attach, 데이터 보존 |
| 인스턴스 교체(같은 AZ) | 소실 → 재수화 | 볼륨 재부착, 재수화 0 |
| AZ 장애 | 해당 AZ 데이터 접근 불가 | 해당 AZ 볼륨 접근 불가, 타 AZ 재부착 불가 — 다른 AZ replica로 서비스 |
| 볼륨 자체 장애(연 ≤0.2%) | (해당 없음) | replica에서 재수화 |

EBS가 살아 있으면 노드 교체 후 전량 복사 대신 재부착과 밀린 파트 동기화로 복구할 수 있습니다. 그동안 해당 replica는 요청을 처리하지 못하므로 서비스 가능한 사본 수는 줄어듭니다. 복구 시간이 짧아질 수 있다는 이점을 가용성 저하가 없다는 뜻으로 읽으면 안 됩니다. detach·attach와 ClickHouse 시작 시간은 배포 후 실측합니다.

AZ 전체가 멈추면 EBS를 다른 AZ로 옮겨 붙일 수 없습니다. 남은 AZ의 replica로 서비스를 이어가고, 장애 AZ 복구를 기다리거나 다른 AZ에 새 replica를 채워야 합니다. 그래서 EBS에서도 멀티 AZ 복제를 사용합니다. 자세한 장애별 절차는 [operator·다운타임]({{< relref "04-operator-topology-downtime.md" >}})에 있습니다.

### 5.2 복제와 백업 비용 {#52-내구성-계층-정리-}

gp3의 99.8~99.9%와 io2의 99.999%는 볼륨 내구성 지표입니다. 운영자가 테이블을 잘못 지우거나 한 AZ에 접근하지 못하는 상황까지 해결해주는 값은 아닙니다.

self-hosted ClickHouse에서는 멀티 AZ `ReplicatedMergeTree`와 `clickhouse-backup → S3`를 함께 구성합니다. RF2면 hot EBS도 두 벌이 필요합니다. [배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})에서 RF와 `insert_quorum`을 검토한 뒤 저장 비용에 그 배수를 반영합니다.

### 5.3 저장 매체 비교 {#53-hot-매체-4자-비교-2026-07}

| 지표 | gp3 (단일) | io2 Block Express | 로컬 NVMe (i8g) | S3 (참고: cold 전용) |
|---|---|---|---|---|
| 최대 IOPS/볼륨 | 80,000 | 256,000 | 인스턴스 물리한계 | — |
| 최대 throughput/볼륨 | 2,000 MiB/s | 4,000 MiB/s | 수 GB/s(RAID로↑) | S3 대역 |
| 실효 천장 | 인스턴스 EBS 파이프 | 인스턴스 EBS 파이프 | 인스턴스 물리 NVMe | 네트워크 |
| 지연 | single-digit ms | <500 µs | µs 단위 | 수십~수백 ms |
| 볼륨 내구성 | 99.8~99.9% | 99.999% | 없음(휘발성) | 11 nines |
| GB당 요금(us-east-1 · 서울) | $0.08 · $0.0912 | $0.125 · 미확인 | 인스턴스가에 포함 | ~$0.023 · $0.025 |
| 노드 재부팅 시 데이터 | 보존 | 보존 | 보존(단순 reboot) | 보존 |
| AZ 장애 시 | 해당 AZ 접근 불가 | 해당 AZ 접근 불가 | 해당 AZ 접근 불가 | 보존 |
| 운영 복잡도 | 낮음 | 낮음 | 높음(RAID·재수화·Karpenter) | 중간 |
| 0.7TB/월 RUM 적합 | 적합한 시작 구성 | 추가 요구가 있을 때 검토 | 노드 교체 운영 부담 | (cold 티어로만) |

{{< flow src="_flow/5-3-hot-매체-자-비교.json" />}}

S3 Express One Zone은 2026-08 조사 당시 서울에 제공되지 않았습니다. 당시 지원 리전은 us-east-1·us-east-2·us-west-2·ap-south-1·ap-northeast-1·eu-central-1·eu-west-1·eu-north-1입니다. ClickHouse의 `storage_class_name=EXPRESS_ONEZONE` 문법과 별개로 디렉터리 버킷에서 `IncompleteBody`가 보고된 사례도 있습니다(#72078, 24.10.2.80). 서울에서 이 구성을 검토하려면 리전 지원과 해당 버전의 동작을 다시 확인해야 합니다.

ClickHouse가 발표한 Express One Zone 기반 콜드 쿼리 평균 36%·최대 283% 개선, 캐시 계층 TCO 최대 65% 개선은 Cloud SaaS 구성의 측정값입니다. 그 구성의 Distributed Cache는 [Cloud와 self-hosted 비교]({{< relref "../../clickhouse/01-managed-vs-selfhosted.md" >}})에서 다룬 Cloud 전용 구성요소이므로 이 gp3 기반 배포의 예상 성능으로 사용하지 않습니다.

## 6. Altinity operator에 gp3 연결하기 {#6-altinity-operator-연동--gp3-storageclass--volumeclaimtemplate}

### 6.1 StorageClass {#61-gp3-storageclass-ebs-csi-드라이버-}

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

`iops`와 `throughput`은 StorageClass에서 지정하거나 이후 EBS Elastic Volumes로 조정할 수 있습니다. `WaitForFirstConsumer`는 파드가 배치될 AZ에 볼륨을 만들도록 바인딩을 늦춥니다. EBS의 AZ 제약을 맞추기 위한 설정입니다. 예제는 저장 암호화를 켜며 필요한 경우 KMS 키를 지정합니다.

### 6.2 volumeClaimTemplate과 볼륨 보존 {#62-clickhouseinstallation-volumeclaimtemplate--reclaimpolicy-retain-}

StorageClass와 Altinity volumeClaimTemplate에는 각각 `reclaimPolicy`가 있습니다. operator 쪽 `Retain`은 CHI 삭제 시 PVC를 보존하는 용도이고, StorageClass 쪽 설정은 PV 회수 정책에 적용됩니다. 실수로 클러스터를 삭제했을 때 볼륨까지 사라지지 않도록 둘 다 확인합니다.

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

volumeClaimTemplate의 `reclaimPolicy`는 `spec`과 같은 깊이에 놓습니다. operator는 PVC 라벨을 사용해 보존 정책을 구현하므로 관련 라벨도 유지해야 합니다. 완전히 제거할 때는 CHI 삭제 후 남은 PVC를 확인하고 별도로 삭제합니다.

예제의 `1000Gi`는 운영 노드당 약 1TB를 둔 값입니다. [용량 산정]({{< relref "07-capacity-planning.md" >}})에서 로그·트레이스 14일, 메트릭·세션 30일과 머지 여유 등을 반영한 뒤 실제 크기를 정합니다.

### 6.3 PVC 확장과 알려진 문제 {#63-온라인-볼륨-확장-allowvolumeexpansion-}

StorageClass에서 `allowVolumeExpansion: true`를 켜면 PVC의 요청 용량을 늘려 EBS를 확장할 수 있습니다. 지원되는 경로에서는 ClickHouse 재시작 없이 용량을 늘립니다. 다만 operator 템플릿 수정이 곧 안전한 PVC 확장이라는 가정은 피해야 합니다.

{{< callout type="error" >}}
issue #1619에는 CHI/CHK에 `Retain`을 설정해도 삭제 시 볼륨이 지워진 사례가 있습니다. 기준 operator 0.27.1에서의 수정 여부는 확인이 남아 있습니다. StorageClass에도 `Retain`을 두고 생성된 PV의 실제 정책을 확인합니다.

issue #1385에는 volumeClaimTemplate의 용량 변경 중 데이터 손실이 보고됐습니다. 확장 전 백업을 확보하고 staging에서 PVC 수정 경로를 검증해야 합니다. `storageManagement` 미설정 시 재생성 문제, `provisioner: Operator`의 in-place 확장과 Elastic Volumes 수정 한도는 [블록 전용 운영]({{< relref "08-block-only-tuning.md" >}})에서 다룹니다.

{{< /callout >}}

## 부하와 노드 교체를 함께 검증하기 {#우리-케이스에서는}

r7g 노드에 gp3 하나를 붙이고 3,000 IOPS·약 300 MiB/s로 시작합니다. 이 값이 충분한지는 머지와 조회가 겹칠 때의 대역폭 사용량으로 확인합니다. 디스크 지연이 높다면 볼륨 설정과 인스턴스 지속 성능 중 어디에 닿았는지부터 구분합니다.

용량을 늘리는 작업과 노드를 교체하는 작업도 따로 리허설합니다. PVC 확장에서는 실제 볼륨 크기와 기존 데이터를 확인하고, 노드 교체에서는 같은 AZ 재부착과 ClickHouse 준비 완료까지 시간을 측정합니다. EBS를 택한 운영상 이점은 이 두 작업이 안정적으로 끝날 때 확보됩니다.

사양과 단가는 2026-07~08 조사값이며 서울 provisioned IOPS·throughput 단가는 미확인입니다.
