---
title: "캐시 만료 때 몰리는 요청을 줄이는 req-shield"
description: "캐시 만료 때 같은 값을 찾는 요청이 백엔드로 몰리는 일을 어떻게 줄일 수 있을까요? req-shield는 락으로 데이터를 가져올 요청을 제한하고, 만료 전 비동기 갱신으로 캐시가 비는 시간을 줄입니다."
date: 2026-11-14
weight: 4
---

# 캐시 만료 때 몰리는 요청을 줄이는 req-shield (2024-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [req-shield로 캐시의 골칫거리 'Thundering Herd 문제' 쉽게 풀기!](https://techblog.lycorp.co.jp/ko/req-saver-for-thundering-herd-problem-in-cache)
- 매체 · 게시일: LY Corporation Tech Blog · 2024-05-24
- 저자: 이병찬, 양강현 (LINE+ Contents Service Engineering)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

캐시가 빈 순간에는 같은 값을 찾는 N개의 요청도 백엔드에 N번 데이터를 요청합니다. 별다른 조치가 없다면 가져온 값을 캐시에 N번 기록하는 일까지 이어집니다. 백엔드와 캐시 모두에 부하를 주는 Thundering Herd 문제입니다.

LINE+ Contents Service Engineering의 Tech Group은 여러 조직이 공통으로 겪는 문제를 풀고 대량 트래픽을 효율적으로 처리할 방법을 찾다가 req-shield를 만들었습니다. 출발은 사내 라이브러리였습니다. 글을 처음 발행할 때는 'Req-Saver'라는 이름이었지만, 오픈소스화하면서 'req-shield'로 이름을 바꾸고 글도 수정했습니다.

## 빈 캐시를 채우는 대표 요청 {#problem}

보통 애플리케이션은 캐시에 값이 있으면 바로 응답하고, 없으면 백엔드 데이터 스토어에서 가져와 캐시에 저장합니다. 여기서 백엔드는 DB나 서버, 파일 등입니다. req-shield는 캐시가 없을 때 데이터를 가져오는 작업을 락을 얻은 요청에 맡깁니다. 나머지 요청은 설정한 시간 동안 캐시에 데이터가 들어오기를 기다립니다.

락은 로컬과 글로벌 중에서 선택합니다. 글로벌 락은 개발자가 인스턴스를 만들 때 함수를 주입하는 방식입니다. 라이브러리 입장에서는 애플리케이션이 어떤 분산 락을 쓸지 알 수 없기 때문입니다. 주입받은 함수로 락을 얻은 요청이 대표로 백엔드 데이터를 가져와 캐시를 채웁니다.

로컬 락에는 세마포어를 씁니다. 서버 인스턴스마다 락을 얻는다는 점을 빼면 동작은 글로벌 락과 같습니다. 어느 쪽이든 캐시 미스가 난 요청 모두가 각자 데이터를 가져오던 흐름에, 캐시를 채울 대표 요청과 이를 기다리는 요청을 구분한 것입니다.

## 만료 전에 갱신을 시작하는 req-shield {#ideas}

캐시에 값이 남아 있다면 만료를 기다리지 않고 먼저 갱신합니다. 예를 들어 TTL(유효 시간)이 10초인 캐시를 조회했는데 2~3초만 남았다면, 그때 갱신을 시작하는 방식입니다. 일정한 트래픽이 들어온다는 전제에서 캐시가 만료되는 공백 없이 계속 존재하는 듯한 효과를 기대했습니다.

이때도 락은 사용합니다. 하지만 이미 응답할 값이 있으므로 새 데이터가 들어오기를 기다리지는 않습니다. 락을 얻지 못한 요청은 현재 캐시 값으로 바로 응답하고, 락을 얻은 요청도 바로 응답한 뒤 비동기로 캐시를 갱신합니다. 캐시가 비었을 때와 달리 갱신을 맡은 요청까지 클라이언트를 기다리게 하지 않는 방식입니다.

## 기다림의 비용이 드러난 Spring 부하 테스트 {#load-test}

요청을 순차 처리하는 기능은 Spring `@Cacheable`에도 있습니다. 기본값이 `false`인 `sync` 속성을 `true`로 설정하면 같은 인수로 한꺼번에 들어온 요청을 순차 처리합니다. 캐시 제공자에 따라 이 옵션을 지원하지 않을 수 있어 사용 전에 확인해야 합니다. 원문에서 설명한 Spring 기본 `CacheManager`와 Redis 캐시는 지원 대상입니다.

지원 여부와 별개로 기다림의 비용도 있었습니다. 개발 기준이 된 spring-data-redis 2.7.17의 `RedisCacheManager`는 백엔드에 하나의 요청만 보내기 위해 `synchronized`를 사용했습니다. 캐시 히트 때는 `sync` 설정에 따른 차이가 크지 않지만, 캐시 미스가 나면 갱신이 끝날 때까지 들어온 모든 요청이 `synchronized`로 로직을 수행합니다. 원문은 이 때문에 성능 감소가 불가피하다고 설명합니다. spring-data-redis 3.0 이상에서는 `ReentrantLock`으로 구현이 바뀌었지만 같은 현상이 나타난다고 덧붙였습니다.

부하 테스트에서는 이 차이와 req-shield의 효과를 함께 비교했습니다. 환경은 Spring Boot 2.7.17과 로컬 Docker에서 실행한 Redis 6.2.7-alpine입니다. 캐시 TTL은 20초, req-shield의 `decisionForUpdate`는 70%로 설정했습니다. 백엔드 쿼리는 3초 sleep으로 대신했습니다. 차이를 분명히 확인하려고 지연을 다소 길게 잡은 조건입니다.

NGrinder의 vUser는 100으로, 프로세스 4개와 스레드 25개를 사용했습니다. 램프 업 없이 5분 동안 실행했고 Redis 키는 10개 중 무작위로 골랐습니다.

Spring MVC에서 req-shield의 평균 TPS는 약 16,799였습니다. `@Cacheable`의 `sync=false`는 약 10,815, `sync=true`는 약 8,280으로, req-shield가 각각 55.31%, 102.88% 높았습니다. `sync=true` 자체는 `sync=false`보다 성능이 20% 정도 떨어졌습니다.

WebFlux에서는 ReactiveRedisOperator와 비교했습니다. 평균 TPS가 약 11,404에서 req-shield 적용 시 약 17,257로 올라 약 51.34% 향상됐습니다. WebFlux와 Kotlin Coroutine 환경에서도 같은 비교를 진행했으며, 약 12,059에서 약 16,335로 35.45%가량 높아졌습니다. 저자들은 이 결과에서 캐시 갱신 로직이 성능에 큰 영향을 준다고 보았습니다.

{{% details title="부하 테스트 조건과 결과의 근거" closed="true" %}}

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

## 실행 환경에 맞춰 고르는 모듈 {#modules}

req-shield를 직접 호출하려면 실행 환경에 맞는 코어 모듈을 선택합니다. 순차 블로킹 환경에는 `core`, Reactor에는 `core-reactor`, Kotlin Coroutine에는 `core-kotlin-coroutine`이 대응합니다. 각 모듈에는 메인 메서드와 설정 파일이 들어 있습니다.

설정할 항목은 캐시 읽기·쓰기 함수, 로컬 락 사용 여부를 정하는 `isLocalLock`, 갱신 시점을 정하는 `decisionForUpdate`입니다. 원문 예제의 갱신 설정값은 `decisionForUpdate = 70`입니다. 설정을 넘겨 인스턴스를 만든 뒤 메인 메서드인 `getAndSetReqShieldData`를 호출하며, Spring에서는 인스턴스를 Bean으로 만들어 사용할 수도 있습니다.

애너테이션으로 사용하는 방법도 마련했습니다. Spring 모듈은 코어를 바탕으로 `@ReqShieldCacheable`, `@ReqShieldCacheEvict`를 제공하며 Spring AOP로 구현했습니다. 개발 팀이 주로 쓰는 환경에 맞춘 모듈은 `core-spring-mvc`, `core-spring-webflux`, `core-spring-webflux-kotlin-coroutine`입니다.

공통 데이터 클래스와 유틸, 테스트 패키지는 지원 모듈에 모았습니다. 여기에는 테스트 컨테이너 관련 코드도 들어 있어 각 모듈에서 Redis 같은 플랫폼을 이용해 테스트할 수 있습니다.

## req-shield가 빛을 발하는 시스템 {#when-to-use}

req-shield는 만병통치약이 아닙니다. 저자들은 필요하지 않은 경우도 있다고 밝히며, 특히 효과를 기대할 환경으로 아래 조건을 꼽았습니다.

- 대량의 트래픽이 발생하는 시스템
- 클라이언트가 개인화되지 않은 공통 데이터를 가져가는 시스템
- 캐시 TTL 주기가 단기 또는 중기인 시스템
- 백엔드 데이터 스토어의 부하가 크거나 응답이 다소 느린 시스템
