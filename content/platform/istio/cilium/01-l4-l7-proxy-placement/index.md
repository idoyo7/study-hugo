---
title: "01 L4와 L7 — 프록시는 어디에 있나"
description: "사이드카, ambient, Cilium이 L4와 L7을 처리하는 자리를 비교하고 어느 계층에서 무엇이 가능한지, 노드 공유 Envoy의 장애 반경과 mTLS 차이를 2026-10-19 기준으로 정리한다."
date: 2026-10-19
lastmod: 2026-10-19
weight: 1
url: "/istio/cilium/01-l4-l7-proxy-placement/"
---

# 01 · L4와 L7 — 프록시는 어디에 있나

## 1. 같은 Envoy를 어디에 두느냐의 문제

아래 도식은 사이드카, ambient, Cilium에서 요청이 거치는 프록시와 L7을 처리하는 위치를 비교합니다.

{{< flow src="_flow/2-세-가지-배치.json" />}}

Istio와 Cilium은 모두 Envoy로 L7(애플리케이션 계층)을 처리합니다. Istio의 waypoint 문서와 Cilium의 Envoy 문서에서 확인할 수 있는 공통점입니다. Cilium의 Gateway API와 L7 정책만 보고 Istio를 빼도 되는지 판단하려면, 같은 Envoy를 각 시스템이 어디에 배치하는지부터 봐야 합니다.

Istio 사이드카는 파드마다 Envoy를 둡니다. Ambient는 서비스 앞에 waypoint를 두고, Cilium은 노드마다 Envoy 하나를 공유합니다. 프록시 수와 위치, 한 프록시가 맡는 워크로드 범위가 모두 다릅니다. L4(전송 계층)를 누가 처리하는지도 다릅니다.

이 편에서는 요청을 가로채는 지점과 HTTP를 해석하는 위치를 살펴봅니다. Gateway API 구현은 [02편]({{< relref "/platform/istio/cilium/02-gateway-api/index.md" >}}), 관측·재시도·요청 변형은 [03]({{< relref "/platform/istio/cilium/03-observability/index.md" >}})·[04]({{< relref "/platform/istio/cilium/04-retry-resilience/index.md" >}})·[05]({{< relref "/platform/istio/cilium/05-request-customization/index.md" >}})편에서 다룹니다. 사이드카 Envoy 내부의 처리 순서는 [11 요청 경로 해부]({{< relref "/platform/istio/fundamentals/11-request-path-anatomy/index.md" >}}), Envoy 자체의 기능은 [12 Envoy가 제공하는 것]({{< relref "/platform/istio/fundamentals/12-envoy-capabilities/index.md" >}})에서 이어 볼 수 있습니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-19이며 Istio 1.31.2 문서, Cilium stable 문서(1.20.3)를 봤습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 조사 범위 | Istio 1.31.2, Cilium stable 1.20.3 | 각 프로젝트 문서 | — |
| L7 프록시는 양쪽 모두 Envoy | Istio 사이드카·waypoint는 Envoy 기반, Cilium은 노드당 Envoy | Istio 문서 ambient waypoint, Cilium 문서 Envoy | `✓` |
| 배치 요약 | 파드마다 / 서비스 앞 / 노드마다 | 위 두 문서를 종합 | `Σ` |

{{% /details %}}

## 2. 사이드카는 모든 연결을 받고 프로토콜을 판별한다

사이드카 모드에서는 HTTP를 처리할 필요가 없는 연결도 파드 안의 Envoy를 거칩니다. iptables 규칙이 인바운드·아웃바운드 트래픽을 모두 Envoy로 보내기 때문입니다. Envoy는 아웃바운드를 15001, 인바운드를 15006 포트에서 받으며, 연결마다 HTTP로 처리할지 TCP로 처리할지 판별합니다. Istio의 프로토콜 선택 문서는 HTTP, HTTPS, gRPC를 포함해 어떤 TCP 트래픽이든 프록시할 수 있다고 설명합니다.

Envoy를 지난다는 사실만으로 HTTP 기능을 쓸 수 있는 것은 아닙니다. 해당 포트가 TCP로 분류되면 VirtualService의 HTTP 라우팅, 재시도, 헤더 조작은 적용되지 않습니다. 메트릭도 `istio_requests_total` 대신 `istio_tcp_*`만 나옵니다. 원하는 L7 기능이 동작하는지 알려면 프로토콜이 어떻게 판별되는지 함께 확인해야 합니다.

Istio가 프로토콜을 정하는 기준은 다음과 같습니다.

- Service 포트 이름이 `<protocol>[-<suffix>]` 형태이면 해당 프로토콜로 판단
- `appProtocol` 필드가 있으면 포트 이름보다 우선
- 둘 다 없으면 HTTP/1.1과 HTTP/2에 한해 자동 감지 시도

자동 감지로 프로토콜을 판별하지 못한 연결은 TCP로 처리합니다. 예를 들어 MySQL은 서버가 먼저 데이터를 보내는 server-first 프로토콜입니다. Istio 문서는 이런 프로토콜이 자동 감지와 맞지 않는다고 명시합니다. 이 주의 사항을 고려하면 포트 이름이나 `appProtocol`로 직접 선언하는 편이 안전해 보입니다.

파드마다 Envoy를 두는 배치는 격리와 비용을 함께 결정합니다. 한 파드의 Envoy 설정 오류나 메모리 사용이 다른 파드로 번지지 않지만, 파드가 늘면 Envoy도 그만큼 늘어납니다. 비용 수치는 [14 왜 서비스 메시인가]({{< relref "/platform/istio/fundamentals/14-why-service-mesh/index.md" >}})에서 다뤘습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| iptables 가로채기 | 인/아웃바운드 전부를 Envoy(15006/15001)로 돌리고 연결마다 HTTP/TCP 판별 | Istio 문서 protocol-selection | `✓` |
| 프로토콜 선택 순서 | 포트 이름, `appProtocol`(둘 다 있으면 appProtocol 우선), 자동 감지(HTTP/1.1·HTTP/2만) | 같은 문서 | `✓` |
| 감지 실패 시 TCP | 프로토콜을 판별하지 못하면 plain TCP로 취급 | 같은 문서 | `✓` |
| TCP 분류의 결과 | HTTP 라우팅·재시도·헤더 조작과 `istio_requests_total`이 걸리지 않고 `istio_tcp_*`만 나옴 | 같은 문서와 Istio 표준 메트릭 문서 | `✓` |
| server-first 프로토콜 | MySQL 같은 server-first 프로토콜은 자동 감지와 맞지 않음 | 같은 문서 | `✓` |
| 직접 선언 권고 | 위 사실에서 이끌어 낸 판단 | — | `Σ` |

{{% /details %}}

## 3. Ambient — ztunnel이 L4, waypoint가 L7

Ambient에서는 L7이 필요 없는 워크로드가 Envoy를 거치지 않습니다. 노드마다 배치한 ztunnel이 L4를 처리하고, HTTP 기능이 필요한 곳에만 waypoint를 추가합니다. Istio 문서에 따르면 ambient는 1.24에서 GA가 됐습니다.

ztunnel은 Rust로 만든 L4 전용 프록시이며 DaemonSet으로 실행됩니다. mTLS(상호 TLS 인증), L4 인가, TCP 텔레메트리를 담당하고 HTTP는 파싱하지 않습니다. Envoy 기반의 waypoint는 네임스페이스나 서비스 단위로 선택해서 배포합니다.

이 분담은 사용할 수 있는 기능의 경계이기도 합니다. waypoint가 없으면 HTTP 라우팅, 재시도, 장애 주입, L7 인가, HTTP 메트릭을 쓸 수 없습니다. L7 속성을 포함한 인가 정책을 ztunnel에 적용하는 것으로 이를 대신할 수도 없습니다. Istio의 L4 정책 문서는 그런 정책이 DENY 정책으로 처리되어 안전한 쪽으로 실패한다고 설명합니다. 정책을 무시하고 통과시키지는 않지만, 의도하지 않은 차단이 발생할 수 있습니다.

ztunnel과 waypoint 사이, 노드 사이의 통신에는 HBONE을 사용합니다. HBONE은 HTTP/2 CONNECT를 사용하는 mTLS 터널입니다. 포트 15008을 쓰며, 한 연결 안에서 여러 애플리케이션 연결을 각각의 스트림으로 다중화합니다. 앞 도식의 ambient 경로에서 `HBONE`으로 표시한 구간이 여기에 해당합니다.

외부 팀이 Linkerd와 Cilium을 두고 Istio를 고른 이유는 [왜 Ambient mode인가]({{< relref "/platform/istio/ambient/01-why-ambient-mode/index.md" >}})의 2절에 요약해 두었습니다. 사이드카에서 ambient로 옮길 때 유지되는 기능과 달라지는 동작은 [10 Ambient 이행 심사]({{< relref "/platform/istio/ambient/10-ambient-migration-questions.md" >}})에서 살펴봅니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| ztunnel | 노드당 DaemonSet, Rust, L4 전용(mTLS, L4 인가, TCP 텔레메트리), HTTP 파싱 안 함 | Istio 문서 ambient overview | `✓` |
| ambient GA | Istio 1.24 | 같은 문서 | `✓` |
| waypoint | Envoy 기반 선택 배포, L7 처리를 추가. 네임스페이스·서비스 단위 | Istio 문서 ambient waypoint | `✓` |
| waypoint 없을 때 | HTTP 라우팅·재시도·장애 주입·L7 인가·HTTP 메트릭 없음. 문서 기능 설명을 조합해 표로 재구성 | Istio 문서 waypoint, 트래픽 관리 문서 | `✓` |
| L7 정책을 ztunnel에 걸 때 | L7 속성 정책을 ztunnel에 걸면 DENY 정책이 되어 안전한 쪽으로 실패 | Istio 문서 ambient l4-policy | `✓` |
| HBONE | HTTP/2 CONNECT 위 mTLS 터널, 포트 15008, 한 연결에 여러 스트림 다중화 | Istio 문서 ambient hbone | `✓` |

{{% /details %}}

## 4. Cilium — L4는 eBPF, L7은 노드의 공유 Envoy

Cilium에서는 L4 정책과 서비스 부하 분산을 처리할 때 Envoy를 거치지 않습니다. Cilium의 kube-proxy 대체 문서에 따르면 커널의 eBPF가 ClusterIP, NodePort, LoadBalancer, externalIPs, hostPort를 eBPF 맵으로 처리합니다. 소켓 LB(부하 분산)는 애플리케이션이 `connect()`를 호출할 때 Service VIP를 백엔드 IP로 바꿉니다. 패킷마다 DNAT를 거치는 대신 연결 단위로 부하를 나누며, L3/L4 NetworkPolicy도 eBPF에서 집행합니다.

Envoy는 L7 처리가 필요한 트래픽을 받습니다. Cilium 문서의 설명을 조건별로 묶으면 다음과 같습니다.

- L7 규칙이 있는 CiliumNetworkPolicy가 해당 트래픽에 적용됨
- Ingress나 Gateway API 리스너로 들어옴
- CiliumEnvoyConfig가 특정 서비스를 리다이렉트하도록 설정됨
- 정책으로 켠 L7 가시성이 적용됨

이 조건에 해당하지 않는 트래픽은 eBPF 경로만 거칩니다. Isovalent 블로그도 사이드카 없이 필요한 L7 트래픽만 노드의 Envoy로 보낸다고 설명합니다.

Cilium에는 사이드카가 없습니다. Cilium의 Envoy는 노드 단위로 배포됩니다. Cilium 1.16부터는 별도 DaemonSet인 `cilium-envoy`가 기본 배포 방식이며, 이전에는 cilium-agent 안에 Envoy가 포함돼 있었습니다. Cilium의 Envoy 문서는 이 분리로 agent와 Envoy를 각각 재시작하고 리소스 제한도 따로 설정할 수 있다고 설명합니다.

프로세스를 분리해도 Envoy 하나를 공유하는 범위는 노드 전체입니다. waypoint는 네임스페이스나 서비스 단위로 나눌 수 있지만, cilium-envoy 프로세스 하나는 해당 노드의 모든 워크로드에서 오는 L7 트래픽을 받습니다. 구조로 보면 Envoy 장애, 재시작, 메모리 압박의 영향이 그 노드의 L7 트래픽 전체에 미칠 것으로 예상됩니다.

비교 블로그들은 테넌트별 자원 격리가 없어 한 워크로드의 Envoy 사용량이 이웃 워크로드에 영향을 줄 수 있다는 점도 공통으로 지적합니다. Istio 진영 블로그는 이 문제를 waypoint로 L7을 분리한 이유로 제시합니다. 해당 주장에 대한 중립 검증은 확인하지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| eBPF L4 | kube-proxy 대체. ClusterIP/NodePort/LoadBalancer/externalIPs/hostPort를 eBPF 맵으로 처리 | Cilium 문서 kubeproxy-free | `✓` |
| 소켓 LB | `connect()` 시점에 VIP를 백엔드 IP로 변환. 요약이며 원문 문구가 아님 | 같은 문서 | `✓` |
| L3/L4 정책 | eBPF에서 집행, Envoy 미경유 | Cilium 문서 | `✓` |
| cilium-envoy | 1.16부터 별도 DaemonSet, 이전에는 agent 내장. agent와 재시작·리소스 제한 분리. 요약 | Cilium 문서 proxy/envoy | `✓` |
| Envoy로 가는 조건 4가지 | L7 CNP, Ingress/Gateway 리스너, CEC 리다이렉트, 정책으로 켠 L7 가시성. 요약 | Cilium 문서 servicemesh | `✓` |
| 필요할 때만 노드 Envoy로 | 사이드카 없이 L7만 per-node Envoy로 리다이렉트 | Isovalent 블로그 | `Ⓥ` |
| 장애 반경이 노드 | Envoy 장애·재시작·메모리 압박이 노드 전체 L7에 영향. 구조에서 이끌어 낸 것 | — | `≈` |
| 자원 격리 없음(noisy neighbor) | 테넌트별 격리 없음. 비교 블로그의 공통 지적 | 비교 블로그 | `≈` |
| waypoint 분리의 이유 | Istio 쪽 주장 | Istio 진영 블로그 | `Ⓥ` |
| 중립 벤치 | 확인하지 못함 | — | `?` |

{{% /details %}}

## 5. L4와 L7에서 각각 무엇이 가능한가

아래 표는 각 프로젝트 문서의 기능 설명을 같은 항목으로 맞춘 것입니다. O/X는 직접 실험한 결과가 아닌 문서 서술 기준입니다.

| 기능 | ztunnel (L4) | waypoint (L7) | Cilium eBPF (L4) | Cilium Envoy (L7) |
|---|---|---|---|---|
| 워크로드 ID 기반 mTLS | O | O | X (ztunnel 암호화는 Beta, TCP만) | X (ztunnel 암호화는 Beta, TCP만) |
| L3/L4 정책 | O | O | O | – (eBPF가 처리) |
| L7 정책 (method·path·header) | X | O | X | O |
| HTTP 라우팅·가중치·rewrite·헤더 | X | O | X | O |
| 타임아웃 | X | O | X | O |
| 재시도 | X | O | X | O (Gateway API, experimental CRD 필요) |
| TCP 메트릭 | O | O | flow(Hubble) | flow(Hubble) |
| HTTP 메트릭 | X | O | X | L7 정책 걸린 트래픽만 |

도식은 HTTP 해석이 필요한지에 따라 요청 경로가 어떻게 달라지는지 보여줍니다.

{{< flow src="_flow/5-l4와-l7의-경계.json" />}}

HTTP를 해석해야 하는 연결이라면 ambient와 Cilium 모두 L7 프록시가 필요합니다. Ambient는 서비스 앞의 waypoint로, Cilium은 노드의 Envoy로 요청을 보냅니다. HTTP 해석이 필요 없을 때는 각각 ztunnel과 eBPF 경로에서 처리하므로 L7 프록시를 거치지 않습니다. 사이드카에는 이런 경로 분리가 없습니다. 파드의 Envoy 하나가 L4와 L7을 모두 처리합니다.

Cilium eBPF는 L4 정책과 서비스 부하 분산을 커널에서 처리하므로 프록시 홉이 없습니다. Istio 쪽이 HTTP 라우팅과 재시도, 기본 HTTP 메트릭을 더 넓게 갖추고 있습니다. Cilium의 Hubble은 L7 정책이 적용된 트래픽에 한해 L7 flow를 생성합니다.

재시도는 Cilium Envoy 칸에 O가 있어도 experimental CRD 설치가 필요합니다. 조사에서 HTTPRoute 재시도 지원을 처음 확인한 자료는 Cilium 1.20.0의 Gateway API conformance 리포트이며, experimental CRD를 설치해야 합니다. 이 확인 시점을 근거로 이전 버전이 미지원이었다고 단정하지는 않습니다. 서킷 브레이킹과 장애 주입은 [04편]({{< relref "/platform/istio/cilium/04-retry-resilience/index.md" >}})에서 따로 비교합니다.

같은 HTTP 기능을 제공하더라도 요청을 받는 프록시의 범위는 다릅니다. 앞에서 본 장애 반경과 격리 단위는 표에 드러나지 않는 차이입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| ztunnel/waypoint 기능 분담 | mTLS·L4 인가·TCP 메트릭은 ztunnel, L7 인가·라우팅·재시도·HTTP 메트릭은 waypoint | Istio 문서 ambient overview·waypoint·l4-policy | `✓` (조합) |
| Cilium eBPF L3/L4 | 정책과 서비스 LB를 eBPF에서 처리 | Cilium 문서 | `✓` |
| Cilium Envoy L7 | L7 정책, Gateway API 라우팅, 타임아웃 | Cilium 문서 gateway-api, policy language | `✓` |
| Cilium 재시도 | HTTPRouteRetry 등 재시도 항목이 1.20.0 conformance 리포트에서 지원. experimental CRD 필요. 이전 버전 미지원이라고 단정하지는 않음 | Gateway API conformance 리포트(Cilium 1.20.0), Cilium 문서 | `✓` |
| Cilium HTTP 메트릭 | L7 정책이 걸린 트래픽에 한해 Hubble이 L7 flow 생성 | Cilium 문서 hubble | `✓` |
| 두 표현을 같은 틀에 맞춘 것 | 표의 O/X는 문서 서술 기준이며 직접 실험한 값이 아님 | — | `Σ` |

{{% /details %}}

## 6. mTLS는 데이터 경로에 있느냐가 다르다

Istio 사이드카와 ambient에서는 워크로드 인증서로 맺은 mTLS 연결이 애플리케이션 데이터도 운반합니다. 인증과 암호화가 같은 연결에서 이루어지며, 이 기능은 GA입니다. Cilium을 비교할 때는 deprecated된 Mutual Authentication과 대체 기능인 ztunnel 투명 암호화를 구분해야 합니다.

Cilium의 Mutual Authentication은 신원 확인과 데이터 암호화를 분리합니다. SPIFFE/SPIRE로 신원을 발급받고 정책에 `authentication.mode: required`를 설정하면, 첫 통신 전에 cilium-agent끼리 대역 밖에서 핸드셰이크를 수행해 신원을 확인합니다. 애플리케이션 데이터는 이 인증 연결로 암호화되지 않습니다. 암호화가 필요하면 WireGuard나 IPsec을 별도로 켜야 하며, 이들은 노드 간 암호화를 제공할 뿐 워크로드 신원 기반 mTLS는 아닙니다.

Cilium 문서에 따르면 Mutual Authentication은 Beta 상태에서 1.20에 deprecated됐고, 대체재로 ztunnel을 권장합니다. ztunnel 투명 암호화는 1.19에 도입됐으며 1.20.3 문서에서도 Beta입니다. 노드마다 실행되는 ztunnel이 파드 간 통신에 L4 mTLS와 인증을 제공하고, HBONE 터널은 포트 15008을 사용합니다. 네임스페이스에 `io.cilium/mtls-enabled=true` 라벨을 붙여 활성화합니다.

사용 범위에는 다음 제약이 있습니다.

- TCP만 지원
- 네임스페이스 단위로만 등록 가능하며 파드 단위 등록은 불가
- 통신 양쪽이 모두 등록돼 있어야 함
- ClusterMesh와 함께 사용 불가
- 호스트 네트워크 파드 제외
- L4 정책은 15008 포트를 대상으로 할 때만 적용

Cilium의 워크로드 신원 기반 mTLS는 현재 Beta 단계의 TCP 전용 기능이며, L7 인증서 기반 정책과 이어지지 않습니다. waypoint나 L7 연동, Istio ambient와의 상호운용은 문서에서 확인하지 못했습니다.

Istio 진영 블로그는 이전 Mutual Auth에서 인증과 데이터 경로가 분리돼 IP 재사용 시 경합이 생길 수 있다고 비판했습니다. 이 비판은 이미 deprecated된 기능을 대상으로 하므로, 여기서는 그 타당성을 검토하지 않습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Mutual Authentication | SPIFFE/SPIRE, 정책 `authentication.mode: required`, 첫 통신 전 agent 간 대역 외 핸드셰이크. 데이터 암호화는 하지 않아 별도 암호화가 필요 | Cilium 문서 mutual-authentication | `✓` |
| deprecated | Beta였고 1.20에서 deprecated, 대체로 ztunnel 권장 | 같은 문서 | `✓` |
| WireGuard/IPsec | 노드 간 암호화, 워크로드 신원 mTLS 아님 | Cilium 문서 encryption | `✓` |
| ztunnel 투명 암호화 | 1.19 Beta 도입, 1.20.3에서도 Beta. 노드당 ztunnel, HBONE 15008, 네임스페이스 라벨 `io.cilium/mtls-enabled=true` | Cilium 문서 encryption-ztunnel | `✓` |
| ztunnel 제약 | TCP만, 네임스페이스 단위 등록, 양쪽 등록 필요, ClusterMesh 동시 사용 불가, 호스트 네트워크 파드 제외, L4 정책은 15008 대상일 때만 | 같은 문서 | `✓` |
| L7 연동·ambient 상호운용 | 문서에서 확인하지 못함 | — | `?` |
| 구 Mutual Auth 비판 | 인증과 데이터 경로 분리, IP 재사용 경합 우려 | Istio 진영 블로그 | `Ⓥ` |

{{% /details %}}

## 7. 다음 편으로 이어지는 질문

Envoy를 배치한 뒤에는 어떤 API로 동작을 제어할지 살펴봐야 합니다. 02편에서는 Gateway 하나가 어떤 파드와 Service로 구현되는지 확인합니다. 03~05편에서는 관측, 재시도, 요청 변형을 같은 틀에서 비교하며 각 API로 어디까지 표현할 수 있는지 살펴봅니다. 두 시스템을 함께 쓰는 경우는 [05편]({{< relref "/platform/istio/cilium/05-request-customization/index.md" >}})의 마지막 절에서 다룹니다.

## 참고 자료

- [Istio — Protocol Selection](https://istio.io/latest/docs/ops/configuration/traffic-management/protocol-selection/)
- [Istio — Ambient overview](https://istio.io/latest/docs/ambient/overview/)
- [Istio — Waypoint 사용](https://istio.io/latest/docs/ambient/usage/waypoint/)
- [Istio — L4 정책](https://istio.io/latest/docs/ambient/usage/l4-policy/)
- [Istio — HBONE](https://istio.io/latest/docs/ambient/architecture/hbone/)
- [Cilium — kube-proxy 없는 구성](https://docs.cilium.io/en/stable/network/kubernetes/kubeproxy-free/)
- [Cilium — Envoy](https://docs.cilium.io/en/stable/security/network/proxy/envoy/)
- [Cilium — Service Mesh](https://docs.cilium.io/en/stable/network/servicemesh/)
- [Cilium — Mutual Authentication](https://docs.cilium.io/en/stable/network/servicemesh/mutual-authentication/mutual-authentication/)
- [Cilium — ztunnel 투명 암호화](https://docs.cilium.io/en/stable/security/network/encryption-ztunnel/)
- [Cilium — 투명 암호화](https://docs.cilium.io/en/stable/security/network/encryption/)
