---
title: "Kubernetes 통신을 복구하는 network-node-manager"
description: "Kubernetes 파드의 갑작스러운 연결 종료와 External-IP 접근 실패를 노드 설정으로 어떻게 풀 수 있을까요? 카카오는 network-node-manager로 INVALID 패킷을 차단하고, IPVS 모드에서 External-IP로 향하던 파드 패킷의 목적지를 Cluster-IP로 바꿨습니다."
date: 2026-11-14
weight: 6
---

# Kubernetes 통신을 복구하는 network-node-manager (2021-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Kubernetes의 네트워크 이슈를 해결할 수 있는 network-node-manager](https://tech.kakao.com/posts/426)
- 매체 · 게시일: 카카오 기술블로그 · 2021-03-03
- 저자: ssup.2 (클라우드플랫폼팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

파드에서 외부 서버로 큰 파일을 보내다가 연결이 끊겼습니다. 클러스터 안에서 LoadBalancer Service의 External-IP에 접근하지 못하는 문제도 있었습니다. 카카오 클라우드플랫폼팀이 사내 Kubernetes 플랫폼 DKOS를 운영하며 겪은 일입니다.

이런 네트워크 문제 중 일부는 노드에 설정을 추가하면 해결됐습니다. 팀은 그 설정을 각 노드에서 관리하는 Kubernetes Controller인 network-node-manager를 만들었습니다.

## 클러스터 안에서 막힌 External-IP {#ipvs-external-ip}

External-IP로 접속하지 못하던 파드도 Cluster-IP로는 통신했습니다. kube-proxy를 IPVS 모드로 쓰고 `ExternalTrafficPolicy`를 `Local`로 설정한 LoadBalancer Service에서 발생한 문제입니다. 일부 사내 개발자는 설정을 단순화하려고 External-IP에 도메인을 연결한 뒤, 클러스터 안의 파드도 그 도메인으로 통신하도록 했습니다.

network-node-manager는 IPVS에 패킷을 넘기기 전에 목적지 주소를 바꾸는 DNAT를 수행합니다. 원문의 예에서는 External-IP `20.0.0.20`으로 보낸 패킷이 Cluster-IP `10.0.0.10`으로 바뀌어, IPVS의 Cluster-IP 규칙에 따라 서비스 파드로 전달됩니다.

이 우회가 필요한 이유는 `Local` 정책에 있습니다. 노드는 로드 밸런서에서 받은 패킷을 같은 노드에 있는 서비스 파드로만 분산합니다. Service Pod A, B가 모두 Node A에 있다면, Node A의 kube-proxy는 External-IP와 NodePort로 들어온 패킷을 이 파드들에 전달하도록 IPVS 규칙을 설정합니다. 서비스 파드가 없는 Node B에서는 해당 패킷이 Drop됩니다.

로드 밸런서는 NodePort 또는 External-IP로 Health Check를 수행하고, 실패한 노드에는 패킷을 보내지 않습니다. Node B의 Drop은 서비스 파드가 없는 노드로 트래픽이 들어오지 않게 하려는 설정입니다. 그런데 Node B에 있는 클라이언트 파드가 External-IP로 보낸 패킷까지 같은 규칙에 걸려 Drop됩니다. network-node-manager가 목적지를 Cluster-IP로 바꾸는 것은 이 차단을 피하기 위해서입니다.

원문의 `iptables -t nat` 출력에는 서비스별 DNAT 규칙이 파드의 네트워크 사용 방식에 따라 나뉘어 있습니다.

- `NMANAGER_EX_CLUS_PREROUTING`: 일반 파드의 패킷 처리. SrcIP가 파드 CIDR에 속할 때만 DNAT
- `NMANAGER_EX_CLUS_OUTPUT`: 호스트 네트워크 네임스페이스를 사용하는 파드의 패킷 처리

두 체인에는 kube-proxy가 만든 `KUBE-MARK-MASQ`로 점프하는 규칙도 들어 있습니다. 출발지 주소를 바꾸는 SNAT가 필요한 패킷을 여기서 표시하면, 나중에 `MASQUERADE` 규칙이 SNAT를 수행합니다. 이 과정으로 클라이언트 파드가 보낸 패킷의 SrcIP에 적절한 호스트 IP가 들어가도록 보장합니다.

## 파드의 응답을 대신 받은 노드 {#connection-reset}

외부 서버와의 연결이 갑자기 끊기는 문제는 평소에는 거의 발생하지 않았습니다. 파드가 파일처럼 큰 데이터를 보낼 때 `connection reset by peer` 오류를 겪었습니다. tshark로 파드 안과 노드에서 각각 패킷을 수집하자, RST 패킷은 노드에서만 확인됐습니다. 연결 종료 요청을 보낸 쪽은 노드였습니다.

오버레이 네트워크를 쓰는 일반적인 경우, 파드가 외부로 보낸 요청은 노드에서 SNAT를 거칩니다. kube-proxy나 CNI 플러그인이 설정한 iptables의 `MASQUERADE` 규칙이 SrcIP를 파드 IP에서 노드 IP로 바꿉니다. 클러스터 안에서만 유효한 파드 IP를 외부 서버도 인식할 주소로 바꾸는 것입니다.

서버의 응답은 노드 IP로 돌아옵니다. 이 응답을 파드에 전달하려면 DstIP를 노드 IP에서 파드 IP로 DNAT해야 합니다. Linux의 네트워크 연결 정보를 관리하는 conntrack과 iptables가 이 변환을 암묵적으로 수행합니다.

문제는 외부 요인으로 응답 패킷의 도착 순서가 뒤바뀔 때 생겼습니다. 순서가 뒤바뀐 Out of Order 패킷은 정상 패킷이어도 conntrack 버그 때문에 `INVALID`로 판정됐습니다. iptables는 이 패킷에 암묵적 DNAT를 수행하지 않습니다. 목적지가 노드 IP인 채로 남은 응답을 노드가 받고, 자신이 모르는 연결의 패킷을 발견한 노드는 서버에 Reset을 보냅니다.

서버는 연결을 종료한 뒤 TCP 규약에 따라 Reset을 돌려보냅니다. 이 Reset은 정상적으로 DNAT되어 파드에 도착합니다. 파드가 받은 `connection reset by peer`는 노드가 먼저 보낸 Reset에서 시작된 오류였습니다.

network-node-manager는 노드로 잘못 전달되는 응답을 차단해 이 문제를 우회합니다. iptables의 filter 규칙은 `INPUT`에서 `NMANAGER_INPUT`, `NMANAGER_DROP_INVALID_INPUT`을 차례로 거쳐 conntrack이 `INVALID`로 판정한 패킷만 `DROP`합니다. 노드가 이 패킷을 받고 Reset을 보내는 일을 막는 방식입니다.

차단한 패킷은 파드에도 전달되지 않습니다. 그래도 데이터 유실이 문제가 되지는 않습니다. TCP 재전송이 보완하기 때문입니다.

## Service 변화를 반영하는 network-node-manager {#overview}

이 설정을 관리하는 network-node-manager는 DaemonSet으로 모든 노드에 배포됩니다. Host Network Namespace에서 네트워크 권한을 갖고 실행되므로 각 노드의 설정을 직접 바꿀 수 있습니다. Kubernetes API Server에 Watch를 요청해 Service 오브젝트의 변화만 감시하고, 그 변화에 맞춰 노드 네트워크 설정을 갱신합니다.

배포에 필요한 정보는 파드 Network CIDR와 kube-proxy 모드입니다. iptables 모드와 IPVS 모드에 따라 설정 방법이 달라지며, 배포 매니페스트도 따로 제공합니다. 해당 모드의 매니페스트로 배포한 뒤 DaemonSet에 `POD_CIDR_IPV4`와 `POD_CIDR_IPV6` 환경 변수를 지정하는 방식입니다. IPv6 Service도 지원합니다.

## 공개 버전에 넣지 못한 네트워크 설정 {#todo}

DKOS에서 겪은 Kubernetes 네트워크 문제는 이 밖에도 있었습니다. 하지만 해결에 쓰는 네트워크 설정이 CNI 플러그인에 따라 적용되지 않을 수 있어, 공개한 network-node-manager에는 넣지 못했습니다. 팀은 이후 CNI 플러그인의 영향을 받지 않는 이슈와 해결 설정을 발견하면 추가할 계획이라고 밝혔습니다.

원문에는 함께 읽을 글로 「Cgroup Driver 선택하기」도 소개돼 있습니다.
