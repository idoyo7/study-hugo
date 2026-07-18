---
title: "streamAggr vs downsampling"
weight: 7
---

# streamAggr(사전) vs Thanos downsampling(사후) — 핵심 논점

{{< callout type="info" >}}
**한눈에**
- 실전 대결은 **streamAggr**(인제스트 시점 사전 집계, VM 아카이브안) 대 **Thanos compactor downsampling**(사후 집계, Thanos안) — Mimir는 다운샘플링 부재로 즉시 탈락.
- **저장량 축이 결정적**: Thanos 다운샘플링은 공식 문서상 "공간 절감 없음"(공존 시 ~3x)인 반면, streamAggr는 raw의 **10~30%**로 실제 감소한다.
- 의미론·자동성은 Thanos가 우위(사후 재계산 가능, 무설계 5-aggregate 보존)지만, 이 건의 조건(5m 허용 확정+비용 최소+신규 스택 회피)에서는 **streamAggr가 대체로 성립**한다.
- 판정: **VM 아카이브안** 채택, 단 아카이브 검증 전까지 hot 90d raw retention 축소 금지 — **가역적**(RW#4를 Thanos Receive로 교체하면 언제든 전환).
{{< /callout >}}

이 문서는 400d 아카이브의 5m 해상도를 "누가 만드느냐"를 가른다. VM OSS의 **streamAggr**(인제스트 시점 사전 집계, VM 아카이브안)와 **Thanos compactor downsampling**(사후 집계, Thanos안)을 4축으로 대조하고, 판단 기준 트리와 시나리오 ② 비용 종합표(VM아카이브/Thanos/Mimir/확장/확장+Ent)를 확정한다. 비교표·판단 트리·비용 종합표의 주인 문서다 — 다른 문서는 이리로 링크한다.

> 관련 문서: [00 인덱스]({{< relref "_index.md" >}}), [01 문제·2축]({{< relref "01-problem-and-axes.md" >}}), [02 VM 아카이브]({{< relref "02-vm-archive.md" >}}), [03 Thanos]({{< relref "03-thanos-s3.md" >}}), [04 Mimir]({{< relref "04-mimir.md" >}}), [05 VMCluster 확장]({{< relref "05-vmcluster-expansion.md" >}}), [06 단가]({{< relref "06-storage-pricing.md" >}}), [08 권장·하지말것]({{< relref "08-recommendation-and-pitfalls.md" >}})

## 질문의 구조

VM OSS에는 다운샘플링이 없다 — `-downsampling.period`는 Enterprise 전용(contact-sales)이다. "5m 허용" 확정으로 시나리오 ②(raw 90d + 전 메트릭 5m 집계 400d)가 전제가 되면, 남는 질문은 **이 5m을 무엇이 만드는가** 하나로 좁혀진다. 후보는 셋이고, 그중 Mimir는 OSS·GEM·3.0 어디에도 다운샘플링이 없어 이 요구에서 즉시 탈락한다([04]({{< relref "04-mimir.md" >}})). 실전 대결은 **streamAggr(VM 아카이브안)** 대 **Thanos downsampling(Thanos안)**이다.

streamAggr는 라우터 vmagent의 파이프라인 안에서 도는 OSS 기능(v1.87.0+)이다 — VM 인제스트 경로의 위치는 [수집 (vmagent·vminsert)]({{< relref "../victoriametrics/concepts/03-ingestion.md" >}}) 참조. Thanos downsampling은 S3에 raw 블록을 쌓은 뒤 compactor가 배치로 5m/1h 블록을 만든다.

## 4축 비교

| 축 | streamAggr (VM 아카이브안) | Thanos downsampling (Thanos안) |
|---|---|---|
| **확정 시점** | 인제스트 시 확정, 사후 재계산 불가 | raw 보존 기간 내 재계산 가능 (raw 삭제 후엔 동일하게 불가) |
| **출력 형태** | output별 별도 시리즈 — `keep_metric_names`로 이름 보존 가능(카운터→`total`, 게이지→`avg` 2규칙이면 시리즈 ×1, 쿼리 재작성 0) | 시리즈당 5 aggregate(sum/count/min/max/counter) 청크 내장 — `rate()` 등 투명 동작, 무설계 자동 |
| **저장량** | output 1~2개면 raw의 **10~30%** (400d에 0.9~2.7 TiB) | **공간 절감 없음** (공식 문서 명시 — 5m/1h 블록이 raw와 비슷, 공존 시 ~3x). 절감은 raw 삭제(`--retention.resolution-raw`)에서만 |
| **실패 모드** | 프로세스 메모리 상태 — 재시작 시 첫/마지막 interval drop(`flush_on_shutdown`으로 완화) | compactor halt(`thanos_compact_halted=1`) 시 다운샘플·retention 조용히 전면 정지 |

### (a) 확정 시점 — 의미론

streamAggr는 인제스트 시점에 집계가 **확정**된다. 나중에 "p99가 필요했다"라고 깨달아도 재계산은 불가하다. 상태가 프로세스 메모리라 재시작 시 첫/마지막 interval이 기본 drop되고(`flush_on_shutdown: true`로 완화), 카운터는 staleness 초과 후 재등장 시 신규 시리즈로 리셋된다(`rate()`가 리셋을 흡수). Thanos는 raw 블록에서 **사후 계산**하므로 raw 보존 기간 내에는 재계산 여지가 있으나, `--retention.resolution-raw`로 raw를 지운 뒤에는 똑같이 확정 데이터이고 그 5m aggregate도 고정 5종일 뿐이다. **핵심**: "사후 유연성"은 raw를 오래 들고 갈 비용을 낼 때만 실재한다. raw 90d로 자르는 순간 양쪽 다 >90d 구간은 확정 데이터이며, 의미론 격차는 raw 보존 창 안으로 수렴한다.

### (b) 출력 형태 — 쿼리 호환성 (Thanos가 우위)

Thanos 5m 블록은 시리즈당 5개 aggregate를 청크에 내장한다 — 시리즈명·수 불변, 카운터/게이지 구분을 사람이 할 필요가 없다. streamAggr는 output마다 별도 시리즈가 되어 쿼리를 출력명으로 바꿔야 하지만, `keep_metric_names`(단일 output 규칙에서만 허용)로 원래 이름을 보존하면 카운터→`total`·게이지→`avg`의 2규칙 설계에서 시리즈 수 ×1, 쿼리 재작성 0이 된다. 대가는 min/max 동시 보존 포기(스파이크 조사용 `max`를 추가하면 게이지 시리즈 ×2, 별도 이름). **평가**: Thanos는 "무설계로 전부 5종 보존", streamAggr는 "설계한 만큼만, 이름 보존 가능". 재조사 UX(같은 쿼리로 datasource만 전환)는 `keep_metric_names` 설계로 동등해진다.

### (c) 저장량 — streamAggr가 압도 (결정적)

Thanos 공식 문서가 명시한다: 다운샘플링은 **"공간을 절약해 주지 않는다"**. 5m·1h 블록이 raw와 비슷한 크기로 2세트 추가되어 공존 구간 ~3x가 된다. 샘플 수로는 5 aggregates/5m vs 10 raw samples/5m라 ~2x 감소지만, 포인트당 5개 값 + 시리즈 수 불변(인덱스 불변)이 이를 상쇄한다. 실제 절감은 오직 raw 삭제에서 나온다 — 그래서 Thanos안의 400d 5m+1h가 14.9~30.7 TiB로 부풀고 저장비가 VM 아카이브안의 두 배 이상이 된다. streamAggr는 output을 1~2개로 제한하면 샘플 볼륨이 raw의 10~30%로 실제 감소하고, 기본 치환 의미론(또는 `dropInput: true`)으로 raw가 아카이브에 아예 들어가지 않아 400d에 0.9~2.7 TiB에 그친다. **평가**: 목표 함수가 "저장 비용 최소화"라면 이 축이 결정적이다. Thanos 다운샘플링은 장기 쿼리 **속도** 장치이지 비용 장치가 아니다(→ [08 하지 말 것 #3]({{< relref "08-recommendation-and-pitfalls.md" >}})). VM 측 압축·retention 모델은 [저장과 압축]({{< relref "../victoriametrics/concepts/04-storage-and-compression.md" >}}), 서울 리전 단가 비교는 [06]({{< relref "06-storage-pricing.md" >}}).

### (d) 전 메트릭 커버리지의 현실성

`match`는 시리즈 셀렉터이므로 접미사 regex 2규칙(`_total|_count|_sum|_bucket` = 카운터류 → `total`, 나머지 = 게이지 → `avg`)으로 전 메트릭 배타 커버가 가능하다. `by/without`를 지정하지 않으면 입력 시리즈별 시간축 집계만 수행되어 라벨이 보존된다. 히스토그램(classic)의 `_bucket`/`_sum`/`_count`는 per-bucket 카운터라 `total`이 정확히 맞고, `le` 라벨 보존으로 `histogram_quantile(rate(..._bucket[10m]))`이 아카이브에서 그대로 동작한다. **한계**: 접미사 휴리스틱은 완벽하지 않다 — 비표준 네이밍 카운터는 avg로 집계돼 rate 불가, `_total`로 끝나는 게이지는 total로 왜곡된다. 드라이런에서 오분류 목록을 뽑아 예외 match 규칙으로 보강해야 하고, 전 메트릭 집계 상태가 라우터 vmagent 메모리에 추가되므로 사이징 실측이 필요하다(검증 필요). **평가**: "넓은 커버리지"는 keep-list 없이 2규칙으로 충족되되, Thanos처럼 무설계 자동은 아니다.

## 판단 기준 트리

```
Q1. >90d 구간에도 raw 30s가 필수인가? (규제·감사 등)
 ├─ 예 → 예산 허용: 단순 확장 ($1,642+) / 비용 우선: VM raw 아카이브 (RF1 sc1/st1 + vmbackup, $485~787)
 │        S3 내구성·사후 재계산이 필수면: Thanos-raw400d (~$680~800 + 컴포넌트 4종)
 └─ 아니오, 5m 허용 (← 본 건 확정)
     Q2. 신규 스택(Thanos) 상시 운영 여력이 있는가? (hashring·compactor halt·캐시 계층)
      ├─ 없음/최소화 원함 → VM 아카이브안
      └─ 있음 → Q3. raw의 사후 재계산 보험 + S3 내구성이 집계 확정 리스크보다 중요한가?
           ├─ 예 → Thanos안 (S3 Standard 필수 — IA/GIR 금지)
           └─ 아니오 → VM 아카이브안
     Q3′. MetricsQL 의존(대시보드/vmalert)이 있거나 미확인인가?
      └─ 예 → VM 아카이브안 가중 (Thanos/Mimir는 아카이브 쿼리 PromQL 재작성)
     Q4. Mimir? → 5m 요구에서 항상 탈락. Grafana 멀티테넌시 표준화가 독립 목표이고
                  raw 400d S3 + Kafka 운영을 수용할 때만 별도 검토.
```

본 건은 Q1=아니오(5m 허용 확정) → Q2=최소화 원함 → **VM 아카이브안**으로 흐른다. MetricsQL 보존까지 VM 아카이브안을 가중한다([쿼리·운영 컴포넌트]({{< relref "../victoriametrics/concepts/05-query-and-ops-components.md" >}})의 MetricsQL 기능은 Thanos/Mimir의 PromQL 전용 경로에서 상실된다).

## 시나리오 ② 비용 종합 비교표 (VM아카이브/Thanos/Mimir/확장/확장+Ent)

raw 90d + 전 메트릭 5m 집계 400d, 월 저장비 기준(컴퓨트 별도). 공통 수식은 `hot(90d) = U×(90/80)×0.0912 = $369`, `아카이브(VM 아카이브안) = δ×400×f×단가`(δ=22.5 GiB/day, f=집계 축소율 0.1~0.3).

| 옵션 | 저장 구성 | 월 저장비 | 5m 구현 방식 |
|---|---|---|---|
| **VM아카이브** ★권장 | hot 90d $369 + 집계 0.9~2.7 TiB sc1 ($16~47) | **$385~416** (st1: $415~507) | streamAggr(인제스트 시점, OSS) |
| **Thanos** | hot 90d $369 + S3 14.9~30.7 TiB ($374~767) + 로컬 EBS·컴퓨트 | **$780~1,200 + 컴퓨트** | compactor downsampling(사후) |
| **Mimir** | — | **부적합** | 다운샘플링 부재 (raw로 가면 시나리오 ① 경제성) |
| **확장** | — (OSS로 5m 불가) | 참고용 | — |
| **확장+Ent** | 90d raw + 310d 5m ≈ 5,445 GiB | **~$497 + 라이선스(비공개)** | `-downsampling.period=90d:5m` 한 줄 |

**불확실성 명시**: VM 아카이브안의 f=0.1~0.3은 [샘플 수 축소] + [인덱스 몫(~20%, 시리즈 수는 안 줄음)] + [집계값 압축률 저하 가능성]의 합이며 **드라이런 2주 실측이 확정치**(검증 필요)다. Thanos안의 S3 범위(14.9~30.7 TiB)는 "5m·1h 블록이 raw와 비슷"이라는 공식 서술의 해석 폭이다. 모든 수치는 3.6 TiB 100% 사용 상한 가정이므로 실측 사용률로 선형 보정한다. 옵션별 상세 저장 구성은 각 옵션 문서([02]({{< relref "02-vm-archive.md" >}})/[03]({{< relref "03-thanos-s3.md" >}})/[04]({{< relref "04-mimir.md" >}})/[05]({{< relref "05-vmcluster-expansion.md" >}})), 시나리오 ① 표는 [01]({{< relref "01-problem-and-axes.md" >}}).

## 판정

의미론·자동성은 Thanos가 낫고, 저장량·운영 표면·MetricsQL 보존은 streamAggr가 낫다. 일반론으로는 **불완전한 대체**지만, 이 사용자는 (i) 5m 허용을 이미 확정했고 (ii) 비용 최소가 목표이며 (iii) 신규 stateful 스택 3~4종의 대가가 크므로 — "5m 허용 + 비용 최소 + 신규 스택 회피"라는 이 건의 조건에서는 **streamAggr(VM 아카이브안)가 대체로 성립한다.**

남는 잔여 리스크는 "확정 집계가 재조사에 부족할 가능성"이다. 이는 **hot 90d raw가 최근 장애의 golden window를 담당하고, >90d 재조사는 추세·수준 비교가 주**라는 전제로 수용한다. 그래서 아카이브 검증 전 hot retention을 축소하지 않는다 — streamAggr 집계는 인제스트 시점 확정이라 hot raw가 유일한 재계산 원본이다(→ [08 하지 말 것 #10]({{< relref "08-recommendation-and-pitfalls.md" >}})). 이 구조는 가역적이다: RW#4를 Thanos Receive로 갈아끼우면 언제든 Thanos안으로 전환된다.

## 출처

- `/home/mont/evejuni/monitoring/longterm-400d/README.md` — §2 비용 비교표, §3 판단 기준 트리, §4 핵심 논점(streamAggr vs downsampling)
- `/home/mont/evejuni/monitoring/longterm-400d/99-full-report.md` — §3 비용 모델 표(시나리오 ②), §3-1 핵심 질문(streamAggr 대체 가능성 축별 분석), §4 판단 기준 트리
