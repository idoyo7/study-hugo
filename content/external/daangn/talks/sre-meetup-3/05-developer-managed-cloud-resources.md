---
title: "Terraform 요청을 개발자 셀프 서비스로 바꾼 KRP"
description: "약 1000개의 Terraform state와 반복 Jira 요청을 줄이기 위해 만든 KRP를 정리한다. 개발자가 Redis를 직접 생성·수정하는 흐름, 사내 표준을 자동 적용한 방식, Boto3 직접 호출의 비용을 다룬다."
date: 2026-10-21
weight: 5
---

# Terraform 요청을 개발자 셀프 서비스로 바꾼 KRP (SRE 밋업 3회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [당근마켓 개발자 플랫폼: (쉽고 빠르고 안전하게) 개발자가 직접 관리하는 클라우드 리소스 | 당근 SRE 밋업 3회](https://www.youtube.com/watch?v=Um2CXoD-0QE) (20:09)
- 매체 · 게시일: YouTube 당근 채널 · 2023-06-27
- 발표자: 김승호(Alan.Kim). 슬라이드 표지에 인프라실 SRE팀 클라우드 파트로 적혀 있습니다.
- 근거: YouTube 자동 자막 전체 + 발표 슬라이드
- 발표 영상의 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 약 1000개의 state가 변경과 복구를 느리게 했다 {#늘어난-요청과-terraform-운영-부담}

당근은 국가별로 격리된 서비스를 반복 구축하려고 일찍부터 Terraform을 사용했습니다. 개발팀에는 클라우드 권한을 넓게 열어 Terraform 코드를 올리거나 콘솔에서 직접 관리하게 했고, 방법을 모르면 인프라팀에 요청하게 했습니다. 팀과 요청이 늘면서 Terraform state는 약 1000개가 됐습니다.

오래된 프로젝트를 바꿀 때 유지보수 비용이 크게 드러났습니다. 3년 동안 손대지 않은 프로젝트에 리소스를 하나 추가하려고 Terraform과 provider 버전을 맞추는 데 하루가 걸렸습니다. plan이 깨진 리소스를 빼고 일부만 적용하면 IaC를 계속 쓰는 의미가 약해졌고, 콘솔로 처리하면 코드와 실제 상태가 달라졌습니다.

팀마다 클라우드 계정을 주면 개발팀의 부담이 커집니다. 권한을 모두 회수하면 인프라팀의 처리량과 개발팀의 대기 시간이 늘어 당근의 개발 문화와 맞지 않았습니다.

## Redis 생성 화면에 사내 표준을 내장했다 {#kontrol에서-개발자가-직접-관리하도록}

당근은 Kontrol에 리소스 탭을 추가해 KRP를 만들었습니다. 개발자가 Terraform보다 쉬운 화면에서 인프라팀을 기다리지 않고 리소스를 만들되, 회사의 운영 규칙은 자동으로 적용하는 방식입니다. 반복되는 AWS 리소스 생성 Jira를 0건으로 줄이고, 여러 환경을 한 번에 만들며, 백업과 알람이 빠진 신규 리소스도 0건으로 만드는 것을 목표로 했습니다.

구현 순서는 2021년 Jira 티켓 수로 정했습니다. Redis 73건, S3 48건, DynamoDB 36건이어서 Redis부터 시작했습니다. 사용자가 환경·리전·용도·클러스터 모드와 환경별 노드 타입·샤드 수를 입력하면 여러 환경의 Redis를 함께 생성합니다. KRP는 Redis별 Subnet Group, 환경별 Subnet·Security Group, 가용 영역, 스냅샷과 유지보수 시간대, katalog 오너십 태그, 엔진 버전별 Parameter Group을 사내 규칙에 맞게 설정합니다. 위험한 `KEYS` 명령도 커스텀 Parameter Group으로 막습니다.

KRP는 Terraform 코드를 만들지 않습니다. state 불일치와 깨진 plan을 되풀이하지 않기 위해 Boto3로 AWS API를 직접 호출했습니다. 대부분의 리소스가 AWS에 있었고, 빠르게 가치를 전달하려고 Python과 FastAPI로 시작하면서 DB 도입도 최대한 늦췄습니다. KRP가 사용하는 오너십은 [katalog 발표]({{% relref "/external/daangn/talks/sre-meetup-3/04-project-ownership-katalog.md" %}})의 프로젝트 ID입니다.

생성 뒤에는 Datadog 대시보드와 Slack 알림, 관련 문서 링크를 제공합니다. 레플리카·샤드 수와 노드 타입 수정, 관리 이력도 지원합니다. 삭제는 요청으로 받아 며칠 뒤 알림을 보내고 연결 여부를 확인하거나 백업을 만든 다음 처리합니다.

리소스별로 생성·상세 API, UI·수정 API, 이슈 템플릿 안내, 수정 UI 순으로 구현했습니다. 개발자가 필요한 기능을 사용할 수 있게 된 뒤 마지막에 해당 리소스의 개발자 IAM 권한을 회수했습니다.

## 2023년 상반기 Redis 작업 73회를 개발팀이 처리했다 {#결과}

2021년 Redis 요청은 73건이었습니다. 2023년 상반기에는 개발팀이 KRP에서 생성·수정·삭제 요청을 합쳐 73회 사용했고, 그 과정에 SRE 팀이 개입하지 않았습니다.

개발팀과 인프라팀 사이의 조율도 줄었습니다. 토요일에 개발팀이 레플리카를 늘린 사실을 월요일 Slack 기록으로 확인한 사례가 있었고, 도구에 익숙해진 팀은 증설 전에 먼저 알리기도 했습니다. 발표 당시에는 StaticSite(S3, CloudFront, Route 53)와 DynamoDB 지원을 이어서 개발하고 있었습니다.

## AWS API 직접 호출은 상태 관리 책임을 남겼다 {#주의할-점}

Boto3는 기능별 클라이언트가 세분돼 있습니다. 태그 검색에는 별도 클라이언트가 필요하고 DynamoDB 오토스케일링은 Application Auto Scaling 클라이언트를 써야 합니다. 비동기 생성 완료를 계속 확인해야 하며 중간에 실패하면 이미 만든 리소스도 정리해야 합니다.

DB를 미룬 선택은 초기 개발 속도를 높였지만 약 10개월 뒤에는 결국 필요해져 FastAPI와 SQLAlchemy에 연결했습니다. 발표자는 대안이 없어 Boto3를 계속 사용한다면서도 Terraform을 선택해도 괜찮았을지 모른다고 돌아봤습니다. 이 방식이 모든 회사에 맞는 해법이라고 주장하지 않습니다.

## 주요 구간

- [02:30](https://www.youtube.com/watch?v=Um2CXoD-0QE&t=150s) 수동 관리와 코드화를 반복하던 당근의 사정
- [04:05](https://www.youtube.com/watch?v=Um2CXoD-0QE&t=245s) Terraform 운영 부담과 양 극단의 해법
- [06:09](https://www.youtube.com/watch?v=Um2CXoD-0QE&t=369s) KRP의 목표와 기술 선택
- [09:14](https://www.youtube.com/watch?v=Um2CXoD-0QE&t=554s) Redis 생성 화면과 자동으로 적용하는 사내 규칙
- [14:21](https://www.youtube.com/watch?v=Um2CXoD-0QE&t=861s) 삭제 요청 처리와 기능 구현 순서
- [17:24](https://www.youtube.com/watch?v=Um2CXoD-0QE&t=1044s) 사용 결과와 한계

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
