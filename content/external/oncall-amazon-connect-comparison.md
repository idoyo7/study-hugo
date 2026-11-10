---
title: "Amazon Connect로 만든 두 회사의 온콜 전화"
description: "올리브영과 여기어때가 같은 Amazon Connect 발신 API로 만든 온콜 전화 시스템을 나란히 놓고 비교합니다. 트리거, 수신자 결정, 수신 확인, rate limit, 이중화, 운영 부담이 어디서 갈리는지와 Grafana OnCall OSS 아카이브 이후의 고려 사항을 정리합니다."
date: 2026-11-10
weight: 60
---

# Amazon Connect로 만든 두 회사의 온콜 전화

{{< callout type="info" >}}
**비교 대상**
- [이메일을 트리거로 삼은 Olive Connect]({{< relref "/external/oliveyoung/serverless-oncall-amazon-connect.md" >}}) · 올리브영 테크블로그 · 2025-12-24
- [Grafana OnCall 당번에게 거는 Amazon Connect 장애 전화]({{< relref "/external/yeogi/grafana-oncall-amazon-connect.md" >}}) · 여기어때 기술블로그 · 2025-12-16
- 두 요약과 원문을 바탕으로 비교한 정리입니다. 성과 수치는 각 저자가 밝힌 값입니다.
{{< /callout >}}

## 같은 API에서 갈라진 온콜 설계 {#출발점}

두 회사 모두 상용 온콜 솔루션 대신 Amazon Connect의 아웃바운드 발신 API(`StartOutboundVoiceContact`)로 장애 전화를 겁니다. 올리브영은 해외 번호 스팸 차단과 간헐적 발신 실패를 겪던 외부 솔루션을 대체하며, "전화가 확실히 울리게" 하려고 발신 경로 하나를 단순하고 튼튼하게 만들었습니다. 여기어때가 풀려던 문제는 알람 도구만으로 해결되지 않던 "누가 대응해야 하는가"였습니다. 이를 자동으로 정하기 위해 당번 스케줄과 수신 확인을 중심에 두고, 전화를 그중 한 채널로 붙였습니다.

아래 표는 이 출발점의 차이가 처리 경로와 운영 방식에 어떻게 반영됐는지 정리한 것입니다.

## 두 회사의 설계를 나란히 놓은 비교표 {#비교표}

| 항목 | 올리브영 | 여기어때 |
|---|---|---|
| 출발점 | 외부 온콜 솔루션 대체. 해외 번호 스팸 차단, 간헐적 발신 실패, 월 약 200만 원 이상 고정 비용 | 상용 솔루션은 고가. 대응할 담당자를 자동으로 정하고 싶었음 |
| 시스템 성격 | 범용 발신 엔진. 메일을 보낼 수 있는 도구면 모두 트리거 | Grafana OnCall 중심 온콜 플랫폼. 전화는 그중 한 채널 |
| 트리거 | Datadog·Slack·사내 메일 → SES로 메일 수신 | ① Grafana 경고 → 웹훅 → OnCall ② 자체 스크립트가 ELBv2 API를 주기 호출해 Target Group unhealthy 감지(CloudWatch 경보보다 빠르게) |
| 처리 경로 | SES → SNS → SQS → Lambda | OnCall API 서버 → RabbitMQ → Worker(외부 MySQL, Redis). 감지 스크립트는 asyncio + aioboto3 + aiomysql |
| 실행 환경 | 서버리스 | EKS 위 Helm(oncall 1.16.5), RDS MySQL |
| 수신자 결정 | Google Groups + 플러스 어드레싱(`call+8210…@`). 전화번호 DB 없음 | OnCall DB의 `cached_ical_final_schedule` iCal을 파싱해 현재 당번을 찾음. 전화번호는 LDAP 기반으로 저장 |
| 팀 라우팅 | 팀별 그룹 메일 주소 | Target Group의 `Team` 태그를 OnCall 팀 이름과 1:1 매핑 |
| 에스컬레이션 | 원문에 없음. 그룹 멤버 전원에게 발신 | OnCall Escalation Policy: 1차 → 2차 → 팀 리더 → 팀 채널 |
| 수신 확인 | 원문에 나오지 않음 | Slack "☎ 전화 중지" 버튼 → `stop_contact`, DB를 `acked`로 갱신하고 누른 사람 표시. `firing` 동안은 전화 유지 |
| 발신 API | `StartOutboundVoiceContact` | `start_outbound_voice_contact`(같은 API의 boto3 이름) |
| 안내 음성 | Polly TTS로 메일 제목을 읽음 | Contact Flow 고정 안내 멘트, Quick Connect의 사전 녹음 메시지 |
| 동시 발신 한도 | 약 50명 동시 발신에서 quota 초과로 누락 → TAM 통해 초당 5회로 증설, 운영은 SQS와 Lambda Reserved concurrency 4로 초당 4회 | 원문에 언급 없음 |
| 이중화 | 전화 뒤 같은 내용을 SNS SMS로 발송 | SNS(이메일·SMS 구독자), 시스템 오류 시 별도 Slack 채널로 폴백 |
| 발신 시간대 | 원문에 언급 없음 | 근무시간 외(야간·주말)만 전화, 공휴일 API로 판정 |
| 오발신 방어 | 발신 도메인 허용 목록(자정 스팸 메일 사고 이후 추가) | `acked` 리소스는 재발신 안 함, 테스트·스테이징 Target Group 제외 |
| 저자가 밝힌 성과 | 월 10만 원 이하(약 95% 절감), 46명 전원 발신 약 17초, throttling 0% | 1분 안에 감지, 10초 안에 전화. 비용 수치 없음 |
| 다음 계획 | 외부 AI TTS(클로바 더빙, Typecast) | EC2 상태, RDS 연결 실패, 파드 CrashLoopBackOff, ALB 지연으로 확장 |

## 발신 한도와 내부 DB 의존에 따른 운영 부담 {#운영-부담}

그룹 전원에게 동시에 전화를 거는 올리브영의 구조에서는 인원이 많아질수록 Connect 발신 한도가 먼저 문제가 됐습니다. 초당 4회 제어는 이 구조에서 나온 해법입니다. 시스템은 관리형 서비스 다섯 개(SES, SNS, SQS, Lambda, Connect)로 구성됩니다. 대상자 관리도 이미 쓰던 Google Groups에 맡겨 시스템이 보유한 상태가 거의 없습니다. 다만 원문 범위에서는 당번 순번, 단계별 에스컬레이션, 수신 확인이 보이지 않습니다.

여기어때의 감지 스크립트는 OnCall 내부 DB의 `cached_ical_final_schedule` 필드를 직접 읽습니다. 이 의존 관계 때문에 OnCall 스키마가 바뀌면 당번 조회가 깨질 수 있습니다. 당번 한 명에게 전화를 걸고 Slack 버튼으로 확인을 받으며, 당번이 전화를 놓치면 에스컬레이션으로 넘기는 구조인 만큼 Grafana OnCall 엔진, RabbitMQ, Redis, RDS도 직접 운영해야 합니다.

## 아카이브 이후의 Grafana OnCall OSS {#oncall-oss-아카이브}

Grafana Labs는 2025-03-11에 Grafana OnCall OSS의 유지보수 모드 전환을 알리며 저장소 아카이브 일정을 예고했습니다. 여기어때 원문이 나온 뒤인 2026-03-24에 예고한 대로 저장소를 아카이브했습니다([Grafana 블로그](https://grafana.com/blog/2025/03/11/grafana-oncall-maintenance-mode), [OSS 문서](https://grafana.com/docs/oncall/latest/set-up/open-source/)). 이미 배포한 OSS는 계속 쓸 수 있지만 새 기능과 보안 패치는 더 나오지 않습니다. OSS가 Cloud Connection으로 쓰던 SMS·전화·푸시 알림도 아카이브 당일 종료됐습니다. Grafana는 후속으로 Grafana Cloud IRM을 안내합니다.

여기어때 원문에서는 감지 스크립트가 Connect API를 직접 호출해 전화를 겁니다. 이 경로는 Cloud Connection 종료와 직접 관련이 없어 보입니다. 이는 원문 구조에서 나온 추정이며 원문은 이 일정을 다루지 않습니다. 다만 지금 같은 구조를 새로 만든다면 스케줄·에스컬레이션을 맡길 엔진이 더 이상 개발되지 않는다는 점을 감안해야 합니다.
