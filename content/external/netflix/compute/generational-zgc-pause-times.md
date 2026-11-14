---
title: "Netflix의 JVM 기본값이 된 Generational ZGC"
description: "Netflix는 왜 JDK 21 이상에서 Generational ZGC를 기본값으로 골랐을까요? GC 멈춤을 줄이면서 예상했던 CPU 효율 저하도 피했지만, 워크로드에 따른 예외는 남았습니다."
date: 2026-11-14
weight: 7
---

# Netflix의 JVM 기본값이 된 Generational ZGC (2024-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Bending pause times to your will with Generational ZGC](https://netflixtechblog.com/bending-pause-times-to-your-will-with-generational-zgc-256629c9386b)
- 매체 · 게시일: Netflix TechBlog · 2024-03-06
- 저자: Danny Thomas (JVM Ecosystem Team)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 처리량 손해를 각오했던 기본값 전환 {#background}

Netflix는 JDK 21 이상에서 기본 GC를 G1에서 Generational ZGC로 바꿨습니다. JDK 21 LTS에 추가된 Z Garbage Collector의 세대 지원이 계기였습니다. 글을 쓴 시점에는 스트리밍 영상에 필수인 핵심 서비스 중 절반이 넘는 수가 JDK 21과 Generational ZGC를 사용하고 있었습니다.

처음부터 비용 없는 전환을 기대한 것은 아닙니다. 평가 결과는 고무적이었지만, 팀은 load·store barrier와 thread-local handshake, 애플리케이션과 수집기 사이의 자원 경쟁 때문에 처리량이 떨어지리라 예상했습니다. 멈춤을 줄이는 이득을 생각하면 감수할 만한 비용이었습니다.

실제 서비스의 결과는 달랐습니다. 같은 CPU 사용률 목표에서 ZGC는 평균과 P99 지연을 모두 줄였고, CPU 사용률도 G1과 같거나 더 낮았습니다. 예상했던 처리량 손해가 없었던 것입니다. 요청률·요청 패턴·응답 시간·할당률이 일정한 점이 도움이 됐지만, ZGC가 잘 처리한 대상이 규칙적인 워크로드에만 한정되지는 않았습니다.

## G1의 허를 찌르던 오래 사는 힙 데이터 {#efficiency-operations}

운영에서 자주 부딪히던 문제는 긴 멈춤이었습니다. 서비스 담당자들은 멈춤이 왜 길어지는지, 무엇을 튜닝해야 하는지 자주 물었습니다. 여러 프레임워크는 외부 호출을 피하려고 큰 데이터를 힙에 보관했다가 주기적으로 갱신하는데, 이 갱신이 G1의 허를 찔렀습니다. 멈춤 시간이 목표를 훌쩍 넘기도 했습니다.

그렇다고 세대 없는 ZGC로 옮기기도 어려웠습니다. 오래 사는 힙 데이터가 도입을 막은 주된 이유였습니다. 평가한 최악의 사례에서는 같은 일을 처리하는 데 G1보다 CPU를 36% 더 썼습니다. Generational ZGC는 같은 워크로드에서 G1보다 CPU 사용을 10% 가까이 개선했습니다. 세대 지원이 들어오면서 이전 평가와는 다른 선택이 가능해졌습니다.

스트리밍 영상에 필요한 서비스의 절반은 Hollow 라이브러리로 메타데이터를 힙에 보관합니다. 멈춤을 걱정하지 않게 되자 이를 줄이려고 유지하던 배열 풀링도 제거했고, 수백 MB의 메모리를 새 할당에 쓸 수 있게 됐습니다.

별도의 명시적 튜닝도 필요 없었습니다. ZGC의 휴리스틱과 기본값으로 운영했습니다. 할당 정지(allocation stall)는 드물었으며, 대체로 할당률이 비정상적으로 치솟는 때와 겹쳤습니다. 지속 시간도 G1의 평균 멈춤보다 짧았습니다.

## 취소와 재시도로 이어지던 gRPC 멈춤 {#tail-latency}

gRPC와 DGS Framework 서비스에서 GC 멈춤은 꼬리 지연의 큰 원인이었습니다. gRPC에서는 여파가 요청 하나로 끝나지 않았습니다. 클라이언트나 서버에서 타임아웃으로 요청을 취소하면 재시도, hedging, fallback이 맞물려 또 다른 요청을 만들었습니다. 멈춤을 줄이면 취소 뒤에 생기는 추가 요청도 줄어 전체 트래픽이 감소합니다.

Netflix는 11월 16일 ZGC를 켠 클러스터의 초당 취소 오류율을 직전 주와 비교해 이 변화를 보여 줍니다. 최대 멈춤 시간을 원인별로 나눈 그래프에서 ZGC의 멈춤은 대체로 1밀리초 미만이었습니다.

짧아진 멈춤은 지연을 조사하는 일도 바꿨습니다. 그전에는 최대 멈춤 시간의 이상치가 다른 원인을 가리고 있었습니다. GC 멈춤이라는 잡음이 사라지자, 종단 간 지연을 실제로 일으키는 원인이 보이기 시작했습니다.

## 압축 참조를 포기한 ZGC의 메모리 사용량 {#memory-overhead}

메모리에서도 예상과 다른 결과가 나왔습니다. 팀이 처음 걱정한 것은 32G 미만 힙에서 사용하는 압축 참조인 compressed references를 잃는 비용이었습니다. ZGC의 colored pointer에는 64비트 객체 포인터가 필요합니다. stop-the-world 수집기라면 이 차이가 큰 고려 사항이지만, ZGC에서는 작은 힙에서도 늘어난 할당률을 효율과 운영상의 이득으로 상쇄했습니다.

평가 범위를 넓힌 계기는 Oracle의 Erik Österlund가 설명한 colored pointer의 이점이었습니다. 동시 수집기에서는 직관만으로 짐작하기 어려운 이득이 있었습니다. 실제로 대부분의 경우 ZGC는 애플리케이션에 더 많은 메모리를 남겼습니다. 같은 클러스터에서 GC 주기가 끝난 뒤 사용 중인 힙과 사용 가능한 힙을 비교한 그래프에서도 이를 확인했습니다.

네이티브 메모리 비용까지 사라진 것은 아닙니다. ZGC는 힙 크기의 3%를 고정 오버헤드로 사용하므로 G1보다 네이티브 메모리가 더 필요합니다. 그래도 여유 공간을 확보하려고 최대 힙을 낮춘 사례는 네이티브 메모리 요구량이 평균보다 큰 서비스 두어 곳뿐이었습니다.

참조를 처리하는 시점도 달라집니다. ZGC는 reference processing을 major collection에서만 수행합니다. 팀은 direct byte buffer 해제에 영향이 생기는지 지켜봤지만, 글을 쓴 시점까지 문제는 없었습니다. 이 차이로 JSON 스레드 덤프가 느려진 사례는 있었습니다. 원인은 프레임워크가 요청마다 사용하지도 않는 ExecutorService를 실수로 생성하던 데 있었습니다.

## shmem_enabled에 막혀 있던 huge page {#transparent-huge-pages}

Huge page는 ZGC를 쓰지 않아도 활용할 만하며, 가장 간편한 방법은 transparent huge pages입니다. 그런데 JVM 옵션만 켜고 끝내면 적용되지 않을 수 있습니다. ZGC는 힙에 shared memory를 쓰는데, 많은 Linux 배포판이 `shmem_enabled`를 `never`로 설정하기 때문입니다. 이 상태에서는 `-XX:+UseTransparentHugePages`를 지정해도 ZGC가 huge page를 조용히 쓰지 못합니다.

한 서비스에서는 다른 변경 없이 `shmem_enabled`만 `never`에서 `advise`로 바꿨습니다. 4k 페이지에서 2m 페이지로 전환하자 CPU 사용률이 눈에 띄게 낮아졌습니다. 그래프 중간의 공백은 불변(immutable) 배포 과정에서 클러스터 용량이 잠시 두 배가 된 데서 생겼습니다.

Netflix는 기본 구성에서 힙 최솟값과 최댓값을 같게 두고, `-XX:+UseTransparentHugePages`와 `-XX:+AlwaysPreTouch`를 켭니다. 함께 사용하는 커널 설정은 아래 표에 있습니다.

{{% details title="Netflix의 기본 구성과 주요 측정값" closed="true" %}}

| 항목 | 값 |
|---|---|
| 힙 최솟값·최댓값 | 같은 크기로 설정 |
| JVM 옵션 | `-XX:+UseTransparentHugePages`, `-XX:+AlwaysPreTouch` |
| transparent_hugepage/enabled | madvise |
| transparent_hugepage/shmem_enabled | advise |
| transparent_hugepage/defrag | defer |
| transparent_hugepage/khugepaged/defrag | 1 |
| ZGC 고정 오버헤드 | 힙 크기의 3% |
| 세대 없는 ZGC의 최악 평가 결과 | G1보다 CPU 36% 더 사용 |
| Generational ZGC의 같은 워크로드 | 10% 가까운 개선 |
| 대규모 사전 계산 워크로드 | G1 대비 처리량 6~8% 향상, 배치 시간 1시간 단축 |

{{% /details %}}

## G1과 parallel collector가 더 잘 맞던 작업 {#poor-fit}

기본값을 바꿨다고 모든 작업에 ZGC가 가장 잘 맞지는 않았습니다. GC마다 수집 처리량, 애플리케이션 지연, 자원 사용 사이에서 선택하는 균형이 다릅니다. G1이 더 나았던 워크로드는 대체로 처리량을 중시하고 할당률이 크게 출렁였으며, 오래 실행되는 작업이 객체를 얼마 동안 붙들고 있을지 예측하기 어려웠습니다.

그중 한 사례는 할당률이 급격히 치솟고 오래 사는 객체도 많았습니다. 이 조건에서는 G1의 멈춤 시간 목표와 old region 수집 휴리스틱이 잘 맞았습니다. G1은 성과가 적은 수집 작업을 건너뛸 수 있었지만 ZGC는 그 작업을 피하지 못했습니다.

기본값 변경은 기존의 G1 선택을 다시 들여다보는 계기도 됐습니다. 몇몇 배치·사전 계산 작업에는 parallel collector가 더 적합했습니다. 규모가 큰 사전 계산 워크로드 하나에서는 G1 대비 처리량이 6~8% 높아져 배치 시간이 한 시간 줄었습니다.

Netflix 팀은 당연하게 받아들였던 가정을 검증하지 않았다면, 지난 10년간 가장 영향이 컸던 기본값 변경 중 하나를 놓쳤을 것이라고 돌아봅니다. Generational ZGC를 직접 시험해 보라는 권유도 이 경험에서 나왔습니다. 예상했던 비용과 실제 서비스에서 치른 비용이 달랐기 때문입니다.
