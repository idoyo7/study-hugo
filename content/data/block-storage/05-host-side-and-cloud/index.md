---
title: "Kubernetes NVMe-oF 지원 범위와 노드·클라우드 조건"
linkTitle: "05 호스트·클라우드·오프로드"
description: "Kubernetes NVMe-oF CSI 드라이버의 성숙도와 Linux 노드 조건을 확인하고, vSphere 제약과 클라우드 내부 전송, 하드웨어 오프로드의 공개 범위를 구분한다."
weight: 5
date: 2026-10-21
lastmod: 2026-10-21
url: "/storage/05-host-side-and-cloud/"
---

# 05 · Kubernetes NVMe-oF 지원 범위와 노드·클라우드 조건

Kubernetes에서 NVMe-oF(네트워크를 통한 NVMe 연결)를 사용하려면 CSI(컨테이너 스토리지 인터페이스) 드라이버와 노드 이니시에이터(스토리지에 I/O를 요청하는 쪽)가 모두 준비돼야 합니다. 2026-10-21 현재 이 글에서 GA(정식 출시)를 확인한 드라이버는 NetApp Trident의 NVMe/TCP 지원과 Longhorn V2입니다. ceph-csi와 Rook 경로는 실험 단계입니다. 드라이버 상태만으로 도입을 결정하지 않고 Linux 커널 기능과 vSphere 제약, 클라우드에서 공개한 전송 범위까지 차례로 확인합니다.

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인. 각 절 끝의 '근거와 측정 조건'에 수치와 조건을 모았습니다. 어레이 벤더가 내놓는 전송은 [04 엔터프라이즈 전송 현황]({{< relref "/data/block-storage/04-enterprise-transports/index.md" >}})에, 호스트 I/O 경로와 NVMe-oF 구조는 [01 iSCSI와 NVMe-oF]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}})에 있습니다.

## 1. CSI 드라이버와 Linux 노드가 함께 준비돼야 한다 {#1-csi-드라이버의-지원-단계와-linux-노드-조건}

| 드라이버 | 전송 | 상태 | 근거 |
|---|---|---|---|
| NetApp Trident `ontap-san` (`sanType: nvme`) | NVMe/TCP | GA. 스냅샷·클론·리사이즈·임포트·네이티브 멀티패스. v25.06에 SnapMirror 복제 추가 | `✓` |
| ceph-csi NVMe-oF | NVMe/TCP (Ceph gateway) | v3.16.0 Experimental. v3.17에 DH-CHAP, v3.18에 외부 클라이언트·클론·VolumeGroupSnapshot | `✓` |
| Rook NVMe-oF | 위와 동일 | v1.19 기준 실험적, 프로덕션 비권장 | `≈` |
| Lightbits CSI | NVMe/TCP | LightOS 2.0부터 CSI 제공 | `Ⓥ` |
| simplyblock CSI | NVMe/TCP | Red Hat OpenShift 카탈로그 등재 | `Ⓥ` |
| OpenEBS Mayastor | NVMe-oF/TCP (SPDK) | 2026 GA 공식 확인 없음 | `≈` |
| Longhorn V2 data engine | SPDK NVMe-oF/TCP | 1.12.0(2026-06-02) GA, 최신 1.13.0 | `✓` |
| Dell CSM, Pure Portworx | NVMe/TCP·NVMe/FC | 1차 문서 미확인 | `?` |

NetApp Trident는 NVMe/TCP 연결과 함께 스냅샷, 클론, 리사이즈, 임포트, 네이티브 멀티패스(여러 I/O 경로를 쓰는 기능)를 지원합니다. v25.06에는 SnapMirror 복제가 추가됐습니다.

ceph-csi의 NVMe-oF 드라이버는 실험 기능으로 시작해 인증, 클론, VolumeGroupSnapshot을 추가했습니다. v3.17부터 StorageClass에 publish secret이 필수이므로 업그레이드할 때 설정 변경이 필요합니다. Rook가 실험 단계이며 프로덕션에 권장되지 않는다는 평가는 v1.19를 다룬 3자 자료에 근거합니다.

### Linux 노드의 연결 조건

Linux 노드는 네이티브 멀티패스와 TLS(전송 암호화)를 구성할 수 있어야 합니다. `numa`, `round-robin`, `queue-depth` iopolicy(경로 선택 정책)는 모두 ANA 상태를 따릅니다. TLS 핸드셰이크는 사용자 공간의 `tlshd`가, 암호화는 커널 TLS가 처리합니다. `nvme-cli`의 `gen-tls-key`와 `connect --tls`로 키를 만들고 연결합니다.

TLS는 커널 6.7에, 경로별 queue-depth sysfs는 6.15에 들어왔습니다. 필요한 기능을 업스트림 기준으로 모두 사용하려면 6.18 LTS가 필요하다고 해석했습니다. 배포판의 6.12 커널에 어떤 기능이 백포트됐는지는 확인하지 못했습니다. NetApp 호스트 문서는 RHEL 10에서 네이티브 NVMe 멀티패스가 기본 활성화된다고 설명합니다.

Proxmox VE 포럼 스레드에서는 전용 NVMe/TCP 스토리지 타입을 확인하지 못했습니다. 사용자들은 `nvme-cli`나 `nvme-stas`로 연결한 뒤 공유 LVM을 만들고, 경로 복구를 위해 `ctrl-loss-tmo=-1`을 권합니다. LVM 스냅샷은 같은 스레드에서 기술 프리뷰로 언급됩니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Kubernetes 드라이버 상태 | Trident GA, ceph-csi v3.16.0 Experimental, Rook 실험적 | NetApp 문서, ceph-csi 릴리스 | `✓` `≈` |
| Trident 지원 범위 | ONTAP 9.12 이상 권장, 문서 버전 26.02 | NetApp Trident 문서 | `✓` |
| ceph-csi 진행 | v3.16.0 "NEW and Experimental", v3.18.1(10-01)·v3.18.0(09-22)이 최신 | ceph-csi 릴리스 | `✓` |
| v3.17 breaking change | StorageClass에 publish secret 필수 | ceph-csi v3.17.0 | `✓` |
| Rook 상태 | v1.19 기준 실험적 | 3자 가이드 | `≈` |
| Lightbits·simplyblock | 벤더 자료·카탈로그 등재 | Lightbits 보도, Red Hat Ecosystem Catalog | `Ⓥ` |
| Mayastor | 3자 튜토리얼과 GitHub 표기 | OpenEBS GitHub, 3자 튜토리얼 | `≈` |
| Longhorn V2 | 1.12.0(2026-06-02) GA, 최신 1.13.0 | Longhorn v1.12.0·v1.13.0 릴리스 노트 | `✓` |
| 기준 커널 | stable 7.3, longterm 6.18.58 · 6.12.114 · 6.6.160 | kernel.org finger_banner | `✓` |
| 멀티패스 iopolicy | numa(기본)·round-robin·queue-depth 모두 ANA를 따름. queue-depth는 6.11, 경로별 queue-depth sysfs는 6.15 | 커널 문서 6.19, linux-nvme 패치 | `✓` |
| 네이티브 멀티패스 기본값 | RHEL 10 기본 활성화. RHEL 9·10, SLES 15·16은 DM-Multipath가 아닌 네이티브 방식 | NetApp ONTAP SAN host 문서 | `Ⓥ` |
| Linux NVMe/TCP TLS | 커널 6.7에 in-kernel TLS 반영 | KernelNewbies, 패치 v11 | `✓` |
| TLS 구현 | 6.7 in-kernel TLS. 핸드셰이크 tlshd, 암호화 kTLS. 초기 구현은 secure concatenation 미지원, 이후 업스트림에 추가 | KernelNewbies 6.7, 패치 v11, Oracle Linux 블로그 | `✓` |
| nvme-cli 사용법 | `gen-tls-key`, `connect --tls`. nvme-cli 3.0 출시 여부 미확인 | 패치 v11, Oracle Linux 블로그 | `✓` `?` |
| 기능을 모두 갖추려면 업스트림 6.18 LTS 필요 | 위 도입 버전에서 이 글이 도출. 배포판 6.12 커널의 백포트 범위 미확인 | — | `≈` |
| Proxmox VE | 2026-07 스레드. 전용 스토리지 타입 없음, nvme-cli·nvme-stas 후 공유 LVM, `ctrl-loss-tmo=-1` 권장, LVM 스냅샷 기술 프리뷰 | Proxmox 포럼 | `≈` |

{{% /details %}}

## 2. vSphere에서는 전송 지원과 vVols 수명을 따로 본다 {#2-vsphere의-전송-지원과-vvols-제약}

vSphere 9.0은 RDMA(RoCE v2), FC, TCP로 공유 NVMe-oF를 지원합니다. NVMe/TCP 부팅과 DH-HMAC-CHAP 인밴드 인증도 9.0에 추가됐습니다. TCP를 연결하려면 소프트웨어 NVMe/TCP 어댑터를 만들고 VMkernel을 바인딩해야 합니다. Dell ESXi 9.x 릴리스 노트는 TCP와 FC의 NVMe over Fabrics 부팅 디스크 지원을 명시합니다.

9.1에서 발표한 메모리 티어링은 로컬 NVMe를 메모리 계층으로 사용하는 기능이며 원격 NVMe-oF 전송과는 무관합니다.

vVols는 전송 지원과 별개로 제품 수명을 확인해야 합니다. Dell KB가 인용한 Broadcom 발표에는 9.0에서 vVols를 폐기하고 9.1에서 제거한다는 일정이 있습니다. 9.1 GA에서 실제로 제거됐는지는 Broadcom 원문으로 확인하지 못했습니다. 발표대로라면 PowerStore 등이 제시한 NVMe/TCP vVols 조합은 더 이상 이어지기 어렵다고 해석했습니다.

Broadcom KB에는 최대 연결 수를 넘었을 때의 연결 실패와 큐 공유로 인한 데이터스토어 간 QoS 영향이 나옵니다. 커뮤니티에는 vSphere 8.0U3에서 NVMe/TCP 볼륨으로 storage vMotion을 수행할 때 iSCSI보다 훨씬 느렸다는 보고가 있습니다. Broadcom 직원은 VAAI XCOPY 동작 여부를 확인하라고 답했지만, 원인은 확정되지 않았습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 지원 전송 세 가지 | RDMA(RoCE v2)는 lossless 이더넷 필수, FC는 어댑터 구성 불필요, TCP는 소프트웨어 어댑터와 VMkernel 바인딩 필요 | Broadcom TechDocs vSphere 9.0 | `✓` |
| vSphere 9.0 신규 NVMe 항목 | NVMe/TCP 부팅(TP-8012), 고유 NQN 디스커버리, DH-HMAC-CHAP 인밴드 인증 | Broadcom TechDocs VCF 9.0 릴리스 노트 | `✓` |
| 9.0 NVMe 신규 항목 | TP-8012 기반 NVMe/TCP 부팅, 고유 NQN 디스커버리, DH-HMAC-CHAP | Broadcom TechDocs, Dell ESXi 9.x 릴리스 노트 | `✓` |
| 9.1의 NVMe 헤드라인 | 메모리 티어링. NVMe-oF 전송과 무관 | VMware 블로그 | `✓` |
| vVols 폐기·제거 일정 | 2025-06 발표, 9.0 폐기, 9.1 제거. 9.0 vVols 인증 중단 | Dell KB 000414330 (Broadcom 발표 인용) | `✓` |
| 9.1 GA의 vVols 제거 여부 | Broadcom 원문 미확인 | — | `?` |
| NVMe/TCP vVols의 출구가 막힘 | 위 일정에서 이 글이 도출한 해석 | TechTarget | `≈` |
| 연결 수 상한 | 서브시스템 최대 연결 수 초과 시 추가 NVMe/TCP 컨트롤러 연결 실패 (8.x) | Broadcom KB 448812 | `✓` |
| QoS 영향 | 배열 쪽 큐 공유로 데이터스토어 A의 QoS가 B에 영향 | Broadcom KB 441781 | `✓` |
| storage vMotion 지연 보고 | vSphere 8.0U3, NVMe/TCP 볼륨이 iSCSI보다 훨씬 느림. XCOPY 확인 권유. 수치 없음 | IBM 커뮤니티, Broadcom 커뮤니티 | `≈` |
| XCOPY가 NVMe-oF 미지원이던 시절 | vSphere 7 시절 자료 | VMware NVMeoF resources | `✓` |
| PowerFlex 조합 | ESXi 9.x와 NVMe/TCP는 PowerFlex 5.x 필요. NVMe/TCP 위 Clustered VMDK는 PowerFlex 5.0 + ESXi 8 / VCF 9.0, SDC로는 불가 | Broadcom KB 312201 | `✓` |

{{% /details %}}

## 3. 클라우드의 NVMe 장치는 내부 전송을 드러내지 않는다 {#3-클라우드의-nvme-표기로는-전송을-알-수-없다}

AWS EBS는 io2 Block Express 서버와 Nitro 인스턴스 사이에 SRD를 사용합니다. Azure의 2023년 논문은 컴퓨트–스토리지 구간과 스토리지 내부에 지역 내 RDMA를 배치했다고 설명합니다. 모두 사업자가 NIC와 스위치를 통제하는 환경이며 세부 구현은 대부분 공개되지 않았습니다.

Google Hyperdisk는 Titanium 오프로드에서 동작하지만 디스크 트래픽의 전송 프로토콜을 공개하지 않았습니다. OCI는 볼륨 연결 방식으로 iSCSI와 반가상화를 제공합니다. 이 자료만으로 하이퍼스케일러가 NVMe/TCP를 사용한다고 일반화할 수 없습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 서비스 | 공개된 사실 | 비공개·미확인 | 출처 | 근거 |
|---|---|---|---|---|
| AWS EBS io2 Block Express | Block Express 서버와 Nitro 인스턴스가 SRD로 통신. 인터페이스는 인스턴스 호스트의 EBS 전용 Nitro 카드에 구현. 16KiB I/O 평균 지연 500µs 미만, 볼륨당 최대 256,000 IOPS, 4,000MiB/s. 2025-04-30부터 모든 io2가 Block Express. Multi-Attach는 NVMe reservation 지원 | gp3 등 다른 볼륨 유형의 전송, SRD 와이어 포맷 | AWS EBS 문서 | `✓` |
| AWS SRD 일반 | 2020 IEEE Micro 논문. 패킷 순서를 포기하고 다중 경로로 분산, Nitro 카드에서 혼잡에 빠르게 반응. EFA, ENA Express(단일 흐름 25Gbps)가 사용 | 논문 본문의 EBS 언급 미확인 | Amazon Science, AWS Well-Architected | `✓` |
| Azure Managed Disks | NSDI'23 논문. 프런트엔드·백엔드 양쪽에 지역 내 RDMA, Azure 트래픽의 약 70%가 RDMA. Azure Boost가 스토리지 처리를 전용 하드웨어로 오프로드. v6·Ebsv5 이상 VM은 게스트 디스크 인터페이스를 SCSI에서 NVMe로 바꿔야 함 | 2026년 현재 프런트엔드 RDMA 비중, 게스트 NVMe와 원격 저장소 사이 프로토콜 | NSDI'23, Azure NVMe 문서 | `✓` |
| Google Hyperdisk | Titanium 오프로드(호스트 카드 + 데이터센터 내 TOP 계층) 위에서 동작, 전송 암호화에 PSP. Hyperdisk Extreme은 인스턴스당 최대 500K IOPS | 디스크 트래픽 전송 프로토콜 | Google Cloud 문서·블로그 | `✓` `Ⓥ` |
| OCI Block Volume | 연결 방식은 iSCSI와 반가상화 두 가지. Ultra High Performance 등급은 멀티패스 연결이 있어야 성능이 나옴. Windows UHP는 반가상화가 유일한 경로 | 반가상화 경로의 백엔드 전송 | OCI 문서·블로그 | `✓` |
| "하이퍼스케일러가 NVMe/TCP를 쓴다"는 문장 | 위 공개 사실에서 이 글이 도출한 결론 | — | — | `≈` |

{{% /details %}}

## 4. 오프로드는 DPU와 사업자 내부 경로에 집중된다 {#4-하드웨어-오프로드의-적용-범위}

조사한 공개 자료를 보면 엔터프라이즈 NVMe/TCP는 여전히 소프트웨어 구현이 기본인 것으로 보입니다. 오프로드(처리를 별도 하드웨어로 넘기는 방식)는 NVIDIA BlueField-3 SNAP처럼 원격 스토리지를 로컬 NVMe 장치로 에뮬레이션하는 DPU에 쓰입니다. AWS Nitro도 게스트에 NVMe 장치를 제공하면서 EBS 전송을 처리합니다. Dell은 2023년 백서에서 소프트웨어 NVMe/TCP만 지원하고 하드웨어 오프로드는 검토 중이라고 밝혔습니다.

Linux의 범용 NVMe/TCP 수신 오프로드 패치는 2025년 4월 v28 검토 단계였으며 메인라인 병합 여부는 확인하지 못했습니다.

Ultra Ethernet을 스토리지에 적용한 자료는 찾지 못했습니다. UEC Spec 1.0 보도자료에는 RoCE와 스토리지가 언급되지 않으며 스토리지 프로파일과 NVMe-oF 바인딩 계획도 확인되지 않았습니다.

학술·벤더 자료는 RoCEv2의 경로 고정과 PFC 의존을 UEC의 설계 배경으로 설명하며, NVIDIA는 ConnectX-6 Lx/Dx의 Zero Touch RoCE가 PFC·ECN 설정 없이 동작한다고 주장합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 제품 | NVMe-oF 관련 기능 | 엔터프라이즈 연결·상태 | 출처 | 근거 |
|---|---|---|---|---|
| AWS Nitro | EBS 전용 Nitro 카드가 SRD를 구현하고 게스트에는 NVMe 장치로 보임 | AWS 자체 서비스 | AWS EBS 문서 | `✓` |
| NVIDIA BlueField-3 SNAP | 원격 스토리지를 PCIe 위 로컬 NVMe·virtio-blk로 에뮬레이션. 백엔드는 보통 SPDK bdev, 패브릭 NVMe-oF·iSCSI, 전송 RDMA·TCP. 제로카피는 SPDK NVMe-oF RDMA bdev 상대일 때만 완전. NVMe/TCP는 XLIO 기반 NVDA_TCP로 수신 경로 부분 제로카피. 64K 페이지 커널에서 NVMe/TCP XLIO 미지원 | 클라우드·네오클라우드 베어메탈 스토리지 에뮬레이션 | NVIDIA DOCA SNAP-3 문서, SNAP v4.5.0 | `✓` `≈` |
| NVIDIA ConnectX-7 수신 DDP 오프로드 | 리눅스 패치 v28(2025-04). 수신만, TLS와 동시 사용 불가, 연결 4k개까지. 64K 읽기 대역폭·IOPS 최대 32% 향상(데이터 다이제스트 사용 시 107%) 보고 | 메인라인 병합 여부 미확인 | linux-nvme 패치 v28 | `✓` `?` |
| Intel IPU E2000 | Google과 공동 설계. SPDK 기반 NVMe/TCP 이니시에이터를 IPU에서 실행. 2021 시연은 Lightbits 타깃 상대 | 현재 배치 범위 미확인 | SNIA SDC21, DCD | `Ⓥ` `?` |
| Chelsio T7 | TCP/IP·iSCSI·RoCEv2·iWARP·TLS/IPsec·NVMe/TCP 하드웨어 오프로드. FreeBSD에 nvmf_che 드라이버 | 틈새 | Chelsio 제품 요약, FreeBSD 커밋 | `✓` |
| Marvell FastLinQ qedn | 2021 RFC. 50Gbps 라인레이트에서 CPU 사용률 15.1%에서 4.7% | 업스트림 병합 여부 미확인 | lore.kernel.org RFC | `✓` `?` |
| 어레이의 오프로드 | 2023년 시점 소프트웨어 NVMe/TCP만 지원, 하드웨어 오프로드는 검토 중 | — | Dell H18892 | `✓` |
| 엔터프라이즈 NVMe/TCP는 소프트웨어 구현이 기본 | 위 항목에서 이 글이 도출 | — | — | `≈` |
| UEC Spec 1.0 | 2025-06-11 공개. NIC·스위치·광학·케이블을 아우르는 이더넷 기반 스택. 보도자료에 RoCE·스토리지 언급 없음 | 스토리지 프로파일·NVMe-oF 바인딩 미확인 | Linux Foundation 보도자료 | `✓` `?` |
| RoCEv2 대 UET 구조 | RoCEv2는 흐름 하나를 ECMP 경로 하나에 고정하고 PFC로 lossless 유지. UET는 패킷을 모든 경로에 분산하고 수신 NIC가 순서 복원, 선택 재전송 | UEC 설계 배경 | arXiv 2508.08906, IP Infusion | `≈` `Ⓥ` |
| Zero Touch RoCE | ConnectX-6 Lx/Dx가 PFC·ECN 설정 없이 RoCE 동작. 비NVIDIA 스위치에서는 수동 링크 구성 필요 가능 | NVIDIA 주장 | NVIDIA, Cisco 데이터시트 | `Ⓥ` |

{{% /details %}}

## 확인하지 못한 것

- 하이퍼스케일러 내부 전송의 세부. gp3의 전송, Azure 프런트엔드 RDMA의 2026년 현황, Hyperdisk 와이어 프로토콜은 비공개다.
- vSphere 9.1의 실제 vVols 제거 여부와 NVMe/TCP TLS 지원 여부. Broadcom 원문을 확인하지 못했다.
- 리눅스 NVMe/TCP 하드웨어 오프로드(mlx5 ULP DDP, qedn)의 병합 여부.
- UEC의 스토리지 적용. 스펙 1.0 보도자료에는 스토리지 언급이 없고, NVMe-oF 바인딩 계획 자료도 없다.

## 참고 자료

- [kernel.org finger_banner](https://www.kernel.org/finger_banner) — 기준 커널 버전
- [vSphere 9.0, About VMware NVMe Storage](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-0/vsphere-storage/about-vmware-nvme-storage.html) — Broadcom TechDocs. 지원 전송 세 가지
- [VCF 9.0 release notes, What's new vSphere](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/release-notes/vmware-cloud-foundation-90-release-notes/platform-whats-new/whats-new-vsphere.html) — 9.0 NVMe 신규 항목
- [Dell, VMware vSphere ESXi 9.x Release Notes](https://www.dell.com/support/manuals/en-gb/vmware-esxi-9-x/vmware_esxi_pub_release_notes_major_release_9.x/new-features?guid=guid-5d4127b5-b435-4780-ba6a-ec9fe904d3a6&lang=en-us) — NVMe-oF 부팅 디스크 표기
- [Announcing VMware vSphere Foundation 9.1](https://blogs.vmware.com/cloud-foundation/2026/05/05/announcing-vmware-vsphere-foundation-9-1/) — 9.1 메모리 티어링
- [Dell KB 000414330, Dell Unity vVols Support Ending](https://www.dell.com/support/kbdoc/en-us/000414330/dell-unity-vvols-support-ending-upgrade-and-migration-considerations) · [TechTarget, replacement for VMware vVols](https://www.techtarget.com/it-infrastructure/answer/What-is-a-good-replacement-for-VMware-vVols) — vVols 폐기 일정
- [Broadcom KB 448812](https://knowledge.broadcom.com/external/article/448812/esxi-hosts-fail-to-connect-to-additiona.html) · [Broadcom KB 441781](https://knowledge.broadcom.com/external/article/441781/applying-qos-on-a-specific-nvme-over-tcp.html) — 연결 수 상한, QoS 영향
- [Broadcom KB 312201, Dell PowerFlex with ESXi 8.x and 9.x](https://knowledge.broadcom.com/external/article/312201/dell-powerflex-with-esxi-8x-and-9x.html) — PowerFlex 5.x 조건
- [IBM 커뮤니티, slow storage vMotion to NVMe/TCP](https://community.ibm.com/community/user/question/slow-storage-vmotion-from-vsaniscsinvmeotcp-to-nvmeotcp-volumes) · [Broadcom 커뮤니티](https://community.broadcom.com/vmware-cloud-foundation/discussion/esxi-storage-nvme-tcpip-vs-iscsi) — storage vMotion 지연 보고
- [VMware NVMeoF resources](https://www.vmware.com/docs/nvmeof-resources) — vSphere 7 시절 XCOPY 미지원
- [Linux NVMe multipath (커널 문서 6.19)](https://docs.kernel.org/6.19/admin-guide/nvme-multipath.html) · [queue-depth iopolicy 패치 v8](https://lists.infradead.org/pipermail/linux-nvme/2024-June/048627.html) — iopolicy 세 가지
- [KernelNewbies Linux 6.7](https://kernelnewbies.org/Linux_6.7) · [nvme In-kernel TLS support 패치 v11](https://lists.infradead.org/pipermail/linux-nvme/2023-September/042218.html) · [Oracle Linux 블로그, TLS and NVMe/TCP](https://blogs.oracle.com/linux/tls-and-nvmetcp) — TLS 구현과 nvme-cli 사용법
- [NetApp ONTAP SAN host, NVMe-oF RHEL 10.x](https://docs.netapp.com/fr-fr/ontap-sanhost/nvme-rhel-10x.html) — 네이티브 멀티패스 기본값
- [Proxmox 포럼, NVMe Over TCP – Proxmox VE](https://forum.proxmox.com/threads/nvme-over-tcp-proxmox-ve.185212/) — 2026-07 스레드
- [Trident ONTAP SAN drivers (26.02)](https://docs.netapp.com/us-en/trident-2602/pdfs/sidebar/ONTAP_SAN_drivers.pdf) · [ceph-csi releases](https://github.com/ceph/ceph-csi/releases) · [ceph-csi v3.17.0](https://newreleases.io/project/github/ceph/ceph-csi/release/v3.17.0) — CSI 드라이버 상태
- [AWS EBS Provisioned IOPS SSD volumes](https://docs.aws.amazon.com/ebs/latest/userguide/provisioned-iops.html) · [Amazon Science, A cloud-optimized transport protocol for elastic and scalable HPC](https://www.amazon.science/publications/a-cloud-optimized-transport-protocol-for-elastic-and-scalable-hpc) — io2 Block Express와 SRD
- [Empowering Azure Storage with RDMA, NSDI'23](https://usenix.org/conference/nsdi23/presentation/bai) · [Azure NVMe overview](https://learn.microsoft.com/azure/virtual-machines/nvme-overview) — Azure RDMA, 게스트 NVMe
- [Google Cloud Hyperdisk overview](https://docs.cloud.google.com/compute/docs/disks/hyperdisks) · [Titanium underpins Google's workload-optimized infrastructure](https://cloud.google.com/blog/products/compute/titanium-underpins-googles-workload-optimized-infrastructure/) — Titanium 오프로드
- [OCI, Attaching a Block Volume to an Instance](https://docs.oracle.com/en-us/iaas/Content/Block/Tasks/attachingavolume.htm) · [OCI 블로그, max disk IO throughput Windows](https://blogs.oracle.com/cloud-infrastructure/post/max-disk-io-throughput-windows-os-oci) — 연결 방식 두 가지
- [NVIDIA DOCA SNAP-3 User Guide](https://networking-docs.nvidia.com/doca/sdk/doca-snap-3-user-guide) · [BlueField-3 SNAP v4.5.0 Advanced features](https://docs.nvidia.com/networking/display/bluefield3snap450/advanced+features) — SNAP 에뮬레이션과 제로카피 조건
- [nvme-tcp receive offloads 패치 v28](https://lists.infradead.org/pipermail/linux-nvme/2025-April/055926.html) · [RFC PATCH v3 NVMeTCP Offload ULP and QEDN](https://lore.kernel.org/all/20210219091237.GA4036@lst.de/T/) — 리눅스 오프로드 패치
- [SNIA SDC21, Intel IPU Based NVMe/TCP Initiator Offload](https://snia.org/sites/default/files/2025-05/SNIA-SDC21-Yang-Li-Intel-IPU-Based-NVMe-TCP-Initiator-Offload_0.pdf) · [Chelsio T7450 product brief](https://www.chelsio.com/wp-content/uploads/2025/01/T7/Product-Brief/T7450-pb.pdf) — IPU·TOE 오프로드
- [Dell H18892 NVMe Transport Performance Comparison](https://www.delltechnologies.com/asset/en-us/products/storage/industry-market/h18892-nvme-transport-performance-comparison.pdf) — 소프트웨어 NVMe/TCP만 지원한다는 서술
- [UEC Launches Spec 1.0](https://www.linuxfoundation.org/press/uec-launches-spec-1.0) · [Ultra Ethernet's Design Principles and Architectural Innovations](https://arxiv.org/html/2508.08906v1) — UEC 범위와 RoCEv2 대비
- [NVIDIA ConnectX-6 Dx HPE datasheet](https://nvidia.com/content/dam/en-zz/Solutions/Data-Center/documents/nvidia-connectx-6-dx-en-hpe-datasheet.pdf) — Zero Touch RoCE
- [Longhorn v1.12.0 릴리스 노트](https://github.com/longhorn/longhorn/releases/tag/v1.12.0) · [v1.13.0](https://github.com/longhorn/longhorn/releases/tag/v1.13.0) — V2 data engine GA
