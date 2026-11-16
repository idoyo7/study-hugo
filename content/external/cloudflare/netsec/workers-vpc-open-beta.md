---
title: "사설망 안의 서비스에 닿는 Workers VPC Services"
description: "전 세계에서 실행되는 Workers는 지역 사설망의 서비스에 어떻게 접근할까요? Workers VPC Services는 Cloudflare Tunnel로 요청을 전달하고, 배포 시점에 권한을 검증하는 바인딩으로 접근 대상을 서비스별로 한정합니다."
date: 2026-11-16
weight: 13
---

# 사설망 안의 서비스에 닿는 Workers VPC Services (2025-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How Workers VPC Services connects to your regional private networks from anywhere in the world](https://blog.cloudflare.com/workers-vpc-open-beta)
- 매체 · 게시일: The Cloudflare Blog · 2025-11-05
- 저자: Thomas Gauvin, Matt Alonso, Eric Falcão
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 핵심 인프라 밖에 머물던 Workers {#private-network-barriers}

Workers는 엣지에서 강점을 발휘했지만, 핵심 인프라의 “밖”에 머무는 경우가 많았습니다. 호출할 수 있는 대상이 공개 엔드포인트로 제한됐기 때문입니다. 사설 계정 API나 내부 재고 데이터베이스처럼 애플리케이션에 꼭 필요한 서비스는 사설망 안에 있었습니다.

그 경계를 연결하는 작업도 간단하지 않았습니다. VPC는 워크로드를 격리하고 보호하지만, 여러 클라우드에 걸쳐 애플리케이션을 만들거나 원하는 기술을 선택하기는 어렵게 만듭니다. VPC peering에는 라우팅 테이블, 보안 그룹, 네트워크 접근 제어 목록 설정이 필요합니다. 많은 조직에서 여러 팀이 승인까지 수 주간 논의하는 작업입니다. 이 복잡함을 줄이려고 만든 “Private Link”도 클라우드마다 구현이 달라, 해당 클라우드와 연동한 공급업체에 대한 의존을 강화했습니다.

Workers VPC Services는 지역 사설망의 서비스를 전 세계 Workers에서 호출하도록 연결합니다. 대상 네트워크에 Cloudflare Tunnel을 설치하고 접근할 서비스를 등록하면, Worker가 어디에서 실행되든 Cloudflare 네트워크가 그 서비스까지 요청을 전달합니다.

Cloudflare가 4월에 소개한 글로벌 가상 사설 클라우드 구상의 첫 이정표입니다. 이번 공개 베타에서는 모든 Workers 사용자가 추가 비용 없이 VPC Services를 이용할 수 있습니다. Cloudflare Tunnel도 무료입니다.

## 서비스 하나로 접근 범위를 좁힌 바인딩 {#service-binding-security}

Workers는 IP 주소를 가진 개별 머신이 아닙니다. Cloudflare 글로벌 네트워크에서 실행되는 스크립트이며, 전통적인 클라우드의 머신처럼 네트워크 안에 존재하지 않습니다. 계정 내 리소스에 안전하게 접근할 때 쓰는 수단이 바인딩이고, VPC Services에도 같은 모델을 적용했습니다.

설정은 사설망에 접근 권한이 있는 Cloudflare Tunnel에서 시작합니다. Tunnel을 한 번 설치한 뒤 서비스의 호스트 이름 또는 IP 주소와 포트를 지정해 VPC Service를 등록합니다. Worker 프로젝트에는 해당 서비스 ID를 가리키는 바인딩을 추가합니다. 코드에서 호출하는 것은 다른 Workers 서비스 바인딩과 같은 전용 `fetch()`입니다.

접근 권한을 확인하는 시점은 배포 때입니다. Worker가 해당 서비스에 접근할 권한이 있는지 검증하고, 배포 후에는 그 바인딩으로 등록된 서비스에만 요청을 보냅니다. 사설망 전체에 접근 권한을 주지 않습니다.

이렇게 하면 어떤 Worker가 어떤 서비스를 호출할 수 있는지가 바인딩에 드러납니다. Cloudflare는 전통적인 네트워크와 접근 제어 목록보다 서비스 접근 권한을 명시적으로 관리하는 방식이라고 설명합니다. 관리 단순화와 SSRF 공격 방어를 위해 설계한 Workers 바인딩 모델을 사설망 접근에도 적용한 것입니다.

## Kubernetes와 개발자 노트북까지 이어진 연결 {#private-beta-use-cases}

비공개 베타에서는 많은 고객이 외부 클라우드와 Workers 사이에 사설 연결을 구축했습니다. AWS, GCP, Azure 같은 클라우드에 있는 서비스를 Workers와 함께 쓰는 구성입니다. Cloudflare도 자체 데이터센터의 Kubernetes 서비스에 Workers를 연결해 여러 서비스의 제어 영역 API를 운영했습니다. 전 세계 규모로 실행할 처리는 Workers에 두고, 상태를 보관하는 백엔드는 이미 신뢰하던 네트워크에 남겨 두는 방식입니다.

온프레미스의 레거시 애플리케이션을 Workers와 연결하는 데도 쓸 수 있습니다. 개발 환경에서도 활용 사례가 나왔습니다. 개발자가 노트북에서 `cloudflared`를 실행해 배포된 Worker를 로컬 머신에 연결하고, 실시간 디버깅에 이용했습니다. Cloudflare Tunnel의 유연한 연결 기능을 Worker 코드에서 직접 호출하게 되면서 열린 쓰임새입니다.

## DNS 질의가 먼저 지나는 Tunnel 경로 {#request-routing-path}

전용 `fetch()` 호출은 Worker가 실행 중인 데이터센터에서 시작합니다. Workers 런타임은 원래 HTTP 요청과 추가 문맥을 Cap’n Proto RPC로 Binding Worker에 보냅니다. Binding Worker는 호출 대상의 서비스 ID를 포함한 정보를 HTTP CONNECT 연결로 Iris에 프록시합니다.

연결 로직을 두는 위치도 의도한 선택입니다. Cloudflare 엣지 서비스에 연결하는 코드를 Workers 런타임 대신 Worker 코드에 두며, 다른 Cloudflare 바인딩에서도 사용하는 패턴입니다.

Iris는 요청을 VPC Service가 있는 네트워크로 보내는 중심 서비스입니다. 먼저 메타데이터에서 서비스 ID를 읽고, 구성 저장소에서 연결된 Tunnel의 ID와 유형을 가져옵니다. 네트워크 연결에는 Cloudflare One의 내부 서비스인 Apollo를 사용합니다. Apollo는 여러 네트워크 계층에 걸친 안전한 연결의 복잡함을 통합 인터페이스 뒤로 감춥니다.

호스트 이름으로 보낸 첫 요청에는 DNS 해석이 앞섭니다. Iris는 서비스 호스트 이름의 A 및 AAAA 레코드를 묻는 UDP 데이터그램을 만들어 Apollo에 보내고, 해석을 마친 뒤 확인된 IP 주소와 포트로 원래 HTTP 요청을 전달합니다.

Apollo는 Tunnel ID를 보고 해당 Tunnel이 연결된 데이터센터를 찾습니다. Tunnel과 가까운 지역의 데이터센터입니다. DNS 질의의 UDP 데이터그램이나 HTTP 요청의 TCP 패킷은 그곳의 Tunnel Connector Service로 향하고, 이 서비스가 QUIC으로 Cloudflare Tunnel에 트래픽을 중계합니다.

마지막 구간은 사설망 안입니다. Tunnel은 자신이 속한 네트워크의 DNS resolver에 질의를 보내며, 원래 HTTP 요청은 자신의 IP 주소에서 목적지 IP와 포트로 전송합니다. 응답은 Tunnel 가까이의 데이터센터를 거쳐, 최초 Worker가 실행 중인 데이터센터까지 돌아옵니다.

첫 요청에서는 Iris 이후 Tunnel까지의 경로를 DNS 질의와 HTTP 요청이 차례로 지납니다. 이후 요청은 Iris에 캐시된 DNS 해석 정보를 활용하므로, DNS 해석에 따른 요청 지연을 줄입니다.

## HTTP 다음을 준비하는 Workers VPC {#planned-expansion}

Cloudflare가 Cloudflare Tunnel을 출발점으로 고른 데에는 이유가 있습니다. 가용성이 높고 유연하며, 이미 익숙하게 쓰는 연결 방식이기 때문입니다. 기업 네트워크의 선택지를 늘리기 위해 표준 IPsec Tunnel, Cloudflare Network Interconnect(CNI), AWS Transit Gateway 지원도 추가할 계획입니다. 연결을 양방향으로 확장해 사설 서비스가 Queues에 이벤트를 보내거나 R2에서 데이터를 가져오도록 하는 작업도 예정되어 있습니다.

프로토콜 확장은 HTTP에서 TCP로 이어집니다. 먼저 Hyperdrive와 통합해 기존 사설 데이터베이스 연결을 VPC Services 설정으로 단순화할 계획입니다. Cloudflare Access를 추가하고 보안 토큰을 관리하는 절차를 없애면서 Hyperdrive의 연결 풀링을 제공하려는 것입니다. 그 이후에는 Workers의 `connect()`에서 Redis 캐시나 메시지 큐에 직접 연결하도록 raw TCP 지원을 넓힐 예정입니다.

기존 라이브러리와의 연결도 남아 있습니다. 전역 `fetch()`나 MongoDB 연결 문자열처럼 호스트 이름이 필요한 곳에서도 VPC Services를 쓰도록, 서비스마다 고유한 호스트 이름을 자동 생성할 계획입니다. 이 이름이 전용 바인딩의 `fetch()`처럼 올바른 VPC Service로 해석되고 라우팅되면, 기존 라이브러리와 ORM에서도 사설 서비스에 연결하기가 쉬워집니다.

{{% details title="설정 예시와 첫 요청의 처리 조건" closed="true" %}}
| 항목 | 값 |
|---|---|
| 원문의 VPC Service 구성 예시 | 서비스 유형 `http`, `http_port: 80`, `https_port: 443` |
| 호스트 이름 해석 대상 | A 및 AAAA 레코드 |
| 첫 요청의 후속 경로 실행 | Iris에서 Apollo를 거쳐 Tunnel로 가는 경로를 DNS 해석과 원래 HTTP 요청에 각각 사용 |
| 이후 요청의 DNS 처리 | Iris에 캐시된 DNS 해석 정보 활용 |
| 공개 베타 제공 조건 | 모든 Workers 사용자에게 추가 비용 없이 제공, Cloudflare Tunnel도 무료 |
{{% /details %}}
