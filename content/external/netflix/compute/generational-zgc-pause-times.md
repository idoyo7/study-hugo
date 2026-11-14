---
title: "Generational ZGC로 바꾼 JVM 기본 가비지 컬렉터"
description: "Netflix가 JDK 21 이상에서 기본 GC를 G1에서 Generational ZGC로 바꾼 경험을 정리했습니다. 꼬리 지연, 효율, 메모리, huge page 설정과 맞지 않았던 워크로드를 다룹니다."
date: 2026-11-14
weight: 7
---

# Generational ZGC로 바꾼 JVM 기본 가비지 컬렉터 (2024-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Bending pause times to your will with Generational ZGC](https://netflixtechblog.com/bending-pause-times-to-your-will-with-generational-zgc-256629c9386b)
- 매체 · 게시일: Netflix TechBlog · 2024-03-06
- 저자: Danny Thomas (JVM Ecosystem Team)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 기본값 전환의 배경 {#background}

JDK 21 LTS에 Z Garbage Collector의 세대(generational) 지원이 들어왔습니다. Netflix는 JDK 21 이상에서 기본 GC를 G1에서 Generational ZGC로 바꿨습니다. 동시(concurrent) 수집의 이점이 크다고 보았기 때문입니다. 스트리밍 영상에 필수인 핵심 서비스 가운데 절반이 넘는 수가 이미 JDK 21과 Generational ZGC로 돌고 있습니다.

## 꼬리 지연 감소 {#tail-latency}

gRPC와 DGS Framework 서비스에서는 GC 멈춤이 꼬리 지연의 큰 원인이었습니다. 특히 gRPC 클라이언트와 서버에서는 타임아웃으로 요청이 취소되면 재시도, hedging, fallback 같은 신뢰성 기능이 맞물려 또 다른 요청을 만듭니다. 취소된 요청 하나가 재시도 하나로 이어지는 셈이라, 멈춤이 줄면 전체 트래픽도 같은 비율로 줄어듭니다. 원문은 11월 16일에 ZGC를 켠 클러스터의 취소 오류율을 직전 주와 겹쳐 보여 줍니다.

멈춤이라는 잡음이 사라지자 그동안 최대 멈춤 시간 이상치에 가려 있던 종단 간 지연의 실제 원인도 보이기 시작했습니다. 같은 클러스터의 최대 멈춤 시간 그래프에서 ZGC 멈춤은 대체로 1밀리초 미만이었습니다.

## 효율과 운영 단순성 {#efficiency-operations}

팀은 처음에 ZGC의 load·store barrier, thread-local handshake, 애플리케이션과의 자원 경쟁 때문에 처리량이 조금 떨어지리라 예상했고, 멈춤이 없어지는 이득이 더 크니 감수할 만하다고 생각했습니다. 실제로는 이 서비스들에서 그런 맞교환이 없었습니다. 같은 CPU 사용률 목표에서 ZGC는 평균과 P99 지연을 모두 개선했고 CPU 사용률은 G1과 같거나 나았습니다. 요청률·요청 패턴·응답 시간·할당률이 일정한 서비스가 많은 점이 도움이 됐지만, 덜 일정한 워크로드도 잘 처리했다고 합니다.

서비스 담당자들은 과도한 멈춤과 튜닝 문의를 자주 보냈습니다. 여러 프레임워크가 외부 호출을 피하려고 힙 위의 큰 데이터를 주기적으로 새로 고치는데, 이 갱신이 G1의 허를 찔러 기본 멈춤 목표를 훌쩍 넘는 이상치를 만들었습니다. 이 오래 사는 힙 데이터가 세대 없는 ZGC를 도입하지 못한 주된 이유였습니다. 평가한 최악의 경우 세대 없는 ZGC는 G1보다 CPU를 36% 더 썼는데, Generational ZGC에서는 같은 워크로드가 10% 가까운 개선으로 바뀌었습니다.

스트리밍 영상에 필요한 서비스의 절반은 힙 위 메타데이터에 Hollow 라이브러리를 씁니다. 멈춤 걱정이 사라지면서 배열 풀링 우회책을 걷어냈고, 수백 MB를 할당에 돌려줄 수 있었습니다. 튜닝은 필요 없었습니다. 할당 정지(allocation stall)는 드물고, 할당률이 비정상적으로 치솟을 때 나타났으며, G1의 평균 멈춤보다 짧았습니다.

## 메모리 오버헤드 {#memory-overhead}

힙이 32G 미만일 때 쓰는 compressed references를 잃는 것이 GC 선택의 큰 변수가 되리라 예상했습니다. ZGC의 colored pointer는 64비트 객체 포인터가 필요하기 때문입니다. 그런데 이는 stop-the-world 수집기에서는 중요한 고려 사항이어도 ZGC에서는 아니었습니다. 작은 힙에서도 늘어난 할당률은 효율과 운영 개선으로 상쇄됐습니다. 원문은 Oracle의 Erik Österlund가 colored pointer가 동시 수집기에 주는 직관과 다른 이점을 설명해 준 덕에 ZGC를 계획보다 넓게 평가하게 됐다고 감사를 전합니다.

대부분의 경우 ZGC는 애플리케이션이 쓸 수 있는 메모리를 오히려 더 안정적으로 확보했습니다. ZGC는 힙 크기의 3%를 고정 오버헤드로 쓰므로 G1보다 네이티브 메모리가 더 필요합니다. 그래도 여유를 위해 최대 힙을 낮춘 사례는 네이티브 메모리를 평균보다 많이 쓰는 서비스 두어 곳뿐이었습니다.

ZGC는 reference processing을 major collection에서만 합니다. direct byte buffer 해제를 눈여겨봤지만 영향은 아직 없었습니다. 다만 JSON 스레드 덤프 기능에서는 이 차이 때문에 성능 문제가 있었는데, 프레임워크가 요청마다 쓰지도 않는 ExecutorService를 실수로 만들던 특이한 경우였습니다.

## Transparent huge pages {#transparent-huge-pages}

ZGC를 쓰지 않더라도 huge page는 쓰는 편이 좋고, 가장 편한 방법이 transparent huge pages입니다. ZGC는 힙에 shared memory를 쓰는데, 많은 Linux 배포판이 shmem_enabled를 never로 둬서 `-XX:+UseTransparentHugePages`를 줘도 huge page가 조용히 쓰이지 않습니다. 원문은 shmem_enabled를 never에서 advise로 바꾼 것 외에 다른 변경이 없는 서비스에서 CPU 사용률이 눈에 띄게 줄어든 그래프를 보여 줍니다. 4k 페이지에서 2m 페이지로 옮긴 배포였고, 그래프의 공백은 불변(immutable) 배포 과정이 클러스터 용량을 잠시 두 배로 늘려서 생긴 것입니다.

기본 구성은 힙 최솟값과 최댓값을 같게 두고, `-XX:+UseTransparentHugePages`와 `-XX:+AlwaysPreTouch`를 켜며, transparent_hugepage 커널 설정을 아래 표처럼 맞추는 것입니다.

## 맞지 않았던 워크로드 {#poor-fit}

원문은 최고의 GC는 없다고 못 박습니다. 수집 처리량, 애플리케이션 지연, 자원 사용 사이의 균형이 GC마다 다르기 때문입니다. G1이 더 나았던 워크로드는 대체로 처리량 중심이고, 할당률이 매우 들쭉날쭉하며, 오래 도는 작업이 객체를 예측하기 어려운 기간 동안 붙들고 있는 쪽이었습니다. 대표 사례는 할당률이 크게 튀고 오래 사는 객체가 많은 서비스입니다. G1의 멈춤 시간 목표와 old region 수집 휴리스틱이 잘 맞아서, ZGC로는 피하지 못하는 쓸모없는 수집 작업을 G1이 건너뛸 수 있었습니다.

기본값을 ZGC로 바꾸자 애플리케이션 담당자들이 GC 선택을 다시 생각하는 계기도 됐습니다. 기본으로 G1을 쓰던 몇몇 배치·사전 계산 작업은 parallel collector가 더 맞았습니다. 규모가 큰 사전 계산 워크로드 하나는 G1 대비 처리량이 6~8% 좋아져 배치 시간이 한 시간 줄었습니다.

## 맺음 {#closing}

원문은 가정과 기대를 따져 보지 않았다면 지난 10년간 운영 기본값에서 가장 영향이 큰 변경 하나를 놓쳤을 것이라고 돌아봅니다. 독자에게도 Generational ZGC를 직접 써 보라고 권합니다.

{{% details title="원문의 기본 구성과 주요 수치" closed="true" %}}

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
