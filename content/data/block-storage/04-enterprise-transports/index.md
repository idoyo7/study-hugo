---
title: "엔터프라이즈 어레이의 전송 선택: NVMe/TCP가 기본이 된 배경"
linkTitle: "04 엔터프라이즈 전송 현황"
description: "2026년 엔터프라이즈 어레이가 지원하는 NVMe/TCP·RoCE·FC-NVMe·iSCSI를 비교하고, 구축 부담과 성능 조건, 경로 관리와 보안 지원 범위로 전송 선택 기준을 짚는다."
weight: 4
date: 2026-10-21
lastmod: 2026-10-21
url: "/storage/04-enterprise-transports/"
---

# 04 · 엔터프라이즈 어레이의 전송 선택: NVMe/TCP가 기본이 된 배경

2026-10-21 현재 주요 엔터프라이즈 어레이는 NVMe/TCP, FC-NVMe, iSCSI를 함께 제공합니다. RoCE(이더넷 기반 RDMA)도 일부 제품에서 지원하지만, 신규 이더넷 호스트 연결의 기본 선택은 NVMe/TCP로 기울었습니다. FC-NVMe는 기존 FC SAN을 확장하고, iSCSI도 호환성이 필요한 환경에 남아 있습니다.

선택을 가르는 것은 최고 성능보다 운영 범위입니다. RoCE는 낮은 지연을 낼 수 있지만 lossless 이더넷과 멀티벤더 튜닝이 필요합니다. 벤더가 네트워크를 통제하는 어레이 내부에는 RoCE가 쓰이는 반면, 고객의 스위치·NIC·운영 조직이 얽힌 호스트 구간에는 TCP가 널리 제시됩니다. 성능 차이는 읽기와 쓰기, 큐 깊이와 잡 수에 따라 달라지므로 전송 이름만으로 결론을 내릴 수 없습니다.

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인. 각 절 끝의 '근거와 측정 조건'에 수치와 조건을 모았습니다. 프로토콜 구조는 [01 iSCSI와 NVMe-oF]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}})에, 호스트·클라우드·오프로드 쪽은 [05 호스트·클라우드·오프로드]({{< relref "/data/block-storage/05-host-side-and-cloud/index.md" >}})에 있습니다.

## 1. 운영 범위가 TCP와 RoCE를 가른다 {#1-호스트-연결에서-tcp를-미는-이유}

| 전송 | 2026년 위치 | 근거 |
|---|---|---|
| NVMe/TCP | 이더넷 신규 구축의 기본값. 스펙도 계속 개정 중 | `✓` `Ⓥ` |
| NVMe/RDMA (RoCEv2 등) | 호스트 전송으로는 소수, 어레이 내부 패브릭으로는 다수 | `✓` `Ⓥ` |
| FC-NVMe | 기존 FC SAN의 연장. 신규 투자 동력은 약함 | `✓` `≈` |
| iSCSI | 레거시지만 모든 어레이에 있음 | `✓` |

벤더 문서는 RoCE 네트워크의 구성과 튜닝 부담을 TCP 채택의 이유로 듭니다. Broadcom vSphere 9 문서는 NVMe over RDMA에 lossless(무손실) 이더넷을 요구합니다. Dell은 멀티벤더 튜닝과 혼잡 확산을, NetApp은 PFC·ECN 의존에 따른 확장 제약을, Marvell은 DCB·PFC·ECN 구성 때문에 생기는 배포 복잡성을 지적합니다.

| 출처 | 문구 요지 | 근거 |
|---|---|---|
| Broadcom vSphere 9 문서 | NVMe over RDMA는 lossless 이더넷 구성이 필수 | `✓` |
| Dell H18892 | 구성 복잡성, 멀티벤더 튜닝, lossless 이더넷의 congestion spreading 취약성 때문에 범용 연결에서 NVMe/RoCE를 택하지 않음 | `✓` |
| NetApp 블로그 | RoCE는 PFC·ECN에 의존하므로 허용 오차가 빡빡하고 확장이 어렵다. 스위치를 추가할 때 DCB 구성이 까다롭다 | `Ⓥ` |
| Marvell 기술 브리프 | lossless 요건 때문에 DCB·PFC·ECN 같은 고급 기능이 필요해 배포가 복잡하다 | `Ⓥ` |
| WD 백서 2025 | ECN 같은 L3 혼잡 제어 없이는 확장성이 제한된다. 기존 인프라 업그레이드·재구성, RNIC 비용, 기술 인력 투자가 필요해 plug-and-play가 아니다 | `Ⓥ` |
| WD 백서 2025 (TCP의 약점) | NVMe/TCP도 HOL blocking과 incast가 있고, DCTCP+ECN 같은 완화책은 관리 부담이다 | `Ⓥ` |

실제 배치 위치도 이 차이를 보여 줍니다. NetApp AFX는 셸프의 SSD 연결에 RoCE를 사용합니다. StorageReview와 Blocks & Files는 HPE Alletra MP가 컨트롤러 노드와 JBOF 사이에 RoCE를 쓰고, Pure FlashBlade//EXA의 데이터 경로가 RDMA를 사용한다고 보도했습니다. 모두 벤더가 네트워크 전체를 통제하는 구간입니다. 고객의 스위치와 NIC, 운영 조직이 함께 관리하는 호스트 구간에서는 TCP를 기본으로 제시하는 것으로 해석했습니다.

TCP는 RoCE의 lossless 구성 부담을 덜지만 지연과 CPU 사용량이 늘 수 있습니다. 혼잡 관리가 없어지는 것도 아닙니다. WD 백서는 HOL blocking과 incast를 TCP의 문제로 들고 DCTCP+ECN 같은 완화책에도 별도 관리가 필요하다고 설명합니다.

WWT는 IP 스위치의 Gbps당 비용이 FC보다 낮아 TCP가 신규 구축을 주도할 것으로 전망합니다. 그러나 전송별 시장 점유율을 확인할 중립 자료는 찾지 못했습니다. 벤더의 지원 방향만으로 NVMe/TCP가 iSCSI를 추월했다고 판단할 수는 없습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Dell이 범용 연결에서 NVMe/RoCE를 택하지 않은 이유 | "Dell은 일부 스토리지 플랫폼 내부에서 RoCE를 쓰지만, 범용 연결에는 NVMe/RoCE를 택하지 않았다. 구성 복잡성, 특히 멀티벤더 환경에서의 광범위한 튜닝, 그리고 lossless 이더넷으로 인한 congestion spreading 취약성 때문이다." 같은 백서가 CDC를 표준화해 SFSS로 처음 출시했고, 인증·보안 채널(TP8006·TP8011)과 중앙 인증 개체(TP8019) 표준화를 주도했다고 주장 | Dell H18892 백서 | `✓` 본문 `Ⓥ` 주도 주장 |
| AFX 셸프 내부는 RoCE | RoCE 기반 NVMe-oF로 SSD를 연결 | ONTAP AFX 문서 | `✓` |
| HPE 백엔드는 RoCE | 컨트롤러 노드–JBOF 사이 RoCE v2 지원 Aruba 스위치 NVMe-oF 패브릭. 2025-11 스위치 없는 직결 구성이 4노드까지 확대 | StorageReview, Blocks & Files | `Ⓥ` |
| FlashBlade//EXA 데이터 경로 | NFSv3 over RDMA | Blocks & Files | `Ⓥ` |
| Dell의 이더넷 전환 조건 | SAN 관리자가 이더넷으로 옮기려면 FC 수준 UX, 자동 디스커버리, 존·LUN 마스킹급 접근 제어, 인증·암호화, FC급 성능, 넓은 생태계가 필요하다는 서술 | Dell H18892 백서 | `Ⓥ` |
| PFC storm·deadlock 사례 | 엔터프라이즈 실사례 문서 찾지 못함. 벤더 일반론만 있음 | — | `?` |
| 호스트 쪽 RoCE를 꺼린다는 해석 | 벤더가 네트워크를 통제하는 구간에서만 RoCE를 쓴다는 패턴. 이 글의 해석 | 위 문서들 종합 | `≈` |
| 신규 구축은 NVMe/TCP가 주도할 것이라는 판단 | IP 스위치의 Gbps당 비용이 FC보다 낮다는 점이 근거. 원문이 JS 렌더링이라 검색 요약으로만 확인 | WWT 블로그 | `Ⓥ` `≈` 원문 `?` |
| 전송별 점유율 | 중립 자료 없음 | — | `?` |

{{% /details %}}

## 2. 지연 차이는 부하 조건과 I/O 방향에 따라 달라진다 {#2-tcp의-지연-차이는-어느-부하에서-커지는가}

벤더 측정의 RoCE와 TCP 지연 격차는 부하에 따라 몇 %에서 70%까지 달라집니다. WD의 2025년 백서에서 4K 랜덤·큐 깊이(대기 중인 I/O 수) 1의 p99.99 쓰기 지연은 RoCE 41µs, TCP 122µs였습니다. 같은 조건의 읽기는 163µs와 177µs로 8% 차이였습니다. WD는 잡 수와 큐 깊이가 낮을수록 RoCE가 유리하다고 설명하지만 쓰기 차이는 단일 잡 QD1과 잡 32개 혼합 부하에서 모두 컸습니다.

Dell H18892 백서는 RoCE를 제외하고 TCP·FC·iSCSI를 비교합니다. PowerStore에서 NVMe/TCP@25G의 쓰기 IOPS와 지연은 NVMe/FC·FCP@32G와 비슷했고 읽기 성능은 20% 이내로 낮았습니다. 이 결과는 해당 어레이에서 TCP와 FC 중 하나를 선택할 때 참고할 수 있습니다.

Blockbridge는 같은 이더넷에서 iSCSI와 NVMe/TCP를 비교했습니다. 소블록·중간 큐 깊이에서 NVMe/TCP의 IOPS와 지연이 개선됐고, 4K QD4에서는 IOPS가 50% 이상 증가하고 지연이 33% 줄었습니다. 대블록 대역폭은 사실상 같았습니다.

세 결과는 서로 다른 질문에 답합니다. WD 자료는 같은 장비의 RoCE와 TCP를, Dell 자료는 어레이가 제공하는 TCP와 FC를, Blockbridge 자료는 같은 이더넷의 NVMe/TCP와 iSCSI를 비교합니다. 모두 벤더 측정이며, 중립 기관이 같은 하드웨어에서 TCP·RoCE·FC를 함께 비교한 자료는 찾지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| # | 비교 | 조건 | 결과 | 출처 | 근거 |
|---|---|---|---|---|---|
| B1 | RoCEv2 vs NVMe/TCP | WD OpenFlex Data24 3200, RapidFlex C2000 100GbE, Ultrastar DC SN840 3.2TB 24개, fio 4K 랜덤, numjobs=1, QD1, 20분, p99.99. 호스트 NIC·OS·커널 미기재 | 쓰기 RoCE 41.22µs / TCP 122.37µs (66% 낮음). 읽기 162.82µs / 177.15µs (8% 낮음) | WD 백서 | `Ⓑ` 조건 일부 불명 |
| B2 | 같은 장비 | 128K 순차, jobs 1, QD16, p99.99 | 쓰기 3.61ms / 6.39ms, 읽기 4.29ms / 8.35ms | WD 백서 | `Ⓑ` |
| B3 | 같은 장비 | 4K 랜덤, jobs 32, QD32, p99.99 | 쓰기 4.22ms / 5.99ms, 읽기 1.87ms / 3.03ms | WD 백서 | `Ⓑ` |
| B4 | 같은 장비 | 4K 랜덤 70/30, jobs 32, QD32, p99.99 | 쓰기 1.63ms / 5.54ms, 읽기 2.28ms / 5.08ms | WD 백서 | `Ⓑ` |
| B5 | 같은 장비 IOPS | 위 랜덤 조건 | TCP 읽기 IOPS가 RoCE의 약 2/3, 쓰기 IOPS는 0.1% 이내. 순차 10잡 읽기는 TCP가 앞섬 | WD 백서 | `Ⓑ` |
| B6 | NVMe/TCP vs NVMe/FC vs FCP vs iSCSI | ESX 7.0u3 서버 4대(VM 8개, vdbench), PowerStore 9000 OS 3.0, 25GbE(100GbE 어댑터를 25G로 운용, Dell S5248F) vs 32GFC(Broadcom G720), 1:1 비과밀, 기본 파라미터, RR 멀티패스, 4K | NVMe/TCP@25G는 쓰기 IOPS·지연이 NVMe/FC·FCP@32G와 비슷하고 읽기는 20% 이내로 뒤짐. iSCSI가 IOPS 최저·지연 최고. IO당 CPU는 NVMe/FC < NVMe/TCP < FCP < iSCSI | Dell H18892 | `Ⓑ` 벤더 수행 |
| B7 | NVMe/TCP vs iSCSI | Proxmox VE 7.2(커널 5.15), EPYC 7452, ConnectX-5 100GbE, SN2100 스위치 2대, Blockbridge 6.1 백엔드, VM 32개, fio libaio, 512B~128K × QD 다수, 1200초 | QD1 블록 크기 평균 IOPS 약 18% 향상. 4K QD4에서 IOPS 50% 이상 증가, 지연 33% 감소. 대블록 대역폭은 iSCSI가 0.1% 앞섬. CPU 데이터 없음 | Blockbridge 기술 노트 | `Ⓑ` 벤더 수행, 2022 무렵 |
| — | 중립 기관 3전송 동일 조건 비교 | 찾지 못함 | — | — | `?` |

{{% /details %}}

## 3. 제품 지원표에서는 FC와 iSCSI도 사라지지 않았다 {#3-제품별-지원-전송-그리고-fciscsi의-자리}

| 벤더·제품 | NVMe/TCP | NVMe/FC | NVMe/RoCE | iSCSI·FC | 벤더가 미는 방향 | 근거 |
|---|---|---|---|---|---|---|
| Dell PowerStore | GA (OS 2.1~) | GA (OS 2.0~, 32G FC 모듈) | 미제공 (공식 문구 미확인) | 둘 다 | NVMe/TCP + SFSS CDC | `✓` |
| Dell PowerMax | GA (PowerMaxOS 10, 25G 모듈) | GA (32G 모듈) | 미확인 | 둘 다 | NVMe/TCP 자동화 강조 | `✓` `Ⓥ` |
| Dell PowerFlex | GA (4.x~, ESXi 9.x는 5.x만) | 해당 없음(SDS) | 해당 없음 | SDC 전용 프로토콜 | SDC 또는 NVMe/TCP | `✓` |
| NetApp ONTAP (AFF/ASA) | GA (9.10.1~), TLS 9.16.1~ | GA | 미지원 (KB) | 둘 다 | TCP와 FC 병행 | `✓` |
| Pure FlashArray | GA (Purity 6.4.2~) | GA (2021~) | GA (2019~) | 둘 다 | 세 전송 모두 제공 | `✓` `Ⓥ` |
| Pure FlashBlade | 블록 없음 (파일·오브젝트) | — | — | — | //EXA 데이터 경로는 NFSv3 over RDMA | `Ⓥ` |
| HPE Alletra Storage MP B10000 | GA (Release 3~) | GA | 호스트용 미확인 | 둘 다 | TCP 추가가 최근 변화 | `✓` |
| IBM FlashSystem | GA | GA | GA (8.5~, CX-4/CX-6) | 둘 다 | 9.1.1 PBHA가 NVMe/FC·TCP 호스트 지원 | `✓` |
| Hitachi VSP One Block | GA (100G) | GA (32G/64G) | 미확인 | 둘 다 | TCP·FC 병행, Cisco UCS 검증 설계 | `✓` `Ⓥ` |
| Lightbits | GA (TCP 전용 SDS) | — | — | — | NVMe/TCP 단일 | `Ⓥ` |
| simplyblock | GA (Kubernetes 지향 SDS) | — | ? | — | NVMe/TCP, OpenShift 인증 | `Ⓥ` |
| Ceph NVMe-oF gateway | GA (Tentacle, TCP) | — | — | RBD | RBD를 NVMe/TCP로 노출 | `✓` |

주요 어레이와 SDS는 NVMe/TCP를 지원합니다. 전송 사양도 2025년 1.2에서 2026년 1.3으로 개정됐습니다. Ceph NVMe-oF gateway는 RBD 이미지를 NVMe/TCP 타깃으로 제공합니다.

NetApp KB는 ONTAP이 NVMe/FC와 NVMe/TCP만 제공하고 NVMe/RoCE는 지원하지 않는다고 명시합니다. 조사한 주요 어레이 중 호스트용 RoCE의 GA를 확인한 제품은 Pure FlashArray와 IBM FlashSystem입니다. Pure는 RoCE·FC·TCP를 차례로 도입해 세 패브릭을 모두 지원한 첫 벤더라고 주장합니다. Purity 6.10 릴리스 노트에 접근하지 못해 Pure의 2026년 RoCE 유지 여부는 확인하지 못했고 IBM 조건은 8.5 자료를 기준으로 했습니다.

기존 FC SAN도 계속 지원됩니다. FC-NVMe는 거의 모든 엔터프라이즈 어레이에서 GA이며 IBM은 자동 존 생성을, ONTAP은 스위치 없는 FC·FC-NVMe 직결을 추가했습니다. WWT는 16G/32G 포트를 64G로 서둘러 교체하는 고객이 드물다고 보고, WD는 FC-NVMe를 중기 해법으로 평가합니다. Ampcom은 Tier-1 DB·ERP를 FC에 두고 나머지를 NVMe/TCP나 iSCSI로 연결하는 하이브리드 SAN을 주된 패턴으로 분석합니다.

iSCSI도 제거되지 않았습니다. PowerStore의 모든 이더넷 I/O 모듈은 파일·iSCSI·NVMe/TCP를 함께 지원하고 HPE와 Hitachi도 iSCSI를 제공합니다. vSphere 9.0에는 iSCSI 세션당 다중 연결 기능이 추가됐습니다. iSER는 2026년 벤더 자료에서 거의 언급되지 않았고 vSphere 9의 지원 여부도 확인하지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| NVMe Base Specification 현행 | Revision 2.4, 2026-07-31 비준 | NVM Express 사양 페이지 | `✓` |
| NVMe over TCP Transport Spec 현행 | Revision 1.3, 2026-07-31 비준. 1.2는 2025-08 비준. TP4201, ECN132, ECN137 통합 | NVM Express 사양 페이지 | `✓` |
| NVMe over RDMA Transport Spec | Revision 1.3. 비준일은 페이지에 미표기 | NVM Express 사양 페이지 | `✓` 날짜 `?` |
| FC-NVMe | NVM Express가 아니라 INCITS T11 소관. NVMe 사양 페이지 목록에 FC 전송 사양 없음 | NVM Express 사양 페이지 | `≈` |
| ONTAP | 9.19.1, 2026-07-01 | endoflife.date | `≈` |
| Purity//FA | 6.10.5가 확인된 최신 GA. 회사명 2026-02-23 Everpure로 변경 | WWT, Pure 커뮤니티 | `≈` |
| PowerStoreOS | 5.0.0.2 (2026-10-08), LTS 4.3.1.2 (2026-08-27) | Dell KB 매트릭스 | `✓` |
| IBM Storage Virtualize | 9.1.2 (1Q26, Non-LTS) | IBM 커뮤니티, IBM 지원 페이지 | `✓` |
| NetApp은 ONTAP에서 NVMe/RoCE 미지원 | "NVMe/FC와 NVMe/TCP만 지원". KB 날짜 미확인 | NetApp KB | `✓` 날짜 `?` |
| Pure가 세 패브릭을 모두 지원한 첫 벤더 | NVMe/RoCE 2019, NVMe/FC 2021, NVMe/TCP 2022(Purity 6.4.2) | Pure 블로그 | `Ⓥ` |
| Pure의 2026년 RoCE 유지 여부 | Purity 6.10 릴리스 노트 403. Portworx 문서에 FlashArray//X NVMe/RoCE 최대 지원 Purity 6.9.0이 남아 있어 2025년까지는 유지됐다고 봄 | Portworx 문서 | `≈` 6.10 `?` |
| HPE B10000 호스트 전송 | FC, NVMe-oF/FC, NVMe-oF/TCP, iSCSI | HPE QuickSpecs | `✓` |
| IBM 호스트 전송 | 8.7.3 문서가 NVMe over RDMA·TCP·FC 나열. RoCE는 8.5.0부터, 스토리지 쪽 CX-4/CX-6 어댑터 한정(2023 슬라이드). 9.1 계열의 RoCE 유지 여부는 SSIC 확인 필요 | IBM 문서, IBM 슬라이드 | `✓` 슬라이드 `Ⓥ` 9.1 `?` |
| Hitachi 설계 선택 | 64G NVMe-FC, 100G NVMe/TCP. ESXi 8.0U3f 이하에서 기본 설정이 NVMe/TCP 성능 지연을 일으킬 수 있다는 권장 설정 블로그 | Hitachi 커뮤니티 | `Ⓥ` |
| Ceph NVMe-oF gateway 상한 | 한 그룹에 게이트웨이 최대 8개, 그룹 최대 4개, 그룹당 서브시스템 128개, 서브시스템당 호스트 32개, 그룹당 네임스페이스 1024개. HA는 네임스페이스마다 Active/Standby. 클라이언트는 Linux와 VMware(VMFS 데이터스토어) | Ceph 문서 | `✓` |
| IBM 9.1.2의 FC 투자 | 2026년 1분기, FC Target-Driven Zoning 기반 자동 존 생성 | IBM 지원 페이지 | `✓` |
| ONTAP 9.19.1의 FC 직결 | FC·FC-NVMe 호스트를 스위치 없이 직결 | ONTAP 9.19.1 릴리스 노트 | `✓` |
| FC 신규 도입 동력이 약함 | WWT는 16G/32G 포트를 64G로 서둘러 교체하는 고객이 드물다고 봄. WD 백서는 FC-NVMe를 중기 해법일 뿐 NVMe-oF 채택의 주도 세력은 아니라고 봄 | WWT 블로그, WD 백서 | `≈` `Ⓥ` |
| 하이브리드 SAN이 지배적 패턴 | Tier-1 DB·ERP는 FC, 나머지는 NVMe/TCP나 iSCSI | Ampcom 시장 분석 | `≈` |
| vSphere 9.0의 NPIV 제거 | FC 자체가 아니라 FC 부가 기능 하나가 빠짐 | VMware 블로그 | `✓` |
| PowerStore의 iSCSI 유지 | 모든 이더넷 I/O 모듈이 파일·iSCSI·NVMe/TCP 지원. HPE·Hitachi도 iSCSI 유지 | PowerStore 2.1 블로그, HPE·Hitachi 사양 | `✓` |
| vSphere 9.0의 iSCSI | 세션당 다중 연결 추가 | VMware 블로그 | `✓` |
| iSER | 2026년 벤더 자료에서 거의 언급되지 않음. vSphere 9의 iSER 지원 유지 여부는 미확인 | — | `≈` `?` |

{{% /details %}}

## 4. 도입 전에는 멀티패스와 보안 조합을 확인해야 한다 {#4-경로-관리와-보안에는-별도의-지원-조건이-있다}

Linux의 네이티브 NVMe 멀티패스는 ANA 상태에 따라 여러 I/O 경로를 선택합니다. 기본 정책은 `numa`이며 `round-robin`과 `queue-depth`도 사용할 수 있습니다. NetApp 호스트 문서는 RHEL 10에서 이 기능이 기본 활성화된다고 안내합니다.

NVMe/TCP TLS는 Linux 커널 6.7에 들어왔으며 사용자 공간의 `tlshd`가 핸드셰이크를 담당합니다. ONTAP은 9.16.1부터 TLS를, 9.12.1부터 인밴드 인증을 지원합니다. vSphere는 9.0부터 DH-HMAC-CHAP 인증을 제공하지만 NVMe/TCP TLS 지원 여부는 확인하지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 상태 | 출처 | 근거 |
|---|---|---|---|
| Linux 커널 | stable/mainline 7.3, longterm 6.18.58 · 6.12.114 · 6.6.160 | kernel.org finger_banner | `✓` |
| vSphere / VCF | VCF·VVF 9.1 GA, 2026-05. 9.x부터 vSphere 단독 제품 없음 | Broadcom 블로그, vSphere 9.1 FAQ | `✓` |
| ANA 기반 네이티브 멀티패스 | iopolicy가 numa(기본)·round-robin·queue-depth이고 모두 ANA를 따름. queue-depth는 6.11, 경로별 queue-depth sysfs는 6.15에서 들어옴 | 커널 문서 6.19, linux-nvme 메일링 리스트 | `✓` |
| RHEL 10 기본값 | 네이티브 NVMe 멀티패스가 기본 활성화. RHEL 9·10, SLES 15·16은 DM-Multipath가 아닌 네이티브 방식 | NetApp 호스트 문서 | `Ⓥ` |
| Ceph 페일오버 변경 | 20.2.1에서 fast-failover 로직 변경, 20.2.3에서 delayed failback 설정과 nvmeof mgr 모듈 추가 | Ceph 릴리스 블로그 | `✓` |
| Linux NVMe/TCP TLS | 6.7에 in-kernel TLS 반영. 핸드셰이크는 tlshd, 암호화는 kTLS. 초기 구현은 secure concatenation 미지원이었고 이후 업스트림에 추가 | KernelNewbies, 패치 v11, Oracle Linux 블로그 | `✓` |
| ONTAP 호스트 TLS와 인증 | NVMe/TCP TLS는 9.16.1부터 호스트 NQN 단위 PSK. DH-HMAC-CHAP는 NVMe/TCP·NVMe/FC 모두 9.12.1부터 | ONTAP 문서 | `✓` |
| ONTAP TLS | 9.16.1~, SLES 15 SP6 이상 호스트와 조합 | ONTAP 문서, NetApp 호스트 문서 | `✓` |
| ONTAP TLS 하드웨어 오프로드 | 영문 페이지는 미지원, 독어 페이지는 9.19.1부터 지원으로 서로 다름 | ONTAP 문서 | `?` |
| vSphere 인밴드 인증 | VCF 9.0부터 DH-HMAC-CHAP | Broadcom vSphere 9.0 문서 | `✓` |
| vSphere NVMe/TCP TLS | 자료 없음 | — | `?` |
| Ceph 인증·TLS | 인밴드 인증은 2025 Ceph Day 발표의 신기능. TLS/PSK는 ceph-csi 이슈로 진행 중 | Ceph Day 발표, ceph-csi 이슈 | `Ⓥ` `✓` |
| SPDK TLS | 실험적. 한때 TLS 보안 채널과 인밴드 인증을 함께 쓸 수 없다는 문서 문구가 있었음 | SPDK 문서 커밋 | `✓` 시점 문서 |

{{% /details %}}

## 확인하지 못한 것

- 전송별 포트 출하량이나 매출 비중을 공개한 중립 자료를 찾지 못했다. 전송별 점유율을 판단할 근거가 부족하다.
- RoCE의 PFC storm·deadlock을 다룬 엔터프라이즈 실사례 문서를 찾지 못했다. 확인한 내용은 벤더의 일반적 설명이다.
- 중립 기관이 같은 조건에서 수행한 3전송 벤치마크를 찾지 못했다. 이 글의 측정 수치는 모두 벤더가 낸 결과다.
- Purity 6.10, ONTAP 9.19.1, PowerStoreOS 5.0의 NVMe 세부 변경은 릴리스 노트 접근 제한(403·로그인)으로 확인하지 못했다.
- UEC의 스토리지 적용은 확인하지 못했다. 스펙 1.0 보도자료에는 스토리지 언급이 없고, NVMe-oF 바인딩 계획 자료도 찾지 못했다.

## 참고 자료

- [NVMe over TCP Transport Specification](https://nvmexpress.org/specification/tcp-transport-specification) · [Rev 1.3 PDF](https://nvmexpress.org/wp-content/uploads/NVM-Express-NVMe-over-TCP-Transport-Specification-Revision-1.3-Ratified-2026.07.31.pdf) · [kernel.org finger_banner](https://www.kernel.org/finger_banner) — NVM Express 스펙 개정 상태, Linux 커널 버전
- [Announcing VMware vSphere Foundation 9.1](https://blogs.vmware.com/cloud-foundation/2026/05/05/announcing-vmware-vsphere-foundation-9-1/) · [vSphere 9.1 FAQ](https://www.vmware.com/docs/vsphere-9-1-faq) — vSphere 9.1 GA
- [vSphere and VCF 9.0 Core Storage – What's New](https://blogs.vmware.com/cloud-foundation/2025/06/19/vsphere-and-vcf-9-core-storage-whats-new/) — NPIV 제거, iSCSI 다중 연결
- [Broadcom TechDocs vSphere 9.0, About VMware NVMe Storage](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-0/vsphere-storage/about-vmware-nvme-storage.html) — 지원 전송, lossless 요구, DH-HMAC-CHAP
- [endoflife.date NetApp ONTAP](https://endoflife.date/netapp-ontap) · [What's new in ONTAP 9.19.1](https://docs.netapp.com/us-en/ontap/release-notes/whats-new-9191.html) — ONTAP 버전, FC 직결
- [NetApp KB, Is NVMe over RoCE supported with ONTAP](https://kb.netapp.com/on-prem/ontap/da/SAN/SAN-KBs/Is_NVME_over_ROCE_supported_with_Ontap) — ONTAP의 RoCE 미지원
- [ONTAP Set up TLS secure channel for NVMe](https://docs.netapp.com/us-en/ontap/nvme/set-up-tls-secure-channel-nvme-task.html) · [ONTAP Set up secure authentication](https://docs.netapp.com/ja-jp/ontap/nvme/set-up-secure-authentication-nvme-task.html) — TLS 9.16.1, DH-HMAC-CHAP 9.12.1
- [ONTAP AFX software architecture](https://docs.netapp.com/us-en/ontap-afx/get-started/software-architecture.html) — 셸프 내부 RoCE
- [Dell H18892 NVMe Transport Performance Comparison](https://www.delltechnologies.com/asset/en-us/products/storage/industry-market/h18892-nvme-transport-performance-comparison.pdf) — Dell의 RoCE 배제 사유, TCP·FC·iSCSI 비교
- [Dell KB PowerStoreOS Matrix](https://www.dell.com/support/kbdoc/en-us/000175213) · [PowerStore 2.1 NVMe/TCP (WWT)](https://www.wwt.com/blog/powerstore-2-1-nvme-over-tcp-smartfabric-storage-software) · [Dell PowerMax and VMware vSphere Configuration Guide](https://infohub.delltechnologies.com/en-au/l/dell-powermax-and-vmware-vsphere-configuration-guide-1/nvme-over-fabrics) · [Broadcom KB 312201 Dell PowerFlex](https://knowledge.broadcom.com/external/article/312201/dell-powerflex-with-esxi-8x-and-9x.html) — Dell 제품별 전송과 버전
- [Pure Storage rebrands to Everpure (WWT)](https://www.wwt.com/news/pure-storage-rebrands-to-everpure-and-announces-intent-to-acquire-1touch) · [Purity//FA 6.10.5 GA](https://purecommunity.purestorage.com/discussions/flasharray/ga-whats-new-in-purityfa-6-10-5/3758/replies/3820) · [Pure 블로그 NVMe/TCP](https://blog.purestorage.com/?p=110854) · [Portworx supported versions](https://docs.portworx.com/reference/pure-reference/supported-versions) — Pure 버전과 세 전송
- [Blocks & Files, How Pure developed FlashBlade//EXA](https://blocksandfiles.com/2025/04/17/how-pure-storage-developed-its-disaggregated-flashblade-exa-system/) — //EXA 데이터 경로
- [HPE Alletra Storage MP B10000 QuickSpecs](https://www.hpe.com/us/en/collaterals/collateral.a50006985enw.html) · [StorageReview HPE GreenLake for Block Storage Release 3](https://www.storagereview.com/news/hpe-greenlake-for-block-storage-release-3-is-ga) · [HPE Alletra MP hardware deep dive](https://www.storagereview.com/review/hpe-alletra-mp-hardware-deep-dive) · [Blocks & Files, HPE switchless](https://blocksandfiles.com/2025/11/04/hpe-doubles-switchless-alletra-block-storage-node-count/) — HPE 호스트 전송과 백엔드 패브릭
- [IBM FlashSystem 8.7.3 Host attachment](https://www.ibm.com/docs/en/ST3FR7_8.7.3/storageflashsytem873/gettingstarted/gs_host_attachment.html) · [IBM 9.1.2 기술 업데이트](https://www.ibm.com/support/pages/flashsystemfcm-next-generation-and-912-technical-update) · [PBHA 9.1.1](https://community.ibm.com/community/user/blogs/hencilla-dsouza/2025/10/30/support-for-nvme-fc-and-nvme-tcp-hosts-in-ha) · [Accelerate Storage Virtualize 8.6 슬라이드](https://ibm.com/support/pages/system/files/inline-files/Accelerate_IBM_StorageVirtualize_860_and_Sentinel_Update.pdf) — IBM 전송과 RoCE 조건
- [Hitachi VSP One Block specifications](https://www.hitachivantara.com/content/dam/hvac/pdfs/specifications/virtual-storage-platform-one-block-specifications.pdf) · [Modern data center demands and the case for NVMe/TCP](https://community.hitachivantara.com/blogs/arvin-jami/2025/10/27/modern-data-center-demands-and-the-case-for-nvmetc) · [Best practice recommendations for NVMe/TCP configuration](https://community.hitachivantara.com/blogs/payel-sarkar/2025/09/12/best-practice-recommendations-for-nvme-tcp-configu) — Hitachi 전송과 권장 설정
- [Lightbits 2026-01 보도자료](https://www.businesswire.com/news/home/20260113964102/en/Lightbits-Labs-Delivers-Record-Growth-as-Organizations-Standardize-on-NVMe-over-TCP-for-AI-Ready-Infrastructure) · [simplyblock, Red Hat Ecosystem Catalog](https://catalog.redhat.com/en/software/container-stacks/detail/68f8e0f36705922725f168d4) — SDS 벤더 주장
- [Ceph NVMe-oF Gateway Overview](https://docs.ceph.com/en/latest/rbd/nvmeof-overview/) · [Ceph v20.2.1 Tentacle](https://ceph.io/en/news/blog/2026/v20-2-1-tentacle-released/) · [Ceph v20.2.3 Tentacle](https://ceph.io/en/news/blog/2026/v20-2-3-tentacle-released/) · [Ceph Day London 2025, NVMeoF in Ceph](https://www.ceph.io/assets/pdfs/events/2025/ceph-day-london/13.1%20NVMeoF%20in%20Ceph.pdf) · [ceph-csi issue 5717](https://github.com/ceph/ceph-csi/issues/5717) — gateway 상한, 페일오버, 인증
- [WWT, The State of NVMe-oF in 2026](https://www.wwt.com/blog/the-state-of-nvme-of-in-2026) — 시장 판단. 본문 직접 확인 불가, 검색 요약 기반
- [Ampcom, Fibre Channel Networking Market 2026](https://www.ampcom.com/blogs/industry-insights/fibre-channel-networking-market) — 하이브리드 SAN 분석
- [NetApp 블로그, NVMe over Fabric](https://www.netapp.com/zh-hans/blog/nvme-over-fabric/) · [Marvell NVMe over Fabrics technology brief](https://www.marvell.com/content/dam/marvell/en/public-collateral/fibre-channel/marvell-nvme-over-fabrics-technology-brief.pdf) — RoCE 확장·배포 부담
- [Western Digital, NVMe/TCP vs RDMA with RoCEv2](https://documents.westerndigital.com/content/dam/doc-library/en_us/assets/public/western-digital/collateral/white-paper/white-paper-open-flex-data24-roce-vs-tcp.pdf) — 2025-02. B1~B5 지연 측정
- [Blockbridge, Proxmox iSCSI vs NVMe/TCP](https://kb.blockbridge.com/technote/proxmox-iscsi-vs-nvmetcp/) — iSCSI 대비 NVMe/TCP 측정
- [Linux NVMe multipath (커널 문서 6.19)](https://docs.kernel.org/6.19/admin-guide/nvme-multipath.html) · [queue-depth iopolicy 패치](https://lists.infradead.org/pipermail/linux-nvme/2024-June/048627.html) · [6.14 sysfs 언급](https://lists.infradead.org/pipermail/linux-nvme/2025-April/055039.html) — 멀티패스 정책
- [NetApp ONTAP SAN host, RHEL 10.x](https://docs.netapp.com/fr-fr/ontap-sanhost/nvme-rhel-10x.html) · [SLES 지원 기능](https://docs.netapp.com/us-en/ontap-sanhost/nvme-sles-supported-features.html) — 네이티브 멀티패스 기본값, TLS 호스트 조합
- [KernelNewbies Linux 6.7](https://kernelnewbies.org/Linux_6.7) · [In-kernel TLS 패치 v11](https://lists.infradead.org/pipermail/linux-nvme/2023-September/042218.html) · [Oracle Linux, TLS and NVMe/TCP](https://blogs.oracle.com/linux/tls-and-nvmetcp) — NVMe/TCP TLS
- [SPDK TLS 문서 커밋](https://telematik.prakinf.tu-ilmenau.de/gitlab/pub/spdk/-/commit/60be8395cc61e29789928206f21bac1054731a42) — SPDK TLS 상태
