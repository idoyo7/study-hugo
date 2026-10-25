---
title: "당근페이가 NAT와 방화벽을 Network VPC로 모은 과정"
description: "당근페이는 VPC마다 흩어진 NAT Gateway와 접근 제어를 Network VPC에 통합했습니다. Transit Gateway와 공인 IP를 유지하며 이전한 순서, AWS Network Firewall 도입 결과와 남은 비용·권한 문제를 정리합니다."
date: 2026-10-21
weight: 6
---

# 당근페이가 NAT와 방화벽을 Network VPC로 모은 과정 (SRE 밋업 4회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [나가는 길을 다시 그리다: 당근페이 VPC 재설계 | 당근 SRE 밋업 4회](https://www.youtube.com/watch?v=nvSKvrP3Z7Y) (28:59)
- 매체 · 게시일: YouTube 당근 채널 · 2025-10-10
- 발표자: 최용환 (Yany, SRE 팀 클라우드 파트). 영상 설명란과 슬라이드 자기소개로 확인했습니다.
- 근거: YouTube 자동 자막 전체 + 발표 슬라이드
- 발표 영상의 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## VPC마다 흩어진 접근 제어가 한계에 닿다 {#흩어진-접근-제어와-늘어나는-예외-경로}

당근페이는 환경마다 VPC를 하나씩, 모두 세 개 운영했습니다. 각 VPC는 AZ 세 개와 NAT Gateway를 사용했고, Transit Gateway(TGW)는 VPC 간 East/West 통신용과 파트너 연결용으로 분리했습니다. 파트너 TGW에는 서비스가 배포된 VPC만 연결되어 있었습니다.

NAT Gateway가 VPC마다 있어 모든 퍼블릭 서브넷의 NACL을 따로 관리해야 했습니다. 아웃바운드 정책도 NACL·보안 그룹·DNS 방화벽에 나뉘었습니다. 파트너가 늘수록 규칙은 복잡해졌지만 NACL은 한 방향의 규칙이 40개를 넘으면 성능 문제가 생겼고, Quota 때문에 IP 규칙을 더 세분화하기도 어려웠습니다.

서비스 VPC 밖에서 파트너로 나가야 하는 예외도 증가했습니다. 프록시 우회 경로마다 TGW와 Attachment가 하나씩 더 필요해 관리 지점과 중복 리소스가 함께 늘었습니다.

## Network VPC로 통합하고 연결을 순서대로 이전

새 Network VPC에 NAT Gateway를 모으고 TGW도 하나로 합쳤습니다. 예외 경로는 TGW Route Table을 분리해 처리했습니다. NAT Gateway는 VPC마다 3개이던 구성을 전체 3개로 줄였고 NACL도 한곳에서 관리하게 됐습니다. 중앙화하면 NACL Quota가 더 빠르게 소진되므로 CIDR·포트·프로토콜·호스트로 규칙을 작성할 수 있는 AWS Network Firewall(NFW)을 함께 선택했습니다.

NFW 배포에는 AWS Firewall Manager를 사용했습니다. VPC마다 엔드포인트를 만드는 Distributed 대신 한 VPC에 모으는 Centralized를 택했습니다. Centralized는 엔드포인트 비용을 줄이는 대신 VPC 간 전송 비용이 늘 수 있습니다. 규칙과 트래픽을 중앙에서 관리하려는 목적, 그리고 당시 트래픽에서 아웃바운드 TGW 비용이 엔드포인트 비용보다 작다는 계산이 선택 근거였습니다.

이전 순서는 TGW, 방화벽, NAT였습니다. 새 계정에 TGW를 만들거나 VPC 간 TGW만 유지하면 Direct Connect와 VPN을 다시 연결해야 하므로 파트너 연결에 다운타임이 생깁니다. 당근페이는 VPC 연결과 오피스 VPN만 옮기면 되는 파트너 TGW 유지안을 가장 수월한 선택으로 판단했습니다.

NAT를 옮길 때는 파트너 방화벽에 등록된 공인 IP를 유지하고 다운타임을 줄여야 했습니다. 먼저 워크로드를 NAT 하나로 모아 나머지를 비운 뒤 삭제했습니다. 해제된 EIP를 Network 계정으로 이전하고 새 VPC에서 같은 IP의 NAT를 만든 다음 라우팅을 TGW로 전환했습니다.

## 접근 제어 통합 결과

- DNS 방화벽과 VPC별 NACL에 흩어진 접근 제어를 NFW 하나로 통합. Suricata 형식 규칙만으로 요구 사항 충족
- 규칙 한도는 NACL의 40개에서 NFW 규칙 Quota 30K로 확대. 현재 200개 이상 사용
- 보안팀이 방화벽 규칙을 관리하면서 보안 정책과 네트워크 설정 분리
- 마이그레이션 중 공인 IP를 유지하고 다운타임을 최소화했다고 발표자가 설명

## 계정 간 권한과 남은 전송 비용

방화벽·네트워크·VPC를 서로 다른 계정에 둔 설계는 운영 권한 문제를 남겼습니다. RAM으로 공유한 리소스의 세부를 볼 수 없어 방화벽 대시보드와 경로를 확인하기 어려웠습니다. 발표자는 Centralized 구성이라면 Firewall Manager 없이 한 계정에서 만들 수도 있었다고 평가했습니다. Site-to-Site VPN을 TGW와 같은 계정에 만들어야 한다는 의존성도 진행 중에 알게 됐습니다.

TGW 전송 비용은 아직 남아 있습니다. 아웃바운드는 TGW Attachment를 거쳐야 하므로 이 비용을 피할 수 없습니다. VPC 간 통신은 전송 비용이 없는 VPC Peering으로 옮길 계획입니다.

## 주요 구간

- [01:00](https://www.youtube.com/watch?v=nvSKvrP3Z7Y&t=60s) 이전 네트워크 구조
- [03:00](https://www.youtube.com/watch?v=nvSKvrP3Z7Y&t=180s) 이전 구성의 문제점
- [06:30](https://www.youtube.com/watch?v=nvSKvrP3Z7Y&t=390s) Network VPC와 Network Firewall 도입안
- [12:00](https://www.youtube.com/watch?v=nvSKvrP3Z7Y&t=720s) Transit Gateway 마이그레이션
- [19:00](https://www.youtube.com/watch?v=nvSKvrP3Z7Y&t=1140s) NAT 마이그레이션과 공인 IP 보존
- [24:30](https://www.youtube.com/watch?v=nvSKvrP3Z7Y&t=1470s) 결과와 아쉬운 점

{{% details title="근거와 세부 수치" closed="true" %}}

| 항목 | 내용 | 근거 |
|---|---|---|
| 기존 구성 | 환경별 VPC 3개, AZ 3개, VPC별 NAT Gateway, TGW 2개(파트너용, East/West용) | 슬라이드 |
| NACL 한계 | 방향당 규칙 40개를 넘으면 성능 문제 | 슬라이드 |
| NAT Gateway | VPC당 3개에서 총 3개 | 슬라이드 |
| NFW 배포 | Firewall Manager, Centralized | 슬라이드 |
| 센트럴라이즈 판단 근거 | 현 트래픽 크기에서 엔드포인트 비용보다 TGW 전송 비용이 더 저렴 | 슬라이드 |
| TGW 시나리오 | 1안 신규 생성, 2안 VPC 간 TGW 유지, 3안 파트너 TGW 유지(채택) | 슬라이드 |
| 규칙 한도 | NACL 40개에서 NFW 규칙 Quota 30K, 현재 200개 이상 사용 | 슬라이드 |
| TGW 전송 요금 | 처리 데이터 GB당 0.02 USD | 슬라이드 |
| VPC Peering | VPC 간 데이터 전송 비용 무료 | 슬라이드 |
| 규칙 형식 | Suricata 규칙(프로토콜, IP, 포트, 방향) | 슬라이드, 자막 기준 |

NACL 한계는 자동 자막에 "4개", 슬라이드에 40개로 나옵니다. 이 요약은 슬라이드 값을 따랐습니다. 영상과 슬라이드에는 마이그레이션 작업 기간, 다운타임 시간, 비용 절감 폭이 나오지 않습니다.

{{% /details %}}
