---
title: "Mayastor·LINSTOR·SupremeRAID — 복제 경로와 측정 조건으로 읽는 NVMe 최대 성능"
linkTitle: "09 Mayastor·LINSTOR·SupremeRAID 최대 성능"
description: "OpenEBS Mayastor, LINSTOR·Piraeus(DRBD), Graid SupremeRAID의 쓰기 경로와 장애 복구 방식을 살펴본다. GPU 직접 I/O의 1억 IOPS부터 단일 볼륨과 클러스터 합계까지, 공개 성능의 측정 조건을 구분하고 Kubernetes 클러스터의 선택 조건을 비교한다."
weight: 9
date: 2026-11-17
lastmod: 2026-11-17
url: "/storage/09-mayastor-linstor-supremeraid/"
---

# 09 · Mayastor·LINSTOR·SupremeRAID — 복제 경로와 측정 조건으로 읽는 NVMe 최대 성능

Mayastor와 LINSTOR·Piraeus는 노드 사이에 볼륨 사본을 만들고, Graid SupremeRAID는 노드 한 대 안의 SSD를 RAID로 묶습니다. NVMe SSD의 성능을 최대한 끌어내려는 도구들이지만, 쓰기를 처리하는 위치와 보호하는 장애 범위가 다릅니다. Mayastor의 복제 경로에는 NVMe-oF가 쓰이고, LINSTOR의 복제 계층인 DRBD는 자체 프로토콜을 씁니다.

공개된 IOPS도 측정 범위부터 확인해야 합니다. Mayastor에는 볼륨 하나의 값이, LINSTOR에는 여러 노드와 볼륨을 더한 기록이 있습니다. SupremeRAID는 서버 안 SSD 수십 개의 합산 성능을 제시하며, 2026년의 1억 IOPS 발표는 GPU가 직접 I/O를 내는 별도 경로에서 나온 값입니다. 쓰기 한 건의 처리와 장애 복구를 먼저 살펴본 뒤, 각 수치가 어느 경로와 조건을 가리키는지 보겠습니다.

2026-11-17 기준으로 확인한 버전은 OpenEBS 4.6.2(Mayastor 2.12.2), piraeus-operator 2.12.1(LINSTOR 1.35.3, DRBD 9.3.4), SupremeRAID Linux 드라이버 2.0.1 Update 262입니다. 직접 측정한 값은 없습니다. 모두 공개 자료에서 가져왔으며 벤더 측정, 제3자 측정, 사용자 보고를 구분했습니다.

도입 조건은 [08 Kubernetes NVMe-oF와 Mayastor]({{< relref "/data/block-storage/08-kubernetes-nvmeof-mayastor/index.md" >}})에서 다뤘습니다. 복제를 어느 계층에 둘지는 [03 로컬 디스크와 복제]({{< relref "/data/block-storage/03-local-disk-ha/index.md" >}}), TCP와 RDMA의 차이는 [07 FC·TCP·RDMA 전송 비교]({{< relref "/data/block-storage/07-fc-tcp-rdma-transports/index.md" >}})에서 이어서 볼 수 있습니다.

## 1. Mayastor — 볼륨의 쓰기와 사본 상태를 관리하는 nexus

Mayastor에서는 볼륨마다 하나씩 생기는 nexus가 복제를 맡습니다. Pod 쪽 커널 NVMe/TCP 이니시에이터가 nexus에 연결하고, nexus는 원격 replica에 NVMe-oF로 연결합니다. nexus가 Pod와 같은 노드에 있어도 Pod의 I/O는 커널 이니시에이터를 지납니다.

아래 도식에서는 볼륨 하나의 쓰기가 nexus에서 세 replica로 나뉘는 지점을 볼 수 있습니다.

{{< flow src="_flow/2-mayastor-쓰기-경로.json" />}}

### 모든 사본의 완료를 기다리는 쓰기

nexus는 살아 있는 replica 전부에 쓰기를 보내고 모두 끝나야 완료로 응답합니다. 과반의 완료만으로 응답하지는 않습니다. 리빌드 중인 replica도 쓰기를 받으므로 쓰기 완료를 기다리는 대상에 포함됩니다.

읽기는 정상 replica 사이에서 라운드로빈으로 고릅니다. 리빌드 중인 replica에는 읽기를 보내지 않으며, 로컬 replica를 우선하는 로직도 v2.12.2 소스에는 없습니다. flush는 모든 replica에 전달됩니다.

이 방식에서는 가장 느린 replica가 쓰기 지연을 정합니다. 메인테이너가 쓰기 성능을 "set by the lowest common denominator"라고 설명한 이유입니다.

### 응답 전에 남기는 replica 장애 기록

일부 replica에서 쓰기가 실패해도 남은 replica로 그 I/O를 다시 제출할 수 있습니다. 이때 nexus는 실패한 replica가 더는 최신 사본이 아니라는 사실을 etcd에 먼저 기록합니다. 그 기록을 마치기 전에 Pod에 성공을 응답해서는 안 됩니다. 응답한 쓰기가 빠진 replica를 여전히 정상 사본으로 믿게 될 수 있기 때문입니다.

아래 순서도에서는 etcd 기록이 재제출과 응답보다 앞서는 순서를 확인할 수 있습니다.

{{< seq src="_seq/2-replica-장애-처리.json" />}}

etcd에 기록하는 동안 nexus는 재제출을 멈춥니다. 기록이 실패하면 1초 간격으로 기본 300회를 다시 시도하고, 끝내 실패하면 스스로 내려갑니다. etcd가 멈추면 볼륨 I/O도 수 분 동안 멈출 수 있다는 뜻으로 해석합니다. 응답 없는 replica를 실패로 판정하는 I/O 타임아웃은 기본 110초입니다.

마지막으로 남은 정상 replica에는 예외가 있습니다. 그 replica가 실패해도 unhealthy로 기록하지 않습니다. 컨트롤 플레인이 nexus를 다시 만들 때 가장 최신 데이터의 기준으로 삼을 사본을 남겨 두려는 동작입니다.

### 재시작 때 기준이 되는 replica

Mayastor는 쿼럼으로 최신 사본을 고르지 않습니다. 복구의 기준은 etcd의 `NexusInfo`에 남긴 replica별 healthy 플래그와 `clean_shutdown` 값입니다. 정상 종료했거나 외부에 게시하지 않은 볼륨은 healthy replica 전부로 nexus를 다시 만듭니다. 게시 중이던 nexus가 불시에 종료됐다면 healthy replica 가운데 하나만 붙이고, 나머지는 그 사본에서 리빌드합니다. 쓰기 도중 nexus가 죽으면 마지막 쓰기가 반영된 범위가 replica마다 다를 수 있기 때문입니다.

리빌드 범위는 변경 구간을 기록한 비트맵을 쓸 수 있는지에 따라 달라집니다. nexus는 replica가 빠진 순간부터 바뀐 구간을 메모리에 기록합니다. 기본 600초 안에 replica가 돌아오면 기록된 구간만 복사하고, 그 시간을 넘기면 전체를 복사합니다. 비트맵이 nexus 메모리에만 있으므로 nexus가 재시작된 뒤에는 부분 리빌드를 쓸 수 없고 전체 복사가 필요하다고 추정합니다.

### nexus 장애 뒤의 새 경로와 독점 예약

nexus 노드가 죽으면 HA 에이전트가 경로 실패를 감지하고 다른 노드에 같은 NQN으로 nexus를 만듭니다. Pod 쪽 커널 NVMe multipath는 새 경로로 I/O를 다시 보냅니다. 설계 문서는 이를 active-active와 구분하며 "implicitly assumes some I/O downtime"이라고 밝힙니다. 전환 시간은 "within seconds"라고만 적혀 있고, 실제 I/O 정지 시간을 잰 값은 공개되지 않았습니다.

옛 nexus가 살아 있을 때 함께 쓰는 사고는 NVMe reservation으로 막습니다. 새 nexus가 replica에 독점 예약을 걸면서 옛 예약을 빼앗습니다. 옛 nexus는 쓰기에서 `RESERVATION_CONFLICT`를 받으면 스스로 내려갑니다. nexus와 같은 노드의 로컬 replica에는 reservation을 걸 수 없다는 예외가 있습니다. 비정상 종료된 nexus의 로컬 replica는 컨트롤 플레인이 볼륨에서 떼어 냅니다.

스냅샷을 찍을 때도 nexus가 사본 사이의 시점을 맞춥니다. I/O를 잠시 멈추고 모든 replica에서 함께 스냅샷을 찍습니다. 데이터 블록 체크섬이나 스크럽은 io-engine 소스에서 찾지 못했습니다.

### 볼륨 하나의 공개 성능과 측정 조건

현재 버전의 성능 상한을 공개 자료만으로 잡기는 어렵습니다. 조건이 가장 잘 남은 자료는 08편에서도 다룬 2020년 MayaData 측정이며, 1.0 이전 버전의 결과입니다. 이후 공식 RDMA 표에는 하드웨어와 fio 조건이 빠져 있습니다.

2020년 Optane 측정에서는 복제 2개의 쓰기 손실이 원시 장치 대비 약 8%였습니다. 제3자 측정에서는 격차가 더 컸습니다. 2022년 Palark 비교의 T1Q128 읽기는 같은 글의 원시 NVMe 대비 약 20%였고, 2023년 사용자 보고 두 건도 원시의 30% 안팎이거나 그보다 낮았습니다. 이 값들을 최근 버전이나 다른 pool 백엔드의 결과로 옮겨 읽을 수는 없습니다.

공개된 값 가운데 대표적인 것은 다음과 같습니다. 행마다 조건이 다르므로 위아래로 견줄 수는 없습니다.

| 측정 | 읽기 | 쓰기 | 조건 | 측정 주체 |
|---|---|---|---|---|
| 4k 랜덤, 복제 1개 | 579K IOPS(로컬 585K) | 490K IOPS(로컬 516K) | Optane 1대, QD64·numjobs 8, 코어 4개 격리, pool `pcie:///`, 1.0 이전 | MayaData(2020-11) |
| 4k 랜덤, 복제 2개 | 993K IOPS | 473K IOPS | 위와 같음. 읽기는 두 replica에서 라운드로빈 | MayaData(2020-11) |
| 4k, 복제 1개, TCP | 순차 읽기 563MB/s | 랜덤 쓰기 323MB/s | Pod·nexus·replica 같은 노드. 하드웨어·fio 조건 미공개 | OpenEBS 문서(2025-02) |
| 4k, 복제 1개, RDMA | 순차 읽기 1,256MB/s | 랜덤 쓰기 474MB/s | 위와 같음 | OpenEBS 문서(2025-02) |
| 4k 랜덤, 복제 2개 | 70.1K~131.3K IOPS | 61.1K~99.9K IOPS | Mayastor 1.0.0, PM983, 10GbE | Palark(2022-06) |
| 4M 순차, 복제 2개 | 1.12~1.34GB/s | 576MB/s~1.06GB/s | 위와 같음 | Palark(2022-06) |

접힌 표에는 조건 전체와 대역폭을 4KiB로 나눈 환산값을 함께 두었습니다. 복제 3개의 쓰기 IOPS와 지연을 조건과 함께 잰 공개 자료는 이번에도 찾지 못했습니다.

{{% details title="Mayastor 수치의 측정 조건" closed="true" %}}

| 수치 | 조건 | 측정 주체·시점 | 출처 |
|---|---|---|---|
| 4k 랜덤 읽기/쓰기/혼합: 로컬 585K/516K/476K, 복제 1개 579K/490K/454K, 복제 2개 993K/473K/568K | Xeon Gold 6252, Optane, ConnectX-6, fio libaio QD64·numjobs 8, pool `pcie:///`. io-engine 코어 4개 격리(작성자 회고) | MayaData CTO, 2020-11, 1.0 이전 | Mayastor NVMe-oF TCP performance, 이슈 #1463 |
| 4k 순차 읽기 TCP 563MB/s·931.1µs, RDMA 1,256MB/s·416.9µs. 4k 랜덤 쓰기 TCP 323MB/s·1,624.4µs, RDMA 474MB/s·1,105.4µs | 복제 1개, Pod·nexus·replica 같은 노드. SSD·NIC·CPU·fio 조건 미공개. 지연이 평균인지도 표기 없음 | OpenEBS 공식 문서, 2025-02 작성 | Enable RDMA for Volume Targets |
| 위 표의 IOPS 환산: TCP 읽기 약 137K·쓰기 약 79K, RDMA 읽기 약 307K·쓰기 약 116K | 4KiB로 나눈 값 | 이 글의 계산 | — |
| 4k 랜덤 T1Q128: 읽기 70.1K·쓰기 65.4K(nexus 로컬). T4Q128: 읽기 113.1K·쓰기 99.9K(로컬), 131.3K·98.1K(원격). 4M 순차: 읽기 1.34GB/s·쓰기 1.06GB/s(로컬), 1.12GB/s·576MB/s(원격) | Mayastor 1.0.0, 복제 2개. Ryzen 9 3900, Samsung PM983 2개/노드, 10GbE. 같은 글의 원시 NVMe는 T1Q128 읽기 339~375K. 그래프 판독값 | Palark(Andrei Kvapil), 2022-06 | Palark 비교 글 |
| 복제 1개, nexus 원격: 읽기 300K·쓰기 160K IOPS, 작성자 계산으로 원시의 약 30% | 200Gbit Mellanox, 원시 약 1M IOPS. fio 조건·버전 미공개 | 사용자 보고, 2023-10 | 이슈 #1522 |
| TCP 18K~28K IOPS. 같은 하드웨어의 수동 커널 NVMe-oF RDMA는 약 110K | 3노드, Intel E810 25G, Mayastor 2.3.0. fio 조건 미공개 | 사용자 보고, 2023-08 | 이슈 #1463 |
| 복제 3개 쓰기 IOPS·지연, HA 전환 중 I/O 정지 시간, 리빌드 속도 | 조건을 밝힌 공개 자료를 찾지 못함 | — | — |

{{% /details %}}

### 볼륨의 동시 I/O를 정하는 설정

기본 설정은 보수적입니다. Helm 차트의 io-engine 코어 수 기본값 2가 Pod 쪽 이니시에이터의 I/O 큐 수도 정하고, NVMe/TCP 큐 깊이는 기본 32입니다. 볼륨 하나가 동시에 처리하는 I/O는 대략 64개로 해석할 수 있습니다. 큐 깊이가 높은 벤치마크에서 원시 장치에 못 미치는 원인 후보입니다.

| 항목 | 내용 |
|---|---|
| 코어 격리 | `isolcpus`와 `io_engine.coreList`. 공식 Performance Tips의 유일한 항목 |
| 코어 수 | `io_engine.cpuCount`. 이니시에이터 큐 수도 함께 정한다 |
| 큐 깊이 | `io_engine.nvme.tcp.maxQueueDepth` 기본 32 |
| 전송 | `io_engine.target.nvmf.rdma.enabled`로 RDMA. RDMA를 못 쓰는 노드는 TCP로 연결 |
| pool 백엔드 | 맨 경로는 `aio://`로 해석. `uring://`이나 `pcie:///`는 명시해야 한다. 2020년 최고치는 `pcie:///`로 낸 값 |
| nexus 배치 | Pod를 io-engine 노드에 두면 nexus가 같은 노드에 놓인다 |

## 2. LINSTOR·Piraeus — 커널 DRBD의 동기 복제

LINSTOR·Piraeus의 데이터 경로는 각 노드의 커널 DRBD 모듈입니다. Piraeus는 LINSTOR를 Kubernetes에 배포하는 오퍼레이터이고, LINSTOR는 DRBD 볼륨을 만들고 배치하는 관리 평면입니다. Pod는 같은 노드의 DRBD 블록 장치에 바로 씁니다. Pod와 로컬 DRBD 장치 사이에는 네트워크 프로토콜이 끼지 않습니다.

아래 도식에서는 DRBD가 하나의 쓰기를 로컬 저장장치와 원격 피어에 함께 보내는 경로를 볼 수 있습니다.

{{< flow src="_flow/3-drbd-쓰기-경로.json" />}}

노드 사이 복제에도 NVMe-oF를 쓰지는 않습니다. DRBD 자체 프로토콜이 TCP, 여러 경로를 함께 쓰는 lb-tcp, RDMA 위에서 동작합니다. LINSTOR의 NVMe 레이어는 별도로 NVMe-oF 타깃과 이니시에이터를 구성하는 기능입니다. 이 레이어만 쓰면 복제가 없으며, DRBD 아래에 NVMe 레이어를 두어도 복제는 DRBD가 맡습니다.

### 로컬·원격 디스크를 기다리는 Protocol C

Kubernetes에서 기본으로 쓰이는 Protocol C는 로컬 디스크와 모든 원격 디스크의 쓰기가 끝나야 완료로 응답합니다. DRBD는 로컬 쓰기와 피어 전송을 함께 시작하고, 필요한 디스크의 완료를 기다립니다.

읽기 경로는 로컬 사본의 유무에 따라 달라집니다. 기본 정책 `prefer-local`에서는 로컬 사본에서 읽기를 끝냅니다. Pod가 사본 없는 노드에 뜨면 그 노드는 diskless 클라이언트가 되어 읽기와 쓰기를 모두 DRBD 프로토콜로 다른 노드에 보냅니다. 이때 쓰기는 디스크가 있는 모든 피어로 나갑니다.

### 재연결 때 대조하는 세대 식별자와 비트맵

DRBD는 각 노드의 메타데이터에 사본의 이력을 남깁니다. 피어를 잃은 Primary가 첫 쓰기를 할 때 새 세대를 만들고, 연결이 끊긴 동안 바뀐 블록은 피어별 비트맵에 기록합니다. 피어가 돌아오면 양쪽의 세대 식별자(GI), 곧 UUID를 비교해 재동기화 방향과 범위, 스플릿 브레인 여부를 정합니다. Primary가 크래시했을 때는 activity log에 남은 최근 쓰기 영역도 재동기화합니다.

어느 쪽이 계속 쓸 수 있는지는 쿼럼으로 제한합니다. LINSTOR는 디스크 있는 사본 3개, 또는 2개와 diskless tiebreaker 1개가 있으면 쿼럼을 자동으로 켭니다. 복제 2개 볼륨에는 tiebreaker를 자동으로 붙입니다. 쿼럼을 잃은 쪽은 쓰기를 멈추거나 오류를 냅니다.

노드 장애 뒤 Pod를 옮기는 일은 Piraeus HA Controller가 맡습니다. DRBD의 쿼럼 상태를 보고 Pod를 지우며, README 예시에서는 노드 크래시 약 10초 뒤 다른 노드의 Pod가 ContainerCreating 상태로 들어갔습니다. 체계적으로 측정한 전환 시간은 아닙니다.

DRBD 9.3부터는 재동기화 중 대상 노드로 가는 쓰기 미러링을 멈췄다가 막바지에 다시 켜는 방식이 기본입니다. 재동기화 속도 상한 `c-max-rate`의 기본값은 약 100MiB/s입니다. NVMe 클러스터에서는 이 상한 때문에 재동기화가 길어질 수 있습니다.

### 여러 볼륨의 기록과 단일 볼륨의 한계

LINBIT의 큰 IOPS 기록은 여러 노드와 볼륨의 합입니다. 볼륨 하나에서 낼 수 있는 값으로 읽으면 안 됩니다. 공개 블로그에는 볼륨 수와 fio 조건도 없습니다. 기본 정책에서 읽기는 로컬 사본으로 끝나므로, 읽기 기록은 노드별 SSD 성능의 합에 가깝다고 추정합니다.

볼륨 하나를 원시 장치와 견준 E4 측정에서는 순차 I/O와 작은 랜덤 I/O의 결과가 달랐습니다. 1M 순차 읽기와 쓰기는 원시와 같았지만, 4k 랜덤 I/O에는 손실이 있었습니다. 큐 깊이 1의 4k 쓰기를 잰 2020년 메일링 리스트 사례에서 Protocol C는 원시의 34%였습니다. 쓰기 한 건마다 네트워크 왕복과 피어 디스크의 쓰기를 기다리는 조건입니다.

DRBD는 기본으로 리소스 하나에 CPU 하나를 씁니다. 이 방식은 볼륨이 많을 때 총합이 거의 선형으로 늘어나는 이유이자, 볼륨 하나의 랜덤 I/O가 원시의 3분의 1에서 절반에 머무는 이유로 추정합니다. 클러스터 합계와 단일 볼륨 측정을 나누어 볼 필요가 있습니다.

| 범위 | 읽기 | 쓰기 | 조건 | 측정 주체 |
|---|---|---|---|---|
| 12노드 합계 | 4k 랜덤 1,480만 IOPS | 4k 랜덤 500만 IOPS, 지연 85µs | 보도자료는 3중 동기 복제. fio 조건·볼륨 수 미공개 | LINBIT(2020-01) |
| 3노드 합계 | 4k 랜덤 2,550만 IOPS, 128k 순차 103.53GiB/s | 4k 랜덤 316만 IOPS, 128k 순차 17.61GiB/s | 복제 2개, PM1733a 8개/노드, 100GbE. fio 조건·볼륨 수 미공개 | LINBIT·Ampere(2023-03) |
| 볼륨 1개 | 4k 랜덤 약 41만 IOPS(원시 약 78만), 1M 순차 3.2GiB/s | 4k 랜덤 17만 IOPS(원시 30만), 1M 순차 2.3GiB/s | 복제 2개, Protocol C, TCP, DRBD 9.2.7 | E4(2024-09) |
| 볼륨 1개, 큐 깊이 1 | — | 4k 랜덤 약 11,000 IOPS(원시 약 32,200) | Protocol C, 25G, DRBD 9.0.25 | 메일링 리스트(2020-11) |

{{% details title="LINSTOR·DRBD 수치의 측정 조건" closed="true" %}}

| 수치 | 조건 | 측정 주체·시점 | 출처 |
|---|---|---|---|
| 4k 랜덤 읽기 14.8M IOPS, 70/30 혼합 10.6M, 동기 복제 랜덤 쓰기 5.0M, 쓰기 지연 85µs | 12노드 HCI 총합. 보도자료는 3중 동기 복제라고 적음. 전송·fio 조건·볼륨 수·DRBD 버전 미공개 | LINBIT 보도자료, 2020-01 | LINBIT 14.8M 보도자료 |
| 4k 랜덤 읽기 25,504,950 IOPS, 랜덤 쓰기 3,164,295, 70/30 혼합 7,894,716, 128k 순차 읽기 103.53GiB/s, 순차 쓰기 17.61GiB/s | 3노드 총합. Ampere Altra Max M128-30, Samsung PM1733a 30.72TB 8개/노드, 100GbE 2개. 복제 2개. 전송·iodepth·numjobs·볼륨 수 미공개 | LINBIT·Ampere, 2023-03 | Ampere 벤치마크 블로그 |
| 볼륨 1개 4k 랜덤 읽기 원시 약 780K → 약 410K, 랜덤 쓰기 300K → 170K, 1M 순차 읽기 3.2GiB/s·쓰기 2.3GiB/s는 원시와 같음 | 2노드, 복제 2개, Protocol C, TCP. Xeon Gold 6226R 2개, KIOXIA CD6, 100GbE. DRBD 9.2.7. fio libaio, 워커 1~64개에 워커당 QD16 | E4(제3자, LINBIT 블로그 게스트 글), 2024-09 | E4 독립 측정 |
| QD1 4k 랜덤 쓰기: 원시 약 32,200 → Protocol A 약 30,200 → Protocol C 약 11,000 | 2노드, NVMe 10개 MD RAID-10, 25G. DRBD 9.0.25. fio numjobs 1·iodepth 1 | 사용자와 LINBIT 개발자, 2020-11 | drbd-user 메일링 리스트 |
| 24볼륨 합계 1M 순차 쓰기: 복제 없음 129GB/s, TCP 24.3GB/s, RDMA 12.2GB/s | ConnectX-7 400G, DRBD 9.3.0, 리소스 24개. LINBIT은 RDMA 전송이 큰 쓰기에서 약점이 있다고 답함 | 사용자 포럼, 2026-02 | LINBIT 포럼 1152 |
| 4k 랜덤 읽기 최대 1.50M, 랜덤 쓰기 최대 320K IOPS, 1M 읽기 33.1GB/s, 쓰기 약 5.0GB/s | Proxmox 2노드와 쿼럼 노드, 복제 2개, 가상 디스크 48개 합계. TCP, DRBD 9.2.8. `disk-flushes no`로 측정 | StarWind(경쟁 벤더), 2025-05 | StarWind 비교 글 |
| 로컬 사본이 있으면 원시 대비 3분의 1, diskless 클라이언트는 4분의 1 이하. LVM thin은 원시의 약 절반 | 3노드, PM983, 10GbE, DRBD 9.1.4. 수치는 그래프로만 있음 | Palark, 2022-06 | Palark 비교 글 |

{{% /details %}}

### 풀과 CPU 배치에 따른 성능 설정

| 항목 | 내용 |
|---|---|
| 스토리지 풀 | LVM thick이 원시에 가장 가깝다. LVM thin은 랜덤 I/O가 약 절반, ZFS는 더 낮다(Palark, Deckhouse) |
| `cpu-mask` | 기본은 리소스당 CPU 하나. 볼륨 하나의 성능을 올리려면 여러 CPU를 허용 |
| `al-extents` | 기본 1237. 흩어진 작은 쓰기에는 6007 권장. 크래시 뒤 재동기화 양이 는다 |
| `max-buffers`·`sndbuf-size` | 기본 2048·자동. 고대역 링크에서 8000, 2MiB 이상 권장 |
| `disk-flushes` | 기본 켜짐. 배터리 보호 캐시가 있을 때만 끄라고 가이드가 적는다. StarWind 수치는 끈 상태 |
| 전송 | 기본 TCP. RDMA는 큰 블록 쓰기에서 TCP보다 느린 사례가 있다 |
| 복제 네트워크 | 기본은 Pod 네트워크. 호스트 네트워크로 바꿀 수 있다 |

## 3. SupremeRAID — 노드 안 SSD를 보호하는 GPU RAID

SupremeRAID는 서버의 GPU 카드로 RAID 패리티를 계산합니다. SSD는 마더보드의 PCIe에 연결된 채로 있고, 커널 모듈이 가상 드라이브를 블록 장치로 내보냅니다. 읽기는 SSD와 호스트 메모리 사이를 바로 오가며 카드를 지나지 않습니다. 패리티 쓰기는 카드를 지난다고 Graid 임원이 2022년 인터뷰에서 밝혔습니다.

아래 도식은 노드 한 대 안에서 가상 드라이브, GPU 카드, SSD 묶음이 놓이는 위치를 보여 줍니다.

{{< flow src="_flow/4-supremeraid-노드-안.json" />}}

### GPU가 직접 낸 512바이트 1억 IOPS

Graid의 최대 성능 발표는 2026-07-15의 1억 IOPS입니다. KIOXIA XD8 SSD 32개로 만든 RAID 5 볼륨 하나에서 512바이트 랜덤 I/O로 낸 벤더 수치입니다. 발표가 가리키는 경로는 "GPU-initiated I/O", 곧 GPU에서 도는 코드가 스토리지 I/O를 직접 내는 경로입니다. 호스트 CPU의 애플리케이션이 커널 블록 장치에 4k I/O를 보내는 성능과는 구분해야 합니다.

공개 조건은 SSD 모델과 개수, RAID 레벨, 블록 크기까지입니다. GPU 모델과 카드 수, 서버, 드라이버 버전, 읽기와 쓰기의 구분, 큐 깊이, 지연은 보도자료에 없습니다. 제품·에디션 이름도 명시되지 않았습니다. Graid 자신이 측정했고, 제3자가 재현한 자료는 찾지 못했습니다.

읽기와 쓰기의 구분은 SSD 사양에서 추정할 수 있습니다. XD8의 4KiB 랜덤 쓰기는 개당 최대 25만 IOPS이므로 32개를 합쳐도 약 800만입니다. 이를 근거로 1억 IOPS는 랜덤 읽기로 해석합니다. 4KiB 랜덤 읽기 사양도 개당 230만, 합계 약 7,400만이므로 공개 사양을 기준으로 보면 512바이트 조건이어야 성립하는 수치입니다.

1억 IOPS라는 목표에는 앞선 발표도 있습니다. NVIDIA와 KIOXIA가 2027년까지 SSD 한 개에서 1억 IOPS를 내겠다는 계획이 2025년에 보도됐고, KIOXIA는 GTC 2026에서 에뮬레이터로 1억 IOPS 이상을 시연했습니다. Graid의 결과는 실제 SSD 32개를 RAID 5로 묶은 별도 발표입니다. 같은 화두에 맞춘 시연으로 보입니다.

### 커널 블록 장치에서 측정한 성능

Pod가 PVC로 붙이는 볼륨의 성능을 보려면 커널 블록 장치 경로의 자료가 필요합니다. 현행 Ultra 브로셔에는 최대 읽기·쓰기 IOPS와 대역폭이 있지만 측정 조건이 없습니다. 조건이 남은 제3자 자료는 StorageReview의 2023년 SR-1010 측정입니다.

이 측정은 Gen5 SSD를 사용하고 높은 병렬도로 I/O를 보낸 결과입니다. SR-1010의 읽기 광고치는 제3자 측정에서도 확인됐지만, 같은 플랫폼의 Linux mdraid도 1M 순차 읽기는 같은 대역폭을 냈습니다. 그 측정에서 큰 격차가 난 항목은 랜덤 쓰기와 순차 쓰기였습니다. 읽기 최대치만으로 패리티 RAID의 차이를 판단하기 어려운 이유입니다.

2.0 드라이버(2025-12)가 제시한 쓰기 성능 개선은 벤더 측정입니다. 제3자 재측정은 아직 찾지 못했습니다. 경로별 수치와 공개 조건은 다음과 같습니다.

| 경로 | 공개 최대치 | 조건 | 측정 주체 |
|---|---|---|---|
| GPU가 직접 내는 I/O | 1억 IOPS | RAID 5, XD8 32개, 512바이트 랜덤. 그 밖의 조건 미공개 | Graid(2026-07) |
| 커널 블록 장치, 읽기 | 2,850만 IOPS, 279GB/s | RAID 5, CM7-R 24개. 4k는 192스레드·QD32, 1M은 192스레드·QD16 | StorageReview(2023-11) |
| 커널 블록 장치, 쓰기 | 202만 IOPS, 148GB/s | 위와 같음 | StorageReview(2023-11) |
| 커널 블록 장치, 쓰기(2.0) | 494만 IOPS | RAID 5, CM7 24개, Pro 카드. 큐 깊이 미기재 | Graid(2025-12) |

{{% details title="SupremeRAID 수치의 측정 조건" closed="true" %}}

| 수치 | 조건 | 측정 주체·시점 | 출처 |
|---|---|---|---|
| RAID 5 볼륨 하나에서 512바이트 랜덤 1억 IOPS | KIOXIA XD8 32개(PCIe 5.0 E1.S, 4KiB 랜덤 읽기 2,300K·쓰기 최대 250K IOPS는 KIOXIA 사양). GPU-initiated I/O. GPU·카드 수·서버·드라이버·읽기/쓰기·큐 깊이·지연 미공개. WholeGraph 학습이 기준 환경과 동등했다고만 적음 | Graid 보도자료, 2026-07-15. 제3자 재현 없음 | 100 Million IOPS for GPU-Initiated I/O |
| SSD 한 개로 1억 IOPS 목표(2027), 에뮬레이터로 1억 IOPS 이상 시연 | Graid와 별개. 앞은 Nikkei 보도를 인용한 기사, 뒤는 GTC 2026 부스 | Blocks & Files 2025-09, KIOXIA 2026-06 | KIOXIA·NVIDIA 100M IOPS SSD 기사, KIOXIA GTC 2026 보고 |
| 단일 서버 300Gb/s 이상, 3,600만 IOPS | 조건 없음. Graid 뉴스 목록 요약은 GPU-initiated IOPS라고 적음 | Graid 영상 소개, 2026-09 | Rethinking RAID for AI |
| 최대 280GB/s, 읽기 30M IOPS, 쓰기 6M IOPS, SSD 32개 | RAID 레벨·SSD·fio 조건 표기 없음. RTX 2000 Ada, PCIe Gen4 x8 | Graid Ultra 브로셔, 2026-04 | SupremeRAID Ultra 브로셔 |
| RAID 5: 4k 랜덤 읽기 28M, 랜덤 쓰기 2M, 1M 순차 읽기 260GB/s, 순차 쓰기 100GB/s. 리빌드 중: 5.5M, 1.1M, 23GB/s, 21GB/s | Supermicro AS-2125HS-TNR, EPYC 9654 2개, KIOXIA CM7-R 3.84TB 24개(Gen5), 드라이버 1.5.0-rc1. bs 외 fio 조건 미기재 | Graid SR-1010 스펙시트, 2023-08 | SR-1010 스펙시트 |
| RAID 5: 4k 랜덤 읽기 28.5M(0.22ms), 랜덤 쓰기 2.02M(1.52ms), 1M 순차 읽기 279GB/s, 순차 쓰기 148GB/s. mdraid: 5.5M, 205K, 279GB/s, 3.51GB/s | 위와 같은 플랫폼·SSD, 드라이버 1.5.0-659. fio 4k는 192스레드·QD32, 1M은 192스레드·QD16 | StorageReview, 2023-11 | StorageReview Gen5 리뷰 |
| RAID 5 24드라이브: 4k 랜덤 쓰기 4.94M(1.7.2는 1.00M), degraded 4k 랜덤 읽기 9.19M, degraded 1M 읽기 225GB/s | EPYC 9755 2개, Pro 카드(RTX A1000), KIOXIA CM7 3.2TB 24개, fio 3.40. iodepth·numjobs 미기재. degraded 쓰기는 저널 끔 | Graid 2.0.0 릴리스 노트, 2025-12 | SupremeRAID 2.0.0 릴리스 노트 |
| NVMe-oF 원격 드라이브 RAID 5(7+1), 서버 6대 합계: 4k 랜덤 읽기 15.3M, 랜덤 쓰기 2.6M(RAID 없는 기준 6.26M), 128k 순차 쓰기 30.3GB/s(기준 39.6) | Lenovo SR650 6대, SR-1000, WD OpenFlex Data24, 100GbE RDMA | Graid·WD 백서, 2023-07 | OpenFlex Data24 백서 |
| AI 에디션: 4k 랜덤 읽기 최고 10.77M, 랜덤 쓰기 987.9K | Dell R770, Micron 6550 ION 61.44TB 16개, 호스트의 H100을 공유 | StorageReview, 2025-08 | StorageReview AE 리뷰 |

{{% /details %}}

### 장애 뒤의 패리티 복구와 분산 저널

SupremeRAID는 쓰기 캐시가 없는 write-through 방식이며 배터리 모듈도 없습니다. RAID 5·6의 write hole에는 비정상 종료 뒤 패리티를 다시 맞추는 재동기화로 대응합니다. 1.6부터는 드라이브가 빠진 상태의 쓰기를 보호하는 분산 저널도 추가됐습니다. 앞서 본 2.0 릴리스 노트의 degraded 쓰기 수치는 이 저널을 끈 조건입니다.

카드가 고장 나면 SSD에도 기록된 RAID 설정으로 새 카드에서 어레이를 복원할 수 있습니다. 라이선스는 GPU 시리얼에 묶여 있으므로 교체한 카드에 맞는 키가 필요합니다.

일반 구성의 보호 범위는 노드 한 대 안의 드라이브 고장입니다. 노드가 죽으면 그 노드의 데이터에 접근할 수 없습니다. HPC 에디션(HE)의 2노드 HA는 듀얼포트 NVMe를 두 서버가 공유하는 전용 섀시에서 어레이를 넘겨받습니다. 일반 Kubernetes 노드 사이에 사본을 만드는 방식과는 다릅니다.

### NVMe-oF 연결과 Kubernetes 통합

SupremeRAID는 NVMe-oF로 드라이브를 가져오고 가상 드라이브를 내보낼 수 있습니다. 원격 네임스페이스를 물리 드라이브로 등록해 RAID로 묶거나, 만든 가상 드라이브를 NVMe-oF 타깃으로 제공하는 방식입니다. 2.0부터 통합된 SPDK 타깃 모드에는 주의할 조건이 있습니다. 이 모드로 바꾼 드라이브 그룹의 가상 드라이브는 커널 블록 장치로 보이지 않습니다.

공식 CSI 드라이버나 Kubernetes 배포 가이드는 찾지 못했습니다. Kubernetes에서 쓴다면 노드에서 가상 드라이브를 만든 뒤 LVM, 로컬 PV, LINSTOR 스토리지 풀, Mayastor DiskPool에 연결하는 구성이 됩니다. 이 구성의 공개 사례도 확인하지 못했습니다.

GPU Operator와 함께 쓸 때는 검증 Pod가 RAID용 GPU를 잡으려다 실패하는 문제가 Graid 지원 문서에 올라 있습니다. 연산용 GPU만 보이도록 지정하는 것이 문서의 우회 방법입니다.

## 4. 세 제품의 보호 범위와 운영 조건

### 데이터 경로와 장애 보호의 비교

| 항목 | Mayastor | LINSTOR·Piraeus | SupremeRAID |
|---|---|---|---|
| 막는 장애 | 노드·드라이브 | 노드·드라이브 | 노드 안 드라이브 |
| 데이터 경로 | 사용자 공간 SPDK(io-engine) | 커널 DRBD 모듈 | 커널 모듈 + GPU 카드 |
| 복제·보호 방식 | nexus의 동기 N중 미러 | DRBD 동기 복제(Protocol C) | RAID 0·1·5·6·10 |
| 노드 간 전송 | NVMe/TCP, NVMe/RDMA | DRBD 프로토콜(TCP, lb-tcp, RDMA) | 없음(NVMe-oF 내보내기·가져오기는 별도 기능) |
| Kubernetes 통합 | CSI 포함 | CSI 포함 | 공식 CSI 없음 |
| 고정 자원 | 노드마다 폴링 코어와 hugepage | 호스트 커널 모듈 | GPU 카드 한 장과 PCIe 슬롯, 라이선스 |

### 쓰기 완료와 복구 기준의 비교

아래 성능 행은 각 제품에서 공개된 측정 범위를 함께 표시한 것입니다. 볼륨 하나, 여러 노드의 합계, 서버 하나의 값이 섞여 있으므로 같은 조건의 성능 순위로 읽을 수는 없습니다.

| 항목 | Mayastor 2.12 | LINSTOR·Piraeus (DRBD 9.3) | SupremeRAID 2.0 |
|---|---|---|---|
| 쓰기 완료 조건 | 살아 있는 replica 전부 | 로컬과 모든 피어의 디스크(Protocol C) | 노드 안 스트라이프와 패리티 |
| 읽기 | 정상 replica 라운드로빈 | 로컬 사본 우선 | SSD에서 직접 |
| 최신 사본 판정 | etcd의 healthy 플래그 | 노드별 세대 식별자와 비트맵 | 해당 없음(단일 노드) |
| 동시 쓰기 방지 | NVMe reservation | 쿼럼과 tiebreaker | 해당 없음 |
| 장애 뒤 복구 | 비트맵 부분 리빌드(600초 안), 그 밖에는 전체 | 비트맵 재동기화, 세대가 어긋나면 전체 | RAID 리빌드, 패리티 재동기화 |
| 공개 읽기 수치 | 볼륨 1개 약 58만 IOPS(2020, 벤더, 복제 1개) | 3노드 합계 2,550만 IOPS(2023, 벤더) | 서버 1대 2,850만 IOPS(2023, 제3자). GPU 직접 I/O로는 1억(2026, 벤더, 512바이트, 읽기로 추정) |
| 공개 쓰기 수치 | 볼륨 1개 약 49만 IOPS(2020, 벤더, 복제 1개) | 3노드 합계 316만 IOPS(2023, 벤더, 복제 2개) | 서버 1대 RAID 5 202만 IOPS(2023, 제3자), 494만(2025, 벤더) |
| 제3자가 잰 원시 대비 | 읽기 약 20~30% | 볼륨 1개 랜덤 I/O 약 33~57%, 순차는 원시와 같음 | 읽기는 SSD 합에 근접 |

### 운영 여건에 따른 장단점

| 제품 | 장점 | 단점 | 맞는 조건 |
|---|---|---|---|
| Mayastor | NVMe-oF 표준 전송, RDMA 선택, 사용자 공간 경로라 커널 모듈 빌드 불필요 | 폴링 코어와 hugepage 상시 점유, Pod가 로컬이어도 NVMe/TCP 경유, etcd에 의존, 쿼럼·체크섬 없음, 최근 버전의 조건 있는 측정 부재 | 스토리지 전용 코어를 내줄 수 있고 RDMA 망이 있는 클러스터 |
| LINSTOR·Piraeus | Pod와 로컬 사본 사이에 네트워크 없음, 순차 I/O가 원시와 같음, 쿼럼과 세대 식별자, 볼륨 수에 따른 확장 | 호스트 커널 모듈 의존, 볼륨 하나의 랜덤 I/O 한계, RDMA 전송 미성숙, thin 풀의 성능 저하 | 볼륨이 많고 Pod를 사본이 있는 노드에 둘 수 있는 클러스터 |
| SupremeRAID | 패리티 RAID 쓰기와 degraded 성능, 읽기 광고치의 제3자 확인 | 노드 장애를 막지 못함, GPU 카드·슬롯·라이선스, Kubernetes 통합 없음, NVIDIA 드라이버 버전 종속 | 노드 안 용량 효율이 필요하고 다른 계층에서 노드 장애에 대응하는 구성 |

## 5. 노드 안 RAID와 노드 간 복제의 조합

SupremeRAID는 Mayastor나 LINSTOR와 함께 쓸 수 있는 층입니다. 노드 안 RAID로 드라이브 고장을 처리하면서 노드 간 사본 수를 줄이는 구성을 생각할 수 있습니다.

아래 도식은 노드 내부 RAID 위에서 노드 간 복제가 동작하는 구성을 보여 줍니다.

{{< flow src="_flow/6-두-층-조합.json" />}}

노드마다 SSD가 12개라면 사용 가능 용량을 단순 계산해 볼 수 있습니다. 노드 간 3복제만 쓰면 원시 용량의 33%입니다. 노드 안 RAID 5(11+1) 위에 2복제를 두면 약 46%, RAID 6(10+2) 위에 2복제를 두면 약 42%가 됩니다.

용량 효율만으로 조합을 판단할 수는 없습니다. LINBIT은 DRBD 아래에 RAID 1을 두는 것은 의미가 없다고 적었습니다. 패리티 RAID 위에서는 DRBD 메타데이터의 4k 쓰기가 read-modify-write를 늘리므로, 메타데이터를 별도 장치에 두라고 권합니다.

공개 검증의 범위도 제한적입니다. LINBIT이 xiRAID 위에 LVM과 DRBD를 쌓아 본 글은 기능 시험이며 성능 수치는 없습니다. Mayastor DiskPool은 블록 장치 하나를 받으므로 RAID 가상 드라이브를 풀로 쓰는 구성이 형식상 가능해 보이지만, 공식 검증 자료는 찾지 못했습니다.

## 6. 워크로드에 따른 선택 조건

- 읽기 위주이고 Pod를 사본이 있는 노드에 둘 수 있으면 DRBD의 로컬 읽기가 유리하다. Mayastor는 로컬이어도 NVMe/TCP를 지난다.
- 볼륨 하나의 랜덤 쓰기 지연이 중요하면 두 제품 모두 네트워크 왕복과 가장 느린 사본이 하한을 정한다. 복제 3개에서 조건과 함께 잰 공개 수치는 양쪽 다 없다.
- 볼륨이 많은 클러스터의 총합은 DRBD에 공개 기록이 있다. Mayastor는 클러스터 총합 수치가 공개돼 있지 않다.
- RDMA 망이 있다면 Mayastor 공식 표가 참고 자료다. 복제 1개에 Pod·nexus·replica가 같은 노드인 조건에서 4k 순차 읽기는 TCP 대비 2.2배였다. DRBD의 RDMA 전송은 큰 블록 쓰기에서 TCP보다 느린 사례가 있다.
- 패리티 RAID의 쓰기 성능과 노드 안 용량 효율이 필요하면 SupremeRAID가 후보다. 노드 장애 대비와 Kubernetes 연결은 직접 구성해야 한다.
- 애플리케이션이 스스로 복제하면 03편의 로컬 PV가 세 제품 모두보다 경로가 짧다.

## 확인하지 못한 것

- Mayastor 복제 3개의 쓰기 IOPS와 지연, HA 전환 중 I/O 정지 시간, 리빌드 속도를 조건과 함께 잰 공개 자료는 없었다.
- Mayastor 2.x 버전으로 하드웨어와 fio 조건을 밝힌 벤치마크는 찾지 못했다. 공식 RDMA 표에는 조건이 없다.
- LINBIT의 1,480만·2,550만 IOPS 기록의 볼륨 수, 전송, fio 조건은 공개 자료에 없다.
- DRBD 9.3과 Gen4·Gen5 NVMe에서 볼륨 하나의 4k 랜덤 쓰기를 원시와 견준 2025~2026년 제3자 자료는 찾지 못했다.
- Piraeus에서 쿼럼을 잃었을 때 실제로 적용되는 동작이 I/O 정지인지 오류 반환인지는 오퍼레이터 기본값과 LINSTOR 자동 쿼럼 설정이 달라 확인하지 못했다.
- Graid의 1억 IOPS 발표는 GPU 모델, 서버, 드라이버, 큐 깊이, 지연, 읽기와 쓰기의 구분이 공개되지 않았고 제3자 재현도 없었다. GPU가 직접 내는 I/O 경로를 Kubernetes Pod에서 쓰는 방법도 확인하지 못했다.
- SupremeRAID 2.0의 RAID 5·6 쓰기 수치를 제3자가 다시 잰 자료는 없었다.
- SupremeRAID 가상 드라이브 위에 Mayastor나 LINSTOR를 올린 공개 사례와 성능 수치는 찾지 못했다.

## 참고 자료

- [Mayastor v2.12.2 릴리스](https://github.com/openebs/mayastor/releases/tag/v2.12.2) — 확인한 버전
- [Mayastor io-engine nexus 소스 (v2.12.2)](https://github.com/openebs/mayastor/tree/v2.12.2/io-engine/src/bdev/nexus) — 쓰기 fan-out, replica retire, etcd 기록 순서, reservation
- [Mayastor HA failover 설계 문서](https://github.com/openebs/mayastor/blob/v2.12.2/doc/design/ha-failover.md) — nexus 전환 방식과 I/O 정지 전제
- [mayastor-control-plane (v2.12.2)](https://github.com/openebs/mayastor-control-plane/tree/v2.12.2/control-plane/agents/src/bin/core) — nexus 재생성 때 replica 선택, 리빌드 정책
- [mayastor-extensions Helm chart values.yaml](https://github.com/openebs/mayastor-extensions/blob/v2.12.2/chart/values.yaml) — 코어 수, 큐 깊이, 타임아웃 기본값
- [OpenEBS 4.6.x Enable RDMA for Volume Targets](https://github.com/openebs/website/blob/main/docs/versioned_docs/version-4.6.x/user-guides/replicated-storage-user-guide/replicated-pv-mayastor/configuration/rs-rdma.md) — TCP·RDMA 비교 표
- [Mayastor NVMe-oF TCP performance](https://github.com/openebs/website/blob/main/website/src/blogs/mayastor-nvme-of-tcp-performance.md) — 2020년 MayaData 측정
- [Mayastor 이슈 #1463](https://github.com/openebs/mayastor/issues/1463), [#1522](https://github.com/openebs/mayastor/issues/1522), [#1165](https://github.com/openebs/mayastor/issues/1165) — 사용자 성능 보고와 메인테이너 답변
- [Palark, Kubernetes storage performance comparison](https://palark.com/blog/kubernetes-storage-performance-linstor-ceph-mayastor-vitastor/) — LINSTOR·Ceph·Mayastor·Vitastor 비교(2022)
- [DRBD 9 User Guide](https://linbit.com/drbd-user-guide/drbd-guide-9_0-en/) — Protocol A·B·C, 세대 식별자, 쿼럼, 튜닝
- [LINSTOR User Guide](https://linbit.com/drbd-user-guide/linstor-guide-1_0-en/) — 계층 스택, NVMe 레이어, 자동 쿼럼
- [DRBD ChangeLog (9.3.4)](https://github.com/LINBIT/drbd/blob/drbd-9.3.4/ChangeLog) — 9.3의 재동기화 변경
- [piraeus-operator v2.12.1](https://github.com/piraeusdatastore/piraeus-operator/tree/v2.12.1) — 구성 요소와 기본 속성
- [piraeus-ha-controller](https://github.com/piraeusdatastore/piraeus-ha-controller) — 노드 장애 때 Pod 전환
- [LINBIT 14.8M IOPS 보도자료](https://www.prweb.com/releases/linbit-announces-14-8-million-iops-world-record-for-hyperconverged-storage-841406214.html) — 2020년 12노드 기록
- [Benchmarking on Ampere Altra Max Platform with LINBIT SDS](https://linbit.com/blog/benchmarking-on-ampere-altra-max-platform-with-linbit-sds/) — 2023년 3노드 기록
- [Independent Performance Testing of DRBD by E4](https://linbit.com/blog/independent-performance-testing-of-drbd-by-e4/) — 볼륨 하나의 원시 대비 측정
- [drbd-user 메일링 리스트 2020-11](https://lists.linbit.com/pipermail/drbd-user/2020-November/025747.html) — QD1 쓰기와 Protocol별 차이
- [LINBIT 포럼, RDMA over IB is twice as slow](https://forums.linbit.com/t/rdma-over-ib-is-twice-as-slow-as-tcp-with-ip-over-ib/1152) — RDMA 전송의 큰 블록 쓰기
- [StarWind, DRBD/LINSTOR vs Ceph vs StarWind VSAN](https://www.starwindsoftware.com/blog/drbdlinstor-vs-ceph-vs-starwind-vsan-proxmox-hci-performance-comparison/) — Proxmox 다볼륨 비교
- [Deckhouse linstor 모듈 FAQ](https://deckhouse.io/documentation/v1.58/modules/041-linstor/faq.html) — LVM과 LVM thin 차이
- [SupremeRAID Linux 드라이버 2.0.0 릴리스 노트](https://docs.graidtech.com/sr/release-notes/linux/2.0/2.0.0/) — SPDK 타깃, RAID 5·6 쓰기 수치
- [SupremeRAID Linux 드라이버 2.0.1 Update 262 릴리스 노트](https://docs.graidtech.com/sr/release-notes/linux/2.0/2.0.1-262/) — 확인한 버전과 지원 배포판
- [SupremeRAID 사용자 가이드 2.0.1](https://docs.graidtech.com/sr/user-guide/linux/2.0.1/) — 장치 모델, NVMe-oF, 저널
- [Graid FAQ](https://graidtech.com/faq) — 데이터 경로, write hole, 라이선스
- [Graid, 100 Million IOPS for GPU-Initiated I/O](https://graidtech.com/post/100-million-iops-for-gpu-initiated-io) — 2026-07-15 발표 원문
- [Graid 보도자료 (Newswire)](https://www.newswire.com/news/graid-technology-achieves-industry-first-100-million-iops-on-a-protected-raid-5) — 같은 발표의 보도자료
- [KIOXIA XD8 제품 페이지](https://americas.kioxia.com/en-us/business/ssd/data-center-ssd/xd8.html) — SSD 한 개의 4KiB 랜덤 사양
- [Blocks & Files, Kioxia 100 million IOPS SSD](https://blocksandfiles.com/2025/09/15/kioxia-100-million-iops-ssd-nvidia/) — KIOXIA·NVIDIA의 SSD 목표
- [KIOXIA GTC 2026 보고](https://www.kioxia.com/en-jp/insights/gtc26-202606.html) — 에뮬레이터 시연
- [Graid, Rethinking RAID for AI](https://graidtech.com/post/rethinking-raid-for-ai-inside-graid-technologys-gpu-powered-storage) — 3,600만 IOPS 언급
- [SupremeRAID SR-1010 스펙시트](https://download.graidtech.com/document/spec-sheet/sr-1010/SupremeRAID-SR-1010-Specs-2023-08-18.pdf) — RAID 레벨별 벤더 수치
- [SupremeRAID Ultra 브로셔](https://download.graidtech.com/document/brochure/SupremeRAID-Ultra/SupremeRAID-Ultra-Brochure-April-2026.pdf) — 현행 최대 광고치
- [StorageReview, Graid SupremeRAID Gen5 Support](https://www.storagereview.com/review/graid-supremeraid-gen5-support-lets-ssds-fly) — 2023년 제3자 측정
- [StorageReview, SupremeRAID AE for AI](https://www.storagereview.com/review/storage-at-gpu-speed-benchmarking-graid-supremeraid-ae-for-ai) — AI 에디션 측정
- [Techstrong, Unleashing Max Performance in NVMe SSDs with SupremeRAID](https://techstrong.it/all/unleashing-max-performance-in-nvme-ssds-with-supremeraid/) — 읽기와 쓰기의 카드 경유 여부
- [SupremeRAID with Western Digital OpenFlex Data24 백서](https://graidtech.com/post/white-paper-supremeraid-tm-with-western-digital-openflex-data24) — NVMe-oF 원격 드라이브 RAID
- [BeeGFS HA Storage with SupremeRAID HE 배포 가이드](https://docs.graidtech.com/sr-he/resources/beegfs-ha-storage-with-supremeraid-he-deployment-guide/) — 듀얼포트 공유 섀시의 2노드 HA
- [Graid 지원 KB, MicroK8s GPU Validator CrashLoopBackOff](https://support.graidtech.com/portal/en/kb/articles/microk8s-gpu-validator-crashloopbackoff-when-using-graid-supremeraid-cards) — GPU Operator와 함께 쓸 때
- [LINBIT, The Time of Hardware RAID Controllers is Over](https://linbit.com/blog/the-time-of-hardware-raid-controllers-is-over/) — DRBD 아래 RAID에 관한 권고
- [LINBIT KB, Optimizing Write Performance With DRBD and Parity RAID](https://kb.linbit.com/optimizing-write-performance-with-drbd-and-parity-raid) — 패리티 RAID 위 DRBD 메타데이터
- [LINBIT SDS is now on Xinnor xiRAID](https://linbit.com/blog/linbit-sds-is-now-on-xinnor-xiraid/) — 소프트웨어 RAID 위 DRBD 기능 시험
