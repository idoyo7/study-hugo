---
title: "ClickHouse vs StarRocks"
weight: 7
---

# ClickHouse vs StarRocks (로그/관측성 한정)

둘을 정면 비교하면 결정축은 **3–3(+ 워크로드 의존 2축)**으로 "무조건 승"이 없다. **워크로드 shape가 답을 정한다.** (아래 표는 결정축 중심 요약)

| 축 | 승자 | 한 줄 |
|---|---|---|
| self-host storage/compute 분리 | **StarRocks** | S3 + stateless CN이 OSS 바이너리에 포함. CH 진짜 분리는 Cloud 전용 |
| 단일 테이블 스캔·압축 | **ClickHouse** | 로그의 홈그라운드(MergeTree), ClickBench hot ~20~33%↑ `[벤치]` |
| JOIN·mutable·레이크하우스 | **StarRocks** | Primary-Key upsert, Iceberg 네이티브 |
| 풀텍스트 index / JSON | **ClickHouse** | text index GA(2026-03) vs SR shared-data Beta |
| K8s 탄력 스케일 | **StarRocks** | CN 오토스케일 vs CH 리샤딩 |
| 생태계·매니지드·관측성 제품 | **ClickHouse** | ClickStack/HyperDX 턴키 vs SR UI 전무 |

**로그/관측성 한정 판정 = ClickHouse.** 로그 워크로드는 append-only 단일 wide 테이블 needle-search + 고ingest라 MergeTree 홈그라운드이고, StarRocks의 헤드라인 강점(JOIN·고동시성·upsert·레이크하우스)은 이 shape에 거의 무관하다. 결정타는 검색 축 — 가장 필요한 풀텍스트가 CH는 GA, SR은 (쓸 모드에서) Beta다. **StarRocks의 유일한 진짜 승리는 self-host storage-compute 분리**이므로, "S3 위 탄력 오토스케일"이 하드 요구가 아니면 로그 숏리스트에서 빠진다.

> 정직한 단서 2개: (1) **둘 다 BM25/relevance 스코어링이 없다** — ES식 랭킹 검색이 진짜 필요하면 전용 검색층을 남겨라. (2) 공존한다면 split-brain(CH=관측성 logs+traces+RUM, SR=Iceberg 위 BI/mutable)이 자연스럽고, 공유 S3/Iceberg 레이크가 브릿지가 된다.

각 엔진의 단독 평가는 [ClickHouse (self-hosted)]({{< relref "04-clickhouse.md" >}}) · [StarRocks]({{< relref "06-starrocks.md" >}}) 참고.
