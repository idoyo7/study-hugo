---
title: "02 요청마다 달라지는 길 — 사이드카 통신과 L7 제어"
description: "15001에서 시작한 내부 호출이 대상 파드에 닿는 경로를 따라간다. 프로토콜 판별과 mTLS 신원에서 요청 분산·재시도·인가·response flag, ambient의 HBONE과 waypoint까지 연결한다."
date: 2026-11-07
lastmod: 2026-11-09
inlineToc: false
weight: 2
url: "/study/istio-mesh/02-between-proxies/"
aliases:
  - "/study/istio-mesh/03-proxy-to-proxy/"
  - "/istio/mesh-traffic/03-proxy-to-proxy/"
  - "/study/istio-mesh/04-l7-only-features/"
  - "/istio/mesh-traffic/04-l7-only-features/"
---

# 02 · 요청마다 달라지는 길 — 사이드카 통신과 L7 제어

앱 A가 `http://svc-b:8080`을 호출할 때, 대상 파드는 누가 고릅니까? 사이드카가 이 호출을 HTTP로 인식했다면 보내는 쪽 Envoy가 고릅니다. 앱이 연결 하나를 열어도 그 안의 요청마다 대상을 선택합니다.

아래 경로에서 먼저 구분할 것은 앱이 연결한 목적지와 사이드카가 실제로 연결하는 대상입니다.

{{< flow src="_flow/1-커넥션-하나가-지나는-리스너.json" />}}

## ClusterIP 호출이 먼저 닿는 15001 리스너 {#clusterip로-연-커넥션이-먼저-닿는-곳}

앱이 지정한 목적지는 ClusterIP입니다. 그러나 연결은 파드의 리다이렉트 규칙을 따라 먼저 Envoy `:15001`에 닿습니다. Envoy는 `SO_ORIGINAL_DST`로 원래 목적지를 읽고, 그 목적지에 맞는 논리 리스너로 처리를 넘깁니다. 그림의 8080 리스너는 같은 Envoy 안의 설정이며 별도의 네트워크 홉은 아닙니다.

리다이렉트 규칙을 넣는 주체는 [1편의 15006 절]({{< relref "/study/istio-mesh/01-to-the-gateway/index.md#목적지는-8080-먼저-받는-곳은-15006" >}})에서 다뤘습니다. 여기서 `:15001`은 `virtualOutbound`입니다. 목적지 포트가 8080이면 `0.0.0.0_8080`으로 넘기고, 맞는 리스너가 없으면 `PassthroughCluster`가 원래 목적지로 연결합니다. `outboundTrafficPolicy`의 기본값은 `ALLOW_ANY`이므로 메시가 모르는 외부 주소로도 호출이 나갑니다.

<span id="host에서-대상-파드-ip까지"></span>

HTTP로 처리하는 8080 리스너는 RDS 라우트 `8080`을 사용합니다. Host에 맞는 virtual host를 찾고 그 안의 첫 route를 따라가면 `outbound|8080||svc-b.default.svc.cluster.local` 클러스터에 닿습니다. 서비스 클러스터를 정한 뒤에는 istiod가 EDS로 알려 준 파드 목록에서 대상을 고릅니다.

이제 연결의 목적지는 대상 파드 IP입니다. Envoy가 노드의 kube-proxy에서 DNAT를 거치기 전에 그 IP로 직접 연결하므로, [1편]({{< relref "/study/istio-mesh/01-to-the-gateway/index.md" >}})에서 커널이 하던 대상 선택을 여기서는 사이드카가 맡습니다. 받는 사이드카가 mTLS를 끝내고 앱으로 넘기는 구간은 앞서 연결한 1편의 15006 절에서 이어집니다.

자기 클러스터에서도 리스너, 라우트, 엔드포인트 순으로 설정을 따라가면 같은 경로를 확인할 수 있습니다.

```bash
istioctl proxy-config listeners <pod-a> --port 15001 -o json
istioctl proxy-config listeners <pod-a> --address 0.0.0.0 --port 8080 -o json
istioctl proxy-config routes <pod-a> --name 8080 -o json
istioctl proxy-config endpoints <pod-a> --cluster "outbound|8080||svc-b.default.svc.cluster.local"
```

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| CNI가 없으면 `istio-init`이 `NET_ADMIN`·`NET_RAW`로 iptables 리다이렉트를 구성 | Istio 1.31.4 | [Application Requirements](https://istio.io/latest/docs/ops/deployment/application-requirements/) |
| `original_dst` 필터는 iptables REDIRECT가 남긴 `SO_ORIGINAL_DST`를 읽음 | Envoy v1.39.6 | [original_dst filter](https://www.envoyproxy.io/docs/envoy/v1.39.6/configuration/listeners/listener_filters/original_dst_filter) |
| `virtualOutbound`가 가장 맞는 가상 리스너로 넘기고 없으면 PassthroughCluster. 8080 리스너는 RDS로 route를 받아 EDS 클러스터로 이어짐 | Istio 1.31.4 | [Debugging Envoy and Istiod](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/) |
| `outboundTrafficPolicy` 기본 `ALLOW_ANY` | MeshConfig | [MeshConfig](https://istio.io/latest/docs/reference/config/istio.mesh.v1alpha1/) |
{{% /details %}}

## HTTP 처리를 결정하는 포트 선언 {#http인지는-포트-선언이-먼저-정한다}

앞의 경로에서 HTTP 라우트를 따라가려면 사이드카가 연결을 HTTP로 인식해야 합니다. 같은 Envoy를 지나더라도 TCP로 처리하면 HTTP 라우트와 재시도는 생기지 않습니다.

{{< flow src="_flow/2-프로토콜-선언과-감지.json" />}}

판별의 출발점은 Service 포트입니다. `appProtocol: http`를 지정했다면 `name: http-web`보다 우선하고, 둘 다 없으면 HTTP·HTTP/2를 자동 감지합니다. 감지에 실패한 연결은 평문 TCP로 취급합니다. 이때는 HTTP 라우트·재시도·메트릭 없이 바이트만 중계합니다.

자동 감지가 모든 프로토콜에 맞지는 않습니다. MySQL처럼 서버가 먼저 말하는 프로토콜이 그렇습니다. Istio는 25, 53, 3306, 27017을 TCP로 간주하며, 이런 프로토콜을 다른 포트에서 쓰면 `tcp`로 명시합니다. 앱이 직접 암호화한 HTTPS도 경로와 헤더를 읽을 수 없는 경우입니다. 사이드카가 그 암호화를 풀지 않기 때문입니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| `appProtocol`이 포트 이름보다 우선, 자동 감지는 HTTP·HTTP/2이고 실패하면 plain TCP | Istio 1.31.4 | [Protocol Selection](https://istio.io/latest/docs/ops/configuration/traffic-management/protocol-selection/) |
| server-first는 자동 감지와 비호환, 25·53·3306·27017은 TCP로 간주 | Istio 1.31.4 | [Application Requirements](https://istio.io/latest/docs/ops/deployment/application-requirements/) |
{{% /details %}}

### 따로 켜는 HTTP/2 업그레이드

<span id="http2-업그레이드는-별도-설정"></span>

HTTP로 알아보는 것과 HTTP/2로 바꾸는 것은 별개입니다. 사이드카끼리 통신해도 HTTP/1.1이 자동으로 HTTP/2가 되지는 않습니다. 기본 설정은 `DO_NOT_UPGRADE`로 해석합니다.

업그레이드는 메시 전체에 `meshConfig.h2UpgradePolicy: UPGRADE`를 지정하거나, 대상별 DestinationRule의 `trafficPolicy.connectionPool.http.h2UpgradePolicy`로 켭니다. 적용 우선순위는 `useClientProtocol: true`, DestinationRule, 메시 설정 순입니다.

메시 설정만으로 업그레이드를 켰다면 HTTP로 명시한 포트에만 적용됩니다. 자동 감지 포트는 들어온 프로토콜을 그대로 사용합니다. 따라서 앱이 HTTP/1.1로 보내면 사이드카 사이에서도 HTTP/1.1이 유지됩니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| `DefaultMeshConfig`가 h2UpgradePolicy를 설정하지 않아 기본은 `DO_NOT_UPGRADE`(proto 기본값에서 해석) | release-1.31 소스 | [mesh.go](https://github.com/istio/istio/blob/release-1.31/pkg/config/mesh/mesh.go) |
| `useClientProtocol` → DR → HTTP 명시 포트만 → 메시 설정 순 | release-1.31 `shouldH2Upgrade` | [cluster_traffic_policy.go](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/core/cluster_traffic_policy.go) |
| 자동 감지 포트는 `use_downstream_protocol` | release-1.31 소스 | [cluster_builder.go](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/core/cluster_builder.go) |
{{% /details %}}

## HTTP 요청마다 고르는 대상 파드 {#연결-하나에-묶였던-요청을-다시-나누기}
<span id="다음-편에서는-http를-읽어-가능한-기능을-다룬다"></span>

<span id="앱의-커넥션-하나가-파드-하나를-고정하지-않는다"></span>

앱이 연 연결과 프록시가 대상별로 관리하는 연결 풀은 별개입니다. 앞쪽 HTTP/2 연결이 하나여도 뒤에서는 요청마다 EDS 엔드포인트를 고릅니다.

{{< flow src="_flow/2-연결-하나-요청-여럿.json" />}}

요청의 경계는 HTTP connection manager가 찾습니다. 연결로 들어온 바이트를 요청과 응답으로 구분하면, router 필터가 요청마다 route와 cluster를 정하고 그 cluster의 로드밸런서가 엔드포인트를 고릅니다. 재시도, 트래픽 분할, 경로별 인가가 작동하는 단위도 이 요청입니다.

대상으로 보낼 연결은 해당 대상의 풀에서 재사용합니다. `maxRequestsPerConnection: 1`을 지정하면 keep-alive를 끕니다.

TCP로만 처리하는 연결에는 이런 요청 경계가 없습니다. Envoy의 TCP proxy 필터는 연결마다 업스트림 클러스터를 고르고, 연결이 맺어진 뒤에는 바이트를 해석하지 않고 넘깁니다. 처음 고른 대상에 연결이 묶이는 까닭입니다. 자신이 보는 트래픽이 어느 쪽에 해당하는지는 [포트 선언 절](#http인지는-포트-선언이-먼저-정한다)의 조건으로 확인합니다.

HTTP 경로에서는 앞서 본 EDS 파드 IP로 직접 연결하므로 kube-proxy의 연결 단위 선택이 끼어들지 않습니다. 기본 least request도 연결 수를 세어 고르는 정책은 아닙니다. 활성 요청 수를 비교합니다.

실제로 사이드카가 받은 LB 정책과 엔드포인트를 나란히 확인해 보겠습니다.

```bash
istioctl proxy-config cluster deploy/frontend --fqdn orders.shop.svc.cluster.local -o json | grep -i lbPolicy
istioctl proxy-config endpoints deploy/frontend --cluster "outbound|8080||orders.shop.svc.cluster.local"
```

기본 설치에서는 `"lbPolicy": "LEAST_REQUEST"`가 보입니다. 이 줄이 없다면 round robin이 적용된 상태이므로 DestinationRule을 확인합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| TCP proxy는 연결 단위로 클러스터를 고른다 | "per-connection basis" | Envoy 1.39 `tcp_proxy_filter.rst` |
| 로드밸런서는 요청이 올 때 엔드포인트를 고른다 | "picks an endpoint when a new request arrives" | Envoy 1.39 Life of a Request |
| Istio 기본 LB는 least request | "two randomly selected hosts" 중 활성 요청이 적은 쪽 | Istio Traffic Management 개념 |
| 가중치가 같을 때 P2C, 다르면 동적 WRR | 무작위 후보 기본 2개 | Envoy 1.39 load balancers |
| DR 레퍼런스는 기본값을 직접 명시하지 않음 | 소스의 `defaultLBAlgorithm()`은 `LEAST_REQUEST` | Istio DestinationRule 레퍼런스, 1.31.4 `cluster_traffic_policy.go` |
| HTTP/2 풀은 멀티플렉싱, HTTP/1.1 풀은 연결을 더 연다 | 제한이 없으면 HTTP/2는 연결 1개 | Envoy 1.39 Connection pooling |
| `lbPolicy` 생략 = ROUND_ROBIN | Envoy cluster proto 기본값 | Envoy 1.39 API |
| `maxRequestsPerConnection: 1`은 keep-alive 끔 | Istio 1.31.4 | [DestinationRule](https://istio.io/latest/docs/reference/config/networking/destination-rule/) |
{{% /details %}}

### 규칙 순서와 가중치를 담은 VirtualService {#어떤-요청을-어느-버전으로-보낼-것인가}

요청을 읽을 수 있으면 헤더에 따라 보낼 버전도 달리 정합니다. VirtualService의 HTTP 규칙은 위에서부터 평가하고 처음 맞는 규칙을 적용하므로, 특정 헤더를 우선할 때는 그 규칙을 먼저 둡니다.

{{< flow src="_flow/2-헤더-우선-카나리-분할.json" />}}

`x-canary: true` 요청을 v2로 고정하려면 그 요청이 나머지 트래픽의 가중치 분할에 들어가기 전에 규칙과 맞아야 합니다. 나머지에 적용하는 v1:v2의 90:10은 장기적인 선택 비율입니다. 요청 열 개마다 하나가 반드시 v2로 간다는 보장은 없습니다. 여기서 subset이 어떤 파드 라벨을 뜻하는지는 DestinationRule에 지정합니다.

TCP route에도 가중치를 줄 수 있지만 적용 단위는 연결 수입니다. 오래 열린 연결 몇 개가 요청을 계속 보내면, 요청 비율은 설정한 가중치에서 크게 벗어날 수 있습니다.

미러링은 요청을 나누어 보내는 대신 복사본을 별도로 보냅니다. 복사본의 응답은 버리며 기다리지도 않습니다. 원래 요청이 그 응답을 기다리지 않는다고 해서 비용까지 없어지는 것은 아닙니다. 복제 트래픽과 대상의 처리 비용은 늘어납니다.

복사할 비율은 같은 규칙 안에 지정합니다.

```yaml
    mirror: {host: orders, subset: v3}
    mirrorPercentage: {value: 5}
```

비율을 생략하면 전체 요청을 복사합니다. 이 역시 요청 하나의 경계를 읽어야 하는 동작이므로 L4 프록시에서는 할 수 없습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| TCP route에도 weight | `RouteDestination` = "L4 routing rule weighted destination" | Istio VS 레퍼런스 |
| TCP 가중치는 연결 단위 | Envoy `weighted_clusters`를 연결마다 선택. 요청 비율과 벌어지는 정도는 구조에서 도출한 설명 | Envoy 1.39 TCP proxy |
| HTTP 매칭 필드 | headers, uri, method, queryParams, sourceLabels | Istio VS 레퍼런스 |
| 미러는 응답을 기다리지 않음, 비율 생략 시 100% | "fire and forget… responses are discarded" | Istio VS 레퍼런스, Mirroring 태스크 |
{{% /details %}}

## 백엔드를 보호하는 DestinationRule {#연결-수로-보이지-않는-부하와-오류}

대상별 연결 풀을 관리할 때 연결 수만으로는 HTTP 부하를 알기 어렵습니다. HTTP/2 연결 하나에도 요청 수백 개가 들어가기 때문입니다. TCP 연결이 정상이라는 사실만으로 앱이 정상이라고 판단할 수도 없습니다. 연결은 살아 있어도 앱은 계속 500을 보낼 수 있습니다.

DestinationRule의 `connectionPool`과 `outlierDetection`은 각각 이 부하와 오류를 다룹니다.

| 설정 | 조절하는 대상 | 한도·조건을 넘으면 |
|---|---|---|
| `connectionPool` | 연결 수·대기 요청·활성 요청 | 새 요청을 제한, overflow는 로그의 `UO`로 확인 |
| `outlierDetection` | 실제 오류를 내는 엔드포인트 | 해당 파드를 후보에서 일시 제외 |

연결 한도만 두면 한 연결 안에 쌓이는 HTTP 요청 부하를 구분하지 못합니다. 요청 수에도 한도를 두는 까닭입니다. 오류를 내는 파드를 고르는 데는 응답을 읽는 범위가 영향을 줍니다. HTTP 오류를 기준으로 제외하려면 HTTP 응답을 읽어야 하며, TCP outlier detection은 연결 실패·타임아웃을 봅니다.

outlier detection은 실제 트래픽의 응답을 보고 엔드포인트를 잠시 후보에서 뺍니다. HTTP에서는 `outlierDetectionHttpErrorCodes`를 따로 지정하지 않으면 5xx 응답을 오류로 셉니다. 기본값은 연속 5번의 오류를 기준으로 10초마다 점검하고, 최소 30초 동안 축출하는 설정입니다. 제외하는 범위는 풀의 10%까지입니다.

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: orders
spec:
  host: orders
  trafficPolicy:
    connectionPool:
      http: {http2MaxRequests: 500, http1MaxPendingRequests: 100}
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 10s
      baseEjectionTime: 30s
```

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| `tcp`는 HTTP·TCP 공통, `http`는 HTTP 전용 | "Settings common to both HTTP and TCP upstream connections" | Istio DR 레퍼런스 |
| outlier 기본값 | consecutive5xxErrors 5, interval 10s, baseEjectionTime 30s, maxEjectionPercent 10% | Istio DR 레퍼런스 |
| HTTP는 5xx만 오류로 셈 | `outlierDetectionHttpErrorCodes` 미지정 시 | Istio DR 레퍼런스 |
| TCP는 연결 실패만 셈 | Envoy tcp proxy는 locally originated 오류만 보고 | Istio DR 레퍼런스, Envoy 1.39 Outlier detection |
| 풀 초과는 `UO` | response flag `UPSTREAM_OVERFLOW` | Envoy 1.39 `stream_info/utility.h` |
{{% /details %}}

## mTLS 연결에서 확인하는 워크로드 신원 {#mtls-연결에서-주고받는-신원과-프로토콜}

대상 파드를 골랐다면 그쪽 사이드카와 연결할 차례입니다. 별도 TLS 설정이 없을 때 보내는 Envoy는 EDS 엔드포인트의 `tlsMode: istio` 메타데이터를 보고 mTLS를 선택합니다. 이 메타데이터가 없으면 평문으로 보냅니다. auto mTLS가 이렇게 대상을 구분하므로 사이드카를 단계적으로 붙이는 중에도 호출이 끊기지 않습니다.

mTLS 핸드셰이크에서 양쪽 Envoy는 인증서를 제시하고 상대의 워크로드 신원을 확인합니다.

{{< seq src="_seq/4-mtls-핸드셰이크와-신원.json" />}}

신원은 파드가 교체되어도 유지됩니다. 기본 trust domain에서는 `spiffe://cluster.local/ns/<namespace>/sa/<service-account>` 형태이며, 같은 서비스 어카운트를 쓰는 파드는 같은 신원으로 통신합니다. 인증서는 istio-agent가 istiod에서 발급받아 Envoy에 전달합니다. 기본 수명은 24시간입니다.

검증 기준은 IP나 파드 이름 대신 SPIFFE ID입니다. 보내는 쪽은 서버 인증서에 적힌 서비스 어카운트가 `svc-b`를 실행해도 되는지 확인하며, 이 검사를 secure naming check라고 부릅니다. AuthorizationPolicy의 principal 값도 이 SPIFFE ID입니다.

앞서 판별한 프로토콜도 핸드셰이크에 실립니다. ALPN의 `istio-http/1.1`, `istio-h2` 같은 값을 받은 `:15006`은 그 값에 맞춰 HTTP 체인이나 TCP 체인을 고릅니다.

### 평문 연결까지 거부하는 PeerAuthentication {#자동으로-암호화해도-평문이-차단되지는-않는다}

auto mTLS로 보내고 있어도 받는 쪽이 평문을 거부한다는 뜻은 아닙니다. 보내는 사이드카가 어떤 연결을 선택할지는 auto mTLS가 정하고, 받는 쪽이 무엇을 허용할지는 PeerAuthentication이 정합니다.

기본 `PERMISSIVE`는 mTLS와 평문을 모두 받습니다. 대상 범위에서 평문 연결을 거부하려면 `STRICT`를 적용합니다.

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

포트별로 설정할 때도 기준을 구분해야 합니다. `portLevelMtls`에는 Service 포트 대신 워크로드 포트 번호를 씁니다.

여기까지는 연결의 암호화와 허용 범위입니다. 그 연결로 들어온 특정 요청을 허용할지는 AuthorizationPolicy에서 따로 확인합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 엔드포인트 라벨 `tlsMode: istio`로 `tlsMode-istio`/`tlsMode-disabled` transport socket 선택 | release-1.31 소스 | [cluster_tls.go](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/core/cluster_tls.go) |
| 클라이언트 ALPN `istio-http/1.1`·`istio-h2`로 인바운드가 HTTP 체인 선택 | release-1.31 소스 | [listener.go](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/core/listener.go) |
| 인증서 발급·SDS 전달, `SECRET_TTL` 기본 24h | Istio 1.31.4 | [Security concepts](https://istio.io/latest/docs/concepts/security/), [pilot-agent](https://istio.io/latest/docs/reference/commands/pilot-agent/) |
| PeerAuthentication 모드·UNSET 상속·`portLevelMtls`는 워크로드 포트 기준 | Istio 1.31.4 | [PeerAuthentication](https://istio.io/latest/docs/reference/config/security/peer_authentication/) |
{{% /details %}}

## 메트릭에 남을 상대 메타데이터 {#메트릭에-남길-상대-정보는-따로-교환한다}

인증서에서 확인한 신원만으로 워크로드 이름이나 버전 라벨까지 알 수 있는 것은 아닙니다. 프록시는 메트릭에 남길 상대 정보를 별도로 얻습니다.

HTTP에서는 `x-envoy-peer-metadata-id`·`x-envoy-peer-metadata` 헤더로 상대를 식별합니다. 헤더가 없으면 istiod가 내려준 워크로드 정보에서 찾는 경로도 있습니다.

TCP mTLS 연결에서는 Istio 프록시끼리 성립하는 ALPN `istio-peer-exchange`를 협상합니다. 이어 커넥션 첫머리에서 protobuf 메타데이터를 교환합니다. 이렇게 얻은 값이 `istio_requests_total`의 `source_*`·`destination_*` 라벨로 남습니다.

이 메트릭을 로그·트레이스와 함께 읽는 과정은 [3편]({{< relref "/study/istio-mesh/03-traces-left-behind/index.md" >}})으로 이어집니다.

## 신원과 요청 조건을 함께 보는 AuthorizationPolicy {#호출자-신원에서-경로와-메서드까지}

같은 서비스 어카운트의 호출이어도 메서드와 경로에 따라 허용 여부를 다르게 정합니다. mTLS에서 확인한 신원에 HTTP 요청 조건을 더하는 인가입니다.

{{< flow src="_flow/5-신원과-요청-조건의-인가.json" />}}

그림은 해당 서비스 계정에 `GET /orders/*`만 ALLOW한 예입니다. 신원·IP·포트는 L4에서도 조건으로 쓰지만, 메서드·경로·헤더와 JWT 클레임에는 HTTP 해석이 필요합니다.

JWT 클레임을 조건으로 쓰려면 RequestAuthentication으로 토큰을 먼저 검증합니다. 이 설정만으로 토큰이 필수가 되지는 않습니다. RequestAuthentication은 토큰이 없는 요청을 통과시키므로, 토큰을 반드시 요구하는 인가 조건을 별도로 둡니다.

아래 정책은 워크로드 신원, 메서드와 경로, 검증된 JWT 클레임을 함께 조건으로 지정한 예입니다.

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: payments-allow
spec:
  selector:
    matchLabels: {app: payments}
  action: ALLOW
  rules:
  - from:
    - source:
        principals: ["cluster.local/ns/shop/sa/orders"]
    to:
    - operation:
        methods: ["POST"]
        paths: ["/charge"]
    when:
    - key: request.auth.claims[scope]
      values: ["payments:write"]
```

HTTP 속성이 든 DENY를 TCP에 적용하면 없는 속성을 일치로 취급해 해당 포트 전체가 막힐 수 있습니다. 이런 정책은 포트와 워크로드로 적용 범위를 좁혀야 합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| HTTP 전용 조건 | `request.headers`, `request.auth.principal/audiences/presenter/claims` | Istio Authorization conditions |
| HTTP·TCP 공통 조건 | `source.ip`, `source.namespace`, `source.principal`, `destination.ip/port`, `connection.sni` | Istio Authorization conditions |
| `hosts`·`methods`·`paths`는 HTTP 전용 | "Must be used only with HTTP" | Istio AuthorizationPolicy 레퍼런스 |
| TCP에서 DENY의 HTTP 속성은 일치로 취급 | 예시에서 8080 포트 TCP 전체 거부, 포트로 범위를 좁히라고 권고 | Istio AuthorizationPolicy 레퍼런스 |
| 평가 순서 | CUSTOM → DENY → ALLOW. ALLOW 정책이 있는데 맞는 것이 없으면 거부 | Istio AuthorizationPolicy 레퍼런스 |
{{% /details %}}

## ambient의 TCP 연결을 운반하는 HBONE {#ambient에서는-앱-커넥션을-hbone으로-보낸다}

ambient에서는 앱의 TCP 연결을 노드의 ztunnel이 받습니다. 파드에서 나가는 TCP는 모두 ztunnel `:15001`로 향하고, 메시 안의 목적지라면 상대의 `:15008`로 HBONE 터널을 엽니다. 이 터널을 mTLS로 보호합니다.

{{< seq src="_seq/6-hbone-터널과-앱-연결.json" />}}

HBONE이 HTTP/2 CONNECT를 쓴다고 해서 ztunnel이 터널 안의 앱 요청까지 HTTP로 읽는 것은 아닙니다. 같은 목적지 신원으로 가는 앱 연결을 공유 HTTP/2 커넥션의 스트림으로 나누어 운반합니다. 터널은 소스·목적지 신원 쌍마다 하나입니다.

받는 쪽에서는 목적지 포트가 리스너를 결정합니다. 15008로 온 연결은 HBONE 리스너가 받고, 그 밖의 포트로 온 연결은 평문 리스너 `:15006`이 받습니다. ztunnel의 처리는 L4까지입니다. HTTP 라우팅과 재시도는 [뒤쪽 waypoint 절](#ztunnel만-있는-경로에는-무엇이-남는가)의 경로가 필요합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 나가는 TCP는 ztunnel 15001, 인바운드는 destination port 15008이면 HBONE, 아니면 15006 | Istio 1.31.4 | [Ambient traffic redirection](https://istio.io/latest/docs/ambient/architecture/traffic-redirection/) |
| HBONE은 CONNECT 터널 + mTLS, 신원 쌍마다 공유 HTTP/2 커넥션 | Istio 1.31.4 | [HBONE](https://istio.io/latest/docs/ambient/architecture/hbone/) |
{{% /details %}}

## 목적지 쪽 L7 정책을 집행하는 waypoint {#ztunnel만-있는-경로에는-무엇이-남는가}

ztunnel만 지나는 경로에서도 mTLS, 워크로드 신원, L4 인가는 적용됩니다. 요청 단위 분산·재시도·HTTP 라우팅·L7 인가를 처리하는 곳은 waypoint입니다.

waypoint를 거치는 경로는 두 번째 HBONE 터널로 목적지 ztunnel에 이어집니다. 정책은 목적지 쪽 waypoint가 집행합니다. L7 인가 정책을 `targetRefs`로 서비스 등에 연결한 뒤에는 트래픽이 실제로 그 waypoint를 지나는지 확인합니다.

호출자가 어디에 있는지도 영향을 줍니다. 1.31.4 문서 기준으로 사이드카·게이트웨이에서 출발한 트래픽은 waypoint를 거치지 않습니다. waypoint에만 둔 L7 정책이 사이드카 클라이언트에게 적용되지 않는 까닭입니다. 자세한 배치는 [Ambient 데이터 경로]({{< relref "/platform/istio/ambient/02-envoy-config-anatomy/index.md" >}})에서 확인합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| waypoint 경유 시 두 번째 HBONE, 사이드카·게이트웨이발 트래픽은 waypoint 미경유(향후 릴리스에서 바뀔 수 있다고 명시) | Istio 1.31.4 | [Ambient data plane](https://istio.io/latest/docs/ambient/architecture/data-plane/) |
{{% /details %}}

### ztunnel에 적용하는 인가 정책

HTTP 조건을 담은 정책을 ztunnel에 붙이면 의도한 대로 집행되지 않으며 트래픽이 차단될 수 있습니다. ALLOW 정책에 맞는 규칙이 없으면 트래픽이 막힙니다. L7 속성만 든 DENY는 막을 규칙이 없어 그대로 통과시킵니다.

한 항목에 L4·L7 속성을 섞었다면 ztunnel은 L4 부분만 집행합니다. waypoint를 우회하는 경로의 접근까지 제한하려면 ztunnel의 L4 정책도 함께 설계합니다.

## 실패 뒤의 재시도와 전체 대기 한도 {#실패한-요청은-다시-보내고-대기-시간은-제한한다}

호출이 실패하면 보내는 사이드카는 재시도 조건을 확인합니다. 조건에 맞는 실패라면 다시 요청을 보내며, 이미 시도한 엔드포인트를 피하는 기본 정책 때문에 대개 다른 파드를 고릅니다.

{{< seq src="_seq/3-다른-파드로-재시도.json" />}}

Istio 1.31은 VirtualService에 별도 설정이 없어도 HTTP 요청을 최대 두 번 재시도합니다. 재시도 간격은 25ms에서 시작하는 지수 백오프입니다. 기본 정책의 `previous_hosts`가 이미 시도한 엔드포인트를 피하게 하지만, consistent hash LB에는 이 조건을 넣지 않습니다.

모든 실패 응답이 재시도 대상은 아닙니다. 기본 대상은 연결 실패·스트림 거부·일부 gRPC 상태이며, 앱이 반환한 모든 500·503을 자동으로 다시 보내는 정책은 아닙니다. 응답 코드를 기준으로 재시도하려면 `retryOn`에 직접 지정합니다. 이 기본 동작 설명은 소스와 Envoy 문서를 함께 읽은 해석이며, 실측 결과는 아닙니다.

재시도 횟수와 전체 대기 시간도 따로 봐야 합니다. 전체 요청의 타임아웃은 기본으로 꺼져 있으므로 제한이 필요한 경로에 명시합니다.

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: orders
spec:
  hosts: [orders]
  http:
  - route:
    - destination: {host: orders}
    timeout: 3s
    retries:
      attempts: 2
      perTryTimeout: 1s
      retryOn: connect-failure,refused-stream,503
```

`attempts: 2`는 최초 시도 뒤 최대 두 번을 더 보낸다는 뜻입니다. 각 시도는 최대 1초로 제한하고, 백오프까지 포함한 전체 대기는 3초를 넘기지 않습니다.

재시도가 늘면 같은 요청이 다시 실행될 가능성도 생깁니다. 결제처럼 중복 실행이 위험한 요청은 멱등성을 확보하거나 `attempts: 0`으로 재시도를 끕니다. 앱과 메시가 함께 재시도하면 호출 수가 곱해지므로 양쪽 정책을 맞춰야 합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 기본 2회 재시도, 25ms 이상 간격 | HTTP 요청 | Istio Traffic Management 개념, VS 레퍼런스(`backoff`) |
| 기본 정책 구성 | `retryOn: connect-failure,refused-stream,unavailable,cancelled,retriable-status-codes`, `previous_hosts`. consistent hash LB면 `previous_hosts` 없음 | Istio 1.31.4 `retry.go` |
| 기본만으로 503 응답을 재시도하지 않음 | `retriable-status-codes`가 켜져 있지만 코드 목록이 비어 있음. 해석이고 실측은 아님 | `retry.go`, Envoy 1.39 router filter |
| `retryOn`에 숫자를 쓰면 `retriable-status-codes` 자동 추가 | — | Istio 1.31.4 `retry.go` |
| 타임아웃 기본 비활성 | `perTryTimeout` 기본 = route `timeout` = 제한 없음 | Istio VS 레퍼런스 |
| TCP proxy는 연결 시도만 반복 | `max_connect_attempts` 미지정 시 1회 | Envoy 1.39 `tcp_proxy.proto` |
| retryBudget 기본값 | percent 20%, minRetryConcurrency 3 | Istio DR 레퍼런스 |
{{% /details %}}

### fault와 retry를 나누어 두는 홉

<span id="fault로-재시도를-시험할-때는-홉을-나눈다"></span>

fault injection으로 재시도를 시험하려면 fault와 retry를 서로 다른 홉에 둡니다. 같은 HTTP route에 fault를 켜면 그 route의 retry·timeout은 활성화되지 않습니다. 세부 필드와 동작은 [재시도와 복원력]({{< relref "/platform/istio/cilium/04-retry-resilience/index.md" >}})에서 확인합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| fault는 클라이언트 쪽 HTTP 트래픽에 적용 | "Fault injection policy to apply on HTTP traffic at the client side" | Istio VS 레퍼런스 |
| 필드 | `delay.fixedDelay`(≥1ms), `abort.httpStatus`/`grpcStatus`, 각 `percentage`(미지정 시 적용 안 함) | Istio VS 레퍼런스 |
| fault와 retry·timeout은 같이 안 됨 | "timeouts or retries will not be enabled when faults are enabled on the client side" | Istio VS 레퍼런스 |
{{% /details %}}

## 실패한 홉이 로그에 남기는 response flag {#실패한-홉이-남기는-response-flag}

같은 503이라도 어느 프록시가 만들었는지에 따라 확인할 구간이 달라집니다. 두 사이드카 사이의 실패를 구분할 때는 액세스 로그의 `%RESPONSE_FLAGS%`를 봅니다. 두세 글자짜리 flag는 그 줄을 쓴 프록시가 직접 실패를 만들었다는 표시입니다.

호출 쪽 사이드카가 대상에 연결하지 못했다면 호출 쪽 로그에 `UF`가 남습니다. 대상 쪽 사이드카가 자기 앱에 붙지 못해 503을 돌려줬다면 `UF`는 대상 쪽 로그에만 찍힙니다. 이때 호출 쪽은 받은 503을 평범한 업스트림 응답으로 기록합니다. 호출 쪽 flag는 `-`, `%RESPONSE_CODE_DETAILS%`는 `via_upstream`입니다.

응답 코드만 같다고 같은 구간의 실패는 아닙니다. flag가 붙은 쪽이 실패를 만든 구간입니다.

| flag | 뜻 | 주로 찍히는 쪽 | 대표 장면 |
|---|---|---|---|
| `UH` | 건강한 업스트림 호스트 없음, 503 | 호출 쪽 | 대상 서비스 엔드포인트가 0개이거나 전부 축출됨 |
| `UF` | 업스트림 연결 실패, 503 | 호출 쪽 | 연결 거부, mTLS 핸드셰이크 실패(사유는 `%UPSTREAM_TRANSPORT_FAILURE_REASON%`) |
| `UF` | 위와 같음 | 대상 쪽 | 대상 앱이 포트를 아직 열지 않음(추정) |
| `URX` | 재시도 한도(HTTP)·최대 연결 시도(TCP) 소진 | 호출 쪽 | 기본 재시도를 다 쓴 연결 실패, `UF`와 함께 찍힘 |
| `UT` | 업스트림 요청 타임아웃, 504 | 호출 쪽 | VirtualService `timeout` 초과 |
| `UO` | 업스트림 오버플로(서킷 브레이킹), 503 | 호출 쪽 | DestinationRule `connectionPool` 한도 초과 |
| `NR` | 라우트 없음 404, 맞는 filter chain 없음 | 호출 쪽 / 대상 쪽 | VirtualService match 누락 / STRICT 포트에 평문 도착(추정) |
| `NC` | 업스트림 클러스터 없음 | 호출 쪽 | DestinationRule에 없는 subset으로 보냄(추정) |
| `UC` | 업스트림 연결 종료, 503 | 호출 쪽 / 대상 쪽 | headless 파드 IP 직접 호출 / 대상 앱이 응답 전에 끊음(추정) |
| `DC` | 다운스트림 연결 종료 | 호출 쪽 | 호출 앱이 응답 전에 먼저 끊음, 코드는 보통 0(추정) |

`URX`가 홀로 나오는 경우는 드뭅니다. Istio 기본 정책은 연결 실패를 두 번 더 시도하며, 마지막 시도까지 실패하면 재시도 소진과 실패 사유를 함께 기록합니다. 그래서 `UF,URX`처럼 쉼표로 이어진 값이 남습니다.

아래 줄은 기본 TEXT 포맷을 따라 만든 형식 예시입니다. 실제 클러스터에서 수집한 로그가 아니며, 요청 ID도 짧게 줄였습니다.

```text
[2026-11-09T10:00:00.000Z] "GET /orders HTTP/1.1" 503 UF,URX upstream_reset_before_response_started{remote_connection_failure} - "-" 0 190 31 - "-" "curl/8.5.0" "7c1e0f3a" "svc-b:8080" "10.0.2.15:8080" outbound|8080||svc-b.default.svc.cluster.local - 10.96.12.40:8080 10.0.1.7:41234 - default
```

호출 쪽에서 flag가 붙은 줄을 추린 뒤, 그 요청 ID로 대상 쪽 로그를 찾습니다.

```bash
kubectl logs deploy/web -c istio-proxy --since=10m | grep -E '" [0-9]{3} (UF|UH|URX|UO|UT|NR|NC|UC)'
kubectl logs deploy/svc-b -c istio-proxy --since=10m | grep 7c1e0f3a
```

대상 사이드카는 호출 쪽이 붙인 `x-request-id`를 유지합니다. 따라서 양쪽 로그를 같은 ID로 이어 볼 수 있습니다. 대상 쪽에서 ID를 찾지 못했다면 먼저 로그가 켜져 있는지, 필터나 수집 과정에서 빠지지는 않았는지 확인합니다.

그 조건을 확인했는데도 호출 쪽의 `UF`나 `UH`에 대응하는 ID가 대상 쪽에 없다면, 요청은 대상 사이드카의 HTTP 처리까지 도달하지 못한 것입니다. 간헐적인 5xx를 이런 방식으로 홉별로 추적하는 과정은 [간헐적 응답 이상 추적]({{< relref "/platform/istio/operations/05-incident-intermittent-5xx/index.md" >}})에 있습니다.

{{% details title="표에 넣지 않은 flag" closed="true" %}}
| flag | 뜻 | 적용 | 메시에서 만나는 장면 |
|---|---|---|---|
| `LR` | 로컬 reset, 503 | HTTP | 프록시 쪽에서 스트림을 끊음 |
| `UR` | 업스트림 원격 reset, 503 | HTTP | 업스트림이 HTTP/2 스트림을 reset |
| `UPE` | 업스트림 응답의 HTTP 프로토콜 오류, 502 | HTTP | 대상이 깨진 응답을 보냄 |
| `DPE` | 다운스트림 요청의 HTTP 프로토콜 오류 | HTTP | HTTP로 선언한 포트에 HTTPS를 보냄(`400 DPE`) |
| `UMSDR` | 업스트림 max stream duration 도달 | HTTP | 스트림 최대 지속 시간 설정 |
| `SI` | 스트림 유휴 타임아웃, 408 또는 504 | HTTP | 오래 쉬는 스트림 |
| `DT` | max connection duration 초과 | HTTP·TCP | 연결 최대 지속 시간 설정 |
| `DI` / `FI` | fault injection 지연 / 중단 | HTTP | VirtualService `fault`, 호출 쪽 적용 |
| `RL` | 로컬 rate limit, 429 | HTTP | local rate limit 필터를 붙인 쪽 |
| `UAEX` | 외부 인가 서비스가 거부 | HTTP | ext_authz를 붙인 쪽 |
| `OM` | Overload Manager가 종료 | HTTP | 프록시 자원 압박 |
| `DF` | DNS 해석 실패 | HTTP | 동적 포워드 프록시 경로 |
| `DO` | drop_overloads로 종료, 503 | HTTP | 엔드포인트 drop 설정 |
| `DR` | 다운스트림 HTTP/2 reset | HTTP | 호출 쪽이 스트림을 reset |

표의 설명에 적힌 응답 코드는 TCP 연결에 적용되지 않습니다. TCP에서는 `%RESPONSE_CODE_DETAILS%`와 `%UPSTREAM_TRANSPORT_FAILURE_REASON%`도 `-`로 남습니다.
{{% /details %}}

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| flag 정의와 HTTP·TCP 적용 범위 | Envoy 1.39 | [Envoy substitution formatter, RESPONSE_FLAGS](https://www.envoyproxy.io/docs/envoy/v1.39.0/configuration/advanced/substitution_formatter) |
| 여러 flag는 쉼표로 이어짐 | Envoy 1.39.7-dev(커밋 8893f913) | envoyproxy/envoy `source/common/stream_info/utility.cc` |
| 재시도를 다 쓴 reset은 URX와 reset 사유 flag(UF·UC 등)를 함께 세움, details는 `upstream_reset_before_response_started{사유}` | 같은 커밋 | envoyproxy/envoy `source/common/router/router.cc` |
| 업스트림이 준 응답의 details는 `via_upstream` | 같은 커밋 | envoyproxy/envoy `envoy/stream_info/stream_info.h` |
| 기본 재시도 2회, `connect-failure` 등 포함 | Istio 1.31.4 | istio/istio `pilot/pkg/networking/core/route/retry/retry.go` |
| UF는 mTLS 충돌, UO는 DR 서킷 브레이커, NR은 DR·VS를 확인, headless 파드 IP 직접 호출은 `503 UC`, HTTPS를 HTTP 포트로 보내면 `400 DPE` | Istio 1.31.4 문서 | [Istio Network Problems](https://istio.io/latest/docs/ops/common-problems/network-issues/) |
| 서킷 브레이커 오버플로는 클라이언트 쪽 프록시 통계에 잡힘 | Istio 1.31.4 태스크 | [Istio Circuit Breaking](https://istio.io/latest/docs/tasks/traffic-management/circuit-breaking/) |
| TLS 실패 사유(`TLSV1_ALERT_UNKNOWN_CA` 등)는 `UPSTREAM_TRANSPORT_FAILURE_REASON`에 남음 | Envoy 1.39 | [Envoy TLS troubleshooting](https://www.envoyproxy.io/docs/envoy/v1.39.0/intro/arch_overview/security/ssl#trouble-shooting) |
| 기본 TEXT 포맷에 `RESPONSE_FLAGS`·`RESPONSE_CODE_DETAILS`·`UPSTREAM_TRANSPORT_FAILURE_REASON`·`X-REQUEST-ID` 포함 | `accessLogFormat` 미지정 | [Istio Envoy Access Logs](https://istio.io/latest/docs/tasks/observability/logs/access-log/) |
| 대상 사이드카는 기존 `x-request-id`를 유지 | inbound HCM `useRemoteAddress: false`, edge 아닌 요청 | istio/istio 1.31.4 `listener_inbound.go`, [Envoy HTTP 헤더](https://www.envoyproxy.io/docs/envoy/v1.39.0/configuration/http/http_conn_man/headers) |
| 대상 쪽 UF·UC, 대상 쪽 NR filter_chain_not_found, NC의 subset 장면, DC의 코드 0 | 추정, 실측 아님 | 위 정의와 소스 동작에서 도출, NR 장면은 Istio 포럼 사례 |
{{% /details %}}

액세스 로그를 켜는 설정, `istio_requests_total`의 `response_flags`·`reporter` 라벨을 이용한 집계, 트레이스로 홉을 잇는 과정은 [3편]({{< relref "/study/istio-mesh/03-traces-left-behind/index.md" >}})에서 이어집니다.

[이전: 1편 한 연결에 묶인 길]({{< relref "/study/istio-mesh/01-to-the-gateway/index.md" >}}) · [다음: 3편 요청 뒤에 남은 발자국]({{< relref "/study/istio-mesh/03-traces-left-behind/index.md" >}})

## 참고 자료

설명의 기준은 사이드카 모드, Istio 1.31.4입니다. 세부 설정은 [CRD 카탈로그]({{< relref "/platform/istio/configuration/15-crd-catalog/index.md" >}})에서 이어집니다.

- [Envoy·istiod 설정 확인](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/) — 리스너·라우트·EDS
- [프로토콜 선택](https://istio.io/latest/docs/ops/configuration/traffic-management/protocol-selection/) — 명시 선언·자동 감지·HTTPS
- [보안 구조](https://istio.io/latest/docs/concepts/security/) · [PeerAuthentication](https://istio.io/latest/docs/reference/config/security/peer_authentication/) — 인증서·신원·STRICT
- [HBONE](https://istio.io/latest/docs/ambient/architecture/hbone/) — 터널과 앱 연결의 관계
- [Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/) — 요청 분산과 기본 동작
- [VirtualService](https://istio.io/latest/docs/reference/config/networking/virtual-service/) — HTTP 매칭·가중치·재시도·fault
- [DestinationRule](https://istio.io/latest/docs/reference/config/networking/destination-rule/) — 연결 풀·outlier detection
- [AuthorizationPolicy](https://istio.io/latest/docs/reference/config/security/authorization-policy/) — ALLOW·DENY와 HTTP 조건
- [Ambient L7 기능](https://istio.io/latest/docs/ambient/usage/l7-features/) — waypoint 경유와 정책 연결
