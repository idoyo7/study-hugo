---
title: "호스트와 클라우드의 NVMe — 어디까지 지원하고 공개했나"
linkTitle: "05 호스트·클라우드·오프로드"
description: "호스트별 NVMe-oF 지원 단계와 클라우드의 공개 전송을 살펴보고, NVMe 장치 표기만으로 백엔드 전송을 판단할 수 없는 이유와 하드웨어 오프로드의 적용 범위를 정리한다."
weight: 5
date: 2026-10-21
lastmod: 2026-10-21
url: "/storage/05-host-side-and-cloud/"
---

# 05 · 호스트와 클라우드의 NVMe — 어디까지 지원하고 공개했나

어레이가 NVMe/TCP를 지원해도 호스트의 이니시에이터(스토리지에 I/O를 요청하는 쪽)가 연결할 수 있어야 합니다. 2026-10-21 기준으로 vSphere 9.0은 NVMe/TCP 부팅과 인증을, Linux는 멀티패스와 TLS 암호화를 갖췄습니다. Windows의 원격 NVMe-oF 이니시에이터는 아직 프리뷰이고, 이 글에서 살펴본 Kubernetes 드라이버 중 GA를 확인한 것은 NetApp Trident입니다.

NVMe 장치로 보인다는 이유만으로 백엔드가 NVMe/TCP라고 볼 수는 없습니다. AWS는 SRD를, Azure는 RDMA 배치를 공개했으며 나머지 세부는 상당 부분 비공개입니다. 하드웨어 오프로드도 제품과 패치는 있지만, 공개 자료상 엔터프라이즈 NVMe/TCP의 기본은 여전히 소프트웨어 구현으로 보입니다.

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인. 각 절 끝의 '근거와 측정 조건'에 수치와 조건을 모았습니다. 어레이 벤더가 내놓는 전송은 [04 엔터프라이즈 전송 현황]({{< relref "/data/block-storage/04-enterprise-transports/index.md" >}})에, 호스트 I/O 경로와 NVMe-oF 구조는 [01 iSCSI와 NVMe-oF]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}})에 있습니다.

## 1. 호스트 쪽은 TCP부터 채워졌다

Broadcom 릴리스 노트에 따르면 vSphere 9.0은 NVMe/TCP 부팅과 DH-HMAC-CHAP 인밴드 인증을 추가했습니다. Linux는 커널 6.7부터 NVMe/TCP에 TLS를 제공합니다. TCP 쪽 기능이 먼저 채워졌습니다.

플랫폼마다 성숙도는 다릅니다. Windows Server 이니시에이터는 2026년 Insider 빌드에서 프리뷰로 등장했으며, Lightbits는 프로덕션 용도가 아니라고 설명합니다. Kubernetes에서도 Trident는 GA이지만 ceph-csi와 Rook는 실험적이고, Longhorn V2의 이후 GA 여부는 미확인입니다. 클라우드 블록 볼륨의 전송은 5절에서 따로 살펴봅니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| vSphere 9.0 신규 NVMe 항목 | NVMe/TCP 부팅(TP-8012), 고유 NQN 디스커버리, DH-HMAC-CHAP 인밴드 인증 | Broadcom TechDocs VCF 9.0 릴리스 노트 | `✓` |
| Linux NVMe/TCP TLS | 커널 6.7에 in-kernel TLS 반영 | KernelNewbies, 패치 v11 | `✓` |
| Windows Server 이니시에이터 | 2026년 Insider 빌드 프리뷰, 프로덕션 용도 아님 | Lightbits, ElevenForum | `Ⓥ` `≈` |
| Kubernetes 드라이버 상태 | Trident GA, ceph-csi v3.16.0 Experimental, Rook 실험적 | NetApp 문서, ceph-csi 릴리스 | `✓` `≈` |

{{% /details %}}

## 2. vSphere 9의 전송 지원과 vVols 변수

vSphere 9.0은 공유 NVMe-oF 전송으로 RDMA(RoCE v2), FC, TCP를 지원합니다. Broadcom 문서가 요구하는 구성은 전송마다 다릅니다. RDMA에는 lossless 이더넷이 필요하고, FC에는 어댑터 구성이 필요 없습니다. TCP는 소프트웨어 NVMe/TCP 어댑터를 만들고 VMkernel을 바인딩해야 쓸 수 있습니다.

9.0에서는 NVMe/TCP 부팅, 고유 NQN 디스커버리, DH-HMAC-CHAP 인증이 추가됐습니다. Dell의 ESXi 9.x 릴리스 노트는 부팅 지원을 "NVMe over Fabrics TCP 및 FC 부팅 디스크"로 표기합니다. 9.1의 NVMe 관련 주요 기능은 로컬 NVMe를 메모리 계층으로 쓰는 메모리 티어링으로, 원격 NVMe-oF 전송과는 관계가 없습니다.

vVols는 전송 지원과 별개로 폐기 일정이 걸림돌입니다. Dell KB가 인용한 Broadcom의 2025년 6월 발표는 9.0에서 vVols를 폐기하고 9.1에서 제거한다는 내용입니다. 9.1 GA에서 실제로 제거됐는지는 Broadcom 원문으로 확인하지 못했습니다. 발표대로 제거됐다면 PowerStore 등이 내세운 NVMe/TCP vVols 조합은 출구가 막힌다고 이 글은 해석합니다.

연결한 뒤에 부딪힐 만한 항목도 있습니다. Broadcom KB에는 서브시스템의 최대 연결 수를 넘으면 추가 NVMe/TCP 컨트롤러 연결이 실패하는 문제와, 어레이의 큐 공유 때문에 한 데이터스토어의 QoS가 다른 데이터스토어에 영향을 주는 문제가 나옵니다. vSphere 8.0U3에서 NVMe/TCP 볼륨으로 storage vMotion을 수행할 때 iSCSI보다 훨씬 느렸다는 사용자 보고도 있습니다. Broadcom 직원은 VAAI XCOPY 동작 여부를 확인하라고 답했지만, 원인은 확정되지 않았습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 지원 전송 세 가지 | RDMA(RoCE v2)는 lossless 이더넷 필수, FC는 어댑터 구성 불필요, TCP는 소프트웨어 어댑터와 VMkernel 바인딩 필요 | Broadcom TechDocs vSphere 9.0 | `✓` |
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

## 3. Linux의 기능과 Windows 프리뷰의 차이

Linux에서는 네이티브 멀티패스와 TLS를 구성할 수 있습니다. 멀티패스의 iopolicy(경로 선택 정책)는 numa, round-robin, queue-depth이며 모두 ANA를 따릅니다. TLS는 사용자 공간의 tlshd가 핸드셰이크를 처리하고 커널 TLS가 암호화하는 방식입니다. nvme-cli에서 키를 만들고 TLS 연결을 맺습니다. 이 글은 6.12 이상 LTS면 이 시리즈에서 다룬 멀티패스와 TLS 기능이 모두 들어 있다고 해석합니다. NetApp 호스트 문서는 RHEL 10에서 네이티브 NVMe 멀티패스가 기본으로 활성화된다고 설명합니다.

Proxmox VE의 2026년 7월 포럼 스레드에는 NVMe/TCP 전용 스토리지 타입이 없는 것으로 나옵니다. 사용자들은 nvme-cli나 nvme-stas로 연결한 뒤 공유 LVM을 구성하며, 경로 복구 문제를 피하려고 `ctrl-loss-tmo=-1`을 권합니다. 같은 스레드에서 LVM 스냅샷은 기술 프리뷰로 언급됩니다.

Windows에서는 로컬 드라이버와 원격 이니시에이터는 별개입니다. Guru3D가 전한 Windows Server 2025 네이티브 NVMe 드라이버는 2025년 12월에 나왔지만 로컬 드라이브 전용입니다. 원격 NVMe-oF 이니시에이터는 2026년 Insider 프리뷰 단계이며, 디스커버리와 I/O 연결을 수동으로 구성합니다. 관련 비교표에는 멀티패스가 아직 없다고 나옵니다. Windows 비중이 큰 환경은 그동안 서드파티 이니시에이터나 iSCSI·FC에 머물렀을 테고, 이 글은 그 점이 이더넷 NVMe 전환을 늦췄다고 봅니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 기준 커널 | stable 7.3, longterm 6.18.58 · 6.12.114 · 6.6.160 | kernel.org finger_banner | `✓` |
| 멀티패스 iopolicy | numa(기본)·round-robin·queue-depth 모두 ANA를 따름. queue-depth는 6.11, 경로별 queue-depth sysfs는 6.14 | 커널 문서 6.19, linux-nvme 패치 | `✓` |
| 네이티브 멀티패스 기본값 | RHEL 10 기본 활성화. RHEL 9·10, SLES 15·16은 DM-Multipath가 아닌 네이티브 방식 | NetApp ONTAP SAN host 문서 | `Ⓥ` |
| TLS 구현 | 6.7 in-kernel TLS. 핸드셰이크 tlshd, 암호화 kTLS. 초기 구현은 secure concatenation 미지원, 이후 업스트림에 추가 | KernelNewbies 6.7, 패치 v11, Oracle Linux 블로그 | `✓` |
| nvme-cli 사용법 | `gen-tls-key`, `connect --tls`. nvme-cli 3.0 출시 여부 미확인 | 패치 v11, Oracle Linux 블로그 | `✓` `?` |
| 6.12 이상 LTS가 기능을 모두 갖춤 | 위 도입 버전에서 이 글이 도출 | — | `≈` |
| Proxmox VE | 2026-07 스레드. 전용 스토리지 타입 없음, nvme-cli·nvme-stas 후 공유 LVM, `ctrl-loss-tmo=-1` 권장, LVM 스냅샷 기술 프리뷰 | Proxmox 포럼 | `≈` |
| Windows Server 2025 네이티브 NVMe | 2025-12 출시, 레지스트리 옵트인, 로컬 드라이브 전용 | Guru3D | `≈` |
| Windows NVMe-oF 이니시에이터 | Insider 프리뷰. NVMe/TCP·NVMe/RDMA, 수동 구성, `nvmeofutil.exe`, 프로덕션 용도 아님. 멀티패스 없다는 비교표 | Lightbits, ElevenForum | `Ⓥ` `≈` |
| 서드파티 이니시에이터에 머문 영향 | 이 글의 해석 | — | `≈` |

{{% /details %}}

## 4. Kubernetes 드라이버의 지원 단계

| 드라이버 | 전송 | 상태 | 근거 |
|---|---|---|---|
| NetApp Trident `ontap-san` (`sanType: nvme`) | NVMe/TCP | GA. 스냅샷·클론·리사이즈·임포트·네이티브 멀티패스. v25.06에 SnapMirror 복제 추가 | `✓` |
| ceph-csi NVMe-oF | NVMe/TCP (Ceph gateway) | v3.16.0 Experimental. v3.17에 DH-CHAP, v3.18에 외부 클라이언트·클론·VolumeGroupSnapshot | `✓` |
| Rook NVMe-oF | 위와 동일 | v1.19 기준 실험적, 프로덕션 비권장 | `≈` |
| Lightbits CSI | NVMe/TCP | LightOS 2.0부터 CSI 제공 | `Ⓥ` |
| simplyblock CSI | NVMe/TCP | Red Hat OpenShift 카탈로그 등재 | `Ⓥ` |
| OpenEBS Mayastor | NVMe-oF/TCP (SPDK) | 2026 GA 공식 확인 없음 | `≈` |
| Longhorn V2 data engine | SPDK NVMe-oF/TCP | v1.7 시점 Preview, 이후 GA 여부 미확인 | `≈` `?` |
| Dell CSM, Pure Portworx | NVMe/TCP·NVMe/FC | 1차 문서 미확인 | `?` |

NetApp 문서에는 NVMe/TCP 연결뿐 아니라 스냅샷·클론·리사이즈·임포트·네이티브 멀티패스 지원도 명시돼 있습니다.

ceph-csi는 실험 기능으로 출발해 지원 범위를 넓히는 중입니다. 릴리스 기록을 보면 v3.16.0에 NVMe-oF 드라이버가 들어왔고, 이후 인증과 클론, VolumeGroupSnapshot이 추가됐습니다. 업그레이드할 때는 v3.17부터 StorageClass의 publish secret이 필수라는 변경을 확인해야 합니다. Rook는 3자 자료에서 v1.19 기준 실험적이며 프로덕션에 권하지 않는다고 설명합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Trident 지원 범위 | ONTAP 9.12 이상 권장, 문서 버전 26.02 | NetApp Trident 문서 | `✓` |
| ceph-csi 진행 | v3.16.0 "NEW and Experimental", v3.18.1(10-01)·v3.18.0(09-22)이 최신 | ceph-csi 릴리스 | `✓` |
| v3.17 breaking change | StorageClass에 publish secret 필수 | ceph-csi v3.17.0 | `✓` |
| Rook 상태 | v1.19 기준 실험적 | 3자 가이드 | `≈` |
| Lightbits·simplyblock | 벤더 자료·카탈로그 등재 | Lightbits 보도, Red Hat Ecosystem Catalog | `Ⓥ` |
| Mayastor·Longhorn V2 | 3자 튜토리얼과 GitHub 표기 | OpenEBS GitHub, 3자 튜토리얼 | `≈` |

{{% /details %}}

## 5. 클라우드의 NVMe 장치와 실제 전송

클라우드에서 디스크가 NVMe 장치로 보인다는 사실은 백엔드 전송이 NVMe/TCP라는 근거가 되지 않습니다. AWS·Azure·GCP가 고객에게 제공하는 NVMe 인터페이스와 그 뒤의 전송은 별개입니다. OCI는 iSCSI 또는 반가상화 방식으로 볼륨을 연결합니다.

공개 문서가 밝힌 전송도 서로 다릅니다. AWS EBS 문서는 io2 Block Express 서버와 Nitro 인스턴스가 SRD로 통신한다고 명시합니다. Azure의 2023년 논문은 컴퓨트–스토리지 구간과 스토리지 내부에 지역 내 RDMA를 배치했다고 설명합니다. 두 전송은 사업자가 NIC와 스위치를 모두 통제하는 환경에서 쓰이며, 세부는 대부분 비공개입니다.

Google Hyperdisk는 Titanium 오프로드 위에서 동작하지만 디스크 트래픽의 전송 프로토콜은 공개되지 않았습니다. 공개된 자료만으로는 "하이퍼스케일러가 NVMe/TCP를 쓴다"는 문장을 뒷받침하기 어렵습니다.

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

## 6. 오프로드 하드웨어가 쓰이는 자리

오프로드(처리를 별도 하드웨어로 넘기는 방식)는 원격 스토리지를 호스트에 로컬 NVMe 장치처럼 보여 주는 DPU에서 쓰입니다. NVIDIA BlueField-3 SNAP이 그 예입니다. AWS Nitro 카드도 게스트에 NVMe 장치를 제공하면서 EBS 전송을 처리합니다.

엔터프라이즈 NVMe/TCP 전반에 하드웨어 오프로드가 기본으로 자리 잡았다고 보기는 어렵습니다. Dell 백서는 2023년 시점에 소프트웨어 NVMe/TCP만 지원하며 하드웨어 오프로드는 검토 중이라고 적었습니다. Linux의 범용 NVMe/TCP 수신 오프로드 패치도 2025년 4월에 v28로 검토 중이었고, 메인라인 병합 여부는 확인하지 못했습니다. 공개 자료를 종합하면 엔터프라이즈에서는 소프트웨어 구현이 기본이고, 오프로드는 DPU 에뮬레이션이나 하이퍼스케일러 내부에서 쓰이는 것으로 보입니다.

Ultra Ethernet과 스토리지를 잇는 자료는 확인하지 못했습니다. UEC Spec 1.0 보도자료에는 RoCE와 스토리지 언급이 없으며, 스토리지 프로파일이나 NVMe-oF 바인딩 계획도 확인하지 못했습니다. 학술·벤더 자료는 RoCEv2가 흐름 하나를 경로 하나에 고정하고 PFC에 의존하는 점을 UEC의 설계 배경으로 설명합니다. NVIDIA는 ConnectX-6 Lx/Dx에서 Zero Touch RoCE를 사용하면 PFC·ECN 설정 없이 동작한다고 주장합니다.

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
- Windows NVMe-oF 이니시에이터의 GA 일정. Microsoft 원문을 확인하지 못했다.
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
- [Guru3D, Windows Server 2025 native NVMe storage support](https://www.guru3d.com/story/windows-server-2025-finally-gains-native-nvme-storage-support/) — 로컬 드라이브용 드라이버
- [Lightbits, Windows Server NVMe-oF Initiator Preview 상호운용](https://www.lightbitslabs.com/press-releases/lightbits-labs-announces-early-initial-interoperability-with-microsoft-windows-server-nvme-of-initiator-preview/) · [ElevenForum, Introducing Windows NVMe-oF Initiator Preview](https://www.elevenforum.com/t/introducing-windows-nvme-of-initiator-preview-in-windows-server-insiders-builds.45285/latest) — 프리뷰 내용
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
