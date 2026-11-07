---
title: "한 요청의 여행"
linkTitle: "Istio · 한 요청의 여행"
description: "요청 하나가 L4에서 L7로 올라가 게이트웨이와 사이드카를 지나고, 프록시끼리 오가며 무엇을 할 수 있게 되고 무엇이 보이게 되는지를 다섯 편으로 따라간다. Istio 1.31.4 기준."
date: 2026-11-07
lastmod: 2026-11-07
weight: 10
comments: false
url: "/study/istio-mesh/"
aliases:
  - "/istio/mesh-traffic/"
---

# 한 요청의 여행 — L4에서 관측성까지, Istio 메시 다섯 편

## 이 분류에서 찾기 {#section-navigation}

- [01 한 번 맺은 연결은 길을 바꾸지 않는다 — 메시 이전의 L4와 L7]({{< relref "/study/istio-mesh/01-l4-l7-before-mesh/index.md" >}})
- [02 문을 지나 다시 길을 고른다 — 게이트웨이에서 사이드카까지]({{< relref "/study/istio-mesh/02-gateway-to-sidecar/index.md" >}})
- [03 낯선 두 프록시가 신분증을 주고받는 법 — 사이드카와 사이드카 사이]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}})
- [04 요청을 읽는 곳에서 길은 달라진다 — L7 프록시가 여는 기능]({{< relref "/study/istio-mesh/04-l7-only-features/index.md" >}})
- [05 요청이 지나간 자리에 남는 발자국 — 메트릭·로그·트레이스]({{< relref "/study/istio-mesh/05-logs-and-tracing/index.md" >}})

## 이 시리즈가 따라가는 길

Istio 이야기는 그동안 요청 경로, 게이트웨이 격리, Envoy 기능, 관측성처럼 주제별로 흩어져 있었습니다. 이 시리즈는 그 조각을 요청 하나의 경로로 다시 엮습니다. 메시가 없을 때 L4와 L7이 각각 무엇을 나누는지에서 출발해, 외부 요청이 Ingress Gateway를 지나 사이드카에 닿는 과정, 사이드카끼리 mTLS로 주고받는 방식, 양쪽이 모두 L7 프록시라서 생기는 기능, 그 결과로 남는 메트릭·로그·트레이스까지 차례로 올라갑니다.

기준은 사이드카 모드입니다. ambient는 편마다 짧은 대조로만 다루고, 깊은 내용은 [Ambient]({{< relref "/platform/istio/ambient/_index.md" >}}) 섹션에 있습니다. 앞서 쓴 [11 요청 경로 해부]({{< relref "/platform/istio/fundamentals/11-request-path-anatomy/index.md" >}})와 [12 Envoy가 제공하는 것]({{< relref "/platform/istio/fundamentals/12-envoy-capabilities/index.md" >}})을 함께 읽으면 프록시 내부 배선과 부품 쪽을 보충할 수 있습니다.

| 편 | 다루는 구간 |
|---|---|
| 01 | 메시 이전 — kube-proxy·NLB의 연결 단위 분산과 nginx·ALB의 요청 단위 분산, TLS 종료 위치, 앱 라이브러리 재시도 |
| 02 | 외부 LB → Ingress Gateway → 사이드카 — Gateway·VirtualService 번역, TLS 종료와 mTLS 재암호화, 15006 inbound |
| 03 | 사이드카 → 사이드카 — 15001 outbound, 원래 목적지 복원, EDS, mTLS와 SPIFFE 신원, 프로토콜 감지, ambient HBONE 대조 |
| 04 | L7 프록시라서 생기는 것 — 요청 단위 분산, 재시도·타임아웃·outlier detection, 트래픽 분할, 미러링, L7 인가 |
| 05 | 관측성 — 표준 메트릭과 reporter, 액세스 로그와 response flag, 트레이스 전파, 세 신호를 잇는 법 |

조사 기준일은 2026-11-07입니다. Istio 1.31.4 문서와 release-1.31 소스, Istio가 고정한 Envoy 1.39 계열 문서를 기준으로 했습니다.
