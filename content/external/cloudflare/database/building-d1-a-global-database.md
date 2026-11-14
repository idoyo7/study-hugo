---
title: "D1 정식 출시와 읽기 복제 Sessions 설계"
description: "Cloudflare의 서버리스 관계형 데이터베이스 D1이 GA에 이르기까지의 변화와, 전역 읽기 복제를 위한 Sessions API와 순차 일관성 설계를 정리했습니다. 대용량 DB, 가져오기·내보내기, 쿼리 인사이트 같은 GA 기능도 소개합니다."
date: 2026-11-14
weight: 9
---

# D1 정식 출시와 읽기 복제 Sessions 설계 (2024-04)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Building D1: a Global Database](https://blog.cloudflare.com/building-d1-a-global-database)
- 매체 · 게시일: The Cloudflare Blog · 2024-04-01
- 저자: Vy Ton, Justin Mazzola Paluska
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## D1과 GA까지의 여정 {#d1-ga}

D1은 Cloudflare가 내장한 서버리스 관계형 데이터베이스입니다. SQLite의 SQL 방언을 쓰며 Drizzle ORM 같은 ORM과 도구 통합을 지원하고, Workers나 HTTP API로 접근합니다. 서버리스이므로 프로비저닝이 없고, Time Travel로 기본 재해 복구를 제공하며, 사용량 기반 요금제를 씁니다. 넉넉한 무료 구간이 있어 실험하다 프로덕션으로 옮길 수 있습니다. 2022년 말 알파에서 2024년 4월 GA까지의 여정은 개발자가 관계형 데이터와 SQL의 익숙함으로 프로덕션 워크로드를 만들게 하는 데 맞췄습니다.

## 데이터를 전역으로 두는 문제 {#global-data}

Workers 모델에서는 요청이 가장 가까운 데이터 센터에서 서버리스 실행을 일으켜 전 세계 사용자에 맞춰 확장합니다. 그러나 애플리케이션 데이터는 중앙화된 DB에 머물러서 전역 트래픽은 데이터 위치까지의 왕복을 감수해야 합니다. 지금의 D1 데이터베이스도 한 곳에 있습니다. Smart Placement는 자주 접근하는 데이터와 가까운 곳에서 Worker를 호출해 지연을 줄이지만, 이는 Workers 배치의 문제를 푼 것이고 데이터 배치는 다른 문제입니다. 원문이 내놓은 답은 비동기 읽기 복제입니다.

읽기 복제본은 기본 서버의 읽기 전용에 가까운 최신 사본으로, 업데이트를 비동기로 받아 기본 서버보다 뒤처질 수 있고 그 차이를 replica lag라 합니다. 여러 복제본에 부하를 나누면 처리량이 늘고, 복제본이 사용자에게 가까우면 질의 지연이 줄어듭니다. 동기 복제는 쓰기가 모든 복제본의 확인을 기다려 가장 느린 복제본에 맞춰지고 복제본이 고장 나면 멈추므로, 전역 성능이 목적이라면 가능한 한 피하려 합니다.

## 일관성 모델 {#consistency}

대부분의 DB는 read committed, snapshot isolation, serializable 중 하나를 제공하며 snapshot isolation이나 serializable 같은 강한 모드는 동시성 경쟁 상태를 줄여 프로그래밍하기 쉽습니다. 복제본은 독립적으로 업데이트되므로 같은 서버에만 질의하면 일관성 모델이 유지되지만 세션 중에 복제본을 바꾸면 일관성이 깨집니다. 원문의 예: 복제본 A는 기본 DB보다 100ms, B는 2초 뒤처집니다. t=10s의 질의 1은 A에서 9.9s 시점 상태를 보고, 0.5초 계산한 뒤 t=10.5s의 질의 2가 B로 가면 8.5s 시점 상태를 봅니다. 애플리케이션에는 DB가 시간을 거슬러 간 것처럼 보입니다. 이는 read committed로, 자기 쓰기를 읽는다는 보장조차 없어 경쟁 상태를 추론하기 어렵습니다.

D1은 기본적으로 SQLite의 snapshot isolation을 제공합니다. DB의 활성 사본이 최대 하나가 되도록 보장하고 모든 HTTP 요청을 그 하나로 라우팅하는 방식이며, 전역 유일성을 보장하는 Durable Objects 위에 D1을 만들어 이 어려운 분산 시스템 문제를 풀었습니다. 활성 사본이 여럿이면 일반 HTTP 요청을 항상 같은 복제본으로 보낼 방법이 없어 read committed가 최선입니다.

대안은 복제본이 어디든 일관성 모델을 지키며 응답하게 하는 것입니다. 요청에 Lamport 타임스탬프를 넣으면 어느 복제본으로 가도 순차 일관성(sequential consistency)을 구현할 수 있습니다. "자기 쓰기 읽기", "읽기 뒤 쓰기" 같은 성질과 쓰기의 전체 순서를 가지며, 어떤 개별 개체도 임의로 오래될 수 있다는 단서는 API 설계에서 replica lag를 고려할 수 있게 해 주는 특성입니다. 구현은 단조 증가하는 commit token을 모든 요청에 붙이고, 쓰기는 기본 DB로 보내고, 읽기는 아무 복제본이나 받되 그 복제본이 token보다 새로운 업데이트를 받을 때까지 질의를 미루게 하는 것입니다. 읽기가 많은 워크로드가 늘 같은 복제본에 가면 빠르고, 다른 복제본으로 가도 동작합니다.

## Sessions API 미리보기 {#sessions}

읽기 복제를 D1에 가져오려고 Session이라는 개념을 API에 추가할 계획입니다. Session은 애플리케이션에서 하나의 논리적 세션을 이루는 질의 묶음(예: 한 브라우저나 모바일 앱의 요청)이고, Sessions를 쓰면 요청에 가장 알맞은 사본(기본 DB 또는 가까운 복제본)을 쓰되 Session 내 모든 질의에 순차 일관성을 보장합니다. 일관성 모델이 바뀌므로 개발자는 옵트인해야 하며 기존 API는 snapshot isolation 그대로이고, 새 Sessions API로 보낸 질의만 복제본을 씁니다.

원문 예제는 `env.DB.withSession(token)`으로 Session을 만들고 요청 헤더(`x-d1-token`)로 받은 마지막 commit token으로 이전 Session을 이어 가며, 응답 헤더에 `session.latestCommitToken`을 돌려보내 브라우저가 다음 요청에 돌려주게 합니다. 읽기 질의는 token과 같거나 최신 commit이 있는 복제본에서 실행되고 쓰기는 기본 DB로 갑니다. `withSession`의 조건 인자는 다음과 같이 동작합니다.

- commit token: 해당 token 시점부터 Session을 시작하고 이후 질의는 순차 일관성을 가짐
- `first-unconditional`: 첫 질의가 읽기면 지금 복제본이 가진 것을 읽어 그 token을 기준 삼고, 쓰기면 기본 DB로 보내 그 token을 기준 삼음
- `first-primary`: 첫 질의를 읽기·쓰기 구분 없이 기본 DB에서 실행
- 인자 없음 또는 null: `first-unconditional`로 처리

commit token을 마지막 질의에서 받아 새 Session을 열 때 넘기면 Session이 여러 요청에 걸칠 수 있어, 웹 앱이나 모바일 앱이 보는 모든 질의가 순차적으로 일관됩니다.

D1의 읽기 복제는 내장형이며 추가 사용량이나 저장 비용이 없고 복제본 구성이 필요 없습니다. Cloudflare가 D1 트래픽을 모니터링해 사용자에게 가까운 여러 서버에 복제본을 자동으로 만든다고 합니다. 이 설계를 실현하는 작업을 진행 중이며 피드백을 Discord #d1 채널로 받습니다.

## GA에 들어간 기능 {#ga-features}

2023년 10월 오픈 베타 이후 신뢰성, 확장성, 개발자 경험에 집중했습니다.

- 더 큰 데이터베이스: 최대 10GB, Workers Paid 요금제에서 5만 개 DB. 수평 확장으로 비즈니스 개체별 DB 모델링이 가능합니다. 베타 이후 새 D1 DB는 알파 DB보다 같은 기간 40배 많은 요청을 처리합니다.
- 데이터 가져오기·내보내기: DB 마이그레이션 시험, 로컬 개발·테스트용 사본, 규정 준수용 수동 백업 등을 위해 `wrangler d1 execute --file`을 개선해 대용량 가져오기가 원자적 연산이 되게 했습니다(DB가 중간 상태로 남지 않음). `wrangler d1 execute`는 이제 기본이 로컬 우선이라 원격 프로덕션 DB를 보호합니다. 스키마와 데이터, 단일 테이블, 스키마만 SQL 파일로 내보내는 `wrangler d1 export`도 제공합니다.
- 쿼리 성능 디버깅: 실험 기능 `wrangler d1 insights`로 평균 실행 시간 상위 질의 등 성능 지표를 분석하고 GraphQL API로도 볼 수 있습니다.
- 개발 도구: 커뮤니티 프로젝트 지원이 늘었고 Prisma ORM 5.12.0이 Workers와 D1을 지원합니다.

{{% details title="수치와 제약" closed="true" %}}
| 항목 | 값 |
|---|---|
| 알파 시작 | 2022년 말 |
| 오픈 베타 | 2023-10 |
| GA | 2024-04 |
| 최대 DB 크기 | 10GB |
| Workers Paid당 DB 수 | 5만 개 |
| 베타 DB 대 알파 DB 요청 처리량 | 40배 |
| Prisma ORM 지원 버전 | 5.12.0 |
| Sessions 읽기 복제 상태 | 설계 실현 작업 중 |
{{% /details %}}
