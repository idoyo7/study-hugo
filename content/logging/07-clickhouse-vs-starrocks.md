---
title: "ClickHouse vs StarRocks"
weight: 7
---

# ClickHouse vs StarRocks (로그/관측성 한정)

{{< callout type="info" >}}
**한눈에**
- 결정축은 **3–3(+ 워크로드 의존 2축)** — 무조건 승자는 없고 워크로드 shape가 답을 정합니다.
- self-host storage/compute 분리·JOIN/mutable/레이크하우스·K8s 탄력 스케일은 **StarRocks 승**.
- 단일 테이블 스캔·압축·풀텍스트/JSON·생태계/매니지드는 **ClickHouse 승**.
- **로그/관측성 한정 판정 = ClickHouse.** 결정타는 검색 축 — 가장 필요한 풀텍스트가 CH는 GA, SR은 Beta입니다.
- 둘 다 BM25/relevance 스코어링이 없습니다 — ES식 랭킹 검색이 진짜 필요하면 전용 검색층을 남겨야 합니다.
{{< /callout >}}

정면으로 붙여보면 결정축이 **3–3(+ 워크로드 의존 2축)**으로 갈려 "무조건 승"이 나오지 않습니다. **워크로드 shape가 답을 정합니다.** (아래 표는 결정축 중심 요약)

| 축 | 승자 | 한 줄 |
|---|---|---|
| self-host storage/compute 분리 | **StarRocks** | S3 + stateless CN이 OSS 바이너리에 포함. CH 진짜 분리는 Cloud 전용 |
| 단일 테이블 스캔·압축 | **ClickHouse** | 로그의 홈그라운드(MergeTree), ClickBench hot ~20~33%↑ `Ⓑ` |
| JOIN·mutable·레이크하우스 | **StarRocks** | Primary-Key upsert, Iceberg 네이티브 |
| 풀텍스트 index / JSON | **ClickHouse** | text index GA(2026-03) vs SR shared-data Beta |
| K8s 탄력 스케일 | **StarRocks** | CN 오토스케일 vs CH 리샤딩 |
| 생태계·매니지드·관측성 제품 | **ClickHouse** | ClickStack/HyperDX 턴키 vs SR UI 전무 |

**로그/관측성 한정 판정 = ClickHouse.** 로그는 append-only 단일 wide 테이블에 needle-search를 걸면서 ingest는 높은 shape라 MergeTree의 홈그라운드입니다. 반대로 StarRocks가 앞세우는 강점(JOIN·고동시성·upsert·레이크하우스)은 이 shape와는 거의 무관합니다. 결정타는 검색 축입니다 — 가장 필요한 풀텍스트가 CH는 GA, SR은 (쓸 모드에서) Beta입니다. **StarRocks의 유일한 진짜 승리는 self-host storage-compute 분리**이므로 "S3 위 탄력 오토스케일"이 하드 요구가 아니면 로그 숏리스트에서 빠집니다.

> 정직한 단서 2개: (1) **둘 다 BM25/relevance 스코어링이 없다** — ES식 랭킹 검색이 진짜 필요하면 전용 검색층을 남겨야 합니다. (2) 둘이 공존한다면 split-brain(CH=관측성 logs+traces+RUM, SR=Iceberg 위 BI/mutable)이 자연스럽고 공유 S3/Iceberg 레이크가 브릿지가 됩니다.

각 엔진의 단독 평가는 [ClickHouse (self-hosted)]({{< relref "04-clickhouse.md" >}}) · [StarRocks]({{< relref "06-starrocks.md" >}}) 참고.
