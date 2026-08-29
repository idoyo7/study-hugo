---
title: "DaemonSet 미기동 노드 격리"
date: 2026-08-01
lastmod: 2026-08-24
weight: 5
---

# 05 · DaemonSet 미기동 노드 격리 — 탐지와 격리 의미론

{{< callout type="info" >}}
- DaemonSet 파드를 노드에 바인딩하는 주체는 1.12+에서 **기본 스케줄러**입니다. DS 컨트롤러는 대상 노드를 가리키는 nodeAffinity를 파드에 심는 데까지만 관여합니다. 그래서 DS 파드도 taint·리소스·이미지 같은 일반 스케줄링 실패 모드를 그대로 겪습니다.
- **cordon은 DS 파드를 막지 못합니다.** DS 컨트롤러가 `node.kubernetes.io/unschedulable:NoSchedule` 톨러레이션을 자동으로 붙이기 때문입니다. 격리 관점에서는 이 동작이 오히려 맞습니다 — 워크로드 유입만 끊고, 정작 고쳐야 할 DS는 계속 재시도합니다.
- 노드별 갭은 `kube_daemonset_status_*` 로는 안 보입니다. 이 메트릭들의 라벨은 `daemonset`·`namespace` 뿐이라 "몇 개 부족"까지만 알려줍니다. "어느 노드가 빠졌는지"는 `kube_pod_info` 를 `node` 라벨로 조인해야 나옵니다.
- 빠른 격리 전략은 성질이 서로 다릅니다. **선제**(startup taint로 준비 전까지 기본 격리)는 탐지 시간 자체를 없앱니다. **반응**(탐지 → taint → drain)은 탐지 지연이 곧 장애 시간이 됩니다. 선제를 기본으로 깔고 반응을 백스톱으로 둡니다.
{{< /callout >}}

자매 문서: [04 Node Problem Detector]({{< relref "04-node-problem-detector.md" >}}) — 탐지 계층의 선택지 · [Karpenter]({{< relref "../../karpenter/_index.md" >}}) — 노드 단위 조치와 중단 예산

## 1. 문제 — 인프라가 없는 노드에 워크로드가 내려앉는다

kube-scheduler는 워크로드를 배치할 때 taint·affinity·리소스를 봅니다. 그 노드의 DaemonSet이 준비됐는지는 스케줄링의 선행 조건이 아닙니다. Taints and Tolerations 문서가 "The scheduler checks taints, not node conditions, when it makes scheduling decisions."라고 명시하듯 스케줄러의 입력은 컨디션조차 직접 보지 않습니다(스케줄러가 DS 준비 상태를 입력으로 쓰지 않는다는 **명시적 문장**은 공식 문서에서 찾지 못했으므로 여기서는 "선행 조건으로 보장되지 않는다"까지만 확정으로 둡니다).

CNI·로그 에이전트·메시 데이터플레인처럼 **node-local 인프라**가 빠진 노드에도 워크로드는 계속 스케줄됩니다. 파드는 `Running`이고 readiness도 통과합니다. 에러 없이 빠지는 것은 네트워크·관측·정책입니다.

실전 사례는 [ambient 03-2 Partially Enrolled Pod와 Untaint Controller]({{< relref "../../istio/ambient/03-2-partially-enrolled-untaint-controller.md" >}})가 다룹니다. 이 문서는 그 사례를 일반화해서 원인 분류·탐지·격리 의미론·자동화를 노드 관점으로 정리합니다.

## 2. 원인 분류 — DS 파드가 그 노드에 없는 이유

| 원인 | 관측되는 상태 |
|---|---|
| **taint 미톨러레이션** | 파드가 그 노드에 아예 생성되지 않음 |
| **리소스 부족** | 파드 `Pending`, `FailedScheduling` 이벤트 |
| **이미지 풀 실패** | `ErrImagePull` / `ImagePullBackOff`, 오타난 태그 |
| **rollingUpdate 정체** | desired와 updated 수가 벌어진 채 멈춤 |
| **노드·kubelet 문제** | 바인딩됐지만 컨테이너가 시작 안 됨 |

원인별 확인 명령은 다음과 같습니다.

```bash
# taint 미톨러레이션
kubectl get node <NODE> -o jsonpath='{.spec.taints}'
# 리소스 부족
kubectl -n <NS> get pod -l <SEL> --field-selector spec.nodeName=<NODE>
# 이미지 풀 실패
kubectl -n <NS> describe pod <POD> | tail -20
# rollingUpdate 정체
kubectl -n <NS> rollout status ds/<NAME> --timeout=30s
# 노드·kubelet 문제
kubectl describe node <NODE> | sed -n '/Conditions/,/Addresses/p'
```

rollingUpdate 기본값은 `maxUnavailable: 1`, `maxSurge: 0`, `minReadySeconds: 0` 입니다. `maxSurge: 0` 에서는 "At most one pod of the DaemonSet will be running on each node during the whole update process." — 옛 파드를 죽인 뒤에야 새 파드가 뜹니다. 새 템플릿이 깨져 있으면 그 노드는 **DS가 아예 없는 상태**로 남습니다. 롤아웃 정지가 곧 노드 갭이 되는 경로입니다.

우선순위도 변수입니다. DS 파드에 높은 `priorityClassName`을 주면 리소스가 모자란 노드에서 기존 파드를 선점(preempt)하고 들어갑니다. 노드-로컬 인프라 DS라면 이쪽이 기본값이어야 합니다.

## 3. 격리 의미론 — cordon · NoSchedule · NoExecute

무엇을 고를지 정하기 전에 각 조치가 실제로 무엇을 하는지 붙여 놓고 봅니다.

| 조치 | 실제로 하는 일 | 기존 파드 | 신규 스케줄 | DS 파드 |
|---|---|---|---|---|
| **cordon** | `.spec.unschedulable=true` → `node.kubernetes.io/unschedulable:NoSchedule` | 유지 | 차단 | **차단되지 않음** |
| **커스텀 NoSchedule** | `kubectl taint node <NODE> k=v:NoSchedule` | 유지 | 차단 | 톨러레이션 없으면 차단 |
| **커스텀 NoExecute** | `kubectl taint node <NODE> k=v:NoExecute` | 즉시 축출 | 차단 | 톨러레이션 없으면 축출 |
| **drain** | cordon 후 Eviction API를 파드마다 제출 | PDB를 지키며 축출 | 차단 | `--ignore-daemonsets` 여부로 결정 |

NoExecute의 의미론은 파드가 taint를 톨러레이트하는 방식에 따라 달라집니다. "Pods that do not tolerate the taint are evicted immediately" · "Pods that tolerate the taint without specifying `tolerationSeconds` … remain bound forever" · `tolerationSeconds` 를 지정한 파드는 그 시간이 지나면 node lifecycle controller가 축출합니다. 여기에 기본값이 하나 더 있습니다 — 쿠버네티스는 모든 파드에 `not-ready`·`unreachable` 용 `tolerationSeconds: 300` 기본 톨러레이션을 자동으로 넣습니다. 노드가 죽어도 5분은 버틴다는 뜻입니다. 격리를 서두르고 싶다면 이 5분이 그대로 지연으로 잡힙니다.

drain은 "safely evicts all pods from a node before you perform maintenance"이며 "Safe evictions allow the pod's containers to gracefully terminate and will respect the PodDisruptionBudgets you have specified." 거부된 eviction은 타임아웃까지 재시도됩니다. drain에는 즉시성이 없습니다. 급한 격리에는 taint가 먼저고 drain은 그다음입니다.

### cordon이 DS를 못 막는 것은 버그가 아니다

> "Because the DaemonSet controller sets the `node.kubernetes.io/unschedulable:NoSchedule` toleration automatically, Kubernetes can run DaemonSet Pods on nodes that are marked as unschedulable."
>
> "If you use a DaemonSet to provide an important node-level function, such as cluster networking, it is helpful that Kubernetes places DaemonSet Pods on nodes before they are ready."

DS가 없어서 격리하는 상황에서 이 동작은 원하는 그대로입니다. cordon 한 줄로 **워크로드 유입은 끊고, 고쳐야 할 DS는 계속 시도하게** 둡니다. 노드를 살려서 복구할 생각이라면 cordon이 1차 조치로 맞습니다.

DS 컨트롤러가 자동으로 붙이는 톨러레이션은 다음 7개뿐입니다.

| taint 키 | effect | 부여 조건 |
|---|---|---|
| `node.kubernetes.io/not-ready` | NoExecute | 항상 (`tolerationSeconds` 없음) |
| `node.kubernetes.io/unreachable` | NoExecute | 항상 (`tolerationSeconds` 없음) |
| `node.kubernetes.io/disk-pressure` | NoSchedule | 항상 |
| `node.kubernetes.io/memory-pressure` | NoSchedule | 항상 |
| `node.kubernetes.io/pid-pressure` | NoSchedule | 1.14+ |
| `node.kubernetes.io/unschedulable` | NoSchedule | 1.10+ |
| `node.kubernetes.io/network-unavailable` | NoSchedule | `spec.hostNetwork: true` 인 DS 파드에만 |

`not-ready`·`unreachable` 에 `tolerationSeconds` 가 없는 이유도 문서가 밝힙니다 — "This ensures that DaemonSet pods are never evicted due to these problems."

**이 목록 밖의 임의 키는 자동으로 커버되지 않습니다.** 커스텀 NoSchedule taint를 붙이면 DS 파드도 함께 막힙니다("if there is at least one un-ignored taint with effect NoSchedule then Kubernetes will not schedule the pod onto that node"). 무엇을 막을지에 따라 선택이 달라집니다.

- 워크로드만 막고 DS는 통과시키고 싶다 → **cordon**(built-in `unschedulable` 키)을 씁니다.
- 커스텀 taint를 쓰겠다 → 통과시켜야 할 인프라 DS의 Pod template에 **그 taint의 톨러레이션을 직접 넣어야** 합니다. 4.1절의 startup taint 패턴이 이 구조입니다.

## 4. 빠른 격리의 두 전략

선제와 반응은 성질이 다릅니다. 선제는 갭이 열리는 것 자체를 막아 탐지 시간을 없애고, 반응은 탐지 지연이 그대로 장애 시간으로 환산됩니다. 순서는 여기서 정해집니다 — 선제를 기본으로 깔고 반응을 백스톱으로 둡니다.

{{< flow src="_flow/5-빠른-격리의-두-전략.json" />}}

### 4.1 선제 — startup taint

전제를 뒤집는 전략입니다. 노드는 **준비를 증명하기 전까지 격리 상태**가 기본입니다. 인프라가 스스로 taint를 떼면서 준비를 증명합니다. 갭이 열리지 않으므로 탐지할 것이 없습니다 — 4.2절의 탐지는 이 전략이 깔린 뒤에는 회귀 감시용으로 역할이 바뀝니다.

**Karpenter `startupTaints`.** 정의부터 보겠습니다. "Provisioned nodes will have these taints, but pods do not need to tolerate these taints to be considered for provisioning by this NodePool. These taints are expected to be temporary and some other entity (e.g. a DaemonSet) is responsible for removing the taint after it has finished initializing the node." 스케줄링 시뮬레이션은 이 taint를 무시하고 실제 노드에는 붙는다는 뜻입니다. 여기에 의도된 동작이 하나 더 붙습니다 — **한 번 제거된 startup taint를 Karpenter가 다시 붙이지 않는 것**입니다. 이 문장은 karpenter.sh 문서 페이지에 없습니다. kubernetes-sigs/karpenter issue #1772의 Expected Behavior 서술("Karpenter updates the existing taints on a node to remove `karpenter.sh/unregistered=NoExecute` without restoring startup taints removed by other controllers.")로만 확인됩니다. 같은 이슈는 EFS CSI가 떼어낸 startup taint를 Karpenter가 `karpenter.sh/unregistered` 제거 시점에 복원해버린 레이스를 **버그로** 보고합니다. 등록 taint와 startup taint가 겹치는 구간은 여전히 확인 대상입니다.

**Cilium.** 기본 키는 `node.cilium.io/agent-not-ready` 이고 `--agent-not-ready-taint-key` 로 바꿉니다. effect를 무엇으로 두느냐가 동작을 정합니다. "If `NoSchedule` is used, pods won't be scheduled to a node until Cilium has the chance to remove the taint." / "If `NoExecute` is used, pods won't be executed (nor scheduled) on a node until Cilium has had the chance to remove the taint." 공식 권장은 NoExecute이며 이유는 재부착 시나리오입니다 — "whenever the taint is added back to the node by some external process (such as during an upgrade or eventually a routine operation), pods will be evicted from the node until Cilium has had the chance to remove the taint. This is why `NoExecute` is recommended, as assuming the taint is added back in this scenario, already-scheduled pods won't run."

**Istio ambient.** `cni.istio.io/not-ready` 를 인프라가 붙이고 istiod 안의 untaint controller가 istio-cni 노드 에이전트 준비 후 제거합니다. **컨트롤러는 taint를 붙이지 않습니다** — 부착 주체는 별도입니다. Istio 1.30부터는 "The `PILOT_ENABLE_NODE_UNTAINT_CONTROLLERS` environment variable is now automatically configured when `taint.enabled` is set in the Helm chart for the istiod deployment."라 헬름 값 하나로 끝납니다. 그 이전 버전은 두 개를 각각 켜야 했습니다. 사례의 전말은 [ambient 03-2]({{< relref "../../istio/ambient/03-2-partially-enrolled-untaint-controller.md" >}})에 있습니다.

세 사례의 공통 구조는 **부착 주체와 제거 주체의 분리**입니다. 제거 주체(DS·컨트롤러)만 있고 부착 주체(프로비저너·부트스트랩)가 없으면 패턴 자체가 성립하지 않습니다. 3절에서 본 대로 제거를 맡은 DS 자신은 그 taint를 톨러레이트해야 스케줄됩니다.

### 4.2 반응 — 탐지에서 축출까지

반응 전략은 노드별 갭을 찾는 데서 시작합니다.

#### 노드별로 봐야 보인다 — kubectl 원라이너

노드 목록에서 DS 파드가 있는 노드를 빼면 갭이 남습니다.

```bash
comm -23 \
  <(kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | sort) \
  <(kubectl -n kube-system get pod -l k8s-app=cilium \
      -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}' | sort)
```

"떠 있다"와 "Ready다"는 다르므로 상태까지 같이 봅니다.

```bash
kubectl -n kube-system get pod -l k8s-app=cilium -o custom-columns=\
NODE:.spec.nodeName,PHASE:.status.phase,READY:'.status.conditions[?(@.type=="Ready")].status'
```

nodeSelector·톨러레이션으로 대상 노드가 한정된 DS라면 위 차집합에 정상 제외 노드가 섞입니다. 대상 집합을 먼저 `kubectl get nodes -l <DS의 nodeSelector>` 로 좁힌 뒤 빼야 합니다.

#### kube-state-metrics 조인 PromQL

집계 메트릭만으로는 안 됩니다. `kube_daemonset_status_current_number_scheduled` · `_desired_number_scheduled` · `_number_available` · `_number_ready` · `_number_unavailable` · `_number_misscheduled` · `_updated_number_scheduled` 는 **라벨이 `daemonset`·`namespace` 뿐**입니다. "2개 모자라다"는 알려주지만 "어느 노드냐"는 알려주지 않습니다. 그래서 알림은 울리는데 대상 노드를 찾으려면 다시 kubectl을 써야 합니다.

노드 라벨이 붙은 메트릭은 `kube_pod_info` 입니다. 라벨에 `node`·`created_by_kind`·`created_by_name` 이 있으므로 노드 집합에서 빼면 됩니다.

```promql
count by (node) (kube_node_info)
  unless on (node)
count by (node) (
  kube_pod_info{created_by_kind="DaemonSet", created_by_name=~"cilium|fluent-bit|ztunnel"}
)
```

결과에 남는 `node` 라벨이 곧 갭입니다. DS별로 나눠 보려면 `created_by_name` 을 하나씩 고정해 규칙을 복제합니다.

#### 끊어진 고리 — 컨디션을 taint로 바꿀 주체

알림만으로는 조치 자동화가 붙지 않습니다. [04]({{< relref "04-node-problem-detector.md" >}})의 NPD `CustomPluginMonitor` 를 쓰면 노드 로컬에서 점검 스크립트를 돌리고 종료 코드를 NodeCondition으로 올릴 수 있습니다 — 예를 들어 CNI 소켓 존재 여부나 에이전트 헬스 엔드포인트를 확인하는 스크립트입니다.

**함정이 하나 있습니다.** `TaintNodesByCondition` 이 자동으로 taint를 만드는 대상은 node controller가 관리하는 built-in 컨디션(`Ready` → `not-ready`/`unreachable`, `MemoryPressure`, `DiskPressure`, `PIDPressure`, `NetworkUnavailable`, `unschedulable`, 그리고 외부 클라우드 프로바이더용 `node.cloudprovider.kubernetes.io/uninitialized`)뿐입니다. NPD가 만든 커스텀 컨디션은 아무리 정상적으로 노드에 반영돼도 taint가 생기지 않습니다(kubernetes/node-problem-detector issue #640이 `KernelDeadlock` 으로 이를 실증했고, issue #736이 같은 이유로 커스텀 컨디션 기반 taint 기능을 요청하고 있습니다).

**컨디션 → taint 변환 주체를 직접 두어야** 체인이 이어집니다. NPD 저장소에는 NPD 자체 설정(`taintEnabled`/`taintKey`/`taintValue`/`taintEffect`)으로 taint를 붙이는 로직을 구현하려는 이력(PR #565)이 있습니다. 그 밖에는 별도 컨트롤러나 아래의 반응형 도구가 그 역할을 맡습니다.

#### 반응형 도구 다섯

- Draino (planetlabs) · 트리거: NodeCondition · 조치: cordon + drain — 마지막 릴리스 2018-12-28, 마지막 커밋 2020-12-14. `archived=false`이지만 사실상 정지, 신규 채택 제외.
- Descheduler `RemovePodsViolatingNodeTaints` · 트리거: 이미 붙어 있는 NoSchedule taint · 조치: 위반 파드 축출(**taint를 붙이지는 않습니다**) — kubernetes-sigs 산하, 활성.
- medik8s NHC + SNR · 트리거: 노드 조건 감시 · 조치: 비정상 노드에 SelfNodeRemediation CR 생성 → 재부팅, 다른 노드들이 cordon — 활성. Red Hat Workload Availability로 패키징.
- Karpenter Node Repair · 트리거: `Ready` False/Unknown 30분, `AcceleratedHardwareReady` 10분, `Storage`/`Networking`/`Kernel`/`ContainerRuntimeReady` 각 30분 · 조치: NodeClaim과 노드를 강제 종료(drain·grace 우회) — v1.1.0+ **alpha**. `NodeRepair` feature gate 필요.
- EKS node auto repair · 트리거: `eks-node-monitoring-agent`가 세우는 컨디션 · 조치: `Replace` / `Reboot` — EKS Auto Mode에서 기본 활성, 관리형 노드 그룹·Karpenter와 함께 사용 가능.

Descheduler는 taint를 붙이지 않습니다. 체인은 `컨디션 → (누군가 taint 부착) → RemovePodsViolatingNodeTaints 축출` 이고 가운데 고리가 바로 앞에서 본 빈자리입니다. `includedTaints`/`excludedTaints` 로 대상 taint를 좁히고 `includePreferNoSchedule: false` 로 NoSchedule만 검사하도록 설정합니다.

Karpenter Node Repair의 조치는 강합니다 — "Karpenter will forcefully terminate the node and its corresponding NodeClaim, bypassing the standard drain and grace period procedures." 안전장치는 비율 제한입니다. NodePool 내 노드의 20%를 넘게 비정상이면 리페어를 중단합니다(EKS 관리형 노드 그룹은 노드 5개 초과 + 20% 초과 또는 ARC 존 시프트 시 중단).

위 다섯의 트리거는 **전부 built-in 또는 에이전트 컨디션**입니다. "이 노드에 CNI DS가 없다"는 커스텀 신호는 여기 자동으로 들어오지 않습니다. 반응 전략을 쓰려면 앞에서 본 컨디션화와 taint 부착 고리를 반드시 직접 만들어야 합니다.

## 5. 권장 조합

**EKS + Karpenter.** 선제를 기본으로 깝니다. NodePool `spec.template.spec.startupTaints` 에 node-local 인프라마다 키를 하나씩 두고(CNI, 로그 에이전트, 메시 CNI), 제거는 각 DS 또는 전용 컨트롤러가 맡습니다. effect는 Cilium 권장을 따라 NoExecute를 기본으로 검토합니다 — 운영 중 taint가 재부착되는 시나리오에서 이미 스케줄된 파드까지 막아줍니다. 한 번 제거된 startup taint는 Karpenter가 복원하지 않는다는 의미론(issue #1772) 위에서 설계합니다. 등록 taint(`karpenter.sh/unregistered`) 제거 시점의 복원 레이스는 알려진 버그이므로 자체 클러스터에서 재현 여부를 확인합니다. 반응 축은 `eks-node-monitoring-agent` + node auto repair로 코어·커널·스토리지·네트워킹 컨디션을 관리형에 맡깁니다. Karpenter Node Repair는 alpha이고 조치가 강제 종료입니다. feature gate를 켜기 전에 20% 임계값과 강제 종료 의미론을 먼저 합의합니다.

**자체 클러스터.** startup taint를 붙일 주체부터 정해야 합니다. Karpenter가 없으면 노드 등록 시점에 taint를 붙이는 경로를 프로비저닝 도구(부트스트랩 스크립트·이미지·설치 자동화) 쪽에 마련해야 합니다. 이 부착 주체가 없으면 선제 전략은 성립하지 않습니다. 반응 축은 [04]({{< relref "04-node-problem-detector.md" >}})의 NPD `CustomPluginMonitor` 로 DS 갭을 컨디션화하고 조치는 medik8s NHC + SelfNodeRemediation으로 잇습니다. Draino는 마지막 커밋이 2020-12-14라 신규 채택 대상이 아닙니다. Descheduler는 taint가 이미 붙은 뒤의 축출 단계에만 씁니다.

## 6. 체크리스트

- node-local 인프라 DS를 먼저 나열합니다. CNI, 로그·메트릭 에이전트, 메시 데이터플레인, CSI 노드 플러그인 중 **없으면 워크로드가 알림 없이 깨지는 것**만 골라냅니다. 이 목록이 startup taint 키의 목록이 됩니다.
- 그 DS들의 Pod template에 자기 startup taint의 톨러레이션과 높은 `priorityClassName` 이 있는지 확인합니다. 둘 중 하나만 빠져도 자기 자신이 못 뜹니다.
- startup taint의 **부착 주체**를 명시합니다. Karpenter `startupTaints`, 부트스트랩, 설치 자동화 중 무엇인지 문서에 적습니다. 제거 주체만 있고 부착 주체가 없는 구성이 가장 흔한 실패입니다.
- 노드별 갭 알림을 `kube_pod_info` 조인 기준으로 만듭니다. `kube_daemonset_status_number_ready` 기반 알림은 대상 노드를 알려주지 않습니다.
- 컨디션 → taint 변환 주체를 정합니다. `TaintNodesByCondition` 은 built-in 컨디션만 처리하므로 NPD 커스텀 컨디션은 taint로 자동 변환되지 않습니다.
- 격리 조치의 순서를 정해둡니다. cordon(DS는 계속 시도) → 커스텀 NoSchedule(DS까지 차단) → drain → 교체. `tolerationSeconds: 300` 기본값 때문에 자동 축출은 5분 지연이 있다는 점을 SLO에 반영합니다.

## 이 문서에서 가져갈 것

- DS 파드도 기본 스케줄러가 배치하므로 taint·리소스·이미지·롤아웃 정지 같은 일반 실패 모드를 그대로 겪습니다. 그 실패는 워크로드 스케줄링을 막지 않으므로 별도 알림 없이는 노드별 갭이 눈에 띄지 않은 채로 남습니다.
- cordon이 DS를 막지 못하는 것은 격리 관점에서 올바른 동작입니다. 자동 톨러레이션 7개의 경계를 알면 "워크로드만 막기"(cordon)와 "DS까지 막기"(커스텀 taint)를 의도적으로 고를 수 있습니다.
- 탐지를 아무리 빠르게 만들어도 반응 전략의 하한은 0이 아닙니다. startup taint로 기본값을 격리로 뒤집으면 탐지 시간이 사라집니다. 탐지·자동화는 그 뒤의 백스톱으로 두는 것이 순서입니다.

## 소스

- [DaemonSet — kubernetes.io](https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/) · [Perform a Rolling Update on a DaemonSet](https://kubernetes.io/docs/tasks/manage-daemon/update-daemon-set/)
- [Taints and Tolerations — kubernetes.io](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) · [Safely Drain a Node](https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/)
- [kube-state-metrics DaemonSet 메트릭](https://github.com/kubernetes/kube-state-metrics/blob/main/docs/metrics/workload/daemonset-metrics.md) · [Pod 메트릭](https://github.com/kubernetes/kube-state-metrics/blob/main/docs/metrics/workload/pod-metrics.md)
- [node-problem-detector issue #640](https://github.com/kubernetes/node-problem-detector/issues/640) · [issue #736](https://github.com/kubernetes/node-problem-detector/issues/736) · [PR #565](https://github.com/kubernetes/node-problem-detector/pull/565)
- [Karpenter NodePools — startupTaints](https://karpenter.sh/docs/concepts/nodepools/) · [kubernetes-sigs/karpenter issue #1772](https://github.com/kubernetes-sigs/karpenter/issues/1772) · [Disruption / Node Auto Repair](https://karpenter.sh/docs/concepts/disruption/)
- [Cilium — Taint Effects and Unmanaged Pods](https://docs.cilium.io/en/stable/installation/taints/)
- [Istio 1.30 upgrade notes — untaint controller](https://istio.io/latest/news/releases/1.30.x/announcing-1.30/upgrade-notes/)
- [Descheduler user guide](https://github.com/kubernetes-sigs/descheduler/blob/master/docs/user-guide.md) · [medik8s Self Node Remediation](https://www.medik8s.io/remediation/self-node-remediation/how-it-works/) · [planetlabs/draino](https://github.com/planetlabs/draino)
- [Node auto repair — AWS EKS User Guide](https://docs.aws.amazon.com/eks/latest/userguide/node-repair.html)
