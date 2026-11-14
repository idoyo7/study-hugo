---
title: "토스의 Zero Trust 아키텍처 도입"
description: "토스가 방화벽 경계 중심의 보안에서 Zero Trust로 옮겨 간 이유와 구성 요소, 전환 절차를 정리했습니다. IAM, SASE, ZTNA, UEM, EPP를 연계해 보안 가시성과 업무 편의를 함께 챙긴 사례입니다."
date: 2026-11-14
weight: 2
---

# 토스의 Zero Trust 아키텍처 도입 (2023-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [금융사 최초의 Zero Trust 아키텍처 도입기](https://toss.tech/article/slash23-security)
- 매체 · 게시일: 토스 기술 블로그 · 2023-09-01
- 저자: 정연우
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 경계 중심 보안의 한계 {#perimeter-limits}

전통적 보안은 방화벽 같은 경계로 신뢰와 비신뢰 구간을 나눕니다. 신뢰 구간 안에 추가 통제가 없고 그 범위가 커지면 보안 위험도 같이 커집니다. 토스는 여기에 더해 다원화된 Identity 관리, 보안 솔루션 관리, 재택근무와 오피스 환경의 이원화 때문에 보안 가시성을 확보하고 관리하기 어렵고 팀원들의 업무도 불편하다고 보았고, 이를 풀려고 Zero Trust 보안 아키텍처를 도입했습니다.

Zero Trust는 고정된 네트워크 경계를 지키던 방어를 사용자, 자산, 자원 중심의 방어로 바꾸는 보안 패러다임입니다. 물리적 위치, 네트워크 위치, 자산 소유권만으로 자산이나 계정에 암묵적 신뢰를 주지 않는다고 가정합니다.

## 도입 전의 고민 {#concerns}

토스는 영역별로 현재의 리스크를 정리하고 대체하거나 보완할 방법을 고민했습니다.

- Identity: 다원화된 인증 시스템 때문에 계정과 권한 관리가 어려워 가시성이 낮았고, 이를 통합 관리해 가시성을 확보
- Device: Active Directory와 PMS(Patch Management System)로는 macOS의 보안 패치, SW 관리, PC 보안 정책을 확보하기 어려워 대체 수단 마련
- Network: 재택근무 시 네트워크 보안 통제와 SSL Inspection을 통한 분석이 어려워 대체 수단을 마련하고, 사내 네트워크에 접근할 때 추가 검증으로 위협을 예방
- 영역 간 연계: Application이나 사내 네트워크에 접근할 때 Endpoint 정보를 식별해 접근 여부를 정하고, 사내 네트워크 접근 통제에 Identity 정보를 쓰는 식으로 연결
- 각 영역의 이벤트를 통합 분석해 위협을 식별하고 대응

## 주요 컴포넌트와 기능 {#components}

Identity, Device, Network, Data, Application 각 영역에서 보안성과 가시성을 확보하고, 영역 간 연계로 접근 통제를 더하고, 통합 이벤트 분석으로 위협을 찾는 구조입니다. 기능은 다섯 묶음입니다.

IAM(Identity Access Management)은 SAML, OIDC 기반 Single Sign On, 인사 DB와 연계한 직군·팀 단위 RBAC, 네트워크·자산·보안 검증을 더하는 ABAC, 접근 시 인증 요소(ID/PW, MFA 등)를 정의하는 Policy, Threat Intelligence와 SIEM 연동으로 계정 탈취 같은 위협을 막는 Security를 담당합니다.

SASE(Secure Access Service Edge)는 SSL Inspection으로 암호화 트래픽을 복호화해 HTTPS 패킷을 분석하고 URL Filter와 Application Control로 유해·비인가 사이트를 막습니다. DLP, 파일 확장자 기반 File Type Control, CASB로 데이터 유출을 막고, 악성코드, ATP, Sandbox로 위협을 식별하고 격리합니다.

ZTNA(Zero Trust Network Access)는 IAM과 인사 DB로 내부 네트워크 접근 사용자·그룹(Role)을 정의하고, 내부 자산을 Domain, IP, Port 등 Application 단위(Segments)로 정의해 Role과 Segments로 접근을 통제합니다. Role이 있는 사용자도 접근할 때마다 EPP와 연계해 Device 보안성을 검증합니다.

UEM(Unified Endpoint Management)은 Device 보안과 SW, 하드웨어·네트워크·사용자 정보 수집과 분실 시 잠금·초기화, OS와 필수 S/W의 자동 설치와 패치, 화면보호기·Disk 암호화 같은 보안 정책 준수를 관리합니다. EPP(Endpoint Protection Platform)는 Anti-Malware, 행동 분석 기반 EDR, 그리고 OS 보안 설정과 EPP 상태를 평가해 IAM, SASE, ZTNA의 접근 제어에 넘기는 Device Compliance를 담당합니다.

## 전환 절차 {#migration}

전환은 세 단계였습니다. 먼저 IAM 온보딩으로, 관리자가 팀원 정보를 받아 계정을 만들면 팀원이 Password와 MFA를 설정합니다. 다음은 Active Directory 제거와 UEM Join으로, AD와 PMS로 Device 설정과 SW 패치를 관리하는 일을 그만두고 스크립트로 AD Join을 풀어 IAM으로 UEM에 로그인합니다. 로그인하면 화면보호기와 디스크 암호화 같은 보안 설정이 자동 적용되고, 쓰지 않는 Application은 삭제되고, 웹브라우저, 메신저, EPP, SASE, ZTNA 같은 필요한 Application이 자동 설치됩니다. 마지막으로 SASE와 ZTNA Agent에 IAM 계정으로 로그인하면 전환이 끝납니다. 정책은 기존 방화벽 정책을 바탕으로 옮기되 IP 기반이 아니라 토스의 조직 정보에 따른 RBAC 기반으로 옮겼습니다.

## 도입 후의 변화 {#after-adoption}

로그인은 IAM과 SSO로 연동된 Application마다 IAM 인증을 거칩니다. 예전에는 ID/Password와 OTP로만 검증했다면, 이제는 신뢰된 네트워크인지, 회사 자산인지, Device 보안 수준을 지켰는지를 추가로 검증하며 이 검증은 생체 인증 과정에서 이뤄집니다. 검증이 늘어도 로그인 속도는 지연되지 않는다고 합니다.

네트워크는 SaaS나 인터넷에는 SASE가, On-Premise나 Public Cloud 같은 Private 네트워크에는 ZTNA가 동작합니다. 사무실이든 재택이든 위치 제약 없이 같은 보안 환경으로 업무 시스템에 접속할 수 있고, 접속하는 Device가 보안을 지키는지 빠르게 검증하며, 인터넷에서는 피싱 사이트로부터 자산과 데이터를 보호합니다.

인사 DB와 IAM, 그리고 Application과 Network를 연동해 직무(Role) 기반 접근 제어 정책을 만들었습니다. 퇴직하면 할당된 권한이 자동 회수되고, 직무가 바뀌면 권한이 회수된 뒤 새 직무에 맞게 재할당됩니다.

## 마무리 {#wrap-up}

원문은 Zero Trust 도입으로 보안 가시성을 확보하고 보안 관리를 효율화하면서 팀원의 업무 편의도 높아졌다고 정리합니다. IAM, ZTNA, UEM, EPP, SIEM 등을 연계해 서로 보완하도록 아키텍처를 구축했다는 설명도 덧붙입니다.
