---
title: "세대 선호 만들기"
weight: 5
aliases: ["/k8s-features/karpenter/02-generation-preference/"]
---

# 05 · 세대 선호 만들기 — weight vs NodeOverlay

{{< callout type="info" >}}
**한눈에**
- **NodePool을 쪼개고 `spec.weight`를 주는 것이 GA 해법이다.** weight는 가격보다 **먼저** 적용된다 — NodePool을 고르는 코드 경로(`scheduler.go` `addToNewNodeClaim`)에는 가격 비교가 아예 없다. `grep -ic price scheduler.go` → **0건**.
- 동작을 정확히 말하면 **"위에서부터 순차 시도"가 아니다.** NodeClaimTemplate들이 **병렬로 시뮬레이션**되고, 뮤텍스 아래에서 **성공한 것 중 인덱스가 가장 앞선(=weight 최고) 것**만 채택된다.
- **파드 쪽에는 아무것도 걸지 않는다.** nodeSelector/affinity는 불필요하고, 오히려 `karpenter.sh/nodepool` 셀렉터를 걸면 weight가 통째로 무시된다(테스트가 못박음).
- **NodeOverlay `priceAdjustment`는 알파다.** feature gate `NodeOverlay`가 **기본 false**고, 세대 선호를 실제로 만드는 건 provider-aws가 EC2 Fleet 전략을 `prioritized`로 바꾸는 지점인데 — 거기에 **확인 못 한 구멍이 둘** 있다(정수 Priority 규정, 단일 CreateFleet 내 폴백 미보장).
- **오버레이를 쓰지 않는 한, 8세대 복귀 장치는 gen7 풀의 `expireAfter` 하나뿐이다.** consolidation은 더 싼 쪽으로만 움직이므로 7→8 승격을 절대 하지 않는다.
- **적용 순서를 틀리면 대량 교체가 난다.** 기존 단일 풀에서 세대를 *빼는* 편집은 RequirementsDrifted를 유발한다. 두 풀을 새로 만든 뒤 기존 풀을 지우는 순서로 간다.
{{< /callout >}}

> **"c8i/m8i/r8i를 먼저 쓰고, 없으면 c7i/m7i/r7i로"는 Karpenter가 1급으로 제공하지 않는 요구다.** `NodePool.spec.template.spec.requirements`의 스키마는 Key/Operator/Values/MinValues뿐이고, 그 안에 선호도를 표현할 필드가 없다([04]({{< relref "04-instance-selection.md" >}})). 업스트림도 이 요구를 두 번 반려했다 — [karpenter#1829](https://github.com/kubernetes-sigs/karpenter/issues/1829) *closed as not planned*, [karpenter-provider-aws#6721](https://github.com/aws/karpenter-provider-aws/issues/6721) *closed*. 이 문서는 남은 두 가지 우회로를 코드까지 내려가 비교하고, **복붙해서 쓸 매니페스트 전문**을 내놓는다.

> 자매 문서: [챕터 개요]({{< relref "_index.md" >}}) · 왜 싼 게 이기는지는 [04 인스턴스는 누가 고르는가]({{< relref "04-instance-selection.md" >}}) · 여기서 만든 선호를 되돌리는 힘은 [06 consolidation이 되돌리는 것]({{< relref "06-consolidation-traps.md" >}}) · 폴백이 실제로 걸리는 타이밍은 [07 용량이 없을 때]({{< relref "07-ice-fallback.md" >}}) · 자매 챕터 [K8s 버전별 신기능]({{< relref "../k8s-features/_index.md" >}})

**검증 기준 버전**: 코어 `kubernetes-sigs/karpenter` **v1.14.0-6-gac7a021e**(로컬 체크아웃), provider-aws는 `main` / `v1.7.0` / `v1.11.3`. 주의 — provider-aws v1.11.3은 코어 **v1.11.2**를 핀한다. 아래 코어 라인번호는 v1.14 기준이라 실제 배포 버전과 몇 줄 어긋날 수 있다.

## 1. 해법 A — NodePool 분리 + `spec.weight`

### 1.1 weight가 가격보다 먼저 적용되는 자리

경로는 두 줄이다. 프로비저너가 NodePool 목록을 weight 내림차순으로 정렬해 템플릿 슬라이스를 만들고,

```go
// pkg/controllers/provisioning/provisioner.go:286-289
// nodeTemplates generated from NodePools are ordered by weight
// since they are stored within a slice and scheduling
// will always attempt to schedule on the first nodeTemplate
nodepoolutils.OrderByWeight(nodePools)
```

스케줄러가 그 슬라이스를 돌며 **더 앞선 인덱스의 성공만 채택**한다.

```go
// pkg/controllers/provisioning/scheduling/scheduler.go:757-761
// Ensure that we always take an earlier successful schedule to keep consistent ordering
// We care about this particularly with NewNodeClaims because NodeClaims should be evaluated by weight
if i >= idx {
	return false
}
```

이 선택 로직 어디에도 가격이 없다. 파일 전체에 대해 `grep -ic price pkg/controllers/provisioning/scheduling/scheduler.go`를 돌리면 **0**이 나온다 — 스케줄러 파일에는 price라는 단어조차 없다. 가격 정렬(`OrderByPrice`)이 개입하는 건 **NodePool이 이미 확정된 뒤**, 그 풀 내부의 인스턴스 타입 목록을 정렬할 때뿐이다(`nodeclaimtemplate.go:113-114`, `ToNodeClaim()` 안).

⇒ **"7세대가 더 싸니까 항상 7세대가 뽑힐 것"이라는 우려는 c7i와 c8i를 한 NodePool에 섞었을 때만 맞다.** 풀을 둘로 나누고 weight를 주는 순간 그 우려가 성립할 자리가 사라진다. 단위 테스트가 이를 못박는다 — `suite_test.go:2814` *"should schedule to the nodepool with the highest priority always"*, 셀렉터 없는 평범한 파드 3개가 전부 weight 100 풀로 간다.

### 1.2 "순차 시도"가 아니라 "병렬 평가 + 최소 인덱스"

여기서 흔히 쓰이는 설명 — *"weight 높은 풀부터 시도하다 실패하면 다음 풀로 내려간다"* — 는 **부정확하다.** `addToNewNodeClaim`은 `parallelizeUntil`로 템플릿들을 **동시에** 시뮬레이션한다. 워커 수는 상수가 아니라 컨트롤러 CPU request에 비례한다:

```go
// pkg/controllers/provisioning/provisioner.go:390
scheduler.NumConcurrentReconciles(int(math.Ceil(float64(options.FromContext(ctx).CPURequests) / 1000.0)))
```

게다가 `parallelizeUntil`의 워커는 `doWorkPiece`가 false를 반환하면 그 자리에서 종료하므로, **남은 템플릿이 아예 평가되지 않는 경우도 있다.** 즉 "모든 템플릿을 평가한다"도 반만 맞다.

그런데도 결과는 결정론적이다. **결정성의 근거는 평가 순서가 아니라 뮤텍스로 보호된 최소 인덱스 리덕션**이다 — 인덱스 3이 먼저 끝나 승자로 앉아 있어도, 나중에 끝난 인덱스 0이 `if i >= idx`를 통과해 그 자리를 빼앗는다. 순서가 아니라 비교식이 순위를 만든다.

이 구분이 실무에서 중요한 이유: **상류 문서가 "항상 최고 weight 풀"을 보장하지 않는다고 명시**하기 때문이다.

> "Based on the way that Karpenter performs pod batching and bin packing, it is not guaranteed that Karpenter will always choose the highest priority NodePool given specific requirements."
> — [karpenter.sh · Weighted NodePools](https://karpenter.sh/docs/concepts/scheduling/#weighted-nodepools)

소스에서 그 원인을 특정할 수 있다. `scheduler.go:598`은 in-flight NodeClaim 목록을 **weight가 아니라 파드 수 오름차순**으로 정렬하고, `:601`의 `addToInflightNode`가 `:607`의 `addToNewNodeClaim`보다 **먼저** 시도된다. 대량 파드가 한꺼번에 pending되는 순간 앞선 파드가 ICE로 gen7 NodeClaim을 하나 만들면, **같은 배치 안의 뒤따르는 파드들이 그 gen7에 빈패킹된다.** "이미 떠 있는 노드" 문제가 아니라 단일 프로비저닝 루프 내부 문제라, 스케일아웃이 몰리는 순간 gen7 비중이 예상보다 크게 튀는 구간이 생긴다.

### 1.3 실제 폴백은 ICE 왕복 한 번을 거친다

코어 스케줄러는 EC2 재고를 모른다. 그래서 첫 시도는 **반드시** gen8로 나가고, 용량이 없다는 사실은 CreateFleet 응답으로만 알 수 있다.

{{< seq caption="gen8 우선이 성립하는 자리와, 폴백이 실제로 걸리기까지의 왕복. 코어는 재고를 모르므로 ICE를 한 번 맞아야 gen7이 승리한다" >}}
{
  "participants": [
    { "id": "pod", "label": "pending 파드" },
    { "id": "sch", "label": "스케줄러" },
    { "id": "nc", "label": "NodeClaim" },
    { "id": "ec2", "label": "EC2 Fleet" }
  ],
  "steps": [
    { "msg": ["pod", "sch"], "label": "배치창 idle 1s / max 10s" },
    { "note": ["sch"], "lines": ["템플릿 병렬 시뮬레이션", "성공한 것 중 최소 인덱스 채택", "(가격 비교 없음)"] },
    { "msg": ["sch", "nc"], "label": "gen8 템플릿 승리 (w=100)" },
    { "msg": ["nc", "ec2"], "label": "CreateFleet · 8세대 후보만" },
    { "alt": "용량 있음", "steps": [
      { "msg": ["ec2", "nc"], "label": "인스턴스 반환", "dashed": true },
      { "msg": ["nc", "pod"], "label": "8세대 노드에 배치", "dashed": true }
    ], "elseLabel": "ICE", "elseSteps": [
      { "msg": ["ec2", "nc"], "label": "ICE 응답", "dashed": true },
      { "note": ["nc", "ec2"], "lines": ["InsufficientInstanceCapacity", "NodeClaim 즉시 삭제 (재큐 없음)", "offering을 3분간 unavailable 마킹"] },
      { "msg": ["nc", "pod"], "label": "다시 pending", "dashed": true },
      { "msg": ["pod", "sch"], "label": "재평가 → gen7 템플릿 승리" }
    ] }
  ]
}
{{< /seq >}}

시간 상수는 셋이다. NodeClaim은 ICE 시 **즉시 삭제되고 재큐되지 않으며**(`launch.go:85-97`), 파드가 다시 pending으로 관측되는 데 PodController의 10초 재큐(`provisioning/controller.go:77`)와 배치창 1~10초(`options.go:129-130`)가 더해진다 — **대략 11~30초**. 그 뒤 3분간은 provider-aws의 `UnavailableOfferingsTTL`(3분) 덕에 재시도 없이 곧바로 gen7이 뽑히고, 3분이 지나면 다시 gen8을 시도한다. 상세는 [07]({{< relref "07-ice-fallback.md" >}}).

### 1.4 파드 쪽에는 아무것도 걸지 마라

`addToNewNodeClaim`은 파드마다 **템플릿 슬라이스 전체를 후보로 삼으므로**(`scheduler.go:705-706`), 제약 없는 평범한 파드가 자동으로 gen8 → gen7 순서를 탄다. 반대 방향의 함정이 하나 있고, 이것도 테스트가 못박고 있다:

```go
// pkg/controllers/provisioning/suite_test.go:2830
It("should schedule to explicitly selected nodepool even if other nodePools are higher priority", ...)
  test.UnschedulablePod(test.PodOptions{NodeSelector: map[string]string{v1.NodePoolLabelKey: targetedNodePool.Name}})
```

`karpenter.sh/nodepool` nodeSelector를 걸면 **weight가 통째로 무시되고** 그 풀로 고정된다 — 대상 풀이 weight 미지정(=0)이어도 그렇다. 폴백을 원한다면 파드에 NodePool을 지정하지 마라.

### 1.5 필드 제약

| 항목 | 값 |
|---|---|
| `spec.weight` 범위 | **1~100**. 0은 CRD가 거부하고, 필드를 **생략**해야 "0 취급"이 된다 |
| `spec.replicas`와의 관계 | **배타.** static NodePool에는 weight를 못 쓴다 |
| 동률 tie-break | **알파벳상 뒤 이름이 먼저.** 직관과 반대다 |
| 후보에서 빠지는 조건 | NodePool이 `Ready` 아님 / 삭제 중 / (게이트 켠 경우) 오버레이 평가 대기 |
| `spec.limits` | 스케줄링 중 사전 필터 + NodeClaim 생성 직전 재검증. `limits: {nodes: "20"}`로 **노드 개수 상한**도 가능 |

근거: weight 범위는 `pkg/apis/v1/nodepool.go:64-67`(`Minimum:=1`, `Maximum:=100`). replicas 배타는 `nodepool.go:41`의 CEL(`replicas`와 `weight`를 동시에 가질 수 없음) + 런타임 `provisioner.go:273-275`의 `IsStatic` 제외로 이중 차단된다. tie-break는 `pkg/utils/nodepool/nodepool.go:157-171`(`return nps[a].Name > nps[b].Name`). 후보 제외는 `provisioner.go:272-282`, `:295-298`(`"skipping, awaiting nodeoverlay evaluation"`). limits는 `scheduler.go:709-726`, `provisioner.go:467-469`.

⇒ 두 풀에는 **반드시 서로 다른 weight를 명시**하라. 동률이면 순위가 이름의 사전순 역순으로 결정되는데, `gen7-fallback` > `gen8-primary`이므로 정확히 원하지 않는 쪽이 이긴다.

## 2. 해법 B — NodeOverlay `priceAdjustment` (알파)

NodePool을 나누지 않고 **가격을 거짓말**해서 같은 결과를 노리는 길이다. 7세대에 `+20%`를 물리면 스케줄러 눈에는 7세대가 8세대보다 비싸진다.

### 2.1 스펙과 검증 규칙

`karpenter.sh/v1alpha1`, **Cluster 스코프**다(`nodeoverlay.go:103`). 필드는 다섯 개.

- **`requirements`** · 필수, `MaxItems: 100` — 순수 라벨 셀렉터. **와일드카드(`c7i.*`) 불가**. CRD values 패턴 `^(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])?$`에 `*`가 없다.
- **`priceAdjustment`** · **부호 필수** — 패턴 `^(([+-]{1}(\d*\.?\d+))|(\+{1}\d*\.?\d+%)|(^(-\d{1,2}(\.\d+)?%)$)|(-100%))$`. `"20%"`는 거부, `"+20%"`만 통과. 양수 %는 상한 없음(`+298%` 통과), 음수 %는 두 자리까지 + `-100%` 특례.
- **`price`** · 부호 불가한 절대 치환 — 패턴 `^\d+(\.\d+)?$`. `priceAdjustment`와 **동시 지정 불가**(CEL: `cannot set both 'price' and 'priceAdjustment'`).
- **`capacity`** · 확장 리소스 추가 전용 — cpu/memory/ephemeral-storage/pods는 CEL이 거부한다.
- **`weight`** · **1~10000** — NodePool weight(1~100)와 범위가 다르다. 미지정 = 0 취급.

계산은 `cloudprovider.AdjustedPrice`(`types.go:493-525`) 하나뿐이다. 부호 없으면 절대 치환, `%` 접미사면 `price*(1+n/100)`, 그 외 부호값이면 `price+n`, 결과가 음수면 0으로 클램프.

**동일 weight 충돌은 조용하지 않고, 부분적이지도 않다.** 같은 offering을 같은 weight의 두 오버레이가 노리면 `isOfferingUpdateConflicting`이 true를 반환하고(`store.go:267-286`), 컨트롤러는 **2-phase로 검증과 저장을 분리해** 충돌이 하나라도 있으면 저장 단계 자체를 건너뛴다(`controller.go:163-181`, 주석: *"ensuring atomicity of the operation"*). 즉 **전 NodePool에 걸쳐 통째로 드롭**되고 status에 `ValidationSucceeded=False, reason="Conflict", message="conflict with another overlay"`가 찍힌다.

{{< callout type="warning" >}}
**검증 실패가 `kubectl apply`를 막지 않는다.** `nodeoverlay_validation.go`의 주석은 "validation webhook"이라고 쓰여 있지만 실제로는 **컨트롤러 Reconcile 안에서** 호출된다(`controller.go:107` `overlayList.Items[i].RuntimeValidate(ctx)`). 잘못된 오버레이도 apply는 성공하고, 실패는 **status condition으로만** 드러난다. 배포 후 반드시 확인할 것:

```bash
kubectl get nodeoverlay -o wide
kubectl get nodeoverlay penalize-gen7 -o jsonpath='{.status.conditions}' | jq
# ValidationSucceeded=True 여야 한다.
# reason=Conflict      → 같은 weight 오버레이와 충돌해 전량 드롭됨
# reason=RuntimeValidation → requirements의 라벨이 WellKnownLabels에 없음
```
{{< /callout >}}

**라벨 선택은 `karpenter.k8s.aws/instance-generation`이 가장 정확하다.** provider-aws가 인스턴스 이름을 정규식으로 파싱해 세대 숫자를 `InstanceType.Requirements`에 심기 때문이다(`instancetype/types.go:49` 정규식 `instanceTypeScheme`, `:248-251` 삽입 — `c7i.large` → category `c`, generation `7`; family `c7i`는 정규식이 아니라 `:253-255`의 `strings.Split` 결과다). `instance-generation Lte 7` 한 줄이면 c7i/m7i/r7i를 한꺼번에 잡고, 나중에 7세대 패밀리가 늘어도 오버레이를 고칠 필요가 없다.

여기에 흔한 오해가 하나 붙는다. **provider-aws는 `init()`에서 `karpenter.k8s.aws`를 `RestrictedLabelDomains`에 *넣는다***(aws `pkg/apis/v1/labels.go:29-30`, `:97-99`). 그런데도 `instance-generation`이 통과하는 이유는 도메인이 자유로워서가 아니라, 코어의 `IsRestrictedLabel`이 `if WellKnownLabels.Has(key) { return nil }`로 **먼저 빠져나오고** provider-aws가 그 목록에 이 라벨을 등록해 뒀기 때문이다. ⇒ **WellKnownLabels에 없는 `karpenter.k8s.aws/*` 라벨은 `RuntimeValidation`으로 거부된다.** 아무 프로바이더 라벨이나 써도 된다고 읽으면 안 된다.

### 2.2 배선 경로 — 실제로 세대를 고르는 건 EC2다

{{< flow caption="priceAdjustment가 인스턴스 선택에 닿는 경로. 아래 갈래는 페널티가 과할 때의 실패 모드다 — 오버레이 적용 인스턴스가 절단선 밖으로 전부 밀리면 어노테이션이 붙지 않아 Fleet 전략이 lowest-price로 되돌아간다" >}}
{
  "nodes": [
    { "id": "ov", "col": 0, "row": 0, "label": "NodeOverlay", "sub": "priceAdjustment +20%", "kind": "src" },
    { "id": "dec", "col": 1, "row": 0, "label": "가격 데코레이터", "sub": "GetInstanceTypes 래핑", "kind": "proc" },
    { "id": "off", "col": 2, "row": 0, "label": "Offering.Price", "sub": "AdjustedPrice로 변조", "kind": "store" },
    { "id": "ann", "col": 3, "row": 0, "label": "NodeClaim 주석", "sub": "price-overlay-applied", "kind": "proc" },
    { "id": "fleet", "col": 4, "row": 0, "label": "EC2 Fleet", "sub": "prioritized · Priority = 조정가", "kind": "sink" },
    { "id": "cut", "col": 3, "row": 1, "label": "60개 절단", "sub": "오버레이 인스턴스 전멸", "kind": "query" },
    { "id": "low", "col": 4, "row": 1, "label": "lowest-price", "sub": "주석 미부착 → 전략 원복", "kind": "sink" }
  ],
  "edges": [
    { "from": "ov", "to": "dec", "label": "store.ApplyAll", "rate": 700 },
    { "from": "dec", "to": "off", "rate": 700 },
    { "from": "off", "to": "ann", "label": "IsPricingOverlayApplied", "rate": 700 },
    { "from": "ann", "to": "fleet", "label": "WithOverlay()", "rate": 700 },
    { "from": "off", "to": "cut", "label": "페널티 과다", "rate": 1400 },
    { "from": "cut", "to": "low", "dashed": true }
  ]
}
{{< /flow >}}

배선의 결정적 지점은 **오른쪽 끝**이다. 코어는 오버레이가 걸린 인스턴스가 후보에 있으면 NodeClaim에 `karpenter.sh/price-overlay-applied: "true"`를 붙이고(`nodeclaimtemplate.go:129-132`), provider-aws가 이 어노테이션을 보고 `cfiBuilder.WithOverlay()`를 호출해 Fleet 할당 전략을 바꾼다:

| capacity type | 오버레이 없음 | 오버레이 있음 |
|---|---|---|
| on-demand | `lowest-price` | **`prioritized`** |
| spot | `price-capacity-optimized` | `capacity-optimized-prioritized` |

각 launch template override의 `Priority`에는 조정된 가격이 그대로 실린다 — `Priority: lo.ToPtr(float64(offering.Price))`. spot 쪽은 **AWS 문서상 우선순위를 best-effort로만 존중**하므로("optimize for capacity first, but will honor instance type priorities on a best-effort basis") 세대 선호가 보장되지 않는다. 오버레이를 쓰든 안 쓰든 **세대 강제가 목적이면 on-demand로 한정**해야 한다.

여기서 자주 과대평가되는 게 시뮬레이션 단계의 효과다. 코어 스케줄러는 인스턴스 타입을 하나로 확정하지 않는다 — 가격순 상위 600개를 **전부** `node.kubernetes.io/instance-type In [...]`으로 NodeClaim에 실어 보내고, provider-aws가 다시 60개로 자른 뒤 최종 선택은 EC2가 한다. **오버레이의 시뮬레이션 단계 효과는 절단 순서·consolidation 판단·`WorstLaunchPrice` 필터에 국한**되고, "8세대 우선"을 실제로 만드는 건 오직 Fleet Priority다.

### 2.3 켜는 조건

```text
FEATURE_GATES 기본값 (pkg/operator/options/options.go:134)
NodeRepair=false,ReservedCapacity=true,SpotToSpotConsolidation=false,
NodeOverlay=false,StaticCapacity=false,CapacityBuffer=false
```

- **feature gate `NodeOverlay`는 기본 false.**(위 `options.go:134` 기본 문자열, `:175` `DefaultFeatureGates`로 확인) helm으로는 `settings.featureGates.nodeOverlay=true`로 켠다 — 다만 이 helm 키와 차트 values 주석(*"nodeOverlay is ALPHA and is disabled by default"*)은 **provider-aws 차트의 웹 문서에서 온 값이고 이 문서의 근거 체크아웃(코어)에는 `charts/`가 없어 재확인하지 못했다 — 확인 필요.** 안 켜면 `overlay/cloudprovider.go:48`에서 `ApplyAll` 자체를 건너뛴다 — **에러도 없이 조용히 무시된다.**
- **provider-aws ≥ v1.7.0.** 코어 CRD 도입 커밋 `218cca8f`의 최초 태그가 v1.7.0이고, provider-aws v1.7.0 릴리스 노트에 *"Add Node Overlay Support (#8305)"*가 있다. v1.6.x에는 없다.
- **CRD `nodeoverlays.karpenter.sh` 필요.** `karpenter-crd` 차트 v1.7.0 templates에 동봉돼 있으므로 정상 경로는 `helm upgrade karpenter-crd`다 — **차트 동봉 여부는 provider-aws 차트 웹 문서 기준이고 코어 체크아웃으로는 재확인하지 못했다. 확인 필요.**
- **배선은 코어가 아니라 provider가 한다.** 코어 안에서 `overlay.Decorate` 호출부는 `kwok/main.go` 하나뿐이고, 실제 배선은 provider-aws `cmd/controller/main.go:44-45`가 수행한다. "코어에 기능이 있다"와 "내 클러스터에서 동작한다" 사이에 버전 의존이 한 겹 더 있다.
- **게이트를 켜는 순간 공백이 생긴다.** 오버레이 평가가 끝나기 전의 NodePool은 `UnevaluatedNodePoolError`로 프로비저닝·disruption 양쪽에서 통째로 스킵된다(`provisioner.go:295-298` `"skipping, awaiting nodeoverlay evaluation"`).
- 정기 재조정은 **6시간 주기**(`controller.go:140`). 오버레이/NodePool/NodeClass 변경은 watch로 즉시 반영되지만 `GenerationChangedPredicate`를 쓰므로 status만 바뀌면 재조정되지 않는다.

### 2.4 확인 못 한 구멍 둘 — 도입한다면 실측 필수

{{< callout type="warning" >}}
**① `Priority`에 소수 달러값을 넣는다.** AWS API 문서는 `FleetLaunchTemplateOverridesRequest.Priority`를 *"Valid values are whole numbers starting at `0`. The lower the number, the higher the priority."* 로 규정한다([API 레퍼런스](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_FleetLaunchTemplateOverridesRequest.html)). 그런데 Karpenter는 `Priority: lo.ToPtr(float64(offering.Price))`로 **0.17 / 0.19 같은 시간당 달러값**을 넣는다. EC2 쪽에서 정수 절단이 일어난다면 시간당 $1 미만 인스턴스가 **전부 priority 0**이 되어 세대 선호가 조용히 무력화된다. **확인 필요 — 코드로도 공개 문서로도 확정할 수 없다.** AWS가 float을 그대로 받아 정렬하는지는 실제 CreateFleet 응답으로만 알 수 있다.

**② 단일 CreateFleet 안에서 다음 우선순위로 넘어간다는 보장이 없다.** [할당 전략 문서](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-fleet-allocation-strategy.html)의 폴백 문장 — *"if the lowest priced pool doesn't have available capacity, the On-Demand Instances come from the next lowest priced pool"* — 은 **`Lowest price` 항목에만** 있다. `prioritized` 항목은 *"launching instance types in order of the highest priority first"* 까지만 말하고 폴백을 언급하지 않는다. **확인 필요.** 이걸 계약으로 삼지 말고, 진짜 안전망은 §1.3의 ICE 캐시 기반 재시도 경로임을 전제해야 한다.

⇒ 오버레이를 도입한다면 **"어떤 패밀리가 실제로 떴는가"를 실측**하라. `kubectl get nodes -L karpenter.k8s.aws/instance-family` 로 분포를 며칠 관찰하기 전에는 동작한다고 말할 수 없다.
{{< /callout >}}

**③ 페널티 상한은 +20~30%다.** provider-aws는 **조정된 가격** 기준 상위 60개만 CreateFleet에 보낸다(`instance.go` `maxInstanceTypes = 60`, 코어는 600). 7세대를 `+200%` 같은 값으로 밀면 두 단계로 망가진다 — 먼저 7세대가 60개 컷 밖으로 밀려 **폴백 후보 자체가 사라지고**, 더 나아가 오버레이 적용 인스턴스가 전부 잘려나가면 `lo.ContainsBy(instanceTypes, IsPricingOverlayApplied)`가 false가 되어 **어노테이션이 안 붙고 Fleet이 `lowest-price`로 되돌아간다**(위 flow의 아래 갈래). 실제 8↔7세대 가격차(대략 5~10%)보다는 확실히 크되, **+30%를 넘기지 마라.**

## 3. A vs B

| | **A. NodePool 분리 + `spec.weight`** | **B. NodeOverlay `priceAdjustment`** |
|---|---|---|
| **결정이 끝나는 곳** | **코어 안.** CreateFleet엔 8세대만 실림 | **EC2 Fleet 안.** `prioritized` 해석에 위임 |
| **폴백 속도** | ICE 왕복 1회 — **대략 11~30초** | 이론상 즉시 — **AWS 문서 미보장**(§2.4) |
| **요구 버전·게이트** | **없음.** `karpenter.sh/v1` GA | **≥ v1.7.0** · 게이트 기본 **false** · CRD 별도 |
| **성숙도** | **GA** | **알파**(`v1alpha1`) |

A의 폴백은 ICE 왕복 이후 3분간은 즉시 gen7로 간다 — 오퍼링이 unavailable로 마킹된 동안이다([07]({{< relref "07-ice-fallback.md" >}})).

**동작 원리.** A는 weight 내림차순 정렬 → 병렬 시뮬레이션 → 최소 인덱스 채택이고 가격 비교가 아예 없다(§1.1-1.2). B는 `Offering.Price`를 변조하고 NodeClaim에 주석을 달아 Fleet의 OD 전략을 `prioritized`로 전환시킨다(§2.1-2.2).

**주요 함정.** A는 셋이다 — 한 번 내려가면 consolidation이 되돌리지 않고(§1.2), 배치 내 빈패킹으로 gen7 in-flight에 후속 파드가 얹히며(§1.2), 기존 풀에서 세대를 제거하면 대량 drift가 난다(§4). B는 넷이다 — 알파 API에 Cluster 스코프라 스코프를 안 걸면 전 NodePool이 오염되고(§2.1), 동일 weight 충돌 시 **전량 드롭**이며(§2.1), 게이트를 켜는 순간 평가 공백이 생기고(§2.3), 페널티가 과하면 전략이 원복된다(§2.4).

### A를 고르는 이유 세 가지

1. **결정성이 코어 안에서 닫힌다.** A는 gen8 풀의 요청에 8세대 타입만 실어 보내므로 EC2가 세대를 고를 여지 자체가 없다. B는 마지막 결정을 `prioritized` 해석에 맡기는데, 거기에 §2.4의 미검증 구멍이 둘 있다.
2. **알파를 회피한다.** B는 `v1alpha1` + 기본 OFF 게이트 + provider 버전 의존 + 게이트 활성화 시의 평가 공백이 한 세트다. 프로덕션 노드 프로비저닝 경로에 이 조합을 얹을 이유가 약하다.
3. **A의 최대 약점은 실제로는 좁다.** "consolidation이 gen8을 gen7로 다운그레이드한다"는 우려는 있지만, 대체안 시뮬레이션도 같은 weight 정렬 스케줄러를 쓰므로(`disruption/helpers.go:113` → `provisioner.NewScheduler`) 평상시엔 gen8 풀에서 대체안이 나오고 그 대체안은 `launchPrice < maxPrice`(strict 부등호)에 걸려 탈락한다. **크로스 풀 다운그레이드는 gen8 풀이 스케줄에 실패할 때만 일어나며, 그건 정확히 gen7을 원하는 상황이다.** 상세는 [06]({{< relref "06-consolidation-traps.md" >}}).

### B가 A보다 나은 유일한 지점

**7세대 → 8세대 자동 복귀.** 오버레이 가격은 consolidation의 후보 노드 가격 산정에도 쓰이므로(`disruption/types.go` `resolveNodePrice` → `instanceType.OfferingPrice`), 부풀려진 gen7 노드가 "비싼 노드"로 인식되어 용량 회복 시 gen8로 교체될 수 있다. A에는 이 경로가 아예 없어 `expireAfter`로 대신해야 한다.

**확인 필요** — 코드 경로는 확인했으나 **실제 교체를 재현하지는 않았다.** 그리고 이 "장점"은 뒤집으면 churn이다(용량이 오갈 때마다 노드가 갈린다). `disruption.budgets`로 속도를 제어할 것.

## 4. 매니페스트 전문

{{< callout type="warning" >}}
**적용 순서를 먼저 읽어라.** 기존 단일 NodePool의 `requirements`에서 세대를 *빼는* 편집은 그 세대로 떠 있던 노드를 전부 `RequirementsDrifted`로 만들어 **대량 교체**를 시작시킨다(`drift.go:170-180` — 값을 *늘리는* 건 드리프트가 아니지만 *줄이는* 건 드리프트다). 순서는 **① 아래 두 풀을 새로 생성 → ② 신규 파드가 gen8로 붙는지 확인 → ③ 기존 풀 삭제**다. `disruption.budgets`로 교체 속도를 제어하라. 상세는 [06]({{< relref "06-consolidation-traps.md" >}}).
{{< /callout >}}

### 4.1 NodePool 두 개 (권장)

```yaml
# ─────────────────────────────────────────────────────────────
# 1) 8세대 우선 풀
#    weight 는 프로비저닝 시 NodePool 평가 순위를 결정한다.
#    provisioner.go:289 OrderByWeight -> scheduler.go:757-761 이
#    "성공한 것 중 인덱스가 가장 앞선 것"을 채택한다 (가격 비교 없음).
# ─────────────────────────────────────────────────────────────
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: gen8-primary
spec:
  weight: 100                    # 1~100. 미지정 = 0 취급.
                                 # gen7 과 반드시 다른 값을 줄 것 — 동률이면
                                 # 알파벳상 뒤 이름(여기선 gen8-primary)이 이긴다.
  template:
    spec:
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: default            # <- 실제 EC2NodeClass 이름
      expireAfter: 720h          # 기본값. 8세대 풀은 짧게 할 이유가 없다.
      requirements:
        # instance-family / instance-generation 둘 다 provider-aws 가
        # WellKnownLabels 에 등록하므로 사용 가능. 명시적 열거가 의도를
        # 더 분명히 드러내므로 family 로 쓴다.
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: ["c8i", "m8i", "r8i"]
        - key: karpenter.k8s.aws/instance-size
          operator: In
          values: ["large", "xlarge", "2xlarge", "4xlarge", "8xlarge"]
        # ★ on-demand 한정: provider-aws 의 capacity-type 우선순위는
        #   reserved > spot > on-demand 이고, spot Fleet 은
        #   price-capacity-optimized 라 EC2 가 "용량이 깊은 풀"을 고른다.
        #   세대 강제가 목적이면 spot 을 섞지 말고 별도 풀로 분리하라.
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["on-demand"]
        - key: topology.kubernetes.io/zone
          operator: In
          values: ["ap-northeast-2a", "ap-northeast-2b", "ap-northeast-2c"]
  disruption:
    consolidationPolicy: WhenEmptyOrUnderutilized
    consolidateAfter: 1m
    budgets:
      - nodes: "10%"             # 교체 속도 제어. drift/expire 에도 적용된다.
---
# ─────────────────────────────────────────────────────────────
# 2) 7세대 폴백 풀
#    gen8-primary 가 CanAdd 에 실패할 때만 승리한다.
#    실패 사유는 넷: 8세대 오퍼링 전멸(ICE) / limits 소진 /
#    minValues 미충족 / 파드 요구사항과 비호환.
# ─────────────────────────────────────────────────────────────
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: gen7-fallback
spec:
  weight: 10
  template:
    spec:
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: default
      # ★★ 이 한 줄이 유일한 8세대 복귀 장치다.
      #   consolidation 은 "더 싼 쪽"으로만 움직이므로(launchPrice < maxPrice,
      #   strict 부등호) gen7 -> gen8 승격 경로가 코드에 아예 없다.
      #   업스트림 요청도 반려됐다(karpenter#1829 closed as not planned).
      #   expireAfter 는 가격 필터 없이 노드를 교체하므로, 만료된 노드가
      #   재스케줄될 때 weight 100 인 gen8 이 다시 먼저 평가된다.
      #   짧을수록 복귀가 빠르지만 노드 churn 이 늘어난다. 24~72h 권장.
      expireAfter: 48h
      requirements:
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: ["c7i", "m7i", "r7i"]
        - key: karpenter.k8s.aws/instance-size
          operator: In
          values: ["large", "xlarge", "2xlarge", "4xlarge", "8xlarge"]
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["on-demand"]
        - key: topology.kubernetes.io/zone
          operator: In
          values: ["ap-northeast-2a", "ap-northeast-2b", "ap-northeast-2c"]
  # 폴백 폭주 상한. scheduler.go:716 filterByRemainingResources 가 한도를
  # 넘길 인스턴스 타입을 사전 배제하고, provisioner.go:467 Limits.ExceededBy
  # 가 NodeClaim 생성 직전 재검증한다.
  # ★ 트레이드오프: 한도 소진 + 8세대 ICE 가 동시에 오면 파드는 그냥
  #   pending 된다("all available instance types exceed limits for nodepool").
  #   limits 는 '폭주 방지'용이지 '폴백 보장'과는 반대 방향이다.
  #   노드 개수 상한도 가능하다: limits: { nodes: "20" }
  limits:
    cpu: "200"
    memory: 800Gi
  disruption:
    consolidationPolicy: WhenEmptyOrUnderutilized
    consolidateAfter: 1m
    budgets:
      - nodes: "10%"

# 파드 쪽에는 nodeSelector / nodeAffinity 를 걸지 마라.
# scheduler.go:705-706 이 파드마다 템플릿 슬라이스 전체를 후보로 삼고
# weight 순위가 가장 앞선 성공 템플릿을 고르므로 자동으로 gen8 -> gen7 이 된다.
# karpenter.sh/nodepool 셀렉터를 걸면 weight 가 무시되어 폴백이 깨진다
# (suite_test.go:2830 이 이 동작을 테스트로 못박고 있다).
```

### 4.2 Helm values 형태 (finance 클러스터가 쓰는 형태)

finance는 org 차트로 karpenter를 배포하고 NodePool도 차트 values로 관리한다. 구 차트의 `provisioner:`(spot/ondemand/systemOndemand 등 per-pool 키) 구조는 v1 스키마 신 차트에서 `nodePool:` / `nodeClass:` **map 구조**로 재작성된다([karpenter 업그레이드 기록]({{< relref "../eks-upgrade/components/01-karpenter.md" >}}) §적용 절차 2번).

{{< callout type="warning" >}}
**아래는 "구조"의 예시이고, 키 이름은 차트마다 다르다.** `weight` / `expireAfter` / `requirements`가 어느 깊이에 오는지, `nodeClassRef`가 문자열인지 객체인지는 org 차트의 `values.schema.json`(또는 `templates/nodepool.yaml`)로 **반드시 실제 스키마를 확인**하고 옮겨야 한다. 차트가 `weight`를 아예 노출하지 않으면 그 키부터 추가해야 한다.
{{< /callout >}}

```yaml
# values-<cluster>.yaml — 구조 예시 (키명은 실제 차트 스키마로 확인할 것)
nodeClass:
  default:
    amiSelectorTerms:
      - alias: al2023@latest       # v1 에서 필수화. 신 차트 기본값을 비우지 말 것
    subnetSelectorTerms:
      - tags: { "karpenter.sh/discovery": "<cluster>" }
    securityGroupSelectorTerms:
      - tags: { "karpenter.sh/discovery": "<cluster>" }

nodePool:
  gen8-primary:
    weight: 100
    nodeClassRef: default
    expireAfter: 720h
    requirements:
      - { key: karpenter.k8s.aws/instance-family, operator: In, values: ["c8i", "m8i", "r8i"] }
      - { key: karpenter.k8s.aws/instance-size,   operator: In, values: ["large", "xlarge", "2xlarge", "4xlarge", "8xlarge"] }
      - { key: karpenter.sh/capacity-type,        operator: In, values: ["on-demand"] }
      - { key: topology.kubernetes.io/zone,       operator: In, values: ["ap-northeast-2a", "ap-northeast-2b", "ap-northeast-2c"] }
    disruption:
      consolidationPolicy: WhenEmptyOrUnderutilized
      consolidateAfter: 1m
      budgets:
        - nodes: "10%"

  gen7-fallback:
    weight: 10
    nodeClassRef: default
    expireAfter: 48h               # 유일한 8세대 복귀 장치 (§4.1 주석 참조)
    requirements:
      - { key: karpenter.k8s.aws/instance-family, operator: In, values: ["c7i", "m7i", "r7i"] }
      - { key: karpenter.k8s.aws/instance-size,   operator: In, values: ["large", "xlarge", "2xlarge", "4xlarge", "8xlarge"] }
      - { key: karpenter.sh/capacity-type,        operator: In, values: ["on-demand"] }
      - { key: topology.kubernetes.io/zone,       operator: In, values: ["ap-northeast-2a", "ap-northeast-2b", "ap-northeast-2c"] }
    limits:
      cpu: "200"
      memory: 800Gi
    disruption:
      consolidationPolicy: WhenEmptyOrUnderutilized
      consolidateAfter: 1m
      budgets:
        - nodes: "10%"
```

ArgoCD로 굴린다면 이 values 변경이 **NodePool CR의 `spec.template` 변경으로 번역되는지**를 먼저 확인해야 한다. `weight` / `limits` / `disruption`은 `spec.template` **바깥**이라 안전하지만, `requirements` / `expireAfter` / `nodeClassRef`는 안쪽이라 기존 노드의 drift를 유발한다.

### 4.3 (택일) NodeOverlay — A와 **함께 쓰지 마라**

{{< callout type="warning" >}}
**아래 오버레이와 §4.1의 2-풀 구성은 택일이다.** 둘 다 걸면 gen7 풀의 가격이 두 번 왜곡되어 consolidation 판단이 예측 불가능해진다. 그리고 §2.4의 **확인 못 한 구멍 둘**을 읽지 않았다면 여기까지 오면 안 된다.
{{< /callout >}}

```yaml
# 전제 1: 코어·provider-aws >= v1.7.0
# 전제 2: helm --set settings.featureGates.nodeOverlay=true
#         (기본 false — options.go:134, :175. 안 켜면 조용히 무시된다.)
# 전제 3: kubectl get crd nodeoverlays.karpenter.sh
#         (karpenter-crd 차트에 동봉. helm upgrade karpenter-crd 가 정상 경로)
apiVersion: karpenter.sh/v1alpha1
kind: NodeOverlay
metadata:
  name: penalize-gen7
spec:
  # 1~10000 (NodePool weight 의 1~100 과 범위가 다르다). 미지정 = 0 취급.
  # 동일 weight 오버레이가 같은 offering 을 노리면 나중 것이 통째로 드롭되고
  # status 에 Conflict 가 찍힌다 — 부분 적용이 아니라 전 NodePool 전량 드롭이다.
  weight: 100
  requirements:
    # ★ 필수: NodeOverlay 는 Cluster 스코프다. 이 줄이 없으면 클러스터 내
    #   모든 NodePool 의 7세대 가격이 오염되어 남의 풀 consolidation 까지 망친다.
    - key: karpenter.sh/nodepool
      operator: In
      values: ["intel-general"]        # <- 실제 NodePool 이름
    # 세대 숫자는 provider-aws 가 인스턴스 이름 정규식으로 뽑아
    # InstanceType.Requirements 에 심는다(instancetype/types.go:49, :248-251).
    # 나중에 7세대 패밀리를 추가해도 이 오버레이는 고칠 필요가 없다.
    # 와일드카드(c7i.*)는 CRD values 패턴이 거부한다.
    - key: karpenter.k8s.aws/instance-generation
      operator: Lte
      values: ["7"]
    # spot 은 capacity-optimized-prioritized 라 우선순위가 best-effort 다.
    # 페널티만 걸리고 세대 선호는 보장되지 않으므로 on-demand 로 한정.
    - key: karpenter.sh/capacity-type
      operator: In
      values: ["on-demand"]
  # 부호 필수 ("20%" 는 거부, "+20%" 만 통과 — nodeoverlay.go:75 패턴).
  # price 와 동시 지정 불가 (CEL: "cannot set both 'price' and 'priceAdjustment'").
  # 값 고르기: 실제 8<->7 가격차(대략 5~10%)보다 크되 +30% 를 넘기지 마라.
  # 넘기면 7세대가 60개 컷 밖으로 밀려 폴백이 죽고, 오버레이 적용 인스턴스가
  # 전멸하면 어노테이션이 안 붙어 Fleet 이 lowest-price 로 되돌아간다.
  priceAdjustment: "+20%"
```

## 5. 세 번째 길 — ODCR로 8세대를 "공짜"로 만들기

알파를 켜지 않고, 풀을 나누지 않고도 8세대를 1순위로 만드는 방법이 하나 더 있다. **예약 용량(ODCR)** 이다.

provider-aws는 reserved offering의 가격을 이렇게 매긴다:

```go
// provider-aws · pkg/providers/instancetype/offering/reserved_capacity_resolver.go:78
price = odPrice / 10_000_000.0
```

**사실상 0이다.** 이 가격은 코어의 `OrderByPrice`·`Truncate`·EC2의 `lowest-price` 전부에서 무조건 1순위가 되고, consolidation의 `launchPrice < maxPrice` 비교에서도 항상 이긴다. 그리고 `ReservedCapacity` feature gate는 **기본 ON**이다(위 `FEATURE_GATES` 기본 문자열, BETA).

⇒ 8세대에 ODCR을 잡아두면 **알파 기능 없이 "평소 8세대 → 예약 소진 시 나머지"** 가 성립한다. 코어에도 이 의도를 못박은 분기가 있다 — 예약 오퍼링이 있는 NodePool과 호환되면 더 낮은 weight 풀로 **폴백하지 않는다**(`scheduler.go:734-751` `IsReservedOfferingError`). 이건 weight 기반 폴백을 막는 코드 전체에서 유일한 분기다.

트레이드오프는 명확하다: **돈.** ODCR은 인스턴스를 쓰든 안 쓰든 과금되고, 예약한 만큼만 우선순위를 산다. 그래서 이건 A의 대안이라기보다 **A와 함께 쓰는 강화 장치**로 보는 편이 맞다 — 기저 부하만큼 8세대 ODCR을 잡고, 그 위의 변동분을 weight 폴백에 맡기는 구성.

## 6. 배포 후 볼 것

세대 선호는 "설정했다"로 끝나지 않는다. **8세대 풀이 조용히 사라지는 경로가 여럿**이고, 전부 파드는 정상 스케줄되므로 알람 없이는 관측되지 않는다.

- **`karpenter_nodeclaims_disrupted_total{reason="insufficient_capacity"}`** — 8세대 ICE 발생률. 지속적으로 오르면 8세대 재고가 구조적으로 부족한 것.
- **`kubectl get events --field-selector reason=InsufficientCapacityError`** — 위와 같은 사건의 개별 인스턴스/AZ.
- **로그 `"skipping, nodepool requirements filtered out all instance types"`** — **8세대 풀이 통째로 빠졌다.** requirements가 모든 인스턴스 타입을 걸러낸 상태.
- **로그 `"ignoring nodepool, not ready"`** — NodeClass 오류로 8세대 풀이 후보에서 제외.
- **로그 `"skipping, awaiting nodeoverlay evaluation"`** — (게이트 켠 경우) 오버레이 평가 대기 중 스킵.
- **`kubectl get nodes -L karpenter.sh/nodepool -L karpenter.k8s.aws/instance-family`** — **gen7 비중.** 이게 튀면 위 다섯 신호 중 하나가 진행 중이다.

{{< callout type="warning" >}}
**확인 필요 — 배포 전 한 번은 눈으로 볼 것.** c8i/m8i/r8i가 대상 리전(ap-northeast-2)에서 실제로 제공되는지, 그리고 배포 중인 provider-aws 버전이 8세대를 인스턴스 타입 목록에 포함하는지는 코어 소스로도 공개 문서로도 확정할 수 없었다. provider-aws는 `DescribeInstanceTypes`로 동적 조회하므로 원리상 문제없지만, **8세대를 모르는 구버전 provider에서는 gen8 풀의 requirements가 모든 인스턴스 타입을 걸러내 템플릿 자체가 사라진다** — 그러면 폴백은 정상 동작하는데 8세대는 영영 안 뜬다. 적용 직후 `kubectl get nodepool gen8-primary -o yaml`의 `Ready` 컨디션과 위 표의 `"filtered out all instance types"` 로그를 확인하라.
{{< /callout >}}

## 이 문서에서 가져갈 것

- **weight는 가격보다 먼저 적용된다.** NodePool을 고르는 코드에는 가격 비교가 없다(`grep -ic price scheduler.go` → 0). 단일 NodePool에 세대를 섞으면 싼 쪽이 이기지만, 풀을 나누고 weight를 주면 그 경쟁 자체가 없어진다.
- **메커니즘은 "순차 시도"가 아니라 "병렬 시뮬레이션 + 최소 인덱스 채택"이다.** 결정성은 평가 순서가 아니라 뮤텍스 아래의 비교식에서 나온다. 그리고 상류 문서는 배치/빈패킹 때문에 **"항상 최고 weight"를 보장하지 않는다**고 명시한다.
- **파드는 건드리지 않는다.** 셀렉터가 불필요할 뿐 아니라, `karpenter.sh/nodepool` 셀렉터는 weight를 무력화한다.
- **NodeOverlay는 A의 대체재가 아니다.** 알파 게이트 + provider 버전 의존에 더해, 세대 선호를 실제로 만드는 EC2 `prioritized` 경로에 **정수 Priority 규정**과 **단일 CreateFleet 내 폴백 미보장**이라는 확인 못 한 구멍이 둘 있다. 도입한다면 실측이 필수다.
- **8세대 복귀는 자동이 아니다.** consolidation은 더 싼 쪽으로만 움직이므로, 해법 A만 쓴다면 gen7 풀의 `expireAfter`가 유일한 복귀 장치다. 그리고 **적용 순서를 틀리면(기존 풀에서 세대 제거) 대량 교체가 난다** — 새 풀을 만든 뒤 기존 풀을 지운다.

## 참고 자료

- 동작 서술의 근거 코드: `kubernetes-sigs/karpenter` **v1.14.0-6-gac7a021e** — `pkg/controllers/provisioning/provisioner.go`(OrderByWeight·limits 재검증), `pkg/controllers/provisioning/scheduling/scheduler.go`(최소 인덱스 채택·limits 사전 필터), `pkg/apis/v1/nodepool.go`(weight 제약·CEL), `pkg/apis/v1alpha1/nodeoverlay.go`(오버레이 스펙), `pkg/controllers/nodeoverlay/`(충돌 판정·2-phase 저장), `pkg/cloudprovider/types.go`(AdjustedPrice·Truncate), `pkg/controllers/provisioning/suite_test.go:2813-2841`(weight 동작을 못박는 테스트)
- provider-aws: `main` / `v1.7.0` / `v1.11.3` — `pkg/providers/instance/instance.go`(`WithOverlay()`, `Priority`, 60개 절단), `pkg/providers/instance/types.go`(Fleet 할당 전략 전환), `pkg/providers/instancetype/types.go`(instance-family·generation 라벨 생성), `pkg/providers/instancetype/offering/reserved_capacity_resolver.go`(reserved 가격), `pkg/cache/cache.go`(ICE TTL 3분)
- [Weighted NodePools](https://karpenter.sh/docs/concepts/scheduling/#weighted-nodepools) — "not guaranteed that Karpenter will always choose the highest priority NodePool"의 원문 · [NodeOverlays 개념 문서](https://karpenter.sh/docs/concepts/nodeoverlays/)
- [EC2 Fleet allocation strategies](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-fleet-allocation-strategy.html) · [FleetLaunchTemplateOverridesRequest](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_FleetLaunchTemplateOverridesRequest.html) — §2.4의 두 구멍이 여기서 나온다
- 반려된 업스트림 요청: [karpenter#1829 `consolidationPolicy: Underweight`](https://github.com/kubernetes-sigs/karpenter/issues/1829) *closed as not planned* · [karpenter-provider-aws#6721 "Ability to prefer generation over price"](https://github.com/aws/karpenter-provider-aws/issues/6721) *closed*
- 같은 챕터: [04 인스턴스는 누가 고르는가]({{< relref "04-instance-selection.md" >}}) · [06 consolidation이 되돌리는 것]({{< relref "06-consolidation-traps.md" >}}) · [07 용량이 없을 때]({{< relref "07-ice-fallback.md" >}}) · 실제 업그레이드 기록은 [eks-upgrade · karpenter]({{< relref "../eks-upgrade/components/01-karpenter.md" >}})
