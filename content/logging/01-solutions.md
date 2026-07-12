---
title: "솔루션별 특징"
weight: 1
---

# 솔루션별 특징

각 솔루션의 성격과 장단점, 그리고 우리 케이스에서의 포지션을 정리한다. 개요·현재 구조 진단·4개 결정 프레이밍은 [챕터 개요]({{< relref "_index.md" >}}), 최종 조합과 마이그레이션 순서는 [우리 케이스 · 권장안]({{< relref "02-recommendation.md" >}})에서 다룬다.

## 1. OpenSearch (EFK) — 지금 쓰는 것, 왜 뚱뚱해 보이는가

`fluent-bit → Firehose → OpenSearch(+ UltraWarm)` 파이프라인 자체는 정석이다. 문제는 **요금 구조**다.

- **비용의 ~90%가 인스턴스 시간**, 스토리지는 10%뿐이다. 로그가 S3를 적극적으로 쓰는 것처럼 보여도 청구서는 컴퓨트에 묶여 있다.
- **UltraWarm 노드는 RI(예약 인스턴스) 예약 불가**다. 반면 흔한 오해와 달리 **hot 데이터 노드와 dedicated master는 RI 적격**이다. 예약 불가는 UltraWarm과 Cold storage뿐.

**청구서 해부 (리스트가, us-east-1 기준 파생 추정):**

| 항목 | 온디맨드 | 1yr RI | 3yr RI |
|---|---|---|---|
| Hot 10× i7i.4xlarge ($2.416/h) | $17,637 | $12,169 (~31%↓) | $9,169 (~48%↓) |
| UltraWarm 8× ultrawarm1.large ($2.68/h, **예약 불가**) | $15,651 | $15,651 (flat) | $15,651 (flat) |
| **compute 합계** | **$33,288** | $27,820 | $24,820 |
| **블렌디드 절감** | — | **~16%** | **~25%** |

여기서 나오는 정정: **"전체 클러스터 40% RI 절감"은 성립하지 않는다.** hot을 예약해도 UltraWarm이 잔여 compute의 ~63%를 차지하며 **영구 온디맨드로 고정**(연 ~$188K)되기 때문에, 블렌디드 절감 상한은 ~25%다. → 결론은 **warm/cold tail을 컬럼나+S3로 빼는 것**이 RI보다 절감폭이 크다는 방향으로 강화된다.

**in-place 최적화 카드 (해체 없이 지금 할 수 있는 것):**

- **OR1 / OR2 "Standard" 계열로 이전** — replica가 로컬 NVMe가 아니라 **S3-backed**라 replica compute/EBS 비용이 소멸한다. AWS 자체 수치로 **~30% price-performance 개선, 색인 처리량 +26%(OR2 vs OR1)** `[벤더]`. 게다가 **OR1/OR2는 RI/NURI 적격**이라, hot을 작게 만들어 OR로 옮긴 뒤 그 작은 tier에 NURI를 얹는 조합이 가능. OR2 + Parquet 엔진은 스토리지 ~70%↓(단 새 도메인 필요) `[벤더]`.
- **Cold tier 함정**: OpenSearch cold storage도 rehydrate에 (할인 불가) UltraWarm 노드가 필요하다. cold 노드 대신 **S3 Direct Query(zero-ETL)** 또는 컬럼나+S3로 tail을 빼는 게 낫다.

- **장점**: 풀텍스트 검색·집계 성숙도, Kibana/Dashboards·SIEM 플러그인, 관리형 운영.
- **단점**: 로그 저장 목적 대비 과한 비용 구조, 노드 상시 가동 전제, UltraWarm 영구 온디맨드.

> 판단: 90일 보존이 정말 필요한지부터 되묻는다. 절감의 대부분은 **보존 tail을 컬럼나+S3로 이전 + hot 축소·OR 이전**에서 나온다. UltraWarm 8대(연 ~$188K 고정)를 컬럼나+S3 tail로 대체하면, 대체 비용(~$24–48K/yr) 차감 후 **순 ~$140K+/yr 절감**(hot RI 최대 절감 ~$100K/yr를 압도).

## 2. Loki + Alloy — PLG를 ALG로 되살리기

Grafana 진영의 로그 집계 스택. promtail이 EOL되고 **Alloy**로 대체되면서 PLG(Promtail-Loki-Grafana)가 ALG(Alloy-Loki-Grafana)로 재편됐다.

- **강점**: object storage(S3) 네이티브라 **장기 보존 비용이 낮다.** 라벨 카디널리티가 낮은 로그에 최적.
- **약점**: TSDB 스키마·카디널리티 설계라는 **새 운영 모델을 학습**해야 한다. istio 액세스 로그의 client IP·trace ID·URI·status 같은 **고카디널리티 필드는 Loki 라벨에 독**이다(같은 필드가 VictoriaLogs에는 무해). bloom filter 검색은 여전히 experimental.
- **구조적 리스크**: promtail은 EOL 확정(3.7.3부터 제거). 그리고 중간 규모용 **Simple Scalable Deployment(SSD, read/write/backend 3-target) 모드가 Loki 4.0 전에 제거 예정**이다 — single-binary(monolithic)·distributed 모드는 유지되지만, SSD가 사라지면 istio 규모(~100–300GB/day)는 HA-monolithic으로, 전체 앱 로그 규모(~2TB/day)는 distributed/microservices로 밀려 운영 부담이 커진다.
- 검색 성능 참고: 500GB 풀텍스트에서 **VictoriaLogs ~900ms vs Loki ~12s** `[벤더/벤치]`.

> 판단: Grafana는 그대로 쓰지만 **운영해야 할 스택이 하나 더 는다.** 이미 방치했던 전례가 있는 팀이라면 rot 리스크가 그대로 재현된다. → 보류.

## 3. VictoriaLogs — VM을 이미 쓴다면 가장 자연스러운 선택

VictoriaMetrics 패밀리의 로그 저장소. 메트릭에서 이미 검증한 **싱글 바이너리 / vmagent·vmalert·vmauth 운영 모델을 그대로 재사용**한다.

- **강점**: 초경량 · 낮은 리소스 · 풀텍스트(LogsQL) 지원. 수집 호환이 넓다 — fluent-bit / OTLP / syslog / **Loki push API**(Alloy를 그대로 붙일 수 있음) / vlagent. 내장 UI + Grafana 공식 데이터소스.
- **가장 큰 자산**: 팀이 이미 Victoria 운영 모델을 학습했다는 것. **학습·rot 비용이 0에 가깝다.**
- **제약**: 현재 **쿼리 가능한 네이티브 S3/오브젝트 티어 없음**(로드맵) → 90일 tail은 EBS/gp3에 얹어야 한다. 클러스터 내 복제가 없어 HA는 **미러 2클러스터**(2배 스토리지) 또는 EBS+백업 규율이 필요. 트레이스/RUM 기능은 없다(로그 전용).
- GA 이력: 단일 노드 2024-11, 클러스터 2025-06. 채택 사례는 아직 얇은 편.

> 판단: istio 로그처럼 규모가 크지 않은(~100–300GB/day) 로그부터 얹기에 가장 리스크가 작다. cold(30–90일) tail은 S3 Parquet(VL cold mount / CH-on-S3 / Athena)로 분리 설계. VictoriaMetrics의 내부 동작은 [VictoriaMetrics 지식베이스]({{< relref "../monitoring/victoriametrics/_index.md" >}}) 참고.

## 4. ClickHouse (self-hosted on EKS) — 통합 저장소로서의 야심

컬럼형 OLAP 데이터베이스. 로그·트레이스·웹 RUM을 **한 저장소로 흡수**할 수 있는 확장성이 매력이다.

- **강점**: 압축률이 실측으로 검증됨(구조화 로그 10~20x+ `[추정/벤더]`). 로그·트레이스·이벤트를 한 스키마 계열로 다룰 수 있어 통합 잠재력이 크다. **풀텍스트 text index GA(2026-03), native JSON GA(25.3)** — 로그 검색에 필요한 기능이 이미 정식이다. 생태계가 넓다(드라이버/BI/OTel/Vector, 성숙 operator).
- **비용**: 인프라만 보면 OpenSearch 대비 크게 절감(대략 7~15배 보고 사례 `[벤더]`).
- **약점**: 셀프호스트 CH는 **관리형 OpenSearch보다 운영 부담이 늘어나는 방향**이다 — 스키마/ORDER BY/TTL 설계, 백업 증분 체인, 업그레이드. **진짜 storage-compute 분리(SharedMergeTree)는 Cloud 전용**이고, self-host의 zero-copy-S3는 폐기됐다(데이터 손실 이력) → self-host는 shared-nothing + 로컬 NVMe라 스케일아웃 = 리샤딩.
- **전제 조건**: 명시적 오너 + 런북 + 정기 리뷰를 못 박을 수 없다면, 관리형(ClickHouse Cloud / Altinity) 견적과 반드시 비교.

## 5. HyperDX / ClickStack — ClickHouse 위의 통합 프론트

ClickHouse Inc.가 HyperDX를 인수(2025-03)해 **ClickStack**으로 출시(2025-05, GA). ClickHouse를 백엔드로 하는 로그·트레이스·세션 리플레이 통합 UI. MIT 라이선스, 활발한 릴리스. ClickHouse를 로그 스토어로 고를 때 **비어 있는 "관측성 제품층"을 채워주는 조각**이다.

- **웹 RUM**: `@hyperdx/browser`가 rrweb 세션 리플레이 + 에러 + Web Vitals + 네트워크 캡처 + **백엔드 트레이스 연동**(TraceId·rum.sessionId 상관)까지 지원. Datadog 웹 RUM 대체로 현실성 있다.
- **모바일 RUM**: **네이티브 iOS/Android/Flutter 세션 리플레이가 존재하지 않는다(2026).** RN 쪽도 트레이스/에러/네트워크만. "FE/Mobile RUM 중계처" 계획에서 모바일 절반이 공중에 뜬다.
- **확장(APM/로깅)**: 로그·트레이스는 강하지만 메트릭은 PromQL 미지원, 알림은 단일 임계값, 대시보드는 템플릿 변수도 없다. → **VictoriaMetrics/Grafana를 대체하지는 못한다. 메트릭은 절대 ClickHouse에 억지로 넣지 말 것.**

> 판단: 통합 프론트로 욕심내기 전에, **Datadog RUM usage를 소스별(웹/모바일)로 분해**해 모바일 비중부터 확인. 모바일이 과반이면 웹 전용 HyperDX는 청구서를 별로 못 줄이면서 관리 스택(CH+MongoDB)만 추가한다.

## 6. StarRocks — S3 위 stateless 컴퓨트, 그러나 로그엔 이르다

Linux Foundation MPP OLAP 엔진(Apache-2.0). Doris 포크를 vectorized exec + CBO로 재설계했고, 상용 백커는 CelerData. **"EKS에서 pod/node가 ephemeral해도 클러스터링되는 NoSQL/OLAP"**라는 요구에 가장 정직하게 답하는 후보라 검토했다.

- **진짜 강점 — shared-data 모드**: FE(메타) + **CN(Compute Node, stateless)** 구조로, 1차 데이터가 **S3에** 있고 CN은 로컬 hot 캐시만 쓴다. **CN을 초 단위로 add/remove, 리밸런스 없음** — ClickHouse의 실험적/폐기된 zero-copy-S3와 달리 **first-class GA 설계**(v3.1 GA, 3.3~4.1 성숙). 1st-party K8s Operator + Helm, AWS 레퍼런스(EKS + KEDA + Karpenter)까지 있다. **이게 self-host에서 CH가 못 하는 유일하고 결정적인 차별점.**
- **중요한 단서**: "완전 ephemeral"은 과장이다. **FE 메타데이터 쿼럼은 여전히 stateful**(BDBJE 기반, 홀수 3/5 StatefulSet + PV 필수). durable 앵커는 항상 박힌다.
- **로그 적합성이 약점**: 로그의 핵심인 **풀텍스트 inverted index가 가장 미성숙**하다. shared-data(=S3 위 ephemeral, 유저가 쓸 모드)에서 동작하는 구현은 **v4.1(2026)에서 나온 Beta**이고 파서도 하나뿐. JSON/반정형(FLAT JSON GA v4.0)과 고카디널리티는 우수하지만, 정작 needle-search가 young하다.
- **수집 마찰**: 네이티브 OTLP 리시버 없음 → OTel Collector가 Kafka(Routine Load)나 Stream Load HTTP로 landing시켜야 한다. OTel 스파인 계획과 어긋난다.
- **결정적 갭 — 생태계**: **턴키 관측성 UI가 전무**하다(SQL 인터페이스만, live-tail/trace-waterfall/RUM 없음). Grab이 StarRocks 관측성에 자체 Golang 백엔드 + 커스텀 프론트를 만든 게 그 증거 — 그 glue를 직접 소유해야 한다. 게다가 스케일 로그 프로덕션 레퍼런스가 사실상 0(플래그십 유저는 전부 BI/레이크하우스/JOIN 용도). 운영 부담은 3개 후보 중 최고이고 VM 스킬 재사용은 0. 스폰서 CelerData가 2026-05 PhoenixAI로 피벗해 로드맵 불확실성도 있다.
- **압축**: ~5:1–10:1, ES 대비 인프라 50~80% 절감 `[벤더]`.

> 판단: **로그 스토어로는 아직 얼리어답터 영역.** "고동시성·JOIN-heavy·S3-elastic 분석/레이크하우스 플랫폼(로그는 그중 한 테넌트)"라는 별도 mandate가 생길 때만 back-pocket에 둔다.

## 참고 — ClickHouse vs StarRocks (로그/관측성 한정)

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

## RUM 내재화 → 별도 도메인

Datadog RUM(RWoL 재요율로 실질 ~2배 인상)에서 빠져나오는 웹/모바일 세션 리플레이 대안 — 웹은 HyperDX(rrweb)로 탈출 가능, 모바일은 대안 미성숙 — 은 [RUM 내재화]({{< relref "../rum/_index.md" >}}) 도메인에서 별도로 다룬다.
