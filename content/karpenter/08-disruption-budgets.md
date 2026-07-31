---
title: "언제 무엇을 멈출 것인가 — disruption 예산"
weight: 8
---

# 08 · 언제 무엇을 멈출 것인가 — disruption 예산 설계

{{< callout type="info" >}}
**한눈에**
- disruption 이유 셋은 **파드를 옮기느냐**로 갈린다. `Empty`만 안 옮긴다 — 이게 예산 설계의 출발점이다.
- **`reasons`를 생략한 예산은 셋 모두에 적용된다.** 피크 차단용 `nodes: "0"`에 `reasons`를 안 적으면 **빈 노드 정리까지 같이 멈춘다.** 가장 흔한 오설정이고, 실패가 아니라 침묵으로 나타나 발견이 늦다.
- 같은 이유에 예산이 여럿 활성이면 **가장 제한적인 값이 이긴다.** 전역 `nodes: "1"` 하나가 나머지 설계를 전부 무력화할 수 있다.
- 예산은 **graceful disruption만** 막는다. `expireAfter` 만료·인터럽션·Node Repair는 예산 밖이다.
- `nodes: "0"`은 **실행만** 막는다. drift 판정과 마킹은 계속 쌓이므로, 예산을 푸는 순간 밀린 교체가 한꺼번에 터진다.
- "노드가 안 줄어든다"의 진단 순서는 **이벤트 → 예산 → requirements → topology**다. 예산이 1순위인 이유는 유일하게 **시도했다는 증거를 이벤트로 남기기** 때문이다.
{{< /callout >}}

> **왜 이 문서인가.** v1에서 drift는 끌 수 없고 expiration은 forceful로 되돌아갔다([01]({{< relref "01-changelog-v1-transition.md" >}})). 남은 통제 수단이 실질적으로 `disruption.budgets` 하나뿐인데, 이 필드는 문법이 짧아서 다 이해했다고 착각하기 쉽다. 실제로는 **생략된 필드의 기본 해석**이 동작의 절반을 결정하고, 그 절반이 조용히 틀린다.
>
> 예산을 "세대 다운그레이드를 막는 임시 방어선"으로 쓰는 용법은 [06 §4.2]({{< relref "06-consolidation-traps.md" >}})가, CA bundle drift 구간의 방어 yaml은 [02 §6.1]({{< relref "02-changelog-maturity.md" >}})이 소유한다. 여기서는 **예산 자체의 평가 규칙과 시간대 설계**를 다룬다.

## 1. 이유 셋은 성질이 다르다

`reasons`에 쓸 수 있는 값은 셋뿐이다(`karpenter-core/pkg/apis/v1/nodepool.go`의 `DisruptionReason` enum). 갈라야 할 기준은 하나다 — **파드를 실제로 옮기는가.**

| 이유 | 언제 | 파드 이동 | 피크에 위험 |
|---|---|---|---|
| `Empty` | 워크로드 파드가 0 | **없음** | 낮음 |
| `Underutilized` | 더 싼 배치를 찾음 | 있음 | **높음** |
| `Drifted` | 해시·requirement 불일치 | 있음 | **높음** |

"비었다"의 정의가 **"파드가 0개"가 아니라 "재스케줄 대상 파드가 0개"** 라는 게 핵심이다. 판정은 재스케줄 비용을 노드 기본 비용과 비교하는 한 줄이고(`disruption/types.go:155-157`), DaemonSet과 노드 소유 파드는 `IsReschedulable`에서 미리 걸러진다(`utils/pod/scheduling.go:44-48`). 즉 **DaemonSet만 남은 노드는 empty로 취급된다.**

그 노드를 지워도 옮길 파드가 없다. `Emptiness`의 Command에는 애초에 `Replacements` 필드가 없어 **삭제만 한다**(`emptiness.go:97-100`).

**그래서 피크 시간에 막아야 할 것은 뒤의 둘이지 `Empty`가 아니다.** 빈 노드를 피크 내내 살려두는 건 비용만 나가고 얻는 게 없다.

## 2. 평가 규칙 넷 — 셋은 문서에 있고 하나는 안 물려봐야 모른다

### 2.1 `reasons`를 생략하면 모든 이유에 적용된다

이게 실전에서 가장 자주 물리는 지점이다.

```yaml
budgets:
  - nodes: "0"
    schedule: "0 1 * * *"
    duration: 4h            # reasons 없음 → Empty·Underutilized·Drifted 전부 정지
```

의도는 "피크에 파드를 흔들지 마라"인데, 실제 효과는 "피크에 **아무것도 하지 마라**"다. 빈 노드가 4시간 동안 그대로 요금을 먹는다. 증상은 NodePool 이벤트에 그대로 찍힌다.

```
Normal  DisruptionBlocked  No allowed disruptions for disruption reason Empty due to blocking budget
```

**이 이벤트에 `Empty`가 보이면 거의 항상 오설정이다.** 의도적으로 빈 노드 정리까지 멈추는 경우는 드물다.

### 2.2 가장 제한적인 값이 이긴다

한 이유에 대해 활성 예산이 여럿이면 **최솟값**이 적용된다. 합산이 아니다.

```yaml
budgets:
  - nodes: "10%"                      # 항상 활성
  - nodes: "0"
    reasons: ["Drifted"]
    schedule: "0 9 * * mon-fri"
    duration: 9h
```

평일 업무시간의 `Drifted` 예산은 `min(10%, 0) = 0`이다. 뒤집으면 **전역 예산 하나가 나머지를 전부 덮어쓸 수 있다** — 아래 §4가 정확히 그 사례다.

### 2.3 `budgets`를 쓰면 기본값이 사라진다

기본값은 `nodes: 10%`인데, `budgets`를 **명시하는 순간 대체**된다. 추가가 아니다. 그래서 시간대 예산만 적으면 그 창 밖에는 상한이 아예 없어진다.

```yaml
budgets:
  - nodes: "10%"          # ← 이 줄을 빼면 평시 상한이 무제한이 된다
  - nodes: "0"
    reasons: ["Underutilized", "Drifted"]
    schedule: "0 1 * * *"
    duration: 4h
```

### 2.4 `schedule`과 `duration`은 둘 다 있거나 둘 다 없어야 한다

| 필드 | 제약 |
|---|---|
| `schedule` · `duration` | **동반 필수** — 하나만 적으면 거부된다 |
| 둘 다 생략 | 그 예산은 **항상 활성** |
| `duration` | 시간·분만. `4h`·`90m` (cron이 초를 모른다) |
| `nodes` | 생략 시 기본 `10%`. `"3"` 또는 `"25%"` |

첫 줄은 admission에서 걸린다 — 스키마에 CEL 규칙이 박혀 있다(`nodepool.go:108`).

```
rule="self.all(x, has(x.schedule) == has(x.duration))"
message="'schedule' must be set with 'duration'"
```

`nodes`에 기본값이 있다는 점도 알아둘 만하다. `reasons`와 `schedule`만 적고 `nodes`를 빼면 그 예산은 조이는 게 아니라 **10%를 허용하는** 예산이 된다.

## 3. 예산을 소비하는 것과 아닌 것

예산은 **graceful disruption에만** 걸린다. 소비 지점이 코어 disruption 컨트롤러의 `BuildDisruptionBudgetMapping`(`pkg/controllers/disruption/helpers.go:262`) 하나뿐이고, 거기 등록된 Method가 다섯 개(`controller.go:101-114`)이기 때문이다.

| 동작 | 예산 소비 | 실제 통제 수단 |
|---|---|---|
| consolidation (`Empty`·`Underutilized`) | **예** | 예산 |
| drift (`Drifted`) | **예** | 예산 |
| `expireAfter` 만료 | 아니오 | 없음 — 즉시 삭제 |
| spot ITN · EC2 상태 검사 실패 | 아니오 | 없음 — 인터럽션 경로 |
| Node Repair | 아니오 | **별도 상한 20%** |

가르는 기준이 공식 문서에 한 줄로 있다 — forceful 계열은 *"do not wait for a pre-spin replacement node to be healthy"*, 즉 **대체 노드가 건강해지기를 기다리지 않는다.** 기다리지 않으니 속도를 조절할 대상도 없다.

세 가지 함의가 있다.

**① 예산으로는 만료를 못 막는다.** `expireAfter`를 짧게 잡아둔 NodePool은 피크 창 안에서도 노드가 사라진다. 만료 컨트롤러(`nodeclaim/expiration/controller.go:81-83`)는 예산을 조회하지 않고 곧바로 `Delete`를 호출한다. 드레인은 termination 컨트롤러가 처리하고 PDB는 존중되지만, 예산은 그 경로 밖이다. **피크 보호가 목적이면 `expireAfter`도 같이 봐야 한다.**

**② Node Repair는 예산이 아니라 자기 상한을 쓴다.** 예산을 0으로 걸어도 unhealthy 노드 복구는 진행되고, 대신 `allowedUnhealthyPercent = "20%"`라는 별도 하드코딩 상한이 걸린다(`node/health/controller.go:53`). 예산을 조인 상태에서 노드가 계속 교체된다면 이 경로를 의심한다.

**③ `nodes: "0"`은 판정이 아니라 실행을 막는다.** drift 마킹은 예산과 무관하게 계속 쌓인다 — 마킹 컨트롤러(`nodeclaim/disruption/drift.go`)에는 예산 참조가 아예 없고, 예산은 그 뒤 단계에서 이미 마킹된 후보를 거른다.

```go
// pkg/controllers/disruption/drift.go:77-80  ← 실행 단계에서만 걸린다
if disruptionBudgetMapping[candidate.NodePool.Name] == 0 {
    continue
}
```

그래서 예산을 무기한 0으로 두면 밀린 교체가 **푸는 순간 한꺼번에 터진다.** [02 §6.1]({{< relref "02-changelog-maturity.md" >}})의 CA bundle drift 구간에서 이게 실제 위험이 되는 이유다.

## 4. 현장 사례 — 예산이 축소를 막고 있었다

stage 클러스터의 `service-amd64-on-demand` NodePool이다. `kubectl describe`로 본 예산은 셋이다.

```yaml
disruption:
  consolidationPolicy: WhenEmptyOrUnderutilized
  consolidateAfter: 5m
  budgets:
    - nodes: "1"                    # 항상 활성, 모든 이유
    - nodes: "0"
      schedule: "0 1 * * *"         # KST 10:00 ~ 14:00
      duration: 4h
    - nodes: "0"
      schedule: "0 8 * * *"         # KST 17:00 ~ 21:00
      duration: 4h
```

### 4.1 이 설정이 실제로 만드는 상태

| 시간대 (KST) | `Empty` | `Underutilized` | `Drifted` |
|---|---|---|---|
| 10–14, 17–21 (8h) | **0** | **0** | **0** |
| 그 외 (16h) | 1 | 1 | 1 |

세 예산 **어디에도 `reasons`가 없다.** §2.1대로 셋 모두에 적용되고, §2.2대로 피크에는 최솟값 0이 이긴다. 하루 3분의 1은 빈 노드조차 정리되지 않는다.

그리고 피크가 아닌 16시간에도 상한은 **전체 합쳐 1대**다. 이유별 1대가 아니라 세 이유를 합쳐 1대다.

### 4.2 이벤트가 답을 그대로 말하고 있었다

```
Normal  DisruptionBlocked  53m    (x41 over 8h)   ... for disruption reason Empty due to blocking budget
Normal  DisruptionBlocked  3m47s  (x297 over 8h)  ... for disruption reason Underutilized due to blocking budget
```

**8시간에 297번.** consolidation은 계속 후보를 찾아내고 있었고, 매번 예산에서 잘렸다. "consolidation이 동작하지 않는다"가 아니라 "동작해서 매번 차단당하고 있다"가 정확한 상태다. 둘은 겉보기가 같고 조치가 완전히 다르다.

`Empty`가 41번 찍힌 것이 §2.1 오설정의 직접 증거다.

### 4.3 실제 여유는 있었다

같은 NodePool의 `status.resources`다.

| 항목 | 값 | 해석 |
|---|---|---|
| Nodes | 7 | 전부 16 vCPU / 128GiB |
| Cpu | 112 | 16 × 7 → **r8i.4xlarge 7대** |
| Memory | ≈866 GiB | 128 × 7 |

여기에 실측 alloc이 CPU 30% / Memory 50%면 requests는 대략 **34 vCPU / 433 GiB**다. r8i.4xlarge 4대(64 vCPU / 496 GiB)면 담긴다. **7 → 4가 가능한데 예산이 막고 있었다.**

## 5. 무엇을 바꿀 수 있나

### 5.1 예산 — 최소 수정

`reasons`를 붙이는 것만으로 피크 보호를 유지하면서 빈 노드 정리를 되살린다.

```yaml
budgets:
  - nodes: "10%"                                   # 전역 상한 (비율로)
  - nodes: "0"
    reasons: ["Underutilized", "Drifted"]          # Empty는 계속 돈다
    schedule: "0 1 * * *"
    duration: 4h
  - nodes: "0"
    reasons: ["Underutilized", "Drifted"]
    schedule: "0 8 * * *"
    duration: 4h
```

`nodes: "1"`을 `"10%"`로 바꾼 이유는 **절대값이 클러스터 성장을 따라가지 못하기** 때문이다. 지금 7대면 둘 다 1대지만, 20대가 되면 절대값은 여전히 1대인 반면 비율은 2대가 된다. 조임의 강도가 규모와 무관하게 고정되는 건 대개 의도가 아니다.

**그리고 `1`에는 눈에 안 보이는 부작용이 하나 더 있다.** 예산은 실행 속도만 조이는 게 아니라 **multi-node consolidation의 후보 풀 자체를 자른다.** 후보가 2개 미만이면 그 경로는 즉시 종료되므로, **한 NodePool의 예산이 `1`이면 "여러 대를 한 대로 합치는" 통합이 아예 성립하지 않는다**([11 §2.4]({{< relref "11-consolidation-model.md" >}})). 노드 수를 줄이는 게 목적이라면 최소 `2` 이상이 나오도록 잡아야 하고, 퍼센트는 올림이라 작은 풀에서는 `20%`도 1이 될 수 있다.

### 5.2 축소가 필요한 기간에는 창을 하나 더 판다

밀린 축소를 흘려보내려면 야간에 `Underutilized`만 넓히는 예산을 한시적으로 추가한다.

```yaml
  - nodes: "3"
    reasons: ["Underutilized"]
    schedule: "0 16 * * *"        # KST 01:00
    duration: 5h                  #   ~06:00
```

수렴이 끝나면 이 항목만 지운다. 상시로 두면 새벽마다 churn이 도는 구성이 된다.

### 5.3 예산 밖의 항목 — 같은 NodePool에서 같이 볼 것

| 현재 설정 | 무엇이 걸리나 | 검토 |
|---|---|---|
| `expireAfter: Never` | 06 §4의 **복귀 경로가 drift 하나만** 남는다 | AMI 갱신을 drift에만 의존하게 된다 |
| `instance-cpu In [16,32]` | **16 vCPU 미만으로 축소 불가** | 4·8 추가 시 통합 선택지가 넓어진다 |
| `instance-generation In [8]` | 8세대 ICE 시 폴백 없음 | 07의 폴백 풀 구성과 함께 판단 |
| `zone In [2a,2c]` | AZ 2개 — ICE 리스크가 3개보다 높다 | 2b 추가 가능 여부 |
| `instance-family NotIn [*-flex]` | 신규 flex 패밀리가 자동으로 안 걸린다 | 1.7+면 라벨 한 줄로 대체 |

마지막 줄이 [02 §2]({{< relref "02-changelog-maturity.md" >}})와 직결된다. 지금은 flex 패밀리를 이름으로 하나씩 나열하는 방식이라 **AWS가 새 `-flex` 패밀리를 내면 그날부터 조용히 뚫린다.** 1.7 이상이면 다음 한 줄이 같은 일을 하고 미래의 패밀리까지 커버한다.

```yaml
- key: karpenter.k8s.aws/instance-capability-flex
  operator: In
  values: ["false"]
```

`instance-cpu` 하한도 같이 볼 값이다. alloc이 30%대로 낮게 유지되는 워크로드라면 16 vCPU가 최소 단위인 것 자체가 과할 수 있다. 다만 작은 노드로 갈수록 DaemonSet 오버헤드 비율이 나빠지고 노드당 파드 수 상한에 먼저 걸리므로, **먼저 `Underutilized` 예산을 풀어 16/32 안에서 얼마나 줄어드는지 본 다음** 결정하는 순서가 맞다.

## 6. "노드가 안 줄어든다" 진단 순서

예산을 1순위에 두는 이유는 유일하게 **시도했다는 증거를 남기기** 때문이다. 나머지 원인은 전부 침묵한다.

```
① 이벤트를 먼저 본다
   kubectl get events -A --field-selector reason=DisruptionBlocked
   → 찍힌다     = consolidation은 돌고 있다. 예산 문제 (②로)
   → 안 찍힌다  = 후보 자체가 안 만들어진다 (③으로)

② 예산 — reasons 누락? 전역 절대값이 작은가? 창이 너무 넓은가?

③ 정책 — consolidationPolicy가 WhenEmpty인가?
        consolidateAfter가 Never이거나 너무 긴가?

④ requirements — 줄일 방향의 인스턴스 타입이 후보 집합에 있는가?
        instance-cpu·instance-size 하한이 축소를 봉쇄하고 있지 않은가?

⑤ topology — hostname 스프레드가 노드 수 하한을 만들고 있지 않은가?
        PDB·do-not-disrupt·컨트롤러 없는 파드가 노드를 잡고 있지 않은가?
```

②까지 확인하면 대부분 끝난다. ③의 `consolidateAfter`는 v1에서 필수가 된 필드라 마이그레이션 때 아무 값이나 박혀 있는 경우가 많다([01 §2.3]({{< relref "01-changelog-v1-transition.md" >}})).

```bash
kubectl get nodepool -o custom-columns=\
NAME:.metadata.name,\
POLICY:.spec.disruption.consolidationPolicy,\
AFTER:.spec.disruption.consolidateAfter
```

### 6.1 `consolidateAfter` 타이머는 무엇으로 리셋되나

"파드가 자주 바뀌면 타이머가 계속 리셋된다"는 설명은 절반만 맞다. 기준은 NodeClaim의 `status.lastPodEventTime`이고, 이 값이 갱신되는 조건은 셋뿐이다(`nodeclaim/podevents/controller.go:63-97`).

| 갱신되는 경우 | 갱신 안 되는 경우 |
|---|---|
| non-DaemonSet 파드가 **바인딩** | **DaemonSet 파드의 모든 변동** |
| 그 파드가 **terminal** 상태로 | 10초 내 중복 이벤트 (dedupe) |
| 그 파드가 **terminating**으로 | 파드 스펙·상태의 그 밖의 변경 |

```go
// pkg/controllers/nodeclaim/disruption/consolidation.go:62-77
timeToCheck := lo.Ternary(!LastPodEventTime.IsZero(),
    LastPodEventTime, initialized.LastTransitionTime)
```

값이 아직 비어 있으면 `Initialized` 컨디션 전환 시각을 대신 쓴다. 그래서 **파드가 한 번도 안 바뀐 노드도 기동 시각 기준으로 타이머가 돌아 정상적으로 후보가 된다.** DaemonSet 롤아웃이 타이머를 리셋하지 않는다는 것도 중요하다 — 흔한 오해다.

## 7. 관측

**NodePool `status.conditions`에는 예산 전용 조건이 없다.** 거기 있는 건 `ValidationSucceeded`·`NodeClassReady`·`NodeRegistrationHealthy`와 집계 `Ready`뿐이라(`nodepool_status.go:27-31`), 예산 상태는 **이벤트와 메트릭으로만** 본다.

| 수단 | 정확한 이름 |
|---|---|
| 이벤트 | reason `DisruptionBlocked` |
| 메트릭 · 남은 허용량 | `karpenter_nodepools_allowed_disruptions` |
| 메트릭 · 소비 중인 노드 수 | `karpenter_nodepools_nodes_consuming_budgets` |

메트릭 둘 다 라벨이 `{nodepool, reason}`이라(`disruption/metrics.go:102-118`) **이유별로 갈라 볼 수 있다.** 대시보드에 올릴 것은 이쪽이다.

```promql
# 이유별 허용량이 0인 구간 — 의도한 창과 일치하는지 본다
karpenter_nodepools_allowed_disruptions{reason="empty"} == 0
```

`reason="empty"`가 0인 시간이 의도한 것보다 길면 §2.1 오설정이다.

이벤트 쪽은 카운트의 **증가 속도**가 실질적인 지표다. §4.2의 `x297 over 8h`는 "3분에 한 번씩 후보를 만들고 매번 잘린다"는 뜻이고, 이 숫자가 크다는 것 자체가 축소 여지가 크다는 신호다.

```
Can't replace with a cheaper node   → 예산이 아니라 가격 부등식에서 탈락 (06 §1)
```

## 8. 근거

로컬 체크아웃 `kubernetes-sigs/karpenter` **v1.14.0-6-gac7a021e**와 `aws/karpenter-provider-aws` **v1.14.0** 기준이다. 상대 경로는 코어 레포 루트.

| 무엇 | 출처 |
|---|---|
| `reasons` 생략 = 전체 적용 | `pkg/apis/v1/nodepool.go:120,372` |
| 최솟값 병합 | `nodepool.go:364-377` `GetAllowedDisruptionsByReason` |
| 기본값 `10%`와 대체 | `nodepool.go:104-114` kubebuilder default |
| `reasons` enum 3종 | `nodepool.go:183-185` |
| `schedule`↔`duration` 동반 필수 | `nodepool.go:108` CEL XValidation |
| `nodes` 기본값 `10%` | `nodepool.go:136` kubebuilder default |
| 예산 소비 지점 | `controllers/disruption/helpers.go:262`, `controller.go:101-114` |
| 마킹과 실행의 분리 | `nodeclaim/disruption/drift.go`(참조 없음) 대 `disruption/drift.go:77-80` |
| 만료가 예산을 안 탐 | `nodeclaim/expiration/controller.go:81-83` |
| Node Repair 자체 상한 | `node/health/controller.go:53` |
| `IsEmpty` 정의 | `disruption/types.go:134,155-157`, `utils/pod/scheduling.go:44-48` |
| `consolidateAfter` 리셋 | `nodeclaim/disruption/consolidation.go:62-77`, `podevents/controller.go:63-97` |
| 이벤트 문구 · 메트릭 | `disruption/events/events.go:117-123`, `disruption/metrics.go:102-118` |
| forceful 정의 | `.../docs/concepts/disruption.md:171` |

**확인하지 못한 것** — §4.3의 requests 추정치는 노드 스펙과 보고된 alloc 비율로 역산한 값이다. 실제 축소 가능 대수는 파드 단위 빈패킹 결과에 달려 있어, 예산을 푼 뒤 관측으로만 확정된다.
