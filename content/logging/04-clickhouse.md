---
title: "ClickHouse (self-hosted)"
weight: 4
---

# ClickHouse (self-hosted on EKS) — 통합 저장소로서의 야심

컬럼형(column-oriented) OLAP 데이터베이스. Yandex에서 출발해 오픈소스화된 Apache-2.0 프로젝트이고, 대규모 분석 쿼리에 최적화된 성숙한 엔진이다. 로그·트레이스·이벤트·웹 RUM을 **한 스키마 계열·SQL 인터페이스로 흡수**하는 "통합 관측성 저장소" 후보로 자주 거론된다.

## 강점

- **압축·저장 밀도가 이 클래스에서 최상급이다.** 컬럼 파일 위에 타입별 codec(timestamp의 DoubleDelta, 느린 float의 Gorilla, 단조 int의 Delta)을 깔고 그 위에 LZ4/ZSTD를 얹는다. Elasticsearch처럼 `_source`(원본 JSON의 거의 완전한 사본)와 inverted index를 함께 들고 있지 않고 컬럼에서 행을 재구성하므로 디스크가 근본적으로 작다.
  - OTel 로그 벤치에서 **CH 내부 압축 ~16.3x**, **디스크 상 Elasticsearch 대비 ~4.95x 작음** `[벤치]` (ClickHouse blog, OSS v26.3, 2026-04-23; 1B/10B/50B rows 전 구간에서 유지).
  - 실무 관측치: 구조화 로그 **~10:1–20:1** `[추정/벤더]`, Uber는 보수적으로 **3x, 경우에 따라 30x** `[벤더]`. nginx류 반복성 높은 access log는 **>100x**(178x 인용 사례)까지 간다 `[벤더]`. 용량 계획용 raw→디스크 비율은 **8~12x가 보수적**이고 좋은 schema면 **10~30x** 도달 가능 `[추정]`.
- **분석 쿼리 성능이 뛰어나다.** 대규모 병렬 컬럼 스캔과 벡터화 실행으로 aggregation·필터가 매우 빠르다. Uber는 단일 노드에서 **300K logs/s ≈ ES 노드의 약 10x** 처리, 타입드 schema로 **aggregation 50x 빠름** `[벤더]`. Trip.com은 ES 대비 **4~30x 빠른 쿼리**(P90 <300ms, P99 <1.5s) `[벤더]`, Cloudflare는 **96조(96T) 이벤트를 <2s에 스캔** `[벤더]`.
- **인프라 비용이 크게 낮다.** OpenSearch/ELK 대비 인프라 기준 큰 절감(대략 **7~15배** 보고 사례) `[벤더]`. Uber는 ELK 대비 **hardware >50% 절감** `[벤더]`, Didi는 **~30% 절감** `[벤더]`, 한 crypto-derivatives 플랫폼은 OTel 통합으로 관측성 청구를 high-six-figures에서 **~$50K(약 90% 절감)** `[벤더]`.
- **통합 저장소 잠재력.** 로그·트레이스·이벤트를 한 스키마 계열로 다루고 SQL로 조회한다. TTL 티어링, materialized view, AggregatingMergeTree 같은 프리미티브로 pre-aggregation·다운샘플·hot→cold 이동을 엔진 안에서 처리한다. 로그 검색에 필요한 **풀텍스트 text index GA(2026-03)**, **native JSON GA(25.3)**도 이미 정식이다.
- **PB 스케일에서 실전 검증됨.** Trip.com은 **4PB→50PB+**로 성장 `[벤더]`, Cloudflare는 quadrillion-row 스케일을 active-active로 운영. 성능·비용 방향성이 매우 큰 규모에서도 일관된다.
- **넓은 생태계와 성숙한 운영 도구.** 드라이버/BI/OTel/Vector 연동이 풍부하다. **Altinity clickhouse-operator**는 약 7년간 사실상 표준(라인 0.27.x, 0.27.1은 2026-06-04·FIPS 지원), ClickHouse Inc.의 **공식 first-party operator**도 2026-01 등장했다. 조율 계층인 **ClickHouse Keeper**는 JVM/GC가 없어 ZooKeeper보다 가볍다 — Bonree는 교체로 **CPU/메모리 >75% 절감, IO·성능 ~8x** `[벤더]`. `clickhouse-backup`, Terraform EKS blueprint 등 도구가 갖춰져 있다.
- **유연한 스토리지 티어링.** EBS gp3(churn 이후 생존, snapshot 용이), 로컬 NVMe(최고 throughput·최저 latency; i7ie는 노드당 최대 **120 TB**, i3en 대비 실시간 성능 ~65%↑·I/O latency ~50%↓ `[벤더]`), TTL MOVE로 S3 콜드 티어까지 워크로드에 맞춰 조합할 수 있다.

## 약점 · 한계

- **스키마·테이블 설계가 상시 스킬 요구사항이다.** 좋은 `ORDER BY`·partition·codec·TTL·materialized view에는 보상하고, 나쁜 설계에는 낮은 압축과 느린 쿼리로 벌을 준다. "JSON을 index하고 시작"하는 OpenSearch와 달리 CH는 의도적 설계와 로그 형태 변화 시 재검토를 요구한다. 특히 **field와 query pattern을 알 때 빛나며**, unknown/volatile field가 지배적이면 효율이 "may suffer significantly depending on schema."
- **셀프호스트 운영 부담이 실재한다.** 잦은(때로 breaking) 버전 업그레이드 검증, multi-TB 테이블의 `ALTER`/`INSERT SELECT` backfill, 백업 운영이 사용자 몫이다. 표준 도구 `clickhouse-backup`의 **incremental 체인은 fragile** — incremental restore에 체인의 모든 이전 백업이 필요하고 하나라도 손상되면 복구 불가라 weekly-full + daily-incremental·정기 restore drill을 직접 소유해야 한다. TCO 추정으로 대략 **엔지니어 시간 ~10–20%(~$2–4k/월)** `[추정]`이며 관리형 이전은 ops를 ~10 hrs/월 줄이는 대신 10 TB에서 비용을 **~3.4x** 올린 사례가 있다 `[추정/벤더]`.
- **진짜 storage-compute 분리는 Cloud 전용이다.** SharedMergeTree는 proprietary·Cloud 전용이고, self-host의 zero-copy-S3는 사실상 폐기됐다(데이터 손상 이력 #39560, 22.8부터 default off, ~2024-04 이후 upstream 기여 거부). 결과적으로 self-host는 shared-nothing이고 **RF2는 S3에서도 사본이 두 배**가 되며 스케일아웃 = 리샤딩이다. OSS 대안인 Altinity **Antalya**(Iceberg/Parquet + stateless swarm)는 유망하나 아직 성숙 중.
- **EKS stateful 엣지케이스.** EBS는 **AZ 고정**이라 node churn 시 `volume node affinity conflict`가 나 `WaitForFirstConsumer` + per-AZ node group / shard-per-AZ 설계가 필요하고, 로컬 NVMe는 **ephemeral**이라 RF2 + node 손실 시 네트워크 rebuild가 전제된다. PDB `maxUnavailable:1`, topology spread는 필수.
- **S3 콜드 티어의 숨은 비용.** data가 S3에 있어도 **part metadata는 로컬 디스크**에 남아 desync 시 orphan S3 파일이 생기고(백업 필요), disk cache가 사실상 필수, 콜드 쿼리는 로컬보다 느리며, **S3 lifecycle policy 사용은 금지**(테이블 손상 위험)다.
- **turnkey 로그 UI가 아니다.** Kibana/OpenSearch Dashboards에 대응하는 내장 로그 검색 UI가 없다 — Grafana나 [HyperDX / ClickStack]({{< relref "05-hyperdx-clickstack.md" >}})를 별도로 얹어야 한다.

## 적합 / 부적합

| | |
|---|---|
| **적합** | 대규모(수십 TB~PB/day) 로그·이벤트, 알려진/안정적 schema와 query pattern, 강한 aggregation·analytics 요구, SQL 친화 팀, 통합 저장소 야심, 비용 최적화가 절실하고 **전담 오너가 있는** 조직 |
| **부적합** | unknown/volatile field가 지배적인 로그(임의 access log 등), 소규모·오너 없는 팀, turnkey 관리형을 원하는 경우, self-host에서 즉시 storage-compute 분리가 필요한 경우 |

StarRocks와의 정면 비교는 [ClickHouse vs StarRocks]({{< relref "07-clickhouse-vs-starrocks.md" >}}) 참고.

## 우리 케이스에서는

우리는 PLG 방치 이력이 있는 소규모 플랫폼 팀이고, self-hosted CH는 managed OpenSearch보다 운영 부담이 **더 크지 덜하지 않다** — 여기서 지배적 위험은 기술이 아니라 오너십이다. 명시적 오너 + 런북 + 정기 리뷰를 못 박을 수 없다면 관리형(ClickHouse Cloud / Altinity.Cloud) 견적과 반드시 비교해야 하고, volatile한 istio access log 경로에는 단일 바이너리로 임의 field를 처리하는 [VictoriaLogs]({{< relref "03-victorialogs.md" >}})가 더 가벼운 후보다. 따라서 self-hosted CH를 1차 채택안으로 밀지 않는다.

채택을 전제했을 때의 배포·스토리지·operator 운영 전략 심화(how)는 [ClickHouse 운영]({{< relref "../clickhouse/_index.md" >}}) 도메인 참조 — 여기(로그 내재화 관점의 채택 여부)와 전제가 다르다.
