---
title: "CNCF에서 커뮤니티와 개발 방향을 함께 정하는 Cadence"
description: "Cadence의 CNCF 합류는 사용자와 기여자에게 어떤 변화를 가져올까요? 다른 기업도 메인테이너로 참여할 수 있고, 커뮤니티가 기능의 우선순위를 논의하며 GitHub에서 개발 과정을 확인합니다."
date: 2026-11-10
weight: 1
---

# CNCF에서 커뮤니티와 개발 방향을 함께 정하는 Cadence (2025-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Cadence Workflow Joins the Cloud Native Computing Foundation](https://www.uber.com/us/en/blog/cadence-workflow-joins-the-cloud-native-computing-foundation/)
- 매체 · 게시일: Uber Engineering Blog · 2025-10-06
- 저자: Uber Engineering (개인 저자 미표기)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 기업에 메인테이너 참여를 여는 CNCF {#meaning}

우버에서 만든 오픈소스 워크플로 오케스트레이션 엔진 Cadence가 CNCF(Cloud Native Computing Foundation)에 합류했습니다. 이미 150개 넘는 회사가 쓰는 프로젝트입니다. NetApp Instaclustr 같은 파트너는 Cadence를 채택해 대규모 관리형 서비스로도 제공합니다.

사용하는 기업이 늘어난 Cadence에 이번 합류가 가져오는 변화는 프로젝트 운영에 참여할 길이 넓어진다는 점입니다. 다른 회사도 메인테이너로 참여할 수 있는 열린 거버넌스는 프로젝트를 장기적으로 신뢰할 근거가 됩니다. 우버가 이번 합류를 오픈소스에 대한 의지를 드러내는 이정표로 보는 이유입니다.

CNCF는 Linux Foundation 산하의 오픈소스 재단으로, Kubernetes, Prometheus, Envoy 같은 클라우드 네이티브 구성 요소를 호스팅합니다. Cadence도 이곳에서 커뮤니티와 함께 개발을 이어 갑니다.

## 우버 안팎의 애플리케이션을 지탱하는 Cadence {#announcement}

Cadence는 분산 상태 관리와 재시도, 확장, 장애 복구를 맡습니다. 장애를 견디고 대규모로 확장되는 엔진이 이 작업들을 처리하므로, 개발자는 비즈니스 로직에 집중할 수 있습니다. 우버 안팎에서 수천 개의 사용 사례를 지원하며, 금융·이커머스·헬스케어·운송 분야의 핵심 애플리케이션도 Cadence에 의존합니다.

최근 몇 해 동안은 확장성, 신뢰성, 멀티테넌시, 배포 안전성, 이식성에 투자를 이어 왔습니다. 엔터프라이즈급 기능을 만들 기반을 다진 것입니다. CNCF의 지원을 받아 프로덕션 수준의 신뢰성을 제공하면서 분산 서비스 개발을 더 단순하게 만들겠다는 목표도 이어집니다.

이제 우버는 그 기능을 커뮤니티와 함께 만들자고 제안합니다. AI 시대에 Cadence가 내구성 있는 오케스트레이션에서 중요한 역할을 하리라는 기대도 밝히고 있습니다.

## 기능의 우선순위를 함께 정하는 GitHub 로드맵 {#roadmap}

참여는 앞으로 만들 기능을 논의하는 데서 시작합니다. 로드맵을 GitHub 조직의 프로젝트 보드에 공개하고, 커뮤니티 미팅에서 아이디어를 나누며 우선순위를 정합니다. 무엇이 개발될지 예측하기 쉬워지도록 로드맵과 실행 과정을 더 투명하게 공개하려는 변화입니다.

개발 진행 상황을 확인하는 장소도 바뀝니다. 프로젝트 추적을 사내 도구에서 GitHub로 옮기고, 프로젝트마다 전용 이슈를 두어 풀 리퀘스트와 업데이트, 일정을 따라갈 수 있게 합니다.

## 새 문의 창구인 CNCF Slack {#community-changes}

커뮤니티 대화는 CNCF Slack으로 옮깁니다. 기존 uber-cadence.slack.com은 사용을 중단하고, Community Inviter로 cloud-native.slack.com에 가입한 뒤 #cadence-users 채널에 참여하는 방식입니다. 웹사이트 cadenceworkflow.io와 GitHub 조직 github.com/cadence-workflow는 그대로 유지하며 새 기능 소식도 계속 이곳에서 전합니다.

메인테이너가 되고 싶다면 Slack에서 팀에 연락하면 됩니다. 입문용 작업부터 시작해 경험이 쌓이면 더 큰 프로젝트를 안내받을 수 있습니다. 메인테이너끼리는 정기 미팅으로 진행 상황을 공유합니다.

새 기능을 선보이고 초대 손님의 이야기를 듣는 밋업도 정기적으로 마련합니다. 대면과 비대면으로 만나는 자리입니다.

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
