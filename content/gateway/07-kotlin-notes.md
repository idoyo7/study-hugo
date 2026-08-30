---
title: "Kotlin 구현 노트 — 무엇이 실제로 어려운가"
date: 2026-08-06
lastmod: 2026-08-24
linkTitle: "07 Kotlin 구현 노트"
weight: 7
---

# 07 · Kotlin 구현 노트 — 무엇이 실제로 어려운가

{{< callout type="info" >}}
- 런타임 선택은 성능 문제가 아닙니다. WebFlux·Ktor·(MVC + 가상 스레드) 셋 다 파드당 2,500 연결을 여유 있게 감당합니다. 차이는 백프레셔를 어떤 모델로 표현하느냐에서 생깁니다. 팀이 이미 쓰는 것을 고르는 게 대개 옳습니다.
- `XREAD BLOCK`은 커넥션을 독점합니다. Lettuce 문서가 명시하듯 *"the connection will no longer respond to any other commands until XREAD completes"* — tail 전용 커넥션을 따로 잡아야 하고 일반 명령용 커넥션과 절대 섞으면 안 됩니다.
- 한 번의 `XREAD`로 64개 스트림을 전부 읽을 수 있습니다. 샤드마다 커넥션을 만들 필요가 없습니다 — 스트림 하나당 스레드 하나를 붙이는 순진한 구현이 이 설계에서 가장 흔한 낭비입니다.
- 그런데 Redis Cluster에서는 그게 `CROSSSLOT`으로 깨집니다. 해시 태그로 샤드를 슬롯 그룹에 묶어 그룹당 `XREAD` 하나로 만들거나, Cluster 대신 인스턴스를 애플리케이션 레벨로 나누는 편이 단순합니다.
- 느린 소비자가 이 시스템의 조용한 킬러입니다. POS 하나가 TCP 수신 버퍼를 비우지 않으면 그 커넥션의 큐가 무한히 자랍니다. 커넥션당 큐 상한과 초과 시 연결 종료가 없으면 힙이 샙니다.
- `Sinks.Many`든 `Channel`이든 상한 없는 버퍼를 쓰지 마세요. 기본값이 무제한인 API가 많습니다.
- POS 클라이언트를 우리가 만든다는 사실이 설계 자산입니다. last event ID를 처리 완료 후에 커밋하게 하면 서버 코드 변경 없이 at-least-once가 됩니다.
{{< /callout >}}

[04]({{< relref "04-branch-a-client-dials/index.md" >}})의 설계를 JVM/Kotlin으로 옮길 때 실제로 발목을 잡는 것들만 모았습니다. 프레임워크 튜토리얼이 다루지 않는 blocking 명령의 커넥션 독점, Cluster의 CROSSSLOT, 느린 소비자가 본론입니다.

## 1. 런타임 — 셋 다 되고, 기준은 백프레셔 모델

| | Spring WebFlux (Reactor) | Ktor (코루틴) | Spring MVC + 가상 스레드 |
|---|---|---|---|
| 커넥션당 비용 | Netty 채널 + `Sinks.Many` | Netty 채널 + `Channel` | Netty/Tomcat 채널 + 가상 스레드 |
| SSE 타입 | `Flux<ServerSentEvent<T>>` | [`ServerSSESession.send()`](https://ktor.io/docs/server-server-sent-events.html) | `SseEmitter` |
| `retry:` 지원 | `ServerSentEvent.builder().retry(...)` | `send(retry = ...)` (Long) | 직접 문자열 작성 |
| 백프레셔 표현 | 명시적 오버플로 전략 | `Channel` 용량 + `BufferOverflow` | **직접 만들어야 함** |
| 정신 모델 | 리액티브 (학습 곡선) | **코루틴 (Kotlin 관용구)** | 블로킹 (가장 단순) |
| Redis 통합 | Lettuce reactive 자연스러움 | Lettuce coroutine 확장 | Lettuce sync |

성능으로는 차이가 나지 않습니다. 셋 다 Netty 위에서 파드당 수천 연결을 듭니다. 실제 판정 기준은 둘입니다.

1. **팀이 이미 쓰는 것.** Spring 생태계를 쓰고 있으면 WebFlux, 그린필드이고 Kotlin 관용구를 중시하면 Ktor.
2. **백프레셔를 프레임워크가 표현해주는가.** §4가 이 설계의 핵심 위험인데, 가상 스레드 방식은 그 처리를 전부 직접 만들어야 합니다 — 코드는 가장 단순해 보이지만 가장 중요한 부분을 프레임워크가 도와주지 않습니다.

그래서 가상 스레드 방식은 이 워크로드에 권하지 않습니다. 블로킹 코드의 단순함이 매력적이지만 "느린 소비자에게 write가 영원히 블록된다"는 문제를 스레드가 싸다는 이유로 방치하기 쉽습니다. 가상 스레드는 싸도 큐에 쌓이는 이벤트는 힙을 먹습니다.

## 2. 다운스트림 — SSE 응답

연결마다 sink 하나를 두고 파드가 Redis에서 읽은 이벤트를 로컬 맵에서 찾아 그 sink에 밀어넣습니다.

```kotlin
class ConnectionRegistry {
    // deviceId → 그 단말의 SSE sink. 이 파드에 붙은 것만 들어 있다.
    private val conns = ConcurrentHashMap<String, Connection>()

    fun register(deviceId: String, conn: Connection) { conns[deviceId] = conn }
    fun unregister(deviceId: String, conn: Connection) { conns.remove(deviceId, conn) }

    fun deliver(deviceId: String, ev: Event) { conns[deviceId]?.offer(ev) }
    fun broadcast(ev: Event) { conns.values.forEach { it.offer(ev) } }
}
```

이 맵은 "커넥션 레지스트리"가 아닙니다. 다른 파드가 조회하지 않고 공유되지 않으며 파드가 죽으면 그냥 사라집니다. [04]({{< relref "04-branch-a-client-dials/index.md" >}})가 만들지 않기로 한 그 레지스트리와는 다른 물건입니다 — 파드 내부의 자료구조일 뿐입니다.

응답 헤더는 [06 §6]({{< relref "06-k8s-shape.md" >}})의 목록대로 나가야 하고 첫 바이트를 즉시 flush해야 클라이언트가 연결 성립을 인지합니다.

## 3. 업스트림 — Redis Stream tail

### 3.1 `XREAD BLOCK`은 커넥션을 독점한다

[Lettuce](https://lettuce.io/core/release/reference/) 기준 주의사항이 명확합니다 — blocking 명령이 실행되는 동안 그 커넥션은 다른 명령에 응답하지 않습니다. Lettuce의 커넥션은 원래 여러 스레드가 공유하도록 설계돼 있습니다. tail용 `XREAD BLOCK`을 공용 커넥션에서 실행하면 그 파드의 모든 Redis 명령이 함께 멈춥니다.

```kotlin
// tail 전용 커넥션 — 이 커넥션으로는 다른 명령을 절대 보내지 않는다
private val tailConn: StatefulRedisConnection<String, String> = client.connect()
// 일반 명령용은 별도
private val cmdConn: StatefulRedisConnection<String, String> = client.connect()
```

### 3.2 한 번의 `XREAD`로 64개 스트림을 읽는다

`XREAD`는 여러 스트림을 한 명령에 받습니다. 샤드마다 커넥션과 스레드를 만드는 구현은 불필요하고 규모가 커지면 그대로 병목이 됩니다.

```kotlin
val offsets: Array<XReadArgs.StreamOffset<String>> =
    (0 until SHARDS).map { XReadArgs.StreamOffset.from("pos-ev:$it", lastId[it]) }
        .toTypedArray()

val batch = tailConn.sync().xread(
    XReadArgs.Builder.block(Duration.ofSeconds(30)).count(500),
    *offsets
)
```

반환된 각 엔트리의 스트림 키에서 샤드 번호를 뽑아 `lastId`를 갱신하고 `dev` 필드로 로컬 라우팅합니다. 루프 하나, 커넥션 하나, 스레드 하나면 됩니다.

### 3.3 Redis Cluster의 `CROSSSLOT` 함정

[04 §4.3]({{< relref "04-branch-a-client-dials/index.md" >}})에서 샤드를 Redis Cluster 노드에 흩어 송신 부하를 나누자고 했는데 그러면 §3.2의 단일 `XREAD`가 성립하지 않습니다. Cluster에서 다중 키 명령은 모든 키가 같은 슬롯에 있어야 하고 아니면 `CROSSSLOT` 오류입니다.

해법은 이렇습니다.

① 해시 태그로 그룹을 만듭니다. 중괄호 안이 같으면 같은 슬롯으로 갑니다.

```
pos-ev:{g0}:0 … pos-ev:{g0}:15     → 슬롯 A
pos-ev:{g1}:16 … pos-ev:{g1}:31    → 슬롯 B
pos-ev:{g2}:32 … pos-ev:{g2}:47    → 슬롯 C
pos-ev:{g3}:48 … pos-ev:{g3}:63    → 슬롯 D
```

파드는 그룹마다 전용 커넥션 하나로 `XREAD`합니다 — 4개 그룹이면 커넥션 4개, `XREAD` 4개. 슬롯은 노드에 분산되므로 송신 부하도 나뉩니다.

② Cluster를 쓰지 않고 인스턴스를 애플리케이션 레벨로 나눕니다. `redis-a`, `redis-b`처럼 독립 인스턴스를 두고 샤드를 정적으로 배분합니다. Cluster의 리샤딩·MOVED 처리·클라이언트 복잡도가 통째로 사라집니다. 이 워크로드에는 Cluster의 자동 리샤딩이 필요 없으므로 ②가 더 단순합니다.

①과 ② 모두 "파드가 유지하는 tail 커넥션 수 = 그룹 수"입니다. 그룹 수는 Redis 노드 수와 같게 잡으면 되고 대개 한 자릿수입니다.

### 3.4 `lastId` 복구

파드가 재시작하면 `lastId`가 없습니다. `$`(지금부터)로 시작하는 것이 맞습니다 — 밀린 이벤트는 각 POS가 `Last-Event-ID`로 알아서 요청하므로 파드가 과거를 재생할 이유가 없습니다.

여기서 `0`(처음부터)으로 시작하면 재시작할 때마다 전 스트림을 다시 읽고 전 커넥션에 중복 전송합니다. 흔한 실수입니다.

## 4. 느린 소비자 — 이 시스템의 조용한 킬러

POS 하나가 죽거나, 매장 회선이 막히거나, 단말이 멈춰 TCP 수신 버퍼를 비우지 않으면 그 커넥션의 write가 진행되지 않습니다. 이벤트는 계속 오고 큐는 계속 자랍니다.

연결은 끊기지 않습니다. TCP는 상대가 살아 있는 한 죽지 않고 SSE는 애플리케이션 레벨 ack가 없습니다. 하트비트도 쓰기 방향이라 도움이 안 됩니다 — 우리가 보내는 ping이 같은 큐에 쌓일 뿐입니다.

그래서 큐 상한이 유일한 방어선입니다.

```kotlin
// Reactor: 상한 있는 버퍼 + 오버플로 시 에러
val sink = Sinks.many().unicast()
    .onBackpressureBuffer<ServerSentEvent<String>>(
        Queues.<ServerSentEvent<String>>get(QUEUE_LIMIT).get()
    )
```

```kotlin
// 코루틴: 상한 있는 Channel + 오버플로 시 예외
val channel = Channel<Event>(capacity = QUEUE_LIMIT)
// trySend 가 실패하면 = 상한 초과
if (!channel.trySend(ev).isSuccess) closeSlowConsumer(deviceId)
```

상한을 넘으면 그 연결을 끊습니다. POS는 재접속하고 `Last-Event-ID`로 밀린 것을 다시 받거나 재개 창을 벗어났으면 `event: resync`를 받습니다. 끊는 것이 곧 복구 경로입니다. 이게 이 설계의 좋은 성질입니다.

상한 값은 재개 창과 함께 정합니다 — 큐가 100개까지 찬다면 그 시점의 지연이 얼마인지가 기준입니다. 100~500이 출발점이고 `sse_slow_consumer_disconnects_total`을 보면서 조정합니다.

기본값이 무제한인 API를 조심하세요. `Sinks.many().unicast().onBackpressureBuffer()`를 인자 없이 부르면 무제한 큐입니다. `Channel()`도 기본이 `RENDEZVOUS`라 성격이 다르지만 `Channel(Channel.UNLIMITED)`은 그대로 힙 누수입니다.

## 5. 하트비트

```kotlin
// ALB idle timeout(기본 60초)보다 충분히 짧게
scheduler.scheduleAtFixedRate(20.seconds) {
    registry.forEach { it.writeComment("ping") }
}
```

`: ping\n\n` 주석 줄입니다. `id:`를 붙이면 안 됩니다 — 클라이언트의 last event ID가 오염돼 재개 시작점이 틀어집니다.

하트비트도 §4의 큐를 지나갑니다. 하트비트가 큐 상한에 걸려 연결이 끊긴다면 정상 동작입니다 — 그 커넥션은 이미 이벤트를 못 받고 있었습니다.

## 6. Graceful shutdown

[06 §2.2]({{< relref "06-k8s-shape.md" >}})의 순서를 코드로 옮기면 이렇습니다.

```kotlin
fun onSigterm() {
    // 1. readiness 는 preStop 에서 이미 실패로 전환됨 — LB 드레이닝 진행 중
    // 2. tail 루프 중단: 더 이상 새 이벤트를 받지 않는다
    tailRunning.set(false)

    // 3. 커넥션마다 서로 다른 재연결 지연을 배포한다
    val window = 60_000
    registry.forEach { conn ->
        conn.writeRaw("retry: ${Random.nextInt(1_000, window)}\n\n")
    }

    // 4. 점진적으로 끊는다 — 초당 상한
    registry.chunked(100).forEach { batch ->
        batch.forEach { it.complete() }
        Thread.sleep(1_000)
    }
}
```

3번이 SSE를 고른 값을 회수하는 지점입니다. [WHATWG 명세](https://html.spec.whatwg.org/multipage/server-sent-events.html)가 `retry:`를 재연결 시간 설정으로 규정하므로 클라이언트가 명세를 따르기만 하면 이 한 줄로 재접속이 흩어집니다.

4번의 `Thread.sleep`은 예시입니다. 실제로는 종료 전용 스케줄러에서 논블로킹으로 처리하고 전체 소요가 `terminationGracePeriodSeconds` 안에 들어오는지 계산해두어야 합니다.

## 7. POS 클라이언트 측 계약

브라우저가 아니므로 `EventSource`의 자동 동작을 우리가 구현해야 합니다. 대신 그 덕에 명세보다 나은 규약을 넣을 수 있습니다.

| 항목 | 명세 기본 | 우리 규약 |
|---|---|---|
| 재연결 | 자동, 구현 정의 지연 | `retry:` 존중 + **지수 백오프 상한** + jitter |
| `Last-Event-ID` | 수신 즉시 갱신 | **처리 완료 후 커밋** → at-least-once |
| 전송 방식 | HTTP 헤더 | 헤더 그대로 (자체 클라이언트라 자유) |
| `event: resync` | — | **REST 전체 재동기화 트리거** |
| 인증 | — | 헤더에 토큰. 만료 시 재접속 경로에서 갱신 |

두 번째 줄이 전달 보장 등급을 정합니다. 서버는 이 선택에 관여하지 않습니다 — [04 §3.1]({{< relref "04-branch-a-client-dials/index.md" >}})의 그 규약입니다.

`retry:`를 존중하되 상한을 두어야 합니다. 서버가 버그로 `retry: 1`을 보내면 5만 대가 초당 재접속을 시도합니다. 클라이언트에 최소 지연 하한(예: 1초)과 연속 실패 시 지수 백오프를 넣습니다.

## 8. 관측 지표

| 지표 | 왜 필요한가 |
|---|---|
| `sse_active_connections` (파드별) | **HPA 지표**이자 분산 균형 확인 — [06 §4]({{< relref "06-k8s-shape.md" >}}) |
| `sse_connection_age_seconds` (히스토그램) | 재접속 폭풍이 오면 분포가 왼쪽으로 몰린다 |
| `sse_events_delivered_total` / `_dropped_total` | 로컬 필터가 버린 양 = 읽기 증폭의 실측치 |
| `sse_slow_consumer_disconnects_total` | §4의 큐 상한이 적절한지 |
| `sse_resync_total` | 재개 창이 짧아 전체 재동기화가 잦은지 |
| `redis_tail_lag_seconds` | 마지막 읽은 Stream ID의 타임스탬프와 현재 시각의 차 — **tail이 밀리고 있는지** |
| `redis_tail_bytes_total` | [04 §4.2]({{< relref "04-branch-a-client-dials/index.md" >}})의 `R × S × P` 실측 |

`redis_tail_lag_seconds`가 가장 중요합니다. 이 값이 자라기 시작하면 파드가 이벤트 소비를 못 따라간다는 뜻이고 그건 곧 모든 POS의 지연으로 나타납니다. Stream ID의 앞부분이 밀리초 타임스탬프이므로 계산이 공짜입니다.

## 9. 부하 시험에서 반드시 재야 할 것

설계 문서로 정할 수 없고 재봐야만 아는 값들입니다.

1. **연결당 힙** — 2,500 연결을 붙여놓고 큐가 빈 상태의 힙, 큐가 상한까지 찬 상태의 힙. 후자가 파드 메모리 상한을 정합니다.
2. **재접속 처리율** — 5만 대가 한꺼번에 붙을 때 파드가 초당 몇 개를 수락하는가. TLS 핸드셰이크가 병목이면 CPU 요청량이 여기서 정해집니다.
3. **`R × S × P` 실측** — [04 §4.2]({{< relref "04-branch-a-client-dials/index.md" >}})의 곱. 예상 이벤트 크기가 실제와 다른 경우가 많습니다.
4. **느린 소비자 시나리오** — 커넥션 일부를 일부러 안 읽게 만들고 힙과 `slow_consumer_disconnects`를 관찰. 이 시험을 안 하면 §4가 제대로 동작하는지 알 수 없습니다.
5. **종료 절차 총 소요** — §6 전체가 `terminationGracePeriodSeconds` 안에 들어오는가.

4번이 특히 빠지기 쉽습니다. 정상 부하 시험에서는 모든 클라이언트가 성실히 읽으므로 큐 상한 로직이 한 번도 발화하지 않고 그래서 그게 틀렸는지도 모른 채 배포됩니다.
