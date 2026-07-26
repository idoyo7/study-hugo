---
title: "In-Place Pod Resize (1.35 GA)"
weight: 1
---

# 01 · In-Place Pod Resize — 재시작 없이 파드 리소스를 바꾼다

{{< callout type="info" >}}
**한눈에**
- 1.27 alpha → 1.33 beta(기본 활성화) → **1.35 GA**. 파드를 재시작하지 않고 CPU/메모리 requests·limits를 바꾼다. 변경은 반드시 **`resize` 서브리소스**로만 가능하다.
- 바꿀 수 있는 건 **cpu·memory 값뿐**이다. QoS class 변경, 리소스 항목 제거, GPU·ephemeral-storage 변경은 전부 거부된다. `resizePolicy` 자체도 생성 후엔 못 바꾼다.
- **메모리 limit 축소는 1.34부터 best-effort로 허용**됐다 — kubelet이 현재 사용량을 확인하고 거부하지만 이 체크는 TOCTOU 레이스가 있어 OOM-kill을 보장 방지하지 못한다(#135670, open).
- 수락 판정은 실사용량이 아니라 **"다른 파드들의 allocated requests 합 vs node allocatable"** 이다. 노드가 붐비면 Deferred로 큐에 남아 재시도되고, 정책 위반(스왑, static CPU/Memory Manager 등)만 Infeasible로 영구 탈락한다 — **Infeasible은 spec을 다시 바꾸기 전까지 재평가되지 않는다.**
- cgroup 반영 순서는 한 원칙이다: **커지는 쪽은 부모(pod cgroup) 먼저, 줄어드는 쪽은 자식(container) 먼저.** 어느 순간에도 child ≤ parent, request ≤ limit을 깨지 않는다.
- `resizePolicy: RestartContainer`로 인한 재시작도 **restartCount를 올리고 CrashLoopBackOff 백오프를 그대로 탄다** — restartCount 알람이 오탐되고, 백오프 중인 컨테이너는 resize가 지연된다.
- 완료 판정은 `observedGeneration` 하나로는 부족하다. **`status.observedGeneration ≥ metadata.generation`이면서 PodResizePending/PodResizeInProgress 컨디션이 둘 다 없어야** 완료다(업스트림 e2e가 쓰는 기준).
- 케이스별 결론: **재시작이 비싼 워크로드(DB·캐시·롱커넥션)에 최적이고 기동 부스트에도 좋다.** JVM/Node 힙에는 반쪽(CPU만 in-place), VPA 자동화는 아직 alpha+버그, static CPU manager 노드에는 사실상 미지원.
{{< /callout >}}

> **왜 6년 걸렸나.** "실행 중인 컨테이너의 cgroup 값만 바꾸면 되는 것 아닌가" 싶지만, 스케줄러가 보는 값·kubelet이 약속한 값·커널에 실제 쓰인 값이 **서로 다른 순간이 반드시 생기는** 기능이다. 이 세 값의 정합성(그리고 kubelet 재시작 후의 복구)을 맞추는 데 KEP-1287이 alpha에서 GA까지 6년이 걸렸다. 이 문서는 공식 문서 설명에서 멈추지 않고 **구현 코드가 실제로 하는 일**(kubernetes master, v1.37.0-beta.0 이후 체크아웃 기준), **리포팅된 버그**, **케이스별 득실**까지 내려간다.

> 코드 인용은 `kubernetes/kubernetes` master(v1.37.0-beta.0+), 부스트 오퍼레이터는 `google/kube-startup-cpu-boost` v0.19.0 로컬 체크아웃 기준이다. 줄 번호는 그 시점 스냅샷이다.

## 1. 무엇이 생겼나 — 요청에서 cgroup까지의 파이프라인

사용법은 한 줄이다. 일반 `kubectl edit`/`apply`로 resources를 고치면 거부되고, 반드시 `resize` 서브리소스를 태워야 한다(kubectl 1.32+):

```bash
kubectl patch pod my-pod --subresource resize --patch \
  '{"spec":{"containers":[{"name":"app","resources":{"requests":{"cpu":"800m"},"limits":{"cpu":"800m"}}}]}}'
```

요청은 3단계를 거친다 — apiserver 검증 → kubelet 수락(allocation) → 커널 반영(actuation). spec은 PATCH가 통과한 순간 바뀌고, 실제 반영은 비동기다.

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

관찰 지점은 네 곳이다. 예전 자료에 나오는 `status.resize` 필드는 **deprecated**이고 컨디션 두 개로 대체됐다.

| 지점 | 의미 |
|---|---|
| `status.conditions[PodResizePending]` | 수락 대기. `reason: Deferred`(지금은 안 되지만 나중에 될 수 있음 — 재시도됨) / `reason: Infeasible`(이 노드에선 불가 — **재시도 안 됨**) |
| `status.conditions[PodResizeInProgress]` | 수락됐고 커널 반영 중. actuation 에러 시 `reason: Error`로 남고 매 sync마다 재시도 |
| `status.containerStatuses[].allocatedResources` | kubelet이 수락(checkpoint)한 requests |
| `status.containerStatuses[].resources` | 실행 중 컨테이너에 실제 반영된 값(CRI 리포트 기준) |

**"끝났다"의 판정**: 업스트림 e2e 프레임워크는 `status.observedGeneration >= metadata.generation` **이면서 위 두 컨디션이 모두 없을 때**를 완료로 본다(`test/e2e/common/node/framework/podresize/resize.go:365-401`). observedGeneration만 보면 안 된다 — `PodObservedGenerationTracking` 게이트가 꺼진 클러스터에선 0으로 남을 수 있다.

## 2. GA 기준 되는 것 / 안 되는 것

| 되는 것 | 안 되는 것 |
|---|---|
| cpu·memory requests/limits **값 변경** (증가·감소) | cpu·memory 외 리소스(GPU, ephemeral-storage 등) 변경 |
| 메모리 limit 감소 (1.34부터, best-effort) | **QoS class가 바뀌는 모든 변경** (4방향 전부 차단) |
| 사이드카(restartable init) 컨테이너 resize | requests/limits **항목 제거** (값 변경만 가능; 추가는 QoS 유지 시 허용) |
| 리소스 종류별 `resizePolicy` (cpu는 무중단, memory는 재시작 같은 조합) | `resizePolicy` 자체의 사후 변경 |
| Deferred resize의 우선순위 기반 재시도 | Windows 파드, static 파드, non-restartable init·ephemeral 컨테이너 |
| | 스왑 쓰는 컨테이너의 메모리 resize (memory `resizePolicy: RestartContainer`면 가능) |
| | static CPU/Memory Manager 노드의 Guaranteed 파드 |

"GA됐다"가 "관련 기능이 다 켜졌다"는 뜻이 아니라는 점이 중요하다. 본체만 GA고 파생 기능은 각자 게이트 뒤에 있다(v1.37 코드 `pkg/features/kube_features.go` 기준):

| Feature gate | 상태 | 내용 |
|---|---|---|
| `InPlacePodVerticalScaling` | **1.35 GA** (locked) | 본체 |
| `InPlacePodVerticalScalingInitContainers` | 1.37 GA | non-restartable init 컨테이너 resize |
| `InPlacePodLevelResourcesVerticalScaling` | 1.36 beta | pod-level resources의 resize (containerd 2.0+, cgroup v2 요구) |
| `InPlacePodVerticalScalingExclusiveCPUs` | 1.32 alpha | static CPU manager의 exclusive CPU resize |
| `InPlacePodVerticalScalingExclusiveMemory` | 1.34 alpha | static Memory manager 조합 |
| `InPlacePodVerticalScalingMemoryBackedVolumes` | 1.37 alpha | memory-backed emptyDir sizeLimit resize |
| `InPlacePodVerticalScalingSchedulerPreemption` | 1.37 alpha | Deferred resize를 위한 스케줄러 선점 |

런타임 전제: 컨테이너 레벨 resize의 CRI 호출(`UpdateContainerResources`)은 containerd 1.6.9+에서 지원된다. cgroup v1은 메모리 감소 동작이 v2와 다르고(§3), 스왑 재계산도 안 되므로 실질적으로 **cgroup v2 전제**로 보는 게 맞다.

## 3. 코드가 말해주는 실제 동작 — 문서에 없는 다섯 가지

### 3.1 Deferred/Infeasible의 실체: "명시적 Infeasible만 영구, 나머지는 전부 Deferred"

kubelet의 수락 판정(`canAdmitPod`)은 스케줄러의 노드 자원 필터를 kubelet 안에서 재사용한다. 비교식은 **"이미 checkpoint된 다른 파드들의 requests 합 vs `node.status.allocatable`"** 이다 — 실사용량이 아니다(`pkg/kubelet/allocation/allocation_manager.go:651-683`). 노드가 requests 기준으로 꽉 차 있으면 실제 CPU가 놀고 있어도 Deferred가 된다.

판정 결과의 분류가 재밌다. status manager는 `reason != Infeasible`이면 **무조건 Deferred로 정규화**한다(`status_manager.go:318-340`). 진짜 Infeasible은 정책 위반 케이스를 kubelet이 명시적으로 반환할 때뿐이다 — 스왑, static CPU/Memory Manager, feature gate off(`allocation/handlers.go`). 그리고:

- **Deferred**는 재시도 큐에 남는다. 재시도 트리거는 이벤트 4종(파드 추가/삭제/업데이트/실사용 감소 감지) + 주기 타이머(최초 30초, 이후 3분)다(`kubelet.go:2951-3264`, `allocation_manager.go:201-278`).
- **Infeasible은 큐에서 이탈한다**(`allocation_manager.go:259-260`). 공식 문서는 "재평가되지 않을 수 있다"고 모호하게 쓰지만, 코드상으론 spec을 다시 바꾸기 전까지 **절대 재평가되지 않는다**. Infeasible을 보면 기다리지 말고 요청을 고쳐야 한다.

Deferred가 여럿이면 4단계 정렬로 순서가 정해진다: ① 요청을 늘리지 않는 resize ② PriorityClass 높은 순 ③ Guaranteed 우선 ④ 오래 기다린 순(`allocation_manager.go:296-383`). 단 이 우선순위는 **pending resize들끼리의 얘기**고, 신규 파드 admission과는 우선순위 없이 mutex 선점 순서(FCFS)로 경쟁한다 — 리사이즈가 대기 중일 때 새 파드가 그 자원을 먼저 가져갈 수 있다.

### 3.2 반영 순서와 실패의 뒷모습

cgroup 반영(`doPodResizeAction`, `kuberuntime_manager.go:1024-1090`)은 "커지는 쪽 부모 먼저, 줄어드는 쪽 자식 먼저" 원칙으로 pod cgroup ↔ container cgroup 순서를 매기고, 같은 리소스를 여러 컨테이너가 바꾸면 **감소 컨테이너를 항상 증가 컨테이너보다 먼저** CRI에 보낸다. 어느 순간에도 계층 불변식을 깨지 않기 위해서다. 메모리 request는 아예 cgroup에 쓰이지 않는다(스케줄링·QoS 계산용).

메모리 limit **감소**는 커널에 쓰기 전에 kubelet이 현재 사용량을 조회해 `usage >= 새 limit`이면 시도 전체를 실패시킨다(`kuberuntime_manager.go:1151-1225`). 두 가지 함정:

- 이 usage는 cAdvisor 캐시 또는 CRI RPC 스냅샷이라 **체크와 반영 사이에 레이스**가 있다. 통과 후 사용량이 튀면 cgroup v2는 그대로 OOM-kill로 이어질 수 있다(cgroup v1은 커널이 쓰기 자체를 거부 — 비대칭). 이게 open 이슈 #135670의 본체다.
- 메모리 체크 실패는 **같은 시도에 묶인 CPU 변경까지 통째로** 실패시킨다. 다음 sync에서 재시도되긴 하지만, "CPU만이라도 먼저"는 없다.

CRI 호출이 중간에 실패하면 pod-sandbox 레벨은 명시적으로 롤백하지만 **컨테이너 레벨은 롤백 없이 그 자리에서 중단**한다(`kuberuntime_manager.go:1227-1276`). pod cgroup은 새 값, 일부 컨테이너는 옛 값인 불일치 상태가 다음 sync까지 남을 수 있고, `PodResizeInProgress`가 `reason: Error`로 이를 알려준다(백오프 없이 매 sync 재시도).

### 3.3 RestartContainer는 "크래시와 똑같은" 재시작이다

`resizePolicy: RestartContainer`로 유발된 재시작은 별도 취급이 없다. **restartCount가 +1 되고**(크래시와 구분 불가), **CrashLoopBackOff 백오프도 그대로 적용**된다(`kuberuntime_container.go:220-227`, `kuberuntime_manager.go:1818-1823`). 두 가지 운영 함정이 나온다: restartCount 기반 알람이 정상 resize에 오탐되고, 이미 백오프 상태인 컨테이너는 resize 반영이 백오프 타이머만큼 밀린다.

### 3.4 checkpoint가 깨지면 kubelet이 안 뜬다

수락된 값은 `/var/lib/kubelet/allocated_pods_state` 단일 JSON 파일(체크섬 포함)에 checkpoint되고, kubelet 재시작 시 이 파일이 신뢰 소스가 되어 파드 admission을 재검증한다. **체크섬 불일치면 kubelet은 로그가 아니라 panic으로 죽는다** — 노드를 drain하고 파일을 지운 뒤 재시작하라는 메시지를 남긴다(`allocation/state/state_checkpoint.go:53-55`). 노드 장애 시나리오에 이 파일이 등장인물로 추가된 셈이다.

### 3.5 static CPU manager에서는 "성공해도 아무 일도 안 일어나는" 경로가 있다

exclusive CPU를 쓰는 컨테이너의 cpuset은 **컨테이너 생성 시점에만 배정**되고 resize 경로에서는 재계산되지 않는다(`internal_container_lifecycle.go:41-53`). 게다가 exclusive CPU 컨테이너는 CFS quota가 -1(무제한)로 설정되므로(기본 동작), quota를 바꾸는 resize는 실질 제약(코어 수)에 아무 영향이 없다. admission에서 Infeasible로 막는 게 기본이고 우회 게이트(`…ExclusiveCPUs`)는 아직 alpha인 이유다. 관련해서 스케일다운 시 **바쁜 CPU를 회수해 affinity를 깨는** 성능 저하 리포트도 열려 있다(#131309).

## 4. 리포팅된 버그 — 무엇이 고쳐졌고 무엇이 열려 있나

beta(1.33) 이전의 stuck 버그들(항상 재시작 #122760, InProgress 고착 #123441 #125559 #126388, 상태 레이스 #125394)은 1.33~1.34에서 상태 모델 재설계(#128922)와 함께 닫혔다. **1.33 미만에서 이 기능을 켜고 쓰는 건 그 버그들을 그대로 밟는 일이다.** GA 이후 기준으로 열려 있는 것들:

| 이슈 | 상태 | 내용 | 운영 시사점 |
|---|---|---|---|
| [#135670](https://github.com/kubernetes/kubernetes/issues/135670) | open (2025-12) | 메모리 감소 usage 체크의 TOCTOU 레이스 — 런타임 쪽으로 체크를 옮기는 새 설계 논의 중 | 메모리 축소 자동화는 보수적으로 |
| [#126891](https://github.com/kubernetes/kubernetes/issues/126891) | open (2024-08) | 스케줄링 도중 resize하면 스케줄러가 옛 값으로 배치 → kubelet이 OutOfCPU/OutOfMemory로 거부 가능 | 생성 직후 파드의 resize는 Running 확인 후에 |
| [#131309](https://github.com/kubernetes/kubernetes/issues/131309) | open (2025-04) | static CPU manager에서 스케일다운 시 busy CPU를 회수해 affinity 파괴 | latency-sensitive 노드에서 쓰지 말 것 |
| [#132851](https://github.com/kubernetes/kubernetes/issues/132851) | open (2025-07) | resize 취소(revert) 시 `PodResizeInProgress` 컨디션 레이스 | 컨디션 기반 자동화에 유의 |
| [#133538](https://github.com/kubernetes/kubernetes/issues/133538) | open (2025-08) | allocated resources 기록 실패 시 복구 경로 없음 (TODO 조사 중) | — |
| [#130111](https://github.com/kubernetes/kubernetes/issues/130111) | open (2025-02) | 메모리 request resize 시 swap limit(`memory.swap.max`) 재계산 미구현 | 스왑 노드에서 memory resize 금지 이유 |
| [autoscaler#8609](https://github.com/kubernetes/autoscaler/issues/8609) | open | VPA `InPlaceOrRecreate`가 in-place도 evict도 안 하고 무한 대기 | VPA in-place는 아직 관찰 필요 |
| [autoscaler#8288](https://github.com/kubernetes/autoscaler/issues/8288) | open | 클러스터가 resize 미지원이어도 VPA가 사용자에게 알리지 않음 | 도입 전 게이트/버전 수동 확인 |

버그는 아니지만 알아둘 것: resize 관련 kubelet 메트릭 7종(`pod_resize_duration_milliseconds`, `pod_pending_resizes`, `pod_infeasible_resizes_total`, `pod_deferred_resize_duration_seconds` 등)은 기능이 GA인데도 전부 **ALPHA 안정성**이라 이름·라벨이 바뀔 수 있다.

## 5. 케이스별 득실 — 어디에 좋고 어디에 나쁜가

| 케이스 | 판정 | 한 줄 근거 |
|---|---|---|
| ① 기동 부스트 (JVM cold start) | **좋음** | 스케줄링은 큰 값으로, 기동 후 축소는 무중단 — 전용 오퍼레이터 존재 |
| ② 재시작 비싼 stateful (DB·캐시·롱커넥션) | **최적** | 이 기능의 존재 이유. 단 메모리 축소만 보수적으로 |
| ③ JVM/Node 힙 메모리 | **반쪽** | 힙은 시작 시 고정 — 메모리는 결국 재시작, CPU만 in-place |
| ④ VPA 자동화 | **시기상조** | InPlaceOrRecreate가 alpha + 무한 대기 버그, 메모리 축소는 결국 eviction |
| ⑤ latency-sensitive + static CPU manager | **부적합** | admission에서 Infeasible, 우회 게이트 alpha, affinity 파괴 리포트 |
| ⑥ 장기 배치·ML | **좋음** | 재시작=진행 손실인 워크로드에 유효. Deferred 대기는 감수 |

### ① 기동 부스트 — kube-startup-cpu-boost가 실제로 하는 일

JVM처럼 기동 시 CPU를 많이 먹는 워크로드에 "시작할 때 크게, 뜨고 나면 작게"를 자동화하는 패턴이다. Google의 [kube-startup-cpu-boost](https://github.com/google/kube-startup-cpu-boost)(v0.19.0 코드 기준)는:

- **적용**: mutating webhook이 파드 **CREATE 시점**에 CPU requests/limits를 올린다(percentage는 항상 올림, 기본 설정은 Burstable/BestEffort의 CPU limit을 아예 제거). 큰 값으로 스케줄링되므로 자리는 보장된다.
- **회수**: Fixed duration(5초 폴링) 또는 PodCondition(예: `Ready=True`, 이벤트 기반) 정책이 만료되면 **`pods/{name}/resize` 서브리소스를 PATCH**해 원래 값으로 되돌린다(K8s 1.32+; 그 미만은 레거시 `client.Update` 경로). 회수는 감소 방향이라 노드 용량 때문에 실패할 일은 없다.
- **가드**: 부스트로 QoS class가 바뀌게 되는 컨테이너는 건너뛰고, CPU `resizePolicy: RestartContainer`인 컨테이너도 건너뛴다(부스트 회수가 재시작을 유발하면 본말전도라서).

**함정도 코드에 있다.** PodCondition 기반 회수는 컨디션 변경 이벤트에서만 재진입하므로 그 시점 PATCH가 실패하면 재시도 기회가 없을 수 있다(Fixed는 5초 틱마다 무한 재시도 — 비대칭). LimitRange/ResourceQuota는 전혀 확인하지 않아 admission 단계 거부와 충돌할 수 있고, HPA/VPA 상호작용 처리도 없다. 그리고 README가 직접 경고하는 것 — JVM은 부스트된 CPU 수 기준으로 스레드풀을 만들고, **회수 후에도 그 스레드풀은 줄지 않는다.** 부스트로 노드가 증설됐다가 회수 후 컨솔리데이션 → 재스케줄 → 재부스트로 이어지는 Cluster Autoscaler 진동 루프도 조심해야 한다.

### ② 재시작이 비싼 stateful — 이 기능의 본진

수 GB 버퍼 풀을 데운 DB, 수만 개 커넥션을 문 게이트웨이, 웜업에 수십 분 걸리는 캐시. 지금까지 이런 워크로드의 리소스 조정은 "재시작의 비용 > 리소스 낭비 비용"이라 방치가 합리적이었다. in-place resize는 그 트레이드오프 자체를 없앤다 — **늘리는 방향은 사실상 리스크가 없다**(수락만 되면 무중단, 실패해도 원상태 유지).

줄이는 방향만 조심하면 된다: CPU 감소는 안전(스로틀만 변함), **메모리 limit 감소는 §3.2의 TOCTOU 레이스**를 안고 간다. 메모리를 줄일 땐 현재 사용량과 충분한 마진을 두고, 가급적 사용량이 안정된 시간대에 하는 게 맞다. 그리고 Deferred에 걸릴 수 있으니(§3.1 — requests 기준 판정) 노드에 headroom이 없는 클러스터에선 "무중단 조정"이 "무한 대기"가 될 수 있다는 것도 계산에 넣어야 한다.

### ③ JVM/Node 힙 — 커널은 바뀌어도 런타임은 모른다

cgroup limit을 늘려도 이미 뜬 JVM은 힙을 재매핑하지 않는다(-Xmx, `MaxRAMPercentage` 모두 시작 시점 값). Node.js의 V8 old space도 같다. 그래서 KEP 자체가 JVM을 `RestartContainer`가 필요한 대표 예로 든다 — 즉 **메모리에 관한 한 in-place의 이점이 사라진다**(게다가 §3.3의 restartCount·백오프 함정까지 따라온다).

현실적인 전략은 하이브리드다: `resizePolicy`를 리소스별로 갈라 **cpu는 `NotRequired`, memory는 `RestartContainer`** 로 두고, CPU는 자유롭게 조정하되 메모리 변경은 "재시작을 각오한 이벤트"로 취급한다. 대조적으로 **Go 1.25+는 cgroup CPU limit 변경을 약 30초 주기로 감지해 GOMAXPROCS를 스스로 갱신**한다(명시적으로 GOMAXPROCS를 설정하지 않은 경우, Linux 한정) — resize와 궁합이 가장 좋은 런타임이다. GOMAXPROCS와 CPU limit의 관계는 [istio 09 §8]({{< relref "../istio/09-istiod-scaling-connections.md" >}})에서 다룬 그 주제다.

### ④ VPA 자동화 — 방향은 맞고 시기가 이르다

VPA의 `InPlaceOrRecreate` 모드(VPA 1.4.0+, **alpha**)가 이 기능의 최종 소비자다. 설계를 보면: 평상시엔 in-place를 시도하고, Infeasible이거나 Deferred 5분/InProgress 1시간 타임아웃이면 기존 방식(evict)으로 fallback한다. 단 **메모리 축소는 사실상 항상 eviction으로 넘어가고**, in-place를 시도하는 조건 자체가 제한적이다(Quick OOM, 권장 범위 이탈, 12시간+ 파드의 10%+ 드리프트). "VPA가 있으니 이제 무중단 rightsizing"이라는 기대와는 거리가 있다.

여기에 현재 열린 버그가 얹힌다: in-place도 evict도 안 하고 무한 대기(#8609), 클러스터 비호환을 알려주지 않음(#8288). 지금 시점의 합리적 선택은 **VPA는 `Off`(추천값만) 모드로 두고 resize는 사람/파이프라인이 실행**하는 반자동, 그리고 InPlaceOrRecreate는 스테이징에서 관찰하는 것이다. HPA와 CPU/메모리 기준 VPA를 같이 쓰지 말라는 원칙은 in-place 시대에도 그대로다.

### ⑤ static CPU manager 노드 — 사실상 미지원

Guaranteed + 정수 CPU + static policy 조합은 admission에서 Infeasible로 거부된다. 우회 게이트는 1.32부터 alpha에 머물러 있고, §3.5에서 본 것처럼 actuation 경로에 cpuset 재계산 자체가 없다. NUMA 고정·저지연 워크로드는 이 기능의 대상이 아니라고 보는 게 맞다.

### ⑥ 장기 배치·ML — 재시작이 곧 손실인 곳

체크포인트 없는 학습 잡, 며칠짜리 배치에게 "메모리 부족 → 재시작해서 큰 값으로"는 진행 전체의 손실이다. in-place 증가는 이 문제를 정확히 푼다. 유의점 둘: 노드가 붐비면 Deferred로 기다리게 되는데 이때 스케줄러는 **desired/allocated/actual 중 최댓값**으로 그 노드를 계산하므로 pending resize가 노드의 스케줄 가능 공간을 선점한다. 그리고 batch 우선순위가 낮으면 Deferred 정렬(§3.1)에서도 뒤로 밀린다 — 급한 증설이 필요한 잡에는 PriorityClass를 챙겨줄 것.

## 6. 도입 체크리스트

- [ ] **버전/런타임**: K8s 1.35+(그 미만 beta는 닫힌 버그 목록 확인), containerd 1.6.9+, cgroup v2, 스왑 비활성 노드
- [ ] **늘리기부터**: 증가 방향으로 시작하고, 메모리 축소 자동화는 #135670이 닫히기 전까지 보수적으로
- [ ] **완료 판정 로직**: `observedGeneration ≥ generation` + Pending/InProgress 컨디션 부재. Infeasible은 재시도되지 않으니 알람 대상
- [ ] **restartCount 알람**: `RestartContainer` 정책을 쓴다면 resize로 인한 재시작 오탐을 걸러낼 것
- [ ] **headroom**: Deferred 판정은 requests 합 기준이다 — 노드 여유 없이는 "무중단"이 "무한 대기"가 된다
- [ ] **언어 런타임 궁합**: Go 1.25+ ◎ / JVM·Node 메모리는 RestartContainer 전제로 설계

## 참고 자료

- [KEP-1287: In-Place Update of Pod Resources](https://github.com/kubernetes/enhancements/blob/master/keps/sig-node/1287-in-place-update-pod-resources/README.md) — 설계·제약의 1차 소스
- [Kubernetes v1.35: In-Place Pod Resize Graduates to Stable](https://kubernetes.io/blog/2025/12/19/kubernetes-v1-35-in-place-pod-resize-ga) · [v1.33 beta 발표](https://kubernetes.io/blog/2025/05/16/kubernetes-v1-33-in-place-pod-resize-beta/)
- [Resize CPU and Memory Resources assigned to Containers](https://kubernetes.io/docs/tasks/configure-pod-container/resize-container-resources/) — 공식 task 문서 (QoS 규칙·제약 목록)
- [VPA In-Place Updates Support (AEP-4016)](https://github.com/kubernetes/autoscaler/blob/master/vertical-pod-autoscaler/enhancements/4016-in-place-updates-support/README.md)
- [google/kube-startup-cpu-boost](https://github.com/google/kube-startup-cpu-boost) · [Go: Container-aware GOMAXPROCS](https://go.dev/blog/container-aware-gomaxprocs)
- 코드: `kubernetes/kubernetes` master 체크아웃 — `pkg/kubelet/allocation/`(수락 판정·checkpoint), `pkg/kubelet/kuberuntime/kuberuntime_manager.go`(반영 순서·실패 처리), `pkg/apis/core/validation/validation.go`(ValidatePodResize), `pkg/kubelet/status/status_manager.go`(컨디션)
- 이슈: [#135670](https://github.com/kubernetes/kubernetes/issues/135670) · [#126891](https://github.com/kubernetes/kubernetes/issues/126891) · [#131309](https://github.com/kubernetes/kubernetes/issues/131309) · [#132851](https://github.com/kubernetes/kubernetes/issues/132851) · [#133538](https://github.com/kubernetes/kubernetes/issues/133538) · [#130111](https://github.com/kubernetes/kubernetes/issues/130111) · [autoscaler#8609](https://github.com/kubernetes/autoscaler/issues/8609) · [autoscaler#8288](https://github.com/kubernetes/autoscaler/issues/8288)
