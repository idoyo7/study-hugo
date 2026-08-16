---
title: "스토리지 단가"
weight: 6
---

# 06 · 스토리지 단가 & 볼륨 특성 — 서울 리전

{{< callout type="info" >}}
**한눈에**
- 서울 리전 $/GB·월 서열: **sc1($0.0174) < S3 Standard($0.025) < st1($0.051) < gp3($0.0912)** — "S3라서 싸다"는 성립하지 않습니다.
- S3 IA/Glacier IR은 **GB당 리트리벌 수수료** 때문에 자주 읽는 primary 아카이브에 맞지 않습니다. vmbackup 콜드 사본 전용입니다.
- 아카이브 볼륨은 **gp3로 시작해 IO 실측 후 st1/sc1로 최적화**합니다 — sc1의 250 IOPS 상한이 미검증 리스크입니다. 시나리오②의 절대액 차이(월 $66~199)도 작으니 검증 전 채택은 금지.
- bytes/sample 기준치: **VM ~1B, Prometheus/Thanos ~1.5~2B, Mimir ~2B** — 벤더 베스트케이스는 예산 근거로 쓰지 않습니다.
{{< /callout >}}

서울 리전(ap-northeast-2)의 스토리지 단가와 gp3/st1/sc1/S3의 성능·내구성 특성을 여기 모아 두었습니다. 아카이브 볼륨 타입을 고르는 판단 구조도 함께 담았습니다 — gp3로 시작 → 실측 → st1/sc1 최적화. 단가 상세는 이 문서가 주인입니다.

> 관련 문서: [01 문제·2축]({{< relref "01-problem-and-axes.md" >}}), [02 VM 아카이브 상세]({{< relref "02-vm-archive.md" >}}), [07 핵심논점·비용종합표]({{< relref "07-streamaggr-vs-downsampling.md" >}}) · VM: [스토리지·압축·retention]({{< relref "../victoriametrics/concepts/04-storage-and-compression.md" >}}), [vmbackup/대규모 운영]({{< relref "../victoriametrics/practice/02-operations-at-scale.md" >}})

## 1. 서울 단가표

근거는 **AWS Price List Bulk API(publicationDate 2026-07-10, AmazonEC2/S3 ap-northeast-2)** — 적대적 검증을 통과한 값입니다.

| 스토리지 | $/GB·월 | 성능/제약 | 부대 비용 |
|---|---|---|---|
| **EBS gp3** | **0.0912** | 3,000 IOPS·125 MiB/s 기본, 최대 80k IOPS·2,000 MiB/s(유료), 1 GiB~64 TiB | 추가 IOPS/스루풋 별도 |
| **EBS st1** (throughput HDD) | **0.051** | 기본 40, 버스트 250 MiB/s/TiB, 125 GiB~16 TiB, 최대 500 IOPS | — |
| **EBS sc1** (cold HDD) | **0.0174** | 기본 **12**, 버스트 80 MiB/s/TiB, 125 GiB~16 TiB, **최대 250 IOPS** | — |
| **S3 Standard** | **0.025** (≤50TB) | 11-nines 내구성 | GET $0.0035/1만건, PUT $0.0045/1천건 |
| **S3 Standard-IA** | **0.0138** | 최소 30일·128KB 과금 | **리트리벌 $0.01/GB** |
| **S3 Glacier Instant** | **0.005** | 최소 90일·128KB 과금 | **리트리벌 $0.03/GB** |

표에 붙는 단서가 몇 개 있습니다. 같은 리전 S3↔EC2 전송은 무료입니다. gp3의 용량 상한 1 GiB~64 TiB는 2025-09에 올라간 값이고 IOPS 상한 수치는 모두 1MiB I/O 기준입니다. S3 Standard 단가도 50TB를 넘는 구간부터 0.024/0.023으로 더 내려갑니다.

### 핵심 반전: "S3라서 싸다"는 서울에서 성립하지 않는다

$/GB·월 서열은 이렇습니다:

```
sc1 $0.0174  <  S3 Standard $0.025  <  st1 $0.051  <  gp3 $0.0912
```

**sc1이 S3 Standard보다 싸다**는 뜻입니다. S3를 들이는 실익은 단가가 아니라 **11-nines 내구성 모델과 사후 재계산 여지**입니다. 그 대가로 운영 컴포넌트 수(Receive/StoreGW/Compactor/캐시)와 PromQL 제약을 받습니다. 이 트레이드오프의 비용 종합은 [07 비용 비교표]({{< relref "07-streamaggr-vs-downsampling.md" >}})가 주인입니다.

### IA/Glacier IR은 primary 저장소가 될 수 없다

저장 단가만 떼어 보면 S3 Standard-IA($0.0138)와 Glacier Instant($0.005)는 매력적입니다. 여기에 **GB당 리트리벌 수수료**(IA $0.01/GB, GIR $0.03/GB)가 따라붙습니다. 자주 읽는 primary 아카이브에 못 쓰는 이유가 이것입니다:
- Thanos Store Gateway가 읽는 버킷은 **S3 Standard 필수**.
- IA/GIR는 vmbackup 콜드 사본 전용(복원해야 조회 가능). 상세는 [02 VM 아카이브]({{< relref "02-vm-archive.md" >}})과 [VM 운영 문서]({{< relref "../victoriametrics/practice/02-operations-at-scale.md" >}}).

## 2. 볼륨별 IO/내구성 프로파일

| 볼륨 | 매체 | 처리량 | IOPS 상한 | 내구성 모델 |
|---|---|---|---|---|
| gp3 | SSD | 125 MiB/s 기본, 2,000 MiB/s까지 유료 | 3,000 기본, 80k 유료 | 단일 AZ EBS |
| st1 | throughput HDD | 40→버스트 250 MiB/s/TiB | 최대 500 IOPS(1MiB) | 단일 AZ EBS |
| sc1 | cold HDD | 12→버스트 80 MiB/s/TiB | **최대 250 IOPS(1MiB)** | 단일 AZ EBS |
| S3 Standard | 객체 | 사실상 무제한(요청 과금) | — | 11-nines, 다중 AZ |

- EBS 세 종의 내구성 등급은 같습니다 — 모두 단일 AZ 블록 스토리지입니다. 갈리는 것은 **매체 속도와 IOPS 상한**입니다.
- st1은 gp3 대비 **44% 저렴**하고 스루풋 여유도 커서 **중간 안전지대**로 쓸 수 있습니다.
- 이 챕터에서 가장 중요한 제약은 sc1의 **250 IOPS 상한**입니다 — 아래 3절에서 다룹니다.

## 3. ★ 아카이브 볼륨 타입 선택 가이드 — "gp3 기본 아니야?"에 대한 답

**맞습니다 — 시작은 gp3가 기본값입니다.** 분석이 sc1을 올린 것은 "최저가 옵션"이어서였습니다. 그쪽은 채택 전 검증이 필요한 공격적 최적화입니다.

### 왜 sc1이 후보에 오르나 (아카이브 IO 프로파일)

- **쓰기**: 5m 집계본 인제스트 = 시리즈당 5분에 1샘플 → 수천 samples/s 수준, 초당 수십 KB — 트리비얼합니다.
- **읽기**: 장애 재조사 시에만 간헐 쿼리 — 상시 대시보드 부하가 없습니다.
- VM은 LSM 구조여서 IO가 대체로 순차적이고(머지·압축), VM 문서도 HDD성 스토리지 동작을 인정한다(→ [VM 스토리지·압축]({{< relref "../victoriametrics/concepts/04-storage-and-compression.md" >}})).
- 즉 아카이브는 "거의 안 읽고, 조금씩 쓰는" 워크로드라 cold HDD 프로파일과 이론상 부합합니다.

### 왜 그래도 gp3로 시작하나

1. **sc1의 250 IOPS 상한이 미검증 리스크입니다.** 평상시엔 문제가 없어도 **대형 백그라운드 머지**나 재조사 때 동시에 들어오는 다중 쿼리에서 병목이 날 수 있습니다. 부하 테스트 전 prod 채택은 금지입니다(조사 결론의 [검증 필요] 항목).
2. **절대액 차이가 작다.** 시나리오 ②의 아카이브는 **0.9~2.7 TiB**뿐입니다:

| 볼륨 | 아카이브 월비용 (0.9~2.7 TiB) | gp3 대비 절감 |
|---|---|---|
| gp3 | $82~246 | — |
| st1 | $46~138 | $36~108 |
| sc1 | $16~47 | $66~199 |

   월 **$66~199**을 아끼려고 검증 안 된 스토리지에 400일치 아카이브를 얹는 것은 순서가 틀렸습니다. 맞는 순서는 **gp3로 검증 → IO 실측 → 여유가 크면 st1/sc1로 최적화**입니다.
3. 단, **시나리오 ①(raw 400d, 9~18 TiB)로 가는 경우엔 이야기가 다릅니다** — gp3 $820 vs sc1 $157/월로 차이가 커져 저가 볼륨 검증이 우선순위에 올라옵니다.

### 전환 방법 (나중에 최적화할 때)

- AWS 레벨에서는 EBS Elastic Volumes로 볼륨 타입을 라이브 변경할 수 있다(gp3↔st1↔sc1).
- 다만 k8s에서는 PVC의 StorageClass를 바꿀 수 없습니다. 그래서 정석은 **새 StorageClass·PVC로 vmsingle 재배포 + (필요 시) vmbackup/vmrestore로 데이터 이전**입니다. 아카이브는 유실 허용 등급이라 재축적으로 갈음해도 됩니다.

## 4. bytes/sample 기준치 (비용 모델용, 검증됨)

저장량을 외삽할 때 쓰는 근거값입니다. **벤더 베스트케이스를 예산 근거로 쓰지 마십시오.**

| 엔진 | bytes/sample | 근거 |
|---|---|---|
| VictoriaMetrics | **~1 B** (+인덱스 ~20%, 고카디널리티 >50%) | 공식 가이드. 0.4~0.8B 베스트케이스는 예산 근거 금지 |
| Prometheus/Thanos TSDB | **1.5~2 B** | Prometheus 공식 수치. Thanos는 TSDB 블록 그대로 저장 |
| Mimir | **~2 B** | 공식 보수치 (index+chunk) |

## 5. 빠른 환산 (이 워크로드 기준)

아래 수치는 전부 **3.6 TiB 100% 사용 상한 가정**입니다. 실제 사용률(`vm_data_size_bytes` 실측)로 선형 보정할 것.

```
U(80d, RF2 상한) = 3,600 GiB → δ = 22.5 GiB/day (사본 1)
S ≈ 2.2×10¹⁰ samples/day (~254k samples/s)

hot 90d RF2 gp3                  = 4,050 GiB × 0.0912 = $369/mo
raw 400d RF2 gp3 (단순 확장)      = 18,000 GiB × 0.0912 = $1,642/mo
raw 400d RF1 sc1 (VM raw 아카이브) = 9,000 GiB × 0.0174 = $157/mo (+백업)
5m 집계 400d (VM 아카이브)         = 0.9~2.7 TiB × 단가 → gp3 $82~246 / sc1 $16~47
Thanos S3 (②)                    = 14.9~30.7 TiB × 0.025 = $374~767/mo
```

옵션별 월 저장비 종합(VM아카이브/Thanos/Mimir/확장/확장+Ent)은 이 문서의 몫이 아닙니다 — [07 비용 비교표]({{< relref "07-streamaggr-vs-downsampling.md" >}})가 주인입니다. 여기서 확정하는 것은 볼륨 단가와 단일 볼륨 환산까지입니다.

## 출처

- `05-storage-pricing.md` — 서울 단가표, 볼륨 특성, 아카이브 볼륨 선택 가이드, bytes/sample, 빠른 환산
- `README.md` §1(단가 서열)·§5(스토리지 클래스 판단) — 문제 2축과 gp3 시작 논거
- 원 단가 근거: AWS Price List Bulk API (publicationDate 2026-07-10, AmazonEC2/S3 ap-northeast-2), 적대적 검증 통과
