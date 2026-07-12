---
title: "RUM 내재화"
weight: 4
cascade:
  type: docs
---

# RUM 내재화 — Datadog RUM에서 빠져나오기

RUM(Real User Monitoring)을 외부 SaaS 의존 없이 내재화하는 솔루션을 정리한다. 로그·메트릭 내재화와 같은 저장소·팀을 공유하는 흐름의 일부이므로, 큰 그림과 최소 조합은 [로깅 · 옵저버빌리티]({{< relref "../logging/_index.md" >}}) 챕터의 D3(RUM 내재화) 결정과 함께 읽는다.

## 왜 지금 — RWoL 재요율

Datadog RUM이 **RWoL(RUM without Limits)** 재요율로 실질 ~2배 인상되면서 내재화를 검토하게 되는 영역이다. **RUM Measure는 retain 비율과 무관하게 ingest 100%에 과금**(Measure 단가 $0.15/1k)되고, 여기에 retain 프리미엄·세션 리플레이가 얹히면 RWoL 블렌디드 실효단가가 ~$0.42/1k까지 오른다 → 월 30M 세션이면 30M×$0.42/1k×12 ≈ **연 $153K** `[추정]`.

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

웹 RUM은 **HyperDX(ClickStack)** 로 탈출할 여지가 크다. `@hyperdx/browser`가 rrweb 세션 리플레이 + 에러 + Web Vitals + 네트워크 캡처 + **백엔드 트레이스 연동**(TraceId·rum.sessionId 상관)까지 지원해 Datadog 웹 RUM 대체로 현실성이 있다. HyperDX를 로그·트레이스 스토어로 함께 보는 관점은 [로깅 챕터의 HyperDX / ClickStack]({{< relref "../logging/05-hyperdx-clickstack.md" >}}) 페이지 참고.

반면 **모바일은 네이티브 iOS/Android/Flutter 세션 리플레이가 존재하지 않는다(2026).** React Native 쪽도 트레이스/에러/네트워크만 지원하고 리플레이는 없다.

## 판단

- **웹 리플레이**는 HyperDX(rrweb)로 탈출 가능.
- **모바일 리플레이**는 대안이 성숙할 때까지 **Datadog 잔류**가 현실적.
- 계약 갱신 시점에 RUM 축소분을 반영해 **전체 딜로 재협상**(RUM만 빼면 잔여 제품 할인이 재요율될 수 있음).

**착수 전 필수 확인**: Datadog RUM usage를 **소스별(웹/모바일)로 분해**해 모바일 비중부터 측정한다. 모바일이 과반이면 웹 전용 HyperDX는 청구서를 별로 못 줄이면서 관리 스택(CH+MongoDB)만 추가한다.

> `[추정]`은 자릿수 추정으로, 실 계약 할인·트래픽으로 교정이 필요하다. 시점 기준 2026-07.
