---
title: "Redis New Connection 증가의 원인과 커넥션 풀 설정 정리"
description: "Redis의 신규 커넥션 지표가 피크 시간이 지나도 줄지 않던 현상을 추적한 과정입니다. Lettuce 커넥션 풀의 LIFO 전략과 Elasticache의 idle timeout이 맞물린 결과였고, 풀의 idle 커넥션 정리 설정으로 풀었습니다."
date: 2026-11-14
weight: 1
---

# Redis New Connection 증가의 원인과 커넥션 풀 설정 정리 (2025-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Redis New Connection 증가 이슈 돌아보기](https://techblog.woowahan.com/23121/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2025-10-14
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 신규 커넥션 지표에서 생긴 의문 {#new-connection-anomaly}

팀은 사용자 맞춤 데이터를 빠르게 내려주려고 Redis를 캐시로 씁니다. 모니터링 중에 신규 커넥션 연결 수 지표가 이상하다는 점을 발견했습니다. 저녁 피크가 지나 자정으로 향하는데도 지표가 줄지 않았고, 오히려 피크 시간보다 자정에 더 높게 잡혔습니다.

처음에는 조회할 때마다 커넥션을 새로 만드는 것은 아닌지 의심했습니다. 서버의 Lettuce 설정을 보니 이미 커넥션 풀을 쓰고 있었습니다. 풀이 있다면 새로 맺는 커넥션은 많지 않아야 하는데 지표는 반대로 움직였기 때문에 원인을 더 파 보기로 했습니다. 환경은 Spring Boot 3.2.4, Lettuce 6.3.2, Elasticache Valkey 8입니다.

## 파이프라이닝이 전용 커넥션을 쓴다 {#pipelining-dedicated-connection}

가장 먼저 의심한 곳은 파이프라이닝이었습니다. 팀은 사용자가 최근 본 상품을 Redis list에 담고, push, trim, expire 세 동작을 `executePipelined`로 묶어 처리합니다. 보통 redisTemplate은 커넥션 하나를 공유하지만, 파이프라인을 열면 `LettuceConnection`이 전용 커넥션을 할당합니다.

테스트로 확인했습니다. 파이프라인을 열지 않은 두 커넥션의 nativeConnection은 같았고, `openPipeline()`을 호출한 두 커넥션은 서로 달랐습니다. 다만 풀이 설정돼 있으면 이 전용 커넥션도 풀에서 가져옵니다. 이 프로젝트는 `maxActive: 20`의 풀 설정이 이미 있었으므로, 한 번 만든 커넥션을 재사용하면 생성 수는 많지 않아야 했습니다.

## 로그에 남은 재연결 {#reconnect-in-logs}

서버 로그를 더 살펴보니 커넥션 reconnect가 일어난 흔적이 있었습니다. Lettuce의 `ConnectionWatchdog`는 채널이 inactive가 되면 재연결을 예약하고 로그를 남깁니다. 어떤 이유로 연결이 끊어지고 있었던 것입니다.

## LIFO 풀과 idle timeout {#lifo-and-idle-timeout}

원인은 두 가지가 겹친 데 있었습니다.

먼저 `GenericObjectPool`은 기본이 LIFO입니다. 풀의 커넥션을 고르게 쓰지 않고 최근에 쓴 것 위주로 꺼냅니다. 한때 트래픽이 몰려 풀이 최대로 늘어난 뒤 상황이 풀리면, 몇몇 커넥션만 계속 쓰이고 나머지는 idle로 남습니다. 게다가 idle 정리는 기본으로 꺼져 있습니다. `timeBetweenEvictionRuns`와 `minEvictableIdleDuration`을 둘 다 설정해야 eviction이 도는데, 앞의 기본값이 -1이라 동작하지 않습니다. 이 프로젝트에는 두 설정이 모두 없었습니다.

다음으로 Elasticache의 parameter group에서 `timeout`이 100으로 잡혀 있었습니다. 100초 동안 쓰지 않은 idle 커넥션을 서버 쪽이 끊습니다. 끊긴 커넥션은 ConnectionWatchdog가 다시 맺습니다. 로컬에서 커넥션을 열어 두고 가만히 두자 실제로 100초 간격으로 재연결되는 것도 확인했습니다.

종합하면 이렇습니다. 피크 때 많이 만들어 둔 커넥션이 자정에는 대부분 idle이 되고, Elasticache가 이를 끊으면 Watchdog가 재연결하면서 New Connection 지표가 오히려 올라갔습니다.

## 해소 방안 두 가지와 선택 {#resolution-options}

팀은 Redis의 timeout 값을 올리지 않았습니다. 100초 동안 쓰지 않는 커넥션을 지우는 것이 타당하다고 봤기 때문입니다. 대신 애플리케이션 쪽에서 두 가지 방법을 검토했습니다.

1번은 풀 전략을 LIFO에서 FIFO로 바꾸는 방법입니다. `application.yml`로는 이 값을 바꿀 수 없어서 `GenericObjectPoolConfig`를 직접 만들고 `lifo = false`로 둔 뒤 Lettuce 설정에 넣어야 합니다. 테스트에서 반납한 순서대로 다시 할당되는 것을 확인했고, 트래픽이 계속 들어오면 풀의 커넥션이 idle로 오래 남지 않으리라 기대할 수 있었습니다.

2번은 idle 커넥션을 정리하는 방법입니다. `minEvictableIdleDuration`과 `timeBetweenEvictionRuns`를 설정합니다. 브레이크포인트로 풀 내부를 확인한 테스트에서, 설정이 없으면 커넥션 3개가 그대로 남았고 설정이 있으면 1개만 남았습니다.

팀은 idle 커넥션을 계속 붙들고 있을 이유가 없다고 판단해 2번을 택했습니다. 적용 뒤에는 피크 시간이 지나도 New Connection 지표가 늘어나지 않았습니다.

## 마무리에서 남긴 교훈 {#lessons}

원문은 Redis를 쓸 때 Spring Data Redis 설정만이 아니라 Redis 서버 쪽 파라미터까지 함께 봐야 한다는 점을 배웠다고 정리합니다.

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
