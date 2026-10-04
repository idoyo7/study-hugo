---
title: "범용 블록 스토리지를 네트워크로 — iSCSI·RBD·클라우드 볼륨"
linkTitle: "01 네트워크 블록 스토리지"
description: "iSCSI·Ceph RBD·클라우드 볼륨처럼 SCSI 계열이나 자체 프로토콜로 블록 장치를 네트워크에 싣는 방식과, 그 장치를 VM에 붙이는 virtio 경로를 다룹니다. 요청 하나에 더해지는 시간을 공개 논문과 벤치마크의 실측으로 정리했습니다."
weight: 1
date: 2026-10-04
lastmod: 2026-10-04
---

# 01 · 범용 블록 스토리지를 네트워크로 — iSCSI·RBD·클라우드 볼륨

{{< callout type="info" >}}
- **Linux 소프트웨어 iSCSI는 세션 하나에 하드웨어 큐 하나와 TCP 연결 하나가 기본이다** — 스펙은 세션당 연결 여러 개를 허용하므로 프로토콜의 한계가 아니라 구현의 성질이다 `✓` `≈`.
- **같은 4KB QD1 읽기가 로컬 NVMe(SPDK) 78µs, iSCSI 211µs** — 10GbE에서 잰 ReFlex(ASPLOS'17) 실측이다. 쓰기는 11µs 대 155µs로 비율이 더 벌어진다 `Ⓑ`.
- **VM 안의 virtio-blk 기본 경로는 QD1 읽기에서 베어메탈 IOPS의 28%에 그친다** — IOThread를 붙이면 59%까지 오른다 `Ⓑ` `≈`.
- **클라우드 볼륨은 게스트에 NVMe 장치로 보이지만 뒤는 네트워크다** — AWS 문서는 io2 Block Express의 전송(SRD)과 설계 목표까지만 적고, 카드 안 경로와 오버헤드 수치는 공개하지 않는다 `✓` `Ⓥ`.
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

NVMe SSD가 여러 장 꽂힌 서버의 용량을 다른 호스트와 VM이 쓰려면, 그쪽에서 만든 블록 요청이 네트워크를 건너 서버의 장치까지 가야 합니다. 어떤 프로토콜에 싣느냐에 따라 경로에 끼는 소프트웨어 계층과 큐 구조가 달라지고, 요청 하나에 더해지는 시간도 달라집니다. 장치가 빨라질수록 이 몫은 눈에 띕니다. KVM Forum 2020 발표에는 같은 소프트웨어 오버헤드가 100µs짜리 디스크에서는 5%, 15µs짜리 디스크에서는 33%가 된다는 도식이 있습니다 `Ⓥ`.

이 글은 블록 명령을 SCSI 계열이나 자체 프로토콜로 바꿔 싣는 방식(iSCSI·NBD·Ceph RBD·클라우드 볼륨)과, 그렇게 얻은 블록 장치를 VM에 붙이는 virtio 경로를 다룹니다. NVMe 명령을 변환 없이 보내는 방식은 [02 NVMe-oF]({{< relref "../02-nvme-of/index.md" >}})로 넘깁니다. 장치·커널·블록 크기·큐 깊이는 자료마다 달라서, 수치는 같은 자료 안에서만 견주고 조건을 함께 적었습니다.

## 1. I/O 한 번이 지나는 길

{{< flow src="_flow/1-iscsi-읽기-경로.json" />}}

이 순서는 RFC 7143, open-iscsi README, LIO 문서의 사실을 이어 붙인 것으로, 한 문서가 이 그림 그대로 그린 경로는 아닙니다 `≈`. 시간이 새는 자리는 두 논문이 각자 짚습니다. ReFlex(ASPLOS'17)는 iSCSI 지연의 원인을 "클라이언트와 서버 양쪽에서 소켓·SCSI·애플리케이션 버퍼 사이의 데이터 복사를 동반하는 무거운 프로토콜 처리"로 설명합니다. i10(NSDI'20)은 당시 Linux iSCSI 구현이 TSO/GRO를 충분히 쓰지 못하고 TCP/IP 처리 전용 커널 스레드를 따로 돌려 CPU를 비효율적으로 쓴다고 봅니다 `Ⓑ`.

NVMe-oF는 이 그림에서 SCSI 중간 계층과 iSCSI 자리를 NVMe 드라이버와 전송 계층으로 바꿉니다. Guz 외(SYSTOR'17)는 그 이점을 "경로에서 프로토콜 변환을 없앤다"고 설명합니다 `Ⓥ`.

## 2. iSCSI — SCSI 명령을 TCP에 싣는다

iSCSI는 SCSI 명령을 TCP 위에서 나르는 전송 프로토콜입니다. RFC 7143(2014-04)이 RFC 3720 등 앞선 문서를 통합했습니다. SCSI 계층이 만든 CDB를 iSCSI 계층이 PDU로 감싸 하나 이상의 TCP 연결(포트 3260)로 주고받으며, 기본 헤더(BHS)는 48바이트 고정입니다 `✓`. initiator와 target은 `iqn.2006-04.com.example:444` 꼴의 IQN으로 식별하고, target 안의 장치는 LUN, 접근 제어는 TPG·ACL로 나눕니다 `✓`.

세션은 SCSI I_T nexus와 같은 것이고 명령 번호 CmdSN은 세션 전체에서 매깁니다. 한 연결 안에서는 CmdSN 순서대로 보내야 합니다. 스펙은 MaxConnections 키로 세션 하나에 연결 여러 개(MC/S)를 두는 것도 허용합니다 `✓`. 쓰기 데이터를 언제 보낼지는 R2T(Ready To Transfer)와 ImmediateData·InitialR2T·FirstBurstLength·MaxBurstLength 협상 키가 정하고, HeaderDigest·DataDigest(CRC32C)는 선택입니다 `✓`.

Linux에서는 스펙이 허용하는 것과 구현이 하는 것이 갈립니다. initiator는 open-iscsi(유저스페이스 iscsid·iscsiadm과 커널 iscsi_tcp)이고, README는 "iscsi_tcp와 iser 같은 소프트웨어 iSCSI는 세션마다 scsi_host를 하나 할당하고 세션당 연결을 하나만 쓴다"고 적습니다 `✓`. 커널 `iscsi_tcp.c`의 host template에는 `nr_hw_queues` 설정이 없고 SCSI 코어는 미설정이면 1로 두므로, 세션 하나가 하드웨어 큐 하나와 TCP 연결 하나를 쓰는 것이 기본 형태입니다 `≈`. scsi-mq는 4.19에서 기본이 되고 5.0에서 non-mq 코드가 사라졌지만 `✓`, master 소스(2026-10 시점)에서도 iscsi_tcp는 하드웨어 큐 수를 따로 정하지 않습니다. 반대편에서 Linux NVMe/TCP host는 기본으로 온라인 CPU 수만큼 I/O 큐를 만들고 큐마다 TCP 연결을 엽니다 `✓`. 이 차이는 [02]({{< relref "../02-nvme-of/index.md" >}})에서 다시 나옵니다.

타깃은 커널의 LIO이고 `targetcli`로 설정합니다. backstore는 fileio·block·pscsi·ramdisk 네 종류이며, block은 로컬 블록 장치를 통째로 LUN으로 내보냅니다. 순서는 `/backstores/block`에서 `create name=block_backend dev=/dev/sdb`, `/iscsi`에서 IQN 생성, `luns/`에서 backstore를 LUN에 연결하는 것입니다 `✓`. iSER(RFC 7145, 2014-04)는 같은 iSCSI를 RDMA(iWARP, InfiniBand RC) 위에 얹고 RDMA Read/Write로 데이터를 SCSI I/O 버퍼에 중간 복사 없이 놓습니다 `✓`. 세션당 scsi_host와 연결이 하나라는 구조는 iscsi_tcp와 같습니다. 이 글의 자료에는 iSER 실측이 없습니다.

## 3. 같은 자리의 다른 선택지

| 방식 | 네트워크에 싣는 것 | 구현 | 근거 |
|---|---|---|---|
| FC · FCoE | 전용 패브릭(FC)이나 이더넷(FCoE) 위의 SCSI | FC는 NVMe 명령도 싣는 NVMe-oF 전송의 하나 `✓` | FCP·FCoE 1차 표준 문서는 미확인 `?` |
| NBD | 블록 읽기 요청마다 TCP로 서버에 보내고 읽은 데이터를 돌려받음 | 커널 모듈은 클라이언트에만 있고 nbd-server는 전부 유저스페이스 `✓` | 커널 문서 |
| Ceph RBD | 이미지를 RADOS 객체(기본 4M, 4K~32M)로 쪼개 여러 OSD에 분산 | 클라이언트는 커널 모듈 krbd 또는 librbd `✓` | 공식 문서와 rbd(8) |

RBD는 iSCSI·NVMe-oF와 층이 다릅니다. 이 둘은 서버 한 대의 블록 장치를 그대로 내보내지만, RBD는 이미지를 객체로 쪼개 배치하는 분산 스토리지가 블록 장치의 모양을 하고 있습니다. 경로에 블록-객체 매핑, CRUSH 배치, OSD 복제가 더해지는 셈인데 `≈`, primary OSD가 복제본에 쓰고 응답을 모으는 흐름은 공식 문서에서 확인하지 못했습니다 `?`. RBD 이미지를 NVMe/TCP 타깃으로 내보내는 Ceph NVMe-oF gateway도 있고 `✓`, 그쪽은 [02]({{< relref "../02-nvme-of/index.md" >}})에서 봅니다.

## 4. 클라우드 볼륨 — 게스트에는 NVMe, 뒤는 네트워크

AWS 문서는 EBS 볼륨이 Nitro 기반 인스턴스에서 NVMe 블록 장치(`/dev/nvme1n1` 등)로 노출된다고 적습니다 `✓`. 게스트가 보는 인터페이스가 NVMe라는 말이지, 네트워크 구간이 NVMe-oF라는 말은 아닙니다. 그 사이에는 Nitro Card가 있습니다. 카드는 PCIe로 호스트에 붙어 "NVMe for block storage (EBS and instance store)" 인터페이스를 내놓고, Nitro Hypervisor 구성에서는 카드의 PCIe function을 SR-IOV VF로 나눠 VM에 직접 배정합니다. EBS 암호화도 카드의 오프로드 엔진이 맡습니다 `✓`.

io2 Block Express는 전송 계층이 문서에 적혀 있습니다. Block Express 서버는 Scalable Reliable Datagram(SRD) 프로토콜로 Nitro 기반 인스턴스와 통신하고, 이 인터페이스는 EBS I/O 전용 Nitro Card에 구현된다고 합니다 `✓`. AWS가 RoCE 대신 SRD를 만든 이유로 논문이 드는 것은 RoCEv2가 PFC를 요구하는데 대규모 네트워크에서는 쓰기 어렵고, PFC가 있어도 ECMP 충돌을 겪는다는 점입니다. SRD는 패킷을 다중 경로로 뿌리고 순서를 보장하지 않는 신뢰 전송입니다 `Ⓥ`. gp3가 SRD를 쓰는지는 문서에서 확인하지 못했고, SRD 논문 본문에는 EBS 언급이 없었습니다 `?`.

아래는 AWS 문서의 상한과 설계 목표이며 측정값이 아닙니다 `✓`.

| 볼륨 | 지연 서술 | IOPS | 처리량 | 프로비저닝 성능 제공 시간 |
|---|---|---|---|---|
| gp3 | single-digit millisecond | 기본 3,000, 최대 80,000 | 기본 125 MiB/s, 최대 2,000 MiB/s | 99% |
| io2 Block Express | 16KiB I/O 평균 500µs 미만, 800µs 초과 I/O 빈도는 General Purpose 대비 10배 이상 줄임 | 최대 256,000(Nitro 인스턴스) | 최대 4,000 MiB/s | 99.9% |

Azure Ultra Disk는 최대 400,000 IOPS·10,000 MB/s에 "일관되게 낮은 서브밀리초 지연"을, GCP Hyperdisk Extreme은 볼륨당 최대 350,000 IOPS·5,000 MiB/s에 서브밀리초 지연을 목표로 설계했다고 밝힙니다 `✓`. Azure는 자사 논문 초록에서 컴퓨트와 스토리지 사이, 스토리지 클러스터 내부 모두에 RDMA를 배치했고 Azure 트래픽의 약 70%가 RDMA라고 주장합니다 `Ⓥ`.

반대로 AWS는 Nitro Card와 EBS 서버 사이 프로토콜(io2 Block Express 외 볼륨), 카드 안 데이터 경로, 가상화 오버헤드 수치를 공개하지 않고 "성능에 실질적인 영향이 없다"는 수준으로만 서술합니다 `Ⓥ`. 그래서 클라우드 볼륨의 요청당 시간은 문서가 약속하는 상한과 설계 목표까지만 알 수 있습니다.

## 5. VM에 붙이는 경로 — virtio-blk·virtio-scsi·vhost

호스트가 블록 장치를 어디서 얻었든, VM에는 에뮬레이트한 장치로 내줍니다. virtio-blk는 블록 장치 하나를, virtio-scsi는 가상 SCSI 컨트롤러를 게스트에 보여줍니다. QEMU의 virtio-blk는 장치 하나를 스레드 하나가 에뮬레이트하고, 그 장치의 virtqueue를 전부 그 스레드가 처리합니다. virtqueue 요청 파싱, qcow2 같은 이미지 포맷과 블록 계층 기능, Linux AIO나 io_uring 제출·완료, 응답 작성, 게스트에 완료 인터럽트를 넣는 일까지 한 스레드의 몫입니다 `✓`. vCPU마다 virtqueue를 두는 multi-queue(QEMU 5.2부터 기본 num-queues=num-vcpus)는 게스트 쪽 제출 경합을 없애지만, 호스트 쪽이 단일 스레드라 SMP 확장성 문제가 남습니다 `✓`.

이를 바꾸는 것이 IOThread입니다. 장치 에뮬레이션과 I/O를 맡는 전용 스레드로, adaptive polling 이벤트 루프를 돌며 장치 여러 개를 한 스레드에 묶거나 CPU에 고정할 수 있습니다 `✓`. virtqueue를 IOThread 여러 개에 나눠 배정하는 iothread-vq-mapping은 QEMU 9.0에서 virtio-blk에 들어왔습니다. libvirt에서는 disk driver의 `<iothreads>`(10.0.0부터)로 설정하고 RHEL은 9.4에 들어갔으며, virtio-scsi 쪽 매핑은 libvirt 11.2.0(QEMU 10.0)부터입니다. cache='none' io='native' 구성을 전제로 설계됐고 io='threads'와는 맞지 않습니다 `✓`.

IOThread가 요청당 시간에서 얼마를 덜어내는지는 Hajnoczi의 KVM Forum 2020 발표가 QD1로 보여줍니다. 장치는 Intel Optane P4800X, 호스트 커널 5.7.7, 게스트 커널 5.5.0, QEMU 4.2.0 이상, fio pvsync2 direct 4K 랜덤 읽기이고 게스트 vCPU 수는 슬라이드에서 확정하지 못했습니다 `?`.

{{< lane src="_lane/5-virtio-blk-qd1.json" />}}

multi-queue를 더한 값은 46,876 IOPS로 IOThread만 붙였을 때와 거의 같습니다. QD1에서는 한 번에 요청 하나만 나가므로 큐를 늘려도 달라질 것이 없다고 읽습니다 `Σ`. IOPS를 요청당 시간으로 환산하면(1/IOPS) 베어메탈 12.7µs, 기본 virtio-blk 45.8µs, IOThread 21.5µs, nvme:// 18.1µs입니다 `≈`. 기본 경로가 더하는 33µs에서 IOThread가 24µs를 걷어내고, 남은 9µs에서 nvme://가 3µs를 더 줄입니다. nvme://는 QEMU 유저스페이스 NVMe 드라이버(QEMU 2.12)로, PCI 장치는 게스트 하나에 전속되지만 게스트에는 virtio-blk로 보여서 live migration과 이미지 포맷·throttling 같은 블록 계층 기능이 남습니다 `✓`. 슬라이드의 프로토타입 패치(게스트 iopoll, polled NVMe 큐, AIO fast path)를 모두 얹으면 105,752 IOPS까지 오르지만, 비교 기준인 iopoll 베어메탈이 120,005라서 격차는 남습니다 `Ⓑ`.

다른 논문도 같은 방향입니다. MDev-NVMe(USENIX ATC 2018, Optane P4800X, 호스트·게스트 커널 4.10, QEMU·SPDK 버전과 virtio의 IOThread 사용 여부는 논문에 없음 `?`)의 QD1 읽기에서 virtio는 네이티브 77,200 IOPS의 29%(22,010)였고, SPDK vhost-blk는 59%(45,691), vhost-scsi는 54%(41,451)였습니다 `Ⓑ`.

IOThread를 여러 개 쓰면 virtqueue를 병렬로 처리합니다. 아래는 Hajnoczi와 Red Hat의 2024년 측정(Optane P4800X, raw host_device, 게스트 vCPU 8개, fio libaio 4K 랜덤 읽기 numjobs=8 direct)이며 값은 막대 눈대중입니다 `≈`. 위 QD1 측정과는 큐 구성이 달라 숫자를 이어 읽지 않습니다.

| IOThread 수 | iodepth=1 (IOPS) | iodepth=64 (IOPS) |
|---|---|---|
| 1 | 약 147k | 약 238k |
| 2 | 약 235k | 약 405k |
| 4 | 약 282k | 약 505k |

슬라이드는 이를 "4 IOThreads doubles performance"로 요약합니다 `Ⓑ`. 권장 수는 4~8개입니다. 너무 적으면 드라이브를 못 채우고 너무 많으면 애플리케이션이 쓸 CPU를 뺏으며, 64KB 이상 블록이면 IOThread 하나로도 디스크가 포화될 수 있다고 합니다 `Ⓥ`. RHEL 9.4의 DB 측정(HammerDB TPC-C·Oracle, 192 vCPU VM 1대, 큐 96개, EPYC 9654 2소켓, QEMU 9.0.0)에서 IOThread 4개는 TPM을 사용자 10명일 때 +22.86%, 100명일 때 +13.82% 올렸습니다. 부하가 포화에 가깝거나 VM 밀도가 높으면 이득이 줄어듭니다 `Ⓑ`.

vhost는 데이터 경로를 QEMU 밖으로 뺍니다. 커널 vhost-scsi는 인터럽트 구동이고 vhost 타깃당 커널 스레드가 하나입니다 `✓`. SPDK vhost(vhost-user)는 QEMU가 UNIX 소켓으로 타깃을 설정하고 게스트 메모리를 hugepage로 미리 할당해 둡니다. 게스트는 공유 메모리의 virtqueue에 I/O를 직접 제출하고 그 과정에 QEMU가 끼지 않습니다. SPDK가 poll-mode라 제출 통지는 필요 없고, 완료는 eventfd 인터럽트로 알리므로 시스템 콜과 게스트 VM exit가 듭니다 `✓`. SPDK 24.05 vhost 보고서(Xeon Gold 6348 2소켓, 호스트 커널 6.1.6, QEMU 7.0.0, 게스트 커널 5.15.7, fio 3.28 libaio direct 4K)는 두 구현을 같은 조건에 놓고 쟀습니다. 드라이브 1장을 VM 2대가 나눠 쓰고 vhost 코어는 1개입니다 `Ⓑ`.

| 4K 랜덤 | SPDK vhost-scsi | 커널 vhost-scsi |
|---|---|---|
| 읽기 QD1 | 24.26k IOPS · 82.24µs | 21.68k IOPS · 92.00µs |
| 읽기 QD64 | 725.48k IOPS · 176.03µs | 356.63k IOPS · 358.92µs |
| 쓰기 QD1 | 136.78k IOPS · 14.34µs | 75.91k IOPS · 26.07µs |

읽기 QD1은 약 10µs(1.12배) 차이지만 QD64에서는 IOPS와 지연 모두 약 2배로 벌어집니다 `≈`. QD64에서 SPDK vhost-blk(lvol)는 833.55k IOPS·152.99µs였습니다. VM당 25k IOPS 제한에 vhost 코어 6개로 4K 랜덤 읽기 QD1을 돌린 밀도 시험은 106 VM에서 SPDK가 1,082.90k IOPS·97.30µs, 커널이 358.64k IOPS·295.75µs입니다. 보고서 결론 문장은 읽기를 최대 1.17배로 적지만 이 행은 약 3.0배여서 표 값을 썼습니다 `≈`. 대가는 코어와 메모리입니다. SPDK vhost는 hugepage와 폴링 전용 코어를 요구하고 `Ⓑ`, BM-Store 논문(HPCA 2023)은 Intel P4510 4장에서 네이티브의 80%를 내는 데 SPDK vhost 코어가 8개 이상 필요했다고 보고합니다(128K 순차 읽기 QD256) `Ⓑ`.

## 6. 네트워크를 건널 때 얼마나 느려지나

iSCSI를 로컬 NVMe와 견준 공개 수치로 이 글이 확인한 것은 두 논문입니다. 둘 다 2017년에 발표됐고 장치와 링크가 달라 서로 맞대지 않습니다.

ReFlex는 Xeon E5-2630(12코어, 2소켓), Intel 82599ES 10GbE에 Arista 7050S-64 스위치, Ubuntu 16.04 커널 4.4, 1M IOPS급 NVMe, jumbo frame, LRO/GRO를 끈 조건에서 4KB 랜덤 QD1 지연을 쟀습니다 `Ⓑ`.

| 구성 | 읽기 평균 / p95 | 쓰기 평균 / p95 |
|---|---|---|
| 로컬(SPDK) | 78 / 90µs | 11 / 17µs |
| iSCSI | 211 / 251µs | 155 / 215µs |
| ReFlex 서버 + IX 클라이언트 | 99 / 113µs | 31 / 34µs |

iSCSI의 읽기는 로컬보다 약 133µs 길고 `≈`, 쓰기는 로컬 11µs에 견줘 155µs여서 비율이 더 큽니다. 같은 논문에서 TCP 위에 libaio 서버만 올린 구성(Linux 클라이언트)도 읽기가 183 / 205µs여서 iSCSI와의 차이는 28µs 안팎입니다 `≈`. 저자는 10GbE TCP/IP가 소프트웨어 스토리지 스택에 닿기 전에 무부하 지연을 최소 50µs 늘린다고 적습니다 `Ⓑ`. 네트워크를 건너는 몫이 이미 크고, 그 위에 SCSI·iSCSI 처리가 얹히는 구조입니다.

Samsung의 Guz 외(SYSTOR'17)는 PM1725 3개를 단 커널 타깃에 호스트 3대를 100GbE RoCEv2로 이어 4KB 랜덤을 쟀습니다. 커널 버전은 슬라이드에 없습니다 `?`. iSCSI는 높은 IOPS 구간에서 DAS를 따라가지 못했고, DAS와 같은 성능을 내는 구간에서도 호스트 CPU 부하가 30% 더 들었으며, 슬라이드는 가벼운 부하에서도 10배 느리다고 적습니다. RocksDB(db_bench 80/20, 호스트당 3 인스턴스)에서는 처리량이 40% 줄었는데, 같은 실험에서 NVMe-oF는 DAS와 2% 차이였습니다 `Ⓑ`. 앞선 연구로 Klimovic 외(EuroSys'16)는 iSCSI 디스어그리게이션이 애플리케이션 처리량을 20% 떨어뜨린다고 보았고, ReFlex와 i10의 서론은 iSCSI가 코어당 약 70K IOPS여서 1M IOPS NVMe 하나를 채우려면 14코어가 든다고 인용합니다. 이 둘은 재인용으로만 확인했고 원 출처는 열지 못했습니다 `Ⓑ` `?`.

커널 6.x에서 iSCSI와 로컬 NVMe를 한 장비로 함께 잰 공개 자료는 찾지 못했습니다 `?`. 위 수치는 iSCSI 경로의 규모를 가늠하는 용도이고, 현행 커널의 값으로 읽을 수 없습니다.

## 7. 비용이 붙는 자리

행마다 출처와 조건이 달라 위아래로 더하지 않습니다. ReFlex의 두 행만 같은 측정이고, 둘째 행은 첫째 행에 포함된 몫입니다. 자리마다 무엇이 더해지는지와, 이 글이 수치를 얻은 곳만 적었습니다.

| 자리 | 더해지는 것 | 이 글의 수치 | 근거 |
|---|---|---|---|
| VM 에뮬레이션 | virtqueue 파싱, 이미지·블록 계층, 완료 인터럽트를 스레드 하나가 처리 | QD1 요청당 기본 +33µs, IOThread 적용 시 +9µs | KVM Forum 2020 `Ⓑ` `≈` |
| iSCSI 경로 전체 | CDB-PDU 변환, 소켓·SCSI·애플리케이션 버퍼 사이 복사, TCP/IP 처리 | 4KB QD1 읽기 로컬(SPDK) 78µs → iSCSI 211µs | ReFlex ASPLOS'17 `Ⓑ` |
| 그중 네트워크 | 10GbE TCP/IP | 무부하 지연 최소 +50µs | ReFlex ASPLOS'17 `Ⓑ` |
| 호스트 CPU | iSCSI 처리 | DAS와 같은 성능 구간에서 부하 +30% | Guz SYSTOR'17 `Ⓑ` |
| 분산 스토리지(RBD) | 객체 매핑·배치·복제 | 수치 없음 | `?` |
| 클라우드 볼륨 | Nitro Card, io2 Block Express는 SRD | 설계 목표만(io2 Block Express 16KiB 평균 500µs 미만) | AWS 문서 `✓` |

iSCSI 경로에서 늘어나는 시간에는 네트워크를 건너는 몫과 SCSI·iSCSI 처리(명령 변환과 복사)가 함께 들어 있습니다. 장치가 NVMe일 때 그 변환을 없애는 쪽이 [02 NVMe-oF]({{< relref "../02-nvme-of/index.md" >}})입니다. 02는 TCP·RDMA 전송, 타깃 구현, VM 전달 방식을 이어서 보고 마지막에 두 글의 방식을 한 표로 모읍니다.

## 참고 자료

- [RFC 7143 iSCSI Protocol (Consolidated)](https://www.rfc-editor.org/rfc/rfc7143.txt) — IETF, 2014. iSCSI 구조·세션·CmdSN·다이제스트
- [RFC 7145 iSER](https://www.rfc-editor.org/rfc/rfc7145.html) — IETF, 2014. iSER 구조
- [open-iscsi README](https://raw.githubusercontent.com/open-iscsi/open-iscsi/master/README) — open-iscsi, 현행. 세션당 scsi_host·연결 1개
- [Linux scsi_lib.c](https://raw.githubusercontent.com/torvalds/linux/master/drivers/scsi/scsi_lib.c) · [iscsi_tcp.c](https://raw.githubusercontent.com/torvalds/linux/master/drivers/scsi/iscsi_tcp.c) · [nvme/host/fabrics.c](https://raw.githubusercontent.com/torvalds/linux/master/drivers/nvme/host/fabrics.c) — torvalds/linux master. 하드웨어 큐 수 기본값, NVMe/TCP의 CPU 수만큼 I/O 큐
- [Linux 4.19](https://kernelnewbies.org/Linux_4.19) · [Linux 5.0](https://kernelnewbies.org/Linux_5.0) — kernelnewbies. scsi-mq 기본화, non-mq 코드 제거
- [Configuring an iSCSI target](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_storage_devices/configuring-an-iscsi-target_managing-storage-devices) — Red Hat, RHEL 9. LIO·targetcli·backstore 종류와 설정 순서
- [Network Block Device](https://docs.kernel.org/admin-guide/blockdev/nbd.html) — Linux 커널 문서. NBD 구조
- [Ceph Block Device](https://docs.ceph.com/en/latest/rbd/) · [rbd(8)](https://docs.ceph.com/en/latest/man/8/rbd/) — Ceph 문서. RBD 객체 분산, 기본 객체 크기
- [Ceph NVMe-oF Gateway](https://docs.ceph.com/en/latest/rbd/nvmeof-overview/) — Ceph 문서. RBD 이미지를 NVMe/TCP로 내보내는 gateway
- [NVM Express announces the re-architected NVMe 2.0 library](https://nvmexpress.org/nvm-express-announces-the-rearchitected-nvme-2-0-library-of-specifications/) — NVM Express, 2021. FC가 NVMe 전송의 하나라는 근거
- [Amazon EBS volumes and NVMe](https://docs.aws.amazon.com/ebs/latest/userguide/nvme-ebs-volumes.html) · [The Security Design of the AWS Nitro System](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/the-components-of-the-nitro-system.html) — AWS. EBS의 NVMe 노출, Nitro Card·SR-IOV·암호화 오프로드
- [Amazon EBS Provisioned IOPS SSD volumes](https://docs.aws.amazon.com/ebs/latest/userguide/provisioned-iops.html) · [General Purpose SSD volumes](https://docs.aws.amazon.com/ebs/latest/userguide/general-purpose.html) — AWS. io2 Block Express의 SRD와 설계 목표, gp3 상한
- [A Cloud-Optimized Transport Protocol for Elastic and Scalable HPC](https://assets.amazon.science/a6/34/41496f64421faafa1cbe301c007c/a-cloud-optimized-transport-protocol-for-elastic-and-scalable-hpc.pdf) — Shalev 외, IEEE Micro 2020. RoCE 대신 SRD를 만든 이유
- [Select a disk type for Azure IaaS VMs](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-types) — Microsoft, 2026-09 갱신. Ultra Disk 상한
- [Empowering Azure Storage with RDMA](https://www.usenix.org/conference/nsdi23/presentation/bai) — Bai 외, NSDI'23. Azure의 RDMA 배치와 트래픽 비중
- [About Hyperdisk Extreme](https://docs.cloud.google.com/compute/docs/disks/hd-types/hyperdisk-extreme) — Google Cloud 문서. Hyperdisk Extreme 상한
- [The 10 Microsecond Challenge: Optimizing for NVMe Drives](https://vmsplice.net/~stefan/stefanha-kvm-forum-2020.pdf) — Stefan Hajnoczi, KVM Forum 2020. 오버헤드 비중 도식, IOThread·nvme://, QD1 실측
- [Improving virtio-blk SMP scalability in QEMU](https://vmsplice.net/~stefan/stefanha-kvm-forum-2024.pdf) — Stefan Hajnoczi, KVM Forum 2024. virtio-blk 스레드 구조, iothread-vq-mapping, IOThread 수 측정
- [Scaling virtio-blk disk I/O with IOThread Virtqueue Mapping](https://developers.redhat.com/articles/2024/09/05/scaling-virtio-blk-disk-io-iothread-virtqueue-mapping) — Red Hat Developer, 2024-09-05. RHEL 9.4 편입, 측정 조건
- [Virtualized database I/O performance improvements in RHEL 9.4](https://developers.redhat.com/articles/2024/09/10/virtualized-database-io-performance-improvements-rhel-94) — Sanjay Rao·Stefan Hajnoczi, Red Hat Developer, 2024-09-10. DB 워크로드 측정
- [Domain XML format](https://libvirt.org/formatdomain.html) — libvirt. iothreads 매핑의 libvirt·QEMU 버전
- [SPDK Vhost Performance Report 24.05](https://review.spdk.io/download/performance-reports/SPDK_vhost_perf_report_2405.pdf) — Intel, 2024-07. SPDK vhost 대 커널 vhost-scsi 실측, 커널 vhost-scsi 구조
- [Virtualized I/O with Vhost-user](https://spdk.io/doc/vhost_processing.html) — SPDK 문서. vhost-user 경로
- [MDev-NVMe](https://www.usenix.org/system/files/conference/atc18/atc18-peng.pdf) — Peng 외, USENIX ATC 2018. QD1 읽기에서 virtio·vhost 비교, hugepage 부담
- [BM-Store](https://shuibing9420.github.io/assets/pdf/BM-Store_A_Transparent_and_High-performance_Local_Storage_Architecture_for_Bare-metal_Clouds_Enabling_Large-scale_Deployment.pdf) — Chen 외, HPCA 2023. SPDK vhost의 코어 소모
- [ReFlex: Remote Flash ≈ Local Flash](https://people.ucsc.edu/~hlitz/papers/reflex.pdf) — Klimovic·Litz·Kozyrakis, ASPLOS'17. 로컬 대 iSCSI 지연, iSCSI 지연 원인
- [NVMe-over-Fabrics Performance Characterization and the Path to Low-Overhead Flash Disaggregation](https://www.systor.org/2017/slides/NVMe-over-Fabrics_Performance_Characterization.pdf) — Guz 외, SYSTOR'17 슬라이드. iSCSI 처리량·CPU·지연·RocksDB, Klimovic 재인용은 [논문 초록](https://dl.acm.org/doi/10.1145/3078468.3078483)
- [TCP ≈ RDMA: CPU-efficient Remote Storage Access with i10](https://www.usenix.org/system/files/nsdi20-paper-hwang.pdf) — Hwang 외, NSDI'20. 커널 iSCSI의 CPU 비효율
