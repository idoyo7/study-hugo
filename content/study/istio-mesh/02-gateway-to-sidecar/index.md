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

게이트웨이 앞에서는 아직 HTTP를 읽지 않습니다. NLB는 TLS를 풀거나 Host 헤더를 읽지 않으므로, 뒤에 도메인이 열 개 있어도 443 포트로 들어오는 연결만 봅니다.

NLB는 연결을 게이트웨이 파드 쪽으로 나눕니다. `instance` 대상 모드는 노드의 NodePort를 거쳐 kube-proxy 규칙이 파드를 고르고, `ip` 대상 모드는 파드 IP를 직접 등록해 노드 홉이 빠집니다. 어느 쪽이든 분산 단위는 연결이라 장수 연결이 한 게이트웨이에 쏠릴 수 있습니다.

여기서는 TLS를 게이트웨이까지 통과시킵니다. NLB에 TLS 리스너를 두면 NLB에서 TLS가 끝나므로 [01편의 TLS 종료 위치]({{< relref "/study/istio-mesh/01-l4-l7-before-mesh/index.md#암호화된-요청이-nlb를-지날-때" >}})와 구분해야 합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| NLB 대상 기본값은 `instance`, 어노테이션 `service.beta.kubernetes.io/aws-load-balancer-nlb-target-type`로 `ip` 선택. `ip` 모드는 파드 ENI 보안그룹을 쓴다 | AWS Load Balancer Controller v2.2.0 이상 | [AWS LBC — NLB](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/service/nlb/) |
| `instance` 모드가 NodePort·kube-proxy를 거친다는 설명 | 쿠버네티스 LoadBalancer Service의 일반 동작에서 따온 설명, 위 페이지 문장은 아님 | — |
{{% /details %}}

## 설정이 바뀌는 자리, 요청이 흐르는 자리 {#443을-넘겨받은-envoy가-tls를-끝내는-자리}

게이트웨이도 사이드카와 같은 Envoy이고, 받을 포트와 보낼 곳은 컨트롤 플레인인 istiod가 정합니다. 아래는 [Istio 공식 아키텍처 문서](https://istio.io/latest/docs/ops/deployment/architecture/)의 사이드카 모드 그림과 같은 배치로 다시 그린 것입니다.

{{< flow src="_flow/1b-istiod와-xds-push.json" />}}

istiod는 쿠버네티스 API에서 Service·Endpoint와 Istio CRD를 watch하다가 변경이 생기면 영향받는 프록시에 설정을 밀어 줍니다. 프록시가 istiod로 열어 둔 gRPC 스트림으로 listener·route·cluster·endpoint 설정(LDS·RDS·CDS·EDS)과 mTLS 인증서(SDS)를 받습니다. 인증서를 서명하는 CA도 istiod입니다. 요청은 이 스트림을 타지 않고 위 줄의 실선으로 흐릅니다.

스트림이 장수 연결이라 istiod를 늘려도 기존 스트림은 새 파드로 옮겨가지 않습니다([스케일링과 커넥션 재분배]({{< relref "/platform/istio/operations/09-istiod-scaling-connections/index.md" >}}), [istiod 해부]({{< relref "/platform/istio/operations/02-istiod-control-plane/index.md" >}})).

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| istiod는 플랫폼별 서비스 디스커버리를 추상화하고(Discovery), 라우팅 규칙을 Envoy 설정으로 바꿔 런타임에 사이드카로 밀며(Configuration), 인증서를 발급하는 CA다(Certificates) | Istio 문서의 아키텍처 절 | [Istio — Architecture](https://istio.io/latest/docs/ops/deployment/architecture/) |
| 그림의 배치 | 공식 아키텍처 그림(사이드카 모드)과 같은 배치로 다시 그림. 데이터 플레인이 위(Ingress → Service A → Service B → Egress), istiod가 아래에서 Discovery·Configuration·Certificates를 프록시에 내려보낸다. 그림 파일은 복제하지 않았다. 공식 그림의 Ingress traffic 자리에 ingress gateway를, istiod 옆에 Kubernetes API를 더했고 xDS 종류는 이 사이트의 다른 글을 따름 | [Architecture](https://istio.io/latest/docs/ops/deployment/architecture/) |
| xDS는 장수 gRPC 스트림이라 istiod를 늘려도 기존 연결은 재분배되지 않는다 | 사이트 내 기존 글 | [istiod 스케일링]({{< relref "/platform/istio/operations/09-istiod-scaling-connections/index.md" >}}) |
{{% /details %}}

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

`web-cert` Secret은 게이트웨이 **Deployment의 네임스페이스**에 둡니다. 게이트웨이 파드의 istio-agent가 이 Secret을 읽어 SDS로 Envoy에 전달합니다.

`gateways`를 생략하면 기본 대상은 `mesh`이므로 이 게이트웨이에는 경로가 붙지 않습니다. 또 Gateway에 적은 443이 Envoy의 수신 포트인 것도 아닙니다. istiod가 Service의 포트를 targetPort로 바꿔 listener를 만들기 때문이며, targetPort가 8443이면 listener도 8443입니다.

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

TLS를 종료하는 HTTPS 서버의 route 이름은 `https.<포트>.<포트 이름>.<Gateway 이름>.<네임스페이스>`라서 이 예시에서는 `https.443.https.web-gateway.istio-ingress`입니다. cluster 이름의 가운데 빈칸은 subset 자리입니다.

listener에 포트가 없으면 Gateway가 이 파드를 고르지 못한 것입니다. route에 `/cart`가 없다면 VirtualService가 이 Gateway에 연결되지 않은 것입니다. 각 설정이 xDS의 어느 종류로 번역되는지는 [13 Envoy 조립]({{< relref "/platform/istio/fundamentals/13-istio-envoy-assembly/index.md" >}})에 정리되어 있습니다.

endpoint 조회에서는 파드 IP가 보이고 STATUS가 HEALTHY인지 봅니다. 파드가 Ready가 아니거나 Service 셀렉터가 틀리면 목록이 비고, 게이트웨이는 보낼 곳이 없어 503을 돌려줍니다. 이 상황을 구분하는 방법은 [05편]({{< relref "/study/istio-mesh/05-logs-and-tracing/index.md" >}})에서 이어집니다.

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

## 외부 TLS와 내부 mTLS {#메시-안쪽-연결에는-워크로드-인증서}

{{< seq src="_seq/4-tls-종료와-재암호화.json" />}}

외부 TLS와 내부 mTLS는 **별개의 연결**입니다. 외부에는 도메인 인증서를, 내부에는 게이트웨이 자신의 워크로드 인증서를 씁니다. 대상이 메시 프록시이고 TLS 정책이 허용하는 구성에서 auto mTLS가 적용됩니다.

`SIMPLE`은 TLS를 끝내 HTTP를 읽습니다. `PASSTHROUGH`는 SNI로 암호화된 연결을 넘기므로 경로·헤더 분기는 할 수 없고 route 설정 이름도 생기지 않습니다. `AUTO_PASSTHROUGH`는 VirtualService 없이 SNI로 목적지를 찾습니다. 클라이언트 인증서까지 확인하는 모드는 `MUTUAL`과 `OPTIONAL_MUTUAL`입니다.

두 프록시의 인증과 수신 정책은 [03편]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}})에서 이어집니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| "Sidecar and perimeter proxies work as Policy Enforcement Points", "Istio automatically upgrades all traffic between two PEPs to mutual TLS" | PeerAuthentication이 mTLS를 끄지 않은 경우 | [Security 개념](https://istio.io/latest/docs/concepts/security/) |
| TLS 모드 SIMPLE·MUTUAL·OPTIONAL_MUTUAL·PASSTHROUGH·AUTO_PASSTHROUGH·ISTIO_MUTUAL의 정의 | 같은 버전 | [Gateway 레퍼런스](https://istio.io/latest/docs/reference/config/networking/gateway/) |
{{% /details %}}

## 앱 앞에서 거치는 15006 {#목적지는-8080-먼저-받는-곳은-15006}

{{< flow src="_flow/5-15006에서-앱까지.json" />}}

네트워크의 목적지는 `파드 IP:8080`이지만, 파드의 리다이렉트 규칙이 먼저 `:15006`으로 돌립니다. 15006에서는 `virtualInbound` listener가 원래 목적지 포트에 맞는 필터 체인을 고르고 mTLS를 종료합니다. HTTP 포트라면 여기서도 L7로 읽습니다.

복호화한 요청은 `inbound|8080||`을 거쳐 기본 구성에서 **파드 IP:8080**의 앱으로 갑니다. 이 cluster는 원래 목적지 주소를 그대로 쓰므로 앱은 자기 파드 IP의 8080에서 요청을 받습니다. Istio 1.10 이전에는 localhost로 넘겨 `127.0.0.1`에만 바인딩한 앱도 받았지만, 지금은 그런 앱에 닿지 않습니다.

대상 파드에서도 수신 listener와 앱으로 넘기는 cluster를 확인합니다.

```bash
istioctl proxy-config listener <대상-파드> -n shop --port 15006
istioctl proxy-config cluster  <대상-파드> -n shop --direction inbound
```

리다이렉트 규칙은 요청 전에 준비됩니다. 기본 구성에서는 `istio-init` init 컨테이너가 `NET_ADMIN`·`NET_RAW` 권한으로 규칙을 설치하고, Istio CNI를 쓰면 노드 에이전트가 같은 일을 하며 `istio-validation`이 검사만 맡습니다.

파드 어노테이션 `traffic.sidecar.istio.io/excludeInboundPorts`로 제외한 포트는 앱에 직접 닿으므로 사이드카의 mTLS·관측도 거치지 않습니다.

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

## Gateway API와 ambient의 경계 {#gateway-api를-쓰면-배포-방식이-달라진다}

Kubernetes Gateway API에서는 `Gateway`가 기본적으로 Service·Deployment까지 만들고, `HTTPRoute.parentRefs`가 경로를 연결합니다. 다른 네임스페이스의 Route를 붙일 때는 `allowedRoutes`도 허용해야 합니다. Envoy의 요청 처리와 진단 순서는 같습니다([Gateway API 비교]({{< relref "/platform/istio/cilium/02-gateway-api/index.md" >}})).

Istio의 Gateway API 컨트롤러는 이 리소스를 내부의 Istio Gateway·VirtualService로 바꾸므로, 앞서 쓴 `istioctl proxy-config`로 같은 방식으로 확인합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| Gateway API의 Gateway는 "both configures and deploys a gateway", 기본적으로 Gateway마다 Service와 Deployment를 `<Gateway name>-<GatewayClass name>`으로 만든다 | Istio 1.31.4, Gateway API v1.6.0 CRD 기준 | [Istio — Gateway API](https://istio.io/latest/docs/tasks/traffic-management/ingress/gateway-api/) |
| `infrastructure`의 labels·annotations가 생성 리소스에 복사되고, `parametersRef`(같은 네임스페이스 ConfigMap)로 전부 바꿀 수 있다 | 같은 문서 | 같은 문서 |
| 컨트롤러가 Gateway API 리소스를 "Istio types (Gateway/VirtualService)"로 번역하고, 같은 gateway·hostname의 HTTP·gRPC 라우트를 VirtualService 하나로 합친다 | release-1.31 소스 | [istio/istio `pilot/pkg/config/kube/gateway/controller.go`](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/config/kube/gateway/controller.go) |
{{% /details %}}

<span id="ambient-목적지에서는-ztunnel이-받는다"></span>

ambient 목적지에는 파드 사이드카가 없으므로 위의 15006 그림을 그대로 적용하지 않습니다. 노드의 ztunnel과 HBONE 경로를 봐야 합니다. HBONE은 관례상 15008에서 받습니다.

인그레스 요청은 목적지 waypoint가 있어도 기본적으로 건너뛰며, 메시 내부 호출과 같은 L7 정책을 적용하려면 Service나 네임스페이스에 `istio.io/ingress-use-waypoint: "true"`를 붙여야 합니다. 네임스페이스 라벨은 1.25부터입니다([waypoint 공식 문서](https://istio.io/latest/docs/ambient/usage/waypoint/)).

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| HBONE을 이해하는 프록시는 관례상 TCP 15008에 리스너를 연다 | Istio 1.31.4 | [HBONE](https://istio.io/latest/docs/ambient/architecture/hbone/) |
| 인그레스 발 트래픽은 기본적으로 목적지 waypoint를 쓰지 않고, `istio.io/ingress-use-waypoint=true`로 켠다. 네임스페이스 라벨은 1.25부터 | 문서는 istiod `ENABLE_INGRESS_WAYPOINT_ROUTING`(기본 false)도 함께 언급 | [Waypoint 사용](https://istio.io/latest/docs/ambient/usage/waypoint/) |
| 게이트웨이가 ambient 목적지에 HBONE으로 보낸다는 문장 | istio.io에서 직접 확인하지 못함 | — |
{{% /details %}}

이전 [01 L4와 L7]({{< relref "/study/istio-mesh/01-l4-l7-before-mesh/index.md" >}}) · 다음 [03 사이드카와 사이드카 사이]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}})

## 참고 자료

- [AWS Load Balancer Controller — NLB 대상 모드](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/service/nlb/)
- [Istio — Gateway와 TLS 모드](https://istio.io/latest/docs/reference/config/networking/gateway/)
- [Istio — Envoy 설정 확인](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/)
- [Istio — 인증서를 사용하는 게이트웨이](https://istio.io/latest/docs/tasks/traffic-management/ingress/secure-ingress/)
- [Istio — 앱 인바운드의 네트워크 변경](https://istio.io/latest/blog/2021/upcoming-networking-changes/)
- [Istio — 아키텍처](https://istio.io/latest/docs/ops/deployment/architecture/)
