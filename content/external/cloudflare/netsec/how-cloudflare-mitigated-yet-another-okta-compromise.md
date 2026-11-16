---
title: "Okta 통보보다 먼저 시작된 Cloudflare의 침해 대응"
description: "Okta의 관리자 세션을 악용한 공격자를 Cloudflare는 어떻게 막았을까요? Okta의 통보보다 24시간 넘게 앞서 침입을 탐지했고, 공격자가 고객 데이터와 시스템에 접근하기 전에 봉쇄했습니다."
date: 2026-11-14
weight: 11
---

# Okta 통보보다 먼저 시작된 Cloudflare의 침해 대응 (2023-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How Cloudflare mitigated yet another Okta compromise](https://blog.cloudflare.com/how-cloudflare-mitigated-yet-another-okta-compromise)
- 매체 · 게시일: The Cloudflare Blog · 2023-10-20
- 저자: Sourov Zaman, Lucas Ferreira, Kimberly Hall, Grant Bourzikas
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

공격자는 관리자 권한이 있는 Okta 세션으로 Cloudflare의 Okta 인스턴스에 들어왔습니다. Cloudflare는 공격자가 지속 거점을 확보하기 전에 봉쇄했고, 고객 정보와 고객 시스템에는 영향이 없음을 확인했습니다.

## Okta 통보보다 앞섰던 내부 탐지 {#containment}

2023년 10월 18일(수), Cloudflare는 자사 시스템에서 공격을 발견하고 그 경로를 Okta까지 추적했습니다. 내부 탐지는 Okta의 통보보다 24시간 넘게 빨랐습니다. 침해 사실을 먼저 알린 쪽도 Cloudflare였습니다.

Security Incident Response Team(SIRT)은 Cloudflare Zero Trust Access, Gateway, Data Loss Prevention과 Cloudforce One의 위협 연구를 활용해 침해 범위를 확인하고 공격을 봉쇄했습니다. 공격자가 고객 데이터·고객 시스템·프로덕션 네트워크에 접근하기 전이었습니다. 프로덕션 환경을 보호하는 Cloudflare의 Zero Trust 아키텍처가 고객 피해를 막는 데 기여했습니다.

## 침입에 쓰인 Okta 관리자 세션 {#incident}

Okta의 공식 성명에 따르면 공격자는 고객 지원 시스템에 접근해 일부 고객이 최근 지원 요청에 첨부한 파일을 열람했습니다. Cloudflare의 경우에는 직원이 만든 지원 티켓에서 세션 토큰을 탈취한 것으로 보입니다. 공격자는 이 토큰으로 10월 18일 Cloudflare 시스템에 접근했습니다. Cloudflare가 확인한 침해 대상은 Okta 안의 직원 계정 두 개였습니다.

Okta 시스템 침해가 Cloudflare에 영향을 준 것은 이번이 두 번째입니다. 2022년 3월에는 다중 요소 인증(MFA)에 쓴 하드웨어 키가 공격을 막아, 공격자가 Cloudflare의 어떤 시스템이나 데이터에도 접근하지 못했습니다. 이번에 공격자가 악용한 것은 이미 열려 있던 관리자 세션이었습니다.

## Okta 고객이 확인할 계정과 세션 {#customer-recommendations}

Cloudflare는 Okta 고객에게 자사에 미쳤을 수 있는 영향을 Okta에 문의하고, 모든 사용자 계정에 하드웨어 MFA를 적용하라고 권고했습니다. 하드웨어 키 사용은 특히 강하게 권했습니다. 비밀번호만으로는 공격을 막는 데 필요한 보호 수준을 확보할 수 없고, 다른 MFA 방식은 피싱에 취약할 수 있다는 이유입니다.

조사 대상은 예기치 않은 비밀번호·MFA 변경과 지원 측에서 시작된 의심스러운 이벤트입니다. 모든 비밀번호 재설정이 정당한지 확인하고, 의심되는 계정에는 비밀번호 재설정을 강제하라는 권고입니다. 의심스러운 MFA 이벤트도 조사하고 대응해야 합니다. 이때 사용자 계정에 유효한 MFA 키만 등록돼 있는지도 확인하도록 권했습니다.

### 모니터링할 이벤트와 상태 {#monitoring}

- Okta 사용자 생성과 재활성화
- 모든 세션에 적절한 인증이 연결돼 있는지 여부
- Okta 계정과 권한 변경
- MFA 정책 우회, MFA 변경·삭제
- 민감한 애플리케이션의 위임
- 공급망 업체의 테넌트 접근

세션 하이재킹을 줄이기 위한 세션 만료 정책 검토도 권고에 포함됐습니다. 핵심 시스템에 연결된 기기는 Cloudflare Access Device Posture Check 같은 도구로 검증하고, 탐지와 모니터링에는 심층 방어를 적용하라고 권했습니다.

## 신고 뒤에도 이어진 Okta 지원 시스템 접근 {#okta-recommendations}

BeyondTrust는 2023년 10월 2일 Okta에 처음 침해를 알렸습니다. 그런데도 공격자는 적어도 10월 18일까지 지원 시스템에 접근할 수 있었습니다. Cloudflare가 Okta에 침해 신고를 심각하게 받아들이고 피해를 즉시 제한하라고 촉구한 배경입니다.

침해가 고객에게 영향을 준 사실을 알게 되면 적시에 책임 있게 공개하라는 요구도 있습니다. 서드파티 지원 업체를 포함한 모든 시스템에 하드웨어 키를 요구하라고도 권고했습니다. Cloudflare는 이를 Okta 같은 핵심 보안 서비스 제공자가 갖춰야 할 기본 요건으로 봤습니다.

Cloudflare는 Okta가 추가 정보를 공개하거나 로그 분석에서 새 사실이 확인되면 글을 갱신하겠다고 밝혔습니다.

{{% details title="사고 시점과 확인 결과" closed="true" %}}
| 항목 | 값 |
|---|---|
| BeyondTrust가 Okta에 통보 | 2023-10-02 |
| Cloudflare 시스템 접근 및 탐지 | 2023-10-18 |
| Okta 통보보다 앞선 내부 탐지 | 24시간 이상 |
| 침해된 직원 계정 | Okta 내 2개 |
| 고객 정보·시스템 영향 | 없음(Cloudflare 확인) |
| 이전 사건 | 2022-03 Okta 침해(하드웨어 키 MFA로 차단) |
{{% /details %}}
