---
title: "01 연결 너머의 길 — NLB에서 사이드카 15006까지"
description: "메시 이전의 L4·L7 통신에서 시작해 NLB와 ingress gateway를 지나 사이드카 15006에 닿는 경로를 따라간다. TLS 종료 지점과 Envoy의 대상 선택을 확인한다."
date: 2026-11-07
lastmod: 2026-11-09
inlineToc: false
weight: 1
url: "/study/istio-mesh/01-to-the-gateway/"
aliases:
  - "/study/istio-mesh/01-l4-l7-before-mesh/"
  - "/istio/mesh-traffic/01-l4-l7-before-mesh/"
  - "/study/istio-mesh/02-gateway-to-sidecar/"
  - "/istio/mesh-traffic/02-gateway-to-sidecar/"
---

# 01 · 연결 너머의 길 — NLB에서 사이드카 15006까지

입구에서는 HTTP 요청을 나눴는데, 파드를 늘린 서비스에서는 왜 기존 파드에 부하가 남을까요? 내부 호출이 오래 열린 연결을 쓰면 새 요청도 처음 고른 파드로 향하기 때문입니다. 입구의 Ingress와 서비스 사이의 호출은 서로 다른 경로입니다.

{{< flow src="_flow/1-입구와-내부-호출.json" />}}

## Ingress 너머의 ClusterIP와 장수 연결 {#입구를-지난-서비스-호출은-다시-clusterip로}
<span id="파드를-늘렸는데-새-파드가-노는-이유"></span>

앱 A가 Service 이름으로 B를 부르면 DNS에서 ClusterIP를 받습니다. kube-proxy의 iptables 모드는 새 연결이 들어올 때 대상 파드를 고르고, 목적지를 그 파드의 IP로 바꿉니다(DNAT). 이후 패킷은 conntrack에 기록된 대상을 따릅니다.

선택은 새 연결이 생길 때 이루어집니다. 노드에서 `sudo iptables -t nat -L KUBE-SVC-XXXXXXXXXXXXXXXX -n`을 실행하면 엔드포인트 수만큼 놓인 확률 규칙을 확인합니다. kube-proxy의 모드가 달라도 대상을 고르는 단위는 연결입니다.

이 호출은 입구의 Ingress를 지나지 않습니다. Ingress에 경로 분기나 재시도 규칙을 적었어도 앱 A에서 B로 가는 홉에는 적용되지 않습니다.

{{< flow src="_flow/3-l4-연결-고정.json" />}}

HTTP/1.1은 연결 하나에 요청을 하나씩 싣고 연결도 자주 바뀌어서, 연결 단위로 나누어도 요청이 대체로 흩어졌습니다. HTTP/2·gRPC는 연결 하나를 오래 유지하며 여러 요청을 다중화합니다. L4가 대상을 다시 고를 기회가 오지 않는 동안에는 요청이 처음 선택한 파드로 계속 향합니다.

파드를 늘려도 기존 연결의 부하는 그대로입니다. 그림의 점선은 새 연결이 생겼을 때 선택할 수 있는 대상을 나타냅니다. 이미 열린 연결에 요청이 계속 실리면 새 파드는 놀게 됩니다.

서버의 `MAX_CONNECTION_AGE`로 연결 수명을 제한하면 재접속 때 대상을 새로 고릅니다. 그래도 대상 선택은 연결 단위에 머뭅니다. 연결을 주기적으로 끊어 쏠림을 시간에 걸쳐 희석하는 방식입니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| iptables 모드는 Service→엔드포인트 체인→DNAT, 기본 무작위 선택, 선택 시점은 클라이언트가 VIP에 연결할 때 | Kubernetes 1.37 문서 | [Virtual IPs and Service Proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/) |
| 1.37 기본 모드 iptables, 향후 nftables로 변경 예고 | 업그레이드 전 모드를 명시하라고 권고 | 같은 문서 |
| IPVS deprecated(1.35), 1.40 기본 비활성, 1.43 제거 예정 | `KubeProxyIPVS` feature gate로 재활성 가능 | 같은 문서 IPVS 절 |
| Ingress는 443 단일 포트, 입구에서 TLS 종료, Service·파드 구간은 평문 | Kubernetes 1.37 문서 | [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) |
{{% /details %}}

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| HTTP/2는 장수 연결 하나에 요청을 다중화, 연결 단위 분산이 무력화되고 요청이 파드 하나에 고정 | Kubernetes 블로그(2018-11-07) | [gRPC Load Balancing on Kubernetes without Tears](https://kubernetes.io/blog/2018/11/07/grpc-load-balancing-on-kubernetes-without-tears/) |
| HTTP/1.1은 연결당 동시 요청 1개, 연결이 순환해 연결 단위 분산이 충분 | 같은 글 | 같은 글 |
| L4 LB는 RPC가 아니라 TCP 연결을 분산, 열린 HTTP/2 연결 때문에 부하 이동이 느림 | gRFC A9 | [A9 Server-side Connection Management](https://github.com/grpc/proposal/blob/master/A9-server-side-conn-mgt.md) |
| `MAX_CONNECTION_AGE` 기본값 무한, 만료 시 GOAWAY, ±10% 지터 | 같은 제안서 | 같은 제안서 |
| headless Service와 클라이언트 측 분산은 지원하는 gRPC 클라이언트에 한정, 언어별 구현·유지 부담 | Kubernetes 블로그, gRPC 블로그 | [gRPC Load Balancing](https://grpc.io/blog/grpc-load-balancing/) |
{{% /details %}}

## 앱 양쪽에서 요청을 읽는 L7 프록시 {#앞뒤-연결을-나누면-요청마다-다시-고른다}
<span id="호출하는-쪽과-받는-쪽에-프록시를-두기"></span>
<span id="재시도-정책을-서비스마다-넣어야-했던-이유"></span>

요청마다 파드를 고르려면 프록시가 HTTP를 읽어야 합니다. L7 프록시는 앞쪽 연결을 끝내고 뒤쪽 연결을 따로 관리하므로, 같은 연결에서 받은 요청도 경로·헤더나 부하 정책에 따라 서로 다른 파드로 보낼 수 있습니다. 모든 파드에 정확히 같은 양을 보낸다는 뜻은 아닙니다.

{{< flow src="_flow/3-l7-요청-분산.json" />}}

요청을 읽는 데에는 비용이 듭니다. L7 프록시는 L4보다 처리 비용과 지연이 늘어납니다. ALB에서 gRPC 호출을 나눌 때도 대상 그룹의 프로토콜 버전을 gRPC로 따로 지정해야 합니다. 기본값은 HTTP/1.1입니다.

| 선택 기준 | L4 | HTTP를 해석하는 L7 |
|---|---|---|
| 읽는 것 | IP·포트·프로토콜 | 메서드·경로·Host·헤더 |
| 대상 선택 | 새 연결마다 | 요청마다 |
| 예 | kube-proxy, NLB | nginx, ALB, Envoy |

입구의 nginx가 `proxy_next_upstream`으로 재시도하더라도, 앱 A가 B를 부르다 실패한 호출은 그 nginx를 지나지 않습니다. 동서 구간에 L4만 있으면 타임아웃·재시도·서킷 브레이커를 앱 코드나 라이브러리에 넣어야 했습니다. 언어가 섞인 서비스에서는 클라이언트마다 정책을 맞추는 일도 남습니다. nginx 지시어와 Istio 리소스의 대응은 [nginx에서 Istio로]({{< relref "/platform/istio/configuration/07-from-nginx-to-istio.md" >}})에서 확인합니다.

{{< flow src="_flow/5-양쪽-앱-옆의-프록시.json" />}}

호출하는 앱 곁에 L7 프록시를 두면 내부 호출의 분산·재시도·타임아웃을 맡깁니다. 받는 앱 곁에도 프록시를 두면 앱 사이의 암호화와 상호 인증(mTLS)까지 프록시가 처리합니다. Istio 사이드카 모드가 이 배치입니다.

메시 없이 앱 라이브러리의 재시도나 gRPC 클라이언트 측 분산을 쓰는 선택도 있습니다. 메시는 이런 공통 처리를 언어별 코드 밖으로 옮기며, 그만큼 프록시의 CPU·메모리 사용량과 지연이 더해집니다. 이 손익은 [왜 서비스 메시인가]({{< relref "/platform/istio/fundamentals/14-why-service-mesh/index.md" >}})에서 다룹니다.

Envoy의 기본 분산 방식은 least request입니다. 실패한 HTTP 요청은 기본으로 두 번 재시도하며, 요청 타임아웃은 기본값에서 비활성입니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| NLB는 OSI 4계층, ALB는 7계층에서 동작 | AWS ELB 문서 | [NLB 소개](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html), [ALB 소개](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html) |
| L4 프록시는 처리가 적고 지연·비용이 낮다 | gRPC 블로그의 L3/L4 대 L7 비교 | [gRPC Load Balancing (2017)](https://grpc.io/blog/grpc-load-balancing/) |
| ALB는 기본적으로 대상에 HTTP/1.1로 보내고, gRPC 프로토콜 버전에서는 package·service·method로 라우팅 | gRPC·HTTP/2 버전은 HTTPS 리스너만 | [ALB 대상 그룹](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html) |
| Ingress는 HTTP·HTTPS 경로만 노출, API 동결, Gateway API 권장 | Kubernetes 1.37 문서 | [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) |
| ingress-nginx는 2026년 3월까지 best-effort 유지보수 후 은퇴 | Kubernetes 블로그(2025-11-11) | [Ingress NGINX Retirement](https://kubernetes.io/blog/2025/11/11/ingress-Nginx-retirement/) |
{{% /details %}}

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| `proxy_next_upstream` 기본 `error timeout`, 비멱등 요청은 업스트림 전송 후 재시도 안 함 | nginx 1.9.13 이후 | [ngx_http_proxy_module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) |
| Envoy 기본 분산은 least request, HTTP 기본 재시도 2회, 요청 타임아웃은 기본 비활성 | Istio 1.31 문서 | [Istio Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/) |
| 사이드카 모드에서 요청은 클라이언트·서버 사이드카 두 개를 지난다 | 벤치마크는 1.24 기준 | [Performance and Scalability](https://istio.io/latest/docs/ops/deployment/performance-and-scalability/) |
{{% /details %}}

## NLB에서 시작하는 게이트웨이 진입 경로 {#gateway-to-sidecar}

외부 요청이 메시에서 처음 만나는 Envoy는 ingress gateway입니다. NLB에 TCP 리스너를 둔 사이드카 모드에서는 게이트웨이가 TLS를 끝내고 HTTP를 읽은 뒤, 선택한 파드의 사이드카로 요청을 보냅니다.

{{< flow src="_flow/1-게이트웨이에서-사이드카까지.json" />}}

### NLB 리스너에 따른 TLS 종료 지점 {#암호화된-요청이-nlb를-지날-때}

암호화된 HTTP를 읽으려면 TLS를 종료해야 합니다. 그렇다고 복호화한 자리에 L7 라우팅이 저절로 생기지는 않습니다. NLB의 TLS 리스너는 HTTP 경로로 요청을 나누지 않고, 백엔드 연결은 대상 그룹의 TCP·TLS 설정을 따릅니다. ALB나 HTTPS를 종료하는 Ingress는 복호화한 HTTP를 읽어 요청을 나눕니다.

{{< flow src="_flow/4-nlb-tls-종료-위치.json" />}}

NLB의 TCP 리스너는 바이트를 복호화하지 않고 전달하므로 백엔드에서 TLS가 끝납니다. TLS 리스너를 선택하면 NLB가 프런트 연결을 종료합니다. 어느 리스너인지에 따라 인증서를 사용하는 위치부터 달라집니다.

Ingress는 입구에서 TLS를 끝내고 Service·파드 구간을 평문으로 둡니다. 안쪽 통신을 다시 암호화하려면 백엔드마다 인증서를 배포하고 갱신해야 했습니다. mTLS까지 적용하면 그 작업도 서비스 수만큼 늘어났습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| NLB TCP 대상 선택은 5-튜플+시퀀스 번호 해시, 연결 수명 동안 대상 고정 | AWS ELB 문서 | [NLB 소개](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html) |
| NLB TCP 리스너는 복호화 없이 대상에 전달, TLS 리스너는 서버 인증서로 프런트 연결을 종료 | AWS ELB 문서 | [NLB 리스너](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-listeners.html) |
| NLB는 mTLS를 지원하지 않으며, 필요하면 TCP 리스너로 대상에서 구현 | 같은 문서 | 같은 문서 |
| ALB HTTPS 리스너는 인증서로 연결을 종료하고 요청을 복호화 | AWS ELB 문서 | [ALB 소개](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html) |
{{% /details %}}

### 443 연결을 넘겨받는 게이트웨이 파드 {#nlb가-나누는-것은-연결}

여기서는 [앞서 본 TLS 종료 위치](#암호화된-요청이-nlb를-지날-때) 중 TCP 리스너로 TLS를 게이트웨이까지 통과시키는 경로를 따릅니다. NLB는 TLS를 풀거나 Host 헤더를 읽지 않습니다. 뒤에 도메인이 열 개 있어도 443 포트로 들어오는 연결을 볼 뿐입니다.

NLB는 5-튜플과 시퀀스 번호의 해시로 대상을 정하고 연결이 끝날 때까지 유지합니다. 게이트웨이 쪽으로 연결을 보내는 경로는 대상 모드에 따라 달라집니다. `instance` 모드에서는 노드의 NodePort를 거친 뒤 kube-proxy 규칙이 파드를 고릅니다. `ip` 모드는 파드 IP를 직접 등록하므로 노드 홉이 빠집니다.

어느 모드에서도 분산 단위는 연결입니다. 오래 열린 연결이 한 게이트웨이에 쏠릴 수 있다는 점은 앞에서 본 내부 호출과 같습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| NLB 대상 기본값은 `instance`, 어노테이션 `service.beta.kubernetes.io/aws-load-balancer-nlb-target-type`로 `ip` 선택. `ip` 모드는 파드 ENI 보안그룹을 쓴다 | AWS Load Balancer Controller v2.2.0 이상 | [AWS LBC — NLB](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/service/nlb/) |
| `instance` 모드가 NodePort·kube-proxy를 거친다는 설명 | 쿠버네티스 LoadBalancer Service의 일반 동작에서 따온 설명, 위 페이지 문장은 아님 | — |
{{% /details %}}

## Gateway·VirtualService를 Envoy 설정으로 바꾸는 istiod {#443을-넘겨받은-envoy가-tls를-끝내는-자리}

게이트웨이도 사이드카와 같은 Envoy입니다. 어느 포트에서 받고 어디로 보낼지는 컨트롤 플레인인 istiod가 정합니다. 아래 그림은 [Istio 공식 아키텍처 문서](https://istio.io/latest/docs/ops/deployment/architecture/)의 사이드카 모드와 같은 배치로, 요청이 흐르는 경로와 설정을 받는 경로를 함께 나타냅니다.

{{< flow src="_flow/1b-istiod와-xds-push.json" />}}

istiod는 쿠버네티스 API의 Service·Endpoint와 Istio CRD를 watch합니다. 변경이 생기면 영향을 받는 프록시에 설정을 밀어 줍니다. 프록시는 istiod로 열어 둔 gRPC 스트림에서 listener·route·cluster·endpoint 설정(LDS·RDS·CDS·EDS)과 mTLS 인증서(SDS)를 받습니다. 인증서를 서명하는 CA도 istiod입니다.

요청은 이 스트림을 타지 않습니다. 그림 위쪽의 실선을 따라 Envoy가 요청을 처리하고, istiod는 그 처리에 쓸 설정을 만듭니다. 설정을 받는 스트림도 장수 연결이어서 istiod 파드를 늘려도 기존 스트림이 새 파드로 옮겨가지는 않습니다. 이 동작은 [스케일링과 커넥션 재분배]({{< relref "/platform/istio/operations/09-istiod-scaling-connections/index.md" >}})와 [istiod 해부]({{< relref "/platform/istio/operations/02-istiod-control-plane/index.md" >}})에서 이어서 다룹니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| istiod는 플랫폼별 서비스 디스커버리를 추상화하고(Discovery), 라우팅 규칙을 Envoy 설정으로 바꿔 런타임에 사이드카로 밀며(Configuration), 인증서를 발급하는 CA다(Certificates) | Istio 문서의 아키텍처 절 | [Istio — Architecture](https://istio.io/latest/docs/ops/deployment/architecture/) |
| 그림의 배치 | 공식 아키텍처 그림(사이드카 모드)과 같은 배치로 다시 그림. 데이터 플레인이 위(Ingress → Service A → Service B → Egress), istiod가 아래에서 Discovery·Configuration·Certificates를 프록시에 내려보낸다. 그림 파일은 복제하지 않았다. 공식 그림의 Ingress traffic 자리에 ingress gateway를, istiod 옆에 Kubernetes API를 더했고 xDS 종류는 이 사이트의 다른 글을 따름 | [Architecture](https://istio.io/latest/docs/ops/deployment/architecture/) |
| xDS는 장수 gRPC 스트림이라 istiod를 늘려도 기존 연결은 재분배되지 않는다 | 사이트 내 기존 글 | [istiod 스케일링]({{< relref "/platform/istio/operations/09-istiod-scaling-connections/index.md" >}}) |
{{% /details %}}

Gateway와 VirtualService에 적은 수신 조건과 HTTP 경로도 istiod가 Envoy 설정으로 바꿉니다.

{{< flow src="_flow/2-crd와-envoy-설정.json" />}}

아래의 `Gateway`는 이미 있는 게이트웨이 파드를 선택해 443에서 TLS를 받을 조건을 정합니다. `VirtualService`는 그 Gateway에 HTTP 경로를 연결합니다.

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

여기서 `SIMPLE`은 TLS를 끝내고 HTTP를 읽는 모드입니다. `PASSTHROUGH`는 SNI로 암호화된 연결을 넘기므로 경로·헤더에 따른 분기는 하지 못하며, route 설정 이름도 생기지 않습니다. `AUTO_PASSTHROUGH`는 VirtualService 없이 SNI로 목적지를 찾습니다. 클라이언트 인증서까지 확인하는 모드는 `MUTUAL`과 `OPTIONAL_MUTUAL`입니다.

인증서가 담긴 `web-cert` Secret은 게이트웨이 Deployment의 네임스페이스에 둡니다. 게이트웨이 파드의 istio-agent가 이 Secret을 읽고 SDS로 Envoy에 전달합니다.

`VirtualService`의 `gateways`를 생략하면 기본 대상은 `mesh`입니다. 이 경우에는 예시의 게이트웨이에 HTTP 경로가 붙지 않습니다.

Gateway에 적은 443과 Envoy의 실제 수신 포트도 구별해야 합니다. istiod는 Service의 포트를 targetPort로 바꿔 listener를 만듭니다. Service의 targetPort가 8443이면 Envoy가 여는 listener도 8443입니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| Gateway는 "a load balancer operating at the edge of the mesh", 설정은 "standalone Envoy proxies"에 적용되고 라우팅하려면 VirtualService를 바인딩해야 한다 | Istio 1.31.4 문서 | [Gateway 레퍼런스](https://istio.io/latest/docs/reference/config/networking/gateway/) · [Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/) |
| 리스너는 Service port를 targetPort로 바꾼 뒤 연다. 같은 게이트웨이를 고른 Gateway들은 합쳐진 뒤 listener가 된다 | release-1.31 소스 주석 "mergeGateways will already translate Service port to targetPort" | [istio/istio `pilot/pkg/networking/core/gateway.go`](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/core/gateway.go) |
| Secret은 게이트웨이 Deployment와 같은 네임스페이스("The Certificate should be created in the same namespace as the istio-ingressgateway deployment") | Istio API Gateway, 1.31.4 | [cert-manager 연동](https://istio.io/latest/docs/ops/integrations/certmanager/) |
| 게이트웨이 agent가 키·인증서를 Envoy에 push하고 SDS 요청을 받는 것을 로그로 확인 | 같은 버전 | [Secure Gateways](https://istio.io/latest/docs/tasks/traffic-management/ingress/secure-ingress/) |
| 게이트웨이는 컨트롤 플레인과 다른 네임스페이스에 두는 것이 보안 권장 | 같은 버전 | [Installing Gateways](https://istio.io/latest/docs/setup/additional-setup/gateway/) |
| `gateways` 생략 시 기본값 `mesh` | Istio 1.31.4 | [VirtualService 레퍼런스](https://istio.io/latest/docs/reference/config/networking/virtual-service/) |
{{% /details %}}

## Service 이름 뒤에 있는 파드 IP {#목적지는-service-이름으로-정하고-연결은-파드-ip로}
<span id="실제-연결-주소는-엔드포인트-목록에-있다"></span>

요청 경로가 `/cart`에 맞으면 route는 `cart:8080`의 cluster를 선택합니다. Envoy는 istiod가 EDS로 보낸 엔드포인트 목록에서 파드를 고르고 `파드 IP:8080`으로 연결합니다. 설정에는 Service 이름을 적었지만, 실제 연결 대상은 파드 IP입니다.

{{< flow src="_flow/3-eds에서-파드-ip-선택.json" />}}

그림의 IP는 설명용 예시입니다. 이 홉은 ClusterIP로 보내지 않으므로 Service DNAT를 거치지 않습니다.

자기 클러스터에서는 listener → route → cluster → endpoint 순서로 설정 반영을 확인합니다. 요청을 받을 포트에서 시작해 경로와 대상 목록까지 내려가는 순서입니다.

```bash
# <게이트웨이-파드>는 실제 파드 이름으로 교체
istioctl proxy-config listener <게이트웨이-파드> -n istio-ingress
istioctl proxy-config route <게이트웨이-파드> -n istio-ingress
istioctl proxy-config cluster <게이트웨이-파드> -n istio-ingress --fqdn cart.shop.svc.cluster.local
istioctl proxy-config endpoint <게이트웨이-파드> -n istio-ingress   --cluster 'outbound|8080||cart.shop.svc.cluster.local'
```

listener에 포트가 없다면 Gateway가 이 파드를 선택하지 못한 것입니다. route에 `/cart`가 없으면 VirtualService가 이 Gateway에 연결되지 않은 것입니다. 각 리소스가 어떤 xDS 설정으로 바뀌는지는 [13 Envoy 조립]({{< relref "/platform/istio/fundamentals/13-istio-envoy-assembly/index.md" >}})에서 확인합니다.

TLS를 종료하는 HTTPS 서버의 route 이름은 `https.<포트>.<포트 이름>.<Gateway 이름>.<네임스페이스>`입니다. 이 예시에서는 `https.443.https.web-gateway.istio-ingress`를 찾습니다. cluster 이름 가운데 비어 있는 부분은 subset 자리입니다.

마지막으로 endpoint 출력에서 파드 IP와 STATUS를 봅니다. 목록이 비어 있지 않은지, 상태가 HEALTHY인지 확인합니다. 파드가 Ready가 아니거나 Service 셀렉터가 틀리면 목록이 비고, 게이트웨이는 보낼 곳이 없어 503을 돌려줍니다. 이 상황을 구분하는 진단은 [3편]({{< relref "/study/istio-mesh/03-traces-left-behind/index.md" >}})에서 이어집니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 쿠버네티스 Service(ClientSideLB)는 EDS cluster가 되고, 게이트웨이는 passthrough cluster를 쓸 수 없어 헤드리스도 EDS로 대체한다("Gateways cannot use passthrough clusters. So fallback to EDS") | release-1.31 `convertResolution` | [istio/istio `pilot/pkg/networking/core/cluster.go`](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/core/cluster.go) |
| Envoy는 서비스의 load balancing pool에 분산하고 기본은 least requests | Istio 1.31.4 | [Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/) |
| `proxy-config endpoints --cluster outbound\|...` 출력이 파드 IP:port | 문서 예시는 사이드카 대상, 게이트웨이에도 같은 명령을 쓴다 | [Debugging Envoy and Istiod](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/) |
| "kube-proxy를 우회한다"를 그대로 적은 istio.io 문장 | 찾지 못함. EDS가 파드 IP를 직접 쓴다는 위 두 사실에서 도출 | — |
{{% /details %}}

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| route 이름 `http.<port>[.<bind>]`, `https.<port>.<portName>.<gateway>.<namespace>[.<bind>]`. PASSTHROUGH와 비HTTP 서버는 RDS 이름이 없다 | release-1.31 `gatewayRDSRouteName` | [istio/istio `pilot/pkg/model/gateway.go`](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/model/gateway.go) |
| cluster 이름 `outbound\|<port>\|<subset>\|<host>` | release-1.31 `BuildSubsetKey`, 문서 예시 `outbound\|9080\|\|reviews.default.svc.cluster.local` | [Debugging Envoy and Istiod](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/) |
| Gateway `selector`는 기본적으로 모든 네임스페이스에서 찾고, istiod `PILOT_SCOPE_GATEWAY_TO_NAMESPACE=true`면 설정 네임스페이스로 좁힌다 | Istio 1.31.4 | [Gateway 레퍼런스](https://istio.io/latest/docs/reference/config/networking/gateway/) |
{{% /details %}}

## 외부 TLS 다음에 이어지는 내부 mTLS {#메시-안쪽-연결에는-워크로드-인증서}

게이트웨이가 대상 파드로 여는 연결은 외부 클라이언트의 TLS 연결과 별개입니다. 외부 연결에는 도메인 인증서를 쓰고, 내부 연결에는 게이트웨이 자신의 워크로드 인증서를 사용합니다.

{{< seq src="_seq/4-tls-종료와-재암호화.json" />}}

내부 연결에 auto mTLS가 적용되는 조건은 대상이 메시 프록시이고 TLS 정책이 이를 허용하는 구성일 때입니다. 두 프록시가 서로를 인증하는 과정과 수신 정책은 [2편]({{< relref "/study/istio-mesh/02-between-proxies/index.md" >}})에서 이어집니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| "Sidecar and perimeter proxies work as Policy Enforcement Points", "Istio automatically upgrades all traffic between two PEPs to mutual TLS" | PeerAuthentication이 mTLS를 끄지 않은 경우 | [Security 개념](https://istio.io/latest/docs/concepts/security/) |
| TLS 모드 SIMPLE·MUTUAL·OPTIONAL_MUTUAL·PASSTHROUGH·AUTO_PASSTHROUGH·ISTIO_MUTUAL의 정의 | 같은 버전 | [Gateway 레퍼런스](https://istio.io/latest/docs/reference/config/networking/gateway/) |
{{% /details %}}

## 앱보다 먼저 요청을 받는 15006 {#목적지는-8080-먼저-받는-곳은-15006}

게이트웨이가 연결한 목적지는 `파드 IP:8080`입니다. 그러나 요청이 앱에 닿기 전에 파드의 리다이렉트 규칙이 목적지를 `:15006`으로 돌립니다. 이 포트에서 받는 사이드카가 내부 mTLS를 끝냅니다.

{{< flow src="_flow/5-15006에서-앱까지.json" />}}

15006의 `virtualInbound` listener는 원래 목적지 포트에 맞는 필터 체인을 고릅니다. HTTP 포트라면 복호화한 요청을 여기서도 L7로 읽습니다.

그다음 요청은 `inbound|8080||`을 거쳐 앱으로 갑니다. 이 cluster는 원래 목적지 주소를 그대로 쓰므로, 기본 구성에서 앱이 요청을 받는 곳은 자기 파드 IP의 8080입니다. Istio 1.10 이전에는 localhost로 전달해 `127.0.0.1`에만 바인딩한 앱에도 닿았습니다. 지금의 기본 구성에서는 그런 앱에 닿지 않습니다.

게이트웨이에서 대상 파드까지 확인했다면, 대상 파드의 수신 listener와 앱으로 넘기는 cluster를 조회합니다.

```bash
istioctl proxy-config listener <대상-파드> -n shop --port 15006
istioctl proxy-config cluster  <대상-파드> -n shop --direction inbound
```

리다이렉트 규칙은 요청이 오기 전에 설치됩니다. 기본 구성에서는 `istio-init` init 컨테이너가 `NET_ADMIN`·`NET_RAW` 권한으로 설치를 맡습니다. Istio CNI를 쓰면 노드 에이전트가 같은 작업을 하고, `istio-validation`은 검사만 수행합니다.

이 경로에서 제외한 포트도 있습니다. 파드 어노테이션 `traffic.sidecar.istio.io/excludeInboundPorts`에 지정한 포트는 앱에 직접 닿으므로 사이드카의 mTLS와 관측을 거치지 않습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| `istio-iptables`의 `-z` 기본 15006("Port to which all inbound TCP traffic to the pod/VM should be redirected to"), `-p` 기본 15001, 인바운드 모드 REDIRECT·TPROXY, `--native-nftables` 옵션 | Istio 1.31.4 | [pilot-agent 레퍼런스](https://istio.io/latest/docs/reference/commands/pilot-agent/) |
| `istio-init`은 NET_ADMIN·NET_RAW가 필요하고, CNI 노드 에이전트가 "effectively a replacement for the istio-init container". CNI 모드에선 `istio-validation` init 컨테이너가 검사한다. 사이드카 모드에서 CNI는 선택 | 같은 버전 | [Istio CNI](https://istio.io/latest/docs/setup/additional-setup/cni/) |
| 15006 리스너가 파드의 모든 인바운드를 받는다 | 같은 버전 | [Debugging Envoy and Istiod](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/) · [포트 표](https://istio.io/latest/docs/ops/deployment/application-requirements/) |
| 1.10부터 인바운드를 `lo`가 아니라 `eth0`로 앱에 전달, localhost 전용 바인딩 앱은 닿지 않음. Sidecar `defaultEndpoint: 127.0.0.1`로 되돌릴 수 있음 | 1.10 이후 | [Upcoming networking changes in 1.10](https://istio.io/latest/blog/2021/upcoming-networking-changes/) |
| inbound cluster 기본은 ORIGINAL_DST passthrough, 이름 `inbound\|<port>\|\|` | release-1.31 소스 (`cluster.go`의 ORIGINAL_DST 주석, `service.go`의 `BuildInboundSubsetKey`) | [istio/istio `pilot/pkg/model/service.go`](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/model/service.go) |
| SYN-only 규칙을 ESTABLISHED divert 규칙보다 먼저 평가(GHSA-cxwg-46mx-q8hf) | 1.31.4, iptables·nftables 모드 | [1.31.4 릴리스 노트](https://istio.io/latest/news/releases/1.31.x/announcing-1.31.4/) |
{{% /details %}}

## Gateway API의 배포와 ambient의 수신 경계 {#gateway-api를-쓰면-배포-방식이-달라진다}

Kubernetes Gateway API를 쓰면 `Gateway`가 기본적으로 Service·Deployment까지 만듭니다. 경로를 연결하는 필드는 `HTTPRoute.parentRefs`이며, 다른 네임스페이스의 Route를 붙일 때는 `allowedRoutes`에서도 허용해야 합니다. 이 배포 방식의 차이는 [Gateway API 비교]({{< relref "/platform/istio/cilium/02-gateway-api/index.md" >}})에서 다룹니다.

Envoy가 요청을 처리하는 방식과 진단 순서는 같습니다. Istio의 Gateway API 컨트롤러가 해당 리소스를 내부의 Istio Gateway·VirtualService로 바꾸므로, 앞에서 쓴 `istioctl proxy-config`로 수신 포트부터 엔드포인트까지 확인합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| Gateway API의 Gateway는 "both configures and deploys a gateway", 기본적으로 Gateway마다 Service와 Deployment를 `<Gateway name>-<GatewayClass name>`으로 만든다 | Istio 1.31.4, Gateway API v1.6.0 CRD 기준 | [Istio — Gateway API](https://istio.io/latest/docs/tasks/traffic-management/ingress/gateway-api/) |
| `infrastructure`의 labels·annotations가 생성 리소스에 복사되고, `parametersRef`(같은 네임스페이스 ConfigMap)로 전부 바꿀 수 있다 | 같은 문서 | 같은 문서 |
| 컨트롤러가 Gateway API 리소스를 "Istio types (Gateway/VirtualService)"로 번역하고, 같은 gateway·hostname의 HTTP·gRPC 라우트를 VirtualService 하나로 합친다 | release-1.31 소스 | [istio/istio `pilot/pkg/config/kube/gateway/controller.go`](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/config/kube/gateway/controller.go) |
{{% /details %}}

<span id="ambient-목적지에서는-ztunnel이-받는다"></span>

목적지가 ambient라면 수신 경로부터 달라집니다. 파드에 사이드카가 없으므로 15006 그림을 그대로 적용하지 않고 노드의 ztunnel과 HBONE 경로를 봅니다. HBONE이 받는 포트는 관례상 15008입니다.

인그레스 요청은 목적지에 waypoint가 있어도 기본적으로 건너뜁니다. 메시 내부 호출과 같은 L7 정책을 적용하려면 Service나 네임스페이스에 `istio.io/ingress-use-waypoint: "true"`를 붙여야 합니다. 네임스페이스 라벨은 1.25부터 지원합니다([waypoint 공식 문서](https://istio.io/latest/docs/ambient/usage/waypoint/)).

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| HBONE을 이해하는 프록시는 관례상 TCP 15008에 리스너를 연다 | Istio 1.31.4 | [HBONE](https://istio.io/latest/docs/ambient/architecture/hbone/) |
| 인그레스 발 트래픽은 기본적으로 목적지 waypoint를 쓰지 않고, `istio.io/ingress-use-waypoint=true`로 켠다. 네임스페이스 라벨은 1.25부터 | 문서는 istiod `ENABLE_INGRESS_WAYPOINT_ROUTING`(기본 false)도 함께 언급 | [Waypoint 사용](https://istio.io/latest/docs/ambient/usage/waypoint/) |
| 게이트웨이가 ambient 목적지에 HBONE으로 보낸다는 문장 | istio.io에서 직접 확인하지 못함 | — |
{{% /details %}}

앱에 도착한 요청이 다른 서비스 호출로 이어지면 다시 두 프록시 사이를 지납니다. 그 구간의 신원과 요청 처리는 [2편 신원을 주고받는 두 프록시와 요청을 읽는 갈림길]({{< relref "/study/istio-mesh/02-between-proxies/index.md" >}})에서 따라갑니다.

## 참고 자료

- [Kubernetes — Service의 가상 IP와 프록시](https://kubernetes.io/docs/reference/networking/virtual-ips/)
- [Kubernetes — gRPC 연결과 부하 분산](https://kubernetes.io/blog/2018/11/07/grpc-load-balancing-on-kubernetes-without-tears/)
- [AWS — NLB 리스너와 TLS 종료](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-listeners.html)
- [gRPC — 클라이언트 측 부하 분산](https://grpc.io/blog/grpc-load-balancing/)
- [Istio — 트래픽 관리](https://istio.io/latest/docs/concepts/traffic-management/)
- [AWS Load Balancer Controller — NLB 대상 모드](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/service/nlb/)
- [Istio — Gateway와 TLS 모드](https://istio.io/latest/docs/reference/config/networking/gateway/)
- [Istio — Envoy 설정 확인](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/)
- [Istio — 인증서를 사용하는 게이트웨이](https://istio.io/latest/docs/tasks/traffic-management/ingress/secure-ingress/)
- [Istio — 앱 인바운드의 네트워크 변경](https://istio.io/latest/blog/2021/upcoming-networking-changes/)
- [Istio — 아키텍처](https://istio.io/latest/docs/ops/deployment/architecture/)
