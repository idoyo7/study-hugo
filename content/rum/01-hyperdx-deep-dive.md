---
title: "HyperDX / ClickStack 심층 분석"
date: 2026-07-13
lastmod: 2026-09-08
weight: 1
---

# HyperDX / ClickStack을 RUM에 도입하기 전에

HyperDX는 브라우저 세션 리플레이에서 백엔드 트레이스와 로그로 이어지는 조사 흐름을 제공합니다. Datadog 웹 RUM을 옮기려는 이유가 이 흐름이라면 검토할 만합니다. 다만 SDK로 수집할 수 있는 범위, 기존 녹화와 설정의 이관, 여러 팀의 접근 권한은 각각 확인해야 합니다.

이 글은 2026-07 조사에 2026-09-08 기능 재검토를 반영한 기록입니다. 현재 우리 배포를 실행 검증한 결과는 아닙니다. 로그 저장소만 필요한 경우의 평가는 [로깅 관점의 ClickStack]({{< relref "../logging/05-hyperdx-clickstack.md" >}})에서 다룹니다.

## 네 컴포넌트의 역할 {#아키텍처--3-코어--1-필수-메타스토어}

ClickStack은 HyperDX UI·API, ClickHouse, OpenTelemetry Collector를 묶어 제공합니다. 여기에 앱 설정을 저장하는 MongoDB가 필요합니다. 기존 ClickHouse에 HyperDX만 연결하는 모드에서도 MongoDB 의존성은 남습니다.

| 컴포넌트 | 역할 | 라이선스 |
|---|---|---|
| ClickHouse | 모든 텔레메트리(로그/트레이스/메트릭/세션)의 단일 저장·쿼리 원천 | Apache 2.0 |
| HyperDX | 탐색/시각화 프론트엔드(Next.js) + API 백엔드(Node.js) | MIT |
| OpenTelemetry Collector | 인제스천 게이트웨이(OTLP 수신 → ClickHouse export), 스키마 강제 | Apache 2.0 |
| MongoDB | 앱 상태 저장(필수) — 대시보드·저장검색·사용자·알림 정의 | 외부 의존성 |

표준 수집 경로는 OTLP gRPC 4317과 HTTP 4318을 사용하고, Collector 동적 설정은 OpAMP로 전달합니다. 조사 당시 `CUSTOM_OTELCOL_CONFIG_FILE`은 기본 설정에 새 receiver·processor를 추가하는 방식이었으며 기존 컴포넌트를 자유롭게 덮어쓰는 용도로 쓰면 안 됩니다 `✓`.

MongoDB는 텔레메트리 본문 대신 대시보드·저장검색·사용자·알림을 저장합니다. 부하와 배포별 인증·백업 설정은 [HyperDX의 MongoDB]({{< relref "07-hyperdx-mongodb.md" >}})를 참고합니다. FerretDB로 대체한 커뮤니티 사례도 있었으나 공식 지원 구성으로 확인된 것은 아닙니다 `≈`.

### RUM과 트레이스를 연결하는 테이블 {#신호별-테이블-스키마--rum-상관의-근거}

수집기는 신호별 테이블과 codec·TTL·인덱스를 만듭니다. 조사한 기본 속성 타입은 `Map(LowCardinality(String), String)`이며, ClickStack의 native JSON 사용 경로는 당시 Beta였습니다. ClickHouse 엔진 자체의 JSON 지원 상태와 구분해야 합니다.

| 테이블 | 용도 | RUM 관점 포인트 |
|---|---|---|
| `otel_logs` | 로그/이벤트 | `TraceId` text index, 속성 bloom filter, `Body` 토큰 검색 |
| `otel_traces` | 분산 트레이스 | `rum.sessionId`를 컬럼으로 materialize → 세션↔트레이스 조인 근거 `✓` |
| `otel_metrics_*` | 메트릭(타입별 분리 테이블) | Exemplar 배열 포함. 이 일반 OTel 테이블에 PromQL이 자동 적용되지는 않음(아래) |
| `hyperdx_sessions` | 세션 리플레이(rrweb) | `otel_logs`를 미러링한 독립 DDL·TTL 전용 테이블 `✓` |

세션과 트레이스를 연결하려면 `rum.sessionId`와 trace ID가 수집·변환 과정에서 유지돼야 합니다. `otel_traces`에는 관련 materialized 컬럼과 bloom filter, `Duration`의 minmax 인덱스가 있습니다. `TraceId` bloom filter의 예시 false-positive 비율은 0.001입니다 `✓`.

`otel_metrics_*`는 gauge·sum·histogram·exp-hist·summary별로 나뉩니다. `hyperdx_sessions`는 `Body`에 리플레이 이벤트를, `LogAttributes`에 속성을 넣으며 `otel_logs`와 같은 컬럼 구성을 사용합니다. 저장 TTL은 표준 `TABLES_TTL` 기본값 3일을 따르고, 신호별 보관 기간은 직접 설정합니다. 기존 테이블과 자체 컨버터 테이블은 `SHOW CREATE TABLE`로 실제 TTL을 확인해야 합니다. [S3 티어링]({{< relref "../hyperdx/03-s3-cold-tiering.md" >}})에서 변경 예제를 다룹니다.

조회는 Lucene 스타일 검색과 ClickHouse SQL을 지원합니다. 임의 테이블도 소스로 등록할 수 있지만, 시간·본문·서비스명 등 필드 매핑과 신호 간 연결을 설정해야 원하는 화면을 얻을 수 있습니다.

## 배포 모드 선택 {#배포-6모드--프로덕션-적합성-매트릭스}

설치 편의만으로 배포 모드를 고르면 인증이나 영속성, 복제를 빠뜨리기 쉽습니다. 공식 배포 안내에 따른 용도와 각 구성에서 남는 작업을 정리했습니다.

| 모드 | 권장 용도 | 프로덕션 | 실사 비고 |
|---|---|:---:|---|
| Managed ClickStack(ClickHouse Cloud) | 프로덕션/데모/PoC | 권장 | Cloud 호스팅·통합 인증. RBAC/SSO는 여기에만 있음 `✓` |
| All-in-One(단일 Docker) | 데모/PoC | 비권장 | CH+HyperDX+OTel+MongoDB 올인원. HA 없음 |
| Helm (Kubernetes) | 프로덕션 on k8s | 권장 | operator 종류 확인 |
| Docker Compose | 로컬/PoC/단일 서버 | 구성에 따라 검토 | fault tolerance 없음 |
| HyperDX Only | 기존 CH 사용자·커스텀 파이프라인 | 구성에 따라 검토 | CH 미포함, MongoDB 필수·인제스천 자기 책임 |
| Local Mode Only | 데모/디버깅 | 비권장 | 인증·영속성·알림 없음, 단일 사용자 |

Helm 설치는 `clickstack-operators` 뒤에 `clickstack`을 설치하는 구조입니다. 조사한 공식 차트의 ClickHouse operator는 `ClickHouseCluster`·`KeeperCluster` CRD를 사용하고, MongoDB는 `MongoDBCommunity` CRD로 관리합니다. Altinity의 CHI·CHK와 다른 operator입니다 `✓`.

이미 Altinity로 분석용 ClickHouse를 운영한다면 차트의 ClickHouse를 끄고 기존 클러스터에 연결할 수 있습니다. 두 operator를 함께 운영할지, 한쪽으로 통일할지는 [operator 선택]({{< relref "../clickhouse/03-operator.md" >}})에서 비교합니다.

### 기존 ClickHouse에 연결하기 {#hyperdx-only--조건-정리}

HyperDX Only는 기존 ClickHouse와 수집 파이프라인을 활용하는 방법입니다. MongoDB를 `MONGO_URI`로 제공하고 HyperDX를 띄운 뒤 UI에서 외부 ClickHouse 소스를 등록합니다. 예시 기동은 `docker run -e MONGO_URI=... docker.hyperdx.io/hyperdx/hyperdx`이며 UI 기본 포트는 8080입니다.

OTel Collector나 직접 INSERT, Kafka·S3 테이블 엔진 등 수집 경로는 사용자가 운영합니다. ClickPipes는 해당 관리형 환경의 선택지이므로 self-host 구성에 자동으로 포함된다고 보면 안 됩니다. 이 시리즈의 EKS 구성은 [스택 토폴로지]({{< relref "../hyperdx/01-stack-topology.md" >}})에서 이어집니다.

`TABLES_TTL=72h` 기본값을 그대로 둘지 보관 요구에 맞춰 바꿀지 결정해야 합니다. 공식 ClickHouse 사이징 가이드의 인제스트 10 MB/s당 1 vCPU 같은 값은 초기 추정에 쓸 수 있지만 `Ⓥ`, 조회량·쿼리 형태를 반영한 실측이 필요합니다.

## 수집·조회·알림 기능 {#기능-성숙도-매트릭스}

로그 검색, 분산 트레이스, 웹 세션 리플레이가 이 조사에서 중점적으로 검토한 기능입니다. `@hyperdx/browser`는 rrweb 리플레이·에러·Web Vitals·네트워크 요청을 수집하며, 트레이스에는 HTTP에서 DB 쿼리까지의 스팬을 연결할 수 있습니다. 대시보드는 import/export와 필터·연결된 필터·SQL 매크로를 지원합니다.

알림은 Search·Chart 조건, 그룹별 평가와 발화, 평가 이력을 제공합니다. SQL로 이동 평균이나 표준편차를 계산할 수도 있습니다. 다만 내장 ML 이상탐지나 Alertmanager의 알림 묶음·억제 정책과 같은 기능으로 볼 수는 없습니다. OSS 채널은 Slack·Generic Webhook 중심이며 Slack API·PagerDuty OAuth는 Cloud 전용입니다. [공식 알림 문서](https://clickhouse.com/docs/clickstack/features/alerts)에서 지원 범위를 확인할 수 있습니다.

Terraform은 `ClickHouse/clickhouse` provider v3.25부터 Beta로 ClickStack 설정을 관리합니다. self-host와 Cloud 모두 대상이지만 Datadog 설정을 자동 변환하지는 않습니다. 지원 리소스와 drift 제약은 [공식 안내](https://clickhouse.com/blog/clickstack-terraform-provider)를 따릅니다.

PromQL은 TimeSeries Engine에 저장한 메트릭을 조회하거나 외부 Prometheus 호환 서버에 질의를 위임하는 실험적 경로가 있습니다. 외부 연결 UI는 `NEXT_PUBLIC_ENABLE_PROMQL=true`로 켜며, 기존 `otel_metrics_*`에 PromQL이 자동 적용되지는 않습니다. [2026-06 변경 안내](https://clickhouse.com/blog/whats-new-in-clickstack-june-2026)에 두 경로가 설명돼 있습니다. 조사 당시 Service Maps는 Beta, Event Deltas는 구성 가능한 상태였고 AI 노트북·자연어 쿼리는 preview·로드맵 범위였습니다.

표준 모바일 SDK의 범위는 웹과 다릅니다. 네이티브 iOS·Android·Flutter 리플레이는 확인되지 않았고, React Native SDK는 트레이스·에러·네트워크 수집 범위였습니다. Datadog Agent용 receiver가 로그·메트릭·트레이스를 받는다고 브라우저 RUM payload와 기존 녹화까지 변환하는 것은 아닙니다. [RUM 커버리지]({{< relref "02-datadog-rum-coverage.md" >}})와 [프로토콜 매핑]({{< relref "03-dd-proxy-mapping.md" >}})에서 이관 조건을 다룹니다.

## 여러 팀이 사용할 때의 접근통제 {#oss의-결정적-갭--접근통제-공백}

여러 팀이 사용할 계획이라면 UI 기능보다 권한 구조를 일찍 확인해야 합니다. 조사한 OSS HyperDX는 인스턴스 안의 사용자를 같은 팀으로 다루며, 팀별 리소스 권한을 나누는 RBAC가 없었습니다.

| 통제 축 | OSS 자체 호스팅 현실 |
|---|---|
| 로그인 | HyperDX 자체 계정. 인증 자체를 끌 수 없음(선언적 크레덴셜 미구현, #1329 OPEN) `✓` |
| SSO / SAML | OSS 없음. Managed는 ClickHouse Cloud 인증에 통합(SAML은 Cloud Enterprise 티어) `✓` |
| RBAC | 없음 — 리소스별 역할/권한 개념 자체가 OSS에 부재 `✓` |
| 멀티테넌시 | 없음 — 인스턴스당 단일 팀. multi-tenant는 Cloud 전용 `✓` |
| 감사로그 | 없음(전 배포 공통 미출시) `✓` |

2026-04-01의 RBAC GA는 Managed ClickStack 대상이었습니다. OSS 요청 이슈 #1293도 not planned로 닫혀 있어 OSS 제공 일정을 전제할 근거가 없었습니다. 감사로그가 어느 배포에 출시될지는 이 기록으로 예측하지 않습니다.

### 외부 인증과 인스턴스 분리 {#완화-경로--앱-밖에서-접근통제-조립}

외부 인증이나 인스턴스 분리는 일부 요구를 해결하지만 적용 범위가 다릅니다.

| 기법 | 해결 범위 | 한계 |
|---|---|---|
| oauth2-proxy 경계 SSO | AuthN 게이트(IdP 그룹 all-or-nothing) | 이중 로그인 발생, 내부 격리 불가 `✓/≈` |
| 팀별 HyperDX 인스턴스(공유 CH + 전용 MongoDB) | 거친 멀티테넌시 — 인스턴스별 분리 | 운영 부담이 커질 수 있음 `✓/≈` |
| ClickHouse row policy | 데이터 레벨 2차 방어선(SELECT 한정) | 앱 상태(MongoDB)엔 안 닿음 `✓` |
| 규제 팀만 Managed ClickStack | Managed의 RBAC·SSO 사용 | self-host 포기 `✓` |

oauth2-proxy를 앞에 두어도 HyperDX 자체 로그인이 남아 이중 로그인이 발생할 수 있습니다. 인스턴스 내부의 대시보드 권한까지 분리하지는 못합니다. 팀별 HyperDX와 전용 MongoDB를 운영하면 설정을 나눌 수 있지만 팀 수만큼 배포·업그레이드·백업 작업이 늘어납니다.

ClickHouse row policy는 SELECT 데이터 접근을 제한하며 MongoDB에 저장한 대시보드·알림 설정에는 적용되지 않습니다. 필요한 접근통제를 이 조합으로 충족하기 어렵다면 Managed의 지원 범위와 자체 인프라 요구를 함께 비교해야 합니다. 조직별 이관 판단은 [전 제품군 대체 매트릭스]({{< relref "04-datadog-replacement-matrix.md" >}})와 [마이그레이션 로드맵]({{< relref "05-migration-roadmap.md" >}})으로 이어집니다.

MongoDB 인증과 네트워크 격리도 별도로 필요합니다. 앱 로그인만 설정해 두고 메타데이터 저장소를 무인증으로 노출해서는 안 됩니다.

## HyperDX와 ClickStack의 연혁 {#연혁--deploysentinel에서-clickstack까지}

HyperDX는 ClickStack의 UI·API로 계속 개발됩니다. ClickStack이라는 이름은 UI에 ClickHouse와 Collector를 묶은 스택을 가리킵니다.

| 시점 | 사건 |
|---|---|
| 2022 | DeploySentinel, Inc. 설립(YC S22). CI/배포 모니터링 → 프로덕션 디버깅 관측성 HyperDX로 피벗·리브랜딩 `✓` |
| 2024 말 | HyperDX v2 UI 오픈소스화 — 세션 리플레이·OTel 메트릭·알림·저장 검색·대시보드 추가 `✓` |
| 2025-03-13 | ClickHouse Inc. 인수(금액 비공개). HyperDX Cloud 계속 운영 + OSS 계속 개발 명시 `✓` |
| 2025-05-29 | ClickStack 출시 — 3컴포넌트 번들 재구성(리브랜드 아님) `✓` |
| 2025-08-06 | ClickHouse Cloud 내 ClickStack Private Preview(원클릭, 통합 인증) `✓` |
| 2025-12 | Materialized Views 완전 통합(쿼리 가속) `✓` |
| 2026-04-01 | RBAC GA — 단, Managed(ClickHouse Cloud) 전용 `✓` |

ClickHouse를 운영하는 기업이 모두 HyperDX UI를 사용하는 것은 아닙니다. 조사에서 확인한 Anthropic 사례는 자체 ClickHouse 관측성 구성입니다. Anthropic·character.AI의 UI 피드백을 패키지 전체의 프로덕션 도입 사례로 옮기지 않습니다.

## 라이선스와 커뮤니티

`hyperdxio/hyperdx`의 UI·API는 MIT, ClickHouse와 OpenTelemetry Collector는 Apache 2.0입니다 `✓`. 조사 당시 ClickStack Helm 저장소의 라이선스 파일은 별도로 확정하지 못했습니다. UI의 라이선스만으로 모든 의존성과 배포 아티팩트의 조건을 판단할 수는 없습니다.

2026-07 조사에서는 HyperDX 저장소의 약 9.7k stars, 188개 릴리스와 Discord 활동을 확인했습니다. 이는 당시 개발 활동의 기록이며 현재 수치나 향후 유지보수 보장은 아닙니다. `ClickHouse/ClickStack` 저장소는 아티팩트 안내 성격이라 실제 개발·릴리스 저장소와 구분해 봅니다.

## 초기 권고와 실제 배포의 차이 {#우리-케이스에서는}

로그만 옮기는 계획에서는 [VictoriaLogs]({{< relref "../logging/03-victorialogs.md" >}})를 우선 검토했습니다. RUM과 범용 분석을 위해 ClickHouse를 운영할 계획이 더해지면 HyperDX의 배포 비용을 함께 평가할 수 있습니다. 배포 방식과 스토리지는 [ClickHouse 운영]({{< relref "../clickhouse/_index.md" >}})에서 다룹니다.

초기 조사는 `@hyperdx/browser`로 웹 SDK를 교체하고 모바일은 Datadog에 남기는 안을 제시했습니다. 이후 [우리 배포 기록]({{< relref "../hyperdx-operating/01-our-deployment.md" >}})에는 웹·모바일 RUM을 자체 컨버터로 받는 경로가 있습니다. 초기 권고를 현재 배포 사실로 읽어서는 안 되며, 컨버터의 누락 필드와 리플레이·trace 연결을 실제 데이터로 검증해야 합니다.

메트릭은 기존 VictoriaMetrics·Grafana와 알림 결과를 대조한 뒤 이관 범위를 정합니다. PromQL 실험 기능이 생겼다는 것만으로 기존 운영을 교체할 근거가 되지는 않습니다. 기능별 변경과 자체 컨버터의 검증 항목은 [2026-09 재검토]({{< relref "08-datadog-coverage-2026-09.md" >}})에 모았습니다.
