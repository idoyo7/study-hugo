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

노드에서는 `sudo iptables -t nat -L KUBE-SVC-XXXXXXXXXXXXXXXX -n`으로 엔드포인트 수만큼의 확률 규칙을 볼 수 있습니다.

kube-proxy의 모드가 달라져도 선택 단위는 연결입니다.

이 내부 호출은 입구의 Ingress를 거치지 않습니다. 입구에 적은 경로 분기·재시도 규칙도 이 홉에는 적용되지 않습니다.

입구에서 끝난 것은 L7 처리만이 아닙니다. Ingress 경로는 TLS를 입구에서 끝내고 안쪽을 평문으로 둡니다. 안쪽 통신을 다시 암호화하려면 백엔드마다 인증서를 배포·갱신해야 했고, 상호 인증(mTLS)까지 하면 서비스 수만큼 늘어났습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| iptables 모드는 Service→엔드포인트 체인→DNAT, 기본 무작위 선택, 선택 시점은 클라이언트가 VIP에 연결할 때 | Kubernetes 1.37 문서 | [Virtual IPs and Service Proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/) |
| 1.37 기본 모드 iptables, 향후 nftables로 변경 예고 | 업그레이드 전 모드를 명시하라고 권고 | 같은 문서 |
| IPVS deprecated(1.35), 1.40 기본 비활성, 1.43 제거 예정 | `KubeProxyIPVS` feature gate로 재활성 가능 | 같은 문서 IPVS 절 |
| Ingress는 443 단일 포트, 입구에서 TLS 종료, Service·파드 구간은 평문 | Kubernetes 1.37 문서 | [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) |
{{% /details %}}

## 연결 하나에 머무는 요청 {#파드를-늘렸는데-새-파드가-노는-이유}

{{< flow src="_flow/3-l4-연결-고정.json" />}}

HTTP/2·gRPC는 연결 하나에 여러 요청을 실을 수 있습니다. **L4가 다시 고를 기회는 새 연결이 생길 때**이므로, 파드를 늘려도 기존 연결의 부하는 옮겨 가지 않습니다. 그림의 점선은 새 연결에서 선택할 수 있는 대상입니다.

HTTP/1.1은 연결 하나에 요청을 하나씩 싣고 연결이 자주 바뀌어서, 연결 단위로 나눠도 요청이 대체로 흩어졌습니다. HTTP/2는 연결을 오래 유지하며 요청을 다중화해서 처음 고른 파드에 요청이 계속 향합니다. 새 파드는 놀게 됩니다.

서버가 `MAX_CONNECTION_AGE`로 연결 수명을 제한하면 재접속 때 대상을 새로 고르지만, 쏠림을 시간으로 희석할 뿐입니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| HTTP/2는 장수 연결 하나에 요청을 다중화, 연결 단위 분산이 무력화되고 요청이 파드 하나에 고정 | Kubernetes 블로그(2018-11-07) | [gRPC Load Balancing on Kubernetes without Tears](https://kubernetes.io/blog/2018/11/07/grpc-load-balancing-on-kubernetes-without-tears/) |
| HTTP/1.1은 연결당 동시 요청 1개, 연결이 순환해 연결 단위 분산이 충분 | 같은 글 | 같은 글 |
| L4 LB는 RPC가 아니라 TCP 연결을 분산, 열린 HTTP/2 연결 때문에 부하 이동이 느림 | gRFC A9 | [A9 Server-side Connection Management](https://github.com/grpc/proposal/blob/master/A9-server-side-conn-mgt.md) |
| `MAX_CONNECTION_AGE` 기본값 무한, 만료 시 GOAWAY, ±10% 지터 | 같은 제안서 | 같은 제안서 |
| headless Service와 클라이언트 측 분산은 지원하는 gRPC 클라이언트에 한정, 언어별 구현·유지 부담 | Kubernetes 블로그, gRPC 블로그 | [gRPC Load Balancing](https://grpc.io/blog/grpc-load-balancing/) |
{{% /details %}}

## 요청마다 다시 고르는 파드 {#앞뒤-연결을-나누면-요청마다-다시-고른다}

{{< flow src="_flow/3-l7-요청-분산.json" />}}

L7 프록시는 앞쪽 연결을 끝내고 HTTP를 읽은 뒤, 뒤쪽 연결을 따로 관리합니다. 같은 연결의 요청도 경로·헤더나 부하 정책에 따라 다른 파드로 보낼 수 있습니다. 모든 파드에 정확히 같은 양을 보낸다는 뜻은 아닙니다.

요청을 읽는 데에는 비용이 듭니다. L7 프록시는 L4보다 처리 비용과 지연이 늘어납니다. ALB에서 gRPC 호출을 나누려면 대상 그룹의 프로토콜 버전을 gRPC로 따로 설정해야 하며, 기본값은 HTTP/1.1입니다.

| 선택 기준 | L4 | HTTP를 해석하는 L7 |
|---|---|---|
| 읽는 것 | IP·포트·프로토콜 | 메서드·경로·Host·헤더 |
| 대상 선택 | 새 연결마다 | 요청마다 |
| 예 | kube-proxy, NLB | nginx, ALB, Envoy |

nginx 지시어와 Istio 리소스의 대응은 [nginx에서 Istio로]({{< relref "/platform/istio/configuration/07-from-nginx-to-istio.md" >}})에 있습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| NLB는 OSI 4계층, ALB는 7계층에서 동작 | AWS ELB 문서 | [NLB 소개](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html), [ALB 소개](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html) |
| L4 프록시는 처리가 적고 지연·비용이 낮다 | gRPC 블로그의 L3/L4 대 L7 비교 | [gRPC Load Balancing (2017)](https://grpc.io/blog/grpc-load-balancing/) |
| ALB는 기본적으로 대상에 HTTP/1.1로 보내고, gRPC 프로토콜 버전에서는 package·service·method로 라우팅 | gRPC·HTTP/2 버전은 HTTPS 리스너만 | [ALB 대상 그룹](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html) |
| Ingress는 HTTP·HTTPS 경로만 노출, API 동결, Gateway API 권장 | Kubernetes 1.37 문서 | [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) |
| ingress-nginx는 2026년 3월까지 best-effort 유지보수 후 은퇴 | Kubernetes 블로그(2025-11-11) | [Ingress NGINX Retirement](https://kubernetes.io/blog/2025/11/11/ingress-Nginx-retirement/) |
{{% /details %}}

## TLS가 끝나는 자리 {#암호화된-요청이-nlb를-지날-때}

{{< flow src="_flow/4-nlb-tls-종료-위치.json" />}}

TLS를 종료해야 암호화된 HTTP를 읽을 수 있습니다. 다만 복호화만으로 L7 라우팅이 생기지는 않습니다. NLB의 TLS 리스너는 HTTP 경로로 분기하지 않으며, 백엔드 연결은 대상 그룹의 TCP·TLS 설정을 따릅니다. ALB나 HTTPS를 종료하는 Ingress는 복호화한 HTTP로 요청을 나눕니다.

NLB는 5-튜플과 시퀀스 번호의 해시로 대상을 고르고 연결 수명 동안 유지합니다. TCP 리스너는 바이트를 풀지 않고 넘기므로 백엔드가 TLS를 끝냅니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| NLB TCP 대상 선택은 5-튜플+시퀀스 번호 해시, 연결 수명 동안 대상 고정 | AWS ELB 문서 | [NLB 소개](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html) |
| NLB TCP 리스너는 복호화 없이 대상에 전달, TLS 리스너는 서버 인증서로 프런트 연결을 종료 | AWS ELB 문서 | [NLB 리스너](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-listeners.html) |
| NLB는 mTLS를 지원하지 않으며, 필요하면 TCP 리스너로 대상에서 구현 | 같은 문서 | 같은 문서 |
| ALB HTTPS 리스너는 인증서로 연결을 종료하고 요청을 복호화 | AWS ELB 문서 | [ALB 소개](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html) |
{{% /details %}}

## 앱 양쪽에 놓는 프록시 {#호출하는-쪽과-받는-쪽에-프록시를-두기}

{{< flow src="_flow/5-양쪽-앱-옆의-프록시.json" />}}

<span id="재시도-정책을-서비스마다-넣어야-했던-이유"></span>

입구의 nginx는 `proxy_next_upstream`으로 재시도하지만, 서비스 A가 B를 부르다 실패한 호출은 nginx를 지나지 않습니다. 동서 구간이 L4뿐이면 타임아웃과 재시도, 서킷 브레이커를 앱 코드나 라이브러리에 넣어야 했고, 언어가 섞이면 정책을 클라이언트마다 맞춰야 합니다.

호출 쪽 L7 프록시는 내부 호출의 분산·재시도·타임아웃을 맡습니다. 양쪽에 프록시가 있으면 앱 사이 암호화와 상호 인증도 맡깁니다. Istio 사이드카 모드는 이 배치입니다.

메시 없이도 앱 라이브러리의 재시도나 gRPC 클라이언트 측 분산을 쓸 수 있습니다. 메시는 이 공통 처리를 언어별 코드 밖으로 옮기는 선택이며, 그만큼 프록시의 CPU·메모리·지연이 더해집니다.

Envoy의 기본 분산 방식은 least request이고, 실패한 HTTP 요청은 기본으로 두 번 재시도합니다. 요청 타임아웃은 기본값에서 비활성입니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| `proxy_next_upstream` 기본 `error timeout`, 비멱등 요청은 업스트림 전송 후 재시도 안 함 | nginx 1.9.13 이후 | [ngx_http_proxy_module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) |
| Envoy 기본 분산은 least request, HTTP 기본 재시도 2회, 요청 타임아웃은 기본 비활성 | Istio 1.31 문서 | [Istio Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/) |
| 사이드카 모드에서 요청은 클라이언트·서버 사이드카 두 개를 지난다 | 벤치마크는 1.24 기준 | [Performance and Scalability](https://istio.io/latest/docs/ops/deployment/performance-and-scalability/) |
{{% /details %}} 손익은 [왜 서비스 메시인가]({{< relref "/platform/istio/fundamentals/14-why-service-mesh/index.md" >}})에서 다룹니다.

다음 [02 게이트웨이에서 사이드카까지]({{< relref "/study/istio-mesh/02-gateway-to-sidecar/index.md" >}})에서는 외부 요청이 메시의 첫 Envoy에 들어오는 경로를 따라갑니다.

## 참고 자료

- [Kubernetes — Service의 가상 IP와 프록시](https://kubernetes.io/docs/reference/networking/virtual-ips/)
- [Kubernetes — gRPC 연결과 부하 분산](https://kubernetes.io/blog/2018/11/07/grpc-load-balancing-on-kubernetes-without-tears/)
- [AWS — NLB 리스너와 TLS 종료](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-listeners.html)
- [gRPC — 클라이언트 측 부하 분산](https://grpc.io/blog/grpc-load-balancing/)
- [Istio — 트래픽 관리](https://istio.io/latest/docs/concepts/traffic-management/)
