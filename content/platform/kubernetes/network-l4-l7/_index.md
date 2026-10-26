---
title: "L7 프록시는 요청 단위 처리가 필요한 곳에만 둔다 — 30분 스터디 자료"
linkTitle: "네트워크 L4·L7 스터디"
description: "2026-10-26 기준으로 Service의 연결 단위 분산과 L7 프록시의 배치 조건을 도식으로 설명한다. 프록시를 두는 범위에 따라 비용과 장애 반경이 달라진다."
date: 2026-10-26
lastmod: 2026-10-26
weight: 50
url: "/kubernetes/network-l4-l7/"
---

# L7 프록시는 요청 단위 처리가 필요한 곳에만 둔다 — 30분 스터디 자료

## 같은 요청을 30분 동안 따라가기

파드 A가 `curl http://svc-b`를 실행하면 요청은 어디를 거칠까요? L4는 연결 단위로 파드를 고르고, 요청 단위 처리가 필요한 곳에만 L7 프록시를 둡니다. 프록시의 위치에 따라 비용과 장애 반경도 달라집니다. 도식은 요청의 경로와 L7 프록시가 들어갈 자리를 보여줍니다.

{{< flow src="_flow/1-전체-그림.json" />}}

| 구간 | 시간 | 내용 |
|---|---|---|
| 도입 | 2분 | 질문 하나, 두 계층의 역할 |
| 1부 L4 | 12분 | 파드 네트워크 모델, 오버레이와 네이티브 라우팅, kube-proxy, Cilium eBPF |
| 2부 L7 | 12분 | L4로 못 하는 일, 사이드카, 비용, ambient, 경계 장애 |
| 정리·질의 | 4분 | 비교표, 결론 질문, 질문 받기 |

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-26이며 Kubernetes 1.37.1, Cilium 1.20.4, Istio 1.31.3, Amazon VPC CNI v1.23.2 문서를 봤습니다.

발표에서 더 풀어 설명할 내용은 [근거와 세부 설명 전체본]({{< relref "/platform/kubernetes/network-l4-l7/detail/index.md" >}})에 모았습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 조사 기준 버전 | Kubernetes 1.37.1(2026-09-15), Cilium 1.20.4(10-23), Istio 1.31.3(10-22), Amazon VPC CNI v1.23.2(09-30) | [Kubernetes 릴리스](https://kubernetes.io/releases/), [Cilium 릴리스](https://github.com/cilium/cilium/releases), [Istio 릴리스](https://github.com/istio/istio/releases), [VPC CNI 릴리스](https://github.com/aws/amazon-vpc-cni-k8s/releases) | `✓` |
| 시간 배분 | 2 / 12 / 12 / 4분 | 발표 구성안 | `Σ` |

{{% /details %}}

## 연결을 고르는 L4 경로

쿠버네티스는 파드마다 클러스터에서 유일한 IP를 부여하고, 파드끼리 NAT 없이 직접 통신하도록 정합니다. 리눅스 컨테이너 런타임은 CNI로 구현체를 호출하고, 구현체는 그 통신 경로를 만듭니다. Cilium 오버레이는 터널로 노드를 잇습니다. AWS 문서의 VPC CNI는 오버레이 없이 파드에 VPC IP를 할당합니다.

kube-proxy는 EndpointSlice를 보고 Service IP를 백엔드 파드 IP로 변환합니다. 동작 원리로 보면 같은 연결의 패킷은 conntrack에 저장한 백엔드 선택을 따릅니다. Cilium은 `kubeProxyReplacement=true`로 켠 대체 모드에서 socket-LB를 사용합니다. 아래는 구현별 백엔드 선택 시점과 연결 단위라는 공통점을 비교한 도식입니다.

{{< flow src="_flow/3-백엔드-선택-시점.json" />}}

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 파드 IP 유일, NAT 없는 직접 통신 | 예외는 Windows hostNetwork 파드 | [Kubernetes 서비스·네트워킹](https://kubernetes.io/docs/concepts/services-networking/) | `✓` |
| Cilium 캡슐화·네이티브 라우팅 | VXLAN 8472/UDP, Geneve 6081/UDP, VXLAN 패킷당 50바이트 | [Cilium 라우팅](https://docs.cilium.io/en/stable/network/concepts/routing/) (stable 1.20.x) | `✓` |
| VPC CNI 동작 | 최대 파드 수 식, /28 프리픽스 16개, 파드 삭제 후 IP 30초 쿨다운, v1.9.0 이상에서 prefix delegation | [EKS VPC CNI 모범 사례](https://docs.aws.amazon.com/eks/latest/best-practices/vpc-cni.html), [Prefix mode](https://docs.aws.amazon.com/eks/latest/best-practices/prefix-mode-linux.html) | `Ⓥ` |
| 백엔드 선택은 첫 패킷, conntrack에 저장 | 문서에 이 문장은 없고 동작 원리를 설명한 것 | Virtual IPs 문서의 DNAT 서술 | `≈` |
| Cilium KPR·소켓 LB·Maglev | KPR Helm 기본값 `false`, Maglev는 N-S 한정, `maglev.tableSize` 기본 16381 | [Cilium kube-proxy 없는 구성](https://docs.cilium.io/en/stable/network/kubernetes/kubeproxy-free/) (1.20.4) | `✓` |

{{% /details %}}

## kube-proxy 모드의 현재 상태와 전환 일정

Kubernetes 1.37의 기본 모드는 iptables입니다. AWS 문서는 nftables가 1.33에서 GA가 됐다고 적고, 기본값을 nftables로 바꾸는 KEP-5343은 아직 Alpha·provisional 제안입니다. Kubernetes 문서는 iptables와 nftables의 패킷 처리 성능 차이를 수만 개 서비스 규모에서 체감한다고 설명합니다. 도식은 nftables 전환과 IPVS 폐기 일정을 보여줍니다.

{{< lane src="_lane/3-kube-proxy-모드-일정.json" />}}

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| kube-proxy 모드 현황 | 1.37 기본 iptables, nftables 커널 5.13 이상, ipvs 1.35 deprecated·1.40 기본 꺼짐·1.43 제거 | [Virtual IPs 문서](https://kubernetes.io/docs/reference/networking/virtual-ips/), [KEP-5495](https://www.kubernetes.dev/resources/keps/5495/) | `✓` |
| nftables GA 시점 | 1.29 alpha, 1.31 beta, 1.33 GA | [AWS nftables 문서](https://docs.aws.amazon.com/eks/latest/best-practices/nftables.html) | `Ⓥ` |
| nftables 기본값 전환 일정 | 1.37 경고, 1.39 beta, 1.40 기본 전환. 현재 Alpha·provisional | [KEP-5343](https://www.kubernetes.dev/resources/keps/5343/) | `✓` |
| iptables O(n), nftables 대략 O(1) | 성능 차이는 수만 개 서비스 규모에서 체감 | [nftables kube-proxy 블로그](https://kubernetes.io/blog/2025/02/28/nftables-kube-proxy/), Virtual IPs 문서 | `✓` |

{{% /details %}}

## 요청을 나누는 L7과 사이드카 비용

L4는 HTTP 요청의 경계와 헤더, 상태 코드를 읽지 못합니다. gRPC 쏠림을 풀려면 클라이언트가 백엔드를 나누거나 L7 프록시가 요청을 나눠야 합니다. 아래 도식은 연결 단위 분산과 요청 단위 분산의 차이를 보여줍니다.

{{< seq src="_seq/4-grpc-쏠림.json" />}}

Istio의 Envoy는 요청 단위 재시도와 헤더 기반 라우팅을 처리합니다. 사이드카는 파드마다 붙으므로 파드 수만큼 리소스 비용도 늘어납니다. Istio 1.24 공식 벤치마크에서 HTTP 1,000 req/s, 1KB 페이로드를 처리하는 사이드카 하나는 약 0.20 vCPU와 60 MB를 사용했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| gRPC 연결 쏠림 | HTTP/2는 장수 연결에 요청을 다중화, 연결 후에는 요청이 파드 하나에 고정. 글쓴이가 Linkerd 측이라 일부 벤더 시각 | [Kubernetes 블로그 2018](https://kubernetes.io/blog/2018/11/07/grpc-load-balancing-on-kubernetes-without-tears/), [gRPC 블로그 2017](https://grpc.io/blog/grpc-load-balancing/) | `✓` |
| L4가 못 하는 이유 | 5-tuple만 본다는 원리 설명 | 원리 설명 | `≈` |
| Envoy의 재시도·헤더 라우팅·least requests | Istio 1.31 문서 기준 | [Istio 트래픽 관리](https://istio.io/latest/docs/concepts/traffic-management/) | `✓` |
| 프록시별 리소스 단가 | HTTP 1,000 req/s, 1KB 페이로드, Istio 1.24 기준 벤치마크. 사이드카 0.20 vCPU·60 MB, waypoint 0.25 vCPU·60 MB, ztunnel 0.06 vCPU·12 MB | [14 왜 서비스 메시인가]({{< relref "/platform/istio/fundamentals/14-why-service-mesh/index.md" >}}) | `✓` |

{{% /details %}}

## Ambient의 배치와 지연·롤아웃 사례

Ambient는 ztunnel에 L4를 맡기고 요청 단위 처리가 필요한 구간에 waypoint를 둡니다. mTLS는 L7 전용 기능이 아니며 ztunnel 같은 L4 프록시로도 가능합니다. 아래 도식은 사이드카·ambient·Cilium의 프록시 배치를 비교합니다.

{{< flow src="_flow/2-세-가지-배치.json" />}}

지연 수치는 atomai의 외부 실험에서 왔습니다. Istio 1.30.2, EKS 1.36.2, m7g.xlarge 노드 3대에서 200 QPS·연결 16개로 측정했습니다. 원시 결과·실행 스크립트가 공개되지 않았고 반복 횟수도 적혀 있지 않아 SLO 판단 근거로 삼아서는 안 됩니다. 다음 도식은 정상 상태의 경로별 P50을 비교합니다.

{{< lane src="_lane/6-지연-비교.json" />}}

채널코퍼레이션 DevOps팀이 겪은 롤아웃 중 503은 터널 수명 문제였습니다. 재시도 조건을 `reset-before-request`에서 `reset`으로 넓혀 증상을 줄였지만, 근본 해결은 워크로드 신원과 파드 UID를 풀 키에 넣는 upstream 개선으로 남아 있습니다. 도식은 죽은 터널을 재사용하게 된 조건을 보여줍니다.

{{< seq src="_seq/세-조건이-겹칠-때만.json" />}}

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| ztunnel·waypoint 역할과 HBONE | ztunnel은 노드당 DaemonSet, HBONE은 15008의 HTTP/2 CONNECT mTLS 터널, ambient는 1.24에서 GA | [01 왜 Ambient mode인가]({{< relref "/platform/istio/ambient/01-why-ambient-mode/index.md" >}}), [Istio ambient 개요](https://istio.io/latest/docs/ambient/overview/) | `✓` |
| 정상 상태 지연 | atomai 실험, Istio 1.30.2·EKS 1.36.2·Fortio 1.69.4, 200 QPS, 연결 16개, 60초, 케이스당 12,000건. P50 0.82/2.11/0.86/2.68ms | [부록 A 실측 비교]({{< relref "/platform/istio/ambient/a1-sidecar-vs-ambient-measurements/index.md" >}}) | `✓` |
| 실험의 한계 | 원시 결과·스크립트 없음, 반복 횟수 미표기. 리소스 절감 수치는 100파드 가정 예산 모델 | 같은 글 | `✓` |
| 503 half-open 원인 | 풀 키 `IP:Port`, ztunnel의 graceful close 부재, IP 재할당의 세 조건. Envoy 로그·pcap·socket 상태로 확인 | [3-1편 503과 Half-open Connection]({{< relref "/platform/istio/ambient/03-1-503-half-open-connection/index.md" >}}) | `✓` |
| 재시도 조건 확장은 완화책 | EnvoyFilter YAML은 공개되지 않음. 외부 실험의 503이 같은 원인인지는 미확인 | 같은 글, a1 | `?` |

{{% /details %}}

## L7 프록시의 범위와 장애 반경

요청 단위 처리가 필요한 트래픽의 범위와 프록시 하나가 맡는 범위를 함께 봐야 합니다. 동작 원리로 보면 노드 하나의 L7 트래픽을 모두 받는 cilium-envoy는 장애 반경이 더 넓을 수 있습니다. 이는 직접 측정한 결과가 아닙니다. 도식은 HTTP 해석이 필요한 연결을 L7으로 보내는 경계를 보여줍니다.

{{< flow src="_flow/5-l4와-l7의-경계.json" />}}

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 비교표의 배치 | 사이드카 15001/15006, ambient ztunnel·waypoint, Cilium eBPF·노드 Envoy | [01 L4와 L7]({{< relref "/platform/istio/cilium/01-l4-l7-proxy-placement/index.md" >}}) | `✓` |
| Cilium이 Envoy로 보내는 조건 | L7 규칙이 있는 CiliumNetworkPolicy, Ingress·Gateway API 리스너, CiliumEnvoyConfig, 정책으로 켠 L7 가시성 | 같은 글 | `✓` |
| 노드 공유 Envoy의 장애 반경 | 구조에서 이끌어 낸 추정. 잘못된 CiliumEnvoyConfig도 노드 전체에 영향을 줄 가능성 | 같은 글, [04 재시도와 복원력]({{< relref "/platform/istio/cilium/04-retry-resilience/index.md" >}}) | `≈` |

{{% /details %}}

## 데모와 발표 준비 점검

데모 명령은 노드의 kube-proxy 모드와 Cilium KPR 사용 여부를 확인한 뒤 선택합니다.

| 명령 | 유효 조건 | 근거 |
|---|---|---|
| `iptables-save \| grep KUBE-SVC` | kube-proxy iptables 모드. `KUBE-SERVICES`에서 `KUBE-SVC-<hash>`로 점프하고 엔드포인트별 체인은 `KUBE-SEP-<hash>` | `✓` (SEP 이름은 `≈`) |
| `nft list table ip kube-proxy` | nftables 모드. `map service-ips`와 `chain services`가 보임 | `✓` |
| `conntrack -L -d <ClusterIP>` | kube-proxy 노드에서 DNAT 항목 확인. conntrack-tools 필요. Cilium KPR 환경은 `cilium-dbg bpf ct list global` | `≈` / `✓` |
| `kubectl -n kube-system exec ds/cilium -- cilium-dbg service list` | Cilium 1.20.4 문서에 그대로 있음 | `✓` |

- Istio 1.24 공식 벤치마크, a1의 100파드 예산 모델, 채널팀 자체 측정의 수치를 섞지 않기. MB·Mi 표기는 원문대로 유지
- 발표 전날 Kubernetes·Cilium·Istio·VPC CNI 릴리스와 패치 버전, KEP-5343 단계 재확인

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 명령 유효성 | 위 표의 각 모드 조건. 출력 헤더 `ID  Frontend  Service Type  Backend` | [nftables 블로그](https://kubernetes.io/blog/2025/02/28/nftables-kube-proxy/), [Cilium kube-proxy 없는 구성](https://docs.cilium.io/en/stable/network/kubernetes/kubeproxy-free/), [cilium-dbg bpf ct list](https://docs.cilium.io/en/stable/cmdref/cilium-dbg_bpf_ct_list/) | `✓` |
| 섞으면 안 되는 수치 | 1.24 벤치마크, a1 예산 모델 입력, 채널팀 측정은 출처·버전이 다름 | [14]({{< relref "/platform/istio/fundamentals/14-why-service-mesh/index.md" >}}), [01 왜 Ambient mode인가]({{< relref "/platform/istio/ambient/01-why-ambient-mode/index.md" >}}), [부록 A]({{< relref "/platform/istio/ambient/a1-sidecar-vs-ambient-measurements/index.md" >}}) | `✓` |

{{% /details %}}

## 참고 자료

- [Kubernetes — Virtual IPs and Service Proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/)
- [Kubernetes 블로그 — nftables kube-proxy](https://kubernetes.io/blog/2025/02/28/nftables-kube-proxy/)
- [Kubernetes 블로그 — gRPC load balancing](https://kubernetes.io/blog/2018/11/07/grpc-load-balancing-on-kubernetes-without-tears/)
- [KEP-5343 — nftables 기본값 전환](https://www.kubernetes.dev/resources/keps/5343/)
- [KEP-5495 — IPVS deprecation](https://www.kubernetes.dev/resources/keps/5495/)
- [Cilium — kube-proxy 없는 구성](https://docs.cilium.io/en/stable/network/kubernetes/kubeproxy-free/)
- [Istio — Ambient overview](https://istio.io/latest/docs/ambient/overview/)
- [AWS — nftables](https://docs.aws.amazon.com/eks/latest/best-practices/nftables.html)
- [왜 서비스 메시인가]({{< relref "/platform/istio/fundamentals/14-why-service-mesh/index.md" >}})
- [부록 A 실측 비교]({{< relref "/platform/istio/ambient/a1-sidecar-vs-ambient-measurements/index.md" >}})
- [3-1편 503과 Half-open Connection]({{< relref "/platform/istio/ambient/03-1-503-half-open-connection/index.md" >}})
- [01 L4와 L7 — 프록시는 어디에 있나]({{< relref "/platform/istio/cilium/01-l4-l7-proxy-placement/index.md" >}})

나머지 출처는 전체본에 있습니다.
