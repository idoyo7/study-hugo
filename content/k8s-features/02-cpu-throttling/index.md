---
title: "CPU Throttling"
weight: 2
---

# 02 · CPU Throttling — limit을 다 쓰지도 않았는데 잘린다

{{< callout type="info" >}}
**한눈에**
- CFS는 CPU limit을 **100ms period로 쪼개서** 준다. period는 서로 독립이고 안 쓴 quota는 이월되지 않는다. 그래서 **"평균 사용률 34% + throttle 31%"** 가 모순 없이 성립한다 — 총량이 남는데 타이밍이 잘리는 것이다.
- **사용률 그래프에는 이 상태가 안 보인다.** 대시보드는 내내 여유로운데 꼬리 지연만 길어진다. `container_cpu_cfs_throttled_periods_total / …periods_total`을 같이 봐야 처음 보인다.
- 잘린 시간은 **CPU wait으로 스레드에 그대로 쌓이고**, APM에는 "아무것도 안 하는 구간"으로 찍힌다. 컨테이너 전체가 동시에 멈추므로 **꼬리(P99)가 평균보다 훨씬 크게 망가진다.**
- **코어가 많을수록 더 잘린다.** quota는 병렬도에 비례해 마르기 때문이다 — 같은 1코어 limit이라도 4코어에서 도는 컨테이너는 period의 ¾을 멈춰 있는다. 직관과 반대다.
- 대응은 셋 중 하나다: **limit 제거**(가장 효과적이지만 이웃을 노출), **CPU Manager static**(throttle을 구조적으로 없애지만 조건이 빡빡), **[CPU Burst]({{< relref "03-cpu-burst.md" >}})**(타이밍만 푸는 정답에 가깝지만 k8s 표면이 없다).
{{< /callout >}}

> **왜 이 문서가 따로 있나.** "CPU를 더 주면 빨라진다"는 직관은 limit이 걸린 컨테이너에서 자주 틀린다. 총량이 모자란 게 아니라 **쓸 수 있는 타이밍이 잘린** 상태가 있고, 이 상태는 **CPU 사용률 그래프에 나타나지 않아서** 몇 시간씩 엉뚱한 곳을 파게 만든다. 이 문서는 그 상태가 어떻게 만들어지고, 어떤 지표를 겹쳐 봐야 보이고, 대응 선택지가 각각 무엇을 대가로 치르는지를 정리한다.

> 자매 문서: [챕터 개요]({{< relref "_index.md" >}}) · 이 문제를 커널에서 푸는 [03 CPU Burst]({{< relref "03-cpu-burst.md" >}}) · limit을 무중단으로 바꾸는 [01 In-Place Pod Resize]({{< relref "01-inplace-pod-resize.md" >}}) · 실제로 밟은 사례는 [istio 09]({{< relref "../../istio/09-istiod-scaling-connections.md" >}})

## 1. limit은 총량이 아니라 100ms짜리 배급이다

`limits.cpu`는 "이만큼의 CPU를 쓸 수 있다"가 아니라 **"100ms마다 이만큼씩 받는다"** 이다. kubelet이 하는 계산은 한 줄이다.

```
quota(µs) = limits.cpu(milli) × period(µs) ÷ 1000     # period 기본 100000µs = 100ms
```

`limits.cpu: 600m` → quota 60ms/100ms. `2` → 200ms/100ms. 이 값이 그대로 `cpu.cfs_quota_us`(cgroup v1) 또는 `cpu.max`(v2)에 쓰인다. 두 가지가 여기서 파생된다 — quota 하한은 **1ms**라 `10m` 미만은 전부 1ms로 뭉치고, period는 kubelet 플래그(`--cpu-cfs-quota-period`)로 노드 단위로만 바꿀 수 있다.

동작은 단순하다. period가 시작하면 quota가 리필되고, 소진하면 **period가 끝날 때까지 강제로 재운다(throttle).** 다음 period에 다시 리필.

**핵심은 period가 서로 완전히 독립이라는 것이다.** 지난 period에 quota를 하나도 안 썼어도 이월되지 않고 사라진다. 이 한 줄에서 이 문서의 모든 증상이 나온다.

{{< cfstl variant="latency" >}}

CPU 30ms가 연속으로 필요한 요청 하나를 보자. limit이 없으면 30ms에 끝난다. `0.2` 코어면 quota가 20ms라 20ms를 쓰고 **80ms를 그냥 멈춰 있다가** 다음 period에 남은 10ms를 쓴다 — 같은 일이 **110ms**가 된다.

이 컨테이너의 평균 CPU 사용량은 **0.1 코어**다. limit(0.2)의 **절반**이다. 자원이 부족한 게 아니라 나눠주는 방식이 문제인 상태이고, 커뮤니티에서 오래 굴러온 문제이기도 하다([#67577](https://github.com/kubernetes/kubernetes/issues/67577), [#51135](https://github.com/kubernetes/kubernetes/issues/51135)).

## 2. 그래서 "여유로운데 잘린다"가 성립한다

실제 사례의 숫자가 이 구조를 잘 보여준다. istiod에서 관측된 값은 **파드별 CPU 최대 0.207코어, limit 600m의 34%**, 그런데 **스로틀 분율 31%** 였다.

평균과 스로틀을 연립해서 풀면 무슨 일이 있었는지 나온다. period당 평균 20.7ms인데 24%의 period가 quota(60ms)를 꽉 채워 잘렸다면:

```
0.243 × 60ms + 0.757 × y = 20.7ms   ⇒   y ≈ 8.1ms
```

**24%의 period는 60ms를 다 태우고 잘리고, 나머지 76%는 8ms만 쓴다.** "평균 207m"은 이 두 상태를 섞어 뭉갠 값일 뿐이다. 1분 평균 그래프가 여유로워 보인 건 그래서다.

{{< callout type="warning" >}}
**CPU 사용률만으로 limit을 사이징하면 안 된다.** 사용률은 period 안에서 언제 썼는지를 지우고 평균만 남긴다. `throttled_periods / periods` 분율을 같이 보지 않으면 이 상태는 **관측 자체가 안 된다** — 그래프에 안 나타나는 것과 문제가 없는 것은 다르다.
{{< /callout >}}

## 3. 잘린 시간은 어디로 가나 — CPU wait과 APM 지연

throttle은 "느려짐"이 아니라 **정지**다. quota가 마르는 순간 그 컨테이너에서 **돌던 스레드가 전부 같이 멈춘다.** 하나가 느려지는 게 아니라 컨테이너 전체가 다음 period 경계까지 서 있는다.

멈춘 스레드는 실행 큐에서 대기 상태가 되고, 이 시간은 애플리케이션 쪽에서 **CPU를 기다린 시간(CPU wait / run-queue 대기)** 으로 잡힌다. 그래서 이렇게 번진다.

{{< flow src="_flow/3-잘린-시간은-어디로-가나.json" />}}

APM에서 이게 **특징적인 모양**으로 나타난다. 느린 트레이스를 열어보면 DB도 외부 호출도 느리지 않은데 **스팬과 스팬 사이가 비어 있다.** 어디에도 귀속되지 않는 시간이라 "애플리케이션이 느리다"로 보이지, 커널이 재웠다고는 안 보인다. GC pause를 의심해 GC 로그를 뒤지다가 아무것도 못 찾는 전형적인 경로가 여기다.

**왜 평균보다 꼬리가 크게 망가지나.** throttle은 매 요청에 고르게 걸리지 않는다. period 후반에 도착한 요청만 걸리고 앞쪽은 멀쩡하다. 그래서 대부분의 요청은 정상이고 일부만 최대 한 period(기본 100ms)만큼 통째로 밀린다 — 평균은 조금 나빠지고 P99는 크게 나빠지는 비대칭이 나온다. [03 CPU Burst §6]({{< relref "03-cpu-burst.md" >}})의 실측이 정확히 이 비대칭을 보여준다: 같은 개선에서 **RT 평균은 약 1/3, P99는 약 1/20**로 줄었다.

## 4. 다중코어에서는 더 빨리 마른다

여기가 가장 직관과 어긋나는 지점이다. **quota는 wall time이 아니라 CPU-time으로 소진된다.** 즉 **"동시에 몇 개 코어에서 도느냐"에 비례해서** 마른다.

limit이 1코어(quota 100ms/period)일 때, 1코어에서만 돌면 100ms를 꽉 채우고 period가 끝나 안 잘린다. 그런데 2코어에서 동시에 돌면 50ms 만에, 4코어면 25ms 만에 그 100ms를 태워버린다.

{{< cfstl variant="threads" >}}

그리고 그 "동시 개수"는 **노드의 코어 수가 받쳐줘야** 나온다. 결론이 반직관적이다 — **같은 limit이라도 코어가 많은 노드에 스케줄될수록 더 잘 잘린다.** 64코어 노드로 옮겨서 더 느려지는 일이 실제로 일어난다.

이게 런타임의 병렬도 설정과 맞물리면 증상이 커진다. 대부분의 런타임이 **노드의 코어 수**를 보고 스레드풀·GC 워커·`GOMAXPROCS`를 잡기 때문이다.

| 런타임 | 무엇을 보나 | 함정 |
|---|---|---|
| Go 1.25+ | cgroup **limit**(없으면 노드 코어) | limit 없으면 64코어 노드에서 P=64개. `GOMAXPROCS` 있으면 자동감지 **꺼짐** |
| Go 1.24 이하 | 노드 코어 수 | `uber-go/automaxprocs` 필요. 이쪽은 **내림**(최소 1) |
| JVM | cgroup 인지(`UseContainerSupport`, 기본 on) | 힙은 시작 시점 고정. GC 스레드 수가 많으면 대표적인 bursty 패턴 |
| Node.js | libuv 스레드풀은 고정 4 | V8 old space는 시작 시 고정 |
| Python | 노드 코어 수 (`os.cpu_count()`) | cgroup 자동 감지 없음 — 워커 공식 `2n+1`이 노드 기준으로 폭증. GIL 덕에 프로세스 하나는 ~1코어가 천장이지만, 그래서 워커·네이티브 스레드풀이 범인이 된다 → [06]({{< relref "06-python-gil-cfs" >}}) |

**소수점 limit은 이 배선에서 항상 어긋난다.** kubelet의 Downward API는 `limits.cpu`를 **올림**해서 넘기는데(`ceil(0.6) = 1`) 커널 quota는 올림 없이 정확히 60ms다. `600m`·`1500m`·`2500m` 모두 같은 문제이고, **정수 코어만 둘이 맞는다.** 자세한 배선은 [01 §5 ④]({{< relref "01-inplace-pod-resize.md" >}})에 있다.

## 5. 어떻게 같이 봐야 하나

### 지표는 겹쳐 읽는다

CPU 사용률은 **단독으로 읽으면 안 되는 지표**다. 같은 그래프도 응답 시간이 어떻게 움직이느냐에 따라 전혀 다른 상황이 된다.

| CPU | 응답 시간 | 해석 | 다음에 볼 것 |
|---|---|---|---|
| 높음 | 높음 | 진짜 CPU 부족 **또는** 무한 루프 | **트래픽 그래프** — 용량 초과(증설)인지 코드 문제인지 갈린다 |
| 낮음 | 높음 | 뭔가를 **기다리는** 중 | DB·락·커넥션 풀·외부 API. CPU 그래프를 붙잡고 있어봐야 답이 없다 |
| 높음 | 낮음 | 건강하게 일하는 중 | 헤드룸만 관리 |
| **낮음** | **높음 + 스로틀 분율 높음** | **이 문서의 상태** | quota·period·병렬도. 아래 쿼리 |

세 번째 줄과 네 번째 줄이 사용률 그래프에서는 **구분되지 않는다.** 스로틀 분율을 붙여야 갈린다.

```promql
# 스로틀 분율 — 이 값이 0이 아니면 사용률이 낮아도 잘리고 있다
rate(container_cpu_cfs_throttled_periods_total{container!=""}[5m])
  / rate(container_cpu_cfs_periods_total{container!=""}[5m])

# 잘린 시간의 절대량 — "얼마나 오래 멈춰 있었나"
rate(container_cpu_cfs_throttled_seconds_total{container!=""}[5m])

# 명목 limit 대비 실제 사용률 — 위와 겹쳐 보면 "여유로운데 잘린다"가 드러난다
rate(container_cpu_usage_seconds_total{container!=""}[5m])
  / on(pod, container) kube_pod_container_resource_limits{resource="cpu"}
```

노드에 직접 들어갈 수 있으면 cgroup 파일이 가장 정확하다.

```bash
cat /sys/fs/cgroup/cpu.stat        # cgroup v2 (v1은 .../cpu/<경로>/cpu.stat)
# nr_periods / nr_throttled / throttled_usec  ← 이 셋
```

### 해석할 때 조심할 것

- **rate 윈도우가 버스트를 뭉갠다.** `rate(...[5m])`은 5분 평균이라 초 단위 스파이크를 눌러버린다. 스로틀은 period(100ms) 현상이므로 짧은 윈도우와 `max_over_time`을 같이 본다.
- **갓 뜬 파드를 섞지 말 것.** 기동 직후에는 클래스 로딩·JIT·커넥션 수립으로 CPU가 튀어 스로틀이 정상적으로 걸린다. 이 표본이 섞이면 정상 상태의 limit이 실제보다 과하게 조여 보인다. 파드 나이 필터를 걸고 본다.
- **분율보다 절대량이 판단에 가깝다.** `nr_throttled/nr_periods`가 5%여도 매번 100ms씩 잘린다면 P99에는 치명적이고, 30%여도 1ms씩이면 체감이 없을 수 있다.

## 6. 대응 — 무엇을 대가로 치르나

먼저 **효과가 절반뿐인 두 가지**부터 정리한다. 둘 다 "얼마나 주느냐"를 건드리는데, 문제는 **타이밍**이기 때문이다.

| 방법 | 되는 것 | 대가 |
|---|---|---|
| **limit을 올린다** | 실제로 효과 있음 | requests 연동 여부에 따라 **파드 수 감소** 또는 **오버커밋** |
| **period를 늘린다** | throttle **횟수**가 준다 | **한 번에 더 오래 잘린다** — 지연 민감이면 오히려 악화 |

limit을 올리면 `requests = limits`인 경우 requests도 같이 올라 **노드당 파드 수가 준다.** requests를 그대로 두고 limit만 올리면 **오버커밋**이 된다. period를 늘리면 throttle 횟수는 주는데(20ms/100ms → 40ms/200ms), 대신 한 번에 더 오래 멈춘다 — 80ms 멈추던 게 160ms로 늘어난다. 커널의 period 상한은 **1000ms**다.

### BP ① limit을 제거한다

가장 확실하게 듣는다. `#67577`의 보고가 유명한데 — ingress controller에서 **limit을 1500m까지 올려도 별로 나아지지 않았는데 아예 없애자 p99·p999가 60ms·100ms에서 ~5ms로** 떨어졌다. 평균 CPU는 30m 남짓이었다. **limit을 올리는 게 아니라 없애야 풀렸다**는 게 이 문제의 성격을 그대로 보여준다.

quota가 없으면 CFS는 `cpu.shares`(requests에서 파생)로만 조정한다. **경합이 없으면 남는 CPU를 자유롭게 쓰고, 경합이 생기면 requests 비율대로 나눈다.** 평상시 버스트를 흡수하면서 혼잡할 때의 공정성은 유지되는 구조다.

**그래서 무엇을 잃나.** 이웃에 대한 상한이 사라진다. 폭주하는 파드 하나가 노드의 여유 CPU를 전부 가져갈 수 있고, 이건 CPU 총량이 아니라 **다른 파드의 지연**으로 나타난다. 그리고 무엇보다 **`requests`를 제대로 잡아뒀을 때만 성립하는 전략**이다 — requests가 실제 수요보다 작으면 경합 시 보장받는 몫도 그만큼 작다.

```yaml
resources:
  requests:            # 여기가 진짜 보장선이다. 실측 기반으로 정확히
    cpu: "500m"
    memory: "512Mi"
  limits:
    memory: "512Mi"    # 메모리 limit은 남긴다 — OOM은 이웃이 아니라 노드를 지키는 문제
    # cpu limit 없음
```

적용 기준을 정리하면:

| 이럴 때 뺀다 | 이럴 때 유지한다 |
|---|---|
| 지연에 민감한 온라인 서비스(API·게이트웨이·프록시) | 멀티테넌트 — 신뢰 경계가 다른 워크로드가 섞인 노드 |
| requests를 실측으로 잡아둔 워크로드 | 과금·용량 계획이 limit에 묶여 있는 환경 |
| 스로틀 분율이 실제로 높은 파드 | 폭주 이력이 있거나 검증 안 된 배치·서드파티 |
| bursty한 패턴(웹, GC 많은 JVM) | CPU를 꾸준히 꽉 채우는 배치 — 애초에 뺄 이유가 적다 |

{{< callout type="warning" >}}
**Go 워크로드에서 limit을 뺄 때는 `GOMAXPROCS`를 같이 챙긴다.** Go 1.25+의 컨테이너 인식은 **limit을 보지 requests를 보지 않는다.** limit을 빼면 노드 전체 코어 수가 `GOMAXPROCS`가 되어 64코어 노드에서 P를 64개 잡는다. limit을 뺐다면 `GOMAXPROCS`를 requests 기준으로 **명시하는 편이 안전하다.**
{{< /callout >}}

노드 전체에서 끄는 방법도 있다. kubelet의 `--cpu-cfs-quota=false`는 **그 노드의 모든 컨테이너**에 대해 quota 적용을 끈다. 파드별로 고를 수 없어 영향 범위가 크니, 지연에 민감한 워크로드만 모은 전용 노드풀에 쓰는 게 맞다.

### 실제 케이스 — 전용 노드의 Ingress Gateway, CPU만 빼고 메모리는 고정

istiod에서 스로틀을 확인하고 같은 방식으로 Istio Ingress Gateway를 들여다봤더니 여기서도 잘리고 있었다. 게이트웨이는 **전용 노드에 격리**해 두는 구성이라([istio 03]({{< relref "../../istio/03-gateway-node-isolation.md" >}})) BP ①의 최대 약점인 "이웃을 노출한다"가 **구조적으로 사라진다.** 같은 노드에 있는 게 전부 같은 역할의 게이트웨이 파드라, 하나가 여유 CPU를 더 가져가는 것은 그 관문의 처리량으로 되돌아온다. 그래서 여기서는 CPU limit을 뺐다.

원래는 cpu·memory 모두 `requests = limits`인 **Guaranteed** 파드였고, **메모리 쪽만 그대로 `requests = limits`로 남겼다.** 이 비대칭이 이 케이스의 핵심이다. 우연이 아니라 두 자원의 성격이 다르기 때문에 옳다.

| | CPU | 메모리 |
|---|---|---|
| 성격 | **compressible** — 뺏으면 느려질 뿐 | **incompressible** — 뺏을 수 없다 |
| 상한 초과 시 | throttle (지연) | **OOM kill** (프로세스 종료) |
| 반환 | 즉시 | 런타임이 OS에 잘 안 돌려준다 |
| ⇒ limit의 값어치 | 낮다 — 잘라도 이웃이 얻는 게 지연뿐 | **높다** — 상한이 없으면 노드가 죽는다 |

#### 메모리 limit이 아예 없는 것보다 나은 점

limit이 없으면 컨테이너가 노드 메모리를 끝까지 먹을 수 있고, 그때 개입하는 건 둘 중 하나다. 운이 좋으면 kubelet eviction이 먼저 돌지만, 빠르게 부풀면 **커널 OOM killer가 먼저** 온다. 커널은 파드 경계를 모르고 `oom_score`만 보므로 **누가 죽을지 고르는 정밀도가 거칠다** — 게이트웨이 전용 노드라 해도 같은 노드의 kubelet·containerd·CNI가 함께 사는데, 이쪽이 맞으면 파드 하나가 아니라 **노드가 NotReady로 빠진다.** 관문 노드에서 이건 남북 트래픽 전체의 문제다.

메모리 limit은 그 사고를 **컨테이너 하나의 재시작으로 가둔다.** CPU limit을 빼는 것과 달리 메모리 limit을 남기는 데는 실질적인 비용이 거의 없다 — 정상 동작하는 파드는 limit에 닿지 않기 때문이다.

#### `requests < limits`(가변)보다 나은 점

가변으로 두면 "평소엔 작게 잡고 필요할 때 limit까지 부푼다"를 기대하게 되는데, 메모리에서는 이 기대가 잘 안 맞는다. **한 번 부푼 메모리는 잘 안 돌아온다** — Envoy의 메모리는 커넥션 수와 클러스터·엔드포인트 설정 규모를 따라 늘고, 피크가 지나도 할당자가 OS에 즉시 반납하지 않는다. 스케줄러는 requests로 노드를 채워놨는데 실제 사용량은 limits 쪽에 가까워지는 **조용한 오버커밋**이 된다.

그리고 kubelet이 메모리 압박에서 축출 대상을 고르는 순서를 보면 차이가 분명해진다. 정렬의 **첫 번째 키가 "사용량이 requests를 초과했는가"라는 불리언**이고, 그다음이 PriorityClass, 그다음이 절대 사용량이다.

```
정렬 키: (requests 초과 여부) → PriorityClass → 절대 메모리 사용량
```

`requests = limits`면 사용량이 limit을 못 넘으니 **requests를 초과하는 일이 구조적으로 불가능하다.** 즉 이 파드는 **언제나 "초과하지 않은" 그룹**에 남아 축출 1순위 그룹에 절대 들어가지 않는다. `requests < limits`로 두면 requests를 넘긴 순간 이 그룹의 맨 앞으로 이동한다 — 하필 트래픽이 몰려 메모리가 늘어난 그 순간에 관문이 축출 후보 1순위가 되는 것이다.

같은 이유가 커널 쪽에도 있다. Burstable 파드의 `oom_score_adj`는 **requests에서 계산**된다.

```
oom_score_adj = 1000 − (1000 × memory requests ÷ 노드 메모리 용량)
```

requests를 실수요에 맞게 잡아둘수록 이 값이 낮아지고, **노드 메모리 압박에서 더 늦게 죽는다.** requests를 낮게 잡고 limits만 크게 주는 구성은 정확히 반대로 간다.

#### 대신 무엇을 포기했나 — Guaranteed → Burstable 강등

이 게이트웨이는 원래 cpu·memory 모두 `requests = limits`인 **Guaranteed**였다. CPU limit을 빼는 순간 그 등급은 **유지할 수 없다** — Guaranteed는 모든 컨테이너가 cpu·memory **둘 다** requests = limits여야 성립하기 때문이다. 메모리만 맞춰도 QoS는 **Burstable**로 내려온다. 즉 이 선택은 "throttle을 없애는 대가로 QoS 한 등급을 지불한 것"이고, 무엇을 지불했는지는 항목별로 다르다.

| 항목 | Guaranteed였을 때 | 지금(Burstable) | 실질 영향 |
|---|---|---|---|
| **kubelet 축출 순위** | requests 초과 없음 → 안전 그룹 | **동일** | **없음** |
| **커널 `oom_score_adj`** | **−997** 고정 | `1000 − 1000 × memReq ÷ 노드용량` | **실질적 손실** |
| **CPU Manager static 자격** | 있음(CPU가 정수였다면) | 없음 | 손실 아님 |
| **스케줄링** | requests 기준 | 동일 | 없음 |

축출 순위는 영향이 없다. 정렬 키가 `(requests 초과 여부 → PriorityClass → 사용량)`이고 **QoS 항이 아예 없기** 때문이다 — memory `req = limit`을 유지했으므로 초과가 불가능한 상태 그대로다. `oom_score_adj`는 실질적 손실이다. 예를 들어 32Gi 노드에 memory requests 2Gi면 약 **938**로, 거의 반대편 끝이다. CPU Manager static 자격은 손실이 아니다 — 쓰려면 CPU limit을 되살려야 해서 애초에 이 선택의 목적과 양립하지 않는다.

정리하면 **잃은 건 사실상 `oom_score_adj` 하나**다. 그리고 이게 언제 문제가 되는지를 정확히 구분해야 한다.

- **컨테이너가 자기 메모리 limit을 넘긴 경우** — 이건 cgroup 레벨 OOM이라 **그 컨테이너만** 죽는다. `oom_score_adj`와 무관하고, 강등 전후가 똑같다.
- **노드 전체 메모리가 마른 경우** — 여기서만 커널 OOM killer가 노드의 프로세스들을 `oom_score` 순으로 고른다. 예전엔 −997이라 kubelet(−999) 다음으로 안전했는데, 지금은 상위 후보 쪽에 서 있다.

두 번째 시나리오를 막아주는 게 결국 **`requests = limits`와 정확한 requests**다. 모든 게이트웨이 파드가 자기 limit 이상 못 쓰고 스케줄러는 allocatable 안에서만 파드를 넣으므로, requests 합이 정직하면 노드 전체가 마르는 상황 자체가 잘 안 생긴다. 다만 Guaranteed 시절에는 이게 **공짜로 보장**됐고 지금은 **requests 정확도에 의존**한다는 차이가 있다. 안전장치가 사라진 게 아니라 **자동에서 수동으로 바뀐 것**에 가깝다.

{{< callout type="warning" >}}
**노드에 CPU Manager static policy가 켜져 있었는지 확인할 것.** 켜져 있었다면 Guaranteed + 정수 CPU인 이 게이트웨이는 **전용 코어를 배정받고 있었고**, CPU limit 제거는 그 전용 코어를 반납하고 공유 풀로 돌아간다는 뜻이다 — 지연 특성이 크게 달라진다. 다만 §BP ②에서 본 대로 static policy에서는 quota와 cpuset 크기가 같아 **throttle이 성립하지 않으므로**, 스로틀이 실제로 관측됐다는 사실 자체가 이 노드가 static policy가 아니었다는(또는 이 컨테이너가 대상이 아니었다는) 정황 증거다.
{{< /callout >}}

한 가지 더 — QoS class를 키로 쓰는 주변 도구가 있는지 봐야 한다. "Guaranteed만 받는" 노드풀 정책, QoS별 알람·대시보드, 비용 배분 로직 같은 것들이 조용히 어긋날 수 있다. 등급이 바뀐 건 파드 스펙 한 줄이지만 그걸 읽는 쪽은 여러 곳이다.

⇒ 정리하면 이 구성은 **"CPU는 관문이 필요한 만큼 쓰게 두고, 메모리는 노드를 지키는 선에서 못 넘게 막는다"** 이다. 전용 노드가 CPU 쪽 위험을 없애주고, `requests = limits`가 메모리 쪽에서 축출 순위를 가장 안전한 자리에 고정한다. 남은 숙제는 **memory requests를 실측으로 유지하는 것** 하나이고, 강등 이후로는 그 숙제의 무게가 전보다 무거워졌다. 커넥션 수가 늘어 게이트웨이의 정상 메모리 사용량이 올라갔는데 requests가 옛날 값이면, 축출 보호와 OOM 순위가 **동시에** 약해진다.

### BP ② CPU Manager static policy

throttle을 완화하는 게 아니라 **구조적으로 없애는** 접근이다. kubelet을 `--cpu-manager-policy=static`으로 띄우면 조건을 만족하는 컨테이너에 **전용 코어(exclusive cpuset)** 를 배정한다.

조건은 둘 다 만족해야 한다 — **QoS가 Guaranteed**(모든 컨테이너에 requests = limits)이고 **CPU 요청이 정수**여야 한다. `1500m`은 소수라 대상이 아니고, 조건에 안 맞는 파드는 조용히 공유 풀에 남는다.

**왜 throttle이 사라지나.** 오해하기 쉬운데 **CFS quota가 없어지는 게 아니다.** kubelet은 exclusive CPU를 받은 컨테이너에도 quota를 평소대로 건다(코드상 cpuset만 추가로 설정한다). 그런데 `limits.cpu: 4`면 quota는 400ms/period이고 cpuset은 정확히 4개다. **4개 코어에서 100ms 동안 쓸 수 있는 최대 CPU-time이 400ms** — quota와 정확히 같다. §4에서 본 "병렬도가 quota를 빨리 태운다"는 문제가 성립할 수 없는 것이다.

덤으로 따라오는 것도 있다. 코어를 독점하니 **컨텍스트 스위치와 캐시 오염이 줄고**, Memory Manager·Topology Manager와 묶으면 NUMA 정렬까지 맞출 수 있다.

**대가가 크다.**

- **파편화.** 정수 코어만 배정되므로 남는 코어가 놀 수 있다. 클러스터 사용률이 떨어진다.
- **Guaranteed 강제.** requests = limits를 모든 컨테이너에 걸어야 해서 오버커밋으로 얻던 밀도를 포기한다.
- **[01의 in-place resize와 상극이다.]({{< relref "01-inplace-pod-resize.md" >}})** static policy 노드의 Guaranteed 파드는 resize가 admission에서 Infeasible로 거부된다. 우회 게이트는 아직 alpha다.
- **노드 단위 설정이고 되돌리기가 번거롭다.** 정책을 바꾸려면 kubelet을 재시작하고 CPU Manager 상태 파일을 지워야 한다.
- 관련해서 스케일다운 시 **바쁜 CPU를 회수해 affinity를 깨는** 리포트도 열려 있다([#131309](https://github.com/kubernetes/kubernetes/issues/131309)).

⇒ **저지연이 비용보다 명백히 비싼 워크로드에만** 쓴다. 트레이딩·실시간 미디어·NFV처럼 지터 자체가 SLO인 경우다. 일반 웹 서비스에는 과하고, 그쪽은 BP ①이 훨씬 싸게 같은 문제를 푼다.

### BP ③ 타이밍만 푼다 — CPU Burst

총량이 아니라 타이밍이 문제라면, 타이밍을 직접 건드리는 게 맞다. **안 쓴 quota를 버퍼에 적립해뒀다 바쁠 때 당겨 쓰는** 커널 기능이 있고, 누적 평균은 limit 그대로 유지된다. 다만 커널에는 5.14부터 있는데 **k8s에서 켤 표면이 없다.** → [03 CPU Burst]({{< relref "03-cpu-burst.md" >}})

### 정리

| | throttle 제거 | 이웃 보호 | 사용률 | 적용 단위 |
|---|---|---|---|---|
| limit 제거 | ◎ | ✗ (requests에 의존) | ◎ | 파드 |
| CPU Manager static | ◎ | ◎ | ✗ 파편화 | 노드(kubelet) |
| CPU Burst | ○ 불필요한 것만 | △ 여유 노드 전제 | ◎ | 노드 직접 조작 or 벤더 |
| limit 상향 | △ | ○ | ✗ | 파드 |
| period 상향 | △ 횟수만 | ○ | ○ | 노드(kubelet) |

## 7. 체크리스트

- [ ] **먼저 관측한다** — `nr_throttled / nr_periods`가 실제로 0이 아닌가? 아니면 이 문서는 남의 얘기다
- [ ] **사용률과 겹쳐 본다** — 사용률이 낮은데 스로틀이 높으면 §2의 그 상태다
- [ ] **표본을 정제한다** — 갓 뜬 파드 제외, 짧은 윈도우와 `max_over_time` 병행
- [ ] **APM과 잇는다** — 스팬 사이의 빈 구간이 스로틀 구간과 시간적으로 겹치는지
- [ ] **병렬도를 확인한다** — 노드 코어 수, `GOMAXPROCS`/스레드풀 설정. 큰 노드로 옮긴 뒤 나빠졌다면 §4다
- [ ] **CPU limit은 정수 코어로** — 소수점은 런타임(올림)과 커널(정확값)이 항상 어긋난다
- [ ] **대응을 고른다** — 온라인 서비스면 limit 제거부터, 지터가 SLO면 CPU Manager, 그 사이면 CPU Burst
- [ ] **limit을 뺐다면** requests를 실측으로 다시 잡고, Go라면 `GOMAXPROCS`를 명시했는지 확인
- [ ] **Guaranteed에서 내려왔다면** 메모리는 `requests = limits`를 유지했는지, QoS class를 키로 쓰는 노드풀 정책·알람·비용 로직이 어긋나지 않는지, 그 노드가 CPU Manager static이 아니었는지 확인

## 이 문서에서 가져갈 것

- `limits.cpu`는 총량이 아니라 **100ms짜리 배급**이고 **period 간 이월이 없다.** "평균 사용률 34%인데 period의 31%가 잘린다"가 여기서 나온다.
- **사용률 그래프에는 이 상태가 없다.** `throttled_periods / periods`를 겹쳐야 보이고, 안 보는 것과 없는 것은 다르다.
- 잘린 시간은 **CPU wait으로 쌓여 APM 스팬 사이의 빈 구간**이 된다. 컨테이너 전체가 동시에 서므로 평균보다 **꼬리가 훨씬 크게** 망가진다.
- **코어가 많을수록 더 잘린다.** quota는 병렬도에 비례해 마른다 — 큰 노드로 옮겨 느려지는 일이 실제로 있다.
- 대응은 **무엇을 포기하느냐**의 문제다. limit 제거는 이웃 상한을, CPU Manager는 사용률과 유연성을, CPU Burst는 k8s 표면을 포기한다.
- **CPU limit과 메모리 limit을 같이 취급하지 말 것.** CPU는 압축 가능해서 빼도 지연만 오가지만, 메모리는 상한이 없으면 노드가 죽는다. **CPU는 빼고 메모리는 `requests = limits`로 고정**하는 비대칭이 전용 노드에서는 가장 안전한 조합이다.
- **CPU limit을 빼면 Guaranteed는 포기해야 한다.** 다만 실제로 잃는 건 `oom_score_adj`(−997 → Burstable 공식) 하나다 — kubelet 축출 정렬에는 **QoS 항이 없어서** memory `req = limit`만 유지하면 순위가 그대로다. 노드 전체가 마르는 시나리오를 막아주던 게 자동에서 **requests 정확도에 의존하는 수동**으로 바뀐다.

## 참고 자료

- [Linux / CFS Bandwidth Control](https://docs.kernel.org/scheduler/sched-bwc.html) — quota·period·슬라이스와 `cpu.cfs_burst_us`의 1차 소스
- [kubernetes#67577](https://github.com/kubernetes/kubernetes/issues/67577) — 저사용률 스로틀 보고. limit 제거로 p99가 12~20배 개선된 사례 · [#51135](https://github.com/kubernetes/kubernetes/issues/51135)
- [Kubernetes / CPU Management Policies](https://kubernetes.io/docs/tasks/administer-cluster/cpu-management-policies/) — static policy의 조건과 정책 옵션
- [CPU를 다 쓰지도 않았는데 스로틀링에 걸렸습니다](https://makgol.com/blog/istiod-cpu-throttling) — §2의 istiod 실측(0.207코어 / 31%)과 역산이 여기서 나왔다. 더 깊은 판은 [istio 09]({{< relref "../../istio/09-istiod-scaling-connections.md" >}})
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — 컨테이너 인식 `GOMAXPROCS`, "does not consider the CPU requests option" · [uber-go/automaxprocs](https://github.com/uber-go/automaxprocs)
- 동작 서술의 근거 코드: `kubernetes/kubernetes` master — `pkg/kubelet/kuberuntime/helpers_linux.go`(`milliCPUToQuota`, 하한 1ms), `kuberuntime_container_linux.go`(`cpuCFSQuota` 분기), `pkg/kubelet/cm/cpumanager/policy_static.go`(Guaranteed·정수 조건), `pkg/kubelet/cm/internal_container_lifecycle_linux.go`(cpuset만 설정하고 quota는 건드리지 않음)
