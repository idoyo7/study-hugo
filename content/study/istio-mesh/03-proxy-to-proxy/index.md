---
title: "03 신원을 주고받는 두 프록시 — 사이드카와 사이드카 사이"
description: "사이드카의 요청 경로, 프로토콜 판별, mTLS 신원, ambient HBONE을 네 그림으로 따라간다. 암호화 선택과 평문 거부의 차이를 함께 짚는다."
date: 2026-11-07
lastmod: 2026-11-08
inlineToc: false
weight: 3
url: "/study/istio-mesh/03-proxy-to-proxy/"
aliases:
  - "/istio/mesh-traffic/03-proxy-to-proxy/"
---

# 03 · 신원을 주고받는 두 프록시 — 사이드카와 사이드카 사이

앱 A가 `http://svc-b:8080`을 부르면 양쪽 사이드카가 요청을 주고받습니다. 아래는 HTTP로 인식한 내부 호출의 경로입니다.

{{< flow src="_flow/1-커넥션-하나가-지나는-리스너.json" />}}

## 원래 목적지에서 대상 파드까지 {#clusterip로-연-커넥션이-먼저-닿는-곳}

앱이 지정한 목적지는 ClusterIP지만, 파드의 리다이렉트 규칙이 먼저 Envoy `:15001`로 보냅니다. Envoy는 `SO_ORIGINAL_DST`로 원래 목적지를 읽고 그 주소에 맞는 논리 리스너로 넘깁니다. 그림의 8080 리스너는 새 네트워크 홉이 아니라 같은 Envoy 안의 설정입니다.

리다이렉트 규칙은 `istio-init`이나 Istio CNI가 넣습니다. `:15001`은 `virtualOutbound`이고, 8080이면 `0.0.0.0_8080`으로 넘깁니다. 맞는 리스너가 없으면 `PassthroughCluster`가 원래 목적지로 연결하고, 기본값 `ALLOW_ANY`라 메시가 모르는 외부 주소 호출도 나갑니다.

<span id="host에서-대상-파드-ip까지"></span>

HTTP 라우트가 서비스 클러스터를 고르면, Envoy는 istiod가 EDS로 알려 준 파드 목록에서 대상을 선택합니다. 노드의 kube-proxy가 DNAT하기 전에 대상 파드 IP로 직접 연결하는 경로입니다. 받는 사이드카는 mTLS를 끝내고 앱의 **파드 IP:8080**으로 넘깁니다.

8080 리스너는 RDS 라우트 `8080`에서 Host에 맞는 virtual host의 첫 route를 따라 `outbound|8080||svc-b.default.svc.cluster.local` 클러스터에 닿습니다. 대상 파드를 고르는 주체가 커널에서 사이드카로 넘어옵니다([01편]({{< relref "/study/istio-mesh/01-l4-l7-before-mesh/index.md" >}})).

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

## HTTP를 읽을지 정하는 포트 선언 {#http인지는-포트-선언이-먼저-정한다}

같은 사이드카라도 HTTP로 인식한 연결에만 HTTP 라우트와 재시도가 생깁니다.

{{< flow src="_flow/2-프로토콜-선언과-감지.json" />}}

Service 포트의 `appProtocol: http`가 `name: http-web`보다 우선합니다. 둘 다 없으면 HTTP·HTTP/2를 자동 감지하며, 판별에 실패하면 평문 TCP로 취급해 HTTP 라우트·재시도·메트릭 없이 바이트만 중계합니다.

MySQL처럼 서버가 먼저 말하는 프로토콜은 자동 감지와 맞지 않습니다. Istio는 25, 53, 3306, 27017을 TCP로 간주하고, 다른 포트는 `tcp`로 명시합니다. 앱이 직접 암호화한 HTTPS는 사이드카가 복호화하지 않으므로 경로·헤더를 읽지 못합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| `appProtocol`이 포트 이름보다 우선, 자동 감지는 HTTP·HTTP/2이고 실패하면 plain TCP | Istio 1.31.4 | [Protocol Selection](https://istio.io/latest/docs/ops/configuration/traffic-management/protocol-selection/) |
| server-first는 자동 감지와 비호환, 25·53·3306·27017은 TCP로 간주 | Istio 1.31.4 | [Application Requirements](https://istio.io/latest/docs/ops/deployment/application-requirements/) |
{{% /details %}}

<span id="앱의-커넥션-하나가-파드-하나를-고정하지-않는다"></span>
<span id="http2-업그레이드는-별도-설정"></span>

앱과 Envoy 사이의 연결, Envoy와 대상 사이의 연결은 별개입니다. HTTP 요청마다 파드를 다시 고를 수 있고, 연결은 대상별 풀에서 재사용합니다. `maxRequestsPerConnection: 1`은 keep-alive를 끕니다.

사이드카끼리라고 HTTP/1.1이 자동으로 HTTP/2로 바뀌지는 않습니다. 기본은 `DO_NOT_UPGRADE`로 해석되고, 메시 전체는 `meshConfig.h2UpgradePolicy: UPGRADE`, 대상별로는 DestinationRule의 `trafficPolicy.connectionPool.http.h2UpgradePolicy`로 켭니다.

`useClientProtocol: true`가 먼저, 그다음 DestinationRule, 마지막이 메시 설정입니다. 메시 설정만으로 켠 업그레이드는 HTTP로 명시한 포트에만 적용됩니다. 자동 감지 포트는 들어온 프로토콜을 그대로 쓰므로 앱이 HTTP/1.1로 보내면 사이드카 사이도 HTTP/1.1입니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| `DefaultMeshConfig`가 h2UpgradePolicy를 설정하지 않아 기본은 `DO_NOT_UPGRADE`(proto 기본값에서 해석) | release-1.31 소스 | [mesh.go](https://github.com/istio/istio/blob/release-1.31/pkg/config/mesh/mesh.go) |
| `useClientProtocol` → DR → HTTP 명시 포트만 → 메시 설정 순 | release-1.31 `shouldH2Upgrade` | [cluster_traffic_policy.go](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/core/cluster_traffic_policy.go) |
| 자동 감지 포트는 `use_downstream_protocol` | release-1.31 소스 | [cluster_builder.go](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/core/cluster_builder.go) |
| `maxRequestsPerConnection: 1`은 keep-alive 끔 | Istio 1.31.4 | [DestinationRule](https://istio.io/latest/docs/reference/config/networking/destination-rule/) |
{{% /details %}}

## 인증서로 확인하는 워크로드 신원 {#mtls-연결에서-주고받는-신원과-프로토콜}

mTLS에서는 양쪽 Envoy가 인증서를 제시하고 상대의 워크로드 신원을 확인합니다. 보내는 사이드카는 EDS 엔드포인트에 `tlsMode: istio` 메타데이터가 있으면 mTLS로, 없으면 평문으로 보내므로 사이드카를 단계적으로 붙이는 중에도 호출이 끊기지 않습니다.

{{< seq src="_seq/4-mtls-핸드셰이크와-신원.json" />}}

기본 trust domain에서 신원은 `spiffe://cluster.local/ns/<namespace>/sa/<service-account>` 형태입니다. 파드가 바뀌어도 같은 서비스 어카운트의 신원으로 통신합니다. 인증서는 istio-agent가 istiod에서 발급받아 Envoy에 건넵니다. 기본 수명은 24시간입니다.

검증 대상은 IP나 파드 이름이 아니라 SPIFFE ID입니다. 보내는 쪽은 서버 인증서의 서비스 어카운트가 `svc-b`를 실행해도 되는지 확인합니다(secure naming check). AuthorizationPolicy의 principal 값도 이 SPIFFE ID입니다.

핸드셰이크의 ALPN(`istio-http/1.1`, `istio-h2` 등)에는 앞서 판별한 프로토콜이 실리고, 받는 `:15006`은 이 값으로 HTTP 체인과 TCP 체인을 고릅니다.

### 암호화 선택과 평문 거부 {#자동으로-암호화해도-평문이-차단되지는-않는다}

**auto mTLS는 보내는 쪽의 선택**입니다. 별도 TLS 설정이 없으면 메시 엔드포인트에는 mTLS를, 사이드카가 없는 엔드포인트에는 평문을 선택합니다.

**PeerAuthentication은 받는 쪽의 허용 범위**입니다. 기본 `PERMISSIVE`는 mTLS와 평문을 모두 받습니다. 평문 연결까지 거부하려면 대상 범위에 `STRICT`를 적용합니다.

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

`portLevelMtls`에는 Service 포트가 아니라 워크로드 포트 번호를 씁니다.

암호화 여부와 특정 요청을 허용하는 AuthorizationPolicy는 각각 확인해야 합니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 엔드포인트 라벨 `tlsMode: istio`로 `tlsMode-istio`/`tlsMode-disabled` transport socket 선택 | release-1.31 소스 | [cluster_tls.go](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/core/cluster_tls.go) |
| 클라이언트 ALPN `istio-http/1.1`·`istio-h2`로 인바운드가 HTTP 체인 선택 | release-1.31 소스 | [listener.go](https://github.com/istio/istio/blob/release-1.31/pilot/pkg/networking/core/listener.go) |
| 인증서 발급·SDS 전달, `SECRET_TTL` 기본 24h | Istio 1.31.4 | [Security concepts](https://istio.io/latest/docs/concepts/security/), [pilot-agent](https://istio.io/latest/docs/reference/commands/pilot-agent/) |
| PeerAuthentication 모드·UNSET 상속·`portLevelMtls`는 워크로드 포트 기준 | Istio 1.31.4 | [PeerAuthentication](https://istio.io/latest/docs/reference/config/security/peer_authentication/) |
{{% /details %}}

## 메트릭에 남기는 상대 이름 {#메트릭에-남길-상대-정보는-따로-교환한다}

인증서의 신원과 워크로드 이름·버전 라벨은 서로 다른 정보입니다. HTTP에서는 `x-envoy-peer-metadata-id`·`x-envoy-peer-metadata` 헤더로 상대를 식별하며, 헤더가 없으면 istiod가 내려준 워크로드 정보에서 찾는 경로도 있습니다. TCP mTLS 연결에서는 Istio 프록시끼리만 성립하는 ALPN `istio-peer-exchange`를 협상해 커넥션 첫머리에 protobuf 메타데이터를 교환합니다. 얻은 값은 `istio_requests_total`의 `source_*`·`destination_*` 라벨이 됩니다. 기록을 읽는 방법은 [05편]({{< relref "/study/istio-mesh/05-logs-and-tracing/index.md" >}})에서 이어집니다.

## 앱 연결을 감싸는 ambient의 HBONE {#ambient에서는-앱-커넥션을-hbone으로-보낸다}

ambient에서는 노드의 ztunnel이 앱의 TCP 연결을 mTLS로 보호한 HBONE 터널에 싣습니다. 파드에서 나가는 TCP는 모두 ztunnel `:15001`로 가고, 메시 안 목적지면 상대의 `:15008`로 HBONE을 엽니다.

{{< seq src="_seq/6-hbone-터널과-앱-연결.json" />}}

HBONE은 HTTP/2 CONNECT를 사용하지만, 그 안의 앱 요청을 ztunnel이 HTTP로 해석하는 것은 아닙니다. 같은 목적지 신원으로 가는 앱 연결을 공유 HTTP/2 커넥션의 스트림으로 나누어 운반할 뿐입니다. 터널은 소스·목적지 신원 쌍마다 하나입니다. 받는 쪽은 목적지 포트가 15008이면 HBONE 리스너가, 그 밖의 포트면 평문 리스너 `:15006`이 받습니다.

ztunnel은 L4까지여서 HTTP 라우팅·재시도에는 **waypoint**가 필요합니다. 이때 waypoint는 두 번째 HBONE 터널로 목적지 ztunnel에 보내며, 정책은 목적지 쪽 waypoint가 집행합니다. 1.31.4 문서 기준으로 사이드카·게이트웨이발 트래픽은 waypoint를 거치지 않으므로, waypoint에만 둔 L7 정책은 사이드카 클라이언트에게 적용되지 않습니다. 자세한 배치는 [Ambient 데이터 경로]({{< relref "/platform/istio/ambient/02-envoy-config-anatomy/index.md" >}})에서 봅니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| 나가는 TCP는 ztunnel 15001, 인바운드는 destination port 15008이면 HBONE, 아니면 15006 | Istio 1.31.4 | [Ambient traffic redirection](https://istio.io/latest/docs/ambient/architecture/traffic-redirection/) |
| HBONE은 CONNECT 터널 + mTLS, 신원 쌍마다 공유 HTTP/2 커넥션 | Istio 1.31.4 | [HBONE](https://istio.io/latest/docs/ambient/architecture/hbone/) |
| waypoint 경유 시 두 번째 HBONE, 사이드카·게이트웨이발 트래픽은 waypoint 미경유(향후 릴리스에서 바뀔 수 있다고 명시) | Istio 1.31.4 | [Ambient data plane](https://istio.io/latest/docs/ambient/architecture/data-plane/) |
{{% /details %}}

## 다음 구간 {#다음-편에서는-http를-읽어-가능한-기능을-다룬다}

[이전: 02 게이트웨이에서 사이드카까지]({{< relref "/study/istio-mesh/02-gateway-to-sidecar/index.md" >}}) · [다음: 04 L7 프록시가 여는 기능]({{< relref "/study/istio-mesh/04-l7-only-features/index.md" >}})

## 근거와 더 보기

기준: 사이드카 모드, Istio 1.31.4. 세부 설정은 [CRD 카탈로그]({{< relref "/platform/istio/configuration/15-crd-catalog/index.md" >}})에서 이어집니다.

- [Envoy·istiod 설정 확인](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/) — 리스너·라우트·EDS
- [프로토콜 선택](https://istio.io/latest/docs/ops/configuration/traffic-management/protocol-selection/) — 명시 선언·자동 감지·HTTPS
- [보안 구조](https://istio.io/latest/docs/concepts/security/) · [PeerAuthentication](https://istio.io/latest/docs/reference/config/security/peer_authentication/) — 인증서·신원·STRICT
- [HBONE](https://istio.io/latest/docs/ambient/architecture/hbone/) — 터널과 앱 연결의 관계
