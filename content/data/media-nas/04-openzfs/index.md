---
title: "서버 한 대의 NAS부터 대규모 Lustre까지 쓰이는 OpenZFS"
linkTitle: "04 OpenZFS"
description: "OpenZFS는 볼륨 관리와 파일시스템을 합친 스토리지 스택으로, NAS부터 대규모 Lustre의 저장소까지 쓰인다. 실제 도입 규모는 이론 한계와 구분해 실용 권고와 제품별 상한을 기준으로 판단한다."
weight: 4
date: 2026-11-20
lastmod: 2026-11-20
url: "/media-nas/04-openzfs/"
---

# 04 · 서버 한 대의 NAS부터 대규모 Lustre까지 쓰이는 OpenZFS

OpenZFS는 볼륨 관리와 파일시스템을 합친 오픈소스 스토리지 스택입니다. Sun이 Solaris용으로 만든 ZFS에서 출발했고, 2013년부터 Linux와 FreeBSD 개발자 커뮤니티가 함께 유지합니다.

2026년 8월의 2.4.4를 기준으로 기능과 규모, 제품별 쓰임새를 살펴봅니다. 내부 동작은 [05]({{< relref "/data/media-nas/05-openzfs-internals/index.md" >}})에서 다룹니다.

## 한 풀에서 제공하는 OpenZFS 기능 {#what}

그림에서는 디스크를 묶은 풀이 파일시스템과 블록 장치로 이어지는 부분을 보면 됩니다.

{{< flow src="_flow/1-한-풀이-위아래로-내주는-것.json" />}}

OpenZFS는 디스크를 미러, RAIDZ, dRAID로 묶고, 풀 위에 파일시스템(데이터셋)과 블록 장치(zvol)를 필요한 만큼 만듭니다. RAID 컨트롤러, 볼륨 관리자, 파일시스템을 따로 조합하던 일을 한 스택에서 처리하는 구성입니다. 데이터셋은 크기를 미리 정하지 않고 풀 공간을 함께 씁니다.

| 기능 | 제공하는 것 |
|---|---|
| 무결성 | 모든 블록의 체크섬 검증. 중복이 있을 때 자동 복구 |
| 중복 구성 | 미러, 패리티 1~3개의 RAIDZ, 분산 스페어를 가진 dRAID |
| 압축 | 블록 단위 압축(lz4, zstd) |
| 스냅샷·클론 | 즉시 만드는 스냅샷과 쓰기 가능한 클론 |
| 복제 | 바뀐 부분만 보내는 send/receive |
| 데이터셋별 설정 | 쿼터, 압축, 블록 크기를 각각 지정 |
| 선택 기능 | 암호화, 중복 제거, 메타데이터 전용 플래시 vdev |

풀의 범위는 서버 한 대입니다. 여러 노드를 한 저장소로 묶는 기능은 없습니다. 큰 규모의 사례는 모두 Lustre 같은 상위 계층이 노드를 묶고, OpenZFS가 노드별 저장소를 맡는 구성입니다.

## 도입 전에 구분할 이론 한계와 실용 권고 {#limits}

128비트 파일시스템이라는 표현에서 나온 풀 크기 2^128바이트는 주소 체계를 환산한 값입니다. 소스의 크기 필드를 확인해 실제 상한은 16EiB 근처로 봤습니다. 어느 쪽도 현재 하드웨어로 닿을 크기는 아닙니다.

| 항목 | 이론 한계 |
|---|---|
| 파일 하나의 크기 | 2^64바이트 (16EiB) |
| 데이터셋당 파일 수 | 2^48개 |
| 디렉터리당 항목 수 | 2^48개 |
| 파일 이름 | 255바이트. `longname` 기능을 켜면 1,023바이트 |
| 블록 크기(recordsize) | 512바이트~16MiB |
| RAIDZ vdev의 디스크 수 | 최대 255, 패리티 1~3 |
| dRAID vdev의 디스크 수 | 최대 255, 패리티 1~3 |
| 풀의 최상위 vdev 수 | 문서는 제한 없음. 주소 인코딩으로는 2^24개 |
| 스냅샷·데이터셋 수 | 소스에서 고정 상한 확인 못 함. 속성으로 제한 가능 |

실제 설계의 기준은 아래 권고입니다. OpenZFS 자체의 권고와 제품별 권고를 구분해 읽어야 합니다.

| 항목 | 권고 | 출처 |
|---|---|---|
| 빈 공간 | 10% 넘게 유지 | OpenZFS |
| 증설 시점 | 풀이 80%에 이르기 전 | TrueNAS, AWS FSx |
| RAIDZ vdev 폭 | 3~9개. 12개 초과는 권하지 않음 | TrueNAS. OpenZFS는 숫자를 제시하지 않음 |
| dRAID | 디스크 100개 초과에서 권장. 10개 미만이면 RAIDZ | TrueNAS |
| 메모리 | 2GB로도 동작. 8GB 이상 권장, ECC 권장 | OpenZFS FAQ |
| 메모리 산정 | 기본 2GiB에 스토리지 1TiB당 1GiB | Proxmox VE |
| special vdev | 풀의 다른 vdev와 같거나 높은 중복도. 단일 디스크 금지 | OpenZFS |
| 가상 머신 스토리지 | 미러 vdev 권장 | Proxmox VE |
| 피할 것 | 하드웨어 RAID 컨트롤러 위 구성, DM-SMR 디스크 | OpenZFS |

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처 |
|---|---|---|
| 128비트 | "All SPA data is represented by 128-bit data virtual addresses (DVAs)". vdev 번호 24비트, 오프셋 63비트(512바이트 섹터 단위) | spa.h 2.4.4 |
| 풀 크기 2^128바이트 | 주소 체계의 환산값 | Wikipedia |
| 실제 상한 16EiB | 크기 필드가 64비트 바이트라는 소스 판독에서 나온 이 글의 추론. 공식 문서가 이렇게 정리한 곳은 없음 | 소스 판독 |
| 파일 크기 | `DN_MAX_OFFSET_SHIFT` 64 | dnode.h |
| 데이터셋당 파일 수 | `DN_MAX_OBJECT_SHIFT` 48. Wikipedia는 무제한으로 적지만 소스는 2^48 | dnode.h |
| 파일 이름 | `ZAP_MAXNAMELEN` 256, `longname` 사용 시 1,024 | fs/zfs.h, zpool-features(7) |
| recordsize | 최대 16MiB. 128KiB를 넘기려면 `large_blocks` 기능 필요 | fs/zfs.h, zfsprops(7) |
| RAIDZ 폭 | 255 | zpool_vdev.c, vdev_raidz.c |
| dRAID 폭 | `VDEV_DRAID_MAX_CHILDREN` 255 | fs/zfs.h |
| 스냅샷·데이터셋 수 | `snapshot_limit`, `filesystem_limit` 속성. 기본 none | zfsprops(7) |
| 빈 공간 | "Keep pool free space above 10%" | OpenZFS Workload Tuning |
| 80% | "add more capacity before a pool reaches 80%" | TrueNAS ZFS Primer |
| RAIDZ 폭 권고 | "recommended number of disks per vdev is between 3 and 9", "We do not recommend using more than 12 disks per vdev" | TrueNAS ZFS Primer |
| RAIDZ 폭(OpenZFS) | "optimize … on exact numbers is irrelevant in nearly all cases" | OpenZFS Workload Tuning |
| dRAID 권고 | 디스크 100개 초과에서 권장 | TrueNAS dRAID Primer |
| 메모리 | "8GB+ … for the best performance. It's perfectly possible to run with 2GB or less" | OpenZFS FAQ |
| Proxmox 메모리 | "2 GiB Base + 1 GiB/TiB-Storage" | Proxmox VE ZFS on Linux |
| 하드웨어 RAID | "Hardware RAID controllers should not be used with ZFS" | OpenZFS Hardware |
| SMR | "DM-SMR drives are therefore not recommended for ZFS pools" | OpenZFS Hardware |

{{< /details >}}

## 서버 한 대와 여러 풀의 공개 운영 규모 {#scale}

공개된 운영 사례와 제품 상한을 비교할 때는 수치가 가리키는 범위부터 확인합니다. Orion의 수치는 수백 개 풀을 Lustre가 묶은 합계입니다. 풀 하나의 성능으로 볼 수는 없습니다.

| 사례·제품 | 규모 | 구성 |
|---|---|---|
| ORNL Orion (Frontier의 스토리지) | 용량 계층 약 679PB, 읽기 5.5TB/s·쓰기 4.6TB/s | Lustre + ZFS 2.1.7 dRAID. 서버 450대, HDD 47,700개 |
| LLNL Grove (Sequoia의 스토리지) | 목표 55PB, 초당 1TB 전송 | Lustre + ZFS |
| TrueNAS V-Series | 최대 40PB, 400Gb/s | 듀얼 컨트롤러 어플라이언스 한 대. 벤더 수치 |
| QNAP QuTS hero | 풀 하나 최대 5PB | NAS 한 대. 벤더가 이론 최대라고 표기 |
| AWS FSx for OpenZFS | 파일시스템당 최대 512TiB, 디스크에서 10GB/s·400,000 IOPS | 관리형 파일 서버 한 대. AWS 공개 수치 |

백업 사업자도 OpenZFS를 씁니다. Datto는 자사 클라우드의 백업 저장소로 ZFS를 골랐다고 밝혔고, rsync.net은 모든 계정이 ZFS에서 동작한다고 밝혔습니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처 |
|---|---|---|
| Orion 구성 | "Backend file system for MDTs/OSTs is ZFS v2.1.7", "Redundancy is handled using ZFS dRAID". HDD OST 667.6PB(47,700개), NVMe OST 11.4PB(5,400개), OSS 450대 | Lustre User Group 2023 발표 |
| Orion 성능 | "679 PB at peak read speeds of 5.5 TB/s and peak write speeds of 4.6 TB/s" | OLCF Orion 페이지 |
| Grove | "facilitated 1 terabyte per second of data transfer with the Grove file system". 목표 55PB | LLNL OpenZFS 프로젝트 페이지, LUG 2012 발표 |
| TrueNAS V-Series | "up to 40 PB and 400 Gb/s". 측정 조건 미공개 | TrueNAS Enterprise 페이지 |
| QuTS hero | 풀·볼륨·공유 폴더 최대 5PB, 스냅샷 65,536개. "theoretical maximums" | QNAP FAQ |
| FSx 용량 | 64GiB~512TiB. 증설 요청 가능 | AWS FSx for OpenZFS 문서 |
| FSx 성능 | 처리량 최대 10,240MB/s, 디스크 400,000 IOPS, 캐시에서 21,000MB/s. Multi-AZ 쓰기는 7,500MB/s | AWS FSx for OpenZFS 문서 |
| Datto | "Datto selected ZFS … for backup storage in the Datto Cloud" | Datto 블로그 2021 |
| rsync.net | "every account at rsync.net runs on our ZFS platform" | rsync.net |

- LLNL El Capitan의 Lustre(359PiB)가 ZFS 위에 있는지는 확인하지 못했다
- Datto는 다른 글에서 클라우드 규모를 약 1.6EB로 적었다. 그 전부가 ZFS라고 밝힌 문장은 없다

{{< /details >}}

## 제품과 서비스로 만나는 OpenZFS {#products}

OpenZFS는 직접 설치하기보다 이를 사용하는 제품으로 만나는 경우가 많습니다. NAS부터 가상화 호스트, 관리형 파일 서비스까지 제품에 따라 맡는 범위가 달라집니다.

| 제품·서비스 | 형태 | OpenZFS의 자리 |
|---|---|---|
| TrueNAS | NAS 운영체제와 어플라이언스 | 저장소 전체. Enterprise는 듀얼 컨트롤러 HA |
| QNAP QuTS hero | NAS 운영체제 | 저장소 전체. 인라인 중복 제거는 메모리 16GB 이상 |
| Proxmox VE | 가상화 플랫폼 | 호스트의 로컬 스토리지. 노드 간 복제는 ZFS에서만 지원 |
| AWS FSx for OpenZFS | 관리형 파일 서비스 | NFS로 내주는 파일 서버. 스냅샷, 클론, 압축, 복제 제공 |
| FreeBSD | 운영체제 | 13.0부터 기본 ZFS 구현 |
| Ubuntu | 운영체제 | 커널 패키지에 모듈 포함. 설치기의 루트 ZFS는 실험 단계 |
| Unraid | NAS 운영체제 | 6.12부터 ZFS 풀 지원 |
| Lustre | 병렬 파일시스템 | 서버별 저장 백엔드 |
| Incus, Docker | 컨테이너 런타임 | 이미지와 컨테이너를 스냅샷·클론으로 관리하는 드라이버 |
| OpenEBS ZFS LocalPV, democratic-csi | Kubernetes 스토리지 | 노드 로컬 볼륨, TrueNAS 연동 볼륨 |

AWS FSx for OpenZFS의 프로토콜은 NFS v3부터 v4.2까지이며, SMB는 지원 목록에 없습니다. 파일시스템당 상한은 볼륨 100개, 스냅샷 700개입니다.

Oracle ZFS Storage Appliance는 OpenZFS가 아닙니다. 2010년 이후 Oracle 안에서 따로 발전한 계열로, 풀 형식도 호환되지 않습니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처 |
|---|---|---|
| TrueNAS Enterprise | "dual controller support", "Automated rapid failover" | TrueNAS Enterprise 페이지 |
| QuTS hero dedup | 인라인 블록 중복 제거에 메모리 16GB 이상 | QNAP 문서 |
| Proxmox 복제 | "ZFS (local)"만 지원. 주기는 최소 1분, 기본 15분 | Proxmox VE Storage Replication |
| Proxmox와 하드웨어 RAID | "Do not use ZFS on top of a hardware RAID controller which has its own cache management" | Proxmox VE ZFS on Linux |
| FSx 프로토콜 | NFS v3, v4.0, v4.1, v4.2 | AWS FSx for OpenZFS 문서 |
| FSx 배포 유형 | Multi-AZ(HA), Single-AZ(HA), Single-AZ(non-HA). HA 전환은 보통 60초 안 | 같은 문서 |
| FSx 상한 | 볼륨 100개, 스냅샷 700개 | 같은 문서 |
| FreeBSD | "The ZFS implementation is now provided by OpenZFS." | FreeBSD 13.0 릴리스 노트 |
| Ubuntu | zsys는 22.04 주기에 설치기에서 빠짐 | Launchpad 버그 1968150 |
| Docker zfs 드라이버 | "not recommended … for production use unless you have substantial experience with ZFS on Linux" | Docker 문서 |
| OpenEBS ZFS LocalPV | "Data is not replicated across nodes" | 프로젝트 README |

- Unraid와 Ubuntu 26.04 설치기의 상태는 2차 자료로 확인했다
- FSx가 쓰는 OpenZFS 버전은 문서에 없다

{{< /details >}}

## 용도에 따라 고르는 OpenZFS 기능 {#usecases}

| 사용 사례 | OpenZFS를 고르는 이유 | 주의할 점 |
|---|---|---|
| NAS·파일 서버 | 자동 복구, 압축, 스냅샷, 쿼터 | 풀을 80~90% 아래로 유지 |
| 가상화 호스트 | zvol, 스냅샷, 노드 간 증분 복제 | 미러 권장. RAIDZ는 작은 블록에서 공간과 IOPS 손해 |
| 백업 저장소·원격 복제 | 증분 send/receive, 바꿀 수 없는 스냅샷 | 복제는 비동기. 마지막 동기화 뒤의 데이터는 빠질 수 있음 |
| HPC 병렬 파일시스템의 백엔드 | 압축, dRAID의 빠른 재구성 | 노드를 묶는 일은 Lustre가 맡음 |
| 데이터베이스 | 원자적 기록, 압축 | 블록 크기를 DB에 맞춤. PostgreSQL 32K, InnoDB 16K 권고 |
| 컨테이너·개발 환경 | 클론으로 즉시 복제 | Docker 드라이버는 경험자에게만 권장 |
| 미디어 제작·아카이브 | 큰 블록(1M), 순차 대역폭, 대용량 | 작은 파일이 많으면 special vdev 검토 |
| 운영체제 루트 | 스냅샷으로 업데이트 되돌리기 | 배포판마다 지원 수준이 다름 |
| 홈랩 | 저가 하드웨어에서도 무결성 확보 | 8GB 이상 권장. DM-SMR 디스크는 피함 |

미디어 제작에 TrueNAS를 적용한 구성은 이 분류의 [01]({{< relref "/data/media-nas/01-truenas-performance-range/index.md" >}})과 [02]({{< relref "/data/media-nas/02-1pb-flash-hdd-split/index.md" >}})에서 다룹니다.

## OpenZFS와 맞지 않는 운영 환경 {#not-fit}

| 도입 조건 | 제약 |
|---|---|
| 여러 노드를 한 저장소로 확장 | 클러스터 기능 없음. 공유 디스크 장애 조치에서 이중 import를 막는 기능만 제공 |
| 풀 용량 축소 | RAIDZ나 dRAID vdev가 있으면 어떤 최상위 vdev도 제거 불가. 2.3부터 RAIDZ vdev에 디스크를 추가하는 확장은 가능 |
| 하드웨어 RAID 컨트롤러 유지 | 디스크를 직접 보여 주는 HBA 권고 |
| DM-SMR 디스크 사용 | 리실버와 스크럽 시 정체 |
| 메모리가 작은 장비 | 중복 제거를 켜려는 구성에 부적합 |
| 커널 모듈 관리가 부담인 환경 | Linux 커널 밖 모듈로 배포. 새 커널은 OpenZFS가 지원할 때까지 대기 |

## 도입 전에 확인할 버전과 라이선스 {#version}

현행 버전은 2.4.4(2026-08-21)입니다. 2.3.9와 장기 지원 계열인 2.2.11도 함께 유지됩니다. 2.4.4가 지원하는 Linux 커널 범위는 4.18부터 7.2까지입니다.

CDDL 라이선스 때문에 Linux 커널에는 포함되지 않고 모듈로 배포됩니다. Ubuntu는 커널 패키지에 모듈을 넣어 제공하며, Debian과 RHEL 계열은 별도 패키지로 설치합니다. 풀의 기능 플래그는 한 번 켜면 끌 수 없습니다. 버전을 올린 뒤 풀을 업그레이드할 때는 되돌아갈 일이 없는지 먼저 확인합니다.

버전별 기능과 계보, 디스크 구조는 [05]({{< relref "/data/media-nas/05-openzfs-internals/index.md" >}})에 있습니다.

## 확인하지 못한 것 {#unverified}

- 서버 한 대의 NVMe 풀로 측정한 공개 벤치마크 가운데 상한으로 인용할 만한 값
- OpenZFS 개발자 서밋에서 발표된 대형 배포 사례
- CERN, Fermilab 같은 연구 기관의 운영 수치
- AWS FSx for OpenZFS가 쓰는 OpenZFS 버전
- 스냅샷 수에 관한 OpenZFS의 공식 권고. 제품별 상한(QuTS hero 65,536개, FSx 700개)만 확인했다

## 참고 자료 {#references}

- [OpenZFS 2.4.4 spa.h](https://github.com/openzfs/zfs/blob/zfs-2.4.4/include/sys/spa.h)
- [OpenZFS 2.4.4 dnode.h](https://github.com/openzfs/zfs/blob/zfs-2.4.4/include/sys/dnode.h)
- [OpenZFS Workload Tuning](https://openzfs.github.io/openzfs-docs/Performance%20and%20Tuning/Workload%20Tuning.html)
- [OpenZFS Hardware 문서](https://openzfs.github.io/openzfs-docs/Performance%20and%20Tuning/Hardware.html)
- [OpenZFS FAQ](https://openzfs.github.io/openzfs-docs/Project%20and%20Community/FAQ.html)
- [OpenZFS License 문서](https://openzfs.github.io/openzfs-docs/License.html)
- [TrueNAS ZFS Primer](https://www.truenas.com/docs/references/zfsprimer/)
- [TrueNAS dRAID Primer](https://www.truenas.com/docs/references/draidprimer/)
- [TrueNAS Enterprise](https://www.truenas.com/truenas-enterprise/)
- [Proxmox VE, ZFS on Linux](https://pve.proxmox.com/wiki/ZFS_on_Linux)
- [Proxmox VE Storage Replication](https://pve.proxmox.com/pve-docs/chapter-pvesr.html)
- [AWS FSx for OpenZFS 할당량](https://docs.aws.amazon.com/fsx/latest/OpenZFSGuide/limits.html)
- [AWS FSx for OpenZFS 성능](https://docs.aws.amazon.com/fsx/latest/OpenZFSGuide/performance.html)
- [QNAP 운영체제별 최대 용량과 한계](https://www.qnap.com/en/how-to/faq/article/what-are-the-maximum-storage-capacities-and-limits-for-qnap-nas-operating-systems)
- [ORNL Orion, Lustre User Group 2023](https://www.opensfs.org/wp-content/uploads/LUG23_Orion_v3.pdf)
- [OLCF Orion](https://www.olcf.ornl.gov/olcf-resources/data-visualization-resources/orion/)
- [LLNL OpenZFS 프로젝트](https://computing.llnl.gov/projects/openzfs)
- [Datto, What Is Immutable Cloud Storage](https://www.datto.com/blog/what-is-immutable-cloud-storage)
- [rsync.net ZFS](https://rsync.net/products/zfs.html)
- [FreeBSD 13.0 릴리스 노트](https://www.freebsd.org/releases/13.0R/relnotes/)
- [Docker zfs 스토리지 드라이버](https://docs.docker.com/engine/storage/drivers/zfs-driver/)
- [OpenEBS ZFS LocalPV](https://github.com/openebs/zfs-localpv)
- [Wikipedia, ZFS](https://en.wikipedia.org/wiki/ZFS)
