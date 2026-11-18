---
title: "ZFS 미디어 NAS"
date: 2026-11-17
lastmod: 2026-11-17
weight: 36
comments: false
cascade:
  type: docs
url: "/media-nas/"
linkTitle: "ZFS 미디어 NAS"
---

# ZFS 미디어 NAS — 영상 편집실에 SMB·NFS를 내주는 스토리지 서버

## 이 분류에서 찾기 {#section-navigation}

- [01 구성별 성능 범위]({{< relref "/data/media-nas/01-truenas-performance-range/index.md" >}})
- [02 1PB 플래시·HDD 분할]({{< relref "/data/media-nas/02-1pb-flash-hdd-split/index.md" >}})
- [03 ZFS와 TrueNAS 구조]({{< relref "/data/media-nas/03-zfs-truenas-architecture/index.md" >}})
- [04 OpenZFS]({{< relref "/data/media-nas/04-openzfs/index.md" >}})

영상 편집실의 공유 스토리지는 편집자 워크스테이션의 10GbE와 스토리지 서버의 100~400GbE 사이에서 성능이 정해집니다. 이 분류는 ZFS 기반 TrueNAS로 SMB와 NFS 공유를 낼 때 구성별로 어느 정도의 대역이 나오는지, 편집자 수와 코덱에 따라 무엇이 최소선인지, 플래시와 HDD를 한 서버에 어떻게 나눠 담는지를 다룹니다. ZFS와 TrueNAS의 동작 원리가 낯설면 03부터 읽으셔도 됩니다.

기준 버전은 TrueNAS 25.10.8과 OpenZFS 2.3 계열이고, 하드웨어 수치는 2026년 9월판 TrueNAS V-Series 데이터시트에서 가져왔습니다. 공식 수치와 제3자 실측, 이 글의 추정을 구분해 적었고 수치의 출처와 조건은 각 절 끝의 접힌 표에 모았습니다.

## 문서 지도

| 문서 | 다루는 것 |
|---|---|
| [01 구성별 성능 범위]({{< relref "/data/media-nas/01-truenas-performance-range/index.md" >}}) | V-Series All-Flash·Hybrid Flash·Hybrid Cache의 사양과 공식 상한의 Gb/s 환산, SMB 편집 워크로드의 현실 범위, SLOG·L2ARC·special vdev가 듣는 곳, 프로토콜 지원 상태, 편집자 수와 코덱별 최소 요구, 편집실 규모별 권장 서버 사양과 예산 추정 |
| [02 1PB 플래시·HDD 분할]({{< relref "/data/media-nas/02-1pb-flash-hdd-split/index.md" >}}) | 풀 두 개와 단일 풀 special vdev 방식의 비교, 플래시 200TB와 HDD 800TB의 드라이브 수와 가용 용량, 처리량과 리실버 시간, 소재를 어느 풀에 둘지의 기준, 운영 위험 |
| [03 ZFS와 TrueNAS 구조]({{< relref "/data/media-nas/03-zfs-truenas-architecture/index.md" >}}) | 메모리와 풀의 계층, 트랜잭션 그룹으로 묶어 내리는 쓰기와 dirty 버퍼 한도, ZIL과 SLOG, ARC와 프리페치·L2ARC, RAM이 하는 일, TrueNAS의 프로토콜 구현과 듀얼 컨트롤러 HA 전환 순서 |
| [04 OpenZFS]({{< relref "/data/media-nas/04-openzfs/index.md" >}}) | 블록 포인터로 엮은 트리와 copy-on-write, 스냅샷과 증분 send가 블록을 복사하지 않는 이유, 체크섬·압축·중복 제거·블록 클로닝·암호화, RAIDZ의 공간 계산과 확장, feature flag와 vdev 제거 제약, Sun에서 2.4까지의 계보와 버전별 기능 |
