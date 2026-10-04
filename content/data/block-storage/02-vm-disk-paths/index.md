---
title: "NVMe 용량을 VM에 나누기 — virtio·vhost·가상 NVMe·직접 할당"
linkTitle: "02 VM 디스크 경로"
description: "NVMe가 꽂힌 서버의 용량을 VM에 내줄 때 virtio-blk, vhost, vfio-user, 직접 할당, DPU 에뮬레이션이 어떤 경로를 타고 어디서 CPU와 시간을 쓰는지, 공개 논문과 벤치마크의 실측 조건과 함께 비교합니다."
weight: 2
date: 2026-10-04
lastmod: 2026-10-04
url: "/storage/02-vm-disk-paths/"
---

# 02 · NVMe 용량을 VM에 나누기 — virtio·vhost·가상 NVMe·직접 할당

NVMe SSD가 여러 장 꽂힌 서버의 용량을 VM에 나눠 줄 때, 가상화 오버헤드는 요청을 누가 처리하느냐에 따라 달라집니다. QEMU나 별도 프로세스가 장치를 구현할 수도 있고, 물리 장치를 게스트에 직접 붙이거나 호스트가 큐를 중개할 수도 있습니다. DPU·SmartNIC처럼 카드가 장치를 구현하는 방식도 있습니다.

공개 측정에서 이 방식들의 성능 차이는 조건에 따라 크게 달랐습니다. 모든 방식을 한 조건에서 잰 자료는 확인하지 못했습니다. 이 글에서는 요청이 지나는 경로를 먼저 살펴보고, 각 측정이 보여 주는 지연과 CPU 비용, 공유·기능 제약을 함께 읽습니다.

[01 iSCSI와 NVMe-oF]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}})는 요청이 네트워크를 건너 타깃의 블록 장치에 닿기까지를 다뤘습니다. 여기서는 호스트가 가진 NVMe 용량을 VM에 내주는 구간에 집중합니다.

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

각 절 끝의 '근거와 측정 조건'에 수치와 조건을 모았습니다.

## 1. 같은 NVMe 용량도 VM에 전달하는 경로는 다르다

{{< flow src="_flow/1-방식별-소프트웨어-경로.json" />}}

| 방식 | 게스트가 보는 장치 | 요청 처리 주체 | 남는 소프트웨어 처리 | 공유·기능 제약 | 직접 비교 실측 |
|---|---|---|---|---|---|
| QEMU virtio-blk(기본) | virtio-blk | QEMU 스레드 하나가 장치의 virtqueue 전부를 처리 | virtqueue 파싱, 이미지 포맷·블록 계층 기능, AIO·io_uring 제출과 완료, 완료 인터럽트 주입 | 호스트 쪽이 단일 스레드라 SMP 확장성 문제가 남음 | 있음 (2절) |
| virtio-blk + IOThread | virtio-blk | 전용 IOThread. adaptive polling 이벤트 루프 | 같은 QEMU 경로를 다른 스레드가 처리 | 호스트 코어를 씀. 장치 여러 개를 한 스레드에 묶거나 CPU에 고정 가능 | 있음 (2절) |
| QEMU nvme:// | virtio-blk | QEMU의 유저스페이스 NVMe 드라이버 | QEMU 블록 계층 | PCI 장치가 게스트 한 대에 전속. live migration과 블록 계층 기능은 남음 | 있음 (2절, 같은 측정의 한 단계) |
| 커널 vhost-scsi | virtio-scsi | vhost 타깃당 커널 스레드 하나, 인터럽트 구동 | 커널의 SCSI 타깃 경로 | 드라이브 하나를 VM 여럿이 나눠 쓴 측정이 있음 | 있음 (3절) |
| SPDK vhost(vhost-user) | virtio-blk 또는 virtio-scsi | 공유 virtqueue를 폴링하는 SPDK 프로세스 | 폴링 전용 코어, hugepage. 완료는 eventfd 인터럽트 | 게스트 메모리를 hugepage로 미리 할당 | 있음 (3절, 5절) |
| vfio-user | 가상 PCI·NVMe 장치(게스트는 NVMe 드라이버) | 유저스페이스 프로세스(libvfio-user, SPDK nvmf 서브시스템) | 미확인 | 커널 구성 요소가 없음. QEMU 10.1에 클라이언트가 들어감 | 미확인 |
| VFIO passthrough | NVMe(물리 장치 그대로) | 장치 자체. 호스트 커널은 데이터 경로에서 빠짐 | 없음. DMA는 IOMMU가 처리 | 장치가 게스트 한 대에 전속. live migration·소프트웨어 기능 제한 | 있음 (5절의 기준선) |
| SSD SR-IOV | NVMe(VF) | SSD 하드웨어가 VF로 분할 | 미확인 | SSD가 지원해야 함. VF 수는 제품마다 다름 | 미확인 |
| mediated passthrough(MDev-NVMe) | 네이티브 NVMe 드라이버 | 호스트가 게스트 큐를 물리 큐에 shadow | 폴링 스레드 3개가 호스트 코어 3개를 100% 사용 | 논문 구현. 업스트림 반영 여부는 미확인 | 있음 (4절, 네이티브 대비 비율. VFIO는 측정 대상이 아님) |
| DPU·SmartNIC 에뮬레이션 | NVMe 또는 virtio-blk | 카드(FPGA, Arm 코어 등) | 카드 구현마다 다름. BM-Store 논문은 호스트 CPU를 쓰지 않는다고 함 | AWS Nitro는 카드의 function을 SR-IOV VF로 나눠 VM에 배정 | BM-Store 한 논문만 있음 (5절). 상용 카드 수치는 미확인 |

같은 NVMe 용량을 내주더라도 게스트가 보는 장치와 요청을 처리하는 주체는 다를 수 있습니다. 예를 들어 virtio-blk 장치를 보여 주면서 QEMU가 요청을 처리할 수도 있고, 별도 SPDK 프로세스가 처리할 수도 있습니다. 표에서 virtio-blk로 보이는 방식도 요청을 QEMU 스레드, IOThread, SPDK 프로세스가 나눠 처리합니다.

그림은 소프트웨어로 장치를 구현하는 경로를 보여 줍니다. 요청을 꺼내는 쪽은 방식마다 다릅니다. virtio-blk는 QEMU 스레드가, 커널 vhost-scsi는 호스트 커널 스레드가, SPDK vhost는 별도 SPDK 프로세스가 virtqueue(게스트와 장치 구현이 요청과 완료를 주고받는 공유 큐)에서 요청을 꺼냅니다. vfio-user는 게스트가 NVMe 드라이버를 쓰고, 유저스페이스 프로세스가 장치 쪽을 구현하는 방식이라고 설명합니다.

소프트웨어를 거의 거치지 않는 경로도 있습니다. passthrough는 물리 장치나 SR-IOV VF(가상 기능)를 게스트에 붙입니다. mediated passthrough는 호스트가 큐를 중개하고, DPU 방식은 카드가 장치를 구현합니다. 이 경로들은 4절의 그림에서 살펴봅니다.

표의 마지막 열은 같은 조건에서 비교한 실측이 이 글의 자료에 있는지를 나타냅니다. 경로 설명만으로 성능 순위를 매기지는 않았습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 그림의 범위 | 네 경로 모두 장치를 소프트웨어로 구현하는 방식 | — | — |
| 소프트웨어 장치별 요청 처리 주체 | virtio-blk는 QEMU 스레드, 커널 vhost-scsi는 호스트 커널 스레드, SPDK vhost는 폴링하는 SPDK 프로세스가 virtqueue 요청을 꺼냄 | — | — |
| 다른 전달 경로 | 소프트웨어를 거의 거치지 않는 경로로 물리 장치·SR-IOV VF를 붙이는 passthrough, 큐를 중개하는 mediated passthrough, 카드가 장치를 구현하는 DPU 방식이 있음. 관련 그림은 4절에 배치 | — | — |
| 비교 표의 범위 | 이 글에서 다루는 방식의 특성을 비교. 마지막 열은 같은 조건의 비교 실측 유무를 표시하며, 경로 설명만으로 성능 순위를 매기지 않음 | — | — |
| 기본 QEMU virtio-blk의 요청 처리와 제약 | 게스트에는 virtio-blk로 보임. QEMU 스레드 하나가 장치의 virtqueue 전부를 처리하므로 호스트 쪽 SMP 확장성 문제가 남음 | — | `✓` |
| 기본 QEMU virtio-blk에 남는 처리 | virtqueue 파싱, 이미지 포맷·블록 계층 기능, AIO·io_uring 제출과 완료, 완료 인터럽트 주입 | — | `✓` |
| virtio-blk + IOThread의 처리와 자원 사용 | 전용 IOThread가 adaptive polling 이벤트 루프를 실행. 호스트 코어를 사용하며, 장치 여러 개를 한 스레드에 묶거나 CPU에 고정 가능 | — | `✓` |
| IOThread가 처리하는 경로 | 게스트에는 virtio-blk로 보이며, 같은 QEMU 경로를 다른 스레드가 처리 | — | — |
| QEMU nvme://의 인터페이스와 처리 주체 | 게스트에는 virtio-blk로 보임. QEMU 유저스페이스 NVMe 드라이버가 처리하며 QEMU 블록 계층이 남음 | — | — |
| QEMU nvme://의 장치 전속과 기능 | PCI 장치는 게스트 한 대에 전속되지만 live migration과 블록 계층 기능은 남음 | — | `✓` |
| 커널 vhost-scsi의 처리 방식 | 게스트에는 virtio-scsi로 보임. vhost 타깃당 커널 스레드 하나가 인터럽트 구동으로 처리 | — | `✓` |
| 커널 vhost-scsi에 남는 경로 | 커널의 SCSI 타깃 경로 | — | — |
| 커널 vhost-scsi의 장치 공유 실측 | 드라이브 하나를 VM 여럿이 나눠 쓴 측정이 있음 | — | `Ⓑ` |
| SPDK vhost(vhost-user)의 처리 방식 | 게스트에는 virtio-blk 또는 virtio-scsi로 보임. SPDK 프로세스가 공유 virtqueue를 폴링 | — | `✓` |
| SPDK vhost의 자원과 완료 통지 | 폴링 전용 코어와 hugepage 사용. 게스트 메모리를 hugepage로 미리 할당하며 완료는 eventfd 인터럽트로 통지 | — | `✓` |
| vfio-user의 장치 구현 | 게스트가 NVMe 드라이버로 가상 PCI·NVMe 장치를 사용. libvfio-user와 SPDK nvmf 서브시스템 등 유저스페이스 프로세스가 구현 | — | `Ⓥ` |
| vfio-user의 구성과 버전 | 커널 구성 요소가 없으며 QEMU 10.1에 클라이언트가 들어감 | — | `Ⓥ` |
| vfio-user의 미확인 항목 | 남는 소프트웨어 처리와 직접 비교 실측 | — | `?` |
| VFIO passthrough의 데이터 경로 | 물리 NVMe 장치 자체가 처리. 호스트 커널은 데이터 경로에서 빠지고 남는 소프트웨어 처리는 없음. DMA는 IOMMU가 처리 | — | `✓` |
| VFIO passthrough의 제약 | 장치가 게스트 한 대에 전속. live migration·소프트웨어 기능 제한 | — | `✓` |
| SSD SR-IOV의 인터페이스 | SSD 하드웨어가 VF로 분할하며 게스트에는 NVMe(VF)로 보임 | — | — |
| SSD SR-IOV의 지원 조건 | SSD가 지원해야 하며 VF 수는 제품마다 다름 | — | `Ⓥ` |
| SSD SR-IOV의 미확인 항목 | 남는 소프트웨어 처리와 직접 비교 실측 | — | `?` |
| mediated passthrough(MDev-NVMe)의 처리와 비용 | 게스트는 네이티브 NVMe 드라이버 사용. 호스트가 게스트 큐를 물리 큐에 shadow하며 폴링 스레드 3개가 호스트 코어 3개를 100% 사용 | MDev-NVMe | `Ⓑ` |
| MDev-NVMe의 구현 상태 | 논문 구현이며 업스트림 반영 여부는 미확인 | MDev-NVMe | `?` |
| DPU·SmartNIC의 인터페이스와 처리 주체 | 게스트에는 NVMe 또는 virtio-blk로 보이며 카드의 FPGA, Arm 코어 등이 처리 | — | — |
| DPU·SmartNIC의 호스트 CPU 비용 | 카드 구현마다 다름. BM-Store 논문은 호스트 CPU를 쓰지 않는다고 설명 | BM-Store | `Ⓑ` |
| AWS Nitro의 VM 할당 | 카드의 function을 SR-IOV VF로 나눠 VM에 배정 | The Security Design of the AWS Nitro System | `✓` |
| 직접 비교 실측이 있는 위치 | 기본 virtio-blk·IOThread·nvme://는 2절이며 nvme://는 같은 측정의 한 단계. 커널 vhost-scsi는 3절, SPDK vhost는 3절·5절, VFIO는 5절 기준선. MDev-NVMe는 4절의 네이티브 대비 비율이며 해당 측정에 VFIO는 없음. DPU·SmartNIC은 5절 BM-Store 한 논문만 있음 | — | — |
| 상용 카드의 성능 수치 | 이 글의 자료에서는 미확인 | — | `?` |

{{% /details %}}

## 2. virtio-blk: 게스트 큐와 호스트 처리 스레드

{{< lane src="_lane/2-virtio-blk-qd1.json" />}}

virtio-blk에서 게스트가 큐를 늘려도 호스트의 처리 스레드가 따라 늘지는 않습니다. 게스트가 요청을 여러 큐로 제출해도 호스트에서 스레드 하나가 모두 처리하면 그 스레드의 확장성 문제가 남습니다.

QEMU의 기본 경로에서는 스레드 하나가 장치 하나를 에뮬레이트합니다. 이 스레드는 요청을 읽고 이미지 포맷과 블록 계층 기능을 처리한 뒤, 호스트에 I/O를 제출합니다. 완료를 받아 응답을 쓰고 게스트에 인터럽트를 넣는 일도 같은 스레드가 맡습니다.

multi-queue는 게스트 쪽 제출 경합을 없애고, 완료 인터럽트를 요청을 제출한 vCPU로 보냅니다. 호스트의 작업을 전용 스레드로 옮기는 것이 IOThread입니다. IOThread는 adaptive polling 이벤트 루프를 사용하며, 여러 장치를 묶어 처리하거나 특정 CPU에 고정할 수 있습니다.

eventfd로 통지하면 커널 스케줄러가 스레드를 깨웁니다. 폴링은 상태를 반복해서 확인하므로 기다리는 동안에도 CPU를 사용합니다.

Hajnoczi의 KVM Forum 2020 발표에서 QD1 4KB 읽기 IOPS(초당 I/O 처리 건수)를 베어메탈과 견주면, 기본 virtio-blk는 약 28%, IOThread를 붙이면 약 59%입니다. 그림은 같은 측정에서 구성을 차례로 바꾼 결과입니다. IOThread 뒤에 multi-queue를 추가한 효과는 거의 없었습니다. 이 글의 해석으로는, 한 번에 요청 하나만 보내는 조건에서는 큐를 늘려도 병렬로 처리할 요청이 늘지 않기 때문입니다.

QEMU의 nvme://를 쓰면 유저스페이스 NVMe 드라이버가 요청을 처리합니다. PCI 장치는 게스트 한 대가 전속으로 사용하지만 게스트에는 virtio-blk로 보입니다. 그 결과 live migration(실행 중인 VM을 다른 호스트로 옮기는 기능)과 이미지 포맷·throttling 같은 블록 계층 기능이 남습니다.

IOThread를 여러 개 쓰면 virtqueue를 병렬로 처리할 수 있습니다. Hajnoczi와 Red Hat의 후속 측정에서도 IOThread를 늘렸을 때 처리량이 높아졌습니다. 앞의 그림과는 큐 구성이 달라 별도 결과로 봐야 합니다.

발표 자료는 IOThread가 너무 적으면 드라이브를 충분히 활용하지 못하고, 너무 많으면 애플리케이션이 사용할 CPU를 차지한다고 설명합니다. 큰 블록을 처리할 때는 IOThread 하나로도 디스크가 포화될 수 있다는 설명도 있습니다. 실제 측정에서는 CPU와 디스크 대역에 여유가 있어야 효과가 났고, 부하가 포화에 가깝거나 VM 밀도가 높으면 이득이 줄었습니다. 추가 측정값과 DB 워크로드 결과는 부록에 모았습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 그림의 측정과 읽는 법 | KVM Forum 2020 발표의 QD1 측정. 같은 측정에서 구성을 하나씩 바꿨으므로 막대를 이어 비교 가능 | Hajnoczi, KVM Forum 2020 | — |
| 기본 virtio-blk와 IOThread의 베어메탈 대비 성능 | QD1 4KB 읽기에서 기본 virtio-blk는 베어메탈 IOPS의 28%, IOThread를 붙이면 59% | KVM Forum 2020 | `Ⓑ` `≈` |
| 기본 virtio-blk의 호스트 처리 | 스레드 하나가 장치 하나를 에뮬레이트하고 해당 장치의 virtqueue 전부를 처리 | — | `✓` |
| 기본 스레드가 맡는 작업 | virtqueue 요청 파싱, qcow2 같은 이미지 포맷과 블록 계층 기능, Linux AIO나 io_uring 제출·완료, 응답 작성, 게스트 완료 인터럽트 주입 | — | `✓` |
| multi-queue의 효과와 한계 | vCPU마다 virtqueue를 두어 게스트 제출 경합을 없애고 완료 인터럽트를 요청을 제출한 vCPU로 보냄. 기본으로 켜져 있어도 호스트 처리는 단일 스레드이므로 SMP 확장성 문제가 남음 | — | `✓` |
| IOThread의 역할 | 처리를 전용 스레드로 옮김. adaptive polling 이벤트 루프 사용. 장치 여러 개를 한 IOThread에 묶거나 CPU에 고정 가능 | — | `✓` |
| 통지 수단별 CPU 동작 | eventfd 또는 폴링 사용. eventfd는 커널 스케줄러가 스레드를 깨우며, 폴링은 busy wait로 CPU 사용 | — | `✓` |
| IOThread와 multi-queue 단계의 IOPS | IOThread를 붙이면 21,831에서 46,424 IOPS로 증가. multi-queue를 더하면 46,876 IOPS로 거의 같음 | Hajnoczi, KVM Forum 2020 | — |
| QD1에서 multi-queue 효과가 작은 이유에 관한 해석 | QD1에서는 요청 하나만 진행되므로 큐를 늘려도 달라질 것이 없다는 해석 | — | `Σ` |
| IOPS를 요청당 시간으로 환산 | 1/IOPS로 환산하면 베어메탈 12.7µs, 기본 virtio-blk 45.8µs, IOThread 21.5µs, nvme:// 18.1µs | Hajnoczi, KVM Forum 2020 | `≈` |
| 단계별로 줄어드는 시간 | 기본 경로가 더하는 33µs에서 IOThread가 24µs를 줄이고, 남은 9µs에서 nvme://가 3µs를 더 줄임 | — | — |
| nvme://의 구현과 기능 | QEMU 유저스페이스 NVMe 드라이버이며 QEMU 2.12에 도입. PCI 장치는 게스트 한 대에 전속되지만 게스트에는 virtio-blk로 보여 live migration과 이미지 포맷·throttling 같은 블록 계층 기능이 남음 | — | `✓` |
| 여러 IOThread의 동작 | virtqueue를 병렬로 처리 | — | — |
| IOThread 수를 늘린 측정 | 2024년 측정에서 IOThread 4개의 IOPS는 1개의 약 2배. 슬라이드 표현은 "4 IOThreads doubles performance" | Hajnoczi, KVM Forum 2024 (IOThread 수별 측정) | `Ⓑ` `≈` |
| 측정 간 비교 범위 | 2024년 측정은 앞의 QD1 측정과 큐 구성이 달라 숫자를 이어 비교하지 않음 | — | — |
| IOThread 수와 블록 크기에 관한 설명 | 권장 수는 4~8개. 너무 적으면 드라이브를 채우지 못하고 너무 많으면 애플리케이션 CPU를 차지함. 64KB 이상 블록이면 IOThread 하나로도 디스크가 포화될 수 있다고 설명 | — | `Ⓥ` |
| IOThread 이득이 줄어드는 조건 | CPU와 디스크 대역에 여유가 있어야 이득이 남. 부하가 포화에 가깝거나 VM 밀도가 높으면 이득이 줄었음 | — | `Ⓑ` |
| 추가 자료 위치 | IOThread 수별 측정값과 DB 워크로드 결과는 부록에 수록 | — | — |

{{% /details %}}

## 3. vhost와 vfio-user: 소프트웨어 장치 구현의 위치

{{< lane src="_lane/3-vhost-scsi-읽기-지연.json" />}}

vhost는 요청을 처리하는 데이터 경로를 QEMU 밖으로 옮깁니다. 커널 vhost-scsi에서는 호스트 커널 스레드가 인터럽트를 받아 처리합니다. SPDK vhost에서는 별도 프로세스가 공유 큐를 폴링합니다. 장치 구현을 QEMU 밖으로 옮겨도 인터럽트로 깨우는지 폴링하는지에 따라 CPU 쓰는 방식은 달라집니다.

SPDK vhost를 설정할 때 QEMU는 UNIX 소켓으로 타깃을 설정하고, 게스트 메모리를 hugepage(일반 페이지보다 큰 메모리 페이지)로 미리 할당합니다. 설정이 끝나면 게스트가 공유 메모리의 virtqueue에 I/O를 직접 제출합니다. 이 제출 과정에는 QEMU가 관여하지 않습니다.

SPDK는 큐를 계속 확인하므로 제출 통지가 필요 없습니다. 완료는 eventfd 인터럽트로 알리기 때문에 시스템 콜과 게스트 VM exit(게스트 실행에서 하이퍼바이저로 제어가 넘어가는 동작) 비용이 남습니다. 게스트까지 poll-mode virtio 드라이버를 쓰면 완료 인터럽트도 없어지고, 데이터 경로가 QEMU와 KVM을 완전히 우회합니다.

이 차이가 지연에 얼마나 나타날까요? SPDK 24.05 vhost 보고서의 읽기 QD1 측정에서는 커널 vhost-scsi와 SPDK vhost의 평균 지연 차이는 약 10µs입니다(이 글의 계산). 쓰기, 큐 깊이를 늘린 시험, VM 밀도 시험에서는 차이가 더 벌어졌습니다. 세부 값은 부록에 있으며, 전송 구간의 비용과는 합산하지 않습니다.

SPDK vhost에는 hugepage와 폴링 전용 코어가 필요합니다. BM-Store 논문도 여러 SSD의 순차 읽기 처리량을 확보하는 데 vhost 코어를 여러 개 사용했다고 보고합니다. vhost-user-blk는 SPDK용으로 만들어졌으며, QEMU의 qemu-storage-daemon도 이 인터페이스로 NVMe 한 장을 여러 게스트에 나눠 줄 수 있습니다.

vfio-user는 게스트에 보여 주는 인터페이스를 바꿉니다. vhost-user가 virtio 장치를 제공하는 데 비해, vfio-user는 유저스페이스에서 PCI 장치를 구현해 게스트가 가상 NVMe 컨트롤러를 사용하게 합니다. libvfio-user 메인테이너의 설명에 따르면 커널 구성 요소가 없고, SPDK nvmf 서브시스템과 libvfio-user를 묶어 구성할 수 있습니다. vhost나 passthrough와 비교한 vfio-user의 성능 실측은 확인하지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 그림의 비교 대상 | 커널 vhost-scsi와 SPDK vhost를 같은 조건에서 측정 | SPDK 24.05 vhost 보고서 | — |
| 읽기 지연 차이 | 읽기 QD1에서 약 10µs, 1.12배 차이 | SPDK 24.05 vhost 보고서 | `≈` |
| 추가 측정과 비교 범위 | 쓰기 QD1, QD64, VM 밀도 시험에서 차이가 더 벌어짐. 해당 값은 부록에 수록하며 전송 구간 비용과 합치지 않음 | SPDK 24.05 vhost 보고서 | — |
| vhost와 커널 vhost-scsi의 처리 | vhost는 데이터 경로를 QEMU 밖으로 옮김. 커널 vhost-scsi는 인터럽트 구동이며 vhost 타깃당 커널 스레드 하나 사용 | — | `✓` |
| SPDK vhost(vhost-user)의 설정과 제출 | QEMU가 UNIX 소켓으로 타깃을 설정하고 게스트 메모리를 hugepage로 미리 할당. 게스트가 공유 메모리의 virtqueue에 I/O를 직접 제출하며 QEMU는 이 과정에 관여하지 않음 | — | — |
| SPDK vhost의 제출·완료 통지 | poll-mode라 제출 통지가 필요 없음. 완료는 eventfd 인터럽트로 알려 시스템 콜과 게스트 VM exit 비용이 듦 | — | `✓` |
| 게스트도 폴링할 때의 경로 | 게스트가 poll-mode virtio 드라이버를 쓰면 완료 인터럽트도 없어져 QEMU와 KVM을 완전히 우회 | — | `✓` |
| vhost-user-blk의 용도와 장치 공유 | SPDK용으로 만들어짐. QEMU 5.2의 qemu-storage-daemon도 vhost-user-blk export로 NVMe 한 장을 게스트 여럿에 나눠 줄 수 있음 | — | `✓` |
| SPDK vhost의 자원 요구 | hugepage와 폴링 전용 코어 필요 | MDev-NVMe (USENIX ATC 2018) | `Ⓑ` |
| SPDK vhost의 코어 소모 실측 | Intel P4510 4장, 128K 순차 읽기 QD256에서 네이티브의 80%를 내는 데 SPDK vhost 코어가 8개 이상 필요 | BM-Store, HPCA 2023 | `Ⓑ` |
| vhost-user와 vfio-user의 인터페이스 | vhost-user는 게스트에 virtio 장치를 제공. vfio-user는 PCI 장치를 유저스페이스에서 구현해 게스트가 가상 NVMe 컨트롤러를 사용 | — | — |
| vfio-user의 구성과 버전 주의점 | 커널 구성 요소 없음. QEMU 10.1에 클라이언트가 들어갔으나 직전 회귀 때문에 10.1보다 조금 뒤 버전이 필요하다고 설명. SPDK nvmf 서브시스템과 libvfio-user를 묶는 구성 소개 | libvfio-user 메인테이너의 글 | `Ⓥ` |
| vfio-user의 비교 실측 | vhost 및 passthrough에 견준 성능 실측은 확인하지 못함 | — | `?` |

{{% /details %}}

## 4. passthrough·SR-IOV·mediated passthrough

{{< flow src="_flow/4-직접-할당-큐-중개-카드.json" />}}

| 방식 | 게스트에 붙는 것 | 공유 단위 | 하드웨어 지원 | 호스트 쪽 비용 | 제약 |
|---|---|---|---|---|---|
| VFIO passthrough | 물리 PCI 장치 | 없음. 장치가 게스트 한 대에 전속 | IOMMU | 데이터 경로에서 빠짐 | live migration·소프트웨어 기능 제한 |
| SSD SR-IOV | 장치가 내는 VF | VF 하나당 VM 하나 | SSD가 SR-IOV 지원 | 미확인 | VF 수·지원 SSD가 제품마다 다름 |
| mediated passthrough | 큐(게스트는 네이티브 NVMe 드라이버) | 게스트 큐를 호스트가 물리 큐에 shadow. 폴링 스레드는 VM 간 공유 가능 | 미확인 | 폴링 스레드가 코어 3개를 100% 사용 | 논문 구현 |

직접 할당과 큐 중개는 장치를 나누는 단위가 다릅니다. VFIO passthrough는 물리 장치를 게스트 한 대에 전속으로 붙입니다. SSD SR-IOV는 장치가 제공하는 VF를 VM마다 배정합니다. mediated passthrough에서는 게스트가 네이티브 NVMe 드라이버를 쓰면서 호스트가 게스트 큐를 물리 큐에 중개합니다.

그림의 앞쪽 경로들은 호스트에 꽂힌 PCIe NVMe 장치를 전제로 합니다. 맨 아래에는 다음 절에서 다룰 카드 방식을 함께 놓았습니다. 카드 방식의 백엔드는 네트워크 너머에 있을 수 있습니다.

VFIO passthrough에서는 게스트가 장치의 BAR를 메모리 매핑으로 사용하고, 인터럽트가 실행 중인 게스트에 직접 들어갑니다. DMA(장치가 메모리에 직접 데이터를 전송하는 동작)는 IOMMU를 거쳐 게스트 RAM에 도달합니다. 호스트 커널은 이 데이터 경로에서 빠집니다.

발표 슬라이드는 VFIO가 베어메탈과 경쟁할 성능을 낸다고 설명합니다. 같은 발표의 QD1 4K 읽기 막대를 눈대중으로 읽으면, iopoll과 haltpoll을 쓰지 않은 VFIO는 베어메탈의 약 75%였고 haltpoll을 켜면 베어메탈보다 높았습니다. 슬라이드의 표현과 특정 구성의 측정 결과는 구분해서 볼 필요가 있습니다.

QEMU의 VFIO 마이그레이션은 장치가 명시적으로 지원을 선언해야 하며, VFIO 장치를 여러 개 붙이면 모두 P2P migration을 지원해야 합니다. NVM Express 개정 이력에는 관련 기능이 NVMe 표준의 선택 기능으로 들어가 있습니다. 이 글이 확인한 리눅스 mainline에는 드라이버가 없었고, RFC도 커널 반영 방식에 합의가 없다고 적습니다. 이를 구현한 SSD 모델은 확인하지 못했습니다.

SR-IOV로 나눌 수 있는 VF 수는 SSD 제품에 따라 다릅니다. 제조사 발표와 제품 가이드는 일부 Samsung SSD(PM1733·PM1735·PM1743)를 최대 64개로 나눌 수 있다고 적습니다. 실물에서 더 적게 보였다는 사용자 보고도 있지만, 듀얼 포트 구성이나 펌웨어 차이 때문인지는 확인하지 못했습니다. SR-IOV 지원 표기만으로 성능이나 live migration 지원까지 알 수는 없으며, SSD의 VF를 게스트에 붙여 잰 성능도 이 글의 자료에는 없습니다.

MDev-NVMe 논문은 호스트가 게스트 큐를 물리 큐에 shadow하는 구현을 제시합니다. doorbell MMIO trap과 인터럽트를 폴링으로 바꾸지만, 그 폴링에는 호스트 코어 3개를 사용합니다. 스레드는 VM 사이에서 공유할 수 있습니다. 논문에서 높은 큐 깊이의 처리량이 네이티브를 넘은 것은 네이티브가 인터럽트로 동작하고 MDev는 호스트 코어를 폴링에 쓰는 조건에서 나온 결과입니다. 이 측정에는 VFIO passthrough가 포함되지 않았습니다.

큐를 직접 넘기는 소프트웨어 방식인 LightIOV도 있습니다. 논문 초록은 VFIO에 가까운 IOPS와 SPDK vhost보다 낮은 지연을 보고합니다. 초록만 확인했으므로 측정 조건은 알지 못합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 핵심 표의 VFIO passthrough 비교 | 물리 PCI 장치를 게스트 한 대가 전속 사용. 공유 단위 없음. IOMMU 필요. 호스트는 데이터 경로에서 빠지며 live migration·소프트웨어 기능 제한 | — | — |
| 핵심 표의 SSD SR-IOV 비교 | SSD가 제공하는 VF를 VM마다 하나씩 할당. SSD의 SR-IOV 지원 필요. VF 수와 지원 SSD는 제품마다 다름 | — | — |
| 핵심 표의 SSD SR-IOV 미확인 항목 | 호스트 쪽 비용 | — | `?` |
| 핵심 표의 mediated passthrough 비교 | 게스트는 네이티브 NVMe 드라이버 사용. 호스트가 게스트 큐를 물리 큐에 shadow하며 폴링 스레드는 VM 간 공유 가능. 코어 3개를 100% 사용하는 논문 구현 | — | — |
| 핵심 표의 mediated passthrough 미확인 항목 | 하드웨어 지원 | — | `?` |
| VFIO passthrough의 동작 | 장치 BAR를 게스트에 memory-map. posted interrupts로 실행 중인 게스트에 IRQ 직접 주입. DMA는 IOMMU를 거쳐 게스트 RAM에 도달하며 호스트 커널은 데이터 경로에서 빠짐 | — | `✓` |
| VFIO 장단점의 영문 표현 | "Competes with bare metal performance", "Limited live migration & software features", "Guests may be tied to physical hardware", "PCI device is dedicated to 1 guest" | KVM Forum 2020 슬라이드 | `✓` |
| 슬라이드 표현의 성격 | 위 문구는 정성 서술 | KVM Forum 2020 슬라이드 | `✓` |
| VFIO 막대에서 읽은 성능 | 같은 발표의 QD1 4K 읽기에서 iopoll과 haltpoll이 없으면 베어메탈의 약 75%. haltpoll을 켜면 베어메탈보다 높음. 세부 값은 부록 | KVM Forum 2020 슬라이드 | `≈` |
| QEMU VFIO 마이그레이션 조건 | 장치가 `VFIO_DEVICE_FEATURE_MIGRATION`으로 opt-in해야 함. VFIO 장치가 여럿이면 전부 P2P migration을 지원해야 허용 | QEMU VFIO 마이그레이션 문서 | `✓` |
| NVMe 표준의 마이그레이션 기능 | TP4159가 NVMe Base Specification 2.1에 선택 기능으로 편입 | NVM Express 개정 이력 문서 | `✓` |
| 리눅스 구현 상태 | 2022년 VFIO 드라이버 RFC, 2025·2026년 Controller Data Queue RFC가 올라옴. 2026-10-04 기준 mainline 7.3-rc5에는 드라이버 없음. 2026-04 RFC는 커널 반영 방식에 합의가 없다고 명시 | VFIO 드라이버 RFC, Controller Data Queue RFC, mainline 소스 | `✓` |
| TP4159를 구현한 SSD | 모델을 확인하지 못함 | — | `?` |
| SSD SR-IOV의 공유 방식 | 지원 SSD 하나를 VF 여러 개로 나눠 VM마다 하나씩 할당 가능 | — | — |
| 문서에서 확인한 SSD의 VF 수 | Samsung PM1733·PM1735 제조사 발표와 PM1743 Lenovo 제품 가이드의 "최대 64"만 확인 | Samsung 제조사 발표, Lenovo 제품 가이드 | `Ⓥ` |
| 실물 VF 수 보고와 미확인 원인 | PM1733·PM1735 실물에서 32개로 보인다는 사용자 보고. 듀얼 포트 구성 또는 펌웨어 차이 때문인지는 미확인 | 사용자 보고 | `Ⓑ` `?` |
| KIOXIA CM7의 지원과 문서 범위 | 발표문에 SR-IOV 지원 표기만 있음. VF 수를 밝힌 문서는 찾지 못함 | KIOXIA CM7 발표문 | `Ⓥ` |
| Micron·Solidigm의 SR-IOV 근거 | 근거 없음 | — | `?` |
| SR-IOV 지원 표기의 해석 범위 | 지원 표기만으로 성능이나 live migration 지원까지 판단하지 않음 | — | — |
| SSD VF의 성능 실측 | SSD의 VF를 게스트에 붙여 잰 성능은 이 글의 자료에 없음 | — | `?` |
| MDev-NVMe의 구현과 동작 | USENIX ATC 2018 논문 구현. 커널 4.10부터의 mediated device 프레임워크 사용. 게스트는 네이티브 NVMe 드라이버 사용. 호스트가 게스트 큐를 물리 큐에 shadow하고 doorbell MMIO trap(vm-exit)과 인터럽트를 폴링으로 대체 | MDev-NVMe, USENIX ATC 2018 | `Ⓑ` |
| MDev-NVMe의 호스트 CPU 비용 | 폴링 스레드 3개가 호스트 코어 3개를 100% 사용. VM 간 공유 가능 | MDev-NVMe | `Ⓑ` |
| MDev-NVMe 비교 대상과 측정 조건 | 네이티브, SPDK vhost, virtio도 함께 측정. Optane P4800X, 호스트·게스트 커널 4.10, VM당 vCPU 4개 | MDev-NVMe | — |
| MDev-NVMe에서 밝히지 않은 조건 | QEMU·SPDK 버전과 virtio의 IOThread 사용 여부는 논문에 없음 | MDev-NVMe | `?` |
| 아래 표에서 네이티브를 넘는 처리량의 조건 | QD32 값이 100%를 넘는 결과는 네이티브가 인터럽트 구동이고 MDev가 호스트 코어 3개를 폴링에 쓰는 조건에서 나옴 | MDev-NVMe | `Ⓑ` |
| MDev-NVMe의 비교 범위 | 측정 대상에 VFIO passthrough는 없음 | MDev-NVMe | `✓` |
| LightIOV 초록의 성능 | 큐를 직접 넘기는 소프트웨어 방식. IOPS는 VFIO의 97.6~100.2%, VM 200개에서 SPDK vhost보다 지연이 31.4% 낮다고 보고 | LightIOV 초록 | `Ⓑ` |
| LightIOV 확인 범위 | 초록만 확인했으며 측정 조건은 알지 못함 | LightIOV 초록 | `?` |
| 그림의 범위 | 이 절의 세 방식과 다음 절의 카드 방식을 비교. 앞의 셋은 호스트에 꽂힌 PCIe NVMe 장치를 전제로 하며, 맨 아래 카드 경로의 백엔드는 네트워크 너머에 있을 수 있음 | — | — |

MDev-NVMe 논문의 비교 값입니다.

| 4K 랜덤 읽기 | QD1 IOPS(네이티브 대비) | QD1 평균 지연(네이티브=1.00) | QD32·job 4 IOPS(네이티브 대비) |
|---|---|---|---|
| MDev-NVMe | 66% | 1.51 | 142% |
| SPDK vhost-blk | 59% | 1.70 | 136% |
| SPDK vhost-scsi | 54% | 1.86 | 109% |
| virtio | 29% | 3.58 | 45% |

{{% /details %}}

## 5. DPU·SmartNIC가 NVMe 장치로 보이게 하는 경우

{{< lane src="_lane/5-vm-안-전달-방식-지연.json" />}}

DPU·SmartNIC 방식에서는 카드가 게스트에 NVMe나 virtio-blk 장치를 제공합니다. 게스트가 NVMe 드라이버를 쓴다고 카드 뒤의 백엔드 전송까지 알 수는 없습니다. 게스트에 보이는 인터페이스와 카드 뒤에서 저장장치까지 잇는 전송은 따로 봐야 합니다.

그림의 BM-Store는 Zhejiang University와 Alibaba가 구현한 시스템입니다. 논문에 따르면 FPGA 기반 BMS-Engine이 I/O 경로를, ARM 기반 BMS-Controller가 관리를 맡습니다. 테넌트는 표준 NVMe 드라이버만 사용합니다. 백엔드 SSD의 namespace(논리 저장 공간)를 프런트엔드 VF에 연결하며, 호스트 CPU를 쓰지 않는다고 보고합니다.

BM-Store 논문은 같은 장비의 VM 안에서 VFIO, SPDK vhost, FPGA 에뮬레이션을 비교했습니다. QD1 측정에서 VFIO에 더해지는 시간을 계산하면 읽기는 약 3~4µs, 쓰기는 약 4~5µs입니다. 추가 시간은 비슷하지만 쓰기 자체가 더 짧아 쓰기에서 증가율이 더 큰 것으로 해석했습니다. 이 글에서는 장치 자체의 지연이 짧을수록 같은 추가 시간이 차지하는 비중이 커지는 사례로 읽었습니다. Hajnoczi의 발표도 같은 오버헤드가 디스크 지연에 따라 다른 비율을 차지한다고 설명합니다.

BM-Store 논문에서 SPDK vhost는 VFIO의 63.0~96.0% 성능을 냈고, 최저치는 128K 순차 읽기 QD256에서 나왔으며 성능 저하는 CentOS 7 커널 3.10 게스트에서 특히 심했습니다. 이 측정이 보여 주는 범위는 해당 구현과 조건까지입니다. 상용 카드의 성능은 각 제품의 자료를 따로 봐야 합니다.

AWS 문서에 따르면 EBS 볼륨은 Nitro 기반 인스턴스에서 NVMe 블록 장치로 보입니다. Nitro Card는 PCIe로 호스트에 연결되어 NVMe 인터페이스를 제공하고, Nitro Hypervisor 구성에서는 카드의 PCIe function을 SR-IOV VF로 나눠 VM에 직접 배정합니다. EBS 암호화는 카드의 오프로드 엔진이 처리합니다.

게스트에 `/dev/nvme1n1`이 보이면 카드 뒤에서도 NVMe-oF를 쓸까요? AWS 문서에서 전송 계층을 밝힌 대목은 io2 Block Express가 SRD를 쓴다는 설명뿐입니다. 카드 내부 데이터 경로와 가상화 오버헤드 수치는 공개되어 있지 않습니다. 성능에 실질적인 영향이 없다는 설명은 AWS의 주장 수준으로 남아 있습니다.

NVIDIA SNAP 문서는 BlueField-3의 Arm 코어에서 실행하는 서비스가 네트워크 스토리지를 PCIe 버스의 로컬 드라이브처럼 에뮬레이트한다고 설명합니다. 호스트가 보낸 요청은 SNAP 스토리지 컨트롤러를 거쳐 SPDK 블록 장치로 전달됩니다. NVMe와 virtio-blk를 모두 제공하며, 백엔드는 NVMe-oF·iSCSI 등을 RDMA나 TCP로 연결합니다. 공개 문서에서 성능 수치는 확인하지 못했습니다.

LeapIO 논문은 스토리지 서비스를 ARM SoC 코프로세서로 옮기고 수정 없는 게스트에 가상 NVMe를 제공합니다. 논문 초록은 데이터센터 x86 코어의 10~20%를 클라우드 스토리지 스택이 쓴다는 점을 개발 동기로 듭니다. 논문은 passthrough 대비 처리량 저하와 지연 증가를 보고하며, 실제 ARM SoC에서는 x86 에뮬레이션보다 더 느렸다고 적습니다. 논문이 제시한 이유는 SoC에서 호스트로 가는 RDMA의 추가 시간과 낮은 ARM 코어 클럭입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 그림의 비교 범위 | 같은 장비의 VM 안에서 VFIO, SPDK vhost, FPGA 에뮬레이션 측정 | BM-Store | — |
| BM-Store의 구현과 역할 분담 | Zhejiang University와 Alibaba의 구현. FPGA 기반 BMS-Engine이 I/O 경로를, ARM 기반 BMS-Controller가 관리를 담당. 테넌트는 표준 NVMe 드라이버만 사용 | BM-Store | `Ⓑ` |
| BM-Store의 CPU 사용과 장치 연결 | 호스트 CPU를 쓰지 않으며 백엔드 SSD의 namespace를 프런트엔드 VF에 연결 | BM-Store | `Ⓑ` |
| VM 안 읽기 평균 지연과 VFIO 대비 차이 | QD1 4K 읽기에서 VFIO 79.7µs, SPDK vhost 82.7µs, FPGA 에뮬레이션 83.7µs. VFIO와의 차이는 3.0~4.0µs | BM-Store | `Ⓑ` `≈` |
| VM 안 쓰기 평균 지연 | 랜덤 쓰기 QD1에서 VFIO 14.9µs, BM-Store 19.6µs, SPDK vhost 19.2µs | BM-Store | `Ⓑ` |
| VFIO 대비 추가 시간과 비율 | QD1에서 에뮬레이션과 vhost가 더하는 시간은 읽기 3~4µs(약 4~5%), 쓰기 4~5µs(약 30%) | BM-Store | `≈` |
| 읽기와 쓰기의 증가율이 다른 이유에 관한 해석 | 추가 시간은 비슷하지만 쓰기 자체가 짧아 비율이 커짐 | — | `Σ` |
| 같은 소프트웨어 오버헤드의 상대 비중 | 100µs짜리 디스크에서는 5%, 15µs짜리 디스크에서는 33%가 된다는 도식 | Hajnoczi, KVM Forum 2020 | `Ⓥ` |
| SPDK vhost의 VFIO 대비 성능 범위 | VFIO의 63.0~96.0%. 최저치는 128K 순차 읽기 QD256이며 CentOS 7 커널 3.10 게스트에서 성능 저하가 심했음 | BM-Store | `Ⓑ` |
| 측정값의 적용 범위 | BM-Store 값을 상용 카드 성능으로 옮겨 적용하지 않음. 게스트가 보는 NVMe 인터페이스와 카드 뒤 백엔드 전송을 구분 | — | — |
| EBS의 게스트 인터페이스 | Nitro 기반 인스턴스에서 EBS 볼륨을 NVMe 블록 장치로 노출 | Amazon EBS volumes and NVMe | `✓` |
| Nitro Card의 연결과 인터페이스 | PCIe로 호스트에 연결. "NVMe for block storage (EBS and instance store)" 인터페이스 제공 | The Security Design of the AWS Nitro System | `✓` |
| Nitro의 VM 할당과 암호화 | Nitro Hypervisor 구성에서 카드의 PCIe function을 SR-IOV VF로 나눠 VM에 직접 배정. EBS 암호화는 카드의 오프로드 엔진이 담당 | The Security Design of the AWS Nitro System | `✓` |
| NVMe 장치명과 백엔드 전송의 관계 | 게스트에서 `/dev/nvme1n1`로 보인다고 카드 뒤 구간이 NVMe-oF라는 뜻은 아님 | — | — |
| AWS 문서가 밝힌 전송 계층 | io2 Block Express가 SRD를 쓴다는 대목만 확인 | Amazon EBS Provisioned IOPS SSD volumes | `✓` |
| Nitro의 공개 정보 한계와 성능 주장 | 카드 내부 데이터 경로와 가상화 오버헤드 수치는 공개되지 않음. "성능에 실질적인 영향이 없다" 수준의 서술만 있음 | The Security Design of the AWS Nitro System | `Ⓥ` |
| NVIDIA SNAP의 실행 위치와 경로 | BlueField-3의 Arm 코어에서 실행. 네트워크 스토리지를 PCIe 버스의 로컬 드라이브처럼 에뮬레이트. 호스트 트래픽은 SNAP 서비스의 스토리지 컨트롤러로 가며 백엔드는 SPDK 블록 장치 | NVIDIA SNAP 문서 | `✓` |
| NVIDIA SNAP의 장치·전송 지원과 VF 수 | NVMe와 virtio-blk 에뮬레이션. 백엔드 프로토콜로 NVMe-oF·iSCSI 등을 RDMA나 TCP로 연결. VF는 NVMe 최대 512개, virtio-blk 최대 2,000개 | NVIDIA SNAP 문서 | `✓` |
| NVIDIA SNAP의 성능 수치 | 문서에 없음 | NVIDIA SNAP 문서 | `?` |
| LeapIO의 구현과 개발 동기 | ARM SoC 코프로세서로 스토리지 서비스를 옮기며 수정 없는 게스트에 가상 NVMe 제공. 데이터센터 x86 코어의 10~20%를 클라우드 스토리지 스택이 사용한다는 점이 개발 동기 | LeapIO, ASPLOS 2020 | `Ⓑ` |
| LeapIO의 passthrough 대비 처리량·지연 | Intel P4600, 게스트 8코어. 처리량 저하는 읽기 전용 2%, 읽기·쓰기 50/50에서 5%. p99 아래 지연은 평균 3%, p99.9는 6~12% 높음 | LeapIO | `Ⓑ` |
| 실제 ARM SoC와 x86 에뮬레이션의 차이 및 원인 | 실제 ARM SoC는 x86 에뮬레이션보다 최대 30% 느림. SoC에서 호스트로 가는 one-sided RDMA가 작업당 5µs를 더하고 ARM 코어 클럭은 25% 낮음 | LeapIO | `Ⓑ` |

{{% /details %}}

## 6. 방식 선택: 지연뿐 아니라 CPU·공유·기능을 함께 본다

| 우선 요구 | 함께 판단할 항목 | 이 글의 근거 |
|---|---|---|
| 낮은 요청 지연 | 제출·완료 통지(인터럽트 대 폴링), 기준선 장치 자체의 지연 | 통지 수단(2절), 구성 단계별 QD1 IOPS(2절), vhost 구현별 지연(3절), VM 안 세 방식(5절) |
| 높은 처리량 | 게스트 큐 수와 호스트 처리 스레드, 남는 CPU·디스크 대역 | multi-queue와 IOThread(2절), IOThread 수별 IOPS(부록) |
| 높은 VM 밀도 | 폴링 전용 코어와 hugepage, VM별 제한 조건 | SPDK vhost의 자원 요구(3절), 106 VM 시험(부록) |
| 장치 공유 | 물리 장치 전속 여부, VF 지원, 소프트웨어 중개 방식 | 1절 표, 전속, SR-IOV 지원, 큐 중개(4절) |
| 마이그레이션·블록 기능 | 각 경로가 남기는 기능과 장치별 지원 조건 | nvme://는 게스트에 virtio-blk로 보여 기능이 남음(2절), VFIO 마이그레이션 조건과 TP4159 상태(4절) |

방식을 고를 때는 필요한 성능과 함께 CPU 사용, 장치 공유 단위, 유지해야 할 기능을 봅니다. 낮은 지연이 필요하면 제출·완료 통지 방식과 장치 자체의 지연을 살펴봅니다. 처리량을 높이려면 게스트 큐 수뿐 아니라 호스트에서 그 큐를 처리할 스레드와 남는 자원도 확인해야 합니다.

같은 변경도 자원 여유에 따라 효과가 달랐습니다. IOThread 측정에서는 CPU와 디스크 대역에 여유가 있을 때 이득이 났고, 부하가 포화에 가깝거나 VM 밀도가 높으면 이득이 줄었습니다. 폴링 경로를 비교할 때는 전용 코어와 hugepage, VM별 제한 조건도 함께 읽어야 합니다.

장치가 빨라질수록 같은 소프트웨어 오버헤드의 비중은 커집니다. Hajnoczi 발표의 도식에서는 100µs짜리 디스크의 5%가 15µs짜리 디스크에서는 33%가 됩니다. 지연 수치를 읽을 때는 기준선 장치와 측정 조건을 함께 봅니다. 표가 연결하는 자료들은 조건이 서로 달라 항목 사이의 순위를 보여 주지는 않습니다.

VM에 전달하는 구간과 네트워크 전송 구간의 비용도 따로 봅니다. 이 글이 모은 자료는 SSD·큐 깊이·커널이 서로 다르며, 두 구간을 한 장비에서 겹쳐 잰 자료는 찾지 못했습니다. 이 자료들을 종합한 판단으로는 두 구간의 값을 합산할 수 없습니다. 전송 쪽 비용과 타깃 구현은 [01]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}})에서 따로 봅니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 낮은 요청 지연을 판단할 항목 | 통지 수단(인터럽트 대 폴링)의 근거는 2절 | — | `✓` |
| 낮은 요청 지연의 실측 근거 위치 | 구성 단계별 QD1 IOPS는 2절, vhost 구현별 지연은 3절, VM 안 세 방식 비교는 5절 | — | `Ⓑ` |
| 높은 처리량을 판단할 항목 | multi-queue와 IOThread 설명은 2절 | — | `✓` |
| IOThread 수별 처리량 근거 | 부록의 IOThread 수별 IOPS | — | `Ⓑ` `≈` |
| 높은 VM 밀도를 판단할 항목 | SPDK vhost 자원 요구는 3절, 106 VM 시험은 부록 | — | `Ⓑ` |
| 장치 공유와 전속 여부 | 1절 표와 4절의 장치 전속 설명 | — | `✓` |
| 장치 공유의 SR-IOV 지원 근거 | 4절의 SSD SR-IOV 지원 자료 | — | `Ⓥ` |
| 장치 공유의 큐 중개 근거 | 4절의 큐 중개 측정 | — | `Ⓑ` |
| 마이그레이션·블록 기능을 판단할 항목 | nvme://의 기능 설명은 2절, VFIO 마이그레이션 조건은 4절 | — | `✓` |
| TP4159 상태의 위치 | 마이그레이션 판단과 관련한 TP4159 상태는 4절 참조 | — | — |
| 표의 비교 범위 | 연결된 측정은 조건이 서로 달라 항목끼리 순위를 매기지 않음 | — | — |
| IOThread 이득의 조건 | CPU와 디스크 대역에 여유가 있어야 효과가 남. 부하가 포화에 가깝거나 VM 밀도가 높으면 이득이 줄었음 | — | `Ⓑ` |
| 장치 지연과 오버헤드 비중 | 장치가 빨라질수록 같은 소프트웨어 오버헤드의 비중이 커짐. 100µs짜리 디스크의 5%가 15µs짜리 디스크에서는 33%라는 도식 | — | `Ⓥ` |
| VM 전달 구간과 전송 구간을 합산하지 않는 판단 | SSD·큐 깊이·커널이 서로 다른 논문과 보고서의 값이며, 두 구간을 한 장비에서 겹쳐 잰 자료는 찾지 못함 | — | `Σ` |
| 전송과 타깃 구현의 범위 | 전송 쪽 비용과 타깃 구현은 01에서 별도로 다룸 | — | — |
| 전체 방식의 동일 조건 비교 | 모든 방식을 한 조건에서 잰 값은 이 글의 자료에 없음 | — | `?` |
| 앞머리의 측정 사례를 직접 비교하지 않는 이유 | KVM Forum 2020과 BM-Store는 SSD·커널·소프트웨어가 달라 값을 맞대지 않음 | KVM Forum 2020, BM-Store | — |

{{% /details %}}

### 확인하지 못한 것

- 모든 방식을 한 장비·한 조건에서 잰 공개 자료. 이 글의 측정은 2018~2024년, 호스트 커널 4.10~6.1에 걸쳐 있으며 장치도 서로 다름.
- vfio-user와 SSD SR-IOV의 성능 실측. QEMU가 에뮬레이트하는 NVMe 컨트롤러(hw/nvme)와 virtio-blk를 같은 조건에서 비교한 공개 수치.
- KVM Forum 2020 측정의 게스트 vCPU 수. 같은 발표의 VFIO 슬라이드는 정확한 막대 값을 알 수 없어 눈대중으로 읽은 값만 사용.
- MDev-NVMe의 QEMU·SPDK 버전과 virtio 구성, 업스트림 반영 여부.
- NVMe SR-IOV 지원 SSD의 전체 현황과 VF 수. TP4159를 구현한 SSD와 리눅스 드라이버의 지원 상태.
- AWS Nitro의 카드 내부 데이터 경로와 오버헤드 수치, NVIDIA SNAP의 공개 성능 수치.
- 커널 vhost-scsi의 virtqueue별 worker(Linux 6.5·QEMU 9.0)와 virtio-scsi의 IOThread 매핑 실측.

## 부록. 추가 실측과 구성 조건

### 구성 주석

- virtio-blk의 기본값이 num-queues=num-vcpus로 바뀐 버전은 QEMU 5.2다 `✓`.
- iothread-vq-mapping(virtqueue를 IOThread 여러 개에 나눠 배정)은 QEMU 9.0에서 virtio-blk에 들어왔다. 이를 위해 블록 계층이 멀티스레드 요청 처리를 지원해야 했다 `✓`.
- libvirt에서는 disk driver의 `<iothreads>`로 설정한다. libvirt 10.0.0(QEMU 9.0)부터 virtio 디스크에 한해 지원한다. virtio-scsi 컨트롤러의 매핑은 libvirt 11.2.0(QEMU 10.0)부터 지원한다 `✓`. RHEL에는 9.4에 들어갔다 `✓`.
- iothread-vq-mapping은 cache='none' io='native' 구성을 전제로 설계됐으며 io='threads'와는 맞지 않는다 `✓`.

### KVM Forum 2020 발표 (Hajnoczi)

- 프로토타입 패치(게스트 iopoll, polled NVMe 큐, AIO fast path)를 차례로 적용한 결과는 79,631, 94,367, 105,752 IOPS다. 비교 기준인 iopoll 베어메탈은 120,005 IOPS다 `Ⓑ`. 슬라이드가 이 패치들을 PROTOTYPE로 표시했으므로 2절의 구성 단계와 같은 선에 놓지 않았다.
- iopoll을 쓰지 않은 VFIO passthrough의 4K 랜덤 읽기 QD1 결과는 베어메탈 약 79k, VFIO 약 59k(베어메탈의 약 75%), cpuidle-haltpoll을 켠 VFIO 약 88k IOPS다 `≈`. 게스트 NVMe iopoll을 쓰면 베어메탈 약 120k, VFIO 약 122k IOPS다 `≈`. 막대를 눈대중으로 읽었으므로 비율도 추정값이다. 슬라이드 13의 "Competes with bare metal performance"는 정성 서술이며, 이 막대에서는 haltpoll이나 iopoll을 쓴 구성에만 들어맞는다.
- cpuidle-haltpoll은 게스트 vCPU가 halt하기 전에 잠깐 busy wait해 HALT vmexit를 피하고 완료 지연을 줄인다. 게스트 Linux 5.4가 필요하다 `✓`.

### IOThread 수별 측정 (KVM Forum 2024, Red Hat)

Hajnoczi와 Red Hat의 2024년 측정입니다. 조건은 Optane P4800X, raw host_device, 게스트 vCPU 8개, fio libaio 4K 랜덤 읽기 numjobs=8 direct입니다. 값은 막대를 눈대중으로 읽었습니다. 2절의 QD1 측정과 큐 구성이 달라 숫자를 이어 비교하지 않습니다.

| IOThread 수 | iodepth=1 (IOPS) | iodepth=64 (IOPS) |
|---|---|---|
| 1 | 약 147k | 약 238k |
| 2 | 약 235k | 약 405k |
| 4 | 약 282k | 약 505k |

RHEL 9.4의 DB 측정은 HammerDB TPC-C·Oracle, 192 vCPU VM 1대, 큐 96개, EPYC 9654 2소켓, 호스트 커널 5.14.0-452.el9, QEMU 9.0.0 조건에서 진행했습니다. IOThread 4개를 사용했을 때 TPM은 사용자 10명에서 +22.86%, 100명에서 +13.82% 높아졌습니다 `Ⓑ`.

### SPDK vhost 24.05 보고서 (Intel)

3절 그림의 측정 조건은 Xeon Gold 6348 2소켓, 호스트 커널 6.1.6, QEMU 7.0.0, 게스트 커널 5.15.7, fio 3.28 libaio direct 4K입니다. 드라이브 1장을 VM 2대가 공유하며 vhost 코어 1개를 사용했습니다 `Ⓑ`.

| 4K 랜덤 | SPDK vhost-scsi | 커널 vhost-scsi |
|---|---|---|
| 읽기 QD1 | 24.26k IOPS · 82.24µs | 21.68k IOPS · 92.00µs |
| 읽기 QD64 | 725.48k IOPS · 176.03µs | 356.63k IOPS · 358.92µs |
| 쓰기 QD1 | 136.78k IOPS · 14.34µs | 75.91k IOPS · 26.07µs |

- QD64에서는 IOPS와 지연 차이가 모두 약 2배다 `≈`. 같은 조건에서 SPDK vhost-blk(lvol)는 833.55k IOPS·152.99µs였다.
- 밀도 시험은 VM당 25k IOPS 제한을 두고 vhost 코어 6개로 4K 랜덤 읽기 QD1을 실행했다. 24 VM에서는 SPDK 291.51k, 커널 248.35k IOPS였다. 106 VM에서는 SPDK 1,082.90k IOPS·97.30µs, 커널 358.64k IOPS·295.75µs였다. 보고서 결론 문장은 읽기 성능을 최대 1.17배로 적지만 106 VM 행은 약 3.0배여서 표 값을 사용했다 `≈`.
- 같은 보고서의 코어 스케일링 시험은 vhost 코어 1개당 VM 2대, 4K 랜덤 읽기 QD64 조건이다. 1코어에서 1.71M(scsi)·1.79M(blk) IOPS였으며, 10코어까지 거의 선형으로 증가해 15.29M에 도달했다. 22코어에서는 19.32M이었다.

### BM-Store 논문 (HPCA 2023)

- 베어메탈 평균 지연을 네이티브와 BM-Store 순서로 비교하면, 4K 랜덤 읽기 QD1은 77.2µs 대 80.4µs, 4K 랜덤 쓰기 QD1은 11.6µs 대 14.5µs다. 두 경우 모두 약 3µs가 추가된다. 처리량은 네이티브의 96.2~101.4%이며 rand-w-1만 82.5%다 `Ⓑ`.
- VM 안 랜덤 읽기 QD128 평균 지연은 VFIO 1647.0µs, BM-Store 1666.0µs, SPDK vhost 1893.4µs다 `Ⓑ`.

## 참고 자료

- [The 10 Microsecond Challenge: Optimizing for NVMe Drives](https://vmsplice.net/~stefan/stefanha-kvm-forum-2020.pdf) — Stefan Hajnoczi, KVM Forum 2020. 방식별 경로, VFIO, IOThread·nvme://, QD1 실측, 오버헤드 비중 도식
- [Improving virtio-blk SMP scalability in QEMU](https://vmsplice.net/~stefan/stefanha-kvm-forum-2024.pdf) — Stefan Hajnoczi, KVM Forum 2024. virtio-blk 스레드 구조, iothread-vq-mapping, IOThread 수 측정
- [Scaling virtio-blk disk I/O with IOThread Virtqueue Mapping](https://developers.redhat.com/articles/2024/09/05/scaling-virtio-blk-disk-io-iothread-virtqueue-mapping) — Red Hat Developer, 2024-09-05. RHEL 9.4 편입, 측정 조건
- [Virtualized database I/O performance improvements in RHEL 9.4](https://developers.redhat.com/articles/2024/09/10/virtualized-database-io-performance-improvements-rhel-94) — Sanjay Rao·Stefan Hajnoczi, Red Hat Developer, 2024-09-10. DB 워크로드 측정
- [Domain XML format](https://libvirt.org/formatdomain.html) — libvirt. iothreads 매핑의 libvirt·QEMU 버전
- [SPDK Vhost Performance Report 24.05](https://review.spdk.io/download/performance-reports/SPDK_vhost_perf_report_2405.pdf) — Intel, 2024-07. SPDK vhost 대 커널 vhost-scsi 실측, 커널 vhost-scsi 구조
- [Virtualized I/O with Vhost-user](https://spdk.io/doc/vhost_processing.html) — SPDK 문서. vhost-user 경로, 완료 인터럽트
- [MDev-NVMe](https://www.usenix.org/system/files/conference/atc18/atc18-peng.pdf) — Peng 외, USENIX ATC 2018. mediated passthrough 구조, 네이티브·vhost·virtio 대조, hugepage 부담
- [LightIOV](https://arxiv.org/abs/2304.05148) — Chen 외, arXiv 2023. 큐 직접 할당 방식(초록만 확인)
- [BM-Store](https://shuibing9420.github.io/assets/pdf/BM-Store_A_Transparent_and_High-performance_Local_Storage_Architecture_for_Bare-metal_Clouds_Enabling_Large-scale_Deployment.pdf) — Chen 외, HPCA 2023. VFIO·vhost·FPGA 에뮬레이션 대조, vhost 코어 소모
- [LeapIO](https://ucare.cs.uchicago.edu/pdf/asplos20-LeapIO.pdf) — Li 외, ASPLOS 2020. ARM SoC 오프로드, passthrough 대비 저하
- [VFIO device migration](https://www.qemu.org/docs/master/devel/migration/vfio.html) — QEMU 문서. opt-in과 P2P 조건
- [NVM Express Revision Changes](https://nvmexpress.org/wp-content/uploads/NVM-Express-Revision-Changes-2025.08.01.pdf) — NVM Express, 2025-08-01. TP4159의 Base 2.1 편입
- [[PATCH RFC 0/5] nvme: Controller Data Queue (CDQ) support](https://lists.infradead.org/pipermail/linux-nvme/2026-April/062521.html) — linux-nvme, 2026-04-24. live migration의 리눅스 반영 상태와 합의 부재
- [Samsung brings revolutionary software innovation to PCIe Gen4 SSDs](https://news.samsung.com/global/samsung-brings-revolutionary-software-innovation-to-pcie-gen4-ssds-for-maximized-storage-performance) — Samsung Newsroom, 2019-09. PM1733·PM1735의 SR-IOV 최대 64분할
- [ThinkSystem PM1743 SSD 제품 가이드 LP1712](https://lenovopress.lenovo.com/lp1712-thinksystem-pm1743-read-intensive-nvme-pcie-50-ssd) — Lenovo Press, 2023. PM1743의 최대 64분할
- [nvme-cli issue #1126](https://github.com/linux-nvme/nvme-cli/issues/1126) — 사용자 보고, 2021~2022. PM1733·PM1735 실물의 VF 32개 보고
- [KIOXIA CM7 보도자료](https://americas.kioxia.com/en-us/business/news/2022/ssd-20220725-1.html) — KIOXIA, 2022. SR-IOV 지원 표기
- [vfio-user client in QEMU 10.1](https://movementarian.org/blog/posts/2025-08-27-vfio-user-client-in-qemu/) — John Levon, 2025-08-27. vfio-user와 SPDK nvmf
- [The Security Design of the AWS Nitro System](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/the-components-of-the-nitro-system.html) · [Amazon EBS volumes and NVMe](https://docs.aws.amazon.com/ebs/latest/userguide/nvme-ebs-volumes.html) · [Amazon EBS Provisioned IOPS SSD volumes](https://docs.aws.amazon.com/ebs/latest/userguide/provisioned-iops.html) — AWS. EBS의 NVMe 노출, Nitro Card의 NVMe 인터페이스와 SR-IOV VF, io2 Block Express의 SRD
- [NVIDIA DOCA SNAP-4 Service Guide](https://networking-docs.nvidia.com/doca/archive/2-9-0/nvidia-doca-snap-4-service-guide) — NVIDIA, DOCA 2.9.0. 에뮬레이션 장치와 백엔드, VF 수
