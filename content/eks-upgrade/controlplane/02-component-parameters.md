---
title: "레이어 2 — 2026-08 열린 4종과 karpenter 가중치"
weight: 2
---

# 레이어 2 — 2026-08 열린 4종과 karpenter 가중치

{{< callout type="info" >}}
- 실제 후보는 `MostAllocated` 하나뿐이고 그것도 blue 안정화 이후 별건입니다. create 시점에는 4개 전부 기본값으로 둡니다(§8).
- 4개가 열렸고 그중 3개는 추가 과금이 없습니다. scoringStrategy·eventTtl·serviceNodePortRange는 **k8s 1.31+** 전 리전에서 무료로 쓸 수 있고 **HPA syncPeriod만 Provisioned Control Plane**(월 증분 **+$1,204.50**)이 전제입니다.
- 완전 개방이 아니라 검증된 범위 안의 개방입니다. 범위 폭(HPA 5초 · eventTtl 축소 방향만 · 스케줄러 전략 2종만)이 그대로 AWS의 책임 경계 선언입니다 — 업스트림 kube-controller-manager에는 sync period validation이 **아예 없습니다**(§2).
- karpenter는 이 설정을 읽지 않습니다. karpenter-core v1.14.0 전체에서 scoringStrategy 관련 심볼이 grep 0건입니다. 점수 공식이 각 항을 **그 노드 자신의 allocatable로 나누므로** "노드의 cpu/memory 비율에 맞춰 가중치를 조정한다"는 작업은 애초에 필요하지 않습니다(§4).
- AWS 문서와 실제가 어긋납니다. User Guide는 Terraform을 "coming soon"이라 쓰지만 provider **v6.59.0**(발표 당일)에 이미 들어왔고 eksctl·CDK는 반대로 과대 서술입니다(§6).
{{< /callout >}}

2026-08-12, EKS가 관리형 컨트롤 플레인 3개 컴포넌트의 파라미터 4종을 고객 설정 대상으로 열었습니다. 지금까지 kube-scheduler·kube-apiserver·kube-controller-manager 설정은 손댈 수 없는 영역이었습니다. 노드를 채워 써서 컴퓨트 비용을 줄이고 싶어도 관리형 스케줄러의 전략을 바꿀 방법이 없었습니다. [목표버전]({{< relref "../01-target-version.md" >}})에서 확정한 blue의 목표는 **1.35**이고 이 4종의 하한은 **1.31**입니다. blue는 4개를 전부 쓸 수 있는 상태로 태어납니다. 이 페이지는 **"써야 하나"**를 판정합니다. "쓸 수 있나"는 이미 답이 나와 있습니다. 클러스터 레벨 파라미터와 가변성 3분류는 [레이어 1]({{< relref "01-cluster-parameters.md" >}}), HPA syncPeriod가 요구하는 용량 축은 [Provisioned Control Plane]({{< relref "03-provisioned-control-plane.md" >}}), 이번에도 여전히 닫혀 있는 플래그들은 [레이어 3]({{< relref "04-not-tunable.md" >}})이 다룹니다.

> 이 페이지의 모든 `path:line` 인용은 로컬 클론 기준입니다 — 쿠버네티스는 **v1.37 개발 브랜치 커밋 `752b8875`(2026-07-26)**, karpenter-core는 **`ac7a021e`(`v1.14.0-6`, 2026-07-27)**. 1.31~1.36 배포본에서는 줄번호가 다를 수 있습니다. 네 필드 모두 1.19~1.23 사이에 도입돼 이후 API 계약이 바뀌지 않았으므로 개념·기본값 자체는 안정적입니다.

## 1. 무엇이 열렸나

### 1.1 파라미터 마스터 표

| 컴포넌트 | 파라미터 | 허용 범위 | 기본값 | Provisioned CP | k8s 하한 |
|---|---|---|---|---|---|
| **kube-scheduler** | `nodeResourcesFit.scoringStrategy` | `LeastAllocated` \| `MostAllocated` | `LeastAllocated`(cpu:1 / memory:1) | 불필요 | 1.31 |
| **kube-apiserver** | `eventTtl` | 10m ~ 60m | **60m**(=1h) | 불필요 | 1.31 |
| **kube-apiserver** | `serviceNodePortRange` | 10260 ~ 32767 | **30000 ~ 32767** | 불필요 | 1.31 |
| **kube-controller-manager** | `horizontalPodAutoscalerControllerConfig.horizontalPodAutoscalerSyncPeriod` | 10s ~ 15s | **15s** | ⚠️ **필요**(tier-xl 이상) | 1.31 |

scoringStrategy의 하위 `resources[]` 배열에는 별도 제약이 붙습니다.

| 하위 필드 | 제약 | 비고 |
|---|---|---|
| `resources[].name` | `cpu` · `memory` · `nvidia.com/gpu` · `aws.amazon.com/neuron` · `aws.amazon.com/neuroncore` | 구문 제약은 문자열 1~253자이고, 그 위에 `DescribeClusterVersions`가 `allowedValues`로 의미론적 제한을 얹는다 — 두 제약은 층이 다르다 |
| `resources[].weight` | 1 ~ 100 | **최소값이 1이다** — "가중치 0으로 무시"라는 표현이 불가능하다(§4.3) |

### 1.2 공통 성격

| 항목 | 값 |
|---|---|
| API | **신규 API가 아닙니다.** 기존 `CreateCluster`·`UpdateClusterConfig`의 필드 확장 |
| 스코프 | **항상 클러스터 전역.** namespace·워크로드 단위 스코핑 불가 |
| 과금 | 파라미터 자체는 추가 과금 없음. HPA syncPeriod만 Provisioned CP 티어 시간당 요금이 붙는다 |
| 리전 | 전 상용 리전 + GovCloud(US) + China 리전 중 EKS가 제공되는 곳 |
| 대상 | 신규·기존 클러스터 모두 |
| 적용 방식 | 컨트롤 플레인 **롤링 업데이트**, 수 분 소요. EKS가 적용 전 검증하고 CloudTrail에 기록한다 |
| 업데이트 시맨틱 | **merge** — 생략한 필드는 지워지지 않고 현재값이 유지된다 |
| 리셋 | **전용 리셋 오퍼레이션이 없습니다.** 기본값으로 되돌리려면 기본값을 명시해서 다시 설정합니다 |

AWS의 요금 문구는 이렇게 적혀 있습니다. "There is no additional charge for configuring control plane parameters. Using `horizontalPodAutoscalerSyncPeriod` requires Provisioned Control Plane, which is billed at the hourly rate for your scaling tier." 티어 요금표와 Standard 복귀 제약은 [Provisioned Control Plane]({{< relref "03-provisioned-control-plane.md" >}})이 다룹니다.

### 1.3 기본값은 업스트림과 정확히 일치한다

네 파라미터의 EKS 기본값은 업스트림 쿠버네티스 기본값을 그대로 씁니다. 정확한 표현은 "업스트림 기본값 그대로 돌던 것을 이제 바꿀 수 있게 됐다"입니다. "EKS가 임의로 튜닝해 둔 값을 이제 공개했다"로 읽으면 틀립니다.

| 파라미터 | 업스트림 기본값 | 소스 위치 |
|---|---|---|
| scoringStrategy | `LeastAllocated`, cpu:1 / memory:1 | `pkg/scheduler/apis/config/v1/defaults.go:33-35, 234` |
| eventTtl | `1h` | `pkg/controlplane/apiserver/options/options.go:67, 129` |
| serviceNodePortRange | Base 30000 + Size 2768 → 30000~32767 | `pkg/kubeapiserver/options/options.go:26-27` |
| HPA syncPeriod | `15s` | `pkg/controller/podautoscaler/config/v1alpha1/defaults.go:40-41` |

## 2. 완전 개방이 아니라 검증된 범위 안의 개방

이 발표를 "apiserver 플래그가 열렸다"로 읽으면 규모를 크게 오판합니다. 범위의 폭 자체가 AWS의 **책임 경계 선언**입니다.

| 파라미터 | 개방 폭 | 무엇을 말하는가 |
|---|---|---|
| HPA syncPeriod | 10s ~ 15s — **5초 폭** | 업스트림에는 상·하한 validation이 **아예 없다**. `cmd/kube-controller-manager/app/options/hpacontroller.go:58-68`의 `Validate()`는 `ConcurrentHorizontalPodAutoscalerSyncs < 1`만 검사합니다. 이 5초 폭은 순전히 EKS가 얹은 제약입니다 |
| eventTtl | 10m ~ 60m — **줄이는 방향만** | 기본값이 그대로 상한입니다. 늘려서 etcd를 압박하는 방향은 막혀 있습니다 |
| scoringStrategy | 2종만 | 업스트림에 존재하는 세 번째 전략 `RequestedToCapacityRatio`가 제외됐다 |
| serviceNodePortRange | 하한만 내려간다 | 상한 32767은 업스트림 기본값과 같고, 확장 여지는 아래쪽 10260까지뿐이다 |

AWS 문서는 경계값의 근거까지 직접 밝힙니다. 하한 **10260**은 노드의 kubelet health 포트(**10248**)와 kube-proxy health check 포트(**10256**)를 피해서 잡은 값입니다. 상한 **32767**은 Linux ephemeral port 범위(통상 **32768**부터)와 부딪히지 않게 막습니다. 임의로 잘라 놓은 숫자가 아닙니다.

`RequestedToCapacityRatio` 제외는 **사실로 확정**됐습니다. API Reference가 `LeastAllocated | MostAllocated`만 명시합니다. 그런데 **제외 이유는 어디에도 없습니다.** 코드를 보면 이 전략만 임의 개수의 `(utilization, score)` 점 배열(`UtilizationShapePoint`)과 단조성 검증(`validateFunctionShape`)을 요구하므로 스칼라 몇 개로 끝나는 앞의 두 전략보다 관리형 API 표면이 훨씬 커집니다(`pkg/scheduler/framework/plugins/noderesources/requested_to_capacity_ratio.go`). 이건 코드 구조상 그렇다는 **추론**입니다. AWS가 실제로 그 이유로 뺐다는 근거는 찾지 못했습니다.

**"왜 이 4개인가"의 공식 설명도 없습니다.** Containers 블로그가 밝힌 배경은 고객 요청(파드 배치 최적화로 컴퓨트 비용 절감 · 고churn 워크로드의 etcd 압박 완화 · 자체관리 k8s에서 이전하며 튜닝해 둔 스케줄러 설정 보존)뿐입니다. 선정 기준은 "추가 파라미터는 Containers Roadmap에서 요청하라"는 안내로 대체됩니다. 로드맵 순서보다는 백로그 우선순위에 가깝습니다. 실제로 이번 기능에 대응하는 백로그 이슈들(`#785` eventTtl · `#1468` MostAllocated · `#1809` HPA sync period)은 **2026-08-14 기준 여전히 open**입니다. AWS PM이 명시적으로 close한 것은 `#1361`(serviceNodePortRange) 하나뿐입니다. 나머지가 왜 정리되지 않았는지는 확인되지 않았습니다.

## 3. 파라미터별 상세

### 3.1 kube-scheduler — nodeResourcesFit.scoringStrategy

두 전략은 **완전히 같은 가중합 구조**를 씁니다. 차이는 리소스별 점수의 부호 하나뿐입니다.

```text
LeastAllocated:  score_i = (allocatable_i − requested_i) × 100 / allocatable_i
MostAllocated:   score_i =  requested_i                  × 100 / allocatable_i

NodeScore = Σ(score_i × weight_i) / Σ(weight_i)
```

(`least_allocated.go:24-46, 52-60`, `most_allocated.go:24-46, 54-64`, `MaxNodeScore = 100`. allocatable이 0이면 0점, requested가 allocatable을 넘으면 LeastAllocated는 0점 / MostAllocated는 allocatable로 클램프합니다.)

`LeastAllocated`는 **여유가 큰 노드에 높은 점수**를 줘 파드를 흩뿌립니다. `MostAllocated`는 **이미 많이 쓴 노드에 높은 점수**를 줘 bin packing합니다. 가중치 시맨틱과 karpenter 병용은 §4가 통째로 다룹니다.

karpenter·Auto Mode와 어떤 관계인지는 AWS가 원론부터 분명히 밝힙니다. "The scheduler and node management operate at different layers. The scoring strategy influences where pods are placed among nodes that can already run them. It doesn't change how EKS Auto Mode or Karpenter provisions or removes nodes. **Validate the combined behavior for your workload before you change the configuration.**" 그러면서 같은 문서가 시너지도 명시합니다. "Over time, this packing behavior keeps lightly used nodes free of new workloads, so node pools that support consolidation can remove them." AWS 자신의 답은 **상보**입니다. 중복이 아닙니다.

위험 쪽도 문서가 직접 말합니다.

| 위험 | 근거 | 성격 |
|---|---|---|
| 밀집 노드가 더 빨리 차서 Pending이 늘어난다 | "Under high pod churn, densely packed nodes also fill up faster, which can leave pods in `Pending` state while new capacity is provisioned." | 공식 인용 |
| blast radius가 집중된다 | "`MostAllocated` concentrates blast radius. Packing workloads onto fewer nodes means more pods are affected at once if a node becomes unhealthy, an instance is retired, or an Availability Zone is disrupted." | 공식 인용 |
| PDB가 많아져 나중에 비우기가 더 어려워진다 | karpenter 문서: "the more PDBs there are affecting a Node, the more difficult it will be for Karpenter to find an opportunity to perform voluntary disruption actions." | 공식 인용(karpenter) |
| spot 회수 1건당 영향 파드가 늘어난다 | 위 blast radius 경고 + karpenter의 `SpotToSpotConsolidation` 기본 비활성·단일 노드 교체 시 최소 15개 인스턴스 타입 요구·회수 2분 통지 | ⚠️ **추론** — 둘을 정량 비교한 문서는 없다 |

전환해도 즉시 효과는 없습니다. "The Kubernetes scheduler never relocates a pod that is already running. Changing the scoring strategy affects future scheduling decisions only." AWS의 후속 안내는 "To rebalance pods that are already running, evict or restart them."입니다. descheduler(`HighNodeUtilization`)가 이 재조정에 필수인지는 단정할 근거가 없습니다. 흔히 인용되는 `descheduler#749`는 2022년 이슈이고 stale 봇이 닫았으며 최신 버전 유효성은 확인되지 않았습니다. **"기존 파드는 옮겨지지 않으므로 재조정이 필요할 수 있다"**까지가 안전선입니다.

과거 EKS에서 `MostAllocated`를 쓰려면 커스텀 스케줄러를 직접 운영해야 했습니다. ClickHouse가 공개한 사례(노드 약 10% 감소, EC2 비용 20%+ 절감, 활용률 50%→70%)도 커스텀 스케줄러 기반이었습니다. 거기에는 실패담도 함께 실려 있습니다. 기본 스케줄러와 커스텀 스케줄러 사이에 프리엠션이 서로 작동하지 않아 오버프로비저닝 파드까지 커스텀 쪽으로 통일해야 했습니다. 이번 발표는 관리형 kube-scheduler 자체의 설정을 바꾸는 것이라 스케줄러를 둘로 나눠 쓰면서 생기던 프리엠션 불일치가 **원천적으로** 사라집니다. 절감 수치보다 이쪽이 더 큰 변화입니다.

### 3.2 kube-apiserver — eventTtl

축소 동기는 명확합니다. "Clusters running high-churn workloads, such as **large-scale batch jobs, AI workloads, CI/CD pipelines, and frequent CronJobs**, accumulate thousands of events quickly." 2022년 AWS 블로그가 "Amazon EKS keeps the Kubernetes upstream default event TTL of 60 minutes, **which can't be changed**"라고 적어 둔 것이 이번에 뒤집혔습니다.

함정은 여기서 나옵니다.

1. **신규 이벤트에만 적용됩니다.** 기존 이벤트는 생성 시점 TTL로 만료되므로 스토리지 회수가 점진적입니다. 바꾸고 나서 etcd 크기가 즉시 줄지 않는 것이 정상입니다.
2. **삭제된 이벤트는 복구할 수 없습니다.** 축소는 외부 보존 파이프라인이 **이미 돌고 있다는 전제**에서만 안전합니다.
3. **설정한 기간보다 살짝 더 오래 남을 수 있습니다.** AWS 원문은 이렇습니다. "Events can persist slightly beyond the configured period ... because of etcd lease renewal that might happen during control plane leader election."

3번은 표현을 그대로 옮겼지만 오픈소스 코드에서 이 메커니즘의 근거는 **확인되지 않았습니다.** 이벤트 TTL 만료는 kube-apiserver → etcd lease 경로로만 구현돼 있습니다(`pkg/registry/core/event/storage/storage.go:36-41` → `staging/.../etcd3/lease_manager.go`). kube-controller-manager의 leader election과는 코드 경로상 연결점이 없습니다. 업스트림에 실재하는 유사 현상은 **lease 재사용 최적화**입니다. 같은 TTL의 이벤트들을 하나의 lease에 묶으려고 `min(60s, TTL의 5%)`를 덧붙여 lease를 발급하므로(`lease_manager.go:28-29, 85-113`) 개별 이벤트의 실제 삭제가 설정값보다 수십 초 늦어질 수 있습니다. AWS 문구가 관리형 구현의 비공개 디테일을 가리키는 것일 수도 있어 어느 쪽이라 단정하지 않습니다. 실무 결론은 같습니다. eventTtl은 **하드 데드라인이 아닙니다.**

1차 문서에는 "이벤트가 etcd를 채워 API 서버 성능을 떨어뜨릴 위험"이라는 정성적 서술만 있습니다. 60분 유지가 실제 etcd의 몇 %를 차지하는지는 AWS 문서·블로그 어디에도 없습니다. 그러니 축소 판단은 자기 클러스터의 **`apiserver_storage_size_bytes` 실측**으로 해야 합니다.

### 3.3 kube-apiserver — serviceNodePortRange

기본 범위 30000~32767은 **2768개 슬롯**입니다. 실제 압박은 자체관리 k8s에서 EKS로 이전하는 쪽에서 여러 번 나왔습니다. 백로그 `#1361` 코멘트에 "the default limits the number that we can do to ~2K containers. (We need to be able to do 10x that...)", "We want to move from self managed k8s to EKS and this limitation is creating problem for us."라고 적혀 있습니다. AWS PM이 이번 발표 링크로 명시적으로 close한 유일한 이슈입니다.

| 방향 | 무엇이 일어나는가 | 선행 작업 |
|---|---|---|
| **확대**(하한을 10260 쪽으로) | 슬롯이 최대 22,508개까지 늘어납니다 | ⚠️ **SG·NACL이 새 범위를 허용하는지 먼저 확인.** NLB `target-type: instance`는 트래픽이 실제로 노드 NodePort로 들어오므로 노드 SG에 새 범위 전체를 열어야 합니다. 노드의 다른 소프트웨어 포트와 충돌하지 않는지도 확인 |
| **축소** | 기존 서비스는 포트를 그대로 유지합니다 | 재생성 시점에 범위 밖 포트를 못 받습니다. 명시적 `nodePort` 지정도 범위 검증을 받습니다 |

축소해도 기존 서비스가 살아 있는 이유는 업스트림 Repair 컨트롤러의 동작에서 나옵니다. 새 범위로 할당기를 재구축하면서 범위 밖 포트를 만나면 `PortOutOfRange` Warning 이벤트만 발생시키고 Service 객체는 건드리지 않습니다(`portallocator/controller/repair.go:147-149, 177-181`). 삭제도, `spec.ports[].nodePort` 강제 변경도 없습니다. kube-proxy는 할당기 상태가 아니라 Service 오브젝트의 `nodePort`를 직접 읽어 규칙을 만들기 때문에 포워딩은 계속 동작합니다. 그 포트는 할당기가 추적하지 않는 상태로 남습니다. 다른 서비스가 재사용하려 해도 `AllocateNext`가 애초에 범위 밖을 뽑지 않습니다.

가장 자주 놓치는 함정은 `allocateLoadBalancerNodePorts`입니다.

- `Service.spec.allocateLoadBalancerNodePorts`의 **기본값은 `true`**입니다. 그래서 LoadBalancer 타입 서비스는 **`target-type: ip`를 쓰더라도** 명시적으로 `false`로 두지 않으면 NodePort를 계속 할당해 슬롯을 소비합니다. 트래픽이 그 포트를 타지 않아도 슬롯은 줄어듭니다.
- 반대로 NLB instance 모드에서 `false`로 두면 AWS Load Balancer Controller가 **reconcile에 실패합니다**(LBC 공식 문서 명시). `ip` 모드에는 해당하지 않습니다.

이 스위치는 "쓰지 않는 포트를 아끼는 최적화"와 "LBC를 깨뜨리는 설정"이 같은 필드에 붙어 있는 구조입니다. 서비스별 target-type을 확인한 뒤에만 만져야 합니다.

### 3.4 kube-controller-manager — HPA syncPeriod

이 파라미터만 **Provisioned Control Plane이 전제**입니다. 이 페이지에서 가장 위험한 항목이기도 합니다. 손잡이부터 구분해야 합니다.

| 손잡이 | 무엇인가 | 어떻게 정해지나 |
|---|---|---|
| **sync period**(이번에 열린 것) | HPA 컨트롤러가 스케일 판단을 **얼마나 자주** 하는가 | 10s~15s, 사용자 설정 |
| **sync concurrency**(파라미터 아님) | 컨트롤러 매니저가 HPA 오브젝트를 **몇 개 병렬로** 처리하는가 | Provisioned CP 티어가 자동 부여(XL 50 · 2XL 100 · 4XL/8XL 200). **업스트림 기본값은 5** |

concurrency는 2026-07-28에 별도로 확대된 것이고 전 Provisioned 클러스터에 자동 적용돼 설정할 것이 없습니다(→ [Provisioned Control Plane]({{< relref "03-provisioned-control-plane.md" >}})). 8XL의 200 ÷ 업스트림 5 = 40배입니다. 그 발표의 "up to 40x"와 정합합니다.

sync period 쪽 메커니즘은 코드에서 명확합니다. `processNextWorkItem()`이 reconcile 후 큐에 다시 넣는 구조라(`pkg/controller/podautoscaler/horizontal.go:356-368`, "Requests spend resyncPeriod in queue so HPAs are processed every resyncPeriod") HPA 오브젝트 하나당 period 간격으로 reconcile이 재실행됩니다. reconcile 한 번마다 metrics 조회와 Scale 서브리소스 접근이 따라붙습니다. 그래서 apiserver 요청량은 **HPA 개수 × (1/period)**에 선형 비례합니다.

정량 영향은 1차로 확인됩니다. "Reducing the period from 15s to 10s lowers the supported object count by **roughly one third**." 왜 10초가 하한인지는 **AWS 어디에도 근거가 없습니다.** 산출식도 부하 테스트 수치도 공개되지 않았습니다.

의도와 정반대 결과가 나올 수 있습니다. 이 파라미터의 가장 큰 함정입니다.

> "EKS doesn't validate the sync period against your HPA object count. The configuration change succeeds even if your cluster already has more HorizontalPodAutoscaler objects than the shorter period supports... Exceeding the supported count degrades autoscaling silently... EKS doesn't emit an alarm or a Kubernetes event for this condition... If you observe delayed scaling after shortening the sync period, return the parameter to the default of 15s."

주기를 줄여 반응을 빠르게 하려 했는데 오히려 느려집니다. 그 사실을 알려주는 경보도 이벤트도 없습니다. 줄여도 소용없는 경우까지 있습니다.

| 상한을 거는 요소 | 내용 |
|---|---|
| **metrics-server** | 기본 `--metric-resolution`이 15초입니다. HPA가 10초마다 돌아도 새 값이 15초에 한 번만 생기면 상당수 reconcile은 같은 스냅샷을 다시 읽습니다. AWS도 같은 얘기를 합니다 — "If your metrics source cannot serve requests fast enough, reconciliations slow down regardless of how many are processed in parallel." |
| **scaleDown stabilization** | HPA v2 `behavior.scaleDown.stabilizationWindowSeconds` 기본값이 5분입니다. syncPeriod를 줄여도 스케일다운은 이 윈도우가 지배합니다. 실효는 **scaleUp 반응성에만** 걸립니다 |
| **KEDA** | KEDA는 자체 폴링 루프(`pollingInterval`)로 외부 메트릭을 조회하고 그 결과로 내부 HPA를 갱신합니다. syncPeriod를 줄이면 컨트롤러 매니저가 KEDA가 만든 HPA를 더 자주 들여다볼 뿐, **KEDA가 더 자주 조회하지는 않습니다** |

판단 절차는 문서가 제시한 대로가 맞습니다. 먼저 `kubectl get hpa --all-namespaces --no-headers | wc -l`로 개수를 센 다음 `workqueue_depth{name="horizontalpodautoscaler"}`를 봅니다. 이 큐 깊이가 이미 0 근처라면 애초에 컨트롤 플레인이 병목이 아니었다는 뜻입니다. 축소는 아무 이득이 없습니다.

참고로 EKS가 연 것은 **sync-period 하나뿐입니다.** 같은 코드 블록(`options/hpacontroller.go:33-41`)에 있는 `downscale-stabilization`(기본 5m)·`tolerance`·`cpu-initialization-period`(5m)·`initial-readiness-delay`(30s)는 EKS API에 없습니다. 위 표에서 스케일다운 지연의 주범인 `downscale-stabilization`은 안 열렸습니다. "HPA 반응성을 원하는데 열린 손잡이는 반응성과 가장 약하게 연결된 쪽"이라는 구도가 여기서 나옵니다. 닫힌 플래그 정리는 [레이어 3]({{< relref "04-not-tunable.md" >}})이 이어받습니다.

## 4. cpu/memory 가중치를 노드 비율에 맞게 줄 수 있나

karpenter가 c계열(cpu:mem 1:2)·m계열(1:4)·r계열(1:8)을 섞어 띄우는 클러스터라면 질문이 이렇게 나옵니다. "노드 모양이 다양한데 가중치를 그 비율에 맞게 줘야 하나." **필요 없습니다.** 그리고 하고 싶어도 이 파라미터로는 못 합니다.

### 4.1 점수 공식이 이미 노드 비율로 정규화한다

§3.1의 공식을 다시 보면 각 항이 **그 노드 자신의 `allocatable`로 나뉩니다.** requested가 절대량으로 비교되는 자리가 없습니다. 그래서 c5.4xlarge와 r5.4xlarge가 같은 후보 집합에 있어도 각 노드는 **자기 용량 대비 비율**로 채점됩니다. 점수는 둘 다 0~100 스케일에 놓입니다. 정규화가 공식에 내장돼 있으니 "노드의 cpu/memory 비율에 맞춰 가중치를 조정한다"는 작업은 공식 안에서 이미 끝나 있어 따로 할 일이 없습니다.

### 4.2 가중치가 실제로 정하는 것은 병목 자원이다

하고 싶어도 못 합니다. `resources[]`는 **클러스터 전역 단일 설정**입니다. AWS 문서 원문은 이렇습니다. "Control plane parameters apply to the whole cluster and to all workloads running on it. You can't scope them to individual namespaces or workloads." NodePool별·인스턴스 패밀리별·네임스페이스별 차등 부여는 불가능합니다.

그래서 가중치는 **어느 차원이 패킹을 주도할지**를 정합니다. 노드 모양을 정하는 손잡이가 아닙니다. 설정 기준을 "노드 비율"에서 찾으면 헛짚습니다. 물어야 할 것은 **무엇이 이 클러스터의 병목 자원인가**입니다. AWS 문서의 GPU 예시가 이 논리입니다. 가속기가 희소 자원인 클러스터에서 `nvidia.com/gpu`를 cpu·memory보다 높게 주면 가속기를 요구하는 파드가 이미 일부 점유된 노드로 모입니다. 가중치는 **상대값**입니다. `cpu:100, memory:1`은 memory를 무시하지 않습니다. cpu를 100배 더 볼 뿐입니다. 모든 후보 노드의 cpu 여유가 동일하면 cpu가 노드를 구별하지 못해 사실상 memory가 결정합니다(AWS 문서).

### 4.3 생략은 낮은 가중치가 아니다

분모는 `Σ(weight_i)`, 곧 **명시한 리소스들의 가중치 합**입니다. 이 점이 결정적입니다.

| 설정 | memory의 영향 |
|---|---|
| `resources` 생략 | 기본값 cpu:1 / memory:1 적용 → memory가 점수의 50%를 지배 |
| `cpu:100, memory:1` | memory가 1/101만큼 여전히 점수에 개입한다 |
| `cpu:1`만 명시 | memory가 **분모에서도 빠져** 점수에 전혀 개입하지 않습니다 |

`weight`의 최소값이 1이라 "가중치 0으로 무시"는 애초에 표현할 수 없습니다. 리소스를 점수에서 완전히 빼겠다면 **생략** 말고는 방법이 없습니다. 영향을 줄이고 싶으면 빼지 말고 낮은 가중치로 나열해야 합니다.

여기에 코드에서만 보이는 안전장치가 하나 있습니다. `allocatable[i] == 0`이면 그 항은 스킵되고 **`weightSum`에서도 빠집니다**(`least_allocated.go:34-36` — `if allocable[i] == 0 { continue }`가 `weightSum += weight` 앞에 있습니다). `nvidia.com/gpu: 100`을 줘도 GPU 없는 노드는 GPU 항 없이 cpu/memory만으로 채점됩니다. GPU 가중치가 비-GPU 노드의 점수를 **깎지 않습니다.** 가속기 가중치를 클러스터 전역에 걸어도 안전한 이유가 이 스킵입니다. AWS 문서는 같은 결과를 "가속기 가중치는 실제로 그 자원을 `resources.requests`에 선언한 파드의 스코어링에만 영향을 준다"는 표현으로 서술합니다. 코드 근거(allocatable==0 스킵)와 문서 표현(requests 기준)은 층이 다르므로 둘을 같은 문장으로 뭉개지 않습니다.

### 4.4 karpenter는 이 설정을 읽지 않는다

karpenter-core `ac7a021e`(`v1.14.0-6`) 전체를 훑었습니다.

```bash
grep -rniE 'scoringStrategy|KubeSchedulerConfiguration|nodeResourcesFit|MostAllocated|LeastAllocated' \
  --include='*.go' .
# → 0건 (테스트 포함/제외 모두)
```

karpenter는 EKS에 설정한 kube-scheduler scoring 전략을 **읽지 않습니다.** 자체 스케줄링 시뮬레이션(`pkg/controllers/provisioning/scheduling/`)으로 인스턴스 타입을 고릅니다. `scheduler.go:845`의 `sortExistingNodes()`는 초기화된 노드를 먼저 두는 자체 정렬이고 스케줄러 점수와 무관합니다. 두 계층의 역할은 이렇게 나뉩니다.

| 상황 | scoringStrategy의 영향 |
|---|---|
| 프로비저닝을 유발한 파드 | 거의 없습니다 — karpenter가 그 파드에 맞춰 띄운 신규 노드에 앉습니다 |
| **이미 있는 노드 중에서 고를 때** | **실제로 작동하는 구간** |
| consolidation과의 관계 | **상보적** — MostAllocated가 덜 쓰는 노드에 신규 파드를 주지 않으면 그 노드가 비어가고 consolidation이 걷어낸다("this packing behavior keeps lightly used nodes free of new workloads, so node pools that support consolidation can remove them") |
| churn 위험 | 기존 노드를 더 빡빡히 채우므로 파드 churn이 높으면 Pending이 늘 수 있습니다(AWS 명시) |

karpenter 코어 메인테이너(jonathan-innis)도 2024년 이슈 `kubernetes-sigs/karpenter#1228`에서 따로 같은 방향을 말했습니다. 헤지를 붙인 추측이라는 점까지 그대로 옮깁니다. "**I suspect that you are right about the performance, at least that** we would be able to act more aggressively with consolidation since we'd have '**less cluster churn**' disrupting our current consolidation decision-making." 메인테이너의 추측이며 단정이 아닙니다. AWS 쪽도 "Validate the combined behavior for your workload"까지만 말합니다. MostAllocated × karpenter 조합의 정량 벤치마크는 **존재하지 않습니다.**

### 4.5 NodePool별 차등이 필요하면 다른 수단이다

이 파라미터로는 불가능합니다. 대안의 성격은 서로 다릅니다.

- karpenter NodePool 설계 — 인스턴스 패밀리 제약 + 워크로드 nodeAffinity로 "어떤 워크로드가 어떤 모양의 노드에 가는가"를 NodePool 경계로 표현합니다. 가중치 대신 후보 집합 자체를 나누는 접근입니다.
- 자체 스케줄러 배포 — 별도 scheduling profile을 담은 두 번째 스케줄러를 띄우고 파드에 `schedulerName`을 지정합니다. 클러스터 내부 우회 수단이므로 [레이어 3]({{< relref "04-not-tunable.md" >}})이 다룹니다. §3.1이 언급한 프리엠션 불일치 문제가 여기서 되살아납니다. 이것도 함께 기억해야 합니다.

**이름 충돌 경고.** karpenter NodePool에도 `weight` 필드가 있습니다. 이 필드는 **NodePool 선택 우선순위**이고 이 scoring `resources[].weight`와는 **완전히 다른 개념**입니다. 같은 클러스터의 두 YAML에 같은 이름의 필드가 다른 의미로 앉아 있으므로 리뷰에서 반드시 구분해 읽어야 합니다.

### 4.6 비율 좌초를 줄이는 플러그인은 이미 켜져 있고, 열리지 않았다

"파드 모양과 노드 모양을 맞춰 좌초(stranding)를 줄이는" 동작을 기대하고 이 파라미터를 찾아오는 경우가 많습니다. 그 동작은 다른 플러그인이 맡고 기본 profile에 이미 들어 있습니다. `nodeResourcesFit`의 일이 아닙니다.

```go
// pkg/scheduler/apis/config/v1/default_plugins.go:43,51
{Name: names.NodeResourcesFit, Weight: ptr.To[int32](1)},
{Name: names.NodeResourcesBalancedAllocation, Weight: ptr.To[int32](1)},
```

`NodeResourcesBalancedAllocation`은 파드를 놓은 뒤 **cpu·memory 사용 비율이 서로 가까워지는지**로 점수를 매깁니다. `balanced_allocation.go:204-218` 주석이 범위를 직접 서술합니다. 균형이 개선되면 100 쪽으로, 나빠지면 50 쪽으로, 변화가 작으면 75 근처입니다. 좌초를 줄이는 shape-aware 배치는 이미 기본으로 돌아갑니다. 가중치도 `nodeResourcesFit`과 **동일한 1**입니다.

EKS는 이 플러그인의 가중치를 **열지 않았습니다.** 열린 것은 `nodeResourcesFit`의 scoring 전략뿐입니다. 원하는 동작은 이미 켜져 있는데 그 켜진 쪽을 조정할 창구가 없습니다. 이 축에는 튜닝할 여지가 남지 않습니다.

여기서 실제로 조심할 것이 하나 나옵니다. 인스턴스 패밀리가 섞인 플릿에서 `MostAllocated`는 **좌초를 악화시킬 수 있습니다.** 메모리가 무거운 파드(1 vCPU / 8 GiB)를 빈 c계열(16 vCPU / 32 GiB)과 빈 m계열(16 vCPU / 64 GiB)에 놓아 보겠습니다. §3.1의 공식으로 계산하면 방향이 반대로 나옵니다.

| 전략 | c계열 점수 | m계열 점수 | 고르는 노드 |
|---|---|---|---|
| `LeastAllocated`(기본) | (93.75 + 75) / 2 = 84.4 | (93.75 + 87.5) / 2 = **90.6** | m계열 |
| `MostAllocated` | (6.25 + 25) / 2 = **15.6** | (6.25 + 12.5) / 2 = 9.4 | **c계열** |

`MostAllocated`는 파드가 더 많이 채우는 노드를 선호하므로 메모리 무거운 파드를 **메모리가 빡빡한 c계열로 보냅니다.** 비율 정합의 반대 방향입니다. 기본으로 켜진 `NodeResourcesBalancedAllocation`과도 서로 반대되는 신호를 냅니다. 두 플러그인이 같은 가중치라 힘이 상쇄되는 구간이 생깁니다.

실무 결론은 여기서 나옵니다.

패밀리가 섞인 NodePool에서 `MostAllocated`를 켤 때는 **좌초와 파편화를 함께 측정**해야 합니다. 노드 대수만 보면 개선으로 보이는데 좌초가 늘어날 수 있습니다.

비율 정합을 원한다면 그 레버는 **karpenter의 인스턴스 타입 선택**입니다(§4.4). 스케줄러 쪽에는 없습니다. karpenter는 pending 파드 배치의 합산 request를 보고 인스턴스를 고릅니다. 그래서 한 NodePool에 여러 패밀리를 허용해 두면 karpenter가 배치 단위로 비율이 맞는 패밀리를 집습니다. 단일 패밀리로 좁혀 두면 그 적응력을 끕니다. 반대로 넓히면 노드 모양이 불균일해져 topologySpread·PDB 운영이 복잡해집니다. 어느 쪽이든 스케줄러 가중치가 결정하는 문제가 아닙니다.

## 5. 어떻게 설정하나

### 5.1 최상위 JSON — 래퍼는 없다

세 필드는 `controlPlaneConfig` 같은 상위 래퍼 아래 있지 않고 `resourcesVpcConfig`·`kubernetesNetworkConfig`와 같은 레벨의 **최상위 필드**입니다. `CreateCluster` 요청, `UpdateClusterConfig` 요청, `Cluster` 응답 세 곳 모두 동일합니다. Provisioned CP의 `controlPlaneScalingConfig`도 최상위입니다.

```json
{
  "kubeApiServerConfig": {
    "eventTtl": "10m",
    "serviceNodePortRange": { "minPort": 10260, "maxPort": 32767 }
  },
  "kubeControllerManagerConfig": {
    "horizontalPodAutoscalerControllerConfig": {
      "horizontalPodAutoscalerSyncPeriod": "10s"
    }
  },
  "kubeSchedulerConfig": {
    "nodeResourcesFit": {
      "scoringStrategy": {
        "type": "MostAllocated",
        "resources": [ { "name": "cpu", "weight": 1 }, { "name": "memory", "weight": 1 } ]
      }
    }
  },
  "controlPlaneScalingConfig": { "tier": "tier-xl" }
}
```

### 5.2 CLI

플래그는 컴포넌트별로 독립이고 `create-cluster`·`update-cluster-config`가 같은 4개를 받습니다. 값은 **그 키의 "값"만** 넘깁니다(키를 다시 감싸지 않습니다).

```bash
# 스케줄러 전략만
aws eks update-cluster-config --name "$CLUSTER" \
  --kube-scheduler-config '{"nodeResourcesFit":{"scoringStrategy":{"type":"MostAllocated"}}}'

# 여러 컴포넌트 동시 — merge 시맨틱이라 지정 안 한 필드는 현재값 유지
aws eks update-cluster-config --name "$CLUSTER" \
  --kube-scheduler-config '{"nodeResourcesFit":{"scoringStrategy":{"type":"MostAllocated"}}}' \
  --kube-api-server-config '{"eventTtl":"30m"}'

# NodePort 범위 확대
aws eks update-cluster-config --name "$CLUSTER" \
  --kube-api-server-config '{"serviceNodePortRange":{"minPort":10260,"maxPort":32767}}'

# HPA sync period — Provisioned CP 필요
aws eks update-cluster-config --name "$CLUSTER" \
  --kube-controller-manager-config \
  '{"horizontalPodAutoscalerControllerConfig":{"horizontalPodAutoscalerSyncPeriod":"10s"}}'
```

shorthand 문법도 지원합니다. `nodeResourcesFit={scoringStrategy={type=string,resources=[{name=string,weight=integer}]}}`. 조회는 이렇게 합니다.

```bash
# 현재 적용값 — 커스터마이즈 안 한 파라미터도 기본값이 채워져 나온다
aws eks describe-cluster --name "$CLUSTER" --query 'cluster.kubeSchedulerConfig'

# 버전별 기본값·허용범위 (IaC에 하드코딩하지 말고 여기서 뽑는다)
aws eks describe-cluster-versions --cluster-versions 1.35 \
  --query 'clusterVersions[0].controlPlaneComponentConfig'
```

**CLI를 올려야 플래그가 보입니다.** 이 4개 플래그는 **aws-cli v2 2.36.21**에서 추가됐습니다(aws-cli CHANGELOG.rst 기준, 2026-08 기준 최신은 2.36.23). 조사 환경의 로컬 CLI 2.27.5는 `update-cluster-config help`·`create-cluster help` 전체 출력에서 네 문자열이 **하나도 나오지 않았습니다**(grep 0건). SDK 레벨(botocore)에는 이미 반영돼 있으니 "플래그가 없다"는 증상은 거의 항상 CLI 버전 문제입니다.

### 5.3 Terraform

**필요 최소 버전 `hashicorp/aws >= 6.59.0`.** `control_plane_scaling_config`만 쓸 거라면 v6.23.0으로도 됩니다.

```hcl
resource "aws_eks_cluster" "blue" {
  name     = "prod-finance-blue"
  role_arn = aws_iam_role.cluster.arn
  version  = "1.35"

  vpc_config { subnet_ids = var.blue_private_subnet_ids }

  kube_api_server_config {
    event_ttl = "10m"
    service_node_port_range {
      min_port = 10260
      max_port = 32767
    }
  }

  kube_scheduler_config {
    node_resources_fit {
      scoring_strategy {
        type = "MostAllocated"

        # 주의: 블록명이 단수 "resource"다 — API의 "resources" 배열과 이름이 다르다
        resource {
          name   = "cpu"
          weight = 1
        }
        resource {
          name   = "memory"
          weight = 1
        }
      }
    }
  }

  kube_controller_manager_config {
    horizontal_pod_autoscaler_controller_config {
      horizontal_pod_autoscaler_sync_period = "10s" # tier-xl 이상 필요
    }
  }

  control_plane_scaling_config {
    tier = "tier-xl" # standard | tier-xl | tier-2xl | tier-4xl | tier-8xl
  }
}
```

data source도 같은 릴리스에 함께 들어왔습니다. `data.aws_eks_cluster`가 3개 블록을 읽기 속성으로 다루고 `data.aws_eks_cluster_versions`가 `control_plane_component_config`·`control_plane_scaling_tiers`를 노출합니다. 위 `describe-cluster-versions` 조회를 HCL 안에서 그대로 할 수 있습니다. 현재 IaC의 provider constraint가 `>= 6.59.0`을 만족하는지는 **확인 필요**로 남습니다.

### 5.4 CloudFormation

`AWS::EKS::Cluster`에 PascalCase로 들어와 있고 **전부 `Update requires: No interruption`**입니다.

```yaml
Type: AWS::EKS::Cluster
Properties:
  Name: prod-finance-blue
  RoleArn: !GetAtt ClusterRole.Arn
  ResourcesVpcConfig:
    SubnetIds: !Ref BluePrivateSubnets
  KubeApiServerConfig:
    EventTtl: "10m"
    ServiceNodePortRange:
      MinPort: 10260
      MaxPort: 32767
  KubeSchedulerConfig:
    NodeResourcesFit:
      ScoringStrategy:
        Type: MostAllocated
  ControlPlaneScalingConfig:
    Tier: tier-xl
```

`KubeControllerManagerConfig`도 같은 레벨의 프로퍼티로 존재합니다(HPA sync period를 쓸 때만 필요하므로 위 예시에서는 생략했습니다). 최상위 4개 프로퍼티 이름은 원문에서 직접 확인했습니다. `EventTtl`·`NodeResourcesFit` 같은 하위 프로퍼티의 정확한 대소문자는 CFN 표기 관례에서 역산한 것이라 서브 페이지로 재확인이 필요합니다.

### 5.5 업데이트 추적

| 항목 | 값 |
|---|---|
| 파라미터 변경 update type | **`ControlPlaneComponentConfigUpdate`** |
| 티어 변경 update type | **`ControlPlaneScalingConfigUpdate`**(`API_Update.html` enum 기준) |
| ⚠️ 표기 불일치 | Provisioned CP User Guide 본문은 같은 것을 **`ScalingTierConfigUpdate`**라고 쓴다 |
| `update.status` | `InProgress` \| `Failed` \| `Cancelled` \| `Successful` |
| 진행 중 클러스터 status | `UPDATING`(eventually consistent) |
| 완료 후 | 성공·실패 무관하게 `ACTIVE`로 복귀. 실패 시 `update.errors[]`에 `errorCode`·`errorMessage`·`resourceIds` |

```bash
aws eks list-updates --name "$CLUSTER"
aws eks describe-update --name "$CLUSTER" --update-id "$UPDATE_ID"
aws eks wait cluster-active --name "$CLUSTER"   # 블로킹 대기
```

getting-started 가이드의 전제조건은 "describe and update Amazon EKS clusters 권한"뿐입니다. API Reference의 에러 목록 어디에도 이 기능 전용 액션이나 조건 키가 없습니다. **IAM은 새 액션이 없는 것으로 보입니다.** 기존 `eks:UpdateClusterConfig`·`eks:DescribeCluster`·`eks:DescribeClusterVersions`로 충분하다는 뜻인데 정책 시뮬레이터로 직접 검증하지는 못했습니다. 동시 업데이트 규칙도 확정하지 않습니다. `UpdateClusterConfig`의 공통 에러에 `ResourceInUseException`(409)이 있으나 다른 타입의 업데이트와 병행 가능한지를 명시한 문장은 문서에 없습니다.

## 6. 도구별 지원 현황 — AWS 문서와 실제가 어긋난다

이 표가 이 페이지의 특종입니다. 2026-08-14 재확인 기준입니다.

| 도구 | AWS 문서가 하는 말 | 실제(2026-08-14) | 최소 버전 |
|---|---|---|---|
| Console · EKS API | "at launch" | 일치 | — |
| **AWS CLI** | "at launch" | 일치. 단 **CLI를 올려야 플래그가 보인다** | **aws-cli v2 2.36.21+** |
| **CloudFormation** | "at launch" | 일치. PascalCase 확정, 전부 No interruption | — |
| ⚠️ **Terraform** | User Guide는 2026-08-14 재확인 시점에도 **"Support for ... Terraform is coming soon"** | **이미 지원.** provider **v6.59.0**(2026-08-12, 발표 당일) PR #49412가 3개 블록을 쓰기 가능하게 추가. data source도 동시(#49420/#49421) | **`hashicorp/aws >= 6.59.0`** |
| ⚠️ **eksctl** | User Guide: **"eksctl ... at launch"** / 같은 날 Containers 블로그: **"with support for eksctl ... planned"** | **GA 릴리스로는 못 씁니다.** 최신 GA는 **v0.229.0**(2026-07-01)로 이 기능 이전. 소스에는 PR #8821(머지 **2026-08-12T21:34:25Z**)로 들어왔고 이를 담은 태그는 **v0.230.0-rc.0**(프리릴리스, 2026-08-13)뿐 | GA 대기(또는 소스 빌드·rc 바이너리) |
| ⚠️ **AWS CDK** | "CDK at launch" | **4개 파라미터 미지원** — aws-cdk 저장소 전체 코드 검색 0건. `controlPlaneScalingTier`(Provisioned CP 티어)만 지원(PR #36651 머지 2026-07-29, `aws-cdk-lib` 2.263.0+에서 enum 실물 확인) | L1 `CfnCluster` escape hatch |
| ACK | "coming soon" | 미확인 | — |

- Terraform은 문서가 과소평가합니다. "coming soon"을 믿고 awscc 프로바이더 우회나 CloudFormation 스택 경유를 설계하면 헛수고입니다. 네이티브 지원이 발표 당일부터 있었습니다.
- eksctl과 CDK는 문서가 과대평가합니다. 특히 eksctl은 AWS 1차 문서 두 개가 **정면으로 어긋납니다.** User Guide는 "at launch", 같은 날 Containers 블로그는 "planned". 커뮤니티의 오해가 아니라 AWS 공식 자료 간 불일치입니다. 실물(태그·릴리스)을 확인하면 블로그 쪽이 맞습니다.
- AWS 문서의 툴링 지원 문구는 근거로 쓰지 말고 **provider 릴리스 노트와 GA 태그**를 직접 봅니다.

이름 표기가 어긋나는 자리도 있습니다.

| 도구 | 어긋나는 지점 |
|---|---|
| Terraform | scoring 리소스 블록이 **단수 `resource`**(반복 블록). API의 `resources` 배열과 이름이 다르다 |
| eksctl | eksctl은 `kubeAPIServerConfig`·`eventTTL`, AWS API는 `kubeApiServerConfig`·`eventTtl`. **대소문자가 다르다** — YAML을 손으로 옮겨적을 때 틀리는 자리다 |

## 7. 범위 수치를 티어 무관 고정값으로 읽지 마라

`describe-cluster-versions` 응답에는 버전별 기본값·제약을 담은 `controlPlaneComponentConfig` 옆에 `controlPlaneScalingTiers[]` 배열이 있습니다. 그 원소 안에 **`controlPlaneComponentConfigOverrides`**가 들어 있습니다.

```json
{
  "controlPlaneScalingTiers": [{
    "tierName": "string", "apiRequestConcurrency": 0,
    "podSchedulingRatePerSecond": 0, "clusterDatabaseSizeGb": 0,
    "controlPlaneComponentConfigOverrides": { "…동일 구조, 티어별 override…": {} }
  }]
}
```

구조상 같은 파라미터의 `defaultValue`나 `constraints`가 **티어에 따라 달라질 수 있다**는 뜻입니다. HPA syncPeriod 하한처럼 용량과 직결된 값이 가장 그럴 법한 후보입니다. 그런데 **여기까지가 스키마 확인 사실입니다.** 실제로 어떤 파라미터가 어떤 티어에서 어떻게 달라지는지는 실물 응답으로 확인되지 않았습니다. 단정하지 않습니다.

그래서 §1.1의 범위 수치를 "티어 무관 고정값"으로 읽으면 안 됩니다. IaC에 하드코딩하는 대신 **실제로 쓸 버전·티어 조합으로 조회해서 확인**해야 합니다(§5.2의 `describe-cluster-versions`, 또는 `data.aws_eks_cluster_versions`).

## 8. 우리 클러스터 적용 판정 — 4개를 어떻게 나누나

### 8.1 파라미터별 판정

| 파라미터 | 판정 | 핵심 근거 |
|---|---|---|
| `scoringStrategy` = MostAllocated | **유일한 실제 후보. 단 blue 안정화 이후 별건** | karpenter consolidation과 상보. 정량 벤치마크가 없어 검증이 우리 몫이고, 효과가 파드 재배포 시점에 나타나 컷오버와 겹치면 원인 분리가 불가능해진다 |
| `serviceNodePortRange` | **기본값 유지** | 내부 ALB `target-type: ip`라 트래픽 경로에 NodePort가 없습니다. 확인할 것은 경로가 아니라 슬롯 개수입니다(§8.3) |
| `eventTtl` | **컷오버 이후 재검토** | 컷오버 창은 이벤트가 가장 필요한 구간입니다. 축소는 정확히 반대 방향입니다(§8.3) |
| HPA `syncPeriod` | ⚠️ **해당 없음** | 월 증분 +$1,204.50을 쓰고 얻는 5초가 KEDA·metrics-server·scaleDown 윈도우에서 대부분 소멸합니다(§8.3) |

### 8.2 MostAllocated 도입 선행조건

방향은 좋습니다. AWS 자신이 "packing이 유휴 노드를 만들어 consolidation이 걷어가게 한다"고 상보 관계를 명시합니다. karpenter 메인테이너도 헤지를 붙여 같은 방향을 말합니다(§4.4). finance는 [karpenter 1.14 전환]({{< relref "../components/01-karpenter.md" >}})에서 CRD v1beta1→v1을 어차피 해야 하므로 consolidation 설정을 손대는 창이 이미 열립니다. 그럼에도 컷오버와 같은 창에 넣지 않는 이유는 §8.1에 적었습니다. 그와 별개로 먼저 정리해야 할 선행조건이 있습니다.

| 선행 조건 | finance 현황 | 판정 |
|---|---|---|
| requests 정확도 | 밀집도와 karpenter 사이징이 둘 다 requests에 의존한다 | **선행 필수** — 부정확하면 두 레이어가 함께 오작동 |
| non-CPU requests=limits | consolidation은 limits를 보지 않는다 → 밀집 시 OOM 확률 상승 | **선행 필수**(EKS Best Practices 공식 권고) |
| PDB | 밀집 노드 교체 시 가용성 방어선 | **선행 필수** |
| zonal `topologySpreadConstraints` | karpenter는 AZ를 자체 재균형하지 않습니다. 노드 총수가 줄면 원래 완충됐던 편향이 장애로 드러납니다 | **파드 레벨 명시 필요** |
| spot 결합 | 밀집 × 회수 2분 통지 = 회수 1건당 영향 파드 증가 | ⚠️ **추론 영역** — 정량 근거 없음. spot 풀에는 나중에 |
| descheduler | 기존 파드 재배치 | **단정 불가.** "재조정이 필요할 수 있다"까지만 |

실익이 어디에 있는지도 미리 구분해 둡니다. system 풀(arm64)은 플랫폼 컴포넌트가 몰려 있고 노드 수가 적어 밀집의 실익이 작습니다. 실익이 있는 곳은 **workload 풀(amd64, service/airflow)**입니다. 그 풀이 memory-bound인지 cpu-bound인지 확인한 뒤 그 자원에 높은 가중치를 줍니다(§4.2). 확인 전에는 기본값 cpu:1 / memory:1이 안전값입니다.

CoreDNS·karpenter 컨트롤러가 Fargate에 있다는 사실도 리스크를 낮춥니다. Fargate 파드에는 "후보 노드들 사이의 상대 점수"라는 개념이 성립하지 않아 scoringStrategy의 대상이 아닙니다(Fargate의 파드-VM 1:1 구조 자체는 [클러스터 설정]({{< relref "../02-cluster-config.md" >}})이 다룹니다. 이 파라미터와 어떤 관계인지를 AWS 문서가 명시한 것은 아니므로 여기까지는 **추론**입니다). 그래서 blast radius 계산에서 CoreDNS와 karpenter 컨트롤러가 빠집니다. 밀집시킨 노드가 죽어도 DNS와 노드 프로비저너는 영향받지 않으니 **복구 경로가 데이터플레인 밖에 있습니다.** 일반적인 managed nodegroup 클러스터라면 "밀집 노드가 죽으면서 그 위의 CoreDNS까지 함께 날아가 복구가 더 느려진다"를 걱정해야 합니다. 이 토폴로지에서는 그 시나리오 자체가 성립하지 않습니다.

### 8.3 나머지 3개를 왜 접는가

**`serviceNodePortRange`.** 내부 ALB Ingress(`target-type: ip`)가 istio-ingressgateway 앞에 섭니다. 파드는 ALB 타깃으로 직접 등록되고 kube-proxy를 우회합니다. 트래픽 경로만 보면 "무관"이 답입니다. 그런데 슬롯 소비는 별개입니다. `allocateLoadBalancerNodePorts` 기본값이 `true`라서 LoadBalancer 타입 서비스는 `ip` 모드여도 슬롯을 하나씩 먹습니다(§3.3). 그래서 확인할 것은 **LoadBalancer 타입 서비스 개수**입니다. 2768 슬롯을 소진할 규모가 아니면 기본값 유지입니다. 축소는 이득이 없습니다. 확대는 SG·NACL 작업을 부르는데 내부 ALB 전제의 보안 baseline과 어긋납니다. "나중에 넓힐 일이 생길까 봐 미리 넓혀둔다"도 답이 아닙니다. 확대는 나중에도 무중단으로 가능하고 SG를 먼저 열어두는 쪽이 더 비쌉니다. 그래도 할 일 하나: **NLB instance 모드를 쓰는 서비스가 있는지 확인**합니다. 있으면 그 서비스에 `allocateLoadBalancerNodePorts: false`는 금지입니다. `istio-ingressgateway`가 ClusterIP인지 LoadBalancer인지, LoadBalancer 타입 서비스가 몇 개인지는 **확인 필요**로 남습니다.

**`eventTtl`.** 반출 경로 자체는 그림이 그려집니다. 이 블로그가 [HyperDX/ClickHouse 스택]({{< relref "../../hyperdx/_index.md" >}})을 운영하므로 `kubernetes-event-exporter` → OTLP → OpenTelemetry Collector `clickhouseexporter` → ClickHouse 경로가 가능합니다. AWS 문서가 직접 언급하는 도구도 `kubernetes-event-exporter`입니다. 문제는 순서입니다. 삭제된 이벤트는 복구할 수 없으므로 축소는 이 파이프라인이 이미 돌고 있을 때만 안전합니다. 그런데 blue-green에서 이벤트가 가장 필요한 시점이 **컷오버 구간**입니다. `FailedScheduling`·`FailedMount`·`Unhealthy`·`PortOutOfRange`가 이관 실패를 가장 먼저 알려주는 신호이고 60분 보존은 "장애를 인지하고 사람이 붙을 시간"에 대응합니다. 컷오버 창에서 TTL을 10분으로 줄이는 것은 진단 창을 좁히는 조작입니다. 축소 동기가 되는 워크로드 성격(대규모 배치·AI·CI/CD)도 finance와 거리가 있습니다. **판정:** 컷오버 이후 `apiserver_storage_size_bytes`를 실측하고 이벤트 반출이 붙은 뒤에만 재검토합니다.

**HPA `syncPeriod`.** 비용부터 보면 답이 거의 나옵니다. Standard $73/월이 XL $1,277.50/월이 되고 증분만 **월 +$1,204.50**입니다. prod·staging 두 클러스터에서 환경 일관성을 지키려면 증분이 두 배가 됩니다. 그 돈으로 얻는 것이 sync period 5초 단축인데 finance 스택에서는 그 5초조차 대부분 사라집니다. KEDA 2.20.1이 만든 HPA는 KEDA의 `pollingInterval`이 반응 지연을 지배합니다. metrics-server 0.9.0의 기본 `--metric-resolution`은 15초입니다. 스케일다운 지연의 주범인 `downscale-stabilization`은 애초에 열리지 않았습니다(§3.4). 여기에 **기본값이 아닌 동안 Standard로 못 돌아간다**는 복귀 제약까지 붙으므로 "일단 켜 보고 아니면 끈다"가 2단계 롤백이 됩니다(→ [Provisioned Control Plane]({{< relref "03-provisioned-control-plane.md" >}})). 먼저 볼 곳은 병목의 위치입니다. `workqueue_depth{name="horizontalpodautoscaler"}`가 0 근처라면 컨트롤 플레인은 애초에 병목이 아니었습니다. 그러면 체감 지연의 원인은 KEDA `pollingInterval`·metrics-server `metric-resolution`·`scaleDown.stabilizationWindowSeconds` 셋 중 하나입니다. 세 개 모두 **추가 비용 없이** 워크로드 쪽에서 조절할 수 있습니다.

## 9. 함정 정리

| # | 함정 | 무엇이 문제인가 | 대응 |
|---|---|---|---|
| 1 | **리셋 오퍼레이션이 없다** | 기본값으로 되돌리는 전용 API가 없다 | 기본값을 **명시적으로 설정**한다 |
| 2 | **merge 시맨틱** | 업데이트에서 생략한 필드는 지워지지 않고 현재값이 유지된다 | 부분 업데이트가 부분 롤백이 아니다. 되돌릴 필드를 명시 |
| 3 | **기본값을 IaC에 하드코딩하면 안 된다** | 기본값·제약이 k8s 버전마다, 어쩌면 티어마다 달라질 수 있다(§7) | `describe-cluster-versions`(또는 `data.aws_eks_cluster_versions`)로 조회 |
| 4 | **`describe-cluster`가 항상 값을 반환한다** | 커스터마이즈 안 한 파라미터까지 기본값이 채워져 나온다 | **응답만으로는 "우리가 무엇을 바꿨나"를 구분할 수 없다.** 변경 이력은 CloudTrail·IaC에서 본다 |
| 5 | **클러스터 전역** | namespace·워크로드 단위 스코핑이 불가능합니다 | 실험 단위가 클러스터입니다. 클러스터를 나눌 수 없으면 실험이 곧 프로덕션입니다 |
| 6 | **롤링 업데이트** | 수 분 소요. 컨트롤 플레인 교체 과정에서 API 서버 IP가 바뀌고 watch가 **끊길 수 있습니다** | `client-go` 기반 컨트롤러는 대개 자동 재연결됩니다. 다만 이 표현의 근거는 이번 기능 문서가 아니라 컨트롤 플레인 교체 전반을 서술한 re:Post의 "might be affected"이므로 단정하지 않습니다. **AWS 문서에 "maintenance window"라는 표현은 아예 없다** — 불필요하다고 단정할 근거도 없어 비프로덕션 선행 테스트 일반 권고를 따른다 |
| 7 | **HPA 역설** | 주기를 줄였는데 오토스케일이 **조용히** 느려진다. 경보·이벤트 없음 | 사전에 HPA 개수를 세고, 사후에 `workqueue_depth`를 본다. 느려지면 15s로 복귀 |
| 8 | **HPA 비기본값 = Standard 복귀 불가** | 파라미터가 티어 전환을 잠근다 | 15s 복귀 → 티어 변경, 2단계(→ [Provisioned CP]({{< relref "03-provisioned-control-plane.md" >}})) |
| 9 | **scoringStrategy는 기존 파드를 옮기지 않는다** | 전환 즉시 밀집되지 않는다 | 재조정하려면 evict·restart |
| 10 | **생략과 낮은 가중치는 다른 조작이다** | 리소스를 빼면 분모에서도 빠져 영향이 0이 된다 | 영향을 줄이려면 빼지 말고 낮은 가중치로 나열(§4.3) |
| 11 | **`weight` 이름 충돌** | karpenter NodePool의 `weight`는 NodePool 우선순위로 완전히 다른 개념 | YAML 리뷰에서 둘을 구분해 읽는다(§4.5) |
| 12 | **eventTtl은 신규 이벤트에만** | 스토리지 회수가 점진적 | 즉시 줄지 않는 것이 정상 |
| 13 | **NodePort 범위 축소 후 재생성** | 기존 서비스는 살아 있지만 재생성하면 범위 밖 포트를 못 받는다 | 명시 `nodePort`도 검증 대상 |
| 14 | **`allocateLoadBalancerNodePorts` 기본 true** | `target-type: ip`인데도 슬롯을 소비한다. 반대로 NLB instance 모드에서 false로 두면 LBC reconcile이 실패한다 | 서비스별 target-type 확인 후에만 만진다 |
| 15 | **CLI가 오래되면 플래그가 없다** | `help`에 문자열조차 안 나온다 | aws-cli v2 **2.36.21+** |
| 16 | **AWS 문서의 툴링 문구가 틀렸다** | Terraform은 과소, eksctl·CDK는 과대 서술 | provider 릴리스 노트·GA 태그를 직접 확인(§6) |

## 우리 케이스에서는

**create 시점에는 4개 전부 기본값으로 둡니다.** [클러스터 설정]({{< relref "../02-cluster-config.md" >}})의 create 직행에는 이미 OIDC 이중등록·ebs-csi IRSA 같은 blocking 리스크가 있습니다. 여기에 컨트롤 플레인 파라미터라는 변수를 하나 더 더할 이유가 없습니다. 네 개 모두 사후 `update-cluster-config`로 무중단 적용이 가능해서 이 결정이 쌉니다. 유일한 실제 후보는 **`MostAllocated`** 하나이고 그것도 blue 안정화 이후 별건으로 검토합니다. 선행조건 정리(requests 정확도·non-CPU requests=limits·PDB·zonal spread)는 §8.2에 있습니다. 그게 끝나기 전에는 방향이 옳다는 것만으로 켤 값이 아닙니다. 나머지 셋은 각각 트래픽 경로 무관(NodePort)·시점이 반대(eventTtl)·규모 불일치(HPA syncPeriod)로 접습니다.

한 가지 특권도 있습니다. 네 파라미터는 전부 클러스터 전역이라 namespace 단위 실험이 불가능합니다. 그런데 **blue-green 이관 자체가 클러스터 단위 실험 창을 줍니다.** green을 그대로 두고 blue에만 파라미터를 걸어 같은 워크로드를 양쪽에서 비교할 수 있는 상태는 이관 기간에만 존재합니다. MostAllocated의 노드 수·활용률 변화를 실측하려면 그 창이 닫히기 전이 가장 쌉니다. 컷오버와 같은 창에 넣지 말자는 §8.2의 결론과 이관 기간을 놓치지 말자는 이 관찰이 겹치는 곳이 **컷오버 직후·green 폐기 직전**입니다.
