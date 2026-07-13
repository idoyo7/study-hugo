---
title: "Managed vs Self-hosted — TCO 크로스오버"
weight: 1
---

# Managed vs Self-hosted — TCO 크로스오버

ClickHouse를 어디에 얹을지는 데이터 크기가 아니라 **운영 인력을 이미 보유했는지**로 갈린다. 데이터가 ~5TB에 머물고 사용이 간헐적이면 Cloud가 압승하고, 60TB+ / 24-7이면 self-host가 명확히 싸다. 진짜 접전 구간(~20TB / 24-7)에서 인프라 비용은 거의 붙어서, 결정을 가르는 건 월 $1,600~4,800의 **people TCO** `[추정]`다. 인력이 이미 있으면 self-host의 유일한 약점이 상쇄돼 성능·비용 모두에서 앞선다.

여기에 기술적 갈림길이 하나 더 겹친다. **SharedMergeTree(진짜 storage-compute 분리)는 ClickHouse Cloud 전용**이고 `[확인됨]`, self-host는 ReplicatedMergeTree(RMT)를 강제당한다. 즉 "managed냐 self-host냐"는 단순 가격 비교가 아니라 **아키텍처 선택**이다. 이 페이지는 그 결정 기준을 다룬다. 인스턴스·스토리지 상세는 [로컬 NVMe & 인스턴스]({{< relref "02-storage-local-nvme.md" >}})로 위임한다.

## SharedMergeTree라는 갈림길 — Cloud 전용 제약

전통적 self-host ClickHouse는 쿼리와 스토리지를 한 서버가 함께 지는 shared-nothing 구조다. ClickHouse Cloud는 이걸 뒤집어 compute를 **stateless 인스턴스**로, durable 데이터를 전부 **object storage(S3/GCS)**에, 메타데이터를 **ClickHouse Keeper**에 둔다 `[확인됨]`. 이 아키텍처가 **SharedMergeTree** 엔진이다.

- RMT는 replica마다 데이터 파트 **전체 사본**을 들고 replica 간 직접 통신한다. SharedMergeTree는 replica 간 통신이 없고 모든 조정이 공유 스토리지 + Keeper 경유(asynchronous leaderless)라 scale-up/down·mutation·merge가 빠르고, 테이블당 수백 replica까지 shard 없이 확장된다 `[확인됨]`.
- **핵심 제약**: SharedMergeTree는 proprietary·Cloud 전용이고, self-host의 zero-copy-S3는 사실상 폐기됐다(데이터 손상 이력, 22.8부터 default off) `[확인됨]`. 결과적으로 **self-host는 "S3 위 stateless compute"를 재현할 수 없다.**
- 그 대가가 self-host의 운영 형태를 규정한다 — 스케일아웃 = **리샤딩**이고, RF2를 쓰면 S3 tier에서도 사본이 두 배가 되며, 내구성은 디스크가 아니라 **replica로 직접 확보**해야 한다 `[확인됨]`. 로컬 디스크 복제(RMT) + 선택적 S3 cold tier 조합이 정석이다([RMT 내구성 설계]({{< relref "02-storage-local-nvme.md" >}}) 참고).
- **HyperDX/ClickStack 연동 제약**: ClickStack self-host는 SharedMergeTree를 못 쓰므로 **반드시 RMT** 위에 얹힌다 `[확인됨]`. SharedMergeTree 이점(빠른 스케일·리샤딩 불필요)을 원하면 managed 중 **ClickHouse Cloud(BYOC 포함)**만이 제공한다. 로컬 NVMe로 성능을 극대화하는 self-host 전략과 SharedMergeTree는 **동시에 가질 수 없다.**

## Managed 옵션 비교

self-host를 접기로 하면 후보는 넷이다. 데이터 거버넌스(데이터가 우리 VPC를 벗어나면 안 됨)와 lock-in이 실질적 선택축이다.

| 항목 | ClickHouse Cloud | ClickHouse Cloud **BYOC** | Altinity.Cloud Anywhere | Aiven for ClickHouse |
|---|---|---|---|---|
| 엔진 | SharedMergeTree | SharedMergeTree | ReplicatedMergeTree(OSS operator) | ReplicatedMergeTree(OSS) |
| storage-compute 분리 | 완전 분리(object storage) | 완전 분리(고객 VPC 내 S3) | 로컬/EBS + S3 tier(선택) | 플랜별(로컬 스토리지) |
| 데이터 위치 | ClickHouse 관리 VPC | **고객 VPC** | **고객 VPC/k8s** | Aiven 관리 |
| k8s 위 배포 | N/A(serverless) | 관리형 data plane | **고객 EKS에 직접** | N/A |
| lock-in | 높음(egress fee) | 중간 | **낮음(OSS operator)** | 중간 |
| 로컬 NVMe 통제 | 불가 | 제한적 | **가능** | 제한적 |
| HyperDX 호환 | 가능 | 가능 | **매우 좋음** | 가능 |
| 최소 진입 | Basic $0.2181/unit-hr | 상담 | 상담 | $190/mo |

- **ClickHouse Cloud(SaaS)**: compute unit + storage + egress 과금. 1 compute unit = 8 GiB RAM + 2 vCPU, 티어별 $0.2181(Basic)~$0.3903(Enterprise)/unit-hr, storage $25.30/TB-mo `[확인됨]`. 유휴 시 scale-to-zero. 단 **2025-01 개편으로 egress fee 신설**(퍼블릭 $0.1152/GB, cross-region $0.0312/GB) — 마이그레이션 비용이 크게 오른다 `[확인됨]`.
- **ClickHouse Cloud BYOC (2025-02-20 AWS GA `[확인됨]`)**: data plane(compute+storage)이 **고객 VPC**에 상주하고 control plane만 ClickHouse VPC에 둔다. 데이터가 VPC를 안 벗어나 규제·PII 심사가 쉽고, 고객의 RI/SP 할인을 인프라에 그대로 적용하며 앱↔CH egress가 사라진다. compute unit 요금은 SaaS와 동일하며 **BYOC 전용 관리비/최소 커밋은 공식 미공개** `[미확인]`.
- **Altinity.Cloud Anywhere**: OSS Altinity operator를 고객 k8s에 배치하고 관리 plane에 "꽂는" BYOK 방식. 기존 클러스터 흡수 가능, 데이터는 고객 VPC 잔류. **OSS operator를 그대로 쓰므로 lock-in이 가장 약하고**, 관리를 넘겼다 self-manage로 회수하기 쉽다. 로컬 NVMe + RMT 구성과 자연스럽게 호환.
- **Aiven**: all-inclusive 시간당 과금($190/mo부터) `[확인됨]`, 70+ region 멀티클라우드. SharedMergeTree 미사용(OSS RMT). 멀티클라우드 통합 관리가 강점이나 로컬 NVMe 통제·성능 극대화는 제한적.

### Managed 요금 구조 — 단가 검증

ClickHouse Cloud 단가는 공식 worked example로 역산 검증된다 `[확인됨]`. 두 축(compute unit-hr, TB-mo)이 정확히 맞아떨어진다.

| 티어 | 구성(공식 예시) | 공식 월 청구액 | 단가 역산 |
|---|---|---|---|
| Basic | 1 unit, 6h/day, 500GB | $39.91/mo | 1u×180h×$0.2181 ✓ |
| Scale | 2 unit, 24/7 | $436.95/mo | 2u×730h×$0.2985 ✓ |
| Enterprise | 8 unit, 24/7 | $2,285.60/mo | 8u×730h×$0.3903 ✓ |

- **주의 — 스토리지 백업 이중과금**: 명목 $25.30/TB-mo는 맞지만 **기본 백업이 별도 과금**된다. 공식 예시가 "1TB 압축 + 백업1 = $50.60/mo"로 명시 → 실효 **~$50.60/TB-mo** `[확인됨]`. self-host의 "replica 2배 + S3 백업"과 공정 비교하려면 Cloud storage를 **$25.30 × 2**로 계상해야 한다(아래 시나리오가 이를 반영).
- **BYOC / Altinity / Aiven 구조**: BYOC는 **"SaaS compute 단가 + 우리 인프라 위 + 우리 할인 적용"** 구조라 인프라 실비를 낮출 수 있으나 여전히 SharedMergeTree용 compute unit 요금을 낸다. Altinity는 노드 기반 관리비 + 고객 인프라(고객 S3). Aiven는 all-inclusive. self-host(OSS)와의 근본 차이는 이 **compute unit 요금·관리비의 유무**다.

## Self-host 월 비용 모델

self-host 총액은 컴포넌트 합이다. 단가는 `[확인됨]`, 조립 총액은 `[추정(계산 예시)]`.

> **Self-host = Σ(데이터 노드) + Keeper + S3(cold+백업) + 전송 + People**

- **데이터 노드**: i8g/i7i 로컬 NVMe. 앵커로 i8g.4xlarge ≈ $1,002/mo, i8g.8xlarge ≈ $2,004/mo(on-demand) `[확인됨]`. 사이즈별 요금·IOPS 표는 [로컬 NVMe & 인스턴스]({{< relref "02-storage-local-nvme.md" >}})로 위임.
- **Keeper 노드**: 소형 범용(m7g.large ~$0.0714/hr, t4g.medium ~$0.0336/hr) + gp3 소량. 4GB RAM·gp3 영속 디스크면 충분.
- **S3 cold / 백업**: S3 Standard $0.023/GB-mo, Glacier Instant Retrieval $0.004/GB-mo `[확인됨]`.
- **People TCO**: 월 $1,600~4,800(주 4~8시간 유지보수 × $100~150/hr) `[추정]`.

원가 동인 셋:

1. **데이터 노드가 총액의 80~90%** → **Savings Plan 적용 여부가 TCO를 좌우**한다.
2. **replica 수 = 스토리지·컴퓨트 배수**. RMT는 replica마다 전체 사본이라 2 replica면 노드·NVMe 2배. HA 최소 2, 권장 2~3.
3. **tiering이 절감 열쇠**. hot(NVMe)에는 최근 데이터만 두고 cold는 S3($0.023/GB)로 밀어 노드 수·크기를 줄인다 — 관측성 워크로드에 특히 유효.

## TCO 크로스오버 — 숫자로

세 시나리오의 월 인프라 비용 대조다. **모든 총액은 계산 예시** `[추정]`이고, 재료 단가는 `[확인됨]`이다. Cloud storage는 백업 이중과금을 반영해 **$25.30 × 2**, self-host는 hot=로컬 NVMe / cold=S3 / 데이터 노드는 i8g 기준.

| 데이터 / 사용 패턴 | Self-host 인프라 | Cloud 인프라 | 인프라 우위 | 결정 요인 |
|---|---|---|---|---|
| **~5TB, 간헐(~12h×5d)** | ~$1,161/mo | ~$468/mo | **Cloud 압승** | scale-to-zero vs 최소 2 replica 고정비 |
| **~20TB, 24-7** (예상 구간) | ~$3,221/mo (1yr SP) | ~$3,627/mo (Scale) | **self-host 근소** | **people TCO** ($1.6~4.8k) |
| **60TB+, 24-7** | ~$7,335/mo (3yr SP) | ~$8,266/mo | **self-host 명확** | 규모의 경제 + SP + S3 cold |

읽는 법:

- **~5TB 간헐**: self-host는 "24-7 켜둔 최소 2 replica NVMe 노드"라는 고정비 바닥이 있어 진다. Cloud는 유휴 시 compute $0 → **압승** `[추정]`.
- **~20TB 24-7**: 인프라만 보면 self-host(1yr SP $3,221)가 Cloud Scale($3,627)을 근소하게 앞선다. **그러나 people TCO를 더하면 역전**된다 — 여기가 진짜 크로스오버 지대다.
- **60TB+ 24-7**: Cloud compute는 데이터·동시성이 커질수록 unit-hour가 급증하는 반면 self-host는 노드 고정비 + 저렴한 S3 cold로 완만하게 는다. SP 할인까지 얹으면 self-host가 확연히 싸다 `[추정]`.

### 접전 구간(~20TB) 컴포넌트 분해

결정이 실제로 갈리는 시나리오만 뜯어본다(20TB 압축, 24-7, hot 6TB / cold 14TB). 총액은 `[추정(계산 예시)]`.

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

- **인프라만 보면 self-host(1yr SP)가 앞서지만, people를 더하면 역전**된다. Improvado의 유사 예시도 10TB에선 Cloud 우위(Cloud $1,580 vs self-host $2,450), 50TB에선 self-host 우위(Cloud $11,240 vs $8,985)로 **20TB가 교차점**임을 뒷받침 `[추정]`.
- 갈림의 핵심: 인력을 **새로 뽑아야** 하면 Cloud가 싸고, 인력이 **이미 EKS/관측성을 운영 중**이면 people 증분이 작아 self-host가 인프라 우위 그대로 실현 + 로컬 NVMe 성능까지 얻는다.
- **Spot은 데이터 노드 금지**: 중단 시 노드 종료 → 로컬 NVMe 전소 → replica 재수화. 데이터 노드는 On-Demand/Savings Plan 필수(1yr SP ≈ 40% 절감, 3yr ≈ 55%) `[추정]`.

## 판단 기준 — 데이터 크기가 아니라 인력

크로스오버 표에서 배워야 할 건 "몇 TB에서 넘어간다"가 아니라 **무엇이 결정을 가르느냐**다.

- **결정적 변수는 people TCO다.** Improvado·Tinybird 모두 팀 규모 inflection을 강조한다 — **팀 <5명이면 Cloud, 전담 DB/인프라 엔지니어를 낀 10명+면 self-host** `[확인됨(정성)]`. 데이터 크기는 부차적이고, self-host의 인프라 절감을 실현하려면 이미 그 인력이 있어야 한다.
- **성능이 하드 요구면 managed는 애초에 탈락한다.** self-host의 진짜 매력은 절감이 아니라 로컬 NVMe로만 살 수 있는 성능이다. i7i/i8g의 3.75TB Nitro SSD 드라이브 1개는 **random read 600,000 / write 330,000 IOPS**(드라이브 수에 선형) `[확인됨]`. 같은 성능을 gp3로 재현하려면 80,000 IOPS 볼륨 8개 + **월 ~$3,380**(IOPS 프로비저닝 $3,080 + 스토리지 $300)가 들고, 그래도 인스턴스 EBS 대역(i7i.8xlarge ≈ 1,250 MB/s)에 막혀 로컬 NVMe의 수 GB/s를 못 낸다 `[추정(계산)]`. 로컬 NVMe는 **스토리지 한계비용 $0**(인스턴스 요금에 포함)다. Cloud/BYOC(SharedMergeTree)는 object storage 기반이라 이 극한 성능 자체를 제공하지 않는다.
- **i8g 우선.** i8g(Graviton4)는 IOPS 스펙이 i7i와 동일하면서 ~9% 저렴하다 `[확인됨]`. ClickHouse가 ARM64 바이너리를 제공하고 "클럭보다 코어 수"를 선호하므로 Graviton 궁합도 좋다. x86 전용 의존(사이드카·에이전트 바이너리)이 있을 때만 i7i. 인스턴스 표·내구성 설계는 [로컬 NVMe & 인스턴스]({{< relref "02-storage-local-nvme.md" >}})와 [Altinity operator]({{< relref "03-operator.md" >}}) 참고.

배포 형태 결정 트리:

1. **데이터 거버넌스 + 운영 인력 최소화** → ClickHouse Cloud **BYOC**(SharedMergeTree + VPC 잔류) 또는 **Altinity.Cloud Anywhere**(lock-in 최소).
2. **성능 극대화(로컬 NVMe) + 비용 통제 + 자체 운영 역량 있음** → **EKS self-host + Altinity operator + i8g/i7i 로컬 NVMe**.
3. **빠른 시작 / 소규모 / 멀티클라우드** → **Aiven** 또는 ClickHouse Cloud(Scale).

## 적합 / 부적합

| | |
|---|---|
| **Managed(Cloud/BYOC/Aiven)이 적합** | 데이터 ~5TB 안팎이거나 간헐/버스티 사용, 전담 DB·인프라 인력이 없거나 팀 <5명, 운영 부담을 0에 두고 싶은 경우, SharedMergeTree의 빠른 스케일·리샤딩 불필요가 실이익인 경우. 데이터 거버넌스가 하드 요구면 순수 SaaS 대신 **BYOC / Altinity.Cloud Anywhere**(VPC 잔류) |
| **Self-host(EKS + 로컬 NVMe)가 적합** | 24-7 상시 포화 + 20TB+로 성장, 로컬 NVMe 극한 성능(수 GB/s·수십만 IOPS)이 하드 요구, **운영 인력이 이미 존재**, 비용 통제가 절실하고 1yr+ Savings Plan을 커밋할 수 있는 경우. lock-in 최소화가 중요하면 Altinity operator 기반 |
| **어느 쪽도 서두르면 안 되는 경우** | "여러 신호를 한 팀에 수렴"할 명분(D4 게이트)이 아직 안 선 경우 — 그때는 배포 형태 결정 자체를 유보하고 로그는 VictoriaLogs, 메트릭은 VictoriaMetrics로 둔다(아래) |

## 우리 케이스에서는

**전제부터 다르다.** 로깅 챕터는 ClickHouse를 **로그 저장소**로만 저울질했고, 그 관점에서 결론은 로그는 [VictoriaLogs]({{< relref "../logging/03-victorialogs.md" >}})로 가고 ClickHouse 통합(D4)은 "여러 신호를 한 팀에 수렴시킬 명분이 섰을 때 earn it last"였다([로깅 권장안]({{< relref "../logging/08-recommendation.md" >}})). 반면 이 챕터의 전제는 **RUM 대체 + 범용 분석 + 인력 보유가 이미 성립한 상태**다. 즉 로깅 챕터가 유보한 D4의 게이트("명분 + 오너")를 **통과했다고 가정한 하위 결정**이 배포 형태 선택이다. 게이트를 아직 못 넘었다면 이 페이지의 self-host 권고는 발동하지 않는다 — 그때는 로그 단독 내재화가 인건비를 상쇄하지 못한다는 로깅 챕터의 판단이 그대로 유효하다. **양립한다.**

게이트가 열린 전제 위에서 숫자를 대입하면 세 조건이 모두 self-host를 가리킨다:

1. **스토리지 성능 극대화 요구** → 원하는 수 GB/s·수십만 IOPS는 EBS로는 월 수천 $를 써도 물리적으로 불가능, 로컬 NVMe로는 한계비용 $0. Cloud/BYOC는 이 영역을 애초에 제공 안 함.
2. **관측성 + 범용 분석 겸용, 20TB+로 성장** → 크로스오버 표의 접전~우위 구간.
3. **운영 인력 이미 존재**(EKS + 광범위 Datadog 운영 중) → Cloud의 유일한 구조적 우위(people 흡수)가 이미 상쇄.

단, 로깅 챕터의 경계는 그대로 지킨다 — **로그 hot 경로는 여전히 VictoriaLogs, 메트릭은 VictoriaMetrics**다. ClickHouse self-host는 통합 저장소 야심이 아니라 **RUM·트레이스 등 신호가 실제로 한 팀에 모일 때** 얹는 결정이며, 이때도 로그 전면 이전은 별도 명분이 필요하다. 구체 권고: **i8g + 1yr Savings Plan(데이터 노드 ~40% 절감) + hot NVMe / cold S3 tier + Altinity operator**. Cloud를 고르는 예외는 (a) 데이터가 5TB 안팎·간헐이거나 (b) 로컬 NVMe 극한 성능이 실은 불필요하고 운영 부담을 0으로 두고 싶을 때 — 그때는 순수 SaaS보다 **BYOC**(VPC 잔류 + 우리 RI 적용)가 실비 유리다.
