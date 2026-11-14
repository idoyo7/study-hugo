---
title: "피크보다 자정에 더 높았던 Redis New Connection"
description: "Redis 커넥션 풀이 있는데도 자정에 신규 연결이 더 많아진 이유는 무엇일까요? Elasticache가 끊은 유휴 커넥션을 Lettuce가 다시 연결하고 있었고, 풀에서 유휴 커넥션을 정리해 해소했습니다."
date: 2026-11-14
weight: 1
---

# 피크보다 자정에 더 높았던 Redis New Connection (2025-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Redis New Connection 증가 이슈 돌아보기](https://techblog.woowahan.com/23121/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2025-10-14
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 커넥션 풀이 있는데도 새 연결이 많았던 자정 {#new-connection-anomaly}

저녁 피크가 지나 자정으로 향하는데 Redis의 New Connection 지표는 내려가지 않았습니다. 오히려 피크 때보다 높았습니다. 사용자 맞춤 데이터를 Redis에 캐싱하던 팀은 조회할 때마다 새 커넥션을 만드는 것은 아닌지 의심했습니다. 연결을 맺느라 조회가 늦어질 가능성도 있었기 때문입니다.

풀은 이미 설정돼 있었습니다. Spring Boot 3.2.4, Lettuce 6.3.2, Elasticache Valkey 8 환경에서 `maxActive: 20`으로 커넥션을 재사용하고 있었으니, 새 연결이 계속 늘어나는 이유를 더 찾아야 했습니다. 조사 중 서버 로그에서 발견한 단서는 reconnect였습니다. Lettuce의 `ConnectionWatchdog`가 끊어진 연결을 다시 맺고 있었습니다.

## 파이프라이닝이 풀에서 가져온 전용 커넥션 {#pipelining-dedicated-connection}

팀이 처음 의심했던 곳은 최근 본 상품을 처리하는 코드였습니다. 상품을 Redis list에 추가하는 push, 목록 길이를 조정하는 trim, TTL을 다시 설정하는 expire를 `executePipelined`로 묶어 실행하고 있었습니다. 일반적인 `redisTemplate` 호출은 커넥션 하나를 공유하지만, 파이프라인을 열 때는 `LettuceConnection`이 전용 커넥션을 할당합니다.

테스트에서도 차이가 드러났습니다. 파이프라인을 열지 않은 두 커넥션의 `nativeConnection`은 같았고, 각각 `openPipeline()`을 호출한 뒤에는 서로 달랐습니다. 그렇다고 전용 커넥션을 할당할 때마다 새 연결을 만드는 것은 아니었습니다. 커넥션 풀이 설정돼 있으면 그 안에서 가져옵니다. 이 프로젝트에도 풀이 있었으므로, 파이프라이닝이 전용 커넥션을 쓴다는 사실만으로는 지표 증가를 설명하기 어려웠습니다.

## 100초의 timeout에 걸린 유휴 연결 {#lifo-and-idle-timeout}

연결을 끊는 쪽은 Elasticache였습니다. 이 프로젝트의 parameter group에는 `timeout`이 100으로 설정돼 있어, 100초 동안 사용하지 않은 유휴 커넥션을 Elasticache가 종료했습니다. 애플리케이션에서는 채널이 inactive 상태가 되면 `ConnectionWatchdog`가 재연결을 예약합니다. 쓰지 않는 연결을 서버가 끊고 클라이언트가 다시 맺는 상황이었습니다.

그렇다면 풀에는 왜 쓰지 않는 커넥션이 계속 남아 있었을까요? `GenericObjectPool`은 기본적으로 최근에 사용한 커넥션부터 꺼내는 LIFO 전략을 따릅니다. 트래픽이 몰리거나 일시적인 지연이 생겨 풀이 최대로 늘어난 뒤 상황이 해소되면, 최근에 쓴 일부 커넥션만 재사용하고 나머지는 유휴 상태로 남습니다.

유휴 커넥션 정리도 꺼져 있었습니다. 정리 작업인 eviction이 동작하려면 `timeBetweenEvictionRuns`와 `minEvictableIdleDuration`을 모두 설정해야 하는데, 프로젝트에는 어느 쪽도 별도 설정이 없었습니다. 정리 주기를 정하는 `timeBetweenEvictionRuns`의 기본값은 -1이며, 음수이면 작업을 실행하지 않습니다. 제거 대상이 되는 유휴 시간을 정하는 `minEvictableIdleDuration`의 기본값은 30분입니다.

로컬에서 연결을 열어 두고 사용하지 않자 실제로 100초 간격으로 재연결이 일어났습니다. 팀은 자정의 지표도 이 흐름으로 설명했습니다. 피크 때 만들어 둔 커넥션이 자정에는 유휴 상태로 더 많이 남았고, Elasticache의 연결 종료와 Lettuce의 재연결이 반복되면서 New Connection이 늘어난 것으로 보았습니다. Spring Data Redis의 풀 설정에 더해 Redis 서버의 파라미터까지 확인해야 드러나는 원인이었습니다.

## timeout을 유지하고 풀에서 시작한 정리 {#resolution-options}

팀은 유휴 커넥션을 풀에서 제거하기로 했습니다. 쓰지 않는 연결을 계속 유지하지 않아도 된다는 판단이었습니다. Redis의 `timeout`을 늘리는 방법도 있었지만, 100초 동안 사용하지 않은 연결을 끊는 동작은 타당하다고 보고 값을 유지했습니다.

검토했던 다른 방법은 풀의 재사용 순서를 FIFO로 바꾸는 것이었습니다. `application.yml`에서는 이 값을 바꿀 수 없어 `GenericObjectPoolConfig`를 직접 만들고 `lifo = false`를 지정한 뒤 Lettuce 설정에 넣어야 했습니다. 테스트에서는 커넥션을 반납한 순서대로 다시 가져오는 동작을 확인했습니다. 트래픽이 계속 들어온다면 풀의 커넥션들이 고르게 재사용돼 유휴 상태로 남지 않으리라는 기대였습니다. 팀은 이 방법보다 불필요한 연결을 정리하는 쪽을 선택했습니다.

적용한 설정은 `minEvictableIdleDuration` 30초와 `timeBetweenEvictionRuns` 30초입니다. 30초 동안 사용하지 않은 커넥션을 제거 대상으로 삼고, 정리 작업도 30초마다 실행하도록 했습니다. 테스트에서는 커넥션을 풀에 반납한 뒤 여유를 두고 60초를 기다렸습니다. 풀 내부 상태는 assertion 대신 브레이크포인트로 확인했습니다. 설정이 없을 때는 커넥션 3개가 그대로 남았지만, 설정을 추가하자 1개만 남았습니다.

적용 이후에는 피크 시간이 지난 뒤에도 New Connection 지표가 계속 늘어나던 현상이 나타나지 않았습니다.

{{% details title="커넥션 풀 설정과 테스트 값" closed="true" %}}

| 항목 | 값 |
|---|---|
| 환경 | Spring Boot 3.2.4, lettuce 6.3.2, elasticache valkey 8 |
| 풀 크기 | maxActive 20 |
| 풀 의존성 | commons-pool2 2.12.0 |
| 풀 기본 전략 | LIFO (`DEFAULT_LIFO = true`) |
| eviction 기본값 | timeBetweenEvictionRuns -1(동작 안 함), minEvictableIdleDuration 30분 |
| Elasticache timeout | 100초 |
| 적용한 eviction 설정 | minEvictableIdleDuration 30초, timeBetweenEvictionRuns 30초 |
| eviction 테스트 | 설정 없음 시 풀에 커넥션 3개 유지, 설정 있음 시 1개 |

{{% /details %}}
