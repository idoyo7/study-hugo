---
title: "플래시 200TB와 HDD 800TB로 나누는 ZFS 미디어 NAS"
linkTitle: "02 1PB 플래시·HDD 분할"
description: "현행 TrueNAS 25.10에서 플래시 200TB와 HDD 800TB를 별도 풀로 나누는 구성과 작업 배치를 살핀다. 필요한 드라이브 수와 special vdev의 용량·장애 제약을 비교한다."
weight: 2
date: 2026-11-17
lastmod: 2026-11-17
url: "/media-nas/02-1pb-flash-hdd-split/"
---

# 02 · 플래시 200TB와 HDD 800TB로 나누는 ZFS 미디어 NAS

1PB 편집 스토리지를 플래시 200TB와 HDD 800TB로 나누려면, 현행 TrueNAS 25.10(OpenZFS 2.3 계열)에서는 한 헤드에 NVMe 풀과 HDD 풀을 따로 두는 쪽을 권합니다. 플래시를 HDD 풀의 special vdev로 쓰는 구성은 TrueNAS 27 정식 출시 뒤 검토할 선택지입니다.

구성별 성능과 편집자 수별 요구 대역은 [01]({{< relref "/data/media-nas/01-truenas-performance-range/index.md" >}})에서 다뤘습니다. 용량은 1TB = 10^12바이트 기준이며, 드라이브 수와 처리량은 이 글의 계산·추정입니다.

## 작업에 따른 플래시와 HDD 배치 {#placement}

HDD에서 직접 편집할 수 있는지는 스트림의 데이터율과 읽기 방식으로 판단합니다. 아래 그림에서는 포맷에 따라 필요한 처리량이 얼마나 달라지는지 보면 됩니다.

{{< lane src="_lane/4-스트림-하나의-데이터율.json" />}}

데이터율이 높은 포맷일수록 HDD에서 읽을 수 있는 스트림 수가 줄어듭니다. 파일을 자주 열거나 프레임 단위로 건너뛰며 읽는 작업도 플래시가 필요합니다.

데이터 디스크 40개인 HDD 구성에서 탐색이 섞인 편집 처리량은 2.5~5GB/s로 추정했습니다. 이 범위 안에서 3GB/s로 잡으면 ProRes 422 HQ UHD 25p를 편집자당 2스트림씩 읽는 작업은 10~15명, 4캠 멀티캠은 6~7명이 편집할 수 있습니다.

플래시에는 아래 작업을 둡니다.

- 스트림 하나가 300MB/s를 넘는 포맷
- 스트림 하나가 초당 24개 이상의 파일을 여는 이미지 시퀀스
- 컬러·피니싱·VFX 컨폼처럼 프레임 단위로 건너뛰며 읽는 작업
- 6앵글 이상의 멀티캠

인제스트와 렌더 출력도 플래시에 둡니다. HDD에서 편집하는 동안 복사가 섞이면 재생이 끊깁니다.

## 경로와 장애 범위로 고르는 풀 구성 {#two-layouts}

ZFS에는 사용 빈도에 따라 소재를 옮기는 자동 계층화가 없습니다. 풀 사이 이동은 복제 작업이나 스크립트, 사람이 맡습니다. L2ARC도 기본 설정에서는 프리페치로 읽은 순차 블록을 담지 않아 200TB 핫 티어로 쓸 수 없습니다.

아래 그림에서는 두 풀이 같은 헤드에 연결되지만 저장 영역은 분리돼 있다는 점을 보면 됩니다.

{{< flow src="_flow/2-1-풀-두-개.json" />}}

두 풀의 장애 범위는 분리됩니다. 프로젝트가 끝나면 복제 작업이나 `zfs send`로 HDD 풀에 옮기며, 같은 헤드 안에서 옮기므로 네트워크를 타지 않습니다. 경로가 바뀌어 편집 프로그램에서 미디어를 다시 연결해야 합니다.

앞 그림과 달라지는 곳은 플래시의 역할입니다. 아래 그림에서는 플래시와 HDD가 한 풀에 속하고, 데이터셋 속성이 블록의 저장 위치를 정한다는 점을 보면 됩니다.

{{< flow src="_flow/2-2-풀-하나에-special.json" />}}

`special_small_blocks`를 데이터셋의 recordsize 이상으로 두면 데이터셋의 모든 블록이 플래시에 놓입니다. 경로는 하나로 유지되지만, special vdev를 잃으면 HDD를 포함한 풀 전체를 잃습니다.

기본 설정에서는 special vdev 공간의 25%를 메타데이터용으로 남깁니다. 200TB 중 일반 블록에 쓸 수 있는 공간은 약 150TB이며, special vdev가 차면 새 블록은 알림 없이 HDD에 기록됩니다.

속성을 바꿔도 이미 쓴 블록은 움직이지 않습니다. 재배치에는 `zfs rewrite`나 복사가 필요하며, `zfs rewrite`가 special 배치 변경을 반영하는지는 실측으로 확인해야 합니다.

OpenZFS 2.3에서는 special vdev를 미러로 두는 것이 현실적입니다. 200TB를 3중 미러로 구성하면 raw 600TB가 필요합니다. RAIDZ special vdev는 OpenZFS 2.4부터 허용되므로 이를 쓰는 TrueNAS 27 정식 출시 뒤 검토합니다.

이 기능을 쓰려고 RC를 운영에 올리는 일은 피해야 합니다. OpenZFS 2.4 기능 플래그를 켠 풀은 25.10으로 되돌릴 수 없습니다.

## 플래시 200TB와 HDD 800TB에 필요한 드라이브 {#layout}

가용 공간은 데이터 디스크 용량에 0.96을 곱해 계산했습니다. slop 공간 1/32과 메타데이터 약 1%를 뺐고, recordsize는 1M으로 뒀습니다. 표의 “80% 실사용”은 풀을 80%까지만 채울 때 쓸 수 있는 양입니다.

| 풀 | RAIDZ2 구성 | 드라이브 수 | 가용 | 80% 실사용 |
|---|---|---|---|---|
| HDD | 32TB, 12폭 4개, 스페어 2 | 50 | 1,229TB | 983TB |
| HDD | 32TB, 10폭 4개, 스페어 2 | 42 | 983TB | 786TB |
| HDD | 26TB, 10폭 5개, 스페어 2 | 52 | 998TB | 799TB |
| NVMe | 15.36TB, 12폭 2개 | 24 | 295TB | 236TB |
| NVMe | 30.72TB, 12폭 1개 | 12 | 295TB | 236TB |

HDD 풀 크기가 800TB면 되는 경우에는 32TB 42개로 충분합니다. 플래시 풀은 15.36TB 24개 구성을 기준으로 삼았습니다.

HDD의 긴 리실버는 운영 위험입니다. 32TB 한 개를 평균 150MB/s로 다시 쓰면 약 2.5일이 걸리는 계산이며, 편집 부하가 걸리면 3~5일로 늘어난다고 봤습니다.

HDD 풀의 메타데이터용 special vdev에는 3.84~7.68TB NVMe 3중 미러를 권합니다. 프로젝트 파일과 썸네일까지 `special_small_blocks=64K`로 담으려면 7.68TB가 맞습니다.

컨트롤러 이중화가 필요하면 듀얼 컨트롤러 HA와 200GbE·400GbE를 지원하는 TrueNAS V-Series Hybrid Flash가 이 구성에 맞습니다. 화이트박스는 NVMe 서버에 외장 SAS HBA로 JBOD를 멀티패스 연결하는 구성이며, 단일 헤드의 컨트롤러나 메인보드가 고장 나면 전체가 멈춥니다.

RAM은 512GB를 기준으로 잡았습니다. 편집자가 40명에 가깝거나 플래시 풀에서 반복 재생이 많으면 1TB를 권합니다. 벤더 공식 권장량은 찾지 못했습니다.

풀은 80%를 넘기면 할당 성능이 떨어집니다. 스냅샷을 오래 보존하면 지운 클립의 공간이 해제되지 않으므로 보존 기간은 짧게 둡니다.

스냅샷은 백업이 아닙니다. 전체를 복제하려면 같은 규모의 HDD 시스템이 더 필요합니다. 진행 중인 프로젝트와 확정된 원본을 2차 사본 대상으로 정하는 쪽이 현실적입니다.

## 확인하지 못한 것 {#unverified}

- `zfs rewrite`가 `special_small_blocks` 변경을 반영해 블록을 다시 배치하는지
- TrueNAS 27 데이터셋 계층화 기능의 동작과 Community 제공 여부
- TrueNAS HA가 iXsystems 하드웨어 전용이라는 문서 근거
- 단일 헤드에서 HDD 풀과 NVMe 풀을 함께 쓸 때의 SMB 실측

{{< details title="근거와 측정 조건" closed="true" >}}

| 항목 | 값 | 출처·조건 |
|---|---|---|
| 드라이브 용량 산정 | 표의 가용·80% 실사용 용량 | 이 글의 계산. 1TB = 10^12바이트, recordsize 1M. slop 1/32과 메타데이터 약 1%를 빼고 데이터 디스크 용량에 0.96 적용 |
| HDD 편집 처리량 | 2.5~5GB/s | 데이터 디스크 40개에서 탐색이 섞이는 상황을 이 글이 추정 |
| ProRes 편집 인원 | 2스트림씩 10~15명, 4캠이면 6~7명 | Apple ProRes 데이터율과 HDD 처리량 3GB/s를 기준으로 계산. ProRes 422 HQ UHD 25p |
| 플래시 배치 기준 | 스트림당 300MB/s 초과, 이미지 시퀀스 스트림당 초당 24파일 이상, 6앵글 이상 | 이 글의 작업별 배치 기준 |
| special 일반 블록 공간 | 200TB 중 약 150TB | OpenZFS zfs(4)의 기본 메타데이터 예약 25%에 따른 계산 |
| special 구성과 버전 | 200TB 3중 미러에 raw 600TB, RAIDZ special은 OpenZFS 2.4부터 | 미러 용량은 계산. 버전 조건은 TrueNAS 25.10 버전 노트·27 RC.1 발표 |
| HDD 리실버 | 약 2.5일, 편집 부하 시 3~5일 | 32TB ÷ 평균 150MB/s로 계산. 부하가 걸린 시간은 이 글의 추정 |
| HDD 메타데이터용 플래시 | 3.84~7.68TB NVMe 3중 미러 | 이 글의 권고. `special_small_blocks=64K`로 프로젝트 파일·썸네일까지 담으면 7.68TB |
| 서버 NIC | 200GbE·400GbE | TrueNAS V-Series 공식 지원 사양 |
| RAM | 기준 512GB, 편집자 약 40명 또는 반복 재생이 많으면 1TB | 이 글의 권고. 벤더 공식 권장량은 확인하지 못함 |

{{< /details >}}

## 참고 자료 {#references}

- [TrueNAS 25.10 버전 노트](https://www.truenas.com/docs/scale/25.10/gettingstarted/versionnotes/)
- [TrueNAS 27 RC.1 기능](https://www.truenas.com/blog/truenas-27-rc1-feature-set/)
- [TrueNAS V-Series 제품 페이지](https://www.truenas.com/v-series/)
- [TrueNAS 포럼, special vdev 계획과 사이징](https://forums.truenas.com/t/special-vdev-svdev-planning-sizing-and-considerations/5086)
- [OpenZFS zfsprops(7)](https://openzfs.github.io/openzfs-docs/man/master/7/zfsprops.7.html)
- [OpenZFS zfs(4) 모듈 파라미터](https://openzfs.github.io/openzfs-docs/man/master/4/zfs.4.html)
- [OpenZFS zfs-rewrite(8)](https://openzfs.github.io/openzfs-docs/man/master/8/zfs-rewrite.8.html)
- [Apple ProRes White Paper](https://www.apple.com/final-cut-pro/docs/Apple_ProRes.pdf)
- [Avid DNxHR Codec Bandwidth Specifications](https://kb.avid.com/pkb/articles/en_US/Knowledge/DNxHR-Codec-Bandwidth-Specifications)
- [Blackmagic URSA Cine 12K LF 사양](https://www.blackmagicdesign.com/products/blackmagicursacine/techspecs/W-CIN-12)
