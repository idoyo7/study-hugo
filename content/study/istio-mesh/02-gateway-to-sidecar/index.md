---
title: "02 다시 길을 고르는 문 — 게이트웨이에서 사이드카까지"
description: "NLB부터 앱까지 다섯 그림으로 따라간다. Gateway·VirtualService의 번역, 파드 IP 선택, 외부 TLS와 내부 mTLS, 15006의 역할을 정리한다."
date: 2026-11-07
lastmod: 2026-11-08
inlineToc: false
weight: 2
url: "/study/istio-mesh/02-gateway-to-sidecar/"
aliases:
  - "/istio/mesh-traffic/02-gateway-to-sidecar/"
---

# 02 · 다시 길을 고르는 문 — 게이트웨이에서 사이드카까지

외부 요청은 게이트웨이에서 HTTP로 읽힌 뒤, 선택된 파드의 사이드카로 향합니다. 아래는 NLB에 **TCP 리스너**를 둔 사이드카 모드의 경로입니다.

{{< flow src="_flow/1-게이트웨이에서-사이드카까지.json" />}}

## NLB에서 고르는 게이트웨이 {#nlb가-나누는-것은-연결}

NLB는 연결을 게이트웨이 파드 쪽으로 나눕니다. `instance` 대상 모드는 노드의 NodePort를 거치고, `ip` 대상 모드는 파드 IP를 직접 등록합니다. 장수 연결은 같은 게이트웨이에 머무를 수 있습니다.

여기서는 TLS를 게이트웨이까지 통과시킵니다. NLB에 TLS 리스너를 두면 NLB에서 TLS가 끝나므로 [01편의 TLS 종료 위치]({{< relref "/study/istio-mesh/01-l4-l7-before-mesh/index.md#암호화된-요청이-nlb를-지날-때" >}})와 구분해야 합니다.

## 설정이 바뀌는 자리, 요청이 흐르는 자리 {#443을-넘겨받은-envoy가-tls를-끝내는-자리}

{{< flow src="_flow/2-crd와-envoy-설정.json" />}}

**istiod는 설정을 만들고, Envoy는 요청을 처리합니다.** 아래 설정의 `Gateway`는 기존 게이트웨이 파드를 고르고 443의 TLS 수신 조건을 정의합니다. `VirtualService`는 그 Gateway에 연결할 HTTP 경로를 정의합니다.

```yaml
apiVersion: networking.istio.io/v1
kind: Gateway
metadata: { name: web-gateway, namespace: istio-ingress }
spec:
  selector: { istio: ingressgateway }
  servers:
  - port: { number: 443, name: https, protocol: HTTPS }
    tls: { mode: SIMPLE, credentialName: web-cert }
    hosts: ["shop.example.com"]
---
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata: { name: shop, namespace: shop }
spec:
  hosts: ["shop.example.com"]
  gateways: ["istio-ingress/web-gateway"]
  http:
  - match: [{ uri: { prefix: /cart } }]
    route:
    - destination:
        host: cart.shop.svc.cluster.local
        port: { number: 8080 }
```

`web-cert` Secret은 게이트웨이 **Deployment의 네임스페이스**에 둡니다. `gateways`를 생략하면 기본 대상은 `mesh`이므로 이 게이트웨이에는 경로가 붙지 않습니다. Service가 443을 targetPort 8443으로 연결한다면 Envoy의 실제 listener는 8443입니다.

## Service 이름에서 파드 IP까지 {#목적지는-service-이름으로-정하고-연결은-파드-ip로}

<span id="실제-연결-주소는-엔드포인트-목록에-있다"></span>

{{< flow src="_flow/3-eds에서-파드-ip-선택.json" />}}

`/cart`가 맞으면 route는 `cart:8080`의 cluster를 고릅니다. Envoy는 istiod가 EDS로 내린 엔드포인트에서 파드를 골라 `파드 IP:8080`으로 연결합니다. 이 홉은 ClusterIP로 보내지 않으므로 Service DNAT를 거치지 않습니다. 그림의 IP는 설명용 예시입니다.

설정 반영은 **listener → route → cluster → endpoint** 순으로 확인합니다. 엔드포인트가 비었는지, 상태가 HEALTHY인지까지 봅니다.

```bash
# <게이트웨이-파드>는 실제 파드 이름으로 교체
istioctl proxy-config listener <게이트웨이-파드> -n istio-ingress
istioctl proxy-config route <게이트웨이-파드> -n istio-ingress
istioctl proxy-config cluster <게이트웨이-파드> -n istio-ingress --fqdn cart.shop.svc.cluster.local
istioctl proxy-config endpoint <게이트웨이-파드> -n istio-ingress   --cluster 'outbound|8080||cart.shop.svc.cluster.local'
```

## 외부 TLS와 내부 mTLS {#메시-안쪽-연결에는-워크로드-인증서}

{{< seq src="_seq/4-tls-종료와-재암호화.json" />}}

외부 TLS와 내부 mTLS는 **별개의 연결**입니다. 외부에는 도메인 인증서를, 내부에는 게이트웨이 자신의 워크로드 인증서를 씁니다. 대상이 메시 프록시이고 TLS 정책이 허용하는 구성에서 auto mTLS가 적용됩니다.

`SIMPLE`은 TLS를 끝내 HTTP를 읽습니다. `PASSTHROUGH`는 SNI로 암호화된 연결을 넘기므로 경로·헤더 분기는 할 수 없습니다. 두 프록시의 인증과 수신 정책은 [03편]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}})에서 이어집니다.

## 앱 앞에서 거치는 15006 {#목적지는-8080-먼저-받는-곳은-15006}

{{< flow src="_flow/5-15006에서-앱까지.json" />}}

네트워크의 목적지는 `파드 IP:8080`이지만, 파드의 리다이렉트 규칙이 먼저 `:15006`으로 돌립니다. 사이드카는 원래 목적지 포트에 맞는 처리를 고르고 mTLS를 종료합니다. HTTP 포트라면 여기서도 L7로 읽습니다.

복호화한 요청은 `inbound|8080||`을 거쳐 기본 구성에서 **파드 IP:8080**의 앱으로 갑니다. 앱을 `127.0.0.1`에만 바인딩하면 이 경로에서 받지 못합니다.

리다이렉트 규칙은 요청 전에 `istio-init` 또는 Istio CNI가 설치합니다. `excludeInboundPorts`로 제외한 포트는 앱에 직접 닿으므로 사이드카의 mTLS·관측도 거치지 않습니다.

## Gateway API와 ambient의 경계 {#gateway-api를-쓰면-배포-방식이-달라진다}

Kubernetes Gateway API에서는 `Gateway`가 기본적으로 Service·Deployment까지 만들고, `HTTPRoute.parentRefs`가 경로를 연결합니다. 다른 네임스페이스의 Route를 붙일 때는 `allowedRoutes`도 허용해야 합니다. Envoy의 요청 처리와 진단 순서는 같습니다([Gateway API 비교]({{< relref "/platform/istio/cilium/02-gateway-api/index.md" >}})).

<span id="ambient-목적지에서는-ztunnel이-받는다"></span>

ambient 목적지에는 파드 사이드카가 없으므로 위의 15006 그림을 그대로 적용하지 않습니다. 노드의 ztunnel과 HBONE 경로를 봐야 합니다. 인그레스 요청은 기본적으로 목적지 waypoint를 건너뛰며, 경유하려면 관련 라벨과 컨트롤 플레인 설정을 확인합니다([waypoint 공식 문서](https://istio.io/latest/docs/ambient/usage/waypoint/)).

이전 [01 L4와 L7]({{< relref "/study/istio-mesh/01-l4-l7-before-mesh/index.md" >}}) · 다음 [03 사이드카와 사이드카 사이]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}})

## 참고 자료

- [AWS Load Balancer Controller — NLB 대상 모드](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/service/nlb/)
- [Istio — Gateway와 TLS 모드](https://istio.io/latest/docs/reference/config/networking/gateway/)
- [Istio — Envoy 설정 확인](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/)
- [Istio — 인증서를 사용하는 게이트웨이](https://istio.io/latest/docs/tasks/traffic-management/ingress/secure-ingress/)
- [Istio — 앱 인바운드의 네트워크 변경](https://istio.io/latest/blog/2021/upcoming-networking-changes/)
