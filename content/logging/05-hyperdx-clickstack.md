---
title: "HyperDX / ClickStack"
weight: 5
---

# HyperDX / ClickStack — ClickHouse 위의 통합 프론트

ClickHouse Inc.가 HyperDX를 인수(2025-03)해 **ClickStack**으로 출시(2025-05, GA). ClickHouse를 백엔드로 하는 로그·트레이스·세션 리플레이 통합 UI. MIT 라이선스, 활발한 릴리스. ClickHouse를 로그 스토어로 고를 때 **비어 있는 "관측성 제품층"을 채워주는 조각**이다.

- **웹 RUM**: `@hyperdx/browser`가 rrweb 세션 리플레이 + 에러 + Web Vitals + 네트워크 캡처 + **백엔드 트레이스 연동**(TraceId·rum.sessionId 상관)까지 지원. Datadog 웹 RUM 대체로 현실성 있다.
- **모바일 RUM**: **네이티브 iOS/Android/Flutter 세션 리플레이가 존재하지 않는다(2026).** RN 쪽도 트레이스/에러/네트워크만. "FE/Mobile RUM 중계처" 계획에서 모바일 절반이 공중에 뜬다.
- **확장(APM/로깅)**: 로그·트레이스는 강하지만 메트릭은 PromQL 미지원, 알림은 단일 임계값, 대시보드는 템플릿 변수도 없다. → **VictoriaMetrics/Grafana를 대체하지는 못한다. 메트릭은 절대 ClickHouse에 억지로 넣지 말 것.**

> 판단: 통합 프론트로 욕심내기 전에, **Datadog RUM usage를 소스별(웹/모바일)로 분해**해 모바일 비중부터 확인. 모바일이 과반이면 웹 전용 HyperDX는 청구서를 별로 못 줄이면서 관리 스택(CH+MongoDB)만 추가한다. RUM 내재화 자체는 [RUM 내재화]({{< relref "../rum/_index.md" >}}) 도메인에서 다룬다.
