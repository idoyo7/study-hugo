---
title: "08 스토리지 — GDS와 NVMe-oF의 CPU 우회 범위"
description: "2026-10-21 기준으로 GDS와 NVMe-oF RDMA가 CPU를 우회하는 범위와 Kubernetes에서 직접 전송을 쓰는 조건을 설명한다. 지원 파일시스템과 드라이버를 맞춘 뒤, 호환 모드 여부와 I/O 패턴별 성능을 확인해야 한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 8
url: "/kubernetes/gpu/08-storage-gds-nvmeof/"
---

# 08 · 스토리지 — GDS와 NVMe-oF의 CPU 우회 범위

## 1. 복사를 줄여도 요청 처리는 CPU에 남는다

스토리지에서 GPU로 데이터를 읽을 때 줄이려는 작업은 중간 복사입니다. 일반 경로에서는 데이터를 CPU 시스템 메모리의 바운스 버퍼(중간 복사용 버퍼)에 받은 뒤 GPU로 다시 복사합니다. NVIDIA GDS 개요 가이드는 이 과정이 지연을 늘리고 유효 대역폭을 낮춘다고 설명합니다.

{{< flow src="_flow/2-일반-경로.json" />}}

GPUDirect Storage(GDS)는 NVMe나 NIC 근처의 DMA(직접 메모리 접근) 엔진이 데이터를 GPU 메모리로 바로 옮기는 경로입니다. 아래 그림에서는 CPU 시스템 메모리를 거치던 데이터 경로가 GPU 메모리로 이어집니다.

{{< flow src="_flow/2-gds-경로.json" />}}

데이터를 옮기는 길이 짧아져도 요청을 만들고 완료를 처리하는 CPU는 남습니다. 애플리케이션이 cuFile API를 호출하는 곳은 CPU입니다. `nvidia-fs.ko`를 쓰는 경로에서는 `libcufile.so`가 모드를 고른 뒤 모듈에 IOCTL을 보내고, 커널 파일시스템 드라이버도 CPU에서 직접 전송 경로를 설정합니다.

따라서 GDS가 우회하는 범위는 데이터 평면, 곧 데이터를 옮기는 경로입니다. 요청과 완료를 처리하는 제어 평면은 여전히 CPU에서 동작합니다. 이 구분을 놓치면 데이터 복사를 줄였다는 설명을 CPU가 전혀 필요 없다는 뜻으로 읽게 됩니다.

NIC와 GPU 사이의 GPUDirect RDMA(원격 메모리 직접 접근)는 [06편]({{< relref "/platform/kubernetes/gpu/06-gpudirect-rdma-basics/index.md" >}})과 [07편]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}})에서 설명했습니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-21이며 GDS 1.19.1 릴리스 노트, GPU Operator 26.7 문서, SPDK 성능 보고서를 봤습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 일반 경로의 바운스 버퍼 | CPU 시스템 메모리를 거쳐 GPU로 복사, 지연 증가·유효 대역폭 감소 | NVIDIA GDS 개요 가이드 | `✓` |
| GDS는 DMA 엔진이 GPU 메모리로 직접 이동 | CPU 메모리는 데이터 경로에 없음 | NVIDIA GDS 개요 가이드 | `✓` |
| CPU가 빠지는 것은 데이터 평면뿐 | cuFile은 CPU에서 호출, `libcufile.so`가 모드를 고르고 `nvidia-fs.ko`에 IOCTL. 요청마다 CPU 고정 비용 | NVIDIA GDS 개요 가이드, IIT NIXL 벤치마크 논문 | `✓` |
| GPUDirect Storage(GDS) 버전 | 1.19.1. 릴리스 날짜는 페이지에 없고 문서 갱신일이 2026-09-17 | NVIDIA GDS 릴리스 노트 | `✓` |
| CUDA Toolkit | 13.4.1. GDS 패키지 이름이 13-4 계열 | CUDA 릴리스 노트 | `✓` |
| `nvidia-fs` 모듈 | v2.31.5(2026-10-20). GPU Operator 26.7.0이 번들한 것은 v2.29.4 | gds-nvidia-fs 릴리스 | `✓` |
| GPU Operator | v26.7.2(2026-10-14) | GPU Operator 릴리스 | `✓` |
| DOCA | 문서 3.5.0 | DOCA SDK 문서 | `✓` |
| SPDK | v26.09. 최신 공식 성능 보고서는 26.01 | SPDK 릴리스 | `✓` |
| Mayastor | v2.12.2. NVMe-oF RDMA는 2.8.0에서 추가 | OpenEBS Mayastor 릴리스 | `✓` |

{{% /details %}}

## 2. 파일시스템과 드라이버가 직접 경로를 결정한다

GDS를 설치했는지만으로는 직접 전송 가능 여부를 판단할 수 없습니다. 데이터를 읽을 파일시스템과 그 아래의 드라이버 경로가 지원 범위에 들어가야 합니다.

GDS 1.19.1 릴리스 노트가 배포용으로 지원하는 파일시스템은 EXT4, XFS, DDN EXAScaler(Lustre), IBM Spectrum Scale(GPFS), WekaFS, BeeGFS, NFS, ScaTeFS, VirtioFS입니다. TMPFS, OverlayFS, ZFS, BTRFS는 개발용 지원에 해당하며 CPU 시스템 메모리를 거치는 호환 모드로만 동작합니다. 파트너 행렬에는 1.19.1부터 VDURA PanFS가 추가됐습니다.

드라이버 조건은 로컬 NVMe에서 달라졌습니다. GDS가 언제나 `nvidia-fs.ko`와 MOFED의 NVMe 패치를 요구한다는 설명은 현재 지원 범위의 일부에만 맞습니다. GDS 1.13부터는 로컬 NVMe의 ext4나 xfs에서 업스트림 커널의 PCI P2PDMA(PCIe 장치 간 직접 메모리 전송)를 쓰면 둘 다 필요 없습니다.

```
# cufile.json
"properties": { "use_pci_p2pdma": true }
```

이 경로는 x86_64에서만 지원하며, OpenRM 565.47 이상과 ACS 비활성화, IOMMU `pt` 또는 `off`가 필요합니다. 커널 하한은 Ubuntu 22.04 기준 6.2, RHEL 9.4 기준 5.14입니다. NVIDIA 문서는 제외 범위를 "Arm64-based GraceHopper platforms, RAID0 over NVMe and NVMEoF are not supported in this release"라고 명시합니다.

`nvidia-fs`를 쓰는 기존 경로에서는 MLNX_OFED나 DOCA를 GDS보다 먼저 설치해야 합니다. 커널 6.17 이상에서 `nvidia-fs`로 로컬 NVMe를 사용하려면 DOCA 3.3.0 이상이 필요하며, block integrity 기능이 있는 NVMe 장치는 GDS I/O 경로를 쓸 수 없습니다.

노드 안의 PCIe 토폴로지가 성능을 좌우하는 이유는 [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}})에서 다룹니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 배포용 지원 파일시스템 | EXT4, XFS, EXAScaler(Lustre), GPFS, WekaFS, BeeGFS, NFS, ScaTeFS, VirtioFS | GDS 1.19.1 릴리스 노트 | `✓` |
| 호환 모드만 되는 파일시스템 | TMPFS, OverlayFS, ZFS, BTRFS | GDS 1.19.1 릴리스 노트 | `✓` |
| VDURA PanFS | 1.19.1부터 파트너 행렬에 추가 | GDS 1.19.1 릴리스 노트 | `✓` |
| 구형 설명의 변화 | GDS가 `nvidia-fs.ko`와 MOFED 패치를 반드시 요구한다는 설명은 일부만 맞음 | GDS 릴리스 노트 | `✓` |
| P2PDMA 모드 | `use_pci_p2pdma: true`, OpenRM 565.47 이상, ACS 비활성화, IOMMU pt 또는 off. 커널 하한은 Ubuntu 22.04 기준 6.2, RHEL 9.4 기준 5.14 | NVIDIA GDS NVMe 지원 문서, GDS 릴리스 노트 | `✓` |
| P2PDMA 미지원 범위 | Arm64 Grace Hopper, NVMe RAID0, NVMe-oF | NVIDIA GDS NVMe 지원 문서 | `✓` |
| `nvidia-fs` 경로의 선행 조건 | MLNX_OFED 또는 DOCA 선설치. 커널 6.17 이상은 DOCA 3.3.0 이상. block integrity 장치는 GDS I/O 불가 | GDS 릴리스 노트, 트러블슈팅 가이드 | `✓` |

{{% /details %}}

## 3. 원격 NVMe에서는 호스트와 스토리지의 CPU를 나눠 본다

NVMe-oF(네트워크 너머의 NVMe에 접근하는 방식)를 RDMA로 연결해도 GPU 메모리로 가는 경로가 저절로 생기지는 않습니다. 호스트 메모리까지 데이터를 보내는 일과 GPU 메모리까지 보내는 일은 구분해야 합니다.

1차 자료를 종합한 해석으로는, 호스트의 커널 이니시에이터(요청을 보내는 쪽)인 `nvme-rdma`를 사용할 때 RNIC(RDMA를 지원하는 NIC)는 데이터를 호스트 메모리 버퍼에 직접 씁니다. TCP에서 CPU가 하던 소켓 복사와 체크섬 처리는 빠지지만, 명령 제출과 완료 처리, 블록 계층, 파일시스템은 호스트 CPU에서 동작합니다. GDS가 없으면 데이터의 목적지는 페이지 캐시나 유저 버퍼이므로 GPU로 옮길 때 `cudaMemcpy`가 한 번 더 필요합니다.

GDS를 결합하면 데이터의 목적지를 GPU 메모리로 바꿀 수 있습니다. 이때도 cuFile에서 nvidia-fs, 파일시스템, nvme-rdma로 이어지는 제어 경로는 CPU에서 동작합니다. 앞 절의 업스트림 P2PDMA 경로는 NVMe-oF를 지원하지 않으므로, 이 조합에는 DOCA의 `mlnx-nvme` 패키지가 필요합니다.

```
# Ubuntu
sudo apt install doca-ofed mlnx-fw-updater mlnx-nvme-dkms
# RHEL
sudo dnf install doca-ofed mlnx-fw-updater kmod-mlnx-nvme
```

NVIDIA는 NVMe와 NVMe-oF 전송 패키지를 DOCA로 설치하도록 권장합니다. 같은 시스템에 MLNX_OFED와 DOCA 전송 패키지를 함께 설치하지 말라는 경고도 있습니다.

호스트 연결은 `nvme-cli` 문서의 예시를 기준으로 잡을 수 있습니다. NVMe/RDMA의 기본 포트는 4420입니다.

```
nvme connect --transport=rdma --traddr=192.168.1.3 \
  --nqn=nqn.2014-08.com.example:nvme:nvm-subsystem-sn-d78432
```

재연결과 keep-alive는 `--ctrl-loss-tmo`, `--reconnect-delay`, `--keep-alive-tmo`로 조절하며, 큐 설정에는 `--nr-io-queues` 등을 사용합니다. Portworx 문서는 노드 전제조건으로 부팅 시 `nvme-fabrics`와 `nvme-rdma` 모듈 로드, `nvme-cli` 설치, 노드마다 고유한 `/etc/nvme/hostnqn`과 `/etc/nvme/hostid`를 명시합니다. 스토리지 NIC를 어떤 패브릭에 둘지는 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})에서 다룹니다.

스토리지의 Target(요청을 받는 쪽)에서도 CPU 작업을 다른 장치로 넘길 수 있습니다. ConnectX-5 이상의 NVMe-oF Target Offload에서는 HCA가 일반 I/O를 처리하고 PCIe P2P로 실제 NVMe에 직접 보냅니다. MLNX_OFED 문서는 연결 관리와 오류 처리를 제외하면 CPU 사용이 관측되지 않는다고 설명합니다. 이는 벤더가 제시한 동작 설명입니다.

호스트 쪽에서는 BlueField SNAP이 호스트가 처리하던 스토리지 네트워크 스택을 DPU(데이터 처리 장치)의 Arm 코어로 옮깁니다. 호스트에는 평범한 PCIe NVMe 장치로 보여 표준 드라이버를 쓸 수 있고, SNAP 문서는 원격 스토리지에서 호스트로 zero-copy DMA를 지원한다고 설명합니다. 시스템에서 CPU가 사라졌다기보다는 처리 주체가 호스트 CPU에서 DPU의 Arm 코어로 이동한 것으로 읽힙니다.

DOCA 3.5 기준 SNAP-4는 BlueField-3용, SNAP-3는 BlueField-2용이며 BlueField-4는 서비스 목록에 없습니다. SNAP 문서는 Kubernetes를 언급하지 않습니다. SNAP으로 에뮬레이션한 NVMe에서 GDS를 쓸 수 있는지도 확인하지 못했습니다.

JBOF와 EBOF에서는 DPU가 스토리지 서버의 CPU 자리를 대신합니다. SPDK 26.01 보고서는 BlueField-3의 Arm 16코어에서 Target을 실행한 결과를 제시합니다. 4KiB 랜덤 읽기, 큐 깊이 64에서 약 1,009만 IOPS와 평균 100.9µs를 기록했습니다.

SPDK 24.05 보고서의 4KiB 랜덤 읽기에서 RDMA는 약 8코어에 이르러 포화했고, TCP는 비슷한 IOPS를 내는 데 24~32코어가 들었습니다. 큐 깊이가 RDMA 128, TCP 384로 다르고 RDMA 보고서의 링크 구성 서술도 섞여 있으므로, 이 결과는 엄밀한 동일 조건 비교보다 경향을 보여주는 자료에 가깝습니다.

같은 보고서에서 SPDK Target은 커널 Target보다 RDMA 4KiB 랜덤 쓰기의 코어당 IOPS가 최대 8.17배였습니다. 일반 Kubernetes 노드가 커널 이니시에이터를 사용한다는 점에서, 이 차이는 노드에서 체감하는 CPU 비용에도 그대로 반영된다고 해석할 수 있습니다.

폴링(반복해서 완료 여부를 확인하는 방식)을 쓰는 구현에서는 낮은 CPU 사용률을 기대하기도 어렵습니다. SPDK나 Mayastor의 폴링 모델은 I/O 부하와 무관하게 할당된 코어를 100% 사용합니다. Mayastor 릴리스 노트도 IO 엔진이 실제 I/O 부하와 관계없이 할당된 CPU 코어를 모두 쓴다고 명시합니다.

Bench 2020 학술 측정에서도 폴링 기반 RoCE와 InfiniBand의 클라이언트 CPU 사용률은 약 92%였습니다. 큰 I/O에서는 IPoIB가 CPU 사용률과 꼬리 지연에서 나은 경우도 있었습니다. 이 측정의 장비는 ConnectX-3와 ConnectX-5 세대이므로 현재 환경에 그대로 적용하기는 어렵습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 호스트 NVMe/RDMA의 데이터와 제어 | RNIC가 호스트 버퍼에 직접 쓰고 소켓 복사·체크섬은 없음. 명령 제출·완료·블록 계층·파일시스템은 호스트 CPU | 1차 자료 종합 | `≈` |
| NVMe-oF와 GDS 조합 | DOCA `mlnx-nvme` 필요. 업스트림 P2PDMA는 NVMe-oF 미지원 | GDS 트러블슈팅 가이드, NVIDIA GDS NVMe 지원 문서 | `✓` |
| DOCA 설치 권고 | Ubuntu `mlnx-nvme-dkms`, RHEL `kmod-mlnx-nvme`. MLNX_OFED와 DOCA 전송 패키지 혼용 금지 | GDS 트러블슈팅 가이드 17.3 | `✓` |
| Target Offload | ConnectX-5 이상. 연결 관리·오류 처리 외에는 CPU 사용이 관측되지 않는다고 서술 | MLNX_OFED 스토리지 프로토콜 문서 | `Ⓥ` |
| BlueField SNAP | 호스트는 표준 NVMe 장치로 인식, 스택은 DPU Arm 코어, zero-copy DMA. SNAP-4는 BlueField-3, SNAP-3는 BlueField-2, BlueField-4는 목록에 없음 | DOCA SNAP 서비스 가이드 | `✓` |
| 호스트 CPU에서 빠지는 것의 해석 | 스토리지 네트워크 스택이 DPU로 옮겨갈 뿐 시스템에서 CPU가 빠지는 것은 아님 | — | `≈` |
| SNAP과 GDS 조합 | 확인하지 못함 | — | `?` |
| SPDK 26.01 BlueField-3 Target | Supermicro E3.S JBOF, BF3 Arm 16코어, 4KiB 랜덤 읽기 QD=64, 10,090.6k IOPS, 평균 100.9µs | SPDK 성능 보고서 26.01 | `✓` |
| SPDK 24.05 RDMA | ConnectX-5, Kioxia SSD 14개, 4KiB 랜덤 읽기 QD 128. 1코어 1,564.5k IOPS, 8코어 10,810.4k IOPS(평균 165.6µs). 약 8코어 포화(약 42 GB/s) | SPDK 성능 보고서 24.05 RDMA | `✓` |
| SPDK 24.05 TCP | 같은 조건에 QD 384. 8코어 5,571.4k IOPS, 16코어 9,877.2k IOPS, 32코어 11,040.7k IOPS(평균 476.4µs). 400Gbps 포화에 48코어 | SPDK 성능 보고서 24.05 TCP | `✓` |
| RDMA와 TCP 비교의 한계 | QD가 다르고 링크 구성 서술이 섞여 엄밀한 동일 조건이 아님 | — | `≈` |
| SPDK와 커널 Target의 코어 효율 | RDMA에서 4KiB 랜덤 쓰기 코어당 IOPS 최대 8.17배, RDMA 이니시에이터 평균 지연 최대 49.73% 낮음, TCP는 코어당 IOPS 최대 1.69배 | SPDK 성능 보고서 24.05 | `✓` |
| 커널 이니시에이터 노드의 체감 비용 | 위 차이가 그대로 반영된다는 해석 | — | `≈` |
| 폴링 구현의 CPU 사용 | 할당 코어는 부하와 무관하게 100% | Mayastor 릴리스 노트 2.12.0 | `✓` |
| 학술 측정(Bench 2020) | SPDK로 TCP·IPoIB·RoCE·IB 비교, 네이티브 IB가 대부분 우세, 폴링 RoCE/IB 클라이언트 CPU 약 92%. 장비는 ConnectX-3·5 세대 | Kashyap 외 논문 | `✓` (논문), 현재 적용성은 `≈` |
| `nvme connect` 사용법 | 기본 포트 4420, 재연결·큐·호스트 지정 옵션 | nvme-cli 문서 | `✓` |
| 노드 전제조건 | `nvme-fabrics`·`nvme-rdma` 모듈, `nvme-cli`, 고유한 hostnqn·hostid | Portworx 문서 | `✓` |

{{% /details %}}

## 4. Kubernetes에서 GDS와 NVMe-oF를 구성한다

Kubernetes에서 GDS를 쓰려면 노드의 드라이버 구성이 컨테이너의 장치 주입으로 이어져야 하고, 데이터도 GDS가 지원하는 파일시스템 마운트로 들어와야 합니다. GPU 장치를 파드에 넣는 설정만으로 스토리지 경로까지 준비되지는 않습니다.

GPU Operator 26.7 플랫폼 지원표의 GDS 행에는 Ubuntu 24.04와 22.04(Network Operator 25.7.0과 함께), OpenShift 4.18 이상이 적혀 있으며 RHEL은 없습니다. 각주는 secure boot를 지원하지 않고, 지원 스토리지는 로컬 NVMe와 원격 NFS라고 명시합니다. 오픈 커널 모듈 드라이버가 필수이며 플랫폼은 베어메탈과 vSphere VM입니다.

노드에서는 GPU Operator가 드라이버 DaemonSet 안에 `nvidia-fs-ctr` 컨테이너를 실행해 `nvidia-fs` 모듈을 올립니다. 네트워크 드라이버는 Network Operator가 설치한다는 전제입니다. 호스트에 직접 설치했다면 `driver.rdma.useHostMofed=true`를 지정합니다.

```yaml
gds:
  enabled: true
driver:
  rdma:
    useHostMofed: true   # 호스트에 DOCA-OFED를 직접 설치한 경우
```

컨테이너까지 이어지는 동작은 디바이스 플러그인과 nvidia-container-toolkit 소스에서 확인할 수 있습니다. 디바이스 플러그인의 `--gds-enabled` 플래그, 환경변수로는 `GDS_ENABLED`가 켜져 있으면 GPU를 요청한 컨테이너에 `NVIDIA_GDS=enabled`가 주입됩니다. nvidia-container-toolkit은 이를 받아 캐릭터 디바이스 `/dev/nvidia-fs*`와 마운트 `/run/udev`, `/etc/cufile.json`을 컨테이너에 넣습니다.

아래 그림은 노드의 GDS 구성이 컨테이너 장치와 마운트로 이어지는 과정을 보여줍니다.

{{< flow src="_flow/5-파드-주입-경로.json" />}}

이 경로를 사용하면 파드 스펙에 hostPath로 `/dev/nvidia-fs*`를 따로 적을 필요가 없습니다. 디바이스 플러그인 설정을 확인하고, 노드의 드라이버 파드에 `mofed-validation` init 컨테이너와 `nvidia-fs-ctr`가 있는지 살펴봅니다. `lsmod | grep nvidia` 출력에서는 `nvidia_fs`를 확인합니다.

활성화가 의도한 설정인지도 점검해야 합니다. GPU Operator 26.3.3 문서 업데이트에는 디바이스 플러그인에서 `MOFED_ENABLED`와 `GDS_ENABLED`가 기본으로 켜지던 회귀가 언급되어 있습니다.

데이터를 담은 볼륨은 별도로 준비합니다. 로컬 NVMe에서는 hostPath나 Local PV, 원격에서는 NFS나 Lustre CSI(컨테이너 스토리지 인터페이스) 볼륨이 후보입니다. OverlayFS는 호환 모드만 지원합니다. 이 지원 목록을 컨테이너에 적용하면, rootfs인 overlayfs의 쓰기 레이어에 학습 데이터를 둘 경우 GDS 직접 경로를 쓸 수 없다고 해석할 수 있습니다.

스토리지 종류를 선택하는 문제와 전송 경로를 구성하는 문제도 구분할 필요가 있습니다. 파일시스템·오브젝트 스토리지·병렬 파일시스템 가운데 무엇을 고를지는 [GPU 클러스터 스토리지]({{< relref "/data/gpu-storage/_index.md" >}}) 시리즈에서 다룹니다.

조사한 상용 블록 CSI 다수는 NVMe/TCP에 무게를 둡니다. 조사 범위에서 판단하면, 블록형 NVMe-oF CSI에서 RDMA를 공식 지원하는 선택지는 Mayastor와 Portworx/FlashArray 정도입니다.

| 드라이버 | RDMA 전송 | 메모 |
|---|---|---|
| OpenEBS Mayastor | 지원(2.8.0부터) | Helm `io_engine.target.nvmf.rdma.enabled: true`와 `io_engine.target.nvmf.iface`. RDMA 없는 노드는 기본으로 nvme-tcp 폴백 |
| Portworx + Pure FlashArray | 지원(Portworx 2.13.0 이상) | StorageCluster 생성 시 NVMe-oF RDMA 선택. iSCSI·FC에서 제자리 전환 불가 |
| NetApp Trident(ontap-san) | 언급 없음 | iSCSI, FC, NVMe/TCP |
| Lightbits(lb-csi) | NVMe/TCP 전용 설계 | — |
| WEKA, VAST, DDN | NVMe-oF CSI가 아님 | 호스트 클라이언트나 NFS를 마운트하는 구조 |

Mayastor 2.11에는 RDMA DSCP 마킹(트래픽 분류 값을 붙이는 기능)인 `io_engine.nvme.transportTos`가 추가됐습니다. 공유 RoCE 패브릭에서 스토리지 트래픽을 별도 PFC 큐로 분류할 수 있습니다. 2.12부터는 CSI 노드가 `nvme_rdma` 모듈로 RDMA 능력을 감지합니다.

GPU 클러스터에서 GDS와 함께 언급되는 WEKA, VAST, DDN, GPFS, Lustre 같은 병렬·분산 파일시스템은 호스트 클라이언트를 마운트하는 방식으로 봐야 합니다. GPU Operator 지원표는 로컬 NVMe와 NFS만 명시합니다. 이 구성에서 RDMA는 CSI보다 호스트 클라이언트 설정에서 결정되고, Lustre·WEKA·GPFS의 GDS 처리도 각 벤더 클라이언트의 영역에 속한다고 해석할 수 있습니다.

AWS FSx for Lustre 문서는 EFA와 GDS를 함께 쓰는 구성을 제공합니다. 대상 인스턴스는 P5, P5e, P5en, P6-B200, P6-B300이며, GDS 드라이버 2.24.2 이상을 `NVFS_MAX_PEER_DEVS=128 NVFS_MAX_PCI_DEPTH=16`으로 빌드합니다. AWS 발표는 클라이언트 인스턴스당 최대 12배, 1200 Gbps 처리량을 주장합니다. 이 구성을 EKS에서 운영한 공개 사례는 찾지 못했습니다.

DGX B300은 캐시용 E1.S 3.84TB NVMe 8개와 부팅용 M.2 2개를 기본 탑재합니다. 레퍼런스 아키텍처에서는 병렬 파일시스템이나 NFS를 주 스토리지로 삼고, 노드 로컬 NVMe는 캐시나 스크래치로 사용하는 것으로 짐작할 수 있습니다.

GPU 노드가 외부 NVMe-oF 블록 볼륨을 CSI로 붙여 학습 데이터를 읽는 공개 사례는 찾지 못했습니다. 블록 NVMe-oF의 단일 파드 RWO 성격을 고려하면, 여러 노드가 같은 데이터셋을 읽는 학습 패턴과는 잘 맞지 않는다고 판단됩니다. 현장에서 이러한 스토리지 경로를 얼마나 사용하는지는 [09편]({{< relref "/platform/kubernetes/gpu/09-storage-reality/index.md" >}})에서 다룹니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Mayastor RDMA | 2.8.0부터. `io_engine.target.nvmf.rdma.enabled`, `io_engine.target.nvmf.iface`, `csi.node.nvme.tcpFallback: true` 기본. 2.11 DSCP 마킹 `transportTos`, 2.12 `nvme_rdma` 모듈 감지 | Mayastor 차트 values.yaml, 릴리스 노트 | `✓` |
| Portworx RDMA | 2.13.0 이상, FlashArray Direct Access와 Cloud Drives. FlashArray//X NVMe/RoCE는 Purity 6.1.14~6.9.0. 정확한 필드 이름 | Portworx 문서 | `✓` (필드 이름은 `?`) |
| Trident | iSCSI, FC, NVMe/TCP. RDMA 언급 없음(부재 확인) | NetApp Trident 문서 | `✓` |
| Lightbits | NVMe/TCP 전용 설계 | lb-csi README | `✓` |
| WEKA CSI 2.9.7 | NVMe-oF CSI가 아니고 호스트 WEKA 클라이언트를 사용. README에 GDS 언급 없음 | csi-wekafs README | `✓` (README), 조합 동작은 `≈` |
| VAST·DDN·Dell CSI의 RDMA·GDS 옵션 | 확인하지 못함 | — | `?` |
| 블록 CSI의 RDMA 지원이 좁다는 정리 | Mayastor와 Portworx/FlashArray 정도 | — | `≈` |
| GPU Operator의 GDS 노드 구성 | 드라이버 DaemonSet 안의 `nvidia-fs-ctr`, `gds.enabled=true`, `driver.rdma.useHostMofed=true`, 검증은 `mofed-validation` init 컨테이너와 `lsmod` | GPU Operator RDMA 문서 | `✓` |
| 컨테이너 주입 체인 | `GDS_ENABLED` → `NVIDIA_GDS=enabled` → `/dev/nvidia-fs*`, `/run/udev`, `/etc/cufile.json` | k8s-device-plugin 소스, nvidia-container-toolkit 소스 | `✓` |
| 기본 활성화 회귀 | 26.3.3 문서 업데이트에 `MOFED_ENABLED`·`GDS_ENABLED` 기본 활성화 회귀 언급 | GPU Operator 릴리스 노트 | `✓` |
| overlayfs 적용 | 지원 목록상 호환 모드만 되므로 컨테이너 rootfs에 데이터를 두면 GDS 불가 | GDS 1.19.1 릴리스 노트 | `✓` (목록), `≈` (적용) |
| 공식 지원 범위 | Ubuntu 24.04·22.04, OpenShift 4.18 이상, RHEL 없음, secure boot 불가, 로컬 NVMe와 원격 NFS, 오픈 커널 모듈 필수, 베어메탈·vSphere VM | GPU Operator 플랫폼 지원표 26.7 | `✓` |
| Lustre·WEKA·GPFS는 벤더 클라이언트 영역 | 위 지원표에서 이끌어낸 해석 | — | `≈` |
| AWS FSx for Lustre | P5·P5e·P5en·P6-B200·P6-B300, GDS 드라이버 2.24.2 이상, `NVFS_MAX_PEER_DEVS=128 NVFS_MAX_PCI_DEPTH=16`, 파일시스템당 EFA 연결 1024개 한도 | AWS FSx for Lustre 가이드 | `✓` |
| AWS의 성능 주장 | 클라이언트 인스턴스당 최대 12배, 1200 Gbps | AWS 발표 | `Ⓥ` |
| EKS 운영 사례 | 찾지 못함 | — | `?` |
| DGX B300 로컬 NVMe | E1.S 3.84TB 8개, M.2 부팅용 2개 | DGX B300 사용자 가이드 | `✓` |
| 로컬 NVMe가 캐시·스크래치라는 해석 | 레퍼런스 아키텍처의 주 스토리지는 병렬 파일시스템이나 NFS | — | `≈` |
| 외부 NVMe-oF 블록 볼륨으로 학습 데이터를 읽는 사례 | 찾지 못함 | — | `?` |

{{% /details %}}

## 5. 읽기에 성공했어도 경로와 성능은 따로 확인한다

파드가 파일을 읽는 데 성공했다면 GDS도 동작한 것일까요? cuFile은 직접 경로를 쓸 수 없을 때 CPU 시스템 메모리를 거치는 호환 모드로 조용히 전환할 수 있습니다. 기본값이 `allow_compat_mode: true`이므로 프로그램의 실행 성공만으로 직접 전송을 확인할 수는 없습니다.

NVIDIA GDS 개요 가이드는 호환 모드에 들어가는 조건을 다음과 같이 설명합니다.

- `cufile.json` 설정이 호환 모드를 사용하도록 되어 있을 때
- `nvidia-fs.ko`가 없을 때. 호스트에 모듈이 없는 컨테이너가 해당
- GDS를 지원하지 않는 파일시스템일 때
- O_DIRECT를 쓸 수 없을 때

NVIDIA 문서에 따르면 호환 모드의 성능은 GDS 없는 CPU API와 같거나 낫지만, GDS의 이득은 없습니다. 프로그램이 계속 실행되는 동안 전송 경로만 바뀔 수 있으므로 로그를 확인해야 합니다.

`logging.level`을 `TRACE`로 설정하고 `cufile.log`에서 `cufile IO mode: POSIX`를 찾습니다.

```
# cufile.json
"logging": { "level": "TRACE" }

# cufile.log에서 호환 모드로 떨어졌는지 찾는다
cufile IO mode: POSIX
```

`/proc/driver/nvidia-fs/stats`는 호환 모드와 P2PDMA I/O를 집계하지 않습니다. 통계가 비어 있다는 사실만으로 호환 모드를 사용하지 않았다고 판단해서는 안 됩니다. 조용한 폴백은 vLLM 0.32의 fastsafetensors 로더 주석에도 남아 있습니다. GDS를 지원하지 않는 파일시스템에서 `CU_FILE_HANDLE_NOT_REGISTERED`가 발생하면 `nogds=True`로 다시 시도합니다.

`gdscheck -p`도 판단 자료의 일부입니다. NVIDIA 개발자 포럼에는 `gdscheck`가 NVMe Unsupported를 표시했는데 gdsio 처리량은 높게 나왔다는 보고가 있습니다. 상태 줄 하나로 동작 여부를 판정하기 어려우므로 로그와 처리량 측정을 함께 봐야 합니다.

직접 경로를 확인한 뒤에도 성능 이득은 별도로 확인해야 합니다. NVIDIA 개요 가이드가 이득을 기대하는 조건은 스토리지에서 GPU로 가는 I/O가 병목이고, 파이프라인이 GPU에서 동작하는 워크로드입니다. GPU 메모리에 들어가는 크기의 데이터를 명시적으로 큰 단위로 스트리밍하고, 큰 전송으로 호출당 오버헤드를 분산하는 패턴이 여기에 해당합니다.

문서는 이득이 작거나 직접 경로가 성립하지 않는 패턴도 제시합니다.

- 세밀한 랜덤 접근, mmap이나 managed memory처럼 페이지 폴트 기반 접근
- 정렬되지 않은 오프셋·주소·크기. 처리는 가능하지만 직접 전송은 아님
- 파일시스템이 그 크기의 RDMA를 지원하지 않는 아주 작은 I/O
- GPU BAR1 aperture보다 큰 전송

문서에 제시된 대역폭 수치는 PCIe 스위치 경로가 CPU 경유보다 최소 두 배의 최대 대역폭을 낸다는 주장 하나입니다. NVIDIA가 제시한 이 수치는 플랫폼의 PCIe 토폴로지를 조건으로 합니다.

벤더 밖의 측정에서는 읽기와 쓰기가 서로 다른 결과를 보였습니다. IIT 연구진은 NIXL 벤치마크 논문에서 AMD EPYC 7763, A100 PCIe 40GB 한 장, ext4를 사용하는 로컬 NVMe 하나로 gdsio를 실행했습니다. nvidia-fs 버전은 2.25였습니다.

- 쓰기는 128KiB 미만에서 두 경로가 거의 같았고, 큰 I/O에서는 CPU 경유가 훨씬 우세. 저자들은 GPU 페이지 크기 64KB 때문에 P2P DMA 요청이 쪼개져 작은 I/O가 늘어난다고 설명
- 읽기는 GDS 직접 경로가 가장 우세
- 배치 크기는 성능에 영향이 없음. 배치 안의 요청을 결국 하나씩 제출하기 때문이라는 해석
- 비동기 모드의 성능이 가장 낮음. 작은 I/O가 많을 때 요청마다 인터럽트가 발생하기 때문

논문은 GDS가 항상 전통적인 CPU-GPU 경로보다 빠르지는 않다고 결론 내립니다. 단일 GPU와 로컬 NVMe 하나를 사용한 확장 초록 규모의 측정이므로, 이 결과를 대규모 병렬 파일시스템에 그대로 적용하기는 어렵습니다. ACM Phoenix 논문은 초록만 확인했지만, 이 초록에서는 GDS 소프트웨어 스택이 critical path에 큰 오버헤드를 더한다고 주장합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 호환 모드 진입 조건 | 설정, 모듈 부재, 미지원 파일시스템, O_DIRECT 불가의 네 가지 | NVIDIA GDS 개요 가이드 | `✓` |
| 호환 모드 성능 | GDS 없는 CPU API와 같거나 낫고 GDS 이득은 없음 | NVIDIA GDS 개요 가이드 | `✓` |
| 기본 설정 | `properties.allow_compat_mode` 기본 true. `gdscheck -p`의 줄 이름은 `properties.use_compat_mode`로 키 이름과 다름 | NVIDIA GDS 구성 가이드, 트러블슈팅 가이드 | `✓` |
| 호환 모드 확인법 | `TRACE` 로그의 `cufile IO mode: POSIX`. `/proc/driver/nvidia-fs/stats`는 호환 모드와 P2PDMA를 집계하지 않음 | NVIDIA GDS 트러블슈팅 가이드 | `✓` |
| vLLM fastsafetensors의 재시도 | `CU_FILE_HANDLE_NOT_REGISTERED` 발생 시 `nogds=True`로 재시도 | vLLM v0.32.0 소스 | `✓` |
| gdscheck 상태 줄의 한계 | NVMe Unsupported인데 cuFile I/O는 정상 동작했다는 보고 | NVIDIA 개발자 포럼 | `≈` |
| 이득이 나는 패턴 | I/O 병목, GPU 파이프라인, GPU 메모리에 들어가는 거친 단위 스트리밍, 큰 전송 | NVIDIA GDS 개요 가이드 | `✓` |
| 이득이 적은 패턴 | 세밀한 랜덤, 페이지 폴트 기반, 비정렬, 아주 작은 I/O, BAR1보다 큰 전송 | NVIDIA GDS 개요 가이드 | `✓` |
| 최소 두 배 대역폭 | PCIe 스위치 경로 기준, 플랫폼 토폴로지에 달린 조건부 주장 | NVIDIA GDS 개요 가이드 | `Ⓥ` |
| IIT 측정 조건 | Chameleon 노드, EPYC 7763, A100-PCIe-40GB 1장, 로컬 NVMe ext4, CUDA 12.9, nvidia-fs 2.25, gdsio v0.4.1 | IIT NIXL 벤치마크 논문 | `✓` |
| IIT 결과 | 쓰기는 큰 I/O에서 CPU 경유 우세, 읽기는 GDS 우세, 배치 효과 없음, 비동기 최악. 그래프 서술이라 절대 수치 없음 | IIT NIXL 벤치마크 논문 | `✓` |
| IIT 결과의 일반화 | 단일 GPU·로컬 NVMe 하나 규모라 병렬 파일시스템에는 적용 불가 | — | `≈` |
| Phoenix 논문 | 소프트웨어 오버헤드 평균 70.3% 감소, 작은 I/O 약 2.29배. 초록만 확인 | ACM Phoenix 논문 | `?` |

{{% /details %}}

## 6. 확인하지 못한 것

- GDS 1.19.1과 CUDA 13.4.1의 정확한 릴리스 날짜. 문서에 갱신일만 있습니다.
- GPU Operator 26.7.x에서 GDS 테스트 파드의 공식 YAML 예시. 문서에는 RDMA 테스트 파드만 있습니다.
- Crusoe의 GDS 활성화 문서. 접근이 막혀 내용을 확인하지 못했습니다.
- Portworx에서 NVMe-oF RDMA를 고르는 정확한 StorageCluster 필드나 환경변수 이름, 최신 Portworx 버전.
- VAST CSI, DDN EXAScaler CSI, Dell CSI, Lightbits CSI의 최신 버전과 RDMA·GDS 옵션.
- WEKA와 VAST가 Kubernetes 환경에서 GDS를 쓰는 공식 절차.
- SNAP으로 에뮬레이션한 NVMe에서 GDS를 쓸 수 있는지, BlueField-4의 SNAP 지원 상태.
- Phoenix 논문 본문. 초록 검색 결과만 봤습니다.

## 참고 자료

- [NVIDIA GDS 릴리스 노트](https://docs.nvidia.com/gpudirect-storage/release-notes/index.html)
- [NVIDIA GDS 개요 가이드](https://docs.nvidia.com/gpudirect-storage/overview-guide/index.html)
- [NVIDIA GDS 구성 가이드](https://docs.nvidia.com/gpudirect-storage/configuration-guide/index.html)
- [NVIDIA GDS 트러블슈팅 가이드](https://docs.nvidia.com/gpudirect-storage/troubleshooting-guide/index.html)
- [GDS support for NVMe (P2PDMA)](https://docs.nvidia.com/deploy/gds-support-for-nvme/intro.html)
- [gds-nvidia-fs 릴리스](https://github.com/NVIDIA/gds-nvidia-fs/releases)
- [GPU Operator RDMA 문서](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-operator-rdma.html)
- [GPU Operator 플랫폼 지원](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/platform-support.html)
- [GPU Operator 릴리스 노트](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/release-notes.html)
- [k8s-device-plugin 소스](https://github.com/NVIDIA/k8s-device-plugin/blob/main/internal/plugin/server.go)
- [nvidia-container-toolkit GDS 소스](https://github.com/NVIDIA/nvidia-container-toolkit/blob/main/internal/discover/gds.go)
- [DOCA SNAP-4 서비스 가이드](https://networking-docs.nvidia.com/doca/archive/3-3-0/doca-snap-4-service-guide)
- [MLNX_OFED 스토리지 프로토콜](https://docs.nvidia.com/networking/display/mlnxofedv551032/storage+protocols)
- [nvme-cli nvme-connect 문서](https://github.com/linux-nvme/nvme-cli/blob/master/Documentation/nvme-connect.txt)
- [SPDK NVMe-oF RDMA 성능 보고서 24.05](https://review.spdk.io/download/performance-reports/SPDK_rdma_mlx_perf_report_2405.pdf)
- [SPDK NVMe-oF TCP 성능 보고서 24.05](https://review.spdk.io/download/performance-reports/SPDK_tcp_mlx_perf_report_2405.pdf)
- [SPDK RDMA 성능 보고서 26.01 (BlueField-3)](https://review.spdk.io/download/performance-reports/SPDK_rdma_nvda_perf_report_2601.pdf)
- [Impact of Commodity Networks on Storage Disaggregation with NVMe-oF (Bench 2020)](https://par.nsf.gov/servlets/purl/10299229)
- [Insights into GPUDirect Data Transfer through NIXL Benchmarking (IIT, 2025)](http://cs.iit.edu/~scs/assets/files/muradli2025gpudirect.pdf)
- [Phoenix (ACM, 2025)](https://dl.acm.org/doi/10.1145/3712285.3759862)
- [OpenEBS Mayastor 릴리스](https://github.com/openebs/mayastor/releases)
- [Mayastor 차트 values.yaml](https://github.com/openebs/mayastor-extensions/blob/v2.12.2/chart/values.yaml)
- [Portworx NVMe/RoCE 문서](https://docs.portworx.com/reference/pure-reference/nvme-roce)
- [NetApp Trident ontap-san](https://docs.netapp.com/us-en/trident/trident-use/ontap-san.html)
- [Lightbits lb-csi](https://github.com/lightbitslabs/los-csi)
- [WEKA csi-wekafs](https://github.com/weka/csi-wekafs)
- [AWS FSx for Lustre EFA 클라이언트 구성](https://docs.aws.amazon.com/fsx/latest/LustreGuide/configure-efa-clients.html)
- [AWS FSx for Lustre EFA·GDS 발표](https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-fsx-lustre-elastic-fabric-adapter-nvidia-gpudirect-storage/)
- [DGX B300 사용자 가이드](https://docs.nvidia.com/dgx/dgxb300-user-guide/introduction-to-dgxb300.html)
- [vLLM weight_utils.py (v0.32.0)](https://github.com/vllm-project/vllm/blob/v0.32.0/vllm/model_executor/model_loader/weight_utils.py)
- [NVIDIA 개발자 포럼 — gdscheck NVMe Unsupported](https://forums.developer.nvidia.com/t/is-gds-actually-enabled-on-my-system-gdscheck-shows-nvme-unsupported-but-cufile-i-o-works/352258)
