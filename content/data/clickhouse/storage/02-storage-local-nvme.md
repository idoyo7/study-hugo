---
title: "스토리지 아키텍처 — 로컬 NVMe(i7i/i8g)"
date: 2026-07-13
lastmod: 2026-08-24
weight: 2
url: "/clickhouse/02-storage-local-nvme/"
---

# 스토리지 아키텍처 — 로컬 NVMe(i7i/i8g)

로컬 NVMe를 ClickHouse 데이터 디스크로 쓰면 수 GB/s의 처리량을 얻을 수 있습니다. 대신 인스턴스가 사라질 때 그 디스크도 잃습니다. 따라서 노드 크기를 고를 때는 저장할 수 있는 TB보다, 노드 한 대 분량을 다른 replica에서 복구하는 데 걸리는 시간을 계산해야 합니다.

이 글은 대규모 상시 워크로드에서 최근 데이터를 i7i/i8g의 로컬 NVMe에 두고 오래된 데이터를 S3로 옮기는 구성을 다룹니다. 멀티 AZ replica, 별도 S3 백업, gp3에 둔 Keeper가 함께 필요합니다. S3 cold tier도 RMT replica마다 사본을 가지므로 저장 비용에는 복제 배수를 반영합니다.

로컬 디스크가 모든 규모에서 유리하지는 않습니다. 운영 인력이 적거나 EBS 성능으로 충분한 경우에는 gp3가 더 단순합니다. 매체별 차이를 비교한 뒤 로컬 PV 배치와 노드 교체까지 살펴보겠습니다. 운영비를 포함한 비교는 [Managed vs Self-hosted]({{< relref "/data/clickhouse/deployment/01-managed-vs-selfhosted.md" >}})에 있습니다.

## 스토리지 4전략 — 무엇을 고르나

비교 대상은 로컬 NVMe, EBS, S3와 캐시, 그리고 hot/cold 티어링입니다. EBS는 gp3와 io2 Block Express를 나눠 적었습니다. 아래 사양은 매체별 상한이며 실제 쿼리 성능은 인스턴스 대역폭과 캐시 적중률에도 영향을 받습니다.

| 지표 | (a) 로컬 NVMe | (b) EBS gp3 | (b) EBS io2 Block Express | (c) S3 + local cache | (d) tiered(hot NVMe/cold S3) |
|---|---|---|---|---|---|
| 지연(latency) | **µs 단위(최저)** | 100~500 µs | **<500 µs @16KiB** | hot=캐시급 / cold=수십~수백 ms | hot=NVMe / cold=S3 |
| 최대 IOPS | 인스턴스 물리한계(수백만급) | 80,000/vol | **256,000/vol** | 캐시 히트 시 로컬급 | 티어별 |
| 최대 처리량 | 인스턴스 한계(수 GB/s, RAID로↑) | 2,000 MiB/s | **4,000 MB/s/vol** | 캐시+S3 대역 | 티어별 |
| 내구성 | **없음(휘발성)** — 복제로 보완 | 99.8~99.9% | **99.999%** | S3 11 nines | 티어별 |
| GB당 비용 | **인스턴스포함($0)** | $0.08/GB-mo+IOPS·처리량초과분 | gp3보다비쌈 | S3최저(~$0.023/GB-mo) | hot비쌈/cold저렴 |
| 노드 이동 시 데이터 | **소실** | 재부착 가능(같은 AZ) | 재부착 가능 | S3에 보존 | hot 소실/cold 보존 |
| 운영 복잡도 | **높음**(RAID·재수화·백업) | 낮음(EBS CSI 표준) | 낮음 | 중간(캐시 튜닝) | **가장 높음**(정책·TTL·이동) |
| 적합 워크로드 | 고QPS·저지연·대규모스캔 | 일반프로덕션·중규모 | 극한 IOPS DB | 콜드/아카이브·비용최적 | 관측성 |

*(위 성능·내구성 수치는 AWS 공식 스펙 기준 `✓`, GB당 비용은 us-east-1 2026-07 시점.)*

로컬 NVMe의 이득은 데이터가 디스크에서 읽히는 부하에서 확인해야 합니다. 다음은 이 글의 구성에서 각 매체를 선택하거나 제외한 이유입니다.

- EBS(gp3/io2)는 인스턴스의 EBS 대역폭 한계에 묶입니다. gp3 볼륨을 아무리 붙여도 인스턴스 EBS 파이프(예: i7i는 EBS 최대 60 Gbps, 중형은 1,250 MB/s급)가 병목이라 `✓` 로컬 NVMe의 수 GB/s를 못 냅니다. "스토리지 성능을 강하게"라는 요구는 EBS 경로로는 월 수천 달러를 써도 물리적으로 도달 불가입니다(정량 근거는 [Managed vs Self-hosted]({{< relref "/data/clickhouse/deployment/01-managed-vs-selfhosted.md" >}})).
- S3-backed MergeTree(c)는 데이터를 S3에 저장하지만, 이 글의 self-host RMT 구성에서는 replica별 사본과 로컬 메타데이터가 남습니다. SharedMergeTree는 Cloud 전용입니다. self-host의 S3 disk는 part metadata가 로컬에 남아 filesystem_cache가 사실상 필수이며 콜드 쿼리는 느립니다. 이 운영 부담을 고려해 S3는 cold tier로 사용합니다 `Σ`. 공식 가이드에는 S3 단독 볼륨 예제가 실려 있고 "S3를 primary로 쓰지 말라"는 명시적 금지 문장은 공식 어디에도 없습니다 `✓`. 있는 것은 용도 한정(*"query performance on cold data is less critical"*)과 "설정 없이 이 아키텍처를 원하면 Cloud를 권한다"는 안내뿐입니다 `✓`. 우리 기각 사유는 사본 배수·part metadata 지역성·콜드 지연이라는 3중 제약과 아래 §S3 primary의 OSS 경로에 정리한 결함들입니다.
- 관측성 워크로드의 정석은 (d) tiered입니다. 최근 데이터는 hot(로컬 NVMe)에 두고 오래된 데이터는 `TTL ... TO VOLUME 'cold'`로 S3에 내립니다. 성능은 hot에서 얻고 비용은 cold에서 아낍니다. 스토리지 티어링 프리미티브 자체는 [로깅 챕터의 ClickHouse]({{< relref "/observability/logs/comparison/04-clickhouse.md" >}}) 페이지에서도 다룹니다.
- S3 Express One Zone은 서울(ap-northeast-2)에 없습니다 `✓` — hot 매체 후보에서 애초에 빠집니다. 4자 비교와 디렉터리 버킷 엔드포인트 이슈는 [HyperDX · hot 스토리지 EBS]({{< relref "/observability/hyperdx/design/02-hot-storage-ebs/index.md" >}})에 정리돼 있습니다.

다른 데이터스토어에서도 로컬 디스크를 복제와 함께 운영합니다. [데이터스토어별 비교]({{< relref "/data/clickhouse/storage/07-local-nvme-datastore-patterns.md" >}})에는 ScyllaDB·Kafka·Redpanda·ES/OpenSearch·Aerospike·TiKV·CockroachDB 등의 사례와 재수화 MTTR·cross-AZ 전송 비용을 정리했습니다. 공통 패턴이 있어도 S3 사본 수와 복구 절차는 제품별로 다릅니다.

### 로컬 NVMe가 정당화되는 신호

RAID나 마운트 부트스트랩, 재복제, 백업까지 운영하려면 그만큼의 성능 이득이 있어야 합니다. Altinity는 운영을 단순하게 유지하려고 32 vCPU 이하 노드에 gp3 단일 볼륨을 기본 권장합니다 `Ⓥ`. 반면 PostHog는 처리량 요구 때문에 로컬 NVMe로 옮겼습니다. 아래 조건을 실제 부하와 대조해볼 수 있습니다.

| 신호 | 로컬 NVMe 정당화 |
|---|---|
| **데이터 규모** | 노드당 수 TB~수십 TB, 클러스터 총 10TB+ 압축 |
| **쿼리 패턴** | 대규모 full/range scan, 고QPS 대시보드, 저지연(<수십ms), 무거운 aggregation |
| **처리량 요구** | EBS 단일/다중 볼륨(~2GB/s대)으로 부족, 수 GB/s 필요 |
| **워크로드 안정성** | 24/7 always-on(로컬 NVMe 노드는 상시 가동 전제) |

반대로 소규모(<5~10TB)·bursty·운영 인력 부족·강한 내구성 단순화 요구면 gp3나 managed가 합리적입니다.

> 반론도 있습니다 `Ⓥ`. Altinity는 ClickHouse가 보통 IOPS가 아닌 throughput-bound라 gp3 1~3개면 충분한 경우가 많다고 봅니다. 자체 벤치마크에서는 EBS 기반 m6i.4xlarge가 로컬 NVMe i3.4xlarge를 캐시드 쿼리 전반에서 앞선 사례를 보고했습니다(원인은 스토리지가 아니라 39% 빠른 CPU 클럭 — 데이터가 페이지 캐시에 오르면 디스크 종류보다 CPU 세대가 성능을 좌우합니다). KubeCon 2023 발표의 권장 아키텍처도 스토리지/컴퓨트 분리형 EBS gp3였고 로컬 NVMe는 오브젝트 스토리지 캐시 계층으로 뒀습니다. 이 반론의 실체는 "구세대 로컬 NVMe(i3) vs 신세대 CPU+EBS(m6i)" 비교이지 i7i/i8g(신세대 CPU+신세대 NVMe)를 반박한 것은 아닙니다 — 워킹셋이 페이지 캐시에 다 올라가는 워크로드에서는 로컬 NVMe 프리미엄이 무의미해진다는 신호로 읽어야 합니다. 이 페이지의 로컬 NVMe-primary 권고를 뒤집지는 않습니다.

## i7i / i8g — 로컬 NVMe 인스턴스 상세

i7i (2025-04-28 출시 `✓`) 는 x86 스토리지 최적화 인스턴스입니다. 3세대 AWS Nitro SSD(상시 AES-256 암호화) + 5세대 Intel Xeon(Emerald Rapids, 전코어 터보 3.2GHz) + DDR5 조합입니다. 최상위 i7i.48xlarge는 192 vCPU / 1,536 GiB RAM / 로컬 NVMe 45TB(12×3,750GB) / 네트워크 100Gbps / EBS 대역폭 60Gbps입니다. 스토리지밀집형 i7ie.48xlarge는 120TB(16×7,500GB)까지 올라갑니다 `✓`. AWS는 이전 세대 i4i 대비 컴퓨트 성능 ~23%↑·실시간 스토리지 성능 ~50%↑·I/O 지연 ~50%↓·지연 변동성 ~60%↓를 주장합니다. 이 % 수치들은 AWS 마케팅 자료 기준입니다. 절대 IOPS·처리량·가격은 공식 페이지에 없습니다 `Ⓥ`.

3.75TB Nitro SSD 한 개의 공식 random I/O 사양은 read 600,000 / write 330,000 IOPS입니다(4KB 블록, 큐 깊이 포화) `✓`. 표의 총 IOPS는 드라이브 수에 비례합니다. 사이즈별 vCPU 단가가 같으므로 RAM·디스크 용량과 노드당 복구 시간을 함께 보고 크기를 고릅니다.

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

*(사양·IOPS `✓`, us-east-1 on-demand 요금 `✓`, 2026-07 시점. metal-24xl/48xl은 각각 24xl/48xl과 동일 스펙.)*

순차(sequential) 대역은 random 4K보다 높습니다 — PostHog는 4×7.5TB NVMe RAID10에서 쓰기 ~1,000 MB/s + 읽기 ~4,000 MB/s 동시 달성을 실측했고 "어떤 EBS 조합으로도 불가능"이라 평했습니다 `✓`. i7i.4xlarge 단일 노드만으로도 random 4K ~2.46 GB/s가 나오고 `≈` 대형 노드는 수십 GB/s 대역이 나옵니다.

i8g 우선 권고. i8g는 Graviton4 + 동일한 3세대 Nitro SSD라 드라이브당 IOPS가 i7i와 완전히 동일(3.75TB당 600,000/330,000)하면서 동일 사이즈 기준 ~9% 저렴합니다 `✓`(i8g.8xlarge $2.7456 vs i7i.8xlarge $3.0202). ClickHouse는 ARM64 바이너리를 제공하고 "클럭보다 코어 수"를 선호해 Graviton 궁합이 좋습니다. 성능/달러가 명백히 i8g 우위이므로 기본은 i8g로 갑니다.

| 인스턴스 | 아키텍처 | 드라이브 | 드라이브당 read/write IOPS | 언제 |
|---|---|---|---|---|
| **i8g** | Graviton4(ARM64) | 3.75 TB | **600,000 / 330,000** | **기본 후보** — IOPS 동률, ~9% 저렴 |
| **i7i** | Intel x86 | 3.75 TB | 600,000 / 330,000 | x86 의존(사이드카·에이전트 바이너리) 있을 때 |
| **i7ie / i3en** | Intel x86 | 7.5 TB / 대용량 | TB당 IOPS는 i7i/i8g보다 낮음 | 초고밀도(45~60TB+/노드)가 목적일 때만 |

주의: i7ie는 7.5TB 드라이브라 용량 밀도는 높지만 TB당 IOPS 밀도는 i7i/i8g보다 낮습니다 `✓`. 초고밀도 저장이 목적일 때만 i7ie/i3en을 씁니다. IOPS 성능 극대화가 목적이면 i7i/i8g가 맞습니다. i8g는 최대 22.5TB/노드로 i7i(45TB)보다 밀도 상한이 낮으니 사이즈 계획에 함께 반영합니다 `✓`.

## replica·백업·Keeper 배치 {#휘발성을-복제로-덮는다--내구성-3종-세트}

instance store는 인스턴스 stop/terminate 또는 하드웨어 장애 때 데이터를 잃을 수 있습니다. 이 설계에서는 데이터 replica를 AZ에 분산하고, 논리적 삭제·손상에 대비한 백업을 별도로 유지하며, Keeper 메타데이터는 영속 디스크에 둡니다.

1. 멀티 AZ replica 2~3개(shard당). ReplicatedMergeTree(RMT)에서 각 replica가 데이터 파트 전체 사본을 보유하고 Keeper로 조정합니다 — 단일 노드 로컬 디스크 소실을 복제가 방어합니다 `✓`. k8s에서는 pod anti-affinity(hostname) + topologySpreadConstraints(zone)로 replica를 AZ에 분산합니다. 이 글의 HA 구성은 멀티 AZ 배치를 전제로 합니다. 모든 파트가 복제된 상태라면 RF2에서 한 사본, RF3에서 두 사본을 잃어도 원본이 남습니다. ACK 직후 미복제 데이터의 보존은 `insert_quorum`과 장애 조합에 따라 달라집니다. 복제 수·쓰기 확인 조건·비용은 [배포 플레이북 §RF 선택]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}})에서 함께 비교합니다.
2. clickhouse-backup → S3(주간 full + 일간 incremental, shard별). Altinity clickhouse-backup이 사실상 표준입니다 `✓`. (incremental 체인 의존성과 S3 lifecycle 주의사항은 아래 콜아웃)
3. Keeper 3(최소)/5(HA) 노드, 멀티 AZ, 전용 노드. 조율 계층이 소실되면 메타데이터 복구가 번거로우므로 Keeper 데이터만은 gp3(영속) 디스크에 둡니다 `✓`. Keeper는 소량 데이터라 4GB RAM·gp3로 충분합니다. AZ 간 round-trip이 50ms를 넘으면 replication throughput이 악화되니 지연을 확인합니다.

{{< callout type="warning" >}}
incremental 백업 체인은 fragile — 이전 백업 전체 체인에 의존하므로 하나라도 손상되면 이후는 복구할 수 없습니다. S3 lifecycle로 base를 Glacier에 넣으면 체인이 붕괴하니 lifecycle 규칙과 정기 restore drill을 직접 소유해야 합니다.
{{< /callout >}}

{{< callout type="error" >}}
zero-copy replication은 프로덕션에 사용하지 않습니다. 22.8부터 기본 비활성이며, 공식 문서도 프로덕션 준비가 되지 않았다고 명시합니다. mutation 중 손실(#39560), merge 중 손상, TTL 이동 실패와 Keeper 부하 문제가 보고됐습니다 `✓`. #45346에서는 CH 22.3·4 replica·S3 구성의 소스 파트가 메타데이터에는 있으나 모든 replica에서 사라져 merge가 정지했습니다. 이슈는 experimental 기능으로 분류돼 not-planned로 닫혔고 정확한 원인은 로그 소실로 확정되지 않았습니다 `≈`.

26.8 dev의 `MergeTreeSettings.cpp`에도 설정은 `EXPERIMENTAL`로 남아 있습니다. OBSOLETE 항목에 들어간 기능은 아닙니다 `✓`. Tinybird가 사용한 deprecated라는 표현과 구분할 필요가 있습니다 `Ⓥ`. 2026년에도 공유 blob 조기 삭제(#95597)와 drop 정지(#96965)가 보고돼, 이 설계는 replica별 독립 S3 경로를 유지합니다. [Cloud의 SharedMergeTree]({{< relref "/data/clickhouse/deployment/01-managed-vs-selfhosted.md" >}})를 self-host zero-copy와 같은 기능으로 취급하지 않습니다.

{{< /callout >}}

### S3 primary의 OSS 경로 — `plain_rewritable`을 왜 기각하나

OSS에서도 S3의 한 사본을 여러 서버가 읽는 구성은 가능합니다. `plain_rewritable`과 읽기전용 part refresh가 그 경로입니다. 다만 여기서 필요한 RMT 복제와 함께 쓸 수 없어 채택하지 않았습니다 `Σ`.

경로의 실체를 뜯어보면 이렇습니다. `plain_rewritable` 메타데이터 타입(24.4/24.5 도입)은 로컬 메타데이터 없이 오브젝트 스토리지 위에 테이블을 놓아 여러 서버가 같은 경로를 보게 만듭니다 `✓`. 여기에 readonly part refresh(25.4, `refresh_parts_interval`·`table_disk`, PR #76467)를 더하면 읽기전용 리더가 라이터의 새 파트를 주기적으로 발견합니다 `✓`. 단일 라이터 + 읽기전용 리더 N이라는 형태는 실제로 구성할 수 있습니다 — [Managed vs Self-hosted §SharedMergeTree]({{< relref "/data/clickhouse/deployment/01-managed-vs-selfhosted.md" >}})가 말하는 "재현할 수 없다"가 다중 라이터 HA 형태로는이라고 한정되는 이유입니다.

공식 문서는 `plain_rewritable`에 mutation과 테이블 복제를 지원하지 않는다고 명시합니다 `✓`. 이 디스크를 선택하면 RMT로 내구성과 가용성을 확보하는 현재 설계를 바꿔야 합니다. 단일 라이터 장애 전환과 아래 회귀까지 별도로 해결해야 하므로, 이 구성에서는 S3 cold tier를 유지합니다.

{{% details title="기각 사유 6개 — 배타 관계와 미해결 회귀" closed="true" %}}
1. mutation 미지원 — `ALTER UPDATE`/`DELETE` 계열이 동작하지 않습니다 `✓`.
2. 테이블 복제 미지원 — 공식 문서 *"replication of tables are not supported"*. RMT와 상호 배타입니다 `✓`.
3. 라이터 failover가 없습니다 — 단일 라이터가 죽으면 승격해 줄 주체가 없습니다. 리더 N은 읽기만 합니다 `✓`.
4. #87281(25.8.1) — `plain_rewritable` 디스크에서 테이블 생성이 실패하는 회귀. PR #89796으로 다뤄졌습니다 `✓`.
5. #93579(25.11.2.24) — 데이터베이스 단위 attach가 깨지고 코드 경로가 `unfinished code`로 남아 있습니다 `✓`.
6. 26.3 — `plain_rewritable` 디스크를 여럿 선언하면 서버가 기동 자체를 차단합니다 `✓`.
{{% /details %}}

"S3를 메인으로"라는 요구는 서로 다른 세 갈래로 나눠 봐야 합니다. 이 절이 기각한 것은 그중 ② S3 primary 하나입니다 — ① cold tier(우리가 고른 것), ② S3 primary, ③ 데이터레이크(Iceberg)의 3갈래 분리와 갈래별 판정은 [Iceberg·레이크하우스 §S3 메인의 세 갈래]({{< relref "/data/clickhouse/storage/09-iceberg-lakehouse.md" >}})에서 다룹니다. 특히 ②를 검토하려는 독자가 자료에서 만나는 `S3BackedMergeTree`라는 이름이 등록된 엔진명이 아니라는 정정도 그 장에 있습니다. 라이터 failover가 OSS로 들어올 조짐과 그때의 재검토 트리거는 [Managed vs Self-hosted]({{< relref "/data/clickhouse/deployment/01-managed-vs-selfhosted.md" >}})에 적어 뒀습니다.

## 티어링 설계 — OpenSearch와 같은 구조인가

현재 OpenSearch는 hot 10×i7i.4xlarge와 UltraWarm 8노드를 사용합니다([OpenSearch 구성]({{< relref "/observability/logs/comparison/01-opensearch.md" >}})). 최근 데이터와 오래된 데이터를 나누는 방식은 ClickHouse에도 적용할 수 있습니다. 다만 UltraWarm의 공유 S3 사본과 RMT의 replica별 S3 사본은 비용 구조가 다릅니다. ClickHouse의 이동 TTL 예시는 `INTERVAL 7 DAY TO VOLUME 'cold'`이며, 이 구성에서는 NVMe와 S3 사이에 gp3 warm 티어를 추가하지 않습니다.

### 구조 대응표

겉보기 유사하나 사본 경제·쿼리 경로가 결정적으로 다릅니다.

- Hot 데이터노드(OpenSearch: 10× i7i.4xlarge.search, 로컬 색인 + replica) ↔ hot 볼륨(CH: 로컬 NVMe, RMT replica) — 둘 다 로컬 매체 + replica로 내구성을 삽니다. 거의 동일하니 직관이 옳습니다.
- UltraWarm(OpenSearch: 8노드, S3-backed + 캐시 레이어) ↔ S3 cold 볼륨(CH: `TTL MOVE TO VOLUME 'cold'` + filesystem cache) — 둘 다 오래된 데이터를 S3+로컬캐시로 서빙하지만 사본 경제는 반대입니다: UltraWarm=S3 단일 사본 / CH cold=replica별 사본.
- OR1/OR2(OpenSearch: EBS primary + 동기 S3, 11 nines·zero RPO — 로컬 NVMe 아님, NVMe 관리형은 OI2) `✓` ↔ ClickHouse Cloud SharedMergeTree(self-host 불가) — shared durable S3 + 컴퓨트 로컬 캐시 구조는 닮았으나 self-host RMT로는 재현하지 못합니다.

ClickHouse Cloud SharedMergeTree와 OpenSearch OR1도 공유 오브젝트 스토리지를 활용하지만 세부 구조는 다릅니다. self-host RMT의 S3 cold를 이런 관리형 구성과 같은 사본 비용으로 계산하지 않습니다 `✓`. (SharedMergeTree가 Cloud 전용인 배경은 [Managed vs Self-hosted]({{< relref "/data/clickhouse/deployment/01-managed-vs-selfhosted.md" >}}).)

### 결정적 차이 — S3 사본 경제

- UltraWarm은 warm 데이터를 S3에 1벌만 두고 warm 전용 노드가 그 공유 단일 사본을 캐시로 서빙하며 replica가 필요 없습니다(*"The durability of data in S3 removes the need for replicas … only one copy is needed"*) `✓` — shared-storage 모델입니다.
- CH self-host의 S3 cold는 cold 데이터도 replica마다 자기 S3 경로에 사본을 둡니다(shared-nothing). RF2면 S3에도 2벌입니다. zero-copy로 1벌로 줄이는 건 프로덕션 금지(위 §내구성 3종 세트)라 UltraWarm식 절감이 성립하지 않습니다 `✓`.
- "UltraWarm처럼 S3로 밀면 사본이 줄어 싸진다"는 기대는 틀립니다. self-host의 절감은 NVMe↔S3 GB단가 차이에서만 오고 사본 배수(RF)는 그대로 지불합니다.

사본 경제 말고도 다른 점이 있습니다 `✓`. 쿼리 경로: UltraWarm은 hot과 warm이 물리적으로 다른 노드여서 warm 쿼리가 hot 노드를 굶기지 않습니다(리소스 격리). CH self-host의 hot(NVMe)·cold(S3) 볼륨은 같은 서버에 붙어 한 쿼리가 두 티어를 투명하게 가로질러 읽으므로 컴퓨트 격리가 없습니다. rehydrate: UltraWarm은 다시 쓰려면 `_hot` API로 명시적 승격(shard relocation)이 필요합니다. CH의 S3 cold는 rehydrate 개념 없이 항상 online이라 쿼리가 닿으면 캐시 미스 시 S3에서 읽어 로컬 캐시에 자동 적재됩니다(노드 소실 후 replica 복구=재수화는 별개 개념, 아래 §노드 소실과 재수화).

### 티어링 ≠ 내구성

가장 위험한 오해가 여기 있습니다. self-host RMT에서 셋은 목적이 다르며 혼동하면 데이터를 잃습니다 `✓`:

| 수단 | 목적 |
|---|---|
| **복제**(RMT replica, 멀티AZ) | 가용성 + 내구성(노드/AZ 소실 방어) |
| **백업**(clickhouse-backup → S3 별도 버킷) | DR(실수 삭제·손상·논리 오류 복구) |
| **티어링**(TTL MOVE → S3 cold) | 비용·보존 확장(GB단가↓) |

- 티어링은 DR이 아닙니다. S3 cold로 옮긴 데이터도 살아있는 테이블의 일부라 `DROP`·잘못된 `ALTER`·논리 손상은 hot이든 cold든 똑같이 파괴합니다 — 별도 백업만이 복구합니다.
- cold 데이터의 물리 사본은 replica 수(RF) + 백업(1) 로 계상해야 공정합니다. "S3니까 싸다"는 맞지만 "1벌이라 싸다"는 틀립니다 — UltraWarm 단일 사본 경제와 헷갈리면 안 됩니다.

### gp3의 자리 · 권고 설계

- gp3는 티어링 매체가 아니라 Keeper 데이터 디스크입니다(영속 필요, 위 §내구성 3종 세트). 관측성 표준과 ClickHouse 공식 플레이북 모두 hot NVMe + S3 cold 2티어를 권하고 gp3 warm 중간 티어를 언급조차 않습니다 — Altinity도 *"no reason to have more than 1-3 gp3 volume per node"*라며 볼륨 단순화를 권합니다 `✓`. NVMe+gp3+S3 3티어를 동시에 굴릴 실익은 대개 없습니다(PostHog만 예외적으로 S3 없이 NVMe hot→EBS warm 2티어를 수동 운영 `✓`).
- 권고 티어링 설계(내구성 3종 세트와 별개로 둡니다):

```
storage_policy 'hot_to_s3'
  volume 'hot'  = 로컬 NVMe(i7i/i8g)                  ← 최근 데이터
  volume 'cold' = S3 disk + cache disk(로컬 LRU 캐시)  ← 오래된 데이터

TTL (관측성 예)
  timestamp + INTERVAL 7   DAY TO VOLUME 'cold'   -- 7일 후 S3로 이동
  timestamp + INTERVAL 365 DAY DELETE             -- 365일 후 삭제

hot 볼륨 : move_factor 0.1 (기본값 유지 = 여유 <10%일 때 개입하는 안전판)
S3 cold  : prefer_not_to_merge 미설정 — 병합은 hot에서 끝내고 이동
캐시     : cache_on_write 활성 (없으면 cold 쿼리가 S3 지연에 직접 노출)
```

- 주 이동은 시간 기반 TTL MOVE로 합니다. `move_factor`는 hot이 가득 차 머지·인서트가 멈추는 것을 막는 안전판으로만 씁니다(어떤 파트가 먼저 갈지 보장 못 하고 갓 인서트한 데이터가 곧장 S3로 갈 수도 있습니다) `✓`. 값은 기본 0.1을 유지합니다 — `move_factor`는 "여유 공간이 `move_factor × 볼륨크기` 아래로 떨어지면 다음 볼륨으로 이동 시작"이라는 여유 공간 임계 비율이지 사용률이 아닙니다 `✓`. 0.1은 "~90% 찼을 때 개입"입니다. 흔히 보이는 `0.9`는 "여유<90%(=10%만 차도) 즉시 이동"이라 hot에 갓 들어온 최근 데이터까지 곧장 S3로 밀어내 "hot=최근 N일" 목적 자체를 깨뜨립니다 — 값–설명 불일치입니다. 값별 환산표와 공식 문구는 [HyperDX · S3 콜드 티어링 §1.3]({{< relref "/observability/hyperdx/design/03-s3-cold-tiering/index.md" >}})에 정리돼 있습니다. `prefer_not_to_merge=true`는 작은 파트 폭증 → TOO_MANY_PARTS를 부르니 기본값(false)을 유지합니다 `✓`.

OpenSearch에서 쓰던 운영 방식을 가져올 때 달라지는 부분을 정리하면 다음과 같습니다.

| 명제 조각 | 판정 |
|---|---|
| "로컬 NVMe라도 실데이터를 전부 로컬에 두면 안 된다" | ✅ 맞다 — hot엔 최근 데이터만, 나머지는 티어링 |
| "gp3 **혹은** S3에 티어링" | △ 절반 — 관측성/대규모는 S3, gp3는 Keeper용. 3티어는 불필요 |
| "OpenSearch(hot i7i + UltraWarm)와 동일 구조" | ❌ 부정확 — UltraWarm=단일사본, CH cold=replica별 사본 |
| (암묵) "S3로 티어링하면 내구성이 해결된다" | ❌ 위험 — 내구성은 복제+백업. cold도 RF배수로 중복 저장 |

## 로컬 PV를 k8s에 얹기

instanceStorePolicy: RAID0은 ephemeral-storage 스케줄링 인식용입니다. Karpenter EC2NodeClass에 `instanceStorePolicy: RAID0`를 설정하면 노드의 로컬 NVMe들이 자동으로 RAID0(`/dev/md/0`, 마운트 `/mnt/k8s-disks/0`)로 묶여 kubelet의 ephemeral-storage로 인식됩니다 — 이 설정이 없으면 Karpenter가 instance-store를 스케줄링 시 고려하지 않습니다 `✓`. 이렇게 묶인 배열은 ephemeral일 뿐입니다. ClickHouse 데이터 PV에는 별도 provisioner가 필요하고 전용 데이터 노드라면 instanceStorePolicy를 아예 쓰지 않는 편이 낫습니다(아래 § 참조). Bottlerocket은 Karpenter v1.1.0+부터 자동 구성됩니다.

마운트된 NVMe 위에 local PV provisioner를 올립니다. 공통적으로 로컬 스토리지는 데이터 경로 오버헤드가 없어(컨테이너 없이 직접 쓰는 것과 동일 throughput) 성능이 좋습니다. 그래도 노드 장애 = 해당 볼륨/데이터 소실이라는 성질은 도구가 바꿔주지 않습니다 — 내구성은 위 3종 세트가 담당합니다.

| 도구 | 방식 | 스냅샷/LVM | 특징 |
|---|---|---|---|
| **Rancher local-path-provisioner** | hostPath 디렉토리 | 없음 | 가장 단순. 마운트된 NVMe(단일 또는 RAID0) 위에 바로 |
| **OpenEBS Hostpath LocalPV** | `/var/openebs/local` 하위 | 없음 | 설치 즉시 OOB, 오버헤드 없음 |
| **OpenEBS LVM LocalPV** | 노드 LVM VG에서 LV | **LVM 스냅샷/thin** | 여러 NVMe를 VG로 묶고 PV 동적 할당·온라인 확장 |
| **TopoLVM** | LVM + 용량 인식 스케줄링 | LVM | 용량 aware 스케줄링이 필요할 때 |

권고 `≈`: 전용 데이터 노드에는 설계 (A)(아래 §)가 깔끔합니다 — instanceStorePolicy 없이 userData로 NVMe를 포맷·마운트한 뒤 local-static-provisioner(AWS 공식 DB PV 레시피)로 노출하는 쪽입니다. 더 단순하게는 local-path-provisioner(마운트 위에 바로), 용량 인식 스케줄링·LVM 유연성이 필요하면 TopoLVM 또는 OpenEBS LVM LocalPV. Altinity operator는 local StorageClass + node affinity를 지원하지만 노드 소실 재수화는 operator가 해결하지 않으므로 replica·백업 설계는 여전히 사용자 몫입니다(operator 상세는 [clickhouse-operator]({{< relref "/data/clickhouse/deployment/03-operator.md" >}})).

### instanceStorePolicy는 ephemeral — ClickHouse 데이터는 PV가 필요하다

`instanceStorePolicy: RAID0`은 kubelet·containerd의 ephemeral-storage(emptyDir·컨테이너 레이어·pod 로그)를 위한 배열을 구성합니다 `✓`. Altinity operator의 데이터 볼륨은 `volumeClaimTemplates`에서 StorageClass와 PV를 참조하므로 별도 local PV provisioner가 필요합니다. AWS의 DB 레시피인 local-static-provisioner + `WaitForFirstConsumer`는 디스크 또는 배열 하나를 PV 하나로 노출합니다.

설계는 두 축입니다 `≈`: (A) NVMe를 PV 전용으로 헌납 — instanceStorePolicy를 쓰지 않고 userData로 포맷·마운트해 discovery 경로로만 노출하고 kubelet ephemeral은 루트 gp3에 둡니다(전용 데이터 노드에 깔끔, 권장). (B) 배열 공유 — instanceStorePolicy로 ephemeral을 NVMe에 두고 같은 마운트 하위를 PV로도 노출; 물리 디스크는 같아 성능은 나오지만 용량 이중계상으로 capacity 관리가 꼬여 전용 노드엔 비권장.

{{% details title="도입 버전·구버전 우회 — Karpenter 버전별 userData 부트스트랩 [확인됨]" closed="true" %}}
`instanceStorePolicy`는 Karpenter v0.34.0(2024-02-06) 부터 유효하고 `EC2NodeClass`(v1beta1)에만 존재합니다 — 구버전 `AWSNodeTemplate`(v1alpha5)에는 필드 자체가 없습니다. 필드가 없거나 (A)를 택해 안 쓰기로 했다면 `userData`로 NVMe를 직접 포맷·마운트합니다: AL2는 `/bin/setup-local-disks mount|raid0` 또는 수동 `mkfs.xfs`+`fstab`, AL2023은 nodeadm `NodeConfig`의 `localStorage.strategy: RAID0`(또는 MIME 스크립트), Bottlerocket은 `settings.bootstrap-commands`(단 Karpenter v1.1.0+는 자동 주입하므로 중복 시 부팅 실패). 이 userData + local PV provisioner 조합은 v1alpha5를 포함한 전 Karpenter 버전에서 동작합니다.
{{% /details %}}

{{< callout type="warning" >}}
단일 디스크 주의 `✓` — i7i/i8g.4xlarge는 NVMe가 1×3,750GB뿐입니다. RAID0는 ≥2 디스크 striping에서만 이득이라 단일 디스크엔 `mkfs.xfs` 후 직접 마운트하는 편이 단순하고 안전합니다. 신형 AL2023 AMI(≥v20250620)에서 단일 NVMe RAID0가 노드 부팅에 실패하는 회귀(issue #2386)까지 있어 더욱 그렇습니다. striping용 RAID0는 8xlarge+(2디스크↑)에서만 씁니다 — 4xlarge를 shard/replica로 넓게 펴는 편이 재수화·blast radius 관점에서도 유리합니다.
{{< /callout >}}

## Karpenter가 노드를 지우는 문제

로컬 NVMe 노드에서 가장 위험한 것은 하드웨어 장애가 아니라 Karpenter consolidation입니다. consolidation은 pod request만 보고 팩킹하므로 데이터 지역성·스토리지 제약을 무시하고 노드를 없앨 수 있습니다 — 로컬 스토리지 워크로드에 특히 치명적입니다 `✓`. `karpenter.sh/do-not-disrupt` 애노테이션도 voluntary disruption만 방지하고 expiration·Spot interruption·수동 삭제는 우회합니다 `✓`.

방어 조합:

- ClickHouse 데이터 pod에 `do-not-disrupt` + `consolidationPolicy: WhenEmpty`(또는 `consolidateAfter`를 10분+로 길게).
- On-Demand / Savings Plan 사용, Spot 데이터 노드 금지 — Spot 중단 → 노드 종료 → 로컬 NVMe 전소 → replica 재수화 비용이 할인분을 초과합니다. (요금·SP 할인은 [Managed vs Self-hosted]({{< relref "/data/clickhouse/deployment/01-managed-vs-selfhosted.md" >}}))
- 노드 expiration 비활성 또는 매우 길게, PDB `maxUnavailable: 1`, disruption budget으로 rate limit.
- taint(`dedicated=clickhouse:NoSchedule`) + toleration으로 전용 NodePool 격리, Keeper는 별도 소형 NodePool(gp3).
- 완전 안정성 우선이면 Karpenter 대신 고정 ASG/노드그룹 + local PV로 ClickHouse만 별도 운용합니다 — 노드 IP·디스크 안정성이 올라갑니다. Karpenter의 탄력성보다 stateful 안정성이 중요하다면 이쪽이 정답입니다.
- 업그레이드는 로컬 NVMe 도입의 전제가 아닙니다 `≈`. `instanceStorePolicy`는 ephemeral 전용이라 ClickHouse PV에는 어차피 안 씁니다(위 §로컬 PV). userData + local PV provisioner는 v1alpha5 포함 전 버전에서 동작합니다 — "로컬 디스크 때문에" Karpenter를 서둘러 올릴 이유는 없습니다. v1alpha5→v1 마이그레이션은 v0.32.x를 반드시 경유(alpha/beta dual, skip 불가)해 공수가 큽니다. 지원종료·CVE 대응 업그레이드는 스토리지 도입과 분리해 별도 유지보수로 계획합니다.

## 노드 소실과 재수화

노드가 소실되면 그 노드의 로컬 NVMe 데이터는 사라집니다. ClickHouse는 healthy replica에서 데이터를 다시 당겨옵니다(rehydration).

- 부분 복구: replica가 잠깐 빠졌다 복귀하면 lag를 감지해 누락 파트만 fetch하고 로컬에 남아있던 파트는 재다운로드 없이 re-attach합니다 `✓`. 수동으로는 `SYSTEM RESTART REPLICA` / `SYSTEM SYNC REPLICA`.
- 완전 소실(로컬 NVMe 전소한 신규 노드): 전체 데이터를 healthy replica에서 재전송합니다. 소요 ≈ (노드 데이터량) / (네트워크 대역). 예: 10TB를 25Gbps 링크로 → 이론상 ~1시간, 실전은 압축 해제·머지·디스크 쓰기로 수 시간 `≈`.
- TB당 정확한 재수화 시간은 공식 수치가 없습니다 `?` — 인프라·네트워크·머지 부하에 의존하므로 실환경 측정이 필수입니다.

노드당 45TB를 채운 뒤 한 대를 잃으면 그만큼의 데이터를 다시 받아야 합니다. RF2에서는 복구가 끝날 때까지 해당 shard에 사본 하나만 남습니다. 노드를 크게 만드는 대신 shard를 나눠 노드당 데이터를 줄이면 복구 대상도 줄일 수 있지만, shard 운영과 리샤딩 비용은 늘어납니다. 허용할 복구 시간 안에 들어오는 크기를 스테이징에서 측정해 정하는 편이 좋습니다.

{{< callout type="important" >}}
노드를 잃은 순간부터 새 replica가 파트를 받아 사본 수를 회복할 때까지를 재수화 위험 창(rehydration risk window)으로 둡니다 `≈`. 대략 `노드당 데이터량 / 재복제 실효 대역`으로 계산할 수 있습니다. RF2에서는 이 시간 동안 같은 shard의 남은 사본까지 잃으면 데이터를 복구할 원본이 없어집니다.

노드당 데이터를 줄이면 복구 시간을 줄일 수 있고, RF3를 사용하면 한 대 복구 중에도 두 사본이 남습니다. PDB는 자발적 중단을 제한하고 anti-affinity는 같은 노드 배치를 막지만 독립적인 하드웨어 장애를 방지하지는 않습니다. [배포 플레이북의 RF·쓰기 쿼럼 선택]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}})에서 비용과 쓰기 가용성을 함께 비교합니다.

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

관측성의 대량 ingest가 분석 쿼리 지연을 오염시키지 않도록 쿼리 패턴·보존정책이 다르면 관측성용과 범용 분석용을 별도 클러스터(또는 shard/DB)로 분리합니다.

## 로컬 NVMe 배포 전에 측정할 것 {#우리-케이스에서는}

로컬 NVMe 청사진은 RUM과 범용 분석을 함께 운영하며 충분한 데이터량·성능 요구·운영 인력을 갖춘 경우에 적용합니다. 현재 로그 저장소를 VictoriaLogs에서 옮기자는 결정은 아닙니다. [로깅 권장안]({{< relref "/observability/logs/comparison/08-recommendation.md" >}})의 로그·메트릭 경계와 모바일 RUM의 Datadog 잔류는 유지합니다.

이 조건에 맞으면 i8g를 우선 비교하고, x86 의존성이 있으면 i7i를 사용합니다. 데이터는 NVMe hot/S3 cold로 나누고 Keeper는 gp3에 둡니다. S3 cold에도 replica별 사본과 백업 비용을 계산하며 zero-copy replication에 의존하지 않습니다.

노드 크기와 RF2/RF3 선택은 복구 실측 뒤에 확정합니다. 노드 하나를 잃었을 때 재수화가 얼마나 걸리는지, 그동안 쓰기와 조회를 유지할 수 있는지 확인해야 합니다. Karpenter를 사용하면 자발적 중단 제한과 expiration을 함께 관리하고, 고정 노드그룹도 비교합니다.

[비용 비교]({{< relref "/data/clickhouse/deployment/01-managed-vs-selfhosted.md" >}}), [operator 선택]({{< relref "/data/clickhouse/deployment/03-operator.md" >}}), [다른 데이터스토어의 복구 사례]({{< relref "/data/clickhouse/storage/07-local-nvme-datastore-patterns.md" >}})를 함께 검토한 뒤 배포합니다. 시점 기준 2026-08.
