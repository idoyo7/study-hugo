---
title: "02 문지기는 봉투를 열고 다시 봉인한다 — 게이트웨이에서 사이드카까지"
description: "게이트웨이는 외부 요청을 어디로 넘기고 사이드카는 어느 포트에서 받는가. TLS를 종료한 게이트웨이가 파드 IP를 고르고, mTLS로 보낸 요청을 사이드카가 15006에서 받는 경로를 Envoy 설정으로 확인한다."
date: 2026-11-07
lastmod: 2026-11-07
weight: 2
url: "/study/istio-mesh/02-gateway-to-sidecar/"
aliases:
  - "/istio/mesh-traffic/02-gateway-to-sidecar/"
---

# 02 · 문지기는 봉투를 열고 다시 봉인한다 — 게이트웨이에서 사이드카까지

[01편]({{< relref "/study/istio-mesh/01-l4-l7-before-mesh/index.md" >}})은 모든 홉에 L7 프록시를 두고 싶어진 이유에서 끝났습니다. 외부 요청을 받는 경로에서는 Istio ingress gateway가 그 첫 L7 홉입니다. 여기서 TLS를 종료하면 게이트웨이는 HTTP를 읽고 요청을 보낼 파드를 고릅니다.

조사 기준은 Istio 1.31.4(2026-11-06 릴리스)와 그 버전이 고정한 Envoy 1.39 계열, Gateway API v1.6.0입니다.

아래 그림은 외부 연결이 게이트웨이에 들어와 대상 파드의 사이드카로 이어지는 경로입니다.

{{< flow src="_flow/1-게이트웨이에서-사이드카까지.json" />}}

## NLB가 나누는 연결의 행렬 {#nlb가-나누는-것은-연결}

게이트웨이 앞에서는 아직 HTTP를 읽지 않습니다. 클라우드 LB가 NLB라면 게이트웨이에 도착하기 전까지 요청은 TCP 연결로 다뤄집니다. NLB는 TLS를 풀거나 Host 헤더를 읽지 않으므로, 뒤에 도메인이 열 개 있어도 443 포트로 들어오는 연결만 봅니다.

게이트웨이 파드는 보통 `type: LoadBalancer` Service 뒤에 있습니다. NLB가 노드를 대상으로 잡으면 연결은 NodePort를 지나고, kube-proxy 규칙이 게이트웨이 파드를 고릅니다. AWS Load Balancer Controller의 `ip` 대상 모드처럼 파드 IP를 직접 등록하면 이 노드 홉이 빠집니다.

어느 경로든 분산 단위는 연결입니다. 01편에서 본 장수 커넥션 쏠림은 게이트웨이 파드 사이에서도 생길 수 있습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| NLB 대상 기본값은 `instance`, 어노테이션 `service.beta.kubernetes.io/aws-load-balancer-nlb-target-type`로 `ip` 선택. `ip` 모드는 파드 ENI 보안그룹을 쓴다 | AWS Load Balancer Controller v2.2.0 이상 | [AWS LBC — NLB](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/service/nlb/) |
| `instance` 모드가 NodePort·kube-proxy를 거친다는 설명 | 쿠버네티스 LoadBalancer Service의 일반 동작에서 따온 설명, 위 페이지 문장은 아님 | — |
{{% /details %}}

## 443의 문지기 Envoy가 TLS 봉인을 푼다 {#443을-넘겨받은-envoy가-tls를-끝내는-자리}

Istio ingress gateway도 사이드카와 같은 Envoy입니다. 애플리케이션 파드에 붙는 대신 별도 Deployment로 실행되며, 이 배치를 분리하는 방법은 [03 게이트웨이 격리]({{< relref "/platform/istio/operations/03-gateway-node-isolation/index.md" >}})에서 다뤘습니다.

받을 포트와 요청을 보낼 곳은 Gateway와 VirtualService에 적습니다. 아래 설정은 `shop.example.com`으로 온 `/cart` 요청을 `cart.shop.svc.cluster.local`의 8080으로 보냅니다.

```yaml
apiVersion: networking.istio.io/v1
kind: Gateway
metadata: { name: web-gateway, namespace: istio-ingress }
spec:
  selector: { istio: ingressgateway }
  servers:
  - port: { number: 443, name: https, protocol: HTTPS }
    tls: { mode: SIMPLE, credentialName: web-cert }
    hosts: [ "shop.example.com" ]
---
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata: { name: shop, namespace: shop }
spec:
  hosts: [ "shop.example.com" ]
  gateways: [ "istio-ingress/web-gateway" ]
  http:
  - match: [ { uri: { prefix: /cart } } ]
    route: [ { destination: { host: cart.shop.svc.cluster.local, port: { number: 8080 } } } ]
```

listener는 Envoy가 어느 포트에서 받을지 정하는 설정입니다. Gateway에 적은 443이 Envoy의 실제 수신 포트는 아닙니다. istiod는 `servers`를 listener로 만들 때 게이트웨이 Service의 포트를 targetPort로 바꿉니다. Service가 443을 받아 8443으로 넘긴다면 Envoy는 8443에서 듣습니다.

같은 게이트웨이 파드를 고르는 Gateway가 여럿이면 istiod가 먼저 합친 뒤 listener를 만듭니다. 443 하나에 걸린 서버들은 SNI로 구분하는 필터 체인이 됩니다.

이 예시의 `SIMPLE` 모드에서는 외부 클라이언트의 TLS가 게이트웨이 Envoy에서 끝납니다. 인증서는 `credentialName`이 가리키는 Kubernetes Secret에서 가져옵니다. Gateway API에서는 `certificateRefs`가 같은 역할을 맡습니다. 게이트웨이 파드의 istio-agent가 Secret을 읽어 SDS로 Envoy에 전달합니다.

Istio API에서 Secret을 둘 곳은 게이트웨이 Deployment의 네임스페이스입니다. Gateway 리소스의 위치를 기준으로 삼지 않습니다. 현재 보안 권장에 따라 게이트웨이를 컨트롤 플레인과 다른 네임스페이스인 `istio-ingress`에 둔다면, Secret도 그곳에 둡니다.

TLS를 끝내지 않는 설정에서는 이후 동작이 달라집니다. `PASSTHROUGH`는 SNI만 보고 암호화된 연결을 그대로 넘기며, `AUTO_PASSTHROUGH`는 VirtualService 없이 SNI로 목적지를 찾습니다. 게이트웨이가 HTTP를 읽지 못하므로 route 설정 이름도 생기지 않고, 경로나 헤더로 요청을 나누지도 못합니다. 클라이언트 인증서까지 확인하는 모드는 `MUTUAL`과 `OPTIONAL_MUTUAL`입니다.

## Service 이름은 수신인, 파드 IP는 배달 주소 {#목적지는-service-이름으로-정하고-연결은-파드-ip로}

TLS를 풀면 Host 헤더와 경로가 보입니다. 게이트웨이는 이 값을 route에 맞춰 목적지 cluster를 고릅니다. route는 요청을 어디로 보낼지 정하는 설정이고, cluster는 그 목적지의 엔드포인트 묶음입니다.

istiod는 VirtualService를 `gateways`로 연결된 Gateway의 route 설정에 넣습니다. `gateways`를 생략하면 기본값 `mesh`가 적용되므로 게이트웨이의 route에는 들어오지 않습니다([15 CRD 카탈로그]({{< relref "/platform/istio/configuration/15-crd-catalog/index.md" >}})).

route 설정을 찾을 때는 이름을 알아야 합니다. 평문 HTTP 서버는 `http.<targetPort>`, TLS를 종료하는 HTTPS 서버는 `https.<포트>.<포트 이름>.<Gateway 이름>.<네임스페이스>`를 씁니다. 예시의 route 이름은 `https.443.https.web-gateway.istio-ingress`입니다.

그 route가 가리키는 cluster 이름에는 `destination.host`와 포트가 들어갑니다. 예시에서는 `outbound|8080||cart.shop.svc.cluster.local`입니다. 가운데 빈칸은 subset 자리이며, DestinationRule의 subset을 지정하면 그 이름이 들어갑니다.

게이트웨이 파드에서 listener, route, cluster를 차례로 조회하면 작성한 설정이 어디까지 반영됐는지 드러납니다.

```bash
GW=$(kubectl -n istio-ingress get pod -l istio=ingressgateway -o name | head -1)
istioctl proxy-config listener -n istio-ingress ${GW#pod/}
istioctl proxy-config route    -n istio-ingress ${GW#pod/} --name https.443.https.web-gateway.istio-ingress -o json
istioctl proxy-config cluster  -n istio-ingress ${GW#pod/} --fqdn cart.shop.svc.cluster.local
```

listener에 포트가 없으면 Gateway가 이 파드를 고르지 못한 것입니다. route에 `/cart`가 없다면 VirtualService가 이 Gateway에 연결되지 않은 것입니다. listener → route → cluster 순서가 곧 진단 순서입니다. 이 설정들이 xDS의 어느 종류로 번역되는지는 [13 Envoy 조립]({{< relref "/platform/istio/fundamentals/13-istio-envoy-assembly/index.md" >}})에 정리되어 있습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| Gateway는 "a load balancer operating at the edge of the mesh", 설정은 "standalone Envoy proxies"에 적용되고 라우팅하려면 VirtualService를 바인딩해야 한다 | Istio 1.31.4 문서 | [Gateway 레퍼런스](https://istio.io/latest/docs/reference/config/networking/gateway/) · [Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/) |
| 리스너는 Service port를 targetPort로 바꾼 뒤 연다. 비특권 파드는 1024 미만 포트를 건너뛴다 | release-1.31 소스 주석 "mergeGateways will already translate Service port to targetPort" | [istio/istio `pilot/pkg/networking/core/gateway.go`](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/core/gateway.go) |
| route 이름 `http.<port>[.<bind>]`, `https.<port>.<portName>.<gateway>.<namespace>[.<bind>]`. PASSTHROUGH와 비HTTP 서버는 RDS 이름이 없다 | release-1.31 `gatewayRDSRouteName` | [istio/istio `pilot/pkg/model/gateway.go`](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/model/gateway.go) |
| cluster 이름 `outbound\|<port>\|<subset>\|<host>` | release-1.31 `BuildSubsetKey`, 문서 예시 `outbound\|9080\|\|reviews.default.svc.cluster.local` | [Debugging Envoy and Istiod](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/) |
| `gateways` 생략 시 기본값 `mesh` | Istio 1.31.4 | [VirtualService 레퍼런스](https://istio.io/latest/docs/reference/config/networking/virtual-service/) |
| Gateway `selector`는 기본적으로 모든 네임스페이스에서 찾고, istiod `PILOT_SCOPE_GATEWAY_TO_NAMESPACE=true`면 설정 네임스페이스로 좁힌다 | Istio 1.31.4 | [Gateway 레퍼런스](https://istio.io/latest/docs/reference/config/networking/gateway/) |
{{% /details %}}

### 엔드포인트 목록에 적힌 실제 배달 주소 {#실제-연결-주소는-엔드포인트-목록에-있다}

설정에는 Service 이름을 썼지만 연결 대상은 파드입니다. istiod는 쿠버네티스 Service를 EDS 타입 cluster로 만들고, Service 뒤에 있는 파드의 IP:port 목록을 엔드포인트로 내려 줍니다. 게이트웨이 Envoy는 그 목록에서 파드 하나를 직접 고릅니다. 기본 알고리즘은 least request입니다. 헤드리스 Service도 게이트웨이에서는 EDS cluster로 바뀝니다.

그래서 이 홉에서는 kube-proxy가 끼어들 자리가 없습니다. ClusterIP를 목적지로 쓰지 않으니 노드의 Service DNAT 규칙을 거치지 않습니다.

게이트웨이의 분산 단위는 연결이 아니라 요청입니다. DestinationRule의 로드밸런싱·커넥션 풀·outlier 설정도 이 선택에 그대로 적용됩니다. 게이트웨이가 가진 엔드포인트 목록이 곧 실제 목적지이므로, 어디로 보내는지 진단할 때도 이 목록을 보면 됩니다.

```bash
istioctl proxy-config endpoint -n istio-ingress ${GW#pod/} \
  --cluster "outbound|8080||cart.shop.svc.cluster.local"
# ENDPOINT 열에 10.x.y.z:8080 같은 파드 IP가 보이고, STATUS가 HEALTHY인지 본다
```

파드가 Ready가 아니거나 Service 셀렉터가 틀리면 목록이 빕니다. 게이트웨이는 보낼 곳이 없어 503을 돌려줍니다. 응답 플래그로 이 상황을 구분하는 방법은 [05편]({{< relref "/study/istio-mesh/05-logs-and-tracing/index.md" >}})에서 이어집니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 쿠버네티스 Service(ClientSideLB)는 EDS cluster가 되고, 게이트웨이는 passthrough cluster를 쓸 수 없어 헤드리스도 EDS로 대체한다("Gateways cannot use passthrough clusters. So fallback to EDS") | release-1.31 `convertResolution` | [istio/istio `pilot/pkg/networking/core/cluster.go`](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/core/cluster.go) |
| Envoy는 서비스의 load balancing pool에 분산하고 기본은 least requests | Istio 1.31.4 | [Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/) |
| `proxy-config endpoints --cluster outbound\|...` 출력이 파드 IP:port | 문서 예시는 사이드카 대상, 게이트웨이에도 같은 명령을 쓴다 | [Debugging Envoy and Istiod](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/) |
| "kube-proxy를 우회한다"를 그대로 적은 istio.io 문장 | 찾지 못함. EDS가 파드 IP를 직접 쓴다는 위 두 사실에서 도출 | — |
{{% /details %}}

### 메시 안쪽에서 내미는 워크로드 인증서 {#메시-안쪽-연결에는-워크로드-인증서}

대상 파드에 사이드카가 있으면 게이트웨이는 클라이언트 프록시로서 mTLS 연결을 엽니다. 이때는 외부용 Secret 대신 istiod가 서명한 게이트웨이 자신의 워크로드 인증서(SPIFFE ID)를 씁니다.

{{< seq src="_seq/4-tls-종료와-재암호화.json" />}}

게이트웨이에 실린 인증서는 `proxy-config secret`으로 확인합니다.

```bash
istioctl proxy-config secret -n istio-ingress ${GW#pod/}   # credentialName 인증서와 워크로드 인증서가 함께 실려 있는지 본다
```

게이트웨이와 사이드카 사이의 mTLS가 어떤 핸드셰이크와 정책으로 성립하는지는 [03편]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}})에서 다룹니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| Secret은 게이트웨이 Deployment와 같은 네임스페이스("The Certificate should be created in the same namespace as the istio-ingressgateway deployment") | Istio API Gateway, 1.31.4 | [cert-manager 연동](https://istio.io/latest/docs/ops/integrations/certmanager/) |
| 게이트웨이 agent가 키·인증서를 Envoy에 push하고 SDS 요청을 받는 것을 로그로 확인 | 같은 버전 | [Secure Gateways](https://istio.io/latest/docs/tasks/traffic-management/ingress/secure-ingress/) |
| 게이트웨이는 컨트롤 플레인과 다른 네임스페이스에 두는 것이 보안 권장 | 같은 버전 | [Installing Gateways](https://istio.io/latest/docs/setup/additional-setup/gateway/) |
| "Sidecar and perimeter proxies work as Policy Enforcement Points", "Istio automatically upgrades all traffic between two PEPs to mutual TLS" | PeerAuthentication이 mTLS를 끄지 않은 경우 | [Security 개념](https://istio.io/latest/docs/concepts/security/) |
| TLS 모드 SIMPLE·MUTUAL·OPTIONAL_MUTUAL·PASSTHROUGH·AUTO_PASSTHROUGH·ISTIO_MUTUAL의 정의 | 같은 버전 | [Gateway 레퍼런스](https://istio.io/latest/docs/reference/config/networking/gateway/) |
| `proxy-config secret`에 외부 인증서와 워크로드 인증서가 함께 보인다는 설명 | 위 문서들에서 도출한 기대값, 출력 예시를 문서에서 직접 보지는 못함 | — |
{{% /details %}}

## 8080행 봉투를 먼저 받는 15006 {#목적지는-8080-먼저-받는-곳은-15006}

게이트웨이가 연 연결의 목적지는 `파드IP:8080`입니다. 앱 컨테이너의 포트지만 앱이 바로 받지는 않습니다. 대상 파드의 네트워크 네임스페이스에 준비된 규칙이 인바운드 TCP를 사이드카의 15006으로 돌립니다.

15006에서는 `virtualInbound` listener 하나가 기다립니다. 원래 목적지 포트를 보고 필터 체인을 고른 뒤 게이트웨이가 연 mTLS를 종료합니다. HTTP로 판별된 포트라면 사이드카도 요청을 L7로 읽습니다.

복호화한 요청은 `inbound|8080||` cluster로 넘어갑니다. 이 cluster는 원래 목적지 주소를 그대로 쓰므로 앱은 자기 파드 IP의 8080에서 요청을 받습니다. Istio 1.10부터 적용된 동작입니다. 그 전에는 localhost로 넘겼기 때문에 `127.0.0.1`에만 바인딩한 앱도 받았지만, 지금은 그런 앱에 닿지 않습니다.

대상 파드에서도 수신 listener와 앱으로 넘기는 cluster를 확인합니다.

```bash
istioctl proxy-config listener <대상-파드> -n shop --port 15006
istioctl proxy-config cluster  <대상-파드> -n shop --direction inbound
```

이 가로채기 규칙은 요청이 오기 전에 준비됩니다. 기본 구성에서는 주입된 `istio-init` init 컨테이너가 `NET_ADMIN`·`NET_RAW` 권한을 받아 규칙을 설치합니다. Istio CNI를 쓰면 노드 에이전트가 파드 생성 시점에 같은 규칙을 설치하고, 파드의 `istio-validation` init 컨테이너는 리다이렉션이 제대로 됐는지만 검사합니다.

특정 포트를 가로채기에서 제외하는 설정도 있습니다.

```yaml
# 특정 포트를 가로채기에서 빼고 싶을 때 (파드 템플릿 어노테이션)
metadata:
  annotations:
    traffic.sidecar.istio.io/excludeInboundPorts: "9100"
```

제외한 포트의 연결은 앱에 바로 닿습니다. 이 경로에는 mTLS도 사이드카 메트릭도 없습니다.

설정으로 제외하지 않았는데 인바운드 규칙을 우회하는 경로에는 보안 수정이 들어옵니다. 1.31.4에는 오래된 conntrack 항목 때문에 사이드카를 건너뛰는 경우를 막도록, SYN 패킷 규칙을 ESTABLISHED 규칙보다 먼저 평가하는 수정이 포함됐습니다.

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

## Gateway API로 문지기를 세우는 방식 {#gateway-api를-쓰면-배포-방식이-달라진다}

같은 진입점을 Kubernetes Gateway API로 작성해도 Envoy가 요청을 처리하는 경로는 같습니다. 크게 달라지는 것은 게이트웨이를 배포하는 방식입니다. Istio API의 Gateway는 이미 떠 있는 파드를 `selector`로 고르지만, Gateway API의 Gateway는 게이트웨이를 구성하고 배포합니다. 기본적으로 Gateway를 만들면 `<Gateway 이름>-<GatewayClass 이름>`의 Service와 Deployment가 자동으로 생깁니다.

포트·호스트·TLS는 `Gateway`의 `listeners`에 적고, `HTTPRoute`는 `parentRefs`로 그 Gateway에 연결합니다. 아래처럼 Gateway와 HTTPRoute가 다른 네임스페이스에 있다면 Gateway의 `allowedRoutes`가 연결을 허용해야 합니다.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata: { name: web, namespace: istio-ingress }
spec:
  gatewayClassName: istio            # → Service·Deployment "web-istio"
  listeners:
  - name: https
    port: 443
    protocol: HTTPS
    hostname: shop.example.com
    tls: { certificateRefs: [ { name: web-cert } ] }
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: shop, namespace: shop }
spec:
  parentRefs: [ { name: web, namespace: istio-ingress } ]
  rules:
  - matches: [ { path: { type: PathPrefix, value: /cart } } ]
    backendRefs: [ { name: cart, port: 8080 } ]
```

YAML의 형태가 달라도 생성되는 Envoy 설정을 확인하는 방법은 같습니다. Istio의 Gateway API 컨트롤러가 이 리소스를 내부의 Istio Gateway·VirtualService로 바꾸고, 같은 생성기가 listener·route·cluster를 만듭니다. 앞서 쓴 `istioctl proxy-config`로 경로를 확인하는 이유입니다.

자동으로 생성되는 Deployment의 리소스나 레플리카는 `infrastructure`와 `parametersRef`로 조정합니다. Istio와 Cilium이 Gateway API를 구현하는 방식의 차이는 [Cilium 비교 02편]({{< relref "/platform/istio/cilium/02-gateway-api/index.md" >}})에서 다뤘습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| Gateway API의 Gateway는 "both configures and deploys a gateway", 기본적으로 Gateway마다 Service와 Deployment를 `<Gateway name>-<GatewayClass name>`으로 만든다 | Istio 1.31.4, Gateway API v1.6.0 CRD 기준 | [Istio — Gateway API](https://istio.io/latest/docs/tasks/traffic-management/ingress/gateway-api/) |
| `infrastructure`의 labels·annotations가 생성 리소스에 복사되고, `parametersRef`(같은 네임스페이스 ConfigMap)로 전부 바꿀 수 있다 | 같은 문서 | 같은 문서 |
| Istio는 Gateway API를 앞으로 트래픽 관리의 기본 API로 삼을 계획이다(시점 미정) | 같은 문서 | 같은 문서 |
| 컨트롤러가 Gateway API 리소스를 "Istio types (Gateway/VirtualService)"로 번역하고, 같은 gateway·hostname의 HTTP·gRPC 라우트를 VirtualService 하나로 합친다 | release-1.31 소스 | [istio/istio `pilot/pkg/config/kube/gateway/controller.go`](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/config/kube/gateway/controller.go) |
{{% /details %}}

## ambient의 문 앞에서는 ztunnel이 받는다 {#ambient-목적지에서는-ztunnel이-받는다}

목적지 워크로드가 ambient 모드라면 파드 안에 사이드카가 없고, 15006 가로채기도 없습니다. 받는 쪽은 노드의 ztunnel입니다. HBONE은 관례상 15008에서 받습니다. NLB가 연결을 넘기고 게이트웨이 Envoy가 TLS를 종료해 route를 고르는 앞부분은 그대로입니다.

목적지 서비스에 waypoint를 붙였다고 인그레스 요청도 그곳을 지나는 것은 아닙니다. 기본적으로 인그레스에서 들어온 요청은 목적지 waypoint를 건너뜁니다. 메시 내부 호출과 같은 L7 정책을 인그레스 요청에도 적용하려면 Service나 네임스페이스에 `istio.io/ingress-use-waypoint: "true"`를 붙여야 합니다.

HBONE 터널이 맺어지는 과정은 [03편]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}})과 [Envoy config로 해부하는 Ambient mode]({{< relref "/platform/istio/ambient/02-envoy-config-anatomy/index.md" >}})에서 이어집니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| HBONE을 이해하는 프록시는 관례상 TCP 15008에 리스너를 연다 | Istio 1.31.4 | [HBONE](https://istio.io/latest/docs/ambient/architecture/hbone/) |
| 인그레스 발 트래픽은 기본적으로 목적지 waypoint를 쓰지 않고, `istio.io/ingress-use-waypoint=true`로 켠다. 네임스페이스 라벨은 1.25부터 | 문서는 istiod `ENABLE_INGRESS_WAYPOINT_ROUTING`(기본 false)도 함께 언급 | [Waypoint 사용](https://istio.io/latest/docs/ambient/usage/waypoint/) |
| 게이트웨이가 ambient 목적지에 HBONE으로 보낸다는 문장 | istio.io에서 직접 확인하지 못함 | — |
{{% /details %}}

[다음 편]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}})에서는 사이드카가 요청을 보내는 지점에서 출발합니다. 15001 아웃바운드 가로채기부터 상대 사이드카의 15006까지, 두 프록시가 서로를 확인하고 연결을 맺는 과정을 다룹니다.

같은 경로를 포트 지도와 함께 한 장으로 보고 싶다면 [11 요청 경로 해부]({{< relref "/platform/istio/fundamentals/11-request-path-anatomy/index.md" >}})도 함께 읽으면 됩니다.
