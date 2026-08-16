---
title: "Envoy가 제공하는 것"
weight: 12
---

# 12 · Envoy가 제공하는 것 — Istio를 걷어내고 프록시 하나만 본다

{{< callout type="info" >}}
**한눈에**
- Envoy는 앱에 링크되는 라이브러리가 아니라 **앱 옆에서 따로 도는 프로세스**다. 그래서 언어를 가리지 않습니다. 공식 홈페이지의 자기 정의가 "universal data plane"입니다.
- 코어는 L3/L4 프록시 + 꽂아 넣는 필터 체인이고 HTTP는 그 위에 얹힌 **L7 필터 레이어**입니다. 모델은 listener → 필터 체인 → route → cluster → endpoint 하나로 끝납니다.
- 재시도·서킷 브레이킹·아웃라이어 감지·헬스체크·로드밸런싱은 **전부 Envoy가 이미 갖고 있는 기능**입니다. Istio CRD는 그 스위치를 밖으로 꺼낸 창구입니다.
- 관측성 세 축도 Envoy가 생산합니다. 특히 트레이싱에서 Envoy는 헤더만 넘기는 게 아니라 **스팬을 직접 만들어 수집기로 보냅니다**.
- **xDS는 Envoy 프로젝트가 정의한 API**이고 istiod는 그 관리 서버 구현 중 하나입니다.
{{< /callout >}}

지금까지 이 챕터에서 Envoy는 늘 Istio의 부품이었습니다. [01]({{< relref "01-mesh-basics.md" >}})에서는 파드에 붙는 사이드카였습니다. [02]({{< relref "02-istiod-control-plane.md" >}})에서는 xDS를 받아가는 대상이었고, [08]({{< relref "08-envoyfilter-extension.md" >}})에서는 EnvoyFilter가 패치하는 설정 덩어리였습니다. 이 문서는 그 방향을 뒤집습니다 — **Istio를 걷어낸 Envoy 자체의 기능 카탈로그**, 즉 조립되기 전의 부품이 원래 무엇을 할 수 있는가입니다. 조립 이야기는 [13]({{< relref "13-istio-envoy-assembly.md" >}})으로 넘깁니다.

> 관련 문서: [13 Istio는 Envoy를 어떻게 조립하나]({{< relref "13-istio-envoy-assembly.md" >}}) · [11 요청 경로 해부]({{< relref "11-request-path-anatomy.md" >}}) · [06 관측성]({{< relref "06-observability-points.md" >}}) · [08 EnvoyFilter]({{< relref "08-envoyfilter-extension.md" >}})

## 1. 라이브러리가 아니라 프로세스

자기 정의는 홈페이지 첫 문장에 그대로 있습니다 — "A high performance C++ distributed proxy designed for single services and applications, as well as a communication bus and 'universal data plane' designed for large microservice 'service mesh' architectures." 서비스 하나 앞에 세우는 프록시와 메시 전체의 데이터 플레인이 같은 프로그램이라는 뜻입니다.

배치 형태도 문서가 못 박습니다: "Envoy is a self contained process that is designed to run alongside every application server." 앱과 같은 주소 공간이 아니라 옆에서 따로 도는 프로세스입니다. 여기서 따라오는 결론이 [01]({{< relref "01-mesh-basics.md" >}})이 "공통 관심사의 중복"으로 서술한 문제의 해답입니다 — "Envoy works with any application language. A single Envoy deployment can form a mesh between Java, C++, Go, PHP, Python, etc." 재시도 라이브러리를 언어마다 다시 짜는 대신, 프로세스 하나가 언어와 무관하게 같은 동작을 제공합니다.

기능의 층은 둘로 나뉩니다.

- **코어는 L3/L4입니다.** "At its core, Envoy is an L3/L4 network proxy. A pluggable filter chain mechanism allows filters to be written to perform different TCP/UDP proxy tasks." 확장 모델이 코어 정의에 이미 들어 있다는 점을 기억해 둡니다 — 6절에서 다시 나옵니다.
- **HTTP는 그 위의 레이어입니다.** "HTTP is such a critical component of modern application architectures that Envoy supports an additional HTTP L7 filter layer."

같은 소개 문서가 다른 자리에서는 Envoy를 "an L7 proxy and communication bus designed for large modern service oriented architectures"라고도 부릅니다. 둘 다 공식 표현이고 서로 어긋나지 않습니다 — 앞은 구현 구조(L3/L4 코어 + L7 레이어), 뒤는 실제 쓰임새를 말한 것입니다.

프로토콜과 운영 기능도 프록시 자체에 들어 있습니다.

| 항목 | Envoy가 제공하는 것 |
|---|---|
| **HTTP/1.1 · HTTP/2** | 둘 다 지원, **양방향 투명 변환**("a transparent HTTP/1.1 to HTTP/2 proxy in both directions") |
| **gRPC** | gRPC 요청·응답의 "routing and load balancing substrate" |
| **HTTP/3** | downstream 가능, **upstream alpha** — "key features are implemented but have not been tested at scale" |
| **hot restart** | 코드와 설정을 통째로 리로드하되 drain 과정에서 기존 커넥션을 끊지 않는다 |

{{< callout type="important" >}}
**HTTP/3 상태는 버전에 붙어 있습니다.** 위 표의 downstream/upstream 구분은 이번에 확인한 최신 문서 트리(1.40.0-dev) 기준입니다. Envoy 마이너 릴리스마다 바뀔 수 있으므로, 인용할 때는 **실제 배포 중인 Envoy 버전의 문서**로 다시 확인해야 합니다. hot restart도 마찬가지로 "기존 커넥션이 새 프로세스로 옮겨간다"는 뜻이 아닙니다 — drain 동안 **기존 커넥션을 마저 처리**하는 것입니다.
{{< /callout >}}

## 2. 코어 모델 — listener에서 endpoint까지

Envoy 설정을 읽는 문법은 사실 하나뿐입니다. 요청이 들어와서 나가기까지 거치는 단계가 그대로 설정의 뼈대입니다.

{{< flow src="_flow/2-코어-모델-listener-에서.json" />}}

입구는 listener입니다. 문서가 주는 역할은 "responsible for binding to an IP/port, accepting new TCP connections (or UDP datagrams) and orchestrating the downstream facing aspects of request processing"입니다. 커넥션이 들어오면 리스너 필터가 먼저 돌고 그다음 전송 소켓 설정과 네트워크 필터로 이루어진 필터 체인이 매칭됩니다.

그 네트워크 필터 체인의 **마지막이자 가장 중요한 필터가 HTTP connection manager(HCM)**입니다. HCM이 하는 일을 문서는 이렇게 적습니다 — "translates raw bytes into HTTP level messages and events (e.g., headers received, body data received, trailers received, etc.)". 바이트가 HTTP가 되는 지점이 여기입니다. HCM은 다음을 한곳에서 관리합니다.

| HCM이 중앙에서 맡는 것 | 이 문서에서 이어지는 절 |
|---|---|
| 액세스 로깅 | 4절 |
| request ID 생성·트레이싱 | 4절 |
| 헤더 조작 | 6절 |
| 라우트 테이블 관리 (정적 또는 RDS로 동적) | 5절 |
| 통계 | 4절 |

L7 기능 대부분이 "HCM 아래"에 모여 있다는 사실이 [11]({{< relref "11-request-path-anatomy.md" >}})에서 "HTTP로 파싱되는 홉에서만 L7 기능이 생긴다"고 한 규칙의 구현 쪽 이유입니다.

HTTP 필터는 스트림마다 실행되고 그중 **router 필터가 목적지를 정합니다**. 문서 표현 그대로 "When decodeHeaders() is invoked on the router filter, the route is selected and a cluster is picked." 여기서 고른 cluster의 로드밸런서가 "picks an endpoint when a new request arrives"합니다. 이어서 커넥션 풀이 그 엔드포인트로의 커넥션을 얻거나 새로 맺습니다 — **이때 서킷 브레이커 한도가 걸립니다.**

즉 복원력 설정이 두 층에 나뉘어 사는 이유가 여기서 나옵니다. 재시도처럼 "어디로 보낼지"에 붙는 것은 route에, 커넥션 한도처럼 "상대를 어떻게 대할지"에 붙는 것은 cluster에 있습니다.

## 3. 복원력 카탈로그

아래는 전부 Envoy가 자체적으로 갖춘 기능입니다. Istio가 없어도 이 스위치들은 존재합니다.

- **재시도** (route) — `x-envoy-retry-on`으로 조건을 고릅니다: `5xx`, `gateway-error`, `reset`, `connect-failure`, `retriable-4xx`, `refused-stream` 등.
- **재시도 예산(retry budget)** (cluster) — 재시도 폭주를 막는 클러스터 레벨 가드레일. route의 최대 재시도 횟수와는 **별개 장치**.
- **타임아웃** (route) — 요청이 무한정 매달리지 않게 끊습니다.
- **서킷 브레이킹** (cluster) — 업스트림 클러스터별·priority별로 임계치를 셉니다: 최대 커넥션, 최대 대기 요청, 최대 요청, 최대 활성 재시도, 최대 동시 커넥션 풀.
- **아웃라이어 감지** (cluster) — "a form of passive health checking". 연속 5xx, 연속 게이트웨이 오류(502/503/504), 연속 local-origin 실패, 성공률·실패율 통계 이상치로 엔드포인트를 축출. `x-envoy-degraded` 헤더로 degraded 표시도 합니다.
- **능동 헬스체크** (cluster) — 업스트림 클러스터별로 설정. HTTP·gRPC·L3/L4(TCP 바이트 버퍼 에코)·Redis·Thrift 프로토콜 체크를 지원.

마지막 두 항목의 수동/능동 구분은 문서가 직접 대비시켜 놓은 것입니다. **아웃라이어 감지는 실제 트래픽의 응답을 보고 판정**하고 **능동 헬스체크는 별도의 체크 요청을 보냅니다.** 둘은 배타적이지 않고 같은 클러스터에 함께 걸립니다.

로드밸런싱 정책도 프록시가 이름을 붙여 갖추고 있습니다.

| 정책 | 특징 |
|---|---|
| weighted round robin | 가중치 라운드로빈 |
| client-side weighted round robin | ORCA 기반으로 클라이언트가 가중치를 계산 |
| weighted least request | 가중치가 같으면 **P2C**(두 개 뽑아 적은 쪽) |
| ring hash | **Ketama** 일관 해싱 |
| maglev | 65,537 엔트리 고정 테이블 |
| random | 무작위 |

{{< callout type="important" >}}
**Istio CRD는 이 표의 스위치를 밖으로 꺼낸 창구입니다.** 대략의 위치만 말하면 route 층(재시도·타임아웃)은 `VirtualService`, cluster 층(서킷 브레이킹·아웃라이어 감지·로드밸런싱)은 `DestinationRule` 쪽에서 노출됩니다 — [01]({{< relref "01-mesh-basics.md" >}})의 CRD 표가 이미 그렇게 묶어 두었습니다. **필드 단위의 정확한 대응과, Istio가 어떤 기본값을 얹는지는 [13]({{< relref "13-istio-envoy-assembly.md" >}})에서 다룹니다.** 재시도 예산처럼 표준 CRD 대응을 이 문서의 재료로 확인하지 못한 항목도 있습니다.
{{< /callout >}}

## 4. 관측성 — Envoy가 만들어내는 것

[06]({{< relref "06-observability-points.md" >}})은 메시가 준 지표를 **어떻게 쓰는지**를 다뤘습니다. 여기서는 그 지표가 애초에 어디서 만들어지는지, 프록시 쪽 생산 메커니즘만 봅니다.

### 통계

Envoy의 stats는 **꽂아 바꿀 수 있는 싱크 모델**입니다 — "As of the v2 API, Envoy has the ability to support custom, pluggable sinks." 표준 싱크 구현이 함께 딸려 오고 필요하면 커스텀 싱크를 붙입니다. 메트릭 타입은 셋뿐입니다.

| 타입 | 정의 |
|---|---|
| **Counter** | "Unsigned integers that only increase and never decrease" |
| **Gauge** | "both increase and decrease" |
| **Histogram** | 값을 모아 백분위수로 집계 |

### 액세스 로그

액세스 로깅은 2절에서 본 대로 **HCM이 중앙에서 관리하는 책임 중 하나**입니다.

### 트레이싱

여기가 이 절에서 가장 중요한 지점입니다. **Envoy는 트레이싱 헤더를 통과시키기만 하는 것이 아니라 스팬을 직접 만들어 보냅니다** — "Envoy automatically sends spans to tracing collectors." 사이드카로 동작할 때 인바운드에서는 SERVER 스팬, 아웃바운드에서는 CLIENT 스팬이 됩니다. 독립적인 홉으로 명시적 스팬을 만들게 하려면 `spawn_upstream_span`을 씁니다. `x-request-id` UUID도 Envoy가 발급합니다.

지원하는 컨텍스트 포맷은 하나가 아닙니다.

| 포맷 | 헤더 |
|---|---|
| **B3** | `x-b3-traceid` · `x-b3-spanid` · `x-b3-parentspanid` · `x-b3-sampled` · `x-b3-flags`, 그리고 이를 압축한 단일 `b3` 헤더 |
| **W3C Trace Context** | `traceparent` · `tracestate` |
| 그 외 | LightStep · Datadog · SkyWalking(`sw8`) · AWS X-Ray |

B3와 W3C 사이의 추출 fallback은 설정으로 정합니다. 그래서 [06]({{< relref "06-observability-points.md" >}})이 "트레이싱만은 앱의 헤더 전파가 필요하다"고 한 경계가 여기서 선명해집니다 — **스팬 생성·ID 발급·포맷 해석까지가 프록시의 몫**이고 앱이 인바운드에서 받은 헤더를 아웃바운드 호출에 실어 나르는 in-process 전파만 남습니다.

{{< callout type="info" >}}
**이 절에서 하나는 간접 확인입니다.** 액세스 로그 전용 아키텍처 개요 페이지는 이번 확인 시점에 404였습니다. 액세스 로깅이 HCM이 중앙 관리하는 책임이라는 것은 HTTP connection management 문서로 확인했지만, 액세스 로그 자체의 포맷·싱크 설명은 이 문서의 재료에 들어 있지 않습니다.
{{< /callout >}}

## 5. 동적 설정 — xDS는 Envoy의 API다

[02]({{< relref "02-istiod-control-plane.md" >}})는 xDS를 "istiod가 프록시에 설정을 내려보내는 프로토콜 묶음"으로 소개했습니다. 종류별 표도 거기에 있습니다. 이 문서의 각도에서 보면 소유 관계가 반대입니다.

Envoy 자신의 xDS 문서는 이렇게 시작합니다 — "Envoy discovers its various dynamic resources via the filesystem or by querying one or more management servers. Collectively, these discovery services and their corresponding APIs are referred to as xDS."

두 가지가 읽힙니다.

- **xDS는 Envoy 프로젝트가 정의한 스펙**입니다. 규격에 맞는 관리 서버라면 무엇이든 Envoy에 설정을 공급할 수 있습니다. Envoy 문서는 특정 컨트롤 플레인 이름을 부르지 않고 클라이언트 대 관리 서버라는 일반형으로만 서술합니다.
- **관리 서버가 필수도 아닙니다.** 같은 문장이 파일시스템을 먼저 듭니다. xDS를 쓴다는 것과 컨트롤 플레인이 붙어 있다는 것은 같은 말이 아닙니다.

Istio 쪽 서술도 이 방향과 맞습니다. istio.io 1.5 릴리스 노트는 컨트롤 플레인 비용을 이야기하며 이들을 "Envoy xDS APIs"라고 부릅니다 — Istio가 정의한 규격이 아니라 **Envoy의 API를 istiod가 서빙한다**는 표현입니다.

그래서 [02]({{< relref "02-istiod-control-plane.md" >}})의 CPU 이야기와 [11]({{< relref "11-request-path-anatomy.md" >}})의 agent 중계는 부품 쪽에서 보면 "관리 서버 구현 하나가 이 API를 어떻게 서빙하는가"의 문제가 됩니다. 그 구현 선택이 어디서 갈리는지는 [13]({{< relref "13-istio-envoy-assembly.md" >}})의 주제입니다.

## 6. 확장 지점 — 안에서 돌리거나, 밖에 물어보거나

1절에서 봤듯 필터 체인은 Envoy의 부가 기능이 아니라 코어 정의의 일부입니다 — "A pluggable filter chain mechanism allows filters to be written to perform different TCP/UDP proxy tasks." 네트워크 필터가 TCP/UDP 층을, HTTP 필터가 스트림 층을 담당합니다. 확장은 전부 이 두 자리에 필터를 꽂는 식입니다.

꽂히는 필터는 성격이 둘로 갈립니다.

**프록시 안에서 코드를 돌리는 쪽.**

| 필터 | 무엇 |
|---|---|
| `lua` | LuaJIT 스크립트 실행(요청·응답 양쪽) — "Lua scripts to be run during both the request and response flows" |
| `wasm` | "The HTTP Wasm filter is used to implement an HTTP filter with a Wasm plugin" |

**밖의 서비스에 물어보는 쪽.**

- **`ext_authz`** — "calls an external gRPC or HTTP service to determine whether an incoming HTTP request is authorized". 거부 시 **403**.
- **`rate_limit`** — route나 virtual host에 매칭되는 설정이 있으면 서비스를 호출합니다. 초과 시 **429**(설정 가능).

두 부류의 차이가 곧 운영 비용의 차이입니다. 안에서 도는 쪽은 요청 경로에 CPU를 더하고 밖에 묻는 쪽은 요청마다 왕복 지연과 **외부 서비스라는 장애 지점**을 더합니다. `failure_mode_deny`가 설정 항목으로 존재한다는 사실 자체가, 그 외부 서비스가 죽었을 때 통과시킬지 막을지를 미리 정해 두라는 요구입니다.

이 필터들을 Istio에서 어떤 창구로 붙이는지 — EnvoyFilter의 위험, `WasmPlugin`이라는 상위 추상화, local과 global 레이트 리밋의 성격 차이 — 는 [08]({{< relref "08-envoyfilter-extension.md" >}})에 있습니다.

## 7. Istio 밖의 Envoy

같은 부품을 쓰는 프로젝트 목록은 Envoy 공식 커뮤니티 페이지에 그대로 있습니다. 메시 쪽에는 Istio 외에 **Kuma**, **Consul Connect**("first-class support for using Envoy as a proxy"), **AWS App Mesh**가 있고, API 게이트웨이·인그레스 쪽에는 **Ambassador**("An open source Kubernetes-native API Gateway built on Envoy"), **Contour**, **Enroute**, **Gloo Edge**, **Higress**, 그리고 Envoy 프로젝트 자신의 컨트롤 플레인인 **Envoy Gateway**가 올라 있습니다.

같은 데이터 플레인을 두고 컨트롤 플레인만 다른 것들이 이만큼 있다는 사실이 5절의 관계 역전을 실물로 보여줍니다. 다만 이 목록의 설명 문구는 각 프로젝트가 자기 소개로 적은 것이고 시간이 지나면 갱신·삭제될 수 있습니다.

## 이 문서에서 가져갈 것

- Envoy는 앱 옆에서 도는 **독립 프로세스**이고 그 때문에 언어를 가리지 않습니다. 코어는 L3/L4 프록시 + 필터 체인이며 HTTP는 그 위의 레이어입니다.
- 설정을 읽는 문법은 **listener → 필터 체인 → route → cluster → endpoint** 하나입니다. 재시도가 route에, 서킷 브레이커가 cluster에 있는 이유도 이 순서에서 나옵니다.
- 복원력·관측성 기능은 Istio가 만들어 준 것이 아니라 **Envoy가 원래 갖고 있던 것**입니다. Istio CRD는 그 스위치를 꺼낸 창구이고 트레이싱에서 Envoy는 스팬을 직접 만듭니다.
- **xDS는 Envoy가 정의한 API**이고 istiod는 그 구현 하나입니다. 같은 부품 위에 다른 컨트롤 플레인이 여럿 서 있습니다.

## 소스

- Envoy 공식 홈페이지 — 자기 정의("universal data plane"): <https://www.envoyproxy.io/>
- Envoy 공식 문서 — **What is Envoy** (out-of-process, 언어 무관, L3/L4 코어 + L7 필터 레이어, HTTP/1.1↔HTTP/2 투명 변환, gRPC): <https://www.envoyproxy.io/docs/envoy/latest/intro/what_is_envoy>
- Envoy 공식 문서 — **Life of a Request** (listener → 리스너 필터 → 네트워크 필터 체인 → HCM → HTTP 필터 → router → cluster LB → endpoint, 커넥션 풀과 서킷 브레이커): <https://www.envoyproxy.io/docs/envoy/latest/intro/life_of_a_request>
- Envoy 공식 문서 — **HTTP connection management** (HCM이 바이트를 HTTP로 바꾸고 액세스 로그·request ID·헤더 조작·라우트 테이블·통계를 중앙 관리): <https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/http/http_connection_management>
- Envoy 공식 문서 — **Circuit breaking** (클러스터별·priority별 임계치 목록): <https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking>
- Envoy 공식 문서 — **Outlier detection** (passive health checking, 축출 조건, `x-envoy-degraded`): <https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/outlier>
- Envoy 공식 문서 — **Health checking** (능동 헬스체크와 프로토콜별 체크, 아웃라이어 감지와의 대비): <https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/health_checking>
- Envoy 공식 문서 — **Router filter** (`x-envoy-retry-on` 조건): <https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/router_filter>
- Envoy 공식 문서 — **Load balancers** (정책 이름 목록): <https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/load_balancing/load_balancers>
- Envoy 공식 문서 — **Statistics** (pluggable sink, counter·gauge·histogram): <https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/observability/statistics>
- Envoy 공식 문서 — **Tracing** (스팬 생성·전송, SERVER/CLIENT 스팬, `x-request-id`, B3·W3C·기타 포맷): <https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/observability/tracing>
- Envoy 공식 문서 — **xDS protocol** ("via the filesystem or by querying one or more management servers"): <https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol>
- Envoy 공식 문서 — **HTTP/3** (downstream 프로덕션 / upstream alpha): <https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/http/http3>
- Envoy 공식 문서 — **Hot restart** (코드·설정 리로드, drain 중 기존 커넥션 유지): <https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/operations/hot_restart>
- Envoy 공식 문서 — **Lua / Wasm / ext_authz / rate limit 필터**: <https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/lua_filter> · <https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/wasm_filter> · <https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/ext_authz_filter> · <https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/rate_limit_filter>
- Envoy 공식 커뮤니티 페이지 — Envoy를 쓰는 메시·게이트웨이 목록: <https://www.envoyproxy.io/community>
- 확인 상태 메모: ① 액세스 로그 전용 아키텍처 개요 페이지는 확인 시점에 404였고 HCM 문서로만 간접 확인했습니다. ② 5절의 "Envoy xDS APIs" 문구는 istio.io 1.5 릴리스 노트(<https://istio.io/latest/news/releases/1.5.x/>)의 검색 요약으로 얻은 것으로, 해당 페이지 원문을 직접 다시 확인하는 편이 좋습니다. ③ 재시도 예산의 정의는 서킷 브레이킹 문서에서 요약된 서술이며 한 문장 인용이 아닙니다. ④ HTTP/3 상태는 최신(1.40.0-dev) 트리 기준이므로 배포 버전으로 다시 확인할 것.
