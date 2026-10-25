---
title: "Kubernetes NVMe-oF — Mayastor는 언제 도입할까"
linkTitle: "08 Kubernetes NVMe-oF와 Mayastor"
description: "Kubernetes에서 Mayastor를 도입하기 전에 복제 위치, 고정 자원, 기능 제한, 공개 성능과 운영 근거를 확인한다. Longhorn V2·LINSTOR·Ceph·로컬 PV와의 차이도 비교한다."
weight: 8
date: 2026-10-21
lastmod: 2026-10-21
url: "/storage/08-kubernetes-nvmeof-mayastor/"
---

# 08 · Kubernetes NVMe-oF — Mayastor는 언제 도입할까

Mayastor는 OpenEBS의 Replicated PV 엔진으로, Kubernetes 노드 사이에서 RWO(단일 노드 읽기·쓰기) 볼륨을 동기 복제합니다. 대신 모든 스토리지 노드에 전용 CPU와 메모리, 휴지페이지를 예약해야 합니다. 엔터프라이즈 기능과 DataCore Puls8의 상용 지원은 갖췄지만 공개 도입 사례와 커뮤니티의 폭은 Ceph나 Longhorn보다 좁다고 해석합니다.

2026-10-21 기준으로 Mayastor와 구조가 가장 가까운 대안은 Longhorn V2입니다. 외부 ONTAP 어레이를 연결한다면 NetApp Trident를 사용할 수 있습니다. LINSTOR의 복제 계층은 DRBD이고 Ceph NVMe-oF는 아직 실험 단계입니다. 애플리케이션이 자체 복제를 제공하는 경우에는 로컬 PV도 함께 비교해야 합니다.

근거는 `✓` 1차 문서, `Ⓑ` 공개 벤치마크, `Ⓥ` 벤더·프로젝트 주장, `≈` 추정·역산, `?` 미확인으로 나눕니다. 수치와 적용 조건은 각 절의 접은 표에 정리했습니다.

애플리케이션 복제와 로컬 디스크 구성은 [03 로컬 디스크와 HA]({{< relref "/data/block-storage/03-local-disk-ha/index.md" >}}), 외부 어레이의 전송 지원은 [04 엔터프라이즈 전송 현황]({{< relref "/data/block-storage/04-enterprise-transports/index.md" >}})에 정리했습니다. Kubernetes 노드의 호스트 설정은 [05 호스트·클라우드·오프로드]({{< relref "/data/block-storage/05-host-side-and-cloud/index.md" >}}), NVMe/TCP 운영은 [06 Linux NVMe/TCP 운영]({{< relref "/data/block-storage/06-linux-nvme-tcp-operations/index.md" >}}), FC·TCP·RDMA 비교는 [07 FC·TCP·RDMA 전송 비교]({{< relref "/data/block-storage/07-fc-tcp-rdma-transports/index.md" >}})에서 다룹니다.

## 1. 복제를 담당할 계층부터 정한다 {#1-복제를-어디에-둘지에-따라-선택지가-달라진다}

Mayastor와 Longhorn V2는 Kubernetes 노드에 붙은 디스크를 스토리지 엔진에서 복제합니다. Trident로 외부 ONTAP을 연결하면 어레이가 복제를 맡습니다. 로컬 PV는 스토리지 계층을 복제하지 않으므로 애플리케이션 자체 복제에 의존합니다. OpenEBS도 애플리케이션 수준의 복원력이 있는 워크로드와 스토리지 복제가 필요한 워크로드를 구분합니다.

표에 나온 Mayastor의 자원과 기능 제약은 2절에서 자세히 설명합니다.

| 선택지 | 데이터 경로 | 복제 방식 | 전송 | 접근 모드 | GA 상태 | 요구 자원 | 상용 지원 | 공개 사용 사례 |
|---|---|---|---|---|---|---|---|---|
| Mayastor (OpenEBS Replicated PV) | SPDK io-engine, 하이퍼컨버지드 | nexus의 동기 N-way 미러 | NVMe/TCP, NVMe/RDMA(2.8~) | RWO. RWX 블록은 실험 | 2.x 안정판(프로젝트 표기). CNCF Sandbox | 노드당 2코어 폴링, 2GiB hugepage, 1GiB RAM, 최소 3노드 | DataCore Puls8 | 직접 공개 1(Civo) `✓` |
| Longhorn V2 data engine | SPDK `spdk_tgt`, 하이퍼컨버지드 | 엔진의 동기 복제(Longhorn 복제 모델). 실험 기능으로 erasure coding 샤딩(1.12.1~) | NVMe/TCP(엔진↔복제본), 프런트엔드 nvme-tcp·UBLK(실험) | RWO, RWX(NFS 경유, V2 지원) | **1.12.0 GA (2026-06-02)**. CNCF Incubating | 2GiB hugepage, 전용 코어 1개 이상, 커널 6.7 이상, vfio_pci·uio_pci_generic·nvme-tcp | SUSE | V2만 따로 밝힌 사례는 미확인 `?` |
| Piraeus / LINSTOR | 커널 DRBD(복제) + 선택적 NVMe 레이어(nvmet) | DRBD 동기 복제(프로토콜 C). **NVMe 레이어 단독은 복제 없음** | DRBD는 TCP·RDMA. NVMe 레이어는 NVMe-oF(RDMA)·NVMe/TCP | RWO(블록·FS). RWX는 별도 NFS 게이트웨이 | GA. CNCF Sandbox | 폴링 코어·hugepage 불필요(커널 경로) `≈` | LINBIT | 이번 조사 범위 밖 `?` |
| Rook / ceph-csi NVMe-oF 게이트웨이 | RBD 앞에 SPDK 기반 ceph-nvmeof 게이트웨이 | Ceph 복제·EC | NVMe/TCP | RWO 블록 중심. 클론·VGS(3.18) | **실험**(Rook 1.21 문서, ceph-csi 3.16~) | Ceph 클러스터 + 게이트웨이 Pod, Ceph v20 이상 | Red Hat, IBM 등(Ceph 일반) | NVMe-oF 경로 사례 미확인 `?` |
| NetApp Trident `ontap-san` NVMe | 외부 ONTAP 어레이 | 어레이 내부 + SnapMirror(25.06~) | NVMe/TCP | RWO, RWX 블록 `≈` | GA | 어레이 | NetApp | 벤더 사례 다수 `Ⓥ` |
| 로컬 PV + 앱 복제 | 커널 로컬 NVMe(LVM·ZFS·HostPath) | 앱이 복제(Patroni, Kafka, Cassandra 등) | 없음(네트워크는 앱 복제 트래픽만) | RWO | GA | 추가 고정 자원 없음 | OpenEBS Local PV는 DataCore | ADOPTERS 대부분 `✓` |

Longhorn V2는 Mayastor처럼 SPDK 사용자 공간 엔진과 NVMe-oF/TCP를 사용하며 휴지페이지와 폴링 코어를 요구합니다. NFS 기반 RWX(여러 노드 읽기·쓰기), 백업, DR 볼륨까지 제공해 기능 범위는 더 넓습니다. 반면 strict-local 데이터 지역성은 지원하지 않고 ARM64 NVMe 경로의 I/O 멈춤과 대량 볼륨 attach 지연이 알려진 제약으로 남아 있습니다.

LINSTOR에서 NVMe 레이어는 원격 디스크를 연결하고 실제 복제는 DRBD가 담당합니다. Ceph NVMe-oF의 주된 용도는 클러스터 외부 클라이언트에 RBD를 내보내는 것입니다. 클러스터 내부 Pod에서도 쓸 수 있지만 아직 실험 기능입니다.

Patroni 기반 Postgres, Kafka, Cassandra, etcd처럼 애플리케이션이 데이터를 복제한다면 03편의 로컬 PV가 비용과 성능 면에서 유리합니다. 여러 노드가 동시에 쓰는 파일시스템이 필요하면 Longhorn의 NFS RWX나 CephFS를 비교해야 합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Longhorn V2 GA | V2 data engine은 1.11 Technical Preview, 1.12.0(2026-06-02) GA. Longhorn 1.13.0(2026-09-29)에 live upgrade·interrupt mode 정식화. CNCF Incubating(2021-11-04) | Longhorn v1.12.0·v1.11.0·v1.13.0 릴리스 노트, CNCF | `✓` |
| Mayastor와 Longhorn V2의 구조 | 둘 다 SPDK 사용자 공간 엔진, NVMe-oF/TCP, 2GiB hugepage와 폴링 코어 | OpenEBS Prerequisites, Longhorn 1.13.0 문서 | `✓` |
| Longhorn V2 기능·제약 | RWX(NFS)·백업·DR 볼륨을 V2에서도 지원. strict-local 데이터 지역성 없음, ARM64 NVMe 경로 I/O 멈춤 이슈, 볼륨이 많을 때 attach 지연 | Longhorn 1.13.0 Data Engine Comparison, v1.13.0 릴리스 노트 | `✓` |
| LINSTOR | piraeus-operator 2.12.0(2026-09-17), linstor-server 1.35.3(2026-10-21). NVMe 레이어는 GA이나 복제 없음. 레이어 표상 DRBD 아래에 NVMe를 둘 수 있음(DRBD → NVMe → STORAGE) | LINSTOR User Guide, 릴리스 목록 | `✓` |
| Rook | 1.21.0(2026-10-06). NVMe-oF 문서 첫 줄 "This feature is experimental". Ceph v20(Tentacle) 이상 필요. CNCF Graduated(2020-10-07) | Rook v1.21.0 NVMe-oF 문서, CNCF | `✓` |
| ceph-csi | 3.18.1(2026-10-01). NVMe-oF는 3.16.0에서 "NEW and Experimental". 3.18.0에 외부 클라이언트·클론·VolumeGroupSnapshot 추가 | ceph-csi v3.18.0 릴리스 노트 | `✓` |
| 앱 수준 복제와 복제 스토리지의 구분 | LocalPV는 앱 수준 복원력을 갖춘 워크로드용, 복제 스토리지는 그렇지 않은 워크로드용 | OpenEBS 블로그 (2021-03-22) | `✓` |
| RWO 전용 | 공유 파일시스템이 필요하면 Longhorn(NFS RWX)이나 CephFS를 봐야 함 | v2.11.0 노트, Longhorn 1.13.0 문서 | `✓` |

{{% /details %}}

## 2. 고정 자원과 기능 제한을 먼저 계산한다 {#2-mayastor의-자원-요구와-기능-제한}

공식 요구 사항대로라면 3노드 클러스터가 io-engine용 CPU 코어 6개를 항상 사용합니다. io-engine은 I/O 부하가 없어도 전용 코어를 폴링하며 RAM과 휴지페이지도 예약합니다. 2.11부터 실험적인 interrupt mode를 선택할 수 있지만 지연이 증가합니다.

데이터 플레인인 io-engine DaemonSet은 디스크 하나로 구성한 DiskPool에 복제본을 저장합니다. 각 볼륨의 nexus가 복제본을 묶어 NVMe-oF 타깃으로 내보내고, 애플리케이션 노드는 커널 nvme-tcp 이니시에이터로 접속합니다. nexus가 같은 노드에 있어도 이 구간은 NVMe-oF를 사용합니다. 쓰기는 정상 복제본이 모두 완료한 뒤 응답하고 읽기는 정상 복제본 사이를 라운드로빈합니다. 같은 io-engine 인스턴스에는 복제본을 두 개 배치하지 않습니다.

동기 복제에서는 가장 느린 복제본이 쓰기 응답 시간을 결정합니다. `nodeSpreadTopologyKey`로 zone 라벨에 따라 복제본을 흩을 수 있지만 존 간 RTT가 커질수록 쓰기 지연도 늘어날 것으로 보입니다. 경로 장애는 HA node agent가 감지하고 cluster agent가 정상 노드에 새 nexus를 만듭니다. 이 HA 경로에는 복제본 2개 이상과 `nvme_core.multipath=Y`가 필요합니다. 장애 복제본이 10분 안에 돌아오지 않으면 전체 리빌드가 시작되며, 노드 장애로 유실된 스냅샷은 복구되지 않습니다.

볼륨 기능은 RWO를 중심으로 설계됐습니다. RWX 블록은 KubeVirt 라이브 마이그레이션을 위한 실험 기능에 한정됩니다. 2023년 이후 스냅샷·복원, 온라인 확장, thin provisioning, 토폴로지, DiskPool 단위 저장 암호화가 차례로 추가됐습니다. 아직 unmap/discard, 여러 장치를 묶는 DiskPool, VolumeGroupSnapshot, 암호화 키(DEK) 교체는 지원하지 않습니다. 2.12의 TLS 강화 대상은 컨트롤 플레인입니다. 데이터 경로의 전송 암호화와 체크섬·스크럽은 문서에서 확인하지 못했습니다.

thin provisioning에 관한 문서는 서로 맞지 않습니다. I/O Path 문서에는 미지원이라는 설명이 남아 있지만 StorageClass 문서와 2.1.0 릴리스 노트는 지원 기능으로 명시합니다. 여기서는 릴리스 노트를 현재 상태로 판단했습니다.

기본 설치는 etcd 3개와 NATS, Loki, MinIO까지 배포합니다. 업그레이드는 전용 플러그인으로 진행하며 다운그레이드는 지원하지 않습니다. 복제본이 1개인 볼륨은 업그레이드 중 잠시 중단됩니다. DiskPool에는 파티션이 없는 전용 디스크를 `/dev/disk/by-id/` 경로로 지정해야 합니다. 작은 홈랩에서는 4.6.x 차트의 Loki와 Alloy를 끄는 편이 자원 부담을 줄입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 동기 미러와 읽기 라운드로빈 | 건강한 모든 child가 완료해야 응답. 읽기는 건강한 child 사이를 라운드로빈 | OpenEBS 4.6.x I/O Path Description | `✓` |
| 같은 노드 nexus도 NVMe-oF 구간 | 앱에서 nexus까지 NVMe-oF 프로토콜을 탐 | OpenEBS 4.6.x I/O Path Description | `✓` |
| DiskPool 구성 | 블록 장치 1개로 만든 SPDK Logical Volume Store. 여러 장치를 묶지 못함 | I/O Path Description, v2.12.0 릴리스 노트 | `✓` |
| 코어·메모리 | 노드마다 코어 2개(`io_engine.cpuCount: "2"`), 부하와 무관하게 100%. 1GiB RAM, 2MiB hugepage 최소 1024장(2GiB) | OpenEBS 4.6.x Prerequisites, Performance Tips, Helm values.yaml | `✓` |
| io-engine CPU 비용 | 측정이 아니라 설계로 정해짐. 노드마다 코어 2개 상시 100% | Performance Tips | `✓` |
| 노드 수 | 최소 워커 3대. N-way 미러링이면 io-engine 노드 N대 이상 | OpenEBS 4.6.x Prerequisites | `✓` |
| 3노드 고정 코어 | 코어 6개 상시 | 위 요구 사항에서 곱한 값 | `≈` |
| interrupt mode | 2.11.0에서 실험 기능으로 도입 | Mayastor v2.12.0 노트 | `✓` |
| nexus 전환(HA) | 복제 수 2 이상, `nvme_core.multipath=Y` 필수. RHEL 10 계열은 이 파라미터가 없어 HA 미지원 | OpenEBS 4.6.x High Availability | `✓` |
| 부분 리빌드 | 기본 10분(`--faulted-child-wait-period`) 안에 복제본이 돌아오면 로그만큼만, 넘기면 전체. 로그 기반 리빌드는 2.2.0 | OpenEBS 4.6.x Replica Rebuilds, 릴리스 목록 | `✓` |
| 스냅샷 미복구 | 노드 장애로 잃은 스냅샷은 복구되지 않음. 스냅샷 리빌드는 로드맵 Paused | OpenEBS 4.6.x Volume Snapshots, ROADMAP.md | `✓` |
| 리빌드 속도·throttle 수치 | 공식 문서에 없음. 2.12에서 노드별 리빌드 카운트 기반 throttle 버그 수정 언급만 있음 | Mayastor v2.12.0 노트 | `✓` `?` |
| RWO·RWX | RWO(Filesystem·Block) 지원. RWX는 KubeVirt live migration용 블록만, 실험·비프로덕션, 2.11.0(2026-06) | Mayastor v2.11.0 노트, Storage Class Parameters | `✓` |
| ROX | 문서 언급 없음 | — | `?` |
| thin provisioning | 2.1.0부터. 한 볼륨 안에서 thick·thin 혼용 불가 | Storage Class Parameters, 릴리스 목록 | `✓` |
| at-rest 암호화 | DiskPool 단위 AES-XTS, 키는 Kubernetes Secret, 2.9.0. DEK 교체 불가 | OpenEBS 4.6.x Encryption, v2.12.0 노트 | `✓` |
| 미지원 | unmap/discard/trim은 로드맵 TBD. 다중 장치 DiskPool 로드맵 TBD. VolumeGroupSnapshot은 OEP 3904 provisional(2025-04) | ROADMAP.md, OEP 3904 | `✓` |
| 전송 중 암호화 | 데이터 경로 TLS 언급 없음. 2.12의 TLS 강화는 컨트롤 플레인 REST·gRPC 대상 | Mayastor v2.12.0 노트 | `✓` `?` |
| 데이터 무결성 | 체크섬·스크럽 언급 없음 | — | `?` |
| 기본 설치 구성 | etcd 기본 replicaCount 3(PVC 2Gi). 2.9부터 Loki 3개·MinIO 3개 기본, `loki.enabled=false`로 끔 | Helm values.yaml, v2.12.0 노트 | `✓` |
| 존 간 배치 | `nodeSpreadTopologyKey`로 zone 라벨에 복제본 분산. 쓰기 지연은 가장 먼 복제본이 정함. 존 간 RTT가 크면 쓰기 지연 증가 | Topology Parameters, I/O Path Description | `✓` `≈` |
| 존 간 권장 RTT | 문서에 없음 | — | `?` |
| 홈랩 최소 구성 | 워커 3대, x86-64(SSE4.2), 코어 2개·1GiB RAM, `vm.nr_hugepages=1024`(변경 뒤 kubelet 재시작 또는 재부팅), `nvme-tcp`, 10GB 이상 비영속 이름이 아닌 전용 디스크 | OpenEBS 4.6.x Prerequisites, Puls8 Manual Prerequisites, v2.12.0 노트 | `≈` 공식 요구 사항을 합친 것 |
| interrupt mode | 실험 기능. 켜면 지연이 늘어남 | Helm values.yaml | `✓` |

{{% /details %}}

## 3. 공개 성능 수치의 빈 조건을 확인한다 {#3-공개-iops로-현재의-지연-비용까지-판단할-수는-없다}

공개 자료 가운데 조건이 가장 잘 남은 것은 MayaData CTO가 2020년에 수행한 측정입니다. Optane NVMe 한 대씩을 장착한 노드 3대에서 fio를 실행했고, 복제본 1개일 때 로컬 대비 IOPS 손실은 1~6%였습니다. 읽기는 로컬 585K, Mayastor 579K IOPS였습니다. 다만 Mayastor 1.0 이전 버전에서 큐 깊이 64로 처리량을 측정한 결과이며 지연과 CPU 사용량은 공개하지 않았습니다. 따라서 I/O 한 건의 지연 오버헤드는 알 수 없습니다.

MayaData 표의 백분율에는 분모 오류도 있습니다. 쓰기 -9.09%는 로컬을 분모로 다시 계산하면 약 8% 감소입니다. 나머지 재계산 값은 아래 근거 표에 남겼습니다. 복제본 2개의 읽기 IOPS가 로컬보다 높게 나온 이유는 두 복제본에서 라운드로빈으로 읽었기 때문이라고 원문이 설명합니다.

다른 자료도 비교 조건이 충분하지 않습니다. Vadosware의 단일 노드 결과에서는 Mayastor NVMe-oF의 평균 읽기 지연이 HostPath보다 높았습니다. 관리형 Kubernetes 업체 Kubedo의 글은 Mayastor 버전과 복제 수를 밝히지 않았고, cwiggs의 가상화 홈랩 결과는 1회 측정에 그칩니다. 가상 디스크와 가상 NIC를 사용하는 VM 홈랩 수치는 물리 서버 결과와 크게 다를 수 있습니다.

복제본 3개의 지연을 로컬과 비교한 결과, p99 지연, 리빌드 중 성능, 코어당 IOPS를 조건과 함께 공개한 자료는 찾지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| MayaData CTO 블로그 (2020-11-19) | 노드 3대(Xeon Gold 6252, Optane NVMe 1대씩, ConnectX-6), 커널 5.8. fio linuxaio, direct=1, bs=4k, numjobs=8, iodepth=64, 300초. pool은 `pcie:///`. Mayastor 1.0 이전 | Molanus 블로그 | `Ⓑ` 부분(지연·CPU·NIC 속도·Optane 모델 없음) |
| 로컬 기준 | 랜덤 읽기/쓰기/혼합 585K/516K/476K | 같은 블로그 | `Ⓑ` |
| repl=1 | 579K/490K/454K. 손실 1.04%/5.31%/5.62% | 같은 블로그 | `Ⓑ` |
| repl=2 | 993K/473K/568K | 같은 블로그 | `Ⓑ` |
| 원문 퍼센트의 분모 | 쓰기 -9.09%는 473K 분모, 516K 기준 약 8% 감소. 읽기 +41%는 993K 분모, 585K 기준 약 +70% | 위 수치에서 역산 | `≈` |
| repl=2 읽기가 높은 이유 | 두 복제본에서 라운드로빈 읽기 | I/O Path Description, 블로그 | `✓` |
| Vadosware 라운드 2 (2021-04-13) | 노드 1대, 디스크 1개, 블록 크기·QD 미기재. O_DIRECT 랜덤 읽기 IOPS: HostPath 295K, Mayastor NVMe-oF 90.3K, Mayastor iSCSI 128K, Rook Ceph 51.6K. 평균 읽기 지연 HostPath 52.69µs, Mayastor NVMe-oF 88.55µs | Vadosware 블로그 | `Ⓑ` 약함 |
| Kubedo etcd 벤치마크 (2025-08-04) | 노드 10대, NVMe 60개(쓰기 캐시 끔), VM 240대. Mayastor 버전·복제 수·NIC·QD 미기재. 4K 평균 IOPS: Mayastor 270K, Ceph RBD 250K, Longhorn 120K. Mayastor는 "부하 시 꼬리 지연 스파이크" | Kubedo 블로그 | `Ⓥ` 관리형 Kubernetes 업체 블로그, 조건 불충분 |
| cwiggs 홈랩 (2024-12-26) | Proxmox VM, 복제 pool 3개, 4K 랜덤, 1회 측정. Mayastor 읽기 약 966 IOPS·7.8ms, Longhorn 약 21 IOPS·266ms | cwiggs 블로그 | `≈` 가상화 홈랩, 재현성 낮음 |
| 가상화 홈랩 | VM 홈랩은 수치가 실제 하드웨어와 크게 다름 | cwiggs 사례 | `≈` |
| 2025 Longhorn 논문 | 노드 2대, Xeon E5-2620v2, Samsung PM1733, 10GbE. 업스트림 V1 17K/13K에서 최적화본 112K/115K IOPS. Mayastor 측정은 v1 본문에 없음 | arXiv 2502.14419 | `Ⓑ` Longhorn만 |
| repl=3 지연·p99·리빌드 중 성능·코어당 IOPS | 조건을 명시한 공개 자료를 찾지 못함 | — | `?` |

{{% /details %}}

## 4. 상용 지원과 공개 운영 근거를 따로 본다 {#4-상용-지원은-있지만-공개-도입-근거는-좁다}

OpenEBS ADOPTERS 목록에서 회사가 Mayastor 실사용을 직접 밝힌 사례는 Civo 하나입니다. 나머지 조직은 Local PV, cStor, Jiva를 사용합니다. Civo는 수년간 프로덕션 VM의 영속 데이터를 저장했다고 적었지만 규모와 워크로드는 공개하지 않았습니다. 스페인 관리형 클라우드 TodoEnCloud 사례는 DataCore 보도자료에 실린 고객 인용이므로 벤더 주장으로 분류했습니다.

상용 지원 주체는 DataCore입니다. DataCore는 2021년 11월 MayaData를 인수한 뒤 현재 Puls8을 판매합니다. Puls8 문서가 Replicated PV Mayastor io-engine을 명시하므로 Mayastor가 데이터 엔진이라는 점은 직접 확인됩니다. 가격, 지원 SLA, 오픈소스판과의 기능 차이는 공개 자료에서 찾지 못했습니다. 상용 계약을 제외한 지원 창구는 GitHub 이슈와 Slack입니다.

개발과 시험 자원도 DataCore에 많이 의존합니다. 최상위 메인테이너의 다수가 DataCore 소속이며 최근 1년 mayastor 커밋의 약 60%를 DataCore 소속 한 명이 만들었습니다. E2E 시험 자원도 DataCore가 제공합니다. OpenEBS는 CNCF Sandbox 프로젝트로, 2024년 1월 Archive 상태가 됐다가 같은 해 10월 Sandbox로 재수용됐습니다. DataCore는 그 기간에 엔진을 정리했다고 설명합니다.

이 근거를 종합하면 Mayastor는 엔터프라이즈 기능과 상용 지원 경로를 갖췄지만 공개 운영 사례와 커뮤니티의 폭은 Ceph나 Longhorn보다 좁다고 볼 수 있습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Civo | ADOPTERS 항목에 엔진 "Mayastor", "몇 년째 프로덕션", VM 영속 데이터. 규모·워크로드 세부 없음 | OpenEBS ADOPTERS.md, adopters/civo | `✓` 자기 기재 |
| ADOPTERS 구성 | 조직 21곳과 개인 6명. Mayastor 사용을 적은 곳은 Civo뿐. 시험 예정 2곳(Zeta Associates, 개인 1명). 마지막 갱신 2025-04 | OpenEBS ADOPTERS.md | `✓` |
| TodoEnCloud | 스페인 데이터센터 3곳 배치. 2025년 말 시험·초기 배치 | DataCore Puls8 보도자료 (2026-01-27) | `Ⓥ` 보도자료 속 인용 |
| 프로젝트 표기 | README는 "Designed for Enterprises and production deployments", "Stable, deployable in PROD". 개요 문서는 "mission-critical workloads"와 "zero data loss" | OpenEBS README, Overview | `Ⓥ` |
| Puls8 | "enterprise-class persistent storage for Kubernetes", OpenEBS 기반, 24/7 엔터프라이즈 지원 제공 주장 | DataCore 보도자료 | `Ⓥ` |
| Puls8 문서 | "Replicated PV Mayastor io-engine requires 2GiB of 2MiB HugePages". Puls8 4.6 GA 2026-09-22 | Puls8 Prerequisites, Release Notes | `✓` |
| 커밋 집중도 | 최근 1년 mayastor 커밋 약 270건 중 162건이 한 명(DataCore). 비율 약 60% | GitHub API 집계 | `✓` 집계 `≈` 비율 |
| 메인테이너 | 최상위 5명 중 DataCore 3, Minds DB 1, 소속 미기재 1. CNCF 연락 담당도 DataCore | OpenEBS MAINTAINERS.md | `✓` |
| E2E 시험 자원 | "Resources for system-level (E2E) testing are currently provided by DataCore Software" | Mayastor v2.12.0 노트 | `✓` |
| CNCF 이력 | 2024-01 Archive, 2024-10-10 Sandbox 재수용. Archive 경위는 DataCore 기고 | CNCF 프로젝트 페이지, The New Stack | `✓` `Ⓥ` |
| 엔터프라이즈 판단 | 기능·지원은 있으나 공개 사례와 커뮤니티 폭은 Ceph·Longhorn보다 좁다 | 위 항목을 종합한 해석 | `≈` |

{{% /details %}}

## 아직 확인할 항목 {#확인하지-못한-것}

- repl=3 볼륨의 평균·p99 지연을 로컬과 비교하면서 조건까지 밝힌 측정은 03편과 마찬가지로 찾지 못했다.
- 리빌드 속도와 리빌드 중 애플리케이션 지연, throttle 설정값은 공개 자료에서 확인하지 못했다.
- io-engine 코어 2개당 처리 한계와 interrupt mode가 더하는 지연의 수치는 알 수 없다.
- Mayastor와 Longhorn V2를 같은 하드웨어에서 비교한 최신(2025~2026) 측정은 찾지 못했다. 2025 논문 v1에도 Mayastor 수치가 없다.
- Civo를 제외한 회사의 프로덕션 노드 수, 볼륨 수, 장애 경험은 공개되지 않았다.
- DataCore Puls8의 가격과 지원 SLA, 오픈소스판과의 기능 차이는 확인하지 못했다.
- 체크섬과 스크럽을 포함한 데이터 무결성 기능의 제공 여부는 확인하지 못했다.
- simplyblock과 Lightbits는 Kubernetes 접근 모드와 독립 측정을 찾지 못했고 벤더 자료만 확인했다.

## 참고 자료

- [OpenEBS README](https://github.com/openebs/openebs/blob/main/README.md) — 엔진 상태 표와 "Stable, deployable in PROD" 표기
- [Mayastor v2.12.0 릴리스 노트](https://github.com/openebs/mayastor/releases/tag/v2.12.0) — Known Limitations, Known Issues, E2E 시험 환경
- [Mayastor v2.11.0 릴리스 노트](https://github.com/openebs/mayastor/releases/tag/v2.11.0) — RWX 블록 볼륨 실험 기능, interrupt mode
- [Mayastor 릴리스 목록](https://github.com/openebs/mayastor/releases) — 기능별 도입 버전과 최근 1년 릴리스
- [OpenEBS 4.6.x I/O Path Description](https://github.com/openebs/website/blob/main/docs/versioned_docs/version-4.6.x/user-guides/replicated-storage-user-guide/replicated-pv-mayastor/additional-information/i-o-path-description.md) — nexus, 동기 미러, 읽기 라운드로빈
- [OpenEBS 4.6.x Prerequisites](https://github.com/openebs/website/blob/main/docs/versioned_docs/version-4.6.x/quickstart-guide/prerequisites.md) — 코어, hugepage, RAM, 노드 수 요구 사항
- [OpenEBS 4.6.x High Availability](https://github.com/openebs/website/blob/main/docs/versioned_docs/version-4.6.x/user-guides/replicated-storage-user-guide/replicated-pv-mayastor/advanced-operations/HA.md) — nexus 전환과 multipath 요구
- [OpenEBS 4.6.x Replica Rebuilds](https://github.com/openebs/website/blob/main/docs/versioned_docs/version-4.6.x/user-guides/replicated-storage-user-guide/replicated-pv-mayastor/advanced-operations/replica-rebuild.md) — 부분 리빌드와 10분 기준
- [OpenEBS 4.6.x Volume Snapshots](https://github.com/openebs/website/blob/main/docs/versioned_docs/version-4.6.x/user-guides/replicated-storage-user-guide/replicated-pv-mayastor/advanced-operations/snapshot.md) — 스냅샷 복구 한계
- [OpenEBS 4.6.x Performance Tips](https://github.com/openebs/website/blob/main/docs/versioned_docs/version-4.6.x/user-guides/replicated-storage-user-guide/replicated-pv-mayastor/additional-information/performance-tips.md) — CPU 격리와 폴링 코어
- [OpenEBS 4.6.x Storage Class Parameters](https://github.com/openebs/website/blob/main/docs/versioned_docs/version-4.6.x/user-guides/replicated-storage-user-guide/replicated-pv-mayastor/configuration/rs-storage-class-parameters.md) — 접근 모드와 thin provisioning
- [OpenEBS ROADMAP.md](https://github.com/openebs/openebs/blob/main/ROADMAP.md) — unmap, 다중 장치 DiskPool, 스냅샷 리빌드 상태
- [mayastor-extensions Helm chart values.yaml](https://github.com/openebs/mayastor-extensions/blob/v2.12.2/chart/values.yaml) — etcd 기본값, cpuCount, interrupt mode
- [OpenEBS ADOPTERS.md](https://github.com/openebs/community/blob/develop/ADOPTERS.md) — 도입 조직 목록
- [OpenEBS MAINTAINERS.md](https://github.com/openebs/community/blob/develop/MAINTAINERS.md) — 메인테이너 소속
- [Mayastor NVMe-oF TCP performance](https://github.com/openebs/website/blob/main/website/src/blogs/mayastor-nvme-of-tcp-performance.md) — 2020년 MayaData CTO 측정과 표
- [Vadosware, K8s storage provider benchmarks round 2, part 5](https://vadosware.io/post/k8s-storage-provider-benchmarks-round-2-part-5/) — 단일 노드 비교
- [cwiggs, OpenEBS Mayastor vs Longhorn](https://cwiggs.com/posts/2024-12-26-openebs-vs-longhorn/) — 가상화 홈랩 1회 측정
- [Optimizing the Longhorn Cloud-native Software Defined Storage Engine (arXiv 2502.14419)](https://arxiv.org/abs/2502.14419) — Longhorn 최적화 측정
- [DataCore Puls8 출시 보도자료](https://www.datacore.com/news-post/datacore-launches-puls8-to-deliver-enterprise-class-persistent-storage-for-kubernetes/) — 상용 지원과 TodoEnCloud 인용
- [DataCore Puls8 Manual Prerequisites](https://docs.datacore.com/Puls8/Puls8-WebHelp/Manual_Prerequisites_Setup.htm) — Mayastor io-engine hugepage 요구
- [CNCF OpenEBS 프로젝트 페이지](https://www.cncf.io/projects/openebs/) — Sandbox 등급
- [Longhorn 1.13.0 Data Engine Comparison](https://github.com/longhorn/website/blob/master/content/docs/1.13.0/data-engine-comparison.md) — V2 기능 범위
- [Longhorn v1.12.0 릴리스 노트](https://github.com/longhorn/longhorn/releases/tag/v1.12.0) — V2 GA
- [LINSTOR User Guide](https://linbit.com/drbd-user-guide/linstor-guide-1_0-en/) — NVMe 레이어와 DRBD
- [Rook v1.21.0 NVMe-oF Block Storage 문서](https://github.com/rook/rook/blob/v1.21.0/Documentation/Storage-Configuration/Block-Storage-RBD/nvme-of.md) — 실험 기능 표기
- [ceph-csi v3.18.0 릴리스 노트](https://github.com/ceph/ceph-csi/releases/tag/v3.18.0) — NVMe-oF 지원 범위
