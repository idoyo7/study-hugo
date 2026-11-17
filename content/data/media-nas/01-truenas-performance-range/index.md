---
title: "10GbE 편집실에 맞춘 TrueNAS V-Series 성능과 구성"
linkTitle: "01 구성별 성능 범위"
description: "편집자 수와 코덱에 맞는 서버 NIC를 산정하고, TrueNAS V-Series의 구성별 사양과 공식 상한을 SMB 성능 추정과 비교한다. HDD·NVMe 풀과 캐시 장치의 제약도 살핀다."
weight: 1
date: 2026-11-17
lastmod: 2026-11-17
url: "/media-nas/01-truenas-performance-range/"
---

# 01 · 10GbE 편집실에 맞춘 TrueNAS V-Series 성능과 구성

ProRes 422 HQ UHD를 쓰는 편집자 20명까지는 서버 쪽 100GbE 한두 포트로 충분합니다. 200GbE 이상이 필요한 구간은 8K RAW나 비압축 시퀀스를 10명 넘게 함께 쓸 때입니다. 서버 NIC를 고를 때는 필요한 대역과 스토리지가 실제로 낼 수 있는 대역을 따로 봐야 합니다.

기준 버전은 TrueNAS 25.10.8이며, 하드웨어 수치는 2026년 9월판 V-Series 데이터시트에서 가져왔습니다. 1PB를 플래시와 HDD로 나누는 풀 구성은 [02]({{< relref "/data/media-nas/02-1pb-flash-hdd-split/index.md" >}})에서 다룹니다.

## 편집자 수와 코덱에 맞춘 서버 NIC {#minimum}

ProRes 422 HQ UHD 25p는 스트림당 92MB/s입니다. 데이터율에 스트림 수와 스크러빙·버스트 여유 1.3을 곱해, 2스트림은 편집자당 240MB/s, 4캠은 480MB/s로 계산했습니다. 프록시는 4.5MB/s × 6앵글 × 1.3으로 40MB/s를 잡았고, 8K RAW·비압축은 10GbE 상한인 1,100MB/s로 고정했습니다.

여기에 편집자 10명당 인제스트·렌더·복사 한 건의 부하 1GB/s를 더했습니다. 동시 사용률은 100%로 뒀으므로 실제 운영보다 보수적인 계산입니다. 여유 계수와 사용률은 이 글의 가정이며, 벤더 공식 값은 확인하지 못했습니다.

| 편집자 | 프록시 | ProRes HQ UHD 2스트림 | ProRes HQ 4캠 멀티캠 | 8K RAW·비압축 |
|---|---|---|---|---|
| 5명 | 1.2GB/s = 10Gb/s | 2.2GB/s = 18Gb/s | 3.4GB/s = 27Gb/s | 6.5GB/s = 52Gb/s |
| 10명 | 1.4GB/s = 11Gb/s | 3.4GB/s = 27Gb/s | 5.8GB/s = 46Gb/s | 12.0GB/s = 96Gb/s |
| 20명 | 2.8GB/s = 22Gb/s | 6.8GB/s = 54Gb/s | 11.6GB/s = 93Gb/s | 24.0GB/s = 192Gb/s |
| 40명 | 5.6GB/s = 45Gb/s | 13.6GB/s = 109Gb/s | 23.2GB/s = 186Gb/s | 48.0GB/s = 384Gb/s |

서버 링크 이용률을 70% 아래로 두면 100GbE 한 포트는 약 8GB/s를 안정적으로 전송합니다. 이를 기준으로 서버 NIC와 스토리지 최소 구성을 잡았습니다.

- 약 3GB/s 이하: 100GbE 1포트, 데이터 디스크 40개 안팎의 HDD 풀과 special vdev
- 3~8GB/s: 100GbE 1~2포트, HDD 100대 이상의 하이브리드 또는 NVMe 풀
- 12~25GB/s: 200GbE, NVMe 풀
- 약 48GB/s: 400GbE, NVMe 풀. 단일 헤드 실성능은 PoC 대상

HDD 풀은 대역폭만으로 고를 수 없습니다. iXsystems 백서는 RAIDZ2 HDD 풀에서 함께 작업하는 편집자가 5~10명을 넘으면 IOPS가 한계가 되어 미러가 낫다고 적었습니다. TrueNAS 미디어 가이드도 플래시가 아닌 시스템에서 편집 중 푸티지를 옮기거나 복사하면 재생이 끊긴다고 경고합니다.

## 요청 경로와 V-Series의 성능 범위 {#range}

클라이언트 한 대의 속도와 서버 전체 처리량에는 서로 다른 한계가 걸립니다. 아래 그림에서는 편집자의 요청이 Samba와 ZFS를 거쳐 어느 vdev에 도달하는지 따라가면 됩니다.

{{< flow src="_flow/1-요청이-지나는-자리.json" />}}

클라이언트 한 대는 워크스테이션의 네트워크와 smbd 프로세스 하나의 제약을 받습니다. SMB 멀티채널로 연결을 늘려도 같은 클라이언트의 연결은 한 프로세스가 처리합니다. 클라이언트가 늘면 smbd도 늘어 서버 전체 대역은 커집니다.

ZFS는 ARC에 없는 블록을 풀에서 읽습니다. 큰 영상 블록은 데이터 vdev에 있고, 메타데이터는 special vdev가 있으면 그곳에서 읽습니다. 데이터 vdev에 NVMe를 쓰는지 HDD를 쓰는지에 따라 구성별 성능이 달라집니다.

V-Series는 4U 듀얼 컨트롤러 섀시 하나를 세 가지 구성으로 판매합니다. 전면 24베이는 SAS HDD와 Gen4 NVMe를 함께 받고, 후면에는 Gen5 NVMe 4베이가 있습니다. V160은 같은 섀시에서 Hybrid Flash와 All-Flash를 선택할 수 있는 모델입니다.

| 항목 | Hybrid Cache | Hybrid Flash | All-Flash |
|---|---|---|---|
| 대응 모델 | V140 (추정) | V160 | V160 |
| CPU | 16코어 32스레드 | 32코어 64스레드 | 32코어 64스레드 |
| RAM 최대 | 192GB | 384~768GB | 384~768GB |
| 읽기 캐시 최대 | NVMe 12TB | NVMe 24TB | DRAM |
| 데이터 포트 | 4× 100GbE | 4× 200GbE 또는 2× 400GbE | 4× 200GbE 또는 2× 400GbE |

데이터시트의 대역폭 단위는 GB/s(초당 기가바이트)입니다. NIC의 Gb/s(초당 기가비트)와 비교하려면 8을 곱해야 합니다. 아래 표에는 양쪽 단위를 함께 적었습니다. 공식 상한의 시험 조건은 공개되지 않았습니다. 아래 SMB 범위는 이 글의 추정이며, 읽기는 여러 클라이언트가 대용량 파일을 순차로 읽는 조건입니다.

| 구성 | 공식 시스템 대역폭 | SMB 읽기 추정 | SMB 쓰기 추정 |
|---|---|---|---|
| Hybrid Cache, HDD 60~100대 | 15GB/s = 120Gb/s | 4~10GB/s = 32~80Gb/s | 3~6GB/s = 24~48Gb/s |
| Hybrid Flash, HDD 100~200대 | 30GB/s = 240Gb/s | 8~20GB/s = 64~160Gb/s | 5~12GB/s = 40~96Gb/s |
| All-Flash | 60GB/s = 480Gb/s | 25~50GB/s = 200~400Gb/s | 15~25GB/s = 120~200Gb/s |

All-Flash는 제3자 자료를, HDD 구성은 디스크 대수 산식을 바탕으로 추정했습니다. HDD 구성의 공식 상한은 셸프를 가득 채운 이상적인 순차 조건으로 해석했습니다.

아래 그림에서는 공식 상한과 SMB 추정 범위를 NIC 속도와 견줘 보면 됩니다.

{{< lane src="_lane/2-공식-상한과-현실-범위.json" />}}

포트 합산 대역이 공식 상한을 넘는 All-Flash 구성에서는 NIC보다 ZFS·CPU·Samba 쪽이 병목이라고 봤습니다. HDD 구성은 여러 편집자의 읽기에 탐색이 섞이면 처리량이 더 낮아진다고 봤습니다. 단일 헤드가 SMB로 40GB/s 이상을 실제로 내는지는 도입 전 PoC에서 재야 합니다.

200GbE 이상 NIC를 고를 때는 RDMA 지원 여부도 함께 봐야 합니다. TrueNAS 25.10에서 파일 프로토콜의 RDMA 지원은 NFS 쪽에만 있습니다.

## 영상 편집에서 쓰임이 달라지는 캐시 장치 {#cache}

영상 편집에서 Hybrid Cache의 실효 성능은 HDD 풀의 성능으로 봐야 합니다. 플래시 캐시가 있다고 해서 HDD 풀이 플래시처럼 빨라지지는 않습니다.

아래 그림에서는 SLOG가 쓰기에 참여하는 조건과 L2ARC가 읽기 경로에 들어오는 조건을 보면 됩니다.

{{< flow src="_flow/3-캐시-장치가-타는-길.json" />}}

SLOG는 동기 쓰기의 기록(ZIL)을 받는 장치입니다. SMB 쓰기는 기본이 비동기여서 SLOG를 쓰지 않고, 메모리에 모였다가 데이터 vdev로 내려갑니다. NFS 쓰기는 기본이 sync이므로 SLOG가 의미를 갖습니다.

L2ARC는 ARC에서 밀려난 블록을 플래시에 보관하는 읽기 캐시입니다. 영상 재생의 순차 읽기는 대부분 프리페치로 들어오는데, 기본값 `l2arc_noprefetch=1`은 이렇게 읽은 블록을 L2ARC에 넣지 않습니다. 여러 명이 같은 소스를 반복해서 읽고 그 작업 집합이 캐시 용량 안에 들어올 때 일부 이득을 얻습니다.

special vdev는 메타데이터와 작은 블록을 플래시에 두는 풀의 일부입니다. 폴더 탐색과 썸네일·프로젝트 파일 읽기를 빠르게 하지만 대용량 영상의 순차 대역폭은 올리지 않습니다. DPX·EXR 이미지 시퀀스는 메타데이터 지연에도 민감합니다.

special vdev를 잃으면 풀 전체를 잃으므로 데이터 vdev와 같은 수준의 중복이 필요합니다.

## 확인하지 못한 것 {#unverified}

- 독립 기관이 400GbE로 SMB·NFS를 측정한 결과
- V-Series의 IOPS 공식 수치
- V-Series의 데이터 포트 수가 컨트롤러당인지 시스템 전체인지
- Hybrid Flash와 Hybrid Cache의 내부 구성 차이(special vdev인지 L2ARC인지)의 공식 정의

{{< details title="근거와 측정 조건" closed="true" >}}

| 항목 | 값 | 출처·조건 |
|---|---|---|
| ProRes 데이터율 | Proxy 4.5MB/s, HQ 92MB/s | Apple ProRes White Paper. 각각 1080 24p, UHD 25p |
| 편집자당 부하 | 프록시 40MB/s, HQ 2스트림 240MB/s, 4캠 480MB/s, 8K RAW·비압축 1,100MB/s | 앞의 세 값은 스트림 수와 여유 계수 1.3을 적용한 이 글의 계산. 마지막 값은 OWC Jellyfish의 10GbE 사용자 상한으로 고정 |
| 추가 부하와 사용률 | 편집자 10명당 1GB/s, 동시 사용률 100% | 이 글의 가정. 벤더 공식 값은 확인하지 못함 |
| 서버 NIC와 최소 풀 구성 | 링크 이용률 70% 아래, 100GbE 한 포트당 약 8GB/s | 이 기준으로 본문의 대역별 NIC·HDD·NVMe 최소 구성을 산정 |
| RAIDZ2 HDD 풀의 편집자 수 | 5~10명 초과 시 IOPS 한계 | iXsystems 「ZFS Storage Pool Layout」 백서. 이 조건에서 미러가 낫다고 설명 |
| V-Series 공식 상한 | 구성 표의 공식 시스템 대역폭 | 2026년 9월판 데이터시트. 시험 조건 미공개 |
| All-Flash SMB 추정 | 구성 표의 읽기·쓰기 범위 | Xinnor 실측은 체크섬 off, Klara 실측은 측정 지점 미공개. DATAZONE의 단일 컨트롤러 R60 SMB 자료는 시험 조건 미공개 |
| Hybrid Flash SMB 추정 | HDD 100~200대에서 구성 표의 범위 | iXsystems의 RAIDZ 순차 속도 산식과 여러 편집자의 탐색을 고려한 이 글의 추정 |
| Hybrid Cache SMB 추정 | HDD 60~100대에서 구성 표의 범위 | 같은 HDD 대수 산식에 기댄 이 글의 추정 |
| L2ARC 프리페치 제외 | `l2arc_noprefetch=1` | OpenZFS zfs(4)의 기본값 |

{{< /details >}}

## 참고 자료 {#references}

- [TrueNAS V-Series 데이터시트 2026년 9월판](https://www.truenas.com/wp-content/uploads/2026/09/V-Series_Data_Sheet_September_2026-1.pdf)
- [TrueNAS 미디어·엔터테인먼트 최적화 가이드](https://www.truenas.com/docs/solutions/optimizations/mediaentertainment/)
- [TrueNAS SLOG 레퍼런스](https://www.truenas.com/docs/references/slog/)
- [TrueNAS 하이브리드 플래시 사이징 가이드](https://www.truenas.com/blog/hybrid-flash-storage-sizing-guide/)
- [OpenZFS zfs(4) 모듈 파라미터](https://openzfs.github.io/openzfs-docs/man/master/4/zfs.4.html)
- [Xinnor, Tuning ZFS and testing xiRAID](https://xinnor.io/blog/tuning-zfs-and-testing-xiraid-as-replacement-for-raidz)
- [Klara, Accelerating Animation Workflows with ZFS](https://klarasystems.com/content/case-study-accelerating-animation-workflows-with-zfs/)
- [DATAZONE, TrueNAS R60](https://datazone.de/en/aktuelles/truenas-r60-enterprise-storage/)
- [Samba 메일링리스트, Metzmacher 2020](https://lists.samba.org/archive/samba-technical/2020-October/135856.html)
- [Apple ProRes White Paper](https://www.apple.com/final-cut-pro/docs/Apple_ProRes.pdf)
- [OWC Jellyfish Tower](https://www.owc.com/ca/solutions/jellyfish/tower)
