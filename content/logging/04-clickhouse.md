---
title: "ClickHouse (self-hosted)"
weight: 4
---

# ClickHouse (self-hosted on EKS) — 통합 저장소로서의 야심

컬럼형 OLAP 데이터베이스. 로그·트레이스·웹 RUM을 **한 저장소로 흡수**할 수 있는 확장성이 매력이다.

- **강점**: 압축률이 실측으로 검증됨(구조화 로그 10~20x+ `[추정/벤더]`). 로그·트레이스·이벤트를 한 스키마 계열로 다룰 수 있어 통합 잠재력이 크다. **풀텍스트 text index GA(2026-03), native JSON GA(25.3)** — 로그 검색에 필요한 기능이 이미 정식이다. 생태계가 넓다(드라이버/BI/OTel/Vector, 성숙 operator).
- **비용**: 인프라만 보면 OpenSearch 대비 크게 절감(대략 7~15배 보고 사례 `[벤더]`).
- **약점**: 셀프호스트 CH는 **관리형 OpenSearch보다 운영 부담이 늘어나는 방향**이다 — 스키마/ORDER BY/TTL 설계, 백업 증분 체인, 업그레이드. **진짜 storage-compute 분리(SharedMergeTree)는 Cloud 전용**이고, self-host의 zero-copy-S3는 폐기됐다(데이터 손실 이력) → self-host는 shared-nothing + 로컬 NVMe라 스케일아웃 = 리샤딩.
- **전제 조건**: 명시적 오너 + 런북 + 정기 리뷰를 못 박을 수 없다면, 관리형(ClickHouse Cloud / Altinity) 견적과 반드시 비교.

> 통합 프론트(UI)는 별도다 — 로그·트레이스·세션 리플레이를 얹는 [HyperDX / ClickStack]({{< relref "05-hyperdx-clickstack.md" >}}), StarRocks와의 정면 비교는 [ClickHouse vs StarRocks]({{< relref "07-clickhouse-vs-starrocks.md" >}}) 참고.
