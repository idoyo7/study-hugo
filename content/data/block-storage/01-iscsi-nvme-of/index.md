---
title: "iSCSI와 NVMe-oF — 네트워크 블록 경로와 비용"
linkTitle: "01 iSCSI와 NVMe-oF"
description: "iSCSI 대비 NVMe-oF의 호스트 경로·큐 구조·쓰기 데이터 흐름의 차이, 타깃이 내보내는 가상 NVMe controller와 namespace, 타깃 구현과 백엔드가 이점을 바꾸는 조건을 측정 조건과 함께 정리한다."
weight: 1
date: 2026-10-04
lastmod: 2026-10-04
aliases: ["/storage/01-network-block/", "/storage/02-nvme-of/"]
url: "/storage/01-iscsi-nvme-of/"
---

# 01 · iSCSI와 NVMe-oF — 네트워크 블록 경로와 비용

NVMe SSD가 꽂힌 서버의 용량을 다른 호스트에 내줄 때, iSCSI를 NVMe-oF로 바꾸면 호스트의 명령 처리 경로와 큐 배치가 달라집니다. SCSI 중간 계층과 명령을 감싸는 단계가 빠질 여지는 있지만, TCP를 쓰면 TCP/IP 처리와 복사·CRC 비용은 남습니다. 타깃이 namespace 뒤에 연결한 볼륨과 복제 계층도 그대로입니다.

따라서 성능을 비교하려면 전송 규약, 타깃 구현, 백엔드가 각각 무엇을 처리하는지 알아야 합니다. NVMe-oF는 NVMe 명령을 네트워크로 주고받는 규약이며, 소프트웨어 타깃은 그 규약에 맞는 controller를 구현합니다. 호스트에 보이는 NVMe 장치를 물리 SSD의 controller와 같은 것으로 이해하면 중간의 처리 비용을 놓치게 됩니다.

공개 측정은 장치·커널·블록 크기·큐 깊이가 서로 달라 같은 자료 안에서만 비교합니다. 수치와 조건은 각 절의 '근거와 측정 조건'에 두었습니다. 네트워크로 받은 장치를 VM에 전달하는 방식은 [02 VM 디스크 경로]({{< relref "/data/block-storage/02-vm-disk-paths/index.md" >}})에서 다룹니다.

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

## 1. iSCSI보다 무엇이 가벼워지고, 무엇은 남는가

| 기대하는 이점 | 구조상 이유 | 이점이 줄거나 판단이 달라지는 조건 |
|---|---|---|
| 호스트 명령 처리 경로 단순화 | SCSI 중간 계층과 iSCSI 계층 자리에 NVMe host와 전송 계층이 들어간다 | TCP/IP 처리·복사·CRC는 남는다. 제거된 처리만의 독립 실측은 없다 |
| 요청 처리의 병렬성 | NVMe는 큐 쌍 구조이고 Linux host는 CPU마다 I/O 큐와 연결을 연다. Linux 소프트웨어 iSCSI는 세션당 하드웨어 큐 1개·연결 1개다 | 큐 수가 처리량을 보장하지는 않는다. 타깃 코어나 연결 하나에 부하가 몰리는 측정도 있다 |
| 애플리케이션 처리량 유지 | 같은 연구에서 NVMe/RDMA의 로컬 대비 처리량 차이가 2%였다 | 같은 실험에서 지연과 호스트 CPU 비용은 남았다. i10(NSDI'20)의 RocksDB 실험에서는 RocksDB 자체가 CPU의 최대 70%를 써서 fio보다 전송 간 차이가 작았다 |
| 백엔드를 NVMe 인터페이스로 제공 | namespace가 백엔드 블록 장치 하나에 대응한다 | lvol·객체 매핑·복제 처리가 없어지는 것은 아니다 |
| 구현에 따른 CPU 효율 개선 | 커널과 SPDK의 실행·폴링 방식이 다르다 | 연결 수, 고정 폴링 코어, 꼬리 지연에 따라 판단이 달라진다 |

{{< lane src="_lane/1-rocksdb-처리량.json" />}}

iSCSI는 SCSI 명령 하나를 CDB(명령 기술 블록)에 담고, 이를 PDU(iSCSI 메시지 단위)로 감싸 보냅니다. NVMe 쪽에서는 SCSI 중간 계층과 iSCSI 계층 자리에 NVMe host와 전송 계층이 들어갑니다. Guz 외는 이를 호스트 경로에서 프로토콜 변환을 없애는 것으로 설명합니다. 이 경로 차이가 성능에 기여할 수 있지만, 제거된 SCSI 처리만의 비용을 분리한 실측은 확보하지 못했습니다.

Samsung 연구진의 2017년 RoCEv2 실험에서는 RocksDB 처리량이 로컬과 2% 차이였고, iSCSI는 로컬보다 40% 줄었습니다. 위 도식의 98은 “2% 차이”를 옮긴 근사값입니다. 자료에 차이의 방향이 명시되지 않았고 iSCSI의 전송 구성도 없으므로, 이 수치로 SCSI 처리 제거의 효과나 NVMe/TCP 성능을 판단할 수는 없습니다. 같은 실험에서 NVMe-oF의 평균 지연과 호스트 CPU 사용량은 늘었습니다.

애플리케이션과 장치가 쓰는 시간도 전송 차이의 비중을 바꿉니다. i10의 RocksDB 실험에서는 RocksDB 자체가 CPU를 많이 써서 NVMe/RDMA와 NVMe/TCP의 차이가 fio보다 작았습니다. Blockbridge의 큰 블록 측정에서는 대역폭이 한계에 이르자 NVMe/TCP와 iSCSI의 차이가 거의 없어졌습니다. TCP에서 작은 PDU 처리, 스레드 전환, 복사와 CRC가 발생하는 경로는 4절에서 다룹니다.

장치가 느릴수록 같은 전송 오버헤드가 전체 지연에서 차지하는 비중이 작아진다는 것이 이 자료들을 종합한 해석입니다. HDD는 [부록 A]({{< relref "/data/block-storage/a1-nvme-hdd/index.md" >}}), 파일 프로토콜 NFS와의 비교는 [부록 B]({{< relref "/data/block-storage/a2-nfs/index.md" >}})에 있습니다.

이 글이 확보한 논문에서 iSCSI와 같은 조건으로 비교한 NVMe-oF는 RDMA뿐입니다. NVMe/TCP와 iSCSI를 함께 잰 자료는 벤더 자료, Longhorn 벤치마크, StarWind 블로그이며, 어느 자료도 SCSI 처리 제거만의 효과를 분리하지 않았습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 호스트 명령 처리 경로를 단순화할 여지 | SCSI 중간 계층과 iSCSI 계층 자리에 NVMe host와 전송 계층이 들어가며, CDB를 PDU로 감싸는 단계가 빠진다는 해석. Guz 외는 프로토콜 변환 제거로 설명 | RFC 7143, open-iscsi README, LIO 문서, Guz 외 SYSTOR'17 슬라이드 | `≈` `Ⓥ` |
| 경로 단순화와 별개로 남는 비용 | TCP/IP 처리·복사·CRC는 남음. 제거된 SCSI 처리만의 독립 실측은 확보하지 못함 | 4절 표(i10, ntprof, Autonomous NIC Offloads). 독립 실측 없음은 이 글의 조사 범위 | `?` |
| 큐와 연결 배치의 차이 | NVMe는 큐 쌍 구조. Linux host는 CPU마다 I/O 큐와 연결을 열고, Linux 소프트웨어 iSCSI의 기본 형태는 세션당 하드웨어 큐 1개·연결 1개 | NVMe over Fabrics 1.1a, NVMe over TCP Transport Specification 1.2, open-iscsi README, Linux 소스 | `✓` `≈` |
| RocksDB 실험 조건 | 호스트 3대, PM1725 3개를 단 커널 타깃, 100GbE RoCEv2, db_bench 80/20, 호스트당 3 인스턴스. Samsung 연구진의 2017년 측정 | Guz 외(Samsung), SYSTOR'17 슬라이드 | — |
| RocksDB 실험의 커널 버전 | 슬라이드에 없음 | Guz 외 SYSTOR'17 슬라이드 | `?` |
| RocksDB 처리량과 남은 비용 | NVMe-oF(RoCEv2)는 로컬 대비 처리량 2% 차이, 평균 지연 +11%, 호스트 CPU +10%. 지연의 절대값과 p99는 아래 표에 보존 | Guz 외 SYSTOR'17 슬라이드 | `Ⓑ` |
| 같은 RocksDB 실험의 iSCSI 처리량 | 로컬 대비 40% 감소 | Guz 외 SYSTOR'17 슬라이드 | `Ⓑ` |
| RocksDB 비교의 적용 한계 | iSCSI 전송 구성은 자료에 없음. 2%와 40%의 차이는 SCSI 변환 제거만의 효과가 아니며 NVMe/TCP에 그대로 적용할 수 없음 | Guz 외 SYSTOR'17 슬라이드 | — |
| 같은 발표의 다른 측정 | 아래 추가 측정도 NVMe/RDMA 결과. iSCSI 전송 구성은 확인하지 못함 | Guz 외 SYSTOR'17 슬라이드 | `Ⓑ` `?` |
| 애플리케이션 CPU 비용이 전송 차이에 미치는 영향 | i10(NSDI'20)의 RocksDB 실험에서는 RocksDB 자체가 CPU의 최대 70%를 사용해 NVMe/RDMA 대 NVMe/TCP 간 차이가 fio보다 작았음 | i10 | `Ⓑ` |
| NVMe 인터페이스 뒤의 백엔드 | namespace는 백엔드 블록 장치 하나에 대응하지만 lvol·객체 매핑·복제 처리는 남음 | SPDK TCP 보고서 p.9(namespace-bdev), SPDK Vhost Performance Report 24.05(lvol), 6절 표(복제) | `✓` `Ⓑ` |
| 구현에 따른 CPU 효율 차이 | 커널과 SPDK는 실행·폴링 방식이 다름. 연결 수, 고정 폴링 코어, 꼬리 지연에 따라 판단이 달라짐 | SPDK TCP 보고서 p.39·CHANGELOG, SPDK NVMe-oF TCP Performance Report 24.05, LeapIO | `✓` `Ⓑ` |
| 대역폭이 한계인 큰 블록의 비교 | NVMe/TCP와 iSCSI 차이 약 0.1% | Blockbridge 비교 자료 | `Ⓥ` |
| 확보한 직접 비교 자료의 범위 | 공개 논문에서 iSCSI와 같은 조건으로 잰 NVMe-oF는 RDMA. NVMe/TCP와 iSCSI를 함께 잰 자료는 벤더 자료, Longhorn 벤치마크(6절), StarWind 블로그(7절). 어느 자료도 SCSI 변환 제거만의 효과를 분리하지 않음 | Guz 외(RDMA 대 iSCSI), Blockbridge·Dell(벤더 자료), Longhorn(6절), StarWind(7절) | — |

| RocksDB 지표 | 로컬(DAS) | NVMe-oF(RoCEv2) |
|---|---|---|
| 처리량 | 기준 | 2% 차이 |
| 평균 지연 | 507µs | 568µs(슬라이드 기준 +11%) |
| p99 지연 | 3.6ms | 3.7ms |
| 호스트 CPU | 기준 | +10% |

| 측정 | 결과 |
|---|---|
| 무부하 4K 읽기 지연 | 로컬 NVMe 경로 81.6µs에 NVMe-oF가 11.7µs를 더했다. 타깃 모듈 4.57, host 모듈 3.25, 패브릭 2.43, 기타 1.52µs. SPDK 타깃이면 8.9µs(당시 SPDK는 "not stable enough for our setup") |
| 호스트 CPU | iSCSI는 성능이 DAS와 같은 구간에서도 호스트 부하가 30% 더 들었고, NVMe-oF는 "minimal"이었다 |
| 타깃 CPU | NVMe-oF 타깃은 코어를 1/12로 줄여도 DAS 읽기 처리량의 90%를 냈다 |
| 부하 지연 | NVMe-oF는 평균·95th가 DAS와 같았고, iSCSI는 가벼운 부하에서도 10배 느렸다고 슬라이드가 적는다 |

{{% /details %}}

## 2. 타깃은 무엇을 내보내고 호스트는 무엇을 보는가

{{< flow src="_flow/2-장치-대응.json" />}}

NVMe-oF 타깃이 내놓는 단위는 NVM subsystem입니다. subsystem은 NQN이라는 이름으로 식별하고 port로 노출합니다. 호스트가 controller의 Admin Queue에 연결하면 association이 생기며, 그 관계가 유지되는 동안에는 해당 호스트만 그 controller에 연결할 수 있습니다. Discovery controller는 접속할 subsystem을 찾도록 Discovery Log를 제공하고, 데이터 I/O용 큐와 namespace는 갖지 않습니다.

소프트웨어 타깃인 Linux nvmet과 SPDK nvmf는 이 규약에 맞는 NVMe controller를 구현합니다. SPDK 문서에서 namespace는 NVMe의 논리 블록 저장 공간이며, bdev(블록 장치 추상화 계층)가 제공하는 백엔드 블록 장치 하나에 연결됩니다. 물리 NVMe 장치와 가상 bdev 모두 백엔드가 될 수 있습니다. 이를 종합하면 호스트가 연결하는 controller는 타깃 프로그램이 구현한 것이며, namespace 뒤에는 LV·lvol·파일 같은 장치가 놓일 수 있습니다.

명령이 도착한 뒤에는 그 백엔드의 경로를 따릅니다. Guz 슬라이드의 커널 타깃은 받은 명령을 블록 계층의 I/O로 내려보냅니다. 이후에는 연결된 NVMe SSD나 논리 볼륨이 요청을 처리합니다. 호스트가 NVMe 명령을 보냈어도 블록 계층과 볼륨 계층을 거치며, lvol·객체 매핑·복제 비용은 남습니다(5·6절). NVIDIA가 설명하는 하드웨어 오프로드는 별도 경로입니다. 지원 HCA가 일반 I/O를 처리하고 peer-to-peer PCI로 NVMe 장치에 직접 보냅니다.

호스트에서는 연결된 namespace를 블록 장치로 사용합니다. 문서와 구현을 종합하면 `/dev/nvmeXnY`가 생기고, `nvme list`의 모델 칸에는 타깃 소프트웨어가 보고한 값이 표시되는 것으로 볼 수 있습니다. Linux는 같은 namespace로 가는 여러 경로를 블록 장치 하나로 묶고, I/O 정책과 관계없이 ANA(경로별 접근 상태)에서 optimized인 경로를 먼저 씁니다. 설정 절차는 부록에 있습니다.

`/dev/nvme*`라는 이름만으로 그 뒤의 전송을 알아낼 수는 없습니다. 클라우드 볼륨이나 DPU 카드가 NVMe 장치로 보이는 경우는 [02]({{< relref "/data/block-storage/02-vm-disk-paths/index.md" >}})에서 다룹니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| NVMe-oF와 소프트웨어 타깃의 역할 | NVMe-oF는 NVMe 명령을 패브릭으로 주고받는 규약. Linux nvmet과 SPDK nvmf는 규약에 맞는 NVMe controller를 구현하고 namespace 하나를 타깃 쪽 블록 장치 하나에 연결 | SPDK NVMe-oF TCP Performance Report 24.05(p.9 namespace-bdev, p.28 nvmet 설정), NVMe over Fabrics 1.1a | `✓` |
| SPDK namespace와 bdev의 대응 | namespace마다 bdev 계층이 제공하는 블록 장치 하나가 대응. 물리 NVMe 또는 그 위에 쌓은 가상 bdev 사용 가능 | SPDK NVMe-oF TCP Performance Report 24.05(p.9) | `✓` |
| 호스트가 보는 controller의 정체 | 타깃 프로그램이 만든 controller이며 물리 SSD의 controller와 다름. namespace 뒤에 LV·lvol·파일 같은 블록 장치가 올 수 있음. 전송 규약과 장치 구현을 나누어 이해한다는 해석 | —(위 행들의 종합) | `≈` |
| 타깃에서 백엔드로 이어지는 명령 경로 | 받은 명령을 namespace에 연결된 블록 장치의 I/O로 내려보냄. 백엔드는 NVMe SSD 또는 논리 볼륨일 수 있음. 커널 경로는 NVMeT_Core → 블록 계층 → NVMe_Core → NVMe_PCI | Guz 외 SYSTOR'17 슬라이드 | `Ⓑ` |
| 하드웨어 타깃 오프로드의 예외 | ConnectX-5 이상에서 HCA가 일반 I/O를 처리하고 peer-to-peer PCI로 NVMe 장치에 직접 전송한다는 설명 | NVIDIA NVMe-oF target offload 문서 | `Ⓥ` |
| subsystem의 식별과 노출 | 타깃이 내놓는 단위는 NVM subsystem. NQN으로 식별하고 port로 노출 | NVMe over Fabrics 1.1a | `✓` |
| association과 연결 범위 | 호스트가 controller의 Admin Queue에 연결하면 association이 생김. 관계가 유지되는 동안에는 그 호스트만 해당 controller에 연결 가능 | NVMe over Fabrics 1.1a | `✓` |
| Discovery controller의 역할 | Discovery Log만 제공. I/O 큐와 namespace는 없음 | NVMe over Fabrics 1.1a | `✓` |
| 연결 후 장치와 모델 표시 | `/dev/nvmeXnY`가 생기고 `nvme list`의 모델 칸에는 타깃 소프트웨어가 보고하는 값이 표시된다는 해석 | RHEL 9 NVMe/TCP 문서 예시 | `≈` |
| Linux 멀티패스의 경로 선택 | 같은 namespace로 가는 여러 경로를 블록 장치 하나로 묶음. 정책과 관계없이 ANA에서 optimized인 경로를 우선 사용 | Linux NVMe Multipath 문서 | `✓` |

{{% /details %}}

## 3. 호스트 I/O 스택과 큐 구조는 어떻게 다른가

{{< flow src="_flow/3-호스트-io-스택.json" />}}

위 경로는 RFC 7143, open-iscsi README, LIO 문서를 종합한 것입니다. 한 문서에 전체 경로가 제시된 것은 아닙니다. NVMe 쪽에는 SCSI 중간 계층과 iSCSI 계층이 없으며, Guz 외는 이 차이를 프로토콜 변환 제거로 설명합니다.

iSCSI의 비용에는 복사와 프로토콜 처리도 포함됩니다. ReFlex 연구진은 클라이언트와 서버에서 소켓·SCSI·애플리케이션 버퍼 사이에 데이터 복사가 생긴다고 설명합니다. i10 연구진은 당시 Linux iSCSI가 TSO(송신 때 큰 덩어리를 NIC가 나누는 기능)와 GRO(수신 때 작은 패킷을 합치는 기능)를 충분히 쓰지 못하고 TCP/IP 처리용 커널 스레드를 따로 사용해 CPU를 비효율적으로 쓴다고 지적했습니다.

{{< flow src="_flow/3-큐-연결-배치.json" />}}

요청을 큐와 연결에 배치하는 방식도 다릅니다. iSCSI 규격은 세션 안에 여러 연결을 두는 MC/S를 허용합니다. 그러나 open-iscsi README의 소프트웨어 iSCSI는 세션마다 scsi_host를 할당하고 연결을 하나만 사용합니다. 커널 소스까지 확인하면 Linux iscsi_tcp의 기본 형태는 세션마다 하드웨어 큐와 TCP 연결을 하나씩 두는 방식으로 해석할 수 있습니다.

NVMe/TCP는 TCP 연결 하나와 큐 쌍 하나를 대응시킵니다. 한 연결에 여러 큐를 섞거나 한 큐를 여러 연결에 나누는 구성은 지원하지 않습니다. RDMA의 I/O 큐 쌍도 RDMA QP 하나에 대응합니다. 이 규약 위에서 Linux host는 기본적으로 CPU 수만큼 I/O 큐와 연결을 만들고, nvme-tcp는 큐마다 CPU를 정해 해당 CPU의 워크큐에서 소켓 송수신을 실행합니다. CPU 수만큼 큐를 만드는 정책 자체는 NVMe 규약의 요구가 아닙니다.

큐를 나눈 효과는 실제 부하로 확인해야 합니다. ntprof는 NVMe/TCP 연결 하나에 fio job을 더 넣어도 처리량은 조금만 늘고 지연은 커지는 구간을 보고했습니다. 여러 CPU에 큐와 연결을 나누면 한 연결에 집중되던 부하를 분산할 수 있다는 것은 이 글의 종합 판단입니다. 해당 실험은 연결 수 증가를 측정하지 않았으므로 그림의 큐·노드 수를 처리량 배수나 지연 비율로 환산할 근거는 없습니다. 두 경로에 남는 TCP/IP 처리와 복사는 다음 절에서 봅니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 호스트 I/O 스택 그림의 성격 | RFC 7143, open-iscsi README, LIO 문서의 사실을 종합한 계층 순서. 한 문서가 그림과 같은 전체 경로를 제시한 것은 아님 | RFC 7143, open-iscsi README, LIO 문서 | `≈` |
| NVMe 경로에서 빠지는 계층 | SCSI 중간 계층과 iSCSI 계층이 없음. Guz 외의 설명은 "경로에서 프로토콜 변환을 없앤다" | Guz 외 SYSTOR'17 슬라이드 | `Ⓥ` |
| iSCSI의 복사와 프로토콜 처리 | 클라이언트·서버 양쪽에서 소켓·SCSI·애플리케이션 버퍼 사이의 데이터 복사를 동반하는 무거운 프로토콜 처리를 지연 원인으로 설명 | ReFlex, ASPLOS'17 | `Ⓑ` |
| 당시 Linux iSCSI의 CPU 비효율 | TSO/GRO를 충분히 활용하지 못하고 TCP/IP 처리 전용 커널 스레드를 따로 실행한다고 지적 | i10, NSDI'20 | `Ⓑ` |
| iSCSI 규격의 다중 연결 허용 | MaxConnections 키로 세션 하나에 여러 연결을 두는 MC/S 허용 | RFC 7143 | `✓` |
| 소프트웨어 iSCSI의 연결 사용 | iscsi_tcp·iser는 "세션마다 scsi_host를 하나 할당하고 세션당 연결을 하나만 쓴다"고 설명 | open-iscsi README | `✓` |
| Linux iscsi_tcp의 기본 하드웨어 큐 수 | `iscsi_tcp.c`의 host template에 `nr_hw_queues` 설정이 없음. 설정이 없으면 SCSI 코어가 값을 1로 지정하므로 세션당 하드웨어 큐 1개·TCP 연결 1개가 기본 형태라는 해석 | Linux `iscsi_tcp.c`, scsi_lib.c | `≈` |
| scsi-mq의 변경 이력 | 4.19에서 기본값이 됐고 5.0에서 non-mq 코드 제거 | Linux 4.19·5.0 변경 문서 | `✓` |
| 현재 소스에서 확인한 범위 | master 소스의 2026-10 시점에도 iscsi_tcp는 하드웨어 큐 수를 별도로 지정하지 않음 | Linux `iscsi_tcp.c` | — |
| NVMe/TCP 큐와 연결의 대응 | TCP 연결 하나가 Admin 또는 I/O 큐 쌍 하나에 대응. 연결 하나에 여러 큐를 다중화하거나 큐 하나를 여러 연결에 걸치는 구성은 지원하지 않음 | NVMe over TCP Transport Specification 1.2 | `✓` |
| RDMA 큐와 연결의 대응 | I/O 큐 쌍 하나가 RDMA QP 하나에 대응 | NVMe over Fabrics 1.1a | `✓` |
| Linux host의 I/O 큐 기본값 | 온라인 CPU 수만큼 I/O 큐와 연결을 생성. 큐 크기 기본 128, 범위 16~1024. CPU 수만큼 생성하는 것은 규약이 아닌 Linux 기본값 | Linux nvme/host/fabrics.c | `✓` |
| Linux nvme-tcp의 CPU 배치 | 큐마다 CPU 하나를 정하고 해당 CPU의 워크큐에서 소켓 송수신 실행 | Linux nvme/host/tcp.c | `✓` |
| 연결 하나에 job을 더 넣은 측정 | NVMe/TCP 연결 하나에서 fio job 5개 → 6개. 처리량 645.2 → 665.5MB/s로 3.1% 증가, 지연 477.3µs → 556.7µs | ntprof, NSDI'25 | `Ⓑ` |
| CPU마다 큐·연결을 나누는 방식의 해석 | 연결 하나의 한계를 연결 수로 푸는 쪽이라는 종합 판단. 실제 이점인지는 측정 자료가 일부만 뒷받침 | ntprof와 Linux 큐 배치 종합 | `Σ` |
| 측정과 그림의 한계 | ntprof 실험은 연결 수 증가의 효과를 측정하지 않음. 그림의 CPU 수·큐 수는 임의의 예이며, 큐 수에 비례하는 성능을 입증하지 않음 | ntprof, 이 글의 도식 | — |

{{% /details %}}

## 4. 쓰기 데이터는 어떻게 오가며 TCP에는 무엇이 남는가

{{< seq src="_seq/4-쓰기-데이터와-r2t.json" />}}

NVMe/TCP의 쓰기 데이터는 명령과 함께 보내거나 타깃의 요청을 받은 뒤 따로 보냅니다. 명령·응답을 나르는 정보 단위가 capsule이고, 쓰기 데이터를 명령에 넣는 in-capsule은 I/O 명령의 선택 기능입니다. ntprof가 설명하는 Linux 구현은 작은 쓰기에 in-capsule을 사용합니다. 그 한도를 넘으면 호스트가 controller의 R2T(쓰기 데이터 전송 요청)를 기다렸다가 H2CData PDU로 데이터를 보냅니다.

iSCSI도 R2T와 ImmediateData·InitialR2T·FirstBurstLength·MaxBurstLength 협상으로 쓰기 전송을 조절합니다. 따라서 NVMe/TCP에 in-capsule이 있다는 사실만으로 iSCSI보다 왕복이 줄어든다고 판단할 수는 없습니다.

RDMA에서는 controller가 데이터 이동을 시작합니다. 읽기에서는 RDMA_WRITE로 데이터를 호스트 버퍼에 넣고, 쓰기에서는 RDMA_READ로 가져오거나 in-capsule로 받습니다. TCP와 RDMA는 이처럼 데이터를 옮기는 방식이 달라 RDMA 측정값을 TCP에 그대로 적용할 수 없습니다.

TCP에서는 작은 요청 PDU 처리와 커널 스레드 전환, 복사와 CRC가 CPU를 사용합니다. i10은 요청마다 개입하는 커널 스레드를 비용의 원인으로 짚었고, ntprof는 부하가 늘 때 네트워크 단계가 전체 지연의 대부분을 차지하는 구간을 관찰했습니다. Autonomous NIC Offloads 실험에서는 복사와 CRC가 NVMe-TCP 메시지 처리 사이클의 최대 49%를 사용했습니다. 아래 표에 각 실험의 커널·장비·부하를 함께 두었습니다.

비교할 때는 다이제스트와 TLS 설정도 맞춰야 합니다. 전송 오류를 검출하는 헤더·데이터 다이제스트는 연결할 때 양쪽이 켜야 동작하는 선택 기능입니다. NVIDIA 패치 커버레터의 소프트웨어 경로에서는 다이제스트를 켜면 큰 블록 읽기 처리량이 줄었습니다. 작은 블록과 쓰기는 측정값이 없습니다.

TLS도 선택 구현입니다. NVMe/TCP 규격이 사용할 TLS 버전과 PSK 인증을 정하고, Linux와 RHEL 문서가 구현·지원 상태를 설명합니다. 같은 장비에서 TLS를 켜고 끈 비용을 직접 비교한 공개 수치는 확인하지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| command·response capsule의 형식 | command capsule은 64바이트 이상의 SQE에 데이터나 SGL이 붙는 형태. response capsule은 16바이트 CQE | NVMe over Fabrics 1.1a, NVMe over TCP Transport Specification 1.2 | `✓` |
| in-capsule의 필수·선택 범위 | I/O 명령에서는 선택 기능. Fabrics·Admin 명령만 8,192바이트까지 필수 | NVMe over TCP Transport Specification 1.2 | `✓` |
| 한도를 넘는 쓰기의 흐름 | 호스트는 controller의 R2T를 받은 뒤 H2CData로 전송 | NVMe over TCP Transport Specification 1.2 | `✓` |
| Linux 구현의 in-capsule 경계 | 논문 그림에서 8KB 이하 쓰기는 capsule에 포함, 그보다 크면 R2T 흐름 사용 | ntprof | `Ⓑ` |
| iSCSI의 쓰기 데이터 제어 | R2T와 ImmediateData·InitialR2T·FirstBurstLength·MaxBurstLength 협상 사용 | RFC 7143 | `✓` |
| 왕복 횟수 비교의 한계 | 이 글의 자료에는 두 프로토콜의 쓰기 왕복 횟수가 다르다고 판단할 근거가 없음. in-capsule의 존재만으로 iSCSI 대비 왕복 감소를 입증하지 못함 | RFC 7143과 NVMe/TCP 규격 종합 | `Σ` |
| RDMA의 읽기 데이터 이동 | controller가 RDMA_WRITE로 호스트 버퍼에 데이터를 넣음 | NVMe over Fabrics 1.1a | `✓` |
| RDMA의 쓰기 데이터 이동 | controller가 RDMA_READ로 가져오거나 in-capsule로 받음. RDMA_WRITE·RDMA_READ 모두 controller가 시작 | NVMe over Fabrics 1.1a | `✓` |
| TCP에 남는 비용과 측정 범위 | TCP/IP 처리, 스레드 간 컨텍스트 스위치, 복사·CRC. 논문별 조건과 값은 아래 표에 보존 | i10, ntprof, Autonomous NIC Offloads | `Ⓑ` |
| 다이제스트의 선택성 | 헤더·데이터 다이제스트(CRC32C)는 연결 시 양쪽이 켜야 동작하는 선택 기능 | NVMe over TCP Transport Specification 1.2 | `✓` |
| 다이제스트 비용의 측정 조건 | nvme-tcp 수신 오프로드 패치 커버레터 v30, 2025-07의 소프트웨어 경로 기준선. ConnectX-7, Xeon Platinum 8380, fio QD128×8 | NVIDIA nvme-tcp receive offloads 패치 커버레터 | `Ⓥ` |
| 다이제스트를 켠 큰 블록 읽기 | 64K read: 끔 84Gbps → 켬 53Gbps. 512K read: 끔 98Gbps → 켬 61Gbps | NVIDIA nvme-tcp receive offloads 패치 커버레터 | `Ⓥ` |
| 다이제스트 처리량 감소율 | 위 측정값에서 약 37~38% 감소로 역산 | NVIDIA 패치 커버레터 수치 역산 | `≈` |
| 다이제스트 자료의 누락 범위 | 4K와 쓰기 경로 수치는 없음 | NVIDIA nvme-tcp receive offloads 패치 커버레터 | — |
| TLS 비용의 미확인 범위 | 같은 장비에서 TLS를 켠 것과 끈 것을 직접 비교한 공개 수치를 찾지 못함 | 이 글의 조사 범위 | — |
| TLS 규격과 Linux 구현 | 선택 구현이며 TLS 1.3과 PSK 인증 요구. Linux 6.7에서 in-kernel TLS 도입 | NVMe over TCP Transport Specification 1.2, Linux 6.7 변경 문서 | `✓` |
| RHEL의 TLS 지원 상태 | RHEL 9.6·10.0에서 Technology Preview | RHEL 9.6·10.0 릴리스 노트 | `✓` |

| 자료 | 조건 | 보고한 것 |
|---|---|---|
| i10, NSDI'20 | 커널 4.20, ConnectX-5 100Gbps 직결, PM1725a, 4KB 랜덤 읽기 QD128 | 코어당 네트워크 스택 약 30Gbps(≈915K IOPS), 로컬 스토리지 스택 약 350K IOPS인데 합친 커널 NVMe/TCP는 96K IOPS. 병목이 두 스택의 경계에 있다는 것이 저자 주장이다 `Ⓑ` |
| i10 (같은 논문) | SSD 포화에 필요한 코어 | 랜덤 읽기에서 로컬 3코어, NVMe/RDMA 4코어, NVMe/TCP는 그 2.5배(약 10코어 `≈`). 랜덤 쓰기는 RDMA 3코어 대 TCP 6코어 `Ⓑ` |
| i10 (같은 논문) | 지연 원인 | host가 보낸 패킷의 약 80%가 72바이트 요청 PDU라 TSO 이득이 없고, 커널 스레드 셋(blk-mq, 송신, 수신)이 요청마다 개입해 컨텍스트 스위치가 1~3µs씩 든다 `Ⓑ` |
| ntprof, NSDI'25 | 커널 5.15.143, ConnectX-6 100GbE, MTU 9KB, fio libaio job 1개 | 4K 랜덤 읽기 iodepth를 1에서 32로 올리면 양쪽 네트워크 단계 시간이 14.3µs에서 127.0µs로 늘어 전체 지연의 92.2%를 차지한다 `Ⓑ` |
| Autonomous NIC Offloads, ASPLOS'21 | 커널 5.6.0, ConnectX-6 Dx에서 NVMe-TCP 오프로드를 에뮬레이션 | CPU의 CRC32 명령을 쓰고도 복사와 CRC가 NVMe-TCP 메시지 처리 사이클의 최대 49%다 `Ⓑ` |

{{% /details %}}

## 5. 타깃 구현과 백엔드가 이점을 바꾸는 조건

{{< lane src="_lane/5-tcp-구현-조합.json" />}}

Intel의 SPDK TCP 보고서에서는 타깃만 SPDK로 바꿨을 때 QD1 평균 지연이 약 1µs 줄었고, initiator까지 바꾸면 약 4µs 줄었습니다. 로컬 대비 전송 비용을 뺀 값이 아니라 같은 보고서의 구현 조합 간 차이입니다. SPDK의 NVMe/TCP도 Linux 커널 TCP 스택을 사용합니다.

평균이 낮은 구현의 꼬리 지연도 낮지는 않았습니다. 타깃 1코어, null 블록 장치, QD1 4KiB 랜덤 읽기에서는 평균 차이가 작았고 커널 타깃의 꼬리 지연이 더 낮았습니다. LeapIO의 RDMA·RocksDB 실험도 커널 NVMe-oF가 가장 안정적이었다고 보고했습니다. 구현 시기와 부하가 다른 두 실험의 절대값을 직접 비교할 수는 없지만, 꼬리 지연을 SLO로 삼는다면 평균만으로 구현을 고르기 어렵다는 판단은 가능합니다.

처리량 비교에는 사용한 코어 수가 필요합니다. SPDK 보고서의 subsystem당 연결 8개 조건에서는 커널 타깃이 더 많은 코어로 더 높은 절대 처리량을 냈고, 코어당 처리량은 SPDK가 높았습니다. 연결이 하나일 때는 24코어를 고정 폴링하는 SPDK의 효율이 낮았으며, SPDK에 배정한 코어를 줄여 다시 재자 효율 비교가 달라졌습니다. ntprof에서도 타깃 코어를 제한하면 큐 깊이를 높여도 처리량은 거의 늘지 않고 지연만 커졌습니다.

타깃 뒤의 bdev와 볼륨 계층은 별도 비용입니다. SPDK 보고서는 raw polled-mode 드라이버보다 bdev 계층에서 오버헤드가 생기고, lvol이 split NVMe bdev보다 낮은 IOPS를 내는 조건이 있다고 보고했습니다. 드라이브를 나눠 쓰는 일부 조건에서는 lvol 차이가 잡음 수준이었습니다.

이 계층에는 할당과 메타데이터 처리가 있습니다. SPDK lvol은 blobstore 위에 만들며 첫 쓰기 때 저장 공간을 할당하고 snapshot과 clone을 관리합니다. Linux dm-thin은 메타데이터를 별도 장치에 저장하며, 데이터 블록 크기를 생성 후 바꿀 수 없고 새 블록을 기본적으로 0으로 채웁니다. dm-thin의 지연·IOPS 실측은 확인하지 못했습니다.

배포판의 지원 범위도 구현 선택을 제한합니다. RHEL의 NVMe/TCP 문서는 host만 완전 지원하고 타깃 기능과 모듈은 지원하지 않는다고 명시합니다. 같은 가이드의 NVMe/RDMA 장에 타깃 설정 절차가 있다는 것만으로 RDMA 타깃의 지원 범위까지 확정할 수는 없습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| TCP 구현 조합 도식의 공통 조건 | SPDK 24.05, 타깃 Xeon Gold 6348, 커널 6.0.18. 같은 TCP 보고서에서 측정한 세 막대 | SPDK NVMe-oF TCP Performance Report 24.05 | `Ⓑ` |
| TCP 구현 조합별 평균 지연 | 커널 타깃·커널 initiator 21.39µs, SPDK 타깃·커널 initiator 20.43µs, SPDK 타깃·SPDK initiator 17.50µs | SPDK NVMe-oF TCP Performance Report 24.05 | `Ⓑ` |
| 평균 지연 차이의 의미 | TCP QD1 평균에서 타깃만 변경하면 약 1µs, initiator까지 변경하면 약 4µs 차이. 로컬 대비 증가분이나 순수 네트워크 지연이 아님 | SPDK NVMe-oF TCP Performance Report 24.05 | — |
| SPDK TCP 경로에 남는 커널 처리 | SPDK의 NVMe/TCP도 Linux 커널 TCP 스택 사용 | SPDK NVMe-oF TCP Performance Report 24.05 | `✓` |
| LeapIO의 꼬리 지연 | RDMA 환경의 YCSB/RocksDB 실험에서 커널 NVMe-oF가 가장 안정적. SPDK는 32스레드에서 p99.9 14ms, p99.99 약 2,000ms | LeapIO, ASPLOS'20 | `Ⓑ` |
| LeapIO와 TCP 보고서의 비교 한계 | 2020년 구현의 RDMA·YCSB 조건이므로 TCP 표와 절대값을 직접 비교할 수 없음. 꼬리 지연의 경향은 같음 | LeapIO, SPDK TCP 보고서 | — |
| 처리량 시험 장비와 부하 | Kioxia KCM61VUL3T20 14개, 직결한 100GbE ConnectX-5 4장. 4KiB 랜덤 읽기 QD384, subsystem 14개, 커널 initiator | SPDK NVMe-oF TCP Performance Report 24.05 | — |
| 처리량 시험의 CPU 배정 | SPDK 타깃은 24코어로 제한. 커널 타깃에는 코어 제한을 걸지 않음. 연결별 결과는 아래 표에 보존 | SPDK NVMe-oF TCP Performance Report 24.05 | — |
| 보고서의 코어당 효율 결론 | SPDK 타깃의 코어당 IOPS가 커널 타깃의 최대 1.69배(읽기), 1.39배(쓰기), 1.48배(혼합) | SPDK NVMe-oF TCP Performance Report 24.05 | `Ⓑ` |
| 연결 하나와 고정 폴링의 영향 | 연결이 하나일 때는 24코어를 고정 폴링한 SPDK보다 커널 nvmet이 효율적. SPDK 코어를 4개로 줄여 다시 측정하면 SPDK가 1.38배 | SPDK NVMe-oF TCP Performance Report 24.05 | — |
| 타깃 코어 제한 시 처리량·지연 | 커널 타깃을 드라이브당 1코어로 제한하면 iodepth 16 이후 처리량은 252.4 → 284.9MB/s, 지연은 238.7µs → 431.0µs | ntprof | `Ⓑ` |
| RDMA 측정과 TCP 측정의 관계 | 같은 랩의 별도 보고서. 서버·커널은 같지만 다른 시험이므로 TCP 막대에 합치지 않음. RDMA QD1 결과는 아래 표에 보존 | SPDK NVMe-oF RDMA Performance Report 24.05 | `Ⓑ` |
| RHEL의 NVMe/TCP 지원 범위 | RHEL 9·10 Managing storage devices의 NVMe/TCP 장은 host만 fully supported. "Red Hat does not support the NVMe Target (nvmet) functionality", "The NVMe/TCP controller (nvmet-tcp) module is not supported" 명시 | RHEL 9·10 Managing storage devices | `✓` |
| nvmet_tcp.ko 분류 | RHEL 9.0 릴리스 노트에서 Unmaintained로 분류 | RHEL 9.0 릴리스 노트 | `✓` |
| RHEL RDMA 타깃 지원의 불확실성 | 같은 가이드의 NVMe/RDMA 장은 nvmet-rdma 설정 절차를 미지원 문구 없이 수록. 문서만으로 지원 범위를 단정할 수 없음 | RHEL Managing storage devices | — |
| bdev 계층의 오버헤드 | raw polled-mode 드라이버 대비 랜덤 읽기 약 11.6%, 랜덤 쓰기 약 19.8%. 큐 깊이와 코어 수는 확인하지 못함 | NVMe BDEV Performance Report 24.05 | `Ⓑ` `?` |
| lvol의 IOPS 차이 | vhost-scsi 뒤에서 split NVMe bdev 대비 +3.15%에서 −9.54%. 보고서 결론은 7~10% 낮음 | SPDK Vhost Performance Report 24.05 | `Ⓑ` |
| lvol 차이가 잡음 수준인 조건 | 드라이브 한 장을 VM 둘이 공유. QD1 4K 랜덤 읽기 24.17k 대 24.26k IOPS | SPDK Vhost Performance Report 24.05 | `Ⓑ` |
| lvol의 할당·snapshot·clone | blobstore 위의 lvolstore에 생성하며 lvol 하나는 blob 하나. 기본 cluster 4MiB를 첫 쓰기 때 할당. snapshot은 읽기 전용, clone은 snapshot에서 생성 | SPDK Logical Volumes | `✓` |
| dm-thin의 메타데이터·블록·제로잉 | 메타데이터는 별도 장치에 저장. 데이터 블록 크기 64KiB~1GiB는 생성 뒤 변경 불가. 새로 할당한 블록은 기본으로 0으로 채움 | Linux Thin provisioning 문서 | `✓` |
| dm-thin 실측의 부재 | 지연·IOPS 실측을 찾지 못함 | 이 글의 조사 범위 | `?` |

| QD1 4KiB 랜덤 읽기(null 블록 장치, 타깃 1코어, 커널 initiator) | 평균 | p99.9 | p99.99 |
|---|---|---|---|
| 커널 타깃 | 21.39µs | 33.0µs | 59.6µs |
| SPDK 타깃 | 20.43µs | 43.3µs | 106.0µs |

| subsystem당 연결 | 타깃 | IOPS | 사용 코어 | 코어당 IOPS |
|---|---|---|---|---|
| 8 | 커널 nvmet | 9,796K | 57.3 | 약 171K `≈` |
| 8 | SPDK | 7,831K | 30.3 | 약 258K `≈` |
| 1 | 커널 nvmet | 4,018K | 20.5 | 약 196K `≈` |
| 1 | SPDK | 4,197K | 28.7(24코어 고정 폴링) | 약 146K `≈` |

| RDMA QD1 4KiB 랜덤 읽기(null 블록 장치, 타깃 1코어) | 평균 |
|---|---|
| 커널 타깃 + 커널 initiator | 12.10µs |
| SPDK 타깃 + 커널 initiator | 9.39µs |
| SPDK 타깃 + SPDK initiator | 4.72µs |

{{% /details %}}

## 6. RBD와 Kubernetes 스토리지에도 같은 설명이 적용되는가

앞의 iSCSI·NVMe-oF는 서버의 블록 장치를 다른 호스트에 내보내는 경로입니다. RBD는 이미지를 RADOS 객체로 나누어 여러 OSD에 분산하고 블록 장치로 제공하는 스토리지입니다. RBD 앞에 NVMe/TCP 인터페이스를 붙여도 그 뒤의 객체 매핑·배치·복제는 계속 수행해야 합니다.

| 구현 | 호스트·프런트엔드 | namespace 뒤 경로 | 남는 비용 |
|---|---|---|---|
| Ceph NVMe-oF gateway | NVMe/TCP namespace | RBD 이미지에 대응하는 SPDK bdev. namespace는 RADOS 클러스터 컨텍스트에 매핑된다 | 이미지를 RADOS 객체로 쪼개 OSD에 배치하고 복제하는 비용이 그대로 남는다 |
| OpenEBS Mayastor | NVMe-oF 타깃 | nexus → child → replica(lvol bdev) → base bdev → 디스크. 원격 replica는 SPDK 유저모드 initiator·target으로 NVMe-oF 연결 | 쓰기는 건강한 모든 child에 보내 전부 완료돼야 initiator에 돌려준다 |
| Longhorn V1 | iSCSI | engine과 replica가 리눅스 프로세스 | 복제 쓰기, 프로세스 경로 |
| Longhorn V2 | NVMe-TCP 또는 UBLK | engine은 SPDK RAID bdev, replica는 SPDK lvol bdev | 복제 쓰기, lvol |

Ceph NVMe-oF gateway의 namespace는 RBD 이미지에 대응하는 SPDK bdev와 연결됩니다. Ceph 문서들을 종합하면 블록과 객체를 매핑하고 CRUSH로 배치하며 OSD에 복제하는 비용은 gateway 뒤에 남는 것으로 볼 수 있습니다. primary OSD가 복제본에 쓰고 응답을 모으는 세부 흐름은 공식 문서에서 확인하지 못했습니다.

gateway가 추가한 비용을 분리할 실측도 부족합니다. rook 토론의 krbd와 NVMe-oF 비교는 원인을 SDN 오버레이로 결론지은 사용자 보고이며 재현성은 확인하지 못했습니다. IBM 저자가 ceph.io에 공개한 측정에는 RBD 직접 접속 값과 일부 조건이 빠져 있습니다.

Mayastor는 nexus에서 child와 replica를 거쳐 디스크에 도달하며, 건강한 모든 child의 쓰기가 완료돼야 initiator에 응답합니다. 개발사 MayaData는 로컬과 가까운 처리량을 보고했지만 장치 정보 일부와 지연 값이 없습니다. 현재 버전의 공식 벤치마크도 확인하지 못했습니다.

Longhorn의 V1·V2 비교는 전송과 engine을 함께 바꾼 결과입니다. V1은 iSCSI와 리눅스 프로세스, V2는 NVMe-TCP 또는 UBLK와 SPDK를 사용합니다. 프로젝트 측정에서 기준선 대비 랜덤 읽기 처리량은 V1 약 2%, SPDK 코어를 많이 배정한 V2 약 30%로 계산됩니다. 이 차이를 전송만의 효과로 분리할 수는 없습니다.

같은 V2에서도 SPDK 코어 수가 처리량을 바꾸고, replica를 늘리면 동기 복제 쓰기의 지연이 커지고 처리량이 줄었습니다. 아래 비교는 OCI VM 안에서 이루어졌으므로 기준선 NVMe도 클라우드 가상화 계층을 거친 값으로 해석해야 합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| RBD와 전송 프로토콜의 계층 차이 | 이 글의 iSCSI·NVMe-oF는 서버 한 대의 블록 장치를 내보내는 경로. RBD는 이미지를 RADOS 객체로 나누어 여러 OSD에 분산하고 블록 장치 형태로 제공. 객체 크기는 기본 4M, 범위 4K~32M | Ceph Block Device, rbd(8) | `✓` |
| RBD 경로에 남는 처리 | 블록-객체 매핑, CRUSH 배치, OSD 복제가 추가된다는 해석. NVMe/TCP를 앞에 붙여도 객체 저장 계층은 남음 | Ceph 문서 종합 | `≈` |
| primary OSD의 복제 쓰기 흐름 | primary OSD가 복제본에 쓰고 응답을 모으는 흐름을 공식 문서에서 확인하지 못함 | Ceph 문서 조사 범위 | `?` |
| Ceph gateway의 namespace 대응 | NVMe/TCP namespace는 RBD 이미지에 대응하는 SPDK bdev 사용. namespace는 RADOS 클러스터 컨텍스트에 매핑 | Ceph NVMe-oF Gateway, ceph-nvmeof | `✓` |
| rook 사용자 보고의 장비·버전·부하 | 4k, iodepth=1, numjobs=64, EPYC 9654, 7.68TB NVMe 22장 × 3노드, Ceph 20.2.0, Rook v1.19.0 | rook/rook Discussion #17210 | `Ⓑ` |
| rook 사용자 보고의 결과와 결론 | 랜덤 읽기 IOPS는 krbd 465k 대 NVMe-oF 87.4k. 토론은 원인을 nvmeof 스택 대신 SDN 오버레이(OVN-Kubernetes)로 결론지음 | rook/rook Discussion #17210 | `Ⓑ` |
| rook 사용자 보고의 한계 | 사용자 보고 하나이며 재현성은 확인하지 못함 | rook/rook Discussion #17210 | `?` |
| ceph.io의 gateway 측정 | 2025-02, IBM 저자. 4노드·OSD 96개, 16K 70:30에서 450,000 IOPS 이상 | Performance at Scale with NVMe over TCP | `Ⓥ` |
| ceph.io 측정의 누락 조건 | CPU·NIC·큐 깊이와 RBD 직접 접속 대비 값이 없어 gateway 비용을 알 수 없음 | Performance at Scale with NVMe over TCP | `Ⓥ` |
| Mayastor의 I/O 경로 | nexus → child → replica(lvol bdev) → base bdev → 디스크. 원격 replica는 SPDK 유저모드 initiator·target으로 NVMe-oF 연결 | OpenEBS I/O Path Description | `✓` |
| Mayastor의 쓰기 완료 조건 | 건강한 모든 child에 쓰기를 보내고 전부 완료돼야 initiator에 응답 | OpenEBS I/O Path Description | `✓` |
| MayaData 실측의 출처와 조건 | 이 글에서 확보한 조건 명시 실측은 개발사 글이 유일. 2021년으로 추정. 커널 5.8, Xeon Gold 6252, Optane, ConnectX-6, fio 4K QD64×8 | Mayastor NVMe-oF TCP performance | `Ⓥ` |
| MayaData 실측 결과 | 읽기: 로컬 585K IOPS 대 1 replica 579K. 쓰기: 로컬 516K 대 1 replica 490K | Mayastor NVMe-oF TCP performance | `Ⓥ` |
| Mayastor 측정의 한계 | Optane 모델·지연 값 없음. 현재 버전 OpenEBS 4.x의 공식 벤치마크를 찾지 못함 | MayaData 글, OpenEBS 자료 조사 범위 | — |
| Longhorn V1의 구현 | 프런트엔드 iSCSI, engine·replica는 리눅스 프로세스. 복제 쓰기와 프로세스 경로가 남음 | Longhorn Concepts | `✓` |
| Longhorn V2의 구현 | 프런트엔드 NVMe-TCP 또는 UBLK, engine은 SPDK RAID bdev, replica는 SPDK lvol bdev. 복제 쓰기와 lvol 계층이 남음 | Longhorn Concepts | `✓` |
| Longhorn 벤치마크의 버전과 장비 | 프로젝트 v1.12.0 벤치마크, 2026-07-19. OCI VM.DenseIO.E5.Flex EPYC 9J14 3노드, Ubuntu 24.04 커널 6.17, Samsung MZWLR7T6HBLA, kbench/fio | Longhorn Performance Benchmark wiki, v1.12.0 report.pdf | — |
| Longhorn 부하 조건 | IOPS는 bs=4K iodepth=128 numjobs=8. 지연은 bs=4k iodepth=1. 구성별 결과는 아래 표에 보존 | Longhorn v1.12.0 report.pdf | — |
| V1·V2 비교의 범위 | 프런트엔드(iSCSI 대 NVMe-TCP)와 engine(리눅스 프로세스 대 SPDK)이 함께 변경됨. 전송만의 순수 효과를 분리한 결과가 아님 | Longhorn Concepts, v1.12.0 report.pdf | — |
| 기준선 대비 랜덤 읽기 IOPS | replica 1 행끼리, 기준선 local-path 1,468K 대비 V1 약 2%, V2 1코어 약 4%, V2 16코어 약 30%로 역산 | Longhorn v1.12.0 report.pdf 수치 역산 | `≈` |
| 기준선 대비 QD1 읽기 지연 증가분 | 기준선 79µs에 V2가 약 55~61µs, V1이 약 246µs를 더함 | Longhorn v1.12.0 report.pdf 수치 역산 | `≈` |
| V2 동기 복제 쓰기의 비용 | replica 1개 → 3개에서 QD1 쓰기 지연 84µs → 482µs, 랜덤 쓰기 IOPS 510,846 → 255,473 | Longhorn v1.12.0 report.pdf | `Ⓑ` |
| 기준선의 가상화 범위 | OCI VM 측정이므로 기준선 NVMe도 클라우드 가상화 계층을 거친 값이라는 해석 | Longhorn v1.12.0 report.pdf | `≈` |

| 구성 | 랜덤 읽기 IOPS | 랜덤 쓰기 IOPS | QD1 읽기 지연 | QD1 쓰기 지연 |
|---|---|---|---|---|
| 기준선 local-path | 1,468K | 686K | 79µs | 24µs |
| V1 · replica 1 | 29,297 | 32,063 | 325µs | 269µs |
| V2 · replica 1 · SPDK 1코어 | 57,022 | 78,379 | 140µs | 86µs |
| V2 · replica 1 · SPDK 16코어 | 442,053 | 510,846 | 134µs | 84µs |
| V1 · replica 3 | 27,524 | 22,155 | 583µs | 663µs |
| V2 · replica 3 · SPDK 16코어 | 480,375 | 255,473 | 481µs | 482µs |

{{% /details %}}

## 7. 내 환경에서 비교할 항목과 자료의 한계

| 맞춰야 할 항목 | 기준 | 이 글의 자료가 갖춘 것 |
|---|---|---|
| 전송 | 같은 장비·같은 initiator 커널·같은 타깃 구현에서 iSCSI, NVMe/TCP, NVMe/RDMA, 로컬 | 한 장비에서 셋 이상을 잰 자료는 StarWind 하나이고 initiator 커널이 5.4, 타깃이 SPDK다 |
| 평균과 꼬리 | 평균과 p99.9 이상을 같이 | p99.9 이상까지 낸 자료는 SPDK 24.05 TCP 보고서와 LeapIO 정도다 |
| 큐 깊이 | QD1 지연과 높은 QD 처리량을 따로 | 자료마다 QD가 다르다 |
| CPU | 호스트·타깃 사용 코어, 폴링 전용 코어 여부 | Guz, i10, SPDK 보고서에 있고 서로 맞댈 수 없다 |
| 백엔드 | null 장치, 실제 SSD, lvol, 복제 | 자료마다 다르다 |
| 보호 옵션 | digest, TLS 켬/끔 | digest는 큰 블록 read 한 건, TLS는 직접 비교가 없다 |

{{< lane src="_lane/7-starwind-qd1.json" />}}

이 조건에 가장 가까운 자료는 StarWind의 비교 글입니다. 벤더가 공개한 측정에서는 같은 장비와 SPDK 타깃으로 iSCSI·NVMe/TCP·NVMe/RDMA를 비교했습니다. 위 그림은 그중 낮은 큐 깊이에서 잰 랜덤 쓰기 결과입니다. 로컬의 같은 조건 값이 없어 전송이 추가한 지연까지 구할 수는 없습니다.

다중 스레드 결과는 읽는 범위가 더 좁습니다. StarWind가 프로토콜마다 numjobs와 iodepth를 다르게 설정했으므로 지연을 서로 견줄 수 없습니다. 각 조건의 처리량에서 RDMA·TCP가 로컬에 가까웠고 iSCSI는 로컬의 82% 수준이었다는 점만 확인할 수 있습니다. 타깃도 커널 nvmet·LIO가 아닌 SPDK였으며, 벤더 블로그에 원자료와 스크립트는 공개되지 않았습니다.

공개 자료가 비어 있거나 원문을 확인하지 못한 범위도 남아 있습니다.

- 커널 6.x에서 로컬 NVMe, NVMe/RDMA, NVMe/TCP, iSCSI를 한 장비로 함께 잰 공개 자료를 찾지 못했다. 표에 인용한 측정은 2017~2026년, 커널 4.4~6.17에 걸쳐 있으며 장치도 다르다.
- NVMe/TCP에서 TLS를 켠 비용의 직접 비교와 다이제스트의 4K·쓰기·지연 수치를 찾지 못했다.
- Guz 논문 본문을 열지 못해 iSCSI 전송 구성, 커널 버전, 그래프 절대값을 확인하지 못했다. ReFlex·i10이 재인용한 "iSCSI 코어당 약 70K IOPS"도 원 출처를 열지 못해 본문에서 제외했다.
- ntprof의 연결 하나·job 5→6개 측정은 fact sheet 한 줄로만 확인했고 §4.3 원문은 열지 못했다. 3절 근거 블록의 해석 행에 `Σ`가 붙은 이유다.
- Mayastor는 현재 버전의 조건 명시 벤치마크를 찾지 못했다. Ceph NVMe-oF gateway는 사용자 보고와 조건이 불충분한 공식 블로그 외의 실측을 찾지 못했다.
- Ceph primary OSD의 복제 쓰기 흐름을 설명하는 원문은 확인하지 못했다.
- NVMe SR-IOV SSD와 live migration 구현 상태는 VM 쪽 주제이므로 [02]({{< relref "/data/block-storage/02-vm-disk-paths/index.md" >}})에서 다룬다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| StarWind 측정 장비와 구현 | 2024년 글. Optane P5800X 한 장, 100GbE ConnectX-5, SPDK 타깃 v23.05, 타깃 커널 5.15, 리눅스 initiator 커널 5.4. 세 전송 모두 SPDK 타깃 사용 | StarWind iSCSI vs NVMe-oF: Performance Comparison | `Ⓥ` |
| StarWind QD1 랜덤 쓰기 | 4K 랜덤 쓰기 QD1. RDMA 28,000 IOPS·0.033ms, TCP 15,500 IOPS·0.063ms, iSCSI 8,716 IOPS·0.113ms | StarWind 비교 글 | — |
| 다중 스레드 처리량 | 각 조건에서 RDMA 1,558K, TCP 1,503K, iSCSI 1,272K IOPS. 로컬은 1,552K이며 numjobs=6, iodepth=4 | StarWind 비교 글 | — |
| 다중 스레드 결과에서 가능한 해석 | 각 조건의 처리량에서 RDMA·TCP는 로컬에 가깝고 iSCSI는 82% 수준 | StarWind 비교 글 | — |
| 타깃과 재현 자료의 한계 | SPDK 타깃 측정이며 커널 nvmet·LIO 결과가 아님. 벤더 블로그에 원자료·스크립트 미공개 | StarWind 비교 글 | — |

{{% /details %}}

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

iSCSI는 SCSI 명령을 TCP 위에서 나르는 전송 프로토콜입니다. RFC 7143(2014-04)은 RFC 3720 등 앞선 문서를 통합했습니다. SCSI 계층이 만든 CDB를 iSCSI 계층이 PDU로 감싸고, 하나 이상의 TCP 연결(포트 3260)로 주고받습니다. 기본 헤더(BHS)는 48바이트로 고정됩니다 `✓`.

세션은 SCSI I_T nexus와 같은 것입니다. CmdSN은 세션 전체에서 매기며, 한 연결 안에서는 CmdSN 순서대로 보내야 합니다. HeaderDigest·DataDigest(CRC32C)는 선택 기능입니다 `✓`.

커널 타깃인 LIO는 `targetcli`로 설정합니다. backstore에는 fileio·block·pscsi·ramdisk가 있으며, block은 로컬 블록 장치 전체를 LUN으로 내보냅니다. `/backstores/block`에서 `create name=block_backend dev=/dev/sdb`를 실행하고 `/iscsi`에서 IQN을 생성합니다. 이어서 `luns/`에서 backstore를 LUN에 연결합니다 `✓`.

iSER(RFC 7145, 2014-04)는 같은 iSCSI를 RDMA(iWARP, InfiniBand RC) 위에서 동작시킵니다. RDMA Read/Write로 데이터를 SCSI I/O 버퍼에 중간 복사 없이 놓습니다 `✓`. 세션마다 scsi_host와 연결을 하나씩 사용하는 방식은 iscsi_tcp와 같습니다. 이 글의 자료에는 iSER 실측이 없습니다.

### NVMe-oF 구성 절차

SPDK 타깃은 기존 블록 장치에 namespace 번호를 붙여 subsystem에 넣고 포트를 열어 가상 NVMe 장치를 제공합니다 `✓`.

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

호스트는 `nvme discover`와 `nvme connect` 대신 `nvme connect-all`을 사용할 수도 있습니다 `✓`.

커널 nvmet은 같은 구성을 configfs에 만듭니다. subsystem을 생성하고 namespace의 device path에 블록 장치를 적어 enable합니다. 그다음 port를 만들어 subsystem을 연결합니다 `✓`. LVM 논리 볼륨 경로도 블록 장치 경로이므로 사용할 수 있지만, 이 대입을 직접 설명한 문서는 확인하지 못했습니다 `≈`. 포트는 NVMe-oF용으로 4420, discovery용으로 8009를 사용합니다 `✓`.

### 전송별 차이

| 전송 | 데이터 교환 모델 | 큐와 연결 | 비용이 붙는 곳과 확인 상태 |
|---|---|---|---|
| TCP | message. capsule만 주고받는다 | 큐 쌍 1개 = TCP 연결 1개 | 작은 PDU마다 TCP/IP 처리, 스레드 간 컨텍스트 스위치, 복사와 CRC `Ⓑ`. 기존 소켓 인터페이스를 쓰는 소프트웨어 구현을 허용하도록 정의됐다 `✓` |
| RDMA | message/memory. capsule에 원격 메모리 읽기·쓰기를 섞는다 | 큐 쌍 1개 = RDMA QP 1개 | iWARP·InfiniBand·RoCE 위에서 Reliable Connected QP를 쓴다 `✓` |
| FC | message | 확인하지 못함 `?` | NVMe 2.0 전송 스펙 목록에 들어 있다 `✓`. nvme-fc가 들어간 커널 버전은 확인하지 못했다 `?` |

### 연혁

NVMe-oF 1.0은 2016년 6월에 나왔습니다. Linux 4.8(2016-10)에는 RDMA용 host와 target이 들어갔습니다. TCP 전송의 비준 소식은 2018년 11월에 공개됐으며, Linux 5.0(2019-03)에 host와 target이 함께 들어갔습니다. 멀티패스는 4.15, ANA는 4.19에 추가됐습니다 `✓`.

1.1a(2021) 이후 NVMe-oF 스펙은 별도로 개정되지 않고 NVMe 2.0 Base 스펙에 흡수됐습니다. TCP 전송 스펙은 2025년 개정 1.2까지 확인했습니다 `✓`.

### 추가 실측

ReFlex(ASPLOS'17)는 Xeon E5-2630(12코어, 2소켓), Intel 82599ES 10GbE, Arista 7050S-64 스위치, Ubuntu 16.04 커널 4.4, 1M IOPS급 NVMe를 사용했습니다. jumbo frame을 사용하고 LRO/GRO를 끈 상태에서 4KB 랜덤 QD1 지연을 측정했습니다 `Ⓑ`. 본문과 장치·링크가 다른 과거 측정이므로 수치를 직접 비교하지 않습니다.

| 구성 | 읽기 평균 / p95 | 쓰기 평균 / p95 |
|---|---|---|
| 로컬(SPDK) | 78 / 90µs | 11 / 17µs |
| iSCSI | 211 / 251µs | 155 / 215µs |
| libaio 서버 + Linux 클라이언트 | 183 / 205µs | 확인하지 않음 |
| ReFlex 서버 + IX 클라이언트 | 99 / 113µs | 31 / 34µs |

저자는 10GbE TCP/IP가 소프트웨어 스토리지 스택에 닿기 전에 무부하 지연을 최소 50µs 늘린다고 적습니다 `Ⓑ`.

SPDK 24.05 TCP 보고서에서 SPDK 타깃의 4KiB 랜덤 읽기 처리량은 1코어 611.3K, 8코어 5,571K, 12코어 8,307K IOPS였습니다. 48코어에서는 11,059K(362Gbps)에 이르러 링크가 포화됐습니다. RDMA 보고서(QD128)의 1코어 값은 1,564.5K입니다. TCP와 QD가 달라 배수로 비교하지 않습니다 `Ⓑ`.

타깃 소프트웨어를 DPU로 옮긴 실측은 SPDK 26.01 RDMA 보고서(NVIDIA, 2026-02)에 있습니다. BlueField-3(Arm Cortex-A78AE 16코어, 커널 5.15)에서 SPDK 타깃을 실행하고 200GbE 2포트와 SSD 16개 JBOF를 거쳤습니다. 4KiB 랜덤 읽기 QD64의 결과는 1코어 469.8K, 8코어 6,135K, 16코어 10,091K IOPS였습니다 `Ⓑ`.

iSCSI와 직접 비교한 결과는 벤더 자료에 많습니다. Blockbridge는 Proxmox 7.2, 커널 5.15.53, EPYC 7452, ConnectX-5 100GbE, VM 32대, 자사 백엔드에서 측정했습니다. 이 조건에서 NVMe/TCP는 iSCSI보다 512B 평균 IOPS가 35.4% 높았다고 보고합니다. 4K QD4에서는 IOPS가 50% 이상 높고 지연은 33% 낮았지만, 대역폭이 한계인 큰 블록에서는 차이가 약 0.1%였습니다 `Ⓥ`.

Dell PowerStore 자료(ESXi, 기본 설정; 발행 연도 미확인)는 iSCSI의 IOPS가 가장 낮고 지연과 IO당 CPU가 가장 높다고 적습니다. NVMe/TCP@25GbE는 쓰기에서 NVMe/FC·FCP@32GFC와 비슷하고, 읽기에서는 20% 이내로 뒤진다고 보고합니다 `Ⓥ`.

Intel·MayaData 공동 문서는 Mayastor의 오버헤드가 Optane P5800X raw 대비 10% 미만이라고 주장했습니다. Blocks & Files는 수치가 불완전하고 단위가 정의되지 않아 비교할 수 없다고 지적했습니다 `Ⓥ`.

SUSE의 Longhorn 1.6.0 발표(2024)는 V2가 V1보다 쓰기에서 2~4배, 랜덤 읽기에서 2~3배 빠르며 지연은 50~70% 감소한다고 주장했습니다. 단일 replica의 IOPS도 로컬 디스크와 비슷하다고 설명했습니다 `Ⓥ`. 원 측정 조건은 확인하지 못했으며, 이 주장은 v1.12.0의 기준선 대비 30%와도 어긋납니다.

Ceph NVMe-oF gateway의 한계는 개발 버전 문서 기준으로 gateway 그룹 4개, 그룹당 gateway 8개, 그룹당 subsystem 128개, subsystem당 호스트 32개, 그룹당 namespace 1,024개입니다 `✓`. IBM Storage Ceph 7.1 문서의 사이징은 목표 100,000 IOPS에 reactor 코어 1개·총 16코어, 200,000에 2개·18코어, 250,000에 4개·22코어, 300,000에 8개·30코어입니다 `Ⓥ`.

### 그 밖의 방식

FC와 FCoE는 전용 패브릭이나 이더넷 위에서 SCSI를 나릅니다. FC는 NVMe 명령도 나르는 NVMe-oF 전송 중 하나입니다 `✓`. FCP·FCoE의 1차 표준 문서는 확인하지 못했습니다 `?`.

NBD 클라이언트는 블록 읽기 요청마다 TCP로 서버에 요청을 보내고 읽은 데이터를 돌려받습니다. 커널 모듈은 클라이언트에만 있으며 nbd-server는 전부 유저스페이스에서 실행됩니다 `✓`. 이 글의 질문에 답할 만한 독립 실측은 없어 방식만 소개합니다.

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
