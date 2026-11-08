---
title: "한 요청의 여행"
linkTitle: "Istio · 한 요청의 여행"
description: "L4와 L7, 게이트웨이와 사이드카, mTLS와 관측성을 요청 하나의 경로와 그림으로 익히는 Istio 스터디."
date: 2026-11-07
lastmod: 2026-11-08
inlineToc: false
weight: 10
comments: false
url: "/study/istio-mesh/"
aliases:
  - "/istio/mesh-traffic/"
---

# 한 요청의 여행 — L4에서 관측성까지

요청이 어디로 가고, 어느 자리에서 암호화되고, 무엇을 남기는지 그림으로 따라갑니다.

<span id="이-시리즈가-따라가는-길"></span>

{{< flow src="_flow/1-한-요청의-여행.json" />}}

## 이 분류에서 찾기 {#section-navigation}

1. [한 연결에 묶인 길]({{< relref "/study/istio-mesh/01-l4-l7-before-mesh/index.md" >}}) — L4와 L7의 분산 단위
2. [다시 길을 고르는 문]({{< relref "/study/istio-mesh/02-gateway-to-sidecar/index.md" >}}) — 게이트웨이에서 사이드카까지
3. [신원을 주고받는 두 프록시]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}}) — 프록시 사이의 mTLS
4. [요청을 읽는 갈림길]({{< relref "/study/istio-mesh/04-l7-only-features/index.md" >}}) — 분산·재시도·인가
5. [요청 뒤에 남은 발자국]({{< relref "/study/istio-mesh/05-logs-and-tracing/index.md" >}}) — 메트릭·로그·트레이스

Istio 1.31.4·Envoy 1.39 계열의 **사이드카 모드** 기준입니다. 운영 설정과 장애 사례는 [Istio 문서]({{< relref "/platform/istio/_index.md" >}}), 노드 단위 프록시는 [Ambient]({{< relref "/platform/istio/ambient/_index.md" >}})에서 이어집니다.
