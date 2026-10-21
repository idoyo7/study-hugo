---
title: "02 요청한 GPU는 누가 골라 주는가"
description: "2026-10-21 기준, 기본 GPU 할당 경로에서는 스케줄러가 개수를 확인하고 kubelet이 실제 장치를 고른다. NVIDIA device plugin은 선호 조합을 제안하며, 스케줄러가 조합을 직접 계산하는 커스텀 리소스 방식은 ACK와 별도 스케줄러 스택에 남아 있다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 2
url: "/kubernetes/gpu/02-allocation-device-plugin/"
---

# 02 · 요청한 GPU는 누가 골라 주는가

## 1. 개수를 요청한 뒤에도 장치 선택은 남는다

파드가 `nvidia.com/gpu: 4`를 요청했다고 해서 NVLink(GPU 간 연결)로 이어진 4장을 지정한 것은 아닙니다. 2026-10 현재 업스트림 Kubernetes의 기본 경로는 device plugin(장치 정보를 kubelet에 등록하는 플러그인)이 노출하는 `nvidia.com/gpu` extended resource(확장 리소스)입니다. 이 요청이 표현하는 것은 GPU 개수입니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-21이며 Kubernetes v1.37.1 문서, NVIDIA k8s-device-plugin v0.20.1 소스, 각 프로젝트 저장소를 봤습니다.

Kubernetes 문서에서 Device Plugin은 v1.26부터 stable입니다. 문서는 extended resource를 정수 리소스로만 지원하며, 오버커밋과 컨테이너 간 장치 공유를 허용하지 않는다고 명시합니다.

API 구조로 보면 스케줄러는 노드가 가진 GPU 개수를 비교하고, 어느 GPU를 줄지는 파드가 노드에 배치된 뒤 kubelet의 디바이스 매니저가 결정합니다. NVLink로 연결된 4장을 받을지, 소켓에 걸친 4장을 받을지는 스케줄링 단계에서 정해지지 않습니다. 같은 요청도 노드에 따라 연결 품질이 다른 GPU 조합으로 이어질 수 있습니다.

플러그인이 이 선택에 의견을 내는 호출이 `GetPreferredAllocation`입니다. 가용 장치 목록에서 할당하기 좋은 집합을 반환하는 선택적 호출이며, 지원 여부는 `GetDevicePluginOptions`의 플래그로 알립니다. NVIDIA 플러그인은 이 호출을 켜고 등록합니다. kubelet이 최종적으로 같은 집합을 할당한다는 보장은 없습니다.

{{< seq src="_flow/2-디바이스-플러그인-할당-순서.json" />}}

노드 안 GPU 연결 구조는 [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}})에서 다뤘고, DRA(동적 리소스 할당)는 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에서 이어집니다. 노드를 넘어 묶는 스케줄링은 [04편]({{< relref "/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md" >}})에서 봅니다.

이 자료를 종합하면 알리바바식 커스텀 리소스 방식은 표준이 아니고 ACK와 일부 스케줄러 스택에 남아 있습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 조사 버전 | Kubernetes v1.37.1(2026-09-23), NVIDIA k8s-device-plugin v0.20.1(2026-09-22), GPU Operator v26.7.2(2026-10-14) | 각 GitHub 릴리스 | `✓` |
| extended resource의 한계 | 정수 리소스만, 오버커밋 불가, 컨테이너 간 장치 공유 불가. Device Plugin은 v1.26부터 stable | Kubernetes 문서 device-plugins | `✓` |
| 스케줄러는 개수만 본다 | 어느 GPU를 줄지는 노드 배치 후 kubelet이 결정 | API 구조에서 도출 | `≈` |
| `GetPreferredAllocation` | 가용 장치 중 선호 집합을 반환. 최종 할당과 같다는 보장 없음. 선택 사항이며 `GetDevicePluginOptions`로 알림 | 같은 문서 | `✓` |
| NVIDIA 플러그인의 등록 | `GetPreferredAllocationAvailable: true` | k8s-device-plugin `internal/plugin/server.go` | `✓` |

{{% /details %}}

## 2. 플러그인은 연결 점수로 선호 조합을 만든다

NVIDIA 플러그인은 GPU 사이의 연결 품질을 점수로 매겨 선호 집합을 만듭니다. 이 계산은 후보가 모두 공유 복제본(replica) 없는 풀 GPU일 때 적용됩니다. 이때 사용하는 정책이 `go-gpuallocator`의 best-effort입니다.

best-effort는 요청 크기 `size`에 맞는 조합 하나만 탐욕적으로 고르지 않습니다. 가용 GPU 전체를 `size` 단위로 나눴을 때 점수 합이 최대인 분할을 찾고, 그 안에서 최고 점수 집합을 반환합니다. 이번 요청을 처리한 뒤 남은 GPU가 잘게 흩어지는 일을 줄이려는 설계입니다. GPU 쌍에 부여하는 점수는 소스에 다음과 같이 정의돼 있습니다.

| 두 GPU의 관계 | 점수 |
|---|---|
| 서로 다른 소켓(CrossCPU) | 10 |
| 같은 CPU | 20 |
| 같은 호스트 브리지 | 30 |
| 여러 PCIe 스위치를 건넘 | 40 |
| 같은 PCIe 스위치 | 50 |
| 같은 보드 | 60 |
| NVLink | 링크 수 × 100 (1링크 100, 18링크 1800) |

2장을 요청할 때 NVLink 2링크로 이어진 쌍은 200점, 같은 PCIe 스위치의 쌍은 50점, 소켓을 건넌 쌍은 10점입니다. PCIe 서버나 NVLink 브리지로 GPU를 짝지은 구성에서는 후보 사이에 점수 차가 납니다. NVSwitch가 달린 HGX에서는 모든 쌍이 NV18로 같은 점수를 받으므로, 이 정책이 조합 선택에 차이를 만들지 못합니다. 이 비교는 점수표로 계산한 값이며 측정한 결과는 아닙니다.

time-slicing 복제본이나 MIG(GPU 하드웨어 분할) 장치가 섞이면 이 점수 계산을 쓰지 않습니다. 설정한 정책에 따라 탐욕적으로 할당하며, distributed가 기본이고 packed와 spread도 사용합니다. v0.20.0에서는 replicated 리소스와 MIG 리소스에 packed/distributed 할당 정책이 추가됐습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 풀 GPU는 `alignedAlloc`, 공유·MIG는 정책 할당 | 풀 GPU면 `go-gpuallocator` best-effort, 그 외 distributed(기본)·packed·spread | k8s-device-plugin `internal/rm/nvml_manager.go`, `allocate.go` | `✓` |
| best-effort의 분할 최적화 | `size` 단위 분할 중 점수 합이 최대인 것을 찾아 최고 점수 세트를 반환 | go-gpuallocator `besteffort_policy.go` | `✓` |
| 쌍 점수 | CrossCPU 10, 같은 CPU 20, 호스트 브리지 30, 다중 스위치 40, 단일 스위치 50, 같은 보드 60, NVLink는 링크 수 × 100 | 같은 파일 `calculateGPUPairScore` | `✓` |
| 2장 요청의 점수 비교 | NVLink 2링크 200, 단일 스위치 50, CrossCPU 10 | 위 점수표로 계산 | `≈` |
| NVSwitch HGX에서 차이가 없다는 해석 | 모든 쌍이 NV18로 같은 점수 | 점수표와 구성에서 추정 | `≈` |
| v0.20.0 변경 | replicated·MIG 리소스용 packed/distributed 정책 추가 | k8s-device-plugin 릴리스 | `✓` |

{{% /details %}}

## 3. CPU와 메모리까지 맞추려면 NUMA를 봐야 한다

GPU끼리 좋은 연결을 고른 뒤에는 CPU와 메모리를 어디에 둘지가 남습니다. NVIDIA 플러그인이 장치마다 채우는 `TopologyInfo`에는 NUMA(비균일 메모리 접근) 노드 ID도 들어갑니다. kubelet의 Topology Manager는 이 정보와 CPU Manager, Memory Manager의 힌트를 합쳐 한 NUMA에 정렬합니다. Kubernetes 문서 기준으로 v1.27부터 stable입니다.

GPU·CPU·메모리를 한 NUMA에 모으려면 device plugin의 NUMA 힌트, `static` CPU Manager, Memory Manager가 함께 있어야 합니다. Guaranteed QoS가 아닌 파드의 CPU는 정렬되지 않는다고 추정합니다.

Topology Manager의 정책은 `none`, `best-effort`, `restricted`, `single-numa-node`이며, scope는 `container`가 기본이고 `pod`도 지원합니다. 다음은 kubelet에서 `single-numa-node` 정책과 `pod` scope를 고르는 설정입니다.

```yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
cpuManagerPolicy: static
topologyManagerPolicy: single-numa-node
topologyManagerScope: pod
```

정책 옵션 `prefer-closest-numa-nodes`와 `max-allowable-numa-nodes`는 v1.37.1 소스의 stable 목록에 있습니다. 기본 최대 NUMA 노드 수는 8이며, 이를 넘는 머신에서는 `none` 외의 정책이 거부됩니다.

8-GPU 노드에서 GPU 8장을 요청하면 보통 두 소켓에 걸치므로, `single-numa-node`가 파드를 TopologyAffinityError로 거부할 것으로 보입니다. 대형 학습 노드에서는 `restricted`나 `best-effort`, 또는 pod scope가 현실적인 선택입니다. 이 판단은 운영 관점의 추정이며, 1차 근거는 찾지 못했습니다.

Topology Manager의 더 큰 한계는 범위입니다. 노드 안 할당만 다룹니다. 스케줄러는 NUMA를 모르므로 파드가 노드에 배치된 뒤에야 거부될 수 있습니다. NUMA를 인지하는 스케줄링은 Koordinator, ACK, NFD topology-updater 같은 별도 프로젝트가 다룹니다. 노드를 넘는 쪽은 [04편]({{< relref "/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md" >}})에서 라벨과 큐로 푸는 방법을 봅니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| NUMA 힌트 | 장치마다 `TopologyInfo{Nodes: [{ID: numa}]}` 채움 | k8s-device-plugin `internal/rm/devices.go` | `✓` |
| Topology Manager | v1.27부터 stable. 정책 4종, scope `container`(기본)·`pod` | Kubernetes 문서 topology-manager | `✓` |
| 정책 옵션과 NUMA 상한 | `prefer-closest-numa-nodes`·`max-allowable-numa-nodes`가 v1.37.1 stable 목록. 기본 최대 NUMA 8, 초과 머신은 `none` 외 거부 | Kubernetes v1.37.1 `pkg/kubelet/cm/topologymanager` | `✓` |
| 정렬에 필요한 조합 | device plugin NUMA 힌트 + CPU Manager(static) + Memory Manager. Guaranteed QoS가 아니면 CPU 미정렬 | 문서에서 추정 | `≈` |
| 8-GPU 노드의 `single-numa-node` 거부 | 8장 요청은 두 소켓에 걸쳐 TopologyAffinityError가 날 것. 1차 근거 없음 | 운영 판단 | `?` |
| 스케줄러는 NUMA를 모름 | 배치 후 거부 가능. NUMA 인지 스케줄링은 별도 프로젝트 | 구조에서 추정 | `≈` |

{{% /details %}}

## 4. Koordinator는 허용 조합을 스케줄링 조건으로 올린다

노드에 배치한 뒤 플러그인이 조합을 고르게 하는 대신, 스케줄러가 조합을 직접 계산하게 할 수도 있습니다. 1장부터 8장까지 조합 단위로 별도 리소스 이름을 노출하는 알리바바식 기법이 지금도 표준인지 이 절에서 확인합니다.

GPU를 1장부터 8장까지 별도 리소스 이름으로 노출했다는 기법 자체는 1차 자료를 찾지 못했습니다. 현재 확인되는 형태는 리소스 이름을 그대로 두고 허용 조합 표를 어노테이션과 CR(커스텀 리소스)에 올리는 Koordinator 방식입니다.

{{< flow src="_flow/5-세대-비교.json" />}}

Koordinator의 GPU Partition API 제안서(2024-10-08)는 NVIDIA Fabric Manager의 Shared NVSwitch 모드에서 허용되는 GPU 조합이 정해져 있다는 문제에서 출발합니다. 제안서 상태는 provisional이며, 타입은 main 코드에 존재합니다.

노드의 Device CR에는 `scheduling.koordinator.sh/gpu-partitions` 어노테이션으로 GPU 수(1, 2, 4, 8)별 허용 조합을 올립니다. 각 조합에는 `minors`, `gpuLinkType: NVLink`, `ringBusBandwidth`, `allocationScore`가 붙습니다. 파드는 `scheduling.koordinator.sh/gpu-partition-spec`으로 `allocatePolicy`(`Restricted` 또는 `BestEffort`)와 `ringBusBandwidth`를 요구합니다. 노드 라벨 `node.koordinator.sh/gpu-partition-policy`의 `Honor`나 `Prefer` 값은 이 요구를 얼마나 강제할지 정합니다.

이 방식에서 사용하는 리소스 이름은 `koordinator.sh/gpu`, `koordinator.sh/gpu-core`, `koordinator.sh/gpu-memory` 등이며, Koordinator는 `nvidia.com/gpu`도 인식합니다. GPU와 RDMA(원격 직접 메모리 접근)를 `SamePCIe` 범위에서 함께 할당하는 `device-joint-allocate`도 제공합니다. Alibaba Cloud 블로그는 Koordinator v1.6이 HAMi와 협업해 GPU·RDMA 공동 할당과 GPU 격리를 내놨다고 설명합니다. 이는 벤더 설명입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| "1~8 GPU 별도 리소스 이름" 방식의 1차 자료 | 찾지 못함. Koordinator Partition API가 현행 형태 | Koordinator 제안서 | `?` |
| Koordinator Partition API | 어노테이션 `gpu-partitions`, `gpu-partition-spec`, 노드 라벨 `gpu-partition-policy`(`Honor`·`Prefer`). 제안서 provisional, 타입은 main에 존재 | Koordinator 제안서 20241008-gpu-partition-api | `✓` |
| 리소스 이름과 공동 할당 | `koordinator.sh/gpu*`, `device-joint-allocate`(`SamePCIe`) | Koordinator `apis/extension/device_share.go` | `✓` |
| Koordinator v1.6과 HAMi 협업 | GPU+RDMA 공동 할당, GPU 격리 | Alibaba Cloud 블로그 | `Ⓥ` |

{{% /details %}}

## 5. ACK는 토폴로지 모드를 켜면 다른 GPU 워크로드가 막힌다

ACK 매니지드 제품에서 커스텀 리소스 방식은 현행 기능입니다. Alibaba Cloud 문서(2026-08-06 갱신)는 노드 라벨 `ack.node.gpu.schedule`로 `default`, `cgpu`, `core_mem`, `share`, `mps`, `topology` 모드를 고르도록 안내합니다. 공유 모드에서는 `aliyun.com/gpu-mem`, `core_mem` 모드에서는 `aliyun.com/gpu-core.percentage` 같은 리소스 이름을 사용합니다.

토폴로지 모드는 노드의 `aliyun.com/gpu`가 0이 아니면 켜집니다. 공유와 토폴로지 인지 스케줄링은 ACK Pro 전용이며 `ack-ai-installer` 컴포넌트가 필요합니다. 노드당 모드는 하나만 쓸 수 있습니다. 토폴로지 모드를 켜면 토폴로지를 쓰지 않는 GPU 워크로드가 막힙니다.

NUMA 토폴로지 인지 스케줄링은 별도 기능입니다. 해당 문서는 GPU 요청에 `nvidia.com/gpu` 대신 `aliyun.com/gpu`를 쓰고 정수 카드만 요청하도록 명시합니다. ACK Pro 1.24 이상, ack-koordinator, `gputopo-device-plugin`이 필요하며, 대상은 sccgn7ex와 Lingjun 노드로 한정됩니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| ACK 스케줄링 모드 | 라벨 `ack.node.gpu.schedule` 6종, `ack.node.gpu.placement`는 `binpack`(기본)·`spread`. ACK Pro 전용, `ack-ai-installer` 필요 | Alibaba Cloud ACK 문서 enable-scheduling (2026-08-06 갱신) | `✓` |
| ACK 리소스 이름과 제약 | `aliyun.com/gpu-mem`, `aliyun.com/gpu-core.percentage`. 노드당 한 모드, 토폴로지 모드는 비토폴로지 워크로드를 막음 | 같은 문서 | `✓` |
| ACK NUMA 인지 스케줄링 | `aliyun.com/gpu` 정수 카드만, ACK Pro 1.24+, ack-koordinator, `gputopo-device-plugin`, sccgn7ex·Lingjun 한정 (2026-03-26 갱신) | ACK 문서 enable-numa-topology-aware-scheduling | `✓` |
| gputopo 공개 저장소 | `gpu-topology-scheduler` 같은 별도 공개 저장소를 찾지 못함 | — | `?` |

{{% /details %}}

## 6. 옛 gpushare와 지금의 공개 스택은 구분해야 한다

ACK의 현행 제품 기능과 과거 gpushare 공개 저장소는 활동 시점이 다릅니다. gpushare 저장소는 정체돼 있고, Koordinator·Volcano·HAMi에는 최근 릴리스와 커밋이 있습니다. 2026-10-21 GitHub API로 조회한 결과는 다음과 같습니다.

| 저장소 | 마지막 릴리스 | 마지막 커밋 |
|---|---|---|
| gpushare-scheduler-extender | 릴리스 없음 | 2023-03-16 |
| gpushare-device-plugin | v0.3.0 (2019-05-13) | 2022-04-21 |
| Koordinator | v1.8.0 (2026-04-16) | 2026-10-20 |
| Volcano | v1.16.0 (2026-10-14) | 2026-10-21 |
| HAMi | v2.10.0 (2026-08-21) | 2026-10-21 |

공개 스택에서는 GPU 공유를 구현하는 방식도 바뀌었습니다. Volcano 코드에는 옛 GPU 공유 리소스인 `volcano.sh/gpu-memory` 상수가 남아 있습니다. 문서는 "GPU sharing is deprecated in volcano v1.9"라고 명시하고 HAMi 기반 vGPU를 권합니다. 현행 방식은 `volcano.sh/vgpu-number` 같은 리소스를 쓰는 HAMi-core(소프트웨어 vGPU) 또는 Dynamic MIG 모드입니다.

Volcano 스케줄러에는 DRA 지원 가이드도 있습니다. 이 가이드는 `resource.k8s.io/v1beta1` 런타임 설정을 안내하는 등 1.32 기준 서술이 남아 있습니다. Volcano와 다른 배치 스케줄러의 선택은 [05편]({{< relref "/platform/kubernetes/gpu/05-scheduling-volcano-kai-slurm/index.md" >}})에서 이어집니다.

이 자료를 종합하면 알리바바식 커스텀 리소스가 업스트림 Kubernetes의 표준은 아닙니다. 이 방식은 ACK 매니지드, GPU 공유·분할·조합을 직접 계산하는 Koordinator나 Volcano+HAMi 스택, 허용 조합이 하드웨어로 고정되는 Shared NVSwitch 환경에 남아 있습니다. 업스트림 Kubernetes는 같은 문제를 DRA의 속성, 용량, 파티션으로 흡수하는 중이어서 커스텀 리소스가 기본 경로가 될 가능성은 낮다고 봅니다. DRA는 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에서 봅니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 오픈소스 활성도 | 표의 날짜 (GitHub API 2026-10-21 조회) | 각 GitHub 저장소 | `✓` |
| Volcano GPU 공유 deprecated | "GPU sharing is deprecated in volcano v1.9", HAMi 기반 vGPU 권고 | Volcano 문서 how_to_use_gpu_sharing | `✓` |
| Volcano 현행 | `volcano.sh/vgpu-number`, HAMi-core 또는 Dynamic MIG. DRA 가이드는 1.32 기준 서술 잔존 | Volcano 문서 how_to_use_volcano_vgpu(2026-07-22), how_to_enable_dra(2026-07-24) | `✓` |
| 커스텀 리소스는 표준이 아님 | ACK 매니지드와 Koordinator·Volcano+HAMi 스택에 남고, 업스트림은 DRA로 흡수 중 | ACK 문서, 각 저장소, Kubernetes 문서를 종합 | `≈` |
| 커스텀 리소스가 남는 세 곳 | ACK 매니지드, Koordinator·Volcano+HAMi, Shared NVSwitch | 위 자료를 종합 | `≈` |

{{% /details %}}

## 7. 확인하지 못한 것

- "1~8 GPU를 gpu-2, gpu-4 같은 별도 리소스 이름으로 노출한다"는 기법 자체의 1차 자료. 현행 형태는 Koordinator Partition API로 확인
- ACK의 과거 GPU 토폴로지 스케줄러(gputopo)의 공개 저장소
- 8-GPU 노드에서 `single-numa-node` 정책이 실제로 파드를 거부하는지에 대한 공식 서술
- 같은 소켓과 원격 소켓에 놓인 GPU의 정량 성능 차를 보여 주는 NVIDIA 1차 수치

## 참고 자료

- [Kubernetes — Device Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)
- [Kubernetes — Topology Manager](https://kubernetes.io/docs/tasks/administer-cluster/topology-manager/)
- [Kubernetes 릴리스](https://github.com/kubernetes/kubernetes/releases)
- [NVIDIA k8s-device-plugin 릴리스](https://github.com/NVIDIA/k8s-device-plugin/releases)
- [k8s-device-plugin — nvml_manager.go](https://github.com/NVIDIA/k8s-device-plugin/blob/main/internal/rm/nvml_manager.go)
- [k8s-device-plugin — allocate.go](https://github.com/NVIDIA/k8s-device-plugin/blob/main/internal/rm/allocate.go)
- [go-gpuallocator — besteffort_policy.go](https://github.com/NVIDIA/go-gpuallocator/blob/main/gpuallocator/besteffort_policy.go)
- [Alibaba Cloud ACK — GPU 스케줄링 활성화](https://www.alibabacloud.com/help/en/ack/ack-managed-and-ack-dedicated/user-guide/enable-scheduling)
- [Alibaba Cloud ACK — NUMA 토폴로지 인지 스케줄링](https://www.alibabacloud.com/help/en/ack/ack-managed-and-ack-dedicated/user-guide/enable-numa-topology-aware-scheduling)
- [gpushare-scheduler-extender](https://github.com/AliyunContainerService/gpushare-scheduler-extender)
- [gpushare-device-plugin](https://github.com/AliyunContainerService/gpushare-device-plugin)
- [Koordinator — device_share.go](https://github.com/koordinator-sh/koordinator/blob/main/apis/extension/device_share.go)
- [Koordinator — GPU Partition API 제안서](https://github.com/koordinator-sh/koordinator/blob/main/docs/proposals/scheduling/20241008-gpu-partition-api.md)
- [Alibaba Cloud 블로그 — Koordinator v1.6](https://www.alibabacloud.com/blog/koordinator-v1-6-supports-heterogeneous-resource-scheduling-in-aiml-scenarios_602051)
- [Volcano — GPU 공유 (deprecated)](https://github.com/volcano-sh/volcano/blob/master/docs/user-guide/how_to_use_gpu_sharing.md)
- [Volcano — vGPU](https://github.com/volcano-sh/volcano/blob/master/docs/user-guide/how_to_use_volcano_vgpu.md)
- [Volcano — DRA 활성화](https://github.com/volcano-sh/volcano/blob/master/docs/user-guide/how_to_enable_dra.md)
