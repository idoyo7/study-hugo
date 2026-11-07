---
title: "03 낯선 두 프록시가 신분증을 주고받는 법 — 사이드카와 사이드카 사이"
description: "앱이 ClusterIP로 보낸 요청은 어떻게 대상 파드에 닿는가. 보내는 사이드카가 원래 목적지를 찾고 HTTP 라우트와 EDS로 파드를 고른 뒤, 별도의 커넥션으로 요청을 전달한다. 엔드포인트에 `tlsMode: istio`가 있으면 mTLS를 쓰고, 없으면 평문으로 보낸다."
date: 2026-11-07
lastmod: 2026-11-07
weight: 3
url: "/study/istio-mesh/03-proxy-to-proxy/"
aliases:
  - "/istio/mesh-traffic/03-proxy-to-proxy/"
---

# 03 · 낯선 두 프록시가 신분증을 주고받는 법 — 사이드카와 사이드카 사이

[02편]({{< relref "/study/istio-mesh/02-gateway-to-sidecar/index.md" >}})에서는 외부 요청이 게이트웨이 Envoy를 지나 대상 파드의 사이드카 `:15006`에 도착했습니다. 이번 요청은 메시 안에서 출발합니다. 파드 A의 앱이 `http://svc-b:8080`을 호출하면 게이트웨이를 거치지 않고 양쪽 파드의 사이드카를 지납니다.

앱이 연 커넥션이 상대 앱까지 그대로 이어지지는 않습니다. 보내는 사이드카가 요청을 받아 대상 파드를 고르고, 그 파드로 별도의 커넥션을 엽니다. 아래 경로는 Istio 1.31.4(Envoy 1.39 계열)의 사이드카 모드를 기준으로 합니다.

{{< flow src="_flow/1-커넥션-하나가-지나는-리스너.json" />}}

## ClusterIP로 향한 연결이 먼저 두드리는 문 {#clusterip로-연-커넥션이-먼저-닿는-곳}

앱이 지정한 TCP 커넥션의 목적지는 `svc-b`의 ClusterIP입니다. 하지만 파드 네트워크 네임스페이스의 iptables 규칙이 이 커넥션을 같은 파드의 Envoy `:15001`로 REDIRECT합니다. `istio-init` 컨테이너나 Istio CNI 플러그인이 파드가 뜰 때 넣어 둔 규칙입니다.

목적지가 바뀌어도 원래 주소는 남습니다. iptables REDIRECT가 소켓 옵션 `SO_ORIGINAL_DST`에 남긴 값을 Envoy의 `original_dst` 리스너 필터가 읽습니다.

`:15001`의 이름은 `virtualOutbound`입니다. 이 리스너는 직접 요청을 처리하지 않고, `use_original_dst` 설정에 따라 원래 목적지에 가장 잘 맞는 가상 리스너로 커넥션을 넘깁니다. HTTP 포트 8080에 대응하는 리스너는 `0.0.0.0_8080`입니다.

대응하는 리스너가 없으면 `PassthroughCluster`가 원래 목적지로 연결합니다. 기본값인 `outboundTrafficPolicy: ALLOW_ANY`가 이 동작을 허용하므로, 메시가 모르는 외부 주소로 향하는 호출도 나갈 수 있습니다.

원래 목적지를 찾는 리스너와 HTTP 요청을 처리하는 리스너는 각각 확인합니다.

```bash
# :15001이 무엇을 하는지, 8080 가상 리스너가 무엇을 들고 있는지
istioctl proxy-config listeners <pod-a> --port 15001 -o json
istioctl proxy-config listeners <pod-a> --address 0.0.0.0 --port 8080 -o json
```

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| CNI가 없으면 `istio-init`이 `NET_ADMIN`·`NET_RAW`로 iptables 리다이렉트를 구성 | Istio 1.31.4 | [Application Requirements](https://istio.io/latest/docs/ops/deployment/application-requirements/) |
| 15001 Envoy outbound, 15006 Envoy inbound, 15008 HBONE, 15000 admin(파드 내부 전용) | 같은 문서의 포트 표 | 위 문서 |
| `original_dst` 필터는 iptables REDIRECT·TPROXY가 남긴 `SO_ORIGINAL_DST`를 읽음 | Envoy v1.39.6 | [Envoy original_dst filter](https://www.envoyproxy.io/docs/envoy/v1.39.6/configuration/listeners/listener_filters/original_dst_filter) |
| `use_original_dst`는 원래 목적지에 대응하는 리스너로 넘기고, 없으면 받은 리스너가 처리. 기본 false | Envoy v1.39.6 | [listener.proto](https://www.envoyproxy.io/docs/envoy/v1.39.6/api-v3/config/listener/v3/listener.proto) |
| `virtualOutbound`가 원래 목적지에 가장 맞는 가상 리스너로 넘기고, 없으면 PassthroughCluster | Istio 1.31.4 | [Debugging Envoy and Istiod](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/) |
| `outboundTrafficPolicy` 기본 `ALLOW_ANY` | MeshConfig | [MeshConfig](https://istio.io/latest/docs/reference/config/istio.mesh.v1alpha1/) |
{{% /details %}}

## 포트 선언이 먼저 붙이는 HTTP 이름표 {#http인지는-포트-선언이-먼저-정한다}

8080을 HTTP로 처리하는 근거는 Service 정의에 있습니다. 포트에 `appProtocol`이 있으면 그 값을 쓰고, 없으면 `name: http-web`처럼 `<protocol>[-<suffix>]` 형식으로 붙인 이름을 봅니다. 둘 다 선언했다면 `appProtocol`이 우선입니다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: svc-b
spec:
  ports:
  - name: http-web       # 이름 규약
    port: 8080
    appProtocol: http    # 이름보다 우선
```

선언이 없으면 자동 감지로 넘어갑니다. 아웃바운드 리스너의 HTTP Inspector가 커넥션의 첫 바이트를 읽어 HTTP/1.1인지 h2c인지 판별합니다. 자동으로 알아보는 범위는 HTTP와 HTTP/2뿐입니다. 판별하지 못한 커넥션은 평문 TCP로 취급하므로 HTTP 라우트, 재시도, HTTP 메트릭 없이 바이트만 중계합니다.

MySQL처럼 서버가 먼저 말하는 프로토콜은 이 방식과 맞지 않습니다. 클라이언트가 보낼 첫 바이트가 없기 때문입니다. Istio는 25, 53, 3306, 27017 포트를 TCP로 간주하며, 그 밖의 포트에서 이런 프로토콜을 쓴다면 `tcp`로 명시해야 합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| `appProtocol`이 포트 이름보다 우선, 이름 규약 `<protocol>[-<suffix>]` | Istio 1.31.4 | [Protocol Selection](https://istio.io/latest/docs/ops/configuration/traffic-management/protocol-selection/) |
| 자동 감지는 HTTP·HTTP/2, 실패하면 plain TCP | 같은 문서 | 위 문서 |
| server-first는 자동 감지·PERMISSIVE와 비호환(둘 다 초기 바이트를 읽음). 25·53·3306·27017은 TCP로 간주 | Istio 1.31.4 | [Application Requirements](https://istio.io/latest/docs/ops/deployment/application-requirements/) |
{{% /details %}}

### Host라는 이름을 따라 파드 IP까지 {#host에서-대상-파드-ip까지}

HTTP로 처리하는 `0.0.0.0_8080` 리스너에는 HTTP 커넥션 매니저가 있습니다. 이 매니저는 RDS로 받아 둔 라우트 설정 `8080`을 사용합니다. 요청의 Host에 맞는 virtual host를 찾은 뒤 처음 일치하는 route를 따르면, 이 예제에서는 `outbound|8080||svc-b.default.svc.cluster.local` 클러스터에 도달합니다.

VirtualService를 바꾸면 route가 달라지고, DestinationRule을 바꾸면 클러스터 설정이 달라집니다. 리소스와 Envoy 설정의 대응은 [CRD 카탈로그]({{< relref "/platform/istio/configuration/15-crd-catalog/index.md" >}})와 [Envoy 조립]({{< relref "/platform/istio/fundamentals/13-istio-envoy-assembly/index.md" >}})에 있습니다.

이 클러스터는 EDS 타입입니다. istiod가 내려준 엔드포인트 목록에 `svc-b` 뒤의 파드 IP들이 들어 있고, 사이드카는 로드밸런싱 정책에 따라 그중 하나를 골라 직접 연결합니다. 앱이 ClusterIP를 목적지로 삼았어도 노드의 kube-proxy DNAT에 도착하기 전에 사이드카가 대상 파드 IP를 정합니다.

대상 파드를 고르는 주체가 커널의 conntrack에서 사이드카로 넘어옵니다. [01편]({{< relref "/study/istio-mesh/01-l4-l7-before-mesh/index.md" >}})에서 본 커넥션 단위 분산의 한계가 풀리기 시작하는 지점입니다.

```bash
istioctl proxy-config routes <pod-a> --name 8080 -o json
istioctl proxy-config endpoints <pod-a> --cluster "outbound|8080||svc-b.default.svc.cluster.local"
```

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 가상 리스너가 RDS로 route를 받고, 도메인 매칭 virtual host의 첫 route가 `outbound\|<port>\|\|<fqdn>` 클러스터를 가리킴 | bookinfo 9080 예시, Istio 1.31.4 | [Debugging Envoy and Istiod](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/) |
| 클러스터는 EDS로 istiod에서 엔드포인트를 받아 그중 하나로 프록시 | 같은 문서 | 위 문서 |
{{% /details %}}

## 앱의 연결 하나가 파드 하나에 매이지는 않는다 {#앱의-커넥션-하나가-파드-하나를-고정하지-않는다}

앱이 커넥션 하나로 HTTP 요청 백 개를 보내도, 사이드카는 요청마다 엔드포인트를 고릅니다. 앱의 커넥션과 사이드카 사이의 커넥션이 별개이기 때문입니다. 앱은 localhost의 사이드카와 keep-alive를 맺고, 사이드카는 엔드포인트마다 자기 커넥션 풀을 둡니다.

Envoy의 HTTP/1.1 풀은 커넥션 하나에 요청을 하나씩 보냅니다. 파이프라이닝은 없으며, 필요할 때 커넥션을 늘립니다. HTTP/2 풀에서는 커넥션 하나에 여러 요청이 다중화됩니다. 풀 자체가 워커 스레드마다 클러스터별로 따로 있으므로, HTTP/2를 써도 엔드포인트당 커넥션이 정확히 하나가 되지는 않습니다.

풀 크기와 대기열을 조정하는 설정은 DestinationRule의 `connectionPool`입니다. `maxRequestsPerConnection: 1`로 지정하면 keep-alive를 끕니다.

### HTTP/2 업그레이드, 따로 여는 문 {#http2-업그레이드는-별도-설정}

사이드카끼리 통신한다고 HTTP/1.1 요청이 자동으로 HTTP/2로 바뀌지는 않습니다. `DefaultMeshConfig`가 `h2UpgradePolicy`를 설정하지 않는다는 소스와 proto enum의 기본값을 함께 보면, 기본 정책은 `DO_NOT_UPGRADE`로 해석됩니다.

메시 전체의 업그레이드는 `meshConfig.h2UpgradePolicy: UPGRADE`로 켭니다. 대상별로 지정할 때는 DestinationRule을 사용합니다.

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: svc-b
spec:
  host: svc-b.default.svc.cluster.local
  trafficPolicy:
    connectionPool:
      http:
        h2UpgradePolicy: UPGRADE
```

업그레이드 판단에서는 `useClientProtocol: true`가 먼저입니다. 이 값이 있으면 업그레이드하지 않습니다. 그다음에는 DestinationRule의 값이 메시 설정보다 우선합니다.

메시 설정만으로 업그레이드를 켰다면 HTTP로 명시한 포트에만 적용됩니다. 자동 감지 포트는 제외됩니다. 이런 포트에서 사이드카는 `use_downstream_protocol`에 따라 들어온 프로토콜을 그대로 사용하므로, 앱이 HTTP/1.1로 보내면 사이드카 사이에서도 HTTP/1.1입니다. HTTP/1.1만 아는 앱에 h2 스트림이 전달되는 일을 막기 위한 장치입니다.

업그레이드 여부와 별개로 커넥션을 나누어 관리한다는 점이 요청 단위 로드밸런싱의 바탕입니다. 재시도나 서킷 브레이킹처럼 이 경로에서 동작하는 기능은 [04편]({{< relref "/study/istio-mesh/04-l7-only-features/index.md" >}})에서 다룹니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| MeshConfig `H2UpgradePolicy` enum `DO_NOT_UPGRADE = 0`, `UPGRADE = 1`, "sidecar is installed on all pods… should be set to UPGRADE" 주석 | istio/api release-1.31 | [config.proto](https://github.com/istio/api/blob/release-1.31/mesh/v1alpha1/config.proto) |
| `DefaultMeshConfig`가 h2UpgradePolicy를 설정하지 않음 → enum 0 = DO_NOT_UPGRADE | release-1.31 소스(추론: proto 기본값) | [mesh.go](https://github.com/istio/istio/blob/release-1.31/pkg/config/mesh/mesh.go) |
| `useClientProtocol` → DR override → HTTP 명시 포트만 → 메시 설정 순 | release-1.31 `shouldH2Upgrade` | [cluster_traffic_policy.go](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/core/cluster_traffic_policy.go) |
| 자동 감지 포트에서 사이드카·waypoint는 `use_downstream_protocol` | release-1.31 소스 | [cluster_builder.go](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/core/cluster_builder.go) |
| DR `h2UpgradePolicy` DEFAULT/DO_NOT_UPGRADE/UPGRADE, `maxRequestsPerConnection: 1`은 keep-alive 끔, HTTP idleTimeout 기본 1시간 | Istio 1.31.4 | [DestinationRule](https://istio.io/latest/docs/reference/config/networking/destination-rule/) |
| HTTP/1.1 풀은 필요할 때 커넥션 획득·파이프라이닝 없음, HTTP/2 풀은 한 커넥션 다중화, 워커 스레드마다 클러스터별 풀 | Envoy v1.39.6 | [Connection pooling](https://www.envoyproxy.io/docs/envoy/v1.39.6/intro/arch_overview/upstream/connection_pooling) |
| 업그레이드된 요청을 목적지 사이드카가 앱에는 선언된 프로토콜(HTTP/1.1)로 넘김 | 소스 구조에서 추론, 문서 문장 없음 | — |
{{% /details %}}

## mTLS에서 주고받는 신분증과 대화의 언어 {#mtls-연결에서-주고받는-신원과-프로토콜}

보내는 사이드카는 EDS 엔드포인트의 `tlsMode: istio` 메타데이터를 보고 mTLS 여부를 정합니다. 이 값이 있으면 사이드카가 있는 파드로 보고 mTLS로, 없으면 평문으로 보냅니다. 이 동작이 auto mTLS이며, `enableAutoMtls`는 기본적으로 켜져 있습니다.

클러스터 하나에는 transport socket이 두 벌 들어 있습니다. 엔드포인트마다 알맞은 것을 골라 쓰므로, 사이드카를 단계적으로 붙이는 중에도 호출이 끊기지 않습니다.

mTLS를 쓰는 대상이라면 사이드카 A가 고른 파드 IP에 TCP 커넥션을 연 뒤 TLS를 시작합니다. 양쪽이 인증서를 내며, 검증에 쓰는 신원은 IP나 파드 이름 대신 인증서에 담긴 SPIFFE ID입니다.

```
spiffe://cluster.local/ns/<namespace>/sa/<service-account>
```

A는 B의 인증서에서 SPIFFE ID를 읽고 해당 서비스 어카운트가 `svc-b`를 실행해도 되는지 확인합니다. Istio 문서에서 부르는 이름은 secure naming check입니다. 이어서 A도 인증서를 내면 B는 그 신원과 PeerAuthentication 정책으로 커넥션을 받을지 정합니다. 이 커넥션 위의 요청에 AuthorizationPolicy를 적용할 때 principal로 쓰는 값도 SPIFFE ID입니다.

{{< seq src="_seq/4-mtls-핸드셰이크와-신원.json" />}}

TLS 핸드셰이크에서는 앞서 판별한 HTTP 프로토콜도 전달합니다. 보내는 사이드카의 ALPN 목록에는 HTTP/1.1이면 `istio-http/1.1`, HTTP/2면 `istio-h2` 같은 값이 들어갑니다. 받는 사이드카의 `:15006`은 TLS 안을 다시 들여다보지 않고 이 ALPN으로 HTTP 필터 체인과 TCP 필터 체인을 선택합니다.

인증서를 준비하는 쪽은 파드 안의 istio-agent입니다. 개인키와 CSR을 만들어 istiod에서 서명을 받은 뒤, SDS로 Envoy에 인증서를 건넵니다. 기본 수명은 24시간이고, 절반쯤 지나면 다시 받습니다. Envoy가 istiod의 CA와 직접 통신하지 않는다는 점은 [요청 경로 해부]({{< relref "/platform/istio/fundamentals/11-request-path-anatomy/index.md" >}}) 1절에서 다룹니다.

### 자동 암호화는 평문 앞의 문을 잠그지 않는다 {#자동으로-암호화해도-평문이-차단되지는-않는다}

auto mTLS는 보내는 쪽의 선택입니다. 받는 쪽이 어떤 커넥션을 허용할지는 PeerAuthentication으로 정합니다.

| 모드 | 받는 쪽 동작 |
|---|---|
| `STRICT` | mTLS만 받음(클라이언트 인증서 필수) |
| `PERMISSIVE` | mTLS와 평문 모두 받음 |
| `DISABLE` | mTLS를 쓰지 않음(ambient 미지원) |
| `UNSET` | 상위 범위 상속, 상위가 없으면 PERMISSIVE |

정책이 하나도 없는 메시는 `PERMISSIVE`로 동작합니다. 사이드카끼리는 auto mTLS로 암호화해 통신하면서도, 사이드카 없는 클라이언트의 평문 커넥션을 받아 줍니다. 평문까지 거부하려면 받는 쪽에 `STRICT`를 적용합니다.

```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: istio-system   # root namespace = 메시 전체
spec:
  mtls:
    mode: STRICT
```

포트마다 모드를 나누는 `portLevelMtls`에는 Service 포트 번호 대신 워크로드(컨테이너) 포트 번호를 씁니다. 앱에서는 `X-Forwarded-Client-Cert` 헤더로 요청이 mTLS로 왔는지 확인할 수 있습니다. 헤더의 `URI=` 값은 보낸 쪽의 SPIFFE ID입니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 엔드포인트 라벨 `tlsMode: istio`에 따라 `tlsMode-istio`/`tlsMode-disabled` transport socket을 고름 | istio/istio release-1.31 소스 | [cluster_tls.go](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/core/cluster_tls.go) |
| 클라이언트 Envoy가 mTLS 시작, secure naming check, 서버 Envoy가 요청 인가 | Istio 1.31.4 | [Security concepts](https://istio.io/latest/docs/concepts/security/) |
| 아웃바운드 HTTP Inspector가 판별한 `http/1.1`·`h2c`로 체인을 매칭하고, 이 판단을 업스트림에 ALPN으로 넘김 | release-1.31 소스 주석 | [listener.go](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/core/listener.go) |
| 클라이언트 ALPN override 값 `istio-http/1.0`·`istio-http/1.1`·`istio-h2`(+`istio`, 표준값), 인바운드는 이 셋으로 HTTP 체인 선택 | release-1.31 소스 | [filters.go](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/xds/filters/filters.go), listener.go |
| agent가 키·CSR 생성 → istiod 서명 → SDS로 Envoy에 전달, 만료 감시 후 반복 | 같은 문서 | 위 문서 |
| `SECRET_TTL` 기본 24h, `SECRET_GRACE_PERIOD_RATIO` 기본 0.5 | pilot-agent 환경 변수 | [pilot-agent](https://istio.io/latest/docs/reference/commands/pilot-agent/) |
| trust domain 기본 `cluster.local`, `enableAutoMtls` 기본 true | release-1.31 `DefaultMeshConfig` | [mesh.go](https://github.com/istio/istio/blob/release-1.31/pkg/config/mesh/mesh.go) |
| 프록시 있는 워크로드엔 클라이언트 프록시가 자동 mTLS, 없으면 평문. mTLS면 XFCC 헤더(`URI=spiffe://…`) | Istio 1.31.4 | [Authentication Policy](https://istio.io/latest/docs/tasks/security/authentication/authn-policy/) |
| PeerAuthentication 모드 정의, UNSET 상속, `portLevelMtls`는 selector 필요·워크로드 포트 기준, root namespace = 메시 범위 | Istio 1.31.4 | [PeerAuthentication](https://istio.io/latest/docs/reference/config/security/peer_authentication/) |
| port-level 정책이 우회돼 mTLS 필수 포트에 평문이 닿던 문제 수정(GHSA-rr2c-p22p-6r9r) | 1.31.4에서 수정, 2026-11-06 | [1.31.4 공지](https://istio.io/latest/news/releases/1.31.x/announcing-1.31.4/) |
{{% /details %}}

## 메트릭에 남길 상대의 명함을 따로 주고받다 {#메트릭에-남길-상대-정보는-따로-교환한다}

mTLS로 신원을 확인해도, 그 정보만으로 메트릭에 보낸 쪽의 워크로드, 버전, 앱을 적기는 어렵습니다. 두 사이드카는 자기 노드 메타데이터를 서로 건네 이 정보를 채웁니다.

HTTP에서는 요청과 응답의 `x-envoy-peer-metadata-id`·`x-envoy-peer-metadata` 헤더에 메타데이터를 싣습니다. 앞의 mTLS 시퀀스에서 4·7번이 그 자리입니다. 1.31의 같은 필터에는 헤더가 오지 않았을 때 istiod가 내려준 워크로드 정보에서 상대를 찾는 `workload_discovery` 경로도 있습니다.

TCP에는 HTTP 헤더가 없습니다. 대신 Istio 프록시끼리만 성립하는 ALPN `istio-peer-exchange`를 협상합니다. 그러면 양쪽이 커넥션 첫머리에 매직 바이트와 길이가 붙은 protobuf 메타데이터를 서로 씁니다.

이렇게 얻은 값은 `istio_requests_total`의 `source_*`/`destination_*` 라벨로 남습니다. 이 라벨을 어떻게 사용하는지는 [05편]({{< relref "/study/istio-mesh/05-logs-and-tracing/index.md" >}})에서 이어집니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| ALPN `istio-peer-exchange`는 Istio 프록시 사이에서만 협상, 매직 바이트 + length-prefixed protobuf를 양쪽이 동시에 | Istio 1.31.4 | [TCP metrics](https://istio.io/latest/docs/tasks/observability/metrics/tcp-metrics/) |
| in-mesh 클러스터 ALPN `istio-peer-exchange, istio`, `PILOT_DISABLE_MX_ALPN`으로 끔 | release-1.31 소스 | [util.go](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/util/util.go), cluster_tls.go |
| HTTP 헤더 `x-envoy-peer-metadata-id`·`x-envoy-peer-metadata` | istio/proxy release-1.31 e2e 테스트 | [exchange_test.go](https://github.com/istio/proxy/blob/release-1.31/test/envoye2e/http_metadata_exchange/exchange_test.go) |
| HTTP MX 필터 `istio.metadata_exchange`(타입 `io.istio.http.peer_metadata.Config`), discovery `istio_headers`·`workload_discovery` | release-1.31 소스 | [filters.go](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/xds/filters/filters.go) |
{{% /details %}}

## ambient의 앱 연결은 HBONE을 입고 간다 {#ambient에서는-앱-커넥션을-hbone으로-보낸다}

ambient 모드에는 파드마다 붙는 Envoy가 없습니다. 파드에서 나가는 모든 TCP는 노드의 ztunnel `:15001`로 리다이렉트됩니다. 목적지가 메시 안에 있으면 ztunnel이 HBONE으로 감싸 상대 쪽 `:15008`로 보냅니다.

HBONE은 HTTP/2 위의 `CONNECT`로 터널을 열고 그 커넥션을 mTLS로 보호하는 방식입니다. 같은 목적지 신원으로 가는 앱 커넥션들은 공유 HTTP/2 커넥션 하나의 스트림으로 다중화됩니다. 사이드카의 커넥션 풀이 하던 공유를 ztunnel에서는 소스·목적지 신원 쌍 단위로 처리합니다.

받는 쪽에서는 목적지 포트가 15008이면 HBONE 리스너가, 그 밖의 포트면 평문 리스너 `:15006`이 받습니다. ztunnel이 다루는 범위는 L4까지입니다. mTLS, L4 인가, TCP 메트릭을 제공하지만 HTTP 판별과 라우트는 없습니다.

L7 기능을 쓰려면 waypoint를 둡니다. 이때 소스 ztunnel은 HBONE으로 waypoint에 전달하고, waypoint는 두 번째 HBONE 터널로 목적지 노드의 ztunnel에 보냅니다. 정책을 집행하는 곳은 목적지 쪽 waypoint입니다.

| 구간 | 사이드카 모드 | ambient(waypoint 없음) |
|---|---|---|
| 가로채는 곳 | 파드 안 Envoy `:15001` | 노드 ztunnel `:15001` |
| 프록시 사이 전송 | 파드 IP:서비스 포트로 mTLS | 상대 `:15008`로 HBONE(HTTP/2 CONNECT + mTLS) |
| 커넥션 공유 | Envoy 풀(HTTP/2 업그레이드 시 다중화) | 신원 쌍마다 HTTP/2 터널에 다중화 |
| HTTP 판별·라우트 | 있음 | 없음(waypoint 필요) |
| 받는 쪽 | `:15006` | 목적지 포트 15008이면 HBONE, 아니면 `:15006` |

Istio 1.31.4 문서 기준으로 사이드카는 HBONE의 목적지가 될 수 있지만, 사이드카나 게이트웨이에서 출발한 트래픽은 waypoint를 거치지 않습니다. 따라서 waypoint에만 둔 L7 정책은 사이드카 클라이언트에게 적용되지 않습니다.

HBONE을 Envoy 설정으로 조립하는 방식은 [ambient/02]({{< relref "/platform/istio/ambient/02-envoy-config-anatomy/index.md" >}})에, ambient를 고르는 이유는 [ambient/01]({{< relref "/platform/istio/ambient/01-why-ambient-mode/index.md" >}})에 있습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 파드를 나가는 모든 TCP는 ztunnel 15001로, 인바운드는 destination port == 15008이면 HBONE, 아니면 15006 | Istio 1.31.4 | [Ambient traffic redirection](https://istio.io/latest/docs/ambient/architecture/traffic-redirection/) |
| HBONE은 HTTP CONNECT 터널 + mTLS, 같은 목적지 신원 커넥션을 공유 HTTP/2 커넥션에 다중화, 리스너 15008 | Istio 1.31.4 | [HBONE](https://istio.io/latest/docs/ambient/architecture/hbone/) |
| waypoint가 있으면 ztunnel → waypoint → 두 번째 HBONE으로 목적지 ztunnel. ztunnel은 mTLS·L4 인가·TCP 메트릭 | Istio 1.31.4 | [Ambient data plane](https://istio.io/latest/docs/ambient/architecture/data-plane/) |
| 사이드카는 HBONE 목적지 가능, 사이드카·게이트웨이발 트래픽은 waypoint를 거치지 않음 | Istio 1.31.4 문서, 향후 릴리스에서 바뀔 수 있다고 명시 | 위 문서 |
| 정책은 목적지 waypoint가 집행 | Istio 1.31.4 | [Waypoint](https://istio.io/latest/docs/ambient/usage/waypoint/) |
{{% /details %}}

## 다음 편, HTTP를 읽으면 열리는 문 {#다음-편에서는-http를-읽어-가능한-기능을-다룬다}

양쪽 사이드카가 요청을 HTTP로 읽으면 재시도, 타임아웃, 가중치 분할, 요청 수준 인가가 가능해집니다. 이 기능들이 L4만 있을 때와 무엇이 다른지는 [04편]({{< relref "/study/istio-mesh/04-l7-only-features/index.md" >}})에서 이어갑니다.
