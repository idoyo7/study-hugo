---
title: "Kata Containers"
linkTitle: "02 Kata Containers"
weight: 2
date: 2026-09-14
lastmod: 2026-09-14
url: "/isolation/02-kata/"
---

# 02 · Kata Containers — 파드 아래 VM 한 대의 구조와 청구서

{{< callout type="info" >}}
- **Kata 4.0.0(2026-07-20)부터 runtime-rs가 기본 런타임이고 최신은 4.1.0(2026-08-21)이다** — 원래 Go 런타임은 deprecated로 남아 버그·보안 수정만 받는다 `✓`.
- **CPU request만 높여서는 VM이 커지지 않는다** — CPU limit이 없으면 pod VM은 vCPU 1개로 제한된다 `✓`. request만 크게 잡던 워크로드는 자원 선언을 다시 확인해야 한다.
- **AWS의 중첩 가상화 지원은 세대 조건을 확인해야 한다** — 2026-02-16부터 C8i·M8i·R8i 상용 인스턴스에서 지원한다 `✓`. `.metal`이 필요하던 제약이 이 세대에서 풀렸다.
- **VM 메모리와 RuntimeClass overhead는 따로 계산한다** — 업스트림 `default_memory`는 2048MiB이고 `✓`, AKS는 pod VM 기본값 512Mi와 지정이 없을 때의 RuntimeClass overhead 600Mi를 따로 둔다 `✓`.
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

Kata에서는 파드 아래에 VM 한 대가 생깁니다. 컨테이너 이미지가 그대로 실행되더라도 노드에는 가상화 지원이 필요하고, 파드의 자원 선언은 VM 크기를 정하는 입력이 됩니다. 게스트 커널을 유지보수하고 그 안을 관측하는 일도 운영자의 몫으로 남습니다.

자매 문서: 격리 경계가 막는 위협과 남기는 위협은 [01 경계와 위협 모델]({{< relref "/platform/isolation/01-boundaries/index.md" >}}), VM 자체를 파드로 관리하는 방식은 [04 KubeVirt]({{< relref "/platform/isolation/04-kubevirt/index.md" >}}), 워크로드별 선택은 [06 판단]({{< relref "/platform/isolation/06-decision/index.md" >}})에서 이어집니다.

## 1. 실행할 노드와 관리형 서비스

도입의 출발점은 노드에서 `/dev/kvm`을 확보할 수 있는지입니다. 클라우드마다 중첩 가상화를 지원하는 인스턴스 조건과 성능 제약이 다릅니다.

| 클라우드 | 조건 |
|---|---|
| AWS | 2026-02-16부터 C8i·M8i·R8i가 전 상용 리전에서 중첩 가상화 지원. 그 전에는 `.metal`만 |
| GCP | Intel VT-x 지원, AMD는 N4D만. 중첩 VM은 CPU 10%+·IO는 그 이상 성능 저하 경고 |
| Azure | 중첩 가상화를 지원하는 gen2 VM이면 가능 |

관리형 서비스에서도 런타임과 지원 구성을 구분해야 합니다. AKS Pod Sandboxing은 Azure Linux 전용이며 `kata-vm-isolation` RuntimeClass를 사용합니다. `uname -r`로 게스트 커널을 확인할 수 있습니다. Alibaba ACK Sandboxed Container는 V2의 오버헤드가 90% 감소했다고 주장하지만, 독립 검증은 하지 못했습니다 `Ⓥ`.

GKE Sandbox는 Kata가 아닌 gVisor를 사용합니다. 그 구조와 제약은 [03 gVisor]({{< relref "/platform/isolation/03-gvisor/index.md" >}})에서 다룹니다.

## 2. 파드 기동 경로와 VMM 선택

호스트 쪽 구성요소는 shim, VMM, 파일 공유 데몬입니다. `containerd-shim-kata-v2`는 shimv2 API를 구현해 파드의 컨테이너들을 바이너리 인스턴스 하나로 관리합니다. VMM은 VM을 띄우고, `virtiofsd`는 파일을 공유합니다. 게스트 안에는 Rust로 쓰인 kata-agent가 있으며, shim과 VSOCK 위 ttRPC로 통신합니다.

4.0.0(2026-07-20)에서 runtime-rs(Rust)가 기본 런타임이 되고 기존 Go 런타임은 deprecated로 남았습니다. 최신은 4.1.0(2026-08-21)입니다 `✓`. runtime-rs의 기본 하이퍼바이저는 3.30.0에서 QEMU로 지정됐습니다. Kata 3.0 초기에 runtime-rs가 Dragonball만 지원하던 때와는 선택 범위가 달라졌습니다.

아래 기동 순서에서 비용이 추가되는 구간은 VM 부팅과 네트워크·rootfs 연결 단계입니다.

{{< seq src="_seq/1-파드-기동.json" />}}

그 뒤 컨테이너를 만드는 단계는 runc와 거의 같은 모양입니다. 도입할 워크로드에서는 이 기동 경로의 부팅 지연이 SLO 안에 들어오는지 확인해야 합니다.

VMM은 아래 다섯 가지 중에서 고릅니다. 이 지원표에서 GPU·Intel TDX·AMD SEV-SNP를 모두 지원하는 VMM은 QEMU뿐입니다.

| VMM | 언어 | GPU | Intel TDX | AMD SEV-SNP |
|---|---|---|---|---|
| Cloud Hypervisor | Rust | ✗ | ✗ | ✗ |
| Firecracker | Rust | ✗ | ✗ | ✗ |
| QEMU | C | ✓ | ✓ | ✓ |
| Dragonball | Rust | ✗ | ✗ | ✗ |
| StratoVirt | Rust | ✗ | ✗ | ✗ |

Dragonball을 쓰면 shim·VMM·virtio-fs 데몬이 한 프로세스 안에 들어갑니다 `Ⓥ`. Ant Group이 만든 이 구성은 프로세스 경계를 줄여 오버헤드를 낮추려는 설계입니다. 다만 업스트림에는 "Dragonball Performance Degradation Compared to other Kata Runtimes"라는 성능 회귀 이슈(#5644)가 아직 열려 있어, "가장 빠른 Kata VMM"이라고 단정하기는 이릅니다 `Σ`.

## 3. rootfs와 네트워크를 게스트에 연결하는 방법

rootfs를 게스트에 넣는 경로는 virtio-fs, 9p, 블록 장치, 게스트 내부 이미지 pull의 네 갈래입니다.

virtio-fs는 Kata 2.0부터 기본이며, 9pfs보다 성능과 POSIX 준수 양쪽에서 낫습니다. virtiofsd는 호스트의 일반 프로세스로 실행되며 vhost-user 장치로 게스트 메모리를 직접 읽고 씁니다. 이 접근 경로가 [01 경계와 위협 모델]({{< relref "/platform/isolation/01-boundaries/index.md" >}})에서 다룬 2026년 탈출 취약점의 무대였습니다 `Σ`. 9p는 예전 방식입니다.

Firecracker는 virtio-fs 없이 블록 장치(devmapper 스냅샷터)로 rootfs를 받습니다 `✓`. 게스트 내부 이미지 pull은 nydus 스냅샷터를 경유하며, Kata 3.3.0에서 추가됐습니다. 기밀 컨테이너가 이 경로를 요구하는 이유는 복호화 위치에 있습니다. 호스트가 이미지를 풀고 복호화하면 평문이 TEE 밖 호스트 메모리를 지나가므로 기밀성을 보장할 수 없습니다 `✓`.

네트워킹의 기본값은 CNI veth를 TAP으로 리다이렉트하는 tcfilter입니다. "설정이 단순하고 CNI 플러그인 호환성이 좋으며 성능이 MACVTAP과 대등해서 기본값"이라는 게 문서의 설명입니다. macvtap은 예전 구현이며, bridge는 성능 열위로 권장하지 않습니다.

## 4. VM 크기와 RuntimeClass에 반영할 비용

vCPU는 `vCPUs = ceiling(quota / period)` 공식으로 정해집니다 `✓`. 문서는 CPU limit이 없는 경우를 이렇게 설명합니다. "Kata shim은 request를 보지 못한다. 따라서 CPU limit이 선언되지 않으면 pod VM은 1 vCPU로 제한된다" `✓`. request만 크게 잡고 limit을 비워두던 관행이 Kata에서는 그대로 성능 사고가 됩니다. CPU limit의 일반적인 동작은 [k8s 02 CPU Throttling]({{< relref "/platform/kubernetes/resources/02-cpu-throttling/index.md" >}})에서 다뤘습니다.

`static_sandbox_resource_mgmt`를 켜면 워크로드 요구사항과 `default_vcpus`로 부팅 전에 VM 크기를 정하고 이후에는 리사이즈하지 않습니다. Firecracker는 CPU·메모리 hotplug를 지원하지 않으므로 이 모드를 사용해야 합니다 `✓`. 정적 크기 모드에서는 오버커밋 여지가 줄어듭니다. 필요한 VM 크기를 정한 뒤에는 그 크기로 파드를 배치했을 때의 밀도 손실도 계산해야 합니다.

메모리는 VM에 할당하는 양과 호스트에서 추가로 소비하는 양을 나눠 봐야 합니다. Kata 업스트림 `default_memory`는 2048MiB입니다(Makefile의 `DEFMEMSZ`) `✓`. AKS는 pod VM 메모리 기본값을 512Mi로, 지정이 없을 때 RuntimeClass overhead를 600Mi로 둡니다 `✓`. `overhead.podFixed`에는 호스트 컴포넌트가 쓰는 양을 담으며, 게스트 컴포넌트 소비량은 포함할 필요가 없습니다. 파드당 추가 메모리를 계산할 때 참고할 실측 근거는 [05 성능 실측]({{< relref "/platform/isolation/05-performance/index.md" >}}) 6장에 있습니다.

이 자원 비용과 노드 배치 조건은 RuntimeClass에 연결됩니다. `kata-deploy`는 하이퍼바이저·보안 기능 조합에 따라 `kata-qemu`, `kata-clh`, `kata-qemu-tdx`, `kata-qemu-sev`, `kata-qemu-snp`, `kata-qemu-nvidia-gpu` 같은 이름을 만듭니다 `Ⓥ`. 파드는 사용할 조합에 맞는 RuntimeClass를 참조합니다. `overhead.podFixed`는 v1.24부터 stable이고, Kata 노드풀로 배치를 제한할 때 쓰는 `scheduling.nodeSelector`·`tolerations`는 v1.16부터 beta입니다 `✓`.

## 5. 컨테이너 기능과 GPU의 제약

VM 안에서 실행되는 컨테이너에는 네이티브 컨테이너와 다른 제약이 있습니다. 아래 표는 문서에 명시된 제한과 구조에서 추정한 동작을 함께 담고 있습니다. 사이드카 동작은 추정으로 구분했습니다.

| 항목 | 내용 |
|---|---|
| hostNetwork | 미지원 |
| `--net=container:` | 다른 컨테이너의 네트워크 namespace 참가 불가 |
| `volumeMount.subPath` | 미지원 |
| privileged | 호스트 장치가 전달되지 않는다. 게스트 안에서는 root이지만 호스트로부터는 격리된 채로 남는다 |
| hostPath | 마운트되지만 격리가 훼손된다. `/dev` 하위 파일은 예외 |
| `/proc` bind mount | 일부 금지(CVE-2019-16884, CVE-2019-19921 관련) |
| emptyDir(block 변형) | `sizeLimit`이 블록 장치 용량에 반영되지 않아 eviction을 유발할 수 있다 |
| checkpoint/restore | 없음 |
| `exec`/`logs`/`port-forward` | shim과 agent를 거쳐 정상 동작 |
| 사이드카 | 같은 파드의 컨테이너가 한 VM을 공유하므로 정상 동작 `≈` |

seccomp도 별도로 확인해야 합니다. `disable_guest_seccomp` 기본값은 `true`이므로 컨테이너 seccomp 프로필이 게스트로 전달되지 않습니다 `✓`. 의식적으로 켜야 하는 스위치입니다.

GPU를 사용하려면 VFIO 패스스루가 필요하며 호스트에 NVIDIA 드라이버가 없어야 합니다. "Kata는 VFIO로 GPU를 VM에 직접 전달하며 호스트 레벨 GPU 드라이버는 VFIO 장치 바인딩을 방해한다"는 게 NVIDIA GPU Operator 문서의 설명입니다 `✓`. IOMMU를 켠(`intel_iommu=on` 또는 `amd_iommu=on`) 베어메탈도 필요합니다.

지원 구성에는 추가 제약이 있습니다. 노드의 GPU 전부가 한 Kata VM에 배정돼야 하고("일부 GPU만 Kata용으로 구성하는 것은 지원되지 않는다"), vGPU는 지원되지 않으며, 컨테이너 런타임은 containerd만 지원됩니다 `✓`. MIG나 time-slicing 같은 GPU 분할 기법은 이 문서가 지원 구성으로 언급하지 않습니다 `?`.

## 6. 도입 전에 확인할 운영 경로

노드와 자원 크기, 기능 호환성이 맞더라도 게스트 안에서 문제가 생겼을 때 대응할 경로가 필요합니다. 유지보수 담당자와 디버깅 수단을 정하고, 현재 관측·네트워크·스토리지 구성이 어디까지 동작하는지 확인해야 합니다.

- 게스트 커널 유지보수 담당 — 3.30.0이 CVE-2026-31431 대응으로 게스트 이미지 커널을 통째로 올린 사례처럼 게스트 이미지도 보안 업데이트 대상
- 디버깅 경로 — `kata-runtime exec`나 debug console로 게스트에 접근할 수 있는지 확인
- 관측 범위 — 호스트 eBPF는 게스트를 보지 못한다 `≈`. AKS는 "Defender for Containers는 Kata 파드를 평가하지 못한다"고 명시한다 `✓`
- CNI 데이터패스의 가시성 — Cilium 같은 eBPF CNI는 호스트 쪽에서만 동작하고 veth-TAP 리다이렉션 아래의 게스트 내부는 보지 못한다 `≈`
- 서비스 메시 구성 — 사용하는 사이드카의 정상 동작을 확인. Istio Ambient는 아직 실험 단계인 L3 forwarding 네트워크 모델과 맞물린다 `✓`
- 스토리지 CSI의 IOPS 한계 — AKS는 Azure Files와 로컬 SSD에서 IOPS 한계를 명시적으로 경고

## 참고 자료

- [Kata Containers Releases](https://github.com/kata-containers/kata-containers/releases) — 릴리스 일자
- [Kata Containers 4.0.0 Release Overview](https://katacontainers.io/blog/kata-containers-4-0-0-release-overview/) — runtime-rs 기본화
- [hypervisors.md](https://raw.githubusercontent.com/kata-containers/kata-containers/main/docs/hypervisors.md) — VMM 비교표
- [Limitations.md](https://raw.githubusercontent.com/kata-containers/kata-containers/main/docs/Limitations.md) — 동작하지 않는 것 목록
- [networking.md](https://raw.githubusercontent.com/kata-containers/kata-containers/main/docs/design/architecture/networking.md) — tcfilter·macvtap·bridge
- [vcpu-handling-runtime-go.md](https://raw.githubusercontent.com/kata-containers/kata-containers/main/docs/design/vcpu-handling-runtime-go.md) — vCPU 산정 공식
- [src/runtime/Makefile](https://raw.githubusercontent.com/kata-containers/kata-containers/main/src/runtime/Makefile) — `DEFMEMSZ`, `DEFDISABLEGUESTSECCOMP` 등 기본값
- [Kubernetes RuntimeClass](https://kubernetes.io/docs/concepts/containers/runtime-class/) — `overhead.podFixed`
- [NVIDIA GPU Operator + Kata](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/deploy-kata-containers.html)
- [AKS Pod Sandboxing 고려사항](https://learn.microsoft.com/en-us/azure/aks/considerations-pod-sandboxing) — 파드 VM 크기별 오버헤드 실측 표
- [AKS Pod Sandboxing](https://learn.microsoft.com/en-us/azure/aks/use-pod-sandboxing) — `kata-vm-isolation`, `uname -r` 확인법
- [AWS EC2 중첩 가상화 발표](https://aws.amazon.com/about-aws/whats-new/2026/02/amazon-ec2-nested-virtualization-on-virtual/) — 2026-02-16
- [GCP 중첩 가상화](https://docs.cloud.google.com/compute/docs/instances/nested-virtualization/overview)
- [GKE Sandbox](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/sandbox-pods)
- [Alibaba ACK Sandboxed Container](https://www.alibabacloud.com/help/en/ack/ack-managed-and-ack-dedicated/user-guide/overview-10/)
