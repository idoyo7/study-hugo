---
title: "Node Problem Detector"
weight: 4
---

# 04 · Node Problem Detector — 솔루션 검토

{{< callout type="info" >}}
**한눈에**
- NPD는 SIG Node 산하 프로젝트(`kubernetes/node-problem-detector`)다. DaemonSet 또는 standalone 데몬으로 각 노드에서 돌면서 노드 문제를 NodeCondition 또는 Event로 API 서버에 보고합니다. kubernetes.io 공식 태스크 문서 *Monitor Node Health*에 수록돼 있습니다.
- 문제 데몬은 SystemLogMonitor · SystemStatsMonitor · CustomPluginMonitor · HealthChecker 4종입니다. 기본 설정 파일만으로 KernelDeadlock, ReadonlyFilesystem, FrequentKubeletRestart, CorruptDockerOverlay2 등이 탐지됩니다.
- NPD는 탐지·보고까지만 수행합니다. cordon·drain·교체는 별도 remedy system이 맡습니다. README는 Descheduler · mediK8S · MachineHealthCheck 3개를 나열합니다.
- EKS에는 `eks-node-monitoring-agent` 애드온과 node auto repair 조합이 있습니다. 5개 전용 NodeCondition을 세우고 `Replace`/`Reboot`까지 수행합니다. AWS 공식 문서는 NPD와의 관계(대체인지 보완인지)를 서술하지 않습니다.
{{< /callout >}}

> 자매 문서: [챕터 개요]({{< relref "_index.md" >}}) · 노드 단위 조치·중단 예산은 [Karpenter]({{< relref "../karpenter/_index.md" >}})

## 1. 개요

Node Problem Detector(NPD)는 여러 데몬으로부터 노드 문제 정보를 수집해 NodeCondition 또는 Event 형태로 API 서버에 보고합니다. 각 노드에 DaemonSet으로 배포하거나 standalone 데몬으로 실행합니다. 저장소는 kubernetes org 산하이고 OWNERS에 `sig-node-reviewers`/`sig-node-approvers`가 등재돼 있습니다.

kubelet은 이미 `Ready`, `MemoryPressure`, `DiskPressure`, `PIDPressure`, `NetworkUnavailable` 5개 표준 컨디션을 자체 계산해 보고합니다. NPD는 이를 대체하지 않습니다. 커널 로그·시스템 통계·사용자 플러그인에서 유도한 커스텀 컨디션과 이벤트를 추가로 보고합니다. 두 메커니즘은 병행되며 보고 항목이 겹치지 않습니다.

## 2. 아키텍처

문제 데몬(problem daemon)은 4종입니다. 각각 빌드 태그(`disable_*`)로 제외할 수 있습니다.

| 모니터 | 입력 | 출력 |
|---|---|---|
| **SystemLogMonitor** | 시스템·커널 로그(kernel/filelog/kmsg/abrt/systemd) | 매칭 결과를 NodeCondition/Event로 |
| **SystemStatsMonitor** | 호스트 메트릭 | 메트릭만 수집. 현재 NodeCondition은 보고하지 않는다 |
| **CustomPluginMonitor** | 사용자 정의 스크립트 | 스크립트 종료 코드 기반 NodeCondition/Event (기본 샘플: NTPProblem) |
| **HealthChecker** | kubelet · 컨테이너 런타임 헬스 | `KubeletUnhealthy`, `ContainerRuntimeUnhealthy` |

`FrequentKubeletRestart` 계열은 CustomPluginMonitor가 아니라 SystemLogMonitor의 카운터 변형 설정(`systemd-monitor-counter.json`)에서 나옵니다. 채택 시 룰 소유 위치를 이 기준으로 관리합니다.

## 3. 보고 채널

| 채널 | 대상 | 정의 |
|---|---|---|
| NodeCondition | 노드를 사용 불가로 만드는 영구적 문제 | 룰 `type: permanent` |
| Event | 파드 영향이 제한적이고 정보 제공 성격인 일시적 문제 | 룰 `type: temporary` |

기본 설정 파일이 정의하는 주요 항목입니다.

| 항목 | 채널 | 설정 파일 |
|---|---|---|
| `KernelDeadlock` | Condition | `kernel-monitor.json` |
| `XfsShutdown`, `CperHardwareErrorFatal` | Condition | `kernel-monitor.json` |
| `OOMKilling`·`TaskHung`·`KernelOops`·`Ext4Error`·`Ext4Warning`·`IOError`·`UnregisterNetDevice` | Event | `kernel-monitor.json` |
| `ReadonlyFilesystem` (reason `FilesystemIsReadOnly` / `FilesystemIsNotReadOnly`) | Condition | `readonly-monitor.json` |
| `FrequentKubeletRestart` | Condition + 대응 Event | `systemd-monitor-counter.json` |
| `FrequentDockerRestart` | Condition + 대응 Event | `systemd-monitor-counter.json` |
| `FrequentContainerdRestart` | Condition + 대응 Event | `systemd-monitor-counter.json` |
| `CorruptDockerOverlay2` | Condition | `docker-monitor-counter.json` |
| `KubeletUnhealthy` | Condition | `health-checker-kubelet.json` |
| `ContainerRuntimeUnhealthy` | Condition | `health-checker-docker.json`·`health-checker-containerd.json` |

`systemd-monitor-counter.json`은 20분 내 5회 재시작을 기준으로 판정합니다.

## 4. 배포와 설정

배포 경로는 세 가지입니다.

| 경로 | 방법 |
|---|---|
| kubectl | 공식 문서의 DaemonSet 매니페스트를 직접 적용 |
| Helm | 커뮤니티 유지 차트 `oci://ghcr.io/deliveryhero/helm-charts/node-problem-detector` |
| 클러스터 Addon | 부트스트랩 시 자동 배포. README는 GKE에서 기본 활성이라고 명시한다 |

탐지 룰은 `config/` 아래 JSON 파일 26개로 관리합니다. 로그 기반 룰은 정규식 패턴 매칭입니다. 골격은 다음과 같습니다.

```json
{
  "rules": [
    { "type": "permanent", "condition": "KernelDeadlock", "reason": "<reason>", "pattern": "<정규식>" },
    { "type": "temporary", "reason": "OOMKilling", "pattern": "<정규식>" }
  ]
}
```

필드 전체 목록과 실제 정규식은 원본 `config/kernel-monitor.json` 계열 파일을 그대로 따릅니다. 커스텀 룰을 추가할 때는 이 파일을 ConfigMap으로 올려 교체합니다.

메트릭은 Prometheus/OpenMetrics 형식으로 기본 바인드 `127.0.0.1:20257`의 로컬 엔드포인트에 노출됩니다. 포트는 `--prometheus-port`로 변경합니다. 스크레이프하려면 바인드 주소와 포트를 클러스터 정책에 맞게 조정해야 합니다.

리소스 요청량은 kubernetes.io 예시 매니페스트 기준 `requests: cpu 20m / memory 20Mi`, `limits: cpu 200m / memory 100Mi`입니다. 2016년 실측(issue #2)에서 도출돼 kubernetes PR #25986에 반영된 값은 `100m / 50Mi`였습니다. 현재 문서 예시값과 다릅니다. 두 값 사이의 변경 이력은 추적하지 못했으므로 실제 한도는 자체 노드에서 재측정해 정하는 편이 안전합니다.

## 5. 한계와 조치 생태계

NPD는 상태를 보고할 뿐 노드를 격리하거나 교체하지 않습니다. README는 이를 remedy system의 역할로 분리하고 다음 3개를 나열합니다.

| remedy system | 동작 | 유지보수 상태 |
|---|---|---|
| Descheduler | `RemovePodsViolatingNodeTaints`로 NoSchedule taint 위반 파드 축출(`TaintNodesByCondition` 전제) | 활성 |
| mediK8S | Node Health Check Operator(NHC)와 remediator(예: Poison-Pill) 조합 | 활성 |
| MachineHealthCheck | Cluster API의 노드 헬스 체크·교체 | 활성 |

Descheduler 경로의 체인은 `NodeCondition` → `TaintNodesByCondition`이 taint로 변환 → `RemovePodsViolatingNodeTaints`가 파드 축출 → Cluster Autoscaler가 비워진 노드를 종료로 이어집니다. 이 접점은 NPD README가 서술합니다. Descheduler 자체 문서는 taint/toleration 관점으로만 전략을 설명합니다.

Draino는 현재 NPD README의 remedy system 목록에 없습니다. Draino 자체 README는 NPD·Cluster Autoscaler와 함께 쓰는 워크플로우(조건 감지 → cordon+drain → CA가 저사용 노드로 판단해 축소)를 명시합니다. 다만 master 브랜치 마지막 커밋이 2020-12-14, 릴리스는 2018-12-28 태그 하나뿐입니다. 신규 채택 후보로 두지 않습니다.

## 6. EKS에서의 선택

- **탐지 범위** — NPD: 커널 로그 패턴, systemd 재시작 카운터, 파일시스템, kubelet·런타임 헬스, 사용자 플러그인. eks-node-monitoring-agent: AcceleratedHardware·ContainerRuntime·Kernel·Networking·Storage 카테고리의 노드 로그.
- **컨디션** — NPD: `KernelDeadlock`, `ReadonlyFilesystem`, `FrequentKubeletRestart` 등 커스텀 다수. eks-node-monitoring-agent: `AcceleratedHardwareReady`, `ContainerRuntimeReady`, `KernelReady`, `NetworkingReady`, `StorageReady`.
- **조치 여부** — NPD: 없음, remedy system 필요. eks-node-monitoring-agent: 있음 — `Replace` / `Reboot` / `NoAction`.
- **조치 트리거** — NPD: 해당 없음. eks-node-monitoring-agent: 기본은 kubelet `Ready`가 False/Unknown으로 30분. 에이전트 설치 시 위 5개 조건도 소비 — `AcceleratedHardwareReady` 10분, 나머지 30분.
- **관리 주체** — NPD: 자체 배포·룰 관리. eks-node-monitoring-agent: AWS 관리형 애드온. 2026-02 오픈소스화(`aws/eks-node-monitoring-agent`).
- **적용 대상** — NPD: 배포 가능한 모든 클러스터. eks-node-monitoring-agent: EKS 전용, Linux 전용(Windows 미지원).

Karpenter의 Node Repair도 같은 조건 집합을 소비합니다. `NodeRepair=true` feature gate로 활성화합니다. NodePool 내 unhealthy 노드가 20%를 넘으면 연쇄 장애 방지를 위해 repair를 중단합니다.

NPD가 여전히 필요한 경우와 불필요한 경우는 다음과 같습니다.

- 필요: 자체 클러스터(EKS 밖), 애드온이 커버하지 않는 도메인 특화 탐지(사내 에이전트 상태·NTP·특정 커널 로그 패턴), CustomPluginMonitor로 자체 점검 스크립트를 컨디션화해야 하는 경우.
- 불필요: EKS에서 커널·런타임·스토리지·네트워킹 등 애드온이 이미 커버하는 카테고리만 필요하고 조치까지 관리형에 맡길 수 있는 경우. 이 범위에서는 NPD를 추가해도 조치 주체가 늘지 않습니다.

AWS 공식 문서에서 애드온과 NPD의 관계를 대체 또는 보완으로 규정한 서술은 확인하지 못했습니다. 두 컴포넌트를 동시에 돌릴 때의 권고 사항도 미확인입니다. 병행 배포를 검토한다면 컨디션 이름이 서로 다르다는 점(중복 컨디션은 발생하지 않음)까지만 확정 사실로 두고 나머지는 자체 검증 대상으로 잡습니다.

## 7. 채택 체크리스트

- 탐지하려는 항목이 EKS 애드온 5개 카테고리 안에 들어오는지 먼저 대조합니다. 들어오면 EKS 클러스터에서 NPD의 추가 가치는 커스텀 룰로 좁혀집니다.
- 조치 주체를 함께 정합니다. remedy system 없이 NPD만 배포하면 컨디션이 붙은 노드가 그대로 남습니다. Descheduler를 쓸 경우 `TaintNodesByCondition` 활성화 여부를 먼저 확인합니다.
- 자체 클러스터에는 NPD + remedy system 조합이 필요합니다. Draino는 유지보수가 멈춰 있으므로 mediK8S 또는 MachineHealthCheck 중에서 고릅니다.
- 룰 파일의 소유·배포 경로를 정합니다. `config/` JSON을 ConfigMap으로 관리합니다. 커널·systemd 로그 포맷이 노드 OS에 따라 달라지므로 AMI 변경 시 정규식 매칭을 재검증합니다.
- Prometheus 스크레이프를 쓸지 결정합니다. 기본 바인드가 `127.0.0.1:20257`이라 그대로는 외부에서 수집되지 않습니다.
- 리소스 한도는 문서 예시값을 출발점으로 두되 자체 노드의 로그 유입량으로 재측정합니다.

## 이 문서에서 가져갈 것

- NPD는 kubelet의 표준 5개 컨디션에 커스텀 컨디션·이벤트를 더하는 보고 계층입니다. 탐지 후 조치는 범위 밖이므로 remedy system을 함께 설계해야 완결됩니다.
- EKS에서는 `eks-node-monitoring-agent` + node auto repair가 탐지와 조치를 한 번에 관리형으로 제공합니다. NPD의 잔여 가치는 애드온이 커버하지 않는 커스텀 룰과 EKS 밖 클러스터입니다.
- 프로젝트는 활발히 유지보수 중입니다. 확인 시점(2026-07-31) 기준 최신 릴리스는 v1.36.0(2026-07-11)이고 저장소는 archived=false다. 반면 예전에 표준 조합으로 통하던 Draino는 사실상 정지 상태이므로 채택 대상에서 제외합니다.

## 소스

- [Monitor Node Health — kubernetes.io](https://kubernetes.io/docs/tasks/debug/debug-cluster/monitor-node-health/)
- [Node Status — kubernetes.io](https://kubernetes.io/docs/reference/node/node-status/)
- [kubernetes/node-problem-detector README](https://raw.githubusercontent.com/kubernetes/node-problem-detector/master/README.md) · [config/](https://github.com/kubernetes/node-problem-detector/tree/master/config) · [v1.36.0 릴리스](https://github.com/kubernetes/node-problem-detector/releases/tag/v1.36.0) · [리소스 벤치마크 issue #2](https://github.com/kubernetes/node-problem-detector/issues/2)
- [planetlabs/draino](https://github.com/planetlabs/draino)
- [Monitor node health — AWS EKS User Guide](https://docs.aws.amazon.com/eks/latest/userguide/node-health.html)
- [Disruption / Node Auto Repair — karpenter.sh](https://karpenter.sh/docs/concepts/disruption/)
