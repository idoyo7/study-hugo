---
title: "한 요청의 여행"
linkTitle: "Istio · 한 요청의 여행"
description: "L4와 L7, 게이트웨이와 사이드카, mTLS와 관측성을 요청 하나의 경로와 그림으로 익히는 Istio 스터디."
date: 2026-11-07
lastmod: 2026-11-09
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

1. [연결 너머의 길 — NLB에서 사이드카 15006까지]({{< relref "/study/istio-mesh/01-to-the-gateway/index.md" >}}) — L4와 L7, 게이트웨이, 15006
2. [요청마다 달라지는 길 — 사이드카 통신과 L7 제어]({{< relref "/study/istio-mesh/02-between-proxies/index.md" >}}) — mTLS·HBONE, 분산·재시도·인가, response flag
3. [두 프록시의 발자국 — 메트릭·로그·트레이스]({{< relref "/study/istio-mesh/03-traces-left-behind/index.md" >}}) — 관측

Istio 1.31.4·Envoy 1.39 계열의 **사이드카 모드** 기준입니다. 운영 설정과 장애 사례는 [Istio 문서]({{< relref "/platform/istio/_index.md" >}}), 노드 단위 프록시는 [Ambient]({{< relref "/platform/istio/ambient/_index.md" >}})에서 이어집니다.
