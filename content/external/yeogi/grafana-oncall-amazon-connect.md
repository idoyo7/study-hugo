---
title: "Grafana OnCall 당번에게 거는 Amazon Connect 장애 전화"
description: "여기어때컴퍼니 SRE팀이 LGTM 스택에 Grafana OnCall을 연결하고, ALB Target Group의 unhealthy 상태를 직접 감지해 당번에게 Amazon Connect로 전화하는 구조를 정리합니다. OnCall DB의 iCal 일정 조회, Slack 전화 중지 버튼, 야간·주말에만 발신하는 운영 규칙을 다룹니다."
date: 2026-11-10
weight: 1
---

# Grafana OnCall 당번에게 거는 Amazon Connect 장애 전화 (2025-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [“서버가 죽었어요”에서 시작된 이야기, Grafana OnCall과 Amazon Connect로 완성한 실전형 온콜 시스템](https://techblog.gccompany.co.kr/%EC%84%9C%EB%B2%84%EA%B0%80-%EC%A3%BD%EC%97%88%EC%96%B4%EC%9A%94-%EC%97%90%EC%84%9C-%EC%8B%9C%EC%9E%91%EB%90%9C-%EC%9D%B4%EC%95%BC%EA%B8%B0-grafana-oncall%EA%B3%BC-amazon-connect%EB%A1%9C-%EC%99%84%EC%84%B1%ED%95%9C-%EC%8B%A4%EC%A0%84%ED%98%95-%EC%98%A8%EC%BD%9C-%EC%8B%9C%EC%8A%A4%ED%85%9C-6795f3c044fd)
- 매체 · 게시일: 여기어때 기술블로그 · 2025-12-16
- 저자: 캐쉬(백인출, SRE팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 장애 대응자를 정하고 전화를 거는 온콜 시스템 {#문제의식}

서비스 전체에 영향을 주는 장애에는 담당자가 즉시 대응해야 합니다. 저자는 알람 도구를 도입하더라도 대응할 담당자를 정하고, 즉시 전화로 알리며, 비용을 최소화하는 문제는 남는다고 봤습니다.

여기어때컴퍼니 SRE팀은 전화·SMS·이메일을 묶은 고가의 상용 솔루션 대신 온콜 시스템을 직접 만들었습니다. Grafana OnCall의 DB를 커스터마이징하고, Target Group 이상 감지와 Amazon Connect 발신, Slack 알림 제어를 연동했습니다.

## Grafana 경고가 Amazon Connect 전화로 이어지는 경로 {#알림-흐름}

원문이 제시한 알림 아키텍처의 데이터 경로는 다음과 같습니다.

1. Grafana가 모니터링 조건에 따라 경고를 만듭니다. Slack으로 알림을 보내는 동시에 웹훅으로 Grafana OnCall을 트리거합니다.
2. OnCall API 서버가 받은 데이터를 RabbitMQ에 넣으면 OnCall Worker가 꺼내 처리합니다. 영속 데이터는 외부 MySQL에 저장하고, 캐시와 상태는 Redis에 둡니다.
3. Worker는 처리 결과에 따라 SNS 토픽으로 알림을 보내 이메일·SMS 구독자에게 전달하고, Grafana에 실행 기록을 남깁니다. 로그는 S3에 저장합니다.
4. 전화가 필요하면 Amazon Connect가 담당자에게 발신합니다.

## LGTM 스택에서 대응 일정을 관리하는 Grafana OnCall {#grafana-oncall-구축}

여기어때 인프라의 관측 기반은 LGTM 스택(Loki, Grafana, Tempo, Mimir)입니다. 저자는 관측만으로는 대응이 완성되지 않는다고 보고, 문제가 탐지됐을 때 누가 어떤 순서로 대응할지 관리하는 마지막 조각으로 Grafana OnCall을 골랐습니다. OnCall은 팀별 온콜 일정과 라우팅 규칙, Slack 양방향 동기화, Silence·Resolve 같은 알림 제어를 제공합니다.

선택에는 기존 운영 환경과의 연결이 중요했습니다. 이미 Mimir·Loki·Tempo를 보던 Grafana 안에서 탐지부터 대응까지 이어갈 수 있었고, 따로 관리하던 Alertmanager와 Slack Bot의 팀별 설정도 Grafana 안에 모아 버전 관리할 수 있었습니다. 오픈소스이고 내부 DB 구조가 명확해 커스터마이징하기 쉽다는 점도 선택 이유였습니다.

팀은 주간 전담이나 로테이션처럼 근무 형태에 맞는 스케줄 로직을 추가했습니다. Slack 사용자 기준 자동 동기화와 LDAP 연동으로 신규 입사자도 별도 계정 설정 없이 로테이션에 들어갈 수 있게 했습니다.

배포에는 EKS와 Helm 차트(oncall 1.16.5, grafana/grafana)를 사용했습니다. 파드가 재시작·스케일링·재배포돼도 온콜 설정이 남도록 기본 SQLite 대신 AWS RDS(MySQL)를 연결했습니다. 내부 Grafana는 비활성화하고 기존 Grafana 인스턴스와 연동했으며, Slack OAuth로 SRE와 팀별 채널에 알림을 보냅니다. 원문에 실린 주요 설정은 다음과 같습니다.

```yaml
# grafana-oncall/values.yaml
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: oncall.dev.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: oncall-cert
      hosts:
        - oncall.dev.example.com
grafana:
  enabled: false # 이미 외부 Grafana 사용
database:
  type: mysql
  host: oncall-xxxx.xxxx-xxxx.ap-northeast-2.rds.amazonaws.com
  user: ${ONCALL_DB_USER}
  password: ${ONCALL_DB_PASSWORD}
  name: grafana_oncall
slack:
  enabled: true
  client_id: ${SLACK_CLIENT_ID}
  client_secret: ${SLACK_CLIENT_SECRET}
  signing_secret: ${SLACK_SIGNING_SECRET}
```

설정 예시에는 주의할 점이 있습니다. 원문은 이 예시 바로 뒤에서 Ingress, NGINX Ingress Controller, cert-manager를 비활성화하고, `oncall-engine:8080` 같은 ClusterIP 서비스로 네임스페이스 내부 접근만 열어 두었다고 설명합니다. 외부 접속은 Grafana 플러그인 경로 등으로 처리한다고 적었습니다. 예시의 `ingress.enabled: true`와 본문 설명이 일치하지 않으므로, 설정을 그대로 옮기기보다 구조를 참고하는 편이 안전합니다.

## CloudWatch 경보보다 먼저 찾으려는 Target Group unhealthy {#target-group-감지}

팀은 장애를 가장 빨리 감지할 방법부터 검토했습니다. CloudWatch 경보보다 즉각적으로 대응하기 위해 AWS ELBv2 API를 주기적으로 직접 호출하는 스크립트를 만들었습니다.

1. `describe_load_balancers`로 전체 로드밸런서 목록을 조회합니다.
2. `describe_target_groups`로 각 로드밸런서에 연결된 Target Group을 모읍니다.
3. `describe_target_health`로 Target Group별 인스턴스 헬스 상태를 확인합니다.
4. `State == "unhealthy"`인 대상을 찾습니다.
5. Target Group의 `Team` 태그를 읽어 어느 팀의 서비스인지 식별합니다.

테스트·스테이징 환경의 Target Group은 미리 제외해 알림 노이즈를 줄였습니다. 스크립트는 asyncio, aioboto3, aiomysql을 조합한 비동기 처리로 초 단위로 응답합니다.

## OnCall DB의 iCal에서 찾는 현재 당번 {#당번-조회와-발신}

unhealthy 대상을 발견하면 스크립트가 Grafana OnCall의 RDS DB에서 담당자를 찾습니다. `cached_ical_final_schedule` 필드의 iCal 데이터를 파싱해 현재 시각이 DTSTART~DTEND 사이에 드는 이벤트를 고르고, SUMMARY에서 이름과 전화번호를 꺼냅니다. 전화번호는 LDAP 정보를 기반으로 개발자 연락처를 자동 저장해 둔 값입니다.

Target Group의 `Team` 태그는 Grafana OnCall 팀 이름과 1:1로 맞췄습니다. 이 대응 관계를 사용하므로 팀이 늘어도 코드를 고치지 않습니다.

담당자 번호를 찾으면 Amazon Connect의 `start_outbound_voice_contact` API로 넘겨 바로 발신합니다. Contact Flow에서는 "서비스 장애가 발생했다"는 안내 멘트가 자동 재생되도록 했고, Quick Connect로 사전 녹음된 음성 메시지를 사용합니다.

저자는 Connect가 사용자 라이선스 없이 실제 통화 시간에만 과금된다는 점을 장점으로 꼽았습니다. 알림 빈도가 낮을수록 비용도 줄어든다는 설명입니다.

## Slack 버튼으로 멈추는 전화 {#알림-제어}

저자가 가장 중요하게 본 것은 알림 피로를 줄이는 일이었습니다. 시스템은 알림 상태를 DB에 기록하고, `firing`인 동안 전화를 유지합니다. 상태가 `acked`로 바뀌면 전화와 알림을 즉시 멈춥니다.

담당자가 Slack 메시지의 "☎ 전화 중지" 버튼을 누르면 `stop_contact` API로 진행 중인 통화를 끊고 DB 상태를 `acked`로 바꿉니다. 이후 주기 실행에서는 해당 리소스에 다시 전화하지 않습니다. Slack에는 버튼을 누른 사람이 누구인지도 표시합니다.

발신 시간에도 조건을 뒀습니다. 전화는 근무시간 외인 야간·주말에만 걸고, 공휴일 API로 쉬는 날을 판정합니다. 시스템 자체에 오류가 나면 별도 Slack 채널로 폴백 알림을 보냅니다.

원문은 근무 외 시간에 긴급 패치를 배포한 뒤 일부 인스턴스가 503 오류로 unhealthy가 된 사례를 소개합니다. 1분 안에 이상을 감지하고 10초 안에 전화가 걸려 담당자가 확인했다고 합니다. 저자는 이전에는 알 수 없던 담당자의 확인 여부를 알 수 있게 되면서 처리가 빨라졌다고 적었습니다.

## Target Group 밖에서도 활용할 수 있는 온콜 시스템 {#확장}

원문은 같은 구조를 EC2 상태 변화, RDS 연결 실패, EKS 파드 CrashLoopBackOff, ALB 응답 지연 같은 이벤트에도 적용할 수 있다고 설명합니다. SRE팀은 이미 많은 알림을 이 형식으로 운용하고 있다고 합니다. Grafana OnCall의 Escalation Policy를 사용하면 1차 담당자 → 2차 담당자 → 팀 리더 → 팀 채널 순으로 자동 에스컬레이션도 가능합니다.

저자는 AWS 기본 서비스(ELBv2, Amazon Connect)와 오픈소스(Grafana OnCall, Slack)를 조합해 비용을 줄이면서 대응 속도를 높였다고 평가했습니다. 그중 대응할 담당자를 정하는 문제를 자동화로 푼 점을 가장 큰 차별점으로 들었습니다. 다만 원문에는 비용 수치가 제시되지 않습니다.

같은 Connect 발신 API로 스케줄 없이 그룹 전원에게 전화하는 [올리브영의 서버리스 온콜 사례]({{< relref "/external/oliveyoung/serverless-oncall-amazon-connect.md" >}})와 달리, 여기어때는 당번 한 명을 골라 확인될 때까지 전화를 겁니다. 그만큼 OnCall 엔진·RabbitMQ·Redis·RDS를 직접 운영하며 OnCall 내부 DB 필드에 의존합니다.
