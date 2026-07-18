---
title: "VictoriaMetrics"
weight: 1
---

# VictoriaMetrics

VictoriaMetrics(이하 VM)를 세 갈래로 나눠 정리한 지식베이스다. **① 기본 개념**은 네이버 D2/DEVIEW 발표 2편과 텍스트 기사 2편을 정독해, 데이터가 **들어와서 → 저장되고 → 쿼리로 나가기**까지 VM 내부 동작을 파헤친다. **② 잘 쓰는 방법**은 그 내부 동작에서 끌어낸 설계 원칙과 초대규모 운영 패턴을 다룬다. **③ 우리의 운영**은 실제 우리 스택의 구성·튜닝·기준치·노하우를 기록한다. 개념에서 원리를 얻고, 원리를 실전 설계로 옮기고, 우리 환경에 적용하는 흐름이다.

> 원본 출처와 전사 방법은 [소스맵]({{< relref "concepts/06-sources.md" >}}) 참고.
> 자매 챕터: [메트릭 장기보관 아키텍처 비교]({{< relref "../longterm-retention/_index.md" >}}) — 이 VM 내부 동작을 실제 장기보관 스택 결정에 적용한 사례.

## ① 기본 개념

시계열이 무엇이고 VM 내부에서 데이터가 어떻게 흐르는지를, 네이버 D2/DEVIEW 발표를 정독해 컴포넌트별로 파헤친다. 처음이라면 여기서 시작한다.

| 문서 | 한 줄 요약 |
|------|-----------|
| [01 TSDB와 VictoriaMetrics]({{< relref "concepts/01-tsdb-and-victoriametrics.md" >}}) | 시계열이란, 지표 4타입, "대용량"의 정의, VM의 위치와 TSDB 히스토리(Prometheus·Gorilla·Thanos·Cortex) |
| [02 아키텍처]({{< relref "concepts/02-architecture.md" >}}) | 4컴포넌트 데이터 흐름, SingleNode vs Cluster, LSM 트리, IndexDB/DataDB 분리 |
| [03 수집 (vmagent·vminsert)]({{< relref "concepts/03-ingestion.md" >}}) | vmagent 7단계 파이프라인·유실방지 큐, vminsert 랑데부 해싱·페일오버·복제 |
| [04 저장과 압축]({{< relref "concepts/04-storage-and-compression.md" >}}) | TSID·파티션·머지·retention, Delta/Delta-of-Delta·ZigZag·Varint 압축(0.92B 실증) |
| [05 쿼리·운영 컴포넌트]({{< relref "concepts/05-query-and-ops-components.md" >}}) | vmselect fanout·3-prefix 검색·캐시·latency offset, 선계산(vmalert), 라우팅 게이트웨이(vmauth) |
| [06 소스맵]({{< relref "concepts/06-sources.md" >}}) | 발표 영상·기사·전사본 원본 가이드 |

## ② 잘 쓰는 방법

내부 동작에서 끌어낸 설계 원칙과, 수천만~수십억 시계열 규모의 실전 운영 패턴이다. 운영자라면 여기가 실무 직결이다.

| 문서 | 한 줄 요약 |
|------|-----------|
| [01 카디널리티]({{< relref "practice/01-cardinality.md" >}}) | New TSID 폭발의 원리, best/worst case, churn·slow insert 감시 지표 |
| [02 초대규모 운영과 무중단 전환]({{< relref "practice/02-operations-at-scale.md" >}}) | 멀티버스(멀티클러스터), Hot/Warm 2계층, 12.5억 시계열, 무중단 장비 전환 |
| [03 쿼리 패턴]({{< relref "practice/03-query-patterns.md" >}}) | PromQL 기본(rate·histogram_quantile·sum by)과 MetricsQL 확장, 무거운 쿼리 회피, 카디널리티 점검 쿼리·API |

## ③ 우리의 운영

실제 우리 스택의 구성과, 운영하며 정리한 튜닝·기준치·노하우다. 우리 환경을 파악하려면 여기를 본다.

| 문서 | 한 줄 요약 |
|------|-----------|
| [01 스택 구성]({{< relref "ours/01-stack-overview.md" >}}) | 우리 환경의 VM 스택 전체 구성과 컴포넌트 배치 |
| [02 vmagent 전송 튜닝]({{< relref "ours/02-vmagent-transport-tuning.md" >}}) | 중앙 vminsert로 향하는 remote write 전송 파라미터(큐·동시성·재시도) 튜닝 |
| [03 자기감시 메트릭]({{< relref "ours/03-self-monitoring-metrics.md" >}}) | VM 스택 자체를 감시하는 핵심 메트릭과 관측 포인트 |
| [04 스케일링·용량 기준치]({{< relref "ours/04-scaling-thresholds.md" >}}) | 언제 스케일아웃할지 판단하는 용량 기준치와 지표 |

## 읽는 순서

- **처음이라면** 기본 개념 01 → 02 → 03 → 04 → 05 순으로 큰 그림을 잡고 컴포넌트별 내부 동작을 따라간다. 원본이 궁금하면 06 소스맵.
- **운영자·설계자라면** 잘 쓰는 방법 01(카디널리티) → 02(초대규모 운영)가 실무 직결이다. 다만 02의 무중단 전략(랑데부 역순 추가)은 기본 개념 03의 랑데부 해싱·복제 원리를 먼저 이해해야 와닿는다.
- **우리 환경을 파악하려면** 우리의 운영 01(스택 구성) → 02 → 03 → 04.

## 관통하는 핵심

- **압축이 곧 TSDB의 본질이다.** Time Series와 Sample을 분리(IndexDB/DataDB)하고, Gauge엔 Delta·Counter엔 Delta-of-Delta를 얹어 극단적 압축을 얻는다. → [기본 개념 04]({{< relref "concepts/04-storage-and-compression.md" >}})
- **각 컴포넌트는 역할이 명확하다.** 수집(vmagent)·라우팅(vminsert)·저장(vmstorage)·쿼리(vmselect). → [기본 개념 02]({{< relref "concepts/02-architecture.md" >}})~[05]({{< relref "concepts/05-query-and-ops-components.md" >}})
- **카디널리티는 설계 단계에서 결정된다.** 자주 바뀌는 값은 레이블이 아니라 로그·트레이스로. → [잘 쓰는 방법 01]({{< relref "practice/01-cardinality.md" >}})
- **내부 동작 이해가 곧 무장애 운영 능력이다.** 랑데부 해싱과 복제 순환을 알아야 역순 추가·vmbackup 전환 전략이 나온다. → [잘 쓰는 방법 02]({{< relref "practice/02-operations-at-scale.md" >}})
