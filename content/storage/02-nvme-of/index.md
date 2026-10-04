---
title: "NVMe-oF — NVMe 장치를 TCP·RDMA로 내보내기"
linkTitle: "02 NVMe-oF"
description: "NVMe 명령을 변환 없이 TCP·RDMA로 실어 나르는 NVMe-oF의 구조, 타깃 구현의 비용, NVMe 장치를 호스트와 VM에 내주는 방식을 측정 조건과 함께 비교합니다."
weight: 2
date: 2026-10-04
lastmod: 2026-10-04
---

# 02 · NVMe-oF — NVMe 장치를 TCP·RDMA로 내보내기

{{< callout type="info" >}}
- NVMe-oF는 NVMe 명령을 capsule에 담아 그대로 보내므로 SCSI 변환 층이 없다 `Ⓥ`. I/O 큐 쌍 하나가 TCP 연결 하나(RDMA에서는 QP 하나)에 대응한다 `✓`.
- 같은 랩의 보고서 두 편에서 미디어 지연을 뺀 QD1 왕복은 커널 스택끼리 TCP 21.39µs, RDMA 12.10µs였고, 타깃과 initiator를 모두 SPDK로 바꾸면 17.50µs와 4.72µs가 됐다 `Ⓑ` `≈`.
- 타깃 구현은 연결 수에 따라 갈린다. 연결이 많으면 SPDK의 코어당 IOPS가 높았고, 연결이 하나이면 커널 nvmet이 더 효율적이었다 `Ⓑ`.
- VM에 내주는 방식(passthrough, vhost, mediated passthrough, DPU 에뮬레이션)은 자료마다 장치·조건·보고 단위가 달라 방식끼리 순위를 매기지 않는다 `Σ`. 한 논문 안에서는 QD1 4KB 읽기에서 vhost와 FPGA 에뮬레이션이 passthrough에 3~4µs를 더했다 `Ⓑ` `≈`.
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

[01 네트워크 블록 스토리지]({{< relref "../01-network-block/index.md" >}})에서 본 방식은 모두 NVMe SSD 위에 한 겹을 더 얹습니다. iSCSI는 SSD 앞에서 명령을 SCSI로 바꿔 TCP에 싣고, Ceph RBD는 블록을 객체로 쪼개 클러스터에 흩뿌립니다. NVMe-oF(NVMe over Fabrics)는 이 변환을 걷어냅니다. 호스트 NVMe 드라이버가 만든 명령이 그대로 네트워크를 건너고, 타깃은 받은 명령을 NVMe 장치나 그 뒤의 블록 장치에 넘깁니다. Samsung 연구진의 SYSTOR'17 발표는 이 이점을 "I/O 경로의 프로토콜 변환 제거"와 "NVMe 다중 큐 쌍 설계의 확장"으로 요약합니다 `Ⓥ`.

연혁은 짧습니다. NVMe-oF 1.0이 2016년 6월에 나왔고 Linux 4.8(2016-10)에 RDMA용 host와 target이 들어갔습니다. TCP 전송은 2018년 11월에 비준 소식이 공개됐으며 Linux 5.0(2019-03)에 host와 target이 한 릴리스로 들어갔습니다 `✓`. 1.1a(2021) 이후 NVMe-oF 스펙은 따로 개정되지 않고 NVMe 2.0 Base 스펙으로 흡수됐고, TCP 전송 스펙은 2025년 개정 1.2까지 확인했습니다 `✓`.

## 1. NVMe 명령을 그대로 보낸다

타깃이 내놓는 단위는 NVM subsystem이고 NQN으로 식별합니다. subsystem은 port로 노출되며 그 안에 namespace와 controller를 둡니다. 호스트가 controller의 Admin Queue에 연결하면 association이 생기고, 유지되는 동안에는 그 호스트만 해당 controller에 연결을 맺을 수 있습니다 `✓`. 어떤 subsystem이 있는지는 Discovery controller가 알려 주는데, 이 controller는 Discovery Log만 낼 뿐 I/O 큐도 namespace도 갖지 않습니다 `✓`.

명령은 capsule에 담겨 오갑니다. command capsule은 64바이트 이상의 SQE에 데이터나 SGL이 붙는 형태이고 response capsule은 16바이트 CQE입니다 `✓`. capsule 밖의 데이터를 옮기는 방법은 전송이 정합니다. PCIe는 메모리를 직접 읽고 쓰는 memory 모델, TCP와 FC는 capsule만 주고받는 message 모델, RDMA는 capsule에 원격 메모리 읽기·쓰기를 섞는 모델입니다 `✓`.

{{< flow src="_flow/1-nvme-명령-경로.json" />}}

이 구조에서 눈여겨볼 성질은 큐와 연결이 1:1이라는 점입니다. NVMe/TCP 연결 하나는 Admin 또는 I/O 큐 쌍 하나에 대응하며, 연결 하나에 큐 여럿을 다중화하거나 큐 하나를 연결 여럿에 걸치는 구성은 스펙이 지원하지 않습니다 `✓`. RDMA에서는 I/O 큐 쌍 하나가 RDMA QP 하나에 대응합니다 `✓`. Linux host는 기본으로 online CPU 수만큼 I/O 큐를 만들고(큐 크기 기본 128, 범위 16~1024) 연결도 그만큼 열립니다. nvme-tcp는 큐마다 CPU를 하나씩 정해 그 CPU의 워크큐에서 소켓 송수신을 돌립니다 `✓`. Linux 소프트웨어 iSCSI가 세션 하나에 연결 하나, 하드웨어 큐 하나로 시작하는 것과 대비됩니다 `≈`.

쓰기 데이터가 가는 길은 크기가 가릅니다. in-capsule 데이터는 I/O 명령에서 선택 기능이고 Fabrics·Admin 명령만 8,192바이트까지 필수입니다 `✓`. Linux 구현에서는 8KB 이하 쓰기가 capsule에 실리고 그보다 크면 컨트롤러가 R2T를 보낸 뒤에야 호스트가 데이터를 보낸다는 그림이 ntprof 논문에 있습니다 `Ⓑ`. RDMA에서는 읽기 데이터를 컨트롤러가 RDMA_WRITE로 호스트 버퍼에 밀어 넣고 쓰기 데이터는 RDMA_READ로 가져오거나 in-capsule로 받습니다. RDMA_WRITE와 RDMA_READ 모두 컨트롤러가 시작합니다 `✓`. 헤더·데이터 다이제스트(CRC32C)는 연결을 맺을 때 양쪽이 켜야 동작하는 선택 기능입니다 `✓`.

같은 namespace로 가는 경로가 여럿이면 Linux는 이를 블록 장치 하나로 묶습니다. 정책은 numa(기본)·round-robin·queue-depth이고 어느 쪽이든 ANA에서 optimized인 경로를 먼저 씁니다 `✓`. 멀티패스는 4.15, ANA는 4.19에 들어갔습니다 `✓`.

## 2. 가상 NVMe 장치를 프로비저닝한다는 것

"가상 NVMe 장치를 만든다"는 말은 새 SSD를 만든다는 뜻이 아닙니다. 타깃 쪽 블록 장치 하나에 namespace 번호를 붙여 subsystem에 넣고, 그 subsystem을 포트로 열어 두는 일입니다. namespace 하나는 SPDK bdev 계층이 내놓는 블록 장치 하나에 대응하고, bdev는 물리 NVMe일 수도 그 위에 쌓은 가상 bdev일 수도 있습니다 `✓`. 순서는 이렇습니다.

```
# 스토리지 서버 (SPDK 타깃)
bdev_lvol_create_lvstore <bdev> <lvs>
bdev_lvol_create -l <lvs> [-t] <name> <size>
nvmf_create_transport -t TCP
nvmf_create_subsystem nqn.2016-06.io.spdk:cnode1 -a -s <serial>
nvmf_subsystem_add_ns <nqn> <bdev>
nvmf_subsystem_add_listener <nqn> -t tcp -a <ip> -s 4420

# 호스트
modprobe nvme-tcp
nvme discover -t tcp -a <ip> -s 4420
nvme connect -t tcp -n <nqn> -a <ip> -s 4420
```

호스트는 `nvme discover`와 `nvme connect` 대신 `nvme connect-all`을 쓸 수도 있습니다 `✓`. 커널 nvmet은 같은 구조를 configfs에 만듭니다. subsystem을 만들고, namespace의 device path에 블록 장치를 적어 enable하고, port를 만든 뒤 port에 subsystem을 연결하는 순서입니다 `✓`. LVM 논리 볼륨의 경로도 블록 장치 경로이니 그 자리에 들어갑니다. 이 대입을 직접 다룬 문서는 확인하지 못했습니다 `≈`.

연결이 끝나면 호스트에 `/dev/nvmeXnY` 블록 장치가 생깁니다. 호스트가 보는 NVMe controller는 물리 SSD의 것이 아니라 타깃 소프트웨어가 구현한 것이고, 그 뒤 namespace는 LV·lvol·파일 등 어떤 블록 장치든 될 수 있습니다 `≈`. `nvme list`의 모델 칸에도 타깃 소프트웨어가 보고하는 값이 나옵니다 `≈`.

용량을 나눠 주는 일은 결국 namespace 뒤의 논리 볼륨이 맡습니다. SPDK lvol은 lvolstore(blobstore 위)에 만들며 lvol 하나가 blob 하나입니다. 기본 cluster는 4MiB이고, 씬 프로비저닝을 켠 lvol은 첫 쓰기가 닿을 때 cluster를 할당하며, snapshot은 읽기 전용이고 clone은 snapshot에서 만듭니다 `✓`. 이 계층이 요청마다 더하는 비용은 4절에서 봅니다.

## 3. 전송별 차이 — TCP·RDMA·FC

| 전송 | 데이터 교환 모델 | 큐와 연결 | 비용이 붙는 곳과 확인 상태 |
|---|---|---|---|
| TCP | message. capsule만 주고받는다 | 큐 쌍 1개 = TCP 연결 1개 | 작은 PDU마다 TCP/IP 처리, 호스트의 스레드 간 컨텍스트 스위치, 데이터 복사와 CRC `Ⓑ`. 기존 소켓 인터페이스를 쓰는 소프트웨어 구현을 허용하도록 정의됐다 `✓` |
| RDMA | message/memory. capsule에 원격 메모리 읽기·쓰기를 섞는다 | 큐 쌍 1개 = RDMA QP 1개 | iWARP·InfiniBand·RoCE 위에서 Reliable Connected QP를 쓴다 `✓`. RoCEv2가 PFC를 요구한다는 서술은 AWS SRD 논문에서만 직접 확인했다 `Ⓥ` |
| FC | message | 확인하지 못함 `?` | NVMe 2.0 전송 스펙 목록에 들어 있다 `✓`. 동작과 성능은 벤더 비교 자료만 확인했고, nvme-fc가 들어간 커널 버전은 확인하지 못했다 `?` |

같은 랩에서 나온 SPDK 24.05 보고서 두 편을 나란히 놓으면 전송 차이가 드러납니다. 타깃 1코어에 null 블록 장치로 미디어 지연을 뺀 QD1 4KiB 랜덤 읽기입니다.

{{< lane src="_lane/3-전송별-왕복-지연.json" />}}

커널 스택끼리 비교하면 TCP가 21.39µs, RDMA가 12.10µs입니다. target과 initiator를 모두 SPDK로 바꾸면 TCP는 17.50µs로 약 18%, RDMA는 4.72µs로 약 61% 줄어듭니다 `≈`. SPDK의 TCP 전송도 커널 TCP 스택 위에서 돌기 때문에 소켓 비용이 그대로 남고 `✓`, RDMA 경로에는 그 계층이 없어 구현 차이가 지연 차이로 곧장 나오는 것으로 읽습니다 `Σ`. TCP QD1에서 "SPDK가 더 빠르다"는 말은 4µs 차이를 뜻합니다.

코어당 처리량은 i10 논문(NSDI'20)이 커널 4.20, ConnectX-5 100Gbps 직결, Samsung PM1725a, 4KB 랜덤 읽기 QD128 조건에서 쟀습니다. 네트워크 스택 단독으로는 코어당 약 30Gbps(≈915K IOPS), 로컬 스토리지 스택 단독으로는 약 350K IOPS인데 둘을 합친 커널 NVMe/TCP는 96K IOPS였습니다 `Ⓑ`. 병목이 두 스택 각각이 아니라 둘의 경계에 있다는 것이 저자들의 주장입니다. SSD 하나를 포화시키는 데 로컬은 3코어, NVMe/RDMA는 4코어, NVMe/TCP는 그 2.5배(약 10코어 `≈`)가 필요했고, 랜덤 쓰기에서는 RDMA 3코어 대 TCP 6코어였습니다 `Ⓑ`.

지연이 쌓이는 자리는 세 논문이 나눠 보여 줍니다. ntprof(NSDI'25; 커널 5.15.143, ConnectX-6 100GbE, MTU 9KB, fio libaio job 1개)는 4K 랜덤 읽기에서 iodepth를 1에서 32로 올리면 양쪽 네트워크 단계의 시간이 14.3µs에서 127.0µs로 늘어 전체 지연의 92.2%가 된다고 보고합니다 `Ⓑ`. i10은 원인으로 호스트가 보낸 패킷의 약 80%가 72바이트짜리 요청 PDU라 TSO 이득이 없다는 점, 호스트에서 커널 스레드 셋(blk-mq, 송신, 수신)이 요청마다 개입해 컨텍스트 스위치가 1~3µs씩 든다는 점을 듭니다 `Ⓑ`. 데이터 쪽 비용은 복사와 CRC입니다. Autonomous NIC Offloads(ASPLOS'21; 커널 5.6.0, ConnectX-6 Dx에서 NVMe-TCP 오프로드를 에뮬레이션)는 CPU의 CRC32 명령을 쓰고도 복사와 CRC가 NVMe-TCP 메시지 처리 사이클의 최대 49%를 차지한다고 적습니다 `Ⓑ`.

iSCSI와의 직접 비교는 벤더 자료가 많습니다. Blockbridge(Proxmox 7.2, 커널 5.15.53, EPYC 7452, ConnectX-5 100GbE, VM 32대, 자사 백엔드)는 NVMe/TCP가 iSCSI보다 512B 평균 IOPS가 35.4% 높고 4K QD4에서 IOPS 50% 이상, 지연 33% 낮다고 보고하지만, 대역폭이 한계인 큰 블록에서는 차이가 약 0.1%입니다 `Ⓥ`. Dell PowerStore(ESXi, 기본 설정; 발행 연도 미확인)는 iSCSI의 IOPS가 가장 낮고 지연과 IO당 CPU가 가장 높으며, NVMe/TCP@25GbE가 쓰기에서 NVMe/FC·FCP@32GFC와 비슷하고 읽기에서 20% 이내로 뒤진다고 적습니다 `Ⓥ`.

## 4. 타깃 구현 — 커널 nvmet과 SPDK nvmf

Linux 커널 nvmet은 RDMA가 4.8, TCP가 5.0부터 있고 configfs나 nvmetcli로 설정합니다. 구조는 ports(adrfam·traddr·trsvcid·trtype), subsystems(nqn, allowed_hosts), namespaces(device.path, nsid)입니다 `✓`. RHEL 9 문서가 host 쪽 NVMe/TCP만 지원 대상으로 다루고 nvmet은 지원하지 않는다고 적었다는 서술은 요약본으로만 봤고 원문은 확인하지 못했습니다 `?`. SPDK nvmf는 유저스페이스 애플리케이션으로, polled-mode NVMe 드라이버로 I/O를 내고 연결을 코어에 고정하며 시작할 때 정한 코어를 계속 폴링합니다. dynamic scheduler와 interrupt mode가 추가돼 유휴 코어를 줄일 수 있습니다 `✓`.

두 구현을 한 장비에서 비교한 값은 SPDK 24.05 TCP 보고서에 있습니다. 타깃은 Xeon Gold 6348 2소켓, 커널 6.0.18, Kioxia KCM61VUL3T20 14개, 100GbE ConnectX-5 4장 직결이고, 4KiB 랜덤 읽기 QD384, subsystem 14개, 커널 initiator입니다. SPDK 타깃은 24코어로 묶었고 커널 타깃에는 코어 제한을 걸지 않았습니다.

| subsystem당 연결 | 타깃 | IOPS | 사용 코어 | 코어당 IOPS |
|---|---|---|---|---|
| 8 | 커널 nvmet | 9,796K | 57.3 | 약 171K `≈` |
| 8 | SPDK | 7,831K | 30.3 | 약 258K `≈` |
| 1 | 커널 nvmet | 4,018K | 20.5 | 약 196K `≈` |
| 1 | SPDK | 4,197K | 28.7(24코어 고정 폴링) | 약 146K `≈` |

보고서는 SPDK 타깃의 코어당 IOPS가 커널 타깃의 최대 1.69배(읽기), 1.39배(쓰기), 1.48배(혼합)라고 결론짓습니다 `Ⓑ`. 연결이 적을 때는 고정 코어를 계속 폴링하는 SPDK의 효율이 낮아 커널이 앞서고, SPDK 코어를 4개로 줄여 다시 재면 SPDK가 1.38배라고 덧붙입니다. 연결이 8개인 행에서는 코어를 더 쓴 커널 타깃의 절대 처리량이 높습니다. 같은 보고서에서 SPDK 타깃은 4KiB 랜덤 읽기 1코어 611.3K, 8코어 5,571K, 12코어 8,307K IOPS로 늘다가 48코어에서 11,059K(362Gbps)로 링크가 포화됩니다 `Ⓑ`. RDMA 보고서(QD128)의 1코어 값은 1,564.5K라 TCP와 QD가 달라 배수를 내지 않습니다 `Ⓑ`.

지연에서는 평균이 거의 같고 꼬리가 갈립니다. QD1 평균은 커널 21.39µs, SPDK 20.43µs(둘 다 커널 initiator)이지만 p99.9는 SPDK 43.3µs 대 커널 33.0µs, p99.99는 106.0µs 대 59.6µs로 커널이 낮습니다 `Ⓑ`. LeapIO 논문(ASPLOS'20)도 RDMA 환경의 YCSB/RocksDB 실험에서 커널 NVMe-oF가 가장 안정적이었고 SPDK는 32스레드에서 p99.9 14ms, p99.99 약 2,000ms까지 갔다고 보고합니다 `Ⓑ`. 2020년 구현에 RDMA·YCSB 조건이라 규모는 위 보고서와 맞댈 수 없지만 방향은 같습니다. 꼬리 지연을 SLO로 잡는다면 평균만 보고 구현을 고르면 안 됩니다 `Σ`. ntprof는 커널 타깃의 코어를 드라이브당 1개로 묶으면 iodepth 16 이후 처리량이 252.4에서 284.9MB/s로 거의 늘지 않고 지연만 238.7µs에서 431.0µs로 뛴다고 보고합니다 `Ⓑ`.

하드웨어로 내리는 길도 있습니다. ConnectX-5 이상의 NVMe-oF target offload는 HCA가 일반 I/O를 처리해 peer-to-peer PCI로 NVMe 장치에 직접 보낸다고 NVIDIA 문서가 설명합니다 `Ⓥ`. 타깃 소프트웨어를 DPU로 옮긴 실측은 SPDK 26.01 RDMA 보고서(NVIDIA, 2026-02)에 있습니다. BlueField-3(Arm Cortex-A78AE 16코어, 커널 5.15)에서 SPDK 타깃을 돌리고 200GbE 2포트, SSD 16개 JBOF, Spectrum-4 스위치를 거친 조건에서 4KiB 랜덤 읽기 QD64는 1코어 469.8K, 8코어 6,135K, 16코어 10,091K IOPS(평균 100.9µs)였습니다 `Ⓑ`.

namespace 뒤의 논리 볼륨 계층에도 값이 붙습니다. SPDK bdev 계층 자체가 raw polled-mode 드라이버보다 랜덤 읽기 약 11.6%, 랜덤 쓰기 약 19.8%의 오버헤드를 더한다는 것이 bdev 보고서(24.05)의 값입니다 `Ⓑ`. 이 값의 큐 깊이와 코어 수는 확인하지 못했습니다 `?`. lvol은 vhost-scsi 뒤에서 split NVMe bdev 대비 IOPS 차이가 +3.15%에서 −9.54%였고 보고서 결론은 7~10% 낮다는 것입니다. 다만 드라이브 한 장을 VM 둘이 나눠 쓰는 조건에서는 lvol과 split의 차이가 잡음 수준(QD1 4K 랜덤 읽기 24.17k 대 24.26k IOPS, 82.39µs 대 82.24µs)이었습니다 `Ⓑ`. 커널 dm-thin은 메타데이터를 별도 장치에 두고 데이터 블록 크기(64KiB~1GiB)를 만든 뒤에 바꿀 수 없으며, 새로 할당한 블록을 기본으로 0으로 채웁니다(skip_block_zeroing으로 끔) `✓`. dm-thin의 지연·IOPS 실측은 찾지 못했습니다 `?`.

## 5. 호스트와 VM에 내주는 방식

NVMe 장치를 VM 안으로 들이는 길은 몇 갈래입니다. passthrough·SR-IOV·mediated passthrough는 호스트에 꽂힌 PCIe NVMe 장치를 전제로 하고, NVMe-oF는 DPU 에뮬레이션의 백엔드로 등장합니다.

| 방식 | 데이터 경로 | 비용과 제약 |
|---|---|---|
| VFIO passthrough | BAR를 게스트에 매핑하고 IRQ를 게스트에 직접 주입하며 DMA는 IOMMU가 처리한다. 호스트 커널은 데이터 경로에서 빠진다 `✓` | 장치가 게스트 한 대에 전속된다. live migration과 소프트웨어 기능이 제한된다 `✓` |
| SR-IOV | SSD 하나를 VF 여러 개로 나눠 VM마다 하나씩 붙인다 | SSD가 지원해야 한다. Samsung PM1733·PM1735는 최대 64개 분할을 발표했고 `Ⓥ`, KIOXIA CM7은 발표문에 SR-IOV를 적었다 `Ⓥ`. Micron·Solidigm은 근거를 찾지 못했다 `?` |
| mediated passthrough | 게스트가 네이티브 NVMe 드라이버를 쓰고, 호스트가 게스트 큐를 물리 큐에 shadow한다. doorbell trap과 인터럽트는 폴링으로 바꿨다 `Ⓑ` | 폴링 스레드 3개가 호스트 코어 3개를 100% 쓴다(VM 간 공유 가능). 논문 구현이며 업스트림 반영 여부는 확인하지 못했다 `?` |
| SPDK vhost | 게스트가 hugepage 공유 메모리의 virtqueue로 I/O를 직접 제출하고 QEMU는 끼지 않는다. poll-mode virtio 드라이버를 쓰면 완료 인터럽트도 없어진다 `✓` | hugepage와 폴링 전용 코어가 든다 `Ⓑ` |
| DPU·SmartNIC 에뮬레이션 | 카드가 호스트에 NVMe 또는 virtio-blk PCIe function을 내고 뒤쪽 백엔드는 카드가 연결한다. AWS Nitro는 function을 SR-IOV VF로 나눠 VM에 배정한다 `✓` | NVIDIA SNAP은 백엔드로 NVMe-oF·iSCSI 등을 RDMA/TCP로 잇고 VF를 NVMe 최대 512개, virtio-blk 최대 2,000개까지 낸다 `✓`. AWS와 NVIDIA 모두 문서에 오버헤드 수치가 없다 `?` |

세 방식을 한 조건에서 잰 값은 BM-Store 논문(HPCA'23)에 있습니다. Xeon Platinum 8163 2소켓, Intel P4510 2.0TB, VM 4코어·4GB(SPDK vhost에는 코어 1개 추가), fio libaio 조건에서 VM 안 평균 지연은 VFIO, BM-Store(FPGA 에뮬레이션), SPDK vhost 순으로 4K 랜덤 읽기 QD1이 79.7, 83.7, 82.7µs, 랜덤 쓰기 QD1이 14.9, 19.6, 19.2µs, 랜덤 읽기 QD128이 1647.0, 1666.0, 1893.4µs입니다 `Ⓑ`. QD1에서 에뮬레이션과 vhost가 VFIO에 더하는 시간은 읽기에서 3~4µs(약 4~5%), 쓰기에서 4~5µs(약 30%)입니다 `≈`. 더해지는 시간은 읽기와 쓰기가 비슷한데 쓰기 자체가 짧아 비율이 커집니다 `Σ`. Hajnoczi의 KVM Forum 2020 발표에도 같은 소프트웨어 오버헤드가 100µs짜리 디스크에서는 5%, 15µs짜리 디스크에서는 33%가 된다는 도식이 있습니다 `Ⓥ`. 같은 논문에서 SPDK vhost는 VFIO의 63.0~96.0% 성능이었고, 최저치는 128K 순차 읽기 QD256이며 CentOS 7 커널 3.10 게스트에서 심했습니다. P4510 4장에서 128K 순차 읽기 QD256으로 네이티브의 80%를 내려면 vhost 코어가 8개 이상 필요했습니다 `Ⓑ`.

MDev-NVMe(USENIX ATC'18; Optane P4800X, 호스트·게스트 커널 4.10, VM당 vCPU 4개, QEMU·SPDK 버전과 virtio 구성은 논문에 없음 `?`)는 네이티브 대비 IOPS를 비율로 냅니다. 4K 랜덤 읽기 QD1은 MDev 66%, SPDK vhost-blk 59%, vhost-scsi 54%, virtio 29%이고, QD32에 job 4개에서는 142%, 136%, 109%, 45%입니다 `Ⓑ`. 100%를 넘는 값은 네이티브가 인터럽트 구동이고 MDev가 호스트 코어 3개를 폴링에 쓰는 조건에서 나온 것입니다. 이 논문의 측정 대상에 VFIO passthrough는 없습니다 `✓`.

ARM SoC로 스토리지 서비스를 내린 LeapIO(ASPLOS'20; i9-7980XE, Intel P4600, 게스트 8코어)는 passthrough 대비 처리량 저하가 읽기 전용 2%, 읽기·쓰기 50/50 5%이고, p99 아래 지연은 평균 3%, p99.9에서 6~12% 높다고 보고합니다 `Ⓑ`. 실제 ARM SoC에서 돌리면 x86 에뮬레이션 대비 최대 30% 느려졌는데, SoC에서 호스트로 가는 one-sided RDMA가 작업당 5µs를 더하고 ARM 코어 클럭이 25% 낮기 때문입니다 `Ⓑ`.

AWS는 이 구조를 상용으로 씁니다. EBS 볼륨을 Nitro 기반 인스턴스에 NVMe 블록 장치로 노출하고, Nitro Hypervisor 구성에서는 Nitro Card가 PCIe로 내는 function을 SR-IOV VF로 나눠 VM에 붙입니다 `✓`. io2 Block Express 문서만 카드와 EBS 서버 사이의 SRD를 적고, 다른 볼륨의 전송 프로토콜과 카드 안 데이터 경로, 오버헤드 수치는 공식 문서에서 찾지 못했습니다 `?`. 소프트웨어만으로 같은 모양을 내는 길로는 vfio-user가 있습니다. 커널 구성 요소 없이 PCI 장치를 유저스페이스에서 구현하는 프레임워크이고, QEMU 10.1에 클라이언트가 들어갔으며(직전 회귀 때문에 10.1보다 조금 뒤 버전이 필요하다고 함), SPDK nvmf 서브시스템과 libvfio-user를 묶으면 가상 NVMe 컨트롤러를 VM에 낼 수 있습니다 `Ⓥ`.

passthrough의 약점인 live migration은 QEMU가 장치의 opt-in(`VFIO_DEVICE_FEATURE_MIGRATION`)을 요구하고, VFIO 장치가 여럿이면 전부 P2P migration을 지원해야 허용합니다 `✓`. NVMe 쪽 표준 TP4159가 2024-07에 나와 2024-08의 Base Specification 2.1에 통합됐다고는 하지만 2차 자료이고 `Ⓥ`, 이를 구현한 SSD와 리눅스 드라이버 지원은 확인하지 못했습니다 `?`.

## 6. Kubernetes 구현

Kubernetes에서 NVMe-oF를 프런트엔드나 내부 전송으로 쓰는 구현은 Longhorn V2, OpenEBS Mayastor, Ceph NVMe-oF gateway입니다.

Mayastor(Replicated PV Mayastor)의 경로는 NVMe-oF target, nexus, child(nexus가 가진 NVMe 컨트롤러), replica(lvol bdev), base bdev, 디스크 순입니다. 복제할 때 원격 replica는 SPDK 유저모드 initiator·target으로 NVMe-oF 연결합니다. 쓰기는 건강한 모든 child에 보내고 전부 완료 응답이 와야 initiator에 완료를 돌려주며, 읽기는 건강한 child에 round-robin으로 보냅니다 `✓`. Intel·MayaData 공동 문서는 Optane P5800X raw 대비 오버헤드가 10% 미만이라고 주장했지만 Blocks & Files는 수치가 불완전하고 단위가 정의되지 않아 비교할 수 없다고 지적했습니다 `Ⓥ`. 조건이 명시된 공식 벤치마크는 찾지 못했습니다 `?`.

Longhorn V1은 engine과 replica가 리눅스 프로세스이고 프런트엔드가 iSCSI입니다. V2는 engine이 SPDK RAID bdev, replica가 SPDK lvol bdev이며 프런트엔드로 NVMe-TCP 또는 UBLK를 고릅니다 `✓`. 프로젝트의 v1.12.0 벤치마크(2026-07-19; OCI VM.DenseIO.E5.Flex EPYC 9J14 3노드, Ubuntu 24.04 커널 6.17, Samsung MZWLR7T6HBLA, kbench/fio, IOPS는 bs=4K iodepth=128 numjobs=8, 지연은 bs=4k iodepth=1)는 같은 환경에서 둘을 함께 쟀습니다.

| 구성 | 랜덤 읽기 IOPS | 랜덤 쓰기 IOPS | QD1 읽기 지연 | QD1 쓰기 지연 |
|---|---|---|---|---|
| 기준선 local-path | 1,468K | 686K | 79µs | 24µs |
| V1 · replica 1 | 29,297 | 32,063 | 325µs | 269µs |
| V2 · replica 1 · SPDK 1코어 | 57,022 | 78,379 | 140µs | 86µs |
| V2 · replica 1 · SPDK 16코어 | 442,053 | 510,846 | 134µs | 84µs |
| V1 · replica 3 | 27,524 | 22,155 | 583µs | 663µs |
| V2 · replica 3 · SPDK 16코어 | 480,375 | 255,473 | 481µs | 482µs |

기준선 대비 랜덤 읽기 IOPS는 V1 약 2%, V2 1코어 약 4%, V2 16코어 약 30%이고, QD1 읽기 지연은 기준선 79µs 위에 V2가 약 55~61µs, V1이 약 246µs를 더합니다 `≈`. V2는 SPDK 코어 수가 IOPS를 좌우합니다. 동기 복제의 비용도 보입니다. V2 랜덤 쓰기는 replica를 1개에서 3개로 늘리면 QD1 지연이 84µs에서 482µs로, IOPS가 510,846에서 255,473으로 변합니다 `Ⓑ`. 측정 환경이 OCI VM이라 기준선 NVMe도 이미 클라우드 가상화 계층을 거친 값입니다 `≈`. SUSE의 1.6.0 발표(2024)는 V2가 V1보다 쓰기 2~4배, 랜덤 읽기 2~3배, 지연 50~70% 감소이고 단일 replica IOPS가 로컬 디스크와 비슷하다고 주장했는데 `Ⓥ`, 원 측정 조건은 확인하지 못했고 v1.12.0의 기준선 대비 30%와도 어긋납니다.

Ceph NVMe-oF gateway는 RBD 이미지를 NVMe/TCP 타깃의 namespace로 내보냅니다. ceph-nvmeof README는 namespace를 Ceph RADOS 클러스터 컨텍스트에 매핑된 SPDK bdev로 설명합니다 `✓`. 개발 버전 문서 기준으로 한계는 gateway 그룹 4개, 그룹당 gateway 8개, 그룹당 subsystem 128개, subsystem당 호스트 32개, 그룹당 namespace 1,024개입니다 `✓`. IBM Storage Ceph 7.1 문서의 사이징은 목표 100,000 IOPS에 reactor 코어 1개·총 16코어, 200,000에 2개·18코어, 250,000에 4개·22코어, 300,000에 8개·30코어입니다 `Ⓥ`. 사용자 실측으로는 rook 토론(#17210)에 krbd 465k 대 NVMe-oF 87.4k 랜덤 읽기 IOPS(4k, iodepth=1, numjobs=64, EPYC 9654, 7.68TB NVMe 22장 × 3노드, Ceph 20.2.0, Rook v1.19.0)가 올라와 있고, 토론의 결론은 원인이 nvmeof 스택이 아니라 SDN 오버레이(OVN-Kubernetes)라는 것입니다 `Ⓑ`. 사용자 보고 하나라 재현성은 확인하지 못했습니다 `?`.

## 7. 방식별 비교표

아래 표의 행은 서로 다른 논문·장치·연도에서 나온 값이라 위아래 행끼리 빼거나 나눌 수 없습니다. 한 행 안의 값만 같은 조건에서 나왔습니다. 비교 축은 요청당 더해지는 시간이지만, 자료가 시간을 주지 않은 행은 보고된 단위(IOPS 비율, 지연 비율)를 그대로 적었습니다. 01 글의 방식도 한 행씩 넣었습니다.

| 방식 | 더해지는 시간 또는 보고된 격차 | 측정 조건 | 근거 |
|---|---|---|---|
| iSCSI (01) | 4KB 읽기 평균 211µs, 로컬(SPDK) 78µs. 차이 약 133µs `≈`. 쓰기는 155µs 대 11µs | ReFlex ASPLOS'17. Xeon E5-2630, 82599ES 10GbE, 커널 4.4, QD1 4KB 랜덤, 무부하 | `Ⓑ` |
| NVMe/RDMA | 로컬 81.6µs에 11.7µs 추가(슬라이드의 분해는 타깃 모듈 4.57, host 모듈 3.25, 패브릭 2.43, 기타 1.52µs), SPDK 타깃이면 8.9µs | Guz SYSTOR'17. Samsung PM1725, ConnectX-4 100GbE RoCEv2, 커널 타깃, 4KB 무부하 읽기. 커널 버전은 슬라이드에 없다 | `Ⓑ` |
| NVMe/RDMA와 iSCSI, 애플리케이션 | RocksDB 처리량이 로컬 대비 NVMe-oF −2%, iSCSI −40% | 같은 논문. db_bench 80/20, 호스트당 3 인스턴스 | `Ⓑ` |
| NVMe/TCP·RDMA | 미디어를 뺀 QD1 왕복 전체가 커널 TCP 21.39µs, 커널 RDMA 12.10µs, 타깃·initiator 모두 SPDK일 때 TCP 17.50µs, RDMA 4.72µs. 로컬 대비 증가분이 아니다 | SPDK 24.05 보고서 둘. null bdev, 타깃 1코어, 4KiB 랜덤 읽기, 커널 6.0.18 | `Ⓑ` `≈` |
| virtio-blk (01) | 4K 읽기 QD1을 1/IOPS로 환산하면 베어메탈 12.7µs, 기본 virtio-blk 45.8µs(+33.1µs), IOThread 추가 21.5µs(+8.8µs), 유저스페이스 nvme:// 18.1µs(+5.4µs) | Hajnoczi KVM Forum 2020. Optane P4800X, 호스트 커널 5.7.7, 게스트 5.5.0, QEMU 4.2.0 이상, pvsync2 QD1 | `Ⓑ` `≈` |
| SPDK vhost와 커널 vhost-scsi (01) | 4K 읽기 QD1 평균 SPDK 82.24µs, 커널 92.00µs. 로컬 대비 값은 없다 | SPDK vhost 24.05 보고서. VM 2대가 드라이브 1장을 공유, vhost 코어 1개, QEMU 7.0.0 | `Ⓑ` |
| VFIO·SPDK vhost·FPGA 에뮬레이션 | VM 안 4K 읽기 QD1 79.7 / 82.7 / 83.7µs. VFIO 대비 +3.0, +4.0µs | BM-Store HPCA'23 Table VII. Intel P4510, VM 4코어 | `Ⓑ` `≈` |
| FPGA 에뮬레이션, 베어메탈 | 네이티브 77.2µs에 80.4µs(읽기), 11.6µs에 14.5µs(쓰기). 약 3µs가 일정하게 붙는다 | 같은 논문 Table V | `Ⓑ` |
| mediated passthrough 등 | 4K 읽기 QD1 평균 지연이 네이티브 대비 MDev 1.51배, vhost-blk 1.70배, vhost-scsi 1.86배, virtio 3.58배 | MDev-NVMe ATC'18. Optane P4800X, 커널 4.10 | `Ⓑ` |
| ARM SoC 오프로드 | passthrough 대비 처리량 −2%(읽기)·−5%(50/50), p99 아래 지연 +3%, p99.9 +6~12% | LeapIO ASPLOS'20. Intel P4600, 게스트 8코어 | `Ⓑ` |
| SPDK lvol 계층 | split bdev 대비 IOPS +3.15%~−9.54%. 드라이브 1장을 VM 2대가 나눠 쓴 QD1 4K 읽기 지연은 82.39µs 대 82.24µs | SPDK vhost 24.05 보고서. vhost-scsi 뒤 | `Ⓑ` |
| Longhorn V1(iSCSI)과 V2(NVMe-oF) | QD1 기준선 79µs·24µs 위에 V1이 읽기 +246µs·쓰기 +245µs, V2가 읽기 +55~61µs·쓰기 +60~62µs | Longhorn v1.12.0 벤치마크. OCI VM, 커널 6.17, kbench. 기준선도 VM 안 값 | `Ⓑ` `≈` |

이 표에서 Guz의 11.7µs와 SPDK 보고서의 12.10µs는 숫자가 가깝지만 같은 값이 아닙니다. 앞은 로컬 NVMe 경로 대비 증가분이고 뒤는 미디어 없는 왕복 전체입니다 `≈`. 증가분이 차지하는 비중은 장치 속도가 정합니다. Guz에서 11.7µs는 81.6µs짜리 로컬 읽기의 약 14%입니다 `≈`. SPDK 보고서처럼 미디어를 뺀 조건에서는 왕복 전체가 곧 전송 비용이라 비중을 말할 수 없습니다. 전송 계층의 비용과 가상화 계층의 비용은 각자 자기 조건에서만 읽을 수 있습니다. 둘을 겹쳐 한 장비에서 잰 공개 자료는 찾지 못했으니 총합은 이 자료로 구할 수 없습니다 `Σ`.

## 8. 확인하지 못한 것

- 커널 6.x에서 로컬 NVMe, NVMe/RDMA, NVMe/TCP, iSCSI를 한 장비에서 같이 잰 공개 자료를 찾지 못했다. 표의 값은 2017~2026년, 커널 4.4~6.17에 걸쳐 있고 장치도 다르다.
- NVMe/TCP에서 TLS와 데이터 다이제스트를 켰을 때의 실측 비용을 찾지 못했다. 스펙은 TLS를 선택 구현으로 두고 TLS 1.3과 PSK 인증을 요구하며, Linux는 6.7에서 in-kernel TLS를 넣었다 `✓`.
- RHEL 9 문서의 nvmet 미지원 문장은 요약본으로만 확인했다. 배포판의 지원 범위는 쓰기 전에 원문으로 확인해야 한다.
- NVMe SR-IOV를 지원하는 SSD의 전체 현황과 VF 수, TP4159 live migration을 구현한 SSD와 리눅스 드라이버를 확인하지 못했다. Micron·Solidigm은 근거가 없다.
- Mayastor는 조건이 명시된 공식 벤치마크를, Ceph NVMe-oF gateway는 사용자 보고 외의 실측을 찾지 못했다.

## 참고 자료

- [NVMe over Fabrics Specification](https://nvmexpress.org/specification/nvme-of-specification/) — NVM Express. 1.0~1.1a 연혁과 "더 이상 개발하지 않음" 문구의 출처
- [NVMe over Fabrics 1.1a](https://nvmexpress.org/wp-content/uploads/NVMe-over-Fabrics-1.1a-2021.07.12-Ratified.pdf) — NVM Express, 2021. subsystem·association·capsule·RDMA 큐 매핑
- [NVMe over TCP Transport Specification 1.2](https://nvmexpress.org/wp-content/uploads/NVM-Express-NVMe-over-TCP-Transport-Specification-Revision-1.2-2025.08.01-Ratified.pdf) — NVM Express, 2025. TCP 연결과 큐 쌍의 1:1 대응, in-capsule·R2T·다이제스트·TLS
- [Welcome NVMe/TCP to the NVMe-oF Family of Transports](https://nvmexpress.org/welcome-nvme-tcp-to-the-nvme-of-family-of-transports/) — Grimberg·Minturn, 2018. NVMe/TCP 비준 시점
- [NVMe 2.0 Library of Specifications 발표](https://nvmexpress.org/nvm-express-announces-the-rearchitected-nvme-2-0-library-of-specifications/) — NVM Express, 2021. 전송 스펙 목록(PCIe·FC·RDMA·TCP)
- [Linux 4.8](https://kernelnewbies.org/Linux_4.8) · [4.15](https://kernelnewbies.org/Linux_4.15) · [4.19](https://kernelnewbies.org/Linux_4.19) · [5.0](https://kernelnewbies.org/Linux_5.0) · [6.7](https://kernelnewbies.org/Linux_6.7) — kernelnewbies. fabrics·멀티패스·ANA·NVMe/TCP·in-kernel TLS 편입 버전
- [NVMe Multipath](https://docs.kernel.org/admin-guide/nvme-multipath.html) — Linux kernel 문서. I/O 정책과 ANA 우선순위
- [drivers/nvme/host/fabrics.c](https://raw.githubusercontent.com/torvalds/linux/master/drivers/nvme/host/fabrics.c) · [fabrics.h](https://raw.githubusercontent.com/torvalds/linux/master/drivers/nvme/host/fabrics.h) · [tcp.c](https://raw.githubusercontent.com/torvalds/linux/master/drivers/nvme/host/tcp.c) — torvalds/linux. I/O 큐 수·큐 크기 기본값과 io_cpu
- [Thin provisioning](https://docs.kernel.org/admin-guide/device-mapper/thin-provisioning.html) — Linux kernel 문서. dm-thin 블록 크기와 제로잉
- [NVMe over Fabrics 문서](https://spdk.io/doc/nvmf.html) · [Logical Volumes](https://spdk.io/doc/logical_volumes.html) — SPDK. 타깃 구조, 절차, lvol 동작
- [RHEL 9 NVMe/TCP 구성](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_storage_devices/configuring-nvme-over-fabrics-using-nvme-tcp_managing-storage-devices) — Red Hat. host 명령과 nvmet 지원 범위(요약본으로만 확인)
- [NVMe-over-Fabrics Performance Characterization (슬라이드)](https://www.systor.org/2017/slides/NVMe-over-Fabrics_Performance_Characterization.pdf) — Guz 외(Samsung), SYSTOR'17. 로컬 대 NVMe/RDMA 대 iSCSI 지연 분해
- [ReFlex: Remote Flash ≈ Local Flash](https://people.ucsc.edu/~hlitz/papers/reflex.pdf) — Klimovic 외, ASPLOS'17. iSCSI 무부하 지연
- [TCP ≈ RDMA: CPU-efficient Remote Storage Access with i10](https://www.usenix.org/system/files/nsdi20-paper-hwang.pdf) — Hwang 외, NSDI'20. 코어당 처리량과 TCP 지연 원인
- [Understanding and Profiling NVMe-over-TCP Using ntprof](https://www.usenix.org/system/files/nsdi25-kang.pdf) — Kang·Liu, NSDI'25. 네트워크 단계 비중, in-capsule 경계
- [Autonomous NIC Offloads](https://borispis.github.io/files/2021-l5o.pdf) — Pismenny 외, ASPLOS'21. 복사·CRC 비용
- [SPDK NVMe-oF TCP Performance Report 24.05](https://review.spdk.io/download/performance-reports/SPDK_tcp_mlx_perf_report_2405.pdf) · [RDMA Performance Report 24.05](https://review.spdk.io/download/performance-reports/SPDK_rdma_mlx_perf_report_2405.pdf) — Intel, 2024. QD1 왕복 지연과 커널 대 SPDK 타깃
- [SPDK NVMe-oF RDMA Performance Report 26.01](https://review.spdk.io/download/performance-reports/SPDK_rdma_nvda_perf_report_2601.pdf) — NVIDIA, 2026. BlueField-3 타깃
- [SPDK Vhost Performance Report 24.05](https://review.spdk.io/download/performance-reports/SPDK_vhost_perf_report_2405.pdf) · [NVMe BDEV Performance Report 24.05](https://review.spdk.io/download/performance-reports/SPDK_nvme_bdev_perf_report_2405.pdf) — Intel, 2024. vhost 대조, lvol·bdev 오버헤드
- [Virtualized I/O with Vhost-user](https://spdk.io/doc/vhost_processing.html) — SPDK 문서. vhost-user 경로
- [NVMe-oF target offload](https://networking-docs.nvidia.com/doca/archive/3-4-0/nvme-of-nvm-express-over-fabrics) — NVIDIA DOCA 문서. 타깃 오프로드 설명
- [Proxmox: iSCSI and NVMe/TCP shared storage comparison](https://kb.blockbridge.com/technote/proxmox-iscsi-vs-nvmetcp/) — Blockbridge. 벤더 측정(게시일 미확인)
- [NVMe Transport Performance Comparison (H18892.2)](https://www.delltechnologies.com/asset/en-gb/products/storage/industry-market/h18892-nvme-transport-performance-comparison.pdf) — Dell. 벤더 측정(발행 연도 미확인)
- [The 10 Microsecond Challenge: Optimizing for NVMe Drives](https://vmsplice.net/~stefan/stefanha-kvm-forum-2020.pdf) — Hajnoczi, KVM Forum 2020. VFIO 경로, 오버헤드 비중 도식, virtio-blk QD1 수치
- [MDev-NVMe](https://www.usenix.org/system/files/conference/atc18/atc18-peng.pdf) — Peng 외, USENIX ATC'18. mediated passthrough 구조와 실측
- [BM-Store](https://shuibing9420.github.io/assets/pdf/BM-Store_A_Transparent_and_High-performance_Local_Storage_Architecture_for_Bare-metal_Clouds_Enabling_Large-scale_Deployment.pdf) — Chen 외, HPCA'23. VFIO·vhost·FPGA 에뮬레이션 대조
- [LeapIO](https://ucare.cs.uchicago.edu/pdf/asplos20-LeapIO.pdf) — Li 외, ASPLOS'20. ARM SoC 오프로드, 커널 대 SPDK NVMe-oF
- [The Security Design of the AWS Nitro System](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/the-components-of-the-nitro-system.html) · [Amazon EBS volumes and NVMe](https://docs.aws.amazon.com/ebs/latest/userguide/nvme-ebs-volumes.html) · [Amazon EBS Provisioned IOPS SSD volumes](https://docs.aws.amazon.com/ebs/latest/userguide/provisioned-iops.html) — AWS. EBS의 NVMe 노출, Nitro Card의 NVMe 인터페이스, SRD
- [A Cloud-Optimized Transport Protocol for Elastic and Scalable HPC](https://assets.amazon.science/a6/34/41496f64421faafa1cbe301c007c/a-cloud-optimized-transport-protocol-for-elastic-and-scalable-hpc.pdf) — Shalev 외, IEEE Micro 2020. RoCEv2의 PFC 요구 서술
- [NVIDIA DOCA SNAP-4 Service Guide](https://networking-docs.nvidia.com/doca/archive/2-9-0/nvidia-doca-snap-4-service-guide) — NVIDIA, DOCA 2.9.0. 에뮬레이션 장치와 백엔드
- [Samsung PM1733/PM1735 발표](https://www.storagenewsletter.com/2019/09/23/samsung-unveils-software-innovation-to-pcie-gen4-ssds-and-pm1733-and-pm1735-series-offered-in-19-models-up-to-31tb/) · [KIOXIA CM7 보도자료](https://americas.kioxia.com/en-us/business/news/2022/ssd-20220725-1.html) — 2019·2022. SR-IOV 지원 주장
- [vfio-user client in QEMU 10.1](https://movementarian.org/blog/posts/2025-08-27-vfio-user-client-in-qemu/) — John Levon, 2025-08-27. vfio-user와 SPDK nvmf
- [VFIO device migration](https://www.qemu.org/docs/master/devel/migration/vfio.html) — QEMU 문서. opt-in과 P2P 조건
- [Revolutionizing Data Center Operations and the Impact of NVMe Host Managed Live Migration](https://www.iol.unh.edu/blog/2025/07/30/revolutionizing-data-center-operations-and-impact-nvme) — UNH-IOL, 2025. TP4159 (2차 자료)
- [I/O Path Description](https://openebs.io/docs/user-guides/replicated-storage-user-guide/replicated-pv-mayastor/additional-information/io-path-description) — OpenEBS 문서. Mayastor 경로와 복제 쓰기
- [Intel says Mayastor is fastest open source storage. So where are the numbers?](https://blocksandfiles.com/2021/03/08/intel-says-mayastor-is-fastest-open-source-storage/) — Blocks & Files, 2021-03-08
- [Longhorn Concepts (1.9.0)](https://longhorn.io/docs/1.9.0/concepts/) · [Performance Benchmark wiki](https://github.com/longhorn/longhorn/wiki/Performance-Benchmark) · [v1.12.0 report.pdf](https://github.com/user-attachments/files/30166023/report.pdf) — Longhorn 프로젝트. V1·V2 구조와 2026-07-19 벤치마크
- [Announcing Longhorn 1.6.0](https://www.suse.com/c/rancher_blog/announcing-longhorn-1-6-0/) — SUSE, 2024-02-19. V2 성능 주장
- [NVMe-oF Gateway](https://docs.ceph.com/en/latest/rbd/nvmeof-overview/) · [ceph-nvmeof](https://github.com/ceph/ceph-nvmeof) — Ceph. gateway 구조와 한계
- [NVMe performance best practices](https://www.ibm.com/docs/en/storage-ceph/7.1.0?topic=gateway-nvme-performance-best-practices) — IBM Storage Ceph 7.1. gateway 코어 사이징
- [rook/rook Discussion #17210](https://github.com/rook/rook/discussions/17210) — 사용자 보고, 2026. krbd 대 NVMe-oF gateway 실측
