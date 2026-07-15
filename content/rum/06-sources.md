---
title: "출처"
weight: 7
---

# 출처 — RUM 섹션 조사 문서 원본 링크

RUM 섹션(01~05)은 `research/hyperdx-clickhouse/` 아래 8개 조사 문서(01-hyperdx-deep-dive, 02-rum-replacement, 03-datadog-replacement-matrix, 07-recommendation, 08-supplement-1~2·4~5)를 근거로 큐레이션했다. 이 페이지는 그 조사 문서들의 "## 출처" 섹션에 나열된 URL을 전부 수집·중복 제거해 주제별로 재정리한 것이다. 개별 URL이 본문 어느 주장을 뒷받침하는지는 각 조사 문서를 직접 대조해야 하며, 이 페이지는 색인 목적으로만 쓴다. [HyperDX의 MongoDB]({{< relref "07-hyperdx-mongodb.md" >}})(07)는 별도 딥리서치(3-vote 적대검증, 2026-07-15) 기반이며 해당 근거 URL도 아래 표에 포함했다. 조사 기준 2026-07.

## HyperDX·ClickStack 공식

ClickHouse Inc./HyperDX가 직접 게시한 블로그·공식 문서·GitHub 레포·이슈.

| 출처 | 비고 |
|---|---|
| [ClickHouse Acquires HyperDX (businesswire, 2025-03-13)](https://www.businesswire.com/news/home/20250313954782/en/ClickHouse-Acquires-HyperDX-to-Accelerate-the-Future-of-Observability) | 인수 공식 발표 |
| [HyperDX Blog — ClickHouse acquires HyperDX](https://www.hyperdx.io/blog/clickhouse-acquires-hyperdx-to-accelerate-the-future-of-open-source-observability) | 인수 발표(HyperDX 측) |
| [ClickStack 출시 블로그 (2025-05-29)](https://clickhouse.com/blog/clickstack-a-high-performance-oss-observability-stack-on-clickhouse) | ClickStack 정식 출시 |
| [Announcing ClickStack in ClickHouse Cloud (2025-08-06)](https://clickhouse.com/blog/announcing-clickstack-in-clickhouse-cloud) | Cloud Private Preview |
| [ClickStack: A (half) year in review (2026-01)](https://clickhouse.com/blog/clickstack-a-year-in-review-2025) | 2025년 기능 타임라인·2026 로드맵 |
| [ClickStack Docs — Deployment 개요](https://clickhouse.com/docs/use-cases/observability/clickstack/deployment) | 배포 옵션 매트릭스 |
| [ClickStack Docs — HyperDX only (BYO ClickHouse)](https://clickhouse.com/docs/use-cases/observability/clickstack/deployment/hyperdx-only) | BYO ClickHouse 공식 경로 |
| [ClickStack Docs — Helm 배포](https://clickhouse.com/docs/use-cases/observability/clickstack/deployment/helm) | Helm 차트 이관 안내 |
| [ClickStack Docs — Tables & schemas](https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/schemas) | ClickHouse 테이블 스키마 |
| [ClickStack Docs — Production](https://clickhouse.com/docs/use-cases/observability/clickstack/production) | 기본 TTL 3일(`TABLES_TTL`)·인제스트/쿼리 vCPU 사이징 가이드 |
| [ClickStack Docs — OTel collector](https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/otel-collector) | 커스텀 collector 설정 |
| [ClickStack Docs — Alerts](https://clickhouse.com/docs/use-cases/observability/clickstack/alerts) | 알림 타입·통합 |
| [ClickHouse Cloud Docs — HyperDX](https://clickhouse.com/docs/cloud/manage/hyperdx) | Cloud 통합 관리 |
| [HyperDX Docs — OSS vs Cloud](https://www.hyperdx.io/docs/oss-vs-cloud) | SSO/RBAC/멀티테넌시 배포별 비교 |
| [HyperDX Docs — Managing Alerts (API)](https://www.hyperdx.io/docs/api/alerts) | 알림 채널 API |
| [HyperDX Docs — Enterprise SSO](https://www.hyperdx.io/docs/integrations/enterprise-sso) | SAML(Enterprise 전용) |
| [HyperDX Docs — Browser SDK](https://www.hyperdx.io/docs/install/browser) | `@hyperdx/browser` 초기화·API |
| [HyperDX Docs — React Native SDK](https://www.hyperdx.io/docs/install/react-native) | 모바일 SDK(RN만) |
| [HyperDX Pricing](https://www.hyperdx.io/pricing) | Cloud 요금제 |
| [HyperDX v2 landing](https://www.hyperdx.io/v2) | v2 오픈소스 UI 소개 |
| [HyperDX 공식 홈](https://www.hyperdx.io/) | 제품 랜딩 |
| [HyperDX Blog — Datadog alternatives](https://www.hyperdx.io/blog/datadog-alternatives) | 벤더 관점 대체 포지셔닝 |
| [HyperDX Blog — Browser 기반 분산 트레이싱](https://www.hyperdx.io/blog/browser-based-distributed-tracing-with-opentelemetry) | otel-web 구현 배경 |
| [GitHub hyperdxio/hyperdx](https://github.com/hyperdxio/hyperdx) | 메인 모노레포(UI+API) |
| [GitHub hyperdxio/hyperdx — models/alertHistory.ts](https://github.com/hyperdxio/hyperdx/blob/main/packages/api/src/models/alertHistory.ts) | alertHistory 30일 TTL 인덱스 코드 근거 |
| [GitHub ClickHouse/ClickStack](https://github.com/ClickHouse/ClickStack) | 스택 아티팩트 레포 |
| [GitHub ClickHouse/ClickStack-helm-charts (README)](https://github.com/ClickHouse/ClickStack-helm-charts/blob/main/README.md) | 공식 Helm 차트(신규 위치) |
| [GitHub hyperdxio/helm-charts (구 위치)](https://github.com/hyperdxio/helm-charts) | Helm 차트 이관 전 레포 |
| [Issue #1293 — RBAC (CLOSED, not planned)](https://github.com/hyperdxio/hyperdx/issues/1293) | OSS RBAC 요청, 계획 제외 확정 |
| [Issue #1329 — Disable Auth / Declarative Credentials (OPEN)](https://github.com/hyperdxio/hyperdx/issues/1329) | 인증 비활성화 미구현 |
| [Issue #1766 — Disable Auth 연계](https://github.com/hyperdxio/hyperdx/issues/1766/linked_closing_reference?reference_location=REPO_ISSUES_INDEX) | #1329 관련 이슈 |
| [Issue #2162 — MCP OAuth 405](https://github.com/hyperdxio/hyperdx/issues/2162) | 최신 버그 사례(2026-04) |
| [GitHub hyperdxio/hyperdx-js](https://github.com/hyperdxio/hyperdx-js) | 브라우저 SDK 모노레포 |
| [npm @hyperdx/otel-react-native](https://www.npmjs.com/package/@hyperdx/otel-react-native) | RN 모바일 SDK 패키지 |
| [GitHub hyperdxio/hyperdx-otel-react-native](https://github.com/hyperdxio/hyperdx-otel-react-native) | RN SDK 소스(★4, signalfx 추종 포크) |
| [ClickStack Docs — Overview](https://clickhouse.com/docs/use-cases/observability/clickstack/overview) | 조인키(TraceId·rum.sessionId) |
| [ClickStack Docs — Session Replay](https://clickhouse.com/docs/use-cases/observability/clickstack/session-replay) | 리플레이 UI 기능 범위 |
| [ClickStack Docs — Vector ingest](https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/vector) | Vector→ClickStack 인제스천 |
| [ClickStack Docs — OpenTelemetry ingest](https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/opentelemetry) | OTel 네이티브 인제스천 경로 |
| [ClickStack 소개 페이지](https://clickhouse.com/clickstack) | 제품 개요 |
| [ClickHouse — Observability use case](https://clickhouse.com/use-cases/observability) | 관측성 유스케이스 허브 |
| [ClickHouse — 8 best Datadog alternatives](https://clickhouse.com/resources/engineering/datadog-alternatives) | 대체 전략 공식 가이드 |
| [ClickHouse — Scaling Observability beyond 100PB (LogHouse)](https://clickhouse.com/blog/scaling-observability-beyond-100pb-wide-events-replacing-otel) | 자사 LogHouse 사례·OTel 처리량 |
| [ClickHouse — Observability TCO & cost reduction](https://clickhouse.com/resources/engineering/observability-tco-cost-reduction) | TCO 자료 |
| [ClickHouse — How Anthropic is using ClickHouse](https://clickhouse.com/blog/how-anthropic-is-using-clickhouse-to-scale-observability-for-ai-era) | Anthropic 자체 스택(ClickStack 아님) |
| [ClickHouse — Scaling observability at Character.AI](https://clickhouse.com/blog/scaling-observabilty-for-thousands-of-gpus-at-character-ai) | Character.AI 로그/트레이스 이관 |
| [ClickHouse — Datadog & ClickHouse partnership (2026-06-10)](https://clickhouse.com/blog/datadog-and-clickhouse-partnership) | Observability Pipelines native CH destination |
| [ClickHouse — Bindplane faster OTel migrations to ClickStack](https://clickhouse.com/blog/bindplane-faster-otel-migrations-to-clickstack) | Bindplane 협업 |
| [ClickHouse Docs — Integrating OpenTelemetry](https://clickhouse.com/docs/observability/integrating-opentelemetry) | OTel gateway 처리량 참고치 |
| [ClickHouse — OTel to Rotel (4x throughput)](https://clickhouse.com/blog/otel-to-rotel-petabyte-scaling-tracing-4x-greater-throughput) | 변환 계층 CPU 비용 벤치 |
| [ClickHouse — What's new in ClickStack, Sep '25](https://clickhouse.com/blog/whats-new-in-clickstack-september-2025) | 대시보드 import/export |
| [ClickHouse — Alerting arrives in ClickStack (2025-11-05)](https://clickhouse.com/blog/alerting-arrives-in-clickstack-for-clickhouse-cloud) | OSS 알림 패리티 |
| [ClickHouse — ClickStack SQL charting and alerting (2026-05)](https://clickhouse.com/blog/clickstack-sql-charting-and-alerting) | SQL 기반 이상탐지 |
| [ClickHouse — RBAC in ClickStack (2026-04-01)](https://clickhouse.com/blog/role-based-access-control-clickstack) | Managed 전용 RBAC GA |
| [ClickHouse — What's new in ClickStack, Jan '26](https://clickhouse.com/blog/whats-new-in-clickstack-january-2026) | 로드맵 갱신 |
| [ClickHouse — Introducing Managed ClickStack (2026-02-04)](https://clickhouse.com/blog/introducing-managed-clickstack-beta) | Managed 요금 구조 |
| [ClickHouse Docs — ClickStack API reference](https://clickhouse.com/docs/clickstack/api-reference) | 팀 초대 등 API |
| [ClickHouse Docs (GitHub) — SAML SSO setup](https://github.com/ClickHouse/clickhouse-docs/blob/main/docs/cloud/guides/security/01_cloud_access_management/04_saml-sso-setup.md) | Cloud 조직 SSO |
| [ClickHouse Docs — Manage my account (SSO/MFA)](https://clickhouse.com/docs/cloud/security/manage-my-account) | Cloud 계정 보안 |
| [ClickHouse Docs — Row/Column policy](https://clickhouse.com/docs/knowledgebase/row-column-policy) | 데이터 레벨 격리(row policy) |
| [ClickHouse Pricing](https://clickhouse.com/pricing) | Cloud 요금 |
| [ClickHouse Docs — Parametric aggregate functions](https://clickhouse.com/docs/sql-reference/aggregate-functions/parametric-functions) | windowFunnel/retention/sequenceMatch |
| [ClickHouse — Building product analytics with ClickHouse](https://clickhouse.com/blog/building-product-analytics-with-clickhouse) | 퍼널/리텐션 SQL 자작 가이드 |

## Datadog 공식·SDK

Datadog 공식 문서·제품 페이지·OSS SDK(dd-trace, browser-sdk, datadog-agent) 레포.

| 출처 | 비고 |
|---|---|
| [Datadog Docs — Real User Monitoring](https://docs.datadoghq.com/real_user_monitoring/) | RUM 개요 |
| [Datadog Docs — RUM event hierarchy](https://docs.datadoghq.com/real_user_monitoring/guide/understanding-the-rum-event-hierarchy/) | Session→View→Action/Resource/Error 계층 |
| [Datadog Docs — Browser data collected](https://docs.datadoghq.com/real_user_monitoring/application_monitoring/browser/data_collected/) | RUM 이벤트 속성 전수 |
| [Datadog Docs — Proxy your Browser RUM data](https://docs.datadoghq.com/real_user_monitoring/guide/proxy-rum-data/) | 공식 proxy 옵션 요구사항 |
| [Datadog Docs — Browser SDK setup (client)](https://docs.datadoghq.com/real_user_monitoring/application_monitoring/browser/setup/client/) | browser-sdk 초기화 |
| [Datadog Docs — Frustration Signals](https://docs.datadoghq.com/real_user_monitoring/application_monitoring/browser/frustration_signals/) | rage/dead/error click 임계값 |
| [Datadog — Session Replay 제품 페이지](https://www.datadoghq.com/product/session-replay/) | 제품 소개 |
| [Datadog — Mobile RUM 제품 페이지](https://www.datadoghq.com/product/real-user-monitoring/mobile-rum/) | 모바일 RUM 제품 소개 |
| [Datadog Docs — Product Analytics (RUM 분리)](https://docs.datadoghq.com/product_analytics/guide/rum_and_product_analytics/) | 퍼널/리텐션 별도 제품화 |
| [Datadog Docs — Funnel Analysis](https://docs.datadoghq.com/product_analytics/charts/funnel_analysis/) | 퍼널 기능 상세 |
| [GitHub DataDog/rum-events-format](https://github.com/DataDog/rum-events-format) | RUM 이벤트 JSON 스키마 소스 |
| [GitHub DataDog/browser-sdk](https://github.com/DataDog/browser-sdk) | RUM/logs 브라우저 SDK |
| [browser-sdk Issue #2931](https://github.com/DataDog/browser-sdk/issues/2931) | 프록시 경유 리플레이 로딩 실패 |
| [Datadog Docs — OTel API Support (dd-trace)](https://docs.datadoghq.com/opentelemetry/instrument/dd_sdks/api_support/) | dd-trace의 OTel API 브릿지 |
| [ddtrace (Python) API 문서](https://ddtrace.readthedocs.io/en/stable/api.html) | metrics/logs OTLP 전송 옵션 |
| [dd-trace-py Issue #8259](https://github.com/DataDog/dd-trace-py/issues/8259) | OTel 브릿지가 dd 포맷만 방출 |
| [Datadog Docs — OTLP ingest in the Agent](https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest_in_the_agent/) | Agent의 OTLP 수신 |
| [Datadog Docs — DDOT Collector](https://docs.datadoghq.com/opentelemetry/setup/ddot_collector/) | Agent 내장 OTel Collector |
| [GitHub datadog-agent — pkg/trace/api/api.go](https://github.com/DataDog/datadog-agent/blob/main/pkg/trace/api/api.go) | APM 인테이크 핸들러 |
| [GitHub datadog-agent — pkg/trace/api/endpoints.go](https://github.com/DataDog/datadog-agent/blob/main/pkg/trace/api/endpoints.go) | v0.1~v0.7 엔드포인트 등록 |
| [GitHub datadog-agent — comp/otelcol](https://github.com/DataDog/datadog-agent/tree/main/comp/otelcol) | DDOT 임베드 컴포넌트 |
| [GitHub DataDog/datadog-agent](https://github.com/DataDog/datadog-agent) | Agent 레포 본체 |
| [datadog-agent LICENSE](https://github.com/DataDog/datadog-agent/blob/main/LICENSE) | Apache-2.0(BPF만 GPL-2.0) |
| [dd-trace-js LICENSE](https://github.com/DataDog/dd-trace-js/blob/master/LICENSE) | Apache-2.0/BSD-3 듀얼 |
| [dd-trace-rb LICENSE](https://github.com/DataDog/dd-trace-rb/blob/master/LICENSE) | Apache-2.0/BSD-3 듀얼 |
| [dd-trace-rb Issue #893](https://github.com/DataDog/dd-trace-rb/issues/893) | 듀얼 라이선스 안내 |
| [GitHub datadog/dd-trace-go](https://github.com/datadog/dd-trace-go) | Go APM 라이브러리 |
| [dd-agent (레거시 v5) LICENSE](https://github.com/DataDog/dd-agent/blob/master/LICENSE) | 단순 BSD |
| [GitHub DataDog/agent-payload (protobuf)](https://github.com/DataDog/agent-payload/blob/master/proto/metrics/agent_payload.proto) | AgentPayload wire 스키마 |
| [Datadog Docs — Send traces to Agent by API](https://docs.datadoghq.com/tracing/guide/send_traces_to_agent_by_api/) | 트레이스 인테이크 포맷 안내 |
| [Datadog Docs — APM troubleshooting](https://docs.datadoghq.com/tracing/troubleshooting/) | Agent 리소스 부족 시 drop |
| [Datadog Docs — Custom Metrics Billing](https://docs.datadoghq.com/account_management/billing/custom_metrics/) | custom metric 과금 정의 |
| [Datadog Docs — RUM & Session Replay Billing](https://docs.datadoghq.com/account_management/billing/rum/) | 세션 단가 과금 구조 |
| [Datadog Docs — Pricing (billing)](https://docs.datadoghq.com/account_management/billing/pricing/) | 과금 개요 |
| [Datadog — Data Streams Monitoring 제품 페이지](https://www.datadoghq.com/product/data-streams-monitoring/) | DSM 제품 소개 |
| [Datadog Blog — OTel/AI Observability Pipelines to ClickHouse](https://www.datadoghq.com/blog/otel-ai-observability-pipelines-clickhouse/) | native ClickHouse destination 발표 |
| [Datadog — Observability Pipelines 제품 페이지](https://www.datadoghq.com/product/observability-pipelines/) | OP 제품 소개 |
| [Datadog Docs — Import Datadog resources into Terraform](https://docs.datadoghq.com/containers/guide/how-to-import-datadog-resources-into-terraform/) | 자산 export/IaC 경로 |
| [Terraform Registry — datadog_dashboard_json](https://registry.terraform.io/providers/DataDog/datadog/latest/docs/resources/dashboard_json) | 대시보드 JSON IaC 리소스 |
| [Datadog Docs — Dashboards Querying](https://docs.datadoghq.com/dashboards/querying/) | Datadog 고유 쿼리 문법 |
| [Datadog Docs — Dashboard Functions](https://docs.datadoghq.com/dashboards/functions/) | 함수 목록 |
| [Datadog Docs — Functions: Algorithms](https://docs.datadoghq.com/dashboards/functions/algorithms/) | anomalies/forecast/outliers |
| [Datadog Docs — Functions: Rollup](https://docs.datadoghq.com/dashboards/functions/rollup/) | rollup 보간 동작 |
| [Datadog Docs — OTel Metrics Mapping](https://docs.datadoghq.com/opentelemetry/mapping/metrics_mapping/) | dd↔OTel 메트릭 매핑 |
| [Datadog Docs — OTel Semantic Conventions Mapping](https://docs.datadoghq.com/opentelemetry/mapping/semantic_mapping/) | semconv 매핑 |
| [Datadog Docs — Service Level Objectives](https://docs.datadoghq.com/service_level_objectives/) | SLO 정의 방식 |
| [Datadog Docs — SLO Burn Rate Alerts](https://docs.datadoghq.com/service_management/service_level_objectives/burn_rate/) | multi-window burn-rate |
| [Datadog Docs — Access Control (RBAC)](https://docs.datadoghq.com/account_management/rbac/) | Datadog 자체 RBAC(이전 대상 기준선) |
| [Datadog Docs — Data Access Control](https://docs.datadoghq.com/account_management/rbac/data_access/) | 데이터 접근통제 |
| [Datadog Pricing 페이지](https://www.datadoghq.com/pricing/) | 전체 요금 개요 |
| [Datadog Docs — Embrace Mobile 통합](https://docs.datadoghq.com/integrations/embrace-mobile/) | Embrace 연동 |

## OTel·Vector

OpenTelemetry Collector(Contrib)·Vector·표준 semconv 및 그 확장 배포판.

| 출처 | 비고 |
|---|---|
| [OTel Collector Contrib — datadogreceiver README](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/receiver/datadogreceiver/README.md) | dd Agent intake 수신 리시버 |
| [datadogreceiver — receiver.go](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/receiver/datadogreceiver/receiver.go) | 구현 코드 |
| [datadogreceiver 소스 트리](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/datadogreceiver) | translator 서브패키지 |
| [datadogreceiver metadata.yaml](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/receiver/datadogreceiver/metadata.yaml) | 성숙도 alpha, 메인테이너 2명 |
| [datadogreceiver v0.147.0 태그](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/v0.147.0/receiver/datadogreceiver) | 참조 버전 |
| [Issue #23150 — span.Resource 드롭 버그](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/23150) | db.statement 유실 회귀 |
| [Issue #44907 — delta metric 30~70% 손실](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/44907) | temporality 변환 취약성 |
| [Issue #36079 — series API 비호환](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/36079) | 일부 dd client 라이브러리 호환 문제 |
| [clickhouseexporter README](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/clickhouseexporter/README.md) | traces/logs=beta, metrics=alpha |
| [Vector Docs — datadog_agent source](https://vector.dev/docs/reference/configuration/sources/datadog_agent/) | dd Agent 트래픽 HTTP 수신 |
| [Vector Issue #16121 — datadog_agent 확장 안 함 결정](https://github.com/vectordotdev/vector/issues/16121) | 메인테이너가 2023-04 Agent 포맷 이상 미확장 결정, 네이티브 opentelemetry 소스 권장 |
| [Vector Docs — clickhouse sink](https://vector.dev/docs/reference/configuration/sinks/clickhouse/) | 로그 전용(traces/metrics 미지원) |
| [Vector Docs — datadog_traces sink](https://vector.dev/docs/reference/configuration/sinks/datadog_traces/) | 트레이스 관련 제약 |
| [Vector Docs — Going to production (아키텍처)](https://vector.dev/docs/setup/going-to-prod/architecting/) | 프로덕션 토폴로지 |
| [OTel Semantic Conventions — Session](https://opentelemetry.io/docs/specs/semconv/general/session/) | 세션 semconv(Development) |
| [OTel Semantic Conventions — Browser events](https://opentelemetry.io/docs/specs/semconv/browser/browser-events/) | 브라우저 이벤트 semconv |
| [OpenTelemetry Android](https://opentelemetry.io/docs/platforms/client-apps/android/) | Android SDK v1.4.0 |
| [OTel Blog — Android: Road to Stable (2025)](https://opentelemetry.io/blog/2025/android-road-to-stable/) | 안정화 로드맵 |
| [OpenTelemetry Swift](https://opentelemetry.io/docs/languages/swift/) | iOS/Swift SDK |
| [OTel Swift instrumentation libraries](https://opentelemetry.io/docs/languages/swift/libraries/) | URLSession 계측 등 |
| [OTel client-side apps 개요](https://opentelemetry.io/docs/platforms/client-apps/) | 모바일 리플레이 표준 부재 |
| [GitHub signalfx/splunk-otel-js-web](https://github.com/signalfx/splunk-otel-js-web) | `@hyperdx/otel-web` 추정 계보 |
| [splunk-otel-js-web — session-recorder README](https://github.com/signalfx/splunk-otel-js-web/blob/main/packages/session-recorder/README.md) | rrweb 레코더 원형 |
| [VictoriaMetrics Docs — Datadog 통합](https://docs.victoriametrics.com/victoriametrics/integrations/datadog/) | dd agent 네이티브 수신·dual-ship |
| [GitHub OpenSLO/OpenSLO](https://github.com/OpenSLO/OpenSLO) | 벤더 중립 SLO 스펙 |
| [GitHub observiq/bindplane-otel-collector](https://github.com/observiq/bindplane-otel-collector) | 상용 OTel 배포판(dd 연동) |

## 커뮤니티·사례

HN·벤더 비교 블로그·이관 사례·서드파티 도구·이슈 트래커.

| 출처 | 비고 |
|---|---|
| [Y Combinator — HyperDX (S22)](https://www.ycombinator.com/companies/hyperdx) | 창업 배치 정보 |
| [Crunchbase — ClickHouse의 HyperDX 인수](https://www.crunchbase.com/acquisition/clickhouse-acquires-hyperdx--b06e010e) | 인수 딜 요약 |
| [CB Insights — DeploySentinel/HyperDX](https://www.cbinsights.com/company/deploysentinel) | 창업 전신 회사 정보 |
| [theorg — Warren Lee 조직도](https://theorg.com/org/clickhouse/org-chart/warren-jonhow-lee) | 공동창업자 프로필 |
| [Dotan Horovits (Medium) — ClickStack Unveiled](https://horovits.medium.com/clickstack-clickhouses-new-observability-stack-unveiled-73f129a179a3) | 3자 분석 |
| [HN — Show HN: ClickStack](https://news.ycombinator.com/item?id=44128307) | SigNoz 대비 차별점 논쟁 |
| [HN — HyperDX in production 후기](https://news.ycombinator.com/item?id=44194775) | 실사용 긍정 평가 |
| [HN — HyperDX vs ClickStack 혼란](https://news.ycombinator.com/item?id=44196718) | 네이밍 혼란 스레드 |
| [HN — HyperDX(ClickStack) vs SigNoz 논쟁](https://news.ycombinator.com/item?id=45294103) | 커플링 비교 |
| [HN — ClickHouse acquires HyperDX](https://news.ycombinator.com/item?id=43266227) | 인수 발표 반응 |
| [HN — Datadog 탈출/자체구축 스레드](https://news.ycombinator.com/item?id=47082107) | 프록시 미언급, 재계측 선택이 대세 |
| [HN — Show HN: ClickStack (별도 스레드)](https://news.ycombinator.com/item?id=44194082) | OTLP 네이티브 인제스트 논의 |
| [CubeAPM — HyperDX Pricing & Review 2026](https://cubeapm.com/blog/hyperdx-pricing-review/) | 요금제 리뷰 |
| [Better Stack vs HyperDX (2026)](https://betterstack.com/community/comparisons/better-stack-vs-hyperdx/) | RUM 기능 비교(product analytics lighter) |
| [Tasrie — ClickStack vs Prometheus (2026)](https://tasrieit.com/blog/clickstack-vs-prometheus-observability-comparison-2026) | PromQL 미지원 비교 |
| [Tasrie — What Is ClickStack (2026)](https://tasrieit.com/blog/what-is-clickstack-clickhouse-observability-explained-2026) | 제품 개요 3자 설명 |
| [OneUptime — Datadog Receiver in OTel Collector](https://oneuptime.com/blog/post/2026-02-06-datadog-receiver-opentelemetry-collector/view) | 설정 가이드(성능 수치 없음) |
| [Altinity Kubernetes Operator](https://altinity.com/kubernetes-operator/) | Altinity operator 소개 |
| [FerretDB — HyperDX와 함께하는 풀스택 관측성](https://blog.ferretdb.io/full-stack-observability-hyperdx-ferretdb/) | MongoDB 대체 비공식 사례 |
| [DeepWiki — hyperdxio/hyperdx-js](https://deepwiki.com/hyperdxio/hyperdx-js) | AI 생성 3자 위키 |
| [SigNoz — Open-Source Datadog Alternative (2026)](https://signoz.io/blog/open-source-datadog-alternative/) | 경쟁 제품 비교 |
| [johal.in — Datadog→SigNoz 70% 절감 후기](https://johal.in/we-ditched-datadog-signoz-10-2026-70-lower/) | 저신뢰/AI 생성 의심 |
| [OneUptime — Replace Datadog APM with OTel SDKs (Python)](https://oneuptime.com/blog/post/2026-02-06-replace-datadog-apm-opentelemetry-python/view) | 재계측 가이드 |
| [OneUptime — How Datadog Pricing Actually Works](https://oneuptime.com/blog/post/2026-03-13-how-datadog-pricing-actually-works/view) | host high-water mark 등 과금 함정 |
| [OneUptime — Datadog Bill Shock (2026)](https://oneuptime.com/blog/post/2026-03-17-datadog-bill-shock-real-cost-observability-2026/view) | 청구서 급증 사례 |
| [Parseable — Datadog Log Management Cost](https://www.parseable.com/blog/datadog-log-management-cost) | 로그 비용 비교(97% 절감 주장) |
| [OpenObserve — Datadog Pricing Explained](https://openobserve.ai/blog/datadog-pricing/) | 과금 구조 해설 |
| [OpenObserve — Best Open Source Datadog Alternative (2026)](https://openobserve.ai/blog/opensource-datadog-alternative/) | Evereve 전환 사례 포함 |
| [OpenObserve — Datadog Alternative for RUM](https://openobserve.ai/blog/datadog-vs-openobserve-rum/) | RUM 대체 비교 |
| [SigNoz 공식 홈](https://signoz.io/) | 경쟁 OSS 제품 |
| [SigNoz — Sentry Alternatives (2026)](https://signoz.io/comparisons/sentry-alternatives/) | 에러 트래킹 비교 |
| [GitHub SigNoz/signoz](https://github.com/SigNoz/signoz) | 경쟁 OSS 소스 |
| [Pragmatic Engineer — Datadog $65M/year 고객 미스터리](https://blog.pragmaticengineer.com/datadog-65m-year-customer-mystery/) | Coinbase 사례 |
| [Coralogix — Curve 마이그레이션 사례](https://coralogix.com/case-studies/curve/) | 이관 비용 절감 사례 |
| [GitHub coroot/coroot](https://github.com/coroot/coroot) | eBPF 무계측 관측성 |
| [Coroot — Real-Time Observability with ClickHouse](https://coroot.com/blog/real-time-observability-with-clickhouse-coroot-and-glassflow/) | CH 백엔드 활용 |
| [Metoro — Top 8 eBPF Observability Tools (2026)](https://metoro.io/blog/top-ebpf-observability-tools) | eBPF 도구 목록 |
| [Grafana — Pyroscope 2.0 release](https://grafana.com/blog/pyroscope-2-0-release/) | 프로파일러 재설계 |
| [InfoQ — Pyroscope 2.0 (2026-05)](https://www.infoq.com/news/2026/05/pyroscope-2-profiling/) | 3자 보도 |
| [Grafana Docs — OTel eBPF profiler](https://grafana.com/docs/pyroscope/latest/configure-client/opentelemetry/ebpf-profiler/) | 무계측 프로파일링 |
| [GitHub grafana/pyroscope](https://github.com/grafana/pyroscope) | 프로파일러 소스 |
| [SystemsHardening — Grafana Faro RUM](https://www.systemshardening.com/articles/observability/frontend-rum-security-grafana-faro/) | Faro RUM 대안 소개 |
| [BetterStack — Best Session Replay Tools (2026)](https://betterstack.com/community/comparisons/session-replay-alternatives/) | 리플레이 대안 비교 |
| [CubeAPM — Datadog RUM Alternatives](https://cubeapm.com/faqs/datadog-rum-alternatives/) | RUM 대안 FAQ |
| [Checkly — Datadog alternative](https://www.checklyhq.com/datadog-alternative/) | Synthetics 대안 |
| [CubeAPM — Best Synthetic Monitoring Tools (2026)](https://cubeapm.com/faqs/best-synthetic-monitoring-tools/) | Synthetics 비용 비교 |
| [Gartner Peer Insights — Datadog Cloud SIEM vs Wazuh](https://www.gartner.com/reviews/market/security-information-event-management/compare/product/datadog-cloud-siem-vs-wazuh-the-open-source-security-platform) | SIEM 비교 |
| [Last9 — Top Open Source SIEM Tools](https://last9.io/blog/open-source-siem-tools/) | SIEM 대안 목록 |
| [incident.io — Best Open Source PagerDuty Alternatives (2026)](https://incident.io/blog/best-open-source-pagerduty-alternatives-2026) | Grafana OnCall 아카이브 명시 |
| [Runframe — Grafana OnCall Alternatives](https://runframe.io/comparisons/grafana-oncall-alternatives) | OnCall 대안 |
| [PostHog — Best open source LLM observability tools](https://posthog.com/blog/best-open-source-llm-observability-tools) | LLM 옵저버빌리티 대안 |
| [Braintrust — Datadog LLM Observability alternatives (2026)](https://www.braintrust.dev/articles/datadog-llm-observability-alternatives-2026) | LLM 옵저버빌리티 대안 |
| [DevToolPicks — Sentry vs Honeybadger vs GlitchTip (2026)](https://devtoolpicks.com/blog/sentry-vs-honeybadger-vs-glitchtip-indie-hackers-2026) | 에러 트래킹 비교 |
| [Kentik — Datadog Alternatives (Network Intelligence)](https://www.kentik.com/kentipedia/datadog-alternatives-network-intelligence/) | NPM/NDM 대안 |
| [Factor House — Best Kafka monitoring tools (2026)](https://factorhouse.io/articles/best-kafka-monitoring-tools/) | Data Streams 대안 |
| [Last9 — Top 13 Kafka Monitoring Tools](https://last9.io/blog/kafka-monitoring-tools/) | Data Streams 대안 |
| [Uptrace — Top 13 Datadog Alternatives (2026)](https://uptrace.dev/comparisons/datadog-alternatives) | 종합 대안 목록 |
| [Discover Technology — Datadog migration case study](https://technology.discover.com/posts/datadog-migration) | 기업 이관 사례 |
| [OpenObserve — RUM Frustration Signals (2026-04-03)](https://openobserve.ai/blog/rum-frustration-signals/) | 좌절 신호 SDK 구현 사례 |
| [Sentry Blog — Rage & dead click detection](https://blog.sentry.io/introducing-rage-and-dead-click-detection-for-session-replay/) | rrweb 위 좌절 신호 탐지 |
| [GitHub getsentry/sentry Issue #60826](https://github.com/getsentry/sentry/issues/60826) | rage click epic |
| [rrweb 공식 사이트](https://rrweb.com/) | 세션 리플레이 오픈소스 라이브러리 |
| [Embrace — OpenTelemetry for mobile](https://embrace.io/opentelemetry-for-mobile/) | 모바일 OTel 지원 |
| [Embrace Blog — Embrace brings OTel to mobile](https://embrace.io/blog/embrace-opentelemetry-mobile-observability/) | OTel 채택 배경 |
| [Embrace — 제품 개요](https://embrace.io/product/) | 모바일 세션 리플레이 포함 |
| [OneUptime — OTel for Flutter (2026-02)](https://oneuptime.com/blog/post/2026-02-06-opentelemetry-flutter-cross-platform-applications/view) | Flutter OTel 계측 가이드 |
| [base14 Docs — Flutter mobile instrumentation](https://docs.base14.io/instrument/mobile/flutter/) | 커뮤니티 계측 예시 |
| [OpenReplay — Mobile session replay](https://openreplay.com/product/feature/mobile/) | iOS/Android/RN 리플레이(퍼널 미지원) |
| [GitHub openreplay/openreplay](https://github.com/openreplay/openreplay) | 완전 OSS self-host, ClickHouse 백엔드 |
| [OneUptime — ClickHouse funnel & cohort analysis (2026-01-21)](https://oneuptime.com/blog/post/2026-01-21-clickhouse-funnel-cohort-analysis/view) | windowFunnel/retention 실전 예시 |
| [OneUptime — sequenceMatch/sequenceCount (2026-03-31)](https://oneuptime.com/blog/post/2026-03-31-clickhouse-sequencematch-sequencecount-functions/view) | 경로 분석 SQL 예시 |
| [Better Stack — PostHog alternatives](https://betterstack.com/community/comparisons/posthog-alternatives/) | PostHog 운영 부담 언급 |
| [PostHog Docs — Mobile session replay](https://posthog.com/docs/session-replay/mobile) | 모바일 리플레이 지원 |
| [Mixpanel — PostHog alternatives](https://mixpanel.com/blog/posthog-alternatives/) | 비용 비교(2차) |
| [Cribl Docs — Datadog Agent Source](https://docs.cribl.io/stream/sources-datadog-agent/) | 상용 dd 수신 파이프라인 |
| [Nand Research — Dynatrace의 Bindplane 인수](https://nand-research.com/dynatrace-extends-observability-platform-with-bindplane-acquisition/) | Bindplane 배경 |
| [Last9 — Datadog Pricing 완전 정리](https://last9.io/blog/datadog-pricing-all-your-questions-answered/) | 과금 체계 해설 |
| [GitHub amnk/dd2tf](https://github.com/amnk/dd2tf) | dashboard/monitor→Terraform(유지보수 정체) |
| [GitHub laurmurclar/datadog-to-terraform](https://github.com/laurmurclar/datadog-to-terraform) | JSON→Terraform 변환 |
| [GitHub juliogreff/datadog-to-terraform](https://github.com/juliogreff/datadog-to-terraform) | JSON→Terraform 변환 |
| [Chronosphere — Datadog 쿼리/대시보드/알림을 OSS 표준으로 변환](https://chronosphere.io/learn/converting-datadog-queries-dashboards-and-alerts-to-open-source-standards/) | AST 기반 PromQL 변환기(~90%) |
| [groundcover — Escaping Datadog (2025-11)](https://www.groundcover.com/blog/escaping-datadog-how-we-built-an-automated-observability-migration-tool) | 자동 마이그레이션 도구 |
| [GitHub ncandio/graang](https://github.com/ncandio/graang) | 대시보드 구조 변환기(~87%) |
| [Grafana Community — Datadog→Grafana 대시보드 이관 방법](https://community.grafana.com/t/is-there-a-easy-way-to-migrate-datadog-dashboards-to-grafana/156751) | 공식 변환기 discontinued |
| [Grafana — Datadog datasource plugin](https://grafana.com/grafana/plugins/grafana-datadog-datasource/) | 병행조회용 플러그인(Enterprise) |
| [Grafana Blog — From Datadog to Grafana Cloud](https://grafana.com/blog/from-datadog-to-grafana-cloud-why-companies-migrate-and-how-it-changes-business-for-the-better/) | LexisNexis 등 이관 사례 |
| [Grafana — Blockchain 기업 Datadog→Grafana Cloud 성공사례](https://grafana.com/success/blockchain-from-datadog-to-grafana-cloud/) | 이관 기간 사례 |
| [Medium (BerniCoder) — From Datadog to Grafana: Our journey](https://medium.com/@bernatferrerm/from-datadog-to-grafana-our-journey-3137a00afcdb) | 쿼리 의미론 변환 실경험 |
| [drdroid — Datadog to Grafana 마이그레이션 플레이북](https://drdroid.io/engineering-tools/the-complete-datadog-to-grafana-migration-playbook-from-planning-to-production) | 공수 추정(4~6주) |
| [SigNoz — Datadog vs Prometheus (2026)](https://signoz.io/blog/datadog-vs-prometheus/) | 쿼리 언어 비교 |
| [SigNoz — LLM 기반 Datadog Migration Tool (2025-11-25)](https://signoz.io/blog/datadog-migration-tool/) | ClickHouse 계열 유일 LLM 변환 도구 |
| [Grafana Docs — Alert grouping](https://grafana.com/docs/grafana-cloud/alerting-and-irm/irm/escalation-and-routing/alert-grouping/) | notification policy grouping |
| [Grafana Blog — Mute timing vs silences (2025-09-24)](https://grafana.com/blog/2025/09/24/mute-timing-vs-silences-in-grafana-alerting-how-to-pick-the-best-fit-for-your-use-case/) | Datadog downtime 대응 기능 |
| [GitHub slok/sloth](https://github.com/slok/sloth) | Prometheus SLO 생성기 |
| [Sloth — Architecture 문서](https://sloth.dev/introduction/architecture/) | multiwindow-multiburn 구조 |
| [GitHub pyrra-dev/pyrra](https://github.com/pyrra-dev/pyrra) | SLO 관리 Web UI |
| [Nobl9 — Datadog 통합](https://www.nobl9.com/integrations/datadog) | dd 쿼리 그대로 SLI화 |
| [GitHub perses/perses](https://github.com/perses/perses) | CNCF dashboards-as-code |
| [WebProNews — AI 스타트업의 48시간 Datadog→Grafana 탈출](https://www.webpronews.com/ai-startup-flees-datadog-lock-in-via-48-hour-ai-powered-grafana-shift/) | 극단적 아웃라이어 사례 |
| [TipRanks — ClickHouse의 Managed ClickStack RBAC 보도](https://www.tipranks.com/news/private-companies/clickhouse-enhances-managed-clickstack-with-role-based-access-control) | 3자 보도 |
| [LinkedIn — ClickHouse RBAC 공지 게시물](https://www.linkedin.com/posts/clickhouseinc_announcing-role-based-access-control-in-clickstack-activity-7445107887204581376-H552) | 공지 홍보 게시물 |
| [Grafana Docs — Roles and permissions (OSS)](https://grafana.com/docs/grafana/latest/administration/roles-and-permissions/) | Grafana OSS 기본 역할(비교 기준) |
| [Grafana Docs — RBAC (Enterprise/Cloud)](https://grafana.com/docs/grafana/latest/administration/roles-and-permissions/access-control/) | Grafana 유료 RBAC |
| [Dominik Weber — Self-hosting HyperDX 실사용기](https://weberdominik.com/blog/self-host-hyperdx) | MongoDB 무인증 노출·데이터 삭제 사례 |
| [OneUptime — ClickHouse users & access control](https://oneuptime.com/blog/post/2026-01-21-clickhouse-users-access-control/view) | CH RBAC 해설 |
| [OneUptime — K8s 네임스페이스 텔레메트리 격리](https://oneuptime.com/blog/post/2026-02-06-namespace-telemetry-isolation-k8s/view) | 멀티테넌시 일반론 |
| [OpsLyft — Datadog Pricing 분석](https://www.opslyft.com/blog/datadog-pricing) | 과금 분석(2차) |
| [GitHub oauth2-proxy/oauth2-proxy](https://github.com/oauth2-proxy/oauth2-proxy) | 경계 SSO 게이트 도구 |

---

이 목록은 조사 문서 8종(01-hyperdx-deep-dive, 02-rum-replacement, 03-datadog-replacement-matrix, 08-supplement-1, 08-supplement-2, 08-supplement-4, 08-supplement-5, 그리고 맥락 참조한 07-recommendation)의 "## 출처" 섹션을 합친 것이며, 07-recommendation 자체는 근거 문서 색인만 갖고 있어 별도 URL 목록이 없다. 근거 등급([확인됨]/[추정]/[미확인])은 각 URL이 인용된 원 조사 문서를 따라야 하며, 이 페이지는 등급을 승계하지 않는다(단순 링크 색인).
