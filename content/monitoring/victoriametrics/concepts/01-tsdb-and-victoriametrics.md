---
title: "TSDB와 VictoriaMetrics"
weight: 1
aliases: ["/monitoring/victoriametrics/01-tsdb-and-victoriametrics/"]
---

# 01 · 시계열 데이터와 VictoriaMetrics

{{< callout type="info" >}}
- 시계열은 "언제 어떤 숫자가 찍혔나"가 이어지는 데이터입니다. 지표에는 **Counter/Gauge/Histogram/Summary** 4타입이 있습니다. 그중 Counter류 단조증가값이 압축이 가장 잘 됩니다.
- "대용량"을 나누는 기준은 **시계열 개수**와 **보관 기간**입니다. 수백만 개까지는 Prometheus 단일로 충분하지만 수천만~수십억 개부터는 별도 솔루션이 필요합니다.
- TSDB 계보: **Prometheus(2012) → Gorilla 압축(2015, Facebook) → Thanos/Cortex(Prometheus 확장)** vs **VictoriaMetrics(완전히 다른 계열)**.
- VM은 **Prometheus 호환**(PromQL·remote_write 그대로)을 지키면서 자체 벤치마크 기준 **메모리 5배·스토리지 7배** 효율을 주장하는 오픈소스 TSDB입니다.
{{< /callout >}}

시계열 데이터가 무엇인지, 왜 "대용량"이 별도의 문제로 떨어져 나오는지, 그 문제를 푸는 도구로서 VictoriaMetrics(이하 VM)가 어디에 서 있는지를 정리합니다. VM 내부의 컴포넌트 구조는 [02 아키텍처]({{< relref "02-architecture.md" >}})로 넘깁니다.

> 관련 문서: [02 아키텍처]({{< relref "02-architecture.md" >}}) · [04 저장과 압축]({{< relref "04-storage-and-compression.md" >}}) · [실전 01 카디널리티]({{< relref "../practice/01-cardinality.md" >}}) · [개념 인덱스]({{< relref "_index.md" >}})

## 시계열 데이터란

TSDB(Time Series Database, 시계열 데이터베이스)를 한 줄로 줄이면 **시간 순서대로 기록된 숫자 값들의 연속**을 다루는 데이터베이스입니다. 가장 단순한 형태는 체온 그래프입니다. 9시에 36.5도, 10시에 36.7도, 11시에 36.6도 — 시간 축을 따라 숫자가 하나씩 찍힙니다. 시간 순서로 나열된 숫자이므로 2차원 테이블로도, 그래프로도 자연스럽게 표현됩니다.

모니터링 지표도 구조가 같습니다. CPU 사용률, 요청 수, 응답 시간 전부 **"어떤 시점에 어떤 숫자가 찍혔는가"** 로 환원됩니다. 숫자가 찍히는 방식에 따라 지표 타입이 4종류로 나뉩니다.

## 지표 4타입

Prometheus 진영의 표준 분류이기도 합니다.

| 타입 | 특징 | 예시 |
|------|------|------|
| **Counter** | 계속 증가만 하는 누적 값(단조 증가) | `http_requests_total` 같은 누적 요청 수 (0 → 1,102) |
| **Histogram** | 버킷 단위로 나눈 누적 카운터 | 0.05초 이하 응답 몇 개, 0.1초 이하 몇 개 (서버 쪽에서 버킷으로 절단) |
| **Gauge** | 위아래로 자유롭게 변동하는 값 | 메모리 사용률 48% → 62% → 55% |
| **Summary** | 클라이언트가 분위수를 미리 계산해 저장 | p50, p90, p99 |

4타입이 텍스트로 어떻게 노출되는지 보면 감이 잡힙니다. Prometheus는 지표를 아래 형식(exposition format)으로 드러냅니다. 수집기는 이 텍스트를 긁어(scrape) 시계열로 저장합니다.

```text
# Counter — 단조 증가하는 누적 값
http_requests_total{method="post",code="200"} 1102

# Gauge — 위아래로 변동하는 값
memory_usage_percent 62.0

# Histogram — 버킷별 누적 카운트 + _sum + _count
http_request_duration_seconds_bucket{le="0.05"} 24054
http_request_duration_seconds_bucket{le="0.1"}  33444
http_request_duration_seconds_bucket{le="+Inf"} 144320
http_request_duration_seconds_sum   53423
http_request_duration_seconds_count 144320

# Summary — 클라이언트가 미리 계산한 분위수 + _sum + _count
rpc_duration_seconds{quantile="0.5"}  4773
rpc_duration_seconds{quantile="0.99"} 76656
rpc_duration_seconds_sum   1.7560473e+07
rpc_duration_seconds_count 2693
```

관건은 **한 지표가 TSDB에 몇 개의 시계열로 저장되느냐**입니다. Counter·Gauge는 지표 하나가 시계열 하나로 끝나지만 Histogram·Summary는 한 줄처럼 보여도 내부적으로 여러 시계열로 쪼개집니다. 동일 레이블 조합 기준으로 세어 보면 이렇습니다.

| 타입 | 저장되는 시계열 수 | 분해 방식 |
|------|-----------------|-----------|
| **Counter** | 1개 | 지표 하나 = 시계열 하나 |
| **Gauge** | 1개 | 지표 하나 = 시계열 하나 |
| **Histogram** | **버킷 N개 + `_sum` + `_count` = N+2개** | 버킷 경계(`le`)마다 별도 시계열 |
| **Summary** | **분위수 Q개 + `_sum` + `_count` = Q+2개** | 분위수(`quantile`)마다 별도 시계열 |

위 Histogram 예시는 버킷이 3개라 시계열 5개(3+2)로 저장됩니다. 버킷을 10개로 잡으면 지표 하나가 시계열 12개가 됩니다 — Histogram·Summary가 카디널리티를 밀어 올리는 이유입니다. 이 문제는 [실전 01 카디널리티]({{< relref "../practice/01-cardinality.md" >}})에서 다룹니다.

미리 붙잡아 둘 직관이 하나 더 있습니다. **Counter처럼 단조 증가하는 값은 압축이 극단적으로 잘 됩니다.** 이 사실이 저장·압축을 설명할 때 계속 되돌아옵니다. Counter/Gauge를 어떻게 판별하고 어떻게 압축하는지는 [04 저장과 압축]({{< relref "04-storage-and-compression.md" >}})에서 다룹니다.

## 왜 "대용량"이 별도의 문제인가

이 모든 숫자를 시간 순서대로 그대로 저장해야 할까요. 1초에 한 번씩만 찍어도 하루에 86,400개입니다. 지표가 수만 개라면 하루치만 해도 어마어마한 양이 됩니다. 그래서 **TSDB의 핵심 과제는 제한된 자원으로 이 수많은 데이터를 얼마나 잘 압축하느냐**가 됩니다.

"대용량 시계열"이라는 말은 **시계열 개수**가 많아지는 쪽과, 시간이 흐를수록 데이터가 쌓여 **보관 기간**이 길어지는 쪽을 함께 가리킵니다. 규모의 감을 잡으려면 대략의 구간을 나눠 보는 편이 낫습니다.

| 규모 | 시계열 개수 | 상황 |
|------|-----------|------|
| 레거시 | 약 100만 개 이하 | 기존 모니터링 시스템이 다루던 전통적 규모 |
| 분산 시스템 | 수백만 개 | 분산 시스템 + 인기 플랫폼 위 커스텀 애플리케이션 지표까지 수집 |
| 대용량 | 수천만 ~ 수십억 개 | 쿠버네티스 등 클라우드 도구 도입으로 카디널리티 폭증 |

**수백만 개까지는 Prometheus 하나만 설치해도 웬만큼 해결됩니다.** 문제는 그 위입니다. 수천만 개를 넘어서는 순간부터는 기존 모니터링 시스템과 단일 시계열 DB로는 감당이 안 돼 **별도의 솔루션이 필요합니다** — "대용량"을 굳이 구분하는 이유입니다. 개수가 왜 이렇게까지 폭증하는지, 즉 카디널리티 문제는 [실전 01 카디널리티]({{< relref "../practice/01-cardinality.md" >}})에서 본격적으로 다룹니다.

## TSDB의 히스토리

대용량 시계열을 다루는 도구들이 어떤 순서로 등장했는지를 짚으면 VM의 위치가 선명해집니다.

- **2012 · Prometheus 등장.** 모니터링 업계에서 사실상 디팩토 표준에 가까운 도구입니다. 앞서 본 지표 4타입 분류도 Prometheus 진영에서 왔습니다.
- **2015 · Gorilla 압축 알고리즘.** Facebook이 방대한 서버를 모니터링하면서 시계열 데이터를 효율적으로 처리하려고 만든 특화 압축 기술입니다. "시계열 데이터를 어떻게 효율적으로 다룰 것인가"라는 아이디어가 이때부터 여러 모니터링 도구로 퍼졌습니다. Gorilla 계열 압축(Delta / Delta-of-Delta)의 실제 동작은 [04 저장과 압축]({{< relref "04-storage-and-compression.md" >}})에서 다룹니다.
- **그 위의 스케일 문제.** 수천만 개를 넘는 대용량은 Prometheus 하나만으로는 풀리지 않습니다. 여기서부터 선택이 달라집니다. 널리 쓰이는 쪽은 **Thanos**와 **Cortex** — 스케일러블한 Prometheus 확장 솔루션입니다. 네이버 검색 SRE는 이들과 **완전히 다른 계열인 VM을 택했습니다.**

## VictoriaMetrics의 위치

VM은 대용량 시계열을 정면으로 겨냥한 TSDB입니다.

- **Apache 2.0 라이선스의 오픈소스 TSDB**이며 **Prometheus와 호환**됩니다. **PromQL**을 그대로 쓸 수 있습니다. Prometheus가 쓰는 **`remote_write`** 프로토콜도 그대로 받아들입니다. 기존 Prometheus 생태계를 버리지 않고 백엔드만 갈아 끼울 수 있다는 뜻입니다.
- 자체 벤치마크 기준으로 **메모리 5배, 스토리지 7배 더 효율적**이라고 주장합니다. 이 효율의 비결은 앞서 본 Time Series/Sample 분리와 Gorilla 계열 압축입니다. 실제 운영에서는 데이터포인트당 1바이트 미만까지 줄어듭니다(상세는 [04 저장과 압축]({{< relref "04-storage-and-compression.md" >}})).
- **왜 VM인가.** Thanos·Cortex 대비 의존성이 적고 아키텍처가 단순해 운영이 편합니다. 압축 효율과 성능도 앞섭니다. 그래서 대규모 모니터링 시스템의 백엔드로 자리를 잡았습니다. 네이버 검색 SRE도 같은 이유로 VM을 택했습니다. 하루 수십억 건의 검색 요청, 수만 대의 서버, 수백 개 서비스를 모니터링하는 환경입니다.

VM이 이 효율을 어떻게 내는지 — 4개 컴포넌트로 데이터가 흐르는 구조, LSM 트리, IndexDB/DataDB 분리 — 는 [02 아키텍처]({{< relref "02-architecture.md" >}})에서 이어집니다.

## 출처

- **Inside VictoriaMetrics** (강민구, NAVER · 40:37) — `01:09~04:35` TSDB 정의, 지표 4타입, 압축 과제, VM 위치(Apache 2.0 / Prometheus 호환 / 메모리 5배·스토리지 7배). https://d2.naver.com/helloworld/9290861
- **VictoriaMetrics: 시계열 데이터 대혼돈의 멀티버스** (DEVIEW 2023, 손주식·이선규 · 33:50) — `01:54~05:47` 시계열 정의, 대용량의 정의(100만→수백만→수천만·수십억), TSDB 히스토리(Prometheus 2012 / Gorilla 2015 / Thanos·Cortex vs VM 선택). https://youtu.be/OUyXPgVcdw4
- 골격: `chapter9/victoriametrics.md` §1.
