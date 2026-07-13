---
title: "Datadog 전 제품군 대체 매트릭스"
weight: 4
---

# Datadog 전 제품군 대체 매트릭스 — RUM 너머로 확장하기

RUM 하나만 빼오는 것으로는 Datadog 청구서가 크게 줄지 않는다. RUM은 진입점이고, 실제 절감은 로그·트레이스·메트릭 "스토리지"를 옮길 때 나온다. 이 페이지는 웹 RUM 내재화([RUM 대체 커버리지]({{< relref "02-datadog-rum-coverage.md" >}}))를 넘어 **Datadog 전 제품군을 어디까지, 무엇으로 대체하는가**를 의사결정 관점에서 큐레이션한다.

결론부터: HyperDX/ClickStack은 Datadog의 **MELT+세션리플레이 코어(Logs·Traces·RUM 웹코어·Session Replay)** 를 단일 ClickHouse 백엔드에서 커버한다 `[확인됨]`. 나머지 절반(Security·Synthetics·NPM/NDM·DBM·Profiler·CI·On-Call·Data Streams)은 ClickStack 범위 밖이라 전용 OSS로 개별 이관하거나 Datadog에 잔류시킨다 `[확인됨]`. 그리고 **메트릭 계층은 HyperDX가 아니라 VictoriaMetrics+Grafana로 분리**하는 것이 이관 실현성을 회복시키는 핵심 판단이다.

## 3분류 대체 매트릭스

판정 범례: 🟢 즉시 대체 가능 · 🟡 조건부 대체(운영·기능 갭) · 🔴 당분간 Datadog 유지 또는 전용 OSS 개별 이관.

"대안이 ClickHouse 백엔드?" 컬럼은 그 대안이 우리가 어차피 운영할 ClickHouse에 지표·이벤트를 흡수시킬 수 있는지를 뜻한다 — 스택 수렴 여부를 가르는 축이다.

| 분류 | Datadog 제품 | 대체 수단 | 대안이 ClickHouse 백엔드? | 근거·단서 |
|:---:|---|---|:---:|---|
| 🟢 즉시 | **Log Management** | ClickStack / ClickHouse | 예 (CH 네이티브) | 최대 절감 영역 `[확인됨]`, 계측 교체 거의 불필요 `[추정]` |
| 🟢 즉시 | **APM / 분산 트레이싱** | OTel SDK 재계측 + ClickStack (과도기 `datadogreceiver`) | 예 (CH) | dd-trace↔OTel 개념 1:1, 점진 전환 `[확인됨]` |
| 🟢 즉시 | **RUM 웹코어 / Session Replay** | `@hyperdx/browser` SDK 교체 | 예 (HyperDX=CH) | 세션 단가 과금 회피, 공개 전례 부재 → PoC 게이트 필수 `[확인됨]`(대등성) / `[미확인]`(전례) |
| 🟡 조건부 | **Metrics (Infra)** | **VictoriaMetrics/Prometheus + Grafana** (HyperDX 아님) | 아니오 (VM=자체 TSDB) | PromQL 미지원·변환기 부재가 결정, 아래 절 참조 `[확인됨]` |
| 🟡 조건부 | **Serverless** | OTel Lambda layer → ClickStack, cold start는 CloudWatch 병행 | 예 | dd Lambda extension 제거·OTel layer 도입 `[추정]` |
| 🟡 조건부 | **Error Tracking** | GlitchTip(드롭인) 또는 SigNoz Exceptions | SigNoz=예, GlitchTip=아니오(PG) | GlitchTip은 DSN만 교체(코드 무변경) `[확인됨]` |
| 🟡 조건부 | **LLM Observability** | **Langfuse**(ClickHouse 소속) / OpenLLMetry / Arize Phoenix | 예 | CH 운영 시 자연 시너지 `[확인됨]` |
| 🟡 조건부 | **Watchdog (AI 이상탐지)** | ClickStack Event Deltas + Coroot/SigNoz 조합 | Coroot/SigNoz=예 | 전스택 자동 상관 단일 OSS는 부재, 조합으로 근접 `[확인됨/미확인 혼재]` |
| 🔴 유지/전용 | **Synthetics** | Checkly(Playwright) 또는 k8s CronJob+Playwright | 부분 (결과 지표 CH 라우팅) | 지리 분산 프로빙은 상용이 유리 `[추정]` |
| 🔴 유지/전용 | **Continuous Profiler** | Grafana Pyroscope 2.0 / Parca | 아니오 (자체 TSDB형) | 프로파일은 별도 스택으로 두는 게 현실적 `[확인됨]` |
| 🔴 유지/전용 | **NPM / NDM** | Kentik(상용) / Coroot(eBPF) / Akvorado / SNMP exporter | Coroot=예, Akvorado=예(CH) | 가장 어려운 영역, Datadog 병행 무난 `[추정]` |
| 🔴 유지/전용 | **DBM** | Percona PMM / pg_stat_statements+Grafana / Coroot | Coroot=예, PMM=아니오(VM) | 쿼리 샘플·실행계획 재현은 전용 툴 조합 `[추정/확인 혼재]` |
| 🔴 유지/전용 | **Security (SIEM/CSM/ASM)** | Wazuh / Falco / Trivy / OWASP ZAP (별도 트랙) | 대부분 아니오 (ES/OpenSearch/자체) | 규제·컴플라이언스 크면 Datadog 잔류 `[확인됨/추정]` |
| 🔴 유지/전용 | **CI Visibility** | OTel CI/CD Observability(GitHub/GitLab receiver) + SigNoz | 예 (OTel→CH) | 플레이키 탐지 수준은 Datadog이 앞섬 `[추정]` |
| 🔴 유지/전용 | **Incident / On-Call** | Keep / GoAlert / OneUptime / incident.io(상용) | 아니오 (운영 DB) | **Grafana OnCall OSS는 2026-03-24 아카이브 예정 → 신규 채택 금지** `[확인됨]` |
| 🔴 유지/전용 | **Data Streams / Data Jobs** | Kpow / KMinion / Coroot / Spark·Flink OTel | 부분 (지표 CH 라우팅) | end-to-end 큐 의존성 자동 매핑 재현 어려움 `[추정]` |

> 🔴는 "대체 불가"가 아니라 "ClickStack 코어 범위 밖"이라는 뜻이다. 각 행의 전용 OSS로 대부분 대체되며, 상당수는 지표·이벤트를 ClickHouse로 흘려보낼 수 있다.

주의 하나: **Grafana OnCall OSS는 2025-03 유지보수 모드 → 2026-03-24 아카이브 예정**이므로 On-Call 대안으로 신규 채택하지 않는다 `[확인됨]`. Keep·GoAlert·OneUptime 같은 유지되는 프로젝트나 상용(incident.io)으로 간다.

## 이관의 지렛대 — datadogreceiver 프록시 매핑

서버사이드 🟢 항목(Logs·APM·서버 Metrics)을 옮길 때 결정적 지렛대가 OpenTelemetry Collector의 `datadogreceiver`다. dd-agent/dd-trace가 보내는 traces·metrics·logs를 그대로 수신해 OTLP로 변환, ClickHouse/HyperDX로 export한다 `[확인됨]`. 즉 애플리케이션 계측을 즉시 걷어내지 않고 **백엔드부터 갈아끼우는 무중단 전환**이 성립한다. 128-bit trace ID 재구성(기본 on)으로 dd-instrumented 서비스와 OTel 스팬이 같은 트레이스에서 상관된다 `[확인됨]`.

단 두 가지 한계를 명확히 한다.

- **브라우저 RUM·세션 리플레이 intake는 수신 대상이 아니다** `[확인됨]`. 프록시가 유효한 영역은 로그·인프라 메트릭·APM 트레이스에 한정되고, **RUM은 프록시가 아니라 `@hyperdx/browser` SDK 교체**가 정답이다. dd browser-sdk의 `proxy` 옵션은 변환용이 아니라 과도기 트래픽 통제용일 뿐이다.
- **프록시는 다리이지 종착지가 아니다** `[확인됨]`. `datadogreceiver`는 alpha, 변환기의 CPU 오버헤드가 native 대비 크고 신호·속성별 fidelity 결함이 보고된다 `[확인됨]`. 규모 결정 전 자체 벤치와 속성 단위 diff 검증이 전제이며, 장기적으로는 네이티브 OTel 계측으로 이전한다.

따라서 프록시는 로그·메트릭의 **단기 무중단 브릿지**로만 쓰고, traces는 OTel 재계측, RUM은 SDK 교체로 간다.

## 메트릭 계층은 HyperDX가 아니다 — VictoriaMetrics+Grafana+Sloth/Pyrra로 분리

전 제품군 이관에서 가장 흔한 실수가 "ClickHouse로 다 합치자"며 **메트릭·대시보드·모니터·SLO까지 HyperDX로 미는 것**이다. 이건 이관 비용을 비현실적으로 부풀린다. 메트릭 계층은 반드시 [VictoriaMetrics 스택]({{< relref "../monitoring/victoriametrics/_index.md" >}})으로 분리 존치한다. 근거 세 가지.

- **PromQL이 없다.** HyperDX 메트릭 대시보드·알림은 ClickHouse SQL + Lucene로 작성하고 PromQL은 로드맵이다 `[확인됨]`. 수백 개 레거시 Datadog monitor를 그대로 옮길 언어 기반이 애초에 다르다.
- **변환기 생태계가 PromQL/Grafana 타겟에만 존재한다.** Chronosphere·groundcover는 Datadog Query Language → PromQL **AST 결정론적 변환기**(약 90% 자동, 마지막 10% 수작업)를 갖췄고, 대시보드 스키마 변환기(graang, 구조 ~87%)도 Grafana를 향한다 `[확인됨]`. 반면 **ClickHouse SQL 타겟 변환기는 조사 시점 어떤 벤더도 내놓지 않았다** — 가장 근접한 SigNoz의 LLM 기반 도구조차 SigNoz 전용이고 HyperDX엔 대응물이 없다 `[확인됨/추정]`. HyperDX로 메트릭을 몰면 "SQL로 하나씩 수작업 재구축" 경로가 된다.
- **무계측 dual-ship이 VM에서만 자연스럽다.** VictoriaMetrics는 Datadog agent / DogStatsD를 네이티브로 수신(`/datadog/api/v2/series`)하고, `DD_ADDITIONAL_ENDPOINTS`로 Datadog과 VM에 **동시 전송(dual-ship)** → 병행 검증 후 컷오버가 가능하다 `[확인됨]`. 계측을 안 건드리고 백엔드만 갈아끼운다.

여기에 알림·SLO 성숙도도 VM 축이 앞선다. Grafana Alerting은 mute timing/silence/notification policy로 Datadog monitor에 근접하고, SLO는 **Sloth/Pyrra**(Prometheus recording rule + multiwindow-multiburn)로 표준 이관 경로가 있다 `[확인됨]`. HyperDX/ClickStack 알림은 OSS 자체호스팅에서도 동작하고 `GROUP BY`별 발화·SQL 기반 이상탐지까지 되지만, Alertmanager식 grouping/inhibition/silencing과 네이티브 SLO는 미달·부재다 `[확인됨]`. (이 알림 성숙도는 2025-11 OSS 패리티·2026-05 SQL 기반 이상탐지 반영 시점 기준 — [로깅 챕터]({{< relref "../logging/05-hyperdx-clickstack.md" >}})의 "알림은 rule당 단일 임계값, anomaly detection 없음" 서술은 그 이전 스냅샷이라 상충처럼 보이나 동일 제품의 다른 시점 서술이다.)

**봉합**: Grafana가 ClickHouse datasource로 로그·트레이스도 조회하게 하면, 한 화면에서 VM 메트릭 + ClickHouse 로그/트레이스를 함께 본다 `[추정]`. HyperDX가 필요한 상관 딥다이브는 HyperDX에서. 즉 "전 제품군 대체"의 현실적 형태는 단일 백엔드가 아니라 **역할 분담(메트릭=VM+Grafana / 로그·트레이스·RUM=HyperDX·ClickHouse)** 이다.

무계측 dual-ship과 프록시 매핑의 서버사이드 상세는 [dd 프록시 매핑]({{< relref "03-dd-proxy-mapping.md" >}})에서 다룬다.

## Wave 이관 전략

rip-and-replace가 아니라 dual-write/dual-instrument → 병행 검증 → 단계적 컷오버로 간다. 우선순위는 "절감 크기 × 계측 교체 난이도 × 리스크"로 정한다 `[추정]`. 단계별 실행 상세는 [마이그레이션 로드맵]({{< relref "05-migration-roadmap.md" >}}) 참조.

| Wave | 대상 | 이유 | 리스크 |
|:---:|---|---|:---:|
| **1** | RUM 웹코어 + Session Replay → HyperDX | 트리거(RWoL 재요율), 세션 단가 회피, 프론트 SDK 독립 | 낮음(단 공개 전례 부재 → **PoC 성공을 진입 게이트로 명문화**) |
| **2** | Logs → ClickStack / ClickHouse | 청구서 최대 항목, 계측 교체 거의 불필요 | 낮음 |
| **3** | APM / Traces → OTel 재계측 + ClickStack (`datadogreceiver` 병행) | 절감 + 표준화, 점진 전환 가능 | 중 |
| **4** | Metrics / Infra → VictoriaMetrics + Grafana + Sloth/Pyrra | 무계측 dual-ship으로 병행 검증 후 이관 | 중 |
| **5** | Security · Synthetics · NPM/NDM · DBM · CI · On-Call · Data Streams | 제품 성격 상이·규제·운영부담 → 전용 OSS 개별 이관 또는 Datadog 잔류 | 상 |

핵심은 **메트릭(Wave 4)의 목적지가 VM+Grafana여야 한다**는 점이다. Wave 4를 HyperDX로 잡으면 자동화 부재로 공수가 2~4배로 팽창해 이관 자체가 좌초한다 `[추정]`. 목적지를 올바로 잡으면 전 제품군 대체의 병목이던 메트릭·대시보드·모니터·SLO 이관이 풀린다.

## 비용 함정

절감 논리는 단순하지 않다. 방향은 분명하되 함정이 세 겹이다.

- **절감은 대부분 스토리지 이관에서 나온다.** 로그·트레이스·메트릭을 컬럼나/S3-native 스토리지로 옮길 때 문서화된 절감이 크다. 아래 Datadog 과금 구조를 벗어나는 것이 본질이다 `[확인됨]`.

| 과금 함정 | 메커니즘 | 대체 시 회피 |
|---|---|---|
| Host high-water mark | 시간당 호스트 수의 99퍼센타일 피크로 한 달 전체 과금(오토스케일에 취약) | 인프라 기준 과금이 없는 자체 스택 |
| Custom metrics tax | (name+host+tag) 고유 조합당 과금, **OTel로 보낸 모든 메트릭이 custom으로 과금** | VM은 시계열 과금 아님(스토리지·컴퓨트만) |
| Indexed spans | APM 호스트당 100만 span/월 포함, 초과 시 $1.70/100만 | ClickHouse 스토리지 단가로 흡수 |
| RUM 세션 단가 | Measure $0.15/1k + Investigate $3/1k + Session Replay $2.50/1k 세션 | HyperDX는 GB 기반(예측성↑) |

- **제품형 기능은 인건비가 절감을 상쇄한다.** Security·Synthetics·On-Call처럼 "제품"으로 사던 기능을 OSS로 대체하면 라이선스는 줄지만 운영·개발 인건비가 그만큼(또는 그 이상) 늘 수 있다 `[확인됨]`. TCO에 운영 인력·on-call 비용을 반드시 가산한다. Shopify는 자체 플랫폼 구축을 시도했으나 담당 팀 감축으로 계획이 불확실해진 **인력 리스크의 반례**다 `[벤더]`.
- **공개 절감 수치(30~98%)는 출처 편향을 걷어내고 읽는다.** 상위 20% 소스만 정리해 저가치 로그·메트릭을 드롭하면 30~60% 절감이 흔하고 `[벤더]`, OpenObserve/SigNoz류 이관에서 60~90% 절감이 인용된다 `[벤더]`. 하지만 구체적 달러 수치(예: "로그 500GB/일 → $12,600/년, 98% 절감")는 확인된 1차 출처에 근거가 없어 조사에서 **미확인/추정으로 강등**됐다 `[미확인]`. 이 수치들은 대체재 벤더(OpenObserve·SigNoz·Parseable) 블로그가 자사에 유리하게 인용한 것이라 그대로 신뢰하지 않는다. 방향성(90%대 절감 가능)은 여러 자료가 뒷받침하되, 특정 숫자는 자체 벤치로만 확정한다.

검증된 실제 사례로 감을 잡는다: Coinbase는 시장 냉각 후 Grafana+Prometheus+ClickHouse로 자체 스택을 구축해 이탈했고 `[확인됨]`, ClickHouse 자사는 내부 LogHouse로 Datadog을 대체해 "수백만 달러 절감"(100PB+ 저장) `[벤더]`, Curve는 이관으로 관측성 비용 40% 절감 `[벤더]`이다. 자체 구축 임계선은 통상 **연 $2~5M 벤더 지출**로 본다 `[추정]`.

## 전부 대체 vs 하이브리드

위 함정들이 가리키는 실무 결론: **"Datadog 완전 이탈"이 아니라 코어만 이관하는 하이브리드가 대부분 조직의 최적점**이다 `[추정]`. 두 시나리오의 인력·리스크 프로파일이 다르다.

| 축 | 전부 대체 (완전 이탈) | 하이브리드 (부분 대체) |
|---|---|---|
| 범위 | MELT+세션+보안+합성+CI+온콜 전부 자체/OSS | 코어(로그·트레이스·RUM·메트릭)만 이관, 나머지 Datadog 잔류 |
| 절감 | 최대, 단 보안·합성 운영비 증가로 순절감 축소 | 큰 항목 우선 절감 + 안전마진 |
| 필요 인력 | 관측성 전담 **2~4 FTE + 보안 별도** `[추정]` | ClickHouse+OTel 코어 **1~2 FTE**, 나머지 Datadog 위임 `[추정]` |
| 주요 리스크 | 다중 툴 상관 단절, 온콜/보안 공백, 자체 구축 팀 감축(Shopify) | 툴 이원화 컨텍스트 스위칭, 과도기 이중 비용 |
| 권장 대상 | 벤더 지출 $2~5M+ & 플랫폼 팀 보유 & 데이터 주권 강함 | 대부분의 조직 — 리스크/실익 균형 |

## 우리 케이스에서는

이 매트릭스의 공격적 "ClickHouse로 코어를 흡수" 그림은 **조사 전제** — RUM 대체가 트리거이고, ClickHouse를 관측성 외 **범용 분석에도 운영**하며, 그럴 **인력을 보유**했다는 전제 — 위에서 성립한다. 로깅 챕터가 서 있는 결정과는 관점이 다르므로, 승격이 아니라 전제 차이로 양립시킨다.

- **로깅 챕터 = 로그 내재화 관점**([로깅 · 옵저버빌리티]({{< relref "../logging/_index.md" >}})): D1은 로그를 **VictoriaLogs**로 보내고(소규모 istio 로그엔 단일 바이너리가 더 가볍다), D4는 로그+트레이스+RUM 통합 저장소(ClickHouse)를 **"earn it last"** — 조건이 성숙해야 성립하는 최후 베팅 — 로 미뤄둔다. 이 조사(RUM 대체 + 범용 분석 + 인력 보유 전제) = **D4 트리거가 발화한 세계**의 지도다. 범용 분석 수요와 전담 오너가 실제로 서 있을 때만 로그를 🟢 즉시 ClickStack로 올린다. 그 전제가 아직 미충족이면 로그는 D1대로 VictoriaLogs에 남고 통합은 최후로 미룬다.
- **메트릭 판단은 두 관점이 일치한다.** 메트릭을 HyperDX가 아니라 VictoriaMetrics+Grafana로 두는 것은 로깅 챕터의 Victoria 패밀리 선호(D1)와 [모니터링 챕터]({{< relref "../monitoring/victoriametrics/_index.md" >}})의 방향과 정합한다. 여기엔 전제 차이가 없다 — 어느 관점에서든 메트릭은 VM 축이다.
- **RUM은 D3(웹 YES / 모바일 NO)와 정합.** Wave 1의 RUM 웹코어는 웹 세션 리플레이 한정이고, 모바일은 별도 트랙으로 분리한다. 착수 전 Datadog RUM usage를 웹/모바일로 분해해 모바일 비중부터 측정한다 — 모바일이 과반이면 Wave 1의 "리스크 낮음"은 성립하지 않는다.

요약하면, 이 페이지의 매트릭스는 "무엇을 무엇으로 대체 가능한가"의 전체 지도이되, **우리의 실제 착수 순서는 로깅·모니터링 챕터의 서 있는 결정(로그=VictoriaLogs, 메트릭=VM+Grafana, 통합 저장소=최후)을 우선**한다. 통합 ClickHouse 축은 범용 분석이라는 D4 트리거가 실제로 발화할 때 이 매트릭스대로 확장한다. ClickHouse 자체 운영의 managed vs self-host 판단은 [ClickHouse 챕터]({{< relref "../clickhouse/_index.md" >}}) 참조.

> 근거 등급은 조사 문서의 판정을 승계하며 임의 승격하지 않는다. 시점 기준 조사 2026-07.
