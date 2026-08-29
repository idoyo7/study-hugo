---
title: "03 그래서 무엇을 할 것인가"
weight: 3
---

# 그래서 무엇을 할 것인가

[2부]({{< relref "../02-rollback-window-weight/index.md" >}})는 기전으로 끝났습니다. `rollbackWindow`가 인덱스를 스텝 끝으로 던지고 역탐색이 방금 건너뛴 마지막 `setWeight: 100`을 도로 집어오고 가용량 게이트는 canary를 보지 않는다는 것까지.

이 글은 그래서 무엇을 고칠 것인가입니다. 결론은 한 줄 삭제인데, **그 한 줄이 왜 안전한지와 무엇을 대가로 내는지**가 이 글의 대부분입니다. `minPodsPerReplicaSet` 이야기도 붙습니다 — 사고의 절반은 "canary RS가 2대"라는 사실이고, 그 2가 어디서 왔는지가 1년 3개월짜리 이야기입니다.

## 먼저 결론

- **처방은 canary steps의 마지막 `setWeight: 100` 삭제입니다.** 그 스텝은 100% 도달에 아무 역할이 없습니다 — 스텝을 다 지나면 컨트롤러가 알아서 `MaxTrafficWeight`를 쓴다고 소스 주석이 직접 말합니다 `✓`
- 업스트림 공식 예제·문서에서 **램프 상한이 100으로 끝나는 것은 62블록 중 3건**이고 셋 다 ambassador 계열입니다 `✓`. 업스트림에 "빼라"는 권고도 없고 "안 쓴다"는 관행도 없습니다 — 이 판단은 소스 분석에서 나온 자체 결론입니다 `Σ`
- **파드는 더 뜨지도 덜 뜨지도 않습니다.** RS 크기는 스텝 목록과 무관한 다른 경로에서 정해집니다 `✓`
- 대가는 하나입니다 — **램프 구간 내내 95%가 되돌리려던 버전으로 갑니다.** 사고 조건에서 약 45초 `≈`. 롤백 완료 시각 자체는 변하지 않습니다 `✓`
- 안전 한계가 있습니다. `안전 파드 수 = minPodsPerReplicaSet ÷ 남는 가중치% × 100` — 5%를 남기면 40대까지입니다 `✓`
- **적용이 두 갈래로 갈립니다.** Helm이 리스트를 교체하므로 base 수정과 오버라이드 수정은 독립인 별개 작업입니다. 스냅샷 기준 `steps` 오버라이드가 386블록입니다 `✓`
- `dynamicStableScale: true`는 답이 아닙니다. 트리거를 못 막고 웜 스탠바이를 없애며 abort 탈출로까지 막습니다. **게다가 우리 차트는 그 필드를 렌더하지 않습니다** `✓`
- **업스트림은 아직 안 고쳤습니다.** PR #4852는 2026-07-15 개설, 2026-07-24 APPROVED, 2026-08-27 조회 시점에도 미머지입니다 `✓(GitHub 조회, 2026-08-27)`. 역탐색 블록은 v1.8.2와 master(2026-08-25)에서 로직이 같습니다. **abort 가중치 함수만 master에서 전면 재작성됐습니다** `✓`
- `minPodsPerReplicaSet: 2`는 2025-05-21에 들어왔고 같은 값 하나가 방향에 따라 정반대 증상으로 1년 3개월간 재발했습니다 `✓`

## 1. 처방 — 마지막 `setWeight: 100`을 지운다

근거는 셋입니다.

**하나, 그 스텝은 기능상 잉여입니다.** [1부 §4.2]({{< relref "../01-canary-step-analysisrun/index.md" >}})의 주석 그대로 — *"컨트롤러는 스텝을 다 지나면 100을 기본값으로 쓴다."* 100% 도달에 그 스텝이 필요하지 않습니다 `✓`.

**둘, 업스트림 공식 예제의 램프 상한은 우리보다 낮습니다.** 무엇을 세는지부터 정해야 합니다 — '마지막 스텝'이 아니라 **'마지막 `setWeight` 값'**입니다. 역탐색 루프(`trafficrouting.go:247-253`)가 `step.SetWeight != nil`만 보고 뒤에 붙은 `pause`를 건너뛰므로 `[…, 100, pause]`도 100을 집습니다 `✓`. 그 기준으로 v1.8.2의 `examples/`에서 canary `steps`가 붙은 매니페스트 **19개**와 `docs/`의 `steps:` 블록 **43개**(`docs/` 하위 전 파일 기준. `.md`만 세면 37개)를 훑었습니다. 마지막 `setWeight` 값이 100인 것은 **3건**입니다 — ambassador 예제 하나와 getting-started/ambassador 문서 둘이고 나머지는 `setWeight: 80`·`setWeight: 20` 같은 낮은 상한에서 끝납니다 `✓`. 공식 getting-started 예제는 `setWeight: 80` + `pause`로 끝나면서도 본문은 "fully transitioned"에 도달한다고 서술합니다.

정직하게 하나 적어 둡니다. **ambassador 계열 예제도 이 사고에 노출되는 형태입니다.** 그러니 이 처방은 업스트림 관행이 아니라 역탐색 코드를 읽고 내린 자체 결론입니다 `Σ`.

(v1.8.2에서 `setWeight: 100`이 나오는 곳은 위 셋뿐이고 전부 뒤에 `pause`가 붙습니다. `hpa-support` 문서에는 v1.8.2에 `setWeight`가 **한 줄도 없습니다** — 그 예시는 master에만 있습니다. master에서는 `docs/proposals/resource-plugin.md`에 마지막 스텝이 `setWeight: 100`인 블록이 다섯 개 있습니다. 이 편의 다른 인용과 달리 이 조사만 버전 표기가 필요합니다.)

**셋, 같은 코드가 그 앞의 낮은 값을 집습니다.**

{{< rstep variant="fixed" alt="마지막 setWeight:100 을 지운 뒤의 같은 롤백 — 같은 역탐색 코드가 pause 를 지나 setWeight:5 를 집습니다. 요구 파드가 1대라 하한 2대로 충족되고, 대가는 램프 구간 내내 95% 가 되돌리려던 버전으로 가는 것입니다." >}}

③단계에서 역탐색이 `pause`를 지나 `setWeight: 5`를 집습니다. 5%가 요구하는 파드는 1대라 하한 2대로 충족되고 **빨간 칸이 나타나지 않습니다.**

대가는 ④단계에 있습니다. **램프 구간 내내 95%가 되돌리려던 버전으로 계속 갑니다.** 사고 조건에서 약 45초입니다 `≈`. 승격 게이트([1부 §4.5]({{< relref "../01-canary-step-analysisrun/index.md" >}}))가 이미 완전 가용을 요구하므로 롤백 **완료 시각은 변하지 않고** 램프 구간의 분배만 바뀝니다 `✓`.

그래서 이 처방은 단독으로는 조건부입니다. 되돌리려던 버전의 오류율이 충분히 높으면 45초 동안의 95% 손실이 사고 손실을 넘습니다. probe 완화를 같은 변경에 묶으면 2대뿐인 구간이 짧아져 손익분기가 크게 올라갑니다 `Σ`.

### 안전 한계는 남는 가중치가 정한다

제거는 트래픽을 없애지 않고 낮춥니다. 그래서 상한이 생깁니다.

```
안전 파드 수 = minPodsPerReplicaSet ÷ (남는 가중치 %) × 100
```

| 남는 가중치 | 하한 2대로 커버되는 전체 파드 수 |
|---|---|
| 5% | 40대 |
| 1% | 200대 |
| 없음 (역탐색이 `setWeight`를 못 찾음) | 제한 없음 |

식 자체는 코드로 확정됩니다 — `canaryCount = max(ceil(V·R ÷ maxW), M)`이고, 세 항이 각각 `canary.go:350`(조립)·`:334`(`max`)·`:388`(`ceil`)에서 나옵니다 `✓`.

전체 파드가 40대를 넘겨 도는 시간대에는 5%도 초기 2대에 과합니다. 그 경우 앞 rung까지 낮추거나 `minPodsPerReplicaSet`을 올려야 합니다 — 후자는 카나리 단계 파드 수를 늘리는 비용이 있습니다 `Σ`.

구체 반례가 사고 당사자입니다. 주문 도메인의 프런트 API는 KEDA `maxReplicas` 360으로 도므로 **피크 시간대에는 5%도 초기 2대에 과합니다** `✓`. 그 구간은 처방만으로 닫히지 않고 rung 하향이나 `minPods` 상향이 추가로 필요합니다.

### 대안 셋을 같이 닫는다

"마지막 100 제거" 말고 손에 잡히는 노브가 셋 더 있습니다. 셋 다 이 사고 앞에서 어떻게 되는지 코드로 확인했습니다.

| 대안 | 이 사고에 대한 판정 | 왜 |
|---|---|---|
| `setCanaryScale` | **부분적으로 막는다** | 효력을 갖는 유일한 배치가 `steps[0]`이다. 사고 창은 크게 좁아지지만 닫히지 않는다 |
| `minPodsPerReplicaSet` 인상 | **수학적으로는 막지만 대가가 처방을 무의미하게 만든다** | 안전 조건이 `M/R ≥ V/100`이라 V=100이면 M=R, 카나리 구간이 사라진다 |
| `maxTrafficWeight` 하향 | **못 막는다** | 상한이 아니라 분모다. Istio에서는 설정 자체가 거부된다 |
| step analysis로 전환 | **못 막는다** | `rollbackWindow` 스킵이 step·background를 구분하지 않는다 |

`setCanaryScale`이 왜 `steps[0]`뿐인가. 인덱스가 `stepCount`로 점프하면 `currentStep`이 `nil`이 되고 `UseSetCanaryScale`이 즉시 `nil`을 돌려주므로(`canary.go:518-521`) **사고가 일어나는 바로 그 순간에 이 기능은 꺼집니다** `✓`. 살아 있는 창은 점프 직전 한 바퀴뿐이고 그 바퀴의 인덱스는 `resetRolloutStatus`가 0으로 돌려놓은 상태입니다. 그때 `steps[0]`에 `{replicas: 20}`이 있으면 파드가 선행 기동합니다. 그래도 닫히지는 않습니다 — **첫 파드 1대가 Available이 되는 순간 100%가 1/20에 실립니다.** 대가는 `minPodsPerReplicaSet` 인상과 같습니다(램프 구간 총 파드가 R+M에서 2R로). `matchTrafficWeight: true`는 이 기능을 통째로 끄는 스위치입니다(`canary.go:527-528`) `✓`.

`minPodsPerReplicaSet` 인상은 그 자체가 사고 스위치입니다. base 기본값을 올리면 §4의 2026-08-13(170 Rollout 정지)을 다시 켜는 셈입니다 — `RolloutHealthy`가 `newStatus.Replicas == replicas`(`conditions.go:305`)와 `newStatus.UpdatedReplicas == replicas`(`:309`) **두 등식을 함께** 요구하는데, 스냅샷의 `minPodsPerReplicaSet` 오버라이드 **324건 중 321건이 값 1이고 나머지 셋은 0**입니다 — 1보다 큰 오버라이드가 한 건도 없으므로 기본값 인상은 전부와 정면으로 부딪힙니다 `✓`.

`maxTrafficWeight`는 이름이 오해를 부릅니다. 100을 80으로 내려도 상한이 내려가는 게 아니라 **비율의 분모가 바뀝니다**. Istio에서는 아예 쓸 수 없습니다 — `validation.go:300-303`이 nginx와 플러그인 이외에는 `InvalidSpec`으로 거부합니다 `✓`.

step analysis로 옮기는 것도 이 경로에서는 아무 차이가 없습니다. `analysis.go:78`의 스킵 조건이 `isRollbackWithinWindow`를 포함하고 그 `return`(`:82`)이 `reconcileStepBasedAnalysisRun` 호출(`:87`)보다 앞이라 **step이든 background든 똑같이 전부 취소됩니다** `✓`.

### 적용이 두 갈래로 갈리는 이유

여기서 [1부 §2.1]({{< relref "../01-canary-step-analysisrun/index.md" >}})의 한 줄을 다시 꺼내야 합니다. **Helm은 리스트를 교체합니다.** base의 `steps`를 고쳐도 자기 `steps`를 선언한 컴포넌트에는 닿지 않습니다.

스냅샷 기준 `canary.steps` 오버라이드가 **386블록**이고 그중 `setWeight 100`으로 끝나는 형태가 최빈입니다(`setWeight 100 → pause 10m` 118 · `setWeight 100` 단독 77 · `setWeight 100 → pause 3m` 39 …) `✓`. base 수정과 오버라이드 수정은 **서로 독립인 별개 작업**입니다.

숫자를 인용할 때 모집단을 붙여야 합니다. 이 386블록은 `platform/service-manager/*/*.yaml`과 `service/*/values/*.yaml`을 파싱한 **전 환경 합산**이고 술어 구분이 없습니다. 같은 스냅샷을 술어별로 다시 세면 — 마지막 스텝이 `setWeight: 100`인 블록 **92**(prod 18), 마지막 `setWeight` 값이 100인 블록 **310**(prod 50), 점진 캐너리(스텝에 `setWeight`가 둘 이상)이면서 마지막 값이 100인 블록 **25**(prod 20)입니다 `✓`. 사내에서 먼저 돌던 집계('44블록 중 39개')는 이 셋을 섞었고 모집단도 prod 한정이었습니다 — **386과 같은 집합으로 읽으면 안 됩니다** `≈`.

형태에 따라 처방이 다릅니다.

- 잔여 rung이 낮은 형태(`[5, 100]`, `[1, 5, 100]`) — 100만 지우면 끝납니다
- 잔여 rung이 높은 형태(`[10, 50, 100]`, `[5, …, 80, 100]`) — 지우면 역탐색이 50이나 80을 집습니다. 사실상 전량 전환이라 제거 효과가 없고 앞 rung을 함께 낮춰야 합니다 `Σ`
- `[100]` 단독 형태(77블록) — 이름과 달리 **정상 배포에서는 이미 "전량 기동 후 전환"입니다.** index 0에서 역탐색 루프가 `i = -1`로 시작해 한 번도 돌지 않아 가중치가 초기값 0에 머물고(`trafficrouting.go:176`·`:247`) canary 전량이 Available이 되어 `atDesiredReplicaCount`가 참이 된 뒤에야 100이 붙습니다. 지워서 `steps: []`가 되면 `shouldFullPromote`가 `stepCount == 0`으로 통과하는데(`sync.go:956`), 그 앞의 게이트(`:945`)가 여전히 canary 전량 가용을 요구하므로 **배포 소요는 늘지 않습니다** `✓`. 바뀌는 것은 롤백 경로뿐입니다 — 인덱스가 끝으로 던져지면 역탐색이 `steps[0]`의 100을 집으므로 이 형태도 사고에 노출되고 지우면 그 노출이 사라집니다. **가장 안전한 일괄 대상입니다.**
- `steps: []`(48블록) — 역탐색이 집을 `setWeight`가 없으므로 이 문제에서 자유롭습니다

지운 100이 새 블록으로 다시 들어오는 것을 막는 장치도 같이 필요합니다 — 마지막 rung을 검사하는 CI 린트(예: `w_last ≤ 3 × w_first` 또는 위 안전식)가 어떤 values 수정보다 먼저 가야 합니다 `Σ`.

base를 고치는 쪽은 머지가 끝이 아닙니다. 실제 전파에는 ECR publish → 서비스 차트 버전 bump → GitOps 레포 `targetRevision` 동기화가 남아 있고 base dependency를 선언한 **239곳이 전부 같은 버전(`3.0.13`)에 고정**돼 있습니다 `✓`. 그래서 버전 bump 자체가 **서비스별 점진 적용(웨이브) 수단**으로 쓰입니다 — 단점이 아니라 도구입니다.

**현재 적용 상태**: 2026-08-27 기준 이 처방은 **아직 어떤 서비스에도 적용되지 않았습니다** `✓(2026-08-27 기준)`. base chart를 `3.0.13` → `3.0.14-rc.0`으로 올리는 차트 PR이 CI(helm-lint·helm-template·review) 통과 상태로 대기 중이고 아래 §6의 스테이지 드릴도 아직 실행하지 못했습니다(플러그인 미설치·클라우드 자격 재인증 필요).

## 2. `dynamicStableScale: true`는 답이 아니다

후보로 거론될 만한 옵션이라 미리 닫아 둡니다. 기각 사유가 셋입니다.

**하나, 트리거를 막지 못합니다.** 가중치 결정 경로([2부 §4]({{< relref "../02-rollback-window-weight/index.md" >}}))에서 `DynamicStableScale`이 **가중치 상승을 캡하는** 자리는 `:233`, 곧 `:229`의 **`PromoteFull` 갈래 안**뿐입니다 `✓`. 같은 함수의 `:187`(stable로 동적 복귀)·`:201`(abort)에도 이 필드가 나오지만 그쪽은 롤백 램프 구간에 걸리지 않습니다 — 그 abort 분기는 아래 '셋'에서 다룹니다. `rollbackWindow` 경로는 `PromoteFull` 갈래에 들어가지 않습니다. 유일한 가용량 검사인 `checkReplicasAvailable`도 stable만 봅니다 — 가중치 100%면 stable 요구치가 0이라 무조건 통과합니다. **Ready 2대에 100%가 실리는 순간은 켜든 끄든 동일합니다** `✓`.

**둘, 웜 스탠바이가 사라집니다.** 가중치가 100으로 뛴 다음 바퀴에 stable 20대가 한 번에 0으로 축소됩니다. `minPodsPerReplicaSet` 하한도 소용없습니다 — [1부 §4.2]({{< relref "../01-canary-step-analysisrun/index.md" >}})의 `count == 0` 분기가 목표 0을 그대로 통과시킵니다 `✓`. 이 사고에서는 노출 구간 내내 stable 20대가 살아 있어 복귀 여지가 있었습니다.

이 항목에는 대칭이 하나 더 붙습니다. `dynamicStableScale`을 켜고 `abortScaleDownDelaySeconds`를 명시하지 않으면 **지연 로직이 아예 꺼집니다** — `shouldDelayScaleDownOnAbort()`가 `usesDynamicStableScaling && !abortDelayWasSet`에서 false로 떨어지므로(`replicaset.go:205-209`) abort 때 canary RS가 가중치와 함께 즉시 줄어듭니다 `✓`. 켜면 stable 쪽 웜 스탠바이만 사라지는 게 아니라 canary 쪽 유예도 같이 사라집니다.

기본값 경로의 타이밍도 통념과 다릅니다. `abortScaleDownDelaySeconds` 기본값 30초는 canary에서 **trafficRouting이 붙어 있을 때만** 적용되고(`defaults.go:220-230`) canary RS 축소는 'abort 후 30초'가 아니라 '**stable이 완전히 가용해진 뒤** 30초'입니다 — 어노테이션이 `stableRS.Status.AvailableReplicas == *spec.Replicas`에서만 붙고 붙기 전에는 매 바퀴 조기 반환으로 canary를 그대로 띄워 둡니다(`replicaset.go:153-162`) `✓`. `abortScaleDownDelaySeconds: 0`은 '지연 없음'이 아니라 '**지연 로직을 쓰지 않음**'입니다(`defaults.go:225-227`이 nil을 돌려주고 그 nil이 `replicaset.go:201-203`에서 false로 떨어집니다) `✓`. 업스트림 문서(`docs/features/scaledown-aborted-rs.md`)는 이 값이 0이면 canary를 축소하지 않는다고 조건 없이 적었지만 실제로 축소를 막는 것은 `UseSetCanaryScale`의 예외 분기이고 그 분기는 steps에 `setCanaryScale`이 있을 때만 값을 냅니다 — 업스트림 e2e 픽스처가 두 필드를 **반드시 함께** 넣어 두는 이유입니다 `Σ`.

**셋, abort 탈출로가 막힙니다.** abort 때는 가중치 계산이 둘로 나뉩니다 — `dynamicStableScale`이 꺼져 있으면 즉시 0(= stable 100%)이고 켜져 있으면 `100 - (100 × stable 가용 / spec.replicas)`입니다. 여기에 **직전에 기록된 가중치보다 올리지 않는 clamp가 하나 더 붙습니다** — 최종값은 `min(계산값, Status.Canary.Weights.Canary.Weight)`이고(`trafficrouting.go:350`) 주석이 "stable 가용성이 flapping해도 가중치를 올리지 않기 위한 것"이라고 적어 뒀습니다 `✓`. 이 사고에서는 직전이 이미 100이라 결론이 그대로입니다. stable이 0대면 그 값이 100이 되어 **트래픽이 깨진 canary에 고정됩니다** `✓`. 수동으로 VirtualService를 돌려도 엔드포인트가 0이라 소용없습니다.

업스트림 메인테이너가 사고 보고(#3020) 워크어라운드로 **이 기능의 회피**를 직접 제시했습니다 — jessesuen, 2023-09-06, 원문은 *"avoid dynamicStableScale feature. When this is disabled, the stable RS will remain 100% scaled during the update"*입니다 `✓(GitHub 조회, 2026-08-27)`. 우리 현재 설정이 이미 그 권고를 만족합니다.

**우리 차트는 이 필드를 렌더하지도 않습니다.** `rollouts.yaml`에 `dynamicStableScale` 문자열이 없고 values 어디에도 선언이 없습니다 `✓`. 지원을 추가한 커밋이 2026-02-27에 있지만 **머지되지 않은 브랜치에만 있습니다** — main의 조상이 아닙니다 `✓`. values에 `dynamicStableScale: true`를 써도 아무 일이 없는 no-op입니다. 켜려면 템플릿부터 고쳐야 합니다.

## 3. 업스트림은 아직 안 고쳤다

다른 곳에서도 겪은 문제이고 발견도 오래됐습니다.

{{< flow src="_flow/3-업스트림-가드-지형.json" />}}

이슈 **#3941** "Traffic is switched before replicaset is fully available when using `rollbackWindow`"가 **2024-11-13**에 열렸고 v1.7.2에서 보고됐습니다. 지금도 **open**입니다 `✓(GitHub 조회, 2026-08-27)`. 보고 문장이 우리 관측과 같습니다 — *"traffic was switched as soon as a single replica in the 'new' replicaset became available. However, the replicaset were still scaling up to match the number of replicas."*

미가용 RS에 100%를 싣는 것이 버그라는 판정은 메인테이너가 직접 내렸습니다. promote-full 경로에서 같은 문제가 보고된 #1580에 jessesuen이 2021-10-18 *"This would be a bug. It is intended to behave the way you expected it to."*라고 답했습니다. 계보는 한 다리를 건너갑니다 — **#1580 자체를 닫은 것은 PR #1663**이고 같은 증상이 계속된다는 후속 이슈 **#1681**(2021-12-03, 본문이 #1580을 참조)은 2022-01-21 머지된 **PR #1683**이 고쳤습니다. 그 PR이 `desiredWeight = (100 × availableCanaryReplicas) / totalReplicas`로 **가용 canary 파드 수에 비례해 트래픽을 점증시키는 캡**을 넣었습니다 `✓(GitHub 조회, 2026-08-27)`.

이 이슈는 #3020·#1580·#1681·#3372로 이어지는 패밀리에 속합니다 — **2021년부터 이어지는 구조 결함입니다.** 이 묶음은 우리 관측이 아니라 업스트림 메인테이너의 분류입니다: kostis-codefresh가 2026-07-23 PR #4852 리뷰에서 이 네 개를 직접 링크했습니다 `✓(GitHub 조회, 2026-08-27)`.

가장 강한 외부 근거는 재발 보고입니다. #3372(2024-02, v1.6.0 재현)는 PR **#3878**(2025-03-10 머지)이 `checkReplicasAvailable` 가드레일로 고쳤습니다 — stable RS가 현재 캡된 트래픽 비율만큼 replica를 유지하는지 검증하는 방식입니다. **그런데 2026-04-10 theurichde가 #3941에 이렇게 적었습니다** — *"Unfortunately, #3878 didn't fix the issue. We hit the same problem in production again. … We are running Argo Rollouts v1.8.3 at the moment."* 근본 원인 분석도 우리와 같습니다: `isRollbackWithinWindow()`가 `currentStepIndex`를 `stepCount`로 밀어 desired weight 100%를 만드는 '가중치 결정'과 `ensureSVCTargets`가 `IsReplicaSetPartiallyAvailable`(1대 이상)만 보고 서비스 셀렉터를 전환하는 '셀렉터 결정'이 **서로를 확인하지 않습니다**. *"#3878 added checkReplicasAvailable … but it only guards the stable RS … The canary RS capacity is never validated against its assigned weight."* — [2부 §5]({{< relref "../02-rollback-window-weight/index.md" >}})의 우리 판정과 같은 문장입니다 `✓(GitHub 조회, 2026-08-27)`. **우리보다 한 패치 위인 v1.8.3에서도 재발했다**는 사실이 버전 업그레이드가 답이 아니라는 판단을 코드 대조 없이 증명합니다.

그동안 붙은 가드가 넷인데 전부 이 구멍의 옆을 지킵니다. **우리 v1.8.2에 실제로 있는 것은 그 넷 중 셋뿐입니다.**

| 가드 | 무엇을 막나 | 왜 이 구멍에 안 걸리나 |
|---|---|---|
| `:217` `AvailableReplicas == 0` | canary가 **한 대도 없을 때** 가중치를 주지 않는다 | 2대는 0이 아니다 |
| `:266` `checkReplicasAvailable(stableRS, …)` (#3878) | stable이 남은 트래픽을 감당하는지 | canary를 보지 않고, 100%면 stable 요구가 0 |
| `:229` `PromoteFull` 동결 (#1683) | promote-full에서 미가용 상태의 가중치 상승 | `rollbackWindow`는 이 필드를 켜지 않는다 |
| #4639 조기 `SetWeight(0)` **(master 전용, v1.8.2에 없음)** | 새 canary가 **0대**일 때 hash 전환 전에 가중치를 0으로 리셋 | 역시 `AvailableReplicas == 0` 조건 |

그 빈 자리를 **PR #4852** "fix(trafficrouting): cap canary weight to available replicas on the final step. Fixes #3941"가 메웁니다.

머지된 뒤 우리 처방이 어떻게 되는지는 이 PR이 무엇을 하는지에 달렸습니다. diff는 `rollout/trafficrouting.go`에 `weightFromAvailableReplicas()` 헬퍼를 신설해 **네 곳**의 중복 계산을 대체합니다(원 리뷰 요구 전에는 한 곳이었습니다). `rollbackWindow` 때문에 마지막 스텝에서 desired weight가 100%로 튀면 **canary의 가용 replica 수에 비례해 가중치를 캡**하고 `ReplicaProgressThreshold` 허용치는 보존합니다. PR 본문도 문제를 이렇게 규정합니다 — *"the existing zero-replica reset only fires when the canary has zero available replicas—not when it has some-but-all."* 즉 위 표 1행(`:217`)과 4행(#4639)이 왜 이 구멍에 안 걸리는지를 업스트림도 같은 말로 적어 뒀습니다 `✓(GitHub 조회, 2026-08-27)`. 캡을 역탐색 결과 쪽에 넣는 방식이므로 머지된 뒤에도 우리 처방을 유지해서 해로울 것이 없습니다.

상태는 이렇습니다. **2026-07-15에 열렸고 2026-07-23 kostis-codefresh가 CHANGES_REQUESTED(헬퍼를 나머지 호출부에도 적용) → n1koo가 같은 날 네 곳 전면 치환 → 2026-07-24 APPROVED까지 갔습니다.** 그러나 2026-08-27 조회 시점에 **여전히 open·미머지**입니다(`merged=false`, `mergeable_state=clean`, assignee zachaller, 최근 활동 2026-08-24) `✓(GitHub 조회, 2026-08-27)`. CI는 unit 2,583건 전부 통과지만 별도 e2e 리포트에 **2건 실패**가 남아 있어 '전부 통과'로 단정할 수 없습니다 `?`(이 PR의 회귀인지 기존 flaky인지 확인하지 못했습니다).

**버전 업그레이드는 답이 아닙니다.** **역탐색 블록**을 v1.8.2와 master(2026-08-25)에서 직접 대조했습니다 — **바이트 단위로 완전히 같습니다**(diff 0줄) `✓`. 달라진 것은 그 블록 **밖**입니다: master는 `checkReplicasAvailable` 앞에 설명 주석 두 줄을 붙였을 뿐이고 넘기는 인자는 여전히 `c.stableRS` 하나입니다 `✓`.

단, 같은 파일의 **abort 가중치 함수는 그렇지 않습니다.** master는 `calculateDesiredWeightOnAbortOrStableRollback`을 전면 재작성해 `dynamicStableScale` abort에서 계산식 한 방이 아니라 `setWeight` 사다리를 역순으로 한 칸씩 내려가고(v1.8.2에 없는 `GetDesiredCanaryWeight`를 신설) stable이 아직 스케일업 중이면 현재 가중치를 유지합니다 `✓`. **§2가 서술하는 abort 동작은 v1.8.2 한정입니다.**

master에서 이 근처에 세 변화가 있는데 어느 쪽도 이 구멍을 메우지 않습니다.

- 스킵 조건이 `isFastRollback()`으로 묶였습니다 — `rollbackWindow`가 세 트리거 중 하나가 됐고 우리 경로의 의미는 같습니다 `✓`
- `ReplicaProgressThreshold`(PR #4341, #4480)가 생겼습니다 — **현재 형태에서는 중립입니다.** 마지막 `setWeight: 100`이 남아 있으면 임계를 못 채우면 역탐색이 100을 집고 채우면 `else` 갈래가 `MaxTrafficWeight` 100을 실어 어느 쪽이든 100입니다 `✓`. **나빠지는 것은 §1 처방을 적용한 뒤입니다** — 특히 `type: Pods, value: 2` 조합은 마지막 100이 없어도 `ReplicaProgressThresholdMet`가 `AvailableReplicas >= 2`로 참이 되어(`canary.go:56`) **가용 2대에 100%를 실어 이 사고를 그대로 재현합니다** `✓`. v1.8.2에는 없습니다
- #4639의 조기 `SetWeight(0)` 블록이 `UpdateHash` 앞에 들어왔습니다(master `:293-304`). 조건이 `AvailableReplicas == 0`이라 2대에는 걸리지 않고 **우리가 쓰는 v1.8.2에는 이 블록 자체가 없습니다** `✓`. 가중치 값을 바꾸는 변경이 아니라 `SetWeight` 호출을 `UpdateHash` 앞으로 당기는 순서 수정입니다(커밋 `073a6c9`, 2026-03-12)

## 4. `minPodsPerReplicaSet`이 왜 2였나

사고의 절반은 "canary RS가 2대"라는 사실입니다. 그 2는 우연이 아니고 그 값 하나가 1년 3개월 동안 정반대 증상으로 계속 재발했습니다.

{{< flow src="_flow/4-같은-하한-두-방향.json" />}}

`CheckMinPodsPerReplicaSet()`의 두 조건절([1부 §4.2]({{< relref "../01-canary-step-analysisrun/index.md" >}}))이 각각 한 방향을 만듭니다.

**위로 막히는 방향** — `desired`가 1인데 하한이 2면 canary RS가 2대에 고정되고 stable은 `spec.replicas` 그대로 1대입니다. Rollout은 desired 1 대비 replica 3을 보고합니다. `RolloutHealthy`가 `UpdatedReplicas == spec.replicas`를 요구하므로 **영영 성립하지 않고** `progressDeadlineSeconds`가 지나면 `ProgressDeadlineExceeded`로 `Degraded`가 됩니다 `✓`.

**아래로 새는 방향** — `desired`가 0인데 하한이 1이면 `count == 0` 분기를 타지 못해 하한 1이 그대로 적용됩니다. 총 목표가 0인데 하한이 1이라 **스케일 업다운이 반복됩니다** `✓`.

같은 원인, 서로 닮은 데가 없는 두 증상입니다.

### 타임라인

| 시점 | 무슨 일이 있었나 |
|---|---|
| 2025-05-21 | `minPodsPerReplicaSet: 2`를 base 차트에 도입 `✓` |
| 2025-06-27 | 같은 사람이 `rollbackWindow.revisions: 3`과 `revisionHistoryLimit: 4`를 도입 `✓` |
| 2025-08-24 | DestinationRule canary/stable subset 도입. 그 전까지는 별도 K8s Service 기반 라우팅이었다 `✓` |
| 2025-08-26 ~ 09-02 | **일주일 사이 14개 커밋**(중복 브랜치 커밋을 접으면 11). 저자 다섯 명이 서로 다른 서비스 다섯 곳 이상에서 같은 문제를 독립적으로 발견하고 각자 고쳤다 `✓` |
| 2025-09 ~ 2026-06 | 같은 패턴이 최소 10여 건 더 재발 `✓` |
| 2026-07-20 | 비용 절감으로 비프로드 KEDA min/max 재튜닝 — `int 2 / int-1 1 / stage 1`. 157파일 변경, 노드 7→5 `✓` |
| 2026-08-04 | 광고 도메인 int 컨슈머 4개에서 **아래로 새는 방향**이 처음 문서화됨. `replicas: 0`으로 내렸는데 파드가 생성·삭제를 반복. 처방은 `minPodsPerReplicaSet: 0` `✓` |
| 2026-08-07 | 7월 재튜닝의 결과가 드러남 — 두 환경의 Rollout이 canary 5%에서 승격하지 못하고 17일간 `Degraded` 고정 `✓` |
| 2026-08-10 | base 차트 `3.0.13-rc.0` → GA `3.0.13` 승격. **전체를 한꺼번에 재배포하면서 잠복해 있던 조합을 동시에 노출** `✓` |
| 2026-08-12 | **같은 서비스의 prod 컨슈머 2개**를 `replicas: 1`로 올릴 때 `minPodsPerReplicaSet: 1`을 대칭적으로 함께 넣음 — 8일 전 학습을 미리 적용 `✓` |
| 2026-08-13 | **170개 Rollout이 동시에 멈춘 것을 일괄 수정.** 77파일, 4-레이어 렌더를 before/after로 전부 대조해 변경이 `2 → 1` 뿐임을 검증 `✓` |
| 2026-08-21 | 이 글의 사고 `✓` |

읽을 것이 넷 있습니다.

**비용 최적화가 3주 뒤 배포 파이프라인을 멈춰세웠습니다.** 7월의 KEDA 재튜닝은 의도된 비용 변경이었고 되돌리지 않았습니다. 대신 차트 쪽 제약을 `replicas: 1`에 맞췄습니다 — 근본 원인이 아니라 제약을 고친 판단이고 그게 맞았습니다.

**평범한 버전 승격이 잠복 사고를 한꺼번에 깨웠습니다.** 8월 10일의 GA bump는 차트 버전 한 줄 변경입니다. 그 한 줄이 전체 재배포를 유발해 곳곳에 있던 `replicas: 1` 워크로드를 일제히 노출시켰습니다. 개별 사고들이 누적되다 한 번의 배포로 전부 터진 순간입니다.

**일주일에 열네 번, 서로의 커밋을 보지 못한 채 같은 수정이 반복됐습니다.** 2025년 8월 말의 그 주가 신호였습니다. 개별 오버라이드로 해결하는 동안 함대 차원의 판단이 미뤄졌습니다.

**base 기본값 2는 아무도 낮추지 않았습니다** `✓`. 대응은 항상 개별 워크로드에 예외를 쌓는 방식이었습니다. **어느 레이어에 패치를 심을지가 6일 사이에 정반대로 뒤집혔습니다.** 2026-08-07의 단일 서비스 수정은 "레이어 3(`platform/service-manager`)이 **인프라팀** 일괄 스윕 관할이라 덮어쓰일 수 있다"는 이유를 커밋 본문에 적고 레이어 2(`service/*/values`)를 골랐습니다. 6일 뒤 2026-08-13의 170개 일괄 수정은 77파일 **전부를 레이어 3에** 심었습니다 — 대상을 ArgoCD Application의 `valueFiles`에서 역산했기 때문입니다 `✓`. 같은 결함을 6일 간격으로 두 레이어에 심었다는 것이 소유권 문제의 실체입니다.

짚어 둘 반례가 있습니다: 일괄 수정 시점에 **이미 83개 Rollout이 같은 조합(`replicas: 1` + 하한 1)으로 건강하게 돌고 있었습니다** `✓`. 값 자체가 틀린 것이 아니라 `desired`와의 관계가 틀렸고 그 관계를 CI가 검사하지 않은 것이 실제 결함입니다.

## 5. abort에서 빠져나오는 세 가지

§7의 런북이 `promote --full`을 탈출구로 명시하는데 그 옆의 수단들이 무엇을 하는지를 같이 적어 둡니다. 인시던트 중에 잘못 고르면 사고를 한 번 더 냅니다.

| 수단 | 무엇을 패치하나 | 인덱스가 어디로 | 무엇이 다시 돌아오나 |
|---|---|---|---|
| `retry` | `{"status":{"abort":false}}`만 | **0** | AnalysisRun이 다시 돌고 다시 abort된다 |
| `promote --full` | `{"status":{"promoteFull":true}}`, 그것도 `CurrentPodHash != StableRS`일 때만 | `stepCount` | 없음 (스텝·analysis 전부 건너뜀) |
| 플래그 없는 `promote` | `spec.paused`·`pauseConditions`·`currentStepIndex` | **abort를 벗어나지 못한다** | — |
| `undo` | `spec.template`을 JSONPatch replace | `resetRolloutStatus`가 리셋 | 없음 (abort 해제는 부수효과) |

`retry`는 최소 수단이지만 **스텝을 0부터 다시 밟습니다** — abort 중에는 컨트롤러가 `CurrentStepIndex`를 0으로 눌러 두기 때문입니다(`canary.go:407-413`) `✓`. 그래서 인시던트 중 `retry`는 [2부 §1]({{< relref "../02-rollback-window-weight/index.md" >}})의 "롤백이 스스로를 abort"를 그대로 다시 유발합니다. 플래그 없는 `promote`는 더 나쁩니다 — 패치 상수 목록 전체에 "abort" 문자열이 없어서 `status.abort`가 남고 그 상태로 `canary.go:407`이 인덱스를 0으로 되돌리고 조기 반환합니다 `✓`. `promote --full`은 컨트롤러 쪽에서 pause 해제·`RemoveAbort`·인덱스를 끝으로 던지기를 한꺼번에 합니다(`canary.go:390-396`) `✓`.

GitOps 관점에서는 `undo`와 나뉩니다. `promote --full`은 status를 만지므로 선언할 수 없고 `undo`는 `spec.template`을 바꾸므로 선언할 수 있습니다 — abort 해제는 `PodTemplateOrStepsChanged` → `resetRolloutStatus()` 안의 `RemoveAbort()`로 일어나는 부수효과입니다(`sync.go:889-891`) `✓`. **`RolloutAbortedReason`으로 `Degraded`가 된 경우에는 자동 회복 경로가 없습니다** — `RemoveAbort()` 호출은 다섯 군데뿐이고 그중 넷이 사람의 행위 또는 승격 완료이며 유일한 컨트롤러 자율 해제는 '이미 완전 승격된 롤아웃'이라는 코너 케이스입니다(`controller.go:572-575`) `Σ`. 같은 `Degraded`라도 `TimedOutReason` 쪽은 자동으로 풀립니다.

## 6. 검증 — 롤백 드릴 두 레인

§8이 "회귀 테스트가 필요하다"로 끝나는데 그 회귀 테스트의 최소 형태가 이 드릴입니다. 적용 경로가 두 갈래이므로(§1) 드릴도 두 레인입니다.

| 레인 | 경로 | 확인하는 것 |
|---|---|---|
| A | 서비스 values 오버라이드 | 롤백 시 실제 가중치가 100에서 5로 바뀌는가 |
| B | base chart | 렌더 등가성과 전파 경로가 의도대로인가 |

**레인 A**는 스테이지의 한 서비스(도메인 API)를 씁니다. 실제 설정이 `[setWeight 5, pause 10s, setWeight 100]`, replicas 2이고 `minPodsPerReplicaSet`은 base 기본값 2가 아니라 **1로 내려놨습니다** — 처방 전후를 비교하기에 가장 단순한 형태입니다. 순서는 BEFORE 롤백으로 weight 100을 관측 → `steps`를 3개에서 2개로 줄이는 값 수정 → AFTER 롤백으로 weight 5를 관측 → `promote --full`로 탈출 시연입니다.

**레인 B**는 트래픽 없이 검증합니다. `helm template` 렌더 등가성 확인 → 상속 서비스 한 곳으로 전파 확인 → 첫 실배포 관찰. 여기에 붙는 주의문이 §1의 전파 메커니즘과 짝입니다 — **차트 PR 머지만으로는 아무 서비스도 바뀌지 않습니다.**

드릴이 확인할 수 없는 것부터 적어 둡니다. **스테이지에서는 이 사고의 파드 산술이 애초에 재현되지 않습니다.** 스테이지 전 서비스가 `maxReplicas: 1`로 묶여 있고(`service-manager/stage` 130행 중 128행) replicas 2~3이 상한이라 "20대 중 2대가 전량을 받는다"는 비율 자체가 만들어지지 않습니다 `✓`. 드릴이 재현하는 것은 **가중치 값(weight 100 대 5)이고 파드 산술 피해가 아닙니다** — 이 구분을 빼면 드릴 결과가 과대해석됩니다.

## 7. 정리

[1부]({{< relref "../01-canary-step-analysisrun/index.md" >}})의 세 장치가 롤백에서 각각 어떻게 되는지로 요약합니다.

| 1부의 안전장치 | 롤백에서 |
|---|---|
| 인덱스를 순차로 밟는다 | `rollbackWindow`가 끝으로 던진다 → 역탐색이 **마지막** `setWeight`를 집는다 |
| `atDesiredReplicaCount` 게이트 | 여전히 작동한다. 다만 그 결과가 "이전 가중치"이고 그게 100이다 |
| AnalysisRun | 취소된다. 그래야 롤백이 취소되지 않는다 — 이건 의도된 것이다 |

셋째 줄이 첫째 줄의 원인입니다. **롤백을 살리려고 넣은 기능이 롤백의 가중치를 부쉈습니다.** 둘이 같은 판정 함수를 공유하기 때문이고 `promote --full`은 같은 판정을 공유하면서도 가중치 갈래가 따로 있어서 살아남았습니다.

지금 할 수 있는 일과 못 하는 일:

- 할 수 있다 — 마지막 `setWeight: 100` 제거. 순서는 `[100]` 단독 형태(77블록, 배포 동작이 바뀌지 않으므로 가장 안전)부터, 그다음 잔여 rung이 낮은 형태, 잔여 rung이 높은 형태는 앞 rung 하향을 묶어야 하므로 마지막입니다. 함께 갈 것 — probe 완화를 같은 변경에 묶기, 마지막 rung CI 린트, 5% 정체 알람, `promote --full`을 탈출구로 명시한 런북(§5)
- 하지 말 것 — `dynamicStableScale: true`(악화, 그리고 차트가 렌더하지 않는다), `rollbackWindow` 제거([2부 §1]({{< relref "../02-rollback-window-weight/index.md" >}})의 롤백 취소가 돌아온다), 버전 업그레이드로 해결(master도 같고 v1.8.3에서 재발 보고가 있다), 인시던트 중 `retry`나 플래그 없는 `promote`(§5), 그리고 **처방 적용 뒤에 `ReplicaProgressThreshold`를 `type: Pods`로 켜는 것**(§3 — 마지막 100이 없어도 2대에 100%가 실린다)
- 기다려야 한다 — PR #4852. 머지되면 이 처방은 되돌릴 수 있고 캡이 역탐색 결과 쪽에 붙으므로 그때도 유지해서 무해합니다

## 8. 남는 위험

이 처방이 성립하는 근거는 **`:245`가 `:255`·`:261`보다 먼저 평가된다는 분기 순서**입니다. 상류에서 그 순서가 바뀌면 알람 없이 깨집니다. 컨트롤러 버전을 올릴 때마다 이 롤백 시퀀스를 고정하는 회귀 테스트가 필요합니다 `Σ` — 최소 형태는 §6입니다.

함대에 컨트롤러 두 버전이 공존한다는 이야기가 있습니다 — `cluster-bootstrap` 계열은 v1.8.2, 구 `cluster-bootstrap-v2` 계열은 v1.7.1이라는 것입니다. **확증도 반증도 하지 못했습니다** `?`. 이 편의 모든 코드 인용은 v1.8.2 기준이므로 구 클러스터가 실제로 남아 있다면 같은 차트 값이 두 컨트롤러에서 같게 동작하는지를 별도로 확인해야 합니다. 클러스터별 차트 버전을 실제로 세어 보는 것이 남은 작업입니다.

← [02 롤백이 스스로를 취소한다]({{< relref "../02-rollback-window-weight/index.md" >}})
