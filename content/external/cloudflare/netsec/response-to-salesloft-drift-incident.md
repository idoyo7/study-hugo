---
title: "Salesloft Drift 침해가 Cloudflare와 고객에게 미친 영향"
description: "Salesloft Drift 연동의 OAuth 자격 증명이 탈취되어 Cloudflare의 Salesforce 케이스 텍스트가 유출된 보안 사고를 정리했습니다. 공격 타임라인과 대응, 유출 범위, 모든 조직을 위한 권고를 요약합니다."
date: 2026-11-14
weight: 7
---

# Salesloft Drift 침해가 Cloudflare와 고객에게 미친 영향 (2025-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [The impact of the Salesloft Drift breach on Cloudflare and our customers](https://blog.cloudflare.com/response-to-salesloft-drift-incident)
- 매체 · 게시일: The Cloudflare Blog · 2025-09-02
- 저자: Sourov Zaman, Craig Strubhart, Grant Bourzikas
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 사고 개요 {#overview}

8월 23일 Cloudflare는 자사와 고객이 Salesloft Drift 침해의 영향을 받았다는 통지를 받았습니다. 외부인이 고객 지원과 내부 케이스 관리에 쓰는 Salesforce 인스턴스와 그 안의 일부 데이터에 접근했습니다. 대부분은 고객 연락처와 기본 지원 케이스 데이터이지만, 일부 지원 대화에는 고객 설정 정보나 액세스 토큰 같은 민감한 내용이 있을 수 있습니다. 원문은 지원 티켓으로 Cloudflare에 공유한 로그, 토큰, 비밀번호를 모두 유출된 것으로 보고 자격 증명을 교체하라고 강하게 권합니다.

Cloudflare가 유출 데이터를 직접 검색해 Cloudflare API 토큰 104개를 찾아 모두 교체했고, 의심스러운 활동은 확인되지 않았습니다. 데이터가 유출된 고객에게는 개별 통지를 마쳤습니다. Cloudflare 서비스와 인프라는 침해되지 않았습니다. 원문은 사용하는 도구를 고른 책임이 Cloudflare에 있다며 사과합니다.

## 침해 경위와 범위 {#breach}

Salesforce는 웹사이트 방문자가 연락할 수 있게 해 주는 Salesloft Drift 챗봇과 연동되어 있었습니다. 위협 행위자가 Salesloft 시스템을 침해해 Drift 챗 에이전트의 Salesforce 연동에 붙은 OAuth 자격 증명을 손에 넣었고, 이를 이용해 Salesloft 고객들의 Salesforce 인스턴스에서 데이터를 빼냈습니다. 원문은 이를 B2B 서드파티 연동을 겨냥한 정교한 공급망 공격이며 전 세계 수백 개 조직이 영향받았다고 설명합니다. Cloudforce One은 이 행위자를 GRUB1로 분류했고 Google Threat Intelligence Group의 공개 내용도 Cloudflare가 본 활동과 일치했습니다.

포렌식 결과 Cloudflare의 Salesforce 테넌트에서 데이터 유출이 일어난 기간은 8월 12일부터 17일이고, 8월 9일에 초기 정찰이 있었습니다. 노출은 케이스 객체로 한정되었습니다. 케이스 객체에는 케이스 관련 연락처 정보, 제목, 본문이 들어 있고 첨부 파일은 없습니다. Cloudflare는 고객에게 비밀을 지원 케이스에 공유하라고 요구하지 않지만 문제 해결 과정에서 고객이 키나 로그를 붙여넣는 경우가 있습니다.

원문은 이 사건이 단발이 아니라, 행위자가 이후 공격에 쓸 자격 증명과 고객 정보를 수집하려 했다고 봅니다. 수백 개 조직이 얽힌 만큼 이 정보로 영향받은 조직의 고객을 겨냥한 표적 공격이 이어질 것으로 의심한다고 적습니다.

## 공격 타임라인 {#timeline}

- 8월 9일 11:51(UTC): GRUB1이 TruffleHog를 User-Agent로 써서 고객 Cloudflare 토큰의 유효성을 검증하는 요청(`client/v4/user/tokens/verify`)을 보냈고 404로 실패했습니다. 토큰의 출처는 불분명하며, 이전에 침해한 다른 Drift 고객일 수 있습니다.
- 8월 12일 22:14: 탈취한 Salesloft 연동 자격 증명으로 Cloudflare의 Salesforce 테넌트에 처음 로그인하고, `/services/data/v58.0/sobjects/`를 호출해 전체 객체를 열거했습니다.
- 8월 13일 19:33: 같은 IP에서 객체 열거를 다시 돌린 뒤 `/sobjects/Case/describe/`로 케이스 스키마를 읽고, 케이스 객체의 필드를 열거하는 넓은 쿼리를 실행했습니다.
- 8월 14일: 몇 시간에 걸쳐 환경을 파악했습니다. 00:17에 계정·연락처·사용자 수를 세어 규모를 재고, 04:34에 CaseTeamMemberHistory를 조회해 케이스 워크플로를 분석했으며, 11:09에 Organization 객체로 프로덕션 환경임을 확인했습니다. 이어 `/limits/` 엔드포인트로 API 한도를 알아냈고, 원문은 이것이 탐지를 피하려고 지켜야 할 한도를 확인하려는 것이었다고 해석합니다.
- 8월 16일 19:26~19:28: 약 48시간 잠잠하다가 돌아와 `SELECT COUNT() FROM Case`로 빼낼 데이터 규모를 마지막으로 확인했습니다.
- 8월 17일 11:11: 새 인프라(다른 IP)로 로그인해 11:11:56에 Salesforce Bulk API 2.0 작업을 띄웠고, 3분 남짓 만에 케이스 텍스트를 빼냈습니다. 11:15:42에 해당 작업을 삭제해 흔적을 지우려 했으나 잔여 로그로 공격을 재구성했습니다. 이후 활동은 없었습니다.

## 대응 {#response}

8월 20일 Salesloft가 전체 고객의 Drift-Salesforce 연결을 해지하고 공지를 올렸지만, 그 시점에 Cloudflare는 통지받기 전이었습니다. 8월 23일 Salesforce와 Salesloft의 통지를 받고 벤더가 권한 봉쇄 조치를 적용한 뒤, 보안·IT·제품·법무·커뮤니케이션·경영진이 하나의 지휘 체계로 전사 보안 사고 대응을 시작했습니다. 우선순위 작업 흐름은 넷입니다.

- 즉각적인 위협 차단: 침해된 Drift 연동을 끄고 포렌식으로 범위를 파악
- 서드파티 생태계 보호: Salesforce에 연결된 모든 서드파티 연동을 끊고 모든 서비스에 새 시크릿을 발급, 매주 교체하는 절차 도입
- 더 넓은 시스템의 무결성 보호: 공격자가 유출 데이터로 다른 시스템에 접근하지 못하도록 모든 서드파티 인터넷 서비스·계정으로 자격 증명 교체를 확대
- 고객 영향 분석: 케이스 데이터에서 고객이 위험에 처할 수 있는지 확인하고 정확한 통지를 준비

8월 25일에는 추가 정보를 받아 대응을 확대했습니다. Drift 사용자 계정을 비활성화하고 클라이언트 ID와 시크릿을 폐기했으며 Cloudflare 시스템에서 Salesloft 소프트웨어와 브라우저 확장을 모두 제거했습니다. 유출 데이터에 노출된 자격 증명이 있는지 정규식, 엔트로피, 패턴 매칭으로 Cloudflare 시크릿을 대규모로 찾는 도구를 직접 만들어 검사했습니다. 노출이 케이스 객체의 자유 텍스트에 한정된다는 결론은 연동, 인증 활동, 엔드포인트 텔레메트리, 네트워크 로그 검토로 검증했습니다.

8월 26~29일에는 끊었던 서드파티 연동을 새 시크릿과 더 엄격한 통제로 하나씩 다시 연결했고, 노출 가능한 데이터를 모두 검토해 Cloudflare 플랫폼이 발급한 API 토큰 104개를 찾는 즉시 교체했습니다. 9월 2일에는 영향받은 모든 고객에게 이메일과 대시보드 배너로 통지했습니다.

## 모든 조직을 위한 권고 {#recommendations}

원문은 SaaS 앱과 서드파티 연동 보안에 경계를 높여야 한다며 일곱 가지를 권합니다.

- Salesloft와 관련 앱을 Salesforce에서 즉시 분리하고 관련 소프트웨어와 브라우저 확장을 제거
- Salesforce에 연결된 모든 서드파티 앱의 자격 증명을 교체. 지원 케이스에 공유했던 자격 증명, 다른 벤더에 보낸 케이스의 자격 증명도 교체
- API 키와 시크릿의 정기 교체 일정 수립
- 서드파티 제공자와 함께 지원 케이스 데이터를 검토해 노출된 민감 정보 파악. Cloudflare 고객은 대시보드의 Support 메뉴에서 케이스 내역을 내려받아 점검 가능
- 서드파티 연동의 접근 로그와 권한 포렌식
- 최소 권한 원칙 적용, 벤더에 관리자 계정 사용 금지, IP 제한과 세션 바인딩 적용
- 대량 내보내기나 낯선 위치의 로그인 같은 이상을 잡는 모니터링 강화

Cloudflare는 후속으로 Birthday Week에 방어 기능을 발표하겠다고 예고했고, Cloudforce One이 GRUB1의 공격 기법을 분석한 글도 내겠다고 밝혔습니다.

{{% details title="공격 시각과 침해 지표" closed="true" %}}

| 항목 | 값 |
|---|---|
| 정찰 시작 | 2025-08-09 11:51 UTC |
| 최초 침입 | 2025-08-12 22:14 UTC |
| 유출 기간 | 2025-08-12~08-17 |
| 대량 유출 작업 | 2025-08-17 11:11:56~11:15:18 UTC |
| 흔적 삭제(작업 삭제) | 2025-08-17 11:15:42 UTC |
| 통지 수신 | 2025-08-23 |
| 교체된 Cloudflare API 토큰 | 104개 |
| 유출 범위 | Salesforce 케이스 객체(제목, 본문, 연락처 정보), 첨부 파일 제외 |
| IOC IP | 44[.]215[.]108[.]109(AWS 기반), 208[.]68[.]36[.]90(DigitalOcean 기반) |
| IOC User-Agent | TruffleHog, Salesforce-Multi-Org-Fetcher/1.0, Salesforce-CLI/1.0, python-requests/2.32.4, Python/3.11 aiohttp/3.12.15 |
{{% /details %}}
