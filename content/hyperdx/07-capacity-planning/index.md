---
title: "용량 산정 — 월 0.7TB RUM 워크드 모델(3개월·6개월·1년)"
date: 2026-08-01
lastmod: 2026-08-24
weight: 7
aliases: ["/hyperdx-operating/05-capacity/", "/hyperdx/operating/05-capacity/"]
---

# 용량 산정 — 월 0.7TB RUM 워크드 모델(3개월·6개월·1년)

{{< callout type="info" >}}
0.7TB/월(prod, 세션 샘플링 100%) 캐파의 결론입니다.

- 가장 먼저 정할 것은 "0.7TB가 raw ingest냐 on-disk(압축 후)냐"입니다 — 해석이 달라지면 배포 규모·비용도 2~3배 차이가 납니다. 본 페이지는 on-disk 해석 B를 1차 모델로 삼고 raw 해석 A를 대조로 실었으며 배포 후 `system.parts` 1회 실측으로 확정합니다. `≈`
- on-disk 구성은 세션 리플레이가 ~78%를 지배합니다(리플레이는 압축이 잘 안 됩니다). 그런데 리플레이는 hot 30일만 두고 S3로 내리지 않고 DELETE 하므로({{< relref "03-s3-cold-tiering.md" >}} 기준 문서) 누적되지 않습니다. 리플레이가 누적되지 않는다는 점이 캐파의 단일 최대 지렛대입니다.
- 그래서 "0.7TB×12=8.4TB" 순진한 누적은 틀립니다. 1년 실제 누적(단일사본)은 ~2.35TB고 차이 ~6TB가 전부 "안 쌓이는 리플레이"입니다. `≈`
- hot·컴퓨트는 지평과 무관하게 고정입니다(hot gp3 ~2TB, 2× r7g.2xlarge). 3→12개월 증분은 거의 전부 싼 S3 cold입니다(서울 ×RF2 기준 $19→$86/mo). `≈`
- 1 shard × RF2로 1년+ 충분하고 gp3로도 충분합니다(io2 불필요). Keeper 3노드·MongoDB 3멤버는 데이터량과 무관하게 소형 고정입니다. prod 월 ~$1.1~1.2K(서울 `ap-northeast-2`, on-demand), RF3 시 ~$1.7K. `≈`
{{< /callout >}}

용량 산정의 배경(로컬 NVMe 스펙·EBS 대역 한계·티어링≠내구성)은 [로컬 NVMe 문서]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})가, RF2 vs RF3 선택 확률·`insert_quorum`·쓰기 내구성 노브는 [배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})이, TCO 비교와 관리형 단가는 [managed vs self-host]({{< relref "../../clickhouse/01-managed-vs-selfhosted.md" >}})가 이미 다룹니다. 이 페이지는 그 위에 우리 RUM 워크로드(0.7TB/월)의 산식만 더합니다 — 재조사는 relref로 넘기고 산술을 그대로 드러내 독자가 자기 워크로드로 다시 계산할 수 있게 했습니다.

{{< callout type="important" >}}
압축비 산식·지평별 물리 배치·월 절대 금액의 단일 정본은 이 장입니다. 여기 한 곳에만 있는 것은 시그널별·블렌디드 압축비의 유도(§2), 3/6/12개월 hot gp3 / cold S3 / 백업 물리량(§4.2·§4.3), 서울 기준 월 비용의 절대 금액과 배수(§4.6)입니다. 다른 장과 운영 트랙은 이 숫자를 다시 적지 않고 이 장을 가리킵니다 — [블록 온리]({{< relref "08-block-only-tuning.md" >}})의 델타 산정도 §4.6을 기준선으로 삼는 파생이고 어긋나면 이 장을 따릅니다. GB 단가 rate 자체의 정본은 [hot 스토리지·EBS]({{< relref "02-hot-storage-ebs.md" >}}) §1.3이고 이 장은 그 rate를 인용해 곱합니다. TTL 정책의 정본은 [S3 콜드 티어링]({{< relref "03-s3-cold-tiering.md" >}})이고 이 장은 DELETE 지평만 변주합니다(§6).
{{< /callout >}}

## 1. 입력 해석 — "월 0.7TB"는 raw인가 on-disk인가

사용자 입력 "prod 세션 샘플링 100%, 월 0.7TB"는 어느 지점의 바이트인지 불명입니다. 캐파 산정의 첫 분기점이므로 두 해석을 모두 명시합니다.

| | **해석 A — raw ingest** | **해석 B — on-disk(압축 후, 단일사본)** |
|---|---|---|
| 0.7TB의 의미 | OTel SDK 인입 바이트/월(압축 전) | CH가 디스크에 쓰는 압축 후 바이트/월¹ |
| 흔한 화법 | "우리 텔레메트리 월 0.7TB 나온다" | "월 0.7TB씩 디스크가 는다" |
| 변환(블렌디드 ~6x, §2) | on-disk = 0.7TB ÷ 6 ≈ **117GB/월** | raw ≈ 0.7TB × 6 ≈ **4.2TB/월** |
| 배포 규모 | 아주 작음(hot 수백 GB) → 2× 소형 노드, ~$0.5~0.6K/mo | 중소 → 2× r7g.2xlarge, ~$1.1~1.2K/mo |
| 캐파 적합성 | 사이징엔 부적절(과소) | **디스크를 직접 결정 → 사이징의 기준** |

¹ `system.parts.bytes_on_disk` 기준(단일 replica). 표의 금액은 둘 다 서울(`ap-northeast-2`) 기준이고 산정 근거는 §4.6·§4.7입니다 `≈`.

캐파 산정의 대상은 결국 디스크에 실제로 쌓이는 양이므로 본 페이지는 해석 B(on-disk 단일사본 0.7TB/월)를 1차 모델로 삼고 해석 A는 §4.7 대조로 싣습니다 `≈`.

{{< callout type="warning" >}}
배포 후 1회 실측해야 모호성이 사라집니다. 두 해석의 배포 규모·비용이 2~3배 차이 나므로 staging 또는 prod 초기 데이터가 며칠 쌓인 뒤 다음 쿼리로 어느 해석인지 확정합니다.

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

`ratio`가 시그널별 실제 압축비, `on_disk`의 월 증가분이 해석 B의 실측값입니다. 이 한 번의 실측이 §2의 `≈`을 `✓`으로 바꿉니다.
{{< /callout >}}

### 1.1 세션 수 역산 — 두 해석의 현실성 교차검증 `≈`

RUM 볼륨은 세션 리플레이가 지배합니다(§2). 리플레이 on-disk가 전체의 ~78%(§2.2)라 가정하면:

- 해석 B(on-disk 0.7TB/월): 리플레이 on-disk ≈ 0.55TB/월, 세션당 on-disk ~25KB `≈` → ~22M 세션/월. [RUM 내재화 문서]({{< relref "../../rum/_index.md" >}})의 "월 30M 세션"과 동일 자릿수입니다(중대형 웹 자산).
- 해석 A(raw 0.7TB/월): 리플레이 raw ≈ 0.46TB/월, 세션당 wire ~150KB `≈` → ~3M 세션/월(중소 웹 자산). 역시 내부 정합입니다.

두 해석이 충돌하는 건 아닙니다. 서로 다른 크기의 자산을 기술할 뿐입니다. `system.parts`(위 콜아웃) 또는 collector 메트릭으로 1회 실측하면 어느 쪽인지 정해집니다.

## 2. 압축비 & on-disk 구성 — 산식을 노출한다

ClickHouse는 컬럼 저장 + ZSTD로 관측성 데이터를 크게 압축하지만 시그널마다 비율이 다릅니다. 리플레이는 고엔트로피 DOM이라 낮고 로그/트레이스는 반복 구조라 높습니다.

### 2.1 시그널별 압축비 가정 `≈`

| 데이터 | 압축비(raw→on-disk) | 근거 등급 |
|---|---|---|
| 세션 리플레이(rrweb `Body`) | **~5x**(밴드 4~6x) | `≈` — rrweb-in-CH 공개 실측 부재. verbose JSON·고엔트로피 DOM |
| 로그·트레이스 | **~10x** | `✓` — 실관측 데이터 ZSTD 10~14x 일상적, Character.AI 15~20x `Ⓥ` |
| 메트릭 | ~8x | `≈` |

nginx 로그 52~178x 같은 낙관 상한은 원문도 "typical app log에 비대표"라 명시하므로 RUM 산정에 쓰지 않습니다 `✓`.

### 2.2 블렌디드 압축비 & on-disk 구성비 — 재계산 가능한 산식

raw 볼륨 구성비(가정: 리플레이 65% / 로그 20% / 트레이스 13% / 메트릭 2% `≈`)를 시그널 압축비로 가중합니다:

```
on-disk 분율 = 0.65/5 + 0.20/10 + 0.13/10 + 0.02/8
            = 0.130 + 0.020 + 0.013 + 0.0025 = 0.1655
블렌디드 압축비 = 1 / 0.1655 ≈ 6.0x   (민감도 밴드 5x 보수 ~ 8x 낙관)
```

on-disk에서는 리플레이 비중이 raw보다 더 커집니다 — 리플레이가 압축되지 않으니까:

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

이 표가 §4 전체 산정의 입력입니다. `≈` — staging에서 §1 콜아웃 쿼리로 압축비를 실측해 밴드를 좁혀야 합니다.

## 3. 캐파의 지렛대 — 리플레이는 "안 쌓인다"

리플레이가 안 쌓인다는 사실이 이 페이지에서 가장 중요합니다. TTL 정책의 기준 문서 {{< relref "03-s3-cold-tiering.md" >}}은 이렇게 정합니다:

- `hyperdx_sessions`(리플레이): hot(gp3)만 쓰고 S3로 내리지 않고 30일 후 DELETE 합니다. 오래된 리플레이는 거의 안 보는데 볼륨을 지배하므로 S3 이전조차 낭비입니다.
- `otel_logs`/`otel_traces`: hot 14일 → `TO VOLUME 'cold'`(S3) → 지평별 DELETE.
- `otel_metrics_*`: hot 30일 → S3 → 지평별 DELETE.

on-disk의 78.5%를 차지하는 리플레이가 30일 상한으로 잘리고 S3로도 안 가면, 리플레이는 시간이 지나도 누적되지 않습니다(steady-state ~0.55TB 단일). 누적을 만드는 건 나머지 ~22%(로그+트레이스+메트릭 ≈ 0.15TB/월)뿐입니다.

{{< callout type="important" >}}
"0.7TB × 12개월 = 8.4TB" 순진한 누적은 틀립니다. 그 계산은 리플레이가 계속 쌓인다고 가정하지만 리플레이는 30일 DELETE라 steady-state에 머뭅니다. 실제 1년 누적(단일사본)은 리플레이 고정분 ~0.55TB + 누적분(로그/트레이스/메트릭) ~1.8TB ≈ ~2.35TB고 차이 ~6TB가 전부 "안 쌓이는 리플레이"입니다. 이 숫자 때문에 리플레이 TTL을 로그/트레이스와 분리해 짧게 잡는 것이 캐파·비용의 단일 최대 절감 노브입니다. `≈`
{{< /callout >}}

## 4. 보관 지평별 산정 — 3/6/12개월 워크드 모델 (해석 B)

### 4.1 공통 가정

- hot 창(EBS gp3): 리플레이·메트릭 30일, 로그·트레이스 14일({{< relref "03-s3-cold-tiering.md" >}} 기준 문서와 정합). hot 창 밖은 로그/트레이스/메트릭만 S3 cold로 보내고 리플레이는 DELETE 합니다.
- cold도 replica마다 사본을 둡니다(self-host S3 = shared-nothing, UltraWarm식 단일사본 절감 없음, {{< relref "../../clickhouse/02-storage-local-nvme.md" >}}) → cold도 ×RF.
- 머지 헤드룸 = hot gp3에 +40%(30~40% 여유; 디스크가 차면 머지 중단·TOO_MANY_PARTS·인서트 차단) `✓/≈`.
- 노드 = EBS-first Graviton r7g(메모리 최적, RUM 쿼리는 page cache 이점). r8g(Graviton4)는 여유 시 각주 옵션 `≈`.

### 4.2 지평별 누적·hot·cold (단일사본 & RF 배수) `≈`

리플레이 hot 고정분(~0.55TB)에 로그/트레이스(hot 14일)·메트릭(hot 30일) hot 잔량(~0.076TB)을 더하면 hot 단일 ≈ 0.63TB로, 지평과 무관하게 고정입니다. cold는 로그/트레이스/메트릭이 hot 창을 지나 DELETE 지평까지 쌓인 양입니다.

| 지평(로그/트레이스 DELETE) | 누적 on-disk(단일) | ×RF2 | ×RF3 | hot(단일, 고정) | cold S3(단일) |
|---|---|---|---|---|---|
| **3개월**(90일) | ~1.0 TB | ~2.0 TB | ~3.0 TB | ~0.63 TB | ~0.37 TB |
| **6개월**(180일) | ~1.45 TB | ~2.9 TB | ~4.35 TB | ~0.63 TB | ~0.82 TB |
| **12개월**(365일) | ~2.35 TB | ~4.7 TB | ~7.05 TB | ~0.63 TB | ~1.72 TB |

*(cold = Σ 로그·트레이스·메트릭 월생성 − hot 잔량, DELETE 지평까지. 리플레이는 30일 DELETE라 누적 기여 0. 메트릭 DELETE는 180/365일.)*

hot은 지평이 늘어도 ~0.63TB로 고정되고 늘어나는 건 오직 싼 cold S3입니다.

### 4.3 물리 배치 — hot gp3 / cold S3 (RF2 기준)

| 지평 | hot gp3 물리(×RF2, +40%) | cold S3 물리(×RF2) | 백업(단일, Glacier IR) |
|---|---|---|---|
| 3개월 | 0.63×2×1.4 ≈ 1.76 → **~2.0 TB** | 0.37×2 = **0.74 TB** | ~0.45 TB |
| 6개월 | **~2.0 TB**(고정) | 0.82×2 = **1.64 TB** | ~0.9 TB |
| 12개월 | **~2.0 TB**(고정) | 1.72×2 = **3.44 TB** | ~1.8 TB |

- hot gp3는 지평과 무관하게 ~2TB로 고정입니다(노드당 ~1TB). gp3 단일 볼륨 상한 64 TiB에 여유롭게 들어갑니다({{< relref "02-hot-storage-ebs.md" >}}).
- cold S3만 지평에 따라 늘어나므로 1년까지 늘려도 추가 비용은 대부분 서울 $0.025/GB-월의 S3 Standard입니다(단가 정본은 {{< relref "02-hot-storage-ebs.md" >}} §1.3). 백업은 리플레이를 빼고(가치 급감) 로그/트레이스/메트릭만 Glacier IR로 둡니다.

### 4.4 노드/shard/replica — 지평 무관 고정 `≈`

이 규모(hot 물리 ~2TB, raw ingest ~4.2TB/월 ≈ 평균 1.6 MB/s, 피크 ×5 ≈ 8 MB/s)에서:

- 인제스트 CPU: ClickStack "10 MB/s당 1 vCPU" → 피크 8MB/s = <1 vCPU `Ⓥ`. 무시 수준입니다.
- 쿼리: RUM 대시보드·세션 검색 위주라 light~moderate고 page cache가 hot을 흡수합니다.
- 결론: 1 shard × 2 replica(RF2)로 1년+ 충분합니다. 샤딩은 불필요합니다(조기 수평 확장은 안티패턴). RF3는 임의 2대 동시 유실 방어가 필요할 때만 씁니다({{< relref "../../clickhouse/04-deployment-playbook.md" >}}).

| 컴포넌트 | 권장(prod) | 사양 | 근거 |
|---|---|---|---|
| ClickHouse 데이터 노드 | **2× r7g.2xlarge**(RF2), +1대(RF3) | 8 vCPU / 64 GB / gp3 ~1TB | 인제스트·쿼리 여유 `≈` |
| ClickHouse Keeper | **3× t4g.medium** | 2 vCPU / 4 GB / gp3 20GB(영속) | 정족수 3, 4GB면 충분 `✓` → [05-keeper]({{< relref "05-keeper.md" >}}) |
| MongoDB | **3-member t4g.small**(또는 Atlas) | 2 vCPU / 2 GB / gp3 10GB | 메타 수 GB, `members:1`은 HA 아님 `✓` → [rum/07]({{< relref "../../rum/07-hyperdx-mongodb.md" >}}) |
| OTel Collector | gateway 2 replica(HPA) | 각 1~2 vCPU | 변환 CPU 여유 |

인스턴스 EBS 대역이 실질 병목입니다. gp3 볼륨 스펙(최대 2,000 MiB/s)보다 인스턴스의 EBS 파이프 상한이 먼저 천장을 칩니다 — r7g.2xlarge의 EBS 대역이 볼륨 스펙보다 낮으므로 노드 사이즈업이 볼륨 프로비저닝보다 먼저 효과를 냅니다({{< relref "../../clickhouse/02-storage-local-nvme.md" >}}) `✓`. 이 스케일(피크 8MB/s)에선 둘 다 여유라 무관하지만 성장 시 이 순서를 기억합니다.

lean 옵션도 있습니다. 쿼리가 가벼우면 2× r7g.xlarge(4vCPU/32GB)로 낮춰도 됩니다. 헤드룸을 감안해 2xlarge를 권장합니다.

### 4.5 Keeper·MongoDB — 데이터량과 무관하게 소형 고정

- Keeper: 정족수 3(1 장애 허용), 4GB RAM·gp3 20GB면 충분합니다. Keeper 부하는 데이터량보다 INSERT 빈도·파트 생성 수에 비례하므로 지평이 늘어도 커지지 않습니다({{< relref "05-keeper.md" >}}) `✓`.
- MongoDB: 메타데이터(user/dashboard/alert/source) 전용이고 데이터셋은 수 GB입니다. `members:3`이 값싼 HA 보험이고 인제스트 경로 밖이라 규모와 무관합니다({{< relref "../../rum/07-hyperdx-mongodb.md" >}}) `✓`.

### 4.6 월 비용 산정 (해석 B, 서울 `ap-northeast-2`, on-demand) `≈`

우리 배포 리전은 서울이므로 절대 금액의 기준선도 서울입니다. GB 단가 rate 자체의 정본은 {{< relref "02-hot-storage-ebs.md" >}} §1.3이고 이 절은 그 rate를 물리량(§4.3)에 곱합니다.

| 항목 | 단가 | 등급 |
|---|---|---|
| gp3 스토리지 | **$0.0912 / GB-월** | `✓` — 서울 실단가 |
| S3 Standard(첫 50TB) | **$0.025 / GB-월** | `✓` — 서울 실단가 |
| ⇒ 블록↔오브젝트 배수 | **gp3 = S3의 3.65x** | `✓` |
| gp3 provisioned IOPS·throughput 초과분 | us-east-1 $0.005/IOPS·$0.04/MBps + 10~15% 어림 | `≈`, 서울 단가 미확인 `?` |
| Glacier IR | $0.004 / GB-월 (us-east-1 값) | `≈`, 서울 단가 미확인 `?` |
| S3 요청 | PUT **$4.50/M**(=$0.0045/1k) · GET **$0.35/M** · DELETE 무료 | `✓` — 서울 |
| 인스턴스 시급 | us-east-1 추정치 × 리전 계수 | `≈` (AWS Calculator로 확정 권장) |

리전 환산 규칙 하나로 이 절의 모든 금액이 재현됩니다. 서울 단가를 아는 항목(gp3 GB · S3 GB · S3 요청)은 서울 단가로 직접 곱하고 모르는 항목(인스턴스 · Glacier IR · cross-AZ 전송)은 us-east-1 값 × 1.1~1.15로 어림합니다. 그 계수는 스토리지 차원에서 실단가로 검증됐습니다 — gp3 $0.08→$0.0912는 +14.0%로 밴드 안이고 S3 $0.023→$0.025는 +8.7%로 밴드 바로 아래입니다 `Σ`. 배수는 us-east-1 3.48x → 서울 3.65x로 서울에서 오히려 조금 벌어지므로 티어링 결론은 리전을 바꿔도 뒤집히지 않습니다 `Σ`.

요청 축은 GB 축과 별개입니다 — 서울 PUT $4.50/M은 GET $0.35/M의 ~13배이고 `✓`, 여기에 part 파일 수가 곱해집니다. 그런데 우리 설계는 머지를 hot에서 끝내므로 S3 쓰기가 이동 1회뿐입니다 — 그 구조와 `prefer_not_to_merge`를 안 켜는 비용 논거는 [S3 콜드 티어링]({{< relref "03-s3-cold-tiering.md" >}}) §5.6이 정본이고 이 절은 위 표의 단가와 아래 PUT 금액만 계상합니다.

고정 컴포넌트(지평 무관):

```
컴퓨트  2× r7g.2xlarge = 2 × $0.4284/hr × 730 ≈ $626 (us-east-1 추정) ×1.1~1.15 ≈ $690~720
Keeper  3× t4g.medium = 3 × $0.0336/hr × 730 ≈ $74  ×1.1~1.15 ≈ $81~85
                      + gp3 60GB × $0.0912 ≈ $5                       ≈ $86~90
Mongo   3× t4g.small  = 3 × $0.0168/hr × 730 ≈ $37  ×1.1~1.15 ≈ $41~43
                      + gp3 30GB × $0.0912 ≈ $3                       ≈ $44~46
hot gp3 2.0TB         = 2,000GB × $0.0912 (baseline IOPS·throughput 무료)  ≈ $182
──────────────────────────────────────────────────────────────────────────────
고정 소계 ≈ $1,000 ~ $1,040/mo      (us-east-1 원 산정 $904 대비 +11~15%)
```

지평별 가변(cold S3 + 요청 + 백업 + cross-AZ 전송, RF2):

| 지평(RF2) | cold S3(서울 $0.025) | PUT | 백업(Glacier IR) | cross-AZ 전송 | **월 총계(서울, on-demand)** | 1yr SP 적용* |
|---|---|---|---|---|---|---|
| 3개월 | 740GB×$0.025 = **$19** | ~$7 | 450GB×$0.004 ≈ $2 | ~$44~46 | **~$1,070~1,110/mo** | ~$750~775/mo |
| 6개월 | 1,640GB×$0.025 = **$41** | ~$9 | 900GB×$0.004 ≈ $4 | ~$50~52 | **~$1,110~1,145/mo** | ~$780~805/mo |
| 12개월 | 3,440GB×$0.025 = **$86** | ~$11 | 1,800GB×$0.004 ≈ $7 | ~$55~58 | **~$1,160~1,200/mo** | ~$840~860/mo |

*1yr Savings Plan은 컴퓨트에만 ~40% 적용되고 스토리지·S3·전송은 정가입니다 `≈`. 백업·전송 열은 리전 계수를 적용한 값이고 PUT은 건수를 원 산정과 동일하게 두고 단가만 서울로 바꿔 us-east-1 대비 −10%입니다 `≈`.

RF3(12개월, 서울): 컴퓨트 3대 $938×1.1~1.15 ≈ $1,032~1,079 + hot gp3 3TB(3,000GB×$0.0912) ≈ $274 + cold S3 ×RF3=5.16TB(5,160GB×$0.025) ≈ $129 + Keeper/Mongo $118×1.1~1.15 ≈ $130~136 + (백업 $7 + 전송 $70)×1.1~1.15 ≈ $85~89 ⇒ ~$1,650~1,710/mo(on-demand), 1yr SP ~$1,185~1,220/mo `≈`.

hot gp3·컴퓨트·Keeper·Mongo는 지평과 무관하게 ~$1.0K로 고정입니다. 3→12개월 확장 비용은 거의 전부 S3 cold입니다(×RF2 기준 $19→$86 증가). 긴 보관이 싼 이유는 EBS가 아니라 S3에 쌓이고 볼륨 지배자인 리플레이가 30일에 잘리기 때문입니다. Datadog RUM으로 같은 워크로드(≈월 22M 세션)를 태우면 [RUM 문서]({{< relref "../../rum/_index.md" >}}) 기준 블렌디드 ~$0.42/1k → 연 수만~십수만 $대인데, self-host는 월 ~$1.1~1.2K(연 ~$14K)로 수 배~10배 절감입니다(단 people TCO 별도, {{< relref "../../clickhouse/01-managed-vs-selfhosted.md" >}}).

us-east-1과 대조해 보면, 같은 물리량을 us-east-1 단가로 계산한 원 산정은 고정 소계 $904 / 총계 3개월 $971 · 6개월 $1,001 · 12개월 $1,052(1yr SP $720 / $750 / $800), RF3 12개월 ~$1,500(SP ~$1,150)이었습니다 `≈`. 서울과의 차이는 스토리지 실단가(+14.0% / +8.7%)와 나머지 항목의 리전 계수(×1.1~1.15)뿐이고 비율이 유사해 지평·티어링 결론은 그대로입니다. 그래도 서울 기준으로 견적을 쓰는 이유는 그대로 제출할 숫자가 필요해서입니다.

### 4.7 대조 — 해석 A(raw 0.7TB/월 = on-disk 117GB/월)

{{% details title="해석 A 산정표 — us-east-1 원 산정 + 서울 환산" closed="true" %}}
| 지평(RF2) | 누적 단일 | hot gp3(×RF2,+40%) | cold S3(×RF2) | 노드 | **월 총계(us-east-1)** |
|---|---|---|---|---|---|
| 3개월 | ~0.17TB | ~0.33TB → $26 | ~0.06TB → $3 | 2× r7g.xlarge | **~$430/mo** |
| 12개월 | ~0.4TB | ~0.33TB → $26 | ~0.3TB → $14 | 2× r7g.xlarge | **~$500/mo** |

위 표는 us-east-1 단가로 쓴 원 산정입니다. §4.6의 리전 환산 규칙을 그대로 적용하면(gp3 330GB×$0.0912 ≈ $30, S3는 서울 단가, 나머지 ×1.1~1.15) 서울 총계는 3개월 ~$470~490 / 12개월 ~$550~570 ≈ ~$0.5~0.6K/mo 입니다 `≈`.

해석 A면 배포가 아주 작습니다 — 2× 소형 노드 + Keeper 3 + Mongo 3로 충분하고 hot이 수백 GB라 gp3 볼륨 하나로 끝납니다. 0.7TB가 wire 볼륨이면 배포는 "staging 확대판" 수준입니다. 어느 해석인지 확인하는 것(§1 콜아웃)만 하면 사이징은 끝납니다. `≈`
{{% /details %}}

## 5. gp3면 충분 — io2 트리거는 도달 안 함

gp3 vs io2 Block Express 실전 스펙(gp3 80,000 IOPS/2,000 MiB/s/64TiB `✓`, io2 BE 256,000 IOPS/4,000 MiB/s/99.999% `✓`)·요금 3분해는 {{< relref "02-hot-storage-ebs.md" >}}가 기준 문서입니다. 캐파 관점의 판단만 요약합니다.

- 우리 hot 물리 ~2TB, 노드당 ~1TB, 인제스트 피크 ~8 MB/s → gp3 baseline 3,000 IOPS + 125 MiB/s로도 대부분 커버합니다. 부족하면 gp3 위로 IOPS/throughput을 싸게 프로비저닝합니다(예: +3,000 IOPS·+125 MiB/s = 추가 ~$15+$5/mo — us-east-1 rate 기준이고 서울 IOPS·throughput 단가는 미확인 `?`이라 이 두 차원만 어림값입니다, {{< relref "02-hot-storage-ebs.md" >}} §1.3).
- 내구성은 gp3(99.8~99.9%)로 충분합니다 — 진짜 내구성은 RF 복제 + 백업이 담당합니다(티어링≠내구성, {{< relref "../../clickhouse/02-storage-local-nvme.md" >}}). io2의 99.999%는 이 스케일에 과잉입니다.
- io2 전환 트리거는 (a) 단일 볼륨 >2,000 MiB/s 지속, (b) >80,000 IOPS/vol, (c) 규제상 볼륨 자체 99.999% 요구입니다. → 0.7TB/월 RUM은 셋 다 도달 안 하므로 io2 채택 근거가 없습니다 `≈`.

## 6. TTL — 지평별 DELETE 변주 (기준 문서는 03)

TTL 정책의 기준 문서(storage_policy·`TO VOLUME 'cold'`·`move_factor` 안전판·시간 컬럼명 확인)는 {{< relref "03-s3-cold-tiering.md" >}}에 있습니다. 여기서 재정의하지 않습니다 — 캐파 지평에 따라 달라지는 건 오직 DELETE 간격뿐입니다.

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

`materialize_ttl_after_modify = 0`으로 기존 파트 즉시 재작성을 피해 운영 중 부하 폭증을 막습니다 `≈`. 시간 컬럼명(`Timestamp`/`TimestampTime`/`TimeUnix`)은 테이블마다 다를 수 있으니 `SHOW CREATE TABLE`로 확인한 뒤 적용합니다 `?`. ClickStack OSS 기본 TTL은 `${TABLES_TTL}` 단일값(문서상 3일)이며 위 값은 우리 권장 오버라이드입니다 — 배포 시 실 스키마로 확정합니다 `?`.

## 7. staging vs prod — 규모 차이

staging은 "동작 검증 + 실측 캘리브레이션"이 목적이므로 샘플링 축소 + 단일 replica + 짧은 TTL로 극소화합니다.

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
| 월 비용(서울) `≈` | **~$170~290/mo** | ~$1.1~1.2K/mo |

staging의 진짜 역할은 실측 캘리브레이션입니다. §2 압축비·구성비·세션당 KB는 전부 `≈`입니다. staging에서 §1 콜아웃 쿼리로 실제 압축비와 세션당 바이트를 측정해 prod 모델의 `≈`을 `✓`으로 바꿉니다. 캐파 관점에서 staging이 필요한 이유입니다.

## 8. 성장 버퍼 & 경보 기준

### 8.1 디스크 헤드룸 — 여유 공간이 곧 안정성 `✓/≈`

- 머지는 여유 공간을 먹습니다. 병합 대상 파트 합만큼의 여유가 필요하고 디스크가 차면 머지 중단 → 파트 누적 → TOO_MANY_PARTS → 인서트 차단으로 이어집니다.
- hot gp3 사용률 경보는 70% 경고 / 80% 조치 / 85% 하드실링입니다. hot 볼륨은 항상 30~40% 여유를 둡니다(§4.1 헤드룸).

### 8.2 경보 항목 & 증설 트리거 `≈`

| 신호 | 경보 임계 | 조치 |
|---|---|---|
| hot gp3 사용률 | >80% | gp3 온라인 확장(무중단) 또는 TTL 단축·cold 이동 가속 |
| 파티션당 active parts | >300 | 배치/async insert 튜닝, 파티션 키 카디널리티 점검 |
| 인제스트 지연/큐 | 지속 증가 | collector 스케일아웃, 배치 크기↑ |
| 데이터 노드 CPU | 지속 >70% | replica 추가(읽기) 또는 노드 사이즈업 |
| Keeper 지연/디스크 | znode↑·gp3 80% | Keeper 디스크 확장, 작은 인서트 제거 |

### 8.3 언제 shard / io2 / RF3로 가나 `≈`

- shard 추가: 이 워크로드는 1년+ 불필요합니다. 트리거는 (a) hot 단일사본/노드가 노드 실용 상한(예 4~8TB)에 접근, (b) 머지/쿼리 CPU 지속 포화, (c) 재수화 위험 창을 줄이려 노드당 데이터를 낮추고 싶을 때입니다. 신규 shard 스키마·리밸런싱은 수동입니다({{< relref "../../clickhouse/05-altinity-operations.md" >}}).
- io2 전환: §5 — >2,000 MiB/s·>80,000 IOPS/vol·볼륨 99.999% 요구 시. RUM 0.7TB/월엔 도달 안 합니다.
- RF2→RF3: 임의 2대 동시 유실 무손실 또는 재수화 창 동안 2차 장애 방어가 필요할 때입니다. 비용은 컴퓨트+cold S3가 ×1.5. 확률·비용 결정은 {{< relref "../../clickhouse/04-deployment-playbook.md" >}}.

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

## 9. RUM 볼륨 흐름 & 해석 분기

{{< flow src="_flow/10-rum-볼륨-흐름-해석.json" />}}

{{< flow src="_flow/10-rum-볼륨-흐름-해석-2.json" />}}

## 우리 케이스에서는

해석 B(on-disk 0.7TB/월)를 1차 모델로 잡되, 배포 후 `system.parts`로 1회 실측해 raw인지 on-disk인지, 그리고 시그널별 실제 압축비를 확정하는 것이 사이징의 전부입니다 — 이 한 번의 실측이 배포 규모·비용의 2~3배 불확실성을 없앱니다. 실측 전까지는 1 shard × RF2, 2× r7g.2xlarge, hot gp3 노드당 ~1TB, Keeper 3 / MongoDB 3멤버로 시작합니다. 이 구성은 3개월이든 1년이든 hot·컴퓨트가 고정이고 보관을 늘려도 늘어나는 건 싼 S3 cold뿐이라(서울 RF2 3개월 ~$1.07~1.11K/mo → 12개월 ~$1.16~1.20K/mo) 지평 결정을 미뤄도 손해가 없습니다.

가장 확실히 정해 둘 것은 리플레이 TTL 분리입니다. 리플레이는 on-disk의 ~78%를 먹지만 가치는 급감하므로 hot 30일 + S3 미이동 + 30일 DELETE로 잘라 누적에서 빼냅니다({{< relref "03-s3-cold-tiering.md" >}}). 이걸 안 하면 "0.7TB×12=8.4TB"의 함정에 빠져 gp3·S3·백업을 모두 3~4배로 과산정합니다. io2·로컬 NVMe·RF3·샤딩은 §8.3 트리거를 실제로 넘길 때만 승급합니다. 압축비 5x·구성비 65/20/13/2·ClickStack 기본 TTL은 전부 `≈`·`?`이니 staging 실측으로 승격하는 것을 배포 체크리스트 1번에 둡니다. 반대로 GB 단가와 배수는 이미 서울 실단가로 확정됐으므로(gp3 $0.0912 · S3 Standard $0.025 · 3.65x `✓`), 남은 비용 불확실성은 인스턴스 시급·Glacier IR·전송의 서울 단가 `?` 세 항목뿐이고 그건 총액의 개형을 바꾸지 않습니다. 시점 기준 2026-08.
