---
title: "Managed vs Self-hosted — TCO 크로스오버"
date: 2026-07-13
lastmod: 2026-08-24
weight: 1
url: "/clickhouse/01-managed-vs-selfhosted/"
---

# Managed vs Self-hosted — TCO 크로스오버

ClickHouse를 직접 운영하면 서버 요금은 줄일 수 있어도 복제, 백업, 업그레이드 작업은 팀에 남습니다. Cloud와 self-host의 비용을 비교할 때 이 시간을 빼면, 월 청구서는 낮아졌는데 운영 부담은 더 커지는 선택을 하기 쉽습니다.

이 글의 20TB·24시간 가동 예시에서는 self-host 인프라가 월 약 $3,221, Cloud Scale이 약 $3,627입니다. 차이는 약 $406인데, 자체 운영에 드는 시간을 월 $1,600~4,800으로 잡으면 결과가 바뀝니다 `≈`. 다만 이 비용표에는 S3 복제 사본 산정 문제가 남아 있습니다. 아래에서 계산 조건과 함께 설명합니다. 20TB를 보편적인 손익분기점으로 쓰기는 어렵습니다.

배포 형태에 따라 엔진도 달라집니다. Cloud의 SharedMergeTree는 공유 오브젝트 스토리지에서 컴퓨트를 늘리고 줄입니다. 이 글에서 검토하는 self-host HA 구성은 ReplicatedMergeTree(RMT)로 각 replica의 사본을 운영합니다. 가격표를 보기 전에 이 차이가 우리 확장 방식에 어떤 작업을 남기는지 알아둘 필요가 있습니다. 인스턴스 사양은 [로컬 NVMe & 인스턴스]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})에 정리했습니다.

## SharedMergeTree라는 갈림길 — Cloud 전용 제약

RMT 기반 self-host 클러스터에서는 서버마다 쿼리를 실행하고 데이터 파트를 보관합니다. ClickHouse Cloud는 durable 데이터를 S3/GCS에, 조정 메타데이터를 Keeper에 두고 컴퓨트를 분리합니다 `✓`. SharedMergeTree를 쓰면 서버를 추가할 때 각 replica에 전체 사본을 채우는 부담을 줄일 수 있습니다.

RMT는 replica마다 파트 사본을 두고 서로 통신합니다. SharedMergeTree는 공유 스토리지와 Keeper로 조정해 replica 간 직접 통신을 줄입니다. scale-up/down, mutation, merge와 다수 replica 확장을 지원하는 구조입니다 `✓`.

SharedMergeTree는 Cloud 전용입니다. self-host의 zero-copy-S3는 실험 등급이며 프로덕션에 사용할 수 없습니다. #45346의 데이터 파트 소실 사례가 있고 22.8부터 기본 비활성입니다. 26.8 dev에도 `EXPERIMENTAL`로 남아 있으며 #95597·#96965 등의 회귀가 보고됐습니다 `✓`. Tinybird는 deprecated라고 표현하지만 코드에서 제거된 기능으로 설명하지는 않습니다 `Ⓥ`. 자세한 이력은 [스토리지의 zero-copy 설명]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})에 있습니다.

OSS의 `plain_rewritable`(24.4/24.5)과 readonly part refresh(25.4, `refresh_parts_interval`·`table_disk`, PR #76467)는 단일 라이터와 읽기전용 리더를 구성하는 경로입니다 `✓`. mutation과 테이블 복제를 지원하지 않아 RMT를 사용하는 현재 HA 설계에는 적용하지 않았습니다. 제약과 회귀는 [S3 primary 검토]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})에서 다룹니다.

이 글의 self-host 구성에서는 shard 추가 시 데이터 재분배를 직접 계획하고, replica마다 hot 디스크와 S3 cold 사본을 유지합니다. RF2면 S3에도 두 벌을 저장합니다. HyperDX/ClickStack을 이 구성에 연결할 때도 같은 RMT 운영 부담을 갖습니다. Cloud의 SharedMergeTree와 self-host의 로컬 NVMe는 배포 방식이 다르므로 각각의 성능·비용을 비교해야 합니다.

### SharedMergeTree 주변의 Cloud 구성요소 {#cloud가-파는-것은-엔진-하나가-아니다--부품-4개--유일한-자체-인프라-경로}

Cloud의 확장 동작은 SharedMergeTree와 주변 구성요소가 함께 만듭니다. 엔진 외에도 공유 카탈로그, 분산 캐시, 노드 프로비저닝이 필요합니다. 따라서 엔진의 공개 여부만으로 동일한 운영 환경을 만들 수 있다고 보기는 어렵습니다.

| 부품 | 무엇을 하나 | self-host 가용성 |
|---|---|---|
| **SharedMergeTree** | 공유 스토리지 + Keeper 조정 기반 엔진 | Cloud 전용(proprietary) `✓` |
| **Shared Catalog · shared database engine** | 스키마·DDL을 컴퓨트 밖에서 공유 | Cloud 전용 `✓` |
| **Distributed Cache** | 컴퓨트 노드 밖의 공유 캐시 계층 | Cloud 전용. 서울에는 Express One Zone 자체가 없어 전제 조건부터 다르다 `✓` |
| **무디스크 프로비저닝** | 노드에 상태를 두지 않아 즉시 늘리고 줄인다 | Cloud 전용 `✓` |

자기 인프라에서 SharedMergeTree를 합법적으로 돌리는 유일한 경로는 ClickHouse Private입니다 — AWS는 GA, GCP는 preview이고 가격·조건이 공개돼 있지 않아 영업 문의를 거쳐야 합니다 `✓`. BYOC와 혼동하기 쉽지만 BYOC는 data plane이 고객 VPC에 상주하는 관리형 제품이고 Private는 그와 별개의 배포 형태입니다. 우리 조사 범위에서는 이 경로의 요금·최소 커밋을 확인하지 못했습니다 `?`.

### OSS 라이터 장애 전환의 개발 상태 {#라이터-failover가-oss로-오는-중--재검토-트리거}

OSS의 라이터 장애 전환 지원은 계속 확인할 항목입니다. S3·Azure 조건부 쓰기(If-Match·If-None-Match)로 lease를 잡아 `leader_election`을 구현하는 작업이 이슈 #91613(2025-12-06)에서 시작됐습니다. PR #101039는 2026-08-09 확인 당시 open 상태이며 heartbeat 10s·session_timeout 30s를 제안합니다 `≈`. 아직 릴리스된 기능으로 간주하지 않습니다 `?`.

재검토 트리거는 미리 적어 둡니다: (1) 위 PR이 머지돼 릴리스에 실려 나오고, (2) `plain_rewritable`의 복제·mutation 배타가 함께 풀리고, (3) 우리 워크로드가 여전히 "S3 1벌 + 컴퓨트 캐시"에서 이득을 보는 규모일 때 — 세 조건이 함께 서야 합니다. 하나만 서면 트리거가 아닙니다. 목표 릴리스가 26.8이라는 관측이 있으나 근거가 약해 추정으로만 둡니다 `?`.

## Managed 옵션 비교

관리형 서비스 안에서도 운영 주체와 데이터 위치가 다릅니다. 고객 VPC에 데이터를 둬야 하는지, 로컬 NVMe를 직접 선택해야 하는지에 따라 후보가 좁혀집니다.

| 항목 | ClickHouse Cloud | ClickHouse Cloud **BYOC** | **ClickHouse Private** | Altinity.Cloud Anywhere | Aiven for ClickHouse |
|---|---|---|---|---|---|
| 엔진 | SharedMergeTree | SharedMergeTree | **SharedMergeTree** `✓` | ReplicatedMergeTree(OSS operator) | ReplicatedMergeTree(OSS) |
| storage-compute 분리 | 완전분리(object storage) | 완전분리(고객 VPC S3) | 완전분리 | 로컬/EBS+S3 tier(선택) | 플랜별(로컬) |
| 데이터 위치 | ClickHouse 관리 VPC | **고객 VPC** | **고객 인프라** `✓` | **고객 VPC/k8s** | Aiven 관리 |
| k8s 위 배포 | N/A(serverless) | 관리형 data plane | 미확인 `?` | **고객 EKS에 직접** | N/A |
| lock-in | 높음(egress fee) | 중간 | 높음(proprietary 엔진) | **낮음(OSS operator)** | 중간 |
| 로컬 NVMe 통제 | 불가 | 제한적 | 미확인 `?` | **가능** | 제한적 |
| HyperDX 호환 | 가능 | 가능 | 미확인 `?` | **매우 좋음** | 가능 |
| 최소 진입 | Basic $0.2181/unit-hr | 상담 | 영업 문의 전용 `✓` | 상담 | $190/mo |

- ClickHouse Cloud(SaaS): compute unit + storage + egress 과금. 1 compute unit = 8 GiB RAM + 2 vCPU, 티어별 $0.2181(Basic)~$0.3903(Enterprise)/unit-hr, storage $25.30/TB-mo `✓`. 유휴 시 scale-to-zero. 단 2025-01 개편으로 egress fee 신설(퍼블릭 $0.1152/GB, cross-region $0.0312/GB)이라 마이그레이션 비용이 크게 오릅니다 `✓`.
- ClickHouse Cloud BYOC (2025-02-20 AWS GA `✓`): data plane(compute+storage)이 고객 VPC에 상주하고 control plane만 ClickHouse VPC에 둡니다. 데이터가 VPC를 안 벗어나 규제·PII 심사가 쉽고 고객의 RI/SP 할인을 인프라에 그대로 적용하며 앱↔CH egress가 사라집니다. compute unit 요금은 SaaS와 동일하며 BYOC 전용 관리비/최소 커밋은 공식 미공개 `?`.
- ClickHouse Private: 자기 인프라에서 SharedMergeTree를 돌리는 유일한 합법 경로입니다(AWS GA·GCP preview) `✓`. 가격·조건이 비공개라 영업 문의를 거쳐야 하고 이 조사에서 요금·최소 커밋·k8s 배치 형태는 확인하지 못했습니다 `?`. 위 §부품 4개 참고.
- Altinity.Cloud Anywhere: OSS Altinity operator를 고객 k8s에 배치하고 관리 plane에 "꽂는" BYOK 방식. 기존 클러스터 흡수 가능, 데이터는 고객 VPC 잔류. OSS operator를 그대로 쓰므로 lock-in이 가장 약하고 관리를 넘겼다 self-manage로 회수하기 쉽습니다. 로컬 NVMe + RMT 구성과 자연스럽게 호환.
- Aiven: all-inclusive 시간당 과금($190/mo부터) `✓`, 70+ region 멀티클라우드. SharedMergeTree 미사용(OSS RMT). 멀티클라우드 통합 관리가 강점이나 로컬 NVMe 통제·성능 극대화는 제한적.

### Managed 요금 구조 — 단가 검증

{{< callout type="warning" >}}
스토리지 백업 이중과금 — 명목 $25.30/TB-mo는 맞지만 기본 백업이 별도 과금됩니다. 공식 예시가 "1TB 압축 + 백업1 = $50.60/mo"로 명시 → 실효 ~$50.60/TB-mo `✓`. self-host의 "replica 2배 + S3 백업"과 공정 비교하려면 Cloud storage를 $25.30 × 2로 계상해야 합니다(아래 시나리오가 이를 반영).
{{< /callout >}}

BYOC / Altinity / Aiven 구조: BYOC는 "SaaS compute 단가 + 우리 인프라 위 + 우리 할인 적용" 구조라 인프라 실비를 낮출 수 있으나 여전히 SharedMergeTree용 compute unit 요금을 냅니다. Altinity는 노드 기반 관리비 + 고객 인프라(고객 S3), Aiven은 all-inclusive입니다. self-host(OSS)와의 근본 차이는 이 compute unit 요금·관리비의 유무입니다.

{{% details title="단가 역산 검증 — 공식 worked example로 확인" closed="true" %}}
ClickHouse Cloud 단가는 공식 worked example로 역산 검증됩니다 `✓`. 두 축(compute unit-hr, TB-mo)이 그대로 맞아떨어집니다.

| 티어 | 구성(공식 예시) | 공식 월 청구액 | 단가 역산 |
|---|---|---|---|
| Basic | 1 unit, 6h/day, 500GB | $39.91/mo | 1u×180h×$0.2181 ✓ |
| Scale | 2 unit, 24/7 | $436.95/mo | 2u×730h×$0.2985 ✓ |
| Enterprise | 8 unit, 24/7 | $2,285.60/mo | 8u×730h×$0.3903 ✓ |
{{% /details %}}

## Self-host 월 비용 모델

self-host 견적에는 데이터 노드 외에 Keeper, S3 보존·백업, 전송료와 운영 시간을 넣습니다. 아래 단가의 확인 표시는 `✓`, 이 단가를 조합한 견적은 `≈⁽계산 예시⁾`입니다.

> Self-host = Σ(데이터 노드) + Keeper + S3(cold+백업) + 전송 + People

- 데이터 노드: i8g/i7i 로컬 NVMe. 앵커로 i8g.4xlarge ≈ $1,002/mo, i8g.8xlarge ≈ $2,004/mo(on-demand) `✓`. 사이즈별 요금·IOPS 표는 [로컬 NVMe & 인스턴스]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})로 위임. vCPU 사이징 참고치로 ClickStack 가이드는 인제스트 10 MB/s당 1 vCPU, 쿼리는 1 QPS당 + 10 MB/s당 1 vCPU를 제시합니다(예: 인제스트+쿼리 100 MB/s → 약 40 vCPU) `Ⓥ`.
- Keeper 노드: 소형 범용(m7g.large ~$0.0714/hr, t4g.medium ~$0.0336/hr) + gp3 소량. 4GB RAM·gp3 영속 디스크면 충분합니다.
- S3 cold / 백업: S3 Standard $0.023/GB-mo(us-east-1) · $0.025/GB-mo(서울), Glacier Instant Retrieval $0.004/GB-mo `✓`. 우리 배포 리전 기준 단가·배수는 [HyperDX · hot 스토리지]({{< relref "/observability/hyperdx/design/02-hot-storage-ebs/index.md" >}})에 정리돼 있습니다.
- People TCO: 월 $1,600~4,800(주 4~8시간 유지보수 × $100~150/hr) `≈`.

견적에서 큰 비중을 차지하는 것은 데이터 노드입니다. 이 예시처럼 노드 비용이 전체의 80~90%라면 Savings Plan 적용 여부가 총액을 크게 바꿉니다. replica를 늘리면 노드와 스토리지도 함께 늘고, S3 cold tier로 hot 데이터를 줄이면 필요한 로컬 디스크 용량을 낮출 수 있습니다.


## TCO 크로스오버 — 숫자로

세 시나리오의 월 인프라 비용 대조입니다. 모든 총액은 계산 예시 `≈`이고 재료 단가는 `✓`입니다. Cloud storage는 백업 이중과금을 반영해 $25.30 × 2로 계상하고 self-host는 hot=로컬 NVMe / cold=S3 / 데이터 노드는 i8g 기준입니다.

| 데이터 / 사용 패턴 | Self-host 인프라 | Cloud 인프라 | 인프라 우위 | 결정 요인 |
|---|---|---|---|---|
| **~5TB, 간헐(~12h×5d)** | ~$1,161/mo | ~$468/mo | **Cloud가 낮음** | scale-to-zero vs 최소 2 replica 고정비 |
| **~20TB, 24-7** (예상 구간) | ~$3,221/mo (1yr SP) | ~$3,627/mo (Scale) | **self-host 근소** | **people TCO** ($1.6~4.8k) |
| **60TB+, 24-7** | ~$7,335/mo (3yr SP) | ~$8,266/mo | **self-host 인프라가 낮음** | 규모의 경제 + SP + S3 cold |

간헐적으로 쓰는 5TB 예시에서는 self-host의 상시 가동 노드가 고정비로 남습니다. 20TB 예시의 인프라 차이는 운영 인건비보다 작습니다. 60TB 예시에서도 Cloud와 self-host의 인프라 차이는 약 $931이므로, 인력 비용을 포함한 총액까지 self-host가 더 싸다고 단정할 수는 없습니다. Savings Plan 약정과 hot/cold 비율이 달라져도 결과는 변합니다.


### 접전 구간(~20TB) 컴포넌트 분해

결정이 실제로 달라지는 시나리오만 뜯어봅니다(20TB 압축, 24-7, hot 6TB / cold 14TB). 총액은 `≈⁽계산 예시⁾`.

| 항목 | Self-host (i8g) | Cloud Scale | Cloud Enterprise |
|---|---|---|---|
| 컴퓨트 | 4×i8g.4xlarge (2 shard×2 replica) = $4,009 | 12u×730h×$0.2985 = $2,615 | 12u×730h×$0.3903 = $3,419 |
| Keeper | 3×m7g.large + gp3 = $164 | — | — |
| cold tier | 14TB×$0.023 = $322 | (포함) | (포함) |
| 백업 | 20TB Glacier IR = $80 | (스토리지 ×2에 포함) | (포함) |
| 스토리지 | (hot=NVMe 포함) | 20TB×$25.30×2 = $1,012 | $1,012 |
| 전송(추정) | $250 | egress 별도 | egress 별도 |
| **인프라 소계** | **~$4,824 (on-demand) / ~$3,221 (1yr SP)** | **~$3,627** | **~$4,431** |
| People | +$1,600~4,800 | ~$0 | ~$0 |

이 표는 원래 계산 예시를 보존했습니다. 다만 RMT RF2라면 cold 14TB도 두 사본으로 계산해야 하는데, 표에는 $322 한 벌만 반영돼 있습니다. Cloud의 People ~$0 역시 DB 인프라 운영의 추가 비용을 생략한 가정이며, 쿼리·스키마·비용 관리는 남습니다. 이 소계를 그대로 구매 견적으로 사용하지 않습니다.

Improvado의 예시도 10TB에서는 Cloud $1,580 vs self-host $2,450, 50TB에서는 Cloud $11,240 vs self-host $8,985로 규모에 따라 결과가 바뀝니다 `≈`. 다만 서로 다른 구성의 견적이므로 20TB라는 보편적 교차점을 증명하지는 않습니다. 기존 EKS 운영팀이 추가할 작업량과 이 표의 누락 비용을 반영해 다시 계산해야 합니다.

## 운영 인력과 실제 쿼리 성능을 함께 비교하기 {#판단-기준--데이터-크기가-아니라-인력}

운영 인력이 이미 EKS와 관측성 시스템을 관리하고 있다면 self-host를 추가할 때 드는 시간을 추정해볼 수 있습니다. 새로 전담자를 확보해야 한다면 서버 요금 차이로 그 비용을 충당할 수 있는지부터 계산해야 합니다. Improvado·Tinybird의 팀 규모 기준(<5명은 Cloud, 전담 인프라 엔지니어를 포함한 10명+는 self-host)은 이 차이를 설명하는 정성적 참고입니다 `✓⁽정성⁾`.

스토리지 성능은 실제 쿼리로 비교해야 합니다. i7i/i8g의 3.75TB Nitro SSD 한 개는 random read 600,000 / write 330,000 IOPS 사양을 제공합니다 `✓`. gp3에서 read IOPS 수치만 맞추려면 80,000 IOPS 볼륨 8개와 월 약 $3,380(IOPS $3,080 + 스토리지 $300)가 필요하다는 계산입니다. 그래도 i7i.8xlarge의 EBS 대역 약 1,250 MB/s에 제한됩니다 `≈`. 이 비교는 디스크 사양의 차이를 보여주며, 캐시와 CPU까지 포함한 Cloud 쿼리 성능을 직접 측정한 결과는 아닙니다.

로컬 NVMe를 선택한다면 i8g가 기본 후보입니다. i7i와 드라이브 IOPS 사양이 같고 비교 단가는 약 9% 낮습니다 `✓`. ClickHouse는 ARM64 바이너리를 제공하므로 사이드카·에이전트까지 ARM에서 동작하는지 확인하면 됩니다. x86 의존성이 남아 있으면 i7i를 검토합니다. [인스턴스와 내구성 설계]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}}), [Altinity operator]({{< relref "/data/clickhouse/deployment/03-operator.md" >}})에서 배포 조건을 이어 설명합니다.

## 적합 / 부적합

데이터가 5TB 안팎이고 사용 시간이 불규칙하거나, DB 운영을 맡을 사람이 없다면 관리형 서비스부터 검토합니다. SharedMergeTree의 빠른 확장이 필요할 때도 Cloud 계열이 후보입니다. 데이터를 고객 VPC에 남겨야 한다면 BYOC와 Altinity.Cloud Anywhere의 운영 범위·계약 조건을 비교합니다.

상시 부하가 있고 로컬 NVMe 성능이 필요하며 팀이 장애 복구를 맡을 수 있다면 self-host를 검토할 이유가 생깁니다. 1년 이상 Savings Plan을 약정할 수 있는지, S3 비용에 복제·백업 사본을 모두 반영했는지도 함께 확인합니다.

아직 여러 신호를 같은 팀이 운영할 이유가 정해지지 않았다면 배포 형태를 고르는 일도 미룹니다. 저장소 통합 자체의 필요성과 운영 담당자가 정해져야 비용 비교가 실제 선택으로 이어집니다.

## 실제 견적에 반영할 조건 {#우리-케이스에서는}

이 글의 self-host 검토는 RUM 대체와 범용 분석을 함께 운영하고, 인프라 인력을 이미 보유했다는 전제에서 시작했습니다. 로그만 옮기는 경우에는 [VictoriaLogs]({{< relref "/observability/logs/comparison/03-victorialogs.md" >}})와 VictoriaMetrics를 유지한다는 [로깅 권장안]({{< relref "/observability/logs/comparison/08-recommendation.md" >}})을 따릅니다.

그 전제가 충족되고 데이터가 20TB 이상으로 커진다면 i8g + 1yr Savings Plan + hot NVMe/S3 cold + Altinity operator를 견적 후보로 둡니다. 채택 전에는 표에 빠진 cold 복제 비용을 보정하고 운영 시간과 실제 쿼리 성능을 측정해야 합니다. 인력이 있다는 이유만으로 추가 운영비가 없어지는 것은 아닙니다.

데이터가 5TB 안팎에 머물거나 로컬 디스크 성능이 필요하지 않다면 Cloud도 계속 비교합니다. BYOC는 고객 인프라 할인 적용이 가능하지만 관리비와 최소 약정이 공개되지 않아 SaaS보다 싸다는 결론은 계약 견적을 받아야 낼 수 있습니다. 시점 기준 2026-08.
