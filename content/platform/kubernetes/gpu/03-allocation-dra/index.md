---
title: "03 GPU 할당에 DRA가 필요한 때 — 개수는 device plugin, 노드 간 NVLink는 ComputeDomain"
description: "2026-10-21 기준 GPU 개수 할당은 device plugin과 GPU Operator가 기본이며, 노드 간 NVLink에는 DRA 기반 ComputeDomain이 사실상 필수다. DRA로 GPU 할당을 옮길 시점은 장치 선택 요구와 설치·운영 제약에 따라 판단한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 3
url: "/kubernetes/gpu/03-allocation-dra/"
---

# 03 · GPU 할당에 DRA가 필요한 때 — 개수는 device plugin, 노드 간 NVLink는 ComputeDomain

## 1. GA 표기는 다르고 기본 경로는 그대로다

DRA(Dynamic Resource Allocation)의 GA(정식 제공) 표기가 나온 뒤에도 지금 쓰는 device plugin을 유지해도 될까요? 설치 문서와 운영 예시를 종합하면, GPU 개수를 할당하는 기본 경로는 여전히 device plugin과 GPU Operator입니다. GB200처럼 NVLink가 노드를 넘는 시스템에서는 DRA 기반의 ComputeDomain이 사실상 필수입니다. ComputeDomain은 멀티노드 NVLink 워크로드에 참여할 노드를 묶는 커스텀 리소스입니다.

NVIDIA의 GPU 할당 드라이버는 성숙도 표기부터 출처가 일치하지 않습니다. 릴리스 노트와 GPU Operator 문서는 GA로, 저장소 README는 아직 공식 지원 전으로, AWS 문서는 experimental로 적습니다.

- v25.12.0 릴리스 노트(2026-02-12)는 GPU 할당 플러그인의 GA를 선언했습니다.
- GPU Operator 26.7 문서는 전체 GPU와 기존 MIG(Multi-Instance GPU) 장치 할당을 GA로 적고, ComputeDomain도 GA로 표기합니다.
- kubernetes-sigs 저장소의 현재 main README는 GPU 할당이 공식 지원 전이며 Helm 기본값에서 꺼져 있다고 설명합니다. 같은 main의 Helm values는 `resources.gpus.enabled: true`입니다. README가 갱신되지 않은 것으로 보입니다.
- AWS EKS 문서는 GPU 할당 기능이 experimental을 벗어날 때까지 NVIDIA device plugin을 권합니다. 예시 values도 `resources.gpus.enabled: false`입니다.
- ComputeDomain 관련 게이트인 `ComputeDomainCliques`, `IMEXDaemonsWithDNSNames`는 GPU Operator 문서에서 GA, sigs 문서에서 Beta(기본 on)로 표기합니다.

따라서 GA라는 표현만으로 GPU 할당의 기본 경로가 바뀌었다고 판단하기는 어렵습니다.

라벨과 큐로 노드를 넘어 묶는 방법은 [04편]({{< relref "/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md" >}}), RDMA NIC를 DRA로 주는 방법은 [07편]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}})에서 이어집니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-21이며 Kubernetes v1.37.1 소스와 문서, NVIDIA DRA 드라이버 v0.5.1, GPU Operator 26.7 문서를 봤습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 조사 버전 | Kubernetes v1.37.1(2026-09-23), GPU Operator v26.7.2(2026-10-14), DRA Driver for NVIDIA GPUs v0.5.1(2026-10-12) | 각 GitHub 릴리스 | `✓` |
| DRA 드라이버 저장소 이관 | `NVIDIA/k8s-dra-driver-gpu`가 `kubernetes-sigs/dra-driver-nvidia-gpu`로 리다이렉트. v0.4.0(2026-05-15)이 첫 릴리스이며 버전 체계가 CalVer에서 SemVer로 바뀌고 Helm 차트가 registry.k8s.io로 이동 | DRA 드라이버 릴리스 | `✓` |
| 개수 할당은 device plugin, 노드 간 NVLink는 DRA | 아래 5~7절의 자료를 종합 | — | `Σ` |
| GA 선언 | v25.12.0(2026-02-12) "general availability of the GPU allocation plugin". Operator 26.7 문서는 전체 GPU·기존 MIG 할당과 ComputeDomain을 GA로 표기 | DRA 드라이버 릴리스 노트, GPU Operator 26.7 문서 | `✓` |
| README와 Helm values 불일치 | README는 "not yet officially supported", values는 `resources.gpus.enabled: true`. README 미갱신 추정 | kubernetes-sigs 저장소 main | `✓` / `≈` |
| EKS의 experimental 표기 | NVIDIA device plugin 권고, 예시 values `resources.gpus.enabled: false` | EKS 문서 | `✓` |
| ComputeDomain 게이트 표기 차이 | GPU Operator 문서 GA, sigs 문서 Beta(기본 on) | 두 문서 | `✓` |

{{% /details %}}

## 2. GPU 개수 대신 장치의 조건을 요청한다

[02편]({{< relref "/platform/kubernetes/gpu/02-allocation-device-plugin/index.md" >}})에서 본 것처럼 device plugin 방식은 스케줄러가 GPU 개수만 보고, 어느 GPU를 줄지는 노드에서 정합니다. DRA는 장치를 고르는 판단을 스케줄러 본체로 옮깁니다. 워크로드가 장치의 속성과 용량을 요청하면 스케줄러가 그 조건에 맞는 장치를 선택합니다.

Kubernetes 문서의 객체 모델에서 DeviceClass는 드라이버나 관리자가 정의하는 장치 종류입니다. 드라이버는 ResourceSlice에 노드별 장치 목록과 속성, 용량을 공개합니다. 워크로드는 ResourceClaim이나 ResourceClaimTemplate으로 요청을 내고, 스케줄러는 요청을 만족하는 장치를 골라 그 장치에 닿는 노드에 파드를 배치합니다.

{{< flow src="_flow/2-dra-모델.json" />}}

이 모델의 기반인 KEP-4381(structured parameters)은 1.30에서 alpha, 1.32에서 beta, 1.34에서 GA가 됐습니다. 1.35부터는 기능 게이트가 기본값에 고정되며 API는 `resource.k8s.io/v1`입니다. 공식 개념 문서는 "Stable since Kubernetes v1.35"로 표기합니다. 소스의 게이트 기준인 1.34와 문서 표기인 1.35가 한 버전 어긋나며, 이 글은 게이트 기준을 따릅니다.

NVIDIA DRA 드라이버에서는 `gpu-kubelet-plugin`이 GPU, MIG, VFIO 할당을 맡습니다. `compute-domain-kubelet-plugin`은 ComputeDomain과 IMEX(GPU 메모리 내보내기·가져오기를 조정하는 서비스)를 담당하며, 각 플러그인은 따로 켜고 끌 수 있습니다. DeviceClass 이름은 `gpu.nvidia.com`, `mig.nvidia.com`, `vfio.gpu.nvidia.com`, `compute-domain-daemon.nvidia.com`, `compute-domain-default-channel.nvidia.com`입니다.

장치 조건은 CEL(조건 표현식 언어)로 claim에 적습니다. 예를 들어 드라이버 저장소의 MIG 데모는 프로필을 선택한 뒤, 선택한 장치들이 같은 물리 GPU에서 나오도록 `parentUUID`를 맞춥니다.

```yaml
apiVersion: resource.k8s.io/v1
kind: ResourceClaimTemplate
metadata:
  name: mig-devices
spec:
  spec:
    devices:
      requests:
      - name: mig-1g-5gb-0
        exactly:
          deviceClassName: mig.nvidia.com
          selectors:
          - cel:
              expression: "device.attributes['gpu.nvidia.com'].profile == '1g.5gb'"
      - name: mig-2g-10gb
        exactly:
          deviceClassName: mig.nvidia.com
          selectors:
          - cel:
              expression: "device.attributes['gpu.nvidia.com'].profile == '2g.10gb'"
      constraints:
      - requests: []
        matchAttribute: "gpu.nvidia.com/parentUUID"
```

용량은 `device.capacity['gpu.nvidia.com'].memory.isGreaterThan(quantity("40Gi"))`처럼 고릅니다. 모듈을 지정하는 표현식은 `device.attributes['gpu.nvidia.com'].gpuModuleID == 1`입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 객체 모델 | DeviceClass, ResourceSlice, ResourceClaim/Template. 스케줄러가 장치 단위로 결정 | Kubernetes 문서 dynamic-resource-allocation | `✓` |
| KEP-4381 단계 | alpha 1.30, beta 1.32, GA 1.34(1.35부터 LockToDefault). `resource.k8s.io/v1` | kubernetes/enhancements kep.yaml, v1.37.1 `kube_features.go` | `✓` |
| 문서 표기 차이 | 개념 페이지는 "Stable since Kubernetes v1.35" | Kubernetes 문서 dynamic-resource-allocation | `✓` |
| 드라이버 구성 | `gpu-kubelet-plugin`, `compute-domain-kubelet-plugin`, ComputeDomain 컨트롤러. 개별 on/off | DRA 드라이버 README | `✓` |
| DeviceClass 이름 | 위 다섯 개 | DRA 드라이버 소스·문서 | `✓` |
| MIG 예시 | 프로필 선택 + `parentUUID` 일치 | 드라이버 demo gpu-test4.yaml | `✓` |
| 용량·모듈 CEL | `isGreaterThan(quantity("40Gi"))`, `gpuModuleID == 1` | 같은 레퍼런스 | `✓` |

{{% /details %}}

## 3. 토폴로지는 공개된 속성으로 고른다

GPU와 NIC를 같은 PCIe 루트에 묶는 조건도 claim에 적을 수 있습니다. Kubernetes의 표준 장치 속성 문서는 `resource.kubernetes.io/pcieRoot`를 `pci<domain>:<bus>` 형식으로 정의합니다. 이 속성을 `matchAttribute`로 맞춰 같은 PCIe 루트 아래의 장치를 묶으면 지연이 가장 낮다고 설명합니다.

표준 속성에는 `resource.kubernetes.io/pciBusID`도 있습니다. `resource.kubernetes.io/numaNode`는 스칼라 값과 리스트를 지원합니다. 스칼라는 별도 게이트 없이 쓰고, 리스트는 `DRAListTypeAttributes`가 필요하며 교집합으로 맞춥니다.

GPU와 NIC를 함께 요청하는 공식 YAML 예시는 없습니다. 아래는 표준 속성의 정의에 맞춰 구성한 형태입니다. `deviceClassName`은 실제 NIC DRA 드라이버의 것으로 바꿔야 하며, AWS의 `efa.networking.k8s.aws`가 한 예입니다.

```yaml
apiVersion: resource.k8s.io/v1
kind: ResourceClaim
metadata:
  name: gpu-and-nic
spec:
  devices:
    requests:
    - name: gpu
      exactly:
        deviceClassName: gpu.nvidia.com
    - name: nic
      exactly:
        deviceClassName: <nic-driver-class>
    constraints:
    - requests: ["gpu", "nic"]
      matchAttribute: resource.kubernetes.io/pcieRoot
```

이 구성은 GPU와 NIC를 한 claim에서 요청하고 같은 PCIe 루트라는 조건을 공유하게 합니다. NIC 쪽 구성은 [07편]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}})에서 다룹니다.

NVIDIA 드라이버가 공개하는 GPU 속성은 `type`, `uuid`, `productName`, `brand`, `architecture`, `cudaComputeCapability`, `driverVersion`, `cudaDriverVersion`, `addressingMode`와 표준 속성 셋입니다. 용량으로는 `memory`를 공개합니다. MIG 장치에는 `parentUUID`, `profile`이 있고, `multiprocessors`, `memory`, `copyEngines` 등의 용량이 제공됩니다.

레퍼런스에서 노드 안의 NVLink 연결이나 clique를 나타내는 속성은 찾지 못했습니다. NVSwitch 보드에서는 선택할 필요가 없고, Shared NVSwitch 환경은 `FabricManagerPartitioning`(alpha)을 켰을 때 `partition<N>` 속성으로 표현합니다. 노드 안 GPU 연결 구조는 [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}})에서 다뤘습니다.

드라이버의 Shared NVSwitch 데모는 GPU 2장을 같은 파티션에서 받도록 요청합니다.

```yaml
apiVersion: resource.k8s.io/v1
kind: ResourceClaimTemplate
metadata:
  name: fm-partition-2gpu
spec:
  spec:
    devices:
      requests:
      - name: gpus
        exactly:
          deviceClassName: vfio.gpu.nvidia.com
          allocationMode: ExactCount
          count: 2
      constraints:
      - requests:
        - gpus
        matchAttribute: gpu.nvidia.com/partition2
```

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 표준 속성 | `pcieRoot`, `pciBusID`, `numaNode`(스칼라는 게이트 불필요, 리스트는 `DRAListTypeAttributes`, 교집합 매칭) | Kubernetes 문서 dra-standard-device-attributes | `✓` |
| NVIDIA 공개 속성 | GPU 속성·용량, MIG 속성·용량. NVLink·clique 속성 없음 | DRA 드라이버 reference/resourceslice-attributes, `deviceinfo.go` | `✓` |
| Shared NVSwitch 표현 | `FabricManagerPartitioning`(alpha) 사용 시 `gpuModuleID`, `partition<N>` | 같은 레퍼런스 | `✓` |
| 파티션 예시 | `vfio.gpu.nvidia.com`, `partition2` 일치 | 드라이버 demo fabric-manager-partitioning | `✓` |
| GPU+NIC `pcieRoot` 예시 | 공식 YAML 없음. 표준 속성 정의에 맞춰 구성. AWS EFA 클래스는 `efa.networking.k8s.aws` | 표준 속성 문서에서 구성 | `≈` |

{{% /details %}}

## 4. 기존 요청을 옮겨도 운영 조건은 남는다

KEP-5004가 1.37에서 GA가 되면서 기존 GPU 요청 문법을 DRA에 연결할 수 있게 됐습니다. DeviceClass에 `spec.extendedResourceName: nvidia.com/gpu`가 있으면, `resources.limits: nvidia.com/gpu: 1`로 작성한 파드에도 스케줄러가 ResourceClaim을 자동으로 만듭니다. 파드에는 어노테이션 `resource.kubernetes.io/extended-resource-claim: "true"`가 붙고 `status.extendedResourceClaimStatus`가 채워집니다. 이 경로를 쓰려면 device plugin이 설치돼 있지 않거나 꺼져 있어야 합니다.

설치 경로에 따라 DeviceClass 설정도 다릅니다. 독립 Helm 차트의 데모 주석은 `gpu.nvidia.com`에 이 값이 이미 설정돼 있다고 설명합니다. GPU Operator 26.7 문서는 Operator가 관리하는 `gpu.nvidia.com`에는 이 값이 없다고 적고, `deviceclass.resource.kubernetes.io/gpu.nvidia.com`으로 요청하거나 별도 DeviceClass를 만들도록 안내합니다. 두 출처의 차이는 설치 경로에서 비롯된 것으로 보입니다.

후속 기능은 KEP마다 단계가 다릅니다. 다음 표는 kubernetes/enhancements의 kep.yaml과 v1.37.1 `kube_features.go`를 대조한 결과입니다.

| KEP | 기능 | alpha | beta | GA | v1.37 상태 |
|---|---|---|---|---|---|
| 4381 | Structured Parameters | 1.30 | 1.32 | 1.34 | GA |
| 4816 | Prioritized List (`firstAvailable`) | 1.33 | 1.34 | 1.36 | GA |
| 5018 | Admin Access | 1.33 | 1.34 | 1.36 | GA |
| 5055 | Device Taints & Tolerations | 1.33 | 1.36 | 1.37 | GA (1.38에서 lock 예정) |
| 5004 | Extended Resource 매핑 | 1.34 | 1.36 | 1.37 | GA |
| 4815 | Partitionable Devices | 1.33 | 1.36 | 1.38 목표 | beta, 기본 on |
| 5075 | Consumable Capacity | 1.34 | 1.36 | 1.38 목표 | beta, 기본 on |
| 5007 | Device Binding Conditions | 1.34 | 1.36 | 1.38 목표 | beta |
| 5491 | List Types for Attributes | 1.36 | 1.38 목표 | — | alpha, 기본 off |
| 6072 | 표준 `numaNode` 속성 | — | — | 1.37 목표 | 스칼라는 게이트 없이 사용 가능 |
| 5690 | DRA Preemption | 1.38 목표 | — | — | 미구현 |
| 4680 | 파드 status의 리소스 health | 1.31 | 1.36 | 1.37 목표 | beta |

위 KEP 현황에서 알리바바식 커스텀 리소스는 [02편]({{< relref "/platform/kubernetes/gpu/02-allocation-device-plugin/index.md" >}})의 세 군데에 남습니다. 업스트림은 같은 문제를 DRA의 속성, 용량, 파티션, consumable capacity로 흡수하는 중입니다. NVIDIA 드라이버도 FM 파티션, MPS, 공유를 DRA 게이트로 옮기고 있으며, 이 기능들은 대부분 아직 alpha입니다.

선점이 필요한 환경에서는 아직 제약이 있습니다. Kubernetes 문서는 "The Kubernetes scheduler doesn't support preemption for DRA resources"라고 명시합니다. KEP-5690의 alpha 목표가 1.38이므로, 선점 미지원은 당분간 DRA 전환을 늦출 이유가 될 것으로 보입니다.

NVIDIA 드라이버 v0.5.x에도 기본으로 꺼진 alpha 게이트가 많습니다. `DynamicMIG`, `MPSSupport`, `TimeSlicingSettings`, `NVMLDeviceHealthCheck`, `PassthroughSupport`, `FabricManagerPartitioning`, `HostManagedIMEXDaemon` 등이 해당합니다. 일부 게이트는 함께 켤 수 없습니다. DynamicMIG는 PassthroughSupport, NVMLDeviceHealthCheck, MPSSupport와 상호배타적입니다. 공유와 상태 보고 기능의 alpha 상태 역시 전환을 늦출 이유가 됩니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| KEP 단계 표 | 각 KEP의 alpha·beta·GA 버전과 v1.37 상태 | kubernetes/enhancements kep.yaml과 v1.37.1 `pkg/features/kube_features.go` 대조 | `✓` |
| 선점 미지원 | "The Kubernetes scheduler doesn't support preemption for DRA resources." KEP-5690은 1.38 alpha 목표 | Kubernetes 문서 dynamic-resource-allocation, KEP-5690 | `✓` |
| extended resource 자동 claim | `spec.extendedResourceName`, 어노테이션 `resource.kubernetes.io/extended-resource-claim`, `status.extendedResourceClaimStatus`. device plugin이 없거나 꺼져 있어야 함 | 드라이버 demo extended-resources/gpu-full.yaml, KEP-5004 | `✓` |
| 설치 경로별 `extendedResourceName` 차이 | 독립 Helm 차트는 설정됨, GPU Operator 관리 DeviceClass는 없음 | 드라이버 demo 주석, GPU Operator 26.7 문서 | `✓` |
| 설치 경로 때문이라는 해석 | 두 서술이 어긋나는 이유 | 위 둘을 대조 | `≈` |
| alpha 게이트 | `DynamicMIG`·`MPSSupport`·`TimeSlicingSettings`·`NVMLDeviceHealthCheck`·`PassthroughSupport`·`FabricManagerPartitioning`·`HostManagedIMEXDaemon` 등(v0.5.x, 기본 off). DynamicMIG ↔ PassthroughSupport·NVMLDeviceHealthCheck·MPSSupport 상호배타 | DRA 드라이버 문서 | `✓` |

{{% /details %}}

## 5. 노드 간 NVLink는 채널과 배치를 함께 맞춘다

EKS 문서와 드라이버 데모의 MNNVL(Multi-Node NVLink) 예시는 GPU 자체를 device plugin의 `nvidia.com/gpu: 4`로 요청하고, IMEX 채널만 DRA claim으로 받습니다. 현재 GB200 운영의 주류는 이 병행 구성입니다.

NVIDIA IMEX 가이드는 NVLink 도메인을 NVLink로 통신할 수 있는 노드의 집합으로 정의합니다. IMEX 서비스는 OS 도메인, 즉 노드 사이에서 GPU 메모리 내보내기·가져오기(NVLink P2P)를 조정합니다. IMEX 도메인은 `nodes_config.cfg`로 서로 통신하도록 설정된 노드 집합입니다. 4세대 NVSwitch에서는 Fabric Manager가 제어평면을 제공하고 NVLSM과 NMX-Controller가 함께 동작합니다.

노드 간 접근 권한은 IMEX 채널로 나눕니다. 드라이버는 `nvidia-caps-imex-channels` 문자 장치를 등록하지만 `/dev/nvidia-caps-imex-channels/channelN` 노드를 기본으로 만들지는 않습니다. 모듈 파라미터가 `NVreg_CreateImexChannel0=1`이면 channel0만 자동으로 생성합니다. NVIDIA 가이드는 사용자마다 채널 하나에만 접근하도록 권고합니다. 멀티노드에서는 모든 노드의 채널 할당을 같게 맞춰야 하며, 어긋나면 `ILLEGAL STATE` 오류가 납니다.

Kubernetes에서는 ComputeDomain이 채널 생성과 노드 간 조정을 맡습니다. 기본인 `driverManaged` 모드는 ComputeDomain마다 `nvidia-imex` DaemonSet을 만들고 채널마다 ResourceClaimTemplate을 생성합니다. 파드가 채널을 claim하면 kubelet plugin이 채널 장치를 컨테이너에 넣습니다. 데몬 상태는 커스텀 리소스(CR)인 `ComputeDomainClique`로 드러납니다.

v0.5.0에서 alpha로 도입한 `hostManaged` 모드는 호스트에서 실행 중인 `nvidia-imex`를 쓰고 channel 0만 주입합니다. 이 모드는 도메인 격리만 지원하므로, 같은 호스트 IMEX 도메인에 속한 ComputeDomain들은 channel 0을 함께 씁니다.

ComputeDomain의 채널 준비와 NVLink 도메인 배치를 함께 그린 도식입니다.

{{< flow src="_flow/5-computedomain-배치.json" />}}

채널을 받는 것만으로 파드 배치 조건까지 정해지지는 않습니다. GFD(GPU Feature Discovery)가 노드에 붙이는 `nvidia.com/gpu.clique` 라벨은 `<ClusterUUID>.<CliqueID>` 형식입니다. 같은 값의 노드끼리만 MNNVL에 닿습니다. 워크로드는 `nodeAffinity`로 이 라벨의 존재를 요구하고, 멀티파드 잡은 `podAffinity`의 `topologyKey: nvidia.com/gpu.clique`로 같은 NVLink 도메인에 모읍니다. ComputeDomain이 파드를 같은 clique로 자동 제약한다는 문서 서술은 찾지 못했으므로, 사용자가 어피니티에 배치 제약을 직접 써야 합니다.

채널 주입 자체를 보여 주는 가장 작은 예시는 드라이버 저장소에 있습니다.

```yaml
apiVersion: resource.nvidia.com/v1beta1
kind: ComputeDomain
metadata:
  name: imex-channel-injection
spec:
  numNodes: 1
  channel:
    resourceClaimTemplate:
      name: imex-channel-0
---
apiVersion: v1
kind: Pod
metadata:
  name: imex-channel-injection
spec:
  containers:
  - name: ctr
    image: ubuntu:22.04
    command: ["bash", "-c"]
    args: ["ls -la /dev/nvidia-caps-imex-channels; trap 'exit 0' TERM; sleep 9999 & wait"]
    resources:
      claims:
      - name: imex-channel-0
  resourceClaims:
  - name: imex-channel-0
    resourceClaimTemplateName: imex-channel-0
```

파드는 로컬 IMEX 데몬이 준비된 뒤에 시작합니다. `numNodes`는 v25.8.0부터 elastic 동작을 위한 0을 허용합니다. 현재 문서는 이 필드를 deprecated로 표시하고 0 사용을 권합니다.

EKS 문서는 노드당 ComputeDomain(IMEX 채널)을 하나만 허용한다고 설명합니다. `allocationMode: All`로 바꾸지 말라고 경고하며, 잡마다 ComputeDomain을 하나 만들도록 권합니다. GPU Operator로 설치하고 드라이버가 사전 설치돼 있다면 호스트의 `nvidia-imex.service`를 disable하고 mask해야 합니다.

```bash
systemctl disable --now nvidia-imex.service
systemctl mask nvidia-imex.service
```

채널 주입은 컨테이너 안에서 `test -c /dev/nvidia-caps-imex-channels/channel0`으로 확인합니다. `kubectl get computedomains.resource.nvidia.com -o yaml`에서는 `status.nodes[].cliqueID`와 `status: Ready`를 봅니다.

EKS 문서의 nvbandwidth 예시는 GB200의 2노드 × 4GPU 구성에서 쌍별 약 821~822 GB/s를 보였습니다. 문서가 직접 "전체 성능을 반영하지 않을 수 있다"고 밝힌 예시 출력입니다. 실측 일반값으로 확대하지 않고 벤더가 제시한 수치로 취급합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 용어 정의 | NVLink domain, IMEX, IMEX domain(`nodes_config.cfg`), FM·NVLSM·NMX-C 역할 | NVIDIA IMEX 가이드 overview | `✓` |
| IMEX 채널 | 장치 노드 기본 미생성, `NVreg_CreateImexChannel0=1`이면 channel0 자동 생성, 재부팅 시 소멸. 사용자당 채널 1개, 노드 간 할당 불일치 시 `ILLEGAL STATE` | NVIDIA IMEX 가이드 imexchannels | `✓` |
| ComputeDomain 동작 | `driverManaged`: DaemonSet과 채널별 ResourceClaimTemplate 생성, `ComputeDomainClique` CR. `hostManaged`: v0.5.0 alpha(`HostManagedIMEXDaemon`), channel 0만 주입 | DRA 드라이버 문서 concepts/compute-domains | `✓` |
| `numNodes` | v25.8.0부터 0 허용, 현재 문서는 0 사용 권고 | 같은 문서 | `✓` |
| `nvidia-imex.service` 처리 | 드라이버 사전 설치 시 disable·mask 필요 | GPU Operator 문서 | `✓` |
| MNNVL 배치 조건 | `nvidia.com/gpu.clique`(`<ClusterUUID>.<CliqueID>`) 라벨, `nodeAffinity`·`podAffinity`(`topologyKey: nvidia.com/gpu.clique`). ComputeDomain의 자동 clique 제약 서술은 문서에 없음(부재 확인) | DRA 드라이버 가이드 compute-domain-workloads, EKS 문서 | `✓` |
| EKS 운영 조건 | 노드당 ComputeDomain 1개, `allocationMode: All` 금지, 잡마다 하나 | EKS 문서 ml-eks-nvidia-ultraserver | `✓` |
| nvbandwidth 예시 | `multinode_device_to_device_memcpy_read_ce`, 2노드 × 4GPU, 쌍별 약 821~822 GB/s. 예시 출력이며 문서도 단서를 단다 | EKS 문서 | `Ⓥ` |
| GPU는 device plugin, IMEX 채널만 DRA | 두 예시 모두 `nvidia.com/gpu: 4` + 채널 claim | EKS 문서, 드라이버 demo | `✓` |
| 채널 주입 예시 | `ComputeDomain` + Pod | 드라이버 demo/specs/imex/channel-injection.yaml | `✓` |

{{% /details %}}

## 6. GPUCluster로 전환하면 관리 범위도 달라진다

GPU Operator의 DRA 설치 명령은 `clusterPolicy.deployCR=false`를 요구합니다. 이 명령 구조로 보면 기본 설치는 ClusterPolicy와 device plugin(v0.20.1) 경로입니다. NVIDIA AICR의 AKS 가이드도 "Device-plugin whole-GPU allocation is the production default"라고 적고, DRA는 ComputeDomain과 IMEX용으로 켜 둡니다.

GPU Operator는 26.7.0부터 DRA를 같은 Operator 안의 대안 경로로 제공합니다. 이 경로에서는 `GPUCluster` CR이 DRA 드라이버, ComputeDomain, DCGM, DCGM Exporter, DRA validator를 관리합니다. 문서는 "A cluster can have either a GPUCluster or a ClusterPolicy resource, but not both."라고 명시합니다.

이 통합 경로에서는 device plugin과 DRA GPU 할당을 같은 클러스터에서 병행할 수 없습니다. ClusterPolicy에서 in-place로 전환하는 것도 지원하지 않습니다. 그래서 Operator 문서도 DRA 경로는 신규 클러스터에 권합니다.

요구 조건은 Kubernetes v1.34.2 이상, 드라이버 580 이상, CDI(Container Device Interface)를 지원하는 런타임입니다. 설치 명령은 다음과 같습니다. 별도의 `dra-driver-nvidia-gpu` Helm 릴리스를 함께 설치하면 안 됩니다.

```bash
helm upgrade --install gpu-operator nvidia/gpu-operator \
    --version=v26.7.2 \
    --namespace gpu-operator \
    --create-namespace \
    --set clusterPolicy.deployCR=false \
    --set gpuCluster.deployCR=true \
    --set driver.enabled=false
```

전환 시에는 할당 방식뿐 아니라 Operator가 관리하는 항목도 달라집니다. device plugin 경로는 Container Toolkit, GFD, MIG Manager, sandbox device plugin, Kata, KubeVirt, vGPU Manager까지 관리하지만 DRA 경로에서는 이 항목들이 빠집니다. 비정상 장치 보고도 다릅니다. device plugin 경로는 Device Plugin API로 보고하고, DRA의 기본 health 보고는 비정상 장치를 그렇게 알리지 않아 `NVMLDeviceHealthCheck`(alpha)가 필요합니다.

신규 클러스터에서 K8s 1.34.2 이상을 쓰고 메모리·모델·MIG 프로필·PCIe·NUMA 정렬 같은 고급 선택이 필요하면 GPUCluster를 검토할 만합니다.

기존 클러스터는 device plugin을 유지하고 GB200이나 GB300의 MNNVL이 있을 때 ComputeDomain을 병행하는 것이 EKS와 NVIDIA AICR의 현재 권장 형태입니다.

선점 미지원, 오토스케일러 제약(7절 표), in-place 전환 불가, 공유와 health 기능의 alpha 상태는 GPU 할당 전환을 늦출 이유가 됩니다.

## 7. 관리형 Kubernetes에서는 플랫폼의 지원 범위를 확인한다

EKS는 GPU 할당에 device plugin을 권하면서도 P6e-GB200 UltraServer의 ComputeDomain에는 DRA를 필수로 둡니다. GKE는 기본 device plugin을 끄고 NVIDIA 드라이버를 직접 설치하는 경로를 안내합니다. GKE 문서는 이 드라이버를 "owned by NVIDIA, not by GKE"라고 명시합니다.

| 플랫폼 | GPU 할당 | DRA 사용 |
|---|---|---|
| EKS | device plugin 권고 | P6e-GB200 UltraServer는 ComputeDomain용으로 필수. Karpenter 1.15+, 관리형 노드그룹, 셀프매니지드 지원. Auto Mode 미지원, Karpenter는 ComputeDomain 동적 프로비저닝 미지원. EFA는 1.34+에서 EFA DRA 드라이버 권장 |
| GKE | GKE 관리 device plugin이 기본 | Standard 모드, 1.35+. 기본 device plugin을 끄고 NVIDIA 드라이버(25.8.0+)를 직접 설치. DRA 경로에서는 time-sharing·MIG·MPS·관리형 DCGM 메트릭 불가, 노드풀 scale-to-zero 불가 |
| AKS | 정식 지원 문서를 찾지 못함 | AKS 팀 블로그(2026-03)가 DRA를 "the standard way to consume GPUs in Kubernetes"로 소개 |
| OpenShift | — | Red Hat이 4.21에서 DRA GA 발표. NVIDIA 문서는 GPU Operator 26.7 + OCP 4.21 이상, 4.22에서 검증 |

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| GPU Operator 기본은 ClusterPolicy | DRA 경로는 `clusterPolicy.deployCR=false` 지정이 필요 | GPU Operator 26.7 dra-intro-install의 설치 명령 구조에서 도출 | `≈` |
| AICR의 서술 | "Device-plugin whole-GPU allocation is the production default", DRA는 ComputeDomain·IMEX용 | NVIDIA AICR AKS 가이드 | `✓` |
| GPUCluster와 ClusterPolicy | 둘 중 하나만, in-place 전환 미지원. K8s v1.34.2+, 드라이버 580+, CDI 런타임. 별도 DRA Helm 릴리스 병행 금지 | GPU Operator 26.7 dra-intro-install | `✓` |
| DRA 경로에서 빠지는 관리 항목 | Container Toolkit·GFD·MIG Manager 등과 Device Plugin API health 보고 | 같은 문서 | `✓` |
| 전환 권고 | 신규·고급 선택은 GPUCluster, 기존은 device plugin 유지 + ComputeDomain 병행 | 위 자료를 종합 | `Σ` |
| v25.8.0 경고 | Kubernetes 1.34.0·1.34.1의 DRA 이슈, 1.33.x 또는 1.34.2 권고 | DRA 드라이버 v25.8.0 릴리스 노트 | `✓` |
| EKS | 위 표의 내용 | EKS 문서 ml-eks-nvidia-ultraserver | `✓` |
| GKE | 위 표의 내용. DRA 드라이버는 NVIDIA 소유("owned by NVIDIA, not by GKE") | GKE 문서 set-up-dra, about-dynamic-resource-allocation | `✓` |
| AKS | DRA를 표준이라 소개, Microsoft Learn 정식 문서는 못 찾음 | AKS 팀 블로그 2건 | `Ⓥ` |
| OpenShift | 4.21에서 DRA GA(업스트림 1.34 기반). NVIDIA 문서는 26.7 + OCP 4.21 이상, 4.22 검증, CRI-O의 CDI 기본 지원. 드라이버 v0.4.1이 OCP 4.22 지원 추가 | Red Hat 개발자 블로그 / NVIDIA OpenShift 문서 | `Ⓥ` / `✓` |

{{% /details %}}

## 8. 확인하지 못한 것

- GKE DRA의 GA 또는 Preview 상태
- AKS DRA의 Microsoft Learn 정식 지원 문서
- KEP-6072(`numaNode`)의 1.37 GA 여부. 별도 피처 게이트가 없을 수 있어 게이트로는 교차 확인하지 못했습니다.
- `NCCL_MNNVL_ENABLE`의 기본값과 NVLS를 컨테이너에서 쓸 때 IMEX 채널이 필요한지
- GB200 NVL72에서 FM과 NMX가 어느 트레이에서 도는지, NVLSM의 정확한 배치
- Fabric Manager와 드라이버 버전의 정확한 일치 요건

## 참고 자료

- [Kubernetes — Dynamic Resource Allocation](https://kubernetes.io/docs/concepts/scheduling-eviction/dynamic-resource-allocation/)
- [Kubernetes — DRA 표준 장치 속성](https://kubernetes.io/docs/reference/node/dra-standard-device-attributes/)
- [KEP-4381 — DRA structured parameters](https://github.com/kubernetes/enhancements/tree/master/keps/sig-node/4381-dra-structured-parameters)
- [kubernetes/enhancements — sig-scheduling KEP들(4815, 4816, 5004, 5055, 5075, 5491, 5690, 5007)](https://github.com/kubernetes/enhancements/tree/master/keps/sig-scheduling)
- [Kubernetes v1.37.1 — kube_features.go](https://github.com/kubernetes/kubernetes/blob/v1.37.1/pkg/features/kube_features.go)
- [DRA Driver for NVIDIA GPUs 저장소](https://github.com/kubernetes-sigs/dra-driver-nvidia-gpu)
- [DRA Driver for NVIDIA GPUs 릴리스](https://github.com/kubernetes-sigs/dra-driver-nvidia-gpu/releases)
- [DRA 드라이버 — ComputeDomain 개념](https://dra-driver-nvidia-gpu.sigs.k8s.io/docs/concepts/compute-domains/)
- [DRA 드라이버 — ComputeDomain 워크로드 가이드](https://dra-driver-nvidia-gpu.sigs.k8s.io/docs/guides/compute-domain-workloads/)
- [DRA 드라이버 — ResourceSlice 속성 레퍼런스](https://dra-driver-nvidia-gpu.sigs.k8s.io/docs/reference/resourceslice-attributes/)
- [NVIDIA GPU Operator — DRA 소개와 설치(26.7)](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/26.7/dra-intro-install.html)
- [NVIDIA GPU Operator 릴리스](https://github.com/NVIDIA/gpu-operator/releases)
- [NVIDIA AICR — AKS GPU 설정](https://docs.nvidia.com/aicr/v1.0.0/integrator-guide/aks-gpu-setup.md)
- [NVIDIA IMEX 가이드 — 개요](https://docs.nvidia.com/multi-node-nvlink-systems/imex-guide/overview.html)
- [NVIDIA IMEX 가이드 — 채널](https://docs.nvidia.com/multi-node-nvlink-systems/imex-guide/imexchannels.html)
- [AWS EKS — NVIDIA UltraServer](https://docs.aws.amazon.com/eks/latest/userguide/ml-eks-nvidia-ultraserver.html)
- [GKE — DRA 설정](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/set-up-dra)
- [GKE — DRA 개념](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/about-dynamic-resource-allocation)
- [AKS 블로그 — DRA와 vGPU](https://blog.aks.azure.com/2026/03/06/dra-with-vGPUs-on-aks)
- [AKS 블로그 — DRA와 MIG](https://blog.aks.azure.com/2026/03/03/multi-instance-gpu-with-dra-on-aks)
- [Red Hat — OpenShift 4.21의 DRA GA](https://developers.redhat.com/articles/2026/03/25/dynamic-resource-allocation-goes-ga-red-hat-openshift-421-smarter-gpu)
- [NVIDIA — OpenShift에서의 DRA GPU](https://docs.nvidia.com/datacenter/cloud-native/openshift/latest/dra-gpu-ocp.html)
