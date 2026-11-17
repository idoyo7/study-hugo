---
title: "10GbE 편집실에 맞춘 TrueNAS V-Series 성능과 구성"
linkTitle: "01 구성별 성능 범위"
description: "10GbE 편집실에 필요한 서버 대역을 편집자 수와 코덱으로 계산하고, TrueNAS V-Series의 공식 상한과 SMB 성능 추정을 비교한다. ProRes 422 HQ UHD 편집자 20명까지는 100GbE 한두 포트로 충분하며, 200GbE 이상은 8K RAW나 비압축 시퀀스를 10명 넘게 함께 쓸 때 필요해진다."
weight: 1
date: 2026-11-17
lastmod: 2026-11-17
url: "/media-nas/01-truenas-performance-range/"
---

# 01 · 10GbE 편집실에 맞춘 TrueNAS V-Series 성능과 구성

ProRes 422 HQ UHD를 쓰는 편집자 20명까지는 서버 쪽 100GbE 한두 포트로 충분합니다. 200GbE 이상이 필요한 구간은 8K RAW나 비압축 시퀀스를 10명 넘게 함께 쓸 때입니다.

그렇다고 스토리지 서버에 200GbE나 400GbE NIC를 달면 그만큼의 대역이 나오는 것은 아닙니다. ZFS 기반 NAS를 SMB나 NFS로 제공하는 편집실에서는 필요한 대역과 실제로 낼 수 있는 대역을 따로 살펴야 합니다. TrueNAS V-Series의 공식 상한은 All-Flash 480Gb/s, Hybrid Flash 240Gb/s, Hybrid Cache 120Gb/s이며, 시험 조건은 공개되지 않았습니다. SMB로 여러 편집자가 대용량 파일을 읽는 조건에서는 All-Flash가 200~400Gb/s, HDD가 들어간 두 구성은 200Gb/s 아래에 머문다고 추정했습니다.

이 글의 기준 버전은 TrueNAS 25.10.8(2026-11-05, OpenZFS 2.3 계열)입니다. 하드웨어 수치는 2026년 9월판 V-Series 데이터시트에서 가져왔습니다. 1PB를 플래시와 HDD로 나누는 풀 구성은 [02]({{< relref "/data/media-nas/02-1pb-flash-hdd-split/index.md" >}})에서 다룹니다. ARC와 SLOG, L2ARC, special vdev가 ZFS 안에서 맡는 자리는 [03]({{< relref "/data/media-nas/03-zfs-truenas-architecture/index.md" >}})에서 설명합니다.

## 편집자 수와 코덱에 맞춘 서버 NIC {#minimum}

서버에 필요한 대역은 편집자 한 명이 읽는 스트림 수와 스트림 하나의 데이터율에서 출발합니다. ProRes 422 HQ UHD 25p라면 스트림당 92MB/s입니다. 여기에 스트림 수를 곱하고, 스크러빙과 버스트 여유로 1.3을 더 곱해 편집자 한 명의 부하를 잡았습니다.

산정에 쓴 작업별 부하는 아래와 같습니다.

- 프록시: 4.5MB/s × 멀티캠 6앵글 × 1.3 → 편집자당 40MB/s
- ProRes 422 HQ UHD 25p 2스트림: 92MB/s × 2 × 1.3 → 240MB/s
- ProRes 422 HQ 4캠 멀티캠: 480MB/s
- 8K RAW·비압축: 스트림 하나로 10GbE 상한에 닿으므로 1,100MB/s로 고정

여기에 편집자 10명당 인제스트나 렌더, 복사 한 건(1GB/s)을 더했습니다. 동시 사용률은 100%로 뒀습니다. 실제 운영에서는 사용률이 더 낮으므로 보수적인 계산입니다. 여유 계수와 사용률은 이 글이 둔 가정이며, 벤더 공식 값은 확인하지 못했습니다.

| 편집자 | 프록시 | ProRes HQ UHD 2스트림 | ProRes HQ 4캠 멀티캠 | 8K RAW·비압축 |
|---|---|---|---|---|
| 5명 | 1.2GB/s = 10Gb/s | 2.2GB/s = 18Gb/s | 3.4GB/s = 27Gb/s | 6.5GB/s = 52Gb/s |
| 10명 | 1.4GB/s = 11Gb/s | 3.4GB/s = 27Gb/s | 5.8GB/s = 46Gb/s | 12.0GB/s = 96Gb/s |
| 20명 | 2.8GB/s = 22Gb/s | 6.8GB/s = 54Gb/s | 11.6GB/s = 93Gb/s | 24.0GB/s = 192Gb/s |
| 40명 | 5.6GB/s = 45Gb/s | 13.6GB/s = 109Gb/s | 23.2GB/s = 186Gb/s | 48.0GB/s = 384Gb/s |

서버 링크 이용률을 70% 아래로 두면 100GbE 한 포트는 약 8GB/s를 안정적으로 전송합니다. 이 기준으로 요구 대역을 나누면 서버 NIC와 스토리지의 최소 구성을 고를 수 있습니다.

| 요구 대역 | 해당 구간 | 서버 NIC | 스토리지 최소 구성 |
|---|---|---|---|
| 약 3GB/s 이하 | 프록시 20명까지, ProRes HQ 5~10명 | 100GbE 1포트 | HDD 풀. 데이터 디스크 40개 안팎, special vdev 포함 |
| 3~8GB/s | ProRes HQ 20명, 멀티캠 10명, 8K RAW 5명 | 100GbE 1~2포트 | HDD 100대 이상의 하이브리드 또는 NVMe 풀 |
| 12~25GB/s | ProRes HQ 40명, 멀티캠 20~40명, 8K RAW 10~20명 | 200GbE | NVMe 풀 |
| 약 48GB/s | 8K RAW·비압축 40명 | 400GbE | NVMe 풀. 단일 헤드 실성능은 PoC 대상 |

200GbE와 400GbE는 NVMe 풀과 8K·비압축 워크로드에서만 채워집니다. HDD 풀에는 100GbE로도 대역이 남습니다.

HDD 풀을 고를 때는 대역폭 외의 제약도 봐야 합니다. iXsystems 백서는 RAIDZ2 HDD 풀에서 함께 작업하는 편집자가 5~10명을 넘으면 IOPS가 한계가 되어 미러가 낫다고 적었습니다. TrueNAS 미디어 가이드도 플래시가 아닌 시스템에서 편집 중에 푸티지를 옮기거나 복사하면 재생이 끊긴다고 경고합니다.

파일 형식에 따른 차이도 있습니다. DPX나 EXR 같은 이미지 시퀀스는 스트림 하나가 초당 24개 파일을 열어야 하므로 메타데이터 지연에 민감합니다.

{{< details title="근거와 조건" closed="true" >}}

| 포맷·항목 | 조건·데이터율 | 출처·계산 근거 |
|---|---|---|
| ProRes 422 Proxy | 1080 24p, 4.5MB/s | Apple ProRes White Paper 부록 Target Data Rates |
| DNxHR LB | 1080 23.976p, 4.3MB/s | Avid KB "DNxHR Codec Bandwidth Specifications" |
| XAVC-I DCI 4K | 24p / 59.94p, 30 / 75MB/s | Sony FX6 사양 페이지 |
| ProRes 422 HQ | UHD 24p / 25p / 60p, 88 / 92 / 221MB/s | Apple ProRes White Paper 부록 Target Data Rates |
| DNxHR HQX | UHD 25p, 87MB/s | Avid KB "DNxHR Codec Bandwidth Specifications" |
| ProRes 4444 XQ | UHD 24p, 199MB/s | Apple ProRes White Paper 부록 Target Data Rates |
| Blackmagic RAW 8K | 3:1 / 5:1 / 8:1, 24p, 533 / 320 / 200MB/s | URSA Cine 12K LF 사양 페이지, 24fps |
| ProRes 422 HQ | 8192×4320 24p, 377MB/s | Apple ProRes White Paper 부록 Target Data Rates |
| ARRIRAW 4.5K Open Gate | 24p, 약 502MB/s, 프레임 크기에서 계산 | ARRI 포맷 자료의 프레임당 약 20.9MB × 24 |
| DPX 4K 10bit | 24p 비압축, 849MB/s, 계산 | 프레임 크기 계산. DPX 10bit RGB는 픽셀당 32bit |
| OpenEXR 4K half RGB | 24p 비압축, 1,274MB/s, 계산 | 프레임 크기 계산. EXR half RGB는 픽셀당 6바이트 |
| 스트림 ×2 관행 | — | Larry Jordan의 데이터율 표와 Jellyfish 리뷰 |
| 4K 편집 요구 | "4K/UHD 여러 스트림에 300~400MB/s" | EditShare 데이터시트 |
| 스트림 수의 영향 | "스트림 수가 개별 데이터율보다 성능에 훨씬 큰 영향" | Quantum StorNext 4K 레퍼런스 아키텍처 2017 |

{{< /details >}}

## 10GbE에서 데이터 vdev까지 이어지는 요청 경로 {#request-path}

서버 전체의 처리량과 클라이언트 한 대가 받는 속도에는 서로 다른 한계가 걸립니다. 아래 그림에서는 편집자의 요청이 Samba와 ZFS를 거쳐 어느 vdev에 도달하는지 따라가면 됩니다.

{{< flow src="_flow/1-요청이-지나는-자리.json" />}}

편집자 워크스테이션의 10GbE가 첫 번째 상한입니다. 10Gb/s는 1.25GB/s이고, TCP와 SMB 오버헤드를 빼면 점보 프레임에서 1.1GB/s 안팎이 남습니다. OWC Jellyfish도 10GbE 사용자 한 명의 상한을 1,100MB/s로 적습니다.

서버에 들어온 요청은 Samba의 smbd 프로세스가 받습니다. Samba는 클라이언트마다 smbd 프로세스 하나를 두며, SMB 멀티채널로 연결을 늘려도 같은 클라이언트의 연결은 한 프로세스가 처리합니다. 클라이언트가 늘면 프로세스도 늘어 서버 전체 대역은 커지지만, 한 대가 받는 속도에는 프로세스 하나의 한계가 걸립니다.

smbd가 ZFS에 블록을 요청하면 ARC(메모리 캐시)를 먼저 확인합니다. 여기에 없는 블록은 풀에서 읽습니다. 영상 본체처럼 큰 블록은 데이터 vdev에 있고, 디렉터리와 파일 위치 같은 메타데이터는 special vdev가 있으면 거기서 읽습니다. 데이터 vdev에 NVMe를 쓰는지 HDD를 쓰는지에 따라 V-Series 구성별 성능 차이가 생깁니다.

TrueNAS의 듀얼 컨트롤러 HA는 한 시점에 컨트롤러 하나가 서비스하는 방식으로 알려져 있습니다. V-Series 문서에서는 이를 직접 확인하지 못했습니다. 이 방식이 맞다면 데이터시트의 포트 수와 CPU 코어 수는 서비스 중인 컨트롤러 한 대 기준으로 읽어야 합니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처·조건 |
|---|---|---|
| 10GbE 링크 환산 | 10Gb/s = 1.25GB/s | TCP와 SMB 오버헤드를 빼기 전 |
| 10GbE 실효 대역 | 1.1GB/s 안팎 | 점보 프레임, TCP와 SMB 오버헤드 제외 |
| 10GbE 사용자 상한 | 최대 1,100MB/s | OWC Jellyfish Tower 사양 |
| Samba 단일 연결 | 약 4.2GB/s, io_uring splice 사용 시 5GB/s | Samba 개발자 Metzmacher, 2020년 메일링리스트 |
| Windows 10/11 클라이언트 | 약 1.2GB/s에서 정체 | TrueNAS 포럼, 25GbE, iperf3 단일 24.3Gb/s 확인 환경 |
| Linux mount.cifs | Samba 상대 1.7~1.8GB/s | 같은 포럼 스레드 |
| macOS 듀얼 10GbE | 합계 약 500MB/s에 머문 사례 | TrueNAS 포럼, M4 Max, 멀티채널 사용 |
| macOS 10GbE | 회선을 다 채운 사례 | TrueNAS 포럼, M2 Mac Studio와 2019 Mac Pro |

{{< /details >}}

## SMB 성능 범위로 고르는 TrueNAS V-Series {#range}

V-Series는 4U 듀얼 컨트롤러 섀시 하나를 세 가지 구성으로 판매합니다. 전면 24베이는 SAS HDD와 Gen4 NVMe를 함께 받고, 후면에는 Gen5 NVMe 4베이가 있습니다. V160은 같은 섀시에서 Hybrid Flash와 All-Flash를 선택할 수 있는 모델입니다.

Hybrid Cache 열의 사양은 V140 발표 사양과 겹쳐 이 글에서는 V140으로 봤습니다. 공식 문서가 이 대응을 명시하지는 않습니다.

데이터시트의 대역폭 단위는 GB/s(초당 기가바이트)입니다. NIC의 Gb/s(초당 기가비트)와 비교하려면 8을 곱해야 합니다. 아래 표에는 양쪽 단위를 함께 적었습니다. 공식 상한의 시험 조건은 공개되지 않았습니다.

| 항목 | Hybrid Cache | Hybrid Flash | All-Flash |
|---|---|---|---|
| 대응 모델 | V140 (추정) | V160 | V160 |
| CPU | 16코어 32스레드 | 32코어 64스레드 | 32코어 64스레드 |
| RAM 최대 | 192GB | 384~768GB | 384~768GB |
| 읽기 캐시 최대 | NVMe 12TB | NVMe 24TB | DRAM |
| 시스템 대역폭 | 15GB/s = 120Gb/s | 30GB/s = 240Gb/s | 60GB/s = 480Gb/s |
| 쓰기 | 8GB/s = 64Gb/s | 16GB/s = 128Gb/s | 30GB/s = 240Gb/s |
| 데이터 포트 | 4× 100GbE | 4× 200GbE 또는 2× 400GbE | 4× 200GbE 또는 2× 400GbE |
| HDD 최대(raw) | 16PB | 40PB | 없음 |
| NVMe 최대(raw) | 4PB | 14PB | 20PB |
| 확장 셸프 | ES102 6대 또는 ES24N 2대 | ES102 14대 또는 ES24N 4대 | ES24N 6대 |
| 전력 평균/피크 | 600W / 900W | 800W / 1,200W | 800W / 1,200W |

아래 그림에서는 공식 상한과 SMB 추정 범위를 NIC 속도와 견줘 보면 됩니다. 추정 막대는 여러 클라이언트가 SMB로 대용량 파일을 순차로 읽는 조건에서 이 글이 산정한 범위입니다.

{{< lane src="_lane/2-공식-상한과-현실-범위.json" />}}

All-Flash의 추정 범위는 제3자 실측 세 건을 바탕으로 잡았습니다. Xinnor는 NVMe 풀에서 튜닝한 ZFS의 성능을 보고했지만 체크섬을 끈 조건이었습니다. Klara의 애니메이션 스튜디오 사례는 NVMe·100GbE 장비에서 측정했으나 측정 지점을 공개하지 않았습니다. 리셀러 DATAZONE이 제시한 단일 컨트롤러 모델 R60의 SMB 수치에도 시험 조건은 없습니다.

HDD가 들어간 구성의 처리량은 HDD 대수에 비례합니다. iXsystems 백서는 RAIDZ vdev의 순차 속도를 데이터 디스크 수에 디스크 한 대의 속도를 곱한 값으로 계산합니다. 여기서 디스크 속도를 최대치로만 잡을 수는 없습니다. Exos X24는 안쪽 트랙에서 전송률이 절반 가까이 떨어지며, 여러 편집자의 읽기에 탐색이 섞이면 vdev 처리량은 더 낮아진다고 봤습니다.

아래 표에는 공식 상한 옆에 SMB 읽기·쓰기 추정 범위를 나란히 적었습니다. All-Flash의 추정은 제3자 실측을, Hybrid Flash와 Hybrid Cache의 추정은 HDD 대수 산식을 바탕으로 잡았습니다. Hybrid Flash와 Hybrid Cache의 공식 상한은 셸프를 가득 채운 이상적인 순차 조건의 값으로 해석했습니다.

| 구성 | 공식 대역폭 | 공식 쓰기 | SMB 읽기 추정 | SMB 쓰기 추정 |
|---|---|---|---|---|
| All-Flash | 60GB/s = 480Gb/s | 30GB/s = 240Gb/s | 25~50GB/s = 200~400Gb/s | 15~25GB/s = 120~200Gb/s |
| Hybrid Flash, HDD 100~200대(vdev 10~20개) | 30GB/s = 240Gb/s | 16GB/s = 128Gb/s | 8~20GB/s = 64~160Gb/s | 5~12GB/s = 40~96Gb/s |
| Hybrid Cache, HDD 60~100대 | 15GB/s = 120Gb/s | 8GB/s = 64Gb/s | 4~10GB/s = 32~80Gb/s | 3~6GB/s = 24~48Gb/s |

400GbE 두 포트의 합계 800Gb/s는 All-Flash 공식 상한 480Gb/s보다 넉넉합니다. 이 구성의 병목은 NIC보다 ZFS, CPU, Samba 쪽에 있다고 봤습니다. 단일 헤드가 SMB로 40GB/s 이상을 실제로 내는지는 도입 전 PoC에서 재야 합니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처·조건 |
|---|---|---|
| V-Series 구성별 사양 | 위 표 | V-Series 데이터시트 2026년 9월판, 시험 조건 미공개 |
| V160 발표 | 400GbE로 최대 60GB/s, 35PiB 이상 | TrueNAS 블로그 2026-04-20 |
| V140 발표 | 16코어 EPYC 쌍, 192GB, 읽기 캐시 12TB, 15GB/s | TrueNAS 블로그 2026-06-18 |
| SMB 읽기 추정 범위 | All-Flash는 공식 상한의 40~85%, HDD가 들어간 두 구성은 200Gb/s 아래 | 여러 클라이언트가 대용량 파일을 순차로 읽는 조건에서 이 글이 추정 |
| NVMe raw 순차 | 읽기 57.2GB/s, 쓰기 53.2GB/s | Xinnor, EPYC 7702P, 128GB, WD SN840. 드라이브 수는 글 안에서 16대와 10대로 엇갈림 |
| ZFS 기본값 | 5.4~5.6GB/s (raw의 약 10%) | 같은 시험 |
| ZFS 튜닝 후 RAIDZ2 | 읽기 32.3GB/s, 쓰기 24.2GB/s, 드라이브 원성능의 45~57% | Xinnor, OpenZFS 2.2.6 + Direct IO 패치, recordsize 1M, 압축·체크섬 off, 1M 블록 64 jobs |
| Klara 사례 | 순차 읽기 55GB/s, 기본값 대비 57% 향상 | 애니메이션 스튜디오의 NVMe·100GbE 장비. RAID-Z2 vdev 2개, 압축 off, 측정 지점 미공개 |
| R60 SMB | 27GB/s (읽기·쓰기 50/50) | 리셀러 DATAZONE, 단일 컨트롤러 모델, 시험 조건 없음 |
| R60 자료 간 차이 | 발표 블로그 60GB/s, 데이터시트 검색 결과 40GB/s | 자료마다 수치가 다름 |
| RAIDZ 순차 속도 | (폭 − 패리티) × 디스크 속도 | iXsystems "ZFS Storage Pool Layout" 백서 |
| HDD 최대 지속 전송률 | 285MB/s | Seagate Exos X24, StorageReview |
| 10폭 RAIDZ2 vdev 순차 속도 | 1.2~1.6GB/s | 디스크당 평균 150~200MB/s로 잡은 이 글의 계산 |
| 10폭 RAIDZ2 vdev에서 탐색이 섞인 읽기 | 0.4~1GB/s | 여러 편집자가 함께 읽는 조건에서 이 글이 추정 |
| All-Flash 포트 합계와 공식 상한 | 400GbE 두 포트 합계 800Gb/s, 공식 상한 480Gb/s | 포트 합산 대역이 공식 상한보다 큼 |
| 25.10 발표문의 읽기 수치 | "단일 어플라이언스 75GB/s 이상 읽기" | NVMe/RDMA 맥락이어서 SMB·NFS 수치로 쓰지 않음 |

{{< /details >}}

## 편집실 규모별 V-Series 권장 구성 {#recommend}

편집실 규모와 작업에 맞춰 권장 구성을 골랐습니다. 표의 요구 대역은 앞 절의 계산이며, SMB 읽기는 이 글의 추정 범위입니다. 세 구성 모두 4U 듀얼 컨트롤러 HA 섀시를 쓰고, 하드웨어에 TrueNAS Enterprise 25.10 라이선스가 포함돼 용량에 따른 추가 과금이 없습니다.

| 항목 | V140 Hybrid Cache | V160 Hybrid Flash | V160 All-Flash |
|---|---|---|---|
| 맞는 편집실 | ProRes HQ 편집자 10명 안팎, 프록시 편집 | ProRes HQ 20~40명에 8K·멀티캠 소수 | 8K RAW·비압축 10~20명 |
| 요구 대역(앞 절의 표) | 약 3~4GB/s = 27Gb/s 안팎 | 7~14GB/s = 54~109Gb/s | 12~24GB/s = 96~192Gb/s |
| 공식 대역폭 | 15GB/s = 120Gb/s | 30GB/s = 240Gb/s | 60GB/s = 480Gb/s |
| SMB 읽기 추정 | 4~10GB/s | 8~20GB/s | 25~50GB/s |
| CPU(컨트롤러당) | 16코어 32스레드 | 32코어 64스레드 | 32코어 64스레드 |
| RAM 최대 | 192GB | 384~768GB | 384~768GB |
| 데이터 드라이브 | SAS HDD 60~100대 | 전면 NVMe 24베이 + SAS HDD 셸프 | NVMe 24베이 + NVMe 셸프 |
| 읽기 캐시 | NVMe 최대 12TB | NVMe 최대 24TB | DRAM |
| 확장 셸프 | ES102 6대 또는 ES24N 2대 | ES102 14대 또는 ES24N 4대 | ES24N 6대 |
| 서버 NIC | 4× 100GbE | 4× 200GbE 또는 2× 400GbE | 4× 200GbE 또는 2× 400GbE |
| 전력 평균/피크 | 600W / 900W | 800W / 1,200W | 800W / 1,200W |

드라이브 선택지는 세 구성 모두 NVMe SSD 3.8~122.8TB, SAS HDD 7,200rpm 8~30TB입니다. 파이버 채널은 16Gb 8포트나 32Gb 4포트를 고를 수 있습니다.

V140 Hybrid Cache는 ProRes HQ 편집자가 10명 안팎인 팀이나 프록시 편집 팀에 맞습니다. HDD 풀에 100GbE를 붙인 구성으로, ProRes 422 HQ UHD를 2스트림씩 쓰는 편집자 10명의 요구 대역 3.4GB/s는 HDD 60~100대의 SMB 읽기 추정 범위 4~10GB/s 안에 들어옵니다. 프록시 편집이라면 40명의 요구 대역도 5.6GB/s입니다. 다만 8K RAW는 스트림 하나가 10GbE를 채우므로 이 구성에 맞지 않습니다. 편집자가 10명을 넘으면 RAIDZ2 HDD 풀의 IOPS 한계도 함께 봐야 합니다.

V160 Hybrid Flash는 ProRes HQ 편집자 20~40명에 8K·멀티캠 작업자가 소수인 팀에 맞습니다. NVMe 풀과 HDD 풀을 한 장비에 두고, 진행 중인 8K·멀티캠 작업은 전면 NVMe 풀에서, ProRes 편집과 보관 소재는 HDD 셸프에서 받을 수 있습니다. ProRes HQ 40명의 요구 대역 13.6GB/s는 공식 상한 30GB/s 안쪽입니다. [02]({{< relref "/data/media-nas/02-1pb-flash-hdd-split/index.md" >}})의 플래시 200TB와 HDD 800TB 분할이 이 구성에 해당합니다. 편집자 전원이 10GbE를 가득 쓰는 작업이라면 V160 All-Flash가 맞습니다.

V160 All-Flash는 8K RAW·비압축 편집자 10~20명이 일하는 팀에 맞습니다. 편집자 전원이 10GbE를 가득 쓰는 작업을 받으며, 8K RAW 20명의 요구 대역 24GB/s는 SMB 읽기 추정 범위 25~50GB/s 아래에 있습니다. 400GbE를 실제로 채울 수 있는 구성도 셋 중 이것뿐입니다. 다만 40명의 요구 대역 48GB/s는 추정 범위의 상단이므로, 이 규모로 도입하려면 PoC로 확인해야 합니다.

### 견적제 가격과 예산 범위

TrueNAS Enterprise는 견적으로만 판매하며, V140과 V160의 발표문과 제품 페이지에는 시작가나 TB당 단가가 없습니다. 02편의 1PB 구성(V160 Hybrid Flash, 15.36TB NVMe 24개, HDD 50개, ES102 1대, 3년 지원)을 과거 공개 가격과 2026년 11월 부품 시세로 역산하면 30만~80만 달러, 중심값 40만~55만 달러로 추정됩니다. 같은 드라이브를 쓰는 단일 컨트롤러 화이트박스의 추정 범위는 15만~34만 달러입니다. 두 범위 모두 공식 견적이 아닙니다.

어플라이언스 가격이 화이트박스의 1.8~2.5배인 까닭은 듀얼 컨트롤러 HA, 3~5년 지원, 드라이브 마진입니다. 화이트박스에는 HA와 NFS over RDMA, 벤더 지원이 빠져 있습니다.

2026년은 부품 가격이 오른 시기입니다. 엔터프라이즈 SSD 계약가는 2분기에 전 분기보다 48~53%, 3분기에 20~25% 올랐고, Seagate와 WD의 니어라인 HDD는 모두 2026년 물량 배정이 끝났습니다. 리셀러 DATAZONE은 견적가가 8주 사이에 15~25% 움직인다고 적었습니다. 정확한 금액은 같은 구성에서 지원 등급(Bronze, Silver, Gold)과 기간을 바꿔 견적을 받아야 알 수 있습니다.

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처·조건 |
|---|---|---|
| 구성별 사양 | 위 표 | V-Series 데이터시트 2026년 9월판 |
| 라이선스 | "ships fully licensed from day one", TB당 과금 없음 | V160 발표 2026-04-20 |
| 공식 가격 | V140·V160 시작가와 TB당 단가 없음 | V160·V140 발표문과 제품 페이지 |
| 옛 M-Series 시작가 | 듀얼 컨트롤러 $13,500 / $20,000 / $35,000 / $60,000 | 삭제된 공식 페이지의 검색 요약. 모델 대응과 연도 미확인 |
| 옛 X-Series 안내 | HDD 약 $80/TB, 플래시 약 $500/TB | 단종된 공식 페이지의 검색 요약 |
| CDW 게재가 | M40-HA $66,408, M50-HA $102,955 | 검색 요약. 드라이브 포함 여부 미확인 |
| 2022년 M50 견적표 | 18TB HDD 505개에 $824,247(raw TB당 약 $91), SSD는 raw TB당 약 $511~574 | 리셀러 techgardens, 3년 지원 포함. TB당 단가는 계산 |
| 5년 비용 구성 | 하드웨어 45~60%, 지원 20~30%. Gold는 Silver보다 30~60% 높음 | DATAZONE 2026 가격 가이드 |
| SSD 계약가 | 2026년 2분기 +48~53%, 3분기 +20~25% | TrendForce |
| HDD 공급 | 2026년 니어라인 물량 배정 완료 | Seagate·WD 발표를 인용한 보도 |
| 어플라이언스 추정 | HA 헤드 $60k~150k, NVMe 368.6TB × $250~600/TB, HDD 1.6PB × $70~140/TB, 3년 지원 +15~30% | 위 근거를 바탕으로 한 이 글의 추정 |
| 화이트박스 추정 | 서버 $15k~35k, NVMe 24개 × $3,000~8,000, HDD 50개 × $900~1,900, JBOD $9k~12k | 2026년 11월 소매·채널 시세를 바탕으로 한 이 글의 추정 |

- V-Series의 확장 셸프 목록에 ES60은 없다. HDD 50개는 ES102 1대로 잡았다
- 데이터시트의 HDD 선택지는 30TB까지다. 02편이 계산에 쓴 32TB 드라이브를 TrueNAS가 공급하는지는 확인하지 못했다
- 지원 등급 이름은 2024년 1월 문서 기준이다. 2026년판은 찾지 못했다

{{< /details >}}

## 영상 편집에서 쓰임이 달라지는 캐시 장치 {#cache}

영상 편집에서 Hybrid Cache의 실효 성능은 HDD 풀의 성능으로 봐야 합니다. 플래시 캐시가 있다고 해서 HDD 풀이 플래시처럼 빨라지지는 않습니다.

아래 그림에서는 쓰기와 읽기가 어떤 장치를 거치는지 살펴보겠습니다. SLOG가 쓰기에 참여하는 조건과 L2ARC가 읽기 경로에 들어오는 조건을 보면 각 장치가 할 수 있는 일이 드러납니다.

{{< flow src="_flow/3-캐시-장치가-타는-길.json" />}}

SLOG는 동기 쓰기의 기록(ZIL)을 받는 장치입니다. SMB 쓰기는 기본이 비동기여서 메모리의 트랜잭션 그룹에 모였다가 데이터 vdev로 바로 내려갑니다. TrueNAS 문서도 비동기 쓰기에는 SLOG를 쓰지 않는다고 명시합니다. NFS로 쓰기를 받으면 기본이 sync이므로 그때는 SLOG가 의미를 갖습니다.

L2ARC는 ARC에서 곧 밀려날 블록을 플래시에 미리 복사해 두는 2차 읽기 캐시입니다. 영상 재생의 순차 읽기는 대부분 프리페치로 들어오는데, 기본값 `l2arc_noprefetch=1`은 이렇게 읽은 블록을 L2ARC에 넣지 않습니다. 캐시를 채우는 속도에도 장치별 기본 제한이 있습니다. 같은 소스를 여러 명이 반복해서 읽는 경우에만 일부 이득을 얻습니다. 읽기 캐시가 효과를 내는 조건은 반복해서 읽는 작업 집합이 캐시 용량 안에 들어오는 경우입니다.

special vdev는 캐시가 아니라 풀의 일부입니다. 메타데이터와 작은 블록을 플래시에 두어 폴더 탐색, 썸네일과 프로젝트 파일 읽기, 스크럽을 빠르게 합니다. 대용량 영상의 순차 대역폭은 올리지 않습니다. special vdev를 잃으면 풀 전체를 잃으므로 데이터 vdev와 같은 수준의 중복이 필요합니다.

편집 워크로드에 맞는 ZFS 설정은 아래와 같습니다.

- recordsize는 1M. OpenZFS 문서가 순차 워크로드에 권하는 값이며, 바꾼 뒤 새로 쓰는 파일에만 적용된다
- 압축은 lz4 또는 off. ProRes, RAW, H.264/H.265는 이미 압축돼 있어 이득이 거의 없다. 최고 처리량을 낸 Xinnor와 Klara 사례는 모두 압축을 껐다
- Direct IO(OpenZFS 2.3)는 Samba나 NFS 서버가 O_DIRECT로 열지 않는 한 공유 경로에 영향이 없다고 추정했다
- ARC 기본 상한은 "전체 메모리 − 1GiB"와 "전체 메모리의 5/8" 중 큰 값이다

{{< details title="근거와 조건" closed="true" >}}

| 항목 | 값 | 출처·조건 |
|---|---|---|
| SLOG | 비동기 쓰기에는 쓰지 않음 | TrueNAS SLOG 레퍼런스 |
| `l2arc_noprefetch` | 기본 1 | OpenZFS zfs(4) |
| `l2arc_write_max` | 기본 장치당 32MiB/s | OpenZFS zfs(4) |
| L2ARC RAM 비용 | 블록당 ARC 헤더 96바이트, L2ARC 50GB당 RAM 1GB 권장 | OpenZFS zfs(4), TrueNAS 하드웨어 가이드 |
| 읽기 캐시 용량과 적용 조건 | 12TB나 24TB | 반복해서 읽는 작업 집합이 그 크기 안에 들어올 때 효과 |
| special vdev 효과 | 디스크 I/O를 최대 절반 줄임 | TrueNAS 하이브리드 사이징 블로그 2026-10-15, 공식 주장 |
| recordsize | 순차 워크로드에 1M 권장 | OpenZFS Workload Tuning |
| Direct IO 한계 | recordsize보다 작은 파일은 무시, 정렬 안 된 쓰기는 버퍼 경로 | BSDCan 2025 발표 |

{{< /details >}}

## 편집 프로그램에 맞춰 고르는 SMB와 NFS {#protocol}

편집 프로그램은 대부분 SMB를 전제로 합니다. TrueNAS 미디어 가이드는 SMB3와 MTU 9000을 권하며, 미디어 캐시는 NAS 대신 로컬 SSD에 두라고 합니다.

공유 스토리지와 별도로 편집 프로그램의 협업 방식도 맞춰야 합니다. Premiere는 Productions의 프로젝트 잠금을 씁니다. DaVinci Resolve는 협업에 PostgreSQL 프로젝트 서버를 쓰고, 미디어 경로만 공유 스토리지에 맞춥니다.

Avid Media Composer는 2026.8부터 서드파티 스토리지에서 공유 프로젝트와 빈 잠금을 쓰려면 Enterprise 라이선스가 필요하다고 보도됐습니다. Avid 팀이 있다면 도입 전에 확인할 항목입니다.

### RDMA 지원이 NFS에 한정된 TrueNAS 25.10

200GbE 이상 NIC를 고를 때는 RDMA 지원 여부도 함께 봐야 합니다. TrueNAS 25.10에서 파일 프로토콜의 RDMA 지원은 NFS 쪽에만 있습니다.

| 기능 | TrueNAS 25.10 상태 |
|---|---|
| SMB 멀티채널 | Community에서도 지원. NIC마다 다른 서브넷 IP가 필요하고 LAGG에서는 동작하지 않음 |
| SMB Direct (RDMA) | 미지원. 업스트림 Samba 구현은 2026년 발표 기준 프로토타입 단계 |
| NFS over RDMA | Enterprise 전용. 라이선스와 RDMA NIC 필요 |
| NFSv4.1 | 지원 |
| pNFS | 문서에서 언급을 찾지 못함 |
| 400GbE | 25.10에서 어댑터 지원 발표 |

### 설정에 따라 속도가 달라지는 macOS 클라이언트

macOS 클라이언트는 설정에 따라 속도 편차가 큽니다. Dell PowerScale의 macOS 가이드는 아래 설정을 권합니다.

- `/etc/nsmb.conf`에 `signing_required=no`. 보안이 낮아지므로 사설망에서만 쓴다
- 10GbE 이상에서 `net.inet.tcp.delayed_ack=0`. 재부팅하면 풀리므로 LaunchDaemon이 필요하다
- 멀티채널에서 `mc_prefer_wired=yes`. 2×10GbE 실측에서 읽기 약 10%, 쓰기 약 20% 개선
- `.DS_Store`를 네트워크 볼륨에 쓰지 않도록 `DSDontWriteNetworkStores` 설정

## 확인하지 못한 것 {#unverified}

- 독립 기관이 400GbE로 SMB·NFS를 측정한 결과
- V-Series의 IOPS 공식 수치
- V-Series의 데이터 포트 수가 컨트롤러당인지 시스템 전체인지
- Hybrid Flash와 Hybrid Cache의 내부 구성 차이(special vdev인지 L2ARC인지)의 공식 정의
- 25.10의 Samba 버전에서 단일 클라이언트 SMB 실측. 인용한 수치는 2020년과 2023년 것이다
- ConnectX-6/7의 TrueNAS 공식 호환 목록. 하드웨어 가이드는 Intel과 Chelsio가 가장 잘 지원된다고만 적는다
- Windows와 macOS의 SMB 속도를 같은 조건에서 비교한 1차 자료
- Blackmagic이 DaVinci Resolve에 SMB와 NFS 중 무엇을 권하는지
- REDCODE 8K의 품질별 공식 데이터율과 ALEXA 35 ARRIRAW의 공식 데이터율. RED 공식 문서는 최대 800MB/s만 적는다
- Sony X-OCN XT 8.6K 24p의 데이터율. 668MB/s로 알려져 있으나 원문 PDF를 직접 대조하지 못했다

## 참고 자료 {#references}

- [TrueNAS V-Series 데이터시트 2026년 9월판](https://www.truenas.com/wp-content/uploads/2026/09/V-Series_Data_Sheet_September_2026-1.pdf)
- [TrueNAS V-Series 제품 페이지](https://www.truenas.com/v-series/)
- [TrueNAS V160 발표](https://www.truenas.com/blog/truenas-v160-launch/)
- [TrueNAS V140 발표](https://www.truenas.com/blog/introducing-the-truenas-v140/)
- [TrueNAS 25.10 릴리스 블로그](https://www.truenas.com/blog/truenas-goldeye-25-10-release)
- [TrueNAS 미디어·엔터테인먼트 최적화 가이드](https://www.truenas.com/docs/solutions/optimizations/mediaentertainment/)
- [TrueNAS SLOG 레퍼런스](https://www.truenas.com/docs/references/slog/)
- [TrueNAS 하드웨어 가이드](https://www.truenas.com/docs/scale/25.10/gettingstarted/scalehardwareguide/)
- [TrueNAS SMB 멀티채널](https://www.truenas.com/docs/scale/25.10/scaletutorials/shares/smb/smbmultichannel/)
- [TrueNAS 하이브리드 플래시 사이징 가이드](https://www.truenas.com/blog/hybrid-flash-storage-sizing-guide/)
- [OpenZFS zfs(4) 모듈 파라미터](https://openzfs.github.io/openzfs-docs/man/master/4/zfs.4.html)
- [OpenZFS Workload Tuning](https://openzfs.github.io/openzfs-docs/Performance%20and%20Tuning/Workload%20Tuning.html)
- [Xinnor, Tuning ZFS and testing xiRAID](https://xinnor.io/blog/tuning-zfs-and-testing-xiraid-as-replacement-for-raidz)
- [Klara, Accelerating Animation Workflows with ZFS](https://klarasystems.com/content/case-study-accelerating-animation-workflows-with-zfs/)
- [BSDCan 2025, ZFS Direct IO benchmarking pitfalls](https://papers.freebsd.org/2025/bsdcan/piotrowski-zfs-direct-io-benchmarking-pitfalls/)
- [DATAZONE, TrueNAS R60](https://datazone.de/en/aktuelles/truenas-r60-enterprise-storage/)
- [Samba 메일링리스트, Metzmacher 2020](https://lists.samba.org/archive/samba-technical/2020-October/135856.html)
- [SambaXP 2026, Samba transports](https://sambaxp.org/fileadmin/user_upload/sambaxp2026-Slides/sambaXP2026_Stefan-Metzmacher_transports-rev0-compact.pdf)
- [TrueNAS 포럼, SMB performance not keeping up with fast NVMe drives](https://www.truenas.com/community/threads/smb-performance-not-keeping-up-with-fast-nvme-drives.111940/)
- [TrueNAS 포럼, macOS SMB 쓰기 병목](https://forums.truenas.com/t/severe-smb-write-performance-bottleneck-with-macos-client-despite-proven-10gbe-network-and-active-multichannel/48023)
- [Dell PowerScale macOS 클라이언트 최적화](https://www.dell.com/en-us/infohub/articles/powerscale-onefs-macos-client-performance-and-user-experience-optimization)
- [Apple ProRes White Paper](https://www.apple.com/final-cut-pro/docs/Apple_ProRes.pdf)
- [Avid DNxHR Codec Bandwidth Specifications](https://kb.avid.com/pkb/articles/en_US/Knowledge/DNxHR-Codec-Bandwidth-Specifications)
- [Blackmagic URSA Cine 12K LF 사양](https://www.blackmagicdesign.com/products/blackmagicursacine/techspecs/W-CIN-12)
- [Sony FX6 사양](https://www.sony.co.in/interchangeable-lens-cameras/products/ilme-fx6/spec)
- [OWC Jellyfish Tower](https://www.owc.com/ca/solutions/jellyfish/tower)
- [Larry Jordan, Understanding Video Data Rates](https://larryjordan.com/articles/technique-understanding-video-data-rates/)
- [Keycode Media, Avid Media Composer 2026.8 빈 잠금 변경](https://www.keycodemedia.com/avid-media-composer-2026-8-the-big-bin-locking-change/)
- [EditShare EFS SSD 데이터시트](https://editshare.com/efs-ssd-datasheet)
- [Quantum 4K 레퍼런스 아키텍처](https://www.svconline.com/products/quantum-4k-video-reference-architectures-408620)
- [TrueNAS V160 제품 페이지](https://www.truenas.com/truenas-v160/)
- [techgardens, TrueNAS M50 구성 견적표 2022](https://techgardens.com/storage-solutions/truenas-m50-information-o/)
- [DATAZONE, TrueNAS 가격 가이드 2026](https://datazone.de/en/aktuelles/truenas-preis-2026-was-kostet-enterprise-storage/)
- [DATAZONE, TrueNAS V-Series](https://www.datazone.de/en/truenas/v-serie/)
- [CDW, TrueNAS M40 HA](https://www.cdw.com/product/ixsystems-truenas-m40-high-availability-nas-server/8318025)
- [CDW, TrueNAS M50 HA](https://cdw.com/product/ixsystems-truenas-m50-high-availability-nas-server/8053092)
- [TrendForce, 2026년 4분기 엔터프라이즈 SSD 계약가](https://www.trendforce.com/presscenter/news/20260930-13258.html)
- [PC Server and Parts, 2026년 HDD 공급 부족](https://pcserverandparts.com/news/hard-drive-shortage-2026-what-to-do/)
- [StorageReview, Seagate Exos X24](https://www.storagereview.com/review/seagate-exos-x24-24tb-hdd-review)
