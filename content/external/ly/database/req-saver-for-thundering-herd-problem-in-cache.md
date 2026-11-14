---
title: "req-shield를 이용한 캐시 Thundering Herd 문제 완화"
description: "LINE+ Contents Service Engineering의 Tech Group이 캐시 미스 때 요청이 백엔드로 몰리는 문제를 풀려고 만든 req-shield 라이브러리를 소개한 글입니다. 락과 TTL 선제 갱신이라는 두 아이디어, 모듈 구조, Spring 환경별 부하 테스트 결과를 요약합니다."
date: 2026-11-14
weight: 4
---

# req-shield를 이용한 캐시 Thundering Herd 문제 완화 (2024-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [req-shield로 캐시의 골칫거리 'Thundering Herd 문제' 쉽게 풀기!](https://techblog.lycorp.co.jp/ko/req-saver-for-thundering-herd-problem-in-cache)
- 매체 · 게시일: LY Corporation Tech Blog · 2024-05-24
- 저자: 이병찬, 양강현 (LINE+ Contents Service Engineering)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

원문에 따르면 최초 발행 때는 'Req-Saver'라는 이름이었으나, 오픈소스화하면서 'req-shield'로 바꾸고 글도 고쳤습니다. 저자들의 Contents Service Engineering에는 여러 조직이 공통으로 겪는 문제를 다루는 Tech Group이 있고, 이 그룹이 대량 트래픽을 효율적으로 처리하는 방안을 찾다가 캐싱 프로세스를 고도화하며 이 사내 라이브러리를 만들었습니다.

## 문제 {#problem}

애플리케이션은 보통 요청에 맞는 내용이 캐시에 있으면 바로 응답하고, 없으면 캐시 뒤의 백엔드 데이터 스토어(DB, 서버, 파일 등)에서 가져와 캐시에 저장합니다. 캐시에 없는 같은 값을 N개의 요청이 동시에 원하면 N번의 요청이 모두 백엔드로 가고, 아무 조치가 없으면 받은 데이터를 캐시에 N번 기록하기까지 합니다. 백엔드 스토어와 캐시 모두에 부하를 주는 이 현상이 Thundering Herd 문제입니다.

## 두 가지 아이디어 {#ideas}

관건은 백엔드로 가는 요청을 줄이는 것이었고, 캐시 히트 여부에 따라 두 아이디어를 적용했습니다.

- 캐시에 없을 때: 애플리케이션 단에서 로컬 또는 글로벌 락을 잡은 요청만 백엔드로 보내고, 나머지는 그 요청이 캐시에 데이터를 만들 때까지 기다리게 한다.
- 캐시에 있을 때: 미래를 위한 예방 조치로, 만료를 기다리지 않고 캐시 TTL을 미리 갱신한다. 원문의 예는 TTL이 10초인 캐시를 조회하는 시점에 TTL이 2~3초 남았다면 바로 갱신하는 경우이고, 일정한 트래픽이 들어오는 전제에서 캐시가 만료되는 공백 없이 계속 존재하는 효과를 기대할 수 있습니다.

## 구현 {#implementation}

캐시에 없을 때는 락을 씁니다. 글로벌 락은 라이브러리가 어떤 분산 락을 쓸지 알 수 없으므로 개발자가 인스턴스를 만들 때 함수를 주입하게 했습니다. 그 함수를 실행해 락을 얻은 요청이 대표로 데이터를 가져와 캐시에 적재하고, 얻지 못한 요청은 설정한 시간 동안 캐시 적재를 기다립니다. 로컬 락은 세마포어를 쓰며, 서버 인스턴스마다 락을 얻는다는 점만 다르고 동작은 같습니다.

캐시에 있을 때도 락을 쓰지만 기다릴 필요가 없습니다. 락을 얻지 못한 요청은 바로 클라이언트에 응답하고, 락을 얻은 요청도 바로 응답한 뒤 캐시 갱신을 비동기로 진행합니다.

## 모듈 구조 {#modules}

- 코어 모듈: `core`(순차 블로킹 환경), `core-reactor`(Reactor 기반), `core-kotlin-coroutine`(Kotlin Coroutine 기반). 각자 환경에 맞는 모듈을 가져와 설정하고 인스턴스를 만들면 메인 메서드 `getAndSetReqShieldData`를 쓸 수 있다.
- Spring 모듈: `@ReqShieldCacheable`, `@ReqShieldCacheEvict` 애너테이션으로 쓰는 `core-spring-mvc`, `core-spring-webflux`, `core-spring-webflux-kotlin-coroutine`. 구현은 Spring AOP다.
- 지원 모듈: 공통 데이터 클래스와 유틸, 테스트 패키지. 테스트 컨테이너 코드가 들어 있어 Redis 등으로 쉽게 테스트할 수 있다.

설정에서 캐시 쓰기와 읽기 함수, 로컬 락 사용 여부(`isLocalLock`), 캐시를 언제 갱신할지 정하는 `decisionForUpdate`를 지정합니다. 원문 예제는 `decisionForUpdate = 70`입니다.

## 부하 테스트 {#load-test}

환경은 Spring Boot 2.7.17, 로컬 Docker의 Redis 6.2.7-alpine, 캐시 TTL 20초, 백엔드 쿼리를 3초 sleep으로 시뮬레이션(차이를 분명히 보려고 다소 길게 잡은 지연)입니다. NGrinder로 vUser 100(프로세스 4개와 스레드 25개), 램프 업 없이 5분, Redis 키는 10개 중 무작위로 썼습니다.

Spring MVC에서는 `@Cacheable`의 `sync` 속성을 `false`와 `true`로 둔 경우와 req-shield를 비교했습니다. 평균 TPS는 순서대로 약 10,815, 약 8,280, 약 16,799이고, req-shield가 `sync=false`보다 55.31%, `sync=true`보다 102.88% 높았습니다. WebFlux에서는 ReactiveRedisOperator 약 11,404 대비 req-shield 약 17,257로 약 51.34% 향상됐고, WebFlux와 Kotlin Coroutine에서는 약 12,059 대비 약 16,335로 35.45%가량 향상됐습니다.

## 개발 중 만난 `sync` 속성 이슈 {#sync-issue}

`@Cacheable`의 `sync`는 기본값이 `false`이고 `true`로 두면 같은 인수의 동시 요청을 백엔드로 순차 전달합니다. 단점은 두 가지입니다. 먼저 캐시 제공자에 따라 지원 여부가 다르므로 쓰기 전에 확인해야 합니다. Spring 기본 `CacheManager`와 Redis 캐시는 지원합니다. 다음으로 `RedisCacheManager` 기준 spring-data-redis 2.7.17에서는 백엔드로 요청 하나만 보내려고 `synchronized`를 쓰므로 성능 감소가 불가피합니다(3.0 이상은 `ReentrantLock`으로 바뀌었지만 현상은 같다고 합니다). 캐시 히트에서는 차이가 크지 않지만 캐시 미스에서는 업데이트 전까지 들어온 모든 요청이 `synchronized`로 로직을 수행합니다. 부하 테스트에서 `sync=true`는 `sync=false`보다 20% 정도 성능이 떨어졌습니다.

## 쓸 만한 경우 {#when-to-use}

저자들은 req-shield가 만병통치약은 아니라고 말하며, 빛을 발하는 경우를 넷으로 정리합니다.

- 대량의 트래픽이 발생하는 시스템
- 클라이언트가 공통된(개인화되지 않은) 데이터를 가져가는 시스템
- 캐시 TTL 주기가 단기 또는 중기인 시스템
- 백엔드 데이터 스토어의 부하가 크거나 응답이 다소 느린 시스템

{{% details title="원문의 부하 테스트 조건과 결과" closed="true" %}}

| 항목 | 값 |
|---|---|
| 애플리케이션 | Spring Boot 2.7.17 |
| 캐시 | Redis 6.2.7-alpine (로컬 Docker), TTL 20초 |
| 백엔드 시뮬레이션 | sleep 3초 |
| req-shield 설정 | decisionForUpdate 70%, TTL 20초 |
| NGrinder | vUser 100(프로세스 4 x 스레드 25), 램프 업 없음, 5분, 키 10개 무작위 |
| MVC `@Cacheable` sync=false | 평균 TPS 약 10,815 |
| MVC `@Cacheable` sync=true | 평균 TPS 약 8,280 |
| MVC req-shield | 평균 TPS 약 16,799 (각각 +55.31%, +102.88%) |
| WebFlux ReactiveRedisOperator | 약 11,404 |
| WebFlux req-shield | 약 17,257 (+51.34%) |
| WebFlux + Coroutine ReactiveRedisOperator | 약 12,059 |
| WebFlux + Coroutine req-shield | 약 16,335 (+35.45%) |

원문은 `decisionForUpdate`를 설정 예제 주석에서는 'TTL의 몇 %가 지났을 때 갱신할지', 테스트 조건에서는 'TTL이 70% 남았을 때 갱신'이라고 서로 다르게 적고 있습니다.

{{% /details %}}
