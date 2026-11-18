---
title: "플래시 200TB와 HDD 800TB로 나누는 ZFS 미디어 NAS"
linkTitle: "02 1PB 플래시·HDD 분할"
description: "1PB 편집 스토리지를 플래시 200TB와 HDD 800TB로 나누는 구성과 용량을 살핀다. 현행 TrueNAS 25.10에서는 NVMe 풀과 HDD 풀을 분리하고 작업별 데이터율에 따라 소재를 배치하는 쪽을 권한다."
weight: 2
date: 2026-11-17
lastmod: 2026-11-17
url: "/media-nas/02-1pb-flash-hdd-split/"
---

# 02 · 플래시 200TB와 HDD 800TB로 나누는 ZFS 미디어 NAS

1PB 편집 스토리지를 플래시 200TB와 HDD 800TB로 나누는 구성은 ZFS에서 가능합니다. 현행 TrueNAS 25.10(OpenZFS 2.3 계열)에서는 한 헤드에 NVMe 풀과 HDD 풀을 따로 두는 쪽을 권합니다. HDD 풀에 플래시를 special vdev로 붙여 데이터셋별로 배치를 정하는 방식은 OpenZFS 2.4를 쓰는 TrueNAS 27이 정식 출시된 뒤 다시 검토할 선택지입니다.

구성별 성능 범위와 편집자 수에 따른 요구 대역은 [01]({{< relref "/data/media-nas/01-truenas-performance-range/index.md" >}})에서 다뤘습니다. 풀과 vdev, special vdev, L2ARC의 동작 원리는 [03]({{< relref "/data/media-nas/03-zfs-truenas-architecture/index.md" >}})에 있습니다. 이 글의 용량은 1TB = 10^12바이트 기준이며, 드라이브 수와 처리량은 이 글이 계산하거나 추정한 값입니다.

## 스트림과 읽기 방식으로 나누는 플래시와 HDD {#placement}

소재를 어디에 둘지 정하는 출발점은 스트림 하나의 데이터율입니다. 아래 그림에서는 포맷에 따라 필요한 처리량이 얼마나 달라지는지 보면 됩니다.

{{< lane src="_lane/4-스트림-하나의-데이터율.json" />}}

뒤의 드라이브 산정 절에서 추정한 2.5~5GB/s 범위 안에서 HDD 풀의 현실 처리량을 3GB/s로 잡으면 ProRes 422 HQ UHD 25p는 약 32스트림을 읽을 수 있습니다. 편집자당 2스트림을 쓰는 작업이라면 10~15명이 HDD 풀에서 직접 편집할 수 있고, 4캠 멀티캠이면 6~7명입니다. 프록시와 XAVC 같은 카메라 원본은 인원 제한이 사실상 없습니다.

데이터율이 높아지면 HDD에서 처리할 수 있는 스트림 수가 줄어듭니다. 예를 들어 Quantum의 2017년 레퍼런스 아키텍처에서는 HDD 기반 4K 구성을 비압축 4K 2스트림으로 잡았습니다. 파일을 자주 열거나 프레임 단위로 건너뛰며 읽는 작업도 플래시가 필요합니다.

플래시 풀에는 다음 작업을 둡니다.

- 스트림 하나가 300MB/s를 넘는 포맷. 8K ProRes 422 HQ 이상, Blackmagic RAW 8K 5:1 이상, ARRIRAW, DPX와 EXR
- 스트림 하나가 초당 24개 이상의 파일을 여는 이미지 시퀀스
- 컬러, 피니싱, VFX 컨폼처럼 프레임 단위로 건너뛰며 읽는 작업
- 6앵글 이상의 멀티캠

인제스트와 렌더 출력도 플래시 풀이 필요한 작업입니다. HDD 풀에서 편집하는 동안 복사가 섞이면 재생이 끊깁니다.

## 자동 계층화 없이 배치를 정하는 ZFS {#no-tiering}

작업별 배치 기준을 정해도 ZFS가 소재를 알아서 옮겨 주지는 않습니다. 자주 쓰는 데이터를 플래시로, 사용이 뜸해진 데이터를 HDD로 옮기는 자동 계층화가 없기 때문입니다. 풀과 풀 사이에서 데이터를 옮기는 기능도 없습니다.

풀 안에서 블록의 저장 위치를 정하는 장치는 special vdev와 dedup vdev 같은 할당 클래스, 그리고 L2ARC 캐시뿐입니다. 무엇을 플래시에 둘지는 사람이나 설정이 정해야 합니다.

| 방식 | 플래시에 놓이는 것 | 옮기는 주체 |
|---|---|---|
| 풀 두 개 | NVMe 풀의 데이터셋 전부 | 복제 작업, 스크립트, 사람 |
| 단일 풀 + special vdev | 메타데이터, `special_small_blocks` 이하 블록 | 데이터셋 속성. 이미 쓴 블록은 그대로 |
| L2ARC | ARC에서 곧 밀려날 반복 읽기 블록의 복사본 | ZFS가 자동으로 처리. 계층이 아닌 캐시 |
| MAM·HSM의 아카이브 기능 | 도구의 정책이 정한 것 | 서드파티 도구 |

L2ARC는 200TB 핫 티어로 쓸 수 없습니다. 기본 설정에서 프리페치로 읽은 순차 블록을 담지 않는 데다, 채우는 속도도 장치당 32MiB/s로 제한돼 있습니다. 200TB 장치 하나를 채우는 데 약 69일이 걸린다는 계산입니다.

MAM이나 HSM 도구의 TrueNAS 연동은 이번에 확인하지 못했습니다. 이 글에서는 풀 두 개와 단일 풀 special vdev를 비교합니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처 |
|---|---|---|
| 할당 클래스 | special, dedup | OpenZFS zpoolconcepts(7) |
| `l2arc_noprefetch` | 기본 1 | OpenZFS zfs(4) |
| `l2arc_write_max` | 기본 장치당 32MiB/s | OpenZFS zfs(4) |
| 200TB 채우는 시간 | 200TB ÷ 33.5MB/s ≈ 6.0×10^6초 ≈ 69일 | 계산 |

{{< /details >}}

## 경로와 장애 범위로 고르는 풀 두 개와 단일 풀 {#two-layouts}

### 프로젝트 이동이 필요한 NVMe 풀과 HDD 풀

풀을 둘로 나누면 NVMe 풀에는 진행 중인 프로젝트와 인제스트, 8K·RAW 소재를 두고 HDD 풀에는 니어라인과 보관 소재를 둡니다. 아래 그림에서는 두 풀이 같은 헤드에 연결돼 있으면서 저장 영역은 분리돼 있다는 점을 보면 됩니다.

{{< flow src="_flow/2-1-풀-두-개.json" />}}

두 풀은 장애 범위가 분리됩니다. NVMe 풀이 손실돼도 HDD 풀은 남고, HDD 풀이 손실돼도 NVMe 풀은 남습니다. RAID 방식과 recordsize, 스냅샷 보존 기간도 풀마다 따로 정할 수 있습니다.

프로젝트가 끝나면 TrueNAS의 복제 작업이나 `zfs send`로 데이터셋을 HDD 풀로 옮깁니다. 같은 헤드 안에서 옮기므로 네트워크를 타지 않습니다. 경로는 둘이어서 소재를 옮긴 뒤 편집 프로그램에서 미디어를 다시 연결해야 합니다. “프로젝트 종료 후 며칠 뒤 아카이브” 같은 규칙은 사람이나 스크립트가 맡습니다.

HDD 풀에는 수 TB 크기의 메타데이터용 special vdev를 붙여 폴더 탐색과 작은 파일 읽기를 빠르게 합니다.

### 경로 하나를 유지하는 special vdev

앞 그림과 달라지는 곳은 플래시의 역할입니다. 같은 드라이브를 풀 하나로 묶으면 플래시는 HDD 풀의 special vdev가 됩니다. 아래 그림에서는 플래시와 HDD가 한 풀에 속하고, 데이터셋 속성이 블록의 저장 위치를 정한다는 점을 보면 됩니다.

{{< flow src="_flow/2-2-풀-하나에-special.json" />}}

`special_small_blocks`는 이 값 이하의 블록을 special vdev에 쓰라는 데이터셋 속성입니다. 값을 해당 데이터셋의 recordsize 이상으로 두면 데이터셋의 모든 블록이 플래시에 놓입니다. 경로 하나를 유지하면서 데이터셋 설정만으로 진행 중인 작업을 플래시에 둘 수 있습니다.

special vdev의 전체 공간을 일반 블록으로 채울 수는 없습니다. 기본값으로 75%까지만 일반 블록을 받고 나머지 25%는 메타데이터용으로 남기므로, 200TB면 일반 블록에 쓸 수 있는 공간은 약 150TB입니다. special vdev가 차면 새 블록은 알림 없이 HDD에 기록됩니다. 성능이 떨어져도 오류는 나지 않습니다.

속성을 바꿔도 이미 쓴 블록은 움직이지 않습니다. 이미 쓴 블록을 옮기려면 `zfs rewrite`나 복사가 필요하며, `zfs rewrite`가 special 배치 변경을 반영하는지는 실측으로 확인해야 합니다.

장애 범위도 넓어집니다. special vdev를 잃으면 HDD를 포함한 풀 전체를 잃습니다. OpenZFS 2.3에서는 special vdev를 미러로 두는 것이 현실적이며, 미러 special vdev에는 플래시가 두세 배 필요합니다. 200TB special vdev를 3중 미러로 두면 raw 600TB가 듭니다. RAIDZ special vdev는 OpenZFS 2.4부터 허용됩니다.

TrueNAS 27은 OpenZFS 2.4 기반으로, 2026년 12월 초 출시 예정입니다. RC.1 발표에서는 RAIDZ special vdev와 Enterprise 전용 데이터셋 계층화 기능을 예고했습니다. OpenZFS 2.4 기능 플래그를 켠 풀은 25.10으로 되돌릴 수 없습니다. 이 기능을 쓰려고 RC를 운영에 올리는 일은 피해야 합니다.

| | 풀 두 개 | 단일 풀 + special 200TB |
|---|---|---|
| 경로 | 둘. 이동 후 재연결 필요 | 하나 |
| 장애 범위 | 풀별로 분리 | special 200TB 손실이 HDD 800TB를 포함한 풀 전체 손실 |
| 플래시 실사용 | RAIDZ2로 raw의 약 80% | 미러로 raw의 33~50%, 그중 75% |
| 가득 찼을 때 | 쓰기 실패로 드러남 | 알림 없이 HDD에 기록 |
| 이동 | 복제 작업·스크립트 | 속성 변경 + 재작성 |
| 버전 | 25.10에서 바로 가능 | 27 정식 출시 뒤 검토 |

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처 |
|---|---|---|
| `special_small_blocks` | 0~16MiB. 이 값 이하 블록을 special 클래스로 | OpenZFS zfsprops(7) |
| recordsize 이상으로 설정 시 | 데이터셋 전체가 special에 | TrueNAS 포럼 special vdev 스레드 |
| `zfs_special_class_metadata_reserve_pct` | 기본 25 | OpenZFS zfs(4) |
| special vdev의 일반 블록 공간 | 기본 75%까지 사용, 나머지 25%는 메타데이터용. 200TB면 약 150TB | 기본값에 따른 계산 |
| OpenZFS 2.3의 special 200TB | 미러로만 구성. 3중 미러는 raw 600TB 필요 | 구성 조건·계산 |
| `zfs rewrite` | OpenZFS 2.3.4에서 도입. NOTES가 명시한 속성은 checksum, compression, dedup, copies | OpenZFS zfs-rewrite(8) |
| RAIDZ special 허용 | OpenZFS 2.4, PR #17496 | TrueNAS 27 RC.1 발표 |
| TrueNAS 하이브리드 풀 설명 | "Assign datasets or LUNs to the flash tier" | TrueNAS 26 BETA.1 발표 |

{{< /details >}}

## 플래시 200TB와 HDD 800TB에 필요한 드라이브 {#layout}

이 글에서 가용 공간은 데이터 디스크 용량에 0.96을 곱한 값입니다. slop 공간 1/32과 메타데이터 약 1%를 뺐고, recordsize는 1M으로 뒀습니다. 표의 “80% 실사용”은 풀을 80%까지만 채울 때 쓸 수 있는 양을 뜻합니다.

### 여유 공간을 포함한 HDD 800TB

800TB를 80% 아래로 채워 쓰려면 32TB 50개나 26TB 52개가 필요합니다. 둘 다 60베이 JBOD 한 대에 들어갑니다. 풀 크기가 800TB면 되는 경우에는 32TB 42개로 충분합니다.

| 구성 | 드라이브 | 가용 | 80% 실사용 |
|---|---|---|---|
| RAIDZ2 12폭 4개, 32TB, 스페어 2 | 50 | 1,229TB | 983TB |
| RAIDZ2 10폭 4개, 32TB, 스페어 2 | 42 | 983TB | 786TB |
| RAIDZ2 12폭 3개, 32TB, 스페어 2 | 38 | 922TB | 737TB |
| RAIDZ2 10폭 5개, 26TB, 스페어 2 | 52 | 998TB | 799TB |
| dRAID2 8데이터 60대 스페어 2, 24TB | 60 | 1,069TB | 855TB |

2026년 11월에 살 수 있는 CMR 최대 용량은 Seagate Exos M 32TB입니다. HAMR 기록 방식을 쓰며 최대 지속 전송률은 285MB/s입니다. 36TB 모델과 WD의 32TB는 SMR이어서 ZFS에 쓰지 않습니다. WD의 CMR 최대는 26TB입니다.

데이터 디스크 40개를 쓰는 구성의 순차 처리량은 이론상 약 8GB/s입니다. 편집자 여러 명이 읽으며 탐색이 섞이는 상황에서는 2.5~5GB/s로 추정했습니다. 디스크 수와 개별 드라이브의 전송률을 곱한 값 그대로 편집 처리량을 잡지는 않았습니다.

HDD 풀에서는 긴 리실버가 큰 위험입니다. RAIDZ2에서 32TB 드라이브 한 개를 평균 150MB/s로 다시 쓰면 약 2.5일이 걸리며, 편집 부하가 걸리면 3~5일로 늘어난다고 봤습니다.

dRAID의 분산 스페어를 쓰면 리빌드 속도가 디스크 수를 스트라이프 폭으로 나눈 값에 비례해 빨라집니다. 60대에 폭 10이면 약 6배입니다. 대신 스트라이프 폭이 고정돼 작은 블록의 공간 낭비가 크며, OpenZFS 문서는 미러 special vdev를 함께 두라고 권합니다.

HDD 풀의 메타데이터용 special vdev에는 3.84~7.68TB NVMe 3중 미러를 권합니다. 블록 포인터에 필요한 약 116GB에 간접 블록과 작은 파일을 위한 공간을 더해 1~3TB로 봤습니다. 프로젝트 파일과 썸네일까지 `special_small_blocks=64K`로 담으려면 7.68TB가 맞습니다.

### RAIDZ2로 구성한 플래시 200TB

플래시 풀은 15.36TB 24개를 RAIDZ2 12폭 2개로 묶는 구성을 기준으로 삼았습니다. 풀을 80%까지 채워도 236TB를 쓸 수 있어 200TB 요구를 넘습니다.

| 구성 | 드라이브 | 가용 | 80% 실사용 | 특징 |
|---|---|---|---|---|
| RAIDZ2 12폭 2개, 15.36TB | 24 | 295TB | 236TB | 24베이를 채움. 리실버가 짧음 |
| RAIDZ2 6폭 2개, 30.72TB | 12 | 236TB | 189TB | 베이 절반이 남아 확장 가능 |
| RAIDZ2 12폭 1개, 30.72TB | 12 | 295TB | 236TB | vdev가 하나 |
| 2중 미러 9쌍, 30.72TB | 18 | 265TB | 212TB | IOPS가 가장 높음. 같은 쌍에서 두 번째 고장이 나면 풀 손실 |
| dRAID2 8데이터 24대 스페어 2, 15.36TB | 24 | 270TB | 216TB | NVMe에서는 이득이 작음 |

NVMe는 리실버가 빨라 RAIDZ2로도 위험 구간이 짧습니다. 30.72TB 한 개를 2GB/s로 다시 쓰면 약 4.3시간, 15.36TB는 약 2시간입니다.

드라이브 24개의 원성능 합은 100GB/s를 넘지만, 실제 상한은 ZFS와 CPU, Samba, NIC에서 정해집니다. 렌더 결과물 쓰기가 많다면 QLC보다 TLC 드라이브가 맞습니다.

### 두 풀을 연결하는 헤드와 주변 장비

TrueNAS 제품으로는 V-Series Hybrid Flash가 이 구성에 맞습니다. HDD와 NVMe를 한 시스템에 두고 200GbE나 400GbE를 지원하며, 듀얼 컨트롤러 HA를 갖춥니다.

화이트박스로 구성하면 2U 24베이 NVMe 서버에 외장 SAS HBA 두 장으로 4U 60베이 JBOD를 멀티패스 연결합니다. NVMe와 NIC, HBA를 합쳐 PCIe 레인이 130개 가까이 필요한 구성입니다. 화이트박스는 단일 헤드여서 컨트롤러 이중화가 없습니다.

RAM은 512GB를 기준으로 잡았습니다. 편집자가 40명에 가깝거나 플래시 풀에서 반복 재생이 많으면 1TB를 권합니다. 순차 재생에서는 ARC 적중 이득이 작아 RAM은 메타데이터와 프리페치 버퍼를 담는 용도입니다. 벤더 공식 권장량은 찾지 못했습니다.

전력은 HDD와 JBOD, NVMe, 헤드의 소비량을 합쳐 1.8~2.3kW로 추정했습니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처·계산 |
|---|---|---|
| RAIDZ2 12폭 4개, 32TB | 40 × 32 = 1,280TB, ×0.96 = 1,229TB | 계산 |
| Exos M 32TB | CMR, 285MB/s, 2026-01 판매 | Seagate 데이터시트 |
| HDD 순차 처리량 | 데이터 디스크 40개 × 디스크당 평균 200MB/s = 이론상 약 8GB/s | 계산 |
| 탐색이 섞인 HDD 처리량 | 이론값의 30~60%, 2.5~5GB/s | 이 글의 추정 |
| HDD 리실버 | 32TB ÷ 150MB/s ≈ 213,000초 | 계산 |
| dRAID 리빌드 | 디스크 수 ÷ (데이터+패리티)에 비례 | OpenZFS dRAID Howto |
| 메타데이터 공간 산정 | 1PB를 1MiB 레코드로 나누면 약 9.1억 블록. 블록 포인터 128바이트를 곱하면 약 116GB | 계산 |
| RAIDZ2 12폭 2개, 15.36TB | 20 × 15.36 = 307TB, ×0.96 = 295TB | 계산 |
| NVMe 리실버 | 30.72TB ÷ 2GB/s = 15,360초 | 계산 |
| 고용량 QLC NVMe | 장치당 순차 읽기 약 7GB/s, 쓰기 약 3GB/s | StorageReview, Solidigm D5-P5336 |
| V-Series Hybrid Flash | HDD raw 40PB, NVMe raw 14PB, ES102 14대 | V-Series 제품 페이지 |
| 화이트박스 PCIe 레인 | NVMe 24개가 96레인, 400GbE NIC가 16레인, HBA 두 장이 16레인 | 구성에 따른 계산 |
| 전력 | HDD 50개 약 475W, JBOD 150~250W, NVMe 24개 500~600W, 헤드 600~800W. 합계 1.8~2.3kW | 이 글의 추정 |

{{< /details >}}

## 단일 헤드의 장애와 1PB 풀의 운영 위험 {#operations}

단일 헤드는 컨트롤러나 메인보드 하나만 고장 나도 전체가 멈춥니다. 컨트롤러 이중화가 필요하면 TrueNAS Enterprise 하드웨어를 써야 합니다. 셸프는 어느 쪽이든 SAS 경로를 둘로 둡니다.

스냅샷은 백업이 아닙니다. 1PB 전체를 다른 장비로 복제하려면 같은 규모의 HDD 시스템이 한 대 더 필요합니다. 진행 중인 프로젝트와 확정된 원본만 2차 사본 대상으로 정하고, 카메라 원본은 다른 사본을 몇 벌 둘지 정책으로 정하는 쪽이 현실적입니다.

풀이 차면 할당 성능이 떨어집니다. OpenZFS 문서는 빈 공간을 10% 넘게 유지하라고 권하고, 이 글의 표는 여유를 더 둬 80%까지 채우는 것으로 계산했습니다. 할당이 느려지는 이유는 [04]({{< relref "/data/media-nas/04-openzfs/index.md" >}})에서 설명합니다. 미디어 데이터셋에 스냅샷을 오래 보존하면 지운 클립의 공간이 해제되지 않아 채움률이 빨리 오릅니다. 스냅샷 보존 기간은 짧게 둡니다.

1PB HDD 풀의 스크럽은 한 번에 며칠이 걸리고 그동안 편집 성능을 깎습니다. 주말에 돌도록 일정을 잡아야 합니다. 시간 범위를 나눠 스크럽하는 `zpool scrub -S -E`는 OpenZFS 2.4 기능이어서 TrueNAS 27부터 쓸 수 있습니다.

## 확인하지 못한 것 {#unverified}

- `zfs rewrite`가 `special_small_blocks` 변경을 반영해 블록을 다시 배치하는지
- TrueNAS 27의 데이터셋 계층화 기능의 동작과 Community 제공 여부
- TrueNAS HA가 iXsystems 하드웨어 전용이라는 문서 근거
- MAM·HSM 도구의 TrueNAS 연동
- 단일 헤드에서 HDD 풀과 NVMe 풀을 함께 쓸 때의 SMB 실측
- 2026년 WD의 CMR 신제품

## 참고 자료 {#references}

- [TrueNAS 소프트웨어 상태](https://www.truenas.com/docs/softwarestatus/)
- [TrueNAS 25.10 버전 노트](https://www.truenas.com/docs/scale/25.10/gettingstarted/versionnotes/)
- [TrueNAS 27 RC.1 기능](https://www.truenas.com/blog/truenas-27-rc1-feature-set/)
- [TrueNAS 26 BETA.1 발표](https://www.truenas.com/blog/blog-truenas-26-beta1-release)
- [TrueNAS V-Series 제품 페이지](https://www.truenas.com/v-series/)
- [TrueNAS 미디어·엔터테인먼트 최적화 가이드](https://www.truenas.com/docs/solutions/optimizations/mediaentertainment/)
- [TrueNAS 포럼, special vdev 계획과 사이징](https://forums.truenas.com/t/special-vdev-svdev-planning-sizing-and-considerations/5086)
- [OpenZFS zpoolconcepts(7)](https://openzfs.github.io/openzfs-docs/man/master/7/zpoolconcepts.7.html)
- [OpenZFS zfsprops(7)](https://openzfs.github.io/openzfs-docs/man/master/7/zfsprops.7.html)
- [OpenZFS zfs(4) 모듈 파라미터](https://openzfs.github.io/openzfs-docs/man/master/4/zfs.4.html)
- [OpenZFS zfs-rewrite(8)](https://openzfs.github.io/openzfs-docs/man/master/8/zfs-rewrite.8.html)
- [OpenZFS dRAID Howto](https://openzfs.github.io/openzfs-docs/Basic%20Concepts/Pool%20Structure/dRAID%20Howto.html)
- [Seagate Exos M 데이터시트](https://www.seagate.com/content/dam/seagate/en/content-fragments/products/datasheets/exos-m-v1-2/exos-v1-2-DS2045-4-2511-en_US.pdf)
- [StorageReview, Solidigm D5-P5336 122.88TB](https://www.storagereview.com/review/solidigm-122-88tb-d5-p5336-review-high-capacity-storage-meets-operational-efficiency)
- [Quantum 4K 레퍼런스 아키텍처](https://www.svconline.com/products/quantum-4k-video-reference-architectures-408620)
- [Apple ProRes White Paper](https://www.apple.com/final-cut-pro/docs/Apple_ProRes.pdf)
- [Avid DNxHR Codec Bandwidth Specifications](https://kb.avid.com/pkb/articles/en_US/Knowledge/DNxHR-Codec-Bandwidth-Specifications)
- [Blackmagic URSA Cine 12K LF 사양](https://www.blackmagicdesign.com/products/blackmagicursacine/techspecs/W-CIN-12)
