---
title: "StarRocks"
weight: 6
---

# StarRocks — S3 위 stateless 컴퓨트, 그러나 로그엔 이르다

{{< callout type="info" >}}
**한눈에**
- 헤드라인 차별점은 다중테이블 JOIN·고동시성이다(SSB ~1.87x, TPC-H 3~5x, ClickHouse 대비).
- **shared-data(storage-compute 분리)가 OSS에 first-class GA**다 — S3/GCS/Azure/MinIO 위 stateless CN을 초 단위로 add/remove한다.
- **로그의 핵심인 풀텍스트 inverted index가 가장 미성숙**하다 — 정작 쓸 shared-data 모드에서는 v4.1(2026) Beta다.
- 턴키 관측성 UI가 전무하고 네이티브 OTLP 리시버가 없으며, 로그 스케일 프로덕션 레퍼런스가 사실상 0이다.
- 우리 케이스: 로그 스토어로는 아직 얼리어답터 영역이라, S3 탄력성이 하드 요구인 별도 mandate가 없으면 숏리스트에서 제외한다.
{{< /callout >}}

Linux Foundation MPP OLAP·실시간 분석 엔진(Apache-2.0). Apache Doris 포크(Doris 자체는 Baidu Palo 포크)를 vectorized execution + Cascades 코스트기반 옵티마이저로 재설계했고, 창업사 CelerData가 2023-02 프로젝트를 Linux Foundation에 기증했다(상용 백커 유지). 최신 라인은 v4.0/4.1(2026)이며, 무게중심은 **서브초 BI·다중테이블 JOIN·레이크하우스 질의**이고 로그는 근래 inverted index로 열린 인접 용도다.

## 강점

- **다중테이블 JOIN·고동시성 — ClickHouse 대비 헤드라인 차별점.** Cascades CBO + 분산 shuffle join + 투명 MV 재작성이 정규화 스키마의 fan-out 질의를 겨냥한다. SSB **~1.87x**, TPC-H **3~5x** `Ⓥ`. 사용자대면 대시보드처럼 동시 세션이 많은 워크로드가 sweet spot이다(다만 동시성은 무한 확장이 아니라 ~8 스트림 부근이 최적 `Ⓑ`).
- **shared-data(storage-compute 분리)가 OSS에 first-class GA.** FE(메타) + **stateless CN(Compute Node)** 구조로 1차 데이터가 **S3/GCS/Azure/MinIO에** 있고 CN은 로컬 hot 캐시만 쓴다. **CN을 초 단위로 add/remove, 리밸런스 없음.** v3.1 GA, 3.3~4.1로 성숙했으며 Cloud tax 없이 OSS 바이너리에 포함된다 — ClickHouse의 폐기·실험적 zero-copy-S3와 달리 정식 지원 설계다. 1st-party K8s Operator + Helm, AWS의 EKS + KEDA + Karpenter 탄력 레퍼런스까지 존재한다. "durable S3 위 ephemeral 컴퓨트"에 가장 정직하게 답하는 후보.
- **Mutable/upsert에 강함.** Primary Key 테이블이 동기 upsert/delete/partial update를 지원해 읽기 시점에 즉시 정확하다(ClickHouse의 ReplacingMergeTree+FINAL 읽기 비용과 대비). Routine Load·Stream Load는 2PC로 **exactly-once**라 CDC(예: Flink CDC) 싱크에 적합하다.
- **레이크하우스 네이티브.** Iceberg/Hive/Paimon Multi-Catalog를 CBO로 in-place 조회하고(99 TPC-DS 완주), 외부 카탈로그에 incremental MV + 투명 재작성을 건다. 한 엔진으로 lake-landed 테이블을 그대로 질의하는 시나리오가 강점.
- **반정형/JSON·고카디널리티에 우수.** **FLAT JSON**(GA v4.0, 기본 on): 로드 시 고빈도 필드를 자동 감지해 네이티브 컬럼나 서브컬럼으로 승격하고 희소 필드는 compact binary JSON으로 유지 — 앱 로그의 혼합 스키마 현실에 잘 맞는다. 고카디널리티 차원에서 ClickHouse식 ORDER-BY-key 절벽도, Elasticsearch식 매핑 폭발도 없다.
- **압축·경제성.** 컬럼나 코덱(RLE·dictionary·frame-of-reference·LZ4/ZSTD)으로 **~5:1–10:1, ES 대비 인프라 50~80% 절감** `Ⓥ`. 게다가 MySQL 프로토콜 호환이라 기존 BI·드라이버를 즉시 재사용한다.

## 약점 · 한계

- **로그의 핵심인 풀텍스트 inverted index가 가장 미성숙.** Beta로 v3.3(CLucene) 등장, PK 테이블 지원은 v4.0(shared-nothing 전용), 그리고 **shared-data(=유저가 쓸 S3 위 ephemeral 모드)에서 도는 구현은 v4.1(2026) Beta**이고 파서도 `builtin` 하나뿐(추가 analyzer는 "planned"). JSON·고카디널리티는 우수한데 정작 needle-search가 young하다.
- **턴키 관측성 UI가 전무.** SQL 인터페이스 + BI 도구(Grafana/Superset SQL)만 있고 log-native Discover/live-tail/trace-waterfall/RUM이 없다. Grab이 StarRocks 관측성에 자체 Golang 백엔드 + 커스텀 프론트를 만든 게 그 증거 — 탐색 UI·알림 glue·수집 어댑터를 직접 소유해야 한다.
- **네이티브 OTLP 리시버 없음.** OTel Collector가 Kafka(Routine Load)나 Stream Load HTTP로 landing시켜야 해 OTel 스파인에 컴포넌트·운영면이 하나 더 붙는다.
- **로그 스케일 프로덕션 레퍼런스가 사실상 0.** 플래그십 유저(Coinbase, Pinterest, Shopee, Tencent, Fresha)는 전부 BI/레이크하우스/JOIN 용도이고, Grab의 케이스마저 Spark 메트릭 + **shared-nothing 3-replica**(shared-data-over-S3 아님)다. 로그를 shared-data 위에 태우면 얼리어답터.
- **"완전 ephemeral"은 과장.** **FE 메타데이터 쿼럼은 여전히 stateful**(BDBJE 기반, Raft 아님 — 홀수 3/5 StatefulSet + PV 필수). durable 앵커는 항상 박힌다.
- **shared-data 캐시 경제학.** cold 쿼리는 S3 GET/LIST(요청 비용 + fetch latency)를 치고, 공격적 CN scale-down은 cache re-warm으로 tail latency를 키운다 — 고QPS ad-hoc 검색에선 오토스케일 튜닝 없이는 비용↔지연을 맞바꾼다.
- **운영 부담이 3 후보 중 최고.** 신규 MPP DW 스택(FE/CN/BE, tablet, compaction, 4가지 table model)이라 램프·온콜이 무겁고 VictoriaMetrics 스킬 재사용은 0. 버전 위생 함정도 있다 — v4.1.0은 컨테이너 배포 금지(BE 기동 실패, 4.1.1+ 사용), 4.1에서 다운그레이드는 on-disk 레이아웃 변경으로 4.0.6+로만.
- **거버넌스.** Linux Foundation 호스팅이지만 개발은 CelerData 주도이고, 스폰서가 2026-05 PhoenixAI로 피벗해 로드맵 불확실성이 있다 — 로그 기능 성숙 속도가 상용 우선순위(레이크하우스/분석)를 추종한다.

## 적합 / 부적합

| | 워크로드 |
|---|---|
| **적합** | 고동시성·JOIN-heavy BI/대시보드; S3 위 진짜 storage/compute 분리가 하드 요구인 탄력 OLAP; Iceberg 레이크하우스 in-place 조회; mutable/CDC upsert(Primary Key) |
| **부적합** | needle-in-haystack 단일 wide 테이블 로그 검색; 턴키 관측성 제품이 필요할 때; VM 운영지식 재사용이 중요할 때; 순수 append-only 로그 저장 경제성(ClickHouse가 단일테이블 스캔·압축서 근소~명확히 앞섬 — ClickBench hot ~20–33%↑, on-disk ~23%↓ `Ⓑ`) |

## 우리 케이스에서는

**로그 스토어로는 아직 얼리어답터 영역이다.** 우리가 가장 필요로 하는 shared-data 위 풀텍스트 검색이 정확히 Beta이고, 턴키 관측성 UI가 없으며, 3 후보 중 운영 부담이 최고인데 VM 스킬 재사용은 0이다. StarRocks의 헤드라인 강점(JOIN·고동시성·upsert·레이크하우스)은 append-only 단일 wide 테이블·needle-search라는 로그 트러블슈팅 shape와 거의 교집합이 없다. "고동시성·JOIN-heavy·S3-elastic 분석/레이크하우스 플랫폼(로그는 그중 한 테넌트)"라는 별도 mandate가 생길 때만 back-pocket에 둔다. ClickHouse와의 정면 비교는 [ClickHouse vs StarRocks]({{< relref "07-clickhouse-vs-starrocks.md" >}}), 최종 권고는 [권장안]({{< relref "08-recommendation.md" >}}) 참고.
