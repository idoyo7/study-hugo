---
title: "스토리지"
date: 2026-10-04
lastmod: 2026-10-21
weight: 30
comments: false
cascade:
  type: docs
url: "/storage/"
linkTitle: "블록 스토리지"
---

# 스토리지 — NVMe 용량을 네트워크 너머로 나눠 줄 때

## 이 분류에서 찾기 {#section-navigation}

- [01 iSCSI와 NVMe-oF]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}})
- [02 VM 디스크 경로]({{< relref "/data/block-storage/02-vm-disk-paths/index.md" >}})
- [03 로컬 디스크와 복제]({{< relref "/data/block-storage/03-local-disk-ha/index.md" >}})
- [04 엔터프라이즈 전송 현황]({{< relref "/data/block-storage/04-enterprise-transports/index.md" >}})
- [05 호스트·클라우드·오프로드]({{< relref "/data/block-storage/05-host-side-and-cloud/index.md" >}})
- [06 Linux NVMe/TCP 운영]({{< relref "/data/block-storage/06-linux-nvme-tcp-operations/index.md" >}})
- [07 FC·TCP·RDMA 전송 비교]({{< relref "/data/block-storage/07-fc-tcp-rdma-transports/index.md" >}})
- [08 Kubernetes NVMe-oF와 Mayastor]({{< relref "/data/block-storage/08-kubernetes-nvmeof-mayastor/index.md" >}})
- [부록 A NVMe HDD]({{< relref "/data/block-storage/a1-nvme-hdd/index.md" >}})
- [부록 B NFS]({{< relref "/data/block-storage/a2-nfs/index.md" >}})

NVMe SSD가 많이 꽂힌 스토리지 서버의 용량을 여러 호스트와 VM에 나눠 줄 때, 내보내는 방식에 따라 I/O 경로와 오버헤드가 달라집니다. 같은 SSD라도 SCSI 명령으로 바꿔 싣는지, NVMe 명령을 capsule로 싣는지, 호스트에는 어떤 모양의 장치로 보이는지에 따라 요청 하나가 거치는 계층이 달라지기 때문입니다.

01은 iSCSI와 NVMe-oF를 전송과 타깃·백엔드 쪽에서 비교합니다. 호스트 I/O 경로와 큐 구조, 쓰기 데이터 흐름, 타깃이 내보내는 가상 NVMe controller와 namespace, 커널·SPDK 타깃 구현과 Ceph RBD·Kubernetes 스토리지까지 다룹니다. 02는 NVMe 용량을 VM에 나누는 방식(virtio·vhost·vfio-user·직접 할당·DPU 에뮬레이션)을 게스트 인터페이스와 요청 처리 주체로 비교합니다.

04는 2026년 기준으로 엔터프라이즈 어레이 벤더가 호스트에 내놓는 전송과 NVMe/TCP·RDMA의 격차를, 05는 Kubernetes CSI와 Linux 노드의 NVMe-oF 지원 수준, 클라우드 블록 볼륨의 기반 기술, 오프로드 하드웨어를 다룹니다. 06은 Linux 호스트에서 NVMe/TCP를 FC SAN처럼 운영하는 데 필요한 요소를, 07은 FC·TCP·RDMA 세 전송을 전송 자체만 놓고 비교하며, 08은 Kubernetes에서 NVMe-oF를 쓰는 길을 Mayastor를 중심으로 살펴봅니다.

비교 근거는 장치·커널·블록 크기·큐 깊이가 서로 다른 논문과 벤치마크에 흩어져 있습니다. 수치마다 측정 조건을 같이 적었고, 조건이 다른 값은 같은 차트나 표 행에 올리지 않았습니다. 확인하지 못한 항목은 `?`로 남겼습니다.

## 문서 지도

iSCSI와 NVMe-oF의 비교는 01, VM 디스크 전달 방식은 02부터 읽으셔도 됩니다.

| 문서 | 다루는 것 |
|---|---|
| [01 iSCSI와 NVMe-oF]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}}) | 이점·조건 표와 RocksDB 실측, 타깃이 내보내는 NVMe 장치, 호스트 스택과 큐 구조, 쓰기 데이터 흐름, 타깃 구현과 백엔드, RBD·Kubernetes 구현 |
| [02 VM 디스크 경로]({{< relref "/data/block-storage/02-vm-disk-paths/index.md" >}}) | virtio·vhost·vfio-user·직접 할당·DPU 에뮬레이션의 경로 비교와 실측 |
| [03 로컬 디스크와 복제]({{< relref "/data/block-storage/03-local-disk-ha/index.md" >}}) | 복제를 스토리지와 애플리케이션 중 어디에 둘지, 로컬 디스크의 수명 계약, 워크로드별 HA 가능 여부, 2곳과 3곳의 용량 산술, Kubernetes의 복제 스토리지와 로컬 PV 비교 |
| [04 엔터프라이즈 전송 현황]({{< relref "/data/block-storage/04-enterprise-transports/index.md" >}}) | 어레이 벤더별 호스트 전송, RoCE가 어레이 안쪽 패브릭으로 간 이유, FC-NVMe와 iSCSI의 자리, 전송 간 격차 수치, 멀티패스·ANA·TLS·인증 |
| [05 호스트·클라우드·오프로드]({{< relref "/data/block-storage/05-host-side-and-cloud/index.md" >}}) | Kubernetes CSI와 Linux 노드의 NVMe-oF 지원, vSphere를 사용할 때의 연결 조건, 클라우드 블록 볼륨의 기반 전송, 오프로드 하드웨어와 Ultra Ethernet |
| [06 Linux NVMe/TCP 운영]({{< relref "/data/block-storage/06-linux-nvme-tcp-operations/index.md" >}}) | hostnqn·자동 연결, CDC·nvme-stas 디스커버리, 네이티브 멀티패스·ANA·iopolicy, 타임아웃과 장애 동작, DH-HMAC-CHAP·TLS, 홈랩 nvmet 타깃, FC 운영 개념 대응표 |
| [07 FC·TCP·RDMA 전송 비교]({{< relref "/data/block-storage/07-fc-tcp-rdma-transports/index.md" >}}) | 세 전송의 동작 원리와 네트워크 특성, FC가 안정적이라는 말의 범위, 접근성, 자료별 공개 측정(IOPS·지연·CPU), 보안·디스커버리·부팅, 어디에 무엇이 맞는가 |
| [08 Kubernetes NVMe-oF와 Mayastor]({{< relref "/data/block-storage/08-kubernetes-nvmeof-mayastor/index.md" >}}) | Mayastor 데이터 경로와 요구 자원, 기능 상태, 공개 IOPS 측정의 조건, 프로덕션 사례와 상용 지원, Longhorn V2·LINSTOR·Ceph 등 대안 비교, 선택 기준과 홈랩 구성 |
| [부록 A NVMe HDD]({{< relref "/data/block-storage/a1-nvme-hdd/index.md" >}}) | HDD를 NVMe로 붙이는 두 경로, 규격·제품 상태, 기구 시간 대비 프로토콜 오버헤드, 큐와 액추에이터 |
| [부록 B NFS]({{< relref "/data/block-storage/a2-nfs/index.md" >}}) | NFS를 iSCSI·NVMe-oF와 한 표에 놓을 수 있는 전송 구조, 놓을 수 없는 쓰기 의미와 캐시, 2004년 실측과 최근 자료의 한계, VM 디스크·볼륨으로 쓸 때, NFS가 맞는 경우 |

## 비교할 때 함께 볼 조건

- 변환 계층. iSCSI는 NVMe SSD 앞에서 SCSI 계층과 iSCSI 처리를 거치고, NVMe-oF는 호스트 경로에서 그 단계가 빠진다. 다만 TCP 전송에는 TCP/IP 처리와 복사·CRC가 남고, 제거된 처리만 분리해 잰 값은 없다. 장치가 빠를수록 같은 오버헤드의 비중이 커진다.
- 큐 구조. Linux 소프트웨어 iSCSI는 세션당 하드웨어 큐 1개와 TCP 연결 1개가 기본이고, Linux NVMe/TCP host는 기본으로 CPU 수만큼 I/O 큐와 연결을 연다. 프로토콜이 허용하는 것과 구현이 하는 것을 구분해야 한다.
- 전송. 공개 논문에서 iSCSI와 한 조건으로 잰 NVMe-oF는 RDMA다. NVMe/TCP와 iSCSI를 함께 잰 값은 벤더 자료와 Longhorn 벤치마크이고, TCP 전송에는 SCSI 변환을 빼도 TCP/IP 처리와 복사·CRC 비용이 남는다.
- 타깃·백엔드. 커널 nvmet과 SPDK, lvol·복제 계층에 따라 평균 지연·꼬리 지연·코어당 효율이 따로 움직인다.
- VM 전달. 같은 NVMe 용량도 virtio·vhost·직접 할당 중 무엇으로 VM에 주느냐에 따라 요청 처리 주체와 남는 소프트웨어 처리가 다르다.
- 수치가 측정된 조건. 장치·커널·블록 크기·큐 깊이가 다르면 같은 막대에 올릴 수 없다. 공식 문서에 설계 목표만 있는 방식은 측정값 칸을 비워 둔다.
