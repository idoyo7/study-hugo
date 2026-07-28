---
title: "요청 경로 해부"
weight: 11
---

# 11 · 요청 경로 해부 — 요청 하나가 지나는 길과, 그 길을 만드는 배선

{{< callout type="info" >}}
**한눈에**
- istiod는 요청 경로 위에 없다. 파드 안의 **istio-agent가 부트스트랩·인증서·xDS를 모두 중계**하고, Envoy는 istiod에 직접 연결하지 않는다.
- 남북 경로에서 클라우드 LB는 L4로만 넘긴다. **요청이 처음 L7이 되는 곳은 게이트웨이 Envoy**이고, 거기서 TLS가 끝나고 `VirtualService` 라우트가 걸린다.
- 동서 경로는 iptables가 아웃바운드를 `:15001`, 인바운드를 `:15006`으로 꺾는다. 프로토콜을 판별하지 못하면 **평문 TCP로 취급**되어 L7 기능이 통째로 사라진다.
- **L7 파싱 지점이 곧 메트릭·재시도·라우팅이 생기는 지점**이다. 게이트웨이를 경유하는 메시 내부 호출이면 한 요청에 그 지점이 세 곳 생긴다.
- 게이트웨이와 사이드카는 같은 부품이다 — 같은 Envoy, 같은 istio-agent, 같은 포트 규약.
{{< /callout >}}

[01]({{< relref "01-mesh-basics.md" >}})은 메시가 두 평면으로 갈린다는 것을, [02]({{< relref "02-istiod-control-plane.md" >}})는 istiod가 왜 CPU를 먹는지를, [03]({{< relref "03-gateway-node-isolation.md" >}})은 게이트웨이를 왜 노드로 격리하는지를 다뤘다. 셋 다 맞지만, 셋을 따로 읽으면 **"그래서 요청 하나가 실제로 어디를 지나는가"**가 남지 않는다. 이 문서는 그 조각들을 하나의 축 — 클라이언트에서 앱까지의 경로 — 위에 다시 배치한다. 각 조각의 깊은 설명은 해당 문서로 넘기고, 여기서는 **경로와 접점**만 본다.

> 관련 문서: [01 메시 기초]({{< relref "01-mesh-basics.md" >}}) · [02 컨트롤 플레인]({{< relref "02-istiod-control-plane.md" >}}) · [03 게이트웨이 격리]({{< relref "03-gateway-node-isolation.md" >}}) · [06 관측성]({{< relref "06-observability-points.md" >}})

## 1. 두 평면의 배선 — istiod는 데이터 경로 밖에 있다

"컨트롤 플레인은 트래픽이 지나지 않는 곳"이라는 말은 정확하지만, 그러면 설정과 인증서는 어떻게 프록시에 닿는가. 답은 파드 안에 Envoy만 있는 게 아니라는 것이다.

`istio-proxy` 컨테이너에는 **Envoy와 istio-agent(`pilot-agent`)가 함께 산다.** 공식 레퍼런스가 그 역할을 한 문장으로 못 박는다 — "Istio Pilot agent runs in the sidecar or gateway container and bootstraps Envoy." 사이드카든 게이트웨이든 같은 구조라는 것이 여기서 이미 드러난다.

agent가 하는 일은 셋이다.

- **부트스트랩** — Envoy가 뜨기 전에 설정 파일을 생성해, istiod 주소와 워크로드 identity를 심는다.
- **인증서** — 개인키와 CSR을 직접 만들어 자신의 credential과 함께 istiod에 보내고, 서명된 인증서를 받아 **UDS 위의 SDS API로** Envoy에 공급한다(소켓 경로 `/var/run/secrets/workload-spiffe-uds/socket`). Envoy는 istiod의 CA와 말을 섞지 않는다.
- **xDS 중계** — Envoy는 agent가 여는 UDS에 붙고, agent가 그 xDS 요청을 istiod로 프록시한다.

{{< seq caption="파드가 뜰 때 istio-agent가 순서대로 배선하는 것들 — Envoy는 istiod와 직접 연결되지 않는다." >}}
{
  "participants": [
    {"id": "E", "label": "Envoy"},
    {"id": "A", "label": "istio-agent"},
    {"id": "D", "label": "istiod :15012"}
  ],
  "steps": [
    {"note": ["E", "A"], "lines": ["istio-proxy 컨테이너 하나 안에 둘이 같이 있다"]},
    {"msg": ["A", "E"], "label": "1. 부트스트랩 설정 생성 후 기동"},
    {"msg": ["A", "D"], "label": "2. 개인키·CSR + 워크로드 credential"},
    {"msg": ["D", "A"], "label": "3. 서명된 인증서", "dashed": true},
    {"msg": ["E", "A"], "label": "4. SDS 요청 (UDS)"},
    {"msg": ["A", "E"], "label": "5. 인증서·키", "dashed": true},
    {"msg": ["E", "A"], "label": "6. xDS 요청 (UDS)"},
    {"msg": ["A", "D"], "label": "7. xDS 중계"},
    {"msg": ["D", "A"], "label": "8. CDS·EDS·LDS·RDS", "dashed": true},
    {"msg": ["A", "E"], "label": "9. 그대로 전달", "dashed": true},
    {"note": ["A", "D"], "lines": ["agent는 여러 gRPC 스트림을 TCP 커넥션 하나에 모은다"]}
  ]
}
{{< /seq >}}

xDS 종류별로 무엇을 나르는지, 그 push가 왜 istiod CPU가 되는지는 [02]({{< relref "02-istiod-control-plane.md" >}})에 있다. 여기서 중요한 건 **연결의 모양**이다. 프록시 하나가 istiod에 대해 갖는 것은 장수 커넥션 하나이고, 그 커넥션은 Envoy가 아니라 agent가 들고 있다. [09]({{< relref "09-istiod-scaling-connections.md" >}})에서 "replica를 늘려도 기존 커넥션이 안 옮겨간다"고 할 때의 그 커넥션이 이것이다.

{{< callout type="important" >}}
**게이트웨이 파드에도 같은 구조가 그대로 들어간다.** [03]({{< relref "03-gateway-node-isolation.md" >}})이 "게이트웨이는 독립적으로 뜬 Envoy"라고 한 것의 정확한 의미는, 사이드카와 **동일한 컨테이너 구성**(Envoy + istio-agent)이 파드에 붙지 않고 자기 Deployment로 뜬 것이라는 뜻이다. 설정도 같은 xDS로 받는다 — `istioctl proxy-config`를 사이드카에 쓰던 그대로 게이트웨이 파드에 쓸 수 있는 이유다.
{{< /callout >}}

## 2. 남북 경로 — 요청이 처음 L7이 되는 곳

외부에서 들어오는 요청은 클라우드 LB부터 시작한다. 여기서 자주 어긋나는 기대가 하나 있다: **NLB는 L4다.** TLS도, HTTP 헤더도 LB에서는 아무 일도 일어나지 않는다. 요청이 HTTP로 해석되는 첫 지점은 게이트웨이 Envoy다.

게이트웨이 Envoy가 무엇을 할지는 두 CRD가 나눠 정한다.

- **`Gateway`** — "어떤 포트를 어떤 프로토콜·호스트·TLS로 받을지". 공식 레퍼런스는 이를 "the properties of the proxy on a given load balancer port"로 서술하고, "Istio will configure the proxy to listen on these ports"라고 못 박는다. 즉 **리스너를 만드는 것**이 `Gateway`다.
- **`VirtualService`** — `gateways` 필드로 그 `Gateway`에 바인딩되어, 받은 요청을 어디로 보낼지 정한다. 필드 설명 그대로 "The names of gateways and sidecars that should apply these routes"다. 이 필드를 비우면 기본값이 `mesh`라서 **메시의 모든 사이드카에** 규칙이 걸린다 — 게이트웨이용 라우트를 만들면서 `gateways`를 빠뜨리는 것이 전형적인 사고다.

(Envoy 용어로는 앞이 LDS, 뒤가 RDS다. 다만 Istio 문서 자체는 이 두 CRD를 설명할 때 LDS/RDS라는 xDS 이름을 쓰지 않는다 — 개념 대응일 뿐 문서상의 명칭은 아니다.)

TLS 종료도 이 지점이다. `Gateway`의 `tls.credentialName`이 Kubernetes Secret 이름을 가리키고, 그 Secret은 **`Gateway` CR이 아니라 게이트웨이 워크로드가 도는 네임스페이스**에 있어야 한다. 기본 인그레스 게이트웨이는 `istio-system`에서 돌기 때문에 실무에서는 대개 같은 결과가 되지만, `selector`로 다른 네임스페이스의 게이트웨이를 가리키는 순간 이 구분이 살아난다. 이 인증서의 출처는 1절과 다르다 — CSR로 istiod에게 서명받는 워크로드 인증서가 아니라 `credentialName`이 가리키는 K8s Secret 그 자체다. 다만 **전달 방식**은 1절과 같다: 게이트웨이 파드의 agent가 그 Secret을 SDS로 Envoy에 밀어 넣는다.

{{< seq caption="LB는 L4로만 넘기고, TLS 종료·HTTP 파싱·라우팅은 전부 게이트웨이 Envoy에서 일어난다." >}}
{
  "participants": [
    {"id": "L", "label": "NLB"},
    {"id": "G", "label": "gateway Envoy"},
    {"id": "S", "label": "사이드카 :15006"},
    {"id": "P", "label": "앱 컨테이너"}
  ],
  "steps": [
    {"msg": ["L", "G"], "label": "1. TCP :443 — 여기까지 L4"},
    {"note": ["L", "G"], "lines": ["Gateway CRD가 이 포트의 리스너를 만들고", "credentialName이 가리킨 Secret이 SDS로 실려 와 있다"]},
    {"msg": ["G", "S"], "label": "2. TLS 종료 → HTTP 파싱 → 라우트 선택"},
    {"note": ["G", "S"], "lines": ["VirtualService의 gateways 필드로 바인딩된 라우트가 여기서 걸린다"]},
    {"msg": ["G", "S"], "label": "3. 다시 mTLS로 감싸 파드 IP :15006"},
    {"msg": ["S", "P"], "label": "4. 복호화된 평문 · localhost"},
    {"msg": ["P", "S"], "label": "5. 응답", "dashed": true},
    {"msg": ["S", "G"], "label": "6. mTLS 응답", "dashed": true},
    {"msg": ["G", "L"], "label": "7. TLS 응답", "dashed": true}
  ]
}
{{< /seq >}}

게이트웨이에서 TLS를 끝냈다고 뒤가 평문인 것은 아니다. 자동 mTLS가 켜져 있으면 게이트웨이 Envoy도 **클라이언트 프록시로서** 백엔드에 mTLS를 시작하고, 목적지 사이드카의 `:15006`이 그것을 받는다. 즉 요청은 게이트웨이에서 한 번 벗겨졌다가 곧바로 다시 감싸진다.

{{< callout type="info" >}}
**두 가지는 공식 문서 인용이 아니다.** ① 자동 mTLS를 서술하는 공식 문장은 "client proxies"를 대상으로 말할 뿐 인그레스 게이트웨이를 콕 집은 예시를 들지는 않는다 — 게이트웨이도 Envoy 클라이언트 프록시라는 사실에서 따라오는 추론이다. ② "Service의 ClusterIP를 지나지 않고 EDS로 받은 파드 IP로 직행한다"는 것도 Istio/Envoy 아키텍처상 잘 알려진 동작이지만, istio.io 문서에서 그렇게 명시한 문장은 찾지 못했다. 운영 중인 클러스터에서 확인하려면 `istioctl proxy-config endpoint`로 게이트웨이가 들고 있는 엔드포인트가 파드 IP인지 직접 보는 편이 빠르다.
{{< /callout >}}

## 3. 동서 경로 — 사이드카 두 개와 프로토콜 판별

메시 안의 호출은 게이트웨이를 지나지 않는다. 대신 **양쪽 파드의 사이드카를 하나씩** 지난다. 앱은 `http://svc-b:8080`을 평범하게 호출했다고 믿지만, 파드 네트워크 네임스페이스의 iptables 규칙이 그 커넥션을 로컬 Envoy로 꺾는다([01]({{< relref "01-mesh-basics.md" >}})의 그 가로채기). 이 문서에서 새로 볼 것은 꺾인 다음이다 — 사이드카가 그 커넥션을 HTTP로 볼지 TCP로 볼지 어떻게 정하는가.

{{< flow caption="아웃바운드는 :15001, 인바운드는 :15006. 가운데서 프로토콜 판별에 실패하면 경로가 TCP proxy로 갈린다." >}}
{
  "nodes": [
    { "id": "A", "col": 0, "row": 0, "label": "앱", "sub": "http://svc-b:8080", "kind": "src" },
    { "id": "I", "col": 1, "row": 0, "label": "iptables", "sub": "아웃바운드 REDIRECT", "kind": "proc" },
    { "id": "O", "col": 2, "row": 0, "label": "사이드카 outbound", "sub": ":15001 · 프로토콜 판별", "kind": "proc" },
    { "id": "H", "col": 3, "row": 0, "label": "HTTP 필터 체인", "sub": "라우팅 · 재시도 · 요청 메트릭", "kind": "proc" },
    { "id": "T", "col": 3, "row": 1, "label": "TCP proxy", "sub": "바이트만 중계 · L7 기능 없음", "kind": "query" },
    { "id": "R", "col": 4, "row": 0, "label": "상대 :15006", "sub": "mTLS 종단 → 앱 localhost", "kind": "sink" }
  ],
  "edges": [
    { "from": "A", "to": "I", "label": "가로채기", "rate": 620 },
    { "from": "I", "to": "O", "label": ":15001", "rate": 620 },
    { "from": "O", "to": "H", "label": "판별 성공", "rate": 620 },
    { "from": "O", "to": "T", "label": "판별 실패 · server-first", "rate": 900 },
    { "from": "H", "to": "R", "label": "mTLS", "rate": 620 },
    { "from": "T", "to": "R", "label": "mTLS", "rate": 900 }
  ]
}
{{< /flow >}}

### 프로토콜은 어떻게 정해지나

Istio가 이 커넥션을 HTTP로 볼지 그냥 TCP로 볼지는 세 가지가 순서대로 정한다.

| 순위 | 근거 | 비고 |
|---|---|---|
| 1 | Service 포트의 **`appProtocol`** | 공식 문서 명시: "appProtocol takes precedence over the port name" |
| 2 | Service 포트의 **이름 규약** | `name: <protocol>[-<suffix>]` — `http`, `http2`, `https`, `tcp`, `tls`, `grpc`, `grpc-web`, `mongo`, `mysql`, `redis` |
| 3 | **자동 감지** | 문서 표현 그대로 "Istio can automatically detect HTTP and HTTP/2 traffic" |

그리고 실패했을 때의 규칙이 이 절의 핵심이다. **"If the protocol cannot automatically be determined, traffic will be treated as plain TCP traffic."** 평문 TCP로 떨어지면 라우팅 규칙도, 재시도도, HTTP 메트릭도 함께 사라진다. [06]({{< relref "06-observability-points.md" >}})에서 "모든 서비스가 같은 언어로 말한다"고 한 그 지표가, 이 한 줄 때문에 특정 서비스에서만 비어 있을 수 있다.

특히 **server-first 프로토콜**(MySQL 등, 서버가 먼저 바이트를 보내는 것)은 자동 감지와 근본적으로 호환되지 않는다고 문서가 명시한다. 이런 포트는 감지에 맡기지 말고 이름이나 `appProtocol`로 못 박아야 한다.

{{< callout type="important" >}}
**공식 문서가 명시하지 않는 것들.** Envoy가 커넥션의 첫 바이트를 얼마나 읽어 판별하는지, 판별에 타임아웃이 있는지는 istio.io의 Protocol Selection 문서나 현재 MeshConfig 레퍼런스에서 확인되지 않는다. iptables 쪽도 마찬가지다 — 공식 문서는 "Istio CNI plugin configures the namespace's iptables"와 "CNI를 쓰지 않으면 파드에 `NET_ADMIN`·`NET_RAW` capability가 필요하다"까지만 말하고, `ISTIO_OUTPUT` 같은 체인 이름은 현재 docs 트리에 없다. 체인 이름과 정확한 REDIRECT 규칙은 istio/istio GitHub 위키와 2019년 istio.io 블로그에만 있는데, **그 블로그는 인바운드도 `:15001`로 리다이렉트한다고 서술**해 지금의 15001/15006 분리와 어긋난다. 구버전 설명이므로 그대로 인용하지 말 것.
{{< /callout >}}

### mTLS는 무엇으로 상대를 식별하나

사이드카끼리의 mTLS는 X.509 인증서의 SAN(URI)에 담긴 **SPIFFE ID**로 서로를 식별한다. 포맷이 고정되어 있다.

```
spiffe://<trust-domain>/ns/<namespace>/sa/<service-account>
```

설치할 때 지정하지 않았다면 trust domain은 `cluster.local`이다. 워크로드의 정체성이 파드 이름이나 IP가 아니라 **네임스페이스 + 서비스 어카운트**라는 점이 여기서 드러난다 — `AuthorizationPolicy`가 principal로 무엇을 받는지도 이 포맷이 이유다.

TCP 트래픽에서는 이 mTLS 위에 `istio-peer-exchange`라는 ALPN 프로토콜이 하나 더 얹힌다. 문서 표현대로 "advertised and prioritized by the client and the server sidecars in the mesh"이며, 이걸로 피어 메타데이터를 교환한다. **mTLS가 꺼져 있으면 이 교환도 안 되므로 TCP 지표의 상대 워크로드 라벨이 비게 된다.**

## 4. 요청이 L7이 되는 지점 = 기능이 생기는 지점

앞의 두 절을 겹쳐 보면 규칙이 하나 나온다. **HTTP로 파싱되는 홉에서만 L7 기능이 생긴다.** 라우팅·재시도·타임아웃·`istio_requests_total`이 전부 그 지점에서 만들어진다. 그래서 "이 요청에 대해 L7 파싱이 몇 번 일어나는가"를 세면, 기능이 몇 번 걸리고 지연이 몇 번 추가되는지가 같이 나온다.

{{< flow caption="게이트웨이를 경유하는 메시 내부 호출 — 같은 요청이 세 번 HTTP로 파싱되고, 그때마다 지표가 따로 남는다." >}}
{
  "nodes": [
    { "id": "C", "col": 0, "row": 0, "label": "클라이언트 앱", "kind": "src" },
    { "id": "S1", "col": 1, "row": 0, "label": "소스 사이드카", "sub": "L7 ① reporter=source", "kind": "proc" },
    { "id": "G", "col": 2, "row": 0, "label": "게이트웨이 Envoy", "sub": "L7 ② 게이트웨이 지표", "kind": "proc" },
    { "id": "S2", "col": 3, "row": 0, "label": "목적지 사이드카", "sub": "L7 ③ reporter=destination", "kind": "proc" },
    { "id": "P", "col": 4, "row": 0, "label": "목적지 앱", "kind": "sink" }
  ],
  "edges": [
    { "from": "C", "to": "S1", "label": "가로채기", "rate": 620 },
    { "from": "S1", "to": "G", "label": "mTLS", "rate": 620 },
    { "from": "G", "to": "S2", "label": "mTLS", "rate": 620 },
    { "from": "S2", "to": "P", "label": "평문", "rate": 620 }
  ]
}
{{< /flow >}}

경우를 나누면 이렇다.

| 경로 | L7 파싱 지점 |
|---|---|
| 외부 → 인그레스 게이트웨이 → 파드 | 2 (게이트웨이, 목적지 사이드카) |
| 파드 → 파드 (동서 직결) | 2 (소스 사이드카, 목적지 사이드카) |
| 파드 → 내부 게이트웨이 → 파드 | 3 (소스 사이드카, 게이트웨이, 목적지 사이드카) |

이 개수를 istio.io가 세어주지는 않는다 — 각 홉이 Envoy라는 사실에서 나오는 산수다. 다만 **양쪽에서 지표가 따로 나온다는 것은 문서에 명시**되어 있다. 표준 메트릭의 `reporter` 라벨 정의가 그대로다: "It is set to `destination` if report is from a server Istio proxy and `source` if report is from a client Istio proxy or a gateway."

여기서 [06]({{< relref "06-observability-points.md" >}})과 [05]({{< relref "05-incident-intermittent-5xx.md" >}})가 이어진다.

- **같은 요청이 두 번(또는 세 번) 카운트된다.** 대시보드에서 `reporter`를 고정하지 않으면 요청 수가 배로 보인다.
- **두 리포트가 어긋나는 지점이 곧 홉의 경계다.** `reporter=source`에서는 5xx인데 `reporter=destination`에는 그 요청이 아예 없다면, 요청은 목적지 앱에 닿지도 못한 것이다. 05에서 `response_flags`로 홉을 가르던 작업의 절반은 이 라벨로 시작한다.
- **L7 파싱이 없는 홉에는 이 지표가 없다.** 3절의 TCP 강등이 관측성 구멍으로 나타나는 경로가 이것이다.

## 5. 포트 지도

경로를 따라가다 보면 결국 포트 번호를 외우게 된다. 한 번에 정리해 둔다. 아래는 전부 공식 "Requirements for pods and services" 표의 값이다.

### 사이드카·게이트웨이 (`istio-proxy` 컨테이너)

| 포트 | 프로토콜 | 용도 | 파드 내부 전용 |
|---|---|---|---|
| **15000** | TCP | Envoy admin (진단·설정 덤프) | ✅ |
| **15001** | TCP | Envoy outbound — 아웃바운드가 꺾여 들어오는 곳 | |
| **15006** | TCP | Envoy inbound — 상대 프록시·게이트웨이가 들어오는 곳 | |
| 15008 | HTTP/2 | HBONE mTLS 터널 (ambient) | |
| 15020 | HTTP | 병합된 Prometheus telemetry | |
| **15021** | HTTP | health check / readiness | |
| 15053 | DNS | DNS 프록시 | |
| **15090** | HTTP | Envoy Prometheus telemetry | |

15002(failure detection)·15004(debug)도 같은 표에 있다. [06]({{< relref "06-observability-points.md" >}})이 스크랩한다고 한 `:15020`은 Envoy 자체 지표(`:15090`)에 파드의 애플리케이션 지표를 합친 쪽이다.

### istiod

| 포트 | 프로토콜 | 용도 |
|---|---|---|
| 443 | HTTPS | 웹훅 서비스 포트 (컨테이너의 15017로 포워딩된다) |
| 15010 | gRPC | XDS·CA — **평문. 보안 네트워크 전용** |
| **15012** | gRPC | XDS·CA — TLS/mTLS. 프로덕션 권장 |
| **15014** | HTTP | 컨트롤 플레인 모니터링 ([02]({{< relref "02-istiod-control-plane.md" >}})의 `pilot_*` 지표) |
| 15017 | HTTPS | 웹훅 컨테이너 포트 |

1절의 agent가 CSR과 xDS를 보내는 곳이 `15012`다. `15010`이 같은 서비스를 평문으로도 제공한다는 것은, **막지 않으면 인증 없이 메시 설정을 받아갈 수 있는 경로가 열려 있다**는 뜻이기도 하다.

## 6. 같은 경로, 다른 배선 — ambient에서는

지금까지의 배선은 전부 사이드카 모드다. Ambient 모드가 `ztunnel`·`waypoint`로 부품을 바꾸는 이유와 구성은 [01]({{< relref "01-mesh-basics.md" >}})의 "사이드카 vs Ambient"에 있다. 이 문서 맥락에서 중요한 건, 부품이 바뀌면 앞서 셈한 것들이 그대로 안 옮겨간다는 점이다. "L7 파싱 지점 세 곳" 계산이 통째로 달라지고, `:15006` 대신 HBONE 터널의 `:15008`이 경로의 중심이 된다.

실제 Envoy config 덤프로 그 재배선을 따라간 기록은 [ambient/02 Envoy config로 해부하는 Ambient mode]({{< relref "ambient/02-envoy-config-anatomy.md" >}})에 있고, 왜 그렇게 바꾸려 했는지는 [ambient/01]({{< relref "ambient/01-why-ambient-mode.md" >}})에 있다.

## 이 문서에서 가져갈 것

- 파드 안에는 Envoy만 있는 게 아니다. **istio-agent가 부트스트랩·CSR·SDS·xDS를 전부 중계**하고, Envoy는 istiod에 직접 붙지 않는다. 게이트웨이 파드도 같은 구성이다.
- 요청이 **처음 HTTP로 해석되는 지점이 곧 기능이 붙는 지점**이다. 남북에서는 게이트웨이 Envoy, 동서에서는 `:15001`의 아웃바운드 리스너다.
- 그 해석에 실패하면 평문 TCP로 강등되어 라우팅·재시도·HTTP 지표가 함께 사라진다. **`appProtocol` 또는 포트 이름으로 못 박는 것이 관측성 구멍을 막는 가장 싼 방법**이다.
- `reporter=source`/`destination`은 같은 요청의 두 시선이다. 대시보드에서는 중복 계수의 원인이지만, 장애에서는 홉을 가르는 첫 도구다.

## 소스

- Istio 공식 문서 — **Requirements for pods and services** (사이드카·컨트롤 플레인 포트 표 전체): <https://istio.io/latest/docs/ops/deployment/application-requirements/>
- Istio 공식 문서 — **Protocol Selection** (`appProtocol` 우선순위, 포트 이름 규약, 자동 감지와 평문 TCP 강등, server-first 비호환): <https://istio.io/latest/docs/ops/configuration/traffic-management/protocol-selection/>
- Istio 공식 문서 — **Traffic Management (concepts)** ("Gateway configurations are applied to standalone Envoy proxies…"): <https://istio.io/latest/docs/concepts/traffic-management/>
- Istio 공식 레퍼런스 — **Gateway** / **VirtualService** (`servers`가 리스너를 정의, `gateways` 필드의 기본값 `mesh`): <https://istio.io/latest/docs/reference/config/networking/gateway/> · <https://istio.io/latest/docs/reference/config/networking/virtual-service/>
- Istio 공식 태스크 — **Secure Gateways** (`credentialName`과 Secret, gateway agent의 SDS 전달): <https://istio.io/latest/docs/tasks/traffic-management/ingress/secure-ingress/>
- Istio 공식 문서 — **Security (concepts)** (agent가 키·CSR 생성 → istiod 서명 → Envoy에 SDS로 전달): <https://istio.io/latest/docs/concepts/security/>
- Istio 공식 레퍼런스 — **pilot-agent** ("runs in the sidecar or gateway container and bootstraps Envoy"): <https://istio.io/latest/docs/reference/commands/pilot-agent/>
- Istio 공식 레퍼런스 — **Standard Metrics** (`reporter` 라벨 정의): <https://istio.io/latest/docs/reference/config/metrics/>
- Istio 공식 태스크 — **TCP telemetry collection** (`istio-peer-exchange` ALPN): <https://istio.io/latest/docs/tasks/observability/metrics/tcp-metrics/>
- Istio 공식 문서 — **SPIRE 통합** (SPIFFE ID 포맷 `spiffe://<trust.domain>/ns/<ns>/sa/<sa>`): <https://istio.io/latest/docs/ops/integrations/spire/>
- Istio 공식 문서 — **Authentication Policy** (자동 mTLS: 클라이언트 프록시가 알아서 mTLS로 보낸다): <https://istio.io/latest/docs/tasks/security/authentication/authn-policy/>
- Istio 공식 문서 — **Istio CNI plugin** (CNI가 네임스페이스 iptables를 구성한다는 서술까지만): <https://istio.io/latest/docs/setup/additional-setup/cni/>
- istio-agent 내부 구조(xDS 프록시가 여러 gRPC 스트림을 TCP 커넥션 하나로 모은다)는 istio/istio 소스 주석에서 확인한 것이다: <https://github.com/istio/istio/blob/master/pkg/istio-agent/xds_proxy.go>
