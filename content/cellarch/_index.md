---
title: "서비스 아키텍처 변천사"
date: 2026-09-22
lastmod: 2026-09-22
weight: 200
comments: false
cascade:
  type: docs
---

# 서비스 아키텍처 변천사 — 모놀리스에서 셀까지

2025년 10월 20일, 리전 하나에 딱 하나뿐이던 DNS 레코드가 자동화 경합 끝에 통째로 비었습니다. 그 뒤로 Snapchat과 Fortnite부터 Coinbase와 Venmo까지, 영향받은 서비스 목록에 이름을 올린 곳이 140곳을 넘었습니다. 같은 시각 다른 리전은 평소처럼 돌아가고 있었고, us-east-1 안에서도 DynamoDB의 파티션과 스토리지 노드는 손상되지 않았습니다. 무엇이 장애를 가뒀고, 무엇이 그 경계를 넘어 장애를 퍼뜨렸을까요?

모놀리스는 코드 한 덩어리와 하나의 장애 도메인을 유지했습니다. SOA와 마이크로서비스는 코드를 서비스 단위로 나누면서 배포·확장·조직을 나눴습니다. 셀에 이르러 격리의 단위는 고객 한 명의 몫으로 옮겨갔습니다. 이 순서를 따라 읽으면 각 구조가 무엇을 나눴고, 어떤 공유 층을 남겼는지 비교할 수 있습니다.

## 격리 경계 밖에 남는 것

공유 층 하나가 남으면 장애의 폭발 반경은 전체가 됩니다. 03의 장애 사례들과 05의 Datadog 반례는 서비스나 지리적 위치를 나눈 뒤에도 공유 의존성이 어떻게 장애를 퍼뜨렸는지 보여줍니다.

셀은 트래픽 축을 가두지만 변경·자동화 축은 따로 다뤄야 합니다. 05와 07에서는 이 축을 다루는 wave 배포, velocity control, 수동 복구 경로를 함께 짚습니다.

## 문서 지도

각 편은 1차 문서와 2차 출처를 구분해 표기하고, 확인하지 못한 수치는 미확인으로 남겨둡니다.

| 문서 | 다루는 것 |
|---|---|
| [01 모놀리스와 수직 확장]({{< relref "01-monolith/index.md" >}}) | 진흙덩어리·Amazon 3-tier 전환·eBay 다섯 세대·Netflix 2008 DB 장애, 수직 확장이 처리량은 풀어도 장애 도메인은 하나로 남긴다는 것, 시리즈 전체 지도 |
| [02 SOA → 마이크로서비스]({{< relref "02-microservices/index.md" >}}) | Bezos API 명령·Fowler & Lewis 정의·Hystrix 벌크헤드 산수, MSA가 나눈 것(배포·확장·조직)과 못 나눈 것(공유 층), Prime Video 역류 |
| [03 공유 의존성 장애]({{< relref "03-shared-failure/index.md" >}}) | S3·Cloudflare·Slack·Facebook·Roblox·Datadog·GCP 장애 사례표, 폭발 반경이 서비스 개수가 아니라 공유 자원 개수로 정해진다는 명제 |
| [04 셀의 해부]({{< relref "04-cell-anatomy/index.md" >}}) | AWS 백서의 셀 정의와 해부(라우터·셀·컨트롤 플레인), Borg·WSO2·AWS로 갈라진 "cell"이라는 단어의 계보, 셔플샤딩 산수 |
| [05 실전 사례]({{< relref "05-cell-cases/index.md" >}}) | Slack·Roblox·GitLab·Shopify·DoorDash·Salesforce가 실제로 그은 셀 경계 비교, Datadog 반례, 셀을 쓰지 않은 Uber·Netflix, EKS 구현안 |
| [06 AWS의 격리 설계]({{< relref "06-aws-isolation/index.md" >}}) | Region → AZ → cell → shuffle shard 네 겹과 글로벌 컨트롤 플레인 예외, DynamoDB 내부 구조와 2015년 메타데이터 장애, 정적 안정성 체크리스트 |
| [07 2025 us-east-1 해부]({{< relref "07-aws-2025-outage/index.md" >}}) | 2025-10-20 타임라인, DNS Planner·Enactor 경합 메커니즘, 전파 경로, 격리가 지킨 것과 못 지킨 것, GCP·Azure 대조군 |

## 읽는 순서

역사적 맥락부터 보고 싶다면 01부터 순서대로 읽으시면 됩니다. 셀의 개념이 궁금하다면 04부터, AWS가 자사 서비스 안에서 격리 설계를 어떻게 겹쳐 쓰는지 보고 싶다면 06부터 읽으셔도 됩니다.
