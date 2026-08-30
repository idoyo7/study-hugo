---
title: "02 롤백이 스스로를 취소한다"
date: 2026-08-28
lastmod: 2026-08-28
weight: 2
---

# 롤백이 스스로를 취소한다

롤백은 컨트롤러에게 새 rollout입니다. 이 한 문장에서 사고 두 건이 나옵니다.

첫 번째는 **롤백이 취소되는 것**입니다. 새 rollout이니 AnalysisRun이 새로 붙습니다. 인시던트 중이라 오류율은 아직 높습니다. 되돌리려는 행위가 판정에 걸려 abort됩니다.

두 번째는 그 첫 번째를 막으려고 넣은 `rollbackWindow`에서 나옵니다. 스텝을 건너뛰게 하면 [1부]({{< relref "../01-canary-step-analysisrun/index.md" >}})에서 본 안전장치가 **의도와 정반대로** 작동합니다. "파드가 준비 안 됐으면 이전 가중치를 쓴다"는 코드가 건너뛴 마지막 스텝의 `setWeight: 100`을 도로 집어옵니다.

2026-08-21 prod에서 두 번째가 실제로 일어났습니다. 이 글은 그 기전까지입니다 — 무엇을 고칠 것인가는 [3부]({{< relref "../03-what-to-do/index.md" >}})입니다.

## 먼저 결론

- **첫 번째 실패**: base의 `errorRateQuery`에는 리비전을 가르는 라벨이 없습니다. canary와 stable이 같은 Service 뒤에 있어 `istio_requests_total`은 둘의 합입니다. 인시던트 중 롤백하면 새 AnalysisRun이 아직 높은 오류율을 읽고 **AnalysisRun 생성 시점으로부터 40초쯤 뒤 롤백을 abort합니다** `≈`(`interval: 20s` × `failureLimit: 2`에서 유도한 하한입니다. 실측 상한은 없습니다)
- 그래서 `rollbackWindow.revisions: 3`을 넣었습니다(2025-06-27). 코드에서 이 값이 하는 일은 둘입니다 — **스텝 인덱스를 끝으로 던지고 실행 중인 AnalysisRun까지 취소합니다** `✓`
- **그 두 동작은 `promote --full`과 완전히 같은 코드, 같은 줄입니다** (`canary.go:390`의 `PromoteFull || isRollbackWithinWindow`, `analysis.go:78`의 같은 OR 체인) `✓`
- **차이는 가중치 갈래 하나입니다.** `promote --full`은 `:229`에 자기 분기가 있어 현재 가중치를 **동결**합니다. `rollbackWindow`는 그 분기가 없어 체인의 마지막 갈래(`:243`)로 떨어지고 그 안의 `:245` 역탐색을 만납니다 `✓`
- 그 시점 canary RS는 `minPodsPerReplicaSet` 하한인 **2대**입니다. 100%가 요구하는 20대에 10배 부족한 상태로 라우팅이 넘어갑니다. **가용량 게이트는 stable만 검사합니다. 가중치 100%면 stable 요구치가 0이라 무조건 통과합니다** `✓`
- **성립 조건이 하나 있습니다.** abort 갈래(`:199`)가 역탐색 갈래(`:243`)보다 앞에 있으므로 abort된 상태에서는 역탐색이 아예 실행되지 않습니다. 이 사고는 **abort되지 않은 `rollbackWindow` 경로에서만** 성립합니다 `✓`
- 실측: endpoint 0 구간 **30초**, 2대 노출 **96 rps** `✓` / 요청 결손 **3,058건(−80.1%)** `≈`(기대치 대비 산출값) / UH 503 **28건** `?`(원 출처를 이 글에 붙이지 못했습니다)

## 1. 첫 번째 실패 — analysis가 롤백을 취소한다

롤백은 이미지 태그를 이전 값으로 되돌립니다. pod template이 바뀌므로 컨트롤러는 이것을 새 리비전으로 봅니다. `PodTemplateOrStepsChanged()`가 참이 되고 `resetRolloutStatus()`가 돌아 **`currentStepIndex`가 0으로 초기화**됩니다.

그 뒤 벌어지는 일을 순서대로 봅니다.

1. canary RS(= 되돌아가려는 구 리비전)가 첫 스텝 기준으로 뜹니다. 사고가 난 컴포넌트는 첫 스텝이 `setWeight: 1`이므로 `ceil(1% × 20) = 1`, 하한 2가 걸려 **2대**
2. 2대가 Ready되면 가중치 1%가 발효되고 **background AnalysisRun이 새로 생깁니다**
3. AnalysisRun이 `errorRateQuery`를 20초마다 던집니다
4. 그 쿼리는 `destination_service`만 봅니다 — **리비전 구분이 없습니다** `✓`

4번이 결정적입니다. 롤백을 시작한 이유가 "새 버전이 5xx를 낸다"라면 롤백 직후에도 트래픽 99%는 아직 깨진 버전으로 갑니다. 오류율은 여전히 높습니다. AnalysisRun은 그 값을 그대로 읽습니다.

`failureLimit: 2`이므로 세 번째 측정에서 `Failed`가 됩니다. `interval: 20s`이니 **가장 이른 abort 시각은 AnalysisRun 생성으로부터 40초 근처**입니다 `≈`(t=0이 롤백 커밋 sync가 아니라 canary 2대 Ready 후 background AnalysisRun이 만들어진 시점입니다).

abort는 그 다음 두 경로를 **각각** 단락시킵니다. **트래픽 가중치** 쪽은 `reconcileTrafficRouting`의 `:199` `pauseContext.IsAborted()` 갈래가 `calculateDesiredWeightOnAbortOrStableRollback()`(`:337`)을 부르고 `dynamicStableScale`이 꺼져 있으면 즉시 0을 씁니다 — stable 100%입니다. **ReplicaSet 크기** 쪽은 `GetCurrentSetWeight()` 진입부의 `if rollout.Status.Abort { return 0 }`가 막습니다. 두 신호는 별개입니다(`pauseContext.IsAborted()`는 pause 조건이고 `Status.Abort`는 필드입니다). 어느 쪽이든 스텝이 어디에 있든 결과가 같아 **트래픽 100%가 깨진 버전으로 되돌아갑니다** `✓`.

롤백이 취소되는 것이 아니라 **롤백이 스스로를 취소합니다.** 판정 대상과 판정 근거가 같은 메트릭을 공유하기 때문입니다.

이 결함은 쿼리에 리비전 필터를 넣으면 정공으로 풀립니다. datadog provider 쪽 쿼리에는 `version:{{ .Values.image.tag | lower }}` 필터가 실제로 있습니다 `✓`. 그러나 `analysis.type`을 datadog으로 바꾼 곳은 803블록 중 **1건**뿐입니다 `✓`.

빠진 자리를 짚어 봅니다. 없는 것은 **우리 prometheus 쿼리**입니다. argo-rollouts 자체에는 리비전을 가르는 값을 AnalysisRun args로 주입하는 1급 기능이 있습니다 — `valueFrom.podTemplateHashValue: Latest | Stable`입니다. 컨트롤러가 canary·stable RS의 `rollouts-pod-template-hash` 라벨을 그대로 인자에 넣습니다(`utils/analysis/factory.go:24-31`) `✓`. 그런데 그 해시가 프로메테우스 쪽 라벨로 나오지 않습니다. 2025-08-24에 라우팅을 DestinationRule subset 모드로 바꾸면서([3부 §4 타임라인]({{< relref "../03-what-to-do/index.md" >}})) 해시가 `subsets[].labels`에만 들어갔습니다. 표준 `istio_requests_total`에는 subset 라벨이 없습니다 `≈`(사내 차트가 `version`/`canonical-revision` 라벨을 렌더하는지는 확인하지 못했습니다). subset이 메트릭에 어떻게 나타나는지는 [istio CRD 카탈로그]({{< relref "../../istio/15-crd-catalog/index.md" >}}) 소관입니다.

막힌 것은 기능이 아니라 **라우팅 모드 선택**입니다. 그래서 다른 길을 골랐습니다.

이 첫 번째 실패에는 더 직접적인 기존 노브도 있습니다 — `canary.analysis.startingStep`을 주면 컨트롤러가 그 스텝 전까지 **background run을 아예 만들지 않습니다**(`analysis.go:329`의 `BeforeStartingStep` 검사) `✓`. 단, 인덱스가 `stepCount`로 점프한 뒤에는 `currStep > startingStep`이 되므로 이 보호는 **램프 구간에만** 유효합니다.

## 2. `rollbackWindow`가 정확히 하는 일

2025-06-27 커밋 하나가 base 차트에 두 필드를 노출했습니다 — `rollbackWindow.revisions`(신규, 기본 3)와 `revisionHistoryLimit`(하드코딩 3 → values 참조, 기본 4) `✓`. 커밋 제목은 "add rollback analysisrun skip"인데 diff에 analysis 관련 코드가 없습니다. **제목이 가리키는 것은 diff가 아니라 업스트림 쪽 효과입니다** — `rollbackWindow`를 켜면 컨트롤러가 analysis를 스킵합니다.

판정 함수는 이렇습니다.

```go
// rollout/sync.go:903-927 (v1.8.2) — 창 밖일 때의 로그와 return false 는 생략
func (c *rolloutContext) isRollbackWithinWindow() bool {
	if c.newRS == nil || c.stableRS == nil {
		return false
	}
	// first check if this is a rollback
	if c.newRS.CreationTimestamp.Before(&c.stableRS.CreationTimestamp) {
		// then check if we are within window
		if c.rollout.Spec.RollbackWindow != nil {
			if c.rollout.Spec.RollbackWindow.Revisions > 0 {
				var windowSize int32
				for _, rs := range c.allRSs {
					if rs.Annotations != nil && rs.Annotations[v1alpha1.ExperimentNameAnnotationKey] != "" {
						continue
					}

					// is newRS < rs < stableRS ? then it's part of the window
					if rs.CreationTimestamp.Before(&c.stableRS.CreationTimestamp) &&
						c.newRS.CreationTimestamp.Before(&rs.CreationTimestamp) {
						windowSize = windowSize + 1
					}
				}
				if windowSize < c.rollout.Spec.RollbackWindow.Revisions {
					c.log.Infof("Rollback within the window: %d (%v)", windowSize, c.rollout.Spec.RollbackWindow.Revisions)
					return true
				}
```

볼 대목이 넷입니다.

**첫 줄이 "이게 롤백인가"입니다.** `newRS.CreationTimestamp.Before(stableRS.CreationTimestamp)` — 되돌아가려는 RS가 현재 stable보다 **먼저 만들어졌는가**. 일반 배포에서는 새 RS가 나중에 생기므로 이 조건이 성립하지 않습니다. **`rollbackWindow`는 일반 배포에 아무 영향이 없습니다** `✓`.

**`revisions: 3`은 "3세대 전까지"가 아닙니다.** 컨트롤러가 세는 값은 되돌아가려는 RS와 현재 stable 사이에 낀 ReplicaSet **객체** 수입니다. `c.allRSs` 전체를 훑으므로 **replicas 0으로 축소된 RS도 셉니다** — '살아 있는' RS가 아닙니다. Experiment가 만든 RS는 애노테이션으로 제외됩니다. 비교는 `CreationTimestamp`뿐이고 시간이 아니라 개수입니다 `✓`.

**`revisions: 3`은 stable로부터 3리비전 뒤까지입니다.** 리비전 5가 stable일 때 5→4, 5→3, **5→2가 모두 창 안**입니다 — 5→2의 중간 RS는 {3, 4} 둘이고 2 < 3이기 때문입니다. 업스트림 문서(`docs/features/rollback.md:23`)는 5→4·5→3만 예로 들어 **창을 실제보다 좁게 적었습니다** `✓`.

**`revisionHistoryLimit`과 짝입니다.** 히스토리가 너무 작으면 되돌아갈 RS 객체가 이미 삭제돼 판정 자체가 성립하지 않습니다 `✓`. 두 값을 같은 커밋에서 노출한 이유가 이 짝입니다 `Σ`. 짝의 방향은 한쪽만이 아닙니다 — 아래 소절에서 봅니다.

이 판정이 참일 때 컨트롤러가 하는 일은 딱 둘입니다.

```go
// rollout/canary.go:390-396 (v1.8.2) — 인덱스를 스텝 끝으로 던진다
if c.rollout.Status.PromoteFull || c.isRollbackWithinWindow() {
	c.pauseContext.ClearPauseConditions()
	c.pauseContext.RemoveAbort()
	if stepCount > 0 {
		currentStepIndex = &stepCount
	}
}
```

```go
// rollout/analysis.go:77-83 (v1.8.2) — analysis 를 스킵하고 실행 중인 것까지 취소한다
// (앞의 :73-76 은 함수 시그니처와 나머지 세 플래그 할당 — 생략)
isRollbackWithinWindow := c.isRollbackWithinWindow()
if isAborted || c.rollout.Status.PromoteFull || rollbackToScaleDownDelay || initialDeploy || isRollbackWithinWindow {
	c.log.Infof("Skipping analysis: ...")
	allArs := append(c.currentArs.ToArray(), c.otherArs...)
	c.SetCurrentAnalysisRuns(c.currentArs)
	return c.cancelAnalysisRuns(allArs)
}
```

**§1의 문제는 이걸로 해결됩니다.** 롤백 경로에서 AnalysisRun이 아예 생기지 않고 이미 돌던 것도 취소됩니다. 도입 판단은 맞았습니다.

연혁 하나를 알아 두면 왜 이 기능에 구멍이 남았는지가 보입니다. `rollbackWindow`는 **한 번에 완성되지 않았습니다.** v1.4.0-rc1(2022-12-20, PR #2394, 이슈 #574)에 처음 들어왔고 문서도 "since v1.4"로 명시합니다. 그 뒤 두 번 확장됐습니다 — v1.6.0(2023-09-05, PR #2953) "rollback should skip all steps to active rs"가 위 `canary.go:379`의 `IsActive` 분기를 만들었습니다. v1.7.2(2024-08-12, PR #3670, 이슈 #3669) "Take RollbackWindow into account when Reconciling Analysis Runs"가 `analysis.go:77`의 스킵을 넣었습니다 `✓`. **최초 설계는 full-promote 판정 한 곳이었고 소비 지점이 뒤늦게 늘어났습니다.** 현재 창 판정을 읽는 곳은 네 군데입니다 — canary 스텝 스킵(`canary.go:379`·`:390`), analysis 스킵(`analysis.go:77-79`), full-promote 사유(`sync.go:951`·`:978`), blueGreen pause/abort 해제(`bluegreen.go:275`) `✓`. 우리가 밟은 구멍이 설계 시점에 왜 안 보였는지가 여기서 나옵니다.

(master에서는 이 조건이 `isFastRollback()`으로 묶여 있습니다 — **먼저 `isRollback()`이 참이어야 하고** 그 위에서 `isRollbackWithinWindow`·blueGreen의 scale-down-delay 창(`newRSWithinDelay && BlueGreen != nil`)·`stableRS == newRSHash` 셋 중 하나면 참입니다 `✓`. 우리 경우의 의미는 같습니다. master의 스킵 조건에는 `isFullyPromoted`가 새로 들어갔습니다. v1.8.2의 `rollbackToScaleDownDelay` 항은 `isFastRollback` 안으로 접혔습니다.)

### 창이 예상과 다르게 열리거나 닫히는 경우

창 설정이 뜻대로 동작하지 않는 자리가 몇 군데 있습니다. 전부 v1.8.2 코드로 확정되는 것만 적습니다.

**가장 흔한 실패는 타깃 RS가 이미 삭제된 경우입니다.** `FindNewReplicaSet`이 nil을 돌려주면 컨트롤러가 `CreationTimestamp = now`인 RS를 새로 만듭니다. 그러면 첫 게이트인 `newRS.Before(stableRS)`가 거짓이 됩니다. **`revisionHistoryLimit`이 창보다 작으면 창 설정이 그냥 죽습니다** `✓`.

**`revisionHistoryLimit`의 방향은 양면입니다.** 히스토리를 짧게 잡으면 `windowSize`를 채울 중간 RS가 사라지므로 창이 **오히려 넓어집니다.** 타깃 RS까지 지워지면 이번엔 창이 통째로 죽습니다. 두 효과가 반대 방향이라 "히스토리를 넉넉히 잡으면 창이 정확해진다"는 한 문장으로는 잘못 읽힙니다 `✓`.

**`revisionHistoryLimit`은 '보관 RS 총수'도 아닙니다.** 정리 대상은 `otherRSs`(newRS·stableRS 제외)이므로 `4`면 실제 잔존은 최대 **6개**입니다 — 4 + stable + desired입니다 `✓`. 이 기준으로 보면 우리 조합(히스토리 4 / 창 3)은 정합적이고 여유가 1 있습니다. 창이 요구하는 최원거리 타깃이 stable−3이고 히스토리 4가 stable−1..stable−4를 보관하기 때문입니다. **컨트롤러는 이 정합성을 검증하지 않습니다** — `pkg/apis/rollouts/validation/` 전체에 `rollbackWindow` 검사가 **0건**입니다. `RollbackWindowSpec.Revisions`에 상한·하한 마커도 없습니다 `✓`.

**`scaleDownDelay`로 아직 떠 있는 RS는 삭제되지 않고 `windowSize`를 계속 차지합니다.** `reconcileRevisionHistoryLimit`이 `replicas != 0`인 RS를 건너뛰기 때문입니다(`sync.go:452-454`) `✓`. **`CreationTimestamp`는 초 단위입니다** — 같은 초에 만들어진 RS 두 개는 `Before()`가 양방향 모두 거짓이고 동률 타이브레이커가 없습니다. 효과는 게이트마다 반대입니다. 첫 게이트에서 타깃과 stable이 같은 초면 '롤백 아님'으로 떨어져 스텝과 analysis를 전부 다시 돕니다. 창 세는 쪽에서는 중간 RS가 같은 초면 세어지지 않아 창이 넓어집니다 `✓`.

## 3. `promote --full`과 같은 줄에서 만난다

위 두 블록을 다시 보십시오. **조건이 `PromoteFull || isRollbackWithinWindow`입니다.** 두 기능은 서로를 참조하지 않지만 같은 if문 안에 있습니다.

`promote --full`에서는 kubectl 플러그인이 `status.promoteFull = true`를 패치합니다. `spec`이 아니라 `status`이므로 **GitOps로 선언할 수 없습니다** `✓`.

먼저 `promote --full`이 어떻게 도는지 봅니다.

{{< rstep variant="promote" alt="promote --full — 스텝을 전부 건너뛰고 AnalysisRun 도 취소하지만, 가중치는 :229 갈래가 현재 값에 동결합니다. ReplicaSet 만 전량으로 오르고 전환은 20/20 에서 한 번에 일어납니다." >}}

②단계에서 스텝 셋 중 둘을 건너뛰고 AnalysisRun을 취소합니다. ③단계에서 길이 나뉩니다 — **가중치가 5%에 동결됩니다.** 코드는 이렇습니다.

```go
// rollout/trafficrouting.go:229-237 (v1.8.2) — PromoteFull 은 자기 갈래를 갖는다
} else if c.rollout.Status.PromoteFull {
	// on a promote full, desired stable weight should be 0 (100% to canary),
	// But we can only increase canary weight according to available replica counts of the canary.
	// we will need to set the desiredWeight to 0 when the newRS is not available.
	if c.rollout.Spec.Strategy.Canary.DynamicStableScale {
		desiredWeight = (weightutil.MaxTrafficWeight(c.rollout) * c.newRS.Status.AvailableReplicas) / *c.rollout.Spec.Replicas
	} else if c.rollout.Status.Canary.Weights != nil {
		desiredWeight = c.rollout.Status.Canary.Weights.Canary.Weight
	}
```

주석이 문제 인식을 그대로 적어 뒀습니다 — *"canary의 available replica 수에 따라서만 canary 가중치를 올릴 수 있다."* `dynamicStableScale`이 켜져 있으면 실제로 가용 replica에 비례해 캡하고 꺼져 있으면 **현재 가중치를 그대로 유지**합니다. 어느 쪽이든 미가용 상태로 가중치가 뛰지 않습니다.

이 캡은 2022-01-21 머지된 PR #1683에서 들어왔습니다 `✓(GitHub 조회, 2026-08-27)`. **업스트림은 이 문제를 4년 전에 promote-full 경로에서 이미 인식하고 고쳤습니다.**

`promote --full`은 위험 버튼이 아닙니다. 가중치를 동결한 채 ReplicaSet만 전량 확장하고 전환은 승격 시점에 한 번에 일어납니다. **5% 상태로 정체된 rollout을 빼내는 정식 탈출구**입니다 `✓`.

(`promote --skip-all-steps`와 혼동하지 마십시오. 최종 인덱스만 같고 `promoteFull`의 부수효과 — AnalysisRun·Experiment·step plugin 종료, abort 해제 — 가 없습니다. **deprecated 표기가 붙은 것은 `--skip-current-step`과 `--skip-all-steps` 둘이고 `--full`은 아닙니다** — `promote.go:86-89`가 앞 둘만 `MarkDeprecated`하고 `--full`은 `:90`에서 그냥 등록합니다 `✓`. 대체하라고 지목된 쪽이 `--full`입니다.)

## 4. 그런데 `rollbackWindow`에는 그 갈래가 없다

가중치를 정하는 곳은 if/else 체인 하나이고 **여섯 갈래가 순서대로 평가됩니다** — `:187`(stable로 동적 복귀) → `:194`(완전 승격) → `:199`(abort) → `:217`(canary 0대) → `:229`(`PromoteFull`) → `:243`(그 밖의 전부).

{{< flow src="_flow/2-가중치-결정-여섯-갈래.json" />}}

**갈래의 순서가 이 사고의 성립 조건을 정합니다.** `:199`가 `:243`보다 앞에 있으므로 abort된 상태에서는 역탐색 사다리가 **아예 실행되지 않습니다** — `:199`가 먼저 걸려 가중치를 0으로 내리고 체인이 끝납니다. 이 사고는 **abort되지 않은 `rollbackWindow` 경로에서만** 성립합니다 `✓`. §2에서 본 `canary.go:390`이 `RemoveAbort()`를 부르지만 리컨실 순서상 가중치 결정(`L57`)이 그 호출(`L95`)보다 먼저입니다. abort가 걷히는 시점은 같은 바퀴가 아니라 **다음 바퀴**입니다 `✓`.

아래 코드블록에는 뒤 세 갈래만 담았습니다.

```go
// rollout/trafficrouting.go:217-263 (v1.8.2) — 체인의 마지막 세 갈래. 앞의 :187·:194·:199 는 생략
} else if c.newRS == nil || c.newRS.Status.AvailableReplicas == 0 {
	// when newRS is not available or replicas num is 0. never weight to canary
	...
} else if c.rollout.Status.PromoteFull {
	// 현재 가중치 동결 (§3)
	...
} else if index != nil {
	atDesiredReplicaCount := replicasetutil.AtDesiredReplicaCountsForCanary(...)
	if !atDesiredReplicaCount && !c.rollout.Status.PromoteFull {          // :245
		for i := *index - 1; i >= 0; i-- {                                // 역탐색
			step := c.rollout.Spec.Strategy.Canary.Steps[i]
			if step.SetWeight != nil { desiredWeight = *step.SetWeight; break }
		}
	} else if *index != int32(len(c.rollout.Spec.Strategy.Canary.Steps)) { // :255
		desiredWeight = replicasetutil.GetCurrentSetWeight(c.rollout)
	} else {
		desiredWeight = weightutil.MaxTrafficWeight(c.rollout)            // :262
	}
}
```

`isRollbackWithinWindow`는 이 체인 어디에도 없습니다. `:229`의 조건은 `Status.PromoteFull` 하나이고 `rollbackWindow`는 그 필드를 켜지 않습니다. 마지막 갈래인 `:243`으로 떨어집니다.

그 안에서 `:245`가 `:255`·`:261`보다 **먼저** 평가됩니다. 인덱스는 이미 `stepCount`로 던져졌고 canary RS는 2대뿐이라 `atDesiredReplicaCount`가 거짓입니다. 조건이 성립하고 **역탐색으로 들어갑니다.**

`index - 1`은 마지막 스텝, 즉 방금 건너뛴 `setWeight: 100`입니다. 첫 반복에서 잡힙니다(아래 그림은 base 기본값 3단 기준이라 `steps[2]`이고 §6의 사고 컴포넌트는 5단이라 `steps[4]`입니다).

{{< rstep variant="rollback" alt="rollbackWindow 롤백 — 스킵과 AnalysisRun 취소는 promote --full 과 같은데, 가중치 동결 갈래가 없어 :245 역탐색으로 떨어집니다. 건너뛴 스텝의 마지막 setWeight:100 을 도로 집어와 Ready 2대에 전량을 싣습니다." >}}

③단계에서 **위로 넘어간 주황 호(스킵)와 아래로 되돌아오는 빨간 화살표(역탐색)가 반대 방향**인 것을 보십시오. 이 사고가 바로 거기서 나옵니다 — 건너뛴 스텝의 값을 도로 집어옵니다.

[1부]({{< relref "../01-canary-step-analysisrun/index.md" >}})에서 이 코드를 안전장치라고 불렀습니다. 주석도 그렇게 적혀 있습니다. **인덱스를 순차로 밟는 한 "이전 가중치"는 항상 더 낮은 값입니다.** 인덱스를 끝으로 던지는 다른 기능이 그 전제를 깨면 같은 코드가 "가장 높은 가중치를 즉시 적용하라"로 읽힙니다.

## 5. 승격시킨 구 ReplicaSet이 기존만큼 확보되지 않는 이유

용어를 한 번 맞춰 둡니다. 롤백에서 **되돌아가려는 구 리비전이 컨트롤러 입장에서는 `newRS`**입니다. 그 RS는 방금 만들어졌으므로 파드가 처음부터 떠야 합니다.

몇 대로 뜨는가. 스텝 인덱스가 0이던 첫 바퀴에 정해집니다 — 사고 컴포넌트의 첫 스텝인 `setWeight: 1` 기준 `ceil(1% × 20) = 1`, 하한 2가 걸려 **2대**. 그 뒤 인덱스가 끝으로 던져지면 목표는 20으로 오르지만 파드가 실제로 뜨는 데는 시간이 걸립니다.

"첫 바퀴에 정해진다"에는 예외가 하나 있습니다. **되돌아가려는 구 RS가 이미 replicas 0으로 축소돼 있으면** `canary.go:379`의 `IsActive(newRS)` 가드가 거짓이 되어 인덱스 점프가 첫 바퀴에 일어나지 않고 두 번째 바퀴로 밀립니다. 첫 바퀴에 `CurrentPodHash`·`CurrentStepHash`가 persist되므로 두 번째 바퀴엔 `PodTemplateOrStepsChanged`가 거짓이 되고 가드가 없는 `:390` 블록으로 떨어져 거기서 인덱스가 끝으로 갑니다 `✓`. **이 지연이 사고를 막지는 못하고 한 바퀴 늦추기만 합니다** — 리컨실 순서상 `reconcileCanaryReplicaSets`(`L75`)가 `syncRolloutStatusCanary`(`L95`)보다 먼저 돌아 파드 확장은 그 사이에도 진행됩니다. **AnalysisRun 스킵은 `IsActive` 가드가 없어 첫 바퀴부터 걸립니다**(`analysis.go:77-83`) `✓`.

{{< flow src="_flow/3-두-경로가-갈린다.json" />}}

두 경로가 같은 인덱스를 보고 같은 100에 도달하는데 **도달 방식이 다릅니다.**

**ReplicaSet 크기 경로**는 `GetCurrentSetWeight()`를 씁니다. `index == stepCount`면 `currentStep`이 `nil`이므로 `MaxTrafficWeight` = 100을 돌려주고 `trafficWeightToReplicas(20, 100, 100)` = 20이 됩니다 `✓`. 여기서 중요한 부수 사실 — **마지막 `setWeight: 100` 스텝을 지워도 RS 목표는 여전히 20입니다.** 파드 수는 스텝 목록과 무관하게 이 경로에서 정해지기 때문입니다. [3부 §1]({{< relref "../03-what-to-do/index.md" >}})의 처방은 파드를 더 띄우지도 덜 띄우지도 않습니다 `✓`.

**트래픽 가중치 경로**는 역탐색을 씁니다. 적용은 즉시입니다.

이 시차는 리컨실 순서([1부 §3]({{< relref "../01-canary-step-analysisrun/index.md" >}}))에서 나옵니다. 가중치는 `L57`에서, RS 크기는 `L75`에서 정해집니다. **한 바퀴 안에서 가중치가 먼저입니다.** 그 바퀴에 canary RS의 `spec.Replicas`는 아직 2이고 2대가 Available이므로 DestinationRule 전환 가드([1부 §1]({{< relref "../01-canary-step-analysisrun/index.md" >}}))도 통과합니다. 가중치 100%가 VirtualService에 써집니다. 그 다음 `L75`에서 RS가 20으로 오릅니다.

다음 바퀴부터는 `spec.Replicas`가 20인데 Available은 2라 그 가드가 실패해 조기 반환합니다. **하지만 가중치 100%는 이미 데이터 플레인에 반영돼 있고 그대로 남습니다** `✓`. 이 글은 컨트롤러가 VirtualService에 값을 쓰는 시점까지만 다룹니다 — 그 값이 실제로 어디를 지나 Envoy에 도달하는지는 [istio 요청 경로 해부]({{< relref "../../istio/11-request-path-anatomy/index.md" >}})가 정본입니다.

### 가용량 게이트는 stable만 본다

체인 끝에 가용량 검사가 하나 있습니다.

```go
// rollout/trafficrouting.go:266 (v1.8.2)
if !c.checkReplicasAvailable(c.stableRS, weightutil.MaxTrafficWeight(c.rollout)-desiredWeight) {
	return nil
}
```

```go
// rollout/trafficrouting.go:145-149 — 인자로 받은 rs 의 가용량만 본다
// (시그니처·nil 가드·변수 할당(:139-144)과 로그 줄(:147)은 생략)
desiredReplicas := (desiredWeight * totalReplicas) / 100
if availableReplicas < desiredReplicas {
	return false
}
```

**넘기는 인자가 `c.stableRS`뿐입니다.** canary RS는 이 함수에 한 번도 들어가지 않습니다 `✓`. 계산이 `100 - desiredWeight`이므로 `desiredWeight`가 100이면 stable에 요구하는 파드는 **0대**입니다. 무조건 통과합니다.

가중치를 정하는 코드도, 그 가중치를 검사하는 코드도, **canary가 그 트래픽을 받을 수 있는지 묻지 않습니다.**

역방향도 사실로 적어 둡니다. 가중치가 5%로 남으면 stable에 19대를 요구하므로 stable이 병들어 19대에 못 미치면 이 게이트가 `return nil`로 조기 종료합니다. 에러가 아니라 그냥 리턴이라 승격 진행에는 영향이 없습니다. 결과는 20/20 도달 시점의 원자적 전환입니다 — 방향은 fail-safe입니다 `✓`.

## 6. 실측 — 2026-08-21

주문 도메인의 프런트 API에서 일어났습니다. 조건은 둘입니다. 하나는 `minPodsPerReplicaSet 2`·`rollbackWindow.revisions 3`입니다. 둘 다 base 기본값이고 오버라이드가 없습니다 `✓`. 다른 하나는 사고 시각의 **KEDA 실행 replica 20**입니다. 선언값이 아니라 런타임 값입니다 `≈`. 이 컴포넌트는 KEDA min 8 / max 360으로 돌고 차트는 오토스케일링이 켜져 있으면 `spec.replicas`를 아예 렌더하지 않습니다 `✓`. steps는 `[1, pause 5m, 5, pause 5m, 100]` — base 3단이 아니라 자체 5단 램프이고 **마지막이 100**입니다 `✓`.

| 시각 | Ready / 20 | RS 목표 | 가중치 | 무슨 일이 일어났나 |
|---|---|---|---|---|
| 13:58:56 | 0 | 2 | 0% | 롤백 커밋 sync. RS가 2대로 생성. `:217`이 가중치를 주지 않는다 |
| 수 초 후 | 0 | 2 | 0% | 인덱스가 스텝 끝으로 점프하고 AnalysisRun이 취소된다 |
| 13:59:45 | 2 | 20 | **100%** | 역탐색이 `steps[4]`의 `setWeight: 100`을 집는다. RS는 20으로 오르기 시작 |
| 13:59:50~14:00:25 | 2 → 0 → 2 → 0 | 20 | 100% | 사고 구간 35초. 2대가 96 rps를 받는다 |
| 14:00:30~14:01:00 | 20 | 20 | 100% | 20/20 도달, 다음 바퀴에 승격 |

집계된 피해 — 계측값 `✓` / 기대치 대비 산출값 `≈`:

| 항목 | 값 | 등급 |
|---|---|---|
| healthy endpoint 0 구간 | 30초 | `✓` |
| 2대가 받은 부하 | 96 rps | `✓` |
| 요청 결손 | 3,058건 (−80.1%) — 결손의 93.7%가 endpoint 0 구간 | `≈` |
| UH 503 ([no healthy upstream]({{< relref "../../istio/05-incident-intermittent-5xx/index.md" >}})) | 28건 | `?` |

표에 설명하지 못한 자리가 하나 있습니다. `:217`은 `AvailableReplicas == 0`이면 가중치를 주지 않는 갈래인데 네 번째 행에서 Ready가 0으로 떨어진 순간에도 가중치는 100%로 남아 있습니다. **왜 되돌아가지 않았는지는 확인하지 못했습니다** `?` — 리컨실 간격 안에 진동이 끝났거나 데이터플레인 반영이 늦었거나 `Status.Canary.Weights`에 기록된 값이 그대로 유지됐을 수 있는데 셋 중 무엇인지 가리지 못했습니다. 지어내지 않고 빈 자리로 둡니다.

결손은 반사실 값입니다 — 직전 동시간대 rps 평균을 기대치로 잡고 실측을 뺀 값이라 직접 계측된 30초·96 rps와 같은 등급을 줄 수 없습니다. UH 503 28건은 이 글에 원 출처(날짜·기간·대상)를 붙이지 못했으므로 `?`로 둡니다. 같은 조직에서 **다른 원인으로도 UH가 납니다** — 2026-07-25 09:43 KST에는 istiod의 CPU CFS 버스트 스로틀(28%)로 xDS 푸시가 지연되며(convergence 0.099s → 0.29s) 7개 네임스페이스에서 UH 503이 한꺼번에 24건 났고 약 4분 뒤 자동 회복했습니다. 이 사고의 28건은 그것이 아닙니다. `response_flags`가 다른 UC·URX·UF 계열과도 혼용하면 안 됩니다. UH 자체의 정의와 기전은 [간헐적 5xx 인시던트]({{< relref "../../istio/05-incident-intermittent-5xx/index.md" >}})가 정본입니다.

Ready 진동은 probe 설정 때문입니다. 2대의 처리 천장은 대략 **27~31 rps** `≈` — 1코어 미만 CPU limit에 실행 단위가 여러 개 올라간 구성에서 유도한 계산값입니다. 이 글에서는 유도를 전개하지 않습니다(그 관계의 정본은 [python GIL과 CFS]({{< relref "../../k8s-features/06-python-gil-cfs/index.md" >}})와 [CPU 스로틀링]({{< relref "../../k8s-features/02-cpu-throttling/index.md" >}})입니다). 96 rps가 들어오면 `/ready`가 1초를 넘기고 `readyFailureThreshold: 1`이라 한 번 넘기면 즉시 endpoint에서 빠집니다. 복귀에는 `successThreshold 3 × period 5` = 10~15초가 걸립니다. 그래서 `2 → 0 → 2 → 0`이 됩니다 `✓`.

**트리거와 증폭기가 별개입니다.** 트리거는 마지막 `setWeight: 100`이고 증폭기는 probe입니다. probe만 고치면 즉시 503이 큐잉 타임아웃으로 바뀔 뿐입니다 — 사고 창 손실의 상당 부분은 2대의 물리 한계 때문에 애초에 처리 불가능한 양이었습니다 `Σ`.

## 7. 여기까지가 기전이다

[1부]({{< relref "../01-canary-step-analysisrun/index.md" >}})의 안전장치 세 개가 롤백에서 이렇게 됩니다.

| 1부의 안전장치 | 롤백에서 |
|---|---|
| 인덱스를 순차로 밟는다 | `rollbackWindow`가 끝으로 던진다 → 역탐색이 **마지막** `setWeight`를 집는다 |
| `atDesiredReplicaCount` 게이트 | 여전히 작동한다. 다만 그 결과가 "이전 가중치"이고 그게 100이다 |
| AnalysisRun | 취소된다. 그래야 롤백이 취소되지 않는다 — 이건 의도된 것이다 |

셋째 줄이 첫째 줄의 원인입니다. **롤백을 살리려고 넣은 기능이 롤백의 가중치를 부쉈습니다.** 둘이 같은 판정 함수를 공유하기 때문입니다. `promote --full`은 같은 판정을 공유하면서도 가중치 갈래를 따로 두어 살아남았습니다.

그래서 고칠 자리는 컨트롤러가 아니라 **steps 목록**입니다. 역탐색이 집을 값을 낮추면 같은 코드가 안전장치로 되돌아갑니다.

→ [03 그래서 무엇을 할 것인가]({{< relref "../03-what-to-do/index.md" >}})

← [01 승격 이전 — step과 AnalysisRun]({{< relref "../01-canary-step-analysisrun/index.md" >}})
