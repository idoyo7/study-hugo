---
title: "GPU 스토리지의 병목을 파일 접근과 전송 경로로 읽는 법"
linkTitle: "02 데이터 경로와 파일시스템"
description: "GPU 스토리지의 메타데이터 배치와 클라이언트 접근 방식이 I/O 병목에 미치는 차이를 살펴보고, GDS 직접 경로의 조건과 SuperPOD 요구치와 NVIDIA 인증 범위를 정리한다."
weight: 2
date: 2026-10-21
lastmod: 2026-10-21
url: "/gpu-storage/02-data-path-and-filesystems/"
---

# 02 · GPU 스토리지의 병목을 파일 접근과 전송 경로로 읽는 법

GPU 스토리지의 병목은 파일 크기와 접근 방식, 그리고 GDS가 직접 경로를 쓰는지에 따라 달라집니다. 큰 파일 스트리밍은 데이터 서버 수에, 소파일 접근은 메타데이터 처리량에 영향을 받습니다. GPUDirect Storage(GDS)는 CPU 메모리를 거치는 복사를 줄이지만, 파일 접근 조건과 PCIe 토폴로지(장치 연결 배치)가 맞아야 직접 경로를 씁니다.

공개 성능 수치는 하드웨어와 측정 조건이 달라 벤더 간 순위로 쓰지 않습니다.

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인. 각 절 끝의 '근거와 측정 조건'에 수치와 조건을 모았습니다. 단계별 I/O 패턴은 [01 워크로드별 I/O]({{< relref "/data/gpu-storage/01-workload-io-patterns/index.md" >}}), 관리형 서비스와 Kubernetes는 [03]({{< relref "/data/gpu-storage/03-managed-object-kubernetes/index.md" >}})에 있습니다. NFS 자체의 동작은 [부록 NFS]({{< relref "/data/block-storage/a2-nfs/index.md" >}})에서 다뤘습니다.

## 1. 파일 크기와 연결 방식이 병목을 바꾼다

Lustre, BeeGFS, Hammerspace, Dell Lightning처럼 메타데이터를 분리한 방식에서는 큰 파일 스트리밍 성능이 데이터 서버 수에 비례해 늘고, 소파일이 많아지면 메타데이터 서버가 병목이 됩니다. WEKA, Storage Scale, VAST는 메타데이터 부하를 클러스터 전체로 분산하는 방식이 소파일에 유리하다고 설명합니다.

FSx for Lustre 문서는 파일 생성·열기·닫기와 디렉터리 생성·이름 변경에 필요한 메타데이터 IOPS를 구분합니다. 스트라이핑(여러 저장 대상에 나누어 배치)도 파일 크기의 영향을 받습니다. 작은 파일에 큰 스트라이프 수를 지정하면 모든 OST로 왕복이 생기므로, 소파일 데이터셋과 여러 랭크가 쓰는 큰 체크포인트 파일은 디렉터리 레이아웃을 따로 잡아야 합니다.

NFS에서는 마운트 하나가 서버 하나와 연결되므로 클라이언트 연결 방식도 처리량을 제한합니다. VAST 문서는 100 Gbps NIC에 RDMA(원격 메모리 직접 접근) nconnect 4, TCP nconnect 8을 권장합니다. 여러 CNode로 연결을 분산하는 멀티패스에는 VAST-NFS 클라이언트 드라이버가 필요합니다. NFS는 전용 클라이언트 없이도 접근할 수 있지만, 이 구성에는 VAST-NFS 드라이버가 필요합니다.

JuiceFS와 Alluxio는 데이터를 오브젝트 저장소에 두고 메타데이터 엔진과 분산 캐시를 별도로 둡니다. JuiceFS는 MLPerf 제출 전에 콜드 데이터를 캐시 클러스터에 적재했습니다. 이 측정에는 캐시 미스 비용이 포함되지 않았다는 것이 이 글의 해석입니다. 오브젝트와 캐시 구성은 [03]({{< relref "/data/gpu-storage/03-managed-object-kubernetes/index.md" >}})에서 이어집니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| FSx for Lustre 메타데이터 IOPS | 프로비저닝 메타데이터 IOPS 1당 초당 파일 생성·열기·닫기 2회, 삭제 1회, 디렉터리 생성·이름 변경 0.1회 | [S40] | `✓` |
| FSx for Lustre 기본 PFL | 100 MiB 이하 파일은 OST 1개, 100 GiB 초과는 32개. 작은 파일에 큰 스트라이프 수를 주면 모든 OST로 왕복 | [S40] | `✓` |
| 분산 메타데이터의 소파일 이점 | 메타데이터 부하가 클러스터 전체로 퍼져 소파일에 유리하다는 벤더 설명 | WEKA·Storage Scale·VAST 자료 | `Ⓥ` |
| NFS nconnect 한계 | 단일 마운트 TCP nconnect 최대 7 GBps, RDMA 단일 연결 최대 9 GBps. 100 Gbps NIC에는 RDMA nconnect=4, TCP nconnect=8 권장 | [S31] | `✓`(벤더 문서) |
| 멀티패스 | 연결을 여러 CNode로 퍼뜨림. VAST-NFS 클라이언트 드라이버 필요 | [S31] | `✓` |
| JuiceFS 측정 방식 | MLPerf 제출에서 콜드 데이터를 캐시 클러스터에 미리 올려 두고 측정. 캐시 미스 비용이 결과에서 빠졌다는 해석 | [S56] | `Ⓥ` |
| JuiceFS·Alluxio 구조 | 메타데이터 엔진과 분산 캐시를 따로 두고 데이터는 오브젝트에 둠 | [S56] | `Ⓥ` |

{{% /details %}}

## 2. 파일시스템은 메타데이터와 클라이언트 경로로 비교한다

아래 표는 파일시스템별 메타데이터 처리 방식과 클라이언트 접근 경로를 비교합니다. GDS 열은 3절에서 설명하는 release notes 지원 표의 내용입니다. Hammerspace, Dell Lightning, Everpure EXA는 pNFS(병렬 NFS)로 메타데이터와 데이터 경로를 분리합니다. VAST에서는 상태 없는 CNode가 NVMe-oF로 SSD를 공유하며, CNode 증설로 프로토콜 처리량을 늘립니다.

| 제품 | 메타데이터 | 클라이언트 접근 | RDMA | GDS(1.19.1 표) | 대표 공개 수치 | 등급 |
|---|---|---|---|---|---|---|
| Lustre / DDN EXAScaler | MDS/MDT 분리, 데이터는 OSS/OST에 스트라이프 | 커널 네이티브 클라이언트(LNet). DDN은 어플라이언스로 판매 | LNet이 IB·RoCE 지원 | ✓(EXAScaler 5.2+, 6.0+, FSx) | AI400X3M 2U 순차 읽기 190 GB/s·쓰기 110 GB/s(측정 조건 미공개) | 구조 ✓[S40] / 수치 Ⓥ[S33] |
| IBM Storage Scale(GPFS) | 분산 메타데이터(토큰 기반 공유 디스크 구조) | 네이티브 클라이언트(NSD), NFS, SMB, S3, cuObject | 지원 | ✓(5.1.2+) | cuObject가 POSIX 성능의 최대 90% | 기능 ✓[S27] / 수치 Ⓥ |
| WEKA(NeuralMesh) | 데이터·메타데이터를 클러스터 전체에 분산 | 전용 POSIX 클라이언트, NFS, SMB, S3. 사용자 공간 프로세스로 커널 우회 | 지원 | ✓(WekaFS) | DGX H100 BasePOD 8U에서 600 GB/s·2,200만 IOPS | 구조 ✓[S29] / 수치 Ⓥ |
| VAST Data | 상태 없는 CNode와 NVMe-oF JBOF(DBox)를 분리(DASE). 모든 CNode가 모든 SSD에 접근 | NFSv3/v4.1, NFS over RDMA, 멀티패스(VAST-NFS 클라이언트), S3 | NFSoRDMA | ✓(4.1+) | 2021년 DGX A100 1대가 단일 NFS 마운트로 162 GB/s 읽기 | 구조 ✓[S31][S32] / 수치 Ⓥ(구세대) |
| BeeGFS | 메타데이터 서비스 분리 | 커널 네이티브 클라이언트. BeeOND는 노드 로컬 SSD로 임시 FS 구성 | 7.3에서 클라이언트 멀티레일 RDMA | ✓ | 공개 수치 미확인 | ✓[S34] / 수치 ? |
| DAOS | 키-값 오브젝트 저장소. POSIX는 dfuse·인터셉트 계층 | libdaos, dfuse, MPI-IO | 필수에 가까움(사용자 공간 NVMe·RDMA) | 표에 없음 | Aurora 서버 128대에서 쓰기 약 1 TB/s, 읽기 600 GB/s(MLPerf v2.0 체크포인트) | Ⓥ(Argonne 발표) |
| Everpure(Pure) FlashBlade//EXA | 메타데이터는 FlashBlade, 데이터는 별도 Linux NVMe 데이터 노드 | 메타데이터는 pNFS/TCP, 데이터는 NFSv3 over RDMA | 데이터 경로 RDMA | ✓(FlashBlade) | MLPerf v3.0 1.25T 체크포인트 쓰기 877.52 GiB/s(데이터 노드 30대, 가속기 1,024개) | Ⓑ[S21][S22] |
| NetApp ONTAP AI / AFX | AFX는 ONTAP을 분리형(성능과 용량 분리)으로 재구성 | NFS, NFS over RDMA, S3 | NFSoRDMA | ✓(ONTAP) | AFX 노드 8대 + 셸프 1대로 GDS 워크로드 457 GiB/s 지속 | Ⓥ[S37] |
| Dell PowerScale | OneFS 스케일아웃 NAS. Lightning은 pNFS 메타데이터 서버 + Flex Files 레이아웃 | NFS, SMB, S3, (프리뷰) pNFS | NFSoRDMA | ✓ | 공개 수치 미확인 | 구조 Ⓥ[S38] |
| Hammerspace | 메타데이터 서버(Anvil)가 pNFS v4.2 Flex Files 레이아웃을 내준다 | 표준 Linux NFS 클라이언트(전용 클라이언트 불필요), SMB, S3 | NFSoRDMA 가능 | ✓ | MLPerf v2.0에 1U 메타데이터 서버 1대만 추가한 Tier 0 구성으로 제출 | Ⓥ[S39] |
| DeepSeek 3FS | FoundationDB 기반 상태 없는 메타데이터, CRAQ 복제 | FUSE와 USRBIO(사용자 공간 링 API) | 필수 | 해당 없음 | 서버 180대(노드당 200 Gbps IB 2개, 14 TiB NVMe 16개)에서 6.6 TiB/s 읽기, 클라이언트 500대 이상 | Ⓑ(자체) [S19] |

FlashBlade//EXA의 877.52 GiB/s는 데이터 노드 30대와 가속기 1,024개를 사용한 MLPerf v3.0 1.25T 체크포인트 쓰기 결과입니다. 같은 표의 다른 값에는 벤더 발표, 구세대 장비 측정, 자체 측정이 섞여 있습니다. 이 표의 수치는 서로 비교하지 않습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| VAST 구조 | CNode는 상태 없음, CNode 증설로 프로토콜 처리량 증가, SSD는 모든 CNode가 NVMe-oF로 공유 | [S32] | `✓` |
| pNFS 재부상 | Hammerspace, Dell Lightning, Everpure EXA가 메타데이터와 데이터 경로를 pNFS로 분리 | [S21][S38][S39] | `✓` / `Ⓥ` |
| Lustre 릴리스 | 최신 기능 릴리스 2.17.0(2025-12-29). 현장은 LTS 2.15.x가 다수, 2.15.8이 2025-12, 2.15.9는 2026 Q2 목표, 2.18.0은 2026 Q4 목표 | [S25][S26] | `✓` |
| Storage Scale 버전 | 6.0.1(IBM 블로그 2026-06-10), 6.0.0은 2025-10 발표 | [S27][S28] | `✓`(존재) · `Ⓥ`(성능) |
| WEKA | 제품명 NeuralMesh. Augmented Memory Grid는 SC25(2025-11) 상용 출시. NeuralMesh 6 GA가 2026 하반기라는 말은 서드파티뿐 | [S29][S30] | `✓` / NeuralMesh 6 `?` |
| VAST | 인증 목록에 C-Node Gen 6 + BF-3 D-Box, EBox 참조 설계(Genoa·Turin). 소프트웨어 최신 버전 번호는 미확인 | [S8] | `✓` / 버전 `?` |
| DDN | 인증 목록에 AI400X3·AI400X3i. AI400X3M은 2026 Q3 말 GA 예정 발표. GDS 표에 EXAScaler 5.2+와 6.0+. "EXAScaler 7"은 찾지 못함 | [S1][S8][S33] | `✓` / AI400X3M `Ⓥ` |
| BeeGFS | 8.x 계열, 8.2가 2025-11. Wikipedia는 8.4.1(2026-08-19)을 최신으로 적음 | [S34] | `✓`(8.2) / 8.4.1 `?` |
| DAOS | 2.8.0(2026-08-12)이 DAOS Foundation 첫 커뮤니티 릴리스로 알려짐. ALCF가 2026-10에 Aurora DAOS를 800대로 확대 발표 | [S35] | `?`(검색 요약) / `Ⓥ` |
| 표의 대표 수치 | 각 행의 조건은 표에 적은 그대로. AI400X3M, WEKA, VAST, NetApp, Hammerspace, DAOS 값은 벤더·발표 주장 | [S33][S29][S31][S37][S39][S35] | `Ⓥ` |
| FlashBlade//EXA 결과 | MLPerf v3.0 1.25T 체크포인트 쓰기 877.52 GiB/s, 데이터 노드 30대, 가속기 1,024개 | [S21][S22] | `Ⓑ` |
| 3FS | 서버 180대(노드당 200 Gbps IB 2개, 14 TiB NVMe 16개)에서 6.6 TiB/s 읽기, 클라이언트 500대 이상 | [S19] | `Ⓑ`(자체 측정) |
| NetApp AFX | AFX 노드 8대 + 셸프 1대, GDS 워크로드 457 GiB/s 지속 | [S37] | `Ⓥ` |
| Hammerspace | MLPerf v2.0에 1U 메타데이터 서버 1대 추가 Tier 0 구성으로 제출 | [S39] | `Ⓥ` |
| PowerScale pNFS | Project Lightning은 2025-11 기준 비공개 프리뷰, 이후 GA는 미확인 | [S38] | `Ⓥ` / GA `?` |

{{% /details %}}

## 3. GDS 지원과 실제 직접 경로는 구분한다

GDS의 직접 경로에서는 스토리지나 NIC 근처의 DMA 엔진이 GPU 메모리와 데이터를 주고받습니다. CPU 메모리의 bounce buffer(임시 버퍼)를 거치는 단계가 그만큼 줄어듭니다. 애플리케이션은 POSIX의 `pread`·`pwrite`를 닮은 `cuFileRead`와 `cuFileWrite`를 사용합니다. NVIDIA Overview Guide는 일부 시스템에서 직접 경로의 피크 대역폭이 CPU 경유의 최소 2배라고 설명하지만, GPU와 NIC가 루트 포트를 공유하지 않으면 P2P(장치 간 직접 통신)가 오히려 비효율적일 수 있다고 덧붙입니다.

파일은 `O_DIRECT`로 엽니다. CUDA 12.2(GDS 1.7) 이후에는 버퍼·크기·오프셋이 페이지 정렬이면 `O_DIRECT`가 아니어도 직접 경로를 사용합니다. 로컬 NVMe는 CUDA 12.8부터 업스트림 P2PDMA로 동작하며 `nvidia-fs.ko`가 필요 없습니다. GDS 1.19는 NVMe RAID1·RAID10 지원을 추가했으며, 업스트림 P2PDMA의 RAID0·NVMe multipath는 아직 미지원입니다.

분산 FS와 NFS에는 `nvidia-fs.ko`가 필요하고, NVIDIA 오픈 커널 모듈만 지원합니다. VAST 문서는 원격 접근에 RDMA 가능한 네트워크와 RDMA 마운트를 요구합니다. 지원 조건을 벗어나면 GDS는 CPU 메모리를 거치는 호환 모드로 자동 전환됩니다. GDS 1.19의 `vanilla_posix_mode`는 라이브러리가 없을 때 POSIX I/O를 씁니다. 이 글의 해석으로는 GDS를 켰다는 사실만으로 직접 경로를 쓴다고 볼 수 없습니다. NVIDIA 문서의 표현은 아닙니다.

GDS 1.19.1 지원 표에는 로컬 EXT4·XFS, NFS, FSx for Lustre, Storage Scale, WekaFS, BeeGFS, VAST, DDN EXAScaler, PowerScale, Hammerspace, Hitachi HCSF, HPE 제품군, NetApp ONTAP, Pure(Everpure) FlashBlade, VDURA PanFS, NEC ScaTeFS가 있습니다. NVMe-oF는 별도로 표시되지 않습니다.

오브젝트 저장소용 cuObject는 S3 요청의 제어 경로를 유지하고 페이로드만 RDMA로 GPU·호스트 메모리와 직접 주고받습니다. IBM은 Storage Scale 6.0.1에서 cuObject를 지원하며 POSIX 성능의 최대 90%를 낸다고 설명합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| GDS 현행 버전 | release notes 기준 v1.19.1, 패키지 `nvidia-gds-13-4`(CUDA 13.4와 짝). 페이지 최종 갱신 2026-09-17 | [S1] | `✓` |
| nvidia-fs 배포 방식 | CUDA 13.4부터 runfile·로컬 repo에서 빠지고 따로 배포. 네트워크 repo에는 `nvidia-gds` 메타패키지 의존성으로 남음 | [S3] | `✓` |
| 직접 경로의 효과 조건 | "일부 시스템에서" PCIe 스위치 경유 직접 경로가 CPU 경유보다 피크 대역폭 최소 2배. 지연 개선은 작은 전송에서 최대 | [S2] | `✓` |
| P2P가 비효율적일 수 있는 경우 | GPU와 NIC가 루트 포트를 공유하지 않을 때 | [S2] | `✓` |
| O_DIRECT 조건 | CUDA 12.2(GDS 1.7) 이후 페이지 정렬 버퍼·크기·오프셋이면 O_DIRECT 아니어도 직접 경로 | [S2] | `✓` |
| 로컬 NVMe P2PDMA | CUDA 12.8부터, `nvidia-fs.ko` 불필요. Linux 6.2+, OpenRM 570+. RAID0·NVMe multipath 미지원 | [S2] | `✓` |
| RAID1/RAID10 | GDS 1.19에서 지원 추가 | [S1] | `✓` |
| 비NVMe 마운트 | 분산 FS·NFS는 `nvidia-fs.ko` 필요. MLNX_OFED/DOCA를 GDS보다 먼저 설치 | [S1][S2] | `✓` |
| 오픈 커널 모듈만 지원 | NVIDIA 오픈 커널 모듈 | [S1][S13] | `✓` |
| 원격 접근은 RDMA 전제 | "GDS는 RDMA 가능한 네트워크와 RDMA 마운트가 필요" | [S31] | `✓` |
| NVMe-oF 표기 | 1.19.1 지원 표에 NVMe-oF 없음. 예전 DOCA 버전에 "NVMeOF is not functional" 메모 | [S1] | `✓` |
| 호환 모드 자동 전환 | 미지원 구성은 CPU 메모리 경유로 전환. 1.19의 `vanilla_posix_mode`는 라이브러리 없을 때 POSIX I/O | [S1][S2] | `✓` |
| 지원 FS 표(1.19.1) | Lustre는 FSx 기준 Lustre 2.15 클라이언트·커널 6.8+, Storage Scale 5.1.2+, VAST 4.1+, DDN EXAScaler 5.2+/6.0+, WekaFS는 CUDA 13.1에서 회귀가 있어 13.3 이상 | [S1] | `✓` |
| cuObject | 가이드 r1.16(2026-01-12), client·server 라이브러리 v1.0.0. 서버 측 라이브러리는 호출당 최대 1 GiB. Versity S3 게이트웨이도 서버 측 구현 | [S4] | `✓`(검색 요약) |
| Storage Scale의 cuObject | 6.0.1이 지원, "GPFS POSIX 성능의 최대 90%" | [S27] | `Ⓥ` |

{{% /details %}}

## 4. SuperPOD 요구치와 인증의 적용 범위

| 항목 | Standard | Enhanced |
|---|---|---|
| SU 1개 합산 읽기 | 80 | 250 |
| SU 1개 합산 쓰기 | 40 | 124 |
| SU 8개 합산 읽기 | 640 | 2000 |
| SU 8개 합산 쓰기 | 320 | 992 |

이 표는 DGX B300 SuperPOD의 HPS(고성능 스토리지) 기준입니다. 단위는 GBps이며 SU는 스케일러블 유닛입니다. 수치는 B300에만 해당하고, DGX B300과 GB300 NVL72는 다른 플랫폼입니다.

SuperPOD는 학습용 HPS와 관리망의 NFS 사용자 스토리지를 나눕니다. HPS는 인증 파트너의 POSIX 파일시스템을 InfiniBand 또는 RoCE로 연결하고, 홈 디렉터리·로그·관리용 공간은 사용자 스토리지에 둡니다. 스토리지 패브릭은 컴퓨트 패브릭과 분리하며 노드당 최소 40 Gbps를 요구합니다.

참조 문서는 체크포인트를 쓰는 동안 학습이 멈추는 동기 작업으로 설명하며, LLM에는 읽기 성능의 절반 이상을 쓰기 성능으로 권장합니다. 기준 수치는 [01]({{< relref "/data/gpu-storage/01-workload-io-patterns/index.md" >}})의 GPU당 요구 대역폭과 함께 봐야 합니다.

리셀러 자료에 따르면 DGX B300의 BlueField-3는 스토리지·관리망을 연결합니다. BlueField는 스토리지 서버 역할도 맡습니다. CMX에서는 BlueField-4가 NVMe-oF 연결을 종단하며, VAST는 BlueField에서 CNode를 실행한다고 설명합니다.

NVIDIA 인증은 Foundation·Enterprise·NCP·DGX SuperPOD 등급으로 나뉩니다. 이 글의 해석으로는 인증 목록은 벤더가 NVIDIA와 검증 절차를 거쳤는지 보여 주며, 기술 적합성의 전부를 말해 주지는 않습니다. 목록에 없는 BeeGFS, DAOS, Hammerspace, 순수 Lustre 커뮤니티판도 그 이유만으로 쓸 수 없는 제품이 되지는 않습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 참조 아키텍처 버전 | DGX B300용 RA-11337-001 V01(2025-05-29 발행, 2025-11-19 갱신), Rubin NVL8용 SP-12834-001 V01(2026-04-20) | [S6][S7] | `✓` |
| HPS와 사용자 스토리지의 구분 | HPS는 인증 파트너의 IB/RoCE POSIX FS, 멀티스레드·RDMA, RAM과 로컬 플래시 투명 캐시. 사용자 스토리지는 관리망 NFS | [S6] | `✓` |
| 스토리지 패브릭 | 컴퓨트 패브릭과 분리, 노드당 스토리지 대역폭 최소 40 Gbps | [S6] | `✓` |
| HPS 성능 기준표 | 표의 GBps 값 그대로. B300 RA storage-architecture 페이지에서만 확인 | [S5] | `✓` |
| 동기 체크포인트 전제 | 체크포인트가 수 TB일 수 있고 동기 작업이라 학습이 멈춤. LLM에는 읽기 성능의 절반 이상을 쓰기 성능으로 권장 | [S5] | `✓` |
| DGX B300의 DPU | 스토리지·관리망용 듀얼포트 BlueField-3 2장(최대 400 Gb/s), 컴퓨트 패브릭은 ConnectX-8 8장 | [S60] | `Ⓥ` |
| 스토리지 서버로서의 BlueField | CMX는 BlueField-4가 NVMe-oF를 종단, VAST는 BlueField에서 CNode 실행 | [S9] / VAST | `✓` / `Ⓥ` |
| 인증 등급 | Foundation(x86 PCIe GPU 256개까지), Enterprise(4,000개까지), NCP(클라우드 사업자, 10만 개 규모), DGX SuperPOD. 목록 갱신 2026-10-19 | [S8] | `✓` |
| SuperPOD 등급 제품 | PowerScale F710, DDN AI400X3, FlashBlade//S500, Storage Scale 3500·6000, AFF A90·AFX 1K, VAST C-Node Gen 6 + BF-3 D-Box, WEKAPod Nitro | [S8] | `✓` |
| Foundation·Enterprise 추가 제품 | Cisco UCS C225 M8 EBOX, Hitachi Vantara HCSF, HPE ClusterStor E2000(Foundation), Nutanix Unified Storage | [S8] | `✓` |
| 오브젝트 Foundation | Cloudian HyperStore Flash 1100, HPE Alletra MP X10000, VAST | [S8] | `✓` |
| 목록에 없는 것 | BeeGFS, DAOS, Hammerspace, 순수 Lustre 커뮤니티판 | [S8] | `✓` |
| 인증의 의미 | 벤더가 NVIDIA와 검증 절차를 거쳤는가이지 기술 적합성의 전부는 아님 | — | `≈` |
| Pure의 사명 | Everpure로 변경(Blocks & Files·StorageReview 표기). NVIDIA 목록에도 Everpure | [S8][S21] | `✓` |

{{% /details %}}

## 확인하지 못한 것

- 벤더 간 같은 조건의 성능 비교. MLPerf v3.0에는 주요 벤더 상당수가 빠져 있고 하드웨어와 노드 수도 달라, 어느 파일시스템이 더 빠르다는 주장을 뒷받침할 수 없다.
- WEKA와 VAST 현행 세대의 단일 노드 처리량. 공개 수치는 DGX A100(2021) 측정이나 랙 단위 수치뿐이다.
- GB300 NVL72와 Vera Rubin 랙의 스토리지 요구 수치. B300 RA의 표만 확인했으며, Rubin NVL8 RA에 같은 표가 있는지는 확인하지 못했다.
- Dell PowerScale 병렬화(pNFS)의 GA 여부. 2025-11 기준 비공개 프리뷰 상태만 확인했다.
- DAOS 2.8의 출시일. 2차 출처에서만 알려져 있다.
- 클라우드 관리형 Lustre의 GDS 직접 경로. 문서로 확인한 서비스는 FSx뿐이다.

## 참고 자료

- [NVIDIA GPUDirect Storage Release Notes](https://docs.nvidia.com/gpudirect-storage/release-notes/index.html) — GDS 1.19.1 버전, 지원 파일시스템 표
- [NVIDIA GPUDirect Storage Overview Guide](https://docs.nvidia.com/gpudirect-storage/overview-guide/index.html) — 원리, 효과 조건, 요구 조건, 호환 모드
- [NVIDIA GPUDirect Storage nvidia-fs](https://docs.nvidia.com/gpudirect-storage/nvidia_fs/index.html) — nvidia-fs 배포 방식
- [NVIDIA cuObject 문서](https://docs.nvidia.com/gpudirect-storage/cuobject) · [서버 release notes](https://docs.nvidia.com/gpudirect-storage/cuobject/cuobject-server-release-notes/index.html) · [Versity S3 RDMA](https://github.com/versity/versitygw/wiki/S3-RDMA) — S3 over RDMA
- [DGX SuperPOD B300 RA, High Performance Storage Architecture](https://docs.nvidia.com/dgx-superpod/reference-architecture/scalable-infrastructure-b300/latest/storage-architecture.html) — HPS 성능 기준표, 동기 체크포인트 전제
- [DGX SuperPOD B300 RA, Key Components](https://docs.nvidia.com/dgx-superpod/reference-architecture/scalable-infrastructure-b300/latest/dgx-superpod-components.html) — HPS와 사용자 스토리지 구분, 스토리지 패브릭
- [DGX SuperPOD Rubin NVL8 RA](https://docs.nvidia.com/dgx-superpod/reference-architecture/scalable-infrastructure-rubinx86/latest/) — 문서 버전과 발행일
- [List of NVIDIA-Certified Storage Systems](https://docs.nvidia.com/certification-programs/certified-storage/latest/systems-list.html) — 인증 등급과 제품 목록
- [NVIDIA 기술 블로그, BlueField-4 CMX](https://developer.nvidia.com/blog/introducing-nvidia-bluefield-4-powered-inference-context-memory-storage-platform-for-the-next-frontier-of-ai/) — BlueField-4의 NVMe-oF 종단
- [NVIDIA GPU Operator, GPUDirect RDMA and GPUDirect Storage](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-operator-rdma.html) — 오픈 커널 모듈 요구
- [DGX B300 사양 (Colfax)](https://www.colfax-intl.com/nvidia/nvidia-dgx-b300) · [서비스 매뉴얼](https://docs.nvidia.com/dgx/dgxb300-service-manual/dgxb300-service-manual.pdf) — BlueField-3·ConnectX-8 구성
- [DeepSeek 3FS README](https://github.com/deepseek-ai/3FS) — 구조와 자체 측정 수치
- [StorageReview, MLPerf Storage v3.0](https://storagereview.com/news/mlperf-storage-v3-0-877-gib-s-checkpoints-a-cloud-first-and-a-leaderboard-turned-over) · [Blocks & Files, MLPerf Storage v3.0](https://www.blocksandfiles.com/ai-ml/2026/09/01/mlperf-storage-benchmark-updated-for-modern-ai/5293617) — FlashBlade//EXA 결과, Pure의 사명 변경
- [OpenSFS LUG 2026 Community Release Update](https://www.opensfs.org/wp-content/uploads/01-Community-Release-Update-LUG-2026-FINAL.pdf) · [Lustre (Wikipedia)](https://en.wikipedia.org/wiki/Lustre_(file_system)) — Lustre 릴리스
- [IBM 블로그, Storage Scale 6.0.1](https://community.ibm.com/community/user/blogs/ulf-troppens/2026/06/10/ibm-storage-scale-601-accelerates-ai-outcomes) · [Blocks & Files, Storage Scale 6.0.0](https://www.blocksandfiles.com/ai-ml/2025/10/20/storage-scale-accelerates-data-for-ai/1615704) — 버전과 cuObject 지원
- [WEKA 문서, 시스템 개요](https://docs.weka.io/weka-system-overview/about) · [WEKA 보도자료, Augmented Memory Grid](https://www.weka.io/news/weka-breaks-the-ai-memory-barrier-with-augmented-memory-grid) — 구조, 제품명
- [VAST KB, NFS Features for Enhanced Performance](https://kb.vastdata.com/documentation/docs/nfs-features-for-enhanced-performance) — nconnect·RDMA·멀티패스 수치, GDS의 RDMA 요구
- [VAST glossary](https://vastdata.com/glossary) · [Cisco VAST on UCS 데이터시트](https://www.cisco.com/c/en/us/solutions/collateral/artificial-intelligence/vast-data-ucs-ds.html) — DASE 구조
- [StorageReview, DDN AI400X3M](https://storagereview.com/news/ddn-launches-ai400x3m-and-dynamo-integrated-kv-cache-acceleration-at-isc-2026) — AI400X3M 수치
- [BeeGFS 8.0 release notes](https://doc.beegfs.io/8.0/release_notes.html) · [BeeGFS 8.2 발표](https://www.beegfs.io/c/thinkparq-launches-beegfs-8-2/) — BeeGFS 버전
- [DAOS (Wikipedia)](https://en.wikipedia.org/wiki/Daos_(software)) · [HPCwire, ALCF Aurora DAOS 800대](https://www.hpcwire.com/bigdatawire/this-just-in/alcf-expands-auroras-daos-storage-to-800-servers/) — DAOS 버전과 확장
- [NetApp 블로그, AFX](https://www.netapp.com/blog/afx-ai-ready-storage-enterprise-ai-innovation/) — AFX 구조와 수치
- [Blocks & Files, Dell PowerScale 병렬화](https://blocksandfiles.com/2025/11/17/dell-powerscale-gets-struck-by-lightning-and-goes-parallel/) — Project Lightning
- [SNIA SDC25 Hammerspace, Activating Tier 0 Storage](https://www.snia.org/sites/default/files/2025-10/SNIA-SDC25-Christofferson-Activating-Tier0-Storage.pdf) — pNFS Flex Files, Tier 0 구성
- [Amazon FSx for Lustre performance](https://docs.aws.amazon.com/fsx/latest/LustreGuide/performance.html) — 메타데이터 IOPS 표, 기본 PFL
- [JuiceFS MLPerf Storage 결과](https://juicefs.com/docs/cloud/benchmark/mlperf_storage) — 캐시를 미리 채운 측정
