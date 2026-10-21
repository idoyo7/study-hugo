---
title: "NVMe over FC·TCP·RDMA의 성능과 안정성 비교"
linkTitle: "07 FC·TCP·RDMA 전송 비교"
description: "NVMe over FC·TCP·RDMA의 장비 요건과 운영 기능, 공개 측정 결과를 비교하고 FC의 안정성과 TCP의 접근성이 성립하는 조건을 살핀다."
weight: 7
date: 2026-10-21
lastmod: 2026-10-21
url: "/storage/07-fc-tcp-rdma-transports/"
---

# 07 · NVMe over FC·TCP·RDMA의 성능과 안정성 비교

Kubernetes와 클라우드에서 실제로 고를 수 있는 NVMe-oF 전송은 사실상 TCP입니다. 홈랩에서도 TCP가 가장 접근하기 쉽다는 것이 이 글의 판단입니다. 범용 NIC와 L3 라우팅 망을 쓰고, Linux 5.0부터 호스트와 타깃이 기본 커널에 들어 있습니다.

FC가 가장 안정적이라는 평가는 스토리지 전용 망의 장애 격리와 오랜 운영 도구·상호운용 인증 체계라는 두 측면에서만 타당하다는 것이 이 글의 판단입니다. 무손실 전송이 정체까지 없애지는 않으며, FC의 slow-drain은 RoCE의 PFC storm과 같은 계열의 정체 전파 문제입니다.

TCP를 선택하면 FC 패브릭이 제공하던 디스커버리와 존 기능은 별도로 갖춰야 합니다. Dell의 PowerStore 측정에서는 NVMe/TCP의 IO당 CPU가 NVMe/FC보다 근소하게 높았고, Western Digital 백서의 4K QD1 쓰기에서는 TCP의 p99.99 지연이 RoCE보다 높았습니다.

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인. 각 절 끝의 '근거와 측정 조건'에 수치와 조건을 모았습니다. 벤더별 지원 현황은 [04 엔터프라이즈 전송 현황]({{< relref "/data/block-storage/04-enterprise-transports/index.md" >}})에, 프로토콜 구조는 [01 iSCSI와 NVMe-oF]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}})에, 호스트·클라우드 쪽은 [05 호스트·클라우드·오프로드]({{< relref "/data/block-storage/05-host-side-and-cloud/index.md" >}})에 있습니다.

## 1. 쓸 수 있는 전송은 장비와 환경이 결정한다

TCP는 범용 이더넷에서 시작할 수 있습니다. FC와 RDMA에는 전용 어댑터와 그에 맞는 네트워크가 필요합니다.

| 전송 | 필요한 장비·네트워크 | 자료가 제시하는 용도(출처별) |
|---|---|---|
| NVMe/TCP | 범용 NIC, 범용 이더넷 L2/L3 | Dell은 기존 iSCSI 환경 확장·SDS·엣지·대규모 분산·클라우드 운영 모델이나 CAPEX가 중요한 경우에 제시 |
| NVMe/FC | HBA(호스트 버스 어댑터), FC 스위치 또는 직결, 존·WWPN 관리 | Dell은 기존 FC SAN의 포트 확장이나 최저 지연·IO당 최저 CPU가 필요한 경우에 제시 |
| NVMe/RDMA | RNIC(RDMA 지원 NIC), PFC·ECN/DCQCN을 일관되게 설정한 무손실 이더넷 또는 IB(InfiniBand) | Western Digital은 RoCE를 소규모 하이엔드 구축이나 최저 지연이 중요한 대형 클라우드 사업자용으로 설명 |

Linux 서버 두 대면 NVMe/TCP 호스트와 nvmet-tcp 타깃을 구성할 수 있습니다. Kubernetes 문서에는 in-tree `fc` 볼륨 타입도 남아 있지만, NVMe-oF CSI 드라이버는 거의 TCP입니다. 퍼블릭 클라우드 VM에 FC를 연결하는 방법은 하이퍼스케일러 문서에서 확인하지 못했습니다. Kubernetes에서 Mayastor 같은 NVMe-oF 스토리지를 쓰는 길은 [08 Kubernetes NVMe-oF와 Mayastor]({{< relref "/data/block-storage/08-kubernetes-nvmeof-mayastor/index.md" >}})에서 이어집니다.

Dell의 결정표는 기존 FC SAN에 포트를 추가하거나 최고 IOPS·최저 지연·IO당 최저 CPU가 필요하고 CAPEX가 최우선이 아닐 때 NVMe/FC를 제시합니다. Ampcom은 Tier-1 데이터베이스와 ERP를 FC에 남기고 나머지는 TCP·iSCSI로 구성하는 하이브리드가 흔하다고 분석합니다. WWT의 검색 요약에는 신규 구축을 TCP가 주도한다는 판단이 나오지만, 본문은 직접 확인하지 못했습니다.

비용 차이를 구체적으로 비교할 자료는 Dell H18892 하나였습니다. Dell이 제시한 이더넷의 최대 81% 절감은 일부 네트워크 인프라 구성의 결과입니다. 이 비교는 FC와 이더넷 포트를 같은 성능으로 취급한다는 조건이 붙습니다. Lightbits는 TCP가 5배 저렴하다고 주장했지만, 비교 조건은 확인하지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

Dell H18892의 비용 막대그래프는 이미지라 개별 금액을 확인하지 못했다.

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| nvme-tcp 도입 | Linux 5.0, "NVMe-oF가 세상 모든 이더넷 포트에서 돈다" | KernelNewbies Linux 5.0 | `✓` |
| nvme-fc·nvme-rdma 도입 | nvme-rdma 4.8, nvme-fc 4.10, lpfc 4.11, qla2xxx 4.13 | KernelNewbies | `✓` |
| FC HBA 요건 | NVMe/FC는 Gen 6(LPe31000 16G, LPe32000 32G)부터 Gen 7(LPe35000 32G, LPe36000 64G)까지 | Broadcom Emulex 지원 매트릭스 | `✓` |
| RDMA 무손실 요구 | vSphere 9 문서가 무손실 이더넷 구성을 요구 | Broadcom vSphere 9.0 문서 | `✓` |
| TCP 소켓 인터페이스 | 기존 TCP 소켓 인터페이스만으로 효율적 구현이 가능하게 설계 | NVMe over TCP 스펙 1.3 | `✓` |
| 클라우드 FC 연결 | 하이퍼스케일러 문서에서 FC 연결 옵션을 찾지 못함 | 기존 보고서 5절 | `≈` |
| Kubernetes in-tree fc | 볼륨 문서 목차에 있음. CSI 쪽은 거의 TCP | Kubernetes Volumes 문서 | `✓` |
| 이더넷 비용 | 일부 구성에서 FC보다 최대 81% 낮음. Config 1은 어댑터·트랜시버·케이블·스위치만 넣은 최대 격차 구성, Config 2는 25GbE와 32G 스위치·어댑터, PowerStore, 호스트 24 : 스토리지 8 인터페이스(4:1 팬아웃). 2023 | Dell H18892 | `Ⓥ` |
| 포트 동일 성능 단서 | PowerStore에서 NVMe/TCP@25G는 쓰기 IOPS가 비슷하고 읽기 IOPS가 최대 20% 낮음 | Dell H18892 | `✓` |
| TCP가 5배 저렴 | 2021년 주장, 조건 미확인. 중립 기관의 포트당 가격 자료 없음 | ComputerWeekly(Lightbits) | `Ⓥ` `?` |
| Dell 결정표 | NVMe/FC: 기존 FC 환경에 포트 추가, 최고 IOPS, 최저 지연, IO당 최저 CPU, CAPEX가 최우선이 아닐 때. NVMe/TCP: 기존 iSCSI 환경 확장, SDS, 엣지·대규모 분산, 클라우드 운영 모델, CAPEX가 매우 중요할 때 | Dell H18892 | `Ⓥ` |
| 하이브리드 분석 | Tier-1 DB·ERP는 FC, 나머지는 TCP·iSCSI | Ampcom | `≈` |
| WWT 판단 | 신규 구축은 TCP 주도. 본문은 직접 확인하지 못함 | WWT 블로그(검색 요약) | `≈` |
| RoCE 용도 | 소규모 하이엔드 또는 최저 지연이 중요한 대형 클라우드 사업자용 | Western Digital 백서 | `Ⓥ` |
| 홈랩 TCP | nvmet-tcp 타깃이 5.0부터 커널에 있음. FC·RDMA 비용 판단은 추정 | KernelNewbies Linux 5.0 | `✓` `≈` |

{{% /details %}}

## 2. 디스커버리와 보안은 전송마다 다르다

FC는 패브릭 네임서버로 장치를 찾고 존을 사용합니다. TCP는 디스커버리 컨트롤러를 수동으로 지정하거나 CDC(중앙 디스커버리 컨트롤러)가 필요합니다. Dell은 이더넷에서도 FC 수준의 디스커버리·존·인증을 제공하려고 CDC를 제시했습니다. Linux 호스트에서 이를 갖추는 방법은 [06 Linux NVMe/TCP 운영]({{< relref "/data/block-storage/06-linux-nvme-tcp-operations/index.md" >}})에서 다룹니다.

DH-HMAC-CHAP 인증과 ANA 기반 네이티브 멀티패스는 Linux에서 세 전송의 공통 기능입니다. TLS 1.3은 TCP 전송 스펙에만 있고, FC는 FC-SP-2의 프레임 암호화와 DHCHAP을 씁니다. Linux 연결 옵션에서도 TCP만 다이제스트와 TLS 옵션을 제공합니다.

FC의 SAN 부팅은 성숙한 기능입니다. TCP 부팅은 NVMe Boot Spec에 따라 vSphere 9.0 GA부터 지원합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

2025~2026년 자료에서는 TCP 스펙 1.3이 양자내성 하이브리드 그룹을 권고하고, Broadcom은 128G 스위치와 Emulex Secure HBA의 양자내성을 내세운다.

FC의 FPIN 링크 무결성 알림으로 경로를 marginal 처리하는 패치는 v8까지 제출됐으나 7.3-rc1 트리에는 없다.

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| TLS는 TCP만 | RDMA 스펙 1.3 텍스트에서 "secur"를 찾아도 없음. TCP는 TLS 1.3(PSK, (EC)DHE 필수). SNIA 자료는 TLS가 RoCEv2·iWARP에 적용되지 않는다고 정리 | NVMe over TCP·RDMA 스펙 1.3, SNIA SDC23 | `✓` `≈` |
| 양자내성 | TCP 1.3은 양자내성 요구가 범위 밖이라면서 SecP384r1MLKEM1024 그룹을 "지원해야 한다(should)"로 추가. Broadcom 128G 스위치는 256비트 양자내성 암호화를 내세움 | NVMe over TCP 스펙 1.3, Broadcom 보도자료 | `✓` `Ⓥ` |
| Emulex Secure HBA | 32G/64G, 전송 중 암호화를 HBA에 오프로드. 2025-01 | Blocks & Files | `Ⓥ` |
| FC 보안 | FC-SP-2 ESP_Header(페이로드 암호화, FC 헤더는 평문), DHCHAP | FCIA Solutions Guide 2019 | `✓` |
| DH-HMAC-CHAP | `dhchap_secret`, `dhchap_ctrl_secret`이 세 전송 공통 옵션. TCP 1.3 본문은 "KX-HMAC-CHAP" 표기(이름 변경 배경 `?`) | Linux `fabrics.c`, TCP 스펙 1.3 | `✓` |
| TCP 전용 옵션 | `hdr_digest`, `data_digest`, `host_iface`, `tls`, `keyring`, `tls_key`, `concat`. TLS는 6.7부터 | Linux `tcp.c`, KernelNewbies | `✓` |
| FC 옵션과 타이머 | `reconnect_delay`, `ctrl_loss_tmo`. 원격 포트 dev_loss_tmo 기본 60초. 원격 포트 발견 시 `FC_EVENT=nvmediscovery` udev 이벤트로 자동 연결 | Linux `fc.c` | `✓` |
| FPIN 패치 | v8(2025-07) | linux-nvme 메일링 리스트 | `✓` 부재 `✓` |
| 디스커버리 | FC는 패브릭 네임서버. TCP는 디스커버리 컨트롤러 수동 지정, CDC, nvme-stas. RDMA는 수동 지정 | Linux `fc.c`, Dell H18892 | `✓` |
| 부팅 | FC: NetApp이 RHEL 9.4부터 NVMe/FC SAN 부팅 지원 표기. TCP: NVMe Boot Spec(ACPI NBFT), vSphere 9.0 GA. RDMA: 부팅 스펙 예시에 없고 부정적 자료(2020년 무렵)만 있음 | NetApp ONTAP SAN host, NVMe Boot Spec, Cody Hosterman 블로그 | `Ⓥ` `✓` `≈` |

{{% /details %}}

## 3. CPU와 지연 차이는 측정 조건과 함께 읽는다

공개 측정을 하나의 전송 순위로 묶기는 어렵습니다. 같은 하드웨어에서 FC·TCP·RDMA를 함께 잰 자료는 Marvell 후원 기사 하나였고, 중립 기관의 동일 조건 비교는 찾지 못했습니다. Dell과 Marvell의 결과도 어레이와 링크 조건, 이더넷 구성의 공개 범위가 달라 직접 합칠 수 없습니다.

CPU 비용을 만드는 데이터 경로부터 다릅니다. Linux nvme-tcp는 송신에서 페이지를 넘겨 복사를 피하지만 수신에서는 소켓 버퍼의 데이터를 bio 페이지로 복사합니다. RDMA는 RNIC가 데이터를 옮깁니다. FC에서 HBA가 프레임·CRC·DMA를 맡는다는 설명은 Linux 드라이버 인터페이스를 바탕으로 한 추정입니다.

Dell의 PowerStore 측정에서는 NVMe/FC의 IO당 CPU가 가장 낮고 NVMe/TCP가 근소한 차이로 뒤를 이었습니다. Western Digital의 100GbE OpenFlex Data24 측정에서 4K QD1 쓰기 p99.99는 RoCE 41µs, TCP 122µs였습니다. 잡 수와 큐 깊이가 낮을수록 RoCE가 유리했던 벤더 측정 결과입니다.

Dell의 PowerStore 측정에서 NVMe/TCP@25G는 쓰기 IOPS가 NVMe/FC·FCP@32G와 비슷했고, 읽기에서는 20% 이내로 뒤졌습니다. Marvell이 후원하고 자체 랩에서 수행한 StorageReview 기사에서는 중부하에서 FC-NVMe의 지연이 NVMe/TCP보다 56% 낮았다고 보고했습니다. VMware가 같은 HBA·SAN에서 프로토콜만 바꿔 측정했을 때는 1VM의 FC-NVMe 트랜잭션 처리량이 FCP보다 68% 높았습니다. Demartek도 같은 하드웨어에서 FC-NVMe의 IOPS가 FCP보다 높고 지연이 낮았다고 보고했습니다.

i10 논문은 2019년 커널 4.20의 초기 NVMe-TCP와 IB 포트의 RDMA를 비교했습니다. 그 결과를 2026년 nvme-tcp의 성능으로 읽을 수는 없습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

세 전송은 NVMe 큐 쌍 하나를 연결 하나에 1:1로 묶는다. TCP는 TCP 연결, RDMA는 신뢰 QP(RC), FC는 FC-NVMe connection이 단위다. RDMA에서 호스트는 버퍼를 등록하고 키를 SGL에 담아 보낸다. FC는 명령마다 교환(exchange) 하나를 열며 CMD IU에 64바이트 SQE를 담는다. 성공하면 12바이트 0 응답을 보내고 호스트가 완료 항목을 직접 만든다. TCP의 선택 사항인 CRC32C 다이제스트는 CPU가 계산하며 기본값은 꺼짐이다.

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 큐 쌍 1:1 매핑 | TCP는 연결 하나가 SQ/CQ 쌍 하나, 다중화·분할 금지. RDMA는 QP 하나가 쌍 하나, 분할 금지 | NVMe over TCP·RDMA 스펙 1.3 | `✓` |
| TCP 쓰기·읽기 경로 | R2T, H2CData(최대 크기 MAXH2CDATA), C2HData, Response Capsule. 스펙 예시는 R2T 3회·H2CData 4회로 12,288바이트 | NVMe over TCP 스펙 1.3 | `✓` |
| RDMA 데이터 이동 | 모든 RDMA_READ/WRITE는 컨트롤러가 시작. IRD를 넘기면 QP 오류 | NVMe over RDMA 스펙 1.3 | `✓` |
| FC 명령 구조 | CMD IU에 SQE, connection_id, csn, 데이터 길이. 성공 응답 12바이트 0 | Linux `nvme-fc.h`(FC-NVME-2 r1.08 정의), `fc.c` | `✓` |
| FC HBA가 프레임·CRC·DMA 담당 | 커널 LLDD 인터페이스에서 추정 | Linux `fc.c` | `≈` |
| TCP 복사·다이제스트 | 송신 `MSG_SPLICE_PAGES`, 수신 `skb_copy_datagram_iter`. HDGST·DDGST 기본 꺼짐 | Linux `tcp.c`, TCP 스펙 3.3.1.1 | `✓` |
| i10 병목 | 4KB 랜덤 읽기, 코어당 네트워크 스택 약 915 kIOPS, 로컬 스토리지 스택 약 350 kIOPS, 당시 원격 스토리지 스택 96 kIOPS. 커널 4.20(2019) | Hwang 외, NSDI'20 | `Ⓑ` |
| I/O 큐 수 | qla2xxx `ql2xnvme_queues` 기본 8. TCP·RDMA는 온라인 CPU 수 | Linux `qla_nvme.c`, `fabrics.c` | `✓` |

큐 수 차이가 벤치마크 결과에 섞일 수 있다는 것은 이 글의 해석이다.

Dell H18892의 측정 조건과 결과는 다음과 같다.

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 조건 | ESX 7.0u3 서버 4대, VM 8개, vdbench, PowerStore 9000(OS 3.0), 25GbE(100GbE 어댑터를 25G로 운용) 대 32GFC, 4K, 멀티패스 Round Robin, NVMe 쪽 볼륨 64개. 수행 주체 Dell | Dell H18892 | `Ⓑ` |
| IOPS·지연 | NVMe/FC가 FCP보다 IOPS 높고 지연 낮음. NVMe/TCP@25G는 쓰기에서 NVMe/FC·FCP@32G와 비슷, 읽기에서 20% 이내로 뒤짐. iSCSI 최저 | Dell H18892 | `Ⓑ` |
| IO당 CPU | NVMe/FC 최저, NVMe/TCP 근소한 2위. 대부분 경우 NVMe/TCP가 FCP보다 적게 사용. iSCSI 최고. 막대그래프 개별 수치는 이미지라 확인 불가 | Dell H18892 | `Ⓑ` 수치 `?` |
| 각주 | 멀티패스 정책을 IOPS로 바꾸면 패브릭 혼잡 같은 조건에서 더 나았음 | Dell H18892 | `✓` |

VMware 측정의 조건은 ESXi 7.0 U1, 36코어 3.0GHz 서버, Broadcom Emulex LPe35002-M2(32G) 듀얼 포트, Dell EMC Connectrix DS-6620B 스위치, NetApp AFF A800(NVMe SSD 24개)다. 같은 HBA·SAN에서 프로토콜만 바꿨다. fio는 Ubuntu VM 4개에 미결 I/O 합계 120(장치당 30)이었다. 수행 주체는 VMware이며 2020-11-23 자료다.

| VM 수 | SCSI FCP Txns/s | FC-NVMe Txns/s | 차이 |
|---|---|---|---|
| 1 | 2,918 | 4,915 | +68% |
| 2 | 5,224 | 9,681 | +85% |
| 4 | 9,021 | 11,777 | +31% |
| 8 | 9,947 | 11,344 | +14% |

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 디스크 IOPS | 1VM 50,220 대 82,720(+65%), 8VM 168,377 대 181,822(+8%) | VMware 성능 연구 | `Ⓑ` |
| fio | 4KB~256KB 전 구간에서 FC-NVMe IOPS가 FCP의 두 배. 8VM에서 이득이 준 원인은 호스트 CPU·메모리 | VMware 성능 연구 | `Ⓑ` |

Demartek, Marvell 후원 기사와 학술 자료는 각각 별도의 구성에서 측정했다.

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Demartek NVMe/FC 대 FCP | NetApp AFF A700s, 같은 하드웨어에서 IOPS 최대 58% 향상, 지연은 테스트에 따라 최소 11~34% 감소. 소프트웨어 업그레이드만으로 활성화. HBA·스위치·워크로드 세부 미기재. 2018-05 | StorageNewsletter(Demartek) | `Ⓥ` |
| 3전송 동시 측정 | Marvell QLogic QLE2772(32G FC), NetApp AFF A250, VMware ESXi 7. 이더넷 NIC·스위치·속도, 큐 깊이, 잡 수, 도구, 중·고부하 블록 크기는 비공개. Marvell 후원, Marvell 랩 수행. 2022-03-29 | StorageReview | `Ⓥ` |
| 경부하 | NVMe-RoCE 최고, FC-NVMe 근소한 2위. 8K 읽기에서 NVMe/TCP 패브릭 지연은 FC-NVMe의 약 2배 | StorageReview | `Ⓥ` |
| 중부하 | FC-NVMe가 NVMe/TCP보다 지연 56% 낮고 트랜잭션 약 127% 많음 | StorageReview | `Ⓥ` |
| 고부하 | FC-NVMe 대역폭 50% 높음, CPU 사이클 "현저히 적음"(수치 없음) | StorageReview | `Ⓥ` |
| Samsung SYSTOR'17 | 호스트 3대(Xeon E5-2699 2소켓), 타깃(Xeon E7-8890 4소켓, PM1725 3개), ConnectX-4 100GbE RoCE, 100G ToR, 4KB 랜덤. NVMe-oF(RoCEv2) 처리량이 DAS와 같음. iSCSI는 최대 40% 낮고 호스트 CPU 30% 추가. RocksDB에서 DAS 대비 처리량 2% 차이, 평균 지연 507µs→568µs, p99 3.6ms→3.7ms | Guz 외 슬라이드 | `Ⓑ` |
| i10 NSDI'20 | 2대 직결, Xeon Gold 6128 4소켓, ConnectX-5 EX 100G, PM1725a, 커널 4.20, fio 4KB libaio, RDMA 측은 IB 포트. SSD 포화에 NVMe-TCP가 NVMe-RDMA보다 코어 2.5배(랜덤 읽기). 쓰기는 RDMA 3코어, TCP 6코어. 저부하 지연 i10 189µs, NVMe-RDMA 평균 105µs, p99 206µs 대 119µs | Hwang 외 | `Ⓑ` |

Western Digital 백서의 조건은 100GbE, OpenFlex Data24다. 4K QD1 쓰기 p99.99는 RoCE 41µs, TCP 122µs였고 읽기는 각각 163µs와 177µs였다. 잡 수와 큐 깊이가 낮을수록 RoCE가 유리했다. 벤더 수행 측정이며 2025-02 자료다(`Ⓑ`).

{{% /details %}}

## 4. FC의 안정성은 무손실만으로 설명되지 않는다

FC의 안정성 평판은 스토리지 전용 망의 장애 격리와 30년 가까이 축적한 운영 도구·상호운용 인증 체계에서 나온다는 것이 이 글의 해석입니다. A/B 두 패브릭을 물리적으로 분리하는 업계 관행이 장애 격리에 기여한다고 보지만, 이를 뒷받침하는 1차 수치 자료는 확인하지 못했습니다. 프레임 손실의 주원인은 비트 오류보다 혼잡이라고 봅니다. 무손실 망은 혼잡에 따른 손실을 지연과 정체 전파로 바꿀 뿐, 정체를 없애지는 않습니다.

FC는 링크 단위 buffer-to-buffer credit으로 흐름을 제어합니다. 수신 버퍼가 비었다는 R_RDY를 받아야 다음 프레임을 보내므로 혼잡 때문에 프레임을 버리지 않습니다. 느린 장치가 R_RDY를 늦게 돌려주면 스위치 버퍼와 ISL(스위치 간 링크) credit이 부족해집니다. 그러면 무관한 흐름도 막힙니다. Cisco 문서는 이 slow-drain 문제와 진단 절차를 설명합니다.

RoCE에서도 정체가 퍼진 사례가 있습니다. Microsoft의 SIGCOMM 2016 보고에서는 NIC 버그로 PAUSE가 지속되면서 ToR·Leaf·Spine을 지나 다른 서버까지 멈추는 PFC storm이 여러 번 관측됐습니다. FC의 slow-drain과 RoCE의 PFC storm은 무손실 망에서 정체가 전파되는 같은 계열의 문제입니다. FC 쪽에서는 이 보고에 견줄 공개 장애 사례를 찾지 못했습니다.

FC-NVMe와 FCP는 같은 물리 망·HBA·스위치를 쓰고 FC-4 계층만 다릅니다. FCIA는 FC-NVMe-2의 SLER(시퀀스 단위 오류 복구)이 프레임 손실 복구를 빠르게 했다고 설명합니다.

FC-NVMe 자료가 적은 이유로는 소프트웨어 업그레이드만으로 활성화할 수 있다는 점, 엔터프라이즈 SAN에 한정된 사용자층, 벤더가 주로 수행하는 공개 측정을 꼽을 수 있습니다. 첫째와 셋째는 자료에서 확인했으며, 둘째는 추정입니다.

자료가 적어도 FC 시장은 줄지 않았습니다. Crehan Research에 따르면 FC 매출은 2025년 6% 증가했고 2년 누적으로 20% 이상 늘었으며, 64G가 FC 스위치와 HBA 출하의 약 절반을 차지했습니다. Broadcom은 128G 스위치 출시를 발표했습니다. 128G HBA의 공식 자료는 찾지 못했습니다.

FC-NVMe 1판과 2판은 발행됐으며, FC-NVMe-3는 T11.3 작업 기록은 확인했으나 발행 기록은 찾지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| FC slow-drain과 ISL credit | class 2/3에 종단 간 흐름 제어 없음. 진단 절차는 egress E 포트면 FSPF 다음 홉으로 추적 | Cisco 기술 노트, MDS 9700 Slow Drain 백서 | `✓` |
| FC 감시 도구 | MDS TxWait 2.5µs 주기, slowport-monitor 1ms. lpfc는 Linux 4.14에 B2B credit recovery 추가 | Cisco FAQ, KernelNewbies 4.14 | `✓` |
| RoCE PFC storm | NIC 버그로 PAUSE 지속, ToR·Leaf·Spine 경유 확산. 테스트 클러스터에서 PFC와 이더넷 플러딩 상호작용으로 deadlock. 대책은 NIC watchdog(수신 정지 100ms 감지 시 PAUSE 차단)와 스위치 watchdog(PAUSE 200ms 소실 시 무손실 모드 재개) | Guo 외, SIGCOMM 2016 | `✓` |
| 장애 격리·A/B 패브릭 분리 | A/B 두 패브릭을 물리적으로 분리하는 업계 관행. 1차 수치 자료 없음 | 해당 없음 | `≈` |
| BER 1e-12, FEC | FC-PI 원문 미확인. 이더넷도 비슷하고 손실 주원인은 혼잡 | IEEE 802.3 발표 자료, USPTO 특허 | `≈` |
| SLER | 프레임 손실 시 교환을 끊지 않고 해당 시퀀스만 재전송. FLUSH·RED 교환 신설 | FCIA 발표(2020-08), lpfc 커밋 메시지(검색 요약 경유) | `Ⓥ` |
| 장거리 credit | Cisco MDS 16G 기준 km당 최소 8 credit, 50km면 약 400(프레임 2KB 가정) | Cisco MDS 장거리 ISL 버퍼 KB(Dell 미러) | `✓` |
| NVMe/FC 공존·업그레이드 | 같은 HBA·스위치에서 FCP와 공존, 소프트웨어 업그레이드로 활성화 | Demartek, Marvell 제품 페이지 | `Ⓥ` |
| 자료 적은 이유 | 소프트웨어 업그레이드로 활성화(Demartek, Marvell 제품 페이지 설명). 사용자층 한정은 추정 | StorageNewsletter(Demartek) | `Ⓥ` `≈` |
| FC 매출 추세 | 2025년 6% 증가, 2024년을 포함한 2년 누적 20% 이상. 64G가 FC 스위치+HBA 출하의 약 절반. 원 보고서는 유료 | Crehan Research 보도자료(2026-03-23) | `✓` 분석사 발표 |
| 128G 스위치 | Brocade X8 디렉터·G820(56포트), 2025-11-19 출시, "업계 최초 128G FC 플랫폼" | Broadcom 보도자료 | `Ⓥ` |
| 128G HBA | 공식 보도자료 없음. 직원 LinkedIn의 행사 언급만 | Broadcom 직원 LinkedIn | `?` |
| FC-NVMe 1판·2판 | INCITS 540-2018, INCITS 556-2020(R2025 표기) | FCIA, ANSI 스토어 | `✓` |
| FC-NVMe-3 | T11.3 작업 중(2023-12, 2024-04 회의록). 발행 기록 없음 | INCITS T11 회의록 | `≈` 발행 `?` |

{{% /details %}}

## 확인하지 못한 것

- 중립 기관이 같은 하드웨어에서 FC·TCP·RDMA를 함께 잰 벤치마크를 찾지 못했다. Marvell 후원 기사 하나가 유일하며 공개된 조건이 불완전하다.
- FC-NVMe 스펙 원문(INCITS 556)은 유료라 읽지 못했다. FC 프레임 구조는 Linux 헤더를 근거로 했으며, SLER의 FLUSH·RED 타이머 같은 세부는 다루지 못했다.
- NVMe/RDMA SAN 부팅의 현재 지원을 확인하지 못했다. 부정적 자료(2020년 무렵 Pure 블로그)만 있다.

## 참고 자료

- [NVMe over TCP Transport Specification Rev 1.3 (PDF)](https://nvmexpress.org/wp-content/uploads/NVM-Express-NVMe-over-TCP-Transport-Specification-Revision-1.3-Ratified-2026.07.31.pdf) · [NVMe over RDMA Transport Specification Rev 1.3 (PDF)](https://nvmexpress.org/wp-content/uploads/NVM-Express-NVMe-over-RDMA-Transport-Specification-Revision-1.3-Ratified-2026.07.31.pdf) · [NVM Express Boot Specification](https://nvmexpress.org/specification/nvme-boot-specification/) — 큐 쌍 매핑, PDU 흐름, TLS, 보안 절 부재, 부팅
- [FCIA, INCITS Publishes FC-NVMe](https://fibrechannel.org/?p=2197) · [ANSI Webstore INCITS 556-2020](https://webstore.ansi.org/standards/incits/incits5562020) · [FC-NVMe-2 완료 발표](https://aiwire.net/2020/08/11/fcia-announces-completion-of-the-fibre-channel-nvme-2-standard) · [INCITS T11 회의록 2023-00409](https://standards.incits.org/apps/group_public/download.php/158928/T11-2023-00409-v000.pdf) · [2024-00120](https://standards.incits.org/apps/group_public/download.php/162142/T11-2024-00120-v001.pdf) — FC-NVMe 표준 이력, SLER, FC-NVMe-3 작업 상태
- [Crehan Research, Fibre Channel Networking Sales Grew 6% in 2025](https://www.globenewswire.com/news-release/2026/03/23/3260519/0/en/Fibre-Channel-Networking-Sales-Grew-6-in-2025-Reports-Crehan-Research.html) · [Broadcom, Gen 8 128G SAN Switch Portfolio](https://investors.broadcom.com/news-releases/news-release-details/broadcom-introduces-worlds-first-quantum-safe-gen-8-128g-san) · [Blocks & Files, Emulex Secure HBAs](https://blocksandfiles.com/2025/01/28/post-quantum-cryptographic-encryption-for-sans-from-broadcom/) · [Broadcom Emulex NVMe/FC 지원 매트릭스](https://docs.broadcom.com/doc/12395428) — FC 매출, 128G 스위치, 암호화 HBA, 지원 HBA 세대
- [KernelNewbies Linux 5.0](https://kernelnewbies.org/Linux_5.0) · [4.14](https://kernelnewbies.org/Linux_4.14) · [4.8](https://kernelnewbies.org/Linux_4.8) · [4.10](https://kernelnewbies.org/Linux_4.10) · [4.13](https://kernelnewbies.org/Linux_4.13) — 전송별 도입 커널, B2B credit recovery
- [Linux fc.c](https://android.googlesource.com/kernel/common/+/refs/heads/android-mainline/drivers/nvme/host/fc.c) · [nvme-fc.h](https://android.googlesource.com/kernel/common/+/refs/heads/android-mainline/include/linux/nvme-fc.h) · [tcp.c](https://android.googlesource.com/kernel/common/+/refs/heads/android-mainline/drivers/nvme/host/tcp.c) · [fabrics.c](https://android.googlesource.com/kernel/common/+/refs/heads/android-mainline/drivers/nvme/host/fabrics.c) · [qla_os.c](https://android.googlesource.com/kernel/common/+/refs/heads/android-mainline/drivers/scsi/qla2xxx/qla_os.c) · [FPIN 패치 v8](https://lists.infradead.org/pipermail/linux-nvme/2025-July/057387.html) · [lpfc SLER 커밋](https://android-kvm.googlesource.com/linux/+/0d8af096430ed810aacade5f564e5b98347137d4) — FC 구조, TCP 복사·옵션, 큐 수 기본값, FPIN
- [Dell H18892 NVMe Transport Performance Comparison](https://www.delltechnologies.com/asset/en-us/products/storage/industry-market/h18892-nvme-transport-performance-comparison.pdf) · [VMware, NVMe-oF in vSphere 7.0 U1](https://www.vmware.com/docs/vsphere7u1-nvme-of-fc-vs-fc-scsi) · [Demartek (StorageNewsletter)](https://www.storagenewsletter.com/?p=189595) · [StorageReview, Marvell Doubles Down On FC-NVMe](https://www.storagereview.com/review/marvell-doubles-down-on-fc-nvme) · [Western Digital, NVMe/TCP vs RDMA with RoCEv2](https://documents.westerndigital.com/content/dam/doc-library/en_us/assets/public/western-digital/collateral/white-paper/white-paper-open-flex-data24-roce-vs-tcp.pdf) · [Hwang 외, i10 (NSDI'20)](https://www.usenix.org/system/files/nsdi20-paper-hwang.pdf) · [Guz 외, SYSTOR'17 슬라이드](https://www.systor.org/2017/slides/NVMe-over-Fabrics_Performance_Characterization.pdf) — 자료별 벤치마크, 비용, 결정표, 학술 측정
- [Guo 외, RDMA over Commodity Ethernet at Scale](https://courses.grainger.illinois.edu/cs598hpn/fa2019/papers/microsoftrdma.pdf) · [Cisco Slow-Drain FAQ](https://www.cisco.com/c/en/us/products/collateral/storage-networking/q-and-a-c67-2437929.html) · [Cisco MDS 9700 Slow Drain 백서](https://www3-realm.cisco.com/en/US/prod/collateral/ps4159/ps6409/ps12970/white_paper_c11-729444.html) · [Cisco MDS 장거리 ISL 버퍼 (Dell KB)](https://www.dell.com/support/kbdoc/en-us/000224737/cisco-mds-long-distance-isl-buffer-allocation?lang=en) · [IEEE 802.3 발표 자료](https://www.ieee802.org/3/100GNGOPTX/public/jul12/king_01b_0712_optx.pdf) · [USPTO 7076724](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7076724) — PFC storm, slow-drain, 장거리 credit, FC 비트 오류율
- [Broadcom TechDocs vSphere 9.0 NVMe Storage](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-0/vsphere-storage/about-vmware-nvme-storage.html) · [Kubernetes Volumes](https://kubernetes.io/docs/concepts/storage/volumes/) · [ComputerWeekly, Lightbits 5x](https://computerweekly.com/news/252523829/Lightbits-offers-NVMe-over-TCP-at-5x-less-than-NVMe-over-FC-et-al) · [Marvell FC-NVMe 제품 페이지](https://www.marvell.com/products/fibre-channel-adapters-and-controllers/fc-nvme.html) — RDMA 무손실 요구, in-tree fc, 비용 주장, NVMe/FC 활성화
- [FCIA Solutions Guide 2019](https://fibrechannel.org/wp-content/uploads/2018/08/FCIA_SolutionsGuide2019_pg12-13.pdf) · [SNIA SDC23 Security Update](https://snia.org/sites/default/files/2025-05/SNIA-SDC23-DeSanti-NVMe%2520-over-Fabrics-Security-Update_0.pdf) · [NetApp ONTAP SAN host, NVMe RHEL](https://docs.netapp.com/us-en/ontap-sanhost/nvme-rhel-supported-features.html) · [Cody Hosterman 블로그](https://www.codyhosterman.com/?p=7430) — FC-SP-2, 전송별 보안, 부팅 지원
- [WWT, The State of NVMe-oF in 2026](https://www.wwt.com/blog/the-state-of-nvme-of-in-2026) · [Ampcom, Fibre Channel Networking Market 2026](https://www.ampcom.com/blogs/industry-insights/fibre-channel-networking-market) — 시장 판단. WWT는 본문 직접 확인 불가
