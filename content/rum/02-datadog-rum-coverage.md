---
title: "Datadog RUM 커버리지 — 어디까지 대체되나"
weight: 2
---

# Datadog RUM 커버리지 — 어디까지 대체되나

{{< callout type="info" >}}
**한눈에**
- RUM을 하나로 묶어 "대체된다/안 된다"고 답하면 틀린다 — **4개의 이질적 하위 제품**으로 쪼개야 판정이 선다.
- **RUM-Core**(세션 리플레이+CWV/에러+트레이스 상관) 🟢 즉시(Wave 1) · **RUM-Frustration** 🟡 SQL 사후계산 · **RUM-PA**(퍼널/리텐션) 🔴 자작/PostHog 병행 · **RUM-Mobile** 🔴 OTel+Embrace/OpenReplay.
- 대체는 **프록시가 아니라 `@hyperdx/browser` SDK 교체**다 — `datadogreceiver`는 브라우저 RUM intake(`/api/v2/rum`)를 아예 수신하지 않는다.
- 좌절 신호·모바일 리플레이는 **네이티브 프리미티브 부재가 확인됨**(추측 격상 아님) — ClickHouse SQL(`sequenceMatch`/`windowFunnel`) 자작 또는 전용 툴이 필요하다.
- **"Datadog RUM을 HyperDX로 대체한 공개 프로덕션 사례"는 찾지 못했다** → dual-instrument PoC 성공을 Wave 1 진입 게이트로 명문화한다.
{{< /callout >}}

"coverage가 어디까지 되나"에 답하는 페이지다. [HyperDX 심층 실사]({{< relref "01-hyperdx-deep-dive.md" >}})가 플랫폼 관점(연혁·아키텍처·거버넌스 갭)을 다뤘다면, 여기서는 **Datadog RUM의 기능을 하나씩 `@hyperdx/browser`와 대조**해 어디까지 1:1로 넘어오고 어디서 끊기는지를 커버리지 관점으로 확정한다.

한 줄 결론: **RUM을 하나로 묶어 "대체된다/안 된다"고 답하면 틀린다.** RUM은 4개의 이질적 하위 제품이고, **웹 디버깅 코어(세션 리플레이·CWV·에러·트레이스 상관)는 🟢로 즉시 넘어오지만, 좌절 신호는 🟡(자작), 프로덕트 애널리틱스·모바일은 🔴(전용 툴)** 다. 이 분해가 [RUM 내재화 결론]({{< relref "_index.md" >}})의 "웹 YES / 모바일 NO"를 커버리지 레벨까지 심화한 형태다.

## 대체 대상을 먼저 정의 — Datadog RUM 이벤트 모델

무엇을 대체해야 하는지부터 못 박는다. Datadog RUM은 세션을 최상위로 하는 계층형 이벤트 모델이다 `[확인됨]`.

```
Session (세션)
 └─ View (페이지/화면 방문)
     ├─ Action     (클릭·커스텀 액션, frustration 포함)
     ├─ Resource   (XHR/fetch/img/css/js + 타이밍)
     ├─ Error      (프론트 에러)
     └─ Long Task  (메인스레드 50ms+ 블로킹)
```

View에는 Core Web Vitals(LCP/FCP/CLS/**INP**/FID)와 navigation timing이, Action에는 좌절 신호(`rage`/`dead`/`error click`)가 붙는다. 공식 JSON 스키마는 `DataDog/rum-events-format` 레포로 관리된다 `[확인됨]`. 이 모델의 각 항목이 `@hyperdx/browser`로 얼마나 넘어오는지가 커버리지의 실체다.

## 기능 전수 격차 매트릭스 (Datadog RUM ↔ @hyperdx/browser)

격차 범례: **낮음** = OTel 네이티브로 대등하거나 우수 · **중간** = 수집되나 스키마/UI/정밀도 손실 · **높음** = 네이티브 부재, 자작/전용 툴 필요.

| Datadog RUM 기능 | HyperDX 커버 | 방법·근거 | 격차 |
|---|:---:|---|:---:|
| **세션 추적**(Session) | ✅ | OTel `session.id` semconv + `rum.sessionId` 조인키 `[확인됨]` | 낮음 |
| **Core Web Vitals**(LCP/FCP/CLS/INP/FID) | ✅ 대부분 | otel-web web-vitals 계열이 수집 | INP·서브파트 정밀도 재구성 필요 `[추정]` / 중간 |
| **Navigation/Resource timing** | ✅ | `instrumentation-document-load` + `fetch`/`xhr` + PerformanceResourceTiming `[확인됨]` | 낮음 |
| **Long Task** | ⚠️ 부분 | otel-web long-task instrumentation 존재하나 스키마·UI 노출 제한 `[추정]` | 중간 |
| **User Action**(자동+커스텀) | ✅ | `instrumentation-user-interaction` + `HyperDX.addAction()` `[확인됨]` | 자동 액션 네이밍 품질 차이 / 낮음 |
| **Error / Crash** | ✅ | otel-web error instrumentation + `attachToReactErrorBoundary` `[확인됨]` | 낮음 |
| **Session Replay**(rrweb) | ✅ | `@hyperdx/otel-web-session-recorder`(rrweb), ClickStack에 리플레이 UI 내장 `[확인됨]` | 낮음(둘 다 rrweb 계열) |
| **네트워크 본문·헤더 캡처** | ✅ | `advancedNetworkCapture: true` `[확인됨]` | 낮음 |
| **프론트→백엔드 트레이스 연결** | ✅ | `tracePropagationTargets`(정규식 배열)에 매칭되는 아웃바운드 요청에 **W3C traceparent 헤더**를 주입해 브라우저 스팬과 서버 스팬을 연결하고, 리플레이된 세션에서 백엔드 트레이스로 양방향 내비게이션까지 가능 `[확인됨 3-0]` | 낮음(OTel 네이티브라 오히려 우수) |
| **좌절 신호**(rage/dead/error click) | ❌ | 네이티브 프리미티브 부재 `[확인됨: 부재]` → CH SQL 사후계산 또는 SDK 계측 | **높음** |
| **퍼널 / 리텐션 / Pathways** | ❌ | Datadog도 RUM→Product Analytics로 분리, HyperDX에 턴키 없음 `[확인됨]` | **높음** |
| **모바일 RUM**(iOS/Android/Flutter/RN) | ⚠️ RN만 | `@hyperdx/otel-react-native`(★4, Zipkin, signalfx 추종 포크)뿐 `[확인됨]` | **높음** |
| **모바일 세션 리플레이** | ❌ | 네이티브 부재 `[확인됨: 부재]` → Embrace/OpenReplay 필요 | **높음** |
| **데이터 보존·샘플링** | ✅ | OTel SDK 샘플링 + ClickHouse TTL로 자체 통제 `[확인됨]` | 유리 |
| **지리/디바이스 메타** | ✅ | Collector geoip processor + UA 파싱 `[확인됨]` | 낮음(파이프라인 구성 필요) |

**패턴이 뚜렷하다.** "디버깅형 RUM"(리플레이·CWV·에러·리소스·트레이스 상관)은 HyperDX가 OTel 네이티브라 대등하거나 우수하다. 반면 **분석·좌절신호·모바일**은 명확한 격차다. 좌절 신호는 초기 조사(문서 02)에서 `[미확인]`이었으나 후속 보강조사가 ClickStack 리플레이 UI에 rage/dead/error 필터 프리미티브가 전혀 없음을 확인해 `[확인됨: 부재]`로 마감했다 — 근거 없이 격상한 것이 아니라 조사 자체가 확정한 결과다.

## RUM을 4슬라이스로 분해한 판정표

위 매트릭스를 의사결정 단위로 압축하면 RUM은 4개 하위 능력이고, 각 판정이 다르다. Datadog 자신도 프로덕트 애널리틱스를 RUM에서 별도 제품(Product Analytics)으로 분리했다 `[확인됨]`.

판정 범례: 🟢 완전(SDK 교체로 즉시) · 🟡 부분(자작/보완) · 🔴 격차 큼(전용 툴 필요).

| 슬라이스 | 판정 | HyperDX 현황 | 대체법 | 배치 |
|---|:---:|---|---|:---:|
| **RUM-Core**<br>(세션 리플레이+CWV/에러+프론트↔백엔드 트레이스 상관) | 🟢 | rrweb 리플레이·트레이스 상관 네이티브, OTel-web으로 CWV/에러/리소스 수집 `[확인됨]` | `@hyperdx/browser` SDK 교체(dual-instrument→컷오버) | **Wave 1** |
| **RUM-Frustration**<br>(rage/dead/error click) | 🟡 | 네이티브 프리미티브 부재 `[확인됨: 부재]` | ClickHouse SQL 사후계산(`sequenceMatch`/`windowFunnel`) 우선, 실시간 필요 시 SDK 계측 | Wave 1.5 |
| **RUM-PA**<br>(퍼널/리텐션/Pathways) | 🔴 | 턴키 없음, 벤더 비교도 "product analytics에 lighter"로 명시 `[확인됨]` | ClickHouse `windowFunnel`/`retention`/`sequenceMatch` 자작, 턴키 필요 시 **PostHog**(CH 기반) 병행 | 별도 트랙 |
| **RUM-Mobile**<br>(iOS/Android/Flutter·모바일 리플레이) | 🔴 | RN 얇은 포크만(★4, signalfx 추종) `[확인됨]` | OTel-mobile(성능/에러/트레이스) + **Embrace 또는 OpenReplay**(모바일 세션 리플레이) | 별도 트랙 |
| **RUM(전체 합산)** | **🟡** | 코어는 강, 나머지 3개는 자작/전용툴 | 슬라이스별 상이 | 분할 이관 |

이 표가 "RUM 전체 🟢 완전"과 "RUM 격차 최대"라는 상반된 인상을 해소한다. **정확한 진술은 "RUM-Core는 🟢·Wave1이고, 나머지는 별도 트랙"** 이다. 비용·가치가 가장 큰 슬라이스(세션 단가 과금 대상)가 하필 🟢인 RUM-Core라, 웹 코어만 넘겨도 청구서 절감 효과는 가장 즉각적이다 `[확인됨]`.

**격차 슬라이스의 대체법은 확정돼 있다.** 좌절 신호는 Datadog 임계값(rage=1초 내 동일요소 3+클릭, dead=클릭 후 무반응, error=클릭±에러)을 ClickHouse `sequenceMatch`/`windowFunnel`로 규칙화 가능하고, 퍼널/리텐션도 `windowFunnel`/`retention`이 1급 집계함수로 내장돼 있다 `[확인됨]`. 즉 **이미 ClickHouse를 운영하는 전제**에서는 격차가 "불가능"이 아니라 "SQL 자작"으로 내려온다. 다만 모바일 세션 리플레이만은 OTel 표준에 아직 없어 순수 OTel로는 못 채우고 Embrace/OpenReplay 같은 전용 툴이 필요하다 `[확인됨]`.

### 🔴 슬라이스를 메우는 대체 경로 (모바일)

RUM-Mobile은 커버리지 판정상 가장 무거운 🔴이므로, "무엇으로 채우나"를 미리 확정해 둔다. HyperDX RN 포크에 의존하는 전략은 세우지 않는다. 세 경로가 있고 **모바일 세션 리플레이 필요 여부가 갈림길**이다 `[확인됨/추정]`.

| 축 | OTel-mobile 네이티브 | Embrace | OpenReplay |
|---|:---:|:---:|:---:|
| 라이선스/호스팅 | OSS, self-host Collector→CH | SDK OSS + 대시보드 SaaS/자체 | 완전 OSS self-host(CH 백엔드) |
| iOS/Android/Flutter/RN | Android 성숙·iOS 중·Flutter 커뮤니티 | 전부 | iOS/Android/RN |
| **모바일 세션 리플레이** | **✗ (표준에 없음)** | **O** | **O** |
| 성능/에러/트레이스 | O | O | O(+네트워크/콘솔) |
| OTLP→ClickHouse/HyperDX | O(네이티브) | O(OTLP export) | △(자체 CH, 직결 아님) |
| 권장 상황 | 리플레이 불필요·표준 최우선 | **모바일 리플레이 필수 + OTel 정합** | 완전 OSS·데이터주권 최우선 |

현실적 조합은 **"OTel-mobile로 성능/에러/트레이스를 ClickStack에 통합 + 모바일 세션 리플레이는 Embrace(OTLP 개방) 또는 OpenReplay로 보완"** 하이브리드다 `[추정]`. 프로덕트 애널리틱스 턴키가 별도로 필요하면 ClickHouse 기반 **PostHog**(퍼널/리텐션/경로 + 웹·모바일 리플레이)를 병행한다 `[확인됨]`. 어느 경로든 웹 RUM-Core보다 난이도·리스크가 높아 Wave 1과 반드시 분리한다.

## `@hyperdx/browser` 구현 실체

커버리지가 어디서 나오는지는 SDK 구현을 봐야 안다. `@hyperdx/browser`는 **Splunk `splunk-otel-js-web`(signalfx)에서 포크된 OTel 기반 브라우저 SDK** 로 추정되며, `@hyperdx/otel-web`(텔레메트리) + `@hyperdx/otel-web-session-recorder`(rrweb 세션 레코딩) 두 패키지에 의존한다 `[추정]`. 밑단은 OTel JS 웹 스택(`sdk-trace-web` + `instrumentation-fetch`/`xml-http-request`/`document-load`/`user-interaction`)이다.

```javascript
HyperDX.init({
  apiKey: 'INGESTION_API_KEY',
  service: 'my-frontend-app',
  tracePropagationTargets: [/api\.myapp\.domain/i], // 프론트↔백 트레이스 연결
  advancedNetworkCapture: true,   // 요청/응답 헤더·본문 전체 캡처 (default false)
  consoleCapture: true,           // 콘솔 로그 수집
  url: 'https://otel-collector.mydomain.com', // self-host Collector
  maskAllInputs: true,            // 리플레이 입력 마스킹
});
```

- **자동 수집**: 콘솔 로그, 세션 리플레이, XHR/Fetch/WebSocket, 예외/에러, PerformanceResourceTiming 기반 리소스 타이밍 `[확인됨]`. 기본 인테이크는 `https://in-otel.hyperdx.io`(OTLP HTTP), self-host는 `url` 옵션으로 자체 Collector 지정 `[확인됨]` — hyperdx-js `packages/browser/src/index.ts`의 `URL_BASE` 기본값을 `url` 인자로 오버라이드하는 방식으로 소스 코드 수준까지 검증됨 `[확인됨 3-0]`.
- **네트워크 캡처 범위**: 기본은 요청 메타만, `advancedNetworkCapture`를 켜면 **헤더·본문 전체**를 캡처한다. 런타임 토글(`enableAdvancedNetworkCapture()`/`disable...`)도 있다 `[확인됨]`.
- **세션 리플레이**: rrweb 기반 DOM 이벤트 레코딩(비디오가 아님)으로 DOM 변경·마우스·클릭·스크롤·키입력·콘솔 로그·XHR/Fetch/WebSocket·JS 예외를 캡처해 브라우저에서 재구성한다 `[확인됨, ClickHouse 공식 문서]`. ClickStack UI는 우측에 재구성 화면·좌측에 네트워크/콘솔/에러 타임라인을 표시한다. 특정 요청·에러를 클릭하면 **Trace 탭으로 이동해 백엔드 span·로그까지 추적**된다 `[확인됨]`. 모든 신호는 두 조인키로 상관된다 — **TraceId**(로그↔span), **rum.sessionId**(브라우저 세션↔서버 트레이스) `[확인됨]`. 이 replay→trace→log 조인이 대부분의 OSS 경쟁자가 못 따라오는 시그니처 강점이다.
- **커스텀 액션/속성 API**: `HyperDX.setGlobalAttributes({ userId, ... })`, `HyperDX.addAction('Form-Completed', { formId })`, `HyperDX.attachToReactErrorBoundary(ErrorBoundary)` `[확인됨]`. Datadog의 `addAction`/글로벌 컨텍스트에 대응하므로 커스텀 액션 계측은 이식 가능하다.

핵심은 **RUM 대체가 프록시 변환이 아니라 SDK 교체라는 점**이다 — dd browser-sdk를 걷어내고 이 `init`으로 갈아끼운다. `datadogreceiver`는 브라우저 RUM intake(`/api/v2/rum`)를 아예 수신하지 않으므로 프록시 경로는 RUM에 부적합하다. 이 판단의 근거와 dd browser-sdk `proxy` 옵션의 과도기 활용법은 [dd 프록시 매핑]({{< relref "03-dd-proxy-mapping.md" >}})에서 다룬다.

## 리스크 — 웹 RUM 대체 프로덕션 전례가 없다

기술 커버리지가 높다는 것과 검증된 전환 사례가 있다는 것은 별개다. **"Datadog RUM을 HyperDX로 대체한 공개 프로덕션 사례"는 반복 조사에서도 찾지 못했다 `[미확인]`.** 근접 사례는 전부 RUM 대체가 아니다.

| 사례 | 무엇인가 | RUM 대체인가 |
|---|---|:---:|
| Evereve | Datadog → **OpenObserve** 전환 | ✗ (HyperDX 아님, RUM 상세 불명) |
| Character.AI / Anthropic | ClickStack/ClickHouse 관측성(로그·트레이스) | ✗ (RUM 아님) |
| HN 후기 | "프로덕션에서 HyperDX 잘 쓴다" | ✗ (RUM 특정 아님) |

전례가 없는 이유는 구조적이다. ClickStack/HyperDX RUM 자체가 신생(HyperDX 인수 2025-03, ClickStack 출시 2025-05)이라 사례가 축적될 시간이 부족했고, HyperDX RUM이 디버깅형에 강하고 PA·모바일이 얕아 **"Datadog RUM 풀 대체 완료"라는 서사가 나오기 어려운 구조**다 `[추정]`.

{{< callout type="important" >}}
**의사결정 함의**: Wave 1(RUM-Core) 리스크를 "낮음"으로만 표기하면 위험하다. **기술 대등성(높음) ↔ 검증된 전례(없음)를 분리 표기**하고, 대표 웹 페이지에 `@hyperdx/browser`를 **dual-instrument**로 병행 배포해 세션 리플레이·CWV·에러·트레이스 상관을 Datadog과 나란히 검증하는 **자체 PoC 성공을 Wave 1 진입 게이트로 명문화**한다 `[미확인 → PoC로 마감]`. 단계별 실행은 [마이그레이션 로드맵]({{< relref "05-migration-roadmap.md" >}}) 참조.
{{< /callout >}}

## 우리 케이스에서는

**전제 차이를 먼저 못 박는다.** [로깅 챕터]({{< relref "../logging/_index.md" >}})는 **로그 내재화 단독** 관점이라 로그는 [VictoriaLogs]({{< relref "../logging/03-victorialogs.md" >}})로 가고 통합 저장소(D4)는 "earn it last"로 미뤄뒀다. 이 조사는 거기에 세 전제를 더한다 — (1) 목표가 **Datadog RUM 대체**, (2) 관측성 밖 **범용 분석용 ClickHouse를 어차피 운영**, (3) **운영 인력 보유**. 이 전제 위에서만 아래 커버리지 판정이 착수 순서로 성립하며, 로깅 챕터의 결정(로그=VictoriaLogs, 통합 저장소=최후)과는 승격이 아니라 전제 차이로 양립한다.

- **RUM은 SDK 교체(`@hyperdx/browser`)로 간다.** 프록시 변환이 아니다. 웹 RUM-Core(세션 리플레이·CWV·에러·프론트↔백엔드 상관)는 🟢로 즉시 넘어오고, 이 슬라이스가 세션 단가 과금을 회피시켜 절감이 가장 즉각적이다.
- **RUM을 하나로 취급하지 않는다.** 좌절 신호는 이미 운영할 ClickHouse에서 SQL 사후계산(Wave 1.5), 퍼널/리텐션은 `windowFunnel`/`retention` 자작 또는 PostHog 병행(별도 트랙)으로 분리한다. HyperDX 하나로 다 되기를 기대하지 않는다.
- **모바일은 넘기지 않는다 — [RUM 내재화 결론]({{< relref "_index.md" >}})의 "웹 YES / 모바일 NO"와 정합.** HyperDX 모바일은 RN 얇은 포크뿐이고 네이티브 리플레이가 없어, 모바일은 Datadog 잔류가 현실적이다. 착수 전 Datadog RUM usage를 **웹/모바일로 분해**해 모바일 비중부터 측정한다 — 모바일이 과반이면 웹 전용 HyperDX는 청구서를 별로 못 줄이면서 관리 스택만 늘린다.
- **전례 부재를 리스크로 명시한다.** RUM 대체는 공개 프로덕션 레퍼런스가 없는 개척 경로다. dual-instrument PoC 성공을 Wave 1 진입의 필수 게이트로 삼는다.

> 근거 등급은 조사 문서의 판정을 승계하며 임의 승격하지 않는다(좌절신호·모바일 리플레이의 `[확인됨: 부재]`는 후속 보강조사가 확정한 것이다). 시점 기준 조사 2026-07.
