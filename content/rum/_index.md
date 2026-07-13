---
title: "RUM 내재화"
weight: 4
cascade:
  type: docs
---

# RUM 내재화 — Datadog RUM에서 빠져나오기

RUM(Real User Monitoring)을 외부 SaaS 의존 없이 내재화하는 솔루션을 정리한다. 로그·메트릭 내재화와 같은 저장소·팀을 공유하는 흐름의 일부이므로, 큰 그림과 최소 조합은 [로깅 · 옵저버빌리티]({{< relref "../logging/_index.md" >}}) 챕터의 D3(RUM 내재화) 결정과 함께 읽는다.

## 왜 지금 — RWoL 재요율

Datadog RUM이 **RWoL(RUM without Limits)** 재요율로 실질 ~2배 인상되면서 내재화를 검토하게 되는 영역이다. **RUM Measure는 retain 비율과 무관하게 ingest 100%에 과금**(Measure 단가 $0.15/1k)되고, 여기에 retain 프리미엄·세션 리플레이가 얹히면 RWoL 블렌디드 실효단가가 ~$0.42/1k까지 오른다 → 월 30M 세션이면 30M×$0.42/1k×12 ≈ **연 ~$151K** `[추정]`.

> 결론부터: **웹은 대안이 있고, 모바일은 아직 성숙하지 않았다.**

## 대안 비교

| 옵션 | 모바일 리플레이 | 운영 부담 |
|---|---|---|
| Datadog 유지(모바일만) | 완전(crash/ANR 포함) | 0 |
| Sentry self-hosted | 지원(v24.7.1≈2024-07~) | 컨테이너 20+개, 공식 문구 "low-volume/PoC용" |
| OpenReplay | iOS/Android/RN 전부 **Beta** | Postgres+Redis+CH+Kafka+S3, ~10 서비스 |
| PostHog self-host | — | 공식적으로 대규모 셀프호스트 비권장 |
| Grafana Faro | 리플레이 없음(에러+Vitals만) | 낮음 — 기존 스택에 잘 붙음 |

## 웹 경로 — HyperDX / ClickStack

웹 RUM은 **HyperDX(ClickStack)** 로 탈출할 여지가 크다. `@hyperdx/browser`가 rrweb 세션 리플레이 + 에러 + Web Vitals + 네트워크 캡처 + **백엔드 트레이스 연동**(TraceId·rum.sessionId 상관)까지 지원해 Datadog 웹 RUM 대체로 현실성이 있다. HyperDX 플랫폼의 도입 실사(연혁·4컴포넌트 아키텍처·배포 6모드·라이선스·OSS 접근통제 갭)는 [HyperDX / ClickStack 심층 분석]({{< relref "01-hyperdx-deep-dive.md" >}})에서 다룬다. HyperDX를 로그·트레이스 스토어로 함께 보는 관점은 [로깅 챕터의 HyperDX / ClickStack]({{< relref "../logging/05-hyperdx-clickstack.md" >}}) 페이지 참고.

반면 **모바일은 네이티브 iOS/Android/Flutter 세션 리플레이가 존재하지 않는다(2026).** React Native 쪽도 트레이스/에러/네트워크만 지원하고 리플레이는 없다.

## 판단

- **웹 리플레이**는 HyperDX(rrweb)로 탈출 가능.
- **모바일 리플레이**는 대안이 성숙할 때까지 **Datadog 잔류**가 현실적.
- 계약 갱신 시점에 RUM 축소분을 반영해 **전체 딜로 재협상**(RUM만 빼면 잔여 제품 할인이 재요율될 수 있음).

**착수 전 필수 확인**: Datadog RUM usage를 **소스별(웹/모바일)로 분해**해 모바일 비중부터 측정한다. 모바일이 과반이면 웹 전용 HyperDX는 청구서를 별로 못 줄이면서 관리 스택(CH+MongoDB)만 추가한다.

이후 조사에서 웹 코어 지표는 SDK 교체로 즉시 대체 가능하나 Frustration·Product Analytics 등 나머지 슬라이스는 CH SQL 자작이 필요하고 패키지드 ClickStack의 웹 RUM 전면 대체 전례가 아직 부재함이 확인됐다 → [Datadog RUM 커버리지]({{< relref "02-datadog-rum-coverage.md" >}}) 판정에 따라 **Wave 1에 PoC 게이트**를 추가한다.

> `[추정]`은 자릿수 추정으로, 실 계약 할인·트래픽으로 교정이 필요하다. 시점 기준 2026-07.

## 블록 지도

| 페이지 | 내용 |
|---|---|
| [HyperDX / ClickStack 심층 분석]({{< relref "01-hyperdx-deep-dive.md" >}}) | 도입 실사 — 연혁·4컴포넌트 아키텍처·배포 6모드·기능 성숙도·라이선스·OSS 접근통제 갭(RBAC Managed 전용)과 완화 경로 |
| [Datadog RUM 커버리지]({{< relref "02-datadog-rum-coverage.md" >}}) | Datadog RUM 기능 전수 vs `@hyperdx/browser` 격차 매트릭스 + RUM 4슬라이스 판정(Core 🟢/Frustration 🟡/PA·Mobile 🔴), 전례 부재 → PoC를 Wave 1 게이트로 |
| [Datadog 프로토콜 프록시 매핑]({{< relref "03-dd-proxy-mapping.md" >}}) | dd 프로토콜 프록시는 Agent intake(로그/메트릭/APM)에만 성립하고 브라우저 RUM엔 불성립 — 과도기 브릿지로만, RUM은 SDK 교체 |
| [Datadog 전 제품군 대체 매트릭스]({{< relref "04-datadog-replacement-matrix.md" >}}) | 전 제품군을 🟢즉시/🟡조건부/🔴유지 3분류로 지도화, 메트릭은 VictoriaMetrics+Grafana로 분리, Wave 이관 전략·비용 함정 |
| [마이그레이션 로드맵]({{< relref "05-migration-roadmap.md" >}}) | Executive 판정·리스크 Top5·Sprint 1~6+ 게이트 체크리스트·오픈 퀘스천·로깅 챕터와의 전제 차이 조정 |
| [출처]({{< relref "06-sources.md" >}}) | RUM 섹션 조사 문서의 출처 URL을 4분류(HyperDX·Datadog 공식·SDK/OTel·커뮤니티/사례) 표로 정리 |
