---
title: "토스뱅크 약관 서버의 Strong Consistency 캐시 적용"
description: "토스뱅크 약관 서버가 복제 DB 대신 Redis 캐시를 택하고, Commit 이후 만료와 Circuit Breaker, 처리 순서 보장으로 일관성을 지킨 과정을 요약했습니다. 코드로 풀기 어려운 마지막 틈은 정책으로 정리했습니다."
date: 2026-11-14
weight: 2
---

# 토스뱅크 약관 서버의 Strong Consistency 캐시 적용 (2025-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [캐시를 적용하기 까지의 험난한 길 (TPS 1만 안정적으로 서비스하기)](https://toss.tech/article/34481)
- 매체 · 게시일: 토스 기술 블로그 · 2025-03-31
- 저자: 김경윤 (토스뱅크 Server Developer)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## DB가 버티지 못한 이유 {#db-limit}

약관 서버는 사용자가 동의하거나 철회한 약관과 동의서의 상태를 기록하고 조회하는 서비스입니다. 동의와 철회가 일어나는 일은 많지 않지만, 개인정보를 제3자에게 제공해도 되는지, 토스뱅크가 써도 되는지 같은 여러 비즈니스가 동의 여부를 확인하러 이 서버를 부릅니다. 토스 커뮤니티와 토스뱅크는 하루에 수백 번 라이브 배포를 하는데, 그사이 약관 서버의 TPS가 평균 1만, 최대 2만까지 늘었습니다.

어느 날 새 서비스를 배포하면서 TPS가 급증해 DB 조회량이 늘고 부하가 심각해졌습니다. 트래픽이 유지되면 다른 서비스에도 문제가 생길 수 있다고 보고 급히 롤백한 뒤, 캐시를 적용하기로 했습니다. 막상 해 보니 간단하지 않았다고 합니다.

## 복제 DB 대신 Redis를 쓴 이유 {#why-redis}

읽기 부하는 Replication DB로 나눌 수도 있습니다. 하지만 약관 동의 여부는 개인정보를 특정 목적에 써도 되는지, 제3자에게 공유해도 되는지를 가르는 기준입니다. 값이 DB에 Commit되는 순간 바로 다음 요청에 정확한 값이 나가야 하는 Strong Consistency가 필수입니다. 잘못된 응답이 한 번이라도 나가면 고객이 철회한 뒤에도 개인정보가 공유되는 문제가 생길 수 있습니다. 복제 구조에서는 복제 지연이 생길 수 있어 Replication DB를 쓰지 않기로 하고, Strong Consistency를 유지하면서 빠르게 조회할 수 있는 Redis 캐시를 택했습니다.

읽기 위주이고 DB 정보가 자주 바뀌지 않아 대부분 Cache Hit가 나므로 Look-aside 전략을 썼습니다. 캐시에 값이 있는지 먼저 보고, 없으면 DB를 읽어 캐시에 적재한 뒤 응답합니다. DB 정보가 자주 바뀐다면 다른 방식을 고민해야 한다고 원문은 덧붙입니다.

## Commit 이후 만료와 Circuit Breaker {#evict-after-commit}

캐시 만료는 Spring의 `@EntityListener`와 `@TransactionalEventListener`로 하되, DB Commit 뒤에 일어나게 했습니다. Commit 전에 만료하면 다음 같은 일이 생길 수 있기 때문입니다.

- A 스레드가 동의 여부를 바꿔 Entity Version이 1에서 2로 오르고, 캐시의 Version 1이 Evict됩니다(아직 Commit 전).
- B 스레드가 Cache Miss로 DB에서 Version 1을 읽어 캐시에 다시 올립니다.
- A 스레드가 Version 2를 Commit합니다.
- C 스레드가 Cache Hit로 잘못된 Version 1을 응답합니다.

그런데 `AFTER_COMMIT` 리스너는 Evict가 실패해도 이미 Commit된 뒤라 트랜잭션이 롤백되지 않습니다. 과거 캐시가 계속 응답될 수 있다는 뜻입니다. 이를 막으려고 Circuit Breaker를 썼습니다. Evict가 실패하면 Circuit을 Force Open해 자동으로 닫히지 않게 하고, Cache Get 시 Circuit이 열려 있으면 모든 트래픽이 바로 DB를 조회하게 합니다. DB에 큰 부하가 갈 수 있지만, 잘못된 동의 상태를 응답하는 것보다 DB에 부하를 주고 캐시 문제를 빨리 파악해 고치는 편이 맞다고 판단했다고 합니다. 이런 경우를 아직 겪은 적은 없고, 상시 모니터링 중입니다.

## 0.003초 차이의 불일치 {#timing-gap}

일관성을 확인하려고 서버에 캐시를 적용하되 응답은 항상 DB 값으로 하고, DB와 캐시 데이터를 비교했습니다. 한 번에 통과할 줄 알았지만 불일치가 나왔습니다. A 스레드가 Commit한 뒤 Cache Evict가 되기까지의 약 0.003초 사이에, 동의 변경 Kafka 이벤트를 소비한 B 스레드가 캐시에서 이전 Entity Version을 읽은 것입니다.

해법은 Kafka 이벤트를 Cache Evict 뒤에 발행하는 것이었습니다. Evict 리스너에는 `@Order(Ordered.LOWEST_PRECEDENCE - 1)`를 주고, Kafka 발행은 `TransactionSynchronizationManager`로 Commit 뒤에 실행하되 `getOrder`를 오버라이드해 Evict 다음 순서가 되게 했습니다. 이제 흐름은 Commit, Cache Evict, Kafka 발행, 소비 순이어서 소비 쪽이 변경 후 Version을 읽습니다.

## 남은 틈은 정책으로 {#policy}

Kafka가 아니더라도 Commit 뒤 Evict 전에 사용자 요청이 들어올 가능성은 아주 낮지만 남아 있습니다. 코드로 풀 수도 있었지만 정책으로 풀었습니다. 원래 목표는 "Commit되는 순간 바로 다음 요청에 DB 값이 응답돼야 한다"였는데, `@TransactionalEventListener`가 처리하는 이벤트가 끝나기 전에는 API가 아직 응답하지 않은 상태, 곧 동의나 철회 요청이 완전히 처리되기 전입니다. 그래서 정책을 "동의 또는 철회 API 처리가 완료된 순간부터 바로 다음 요청에 DB 값이 응답돼야 한다"로 바꿨고, 우려하던 문제가 더는 문제가 되지 않았다고 합니다.

## 얻은 교훈과 이후 {#lessons}

저자가 꼽은 교훈은 둘입니다. 하나는 토스의 Core Value인 Execution Over Perfection입니다. 중요한 시스템이라 Legal, Compliance 검토와 가능한 문제를 먼저 고민하느라 적용이 늦어졌고, 검토 뒤 정책을 바로 세우고 적용해 모니터링하며 문제를 하나씩 풀었다면 더 빨랐을 것이라고 돌아봅니다. 다른 하나는 코드로 풀 수 있어도 정책을 조금 틀면 더 쉽게 풀리는 경우가 있다는 것입니다. 이번 문제도 짧아 보이지만 그 전에 많은 코드를 쓰고 지우며 고민했고, 결국 정책 수정으로 간단히 해결했습니다.

지금은 DB에 큰 부하 없이 최대 2만 TPS를 버팁니다. 다만 그 수치에는 사용자 요청 한 번에 MSA 서비스들이 여러 번 호출해 높게 잡히는 부분이 있습니다. 이 불필요한 호출을 줄이려고 Netflix의 Passport와 비슷한 개념인 TermsPassport도 고민 중이지만 아직 적용하지 않았고, 적용하면 다시 글로 쓰겠다고 합니다.

{{% details title="트래픽 수치와 설정 요약" closed="true" %}}

| 항목 | 값 |
|---|---|
| 약관 서버 TPS | 평균 1만, 최대 2만 |
| 캐시 전략 | Look-aside (Redis) |
| 만료 시점 | DB Commit 이후 (`AFTER_COMMIT`) |
| Evict 실패 시 | Circuit Force Open, 이후 조회는 DB로 직행 |
| 불일치 구간 | Commit 후 Evict 전 약 0.003초 |
| 처리 순서 | Commit, Cache Evict, Kafka 발행 (`@Order`, `getOrder`로 보장) |

{{% /details %}}
