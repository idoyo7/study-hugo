---
title: "03 GPU 할당을 DRA로 옮길 시점"
description: "2026-10-21 기준 단순 GPU 개수 할당은 device plugin이 여전히 기본이고, 노드 간 NVLink에는 DRA 기반 ComputeDomain이 필요하다. 장치 속성 선택, 설치 방식, 선점과 오토스케일 제약을 기준으로 전환 시점을 판단한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 3
url: "/kubernetes/gpu/03-allocation-dra/"
---

# 03 · GPU 할당을 DRA로 옮길 시점

GPU를 개수로 요청해 쓰고 있다면 DRA(Dynamic Resource Allocation)가 GA(정식 제공)가 됐다는 이유만으로 할당 방식을 옮길 필요는 없습니다. 2026-10-21에 확인한 설치 문서와 운영 예시에서는 device plugin과 GPU Operator가 여전히 기본 경로입니다. 장치의 메모리·모델·위치까지 선택해야 하거나, GB200처럼 NVLink가 노드를 넘어 연결되는 환경에서는 DRA가 맡는 일이 달라집니다.

특히 멀티노드 NVLink에서는 GPU 할당을 device plugin에 남겨 둔 채 DRA로 IMEX 채널을 받을 수 있습니다. 이때 참여 노드를 묶는 커스텀 리소스가 ComputeDomain입니다. GPU 할당 전체의 전환과 ComputeDomain의 도입은 분리해서 판단해야 합니다.

## 장치 조건을 요청하면 스케줄러가 GPU를 선택합니다 {#2-gpu-개수-대신-장치의-조건을-요청한다}

[02편]({{< relref "/platform/kubernetes/gpu/02-allocation-device-plugin/index.md" >}})의 device plugin 경로에서는 스케줄러가 개수를 보고 노드를 정한 뒤 kubelet이 GPU를 고릅니다. DRA는 장치의 속성과 용량을 스케줄러에 공개해, 요청에 맞는 장치를 스케줄링 단계에서 선택하게 합니다.

드라이버나 관리자가 DeviceClass로 장치 종류를 정의하면 드라이버는 ResourceSlice에 노드별 장치 목록·속성·용량을 게시합니다. 워크로드는 ResourceClaim 또는 ResourceClaimTemplate으로 필요한 조건을 요청합니다. 스케줄러는 그 조건을 만족하는 장치를 선택하고 해당 장치에 접근할 수 있는 노드에 파드를 배치합니다.

{{< flow src="_flow/2-dra-모델.json" />}}

이 모델의 기반인 KEP-4381(structured parameters)은 1.30에서 alpha, 1.32에서 beta, 1.34에서 GA가 됐으며, 1.35부터 게이트가 기본값에 고정됩니다(LockToDefault). API는 `resource.k8s.io/v1`입니다. 이 단계는 KEP와 v1.37.1 소스 기준입니다. Kubernetes 개념 문서는 "Stable since Kubernetes v1.35"로 적어 한 버전 차이가 있으므로 구분해 읽어야 합니다.

NVIDIA DRA 드라이버의 `gpu-kubelet-plugin`은 GPU·MIG·VFIO 할당을, `compute-domain-kubelet-plugin`은 ComputeDomain과 IMEX를 담당합니다. IMEX는 GPU 메모리의 내보내기·가져오기를 조정하는 서비스이며, ComputeDomain 컨트롤러도 드라이버 구성에 포함됩니다. 두 플러그인은 각각 켜고 끌 수 있습니다. 사용하는 DeviceClass는 `gpu.nvidia.com`, `mig.nvidia.com`, `vfio.gpu.nvidia.com`, `compute-domain-daemon.nvidia.com`, `compute-domain-default-channel.nvidia.com`입니다.

장치를 고르는 조건은 CEL(조건 표현식 언어)로 적습니다. 다음은 드라이버의 `gpu-test4.yaml` 데모입니다. MIG(Multi-Instance GPU) 프로필을 선택하면서 `parentUUID`가 같은 장치, 즉 같은 물리 GPU에서 나온 인스턴스를 요구합니다.

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

메모리 용량은 `device.capacity['gpu.nvidia.com'].memory.isGreaterThan(quantity("40Gi"))`, 모듈은 `device.attributes['gpu.nvidia.com'].gpuModuleID == 1` 같은 표현식으로 선택합니다.

## 토폴로지 제약은 드라이버가 공개한 속성으로 표현합니다 {#3-토폴로지는-공개된-속성으로-고른다}

GPU와 NIC을 같은 PCIe 루트 아래에서 받으려면 두 장치가 그 위치를 속성으로 공개해야 합니다. Kubernetes의 표준 장치 속성 문서는 `resource.kubernetes.io/pcieRoot`를 `pci<domain>:<bus>` 형식으로 정의하며, `matchAttribute`로 이 값을 맞추면 같은 PCIe 루트에 있는 장치를 선택해 지연을 가장 낮출 수 있다고 설명합니다.

표준 속성에는 `resource.kubernetes.io/pciBusID`와 `resource.kubernetes.io/numaNode`도 있습니다. `numaNode`의 스칼라 값에는 별도 게이트가 필요하지 않습니다. 리스트를 사용하려면 `DRAListTypeAttributes`를 켜야 하며, 이 경우 교집합으로 조건을 맞춥니다.

아래 YAML은 공식 GPU+NIC 예제를 가져온 것이 아니라 표준 속성 정의에 맞춰 구성한 예시입니다. `deviceClassName`은 실제 NIC 드라이버의 클래스로 바꿔야 합니다. AWS EFA 드라이버의 `efa.networking.k8s.aws`가 그 예입니다.

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

한 claim 안에서 GPU와 NIC을 요청하고 같은 `pcieRoot` 값을 요구하는 형태입니다. NIC 드라이버와 연결하는 과정은 [07편]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}})에서 다룹니다.

NVIDIA 드라이버의 ResourceSlice 레퍼런스와 `deviceinfo.go`에는 GPU 속성으로 `type`, `uuid`, `productName`, `brand`, `architecture`, `cudaComputeCapability`, `driverVersion`, `cudaDriverVersion`, `addressingMode`, 표준 속성 셋이 나옵니다. 용량은 `memory`를 공개합니다. MIG 장치는 `parentUUID`·`profile`과 `multiprocessors`·`memory`·`copyEngines` 등의 용량을 제공합니다.

노드 안 NVLink 연결이나 clique를 표현하는 속성은 이 레퍼런스에서 찾지 못했습니다. [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}})에서 본 균일한 NVSwitch 보드라면 조합을 나눠 고를 필요가 없다고 볼 수 있습니다. 허용 조합이 제한되는 Shared NVSwitch에서는 alpha 게이트인 `FabricManagerPartitioning`을 켜 `gpuModuleID`와 `partition<N>`으로 표현합니다. 다음 드라이버 데모는 `partition2`가 같은 GPU 두 장을 요청합니다.

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

## 노드 간 NVLink에는 IMEX 채널과 배치 제약이 필요합니다 {#5-노드-간-nvlink는-채널과-배치를-함께-맞춘다}

EKS 문서와 드라이버의 MNNVL(Multi-Node NVLink) 데모는 GPU를 `nvidia.com/gpu: 4`로 요청하고 IMEX 채널만 DRA claim으로 받습니다. 이 예시들을 기준으로 보면 현재 GB200에서는 device plugin과 ComputeDomain을 병행하는 구성이 주로 안내됩니다.

NVIDIA IMEX 가이드에서 NVLink 도메인은 NVLink로 통신할 수 있는 노드 집합입니다. IMEX 서비스는 서로 다른 OS 도메인, 즉 노드 사이에서 GPU 메모리 내보내기·가져오기(NVLink P2P)를 조정합니다. `nodes_config.cfg`로 서로 통신하도록 설정한 노드 집합은 IMEX 도메인이라고 부릅니다. 4세대 NVSwitch에서는 Fabric Manager가 제어평면을 제공하며 NVLSM과 NMX-Controller가 함께 동작합니다.

IMEX 채널은 노드 간 접근 권한을 나누는 데 쓰입니다. 드라이버는 `nvidia-caps-imex-channels` 문자 장치를 등록하지만 `/dev/nvidia-caps-imex-channels/channelN` 장치 노드를 기본으로 만들지는 않습니다. `NVreg_CreateImexChannel0=1`이면 channel0만 자동 생성합니다. 장치 노드는 재부팅하면 사라집니다. NVIDIA는 사용자마다 채널 하나에만 접근하도록 권고하며, 멀티노드에서는 모든 노드의 채널 할당을 일치시켜야 한다고 설명합니다. 할당이 다르면 `ILLEGAL STATE` 오류가 발생합니다.

ComputeDomain은 Kubernetes에서 이 채널 생성과 노드 간 조정을 맡습니다. 기본 `driverManaged` 모드는 ComputeDomain별 `nvidia-imex` DaemonSet과 채널별 ResourceClaimTemplate을 만듭니다. 파드가 claim을 요청하면 kubelet plugin이 채널 장치를 컨테이너에 넣고, 데몬 상태는 `ComputeDomainClique` CR에 표시합니다.

v0.5.0에서 alpha로 도입한 `hostManaged` 모드는 `HostManagedIMEXDaemon` 게이트를 사용합니다. 호스트의 기존 `nvidia-imex`를 이용하고 channel 0만 주입하므로 도메인 격리만 지원합니다. 같은 호스트 IMEX 도메인의 ComputeDomain들은 channel 0을 공유합니다.

{{< flow src="_flow/5-computedomain-배치.json" />}}

채널이 준비돼도 통신할 파드를 같은 NVLink 도메인에 모으는 조건은 별도로 필요합니다. GFD(GPU Feature Discovery)의 `nvidia.com/gpu.clique` 라벨은 `<ClusterUUID>.<CliqueID>` 형식이며, 값이 같은 노드끼리만 MNNVL로 연결됩니다. 워크로드는 `nodeAffinity`로 라벨의 존재를 요구하고, 멀티파드 잡에는 `podAffinity`와 `topologyKey: nvidia.com/gpu.clique`를 지정합니다. ComputeDomain이 같은 clique에 파드를 자동으로 모은다는 문서 서술은 찾지 못했으므로 배치 제약을 직접 적어야 합니다. 더 넓은 노드 계층의 배치는 [04편]({{< relref "/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md" >}})에서 다룹니다.

다음은 드라이버의 `demo/specs/imex/channel-injection.yaml`입니다. ComputeDomain과 채널을 요청하는 Pod를 함께 정의합니다.

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

파드는 로컬 IMEX 데몬이 준비된 뒤 시작합니다. 예시의 `numNodes`는 v25.8.0부터 elastic 동작을 위한 0도 허용합니다. 현재 문서는 이 필드를 deprecated로 표시하고 0 사용을 권합니다.

EKS는 노드당 ComputeDomain(IMEX 채널)을 하나만 허용하며 잡마다 ComputeDomain 하나를 만들도록 권합니다. `allocationMode: All`로 바꾸지 말라는 경고도 있습니다. GPU Operator로 설치할 때 드라이버가 사전 설치돼 있다면, Operator 문서에 따라 호스트의 `nvidia-imex.service`를 disable하고 mask해야 합니다.

```bash
systemctl disable --now nvidia-imex.service
systemctl mask nvidia-imex.service
```

컨테이너에서는 `test -c /dev/nvidia-caps-imex-channels/channel0`으로 채널 주입을 확인합니다. `kubectl get computedomains.resource.nvidia.com -o yaml`에서는 `status.nodes[].cliqueID`와 `status: Ready`를 봅니다.

EKS의 nvbandwidth 예시는 GB200 2노드 × 4GPU에서 `multinode_device_to_device_memcpy_read_ce`의 쌍별 값으로 약 821~822 GB/s를 제시합니다. 문서가 "전체 성능을 반영하지 않을 수 있다"고 밝힌 예시 출력이므로 다른 환경에 적용할 실측 일반값으로 받아들여서는 안 됩니다.

## GA 표기보다 설치 경로의 지원 조건을 확인합니다 {#1-ga-표기는-다르고-기본-경로는-그대로다}

GPU 할당을 DRA로 옮길 때는 GA라는 표현만으로 지원 범위를 판단하기 어렵습니다. NVIDIA 관련 자료 사이에도 상태 표기가 다릅니다.

| 출처 | GPU 할당과 ComputeDomain에 대한 설명 |
|---|---|
| v25.12.0 릴리스 노트(2026-02-12) | "general availability of the GPU allocation plugin" 선언 |
| GPU Operator 26.7 문서 | 전체 GPU·기존 MIG 장치 할당과 ComputeDomain을 GA로 표기 |
| kubernetes-sigs 저장소 main README | GPU 할당은 "not yet officially supported"이며 Helm 기본값에서 꺼져 있다고 설명 |
| 같은 main의 Helm values | `resources.gpus.enabled: true` |
| AWS EKS 문서 | GPU 할당이 experimental을 벗어날 때까지 NVIDIA device plugin 권고. 예시는 `resources.gpus.enabled: false` |

README와 values의 차이는 README가 갱신되지 않았기 때문으로 보이지만, 이는 두 파일을 비교한 추정입니다. ComputeDomain 관련 `ComputeDomainCliques`와 `IMEXDaemonsWithDNSNames` 게이트도 GPU Operator 문서에는 GA, sigs 문서에는 Beta(기본 on)로 적혀 있습니다.

저장소와 배포 위치도 바뀌었습니다. `NVIDIA/k8s-dra-driver-gpu`는 `kubernetes-sigs/dra-driver-nvidia-gpu`로 리다이렉트됩니다. 이전 후 첫 릴리스는 v0.4.0(2026-05-15)이며, CalVer에서 SemVer로 버전 체계를 바꾸고 Helm 차트를 registry.k8s.io로 옮겼습니다.

## 요청 문법을 유지해도 전환 제약은 사라지지 않습니다 {#4-기존-요청을-옮겨도-운영-조건은-남는다}

KEP-5004는 1.37에서 GA가 됐습니다. DeviceClass에 `spec.extendedResourceName: nvidia.com/gpu`를 설정하면 기존 `resources.limits: nvidia.com/gpu: 1` 요청에도 스케줄러가 ResourceClaim을 자동 생성합니다. 파드에는 `resource.kubernetes.io/extended-resource-claim: "true"` 어노테이션과 `status.extendedResourceClaimStatus`가 채워집니다. 이 경로에서는 device plugin이 설치돼 있지 않거나 꺼져 있어야 합니다.

설치 방법에 따라 DeviceClass의 기본 설정은 다릅니다. 독립 Helm 차트의 `extended-resources/gpu-full.yaml` 데모 주석은 `gpu.nvidia.com`에 `extendedResourceName`이 이미 설정돼 있다고 설명합니다. GPU Operator 26.7 문서는 Operator가 관리하는 클래스에는 이 값이 없다고 적고, `deviceclass.resource.kubernetes.io/gpu.nvidia.com`으로 요청하거나 별도 DeviceClass를 만들도록 안내합니다. 이 차이가 설치 경로 때문이라는 설명은 두 자료를 대조한 해석입니다.

기반 API가 GA여도 후속 기능은 각기 다른 단계에 있습니다. 다음은 kubernetes/enhancements의 kep.yaml과 v1.37.1 `kube_features.go`를 대조한 현황입니다.

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

선점이 필요하다면 전환 전에 이 제약부터 검토해야 합니다. Kubernetes 문서는 "The Kubernetes scheduler doesn't support preemption for DRA resources."라고 명시합니다. KEP-5690의 alpha 목표는 1.38이므로, 조사 시점에는 선점 미지원이 GPU 할당 전환을 늦출 이유가 됩니다.

NVIDIA 드라이버 v0.5.x의 `DynamicMIG`, `MPSSupport`, `TimeSlicingSettings`, `NVMLDeviceHealthCheck`, `PassthroughSupport`, `FabricManagerPartitioning`, `HostManagedIMEXDaemon`도 alpha이며 기본 비활성입니다. DynamicMIG는 PassthroughSupport·NVMLDeviceHealthCheck·MPSSupport와 함께 켤 수 없습니다. 공유·분할·상태 보고를 사용한다면 기본 GPU 할당의 GA 여부와 이 기능들의 성숙도를 따로 확인해야 합니다.

[02편]({{< relref "/platform/kubernetes/gpu/02-allocation-device-plugin/index.md" >}})의 ACK 매니지드, Koordinator·Volcano+HAMi, Shared NVSwitch에서 쓰는 커스텀 리소스 문제를 업스트림은 속성·용량·파티션·consumable capacity로 다루고 있습니다. NVIDIA도 FM 파티션·MPS·공유를 DRA 게이트로 제공하지만 상당수가 아직 alpha라는 점은 그대로 남습니다.

## GPUCluster 전환은 Operator의 관리 범위도 바꿉니다 {#6-gpucluster로-전환하면-관리-범위도-달라진다}

GPU Operator는 26.7.0부터 DRA를 같은 Operator 안의 대안 경로로 제공합니다. 이 경로의 `GPUCluster` CR은 DRA 드라이버, ComputeDomain, DCGM, DCGM Exporter, DRA validator를 관리합니다. 문서는 "A cluster can have either a GPUCluster or a ClusterPolicy resource, but not both."라고 명시합니다.

DRA 설치 명령에 `clusterPolicy.deployCR=false`가 필요하다는 점에서 기본 설치는 ClusterPolicy와 device plugin(v0.20.1) 경로로 해석됩니다. NVIDIA AICR의 AKS 가이드도 "Device-plugin whole-GPU allocation is the production default"라고 설명하고 DRA는 ComputeDomain·IMEX용으로 켜 둡니다.

GPUCluster 통합 경로에서는 device plugin과 DRA GPU 할당을 같은 클러스터에서 병행할 수 없습니다. ClusterPolicy에서 in-place로 전환하는 것도 지원하지 않아 Operator 문서는 신규 클러스터에 DRA 경로를 권합니다. 앞서 본 device plugin과 ComputeDomain의 병행 예시를 GPUCluster 전환과 혼동하지 않아야 합니다.

요구 조건은 Kubernetes v1.34.2 이상, 드라이버 580 이상, CDI(Container Device Interface) 지원 런타임입니다. 별도 `dra-driver-nvidia-gpu` Helm 릴리스를 함께 설치하면 안 됩니다.

```bash
helm upgrade --install gpu-operator nvidia/gpu-operator \
    --version=v26.7.2 \
    --namespace gpu-operator \
    --create-namespace \
    --set clusterPolicy.deployCR=false \
    --set gpuCluster.deployCR=true \
    --set driver.enabled=false
```

DRA 경로에서는 기존 device plugin 경로가 관리하던 Container Toolkit, GFD, MIG Manager, sandbox device plugin, Kata, KubeVirt, vGPU Manager가 관리 대상에서 빠집니다. 비정상 장치 보고도 달라집니다. device plugin은 Device Plugin API로 상태를 보고하지만 DRA 기본 health 보고는 같은 방식으로 비정상 장치를 알리지 않으므로 `NVMLDeviceHealthCheck`(alpha)가 필요합니다.

이 조건들을 종합하면 Kubernetes 1.34.2 이상의 신규 클러스터에서 메모리·모델·MIG 프로필·PCIe·NUMA 정렬을 선택해야 할 때 GPUCluster를 검토할 만합니다. 기존 클러스터에서는 device plugin을 유지하고 GB200·GB300의 MNNVL에 ComputeDomain을 병행하는 구성이 EKS와 NVIDIA AICR이 현재 안내하는 형태입니다. 선점, 공유와 health 기능, in-place 전환, 아래 관리형 플랫폼의 오토스케일 제약까지 검토한 뒤 GPU 할당을 옮길지 판단해야 합니다.

## 관리형 플랫폼의 지원 범위는 별도로 확인합니다 {#7-관리형-kubernetes에서는-플랫폼의-지원-범위를-확인한다}

EKS는 GPU 할당에 device plugin을 권하면서 P6e-GB200 UltraServer의 ComputeDomain에는 DRA를 필수로 둡니다. GKE는 기본 device plugin을 끄고 NVIDIA 드라이버를 직접 설치하도록 안내하며, 그 드라이버를 "owned by NVIDIA, not by GKE"라고 명시합니다.

| 플랫폼 | GPU 할당 | DRA 사용 |
|---|---|---|
| EKS | device plugin 권고 | P6e-GB200 UltraServer는 ComputeDomain용으로 필수. Karpenter 1.15+, 관리형 노드그룹, 셀프매니지드 지원. Auto Mode 미지원, Karpenter는 ComputeDomain 동적 프로비저닝 미지원. EFA는 1.34+에서 EFA DRA 드라이버 권장 |
| GKE | GKE 관리 device plugin이 기본 | Standard 모드, 1.35+. 기본 device plugin을 끄고 NVIDIA 드라이버(25.8.0+)를 직접 설치. DRA 경로에서는 time-sharing·MIG·MPS·관리형 DCGM 메트릭 불가, 노드풀 scale-to-zero 불가 |
| AKS | 정식 지원 문서를 찾지 못함 | AKS 팀 블로그(2026-03)가 DRA를 "the standard way to consume GPUs in Kubernetes"로 소개 |
| OpenShift | — | Red Hat이 4.21에서 DRA GA 발표. NVIDIA 문서는 GPU Operator 26.7 + OCP 4.21 이상, 4.22에서 검증 |

AKS의 설명은 2026-03 팀 블로그에서 확인했으며 Microsoft Learn의 정식 지원 문서는 찾지 못했습니다. OpenShift의 4.21 DRA GA는 업스트림 1.34 기반이라는 Red Hat의 발표입니다. NVIDIA 문서는 GPU Operator 26.7과 OCP 4.21 이상을 요구하고 4.22에서 검증했다고 설명하며, CRI-O의 CDI 기본 지원도 명시합니다. 드라이버 v0.4.1은 OCP 4.22 지원을 추가했습니다.

드라이버 v25.8.0 릴리스 노트는 Kubernetes 1.34.0·1.34.1의 DRA 문제를 경고하며 1.33.x 또는 1.34.2를 권했습니다. 이 과거 호환성 안내와 현재 GPU Operator의 최소 버전 요구는 적용 대상을 구분해 읽어야 합니다.

## 조사 범위와 남은 확인 사항 {#8-확인하지-못한-것}

조사 기준일은 2026-10-21입니다. Kubernetes v1.37.1(2026-09-23), GPU Operator v26.7.2(2026-10-14), DRA Driver for NVIDIA GPUs v0.5.1(2026-10-12)의 소스·릴리스와 관련 문서를 대조했습니다. 다음 항목은 확인하지 못했습니다.

- GKE DRA의 GA 또는 Preview 상태와 AKS DRA의 Microsoft Learn 정식 지원 문서.
- KEP-6072(`numaNode`)의 1.37 GA 여부. 별도 피처 게이트가 없을 수 있어 게이트로 교차 확인하지 못했습니다.
- `NCCL_MNNVL_ENABLE`의 기본값, NVLS를 컨테이너에서 사용할 때 IMEX 채널이 필요한지.
- GB200 NVL72에서 FM과 NMX가 실행되는 트레이와 NVLSM의 정확한 배치.
- Fabric Manager와 드라이버 버전의 정확한 일치 요건.

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
