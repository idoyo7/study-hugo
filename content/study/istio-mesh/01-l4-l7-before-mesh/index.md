---
title: "01 한 연결에 묶인 길 — 메시 이전의 L4와 L7"
description: "입구와 내부 호출, 연결 단위와 요청 단위 분산, TLS 종료 위치를 다섯 그림으로 비교하고 Istio 사이드카의 배치로 이어간다."
date: 2026-11-07
lastmod: 2026-11-08
inlineToc: false
weight: 1
url: "/study/istio-mesh/01-l4-l7-before-mesh/"
aliases:
  - "/istio/mesh-traffic/01-l4-l7-before-mesh/"
---

# 01 · 한 연결에 묶인 길 — 메시 이전의 L4와 L7

입구에서 HTTP 요청을 나눠도 서비스 사이의 호출은 다시 연결 단위로 묶입니다. 먼저 사이드카가 없는 경로를 봅니다.

{{< flow src="_flow/1-입구와-내부-호출.json" />}}

## 입구 너머의 ClusterIP {#입구를-지난-서비스-호출은-다시-clusterip로}

앱 A가 Service 이름으로 B를 부르면 DNS가 ClusterIP를 돌려줍니다. kube-proxy의 iptables 모드에서는 새 연결의 대상을 고르고 목적지를 파드 IP로 바꿉니다(DNAT). 이후 패킷은 conntrack이 기억한 대상을 따릅니다.

이 내부 호출은 입구의 Ingress를 거치지 않습니다. 입구에 적은 경로 분기·재시도 규칙도 이 홉에는 적용되지 않습니다.

## 연결 하나에 머무는 요청 {#파드를-늘렸는데-새-파드가-노는-이유}

{{< flow src="_flow/3-l4-연결-고정.json" />}}

HTTP/2·gRPC는 연결 하나에 여러 요청을 실을 수 있습니다. **L4가 다시 고를 기회는 새 연결이 생길 때**이므로, 파드를 늘려도 기존 연결의 부하는 옮겨 가지 않습니다. 그림의 점선은 새 연결에서 선택할 수 있는 대상입니다.

## 요청마다 다시 고르는 파드 {#앞뒤-연결을-나누면-요청마다-다시-고른다}

{{< flow src="_flow/3-l7-요청-분산.json" />}}

L7 프록시는 앞쪽 연결을 끝내고 HTTP를 읽은 뒤, 뒤쪽 연결을 따로 관리합니다. 같은 연결의 요청도 경로·헤더나 부하 정책에 따라 다른 파드로 보낼 수 있습니다. 모든 파드에 정확히 같은 양을 보낸다는 뜻은 아닙니다.

| 선택 기준 | L4 | HTTP를 해석하는 L7 |
|---|---|---|
| 읽는 것 | IP·포트·프로토콜 | 메서드·경로·Host·헤더 |
| 대상 선택 | 새 연결마다 | 요청마다 |
| 예 | kube-proxy, NLB | nginx, ALB, Envoy |

## TLS가 끝나는 자리 {#암호화된-요청이-nlb를-지날-때}

{{< flow src="_flow/4-nlb-tls-종료-위치.json" />}}

TLS를 종료해야 암호화된 HTTP를 읽을 수 있습니다. 다만 복호화만으로 L7 라우팅이 생기지는 않습니다. NLB의 TLS 리스너는 HTTP 경로로 분기하지 않으며, 백엔드 연결은 대상 그룹의 TCP·TLS 설정을 따릅니다. ALB나 HTTPS를 종료하는 Ingress는 복호화한 HTTP로 요청을 나눕니다.

## 앱 양쪽에 놓는 프록시 {#호출하는-쪽과-받는-쪽에-프록시를-두기}

{{< flow src="_flow/5-양쪽-앱-옆의-프록시.json" />}}

<span id="재시도-정책을-서비스마다-넣어야-했던-이유"></span>

호출 쪽에 L7 프록시를 두면 내부 호출의 분산·재시도·타임아웃을 맡길 수 있습니다. 양쪽에 프록시가 있으면 앱 사이 암호화와 상호 인증도 맡깁니다. Istio 사이드카 모드는 이 배치입니다.

메시 없이도 앱 라이브러리의 재시도나 gRPC 클라이언트 측 분산을 쓸 수 있습니다. 메시는 이 공통 처리를 언어별 코드 밖으로 옮기는 선택이며, 그만큼 프록시의 CPU·메모리·지연이 더해집니다. 손익은 [왜 서비스 메시인가]({{< relref "/platform/istio/fundamentals/14-why-service-mesh/index.md" >}})에서 다룹니다.

다음 [02 게이트웨이에서 사이드카까지]({{< relref "/study/istio-mesh/02-gateway-to-sidecar/index.md" >}})에서는 외부 요청이 메시의 첫 Envoy에 들어오는 경로를 따라갑니다.

## 참고 자료

- [Kubernetes — Service의 가상 IP와 프록시](https://kubernetes.io/docs/reference/networking/virtual-ips/)
- [Kubernetes — gRPC 연결과 부하 분산](https://kubernetes.io/blog/2018/11/07/grpc-load-balancing-on-kubernetes-without-tears/)
- [AWS — NLB 리스너와 TLS 종료](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-listeners.html)
- [gRPC — 클라이언트 측 부하 분산](https://grpc.io/blog/grpc-load-balancing/)
- [Istio — 트래픽 관리](https://istio.io/latest/docs/concepts/traffic-management/)
