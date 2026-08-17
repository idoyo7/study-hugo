---
title: "0.36 → 1.6 — v1 전환과 그 직후"
weight: 1
---

# 01 · 0.36 → 1.6 — v1이 바꾼 것은 API가 아니라 동작이다

{{< callout type="info" >}}
**한눈에**
- v1beta1→v1을 "필드 이름이 바뀐 일"로 읽으면 사고가 납니다. changelog에서 위험한 절은 **Behavior Changes**이고 그중 둘은 **옵트아웃이 없습니다** — drift는 Stable 승격과 함께 feature gate가 삭제됐고([core#1311](https://github.com/kubernetes-sigs/karpenter/pull/1311)), expiration은 forceful로 되돌아갔습니다([core#1333](https://github.com/kubernetes-sigs/karpenter/pull/1333)).
- **forceful expiration이 무시하는 건 PodDisruptionBudget(PDB)이 아닙니다.** 무시하는 것은 "대체 노드가 `Initialized`가 될 때까지 드레인을 시작하지 않는다"는 사전 안전장치와 disruption budget입니다. `nodeclaim.expiration` 컨트롤러는 후보 평가 없이 NodeClaim을 바로 `Delete`합니다(`controllers/nodeclaim/expiration/controller.go:82`).
- **`consolidateAfter`가 v1에서 필수 필드입니다.** v1beta1의 `WhenUnderutilized`에서는 설정조차 불가능했던 값이라 기존 동작을 유지하려면 `0s`를 명시해야 합니다. `Never`는 그 NodePool의 consolidation을 통째로 끕니다.
- **`terminationGracePeriod`([core#916](https://github.com/kubernetes-sigs/karpenter/pull/916))가 최종 승자입니다.** 만료되면 PDB·`do-not-disrupt` 무관하게 남은 파드가 강제 삭제됩니다. 반대로 TGP를 걸면 drift가 "PDB·`do-not-disrupt` 파드가 있는 노드"까지 후보로 채택합니다 — 안전장치를 스스로 꺼주는 대가로 CVE 패치를 밀 수 있게 됩니다. 노드 최대 수명 = `expireAfter`(기본 `720h`, 상한이지 하한이 아닙니다) + TGP.
- disruption budgets가 `Drifted`/`Underutilized`/`Empty` **reason별로** 나뉘었습니다([core#991](https://github.com/kubernetes-sigs/karpenter/pull/991), [core#1377](https://github.com/kubernetes-sigs/karpenter/pull/1377)). 삭제된 drift feature gate의 자리를 이것이 메웁니다 — 업스트림이 제시하는 유일한 drift 통제 수단입니다.
- **1.1.0이 v1beta1 서빙을 끝냈습니다.** `nodeClassRef.group`/`kind`가 강제 필수가 되고 kubelet 호환 어노테이션이 사라집니다. 같은 릴리스의 Bottlerocket + `instanceStorePolicy: RAID0`은 **v1.22.0 미만 이미지에서 노드가 join하지 못합니다.**
- **1.2.0의 메트릭 reason 라벨 snake_case 전환은 CI가 못 잡는 조용한 알람 무효화입니다.** `reason="Drifted"` 쿼리는 에러 없이 결과가 0이 됩니다. 같은 릴리스에서 `nodeclass.status`·`nodeclass.termination`이 `nodeclass`로 합쳐졌습니다([aws#7597](https://github.com/aws/karpenter-provider-aws/pull/7597)).
- **1.6.0에서 native On-Demand Capacity Reservation(ODCR)이 beta·기본 활성화됐습니다**([core#2365](https://github.com/kubernetes-sigs/karpenter/pull/2365)). `open` eligibility ODCR을 `capacityReservationSelectorTerms`에 등재하지 않고 올리면 **예약을 안 쓰면서 요금은 계속 나갑니다** — 이 구간에서 가장 비싼 회귀입니다.
- `MinValuesPolicy`(1.6, [core#2299](https://github.com/kubernetes-sigs/karpenter/pull/2299)·[aws#8250](https://github.com/aws/karpenter-provider-aws/pull/8250))는 전역 옵션이고 기본값은 `Strict`입니다. `minValues` 자체는 v0.35.0([core#963](https://github.com/kubernetes-sigs/karpenter/pull/963))부터 있던 API로 0.36 운영자에게 새 기능이 아닙니다.
{{< /callout >}}

v1 마이그레이션 가이드 763줄의 절반은 "필드가 어디로 갔다"는 표라 `kubectl apply` 실패로 바로 드러납니다. 진짜 위험한 건 **매니페스트가 그대로 통과하는데 클러스터가 다르게 행동하는** 항목입니다 — 만료된 노드가 대체 없이 드레인을 시작하고, 끄고 있던 drift가 켜지고, 쓴 적 없는 `consolidateAfter`가 필수가 됩니다.

> 근거 기준: 릴리스노트는 `aws/karpenter-provider-aws` v0.36.0~v1.14.0 및 `kubernetes-sigs/karpenter` v1.0.0~v1.14.0, 문서·코드·릴리스일은 2026-07-30 기준 두 레포 main 체크아웃과 git 태그입니다. 줄 번호는 그 시점 스냅샷입니다.

## 1. 타임라인 — 0.36에서 1.6까지

이 구간은 **고를 수 있는 기능이 거의 없습니다.** 대부분 "지나가면 맞는 것"이라 읽는 방식도 "무엇을 켤까"가 아니라 "무엇을 미리 막아둘까"입니다.

| 버전 | 언제 쓰나 (조건) | 무엇이 가능해졌나 | 대가 |
|---|---|---|---|
| **0.36** | 선택 아님 | EC2NodeClass readiness | CRD 선행 없으면 중단 |
| **0.37** | 선택 아님 | — | `severity` 제거 — 파서 수정 |
| **1.0** | **v1 진입 — 선택 아님** | TGP · reason별 budget | **drift를 못 끈다** · 만료 forceful |
| **1.1** | 선택 아님 | Node Repair(alpha) | v1beta1 종료 · `group`/`kind` 필수 |
| **1.2** | 하드웨어 이상을 잡고 싶다 | Node Monitoring Agent | reason 라벨 snake_case |
| **1.3** | ODCR을 쓰고 싶다 | `capacity-type: reserved` | alpha 게이트 · 메트릭 1건 rename |
| **1.4** | 등록 실패를 감지하고 싶다 | `NodeRegistrationHealthy` | 없음 |
| **1.5** | 드레인을 관측하고 싶다 | `pods_drained_total` | 없음 |
| **1.6** | **선택 아님 — beta 기본 ON** | Capacity Blocks · `MinValuesPolicy` | **ODCR 미등재면 요금만 나간다** |
| **1.7+** | → [02]({{< relref "02-changelog-maturity.md" >}}) | NodeOverlay · Static · Balanced | — |

각 행의 "대가"가 이 문서의 본문입니다 — 1.0은 §2, 1.1은 §3, 1.2는 §4, 1.3은 §5, 1.6은 §6이 받습니다. 릴리스일은 0.36.0 2024-04-10, 0.37.0 2024-05-28, 1.0.0 2024-08-14, 1.1.0 2024-11-29, 1.2.0 2025-01-28, 1.3.0 2025-03-03, 1.4.0 2025-04-16, 1.5.0 2025-05-23, 1.6.0 2025-07-14, 1.6.2 2025-08-13(`DisableDryRun`)입니다. aws provider 태그의 커밋 날짜 기준입니다.

k8s 1.32는 ≥1.2, **1.33은 ≥1.5, 1.34는 ≥1.6**, 1.35는 ≥1.9, 1.36은 ≥1.13입니다(`upgrading/compatibility.md:18-20`). 이 하한이 버전 선택을 사실상 결정합니다 — EKS를 1.33 이상으로 올리는 순간 §5·§6은 선택지가 아니라 전제입니다.

## 2. v1이 바꾼 동작 5가지

차트·values·IAM·ArgoCD 적용 절차는 [eks-upgrade / karpenter]({{< relref "../../eks-upgrade/components/01-karpenter.md" >}})가 소유합니다. 여기서 다루는 건 매니페스트가 통과한 **다음**입니다. 아래 표에서 위험한 열은 세 번째입니다.

| v1beta1 | v1 | 동작이 달라진 점 |
|---|---|---|
| `spec.disruption.expireAfter` | `spec.template.spec.expireAfter` | **drift 가능 필드로 승격** — 값 변경 시 전부 교체 |
| `spec.template.spec.kubelet` | `EC2NodeClass.spec.kubelet` | NodePool별 분리 필요 — drift 유발. 어노테이션 **1.1 종료** |
| (설정 불가) | `spec.disruption.consolidateAfter` **필수** | §2.3 |
| (없음) | `spec.template.spec.terminationGracePeriod` | §2.4 — 옵트인, drift 후보 판정에 영향 |
| (없음) | `spec.disruption.budgets[].reasons` | §2.5 |
| `nodeClassRef.apiVersion` | `nodeClassRef.group`(+`kind` 필수) | 1.0 관용 → **1.1 강제** |
| `amiSelectorTerms` 생략 가능 | **필수** + `alias` 신설 | 누락 시 `NotReady` → **스케줄링 후보 제외** |
| taint `.../disruption=disrupting` | `.../disrupted:NoSchedule`(**값 없음**) | tolerate 워크로드 재설정 필요 |
| `FEATURE_GATES.DRIFT=true` | (삭제) | §2.1 |
| `httpPutResponseHopLimit: 2` | `1` | IMDS 접근 기본 차단(`hostNetwork` 미사용 파드) |

값이 사라졌으니 `karpenter.sh/disruption=disrupting`을 tolerate하던 워크로드는 재설정해야 하고(`apis/v1/taints.go:32-37`), `amiSelectorTerms` 누락은 EC2NodeClass를 `NotReady`로 만들어 참조 NodePool을 후보에서 뺍니다.

### 2.1 drift가 GA됐고, 이제 끌 수 없다

drift는 0.21 alpha → 0.33 beta(기본 true)였고 그때까지는 `FEATURE_GATES`로 **끌 수 있었습니다.** v1.0에서 게이트가 삭제됐습니다 — "Users currently opting out of drift, disabling the drift feature flag will no longer be able to do so"(`v1-migration.md:700-701`).

**무슨 일이 나나.** drift는 NodePool의 `spec.template.spec.requirements`와 EC2NodeClass의 `subnetSelectorTerms`·`securityGroupSelectorTerms`·`amiSelectorTerms`를 NodeClaim에 박힌 해시(`karpenter.sh/nodepool-hash`, `karpenter.k8s.aws/ec2nodeclass-hash`)와 비교합니다. 게이트를 끄고 굴려온 클러스터는 이 비교를 한 번도 한 적이 없어서 **켜지는 순간 누적된 모든 불일치가 한꺼번에 드러납니다.** `amiSelectorTerms`가 `alias: al2023@latest`면 새 AMI마다 클러스터 전체가 후보가 됩니다 — CRD를 안 건드렸는데 drift가 나는 유일한 경로입니다.

**전형적인 사례.** `FEATURE_GATES.DRIFT=false`로 1~2년 굴린 프로덕션 클러스터가 그동안 서브넷 추가·시큐리티그룹 변경·AMI 롤링을 CRD 수정 없이 여러 번 거쳤다면, v1.0 직후 그 누적분이 한꺼번에 drift 후보로 잡힙니다. 다수 노드가 동시에 교체 큐에 들어갑니다. 업그레이드 **전에는** 기존 NodeClaim의 `karpenter.sh/nodepool-hash`를 대상 NodePool의 `status.hash`와 대조합니다 — 다르면 그 NodeClaim은 게이트가 사라지는 순간 즉시 후보입니다. **후에는** `karpenter_nodeclaims_disrupted_total{reason="Drifted"}`(1.2+는 `reason="drifted"`, §4)가 평소 대비 튀는지로 봅니다.

**대비.** drift는 Automated **Graceful** Method라 disruption budget으로 rate-limit이 됩니다. 삭제된 게이트를 대체하는 유일한 수단인데 기본 budget이 `nodes: 10%` 하나뿐인 게 함정입니다. 아래가 §2.1~2.5를 한 매니페스트에 반영한 형태입니다.

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: service
spec:
  template:
    spec:
      nodeClassRef:
        group: karpenter.k8s.aws      # 1.1부터 group·kind 강제
        kind: EC2NodeClass
        name: service
      expireAfter: 720h               # 기본값. 상한이지 하한이 아니다
      terminationGracePeriod: 1h      # 드레인 정체 시 1h 뒤 강제 종료 → 최대 수명 721h
  disruption:
    consolidationPolicy: WhenEmptyOrUnderutilized
    consolidateAfter: 0s              # v1에서 필수. 0s가 v1beta1과 동일 동작
    budgets:
    - nodes: "10%"
    - nodes: "0"                      # 평일 업무시간에는 drift 교체 완전 차단
      schedule: "0 0 * * mon-fri"     # 타임존 미지원(UTC) — KST 09~18시는 UTC 00시 + 9h
      duration: 9h
      reasons: ["Drifted"]
    - nodes: "10%"
      reasons: ["Drifted"]
```

`schedule`과 `duration`은 항상 함께 씁니다. 둘 다 생략하면 budget이 상시 active입니다.

### 2.2 expiration이 대체 노드를 기다리지 않는다

0.37 이전에는 만료된 노드도 다른 자발적 disruption과 같은 후보 단계를 거쳐 budget을 확인하고 대체 용량이 `Initialized`될 때까지 기다린 뒤 드레인했습니다. v1.0에서 그 경로가 사라졌습니다 — 원래 forceful이던 설계를 대체 용량 오케스트레이션 때문에 graceful로 바꿨던 PR#59를 되돌렸습니다(`designs/forceful-expiration.md:37-67`, RFC [core#1303](https://github.com/kubernetes-sigs/karpenter/pull/1303) → [core#1333](https://github.com/kubernetes-sigs/karpenter/pull/1333)). graceful 경로는 `controllers/disruption/`의 Method 파이프라인(`controller.go:101-114`)을 타고 대체 NodeClaim의 `Initialized` 확인 **후**에 삭제합니다(`queue.go:196-241`). 반면 expiration은 파이프라인 밖의 별도 컨트롤러라 만료 판정 직후 `kubeClient.Delete(ctx, nodeClaim)` 한 줄입니다.

{{< seq src="_seq/2-2-expiration-이-대체-노드를.json" />}}

**무슨 일이 나나.** 업그레이드 시점에 이미 `expireAfter`를 넘긴 NodeClaim이 PDB나 `do-not-disrupt`로 막혀 있었다면 컨트롤러가 뜨는 순간 **전부 드레인을 시작합니다** — 가이드가 예상 결과를 직접 적어둡니다("increased number of pods in the 'Pending' state while replacement capacity is being provisioned", `v1-migration.md:26`). 0.36 시절 `expireAfter`를 짧게 걸어둔 클러스터가 특히 위험합니다.

expiration은 **budget으로 rate-limit이 안 되고**(`disruption.md:317`) `do-not-disrupt`도 존중하지 않는데 드레인 자체는 PDB를 존중합니다. 그래서 TGP가 없으면 **드레인은 시작됐는데 끝나지 않는** 노드가 남습니다 — taint로 새 파드는 안 들어오고, 기존 파드는 PDB에 막혀 안 나가고, 요금은 계속 나갑니다. 업스트림은 이를 "partially drained nodes stuck in the cluster"라 부릅니다(`disruption.md:213-215`).

**대비.** ① 업그레이드 전에 `kubectl get nodeclaim`의 생성 시각과 `spec.expireAfter`로 만료 임박·초과 NodeClaim을 셉니다. 있으면 정리하거나 `expireAfter: Never`로 잠시 무력화합니다. ② `expireAfter`를 쓰는 NodePool에는 반드시 TGP를 함께 줍니다. ③ 노드 최대 수명을 두 값의 합으로 계산합니다.

### 2.3 consolidation 정책 리네임과 `consolidateAfter` 필수화

`WhenUnderutilized` → `WhenEmptyOrUnderutilized`는 이름만이고 동작은 같습니다. 실제 변경은 `consolidateAfter`입니다. v1beta1에서는 `WhenUnderutilized`일 때 **설정할 수 없었고**, v1에서는 **필수**가 됐습니다(`v1-migration.md:704`, `apis/v1/nodepool.go:93`에 `omitempty` 없이 선언).

| 값 | 동작 | 판정 |
|---|---|---|
| `0s` | v1beta1 `WhenUnderutilized`와 동일. 파드 변동 직후부터 곧바로 후보 | **기본** — 기존 동작을 이어받으려면 이것 |
| `1m`~`15m` | 무변동 지속 시간만큼 후보(추가·삭제마다 타이머 리셋) | **좋음** — 출렁이는 워크로드의 노드 churn을 줄인다 |
| `Never` | consolidation 완전 비활성화 | **주의** — "느리게 통합"이 아니라 "안 함"이다. 비용 절감이 통째로 멈춘다 |

정책 선택지는 지금 셋입니다 — `WhenEmpty`, `WhenEmptyOrUnderutilized`, `Balanced`(1.14 신설, 절감 대 disruption 비율로 판정 → [02]({{< relref "02-changelog-maturity.md" >}})). `spec.disruption.*`는 behavioral field라 이 값을 바꿔도 drift가 나지 않습니다 — 필드를 고쳐 기존 노드가 교체되기를 기대하면 안 됩니다.

### 2.4 `terminationGracePeriod`와 PDB·do-not-disrupt의 우선순위

`NodePool.spec.template.spec.terminationGracePeriod`(→ NodeClaim `spec.terminationGracePeriod`)가 신설됐습니다. 드레인 시작과 함께 카운트다운이 돕니다. 만료되면 남은 파드가 강제 삭제되고 인스턴스가 종료됩니다. `expireAfter`처럼 **drift 가능 필드**여서 값을 바꾸면 기존 NodeClaim은 안 바뀌고 교체 대상이 됩니다.

| 순위 | 장치 | 유효 범위 |
|---|---|---|
| 1 | TGP 만료 | 최종 승자. PDB·`do-not-disrupt` 무관하게 강제 삭제 |
| 2 | 파드 `terminationGracePeriodSeconds` 선제 삭제 | `노드 TGP − 파드 TGPS` 시점에 미리 삭제(예시는 아래) |
| 3 | `do-not-disrupt`(duration 형식, 1.12+) | PDB 평가보다 **먼저** 확인. 기간 남으면 PDB 무관 보호 |
| 4 | PDB | 드레인을 지연시킨다. TGP 만료까지만 유효 |
| 5 | `do-not-disrupt: "true"`(영구) | TGP가 **없으면** 무기한 이긴다 |

노드 TGP 1h에 파드 TGPS 300s면 순위 2의 선제 삭제가 **55분 시점에** `do-not-disrupt` 파드까지 지웁니다.

부작용은 반대 방향으로도 옵니다 — TGP를 설정한 NodeClaim은 **drift 후보 선정 단계**부터 PDB·`do-not-disrupt` 블로킹 파드가 있어도 채택됩니다(`disruption.md:299-301`, 콜아웃 참고). 업스트림은 이를 의도로 설명합니다("crucial updates (e.g. AMI updates addressing CVEs) can't be blocked by misconfigured applications").

그래서 두 방향으로 나눠 결정합니다 — **`expireAfter`를 쓰는 NodePool**은 TGP 필수, **`expireAfter` 없이 drift만 도는 NodePool**은 CVE 패치를 강제로 밀 필요가 있을 때만 겁니다. `do-not-disrupt`가 애초에 못 막는 것은 Expiration·Interruption·Node Repair·수동 삭제입니다. 그중 **Interruption(스팟 2분)과 Node Repair(컨디션별 toleration)는 암묵적 상한이 있지만 Expiration·수동 삭제는 상한이 없습니다**(`disruption.md:444-447`).

### 2.5 disruption budgets의 reason별 통제

budgets 자체는 v0.34.0부터 있었고 v1.0에서 `reasons: ["Drifted"|"Underutilized"|"Empty"]`가 추가됐습니다. 계산 규칙은 셋입니다.

- 퍼센트는 `roundup(total × pct) − total_deleting − total_notready`, 정수는 `value − total_deleting − total_notready`. **삭제 중 노드와 NotReady 노드가 예산을 먹습니다** — 이미 죽어가는 노드가 많으면 정상 disruption이 통째로 막힙니다.
- 여러 budget이 active면 **최솟값**입니다. 특정 reason의 허용치는 "그 reason을 나열한 budget"과 "reasons를 안 쓴 budget"의 최솟값입니다(`designs/disruption-controls-by-reason.md:220-226`).
- **자발적 disruption만 막습니다.** drift·emptiness·consolidation이 대상이고 expiration·interruption·node repair는 아닙니다. NodePool 전체를 멈추는 `budgets: [{nodes: "0"}]`도 expiration은 못 막습니다.

§2.1의 세 budget이 실전 패턴입니다 — "유지보수 시간대에는 drift만 허용", "비용 절감(Underutilized)은 야간에만"처럼 reason을 시간축과 곱해서 씁니다.

## 3. 1.1 — v1beta1 종료 이후

절차상 경계 둘. **`nodeClassRef.group`·`kind` 강제 필수화**(모든 NodePool·NodeClaim에 값이 있는지 사전 확인, `upgrade-guide.md:297`)와 **v1beta1 kubelet 호환 어노테이션 지원 종료**(§2 표의 kubelet 이동이 안 끝난 클러스터는 여기서 막힙니다 — EC2NodeClass 분리 → `nodeClassRef` 변경 → drift가 세트로 옵니다). 운영 체감이 바뀌는 것은 넷입니다.

- Bottlerocket `instanceStorePolicy: RAID0` — AL2·AL2023처럼 instance store를 RAID0으로 묶는 userData를 **자동 생성**합니다. 이 userData는 **Bottlerocket v1.22.0+에서만 유효**해서 그 미만 이미지에 이 조합을 쓰면 **노드가 클러스터에 join하지 못합니다**(`upgrade-guide.md:298-299`)
- Neuron 가속기 라벨 값 교정 — `karpenter.k8s.aws/instance-accelerator-name`이 모든 Neuron 가속기에 `inferentia`를 붙이던 것이 `trainium`/`inferentia`/`inferentia2`로 갈립니다. `inferentia`를 하드코딩한 셀렉터는 trainium 노드를 못 잡습니다
- generic operator 메트릭 deprecated — 접두사 없는 `operator_*`가 node/nodeclaim/nodepool/ec2nodeclass별로 쪼개졌습니다(`upgrade-guide.md:302`) — 리소스 구분 없이 집계하던 패널이 값을 잃습니다
- 내부 `karpenter.k8s.aws/cluster` 태그 제거 — launch template 관리용 내부 태그가 `eks:eks-cluster-name`으로 통합됐습니다. 이 태그로 비용 할당·SCP를 걸어둔 계정은 확인이 필요합니다

Node Auto Repair(`NodeRepair` gate)도 여기서 alpha로 들어왔습니다([core#1793](https://github.com/kubernetes-sigs/karpenter/pull/1793)·[aws#7459](https://github.com/aws/karpenter-provider-aws/pull/7459)). **1.14 기준으로도 여전히 alpha·기본 false입니다**(`reference/settings.md` Feature Gates 표의 Until 칸이 비어 있습니다). 표준 drain·grace period를 **우회**하고 disruption budget도 안 받으므로 켜기 전에 Node Problem Detector(NPD)나 EKS Node Monitoring Agent가 컨디션을 실제로 달아주는지부터 확인합니다 — 에이전트가 없으면 아무 일도 하지 않습니다.

## 4. 1.2 — 컨트롤러·메트릭 정리

기능 변경 없이 **관측성 계층만** 깨지는 릴리스입니다. CRD도 API도 안 바뀌므로 CI가 못 잡고 알람이 조용히 무효화됩니다.

`karpenter_voluntary_disruption_queue_failures_total`과 `karpenter_nodeclaims_disrupted_total`의 `reason` 라벨 값이 `Drifted`→`drifted`, `Empty`→`empty`, `Expired`→`expired`, `Underutilized`→`underutilized`로 바뀌었습니다(`upgrade-guide.md:282-286`). 코드에서는 `pretty.ToSnakeCase(string(cmd.Reason()))`로 정규화됩니다(`controllers/disruption/queue.go:243`). 컨트롤러 라벨도 두 번 바뀝니다 — 0.37에서 `nodeclass`가 셋으로 쪼개졌던 것이 1.2에서 다시 하나로 합쳐졌습니다. 현재 코드에는 `nodeclass` 컨트롤러만 남아 있습니다(`AWS/pkg/controllers/nodeclass/controller.go:120`). 0.36에서 1.2 이상으로 직행하면 두 변경을 한 번에 받으므로 컨트롤러 라벨 필터는 `controller=~"nodeclass(\\.(status|hash|termination))?"`처럼 세 형태를 모두 커버해두는 편이 안전합니다.

```promql
# 1.2 이전 쿼리 — 이후에는 에러 없이 결과가 빈다
sum by (nodepool) (increase(karpenter_nodeclaims_disrupted_total{reason="Drifted"}[1h]))

# 업그레이드 전후를 한 쿼리로 커버(RE2 대소문자 무시). 이행 기간에만 쓰고 정리한다
sum by (nodepool) (increase(karpenter_nodeclaims_disrupted_total{reason=~"(?i)drifted"}[1h]))
```

같은 릴리스의 Node Monitoring Agent 연동([aws#7545](https://github.com/aws/karpenter-provider-aws/pull/7545))과 Repair Policy에 Unknown Kubelet Ready 컨디션 추가([aws#7514](https://github.com/aws/karpenter-provider-aws/pull/7514))는 `NodeRepair` 게이트가 꺼져 있으면 실질 영향이 없습니다.

## 5. 1.3~1.5 — ODCR의 시작과 스케줄링 유연성

### 5.1 `reserved` capacity-type과 `nodeSelector: on-demand`가 깨지는 이유

1.3에서 `ReservedCapacity`가 alpha(기본 off)로 들어왔습니다. `karpenter.sh/capacity-type` 라벨에 **`reserved`라는 세 번째 값이 생겼습니다.** 그것도 `on-demand`의 하위 분류가 아닌 별개 값입니다. `nodeSelector`로 `on-demand`를 정확히 일치시키던 워크로드는 reserved 노드에 스케줄되지 않습니다 — **에러가 아니고 그냥 예약을 못 씁니다**. "any applications that explicitly select on `on-demand` with a `nodeSelector` and want to utilize ODCR capacity may need to update their requirements to use `nodeAffinity`"(`upgrade-guide.md:273`).

```yaml
# 깨지는 쪽 — reserved 노드를 절대 안 쓴다
spec:
  nodeSelector:
    karpenter.sh/capacity-type: on-demand
---
# 고친 쪽 — reserved를 우선 쓰고 on-demand로 폴백
spec:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
        - matchExpressions:
          - key: karpenter.sh/capacity-type
            operator: In
            values: ["reserved", "on-demand"]
```

NodePool도 `requirements`에 `capacity-type In ["reserved", "on-demand"]`로 열어줘야 합니다. 우선순위는 Karpenter가 정합니다 — ODCR은 선결제분이라 **비용 0으로 모델링**하고, 스케줄링과 consolidation 모두에서 최우선으로 둡니다. 없으면 spot/on-demand로 폴백합니다(`tasks/odcrs.md:69-84`). `karpenter.k8s.aws/capacity-reservation-id`·`-type`·`-interruptible` 라벨은 **reserved 노드에만** 붙으므로 capacity-type으로 노드를 집계하는 대시보드도 손봐야 합니다. nodeSelector와 nodeAffinity의 의미 차이는 [03]({{< relref "03-keyword-reference.md" >}})가 소유합니다.

### 5.2 이 구간에서 실제로 쓸 만한 것

| 기능 | 버전 | 판정 |
|---|---|---|
| `NodeRegistrationHealthy` NodePool 컨디션([core#1969](https://github.com/kubernetes-sigs/karpenter/pull/1969)) | 1.4, 게이트 없음 | **좋음** — 등록 실패의 1차 진단점(관찰용) |
| `PreferencePolicy`([core#2122](https://github.com/kubernetes-sigs/karpenter/pull/2122)) | 1.4, 전역·기본 `Respect` | **조건부** — 전역 옵션, 배치 품질과 상충 |
| 전역 기본 terminationGracePeriod([core#2088](https://github.com/kubernetes-sigs/karpenter/pull/2088)) | 1.4, 전역 | **좋음** — 안전한 하한을 일괄 적용(§2.4) |
| `karpenter_pods_drained_total`([core#2044](https://github.com/kubernetes-sigs/karpenter/pull/2044)), 인스턴스 동적 선택([aws#7939](https://github.com/aws/karpenter-provider-aws/pull/7939)) | 1.5 | **좋음** — 드레인 관측·API 감소(§6.3) |

보안그룹 아웃바운드 누락 같은 등록 실패가 컨디션으로 드러나므로 `NodeRegistrationHealthy`는 "노드가 안 뜨는데 이유를 모르겠다"의 1차 진단점이 됩니다 — 다만 스케줄링 판정에는 반영되지 않습니다. `PreferencePolicy`는 Karpenter가 preferred affinity를 처음엔 required처럼 취급해 노드가 예상보다 많이 뜨는 문제가 있습니다. `Ignore`는 bin-packing을 개선하는 대신 배치 품질을 떨어뜨리며 전역이라 일부 워크로드에만 못 겁니다.

잘못 짚기 쉬운 셋을 못박아둡니다. **`minValues`는 신기능이 아닙니다** — v0.35.0([core#963](https://github.com/kubernetes-sigs/karpenter/pull/963))부터 있는 API입니다. 1.6의 신설분은 이걸 어떻게 취급할지 정하는 `MinValuesPolicy`입니다(§6.2). **`Gte`/`Lte`는 v1.9.0**([core#2674](https://github.com/kubernetes-sigs/karpenter/pull/2674))입니다(`Gt`/`Lt`는 업스트림 Kubernetes 연산자로 그 전부터 있었고 Karpenter 확장분이 `Gte`/`Lte`입니다). **NodeOverlay는 v1.7.0**이고 지금도 alpha·기본 false입니다 — 1.3~1.6 어느 릴리스노트에도 없습니다. 뒤의 둘은 [02]({{< relref "02-changelog-maturity.md" >}}).

## 6. 1.6 — ODCR beta 기본 활성화와 MinValuesPolicy

### 6.1 open ODCR 사용자에게 왜 breaking인가

1.3 이전에는 ODCR 네이티브 지원이 없어서 **NodePool 요구사항을 open ODCR과 우연히 호환되게 좁혀 EC2가 알아서 매칭해주는 것**을 이용했습니다. 1.6에서 `ReservedCapacity`가 beta·기본 ON이 되면 그 암묵적 매칭이 사라집니다. `capacityReservationSelectorTerms`에 등재되지 않은 open ODCR은 Karpenter가 더 이상 쓰지 않습니다.

> "If you use ODCRs with `open` instance eligibility but have **not** set `spec.capacityReservationSelectorTerms` on your EC2NodeClasses, Karpenter stops using those reservations after this upgrade and falls back to on-demand — leaving reservations unused but still billed." (`upgrade-guide.md:228-231`)

문서가 따로 못박는 문장도 같은 취지입니다 — "Karpenter does **not** support open matching for ODCRs"(`tasks/odcrs.md:61-62`). **순서가 중요합니다** — 게이트가 켜진 뒤에 셀렉터를 심으면 그 사이에 예약이 유실됩니다.

**증상.** `open` eligibility ODCR을 EC2 콘솔에만 등록하고 EC2NodeClass 셀렉터 없이 1.6으로 올라온 클러스터는, 노드는 계속 뜨는데 전부 on-demand로 과금됩니다 — 스케줄링 실패나 에러 없이 조용히 예약을 놀립니다. `kubectl get nodes -L karpenter.sh/capacity-type`로 봅니다. 예약해 둔 인스턴스 패밀리인데 `reserved` 라벨이 붙은 노드가 하나도 없으면 이 상황입니다(§5.1 — 이 라벨은 reserved 노드에만 붙습니다). AWS 콘솔 Capacity Reservations의 "사용 가능한 용량"이 줄지 않는 것도 같은 신호입니다.

```yaml
apiVersion: karpenter.k8s.aws/v1
kind: EC2NodeClass
metadata:
  name: ml
spec:
  # amiSelectorTerms · role · subnet/securityGroupSelectorTerms 는 기존 값 유지
  # 1.6으로 올리기 "전에" 아래 블록을 먼저 심는다
  capacityReservationSelectorTerms:
  - tags:
      application: ml-training
  - id: cr-56fac701cc1951b03
  - instanceMatchCriteria: open    # open eligibility ODCR도 명시적으로 선택해야 한다
```

체크리스트 셋. ① 계정의 ODCR 목록과 각 예약의 `instanceMatchCriteria`를 뽑아 위 블록으로 옮깁니다. ② 해당 NodePool이 `capacity-type: reserved`와 호환되는지 확인합니다. ③ `nodeSelector`로 `capacity-type`을 정확 일치시키는 워크로드를 grep해 `nodeAffinity`로 바꿉니다(§5.1). ODCR을 계약해 쓰지 않는 클러스터는 기본 ON이어도 영향이 없습니다 — 그래도 ③은 해두는 게 낫습니다.

Capacity Blocks 지원([aws#8011](https://github.com/aws/karpenter-provider-aws/pull/8011))에는 종료 타이밍 규칙이 있습니다. EC2는 Capacity Block 종료 30분 전(UltraServer는 60분 전)부터 인스턴스를 종료합니다. **Karpenter는 그보다 10분 더 일찍 선제 드레인을 시작합니다**(`tasks/odcrs.md:88-99`). ML 학습 잡의 체크포인트 주기를 이 시각에 맞춥니다.

### 6.2 MinValuesPolicy — Strict와 BestEffort의 선택 기준

`MIN_VALUES_POLICY` / `--min-values-policy` 전역 옵션이 추가됐습니다. 기본값은 기존 동작을 보존하는 `Strict`입니다.

| 정책 | 동작 | 판정 |
|---|---|---|
| `Strict`(기본) | `minValues` 미충족 시 스케줄링 **실패** → 폴백 탐색 | **기본** — 완화 시 가용성 보장이 조용히 깨진다 |
| `BestEffort` | 실패 대신 `minValues`를 **완화**해 진행(어노테이션·메트릭 라벨로 표시) | **조건부** — 폴백 NodePool도 없을 때만 |

완화된 NodeClaim에는 `karpenter.sh/nodeclaim-min-values-relaxed` 어노테이션이 붙고 `min_values_relaxed` 라벨로 집계됩니다. 사용자가 명시한 하한선이 몰래 완화되면 안 되니 `Strict`가 기본입니다. `BestEffort`는 요구 개수를 못 채우고 폴백 NodePool도 없어 파드가 영구 Pending인 상황에서만 씁니다.

`BestEffort`의 함정 둘. 전역이라 **NodePool별로 다르게 줄 수 없습니다** — "일부 워크로드만 완화"가 필요하면 NodePool을 분리하고 `minValues`를 낮추는 쪽이 명확합니다. 완화된 값은 그 NodeClaim의 requirements에 기록되므로 완화가 반복되면 실질 유연성 하한이 서서히 낮아지고 spot-to-spot replace consolidation의 하한(`MinInstanceTypesForSpotToSpotConsolidation = 15`, `controllers/disruption/consolidation.go:48`)과도 상호작용합니다. 전환 전에 근거부터 확인합니다 — `NoCompatibleInstanceTypes` 이벤트가 실제로 찍히는지, `karpenter_scheduler_unschedulable_pods_count`가 특정 NodePool에서만 쌓이는지.

### 6.3 DisableDryRun이 필요한 상황

`DISABLE_DRY_RUN` / `--disable-dry-run`은 EC2NodeClass 검증 과정의 dry-run EC2 API 호출을 끕니다. **1.6.0이 아니라 1.6.2에서 들어왔습니다**(`upgrade-guide.md:233`, 마이너 릴리스노트에는 없습니다).

필요한 상황은 하나입니다 — EC2NodeClass가 많거나 리전의 EC2 API 쿼터를 다른 워크로드가 이미 많이 써서 **검증용 dry-run 자체가 `RequestLimitExceeded`를 유발**하는 경우입니다. 끄면 잘못된 IAM 역할·서브넷·보안그룹을 **검증 단계에서 못 잡고** 실제 `CreateFleet` 시점에야 실패가 드러납니다 — **EC2NodeClass 스펙이 안정화되어 거의 안 바뀌는 계정에서만** 켭니다.

1.6은 kube-reserved 메모리 계산 방식도 바꿔 allocatable 값이 달라집니다 — 메모리 오버커밋 튜닝값에 주는 영향을 업그레이드 후 재확인해야 합니다.

## 7. 버전별 운영 판단 표

| 버전 | 얻는 것 | 조심할 것 |
|---|---|---|
| **1.0** | v1 API, budgets by reason, TGP | drift 강제 ON·forceful expiration·메트릭 rename·`consolidateAfter` 필수(§2) |
| **1.1** | v1beta1 부채 청산, Bottlerocket RAID0 | `nodeClassRef` 누락 시 리소스 조작 불가, <v1.22.0 join 실패(§3) |
| **1.2** | 컨트롤러 단순화 | reason 라벨 snake_case — **조용한 알람 무효화**(§4) |
| **1.3** | ODCR alpha(옵트인), k8s 1.32 하한 | `reserved` 값 신설 — `on-demand` 셀렉터가 예약 못 씀(§5.1) |
| **1.4** | `NodeRegistrationHealthy`, 전역 기본 TGP | `PreferencePolicy`는 전역이라 일부 적용 불가 |
| **1.5** | **k8s 1.33 하한**, EC2 API 호출 감소 | 없음(`No breaking changes`) |
| **1.6** | **k8s 1.34 하한**, ODCR·Capacity Blocks·`MinValuesPolicy`(§6) | **open ODCR 미등재 시 과금**, kube-reserved 변경(§6) |
| 1.7+ | — | — |

버전별 조치는 이렇습니다.

- **1.0** — **전**: 만료 임박 조사→reason별 budget 선배치→`consolidateAfter`·TGP 부여(§2.1~2.5). 대시보드 rename 반영
- **1.1** — `nodeClassRef`·Bottlerocket 이미지 버전 확인, `inferentia` 하드코딩 셀렉터 grep
- **1.2** — Prometheus 룰의 `reason=~"Drifted|Empty|Expired|Underutilized"`와 `controller=~"nodeclass\.(status|termination)"` 전수 검색·수정
- **1.3** — 셀렉터 grep → `nodeAffinity` 전환. `karpenter_ignored_pod_count` 리네임
- **1.4** — 런북에 `NodeRegistrationHealthy` 추가
- **1.6** — **전** `capacityReservationSelectorTerms` 선등록(§6.1 체크리스트)
- **1.7+** — [02]({{< relref "02-changelog-maturity.md" >}})

**1.0은 "동작이 바뀌는" 유일한 경계이고 나머지는 "관측성이 깨지거나 조용히 비용이 나가는" 경계입니다.** 목표 EKS 버전이 이미 최저 Karpenter 버전을 정해버리므로 실제 선택지는 "어디까지 한 번에 갈 것인가"뿐입니다.

## 8. 근거

로컬 경로 접두사: `AWS` = `karpenter-provider-aws`, `CORE` = `karpenter-core`. 문서 경로는 `AWS/website/content/en/` 이하.

- v1 changelog 전문·메트릭 rename/drop 표·버전별 breaking change 원문(0.36~1.14)·k8s 호환 매트릭스 — `v1.0/upgrading/v1-migration.md:20-60, 670-760`, `docs/upgrading/upgrade-guide.md:96-345`, `compatibility.md:18-20`
- disruption 분류·consolidation 정책·`expireAfter`·TGP 우선순위·budgets 계산식 — `docs/concepts/disruption.md:60-145, 185-215, 283-330`
- ODCR 셀렉터 문법·`reserved` 우선순위·open matching 미지원·Capacity Block 선제 드레인 10분 — `docs/tasks/odcrs.md:1-130`, `docs/concepts/nodeclasses.md:912-990, 1824`
- Feature gate 단계·`MIN_VALUES_POLICY`·`DISABLE_DRY_RUN` 기본값·`min_values_relaxed` 라벨 — `docs/reference/settings.md:55-70`, `docs/reference/metrics.md:45-47`, `CORE/pkg/metrics/constants.go:34`
- expiration 즉시삭제/graceful 대기삭제·reason snake_case 변환·Method 파이프라인·드레인→detach→종료 순서와 `disrupted` taint — `CORE/pkg/controllers/nodeclaim/expiration/controller.go:69-105`, `disruption/queue.go:186-250`, `disruption/controller.go:101-114`, `node/termination/controller.go:134-227`
- forceful expiration RFC의 설계 대안과 graceful 전환 경위, budgets by reason 계산식 — `CORE/designs/forceful-expiration.md:3-67`, `designs/disruption-controls-by-reason.md:220-226, 337-339`
- 도입 버전 — `minValues`=v0.35.0(`0fea7ce`), ReservedCapacity alpha=v1.3.0(`a863104`)·beta=v1.6.0(`20e1ad4`), `MinValuesPolicy`=v1.6.0(`7034d83`), `Gte`/`Lte`=v1.9.0(`c81e6ac`), NodeOverlay 게이트=v1.7.0(`2613a66`) — 두 레포 `git tag --contains <sha>`
- 릴리스일, 마이너별 PR 목록 — `git log -1 --format=%ai <tag>`(AWS), 두 레포 릴리스노트 v0.36.0~v1.14.0
