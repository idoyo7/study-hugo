---
title: "나가는 길을 다시 그리다: 당근페이 VPC 재설계"
description: "당근 SRE 밋업 4회에서 클라우드 파트 최용환이 발표한 당근페이 VPC 재설계 요약입니다. 흩어진 NAT Gateway와 Transit Gateway를 Network VPC로 모으고 NACL을 AWS Network Firewall로 바꾼 과정과 아쉬운 점을 다룹니다."
date: 2026-10-21
weight: 6
---

# 나가는 길을 다시 그리다: 당근페이 VPC 재설계 (SRE 밋업 4회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [나가는 길을 다시 그리다: 당근페이 VPC 재설계 | 당근 SRE 밋업 4회](https://www.youtube.com/watch?v=nvSKvrP3Z7Y) (28:59)
- 매체 · 게시일: YouTube 당근 채널 · 2025-10-10
- 발표자: 최용환 (Yany, SRE 팀 클라우드 파트). 영상 설명란과 슬라이드 자기소개로 확인했습니다.
- 근거: YouTube 자동 자막 전체 + 발표 슬라이드
- 이 문서는 영상을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## 주요 구간

- [01:00](https://www.youtube.com/watch?v=nvSKvrP3Z7Y&t=60s) 이전 네트워크 구조
- [03:00](https://www.youtube.com/watch?v=nvSKvrP3Z7Y&t=180s) 이전 구성의 문제점
- [06:30](https://www.youtube.com/watch?v=nvSKvrP3Z7Y&t=390s) Network VPC와 Network Firewall 도입안
- [12:00](https://www.youtube.com/watch?v=nvSKvrP3Z7Y&t=720s) Transit Gateway 마이그레이션
- [19:00](https://www.youtube.com/watch?v=nvSKvrP3Z7Y&t=1140s) NAT 마이그레이션과 공인 IP 보존
- [24:30](https://www.youtube.com/watch?v=nvSKvrP3Z7Y&t=1470s) 결과와 아쉬운 점

## 흩어진 접근 제어와 늘어나는 예외 경로

당근페이는 환경별로 VPC 세 개를 두고, 각 VPC에서 AZ 세 개와 NAT Gateway를 썼습니다. Transit Gateway(TGW)는 VPC 사이 통신(East/West)용과 파트너사 연결용으로 나뉘어 있었습니다. 파트너 TGW에 연결된 곳은 서비스가 배포되는 VPC뿐입니다.

VPC마다 NAT Gateway가 있어 모든 퍼블릭 서브넷의 NACL을 세밀하게 관리해야 했습니다. 아웃바운드 제어도 NACL, 보안 그룹, DNS 방화벽에 흩어져 있었습니다. 파트너가 늘수록 정책은 복잡해졌지만, NACL은 방향당 규칙이 40개를 넘으면 성능 문제가 생겼습니다. Quota 때문에 IP 기준 규칙을 더 잘게 나누기도 어려운 상태였습니다.

서비스 VPC 밖에서 파트너에 접근하는 예외도 늘었습니다. 이를 처리하려면 프록시를 거치는 우회 경로에 TGW 하나와 Attachment 하나가 더 필요했습니다. 관리 지점이 많아지고 리소스도 겹치는 구성이었습니다.

## Network VPC로 통합하고 연결을 순서대로 이전

당근페이는 Network VPC를 만들어 NAT Gateway를 모으고, TGW는 하나로 합쳤습니다. 예외 경로는 TGW의 Route Table을 나눠 처리했습니다. NAT Gateway는 VPC당 3개에서 총 3개로 줄고, NACL 규칙도 한 곳에서 관리합니다. 이 구성에서는 NACL Quota가 더 빠듯해지므로 대체 방화벽도 함께 고려했습니다. CIDR, 포트, 프로토콜, 호스트 기준으로 규칙을 쓸 수 있는 매니지드 서비스 AWS Network Firewall(NFW)을 선택했습니다.

NFW는 AWS Firewall Manager로 배포했습니다. VPC마다 엔드포인트를 두는 Distributed와 한 VPC에만 두는 Centralized 중 Centralized를 골랐습니다. Centralized는 엔드포인트 비용이 적은 대신 VPC 사이 트래픽 전송 비용이 커질 수 있습니다. 당근페이는 규칙과 트래픽을 중앙에서 관리하려 했고, 자사 트래픽 규모에서는 아웃바운드의 TGW 전송 비용이 엔드포인트 비용보다 적다고 판단했습니다.

마이그레이션은 TGW, 방화벽, NAT 순서로 진행했습니다. 새 계정에 TGW를 만드는 안은 Direct Connect와 VPN을 모두 다시 연결해야 해 파트너 연결이 끊기는 다운타임이 생깁니다. VPC 간 TGW를 유지하는 안도 Direct Connect와 VPN을 다시 맺어야 합니다. 당근페이는 쉽게 옮길 수 있는 VPC 연결과 오피스 VPN만 교체하면 되는 파트너 TGW 유지안이 가장 수월하다고 보고 이 안을 택했습니다.

NAT 이전의 조건은 파트너사 방화벽에 등록된 공인 IP 보존과 다운타임 최소화였습니다. 워크로드 경로를 NAT 하나로 모은 뒤 비운 NAT를 삭제했습니다. 여기서 풀린 EIP를 Network 계정으로 이전하고, 새 VPC에 같은 IP로 NAT를 만든 다음 경로를 TGW 쪽으로 돌렸습니다.

## 접근 제어 통합 결과

- DNS 방화벽과 VPC별 NACL에 흩어진 접근 제어를 NFW 하나로 통합. Suricata 형식 규칙만으로 요구 사항 충족
- 규칙 한도는 NACL의 40개에서 NFW 규칙 Quota 30K로 확대. 현재 200개 이상 사용
- 보안팀이 방화벽 규칙을 관리하면서 보안 정책과 네트워크 설정 분리
- 마이그레이션 중 공인 IP를 유지하고 다운타임을 최소화했다고 발표자가 설명

## 계정 간 권한과 남은 전송 비용

발표자는 방화벽, 네트워크, VPC를 각각 다른 계정에 둔 구성을 아쉬워했습니다. RAM 공유에 의존했지만 리소스 세부를 볼 수 없어 방화벽 대시보드 확인과 경로 파악에 필요한 권한이 부족했습니다. Centralized라면 Firewall Manager 없이 한 계정에서 만들어도 되었을 것이라는 평가입니다. Site-to-Site VPN을 TGW와 같은 계정에서 만들어야 한다는 의존성도 처음에는 몰랐다고 합니다.

TGW 전송 비용은 남은 과제입니다. 아웃바운드는 TGW Attachment가 필요해 전송 비용을 피할 수 없다고 설명했습니다. VPC 사이 통신은 전송 비용이 들지 않는 VPC Peering으로 옮길 계획이라고 합니다.

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
