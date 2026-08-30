---
title: "01 승격 이전 — step과 AnalysisRun"
date: 2026-08-28
lastmod: 2026-08-28
weight: 1
---

# 승격 이전 — step과 AnalysisRun

Rollout에서 "승격(promotion)"이 하는 일은 하나입니다. `status.stableRS`를 새 ReplicaSet의 pod-template-hash로 바꾸는 것. 그 한 줄이 일어나기 전까지의 모든 구간이 **step**입니다.

이 글은 그 구간을 코드로 봅니다. step이 무엇을 바꾸는지, 승격이 언제 일어나는지, 그동안 AnalysisRun이 무엇을 하는지. [2부]({{< relref "../02-rollback-window-weight/index.md" >}})의 사고는 전부 이 구간에서 일어나므로 여기서 정상 동작을 먼저 고정해 둡니다.

## 먼저 결론

- Rollout이 Deployment 자리에 더 붙이는 것은 **세 평면**입니다. 파드 층은 Deployment와 같고 트래픽 층(Service·DestinationRule·VirtualService)과 판정 층(AnalysisTemplate·AnalysisRun)이 새로 생깁니다 `✓`
- **`Service`는 하나뿐입니다.** canary/stable을 쪼개는 것은 DestinationRule의 subset이고 두 subset을 실제로 구분하는 `rollouts-pod-template-hash` 라벨은 차트 YAML에 없습니다 — 컨트롤러가 런타임에 써넣습니다 `✓`
- step은 **여덟 종류**입니다(`setWeight`·`pause`·`experiment`·`analysis`·`setCanaryScale`·`setHeaderRoute`·`setMirrorRoute`·`plugin`). 우리가 쓰는 것은 앞 둘뿐이고 base 기본값은 `setWeight 5 → pause 10m → setWeight 100` 세 단입니다 `✓`
- **`status.currentStepIndex` 하나를 서로 다른 함수 둘이 읽습니다.** 하나는 ReplicaSet을 몇 대로 띄울지, 다른 하나는 트래픽을 몇 퍼센트 보낼지 정합니다 `✓`
- **정상 배포를 안전하게 만드는 것은 `atDesiredReplicaCount` 게이트입니다.** 새 RS가 목표만큼 Available이 되기 전에는 가중치가 앞 스텝 값에 묶입니다. 이 게이트는 "가중치를 올리기 전에 파드를 준비한다"는 **양의 보장이 아니라** "파드가 목표 미달이면 이전 가중치를 쓴다"는 음의 보장입니다 `✓`
- AnalysisRun은 리비전마다 하나 생기고 `interval 20s`로 돕니다. 판정은 `result.Failed > failureLimit`이고 **누적**입니다 — 연속 실패가 아닙니다 `✓`

버전 고정: 우리 클러스터의 컨트롤러는 **argo-rollouts v1.8.2**(helm chart `argo-rollouts 2.39.5`의 appVersion)입니다 `✓`. 구 `cluster-bootstrap-v2`를 쓰는 클러스터에 chart `2.37.2` = v1.7.1이 남아 두 버전이 함대에 공존한다는 이야기가 있는데 확증도 반증도 하지 못했습니다 `?` — 클러스터별 차트 버전을 따로 조사해야 합니다. 이 글의 `파일:줄`은 전부 v1.8.2 기준입니다.

## 1. Rollout이 Deployment 자리에 더 붙이는 것

{{< rrev alt="리비전 핸드오프 — Service 는 하나지만 라우팅은 두 곳에서 갈립니다. 컨트롤러가 써넣는 해시가 DestinationRule subset 을 가르고, 그다음에야 VirtualService weight 가 트래픽 비율을 정합니다. 해시가 먼저 써지고 weight 는 그다음에야 움직입니다 — 순서가 바뀌면 두 subset 이 여전히 존재하면서도 selector 가 같아 트래픽이 갈리지 않고 뒤섞일 수 있기 때문입니다." >}}

파드 층은 Deployment와 다르지 않습니다. ReplicaSet 두 개를 소유하고 pod-template-hash로 구분합니다. 나머지 둘이 새로 생깁니다.

**트래픽 층에서 가장 자주 오해되는 지점**: 차트가 만드는 `Service`는 **하나**입니다. `service.yaml`은 단일 ClusterIP를 렌더하고 selector는 `app.kubernetes.io/name` + `app.kubernetes.io/instance` 두 라벨뿐이어서 **canary와 stable 파드를 함께** 선택합니다 `✓`. 쪼개는 일은 `DestinationRule`의 `subsets`에서만 일어납니다.

차트가 렌더한 DestinationRule을 그대로 읽으면 두 subset이 구분되지 않습니다.

```yaml
# platform/charts/base/templates/destinationrule.yaml — canary·stable 두 subset의 selector가 같다
subsets:
  - labels:
      app.kubernetes.io/name: {{ include "chartyo.name" . }}
    name: canary
  - labels:
      app.kubernetes.io/name: {{ include "chartyo.name" . }}
    name: stable
```

`name`만 다르고 `labels`는 같은 표현식입니다. 파일 전체에 `pod-template-hash` 문자열이 없습니다 `✓`. **구분은 컨트롤러가 만듭니다** — `UpdateHash()`가 두 subset의 `labels`에 `rollouts-pod-template-hash`를 써넣습니다(`rollout/trafficrouting/istio/istio.go`, `subset.Labels[DefaultRolloutUniqueLabelKey] = canaryHash`) `✓`. 이걸 모르면 "subset이 둘인데 selector가 같으니 라우팅이 안 갈릴 것"이라는 잘못된 결론을 냅니다. subset·DestinationRule·VirtualService가 서로를 어떻게 참조하는지는 [istio CRD 카탈로그]({{< relref "../../istio/15-crd-catalog/index.md" >}})가 정본입니다.

여기에 딸린 사실 하나 — 이 모드에서 `UpdateHash()`는 앞단에 가드를 하나 둡니다. Rollout spec에 `canaryService`/`stableService`가 없으면(우리 차트가 그렇습니다) **replicas > 0인 모든 ReplicaSet이 Available일 때까지 destination rule 전환을 미룹니다** `✓`.

```go
// rollout/trafficrouting/istio/istio.go — UpdateHash 진입부. 업스트림 이슈 #2507 대응
if r.rollout.Spec.Strategy.Canary.CanaryService == "" && r.rollout.Spec.Strategy.Canary.StableService == "" {
    for _, rs := range r.replicaSets {
        if *rs.Spec.Replicas > 0 && !replicasetutil.IsReplicaSetAvailable(rs) {
            return fmt.Errorf("delaying destination rule switch: ReplicaSet %s not fully available", rs.Name)
        }
    }
}
```

이 가드는 **`spec.Replicas` 대비 Available**을 봅니다. 목표가 2대일 때 2대가 떠 있으면 통과합니다 — 그 2대가 몇 퍼센트의 트래픽을 받게 될지는 보지 않습니다. 검사 대상도 좁습니다 — **`replicas > 0`인 ReplicaSet만** 보고, 새 ReplicaSet은 `replicas=0`으로 태어납니다(`rollout/sync.go:165`). 그래서 첫 트래픽 리컨실에서는 canary 파드가 0대인 채로 해시가 써지고, 가드가 실제로 붙잡는 것은 그 뒤의 `SetWeight`입니다 `✓`. 2부에서 이 구분이 결정적으로 작동합니다.

판정 층은 `analysistemplate.yaml`이 만듭니다. `rollout.analysis.enabled`와 `rollout.enabled`가 둘 다 참일 때 **`<name>-error-rate`와 `<name>-latency` 두 개**를 렌더합니다 `✓`.

이 차트는 Rollout 전용이 아닙니다. `templates/`에 `deployment.yaml`이 따로 있고 `rollout.enabled: false`면 그쪽으로 렌더됩니다. 스냅샷 기준 **27개 블록·12곳이 그 상태**이고 절반가량이 프런트엔드 web 컴포넌트입니다 `✓` — 웹 프런트에는 카나리를 아예 걸지 않는 패턴입니다.

## 2. 이 차트에서 Rollout 하나가 만들어지는 법

### 2.1 값이 겹치는 순서

{{< flow src="_flow/2-값이-겹치는-순서.json" />}}

ArgoCD Application의 `valueFiles`는 **228앱 중 221앱에서** 네 줄이고 Helm은 **뒤에 온 파일이 앞을 덮습니다**. base 차트 자신의 `values.yaml`을 세면 다섯 층입니다 `✓`. 예외는 7앱입니다 — 다섯 줄인 5앱(서비스 두 곳이 레이어 3에 파일을 하나 더 두거나 아래에 적을 `platform/values/`를 앞에 끼웁니다. 사내 오퍼레이터 한 곳이 세 앱에서 `platform/service-manager/<env>/<type>/` 한 겹을 더 씁니다), 두 줄인 2앱(배치 성격의 한 서비스가 prod·stage 양쪽에서 레이어 3과 argo repo를 아예 쓰지 않습니다). 앱 목록은 2026-08-13 스냅샷입니다 `✓`.

| 순서 | 파일 | 성격 |
|---|---|---|
| 0 | `platform/charts/base/values.yaml` | 차트 기본값 |
| 1 | `service/<svc>/values/value.yaml` | 서비스 공통(전 환경) |
| 2 | `service/<svc>/values/value-<env>.yaml` | 서비스 × 환경 |
| 3 | `platform/service-manager/<env>/<svc>.yaml` | 인프라팀 일괄 스윕 관할 |
| 4 | argo repo `values/<env>/<svc>.yaml` | 앱 등록 쪽. 이미지 태그가 여기 실린다 |

오독을 막으려면 둘을 덧붙여야 합니다.

**`platform/values/`는 원칙적으로 이 체인 밖입니다.** 서비스 워크로드가 아니라 istio·argocd·karpenter 같은 플랫폼 툴 Application이 쓰는 별도 트리입니다 `✓`. 디렉토리 이름이 비슷해서 값 레이어로 세기 쉽습니다. 반례는 한 건입니다 — 비프로드 한 서비스의 Application이 `platform/values/<env>/defaults/base.yaml`을 `valueFiles` **첫 줄**에 넣어 base values를 한 겹 더 덮습니다(228앱 중 1앱). 나머지 227앱에서는 등장하지 않습니다 `✓`.

**환경 축 넷은 한 generator에서 나오지 않습니다.** prod는 `service/prod/<svc>.yaml`의 단일 list generator 1원소이고 stage·int·int-1은 `service/stage/<svc>.yaml`의 matrix generator 안 list 3원소(`env: stage/int/int` × `postFix: ''/''/'-1'`)입니다 `✓`. **`int-1`은 별도 환경 정의가 아니라 stage generator의 세 번째 원소에 붙은 postFix**입니다. prod 파일 58개 중 matrix를 쓰는 것은 0개 — prod와 비prod의 generator 구조가 비대칭입니다 `✓`. (`stage-1` 디렉토리는 남아 있지만 어떤 ApplicationSet도 참조하지 않는 죽은 트리입니다 `✓`)

이 글에서 가장 실용적인 사실:

> **Helm은 맵을 깊게 합치고 리스트를 통째로 교체합니다.** `canary.steps`는 리스트입니다. 서비스 values에 `steps`가 한 줄이라도 선언돼 있으면 base의 `steps`는 그 컴포넌트 렌더에 **참여하지 않습니다** `✓`

base 기본값을 고쳐도 자기 `steps`가 있는 컴포넌트에는 닿지 않습니다. [3부]({{< relref "../03-what-to-do/index.md" >}})의 처방이 두 갈래인 이유가 이 한 줄입니다.

### 2.2 base 기본값

전부 `platform/charts/base/values.yaml`의 `rollout` 블록입니다 `✓`.

| 필드 | 값 | 메모 |
|---|---|---|
| `strategy` | `canary` | `blueGreen` 분기도 템플릿에 있으나 쓰는 곳이 0 |
| `minReadySeconds` | 1 | 기다리는 주체는 kube다. 차트 주석의 "delay before removing old replicaSet"은 틀린 설명 |
| `useSlowUpdate` / `maxUnavailable` / `maxSurge` | true / 1 / `10%` | 아래 주의 참고 |
| `revisionHistoryLimit` | 4 | 업스트림 기본값은 10 |
| `rollbackWindow.revisions` | **3** | 2부의 주인공 |
| `analysis.enabled` / `failureLimit` / `interval` | true / **2** / `20s` | 업스트림 `failureLimit` 기본값은 0 — 섞으면 안 된다 |
| `analysis.errorRate` / `latency` | `0.001` (SLO 99.9%) / `0.3` (300ms) | |
| `canary.minPodsPerReplicaSet` | **2** | 3부의 공범 |
| `canary.steps` | `setWeight 5` → `pause 10m` → `setWeight 100` | |
| `promotionDelaySeconds` | 30 | **blueGreen 분기에서만 렌더된다.** canary에는 안 들어간다 |

`maxUnavailable`·`maxSurge`을 조심하십시오. **trafficRouting이 붙은 canary에서는 replica 계산에 이 둘이 등장하지 않습니다** `✓`. 파드 수는 `CalculateReplicaCountsForTrafficRoutedCanary()`가 정하고 이 함수는 가중치와 `minPodsPerReplicaSet`만 봅니다. 사내에 `maxSurge` 오버라이드가 36건 있지만 그 경로에서는 무효입니다.

istio trafficRouting이 붙는 조건은 `virtualService.enabled`와 `istioInject`가 **둘 다** 참일 때이고 base 기본값은 둘 다 `true`입니다 `✓`. 즉 아무것도 오버라이드하지 않으면 카나리는 항상 트래픽 분할 모드로 돕니다. [3부 §4]({{< relref "../03-what-to-do/index.md" >}})의 `minPodsPerReplicaSet` 사가가 컨슈머 워크로드까지 덮치는 이유입니다 — 컨슈머는 인바운드 트래픽이 없는데도 이 기본값 때문에 trafficRouting이 붙습니다.

### 2.3 그래서 실제로는 어떻게 쓰이나

`platform/service-manager/*/*.yaml`과 `service/*/values/*.yaml`의 **values 파일 681개를 파싱해 컴포넌트별 `rollout` 블록 803개**를 셌습니다(2026-08-18 차트 스냅샷) `✓`. 필터가 결과를 바꿉니다 — 하위 디렉토리까지 훑으면 688파일 809블록입니다. 아래 KEDA 행만 모집단이 다르니 표 밑에서 따로 적습니다.

| 사실 | 수치 |
|---|---|
| `strategy` 명시 | 5곳, 전부 `canary`. **`blueGreen` 0건** |
| `canary.steps` 오버라이드 | **386 (약 48%)** |
| 최빈 패턴 | `setWeight 100 → pause 10m` 118 · `setWeight 100` 단독 77 · `steps: []` 48 · `setWeight 100 → pause 3m` 39 |
| base 3단에서 마지막 100만 뺀 형태 | 9건 |
| `minPodsPerReplicaSet` 오버라이드 | 324 (값 `1`이 321, `0`이 3). **기본값 2를 재선언한 곳은 0** |
| `rollbackWindow.revisions` 오버라이드 | **0** — 803블록 전부 기본값 3에 의존 |
| `analysis.enabled: false` | 149블록 · 18서비스 |
| `analysis.type: datadog` | 1건 |
| `latency` 오버라이드 | 118건 · 33서비스. 최대 `60`(초) = 기본값의 200배 |
| `errorRate`를 `1`(=100%)로 풀어 게이트 무력화 | 2건 |
| `argoNoti` 켠 서비스 | 4 |
| KEDA off | **247 조합**(모집단이 다름 — 바로 아래). 유효 `replicas: 1`이 **87** — **그중 62가 trafficRouting 켜진 상태** |

마지막 행만 세는 단위가 다릅니다. 위 행들은 values 파일의 `rollout` 블록을 세지만 KEDA 행은 **ArgoCD Application 228개 × 그 앱의 컴포넌트 = 1,364 조합**(prod 60 / stage 60 / int 57 / int-1 51)을 셉니다. 판정식은 이렇습니다 — 각 앱의 `valueFiles`를 선언 순서대로 맵 deep-merge·리스트 교체로 합친 뒤, KEDA off는 `scaling.autoScaling.enabled: false`, 유효 `replicas`는 `consumerEnabled`가 거짓이면 0으로 렌더되는 것을 반영한 값, trafficRouting은 `virtualService.enabled`와 `istioInject`가 둘 다 참. 위 표의 **247은 KEDA off 판정만 적용한 값**입니다. 여기에 `rollout.enabled: false`와 컴포넌트 `enabled: false`까지 걸러내면 파생 수치가 내려갑니다 — 유효 `replicas: 1`이 **87 → 72**, 그중 trafficRouting 켜진 것이 **62 → 53** `✓`. 세 수치의 모집단이 서로 다르므로 하나만 떼어 인용하면 오독합니다.

읽을 것이 셋 있습니다.

**절반 가까이가 카나리를 사실상 끕니다.** `setWeight 100` 계열(단독 77 + `→ pause` 계열 다수)과 `steps: []` 48건은 "한 번에 100% 전환"입니다. base 3단 램프를 실제로 쓰는 컴포넌트는 소수입니다. 카나리 정책이 서비스마다 완전히 분기돼 있어서 함대 차원의 처방을 base 차트 한 곳에서 내릴 수 없습니다.

**자동 판정을 통째로 끈 서비스가 18개입니다.** 켜 둔 곳도 `latency`를 60초까지 올려 둔 사례가 있습니다 — 임계가 300ms인 게이트와 60초인 게이트는 같은 이름의 다른 장치입니다.

**`replicas: 1`인데 trafficRouting이 붙은 조합이 62건입니다.** 파드 한 대를 5%와 95%로 쪼갤 방법은 없습니다. 이 조합이 [3부 §4]({{< relref "../03-what-to-do/index.md" >}})의 소재입니다.

## 3. 리컨실 한 바퀴의 호출 순서

{{< flow src="_flow/3-리컨실-한-바퀴.json" />}}

`rolloutCanary()`가 한 바퀴 도는 순서입니다 `✓`. 세 지점만 기억하면 됩니다.

- **`L22`에서 조기 반환**합니다. pod template이나 steps가 바뀐 바퀴는 `status`만 갱신하고 끝냅니다 — 실제 작업은 다음 바퀴부터입니다.
- **트래픽 가중치(`L57`)가 ReplicaSet 크기(`L75`)보다 먼저 결정됩니다.** 2부의 사고는 이 순서 위에서 성립합니다.
- **스텝 인덱스를 손대는 코드는 `syncRolloutStatusCanary()` 안에 있고 이 함수는 `L27`·`L69`·`L81`·`L87`·`L95` 다섯 곳에서 호출됩니다** `✓`. 어느 경로로 나가든 status 쓰기가 바퀴의 끝이라 인덱스 변경의 효과는 이 바퀴가 아니라 다음 바퀴에 나타납니다. 롤백처럼 pod template이 바뀐 바퀴는 맨 위의 `L27`로 나가고 인덱스를 스텝 끝으로 던지는 코드가 그 경로 안(`rollout/canary.go:375`·`:379`)에 있습니다.

## 4. step — 승격 이전의 단계

### 4.1 여덟 종류, 우리가 쓰는 것은 둘

`CanaryStep`은 여덟 필드 중 하나만 채우는 유니온입니다 `✓`.

| step | 하는 일 |
|---|---|
| `setWeight` | canary가 받을 트래픽 퍼센트를 정한다 |
| `pause` | `duration`만큼(또는 무기한) 멈춘다. `spec.paused`를 켜는 것과 같은 효과 |
| `setCanaryScale` | **트래픽은 그대로 두고** canary 파드 수만 바꾼다 |
| `setHeaderRoute` | 지정 헤더가 붙은 요청만 100% canary로 보낸다 |
| `setMirrorRoute` | 규칙에 맞는 트래픽을 복제해 canary로도 보낸다 |
| `analysis` | 그 스텝에서만 도는 AnalysisRun을 띄운다(background와 별개) |
| `experiment` | Experiment 오브젝트를 만든다 |
| `plugin` | go-plugin으로 외부 스텝을 실행한다 |

우리 차트는 `setWeight`와 `pause`만 씁니다. `setHeaderRoute`는 `rollout.canary.header.enabled`를 켜면 **앞에 4스텝이 자동 선삽입**되는 형태로 준비돼 있지만 기본값이 `false`입니다 `✓`.

`setCanaryScale`은 알아 둘 만합니다 — 파드 수와 트래픽을 분리해 올릴 수 있는 유일한 수단입니다. 그러나 [3부]({{< relref "../03-what-to-do/index.md" >}})에서 다룰 "가중치와 가용량이 어긋난다"는 문제에는 **정공 해법이 아닙니다.** 이유는 둘입니다 `✓`.

1. 인덱스가 `stepCount`로 점프하면 `GetCurrentCanaryStep()`이 `currentStep`으로 `nil`을 주고 그러면 `UseSetCanaryScale()`이 곧바로 `nil`을 돌려줍니다(`utils/replicaset/canary.go:517-521`). **사고가 일어나는 바로 그 순간에 꺼집니다.**
2. 애초에 가중치 갈래를 건드리지 않는 파드 수 전용 노브입니다. 타입 주석이 그렇게 적혀 있습니다 — *"SetCanaryScale defines how to scale the newRS **without changing traffic weight**"*(`pkg/apis/rollouts/v1alpha1/types.go:708`).

램프 구간에 파드를 선행 기동해 노출 창을 좁히는 **부분 완화**이고 그러려면 `steps[0]`에 놓아야 합니다. 우리는 쓰지 않습니다 `✓`.

### 4.2 인덱스 하나, 그것을 읽는 함수 둘

`status.currentStepIndex`는 정수 하나입니다. 이 값을 읽는 경로는 둘이고 서로를 모릅니다.

**ReplicaSet 크기 경로** — `reconcileCanaryReplicaSets()` → `CalculateReplicaCountsForTrafficRoutedCanary()` → `GetCanaryReplicasOrWeight()` → `GetCurrentSetWeight()`. 나온 퍼센트를 `trafficWeightToReplicas()`로 파드 수로 환산하고 마지막에 하한을 적용합니다.

```go
// utils/replicaset/canary.go:327-335 (v1.8.2) — 하한은 trafficRouting 이 있을 때만, 목표가 0 이 아닐 때만 적용된다
func CheckMinPodsPerReplicaSet(rollout *v1alpha1.Rollout, count int32) int32 {
	if count == 0 {
		return count
	}
	if rollout.Spec.Strategy.Canary == nil || rollout.Spec.Strategy.Canary.MinPodsPerReplicaSet == nil || rollout.Spec.Strategy.Canary.TrafficRouting == nil {
		return count
	}
	return max(count, *rollout.Spec.Strategy.Canary.MinPodsPerReplicaSet)
}
```

조건절 두 개가 나중에 사고 두 건을 각각 만듭니다. **`count == 0`이면 하한을 적용하지 않습니다.** **`TrafficRouting == nil`이면 하한 자체가 없습니다.**

base 기본값인 `setWeight: 5`에 `replicas: 20`이라면 `ceil(5% × 20) = 1`인데 하한 2가 걸려 **2대**가 됩니다. 카나리 첫 단계의 파드 수가 그 2대입니다. (2부가 해부하는 컴포넌트는 자기 `steps`가 있어 첫 rung이 `setWeight: 1`입니다 — 그쪽 산술은 2부 §5에서 따로 봅니다.)

**트래픽 가중치 경로** — `reconcileTrafficRouting()`이 자체 if/else 체인으로 따로 계산합니다. 같은 인덱스를 보지만 다른 코드입니다. [2부 §4]({{< relref "../02-rollback-window-weight/index.md" >}})가 이 체인을 해부합니다.

`GetCurrentSetWeight()`의 주석(`utils/replicaset/canary.go:481-483`)을 그대로 읽어 두는 게 좋습니다.

```go
// GetCurrentSetWeight grabs the current setWeight used by the rollout by iterating backwards from the current step
// until it finds a setWeight step. The controller defaults to 100 if it iterates through all the steps with no
// setWeight or if there is no current step (i.e. the controller has already stepped through all the steps).
```

**"스텝을 다 지났으면 컨트롤러가 알아서 100을 쓴다."** 마지막에 `setWeight: 100` 스텝을 두어도 100% 도달에는 아무 역할이 없습니다 — 기능적으로 잉여입니다. [3부]({{< relref "../03-what-to-do/index.md" >}})의 처방이 이 주석 한 문단 위에 서 있습니다.

### 4.3 정상 배포에서 실제로 무슨 일이 일어나나

여섯 단계로 그렸습니다. 스텝 인덱스, 가중치를 정한 코드 갈래, 트래픽 가중치, **그 가중치가 요구하는 파드 수와 실제 Available**, AnalysisRun 상태가 함께 움직입니다.

{{< rstep variant="deploy" alt="정상 배포 — 인덱스를 하나씩 밟습니다. 스텝마다 canary 가 Available 이 될 때까지 가중치가 앞 스텝 값에 묶이므로, 요구 파드 수가 실제 Ready 를 넘어서는 구간이 생기지 않습니다." >}}

가중치 바가 두 겹인 것에 주의해서 보십시오. 초록이 실제 Available로 감당되는 구간이고 정상 배포에서는 **빨간 칸이 한 번도 나타나지 않습니다.** 2부의 같은 그림에서는 나타납니다.

### 4.4 게이트 — 이게 안전장치다

④단계가 이 글의 핵입니다. 마지막 스텝(`setWeight: 100`)으로 인덱스가 넘어가면 ReplicaSet 목표는 즉시 20이 되는데 **가중치는 5%에 묶여 있습니다.** 묶는 코드가 이것입니다.

```go
// rollout/trafficrouting.go:243-253 (v1.8.2) — master 에서는 :248-258
} else if index != nil {
	atDesiredReplicaCount := replicasetutil.AtDesiredReplicaCountsForCanary(c.rollout, c.newRS, c.stableRS, c.otherRSs, nil)
	if !atDesiredReplicaCount && !c.rollout.Status.PromoteFull {
		// Use the previous weight since the new RS is not ready for a new weight
		for i := *index - 1; i >= 0; i-- {
			step := c.rollout.Spec.Strategy.Canary.Steps[i]
			if step.SetWeight != nil {
				desiredWeight = *step.SetWeight
				break
			}
		}
	}
```

주석이 의도를 그대로 말합니다 — *"새 RS가 새 가중치를 받을 준비가 안 됐으니 이전 가중치를 쓴다."* `index - 1`부터 거꾸로 훑어 처음 만나는 `setWeight`를 씁니다. 정상 배포에서 인덱스가 2일 때 `index - 1 = 1`은 `pause`라 `SetWeight`가 `nil`이고 한 칸 더 가서 `steps[0]`의 `5`를 집습니다. **그래서 5%에 묶입니다.**

`atDesiredReplicaCount`의 검사는 비대칭입니다.

```go
// utils/replicaset/canary.go:38-46 (v1.8.2) — AtDesiredReplicaCountsForCanary 의 앞 두 검사
if !allDesiredAreAvailable(newRS, desiredNewRSReplicaCount) {
	return false
}
if ro.Spec.Strategy.Canary.TrafficRouting == nil || !ro.Spec.Strategy.Canary.DynamicStableScale {
	if !allDesiredAreCreated(stableRS, desiredStableRSReplicaCount) {
		// only check stable RS if we are not using dynamic stable scaling
		return false
	}
}
// … 뒤에 basic canary 전용 검사가 하나 더 있습니다(:47-54)
```

**새 RS에는 Available을 요구하고 구 RS에는 Created만 요구합니다** `✓`. 구 버전이 망가진 롤백에서는 이 비대칭이 오히려 유리합니다 — Ready를 요구하면 롤백이 막힙니다.

**"가중치를 올리기 전에 파드를 준비한다"는 보장은 코드에 없습니다.** 코드에 있는 보장은 반대 방향입니다 — "파드가 목표에 미달이면 **이전** 가중치를 쓴다" `✓`. 정상 배포에서는 그 "이전 가중치"가 항상 더 낮은 값이라 결과적으로 안전합니다. 인덱스를 순차로 밟는 한에서만 그렇습니다.

### 4.5 승격이란 무엇인가

`shouldFullPromote()`가 빈 문자열이 아닌 이유를 돌려주면 `promoteStable()`이 호출됩니다. 순서가 중요하다고 코드가 직접 적어 뒀습니다.

```go
// rollout/sync.go:939-953 (v1.8.2). 바로 위 :938 주석 — "NOTE: the order of these checks are significant"
if c.stableRS == nil {
	return "Initial deploy"
} else if c.rollout.Spec.Strategy.Canary != nil {
	if c.pauseContext.IsAborted() {
		return ""
	}
	if c.newRS == nil || c.newRS.Status.AvailableReplicas != defaults.GetReplicasOrDefault(c.rollout.Spec.Replicas) {
		return ""
	}
	if c.rollout.Status.PromoteFull {
		return "Full promotion requested"
	}
	if c.isRollbackWithinWindow() {
		return "Rollback within window"
	}
	// ... 스텝을 다 지났으면 "Completed all N canary steps"
```

**세 번째 검사가 승격 게이트입니다.** `AvailableReplicas != spec.replicas` — 등호가 아니라 부등호라서 목표보다 많아도(surge 잔여) 통과하지 못합니다 `✓`. 이 게이트는 `PromoteFull`이든 `rollbackWindow`든 예외 없이 먼저 걸립니다. **롤백을 fast-track한다고 해서 파드가 덜 뜬 상태로 승격되지는 않습니다** — 2부의 문제는 승격 시각이 아니라 그 이전 구간의 가중치입니다.

승격은 `status.stableRS`를 바꾸고 그 결과 DestinationRule의 stable subset이 새 해시를 가리켜 canary 가중치가 0으로 돌아갑니다. 구 RS는 `scaleDownDelaySeconds`(업스트림 기본 30초) 뒤에 축소됩니다 `✓`.

반대편도 짚어 둡니다. `progressDeadlineSeconds`(기본 600초)를 넘기면 `ProgressDeadlineExceeded`로 `Degraded`가 됩니다. **`pause` 스텝이나 step analysis·experiment 스텝 위에서는 이 타이머가 정지합니다** `✓` — `isIndefiniteStep()`은 `currentStep.Pause`·`currentStep.Analysis`·`currentStep.Experiment` 셋만 봅니다(`rollout/sync.go:563-571`). `pause: 10m`이 있어도 그 10분이 데드라인을 태우지는 않습니다. **우리 차트가 쓰는 background AnalysisRun은 이 셋에 해당하지 않습니다** — 그래서 `pause` 밖에서 도는 background 판정 시간은 데드라인을 그대로 태웁니다.

## 5. AnalysisRun

### 5.1 네 자리

`AnalysisTemplate`은 **틀**이고 `AnalysisRun`은 **인스턴스**입니다. AnalysisRun이 생기는 자리는 넷입니다.

| 자리 | 스펙 | 생명주기 |
|---|---|---|
| **background** | `canary.analysis.templates` | 리비전 하나에 하나. `startingStep`이 없으면(우리 차트가 그렇습니다) 게이트가 통과되어 **첫 바퀴부터** Rollout이 끝날 때까지 계속 `✓` |
| step analysis | `steps[].analysis` | 그 스텝에서만 |
| prePromotionAnalysis | `blueGreen.prePromotionAnalysis` | active 전환 전 |
| postPromotionAnalysis | `blueGreen.postPromotionAnalysis` | active 전환 후 |

**우리 차트는 canary background 하나만 씁니다** `✓`. `rollouts.yaml`이 `canary.analysis.templates`에 error-rate와 latency 두 템플릿을 넣습니다. blueGreen 분기의 `postPromotionAnalysis`도 템플릿에 있지만 blueGreen을 쓰는 서비스가 0개라 렌더되지 않습니다 `✓`.

표의 `startingStep`에 "기본 0"이라는 기본값은 없습니다. `BeforeStartingStep()`은 필드가 `nil`이면 곧바로 `false`를 돌려주고(`utils/replicaset/canary.go:399-408`) 그 `false`가 생성 게이트(`rollout/analysis.go:329`)를 통과시킵니다 `✓`. 미설정은 "0부터"가 아니라 "게이트가 없음"입니다.

background라는 성격이 2부의 전제입니다 — **스텝과 무관하게 `pause` 중에도 계속 돕니다.** 판정이 실제로 일어나는 구간은 `pause: 10m` 안입니다.

### 5.2 사내 AnalysisTemplate 둘

```yaml
# base values.yaml 기본값으로 렌더한 error-rate AnalysisTemplate (prometheus provider).
# 템플릿 원문은 platform/charts/base/templates/analysistemplate.yaml:9-16 — 세 값이 전부 values 참조이고
# datadog/prometheus 분기가 함께 들어 있다. 아래는 그 분기를 거친 결과만 남긴 것
interval: 20s
failureCondition: result[0] >= 0.001      # SLO 99.9%
failureLimit: 2
```

쿼리는 istio 메트릭입니다.

```promql
(sum(irate(istio_requests_total{reporter="destination",destination_service=~"<svc>.<ns>.svc.cluster.local",response_code=~"5.*"}[1m]))
 /
 sum(irate(istio_requests_total{reporter="destination",destination_service=~"<svc>.<ns>.svc.cluster.local"}[1m])) > 0)
OR on() vector(0)
```

두 군데를 짚어야 합니다.

**`result[0]`의 대괄호는 오타가 아닙니다.** prometheus provider가 벡터를 그대로 돌려주므로 조건식에서 인덱스 0을 집습니다 `✓`. datadog provider는 스칼라를 주므로 `result >= …`로 쓰고 차트도 provider에 따라 분기합니다.

**`OR on() vector(0)`이 왜 필요한가.** 분모가 0이면 PromQL이 빈 벡터를 돌려주고 그러면 `result[0]`이 인덱스 밖을 집습니다. 빈 결과는 실패가 아니라 **Error**로 분류되고 에러가 `consecutiveErrorLimit`(기본 4 → 5회째)을 넘기면 AnalysisRun이 `Error`가 됩니다 `✓`. `vector(0)`은 "트래픽이 없으면 오류율 0"을 명시해 그 경로를 닫습니다.

**이 쿼리에는 리비전을 구분하는 라벨이 없습니다.** `destination_service`만 봅니다. canary 파드와 stable 파드가 같은 Service 뒤에 함께 있으므로 `istio_requests_total`은 **둘의 합**입니다. 즉 이 AnalysisRun이 재는 것은 "새 버전의 오류율"이 아니라 **"이 서비스 전체의 오류율"**입니다 `✓`. datadog 쿼리 쪽에는 `version:{{ .Values.image.tag | lower }}` 필터가 있어 대조가 되지만(`platform/charts/base/values.yaml:198-201`) 그 provider를 쓰는 곳은 1건뿐입니다 `✓`.

[2부 §1]({{< relref "../02-rollback-window-weight/index.md" >}})의 첫 번째 실패 모드가 여기서 나옵니다.

### 5.3 측정 루프와 abort

{{< seq src="_seq/4-측정과-중단.json" />}}

숫자 세 개를 섞지 않는 게 중요합니다.

- `failureLimit` 판정은 `result.Failed > failureLimit`이고 **누적**입니다 `✓`. 연속이 아니므로 20초마다 한 번씩 띄엄띄엄 실패해도 세 번째에 `Failed`가 됩니다.
- 업스트림 `failureLimit` **기본값은 0**입니다 — 그대로 두면 첫 실패에 `Failed`입니다. **우리는 2**이므로 세 번째입니다.
- `consecutiveErrorLimit`은 별개이고 기본 4, 판정이 `> 4`라 **5회째**입니다. 에러 재시도 간격은 10초 고정입니다 `✓`.

AnalysisRun이 `Failed`가 되면 abort가 켜지고 그때부터는 두 경로가 각각 단락됩니다.

**트래픽 가중치**는 `reconcileTrafficRouting()`이 정합니다. if/else 체인의 `:199` 갈래(`c.pauseContext.IsAborted()`)가 `calculateDesiredWeightOnAbortOrStableRollback()`을 부르고 그 함수의 첫 줄이 이렇습니다.

```go
// rollout/trafficrouting.go:337-343 (v1.8.2)
func (c *rolloutContext) calculateDesiredWeightOnAbortOrStableRollback() int32 {
	if !c.rollout.Spec.Strategy.Canary.DynamicStableScale {
		// When aborting or rolling back to stable RS and dynamicStableScaling is disabled,
		// then desired canary weight should immediately be 0 (100% to stable) since we can trust
		// that it is fully scaled up
		return 0
	}
```

**ReplicaSet 크기**는 다른 함수가 막습니다.

```go
// utils/replicaset/canary.go:484-487 (v1.8.2) — GetCurrentSetWeight 진입부
func GetCurrentSetWeight(rollout *v1alpha1.Rollout) int32 {
	if rollout.Status.Abort {
		return 0
	}
```

같은 abort인데 읽는 신호가 다른 것에 주의하십시오 — 트래픽 쪽은 `pauseContext.IsAborted()`, 파드 수 쪽은 `Status.Abort` 필드입니다. `GetCurrentSetWeight()`는 램프 구간의 트래픽 계산(`trafficrouting.go:259`)에서도 쓰이지만 **abort 갈래는 이 함수를 부르지 않습니다.** 결과는 같습니다 — 스텝이 어디에 있든 가중치와 파드 목표가 함께 0으로 갑니다 `✓`. `dynamicStableScale`이 꺼져 있으면 stable RS가 전량 유지돼 있으므로 초 단위로 복귀합니다. 공식 문서가 기본값(false)의 장점으로 명시하는 성질입니다.

## 6. 다음 편으로 넘기는 것

여기까지가 정상 경로입니다. 안전은 세 장치가 겹쳐 만듭니다.

1. **인덱스를 순차로 밟는다** — 그래서 역탐색이 집는 "이전 가중치"가 항상 더 낮다
2. **`atDesiredReplicaCount` 게이트** — 새 RS가 목표에 못 미치면 가중치를 올리지 않는다
3. **AnalysisRun** — 오류율이 임계를 넘으면 abort하고 가중치를 0으로 돌린다

2부는 이 셋이 롤백에서 각각 어떻게 뒤집히는지를 봅니다.

- 3번이 **롤백을 취소합니다.** 쿼리에 리비전 필터가 없으므로 인시던트 중에 롤백하면 아직 높은 오류율을 새 AnalysisRun이 그대로 읽고 롤백 자체를 abort합니다. 그래서 `rollbackWindow`를 넣었습니다.
- `rollbackWindow`가 1번을 없앱니다. 인덱스를 스텝 끝으로 던지므로 역탐색이 집는 "이전 가중치"가 **마지막** `setWeight`가 됩니다.
- 2번은 남아 있고 canary도 계속 봅니다 — `AtDesiredReplicaCountsForCanary`의 첫 검사가 canary Available입니다(`utils/replicaset/canary.go:38`). 게이트가 걸렸을 때 역탐색이 집어오는 "이전 가중치"가 롤백에서는 100입니다. **canary를 아예 보지 않는 것은 별개 게이트 `checkReplicasAvailable`**이고(호출부 `rollout/trafficrouting.go:266`) 그쪽은 인자로 `stableRS`만 받습니다 `✓`.

세 문장이 겹치는 자리에 2026-08-21의 사고가 있습니다.

→ [02 롤백이 스스로를 취소한다]({{< relref "../02-rollback-window-weight/index.md" >}})

→ [03 그래서 무엇을 할 것인가]({{< relref "../03-what-to-do/index.md" >}})
