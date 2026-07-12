---
title: "VictoriaMetrics"
weight: 1
bookCollapseSection: true
---

# VictoriaMetrics 지식베이스

네이버 D2/DEVIEW의 VictoriaMetrics 발표 영상 2편과 텍스트 기사 2편을 하나로 병합해, 주제별 블록으로 재구성한 학습 지식베이스다. 데이터가 **들어와서 → 저장되고 → 쿼리로 나가기**까지의 내부 동작을 이해하고, 그 메커니즘이 **수천만~수십억 규모의 실전 운영**에서 어떻게 쓰이는지 연결해서 읽도록 구성했다.

> 원본 출처와 전사 방법은 [08 소스맵]({{< relref "08-sources.md" >}}) 참고.
> 자매 챕터: [메트릭 400일 보관 — 아키텍처 비교]({{< relref "../longterm-retention/_index.md" >}}) — 이 VM 내부 동작을 실제 장기보관 스택 결정에 적용한 사례.

## 블록 지도

| 블록 | 주제 | 한 줄 요약 |
|------|------|-----------|
| [01 TSDB와 VictoriaMetrics]({{< relref "01-tsdb-and-victoriametrics.md" >}}) | 기초·소개 | 시계열이란, metric 4타입, "대용량"의 정의, VM의 위치와 TSDB 히스토리(Prometheus·Gorilla·Thanos·Cortex) |
| [02 아키텍처]({{< relref "02-architecture.md" >}}) | 구조 | 4컴포넌트 데이터 흐름, SingleNode vs Cluster, LSM 트리, IndexDB/DataDB 분리 |
| [03 수집 (Ingestion)]({{< relref "03-ingestion.md" >}}) | vmagent·vminsert | vmagent 7단계 파이프라인·유실방지 큐, vminsert 랑데부 해싱·페일오버·복제 |
| [04 저장과 압축]({{< relref "04-storage-and-compression.md" >}}) | vmstorage | TSID·파티션·머지·retention·IndexDB 로테이션, Delta/Delta-of-Delta·ZigZag·Varint 압축(0.92B 실증) |
| [05 쿼리와 운영 컴포넌트]({{< relref "05-query-and-ops-components.md" >}}) | vmselect·vmalert·vmauth | fanout·3-prefix 검색·캐시·latency offset, 선계산(vmalert), 라우팅 게이트웨이(vmauth) |
| [06 카디널리티]({{< relref "06-cardinality.md" >}}) | 설계 원칙 | New TSID 폭발, best/worst case, churn·slow insert 지표 |
| [07 대규모 운영과 무중단 전환]({{< relref "07-operations-at-scale.md" >}}) | 실전 | 멀티버스(멀티클러스터), Hot/Warm 2계층, 12.5억 시계열, 무중단 장비 전환 |
| [08 소스맵]({{< relref "08-sources.md" >}}) | 참고 | 발표 영상·기사·전사본 원본 가이드 |

## 읽는 순서

- **처음이라면** 01 → 02 순으로 큰 그림을 잡고, 03 → 04 → 05로 컴포넌트별 내부 동작을 따라간다.
- **압축이 궁금하면** 04가 핵심이다. 왜 VM이 메모리 5배·스토리지 7배 효율을 내는지, 그리고 실측 0.92바이트/데이터포인트가 그 증거인 이유를 다룬다.
- **운영자라면** 06(카디널리티)과 07(대규모 운영·무중단 전환)이 실무 직결이다. 다만 07의 무중단 전략(랑데부 역순 추가)은 03의 랑데부 해싱·복제 원리를 먼저 이해해야 와닿는다.

## 관통하는 핵심

- **압축이 곧 TSDB의 본질이다.** Time Series와 Sample을 분리(IndexDB/DataDB)하고, Gauge엔 Delta·Counter엔 Delta-of-Delta를 얹어 극단적 압축을 얻는다. → [04]({{< relref "04-storage-and-compression.md" >}})
- **각 컴포넌트는 역할이 명확하다.** 수집(vmagent)·라우팅(vminsert)·저장(vmstorage)·쿼리(vmselect). → [02]({{< relref "02-architecture.md" >}})~[05]({{< relref "05-query-and-ops-components.md" >}})
- **카디널리티는 설계 단계에서 결정된다.** 자주 바뀌는 값은 레이블이 아니라 로그·트레이스로. → [06]({{< relref "06-cardinality.md" >}})
- **내부 동작 이해가 곧 무장애 운영 능력이다.** 랑데부 해싱과 복제 순환을 알아야 역순 추가·vmbackup 전환 전략이 나온다. → [07]({{< relref "07-operations-at-scale.md" >}})
