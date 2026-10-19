---
title: "02 Gateway API 구현 — 게이트웨이 파드가 있는가"
description: "같은 Gateway API를 Istio는 Gateway마다 Envoy 파드로, Cilium은 LoadBalancer Service와 노드 Envoy로 구현하는 차이와 지원 리소스, GAMMA, 게이트웨이 격리 문제를 2026-10-19 기준으로 정리한다."
date: 2026-10-19
lastmod: 2026-10-19
weight: 2
url: "/istio/cilium/02-gateway-api/"
---

# 02 · Gateway API 구현 — 게이트웨이 파드가 있는가

## 1. 같은 Gateway를 만들면 무엇이 생기는가

Gateway를 만들었을 때 전용 Envoy 파드가 생기는지는 구현체에 달려 있습니다. Istio는 Gateway마다 파드를 만들고, Cilium은 노드의 Envoy로 트래픽을 보냅니다. 이 차이에 따라 게이트웨이의 자원 격리 방식, 노드 배치, 장애 범위가 달라집니다.

Gateway API는 쿠버네티스 표준 리소스입니다. Gateway에 HTTPRoute를 붙이는 YAML만 읽으면 Istio와 Cilium의 설정은 거의 같아 보입니다. 운영 방식을 비교하려면 그 YAML을 받은 컨트롤러가 클러스터 안에 무엇을 만드는지까지 봐야 합니다.

[01편]({{< relref "/platform/istio/cilium/01-l4-l7-proxy-placement/index.md" >}})에서 살펴본 Envoy의 배치 차이를 이번에는 Gateway 리소스에서 확인합니다. 범위는 외부에서 들어오는 남북 트래픽의 진입점, 지원 리소스, 서비스 사이의 트래픽에 Gateway API를 쓰는 GAMMA, 게이트웨이 격리입니다. 재시도·타임아웃 같은 정책은 [04편]({{< relref "/platform/istio/cilium/04-retry-resilience/index.md" >}})에서 다룹니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-19이며 Istio 1.31.2 문서(Gateway API v1.6.0 conformance), Cilium stable 문서(1.20.3, Gateway API v1.6.3)를 기준으로 했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 조사 범위 | Istio 1.31.2(Gateway API v1.6.0), Cilium stable 1.20.3(Gateway API v1.6.3) | 각 프로젝트 문서 | — |

{{% /details %}}

## 2. Istio는 Gateway마다 Service와 Deployment를 만든다

Istio 게이트웨이는 독립된 Envoy 파드로 동작합니다. Istio의 Gateway API 자동 배포 문서에 따르면, 컨트롤러는 Gateway마다 Service와 Deployment를 만들고 `<Gateway 이름>-<GatewayClass 이름>` 규칙으로 이름을 붙입니다. 이 Deployment의 Envoy 파드가 외부 트래픽을 받아 L7 라우팅을 처리합니다.

이 글의 판단으로는 리소스 요청·제한, 레플리카 수, 노드 배치를 파드 스펙으로 조정할 수 있다는 점이 운영상의 차이입니다. HPA와 PDB는 기본으로 생성되지 않습니다. Istio 문서는 배포 설정을 바꾸는 방법으로 `infrastructure.parametersRef`를 안내합니다.

ambient의 waypoint도 Gateway 리소스로 만듭니다. Waypoint 문서에서는 `gatewayClassName: istio-waypoint`를 지정하고, 리스너에 포트 15008과 HBONE 프로토콜을 사용합니다. 워크로드는 `istio.io/use-waypoint` 라벨로 사용할 waypoint를 가리킵니다. 외부 트래픽의 진입점뿐 아니라 서비스 앞에서 동작하는 waypoint도 Envoy 파드로 배포되는 것입니다.

Istio의 Gateway API GA 블로그에 따르면 ingress와 mesh(GAMMA) 지원은 모두 1.22에서 GA가 됐습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 자동 프로비저닝 | 기본으로 Gateway마다 Service와 Deployment 생성, 이름 `<Gateway name>-<GatewayClass name>` | Istio 문서 gateway-api 자동 배포 | `✓` |
| waypoint | `gatewayClassName: istio-waypoint`, 리스너 포트 15008·HBONE, `istio.io/use-waypoint` 라벨로 연결 | Istio 문서 waypoint | `✓` |
| GA 시점 | Istio 1.22에서 ingress·mesh 모두 GA | Istio 블로그 gateway-mesh-ga | `✓` |
| HPA·PDB | 기본으로 생성되지 않음, `infrastructure.parametersRef`로 변경 | Istio 문서 gateway-api | `✓` |
| 파드로 보인다는 함의 | 리소스·레플리카·배치를 파드 스펙으로 조정 | — | `Σ` |

{{% /details %}}

## 3. Cilium은 전용 파드 없이 노드 Envoy로 보낸다

아래 도식은 외부 트래픽이 Istio와 Cilium의 Envoy에 도달하는 경로를 비교합니다.

{{< flow src="_flow/2-게이트웨이-트래픽-경로.json" />}}

Cilium에서는 Gateway를 만들어도 게이트웨이용 Deployment가 생기지 않습니다. Cilium Gateway API 문서에 따르면 operator는 LoadBalancer Service(`cilium-gateway-<이름>`)와 CiliumEnvoyConfig를 만듭니다. LoadBalancer로 들어온 트래픽은 eBPF가 TPROXY 방식으로 각 노드의 Envoy에 전달합니다.

Gateway마다 Envoy 프로세스를 추가하지 않으므로 게이트웨이를 늘릴 때 자원 부담이 가볍습니다. 게이트웨이 트래픽과 워크로드의 L7 처리도 같은 노드 Envoy를 공유하는 것으로 보입니다. 전용 파드가 없다는 사실은 자원 사용뿐 아니라 게이트웨이와 워크로드를 얼마나 분리할 수 있는지와도 연결됩니다.

Cilium 문서는 1.16부터 호스트 네트워크에 리스너를 여는 `gatewayAPI.hostNetwork.enabled` 모드도 제공합니다. 이 모드는 TCPRoute·UDPRoute와 함께 쓸 수 없습니다. 별도로 제공하는 Ingress 컨트롤러 역시 같은 노드 Envoy를 사용하며, Ingress에는 `dedicated`와 `shared` 모드가 있습니다. Gateway API와 Ingress 모두 kubeProxyReplacement가 필요하다고 Cilium 문서가 설명합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 구현 방식 | operator가 LoadBalancer Service `cilium-gateway-<name>`과 CiliumEnvoyConfig 생성, eBPF가 노드 Envoy로 TPROXY 리다이렉트, 별도 Deployment 없음. 요약 | Cilium 문서 gateway-api | `✓` |
| 공유 Envoy의 함의 | 게이트웨이 트래픽과 워크로드 L7이 같은 노드 Envoy를 공유 | — | `≈` |
| hostNetwork 모드 | `gatewayAPI.hostNetwork.enabled`, 1.16부터 | Cilium 문서 | `✓` |
| Ingress 컨트롤러 | 같은 노드 Envoy 공유, `dedicated`/`shared` 모드 | Cilium 문서 servicemesh/ingress | `✓` |
| kubeProxyReplacement | Gateway API·Ingress 모두 필요. 요약 | Cilium 문서 | `✓` |

{{% /details %}}

## 4. 지원 리소스와 conformance를 읽는 기준

| 항목 | Istio | Cilium |
|---|---|---|
| HTTPRoute | O (ambient 문서 기준 Beta) | O |
| GRPCRoute | 확인 못 함 | O |
| TLSRoute | Alpha (ambient 문서) | O (passthrough만) |
| TCPRoute·UDPRoute | TCPRoute Alpha (ambient 문서), UDPRoute 확인 못 함 | O (선택 CRD) |
| BackendTLSPolicy | O (conformance 리포트) | O |
| ListenerSet | O (conformance 리포트) | O |
| ReferenceGrant | 확인 못 함 | O |
| conformance | Gateway API v1.6.0, Gateway·Mesh | v1.6.1 리포트(Cilium 1.20.0): HTTP·GRPC·TLS·TCP·UDP, MESH-HTTP·MESH-GRPC 통과 |

두 구현 모두 Gateway API를 지원하지만, 리소스 이름이 같다고 기능 범위와 성숙도까지 같지는 않습니다. 표에서 Cilium의 지원 항목은 고르게 채워져 있습니다. Istio의 ‘확인 못 함’은 이번 조사에서 지원 범위를 확인하지 못했다는 뜻이며, 미지원 판정이 아닙니다.

Cilium stable 문서(1.20.3)는 Gateway API v1.6.3 지원과 Core conformance(적합성) 테스트 전체 통과를 명시합니다. 지원 목록에는 GatewayClass, Gateway, HTTPRoute, GRPCRoute, TLSRoute, TCPRoute, UDPRoute, BackendTLSPolicy, ReferenceGrant, ListenerSet이 있습니다. 1.19의 지원 버전은 Gateway API v1.4였으므로, Cilium minor 버전과 함께 Gateway API 버전도 확인해야 합니다.

지원 목록 다음에는 설치 조건과 동작 범위를 읽어야 합니다. Cilium 1.20에서 도입한 TCPRoute·UDPRoute는 선택 CRD라서 설치하지 않으면 해당 기능이 꺼지고, ListenerSet도 CRD가 없으면 비활성화됩니다. TCPRoute·UDPRoute는 호스트 네트워크 모드와 함께 쓸 수 없습니다. TLSRoute는 passthrough만 지원하며, Cilium 1.20.0의 Gateway API v1.6.1 conformance 리포트는 Terminate·Mixed 모드를 unsupported로 표시합니다.

Istio 1.31의 Gateway API v1.6.0 conformance 리포트에서는 Gateway와 Mesh가 모두 Conformant입니다. experimental 채널의 지원 항목에는 HTTPRoute 재시도, 타임아웃, 미러링, CORS, rewrite, redirect, 헤더 수정과 BackendTLSPolicy, ListenerSet이 포함됩니다. Istio ambient 문서의 API 등급은 HTTPRoute가 Beta, TCPRoute·TLSRoute가 Alpha입니다.

TCP·TLS를 Gateway API로 구성하려면 이처럼 conformance 결과와 개별 리소스의 등급·제약을 함께 확인해야 합니다. 실험 채널에서 지원하는 기능의 범위와 성숙도 표기가 서로 다르므로, 도입 전에 사용할 리소스를 각 문서의 목록과 대조하시기 바랍니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Cilium 지원 버전 | Gateway API v1.6.3, Core conformance 테스트 전부 통과(문서 문구: "all the Core conformance tests are passed") | Cilium 문서 gateway-api | `✓` |
| Cilium 리소스 | GatewayClass, Gateway, HTTPRoute, GRPCRoute, TLSRoute, TCPRoute, UDPRoute, BackendTLSPolicy, ReferenceGrant, ListenerSet. TCPRoute·UDPRoute는 1.20 도입, 선택 CRD(ListenerSet도 CRD 없으면 비활성). 호스트 네트워크 모드는 TCP/UDPRoute와 호환되지 않음. TLSRoute는 Terminate·Mixed unsupported | 같은 문서, Gateway API conformance 리포트(Cilium 1.20.0, v1.6.1) | `✓` |
| Istio conformance | Gateway API v1.6.0, Gateway·Mesh 모두 Conformant. experimental 채널 리포트에 재시도·타임아웃·미러링·CORS·rewrite·redirect·헤더 수정, BackendTLSPolicy, ListenerSet 포함 | Istio 1.31 conformance 리포트 | `✓` |
| Istio API 등급 | HTTPRoute Beta, TLSRoute·TCPRoute Alpha | Istio 문서 ambient l7-features | `✓` |
| Istio의 나머지 리소스 | GRPCRoute·UDPRoute·ReferenceGrant 지원 범위 | — | `?` |

{{% /details %}}

## 5. GAMMA로 서비스 사이에 라우팅 규칙 붙이기

GAMMA는 Gateway API를 서비스 사이의 동서 트래픽에 쓰는 규약입니다. HTTPRoute의 `parentRef`를 Service로 지정하면 해당 서비스로 향하는 트래픽에 라우팅 규칙이 적용됩니다. Istio와 Cilium 모두 이 방식을 사용합니다.

이때는 리소스를 붙이는 방식과 함께 지원 제약도 살펴야 합니다. Istio의 Gateway API GA 블로그는 GAMMA가 1.22에서 GA가 됐다고 설명합니다. Cilium GAMMA 문서에 명시된 지원 리소스는 HTTPRoute, GRPCRoute, ReferenceGrant입니다. 서비스를 소유한 쪽이 만드는 producer route만 지원하고 consumer route는 지원하지 않으며, conformance 리포트에서도 MeshConsumerRoute는 unsupported입니다.

Cilium에서 GAMMA를 켜려면 `kubeProxyReplacement=true`와 `l7Proxy=true`가 필요합니다. GAMMA 문서에 따르면 이 트래픽도 노드 Envoy가 처리합니다. 따라서 서비스 간 L7 경로의 장애 범위와 격리 단위는 [01편]({{< relref "/platform/istio/cilium/01-l4-l7-proxy-placement/index.md" >}})에서 살펴본 배치를 기준으로 이해하면 됩니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Istio GAMMA | HTTPRoute의 `parentRef`를 Service로 지정. 1.22 GA | Istio 블로그 gateway-mesh-ga | `✓` |
| Cilium GAMMA | `parentRef`=Service. HTTPRoute·GRPCRoute·ReferenceGrant, producer route만(consumer route 미지원). 조건 `kubeProxyReplacement=true`, `l7Proxy=true` | Cilium 문서 gamma | `✓` |
| GAMMA 트래픽 처리 위치 | 노드 Envoy | 같은 문서 | `✓` |

{{% /details %}}

## 6. 게이트웨이 전용 노드 배치를 그대로 쓸 수 있는가

Istio에서는 Gateway API로 만든 게이트웨이에도 전용 노드 배치라는 발상을 적용할 수 있습니다. 기존 [03 데이터 플레인과 Ingress Gateway]({{< relref "/platform/istio/operations/03-gateway-node-isolation/index.md" >}})는 독립된 Ingress Gateway 파드를 전용 노드로 분리했습니다. Istio Gateway API 문서에서 설명하는 게이트웨이 역시 Gateway마다 생성되는 Deployment의 파드이므로, 배치 대상으로 삼을 파드가 있습니다.

Cilium에서는 그 방식이 그대로 대응되지 않는 것으로 보입니다. 게이트웨이 전용 파드가 없고 노드 Envoy로 트래픽을 보내기 때문에, 게이트웨이 파드를 특정 노드에 모으는 방법으로 워크로드와 분리하기는 어렵다는 추정입니다.

hostNetwork 모드가 격리에 얼마나 도움이 되는지는 확인하지 못했습니다. 게이트웨이와 워크로드의 자원 경쟁을 분리해야 한다면, 필요한 격리가 가능한지를 도입 전 검증 항목에 포함하는 것이 좋습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Istio 게이트웨이는 독립 파드 | Gateway마다 Deployment 생성 | Istio 문서 gateway-api | `✓` |
| Cilium에서 전용 노드 분리가 직접 대응 안 됨 | 전용 파드 없음, 노드 Envoy 공유라는 구조에서 도출 | — | `≈` |
| hostNetwork 모드의 효과 | 격리에 얼마나 도움이 되는지 | — | `?` |

{{% /details %}}

## 참고 자료

- [Istio — Gateway API 자동 배포](https://istio.io/latest/docs/tasks/traffic-management/ingress/gateway-api/#automated-deployment)
- [Istio — Gateway API GA 블로그](https://istio.io/latest/blog/2024/gateway-mesh-ga/)
- [Istio — Waypoint 사용](https://istio.io/latest/docs/ambient/usage/waypoint/)
- [Gateway API — Implementations](https://gateway-api.sigs.k8s.io/implementations/)
- [Cilium — Gateway API](https://docs.cilium.io/en/stable/network/servicemesh/gateway-api/gateway-api/)
- [Cilium — GAMMA](https://docs.cilium.io/en/stable/network/servicemesh/gateway-api/gamma/)
- [Cilium — Ingress](https://docs.cilium.io/en/stable/network/servicemesh/ingress/)
