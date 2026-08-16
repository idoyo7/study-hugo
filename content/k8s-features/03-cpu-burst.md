---
title: "CPU Burst (커널 5.14)"
weight: 3
aliases:
  - /k8s-features/02-cpu-burst/   # 02는 CPU Throttling에 내주고 03으로 이동했다
---

# 03 · CPU Burst — CPU limit을 지키면서 불필요한 throttling만 걷어낸다

{{< callout type="info" >}}
**한눈에**
- CFS bandwidth control은 **period를 독립 정산하고 안 쓴 quota를 버립니다.** 그래서 평균 사용률이 limit의 절반이어도 순간 수요만으로 throttle이 걸립니다. 자원이 부족한 게 아니라 **나눠주는 방식**의 문제입니다.
- CPU Burst는 이전 period의 미사용분을 buffer에 적립해 뒀다가 빌려 쓰게 합니다. **순간 상한만 `Quota + Buffer`로 늘고, 누적 상한 `Σ CPUTime ≤ Quota × N`은 그대로입니다.** limit을 올려주는 것과 근본적으로 다릅니다.
- **평균이 아니라 꼬리가 개선됩니다.** 발표 실측에서 RT Avg는 30+ms→9.6ms(약 1/3)인데 **P99는 500+ms→27.32ms(약 1/20)**. throttling이 망가뜨리는 건 tail이기 때문입니다.
- 공짜가 아닙니다. 이웃 컨테이너가 deadline을 놓칠 수 있고 그게 누적되면 unbounded fail입니다. 다만 정량화돼 있다 — **평균 CPU 사용률 70% 미만이면 안전**하고 직관과 반대로 **컨테이너 수가 적은 노드가 더 위험**하입니다.
- `cpu.cfs_burst_us` **기본값 0 = 기존 동작과 완전히 동일.** 커널만 올려도 아무것도 안 바뀐다. 도입 리스크가 낮은 편.
- ⚠️ **k8s에서 Pod spec으로 켜는 건 아직 안 된다**([#104516](https://github.com/kubernetes/kubernetes/issues/104516)). 현재는 노드에서 cgroup을 직접 만지거나 벤더 annotation을 씁니다.
{{< /callout >}}

> **출처**: KubeCon + CloudNativeCon China 2021 — *CPU Burst: Getting Rid of Unnecessary Throttling…* (常怀鑫·丁天琛, Alibaba Cloud 커널팀). 이 글은 발표 내용에 커널 동작과 운영 판단을 덧붙여 재구성했습니다.
>
> 자매 문서: [챕터 개요]({{< relref "_index.md" >}}) · **이 문서가 푸는 문제를 먼저 진단하는 쪽은 [02 CPU Throttling]({{< relref "02-cpu-throttling.md" >}})** — 증상 관측과 다른 대응책(limit 제거·CPU Manager)이 거기 있다 · 같은 CPU limit 문제의 다른 얼굴은 [istio 09 §8]({{< relref "../istio/09-istiod-scaling-connections.md" >}}) · 리소스를 재시작 없이 바꾸는 쪽은 [01 In-Place Pod Resize]({{< relref "01-inplace-pod-resize.md" >}})

## 1. 먼저 requests와 limits를 분리해야 한다

이름이 비슷해 묶이지만 커널 구현이 다르고 그 차이가 문제의 출발점입니다.

| | **requests** | **limits** |
|---|---|---|
| 커널 구현 | `cpu.shares` (CFS Share) | CFS Bandwidth Control |
| 계산 | `CPUTime = NumCPUs × shares / Σshares` | period마다 quota 리필 |
| 경쟁이 없을 때 | **천장이 열린다** — 노드 전체까지 쓸 수 있다 | **경쟁과 무관하게 막는다** |
| 스케줄링 영향 | 있다 | 없다 |

requests는 분모(`Σshares`)가 상황에 따라 변합니다. 32 CPU 노드에 `requests: 8` 컨테이너가 혼자 있으면 실제로 32를 다 씁니다. 하나 더 붙으면 16, `requests: 16`짜리가 더 붙으면 8이 됩니다. **바닥은 보장하되 여유가 있으면 그냥 쓰게 해주는** 구조입니다.

limits는 정반대로 **노드가 텅 비어 있어도 막습니다.** 이 비대칭이 문제를 만듭니다.

## 2. 문제 — period 간에 이월이 없다

```bash
cpu.cfs_period_us = 100000   # 정산 주기 100ms
cpu.cfs_quota_us  =  20000   # period당 20ms → 0.2 CPU
```

period가 시작하면 quota가 리필됩니다. 소진하면 period 끝까지 강제로 재웁니다(throttle). 다음 period에 또 리필 — 동작 자체는 단순합니다.

**각 period가 완전히 독립적**이라는 게 핵심입니다. 지난 period에 quota를 하나도 안 썼어도 이월되지 않고 사라집니다. 이 한 줄이 이 문서의 전부입니다.

### 그래서 벌어지는 일

요청 하나에 CPU 30ms가 연속으로 필요한 애플리케이션이 있습니다.

| 설정 | 처리 시간 | |
|---|---|---|
| limit 없음 | **30ms** | 몰아 쓰고 끝 |
| limit 0.2 CPU | **110ms** | 20ms 쓰고 80ms 대기 → 다음 period에 10ms |

{{< cfstl variant="latency" >}}

버그에 가깝다고 부르는 이유가 여기 있습니다. 사용자 입장에선 "준 것의 절반밖에 안 쓰는데 왜 느려지지?"가 됩니다. 커뮤니티에서 오래 굴러온 문제이기도 합니다 — [#67577](https://github.com/kubernetes/kubernetes/issues/67577), [#51135](https://github.com/kubernetes/kubernetes/issues/51135).

### 지금 확인해볼 것

```bash
cat /sys/fs/cgroup/cpu/<컨테이너경로>/cpu.stat
```
```
nr_periods     157
nr_throttled    12          # ← throttle 걸린 period 수
throttled_time  1668131531  # ← 누적 throttle 시간(ns)
```

**`nr_throttled / nr_periods` 비율을 먼저 보세요.** 이 값이 낮으면 이 문서는 당신 클러스터와 무관합니다. 높은데 CPU 사용률이 낮다면 정확히 이 문제입니다.

## 3. 기존 해법이 왜 부족한가

**limit을 올립니다** — `requests = limits`(Guaranteed)면 requests도 같이 올라 노드당 Pod 수가 줄고 **클러스터 사용률이 떨어집니다.** requests를 고정하고 limits만 키우면 over-commitment가 되어 과금 정합성과 성능 일관성이 깨집니다.

**quota와 period를 함께 키웁니다** — `20ms/100ms` → `40ms/200ms`. throttling 횟수는 줄지만 **한 번 걸렸을 때 더 오래 재워집니다** — 최대 대기가 100ms에서 200ms로 늘어납니다. 횟수를 줄이고 한 방을 키우는 교환입니다. 커널의 period 상한 1초 때문에 무한정 키울 수도 없습니다.

둘 다 **사용률·과금·응답시간 중 뭔가를 포기**하고 **워크로드마다 사람이 튜닝**해야 합니다.

## 4. 설계 — 과거의 underrun을 빌린다

안 쓴 건 권리를 포기한 게 아니라 그때 일이 없었을 뿐입니다. 그러면 적립해 뒀다가 쓰게 하면 됩니다.

quota 20ms / period 100ms / buffer 20ms일 때:

| period | CPU 수요 | 동작 | buffer |
|---|---|---|---|
| 1 | 없음 | 미사용분 적립 | 0 → **20ms** |
| 2 | 30ms | quota 20 + **buffer 10 차용** → throttle 없음 | 20 → **10ms** |
| 3 | 30ms | quota 20 + buffer 10 → 소진 후 **throttle** | 10 → **0ms** |

같은 장부를 wall time으로 펴면 이렇게 보입니다.

{{< cfstl variant="burst" >}}

위쪽은 3 period 동안 40ms밖에 못 쓰고 나머지는 멈춰 있습니다 — 일이 있는데도 그렇습니다. 아래쪽은 60ms — **`300ms × 0.2 = 60ms`**, 즉 limit이 원래 허락한 총량입니다.

### 핵심 불변식

```
3 period 실제 사용:  0 + 30 + 30 = 60ms
같은 구간의 limit:  300ms × 0.2   = 60ms
```

순간적으로 30ms를 썼지만 **전체로 보면 limit을 1ms도 넘지 않았습니다.**

| | |
|---|---|
| Burst 없음 | `CPUTime ≤ Quota` |
| Burst 있음 | `CPUTime ≤ Quota + Buffer` |
| **항상** | **`Σ CPUTime ≤ Quota × Number(Periods)`** |

buffer는 반드시 이전 underrun에서만 납니다. 없는 걸 만들지 않습니다. 그래서 **순간 상한만 느슨해지고 누적 상한은 불변**입니다. limit을 2배 주면 장기 평균도 2배가 되지만 CPU Burst는 장기 평균이 원래 limit 그대로입니다 — 과금 모델과 용량 계획이 안 깨지는 이유가 이것입니다.

> **throttling이 사라지는 게 아닙니다.** 빌려올 시간이 없으면 여전히 throttle된다(위 표 period 3). CPU Burst는 throttling 제거가 아니라 **불필요한** throttling 제거입니다.

## 5. 인터페이스 — 파일 하나

```bash
# 설정: 적립 가능한 최대치. 기본값 0 = 비활성
echo 20000 > /sys/fs/cgroup/cpu/<경로>/cpu.cfs_burst_us
```

`cpu.stat`에 관측 필드 둘이 추가됩니다.

```
nr_throttled     0          # ← 0이 됨
throttled_time   0
nr_bursts       99          # (신규) burst를 사용한 period 수
burst_time  1899843279      # (신규) 누적 burst 사용 시간(ns)
```

**튜닝은 이 두 값만 보면 됩니다.**

| 관측 | 해석 | 조치 |
|---|---|---|
| `nr_throttled` 여전히 높음 | buffer 부족 | 키운다 |
| `nr_bursts` ≈ 0 | burst가 필요 없는 워크로드 | 켤 이유 없음 |
| `nr_throttled` 0, `nr_bursts` > 0 | 정상 동작 | 유지 |

기본값이 0이라 **커널만 올려도 동작이 안 바뀝니다** — 도입 리스크가 낮다는 점에서 in-place resize와 성격이 다릅니다.

## 6. 실측 — 평균이 아니라 꼬리를 본다

발표에서 제시된 두 사례입니다.

| 사례 | 지표 | 전 | 후 |
|---|---|---|---|
| GC 스레드 많은 앱 | RT Avg | 30+ms | **9.6ms** |
| | **RT P99** | **500+ms** | **27.32ms** |
| 다른 앱 | RT Avg | 1310ms | 952ms (**-27%**) |

**평균은 1/3인데 P99는 1/20입니다.** 이 비대칭이 CPU Burst의 성격을 그대로 보여줍니다 — throttling은 평균을 조금씩 갉는 게 아니라 **일부 요청을 크게 지연시킵니다.** 그래서 평균만 보는 대시보드에서는 문제가 잘 안 보이고 P99를 봐야 드러납니다.

첫 사례에서 효과가 컸던 건 그 Pod이 **GC 스레드 수를 많이 잡아 둬** CPU 사용이 순간적으로 튀었기 때문입니다. GC는 평소 놀다가 한 번에 몰아 쓰는 대표적 bursty 패턴이고 **JVM 계열이 CPU limit과 유독 상성이 나쁜 이유**이기도 합니다. 반대로 CPU를 꾸준히 꽉 채우는 배치·계산 작업은 적립될 여유가 없어 효과가 거의 없습니다.

## 7. 부작용 — 이웃이 대가를 치른다

발표의 약 30%가 이 부분입니다. **업스트림 메인테이너가 병합 조건으로 요구한 숙제**였기 때문입니다.

CPU Burst 이전에는 이 전제가 성립했습니다.

> 모든 태스크의 quota 총합 ≤ 100%로 설정하면 → 스케줄링 안정성과 실시간성이 보장됩니다

task1(50%) + task2(50%)에서 task1에만 buffer 10%를 주면:

| | task1 | task2 | |
|---|---|---|---|
| Burst 없음 | 50% | 50% | 둘 다 deadline 충족 |
| Burst 있음 | **60%** | **40%** | task2 **missed deadline** |

더 나쁜 건 누적입니다. 밀린 작업이 다음 주기로 넘어가고 그 사이 task1이 또 burst를 씁니다. 메인테이너의 표현으로 **"unbounded fail"** — 따라잡을 시간이 영영 안 올 수 있습니다.

### 정량화 — WCET

이걸 "위험할 수도 있다"로 두면 아무도 못 씁니다. 그래서 **WCET(Worst-Case Execution Time)**로 정량화했습니다.

- Burst 없음 → 모든 태스크가 한 period 안에 완료 → WCET < 1
- Burst 있음 → **WCET > 1 가능** → 그 시점의 스케줄링 시스템은 불안정

방법은 대기행렬 이론 모델링 + 몬테카를로 시뮬레이션입니다(CPU를 서비스 창구로, 태스크 수요가 period 간격으로 도착). 입력은 **수요 분포 · 노드의 컨테이너 총수 · buffer 크기**, 출력은 **WCET 기댓값과 `P(WCET > 1)`**. 시뮬레이터가 공개돼 있어 자기 환경 수치로 돌려볼 수 있습니다.

### 결론 — 70% 선, 그리고 직관과 반대인 것

> **평균 CPU 사용률 70% 미만이면 CPU Burst가 이웃에 큰 영향을 주지 않습니다.**
> (지수분포 수요, 컨테이너 20개, buffer = quota × 1배 기준)

대부분의 프로덕션 노드가 이 조건을 만족합니다. 위험도를 좌우하는 축은 둘입니다.

| 요인 | 방향 | 이유 |
|---|---|---|
| 평균 부하 ↑ | 위험 ↑ | 자명하다 |
| **컨테이너 수 ↓** | **위험 ↑** | i.i.d.에서 수가 많을수록 수요가 평균에 수렴해 초과분·여유분이 **상쇄**된다(중심극한정리) |

**두 번째가 직관과 어긋납니다.** 컨테이너가 빽빽한 노드가 아니라 **몇 개 안 되는 노드가 더 위험합니다.** 파레토 분포(꼬리가 두꺼운 현실적 모델)로 바꿔도 경향은 같습니다.

부하가 계속 높은 환경이라면 발표자들은 솔직하게 선을 긋습니다 — 그때는 CPU Burst 자체가 도움이 안 되니 **사양을 올리거나 부하를 줄이라**고 합니다.

## 8. buffer 크기 — 처리량 ↔ 예측가능성 다이얼

출발점은 **quota와 같은 크기(1배)**입니다. 안전성 분석도 이 기준입니다.

| Buffer를 **키운다** | Buffer를 **줄인다** |
|---|---|
| 전체 처리량을 높이고 싶을 때 | 스케줄링 안정성·실시간성이 중요할 때 |
| 평균 부하가 높지 않을 때 | 전체 부하가 높을 때 |
| → burst 효과 ↑, 개별 최적화 이득 ↑ | → WCET ↓, 이웃 간섭 ↓ |
| → **WCET ↑, 이웃 간섭 ↑** | → 최적화 이득 ↓ |

## 9. 지금 쓸 수 있나

| | 상태 |
|---|---|
| 커널 | **5.14+** 메인라인 (commit `f4183717b370`) |
| cgroup v1 | `cpu.cfs_burst_us` |
| cgroup v2 | `cpu.max.burst` — ⚠️ 발표에서 다루지 않음, 별도 확인 필요 |
| 배포판 | Anolis OS 8.2+ (CentOS 8 생태계 호환) |
| **Kubernetes** | ⚠️ **Pod spec 지원 없음** — [#104516](https://github.com/kubernetes/kubernetes/issues/104516) WIP |
| Alibaba ACK | Pod annotation `alibabacloud.com/cpuBurst: '{"policy":"auto"}'` |

커널에는 5.14부터 들어가 있지만 **k8s가 Pod spec으로 노출하지 않습니다** — **여기가 실무의 발목입니다.** 지금 쓰려면 노드에서 cgroup을 직접 만지거나(파드 재생성 시 날아갑니다) 벤더가 붙인 annotation에 의존해야 합니다. 매니지드 클러스터라면 사실상 벤더 지원 여부가 전부입니다.

> [01 In-Place Pod Resize]({{< relref "01-inplace-pod-resize.md" >}})와 대조하면 성격이 뚜렷하입니다. 그쪽은 **k8s API가 먼저 갖춰지고 커널 반영의 정합성이 숙제**였고, 이쪽은 **커널이 5년 전에 끝났는데 k8s 표면이 없습니다.**

## 10. 도입 체크리스트

- [ ] 커널 **5.14+** 인가 (또는 Anolis OS 8.2+)
- [ ] 대상 워크로드의 `nr_throttled / nr_periods` 비율이 실제로 높은가
- [ ] 그런데 **평균 CPU 사용률은 limit보다 낮은가** — 이 둘이 동시에 참이어야 대상입니다
- [ ] 워크로드가 **bursty**한가 (웹/API, GC 많은 JVM ✅ / 배치·CPU-bound ❌)
- [ ] 노드 **평균 CPU 사용률 70% 미만**인가
- [ ] 노드의 **컨테이너 수가 충분한가** (적으면 더 위험)
- [ ] `cpu.cfs_burst_us`를 **quota와 같은 값**으로 시작
- [ ] 적용 후 `nr_throttled`(↓) / `nr_bursts`(>0) 재확인
- [ ] **이웃 컨테이너의 P99**에 악화가 없는지 확인 — 여기가 진짜 검증 지점입니다

## 11. 정리

세 문장으로 줄이면 이렇습니다.

1. **불필요한 throttling은 자원 부족이 아니라 period 독립 정산의 부작용입니다.** 평균 사용률이 limit보다 낮은데 throttle이 걸리면 그게 증거입니다.
2. **CPU Burst는 순간 상한만 늘리고 누적 상한은 건드리지 않습니다.** limit을 올리는 것과 혼동하면 안 됩니다.
3. **대가는 이웃이 치르지만 정량화돼 있습니다.** 70% 미만·컨테이너 다수면 안전하고 그 바깥이면 시뮬레이터로 먼저 확인하라.

실무에서 지금 당장의 병목은 기술이 아니라 **k8s 표면의 부재**입니다. 커널은 준비돼 있으니 [#104516](https://github.com/kubernetes/kubernetes/issues/104516)의 진행을 지켜보는 게 현재로선 가장 현실적인 대응입니다.
