---
title: "Envoy config로 해부하는 Ambient mode"
weight: 2
---

# 02 · Envoy config로 해부하는 Ambient mode — HBONE은 어떤 설정으로 만들어지는가 (2026-04)

{{< callout type="info" >}}
**참조한 내용정리** · 이 문서는 아래 원문을 읽고 우리 지식베이스 형식으로 재구성한 요약이다. 원문 자체가 아니며, 정확한 워딩·전체 맥락·그림은 원문에서 확인한다.
- **원문**: [Istio 2편: Envoy config로 해부하는 Ambient mode](https://tech.channel.io/kr/articles/tech-istio-envoy-config-c5193569)
- **매체 · 게시일**: 채널코퍼레이션 기술 블로그 · 2026-04-14
- **저자**: Jetty (정재홍) · DevOps Engineer
{{< /callout >}}

{{< callout type="info" >}}
**한눈에**
- 1편이 "HBONE은 HTTP/2 CONNECT + mTLS"라고 개념으로 끝낸 자리를, 2편은 **실제 Envoy config 덤프를 따라가며 그 개념이 어떤 필드로 구현되는지** 확인한다.
- 핵심 발견은 **`outbound|8080||ch-dropwizard-public.channel.svc.cluster.local` 이라는 단 하나의 클러스터가 목적지 상태에 따라 세 갈래로 갈린다**는 것 — out-of-mesh는 Pod IP 평문 직결, in-mesh는 `envoy_internal_address`, waypoint가 붙은 목적지는 Service ClusterIP. 갈림길을 결정하는 건 endpoint 메타데이터와 `transport_socket_match`다.
- HBONE은 **Envoy 기존 부품 세 개의 조합**이다: 메타데이터를 넘기는 `InternalUpstreamTransport`, CONNECT를 만드는 `tcp_proxy`의 `tunneling_config`, mTLS를 세우는 `UpstreamTlsContext`.
- 받는 쪽에서 ztunnel은 사이드카가 아닌데도 Pod 안에 있다. istio-cni node agent가 넘겨준 **netns FD로 Pod 네트워크 네임스페이스 안에 직접 listening 소켓(`15001`·`15006`·`15008`)을 만드는** 크로스 네임스페이스 소켓 기법이다.
- 리다이렉션 무한루프는 **패킷 마크 `0x539`와 커넥션 마크 `0x111`** 두 개로 막는다. 모든 REDIRECT 규칙이 `! --mark 0x539`를 달고 있다.
{{< /callout >}}

[01 왜 Istio Ambient mode인가]({{< relref "01-why-ambient-mode.md" >}})는 Ambient mode의 구성요소와 동작 원리를 개념 수준에서 다뤘다. HBONE이 HTTP/2 CONNECT와 mTLS의 조합이라는 것, ztunnel이 트래픽을 transparently redirect한다는 것까지는 설명했지만, 그것이 어떤 필드로 구현되어 있는지는 남겨뒀다. 이 문서는 채널팀이 프로덕션 Gateway의 Envoy config를 직접 덤프해 그 빈칸을 채운 기록이다.

이 레포의 상위 Istio 챕터([01 메시 기초]({{< relref "../01-mesh-basics.md" >}}) 이하 09편)는 전부 사이드카 모드 기준이다. 사이드카 모드에서는 "Envoy config를 읽는다"가 곧 "파드에 붙은 프록시 하나의 설정을 읽는다"였다. Ambient mode에서는 읽어야 할 대상이 Gateway Envoy, waypoint Envoy, ztunnel, 그리고 **Pod 네임스페이스의 iptables**로 흩어진다.

## 1. 먼저 Envoy의 처리 파이프라인

원문은 config를 읽기 전에 Envoy가 요청을 처리하는 다섯 단계부터 정리한다. 이하에서 인용하는 config는 전부 실제 프로덕션 프록시에서 뜬 덤프이며, 원문은 이를 `istioctl proxy-config` 명령으로 확인할 수 있다고만 밝힌다(하위 명령까지는 지정하지 않는다).

| 단계 | 역할 |
| --- | --- |
| Listener | 특정 포트에서 트래픽을 수신하고, 어떤 Filter Chain으로 처리할지 결정한다 |
| Filter Chain | 수신한 트래픽에 대한 처리 로직을 정의한다 |
| Route | Virtual Host 기반으로 요청을 어떤 Cluster로 보낼지 결정한다 |
| Cluster | 같은 서비스를 제공하는 endpoint들의 논리적 그룹이다 |
| Endpoint | 실제 트래픽이 전달되는 최종 목적지다 |

{{< flow caption="Envoy의 요청 처리 5단계 — istiod가 xDS API로 각 단계의 설정을 동적으로 밀어넣는다." >}}
{
  "nodes": [
    {"id": "l", "col": 0, "row": 0, "label": "Listener", "sub": "포트 수신", "kind": "src"},
    {"id": "f", "col": 1, "row": 0, "label": "Filter Chain", "sub": "처리 로직", "kind": "proc"},
    {"id": "r", "col": 2, "row": 0, "label": "Route", "sub": "Virtual Host 매칭", "kind": "query"},
    {"id": "c", "col": 3, "row": 0, "label": "Cluster", "sub": "endpoint 논리 그룹", "kind": "store"},
    {"id": "e", "col": 4, "row": 0, "label": "Endpoint", "sub": "최종 목적지", "kind": "sink"}
  ],
  "edges": [
    {"from": "l", "to": "f", "rate": 620},
    {"from": "f", "to": "r", "rate": 620},
    {"from": "r", "to": "c", "rate": 620},
    {"from": "c", "to": "e", "rate": 620}
  ]
}
{{< /flow >}}

이 설정은 정적 파일에 적혀 있지 않다. istiod(control plane)가 xDS API로 각 Envoy proxy에 전파한다. 사이드카 모드에서 istiod가 CPU를 먹는 지점이 이 push였다([02 컨트롤 플레인 해부]({{< relref "../02-istiod-control-plane.md" >}})). Ambient mode에서도 Gateway와 waypoint는 Envoy이므로 xDS를 받는다. 달라지는 건 메커니즘이 아니라 xDS를 받는 프록시의 개수다.

원문이 명시적으로 언급하는 xDS 자원은 route를 내려보내는 **RDS**다. 뒤에 나올 `http.443` route config가 리스너에 박혀 있지 않고 RDS로 흘러 들어온다는 점이 config를 읽는 순서를 정한다. 리스너 덤프만 봐서는 라우팅 규칙을 알 수 없고, route 덤프를 따로 떠야 한다.

배경 하나를 덧붙인다(원문 밖의 보충이다). 이 레포의 상위 챕터 [02 컨트롤 플레인 해부]({{< relref "../02-istiod-control-plane.md" >}})가 CDS·EDS·LDS·RDS·SDS와 이를 하나의 gRPC 스트림으로 묶는 ADS를 표로 정리해 뒀다. 3절의 "endpoint 메타데이터가 경로를 가른다"에서 그 메타데이터를 실어 나르는 자원이 보통 EDS다. 원문이 EDS를 이름으로 지목하는 자리는 4절의 `connect_originate` 클러스터가 **EDS를 쓰지 않는다**고 밝히는 대목 하나뿐이다.

읽는 순서도 이 구조를 따라간다. 원문은 Gateway Envoy를 리스너에서 시작해 route, cluster, endpoint 순으로 한 단계씩 내려가고, endpoint에 도달한 뒤에야 Ambient mode 고유의 분기를 만난다. 아래 2절과 3절이 그 순서다.

## 2. 채널팀 Gateway 구성과 요청의 시작점

원문은 채널팀의 실제 구성을 기준선으로 놓는다. Public Internet에서 받는 HTTP 요청은 **AWS ALB → Istio Gateway → Istio Waypoint 순서로 destination Pod에 도달**한다. 예시로 쓰는 도메인은 `api.channel.io`, 목적지 서비스는 `ch-dropwizard-public.channel.svc.cluster.local`이다.

### Active Listener: `0.0.0.0:443`과 `http.443`

Gateway Envoy에는 `0.0.0.0:443`에서 수신하는 리스너가 있다. 이 리스너의 Filter Chain에는 `HttpConnectionManager`가 설정되어 있고, **RDS(Route Discovery Service)를 통해 `http.443` 이름의 route config를 동적으로 받아온다**. 리스너 자체에는 라우팅 규칙이 박혀 있지 않고, 규칙은 별도의 xDS 자원으로 흘러 들어온다는 뜻이다.

### Virtual Host 매칭

`http.443` route config 안에서 Envoy는 요청의 `Host` 헤더와 매칭되는 Virtual Host를 찾는다. `api.channel.io`로 들어온 요청은 다음 클러스터로 라우팅된다.

```text
outbound|8080||ch-dropwizard-public.channel.svc.cluster.local
```

Istio 클러스터 이름의 `방향|포트|subset|FQDN` 관례를 그대로 따른다. 방향은 `outbound`, 포트는 서비스 포트 `8080`, subset은 비어 있고, FQDN이 목적지 서비스다.

여기까지는 사이드카 모드의 Gateway와 동일하다. 리스너도, `HttpConnectionManager`도, RDS도, 클러스터 이름 규칙도 같다. **Ambient mode의 차이는 이 클러스터 아래, endpoint 레벨에서 시작된다.** config를 위에서부터 읽어 내려오면 3절 전까지는 Ambient mode라는 사실이 드러나지 않는다.

## 3. 같은 클러스터, 세 갈래 경로 — Endpoint와 Transport Socket

원문이 가장 공들여 파는 지점이다. 클러스터 이름은 하나인데, 그 아래 endpoint는 목적지가 메시에 들어와 있는지, waypoint가 붙어 있는지에 따라 다른 모양으로 내려온다.

| 케이스 | endpoint 주소 | 선택되는 transport socket | 실제 경로 |
| --- | --- | --- | --- |
| Out-of-mesh 목적지 | Pod IP 직접 (`10.90.165.200:8080`) | `tlsMode-disabled` (RawBuffer) | Pod로 평문 직결, HBONE 없음 |
| In-mesh 목적지 | `envoy_internal_address` | `InternalUpstreamTransport` | 내부 리스너를 거쳐 HBONE 터널링 |
| Waypoint 목적지 | Service ClusterIP (`172.20.134.88:8080`) | `InternalUpstreamTransport` | Gateway → Waypoint → Pod |

### 케이스 1 — out-of-mesh: 아무 일도 일어나지 않는다

목적지 Pod가 메시에 등록되어 있지 않으면 endpoint에는 그냥 Pod IP `10.90.165.200:8080`이 실린다. endpoint 메타데이터에 `envoy.transport_socket_match`의 `tunnel` 키가 없으므로, 매칭 규칙에 따라 default인 **`tlsMode-disabled`(RawBuffer)** 가 선택된다. 평문으로 Pod에 바로 붙는다. Ambient mode 클러스터 안에 있어도 enroll되지 않은 워크로드는 이 경로를 탄다.

### 케이스 2 — in-mesh: endpoint가 IP가 아니다

목적지가 메시에 들어와 있으면 endpoint의 주소가 실제 네트워크 주소가 아니라 **`envoy_internal_address`** 로 바뀐다. 이건 Envoy 프로세스 내부의 user space 통신을 가리키는 주소로, `server_listener_name`으로 **`connect_originate`라는 이름의 internal listener**를 지정한다. 최종 목적지 정보는 메타데이터(`endpoint_id`, `original_dst` 등)에 실려 함께 넘어간다.

동시에 endpoint 메타데이터에는 **`tunnel: http`** 가 붙는다. 클러스터의 `transport_socket_matches`가 이 키를 보고 `tlsMode-disabled` 대신 `InternalUpstreamTransport`를 고른다. 즉 **평문 직결이냐 HBONE이냐는 라우팅 규칙이 아니라 endpoint 메타데이터 한 줄이 가른다.**

### 케이스 3 — waypoint: endpoint가 Service ClusterIP가 된다

목적지에 waypoint가 붙어 있으면 endpoint 주소가 **최종 Pod IP가 아니라 Service ClusterIP(`172.20.134.88:8080`)** 가 된다. 최종 Pod 선택을 waypoint가 담당하기 때문이다. Gateway는 "이 서비스로 보내라"까지만 결정하고, 어느 Pod로 갈지는 waypoint의 Envoy가 자기 라우팅 테이블로 정한다. `workload` 메타데이터도 `istio-waypoint`를 가리킨다.

{{< flow caption="클러스터 이름은 하나인데 endpoint 메타데이터가 세 갈래로 가른다 — 갈림길을 고르는 건 transport_socket_match다." >}}
{
  "nodes": [
    {"id": "ep", "col": 0, "row": 1, "label": "Endpoint 메타데이터", "sub": "transport_socket_match", "kind": "query"},
    {"id": "oo", "col": 1, "row": 0, "label": "out-of-mesh", "sub": "tlsMode-disabled · RawBuffer", "kind": "sink"},
    {"id": "im", "col": 1, "row": 1, "label": "in-mesh", "sub": "envoy_internal_address", "kind": "proc"},
    {"id": "wp", "col": 1, "row": 2, "label": "waypoint 있음", "sub": "Service ClusterIP", "kind": "proc"},
    {"id": "co", "col": 2, "row": 1, "label": "HBONE 터널", "sub": "connect_originate", "kind": "proc"},
    {"id": "zt", "col": 3, "row": 1, "label": "ztunnel :15008", "sub": "목적지 Pod netns 안", "kind": "sink"}
  ],
  "edges": [
    {"from": "ep", "to": "oo", "label": "tunnel 키 없음", "rate": 900},
    {"from": "ep", "to": "im", "label": "tunnel: http", "rate": 520},
    {"from": "ep", "to": "wp", "label": "waypoint 키", "rate": 560},
    {"from": "im", "to": "co", "rate": 520},
    {"from": "wp", "to": "co", "rate": 560},
    {"from": "co", "to": "zt", "label": "CONNECT", "rate": 520}
  ]
}
{{< /flow >}}

{{< callout type="important" >}}
같은 클러스터 이름을 보고 "이 서비스로 가는 트래픽은 다 똑같이 처리되겠지"라고 판단하면 Ambient mode에서는 틀린다. 트러블슈팅에서 클러스터 정의만 보고 endpoint 덤프를 건너뛰면 out-of-mesh 평문 경로와 HBONE 경로를 구분할 수 없다.
{{< /callout >}}

## 4. HBONE을 이루는 Envoy 부품 세 개

`connect_originate` internal listener에 도착한 뒤가 HBONE의 본체다. 원문의 결론은 Envoy에 이미 있던 세 부품을 엮었다는 것이다.

| 부품 | 하는 일 |
| --- | --- |
| `InternalUpstreamTransport` | endpoint→internal listener로 메타데이터(실제 destination 주소)를 통과시킨다 |
| `tcp_proxy`의 `tunneling_config` | HTTP/2 CONNECT 요청을 만든다 |
| `UpstreamTlsContext` | 터널 위에 mTLS를 수립한다 |

각 부품의 상세는 다음과 같다. `InternalUpstreamTransport`는 endpoint에서 internal listener까지 메타데이터를 통과시키며, 실제 destination 주소(`local: 10.90.165.200:8080`)가 이 경로로 internal listener까지 도달한다. `tcp_proxy`의 `tunneling_config`에 설정된 hostname은 CONNECT 요청의 `:authority` 헤더가 된다. `UpstreamTlsContext`는 SPIFFE ID로 상대 워크로드 신원을 검증하고, ALPN은 `h2`로 협상한다.

`connect_originate` 리스너 자체에는 **`original_dst` listener filter**가 걸려 있어, `InternalUpstreamTransport`로 넘어온 메타데이터에서 원래 목적지를 복원한다. 그 위의 `tcp_proxy` 필터가 `connect_originate` 클러스터로 연결하면서 CONNECT를 발행한다.

`connect_originate` 클러스터 자체도 일반 클러스터와 다르다. 타입이 `ORIGINAL_DST`인 특수 클러스터로, **EDS(Endpoint Discovery Service)를 쓰지 않는다.** 정적으로 내려받은 endpoint 목록 대신 다운스트림 connection의 메타데이터로부터 upstream host를 그때그때 결정한다. 앞서 2절에서 본 `outbound|8080||ch-dropwizard-public...` 클러스터가 EDS로 endpoint를 받는 것과 대비된다.

마지막 조각이 포트다. `upstream_port_override: 15008`로 목적지 포트를 **ztunnel의 HBONE 수신 포트**로 덮어쓴다. 애플리케이션이 노출한 포트가 `8080`이어도 TCP 커넥션이 향하는 곳은 목적지 노드 ztunnel의 `15008`이다. 원래의 `8080`은 CONNECT 요청 안쪽에 실려 터널 반대편에서 복원된다.

{{< seq caption="HBONE 터널이 서는 순서 — 목적지는 EDS가 아니라 다운스트림 커넥션 메타데이터에서 나오고, waypoint 유무가 그 목적지를 한 번 더 갈아끼운다." >}}
{
  "participants": [
    {"id": "GW", "label": "Gateway Envoy"},
    {"id": "IL", "label": "internal listener"},
    {"id": "CL", "label": "ORIGINAL_DST 클러스터"},
    {"id": "ZT", "label": "ztunnel :15008"}
  ],
  "steps": [
    {"msg": ["GW", "IL"], "label": "1. envoy_internal_address 로 user space 연결"},
    {"note": ["IL"], "lines": ["original_dst 리스너 필터가 메타데이터에서", "원래 목적지 10.90.165.200:8080 을 복원"]},
    {"msg": ["IL", "CL"], "label": "2. tcp_proxy → connect_originate 클러스터"},
    {"note": ["CL"], "lines": ["EDS 미사용 — 다운스트림 커넥션 메타데이터로 upstream host 결정", "upstream_port_override: 15008"]},
    {"alt": "waypoint 없는 목적지", "steps": [
      {"note": ["CL"], "lines": ["upstream host = 목적지 노드의 ztunnel"]}
    ], "elseLabel": "waypoint 붙은 목적지", "elseSteps": [
      {"note": ["CL"], "lines": ["upstream host 를 waypoint 주소로 override", "최종 Pod 선택은 waypoint 가 맡는다"]}
    ]},
    {"msg": ["CL", "ZT"], "label": "3. UpstreamTlsContext — mTLS 시작 (ALPN h2)"},
    {"msg": ["ZT", "CL"], "label": "4. SPIFFE ID 상호 검증", "dashed": true},
    {"msg": ["CL", "ZT"], "label": "5. HTTP/2 CONNECT · :authority = 원래 목적지"},
    {"note": ["CL", "ZT"], "lines": ["HBONE 터널 수립 — 이후 앱 트래픽은", "이 터널 안의 HTTP/2 스트림으로 오간다"]}
  ]
}
{{< /seq >}}

정리하면 이 세 줄이다.

```text
InternalUpstreamTransport   → 메타데이터(원래 목적지)를 internal listener까지 전달
tcp_proxy.tunneling_config  → HTTP/2 CONNECT 생성, hostname을 :authority로
UpstreamTlsContext          → SPIFFE ID 기반 mTLS, ALPN h2
upstream_port_override:15008 → 실제 TCP 목적지를 ztunnel HBONE 포트로 override
```

사이드카 모드에서 표준 CRD로 안 되는 걸 [08 EnvoyFilter]({{< relref "../08-envoyfilter-extension.md" >}})로 억지로 패치했던 것과 비교하면, Ambient mode는 같은 저수준 부품을 istiod가 정식 경로로 조립해 내려준다.

## 5. 받는 쪽 — ztunnel은 어떻게 Pod 안에 들어가는가

여기서부터는 Envoy config가 아니라 리눅스 네트워킹이다. ztunnel은 DaemonSet이라 노드당 하나인데, 원문은 그 프로세스가 **Pod 네트워크 네임스페이스 안에 listening 소켓을 갖는다**는 사실을 파고든다.

### istio-cni plugin과 node agent의 분업

| 컴포넌트 | 역할 |
| --- | --- |
| istio-cni plugin | 체인드 CNI 플러그인 — Pod 생성 이벤트를 감지해 node agent로 전달한다 |
| istio-cni node agent | Pod netns에 진입해 iptables 규칙을 설정, UDS로 ztunnel에 Pod 정보·netns FD 전달 |
| ztunnel | 전달받은 netns FD로 Pod 네임스페이스 안에 직접 listening 소켓을 생성한다 |

결과가 직관에 반한다. **Pod 안에서 localhost의 `15001`·`15006`·`15008`에 listening 소켓이 보이지만, 이 소켓을 소유한 건 Pod의 컨테이너가 아니라 ztunnel DaemonSet 프로세스다.** 원문의 표현대로 ztunnel 프로세스는 Node level에서 동작하고, 소켓만 Pod 네트워크 안에 만든다.

이게 Ambient mode가 "사이드카 없음"을 달성한 방법이다. 파드에 컨테이너를 추가하지 않고도 파드 네임스페이스에서 트래픽을 받는다. 파드마다 Envoy를 하나씩 얹어 [컨트롤 플레인 부하와 커넥션 수를 키웠던]({{< relref "../09-istiod-scaling-connections.md" >}}) 사이드카 모드와 대비된다.

{{< callout type="warning" >}}
원문은 세 포트가 Pod 네임스페이스에 열린다는 사실까지만 밝히고, `15001`·`15006`·`15008` 각각의 역할을 항목별로 정의하지는 않는다. 본문에서 명시적으로 확인되는 건 **egress가 `15001`로 REDIRECT되고, HBONE 터널이 `15008`로 수신된다**는 두 가지다. `15006`의 용도는 원문 범위 밖이다.
{{< /callout >}}

### iptables: 두 개의 체인

istio-cni node agent가 Pod 네임스페이스에 심는 규칙은 방향별로 체인이 갈린다.

| 방향 | 훅 | 체인 | 동작 |
| --- | --- | --- | --- |
| Ingress | `PREROUTING` | `ISTIO_PRERT` | Pod으로 들어오는 모든 TCP 트래픽이 이 체인을 거친다 |
| Egress | `OUTPUT` | `ISTIO_OUTPUT` | 모든 TCP 송신을 ztunnel의 `15001`로 REDIRECT한다 |

ztunnel은 `15001`로 받은 트래픽에 HBONE 캡슐화를 적용한 뒤 목적지로 보낸다. 원문은 이 두 체인의 존재와 리다이렉트 목적지까지를 설명하고, 규칙 한 줄 한 줄의 매칭 조건을 전부 나열하지는 않는다. 다만 **모든 REDIRECT 규칙에 `! --mark 0x539` 조건이 붙어 있다**는 점은 명시한다.

### 패킷 마킹: `0x539`와 `0x111`

리다이렉션을 무조건 걸면 ztunnel이 내보낸 패킷이 다시 ztunnel로 돌아오는 무한루프가 생긴다. 마크 두 개가 이걸 막는다.

| 마크 | 종류 | 언제 붙나 | 무엇을 막나 |
| --- | --- | --- | --- |
| `0x539` | packet mark | ztunnel 발신 패킷에 설정 | REDIRECT 우회 — 무한루프 방지 |
| `0x111` | connection mark (connmark) | ztunnel→앱 전달 시 `PREROUTING`에서 커넥션에 기록 | 응답 패킷의 리다이렉트 방지 |

REDIRECT 규칙은 전부 `! --mark 0x539`를 달고 있어 ztunnel 발신 패킷은 리다이렉션을 우회한다. `0x111`은 ztunnel이 `mark 0x539`로 앱에 트래픽을 전달할 때 기록되며, 앱이 같은 커넥션으로 보내는 응답 패킷까지 리다이렉트에서 제외한다.

{{< seq caption="요청은 리다이렉트하되 그 응답은 리다이렉트하지 않기 위해, 커넥션 단위의 상태를 connmark로 기억한다 — 이 기억이 없으면 응답이 ztunnel로 되돌아가 루프가 된다." >}}
{
  "participants": [
    {"id": "ZT", "label": "ztunnel (in-pod)"},
    {"id": "IPT", "label": "Pod netns iptables"},
    {"id": "APP", "label": "앱 컨테이너"}
  ],
  "steps": [
    {"msg": ["ZT", "IPT"], "label": "1. HBONE 해제한 트래픽을 앱으로 (mark 0x539)"},
    {"note": ["IPT"], "lines": ["mangle PREROUTING: mark 0x539 를 보고", "이 커넥션에 connmark 0x111 을 기록"]},
    {"msg": ["IPT", "APP"], "label": "2. REDIRECT 우회 — 규칙이 ! --mark 0x539 라서"},
    {"msg": ["APP", "IPT"], "label": "3. 같은 커넥션으로 응답 송신", "dashed": true},
    {"note": ["IPT"], "lines": ["mangle OUTPUT: connmark 0x111 → 패킷 mark 로 복원"]},
    {"alt": "mark 0x111 매치", "steps": [
      {"note": ["IPT"], "lines": ["nat: ACCEPT — ISTIO_OUTPUT 의 REDIRECT 를 타지 않는다", "응답은 ztunnel 을 다시 거치지 않고 그대로 나간다"]}
    ], "elseLabel": "connmark 를 안 남겼다면", "elseSteps": [
      {"msg": ["IPT", "ZT"], "label": "REDIRECT :15001 — 응답이 ztunnel 로 되돌아간다"}
    ]}
  ]
}
{{< /seq >}}

### `169.254.7.127` — health check를 트래픽에서 떼어내기

`169.254.7.127`은 **kubelet health check probe를 구분하기 위한 SNAT IP**다. kubelet이 보내는 probe는 메시 정책·mTLS의 대상이 아니어야 하는데, 노드에서 오는 평범한 TCP라 일반 트래픽과 구분이 안 된다. 이 링크로컬 주소로 SNAT해 두면 iptables 규칙이 probe를 식별해 리다이렉션에서 뺄 수 있다. 원문은 이 상수를 istio/istio 저장소의 `cni/pkg/nodeagent/options.go:44`로 연결한다.

## 6. 요청 하나의 전체 여정

원문은 마지막에 지금까지 따라온 config 조각들을 하나의 경로로 다시 꿰맨다.

| # | 단계 | 관여하는 설정 |
| --- | --- | --- |
| 1 | 요청이 Gateway Listener에 도착 | `0.0.0.0:443` 리스너, `HttpConnectionManager` |
| 2 | Route에서 Virtual Host를 매칭해 Cluster 결정 | RDS의 `http.443` → `outbound` 클러스터 (`Host: api.channel.io` 매칭) |
| 3 | `connect_originate` internal listener로 연결 | endpoint의 `envoy_internal_address` |
| 4 | `tcp_proxy`가 HTTP/2 CONNECT·mTLS로 HBONE 터널 완성 | `tunneling_config`, `UpstreamTlsContext`, port override |
| 5 | destination node Pod netns 안에서 ztunnel `15008` 소켓이 수신 | 크로스 네임스페이스 소켓, `ISTIO_PRERT` |
| 6 | HBONE 디캡슐레이션 후 애플리케이션 Pod에 전달 | 마크 `0x539` 부착, 커넥션에 `0x111` connmark 기록 |

## 7. 이 해부가 실무에서 쓰이는 곳

원문은 여기서 3편을 예고한다. Ambient mode를 프로덕션에 적용하면서 만난 이슈들, 특히 **503 에러와 Half-Open(stale) Connection 문제**를 어떻게 추적하고 해결했는지가 다음 주제다. 그 추적의 전제가 이 문서다. 경로의 어느 홉에서 커넥션이 끊겼는지 판단하려면, 그 홉이 Gateway Envoy의 internal listener인지, HBONE 터널의 HTTP/2 스트림인지, ztunnel의 `15008` 소켓인지를 먼저 구분할 수 있어야 한다.

이어지는 실전 문서는 [03-1 503과 Half-open Connection]({{< relref "03-1-503-half-open-connection.md" >}})이다.

## 이 문서에서 가져갈 것

- 경로 분기는 클러스터가 아니라 **endpoint 메타데이터**에서 일어난다. 클러스터 이름 하나(`outbound|8080||ch-dropwizard-public.channel.svc.cluster.local`) 아래에서 `tunnel: http` 유무와 `transport_socket_match`가 평문 직결·HBONE·waypoint 경유를 가른다. 디버깅할 때는 endpoint 덤프까지 내려가야 한다.
- HBONE은 기존 Envoy 부품의 조합이다. `InternalUpstreamTransport`(메타데이터) + `tunneling_config`(CONNECT) + `UpstreamTlsContext`(mTLS) + `upstream_port_override: 15008`. 각 부품을 따로 알고 있으면 config 덤프가 읽힌다.
- waypoint가 붙으면 Gateway의 endpoint는 Pod IP가 아니라 **Service ClusterIP**다. 최종 Pod 선택 책임이 waypoint로 넘어가기 때문에, "Gateway가 어느 Pod로 보냈나"는 Gateway config에서 찾아도 나오지 않는다.
- "사이드카가 없다"는 **파드에 컨테이너를 추가하지 않는다**는 뜻이다. ztunnel은 netns FD를 받아 Pod 네임스페이스 안에 직접 소켓을 만든다. 파드 안에서 보이는 `15001`·`15006`·`15008` 소켓의 소유자는 노드의 ztunnel DaemonSet이다.
- 투명 리다이렉션의 난이도는 **루프 방지**에 있다. 패킷 마크 `0x539`로 ztunnel 발신 패킷을 REDIRECT에서 빼고, connmark `0x111`로 커넥션 상태를 기억해 응답 패킷까지 빼야 "투명"해진다. 리다이렉션 기반 인터셉션을 직접 만들 일이 있다면 이 두 겹이 최소 요건이다.

## 소스

- **원문**: [Istio 2편: Envoy config로 해부하는 Ambient mode](https://tech.channel.io/kr/articles/tech-istio-envoy-config-c5193569) (채널코퍼레이션 기술 블로그, 2026-04-14)
- [Istio — Ambient mode traffic redirection](https://istio.io/latest/docs/ambient/architecture/traffic-redirection/) · 원문이 iptables 리다이렉션 설명에 인용
- [Ambient Mesh docs — Configure waypoints: Istio ingress gateway](https://ambientmesh.io/docs/setup/configure-waypoints/#istio-ingress-gateway) · 원문이 Gateway와 waypoint 연동 설명에 인용
- [istio/istio — `cni/pkg/nodeagent/options.go`](https://github.com/istio/istio/blob/master/cni/pkg/nodeagent/options.go) · 원문이 `169.254.7.127` SNAT IP 상수의 출처로 인용 (44행)
- 이 문서가 다루지 못한 부분: 원문에 실린 Envoy config 덤프와 iptables 규칙의 **원본 전문**은 옮기지 않았다. 각 필드가 무엇을 하는지는 위에 정리했지만, 규칙 한 줄 단위의 매칭 조건과 순서는 원문에서 직접 확인해야 한다.
