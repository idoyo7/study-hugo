---
title: "스토리지"
date: 2026-10-04
lastmod: 2026-10-04
weight: 210
comments: false
cascade:
  type: docs
---

# 스토리지 — NVMe 용량을 네트워크 너머로 나눠 줄 때

NVMe SSD가 많이 꽂힌 스토리지 서버의 용량을 여러 호스트와 VM에 나눠 줄 때, 내보내는 방식에 따라 I/O 경로와 오버헤드가 달라집니다. 같은 SSD라도 SCSI 명령으로 바꿔 싣는지, NVMe 명령을 capsule로 싣는지, 호스트에는 어떤 모양의 장치로 보이는지에 따라 요청 하나가 거치는 계층이 달라지기 때문입니다.

01은 iSCSI와 NVMe-oF를 전송과 타깃·백엔드 쪽에서 비교합니다. 호스트 I/O 경로와 큐 구조, 쓰기 데이터 흐름, 타깃이 내보내는 가상 NVMe controller와 namespace, 커널·SPDK 타깃 구현과 Ceph RBD·Kubernetes 스토리지까지 다룹니다. 02는 NVMe 용량을 VM에 나누는 방식(virtio·vhost·vfio-user·직접 할당·DPU 에뮬레이션)을 게스트 인터페이스와 요청 처리 주체로 비교합니다.

비교 근거는 장치·커널·블록 크기·큐 깊이가 서로 다른 논문과 벤치마크에 흩어져 있습니다. 수치마다 측정 조건을 같이 적었고, 조건이 다른 값은 같은 차트나 표 행에 올리지 않았습니다. 확인하지 못한 항목은 `?`로 남겼습니다.

## 문서 지도

iSCSI와 NVMe-oF의 비교는 01, VM 디스크 전달 방식은 02부터 읽으셔도 됩니다.

| 문서 | 다루는 것 |
|---|---|
| [01 iSCSI와 NVMe-oF]({{< relref "01-iscsi-nvme-of/index.md" >}}) | 이점·조건 표와 RocksDB 실측, 타깃이 내보내는 NVMe 장치, 호스트 스택과 큐 구조, 쓰기 데이터 흐름, 타깃 구현과 백엔드, RBD·Kubernetes 구현 |
| [02 VM 디스크 경로]({{< relref "02-vm-disk-paths/index.md" >}}) | virtio·vhost·vfio-user·직접 할당·DPU 에뮬레이션의 경로 비교와 실측 |

## 비교할 때 함께 볼 조건

- 변환 계층. iSCSI는 NVMe SSD 앞에서 SCSI 계층과 iSCSI 처리를 거치고, NVMe-oF는 호스트 경로에서 그 단계가 빠진다. 다만 TCP 전송에는 TCP/IP 처리와 복사·CRC가 남고, 제거된 처리만 분리해 잰 값은 없다. 장치가 빠를수록 같은 오버헤드의 비중이 커진다.
- 큐 구조. Linux 소프트웨어 iSCSI는 세션당 하드웨어 큐 1개와 TCP 연결 1개가 기본이고, Linux NVMe/TCP host는 기본으로 CPU 수만큼 I/O 큐와 연결을 연다. 프로토콜이 허용하는 것과 구현이 하는 것을 구분해야 한다.
- 전송. 공개 논문에서 iSCSI와 한 조건으로 잰 NVMe-oF는 RDMA다. NVMe/TCP와 iSCSI를 함께 잰 값은 벤더 자료와 Longhorn 벤치마크이고, TCP 전송에는 SCSI 변환을 빼도 TCP/IP 처리와 복사·CRC 비용이 남는다.
- 타깃·백엔드. 커널 nvmet과 SPDK, lvol·복제 계층에 따라 평균 지연·꼬리 지연·코어당 효율이 따로 움직인다.
- VM 전달. 같은 NVMe 용량도 virtio·vhost·직접 할당 중 무엇으로 VM에 주느냐에 따라 요청 처리 주체와 남는 소프트웨어 처리가 다르다.
- 수치가 측정된 조건. 장치·커널·블록 크기·큐 깊이가 다르면 같은 막대에 올릴 수 없다. 공식 문서에 설계 목표만 있는 방식은 측정값 칸을 비워 둔다.
