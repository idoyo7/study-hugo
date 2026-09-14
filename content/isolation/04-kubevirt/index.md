---
title: "KubeVirt"
linkTitle: "04 KubeVirt"
weight: 4
date: 2026-09-14
lastmod: 2026-09-14
---

# 04 · KubeVirt — VM을 파드로 다룰 때 따라오는 계약

{{< callout type="info" >}}
- **KubeVirt FAQ에 정의가 그대로 있다** — "Kata containers are containers inside virtual machines. KubeVirt is a virtual machine inside a container." `✓`
- **라이브 마이그레이션과 hotplug, 무중단 업그레이드는 RWX 공유 스토리지가 없으면 셋 다 못 쓴다** `✓`.
- **파드가 축출되면 VM도 끝난다** — `evictionStrategy: LiveMigrate`가 걸린 VMI마다 PodDisruptionBudget이 자동으로 생성된다 `✓`.
- **v1.9.0(2026-07-30)에서 Beta 게이트가 전부 기본 on이 됐다** — cgroup v1은 deprecated돼 다음 릴리스에서 제거될 예정이다 `✓`.
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

QEMU 프로세스는 virt-launcher 파드의 cgroup과 namespace 안에서 돕니다. 파드가 죽으면 VM도 죽습니다. KubeVirt는 컨테이너화되지 않은 VM을 쿠버네티스 객체로 올리므로, VM 운영에도 파드의 생명주기와 축출 규칙이 적용됩니다. VM을 계속 실행하면서 노드를 비우거나 자원을 늘리려면 스토리지와 네트워크까지 마이그레이션 조건에 맞춰야 합니다.

자매 문서: 격리 경계의 차이는 [01 경계와 위협 모델]({{< relref "../01-boundaries/index.md" >}}), 컨테이너 격리가 목적일 때의 대안은 [02 Kata Containers]({{< relref "../02-kata/index.md" >}})와 [03 gVisor]({{< relref "../03-gvisor/index.md" >}}), 워크로드별 선택은 [06 판단]({{< relref "../06-decision/index.md" >}})에서 이어집니다.

## 1. 실행 구조와 노드 전제

KubeVirt는 Kata와 같은 KVM/QEMU를 사용하지만, 컨테이너화된 애플리케이션을 VM 안에 격리하는 Kata와 출발점이 다릅니다. 아래 도식은 VM을 파드 안에서 실행하는 KubeVirt의 구조를 보여줍니다.

{{< flow src="_flow/1-구조.json" />}}

이 구조를 실행할 노드에는 `/dev/kvm`이 필요합니다. `useEmulation: true`로 소프트웨어 에뮬레이션 폴백을 사용할 수 있지만 개발용입니다. 컨테이너 런타임은 containerd와 cri-o를 지원하며, SELinux 노드에는 container-selinux가 필요합니다.

문서 작성 시점의 최신 버전은 v1.9.0(2026-07-30 태그, Kubernetes v1.36 대상)이고 릴리스 주기는 4개월입니다 `✓`. v1.9에서는 Beta 피처 게이트가 전부 기본 활성화됐습니다. cgroup v1은 deprecated돼 다음 릴리스에서 제거될 예정이므로, 노드 준비와 업그레이드 계획에 함께 반영해야 합니다 `✓`.

## 2. RWX 스토리지에 묶이는 마이그레이션과 hotplug

라이브 마이그레이션에는 RWX 공유 스토리지가 필요합니다 `✓`. 이 조건은 노드 사이로 VM을 옮길 때뿐 아니라 hotplug와 무중단 업그레이드에도 적용됩니다. CPU·메모리 hotplug도 내부적으로 라이브 마이그레이션을 동반하고 `✓`, 무중단 업그레이드를 위한 워크로드 업데이트 전략(LiveMigrate/Evict)에도 같은 스토리지 조건이 걸립니다. RWX가 없으면 셋 다 사용할 수 있으리라 기대해서는 안 됩니다.

CPU hotplug는 v1.0에서 GA가 됐지만, 문서는 "현재 구현은 VM이 라이브 마이그레이션할 것을 요구한다"고 명시합니다. CPU를 실행 중에 늘리면 워크로드 업데이터가 자동으로 마이그레이션을 트리거합니다 `✓`. 메모리 hotplug는 v1.1에서 들어왔고 최소 1GiB가 필요하며, 역시 마이그레이션을 동반합니다 `✓`. 실행 중 자원 조절이 필요한 VM이라면 도입 전에 RWX 스토리지를 확보할 수 있는지부터 확인해야 합니다.

마이그레이션의 동시 실행 수와 대역폭, 타임아웃 기본값은 다음과 같습니다.

| 파라미터 | 기본값 |
|---|---|
| `parallelMigrationsPerCluster` | 5 |
| `parallelOutboundMigrationsPerNode` | 2 |
| `bandwidthPerMigration` | 64Mi |
| `completionTimeoutPerGiB` | 800 |
| `progressTimeout` | 150 |

## 3. 네트워크 바인딩별 마이그레이션 제약

스토리지가 준비돼도 네트워크 바인딩에 따라 라이브 마이그레이션이 막힐 수 있습니다. 기본값인 masquerade는 pod IP 뒤에 게스트를 NAT로 숨기면서 라이브 마이그레이션을 완전히 지원합니다. bridge는 pod IP를 게스트에 위임하지만 라이브 마이그레이션이 명시적으로 금지됩니다.

passt는 v1.8부터 core 바인딩으로 승격됐고 메모리 250Mi를 추가로 씁니다. SR-IOV는 VF를 vfio로 넘기며, 마이그레이션 때 자동으로 hot-unplug·hot-plug됩니다 `✓`.

Service는 virt-launcher 파드의 라벨을 매칭합니다. 이 때문에 Service와 Ingress가 VM에도 별다른 작업 없이 붙습니다.

## 4. 노드 드레인과 축출을 다루는 규칙

virt-launcher 파드를 축출하면 VM도 종료됩니다. `evictionStrategy: LiveMigrate`가 걸린 VMI마다 PodDisruptionBudget이 자동으로 생성되는 이유입니다. 이 PDB는 축출을 막아 VM을 마이그레이션할 수 있도록 합니다. 앞서 본 스토리지와 네트워크 조건도 충족해야 합니다.

드레인 명령에는 `--force`가 필요합니다. virt-launcher 파드는 ReplicaSet이나 DaemonSet이 소유하지 않아서 kubectl이 재스케줄을 보장할 수 없기 때문입니다. 커스텀 PDB를 쓸 때는 `maxUnavailable` 대신 `minAvailable`을 써야 합니다. VMI가 `/scale` subresource를 구현하지 않기 때문입니다.

이 규칙은 노드 자동 정리와도 맞물립니다. Karpenter의 consolidation은 노드의 파드를 전부 축출할 수 있어야 그 노드를 정리합니다. PDB에 묶인 virt-launcher 파드가 축출되지 않으면 consolidation이 해당 노드를 정리하지 못할 수 있습니다 `≈`. 이를 정면으로 다룬 1차 문서는 찾지 못했습니다 `?`. [Karpenter]({{< relref "../../karpenter/_index.md" >}}) 챕터의 consolidation 로직과 함께 검토할 지점입니다.

## 5. 메모리 오버헤드와 성능 튜닝 비용

메모리 오버헤드는 소스 코드의 `GetMemoryOverhead` 함수가 정의합니다. 고정분은 virt-launcher 100Mi, virtqemud 40Mi, qemu 50Mi, virt-launcher-monitor 25Mi, virtlogd 25Mi를 더한 240Mi입니다. 여기에 페이지테이블(게스트 RAM/512)과 vCPU당 8Mi, IOThread 8Mi가 가변으로 붙습니다. 그래픽 디바이스 32Mi, 전용 CPU 또는 Guaranteed QoS 100Mi, VFIO 디바이스 1Gi는 옵션으로 더해집니다 `✓`. [05 성능 실측]({{< relref "../05-performance/index.md" >}}) 6장의 차트에서 이 수치를 조립한 예시를 볼 수 있습니다.

CPU 실행 성능을 조정할 때는 노드 설정도 함께 바뀝니다. `dedicatedCpuPlacement`는 Kubernetes CPU manager의 static 정책과 Guaranteed QoS를 전제로 vCPU를 물리 코어에 고정합니다. `isolateEmulatorThread`를 같이 켜면 QEMU 에뮬레이터 스레드가 vCPU 실행과 경쟁하지 않도록 별도 코어를 받습니다 `✓`.

hugepages는 노드에 미리 할당돼 있어야 하고, 요청 메모리는 hugepage 크기로 나눠떨어져야 합니다 `✓`. NUMA의 `guestMappingPassthrough`는 게스트에 호스트의 NUMA 토폴로지를 그대로 보여줍니다. 다만 문서에도 "재스케줄되면 게스트가 다른 NUMA 토폴로지를 볼 수 있다"는 제한이 있습니다 `✓`. 이런 설정에는 Guaranteed QoS와 노드 사전 준비가 따르므로, 성능을 위해 설정을 추가할수록 VM을 배치할 수 있는 노드가 제한됩니다 `Σ`.

운영 중 자원 사용은 KubeVirt의 `/metrics` 엔드포인트가 제공하는 Prometheus 메트릭으로 관측할 수 있습니다. VMI 런타임 메트릭은 `kubevirt_vmi_memory_resident_bytes`, `kubevirt_vmi_network_traffic_bytes_total`, `kubevirt_vmi_vcpu_seconds_total` 같은 `kubevirt_vmi` 접두사를 씁니다 `✓`.

## 6. 디스크 반입과 Windows 게스트 준비

디스크를 게스트에 넣는 경로는 CDI(Containerized Data Importer)가 담당합니다. DataVolume이 받는 소스 종류는 `http`/`s3`/`gcs`(원격 다운로드), `registry`(컨테이너 이미지를 디스크로), `pvc`(기존 PVC 복제), `snapshot`, `upload`, `blank`, 그리고 vSphere 이주에 쓰는 `imageio`·`vddk`입니다 `✓`.

Windows 게스트에는 viostor·viorng 같은 virtio 드라이버가 필요합니다. EFI를 켜면 Secure Boot도 함께 켜집니다. vTPM은 비영속이 기본이라 VM 종료마다 상태가 지워집니다. Windows 11은 TPM 2.0과 Secure Boot를 필수 조건으로 요구하므로, 영속 TPM을 쓰려면 backend storage를 먼저 구성해야 합니다 `✓`.

## 7. HyperShift로 테넌트 클러스터 실행

KubeVirt는 중첩 Kubernetes 클러스터를 올리는 데도 쓰입니다. HyperShift의 KubeVirt provider는 베어메탈 OpenShift 위에 테넌트 클러스터를 대규모로 띄웁니다. HostedCluster 리소스를 만들면 관리 클러스터 안에 전용 네임스페이스가 생기고, etcd·kube-apiserver·controller-manager가 그 안에서 Pod로 돕니다.

게스트 클러스터 프로비저닝은 10~15분 안에 끝난다고 알려져 있습니다 `Ⓥ`. 베어메탈 노드 부트스트랩을 걷어내 프로비저닝 시간을 줄이고, 여러 hosted control plane을 같은 물리 인프라에 밀집시키려는 구성입니다.

## 8. 채택 사례와 VMware 이주의 남은 조건

ADOPTERS.md에는 Cloudflare(2018년부터 컨테이너 친화적이지 않은 CI 러너), NVIDIA GeForce NOW, CoreWeave, SK Telecom, Nebius 같은 이름이 올라 있습니다 `✓`. 배포판으로는 Red Hat OpenShift Virtualization, SUSE Harvester(최신 v1.8), Kubermatic, Spectro Cloud가 있습니다.

Broadcom의 VMware 인수 이후 이주 사례도 나왔습니다. TechTarget의 2026-05-15 기사에 따르면 Cleveland Clinic은 VM 1만 대 중 450대를 이관했습니다. Emirates NBD는 9,000대 이상을 옮겼고, FedHIVE는 Broadcom 갱신가가 9배로 뛰는 상황에서 100대를 약 6주 만에 옮겼습니다 `✓`.

이주 사례가 비용 부담의 해소까지 뜻하지는 않습니다. 같은 기사에서 애널리스트 Rob Strechay는 "OpenShift Virtualization is still seen as expensive, even though it's not as expensive as VMware."라고 평가했습니다. 2026년 9월 Broadcom이 VDDK 공개 다운로드를 내리면서 vSphere 이주 경로 자체에 마찰이 생겼다는 보도도 있습니다 `≈`. CDI의 `vddk` 소스를 이주에 쓰려면 이 경로의 가용성도 확인해야 합니다.

KubeVirt는 CNCF Incubating 상태로 졸업 신청을 진행 중입니다 `✓`. KubeCon EU 2026 취재에서 Andrew Burden은 "Graduating for us makes it more obvious for people that [KubeVirt] is deeply embedded in the Kubernetes ecosystem."라고 말했습니다. 다만 졸업에 필요한 커뮤니티 성장 정량 지표(스타 수, 기여자 추이, 채택률 서베이)는 이번 조사에서 확보하지 못했습니다 `?`.

## 참고 자료

- [KubeVirt FAQ.md](https://github.com/kubevirt/kubevirt/blob/main/FAQ.md) — Kata 비교 공식 입장
- [KubeVirt Architecture](https://kubevirt.io/user-guide/architecture/)
- [kubevirt/docs/components.md](https://github.com/kubevirt/kubevirt/blob/main/docs/components.md) — virt-launcher가 cgroup·namespace를 제공한다는 서술
- [Live Migration](https://kubevirt.io/user-guide/compute/live_migration/) — RWX 요구, 기본값 표
- [Interfaces and Networks](https://kubevirt.io/user-guide/network/interfaces_and_networks/) — masquerade·bridge·passt·SR-IOV
- [Node Overcommit](https://kubevirt.io/user-guide/compute/node_overcommit/)
- [pkg/hypervisor/kvm/hypervisorbackend.go](https://raw.githubusercontent.com/kubevirt/kubevirt/main/pkg/hypervisor/kvm/hypervisorbackend.go) — `GetMemoryOverhead` 상수
- [KubeVirt v1.9.0 changelog](https://kubevirt.io/2026/changelog-v1.9.0.html) — Beta 게이트 기본 on, cgroup v1 deprecated
- [Node Maintenance](https://kubevirt.io/user-guide/cluster_admin/node_maintenance/) — evictionStrategy·PDB·drain
- [KubeVirt | CNCF](https://www.cncf.io/projects/kubevirt/) — Incubating 상태
- [kubevirt/ADOPTERS.md](https://github.com/kubevirt/kubevirt/blob/main/ADOPTERS.md) — Cloudflare·NVIDIA·CoreWeave 등 채택 사례
- [Red Hat, KubeVirt Scale Test: Creating 400 VMIs Per Node](https://www.redhat.com/en/blog/kubevirt-scale-test-creating-400-vmis-per-node) — 2022-08-15
- [Enterprises fleeing Broadcom move to OpenShift Virtualization](https://www.techtarget.com/searchitoperations/news/366643085/Enterprises-fleeing-Broadcom-move-to-OpenShift-Virtualization) — TechTarget, 2026-05-15
