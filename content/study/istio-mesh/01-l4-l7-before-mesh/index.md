---
title: "01 한 번 맺은 연결은 길을 바꾸지 않는다 — 메시 이전의 L4와 L7"
description: "입구에서 요청을 나눠도 내부 호출이 한 파드에 쏠리는 까닭을 다룬다. 서비스 사이의 L4는 연결이 맺힐 때만 대상을 고르므로, 그 연결에 실린 요청을 다시 나누려면 L7 프록시가 필요하다."
date: 2026-11-07
lastmod: 2026-11-07
weight: 1
url: "/study/istio-mesh/01-l4-l7-before-mesh/"
aliases:
  - "/istio/mesh-traffic/01-l4-l7-before-mesh/"
---

# 01 · 한 번 맺은 연결은 길을 바꾸지 않는다 — 메시 이전의 L4와 L7

입구의 Ingress에서 경로별로 요청을 나눠도, 그 뒤 서비스 A가 B를 부르는 호출에는 그 규칙이 적용되지 않습니다. 내부 호출은 다시 ClusterIP로 향합니다. 메시 이전에는 HTTP를 읽는 L7 프록시가 주로 입구에 있었고, 서비스 사이는 연결 단위로 대상을 고르는 L4 구간이었습니다.

이 시리즈의 출발점은 사이드카가 없던 통신 경로입니다. 여기서 요청을 나누는 단위를 확인한 뒤, 게이트웨이와 프록시 사이를 지나 메시의 기능과 관측성으로 이어갑니다. 조사 기준은 2026-11-07 시점의 Istio 1.31.4, Kubernetes 1.37 문서입니다. Istio 안에서 두 계층을 어디에 배치하는지는 [L4와 L7 — 프록시는 어디에 있나]({{< relref "/platform/istio/cilium/01-l4-l7-proxy-placement/index.md" >}})에서 따로 비교합니다.

## 암호화된 요청이 NLB 앞에 내보이는 겉모습 {#암호화된-요청이-nlb를-지날-때}

클라이언트가 `GET /orders/42`를 보내도 L4 장비가 보는 것은 출발지 IP·포트와 목적지 IP·포트, 프로토콜입니다. HTTP 경로나 헤더는 읽지 않습니다. 연결이 맺힐 때 대상을 한 번 고르고, 이후 바이트는 연결이 끝날 때까지 같은 곳으로 보냅니다.

AWS NLB가 TCP 트래픽을 나누는 단위도 연결입니다. NLB는 프로토콜, 출발지·목적지 IP와 포트, TCP 시퀀스 번호로 만든 해시로 대상을 선택하며, AWS 문서는 연결 수명 동안 그 대상이 유지된다고 명시합니다.

TLS로 암호화된 연결을 NLB의 TCP 리스너가 받으면 바이트를 풀지 않고 대상에 넘깁니다. 인증서를 가진 백엔드가 TLS를 끝내는 경로입니다. NLB에는 HTTP 경로가 보이지 않습니다.

NLB에 TLS 리스너를 두면 종료 위치가 달라집니다. 이번에는 NLB가 인증서로 TLS를 끝냅니다. 그래도 NLB는 L4 장비이므로 HTTP 경로에 따라 요청을 나누지는 않습니다.

ALB와 Ingress는 입구에서 TLS를 종료한 뒤 HTTP 요청을 읽습니다. 암호화된 요청의 경로를 보려면 먼저 복호화해야 하므로, L7 기능을 쓸 수 있는 위치는 TLS 종료 위치와 거의 겹칩니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| NLB TCP 리스너는 복호화 없이 대상에 전달, TLS 리스너는 서버 인증서로 프런트 연결을 종료 | AWS ELB 문서 | [NLB 리스너](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-listeners.html) |
| NLB는 mTLS를 지원하지 않으며, 필요하면 TCP 리스너로 대상에서 구현 | 같은 문서 | 같은 문서 |
| ALB HTTPS 리스너는 인증서로 연결을 종료하고 요청을 복호화 | AWS ELB 문서 | [ALB 소개](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html) |
| Ingress는 443 단일 포트, 입구에서 TLS 종료, Service·파드 구간은 평문 | Kubernetes 1.37 문서 | [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) |
{{% /details %}}

## 앞뒤 연결 사이에서 요청의 길을 다시 고른다 {#앞뒤-연결을-나누면-요청마다-다시-고른다}

L7 프록시는 클라이언트와의 연결을 자신이 끝내고, HTTP 요청을 파싱한 뒤 백엔드로 가는 연결을 따로 엽니다. 앞쪽 연결 하나에 요청이 여러 개 실려 와도 뒤쪽에서는 요청마다 다른 백엔드를 고를 수 있는 배치입니다. 메서드·경로·Host·헤더가 선택 기준이 됩니다. 헤더를 고치거나 응답 상태 코드를 보고 다른 서버로 다시 보내는 일도 이 자리에서 가능합니다.

요청을 읽는 데에는 비용이 듭니다. L7 프록시는 HTTP를 이해해야 하므로 L4보다 처리 비용과 지연이 늘고, 자신이 아는 프로토콜만 해석합니다.

| 구분 | L4 | L7 |
|---|---|---|
| 보는 것 | IP·포트·프로토콜 | 메서드·경로·Host·헤더·상태 코드 |
| 고르는 시점 | 연결 수립 시 한 번 | 요청마다 |
| 대표 구현 | kube-proxy(ClusterIP), AWS NLB | nginx, AWS ALB, Ingress 컨트롤러 |
| 프로토콜 | 무엇이든 통과 | 아는 프로토콜만 해석 |

nginx에서는 `location`과 `proxy_pass`로 요청을 보낼 곳을 정합니다. AWS ALB는 리스너 규칙에 경로·Host·헤더·메서드·쿼리 문자열·출발지 IP를 조건으로 지정하는 방식입니다.

ALB에서 gRPC 호출을 나누려면 대상 그룹의 프로토콜 버전을 따로 설정해야 합니다. 대상에 보내는 기본 프로토콜은 HTTP/1.1입니다. gRPC로 설정한 대상 그룹에서는 package·service·method 단위로 호출을 나눕니다.

Kubernetes Ingress는 외부의 HTTP·HTTPS 요청을 클러스터 안으로 보내는 경로를 정의하는 API입니다. 임의의 포트나 프로토콜을 다루는 용도는 아닙니다. Kubernetes 문서는 Ingress API의 기능 추가가 멈췄으며 Gateway API를 권장한다고 적고 있습니다. 가장 널리 쓰이던 컨트롤러인 ingress-nginx는 2026년 3월에 유지보수를 마치고 은퇴했습니다.

이 설정들이 다루는 범위는 클러스터 입구입니다. 입구를 지난 서비스 사이 호출까지 같은 L7 처리를 받으려면 프록시의 배치가 달라져야 합니다. nginx 지시어와 Istio 리소스의 대응 관계는 [nginx에서 Istio로]({{< relref "/platform/istio/configuration/07-from-nginx-to-istio.md" >}})에 있습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| NLB는 OSI 4계층, ALB는 7계층에서 동작 | AWS ELB 문서 기준 | [NLB 소개](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html), [ALB 소개](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html) |
| L4 프록시는 처리가 적고 지연·비용이 낮다 | gRPC 블로그의 L3/L4 대 L7 비교 | [gRPC Load Balancing (2017)](https://grpc.io/blog/grpc-load-balancing/) |
| ALB 조건은 경로·Host·헤더·메서드·쿼리·출발지 IP, 기본 알고리즘 round robin(least outstanding requests, weighted random 선택 가능) | AWS ELB 문서 | [ALB 소개](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html), [ALB 대상 그룹](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html) |
| ALB는 기본적으로 대상에 HTTP/1.1로 보내고, gRPC 프로토콜 버전에서는 package·service·method로 라우팅 | gRPC·HTTP/2 버전은 HTTPS 리스너만, 클라이언트 HTTP/2 연결당 스트림 최대 128 | [ALB 대상 그룹](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html) |
| Ingress는 HTTP·HTTPS 경로만 노출, 임의 포트·프로토콜은 다루지 않음 | Kubernetes 1.37 문서 | [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) |
| Ingress API 동결, Gateway API 권장, 제거 계획은 없음 | 같은 문서 | 같은 문서 |
| ingress-nginx는 2026년 3월까지 best-effort 유지보수 후 은퇴, 이후 릴리스·보안 패치 없음 | Kubernetes 블로그(2025-11-11) | [Ingress NGINX Retirement](https://kubernetes.io/blog/2025/11/11/ingress-Nginx-retirement/) |
{{% /details %}}

## 입구 너머에서 다시 만나는 ClusterIP {#입구를-지난-서비스-호출은-다시-clusterip로}

서비스 A의 파드가 Service 이름으로 B를 호출하면 DNS가 ClusterIP를 돌려줍니다. 이 주소는 가상 IP입니다. 실제 파드로 패킷을 보내는 데에는 kube-proxy가 노드마다 설치한 규칙이 쓰입니다.

iptables 모드에서는 Service별 체인이 엔드포인트별 체인으로 이어집니다. 백엔드를 기본적으로 무작위로 고른 뒤, 엔드포인트 체인이 목적지 주소를 파드 IP로 DNAT합니다. Kubernetes 문서가 설명하는 선택 시점은 클라이언트가 Service의 가상 IP에 연결할 때입니다.

그 뒤에는 커널 conntrack이 기억한 변환을 따릅니다. 같은 연결로 요청을 계속 보내도 목적지 파드는 바뀌지 않습니다. iptables 모드에서 이 선택 규칙을 확인하는 명령은 아래와 같습니다.

```bash
# iptables 모드에서 Service 하나가 엔드포인트별 체인으로 갈라지는 모습
sudo iptables -t nat -L KUBE-SVC-XXXXXXXXXXXXXXXX -n
# 확률 규칙(statistic mode random)이 엔드포인트 수만큼 보인다
```

kube-proxy의 모드가 달라져도 선택 단위는 연결입니다. IPVS의 rr·lc도 새 연결을 어느 대상으로 보낼지 정하는 스케줄러입니다. Kubernetes 1.37에서 Linux 기본 모드는 여전히 iptables이며, 향후 nftables로 바뀔 예정입니다. IPVS는 1.35에서 deprecated됐고, 1.40부터 기본으로 꺼지며 1.43에서 제거될 예정입니다.

입구에서 끝난 것은 L7 처리만이 아닙니다. Kubernetes 문서가 설명하는 Ingress 경로는 TLS를 입구에서 끝내고 Service·파드 구간을 평문으로 둡니다. 메시 이전에 흔했던 배치입니다. 안쪽 통신을 다시 암호화하려면 백엔드마다 인증서를 배포하고 갱신해야 했으며, 서비스끼리 서로를 확인하는 상호 인증(mTLS)까지 하려면 그 작업이 서비스 수만큼 늘어났습니다.

입구의 L7 장비는 누가 보냈는지 알아도, 안쪽 서비스가 연결을 보낸 워크로드를 구별할 단서는 출발지 IP 말고는 마땅치 않았습니다. 파드 IP도 안정된 신원은 아닙니다. 재스케줄링 때마다 바뀌기 때문입니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| iptables 모드는 Service→엔드포인트 체인→DNAT, 기본 무작위 선택 | Kubernetes 1.37 문서 | [Virtual IPs and Service Proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/) |
| 선택 시점은 클라이언트가 VIP에 연결할 때 | 같은 문서 iptables 절 | 같은 문서 |
| 1.37 기본 모드 iptables, 향후 nftables로 변경 예고 | 업그레이드 전 모드를 명시하라고 권고 | 같은 문서 |
| IPVS deprecated(1.35), 1.40 기본 비활성, 1.43 제거 예정 | `KubeProxyIPVS` feature gate로 재활성 가능 | 같은 문서 IPVS 절 |
| nftables 모드는 커널 5.13 이상 필요 | Linux 전용 | 같은 문서 nftables 절 |
| NLB TCP 대상 선택은 5-튜플+시퀀스 번호 해시, 연결 수명 동안 대상 고정 | AWS ELB 문서 | [NLB 소개](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html) |
{{% /details %}}

## 늘어난 파드 앞에 발길이 뜸한 까닭 {#파드를-늘렸는데-새-파드가-노는-이유}

HTTP/1.1에서는 여러 요청을 함께 보내려면 연결을 여러 개 열어야 합니다. 연결 하나에는 한 번에 요청 하나만 실을 수 있기 때문입니다. 오래된 연결이 닫히고 새 연결이 열리는 동안 목적지를 다시 고르므로, 연결 단위로 나눠도 요청이 대체로 흩어졌습니다.

HTTP/2와 그 위의 gRPC는 연결을 오래 유지합니다. TCP 연결 하나에 여러 요청을 다중화해 연결 관리 비용을 줄이는 방식입니다. L4가 대상을 고를 기회는 연결이 맺힐 때뿐이어서, 이후 요청은 처음 선택한 파드로 계속 향합니다.

{{< flow src="_flow/3-l4-연결-고정.json" />}}

스케일아웃으로 파드를 늘려도 기존 연결의 목적지는 그대로입니다. 새 파드는 놀게 됩니다. 배포로 파드가 바뀔 때도 재접속이 몰린 쪽으로 다시 쏠립니다.

gRPC 제안서(A9)도 이 한계를 지적합니다. L4 로드밸런서가 나누는 단위는 TCP 연결이므로, HTTP/2 클라이언트가 연결을 열어 둔 동안에는 부하가 몰린 노드에서 RPC를 빼거나 새 노드로 옮기지 못합니다.

서버에서 연결 수명을 제한하면 L4가 다시 선택할 기회를 만들 수 있습니다. `MAX_CONNECTION_AGE`에 따라 GOAWAY를 보내고, 클라이언트가 재접속하면서 대상을 새로 고르게 하는 방식입니다. 쏠림을 시간으로 희석할 뿐입니다.

클라이언트가 직접 분산하는 방법도 쓰였습니다. headless Service로 DNS에서 파드 IP 목록을 받은 뒤 파드마다 연결을 열고 요청을 돌리는 방식이며, gRPC의 `round_robin`이 여기에 해당합니다. 해당 기능을 지원하는 클라이언트에서만 쓸 수 있고, 언어마다 구현하고 유지하는 부담이 남습니다.

서비스 사이에 L7 프록시를 두면 요청마다 대상을 고릅니다. 앞에서 본 연결 분리를 내부 호출에 적용한 경로입니다.

{{< flow src="_flow/3-l7-요청-분산.json" />}}

연결을 누가 관리하느냐에 따라 설계가 달라지는 다른 사례는 [커넥션 게이트웨이]({{< relref "/engineering/gateway/_index.md" >}}) 분류에서도 다룹니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| HTTP/2는 장수 연결 하나에 요청을 다중화, 연결 단위 분산이 무력화되고 요청이 파드 하나에 고정 | Kubernetes 블로그(2018-11-07, William Morgan) | [gRPC Load Balancing on Kubernetes without Tears](https://kubernetes.io/blog/2018/11/07/grpc-load-balancing-on-kubernetes-without-tears/) |
| HTTP/1.1은 연결당 동시 요청 1개, 연결이 순환해 연결 단위 분산이 "충분" | 같은 글 | 같은 글 |
| L4 LB는 RPC가 아니라 TCP 연결을 분산, 열린 HTTP/2 연결 때문에 부하 이동이 느림 | gRFC A9 | [A9 Server-side Connection Management](https://github.com/grpc/proposal/blob/master/A9-server-side-conn-mgt.md) |
| `MAX_CONNECTION_AGE` 기본값 무한, 만료 시 GOAWAY, ±10% 지터 | 같은 제안서 | 같은 제안서 |
| headless Service와 클라이언트 측 분산은 지원하는 gRPC 클라이언트에 한정 | Kubernetes 블로그 | 위 Kubernetes 블로그 |
| 클라이언트 측 LB는 언어별 구현·유지 부담 | gRPC 블로그 | [gRPC Load Balancing](https://grpc.io/blog/grpc-load-balancing/) |
{{% /details %}}

## 서비스마다 따로 닦던 재시도의 길 {#재시도-정책을-서비스마다-넣어야-했던-이유}

입구의 nginx는 `proxy_next_upstream`으로 요청을 다음 서버에 다시 보냅니다. 기본 조건은 `error timeout`입니다. POST·PATCH 같은 비멱등 요청은 이미 업스트림에 보냈다면 재전송하지 않습니다. 하지만 서비스 A가 B를 부르다 실패한 호출은 입구의 nginx를 지나지 않습니다.

그 호출의 실패 처리는 호출한 앱에 남습니다. 동서 구간이 L4뿐인 배치에서는 타임아웃, 재시도 횟수, 백오프, 서킷 브레이커를 앱 코드나 공용 라이브러리에 넣었습니다. 요청을 읽는 장비가 없는 내부 홉의 관측도 언어별 라이브러리에 기대는 방식이었습니다.

gRPC에서는 서비스 설정(service config)에 메서드별 재시도 정책을 적습니다.

```json
{
  "methodConfig": [{
    "name": [{ "service": "orders.OrderService" }],
    "retryPolicy": {
      "maxAttempts": 4,
      "initialBackoff": "0.1s",
      "maxBackoff": "1s",
      "backoffMultiplier": 2,
      "retryableStatusCodes": ["UNAVAILABLE"]
    }
  }]
}
```

이 방식은 잘 동작합니다. 여러 언어가 섞이면 같은 정책을 Java, Go, Python 클라이언트에 각각 넣고, 조금씩 다른 기본값과 의미까지 맞추는 비용이 커집니다. gRPC가 클라이언트 쪽에서 `maxAttempts`의 기본 상한을 5로 두는 것처럼, 상한도 라이브러리마다 따로 확인해야 합니다.

라이브러리의 수명도 서비스 코드에 영향을 줍니다. 한때 JVM 진영의 표준으로 쓰이던 Netflix Hystrix는 유지보수 모드에 들어갔으며, Netflix가 새 프로젝트에 권하는 선택지에는 resilience4j가 있습니다. 라이브러리를 교체하면 이를 사용하는 서비스도 모두 다시 빌드해야 합니다.

라이브러리와 메시를 리드타임으로 비교한 계산은 [왜 서비스 메시인가]({{< relref "/platform/istio/fundamentals/14-why-service-mesh/index.md" >}})에 있습니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| gRPC 재시도 정책은 service config에 메서드별로 정의, 백오프에 ±20% 지터 | 기본 재시도 정책은 없고 transparent retry만 동작 | [gRPC Retry 가이드](https://grpc.io/docs/guides/retry/) |
| `maxAttempts`는 클라이언트 쪽 기본 상한 5, 넘는 값은 5로 취급 | gRFC A6, 채널 인자로 상한 변경 가능 | [A6 Client Retries](https://github.com/grpc/proposal/blob/master/A6-client-retries.md) |
| Hystrix는 유지보수 모드, 새 프로젝트에는 resilience4j 등을 권장 | Netflix 저장소 README | [Netflix/Hystrix](https://github.com/Netflix/Hystrix) |
| `proxy_next_upstream` 기본 `error timeout`, 비멱등 요청은 업스트림 전송 후 재시도 안 함 | nginx 1.9.13 이후, `non_idempotent`로 허용 가능 | [ngx_http_proxy_module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) |
{{% /details %}}

## 호출의 양 끝에서 프록시가 마주 선다 {#호출하는-쪽과-받는-쪽에-프록시를-두기}

호출하는 앱 옆에 L7 프록시를 두면 HTTP/2 연결 하나에 실린 요청도 각각 다른 대상으로 보낼 수 있습니다. 받는 앱 옆에도 프록시가 있으면, 앱이 직접 처리하지 않고 두 프록시 사이를 mTLS로 암호화할 수 있습니다. 재시도와 타임아웃은 언어에 관계없이 프록시 설정 한 곳에 모입니다.

Istio 사이드카는 이 배치입니다. 입구에 머물렀던 L7 처리가 서비스 사이의 홉으로 들어옵니다.

Istio 문서에 따르면 Envoy의 기본 분산 방식은 least request이며, 요청마다 대상을 고릅니다. HTTP 요청이 실패하면 기본으로 두 번 재시도합니다. 앱 코드를 고치지 않고 얻는 동작입니다. HTTP 요청 타임아웃은 Istio 기본값에서 비활성 상태입니다.

프록시가 요청 경로에 들어오는 만큼 비용도 듭니다. 사이드카 모드에서는 요청이 클라이언트와 서버의 프록시 두 개를 지나므로 지연과 자원 사용이 늘어납니다. 이 비용 계산은 [왜 서비스 메시인가]({{< relref "/platform/istio/fundamentals/14-why-service-mesh/index.md" >}})에서 다룹니다.

{{% details title="근거와 출처" closed="true" %}}
| 주장 | 조건 | 출처 |
|---|---|---|
| Envoy 기본 분산은 least request(무작위 두 호스트 중 활성 요청이 적은 쪽) | Istio 1.31 문서, DestinationRule로 변경 가능 | [Istio Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/) |
| HTTP 요청 기본 재시도 2회, 재시도 간격 25ms 이상 자동 결정 | 같은 문서 | 같은 문서 |
| HTTP 요청 타임아웃은 Istio 기본값에서 비활성 | 같은 문서 | 같은 문서 |
| 사이드카 모드에서 요청은 클라이언트·서버 사이드카 두 개를 지난다 | Istio 성능 문서(벤치마크는 1.24 기준) | [Performance and Scalability](https://istio.io/latest/docs/ops/deployment/performance-and-scalability/) |
{{% /details %}}

다음 편 [02 게이트웨이에서 사이드카까지]({{< relref "/study/istio-mesh/02-gateway-to-sidecar/index.md" >}})에서는 외부 NLB를 출발해 Istio ingress gateway와 대상 파드의 사이드카까지 따라갑니다. 입구의 L7 프록시가 메시의 첫 홉이 되는 과정과, 이 경로에서 kube-proxy를 거치지 않게 되는 이유가 이어집니다. 사이드카 내부의 처리 순서는 [11 요청 경로 해부]({{< relref "/platform/istio/fundamentals/11-request-path-anatomy/index.md" >}})에서 먼저 확인할 수 있습니다.

## 참고 자료

- [Kubernetes — Virtual IPs and Service Proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/)
- [Kubernetes — Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)
- [Kubernetes 블로그 — gRPC Load Balancing on Kubernetes without Tears](https://kubernetes.io/blog/2018/11/07/grpc-load-balancing-on-kubernetes-without-tears/)
- [Kubernetes 블로그 — Ingress NGINX Retirement](https://kubernetes.io/blog/2025/11/11/ingress-Nginx-retirement/)
- [gRPC — Load Balancing](https://grpc.io/blog/grpc-load-balancing/)
- [gRPC — Retry 가이드](https://grpc.io/docs/guides/retry/)
- [gRFC A6 — Client Retries](https://github.com/grpc/proposal/blob/master/A6-client-retries.md)
- [gRFC A9 — Server-side Connection Management](https://github.com/grpc/proposal/blob/master/A9-server-side-conn-mgt.md)
- [AWS — Network Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html)
- [AWS — NLB 리스너](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-listeners.html)
- [AWS — Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html)
- [AWS — ALB 대상 그룹](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html)
- [nginx — ngx_http_proxy_module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Istio — Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/)
