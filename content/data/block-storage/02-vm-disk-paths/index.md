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

NVMe SSD가 여러 장 꽂힌 서버의 용량을 VM에 나눠 줄 때는 VM에 장치를 어떻게 보여 주느냐에 따라 요청 하나가 거치는 소프트웨어가 달라집니다. [01 iSCSI와 NVMe-oF]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}})는 요청이 네트워크를 건너 타깃의 블록 장치에 닿기까지를 다뤘습니다. 이 글은 호스트가 가진 NVMe 용량을 VM에 내주는 구간을 살펴봅니다.

장치를 VM에 내주는 방법은 넷으로 나뉩니다. QEMU나 별도 프로세스가 장치를 소프트웨어로 흉내 내는 방식(virtio, vhost, vfio-user), 물리 장치나 그 일부를 게스트에 직접 붙이는 방식(passthrough, SR-IOV), 게스트 큐를 호스트가 물리 큐에 중개하는 방식(mediated passthrough), 카드가 장치를 에뮬레이트하는 방식(DPU·SmartNIC)입니다.

방식 간 성능 격차는 조건에 따라 크게 달라집니다. KVM Forum 2020 발표의 QD1 4KB 읽기에서 기본 virtio-blk는 베어메탈 IOPS의 28%, IOThread를 붙이면 59%였습니다 `Ⓑ` `≈`. BM-Store 논문이 같은 장비의 VM 안에서 VFIO, SPDK vhost, FPGA 에뮬레이션을 잰 QD1 4K 읽기 평균 지연은 79.7, 82.7, 83.7µs여서 VFIO와의 차이가 3.0~4.0µs였습니다 `Ⓑ` `≈`. 두 값은 SSD·커널·소프트웨어가 달라 맞대지 않습니다. 이 글의 자료에는 모든 방식을 한 조건에서 잰 값이 없습니다 `?`.

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

## 1. 같은 NVMe 용량도 VM에 전달하는 경로는 다르다

{{< flow src="_flow/1-방식별-소프트웨어-경로.json" />}}

그림의 네 경로는 장치를 소프트웨어로 구현하는 방식입니다. virtio-blk에서는 QEMU 스레드가, 커널 vhost-scsi에서는 호스트 커널 스레드가, SPDK vhost에서는 폴링하는 SPDK 프로세스가 virtqueue의 요청을 꺼냅니다. vfio-user에서는 게스트가 NVMe 드라이버를 그대로 쓰고, 유저스페이스 프로세스가 장치 쪽을 구현합니다 `Ⓥ`.

소프트웨어를 거의 거치지 않는 경로도 있습니다. 물리 장치나 SR-IOV VF를 붙이는 passthrough, 큐만 중개하는 mediated passthrough, 카드가 장치를 구현하는 DPU 방식입니다. 이 경로들은 4절 끝의 그림에 있습니다.

아래 표는 이 글에서 다루는 방식의 특성을 나란히 비교합니다. 마지막 칸에는 이 글의 자료에 같은 조건의 비교 실측이 있는지만 적었고, 없으면 `?`로 표시했습니다. 경로 설명만으로 성능 순위를 매기지는 않았습니다.

| 방식 | 게스트가 보는 장치 | 요청 처리 주체 | 남는 소프트웨어 처리 | 공유·기능 제약 | 직접 비교 실측 |
|---|---|---|---|---|---|
| QEMU virtio-blk(기본) | virtio-blk | QEMU 스레드 하나가 장치의 virtqueue 전부를 처리 `✓` | virtqueue 파싱, 이미지 포맷·블록 계층 기능, AIO·io_uring 제출과 완료, 완료 인터럽트 주입 `✓` | 호스트 쪽이 단일 스레드라 SMP 확장성 문제가 남음 `✓` | 있음 (2절) |
| virtio-blk + IOThread | virtio-blk | 전용 IOThread. adaptive polling 이벤트 루프 `✓` | 같은 QEMU 경로를 다른 스레드가 처리 | 호스트 코어를 씀. 장치 여러 개를 한 스레드에 묶거나 CPU에 고정 가능 `✓` | 있음 (2절) |
| QEMU nvme:// | virtio-blk | QEMU의 유저스페이스 NVMe 드라이버 | QEMU 블록 계층 | PCI 장치가 게스트 한 대에 전속. live migration과 블록 계층 기능은 남음 `✓` | 있음 (2절, 같은 측정의 한 단계) |
| 커널 vhost-scsi | virtio-scsi | vhost 타깃당 커널 스레드 하나, 인터럽트 구동 `✓` | 커널의 SCSI 타깃 경로 | 드라이브 하나를 VM 여럿이 나눠 쓴 측정이 있음 `Ⓑ` | 있음 (3절) |
| SPDK vhost(vhost-user) | virtio-blk 또는 virtio-scsi | 공유 virtqueue를 폴링하는 SPDK 프로세스 `✓` | 폴링 전용 코어, hugepage. 완료는 eventfd 인터럽트 `✓` | 게스트 메모리를 hugepage로 미리 할당 `✓` | 있음 (3절, 5절) |
| vfio-user | 가상 PCI·NVMe 장치(게스트는 NVMe 드라이버) | 유저스페이스 프로세스(libvfio-user, SPDK nvmf 서브시스템) `Ⓥ` | `?` | 커널 구성 요소가 없음. QEMU 10.1에 클라이언트가 들어감 `Ⓥ` | `?` |
| VFIO passthrough | NVMe(물리 장치 그대로) | 장치 자체. 호스트 커널은 데이터 경로에서 빠짐 `✓` | 없음. DMA는 IOMMU가 처리 `✓` | 장치가 게스트 한 대에 전속. live migration·소프트웨어 기능 제한 `✓` | 있음 (5절의 기준선) |
| SSD SR-IOV | NVMe(VF) | SSD 하드웨어가 VF로 분할 | `?` | SSD가 지원해야 함. VF 수는 제품마다 다름 `Ⓥ` | `?` |
| mediated passthrough(MDev-NVMe) | 네이티브 NVMe 드라이버 | 호스트가 게스트 큐를 물리 큐에 shadow `Ⓑ` | 폴링 스레드 3개가 호스트 코어 3개를 100% 사용 `Ⓑ` | 논문 구현. 업스트림 반영 여부는 미확인 `?` | 있음 (4절, 네이티브 대비 비율. VFIO는 측정 대상이 아님) |
| DPU·SmartNIC 에뮬레이션 | NVMe 또는 virtio-blk | 카드(FPGA, Arm 코어 등) | 카드 구현마다 다름. BM-Store 논문은 호스트 CPU를 쓰지 않는다고 함 `Ⓑ` | AWS Nitro는 카드의 function을 SR-IOV VF로 나눠 VM에 배정 `✓` | BM-Store 한 논문만 있음 (5절). 상용 카드 수치는 `?` |

## 2. virtio-blk: 게스트 큐와 호스트 처리 스레드

{{< lane src="_lane/2-virtio-blk-qd1.json" />}}

그림은 Hajnoczi의 KVM Forum 2020 발표에서 QD1로 잰 값입니다. 같은 측정에서 구성을 하나씩 바꿨으므로 막대끼리 이어 읽을 수 있습니다.

QEMU의 기본 virtio-blk 경로에서는 스레드 하나가 장치 하나를 에뮬레이트하고, 그 장치의 virtqueue를 전부 처리합니다. 이 스레드가 virtqueue 요청 파싱, qcow2 같은 이미지 포맷과 블록 계층 기능, Linux AIO나 io_uring 제출·완료, 응답 작성, 게스트에 완료 인터럽트를 넣는 일까지 맡습니다 `✓`.

vCPU마다 virtqueue를 두는 multi-queue는 게스트 쪽 제출 경합을 없애고, 완료 인터럽트를 요청을 제출한 vCPU로 보냅니다. multi-queue가 기본으로 켜져 있어도 호스트 쪽 처리는 단일 스레드이므로 SMP 확장성 문제가 남습니다 `✓`.

IOThread는 이 처리를 전용 스레드로 옮깁니다. adaptive polling 이벤트 루프를 돌며, 장치 여러 개를 한 IOThread에 묶거나 CPU에 고정할 수 있습니다 `✓`. 통지에는 eventfd 또는 폴링을 씁니다. eventfd를 쓰면 커널 스케줄러가 스레드를 깨우고, 폴링은 busy wait로 CPU를 씁니다 `✓`.

그림에서 IOThread를 붙이면 IOPS가 21,831에서 46,424로 올라갑니다. multi-queue를 더한 값은 46,876 IOPS로 IOThread만 붙였을 때와 거의 같습니다. QD1에서는 한 번에 요청 하나만 나가므로 큐를 늘려도 달라질 것이 없다는 뜻으로 읽습니다 `Σ`.

IOPS를 요청당 시간으로 환산하면(1/IOPS) 베어메탈 12.7µs, 기본 virtio-blk 45.8µs, IOThread 21.5µs, nvme:// 18.1µs입니다 `≈`. 기본 경로가 더하는 33µs에서 IOThread가 24µs를 줄이고, 남은 9µs에서 nvme://가 3µs를 더 줄입니다. nvme://는 QEMU 유저스페이스 NVMe 드라이버(QEMU 2.12)입니다. PCI 장치는 게스트 한 대에 전속되지만 게스트에는 virtio-blk로 보이므로 live migration과 이미지 포맷·throttling 같은 블록 계층 기능이 남습니다 `✓`.

IOThread를 여러 개 쓰면 virtqueue를 병렬로 처리합니다. 2024년 측정에서 IOThread 4개의 IOPS는 1개의 약 2배였고, 슬라이드는 이를 "4 IOThreads doubles performance"로 요약합니다 `Ⓑ` `≈`. 큐 구성이 위 QD1 측정과 달라 숫자를 이어 읽지 않습니다.

권장 수는 4~8개입니다. 너무 적으면 드라이브를 채우지 못하고, 너무 많으면 애플리케이션이 쓸 CPU를 차지합니다. 64KB 이상 블록이면 IOThread 하나로도 디스크가 포화될 수 있다고 합니다 `Ⓥ`. 이득은 CPU와 디스크 대역에 여유가 있어야 납니다. 부하가 포화에 가깝거나 VM 밀도가 높으면 이득이 줄었습니다 `Ⓑ`. 측정값과 DB 워크로드 결과는 부록에 있습니다.

## 3. vhost와 vfio-user: 소프트웨어 장치 구현의 위치

{{< lane src="_lane/3-vhost-scsi-읽기-지연.json" />}}

그림은 SPDK 24.05 vhost 보고서가 커널 vhost-scsi와 SPDK vhost를 같은 조건에서 잰 값입니다. 읽기 QD1에서 차이는 약 10µs(1.12배)입니다 `≈`. 쓰기 QD1과 QD64, VM 밀도 시험에서는 차이가 더 벌어지며, 해당 값은 부록에 적었습니다. 이 값을 전송 구간의 비용과 합치지 않습니다.

vhost는 데이터 경로를 QEMU 밖으로 뺍니다. 커널 vhost-scsi는 인터럽트 구동이고, vhost 타깃당 커널 스레드가 하나입니다 `✓`. SPDK vhost(vhost-user)에서는 QEMU가 UNIX 소켓으로 타깃을 설정하고 게스트 메모리를 hugepage로 미리 할당합니다. 게스트는 공유 메모리의 virtqueue에 I/O를 직접 제출하며, 이 과정에 QEMU는 관여하지 않습니다.

SPDK가 poll-mode로 동작하므로 제출 통지는 필요 없습니다. 완료는 eventfd 인터럽트로 알리므로 시스템 콜과 게스트 VM exit 비용이 듭니다 `✓`. 게스트가 poll-mode virtio 드라이버를 쓰면 완료 인터럽트도 없어져 경로가 QEMU와 KVM을 완전히 우회합니다 `✓`. vhost-user-blk는 SPDK용으로 만들어졌고, QEMU 5.2의 qemu-storage-daemon도 vhost-user-blk export로 NVMe 한 장을 게스트 여럿에 나눠 줄 수 있습니다 `✓`.

이 경로에는 코어와 메모리 비용이 남습니다. SPDK vhost는 hugepage와 폴링 전용 코어를 요구합니다 `Ⓑ`. BM-Store 논문(HPCA 2023)은 Intel P4510 4장에서 128K 순차 읽기 QD256으로 네이티브의 80%를 내는 데 SPDK vhost 코어가 8개 이상 필요했다고 보고합니다 `Ⓑ`.

vfio-user는 같은 위치에서 다른 인터페이스를 제공합니다. vhost-user는 게스트에 virtio 장치를 보여 주고, vfio-user는 PCI 장치를 유저스페이스에서 구현해 게스트가 가상 NVMe 컨트롤러를 보게 합니다. 커널 구성 요소가 없고, QEMU 10.1에 vfio-user 클라이언트가 들어갔으며(직전 회귀 때문에 10.1보다 조금 뒤 버전이 필요하다고 함), SPDK nvmf 서브시스템과 libvfio-user를 묶어 쓰는 구성은 libvfio-user 메인테이너의 글에 나옵니다 `Ⓥ`. vhost와 passthrough에 견준 vfio-user의 성능 실측은 확인하지 못했습니다 `?`.

## 4. passthrough·SR-IOV·mediated passthrough

| 방식 | 게스트에 붙는 것 | 공유 단위 | 하드웨어 지원 | 호스트 쪽 비용 | 제약 |
|---|---|---|---|---|---|
| VFIO passthrough | 물리 PCI 장치 | 없음. 장치가 게스트 한 대에 전속 | IOMMU | 데이터 경로에서 빠짐 | live migration·소프트웨어 기능 제한 |
| SSD SR-IOV | 장치가 내는 VF | VF 하나당 VM 하나 | SSD가 SR-IOV 지원 | `?` | VF 수·지원 SSD가 제품마다 다름 |
| mediated passthrough | 큐(게스트는 네이티브 NVMe 드라이버) | 게스트 큐를 호스트가 물리 큐에 shadow. 폴링 스레드는 VM 간 공유 가능 | `?` | 폴링 스레드가 코어 3개를 100% 사용 | 논문 구현 |

VFIO passthrough는 장치의 BAR를 게스트에 memory-map하고, IRQ를 실행 중인 게스트에 직접 주입하며(posted interrupts), DMA가 IOMMU를 거쳐 게스트 RAM에 닿게 합니다. 호스트 커널은 데이터 경로에서 빠집니다 `✓`.

발표 슬라이드는 장점을 "Competes with bare metal performance"로, 단점을 "Limited live migration & software features", "Guests may be tied to physical hardware", "PCI device is dedicated to 1 guest"로 적습니다 `✓`. 이 문구는 슬라이드의 정성 서술입니다 `✓`. 같은 발표의 QD1 4K 읽기 막대에서 iopoll과 haltpoll이 없을 때 VFIO는 베어메탈의 약 75%였고, haltpoll을 켜면 베어메탈보다 높았습니다(부록) `≈`.

live migration의 제약은 구체적입니다. QEMU의 VFIO 마이그레이션은 장치가 `VFIO_DEVICE_FEATURE_MIGRATION`으로 opt-in해야 하고, VFIO 장치가 여럿이면 전부 P2P migration을 지원해야 허용됩니다 `✓`. NVM Express 개정 이력 문서에 따르면 NVMe 쪽 표준으로는 TP4159가 NVMe Base Specification 2.1에 선택 기능으로 들어갔습니다 `✓`.

리눅스에는 2022년 VFIO 드라이버 RFC와 2025·2026년 Controller Data Queue RFC가 올라왔을 뿐입니다. mainline 소스를 확인하면(2026-10-04, 7.3-rc5) 드라이버가 없으며, 2026-04 RFC는 커널에 어떻게 넣을지 합의가 없다고 적습니다 `✓`. 이를 구현한 SSD 모델은 확인하지 못했습니다 `?`.

SSD가 SR-IOV를 지원하면 SSD 하나를 VF 여러 개로 나눠 VM마다 하나씩 붙일 수 있습니다. 이 글에서 확인한 VF 수는 삼성 PM1733·PM1735(제조사 발표)와 PM1743(Lenovo 제품 가이드)의 "최대 64"뿐입니다 `Ⓥ`. PM1733·PM1735 실물에서 32개로 보인다는 사용자 보고가 있습니다. 듀얼 포트 구성이나 펌웨어 차이인지는 확인하지 못했습니다 `Ⓑ` `?`.

KIOXIA CM7은 발표문에 SR-IOV 지원 표기만 있고 VF 수를 밝힌 문서는 찾지 못했습니다 `Ⓥ`. Micron·Solidigm은 근거가 없습니다 `?`. SR-IOV 지원 표기만으로 성능이나 live migration 지원까지 판단해서는 안 됩니다. SSD의 VF를 게스트에 붙여 잰 성능은 이 글의 자료에 없습니다 `?`.

MDev-NVMe(USENIX ATC 2018)는 커널 mediated device 프레임워크(4.10부터)를 사용한 논문 구현입니다. 게스트는 네이티브 NVMe 드라이버를 그대로 쓰고, 호스트는 게스트 큐를 물리 큐에 shadow합니다. doorbell MMIO trap(vm-exit)과 인터럽트는 폴링으로 바꿨으며, 폴링 스레드 3개가 호스트 코어 3개를 100% 씁니다(VM 간 공유 가능) `Ⓑ`.

같은 논문은 네이티브와 SPDK vhost, virtio도 함께 쟀습니다. 측정 조건은 Optane P4800X, 호스트·게스트 커널 4.10, VM당 vCPU 4개입니다. QEMU·SPDK 버전과 virtio의 IOThread 사용 여부는 논문에 없습니다 `?`.

| 4K 랜덤 읽기 | QD1 IOPS(네이티브 대비) | QD1 평균 지연(네이티브=1.00) | QD32·job 4 IOPS(네이티브 대비) |
|---|---|---|---|
| MDev-NVMe | 66% | 1.51 | 142% |
| SPDK vhost-blk | 59% | 1.70 | 136% |
| SPDK vhost-scsi | 54% | 1.86 | 109% |
| virtio | 29% | 3.58 | 45% |

표에서 QD32의 값이 100%를 넘는 것은 네이티브가 인터럽트 구동이고 MDev가 호스트 코어 3개를 폴링에 쓰는 조건에서 나온 결과입니다 `Ⓑ`. 이 논문의 측정 대상에 VFIO passthrough는 없습니다 `✓`.

큐를 직접 넘기는 소프트웨어 방식인 LightIOV는 초록에서 IOPS가 VFIO의 97.6~100.2%, VM 200개에서 SPDK vhost보다 지연이 31.4% 낮다고 적습니다 `Ⓑ`. 초록만 확인했고 측정 조건은 알지 못합니다 `?`.

{{< flow src="_flow/4-직접-할당-큐-중개-카드.json" />}}

위 그림은 이 절의 세 방식과 다음 절의 카드 방식을 나란히 놓은 것입니다. 앞의 셋은 호스트에 꽂힌 PCIe NVMe 장치를 전제로 하며, 맨 아래 경로는 백엔드가 네트워크 너머에 있을 수 있습니다.

## 5. DPU·SmartNIC가 NVMe 장치로 보이게 하는 경우

{{< lane src="_lane/5-vm-안-전달-방식-지연.json" />}}

그림은 BM-Store 논문이 같은 장비의 VM 안에서 세 방식을 잰 값입니다. BM-Store는 Zhejiang University와 Alibaba의 구현으로, FPGA 기반 BMS-Engine이 I/O 경로를 맡고 ARM 기반 BMS-Controller가 관리를 맡습니다. 테넌트는 표준 NVMe 드라이버만 씁니다. BM-Store는 호스트 CPU를 쓰지 않으며, 백엔드 SSD의 namespace를 프런트엔드 VF에 묶습니다 `Ⓑ`.

같은 논문에서 랜덤 쓰기 QD1은 VFIO 14.9µs, BM-Store 19.6µs, SPDK vhost 19.2µs입니다 `Ⓑ`. QD1에서 에뮬레이션과 vhost가 VFIO에 더하는 시간은 읽기에서 3~4µs(약 4~5%), 쓰기에서 4~5µs(약 30%)입니다 `≈`. 더해지는 시간은 읽기와 쓰기가 비슷하지만, 쓰기 자체가 짧아 비율이 커집니다 `Σ`. Hajnoczi의 KVM Forum 2020 발표에도 같은 소프트웨어 오버헤드가 100µs짜리 디스크에서는 5%, 15µs짜리 디스크에서는 33%가 된다는 도식이 있습니다 `Ⓥ`.

BM-Store 논문에서 SPDK vhost는 VFIO의 63.0~96.0% 성능을 냈습니다. 최저치는 128K 순차 읽기 QD256에서 나왔으며, 성능 저하는 CentOS 7 커널 3.10 게스트에서 심했습니다 `Ⓑ`.

이 값을 상용 카드의 성능으로 옮겨 읽을 수는 없습니다. 게스트가 보는 NVMe 인터페이스와 카드 뒤의 백엔드 전송은 따로 봐야 합니다. AWS 문서는 EBS 볼륨이 Nitro 기반 인스턴스에서 NVMe 블록 장치로 노출된다고 적습니다. Nitro Card는 PCIe로 호스트에 붙어 "NVMe for block storage (EBS and instance store)" 인터페이스를 내고, Nitro Hypervisor 구성에서는 카드의 PCIe function을 SR-IOV VF로 나눠 VM에 직접 배정합니다. EBS 암호화는 카드의 오프로드 엔진이 맡습니다 `✓`.

게스트에서 `/dev/nvme1n1`로 보인다고 카드 뒤의 구간이 NVMe-oF라는 뜻은 아닙니다. 전송 계층을 문서에 밝힌 것은 io2 Block Express가 SRD를 쓴다는 대목뿐입니다 `✓`. 카드 안 데이터 경로와 가상화 오버헤드 수치는 공개되어 있지 않아 "성능에 실질적인 영향이 없다" 수준의 서술만 있습니다 `Ⓥ`.

NVIDIA SNAP은 BlueField-3의 Arm 코어에서 돌며 네트워크 스토리지를 PCIe 버스의 로컬 드라이브처럼 에뮬레이트합니다. 호스트가 에뮬레이트 장치로 보낸 트래픽은 SNAP 서비스의 스토리지 컨트롤러로 가고, 백엔드는 SPDK 블록 장치입니다. NVMe와 virtio-blk를 모두 에뮬레이트하고 백엔드 프로토콜로 NVMe-oF·iSCSI 등을 RDMA나 TCP로 이으며, VF는 NVMe 최대 512개, virtio-blk 최대 2,000개까지 냅니다 `✓`. 문서에 성능 수치는 없습니다 `?`.

LeapIO(ASPLOS 2020)는 스토리지 서비스를 ARM SoC 코프로세서로 옮기고, 수정 없는 게스트에 가상 NVMe를 제공합니다. 개발 동기는 데이터센터 x86 코어의 10~20%를 클라우드 스토리지 스택이 쓴다는 점입니다. passthrough 대비 처리량 저하는 읽기 전용 2%, 읽기·쓰기 50/50 5%이고, p99 아래 지연은 평균 3%, p99.9에서 6~12% 높았습니다(Intel P4600, 게스트 8코어). 실제 ARM SoC에서 돌리면 x86 에뮬레이션보다 최대 30% 느렸습니다. SoC에서 호스트로 가는 one-sided RDMA가 작업당 5µs를 더하고 ARM 코어 클럭이 25% 낮기 때문입니다 `Ⓑ`.

## 6. 방식 선택: 지연뿐 아니라 CPU·공유·기능을 함께 본다

| 우선 요구 | 함께 판단할 항목 | 이 글의 근거 |
|---|---|---|
| 낮은 요청 지연 | 제출·완료 통지(인터럽트 대 폴링), 기준선 장치 자체의 지연 | 통지 수단 `✓`(2절), 구성 단계별 QD1 IOPS `Ⓑ`(2절), vhost 구현별 지연 `Ⓑ`(3절), VM 안 세 방식 `Ⓑ`(5절) |
| 높은 처리량 | 게스트 큐 수와 호스트 처리 스레드, 남는 CPU·디스크 대역 | multi-queue와 IOThread `✓`(2절), IOThread 수별 IOPS `Ⓑ` `≈`(부록) |
| 높은 VM 밀도 | 폴링 전용 코어와 hugepage, VM별 제한 조건 | SPDK vhost의 자원 요구 `Ⓑ`(3절), 106 VM 시험 `Ⓑ`(부록) |
| 장치 공유 | 물리 장치 전속 여부, VF 지원, 소프트웨어 중개 방식 | 1절 표, 전속 `✓`, SR-IOV 지원 `Ⓥ`, 큐 중개 `Ⓑ`(4절) |
| 마이그레이션·블록 기능 | 각 경로가 남기는 기능과 장치별 지원 조건 | nvme://는 게스트에 virtio-blk로 보여 기능이 남음 `✓`(2절), VFIO 마이그레이션 조건 `✓`과 TP4159 상태(4절) |

표의 "이 글의 근거"에 연결된 측정은 조건이 서로 다르므로 항목끼리 순위를 매기지 않습니다. 같은 자료에는 이점이 줄어드는 조건도 나옵니다. IOThread는 CPU와 디스크 대역에 여유가 있어야 효과가 나고, 부하가 포화에 가깝거나 VM 밀도가 높으면 이득이 줄었습니다 `Ⓑ`.

장치가 빨라질수록 같은 소프트웨어 오버헤드의 비중은 커집니다. 100µs짜리 디스크의 5%가 15µs짜리 디스크에서는 33%라는 도식이 그 예입니다 `Ⓥ`.

VM 전달 구간과 전송 구간의 비용은 합산하지 않습니다. 이 글의 값은 SSD·큐 깊이·커널이 제각각인 논문과 보고서에서 왔고, 두 구간을 한 장비에서 겹쳐 잰 자료는 찾지 못했습니다 `Σ`. 전송 쪽 비용과 타깃 구현은 [01]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}})에서 따로 봅니다.

### 확인하지 못한 것

- 모든 방식을 한 장비·한 조건에서 잰 공개 자료. 이 글의 값은 2018~2024년, 호스트 커널 4.10~6.1에 걸쳐 있고 장치도 다르다.
- vfio-user와 SSD SR-IOV의 성능 실측. QEMU가 에뮬레이트하는 NVMe 컨트롤러(hw/nvme)와 virtio-blk를 같은 조건에서 잰 공개 수치.
- KVM Forum 2020 측정의 게스트 vCPU 수. 같은 발표 VFIO 슬라이드의 정확한 막대 값은 알 수 없고 눈대중으로 읽은 값뿐이다.
- MDev-NVMe의 QEMU·SPDK 버전과 virtio 구성, 업스트림 반영 여부.
- NVMe SR-IOV 지원 SSD의 전체 현황과 VF 수. TP4159를 구현한 SSD와 리눅스 드라이버의 지원 상태.
- AWS Nitro의 카드 내부 데이터 경로와 오버헤드 수치, NVIDIA SNAP의 공개 성능 수치.
- 커널 vhost-scsi의 virtqueue별 worker(Linux 6.5·QEMU 9.0)와 virtio-scsi의 IOThread 매핑 실측.

## 부록. 추가 실측과 구성 조건

### 구성 주석

- virtio-blk의 기본값이 num-queues=num-vcpus가 된 것은 QEMU 5.2부터다 `✓`.
- iothread-vq-mapping(virtqueue를 IOThread 여러 개에 나눠 배정)은 QEMU 9.0에서 virtio-blk에 들어왔다. 블록 계층이 멀티스레드 요청 처리를 지원하게 된 것이 전제다 `✓`.
- libvirt에서는 disk driver의 `<iothreads>`로 설정한다. libvirt 10.0.0(QEMU 9.0)부터 지원하며 대상은 virtio 디스크뿐이다. virtio-scsi 컨트롤러의 매핑은 libvirt 11.2.0(QEMU 10.0)부터다 `✓`. RHEL은 9.4에 들어갔다 `✓`.
- iothread-vq-mapping은 cache='none' io='native' 구성을 전제로 설계됐고 io='threads'와는 맞지 않는다 `✓`.

### KVM Forum 2020 발표 (Hajnoczi)

- 프로토타입 패치(게스트 iopoll, polled NVMe 큐, AIO fast path)를 차례로 적용하면 79,631, 94,367, 105,752 IOPS이고 비교 기준인 iopoll 베어메탈은 120,005 IOPS다 `Ⓑ`. 패치는 슬라이드에 PROTOTYPE로 표시돼 있어 2절의 구성 단계와 같은 선에 놓지 않았다.
- VFIO passthrough, iopoll 없음, 4K 랜덤 읽기 QD1은 베어메탈 약 79k, VFIO 약 59k(베어메탈의 약 75%), cpuidle-haltpoll을 켠 VFIO 약 88k IOPS다 `≈`. 게스트 NVMe iopoll을 쓰면 베어메탈 약 120k, VFIO 약 122k IOPS다 `≈`. 막대를 눈대중으로 읽은 값이므로 비율도 추정이다. 슬라이드 13의 "Competes with bare metal performance"는 정성 서술이며, 이 막대에서는 haltpoll이나 iopoll을 쓴 구성에서만 맞는다.
- cpuidle-haltpoll은 게스트 vCPU가 halt하기 전에 잠깐 busy wait해 HALT vmexit를 피하고 완료 지연을 줄인다. 게스트 Linux 5.4가 필요하다 `✓`.

### IOThread 수별 측정 (KVM Forum 2024, Red Hat)

Hajnoczi와 Red Hat의 2024년 측정입니다(Optane P4800X, raw host_device, 게스트 vCPU 8개, fio libaio 4K 랜덤 읽기 numjobs=8 direct). 값은 막대를 눈대중으로 읽은 것입니다 `≈`. 2절의 QD1 측정과 큐 구성이 달라 숫자를 이어 읽지 않습니다.

| IOThread 수 | iodepth=1 (IOPS) | iodepth=64 (IOPS) |
|---|---|---|
| 1 | 약 147k | 약 238k |
| 2 | 약 235k | 약 405k |
| 4 | 약 282k | 약 505k |

RHEL 9.4의 DB 측정 조건은 HammerDB TPC-C·Oracle, 192 vCPU VM 1대, 큐 96개, EPYC 9654 2소켓, 호스트 커널 5.14.0-452.el9, QEMU 9.0.0입니다. 이 조건에서 IOThread 4개는 TPM을 사용자 10명일 때 +22.86%, 100명일 때 +13.82% 올렸습니다 `Ⓑ`.

### SPDK vhost 24.05 보고서 (Intel)

측정 조건은 3절 그림과 같습니다(Xeon Gold 6348 2소켓, 호스트 커널 6.1.6, QEMU 7.0.0, 게스트 커널 5.15.7, fio 3.28 libaio direct 4K, 드라이브 1장을 VM 2대가 공유, vhost 코어 1개) `Ⓑ`.

| 4K 랜덤 | SPDK vhost-scsi | 커널 vhost-scsi |
|---|---|---|
| 읽기 QD1 | 24.26k IOPS · 82.24µs | 21.68k IOPS · 92.00µs |
| 읽기 QD64 | 725.48k IOPS · 176.03µs | 356.63k IOPS · 358.92µs |
| 쓰기 QD1 | 136.78k IOPS · 14.34µs | 75.91k IOPS · 26.07µs |

- QD64에서는 IOPS와 지연 모두 약 2배로 벌어진다 `≈`. 같은 조건에서 SPDK vhost-blk(lvol)는 833.55k IOPS·152.99µs였다.
- 밀도 시험은 VM당 25k IOPS 제한에 vhost 코어 6개로 4K 랜덤 읽기 QD1을 돌렸다. 24 VM에서 SPDK 291.51k, 커널 248.35k IOPS이고, 106 VM에서 SPDK 1,082.90k IOPS·97.30µs, 커널 358.64k IOPS·295.75µs다. 보고서 결론 문장은 읽기를 최대 1.17배로 적지만 106 VM 행은 약 3.0배여서 표 값을 썼다 `≈`.
- 같은 보고서의 코어 스케일링 측정 조건은 vhost 코어 1개당 VM 2대, 4K 랜덤 읽기 QD64다. 1코어 1.71M(scsi)·1.79M(blk) IOPS에서 10코어까지 거의 선형으로 15.29M에 이르고, 22코어에서는 19.32M이다.

### BM-Store 논문 (HPCA 2023)

- 베어메탈 평균 지연은 네이티브 대 BM-Store가 4K 랜덤 읽기 QD1 77.2µs 대 80.4µs, 4K 랜덤 쓰기 QD1 11.6µs 대 14.5µs다. 약 3µs가 일정하게 붙는다. 처리량은 네이티브의 96.2~101.4%(rand-w-1만 82.5%)다 `Ⓑ`.
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
