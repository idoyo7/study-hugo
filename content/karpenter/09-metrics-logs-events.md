---
title: "무엇을 봐야 하나 — 메트릭·로그·이벤트"
weight: 9
---

# 09 · 무엇을 봐야 하나 — 메트릭·로그·이벤트

{{< callout type="info" >}}
**한눈에**
- 코어가 export하는 메트릭은 **60개**입니다. `promauto`·`MustRegister` 직접 호출이 0건이라 이 목록이 전량입니다.
- **`karpenter_nodeclaims_disrupted_total{reason}` 하나가 "노드가 왜 갈렸나"를 전부 가릅니다.** reason 값은 10종이고 §3에 전부 있습니다.
- **`karpenter_nodes_*`의 라벨 수는 프로바이더에 따라 달라집니다.** EKS에서는 `instance_family`·`instance_size` 등이 더 붙습니다 — 대시보드를 코어 기준으로 짜면 어긋납니다.
- **판정 로그는 `--log-level debug`에서만 나옵니다.** `consolidation score`, `marking drifted`, `abandoning ... due to timeout` 전부 `V(1)`입니다.
- **ICE(Insufficient Capacity Error)와 NodeClass 미준비가 같은 로그 문자열을 씁니다**(`failed launching nodeclaim`). 로그만으로는 구분이 안 되고 메트릭 `reason`을 봐야 합니다.
- 이벤트에는 **dedupe 창**이 있습니다. `Unconsolidatable`은 15분, `FailedScheduling`은 5분 — 카운트를 빈도로 읽으면 안 됩니다.
{{< /callout >}}

> **왜 이 문서인가.** 앞의 여덟 문서는 "왜 그렇게 판단하나"를 코드로 따라갔습니다. 이 문서는 그 판단을 **밖에서 어떻게 확인하나** — 대시보드·로그·이벤트 — 를 다룹니다.
>
> 예산 판정 절차는 [08 §6]({{< relref "08-disruption-budgets.md" >}}), 폴백 여부는 [07]({{< relref "07-ice-fallback.md" >}})이 소유합니다. 여기서는 **신호의 목록과 성질만** 정리하고 **무엇을 실제로 저장할 것인가**는 [10 메트릭 수집 비용]({{< relref "10-metric-cost.md" >}})이 받는다 — 60개 전부를 긁는 건 비용에서만 문제가 됩니다.

## 1. 어디서 나오나 — 세 층이 섞여 있다

`/metrics` 엔드포인트 하나에 출처가 다른 셋이 합쳐져 나옵니다. 이걸 모르면 "문서에 있는데 내 클러스터엔 없다"가 반복됩니다.

| 층 | 무엇 | 이 문서의 범위 |
|---|---|---|
| **코어** (kubernetes-sigs/karpenter) | `karpenter_*` 60개 | **전량 열거** |
| **프로바이더** (provider-aws) | 오퍼링 가격 등 + `karpenter_nodes_*`의 **추가 라벨** | 범위 밖 |
| operatorpkg · controller-runtime | `operator_status_condition_*`, `controller_runtime_*`, `workqueue_*` | 범위 밖 |

`karpenter_nodes_*`의 라벨 집합은 컴파일 타임이 아니라 **런타임에 결정됩니다** — 클라우드 프로바이더가 `v1.WellKnownLabels`에 자기 라벨을 `Insert`하기 때문입니다(`metrics/node/controller.go:62-64`). **두 번째 층이 함정입니다.** 코어 라벨은 `nodepool`·`zone`·`region`·`instance_type`·`arch`·`os`·`capacity_type`·`windows_build`·`node_name`·`phase`·`managed`뿐이지만 EKS에서는 `instance_family`·`instance_size` 등이 더 붙습니다.

이름 조립 규칙은 `karpenter` + Subsystem + Name입니다(`pkg/metrics/constants.go:27`).

## 2. 먼저 볼 것 — 질문 여섯 개

| 질문 | 메트릭 |
|---|---|
| 노드가 왜 갈렸나 | `karpenter_nodeclaims_disrupted_total{reason}` |
| 예산이 막고 있나 | `karpenter_nodepools_allowed_disruptions{reason}` |
| 파드가 왜 안 뜨나 | `karpenter_scheduler_unschedulable_pods_count` |
| AZ가 한쪽으로 쏠리나 | `karpenter_scheduler_pending_pods_by_effective_zone_count` |
| 통합이 왜 거부됐나 | `karpenter_consolidation_score{decision,policy}` |
| 클러스터에 여유가 있나 | `karpenter_cluster_utilization_percent{resource_type}` |

첫 두 개가 실무의 8할입니다. 아래 조합이 "노드가 안 줄어든다"를 한 화면에서 가릅니다.

```promql
# 이유별 예산 허용량 — 0인 구간이 의도한 창과 일치하는가
karpenter_nodepools_allowed_disruptions

# 이유별 실제 disruption 속도 — 위가 0이 아닌데 여기가 0이면 예산이 아닌 다른 원인
rate(karpenter_nodeclaims_disrupted_total[30m])
```

`pending_pods_by_effective_zone_count`의 `zone` 라벨은 실제 zone 이름 외에 `flexible`(zone 제약 없음)과 `none`(교집합이 빔)을 가집니다. **`none`이 0이 아니면 그건 용량 문제가 아니라 오설정입니다.**

## 3. 노드가 왜 갈렸나 — `reason` 10종

`karpenter_nodeclaims_disrupted_total`의 `reason` 값은 소스에 흩어져 있습니다. 모아 놓으면 노드 교체 원인의 전체 분류가 됩니다.

| reason | 무슨 일이 있었나 | 예산 |
|---|---|---|
| `underutilized` | 통합이 더 싼 배치를 찾음 | 소비 |
| `empty` | 재스케줄 대상 파드가 0 | 소비 |
| `drifted` | 해시·requirement 불일치 | 소비 |
| `expired` | `expireAfter` 만료 | **밖** |
| `unhealthy` | Node Repair가 제거 | **밖** |
| `garbage_collected` | 클라우드에 인스턴스가 없음 | **밖** |
| `insufficient_capacity` | ICE — 런치 실패 | — |
| `nodeclass_not_ready` | EC2NodeClass 미준비 | — |
| `launch_timeout` | 5분 안에 런치 실패 | — |
| `registration_timeout` | 15분 안에 등록 실패 | — |

앞의 셋만 [08]({{< relref "08-disruption-budgets.md" >}})의 예산을 탑니다. **`expired`·`unhealthy`가 올라가는데 예산을 조이고 있다면 헛수고 중입니다.**

뒤의 넷은 disruption이라기보다 **런치 실패**입니다 — `insufficient_capacity`가 계단식으로 오르면 [07]({{< relref "07-ice-fallback.md" >}})의 ICE 경로입니다. `registration_timeout`이 오르면 노드는 떴는데 kubelet이 붙지 못한 것이라 폴백이 구제하지 못합니다.

`karpenter_pods_drained_total`의 `reason`은 성격이 다릅니다 — NodeClaim의 `DisruptionReason` 컨디션을 그대로 쓰되 없으면 리터럴 `"Forceful Termination"`이 들어갑니다(`eviction.go:223-238`).

## 4. 전체 목록

### 4.1 프로비저닝 · 스케줄링 (14)

{{% details title="메트릭 14개 펼치기" closed="true" %}}

| 메트릭 | 타입 | 라벨 | 비고 |
|---|---|---|---|
| `karpenter_scheduler_scheduling_duration_seconds` | Histogram | `controller` | |
| `karpenter_scheduler_queue_depth` | Gauge | `controller,scheduling_id` | |
| `karpenter_scheduler_unfinished_work_seconds` | Gauge | `controller,scheduling_id` | 히스토그램 미집계분 |
| `karpenter_scheduler_ignored_pods_count` | Gauge | — | |
| `karpenter_scheduler_unschedulable_pods_count` | Gauge | `controller` | |
| `karpenter_scheduler_pending_pods_by_effective_zone_count` | Gauge | `controller,zone` | |
| `karpenter_pods_scheduling_decision_duration_seconds` | Histogram | — | 최초 인지 → 첫 스케줄 시도 |
| `karpenter_nodeclaims_created_total` | Counter | `reason,nodepool,min_values_relaxed` | |
| `karpenter_nodes_created_total` | Counter | `nodepool,zone` | |
| `karpenter_pods_state` | Gauge | node라벨+`phase,ready,scheduled,owner,managed` | 값 1 |
| `karpenter_pods_startup_duration_seconds` | Summary | — | 생성 → Running |
| `karpenter_pods_unstarted_time_seconds` | Gauge | `name,namespace` | |
| `karpenter_pods_bound_duration_seconds` | Histogram | — | 생성 → bound |
| `karpenter_pods_unbound_time_seconds` | Gauge | `name,namespace` | |

{{% /details %}}

### 4.2 Disruption · consolidation (17)

- `karpenter_nodeclaims_disrupted_total` · Counter · `{reason,nodepool,capacity_type}` — §3
- `karpenter_pods_disruption_initiated_total` · Counter · `{reason,nodepool,capacity_type}` — 재스케줄 대상 파드 누적(DaemonSet·mirror 제외)
- `karpenter_nodepools_allowed_disruptions` · Gauge · `{nodepool,reason}`
- `karpenter_nodepools_nodes_consuming_budgets` · Gauge · `{nodepool,reason}`
- `karpenter_voluntary_disruption_eligible_nodes` · Gauge · `{reason}`
- `karpenter_voluntary_disruption_decisions_total` · Counter · `{decision,reason,consolidation_type}`
- `karpenter_voluntary_disruption_decisions_by_nodepool_total` · Counter · 위 + `{nodepool}`
- `karpenter_voluntary_disruption_decision_evaluation_duration_seconds` · Histogram · `{reason,consolidation_type}`
- `karpenter_voluntary_disruption_queue_failures_total` · Counter · `{decision,reason,consolidation_type}`
- `karpenter_voluntary_disruption_consolidation_timeouts_total` · Counter · `{consolidation_type}`
- `karpenter_voluntary_disruption_failed_validations_total` · Counter · `{consolidation_type}` — 선정 후 validation 실패
- `karpenter_consolidation_score` · Histogram · `{decision,nodepool,policy}` — `Balanced` 스코어
- `karpenter_consolidation_moves_total` · Counter · `{decision,nodepool,policy}`
- `karpenter_nodeclaims_unhealthy_disrupted_total` · Counter · `{condition,nodepool,capacity_type,image_id}` — Node Repair
- `karpenter_pods_eviction_requests_total` · Counter · `{code}`
- `karpenter_pods_drained_total` · Counter · `{reason}`
- `karpenter_nodes_drained_total` · Counter · `{nodepool}`

**라벨 값**: `consolidation_type` ∈ `multi`·`single`. `decision`(스코어) ∈ `approved`·`rejected`. `policy`는 `consolidationPolicy` 문자열 그대로. voluntary 계열의 `reason`은 snake_case(`underutilized`·`empty`·`drifted`)다.

### 4.3 NodePool · NodeClaim · Node 상태 (22)

{{% details title="메트릭 22개 펼치기" closed="true" %}}

| 메트릭 | 타입 | 라벨 | 비고 |
|---|---|---|---|
| `karpenter_nodepools_limit`/`_usage` | Gauge | `resource_type,nodepool` | |
| `karpenter_nodepools_cost_total` | Gauge | `nodepool` | Karpenter 관점 비용, 과금 근거 아님 |
| `karpenter_nodepools_cost_tracker_errors_total` | Counter | `nodepool` | |
| `karpenter_nodes_allocatable` | Gauge | node라벨+`resource_type` | |
| `karpenter_nodes_total_pod_requests`/`_pod_limits` | Gauge | — | 바인딩 파드(DaemonSet 포함) |
| `karpenter_nodes_total_daemon_requests`/`_daemon_limits` | Gauge | — | DaemonSet 몫만 |
| `karpenter_nodes_system_overhead` | Gauge | — | capacity − allocatable |
| `karpenter_nodes_current_lifetime_seconds` | Gauge | — | 노드 나이 |
| `karpenter_cluster_utilization_percent` | Gauge | `resource_type` | |
| `karpenter_nodes_termination_duration_seconds` | Summary | `nodepool` | 삭제요청 → finalizer 제거 |
| `karpenter_nodes_lifetime_duration_seconds` | Histogram(15분~30일) | `nodepool` | |
| `karpenter_nodes_terminated_total` | Counter | `nodepool,zone` | |
| `karpenter_nodeclaims_terminated_total` | Counter | `nodepool,capacity_type,zone` | |
| `karpenter_nodeclaims_termination_duration_seconds` | Histogram(1~2048초) | `nodepool` | |
| `karpenter_nodeclaims_instance_termination_duration_seconds` | Histogram(1~1024초) | `nodepool` | |
| `karpenter_cluster_state_node_count` | Gauge | — | |
| `karpenter_cluster_state_synced` | Gauge(0/1) | — | |
| `karpenter_cluster_state_unsynced_time_seconds` | Gauge | — | |
| `karpenter_build_info` | Gauge(상수 1) | `version,goversion,goarch,commit` | |

`_total_pod_requests`에서 `_total_daemon_requests`를 빼면 **워크로드 몫만** 남습니다. 노드 크기를 줄일 수 있는지 판단할 때 이 차이가 실제 근거입니다 — DaemonSet은 노드를 줄여도 줄지 않습니다.

`cluster_state_synced`가 0인 구간은 Karpenter가 낡은 상태로 시뮬레이션하고 있었다는 뜻입니다. 그 구간의 판단은 전부 의심해야 합니다.

{{% /details %}}

### 4.4 클라우드 프로바이더 인터페이스 (2)

- `karpenter_cloudprovider_duration_seconds` · Histogram · `{controller,method,provider}`
- `karpenter_cloudprovider_errors_total` · Counter · `{controller,method,provider,error}`

`error` 라벨의 well-known 값은 `NodeClaimNotFoundError`·`NodeClassNotReadyError`·`InsufficientCapacityError`와 빈 문자열(미분류)입니다. **ICE를 이 메트릭으로도 볼 수 있습니다** — `disrupted_total{reason="insufficient_capacity"}`와 교차 확인하면 "정말 용량 문제인지"가 갈립니다.

### 4.5 ALPHA — 이름이 바뀔 수 있다 (5)

- `karpenter_pods_provisioning_bound_duration_seconds` · Histogram
- `karpenter_pods_provisioning_unbound_time_seconds` · Gauge · `{name,namespace}`
- `karpenter_pods_provisioning_startup_duration_seconds` · Histogram
- `karpenter_pods_provisioning_unstarted_time_seconds` · Gauge · `{name,namespace}`
- `karpenter_pods_provisioning_scheduling_undecided_time_seconds` · Gauge · `{name,namespace}`

다섯 모두 Help에 같은 단서가 붙습니다 — *"this calculated from a point in memory, not by the pod creation timestamp."* **파드 생성 시각이 아니라 Karpenter가 그 파드를 처음 본 시점 기준**이라 컨트롤러 재시작 시 기준점이 리셋됩니다. SLO에 쓰기 어려운 이유입니다.

`karpenter_nodepools_cost_*` 둘도 alpha 컴포넌트에서 나옵니다(`state/cost/cost.go:60`).

## 5. 로그

레벨은 `--log-level` ∈ `debug`·`info`·`error`입니다. zapr가 logr `V(1)`을 zap `DebugLevel`로 매핑하므로 **`V(1)` 로그는 `debug`에서만 보입니다.** `.V(2)`는 0건 — 더 깊은 티어는 없습니다.

예외 하나. `IgnoreDebugEvents` sink가 **`events` 서브로거의 `V(1)`을 무조건 드롭합니다**(`logging.go:96-119`) — 스케일아웃 때 event recorder가 로그를 덮는 걸 막는 장치입니다.

### 5.1 판정 로그 — debug에서만 나온다

| 메시지 | 무엇을 알려주나 |
|---|---|
| `consolidation score` | `Balanced`의 스코어·임계값·승인 여부 전체 |
| `marking drifted` | `reason` 필드에 drift 사유 |
| `marking consolidatable` | 그 노드가 후보가 된 시점 |
| `removing consolidatable status condition` | `lastPodEventTime`·`consolidateAfter`·`timeSincePodEvent` |
| `abandoning single-node consolidation due to timeout` | `candidates_evaluated` |
| `stopping multi-node consolidation after timeout` | 마지막 유효 커맨드 |
| `abandoning empty node consolidation attempt due to pod churn` | 파드가 들어와 무효가 됨 |

`consolidation score`의 필드가 특히 촘촘합니다 — `score`·`savings_fraction`·`disruption_fraction`·`threshold`·`k`·`approved`·`candidates`가 전부 붙습니다. [06 §1]({{< relref "06-consolidation-traps.md" >}})의 부등식을 실제 값으로 확인하려면 이 한 줄이면 됩니다.

실제로 무언가를 지울 때는 info로 나옵니다 — `disrupting node(s)`가 `command` 필드와 함께 찍힙니다.

### 5.2 스케줄 실패

| 메시지 | 레벨 |
|---|---|
| `could not schedule pod` | **Error** |
| `skipping, nodepool requirements filtered out all instance types` | Info |
| `pod(s) have a preferred Anti-Affinity which can prevent consolidation` | Info |
| `pod(s) have a preferred TopologySpreadConstraint which can prevent consolidation` | Info |
| `instance types were excluded because they would breach limits` | debug |
| `relaxing soft constraints for pod since it previously failed to schedule` | debug |
| `scheduling simulation timed out` | debug |

가운데 둘은 **경고 성격이지만 Info로 나옵니다.** "통합이 안 됩니다"의 원인인데 info 볼륨에 묻혀 놓치기 쉽습니다. 각각 최대 10개 파드를 샘플로 찍습니다.

`node limits have been exhausted for nodepool`과 `all available instance types exceed limits for nodepool`은 **로그가 아니라 에러 문자열**입니다. `could not schedule pod`의 err 필드와 `FailedScheduling` 이벤트 메시지로만 보입니다.

### 5.3 런치 실패 — 같은 문자열, 다른 원인

**ICE와 NodeClass 미준비가 똑같이 `failed launching nodeclaim`으로 찍힙니다**(`launch.go:87`과 `:99`). 로그 문자열만으로는 구분되지 않습니다. 가르려면 메트릭을 봐야 합니다.

```promql
karpenter_nodeclaims_disrupted_total{reason="insufficient_capacity"}   # ICE
karpenter_nodeclaims_disrupted_total{reason="nodeclass_not_ready"}     # EC2NodeClass
```

`CreateFleet`이나 `InsufficientInstanceCapacity` 같은 AWS 원문 문자열은 **코어에 없습니다.** 코어는 에러 타입만 정의하고(`cloudprovider/types.go:619-707`) 실제 매핑은 provider-aws가 합니다.

## 6. 이벤트

`kubectl get events`로 보는 것들입니다. Reason 기준으로 필터링합니다.

```bash
kubectl get events -A --field-selector reason=DisruptionBlocked
kubectl get events -A --field-selector reason=Unconsolidatable
```

| Reason | 대상 | 언제 |
|---|---|---|
| `DisruptionBlocked` | NodePool · Node | 예산에 막힘 ([08]({{< relref "08-disruption-budgets.md" >}})) |
| `Unconsolidatable` | Node · NodeClaim | 후보 단계에서 탈락 |
| `ConsolidationCandidate` | Node · NodeClaim | 절감액 포함 |
| `ConsolidationApproved` | Node · NodePool | 스코어가 임계 통과 |
| `ConsolidationRejected` | Node · NodeClaim | 스코어 미달 |
| `DisruptionLaunching` | NodeClaim | 대체 노드 기동 시작 |
| `DisruptionWaitingReadiness` | NodeClaim | 대체 노드 준비 대기 |
| `DisruptionTerminating` | Node · NodeClaim | 실제 종료 |
| `FailedScheduling` | Pod | (Warning) |
| `NoCompatibleInstanceTypes` | NodePool | requirements 전부 걸러냄 (Warning) |
| `Nominated` | Pod | 이 노드에 뜰 예정 |
| `InsufficientCapacityError` | NodeClaim | ICE (Warning) |
| `FailedDraining` | Node | (Warning) |
| `TerminationGracePeriodExpiring` | Node · NodeClaim | (Warning) |
| `AwaitingVolumeDetachment` | Node | |
| `NodeRepairBlocked` | Node | unhealthy 비율 상한 초과 (Warning) |

### 6.1 dedupe 창 때문에 카운트를 빈도로 읽으면 안 된다

이벤트마다 중복 억제 창이 다릅니다 — 기본 2분에 예외가 셋입니다.

| Reason | 창 |
|---|---|
| `Unconsolidatable` | **15분** |
| `NodeRepairBlocked` | **15분** |
| `FailedScheduling` | **5분** |
| `NoCompatibleInstanceTypes` · NodePool `DisruptionBlocked` | 1분 |
| 그 외 | 2분 |

[08 §4.2]({{< relref "08-disruption-budgets.md" >}})의 `x297 over 8h`가 "8시간에 297번"으로 읽히는 것은 그 이벤트의 창이 1분이기 때문입니다. `Unconsolidatable`을 같은 방식으로 읽으면 실제 발생의 15분의 1만 보게 됩니다.

`Nominated`에는 dedupe 외에 **rate limiter**도 걸려 있습니다(5qps, burst 10). 대규모 스케일아웃에서는 일부가 아예 방출되지 않습니다.

## 7. 소스에서 확인한 이상 징후 넷

문서가 아니라 코드를 읽어야만 보이는 것들입니다.

**① 정의만 있고 방출되지 않는 이벤트가 셋입니다.** `NodeClassNotReady`(`nodeclaim/lifecycle/events.go:38`), NodePool용 `DisruptionBlocked` 변형(`disruption/events/events.go:128`), `TerminationFailed` 상수 — 호출처가 0건입니다. 알림 룰을 이 Reason으로 걸면 영원히 안 울립니다.

**② `NodeRepairBlocked`는 전부 Node에 달립니다.** Node·NodeClaim·NodePool 각각에 남기려는 의도로 보이나 `InvolvedObject`가 셋 다 `node`입니다(`node/health/events.go:28-55`). **`--field-selector involvedObject.kind=NodePool`로는 안 잡힙니다.**

**③ Reason 레지스트리를 우회하는 이벤트가 넷 있습니다.** `AwaitingVolumeDetachment`·`InvalidDoNotDisruptAnnotation`·`DoNotDisruptUntil`·`DoNotDisruptGracePeriodElapsed`는 `pkg/events/reason.go`의 상수가 아니라 인라인 문자열입니다. 상수 목록만 보고 알림을 짜면 이 넷이 빠집니다.

**④ `consolidation_timeouts_total`은 0으로 시딩됩니다.** `multi`·`single` 두 라벨이 `init()`에서 미리 0으로 등록되므로(`disruption/metrics.go:35-38`) **메트릭이 없는 것과 0인 것이 구분됩니다.** `absent()` 기반 알림을 쓸 필요가 없습니다.

## 8. 근거

`kubernetes-sigs/karpenter` **v1.14.0-6-gac7a021e** 로컬 체크아웃 기준입니다. 상대 경로는 레포 루트.

- **전량임의 근거** — `opmetrics.NewPrometheus*` 선언 60건(테스트 제외), `promauto`·`MustRegister` 직접 호출 **0건**
- **이름 조립** — `pkg/metrics/constants.go:27`(Namespace), `pkg/metrics/metrics.go:28`(Subsystem)
- **scheduler 6종** — `controllers/provisioning/scheduling/metrics.go:27-108`
- **disruption 11종** — `controllers/disruption/metrics.go:27-151`
- **pod 10종(alpha 5 포함)** — `controllers/metrics/pod/controller.go:46-198`
- **node 8종 · 동적 라벨** — `controllers/metrics/node/controller.go:45-160, 291-306`, 런타임 결정 근거는 `:62-64`
- **nodepool 3종** — `controllers/metrics/nodepool/controller.go:44-81`
- **cluster_state 3종** — `controllers/state/metrics.go:27-73`
- **termination·drain 5종** — `controllers/node/termination/metrics.go:31-89`, `.../terminator/metrics.go:27-54`
- **`disrupted_total`의 reason 10종** — `expiration/controller.go:88`, `garbagecollection/controller.go:113`, `node/health/controller.go:175`, `lifecycle/launch.go:93,104`, `lifecycle/liveness.go:53-54`, `disruption/queue.go:243`
- **로그 레벨 매핑 · events 드롭** — `operator/logging/logging.go:41-71, 96-119`
- **이벤트 구조·dedupe** — `pkg/events/recorder.go:30-38, 56, 72-87`, Reason 상수 `pkg/events/reason.go:22-52`
- **에러 타입** — `pkg/cloudprovider/types.go:619-707`

**확인하지 못한 것** — provider-aws와 operatorpkg 체크아웃이 없어 `karpenter_cloudprovider_instance_type_offering_*` 계열과 `operator_status_condition_*`의 정확한 이름·라벨은 열거하지 못했습니다. 실제 EKS의 `/metrics`에는 이 문서의 60개보다 많이 나옵니다.
