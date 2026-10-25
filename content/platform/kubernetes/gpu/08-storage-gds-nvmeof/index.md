---
title: "08 GDS와 NVMe-oF는 CPU 작업을 어디까지 줄이는가"
description: "GDS와 NVMe-oF RDMA가 줄이는 데이터 복사와 CPU에 남는 제어 작업을 구분한다. Kubernetes에서 직접 전송을 구성하는 조건과 호환 모드 확인법, I/O 패턴별 성능 차이를 2026-10-21 기준으로 설명한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 8
url: "/kubernetes/gpu/08-storage-gds-nvmeof/"
---

# 08 · GDS와 NVMe-oF는 CPU 작업을 어디까지 줄이는가

## 1. GDS가 줄이는 복사와 CPU에 남는 일 {#1-복사를-줄여도-요청-처리는-cpu에-남는다}

스토리지의 데이터를 GPU로 읽는 일반 경로에서는 CPU 시스템 메모리에 바운스 버퍼를 두고, 여기에 받은 데이터를 GPU 메모리로 다시 복사합니다. NVIDIA GDS 개요 가이드는 이 중간 복사가 지연을 늘리고 유효 대역폭을 낮춘다고 설명합니다.

{{< flow src="_flow/2-일반-경로.json" />}}

GPUDirect Storage(GDS)는 NVMe나 NIC 근처의 DMA(직접 메모리 접근) 엔진으로 데이터를 GPU 메모리에 직접 보냅니다. CPU 시스템 메모리를 중간 버퍼로 쓰던 데이터 경로가 바뀌는 것입니다.

{{< flow src="_flow/2-gds-경로.json" />}}

요청을 제출하고 완료를 처리하는 일은 CPU에 남습니다. 애플리케이션은 CPU에서 cuFile API를 호출합니다. `nvidia-fs.ko`를 쓰는 구성에서는 `libcufile.so`가 모드를 선택하고 모듈에 IOCTL을 보내며, 커널 파일시스템 드라이버도 CPU에서 직접 전송을 설정합니다. NVIDIA 개요 가이드와 IIT NIXL 벤치마크 논문(5절)을 함께 보면, 데이터 평면에서 CPU 메모리를 우회하더라도 제어 평면에는 요청마다 CPU 고정 비용이 듭니다.

이 차이는 원격 스토리지에서도 이어집니다. NIC과 GPU 사이의 GPUDirect RDMA(NIC이 GPU 메모리에 직접 접근하는 방식)는 [06편]({{< relref "/platform/kubernetes/gpu/06-gpudirect-rdma-basics/index.md" >}})과 [07편]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}})에서 설명했습니다. 스토리지에서는 여기에 파일시스템과 NVMe 전송 드라이버의 지원 조건이 더해집니다.

아래 버전과 지원 범위는 2026-10-21 조사 기준입니다. 표의 `✓`는 1차 출처에서 확인한 내용을 뜻합니다. 벤더의 성능 주장과 이 글의 추정은 본문에서 따로 밝힙니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| GPUDirect Storage(GDS) 버전 | 1.19.1. 릴리스 날짜는 페이지에 없고 문서 갱신일이 2026-09-17 | NVIDIA GDS 릴리스 노트 | `✓` |
| CUDA Toolkit | 13.4.1. GDS 패키지 이름이 13-4 계열 | CUDA 릴리스 노트 | `✓` |
| `nvidia-fs` 모듈 | v2.31.5(2026-10-20). GPU Operator 26.7.0이 번들한 것은 v2.29.4 | gds-nvidia-fs 릴리스 | `✓` |
| GPU Operator | v26.7.2(2026-10-14) | GPU Operator 릴리스 | `✓` |
| DOCA | 문서 3.5.0 | DOCA SDK 문서 | `✓` |
| SPDK | v26.09. 최신 공식 성능 보고서는 26.01 | SPDK 릴리스 | `✓` |
| Mayastor | v2.12.2. NVMe-oF RDMA는 2.8.0에서 추가 | OpenEBS Mayastor 릴리스 | `✓` |

{{% /details %}}

## 2. 파일시스템을 확인한 뒤 드라이버 경로를 고른다 {#2-파일시스템과-드라이버가-직접-경로를-결정한다}

GDS를 설치하기 전에 데이터가 놓일 파일시스템부터 확인해야 합니다. GDS 1.19.1 릴리스 노트의 배포용 지원 목록에는 EXT4, XFS, DDN EXAScaler(Lustre), IBM Spectrum Scale(GPFS), WekaFS, BeeGFS, NFS, ScaTeFS, VirtioFS가 있습니다. TMPFS, OverlayFS, ZFS, BTRFS는 개발용 지원이며, CPU 시스템 메모리를 거치는 호환 모드로만 동작합니다. VDURA PanFS는 1.19.1부터 파트너 행렬에 추가됐습니다.

같은 파일시스템을 쓰더라도 로컬 NVMe인지, 원격 NVMe인지에 따라 드라이버가 달라집니다. GDS 1.13부터 x86_64의 로컬 NVMe에 ext4나 xfs를 사용하는 경우에는 업스트림 커널의 PCI P2PDMA(PCIe 장치 간 직접 메모리 전송)를 선택할 수 있습니다. 이 경로에는 `nvidia-fs.ko`와 MOFED의 NVMe 패치가 필요하지 않습니다.

```
# cufile.json
"properties": { "use_pci_p2pdma": true }
```

NVIDIA GDS NVMe 지원 문서가 명시한 조건은 OpenRM 565.47 이상, ACS 비활성화, IOMMU `pt` 또는 `off`입니다. 커널 하한은 Ubuntu 22.04에서 6.2, RHEL 9.4에서 5.14입니다. 제외 범위는 "Arm64-based GraceHopper platforms, RAID0 over NVMe and NVMEoF are not supported in this release"라고 적혀 있습니다. Arm64 Grace Hopper, NVMe RAID0, NVMe-oF에는 이 경로를 적용할 수 없습니다.

`nvidia-fs`를 쓰는 기존 경로를 선택했다면 MLNX_OFED나 DOCA를 GDS보다 먼저 설치합니다. GDS 릴리스 노트와 트러블슈팅 가이드에 따르면, 커널 6.17 이상에서 `nvidia-fs`로 로컬 NVMe를 사용하려면 DOCA 3.3.0 이상이 필요합니다. block integrity 기능이 있는 NVMe 장치는 GDS I/O 경로를 쓸 수 없습니다.

드라이버 지원과 별개로 노드 안의 PCIe 연결도 성능에 영향을 줍니다. 토폴로지를 읽는 방법은 [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}})에 있습니다.

## 3. NVMe-oF에서 호스트와 Target이 맡는 일 {#3-원격-nvme에서는-호스트와-스토리지의-cpu를-나눠-본다}

NVMe-oF는 네트워크 너머의 NVMe에 접근하는 방식입니다. RDMA를 사용하면 RNIC(RDMA를 지원하는 NIC)가 데이터를 메모리에 직접 쓰지만, 그 메모리가 GPU 메모리인지는 별도 조건입니다.

### 호스트 메모리까지의 RDMA와 GPU까지의 GDS

1차 자료를 종합하면, 호스트의 커널 이니시에이터 `nvme-rdma`는 RNIC를 통해 호스트 메모리 버퍼에 데이터를 받습니다. TCP에서 CPU가 하던 소켓 복사와 체크섬 처리는 빠지지만, 명령 제출·완료 처리·블록 계층·파일시스템은 호스트 CPU에서 실행됩니다. GDS가 없으면 목적지는 페이지 캐시나 유저 버퍼이므로, GPU로 옮길 때 `cudaMemcpy`가 한 번 더 필요하다는 해석입니다.

GDS와 결합하면 목적지를 GPU 메모리로 바꿀 수 있습니다. cuFile에서 nvidia-fs, 파일시스템, nvme-rdma로 이어지는 제어 경로는 이때도 CPU에 남습니다. 업스트림 P2PDMA는 NVMe-oF를 지원하지 않으므로 DOCA의 `mlnx-nvme` 패키지를 사용해야 합니다.

```
# Ubuntu
sudo apt install doca-ofed mlnx-fw-updater mlnx-nvme-dkms
# RHEL
sudo dnf install doca-ofed mlnx-fw-updater kmod-mlnx-nvme
```

GDS 트러블슈팅 가이드 17.3은 NVMe와 NVMe-oF 전송 패키지를 DOCA로 설치하도록 권장하며, 같은 시스템에서 MLNX_OFED와 DOCA 전송 패키지를 섞지 말라고 경고합니다. 호스트 연결은 `nvme-cli`의 예시처럼 지정합니다. NVMe/RDMA 기본 포트는 4420입니다.

```
nvme connect --transport=rdma --traddr=192.168.1.3 \
  --nqn=nqn.2014-08.com.example:nvme:nvm-subsystem-sn-d78432
```

재연결과 keep-alive는 `--ctrl-loss-tmo`, `--reconnect-delay`, `--keep-alive-tmo`, 큐는 `--nr-io-queues` 등으로 조절합니다. Portworx 문서는 부팅 시 `nvme-fabrics`와 `nvme-rdma` 모듈을 로드하고 `nvme-cli`를 설치하며, 노드별 `/etc/nvme/hostnqn`과 `/etc/nvme/hostid`를 고유하게 설정하도록 요구합니다. 스토리지 NIC을 배치할 패브릭은 [10편]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})에서 다룹니다.

### Target Offload와 DPU가 옮기는 CPU 작업

스토리지의 Target은 요청을 받는 쪽입니다. ConnectX-5 이상의 NVMe-oF Target Offload에서는 HCA가 일반 I/O를 처리하고 PCIe P2P로 실제 NVMe에 전달합니다. MLNX_OFED 문서는 연결 관리와 오류 처리를 제외하면 CPU 사용이 관측되지 않는다고 설명합니다. 이는 벤더의 동작 설명입니다.

호스트 쪽 BlueField SNAP은 스토리지 네트워크 스택을 DPU(데이터 처리 장치)의 Arm 코어로 옮깁니다. 호스트에는 일반 PCIe NVMe 장치로 보여 표준 드라이버를 사용할 수 있으며, SNAP 문서는 원격 스토리지에서 호스트로 zero-copy DMA를 지원한다고 설명합니다. 여기서 CPU 우회는 호스트 CPU의 일을 DPU Arm 코어가 맡는다는 뜻으로 해석해야 합니다.

DOCA 3.5의 서비스 목록에서 SNAP-4는 BlueField-3용, SNAP-3는 BlueField-2용입니다. BlueField-4는 목록에 없으며, SNAP 문서에는 Kubernetes가 언급되지 않습니다. SNAP으로 에뮬레이션한 NVMe에서 GDS를 쓸 수 있는지도 확인하지 못했습니다.

JBOF와 EBOF에서는 DPU가 스토리지 서버의 CPU를 대신하기도 합니다. SPDK 26.01 보고서는 Supermicro E3.S JBOF의 BlueField-3 Arm 16코어에서 Target을 실행했습니다. 4KiB 랜덤 읽기, 큐 깊이 64에서 약 1,009만 IOPS와 평균 100.9µs를 기록했습니다.

### CPU 효율은 코어 수와 폴링 방식을 함께 읽는다

SPDK 24.05 보고서에서 4KiB 랜덤 읽기는 RDMA가 약 8코어에서 포화했고 TCP는 비슷한 IOPS를 내는 데 16~32코어 구간이 필요했습니다. RDMA의 큐 깊이는 128, TCP는 384로 다릅니다. RDMA 보고서의 링크 구성 서술도 섞여 있어 엄밀한 동일 조건 비교보다는 경향을 보여주는 자료로 읽어야 합니다.

SPDK Target과 커널 Target의 비교에서는 RDMA 4KiB 랜덤 쓰기의 코어당 IOPS 차이가 최대 8.17배였습니다. 이 값은 Target 측 비교이므로, 커널 이니시에이터를 쓰는 Kubernetes 클라이언트 노드의 CPU 비용이 얼마나 달라질지는 이 수치로 판단할 수 없습니다.

코어 효율이 높아도 CPU 사용률이 낮게 표시되는 것은 아닙니다. SPDK나 Mayastor의 폴링 구현은 완료 여부를 계속 확인하므로 I/O 부하와 무관하게 할당된 코어를 100% 사용합니다. Mayastor 2.12.0 릴리스 노트에도 이 동작이 명시돼 있습니다. Impact of Commodity Networks on Storage Disaggregation with NVMe-oF 논문(Bench 2020)의 SPDK 측정에서도 폴링 기반 RoCE와 InfiniBand의 클라이언트 CPU 사용률은 약 92%였습니다. 네이티브 IB가 대부분 우세했지만 큰 I/O에서는 IPoIB가 CPU 사용률과 꼬리 지연에서 나은 경우가 있었습니다. ConnectX-3·5 세대의 결과를 현재 장비에 그대로 적용하기는 어렵습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| SPDK 26.01 BlueField-3 Target | Supermicro E3.S JBOF, BF3 Arm 16코어, 4KiB 랜덤 읽기 QD=64, 10,090.6k IOPS, 평균 100.9µs | SPDK 성능 보고서 26.01 | `✓` |
| SPDK 24.05 RDMA | ConnectX-5, Kioxia SSD 14개, 4KiB 랜덤 읽기 QD 128. 1코어 1,564.5k IOPS, 8코어 10,810.4k IOPS(평균 165.6µs). 약 8코어 포화(약 42 GB/s) | SPDK 성능 보고서 24.05 RDMA | `✓` |
| SPDK 24.05 TCP | 같은 조건에 QD 384. 8코어 5,571.4k IOPS, 16코어 9,877.2k IOPS, 32코어 11,040.7k IOPS(평균 476.4µs). 400Gbps 포화에 48코어 | SPDK 성능 보고서 24.05 TCP | `✓` |
| SPDK와 커널 Target의 코어 효율 | RDMA에서 4KiB 랜덤 쓰기 코어당 IOPS 최대 8.17배, RDMA 이니시에이터 평균 지연 최대 49.73% 낮음, TCP는 코어당 IOPS 최대 1.69배 | SPDK 성능 보고서 24.05 | `✓` |

{{% /details %}}

## 4. Kubernetes에서는 드라이버와 데이터 볼륨을 함께 준비한다 {#4-kubernetes에서-gds와-nvme-of를-구성한다}

GPU 장치를 파드에 할당해도 스토리지 경로는 별도로 준비해야 합니다. 노드 드라이버가 컨테이너의 장치·마운트 주입으로 이어지고, 실제 데이터가 GDS 지원 파일시스템에 있어야 합니다.

GPU Operator 26.7의 GDS 지원표에는 Ubuntu 24.04·22.04(Network Operator 25.7.0과 함께)와 OpenShift 4.18 이상이 있으며 RHEL은 없습니다. 베어메탈과 vSphere VM을 지원하고 오픈 커널 모듈 드라이버가 필수입니다. 각주에 명시된 스토리지는 로컬 NVMe와 원격 NFS이며 secure boot는 지원하지 않습니다. GDS 자체의 파일시스템 목록과 Operator의 검증 범위를 구분해서 읽어야 합니다.

노드에서는 GPU Operator가 드라이버 DaemonSet의 `nvidia-fs-ctr` 컨테이너로 `nvidia-fs`를 올립니다. 네트워크 드라이버는 Network Operator가 설치한다는 전제이며, 호스트에 직접 설치한 경우에는 `driver.rdma.useHostMofed=true`를 지정합니다.

```yaml
gds:
  enabled: true
driver:
  rdma:
    useHostMofed: true   # 호스트에 DOCA-OFED를 직접 설치한 경우
```

device plugin의 `--gds-enabled` 또는 환경변수 `GDS_ENABLED`가 켜져 있으면 GPU를 요청한 컨테이너에 `NVIDIA_GDS=enabled`가 주입됩니다. nvidia-container-toolkit은 이 값을 받아 캐릭터 디바이스 `/dev/nvidia-fs*`와 마운트 `/run/udev`, `/etc/cufile.json`을 넣습니다. 이 과정은 두 프로젝트의 소스에서 확인할 수 있습니다.

{{< flow src="_flow/5-파드-주입-경로.json" />}}

이 주입 경로를 사용하면 파드에 `/dev/nvidia-fs*` hostPath를 별도로 적을 필요가 없습니다. device plugin 설정, 드라이버 파드의 `mofed-validation` init 컨테이너와 `nvidia-fs-ctr`, `lsmod | grep nvidia` 출력의 `nvidia_fs`를 확인합니다. GPU Operator 26.3.3 문서 업데이트에는 `MOFED_ENABLED`와 `GDS_ENABLED`가 기본으로 켜지던 회귀가 언급돼 있으므로, 활성화 상태가 의도한 설정인지도 확인해야 합니다.

데이터 볼륨으로는 로컬 NVMe의 hostPath·Local PV나 원격 NFS·Lustre CSI(컨테이너 스토리지 인터페이스) 볼륨을 검토할 수 있습니다. OverlayFS는 호환 모드만 지원합니다. 따라서 컨테이너 rootfs인 overlayfs의 쓰기 레이어에 학습 데이터를 두면 GDS 직접 경로를 사용할 수 없습니다. 파일시스템·오브젝트 스토리지·병렬 파일시스템의 선택 기준은 [GPU 클러스터 스토리지]({{< relref "/data/gpu-storage/02-data-path-and-filesystems/index.md" >}}) 시리즈에 있습니다.

### 블록 CSI와 벤더 파일시스템 클라이언트

조사한 상용 블록 CSI는 주로 NVMe/TCP를 제시했습니다. 블록형 NVMe-oF CSI에서 RDMA를 공식 지원하는 선택지는 조사 범위상 Mayastor와 Portworx/FlashArray 정도로 보입니다.

| 드라이버 | RDMA 전송 | 구성과 제약 |
|---|---|---|
| OpenEBS Mayastor | 2.8.0부터 지원 | Helm `io_engine.target.nvmf.rdma.enabled: true`, `io_engine.target.nvmf.iface`. RDMA 없는 노드는 기본 `csi.node.nvme.tcpFallback: true`로 nvme-tcp 폴백 |
| Portworx + Pure FlashArray | Portworx 2.13.0 이상 | StorageCluster 생성 시 NVMe-oF RDMA 선택. iSCSI·FC에서 제자리 전환 불가 |
| NetApp Trident(ontap-san) | 문서에 RDMA 언급 없음 | iSCSI, FC, NVMe/TCP |
| Lightbits(lb-csi) | NVMe/TCP 전용 설계 | NVMe-oF RDMA 경로가 아님 |
| WEKA, VAST, DDN | NVMe-oF CSI가 아님 | 호스트 클라이언트나 NFS를 마운트 |

Mayastor 2.11에서 추가된 `io_engine.nvme.transportTos`는 RDMA DSCP 마킹을 지정합니다. 공유 RoCE 패브릭에서 스토리지 트래픽을 별도 PFC 큐로 분류하는 용도입니다. 2.12부터 CSI 노드는 `nvme_rdma` 모듈로 RDMA 능력을 감지합니다.

Portworx 문서의 지원 구성은 FlashArray Direct Access와 Cloud Drives이며, FlashArray//X NVMe/RoCE의 Purity 범위는 6.1.14~6.9.0입니다. 선택에 쓰는 정확한 StorageCluster 필드 이름은 확인하지 못했습니다.

WEKA CSI 2.9.7 README는 호스트 WEKA 클라이언트를 사용한다고 설명하며 GDS는 언급하지 않습니다. VAST·DDN·Dell CSI의 RDMA·GDS 옵션도 확인하지 못했습니다. WEKA, VAST, DDN, GPFS, Lustre 같은 병렬·분산 파일시스템에서는 RDMA와 GDS 처리가 CSI보다 호스트 벤더 클라이언트의 설정에 달렸다고 해석할 수 있습니다. GPU Operator가 명시한 지원 스토리지는 로컬 NVMe와 NFS라는 점을 함께 봐야 합니다.

AWS FSx for Lustre는 EFA와 GDS를 함께 쓰는 공식 구성을 제공합니다. P5, P5e, P5en, P6-B200, P6-B300에서 GDS 드라이버 2.24.2 이상을 `NVFS_MAX_PEER_DEVS=128 NVFS_MAX_PCI_DEPTH=16`으로 빌드하며, 파일시스템당 EFA 연결 한도는 1024개입니다. AWS가 발표한 클라이언트 인스턴스당 최대 12배·1200 Gbps는 벤더의 성능 주장입니다. 이 구성을 EKS에서 운영한 공개 사례는 찾지 못했습니다.

DGX B300의 로컬 디스크는 캐시용 E1.S 3.84TB NVMe 8개와 부팅용 M.2 2개입니다. 레퍼런스 아키텍처를 보면 주 스토리지는 병렬 파일시스템이나 NFS이고 로컬 NVMe는 캐시·스크래치로 쓰는 것으로 짐작할 수 있습니다.

GPU 노드가 외부 NVMe-oF 블록 볼륨을 CSI로 붙여 학습 데이터를 읽는 공개 사례는 찾지 못했습니다. RWO로 제공하는 블록 볼륨은 한 노드에서 읽기·쓰기로 마운트하므로 여러 노드가 같은 데이터셋을 읽는 용도로는 제약이 있습니다. [Kubernetes 접근 모드 문서](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#access-modes)에 따르면 RWO는 같은 노드의 여러 파드가 사용할 수 있으며, 단일 파드 제한은 RWOP입니다. 따라서 RWO 볼륨의 제약을 NVMe-oF 자체의 단일 파드 제약으로 해석해서는 안 됩니다. 실제 학습·추론 경로에서의 활용은 [09편]({{< relref "/platform/kubernetes/gpu/09-storage-reality/index.md" >}})에서 이어집니다.

## 5. 직접 전송 여부를 확인한 뒤 I/O 성능을 잰다 {#5-읽기에-성공했어도-경로와-성능은-따로-확인한다}

cuFile로 파일을 읽었다는 사실만으로 GDS 직접 전송을 확인할 수는 없습니다. `properties.allow_compat_mode`의 기본값이 true이므로 CPU 시스템 메모리를 거치는 호환 모드로 전환돼도 프로그램은 실행될 수 있습니다. `gdscheck -p`가 표시하는 줄 이름은 `properties.use_compat_mode`로, 설정 키와 다릅니다.

NVIDIA GDS 개요 가이드는 호환 모드를 사용하도록 설정한 경우, `nvidia-fs.ko`가 없는 경우, 미지원 파일시스템을 쓰는 경우, O_DIRECT를 쓸 수 없는 경우를 진입 조건으로 설명합니다. 모듈 부재 항목에는 호스트에 모듈이 없는 컨테이너가 해당합니다. 문서에 따르면 호환 모드는 GDS 없는 CPU API와 같거나 나은 성능을 내지만 GDS 직접 경로의 이득은 없습니다.

경로를 확인하려면 `logging.level`을 `TRACE`로 설정하고 `cufile.log`에서 `cufile IO mode: POSIX`를 찾습니다.

```
# cufile.json
"logging": { "level": "TRACE" }

# cufile.log에서 호환 모드로 떨어졌는지 찾는다
cufile IO mode: POSIX
```

`/proc/driver/nvidia-fs/stats`는 호환 모드와 P2PDMA I/O를 집계하지 않습니다. 통계가 비어 있어도 어느 경로였는지 확정할 수 없습니다. vLLM v0.32.0의 fastsafetensors 로더에도 GDS 미지원 파일시스템에서 `CU_FILE_HANDLE_NOT_REGISTERED`가 발생하면 `nogds=True`로 재시도하는 처리가 있습니다.

NVIDIA 개발자 포럼에는 `gdscheck -p`가 NVMe Unsupported를 표시해도 cuFile I/O가 동작하고 gdsio 처리량이 높게 나왔다는 보고가 있습니다. 커뮤니티 보고이므로 상태 줄 하나를 판정 기준으로 삼기보다는 로그와 처리량을 함께 확인해야 한다는 참고 자료로 봅니다.

### 유리한 I/O 패턴과 공개 측정의 한계

직접 전송이 동작해도 속도 향상은 별도로 측정해야 합니다. NVIDIA 개요 가이드가 이득을 기대하는 조건은 스토리지에서 GPU로 가는 I/O가 병목이고, 파이프라인이 GPU에서 실행되는 경우입니다. GPU 메모리에 들어가는 데이터를 명시적으로 큰 단위로 스트리밍하면 호출당 오버헤드를 분산할 수 있다는 설명입니다.

세밀한 랜덤 접근이나 mmap·managed memory의 페이지 폴트 기반 접근은 이 패턴과 다릅니다. 정렬되지 않은 오프셋·주소·크기도 처리할 수는 있지만 직접 전송은 아닙니다. 파일시스템이 해당 크기의 RDMA를 지원하지 않는 아주 작은 I/O, GPU BAR1 aperture보다 큰 전송 역시 이득이 작거나 직접 경로가 성립하지 않는 범위입니다. 개요 가이드가 말하는 최대 대역폭 '최소 두 배'는 PCIe 스위치 경로를 CPU 경유 경로와 비교한 벤더 주장이며, 플랫폼 토폴로지가 조건입니다.

벤더 밖의 IIT NIXL 논문은 읽기와 쓰기에서 다른 결과를 보고했습니다. Chameleon 노드의 AMD EPYC 7763, A100-PCIe-40GB 한 장, ext4 로컬 NVMe 하나에 CUDA 12.9, nvidia-fs 2.25, gdsio v0.4.1을 사용한 측정입니다.

| 측정 항목 | 논문에 서술된 결과와 해석 |
|---|---|
| 쓰기 | 128KiB 미만은 두 경로가 거의 같고, 큰 I/O에서는 CPU 경유가 훨씬 우세함. 저자들은 GPU 페이지 크기 64KB 때문에 P2P DMA 요청이 쪼개져 작은 I/O가 늘어난다고 설명 |
| 읽기 | GDS 직접 경로가 가장 우세함 |
| 배치 | 성능에 영향이 없음. 배치 안의 요청도 하나씩 제출하기 때문이라는 해석 |
| 비동기 | 성능이 가장 낮음. 작은 I/O가 많을 때 요청마다 인터럽트가 발생하기 때문이라고 설명 |

논문은 GDS가 항상 전통적인 CPU-GPU 경로보다 빠르지는 않다고 결론 내립니다. 결과는 그래프 서술이며 절대 수치는 없습니다. 단일 GPU와 로컬 NVMe 하나를 다룬 확장 초록 규모의 결과를 대규모 병렬 파일시스템에 그대로 적용할 수는 없습니다.

ACM Phoenix 논문도 GDS 소프트웨어 스택이 critical path에 큰 오버헤드를 더한다고 주장합니다. 초록에 나온 소프트웨어 오버헤드 평균 70.3% 감소와 작은 I/O 약 2.29배는 본문을 확인하지 못했고 별도로 검증하지도 못했습니다.

## 6. 확인하지 못한 것

- GDS 1.19.1과 CUDA 13.4.1의 정확한 릴리스 날짜. 문서에 갱신일만 있다.
- GPU Operator 26.7.x에서 GDS 테스트 파드의 공식 YAML 예시. 문서에는 RDMA 테스트 파드만 있다.
- Crusoe의 GDS 활성화 문서. 접근이 막혀 내용을 확인하지 못했다.
- Portworx에서 NVMe-oF RDMA를 고르는 정확한 StorageCluster 필드나 환경변수 이름, 최신 Portworx 버전.
- VAST CSI, DDN EXAScaler CSI, Dell CSI, Lightbits CSI의 최신 버전과 RDMA·GDS 옵션.
- WEKA와 VAST가 Kubernetes 환경에서 GDS를 쓰는 공식 절차.
- SNAP으로 에뮬레이션한 NVMe에서 GDS를 쓸 수 있는지, BlueField-4의 SNAP 지원 상태.
- Phoenix 논문 본문. 초록 검색 결과만 봤다.

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
