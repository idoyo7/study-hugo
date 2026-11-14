---
title: "Java 21 가상 스레드와 주인 없는 락에 멈춘 Tomcat"
description: "Java 21에서 Tomcat이 멈춘 원인은 락을 기다리는 가상 스레드가 OS 스레드 풀을 모두 차지한 데드락이었습니다. 락 해제 신호를 받은 스레드까지 실행하지 못한 이유를 스레드 덤프와 힙 덤프로 추적합니다."
date: 2026-11-14
weight: 6
---

# Java 21 가상 스레드와 주인 없는 락에 멈춘 Tomcat (2024-07)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Java 21 Virtual Threads - Dude, Where's My Lock?](https://netflixtechblog.com/java-21-virtual-threads-dude-wheres-my-lock-3052540e231d)
- 부제: Getting real with virtual threads
- 매체 · 게시일: Netflix TechBlog · 2024-07-29
- 저자: Vadim Filanovsky, Mike Huang, Danny Thomas, Martin Chalupa
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## Tomcat이 멎은 뒤에도 살아 있던 JVM {#symptom}

JVM은 살아 있었습니다. 그런데 Tomcat은 요청을 처리하지 못했습니다. Netflix의 Performance Engineering 팀과 JVM Ecosystem 팀에 간헐적 타임아웃과 인스턴스 멈춤 제보가 서로 별개로 들어왔고, 영향받은 서비스에서는 같은 조합이 나타났습니다. Java 21, Spring Boot 3, REST 엔드포인트를 처리하는 내장 Tomcat입니다.

장애가 시작되는 징후는 closeWait 상태 소켓 수의 지속적인 증가였습니다. 원격 피어가 연결을 닫았는데 로컬에서는 아직 닫지 않았다는 뜻입니다. 애플리케이션이 비정상적으로 멈췄을 때 흔히 나타나는 현상이어서, 스레드 덤프로 실행 상태를 확인할 차례였습니다.

이 서비스들은 가상 스레드를 켜 둔 상태였습니다. Java를 마이크로서비스의 주 언어로 쓰는 Netflix에서 JVM Ecosystem 팀은 Java를 업그레이드할 때마다 활용할 새 기능을 찾습니다. 앞선 글에서는 Java 21 마이그레이션과 함께 generational ZGC를 기본 가비지 컬렉터로 바꾼 효과를 소개했습니다. 가상 스레드도 도입하고 싶은 기능이었는데, 배포 과정에서 이런 멈춤 현상을 만났습니다.

## jstack 밖에 쌓인 Tomcat의 요청 대기열 {#diagnostics}

덤프 속 JVM은 한가하기만 했습니다. 팀은 알림으로 문제 상태의 인스턴스를 포착했고, 평소에도 JVM 워크로드의 스레드 덤프를 주기적으로 저장해 사후에 동작을 되짚을 수 있었습니다. 그런데 모아 둔 덤프 어디에도 멈춘 이유가 보이지 않았습니다.

빠진 것은 가상 스레드의 콜 스택이었습니다. jstack 덤프에는 가상 스레드가 나타나지 않으므로, 팀은 `jcmd Thread.dump_to_file`로 더 많은 상태를 담은 덤프를 얻고 마지막 수단으로 힙 덤프도 수집했습니다. 새 덤프에서는 수천 개의 ‘빈’ 가상 스레드가 나왔습니다. 객체만 만들어졌을 뿐 실행을 시작하지 못해 스택이 없었고, 그 수는 closeWait 소켓 수와 거의 같았습니다.

Tomcat의 요청 처리 방식과 맞아떨어지는 단서였습니다. 블로킹 모델의 Tomcat은 요청이 끝날 때까지 워커 스레드 하나를 사용합니다. 가상 스레드를 켜면 요청마다 새 가상 스레드를 만들어 `VirtualThreadExecutor`에 작업으로 넘깁니다. 요청과 워커는 계속 생기는데, 워커가 실행을 시작하지 못하고 있었습니다.

가상 스레드에는 실행할 OS 스레드가 필요합니다. OS 스레드와 1:1로 묶이는 대신 fork-join 풀에 작업으로 스케줄되며, 실행을 맡는 OS 스레드를 carrier 스레드라고 부릅니다. Future의 결과를 기다리는 것과 같은 블로킹 연산을 만나면 continuation으로 실행을 중단했다가 재개합니다. 중단된 가상 스레드는 메모리에 남고, 돌려받은 carrier는 다른 가상 스레드를 실행합니다. carrier에서 실행 중인 상태가 mount, 대기하며 carrier에서 내려온 상태가 unmount입니다.

빈 스레드가 쌓인다는 것은 요청을 맡길 가상 스레드가 부족하다는 뜻이 아니었습니다. 그 스레드를 실행할 carrier가 없다는 쪽을 가리켰습니다.

## ReentrantLock 대기에 붙잡힌 carrier 스레드 {#analysis}

Java 21에서는 가상 스레드가 기다린다고 늘 carrier를 돌려주지는 않습니다. `synchronized` 블록이나 메서드 안에서 블로킹 연산을 만나면 carrier에 고정되는 pinning이 일어납니다. 대기하는 동안에도 OS 스레드를 계속 차지하는 상태입니다.

멈춘 인스턴스의 덤프에 바로 그 경로가 있었습니다. 가상 스레드가 `brave.RealSpan.finish`에서 `synchronized`에 진입한 뒤 zipkin2 `AsyncReporter`의 `CountBoundedQueue.offer`를 거쳐 `ReentrantLock.lock`에서 기다리고 있었습니다. `VirtualThread.parkOnCarrierThread`라는 호출도 carrier를 붙잡은 채 대기한다는 단서였습니다. 이런 가상 스레드가 3개였고, `@DefaultExecutor`라는 이름의 가상 스레드 하나도 같은 경로에 있었습니다.

carrier가 모두 소진된 상태였습니다. 애플리케이션은 4 vCPU 인스턴스에서 실행됐고, 이 인스턴스의 fork-join 풀에 있는 OS 스레드도 4개였습니다. 고정된 가상 스레드 4개가 풀 전체를 차지했으므로 다른 가상 스레드는 실행할 수 없었습니다.

Tomcat은 연결을 받고 요청과 가상 스레드를 만들어 실행기에 넘겼습니다. 하지만 새 가상 스레드는 스케줄되지 못한 채 소켓을 보유하고 대기열에 쌓였습니다. 시작하지 못한 가상 스레드와 closeWait 소켓이 나란히 늘어난 이유입니다. 이제 남은 의문은 carrier를 붙잡은 스레드들이 기다리는 락이었습니다.

## 힙 덤프에서 드러난 주인 없는 ReentrantLock {#heap-dump}

락을 기다리는 스레드는 찾았지만 소유자는 보이지 않았습니다. 보통 스레드 덤프는 `- locked <0x…>`나 “Locked ownable synchronizers”로 소유자를 알려 줍니다. 이번에는 둘 다 없었습니다. jcmd 덤프에는 락·park·대기 정보가 포함되지 않는데, 이는 Java 21의 제약으로 이후 릴리스에서 다룰 예정이었습니다.

호출 경로를 살펴보니 같은 `ReentrantLock`과 `Condition`을 기다리는 스레드는 6개였습니다. 고정된 가상 스레드 4개 외에 #119516이 있었습니다. 이 가상 스레드도 `RealScopedSpan.finish`를 거쳐 스팬을 마무리하는 경로에 있었지만, `synchronized` 블록을 지나지 않아 고정되지 않은 채 park 상태로 기다렸습니다.

남은 하나는 플랫폼 스레드 `AsyncReporter`(#107)였습니다. `CountBoundedQueue.drainTo`의 `awaitNanos` 경로에 있었고, 줄 번호를 확인하니 대기를 끝낸 뒤 내부 `acquire()`에서 막혀 있었습니다. 대기에 들어갈 때는 락을 소유했지만, 깨어난 뒤 다시 얻지 못한 상태입니다. 가상 스레드 5개와 플랫폼 스레드 1개가 기다리고 있다는 사실까지는 확인했으나, 여전히 락의 주인은 알 수 없었습니다.

힙 덤프에서는 락 자체를 쉽게 찾았습니다. Eclipse MAT으로 `AsyncReporter` 스레드의 스택에 있는 객체를 따라가면 됐습니다. 조사에서 아마 가장 까다로운 일은 그 락의 상태를 해석하는 쪽이었습니다. 팀은 `AbstractQueuedSynchronizer` 전체를 이해했다고 주장하지는 않으면서도, 힙에 남은 상태를 설명할 만큼 소스를 역으로 추적했습니다.

- `exclusiveOwnerThread`는 null. 락을 소유한 스레드가 없는 상태
- `state`는 0
- 목록 맨 앞은 waiter가 null이고 상태가 지워진 빈 `ExclusiveNode`
- 바로 다음 노드의 waiter는 가상 스레드 #119516

락에는 주인이 없었습니다. 누군가 락을 오래 쥐고 있어서 기다리는 상황으로는 이 상태를 설명할 수 없었습니다.

## 신호를 받고도 실행할 곳이 없는 #119516 {#no-place-to-run}

힙 덤프가 보여 준 것은 락 해제와 다음 획득 사이의 순간이었습니다. 팀이 찾은 범위에서 `exclusiveOwnerThread`를 비우는 곳은 `ReentrantLock.Sync.tryRelease()`뿐이며, 여기서 `state`도 0으로 설정합니다. 관측한 상태와 일치했습니다.

락 해제가 성공하면 해제한 스레드는 다음 대기자에게 신호를 보냅니다. 이 순간에는 소유권을 놓은 스레드의 노드가 아직 목록 맨 앞에 남아 있고, 다음 노드가 락을 얻으려는 스레드를 가리킵니다. 획득 경로인 `AbstractQueuedSynchronizer.acquire()`를 크게 단순화하면, 락 획득을 시도하고 실패하면 park하는 반복문입니다. 신호를 받은 스레드는 다시 시도하고, 락을 얻으면 자기 노드를 목록 맨 앞으로 옮기고 waiter 참조를 지웁니다.

금세 지나가야 할 순간이었습니다. 하지만 이 JVM은 한 스레드가 락을 풀고 다음 스레드가 아직 얻지 못한 상태에 멈춰 있었습니다. 다음 차례인 #119516은 이미 신호를 받았는데도 스레드 덤프에서는 계속 대기 중이었습니다.

신호를 받는 것과 실행을 재개하는 것은 별개였습니다. 고정되지 않은 가상 스레드 #119516이 다시 실행되려면 fork-join 풀의 carrier가 필요했습니다. 그런데 carrier 4개를 모두 차지한 가상 스레드들은 같은 락을 기다리고 있었고, 락을 얻어 `synchronized` 블록을 나가기 전까지는 carrier를 내놓지 않았습니다. 플랫폼 스레드인 #107은 락을 얻으면 실행할 수 있었지만, #119516에는 락 획득을 재시도할 OS 스레드부터 없었습니다.

고전적인 데드락의 변형이었습니다. 서로 다른 락 두 개 대신, 락 하나와 허가가 4개인 세마포어 역할의 fork-join 풀이 얽혀 있었습니다. 원인을 알고 나자 이 상태를 재현하는 테스트 케이스는 쉽게 만들 수 있었습니다.

Netflix 팀은 Java 21의 이런 거친 모서리를 겪고도 가상 스레드가 대체로 기대에 부응한다고 평가했습니다. 스레드 생성과 컨텍스트 스위칭 오버헤드를 줄여 성능을 높이리라는 기대 아래, 도입을 더 넓혀야 한다고 보았습니다. 글을 쓴 시점에는 Java 23 이후 버전에서 가상 스레드와 락 프리미티브의 통합이 더 나아지기를 기대했습니다.

{{% details title="원문의 주요 수치와 환경" closed="true" %}}

| 항목 | 값 |
|---|---|
| 영향받은 스택 | Java 21, Spring Boot 3, 내장 Tomcat, REST 엔드포인트 |
| 대표 증상 | JVM은 살아 있으나 트래픽 중단, closeWait 소켓 증가 |
| 인스턴스 | 4 vCPU, fork-join 풀 OS 스레드 4개 |
| 고정된 가상 스레드 | 4개 |
| 락을 기다린 스레드 | 가상 스레드 5개 + 플랫폼 스레드 1개 |
| 가상 스레드 덤프 방법 | `jcmd Thread.dump_to_file` (jstack에는 안 나옴) |
| 힙 덤프 분석 도구 | Eclipse MAT |
| 락 상태 | `exclusiveOwnerThread` null, `state` 0 |

{{% /details %}}
