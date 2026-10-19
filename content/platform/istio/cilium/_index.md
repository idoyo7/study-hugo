---
title: "Istio와 Cilium"
linkTitle: "Istio vs Cilium"
description: "Istio와 Cilium이 L4·L7 처리, Gateway API, 관측성, 재시도, 요청 커스터마이즈에서 어떻게 갈리는지 2026-10-19 기준 공식 문서로 비교한다."
date: 2026-10-19
lastmod: 2026-10-19
weight: 45
comments: false
url: "/istio/cilium/"
---

# Istio와 Cilium — 같은 Envoy, 다른 자리

## 이 분류에서 찾기 {#section-navigation}

- [01 L4와 L7 — 프록시는 어디에 있나]({{< relref "/platform/istio/cilium/01-l4-l7-proxy-placement/index.md" >}})
- [02 Gateway API 구현 — 게이트웨이 파드가 있는가]({{< relref "/platform/istio/cilium/02-gateway-api/index.md" >}})
- [03 관측성 — 기본으로 보이는 것과 켜야 보이는 것]({{< relref "/platform/istio/cilium/03-observability/index.md" >}})
- [04 재시도와 복원력 — 어느 API로 말할 수 있나]({{< relref "/platform/istio/cilium/04-retry-resilience/index.md" >}})
- [05 요청 커스터마이즈와 정책 — 헤더부터 ext_authz까지, 그리고 함께 쓰기]({{< relref "/platform/istio/cilium/05-request-customization/index.md" >}})

## 이 시리즈가 답하는 질문

Cilium이 Gateway API와 L7(애플리케이션 계층) 정책을 지원하니 Istio를 빼도 되는지 묻는 플랫폼 엔지니어를 위한 비교입니다. 둘 다 L7 처리는 Envoy가 맡지만, Envoy의 배치와 설정 API가 다르기 때문입니다. 이 시리즈는 Kubernetes 운영 경험이 있는 플랫폼 엔지니어가 그 차이를 따져 볼 수 있도록 썼습니다.

Envoy를 파드마다 둘 수도 있고, 서비스 앞의 waypoint에 둘 수도 있으며, 노드에서 공유할 수도 있습니다. 같은 Envoy를 쓰더라도 어디에 몇 개를 두느냐에 따라 비교해야 할 지점이 달라집니다. 설정을 표현하는 방식도 살펴봐야 합니다. Istio는 VirtualService·DestinationRule 같은 고수준 리소스를 제공하고, Cilium에서는 Gateway API 표준과 CiliumEnvoyConfig 같은 저수준 설정을 사용합니다.

L4(전송 계층)는 Cilium이 eBPF로 훨씬 가볍게 처리합니다. L7 정책·재시도·관측의 기본값과 표현력은 Istio 쪽이 넓습니다. 이런 차이 때문에 많은 팀이 Cilium CNI 위에 Istio를 올려 함께 씁니다. 각 편에서는 공식 문서를 바탕으로 기능과 동작을 비교하며, 문서에서 확인한 내용과 확인하지 못한 내용을 구분합니다.

## 문서 지도

필요한 기능을 바로 찾아볼 수 있도록 각 편의 범위도 나눴습니다.

- [01 L4와 L7]({{< relref "/platform/istio/cilium/01-l4-l7-proxy-placement/index.md" >}}) — 사이드카, ambient, Cilium이 프록시를 두는 위치를 비교하고 L4·L7 기능의 경계와 노드 공유 Envoy의 장애 반경을 살핀다.
- [02 Gateway API 구현]({{< relref "/platform/istio/cilium/02-gateway-api/index.md" >}}) — Gateway마다 Envoy 파드를 만드는 방식과 노드 Envoy를 공유하는 방식을 비교한다. 지원 리소스, GAMMA, 게이트웨이 격리도 다룬다.
- [03 관측성]({{< relref "/platform/istio/cilium/03-observability/index.md" >}}) — Istio 표준 메트릭·액세스 로그·트레이싱이 보여 주는 정보와 Hubble이 관측하는 층의 차이를 살핀다.
- [04 재시도와 복원력]({{< relref "/platform/istio/cilium/04-retry-resilience/index.md" >}}) — 재시도·타임아웃·서킷 브레이킹을 설정할 때 각각 어느 리소스로 표현하는지 비교한다.
- [05 요청 커스터마이즈와 정책]({{< relref "/platform/istio/cilium/05-request-customization/index.md" >}}) — 헤더·rewrite, L7 인가와 확장을 다룬다. Cilium CNI 위에 Istio를 올릴 때의 주의 사항과 선택 기준도 살핀다.

기존 Istio 글에서 이어 읽는다면 [12 Envoy가 제공하는 것]({{< relref "/platform/istio/fundamentals/12-envoy-capabilities/index.md" >}})과 [Ambient]({{< relref "/platform/istio/ambient/_index.md" >}}) 섹션은 앞서 읽을 글입니다.

조사 기준일은 2026-10-19입니다. Istio 1.31.2 문서, Cilium stable 문서(1.20.3), Gateway API v1.6 계열을 기준으로 비교했습니다.
