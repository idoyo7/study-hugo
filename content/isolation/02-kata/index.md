---
title: "Kata Containers"
linkTitle: "02 Kata Containers"
weight: 2
date: 2026-09-14
lastmod: 2026-09-14
---

# 02 · Kata Containers — 파드 아래 VM 한 대의 구조와 청구서

{{< callout type="info" >}}
- **CPU limit을 안 주면 Kata 파드는 vCPU 1개로 굳는다** — "Kata shim은 request를 보지 못한다"가 문서의 표현이다 `✓`. request만 크게 잡던 관행이 그대로 성능 사고가 된다.
- **진입 장벽이 2026년에 낮아졌다** — AWS가 2026-02-16부터 C8i·M8i·R8i 상용 인스턴스에서 중첩 가상화를 열었다 `✓`. `.metal` 강제가 세대 한정으로 풀렸다.
- **메모리 기본값은 다르게 잡아야 한다** — 업스트림 `default_memory`는 2048MiB인데 `✓`, AKS는 pod VM 512Mi에 RuntimeClass overhead 600Mi를 따로 둔다 `✓`. `disable_guest_seccomp` 기본값도 `true`라 컨테이너 seccomp 프로필이 게스트로 전달되지 않는다 `✓`.
- **런타임은 4.1.0, 기본은 runtime-rs다** — 4.0.0(2026-07-20)에서 Rust로 쓰인 runtime-rs가 기본이 되고 Go 런타임은 deprecated로 남았다. 최신은 4.1.0(2026-08-21)이다 `✓`.
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

[01 경계와 위협 모델]({{< relref "../01-boundaries/index.md" >}})에서 Kata가 지우는 위협과 남기는 위협을 봤습니다. 이 편은 그 경계를 실제로 세우는 물건, 즉 Kata의 구조로 내려갑니다. shim이 무엇을 하고 VMM을 어떻게 고르며 VM 크기가 어떻게 정해지는지, 그리고 그 선택 하나하나가 어디서 청구서로 돌아오는지를 봅니다.

도입 전에 답해야 할 운영 체크리스트도 이 편에 함께 둡니다. Kata를 켜는 결정은 런타임 하나만 바꾸는 일이 아니라 노드 프로비저닝부터 관측 파이프라인까지 열 군데를 함께 건드리는 일이기 때문입니다.

자매 문서: 세 물건의 경계와 위협 모델은 [01 경계와 위협 모델]({{< relref "../01-boundaries/index.md" >}})에, gVisor는 [03 gVisor]({{< relref "../03-gvisor/index.md" >}})에, KubeVirt는 [04 KubeVirt]({{< relref "../04-kubevirt/index.md" >}})에, 성능 실측은 [05 성능 실측]({{< relref "../05-performance/index.md" >}})에, 시나리오별 판단은 [06 판단]({{< relref "../06-decision/index.md" >}})에 있습니다.

## 1. Kata의 구조와 비용이 생기는 자리

호스트에서 도는 것은 셋입니다. `containerd-shim-kata-v2`가 shimv2 API를 구현해 컨테이너 몇 개든 바이너리 인스턴스 하나로 관리하고, VMM이 VM을 띄우고, `virtiofsd`가 파일을 공유합니다. 게스트 안에는 Rust로 쓰인 kata-agent가 있고 shim과는 VSOCK 위 ttRPC로 말합니다.

**4.0.0(2026-07-20)**에서 runtime-rs(Rust)가 기본 런타임이 되고 원래 Go 런타임은 deprecated로 남았습니다. 최신은 **4.1.0(2026-08-21)**입니다 `✓`. 하이퍼바이저 기본값도 최근 바뀌어서, **3.30.0**에서 runtime-rs의 기본 하이퍼바이저가 QEMU로 지정됐습니다. Kata 3.0 초기에 runtime-rs가 Dragonball만 지원하던 시절과는 상황이 다릅니다.

{{< seq src="_seq/1-파드-기동.json" />}}

비용이 붙는 자리는 VM 부팅과, CNI veth를 TAP으로 옮기고 rootfs를 공유하는 연결 단계입니다. 컨테이너를 만드는 단계부터는 runc와 거의 같은 모양이 됩니다.

VMM은 다섯 중에서 고릅니다. GPU와 기밀 컴퓨팅이 필요하면 선택지가 없습니다. QEMU만 그 셋(GPU·Intel TDX·AMD SEV-SNP)을 전부 지원합니다.

| VMM | 언어 | GPU | Intel TDX | AMD SEV-SNP |
|---|---|---|---|---|
| Cloud Hypervisor | Rust | ✗ | ✗ | ✗ |
| Firecracker | Rust | ✗ | ✗ | ✗ |
| QEMU | C | ✓ | ✓ | ✓ |
| Dragonball | Rust | ✗ | ✗ | ✗ |
| StratoVirt | Rust | ✗ | ✗ | ✗ |

Firecracker는 virtio-fs 없이 블록 장치(devmapper 스냅샷터)로 rootfs를 받습니다 `✓`.

rootfs를 게스트로 넣는 길은 네 갈래입니다. **virtio-fs**가 Kata 2.0부터 기본이고 9pfs 대비 성능과 POSIX 준수 양쪽이 낫습니다. virtiofsd는 vhost-user 장치로 호스트의 일반 프로세스로 돌면서 게스트 메모리를 직접 읽고 씁니다 — 이 "직접 읽고 쓴다"가 앞서 본 2026년 탈출 취약점의 무대였습니다 `Σ`. **9p**는 예전 방식이고, **게스트 내부 이미지 pull**(nydus 스냅샷터 경유)은 Kata 3.3.0에서 들어온 네 번째 길입니다. 기밀 컨테이너가 이걸 요구하는 이유는 명확합니다. 호스트가 이미지를 풀고 복호화하면 평문이 TEE 밖 호스트 메모리를 지나가므로 기밀성 보장이 통째로 무너지기 때문입니다 `✓`. 네트워킹은 CNI veth를 TAP으로 리다이렉트하는 **tcfilter**가 기본이고 — "설정이 단순하고 CNI 플러그인 호환성이 좋으며 성능이 MACVTAP과 대등해서 기본값"이라는 게 문서의 설명입니다 — macvtap은 예전 구현, bridge는 성능 열위로 권장하지 않습니다.

Dragonball을 VMM으로 쓰면 shim·VMM·virtio-fs 데몬이 한 프로세스 안에 들어갑니다 `Ⓥ`. Ant Group이 만든 이 조합은 프로세스 경계를 줄여 오버헤드를 낮추려는 설계인데, 업스트림에는 "Dragonball Performance Degradation Compared to other Kata Runtimes"라는 성능 회귀 이슈(#5644)가 아직 열려 있어 "가장 빠른 Kata VMM"이라고 단정하기는 이릅니다 `Σ`. `static_sandbox_resource_mgmt`를 켜면 워크로드 요구사항과 `default_vcpus`로 부팅 전에 크기를 정하고 이후 리사이즈하지 않습니다. Firecracker는 CPU·메모리 hotplug 자체를 지원하지 않아 이 모드가 사실상 강제됩니다 `✓`.

VM 크기 산정이 Kata 운영의 핵심 난점입니다. vCPU는 `vCPUs = ceiling(quota / period)` 공식으로 정해지고 `✓`, CPU limit이 없으면 vCPU 1개로 고정됩니다. 결정적인 문장은 이것입니다 — "Kata shim은 request를 보지 못한다. 따라서 CPU limit이 선언되지 않으면 pod VM은 1 vCPU로 제한된다" `✓`. request만 크게 잡고 limit을 비워두던 관행이 Kata에서는 그대로 성능 사고가 됩니다. 이 대목은 [k8s 02 CPU Throttling]({{< relref "../../k8s-features/02-cpu-throttling/index.md" >}})에서 다룬 CPU limit의 일반론과 정확히 이어집니다. 메모리 오버헤드 수치의 실측 근거는 [05 성능 실측]({{< relref "../05-performance/index.md" >}}) 6장에 있습니다.

RuntimeClass 이름도 하이퍼바이저·보안 기능 조합별로 나뉩니다. `kata-deploy`가 만드는 이름은 `kata-qemu`, `kata-clh`, `kata-qemu-tdx`, `kata-qemu-sev`, `kata-qemu-snp`, `kata-qemu-nvidia-gpu` 식으로, 어떤 조합을 쓸지가 곧 어떤 RuntimeClass를 참조할지를 정합니다 `Ⓥ`. `overhead.podFixed`는 v1.24부터 stable이고 `scheduling.nodeSelector`·`tolerations`는 v1.16부터 beta라, Kata 노드풀을 별도로 분리하는 스케줄링 규칙은 오래전부터 안정적으로 쓸 수 있었습니다 `✓`.

메모리 쪽도 기본값을 그냥 넘기면 안 됩니다. Kata 업스트림 `default_memory`는 2048MiB입니다(Makefile의 `DEFMEMSZ`) `✓`. AKS는 이보다 훨씬 작게 잡아 pod VM 메모리 기본값을 512Mi로, 지정이 없을 때 RuntimeClass overhead를 600Mi로 둡니다 `✓`. `overhead.podFixed`에 담기는 건 호스트 컴포넌트 몫뿐입니다. 게스트 컴포넌트 소비량은 담을 필요가 없습니다.

이렇게 산정된 VM은 네이티브 컨테이너와 완전히 같은 방식으로 동작하지는 않습니다. 문서가 명시한 것과 구조상 따라오는 것이 뒤섞여 있어 하나씩 확인해 둘 필요가 있습니다.

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

GPU는 VFIO 패스스루가 필수이고 호스트에 NVIDIA 드라이버가 없어야 합니다. "Kata는 VFIO로 GPU를 VM에 직접 전달하며 호스트 레벨 GPU 드라이버는 VFIO 장치 바인딩을 방해한다"는 게 NVIDIA GPU Operator 문서의 설명입니다 `✓`. IOMMU를 켠(`intel_iommu=on` 또는 `amd_iommu=on`) 베어메탈이 필요하고, 제약이 둘 큽니다. 노드의 GPU 전부가 한 Kata VM에 배정돼야 하고("일부 GPU만 Kata용으로 구성하는 것은 지원되지 않는다"), vGPU는 지원되지 않으며, 컨테이너 런타임은 containerd만 지원됩니다 `✓`. MIG나 time-slicing 같은 GPU 분할 기법은 이 문서가 지원 구성으로 언급하지 않습니다 `?`.

## 2. 운영 비용 체크리스트 (Kata 도입 전에 답할 것)

Kata를 도입하는 결정은 런타임 하나를 바꾸는 일로 끝나지 않습니다. 노드 프로비저닝부터 관측 파이프라인까지 열 군데가 함께 바뀝니다. 도입 전에 아래 열 가지에 스스로 답해야 나중에 사고로 알게 되는 일을 줄일 수 있습니다.

1. 파드당 추가 메모리는 얼마나 붙는가
2. 부팅 지연이 SLO 안에 들어오는가
3. 밀도 손실을 감당할 수 있는가 — 정적 크기 모드에서는 오버커밋 여지가 준다
4. 게스트 커널 유지보수를 누가 지는가 — 3.30.0이 CVE-2026-31431 대응으로 게스트 이미지 커널을 통째로 올린 사례가 전형이다
5. 디버깅 경로가 있는가 — `kata-runtime exec`나 debug console 경유
6. 관측 사각지대를 인지하는가 — 호스트 eBPF는 게스트를 못 본다 `≈`. AKS는 "Defender for Containers는 Kata 파드를 평가하지 못한다"고 명시한다 `✓`
7. CNI 데이터패스가 게스트 내부까지 보이는가 — Cilium 같은 eBPF CNI는 호스트 쪽에서만 동작하고 veth-TAP 리다이렉션 아래의 게스트 내부는 보지 못한다 `≈`
8. 서비스 메시 사이드카가 정상 동작하는가 — 같은 파드의 컨테이너가 한 VM을 공유하므로 붙는다 `≈`. Istio Ambient는 아직 실험 단계인 L3 forwarding 네트워크 모델과 맞물린다 `✓`
9. 스토리지 CSI의 IOPS 한계를 아는가 — AKS는 Azure Files와 로컬 SSD에서 IOPS 한계를 명시적으로 경고한다
10. seccomp 프로필이 게스트로 전달되는지 확인했는가 — 기본은 미전달이다

`/dev/kvm`을 확보할 수 있는지가 출발점입니다.

| 클라우드 | 조건 |
|---|---|
| AWS | 2026-02-16부터 C8i·M8i·R8i가 전 상용 리전에서 중첩 가상화 지원. 그 전에는 `.metal`만 |
| GCP | Intel VT-x 지원, AMD는 N4D만. 중첩 VM은 CPU 10%+·IO는 그 이상 성능 저하 경고 |
| Azure | 중첩 가상화를 지원하는 gen2 VM이면 가능 |

관리형 서비스로는 AKS Pod Sandboxing(`kata-vm-isolation` RuntimeClass, Azure Linux 전용, `uname -r`로 게스트 커널 확인), GKE Sandbox(Kata가 아니라 gVisor), Alibaba ACK Sandboxed Container(V2가 오버헤드 90% 감소를 주장하나 독립 검증은 못 했다 `Ⓥ`)가 있습니다. GKE Sandbox 쪽 구조는 [03 gVisor]({{< relref "../03-gvisor/index.md" >}})에서 더 다룹니다.

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
