---
title: "02 Kubernetes는 요청한 GPU를 어떻게 고르는가"
description: "Kubernetes 스케줄러는 GPU 개수를 보고 노드를 정하고, kubelet과 device plugin이 노드 안의 장치를 고른다. 2026-10-21 기준 NVIDIA 플러그인의 연결 점수, NUMA 정렬, Koordinator와 ACK의 허용 조합 방식을 비교한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 2
url: "/kubernetes/gpu/02-allocation-device-plugin/"
---

# 02 · Kubernetes는 요청한 GPU를 어떻게 고르는가

## 노드 선택과 GPU 선택은 다른 단계입니다 {#1-개수를-요청한-뒤에도-장치-선택은-남는다}

`nvidia.com/gpu: 4`는 GPU 네 장을 요청하는 문법입니다. NVLink로 이어진 네 장을 지정하는 문법은 아닙니다. [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}})의 PCIe 서버처럼 GPU 쌍마다 연결 경로가 다르다면, 개수를 충족한 뒤에도 어느 조합을 줄지 결정해야 합니다.

2026-10 기준 업스트림 Kubernetes의 기본 할당 경로는 device plugin이 `nvidia.com/gpu` extended resource(확장 리소스)를 노출하는 방식입니다. Kubernetes 문서는 Device Plugin을 v1.26부터 stable로 분류하며, extended resource에는 정수만 사용할 수 있고 오버커밋과 컨테이너 간 장치 공유는 허용하지 않는다고 명시합니다.

이 API 구조에서는 스케줄러가 노드의 GPU 개수를 비교해 파드를 배치합니다. 실제 GPU는 배치 후 kubelet의 디바이스 매니저가 선택합니다. 따라서 같은 네 장 요청이라도 어떤 노드에서는 NVLink로 연결된 조합을, 다른 노드에서는 소켓을 건너는 조합을 받을 수 있습니다. 스케줄러의 개수 계산만으로는 이 차이가 드러나지 않습니다.

플러그인은 `GetPreferredAllocation`으로 가용 장치 중 선호하는 집합을 kubelet에 제안할 수 있습니다. 선택적 호출이므로 `GetDevicePluginOptions`에서 지원 여부를 알려야 하며, NVIDIA 플러그인은 `internal/plugin/server.go`에서 `GetPreferredAllocationAvailable: true`로 등록합니다. 제안한 집합을 kubelet이 그대로 할당한다는 보장은 없습니다.

{{< seq src="_flow/2-디바이스-플러그인-할당-순서.json" />}}

다음 절의 점수 계산은 이 선호 집합을 만드는 과정입니다. 장치 선택을 스케줄러로 옮기는 DRA(동적 리소스 할당)는 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}}), 여러 노드에 걸친 잡 배치는 [04편]({{< relref "/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md" >}})에서 다룹니다.

## 선호 조합은 GPU 사이의 연결 점수로 계산합니다 {#2-플러그인은-연결-점수로-선호-조합을-만든다}

NVIDIA 플러그인은 후보가 모두 공유 복제본(replica)이 없는 풀 GPU일 때 `alignedAlloc` 경로에서 `go-gpuallocator`의 best-effort 정책을 사용합니다. 가용 GPU를 요청 크기인 `size` 단위로 나누어 보고, 각 집합의 점수 합이 가장 큰 분할에서 최고 점수 집합을 반환합니다. 현재 요청에 가장 좋은 조합 하나만 고르는 대신, 할당 후 남을 GPU의 조합까지 고려하는 계산입니다.

쌍별 점수는 `besteffort_policy.go`의 `calculateGPUPairScore`에 정의돼 있습니다.

| 두 GPU의 관계 | 점수 |
|---|---|
| 서로 다른 소켓(CrossCPU) | 10 |
| 같은 CPU | 20 |
| 같은 호스트 브리지 | 30 |
| 여러 PCIe 스위치를 건넘 | 40 |
| 같은 PCIe 스위치 | 50 |
| 같은 보드 | 60 |
| NVLink | 링크 수 × 100 (1링크 100, 18링크 1800) |

GPU 두 장을 요청한다면 NVLink 2링크로 이어진 쌍은 200점, 같은 PCIe 스위치 아래의 쌍은 50점, 소켓을 건너는 쌍은 10점입니다. 이 수치는 소스의 점수표로 계산한 값이며 대역폭 측정값은 아닙니다.

PCIe 서버나 NVLink 브리지 페어에서는 후보에 따라 점수가 달라져 조합 선택에 영향을 줄 수 있습니다. NVSwitch 기반 HGX에서 모든 쌍이 NV18이라면 쌍마다 1800점으로 같으므로 이 점수만으로 조합의 우열을 나눌 수 없습니다. 이는 점수표와 노드 구성에서 도출한 해석입니다.

time-slicing 복제본이나 MIG(GPU 하드웨어 분할) 장치가 섞인 경우에는 이 계산을 사용하지 않습니다. `internal/rm/nvml_manager.go`와 `allocate.go`에 따르면 이 경우는 설정한 정책에 따라 탐욕적으로 할당하며, 기본 정책은 distributed이고 packed와 spread도 지원합니다. 릴리스 노트는 v0.20.0에서 replicated·MIG 리소스를 위한 packed/distributed 정책이 추가됐다고 설명합니다.

## GPU 조합을 골라도 NUMA 정렬은 남습니다 {#3-cpu와-메모리까지-맞추려면-numa를-봐야-한다}

GPU끼리 가까운 조합을 골랐다고 CPU와 메모리까지 가까이 배치되는 것은 아닙니다. NVIDIA 플러그인의 `internal/rm/devices.go`는 장치마다 `TopologyInfo{Nodes: [{ID: numa}]}`를 채웁니다. kubelet의 Topology Manager는 이 NUMA(비균일 메모리 접근) 힌트를 CPU Manager·Memory Manager의 힌트와 합쳐 정렬을 시도합니다.

Topology Manager는 Kubernetes v1.27부터 stable입니다. 정책으로 `none`, `best-effort`, `restricted`, `single-numa-node`를 지원하며, 적용 범위인 scope는 `container`가 기본이고 `pod`도 선택할 수 있습니다. 다음 설정은 CPU Manager를 `static`으로 두고 파드 단위의 `single-numa-node` 정책을 고릅니다.

```yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
cpuManagerPolicy: static
topologyManagerPolicy: single-numa-node
topologyManagerScope: pod
```

GPU·CPU·메모리를 한 NUMA에 정렬하려면 device plugin의 NUMA 힌트와 CPU Manager의 static 정책, Memory Manager를 함께 고려해야 합니다. 문서의 조건을 종합하면 Guaranteed QoS가 아닌 파드의 CPU는 정렬되지 않을 것으로 추정됩니다.

v1.37.1의 `pkg/kubelet/cm/topologymanager` 소스는 `prefer-closest-numa-nodes`와 `max-allowable-numa-nodes`를 stable 옵션으로 분류합니다. 기본 최대 NUMA 노드 수는 8이며, 이를 넘는 머신에서는 `none` 이외의 정책을 거부합니다.

`single-numa-node`는 큰 GPU 요청에도 그대로 적용할 수 있는지 확인해야 합니다. 8-GPU 노드에서 8장을 요청하면 보통 두 소켓에 걸쳐 `TopologyAffinityError`로 거부될 가능성이 있습니다. 이는 공식 사례로 확인한 결과가 아닌 운영상의 예상입니다. 대형 학습 노드에서는 `restricted`나 `best-effort`, 또는 pod scope를 검토할 수 있지만, scope만 바꿨을 때의 결과 역시 실제 구성에서 확인해야 합니다.

Topology Manager의 판단은 파드가 노드에 배치된 뒤 이뤄집니다. 스케줄러가 NUMA 제약을 모르는 기본 구조에서는 자원 개수가 충분해도 이후 단계에서 거부될 수 있다는 뜻입니다. Koordinator, ACK, NFD topology-updater 같은 별도 프로젝트는 NUMA 정보를 스케줄링에 반영하는 문제를 다룹니다. 노드 사이의 거리는 [04편]({{< relref "/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md" >}})의 라벨과 큐로 표현합니다.

## Koordinator는 허용 GPU 조합을 스케줄러에 전달합니다 {#4-koordinator는-허용-조합을-스케줄링-조건으로-올린다}

스케줄러가 GPU 조합까지 계산하려면 개수 이상의 정보를 받아야 합니다. 과거 알리바바식 기법으로 알려진 “1~8 GPU를 gpu-2, gpu-4 같은 별도 리소스 이름으로 노출한다”는 방식은 이번 조사에서 1차 자료를 찾지 못했습니다. 현재 확인할 수 있는 Koordinator의 GPU Partition API는 리소스 이름을 조합마다 늘리는 대신 허용 조합 표를 어노테이션과 Device CR(커스텀 리소스)에 담습니다.

{{< flow src="_flow/5-세대-비교.json" />}}

2024-10-08에 작성한 GPU Partition API 제안서는 NVIDIA Fabric Manager의 Shared NVSwitch 모드에서 허용 GPU 조합이 정해져 있다는 제약을 다룹니다. 제안서 상태는 provisional이며 관련 타입은 main 코드에 존재합니다.

Device CR의 `scheduling.koordinator.sh/gpu-partitions` 어노테이션에는 GPU 수 1, 2, 4, 8에 해당하는 허용 조합을 적습니다. 각 조합은 `minors`, `gpuLinkType: NVLink`, `ringBusBandwidth`, `allocationScore`를 가집니다. 파드는 `scheduling.koordinator.sh/gpu-partition-spec`에서 `allocatePolicy`를 `Restricted` 또는 `BestEffort`로 고르고 `ringBusBandwidth`를 요구합니다. 노드의 `node.koordinator.sh/gpu-partition-policy` 라벨은 `Honor`나 `Prefer`로 이 요구를 얼마나 강제할지 정합니다.

사용하는 리소스 이름은 `koordinator.sh/gpu`, `koordinator.sh/gpu-core`, `koordinator.sh/gpu-memory` 등 `koordinator.sh/gpu*` 계열이며 `nvidia.com/gpu`도 인식합니다. `apis/extension/device_share.go`의 `device-joint-allocate`는 GPU와 RDMA(원격 직접 메모리 접근)를 `SamePCIe` 범위에서 함께 할당하는 기능입니다. Alibaba Cloud 블로그도 Koordinator v1.6과 HAMi의 협업으로 GPU·RDMA 공동 할당과 GPU 격리를 제공했다고 소개합니다. 이 도입 설명은 벤더의 주장으로 구분해야 합니다.

## ACK의 토폴로지 모드는 노드 전체에 영향을 줍니다 {#5-ack는-토폴로지-모드를-켜면-다른-gpu-워크로드가-막힌다}

ACK 매니지드 제품에는 커스텀 GPU 리소스를 사용하는 기능이 현재도 있습니다. 2026-08-06 갱신한 GPU 스케줄링 문서는 `ack.node.gpu.schedule` 라벨로 `default`, `cgpu`, `core_mem`, `share`, `mps`, `topology` 중 하나를 고르도록 안내합니다. 배치 방식은 `ack.node.gpu.placement`의 `binpack`(기본) 또는 `spread`로 선택합니다. 공유 모드의 리소스는 `aliyun.com/gpu-mem`, `core_mem` 모드는 `aliyun.com/gpu-core.percentage` 등을 사용합니다.

공유와 토폴로지 인지 스케줄링에는 ACK Pro와 `ack-ai-installer`가 필요합니다. 노드의 `aliyun.com/gpu`가 0이 아니면 토폴로지 모드가 켜지며, 노드마다 모드를 하나만 사용할 수 있습니다. 이 모드에서는 토폴로지를 쓰지 않는 GPU 워크로드가 막히므로 기존 잡과 같은 노드에서 운영할 수 있는지 먼저 확인해야 합니다.

NUMA 토폴로지 인지 스케줄링은 별도 기능입니다. 2026-03-26 갱신한 문서는 `nvidia.com/gpu` 대신 `aliyun.com/gpu`로 정수 카드만 요청하도록 명시합니다. ACK Pro 1.24 이상, ack-koordinator, `gputopo-device-plugin`이 필요하며 sccgn7ex와 Lingjun 노드만 대상입니다. 과거 gputopo에 대응하는 `gpu-topology-scheduler` 같은 별도 공개 저장소는 찾지 못했습니다.

## 제품의 현행 기능과 옛 공개 구현을 구분합니다 {#6-옛-gpushare와-지금의-공개-스택은-구분해야-한다}

ACK의 기능이 유지된다는 사실만으로 과거 gpushare 공개 저장소도 활발히 개발된다고 볼 수는 없습니다. 아래 표는 2026-10-21에 GitHub API로 조회한 마지막 릴리스와 커밋입니다.

| 저장소 | 마지막 릴리스 | 마지막 커밋 |
|---|---|---|
| gpushare-scheduler-extender | 릴리스 없음 | 2023-03-16 |
| gpushare-device-plugin | v0.3.0 (2019-05-13) | 2022-04-21 |
| Koordinator | v1.8.0 (2026-04-16) | 2026-10-20 |
| Volcano | v1.16.0 (2026-10-14) | 2026-10-21 |
| HAMi | v2.10.0 (2026-08-21) | 2026-10-21 |

Volcano의 GPU 공유 방식도 바뀌었습니다. 코드에는 `volcano.sh/gpu-memory` 상수가 남아 있지만 문서는 "GPU sharing is deprecated in volcano v1.9"라고 명시하고 HAMi 기반 vGPU를 권합니다. 2026-07-22의 vGPU 문서가 설명하는 현행 경로는 `volcano.sh/vgpu-number` 등의 리소스와 HAMi-core(소프트웨어 vGPU) 또는 Dynamic MIG입니다.

Volcano의 DRA 가이드(2026-07-24)에는 `resource.k8s.io/v1beta1` 런타임 설정 등 Kubernetes 1.32 기준 설명이 남아 있습니다. 별도 스케줄러를 선택할 때는 공개 기능 목록뿐 아니라 적용할 버전의 API도 확인해야 합니다. Volcano와 다른 배치 스케줄러의 차이는 [05편]({{< relref "/platform/kubernetes/gpu/05-scheduling-volcano-kai-slurm/index.md" >}})에서 다룹니다.

확인한 자료에서 커스텀 GPU 리소스는 ACK 매니지드 제품, 공유·분할·조합을 직접 계산하는 Koordinator와 Volcano+HAMi 스택, 허용 조합이 고정된 Shared NVSwitch 환경에 남아 있습니다. 업스트림 Kubernetes의 표준 할당 방식으로 자리 잡은 것은 아닙니다. 업스트림이 같은 문제를 DRA의 속성·용량·파티션으로 다루고 있다는 점에서, 별도 커스텀 리소스가 기본 경로가 될 가능성은 낮다고 판단합니다. 이 전망과 DRA의 실제 전환 조건은 구분해야 하며, 후자는 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에서 살펴봅니다.

## 조사 버전과 확인이 남은 항목 {#7-확인하지-못한-것}

2026-10-21 기준 Kubernetes v1.37.1(2026-09-23), NVIDIA k8s-device-plugin v0.20.1(2026-09-22), GPU Operator v26.7.2(2026-10-14)의 릴리스와 관련 소스·문서를 참고했습니다. 소스로 확인한 동작, 벤더의 도입 설명, 구조에서 도출한 예상은 본문에서 구분했습니다.

다음 항목은 이번 조사에서 확인하지 못했습니다.

- “1~8 GPU를 별도 리소스 이름으로 노출한다”는 옛 기법의 1차 자료. 현행 구현으로는 Koordinator Partition API를 확인했습니다.
- ACK의 과거 GPU 토폴로지 스케줄러(gputopo)의 공개 저장소.
- 8-GPU 노드에서 `single-numa-node`가 파드를 거부하는 실제 사례에 대한 공식 서술.
- 같은 소켓과 원격 소켓에 배치한 GPU의 정량 성능 차이를 보여 주는 NVIDIA 1차 수치.

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
