---
title: "KubeVirt"
linkTitle: "04 KubeVirt"
weight: 4
date: 2026-09-14
lastmod: 2026-09-14
---

# 04 · KubeVirt — VM을 파드로 다룰 때 따라오는 계약

{{< callout type="info" >}}
- **KubeVirt FAQ가 직접 못 박는다** — "Kata containers are containers inside virtual machines. KubeVirt is a virtual machine inside a container." `✓`
- **라이브 마이그레이션·hotplug·무중단 업그레이드 셋 다 RWX에 묶인다** — RWX 공유 스토리지가 없으면 셋 다 못 쓴다 `✓`.
- **파드 축출은 곧 VM 종료다** — `evictionStrategy: LiveMigrate`가 걸린 VMI마다 PodDisruptionBudget이 자동으로 생성된다 `✓`.
- **v1.9.0(2026-07-30)에서 Beta 게이트가 전부 기본 on이 됐다** — cgroup v1은 deprecated돼 다음 릴리스에서 제거될 예정이다 `✓`.
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

[01 경계와 위협 모델]({{< relref "../01-boundaries/index.md" >}})에서 본 것처럼 KubeVirt는 Kata와 같은 KVM/QEMU 위에 서지만 반대 방향에서 출발합니다. 컨테이너화된 애플리케이션을 격리하는 게 아니라, 컨테이너화되지 않은 VM을 그대로 쿠버네티스 객체로 올립니다. 그 결과 VM은 파드 하나의 생명주기, 스토리지 요구, 축출 규칙을 그대로 물려받습니다.

이 편은 그 계약이 실제로 무엇을 요구하는지 봅니다. 스토리지가 왜 도입 판단의 1순위인지, 오버헤드가 어떻게 조립되는지, 그리고 Broadcom 이후 VMware 이주 물결에서 KubeVirt가 실제로 어떻게 쓰이고 있는지입니다.

자매 문서: 세 물건의 경계와 위협 모델은 [01 경계와 위협 모델]({{< relref "../01-boundaries/index.md" >}})에, Kata는 [02 Kata Containers]({{< relref "../02-kata/index.md" >}})에, gVisor는 [03 gVisor]({{< relref "../03-gvisor/index.md" >}})에, 성능 실측은 [05 성능 실측]({{< relref "../05-performance/index.md" >}})에, 시나리오별 판단은 [06 판단]({{< relref "../06-decision/index.md" >}})에 있습니다.

## 1. 구조와 계약

{{< flow src="_flow/1-구조.json" />}}

QEMU 프로세스가 virt-launcher 파드의 cgroup과 namespace 안에서 돕니다. 파드가 죽으면 VM도 죽습니다. Kubernetes가 아는 건 파드이고, VM은 그 파드의 내용물일 뿐입니다. 최신 버전은 **v1.9.0(2026-07-30 태그, Kubernetes v1.36 대상)**이고 4개월 주기로 릴리스되며, CNCF Incubating 상태에서 졸업 신청이 진행 중입니다 `✓`. v1.9에서는 Beta 피처 게이트가 전부 기본 활성화됐고, **cgroup v1은 deprecated돼 다음 릴리스에서 제거될 예정**입니다 `✓`.

스토리지가 도입 판단의 1순위인 이유가 있습니다. 라이브 마이그레이션은 RWX 공유 스토리지가 필요하고 `✓`, CPU·메모리 hotplug가 내부적으로 라이브 마이그레이션을 동반하며 `✓`, 워크로드 업데이트 전략(LiveMigrate/Evict)도 마찬가지입니다. RWX가 없으면 셋 다 못 씁니다. 마이그레이션 기본값은 다음과 같습니다.

| 파라미터 | 기본값 |
|---|---|
| `parallelMigrationsPerCluster` | 5 |
| `parallelOutboundMigrationsPerNode` | 2 |
| `bandwidthPerMigration` | 64Mi |
| `completionTimeoutPerGiB` | 800 |
| `progressTimeout` | 150 |

네트워킹 바인딩은 넷입니다. **masquerade**가 기본값이고 pod IP 뒤에 게스트를 NAT로 숨기며 라이브 마이그레이션을 완전히 지원합니다. **bridge**는 pod IP를 게스트에 위임하는 대신 라이브 마이그레이션이 명시적으로 금지됩니다. **passt**는 v1.8부터 core 바인딩으로 승격됐고 메모리 250Mi를 추가로 씁니다. **SR-IOV**는 VF를 vfio로 넘기면서도 마이그레이션 시 자동으로 hot-unplug·hot-plug됩니다 `✓`. Service는 게스트가 아니라 virt-launcher 파드의 라벨을 매칭하므로, Service와 Ingress가 VM에 별다른 작업 없이 그대로 붙습니다.

축출은 곧 VM 종료입니다. `evictionStrategy: LiveMigrate`가 걸린 VMI마다 PodDisruptionBudget이 자동으로 생성돼 축출을 막고 마이그레이션을 보장합니다. 드레인 명령에 `--force`가 필요한 이유도 여기 있습니다 — virt-launcher 파드는 ReplicaSet이나 DaemonSet 소유가 아니라서 kubectl이 재스케줄을 보장할 수 없습니다. 커스텀 PDB를 쓸 때는 `maxUnavailable`이 아니라 `minAvailable`을 써야 합니다. VMI가 `/scale` subresource를 구현하지 않기 때문입니다. Karpenter의 consolidation은 노드의 파드를 전부 축출할 수 있어야 그 노드를 정리하는데, PDB가 걸린 virt-launcher 파드는 축출되지 않아 consolidation이 그 노드를 건드리지 못할 가능성이 있습니다 `≈`. 이걸 정면으로 다룬 1차 문서는 찾지 못했습니다 `?`. [Karpenter]({{< relref "../../karpenter/_index.md" >}}) 챕터가 다루는 consolidation 로직과 맞물리는 지점입니다.

오버헤드는 소스 코드의 `GetMemoryOverhead` 함수가 정확히 정의합니다. 고정분은 virt-launcher 100Mi, virtqemud 40Mi, qemu 50Mi, virt-launcher-monitor 25Mi, virtlogd 25Mi를 더한 240Mi입니다. 여기에 페이지테이블(게스트 RAM/512), vCPU당 8Mi, IOThread 8Mi가 가변으로 붙고, 그래픽 디바이스 32Mi, 전용 CPU 또는 Guaranteed QoS 100Mi, VFIO 디바이스 1Gi가 옵션으로 얹힙니다 `✓`. [05 성능 실측]({{< relref "../05-performance/index.md" >}}) 6장의 차트가 이 수치를 조립한 예시입니다.

성능이 중요한 VM에는 별도의 튜닝 손잡이가 있습니다. `dedicatedCpuPlacement`는 Kubernetes CPU manager의 static 정책과 Guaranteed QoS를 전제로 vCPU를 물리 코어에 고정하고, `isolateEmulatorThread`를 같이 켜면 QEMU 에뮬레이터 스레드가 vCPU 실행과 경쟁하지 않도록 별도 코어를 받습니다 `✓`. hugepages는 노드에 미리 할당돼 있어야 하고 요청 메모리가 hugepage 크기로 나눠떨어져야 합니다 `✓`. NUMA는 `guestMappingPassthrough`로 게스트에 호스트의 NUMA 토폴로지를 그대로 보여주는데, 문서 스스로 "재스케줄되면 게스트가 다른 NUMA 토폴로지를 볼 수 있다"고 한계를 인정합니다 `✓`. 이런 손잡이는 전부 Guaranteed QoS와 노드 사전 준비를 요구하므로, 켜는 순간 그 VM은 더 이상 아무 노드에나 뜨는 물건이 아니게 됩니다 `Σ`.

모든 KubeVirt 컴포넌트는 `/metrics` 엔드포인트로 Prometheus 메트릭을 냅니다. VMI 런타임 메트릭은 `kubevirt_vmi_memory_resident_bytes`, `kubevirt_vmi_network_traffic_bytes_total`, `kubevirt_vmi_vcpu_seconds_total` 같은 `kubevirt_vmi` 접두사를 씁니다 `✓`.

노드 쪽 전제는 `/dev/kvm`입니다. `useEmulation: true`로 소프트웨어 에뮬레이션 폴백이 가능하지만 개발용이지 프로덕션 물건이 아닙니다. 컨테이너 런타임은 containerd와 cri-o를 지원하고, SELinux 노드는 container-selinux가 필요합니다.

CPU·메모리를 실행 중에 늘리는 hotplug 기능에는 공통 전제가 하나 있습니다. **라이브 마이그레이션을 동반한다**는 점입니다. CPU hotplug는 v1.0에서 GA가 됐지만 "현재 구현은 VM이 라이브 마이그레이션할 것을 요구한다"고 문서가 명시하고, 워크로드 업데이터가 자동으로 마이그레이션을 트리거합니다 `✓`. 메모리 hotplug는 v1.1에서 들어왔고 최소 1GiB가 필요하며 마찬가지로 마이그레이션을 동반합니다 `✓`. 결국 CPU·메모리를 유연하게 조절하고 싶다는 요구 자체가 RWX 스토리지 요구로 되돌아갑니다.

디스크를 게스트에 넣는 경로는 CDI(Containerized Data Importer)가 담당합니다. DataVolume이 받는 소스 종류는 `http`/`s3`/`gcs`(원격 다운로드), `registry`(컨테이너 이미지를 디스크로), `pvc`(기존 PVC 복제), `snapshot`, `upload`, `blank`, 그리고 vSphere 이주의 뿌리가 되는 `imageio`·`vddk`입니다 `✓`. Windows 게스트를 올릴 때는 viostor·viorng 같은 virtio 드라이버가 필요하고, EFI를 켜면 Secure Boot가 함께 켜집니다. vTPM은 비영속이 기본이라 VM 종료마다 상태가 지워지는데, Windows 11이 TPM 2.0과 Secure Boot를 하드 요구사항으로 걸기 때문에 영속 TPM을 쓰려면 backend storage를 먼저 구성해야 합니다 `✓`.

중첩 Kubernetes 클러스터를 올리는 용도로도 쓰입니다. HyperShift의 KubeVirt provider는 베어메탈 OpenShift 위에 테넌트 클러스터를 대규모로 얹습니다. HostedCluster 리소스를 만들면 관리 클러스터 안에 전용 네임스페이스가 생기고 etcd·kube-apiserver·controller-manager가 그 안에서 Pod로 돕니다. 게스트 클러스터 프로비저닝은 10~15분 안에 끝난다고 알려져 있습니다 `Ⓥ`. 베어메탈 노드 부트스트랩을 걷어내 프로비저닝 시간을 줄이고, 여러 hosted control plane을 같은 물리 인프라에 밀집시키려는 노림수입니다.

KubeVirt를 "격리 수단"으로 쓰는 사례가 역설적으로 많습니다. ADOPTERS.md에는 Cloudflare(2018년부터 컨테이너 친화적이지 않은 CI 러너), NVIDIA GeForce NOW, CoreWeave, SK Telecom, Nebius 같은 이름이 올라 있습니다 `✓`. Broadcom의 VMware 인수 이후 이주 물결도 뚜렷합니다. TechTarget의 2026-05-15 기사에 따르면 Cleveland Clinic은 VM 1만 대 중 450대를 이관했고, Emirates NBD는 9,000대 이상을 옮겼으며, FedHIVE는 Broadcom 갱신가가 9배로 뛰는 상황에서 100대를 약 6주 만에 옮겼습니다 `✓`. 애널리스트 Rob Strechay의 평가는 냉정합니다 — "OpenShift Virtualization is still seen as expensive, even though it's not as expensive as VMware." 2026년 9월 Broadcom이 VDDK 공개 다운로드를 내리면서 vSphere 이주 경로 자체에 마찰이 생겼다는 보도도 있습니다 `≈`. 배포판으로는 Red Hat OpenShift Virtualization, SUSE Harvester(최신 v1.8), Kubermatic, Spectro Cloud가 있습니다.

이 흐름 속에서 KubeVirt 자신도 CNCF 졸업을 노리고 있습니다. KubeCon EU 2026 취재에서 Andrew Burden은 이렇게 말합니다 — "Graduating for us makes it more obvious for people that [KubeVirt] is deeply embedded in the Kubernetes ecosystem." 다만 졸업에 필요한 커뮤니티 성장 정량 지표(스타 수, 기여자 추이, 채택률 서베이)는 이번 조사에서 확보하지 못했습니다 `?`.

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
