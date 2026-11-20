---
title: "느린 디스크 앞에 메모리 계층을 둔 ZFS와 TrueNAS"
linkTitle: "03 ZFS와 TrueNAS 구조"
description: "ZFS는 쓰기를 메모리에 모아 디스크에 내리고, 읽을 블록은 ARC에서 먼저 찾는다. OpenZFS 2.3.9 기본값과 함께 SLOG·L2ARC·special vdev의 자리와 TrueNAS의 공유 서비스·듀얼 컨트롤러 HA를 설명한다."
weight: 3
date: 2026-11-18
lastmod: 2026-11-18
url: "/media-nas/03-zfs-truenas-architecture/"
---

# 03 · 느린 디스크 앞에 메모리 계층을 둔 ZFS와 TrueNAS

HDD 풀이 영상 편집을 받아낼 수 있는 이유는 ZFS가 디스크 앞에 메모리 계층을 두기 때문입니다. 쓰기는 메모리에 모았다가 묶어서 디스크에 내리고, 읽기는 메모리 캐시부터 찾습니다.

[01]({{< relref "/data/media-nas/01-truenas-performance-range/index.md" >}})과 [02]({{< relref "/data/media-nas/02-1pb-flash-hdd-split/index.md" >}})에서 쓴 ARC, SLOG, L2ARC, special vdev도 이 경로 안에 있습니다. 기준은 TrueNAS 25.10.8과 그 안의 OpenZFS 2.3.9입니다. 기본값은 man 페이지와 소스에서 확인했습니다. 디스크에 블록이 놓이는 구조와 스냅샷, RAIDZ의 공간 계산은 [05]({{< relref "/data/media-nas/05-openzfs-internals/index.md" >}})에서 다룹니다.

## 쓰기 버퍼와 ARC 아래의 ZFS 풀 {#layers}

그림에서는 메모리 안의 쓰기 버퍼와 읽기 캐시, 그 아래의 풀을 구분해 보면 됩니다.

{{< flow src="_flow/1-메모리가-디스크-앞에-선다.json" />}}

비동기 쓰기는 dirty 버퍼에 기록되면 완료 응답을 돌려주고, 디스크에는 나중에 묶어서 씁니다. 읽기는 메모리 캐시인 ARC를 먼저 확인합니다. 찾는 블록이 ARC에 없으면 풀의 데이터 vdev나 special vdev에서 읽습니다.

풀은 최상위 vdev의 모음이고, 각 vdev 아래에 디스크가 있습니다. 데이터는 최상위 vdev 전체에 나뉘지만 중복은 vdev 안에서만 정해집니다. 미러 vdev는 디스크 한 대만 남아도 버티고, RAIDZ2 vdev는 두 대까지 잃어도 버팁니다. 어느 vdev든 허용 범위를 넘는 디스크를 잃으면 풀 전체를 잃습니다.

보조 vdev는 담는 내용에 따라 잃었을 때의 영향도 다릅니다.

| vdev 종류 | 담는 것 | 잃었을 때 |
|---|---|---|
| 데이터 vdev | 파일 블록 전부 | 풀 손실 |
| special | 메타데이터, 간접 블록. 설정하면 작은 블록도 | 풀 손실. 데이터 vdev와 같은 중복 권장 |
| log (SLOG) | 동기 쓰기의 기록(ZIL) | 풀은 유지. 미러 가능, RAIDZ 불가 |
| cache (L2ARC) | ARC 블록의 복사본 | 영향 없음. 풀에서 다시 읽음 |
| spare | 핫 스페어 | 영향 없음 |

풀 위의 파일시스템인 데이터셋에서는 recordsize로 파일을 나누는 블록 크기를 정합니다. 영상처럼 순차로 읽고 쓰는 데이터에는 1M을 권합니다. 변경한 값은 이후에 만든 파일에만 적용됩니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처 |
|---|---|---|
| 데이터 분산 | "Data is dynamically distributed across all top-level devices" | OpenZFS zpoolconcepts(7) 2.3 |
| special이 담는 것 | 메타데이터, 사용자 데이터의 간접 블록, 중복 제거 테이블 | 같은 문서 |
| log 장치 | 미러 가능, RAIDZ 불가 | 같은 문서 |
| cache 장치 | 미러·RAIDZ 불가. 읽기 오류 시 풀 장치에서 다시 읽음 | 같은 문서 |
| 풀 손실 조건 | vdev가 허용하는 수를 넘는 디스크 장애 | TrueNAS ZFS Primer |
| recordsize | 기본 128KiB, 순차 워크로드에 1M 권장, 최대 16MiB | OpenZFS Workload Tuning, zfsprops(7) |

{{< /details >}}

## 트랜잭션 그룹으로 묶어 기록하는 쓰기 {#write-path}

ZFS는 변경을 메모리에 모아 트랜잭션 그룹(txg)이라는 묶음으로 디스크에 씁니다. 그림에서는 비동기 쓰기의 응답이 돌아간 뒤에도 디스크 기록이 남아 있다는 점을 보면 됩니다.

{{< seq src="_seq/2-쓰기는-메모리에서-응답한다.json" />}}

새 쓰기는 open 상태의 트랜잭션 그룹에 들어갑니다. 이 묶음은 quiescing에서 진행 중인 쓰기가 끝나기를 기다렸다가 syncing으로 넘어가 디스크에 기록됩니다. 그때 다음 묶음이 open이 되어 새 쓰기를 계속 받습니다.

기록 주기가 지났거나 dirty 데이터가 한도의 정해진 비율에 이르면, 먼저 충족된 조건에 따라 디스크에 내립니다. 기존 블록을 덮어쓰지 않고 새 자리에 쓰는 copy-on-write 방식입니다. syncing 마지막에 블록 트리의 뿌리인 uberblock을 기록해야 묶음이 반영되며, 뿌리를 바꾸는 이 방식 덕분에 전부 반영되거나 전혀 반영되지 않습니다.

모든 블록 포인터는 자식 블록의 체크섬을 담습니다. 읽을 때마다 부모가 가진 체크섬으로 검증하고, 맞지 않으면 미러나 패리티로 복구합니다.

### dirty 버퍼가 차오를 때의 쓰기 지연

디스크가 받아내는 속도보다 쓰기가 빨리 들어오면 dirty 버퍼가 차오릅니다. 그림에서는 버퍼가 차면서 새 쓰기에 지연이 붙는 과정을 따라가면 됩니다.

{{< lane src="_lane/2-dirty-버퍼가-차오를-때.json" />}}

ZFS는 버퍼가 한도의 일정 비율을 넘으면 쓰기마다 지연을 붙이고, 가득 찰수록 지연을 급격히 늘립니다. 인제스트나 렌더 출력처럼 큰 쓰기가 이어지면 HDD 풀의 처리 속도는 디스크 속도로 내려갑니다. 메모리는 잠깐 몰리는 쓰기를 받아낼 뿐, 지속 쓰기 속도를 높이지는 않습니다.

### 응답 전에 기록하는 ZIL과 SLOG

프로그램이 "디스크에 기록된 것을 확인하고 응답하라"고 요구하면 동기 쓰기입니다. ZFS는 ZIL(intent log)에 먼저 기록한 뒤 응답합니다. 별도 log 장치인 SLOG가 있으면 거기에, 없으면 풀 안에 ZIL을 둡니다. 데이터는 여전히 dirty 버퍼와 트랜잭션 그룹을 거쳐 기록되고, ZIL은 장애 뒤 풀을 다시 열 때만 읽습니다.

SMB 쓰기는 기본적으로 비동기입니다. TrueNAS 25.10.8은 Samba의 `strict sync` 기본값(yes)을 그대로 쓰므로 클라이언트가 FLUSH를 보낼 때만 ZIL에 기록합니다. NFS에서도 클라이언트가 COMMIT을 보내면 같은 일이 일어납니다. 편집 프로그램이 저장이나 렌더 중에 FLUSH를 얼마나 보내는지는 확인하지 못했습니다.

정전이 나면 아직 디스크에 내려가지 않은 비동기 쓰기 묶음은 사라지지만, 풀은 마지막으로 기록된 uberblock 시점의 일관된 상태로 남습니다. 기록 주기가 5초이므로 손실 범위를 마지막 몇 초로 볼 수 있지만, 이 범위를 초 단위로 명시한 공식 문장은 찾지 못했습니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 기본값 | 출처 |
|---|---|---|
| `zfs_txg_timeout` | 5초 | OpenZFS zfs(4) 2.3.9 |
| `zfs_dirty_data_max` | RAM의 10%, `zfs_dirty_data_max_max`로 상한 | 같은 문서 |
| `zfs_dirty_data_max_max` | RAM의 25%와 4GiB 중 작은 값 | zfs(4), arc.c 소스. 2.4.4와 TrueNAS 25.10.8 포크도 같음 |
| `zfs_dirty_data_sync_percent` | 20% | zfs(4) |
| `zfs_delay_min_dirty_percent` | 60% | zfs(4) |
| dirty 버퍼의 한도와 지연 | RAM 40GiB 초과 시 한도 4GiB. 한도의 60%를 넘으면 쓰기마다 지연, 100%에 가까워질수록 지연 급증 | zfs(4), 기본값에 따른 계산 |
| 디스크당 비동기 쓰기 동시성 | dirty 30~60% 구간에서 2개에서 10개로 증가 | zfs(4) |
| txg 세 상태 | open, quiescing, syncing | txg.c 소스 주석 |
| 블록 체크섬 | 블록 포인터가 256비트 체크섬을 담음. 기본 알고리즘 fletcher4 | spa.h 소스, zfsprops(7) |
| `sync` 속성 | 기본 standard | zfsprops(7) |
| Samba `strict sync` | 기본 yes. TrueNAS 25.10.8은 값을 따로 설정하지 않음 | smb.conf(5), TrueNAS middleware 소스 |
| NFS exports | 기본 sync | exports(5) |
| 256GiB 예시 | 4GiB의 20%는 약 819MiB, 60%는 약 2.4GiB | 계산 |

- TrueNAS autotune을 실행하면 M-Series 하드웨어에서 `zfs_dirty_data_max_max`를 12GiB로 올린다. 실행했을 때만 적용된다
- OpenZFS 2.4에서는 SLOG가 없고 special vdev가 있으면 special vdev가 ZIL을 받는다

{{< /details >}}

## 디스크보다 먼저 확인하는 ARC {#read-path}

ARC는 최근에 한 번 읽은 블록(MRU)과 여러 번 읽은 블록(MFU)을 따로 관리합니다. 밀려난 블록의 헤더를 남겨 두고, 그 블록을 다시 찾으면 두 목록의 비율을 조정합니다. 한 번 훑는 읽기가 자주 쓰는 블록을 밀어내지 않게 하는 장치입니다.

영상 재생에서는 프리페치가 더 중요합니다. ZFS는 순차 읽기를 알아채면 아직 요청받지 않은 뒤쪽 블록을 ARC에 미리 올립니다. 미리 읽는 거리는 요청 크기에서 시작해 읽을 때마다 두 배로 늘어 4MiB에 이르고, 이후에는 필요할 때만 늘어 스트림당 최대 64MiB까지 갑니다. 이 선행 읽기 덕분에 HDD의 탐색 지연이 재생 중에 드러나지 않습니다.

ARC 뒤에 붙는 L2ARC는 랜덤 읽기 가속을 위한 플래시 캐시입니다. 별도 스레드가 곧 밀려날 블록을 주기적으로 훑어 미리 복사하며, ARC에서 밀려난 블록을 넘겨받지는 않습니다. 기본 설정은 프리페치로 읽고 실제로 쓰이지 않은 블록을 복사하지 않으며 복사 속도도 제한합니다. 순차 영상 스트림이 기본 설정에서 거의 담기지 않는 이유입니다.

special vdev는 풀의 일부여서 메타데이터와 간접 블록을 처음부터 플래시에 기록합니다. `special_small_blocks`를 설정하면 그 크기 이하의 블록도 받습니다. 여유 공간이 25% 아래로 내려가면 작은 블록은 더 받지 않고 남은 자리를 메타데이터용으로 둡니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 기본값 | 출처 |
|---|---|---|
| `zfetch_min_distance` | 4MiB | zfs(4) |
| `zfetch_max_distance` | 스트림당 64MiB | zfs(4) |
| `zfetch_max_streams` | 파일당 8 | zfs(4) |
| L2ARC 공급 방식 | "There is no eviction path from the ARC to the L2ARC" | arc.c 소스 주석 |
| `l2arc_write_max` | 주기당 32MiB, 주기 1초 | zfs(4) |
| `l2arc_noprefetch` | 1 | zfs(4) |
| `zfs_special_class_metadata_reserve_pct` | 25% | zfs(4) |
| 압축 ARC | 켜짐. 디스크의 압축 형태 그대로 보관 | arc.c 소스 |

{{< /details >}}

## 용량보다 워크로드에 맞추는 RAM {#memory}

RAM을 늘려도 기본 쓰기 버퍼는 풀당 4GiB를 넘지 않으며, 지속 쓰기 속도도 오르지 않습니다. 늘어난 RAM은 대부분 ARC가 씁니다. 여러 편집자가 같은 소재를 반복해서 읽으면 디스크를 거치지 않고, 메타데이터가 ARC에 남아 있으면 폴더 탐색과 파일 열기에서도 디스크 탐색이 사라집니다.

OpenZFS 2.2까지 Linux의 ARC 상한은 메모리의 절반이었지만, 2.3부터는 메모리가 큰 서버에서 거의 전부를 씁니다. 다른 프로그램이 메모리를 요구하면 ARC가 줄어듭니다. 스크럽과 리실버도 메타데이터를 메모리에서 정렬한 뒤 순차로 읽으며, 여기에 RAM의 최대 1/20을 씁니다.

필요한 RAM은 풀 용량보다 워크로드에 달려 있습니다. TrueNAS 하드웨어 가이드는 가상 머신을 받는 20TB 풀이 보관용 200TB 풀보다 RAM을 더 요구할 수 있다고 적습니다. 현재 가이드에는 "1TB당 1GB"라는 통설이 없습니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 기본값 | 출처 |
|---|---|---|
| `zfs_arc_max` | 0이면 자동. "전체 메모리 − 1GiB"와 5/8 중 큰 값 | zfs(4) 2.3.9, arc_os.c 소스 |
| 2.2.9의 ARC 상한 | 메모리의 절반 | arc_os.c 2.2.9 소스 |
| RAM 권장 | 최소 8GB, 드라이브 8대 초과 시 대당 1GB 추가 | TrueNAS 하드웨어 가이드 |
| 스크럽 정렬 메모리 | RAM의 1/20 | zfs(4) `zfs_scan_mem_lim_fact` |

- OpenZFS Workload Tuning 문서에는 "Linux에서 ARC는 메모리의 절반"이라는 2.3 이전 문장이 남아 있다
- TrueNAS는 VM을 시작할 때만 `zfs_arc_max`를 낮춘다

{{< /details >}}

## ZFS 풀 위에서 공유 서비스를 제공하는 TrueNAS {#truenas}

TrueNAS 25.10은 Debian 12 기반 Linux에 OpenZFS 커널 모듈을 올린 운영체제이며, 커널은 6.12 LTS입니다. 공유 프로토콜마다 구현이 다릅니다.

| 프로토콜 | 구현 | 특징 |
|---|---|---|
| SMB | Samba smbd | 클라이언트 세션마다 프로세스 하나 |
| NFS | 커널 nfsd | NFS over RDMA는 Enterprise 전용 |
| iSCSI | SCST | |
| NVMe-oF | nvmet 서비스 | NVMe/TCP는 Community, NVMe/RDMA는 Enterprise |

middlewared가 설정 데이터베이스와 API, 웹 UI를 맡고 smb.conf나 exports 같은 설정 파일을 만듭니다. 관리자는 이 파일들을 직접 고치지 않습니다.

Enterprise 하드웨어의 듀얼 컨트롤러는 같은 디스크에 연결됩니다. 그림에서는 디스크 연결과 실제로 풀을 사용하는 주체를 구분해 보면 됩니다.

{{< flow src="_flow/5-컨트롤러-둘과-풀-하나.json" />}}

ZFS 풀은 한 번에 한 시스템만 열 수 있어 HA는 active/standby로 동작합니다. 두 대의 자원을 합쳐 쓰지 않으므로 데이터시트의 CPU와 RAM, 포트 수는 컨트롤러 한 대 기준으로 읽어야 합니다.

active 쪽에 장애가 나면 keepalived가 이를 알리고, standby는 디스크에 예약을 걸어 이전 컨트롤러의 쓰기를 막습니다. 이어 가상 IP를 가져오고 풀을 import한 뒤 SMB, NFS, iSCSI 서비스를 켭니다.

편집자 쪽에서는 같은 주소로 다시 연결되며, 25.10에서는 SMB 세션이 끊겼다 다시 맺어집니다. TrueNAS 27은 Enterprise에서 세션 상태를 유지하는 SMB failover를 넣는다고 발표했습니다. 전환에 걸리는 시간의 공식 수치는 찾지 못했습니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처 |
|---|---|---|
| 베이스 | Debian 12 bookworm, 커널 6.12.113 | scale-build 매니페스트, 25.10 버전 노트 |
| OpenZFS | 25.10.7에서 2.3.4에서 2.3.9로 갱신. 디스크 포맷 변경 없음 | 25.10 버전 노트 |
| smbd | "Each client gets a copy of the server for each session" | smbd(8) |
| NVMe-oF | "NVMe/TCP for Community Edition and NVMe/RDMA for Enterprise" | 25.10 버전 노트 |
| HA 방식 | active/standby, 디스크마다 두 컨트롤러에 연결 | TrueNAS 블로그 2015 |
| failover 순서 | VRRP 이벤트, fenced 디스크 예약, VIP 인수, 풀 import, 서비스 활성화 | middleware 25.10.8 failover 소스 |
| failover 개선 | 25.10.6에서 원격 디스크 스캔을 전환 경로 밖으로 이동 | 25.10 버전 노트 |
| SMB 상태 유지 failover | TrueNAS 27 RC.1에서 Enterprise용으로 도입 | 27 버전 노트 |

{{< /details >}}

## 확인하지 못한 것 {#unverified}

- 비동기 쓰기가 정전으로 잃는 범위를 초 단위로 적은 공식 문장
- TrueNAS 25.10 HA 전환에 걸리는 시간의 공식 수치
- 디스크가 두 컨트롤러에 이중 연결된다는 설명의 25.10 공식 문서. 2015년 블로그와 디스크 예약 코드로만 확인했다
- Final Cut, Premiere 같은 편집 프로그램이 FLUSH를 보내는 빈도
- special vdev를 잃으면 풀을 잃는다고 적은 공식 문장. man 페이지는 중복을 데이터 vdev에 맞추라고만 적는다

## 참고 자료 {#references}

- [OpenZFS zpoolconcepts(7) 2.3](https://openzfs.github.io/openzfs-docs/man/v2.3/7/zpoolconcepts.7.html)
- [OpenZFS zfsprops(7) 2.3](https://openzfs.github.io/openzfs-docs/man/v2.3/7/zfsprops.7.html)
- [OpenZFS zfs(4) 2.3](https://openzfs.github.io/openzfs-docs/man/v2.3/4/zfs.4.html)
- [OpenZFS Workload Tuning](https://openzfs.github.io/openzfs-docs/Performance%20and%20Tuning/Workload%20Tuning.html)
- [OpenZFS 2.3.9 txg.c](https://github.com/openzfs/zfs/blob/zfs-2.3.9/module/zfs/txg.c)
- [OpenZFS 2.3.9 arc.c](https://github.com/openzfs/zfs/blob/zfs-2.3.9/module/zfs/arc.c)
- [OpenZFS 2.3.9 dmu_zfetch.c](https://github.com/openzfs/zfs/blob/zfs-2.3.9/module/zfs/dmu_zfetch.c)
- [TrueNAS ZFS Primer](https://www.truenas.com/docs/references/zfsprimer/)
- [TrueNAS SLOG 레퍼런스](https://www.truenas.com/docs/references/slog/)
- [TrueNAS 하드웨어 가이드](https://www.truenas.com/docs/scale/gettingstarted/tnhardwareguide/)
- [TrueNAS 25.10 버전 노트](https://www.truenas.com/docs/scale/25.10/gettingstarted/versionnotes/)
- [TrueNAS 27 버전 노트](https://www.truenas.com/docs/scale/27/gettingstarted/versionnotes/)
- [TrueNAS middleware 25.10.8 failover 소스](https://github.com/truenas/middleware/blob/TS-25.10.8/src/middlewared/middlewared/plugins/failover_/event.py)
- [TrueNAS High Availability Explained](https://www.truenas.com/blog/truenas-high-availability-ha-explained)
- [Samba smb.conf(5)](https://www.samba.org/samba/docs/current/man-html/smb.conf.5.html)
- [Samba smbd(8)](https://www.samba.org/samba/docs/current/man-html/smbd.8.html)
- [Klara, OpenZFS SLOG를 쓸 때와 피할 때](https://klarasystems.com/articles/good-time-to-use-openzfs-slog-and-when-to-avoid-it/)
