---
title: "덮어쓰지 않는 블록 트리로 이해하는 OpenZFS의 동작 원리"
linkTitle: "04 OpenZFS"
description: "OpenZFS의 스냅샷과 증분 send, 무결성은 블록 트리를 새 자리에 쓰고 뿌리를 바꾸는 구조에서 나온다. 2.3.9와 2.4.4 소스와 man 페이지를 바탕으로 그 과정과 RAIDZ의 공간 할당, 풀의 변경 제약을 설명한다."
weight: 4
date: 2026-11-19
lastmod: 2026-11-19
url: "/media-nas/04-openzfs/"
---

# 04 · 덮어쓰지 않는 블록 트리로 이해하는 OpenZFS의 동작 원리

OpenZFS의 스냅샷과 증분 send를 이해하려면 파일을 덮어쓸 때 무엇이 바뀌는지부터 보면 됩니다. ZFS는 기존 블록을 고치지 않고 새 내용을 빈 자리에 쓴 뒤, 그 블록을 가리키는 트리의 뿌리를 바꿉니다. 데이터와 메타데이터를 모두 블록 트리로 다루는 이 구조에서 스냅샷, 증분 복제, 읽을 때의 무결성 검증이 이어집니다.

[03]({{< relref "/data/media-nas/03-zfs-truenas-architecture/index.md" >}})에서는 요청이 메모리와 디스크를 지나는 경로를 살펴봤습니다. 이번에는 OpenZFS 안으로 들어가 블록이 놓이는 방식부터 따라갑니다. 기준은 TrueNAS 25.10이 쓰는 2.3.9입니다. 2.4에서 달라진 동작은 구분해 적고, 프로젝트의 계보와 버전별 차이도 함께 다룹니다.

## 파일과 디스크 사이의 OpenZFS 계층 {#layers}

OpenZFS는 볼륨 관리자와 파일시스템을 한 스택으로 합칩니다. 사용자가 파일이나 블록 장치로 보는 데이터를 안쪽에서는 객체와 블록으로 다루고, 실제 디스크에 기록하기까지 여러 계층이 일을 나눕니다.

| 계층 | 맡는 일 |
|---|---|
| ZPL, ZVOL | POSIX 파일시스템과 블록 장치. 사용자가 보는 면 |
| DMU | 객체와 그 블록 트리, 트랜잭션. send와 receive도 여기 있다 |
| DSL | 데이터셋, 스냅샷, 클론, 속성 상속, 공간 계정 |
| ZAP | 이름과 값의 사전. 디렉터리가 ZAP 객체다 |
| ARC | 블록 캐시 |
| ZIO | I/O 파이프라인. 압축, 암호화, 체크섬, 할당 순으로 지난다 |
| SPA, metaslab | 풀과 공간 할당 |
| VDEV | 미러, RAIDZ, dRAID, 디스크 |

파일은 DMU 객체로 표현됩니다. 디렉터리에는 이름과 값을 담는 ZAP 객체를 씁니다. DMU가 다루는 주소는 “객체 몇 번의 몇 번째 블록”까지이고, 실제로 어느 디스크의 어디에 놓을지는 SPA와 VDEV가 정합니다.

그 사이에서 블록을 처리하는 계층이 ZIO입니다. 압축과 체크섬을 이 경로에서 적용하므로, 파일시스템 종류와 무관하게 모든 블록에 같은 처리를 할 수 있습니다. 스냅샷과 증분 send는 파일과 디렉터리를 다루는 계층 아래의 블록 트리를 바탕으로 동작합니다.

## copy-on-write로 새 뿌리를 기록하는 블록 트리 {#on-disk}

파일의 블록 트리는 dnode에서 시작합니다. dnode의 블록 포인터가 간접 블록을 가리키고, 간접 블록 안의 포인터들이 다음 단계를 가리킵니다. 맨 아래에는 파일의 데이터 블록이 있습니다. 데이터셋의 모든 dnode도 한 객체의 블록 트리에 담기며, 위로 올라가면 풀 전체의 메타 객체 집합(MOS)을 거쳐 uberblock에 닿습니다.

블록 포인터에는 위치만 들어 있지 않습니다. 가리키는 블록의 크기와 압축 방식, 블록이 태어난 트랜잭션 그룹 번호(birth txg), 체크섬도 함께 들어 있습니다. 읽어 온 블록이 올바른지는 그 블록 안의 값이 아니라 부모 포인터에 저장된 체크섬과 대조해 판단합니다. 잘못된 내용을 읽으면 이 비교에서 드러납니다.

트리의 맨 위에 있는 uberblock은 디스크의 레이블에 기록됩니다. 레이블은 디스크 앞과 뒤에 두 개씩 놓입니다. 풀을 열 때는 모든 레이블을 읽어 유효한 uberblock 가운데 가장 높은 트랜잭션 그룹 번호를 가진 것을 고릅니다.

아래 그림에서는 바뀐 데이터 블록에서 뿌리까지 어떤 경로를 새로 쓰는지 따라가면 됩니다. 변경되지 않은 블록을 옛 트리와 새 트리가 함께 가리키는 부분도 함께 볼 수 있습니다.

{{< flow src="_flow/3-덮어쓰면-뿌리까지-새로-쓴다.json" />}}

새 데이터 블록을 빈 자리에 쓰면 위치와 체크섬이 달라집니다. 이를 가리키는 부모 간접 블록의 포인터도 고쳐야 하므로 부모 역시 새로 씁니다. 같은 과정이 뿌리까지 이어지고, 마지막에 새 uberblock을 기록합니다. 변경 경로 밖의 블록은 그대로 참조합니다.

쓰기 도중 전원이 끊겨 새 uberblock을 기록하지 못했다면 옛 uberblock이 여전히 유효합니다. 해제된 공간은 두 트랜잭션 그룹 뒤에야 다시 할당됩니다. 직전 uberblock으로 되돌아갈 여지를 남겨 두기 위해서입니다.

이 트리를 이루는 메타데이터에는 추가 복사본도 둡니다. 블록 포인터는 위치를 세 개까지 담을 수 있습니다. 기본 설정에서 메타데이터는 데이터보다 한 벌 더 기록되며, MOS는 세 벌 기록됩니다. 풀의 미러나 RAIDZ가 제공하는 중복성과는 별개입니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처 |
|---|---|---|
| 블록 포인터 | 128바이트. DVA 3개, 논리·물리 크기, 압축·체크섬 종류, birth txg, 256비트 체크섬 | spa.h 2.3.9 |
| 블록 크기 | 최소 512바이트, 최대 16MiB | fs/zfs.h |
| 임베디드 블록 포인터 | 압축 후 112바이트 이하인 데이터는 포인터 안에 저장 | spa.h, zpool-features(7) `embedded_data` |
| dnode | 512바이트, 블록 포인터 최대 3개. `dnodesize`로 최대 16KiB | dnode.h |
| 간접 블록 | 기본 128KiB, 블록 포인터 1,024개 | dnode.c `zfs_default_ibs` |
| 레이블 | 디스크당 4개, 각 256KiB. 설정 nvlist 112KiB와 uberblock 영역 128KiB | vdev_impl.h |
| uberblock 슬롯 | ashift에 따라 1KiB~8KiB. ashift=12면 4KiB 슬롯 32개 | vdev_impl.h |
| uberblock 선택 | txg, timestamp 순으로 비교해 가장 큰 것 | vdev_label.c |
| 해제 지연 | 2 txg. "safety net for uberblock rollback" | metaslab_impl.h `TXG_DEFER_SIZE` |
| `redundant_metadata` | 기본 all. 메타데이터를 한 벌 더 저장, 합계 최대 3벌 | zfsprops(7), dmu.c |
| MOS 복사본 | 3벌 | dmu_objset.c |
| `copies` | 기본 1. 디스크 장애를 대신하지 못한다고 man이 경고 | zfsprops(7) |

- 2006년의 ZFS On-Disk Specification은 uberblock 슬롯을 1KiB 128개로 적는다. 현재 소스는 ashift를 따른다
- 암호화된 블록은 블록 포인터의 세 번째 위치 칸을 salt와 IV에 쓰므로 `copies=3`을 쓸 수 없다

{{< /details >}}

## 옛 블록을 남기는 스냅샷과 변경을 찾는 증분 send {#snapshot-send}

스냅샷은 데이터셋의 그 시점 블록 트리를 남겨 둡니다. 앞선 덮어쓰기 그림에서 새 트리가 생긴 뒤에도 옛 트리가 옛 블록을 계속 참조하는 모습을 떠올리면 됩니다. 파일의 블록을 복사하지 않으므로 만드는 데 걸리는 시간은 데이터 크기와 무관하고, 처음에는 공간을 쓰지 않습니다.

스냅샷 때문에 공간을 더 쓰는 시점은 그 뒤입니다. 현재 데이터셋에서 블록을 덮어쓰거나 지워도, 스냅샷이 참조하는 옛 블록은 해제할 수 없습니다. ZFS는 블록의 birth txg를 직전 스냅샷의 txg와 비교해 이를 판단합니다. 스냅샷보다 나중에 태어난 블록은 해제하고, 스냅샷 시점까지 태어난 블록은 deadlist에 남깁니다. 큰 영상 소재를 지웠는데도 공간이 돌아오지 않는 이유가 여기에 있습니다.

클론은 이 스냅샷에서 시작하는 쓰기 가능한 데이터셋입니다. 클론이 남아 있는 동안 원본 스냅샷은 지울 수 없으며, `zfs promote`로 의존 방향을 뒤집을 수 있습니다. 북마크는 블록을 보존하는 대신 스냅샷이 만들어진 시점만 기억합니다. 원본 스냅샷을 지운 뒤에도 증분 send의 기준점으로 쓸 수 있는 표식입니다.

증분 send에서도 판단 기준은 birth txg입니다. 아래 그림에서는 기준 시점 이후에 바뀐 가지와 그대로 남은 가지를 비교하면 됩니다.

{{< flow src="_flow/4-증분-send는-바뀐-가지만-내려간다.json" />}}

send는 보낼 스냅샷의 트리를 위에서부터 내려가며 기준 스냅샷 이후에 태어난 블록을 따라갑니다. 앞 절에서 자식 블록이 바뀌면 부모도 새로 썼듯이, 하위 블록의 변경은 간접 블록의 birth txg에도 남습니다. 간접 블록이 기준 시점보다 오래됐거나 같다면 그 아래에는 새로 보낼 변경이 없으므로 하위 트리 전체를 읽지 않고 건너뜁니다.

파일을 하나씩 비교하는 rsync와 다른 지점입니다. 트리가 이미 변경 여부를 담고 있으므로, 증분 send에는 바뀐 양에 비례하는 시간이 걸립니다. 전송할 범위와 블록의 저장 형태는 옵션으로 정합니다.

- `-i`, `-I`: 증분. `-I`는 사이의 스냅샷을 모두 포함한다
- `-R`: 하위 데이터셋과 속성, 스냅샷까지 복제한다
- `-c`: 압축된 블록을 풀지 않고 보낸다
- `-L`: 128KiB보다 큰 블록을 쪼개지 않고 보낸다. recordsize 1M 데이터셋에서 큰 블록을 유지하려면 필요하다
- `-w`: 암호화된 블록을 암호문 그대로 보낸다. 받는 쪽은 키 없이 보관할 수 있다
- receive의 `-s`: 중단된 수신을 토큰으로 이어받는다

받아 둔 스트림을 복구에 쓰는 기능도 있습니다. 2.2에서 들어온 corrective receive는 스트림을 건강한 원본으로 삼아 그 안에 포함된 손상 데이터 블록을 고칩니다. 메타데이터는 고치지 못합니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처 |
|---|---|---|
| 스냅샷 | "Snapshots can be created extremely quickly, and initially consume no additional space" | zfsconcepts(7) |
| 블록 해제 판정 | birth txg가 직전 스냅샷 txg보다 크면 해제, 아니면 deadlist | dsl_dataset.c `dsl_dataset_block_kill` |
| 스냅샷 삭제 | 다음 스냅샷의 deadlist에서 해당 구간을 해제 목록으로 옮김. 여러 txg에 걸쳐 비동기 진행 | dsl_destroy.c |
| 클론 | "the original snapshot cannot be destroyed as long as a clone exists" | zfsconcepts(7) |
| 북마크 | "they will survive if the snapshot itself is destroyed" | zfsconcepts(7) |
| send의 건너뛰기 | 논리 birth가 기준 txg 이하인 블록 포인터는 하위 트리째 건너뜀 | dmu_traverse.c |
| send·receive 옵션 | 위 목록 | zfs-send(8), zfs-receive(8) |
| corrective receive | "can only heal data blocks present in the stream. Metadata can not be healed" | zfs-receive(8) |

- 스냅샷 수가 많을 때의 성능 영향을 적은 공식 문장은 찾지 못했다
- 암호화 데이터셋을 `-w` 없이 보내면 평문으로 전송된다

{{< /details >}}

## 블록 단위로 동작하는 체크섬·압축·중복 제거·암호화 {#data-services}

블록 트리는 부모와 자식 블록의 참조 관계를 기록하고, 쓰기 파이프라인은 각 블록에 압축이나 암호화 등을 적용해 디스크에 기록할 형태를 정합니다. 체크섬과 압축, 중복 제거, 암호화가 모두 이 경로에서 블록 단위로 적용됩니다.

### 부모의 값과 대조하는 체크섬

체크섬의 기본값은 fletcher4입니다. 읽을 때마다 부모 포인터에 저장된 체크섬과 대조하고, 일치하지 않으면 미러의 다른 복사본이나 RAIDZ 패리티로 복구합니다. 올바른 데이터를 얻은 뒤에는 오류가 난 쪽을 고쳐 씁니다.

스크럽은 이 검증을 풀의 모든 블록에 한 번 돌리는 작업입니다. 그러나 체크섬을 계산하기 전에 메모리의 비트가 뒤집혔다면 이 방식으로 잡지 못합니다. 프로젝트 문서가 ECC 메모리를 강하게 권하는 이유입니다.

### 섹터 단위의 이득을 따지는 압축

압축을 켰다고 모든 블록을 압축한 상태로 저장하지는 않습니다. 먼저 압축해 보고, 블록 크기를 최소 12.5% 줄여야 압축된 결과를 사용합니다. 저장 공간은 섹터 크기로 올림하므로, 압축 결과가 작아져도 실제 디스크 공간의 절감으로 이어지지 않을 수 있습니다. 작은 블록에서 압축 이득이 줄어드는 이유입니다.

`compression=on`은 `lz4_compress` 기능이 있으면 lz4를 사용합니다. 이미 압축된 영상은 블록마다 절감 조건을 충족하지 못해 원본대로 저장됩니다. zstd는 레벨 3 이상에서 일정 크기 이상의 레코드를 lz4와 zstd-1로 먼저 시험해, 압축되지 않는 블록의 처리를 일찍 끝냅니다.

### 참조를 공유하는 중복 제거와 블록 클로닝

중복 제거는 같은 체크섬의 블록이 이미 있는지 찾는 데서 시작합니다. 있으면 새 데이터를 할당하는 대신 기존 블록의 참조 수를 올립니다. 매번 테이블을 찾아야 하므로 중복 제거 테이블이 메모리에 들어가지 않으면 쓰기가 느려집니다.

2.3의 fast dedup은 테이블 변경을 로그에 모았다가 조금씩 반영하는 방식입니다. 테이블 크기에 한도를 두고 오래된 단일 참조 항목을 지우는 기능도 들어왔습니다. fast dedup 형식은 새로 만들어지는 테이블에만 적용됩니다. 영상 소재는 블록 단위로 겹치는 내용이 드물어, 이 글에서는 중복 제거를 켜지 않는 쪽으로 봤습니다.

블록 클로닝도 참조를 공유하지만 동작을 시작하는 조건이 다릅니다. `cp --reflink`처럼 프로그램이 명시적으로 요청할 때만 실행하며, 데이터를 읽지 않고 참조를 늘립니다. 모든 쓰기에서 같은 내용의 블록을 찾는 작업은 하지 않습니다.

이 기능은 2.2.0에 들어온 직후 데이터 손상 버그가 보고돼 2.2.1에서 기본으로 꺼졌습니다. 손상의 원인은 오래된 dirty dnode 검사 코드였고, 2.2.2에서 수정됐습니다. 수정 뒤에도 2.2 계열의 기본값은 꺼진 상태로 유지됐으며, 2.3부터 기본으로 켜져 있습니다.

### send 경로의 수정 이력이 남은 암호화

네이티브 암호화는 데이터셋 단위로 켭니다. 오랫동안 거론된 손상 보고는 스냅샷과 send를 함께 쓰는 과정에서 나왔습니다. 이 문제는 암호문 그대로 보내지 않는 send 경로의 버그로 확인됐고, 2.3.3에서 고쳐졌습니다.

그 수정으로 모든 암호화 문제가 닫힌 것은 아닙니다. 암호화와 관련된 패닉 보고에는 아직 열린 이슈가 있습니다. 프로젝트가 암호화 기능을 실험적이라고 표기한 문구는 찾지 못했습니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처 |
|---|---|---|
| `checksum` | on은 현재 fletcher4. sha256, sha512, skein, edonr, blake3 선택 가능 | zfsprops(7) |
| 자가 치유 | 미러는 좋은 복사본으로 오류 난 쪽에 복구 쓰기. RAIDZ는 패리티로 재구성 | vdev_mirror.c, vdev_raidz.c |
| ECC | "No technique used in ZFS (or any other filesystem) is capable of protecting against bit flips. Consequently, ECC Memory is highly recommended." | OpenZFS Hardware 문서 |
| 스크럽 주기 | 업스트림은 주간·월간 타이머 템플릿만 제공하고 기본으로 켜지 않음 | 소스 etc/systemd |
| `compression=on` | `lz4_compress` 기능이 있으면 lz4 | zfsprops(7) |
| 12.5% 규칙 | "There is 12.5% default compression threshold in addition to sector rounding" | zfsprops(7), zio.c |
| zstd 조기 포기 | `zstd_earlyabort_pass`=1, 레코드 131,072바이트 이상에서 시도 | zfs(4) |
| dedup 체크섬 | sha256, sha512, skein, edonr, blake3만 허용. 기본 sha256 | ddt.c, zfsprops(7) |
| dedup 메모리 | "1.25 GiB of RAM per 1 TiB" | zfsconcepts(7) |
| fast dedup | "allows more advanced deduplication features to be enabled on new dedup tables". `dedup_table_quota` 기본 auto, `zpool ddtprune` | zpool-features(7), zpoolprops(7) |
| 블록 클로닝 | 최상위 vdev별 테이블에 오프셋과 참조 수만 기록. 암호화 블록은 불가 | brt.c, zfsconcepts(7) |
| 2.2.1 | "zfs-2.2.1 disables block cloning by default (#15529)" | 2.2.1 릴리스 노트 |
| 2.2.2 | "due to an incorrect dirty dnode check. This bug is very hard to hit" | 2.2.2 릴리스 노트 |
| `zfs_bclone_enabled` | 2.2.1~2.2.11은 0, 2.3.0부터 1 | zfs_vnops.c 소스 |
| 암호화 이슈 #12014 | "The corruption seen here affected only non-raw sends. It was fixed" | GitHub 이슈, 2.3.3 릴리스 노트 |
| 열린 암호화 결함 이슈 | 14건 (2026-11-19 조회). #14330, #16065 포함 | GitHub 라벨 조회 |

- 2.2 계열의 zfs(4) man 페이지는 `zfs_bclone_enabled`를 1로 적는다. 소스의 기본값은 0이다
- 블록 클로닝 관련 수정은 2.3.7부터 2.3.9까지, 2.4.2부터 2.4.4까지 계속 들어갔다
- 암호화된 데이터셋은 압축 뒤에 암호화하므로 man 페이지가 CRIME 유사 공격 가능성을 경고한다

{{< /details >}}

## 블록 크기와 빈 공간에 좌우되는 RAIDZ 할당 {#raidz-space}

새 블록을 쓸 때는 위치뿐 아니라 필요한 공간도 정해야 합니다. RAIDZ는 블록을 데이터 섹터로 나누고 행마다 패리티를 붙입니다. 이때 올림의 기준은 패리티 수에 1을 더한 값입니다. 데이터와 패리티를 합친 전체 섹터 수를 이 값의 배수로 올림합니다. 다음 블록이 쓰지 못할 만큼 작은 빈 슬롯이 남지 않도록 하는 패딩입니다.

아래 그림은 10폭 RAIDZ2에서 블록 크기에 따라 필요한 공간을 공식으로 계산한 비교입니다. 막대는 할당 공간 가운데 데이터가 차지하는 비율을 보여 줍니다.

{{< lane src="_lane/6-블록이-작을수록-패리티가-커진다.json" />}}

RAIDZ의 스트라이프 폭은 블록마다 달라집니다. 작은 블록에서는 패리티와 올림 공간이 차지하는 비율이 커지고, 블록이 커질수록 명목 효율에 가까워집니다. 영상 데이터셋에 recordsize 1M을 쓰는 이유가 여기에도 있습니다.

공간 표시에는 이 차이가 그대로 드러나지 않습니다. 사용량은 정해진 블록 크기를 기준으로 환산하므로, 작은 파일이나 작은 블록의 가상 머신 디스크를 RAIDZ에 두면 표시된 용량보다 실제 공간을 훨씬 많이 씁니다. special vdev가 작은 블록을 미러에 따로 받으면 이 손실도 줄어든다고 볼 수 있습니다.

블록과 섹터의 크기는 나중에 바꿀 수 있는 범위도 다릅니다. recordsize를 바꾸면 새로 쓰는 파일부터 적용됩니다. 섹터 크기를 정하는 ashift는 vdev를 만들 때 고정되며 디스크를 교체해도 바뀌지 않습니다.

### 확장 뒤에도 남는 옛 RAIDZ 비율

2.3의 RAIDZ 확장은 vdev에 디스크를 한 개씩 붙여 폭을 넓히는 기능입니다. RAIDZ의 패리티 수는 바꿀 수 없고, 폭은 2.3부터 넓힐 수만 있습니다. 기존 데이터를 새 폭으로 다시 배치하지만, 각 블록의 데이터와 패리티 비율은 옛 폭의 것을 유지합니다.

5폭 RAIDZ2에서 쓴 블록은 디스크가 늘어도 데이터 3에 패리티 2입니다. 새로 쓰는 블록부터 새 비율을 사용합니다. 기존 블록까지 새 비율로 바꾸려면 내용을 다시 써야 합니다.

2.3.4에서 들어온 `zfs rewrite`는 파일 내용을 유지하면서 블록을 새 위치에 다시 씁니다. 이를 RAIDZ 확장 뒤의 비율 변환에 쓸 수 있다는 연결은 동작에서 나온 추론이며, man 페이지에서는 확인하지 못했습니다. 일반 rewrite는 논리 birth를 갱신하므로 다음 증분 send에도 영향을 줍니다. 2.4의 `zfs rewrite -P`는 가능하면 논리 birth를 보존합니다.

### 빈 구간이 잘게 나뉜 풀

새 블록을 놓을 빈자리를 찾는 비용은 풀이 차면서 커집니다. vdev의 공간은 metaslab이라는 구역으로 나눠 관리합니다. 기본 목표는 약 200개지만 실제 개수는 vdev 크기에 따라 달라지며, 할당자는 빈 공간의 크기와 분포를 기준으로 사용할 구역을 고릅니다.

구역의 빈 공간이 4% 아래로 내려가면 탐색 방식이 바뀝니다. 앞에서부터 맞는 자리를 찾던 방식 대신 크기에 가장 잘 맞는 자리를 찾고, 이 탐색에 CPU를 많이 씁니다. 프로젝트 문서는 이런 구역이 많아지지 않도록 풀의 빈 공간을 10% 넘게 유지하라고 권합니다. 흔히 말하는 80% 기준은 현재 공식 문서에서 찾지 못했습니다.

`zpool list`의 FRAG도 빈 공간을 설명하는 지표입니다. 빈 구간이 얼마나 잘게 나뉘었는지를 나타내므로 파일이 조각난 정도로 읽어서는 안 됩니다. 일반 쓰기에 쓸 수 없는 slop 예약 공간도 따로 있습니다. 풀 용량의 1/32을 기준으로 확보하되 하한과 상한을 적용합니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처 |
|---|---|---|
| RAIDZ 할당 공식 | 데이터 섹터 수에 행마다 패리티를 더하고 (패리티 수+1)의 배수로 올림 | vdev_raidz.c `vdev_raidz_asize` |
| 10폭 RAIDZ2, ashift=12 | 4KiB는 3섹터(33%), 128KiB는 42섹터(76%), 1MiB는 321섹터(79.8%) | 공식으로 계산 |
| `zfs list` 표시 | 128KiB 블록 기준 비율로 환산한 값 | vdev.c `vdev_set_deflate_ratio` |
| ashift | "Changing this value will not modify any existing vdev, not even on disk replacement" | zpoolprops(7) |
| RAIDZ 확장 | "old blocks retain their old data-to-parity ratio (e.g. 5-wide RAID-Z2 has 3 data and 2 parity) but distributed among the larger set of disks" | zpool-attach(8) |
| 확장 중 | 중복은 유지되고, 끝나면 스크럽이 자동 시작 | zpool-attach(8) |
| `zfs rewrite` | 2.3.4에서 도입. 논리 birth를 갱신하므로 다음 증분 send가 커짐 | 2.3.4 릴리스 노트, zfs-rewrite(8) |
| `zfs rewrite -P` | 2.4에서 도입. 논리 birth를 보존 | 2.4.0 릴리스 노트 |
| metaslab 수 | `zfs_vdev_default_ms_count`=200, 크기 512MiB~16GiB | vdev.c, zfs(4) |
| 빈 공간 권고 | "Keep pool free space above 10% to avoid many metaslabs from reaching the 4% free space threshold" | OpenZFS Workload Tuning |
| FRAG | 빈 공간의 세그먼트 크기 분포로 계산 | metaslab.c |
| slop | 풀의 1/32. 하한 128MiB, 상한 128GiB | spa_misc.c `spa_slop_shift` |
| dRAID | 고정 스트라이프 폭. 기본 데이터 8개, 4KiB 섹터면 최소 할당 32KiB | zpoolconcepts(7) |

- `zfs rewrite`가 RAIDZ 확장 뒤의 비율 변환에 쓰인다는 연결은 man 페이지에 명시돼 있지 않다. 동작에서 나오는 추론이다

{{< /details >}}

## 호환성과 I/O 경로를 결정하는 OpenZFS 설정 {#constraints}

### 디스크 형식에 남는 feature flag

OpenZFS를 새 버전으로 설치하는 일과 풀의 디스크 형식을 바꾸는 일은 구분해야 합니다. feature flag는 한 번 켜면 끌 수 없습니다. 켜져 있어도 아직 디스크 형식에 쓰이지 않은 enabled 상태에서는 그 기능을 모르는 소프트웨어도 풀을 열 수 있습니다. 기능이 실제로 쓰여 active 상태가 되면 읽기·쓰기 import에 해당 기능의 지원이 필요합니다.

`zpool upgrade`는 그 버전이 아는 모든 기능을 켭니다. 이렇게 새 기능을 켠 풀을 이전 버전에서 다시 열 수 있는지는 이 상태에 달려 있습니다. 모르는 active 기능이 있으면 읽기·쓰기로 열 수 없고, 그 기능들이 모두 읽기 전용 호환이면 읽기 전용으로만 열립니다. TrueNAS를 올린 뒤 풀까지 업그레이드하면 이전 버전으로 돌아갈 수 없는 경우가 생기는 이유입니다.

미리 범위를 제한하는 설정은 `compatibility`입니다. `openzfs-2.2` 같은 목록을 지정해 두면 그 목록에 있는 기능만 켜므로, 서로 다른 버전이 함께 사용할 공통분모를 고정할 수 있습니다.

### 제거한 뒤에도 남는 vdev 매핑

vdev를 추가하는 일은 가능하지만 제거에는 제약이 있습니다. 2.3.9의 man 페이지에 따르면 RAIDZ 최상위 vdev가 하나라도 있으면 최상위 vdev를 제거할 수 없습니다. 2.4의 man 페이지는 dRAID도 함께 적습니다. special vdev에도 같은 규칙이 적용되므로 RAIDZ 풀에 붙인 special vdev 역시 뗄 수 없습니다.

미러와 단일 디스크 vdev를 제거할 때도 최상위 vdev의 섹터 크기가 모두 같아야 하고, 암호화된 데이터셋의 키가 모두 로드돼 있어야 합니다. 제거한 뒤에는 옮겨진 블록의 옛 위치와 새 위치를 연결하는 대응표가 남습니다. 스냅샷의 블록 포인터를 고칠 수 없기 때문입니다. 이 대응표는 메모리를 쓰고, 해당 블록으로 가는 I/O는 표를 거쳐 새 위치를 찾습니다.

### ARC 복사를 줄이는 Direct IO와 SSD의 TRIM

2.3의 Direct IO는 NVMe 풀에서 ARC로 복사하는 비용이 병목이 되는 경우를 겨냥한 기능입니다. 기본 설정에서는 프로그램이 `O_DIRECT`로 연 요청을 가능한 경우 ARC를 우회해 처리합니다. 쓰기는 recordsize에 정렬돼 있어야 하며, 정렬되지 않은 부분은 ARC를 거칩니다.

ARC를 우회해도 ZIO 파이프라인은 그대로 지납니다. 따라서 압축과 체크섬은 계속 적용됩니다.

SSD 풀에서 해제된 공간을 장치에 알리는 `autotrim`은 기본으로 꺼져 있습니다. man 페이지는 저가 장치라면 주기적인 수동 `zpool trim`으로도 대부분의 이득을 얻을 수 있다고 적습니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처 |
|---|---|---|
| feature flag | "Features cannot be disabled once they have been enabled." | zpool-features(7) |
| `zpool upgrade` | "the pool will no longer be accessible on systems that do not support feature flags" | zpool-upgrade(8) |
| 읽기 전용 호환 | 모르는 기능이 모두 read-only compatible이면 읽기 전용으로 import 가능 | zpool-features(7) |
| `compatibility` | 기본 off. 여러 파일을 주면 교집합만 켜짐. 2.1부터 | zpoolprops(7) |
| 부트 풀 | GRUB 호환 목록에 encryption, zstd_compress, raidz_expansion, draid 없음 | compatibility.d `grub2` |
| vdev 제거 | "Top-level vdevs can only be removed if the primary pool storage does not contain a top-level raidz vdev, all top-level vdevs have the same sector size" | zpool-remove(8) |
| 제거 뒤 | 옛 위치와 새 위치의 대응표가 남고 그 블록으로 가는 I/O가 대응표를 거침 | vdev_indirect.c |
| `direct` | 기본 standard. 쓰기는 recordsize 정렬 필요, 정렬되지 않은 부분은 ARC 경유 | zfsprops(7) |
| Direct IO와 파이프라인 | "Direct IO does not bypass the ZIO pipeline, so all checksums, compression, etc. are still all supported" | PR #10018 |
| 2.4의 Direct IO | 정렬되지 않은 요청을 오류 대신 캐시하지 않는 I/O로 처리. `zfs_dio_strict`=1이면 오류 | 2.4.0 릴리스 노트 |
| `autotrim` | 기본 off | zpoolprops(7) |

{{< /details >}}

## Sun에서 이어진 OpenZFS 2.4의 계보 {#history}

OpenZFS는 블록 트리와 copy-on-write의 기본 구조를 유지하면서 버전마다 기능을 더해 왔습니다. ZFS는 Sun이 만들어 2005년 OpenSolaris로 공개했습니다. 2010년 Oracle이 Sun을 인수한 뒤 Solaris의 ZFS는 비공개로 돌아갔고, 공개돼 있던 코드는 illumos로 이어졌습니다.

OpenZFS 프로젝트는 2013년에 출범했습니다. 2020년 11월의 2.0에서는 ZFS on Linux 저장소가 OpenZFS로 이름을 바꾸면서 Linux와 FreeBSD가 한 코드베이스를 쓰기 시작했습니다.

Oracle ZFS와 OpenZFS가 공통으로 다루는 풀 형식은 버전 28과 그 이전까지입니다. 이후 Oracle은 29부터 버전 번호를 올리며 기능을 추가했습니다. OpenZFS는 버전을 5000으로 고정하고 기능마다 feature flag를 붙이는 방식을 택했습니다. 이 이후의 풀 형식은 서로 열 수 없으며, 암호화처럼 이름이 같은 기능도 구현이 다릅니다.

2026년 11월에는 현행 2.4와 함께 2.3, LTS인 2.2 계열도 유지되고 있습니다.

| 계열 | 최신 | 지원 Linux 커널 | 비고 |
|---|---|---|---|
| 2.4 | 2.4.4 (2026-08-21) | 4.18~7.2 | 현행 |
| 2.3 | 2.3.9 (2026-08-21) | 4.18~7.2 | TrueNAS 25.10이 쓰는 계열 |
| 2.2 | 2.2.11 (2026-08-21) | 4.18~6.17 | LTS. 새 커널 지원은 추가하지 않음 |

지원 커널 범위가 릴리스마다 붙는 이유는 OpenZFS가 Linux 커널 밖의 모듈이기 때문입니다. 프로젝트 문서는 CDDL인 OpenZFS를 GPLv2 커널 바이너리의 일부로 함께 넣어 배포할 수 없다고 설명합니다. 새 커널이 나올 때마다 호환 패치가 필요하며, 릴리스가 지원하는 범위를 넘으면 빌드가 거부됩니다.

배포판의 제공 방식도 다릅니다. Ubuntu는 커널 패키지에 모듈을 포함합니다. Debian에서는 contrib의 DKMS 패키지를 쓰고, RHEL 계열에서는 OpenZFS 저장소의 DKMS나 kmod를 사용합니다.

기능을 사용할 때는 도입된 버전도 구분해야 합니다. 버전마다 들어온 기능을 아래 표에 모았습니다.

| 버전 | 날짜 | 들어온 기능 |
|---|---|---|
| 0.8 | 2019-05 | 네이티브 암호화, special·dedup vdev, TRIM, 최상위 vdev 제거, 순차 스크럽 |
| 2.0 | 2020-11 | Linux·FreeBSD 통합, zstd 압축, 재부팅 뒤에도 남는 L2ARC, 미러 순차 리실버 |
| 2.1 | 2021-07 | dRAID, `compatibility` 속성 |
| 2.2 | 2023-10 | 블록 클로닝, corrective receive, BLAKE3, 컨테이너 overlayfs 지원 |
| 2.3 | 2025-01 | RAIDZ 확장, fast dedup, Direct IO, JSON 출력, 긴 파일 이름 |
| 2.3.4 | 2025-08 | `zfs rewrite` |
| 2.4 | 2025-12 | special vdev의 ZIL 수용과 RAIDZ 구성 허용, 날짜 범위 스크럽, 기본 쿼터 |

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처 |
|---|---|---|
| 2.0.0 | 2020-11-30. "The ZFS on Linux project has been renamed OpenZFS! Both Linux and FreeBSD are now supported from the same repository" | 2.0.0 릴리스 노트 |
| 풀 버전 | 마지막 숫자 버전은 28. 이후는 feature flag | zpool-features(7) |
| Oracle 풀 버전 | 28에서 54까지 숫자로 증가. 30이 암호화 | Oracle Solaris 11.4 문서 |
| 2.2 LTS | "LTS releases will receive patches for at least 2 years", 새 커널은 지원하지 않음 | RELEASES.md |
| 라이선스 | CDDL. 커널 바이너리의 일부로 배포할 수 없으나 모듈이나 소스로는 가능 | OpenZFS License 문서 |
| 커널 상한 | 소스 `META`의 `Linux-Maximum`. 넘으면 빌드 거부, `--enable-linux-experimental`로 우회 | config/kernel.m4 |
| 배포판 제공 방식 | Ubuntu 커널 패키지 포함, Debian contrib `zfs-dkms`, RHEL 계열 DKMS·kABI kmod, Arch 비공식 저장소 | OpenZFS Getting Started |
| FreeBSD | 13.0부터 OpenZFS 사용 | FreeBSD 13.0 릴리스 노트 |
| 2005년 공개, 2010년 비공개화, 2013년 출범 | 연도만 확인 | Wikipedia |

- Canonical은 2016년 모듈 배포가 두 라이선스를 지킨다고 밝혔고, Software Freedom Conservancy는 같은 달 GPL 위반이라고 밝혔다. 견해가 엇갈린다
- macOS와 Windows 포트는 별도 저장소에서 개발된다. Windows 포트의 README는 베타라고 적는다
- illumos는 코드베이스가 갈라졌다. zstd, dRAID, 블록 클로닝, RAIDZ 확장을 포함해 OpenZFS에만 있는 feature가 20개다

{{< /details >}}

## 2.5를 향한 개발 브랜치의 AnyRAID {#next}

다음 버전은 2.5이며 마일스톤 마감은 2027년 3월 1일입니다. 2026년 11월 4일에는 AnyRAID가 개발 브랜치에 들어갔습니다. 크기가 다른 디스크를 같은 크기의 타일로 나눠 묶는 vdev로, 현재 지원하는 것은 미러 형태입니다. RAIDZ 형태와 재배치, 축소는 후속 작업으로 열려 있습니다. 2.4에는 포함돼 있지 않습니다.

OpenZFS 안에 객체 스토리지 인터페이스를 넣는 작업도 제안됐습니다. 아직 초안 단계이며, 제안서도 이를 개념 증명이라고 적고 있습니다.

최근 1년의 개발 브랜치에서는 TrueNAS 소속 기여자의 커밋이 가장 많습니다. fast dedup과 AnyRAID의 feature 식별자에는 Klara의 이름이 붙어 있습니다. LLNL 소속 기여자도 상위 작성자에 포함됩니다.

## 확인하지 못한 것 {#unverified}

- 2026년 OpenZFS 개발자 서밋의 발표 목록
- 스냅샷 수가 많을 때의 성능 영향을 적은 공식 문장
- 기존 중복 제거 테이블을 fast dedup 형식으로 바꾸는 경로
- OpenSolaris 공개와 Oracle의 비공개화, illumos 포크의 정확한 날짜. 연도만 2차 자료로 확인했다
- 암호문 그대로 보내는 send 경로에 손상 버그가 남아 있는지. 이슈에 올라온 질문에 답이 달리지 않았다

## 참고 자료 {#references}

- [OpenZFS 릴리스 목록](https://github.com/openzfs/zfs/releases)
- [OpenZFS RELEASES.md](https://github.com/openzfs/zfs/blob/master/RELEASES.md)
- [OpenZFS License 문서](https://openzfs.github.io/openzfs-docs/License.html)
- [OpenZFS zpool-features(7) 2.4](https://openzfs.github.io/openzfs-docs/man/v2.4/7/zpool-features.7.html)
- [OpenZFS zfsprops(7) 2.3](https://openzfs.github.io/openzfs-docs/man/v2.3/7/zfsprops.7.html)
- [OpenZFS zfs(4) 2.3](https://openzfs.github.io/openzfs-docs/man/v2.3/4/zfs.4.html)
- [OpenZFS zpool-remove(8) 2.3](https://openzfs.github.io/openzfs-docs/man/v2.3/8/zpool-remove.8.html)
- [OpenZFS Workload Tuning](https://openzfs.github.io/openzfs-docs/Performance%20and%20Tuning/Workload%20Tuning.html)
- [OpenZFS Hardware 문서](https://openzfs.github.io/openzfs-docs/Performance%20and%20Tuning/Hardware.html)
- [OpenZFS 2.3.9 spa.h](https://github.com/openzfs/zfs/blob/zfs-2.3.9/include/sys/spa.h)
- [블록 클로닝 손상 이슈 #15526](https://github.com/openzfs/zfs/issues/15526)
- [암호화와 스냅샷 손상 이슈 #12014](https://github.com/openzfs/zfs/issues/12014)
- [Direct IO PR #10018](https://github.com/openzfs/zfs/pull/10018)
- [AnyRAID PR #17567](https://github.com/openzfs/zfs/pull/17567)
- [Oracle Solaris 11.4 ZFS 풀 버전](https://docs.oracle.com/en/operating-systems/solaris/oracle-solaris/11.4/manage-zfs/zfs-pool-versions.html)
- [Canonical, ZFS Licensing and Linux](https://canonical.com/blog/zfs-licensing-and-linux)
- [Software Freedom Conservancy, GPL Violations Related to Combining ZFS and Linux](https://sfconservancy.org/blog/2016/feb/25/zfs-and-linux/)
- [Wikipedia, OpenZFS](https://en.wikipedia.org/wiki/OpenZFS)
