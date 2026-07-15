---
title: "HyperDX / ClickStack 심층 분석"
weight: 1
---

# HyperDX / ClickStack 심층 분석 — RUM/플랫폼 도입 실사

HyperDX/ClickStack을 **"Datadog RUM 대체 + 통합 관측성 플랫폼" 후보로 도입할 때**의 실사(due-diligence) 페이지다. "로그 스토어 선택지로서의 요약 판단"은 로깅 챕터의 [HyperDX / ClickStack]({{< relref "../logging/05-hyperdx-clickstack.md" >}})가 이미 다루므로 강점·약점 재나열은 하지 않고, 여기서는 **도입 결정에 필요한 팩트** — 연혁·아키텍처·배포 모드·기능 성숙도·라이선스·거버넌스 갭 — 을 플랫폼 실사 관점으로 심화한다.

한 줄 결론: **웹 RUM 대체 후보로는 현실적으로 유일하지만, OSS의 접근통제 공백(SSO/RBAC/멀티테넌시/감사로그 전무)이 다중 팀 도입의 결정적 게이트다.**

## 연혁 — DeploySentinel에서 ClickStack까지

리브랜드가 아니라 **번들 재구성**이라는 점이 실사에서 중요하다. HN에서 "HyperDX가 어디서 끝나고 ClickStack이 어디서 시작되는지" 혼란이 반복됐는데, 팀의 공식 정의는 `ClickStack = { HyperDX(UI/API), ClickHouse, OTel Collector }`다. HyperDX는 폐기된 게 아니라 ClickStack의 프론트엔드 컴포넌트로 편입됐다.

| 시점 | 사건 |
|---|---|
| 2022 | **DeploySentinel, Inc.** 설립(YC S22). CI/배포 모니터링 → 프로덕션 디버깅 관측성 **HyperDX**로 피벗·리브랜딩 `[확인됨]` |
| 2024 말 | HyperDX **v2 UI 오픈소스화** — 세션 리플레이·OTel 메트릭·알림·저장 검색·대시보드 추가 `[확인됨]` |
| 2025-03-13 | **ClickHouse Inc. 인수**(금액 비공개). HyperDX Cloud 계속 운영 + OSS 계속 개발 명시 `[확인됨]` |
| 2025-05-29 | **ClickStack 출시** — 3컴포넌트 번들 재구성(리브랜드 아님) `[확인됨]` |
| 2025-08-06 | ClickHouse Cloud 내 ClickStack **Private Preview**(원클릭, 통합 인증) `[확인됨]` |
| 2025-12 | Materialized Views 완전 통합(쿼리 가속) `[확인됨]` |
| 2026-04-01 | **RBAC GA — 단, Managed(ClickHouse Cloud) 전용** `[확인됨]` |

> 실사 주의: "Anthropic·character.AI가 ClickStack 프로덕션 레퍼런스"라는 프레이밍은 1차 출처로 뒷받침되지 않는다. 두 팀은 고볼륨·고카디널리티 UI 동작에 **피드백/입력을 제공**한 것이고, ClickHouse 공식 블로그상 Anthropic은 HyperDX UI가 아니라 **자체 air-gapped ClickHouse 관측성 스택**(k8s + ClickHouse Operator + Prometheus + Vector)을 운영한다 `[확인됨]`. 패키지드 ClickStack 자체의 대규모 named 프로덕션 사례는 제품이 ~1년 되어 아직 얇다 `[추정]`.

## 아키텍처 — 3 코어 + 1 필수 메타스토어

3개 코어 컴포넌트에 **메타데이터 저장용 MongoDB가 필수 의존성**으로 붙는 것이 이 스택의 운영 표면을 규정한다. 관측성 데이터는 전부 ClickHouse에 들어가지만, 대시보드·저장검색·사용자·알림 같은 **앱 상태는 MongoDB에** 남는다 — 이 이원화가 BYO 모드에서도 사라지지 않는다. MongoDB의 역할·부하 프로파일(관측 데이터 적재량이 아니라 사용자·설정 수에 비례)·배포 경로별 운영 형태는 [HyperDX의 MongoDB]({{< relref "07-hyperdx-mongodb.md" >}})에서 심화한다.

| 컴포넌트 | 역할 | 라이선스 |
|---|---|---|
| **ClickHouse** | 모든 텔레메트리(로그/트레이스/메트릭/세션)의 단일 저장·쿼리 원천 | Apache 2.0 |
| **HyperDX** | 탐색/시각화 프론트엔드(Next.js) + API 백엔드(Node.js) | **MIT** |
| **OpenTelemetry Collector** | 인제스천 게이트웨이(OTLP 수신 → ClickHouse export), 스키마 강제 | Apache 2.0 |
| **MongoDB** | **앱 상태 저장(필수)** — 대시보드·저장검색·사용자·알림 정의 | 외부 의존성 |

- 인제스천은 **OTLP**(4317 gRPC / 4318 HTTP), 컬렉터 동적 구성은 **OpAMP**로 표준 프로토콜을 쓴다 `[확인됨]`. 커스텀 컬렉터 config는 `CUSTOM_OTELCOL_CONFIG_FILE`로 **베이스 config에 병합**되며 기존 컴포넌트 오버라이드는 불가(신규 receiver/processor만 추가) `[확인됨]`.
- MongoDB를 FerretDB(Postgres 기반 호환)로 대체한 커뮤니티 사례가 있으나 **공식 지원 아님** `[추정]`.

### 신호별 테이블 스키마 — RUM 상관의 근거

ClickStack은 신호별 최적화 스키마를 자동 생성한다(codecs·TTL·secondary index 포함). 기본 속성 저장 타입은 `Map(LowCardinality(String), String)`이고 native JSON은 beta로 기본값 아님 `[확인됨]`. **RUM 실사에서 핵심은 세션↔트레이스 상관이 스키마에 하드코딩돼 있다는 점**이다.

| 테이블 | 용도 | RUM 관점 포인트 |
|---|---|---|
| `otel_logs` | 로그/이벤트 | `TraceId` text index, 속성 bloom filter, `Body` 토큰 검색 |
| `otel_traces` | 분산 트레이스 | **`rum.sessionId`를 컬럼으로 materialize + bloom filter** → 세션↔트레이스 조인 근거. `TraceId` bloom(0.001 FP), `Duration` minmax |
| `otel_metrics_*` | 메트릭(gauge/sum/histogram/exp-hist/summary 타입별 분리) | Exemplar 배열 포함하나 쿼리 계층에 PromQL 없음(아래) |
| `hyperdx_sessions` | 세션 리플레이(rrweb) | `otel_logs` 스키마를 미러링하되 독립 DDL·TTL을 갖는 전용 테이블 — `Body`=이벤트 페이로드, `LogAttributes`=메타데이터 맵, 기본 TTL **7일**(로그 테이블 14일과 별도), bloom_filter 인덱스 `[확인됨, ClickHouse 공식 문서]` |

쿼리 계층은 **Lucene 스타일 검색**(`level:err`)과 **네이티브 ClickHouse SQL**을 함께 제공하고, `timestamp` 컬럼만 있으면 임의 스키마도 검색·상관·시각화된다(schema-agnostic) `[확인됨]`. 이 유연성이 BYO ClickHouse 모드를 가능케 하는 근거다.

## 배포 6모드 — 프로덕션 적합성 매트릭스

공식 문서가 6가지 옵션과 프로덕션 적합성을 명시한다 `[확인됨]`. 실사 관점의 결론: **프로덕션은 Managed 또는 Helm 둘 중 하나**이고, 자체 인프라 전략을 지키려면 **HyperDX Only(BYO ClickHouse)** 가 사실상의 정답 축이다.

| 모드 | 권장 용도 | 프로덕션 | 실사 비고 |
|---|---|:---:|---|
| **Managed ClickStack**(ClickHouse Cloud) | 프로덕션/데모/PoC | ✅ | Cloud 호스팅·통합 인증(2025-08-06 Private Preview로 출시 `[확인됨]`). **RBAC/SSO는 여기에만** 있음 |
| **All-in-One**(단일 Docker) | 데모/PoC | ❌ | CH+HyperDX+OTel+MongoDB 올인원. HA 없음 |
| **Helm (Kubernetes)** | **프로덕션 on k8s** | ✅ | 아래 operator 주의 참조 |
| **Docker Compose** | 로컬/PoC/단일 서버 | △ | fault tolerance 없음 |
| **HyperDX Only (BYO ClickHouse)** | 기존 CH 사용자·커스텀 파이프라인 | △ | CH 미포함, **MongoDB 필수·인제스천 자기 책임** |
| **Local Mode Only** | 데모/디버깅 | ❌ | 인증·영속성·알림 없음, 단일 사용자 |

**Helm 경로의 operator 함정**: 활성 개발이 `ClickHouse/ClickStack-helm-charts`로 이관됐고, K8s 설치는 **2개 차트**(`clickstack-operators` 먼저 → `clickstack` 순서)로 나뉜다 `[확인됨 3-0]`. 첫 차트가 **ClickHouse Inc.의 신규 공식 operator**(`ClickHouseCluster`/`KeeperCluster` CRD)와 MongoDB Community Operator(`MongoDBCommunity` CRD)를 설치해 ClickHouse·MongoDB를 모두 CRD로 관리한다 — plain StatefulSet이 아니다 `[확인됨]`. 즉 Altinity operator(`ClickHouseInstallation`/CHI)가 아니다 `[확인됨]`. 범용 분석 CH를 Altinity로 운영한다면 한 클러스터에 **operator 2종이 공존**하게 되므로, 표준 Helm 경로를 그대로 따를지 vs 별도 operator 위에 CH를 세우고 HyperDX Only로 붙일지가 결정 사항이다. 상세는 [ClickHouse operator]({{< relref "../clickhouse/03-operator.md" >}}) 참조.

### BYO ClickHouse("HyperDX Only") — 조건 정리

자체 인프라(EKS + 자체 ClickHouse)를 지키면서 HyperDX UI만 얹는 유일한 경로다. 다만 "가볍다"고 오해하면 안 된다.

- **MongoDB는 여전히 필수** — 대시보드·저장검색·사용자·알림을 저장한다. CH만 자체 운영한다고 메타스토어가 사라지지 않는다 `[확인됨]`.
- **인제스천은 전적으로 사용자 책임** — 자체 OTel Collector, 클라이언트 직접 인입, ClickHouse Kafka/S3 테이블 엔진, ETL, ClickPipes 중 선택 `[확인됨]`.
- **임의 스키마 허용**(`timestamp`만 있으면) → 범용 분석용 ClickHouse에 관측성을 겸용하려는 니즈와 정합적 `[확인됨]`.
- 기동은 `docker run -e MONGO_URI=... docker.hyperdx.io/hyperdx/hyperdx` 후 UI(8080)에서 외부 CH data source 등록 `[확인됨]`.
- **프로덕션 노브**: 기본 데이터 TTL은 **3일**(`TABLES_TTL=72h`)로 짧아 프로덕션에서는 대개 변경이 필요하다. ClickHouse 사이징 가이드는 인제스트 워크로드 **10 MB/s당 1 vCPU**, 쿼리 워크로드 **1 QPS당 + 10 MB/s당 1 vCPU**를 권장한다(예: 100 MB/s 인제스트+쿼리 → 약 40 vCPU) `[벤더]`.

## 기능 성숙도 매트릭스

범례: 🟢 성숙/핵심강점 · 🟡 사용 가능/개선중 · 🟠 초기/beta · 🔴 미지원/로드맵

| 기능 | 성숙도 | 실사 노트 |
|---|:---:|---|
| **로그 검색(Lucene/SQL)** | 🟢 | 라이브 테일, JSON 자동 파싱, 고카디널리티 SQL 집계 강점 `[확인됨]` |
| **분산 트레이스(APM)** | 🟢 | HTTP→DB 쿼리 스팬, `rum.sessionId` 상관. 코드레벨 continuous profiler는 없음 `[확인됨]` |
| **세션 리플레이 / 웹 RUM** | 🟢(디버깅) | `@hyperdx/browser`가 rrweb 리플레이 + 에러 + Web Vitals + 네트워크 캡처. replay→trace→log 조인은 대부분 OSS 경쟁자가 못 따라오는 시그니처 강점 `[확인됨]` |
| **모바일 RUM** | 🔴 | 네이티브 iOS/Android/Flutter 리플레이 없음. RN 포크는 트레이스·에러·네트워크만 `[확인됨]` |
| **대시보드** | 🟢 | import/export·필터. 단 템플릿 변수 없음, 프리셋 라이브러리 작음 `[확인됨]` |
| **알림(Alerting)** | 🟡 | Search/Chart 알림(단일 임계값)+`GROUP BY`별 발화·SQL 기반 이상탐지(2026-05). 단 Alertmanager식 grouping/silencing·alert history·IaC는 미성숙. OSS는 Slack/Generic Webhook 위주(Slack API·PagerDuty OAuth는 Cloud 전용) `[확인됨]`(2025-11 OSS 패리티·2026-05 SQL 이상탐지 반영 시점 기준 — [dd 대체 매트릭스]({{< relref "04-datadog-replacement-matrix.md" >}}) 알림 서술과 동일 스냅샷) |
| **메트릭** | 🟡 | OTel 메트릭 저장·차트는 되나 **PromQL 미지원**(SQL/Lucene only), PromQL 개선은 2026 로드맵. 신호 중 가장 약함 `[확인됨]` |
| **Service Maps / Event Deltas** | 🟠 | Service Maps beta(2025-11), Event Deltas 구성 가능(2025-10) `[확인됨]` |
| **AI 노트북 / 자연어 쿼리** | 🟠 | private preview·로드맵 `[확인됨]` |

**RUM 실사의 결론 두 가지**: (1) 웹 세션 리플레이·프론트↔백엔드 상관은 즉시 대체 가능한 🟢이지만, **모바일 리플레이는 존재하지 않는 🔴** 라 착수 전 Datadog RUM usage를 웹/모바일로 분해해야 한다. (2) 대체는 프록시 매핑이 아니라 **`@hyperdx/browser` SDK 교체**로 간다 — `datadogreceiver`는 브라우저 RUM intake를 아예 수신하지 않는다. 두 논점의 상세는 [Datadog RUM 커버리지]({{< relref "02-datadog-rum-coverage.md" >}})·[dd 프록시 매핑]({{< relref "03-dd-proxy-mapping.md" >}}) 참조.

## 라이선스와 커뮤니티

핵심 UI가 **MIT**라는 점이 SigNoz(요소 제약)·Grafana(AGPL)·BSL/SSPL 계열 대비 관대하다. 단 오픈코어 모델이라 **접근통제 기능(SSO/SAML/RBAC/멀티테넌시)은 OSS에서 제외**된다.

| 레포/컴포넌트 | 라이선스 |
|---|---|
| `hyperdxio/hyperdx` (UI+API) | **MIT** `[확인됨]` |
| ClickHouse | Apache 2.0 `[확인됨]` |
| OpenTelemetry Collector | Apache 2.0 `[확인됨]` |
| `ClickHouse/ClickStack-helm-charts` | Apache 2.0 계열 `[추정]`(메인 `hyperdxio/hyperdx` 레포의 MIT는 LICENSE 파일로 `[확인됨]`이나, 이 helm-charts 레포 자체의 라이선스 파일은 이번 조사에서도 명시 확인되지 않음) |

커뮤니티: `hyperdxio/hyperdx`는 **~9.7k stars·188 릴리스**(월 다수 릴리스의 빠른 케이던스), 활성 Discord `[확인됨]`. ClickHouse Inc.의 전담 Head of Observability 조직 백업으로 abandonware 리스크가 인수 전보다 낮아졌다 `[추정]`. 부모 레포 `ClickHouse/ClickStack`은 아티팩트 저장소 성격으로 릴리스 없음 `[확인됨]`.

## OSS의 결정적 갭 — 접근통제 공백

**이 페이지에서 가장 무거운 실사 항목**이다. OSS 자체 호스팅 HyperDX는 **"인스턴스 = 하나의 평평한 팀, 전원 동일 권한"** 모델이다. 초대는 되지만 팀 A가 팀 B의 대시보드/데이터를 못 보게 하는 앱 내 장치가 전무하다 — Viewer/Editor/Admin + 폴더 권한을 기본 제공하는 Grafana OSS보다도 약하다 `[확인됨]`.

| 통제 축 | OSS 자체 호스팅 현실 |
|---|---|
| **로그인** | HyperDX 자체 계정. **인증 자체를 끌 수 없음**(선언적 크레덴셜 미구현, #1329 OPEN) `[확인됨]` |
| **SSO / SAML** | **없음**. SSO=Cloud, SAML=Enterprise 전용 `[확인됨]` |
| **RBAC** | **없음** — 리소스별 역할/권한 개념 자체가 OSS에 부재 `[확인됨]` |
| **멀티테넌시** | **없음** — 인스턴스당 단일 팀. multi-tenant는 Cloud 전용 `[확인됨]` |
| **감사로그** | **없음**(전 배포 공통 미출시) `[확인됨]` |

- **RBAC는 이미 GA됐으나 OSS로 오지 않았다.** 2026-04-01 RBAC 공지는 **Managed ClickStack(ClickHouse Cloud) 전용**이고, 사용자는 ClickHouse Cloud 조직 레벨에서 관리된다. OSS RBAC 요청 이슈 #1293은 **not planned로 CLOSED** `[확인됨]`. → "로드맵 GA를 기다린다"는 전략은 RBAC에 관한 한 **로드맵에 없는 것을 기다리는 것**이다.
- **감사로그**는 아직 미출시이나, RBAC 선례를 보면 **Cloud 전용 착지 가능성이 높다** `[추정]`.
- **운영 리스크**: HyperDX가 요구하는 MongoDB가 **기본 무인증으로 기동**돼 포트(27017)가 노출되자 스캐너에 데이터가 삭제된 자체 호스팅 실사례가 있다. 접근통제 설계에 **MongoDB 인증·NetworkPolicy 격리를 반드시 포함** `[확인됨]`. 부하 프로파일·배포 경로별 운영 상세는 [HyperDX의 MongoDB]({{< relref "07-hyperdx-mongodb.md" >}}) 참고.

> 결정적 트레이드오프: **"앱 레벨 RBAC/SSO/감사로그"와 "self-hosted EKS + 자체 ClickHouse"는 ClickStack 생태계에서 동시에 가질 수 없다.** RBAC/SSO는 Managed(Cloud)에만 있고 Managed는 self-host가 안 되기 때문이다. 무엇을 상위 제약으로 둘지가 나머지를 지배한다.

### 완화 경로 — 앱 밖에서 접근통제 조립

OSS를 고수하려면 세 기법을 **조합**해야 한다. 핵심은 AuthN(인증)은 상당 부분 흉내 낼 수 있으나 AuthZ(인가)는 앱 밖에서 매우 제한적이라는 비대칭이다.

| 기법 | 해결 범위 | 한계 |
|---|---|---|
| **oauth2-proxy 경계 SSO** | AuthN 게이트(IdP 그룹 all-or-nothing) | HyperDX 자체 로그인을 못 꺼 **이중 로그인**, trusted-header 자동 로그인 미지원 → 인스턴스 내부 격리는 전혀 못 함 `[확인됨/추정]` |
| **팀별 HyperDX 인스턴스**(공유 CH + 전용 MongoDB) | 거친 멀티테넌시 — **벤더가 인정한 이전 표준 우회책** | 관리 상한 ≈ 5~15팀, 초과 시 인스턴스 스프롤로 Managed가 TCO 유리 `[확인됨/추정]` |
| **ClickHouse row policy** | 데이터 레벨 2차 방어선(SELECT 한정) | DB 레벨 격리일 뿐 — 대시보드/알림 등 앱 상태(MongoDB)엔 안 닿음 `[확인됨]` |
| **규제 팀만 Managed ClickStack** | RBAC·SSO/SAML/SCIM·(향후)감사로그 turnkey | self-host 포기(Cloud 인프라 전용) `[확인됨]` |

이 접근통제 갭 자체의 의사결정 프레임과 조직 규모별 매트릭스는 [Datadog 대체 매트릭스]({{< relref "04-datadog-replacement-matrix.md" >}})·[마이그레이션 로드맵]({{< relref "05-migration-roadmap.md" >}})에서 이어진다.

## 우리 케이스에서는

**전제 차이를 먼저 못 박는다.** [로깅 챕터]({{< relref "../logging/_index.md" >}})는 **로그 내재화 단독** 관점이라 로그는 [VictoriaLogs]({{< relref "../logging/03-victorialogs.md" >}})로 가고 통합 저장소(D4)는 "earn it last", ClickStack은 채택하지 않는다고 결론냈다 — CH+MongoDB 운영 표면이 이번 **로그 규모**에는 과하기 때문이다. 이 조사는 거기에 **세 가지 전제를 추가**한다: (1) 목표가 **Datadog RUM 대체**이고 웹 RUM은 HyperDX가 사실상 유일한 현실 경로, (2) 관측성 밖 **범용 분석용 ClickHouse를 어차피 운영**, (3) **운영 인력을 보유**. 이 세 전제가 붙으면 self-hosted CH의 "earn it" 조건이 로그 단독으로 볼 때보다 앞당겨진다.

두 챕터는 **양립한다**. 로그는 여전히 VictoriaLogs에 두고(CH로 옮기라는 게 아님), **모바일 RUM은 Datadog에 잔류**시킨다. 조사 [권고]는 이 전제 위에서:

- **RUM은 SDK 교체(`@hyperdx/browser`)로 간다.** 프록시 매핑이 아니다 — 웹 세션 리플레이·CWV·프론트↔백엔드 상관을 dual-instrument로 병행 검증한 뒤 컷오버. RUM 대체는 **대규모 프로덕션 레퍼런스가 아직 얇아 PoC 성공을 진입 게이트**로 삼는다 `[추정]`.
- **ClickHouse는 HyperDX Only(BYO)로 붙인다.** ClickStack 내장 CH를 켜지 말고 자체 운영 CH(범용 분석 겸용)에 연결해 operator를 일원화한다. CH 배포·operator 판단은 [ClickHouse 심층]({{< relref "../clickhouse/_index.md" >}})에서 다룬다.
- **메트릭은 HyperDX로 몰지 않는다.** PromQL 부재·대시보드/알림 미성숙 때문에 메트릭 계층은 VictoriaMetrics + Grafana로 분리 존치한다 `[확인됨]`.
- **최대 리스크는 OSS 접근통제 공백이다.** 다중 팀 광범위 롤아웃을 단일 OSS 인스턴스로 하면 Datadog 대비 거버넌스가 후퇴한다 → 파일럿은 oauth2-proxy 경계 SSO, 중간 롤아웃은 팀별 인스턴스 + row policy, 규제/감사 필수 팀만 Managed로 분리하는 **단계적 하이브리드**로 완화한다.
