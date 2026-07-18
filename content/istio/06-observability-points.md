---
title: "메시가 공짜로 주는 관측성"
weight: 6
---

# 06 · 메시가 공짜로 주는 관측성 — 무엇을 볼 수 있게 되나

{{< callout type="info" >}}
**한눈에**
- 사이드카가 이미 모든 요청을 가로채므로, **앱 무수정으로** 메트릭·액세스 로그·트레이싱(골든 시그널)이 공짜로 나온다.
- 힘은 **표준 라벨 차원**에 있다 — `response_flags`로 실패 원인, `connection_security_policy`로 mTLS 커버리지까지 서비스 무관하게 슬라이스한다.
- **트레이싱은 유일한 예외**: 스팬 생성은 메시가 하지만 trace 컨텍스트 헤더 전파는 앱 몫이다.
- **카디널리티는 공짜가 아니다** — Telemetry API로 태그를 정리·집약해 관리한다.
{{< /callout >}}

> **왜 이 이야기.** 메시를 얹기 전에는 서비스마다 지표가 제각각이었다. 어떤 팀은 요청 수를 내보내고, 어떤 팀은 안 내보내고, 라벨 이름도 서비스마다 달랐다. Istio를 얹자 **모든 서비스가 동일한 스키마의 골든 시그널을 앱 코드 수정 없이** 뿜기 시작했다 — 사이드카가 이미 모든 요청을 보고 있으니 공짜다. 이 문서는 메시가 주는 관측성의 세 축(메트릭·액세스 로그·트레이싱)과, 그 "공짜"의 한계·비용을 정리한다.

> 관련 문서: [02 컨트롤 플레인 지표]({{< relref "02-istiod-control-plane.md" >}})(istiod 쪽 지표는 그쪽) · [05 장애 추적]({{< relref "05-incident-intermittent-5xx.md" >}})(response_flags) · 저장/카디널리티는 [VictoriaMetrics]({{< relref "../monitoring/victoriametrics/_index.md" >}}), 로그 목적지는 [로깅]({{< relref "../logging/_index.md" >}}).

## 왜 "공짜"인가

[01]({{< relref "01-mesh-basics.md" >}})에서 봤듯 사이드카 Envoy는 파드가 주고받는 **모든 요청을 가로챈다.** 즉 요청을 볼 수 있는 지점이 이미 트래픽 경로에 박혀 있다. 그래서 애플리케이션이 계측 코드를 한 줄도 넣지 않아도, Envoy가 요청 단위로 메트릭·로그·트레이스 스팬을 만들어낸다. **관측 대상이 앱이 아니라 프록시**이므로, 언어·프레임워크가 뭐든 동일하게 관측된다.

관측 축은 세 개다.

| 축 | 무엇 | 어디서 나오나 |
|---|---|---|
| **메트릭** | 요청률·에러·지연(RED 골든 시그널) | 각 Envoy가 `:15020/stats/prometheus`로 노출 |
| **액세스 로그** | 요청 한 건 한 건의 기록 | Envoy stdout(또는 지정 싱크) |
| **분산 트레이싱** | 요청이 서비스들을 지나는 경로 스팬 | Envoy가 스팬 생성(단, 앱의 헤더 전파 필요) |

## 1) 표준 메트릭 — 모든 서비스가 같은 언어로 말한다

Istio가 내보내는 핵심 프록시 메트릭은 다음과 같다. 이름이 서비스와 무관하게 **고정**이라는 점이 핵심이다.

| 메트릭 | 타입 | 무엇을 재나 | 골든 시그널 |
|---|---|---|---|
| **`istio_requests_total`** | Counter | HTTP/gRPC 요청 수 | Rate · Errors |
| **`istio_request_duration_milliseconds`** | Histogram | 요청 처리 지연 | Duration (Latency) |
| **`istio_request_bytes` / `istio_response_bytes`** | Histogram | 요청·응답 본문 크기 | Saturation 보조 |
| **`istio_tcp_connections_opened_total` / `_closed_total`** | Counter | TCP 연결 개수 | TCP 트래픽 |
| **`istio_tcp_sent_bytes_total` / `_received_bytes_total`** | Counter | TCP 바이트 | TCP 트래픽 |

진짜 힘은 **표준 라벨 차원**에 있다. 모든 요청 메트릭이 같은 라벨을 달고 나오므로, 서비스가 무엇이든 같은 질문을 던질 수 있다.

| 라벨 | 쓰임 |
|---|---|
| `source_workload` · `destination_service` · `destination_workload` | 누가 누구를 부르나 (서비스 그래프의 간선) |
| `response_code` | HTTP 상태코드별 에러율 |
| **`response_flags`** | Envoy가 본 실패 원인 (UH/UF/UC/UO…) → [05]({{< relref "05-incident-intermittent-5xx.md" >}})의 나침반 |
| **`connection_security_policy`** | `mutual_tls` vs `none` → **mTLS 커버리지 모니터링** |
| `request_protocol` | http / grpc / tcp |
| `source_app` · `destination_app` · `*_canonical_service` | 앱 단위 집계 |

이 라벨들 덕분에 **통합 대시보드 하나**로 전 서비스의 RED를 본다. 예: "에러율" = `sum(rate(istio_requests_total{response_code=~"5.."}[5m])) by (destination_service)`. 서비스별로 대시보드를 새로 짤 필요가 없다. mTLS가 안 걸린 트래픽 색출도 `connection_security_policy="none"` 한 줄이면 된다 — nginx 시절엔 없던 관측 포인트다.

## 2) 액세스 로그 — 요청 한 건의 진실

메트릭이 집계라면, 액세스 로그는 개별 요청의 기록이다. Istio 액세스 로그의 결정적 필드가 **`%RESPONSE_FLAGS%`** — 05에서 5xx의 홉과 원인을 가르는 그 두세 글자다. 표준 포맷에는 응답코드·지연·업스트림 호스트·요청 ID가 함께 찍힌다.

- **켜고 끄기** — 메시 전역(`meshConfig.accessLogFile: /dev/stdout`)으로 켜거나, **Telemetry API**로 네임스페이스·워크로드 단위로 세밀하게 제어한다. 전량 로깅은 비싸므로 보통 게이트웨이·핵심 서비스에 집중하거나 샘플링한다.
- **어디로 보내나** — Envoy stdout으로 나온 로그를 로그 파이프라인이 수집한다. 이 로그를 어느 저장소에 쌓을지가 [로깅 챕터]({{< relref "../logging/_index.md" >}})의 결정과 직결된다(istio 액세스 로그 → VictoriaLogs 등).

## 3) 분산 트레이싱 — "공짜"의 명확한 한계

사이드카는 요청마다 트레이스 스팬을 만든다. 그런데 여기 **함정**이 있다: Envoy는 자기가 본 홉의 스팬만 만들 뿐, 그것들을 하나의 트레이스로 이으려면 **애플리케이션이 trace 컨텍스트 헤더를 전파**해야 한다.

- 앱이 인바운드 요청의 `x-request-id`·`traceparent`(W3C) 또는 `b3`(Zipkin) 헤더를 **아웃바운드 호출에 그대로 실어보내야** 스팬들이 한 트레이스로 연결된다.
- 이걸 안 하면 서비스마다 끊긴 스팬 조각만 남는다. **"트레이싱은 공짜"라는 말의 유일한 예외** — 메시가 스팬 생성은 해주지만 전파는 앱 몫이다.

트레이싱 백엔드(Jaeger/Tempo 등)와 샘플링 비율도 Telemetry API로 지정한다.

## 4) 토폴로지 — 메트릭에서 유도되는 서비스 그래프

`source_workload`→`destination_service` 라벨이 곧 서비스 그래프의 간선이므로, 이 메트릭만으로 **서비스 의존 지도**를 그릴 수 있다. Kiali 같은 도구가 Prometheus 메트릭 + Istio 설정을 읽어 실시간 트래픽 토폴로지, mTLS 상태, 에러 흐름을 시각화한다. 별도 계측 없이 "지금 무엇이 무엇을 부르고 어디서 에러가 나는지"가 그림으로 나온다.

## 공짜의 비용 — 카디널리티

관측이 공짜라고 지표 저장까지 공짜는 아니다. 표준 라벨이 많다는 건 곧 **시계열 카디널리티가 크다**는 뜻이다.

- `destination_service` × `source_workload` × `response_code` × … 의 조합이 곱해지며 시계열이 폭증할 수 있다.
- 특히 **커스텀 라벨에 高카디널리티 값**(요청 경로 원문, user id 등)을 넣으면 저장이 터진다. Istio가 기본적으로 raw path를 라벨에 안 넣는 이유다.
- 대응: **Telemetry API로 불필요한 태그를 제거·집약**하고, 저장 계층에서 카디널리티를 관리한다. → [VictoriaMetrics 카디널리티]({{< relref "../monitoring/victoriametrics/practice/01-cardinality.md" >}})와 정확히 같은 원칙이다("자주 바뀌는 값은 라벨이 아니라 로그·트레이스로").

## 커스터마이징 — Telemetry API

메시가 주는 기본값을 그대로 쓰지 않고 다듬는 표준 창구가 **Telemetry API**다. 하나의 리소스로 세 축을 모두 제어한다.

- **Metrics** — 태그 추가/제거, 특정 지표 비활성화, 차원 오버라이드(카디널리티 관리의 핵심 도구).
- **Access logging** — 대상·포맷·on/off를 워크로드 단위로.
- **Tracing** — 백엔드·샘플링 비율·커스텀 태그.

EnvoyFilter로 저수준을 건드리기 전에, 관측 커스터마이징은 **거의 다 Telemetry API로 끝난다**([08]({{< relref "08-envoyfilter-extension.md" >}})의 선택 사다리 참고).

## 이 문서에서 가져갈 것

- 메시 관측성이 "공짜"인 건 **관측 지점(사이드카)이 이미 트래픽 경로에 있기 때문**이다. 앱 무수정으로 모든 서비스가 동일 스키마의 골든 시그널을 낸다.
- 힘은 **표준 라벨 차원**에 있다 — `response_flags`로 실패 원인, `connection_security_policy`로 mTLS 커버리지까지 서비스 무관하게 슬라이스한다.
- 단, **트레이싱은 앱의 헤더 전파가 필요**하고, **카디널리티는 공짜가 아니다**. 커스터마이징·태그 정리는 Telemetry API로 한다.
