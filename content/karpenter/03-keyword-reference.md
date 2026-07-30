---
title: "키워드 레퍼런스 — NodePool로 스케줄링을 통제한다"
weight: 3
---

# 03 · 키워드 레퍼런스 — NodePool 안에서 affinity를 쓴다는 것

{{< callout type="info" >}}
**한눈에**
- Karpenter에는 `affinity:` 필드가 없다. NodePool `spec.template.spec.requirements`가 node affinity와 **같은 문법(NodeSelectorRequirement)** 으로 "이 풀이 만들 수 있는 노드의 집합"을 정의하고, 파드의 nodeSelector·affinity·topologySpread는 그 집합과 교집합을 이룬다 — 파드 요구는 **NodePool 요구의 부분집합이어야** 스케줄된다.
- NodePool이 어떤 well-known 라벨에 requirement를 걸지 않으면 **그 축은 클라우드가 파는 모든 값이 허용**된다. arch·capacity-type·세대처럼 조직 차원에서 강제할 조건을 파드에만 두면, 요구를 빠뜨린 워크로드가 무제한 오퍼링을 얻는다.
- 연산자는 8개다 — 표준 6개 + Karpenter 확장 **`Gte`/`Lte`(v1.9.0, [core#2674](https://github.com/kubernetes-sigs/karpenter/pull/2674))**. 이 4개 비교 연산자는 값이 **정확히 1개인 음이 아닌 정수**여야 하고, 정수로 파싱되지 않는 라벨값에는 매치 자체가 안 된다.
- **preferred는 힌트가 아니다.** Karpenter는 preferred affinity를 처음엔 required로 취급하고 실패하면 정해진 순서로 한 겹씩 벗긴다. 그 순서에서 **required nodeAffinity의 OR term 순회가 preferred 제거보다 먼저**다 — "내가 원한 인스턴스가 왜 안 떴나"의 답이 §3.2다.
- topologySpread의 `topologyKey`는 AWS에서 **zone·hostname·capacity-type 세 개뿐**이고 `topology.kubernetes.io/region`은 미지원이다. `DoNotSchedule`은 완화 대상이 아니라 도메인이 부족하면 그대로 영구 Pending이다. 그리고 다른 파드가 나에게 걸어둔 **preferred** anti-affinity는 코드가 **의도적으로 추적하지 않아** 전혀 반영되지 않는다.
- `karpenter.k8s.aws/instance-capability-flex`(1.7, [aws#8315](https://github.com/aws/karpenter-provider-aws/pull/8315) → 개명 [aws#8490](https://github.com/aws/karpenter-provider-aws/pull/8490))로 flex를 배제할 때 **`DoesNotExist`를 쓰면 인스턴스 타입 전체가 배제**된다. 정답은 `In ["false"]`다.
- `karpenter.sh/capacity-type`은 `spot`/`on-demand`/`reserved` 3값이고 **reserved가 최우선 소비**된다. `nodeSelector`로 `on-demand`를 정확 일치시킨 워크로드는 ODCR 노드에 절대 안 뜬다 — nodeAffinity `In [on-demand, reserved]`로 바꿔야 한다.
- `minValues`는 **NodePool 전용**이고 `In`에서만 값 개수가 검증된다. 패밀리를 여러 개 나열해도 minValues가 없으면 스케줄러는 다양성을 강제하지 않는다 — 스팟 동시 회수 리스크가 이 한 필드로 갈린다.
- 교집합이 비면 실패로 끝나지 않고 **파드가 Pending으로 남아 백오프 재시도**된다. 즉 오설정과 일시적 용량 부족이 같은 겉모습을 갖는다. 구분은 `FailedScheduling`(파드)·`NoCompatibleInstanceTypes`(NodePool) 이벤트 메시지로만 가능하다.
{{< /callout >}}

> **왜 이 문서인가.** Karpenter를 운영하면 "파드에 affinity를 걸었는데 노드가 안 뜬다"를 반드시 한 번 만난다. 원인은 거의 항상 같다 — 파드 쪽 요구만 보고 NodePool 쪽 우주를 안 봤기 때문이다. Karpenter의 스케줄링은 kube-scheduler식 술어 평가가 아니라 **"NodePool requirements ∩ 파드 요구 ∩ 클라우드 offering"의 집합 연산**이고, 교집합이 비면 아무 노드도 만들어지지 않는다. 이 문서는 키워드별 레퍼런스이면서 그 교집합 모델을 축으로 삼는다.

> 근거 기준: 릴리스노트는 `aws/karpenter-provider-aws` 및 `kubernetes-sigs/karpenter`의 **v1.14.0까지**, 문서·코드 인용은 **2026-07-30 기준 로컬 체크아웃**이다. 문서 경로는 `karpenter-provider-aws/website/content/en/docs/` 기준, 코드 경로는 `karpenter-core/pkg/` 기준이며 줄 번호는 그 시점 스냅샷이다. 인용 전체 목록은 §10에 있다. 버전별 도입 이력·업그레이드 함정은 이 챕터 01·02가 담당하고 여기서는 "지금 1.14 기준으로 무엇이 있고 어떻게 쓰나"만 다룬다. 0.36 → 1.14 실제 업그레이드 절차는 [eks-upgrade / karpenter]({{< relref "../eks-upgrade/components/01-karpenter.md" >}})에 있다.

## 1. 제약의 3층 — 교집합이 비면 노드는 안 뜬다

| 레이어 | 정의 주체 | 예 | 안 쓰면 |
|---|---|---|---|
| ① 클라우드 offering | 프로바이더 | 존재하는 인스턴스 타입 × 존 × 구매옵션 조합 | 통제 불가 — 주어진 것 |
| ② NodePool `spec.template.spec.requirements` | 클러스터 운영자 | `instance-category In [c,m,r]` | **그 축은 클라우드가 파는 전부가 허용된다** |
| ③ 파드 `nodeSelector`·`nodeAffinity`·`topologySpreadConstraints`·`podAffinity` | 애플리케이션 | `zone In [us-west-2a]` | ②의 우주 안에서 아무 노드나 받는다 |

{{< flow caption="세 레이어가 교집합으로 합쳐져 후보 인스턴스 타입이 되고, 그 결과가 NodeClaim의 requirements로 굳어져 CreateFleet에 들어간다. 교집합이 비면 launch가 시작되지 않고 파드는 Pending으로 남아 백오프 재시도된다" >}}
{
  "nodes": [
    { "id": "POD", "col": 0, "row": 0, "label": "파드 요구", "sub": "nodeSelector · affinity · TSC", "kind": "src" },
    { "id": "NP", "col": 0, "row": 1, "label": "NodePool", "sub": "requirements — 이 풀의 우주", "kind": "src" },
    { "id": "OFF", "col": 0, "row": 2, "label": "클라우드 offering", "sub": "타입 × 존 × capacity-type", "kind": "store" },
    { "id": "IX", "col": 1, "row": 1, "label": "교집합", "sub": "Requirements.Intersection()", "kind": "proc" },
    { "id": "FIL", "col": 2, "row": 0, "label": "타입 필터링", "sub": "minValues · 가격 · 용량", "kind": "proc" },
    { "id": "NC", "col": 3, "row": 0, "label": "NodeClaim", "sub": "requirements 확정 → CreateFleet", "kind": "sink" },
    { "id": "PEND", "col": 2, "row": 2, "label": "공집합", "sub": "FailedScheduling · 파드 Pending", "kind": "query" }
  ],
  "edges": [
    { "from": "POD", "to": "IX", "label": "부분집합이어야" },
    { "from": "NP", "to": "IX", "label": "AND 결합" },
    { "from": "OFF", "to": "IX" },
    { "from": "IX", "to": "FIL", "label": "후보 타입", "rate": 500 },
    { "from": "FIL", "to": "NC", "label": "launch", "rate": 620 },
    { "from": "IX", "to": "PEND", "label": "교집합 없음", "rate": 1200, "speed": "slow" }
  ]
}
{{< /flow >}}

교차 검증 지점은 `scheduling/nodeclaim.go:130-136`이다. NodePool 템플릿의 base requirements에 파드 requirements를 `Compatible()`로 맞춰보고 실패하면 `incompatible requirements, ...`를 낸다:

```go
baseRequirements := scheduling.NewRequirements(n.Requirements.Values()...)
if err := baseRequirements.Compatible(podData.Requirements, scheduling.AllowUndefinedWellKnownLabels); err != nil {
    return nil, nil, nil, nil, fmt.Errorf("incompatible requirements, %w", err)
}
```

`Compatible()`의 판정 규칙이 이 문서 전체의 전제다 — **well-known 라벨은 NodePool에 정의가 없으면 통과**시키고(그 축은 무제한이라는 뜻), **커스텀 라벨은 정의가 없으면 무조건 거부**한다. 이것이 "우리가 만든 라벨로 노드를 요구했는데 영원히 Pending"의 정확한 원인이다.

### 1.1 교집합이 비었을 때 무엇을 보나

| 비어버린 층위 | 관측 지점 | 메시지 |
|---|---|---|
| 파드 요구 ∩ NodePool 우주 | 파드 이벤트 `FailedScheduling`(Warning) | `Failed to schedule pod, incompatible requirements, ...` |
| NodePool 우주 ∩ 클라우드 offering | NodePool 이벤트 `NoCompatibleInstanceTypes`(Warning) | `NodePool requirements filtered out all compatible available instance types` |
| minValues 조합 불가 | 같은 이벤트의 변형 | 위 문구 + `due to minValues incompatibility` |
| 컨트롤러 로그 | info 레벨 | `skipping, nodepool requirements filtered out all instance types` |

Karpenter는 여기서 포기하지 않고 백오프 후 재시도한다 — "if capacity becomes available, it will schedule the pod without user intervention". 그래서 **오설정과 일시적 용량 부족의 겉모습이 같다.** 알람은 세 메트릭이면 충분하다.

| 메트릭 | 안정성 | 보는 이유 |
|---|---|---|
| `karpenter_scheduler_unschedulable_pods_count` | ALPHA | 스케줄 불가 파드 적체 — 교집합 문제의 최상위 신호 |
| `karpenter_pods_unbound_time_seconds` | ALPHA | 언바운드로 머문 시간 — "느린가 막혔나"의 구분 |
| `karpenter_cloudprovider_instance_launch_failures_total` | BETA | AZ·capacity-type·이유 라벨. ICE(용량 부족)와 설정 오류를 분리 |

## 2. requirements 문법 레퍼런스

requirement 하나는 `key` + `operator` + `values`(+ `minValues`)다. 문법 자체가 파드의 `nodeAffinity.matchExpressions`와 동일한 `NodeSelectorRequirement`이고, 그래서 "NodePool 안에서 node affinity를 쓴다"는 표현이 정확하다.

### 2.1 연산자 8종

| 연산자 | 의미 | 값 개수 | 주의 |
|---|---|---|---|
| `In` | 값 목록 중 하나와 일치 | **최소 1개 필수** | `minValues`의 값 개수 검증이 걸리는 유일한 연산자 |
| `NotIn` | 값 목록에 없음 | 0개 이상 | 값 0개면 내부적으로 `Exists`와 동치. 커스텀 키에 걸면 `Compatible()`이 정의 없이도 통과시켜 **오타를 검증기가 못 잡는다** |
| `Exists` | 키가 존재하면 통과 | 불필요 | **커스텀 라벨을 NodePool이 "안다"고 선언하는 유일한 방법**(§5.3) |
| `DoesNotExist` | 키가 없으면 통과 | 불필요 | 항상 값이 채워지는 라벨에 쓰면 **전체 배제**가 된다(§9) |
| `Gt` | 정수 초과 | **정확히 1개**, 음 아닌 정수 | 내부적으로 `Gte(N+1)`로 정규화 |
| `Lt` | 정수 미만 | **정확히 1개** | 내부적으로 `Lte(N-1)`로 정규화 |
| `Gte` | 정수 이상 | **정확히 1개** | Karpenter 확장, **v1.9.0**([core#2674](https://github.com/kubernetes-sigs/karpenter/pull/2674)) |
| `Lte` | 정수 이하 | **정확히 1개** | 상동 |

검증 실패 메시지는 `key %s with operator %s must have a single positive integer value`다. 그리고 이 4개 연산자는 후보 라벨값이 정수로 파싱되지 않으면 **아예 매치하지 않는다** — `withinBounds()`가 `strconv.Atoi` 실패 시 `false`를 반환한다. 즉 `instance-cpu`·`instance-memory`·`instance-generation`처럼 숫자형 라벨에만 실질적 의미가 있다.

교집합 규칙 둘. **키가 다르면 AND, 같으면 교집합**이다(`Requirements.Add()`가 `Requirement.Intersection()`으로 합친다). 그리고 **같은 키의 `Gte`/`Lte`는 각각 max/min으로 좁혀지고, 범위가 뒤집히면(`gte > lte`) 그 requirement는 `DoesNotExist`로 축약되어 매치 불가**가 된다 — NodePool과 파드가 각자 범위를 걸었을 때 조용히 공집합이 되는 경로다.

### 2.2 `minValues`와 MinValuesPolicy

"이 키에 대해 서로 다른 값이 최소 N개는 살아 있어야 한다"는 다양성 하한. **NodePool 전용**이고 파드 쪽에는 대응 필드가 없다.

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: spot-diverse
spec:
  template:
    spec:
      requirements:
      - key: karpenter.sh/capacity-type
        operator: In
        values: ["spot"]
      - key: karpenter.k8s.aws/instance-category
        operator: In
        values: ["c", "m", "r"]
        minValues: 2          # 최소 2개 카테고리
      - key: karpenter.k8s.aws/instance-family
        operator: Exists
        minValues: 5          # 최소 5개 패밀리
      - key: node.kubernetes.io/instance-type
        operator: Exists
        minValues: 10
      - key: karpenter.k8s.aws/instance-generation
        operator: Gte
        values: ["3"]
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: default
```

- **값 개수 검증은 `In`에서만** 일어난다(`values.size() >= minValues`). 위 예시의 `Exists, minValues: 5`는 값 목록 길이 검증이 아니라 **스케줄링 시점의 실제 다양성 강제**다 — 층위가 다르다.
- 같은 키에 여러 requirement가 `minValues`를 걸면 **최댓값**이 적용된다.
- NodePool의 `requirements` + `spec.template.metadata.labels` 합계는 **100개 상한**이다.

전역 정책은 `--min-values-policy` / `MIN_VALUES_POLICY`, 기본값 `Strict`(**1.6.0**, [core#2299](https://github.com/kubernetes-sigs/karpenter/pull/2299)).

| 정책 | 동작 | 판정 |
|---|---|---|
| `Strict`(기본) | 미충족 시 그 NodePool로의 스케줄링을 실패시킨다 → 낮은 weight NodePool로 폴백하거나 완전 실패 | **기본 유지가 안전** — 사용자가 명시한 가용성 하한을 조용히 깨지 않는다 |
| `BestEffort` | 될 때까지 minValues를 점진적으로 낮춘다. 완화된 값은 NodeClaim에 기록되고 `karpenter.sh/nodeclaim-min-values-relaxed: "true"`가 붙는다 | **반쪽** — 소규모 리전·신규 패밀리에서 Pending이 상시화될 때만. 완화값이 그 NodeClaim의 새 하한으로 굳어져 유연성이 서서히 낮아진다 |

전역 옵션이라 NodePool별로 다르게 줄 수 없다. "일부만 완화"가 필요하면 NodePool을 분리하고 minValues 자체를 낮추는 쪽이 명확하다.

### 2.3 NodePool 우선순위 — `weight`, `limits`, `karpenter.sh/nodepool`

파드가 여러 NodePool에 매칭되면 **weight가 가장 높은 것**이 쓰인다(미지정 = 0). 문서는 NodePool을 서로 배타적으로 설계하라고 권고한다 — 겹치면 낮은 쪽이 죽은 설정이 된다.

| 키 | 위치 | 하는 일 | 비고 |
|---|---|---|---|
| `spec.weight` | NodePool | 스케줄 시도 순서. 높을수록 먼저 | drift 판정 제외(behavioral field). `replicas`(static) 지정 시 설정 불가 |
| `spec.limits.cpu` / `.memory` | NodePool | 이 풀의 총 리소스 상한. 초과하면 provisioning 정지 | CPU는 `DecimalSI`, 메모리는 `BinarySI`. GitOps skew 회피를 위해 문자열 권장 |
| `spec.limits.nodes` | NodePool | 스케일·drift 교체 중 최대 노드 수 | **1.11**([core#2526](https://github.com/kubernetes-sigs/karpenter/pull/2526))부터 일반 NodePool에도 적용 |
| `karpenter.sh/nodepool` | 노드 라벨 | 파드를 특정 풀에 묶는 셀렉터 키 | **NodePool의 `requirements`·`labels`에는 쓸 수 없다**(검증 실패). 파드 쪽에서만 쓴다 |

전형적 조합 둘. **예약 용량 우선 소비**(Savings Plan·RI)는 높은 weight + `limits`로 "이 풀을 먼저 쓰되 계약분까지만"을 표현한다. **폴백 기본값**은 반대로 넓은 기본 NodePool에 높은 weight를 주고 특수 NodePool을 weight 없이 두어 "아무 요구도 없는 파드는 기본 구성으로"를 만든다.

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: reserved-instance
spec:
  weight: 50
  limits:
    cpu: "100"            # 계약분까지만
  template:
    spec:
      requirements:
      - key: node.kubernetes.io/instance-type
        operator: In
        values: ["c4.large"]
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: default
```

weight는 **보장이 아니다**. 배칭 + 빈패킹 때문에, 최우선 NodePool로 안 되는 파드 하나가 낮은 우선순위 풀의 노드를 만들면 같은 배치의 다른 파드들도 거기에 올라탈 수 있다.

## 3. node affinity 계열 — NodePool과 파드 중 어디에 둘 것인가

### 3.1 세 문법을 Karpenter가 어떻게 읽나

| 문법 | Karpenter의 해석 | 완화 대상 |
|---|---|---|
| `nodeSelector` | 하드 요구. 키-값 equality이므로 값이 하나 늘어나기만 해도(예: `capacity-type`에 `reserved` 추가) 매칭이 깨진다 | 아니오 |
| `nodeAffinity.requiredDuringScheduling...` | 하드 요구. `nodeSelectorTerms`는 **OR**, term 안의 `matchExpressions`는 **AND** | 조건부 — term이 2개 이상일 때 앞 term을 버리며 순회 |
| `nodeAffinity.preferredDuringScheduling...` | **처음엔 required로 취급**된다. `NewPodRequirements()`가 weight 최고 항 하나를 요구사항에 넣는다 | 예 |

업스트림 문서가 두 번 반복해 경고하는 대목이 이것이다 — "Preferred affinities on pods can result in more nodes being created than expected". preferred를 가벼운 힌트로 남발하면 Karpenter가 그 선호를 만족시키려고 노드를 더 만든다.

### 3.2 완화(relaxation) 순서 — 코드 근거

스케줄러는 파드를 `add()`했다가 실패하면(단 `IsReservedOfferingError`·`IsDRAError`는 제외) `Preferences.Relax()`로 **파드 스펙을 그 자리에서 변형**하고 다시 시도한다. `Relax()`는 아래 리스트를 순서대로 시도하고 **처음 성공한 하나만 적용하고 즉시 리턴**한다(`scheduling/preferences.go:38-57`).

```go
relaxations := []func(*v1.Pod) *string{
    p.removeRequiredNodeAffinityTerm,       // 1
    p.removePreferredPodAffinityTerm,       // 2
    p.removePreferredPodAntiAffinityTerm,   // 3
    p.removePreferredNodeAffinityTerm,      // 4
    p.removeTopologySpreadScheduleAnyway,   // 5
}
if p.ToleratePreferNoSchedule {
    relaxations = append(relaxations, p.toleratePreferNoScheduleTaints) // 6, 조건부
}
```

{{< flow caption="완화는 한 번에 한 단계씩만 일어난다. \"다음 루프\"는 맨 왼쪽 trySchedule로 돌아가는 순환이며, 매 재진입마다 완화 리스트를 다시 맨 앞부터 검사한다. 버릴 것이 없으면 파드는 Pending으로 남아 백오프 재시도 대상이 된다" >}}
{
  "nodes": [
    { "id": "T", "col": 0, "row": 0, "label": "trySchedule", "sub": "파드 1개 add()", "kind": "src" },
    { "id": "F", "col": 1, "row": 0, "label": "스케줄 실패", "sub": "reserved · DRA 에러는 제외", "kind": "query" },
    { "id": "R", "col": 2, "row": 0, "label": "Relax()", "sub": "리스트 앞에서부터 딱 1개", "kind": "proc" },
    { "id": "M", "col": 3, "row": 0, "label": "파드 spec 변형", "sub": "term 제거 · toleration 추가", "kind": "store" },
    { "id": "G", "col": 3, "row": 1, "label": "완화 소진", "sub": "Pending 유지 · 백오프", "kind": "sink" },
    { "id": "N", "col": 4, "row": 0, "label": "다음 루프", "sub": "trySchedule 재진입", "kind": "src" }
  ],
  "edges": [
    { "from": "T", "to": "F", "label": "불가", "rate": 600 },
    { "from": "F", "to": "R" },
    { "from": "R", "to": "M", "label": "1단계만" },
    { "from": "M", "to": "N", "label": "재시도", "rate": 480 },
    { "from": "R", "to": "G", "label": "버릴 게 없음", "rate": 1300, "speed": "slow" }
  ]
}
{{< /flow >}}

| 순서 | 함수 | 실제 동작 | 발동 조건 |
|---|---|---|---|
| 1 | `removeRequiredNodeAffinityTerm` | `required...nodeSelectorTerms[0]`을 버리고 나머지로 재시도 | **term이 2개 이상일 때만.** 주석: "Unlike preferred affinity, we cannot remove all terms" |
| 2 | `removePreferredPodAffinityTerm` | `podAffinity.preferred`를 weight 내림차순 정렬 후 최상위 항 제거 | 항 1개 이상 |
| 3 | `removePreferredPodAntiAffinityTerm` | `podAntiAffinity.preferred`에 동일 로직 | 항 1개 이상 |
| 4 | `removePreferredNodeAffinityTerm` | `nodeAffinity.preferred`에 동일 로직 | 항 1개 이상 |
| 5 | `removeTopologySpreadScheduleAnyway` | `whenUnsatisfiable: ScheduleAnyway`인 **첫 항목**을 swap-remove | 정렬 없이 선언 순서대로 스캔 → 제거 순서가 spec 작성 순서에 의존한다 |
| 6 | `toleratePreferNoScheduleTaints` | `Exists` + `PreferNoSchedule` toleration 추가 | **NodePool 중 하나라도 `PreferNoSchedule` taint를 가질 때만** 자동 활성화 — 사용자 옵션이 아니다 |

**직관을 배신하는 지점**: required term 제거(1번)가 preferred 제거(2~4번)보다 먼저다. 단 이건 요구를 약하게 만드는 완화가 아니라 **OR 대안 중 다음 것을 시도**하는 순회다(문서의 "go through each of the `nodeSelectorTerms` in order and take the first one that works"와 같은 동작). 그래서 파드가 만족해야 하는 조건은 약해지지 않고 **좁아진다**. 반면 2~5번은 진짜로 요구를 버린다 — "선호했던 인스턴스가 아닌 것이 떴다"의 답이 여기다.

전역 스위치는 `--preference-policy` / `PREFERENCE_POLICY`, 기본값 `Respect`(**1.4.0**, [core#2122](https://github.com/kubernetes-sigs/karpenter/pull/2122)).

- `Respect`(기본): 위 로직 전체가 동작한다.
- `Ignore`: `NewStrictPodRequirements()`를 써서 애초에 preferred를 요구사항에 넣지 않는다. topology 구성에서도 required만 보고 preferred는 group을 만들지 않으며, topologySpread는 `whenUnsatisfiable != DoNotSchedule`인 항목을 건너뛴다. 결과적으로 완화 2~5단계가 트리거될 일이 거의 없다 — **스케줄 성공률·빈패킹 밀도가 오르고 배치 품질이 떨어지는** 교환이다.

### 3.3 NodePool에 둘 것 vs 파드에 둘 것

| 상황 | NodePool | 파드 | 판정 |
|---|---|---|---|
| 클러스터 전체 하한·상한(on-demand만, amd64만, 세대 하한) | 모든 워크로드에 일괄 강제, 개별 파드가 못 벗어난다 | 워크로드마다 반복, 누락 시 그 축이 무제한 | **NodePool** |
| 팀·워크로드별로 다른 존·타입이 필요 | 넓은 후보군 또는 `Exists`로 상한선만 | 세부 값을 `nodeSelector`/`nodeAffinity`로 좁힌다 | **분담** |
| Karpenter가 모르는 커스텀 라벨을 파드가 요구 | **반드시** `Exists`로 그 키를 선언 | 값은 자유롭게 지정 | **둘 다 필수** |
| 예약 용량 우선 소비(RI·Savings Plan·ODCR) | `weight` 높게 + `limits`로 상한 | 없음 — 몰라도 된다 | **NodePool** |
| capacity-type·arch 기본값(요구 없는 파드의 폴백) | `weight`로 기본 풀 지정 | 없음 | **NodePool** |
| spot 다양성 확보 | `minValues` | 대응 필드가 없다 | **NodePool 전용** |
| 배포 하나에만 적용할 일시적 오버라이드 | 새 NodePool을 만들 만큼은 아니다 | `nodeAffinity`로 국지 처리 | **파드** |
| GPU·가속기 격리 | taint | toleration | **분담** |

원칙 한 줄: **NodePool은 우주를 정의하고 파드는 그 안에서 좁힌다.** NodePool이 정의하지 않은 축은 무제한 허용이므로, 비용·보안 관점에서 강제할 조건은 예외 없이 NodePool에 있어야 한다.

## 4. topologySpread · podAffinity · podAntiAffinity

세 기능은 코드에서 `TopologyGroup`이라는 **동일한 자료구조**로 표현되고 `Type`만 `TopologyTypeSpread`/`TopologyTypePodAffinity`/`TopologyTypePodAntiAffinity`로 갈린다. 같은 조건(키·셀렉터·네임스페이스)을 공유하는 파드들은 해시로 묶여 하나의 인스턴스를 공유하므로, self-anti-affinity를 가진 100개 파드짜리 디플로이먼트도 topology 구조체는 하나다.

시뮬레이션 내 처리 순서가 명시적으로 잡혀 있다 — **base(NodePool ∩ 파드) → volume topology → DRA → topology → 인스턴스 타입 필터링 → reserved offering 예약**. 주석이 이유를 밝힌다: "Topology requirements should come last since they can result in a single domain from a set of compatible domains." 도메인을 하나로 확정해버리면 이후 좁히기 단계가 불필요하게 실패한다.

### 4.1 topologySpreadConstraints

| 항목 | 값 / 동작 |
|---|---|
| 지원 `topologyKey` | `topology.kubernetes.io/zone`, `kubernetes.io/hostname`, `karpenter.sh/capacity-type` **3개뿐** |
| `topology.kubernetes.io/region` | **미지원** — in-tree CSI 레거시 라벨, out-of-tree CSI 사용 권장 |
| `whenUnsatisfiable: DoNotSchedule` | 항상 required. **완화 대상 아님** → 도메인 부족 시 영구 Pending |
| `whenUnsatisfiable: ScheduleAnyway` | 처음엔 required 취급, 실패 시 완화 5단계에서 제거될 수 있다 |
| 스큐 판정 | kube-scheduler와 동일 공식: `count + selfMatch(1|0) - globalMin <= maxSkew` |
| `minDomains` | "지원 가능한 도메인 수가 minDomains 미만이면 전역 min을 0으로 강제" — 스큐 계산을 느슨하게 만들어 **새 도메인 개방을 유도**한다 |
| `nodeAffinityPolicy` / `nodeTaintsPolicy` | `TopologyNodeFilter`로 구현. 기본값 taints=`Ignore`, affinity=`Honor`. `Honor`면 파드의 `nodeSelector`+required term을 재사용해 조건 불일치 노드를 스프레드 카운트에서 뺀다. **이 필터는 TSC에만 붙는다** — affinity 계열은 항상 전체 노드를 센다 |
| `matchLabelKeys` | 파드 자신의 라벨 값을 셀렉터에 주입해 처리 |

노드가 아직 없는 상태의 도메인 계산이 이 기능의 난점이고, 두 장치로 해결한다.

- **hostname 특수취급**: 아직 등록되지 않은 신규 NodeClaim에 대해 전역 min을 0으로 가정한다 — "새 노드를 만들면 그게 곧 min"이라는 계산.
- **NodePool이 도메인 우주를 제한**: `buildDomainGroups()`가 각 NodePool의 requirements(+labels)와 인스턴스 타입 requirements를 교차해 "이 NodePool이 만들 수 있는 노드가 가질 수 있는 topology-key별 값 전체"를 만든다. 주석: "This ensures that something like zones from an instance type don't expand the universe of valid domains." **NodePool이 `us-west-2a`만 허용하면 인스턴스 타입이 실제로 5개 존에 다 있어도 topology 계산은 존 하나만 본다** — zone 스프레드가 조용히 무의미해지는 경로다.

### 4.2 podAffinity / podAntiAffinity

| 항목 | 동작 |
|---|---|
| required / preferred | **둘 다 topology group을 만든다**(`Respect`일 때). 주석: "include both soft and hard affinity terms" — preferred도 도메인 카운트에 실제로 영향을 준다 |
| self-selecting anti-affinity | `nextDomainAntiAffinity()`가 "매치되는 파드가 0인 도메인"만 후보로 삼는다 → 빈 도메인부터 하나씩 채우는 배치가 자연히 나온다 |
| hostname 부트스트랩 | 실재하지 않는 NodeClaim에 대해 "이 노드가 self-selecting 파드의 첫 인스턴스라면 후보로 인정"하는 분기가 있다 |
| 역방향(inverse) 추적 | 기존 파드를 스캔해 anti-affinity를 가진 파드를 `inverseTopologyGroups`로 추적한다 — "A가 B를 피하는데 B는 아무 제약이 없는" 케이스 대응 |
| **preferred inverse anti-affinity** | **의도적으로 추적하지 않는다.** 주석: "We intentionally don't track inverse anti-affinity preferences... the pod we are relaxing is not the pod with the anti-affinity term" |
| `namespaceSelector` | term의 `namespaces` + `namespaceSelector`를 합쳐 표준대로 처리 |
| `topologyKey` 화이트리스트 | `newForAffinities()`는 임의의 키를 받아 group을 만들며 **명시적 검증이 코드에 없다.** 다만 §4.1의 도메인 우주가 NodePool requirements에 값이 있는 키에만 채워지므로, NodePool이 그 키에 requirement가 없으면 도메인 후보가 비어 실질적으로 매치되지 않는다 — **업스트림 문서에도 이 케이스 서술이 없다** |

### 4.3 실패 패턴과 진단

| 증상 | 원인 | 확인 |
|---|---|---|
| `DoNotSchedule` TSC를 여러 개 겹쳤는데 영구 Pending | required라 완화 경로가 없다 | 파드 `FailedScheduling` 메시지 + NodePool의 zone requirement |
| zone 스프레드를 걸었는데 한 존에만 뜬다 | NodePool의 zone requirement가 이미 하나로 좁혀져 도메인 우주가 1개 | `kubectl get nodepool -o yaml`의 `topology.kubernetes.io/zone` |
| 다른 팀 파드가 내 파드를 피해줄 줄 알았는데 같은 노드에 온다 | 그쪽이 **preferred** anti-affinity를 썼다 → 절대 반영되지 않는다 | 상대 파드의 `preferredDuringScheduling` 여부. required로 바꾸는 것 외에 방법 없음 |
| 노드가 필요 이상으로 뜬다 | preferred/`ScheduleAnyway`를 required처럼 만족시키려 새 노드를 만든다 | `PREFERENCE_POLICY=Ignore` 검토(배치 품질과의 교환) |
| consolidation이 진행되지 않는다 | preferred anti-affinity·TSC가 있으면 consolidation도 이를 만족시키려 노드를 안 건드린다 | 로그 `pod ... has a preferred Anti-Affinity which can prevent consolidation`, `karpenter_voluntary_disruption_failed_validations_total` |

## 5. well-known labels 레퍼런스

well-known 라벨은 Karpenter가 **인스턴스 속성으로부터 스스로 도출**하는 라벨이라 requirements·nodeSelector에 쓰면 노드 속성을 실제로 강제한다. 반대로 모르는 키는 아무것도 강제하지 못한다 — 문서가 경고하는 대표 예가 `karpenter.k8s.aws/instance-family`(강제됨) vs `node.kubernetes.io/instance-family`(커스텀 취급, 무효)다.

### 5.1 Kubernetes 표준

| 키 | 값 예시 | NodePool에서 | 파드에서 | 비고 |
|---|---|---|---|---|
| `topology.kubernetes.io/zone` | `us-east-2a` | 존 허용 범위 | 존 선택 · TSC 키 | topology 도메인 우주가 여기서 정해진다(§4.1) |
| `topology.kubernetes.io/region` | `us-east-2` | 사실상 불필요 | 사용 가능 | **TSC topologyKey로는 미지원** |
| `node.kubernetes.io/instance-type` | `g4dn.8xlarge` | 후보 타입 목록. 단일 값 고정은 안티패턴 | 특정 타입 요구 | `Exists` + `minValues`로 다양성 하한을 거는 대상 |
| `kubernetes.io/arch` | `amd64` `arm64` | 아키텍처 강제 | 바이너리에 맞춰 선택 | 멀티아키 이미지가 없으면 파드 쪽 필수 |
| `kubernetes.io/os` | `linux` `windows` | OS 강제 | 선택 | — |
| `karpenter.sh/capacity-type` | `spot` `on-demand` `reserved` | 구매옵션 허용 범위 | **`nodeSelector` 쓰지 말 것**(§6) | well-known **값**까지 고정 |
| `node.kubernetes.io/windows-build` | `10.0.26100` | 빌드 지정 | 선택 | WS2019 `10.0.17763` · WS2022 `10.0.20348` · WS2025 `10.0.26100` |
| `karpenter.sh/nodepool` | `default` | **금지**(검증 실패) | 특정 풀에 묶기 | — |
| `kubernetes.io/hostname` | — | **금지** | **금지** | `RestrictedLabels`. TSC의 topologyKey로는 사용 가능 |

### 5.2 AWS 특화

| 키 | 값 예시 | NodePool에서 | 파드에서 | 비고 |
|---|---|---|---|---|
| `karpenter.k8s.aws/instance-category` | `c` `m` `r` `g` | 카테고리 허용 목록 | 드묾 | `minValues`로 다양성 강제 |
| `karpenter.k8s.aws/instance-family` | `m7i` `g4dn` | 패밀리 허용·배제 | 드묾 | `Exists` + `minValues`가 스팟 다양성의 실무 표준 |
| `karpenter.k8s.aws/instance-generation` | `4` | **`Gte`로 세대 하한** | 드묾 | `Gte`/`Lte`는 v1.9.0+ |
| `karpenter.k8s.aws/instance-size` | `8xlarge` | 크기 제한 | 드묾 | 문자열이라 `Gt`/`Lt` 무의미 |
| `karpenter.k8s.aws/instance-cpu` | `32` | `Gte`/`Lte`로 코어 범위 | 최소 코어 | 숫자형 |
| `karpenter.k8s.aws/instance-memory` | `131072` | `Gte`/`Lte`로 MiB 범위 | 최소 메모리 | 숫자형 |
| `karpenter.k8s.aws/instance-cpu-manufacturer` | `aws` `intel` `amd` | Graviton 전용 풀 | 드묾 | `-cpu-sustained-clock-speed-mhz`(`3600`)는 `Gte`로 클럭 하한 |
| `karpenter.k8s.aws/instance-capability-flex` | `true` `false` | **`In ["false"]`로 flex 배제** | 드묾 | **1.7**([aws#8315](https://github.com/aws/karpenter-provider-aws/pull/8315) → 개명 [aws#8490](https://github.com/aws/karpenter-provider-aws/pull/8490)). `DoesNotExist`는 전체 배제 사고(§9) |
| `karpenter.k8s.aws/instance-local-nvme` | `900` | `Gte`로 GiB 하한 | 로컬 디스크 요구 | `instanceStorePolicy: RAID0` 없이는 볼륨이 무시된다 |
| `karpenter.k8s.aws/instance-gpu-name` / `-manufacturer` / `-count` / `-memory` | `t4` / `nvidia` / `1` / `16384` | 모델·제조사 고정, 개수·MiB는 `Gte` | 모델 요구 | `nvidia.com/gpu` 리소스 요청과 병행. 뒤 둘은 숫자형 |
| `karpenter.k8s.aws/instance-network-bandwidth` / `-ebs-bandwidth` / `instance-pods` | `131072` / `9500` / `110` | `Gte`로 Mbps·파드 밀도 하한 | — | 숫자형 |
| `karpenter.k8s.aws/instance-hypervisor` / `-encryption-in-transit-supported` | `nitro` / `true` | Nitro 전용·전송 암호화 지원 타입만 | — | 컴플라이언스 요건에 사용 |
| `karpenter.k8s.aws/instance-tenancy` | `default` `dedicated` | dedicated 전용 풀 | — | **1.9**([aws#8218](https://github.com/aws/karpenter-provider-aws/pull/8218)). well-known 값 고정 |
| `karpenter.k8s.aws/capacity-reservation-id` / `-type` / `-interruptible` | `cr-56fac...` / `capacity-block` / `true` | 특정 예약·capacity block 격리 | 예약 노드 선택 | **reserved 노드에만 존재** |
| `karpenter.k8s.aws/placement-group-id` / `-partition` | `pg-0fa32...` / `7` | placement group 사용 | — | **1.11**([aws#9030](https://github.com/aws/karpenter-provider-aws/pull/9030)), IAM `ec2:DescribePlacementGroups` 필요 |
| `karpenter.k8s.aws/ec2nodeclass` | `default` | (자동 부여) | 특정 NodeClass 노드 선택 | — |
| `topology.k8s.aws/zone-id` | `use1-az1` | 계정 간 일관된 AZ 지정 | 계정 간 존 정렬 | 계정마다 zone 이름 매핑이 달라지는 문제를 피한다 |

라벨은 아니지만 같은 층위로 쓰이는 확장 리소스: `nvidia.com/gpu`, `amd.com/gpu`, `aws.amazon.com/neuron`, `aws.amazon.com/neuroncore`, `habana.ai/gaudi`, `vpc.amazonaws.com/pod-eni`, `vpc.amazonaws.com/efa`. 파드가 이 리소스를 요청하면 Karpenter가 해당 가속기를 가진 타입을 고른다.

Nitro Enclaves 지원 여부와 `instance-accelerator-name`/`-manufacturer`/`-count`(Neuron 등 non-GPU 가속기) 계열은 코드에 well-known으로 등록돼 있으나 **업스트림 문서 표에 누락**되어 값 예시를 확인할 수 없다 — 키 존재만 적는다.

### 5.3 커스텀 라벨과 restricted 도메인

- `karpenter.sh/*`·`karpenter.k8s.aws/*` 아래에는 **사용자가 새 라벨을 만들 수 없다.** `IsRestrictedLabel()`이 도메인 접미사까지 검사해 거부한다.
- Karpenter가 모르는 커스텀 라벨을 파드가 요구하면, NodePool이 `Exists`로 그 키를 선언하지 않는 한 노드를 못 띄우고 파드는 계속 Pending이다.

```yaml
spec:
  template:
    metadata:
      labels:
        team: platform          # 이 풀이 만드는 노드에 항상 붙는 라벨
    spec:
      requirements:
      - key: user.defined.label/type
        operator: Exists        # "이 키를 안다" — 값은 파드가 정한다
```

### 5.4 조합 레시피

**① arm64 전용 (Graviton)**

```yaml
- key: kubernetes.io/arch
  operator: In
  values: ["arm64"]
- key: karpenter.k8s.aws/instance-cpu-manufacturer
  operator: In
  values: ["aws"]
- key: karpenter.k8s.aws/instance-family
  operator: Exists
  minValues: 3
```

**② 최신 세대 이상만** — 구세대의 성능·가격 함정 회피.

```yaml
- key: karpenter.k8s.aws/instance-category
  operator: In
  values: ["c", "m", "r"]
- key: karpenter.k8s.aws/instance-generation
  operator: Gte          # v1.9.0+. 그 미만은 Gt: ["5"]
  values: ["6"]
```

**③ spot 다양성 확보** — 동시 회수 리스크 분산.

```yaml
- key: karpenter.sh/capacity-type
  operator: In
  values: ["spot"]
- key: karpenter.k8s.aws/instance-family
  operator: Exists
  minValues: 5
- key: node.kubernetes.io/instance-type
  operator: Exists
  minValues: 15          # spot-to-spot consolidation 하한과 정렬
```

15는 임의값이 아니다. single-node spot-to-spot consolidation은 교체 후보 스팟 타입이 15개 미만이면 수행되지 않는다(`MinInstanceTypesForSpotToSpotConsolidation = 15`).

**④ GPU 격리** — taint + 라벨 + 리소스 3점 세트.

```yaml
spec:
  template:
    spec:
      taints:
      - key: nvidia.com/gpu
        effect: NoSchedule
      requirements:
      - key: karpenter.k8s.aws/instance-gpu-manufacturer
        operator: In
        values: ["nvidia"]
      - key: karpenter.k8s.aws/instance-gpu-memory
        operator: Gte
        values: ["16384"]
```

파드 쪽은 toleration + `nvidia.com/gpu: 1` 요청이면 된다. taint가 있으므로 GPU를 요청하지 않는 파드는 이 노드에 안 올라온다.

**⑤ flex(버스터블) 배제**

```yaml
- key: karpenter.k8s.aws/instance-capability-flex
  operator: In
  values: ["false"]      # NotIn ["true"]도 동치. DoesNotExist는 금지(§9)
```

`m7i-flex`·`c7i-flex` 같은 `-flex` 패밀리는 baseline 성능을 낮추고 크레딧 버스트로 저사용률 워크로드를 겨냥한다. 지속 고CPU 워크로드가 올라가면 크레딧 소진 후 baseline으로 떨어져 지연이 튄다. 라벨 값은 인스턴스 타입 문자열의 패밀리 부분에 `-flex`가 있는지로만 판정되고(`instancetype/types.go:261-265`), **모든 타입에 예외 없이 `true` 또는 `false`가 붙는다.**

이 규칙을 나중에 추가하면 **기존 flex 노드가 전부 drift로 잡혀 능동적으로 교체된다** — NodeClaim에 박힌 `instance-capability-flex=true` 라벨이 새 requirements와 호환되지 않기 때문이다. "다음부터 안 쓴다"가 아니라 "지금 있는 것을 몰아낸다"이므로 disruption budget을 먼저 좁히고 점진 롤아웃한다.

**⑥ 로컬 NVMe 노드**

```yaml
# NodePool requirements
- key: karpenter.k8s.aws/instance-local-nvme
  operator: Gte
  values: ["400"]        # GiB
---
apiVersion: karpenter.k8s.aws/v1
kind: EC2NodeClass
metadata:
  name: nvme
spec:
  instanceStorePolicy: RAID0    # 이게 없으면 볼륨이 그냥 무시된다
```

## 6. capacity-type 키워드

값은 `spot`·`on-demand`·`reserved` 세 개로 고정이다(`WellKnownValuesForRequirements`).

| 값 | 의미 | 선택 규칙 |
|---|---|---|
| `reserved` | ODCR·Capacity Block에서 launch된 노드. **1.3 alpha**([core#1911](https://github.com/kubernetes-sigs/karpenter/pull/1911)) → **1.6 beta + 기본 활성**([core#2365](https://github.com/kubernetes-sigs/karpenter/pull/2365)) | 선결제이므로 **가격 0으로 모델링해 최우선 소비**한다. 없거나 워크로드와 안 맞으면 spot/on-demand로 폴백. consolidation에서도 reserved를 우선한다 |
| `spot` | 스팟 | `price-capacity-optimized` 전략 — 최저가가 아니라 **회수 확률까지 반영한 가격-용량 최적** |
| `on-demand` | 온디맨드 | 위 둘이 불가할 때의 기본 |

```yaml
- key: karpenter.sh/capacity-type
  operator: In
  values: ["reserved", "on-demand", "spot"]   # 목록 순서가 우선순위를 정하지 않는다 — 우선순위는 Karpenter가 정한다
```

사고가 나는 지점 셋.

- **`nodeSelector`로 `on-demand`를 정확 일치시킨 워크로드는 ODCR을 절대 못 쓴다.** `reserved`는 별개 값이라 equality가 매칭되지 않는다. 수정은 `nodeAffinity`의 `In [on-demand, reserved]`다.
- **open eligibility ODCR도 `capacityReservationSelectorTerms`에 명시해야 한다.** Karpenter는 open matching을 지원하지 않는다 — 선언하지 않은 예약은 사용되지 않으면서 과금은 계속된다.
- **예약이 만료·취소되면 라벨이 자동으로 `on-demand`로 바뀐다.** reserved 노드를 라벨로 골라내는 모니터링·워크로드는 이 전환을 고려해야 한다.

Capacity Block은 종료 시각이 강제된다. EC2가 종료 시각 **30분 전**(UltraServer는 60분 전)부터 인스턴스를 종료하기 시작하고, Karpenter는 그보다 **10분 더 일찍** 선제 드레인을 시작한다. 인터럽터블 ODCR은 **1.10**([aws#9019](https://github.com/aws/karpenter-provider-aws/pull/9019))부터 launch 소스로 쓸 수 있고 회수 시 인터럽션 경고 경로를 탄다(EventBridge 규칙에 detail-type 추가 필요 — 01/02 참고).

spot 관련 세 키워드:

| 키워드 | 상태 | 내용 |
|---|---|---|
| Spot 인터럽션 | 기본(단 `--interruption-queue` 필수) | 2분 경고. 수신 즉시 드레인 + **병렬로 신규 노드 provisioning** 시작 |
| Spot Rebalance Recommendation | **미지원** | taint/drain/terminate 로직이 없다. NTH를 병행할 수 있으나 노드 churn이 늘어난다 |
| spot-to-spot consolidation(replace) | **alpha, 기본 off**(`SpotToSpotConsolidation=false`, v0.34+) | 켜면 single-node 교체에 **타입 유연성 15개 이상**을 요구한다. multi-node에는 이 요건이 없다 |

spot의 **삭제(deletion) consolidation은 기본으로 켜져 있다** — 꺼져 있는 건 "더 싼 스팟으로 교체"뿐이다. 이 구분을 놓치면 "스팟 consolidation을 껐는데 노드가 지워진다"로 혼란이 생긴다.

## 7. disruption 키워드

배경과 버전별 변경은 01·02가 담당한다. 여기서는 필드와 그 효과만 본다.

### 7.1 consolidation

| 정책 | 대상 노드 | 언제 고르나 |
|---|---|---|
| `WhenEmpty` | 빈 노드만(disruption cost 0인 파드만 남은 노드) | 가장 보수적. 실행 중 파드를 사실상 안 건드린다 |
| `Balanced` | 절감액이 파드 disruption을 능가하는 노드 | **1.14**([core#2962](https://github.com/kubernetes-sigs/karpenter/pull/2962)). NodePool 필드만으로 옵트인, **feature gate 불필요**. 한계 효용이 작은 통합을 건너뛴다 |
| `WhenEmptyOrUnderutilized`(기본) | 비용을 줄일 수 있는 모든 노드 | 최저 비용. 그 대가로 churn을 받는다 |

`consolidateAfter`(기본 `0s`)는 "노드에 새 작업이 안 들어오길 기다리는 시간"이고 파드가 추가·제거될 때마다 리셋된다. `Never`면 그 NodePool의 consolidation이 완전히 꺼진다.

메커니즘은 **Empty(빈 노드 병렬 삭제) → Multi Node(2개 이상 삭제, 필요시 더 싼 대체 1개) → Single Node**의 순서로 시도된다. 코드상 전체 파이프라인은 `Emptiness → StaticDrift → Drift → MultiNodeConsolidation → SingleNodeConsolidation`이다. `Balanced`는 절감 비율 대 disruption 비율을 점수화해 임계값을 넘을 때만 실행하고(`k = 2` 고정), 결과를 `ConsolidationApproved` 이벤트와 `karpenter_consolidation_score`·`karpenter_consolidation_moves_total`로 노출한다.

### 7.2 drift — 무엇을 바꾸면 교체가 일어나나

| 리소스 | drift를 유발하는 필드 |
|---|---|
| NodePool | `spec.template.spec.requirements` (그리고 `expireAfter`·`terminationGracePeriod`·`nodeClassRef` 변경) |
| EC2NodeClass | `spec.subnetSelectorTerms`, `spec.securityGroupSelectorTerms`, `spec.amiSelectorTerms` |
| **drift 아님**(behavioral) | NodePool의 `spec.weight`, `spec.limits`, `spec.disruption.*` |

특수 케이스 셋이 실무 사고의 대부분이다.

- **넓히는 변경은 drift가 아니다.** `instance-type In [m5.large]` → `In [m5.large, m5.2xlarge]`는 기존 값이 여전히 호환되므로 교체가 없다. 반대로 **좁히는 변경은 drift다.**
- **CRD를 안 바꿨는데 drift가 난다.** `amiSelectorTerms`가 새 AMI를 resolve하면 그 자체로 drift다. `alias: al2023@latest`는 새 AMI 릴리스마다 전체 노드를 교체한다 — 문서가 production 비권장으로 명시한다.
- **`spec.disruption.*`만 바꿔 노드 교체를 기대하면 안 된다.** behavioral field라 drift가 나지 않는다.

감지는 해시 비교다 — `karpenter.sh/nodepool-hash`, `karpenter.k8s.aws/ec2nodeclass-hash`, `compatibility.karpenter.k8s.aws/kubelet-drift-hash`가 NodeClaim에 기록되고 소유 리소스의 값과 다르면 drift다.

### 7.3 expireAfter · terminationGracePeriod · budgets

| 키 | 기본값 | 성격 | 알아둘 것 |
|---|---|---|---|
| `spec.template.spec.expireAfter` | `720h`(30일), `Never` 가능 | **forceful** — 조건 충족 즉시 드레인, 대체 노드를 기다리지 않는다 | **최대** 수명이지 최소가 아니다. drift·consolidation이 더 먼저 지울 수 있다. NodePool에서 바꿔도 기존 NodeClaim에는 반영되지 않고 drift로 교체된다 |
| `spec.template.spec.terminationGracePeriod` | 미설정(무한 대기) | 드레인 시작 후 이 시간이 지나면 **PDB·`do-not-disrupt` 무시하고 강제 종료** | 파드의 `terminationGracePeriodSeconds`를 온전히 주려고 `노드 TGP − 파드 TGPS` 시점에 선제 삭제한다. 파드 TGPS가 노드 TGP보다 크면 드레인 시작 즉시 삭제된다 |
| `spec.disruption.budgets` | `[{nodes: "10%"}]` | **자발적** disruption만 rate-limit | 퍼센트는 `roundup(total × pct) − deleting − notready`. 여러 budget이 겹치면 **최솟값**. `[{nodes: "0"}]`으로 NodePool 전체 차단 |
| `budgets[].reasons` | 미지정 = 전체 | `Drifted`·`Underutilized`·`Empty` 3종 | 특정 reason 허용량은 "그 reason을 포함하거나 reasons를 안 지정한 모든 budget의 최솟값" |
| `budgets[].schedule` + `.duration` | 없음(항상 active) | cron + Go duration(분·시간 단위) | 둘은 항상 같이 쓴다. **타임존 미지원 — 항상 UTC** |

budget이 막지 못하는 것: Expiration·Interruption·Node Repair. 이들은 forceful 경로라 rate-limit 대상이 아니다. 그리고 `expireAfter`를 설정하면서 `terminationGracePeriod`를 빼면 위험하다 — 만료된 노드가 PDB나 `do-not-disrupt` 파드에 막혀 **부분 드레인 상태로 무기한 남고 비용만 누적된다.** 문서가 직접 경고하는 조합이다.

### 7.4 `karpenter.sh/do-not-disrupt`가 막는 것과 못 막는 것

파드·노드 양쪽에 붙이는 annotation이고 값은 두 형태다.

| 형태 | 예 | 동작 |
|---|---|---|
| Boolean | `"true"` | 영구 보호 |
| Duration | `"30m"` | 파드가 Running 된 후 그 기간만 보호. **1.12**([core#2874](https://github.com/kubernetes-sigs/karpenter/pull/2874)). 잘못된 duration은 무시되고 파드에 이벤트가 남는다 |

| 대상 | 막나 |
|---|---|
| Consolidation | **막는다** — 노드가 후보군에서 제외된다 |
| Drift | **조건부** — NodeClaim에 `terminationGracePeriod`가 있으면 **막지 못한다**(CVE 패치를 강제 배포하기 위한 의도적 설계) |
| Expiration · Interruption · Node Repair · 수동 삭제 | **막지 못한다** |

Interruption과 Node Repair는 암묵적 상한(스팟 2분, 톨러레이션 시간)이 있지만 **Expiration과 수동 삭제는 상한이 없다.** `terminationGracePeriod` 없이 이 조합을 만나면 사람이 개입해야 한다.

disruption 대상 노드에는 `karpenter.sh/disrupted:NoSchedule` taint가 붙는다 — **키만 있고 값은 없다.** 오래된 설계 문서에 나오는 `karpenter.sh/disruption=disrupting` 형태는 현재 구현이 아니다. 이 taint를 tolerate하는 워크로드가 있으면 키 형태를 맞춰야 한다. 등록 전 노드에 붙는 `karpenter.sh/unregistered:NoExecute`는 registration 완료 시 제거된다.

## 8. NodeClaim · NodeClass 키워드

### 8.1 NodeClaim status conditions — 진단용

`Ready`는 상수가 아니라 `Launched ∧ Registered ∧ Initialized`의 자동 집계다.

| Condition | 의미 | False/Unknown이면 의심할 것 |
|---|---|---|
| `Launched` | 클라우드 인스턴스 생성 완료 | EC2 API 실패, quota·capacity 부족(ICE), IAM 권한. **5분 내 launch 못 하면 재시도**(1.7, [core#2349](https://github.com/kubernetes-sigs/karpenter/pull/2349)) |
| `Registered` | 인스턴스가 Node로 join, label·taint·ownerRef sync 완료 | kubelet 부트스트랩 실패, API 서버 도달 불가, 보안그룹·서브넷 오설정. **15분 내 안 되면 NodeClaim 삭제 + 인스턴스 종료** |
| `Initialized` | 노드 Ready, startup taint 제거, 요청 리소스 등록 완료 | startup taint를 제거할 DaemonSet 미배포, 리소스 등록 지연 |
| `Ready` | 위 3개 집계 | 셋 중 무엇이 막혔는지 확인 |
| `Consolidatable` | consolidation 후보(empty 또는 underutilized) | 문제 상태가 아니다 |
| `Drifted` | desired spec과 불일치 | §7.2. drift가 해소되면 자동 제거 |
| `Drained` | 종료 중 파드가 모두 drain됨 | PDB 차단, `do-not-disrupt` 파드 잔존 |
| `VolumesDetached` | 모든 VolumeAttachment 제거됨 | CSI detach 지연·실패 |
| `InstanceTerminating` | 인스턴스 종료 진행 중 | — |
| `ConsistentStateFound` | 내부 상태와 실제 인스턴스 상태 일치 | 클라우드-K8s 상태 불일치 |
| `DisruptionReason` | 어떤 사유로 disrupt됐는지 기록 | — |

NodePool 조건은 `ValidationSucceeded`·`NodeClassReady`·`NodeRegistrationHealthy` 3종이고 `Ready`는 앞 둘의 집계다. **`NodeRegistrationHealthy`는 NodeClaim이 아니라 NodePool의 조건**이고(1.4, [core#1969](https://github.com/kubernetes-sigs/karpenter/pull/1969)) 현재는 관찰용이다 — 스케줄링 페널티로 연결되지 않는다. 판정 메커니즘(링버퍼 4칸·실패 비율 0.5)과 이것이 세대 폴백을 구제하지 못하는 이유는 [07 용량이 없을 때]({{< relref "07-ice-fallback.md" >}}) §7에 있다. EC2NodeClass 조건은 `AMIsReady`·`SubnetsReady`·`SecurityGroupsReady`·`InstanceProfileReady`·`ValidationSucceeded`·`PlacementGroupReady` 6종(+ capacity reservation을 쓰면 `CapacityReservationsReady` 추가)과 그 전체의 집계인 `Ready`이고(`AWS/pkg/apis/v1/ec2nodeclass_status.go:169-181`), **NodeClass가 Ready가 아니면 이를 참조하는 NodePool은 스케줄링 대상에서 제외**된다(`core/pkg/controllers/provisioning/provisioner.go:276`).

### 8.2 EC2NodeClass에서 운영이 실제로 손대는 필드

| 필드 | 하는 일 | 주의 |
|---|---|---|
| `amiSelectorTerms` / `alias` | AMI 선택. v1에서 **필수** | `alias`는 단독으로만. `@latest`는 새 AMI마다 전체 drift — production은 버전 pin |
| `kubelet` | maxPods, podsPerCore, kube-reserved, eviction 임계값 | v1에서 NodePool → EC2NodeClass로 이동. NodePool:NodeClass가 N:1이므로 풀별로 다른 kubelet 설정이 필요하면 **NodeClass를 분리**해야 한다 |
| `blockDeviceMappings` | 루트·데이터 볼륨 크기·타입·IOPS | `volumeInitializationRate`로 스냅샷 프리워밍 처리량 지정 |
| `instanceStorePolicy` | `RAID0`이면 instance-store를 ephemeral-storage로 편성 | **미설정이면 그냥 무시된다**(§5.4 ⑥) |
| `capacityReservationSelectorTerms` | 사용할 ODCR·Capacity Block 선택(`tags`/`id`/`instanceMatchCriteria`) | **open eligibility 예약도 반드시 명시**(§6) |
| `metadataOptions` | IMDS 설정. `httpPutResponseHopLimit` 기본값이 v1에서 **1** | hop 1이면 hostNetwork 아닌 파드는 IMDS에 접근 못 한다 |
| `subnetSelectorTerms` / `securityGroupSelectorTerms` | 네트워크 배치. **drift 판정 대상** | 서브넷을 넓히면 존 우주가 넓어진다(§4.1) |
| `tags` | 인스턴스·볼륨 태그 | 비용 배분 태그의 근원 |
| `connectionTracking` | conntrack 타임아웃(TCP established, UDP stream, UDP) | **1.13**([aws#9152](https://github.com/aws/karpenter-provider-aws/pull/9152)) |
| `placementGroupSelector` / `networkInterfaces` | placement group · ENI 구성 | **1.11**([aws#9030](https://github.com/aws/karpenter-provider-aws/pull/9030) · [aws#9027](https://github.com/aws/karpenter-provider-aws/pull/9027)) |
| `role` / `instanceProfile` | 노드 IAM. `role`은 **1.7**부터 생성 후 변경 가능([aws#8249](https://github.com/aws/karpenter-provider-aws/pull/8249)) | instance profile 경로 구조가 1.7에서 바뀌었다(01/02 참고) |
| `userData` | 부트스트랩. amiFamily별 merge 방식이 다르다 | AL2023은 NodeConfig(YAML), AL2는 bash·MIME |

### 8.3 확장 키워드 — 한 줄 정의

| 키워드 | 정의 | 상태 |
|---|---|---|
| **NodeOverlay** | 인스턴스 offering의 가격·가용성·용량을 오버레이 CRD로 보정한다. 공개 가격 데이터가 없는 preview 타입도 이 게이트 아래에서 고려 가능(1.14, [aws#9249](https://github.com/aws/karpenter-provider-aws/pull/9249)) | alpha, `NodeOverlay=false`. **1.7**([aws#8305](https://github.com/aws/karpenter-provider-aws/pull/8305)) |
| **Capacity Buffer** | virtual pod(실제 파드 없이 시뮬레이션에만 존재)로 headroom을 예약한다. pause-pod 트릭과 달리 preemption 오버헤드가 없고, buffer가 있는 노드를 consolidation이 empty로 오판하지 않는다 | API는 `autoscaling.x-k8s.io/v1beta1`(1.14, [core#3129](https://github.com/kubernetes-sigs/karpenter/pull/3129))이지만 게이트는 여전히 `CapacityBuffer=false` |
| **Static Capacity**(`spec.replicas`) | NodePool을 고정 노드 수 모드로 만든다. consolidation 대상에서 빠지고 `limits`는 `limits.nodes`만, `weight` 지정 불가. 한번 설정하면 dynamic으로 되돌릴 수 없다 | alpha, `StaticCapacity=false`. **1.8**([core#2521](https://github.com/kubernetes-sigs/karpenter/pull/2521)) |
| **Node Auto Repair** | 진단 에이전트가 붙인 unhealthy 컨디션이 톨러레이션 시간을 넘으면 표준 drain·grace period를 **우회**해 강제 교체한다. NodePool의 20% 초과가 unhealthy면 repair를 멈춘다 | alpha, `NodeRepair=false`. **1.1**. Node Monitoring Agent·NPD가 없으면 아무 일도 안 한다 |

넷 다 기본 off이고, 켤지 여부의 판단 근거는 02가 담당한다.

## 9. 안티패턴

| 잘못된 설정 | 증상 | 올바른 설정 |
|---|---|---|
| `instance-type`을 단일 값으로 고정 | 그 타입의 가용성·가격에 전적으로 의존. ICE가 나면 폴백 여지가 없다 | 목록으로 나열하거나 `instance-category` + `Gte` 세대 조건으로 넓히고 `minValues`로 하한을 건다 |
| `minValues` 없이 여러 패밀리를 나열하고 spot 다양성을 기대 | 스케줄러가 다양성을 강제하지 않아 한 패밀리로 몰릴 수 있다 → 동시 회수 리스크 | `instance-family Exists minValues: 5` + `instance-type Exists minValues: 15`(§5.4 ③) |
| `instance-capability-flex`에 `DoesNotExist` | **인스턴스 타입 전체가 배제**된다. 이 라벨은 모든 타입에 true/false로 채워지므로 빈 집합과의 교집합이 항상 공집합이다. 신규 노드가 하나도 안 뜨고 기존 노드는 전부 drift | `In ["false"]` |
| `NotIn`을 계속 누적 | 배제 목록만 합쳐져 실질 허용 폭이 안 보이게 좁아진다. 커스텀 키에 걸면 `Compatible()`이 정의 없이도 통과시켜 오타를 못 잡는다 | 허용 목록(`In`)으로 뒤집는다. 무엇이 허용되는지가 설정에 그대로 보인다 |
| 존재하지 않는(오타) 라벨을 파드가 요구 | 커스텀 취급되어 노드를 못 띄우고 파드 영구 Pending. typo 힌트는 로그를 봐야만 안다 | 도메인 확인(`karpenter.k8s.aws/...` vs `node.kubernetes.io/...`), 커스텀 키면 NodePool에 `Exists` 선언 |
| 파드 affinity로 NodePool을 대체하려는 시도 | 조직 차원 강제가 안 된다. 요구를 빠뜨린 워크로드가 그 축에서 무제한 오퍼링을 얻는다 | 강제할 조건은 NodePool `requirements`, 개별 선호는 파드(§3.3) |
| preferred affinity를 가벼운 힌트로 남발 | Karpenter가 처음엔 required로 취급해 **노드를 필요 이상으로 만든다.** consolidation도 막힌다 | 진짜 필요하면 required로, 아니면 지운다. 전역으로는 `PREFERENCE_POLICY=Ignore` 검토 |
| `DoNotSchedule` TSC를 여러 개 타이트하게 겹침 | required라 완화 경로가 없다 → 도메인 부족 시 영구 Pending | 하나만 `DoNotSchedule`, 나머지는 `ScheduleAnyway`. NodePool의 존 requirement도 함께 확인 |
| `do-not-disrupt`로 모든 중단을 막았다고 착각 | Expiration·Interruption·Node Repair·수동 삭제는 못 막고, TGP가 있으면 drift도 못 막는다. `expireAfter`만 걸고 TGP를 빼면 부분 드레인 노드가 무기한 잔존한다 | PDB로 애플리케이션 가용성을, `expireAfter` + `terminationGracePeriod`(항상 함께)로 노드 수명 상한을 관리 |
| `spec.disruption.*`만 바꿔 노드 교체를 기대 | behavioral field라 drift가 나지 않는다 | `requirements`·NodeClass 셀렉터를 바꾸거나 NodeClaim을 직접 삭제 |
| NodePool을 겹치게(비배타적) 설계 | weight 최고인 것만 쓰이고 나머지는 죽은 설정 | mutually exclusive하게 나누고 폴백만 weight로 표현 |
| `karpenter.sh/*`·`karpenter.k8s.aws/*` 아래 커스텀 라벨 생성, 또는 `karpenter.sh/nodepool`을 requirements에 명시 | restricted domain·명시적 검증으로 거부 → 배포 자체가 안 된다 | 자체 도메인을 쓰고 `Exists` 선언. `karpenter.sh/nodepool`은 파드 쪽에서만 |
| `nodeSelector: {karpenter.sh/capacity-type: on-demand}` | equality라 `reserved` 노드에 안 뜬다 → ODCR을 못 쓴다 | `nodeAffinity`의 `In [on-demand, reserved]` |

## 10. 근거

경로는 `AWSDOC` = `karpenter-provider-aws/website/content/en/docs/`, `CORE` = `karpenter-core/pkg/`, `AWS` = `karpenter-provider-aws/pkg/` 기준.

| 확인한 것 | 출처 |
|---|---|
| 제약 3층, 파드 요구가 NodePool의 부분집합, 미정의 축은 무제한, NodePool 배타성 권고 | `AWSDOC/concepts/scheduling.md:17-21`, `concepts/nodepools.md:23,214` |
| 교집합 검증 코드, `Compatible()`의 well-known vs 커스텀 분기, 실패 이벤트·로그 문구 | `CORE/controllers/provisioning/scheduling/{nodeclaim.go:130-136, events.go:53-72, scheduler.go:161-166,605}`, `CORE/scheduling/requirements.go:176-197,253-274` |
| 연산자 8종·값 개수 검증·`Gte`/`Lte` 정규화·정수 파싱 조건·교집합 규칙·도입 버전 | `CORE/apis/v1/nodeclaim_validation.go:33-42,140-158`, `CORE/scheduling/requirement.go:81-100,186-191,334-350`, `requirements.go:132-140`, CEL `CORE/apis/v1/nodepool.go:227-234`, `scheduling.md:142-143`, [core#2674](https://github.com/kubernetes-sigs/karpenter/pull/2674)(1.9) · [aws#8822](https://github.com/aws/karpenter-provider-aws/pull/8822) |
| `minValues` 문법·최댓값·100개 상한, MinValuesPolicy와 relaxed annotation | `nodepools.md:298-340`, `scheduling.md:204-206`, `AWSDOC/reference/settings.md`, `CORE/apis/v1/labels.go:55`, `scheduler.go:763-771`, [core#2299](https://github.com/kubernetes-sigs/karpenter/pull/2299) · [aws#8250](https://github.com/aws/karpenter-provider-aws/pull/8250)(1.6) |
| `weight`·`limits`·`limits.nodes`, weight가 보장이 아닌 이유, nodepool 라벨 금지 | `nodepools.md:157-160,408-421,448-450`, `scheduling.md:511-596`, `CORE/apis/v1/nodepool_validation.go:51-58`, [core#2526](https://github.com/kubernetes-sigs/karpenter/pull/2526)(1.11) |
| preferred를 required로 취급 + 완화 6단계 + PreferencePolicy | `CORE/controllers/provisioning/scheduling/preferences.go:38-146`, `scheduler.go:146-153,521-560`, `CORE/scheduling/requirements.go:96-101`, `scheduling.md:227-235,248,304-308`, [core#2122](https://github.com/kubernetes-sigs/karpenter/pull/2122)(1.4) |
| TSC 지원 키 3종·region 미지원·스큐 공식·minDomains·NodeInclusionPolicy·도메인 우주, podAffinity 계열 처리·self-selecting·inverse preferred 제외·처리 순서 | `scheduling.md:398-401,508`, `CORE/controllers/provisioning/scheduling/{topologygroup.go:90-98,229-341,404-419, topologynodefilter.go:28-97, topology.go:105-143,311-334,492-557, nodeclaim.go:196-208}` |
| well-known 라벨 목록(k8s 표준 / AWS)·restricted 도메인·`Exists` 선언 필요 | `CORE/apis/v1/labels.go:69-153`, `AWS/apis/v1/labels.go:32-64,107-109,134-141`, 문서 표 `scheduling.md:149-208` |
| `instance-capability-flex` 판정 로직·도입/개명·배제 시 기존 노드 drift | `AWS/providers/instancetype/types.go:261-265`, `CORE/controllers/nodeclaim/disruption/drift.go:170-180`, [aws#8315](https://github.com/aws/karpenter-provider-aws/pull/8315) → [aws#8490](https://github.com/aws/karpenter-provider-aws/pull/8490)(1.7) |
| capacity-type 3값·reserved 우선 소비·open ODCR 명시 필요·capacity block 타이밍·라벨 자동 전환, spot 전략·15개 하한·rebalance 미지원 | `AWSDOC/tasks/odcrs.md:38-46,60-99`, `AWSDOC/upgrading/upgrade-guide.md:273`, `CORE/apis/v1/labels.go:98-104`, `concepts/disruption.md:146-151,232-238`, `CORE/controllers/disruption/consolidation.go:47-48`, [core#1911](https://github.com/kubernetes-sigs/karpenter/pull/1911)(1.3) · [core#2365](https://github.com/kubernetes-sigs/karpenter/pull/2365)(1.6) · [aws#9019](https://github.com/aws/karpenter-provider-aws/pull/9019)(1.10) |
| consolidation 정책 3종·`consolidateAfter`·파이프라인 순서·Balanced | `concepts/disruption.md:76-141`, `CORE/controllers/disruption/controller.go:101-114`, `CORE/apis/v1/nodepool.go:97-102,159-175`, [core#2962](https://github.com/kubernetes-sigs/karpenter/pull/2962)(1.14) |
| drift 판정 필드·behavioral field·특수 케이스·해시·`@latest` 경고 | `concepts/disruption.md:156-188`, `concepts/nodeclasses.md:818-823` |
| `expireAfter`·`terminationGracePeriod`·budgets 문법과 기본값, `do-not-disrupt` 두 형태와 막는/못 막는 목록, `disrupted`·`unregistered` taint | `concepts/disruption.md:196-215,285-374,394-461`, `CORE/apis/v1/nodepool.go:104-109,136,178-185`, `CORE/apis/v1/labels.go:50`, `CORE/apis/v1/taints.go:27-41`, [core#2874](https://github.com/kubernetes-sigs/karpenter/pull/2874)(1.12) |
| NodeClaim·NodePool·EC2NodeClass status conditions, launch 5분·registration 15분 타임아웃 | `CORE/apis/v1/{nodeclaim_status.go:25-36,74-79, nodepool_status.go:25-32}`, `concepts/nodeclaims.md`, `concepts/nodeclasses.md:1871-1877`, `CORE/controllers/nodeclaim/lifecycle/liveness.go:52-59`, [core#2349](https://github.com/kubernetes-sigs/karpenter/pull/2349)(1.7) · [core#1969](https://github.com/kubernetes-sigs/karpenter/pull/1969)(1.4) |
| EC2NodeClass 필드(`instanceStorePolicy`·`connectionTracking`·`metadataOptions` 등) | `concepts/nodeclasses.md:1065-1240`, [aws#9152](https://github.com/aws/karpenter-provider-aws/pull/9152) · [aws#9027](https://github.com/aws/karpenter-provider-aws/pull/9027) · [aws#9030](https://github.com/aws/karpenter-provider-aws/pull/9030) · [aws#8249](https://github.com/aws/karpenter-provider-aws/pull/8249) |
| NodeOverlay·Capacity Buffer·Static Capacity·Node Repair 상태, 메트릭 이름·안정성 | `reference/settings.md`(Feature Gates), `reference/metrics.md:45,161,275,297,343`, `CORE/operator/options/options.go:134`, `karpenter-core/designs/{node-overlay,capacity-buffers,static-capacity,node-repair}.md`, [aws#8305](https://github.com/aws/karpenter-provider-aws/pull/8305) · [core#2521](https://github.com/kubernetes-sigs/karpenter/pull/2521) · [core#3129](https://github.com/kubernetes-sigs/karpenter/pull/3129) |
