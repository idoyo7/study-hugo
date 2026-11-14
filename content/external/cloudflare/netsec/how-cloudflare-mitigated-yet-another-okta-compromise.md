---
title: "Okta 세션 토큰 탈취 사고와 Cloudflare의 차단"
description: "2023년 10월 Okta 지원 시스템에서 탈취된 세션 토큰으로 Cloudflare의 Okta 인스턴스가 침입당했고, 보안팀은 지속 거점이 생기기 전에 이를 차단했습니다. 사고 경과와 Okta·Okta 고객에게 한 권고를 정리했습니다."
date: 2026-11-14
weight: 11
---

# Okta 세션 토큰 탈취 사고와 Cloudflare의 차단 (2023-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How Cloudflare mitigated yet another Okta compromise](https://blog.cloudflare.com/how-cloudflare-mitigated-yet-another-okta-compromise)
- 매체 · 게시일: The Cloudflare Blog · 2023-10-20
- 저자: Sourov Zaman, Lucas Ferreira, Kimberly Hall, Grant Bourzikas
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 사고 경위 {#incident}

2023년 10월 18일(수) Cloudflare는 자사 시스템에 대한 공격을 발견했고, 이를 Okta까지 거슬러 올라가 추적했습니다. 위협 행위자가 Okta에서 탈취한 인증 토큰을 이용해 Cloudflare의 Okta 인스턴스로 넘어왔습니다. Security Incident Response Team(SIRT)의 실시간 탐지와 신속한 대응으로 봉쇄했고, 고객 정보나 고객 시스템에는 영향이 없다고 확인했습니다. Okta도 이 사고에 대한 공식 성명을 냈습니다.

Okta 시스템 침해가 Cloudflare에 영향을 준 것은 이번이 두 번째입니다. 2022년 3월 사건 때는 위협 행위자가 어떤 시스템이나 데이터에도 접근하지 못했고, MFA에 하드웨어 키를 쓴 것이 공격을 막았다고 결론지었습니다.

Okta의 성명에 따르면 위협 행위자는 Okta의 고객 지원 시스템에 접근해 일부 고객이 최근 지원 케이스에 올린 파일을 열람했습니다. Cloudflare 경우에는 직원이 만든 지원 티켓에서 세션 토큰이 탈취된 것으로 보입니다. 공격자는 이 토큰으로 10월 18일에 Cloudflare 시스템에 접근했고, Okta 안의 직원 계정 두 개가 침해된 것을 확인했습니다. 원문은 Okta의 통보보다 24시간 넘게 앞서 내부에서 이 활동을 탐지했다고 하며, Okta에 먼저 침해 사실을 알렸다고 합니다.

## 차단 방식 {#containment}

공격자가 쓴 것은 관리자 권한이 있는 Okta의 열린 세션이었습니다. Cloudflare는 Zero Trust Access, Gateway, Data Loss Prevention과 위협 연구팀 Cloudforce One을 활용해 사고 범위를 검증하고, 공격자가 고객 데이터·고객 시스템·프로덕션 네트워크에 닿기 전에 봉쇄했습니다. 지속 거점을 확보하기 전에 막았으며, Zero Trust 구조가 프로덕션 환경을 보호해 고객에게 가는 영향을 막았다고 설명합니다.

## Okta에 대한 권고 {#okta-recommendations}

- 침해 신고를 심각하게 받아들이고 즉시 피해를 제한할 것. 이번에는 10월 2일 BeyondTrust가 Okta에 알렸지만 공격자는 적어도 10월 18일까지 지원 시스템에 접근 권한을 갖고 있었음
- 자사 시스템 침해가 고객에게 영향을 준 사실을 알게 되면 시의적절하고 책임 있게 공개할 것
- 서드파티 지원 업체를 포함한 모든 시스템을 하드웨어 키로 보호하도록 요구할 것

핵심 보안 서비스 제공자라면 이 정도는 기본 요건이라는 입장입니다.

## Okta 고객에 대한 권고 {#customer-recommendations}

Okta 고객은 먼저 Okta에 잠재적 영향을 문의하라고 권하며, 다음 조치도 함께 제안합니다.

- 모든 사용자 계정에 하드웨어 MFA 적용(다른 방식은 피싱에 취약할 수 있음)
- 예기치 않은 비밀번호·MFA 변경, 의심스러운 지원 요청 이벤트 조사. 모든 비밀번호 재설정이 유효한지 확인하고 의심 계정은 재설정을 강제하며, MFA 이벤트가 의심스러우면 유효한 MFA 키만 남았는지 확인
- 새로 만든 Okta 사용자, 사용자 재활성화, 세션별 적절한 인증, 계정·권한 변경, MFA 정책 우회·변경·삭제, 민감한 애플리케이션 위임, 공급망 업체의 테넌트 접근 모니터링
- 세션 하이재킹을 줄이도록 세션 만료 정책 점검
- Cloudflare Access Device Posture Check 같은 도구로 핵심 시스템에 접속하는 기기 검증
- 탐지와 모니터링에 심층 방어 적용

원문은 Okta가 추가 정보를 공개하거나 로그 분석에서 새 사실이 나오면 글을 갱신하겠다고 밝힙니다.

{{% details title="날짜와 수치" closed="true" %}}
| 항목 | 값 |
|---|---|
| BeyondTrust가 Okta에 통보 | 2023-10-02 |
| Cloudflare 시스템 접근 및 탐지 | 2023-10-18 |
| Okta 통보보다 앞선 내부 탐지 | 24시간 이상 |
| 침해된 직원 계정 | Okta 내 2개 |
| 고객 정보·시스템 영향 | 없음(Cloudflare 확인) |
| 이전 사건 | 2022-03 Okta 침해(하드웨어 키 MFA로 차단) |
{{% /details %}}
