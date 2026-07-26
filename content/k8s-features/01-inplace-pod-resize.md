---
title: "In-Place Pod Resize (1.35 GA)"
weight: 1
---

# 01 · In-Place Pod Resize — 재시작 없이 파드 리소스를 바꾼다

{{< callout type="info" >}}
**한눈에**
- 1.27 alpha → 1.33 beta → **1.35 GA**. 파드 재시작 없이 CPU/메모리를 바꾼다. 반드시 **`resize` 서브리소스**로만 가능하고, 바꿀 수 있는 건 **cpu·memory 값뿐**이다(QoS 변경·항목 제거·GPU는 전부 거부).
- 수락 판정 기준은 실사용량이 아니라 **"다른 파드들의 requests 합 vs node allocatable"**. 노드가 붐비면 **Deferred**(재시도됨), 정책 위반이면 **Infeasible**(spec을 고치기 전까지 재평가 안 됨).
- **늘리는 방향은 사실상 무위험, 줄이는 방향만 조심.** 메모리 limit 축소는 1.34부터 허용됐지만 kubelet의 사용량 체크에 TOCTOU 레이스가 있어 OOM-kill을 보장 방지하지 못한다(#135670, open).
- 케이스가 전부다: **재시작이 비싼 stateful(DB·캐시·롱커넥션)에 최적**, 기동 부스트에 좋음. JVM/Node 힙에는 반쪽(CPU만 in-place), VPA 자동화는 아직 이르고, static CPU manager 노드는 사실상 미지원.
{{< /callout >}}

> **왜 6년 걸렸나.** "실행 중인 컨테이너의 cgroup 값만 바꾸면 되는 것 아닌가" 싶지만, **스케줄러가 보는 값·kubelet이 약속한 값·커널에 실제 쓰인 값이 서로 다른 순간이 반드시 생기는** 기능이다. 이 셋의 정합성과 kubelet 재시작 후의 복구를 맞추는 데 KEP-1287이 alpha에서 GA까지 6년을 썼다. 이 문서는 공식 문서에서 멈추지 않고 **kubelet이 실제로 하는 일 · 열린 버그 · 케이스별 득실**까지 내려간다.

> 자매 문서: [챕터 개요]({{< relref "_index.md" >}}) · GOMAXPROCS와 CPU limit의 관계는 [istio 09 §8]({{< relref "../istio/09-istiod-scaling-connections.md" >}})

## 1. 요청에서 cgroup까지

사용법은 한 줄이다. `kubectl edit`으로 resources를 고치면 거부되고, `resize` 서브리소스를 태워야 한다(kubectl 1.32+):

```bash
kubectl patch pod my-pod --subresource resize --patch \
  '{"spec":{"containers":[{"name":"app","resources":{"requests":{"cpu":"800m"},"limits":{"cpu":"800m"}}}]}}'
```

요청은 3단계를 거친다 — **apiserver 검증 → kubelet 수락(allocation) → 커널 반영(actuation)**. spec은 PATCH가 통과한 순간 바뀌고, 실제 반영은 비동기다.

{{< seq caption="resize 요청의 생애주기 — spec은 즉시 바뀌고, kubelet이 수락 여부를 판정한 뒤 cgroup을 '커지는 쪽 먼저' 순서로 반영한다" >}}
{
  "participants": [
    { "id": "cli", "label": "kubectl / 컨트롤러" },
    { "id": "api", "label": "kube-apiserver" },
    { "id": "kl", "label": "kubelet" },
    { "id": "rt", "label": "CRI 런타임 · cgroup" }
  ],
  "steps": [
    { "msg": ["cli", "api"], "label": "PATCH pods/<name>/resize" },
    { "note": ["api"], "lines": ["ValidatePodResize:", "QoS 불변 · cpu/memory 값만 · 제거 금지"] },
    { "msg": ["api", "cli"], "label": "spec 즉시 갱신 — 반영은 비동기", "dashed": true },
    { "msg": ["api", "kl"], "label": "watch: desired ≠ allocated" },
    { "note": ["kl"], "lines": ["canAdmitPod:", "다른 파드 allocated 합 vs node allocatable"] },
    { "alt": "수락", "steps": [
      { "note": ["kl"], "lines": ["checkpoint 기록 → PodResizeInProgress"] },
      { "msg": ["kl", "rt"], "label": "① 커지는 limit: pod cgroup 먼저 확대" },
      { "msg": ["kl", "rt"], "label": "② UpdateContainerResources (감소 컨테이너부터)" },
      { "msg": ["kl", "rt"], "label": "③ 줄어드는 limit: pod cgroup 나중에 축소" },
      { "msg": ["kl", "api"], "label": "status.…resources 갱신 · 컨디션 해제" }
    ], "elseLabel": "보류 / 불가", "elseSteps": [
      { "msg": ["kl", "api"], "label": "PodResizePending — Deferred(재시도 큐) / Infeasible(큐 이탈)" }
    ] }
  ]
}
{{< /seq >}}

반영 순서에는 한 원칙만 있다: **커지는 쪽은 부모(pod cgroup) 먼저, 줄어드는 쪽은 자식(container) 먼저.** 어느 순간에도 `child ≤ parent`, `request ≤ limit`을 깨지 않기 위해서다. 참고로 메모리 request는 아예 cgroup에 쓰이지 않는다(스케줄링·QoS 계산용).

관찰 지점은 네 곳이다. 예전 자료에 나오는 `status.resize` 필드는 **deprecated**고 컨디션 두 개로 대체됐다.

| 지점 | 의미 |
|---|---|
| `status.conditions[PodResizePending]` | 수락 대기. `Deferred`(나중에 될 수 있음 — 재시도) / `Infeasible`(이 노드에선 불가 — **재시도 안 됨**) |
| `status.conditions[PodResizeInProgress]` | 수락됐고 커널 반영 중. 실패 시 `reason: Error`로 남고 매 sync 재시도 |
| `status.containerStatuses[].allocatedResources` | kubelet이 수락(checkpoint)한 requests |
| `status.containerStatuses[].resources` | 실행 중 컨테이너에 실제 반영된 값(CRI 리포트 기준) |

**"끝났다"의 판정**은 `status.observedGeneration ≥ metadata.generation` **이면서 위 두 컨디션이 모두 없을 때**다(업스트림 e2e 기준). observedGeneration만 보면 안 된다 — `PodObservedGenerationTracking` 게이트가 꺼진 클러스터에선 0으로 남는다.

## 2. GA 기준 되는 것 / 안 되는 것

| 되는 것 | 안 되는 것 |
|---|---|
| cpu·memory requests/limits **값 변경**(증가·감소) | cpu·memory 외 리소스(GPU, ephemeral-storage 등) |
| 메모리 limit 감소 (1.34부터, best-effort) | **QoS class가 바뀌는 모든 변경**(4방향 전부) |
| 사이드카(restartable init) 컨테이너 resize | requests/limits **항목 제거**(값 변경만 가능) |
| 리소스별 `resizePolicy`(cpu 무중단 + memory 재시작 조합) | `resizePolicy` 자체의 사후 변경 |
| Deferred resize의 우선순위 기반 재시도 | Windows·static 파드, non-restartable init·ephemeral 컨테이너 |
| | 스왑 쓰는 컨테이너의 메모리 resize, static CPU/Memory Manager 노드의 Guaranteed 파드 |

**"GA됐다"가 "관련 기능이 다 켜졌다"는 뜻이 아니다.** 본체만 GA고 파생 기능은 각자 게이트 뒤에 있다:

| Feature gate | 상태 | 내용 |
|---|---|---|
| `InPlacePodVerticalScaling` | **1.35 GA** (locked) | 본체 |
| `…InitContainers` | 1.37 GA | non-restartable init 컨테이너 resize |
| `InPlacePodLevelResourcesVerticalScaling` | 1.36 beta | pod-level resources의 resize |
| `…ExclusiveCPUs` / `…ExclusiveMemory` / `…MemoryBackedVolumes` / `…SchedulerPreemption` | 1.32~1.37 **alpha** | static manager 조합, emptyDir sizeLimit, Deferred용 스케줄러 선점 |

런타임 전제: CRI의 `UpdateContainerResources`는 containerd 1.6.9+에서 지원된다. cgroup v1은 메모리 감소 동작이 다르고 스왑 재계산도 안 되므로 실질적으로 **cgroup v2 전제**로 보는 게 맞다.

## 3. 문서에 안 나오는 세 가지 함정

### 3.1 Infeasible은 영원히 Infeasible이다

kubelet의 수락 판정(`canAdmitPod`)은 **"이미 checkpoint된 다른 파드들의 requests 합 vs `node.status.allocatable`"** 로 이뤄진다 — 실사용량이 아니다. 노드가 requests 기준으로 꽉 차 있으면 실제 CPU가 놀고 있어도 Deferred가 된다.

{{< flow caption="수락 판정의 세 갈래 — Deferred는 큐에 남아 재시도되지만, Infeasible은 큐에서 이탈해 spec을 고치기 전까지 되살아나지 않는다" >}}
{
  "nodes": [
    { "id": "req", "col": 0, "row": 1, "label": "resize PATCH", "sub": "spec은 즉시 갱신", "kind": "src" },
    { "id": "adm", "col": 1, "row": 1, "label": "kubelet 수락 판정", "sub": "requests 합 vs node allocatable", "kind": "proc" },
    { "id": "ok", "col": 2, "row": 0, "label": "수락", "sub": "checkpoint 기록", "kind": "proc" },
    { "id": "def", "col": 2, "row": 1, "label": "Deferred", "sub": "지금은 불가 · 나중엔 가능", "kind": "query" },
    { "id": "inf", "col": 2, "row": 2, "label": "Infeasible", "sub": "스왑 · static manager 등", "kind": "sink" },
    { "id": "cg", "col": 3, "row": 0, "label": "cgroup 반영", "sub": "커지는 쪽 부모 먼저", "kind": "proc" },
    { "id": "retry", "col": 3, "row": 1, "label": "재시도 큐 → 판정 재진입", "sub": "이벤트 4종 · 30초→3분 타이머", "kind": "query" },
    { "id": "dead", "col": 3, "row": 2, "label": "재평가 없음", "sub": "spec을 고쳐 새 요청을 내야 한다", "kind": "sink" }
  ],
  "edges": [
    { "from": "req", "to": "adm", "rate": 700 },
    { "from": "adm", "to": "ok", "rate": 700 },
    { "from": "adm", "to": "def", "label": "노드가 붐빔", "rate": 900 },
    { "from": "adm", "to": "inf", "label": "정책 위반", "rate": 1400 },
    { "from": "ok", "to": "cg", "rate": 700 },
    { "from": "def", "to": "retry", "rate": 900 },
    { "from": "inf", "to": "dead", "dashed": true }
  ]
}
{{< /flow >}}

분류 기준이 중요하다. status manager는 `reason != Infeasible`이면 **무조건 Deferred로 정규화**하고, 진짜 Infeasible은 kubelet이 정책 위반을 명시적으로 반환할 때뿐이다. 공식 문서는 Infeasible을 "재평가되지 않을 수 있다"고 모호하게 쓰지만, 코드상으론 spec을 다시 바꾸기 전까지 **절대 재평가되지 않는다.** 보이면 기다리지 말고 요청을 고쳐야 한다.

Deferred가 여럿이면 4단계로 정렬된다: ① 요청을 늘리지 않는 resize ② PriorityClass 높은 순 ③ Guaranteed 우선 ④ 오래 기다린 순. 단 이 우선순위는 **pending resize들끼리의 얘기**고, 신규 파드 admission과는 FCFS로 경쟁한다 — 리사이즈가 대기 중일 때 새 파드가 그 자원을 먼저 가져갈 수 있다.

### 3.2 메모리 축소에는 레이스가 남아 있다

메모리 limit **감소**는 커널에 쓰기 전에 kubelet이 현재 사용량을 조회해 `usage >= 새 limit`이면 시도 전체를 실패시킨다. 함정 둘:

- 이 usage는 cAdvisor 캐시 또는 CRI 스냅샷이라 **체크와 반영 사이에 레이스**가 있다. 통과 후 사용량이 튀면 cgroup v2는 그대로 OOM-kill로 이어진다(cgroup v1은 커널이 쓰기 자체를 거부 — 비대칭). 이게 열린 이슈 #135670의 본체다.
- 메모리 체크 실패는 **같은 시도에 묶인 CPU 변경까지 통째로** 실패시킨다. "CPU만이라도 먼저"는 없다.

CRI 호출이 중간에 실패하면 pod-sandbox 레벨은 롤백하지만 **컨테이너 레벨은 롤백 없이 그 자리에서 중단**한다. pod cgroup은 새 값, 일부 컨테이너는 옛 값인 불일치가 다음 sync까지 남을 수 있고 `PodResizeInProgress`가 `reason: Error`로 이를 알린다.

### 3.3 RestartContainer는 "크래시와 똑같은" 재시작이다

`resizePolicy: RestartContainer`로 유발된 재시작은 별도 취급이 없다. **restartCount가 +1 되고**(크래시와 구분 불가) **CrashLoopBackOff 백오프도 그대로 적용**된다. 운영 함정 둘 — restartCount 기반 알람이 정상 resize에 오탐되고, 이미 백오프 중인 컨테이너는 resize 반영이 백오프 타이머만큼 밀린다.

{{< callout type="warning" >}}
**노드 장애 시나리오에 파일이 하나 늘었다.** 수락된 값은 `/var/lib/kubelet/allocated_pods_state` 단일 JSON에 checkpoint되고 kubelet 재시작 시 신뢰 소스가 된다. **체크섬이 깨지면 kubelet은 로그가 아니라 panic으로 죽는다** — 노드를 drain하고 파일을 지운 뒤 재시작해야 한다.
{{< /callout >}}

## 4. 열려 있는 버그

beta(1.33) 이전의 stuck 버그들(항상 재시작 #122760, InProgress 고착 #123441·#125559·#126388, 상태 레이스 #125394)은 1.33~1.34의 상태 모델 재설계(#128922)와 함께 닫혔다. **1.33 미만에서 이 기능을 켜는 건 그 버그들을 그대로 밟는 일이다.** GA 이후 기준으로 남은 것들:

| 이슈 | 내용 | 운영 시사점 |
|---|---|---|
| [#135670](https://github.com/kubernetes/kubernetes/issues/135670) | 메모리 감소 usage 체크의 TOCTOU 레이스 — 체크를 런타임 쪽으로 옮기는 설계 논의 중 | **메모리 축소 자동화는 보수적으로** |
| [#126891](https://github.com/kubernetes/kubernetes/issues/126891) | 스케줄링 도중 resize하면 스케줄러가 옛 값으로 배치 → kubelet이 OutOfCPU/Memory로 거부 | 생성 직후 파드의 resize는 Running 확인 후에 |
| [#131309](https://github.com/kubernetes/kubernetes/issues/131309) | static CPU manager에서 스케일다운 시 busy CPU를 회수해 affinity 파괴 | latency-sensitive 노드에서 쓰지 말 것 |
| [autoscaler#8609](https://github.com/kubernetes/autoscaler/issues/8609) | VPA `InPlaceOrRecreate`가 in-place도 evict도 안 하고 무한 대기 | VPA in-place는 아직 관찰 단계 |

이 외에 컨디션 기반 자동화라면 resize 취소 시 컨디션 레이스([#132851](https://github.com/kubernetes/kubernetes/issues/132851)), allocated resources 기록 실패의 복구 경로 부재([#133538](https://github.com/kubernetes/kubernetes/issues/133538)), 스왑 노드의 `memory.swap.max` 재계산 미구현([#130111](https://github.com/kubernetes/kubernetes/issues/130111)), VPA의 클러스터 비호환 미고지([autoscaler#8288](https://github.com/kubernetes/autoscaler/issues/8288))도 함께 본다.

버그는 아니지만 알아둘 것: resize 관련 kubelet 메트릭 7종(`pod_resize_duration_milliseconds`, `pod_pending_resizes`, `pod_infeasible_resizes_total` 등)은 기능이 GA인데도 전부 **ALPHA 안정성**이라 이름·라벨이 바뀔 수 있다.

## 5. 케이스별 득실

| 케이스 | 판정 | 근거 |
|---|---|---|
| ① 재시작 비싼 stateful (DB·캐시·롱커넥션) | **최적** | 이 기능의 존재 이유. 늘리는 방향은 무위험, 메모리 축소만 보수적으로 |
| ② 기동 부스트 (JVM cold start) | **좋음** | 큰 값으로 스케줄링 → 기동 후 무중단 축소. 전용 오퍼레이터 존재 |
| ③ 장기 배치·ML | **좋음** | 재시작 = 진행 손실인 워크로드에 유효. Deferred 대기는 감수 |
| ④ JVM/Node 힙 메모리 | **반쪽** | 힙은 시작 시 고정 — 메모리는 결국 재시작, CPU만 in-place |
| ⑤ VPA 자동화 | **시기상조** | `InPlaceOrRecreate`가 alpha + 무한 대기 버그, 메모리 축소는 결국 eviction |
| ⑥ latency-sensitive + static CPU manager | **부적합** | admission에서 Infeasible, 우회 게이트 alpha. actuation 경로에 **cpuset 재계산 자체가 없다** |

### ① 재시작이 비싼 stateful — 이 기능의 본진

수 GB 버퍼 풀을 데운 DB, 수만 커넥션을 문 게이트웨이, 웜업에 수십 분 걸리는 캐시. 지금까지 이런 워크로드의 리소스 조정은 "재시작 비용 > 리소스 낭비 비용"이라 방치가 합리적이었다. in-place resize는 그 트레이드오프 자체를 없앤다 — **늘리는 방향은 사실상 리스크가 없다**(수락되면 무중단, 실패해도 원상태 유지).

줄이는 방향만 조심하면 된다. CPU 감소는 안전(스로틀만 변함), 메모리 limit 감소는 §3.2의 레이스를 안고 간다 — 현재 사용량과 충분한 마진을 두고 사용량이 안정된 시간대에. 그리고 노드에 headroom이 없으면 §3.1의 Deferred에 걸려 "무중단 조정"이 "무한 대기"가 된다는 것도 계산에 넣어야 한다.

### ② 기동 부스트 — kube-startup-cpu-boost가 하는 일

"시작할 때 크게, 뜨고 나면 작게"를 자동화하는 패턴이다. Google의 [kube-startup-cpu-boost](https://github.com/google/kube-startup-cpu-boost)는 mutating webhook이 파드 **CREATE 시점**에 CPU를 올려 큰 값으로 스케줄링시키고, Fixed duration(5초 폴링) 또는 PodCondition(예: `Ready=True`) 정책이 만료되면 **`pods/{name}/resize`를 PATCH**해 원래 값으로 되돌린다. 회수는 감소 방향이라 노드 용량 때문에 실패할 일이 없다. 부스트로 QoS class가 바뀌는 컨테이너와 CPU `resizePolicy: RestartContainer`인 컨테이너는 건너뛴다.

**함정도 있다.** PodCondition 회수는 컨디션 변경 이벤트에서만 재진입하므로 그 시점 PATCH가 실패하면 재시도 기회가 없다(Fixed는 5초마다 무한 재시도 — 비대칭). LimitRange/ResourceQuota를 확인하지 않아 admission 거부와 충돌할 수 있고, HPA/VPA 상호작용 처리도 없다. 그리고 README가 직접 경고하는 것 — **JVM은 부스트된 CPU 수로 스레드풀을 만들고, 회수 후에도 그 풀은 줄지 않는다.** 부스트 → 노드 증설 → 회수 → 컨솔리데이션 → 재스케줄 → 재부스트로 이어지는 Cluster Autoscaler 진동도 조심해야 한다.

### ③ 장기 배치·ML — 재시작이 곧 손실인 곳

체크포인트 없는 학습 잡, 며칠짜리 배치에게 "메모리 부족 → 재시작해서 큰 값으로"는 진행 전체의 손실이다. in-place 증가가 이 문제를 정확히 푼다. 유의점 둘: 노드가 붐비면 Deferred로 기다리는데, 이때 스케줄러는 **desired/allocated/actual 중 최댓값**으로 그 노드를 계산하므로 pending resize가 스케줄 가능 공간을 선점한다. 그리고 batch 우선순위가 낮으면 Deferred 정렬(§3.1)에서도 뒤로 밀린다 — 급한 증설이 필요한 잡에는 PriorityClass를 챙길 것.

> **④ JVM/Node 힙에 대한 보충.** cgroup limit을 늘려도 이미 뜬 JVM은 힙을 재매핑하지 않는다(`-Xmx`, `MaxRAMPercentage` 모두 시작 시점 값). Node.js의 V8 old space도 같다. 현실적인 전략은 **cpu는 `NotRequired`, memory는 `RestartContainer`** 로 정책을 갈라, CPU는 자유롭게 조정하고 메모리 변경은 "재시작을 각오한 이벤트"로 취급하는 것. 대조적으로 **Go 1.25+는 cgroup CPU limit 변경을 약 30초 주기로 감지해 GOMAXPROCS를 스스로 갱신**한다 — resize와 궁합이 가장 좋은 런타임이다.

## 6. 도입 체크리스트

- [ ] **버전/런타임** — K8s 1.35+, containerd 1.6.9+, cgroup v2, 스왑 비활성 노드
- [ ] **늘리기부터** — 증가 방향으로 시작하고, 메모리 축소 자동화는 #135670이 닫히기 전까지 보수적으로
- [ ] **완료 판정 로직** — `observedGeneration ≥ generation` + Pending/InProgress 컨디션 부재. Infeasible은 재시도되지 않으니 알람 대상
- [ ] **restartCount 알람** — `RestartContainer` 정책을 쓴다면 resize로 인한 재시작 오탐을 걸러낼 것
- [ ] **headroom** — Deferred 판정은 requests 합 기준이다. 노드 여유 없이는 "무중단"이 "무한 대기"가 된다
- [ ] **언어 런타임 궁합** — Go 1.25+ ◎ / JVM·Node 메모리는 RestartContainer 전제로 설계

## 이 문서에서 가져갈 것

- resize는 **`resize` 서브리소스로만** 가능하고 **cpu·memory 값 변경만** 허용된다. spec은 즉시 바뀌지만 반영은 비동기라, 완료 판정은 `observedGeneration` + **컨디션 두 개의 부재**로 해야 한다.
- 수락은 **requests 합 기준**이다. 실제 CPU가 놀아도 Deferred가 될 수 있고, **Infeasible은 spec을 고치기 전까지 영원히 재평가되지 않는다.**
- **늘리는 방향은 무위험, 줄이는 방향만 위험하다.** 메모리 축소는 TOCTOU 레이스(#135670)를 안고 있고, `RestartContainer`는 크래시와 구분되지 않는 재시작이다.
- 결국 **케이스가 전부다.** 재시작이 비싼 stateful·기동 부스트·장기 배치에는 확실한 득이고, JVM 힙·VPA 자동화·static CPU manager 노드에는 아직 아니다.

## 참고 자료

- [KEP-1287: In-Place Update of Pod Resources](https://github.com/kubernetes/enhancements/blob/master/keps/sig-node/1287-in-place-update-pod-resources/README.md) — 설계·제약의 1차 소스
- [v1.35 GA 발표](https://kubernetes.io/blog/2025/12/19/kubernetes-v1-35-in-place-pod-resize-ga) · [v1.33 beta 발표](https://kubernetes.io/blog/2025/05/16/kubernetes-v1-33-in-place-pod-resize-beta/) · [공식 task 문서](https://kubernetes.io/docs/tasks/configure-pod-container/resize-container-resources/)
- [VPA In-Place Updates Support (AEP-4016)](https://github.com/kubernetes/autoscaler/blob/master/vertical-pod-autoscaler/enhancements/4016-in-place-updates-support/README.md) · [google/kube-startup-cpu-boost](https://github.com/google/kube-startup-cpu-boost) · [Go: Container-aware GOMAXPROCS](https://go.dev/blog/container-aware-gomaxprocs)
- 동작 서술의 근거 코드: `kubernetes/kubernetes` master(v1.37.0-beta.0+) — `pkg/kubelet/allocation/`(수락 판정·checkpoint), `pkg/kubelet/kuberuntime/`(반영 순서·실패 처리), `pkg/apis/core/validation/`(ValidatePodResize), `pkg/kubelet/status/`(컨디션)
