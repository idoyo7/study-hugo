---
title: "Envoy config로 해부하는 Ambient mode"
date: 2026-08-01
weight: 2
---

# 02 · Envoy config로 해부하는 Ambient mode — HBONE은 어떤 설정으로 만들어지는가 (2026-04)

{{< callout type="info" >}}
**참조한 내용정리** · 이 문서는 아래 원문을 읽고 우리 지식베이스 형식으로 재구성한 요약입니다. 원문 자체가 아니며 정확한 워딩·전체 맥락·그림은 원문에서 확인합니다.
- **원문**: [Istio 2편: Envoy config로 해부하는 Ambient mode](https://tech.channel.io/kr/articles/tech-istio-envoy-config-c5193569)
- **매체 · 게시일**: 채널코퍼레이션 기술 블로그 · 2026-04-14
- **저자**: Jetty (정재홍) · DevOps Engineer
{{< /callout >}}

{{< callout type="info" >}}
- 1편은 "HBONE은 HTTP/2 CONNECT + mTLS"라는 개념 설명에서 멈췄습니다. 2편은 **실제 Envoy config 덤프를 한 단계씩 따라가며 그 개념이 어떤 필드로 구현되는지** 확인합니다.
- **`outbound|8080||ch-dropwizard-public.channel.svc.cluster.local` 이라는 단 하나의 클러스터가 목적지 상태에 따라 세 갈래로 나뉩니다** — out-of-mesh는 Pod IP 평문 직결, in-mesh는 `envoy_internal_address`, waypoint가 붙은 목적지는 Service ClusterIP. 갈림길을 결정하는 건 endpoint 메타데이터와 `transport_socket_match`다.
- HBONE은 **Envoy 기존 부품 세 개의 조합**입니다: 메타데이터를 넘기는 `InternalUpstreamTransport`, CONNECT를 만드는 `tcp_proxy`의 `tunneling_config`, mTLS를 세우는 `UpstreamTlsContext`.
- 받는 쪽에서 ztunnel은 사이드카가 아닌데도 Pod 안에 있습니다. istio-cni node agent가 넘겨준 **netns FD로 Pod 네트워크 네임스페이스 안에 직접 listening 소켓(`15001`·`15006`·`15008`)을 만드는** 크로스 네임스페이스 소켓 기법입니다.
- 리다이렉션 무한루프는 **패킷 마크 `0x539`와 커넥션 마크 `0x111`** 두 개로 막습니다. 모든 REDIRECT 규칙이 `! --mark 0x539`를 달고 있습니다.
{{< /callout >}}

[01 왜 Istio Ambient mode인가]({{< relref "01-why-ambient-mode.md" >}})가 다룬 범위는 개념까지였습니다. Ambient mode의 구성요소와 동작 원리, HBONE이 HTTP/2 CONNECT와 mTLS의 조합이라는 것, ztunnel이 트래픽을 transparently redirect한다는 것 — 거기까지는 설명했지만 어떤 필드로 구현되어 있는지는 남겨뒀습니다. 이 문서는 채널팀이 프로덕션 Gateway의 Envoy config를 직접 덤프해 그 빈칸을 채운 기록입니다.

읽어야 할 대상부터 하나가 아닙니다. 이 레포의 상위 Istio 챕터([01 메시 기초]({{< relref "../../01-mesh-basics.md" >}}) 이하 09편)는 전부 사이드카 모드 기준이고 사이드카 모드에서 "Envoy config를 읽는다"는 파드에 붙은 프록시 하나의 설정을 읽는다는 뜻이었습니다. Ambient mode에서는 그 대상이 Gateway Envoy, waypoint Envoy, ztunnel, **Pod 네임스페이스의 iptables**로 흩어집니다.

## 1. 먼저 Envoy의 처리 파이프라인

원문은 config를 읽기 전에 Envoy가 요청을 처리하는 다섯 단계부터 정리합니다. 이하에서 인용하는 config는 전부 실제 프로덕션 프록시에서 뜬 덤프이며 원문은 이를 `istioctl proxy-config` 명령으로 확인할 수 있다고만 밝힙니다(하위 명령까지는 지정하지 않습니다).

| 단계 | 역할 |
| --- | --- |
| Listener | 특정 포트에서 트래픽을 수신하고, 어떤 Filter Chain으로 처리할지 결정한다 |
| Filter Chain | 수신한 트래픽에 대한 처리 로직을 정의한다 |
| Route | Virtual Host 기반으로 요청을 어떤 Cluster로 보낼지 결정한다 |
| Cluster | 같은 서비스를 제공하는 endpoint들의 논리적 그룹이다 |
| Endpoint | 실제 트래픽이 전달되는 최종 목적지다 |

{{< flow src="_flow/1-먼저-envoy-의-처리.json" />}}

이 설정은 정적 파일에 적혀 있지 않습니다. istiod(control plane)가 xDS API로 각 Envoy proxy에 전파합니다. 사이드카 모드에서 istiod가 CPU를 먹는 지점이 이 push였습니다([02 컨트롤 플레인 해부]({{< relref "../../02-istiod-control-plane.md" >}})). Ambient mode에서도 Gateway와 waypoint는 Envoy이므로 xDS를 받습니다. 메커니즘은 같고 xDS를 받는 프록시의 개수만 달라집니다.

그러면 어느 자원이 무엇을 실어 나를까요. 원문이 명시적으로 언급하는 xDS 자원은 route를 내려보내는 **RDS**입니다. 뒤에 나올 `http.443` route config가 리스너에 박혀 있지 않고 RDS로 흘러 들어오기 때문에 config를 읽는 순서도 정해집니다 — 리스너 덤프만 봐서는 라우팅 규칙을 알 수 없고 route 덤프를 따로 떠야 합니다. 여기에 배경 하나를 덧붙입니다(원문 밖의 보충입니다). 이 레포의 상위 챕터 [02 컨트롤 플레인 해부]({{< relref "../../02-istiod-control-plane.md" >}})가 CDS·EDS·LDS·RDS·SDS와 이를 하나의 gRPC 스트림으로 묶는 ADS를 표로 정리해 뒀습니다. 3절의 "endpoint 메타데이터가 경로를 가른다"에서 그 메타데이터를 실어 나르는 자원이 보통 EDS입니다. 원문이 EDS를 이름으로 지목하는 자리는 4절의 `connect_originate` 클러스터가 **EDS를 쓰지 않는다**고 밝히는 대목 하나뿐입니다.

읽는 순서도 이 구조를 따라갑니다. 원문은 Gateway Envoy를 리스너에서 시작해 route, cluster, endpoint 순으로 한 단계씩 내려가고 endpoint에 도달한 뒤에야 Ambient mode 고유의 분기를 만납니다. 아래 2절과 3절이 그 순서입니다.

## 2. 채널팀 Gateway 구성과 요청의 시작점

기준선은 채널팀의 실제 구성입니다. Public Internet에서 받는 HTTP 요청은 **AWS ALB → Istio Gateway → Istio Waypoint 순서로 destination Pod에 도달**합니다. 원문이 예시로 쓰는 도메인은 `api.channel.io`, 목적지 서비스는 `ch-dropwizard-public.channel.svc.cluster.local`입니다.

### Active Listener: `0.0.0.0:443`과 `http.443`

Gateway Envoy에는 `0.0.0.0:443`에서 수신하는 리스너가 있습니다. 이 리스너의 Filter Chain에는 `HttpConnectionManager`가 설정되어 있고 **RDS(Route Discovery Service)로 `http.443` 이름의 route config를 동적으로 받아옵니다**. 리스너 자체에는 라우팅 규칙이 박혀 있지 않고 규칙은 별도의 xDS 자원으로 흘러 들어옵니다.

### Virtual Host 매칭

`http.443` route config 안에서 Envoy는 요청의 `Host` 헤더와 매칭되는 Virtual Host를 찾습니다. `api.channel.io`로 들어온 요청은 다음 클러스터로 라우팅됩니다.

```text
outbound|8080||ch-dropwizard-public.channel.svc.cluster.local
```

이름은 Istio 클러스터 이름의 `방향|포트|subset|FQDN` 관례를 그대로 따릅니다. 방향은 `outbound`, 포트는 서비스 포트 `8080`, subset은 비어 있고 FQDN이 목적지 서비스입니다.

여기까지는 사이드카 모드의 Gateway와 동일합니다. 리스너도, `HttpConnectionManager`도, RDS도, 클러스터 이름 규칙도 같습니다. **Ambient mode의 차이는 이 클러스터 아래, endpoint 레벨에서 시작됩니다.** config를 위에서부터 읽어 내려오면 3절 전까지는 Ambient mode라는 사실이 드러나지 않습니다.

## 3. 같은 클러스터, 세 갈래 경로 — Endpoint와 Transport Socket

원문이 가장 공들여 파는 대목입니다. 클러스터 이름은 하나인데 그 아래 endpoint는 목적지가 메시에 들어와 있는지, waypoint가 붙어 있는지에 따라 다른 모양으로 내려옵니다.

| 케이스 | endpoint 주소 | 선택되는 transport socket | 실제 경로 |
| --- | --- | --- | --- |
| Out-of-mesh 목적지 | Pod IP 직접 (`10.90.165.200:8080`) | `tlsMode-disabled` (RawBuffer) | Pod로 평문 직결, HBONE 없음 |
| In-mesh 목적지 | `envoy_internal_address` | `InternalUpstreamTransport` | 내부 리스너를 거쳐 HBONE 터널링 |
| Waypoint 목적지 | Service ClusterIP (`172.20.134.88:8080`) | `InternalUpstreamTransport` | Gateway → Waypoint → Pod |

### 케이스 1 — out-of-mesh: 아무 일도 일어나지 않는다

목적지 Pod가 메시에 등록되어 있지 않으면 endpoint에는 그냥 Pod IP `10.90.165.200:8080`이 실립니다. endpoint 메타데이터에 `envoy.transport_socket_match`의 `tunnel` 키가 없으므로 매칭 규칙에 따라 default인 **`tlsMode-disabled`(RawBuffer)** 가 선택됩니다. 평문으로 Pod에 바로 붙습니다. Ambient mode 클러스터 안에 있어도 enroll되지 않은 워크로드는 이 경로를 탑니다.

### 케이스 2 — in-mesh: endpoint가 IP가 아니다

목적지가 메시에 들어와 있으면 endpoint의 주소가 실제 네트워크 주소 대신 **`envoy_internal_address`** 로 바뀝니다. Envoy 프로세스 내부의 user space 통신을 가리키는 주소이고 `server_listener_name`으로 **`connect_originate`라는 이름의 internal listener**를 지정합니다. 최종 목적지 정보는 메타데이터(`endpoint_id`, `original_dst` 등)에 실려 함께 넘어갑니다.

endpoint 메타데이터에도 **`tunnel: http`** 가 함께 붙습니다. 클러스터의 `transport_socket_matches`가 이 키를 보고 `tlsMode-disabled` 대신 `InternalUpstreamTransport`를 고릅니다. **평문 직결이냐 HBONE이냐는 라우팅 규칙이 아니라 endpoint 메타데이터 한 줄이 정합니다.**

### 케이스 3 — waypoint: endpoint가 Service ClusterIP가 된다

목적지에 waypoint가 붙어 있으면 endpoint 주소가 **최종 Pod IP 대신 Service ClusterIP(`172.20.134.88:8080`)** 가 됩니다. 최종 Pod 선택을 waypoint가 담당하기 때문입니다. Gateway는 "이 서비스로 보내라"까지만 결정하고 어느 Pod로 갈지는 waypoint의 Envoy가 자기 라우팅 테이블로 정합니다. `workload` 메타데이터도 `istio-waypoint`를 가리킵니다.

{{< flow src="_flow/케이스-waypoint-endpoint-가.json" />}}

{{< callout type="important" >}}
같은 클러스터 이름을 보고 "이 서비스로 가는 트래픽은 다 똑같이 처리되겠지"라고 판단하면 Ambient mode에서는 틀립니다. 트러블슈팅에서 클러스터 정의만 보고 endpoint 덤프를 건너뛰면 out-of-mesh 평문 경로와 HBONE 경로를 구분할 수 없습니다.
{{< /callout >}}

## 4. HBONE을 이루는 Envoy 부품 세 개

`connect_originate` internal listener에 도착한 뒤가 HBONE의 본체입니다. 원문은 Envoy에 이미 있던 세 부품을 엮은 결과라고 결론짓습니다.

| 부품 | 하는 일 |
| --- | --- |
| `InternalUpstreamTransport` | endpoint→internal listener로 메타데이터(실제 destination 주소)를 통과시킨다 |
| `tcp_proxy`의 `tunneling_config` | HTTP/2 CONNECT 요청을 만든다 |
| `UpstreamTlsContext` | 터널 위에 mTLS를 수립한다 |

`InternalUpstreamTransport`가 맡는 건 통로입니다. endpoint에서 internal listener까지 메타데이터를 통과시킵니다. 실제 destination 주소(`local: 10.90.165.200:8080`)도 이 경로를 타고 넘어갑니다. `tcp_proxy`의 `tunneling_config`에 설정된 hostname은 CONNECT 요청의 `:authority` 헤더가 됩니다. `UpstreamTlsContext`는 SPIFFE ID로 상대 워크로드 신원을 검증하고 ALPN은 `h2`로 협상합니다.

`connect_originate` 리스너 자체에는 **`original_dst` listener filter**가 걸려 있어 `InternalUpstreamTransport`로 넘어온 메타데이터에서 원래 목적지를 복원합니다. 그 위의 `tcp_proxy` 필터가 `connect_originate` 클러스터로 연결하면서 CONNECT를 발행합니다.

그 `connect_originate` 클러스터 자체도 일반 클러스터와 다릅니다. 타입이 `ORIGINAL_DST`인 특수 클러스터로, **EDS(Endpoint Discovery Service)를 쓰지 않습니다.** 정적으로 내려받은 endpoint 목록 대신 다운스트림 connection의 메타데이터에서 upstream host를 그때그때 결정합니다. 앞서 2절에서 본 `outbound|8080||ch-dropwizard-public...` 클러스터가 EDS로 endpoint를 받는 것과 대비됩니다.

마지막 조각이 포트입니다. `upstream_port_override: 15008`로 목적지 포트를 **ztunnel의 HBONE 수신 포트**로 덮어씁니다. 애플리케이션이 노출한 포트가 `8080`이어도 TCP 커넥션이 향하는 곳은 목적지 노드 ztunnel의 `15008`입니다. 원래의 `8080`은 CONNECT 요청 안쪽에 실려 터널 반대편에서 복원됩니다.

{{< seq src="_seq/4-hbone-을-이루는-envoy.json" />}}

세 줄로 줄이면 이렇습니다.

```text
InternalUpstreamTransport   → 메타데이터(원래 목적지)를 internal listener까지 전달
tcp_proxy.tunneling_config  → HTTP/2 CONNECT 생성, hostname을 :authority로
UpstreamTlsContext          → SPIFFE ID 기반 mTLS, ALPN h2
upstream_port_override:15008 → 실제 TCP 목적지를 ztunnel HBONE 포트로 override
```

사이드카 모드에서 표준 CRD로 안 되는 걸 [08 EnvoyFilter]({{< relref "../../08-envoyfilter-extension.md" >}})로 억지로 패치했던 것과 비교하면 Ambient mode는 같은 저수준 부품을 istiod가 정식 경로로 조립해 내려줍니다.

## 5. 받는 쪽 — ztunnel은 어떻게 Pod 안에 들어가는가

여기서부터는 Envoy config가 아니라 리눅스 네트워킹입니다. ztunnel은 DaemonSet이라 노드당 하나인데 원문은 그 프로세스가 **Pod 네트워크 네임스페이스 안에 listening 소켓을 갖는다**는 사실을 파고듭니다.

### istio-cni plugin과 node agent의 분업

| 컴포넌트 | 역할 |
| --- | --- |
| istio-cni plugin | 체인드 CNI 플러그인 — Pod 생성 이벤트를 감지해 node agent로 전달한다 |
| istio-cni node agent | Pod netns에 진입해 iptables 규칙을 설정, UDS로 ztunnel에 Pod 정보·netns FD 전달 |
| ztunnel | 전달받은 netns FD로 Pod 네임스페이스 안에 직접 listening 소켓을 생성한다 |

결과가 직관에 반합니다. **Pod 안에서 localhost의 `15001`·`15006`·`15008`에 listening 소켓이 보이지만 이 소켓을 소유한 건 Pod의 컨테이너가 아니라 ztunnel DaemonSet 프로세스입니다.** 원문의 표현대로 ztunnel 프로세스는 Node level에서 동작하고 소켓만 Pod 네트워크 안에 만듭니다.

Ambient mode는 이렇게 "사이드카 없음"을 달성했습니다. 파드에 컨테이너를 추가하지 않고도 파드 네임스페이스에서 트래픽을 받습니다. 파드마다 Envoy를 하나씩 두어 [컨트롤 플레인 부하와 커넥션 수를 키웠던]({{< relref "../../09-istiod-scaling-connections.md" >}}) 사이드카 모드와 대비됩니다.

{{< callout type="warning" >}}
원문은 세 포트가 Pod 네임스페이스에 열린다는 사실까지만 밝히고 `15001`·`15006`·`15008` 각각의 역할을 항목별로 정의하지는 않습니다. 본문에서 명시적으로 확인되는 건 **egress가 `15001`로 REDIRECT되고 HBONE 터널이 `15008`로 수신된다**는 것입니다. `15006`의 용도는 원문 범위 밖입니다.
{{< /callout >}}

### iptables: 두 개의 체인

istio-cni node agent가 Pod 네임스페이스에 심는 규칙은 방향별로 체인이 나뉩니다.

| 방향 | 훅 | 체인 | 동작 |
| --- | --- | --- | --- |
| Ingress | `PREROUTING` | `ISTIO_PRERT` | Pod으로 들어오는 모든 TCP 트래픽이 이 체인을 거친다 |
| Egress | `OUTPUT` | `ISTIO_OUTPUT` | 모든 TCP 송신을 ztunnel의 `15001`로 REDIRECT한다 |

ztunnel은 `15001`로 받은 트래픽에 HBONE 캡슐화를 적용한 뒤 목적지로 보냅니다. 원문은 이 두 체인의 존재와 리다이렉트 목적지까지만 설명하고 규칙 한 줄 한 줄의 매칭 조건은 나열하지 않습니다. **모든 REDIRECT 규칙에 `! --mark 0x539` 조건이 붙어 있다**고는 명시합니다.

### 패킷 마킹: `0x539`와 `0x111`

리다이렉션을 무조건 걸면 ztunnel이 내보낸 패킷이 다시 ztunnel로 돌아오는 무한루프가 생깁니다. 마크 두 개가 이걸 막습니다.

| 마크 | 종류 | 언제 붙나 | 무엇을 막나 |
| --- | --- | --- | --- |
| `0x539` | packet mark | ztunnel 발신 패킷에 설정 | REDIRECT 우회 — 무한루프 방지 |
| `0x111` | connection mark (connmark) | ztunnel→앱 전달 시 `PREROUTING`에서 커넥션에 기록 | 응답 패킷의 리다이렉트 방지 |

REDIRECT 규칙은 전부 `! --mark 0x539`를 달고 있어 ztunnel 발신 패킷은 리다이렉션을 우회합니다. `0x111`은 ztunnel이 `mark 0x539`로 앱에 트래픽을 전달할 때 기록되며 앱이 같은 커넥션으로 보내는 응답 패킷까지 리다이렉트에서 제외됩니다.

{{< seq src="_seq/패킷-마킹-0x539-와.json" />}}

### `169.254.7.127` — health check를 트래픽에서 떼어내기

`169.254.7.127`은 **kubelet health check probe를 가려내는 SNAT IP**입니다. kubelet이 보내는 probe는 메시 정책·mTLS의 대상이 아니어야 하는데 노드에서 오는 평범한 TCP라 일반 트래픽과 구분이 안 됩니다. 이 링크로컬 주소로 SNAT해 두면 iptables 규칙이 probe를 식별해 리다이렉션에서 뺄 수 있습니다. 원문은 이 상수를 istio/istio 저장소의 `cni/pkg/nodeagent/options.go:44`로 연결합니다.

## 6. 요청 하나의 전체 여정

원문은 마지막에 지금까지 따라온 config 조각들을 하나의 경로로 다시 꿰맵니다.

| # | 단계 | 관여하는 설정 |
| --- | --- | --- |
| 1 | 요청이 Gateway Listener에 도착 | `0.0.0.0:443` 리스너, `HttpConnectionManager` |
| 2 | Route에서 Virtual Host를 매칭해 Cluster 결정 | RDS의 `http.443` → `outbound` 클러스터 (`Host: api.channel.io` 매칭) |
| 3 | `connect_originate` internal listener로 연결 | endpoint의 `envoy_internal_address` |
| 4 | `tcp_proxy`가 HTTP/2 CONNECT·mTLS로 HBONE 터널 완성 | `tunneling_config`, `UpstreamTlsContext`, port override |
| 5 | destination node Pod netns 안에서 ztunnel `15008` 소켓이 수신 | 크로스 네임스페이스 소켓, `ISTIO_PRERT` |
| 6 | HBONE 디캡슐레이션 후 애플리케이션 Pod에 전달 | 마크 `0x539` 부착, 커넥션에 `0x111` connmark 기록 |

## 7. 이 해부가 실무에서 쓰이는 곳

원문은 여기서 3편을 예고합니다. Ambient mode를 프로덕션에 적용하면서 만난 이슈들, 특히 **503 에러와 Half-Open(stale) Connection 문제**를 어떻게 추적하고 해결했는지가 다음 주제입니다. 그 추적의 전제가 이 문서입니다. 경로의 어느 홉에서 커넥션이 끊겼는지 판단하려면 그 홉이 Gateway Envoy의 internal listener인지, HBONE 터널의 HTTP/2 스트림인지, ztunnel의 `15008` 소켓인지를 먼저 구분할 수 있어야 합니다.

이어지는 실전 문서는 [03-1 503과 Half-open Connection]({{< relref "03-1-503-half-open-connection.md" >}})입니다.

## 이 문서에서 가져갈 것

- 경로 분기는 클러스터가 아니라 **endpoint 메타데이터**에서 일어납니다. 클러스터 이름 하나(`outbound|8080||ch-dropwizard-public.channel.svc.cluster.local`) 아래에서 `tunnel: http` 유무와 `transport_socket_match`가 평문 직결·HBONE·waypoint 경유를 나눕니다. 디버깅할 때는 endpoint 덤프까지 내려가야 합니다.
- HBONE은 기존 Envoy 부품의 조합입니다. `InternalUpstreamTransport`(메타데이터) + `tunneling_config`(CONNECT) + `UpstreamTlsContext`(mTLS) + `upstream_port_override: 15008`. 각 부품을 따로 알고 있으면 config 덤프가 읽힙니다.
- waypoint가 붙으면 Gateway의 endpoint에는 Pod IP 대신 **Service ClusterIP**가 실린다. 최종 Pod 선택 책임이 waypoint로 넘어가기 때문에, "Gateway가 어느 Pod로 보냈나"는 Gateway config에서 찾아도 나오지 않습니다.
- "사이드카가 없다"는 **파드에 컨테이너를 추가하지 않는다**는 뜻입니다. ztunnel은 netns FD를 받아 Pod 네임스페이스 안에 직접 소켓을 만듭니다. 파드 안에서 보이는 `15001`·`15006`·`15008` 소켓의 소유자는 노드의 ztunnel DaemonSet입니다.
- 투명 리다이렉션의 난이도는 **루프 방지**에 있습니다. 패킷 마크 `0x539`로 ztunnel 발신 패킷을 REDIRECT에서 빼고 connmark `0x111`로 커넥션 상태를 기억해 응답 패킷까지 빼야 "투명"해집니다. 리다이렉션 기반 인터셉션을 직접 만들 일이 있다면 이 두 겹이 최소 요건입니다.

## 소스

- **원문**: [Istio 2편: Envoy config로 해부하는 Ambient mode](https://tech.channel.io/kr/articles/tech-istio-envoy-config-c5193569) (채널코퍼레이션 기술 블로그, 2026-04-14)
- [Istio — Ambient mode traffic redirection](https://istio.io/latest/docs/ambient/architecture/traffic-redirection/) · 원문이 iptables 리다이렉션 설명에 인용
- [Ambient Mesh docs — Configure waypoints: Istio ingress gateway](https://ambientmesh.io/docs/setup/configure-waypoints/#istio-ingress-gateway) · 원문이 Gateway와 waypoint 연동 설명에 인용
- [istio/istio — `cni/pkg/nodeagent/options.go`](https://github.com/istio/istio/blob/master/cni/pkg/nodeagent/options.go) · 원문이 `169.254.7.127` SNAT IP 상수의 출처로 인용 (44행)
- 이 문서가 다루지 못한 부분: 원문에 실린 Envoy config 덤프와 iptables 규칙의 **원본 전문**은 옮기지 않았습니다. 각 필드가 무엇을 하는지는 위에 정리했지만 규칙 한 줄 단위의 매칭 조건과 순서는 원문에서 직접 확인해야 합니다.
