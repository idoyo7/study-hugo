---
title: "개발자가 직접 관리하는 클라우드 리소스: KRP"
description: "당근 SRE 밋업 3회에서 소개한 Karrot Resource Platform(KRP)의 요약입니다. Terraform state 약 1000개를 운영하는 부담에서 출발해, Redis 생성과 수정을 개발자가 UI에서 직접 하게 만든 과정과 한계를 다룹니다."
date: 2026-10-21
weight: 5
---

# 개발자가 직접 관리하는 클라우드 리소스: KRP (SRE 밋업 3회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [당근마켓 개발자 플랫폼: (쉽고 빠르고 안전하게) 개발자가 직접 관리하는 클라우드 리소스 | 당근 SRE 밋업 3회](https://www.youtube.com/watch?v=Um2CXoD-0QE) (20:09)
- 매체 · 게시일: YouTube 당근 채널 · 2023-06-27
- 발표자: 김승호(Alan.Kim). 슬라이드 표지에 인프라실 SRE팀 클라우드 파트로 적혀 있습니다.
- 근거: YouTube 자동 자막 전체 + 발표 슬라이드
- 이 문서는 영상을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

KRP가 오너십 태그를 받아 오는 katalog는 [katalog 발표 요약]({{% relref "/external/daangn/talks/sre-meetup-3/04-project-ownership-katalog.md" %}})에서 다룹니다.

## 주요 구간

- [02:30](https://www.youtube.com/watch?v=Um2CXoD-0QE&t=150s) 수동 관리와 코드화를 반복하던 당근의 사정
- [04:05](https://www.youtube.com/watch?v=Um2CXoD-0QE&t=245s) Terraform 운영 부담과 양 극단의 해법
- [06:09](https://www.youtube.com/watch?v=Um2CXoD-0QE&t=369s) KRP의 목표와 기술 선택
- [09:14](https://www.youtube.com/watch?v=Um2CXoD-0QE&t=554s) Redis 생성 화면과 자동으로 적용하는 사내 규칙
- [14:21](https://www.youtube.com/watch?v=Um2CXoD-0QE&t=861s) 삭제 요청 처리와 기능 구현 순서
- [17:24](https://www.youtube.com/watch?v=Um2CXoD-0QE&t=1044s) 사용 결과와 한계

## 늘어난 요청과 Terraform 운영 부담

당근이 일찍부터 Terraform을 쓴 배경에는 국가별로 격리된 서비스가 있었습니다. 한 나라에 잘 구축해 두면 다른 나라에도 쉽게 구축할 수 있으리라는 기대였습니다. 개발팀에는 클라우드 권한을 최대한 열어 두었습니다. Terraform 코드를 직접 올리거나 콘솔에서 관리하고, 방법을 모르면 인프라팀에 요청하는 방식입니다. 개발팀이 늘면서 인프라팀에 요청이 쌓였고, Terraform state는 약 1000개에 이르렀습니다.

오래된 프로젝트를 수정할 때는 유지보수 부담이 드러났습니다. 3년 전에 만들고 손대지 않은 프로젝트에 리소스를 추가하려면 Terraform과 프로바이더 버전을 맞추는 데 하루가 걸렸습니다. plan이 깨진 리소스를 제외하고 일부만 적용하다 보니 Terraform을 계속 쓰는 데 회의가 들었고, 콘솔로 처리하면 코드와 실제 상태의 차이가 커졌습니다.

팀마다 클라우드 계정을 주면 개발팀이 더 부담해야 합니다. 권한을 모두 회수하면 인프라팀의 부담과 개발팀의 대기 시간이 늘어납니다. 무엇보다 당근의 개발 문화와 맞지 않았습니다.

## Kontrol에서 개발자가 직접 관리하도록

당근은 Kontrol에 리소스 탭을 추가해 KRP를 만들었습니다. 개발자가 Terraform보다 쉬운 방법으로, 인프라팀을 기다리지 않고 사내 규칙에 맞게 리소스를 관리하도록 했습니다. 반복되는 AWS 리소스 생성 Jira 이슈를 0으로 줄이고, 여러 환경의 리소스를 한 번에 만들며, 백업과 알람 같은 표준 설정이 빠진 새 리소스를 0으로 만드는 것이 목표였습니다.

지원 순서는 2021년 Jira 티켓 수로 정했습니다. Redis(73건), S3(48건), DynamoDB(36건) 순이어서 Redis부터 구현했습니다. 개발자가 생성 화면에서 환경, 리전, 용도, 클러스터 모드를 고르고 환경별 노드 타입과 샤드 수를 입력하면 한 번에 만들어집니다. Redis별 Subnet Group, 환경별 Subnet과 Security Group, 가용 영역, 스냅샷과 유지보수 시간대, katalog의 오너십 태그, 엔진 버전별 Parameter Group은 KRP가 사내 규칙에 맞춰 적용합니다. 위험한 KEYS 명령도 커스텀 Parameter Group으로 막습니다.

이 과정에서 Terraform 코드를 생성하지는 않습니다. state 불일치와 plan 깨짐을 다시 겪지 않으려고 Boto3로 AWS API를 직접 호출했습니다. 대다수 리소스가 AWS에 있어 AWS부터 지원했고, 빠르게 가치를 전달하려고 Python과 FastAPI로 시작하면서 DB 도입은 최대한 미뤘습니다.

생성 이후에는 Datadog 대시보드 자동 생성, Slack 알림, 문서 링크를 추가했습니다. 레플리카·샤드 수와 노드 타입을 바꾸는 기능, 관리 이력도 제공했습니다. 삭제는 요청으로 받습니다. 며칠 뒤 알림이 오면 연결이 없는지 확인하거나 백업을 만든 뒤 지웁니다.

리소스별 기능은 API, UI, 수정 기능, 이슈 템플릿 안내 순으로 구현했습니다. 개발자가 쓸 기능을 마련한 뒤 마지막으로 해당 리소스의 개발자 IAM 권한을 회수했습니다.

## 결과

- 2021년 Redis 요청은 73건. 2023년 상반기에는 개발팀이 KRP를 73회 사용했고, 이 기간 SRE 팀의 개입은 필요하지 않았음
- 개발팀과 인프라팀 사이 의사소통 감소. 토요일에 개발팀이 레플리카를 늘린 사실을 월요일 Slack 기록에서 확인한 사례가 있었고, 익숙해진 팀은 증설 전에 미리 알리기도 함
- StaticSite(S3, CloudFront, Route 53)와 DynamoDB를 이어서 지원하는 중

## 주의할 점

AWS API를 직접 호출하면서 처리해야 할 일도 있었습니다. Boto3는 클라이언트가 지나치게 쪼개져 있어 태그 검색에는 별도 클라이언트, DynamoDB 오토스케일링에는 Application Auto Scaling 클라이언트를 써야 합니다. 내부 비동기 처리로 생성 완료 여부를 계속 확인해야 하고, 생성 도중 실패하면 중간에 만든 리소스를 정리해야 합니다.

발표자는 DB 도입을 미룬 선택이 초기 속도에 도움이 됐다고 봅니다. 10개월쯤 뒤에는 DB가 필요해져 FastAPI와 SQLAlchemy로 붙였다고 합니다.

발표자는 대안이 없어 Boto3를 계속 쓰고 있다면서도 Terraform을 택해도 괜찮았을지 모른다고 돌아봅니다. 모든 회사에 맞는 해법은 아니라는 말로 발표를 마칩니다.

{{% details title="근거와 세부 수치" closed="true" %}}

| 항목 | 값 | 근거 |
|---|---|---|
| Terraform state 수 | 약 1000개 | 슬라이드("1,000개 정도"), 자막 |
| 2021년 Jira 티켓 | Redis 73건, S3 48건, DynamoDB 36건 | 슬라이드. 자막은 Redis를 "273건"으로 인식했으나 슬라이드를 따름 |
| 2023년 상반기 KRP 사용 | 73회 (생성, 수정, 삭제 요청 합계 막대 그래프) | 슬라이드 |
| DB 도입 시점 | 약 10개월 뒤 | 슬라이드 |
| 삭제 요청 후 알림 | 약 3일 뒤 | 자막 기준 |
| 구현 순서 | 생성과 상세 API, UI와 수정 API, 이슈 템플릿 안내와 수정 UI, 개발자 권한 삭제 | 슬라이드 |

슬라이드는 상세 화면의 Datadog 대시보드 링크와 Network Bandwidth Baseline 문서 연결을 보여 주며, 자막도 같은 내용을 설명합니다. 마지막 슬라이드는 DevOps, SRE, 플랫폼 엔지니어링이 크게 다르지 않다는 근거로 Netflix의 Full Cycle Developers 발표를 언급합니다.

{{% /details %}}
