---
title: "용량 산정 — 월 0.7TB RUM 워크드 모델(3개월·6개월·1년)"
weight: 7
---

# 용량 산정 — 월 0.7TB RUM 워크드 모델(3개월·6개월·1년)

{{< callout type="info" >}}
**한눈에** — 0.7TB/월(prod, 세션 샘플링 100%) 캐파의 결론.

- **첫 갈림길은 "0.7TB가 raw ingest냐 on-disk(압축 후)냐"** — 이 해석에 배포 규모·비용이 2~3배 갈린다. 본 페이지는 **on-disk 해석 B를 1차 모델**로, raw 해석 A를 대조로 싣고, 배포 후 `system.parts` **1회 실측**으로 확정하게 한다. `≈`
- **on-disk 구성은 세션 리플레이가 ~78%를 지배**(리플레이는 압축이 잘 안 됨). 그런데 리플레이는 **hot 30일만 두고 S3로 안 내리고 DELETE**({{< relref "03-s3-cold-tiering.md" >}} 기준 문서) → **리플레이는 누적되지 않는다.** 이게 캐파의 단일 최대 지렛대다.
- **그래서 "0.7TB×12=8.4TB" 순진한 누적은 틀리다.** 1년 실제 누적(단일사본)은 **~2.35TB** — 차이 ~6TB가 전부 "안 쌓이는 리플레이"다. `≈`
- **hot·컴퓨트는 지평 무관 고정**(hot gp3 ~2TB, 2× r7g.2xlarge). 3→12개월 증분은 **거의 전부 싼 S3 cold**($9→$79/mo). `≈`
- **1 shard × RF2 로 1년+ 충분**, gp3로 충분(io2 불필요), Keeper 3노드·MongoDB 3멤버는 데이터량과 무관하게 소형 고정. prod 월 **~$1.0K**(us-east-1, on-demand), RF3 시 ~$1.5K, 서울 +10~15%. `≈`
{{< /callout >}}

용량 산정의 배경(로컬 NVMe 스펙·EBS 대역 한계·티어링≠내구성)은 [로컬 NVMe 문서]({{< relref "../clickhouse/02-storage-local-nvme.md" >}})가, RF2 vs RF3 선택 확률·`insert_quorum`·쓰기 내구성 노브는 [배포 플레이북]({{< relref "../clickhouse/04-deployment-playbook.md" >}})이, TCO 비교와 관리형 단가는 [managed vs self-host]({{< relref "../clickhouse/01-managed-vs-selfhosted.md" >}})가 이미 다룬다. 이 페이지는 그 위에 **우리 RUM 워크로드(0.7TB/월)의 산식만** 얹는다 — 재조사는 relref로 넘기고, 산술을 그대로 노출해 독자가 자기 워크로드로 재계산할 수 있게 한다.

## 1. 입력 해석 — "월 0.7TB"는 raw인가 on-disk인가

사용자 입력 "prod 세션 샘플링 100%, 월 0.7TB"는 **어느 지점의 바이트인지 불명**하다. 캐파의 첫 갈림길이므로 두 해석을 모두 못박는다.

| | **해석 A — raw ingest** | **해석 B — on-disk(압축 후, 단일사본)** |
|---|---|---|
| 0.7TB의 의미 | OTel collector/SDK 인입 바이트/월(압축 전 논리 크기) | ClickHouse가 디스크에 쓰는 압축 후 바이트/월(`system.parts.bytes_on_disk`, 단일 replica) |
| 흔한 화법 | "우리 텔레메트리 월 0.7TB 나온다" | "월 0.7TB씩 디스크가 는다" |
| 변환(블렌디드 ~6x, §2) | on-disk = 0.7TB ÷ 6 ≈ **117GB/월** | raw ≈ 0.7TB × 6 ≈ **4.2TB/월** |
| 배포 규모 | 아주 작음(hot 수백 GB) → 2× 소형 노드, ~$0.5K/mo | 중소 → 2× r7g.2xlarge, ~$1.0K/mo |
| 캐파 적합성 | 사이징엔 부적절(과소) | **디스크를 직접 결정 → 사이징의 기준** |

캐파 산정의 대상은 결국 **디스크에 실제로 쌓이는 양**이므로, 본 페이지는 **해석 B(on-disk 단일사본 0.7TB/월)를 1차 모델**로 삼고 해석 A는 §4.7 대조로 싣는다 `≈`.

{{< callout type="warning" >}}
**배포 후 반드시 1회 실측 — 이걸로 모호성이 사라진다.** 두 해석의 배포 규모·비용이 2~3배 차이 나므로, staging 또는 prod 초기 데이터가 며칠 쌓인 뒤 다음 쿼리로 어느 해석인지 확정한다.

```sql
-- 테이블별 on-disk vs 압축 전 크기 & 실측 압축비
SELECT table,
       formatReadableSize(sum(bytes_on_disk))               AS on_disk,
       formatReadableSize(sum(data_uncompressed_bytes))     AS uncompressed,
       round(sum(data_uncompressed_bytes)/sum(bytes_on_disk),1) AS ratio
FROM system.parts
WHERE active AND database = 'default'
GROUP BY table ORDER BY sum(bytes_on_disk) DESC;
```

`ratio`가 시그널별 실제 압축비, `on_disk`의 월 증가분이 해석 B의 실측값이다. 이 한 번의 실측이 §2의 `≈`을 `✓`으로 바꾼다.
{{< /callout >}}

### 1.1 세션 수 역산 — 두 해석의 현실성 교차검증 `≈`

RUM 볼륨은 세션 리플레이가 지배한다(§2). 리플레이 on-disk가 전체의 ~78%(§2.2)라 가정하면:

- **해석 B**(on-disk 0.7TB/월): 리플레이 on-disk ≈ 0.55TB/월, 세션당 on-disk ~25KB `≈` → **~22M 세션/월**. [RUM 내재화 문서]({{< relref "../rum/_index.md" >}})의 "월 30M 세션"과 **동일 자릿수**(중대형 웹 자산). ✅
- **해석 A**(raw 0.7TB/월): 리플레이 raw ≈ 0.46TB/월, 세션당 wire ~150KB `≈` → **~3M 세션/월**(중소 웹 자산). 역시 내부 정합.

두 해석은 모순이 아니라 **서로 다른 크기의 자산을 기술**한다. `system.parts`(위 콜아웃) 또는 collector 메트릭으로 1회 실측하면 갈린다.

## 2. 압축비 & on-disk 구성 — 산식을 노출한다

ClickHouse는 컬럼 저장 + ZSTD로 관측성 데이터를 크게 압축하지만 **시그널마다 비율이 다르다**. 리플레이는 고엔트로피 DOM이라 낮고, 로그/트레이스는 반복 구조라 높다.

### 2.1 시그널별 압축비 가정 `≈`

| 데이터 | 압축비(raw→on-disk) | 근거 등급 |
|---|---|---|
| 세션 리플레이(rrweb `Body`) | **~5x**(밴드 4~6x) | `≈` — rrweb-in-CH 공개 실측 부재. verbose JSON·고엔트로피 DOM |
| 로그·트레이스 | **~10x** | `✓` — 실관측 데이터 ZSTD 10~14x 일상적, Character.AI 15~20x `Ⓥ` |
| 메트릭 | ~8x | `≈` |

> nginx 로그 52~178x 같은 낙관 상한은 원문도 "typical app log에 비대표"라 명시하므로 **RUM 산정에 쓰지 않는다** `✓`.

### 2.2 블렌디드 압축비 & on-disk 구성비 — 재계산 가능한 산식

raw 볼륨 구성비(가정: 리플레이 65% / 로그 20% / 트레이스 13% / 메트릭 2% `≈`)를 시그널 압축비로 가중한다:

```
on-disk 분율 = 0.65/5 + 0.20/10 + 0.13/10 + 0.02/8
            = 0.130 + 0.020 + 0.013 + 0.0025 = 0.1655
블렌디드 압축비 = 1 / 0.1655 ≈ 6.0x   (민감도 밴드 5x 보수 ~ 8x 낙관)
```

여기서 핵심은 **on-disk 상에서는 리플레이 비중이 raw보다 더 커진다**는 점이다 — 리플레이는 압축이 안 되니까:

| 시그널 | raw 구성비 | 압축비 | **on-disk 구성비** = (raw/압축)/0.1655 |
|---|---|---|---|
| 리플레이 `hyperdx_sessions` | 65% | 5x | 0.130/0.1655 = **78.5%** |
| 로그 `otel_logs` | 20% | 10x | 0.020/0.1655 = **12.1%** |
| 트레이스 `otel_traces` | 13% | 10x | 0.013/0.1655 = **7.9%** |
| 메트릭 `otel_metrics_*` | 2% | 8x | 0.0025/0.1655 = **1.5%** |

즉 on-disk 0.7TB/월(해석 B)의 월간 시그널별 생성량(단일사본)은:

| 시그널 | on-disk 생성/월(단일) |
|---|---|
| 리플레이 | **~0.55TB** |
| 로그 | ~0.085TB |
| 트레이스 | ~0.055TB |
| 메트릭 | ~0.010TB |

이 표가 §4 전체 산정의 입력이다. `≈` — staging에서 §1 콜아웃 쿼리로 압축비를 실측해 밴드를 좁혀야 한다.

## 3. 캐파의 지렛대 — 리플레이는 "안 쌓인다"

여기가 이 페이지에서 가장 중요한 지점이다. TTL 정책의 기준 문서는 {{< relref "03-s3-cold-tiering.md" >}}이고, 그 핵심은:

- **`hyperdx_sessions`(리플레이)**: hot(gp3)만, **S3로 내리지 않고** 30일 후 **DELETE**. 오래된 리플레이는 거의 안 보고 볼륨을 지배하므로 S3 이전조차 낭비다.
- **`otel_logs`/`otel_traces`**: hot **14일** → `TO VOLUME 'cold'`(S3) → 지평별 DELETE.
- **`otel_metrics_*`**: hot **30일** → S3 → 지평별 DELETE.

on-disk의 78.5%를 차지하는 리플레이가 **30일 상한**으로 잘리고 S3로도 안 가면, 리플레이는 시간이 지나도 **누적되지 않는다**(steady-state ~0.55TB 단일). 누적을 만드는 건 나머지 ~22%(로그+트레이스+메트릭 ≈ **0.15TB/월**)뿐이다.

{{< callout type="important" >}}
**"0.7TB × 12개월 = 8.4TB" 순진한 누적은 틀리다.** 그 계산은 리플레이가 계속 쌓인다고 가정하지만, 리플레이는 30일 DELETE라 steady-state에 머문다. 실제 1년 누적(단일사본)은 리플레이 고정분 ~0.55TB + 누적분(로그/트레이스/메트릭) ~1.8TB ≈ **~2.35TB**. **차이 ~6TB가 전부 "안 쌓이는 리플레이"다.** 리플레이 TTL을 로그/트레이스와 분리해 짧게 잡는 것이 캐파·비용의 단일 최대 절감 노브인 이유가 이 숫자다. `≈`
{{< /callout >}}

## 4. 보관 지평별 산정 — 3/6/12개월 워크드 모델 (해석 B)

### 4.1 공통 가정

- **hot 창(EBS gp3)**: 리플레이·메트릭 **30일**, 로그·트레이스 **14일**({{< relref "03-s3-cold-tiering.md" >}} 기준 문서와 정합). hot 창 밖은 로그/트레이스/메트릭만 S3 cold로, 리플레이는 DELETE.
- **cold도 replica마다 사본**(self-host S3 = shared-nothing, UltraWarm식 단일사본 절감 없음, {{< relref "../clickhouse/02-storage-local-nvme.md" >}}) → cold도 ×RF.
- **머지 헤드룸 = hot gp3에 +40%**(30~40% 여유; 디스크가 차면 머지 중단·TOO_MANY_PARTS·인서트 차단) `✓/≈`.
- 노드 = EBS-first Graviton **r7g**(메모리 최적, RUM 쿼리는 page cache 이점). r8g(Graviton4)는 여유 시 각주 옵션 `≈`.

### 4.2 지평별 누적·hot·cold (단일사본 & RF 배수) `≈`

리플레이 hot 고정분(~0.55TB)에 로그/트레이스(hot 14일)·메트릭(hot 30일) hot 잔량(~0.076TB)을 더해 **hot 단일 ≈ 0.63TB(지평 무관 고정)**. cold는 로그/트레이스/메트릭이 hot 창을 지나 DELETE 지평까지 쌓인 양이다.

| 지평(로그/트레이스 DELETE) | 누적 on-disk(단일) | ×RF2 | ×RF3 | hot(단일, 고정) | cold S3(단일) |
|---|---|---|---|---|---|
| **3개월**(90일) | ~1.0 TB | ~2.0 TB | ~3.0 TB | ~0.63 TB | ~0.37 TB |
| **6개월**(180일) | ~1.45 TB | ~2.9 TB | ~4.35 TB | ~0.63 TB | ~0.82 TB |
| **12개월**(365일) | ~2.35 TB | ~4.7 TB | ~7.05 TB | ~0.63 TB | ~1.72 TB |

*(cold = Σ 로그·트레이스·메트릭 월생성 − hot 잔량, DELETE 지평까지. 리플레이는 30일 DELETE라 누적 기여 0. 메트릭 DELETE는 180/365일.)*

**hot은 지평이 늘어도 ~0.63TB로 고정**되고, 늘어나는 건 오직 싼 cold S3다.

### 4.3 물리 배치 — hot gp3 / cold S3 (RF2 기준)

| 지평 | hot gp3 물리(×RF2, +40%) | cold S3 물리(×RF2) | 백업(단일, Glacier IR) |
|---|---|---|---|
| 3개월 | 0.63×2×1.4 ≈ 1.76 → **~2.0 TB** | 0.37×2 = **0.74 TB** | ~0.45 TB |
| 6개월 | **~2.0 TB**(고정) | 0.82×2 = **1.64 TB** | ~0.9 TB |
| 12개월 | **~2.0 TB**(고정) | 1.72×2 = **3.44 TB** | ~1.8 TB |

- **hot gp3는 지평과 무관하게 ~2TB로 고정**(노드당 ~1TB). gp3 단일 볼륨 상한 64 TiB에 여유롭게 들어간다({{< relref "02-hot-storage-ebs.md" >}}).
- **cold S3만 지평 따라 증가** → 1년까지 늘려도 추가 비용은 대부분 $0.023/GB S3. 백업은 리플레이 제외(가치 급감) 후 로그/트레이스/메트릭만 Glacier IR.

### 4.4 노드/shard/replica — 지평 무관 고정 `≈`

이 규모(hot 물리 ~2TB, raw ingest ~4.2TB/월 ≈ **평균 1.6 MB/s**, 피크 ×5 ≈ 8 MB/s)에서:

- **인제스트 CPU**: ClickStack "10 MB/s당 1 vCPU" → 피크 8MB/s = **<1 vCPU** `Ⓥ`. 무시 수준.
- **쿼리**: RUM 대시보드·세션 검색 위주 light~moderate, page cache가 hot을 흡수.
- **결론**: **1 shard × 2 replica(RF2)** 로 1년+ 충분. **샤딩 불필요**(조기 수평 확장은 안티패턴). RF3는 임의 2대 동시 유실 방어가 필요할 때만({{< relref "../clickhouse/04-deployment-playbook.md" >}}).

| 컴포넌트 | 권장(prod) | 사양 | 근거 |
|---|---|---|---|
| ClickHouse 데이터 노드 | **2× r7g.2xlarge**(RF2), +1대(RF3) | 8 vCPU / 64 GB / gp3 ~1TB | 인제스트·쿼리 여유, page cache `≈` |
| ClickHouse Keeper | **3× t4g.medium** | 2 vCPU / 4 GB / gp3 20GB(영속) | 정족수 3, 4GB면 충분 `✓` → {{< relref "05-keeper.md" >}} |
| MongoDB | **3-member t4g.small**(또는 Atlas) | 2 vCPU / 2 GB / gp3 10GB | 메타데이터 수 GB, `members:1`은 HA 아님 `✓` → {{< relref "../rum/07-hyperdx-mongodb.md" >}} |
| OTel Collector | gateway 2 replica(HPA) | 각 1~2 vCPU | 변환 CPU 여유 |

> **인스턴스 EBS 대역이 실질 병목**: gp3 볼륨 스펙(최대 2,000 MiB/s)보다 **인스턴스의 EBS 파이프 상한이 먼저 천장**을 친다 — r7g.2xlarge의 EBS 대역이 볼륨 스펙보다 낮으므로 노드 사이즈업이 볼륨 프로비저닝보다 먼저 효과를 낸다({{< relref "../clickhouse/02-storage-local-nvme.md" >}}) `✓`. 이 스케일(피크 8MB/s)에선 둘 다 여유라 무관하지만, 성장 시 이 순서를 기억한다.
> **lean 옵션**: 쿼리가 가벼우면 **2× r7g.xlarge(4vCPU/32GB)** 로 낮춰도 된다. 헤드룸을 위해 2xlarge 권장.

### 4.5 Keeper·MongoDB — 데이터량과 무관하게 소형 고정

- **Keeper**: 정족수 3(1 장애 허용), 4GB RAM·gp3 20GB면 충분. Keeper 부하는 데이터량이 아니라 **INSERT 빈도·파트 생성 수**에 비례하므로 지평이 늘어도 커지지 않는다({{< relref "05-keeper.md" >}}) `✓`.
- **MongoDB**: 메타데이터(user/dashboard/alert/source) 전용, 데이터셋 수 GB. `members:3`이 값싼 HA 보험, 인제스트 경로 밖이라 규모 무관({{< relref "../rum/07-hyperdx-mongodb.md" >}}) `✓`.

### 4.6 월 비용 산정 (해석 B, us-east-1, on-demand) `≈`

단가 `✓`: gp3 $0.08/GB-mo(+$0.005/IOPS·$0.04/MBps 초과분), S3 Standard $0.023/GB-mo, Glacier IR $0.004/GB-mo, S3 PUT $0.005/1k. 인스턴스 시급은 `≈`(AWS Calculator로 확정 권장).

**고정 컴포넌트(지평 무관)**:

```
컴퓨트  2× r7g.2xlarge  = 2 × $0.4284/hr × 730 ≈ $626/mo   [추정 단가]
Keeper  3× t4g.medium  = 3 × $0.0336/hr × 730 ≈ $74 + gp3 60GB×$0.08 $5  ≈ $79/mo
Mongo   3× t4g.small   = 3 × $0.0168/hr × 730 ≈ $37 + gp3 30GB×$0.08 $2  ≈ $39/mo
hot gp3 2.0TB          = 2000GB × $0.08 (baseline IOPS·throughput 무료)   ≈ $160/mo
────────────────────────────────────────────────────────────────────────────
고정 소계 ≈ $904/mo
```

**지평별 가변(cold S3 + 백업 + cross-AZ 전송, RF2)**:

| 지평(RF2) | cold S3 | 백업(Glacier IR) | cross-AZ 전송 | **월 총계(on-demand)** | 1yr SP 적용* |
|---|---|---|---|---|---|
| 3개월 | 0.74TB×$0.023=$17 +PUT $8 | 0.45TB×$0.004=$2 | ~$40 | **~$971/mo** | ~$720/mo |
| 6개월 | 1.64TB×$0.023=$38 +PUT $10 | 0.9TB×$0.004=$4 | ~$45 | **~$1,001/mo** | ~$750/mo |
| 12개월 | 3.44TB×$0.023=$79 +PUT $12 | 1.8TB×$0.004=$7 | ~$50 | **~$1,052/mo** | ~$800/mo |

*1yr Savings Plan은 컴퓨트에만 ~40% 적용, 스토리지·S3·전송은 정가 `≈`.

**RF3(12개월)**: 컴퓨트 3대 $938 + hot gp3 3TB $240 + cold S3 ×RF3=5.16TB $119 + Keeper/Mongo $118 + 백업 $7 + 전송 $70 ≈ **~$1,500/mo**(on-demand), 1yr SP ~$1,150/mo `≈`.

> **읽는 법**: hot gp3·컴퓨트·Keeper·Mongo는 **지평 무관 고정 $904**. 3→12개월 확장 비용은 **거의 전부 S3 cold**($9→$79 증가). **긴 보관이 싼 이유**는 EBS가 아니라 S3에 쌓이고, 심지어 볼륨 지배자인 리플레이는 30일에 잘리기 때문이다. Datadog RUM으로 같은 워크로드(≈월 22M 세션)를 태우면 [RUM 문서]({{< relref "../rum/_index.md" >}}) 기준 블렌디드 ~$0.42/1k → **연 수만~십수만 $**대인데, self-host는 월 ~$1.0K(연 ~$12K) — 수 배~10배 절감(단 people TCO 별도, {{< relref "../clickhouse/01-managed-vs-selfhosted.md" >}}).
>
> **리전 주석**: 위는 **us-east-1** 기준. **서울(ap-northeast-2)은 인스턴스·EBS·S3가 ~10~15% 비싸다** — 서울 배포 시 총액에 ×1.1~1.15 `≈`. 즉 RF2 12개월 서울 ≈ ~$1.2K/mo.

{{% details title="대조 — 해석 A(raw 0.7TB/월 = on-disk 117GB/월) 산정표" closed="true" %}}
| 지평(RF2) | 누적 단일 | hot gp3(×RF2,+40%) | cold S3(×RF2) | 노드 | **월 총계** |
|---|---|---|---|---|---|
| 3개월 | ~0.17TB | ~0.33TB → $26 | ~0.06TB → $3 | 2× r7g.xlarge | **~$430/mo** |
| 12개월 | ~0.4TB | ~0.33TB → $26 | ~0.3TB → $14 | 2× r7g.xlarge | **~$500/mo** |

해석 A면 **매우 작다** — 2× 소형 노드 + Keeper 3 + Mongo 3로 충분, 월 ~$0.5K. hot이 수백 GB라 gp3 볼륨 하나로 끝난다. **0.7TB가 wire 볼륨이면 배포는 "staging 확대판" 수준.** 어느 해석인지 확인(§1 콜아웃)이 사이징의 전부다. `≈`
{{% /details %}}

## 5. gp3면 충분 — io2 트리거는 도달 안 함

gp3 vs io2 Block Express 실전 스펙(gp3 80,000 IOPS/2,000 MiB/s/64TiB `✓`, io2 BE 256,000 IOPS/4,000 MiB/s/99.999% `✓`)·요금 3분해는 {{< relref "02-hot-storage-ebs.md" >}}가 기준 문서다. 캐파 관점의 판단만 요약한다.

- 우리 hot 물리 ~2TB, 노드당 ~1TB, 인제스트 피크 ~8 MB/s → gp3 **baseline 3,000 IOPS + 125 MiB/s로도 대부분 커버**. 부족하면 gp3 위로 IOPS/throughput을 **싸게** 프로비저닝(예: +3,000 IOPS·+125 MiB/s = 추가 ~$15+$5/mo)한다.
- **내구성은 gp3(99.8~99.9%)로 충분** — 진짜 내구성은 RF 복제 + 백업이 담당한다(티어링≠내구성, {{< relref "../clickhouse/02-storage-local-nvme.md" >}}). io2의 99.999%는 이 스케일에 과잉.
- **io2 전환 트리거**: (a) 단일 볼륨 **>2,000 MiB/s 지속**, (b) **>80,000 IOPS/vol**, (c) 규제상 볼륨 자체 99.999% 요구. → 0.7TB/월 RUM은 **셋 다 도달 안 함** → **io2 채택 근거 없음** `≈`.

## 6. TTL — 지평별 DELETE 변주 (기준 문서는 03)

TTL 정책의 기준 문서(storage_policy·`TO VOLUME 'cold'`·`move_factor` 안전판·시간 컬럼명 확인)는 {{< relref "03-s3-cold-tiering.md" >}}에 있다. **여기서 재정의하지 않는다** — 캐파 지평에 따라 달라지는 건 오직 **DELETE 간격**뿐이다.

```sql
-- 지평별로 바뀌는 것은 DELETE INTERVAL 하나뿐. MOVE·정책은 03 기준 문서를 따른다.
-- 로그/트레이스: hot 14일 → cold → DELETE(3개월=90 / 6개월=180 / 1년=365)
ALTER TABLE default.otel_logs MODIFY TTL
  toDateTime(Timestamp) + INTERVAL 14  DAY TO VOLUME 'cold',
  toDateTime(Timestamp) + INTERVAL 365 DAY DELETE      -- ← 지평별 90/180/365
  SETTINGS materialize_ttl_after_modify = 0;

-- 메트릭: hot 30일 → cold → DELETE(180 또는 365)
ALTER TABLE default.otel_metrics_gauge MODIFY TTL
  toDateTime(TimeUnix) + INTERVAL 30  DAY TO VOLUME 'cold',
  toDateTime(TimeUnix) + INTERVAL 365 DAY DELETE;

-- 리플레이: hot 30일만, S3 안 감, DELETE 30일 (지평이 늘어도 여기는 그대로 짧게)
ALTER TABLE default.hyperdx_sessions MODIFY TTL
  TimestampTime + INTERVAL 30 DAY DELETE;
```

> `materialize_ttl_after_modify = 0`으로 기존 파트 즉시 재작성을 피해 운영 중 부하 폭증을 막는다 `≈`. 시간 컬럼명(`Timestamp`/`TimestampTime`/`TimeUnix`)은 테이블마다 다를 수 있으니 `SHOW CREATE TABLE`로 확인 후 적용 `?`. ClickStack OSS 기본 TTL은 `${TABLES_TTL}` 단일값(문서상 3일)이며, 위 값은 우리 권장 오버라이드다 — 배포 시 실 스키마로 확정 `?`.

## 7. staging vs prod — 규모 차이

staging은 "동작 검증 + 실측 캘리브레이션"이 목적이므로 **샘플링 축소 + 단일 replica + 짧은 TTL**로 극소화한다.

| 항목 | **staging** | **prod** |
|---|---|---|
| 세션 샘플링 | 5~10%(또는 QA 트래픽만) | **100%** |
| 월 on-disk(해석 B) | ~35~70 GB | 700 GB |
| RF(replica) | **1**(HA 불필요) | **2**(권장) / 3(임계) |
| 보관 TTL | 7~14일, **cold 없음**(전부 hot) | 리플레이 30일 / 로그·트레이스 hot 14일+cold+지평 DELETE / 메트릭 30일+cold |
| ClickHouse 노드 | **1× r7g.large**(2vCPU/16GB) | 2~3× r7g.2xlarge |
| Keeper | **1**(단일; 또는 CH 임베디드) | **3**(정족수) |
| MongoDB | **1-member**(무인증 주의) | 3-member 또는 Atlas + SCRAM |
| gp3 | ~100~200GB 단일 | 노드당 ~1TB + S3 캐시 |
| 월 비용 `≈` | **~$150~250/mo** | ~$1.0K/mo |

> **staging의 진짜 역할 = 실측 캘리브레이션**: §2 압축비·구성비·세션당 KB는 전부 `≈`이다. staging에서 §1 콜아웃 쿼리로 **실제 압축비와 세션당 바이트를 측정**해 prod 모델의 `≈`을 `✓`으로 바꾼다. 이게 staging을 두는 캐파상 이유다.

## 8. 성장 버퍼 & 경보 기준

### 8.1 디스크 헤드룸 — 여유 공간이 곧 안정성 `✓/≈`

- **머지는 여유 공간을 먹는다**: 병합 대상 파트 합만큼의 여유가 필요. 디스크가 차면 **머지 중단 → 파트 누적 → TOO_MANY_PARTS → 인서트 차단**.
- **hot gp3 사용률 경보**: **70% 경고 / 80% 조치 / 85% 하드실링**. hot 볼륨은 항상 **30~40% 여유**(§4.1 헤드룸).

### 8.2 경보 항목 & 증설 트리거 `≈`

| 신호 | 경보 임계 | 조치 |
|---|---|---|
| hot gp3 사용률 | >80% | gp3 온라인 확장(무중단) 또는 TTL 단축·cold 이동 가속 |
| 파티션당 active parts | >300 | 배치/async insert 튜닝, 파티션 키 카디널리티 점검 |
| 인제스트 지연/큐 | 지속 증가 | collector 스케일아웃, 배치 크기↑ |
| 데이터 노드 CPU | 지속 >70% | replica 추가(읽기) 또는 노드 사이즈업 |
| Keeper 지연/디스크 | znode↑·gp3 80% | Keeper 디스크 확장, 작은 인서트 제거 |

### 8.3 언제 shard / io2 / RF3로 가나 `≈`

- **shard 추가**: 이 워크로드는 1년+ **불필요**. 트리거는 (a) hot 단일사본/노드가 노드 실용 상한(예 4~8TB)에 접근, (b) 머지/쿼리 CPU 지속 포화, (c) 재수화 위험 창을 줄이려 노드당 데이터를 낮추고 싶을 때. 신규 shard 스키마·리밸런싱은 **수동**({{< relref "../clickhouse/05-altinity-operations.md" >}}).
- **io2 전환**: §5 — >2,000 MiB/s·>80,000 IOPS/vol·볼륨 99.999% 요구 시. RUM 0.7TB/월엔 도달 안 함.
- **RF2→RF3**: 임의 2대 동시 유실 무손실 또는 재수화 창 동안 2차 장애 방어가 필요할 때. 비용은 컴퓨트+cold S3가 ×1.5. 확률·비용 결정은 {{< relref "../clickhouse/04-deployment-playbook.md" >}}.

{{% details title="정정·기각된 통념 표" closed="true" %}}
| 통념 | 판정 | 근거 |
|---|---|---|
| "0.7TB × 12 = 8.4TB 쌓인다" | ❌ 순진한 누적 | 리플레이(on-disk 78%)는 30일 DELETE라 안 쌓임 → 실제 ~2.35TB(§3) `≈` |
| "성능 스토리지니까 io2/로컬 NVMe" | ❌ 이 스케일엔 과잉 | 0.7TB/월은 I/O 아닌 용량 게임 → gp3 + S3(§5) `≈` |
| "S3 티어링하면 사본이 줄어 싸진다"(UltraWarm식) | ❌ | cold도 replica마다 사본(×RF), 절감은 GB단가 차뿐 `✓` |
| "보관 1년으로 늘리면 비싸진다" | ❌ | hot·컴퓨트 고정, 증분은 대부분 싼 S3 cold(§4.6) `≈` |
| "리플레이도 로그와 같은 TTL로" | ❌ 낭비 | 리플레이는 가치 급감·볼륨 지배 → 분리해 짧게가 최대 절감 노브(§3) `≈` |
| "MongoDB가 데이터량 따라 커진다" | ❌ | 메타데이터 전용, 사용자·설정 수 비례, 수 GB `✓` |
{{% /details %}}

## 10. RUM 볼륨 흐름 & 해석 분기

{{< flow caption="RUM 볼륨 흐름 — 인입부터 hot·cold·삭제·백업까지" >}}
{
  "nodes": [
    {"id":"R","col":0,"row":0,"label":"세션 리플레이 rrweb","sub":"~65%","kind":"src"},
    {"id":"L","col":0,"row":1,"label":"로그·Vitals","sub":"~20%","kind":"src"},
    {"id":"T","col":0,"row":2,"label":"트레이스","sub":"~13%","kind":"src"},
    {"id":"M","col":0,"row":3,"label":"메트릭","sub":"~2%","kind":"src"},
    {"id":"S","col":1,"row":0,"label":"hyperdx_sessions","sub":"on-disk ~78% · hot gp3 ×RF2","kind":"store"},
    {"id":"OL","col":1,"row":1,"label":"otel_logs","sub":"hot gp3 ×RF2","kind":"store"},
    {"id":"OT","col":1,"row":2,"label":"otel_traces","sub":"hot gp3 ×RF2","kind":"store"},
    {"id":"OM","col":1,"row":3,"label":"otel_metrics_*","sub":"hot gp3 ×RF2","kind":"store"},
    {"id":"X","col":2,"row":0,"label":"삭제","kind":"sink"},
    {"id":"C","col":2,"row":2,"label":"S3 cold","sub":"×RF2","kind":"store"},
    {"id":"B","col":3,"row":2,"label":"S3/Glacier IR 백업","kind":"store"}
  ],
  "edges": [
    {"from":"R","to":"S","rate":700},
    {"from":"L","to":"OL","rate":700},
    {"from":"T","to":"OT","rate":700},
    {"from":"M","to":"OM","rate":700},
    {"from":"OL","to":"C","label":"TTL 14d MOVE","rate":700},
    {"from":"OT","to":"C","label":"TTL 14d MOVE","rate":700},
    {"from":"OM","to":"C","label":"TTL 30d MOVE","rate":700},
    {"from":"S","to":"X","label":"TTL 30d DELETE (S3 안 감 → 누적 0)","rate":800},
    {"from":"OL","to":"X","label":"지평별 90/180/365d DELETE","rate":800},
    {"from":"C","to":"B","label":"clickhouse-backup (리플레이 제외)","dashed":true}
  ]
}
{{< /flow >}}

{{< flow caption="해석 분기 — raw ingest vs on-disk 단일사본" >}}
{
  "nodes": [
    {"id":"Q","col":0,"row":0,"label":"월 0.7TB는?","kind":"proc"},
    {"id":"A","col":1,"row":0,"label":"÷6 압축 → on-disk 117GB/월","sub":"2× 소형노드, ~$0.5K/mo","kind":"sink"},
    {"id":"Bp","col":1,"row":1,"label":"리플레이 30일 캡, 1yr 누적 ~2.35TB","sub":"hot gp3 고정 + cold S3 증가, 2× r7g.2xl RF2, ~$1.0K/mo","kind":"sink"}
  ],
  "edges": [
    {"from":"Q","to":"A","label":"raw ingest","dashed":true},
    {"from":"Q","to":"Bp","label":"on-disk 단일사본","dashed":true}
  ]
}
{{< /flow >}}

## 우리 케이스에서는

**해석 B(on-disk 0.7TB/월)를 1차 모델**로 잡되, 배포 후 `system.parts`로 **1회 실측**해 raw인지 on-disk인지, 그리고 시그널별 실제 압축비를 확정하는 것이 사이징의 전부다 — 이 한 번의 실측이 배포 규모·비용의 2~3배 불확실성을 없앤다. 실측 전까지는 **1 shard × RF2, 2× r7g.2xlarge, hot gp3 노드당 ~1TB, Keeper 3 / MongoDB 3멤버**로 시작한다. 이 구성은 3개월이든 1년이든 **hot·컴퓨트가 고정**이고, 보관을 늘려도 늘어나는 건 싼 S3 cold뿐이라(1년 RF2 us-east-1 ~$1.0K/mo, 서울 +10~15%) 지평 결정을 미뤄도 손해가 없다.

가장 크게 못박을 한 가지는 **리플레이 TTL 분리**다. 리플레이는 on-disk의 ~78%를 먹지만 가치는 급감하므로 **hot 30일 + S3 미이동 + 30일 DELETE**로 잘라 누적에서 빼낸다({{< relref "03-s3-cold-tiering.md" >}}) — 이걸 안 하면 "0.7TB×12=8.4TB"의 함정에 빠져 gp3·S3·백업을 모두 3~4배로 과산정하게 된다. io2·로컬 NVMe·RF3·샤딩은 §8.3 트리거를 실제로 넘길 때만 승급한다. 압축비 5x·구성비 65/20/13/2·ClickStack 기본 TTL은 전부 `≈`·`?`이니 staging 실측으로 승격하는 것을 배포 체크리스트 1번에 둔다. 시점 기준 2026-07.
