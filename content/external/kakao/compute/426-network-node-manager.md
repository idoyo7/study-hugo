---
title: "Kubernetes 네트워크 이슈를 푸는 network-node-manager"
description: "카카오 클라우드플랫폼팀이 DKOS를 운영하며 겪은 conntrack INVALID 패킷에 따른 connection reset과 IPVS 모드의 External-IP 접근 문제를 노드 네트워크 설정으로 푼 방법을 정리했습니다. 이 설정을 DaemonSet으로 관리하는 network-node-manager의 구조도 함께 다룹니다."
date: 2026-11-14
weight: 6
---

# Kubernetes 네트워크 이슈를 푸는 network-node-manager (2021-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Kubernetes의 네트워크 이슈를 해결할 수 있는 network-node-manager](https://tech.kakao.com/posts/426)
- 매체 · 게시일: 카카오 기술블로그 · 2021-03-03
- 저자: ssup.2 (클라우드플랫폼팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 만든 이유와 구조 {#overview}

카카오 사내 Kubernetes 플랫폼 DKOS를 운영하다 보니 네트워크 이슈를 여럿 겪었고, 그중 일부는 클러스터를 이루는 노드에 간단한 네트워크 설정을 더하면 풀렸습니다. 노드마다 이 설정을 관리하려고 만든 것이 network-node-manager입니다. 클러스터 노드의 네트워크 설정을 관리하는 Kubernetes Controller이고, 지금은 두 가지 문제를 해결합니다.

- 파드와 클러스터 밖 사이의 connection reset 문제
- IPVS proxy mode에서 External-IP로 접근하지 못하는 문제

쓰려면 클러스터에 배포만 하면 됩니다. 파드 Network CIDR와 kube-proxy 모드(iptables 또는 IPVS)를 알아야 하고, 모드에 따라 동작이 달라집니다. 배포 매니페스트는 모드별로 따로 있고, `POD_CIDR_IPV4`와 `POD_CIDR_IPV6` 환경 변수를 DaemonSet에 지정합니다. IPv6 서비스도 지원합니다.

구조는 DaemonSet으로 모든 노드에 배포되어 Host Network Namespace에서 네트워크 권한으로 동작하므로 노드(호스트)의 네트워크 설정을 바꿀 수 있습니다. Kubernetes API Server에 Watch를 걸어 Service 오브젝트의 변화만 감시하고, 변화에 따라 노드 네트워크를 설정합니다.

## 파드와 클러스터 밖 사이의 connection reset {#connection-reset}

클러스터 안의 클라이언트 파드가 밖의 서버와 통신할 때 파드 안에서 "connection reset by peer" 오류와 함께 TCP 연결이 갑자기 끊길 수 있습니다. 평소에는 거의 없었고, 파드가 서버로 파일 같은 큰 데이터를 보낼 때 겪었다고 합니다.

원인을 이해하려면 통신 경로를 봐야 합니다. 파드가 오버레이 네트워크를 쓰면 요청 패킷은 노드에서 SNAT되어 SrcIP가 파드 IP에서 노드 IP로 바뀝니다. 파드 IP는 클러스터 안에서만 유효하기 때문입니다. 이 SNAT는 kube-proxy나 CNI 플러그인이 설정한 iptables의 MASQUERADE 규칙이 실행합니다. 서버는 노드 IP로 응답하고, 응답은 노드가 아니라 노드 안의 파드가 받아야 하므로 DNAT되어 DstIP가 파드 IP로 바뀝니다. 이 DNAT는 conntrack과 iptables가 암묵적으로 수행합니다.

문제는 외부 서버의 응답 패킷이 외적인 요인으로 순서가 뒤바뀌어(Out of Order) 도착할 때 생깁니다. 정상 패킷이어도 conntrack의 버그 때문에 conntrack이 이를 INVALID로 봅니다. iptables는 INVALID 패킷에는 암묵적 DNAT를 하지 않으므로 패킷이 파드가 아니라 노드로 갑니다. 노드는 정체를 모르는 연결의 패킷을 발견하고 SrcIP로 Connection Reset을 보냅니다. 이를 받은 서버가 연결을 끊고 TCP 규약대로 다시 Reset을 보내며, 이 Reset은 정상 DNAT되어 파드에 "connection reset by peer"를 일으킵니다. 즉 conntrack 버그로 노드가 파드가 받을 패킷을 대신 받고, 노드가 보낸 Reset이 파드와 서버의 연결을 끊습니다. 필자는 tshark로 파드 안과 노드에서 각각 패킷을 떴고, RST 패킷이 노드에서만 보이는 것을 확인했습니다.

우회는 노드로 잘못 전달되는 응답 패킷을 막는 것입니다. network-node-manager는 INPUT 체인에서 NMANAGER_INPUT과 NMANAGER_DROP_INVALID_INPUT을 거쳐 conntrack 기준 INVALID 패킷만 DROP하는 filter 규칙을 만듭니다. 막힌 패킷은 파드에 전달되지 않아 데이터 유실이 우려되지만 TCP 재전송이 보완하므로 문제가 되지 않는다고 설명합니다.

## IPVS 모드에서 External-IP 접근 불가 {#ipvs-external-ip}

kube-proxy를 IPVS 모드로 쓰고 ExternalTrafficPolicy를 Local로 만든 LoadBalancer Service가 있으면, 클러스터 안의 클라이언트 파드가 그 Service의 External-IP로 통신하지 못하는 문제가 있습니다. Cluster-IP로는 통신됩니다. 하지만 일부 사내 개발자가 설정을 단순화하려고 External-IP에 도메인을 달아 그 도메인으로 통신하게 해서 이 문제가 종종 불거졌습니다.

원문의 예는 Service Pod A, B가 모두 Node A에 있는 경우입니다. Node A의 kube-proxy는 External-IP와 NodePort로 온 패킷을 파드 A, B로 전달하도록 IPVS 규칙을 두고, 파드가 없는 Node B는 그 패킷을 Drop하게 둡니다. Local 정책은 노드가 받은 패킷을 같은 노드의 서비스 파드로만 분산하는 설정이라, 로드 밸런서가 파드 없는 노드로 패킷을 보내면 안 됩니다. 그래서 파드가 없는 노드가 Drop하도록 해 두면 로드 밸런서의 Health Check가 실패하고 그 노드로는 패킷이 가지 않습니다. 문제는 Node B에 있는 클라이언트 파드가 External-IP로 보낸 패킷도 같은 규칙에 걸려 Drop된다는 점입니다.

network-node-manager는 클라이언트 파드가 External-IP로 보내는 패킷을 DNAT로 Cluster-IP로 바꿔 줍니다. 그러면 IPVS의 Cluster-IP 규칙에 따라 서비스 파드 A, B로 전달됩니다. 원문 예에서는 External-IP 20.0.0.20으로 보낸 패킷이 Cluster-IP 10.0.0.10으로 DNAT됩니다. 실제 규칙은 두 체인으로 나뉩니다. NMANAGER_EX_CLUS_PREROUTING은 일반 파드의 패킷용이고, NMANAGER_EX_CLUS_OUTPUT은 호스트 네트워크 네임스페이스를 쓰는 파드의 패킷용입니다. 앞의 체인은 SrcIP가 파드 CIDR일 때만 DNAT하게 되어 있어서 파드가 보낸 패킷만 바뀝니다. 또 kube-proxy가 만든 KUBE-MARK-MASQ 체인으로 점프하는 규칙을 두 체인에 넣어, 클라이언트 파드의 패킷이 SNAT되어 SrcIP에 적절한 호스트 IP가 들어가도록 보장합니다. 원문의 `iptables -t nat` 출력에서 두 서비스의 External-IP가 각각의 Cluster-IP로 DNAT되는 규칙을 볼 수 있습니다.

## 남은 과제 {#todo}

이 두 가지 외에도 Kubernetes 네트워크 이슈가 몇 가지 더 있지만, 해결하는 네트워크 설정이 클러스터가 쓰는 CNI 플러그인에 따라 적용되지 않을 수 있어서 공개한 network-node-manager에는 넣지 않았습니다. 이후 CNI 플러그인의 영향을 받지 않는 이슈와 해결 설정을 발견하면 추가할 예정입니다. 원문 끝은 같이 읽으면 좋은 글로 "Cgroup Driver 선택하기"를 안내합니다.
