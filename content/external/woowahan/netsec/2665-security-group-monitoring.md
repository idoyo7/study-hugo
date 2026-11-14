---
title: "멀티 계정 환경의 취약한 Security Group 설정 모니터링"
description: "AWS 멀티 계정에서 0.0.0.0/0으로 열린 Security Group 규칙을 CloudTrail 이벤트와 Event Bus, Lambda로 잡아 Slack으로 알리는 구성을 정리했습니다. 권한 제한이나 Trusted Advisor와 비교한 이유도 함께 다룹니다."
date: 2026-11-14
weight: 8
---

# 멀티 계정 환경의 취약한 Security Group 설정 모니터링 (2020-02)

{{< callout type="info" >}}
**원문 정보**
- 원문: [AWS 멀티 계정 환경에서 취약한 Security Group 설정 모니터링](https://techblog.woowahan.com/2665/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2020-02-07
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 클라우드의 장점이 보안에서는 약점이 되는 지점 {#problem}

클라우드의 장점은 리소스를 탄력적으로 쓰고, 비용을 아끼고, 운영 부담을 덜 수 있다는 데 있습니다. 보안 관점에서는 이 장점이 약점이 됩니다. 온프레미스에서는 서버 한 대를 늘려도 여러 의사결정을 거치고, 그 절차가 번거로워도 자연스럽게 자산 관리가 되며 튼튼히 짠 인프라의 보안 수준을 해치지 않고 서버가 추가됩니다. 클라우드에서는 개인이 1분 안에 서버를 만들고 바로 지울 수도 있습니다.

원문은 이 차이를 게임에 빗댑니다. 온프레미스는 '요새 지키기'처럼 최전방에 철벽과 철문을 세워 트래픽을 감시하고 차단하는 구조이고, 클라우드는 '마인크래프트'처럼 누구나 인프라를 지을 수 있어서 튼튼한 요새도, 입구가 많고 누구나 드나드는 허름한 성도 만들 수 있습니다. 클라우드에서 모든 입구에 철벽을 두는 것은 네트워크 아키텍처, 운영, 비용 면에서 제약이 많아서 AWS는 Security Group을 적극 활용합니다.

Security Group은 방화벽처럼 네트워크 접근을 통제하는 AWS 보안 서비스입니다. 기본 정책은 All Deny이고 허용으로 정의한 트래픽만 통과합니다. 프로토콜, 포트 범위, 출발지(CIDR, IPv4, IPv6), 설명, 태그를 설정할 수 있고 무료입니다. 문제는 누군가 실수로 SSH, FTP, DB, RDP 같은 포트를 인터넷 어디서나 접근하게 열어 두고 아무도 오래 모르는 경우입니다. 공격자는 이런 실수를 밤낮없이 스캔합니다.

## 권한 제한과 Trusted Advisor의 한계 {#alternatives}

온프레미스 방화벽처럼 변경 때 정보보안팀의 결재를 받거나, IAM에서 Security Group 관리 권한을 빼고 보안 담당자만 적용하게 하는 방법이 먼저 떠오릅니다. 보수적이고 좋아 보이지만 검수하는 보안 담당자도 기다리는 개발팀도 힘들어지고, 특히 개발팀에게는 클라우드를 쓰는 매력이 사라집니다. 이런 식으로 보수적인 정책을 쌓다 보면 결국 클라우드를 클라우드답게 쓰지 못하게 됩니다.

AWS Trusted Advisor로 취약한 설정을 주기적으로 확인하는 방법도 있습니다. 비용, 성능, 보안, 고가용성, 서비스 한도 측면에서 권장사항을 지키는지 보는 서비스입니다. 보안 조치에는 좋지만 실시간 대응이 어렵고, 사고 분석이나 감사 때는 생성자를 찾으려고 CloudTrail 로그를 다시 뒤져야 합니다. 계정이 10개, 20개, 40개, 100개로 늘수록 효율도 떨어집니다.

## CloudTrail 이벤트 규칙 {#cloudtrail-rule}

원문의 방법은 Security Group이 변경되거나 추가될 때 발생하는 CloudTrail API 호출 이벤트를 CloudWatch에서 모니터링해 누가 취약하게 설정하는지 보는 것입니다. 취약함의 정의는 내부 기준에 따라 다를 수 있는데, 이 글에서는 일반 웹 포트인 80, 443, 8080을 제외한 포트 중 출발지를 0.0.0.0/0으로 지정한 Security Group을 취약하다고 가정합니다.

필요한 이벤트는 `AuthorizeSecurityGroupIngress`입니다. CloudWatch Events의 Rules에서 소스 `aws.ec2`, detail-type `AWS API Call via Cloudtrail`, eventSource `ec2.amazonaws.com`, eventName `AuthorizeSecurityGroupIngress`로 이벤트 패턴을 만듭니다. Security Group과 관련된 다른 이벤트로는 생성, 삭제, 조회, 규칙 추가, 규칙 삭제가 있어 필요하면 참고할 수 있습니다.

## 멀티 계정의 이벤트 중앙화 {#event-bus}

멀티 계정에서는 이 단계에서 로그를 중앙화하는 것이 좋습니다. 컨트롤 계정 하나를 지정해 로그를 모으면 실시간 탐지, 로그 기반 침해사고 분석, 의도치 않은 로그 삭제 대비에 도움이 됩니다. 원문은 중앙 수집 계정을 컨트롤(Control) 계정, 서비스 계정을 플레이어(Player) 계정이라고 부릅니다.

- 플레이어 계정: Rules의 Targets에서 "Event bus in another AWS account"를 고르고 컨트롤 계정 ID를 넣습니다. 이벤트를 보내려면 `events:PutEvents` 권한을 가진 IAM Role이 필요하고, 리소스는 컨트롤 계정의 default event bus입니다.
- 컨트롤 계정: Event Buses 화면에서 각 플레이어 계정을 신뢰 대상으로 등록해 이벤트를 받을 수 있게 합니다. AWS Organization이 활성화돼 있으면 Type을 Organization으로 바꿔 Organization ID로 지정할 수 있고, 아니면 계정 ID를 하나씩 직접 등록해야 합니다.

## Lambda 트리거와 Slack 알림 {#lambda-alert}

컨트롤 계정에도 플레이어 계정의 이벤트를 받는 Rules를 만들고 Targets를 Lambda function으로 지정합니다. 이후 동작은 Lambda를 어떻게 구현하느냐에 달렸습니다. Jira API로 티켓을 만들어 이력을 관리하면서 담당자를 지정하고 메일 알림을 보낼 수도 있고, 문제가 되는 Security Group을 제거할 수도 있습니다. 코드로 구현하기 어렵다면 cloudcustodian 같은 오픈소스를 쓸 수 있습니다. 어느 단계까지 보안 오케스트레이션을 할지는 생산성과 효율을 따져 정하면 됩니다.

원문의 예제 Lambda는 Slack 채널에 알람만 보냅니다. 이벤트에서 계정 ID, 출발지 IP, 리전, 그룹 ID, 요청자 정보, 포트, 프로토콜, IPv4와 IPv6 대역, 설명을 꺼냅니다. 포트가 80, 443, 8080이 아니면서 출발지가 `0.0.0.0/0`(또는 `::/0`)이면 요청자에게 "해당 Security Group을 삭제하거나 출발지를 지정해 달라"는 메시지를 Slack으로 보냅니다. Slack hook URL과 채널은 환경변수로 받고, hook URL은 KMS로 암호화한 값을 씁니다.

## 마무리 {#wrap-up}

이 방식은 실수나 의도하지 않은 Security Group 변경에 빠르게 대응해 계정의 보안 수준을 높여 줍니다. 모니터링 체계를 막 구축했거나 아직 없다면 적용에 앞서 Trusted Advisor로 기존의 취약한 Security Group부터 조치하는 것이 도움이 됩니다. 또 반드시 0.0.0.0/0이 아니어도 네트워크 수준의 이상 트래픽이 들어올 수 있으므로, VPC flow 로그를 CloudWatch나 SIEM과 연동해 트래픽을 가시화하는 추가 모니터링이 필요하다고 덧붙입니다.

{{% details title="이벤트 규칙과 알림 조건" closed="true" %}}

| 항목 | 값 |
|---|---|
| 취약하다고 가정한 설정 | 80, 443, 8080 외 포트에서 출발지 0.0.0.0/0 |
| 감시 이벤트 | `AuthorizeSecurityGroupIngress` |
| 이벤트 소스 | `aws.ec2` / `ec2.amazonaws.com` |
| detail-type | `AWS API Call via Cloudtrail` |
| Event Bus 전송 권한 | `events:PutEvents` (컨트롤 계정 default event bus) |
| 예시 리전 | ap-northeast-2 |
| 알림 대상 | Slack 채널 (환경변수 `slackChannel`, KMS 암호화 hook URL) |

{{% /details %}}
