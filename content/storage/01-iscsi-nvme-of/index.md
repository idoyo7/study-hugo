---
title: "iSCSI와 NVMe-oF — 네트워크 블록 경로와 비용"
linkTitle: "01 iSCSI와 NVMe-oF"
description: "iSCSI 대비 NVMe-oF의 호스트 경로·큐 구조·쓰기 데이터 흐름의 차이, 타깃이 내보내는 가상 NVMe controller와 namespace, 타깃 구현과 백엔드가 이점을 바꾸는 조건을 측정 조건과 함께 정리한다."
weight: 1
date: 2026-10-04
lastmod: 2026-10-04
aliases: ["/storage/01-network-block/", "/storage/02-nvme-of/"]
---

# 01 · iSCSI와 NVMe-oF — 네트워크 블록 경로와 비용

NVMe SSD가 꽂힌 서버의 용량을 다른 호스트에 내줄 때 iSCSI와 NVMe-oF 중 무엇을 쓸지 고르는 글입니다. 먼저 질문 셋에 짧게 답합니다.

iSCSI보다 논리적으로 오버헤드가 적은지부터 보겠습니다. 줄일 여지는 있습니다. 호스트 경로에서 SCSI 중간 계층과 CDB를 PDU로 감싸는 단계가 빠지고, 큐와 연결을 나누는 방식도 다릅니다 `Ⓥ` `≈`. 다만 SCSI 처리가 빠진 효과만 따로 잰 값은 이 글의 자료에 없고, TCP 위에서는 TCP/IP 처리와 복사·CRC가 그대로 남습니다.

프로토콜 자체를 NVMe로 가상화하는 것은 아닙니다. NVMe-oF는 NVMe 명령을 네트워크로 주고받는 규약이고, 이 글의 소프트웨어 타깃은 그 규약을 따르는 NVMe controller를 직접 구현해 namespace를 백엔드 블록 장치에 연결합니다. 이 글의 소프트웨어 타깃에서 호스트에 보이는 NVMe 장치는 물리 SSD의 것이 아닙니다 `≈`.

이점은 측정이 있는 만큼만 말할 수 있습니다. 한 연구의 RocksDB 실험에서 로컬 대비 처리량은 NVMe-oF(RoCEv2)가 2% 차이였고 iSCSI는 40% 줄었습니다 `Ⓑ`. 같은 실험에서 NVMe-oF의 평균 지연은 11%, 호스트 CPU는 10% 늘었고, 이점은 전송·타깃 구현·부하 조건에 따라 달라집니다. 조건은 1절 표에 함께 두었습니다.

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

장치·커널·블록 크기·큐 깊이는 자료마다 다릅니다. 수치는 같은 자료 안에서만 견주고 조건을 함께 적었습니다. 이 글은 전송과 타깃·백엔드까지를 다루고, 그 장치를 VM에 전달하는 방식은 [02 VM 디스크 경로]({{< relref "../02-vm-disk-paths/index.md" >}})로 넘깁니다.

## 1. iSCSI보다 무엇이 가벼워지고, 무엇은 남는가

| 기대하는 이점 | 구조상 이유 | 이점이 줄거나 판단이 달라지는 조건 |
|---|---|---|
| 호스트 명령 처리 경로 단순화 | SCSI 중간 계층과 iSCSI 계층 자리에 NVMe host와 전송 계층이 들어간다 `≈` `Ⓥ` | TCP/IP 처리·복사·CRC는 남는다. 제거된 처리만의 독립 실측은 없다 `?` |
| 요청 처리의 병렬성 | NVMe는 큐 쌍 구조이고 Linux host는 CPU마다 I/O 큐와 연결을 연다. Linux 소프트웨어 iSCSI는 세션당 하드웨어 큐 1개·연결 1개다 `✓` `≈` | 큐 수가 처리량을 보장하지는 않는다. 타깃 코어나 연결 하나에 부하가 몰리는 측정도 있다 `Ⓑ` |
| 애플리케이션 처리량 유지 | 같은 연구에서 NVMe/RDMA의 로컬 대비 처리량 차이가 2%였다 `Ⓑ` | 같은 실험에서 지연과 호스트 CPU 비용은 남았다. i10(NSDI'20)의 RocksDB 실험에서는 RocksDB 자체가 CPU의 최대 70%를 써서 fio보다 전송 간 차이가 작았다 `Ⓑ` |
| 백엔드를 NVMe 인터페이스로 제공 | namespace가 백엔드 블록 장치 하나에 대응한다 `✓` | lvol·객체 매핑·복제 처리가 없어지는 것은 아니다 `Ⓑ` `✓` |
| 구현에 따른 CPU 효율 개선 | 커널과 SPDK의 실행·폴링 방식이 다르다 `✓` | 연결 수, 고정 폴링 코어, 꼬리 지연에 따라 판단이 달라진다 `Ⓑ` |

대표 수치는 Guz 외(Samsung, SYSTOR'17)의 실험입니다. 호스트 3대가 PM1725 3개를 단 커널 타깃에 100GbE RoCEv2로 붙었고, db_bench 80/20을 호스트당 3 인스턴스로 돌렸습니다. 커널 버전은 슬라이드에 없습니다 `?`.

{{< lane src="_lane/1-rocksdb-처리량.json" />}}

같은 실험에서 NVMe-oF 쪽이 치른 비용을 보겠습니다.

| RocksDB 지표 | 로컬(DAS) | NVMe-oF(RoCEv2) |
|---|---|---|
| 처리량 | 기준 | 2% 차이 |
| 평균 지연 | 507µs | 568µs(슬라이드 기준 +11%) |
| p99 지연 | 3.6ms | 3.7ms |
| 호스트 CPU | 기준 | +10% |

iSCSI는 같은 실험에서 처리량이 40% 줄었습니다 `Ⓑ`. 하지만 이 iSCSI가 어떤 전송 구성 위에서 돌았는지는 근거 자료에 없습니다. 그래서 2%와 40%의 차이를 SCSI 변환을 걷어낸 효과로 읽을 수 없고, 같은 숫자를 NVMe/TCP에 옮기지도 않습니다. 막대의 98은 "2% 차이"를 옮긴 근사값이고 근거 자료에는 그 차이의 방향이 없습니다. 이 막대는 처리량 이점만 보여 주므로 위 표의 지연·CPU 비용과 같이 읽어야 합니다.

같은 발표의 다른 측정도 방향이 같습니다. 이쪽도 NVMe/RDMA 위의 값이고 iSCSI의 전송 구성은 여기서도 확인하지 못했습니다 `Ⓑ` `?`.

| 측정 | 결과 |
|---|---|
| 무부하 4K 읽기 지연 | 로컬 NVMe 경로 81.6µs에 NVMe-oF가 11.7µs를 더했다. 타깃 모듈 4.57, host 모듈 3.25, 패브릭 2.43, 기타 1.52µs. SPDK 타깃이면 8.9µs(당시 SPDK는 "not stable enough for our setup") |
| 호스트 CPU | iSCSI는 성능이 DAS와 같은 구간에서도 호스트 부하가 30% 더 들었고, NVMe-oF는 "minimal"이었다 |
| 타깃 CPU | NVMe-oF 타깃은 코어를 1/12로 줄여도 DAS 읽기 처리량의 90%를 냈다 |
| 부하 지연 | NVMe-oF는 평균·95th가 DAS와 같았고, iSCSI는 가벼운 부하에서도 10배 느렸다고 슬라이드가 적는다 |

이점이 줄어드는 조건도 자료에 있습니다. TCP 전송에서는 SCSI 변환을 빼도 작은 PDU마다 드는 TCP/IP 처리, 스레드 간 컨텍스트 스위치, 복사와 CRC가 남습니다(4절). Blockbridge는 대역폭이 한계인 큰 블록에서 NVMe/TCP와 iSCSI의 차이가 약 0.1%였다고 보고합니다 `Ⓥ`. 공개 논문에서 iSCSI와 한 조건으로 잰 NVMe-oF는 RDMA이고, NVMe/TCP와 iSCSI를 함께 잰 값은 벤더 자료, Longhorn 벤치마크(6절), StarWind 블로그(7절)뿐입니다. 이 가운데 어느 것도 SCSI 변환 제거만의 효과를 분리해 주지 않습니다.

## 2. 타깃은 무엇을 내보내고 호스트는 무엇을 보는가

{{< flow src="_flow/2-장치-대응.json" />}}

NVMe-oF는 NVMe 명령을 패브릭으로 주고받는 규약입니다. 이 글의 소프트웨어 타깃(Linux nvmet, SPDK nvmf)은 그 규약을 따르는 NVMe controller를 스스로 구현하고, namespace 하나를 타깃 쪽 블록 장치 하나에 연결합니다. SPDK에서는 namespace마다 bdev 계층이 내놓는 블록 장치가 하나씩 대응하고, 그 bdev는 물리 NVMe일 수도 그 위에 쌓은 가상 bdev일 수도 있습니다 `✓`. 호스트의 NVMe 드라이버가 붙는 controller는 물리 SSD의 것이 아니라 이렇게 타깃 프로그램이 만든 것이고, namespace 뒤에는 LV·lvol·파일 같은 블록 장치가 올 수 있습니다 `≈`.

그래서 "프로토콜 자체를 가상화한다"기보다 전송 규약과 장치 구현이 둘로 나뉘어 있다고 보는 편이 맞습니다. 명령이 물리 SSD까지 그대로 전달된다는 설명도 정확하지 않습니다. 타깃은 받은 명령을 namespace에 연결된 블록 장치의 I/O로 내려보내고, 그 장치는 NVMe SSD일 수도 논리 볼륨일 수도 있습니다. 커널 타깃 경로는 NVMeT_Core에서 블록 계층을 거쳐 NVMe_Core, NVMe_PCI로 이어진다고 Guz 슬라이드가 그립니다 `Ⓑ`. 하드웨어 타깃 오프로드는 예외입니다. ConnectX-5 이상은 HCA가 일반 I/O를 처리해 peer-to-peer PCI로 NVMe 장치에 직접 보낸다고 NVIDIA 문서가 설명합니다 `Ⓥ`.

타깃이 내놓는 단위는 NVM subsystem이고 NQN으로 식별하며 port로 노출합니다. 호스트가 controller의 Admin Queue에 연결하면 association이 생기고, 유지되는 동안에는 그 호스트만 해당 controller에 연결을 맺을 수 있습니다 `✓`. 어떤 subsystem이 있는지 알려 주는 Discovery controller는 Discovery Log만 낼 뿐 I/O 큐도 namespace도 갖지 않습니다 `✓`. 연결이 끝나면 호스트에 `/dev/nvmeXnY`가 생기고, `nvme list`의 모델 칸에는 타깃 소프트웨어가 보고하는 값이 나옵니다 `≈`. 같은 namespace로 가는 경로가 여럿이면 Linux는 이를 블록 장치 하나로 묶고, 정책이 무엇이든 ANA에서 optimized인 경로를 먼저 씁니다 `✓`. 설정 절차는 부록에 모았습니다.

- 바뀐 것: 호스트가 NVMe controller와 namespace로 장치를 본다.
- 남은 비용: namespace 뒤의 lvol·객체 매핑·복제는 그대로다(5·6절).
- 적용할 수 없는 비교: `/dev/nvme*` 이름만 보고 뒤쪽 전송을 추정하지 않는다. 클라우드 볼륨이나 DPU 카드가 NVMe 장치로 보이는 경우는 [02]({{< relref "../02-vm-disk-paths/index.md" >}})에서 다룬다.

## 3. 호스트 I/O 스택과 큐 구조는 어떻게 다른가

{{< flow src="_flow/3-호스트-io-스택.json" />}}

{{< flow src="_flow/3-큐-연결-배치.json" />}}

윗그림의 계층 순서는 RFC 7143, open-iscsi README, LIO 문서의 사실을 이어 붙인 것으로, 한 문서가 이 그림 그대로 그린 경로는 아닙니다 `≈`. NVMe 쪽에는 SCSI 중간 계층과 iSCSI 계층이 없습니다. Guz 외는 이를 "경로에서 프로토콜 변환을 없앤다"고 설명합니다 `Ⓥ`. iSCSI가 시간을 쓰는 곳은 두 논문이 각자 짚습니다. ReFlex(ASPLOS'17)는 클라이언트와 서버 양쪽에서 소켓·SCSI·애플리케이션 버퍼 사이의 데이터 복사를 동반하는 무거운 프로토콜 처리를 원인으로 봅니다. i10(NSDI'20)은 당시 Linux iSCSI가 TSO/GRO를 충분히 쓰지 못하고 TCP/IP 처리 전용 커널 스레드를 따로 돌려 CPU를 비효율적으로 쓴다고 지적합니다 `Ⓑ`.

큐 쪽에서는 프로토콜의 규칙과 Linux의 기본값을 나눠 봐야 합니다. iSCSI 스펙은 MaxConnections 키로 세션 하나에 연결 여러 개(MC/S)를 두는 것을 허용합니다 `✓`. 그러나 open-iscsi README는 iscsi_tcp와 iser 같은 소프트웨어 iSCSI가 "세션마다 scsi_host를 하나 할당하고 세션당 연결을 하나만 쓴다"고 적습니다 `✓`. 커널 `iscsi_tcp.c`의 host template에는 `nr_hw_queues` 설정이 없고 SCSI 코어는 미설정이면 1로 두므로, 세션 하나가 하드웨어 큐 하나와 TCP 연결 하나를 쓰는 것이 기본 형태입니다 `≈`. scsi-mq는 4.19에서 기본이 됐고 5.0에서 non-mq 코드가 사라졌지만 `✓`, master 소스(2026-10 시점)에서도 iscsi_tcp는 하드웨어 큐 수를 따로 정하지 않습니다.

NVMe/TCP에서는 연결 하나가 Admin 또는 I/O 큐 쌍 하나에 대응하고, 연결 하나에 큐 여럿을 다중화하거나 큐 하나를 연결 여럿에 걸치는 구성은 스펙이 지원하지 않습니다 `✓`. RDMA에서는 I/O 큐 쌍 하나가 RDMA QP 하나에 대응합니다 `✓`. CPU 수만큼 큐를 만드는 것은 규약이 아니라 Linux host의 기본값입니다. 기본으로 온라인 CPU 수만큼 I/O 큐를 만들고(큐 크기 기본 128, 범위 16~1024) 연결도 그만큼 열며, nvme-tcp는 큐마다 CPU를 하나씩 정해 그 CPU의 워크큐에서 소켓 송수신을 돌립니다 `✓`.

이 구조가 실제 이점인지는 측정이 일부만 받쳐 줍니다. ntprof(NSDI'25)는 NVMe/TCP 연결 하나에 fio job을 5개에서 6개로 늘리면 처리량이 645.2에서 665.5MB/s로 3.1%만 늘고 지연은 477.3µs에서 556.7µs가 된다고 보고합니다 `Ⓑ`. 큐와 연결을 CPU 수만큼 나누는 구조는 이 한계를 연결 수로 푸는 쪽이라고 읽습니다 `Σ`. 연결 수를 늘린 측정은 아니어서 연결 수 증가의 효과까지 입증된 것은 아닙니다. 위 큐 그림의 CPU 수와 큐 수도 임의의 예일 뿐이고, 큐가 많을수록 빨라진다는 근거로 쓸 수 없습니다.

- 바뀐 것: SCSI 중간 계층과 iSCSI 계층 자리에 NVMe host와 전송 계층이 들어가고, Linux 기본 큐 배치가 세션당 1개에서 CPU당 1개로 달라진다.
- 남은 비용: TCP/IP 처리와 복사는 두 경로 모두 남는다(4절).
- 적용할 수 없는 비교: 이 그림의 노드 수나 큐 수를 지연 비율로 읽지 않는다. 큐 수에 비례하는 성능을 가정하지 않는다.

## 4. 쓰기 데이터는 어떻게 오가며 TCP에는 무엇이 남는가

{{< seq src="_seq/4-쓰기-데이터와-r2t.json" />}}

NVMe/TCP에서 명령은 capsule에 담겨 오갑니다. command capsule은 64바이트 이상의 SQE에 데이터나 SGL이 붙는 형태이고 response capsule은 16바이트 CQE입니다 `✓`. 쓰기 데이터를 capsule에 함께 싣는 in-capsule은 I/O 명령에서 선택 기능이고, Fabrics·Admin 명령만 8,192바이트까지 필수입니다 `✓`. 한도를 넘는 쓰기는 컨트롤러의 R2T를 받은 뒤에야 호스트가 H2CData로 보냅니다 `✓`. Linux 구현에서는 8KB 이하 쓰기가 capsule에 실리고 그보다 크면 R2T 흐름을 탄다는 그림이 ntprof 논문에 있습니다 `Ⓑ`.

iSCSI도 R2T와 ImmediateData·InitialR2T·FirstBurstLength·MaxBurstLength 협상으로 같은 일을 합니다 `✓`. 쓰기 왕복 횟수에서 두 프로토콜이 다르다고 볼 근거는 이 글의 자료에 없습니다 `Σ`. in-capsule이 있다는 사실이 곧 iSCSI 대비 왕복 감소라는 증거는 아닙니다. RDMA에서는 데이터가 다르게 움직입니다. 읽기 데이터는 컨트롤러가 RDMA_WRITE로 호스트 버퍼에 밀어 넣고, 쓰기 데이터는 컨트롤러가 RDMA_READ로 가져오거나 in-capsule로 받습니다. 두 동작 모두 컨트롤러가 시작합니다 `✓`.

TCP 위에서 남는 비용은 세 논문이 나눠 보여 줍니다.

| 자료 | 조건 | 보고한 것 |
|---|---|---|
| i10, NSDI'20 | 커널 4.20, ConnectX-5 100Gbps 직결, PM1725a, 4KB 랜덤 읽기 QD128 | 코어당 네트워크 스택 약 30Gbps(≈915K IOPS), 로컬 스토리지 스택 약 350K IOPS인데 합친 커널 NVMe/TCP는 96K IOPS. 병목이 두 스택의 경계에 있다는 것이 저자 주장이다 `Ⓑ` |
| i10 (같은 논문) | SSD 포화에 필요한 코어 | 랜덤 읽기에서 로컬 3코어, NVMe/RDMA 4코어, NVMe/TCP는 그 2.5배(약 10코어 `≈`). 랜덤 쓰기는 RDMA 3코어 대 TCP 6코어 `Ⓑ` |
| i10 (같은 논문) | 지연 원인 | host가 보낸 패킷의 약 80%가 72바이트 요청 PDU라 TSO 이득이 없고, 커널 스레드 셋(blk-mq, 송신, 수신)이 요청마다 개입해 컨텍스트 스위치가 1~3µs씩 든다 `Ⓑ` |
| ntprof, NSDI'25 | 커널 5.15.143, ConnectX-6 100GbE, MTU 9KB, fio libaio job 1개 | 4K 랜덤 읽기 iodepth를 1에서 32로 올리면 양쪽 네트워크 단계 시간이 14.3µs에서 127.0µs로 늘어 전체 지연의 92.2%를 차지한다 `Ⓑ` |
| Autonomous NIC Offloads, ASPLOS'21 | 커널 5.6.0, ConnectX-6 Dx에서 NVMe-TCP 오프로드를 에뮬레이션 | CPU의 CRC32 명령을 쓰고도 복사와 CRC가 NVMe-TCP 메시지 처리 사이클의 최대 49%다 `Ⓑ` |

헤더·데이터 다이제스트(CRC32C)는 연결을 맺을 때 양쪽이 켜야 동작하는 선택 기능입니다 `✓`. 켰을 때의 비용은 NVIDIA의 nvme-tcp 수신 오프로드 패치 커버레터(v30, 2025-07)에서 소프트웨어 경로 기준선을 얻을 수 있습니다. ConnectX-7, Xeon Platinum 8380, fio QD128×8에서 64K read가 다이제스트 없이 84Gbps, 켜면 53Gbps이고 512K read는 98Gbps와 61Gbps입니다 `Ⓥ`. 약 37~38% 줄어듭니다 `≈`. 4K와 쓰기 경로의 수치는 없습니다. TLS를 켠 것과 끈 것을 같은 장비에서 잰 공개 수치는 찾지 못했습니다. 스펙은 TLS를 선택 구현으로 두고 TLS 1.3과 PSK 인증을 요구하며, Linux는 6.7에서 in-kernel TLS를 넣었고 `✓`, RHEL은 9.6과 10.0에서 이를 Technology Preview로 둡니다 `✓`.

- 바뀐 것: 쓰기 데이터를 명령에 실을 수 있는 경우가 생기고, RDMA에서는 데이터 이동을 컨트롤러가 시작한다.
- 남은 비용: TCP 전송에는 TCP/IP 처리, 컨텍스트 스위치, 복사와 CRC가 남는다.
- 적용할 수 없는 비교: in-capsule을 iSCSI 대비 왕복 감소의 증거로 쓰지 않는다. NVMe/RDMA의 결과를 NVMe/TCP의 성능으로 옮기지 않는다.

## 5. 타깃 구현과 백엔드가 이점을 바꾸는 조건

{{< lane src="_lane/5-tcp-구현-조합.json" />}}

세 막대는 같은 TCP 보고서(SPDK 24.05, 타깃 Xeon Gold 6348, 커널 6.0.18)에서 나왔습니다. 커널 타깃에서 SPDK 타깃으로 바꾸면 20.43µs, initiator까지 SPDK로 바꾸면 17.50µs입니다 `Ⓑ`. SPDK의 NVMe/TCP도 Linux 커널 TCP 스택 위에서 돌기 때문에 SPDK를 쓴다고 커널 처리가 모두 사라지지는 않습니다 `✓`. "SPDK가 더 빠르다"는 말은 TCP QD1 평균에서 타깃만 바꾸면 약 1µs, initiator까지 바꾸면 약 4µs 차이라는 뜻입니다. 평균 지연, 꼬리 지연, 절대 처리량, 코어당 효율은 서로 다른 지표이니 나눠서 봐야 합니다.

| QD1 4KiB 랜덤 읽기(null 블록 장치, 타깃 1코어, 커널 initiator) | 평균 | p99.9 | p99.99 |
|---|---|---|---|
| 커널 타깃 | 21.39µs | 33.0µs | 59.6µs |
| SPDK 타깃 | 20.43µs | 43.3µs | 106.0µs |

평균은 거의 같은데 꼬리는 커널 타깃이 낮습니다 `Ⓑ`. LeapIO(ASPLOS'20)도 RDMA 환경의 YCSB/RocksDB 실험에서 커널 NVMe-oF가 가장 안정적이었고 SPDK는 32스레드에서 p99.9 14ms, p99.99 약 2,000ms까지 갔다고 보고합니다 `Ⓑ`. 2020년 구현에 RDMA·YCSB 조건이라 위 표와 규모를 맞댈 수 없지만 방향은 같습니다. 꼬리 지연을 SLO로 잡는다면 평균만으로 고르기 어렵습니다 `Σ`.

처리량과 코어 효율은 연결 수에 따라 달라집니다. 같은 보고서에서 장비는 Kioxia KCM61VUL3T20 14개, 100GbE ConnectX-5 4장 직결이고 4KiB 랜덤 읽기 QD384, subsystem 14개, 커널 initiator입니다. SPDK 타깃은 24코어로 묶었고 커널 타깃에는 코어 제한을 걸지 않았습니다.

| subsystem당 연결 | 타깃 | IOPS | 사용 코어 | 코어당 IOPS |
|---|---|---|---|---|
| 8 | 커널 nvmet | 9,796K | 57.3 | 약 171K `≈` |
| 8 | SPDK | 7,831K | 30.3 | 약 258K `≈` |
| 1 | 커널 nvmet | 4,018K | 20.5 | 약 196K `≈` |
| 1 | SPDK | 4,197K | 28.7(24코어 고정 폴링) | 약 146K `≈` |

보고서는 SPDK 타깃의 코어당 IOPS가 커널 타깃의 최대 1.69배(읽기), 1.39배(쓰기), 1.48배(혼합)라고 결론짓습니다 `Ⓑ`. 연결이 하나이면 24코어를 고정 폴링한 SPDK보다 커널 nvmet이 더 효율적이었고, SPDK 코어를 4개로 줄여 다시 재면 SPDK가 1.38배라고 덧붙입니다. 연결이 8개인 행에서는 코어를 더 쓴 커널 타깃의 절대 처리량이 높습니다. 타깃 코어를 제한하는 쪽도 있습니다. ntprof는 커널 타깃의 코어를 드라이브당 1개로 묶으면 iodepth 16 이후 처리량이 252.4에서 284.9MB/s로 거의 늘지 않고 지연만 238.7µs에서 431.0µs로 뛴다고 보고합니다 `Ⓑ`.

RDMA는 같은 랩의 별도 보고서에 있고, TCP와 같은 서버·같은 커널이지만 다른 시험이라 위 막대에 합치지 않았습니다 `Ⓑ`.

| RDMA QD1 4KiB 랜덤 읽기(null 블록 장치, 타깃 1코어) | 평균 |
|---|---|
| 커널 타깃 + 커널 initiator | 12.10µs |
| SPDK 타깃 + 커널 initiator | 9.39µs |
| SPDK 타깃 + SPDK initiator | 4.72µs |

배포판의 지원 범위도 구현 선택에 걸립니다. RHEL 9·10의 Managing storage devices는 NVMe/TCP 장에서 host만 fully supported로 두고 "Red Hat does not support the NVMe Target (nvmet) functionality", "The NVMe/TCP controller (nvmet-tcp) module is not supported"라고 적습니다 `✓`. 9.0 릴리스 노트는 nvmet_tcp.ko를 Unmaintained로 분류했습니다 `✓`. 같은 가이드의 NVMe/RDMA 장은 nvmet-rdma 설정 절차를 미지원 문구 없이 싣고 있어 RDMA 타깃의 지원 범위는 문서만으로 단정할 수 없습니다.

namespace 뒤의 논리 볼륨 계층에도 값이 붙습니다. SPDK bdev 계층 자체가 raw polled-mode 드라이버보다 랜덤 읽기 약 11.6%, 랜덤 쓰기 약 19.8%의 오버헤드를 더한다는 것이 bdev 보고서(24.05)의 값이고, 큐 깊이와 코어 수는 확인하지 못했습니다 `Ⓑ` `?`. lvol은 vhost-scsi 뒤에서 split NVMe bdev 대비 IOPS 차이가 +3.15%에서 −9.54%였고 보고서 결론은 7~10% 낮다는 것입니다. 드라이브 한 장을 VM 둘이 나눠 쓰는 조건에서는 차이가 잡음 수준이었습니다(QD1 4K 랜덤 읽기 24.17k 대 24.26k IOPS) `Ⓑ`. lvol은 blobstore 위의 lvolstore에 만들고 lvol 하나가 blob 하나이며, 기본 cluster 4MiB를 첫 쓰기 때 할당하고, snapshot은 읽기 전용이고 clone은 snapshot에서 만듭니다 `✓`. 커널 dm-thin은 메타데이터를 별도 장치에 두고 데이터 블록 크기(64KiB~1GiB)를 만든 뒤에 바꿀 수 없으며, 새로 할당한 블록을 기본으로 0으로 채웁니다 `✓`. dm-thin의 지연·IOPS 실측은 찾지 못했습니다 `?`.

- 바뀐 것: 타깃 프로그램(커널·SPDK)과 initiator 구현이 달라지면 평균 지연이 수 µs, 코어당 IOPS가 수십 %씩 움직인다.
- 남은 비용: SPDK도 커널 TCP를 쓰고, 고정 폴링 코어와 꼬리 지연이 따라온다. lvol·thin 계층은 따로 더해진다.
- 적용할 수 없는 비교: 로컬 대비 증가분이나 순수 네트워크 지연으로 읽지 않는다. TCP 막대와 RDMA 값을 한 차트에 섞지 않는다.

## 6. RBD와 Kubernetes 스토리지에도 같은 설명이 적용되는가

| 구현 | 호스트·프런트엔드 | namespace 뒤 경로 | 남는 비용 |
|---|---|---|---|
| Ceph NVMe-oF gateway | NVMe/TCP namespace | RBD 이미지에 대응하는 SPDK bdev. namespace는 RADOS 클러스터 컨텍스트에 매핑된다 `✓` | 이미지를 RADOS 객체로 쪼개 OSD에 배치하고 복제하는 비용이 그대로 남는다 `≈` |
| OpenEBS Mayastor | NVMe-oF 타깃 | nexus → child → replica(lvol bdev) → base bdev → 디스크. 원격 replica는 SPDK 유저모드 initiator·target으로 NVMe-oF 연결 `✓` | 쓰기는 건강한 모든 child에 보내 전부 완료돼야 initiator에 돌려준다 `✓` |
| Longhorn V1 | iSCSI | engine과 replica가 리눅스 프로세스 `✓` | 복제 쓰기, 프로세스 경로 |
| Longhorn V2 | NVMe-TCP 또는 UBLK | engine은 SPDK RAID bdev, replica는 SPDK lvol bdev `✓` | 복제 쓰기, lvol |

RBD는 iSCSI·NVMe-oF와 층이 다릅니다. 이 둘은 서버 한 대의 블록 장치를 그대로 내보내지만, RBD는 이미지를 RADOS 객체(기본 4M, 4K~32M)로 쪼개 여러 OSD에 분산하는 스토리지가 블록 장치의 모양을 하고 있습니다 `✓`. 경로에 블록-객체 매핑, CRUSH 배치, OSD 복제가 더해지는데 `≈`, primary OSD가 복제본에 쓰고 응답을 모으는 흐름은 공식 문서에서 확인하지 못했습니다 `?`. 앞쪽에 NVMe/TCP를 붙여도 RBD의 객체 저장 계층은 사라지지 않습니다.

Ceph gateway의 비용을 직접 잰 값은 많지 않습니다. rook 토론(#17210)에 올라온 사용자 보고는 krbd 465k 대 NVMe-oF 87.4k 랜덤 읽기 IOPS입니다(4k, iodepth=1, numjobs=64, EPYC 9654, 7.68TB NVMe 22장 × 3노드, Ceph 20.2.0, Rook v1.19.0). 토론의 결론은 원인이 nvmeof 스택이 아니라 SDN 오버레이(OVN-Kubernetes)라는 것입니다 `Ⓑ`. 사용자 보고 하나라 재현성은 확인하지 못했습니다 `?`. ceph.io 블로그(2025-02, IBM 저자)는 4노드·OSD 96개에서 16K 70:30으로 450,000 IOPS 이상이라고 적지만 CPU·NIC·큐 깊이와 RBD 직접 접속 대비 값이 없어 게이트웨이의 비용은 알 수 없습니다 `Ⓥ`.

Mayastor는 개발사 MayaData의 글(2021년으로 추정)이 조건을 밝힌 유일한 실측입니다. 커널 5.8, Xeon Gold 6252, Optane, ConnectX-6에서 fio 4K QD64×8로 로컬 585K IOPS에 1 replica 579K(읽기), 516K에 490K(쓰기)였습니다 `Ⓥ`. Optane 모델과 지연 값이 없고, 현재 버전(OpenEBS 4.x)의 공식 벤치마크는 찾지 못했습니다.

Longhorn은 프런트엔드만 바뀐 사례가 아닙니다. 아래는 프로젝트의 v1.12.0 벤치마크(2026-07-19; OCI VM.DenseIO.E5.Flex EPYC 9J14 3노드, Ubuntu 24.04 커널 6.17, Samsung MZWLR7T6HBLA, kbench/fio, IOPS는 bs=4K iodepth=128 numjobs=8, 지연은 bs=4k iodepth=1)입니다. V1과 V2는 프런트엔드(iSCSI 대 NVMe-TCP)뿐 아니라 engine 구현(리눅스 프로세스 대 SPDK)도 다르므로, 표는 iSCSI 대 NVMe-oF의 순수 효과가 아니라 구현 전체를 바꾼 결과입니다.

| 구성 | 랜덤 읽기 IOPS | 랜덤 쓰기 IOPS | QD1 읽기 지연 | QD1 쓰기 지연 |
|---|---|---|---|---|
| 기준선 local-path | 1,468K | 686K | 79µs | 24µs |
| V1 · replica 1 | 29,297 | 32,063 | 325µs | 269µs |
| V2 · replica 1 · SPDK 1코어 | 57,022 | 78,379 | 140µs | 86µs |
| V2 · replica 1 · SPDK 16코어 | 442,053 | 510,846 | 134µs | 84µs |
| V1 · replica 3 | 27,524 | 22,155 | 583µs | 663µs |
| V2 · replica 3 · SPDK 16코어 | 480,375 | 255,473 | 481µs | 482µs |

기준선 대비 랜덤 읽기 IOPS는 V1 약 2%, V2 1코어 약 4%, V2 16코어 약 30%이고, QD1 읽기 지연은 기준선 79µs 위에 V2가 약 55~61µs, V1이 약 246µs를 더합니다 `≈`. V2는 SPDK 코어 수가 IOPS를 좌우합니다. 동기 복제의 비용도 보입니다. V2 랜덤 쓰기는 replica를 1개에서 3개로 늘리면 QD1 지연이 84µs에서 482µs로, IOPS가 510,846에서 255,473으로 변합니다 `Ⓑ`. 측정 환경이 OCI VM이라 기준선 NVMe도 이미 클라우드 가상화 계층을 거친 값입니다 `≈`.

- 바뀐 것: 호스트 앞쪽 인터페이스가 NVMe/TCP가 된다.
- 남은 비용: RBD의 객체 매핑·배치·복제, Mayastor와 Longhorn의 동기 복제 쓰기, lvol 계층.
- 적용할 수 없는 비교: Longhorn V1 대 V2를 iSCSI 대 NVMe-oF의 효과로 읽지 않는다. 기준선도 VM 안의 값이다.

## 7. 내 환경에서 비교할 항목과 자료의 한계

| 맞춰야 할 항목 | 기준 | 이 글의 자료가 갖춘 것 |
|---|---|---|
| 전송 | 같은 장비·같은 initiator 커널·같은 타깃 구현에서 iSCSI, NVMe/TCP, NVMe/RDMA, 로컬 | 한 장비에서 셋 이상을 잰 자료는 StarWind 하나이고 initiator 커널이 5.4, 타깃이 SPDK다 |
| 평균과 꼬리 | 평균과 p99.9 이상을 같이 | p99.9 이상까지 낸 자료는 SPDK 24.05 TCP 보고서와 LeapIO 정도다 |
| 큐 깊이 | QD1 지연과 높은 QD 처리량을 따로 | 자료마다 QD가 다르다 |
| CPU | 호스트·타깃 사용 코어, 폴링 전용 코어 여부 | Guz, i10, SPDK 보고서에 있고 서로 맞댈 수 없다 |
| 백엔드 | null 장치, 실제 SSD, lvol, 복제 | 자료마다 다르다 |
| 보호 옵션 | digest, TLS 켬/끔 | digest는 큰 블록 read 한 건, TLS는 직접 비교가 없다 |

StarWind의 2024년 글이 가장 가깝습니다. Optane P5800X 한 장과 100GbE ConnectX-5에서 SPDK 타깃(v23.05, 타깃 커널 5.15)을 리눅스 initiator(커널 5.4)로 쟀고, 세 전송 모두 SPDK 타깃입니다 `Ⓥ`.

{{< lane src="_lane/7-starwind-qd1.json" />}}

4K 랜덤 쓰기 QD1에서는 RDMA 28,000 IOPS·0.033ms, TCP 15,500 IOPS·0.063ms, iSCSI 8,716 IOPS·0.113ms였습니다. 다중 스레드 행은 프로토콜마다 numjobs·iodepth가 달라 지연끼리 비교할 수 없고, RDMA 1,558K, TCP 1,503K, iSCSI 1,272K IOPS로 로컬 1,552K(numjobs=6, iodepth=4)에 RDMA·TCP는 가깝고 iSCSI는 82% 수준이라는 것만 읽을 수 있습니다. 로컬 QD1 값이 없어 전송이 더한 지연도 구할 수 없고, 타깃이 커널 nvmet·LIO가 아니라 SPDK이며, 벤더 블로그라 원자료와 스크립트가 공개돼 있지 않습니다.

확인하지 못한 것은 다음 항목입니다.

- 커널 6.x에서 로컬 NVMe, NVMe/RDMA, NVMe/TCP, iSCSI를 한 장비에서 같이 잰 공개 자료를 찾지 못했다. 표의 값은 2017~2026년, 커널 4.4~6.17에 걸쳐 있고 장치도 다르다.
- NVMe/TCP에서 TLS를 켠 비용의 직접 비교와, 다이제스트의 4K·쓰기·지연 수치를 찾지 못했다.
- Guz 논문 본문을 열지 못해 iSCSI의 전송 구성, 커널 버전, 그래프의 절대값은 확인하지 못했다. ReFlex·i10이 재인용한 "iSCSI 코어당 약 70K IOPS"의 원 출처도 열지 못해 본문에서 뺐다.
- ntprof의 연결 하나·job 5→6개 측정은 fact sheet 한 줄로만 보았고 §4.3 원문은 열지 못했다. 3절의 해석에 `Σ`를 붙인 이유다.
- Mayastor는 현재 버전의 조건 명시 벤치마크를, Ceph NVMe-oF gateway는 사용자 보고와 조건이 불충분한 공식 블로그 외의 실측을 찾지 못했다.
- Ceph primary OSD의 복제 쓰기 흐름 원문은 확인하지 못했다.
- NVMe SR-IOV SSD와 live migration 구현 상태는 VM 쪽 주제라 [02]({{< relref "../02-vm-disk-paths/index.md" >}})에서 다룬다.

## 부록. 용어·설정·연혁·추가 실측

### 용어

| 용어 | 뜻 |
|---|---|
| IQN | iSCSI initiator·target의 이름. `iqn.2006-04.com.example:444` 꼴이다 `✓` |
| LUN · TPG · ACL | target 안의 장치, 포털 그룹, 접근 제어 `✓` |
| CmdSN · R2T | 세션 전체에서 매기는 명령 번호, 쓰기 데이터를 요청하는 메시지 `✓` |
| NQN | NVMe-oF subsystem의 이름 `✓` |
| capsule | NVMe-oF에서 명령·응답을 나르는 정보 단위 `✓` |
| association | host가 controller의 Admin Queue에 연결할 때 생기는 관계 `✓` |

### iSCSI 구성과 iSER

iSCSI는 SCSI 명령을 TCP 위에서 나르는 전송 프로토콜입니다. RFC 7143(2014-04)이 RFC 3720 등 앞선 문서를 통합했습니다. SCSI 계층이 만든 CDB를 iSCSI 계층이 PDU로 감싸 하나 이상의 TCP 연결(포트 3260)로 주고받으며, 기본 헤더(BHS)는 48바이트 고정입니다 `✓`. 세션은 SCSI I_T nexus와 같은 것이고 CmdSN은 세션 전체에서 매기며 한 연결 안에서는 CmdSN 순서대로 보내야 합니다. HeaderDigest·DataDigest(CRC32C)는 선택입니다 `✓`.

타깃은 커널의 LIO이고 `targetcli`로 설정합니다. backstore는 fileio·block·pscsi·ramdisk 네 종류이며, block은 로컬 블록 장치를 통째로 LUN으로 내보냅니다. 순서는 `/backstores/block`에서 `create name=block_backend dev=/dev/sdb`, `/iscsi`에서 IQN 생성, `luns/`에서 backstore를 LUN에 연결하는 것입니다 `✓`. iSER(RFC 7145, 2014-04)는 같은 iSCSI를 RDMA(iWARP, InfiniBand RC) 위에서 동작시키고 RDMA Read/Write로 데이터를 SCSI I/O 버퍼에 중간 복사 없이 놓습니다 `✓`. 세션당 scsi_host와 연결이 하나라는 구조는 iscsi_tcp와 같고, 이 글의 자료에는 iSER 실측이 없습니다.

### NVMe-oF 구성 절차

SPDK 타깃에서 가상 NVMe 장치를 내는 순서입니다. "새 SSD를 만드는" 일이 아니라 블록 장치에 namespace 번호를 붙여 subsystem에 넣고 포트를 열어 두는 일입니다 `✓`.

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

호스트는 `nvme discover`와 `nvme connect` 대신 `nvme connect-all`을 쓸 수도 있습니다 `✓`. 커널 nvmet은 같은 구조를 configfs에 만듭니다. subsystem을 만들고, namespace의 device path에 블록 장치를 적어 enable하고, port를 만든 뒤 port에 subsystem을 연결하는 순서입니다 `✓`. LVM 논리 볼륨의 경로도 블록 장치 경로이니 그 자리에 들어가지만, 이 대입을 직접 다룬 문서는 확인하지 못했습니다 `≈`. 포트는 4420이 NVMe-oF용, 8009가 discovery용입니다 `✓`.

### 전송별 차이

| 전송 | 데이터 교환 모델 | 큐와 연결 | 비용이 붙는 곳과 확인 상태 |
|---|---|---|---|
| TCP | message. capsule만 주고받는다 | 큐 쌍 1개 = TCP 연결 1개 | 작은 PDU마다 TCP/IP 처리, 스레드 간 컨텍스트 스위치, 복사와 CRC `Ⓑ`. 기존 소켓 인터페이스를 쓰는 소프트웨어 구현을 허용하도록 정의됐다 `✓` |
| RDMA | message/memory. capsule에 원격 메모리 읽기·쓰기를 섞는다 | 큐 쌍 1개 = RDMA QP 1개 | iWARP·InfiniBand·RoCE 위에서 Reliable Connected QP를 쓴다 `✓` |
| FC | message | 확인하지 못함 `?` | NVMe 2.0 전송 스펙 목록에 들어 있다 `✓`. nvme-fc가 들어간 커널 버전은 확인하지 못했다 `?` |

### 연혁

NVMe-oF 1.0이 2016년 6월에 나왔고 Linux 4.8(2016-10)에 RDMA용 host와 target이 들어갔습니다. TCP 전송은 2018년 11월에 비준 소식이 공개됐으며 Linux 5.0(2019-03)에 host와 target이 한 릴리스로 들어갔습니다. 멀티패스는 4.15, ANA는 4.19에 들어갔습니다 `✓`. 1.1a(2021) 이후 NVMe-oF 스펙은 따로 개정되지 않고 NVMe 2.0 Base 스펙으로 흡수됐고, TCP 전송 스펙은 2025년 개정 1.2까지 확인했습니다 `✓`.

### 추가 실측

ReFlex(ASPLOS'17)는 Xeon E5-2630(12코어, 2소켓), Intel 82599ES 10GbE에 Arista 7050S-64 스위치, Ubuntu 16.04 커널 4.4, 1M IOPS급 NVMe, jumbo frame, LRO/GRO를 끈 조건에서 4KB 랜덤 QD1 지연을 쟀습니다 `Ⓑ`. 위 본문의 수치와 장치·링크가 달라 맞대지 않는 독립된 과거 측정입니다.

| 구성 | 읽기 평균 / p95 | 쓰기 평균 / p95 |
|---|---|---|
| 로컬(SPDK) | 78 / 90µs | 11 / 17µs |
| iSCSI | 211 / 251µs | 155 / 215µs |
| libaio 서버 + Linux 클라이언트 | 183 / 205µs | 확인하지 않음 |
| ReFlex 서버 + IX 클라이언트 | 99 / 113µs | 31 / 34µs |

저자는 10GbE TCP/IP가 소프트웨어 스토리지 스택에 닿기 전에 무부하 지연을 최소 50µs 늘린다고 적습니다 `Ⓑ`.

SPDK 24.05 TCP 보고서에서 SPDK 타깃은 4KiB 랜덤 읽기 1코어 611.3K, 8코어 5,571K, 12코어 8,307K IOPS로 늘다가 48코어에서 11,059K(362Gbps)로 링크가 포화됩니다. RDMA 보고서(QD128)의 1코어 값은 1,564.5K라 TCP와 QD가 달라 배수를 내지 않습니다 `Ⓑ`. 타깃 소프트웨어를 DPU로 옮긴 실측은 SPDK 26.01 RDMA 보고서(NVIDIA, 2026-02)에 있습니다. BlueField-3(Arm Cortex-A78AE 16코어, 커널 5.15)에서 SPDK 타깃을 돌리고 200GbE 2포트, SSD 16개 JBOF를 거친 조건에서 4KiB 랜덤 읽기 QD64는 1코어 469.8K, 8코어 6,135K, 16코어 10,091K IOPS였습니다 `Ⓑ`.

iSCSI와의 직접 비교는 벤더 자료가 많습니다. Blockbridge(Proxmox 7.2, 커널 5.15.53, EPYC 7452, ConnectX-5 100GbE, VM 32대, 자사 백엔드)는 NVMe/TCP가 iSCSI보다 512B 평균 IOPS가 35.4% 높고 4K QD4에서 IOPS 50% 이상, 지연 33% 낮다고 보고하지만, 대역폭이 한계인 큰 블록에서는 차이가 약 0.1%입니다 `Ⓥ`. Dell PowerStore(ESXi, 기본 설정; 발행 연도 미확인)는 iSCSI의 IOPS가 가장 낮고 지연과 IO당 CPU가 가장 높으며, NVMe/TCP@25GbE가 쓰기에서 NVMe/FC·FCP@32GFC와 비슷하고 읽기에서 20% 이내로 뒤진다고 적습니다 `Ⓥ`.

Mayastor는 Intel·MayaData 공동 문서가 Optane P5800X raw 대비 오버헤드를 10% 미만이라고 주장했지만 Blocks & Files는 수치가 불완전하고 단위가 정의되지 않아 비교할 수 없다고 지적했습니다 `Ⓥ`. SUSE의 Longhorn 1.6.0 발표(2024)는 V2가 V1보다 쓰기 2~4배, 랜덤 읽기 2~3배, 지연 50~70% 감소이고 단일 replica IOPS가 로컬 디스크와 비슷하다고 주장했는데 `Ⓥ`, 원 측정 조건은 확인하지 못했고 v1.12.0의 기준선 대비 30%와도 어긋납니다. Ceph NVMe-oF gateway의 한계는 개발 버전 문서 기준으로 gateway 그룹 4개, 그룹당 gateway 8개, 그룹당 subsystem 128개, subsystem당 호스트 32개, 그룹당 namespace 1,024개이고 `✓`, IBM Storage Ceph 7.1 문서의 사이징은 목표 100,000 IOPS에 reactor 코어 1개·총 16코어, 200,000에 2개·18코어, 250,000에 4개·22코어, 300,000에 8개·30코어입니다 `Ⓥ`.

### 그 밖의 방식

FC와 FCoE는 전용 패브릭이나 이더넷 위의 SCSI를 나릅니다. FC는 NVMe 명령도 싣는 NVMe-oF 전송의 하나입니다 `✓`. FCP·FCoE의 1차 표준 문서는 확인하지 못했습니다 `?`. NBD는 블록 읽기 요청마다 TCP로 서버에 보내고 읽은 데이터를 돌려받습니다. 커널 모듈은 클라이언트에만 있고 nbd-server는 전부 유저스페이스입니다 `✓`. 이 글의 질문을 풀 만한 독립 실측은 없어 위치만 적었습니다.

## 참고 자료

- [RFC 7143 iSCSI Protocol (Consolidated)](https://www.rfc-editor.org/rfc/rfc7143.txt) — IETF, 2014. iSCSI 구조·세션·CmdSN·R2T·다이제스트
- [RFC 7145 iSER](https://www.rfc-editor.org/rfc/rfc7145.html) — IETF, 2014. iSER 구조
- [open-iscsi README](https://raw.githubusercontent.com/open-iscsi/open-iscsi/master/README) — open-iscsi, 현행. 세션당 scsi_host·연결 1개
- [Linux scsi_lib.c](https://raw.githubusercontent.com/torvalds/linux/master/drivers/scsi/scsi_lib.c) · [iscsi_tcp.c](https://raw.githubusercontent.com/torvalds/linux/master/drivers/scsi/iscsi_tcp.c) · [nvme/host/fabrics.c](https://raw.githubusercontent.com/torvalds/linux/master/drivers/nvme/host/fabrics.c) · [tcp.c](https://raw.githubusercontent.com/torvalds/linux/master/drivers/nvme/host/tcp.c) — torvalds/linux master. 하드웨어 큐 수 기본값, NVMe/TCP의 CPU 수만큼 I/O 큐와 io_cpu
- [Linux 4.8](https://kernelnewbies.org/Linux_4.8) · [4.15](https://kernelnewbies.org/Linux_4.15) · [4.19](https://kernelnewbies.org/Linux_4.19) · [5.0](https://kernelnewbies.org/Linux_5.0) · [6.7](https://kernelnewbies.org/Linux_6.7) — kernelnewbies. scsi-mq 기본화·non-mq 제거, fabrics·멀티패스·ANA·NVMe/TCP·in-kernel TLS 편입 버전
- [NVMe Multipath](https://docs.kernel.org/admin-guide/nvme-multipath.html) — Linux kernel 문서. I/O 정책과 ANA 우선순위
- [Configuring an iSCSI target](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_storage_devices/configuring-an-iscsi-target_managing-storage-devices) — Red Hat, RHEL 9. LIO·targetcli·backstore 종류와 설정 순서
- [Configuring NVMe over fabrics using NVMe/TCP](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_storage_devices/configuring-nvme-over-fabrics-using-nvme-tcp_managing-storage-devices) · [RHEL 10 Managing storage devices](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/10/html-single/managing_storage_devices/index) · [RHEL 9.0](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html-single/9.0_release_notes/index) · [9.6](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html-single/9.6_release_notes/index) · [10.0](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/10/html-single/10.0_release_notes/index) 릴리스 노트 — Red Hat. nvmet 미지원 문장은 Managing storage devices의 NVMe/TCP 장 기준, nvmet_tcp.ko의 Unmaintained 분류, TLS의 Technology Preview(9.6·10.0 릴리스 노트)
- [Network Block Device](https://docs.kernel.org/admin-guide/blockdev/nbd.html) — Linux 커널 문서. NBD 구조
- [Ceph Block Device](https://docs.ceph.com/en/latest/rbd/) · [rbd(8)](https://docs.ceph.com/en/latest/man/8/rbd/) — Ceph 문서. RBD 객체 분산, 기본 객체 크기
- [NVMe-oF Gateway](https://docs.ceph.com/en/latest/rbd/nvmeof-overview/) · [ceph-nvmeof](https://github.com/ceph/ceph-nvmeof) — Ceph. RBD 이미지를 NVMe/TCP로 내보내는 gateway 구조와 한계
- [Performance at Scale with NVMe over TCP](https://ceph.io/en/news/blog/2025/nvme-gateway-perf-mb/) — Burkhart·D'Atri(IBM), ceph.io, 2025-02-03. gateway 측정과 빠진 조건
- [NVMe performance best practices](https://www.ibm.com/docs/en/storage-ceph/7.1.0?topic=gateway-nvme-performance-best-practices) — IBM Storage Ceph 7.1. gateway 코어 사이징
- [rook/rook Discussion #17210](https://github.com/rook/rook/discussions/17210) — 사용자 보고, 2026. krbd 대 NVMe-oF gateway 실측
- [NVMe over Fabrics Specification](https://nvmexpress.org/specification/nvme-of-specification/) · [NVMe over Fabrics 1.1a](https://nvmexpress.org/wp-content/uploads/NVMe-over-Fabrics-1.1a-2021.07.12-Ratified.pdf) — NVM Express. 1.0~1.1a 연혁, subsystem·association·capsule·RDMA 큐 매핑
- [NVMe over TCP Transport Specification 1.2](https://nvmexpress.org/wp-content/uploads/NVM-Express-NVMe-over-TCP-Transport-Specification-Revision-1.2-2025.08.01-Ratified.pdf) — NVM Express, 2025. TCP 연결과 큐 쌍의 1:1 대응, in-capsule·R2T·다이제스트·TLS
- [Welcome NVMe/TCP to the NVMe-oF Family of Transports](https://nvmexpress.org/welcome-nvme-tcp-to-the-nvme-of-family-of-transports/) — Grimberg·Minturn, 2018. NVMe/TCP 비준 시점
- [NVMe 2.0 Library of Specifications 발표](https://nvmexpress.org/nvm-express-announces-the-rearchitected-nvme-2-0-library-of-specifications/) — NVM Express, 2021. 전송 스펙 목록(PCIe·FC·RDMA·TCP)
- [NVMe over Fabrics 문서](https://spdk.io/doc/nvmf.html) · [Logical Volumes](https://spdk.io/doc/logical_volumes.html) — SPDK. 타깃 구조, 절차, lvol 동작
- [Thin provisioning](https://docs.kernel.org/admin-guide/device-mapper/thin-provisioning.html) — Linux kernel 문서. dm-thin 블록 크기와 제로잉
- [NVMe-oF target offload](https://networking-docs.nvidia.com/doca/archive/3-4-0/nvme-of-nvm-express-over-fabrics) — NVIDIA DOCA 문서. 타깃 오프로드 설명
- [NVMe-over-Fabrics Performance Characterization (슬라이드)](https://www.systor.org/2017/slides/NVMe-over-Fabrics_Performance_Characterization.pdf) — Guz 외(Samsung), SYSTOR'17. 로컬 대 NVMe/RDMA 대 iSCSI 지연 분해, 처리량·CPU·RocksDB
- [ReFlex: Remote Flash ≈ Local Flash](https://people.ucsc.edu/~hlitz/papers/reflex.pdf) — Klimovic·Litz·Kozyrakis, ASPLOS'17. 로컬 대 iSCSI 지연, iSCSI 지연 원인
- [TCP ≈ RDMA: CPU-efficient Remote Storage Access with i10](https://www.usenix.org/system/files/nsdi20-paper-hwang.pdf) — Hwang 외, NSDI'20. 커널 iSCSI의 CPU 비효율, 코어당 처리량과 TCP 지연 원인
- [Understanding and Profiling NVMe-over-TCP Using ntprof](https://www.usenix.org/system/files/nsdi25-kang.pdf) — Kang·Liu, NSDI'25. 네트워크 단계 비중, in-capsule 경계, 연결·타깃 코어 한계
- [Autonomous NIC Offloads](https://borispis.github.io/files/2021-l5o.pdf) — Pismenny 외, ASPLOS'21. 복사·CRC 비용
- [[PATCH v30 00/20] nvme-tcp receive offloads](https://lists.infradead.org/pipermail/linux-nvme/2025-July/057473.html) — NVIDIA(Aurelien Aptel), linux-nvme, 2025-07-15. 데이터 다이제스트 켠 소프트웨어 경로 기준선
- [SPDK NVMe-oF TCP Performance Report 24.05](https://review.spdk.io/download/performance-reports/SPDK_tcp_mlx_perf_report_2405.pdf) · [RDMA Performance Report 24.05](https://review.spdk.io/download/performance-reports/SPDK_rdma_mlx_perf_report_2405.pdf) — Intel, 2024. QD1 왕복 지연과 커널 대 SPDK 타깃
- [SPDK NVMe-oF RDMA Performance Report 26.01](https://review.spdk.io/download/performance-reports/SPDK_rdma_nvda_perf_report_2601.pdf) — NVIDIA, 2026. BlueField-3 타깃
- [SPDK Vhost Performance Report 24.05](https://review.spdk.io/download/performance-reports/SPDK_vhost_perf_report_2405.pdf) · [NVMe BDEV Performance Report 24.05](https://review.spdk.io/download/performance-reports/SPDK_nvme_bdev_perf_report_2405.pdf) — Intel, 2024. lvol·bdev 오버헤드
- [LeapIO](https://ucare.cs.uchicago.edu/pdf/asplos20-LeapIO.pdf) — Li 외, ASPLOS'20. 커널 대 SPDK NVMe-oF의 꼬리 지연
- [iSCSI vs NVMe-oF: Performance Comparison](https://www.starwindsoftware.com/blog/iscsi-vs-nvme-of-performance-comparison/) — StarWind, 2024-04-04. 벤더 측정, 한 장비에서 세 전송의 QD1 지연
- [Proxmox: iSCSI and NVMe/TCP shared storage comparison](https://kb.blockbridge.com/technote/proxmox-iscsi-vs-nvmetcp/) — Blockbridge. 벤더 측정(게시일 미확인)
- [NVMe Transport Performance Comparison (H18892.2)](https://www.delltechnologies.com/asset/en-gb/products/storage/industry-market/h18892-nvme-transport-performance-comparison.pdf) — Dell. 벤더 측정(발행 연도 미확인)
- [I/O Path Description](https://openebs.io/docs/user-guides/replicated-storage-user-guide/replicated-pv-mayastor/additional-information/io-path-description) — OpenEBS 문서. Mayastor 경로와 복제 쓰기
- [Mayastor NVMe-oF TCP performance](https://web.archive.org/web/20230924005944/https://blog.mayadata.io/mayastor-nvme-of-tcp-performance) — MayaData, 2021 추정(Wayback 사본). 개발사 실측
- [Intel says Mayastor is fastest open source storage. So where are the numbers?](https://blocksandfiles.com/2021/03/08/intel-says-mayastor-is-fastest-open-source-storage/) — Blocks & Files, 2021-03-08
- [Longhorn Concepts (1.9.0)](https://longhorn.io/docs/1.9.0/concepts/) · [Performance Benchmark wiki](https://github.com/longhorn/longhorn/wiki/Performance-Benchmark) · [v1.12.0 report.pdf](https://github.com/user-attachments/files/30166023/report.pdf) — Longhorn 프로젝트. V1·V2 구조와 2026-07-19 벤치마크
- [Announcing Longhorn 1.6.0](https://www.suse.com/c/rancher_blog/announcing-longhorn-1-6-0/) — SUSE, 2024-02-19. V2 성능 주장
