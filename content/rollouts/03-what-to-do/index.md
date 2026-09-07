---
title: "03 그래서 무엇을 할 것인가"
date: 2026-08-28
lastmod: 2026-08-28
weight: 3
---

# 그래서 무엇을 할 것인가

[2부]({{< relref "../02-rollback-window-weight/index.md" >}})에서는 기전을 밝히는 데까지 갔습니다. `rollbackWindow`가 인덱스를 스텝 맨 끝으로 밀어 버리면 역탐색은 방금 건너뛴 마지막 `setWeight: 100`을 도로 주워 옵니다. 가용량 게이트마저 canary 쪽은 쳐다보지 않는다는 것까지 확인했습니다.

여기서는 무엇을 고칠지를 씁니다. 답 자체는 한 줄을 지우는 것으로 끝납니다. 나머지 전부는 **그 한 줄이 왜 안전하고 무엇을 대가로 내는지**를 따지는 데 씁니다. `minPodsPerReplicaSet`도 빼놓을 수 없습니다. 사고의 절반은 "canary RS가 2대"라는 사실이었고 그 2가 어디서 왔는지 캐 들어가면 1년 3개월이 나옵니다.

## 먼저 결론

- **canary steps에서 마지막 `setWeight: 100`을 지우는 것, 그게 처방입니다.** 100%까지 올라가는 데 그 스텝이 하는 일은 없습니다. 스텝을 전부 밟고 나면 컨트롤러가 `MaxTrafficWeight`를 알아서 쓴다고 소스 주석에 그대로 적혀 있습니다 `✓`
- 업스트림 공식 예제와 문서를 전부 세어 봤습니다. **램프 상한이 100에서 끝나는 블록은 62개 가운데 3개**, 그것도 셋 다 ambassador 계열입니다 `✓`. "빼라"는 권고도, "안 쓴다"는 관행도 업스트림에는 없습니다. 소스를 직접 읽고 우리가 세운 판단입니다 `Σ`
- **파드가 더 뜨거나 덜 뜨는 일은 없습니다.** RS 크기는 스텝 목록과 상관없는 다른 경로가 정합니다 `✓`
- 내주는 것이 하나 있습니다. **램프가 도는 동안 트래픽 95%가 되돌리려던 그 버전으로 갑니다.** 사고 조건에 대입하면 45초 남짓입니다 `≈`. 롤백이 끝나는 시각만큼은 밀리지 않습니다 `✓`
- 대신 상한이 걸립니다. `안전 파드 수 = minPodsPerReplicaSet ÷ 남는 가중치% × 100` — 5%를 남겨 두는 형태라면 40대까지가 한계입니다 `✓`
- **적용은 한 갈래로 끝나지 않습니다.** Helm이 리스트를 통째로 갈아 끼우는 바람에 base를 고치는 일과 오버라이드를 고치는 일이 서로 다른 작업이 됩니다. 스냅샷을 세어 보면 `steps` 오버라이드만 386블록입니다 `✓`
- `dynamicStableScale: true`로는 해결되지 않습니다. 트리거를 못 막는 것은 물론이고 웜 스탠바이를 지우며 abort 탈출로까지 닫아 버립니다. **우리 차트가 그 필드를 렌더하지도 않습니다** `✓`
- **업스트림도 아직 손을 못 댔습니다.** PR #4852는 2026-07-15에 올라와 2026-07-24 APPROVED를 받고도 2026-08-27 조회 시점까지 머지되지 않은 채입니다 `✓(GitHub 조회, 2026-08-27)`. 역탐색 블록만 놓고 보면 v1.8.2와 master(2026-08-25)의 로직이 같습니다. **master가 갈아엎은 것은 abort 가중치 함수 하나입니다** `✓`
- `minPodsPerReplicaSet: 2`는 2025-05-21에 들어왔습니다. 그 뒤로 값 하나가 방향에 따라 정반대 증상을 내며 1년 3개월을 버텼습니다 `✓`

## 1. 처방 — 마지막 `setWeight: 100`을 지운다

근거를 셋 댑니다.

**하나, 기능상 없어도 되는 스텝입니다.** [1부 §4.2]({{< relref "../01-canary-step-analysisrun/index.md" >}})에 옮겨 둔 주석이 그렇게 말합니다 — *"컨트롤러는 스텝을 다 지나면 100을 기본값으로 쓴다."* 100%에 닿는 일에 그 스텝은 관여하지 않습니다 `✓`.

**둘, 업스트림 공식 예제가 잡은 램프 상한이 우리보다 낮습니다.** 세는 대상부터 분명히 해 둡니다. 기준은 '마지막 스텝'이 아니라 **'마지막 `setWeight` 값'**입니다. 역탐색 루프(`trafficrouting.go:247-253`)는 `step.SetWeight != nil`만 들여다보고 뒤에 붙은 `pause`는 지나쳐 버리니 `[…, 100, pause]`에서도 결국 100을 집어옵니다 `✓`. 그 기준을 들고 v1.8.2의 `examples/`에서 canary `steps`가 달린 매니페스트 **19개**를 훑었습니다. `docs/`에서는 `steps:` 블록 **43개**를 봤고요(`docs/` 하위 전 파일 기준이며 `.md`만 세면 37개). 마지막 `setWeight` 값이 100인 사례는 **3건**에 그칩니다. ambassador 예제 하나, getting-started/ambassador 문서 둘입니다. 나머지는 `setWeight: 80`이나 `setWeight: 20` 같은 낮은 상한에서 램프를 멈춥니다 `✓`. 공식 getting-started 예제만 해도 `setWeight: 80` + `pause`로 끝나지만 본문은 "fully transitioned"에 이른다고 서술합니다.

우리에게 불리한 사실 하나를 함께 적습니다. **그 ambassador 예제들 역시 이 사고에 그대로 노출되는 형태입니다.** 결국 이 처방을 떠받치는 것은 업스트림의 관행이 아니라 역탐색 코드를 뜯어본 결과입니다 `Σ`.

(v1.8.2 안에서 `setWeight: 100`이 등장하는 곳은 앞서 말한 셋뿐이고 셋 모두 뒤에 `pause`가 따라붙습니다. `hpa-support` 문서를 열면 v1.8.2 쪽에는 `setWeight`가 **한 줄도 나오지 않습니다.** 그 예시는 master 전용이고 master의 `docs/proposals/resource-plugin.md`에는 마지막 스텝이 `setWeight: 100`인 블록이 다섯 개 있습니다. 이 편을 통틀어 버전을 따로 표기해야 하는 조사는 이것 하나입니다.)

**셋, 그 코드가 이번에는 앞쪽의 낮은 값을 집어옵니다.**

{{< rstep variant="fixed" alt="마지막 setWeight:100 을 지운 뒤의 같은 롤백 — 같은 역탐색 코드가 pause 를 지나 setWeight:5 를 집습니다. 요구 파드가 1대라 하한 2대로 충족되고, 대가는 램프 구간 내내 95% 가 되돌리려던 버전으로 가는 것입니다." >}}

③단계를 보면 역탐색이 `pause`를 그냥 지나쳐 `setWeight: 5`에 멈춥니다. 5%가 부르는 파드는 1대이니 하한 2대가 이미 그것을 덮고 **빨간 칸은 뜨지 않습니다.**

④단계가 청구서입니다. **램프가 도는 내내 95%가 되돌리려던 버전으로 흘러갑니다.** 사고 조건에 대입하면 45초쯤 됩니다 `≈`. 승격 게이트([1부 §4.5]({{< relref "../01-canary-step-analysisrun/index.md" >}}))가 완전 가용을 이미 요구하고 있어서 롤백 **완료 시각은 그대로 두고** 램프 구간의 트래픽 배분만 뒤바뀝니다 `✓`.

그래서 이것 하나만 떼어 쓰면 조건부 처방입니다. 되돌리려던 버전의 오류율이 높을수록 45초 동안 잃는 95%가 사고로 잃는 것을 앞지릅니다. probe 완화를 한 변경에 같이 태우면 2대로 버티는 구간이 짧아지고 손익분기가 크게 올라갑니다 `Σ`.

### 안전 한계는 남는 가중치가 정한다

지운다고 트래픽이 0이 되지는 않습니다. 낮아질 뿐입니다. 그 자리에서 상한이 생깁니다.

```
안전 파드 수 = minPodsPerReplicaSet ÷ (남는 가중치 %) × 100
```

| 남는 가중치 | 하한 2대로 커버되는 전체 파드 수 |
|---|---|
| 5% | 40대 |
| 1% | 200대 |
| 없음 (역탐색이 `setWeight`를 못 찾음) | 제한 없음 |

식을 확정하는 것은 코드입니다. `canaryCount = max(ceil(V·R ÷ maxW), M)`이고 세 항의 출처는 각각 `canary.go:350`(조립), `:334`(`max`), `:388`(`ceil`)입니다 `✓`.

파드가 40대를 넘겨 도는 시간대로 들어가면 5%마저 초기 2대에는 벅찹니다. 그럴 때는 앞 rung을 더 낮추거나 `minPodsPerReplicaSet`을 올리는 수밖에 없는데 뒤쪽 선택은 카나리 단계에서 파드 수가 불어나는 비용을 부릅니다 `Σ`.

사고를 낸 서비스가 곧 그 사례입니다. 주문 도메인의 프런트 API는 KEDA `maxReplicas` 360으로 돌아가서 **피크 시간대에는 5%도 초기 2대에 과합니다** `✓`. 이 구간까지 처방 하나로 덮이지는 않습니다. rung을 낮추거나 `minPods`을 올리는 작업이 따라와야 합니다.

### 대안 셋을 같이 닫는다

"마지막 100 제거" 바깥에도 만질 수 있는 노브가 셋 있습니다. 이 사고를 만났을 때 셋이 각각 어떻게 되는지 코드로 확인했습니다.

| 대안 | 이 사고에 대한 판정 | 왜 |
|---|---|---|
| `setCanaryScale` | **부분적으로 막는다** | 효력을 갖는 유일한 배치가 `steps[0]`이다. 사고 창은 크게 좁아지지만 닫히지 않는다 |
| `minPodsPerReplicaSet` 인상 | **수학적으로는 막지만 대가가 처방을 무의미하게 만든다** | 안전 조건이 `M/R ≥ V/100`이라 V=100이면 M=R, 카나리 구간이 사라진다 |
| `maxTrafficWeight` 하향 | **못 막는다** | 상한이 아니라 분모다. Istio에서는 설정 자체가 거부된다 |
| step analysis로 전환 | **못 막는다** | `rollbackWindow` 스킵이 step·background를 구분하지 않는다 |

`setCanaryScale`이 왜 `steps[0]`에 그치는가. 인덱스가 `stepCount`로 뛰는 순간 `currentStep`이 `nil`이 되고 `UseSetCanaryScale`이 지체 없이 `nil`을 돌려줍니다(`canary.go:518-521`). **사고가 벌어지는 그 시점에 기능이 꺼져 버립니다** `✓`. 기능이 열려 있는 창은 점프 직전 reconcile 한 번이고 그 시점의 인덱스는 `resetRolloutStatus`가 0으로 되돌린 값입니다. 마침 `steps[0]`에 `{replicas: 20}`이 걸려 있으면 파드가 앞당겨 뜹니다. 그래도 구멍은 그대로입니다. **첫 파드 한 대가 Available로 바뀌는 순간 100%가 1/20에 쏠립니다.** 치르는 값은 `minPodsPerReplicaSet`을 올릴 때와 같습니다(램프 구간 총 파드가 R+M에서 2R로). `matchTrafficWeight: true`는 이 기능 자체를 끄는 스위치입니다(`canary.go:527-528`) `✓`.

`minPodsPerReplicaSet`을 올리는 선택은 그 자체가 사고 스위치입니다. base 기본값을 손대면 §4의 2026-08-13(170 Rollout 정지)이 되살아납니다. `RolloutHealthy`가 `newStatus.Replicas == replicas`(`conditions.go:305`)와 `newStatus.UpdatedReplicas == replicas`(`:309`) **두 등식을 한꺼번에** 요구하는 탓입니다. 스냅샷에 잡힌 `minPodsPerReplicaSet` 오버라이드는 **324건 중 321건이 값 1, 나머지 셋이 0**입니다. 1을 넘는 오버라이드가 하나도 없으니 기본값 인상은 이들 전부와 정면으로 부딪힙니다 `✓`.

`maxTrafficWeight`는 이름이 사람을 헷갈리게 합니다. 100을 80으로 낮춰도 상한이 내려가지 않습니다. **비율의 분모가 바뀔 뿐입니다**. Istio 환경에서는 손에 쥘 수조차 없습니다. `validation.go:300-303`이 nginx와 플러그인을 뺀 나머지를 `InvalidSpec`으로 거부합니다 `✓`.

step analysis 쪽으로 옮겨도 이 경로에서 바뀌는 것은 없습니다. `analysis.go:78`의 스킵 조건이 `isRollbackWithinWindow`를 품고 있고 그 `return`(`:82`)이 `reconcileStepBasedAnalysisRun` 호출(`:87`)보다 먼저 걸립니다. **step이든 background든 결과는 전부 취소로 같습니다** `✓`.

### 적용이 두 갈래로 갈리는 이유

[1부 §2.1]({{< relref "../01-canary-step-analysisrun/index.md" >}})에 적어 둔 한 줄을 여기서 다시 씁니다. **Helm은 리스트를 교체합니다.** base의 `steps`를 손봐도 자기 `steps`를 따로 선언해 둔 컴포넌트까지는 닿지 못합니다.

스냅샷에 잡힌 `canary.steps` 오버라이드가 **386블록**입니다. 그중 `setWeight 100`으로 끝나는 형태가 제일 흔합니다(`setWeight 100 → pause 10m` 118 · `setWeight 100` 단독 77 · `setWeight 100 → pause 3m` 39 …) `✓`. base를 고치는 작업과 오버라이드를 고치는 작업은 **서로 독립인 별개 작업**입니다.

숫자를 옮길 때는 어느 모집단에서 나왔는지를 같이 적어야 합니다. 386블록의 출처는 `platform/service-manager/*/*.yaml`과 `service/*/values/*.yaml`을 파싱한 **전 환경 합산**이고 술어를 따로 나누지 않은 값입니다. 술어로 갈라 같은 스냅샷을 다시 세면 숫자가 이렇게 흩어집니다. 마지막 스텝이 `setWeight: 100`인 블록 **92**(prod 18), 마지막 `setWeight` 값이 100인 블록 **310**(prod 50), 점진 캐너리(스텝에 `setWeight`가 둘 이상)면서 마지막 값이 100인 블록 **25**(prod 20) `✓`. 사내에서 앞서 돌던 집계('44블록 중 39개')는 셋을 뒤섞은 데다 모집단까지 prod에 갇혀 있었습니다. **386과 한 집합으로 읽으면 안 됩니다** `≈`.

형태가 다르면 처방도 달라집니다.

- 잔여 rung이 낮은 형태(`[5, 100]`, `[1, 5, 100]`) — 100만 걷어 내면 그것으로 끝입니다
- 잔여 rung이 높은 형태(`[10, 50, 100]`, `[5, …, 80, 100]`) — 지우면 역탐색이 50이나 80을 대신 집습니다. 사실상 전량 전환이라 제거한 보람이 없고 앞 rung을 함께 낮추지 않으면 소용이 없습니다 `Σ`
- `[100]` 단독 형태(77블록) — 이름이 주는 인상과 달리 **정상 배포에서는 이미 "전량 기동 후 전환"으로 돕니다.** index 0에서는 역탐색 루프가 `i = -1`로 시작해 한 번도 실행되지 못하고 가중치가 초기값 0에 머뭅니다(`trafficrouting.go:176`·`:247`). canary가 전량 Available이 되고 `atDesiredReplicaCount`가 참으로 바뀐 다음에야 100이 붙습니다. 지워서 `steps: []`가 되면 `shouldFullPromote`가 `stepCount == 0`으로 통과합니다(`sync.go:956`). 그래도 앞선 게이트(`:945`)가 canary 전량 가용을 그대로 요구하므로 **배포에 걸리는 시간은 늘지 않습니다** `✓`. 손을 타는 것은 롤백 경로뿐입니다. 인덱스가 끝으로 던져지는 순간 역탐색이 `steps[0]`의 100을 집어 이 형태도 사고 사정권에 들어오는데 지우면 그 사정권에서 빠집니다. **일괄로 손대기에 가장 안전합니다.**
- `steps: []`(48블록) — 역탐색이 집어 갈 `setWeight`가 애초에 없어 이 문제를 비켜 갑니다

지운 100이 새 블록을 타고 되돌아오는 길도 함께 막아야 합니다. 마지막 rung을 검사하는 CI 린트(예: `w_last ≤ 3 × w_first` 또는 위 안전식)를 어떤 values 수정보다 먼저 넣어야 합니다 `Σ`.

base 쪽은 머지했다고 일이 끝나지 않습니다. 전파까지 ECR publish → 서비스 차트 버전 bump → GitOps 레포 `targetRevision` 동기화가 줄줄이 기다립니다. base dependency를 선언한 **239곳이 하나같이 같은 버전(`3.0.13`)에 고정돼** 있기도 합니다 `✓`. 덕분에 버전 bump 자체를 **서비스별 점진 적용(웨이브) 수단**으로 씁니다. 약점이 아니라 도구입니다.

**현재 적용 상태**: 2026-08-27 시점에 이 처방을 받은 서비스는 **아직 하나도 없습니다** `✓(2026-08-27 기준)`. base chart를 `3.0.13`에서 `3.0.14-rc.0`으로 올리는 차트 PR이 CI(helm-lint·helm-template·review)를 통과한 채 머지를 기다리고 있고 아래 §6의 스테이지 드릴은 아직 돌려 보지 못했습니다(플러그인 미설치·클라우드 자격 재인증 필요).

## 2. `dynamicStableScale: true`는 답이 아니다

누군가 후보로 꺼낼 만한 옵션이라 여기서 미리 닫습니다. 기각할 이유가 셋입니다.

**하나, 트리거를 못 막습니다.** 가중치 결정 경로([2부 §4]({{< relref "../02-rollback-window-weight/index.md" >}}))를 훑어보면 `DynamicStableScale`이 **가중치 상승을 캡하는** 자리는 `:233` 한 곳, 곧 `:229`의 **`PromoteFull` 갈래 안**입니다 `✓`. 같은 함수의 `:187`(stable로 동적 복귀)에도, `:201`(abort)에도 이 필드가 나오기는 합니다. 그러나 그쪽 분기는 롤백 램프 구간을 건드리지 않습니다. abort 분기는 아래 '셋'에서 따로 다룹니다. `rollbackWindow` 경로 자체가 `PromoteFull` 갈래로 진입하지 않고 하나뿐인 가용량 검사 `checkReplicasAvailable`도 stable만 봅니다. 가중치가 100%면 stable 요구치가 0이라 그대로 통과합니다. **Ready 2대에 100%가 쏠리는 순간은 이 옵션을 켜든 끄든 그대로입니다** `✓`.

**둘, 웜 스탠바이를 잃습니다.** 가중치가 100으로 뛰면 그다음 reconcile에서 stable 20대가 한꺼번에 0으로 내려갑니다. `minPodsPerReplicaSet` 하한을 걸어 둬도 막지 못합니다. [1부 §4.2]({{< relref "../01-canary-step-analysisrun/index.md" >}})의 `count == 0` 분기가 목표 0을 그냥 통과시키기 때문입니다 `✓`. 이번 사고에서 그나마 되돌아갈 자리가 남았던 것은 노출 구간 내내 stable 20대가 살아 있어서였습니다.

여기 짝이 하나 더 있습니다. `dynamicStableScale`을 켜 놓고 `abortScaleDownDelaySeconds`를 적지 않으면 **지연 로직 자체가 꺼집니다.** `shouldDelayScaleDownOnAbort()`가 `usesDynamicStableScaling && !abortDelayWasSet`에서 false가 되고(`replicaset.go:205-209`) abort 시점에 canary RS가 가중치를 따라 곧바로 줄어듭니다 `✓`. 켜는 순간 잃는 것은 stable 쪽 웜 스탠바이만이 아닙니다. canary 쪽 유예도 같이 없어집니다.

기본값 경로의 타이밍부터 짐작과 어긋납니다. `abortScaleDownDelaySeconds` 기본값 30초에는 단서가 하나 붙습니다. canary에 **trafficRouting이 있어야** 걸립니다(`defaults.go:220-230`). canary RS가 줄어드는 기점도 'abort 후 30초'가 아닙니다. '**stable이 완전히 가용해진 뒤** 30초'입니다. 어노테이션은 `stableRS.Status.AvailableReplicas == *spec.Replicas`에서만 달리고 달리기 전까지는 조기 반환이 매번 canary를 살려 둔 채 지나갑니다(`replicaset.go:153-162`) `✓`. `abortScaleDownDelaySeconds: 0` 역시 '지연 없음'을 뜻하지 않고 '**지연 로직을 쓰지 않음**'을 뜻합니다(`defaults.go:225-227`이 nil을 내놓고 그 nil이 `replicaset.go:201-203`에서 false로 주저앉습니다) `✓`. 업스트림 문서(`docs/features/scaledown-aborted-rs.md`)에는 이 값이 0이면 canary를 줄이지 않는다고 아무 단서 없이 쓰여 있습니다. 정작 축소를 막는 쪽은 `UseSetCanaryScale`의 예외 분기이고 그 분기는 steps에 `setCanaryScale`이 있어야 값을 냅니다. 업스트림 e2e 픽스처가 두 필드를 **반드시 함께** 두는 까닭이 여기 있습니다 `Σ`.

**셋, abort 탈출로를 막습니다.** abort 시점의 가중치 계산은 둘로 갈립니다. `dynamicStableScale`이 꺼져 있으면 즉시 0(= stable 100%)이고 켜져 있으면 `100 - (100 × stable 가용 / spec.replicas)`입니다. 여기에 **직전 기록보다 가중치를 올리지 못하게 하는 clamp가 하나 더 붙습니다.** 최종값은 `min(계산값, Status.Canary.Weights.Canary.Weight)`이고(`trafficrouting.go:350`) 주석은 그 목적을 "stable 가용성이 flapping해도 가중치를 올리지 않기 위한 것"이라고 밝혀 뒀습니다 `✓`. 이번 사고는 직전 값이 이미 100이라 결론이 바뀌지 않습니다. stable이 0대로 내려가면 그 값이 100에 굳어 **트래픽이 깨진 canary에 묶입니다** `✓`. 손으로 VirtualService를 돌려 봐야 엔드포인트가 0이니 소용없습니다.

업스트림 메인테이너 역시 사고 보고(#3020)의 워크어라운드로 **이 기능을 쓰지 말라**고 답한 적이 있습니다. jessesuen, 2023-09-06, 원문은 *"avoid dynamicStableScale feature. When this is disabled, the stable RS will remain 100% scaled during the update"*입니다 `✓(GitHub 조회, 2026-08-27)`. 우리 설정은 그 권고를 이미 지키고 있는 상태입니다.

**애초에 우리 차트가 이 필드를 렌더하지 않습니다.** `rollouts.yaml`을 뒤져도 `dynamicStableScale` 문자열이 나오지 않고 values 쪽 선언도 비어 있습니다 `✓`. 지원을 붙인 커밋이 2026-02-27에 남아 있기는 합니다. 그러나 **머지되지 않은 브랜치에 갇혀** main의 조상이 되지 못했습니다 `✓`. values에 `dynamicStableScale: true`를 적어 넣어 봐야 아무 반응이 없는 no-op입니다. 켜고 싶다면 템플릿부터 손봐야 합니다.

## 3. 업스트림은 아직 안 고쳤다

우리만 밟은 문제가 아니고 발견된 지도 오래됐습니다.

{{< flow src="_flow/3-업스트림-가드-지형.json" />}}

이슈 **#3941** "Traffic is switched before replicaset is fully available when using `rollbackWindow`"가 열린 날짜는 **2024-11-13**, 보고 버전은 v1.7.2입니다. 지금도 **open**으로 남아 있습니다 `✓(GitHub 조회, 2026-08-27)`. 보고자가 쓴 문장이 우리 관측과 포개집니다 — *"traffic was switched as soon as a single replica in the 'new' replicaset became available. However, the replicaset were still scaling up to match the number of replicas."*

미가용 RS에 100%를 싣는 동작이 버그라고 판정한 사람은 메인테이너 본인입니다. promote-full 경로에서 같은 문제를 올린 #1580에 jessesuen이 2021-10-18 *"This would be a bug. It is intended to behave the way you expected it to."*라고 적었습니다. 계보는 중간에 한 번 건너뜁니다. **#1580을 닫은 쪽은 PR #1663**이고 증상이 계속된다고 올라온 후속 이슈 **#1681**(2021-12-03, 본문이 #1580을 참조)은 2022-01-21 머지된 **PR #1683**이 처리했습니다. 그 PR이 `desiredWeight = (100 × availableCanaryReplicas) / totalReplicas`로 **가용 canary 파드 수만큼만 트래픽을 점증시키는 캡**을 넣었습니다 `✓(GitHub 조회, 2026-08-27)`.

이 이슈가 속한 패밀리가 #3020·#1580·#1681·#3372입니다. **2021년부터 끊기지 않은 결함입니다.** 묶음을 만든 것도 우리가 아니라 업스트림 메인테이너입니다. kostis-codefresh가 2026-07-23 PR #4852 리뷰에서 네 건을 직접 링크해 뒀습니다 `✓(GitHub 조회, 2026-08-27)`.

외부 근거 가운데 가장 무거운 것이 재발 보고입니다. #3372(2024-02, v1.6.0 재현)는 PR **#3878**(2025-03-10 머지)이 `checkReplicasAvailable` 가드레일로 닫았습니다. stable RS가 현재 캡된 트래픽 비율만큼 replica를 유지하는지 확인하는 방식입니다. **그런데 2026-04-10 theurichde가 #3941에 이렇게 적었습니다** — *"Unfortunately, #3878 didn't fix the issue. We hit the same problem in production again. … We are running Argo Rollouts v1.8.3 at the moment."* 원인 분석까지 우리 것과 포개집니다. `isRollbackWithinWindow()`가 `currentStepIndex`를 `stepCount`로 밀어 desired weight 100%를 만드는 '가중치 결정'이 한쪽에 있고 `ensureSVCTargets`가 `IsReplicaSetPartiallyAvailable`(1대 이상)만 보고 서비스 셀렉터를 넘기는 '셀렉터 결정'이 다른 쪽에 있는데 **둘이 서로를 확인하지 않습니다**. *"#3878 added checkReplicasAvailable … but it only guards the stable RS … The canary RS capacity is never validated against its assigned weight."* — [2부 §5]({{< relref "../02-rollback-window-weight/index.md" >}})에서 우리가 내린 판정과 같은 말입니다 `✓(GitHub 조회, 2026-08-27)`. **우리보다 한 패치 위인 v1.8.3에서 재발했다**는 사실 하나로 버전 업그레이드가 답이 아니라는 결론이 섭니다. 코드를 맞춰 보기도 전에 그렇습니다.

그동안 붙은 가드는 넷인데 하나같이 이 구멍의 옆자리를 지킵니다. **그중 우리 v1.8.2에 실제로 들어와 있는 것은 셋입니다.**

| 가드 | 무엇을 막나 | 왜 이 구멍에 안 걸리나 |
|---|---|---|
| `:217` `AvailableReplicas == 0` | canary가 **한 대도 없을 때** 가중치를 주지 않는다 | 2대는 0이 아니다 |
| `:266` `checkReplicasAvailable(stableRS, …)` (#3878) | stable이 남은 트래픽을 감당하는지 | canary를 보지 않고, 100%면 stable 요구가 0 |
| `:229` `PromoteFull` 동결 (#1683) | promote-full에서 미가용 상태의 가중치 상승 | `rollbackWindow`는 이 필드를 켜지 않는다 |
| #4639 조기 `SetWeight(0)` **(master 전용, v1.8.2에 없음)** | 새 canary가 **0대**일 때 hash 전환 전에 가중치를 0으로 리셋 | 역시 `AvailableReplicas == 0` 조건 |

그 빈자리에 들어오는 것이 **PR #4852** "fix(trafficrouting): cap canary weight to available replicas on the final step. Fixes #3941"입니다.

머지된 뒤 우리 처방이 어떻게 될지는 이 PR이 무엇을 하느냐로 갈립니다. diff를 보면 `rollout/trafficrouting.go`에 `weightFromAvailableReplicas()` 헬퍼를 새로 만들어 **네 곳**의 중복 계산을 걷어냅니다(리뷰 지적이 붙기 전에는 한 곳이었습니다). `rollbackWindow` 탓에 마지막 스텝에서 desired weight가 100%로 튀어 오르면 **canary의 가용 replica 수에 맞춰 가중치를 캡**하고 `ReplicaProgressThreshold` 허용치는 손대지 않습니다. PR 본문이 문제를 규정한 방식도 우리와 같습니다 — *"the existing zero-replica reset only fires when the canary has zero available replicas—not when it has some-but-all."* 위 표 1행(`:217`)과 4행(#4639)이 왜 이 구멍을 비켜 가는지를 업스트림도 똑같이 설명해 둔 것입니다 `✓(GitHub 조회, 2026-08-27)`. 캡이 역탐색 결과 쪽에 붙으니 이 PR이 머지된 뒤에도 우리 처방을 그대로 두어 손해 볼 일은 없습니다.

밟아 온 경로는 이렇습니다. **2026-07-15 개설, 2026-07-23 kostis-codefresh의 CHANGES_REQUESTED(헬퍼를 나머지 호출부에도 적용), 같은 날 n1koo의 네 곳 전면 치환, 2026-07-24 APPROVED.** 그러고도 2026-08-27 조회 시점까지 **open·미머지 그대로**입니다(`merged=false`, `mergeable_state=clean`, assignee zachaller, 최근 활동 2026-08-24) `✓(GitHub 조회, 2026-08-27)`. unit 2,583건은 CI에서 전부 초록이었지만 별도 e2e 리포트에 **2건 실패**가 남아 '전부 통과'라고 쓰지 못합니다 `?`(이 PR이 낸 회귀인지 예전부터 flaky였는지는 가리지 못했습니다).

**버전 업그레이드로는 해결되지 않습니다.** **역탐색 블록**을 v1.8.2와 master(2026-08-25)에서 나란히 놓고 대조했더니 **바이트 단위로 같았습니다**(diff 0줄) `✓`. 달라진 곳은 블록 **바깥**입니다. master가 `checkReplicasAvailable` 앞에 설명 주석 두 줄을 넣었을 뿐 넘기는 인자는 `c.stableRS` 하나 그대로입니다 `✓`.

같은 파일이어도 **abort 가중치 함수는 이야기가 다릅니다.** master는 `calculateDesiredWeightOnAbortOrStableRollback`을 통째로 새로 썼습니다. `dynamicStableScale` abort에서 계산식을 한 번에 때리는 대신 `setWeight` 사다리를 역순으로 한 칸씩 내려가고(v1.8.2에 없던 `GetDesiredCanaryWeight`를 새로 두었습니다) stable이 아직 스케일업 중이면 현재 가중치를 그대로 붙들어 둡니다 `✓`. **§2가 서술한 abort 동작은 v1.8.2에만 해당합니다.**

master에는 이 언저리에 변화가 셋 더 있는데 어느 것도 구멍을 메우지 못합니다.

- 스킵 조건이 `isFastRollback()` 아래로 묶였습니다 — `rollbackWindow`가 트리거 셋 중 하나가 됐다는 차이뿐이고 우리 경로에 미치는 결과는 달라지지 않습니다 `✓`
- `ReplicaProgressThreshold`(PR #4341, #4480)가 붙었습니다 — **오늘의 형태에서는 아무 영향이 없습니다.** 마지막 `setWeight: 100`이 자리를 지키는 한 임계를 못 채우면 역탐색이 100을 집어 오고 채우면 `else` 갈래가 `MaxTrafficWeight` 100을 실어 양쪽 다 100으로 끝납니다 `✓`. **골치는 §1 처방을 넣은 다음부터입니다** — `type: Pods, value: 2` 조합이 특히 그런데 마지막 100을 지워도 `ReplicaProgressThresholdMet`가 `AvailableReplicas >= 2`로 참이 되면서(`canary.go:56`) **가용 2대에 100%를 실어 이 사고를 판박이로 되살립니다** `✓`. v1.8.2에는 없습니다
- #4639의 조기 `SetWeight(0)` 블록이 `UpdateHash` 앞으로 옮겨 왔습니다(master `:293-304`). 조건이 `AvailableReplicas == 0`이라 2대짜리는 걸리지 않으며 **정작 우리가 도는 v1.8.2에는 이 블록이 아예 없습니다** `✓`. 가중치 값을 손보는 변경도 아닙니다. `SetWeight` 호출을 `UpdateHash`보다 앞에 놓는 순서 조정입니다(커밋 `073a6c9`, 2026-03-12)

## 4. `minPodsPerReplicaSet`이 왜 2였나

사고의 절반은 "canary RS가 2대"라는 사실이 만들었습니다. 그 2는 어쩌다 붙은 숫자가 아닙니다. 값 하나가 방향을 바꿔 가며 정반대 증상을 내는 동안 1년 3개월이 흘렀습니다.

{{< flow src="_flow/4-같은-하한-두-방향.json" />}}

`CheckMinPodsPerReplicaSet()`에 달린 조건절 둘([1부 §4.2]({{< relref "../01-canary-step-analysisrun/index.md" >}}))이 각각 한 방향씩 낳습니다.

**위로 막히는 방향** — `desired`가 1인데 하한이 2로 잡혀 있으면 canary RS는 2대에 붙박이고 stable은 `spec.replicas`대로 1대에 남습니다. Rollout이 내놓는 숫자는 desired 1에 replica 3입니다. `RolloutHealthy`가 `UpdatedReplicas == spec.replicas`를 요구하니 **끝내 성립하지 못하고** `progressDeadlineSeconds`가 지나면 `ProgressDeadlineExceeded`로 `Degraded`가 됩니다 `✓`.

**아래로 새는 방향** — `desired`가 0인데 하한이 1이면 `count == 0` 분기에 걸리지 못해 하한 1이 그대로 살아납니다. 총 목표는 0, 하한은 1. 그래서 **스케일 업다운이 끝없이 반복됩니다** `✓`.

원인은 하나인데 증상 둘은 서로 닮은 데가 없습니다.

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

여기서 건져 낼 것이 넷입니다.

**비용을 아끼려던 조치가 3주 만에 배포 파이프라인을 세웠습니다.** 7월 KEDA 재튜닝은 작정하고 내린 비용 변경이라 그대로 뒀습니다. 손댄 쪽은 차트의 제약이고 이를 `replicas: 1`에 맞췄습니다. 근본 원인 대신 제약을 고른 판단이었는데 결과는 옳았습니다.

**평범한 버전 승격 하나가 잠복하던 사고를 한꺼번에 깨웠습니다.** 8월 10일 GA bump는 차트 버전 한 줄을 바꾼 일입니다. 그 한 줄에 전체 재배포가 걸리면서 곳곳에 흩어져 있던 `replicas: 1` 워크로드가 일제히 드러났습니다. 개별 사고가 쌓여 있다가 배포 한 번에 전부 터진 자리입니다.

**일주일에 열네 번, 서로의 커밋을 못 본 채 같은 수정이 겹쳐 들어왔습니다.** 신호는 2025년 8월 말의 그 주였습니다. 오버라이드를 하나씩 붙여 급한 불을 끄는 사이 함대 전체를 놓고 내릴 판단은 자꾸 뒤로 밀렸습니다.

**base 기본값 2를 낮춘 사람은 끝내 없었습니다** `✓`. 대응은 늘 개별 워크로드에 예외를 하나씩 쌓는 식이었습니다. **패치를 어느 레이어에 넣느냐는 6일 만에 정반대로 뒤집혔습니다.** 2026-08-07의 단일 서비스 수정은 "레이어 3(`platform/service-manager`)이 **인프라팀** 일괄 스윕 관할이라 덮어쓰일 수 있다"는 이유를 커밋 본문에 남기고 레이어 2(`service/*/values`)를 택했습니다. 엿새 뒤인 2026-08-13의 170개 일괄 수정은 77파일 **전부를 레이어 3에** 넣었습니다. 대상을 ArgoCD Application의 `valueFiles`에서 역산한 결과였습니다 `✓`. 같은 결함이 엿새 사이에 두 레이어로 들어간 것, 그게 소유권 문제의 실체입니다.

반례가 하나 있습니다. 일괄 수정이 돌던 시점에 **같은 조합(`replicas: 1` + 하한 1)으로 멀쩡히 도는 Rollout이 이미 83개 있었습니다** `✓`. 값 자체가 틀린 게 아니라 `desired`와 맺는 관계가 틀렸고 그 관계를 CI가 한 번도 보지 않은 것이 진짜 결함입니다.

## 5. abort에서 빠져나오는 세 가지

§7의 런북은 `promote --full`을 탈출구로 지목합니다. 그 옆에 나란히 놓인 수단들이 각각 무슨 일을 하는지도 적어 둡니다. 인시던트 중에 잘못 집으면 사고를 하나 더 만듭니다.

| 수단 | 무엇을 패치하나 | 인덱스가 어디로 | 무엇이 다시 돌아오나 |
|---|---|---|---|
| `retry` | `{"status":{"abort":false}}`만 | **0** | AnalysisRun이 다시 돌고 다시 abort된다 |
| `promote --full` | `{"status":{"promoteFull":true}}`, 그것도 `CurrentPodHash != StableRS`일 때만 | `stepCount` | 없음 (스텝·analysis 전부 건너뜀) |
| 플래그 없는 `promote` | `spec.paused`·`pauseConditions`·`currentStepIndex` | **abort를 벗어나지 못한다** | — |
| `undo` | `spec.template`을 JSONPatch replace | `resetRolloutStatus`가 리셋 | 없음 (abort 해제는 부수효과) |

`retry`는 손이 제일 적게 가는 수단인데 **스텝을 0에서부터 다시 밟게 만듭니다.** abort 상태에서 컨트롤러가 `CurrentStepIndex`를 0으로 눌러 놓기 때문입니다(`canary.go:407-413`) `✓`. 인시던트 한복판에서 `retry`에 손이 가면 [2부 §1]({{< relref "../02-rollback-window-weight/index.md" >}})의 "롤백이 스스로를 abort"가 판박이로 재연됩니다. 플래그를 뗀 `promote`는 한술 더 뜹니다. 패치 상수 목록을 다 뒤져도 "abort" 문자열이 없는 탓에 `status.abort`가 살아남고 그 상태로 `canary.go:407`이 인덱스를 0으로 돌려놓은 뒤 조기 반환해 버립니다 `✓`. `promote --full`이라야 컨트롤러 쪽에서 pause 해제, `RemoveAbort`, 인덱스를 끝으로 던지기를 한꺼번에 처리합니다(`canary.go:390-396`) `✓`.

GitOps 관점으로 보면 `undo`와 갈립니다. `promote --full`은 status를 건드려 선언이 불가능하고 `undo`는 `spec.template`을 바꾸므로 선언할 수 있습니다. abort 해제는 `PodTemplateOrStepsChanged` → `resetRolloutStatus()` 안의 `RemoveAbort()`에 따라오는 부수효과입니다(`sync.go:889-891`) `✓`. **`RolloutAbortedReason`으로 `Degraded`가 된 상태에는 자동 회복 경로가 아예 없습니다.** `RemoveAbort()` 호출 지점이 다섯 군데인데 넷은 사람의 행위이거나 승격 완료이고 컨트롤러가 스스로 푸는 경우는 '이미 완전 승격된 롤아웃'이라는 코너 케이스 하나뿐입니다(`controller.go:572-575`) `Σ`. 같은 `Degraded`라도 `TimedOutReason` 쪽은 저절로 풀립니다.

## 6. 검증 — 롤백 드릴 두 레인

§8은 "회귀 테스트가 필요하다"라는 말로 끝납니다. 그 회귀 테스트를 가장 작게 줄인 형태가 이 드릴입니다. 적용 경로가 둘이니(§1) 드릴 레인도 둘입니다.

| 레인 | 경로 | 확인하는 것 |
|---|---|---|
| A | 서비스 values 오버라이드 | 롤백 시 실제 가중치가 100에서 5로 바뀌는가 |
| B | base chart | 렌더 등가성과 전파 경로가 의도대로인가 |

**레인 A**에는 스테이지 서비스 한 곳(도메인 API)을 씁니다. 걸려 있는 설정이 `[setWeight 5, pause 10s, setWeight 100]`에 replicas 2, `minPodsPerReplicaSet`은 base 기본값 2를 따르지 않고 **1까지 내려 둔 상태**입니다. 처방 전후를 견주기에 이보다 단순한 형태를 찾기 어렵습니다. 밟는 순서는 BEFORE 롤백으로 weight 100 관측 → `steps`를 3개에서 2개로 줄이는 값 수정 → AFTER 롤백으로 weight 5 관측 → `promote --full`로 탈출 시연입니다.

**레인 B**는 트래픽을 한 방울도 태우지 않습니다. `helm template` 렌더 등가성 확인 → 상속 서비스 한 곳으로 전파 확인 → 첫 실배포 관찰 순입니다. 여기 달리는 주의문이 §1의 전파 메커니즘과 맞물립니다 — **차트 PR을 머지해도 그것만으로 바뀌는 서비스는 없습니다.**

드릴이 못 보는 것부터 적습니다. **스테이지에서는 이 사고의 파드 산술이 아예 재현되지 않습니다.** 스테이지 전 서비스가 `maxReplicas: 1`에 묶여 있고(`service-manager/stage` 130행 중 128행) replicas 2~3이 천장이라 "20대 중 2대가 전량을 받는다"는 비율이 성립하지 않습니다 `✓`. 드릴이 되살리는 것은 **가중치 값(weight 100 대 5)이지 파드 산술로 생긴 피해가 아닙니다.** 이 선을 긋지 않으면 드릴 결과가 부풀려 읽힙니다.

## 7. 정리

[1부]({{< relref "../01-canary-step-analysisrun/index.md" >}})에서 다룬 장치 셋이 롤백에서 어떻게 되는지로 마무리합니다.

| 1부의 안전장치 | 롤백에서 |
|---|---|
| 인덱스를 순차로 밟는다 | `rollbackWindow`가 끝으로 던진다 → 역탐색이 **마지막** `setWeight`를 집는다 |
| `atDesiredReplicaCount` 게이트 | 여전히 작동한다. 다만 그 결과가 "이전 가중치"이고 그게 100이다 |
| AnalysisRun | 취소된다. 그래야 롤백이 취소되지 않는다 — 이건 의도된 것이다 |

첫째 줄을 만든 것이 셋째 줄입니다. **롤백을 살리자고 넣은 기능이 롤백의 가중치를 부쉈습니다.** 판정 함수를 둘이 나눠 쓴 결과입니다. `promote --full`은 판정을 함께 쓰면서도 가중치 갈래를 따로 두고 있어 화를 면했습니다.

지금 손댈 수 있는 것과 그렇지 못한 것:

- 할 수 있다 — 마지막 `setWeight: 100` 제거. `[100]` 단독 형태(77블록, 배포 동작이 그대로라 가장 안전)를 먼저 털고 잔여 rung이 낮은 형태가 그다음입니다. 앞 rung 하향까지 딸려 오는 높은 형태는 맨 뒤로 미룹니다. 같이 갈 것 — probe 완화를 같은 변경에 태우기, 마지막 rung CI 린트, 5% 정체 알람, `promote --full`을 탈출구로 적은 런북(§5)
- 하지 말 것 — `dynamicStableScale: true`(악화하는 데다 차트가 렌더조차 하지 않는다), `rollbackWindow` 제거([2부 §1]({{< relref "../02-rollback-window-weight/index.md" >}})의 롤백 취소가 되살아난다), 버전 업그레이드로 때우기(master도 같고 v1.8.3 재발 보고가 있다), 인시던트 중 `retry`나 플래그 없는 `promote`(§5), 그리고 **처방을 적용한 뒤에 `ReplicaProgressThreshold`를 `type: Pods`로 켜는 것**(§3 — 마지막 100이 없어도 2대에 100%가 실린다)
- 기다려야 한다 — PR #4852. 머지되면 이 처방을 되돌릴 수 있고 캡이 역탐색 결과 쪽에 붙으니 그냥 둬도 해가 없습니다

## 8. 남는 위험

이 처방을 떠받치는 것은 **`:245`가 `:255`·`:261`보다 먼저 평가된다는 분기 순서** 하나입니다. 상류에서 그 순서가 뒤집히면 알람 한 번 없이 무너집니다. 컨트롤러 버전을 올릴 때마다 이 롤백 시퀀스를 붙들어 두는 회귀 테스트가 있어야 하는 이유입니다 `Σ`. 가장 작은 형태가 §6입니다.

함대 안에서 컨트롤러 두 버전이 같이 돈다는 말이 돕니다. `cluster-bootstrap` 계열은 v1.8.2를 쓰고 구 `cluster-bootstrap-v2` 계열은 v1.7.1을 쓴다는 이야기입니다. **확증도 반증도 못 했습니다** `?`. 이 편이 인용한 코드는 전부 v1.8.2에서 뽑았으니 옛 클러스터가 정말 살아 있다면 같은 차트 값을 두 컨트롤러가 똑같이 해석하는지 따로 봐야 합니다. 클러스터마다 차트 버전을 세어 보는 일이 숙제로 남습니다.

← [02 롤백이 스스로를 취소한다]({{< relref "../02-rollback-window-weight/index.md" >}})
