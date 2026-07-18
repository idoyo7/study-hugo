---
title: "VictoriaMetrics"
weight: 2
aliases: ["/monitoring/longterm-retention/02-option-a-vm-archive/"]
---

# VictoriaMetrics 아카이브 — 라우터 RW#4 + streamAggr 5m → vmsingle 400d

{{< callout type="info" >}}
**한눈에**
- 권장안: 기존 라우터 vmagent에 **RW#4를 추가**, streamAggr로 전 메트릭을 5m 집계해 별도 **vmsingle-archive**(400d, RF1)에 적재한다 — 신규 기술 0.
- 월 **$385~416**, 단순 확장안($1,642) 대비 **~70% 절감**. hot(raw 90d)은 그대로 유지되고, `keep_metric_names`로 기존 쿼리·대시보드가 그대로 동작한다.
- 리스크: 집계는 **인제스트 시점 확정**이라 사후 재계산 불가, **RF1**이라 vmbackup으로 이중화를 보완, 접미사 휴리스틱 오분류 가능성.
- **가역적** — RW#4를 Thanos Receive로 교체하면 Thanos안으로 전환된다. 드라이런 2주로 집계 축소율(f)을 실측한 뒤 확정한다.
{{< /callout >}}

기존 chain 라우터 vmagent에 remoteWrite 하나(RW#4)를 더하고, 그 URL에만 5m 스트림 집계를 걸어 전 메트릭을 별도 vmsingle-archive(400d, VM OSS만)로 흘려보내는 권장안이다. 신규 기술 0, 월 저장비 $385~416, 단순 확장안 대비 약 70% 절감을 얻는다.

> 관련 블록: [01 문제·2축]({{< relref "01-problem-and-axes.md" >}}), [03 Thanos]({{< relref "03-thanos-s3.md" >}}), [05 VMCluster 확장]({{< relref "05-vmcluster-expansion.md" >}}), [06 스토리지 단가]({{< relref "06-storage-pricing.md" >}}), [07 streamAggr vs downsampling]({{< relref "07-streamaggr-vs-downsampling.md" >}}), [08 권장·하지말것]({{< relref "08-recommendation-and-pitfalls.md" >}})

## 한 줄 요약

per-URL 스트림 집계(streamAggr, OSS)로 **전 메트릭을 5m 해상도로 치환**해서 별도 vmsingle(`-retentionPeriod=400d`, RF1, 저가 EBS)에 적재한다. 라우터 vmagent 패턴에 RW#4 하나를 추가하는 것 외에 새로 배우거나 배포할 스택이 없다. streamAggr·vmagent 파이프라인의 개념은 VM 챕터의 [03 인제스트]({{< relref "../victoriametrics/concepts/03-ingestion.md" >}}), vmsingle의 저장·압축은 [04 저장·압축]({{< relref "../victoriametrics/concepts/04-storage-and-compression.md" >}})을 참조한다.

## 아키텍처

```
[service — 무상태, 변경 없음]
  vmagent ──(Istio ingress, remote_write)──▶
[chain]
  라우터 vmagent ──RW#1──▶ VMCluster hot (raw, 90d, RF2, gp3)     ← 기존
              │──RW#2──▶ keep-list tier                            ← 기존 설계
              │──RW#3──▶ 집계 tier                                 ← 기존 설계
              └──RW#4──▶ [per-URL streamAggr: 5m, 전 메트릭 치환]
                          └─▶ vmsingle-archive (400d, RF1, EBS PVC)
                               └─(CronJob) vmbackup → S3   ← DR용 콜드 사본
Grafana: DS#1 vmselect(≤90d raw) / DS#2 vmsingle-archive(>90d, 5m)
```

집계는 **RW#4에만** 걸리므로 hot(RW#1) raw는 그대로 90d 유지된다. hot이 최근 장애의 golden window를 담당하고, 아카이브는 >90d 추세·수준 비교를 담당하는 2계층 구조다.

## 핵심 설정 (검증된 필드만)

전 메트릭을 접미사 regex 2규칙으로 배타 커버한다 — 카운터류는 `total`, 나머지 게이지는 `avg`. 두 규칙 모두 `keep_metric_names: true`라 원래 메트릭 이름이 보존된다.

```yaml
# 라우터 VMAgent — RW#4
remoteWrite:
  - url: http://vmsingle-archive.monitoring.svc:8428/api/v1/write
    streamAggrConfig:
      rules:
        - match: '{__name__=~".+(_total|_count|_sum|_bucket)"}'   # 카운터류(히스토그램 포함)
          interval: 5m
          outputs: [total]
          keep_metric_names: true       # 단일 output일 때만 허용 — 원래 이름 유지 → rate() 그대로
          flush_on_shutdown: true       # 재시작 시 첫/마지막 interval drop 방지
        - match: '{__name__!~".+(_total|_count|_sum|_bucket)"}'   # 나머지 = 게이지 가정
          interval: 5m
          outputs: [avg]                # 스파이크 조사용 max 필요 시 별도 규칙 추가(시리즈 ×2)
          keep_metric_names: true
          flush_on_shutdown: true
```

```yaml
# vmsingle-archive (VMSingle CR)
spec:
  retentionPeriod: "400d"
  storage:                    # 시작은 gp3 권장(기본값) — 06 문서 참조. 최적화 시 st1/sc1
    resources: { requests: { storage: 1.5Ti } }   # f 실측 후 조정 (0.9~2.7 TiB 예상)
```

### 전 메트릭 커버리지 원리

- **배타 커버**: 접미사 regex 2규칙이 서로 배타적으로 전체를 덮는다. `by/without` 미지정 → 입력 시리즈별 라벨 보존, 시간축 집계만 수행한다. match된 raw는 집계 산출물로 **치환**되므로 아카이브에 raw가 유출되지 않는다.
- **히스토그램(classic)**: `_bucket`은 per-bucket 카운터라 `total`이 정확히 맞고 `le`가 보존돼 `histogram_quantile(rate(..._bucket[10m]))`이 아카이브에서 그대로 동작한다(5m 입도).
- **쿼리 보존**: `keep_metric_names` 덕에 기존 대시보드·vmalert 쿼리가 **datasource 전환만으로** 동작한다. 아카이브도 VM이므로 MetricsQL이 그대로 유지된다 — MetricsQL/PromQL·vmselect는 VM 챕터 [05 쿼리·운영 컴포넌트]({{< relref "../victoriametrics/concepts/05-query-and-ops-components.md" >}}) 참조. 이로써 미확인 MetricsQL 의존도 리스크가 자동 소멸한다.

## 비용

시나리오 ②(raw 90d + 전 메트릭 5m 집계 400d) 기준. 아카이브 저장량은 `δ × 400d × f`로 산출하며, f(집계 축소율)는 드라이런 실측 확정 대상이다.

```
아카이브 = δ × 400d × f × 단가
  δ = 22.5 GiB/day (사본 1개; 3.6 TiB/80d/RF2 상한 가정)
  f = 집계 축소율 0.1~0.3 (샘플 수 1/10 + 인덱스 몫 + 집계값 압축률 저하 감안 — 실측 확정)
  → 0.9~2.7 TiB
```

| 볼륨 타입 | 아카이브 월비용 | 총액 (hot 90d $369 포함) |
|---|---|---|
| gp3 ($0.0912) | $82~246 | **$451~615** ← 시작 권장 |
| st1 ($0.051) | $46~138 | $415~507 |
| sc1 ($0.0174) | $16~47 | **$385~416** ← 최저가 (IOPS 검증 후) |

+ 선택: vmbackup S3-IA 콜드 사본 $12~37/mo.

핵심은 **단순 확장안($1,642/mo) 대비 약 70% 절감**이라는 점이다. 확장안이 비싼 이유(gp3 단가 × RF2)는 [05 VMCluster 확장]({{< relref "05-vmcluster-expansion.md" >}})에서, 4안 종합 비용표·판단 트리는 [07 핵심논점]({{< relref "07-streamaggr-vs-downsampling.md" >}})에서, 서울 리전 단가 상세는 [06 스토리지 단가]({{< relref "06-storage-pricing.md" >}})에서 다룬다.

## 강점과 리스크

**강점**

- 4안 중 최저 비용(확장안 대비 ~70%↓), 신규 stateful 컴포넌트 1개(vmsingle)뿐이며 그마저 기존과 동일 기술스택 — **신규 기술 학습 0**.
- MetricsQL·기존 대시보드 쿼리 보존 → 의존도 미확인 리스크 소멸.
- service 무상태 원칙 무영향. 기존 라우터 설계에 RW 하나 추가로 자연 결합.
- **가역적** — RW#4 대상만 교체하면 Thanos안으로 전환(아래 참조).

**리스크**

| 리스크 | 완화 |
|---|---|
| 집계가 인제스트 시점 **확정** — "나중에 p99 필요"는 불가 | hot 90d raw가 유일한 재계산 원본 → 검증 전 hot 축소 금지 |
| streamAggr 상태 = 프로세스 메모리, 크래시 시 현재 5m 윈도우 유실 | `flush_on_shutdown: true`; 재조사 용도로 수용 가능 수준. 카운터 리셋은 `rate()`가 흡수 |
| 접미사 휴리스틱 오분류(비표준 카운터가 avg로 집계되면 rate 불가) | 드라이런에서 오분류 목록 추출 후 예외 match 규칙 보강 |
| 전 메트릭 집계 상태만큼 라우터 vmagent 메모리 증가 (활성 시리즈 수 비례) | 사이징 실측 필요 (검증 필요) |
| RF1 (아카이브 이중화 없음) | vmbackup 주기 백업으로 보완 — vmbackup/vmrestore·무중단 운영은 VM 챕터 [07 대규모 운영]({{< relref "../victoriametrics/practice/02-operations-at-scale.md" >}}) 참조 |

streamAggr(사전 확정, 재계산 불가) vs Thanos downsampling(사후 재계산 가능, 공간 절감 없음)의 축별 비교와 "이 건에서 성립하는 대체"라는 판정 근거는 [07 핵심논점]({{< relref "07-streamaggr-vs-downsampling.md" >}})에 있다.

## 가역성 (탈출구)

이 구조는 가역적이다. **RW#4는 언제든 Thanos Receive로 갈아끼울 수 있고**, 그렇게 하면 그대로 [03 Thanos안]({{< relref "03-thanos-s3.md" >}})으로 전환된다. 드라이런 실측에서 f가 예상을 크게 벗어나거나 "확정 집계가 재조사에 부족"이 드러나면 그 시점에 재평가하면 된다 — 즉 VM 아카이브안 채택이 Thanos안을 영구 배제하지 않는다.

## 롤아웃

1. vmsingle-archive 배포(gp3로 시작).
2. RW#4 **드라이런 2주**: 일일 GiB 증가율(f 실측) · 시리즈 수 · 카운터 오분류 목록 · rate/histogram_quantile 정합 확인.
3. 예외 규칙 보강 → Grafana DS 추가 + 재조사 대시보드 1개 시범 이관.
4. vmbackup CronJob(S3, 네이티브 증분 — OSS). vmbackupmanager(스케줄 자동화)는 Enterprise라 k8s CronJob으로 직접.
5. (선택) vmctl로 기존 80d raw 시드 [검증 필요].
6. hot retention 80d→90d 상향(+$41/mo) — 아카이브 검증 전까지 hot 축소 금지.

**모니터링**: RW#4의 `vmagent_remotewrite_pending_data_bytes`, 라우터 vmagent 메모리, vmsingle 디스크 증가율. 진행 전 실측 항목 전체 목록은 [08 권장·하지말것]({{< relref "08-recommendation-and-pitfalls.md" >}})에 정리돼 있다.

## 출처

- `01-option-a-vm-archive.md` — A안 아키텍처·핵심 설정·비용 계산·롤아웃·검증된 사실
- `99-full-report.md` §2.1(A안 상세), §5(권장안·구체 설계·탈출구)
- `README.md` §5(권장안 요약·가역성·업계 선례)
