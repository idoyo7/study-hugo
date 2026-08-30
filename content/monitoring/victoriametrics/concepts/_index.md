---
title: "기본 개념"
date: 2026-07-18
lastmod: 2026-08-24
weight: 1
---

# 기본 개념 — 네이버 D2 발표 정독

{{< callout type="info" >}}
- 네이버 D2/DEVIEW 자료 4건(영상 2편 + 기사 2편)을 병합해 주제별 6개 문서로 재구성한 개념 지식베이스입니다.
- 관점은 하나로 이어집니다 — 데이터가 들어와서(03) → 저장되고(04) → 쿼리로 나가기(05)까지의 내부 동작입니다.
- 01~02가 큰 그림(시계열·TSDB 계보·4컴포넌트), 03~05가 컴포넌트 내부, 06이 원본 소스맵입니다.
- 설계 원칙·운영 패턴은 [잘 쓰는 방법]({{< relref "../practice/_index.md" >}}), 우리 환경 적용은 [우리의 운영]({{< relref "../ours/_index.md" >}})으로 이어집니다.
{{< /callout >}}

네이버 D2/DEVIEW의 VictoriaMetrics 자료 4건(발표 영상 2편 + 텍스트 기사 2편)을 하나로 병합해 데이터가 들어와서 → 저장되고 → 쿼리로 나가기까지의 내부 동작을 주제별로 재구성한 지식베이스입니다. 목적은 개념 이해입니다. VM이 어떤 컴포넌트로 이루어지고 각 단계에서 무슨 일이 일어나는지, 왜 그런 설계가 대용량 시계열을 감당하는지를 순서대로 따라 읽도록 엮었습니다. 실제로 잘 쓰고 운영하는 방법은 [잘 쓰는 방법]({{< relref "../practice/_index.md" >}})에서 이어집니다.

## 문서 지도

| 문서 | 주제 | 한 줄 요약 |
|------|------|-----------|
| [01 TSDB와 VM]({{< relref "01-tsdb-and-victoriametrics.md" >}}) | 기초·소개 | 시계열·metric 4타입·"대용량", VM 위치, TSDB 히스토리(Prometheus·Gorilla·Thanos·Cortex) |
| [02 아키텍처]({{< relref "02-architecture.md" >}}) | 큰 그림 | 4컴포넌트 데이터 흐름, SingleNode vs Cluster, LSM 트리, IndexDB/DataDB 분리 |
| [03 수집]({{< relref "03-ingestion.md" >}}) | vmagent·vminsert | vmagent 7단계 파이프라인·유실 방지 큐, vminsert 랑데부 해싱·페일오버·복제 |
| [04 저장과 압축]({{< relref "04-storage-and-compression.md" >}}) | vmstorage | TSID·파티션·머지·retention·IndexDB 로테이션, Delta/Delta-of-Delta 압축(0.92B 실증) |
| [05 쿼리·운영 컴포넌트]({{< relref "05-query-and-ops-components.md" >}}) | vmselect·vmalert·vmauth | fanout·3-prefix 검색·캐시, vmalert 선계산, vmauth 라우팅 |
| [06 소스맵]({{< relref "06-sources.md" >}}) | 참고 | 발표 영상·기사·전사본 원본 가이드 |

05는 vmselect의 캐시 계층에서 `latency offset`도 함께 다룹니다.

## 읽는 순서

- 01 → 02로 큰 그림을 잡습니다. 01에서 시계열·대용량·VM의 위치를, 02에서 4개 컴포넌트가 어떻게 연결되고 LSM 트리·IndexDB/DataDB 분리가 왜 필요한지를 이해합니다.
- 03 → 04 → 05로 컴포넌트 내부를 따라갑니다. 데이터가 들어오는 관문(03 수집), 디스크에 눕고 압축되는 곳(04 저장과 압축), 다시 빠져나가는 길(05 쿼리·운영 컴포넌트)의 순서입니다. "들어와서 → 저장되고 → 나가기" 흐름 그대로입니다.
- 06 소스맵은 참고용입니다. 각 문서가 어떤 원본 발표·기사에서 나왔는지, 직접 확인하려면 어디를 보면 되는지 정리한 지도입니다. 마지막에 필요할 때 펼쳐 보면 됩니다.
