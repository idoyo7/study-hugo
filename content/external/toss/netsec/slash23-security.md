---
title: "권한이 있어도 기기를 검증하는 토스의 Zero Trust"
description: "사내 접근 권한이 있는데도 왜 기기 상태를 확인할까요? 토스는 신뢰 구간 내부의 위험을 줄이기 위해 IAM과 기기·네트워크 보안을 연결하고, 조직 정보에 맞춰 접근 정책을 전환했습니다."
date: 2026-11-14
weight: 2
---

# 권한이 있어도 기기를 검증하는 토스의 Zero Trust (2023-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [금융사 최초의 Zero Trust 아키텍처 도입기](https://toss.tech/article/slash23-security)
- 매체 · 게시일: 토스 기술 블로그 · 2023-09-01
- 저자: 정연우
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 방화벽 안에서 커진 신뢰의 범위 {#perimeter-limits}

방화벽 같은 경계로 신뢰와 비신뢰 구간을 나누는 보안에는 한계가 있습니다. 신뢰 구간 안에 추가 통제가 없다면, 그 범위가 넓어질수록 보안 위험도 커집니다.

토스에서는 보안 관리도 흩어져 있었습니다. 여러 인증 시스템에서 계정과 권한을 관리해야 했고, 재택근무와 오피스 환경을 따로 운영하면서 보안 상태를 파악하고 관리하기 어려웠습니다. 팀원들의 업무도 불편했습니다. 재택근무 중의 네트워크 통제와 SSL Inspection을 이용한 분석 역시 해결할 과제였습니다.

토스가 선택한 Zero Trust는 방어의 기준을 고정된 네트워크 경계에서 사용자·자산·자원으로 옮기는 방식입니다. 물리적 위치, 네트워크 위치, 자산 소유권만으로 자산이나 계정을 신뢰하지 않는다는 전제에서 출발합니다. 각 영역을 따로 관리하는 데서 그치지 않고, 접근할 때 다른 영역의 정보를 함께 확인하고 보안 이벤트도 모아 분석하도록 연결했습니다.

## 권한 확인 뒤에도 이어지는 IAM 검증 {#components}

기존에는 Application에 로그인할 때 ID/Password와 OTP만 검증했습니다. 전환 후에는 IAM(Identity Access Management)과 SSO(Single Sign On)를 연동해 인증하고, 생체 인증 과정에서 신뢰된 네트워크인지, 회사 자산인지, 기기가 보안 수준을 준수하는지도 확인합니다. 검증 항목이 늘어도 로그인 속도는 지연되지 않습니다.

권한 관리의 기준은 인사 DB입니다. IAM을 인사 DB, Application, Network와 연결하고 직군·팀 단위로 접근을 제어하는 RBAC(Role Based Access Control)를 적용했습니다. 팀원이 퇴직하면 할당된 권한을 자동 회수하며, 직무가 바뀌면 이전 권한을 회수한 뒤 새 직무에 맞게 부여합니다. 인사 정보와 접근 정책을 연결해 보안정책의 가시성을 확보한 것입니다.

권한을 부여받았다고 검증이 끝나지는 않습니다. ABAC(Attribute Based Access Control)는 Role이 있어도 회사가 정한 네트워크·자산·보안 조건을 확인하는 접근 제어입니다. IAM의 Policy에는 이 접근 조건과 함께 ID/PW, MFA(Multi Factor Authentication) 같은 인증 요소를 정의합니다.

Application 로그인 통합에는 SAML, OIDC를 사용합니다. 계정 탈취 같은 위협을 예방하고 막는 데에는 Threat Intelligence 분석과 SIEM(Security Information Event Management) 연동도 포함됩니다.

## 기기 상태를 접근 통제에 연결한 UEM과 EPP {#device-checks}

기기 관리에는 대체 수단이 필요했습니다. Active Directory와 PMS(Patch Management System)로 macOS의 보안 패치, SW 관리, PC 보안 정책을 확보하는 데 어려움이 있었기 때문입니다. 토스는 기기의 보안 설정과 패치 관리를 UEM(Unified Endpoint Management)으로 옮겼습니다.

UEM은 OS와 필수 S/W를 자동 설치하고 패치를 관리하며, 화면보호기와 Disk 암호화 같은 보안 정책을 적용합니다. 하드웨어·네트워크·사용자 정보도 수집합니다. 기기를 분실했을 때 잠금과 초기화를 수행하는 것도 UEM의 기능입니다.

EPP(Endpoint Protection Platform)는 기기의 위협을 탐지하고 대응합니다. Anti-Malware로 악성코드·랜섬웨어·스파이웨어를 막고, EDR(Endpoint Detection & Response)로 File System과 Registry 변경, Process 실행 같은 행동을 분석합니다. 탐지한 위협 정보는 유사한 위협을 예방하고 대응하는 데도 쓰입니다.

이 상태 정보가 접근 판단으로 이어집니다. EPP의 Device Compliance는 OS 보안 설정과 EPP 상태를 평가하고 취약점과 위협을 식별합니다. IAM, SASE, ZTNA가 기기 보안 상태를 접근 제어에 활용하도록 연결하는 기능입니다.

## 근무 장소의 제약을 줄인 SASE와 ZTNA {#after-adoption}

SaaS Application이나 인터넷에 접근할 때는 SASE(Secure Access Service Edge)가, On-Premise나 Public Cloud의 Private 네트워크에 접근할 때는 ZTNA(Zero Trust Network Access)가 동작합니다. 사무실과 재택근무에서 같은 보안 환경을 제공하므로, 팀원은 위치에 큰 제약 없이 업무 시스템에 접속할 수 있습니다.

ZTNA는 IAM과 인사 DB를 연계해 내부 네트워크에 접근할 사용자·그룹을 Role로 정의합니다. 내부 자산은 Domain, IP, Port 등을 사용해 Application 단위의 Segments로 정의하고, Role과 Segments를 조합해 접근을 통제합니다. Role이 있는 사용자도 접근할 때마다 EPP와 연계한 기기 보안 검증을 거치는 방식입니다.

인터넷에서는 SASE가 암호화된 트래픽을 SSL Inspection으로 복호화해 HTTPS 패킷을 분석합니다. URL Filter와 Application Control의 차단 대상은 유해 사이트와 비인가 사이트입니다. DLP로 내부자료·개인정보의 유출을 모니터링하고 막으며, CASB로 Cloud에 보관된 중요 데이터를 보호합니다. File Type Control은 확장자를 기준으로 업로드·다운로드 콘텐츠를 식별하고 차단하는 기능입니다.

악성코드·랜섬웨어·스파이웨어를 식별해 차단하는 기능도 갖췄습니다. ATP는 네트워크 트래픽에서 악성코드와 스팸, 피싱 같은 위협을 찾고 차단합니다. Sandbox는 파일·URL·IP 등의 데이터를 분석해 위협을 식별하고 악성코드를 분석·격리하는 기능입니다.

업무 시스템에 접속할 때는 기기가 보안을 준수하는지 빠르게 검증하고, 인터넷을 이용할 때는 피싱 사이트 같은 위협으로부터 자산과 데이터를 보호합니다. 토스는 이런 전환으로 보안 가시성과 관리 효율을 높이면서 팀원의 업무 편의도 개선했다고 설명합니다.

## 조직 정보에 맞춰 옮긴 방화벽 정책 {#migration}

팀원의 전환 절차는 IAM 계정에서 시작합니다. 관리자가 사전에 팀원 정보를 받아 계정을 만들면, 팀원은 Password와 MFA를 설정합니다.

이어서 기기에서 스크립트를 실행해 AD Join을 풉니다. Active Directory와 PMS가 맡던 보안 설정과 SW 패치 관리를 UEM으로 옮기는 과정입니다. IAM 계정으로 UEM에 로그인하면 미리 정한 보안 설정을 자동 적용합니다. 화면보호기 설정과 디스크 암호화 등이 그 예입니다.

UEM은 더 이상 쓰지 않는 Application을 삭제하고, 앞으로 사용할 웹브라우저·메신저·EPP·SASE·ZTNA를 자동 설치합니다. 마지막으로 SASE와 ZTNA Agent에 IAM 계정으로 로그인하면 팀원의 환경 전환이 끝납니다.

접근 정책은 기존 방화벽 정책을 바탕으로 옮겼습니다. 이때 정책의 기준을 IP에서 토스의 조직 정보에 따른 RBAC로 바꿨습니다. 인사 DB에서 관리하는 직무와 팀 정보가 Application 로그인뿐 아니라 네트워크 접근을 통제하는 기준으로도 이어진 것입니다.
