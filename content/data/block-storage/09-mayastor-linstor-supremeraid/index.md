---
title: "Mayastor·LINSTOR·SupremeRAID의 NVMe 성능과 선택 조건"
linkTitle: "09 Mayastor·LINSTOR·SupremeRAID 최대 성능"
description: "Mayastor, LINSTOR·Piraeus, SupremeRAID의 쓰기 경로와 장애 복구 기준을 비교한다. GPU 직접 I/O의 1억 IOPS, 단일 볼륨과 클러스터 합계의 공개 성능을 구분하고 Kubernetes 클러스터의 선택 조건을 살핀다."
weight: 9
date: 2026-11-17
lastmod: 2026-11-17
url: "/storage/09-mayastor-linstor-supremeraid/"
---

# 09 · Mayastor·LINSTOR·SupremeRAID의 NVMe 성능과 선택 조건

Mayastor와 LINSTOR·Piraeus는 노드 사이에 볼륨 사본을 만들고, SupremeRAID는 노드 안의 SSD를 RAID로 묶습니다. 공개 최대치는 볼륨 하나, 여러 볼륨·노드 합계, GPU 직접 I/O처럼 측정 범위가 달라 같은 조건의 순위로 읽을 수 없습니다. 도입 조건은 [08 Kubernetes NVMe-oF와 Mayastor]({{< relref "/data/block-storage/08-kubernetes-nvmeof-mayastor/index.md" >}}), 복제 계층은 [03 로컬 디스크와 복제]({{< relref "/data/block-storage/03-local-disk-ha/index.md" >}}), 전송 차이는 [07 FC·TCP·RDMA 전송 비교]({{< relref "/data/block-storage/07-fc-tcp-rdma-transports/index.md" >}})에서 다룹니다.

Mayastor와 LINSTOR는 로컬 PV에 복제 계층을 더한 구조입니다. 사본 하나하나는 각 노드의 로컬 디스크에서 잘라 낸 볼륨입니다. Mayastor에서는 SPDK lvol이고 LINSTOR에서는 LVM 논리 볼륨입니다. 그 위에서 nexus와 DRBD가 노드 사이 복제를 맡습니다. TopoLVM이나 OpenEBS LocalPV-LVM 같은 로컬 PV 드라이버는 이 가운데 아래층만 제공하고 복제는 하지 않습니다.

두 제품 모두 쓰기는 모든 사본에 기록돼야 끝나고, 읽기는 사본 하나에서 끝납니다. 그래서 쓰기 수치에는 네트워크 왕복과 가장 느린 사본의 지연이 들어가고, 읽기 수치는 로컬 디스크 성능에 가깝게 나올 수 있습니다. 아래 표에서 읽기와 쓰기를 따로 봐야 하는 이유입니다.

2026-11-17 기준으로 확인한 버전은 OpenEBS 4.6.2(Mayastor 2.12.2), piraeus-operator 2.12.1(LINSTOR 1.35.3, DRBD 9.3.4), SupremeRAID Linux 드라이버 2.0.1 Update 262입니다. 직접 측정한 값은 없습니다. 모두 공개 자료이며, 벤더 측정과 제3자 측정을 구분했습니다.

## 1. Mayastor의 쓰기 경로와 사본 선택

Mayastor에서는 볼륨마다 하나씩 생기는 nexus가 복제를 맡습니다. Pod가 nexus와 같은 노드에 있어도 I/O는 커널 NVMe/TCP 이니시에이터를 지납니다.

{{< flow src="_flow/2-mayastor-쓰기-경로.json" />}}

### 쓰기 완료와 장애 기록

nexus는 살아 있는 replica 전부에 쓰기를 보내고 모두 끝나야 완료로 응답합니다. 리빌드 중인 replica도 대기 대상입니다. 가장 느린 replica가 쓰기 지연을 정합니다. 읽기는 정상 replica 사이에서 라운드로빈으로 고르며, v2.12.2 소스에는 로컬 사본을 우선하는 로직이 없습니다. flush는 모든 replica에 전달됩니다.

일부 replica에서 쓰기가 실패하면 남은 replica로 그 I/O를 다시 제출할 수 있습니다. 이때 실패한 replica가 최신 사본이 아니라는 사실을 etcd에 먼저 기록합니다. 기록 전에 Pod에 성공을 응답하면, 응답한 쓰기가 빠진 replica를 정상 사본으로 믿게 될 수 있습니다.

{{< seq src="_seq/2-replica-장애-처리.json" />}}

etcd에 기록하는 동안 nexus는 재제출을 멈춥니다. 기록에 실패하면 1초 간격으로 기본 300회 재시도하고, 끝내 실패하면 nexus가 내려갑니다. etcd 장애가 볼륨 I/O를 수 분간 멈출 수 있다는 뜻으로 해석합니다. 응답 없는 replica를 실패로 판정하는 I/O 타임아웃은 기본 110초입니다.

### 재시작과 리빌드의 기준

Mayastor는 쿼럼으로 최신 사본을 고르지 않습니다. 복구 기준은 etcd의 `NexusInfo`에 남긴 replica별 healthy 플래그와 `clean_shutdown` 값입니다. 정상 종료했거나 외부에 게시하지 않은 볼륨은 healthy replica 전부로 nexus를 다시 만듭니다. 게시 중이던 nexus가 불시에 종료됐다면 healthy replica 하나만 붙이고 나머지를 그 사본에서 리빌드합니다. 쓰기 도중 nexus가 죽으면 마지막 쓰기가 반영된 범위가 사본마다 다를 수 있기 때문입니다.

마지막 정상 replica가 실패했을 때는 unhealthy로 기록하지 않습니다. 컨트롤 플레인이 nexus를 다시 만들 때 최신 데이터의 기준으로 삼을 사본을 남기는 동작입니다.

replica가 빠진 뒤 바뀐 구간은 nexus 메모리의 비트맵에 기록합니다. 기본 600초 안에 replica가 돌아오면 그 구간만 복사하고, 시간이 지나면 전체를 복사합니다. 비트맵이 메모리에만 있으므로 nexus 재시작 뒤에는 전체 복사가 필요하다고 추정합니다.

### nexus 장애 뒤의 경로 전환

nexus 노드가 죽으면 HA 에이전트가 다른 노드에 같은 NQN으로 nexus를 만들고, Pod 쪽 커널 NVMe multipath가 새 경로로 I/O를 보냅니다. 이 전환은 I/O 중단을 전제로 합니다. 설계 문서는 전환 시간을 "within seconds"라고만 적습니다.

새 nexus는 NVMe reservation으로 replica의 독점 예약을 빼앗습니다. 옛 nexus는 쓰기에서 `RESERVATION_CONFLICT`를 받으면 내려갑니다. nexus와 같은 노드의 로컬 replica에는 reservation을 걸 수 없습니다. 비정상 종료 뒤에는 컨트롤 플레인이 그 로컬 replica를 볼륨에서 떼어 냅니다.

### 볼륨 하나의 공개 성능

공개 자료만으로 현재 버전의 상한을 정하기는 어렵습니다. 오래된 벤더 측정과 제3자 결과를 최근 버전이나 다른 pool 백엔드의 성능으로 옮겨 읽을 수는 없습니다.

| 측정 | 읽기 | 쓰기 | 조건 | 측정 주체 |
|---|---|---|---|---|
| 4k 랜덤, 복제 1개 | 579K IOPS(로컬 585K) | 490K IOPS(로컬 516K) | Optane 1대, Xeon Gold 6252, ConnectX-6, fio libaio QD64·numjobs 8, io-engine 코어 4개 격리, pool `pcie:///`, 1.0 이전 | MayaData(벤더, 2020-11) |
| 4k 랜덤, 복제 2개 | 993K IOPS | 473K IOPS | 위와 같은 장비·fio·pool 조건 | MayaData(벤더, 2020-11) |
| 4k, 복제 1개, TCP·RDMA | 순차 TCP 563MB/s, RDMA 1,256MB/s | 랜덤 TCP 323MB/s, RDMA 474MB/s | Pod·nexus·replica 같은 노드. 하드웨어·fio 조건 미공개 | OpenEBS 공식 문서(2025-02) |
| 4k 랜덤, 복제 2개 | 70.1K~131.3K IOPS | 61.1K~99.9K IOPS | Mayastor 1.0.0, Ryzen 9 3900, PM983 2개/노드, 10GbE. 그래프 판독값 | Palark(제3자, 2022-06) |
| 4M 순차, 복제 2개 | 1.12~1.34GB/s | 576MB/s~1.06GB/s | 위와 같은 장비·버전, nexus 로컬·원격. 그래프 판독값 | Palark(제3자, 2022-06) |

기본 `io_engine.cpuCount`는 2이며, 이 값이 Pod 쪽 이니시에이터의 큐 수도 정합니다. `io_engine.nvme.tcp.maxQueueDepth` 기본값은 32이므로 볼륨 하나의 동시 I/O는 대략 64개로 해석할 수 있습니다. 코어 격리는 `isolcpus`와 `io_engine.coreList`로 설정합니다.

## 2. LINSTOR·Piraeus의 커널 복제

Piraeus는 LINSTOR를 Kubernetes에 배포하는 오퍼레이터이고, LINSTOR는 DRBD 볼륨을 만들고 배치합니다. Pod는 로컬 DRBD 블록 장치에 바로 쓰므로 Pod와 장치 사이에 네트워크 프로토콜이 끼지 않습니다.

{{< flow src="_flow/3-drbd-쓰기-경로.json" />}}

### 쓰기 완료와 재연결의 기준

기본 Protocol C는 로컬 디스크와 모든 원격 디스크의 쓰기가 끝나야 완료로 응답합니다. 기본 읽기 정책 `prefer-local`은 로컬 사본에서 읽기를 끝냅니다. 사본 없는 노드는 diskless 클라이언트가 되어 Pod의 읽기와 쓰기를 다른 노드에 보냅니다. 이때 쓰기는 디스크가 있는 모든 피어로 나갑니다.

DRBD는 노드별 메타데이터에 사본의 이력을 남깁니다. 피어를 잃은 Primary가 첫 쓰기를 할 때 새 세대를 만들고, 연결이 끊긴 동안 바뀐 블록은 피어별 비트맵에 기록합니다. 재연결 때는 세대 식별자(GI), 곧 UUID를 비교해 재동기화 방향과 범위, 스플릿 브레인 여부를 정합니다. Primary 크래시 뒤에는 activity log에 남은 최근 쓰기 영역도 재동기화합니다.

LINSTOR는 디스크 있는 사본 3개, 또는 2개와 diskless tiebreaker 1개가 있으면 쿼럼을 자동으로 켭니다. 복제 2개 볼륨에는 tiebreaker를 자동으로 붙입니다. 쿼럼을 잃은 쪽은 쓰기를 멈추거나 오류를 냅니다. 노드 장애 뒤에는 Piraeus HA Controller가 DRBD 쿼럼 상태를 보고 Pod를 지워 다른 노드에서 다시 시작하도록 합니다.

LINSTOR의 NVMe 레이어는 별도로 NVMe-oF 연결을 구성하는 기능입니다. 이 레이어만 쓰면 복제가 없으며, DRBD 아래에 두어도 복제는 DRBD가 맡습니다.

### 클러스터 합계와 볼륨 하나의 성능

기본 로컬 읽기 정책을 고려하면, LINBIT의 클러스터 읽기 기록은 노드별 SSD 성능의 합에 가깝다고 추정합니다. 여러 볼륨·노드의 합계를 볼륨 하나의 성능으로 읽어서는 안 됩니다.

| 범위 | 읽기 | 쓰기 | 조건 | 측정 주체 |
|---|---|---|---|---|
| 12노드 합계 | 4k 랜덤 1,480만 IOPS | 4k 랜덤 500만 IOPS, 지연 85µs | 보도자료 기준 3중 동기 복제. 전송·fio 조건·볼륨 수·DRBD 버전 미공개 | LINBIT(벤더, 2020-01) |
| 3노드 합계 | 4k 랜덤 2,550만 IOPS, 128k 순차 103.53GiB/s | 4k 랜덤 316만 IOPS, 128k 순차 17.61GiB/s | 복제 2개, Ampere Altra Max M128-30, PM1733a 30.72TB 8개/노드, 100GbE 2개. 전송·iodepth·numjobs·볼륨 수 미공개 | LINBIT·Ampere(벤더, 2023-03) |
| 볼륨 1개 | 4k 랜덤 약 41만 IOPS(원시 약 78만), 1M 순차 3.2GiB/s(원시와 같음) | 4k 랜덤 17만 IOPS(원시 30만), 1M 순차 2.3GiB/s(원시와 같음) | 2노드, 복제 2개, Protocol C, TCP, DRBD 9.2.7. Xeon Gold 6226R 2개, KIOXIA CD6, 100GbE. fio libaio, 워커 1~64개·워커당 QD16 | E4(제3자, LINBIT 블로그 게스트 글, 2024-09) |

DRBD는 기본으로 리소스 하나에 CPU 하나를 사용하며, `cpu-mask`로 여러 CPU를 허용할 수 있습니다. 풀 선택에서는 LVM thick이 원시 성능에 가장 가깝습니다. 재동기화 속도 상한 `c-max-rate`의 기본값은 약 100MiB/s이며, NVMe 클러스터에서는 이 상한 때문에 복구가 길어질 수 있습니다.

## 3. SupremeRAID의 GPU RAID와 측정 경로

SupremeRAID는 GPU로 RAID 패리티를 계산하며, 일반 애플리케이션에는 가상 드라이브를 커널 블록 장치로 제공합니다.

{{< flow src="_flow/4-supremeraid-노드-안.json" />}}

### GPU 직접 I/O와 커널 블록 장치

2026-07-15 발표의 "GPU-initiated I/O"는 GPU에서 도는 코드가 스토리지 I/O를 직접 내는 경로입니다. 호스트 CPU의 애플리케이션이 커널 블록 장치에 보내는 4k I/O 성능과는 구분해야 합니다.

보도자료에는 GPU 모델과 카드 수, 서버, 드라이버 버전, 읽기와 쓰기의 구분, 큐 깊이, 지연이 없습니다. 제품·에디션 이름도 명시되지 않았습니다. 제3자 재현 자료는 찾지 못했습니다.

커널 블록 장치 쪽 수치는 카드 세대를 구분해서 읽어야 합니다. SR-1010은 2022년에 나온 구형 카드(RTX A2000)입니다. 현행 라인업은 Ultra(RTX 2000 Ada), Pro(RTX A1000), Core(RTX A400)이고 Ultra가 SR-1010의 자리를 이은 최상위 카드입니다. 조건을 밝힌 제3자 측정은 구형 SR-1010에만 있습니다. Ultra의 수치는 조건이 없는 벤더 브로셔 값입니다. 쓰기 성능은 카드 세대와 별개로 2.0 드라이버에서도 올랐다고 벤더가 밝혔습니다.

| 경로·측정 | 공개 성능 | 조건 | 측정 주체 |
|---|---|---|---|
| GPU 직접 I/O | 1억 IOPS | RAID 5 볼륨 1개, KIOXIA XD8 32개, 512바이트 랜덤 | Graid(벤더, 2026-07) |
| 커널 블록 장치, Ultra(현행 최상위) | 읽기 30M IOPS, 쓰기 6M IOPS, 최대 280GB/s | SSD 32개, RTX 2000 Ada, PCIe Gen4 x8. RAID 레벨·SSD 모델·fio 조건 미공개 | Graid 브로셔(벤더, 2026-04) |
| 커널 블록 장치, SR-1010(구형) 랜덤 I/O | 4k 읽기 2,850만 IOPS, 쓰기 202만 IOPS | RAID 5, CM7-R 3.84TB 24개(Gen5), Supermicro AS-2125HS-TNR, EPYC 9654 2개, 드라이버 1.5.0-659. fio 192스레드·QD32 | StorageReview(제3자, 2023-11) |
| 커널 블록 장치, SR-1010(구형) 순차 I/O | 1M 읽기 279GB/s, 쓰기 148GB/s | 위와 같은 플랫폼·SSD·드라이버. fio 192스레드·QD16 | StorageReview(제3자, 2023-11) |
| 커널 블록 장치, Pro(현행 중간 등급)와 드라이버 2.0 | 4k 랜덤 쓰기 494만 IOPS | RAID 5, CM7 3.2TB 24개, EPYC 9755 2개, Pro 카드(RTX A1000), fio 3.40. iodepth·numjobs 미기재 | Graid(벤더, 2025-12) |

StorageReview의 같은 플랫폼에서 Linux mdraid도 1M 순차 읽기는 같은 대역폭을 냈고, 큰 격차는 랜덤·순차 쓰기에서 나타났습니다. 읽기 최대치만으로 패리티 RAID의 차이를 판단하기는 어렵습니다.

### 쓰기 완료와 장애 복구

SupremeRAID는 쓰기 캐시가 없는 write-through 방식이며, 노드 안 스트라이프와 패리티 쓰기의 완료를 기다립니다. 비정상 종료 뒤에는 패리티를 재동기화합니다. 카드가 고장 나면 SSD에도 저장된 RAID 설정으로 새 카드에서 어레이를 복원할 수 있습니다.

일반 구성의 보호 범위는 노드 안 드라이브 고장입니다. 노드가 죽으면 해당 데이터에 접근할 수 없습니다. 다른 노드의 사본을 골라 서비스를 재개하는 Mayastor·DRBD와는 장애 대응 범위가 다릅니다.

## 4. 보호 범위와 클러스터 선택

### 운영 조건 비교

| 항목 | Mayastor | LINSTOR·Piraeus | SupremeRAID |
|---|---|---|---|
| 데이터 경로 | 사용자 공간 SPDK(io-engine) | 커널 DRBD 모듈 | 커널 모듈과 GPU 카드 |
| 노드 간 전송 | NVMe/TCP, NVMe/RDMA | DRBD 프로토콜(TCP, lb-tcp, RDMA) | 없음. NVMe-oF 가져오기·내보내기는 별도 기능 |
| Kubernetes 연결 | CSI 포함 | CSI 포함 | 공식 CSI·배포 가이드를 찾지 못함 |
| 상시 자원·호스트 의존성 | 노드마다 폴링 코어와 hugepage | 호스트 커널 모듈 | GPU 카드, PCIe 슬롯, 라이선스 |

### 장단점과 배치 조건

| 제품 | 장점 | 단점 | 맞는 조건 |
|---|---|---|---|
| Mayastor | 표준 NVMe-oF, 커널 모듈 빌드 불필요 | etcd 의존, 최근 버전의 조건 있는 측정 부족 | 스토리지 전용 코어와 RDMA 망을 확보한 클러스터 |
| LINSTOR·Piraeus | 로컬 읽기, 다볼륨 확장 | 단일 볼륨 랜덤 I/O 한계, thin 풀 성능 저하 | 볼륨이 많고 사본이 있는 노드에 Pod를 배치할 수 있는 클러스터 |
| SupremeRAID | 패리티 RAID 쓰기 성능, 용량 효율 | 노드 장애 별도 대응, Kubernetes 연결 직접 구성 | 노드 안 용량 효율이 필요하고 다른 계층에서 노드 장애에 대응하는 구성 |

볼륨 하나의 랜덤 쓰기 지연이 중요하면 Mayastor와 DRBD 모두 네트워크 왕복과 가장 느린 사본의 지연이 하한을 정합니다. 애플리케이션이 스스로 복제한다면 03편의 로컬 PV가 세 제품보다 I/O 경로가 짧습니다.

## 5. 노드 안 RAID와 노드 간 복제의 조합

노드마다 SSD가 12개일 때 원시 용량 대비 사용 가능 용량은 노드 간 3복제 33%, RAID 5(11+1)와 2복제 약 46%, RAID 6(10+2)와 2복제 약 42%입니다.

{{< flow src="_flow/6-두-층-조합.json" />}}

SupremeRAID 가상 드라이브 위에 Mayastor나 LINSTOR를 구성한 공개 사례와 성능 수치는 찾지 못했습니다. Mayastor DiskPool에 RAID 가상 드라이브를 쓰는 공식 검증 자료도 찾지 못했습니다.

## 확인하지 못한 것

- Mayastor 2.x에서 하드웨어와 fio 조건을 밝힌 벤치마크는 찾지 못했다.
- Mayastor 복제 3개의 쓰기 IOPS·지연, HA 전환 중 I/O 정지 시간, 리빌드 속도를 조건과 함께 잰 공개 자료는 찾지 못했다.
- DRBD 9.3과 Gen4·Gen5 NVMe에서 볼륨 하나의 4k 랜덤 쓰기를 원시와 견준 2025~2026년 제3자 자료는 찾지 못했다.
- SupremeRAID의 GPU 직접 I/O 경로를 Kubernetes Pod에서 쓰는 방법과 2.0 쓰기 성능의 제3자 재측정 자료는 찾지 못했다.

## 참고 자료

- [Mayastor io-engine nexus 소스 (v2.12.2)](https://github.com/openebs/mayastor/tree/v2.12.2/io-engine/src/bdev/nexus)
- [Mayastor HA failover 설계 문서](https://github.com/openebs/mayastor/blob/v2.12.2/doc/design/ha-failover.md)
- [mayastor-control-plane (v2.12.2)](https://github.com/openebs/mayastor-control-plane/tree/v2.12.2/control-plane/agents/src/bin/core)
- [mayastor-extensions Helm chart values.yaml](https://github.com/openebs/mayastor-extensions/blob/v2.12.2/chart/values.yaml)
- [OpenEBS 4.6.x Enable RDMA for Volume Targets](https://github.com/openebs/website/blob/main/docs/versioned_docs/version-4.6.x/user-guides/replicated-storage-user-guide/replicated-pv-mayastor/configuration/rs-rdma.md)
- [Mayastor NVMe-oF TCP performance](https://github.com/openebs/website/blob/main/website/src/blogs/mayastor-nvme-of-tcp-performance.md)
- [Palark, Kubernetes storage performance comparison](https://palark.com/blog/kubernetes-storage-performance-linstor-ceph-mayastor-vitastor/)
- [DRBD 9 User Guide](https://linbit.com/drbd-user-guide/drbd-guide-9_0-en/)
- [LINSTOR User Guide](https://linbit.com/drbd-user-guide/linstor-guide-1_0-en/)
- [LINBIT 14.8M IOPS 보도자료](https://www.prweb.com/releases/linbit-announces-14-8-million-iops-world-record-for-hyperconverged-storage-841406214.html)
- [Benchmarking on Ampere Altra Max Platform with LINBIT SDS](https://linbit.com/blog/benchmarking-on-ampere-altra-max-platform-with-linbit-sds/)
- [Independent Performance Testing of DRBD by E4](https://linbit.com/blog/independent-performance-testing-of-drbd-by-e4/)
- [SupremeRAID Linux 드라이버 2.0.0 릴리스 노트](https://docs.graidtech.com/sr/release-notes/linux/2.0/2.0.0/)
- [SupremeRAID 사용자 가이드 2.0.1](https://docs.graidtech.com/sr/user-guide/linux/2.0.1/)
- [Graid FAQ](https://graidtech.com/faq)
- [Graid, 100 Million IOPS for GPU-Initiated I/O](https://graidtech.com/post/100-million-iops-for-gpu-initiated-io)
- [SupremeRAID Ultra 브로셔](https://download.graidtech.com/document/brochure/SupremeRAID-Ultra/SupremeRAID-Ultra-Brochure-April-2026.pdf)
- [StorageReview, Graid SupremeRAID Gen5 Support](https://www.storagereview.com/review/graid-supremeraid-gen5-support-lets-ssds-fly)
