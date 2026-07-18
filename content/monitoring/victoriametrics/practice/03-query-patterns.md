---
title: "쿼리 패턴"
weight: 3
---

# 03 · 쿼리 패턴 — PromQL에서 MetricsQL까지

{{< callout type="info" >}}
**한눈에**
- 지표 타입이 쿼리를 결정한다 — **Counter는 `rate`/`increase`**, **Gauge는 순간값·`sum`/`avg_over_time`**, **지연 분포는 `histogram_quantile`**, 그리고 차원을 접는 **`sum by`** 가 실전 4대 패턴이다.
- VM 계열 클라이언트의 히스토그램은 `le` 대신 **`vmrange` 버킷**을 쓴다(클래식 `le` 히스토그램도 그대로 저장·쿼리된다) — MetricsQL `histogram_quantile`는 `vmrange`를 그대로 받고, Prometheus 형식이 필요하면 **`prometheus_buckets()`** 로 변환한다.
- **MetricsQL은 PromQL 상위호환**이다 — `rate`/`increase`가 **외삽하지 않고**, range를 생략하면 창을 `max(step, scrape_interval)`로 자동 결정하며, `default_rollup`·`keep_metric_names`·`WITH`·`topk_avg` 등 확장을 더한다.
- **무거운 쿼리(넓은 시간범위 × 고카디널리티)는 vmselect 메모리를 먹는다** — 차원 축소·recording rule 선계산·캐시로 회피하고, 카디널리티는 **`/api/v1/status/tsdb`** 와 vmui **카디널리티 익스플로러**로 점검한다.
{{< /callout >}}

앞선 [01 카디널리티]({{< relref "01-cardinality.md" >}})·[02 대규모 운영]({{< relref "02-operations-at-scale.md" >}})이 "무엇을 저장하고 어떻게 운영하는가"였다면, 이 문서는 **저장한 것을 어떻게 꺼내 읽는가** — 즉 쿼리다. VM은 **PromQL을 그대로 받으면서**, 그 상위호환인 **MetricsQL**로 확장한다. 여기서는 지표 타입별 실전 패턴, MetricsQL만의 확장, 무거운 쿼리의 회피, 그리고 카디널리티 점검 쿼리를 정리한다.

> 이 문서는 다른 문서와 달리 네이버 D2 발표 정독이 아니라 **VictoriaMetrics·Prometheus 공식 문서**를 근거로 한다(문서 말미 출처 참조).

> 관련 문서: [개념 05 쿼리·운영 컴포넌트]({{< relref "../concepts/05-query-and-ops-components.md" >}}) · [01 카디널리티]({{< relref "01-cardinality.md" >}}) · [우리의 운영 03 자기감시 메트릭]({{< relref "../ours/03-self-monitoring-metrics.md" >}})

## 실전 쿼리 패턴 — 지표 타입별

쿼리의 8할은 **지표가 Counter인지 Gauge인지 Histogram인지**에서 갈린다. 타입을 잘못 읽으면 함수 선택이 통째로 틀어진다.

### Counter — rate와 increase

Counter는 **단조 증가**하는 누적값(재시작 시 0으로 리셋)이다. 절댓값 자체는 의미가 없고 **변화율**을 봐야 한다.

```promql
# 초당 평균 증가율 — 대시보드·알람의 기본. 창(5m) 내 평균 기울기.
rate(http_requests_total[5m])

# 창 구간의 총 증가량 — "최근 5분간 몇 건 늘었나"
increase(http_requests_total[5m])

# 순간율 — 최근 두 샘플만 사용. 급변엔 민감하지만 노이즈가 크다.
irate(http_requests_total[1m])
```

- `rate()`는 range 벡터 구간의 **초당 평균 증가율**을 낸다. Counter 리셋을 자동 보정하므로 재시작에도 음수가 튀지 않는다.
- `increase()`는 같은 구간의 **총 증가량**으로, 개념상 `rate() × 구간 길이(초)`다.
- `irate()`는 구간의 **마지막 두 샘플**만 써 순간 기울기를 낸다. 실시간 급변 감지엔 좋지만 알람에는 과민하다.

### Gauge — 순간값과 구간 집계

Gauge는 위아래로 오르내리는 **현재 상태값**(메모리, 큐 길이, 온도)이다. 값 그 자체가 의미이므로 `rate`를 씌우면 안 된다.

```promql
# 현재 값 그대로
node_memory_MemAvailable_bytes

# 순간 집계 — 서비스별 합계(같은 시각의 여러 시계열을 접는다)
sum by (service) (node_memory_MemAvailable_bytes)

# 시간축 집계 — 롤업 함수로 구간의 평균·최대를 낸다
avg_over_time(node_memory_MemAvailable_bytes[5m])
max_over_time(node_memory_MemAvailable_bytes[1h])
```

`sum`/`avg` 같은 **집계 연산자**는 같은 시각의 여러 시계열을 가로로 접고, `*_over_time` **롤업 함수**는 한 시계열을 시간축으로 세로로 접는다. 이 둘의 축이 다르다는 점을 구분해야 한다.

### Histogram — 분위수와 VM의 vmrange

응답시간·요청 크기처럼 **분포**를 봐야 하는 값은 히스토그램으로 수집하고 `histogram_quantile`로 분위수(p50/p90/p99)를 뽑는다.

```promql
# 클래식 히스토그램(le 버킷) — p99 응답시간
histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
```

여기서 VM 특유의 지점이 있다. Prometheus 클래식 히스토그램은 버킷 경계를 **`le`(less-than-or-equal) 레이블**로 표현하지만, VM 계열 클라이언트가 만드는 히스토그램은 버킷을 **`vmrange` 레이블**(`"start...end"` 형태)로 표현한다. 버킷 수를 값 분포에 맞춰 동적으로 잡아 정확도·카디널리티 균형이 낫다.

```promql
# VM vmrange 히스토그램 — MetricsQL의 histogram_quantile는 vmrange를 그대로 받는다
histogram_quantile(0.99, sum by (vmrange) (rate(request_duration_seconds_bucket[5m])))

# Prometheus 형식(le)이 필요할 때 — prometheus_buckets()로 변환한 뒤 계산
histogram_quantile(0.99, prometheus_buckets(sum by (vmrange) (rate(request_duration_seconds_bucket[5m]))))
```

`prometheus_buckets()`는 `vmrange` 버킷을 `le` 버킷으로 바꿔 준다. Grafana의 히트맵 패널처럼 `le`를 전제하는 도구와 붙일 때 유용하다.

### sum by — 차원 축소

집계의 핵심은 **불필요한 레이블 차원을 접어 시계열 수를 줄이는 것**이다. 이는 가독성뿐 아니라 [01 카디널리티]({{< relref "01-cardinality.md" >}})와 직결된다 — 반환 시계열이 적을수록 vmselect가 다룰 메모리도 줄어든다.

```promql
# 파드 단위 시계열을 서비스 단위로 접는다 (pod 레이블을 버린다)
sum by (service) (rate(http_requests_total[5m]))

# 반대로 특정 레이블만 제거하고 나머지는 유지
sum without (pod) (rate(http_requests_total[5m]))
```

`by`는 **남길 레이블**을, `without`은 **버릴 레이블**을 지정한다. `pod`처럼 고카디널리티 레이블을 조회 단계에서 접으면 결과가 극적으로 가벼워진다.

## MetricsQL 확장 — PromQL 상위호환

MetricsQL은 PromQL을 그대로 실행하면서 실전에서 유용한 확장을 더한다. 대표적인 것들을 미니 예시로 본다.

### default_rollup — 맨몸 셀렉터의 기본 롤업

```promql
# 아래 둘은 동일하다 — 맨몸 셀렉터엔 암묵적으로 default_rollup이 적용된다
foo
default_rollup(foo)
```

`default_rollup(m)`은 주어진 lookbehind 창 `d`에서 **마지막 원시 샘플 값**을 반환하며 staleness 마커를 고려한다. range를 생략하면 창은 `max(step, scrape_interval)`로 자동 계산된다. PromQL에서 "함수 없이 셀렉터만 쓰면 어떤 값이 나오는가"가 이 함수로 정의된다.

### rate 동작 차이 — 외삽하지 않는다

MetricsQL의 `rate`/`increase`는 Prometheus와 결과가 미묘하게 다르다. 핵심 차이는 **외삽(extrapolation)이 없다는 것**이다.

```promql
# range를 생략할 수 있다 — 창은 max(step, scrape_interval)로 자동 결정
rate(http_requests_total)
```

- **외삽 없음**: Prometheus `rate`/`increase`는 창 경계에서 값을 외삽해 실제로 관측되지 않은 소수점 증가량이 나오기도 한다. MetricsQL은 외삽하지 않아 "기대한 값"을 그대로 돌려준다.
- **창 직전 샘플 고려**: 창 바로 앞의 샘플까지 계산에 넣어, `step < scrape_interval`일 때 생기는 구멍(빈 구간)을 메운다.
- **range 생략 가능**: 위처럼 `[5m]` 없이 써도 창이 자동으로 잡힌다.

### keep_metric_names — 이름 보존

```promql
# 함수 적용 후에도 지표 이름(__name__)을 유지한다
rate({__name__=~"http_requests_total|http_errors_total"}[5m]) keep_metric_names
```

`rate` 같은 롤업·transform 함수는 기본적으로 `__name__`을 떨어뜨린다. 여러 지표를 한 패널에 겹쳐 그릴 때 이름이 사라지면 범례를 구분할 수 없는데, 함수 뒤에 `keep_metric_names`를 붙이면 이름이 살아남는다.

### WITH 템플릿 — 중복 부분식 제거

```promql
# 반복되는 부분식을 이름으로 묶어 재사용한다
WITH (
  reqs = sum by (service) (rate(http_requests_total[5m]))
)
reqs / ignoring(service) group_left sum(reqs)
```

`WITH` 표현식은 복잡한 쿼리에서 **반복되는 부분식에 이름을 붙여** 가독성과 유지보수성을 높인다. 위처럼 같은 하위 표현을 두 번 이상 쓰는 비율·정규화 쿼리에서 특히 효과적이다.

### topk_avg 등 — 표현력 확장

```promql
# 구간 '평균'이 가장 큰 5개 서비스 (topk는 타임스탬프별 값 기준)
topk_avg(5, sum by (service) (rate(http_requests_total[5m])))
```

`topk_avg(k, q)`는 평균값 기준 상위 `k`개를 반환한다. 타임스탬프별 값 기준인 `topk`, 최댓값 기준인 `topk_max`와 짝을 이루고, 하위를 보는 `bottomk_avg`도 있다. '마지막 값' 기준으로 뽑고 싶다면 `topk_last`가 따로 있다. 순간값의 노이즈에 휘둘리지 않고 "구간 전체로 무거운 시계열"을 찾을 때 `topk_avg`가 낫다.

## 무거운 쿼리 안티패턴과 회피

쿼리 성능 사고는 대부분 **넓은 시간범위 × 고카디널리티**의 곱에서 온다. 반환·처리해야 할 시계열과 데이터포인트가 폭증해 vmselect 메모리와 응답시간을 동시에 악화시킨다.

```promql
# 안티패턴: 고카디널리티 레이블(pod)을 그대로 둔 채 넓은 범위를 조회
sum by (pod) (rate(http_requests_total[5m]))   # pod 수만큼 시계열이 반환된다

# 개선: 조회 목적에 맞는 차원으로 먼저 접는다
sum by (service) (rate(http_requests_total[5m]))
```

회피 원칙은 다음과 같다.

- **차원을 먼저 접는다.** `sum by (service)`처럼 필요한 레이블만 남기면 반환 시계열이 급감한다. `pod`·`instance` 같은 고카디널리티 레이블을 화면에 굳이 펼치지 않는다.
- **rollup 창을 조회 step에 맞춘다.** 창이 너무 작으면 데이터가 비고, 너무 크면(`[1d]`, `[7d]`) 매 step마다 방대한 구간을 재계산해 무거워진다.
- **정규식 매처(`=~`)를 남발하지 않는다.** 정규식 레이블 필터는 인덱스 조회 비용이 크다. 가능하면 정확 매칭(`=`)을 쓴다.
- **무거운 집계는 선계산한다.** 반복되는 무거운 대시보드 쿼리는 vmalert **recording rule**로 미리 계산해 조회 부하를 쓰기 시점으로 옮긴다([개념 05]({{< relref "../concepts/05-query-and-ops-components.md" >}})의 선계산 — 720만 포인트를 1,440개로 줄인 사례).

그리고 vmselect 자체에도 무거운 조회를 완충하는 장치가 있다 — 이는 [개념 05]({{< relref "../concepts/05-query-and-ops-components.md" >}})의 메모리 관리 3포인트와 이어진다.

- **Rollup Result Cache**: 한 번 처리한 쿼리 결과를 캐싱(vmselect 허용 메모리의 12.5%)하되 **최근 5분은 제외**한다. 반복 조회가 많은 대시보드는 이 캐시 덕을 크게 본다.
- **Query Latency Offset**(`search.latencyOffset`, 기본 30초): 가장 최근 30초를 일부러 뒤로 밀어 수집 지연으로 인한 불안정 데이터를 결과에서 뺀다. 실시간성이 중요하면 0으로 줄이되, 새로고침마다 최신 구간이 들쭉날쭉해지는 것을 감수한다.

즉 안티패턴 회피는 **① 쿼리 자체를 가볍게(차원 축소·정확 매칭) → ② 선계산으로 부하 이전 → ③ 캐시·오프셋으로 완충** 의 순서로 접근한다.

## 카디널리티 점검 쿼리·API

무거운 쿼리의 뿌리는 결국 카디널리티다([01 카디널리티]({{< relref "01-cardinality.md" >}})). "지금 무엇이 시계열을 먹고 있는가"는 다음으로 점검한다.

### TSDB 상태 API — /api/v1/status/tsdb

Prometheus 호환 엔드포인트로, 지표 이름·레이블별 시계열 수 상위 N을 돌려준다.

```text
# 시계열 수 상위 10개 (지표 이름별·레이블별)
GET /api/v1/status/tsdb?topN=10

# 특정 날짜로 분석 + 특정 레이블에 집중
GET /api/v1/status/tsdb?topN=10&date=2026-07-18&focusLabel=service

# 셀렉터로 대상 범위를 좁혀서 분석
GET /api/v1/status/tsdb?topN=10&match[]={job="my-service"}
```

주요 응답 필드는 다음과 같다.

| 필드 | 의미 |
|------|------|
| `seriesCountByMetricName` | 지표 이름별 시계열 수 — 어떤 지표가 시계열을 가장 많이 만드는가 |
| `seriesCountByLabelName` | 레이블 이름별 시계열 수 — 어떤 레이블이 카디널리티를 끌어올리는가 |
| `seriesCountByLabelValuePair` | `label=value` 쌍별 시계열 수 — 문제의 정확한 값까지 짚는다 |

### vmui 카디널리티 익스플로러

같은 데이터를 사람이 보기 좋게 시각화한 것이 vmui의 **카디널리티 익스플로러**(vmui의 "Explore cardinality" 탭, 경로 `/vmui/#/cardinality`)다. 시계열이 가장 많은 지표 이름·레이블·`label=value` 쌍을 전체 대비 비율과 함께 보여 준다. 우리 환경에서 이 도구로 무엇을 뽑아 어떻게 판단하는지는 [우리의 운영 03 자기감시 메트릭]({{< relref "../ours/03-self-monitoring-metrics.md" >}})에 정리돼 있다.

### 런타임 감시 지표

배포 이후에도 카디널리티는 변하므로 **런타임 지표**로 이어서 감시한다. [01 카디널리티]({{< relref "01-cardinality.md" >}})의 두 핵심 지표를 쿼리로 옮기면 이렇다.

```promql
# churn — 신규 시계열 생성 속도(New TSID 발급). 튀면 고카디널리티 레이블 유입 신호.
sum(rate(vm_new_timeseries_created_total[5m]))

# slow insert rate — 전체 삽입 대비 지연 삽입 비율. 지속 10% 초과 시 메모리 부족 경고.
sum(rate(vm_slow_row_inserts_total[5m])) / sum(rate(vm_rows_inserted_total[5m]))
```

개념·임계의 근거와 운영 의미는 [01 카디널리티]({{< relref "01-cardinality.md" >}})에 있고, 전송 지표와 묶은 실제 감시 구성은 [우리의 운영 03]({{< relref "../ours/03-self-monitoring-metrics.md" >}})에서 다룬다.

## 출처

- **MetricsQL** (VictoriaMetrics 공식 문서) — `default_rollup`·`rate`/`increase` 외삽 차이·`keep_metric_names`·`WITH`·`topk_avg`·`prometheus_buckets`·서브쿼리 자동 변환. (https://docs.victoriametrics.com/metricsql/)
- **VictoriaMetrics single-server** (공식 문서) — `/api/v1/status/tsdb` 파라미터·응답 필드, 카디널리티 익스플로러(vmui). (https://docs.victoriametrics.com/victoriametrics/single-server-victoriametrics/)
- **Prometheus Querying — Functions** — `rate`/`increase`/`irate`/`histogram_quantile`/`*_over_time` 정의. (https://prometheus.io/docs/prometheus/latest/querying/functions/)
- **Prometheus Querying — Basics** — 지표 셀렉터·집계 연산자(`sum by`/`without`)·range 벡터. (https://prometheus.io/docs/prometheus/latest/querying/basics/)
- **Prometheus HTTP API — TSDB Stats** — `/api/v1/status/tsdb` 원형 스펙. (https://prometheus.io/docs/prometheus/latest/querying/api/#tsdb-stats)
