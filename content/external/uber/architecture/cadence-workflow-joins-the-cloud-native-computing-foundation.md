---
title: "CNCF에 합류한 Cadence 워크플로"
description: "우버가 만든 워크플로 오케스트레이션 엔진 Cadence가 CNCF 프로젝트로 들어간 소식을 전하는 글입니다. 합류 의미와 함께 바뀌는 커뮤니티 운영 방식을 요약합니다."
date: 2026-11-10
weight: 1
---

# CNCF에 합류한 Cadence 워크플로 (2025-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Cadence Workflow Joins the Cloud Native Computing Foundation](https://www.uber.com/us/en/blog/cadence-workflow-joins-the-cloud-native-computing-foundation/)
- 매체 · 게시일: Uber Engineering Blog · 2025-10-06
- 저자: Uber Engineering (개인 저자 미표기)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## Cadence와 CNCF 합류 소식 {#announcement}

우버는 Cadence 프로젝트가 CNCF(Cloud Native Computing Foundation)에 합류했다고 알렸습니다. CNCF는 Linux Foundation 아래에서 Kubernetes, Prometheus, Envoy 같은 클라우드 네이티브 인프라의 핵심 요소를 호스팅하고 관리하는 오픈소스 재단입니다.

Cadence는 우버에서 만든 오픈소스 워크플로 오케스트레이션 엔진으로, 장애에 견디고 크게 확장되는 것을 목표로 합니다. 분산 상태, 재시도, 스케일링, 장애 복구를 엔진이 맡기 때문에 개발자는 인프라 복잡도 대신 비즈니스 로직에 집중할 수 있습니다. 우버 안팎에서 수천 개의 사용 사례를 돌리고 있고, 금융·이커머스·헬스케어·운송 같은 업종의 핵심 애플리케이션이 Cadence에 기대고 있다고 합니다.

## 합류가 갖는 의미 {#meaning}

원문은 이번 합류를 오픈소스에 대한 의지를 드러내는 이정표로 봅니다. 열린 거버넌스 아래에서는 다른 회사도 메인테이너로 참여할 수 있고, 이것이 장기적인 신뢰를 높인다고 설명합니다. 로드맵과 실행 과정이 투명해지면 앞으로 나올 기능도 예측하기 쉬워집니다.

Cadence 생태계는 시작 이후 150개가 넘는 회사로 퍼졌습니다. NetApp Instaclustr 같은 파트너가 Cadence를 채택해 관리형 서비스로 대규모 제공하고 있습니다. 우버는 CNCF의 지원으로 분산 서비스 개발을 단순하게 만든다는 목표를 이어 가면서 프로덕션 수준의 신뢰성을 대규모로 내겠다고 밝힙니다.

최근 몇 해 동안 Cadence는 확장성, 신뢰성, 멀티테넌시, 배포 안전성, 이식성에 투자해 왔습니다. 엔터프라이즈급 기능을 효율적이고 안정적으로 쌓을 바탕을 마련한 셈입니다. 우버는 이제 그 기능을 함께 만들 때라며 누구든 참여하라고 청합니다. 특히 AI 시대에 Cadence가 내구성 있는 오케스트레이션 역할을 맡을 것이라고 내다봅니다.

## 커뮤니티 운영 변경 사항 {#community-changes}

합류에 맞춰 커뮤니티 운영 방식이 몇 가지 바뀝니다.

- 기존 Slack 워크스페이스(uber-cadence.slack.com)는 쓰지 않고 CNCF의 Slack 워크스페이스(cloud-native.slack.com)로 옮깁니다. Community Inviter로 가입한 뒤 #cadence-users 채널에서 문의할 수 있습니다.
- 웹사이트(cadenceworkflow.io)와 GitHub 조직(github.com/cadence-workflow)은 그대로 두고, 새 기능 소식도 계속 거기서 전합니다.
- 로드맵은 GitHub 조직의 프로젝트 보드에 공개합니다. 커뮤니티 미팅에서 앞으로의 기능을 논의하고 우선순위를 정합니다.
- 프로젝트 추적은 사내 도구에서 GitHub로 옮깁니다. 프로젝트마다 전용 이슈를 두어 풀 리퀘스트, 업데이트, 일정을 따라갈 수 있게 합니다.
- 새 기능을 소개하고 이야기를 나누는 밋업을 대면·비대면으로 정기 개최합니다.
- 메인테이너끼리는 정기 미팅으로 진행 상황을 공유합니다. 메인테이너가 되고 싶다면 Slack으로 연락하면 입문용 작업부터 큰 프로젝트까지 경험에 맞춰 안내받을 수 있습니다.

{{% details title="원문에 나온 채널과 주소" closed="true" %}}

| 항목 | 값 |
|---|---|
| 이전 Slack | uber-cadence.slack.com (사용 중단) |
| 새 Slack | cloud-native.slack.com, #cadence-users |
| 웹사이트 | cadenceworkflow.io (유지) |
| GitHub 조직 | github.com/cadence-workflow (유지) |
| 로드맵 | github.com/orgs/cadence-workflow/projects |
| 생태계 규모 | 150개 이상의 회사 |

{{% /details %}}
