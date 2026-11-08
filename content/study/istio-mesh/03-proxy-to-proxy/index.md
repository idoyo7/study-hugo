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

<span id="host에서-대상-파드-ip까지"></span>

HTTP 라우트가 서비스 클러스터를 고르면, Envoy는 istiod가 EDS로 알려 준 파드 목록에서 대상을 선택합니다. 노드의 kube-proxy가 DNAT하기 전에 대상 파드 IP로 직접 연결하는 경로입니다. 받는 사이드카는 mTLS를 끝내고 앱의 **파드 IP:8080**으로 넘깁니다.

```bash
istioctl proxy-config listeners <pod-a> --port 15001 -o json
istioctl proxy-config routes <pod-a> --name 8080 -o json
istioctl proxy-config endpoints <pod-a> --cluster "outbound|8080||svc-b.default.svc.cluster.local"
```

## HTTP를 읽을지 정하는 포트 선언 {#http인지는-포트-선언이-먼저-정한다}

같은 사이드카라도 HTTP로 인식한 연결에만 HTTP 라우트와 재시도가 생깁니다.

{{< flow src="_flow/2-프로토콜-선언과-감지.json" />}}

Service 포트의 `appProtocol: http`가 `name: http-web`보다 우선합니다. 둘 다 없으면 HTTP·HTTP/2를 자동 감지합니다. MySQL처럼 서버가 먼저 말하는 프로토콜은 `tcp`로 명시합니다. 앱이 직접 암호화한 HTTPS는 사이드카가 복호화하지 않으므로 경로·헤더를 읽지 못합니다.

<span id="앱의-커넥션-하나가-파드-하나를-고정하지-않는다"></span>
<span id="http2-업그레이드는-별도-설정"></span>

앱과 Envoy 사이의 연결, Envoy와 대상 사이의 연결은 별개입니다. HTTP 요청마다 파드를 다시 고를 수 있고, 대상별 연결 풀에서 연결을 재사용합니다. 사이드카끼리라고 HTTP/1.1이 자동으로 HTTP/2로 바뀌지는 않습니다.

## 인증서로 확인하는 워크로드 신원 {#mtls-연결에서-주고받는-신원과-프로토콜}

mTLS에서는 양쪽 Envoy가 인증서를 제시하고 상대의 워크로드 신원을 확인합니다.

{{< seq src="_seq/4-mtls-핸드셰이크와-신원.json" />}}

기본 trust domain에서 신원은 `spiffe://cluster.local/ns/<namespace>/sa/<service-account>` 형태입니다. 파드가 바뀌어도 같은 서비스 어카운트의 신원으로 통신합니다. 인증서는 istio-agent가 istiod에서 발급받아 Envoy에 건넵니다.

### 암호화 선택과 평문 거부 {#자동으로-암호화해도-평문이-차단되지는-않는다}

**auto mTLS는 보내는 쪽의 선택**입니다. 별도 TLS 설정이 없으면 메시 엔드포인트에는 mTLS를, 사이드카가 없는 엔드포인트에는 평문을 선택합니다.

**PeerAuthentication은 받는 쪽의 허용 범위**입니다. 기본 `PERMISSIVE`는 mTLS와 평문을 모두 받습니다. 평문 연결까지 거부하려면 대상 범위에 `STRICT`를 적용합니다. 암호화 여부와 특정 요청을 허용하는 AuthorizationPolicy는 각각 확인해야 합니다.

## 메트릭에 남기는 상대 이름 {#메트릭에-남길-상대-정보는-따로-교환한다}

인증서의 신원과 워크로드 이름·버전 라벨은 서로 다른 정보입니다. HTTP에서는 peer 메타데이터 헤더와 워크로드 발견 정보로 상대를 식별하고, TCP mTLS 연결에서는 `istio-peer-exchange`를 협상해 메타데이터를 교환합니다. 기록을 읽는 방법은 [05편]({{< relref "/study/istio-mesh/05-logs-and-tracing/index.md" >}})에서 이어집니다.

## 앱 연결을 감싸는 ambient의 HBONE {#ambient에서는-앱-커넥션을-hbone으로-보낸다}

ambient에서는 노드의 ztunnel이 앱의 TCP 연결을 mTLS로 보호한 HBONE 터널에 싣습니다.

{{< seq src="_seq/6-hbone-터널과-앱-연결.json" />}}

HBONE은 HTTP/2 CONNECT를 사용하지만, 그 안의 앱 요청을 ztunnel이 HTTP로 해석하는 것은 아닙니다. 여러 앱 연결을 터널의 스트림으로 나누어 운반할 뿐입니다. HTTP 라우팅·재시도에는 **waypoint**가 필요합니다. 자세한 배치는 [Ambient 데이터 경로]({{< relref "/platform/istio/ambient/02-envoy-config-anatomy/index.md" >}})에서 봅니다.

## 다음 구간 {#다음-편에서는-http를-읽어-가능한-기능을-다룬다}

[이전: 02 게이트웨이에서 사이드카까지]({{< relref "/study/istio-mesh/02-gateway-to-sidecar/index.md" >}}) · [다음: 04 L7 프록시가 여는 기능]({{< relref "/study/istio-mesh/04-l7-only-features/index.md" >}})

## 근거와 더 보기

기준: 사이드카 모드, Istio 1.31.4. 세부 설정은 [CRD 카탈로그]({{< relref "/platform/istio/configuration/15-crd-catalog/index.md" >}})에서 이어집니다.

- [Envoy·istiod 설정 확인](https://istio.io/latest/docs/ops/diagnostic-tools/proxy-cmd/) — 리스너·라우트·EDS
- [프로토콜 선택](https://istio.io/latest/docs/ops/configuration/traffic-management/protocol-selection/) — 명시 선언·자동 감지·HTTPS
- [보안 구조](https://istio.io/latest/docs/concepts/security/) · [PeerAuthentication](https://istio.io/latest/docs/reference/config/security/peer_authentication/) — 인증서·신원·STRICT
- [HBONE](https://istio.io/latest/docs/ambient/architecture/hbone/) — 터널과 앱 연결의 관계
