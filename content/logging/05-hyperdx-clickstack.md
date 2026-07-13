---
title: "HyperDX / ClickStack"
weight: 5
---

# HyperDX / ClickStack — ClickHouse 위의 통합 프론트

ClickHouse Inc.가 HyperDX를 인수(2025-03)해 **ClickStack**으로 출시(2025-05)한, ClickHouse를 백엔드로 하는 **OpenTelemetry-native 관측성 스택**이다. HyperDX UI/API + 전용 OTel Collector + ClickHouse + 상태 저장용 MongoDB의 조합으로 로그·트레이스·세션 리플레이를 한 화면에서 다룬다. 메인 repo는 **MIT 라이선스**(Grafana AGPL·SigNoz보다 관대)이고, ClickHouse Inc.가 정식 스튜어드로 월간 릴리스를 낼 만큼 개발 속도가 빠르다(~9.7k stars, 활발한 릴리스 라인).

## 강점

- **로그·트레이스 검색이 강하다.** 밑단이 ClickHouse라 컬럼 압축(Elasticsearch 대비 12~19x `[벤더]`)과 native JSON type("10x faster searches, 100x less data scanned" `[벤더]`)의 이점을 그대로 받는다. 고카디널리티에서 per-series 메모리 폭발이 없고, Lucene 스타일 검색과 풀 SQL을 함께 쓴다. `bloom_filter` 인덱스 개선(검색 ~5x `[벤더]`)과 inverted text index(beta, bloom 대비 ~9x `[벤더]`, ClickHouse v25.12+)로 로그 검색 경로가 계속 빨라진다. OpenSearch를 걷어낼 때 가장 설득력 있는 대상이 로그다.
- **replay → trace → log 상관이 시그니처 강점.** `@hyperdx/browser`는 rrweb 세션 리플레이 + 에러 + Web Vitals + 네트워크 캡처(헤더·바디, 키워드 기반 민감정보 필터)를 제공하고, 리플레이의 네트워크 요청/에러를 클릭하면 백엔드 트레이스·로그·스팬·DB 쿼리로 바로 조인된다. 이 조인은 SigNoz를 포함한 대부분의 OSS 경쟁자가 못 따라오는 부분이고, 실무자들이 웹 세션 리플레이를 "exceptional"로 부른다. **웹 프론트엔드 한정으로는 Datadog RUM을 현실성 있게 대체한다.**
- **스키마·수집 경로 유연성.** 고정 스키마가 아니라 bring-your-own ClickHouse를 허용한다 — HyperDX-only 모드로 기존 ClickHouse를 그대로 가리킬 수 있고, OTLP뿐 아니라 Vector, Kafka/S3 table engine, raw insert 등 여러 수집 경로를 받는다. 이미 ClickHouse를 운영 중이거나 기존 파이프라인(예: fluent-bit/Vector)을 재사용하려는 조직에 잘 맞는다.
- **OTel-native 트레이싱/APM.** 트레이스 워터폴, Service Maps(beta, 2025-11), Event Deltas(root-cause 상관 지원). Datadog APM보다 어리지만(코드레벨 continuous profiler 없음) 탄탄하고 개선 속도가 빠르다.
- **성숙한 밑단 + 관대한 라이선스 + 백킹.** ClickHouse 자체는 페타바이트급에서 검증됐고 스키마 최적화가 "up to tens of TB/day" `[벤더]`를 커버한다. MIT + ClickHouse Inc. 스튜어드십은 PLG 스택의 abandonware 리스크를 실질적으로 낮춘다. Datadog 대비 인프라 비용 기준 5~20x 저렴하다는 것이 시장이 받아들이는 tradeoff다 `[추정]`.

## 약점 · 한계

- **네이티브 모바일 RUM이 없다(결정적).** 세션 리플레이는 rrweb 기반 브라우저 전용이고, iOS(Swift)/Android(Kotlin)/Flutter 퍼스트파티 SDK가 없다. 유일한 모바일 SDK인 `@hyperdx/otel-react-native`는 트레이스·에러·네트워크만 수집하고 리플레이가 없다. Datadog RUM의 **모바일** 부분은 ClickStack만으로 내재화할 수 없다.
- **메트릭이 가장 약하다.** OTel 메트릭을 저장은 하지만 **PromQL이 없다**(SQL/Lucene only, PromQL은 로드맵). exemplars 부재 등으로 메트릭→트레이스 상관도 얕다. VictoriaMetrics/PromQL 대비 regression이다.
- **알림·대시보드가 어리다.** 알림은 rule당 단일 임계값, anomaly detection 없음(로드맵), alert history 없음, IaC/Terraform 없음. 대시보드는 템플릿 변수 없음, chart aggregation 옵션 제한, 프리셋 라이브러리가 작다(SigNoz 30+·Grafana 생태계 대비 소수 `[추정]`). curated 대시보드보다 **ad-hoc 고카디널리티 탐색**에 강하다.
- **운영 표면이 넓다.** 상태 저장용 **MongoDB**가 별도 데이터스토어로 붙고(구버전 insecure default 이력), 스케일에서는 ClickHouse ops(Keeper 기반 replication, sharding, part merge, TTL, async insert 배치)를 직접 떠안는다. 관리형 ClickStack은 아직 **Beta**. 첫 기동 시 app/API URL·CORS 설정이 흔한 트립 해저드다.
- **대규모 레퍼런스가 얇다.** ClickHouse(DB) 채택 사례는 많지만(Netflix/eBay/Cloudflare 등), 패키지드 **ClickStack 자체**의 대규모 named 프로덕션 사례는 제품이 ~1년 되어 아직 적다.

## 적합 / 부적합

- **적합**: 로그 + 웹 세션 리플레이 + 트레이스를 한 UI로 묶고 싶고, ClickHouse를 오너십할 수 있는 팀. OpenSearch를 압축·S3 티어링으로 걷어내려는 로그 중심 워크로드. ClickHouse 저장소 자체의 상세는 [ClickHouse (self-hosted)]({{< relref "04-clickhouse.md" >}}) 참고.
- **부적합**: 네이티브 모바일 RUM이 핵심이거나, PromQL·성숙한 알림/대시보드가 우선인 메트릭 헤비 조직. ClickHouse 오너를 못 박을 수 없는 팀.

## 우리 케이스에서는

로그는 더 가벼운 [VictoriaLogs]({{< relref "03-victorialogs.md" >}})로 가고 ClickStack은 채택하지 않는다 — CH+MongoDB라는 운영 표면을 새로 얹는 비용이 이번 로그 규모에는 과하다. 통합 프론트를 욕심내기 전에 Datadog RUM usage를 소스별(웹/모바일)로 분해해 모바일 비중부터 확인해야 하며, 모바일이 과반이면 웹 전용 HyperDX는 청구서를 별로 못 줄이면서 관리 스택만 늘린다. RUM 내재화 자체는 [RUM 내재화]({{< relref "../rum/_index.md" >}}) 도메인에서 다룬다. HyperDX 플랫폼 심층 분석(아키텍처·배포 모드·접근통제 갭)과 Datadog RUM 커버리지 매트릭스는 [HyperDX / ClickStack 심층 분석]({{< relref "../rum/01-hyperdx-deep-dive.md" >}}) · [Datadog RUM 커버리지]({{< relref "../rum/02-datadog-rum-coverage.md" >}}) 참조.
