---
title: "Datadog 프로토콜 프록시 매핑"
weight: 3
---

# Datadog 프로토콜 프록시 매핑 — 어디까지 성립하나

"dd agent/dd-trace 오픈소스 코드를 참조해 Datadog 인테이크 트래픽을 그대로 받아 HyperDX/ClickHouse로 변환하는 프록시 계층"을 직접 만들 수 있는지 검증한다. 결론부터: **프록시는 Agent intake(로그·인프라 메트릭·APM 트레이스)에서만 성립하고, 브라우저 RUM·세션 리플레이 intake에는 성립하지 않는다.** RUM은 프록시가 아니라 SDK 교체가 정답이다([Datadog RUM 커버리지]({{< relref "02-datadog-rum-coverage.md" >}})). 그리고 로그/메트릭/APM에서 성립하는 프록시조차 **과도기 무중단 브릿지**로만 합당하고 영구 아키텍처로는 부적합하다 — 성숙도(alpha), 변환 CPU 세금, 프로덕션 전례 부재 때문이다.

## 핵심 판정 — 성립 영역과 불성립 영역

| 신호 | 프록시 성립? | 근거 | 기성 수신부 |
|---|:---:|---|---|
| **로그** (`/api/v2/logs`) | ✅ | datadogreceiver·Vector 모두 수신·변환 경로 있음 `[확인됨]` | datadogreceiver(logs), Vector `datadog_agent`(logs GA) |
| **인프라/커스텀 메트릭** (`/api/v1,v2/series`, sketches, `/intake`) | ✅ (주의) | 수신은 되나 temporality(delta↔cumulative)·sketch 매핑에 검증 부담 `[확인됨]` | datadogreceiver(metrics, alpha) |
| **APM 트레이스** (`/v0.3~/v0.7/traces`) | ✅ (alpha) | msgpack 디코드 + 128-bit trace ID 재구성 필요, 성숙도 alpha `[확인됨]` | datadogreceiver(traces, alpha) |
| **브라우저 RUM** (`/api/v2/rum`) | ❌ | datadogreceiver·Vector 모두 **수신 대상 아님**, RUM→OTLP 공개 변환기 부재 `[확인됨]` | 없음 |
| **세션 리플레이** (별도 세그먼트 경로) | ❌ | 별도 바이너리 세그먼트 포맷, 프록시 경유 시 대시보드 로딩 실패 사례 `[확인됨]` | 없음 |

핵심은 `datadogreceiver`가 구현하는 엔드포인트 목록이 곧 프록시 성립 범위라는 점이다. 이 목록은 전부 **Datadog Agent가 보내는 인테이크**(트레이스/메트릭/로그)이고, **브라우저 SDK가 보내는 `/api/v2/rum`은 아예 빠져 있다** `[확인됨]`. 브라우저 RUM을 재활용하려면 NDJSON 디코더와 RUM→OTel 트랜슬레이터를 직접 써야 하는데, 이를 대신해 줄 공개 오픈소스는 조사 범위 내에 없다 `[확인됨]`.

APM 트레이스에 프록시가 거론되는 이유도 짚어 둔다. dd-trace는 `DD_TRACE_OTEL_ENABLED`로 OTel API를 받아들여도 **트레이스는 Datadog MsgPack 포맷으로만 뱉고 OTLP를 내보내지 않는다**(Agent 전용). metrics/logs는 `DD_METRICS_OTEL_ENABLED`/`DD_LOGS_OTEL_ENABLED`로 OTLP 전송이 가능하지만 traces는 불가다 `[확인됨]`. 그래서 레거시 dd-trace 트레이스를 HyperDX로 보내려면 ① datadogreceiver로 dd 프로토콜을 수신·변환하거나 ② OTel SDK로 **재계측**하는 두 갈래뿐이고, 프록시는 재계측 전까지의 다리 역할에 국한된다.

한 가지 더: "성립"은 프로토콜 수신이 가능하다는 뜻이지 운영이 공짜라는 뜻이 아니다. "dd 프로토콜을 안정적으로 받는" 수신 자체는 Vector·Cribl·Bindplane 같은 상용/OSS 파이프라인이 이미 대규모로 productize했으므로 수신 리스크는 낮다 `[확인됨]`. 남는 리스크는 (a) 그 뒤 **ClickHouse/HyperDX 스키마로의 변환**과 (b) 그 조합을 **누구도 프로덕션에서 검증하지 않았다**는 두 지점에 집중된다.

## 기성 수신부 비교 — datadogreceiver vs Vector datadog_agent

### OTel Collector Contrib `datadogreceiver` (시그널별 성숙도)

Datadog Agent intake API를 OTel 모델로 번역하는 리시버. 다만 **컴포넌트 스테이터스가 세 신호 모두 alpha**이고 contrib 배포판 한정이다 `[확인됨]`.

| 시그널 | 컴포넌트 스테이터스 | 엔드포인트 성숙도 | 주의점 |
|---|:---:|:---:|---|
| traces | alpha | Alpha | msgpack, `_dd.p.tid` 128-bit 재구성(LRU 캐시), RUM/APM stats 미포함 |
| metrics | alpha | Development | delta↔cumulative 변환 processor 필요, sketches/distribution 매핑 미성숙 |
| logs | alpha | Development | `logs.decode_json_message` 기본 true |

- 배포판은 `contrib` 한정 — Datadog 공식(DDOT)·core 배포판에 미포함이라 커스텀 빌드/contrib 이미지를 별도 운영해야 한다 `[확인됨]`.
- 활성 메인테이너가 2명(boostchicken, MovieStoreGuy)이고 contrib는 대략 격주 릴리스라 alpha 시그니처가 자주 움직인다 — 버스 팩터·회귀 리스크를 감안해야 한다 `[확인됨]`.
- 하류 `clickhouseexporter`도 traces/logs=beta, metrics=alpha라 **수신→변환→export 파이프라인 전 구간이 alpha~beta**다 `[확인됨]`.

### Vector `datadog_agent` source

Datadog이 직접 유지보수하는 OSS. Agent가 보낸 트래픽을 HTTP로 수신한다.

| 시그널 | 지원 | ClickHouse로 전달 가능? |
|---|:---:|---|
| logs | GA | ✅ Vector `clickhouse` sink(로그만 지원) |
| metrics | beta | ❌ `clickhouse` sink가 로그만 받음 |
| traces | alpha | ❌ `clickhouse` sink 미지원, Kafka sink도 트레이스 미통과 |

- **결정적 갭**: Vector `clickhouse` sink는 로그만 받는다. 따라서 Vector로 실현 가능한 것은 **"dd-agent 로그 → ClickHouse"** 뿐이고, traces/metrics를 ClickHouse로 보내려면 Vector가 아니라 datadogreceiver(OTel) 경로여야 한다 `[확인됨]`.
- **버전 함정**: Agent 7.62+가 쓰는 zstd 압축 인테이크를 받으려면 **Vector 0.40.2 이상**이 필요하다 `[확인됨]`. 이 버전 정합을 놓치면 최신 Agent 트래픽을 수신하지 못한다.

## dd browser SDK의 `proxy` 옵션 — 변환용이 아니다

Datadog browser-sdk에는 인테이크 트래픽을 자체 엔드포인트로 우회하는 공식 `proxy` 파라미터가 있다. 이 옵션의 존재가 "프록시 매핑이 쉽다"는 착시를 준다 — 실체는 다르다 `[확인됨]`.

- **원래 용도**는 광고차단기 회피·IP 마스킹·규정 준수를 위해 "Datadog으로 보내되 자체 서버를 경유"하는 것이다. 문자열 형태(`ddforward` 쿼리 자동 부착)와 함수 형태(SDK v5.4.0+, `path`/`parameters`/`subdomain` 수신)가 있다.
- **본문 불변이 설계 전제**다. 프록시 요구사항이 명시적으로 "POST로 포워딩, **본문 변경 금지**(바이너리 그대로), `X-Forwarded-For`로 클라이언트 IP 전달, 민감 헤더 제거"를 요구한다 `[확인됨]`. 즉 SDK는 프록시가 본문(RUM 이벤트)을 **해석·변환하지 않는다**고 가정한다.
- **인테이크 포맷**은 경로 `/api/v2/rum`, 쿼리 `ddsource=browser`, 본문은 **NDJSON(줄바꿈 구분 JSON) + 조건부 압축(deflate/zstd)**이다. 각 라인은 `DataDog/rum-events-format` 스키마의 view/action/resource/error/long_task/session 이벤트다(정확한 배치 인코딩은 브라우저 내부 로직) `[확인됨/일부 추정]`.
- **세션 리플레이**는 별도 경로(멀티파트/세그먼트)이고, 프록시 경유 시 리플레이가 대시보드에서 로드 실패하는 알려진 이슈가 있다 `[확인됨]`.

> 함의: `proxy` 옵션은 트래픽을 자체 게이트웨이로 **가로채는 진입점**으로는 완벽하나, 그 뒤 본문을 파싱·변환하는 로직은 전부 자작이어야 한다. 따라서 이 옵션의 올바른 쓰임새는 변환이 아니라 **과도기 트래픽 통제 — 듀얼 라이트/미러링/차단**이다. 신규 데이터는 `@hyperdx/browser`로 직접 수집하는 편이 옳다.

## 직접 구현 시 참조 코드 경로

사용자 전제("dd agent/trace 오픈소스 참조")대로 자작한다면 참조할 파일 경로다. 라이선스는 우호적이다 — datadog-agent user-space·browser-sdk는 Apache-2.0, dd-trace-js/rb/go는 Apache-2.0/BSD-3 듀얼이라 **참조·부분 파생·상업 이용이 합법**이다(BPF/system-probe 코드만 GPL-2.0 주의) `[확인됨]`. datadogreceiver 자체가 이미 dd 인테이크를 리버스 구현한 Apache-2.0 코드라 "참조 파생"의 선례가 존재한다.

| 레포 | 경로 | 역할 |
|---|---|---|
| **DataDog/browser-sdk** | `packages/js-core/src/transport/endpointBuilder.ts` (구현) | 인테이크 URL 빌더(`ddforward`·origin·path 조립). **구버전 단일 `packages/core/` 경로는 죽은 경로** — 레포가 `browser-core`/`js-core`로 분리됨 |
| 〃 | `packages/browser-core/src/domain/configuration/endpointBuilder.spec.ts` | 위 빌더의 스펙 |
| 〃 | `packages/js-core/src/transport/` | HttpRequest·Batch·flush, NDJSON 직렬화·압축·`proxy` 적용 지점 |
| **DataDog/rum-events-format** | `schemas/` (browser/mobile), `lib/` | RUM 이벤트 스키마 소스 오브 트루스(`yarn generate`) |
| **DataDog/datadog-agent** | `pkg/trace/api/api.go`, `endpoints.go` | APM trace 인테이크 핸들러(v0.1~v0.7 등록), msgpack/JSON 디코드 |
| 〃 | `comp/otelcol/` | Agent 내장 OTel Collector(DDOT) 컴포넌트 |
| **otel-collector-contrib** | `receiver/datadogreceiver/receiver.go` + translator 서브패키지 | dd payload→pdata 변환 참조 구현. **RUM 변환 코드는 없음** — RUM 매핑은 신규 작성 |
| **hyperdxio/hyperdx-js** | `@hyperdx/browser`, `@hyperdx/otel-web`, `@hyperdx/otel-web-session-recorder` | 대체 SDK. 기본 인테이크 `https://in-otel.hyperdx.io`(OTLP HTTP), self-host는 `url` 옵션 |

RUM 프록시를 자작할 경우 설계는 **수신(proxy 함수로 `/api/v2/rum` 유도 → 압축 해제 → NDJSON 분해) → 파싱(rum-events-format 검증) → 매핑(View/Action/Resource→spans, Error→log record) → export(OTLP)**가 된다. 세션 리플레이는 rrweb 스키마 재직렬화가 필요해 난이도가 높고, 초기엔 제외하는 것이 현실적이다 `[추정]`. 정리하면 datadogreceiver의 traces/logs translator를 모범 사례로 참조하되, **RUM NDJSON→OTel 매핑과 리플레이 재직렬화는 전부 신규 개발**이다.

## 변환 비용의 현실

프록시가 "원리적으로 가능"과 "실제로 채택할 만함" 사이에 있는 간극이 여기 있다.

### 변환 CPU 세금

dd 프록시 전용 처리량/CPU/손실률 벤치마크는 공개된 것이 없다 `[확인됨]`. 대리 지표로 변환 계층의 CPU 비용을 가늠하면:

| 경로 | 코어당 처리량 | 성격 |
|---|---|---|
| 최소 처리 OTel gateway (필드 rename만) | ~20,000 events/s/core | 가벼운 변환 `[벤치]` |
| 풀 파이프라인, 대규모 무손실 | ~2,500 rows/s/core | 무거운 변환 `[벤치]` |
| 대조군: native CH→CH (SysEx, byte-copy) | ~528,000 logs/s/core | 재직렬화 0 `[벤치]` |

- 파싱·마샬링·포맷 변환을 수반하는 OTel 경로(~2,500/core)는 재직렬화 없는 native 경로(~528k/core) 대비 **최대 약 200배 CPU**를 쓴다 `[추정]`. dd 프록시는 여기에 (a) zstd 해제, (b) msgpack 디코드, (c) 128-bit trace ID 재구성, (d) temporality 변환을 더 얹으므로 **가장 무거운 쪽**에 위치할 것으로 추정된다 `[추정]`.
- Rotel 벤치도 같은 방향을 보인다: 표준 OTel Collector 137.5k spans/s/core vs Rust 기반 Rotel 462.5k spans/s/core(~3.4배) — 개선분의 상당량이 "JSON 문자열 직렬화→바이너리 인코딩" 전환에서 나왔다 `[벤치]`. 즉 "(역)직렬화 + 포맷 변환"이 파이프라인 CPU의 큰 몫이고, dd 프록시는 거기에 추가 디코드 단계를 더한다.

### fidelity 결함 — "붙이면 무손실"이 아니다

- 고카디널리티 **delta Sum 메트릭에서 native Agent 대비 30~70% 데이터 손실**이 보고됐다(COUNT interval=0 vs RATE 처리 차이, contrib #44907). dd↔OTel 메트릭 모델(temporality/type) 불일치가 실데이터 손실로 이어진 실증이다 `[확인됨]`.
- datadogreceiver가 `span.Resource`를 드롭해 dd-java-agent의 **`db.statement`가 조용히 사라진 버그**도 있었다(#23150, 이후 수정). 트레이스 속성 매핑이 신호/SDK 언어별로 깨질 수 있음을 보여준다 `[확인됨]`.
- 결론: 변환은 신호·속성·SDK 언어·메트릭 타입별로 정합성을 **개별 검증**해야 하는 fragile한 계층이다. dual-write 후 속성 단위 diff 검증이 필수다.

### 프로덕션 전례 부재

"Datadog Agent/dd-trace 인테이크를 받아 ClickHouse/HyperDX로 변환해 프로덕션 관측성을 운영한다"는 **회사명이 붙은 1차 사례를 능동 검색에도 찾지 못했다** `[확인됨]`. ClickHouse 공식 마이그레이션 자료는 하나같이 "dual-write → OTel 재계측 → 단계적 컷오버"를 권하고, dd 프로토콜 프록시 재활용을 권하는 공식 문서는 없다. HN의 "Datadog 탈출" 담론에서도 사람들은 프록시가 아니라 스택 교체(OTel 재계측 + VictoriaMetrics/ClickHouse)를 택했고 프록시는 언급조차 없다 `[확인됨]`. 가장 근접한 공식 선례인 ClickHouse↔Datadog 파트너십(2026-06)조차 (a) 로그 전용, (b) Preview, (c) 유료 Datadog Observability Pipelines 경유라 "오픈소스 dd-agent를 직접 리버스하는 자체 프록시"와는 다른 경로다 `[확인됨]`.

### 통합 현실 — ClickStack에 붙이는 비용

프록시가 성립하는 영역이라도 ClickStack에 물리는 방식이 매끄럽지 않다. HyperDX/ClickStack은 자체 opinionated OTel Collector와 스키마를 쓰므로, datadogreceiver를 붙이려면 **(a) ClickStack collector에 커스텀 빌드로 datadogreceiver를 합치거나(빌드 복잡도↑), (b) 별도 collector에서 수신·변환 후 OTLP로 ClickStack collector에 재전송하는 2-hop 구성**이 된다. 추가 홉은 곧 추가 변환·지연·장애 지점이다 `[추정]`. 즉 "성립"과 "운영 부담 없음"은 별개다.

### 더 안전한 대안

같은 목적(로그를 ClickHouse로)을 자작 프록시 없이 달성하는 검증된 경로가 이미 있다. 로그는 Vector `datadog_agent`→`clickhouse` sink(로그 GA)나 Datadog Observability Pipelines의 native ClickHouse destination(공식·Preview)이 프록시 자작보다 검증돼 있고, 메트릭은 Prometheus/OTLP 재계측, 트레이스는 OTel SDK 재계측이 alpha 프록시보다 안정적이다 `[확인됨]`. 단계별 순서는 [마이그레이션 로드맵]({{< relref "05-migration-roadmap.md" >}})을 따른다.

## 결론

- **프록시가 성립하는 유일한 쓸모는 로그/인프라 메트릭/(레거시) APM 트레이스의 과도기 무중단 브릿지**다. dd-agent를 즉시 못 걷어내는 상황에서 백엔드만 ClickHouse로 우회해 단기 비용을 줄이는 용도에 한정된다.
- **RUM은 프록시로 성립하지 않는다.** browser intake 미수신 + 공개 변환기 부재 + 본문 불변 전제 + 리플레이 세그먼트 난이도가 겹쳐, 정답은 `@hyperdx/browser`로의 **SDK 교체**다([Datadog RUM 커버리지]({{< relref "02-datadog-rum-coverage.md" >}})). dd browser-sdk의 `proxy` 옵션은 변환용이 아니라 듀얼 라이트/차단 같은 과도기 트래픽 통제용으로만 쓴다.
- **영구 아키텍처로는 비권장**이다. 파이프라인 전 구간 alpha~beta, native 대비 최대 ~200배 CPU 세금, delta metric fidelity 결함, 그리고 프로덕션 전례 부재 — 규모 결정 전 반드시 자체 PoC 벤치마크로 events/s/core·p99 지연·신호별 손실률을 측정하라.

## 우리 케이스에서는

전제부터 구분한다. 이 페이지의 조사는 **RUM 대체 + 범용 분석 + 운영 인력 보유**를 전제로 프록시의 성립 여부를 따진 것이다. 반면 우리 [로깅 챕터]({{< relref "../logging/08-recommendation.md" >}})의 결정은 **로그 내재화 관점**에서 나왔다 — 로그는 [VictoriaLogs]({{< relref "../logging/03-victorialogs.md" >}})로 가고(D1·D2), ClickHouse/ClickStack 통합 저장소는 "여러 신호를 한 팀에 수렴"할 명분이 섰을 때 얹는 **earn-it-last 과제(D4, 메트릭 제외)**다. 두 전제는 프록시에 관해 서로 모순되지 않는다.

- **로그**: 프록시의 최대 실익 영역이지만, 우리 로그는 애초에 ClickHouse가 아니라 VictoriaLogs로 간다. 따라서 "dd→CH 로그 프록시"는 우리 로그 경로에 **필요 자체가 없다**. OpenSearch 은퇴(D2)도 Collector 재구성으로 처리하지 dd 프록시를 경유하지 않는다.
- **RUM(D3)**: 웹은 ClickStack PoC, 모바일은 Datadog 잔류가 로깅 챕터의 결정이다. 이 페이지 판정과 정확히 일치한다 — **웹 RUM은 프록시 불가이므로 SDK 교체(PoC)로 가고**, 프록시는 검토 대상조차 아니다.
- **선택적 통합(D4)**: traces+RUM 통합이 우선순위가 될 때만 ClickStack을 얹는다. 그 시점에도 RUM은 SDK 경로, traces는 OTel 재계측이 정석이라, 프록시가 붙을 자리는 **레거시 dd-trace 트레이스를 재계측 전까지 잇는 단기 브릿지**로 극히 좁다. 메트릭은 D4에서 제외되므로 metrics 프록시의 temporality 리스크도 우리 결정에는 무관하다.

정리하면, 우리 케이스에서 dd 프록시는 로그(경로 다름)·RUM(SDK 교체)·메트릭(범위 밖) 어디에도 필요하지 않고, 유일하게 고려될 수 있는 곳은 D4 이후 레거시 트레이스의 과도기 다리뿐이다. 그마저도 alpha 성숙도와 CPU 세금을 고려하면 **재계측을 앞당기는 편이 낫다**. 프록시는 우리 로드맵의 주경로가 아니라 최후의 임시 수단으로만 남긴다.
