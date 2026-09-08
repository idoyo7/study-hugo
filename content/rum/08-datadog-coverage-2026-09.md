---
title: "HyperDX 커버리지 재판정 — Datadog 대비 2026-09"
description: "PromQL·Terraform·알림·Datadog 수신의 변경점을 검증하고, 제품 기능 대체와 프로토콜 호환·자체 RUM 컨버터의 경계를 구분합니다."
date: 2026-09-08
lastmod: 2026-09-08
weight: 8
---

# HyperDX 커버리지 재판정 — Datadog 대비 2026-09

{{< callout type="info" >}}
- HyperDX의 Datadog 대체 범위는 넓어졌습니다. PromQL은 실험적 경로가 생겼고, Terraform은 셀프호스트도 지원하는 Beta입니다. 알림 평가 이력과 그룹별 발화도 있습니다.
- Datadog Agent의 로그·메트릭·트레이스를 받는 것과 Datadog RUM·세션 리플레이·모니터 설정을 그대로 옮기는 것은 별도 문제입니다.
- 이 글은 2026-09-08에 확인한 공식 문서·upstream 소스 기준입니다. 우리 배포의 이미지 버전과 자체 컨버터를 실행 검증한 결과는 아닙니다.
{{< /callout >}}

[플랫폼 심층 분석]({{< relref "01-hyperdx-deep-dive.md" >}}), [RUM 커버리지]({{< relref "02-datadog-rum-coverage.md" >}}), [전 제품군 대체 매트릭스]({{< relref "04-datadog-replacement-matrix.md" >}})의 2026-07 조사에서 바뀐 판단을 정리합니다. 기능의 존재, Datadog과의 동등성, 우리 배포에서의 가용성을 따로 확인합니다.

## 1. 전체 호환율을 제시하지 않는 이유

초기 조사에서는 Datadog 비교 항목 95행을 집계했습니다. OSS 판정은 동등 18·부분 30·없음 46·미확인 1로 산술 합계는 맞았습니다. 하지만 Sensitive Data Scanner가 로그와 보안에, Terraform이 대시보드와 거버넌스에 중복됐고 통합 항목도 겹쳤습니다. 기능·제품군·과금 모델을 같은 단위로 센 문제도 있습니다.

따라서 `(동등 + 부분) / 95 = 50.5%`를 기능 호환율로 사용하지 않습니다. 부분 구현을 동등 구현과 같은 가중치로 더하면 SDK 수집, UI 분석, 운영 워크플로의 차이가 사라집니다. 이 글은 근거를 확인한 변경점과 남는 이관 조건을 제시합니다. Datadog 전 제품군의 모든 기능을 재검증했다는 뜻은 아닙니다.

## 2. 기존 판단에서 달라진 점

| 항목 | 이전 설명 | 2026-09 확인 결과 |
|---|---|---|
| PromQL | 미지원·로드맵 | ClickHouse TimeSeries Engine 기반 질의와 외부 Prometheus 호환 저장소 프록시가 모두 실험적 경로로 존재한다. |
| Terraform | 없음 또는 IaC 미성숙 | 공식 provider가 셀프호스트·Cloud의 대시보드·알림 등 리소스를 관리한다. v3.25부터 Beta다. |
| 알림 운영 | 이력 없음·grouping 미성숙 | 평가 이력, 그룹별 독립 발화, 연속 평가 윈도 조건이 있다. 알림 간 묶음·억제 정책과는 구분된다. |
| 대시보드 | 템플릿 변수 없음·구성 제한 | 연결된 필터, SQL 매크로, kiosk 모드 등 구체적인 지원 항목으로 판단한다. Grafana 템플릿 전체와의 동등성은 별도다. |
| Datadog 수신 | 커스텀 Collector 빌드 또는 별도 홉 필요 | 현재 upstream Collector에 `datadogreceiver`가 포함된다. 배포 이미지에도 포함됐는지 확인해야 한다. |
| 웹 RUM | SDK 교체로 대부분 동등 | 브라우저 수집·리플레이는 지원하지만 Datadog 데이터 포맷, 기존 녹화, 분석 리포트의 호환까지 보장하지 않는다. |

### PromQL — 저장소와 스키마를 구분합니다

공식 [June + July 업데이트](https://clickhouse.com/blog/whats-new-in-clickstack-june-2026)는 두 경로를 설명합니다. ClickHouse의 **TimeSeries Engine에 저장된 Prometheus 형식 메트릭**을 PromQL로 조회하는 경로와, 외부 Prometheus 호환 엔드포인트에 질의를 위임하는 경로입니다. 둘 다 실험적입니다 `✓`.

외부 연결 UI는 기본 비활성이고 `NEXT_PUBLIC_ENABLE_PROMQL=true`로 노출합니다. 기존 `otel_metrics_*` 테이블을 아무 변경 없이 PromQL로 조회할 수 있다는 뜻은 아닙니다. VictoriaMetrics + Grafana를 유지하는 판단은 기존 메트릭·알림의 안정성을 근거로 삼을 수 있지만, 이제 “HyperDX에는 PromQL이 없다”를 근거로 삼을 수는 없습니다 `Σ`.

### Terraform — 지원 여부와 운영 성숙도는 다릅니다

[공식 provider 안내](https://clickhouse.com/blog/clickstack-terraform-provider)에 따르면 `ClickHouse/clickhouse` v3.25부터 ClickStack 리소스가 Beta로 제공됩니다. 대시보드·알림·소스·저장검색·연결·웹훅을 관리하며, 셀프호스트는 자체 엔드포인트와 개인 API 키로 인증합니다. 대시보드 리소스 이름은 `clickhouse_clickstack_dashboard`입니다 `✓`.

이것은 **ClickStack 설정을 코드로 관리하는 경로**입니다. Datadog 대시보드 JSON이나 모니터 쿼리를 자동 번역하는 기능이 아닙니다. 또한 공식 안내상 대시보드 UI 변경은 Terraform drift로 탐지되지 않으며, 이후 `dashboard_json` 변경 시 덮어쓸 수 있습니다. 대시보드별 관리 주체를 정해야 합니다 `✓`.

### 알림 — SQL 조건과 내장 모니터 유형을 구분합니다

[알림 문서](https://clickhouse.com/docs/clickstack/features/alerts)는 저장검색과 대시보드 차트 알림, 평가 이력, 그룹별 독립 발화를 설명합니다. SQL 차트 알림에서는 이동 평균·표준편차 같은 계산을 사용자가 작성할 수 있습니다. [업데이트 안내](https://clickhouse.com/blog/whats-new-in-clickstack-june-2026)에는 여러 연속 윈도에서 조건이 충족될 때 발화하는 설정도 있습니다 `✓`.

따라서 “정적 숫자 임계값 외의 조건은 표현할 수 없다”는 설명은 부정확합니다. 최종 평가는 임계값 비교여도 SQL이 동적 기준과 복합 계산을 만들 수 있습니다. 다만 이것이 Datadog의 학습 기반 모니터나 기존 모니터 상태를 조합하는 Composite Monitor를 그대로 제공한다는 뜻은 아닙니다 `Σ`.

그룹별 발화는 쿼리 결과의 서비스·환경별로 알림을 따로 평가하는 기능입니다. 여러 알림을 묶거나 서로 억제하는 Alertmanager 정책, 반복 유지보수 일정과의 동등성은 확인되지 않았습니다. 문서에 없다는 이유만으로 모든 음소거 수단이 없다고 단정하지도 않습니다. 채널도 배포별로 다릅니다. 공식 문서는 Slack API·PagerDuty 통합을 Cloud 전용으로 명시하므로 OSS에는 Slack Webhook·Generic Webhook 경로를 기준으로 판단합니다 `✓`.

## 3. Datadog과 호환되는 경계

| 경계 | 확인한 범위 | 별도 확인이 필요한 부분 |
|---|---|---|
| Agent → 수신부 | 로그·메트릭·트레이스 수신 및 OTLP 변환 | 실제 이미지의 receiver 포함 여부, 인증·포트·파이프라인 설정 |
| 변환된 데이터 → 조회 | ClickHouse 파이프라인으로 전달 | trace ID·속성 손실, 메트릭 temporality·분포 집계, 샘플링 보정 |
| 브라우저 → 리플레이 | 표준 경로는 `@hyperdx/browser` 사용 | Datadog RUM payload·기존 녹화의 변환과 재생 |
| Datadog 설정 → ClickStack | ClickStack 자체 API·Terraform 관리 가능 | 쿼리·대시보드·모니터·SLO의 의미 보존 및 재구성 |

현재 [upstream Collector README](https://github.com/hyperdxio/hyperdx/blob/main/packages/otel-collector/README.md)는 `datadogreceiver`가 바이너리에 포함되어 `:8126`에서 세 신호를 수신한다고 설명합니다. OpAMP 모드에서는 API/OpAMP 프로세스의 `ENABLE_DATADOG_RECEIVER=true`로 활성화하고, standalone에서는 receiver와 각 파이프라인을 설정합니다 `✓`. 이는 움직이는 `main` 소스 기준이므로 특정 릴리스 이미지에 대한 보증으로 읽으면 안 됩니다.

이 경로의 지원 목록은 로그·메트릭·트레이스입니다. Datadog 브라우저 RUM과 기존 세션 리플레이 녹화를 그대로 가져오는 경로까지 확인된 것은 아닙니다. 공식 [세션 리플레이 문서](https://clickhouse.com/docs/clickstack/features/session-replay)는 표준 리플레이 수집에 `@hyperdx/browser`가 필요하다고 설명합니다. 리플레이 기능의 존재와 Datadog 녹화 포맷 호환은 별개입니다 `✓/Σ`.

Core Web Vitals도 같은 기준을 적용합니다. SDK에서 신호를 수집하더라도 Datadog의 집계 기준·리포트·세션 분류까지 동등한 것은 아닙니다. [RUM 커버리지]({{< relref "02-datadog-rum-coverage.md" >}})의 비교는 수집과 분석 화면을 나누어 읽어야 합니다.

## 4. 남아 있는 격차

앞 절이 다룬 변경점은 없던 기능이 생겼거나 판정이 정정된 사례입니다. 이 절은 반대로, 2026-09-08 확인 시점에도 여전히 없는 기능이 어디에 몰려 있는지를 정리합니다. §1의 이유로 백분율은 쓰지 않고 분포만 서술합니다.

가장 두꺼운 격차는 알림 계층입니다. 이상 탐지 조건은 공식 FAQ가 "현재 지원하지 않으며 계획 중"이라고 못 박고, 여러 조건·여러 메트릭을 하나로 묶는 Composite Monitor도 같은 문서가 미지원으로 답합니다([ClickStack FAQ](https://clickhouse.com/docs/clickstack/faq)). 유지보수 창을 알림에서 빼는 Downtime(사일런싱), 알림을 인시던트 객체·타임라인으로 이어받는 Incident Management·On-Call도 문서에 없습니다. 실제로 잃는 항목의 다수가 이 알림 계층에 몰려 있습니다.

두 번째로 큰 덩어리는 보안 제품군입니다. SIEM·CSPM·CIEM·Cloud Workload Security·App & API Protection·Code Security(SAST/SCA) 전체가 공식 문서에 대응하는 페이지 자체를 갖고 있지 않습니다.

능동 합성 모니터링(Synthetics — API·Browser·Mobile Tests, Private Locations)도 없습니다. 문서의 "synthetic"은 `otelgen`/`telemetrygen` 같은 테스트 데이터 생성기를 가리킬 뿐, 다지역 프로빙 제품이 아닙니다.

모바일 SDK는 정체돼 있습니다. `@hyperdx/otel-react-native`가 유일한데 npm 최신 발행이 2025-01-22(v0.3.0)에서 멈춰 있고([npm](https://www.npmjs.com/package/@hyperdx/otel-react-native)), iOS·Android·Flutter 지원 요청 이슈 #397은 not planned로 닫혔습니다([GitHub #397](https://github.com/hyperdxio/hyperdx/issues/397)).

네트워크 계층도 비어 있습니다. NPM(Network Performance Monitoring)·NDM(Network Device Monitoring)은 문서·이슈 어디에도 없고, eBPF 기반 서비스 모니터링(USM)은 Odigos 파트너 연동으로 K8s 워크로드 무코드 자동계측만 부분 지원합니다([Odigos 연동](https://clickhouse.com/docs/clickstack/integration-partners/odigos)). Continuous Profiler 역시 문서·이슈 검색 어디에도 나오지 않습니다.

이 격차가 실행에 미치는 함의는 하나입니다. 알림이 가장 넓은 격차이므로, 착수 전에 현재 Datadog 모니터를 전수 조사해 정적 임계값으로 표현 가능한 것과 아닌 것을 갈라야 합니다. 그 비율이 이관 난이도를 결정합니다.

## 우리 케이스에서는

[우리 배포 형상]({{< relref "../hyperdx-operating/01-our-deployment/index.md" >}})은 2026-08 기록 기준으로 **브라우저·Mobile RUM → 자체 컨버터 → ClickHouse**, **표준 텔레메트리 → OTel Collector → ClickHouse** 두 경로를 명시합니다. HyperDX 웹 데이터 경로도 일부 커스터마이즈했습니다. 표준 OSS 지원표만으로 우리 컨버터의 동작을 판정할 수 없습니다.

초기 조사의 “모바일 제외, 실제 사용 43항목, 실제 손실 13개”는 이 배포 기록과 사용량 증거로 확정된 범위가 아니었습니다. 여기서는 그 숫자를 사용하지 않습니다. 비교 대상은 실제 사용 중인 기능·모니터와 컨버터가 보존하는 데이터입니다.

| 우리 경로 | 이관 판정에 필요한 증거 |
|---|---|
| 자체 RUM 컨버터 | 웹·모바일별 수신 이벤트, 세션 ID·trace ID 매핑, 누락 필드, 오류율 |
| 세션 리플레이 | 녹화 시작부터 재생까지의 샘플, 마스킹, 세션↔백엔드 트레이스 연결 |
| Datadog Agent 수신 | 배포 이미지·설정, 동일 트래픽에서 수량·속성·메트릭 집계 대조 |
| 모니터 이전 | 사용 중인 Datadog 쿼리·유형·그룹·유지보수 정책 목록과 ClickStack에서의 재현 결과 |
| 메트릭 화면 통합 | 대상 저장소·스키마, PromQL 실험 기능 설정, 기존 알림과의 결과 비교 |

표준 Collector의 [기본 TTL은 3일](https://clickhouse.com/docs/clickstack/managing/ttl)입니다 `✓`. 하지만 ClickHouse에 직접 쓰는 자체 컨버터 테이블이나 기존 테이블의 실제 TTL을 이 기본값으로 추정할 수 없습니다. 보존과 사이징은 테이블별 `SHOW CREATE TABLE` 결과로 확인해야 합니다.

배포 기록상 stage는 ClickHouse replica 1, MongoDB `members:1`, Collector 인메모리 큐, EBS 단일 티어입니다. RF2·영속 큐·cold S3는 prod 목표입니다. 기능 지원이 늘어난 사실만으로 이 운영 격차가 해소되지는 않습니다. 현재 클러스터가 이 기록과 같은지는 별도 실측 사항입니다.

## 출처와 적용 범위

- [ClickStack June + July 업데이트](https://clickhouse.com/blog/whats-new-in-clickstack-june-2026) — 실험적 PromQL 두 경로, 연결 필터·kiosk, 연속 윈도 알림.
- [ClickStack Terraform provider](https://clickhouse.com/blog/clickstack-terraform-provider) — v3.25부터 Beta, 셀프호스트 인증, 리소스 범위·대시보드 drift 제한.
- [알림 문서](https://clickhouse.com/docs/clickstack/features/alerts) — 평가 이력·SQL 조건·그룹별 발화·Cloud 전용 채널.
- [Collector 소스](https://github.com/hyperdxio/hyperdx/blob/main/packages/otel-collector/README.md) — upstream의 Datadog receiver 포함·활성화 경로. 실제 이미지 버전은 별도 확인.
- [세션 리플레이](https://clickhouse.com/docs/clickstack/features/session-replay) — 표준 브라우저 SDK와 세션↔트레이스 연결.
- [RBAC](https://clickhouse.com/docs/clickstack/managing/rbac) — Managed 전용. Terraform 지원이 OSS RBAC 지원을 의미하지 않습니다.
- [TTL](https://clickhouse.com/docs/clickstack/managing/ttl) — 표준 기본값과 기존 테이블의 TTL 변경 방법.
- [ClickStack FAQ](https://clickhouse.com/docs/clickstack/faq) — 이상 탐지·Composite Monitor 미지원 명시.
- [Odigos 연동](https://clickhouse.com/docs/clickstack/integration-partners/odigos) — eBPF 기반 서비스 모니터링의 부분 지원 범위.
- [npm @hyperdx/otel-react-native](https://www.npmjs.com/package/@hyperdx/otel-react-native) · [GitHub #397](https://github.com/hyperdxio/hyperdx/issues/397) — 모바일 SDK 최신 발행 시점과 지원 요청 처리 상태.

`✓`는 해당 출처에서 확인한 지원 범위, `Σ`는 그 범위에 근거한 판단입니다. 이 글은 기능 변화에 대한 문서 검증이며, 우리 클러스터의 배포 적합성이나 Datadog 데이터·설정의 무손실 이관을 인증하지 않습니다.
