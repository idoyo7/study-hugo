---
title: "JVM vs GraalVM"
linkTitle: "01 JVM vs GraalVM"
weight: 1
---

# 01 · JVM vs GraalVM — 시동을 사면 무엇으로 값을 치르나

{{< callout type="info" >}}
- **지도가 2025년 9월에 바뀌었습니다.** Graal JIT은 Oracle JDK 24가 마지막이고 JDK 25에서 빠졌습니다. Native Image도 Java SE 구독의 지원 범위에서 제외됐고 Oracle은 같은 목표를 **Project Leyden**으로 가져갔습니다. 기술이 죽은 건 아니지만 "중간 지대"였던 Graal JIT은 실제로 사라졌습니다.
- **"Native Image가 C2보다 빠르다"는 유료 전제 위에 서 있습니다.** Oracle의 Petclinic 수치(13,075 vs 12,488 req/s)는 PGO와 G1을 켠 조합인데 **둘 다 Community Edition에는 빠져 있습니다.** CE + Serial GC + PGO 없음이라는 실제 오픈소스 조합의 공개 수치는 어느 벤더 자료에도 없습니다.
- **CE Native Image는 Serial GC 고정입니다.** 기본 최대 힙이 물리 메모리의 **80%**(G1은 25%)이고 문서가 "GC 중 RSS가 최대 힙의 2배까지 일시 증가할 수 있어 컨테이너에서 문제가 된다"고 직접 경고합니다. `-Xmx`를 지정하지 않으면 컨테이너에서 터집니다.
- **동시성 논쟁의 실제 변수는 실행 모델이 아니라 acceptor입니다.** 6만 연결 실측에서 Tomcat은 CPU 20%인 채로 2만에서 99.9% 실패했습니다. TCP 연결을 받아들이는 쪽이 먼저 막혔고 처리 능력은 남아 있었습니다.
- **리액티브가 메모리에 유리하다는 통념은 조건부입니다.** 같은 실측에서 1.6KB 응답으로 바꾸자 WebFlux는 GC에 108초를 쓰며 P50이 1.17초로 무너졌고 가상 스레드가 31% 더 처리했습니다.
- **시동만 문제라면 런타임을 안 바꾸는 답이 생겼습니다.** JDK 24/25의 AOT 캐시는 Spring PetClinic 시동을 4.486초에서 2.604초로 줄이면서(**42%**) JIT을 그대로 둡니다.
{{< /callout >}}

회사에서 런타임을 바꿔보자는 말이 나오는 이유는 대개 비슷합니다. 시동이 느리다, 메모리를 많이 먹는다, 오토스케일이 붙을 때마다 처음 몇 초가 아프다. 그래서 GraalVM을 꺼내 봅니다.

이 문서는 그 선택을 "빨라지나 안 빨라지나"로 묻지 않습니다. 클래스를 읽고 링크하는 일, 무엇이 뜨거운지 알아내는 일, 그걸 좋은 기계어로 바꾸는 일 — 이 일은 어느 런타임에서도 없어지지 않습니다. 런타임을 바꾼다는 건 그 일을 다른 시점, 다른 사람, 다른 청구서로 옮기는 결정입니다. 무엇이 어디로 가는지를 따라가 보겠습니다.

자매 문서: [02 Python 워커와 스레드]({{< relref "../02-python-worker-thread/index.md" >}}) — 같은 질문을 프로세스와 스레드 축에서 봅니다 · 컨테이너 CPU limit 일반론은 [k8s 02 CPU Throttling]({{< relref "../../k8s-features/02-cpu-throttling/index.md" >}}) · 그 문서 §4 런타임 표의 JVM 행이 이 문서입니다

## 1. 세 갈래에서 두 갈래로, 그리고 다시 셋으로

"GraalVM"이라는 한 단어가 오랫동안 서로 다른 셋을 가리켰습니다.

| | 실행 방식 | 바이트코드 로드 | 워밍업 | 2026년 상태 |
|---|---|---|---|---|
| HotSpot + C2 | JIT | O | 있음 | OpenJDK 기본 |
| HotSpot + Graal JIT (libgraal) | JIT | O | 있음 | **Oracle JDK 25에서 제거** |
| Native Image (SubstrateVM) | AOT | X (closed world) | 없음 | GraalVM의 주력 |

2025년 9월 15일 Oracle이 "Detaching GraalVM from the Java Ecosystem Train"을 냈습니다. 읽어야 할 대목은 두 문장입니다.

> GraalVM Early Adopter technology, including Native Image, is being discontinued for Java SE Product customers. The goals of improving the startup time, time to peak performance, and footprint of Java programs are being pursued further in OpenJDK's Project Leyden as a standard part of Java.
>
> — 출처: Oracle, Detaching GraalVM from the Java Ecosystem Train (2025-09-15)

> The GraalVM team are transitioning to focus on non-Java Graal Languages including GraalPy and GraalJS.
>
> — 출처: 같은 글

해석은 엇갈렸습니다. Micronaut 저장소에 같은 질문이 올라왔고 GraalVM 쪽 답이 달렸습니다 — "Java SE 구독자가 Native Image 지원을 구독에 포함해 받지 못하게 된다는 뜻이지, 기술이 deprecated되거나 중단되는 게 아니다." Quarkus·Micronaut·Spring의 네이티브 경로는 그대로 돌아갑니다. 그래도 방향은 분명합니다. **Oracle이 "시동과 풋프린트"를 내걸고 미는 물건이 Native Image에서 Leyden으로 넘어갔습니다.**

그래서 지도는 이렇게 다시 그려집니다. 중간 지대였던 Graal JIT이 빠진 자리에 JDK 24/25에 들어온 AOT 캐시가 새 중간 지대로 들어왔습니다.

{{< flow src="_flow/1-같은-일을-언제-하는가.json" />}}

세 줄이 하는 일의 총량은 같습니다. 다른 건 **언제 하느냐**입니다. C2는 전부 런타임에 합니다. AOT 캐시는 로드·링크와 프로파일 수집을 훈련 실행으로 당겨 놓고 컴파일만 런타임에 남깁니다. Native Image는 컴파일까지 빌드로 당기고 런타임에는 아무것도 남기지 않습니다 — 그래서 런타임에 되돌릴 수도 없습니다.

## 2. JIT과 AOT가 실제로 맞바꾸는 것

Native Image가 피크 처리량에서 C2에 밀리는 이유를 GraalVM 문서가 한 문장으로 씁니다. "without profile information, it is hard to generate machine code of the same quality as a JIT compiler."

JIT은 관찰한 다음에 투기합니다. 이 호출 지점은 항상 같은 구현이 오더라, 이 분기는 한 번도 안 타더라 — 그런 관찰 위에서 인라이닝하고 분기를 잘라냅니다. 그러다 빗나가면 역최적화로 물러나 인터프리터로 돌아갑니다. **되돌릴 수 있으니까 투기할 수 있습니다.** AOT에는 그 되돌림 장치가 없습니다. 그래서 애초에 투기를 안 합니다.

PGO가 그 격차를 메우는 장치입니다. 계측된 바이너리를 대표 워크로드로 한 번 돌려 프로파일을 모으고 그 프로파일로 다시 컴파일합니다. Oracle의 Spring Petclinic 벤치마크(최대 힙 512MB, GraalVM for JDK 21):

| 구성 | 피크 처리량 |
|---|---|
| Oracle GraalVM Native Image + PGO + G1 GC | 13,075 req/s |
| HotSpot JIT (C2) + G1 GC | 12,488 req/s |

5% 우위입니다. 그런데 이 표는 숫자보다 구성을 봐야 합니다. GraalVM 공식 문서에 이렇게 적혀 있습니다 — **"Note: PGO is not available in GraalVM Community Edition."** G1도 문서 기준으로는 Oracle GraalVM 전용입니다. 저 표의 왼쪽 줄은 CE 사용자가 재현할 수 없습니다.

한편 Quarkus 공식 페이지의 유명한 표는 반대 방향을 가리킵니다.

| 항목 | Quarkus Native | Quarkus JVM |
|---|---|---|
| 시동 | 18 ms | 1,629 ms |
| 최대 RSS | 122 MB | 414 MB |
| 최대 처리량 (40 동시 연결) | 44,841 req/s | 76,488 req/s |

Quarkus 자신이 같은 페이지에 이렇게 적어 뒀습니다. "Quarkus running on the JVM provides improved throughput and response time compared to Native mode for a single process, but uses up to 277% more memory." **인용할 때 조심할 것** — 이 표의 JVM은 `build 25.191-b12`, 곧 HotSpot 8입니다. 2026년 판단 근거로 그대로 쓰면 네이티브 쪽으로 기울어집니다.

두 표가 충돌하는 게 아닙니다. 차이는 "PGO를 쓰느냐" 하나에 걸려 있을 뿐입니다. PGO를 쓰려면 GFTC 배포판을 쓰고, 대표성 있는 트래픽으로 계측 실행을 돌리고, 그 프로파일을 배포마다 갱신하는 파이프라인을 CI에 붙여야 합니다. **빌드가 두 번 돕니다.** 프로파일이 실제 트래픽과 어긋나면 효과가 줄고 그 어긋남은 그래프에 안 나타납니다.

## 3. GC — CE에서 가장 먼저 물리는 곳

Native Image가 쓸 수 있는 GC는 셋입니다.

| GC | 활성화 | 제약 |
|---|---|---|
| Serial GC | 기본값 | 전 플랫폼. "optimized for low memory footprint and small Java heap sizes" |
| G1 GC | `--gc=G1` | Linux AMD64/AArch64. 문서 기준 **CE에 없음** |
| Epsilon | `--gc=epsilon` | no-op. 짧게 살다 죽고 할당이 적은 프로세스 전용 |

여기서 기본 힙 크기가 함정입니다. **Serial GC는 최대 힙을 안 주면 물리 메모리의 80%를 잡습니다.** G1은 25%입니다. 4GB 컨테이너에서 3.2GB가 최대 힙이 됩니다. 문서는 바로 다음 문단에서 이렇게 경고합니다.

> the GC needs some extra memory when performing a garbage collection (2x of the maximum heap size is the worst case, usually, it is significantly less). Therefore, the resident set size, RSS, can increase temporarily during a garbage collection which can be an issue in any environment with memory constraints (such as a container).
>
> — 출처: GraalVM Native Image Memory Management 레퍼런스

Serial GC가 mark-copy semi-space 방식이라 살아남은 객체를 복사할 여유 공간이 필요하기 때문입니다. 컨테이너 메모리 limit에 맞춰 힙을 잡으면 GC 도중에 그 limit을 넘습니다. Quarkus 가이드가 "Setting the maximum heap size, either as a percentage or an explicit value, is generally recommended"라고 쓰는 이유도 여기 있습니다. 기본값에 맡기지 말라는 뜻입니다.

장시간 구동에서 이게 어떻게 드러나는지는 이슈에 남아 있습니다. oracle/graal [#10499](https://github.com/oracle/graal/issues/10499)은 Spring Boot 앱을 GraalVM 21 CE 네이티브로 돌린 사례입니다. `-Xms768m -Xmx768m`을 줬는데 `-Xms`가 무시됐고 몇 초마다 minor GC, 1~2분마다 full GC가 돌았습니다. 연속 full GC 구간에서 애플리케이션이 얼어붙었고 그 시점 Eden이 4MB까지 쪼그라들었습니다. 이슈는 문서화된 해결 없이 닫혔습니다.

GraalVM 팀도 여기를 알고 손대는 중입니다. JDK 23에서 Serial old generation에 compacting 모드(`-H:+CompactingOldGen`)가 들어왔고 25.1에서 새 정책 "Adaptive2"가 old gen에 mark-compact를 기본으로 쓰게 됐습니다. Quarkus는 2.14부터 기본 정책을 "space/time"에서 "adaptive"로 바꾸며 "the 'space/time' policy can result in worse out-of-the-box experience"라고 적었습니다.

기준은 힙입니다. **힙이 작고 객체가 요청 안에서 태어나 요청과 함께 죽는 워크로드에서는 Serial GC의 불리함이 잘 안 드러납니다.** 반대로 힙이 GB 단위로 커지고 오래 사는 캐시가 쌓이는 서비스일수록 단일 스레드 stop-the-world가 그대로 지연 꼬리로 나옵니다. 코어를 더 줘도 GC 처리량은 안 올라갑니다.

{{< callout type="warning" >}}
CE와 Oracle GraalVM의 격차를 옛 자료로 판단하면 틀립니다. 2021년 Oracle 비교 PDF에서 EE 전용이던 압축 참조가 25.2에서 CE 기본값이 됐고 그 효과로 Micronaut 웹앱의 부하 상태 RSS가 25.0 대비 39% 줄었습니다. GraalVM 25 릴리스 노트는 community와 non-community Maven 아티팩트가 이제 동일하다고 밝힙니다. 남아 있는 Oracle 전용은 PGO, G1(문서 기준), XGBoost 기반 콜카운트 프로파일링 정도입니다.
{{< /callout >}}

## 4. 컨테이너 CPU limit 아래에서

CPU limit이 무엇을 하는지는 [k8s 02]({{< relref "../../k8s-features/02-cpu-throttling/index.md" >}})가 다뤘습니다. 여기서는 그 아래에서 JVM과 Native Image가 어떻게 다르게 반응하는지만 봅니다.

JVM은 cgroup을 봅니다. **limit이 없으면 request는 무시하고 노드 전체 코어를 봅니다.** cgroup v2의 `cpu.max`를 읽는 구조라 `cpu.weight`(request 쪽)는 계산에 안 들어갑니다. 그렇게 감지한 CPU 수가 셋을 결정합니다.

| 항목 | 공식 | 32코어 노드에서 |
|---|---|---|
| JIT 컴파일러 스레드 | CPU 수 기반 | 15개 |
| G1 ParallelGCThreads | 8 이하는 CPU 수, 초과는 `floor(5/8 × CPU)` | 23개 |
| ForkJoinPool.commonPool 병렬도 | `max(CPU - 1, 1)` | 31개 |

마지막 줄이 이 문서 맥락에서 중요합니다. 가상 스레드 스케줄러가 ForkJoinPool 기반이라 캐리어 스레드 수가 여기서 정해집니다. request만 주고 limit을 뺀 파드는 64코어 노드에서 캐리어 63개를 잡습니다.

여기에 워밍업이 겹칩니다. 시동 직후나 새 핫패스가 열릴 때 JIT 컴파일이 CPU를 집중적으로 먹습니다. `500m` 파드라면 100ms 창마다 50ms인데 JIT 버스트가 그걸 한 번에 태우면 애플리케이션 스레드까지 다음 창까지 얼어붙습니다. GC 스레드와 컴파일러 스레드가 많을수록 더 빨리 마릅니다. 그 사이에 readiness probe가 통과해 트래픽이 들어오면 첫 요청들이 그 값을 치릅니다. **스케일 아웃이 잦을수록 이 구간을 반복해서 지불합니다.**

Native Image에는 JIT 컴파일러 스레드가 없습니다. 런타임 컴파일이 없으니 시동 구간의 CPU 버스트도 없습니다. 여기까지는 명확한 이점입니다. 대신 CE에서는 GC가 단일 스레드라 CPU를 더 줘도 GC 처리량은 그대로입니다. **두 축이 반대로 움직입니다** — CPU가 적을수록 JIT 부재의 이점이 커지고 힙이 클수록 Serial GC의 불리함이 커집니다.

컨테이너 인지 자체도 완벽하진 않았습니다. oracle/graal [#3992](https://github.com/oracle/graal/issues/3992)에서는 `--memory 100m --cpus 1.0`으로 띄운 네이티브 실행 파일이 호스트 값(25GB, 8 CPU)을 보고했습니다. 같은 코드를 OpenJDK 17로 돌리면 컨테이너 값을 제대로 봤습니다. PR로 대응됐지만 이런 회귀가 있었다는 사실 자체가 확인 항목을 하나 더 만듭니다.

{{< callout type="warning" >}}
회피책으로 도는 `-H:-UseContainerSupport`는 문제를 옮길 뿐입니다. 이 옵션은 컨테이너 CPU 쿼터를 아예 무시하고 호스트 코어 수를 돌려줍니다. cgroup 경로에 콜론이 들어갈 때 `Runtime.availableProcessors()`가 예외를 던지는 버그([#4757](https://github.com/oracle/graal/issues/4757))의 우회로 알려졌지만 켜는 순간 §4 첫 표의 함정을 전부 되살립니다. 고정이 필요하면 `-XX:ActiveProcessorCount=N`을 쓰는 편이 낫습니다.
{{< /callout >}}

## 5. 동시성 모델 — 진짜 변수는 acceptor였다

Native Image는 GraalVM for JDK 21부터 가상 스레드를 정식 지원합니다. preview 플래그가 필요 없습니다. 남은 제약은 폴리글롯 쪽입니다 — Truffle 언어(GraalJS 같은)를 네이티브 실행 파일에 넣으면 `Virtual threads are not supported together with Truffle JIT compilation` 예외가 납니다. 일반 Spring/Quarkus 서비스에는 해당 없습니다.

그럼 가상 스레드와 리액티브 중 뭘 골라야 하나. 조건이 잘 명시된 공개 실측이 하나 있습니다.

{{< flow src="_flow/5-먼저-무너지는-자리.json" />}}

`loom-webflux-benchmarks`의 조건은 이렇습니다 — Intel Core i5-14600K(14코어 20스레드), 베어메탈 Ubuntu, Amazon Corretto 25.0.3, Spring Boot 4.1.0, 힙 `-Xms2g -Xmx2g` 고정, k6 부하 생성기. 비교 대상은 `loom-tomcat`, `loom-netty`, `webflux-netty` 셋입니다.

먼저 Tomcat이 걸린 벽을 봅니다. 2만 fixed-rate에서 오류율이 99.9%를 넘겼는데 **그 와중에 평균 CPU는 20% 언저리였습니다.** 실패의 정체는 OS 레벨 "connection refused"였습니다. acceptor가 SYN 백로그를 비우지 못한 결과입니다. 같은 6만이라도 think-time을 1~3초 넣은 paced spike는 오류 0%로 통과합니다 — 동시 유지 연결이 1.5k에 불과하니까요. "가상 스레드로 바꿨는데 안 늘더라"의 상당수가 여기입니다. 실행 모델을 바꾸기 전에 연결을 받아들이는 층을 먼저 봐야 합니다.

그 문턱을 넘긴 다음에야 실행 모델 차이가 드러납니다. 그런데 방향이 페이로드에 따라 뒤집힙니다.

| 6만 동시 연결, 작은 페이로드 | 처리 요청 | P50 / P90 / P99 | CPU | GC |
|---|---|---|---|---|
| loom-netty | 10.99M | 100 / 288 / 734 ms | 69.3% | 9.3초 |
| webflux-netty | 11.07M | 100 / 222 / 613 ms | 61.6% | 8.1초 |

| 6만 동시 연결, 1.6KB JSON | 처리 요청 | P50 / P90 / P99 | CPU | GC |
|---|---|---|---|---|
| loom-netty | 10.97M | 100 / 379 / 757 ms | 75.5% | 12.1초 |
| webflux-netty | 7.57M | **1,174** / 2,091 / 3,319 ms | 88.4% | **108.5초** |

작은 응답에서는 WebFlux가 근소하게 낫습니다. 응답이 1.6KB로 커지자 WebFlux는 힙 사용률 99%에 GC 108초, P50이 1.17초로 무너지고 가상 스레드가 31% 더 처리합니다. **리액티브가 메모리에 유리하다는 통념이 여기서 깨집니다.** 조건을 빼고 "리액티브가 가볍다"고 말할 수는 없다는 뜻입니다. 리액티브가 나쁘다는 말은 아닙니다.

### JEP 491 — 그리고 네이티브에서는 확인되지 않는 것

가상 스레드를 진지하게 쓸 거면 JDK 버전이 별도 축입니다. JDK 21에서는 `synchronized` 블록 안에서 블록되면 가상 스레드가 캐리어를 붙잡고 놓지 않습니다. JEP 491이 지적하듯 "frequent pinning for long durations can harm scalability and can lead to starvation or even deadlock." JDK 24의 JEP 491이 모니터 소유권을 캐리어에서 가상 스레드 자신에게 옮겨 이 문제를 없앴습니다. "라이브러리의 `synchronized`를 `ReentrantLock`으로 바꿔라"라던 초창기 조언이 그래서 필요 없어졌습니다. JDK 25가 그 상태의 LTS입니다.

여기가 이 문서에서 확인하지 못한 대목입니다. **SubstrateVM이 JEP 491에 해당하는 모니터 변경을 반영했는지 명시한 1차 문서를 찾지 못했습니다.** GraalVM 25.3 릴리스 노트에 `synchronized`의 인라인 실행 경로와 스핀 최적화 항목이 있어 모니터 구현을 독자적으로 손대고 있다는 정황은 있지만 그걸로 "네이티브에서도 pinning이 없다"고 단정할 수는 없습니다. 네이티브 + 가상 스레드를 함께 쓸 계획이라면 `-Djdk.tracePinnedThreads`나 JFR `jdk.VirtualThreadPinned` 이벤트로 직접 확인하는 게 맞습니다.

### Netty를 네이티브에 넣을 때

리액티브 스택을 네이티브로 옮기면 눈에 잘 안 띄는 회귀가 하나 있습니다. **epoll 네이티브 트랜스포트가 이미지 안에서 비활성화되는 사례**입니다. JVM에서는 `Epoll.isAvailable()`이 true인데 네이티브 실행 파일에서는 false가 되고 NIO 폴백으로 떨어집니다. 에러가 안 나니 성능 특성만 슬그머니 달라집니다. 리플렉션 힌트 누락은 `io.netty` 로그 레벨을 TRACE로 낮춰야 보이기도 합니다.

## 6. 바꿀 때 실제로 치르는 값

### closed world와 메타데이터

"all classes must be known at build time." 이 한 줄이 나머지를 전부 만듭니다. 리플렉션, JNI, 동적 프록시, 클래스패스 리소스, 직렬화는 전부 메타데이터로 미리 알려줘야 합니다. JDK 23부터 `reachability-metadata.json` 한 파일로 통합됐고 기존 `reflect-config.json` 등은 deprecated이되 여전히 인식됩니다.

Tracing Agent가 이걸 자동으로 모아줍니다. **HotSpot에서 앱을 돌리며** 동적 기능 사용을 관찰해 JSON을 뱉는 구조입니다. 개발·테스트는 JVM에서 하고 배포 직전에만 네이티브로 바꾸는 흐름을 전제로 설계됐습니다.

문제는 **실행된 경로만 기록한다**는 것입니다. 문서 자신이 정적 분석으로는 리플렉션·JNI·동적 프록시·리소스 사용을 완전히 예측할 수 없다고 인정합니다. 리플렉션 대상 이름이 설정 파일에서 오거나 런타임에 문자열로 조립되는 흔한 패턴이 특히 취약합니다.

실무에서 이게 만드는 실패 양상이 가장 고약합니다. **빌드가 성공하고, JVM 테스트가 통과하고, 프로덕션에서 특정 코드 경로에 처음 진입할 때 죽습니다.** 에이전트 실행 시나리오가 커버하지 못한 경로가 그대로 지뢰가 됩니다. 네이티브 안정성의 상한은 테스트 커버리지의 상한입니다.

### 프로파일이 환경을 고정한다

Spring Boot AOT는 BeanFactory를 빌드 타임에 완성합니다. 그래서 **`@Conditional`도 빌드 타임에 평가됩니다.** 문서가 프로파일 사용을 피하라고 권하고 계속 쓸 거면 `application.properties`의 `spring.profiles.active`처럼 빌드 타임에 켜라고 합니다. `@ConditionalOnProperty`처럼 속성에 따라 빈 생성이 달라지는 패턴은 지원되지 않습니다. 이유도 문서에 적혀 있습니다 — "doing so would undo most of the benefit of static analysis."

배포 파이프라인 관점에서 이건 꽤 큰 이야기입니다. dev/stage/prod를 프로파일로 나누고 이미지 태그 하나로 세 환경을 도는 구성은 네이티브에서 성립하지 않습니다. 환경마다 별도 바이너리를 빌드해야 합니다. GitOps로 같은 이미지를 승격시키는 흐름과 정면으로 부딪칩니다.

빌드 시간도 자릿수가 다릅니다. 공식 최소 사양 가이드는 없고 GraalVM 팀 답변은 "프로젝트 크기에 크게 달렸다, 작고 중간 규모면 2GB RAM으로도 된다" 정도입니다. 실제 Spring Boot 앱 보고는 제각각이라 인용할 만한 대표값이 없습니다. 공통된 건 방향 하나 — **JVM 빌드가 초 단위일 때 네이티브 빌드는 분 단위입니다.** 레이어드 네이티브 이미지로 의존성을 베이스 레이어에 굳히는 완화책이 있지만 25.3 릴리스 노트가 "Layers created before this change might not be compatible with layers created afterward"라고 적을 만큼 아직 포맷이 움직이는 중입니다.

### 관측성은 잃는 게 아니라 갈아타는 것

**SubstrateVM에는 JVMTI가 없습니다.** 그래서 Java 에이전트, async-profiler를 포함한 JVMTI 기반 프로파일러, 기존 Java 디버거, `jps`·`jstack`·`jmap`이 동작하지 않습니다.

대신 빌드 타임에 `--enable-monitoring=`으로 켜는 기능이 있습니다. `heapdump`, `jfr`, `jvmstat`, `jmxserver`, `jmxclient`, `nmt`, `threaddump`. 켜면 실행 파일이 커집니다. JFR은 50개 이상 이벤트를 지원하지만 한계가 문서에 명시돼 있습니다.

| 되는 것 | 안 되는 것 |
|---|---|
| JFR 기록, 힙 덤프, NMT, `jcmd`, JDWP 디버깅 | 스트리밍 이벤트의 스택트레이스 |
| Linux `perf` (`-g -H:-DeleteLocalSymbols -H:+PreserveFramePointer` 필요) | 바이트코드 계측 기반 이벤트 (파일 I/O, 예외) |
| eBPF/bcc | old object tracking의 GC 루트 경로 — 누수 프로파일링이 반쪽 |

관측 자체가 막히지는 않습니다. 도구 체인을 통째로 갈아타야 할 뿐입니다. 문제는 async-profiler, JMC, APM 에이전트에 조직이 쌓아둔 투자가 대부분 버려진다는 겁니다. 전환 비용에서 가장 자주 과소평가되는 항목입니다.

{{< callout type="warning" >}}
빌드 타임 초기화가 상태를 이미지에 굳힙니다. 정적 초기화자가 빌드 때 실행되므로 "any static variables initialized inline, or initialized in a static block, will keep the same value even if the application is restarted." 보안 쪽이 특히 위험합니다 — Quarkus 가이드가 인용하는 실제 경고문이 `Detected an instance of Random/SplittableRandom class in the image heap. Instances created during image generation have cached seed values.` 입니다. 빌드 타임에 시드가 굳은 난수 생성기가 모든 배포 인스턴스에 복제됩니다.
{{< /callout >}}

## 7. 시동이 문제라면 — 런타임을 안 바꾸는 답

여기까지 읽고 나면 "시동 때문에 이걸 다 치러야 하나" 싶어집니다. 그 물음에 답이 생긴 게 2025~2026년 이 주제의 실질적 변화입니다.

**JEP 483 (JDK 24) — AOT 캐시.** 훈련 실행을 한 번 돌려 로드·링크가 끝난 클래스를 캐시에 담고 이후 실행에서 그걸 그대로 씁니다.

| | JDK 23 | AOT 캐시 | 캐시 크기 |
|---|---|---|---|
| Stream API 예제 (900 클래스) | 0.031초 | 0.018초 (**42%↓**) | 11.4 MB |
| Spring PetClinic 3.2.0 (21,000 클래스) | 4.486초 | 2.604초 (**42%↓**) | 130 MB |

**JEP 515 (JDK 25) — 메서드 프로파일까지.** 훈련 실행에서 모은 프로파일을 캐시에 함께 담습니다. JVM이 시작하자마자 "무엇이 뜨거운지"를 알고 있으니 JIT이 처음부터 뜨거운 메서드를 겨냥해 돕니다. JEP는 이 대목을 강조합니다 — "Profiles cached during training runs do not prevent additional profiling during production runs." 훈련이 프로덕션과 어긋나도 런타임 프로파일링이 그대로 살아 있어 스스로 교정합니다.

Native Image의 PGO와 구조가 닮았는데 결정적으로 다릅니다. PGO에서 프로파일이 틀리면 **틀린 채로 굳습니다.** AOT 캐시에서 프로파일이 틀리면 그냥 워밍업이 조금 덜 빨라질 뿐입니다.

**JEP 514 (JDK 25)**는 이걸 한 단계로 줄입니다. `-XX:AOTCacheOutput=app.aot`만 주면 훈련과 캐시 생성이 한 번의 호출로 끝납니다. 컨테이너에서는 주의할 게 있습니다 — 캐시 생성 하위 호출이 훈련과 같은 크기의 힙을 따로 잡아서 **`-Xmx4g`라면 워크플로 전체에 8GB가 필요합니다.** 좁은 파드에서는 두 단계로 나누는 편이 안전합니다.

CRaC도 같은 문제를 겨냥한 선택지입니다. CRIU로 워밍업이 끝난 JVM 프로세스를 스냅샷 떠서 복원하는 방식이라 JIT이 그대로 살아 있습니다. Linux 전용이고 Micronaut·Quarkus가 먼저, Spring이 2023년 11월에 지원을 붙였습니다.

## 8. 그래서 무엇을 고르나

| 상황 | 답 |
|---|---|
| 시동만 아프고 나머지는 괜찮다 | **AOT 캐시.** 런타임을 안 바꾸고 42%를 가져간다. 코드 변경 없음 |
| 시동이 아프고 JDK를 못 올린다 | CRaC. 또는 워밍업 구간에 트래픽을 안 주는 readiness 설계 |
| 프로세스가 초 단위로 살고 죽는다 (서버리스, CLI, 배치 팬아웃) | **Native Image.** 워밍업할 시간 자체가 없는 워크로드 |
| 파드 밀도가 비용을 지배하고 힙이 수백 MB다 | Native Image. Serial GC가 안 아픈 구간 |
| 힙이 GB 단위고 파드가 며칠씩 산다 | **JVM.** CE 네이티브의 Serial GC가 정확히 여기서 아프다 |
| 리플렉션·동적 프록시가 많다 (복잡한 JPA, AspectJ) | JVM. 메타데이터 관리 비용이 이득을 넘는다 |
| 런타임에 코드가 발견된다 (플러그인, 동적 클래스 로딩) | JVM. 네이티브는 애초에 성립 안 함 |
| 환경별 설정을 프로파일로 가른다 | JVM. 아니면 환경마다 바이너리를 따로 빌드할 각오 |
| 피크 처리량이 목표다 | JVM. 네이티브가 이기려면 PGO(유료) + G1(유료)이 필요하다 |

가상 스레드 축은 이 표와 직교합니다.

| | 권장 |
|---|---|
| 6만 연결급을 노린다 | acceptor부터 본다. Tomcat 스레드풀은 CPU가 남아도 2만에서 연결을 못 받는다 |
| 응답이 크다 (KB 단위 JSON) | 가상 스레드. 실측에서 WebFlux가 GC로 무너진 구간 |
| 응답이 작고 연결이 많다 | 둘 다 된다. 팀이 이미 쓰는 쪽 |
| `synchronized`를 쓰는 라이브러리가 많다 | JDK 25. 21에 남으면 pinning을 계속 안고 간다 |
| 네이티브 + 가상 스레드를 같이 쓴다 | 먼저 pinning을 실측한다. 1차 문서로 보장되지 않는다 |

## 이 문서에서 가져갈 것

- 런타임 교체는 일을 없애지 않습니다. **빌드 타임, 훈련 실행, 첫 요청, 정상 운영 중 어디로 옮길지를 고르는 일입니다.** 옮긴 쪽에는 반드시 새 비용이 붙습니다 — 빌드 시간, 프로파일 파이프라인, 도구 체인 교체.
- "GraalVM이 빠르다"는 문장은 **PGO와 G1을 켠 유료 배포판**을 전제합니다. CE에서 그대로 재현되지 않습니다.
- CE 네이티브의 실질적 상한은 **Serial GC**가 정합니다. 힙이 작을수록 유리하고 클수록 불리하며 이 축은 CPU를 더 줘도 안 움직입니다.
- 컨테이너에서 네이티브를 돌린다면 **`-Xmx`(또는 `-XX:MaximumHeapSizePercent`) 명시가 사실상 필수**입니다. 기본 80% + GC 중 일시 확대가 겹치면 limit을 넘습니다.
- 동시성 실험을 하기 전에 **연결을 받아들이는 층을 먼저 봅니다.** CPU 20%에서 99% 실패하는 그림은 실행 모델로 못 고칩니다.
- 시동이 유일한 문제라면 **AOT 캐시를 먼저 시도합니다.** 코드도 런타임도 그대로 두고 42%를 가져가며 프로파일이 틀려도 스스로 교정합니다.

## 참고 자료

**Oracle 발표와 방향 전환**
- [Detaching GraalVM from the Java Ecosystem Train](https://blogs.oracle.com/java/post/detaching-graalvm-from-the-java-ecosystem-train) — Oracle, 2025-09-15. 본문 인용문의 출처. Oracle 도메인이 자동화 요청을 차단해 이 문서에서는 인용문을 [micronaut-core Discussion #12073](https://github.com/micronaut-projects/micronaut-core/discussions/12073)에 전재된 형태로 확인했습니다. 같은 내용을 [ADTmag](https://adtmag.com/articles/2025/09/30/oracle-shifts-graalvm-focus-away-from-java.aspx)와 [InfoWorld](https://www.infoworld.com/article/4061937/graalvm-25-arrives-backed-by-jdk-25.html)가 보도했습니다.
- [micronaut-core Discussion #12073](https://github.com/micronaut-projects/micronaut-core/discussions/12073) — "It is not deprecated or discontinued as a technology"

**Project Leyden**
- [JEP 483: Ahead-of-Time Class Loading & Linking](https://openjdk.org/jeps/483) — PetClinic 4.486초 → 2.604초, 캐시 130MB
- [JEP 515: Ahead-of-Time Method Profiling](https://openjdk.org/jeps/515) · [JEP 514: Ahead-of-Time Command-Line Ergonomics](https://openjdk.org/jeps/514)
- [Project CRaC](https://openjdk.org/projects/crac/) · [Spring Boot checkpoint/restore](https://docs.spring.io/spring-boot/reference/packaging/checkpoint-restore.html)

**GraalVM 공식 문서**
- [PGO](https://www.graalvm.org/latest/reference-manual/native-image/optimizations-and-performance/PGO/) — "PGO is not available in GraalVM Community Edition"
- [Memory Management](https://www.graalvm.org/latest/reference-manual/native-image/optimizations-and-performance/MemoryManagement/) — GC 종류, 기본 힙 80%/25%, GC 중 RSS 2배 경고
- [Reachability Metadata](https://www.graalvm.org/latest/reference-manual/native-image/metadata/) · [Tracing Agent](https://www.graalvm.org/latest/reference-manual/native-image/metadata/AutomaticMetadataCollection/)
- [Debugging and Diagnostics](https://www.graalvm.org/latest/reference-manual/native-image/debugging-and-diagnostics/) · [JFR](https://www.graalvm.org/latest/reference-manual/native-image/debugging-and-diagnostics/JFR/) · [perf](https://www.graalvm.org/latest/reference-manual/native-image/debugging-and-diagnostics/perf-profiler/)
- 릴리스 노트 [JDK 23](https://www.graalvm.org/release-notes/JDK_23/) · [JDK 25](https://www.graalvm.org/release-notes/JDK_25/) · [25.1](https://www.graalvm.org/release-notes/25.1/) · [25.2](https://www.graalvm.org/release-notes/25.2/) · [25.3](https://www.graalvm.org/release-notes/25.3/)

**이슈와 실측**
- [oracle/graal #10499](https://github.com/oracle/graal/issues/10499) — Serial GC full GC 반복과 freeze · [#3992](https://github.com/oracle/graal/issues/3992) — 컨테이너 미탐지 · [#4757](https://github.com/oracle/graal/issues/4757) — `UseContainerSupport` 우회 · [#7520](https://github.com/oracle/graal/issues/7520) — Truffle과 가상 스레드
- [netty #11088](https://github.com/netty/netty/issues/11088) — 네이티브 이미지에서 epoll 비활성화
- [chrisgleissner/loom-webflux-benchmarks](https://github.com/chrisgleissner/loom-webflux-benchmarks) — §5의 모든 수치
- [Quarkus runtime performance](https://quarkus.io/blog/runtime-performance/) — JVM이 JDK 8인 점 유의 · [Quarkus native reference](https://quarkus.io/guides/native-reference/)

**JVM 쪽**
- [JEP 491: Synchronize Virtual Threads without Pinning](https://openjdk.org/jeps/491)
- [Kubernetes CPU limits: when the JVM sees more than it should](https://mikemybytes.com/2026/03/12/kubernetes-cpu-limits-when-jvm-sees-more-than-it-should/) — 컴파일러 스레드·GC 스레드·ForkJoinPool 공식
- [How we solved a HotSpot performance puzzle](https://developers.redhat.com/articles/2023/09/29/how-we-solved-hotspot-performance-puzzle) — 워밍업이 분 단위인 사례
