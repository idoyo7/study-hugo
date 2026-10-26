---
title: "L7 프록시는 요청 단위 처리가 필요한 곳에만 둔다 — 30분 스터디 자료"
linkTitle: "네트워크 L4·L7 스터디"
description: "L7 프록시를 어디에 둘지는 요청 단위 처리가 필요한 트래픽의 범위로 정한다. 2026-10-26 기준으로 사이드카와 ambient의 비용·장애 사례를 연결해 프록시 배치 조건과 30분 발표 구성을 제시한다."
date: 2026-10-26
lastmod: 2026-10-26
weight: 50
url: "/kubernetes/network-l4-l7/"
---

# L7 프록시는 요청 단위 처리가 필요한 곳에만 둔다 — 30분 스터디 자료

## 같은 요청을 30분 동안 따라가기

파드 A가 `curl http://svc-b`를 실행하면 요청은 어디를 거칠까요?

Service와 Pod를 알아도 그 사이의 경로를 설명하려면 연결과 요청을 구분해야 합니다. L4(전송 계층)는 연결을 보낼 파드를 고르고 패킷을 옮깁니다. L7(응용 계층)은 연결 안의 HTTP 요청을 읽고 라우팅과 재시도를 처리합니다. HTTP를 읽는 프록시가 어디에 있느냐에 따라 요청이 지나는 길이 달라지고, 비용이 드는 곳과 장애를 찾아볼 곳도 달라집니다.

30분 발표에서는 같은 요청을 계속 따라갑니다. 패킷이 목적지에 도착하는 길을 설명한 뒤, 연결만 분산해서는 풀리지 않는 문제에서 프록시 이야기로 넘어가면 됩니다. 데모 시간은 표에 들어 있지 않고, 아래 데모 절에서 따로 조정합니다.

| 구간 | 시간 | 내용 |
|---|---|---|
| 도입 | 2분 | 질문 하나, 두 계층의 역할 |
| 1부 L4 | 12분 | 파드 네트워크 모델, 오버레이와 네이티브 라우팅, kube-proxy, Cilium eBPF |
| 2부 L7 | 12분 | L4로 못 하는 일, 사이드카, 비용, ambient, 경계 장애 |
| 정리·질의 | 4분 | 비교표, 결론 질문, 질문 받기 |

1부는 '파드 IP까지 패킷을 옮기는 길'부터 'Service는 연결을 보낼 파드를 고릅니다'까지, 2부는 '요청을 나누려면 HTTP를 읽어야 합니다'부터 '롤아웃에서 드러난 터널의 수명'까지입니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-26이며 Kubernetes 1.37.1, Cilium 1.20.4, Istio 1.31.3, Amazon VPC CNI v1.23.2 문서를 봤습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 조사 기준 버전 | Kubernetes 1.37.1(2026-09-15), Cilium 1.20.4(10-23), Istio 1.31.3(10-22), Amazon VPC CNI v1.23.2(09-30) | [Kubernetes 릴리스](https://kubernetes.io/releases/), [Cilium 릴리스](https://github.com/cilium/cilium/releases), [Istio 릴리스](https://github.com/istio/istio/releases), [VPC CNI 릴리스](https://github.com/aws/amazon-vpc-cni-k8s/releases) | `✓` |
| 저장소 기존 글의 버전 | Cilium 1.20.3, Istio 1.31.2 표기는 각각 한 단계 이전 판 | 위 릴리스 페이지와 [01 L4와 L7]({{< relref "/platform/istio/cilium/01-l4-l7-proxy-placement/index.md" >}}) | `✓` |
| Kubernetes 1.34 지원 종료 | 2026-10-27, 발표 다음 날 | [Kubernetes 릴리스](https://kubernetes.io/releases/) | `✓` |
| 시간 배분 | 2 / 12 / 12 / 4분 | 발표 구성안 | `Σ` |

{{% /details %}}

## 파드 IP까지 패킷을 옮기는 길

쿠버네티스 네트워크 모델은 파드마다 클러스터에서 유일한 IP를 부여하고, 같은 노드든 다른 노드든 파드끼리 NAT(주소 변환) 없이 직접 통신하도록 정합니다. 그 경로를 만드는 방법은 외부 구현체에 맡깁니다. 리눅스에서는 컨테이너 런타임이 CNI(컨테이너 네트워크 인터페이스)로 구현체를 호출하므로 보통 CNI 플러그인이라고 부릅니다. NetworkPolicy도 대개 같은 구현체가 집행합니다.

CNI 스펙 1.1.0은 ADD, DEL, CHECK, VERSION, GC, STATUS를 요구하며, 이 중 GC와 STATUS는 1.1.0에서 추가됐습니다. IP 관리를 다른 플러그인에 위임할 수도 있습니다. 위임 플러그인을 호출할 시점은 런타임이 아닌 메인 플러그인이 정합니다. 발표에서는 이 동작을 모두 설명하기보다, 쿠버네티스가 정한 통신 약속을 CNI 구현체가 지킨다는 관계를 잡아 두면 충분합니다.

### 노드를 잇는 망이 파드 주소를 아는지

Cilium은 별도 설정이 없으면 캡슐화 모드로 동작합니다. Cilium 문서가 요구 조건이 가장 적다고 설명하는 모드입니다. 노드들이 VXLAN(기본 8472/UDP)이나 Geneve(6081/UDP) 터널을 이루므로, 언더레이(노드를 잇는 망)가 PodCIDR(파드 IP 대역)을 몰라도 패킷을 전달할 수 있습니다. 캡슐화에는 MTU(패킷의 최대 전송 크기) 비용이 따릅니다. VXLAN을 쓰면 패킷마다 사용할 수 있는 공간이 50바이트 줄어듭니다.

네이티브 라우팅에서는 언더레이가 PodCIDR을 라우팅할 수 있어야 합니다. Cilium의 `routing-mode: native`로 켜며, 같은 L2 망에서는 `auto-direct-node-routes`로 라우트를 설정합니다. 그 밖의 환경에서는 BGP로 라우트를 배포하거나 라우터 쪽에서 처리합니다.

AWS 문서가 설명하는 EKS VPC CNI에는 오버레이가 없습니다. 파드가 VPC의 실제 IP를 받으며, 노드의 ipamd(aws-node DaemonSet)가 ENI(네트워크 인터페이스)와 warm pool을 관리합니다. 기본 Secondary IP 모드는 ENI의 secondary IP를 파드마다 하나씩 할당하므로 인스턴스 타입별 ENI 상한이 파드 수를 제한합니다. 최대 파드 수 계산식은 `ENI 수 × (ENI당 IP 수 − 1) + 2`입니다. 더하는 2는 kube-proxy와 aws-node 같은 hostNetwork 파드를 위한 값입니다.

Prefix delegation을 켜면 ENI 슬롯 하나에 IP 대신 /28 프리픽스(16개)를 할당합니다. 기본 max-pods는 여전히 secondary IP 모드를 기준으로 하므로, 파드 밀도를 높이려면 max-pods를 따로 지정해야 합니다.

| | 오버레이 (VXLAN/Geneve) | 네이티브 라우팅 | EKS VPC CNI |
|---|---|---|---|
| 파드 IP 공간 | 언더레이와 분리 | 언더레이가 라우팅 | VPC 주소 그 자체 |
| 언더레이 요구 | 노드 간 UDP 포트 하나 | PodCIDR 라우팅(BGP 등) | 없음(VPC가 처리) |
| 비용 | 캡슐화 오버헤드, MTU −50B | 라우트 관리 | VPC IP 소모, ENI 상한 |

여기까지는 목적지 파드 IP를 알 때 패킷을 보내는 방법입니다. 파드 A가 호출한 Service 주소를 어느 백엔드 파드 IP로 연결할지는 별도로 결정해야 합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 파드 IP 유일, NAT 없는 직접 통신 | 예외는 Windows hostNetwork 파드 | [Kubernetes 서비스·네트워킹](https://kubernetes.io/docs/concepts/services-networking/) | `✓` |
| CNI 스펙 동작 | 스펙 1.1.0에서 GC·STATUS 추가. v1.3.x 릴리스가 새 스펙 버전을 냈는지는 확인하지 못함 | [CNI SPEC.md](https://github.com/containernetworking/cni/blob/main/SPEC.md) | `✓` |
| Cilium 캡슐화·네이티브 라우팅 | VXLAN 8472/UDP, Geneve 6081/UDP, VXLAN 패킷당 50바이트 | [Cilium 라우팅](https://docs.cilium.io/en/stable/network/concepts/routing/) (stable 1.20.x) | `✓` |
| VPC CNI 동작 | 최대 파드 수 식, /28 프리픽스 16개, 파드 삭제 후 IP 30초 쿨다운, v1.9.0 이상에서 prefix delegation | [EKS VPC CNI 모범 사례](https://docs.aws.amazon.com/eks/latest/best-practices/vpc-cni.html), [Prefix mode](https://docs.aws.amazon.com/eks/latest/best-practices/prefix-mode-linux.html) | `Ⓥ` |
| 세 방식 비교표 | 위 출처를 종합한 표 | 위 출처 | `≈` |

{{% /details %}}

## Service는 연결을 보낼 파드를 고릅니다

Kubernetes의 Virtual IPs 문서는 ClusterIP의 동작을 DNAT(목적지 주소 변환)로 설명합니다. kube-proxy는 EndpointSlice를 보고 Service IP로 향하는 패킷의 목적지를 백엔드 파드 IP로 바꿉니다. EndpointSlice는 슬라이스 하나에 기본 100개까지 엔드포인트를 담으며, kube-proxy가 내부 트래픽을 라우팅할 때 기준으로 삼는 데이터입니다. 기존 Endpoints API는 1.33부터 deprecated여서 `kubectl get endpoints`를 실행하면 경고가 나옵니다.

DNAT 서술을 동작 원리로 풀면, 백엔드를 고르는 시점은 연결의 첫 패킷입니다. 이 결정은 conntrack(연결 추적) 항목에 저장되고, 같은 연결의 이후 패킷과 응답 패킷의 역변환도 그 항목을 따릅니다. 따라서 여기서 분산하는 단위는 연결입니다. iptables든 nftables든 Cilium이든 선택 단위가 달라지는지는 뒤에서 이어서 봅니다.

### kube-proxy 모드를 바꾸면 달라지는 것

Kubernetes 1.37의 기본 모드는 여전히 iptables입니다. AWS 문서에 따르면 nftables는 1.33에서 GA가 됐고 커널 5.13 이상을 요구합니다. 기본값 전환을 다루는 KEP-5343은 1.40 전환을 예정하고 있으나 아직 Alpha 단계 제안입니다. KEP-5343에 따르면 1.37부터는 모드를 지정하지 않으면 경고가 나오며, Kubernetes 문서는 업그레이드 중 모드가 바뀌지 않도록 명시할 것을 권합니다.

IPVS는 1.35부터 deprecated입니다. 1.40에서 기본으로 꺼지고 1.43에서 제거될 예정이므로, 발표에서 iptables의 대안을 IPVS로만 소개하면 현재 상태를 놓치게 됩니다.

iptables는 `KUBE-SERVICES` 체인을 순서대로 훑습니다. 새 연결의 첫 패킷 처리 시간은 서비스 수에 비례합니다. nftables는 verdict map 규칙 하나로 디스패치해 처리 시간이 대략 일정합니다. Kubernetes 문서는 이 패킷 처리 성능 차이를 체감하는 규모를 수만 개 서비스로 설명합니다.

모드 전환에는 버전과 커널 조건도 따라옵니다. AWS 문서는 nftables를 kube-proxy 1.36 이상에서 사용할 것을 권합니다. 1.36 미만에서는 엔드포인트가 수십만 개인 클러스터에서 규칙 동기화가 매우 느려지고 CPU soft lockup이 발생할 수 있었기 때문입니다.

커널 6.1 미만에는 Service IP로 맺은 장수 TCP 연결이 `Connection reset by peer`로 끊기는 conntrack 버그도 있습니다. iptables 모드는 우회 규칙을 설치하지만 nftables 모드는 기본으로 설치하지 않습니다. 해당 여부는 `iptables_ct_state_invalid_dropped_packets_total` 메트릭으로 확인하고, 필요하면 `--conntrack-tcp-be-liberal`을 켭니다.

### Cilium은 소켓에서 목적지를 바꿉니다

Cilium을 설치하는 것과 kube-proxy를 대체하는 것은 별개입니다. Helm 기본값은 `kubeProxyReplacement=false`이며, 이 상태에서는 ClusterIP의 클러스터 내부 로드밸런싱만 패킷 단위로 처리합니다. `true`로 켜야 kube-proxy를 대체하고, 필요한 커널 지원이 없으면 에이전트가 기동을 포기합니다.

대체 모드의 중심은 소켓 레벨 LB(로드밸런싱)입니다. eBPF(커널에서 실행되는 프로그램)가 `connect()`, `sendmsg()`, `recvmsg()` 시점에 목적지를 백엔드 주소로 바꾸므로 패킷마다 NAT를 하지 않아도 됩니다. Istio 사이드카와 함께 쓸 때는 `socketLB.hostNamespaceOnly=true`가 관련됩니다. 이 값에서는 파드 네임스페이스의 소켓 변환을 건너뛰고 veth의 tc LB로 처리합니다.

Maglev는 `loadBalancer.algorithm=maglev`로 켜며 기본값은 `random`입니다. Maglev 해싱의 적용 범위는 외부에서 들어오는 N-S 트래픽입니다. 파드 사이의 동서 트래픽은 connect 시점에 백엔드를 고릅니다. 파드 A의 요청을 따라갈 때 기억할 지점도 바로 이 선택 시점입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| kube-proxy 모드 현황 | 1.37 기본 iptables, nftables 커널 5.13 이상, ipvs 1.35 deprecated·1.40 기본 꺼짐·1.43 제거 | [Virtual IPs 문서](https://kubernetes.io/docs/reference/networking/virtual-ips/), [KEP-5495](https://www.kubernetes.dev/resources/keps/5495/) | `✓` |
| nftables GA 시점 | 1.29 alpha, 1.31 beta, 1.33 GA | [AWS nftables 문서](https://docs.aws.amazon.com/eks/latest/best-practices/nftables.html) | `Ⓥ` |
| nftables 기본값 전환 일정 | 1.37 경고, 1.39 beta, 1.40 기본 전환. 현재 Alpha·provisional | [KEP-5343](https://www.kubernetes.dev/resources/keps/5343/) | `✓` |
| iptables O(n), nftables 대략 O(1) | 성능 차이는 수만 개 서비스 규모에서 체감 | [nftables kube-proxy 블로그](https://kubernetes.io/blog/2025/02/28/nftables-kube-proxy/), Virtual IPs 문서 | `✓` |
| nftables는 kube-proxy 1.36 이상 권장 | 엔드포인트 수십만 개에서 동기화 지연·soft lockup, 커널 개선은 Linux 6.18 | [AWS nftables 문서](https://docs.aws.amazon.com/eks/latest/best-practices/nftables.html) | `Ⓥ` |
| 백엔드 선택은 첫 패킷, conntrack에 저장 | 문서에 이 문장은 없고 동작 원리를 설명한 것 | Virtual IPs 문서의 DNAT 서술 | `≈` |
| EndpointSlice | 슬라이스당 기본 100개, Endpoints API는 1.33부터 deprecated | [EndpointSlice 문서](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/), [deprecation 블로그](https://kubernetes.io/blog/2025/04/24/endpoints-deprecation/) | `✓` |
| 커널 6.1 미만 conntrack 버그 | nftables 모드는 우회 규칙 없음, `--conntrack-tcp-be-liberal`과 메트릭으로 확인 | Virtual IPs 문서 | `✓` |
| Cilium KPR·소켓 LB·Maglev | KPR Helm 기본값 `false`, Maglev는 N-S 한정, `maglev.tableSize` 기본 16381 | [Cilium kube-proxy 없는 구성](https://docs.cilium.io/en/stable/network/kubernetes/kubeproxy-free/) (1.20.4) | `✓` |

{{% /details %}}

## 요청을 나누려면 HTTP를 읽어야 합니다

연결 단위로 고르는 원리상, 패킷을 옮기는 방식을 바꿔도 요청 단위 처리가 생기지는 않습니다. L4 로드밸런서는 5-tuple(IP, 포트, 프로토콜)만 보므로 요청과 응답의 경계, 헤더, 상태 코드를 알 수 없습니다.

이 한계가 드러나는 사례가 gRPC 쏠림입니다. Kubernetes와 gRPC 블로그는 HTTP/2가 TCP 연결 하나를 오래 유지하면서 그 위에 요청을 다중화한다고 설명합니다. 연결이 한 파드에 맺어지고 나면 그 안의 요청도 계속 같은 파드로 갑니다. HTTP/1.1은 연결 하나에 요청 하나가 오가고 연결이 계속 순환하므로 연결 단위 분산이 우연히 통합니다.

iptables, nftables, IPVS는 모두 연결 단위로 백엔드를 고르고, Cilium 소켓 LB도 connect 시점에 한 번 고릅니다. Maglev나 IPVS로 바꾸어도 gRPC 쏠림이 풀리지 않는 이유입니다. 요청을 분산하려면 앱이 직접 백엔드 풀을 관리하거나, headless Service와 gRPC 클라이언트 LB를 사용하거나, L7 프록시를 경로에 두어야 합니다.

재시도와 헤더 기반 라우팅에도 요청을 읽는 기능이 필요합니다. 재시도에는 실패한 요청을 다시 보낼 단위가 있어야 합니다. 헤더는 페이로드 안에 있고 TLS가 적용되면 암호화돼 보이지 않습니다. Istio에서는 Envoy가 재시도를 수행하고, `headers`와 `exact` 매치로 라우팅하며, 요청마다 least requests 방식으로 백엔드를 고릅니다.

### 사이드카를 지나면서 달라지는 경로

Istio 사이드카 모드에서는 파드마다 Envoy 프록시가 붙습니다. iptables가 아웃바운드를 15001로, 인바운드를 15006으로 돌립니다. 앱은 여전히 `http://svc-b:8080`을 호출하지만 요청은 로컬 Envoy를 지나 상대 파드의 Envoy에 도착합니다. 로컬 Envoy와 상대 Envoy가 각각 HTTP를 파싱하는 경로입니다.

Envoy를 통과한다고 HTTP 처리가 보장되지는 않습니다. 프로토콜 판별에 실패하면 평문 TCP로 강등됩니다. HTTP 라우팅, 재시도, 헤더 조작이 빠지고, `istio_requests_total` 대신 `istio_tcp_*` 지표만 나옵니다.

판별에는 포트 이름, `appProtocol`, 자동 감지가 쓰입니다. 포트 이름과 `appProtocol`이 함께 있으면 `appProtocol`이 우선하며, 자동 감지는 HTTP/1.1과 HTTP/2만 알아봅니다. 프록시를 경로에 넣는 것과 그 프록시가 요청을 HTTP로 읽는 것은 따로 확인해야 합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| gRPC 연결 쏠림 | HTTP/2는 장수 연결에 요청을 다중화, 연결 후에는 요청이 파드 하나에 고정. 글쓴이가 Linkerd 측이라 일부 벤더 시각 | [Kubernetes 블로그 2018](https://kubernetes.io/blog/2018/11/07/grpc-load-balancing-on-kubernetes-without-tears/), [gRPC 블로그 2017](https://grpc.io/blog/grpc-load-balancing/) | `✓` |
| 쏠림은 kube-proxy 모드와 무관 | 모든 모드와 Cilium 소켓 LB가 연결 단위로 선택. Cilium은 Maglev 설명의 "E-W는 connect 시점에 결정"에 근거 | 위 두 글, Cilium kube-proxy 없는 구성 문서 | `≈` |
| L4가 못 하는 이유 | 5-tuple만 본다는 원리 설명 | 원리 설명 | `≈` |
| Envoy의 재시도·헤더 라우팅·least requests | Istio 1.31 문서 기준 | [Istio 트래픽 관리](https://istio.io/latest/docs/concepts/traffic-management/) | `✓` |
| 사이드카 경로와 프로토콜 판별 | 15001/15006, 판별 실패 시 TCP 강등, 파싱 지점 2곳은 "각 홉이 Envoy"에서 나온 산수 | [11 요청 경로 해부]({{< relref "/platform/istio/fundamentals/11-request-path-anatomy/index.md" >}}), [01 L4와 L7]({{< relref "/platform/istio/cilium/01-l4-l7-proxy-placement/index.md" >}}) | `✓` |

{{% /details %}}

## 파드마다 둔 프록시의 비용

사이드카의 리소스 비용은 파드 수에 1:1로 곱해집니다. Istio 공식 문서의 벤치마크에서 사이드카 하나는 약 0.20 vCPU와 60 MB를 사용합니다. HTTP 1,000 req/s, 1KB 페이로드 조건이며 Istio 1.24 기준입니다. 같은 조건에서 waypoint는 약 0.25 vCPU와 60 MB, ztunnel은 약 0.06 vCPU와 12 MB를 사용합니다. Istio 1.24 기준이라는 점을 발표에서 밝혀야 합니다.

채널코퍼레이션 DevOps팀은 약 4,000개 파드에 사이드카를 붙이면 유휴 상태에서만 약 240Gi가 프록시 메모리로 쓰인다고 계산했습니다. 60Mi × 4,000을 근사한 값이며, 이 비용을 Ambient 도입 이유로 들었습니다.

리소스 사용량 외에도 비용이 남습니다. 요청마다 프록시 홉이 두 번 늘어 꼬리 지연이 커지고, 컨트롤 플레인은 모든 사이드카에 변경을 전파해야 합니다. 프록시를 포함한 경로를 디버깅하는 일도 더 어려워집니다. HTTP 처리가 필요 없는 연결까지 파드마다 Envoy를 지나야 하니, L7 프록시를 필요한 구간에만 두자는 쪽으로 논의가 넘어갑니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 프록시별 리소스 단가 | HTTP 1,000 req/s, 1KB 페이로드, Istio 1.24 기준 벤치마크. 사이드카 0.20 vCPU·60 MB, waypoint 0.25 vCPU·60 MB, ztunnel 0.06 vCPU·12 MB | [14 왜 서비스 메시인가]({{< relref "/platform/istio/fundamentals/14-why-service-mesh/index.md" >}}) | `✓` |
| 240Gi 계산 | 채널코퍼레이션 DevOps팀 사례, 약 4,000 파드 × 60Mi 근사(정확히는 약 234Gi) | [01 왜 Ambient mode인가]({{< relref "/platform/istio/ambient/01-why-ambient-mode/index.md" >}}) | `Σ` |

{{% /details %}}

## Ambient는 필요한 구간에 L7을 둡니다

Ambient는 노드의 ztunnel에 L4 처리를 맡기고, L7이 필요한 네임스페이스나 서비스 앞에 waypoint를 둡니다. Istio ambient 문서에서 ztunnel은 노드마다 DaemonSet으로 실행되는 Rust 프록시입니다. mTLS(상호 TLS 인증), 인증, L4 인가, TCP 텔레메트리를 처리하며 HTTP는 파싱하지 않습니다.

이 역할을 이해하려면 mTLS와 L7을 구분해야 합니다. kube-proxy나 CNI의 L4 LB는 주소를 바꿀 뿐 인증서를 다루지 않아 워크로드 신원을 확인하지 못합니다. 신원 기반 mTLS 자체는 ztunnel 같은 L4 프록시로도 가능합니다. L7 인가와 VirtualService 라우팅처럼 요청 단위 처리가 필요한 기능을 Envoy 기반 waypoint가 담당합니다. 발표에서는 세 가지를 묶어 “CNI의 L4 LB는 신원을 모르고, 신원 기반 mTLS는 ztunnel 같은 L4 프록시로도 가능하지만, 요청 단위 정책에는 L7이 필요하다”고 설명할 수 있습니다.

노드 사이 트래픽은 HBONE 터널로 이동합니다. 15008 포트의 HTTP/2 CONNECT 위에 mTLS를 적용한 터널입니다. waypoint는 소스나 목적지 파드와 같은 노드에 있을 필요가 없습니다. waypoint를 거치면 홉이 하나 늘고, 그 홉이 노드 경계를 넘을 수도 있습니다.

Cilium의 mutual authentication도 인증과 암호화가 따로입니다. 1.20 문서에서도 Beta이며, 핸드셰이크는 대역 밖에서 수행합니다. 데이터 경로를 암호화하려면 WireGuard나 IPsec을 별도로 켜야 합니다.

### L4 경로와 waypoint 경로의 지연

atomai의 EKS 실험은 프록시 배치에 따른 지연을 비교했습니다. Istio 1.30.2, EKS 1.36.2, m7g.xlarge 노드 3대에서 200 QPS와 연결 16개로 실행했으며, 케이스마다 성공 요청은 12,000건이었습니다. 정상 상태의 P50(지연 시간의 중앙값)은 다음과 같습니다.

| 경로 | P50 | 기준선 대비 |
|---|---|---|
| mesh 없음 | 0.82ms | — |
| 사이드카 | 2.11ms | +1.29ms |
| ambient L4(ztunnel) | 0.86ms | +0.04ms |
| ambient L7(waypoint) | 2.68ms | +1.86ms |

이 실험에서 ambient L4는 기준선에 가까웠습니다. waypoint를 거친 ambient L7의 P50은 사이드카보다 0.57ms 컸습니다. 이 표본으로 L7 기능이 필요한 서비스에서 ambient가 지연 면에서 앞선다고 판단할 수는 없습니다.

원시 결과와 실행 스크립트가 공개되지 않았고 반복 횟수도 적혀 있지 않아, 이 표를 SLO(서비스 수준 목표)의 판단 근거로 삼아서는 안 됩니다. 같은 보고서의 메모리 약 86%, CPU 약 85% 절감 수치는 측정값이 아닌 100파드를 가정한 예산 모델입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| ztunnel은 L3·L4 기능 범위 | mTLS, 인증, L4 인가, 텔레메트리. 1.31.3 문서 | [Istio ambient 개요](https://istio.io/latest/docs/ambient/overview/) | `✓` |
| Cilium mutual authentication | 1.20 문서에서도 Beta, 핸드셰이크 대역 밖, 암호화는 별도 | [Cilium Mutual Authentication](https://docs.cilium.io/en/stable/network/servicemesh/mutual-authentication/mutual-authentication/) | `✓` |
| 발표 문장 | CNI의 L4 LB는 신원을 모른다는 구분 | 위 출처를 종합 | `Σ` |
| ztunnel·waypoint 역할과 HBONE | ztunnel은 노드당 DaemonSet, HBONE은 15008의 HTTP/2 CONNECT mTLS 터널, ambient는 1.24에서 GA | [01 왜 Ambient mode인가]({{< relref "/platform/istio/ambient/01-why-ambient-mode/index.md" >}}), [Istio ambient 개요](https://istio.io/latest/docs/ambient/overview/) | `✓` |
| 정상 상태 지연 | atomai 실험, Istio 1.30.2·EKS 1.36.2·Fortio 1.69.4, 200 QPS, 연결 16개, 60초, 케이스당 12,000건. P50 0.82/2.11/0.86/2.68ms | [부록 A 실측 비교]({{< relref "/platform/istio/ambient/a1-sidecar-vs-ambient-measurements/index.md" >}}) | `✓` |
| 실험의 한계 | 원시 결과·스크립트 없음, 반복 횟수 미표기. 리소스 절감 수치는 100파드 가정 예산 모델 | 같은 글 | `✓` |

{{% /details %}}

## 롤아웃에서 드러난 터널의 수명

프록시를 둘로 나누면 둘 사이의 연결이 언제 끝나는지가 새 변수가 됩니다. 채널팀이 보고한 간헐적 503은 롤아웃 중에만 발생했고, 원인은 커넥션 생명주기에 있었습니다.

waypoint는 HBONE 터널을 `IP:Port`만 키로 삼아 풀에 보관하고 재사용했습니다. ztunnel은 파드가 종료될 때 그 터널을 graceful하게 닫지 않았습니다. 여기에 IPAM(IP 주소 관리)의 IP 재할당이 겹치자 waypoint가 이미 종료된 파드의 터널을 다시 사용했습니다. 세 조건이 모두 겹쳐야 문제가 발생했습니다. 소켓 상태가 ESTABLISHED여도 상대가 살아 있다는 보장은 없습니다.

채널팀은 waypoint의 재시도 조건을 `reset-before-request`에서 `reset`까지 넓혀 증상을 줄였습니다. 이 조치는 완화책입니다. 근본 해결은 풀 키에 워크로드 신원과 파드 UID를 넣는 Istio upstream 개선으로 남아 있습니다.

a1 실험에서도 조정 뒤 롤아웃 오류가 waypoint 경로에만 남았습니다. 조정 전에는 59,913건 중 1,528건이 503으로, 비율은 2.6%였습니다. 이 오류가 채널팀의 03-1편에서 설명한 half-open 원인과 같은지는 확인되지 않았습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 롤아웃 503 | 조정 전 사이드카 324/60,000(0.5%), ambient L4 0건, waypoint 1,528/59,913(2.6%) | 같은 글 | `✓` |
| 503 half-open 원인 | 풀 키 `IP:Port`, ztunnel의 graceful close 부재, IP 재할당의 세 조건. Envoy 로그·pcap·socket 상태로 확인 | [3-1편 503과 Half-open Connection]({{< relref "/platform/istio/ambient/03-1-503-half-open-connection/index.md" >}}) | `✓` |
| 재시도 조건 확장은 완화책 | EnvoyFilter YAML은 공개되지 않음. 외부 실험의 503이 같은 원인인지는 미확인 | 같은 글, a1 | `?` |

{{% /details %}}

## 프록시를 둘 범위를 고르는 기준

프록시를 어디에 둘지 고를 때는 L7 처리가 필요한 트래픽의 범위와, 프록시 하나가 맡는 범위를 함께 봐야 합니다. Cilium도 L7을 처리하고 Istio ambient도 L4를 처리하므로, CNI와 서비스 메시라는 이름만으로 역할을 구분하기는 어렵습니다.

Cilium 정책 문서에서 L3는 레이블 기반 identity, 서비스, CIDR, DNS(`toFQDNs`)를 다룹니다. L4는 포트, 프로토콜, ICMP 타입, TLS SNI를 봅니다. L7 정책은 HTTP와 DNS이며, HTTP 규칙은 노드 로컬 Envoy가 집행합니다. 규칙을 위반하면 패킷을 버리는 대신 HTTP 403을 반환합니다. Kafka L7 정책은 1.20에서 제거됐으므로 예전 자료의 “HTTP/Kafka/gRPC L7 정책” 설명은 그대로 사용하면 안 됩니다.

이렇게 HTTP를 처리하는 프록시의 위치를 나란히 놓으면 선택할 범위가 드러납니다.

| | 사이드카 | Ambient | Cilium |
|---|---|---|---|
| L4 처리 주체 | 파드의 Envoy | 노드의 ztunnel | 커널 eBPF |
| L7 처리 위치 | 파드의 Envoy | 서비스·네임스페이스 앞 waypoint | 노드의 공유 Envoy |
| L7 프록시 범위 | 파드 하나 | waypoint를 둔 구간 | 노드의 모든 워크로드 |
| L7을 거치는 연결 | 전부 | waypoint를 지정한 것만 | L7 규칙이나 리스너가 걸린 것만 |

사이드카는 파드의 Envoy가 L4와 L7을 모두 처리합니다. HTTP 처리가 필요 없는 연결도 Envoy를 지납니다. Ambient와 Cilium은 HTTP 해석이 필요한 연결만 L7 프록시로 보내고, 나머지는 ztunnel이나 eBPF 경로에서 처리합니다.

공유 범위는 서로 다릅니다. Istio는 waypoint 단위로, Cilium은 노드 단위로 L7 프록시를 둡니다. 구조로 보면, 노드 하나의 L7 트래픽을 모두 받는 cilium-envoy는 장애 반경이 더 넓을 수 있습니다. 이는 직접 측정한 결과가 아닙니다.

재시도, 타임아웃, 서킷 브레이킹은 양쪽 모두 Envoy의 기능을 사용합니다. 차이는 이를 설정하는 API입니다. Istio는 VirtualService와 DestinationRule을 쓰고, Cilium은 Gateway API 표준 범위와 CiliumEnvoyConfig를 사용합니다.

발표의 선택 질문도 이 조건으로 돌아옵니다. 요청 단위로 다뤄야 하는 트래픽은 어디까지이며, 그 구간의 L7 프록시는 어디에 두어야 할까요?

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Cilium 정책 계층 | L7은 HTTP·DNS, 위반 시 HTTP 403, Kafka 정책은 1.20에서 제거 | [정책 문서](https://docs.cilium.io/en/stable/security/policy/index.html), [L7 정책](https://docs.cilium.io/en/stable/security/policy/layer7/), [1.20 업그레이드 노트](https://docs.cilium.io/en/stable/operations/upgrade/) | `✓` |
| 비교표의 배치 | 사이드카 15001/15006, ambient ztunnel·waypoint, Cilium eBPF·노드 Envoy | [01 L4와 L7]({{< relref "/platform/istio/cilium/01-l4-l7-proxy-placement/index.md" >}}) | `✓` |
| Cilium이 Envoy로 보내는 조건 | L7 규칙이 있는 CiliumNetworkPolicy, Ingress·Gateway API 리스너, CiliumEnvoyConfig, 정책으로 켠 L7 가시성 | 같은 글 | `✓` |
| 노드 공유 Envoy의 장애 반경 | 구조에서 이끌어 낸 추정. 잘못된 CiliumEnvoyConfig도 노드 전체에 영향을 줄 가능성 | 같은 글, [04 재시도와 복원력]({{< relref "/platform/istio/cilium/04-retry-resilience/index.md" >}}) | `≈` |
| 재시도 등은 양쪽 모두 Envoy 기능 | 차이는 API. Cilium 재시도는 Gateway API experimental CRD 설치가 필요하고 1.20.0 conformance 리포트에서 처음 확인 | 같은 글 | `✓` |
| 마지막 질문 | 배치 문제라는 관점 | [14 왜 서비스 메시인가]({{< relref "/platform/istio/fundamentals/14-why-service-mesh/index.md" >}}) 등 | `Σ` |

{{% /details %}}

## 경로를 확인할 데모 명령

데모에서는 노드의 모드를 확인한 뒤 그 모드에 맞는 명령을 선택합니다. 예를 들어 iptables 모드 노드에서도 iptables-nft 백엔드면 nft에 규칙이 보일 수 있으므로, nft에 규칙이 보인다고 nftables 모드라는 뜻은 아닙니다.

| 명령 | 유효 조건 | 근거 |
|---|---|---|
| `iptables-save \| grep KUBE-SVC` | kube-proxy iptables 모드. `KUBE-SERVICES`에서 `KUBE-SVC-<hash>`로 점프하고 엔드포인트별 체인은 `KUBE-SEP-<hash>` | `✓` (SEP 이름은 `≈`) |
| `nft list table ip kube-proxy` | nftables 모드. `map service-ips`와 `chain services`가 보임 | `✓` |
| `nft list ruleset` | iptables 모드 노드에서도 iptables-nft 백엔드면 규칙이 보임. "nft에 보이니 nftables 모드"로 오해하지 않기 | `≈` |
| `conntrack -L -d <ClusterIP>` | kube-proxy 노드에서 DNAT 항목 확인. conntrack-tools 필요. Cilium KPR 환경은 `cilium-dbg bpf ct list global` | `≈` / `✓` |
| `kubectl -n kube-system exec ds/cilium -- cilium-dbg service list` | Cilium 1.20.4 문서에 그대로 있음 | `✓` |
| `kubectl -n kube-system exec ds/cilium -- cilium-dbg status \| grep KubeProxyReplacement` | 같은 문서 | `✓` |
| `kubectl get endpointslices -l kubernetes.io/service-name=<svc>` | `kubectl get endpoints`는 1.33부터 경고가 나므로 이쪽을 사용 | `✓` |
| `ipvsadm -Ln` | 1.35부터 deprecated된 모드. 데모에서 빼거나 곧 사라질 모드로만 소개 | `✓` |

kind 클러스터에서 직접 시연하면 2~3분이 더 걸릴 것으로 잡습니다. 그 시간은 L4 설명 중 CNI 스펙이나 VPC CNI 부분에서 줄이는 편이 안전합니다. 화면 전환이 부담스럽다면 명령 출력을 슬라이드에 미리 붙여 둡니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 명령 유효성 | 위 표의 각 모드 조건. 출력 헤더 `ID  Frontend  Service Type  Backend` | [nftables 블로그](https://kubernetes.io/blog/2025/02/28/nftables-kube-proxy/), [Cilium kube-proxy 없는 구성](https://docs.cilium.io/en/stable/network/kubernetes/kubeproxy-free/), [cilium-dbg bpf ct list](https://docs.cilium.io/en/stable/cmdref/cilium-dbg_bpf_ct_list/) | `✓` |
| iptables-nft 백엔드 | 일반 지식으로 이번에 원문을 열지 않음 | — | `≈` |
| `cilium-dbg shell`, `bpf lb list` | 1.20 문서에 없어 동작 여부 확인하지 못함 | — | `?` |
| kind 데모 시간 | 2~3분 추정 | 발표 구성안 | `≈` |

{{% /details %}}

## 슬라이드와 발표 전 점검

경로를 설명할 슬라이드는 기존 글의 도식을 사용할 수 있습니다. 요청이 꺾이는 위치, HTTP를 읽는 지점, 프록시의 배치 범위를 아래 장면으로 연결합니다.

- 동서 경로, 앱이 `http://svc-b:8080`을 부르면 iptables가 로컬 Envoy로 꺾는 그림: `_flow/3-동서-경로-사이드카-두.json` ([11 요청 경로 해부]({{< relref "/platform/istio/fundamentals/11-request-path-anatomy/index.md" >}}))
- 요청이 L7이 되는 지점: `_flow/4-요청이-l7-이-되는.json` (같은 글)
- 배치 스펙트럼: `_flow/2-대안-스펙트럼-관심사를-어디에.json` ([14 왜 서비스 메시인가]({{< relref "/platform/istio/fundamentals/14-why-service-mesh/index.md" >}}))
- 세 가지 배치: `_flow/2-세-가지-배치.json` ([01 L4와 L7]({{< relref "/platform/istio/cilium/01-l4-l7-proxy-placement/index.md" >}}))
- L4와 L7의 경계, 이 발표의 핵심 장면: `_flow/5-l4와-l7의-경계.json` (같은 글)
- 포트 분기 15001·15006·15008: `_seq/7-traffic-redirection.json` ([01 왜 Ambient mode인가]({{< relref "/platform/istio/ambient/01-why-ambient-mode/index.md" >}}))
- 503 원인 세 조건: `_seq/세-조건이-겹칠-때만.json` ([3-1편 503과 Half-open Connection]({{< relref "/platform/istio/ambient/03-1-503-half-open-connection/index.md" >}}))
- 지연 표는 별도 도식이 없으므로 위 P50 표를 그대로 옮깁니다 ([부록 A 실측 비교]({{< relref "/platform/istio/ambient/a1-sidecar-vs-ambient-measurements/index.md" >}}))

한 장에 섞으면 안 되는 수치가 있습니다.

- Istio 1.24 공식 벤치마크 — 사이드카 0.20 vCPU·60 MB, ztunnel 0.06 vCPU·12 MB
- a1 실험의 100파드 예산 모델 — 사이드카 50MB·0.1 vCPU, ztunnel 50MB·0.1 vCPU, waypoint 200MB·0.5 vCPU
- 채널팀 자체 측정 — 사이드카 유휴 60Mi, 2,000 RPS에서 300~500Mi

이 값들은 출처와 버전이 다르므로 한 장에 섞지 않습니다. MB와 Mi도 글마다 다르게 쓰였으므로 슬라이드에서는 단위를 하나로 맞추거나 원문 표기를 유지합니다.

발표 전날에는 다음 항목을 다시 확인합니다.

- Kubernetes, Cilium, Istio, VPC CNI 최신 릴리스와 패치 버전
- Kubernetes 1.34 지원 종료일(2026-10-27)과 KEP-5343의 단계 변화
- Cilium과 Istio 문서의 ztunnel 투명 암호화, Cilium 재시도 지원 표기

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 섞으면 안 되는 수치 | 1.24 벤치마크, a1 예산 모델 입력, 채널팀 측정은 출처·버전이 다름 | [14]({{< relref "/platform/istio/fundamentals/14-why-service-mesh/index.md" >}}), [01 왜 Ambient mode인가]({{< relref "/platform/istio/ambient/01-why-ambient-mode/index.md" >}}), [부록 A]({{< relref "/platform/istio/ambient/a1-sidecar-vs-ambient-measurements/index.md" >}}) | `✓` |
| 도식 파일명 | 각 글의 page bundle에 있는 파일 | 위 글들 | `✓` |

{{% /details %}}

## 확인하지 못한 것

- CNI 저장소 v1.3.x 릴리스가 스펙 1.1.0 이후 새 스펙 버전을 냈는지. SPEC.md main 브랜치는 1.1.0
- Kubernetes 1.37 공식 릴리스 노트에 적힌 nftables 경고의 정확한 문구. 이 부분은 KEP-5343과 서드파티 요약에 기댔음
- `cilium-dbg shell -- db/show frontends` 같은 1.18 이후 진단 명령이 1.20에서 어떻게 쓰이는지
- waypoint 재시도의 원래 기본값. 3-1편은 `reset-before-request`만 대상이었다고 쓰고, 04편은 같은 값을 인바운드 기본값으로 소스에서만 확인했으며 도입 버전은 모름
- 15006의 역할. 11편은 ambient에서 15006 대신 15008이 중심이라 쓰고, Ambient 01편은 인바운드 평문이 ztunnel의 15006으로 간다고 씀. 발표에서는 "대신"이라는 표현을 피하고 두 포트를 나란히 보여 주는 쪽을 권함
- 외부 실험의 waypoint 503이 3-1편의 half-open 원인과 같은지
- Cilium 재시도 지원이 1.20.0 이전 버전에서 없었는지. 1.20.0 conformance 리포트가 첫 확인일 뿐 미지원을 단정하지 않음

## 참고 자료

1차 출처

- [Kubernetes — 릴리스](https://kubernetes.io/releases/)
- [Kubernetes — 서비스, 로드 밸런싱, 네트워킹](https://kubernetes.io/docs/concepts/services-networking/)
- [Kubernetes — Virtual IPs and Service Proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/)
- [Kubernetes — EndpointSlice](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)
- [Kubernetes 블로그 — nftables kube-proxy](https://kubernetes.io/blog/2025/02/28/nftables-kube-proxy/)
- [Kubernetes 블로그 — Endpoints deprecation](https://kubernetes.io/blog/2025/04/24/endpoints-deprecation/)
- [Kubernetes 블로그 — gRPC load balancing](https://kubernetes.io/blog/2018/11/07/grpc-load-balancing-on-kubernetes-without-tears/)
- [KEP-5343 — nftables 기본값 전환](https://www.kubernetes.dev/resources/keps/5343/)
- [KEP-5495 — IPVS deprecation](https://www.kubernetes.dev/resources/keps/5495/)
- [CNI SPEC.md](https://github.com/containernetworking/cni/blob/main/SPEC.md)
- [CNI 릴리스](https://github.com/containernetworking/cni/releases)
- [gRPC — Load Balancing](https://grpc.io/blog/grpc-load-balancing/)
- [Cilium — 라우팅](https://docs.cilium.io/en/stable/network/concepts/routing/)
- [Cilium — kube-proxy 없는 구성](https://docs.cilium.io/en/stable/network/kubernetes/kubeproxy-free/)
- [Cilium — 정책](https://docs.cilium.io/en/stable/security/policy/index.html)
- [Cilium — L7 정책](https://docs.cilium.io/en/stable/security/policy/layer7/)
- [Cilium — 업그레이드 노트](https://docs.cilium.io/en/stable/operations/upgrade/)
- [Cilium — Mutual Authentication](https://docs.cilium.io/en/stable/network/servicemesh/mutual-authentication/mutual-authentication/)
- [Cilium — cilium-dbg bpf ct list](https://docs.cilium.io/en/stable/cmdref/cilium-dbg_bpf_ct_list/)
- [Cilium 릴리스](https://github.com/cilium/cilium/releases)
- [Istio — 트래픽 관리](https://istio.io/latest/docs/concepts/traffic-management/)
- [Istio — Ambient overview](https://istio.io/latest/docs/ambient/overview/)
- [Istio 릴리스](https://github.com/istio/istio/releases)
- [AWS — EKS VPC CNI 모범 사례](https://docs.aws.amazon.com/eks/latest/best-practices/vpc-cni.html)
- [AWS — Prefix mode](https://docs.aws.amazon.com/eks/latest/best-practices/prefix-mode-linux.html)
- [AWS — nftables](https://docs.aws.amazon.com/eks/latest/best-practices/nftables.html)
- [Amazon VPC CNI 릴리스](https://github.com/aws/amazon-vpc-cni-k8s/releases)

이 저장소의 관련 글

- [서비스 메시와 Istio 기초]({{< relref "/platform/istio/fundamentals/01-mesh-basics/index.md" >}})
- [요청 경로 해부]({{< relref "/platform/istio/fundamentals/11-request-path-anatomy/index.md" >}})
- [왜 서비스 메시인가]({{< relref "/platform/istio/fundamentals/14-why-service-mesh/index.md" >}})
- [왜 Ambient mode인가]({{< relref "/platform/istio/ambient/01-why-ambient-mode/index.md" >}})
- [부록 A 실측 비교]({{< relref "/platform/istio/ambient/a1-sidecar-vs-ambient-measurements/index.md" >}})
- [3-1편 503과 Half-open Connection]({{< relref "/platform/istio/ambient/03-1-503-half-open-connection/index.md" >}})
- [01 L4와 L7 — 프록시는 어디에 있나]({{< relref "/platform/istio/cilium/01-l4-l7-proxy-placement/index.md" >}})
- [04 재시도와 복원력]({{< relref "/platform/istio/cilium/04-retry-resilience/index.md" >}})
