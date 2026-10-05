---
title: "VM 표준 구성을 로컬 디스크로만 잡아도 되는가 — 복제를 어디에 둘 것인가"
linkTitle: "03 로컬 디스크와 복제"
description: "VM을 전부 로컬 디스크에 두고 HA로 띄우면 되느냐는 논쟁을 복제 위치로 풀어 봅니다. 층별 오버헤드, 로컬 디스크의 수명 계약, 워크로드별 HA 가능 여부, 2곳과 3곳의 용량 산술, 동기 복제의 왕복, Kubernetes의 복제 스토리지와 로컬 PV 비교를 근거 등급과 함께 정리합니다."
weight: 3
date: 2026-10-05
lastmod: 2026-10-05
url: "/storage/03-local-disk-ha/"
---

# 03 · VM 표준 구성을 로컬 디스크로만 잡아도 되는가 — 복제를 어디에 둘 것인가

VM(가상 머신)을 여러 대 띄워도 한 VM의 로컬 디스크에 쓴 데이터가 다른 VM에 복제되지는 않습니다. 로컬 디스크로 HA(고가용성)를 구성하려면 애플리케이션이 데이터를 직접 복제하거나, 웹·API처럼 디스크에 보존할 상태가 없어야 합니다. 복제 없는 작업환경 VM이나 단일 DB까지 같은 구성으로 운영하면 호스트 장애 때 데이터를 되찾지 못할 수 있습니다.

로컬 디스크를 선택하면 원격 전송과 스토리지 복제의 비용을 줄일 수 있습니다. 그 대신 애플리케이션에 복제, 장애 전환, 사본 복구를 맡길 수 있는지 확인해야 합니다. VM 표준 구성을 나누는 이유가 여기에 있습니다.

근거 표기 — `✓` 원문 직접 확인 · `Ⓥ` 벤더·저자 주장 · `Ⓑ` 벤치마크 수치 · `≈` 눈대중·역산 · `Σ` 여러 사실을 이은 종합 추론 · `?` 미확인. 각 절 끝에 접어 둔 '근거와 측정 조건' 표에 수치와 조건, 출처를 모았습니다. 전송 구간은 [01 iSCSI와 NVMe-oF]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}}), VM에 디스크를 전달하는 구간은 [02 VM 디스크 경로]({{< relref "/data/block-storage/02-vm-disk-paths/index.md" >}})에서 다뤘습니다.

## 1. 복제를 어디에 두는가

{{< flow src="_flow/1-복제-계층.json" />}}

그림의 주황 선은 다른 노드로 복제 쓰기를 보내는 구간입니다. 위쪽에서는 스토리지가, 아래쪽에서는 애플리케이션이 이 일을 맡습니다.

Ceph RBD의 쓰기는 primary OSD에 먼저 도착합니다. OSD는 Ceph에서 데이터를 저장하는 데몬입니다. primary가 secondary OSD에 복제하고 저장을 확인해야 클라이언트에 성공을 알립니다. Ceph 측 설명에는 클라이언트와 primary 사이의 왕복도 포함됩니다. Mayastor도 건강한 모든 사본에 쓰기를 보내고, 모두 완료를 알려야 응답합니다.

애플리케이션이 복제하면 디스크 쓰기는 로컬에서 처리하고 DB의 복제 로그가 노드를 건넙니다. 동기 복제는 상대가 기록했다는 응답을 기다리므로 네트워크 왕복이 남습니다. 두 경로를 비교하면, 왕복을 기다리고 복구 절차를 관리하는 계층이 스토리지에서 애플리케이션으로 바뀐다고 해석할 수 있습니다. 스토리지가 맡을 때는 앱이 복제 과정을 몰라도 되고 공통 절차를 쓸 수 있지만, 앱이 맡을 때는 DB 종류마다 절차를 갖춰야 합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Ceph RBD의 복제 쓰기 순서 | 클라이언트 → primary OSD → secondary OSD. primary가 복제 저장을 확인한 뒤 클라이언트에 성공 응답 | — | `✓` |
| Mayastor의 쓰기 완료 조건 | 건강한 모든 사본에 쓰기를 보내고 전부 완료를 알려야 응답 | — | `✓` |
| Ceph의 클라이언트와 primary 사이에도 왕복이 있음 | 클라이언트–primary 구간에서 왕복 한 번 | — | `Ⓥ` |

{{% /details %}}

## 2. 로컬 디스크로 줄어드는 것과 남는 것

로컬 디스크에서는 원격 디스크까지 가는 전송과 별도 스토리지 데몬의 비용이 빠집니다. 스토리지 계층의 복제도 없어지지만 앱이 직접 복제한다면 그 계층에서 비용이 다시 생깁니다. 아래 표의 로컬 칸은 경로를 비교한 종합 추론이고, 원격·복제 칸은 서로 다른 실험의 측정값입니다.

| 층 | 로컬 디스크 | 원격·복제 스토리지가 더하는 것 |
|---|---|---|
| 전송 | 없음 | 무부하 4K 읽기에 NVMe/RDMA가 11.7µs 추가(커널 타깃, 100GbE RoCE) |
| 전송 | 없음 | 미디어를 뺀 커널 NVMe/TCP QD1 왕복 21.39µs |
| 전송 | 없음 | iSCSI 평균 211µs, 로컬(SPDK) 78µs(4KB 읽기, 10GbE) |
| 복제 | 없음(앱 복제를 쓰면 다시 생김) | Longhorn V2 QD1 쓰기 지연이 1 replica 84µs에서 3 replica 482µs로 늘어남 |
| 복제 | 복제 데몬 없음 | Ceph RBD 3x, 4K 순차 동기 쓰기 QD1 평균 0.421ms(새 클러스터, 로컬 기준선 없음) |
| 호스트 CPU | 별도 스토리지 데몬 없음(커널·QEMU 경로를 쓸 때) | Mayastor는 노드마다 최소 2코어를 폴링으로 쓰고 hugepage 2GiB를 묶음 |
| 호스트 CPU | 복제 데몬 없음 | Ceph 4K 랜덤 쓰기에서 OSD당 약 11코어 |
| 호스트 CPU | 로컬 스택만 쓰고 코어당 350K IOPS | 커널 NVMe/TCP host 코어당 96K IOPS, 로컬 스택 350K IOPS(4K 랜덤 읽기, 커널 4.20) |
| 가상화 | 남음 | 02의 경로 비용이 그대로 |

각 행은 비용이 생기는 층을 보여 줍니다. 장비·큐 깊이·커널이 달라 행끼리 더하거나 뺄 수 없습니다. 로컬·전송·복제를 한 장비에서 같은 조건으로 이어서 잰 자료도 찾지 못했으므로, 로컬 디스크가 전체 비용을 몇 퍼센트 줄이는지는 이 표로 계산할 수 없습니다.

가상화 비용은 남습니다. Nova의 flat·qcow2·lvm 백엔드로 로컬 NVMe를 제공하면 게스트가 virtio 디스크를 거치는 경로라고 해석할 수 있습니다. Hajnoczi의 KVM Forum 발표 슬라이드에서 읽고 계산한 IOPS(초당 입출력 처리 횟수)는 기본 virtio-blk가 베어메탈의 28%, IOThread를 붙인 구성이 59%였습니다.

장치를 게스트에 직접 연결하는 passthrough는 이 비용을 대부분 없애는 것으로 추정됩니다. 대신 실행 중인 VM을 옮기는 live migration과 소프트웨어 기능에 제약이 생깁니다. 방식별 경로는 [02]({{< relref "/data/block-storage/02-vm-disk-paths/index.md" >}})에 있습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 로컬 디스크에는 원격 전송 구간이 없음. NVMe/RDMA에는 추가 지연이 있음 | 무부하 4K 읽기, 커널 타깃, 100GbE RoCE에서 NVMe/RDMA가 11.7µs 추가 | Guz et al., SYSTOR'17(Samsung) 슬라이드 p.18 | `Σ` `Ⓑ` |
| 로컬 디스크에는 원격 전송 구간이 없음. 커널 NVMe/TCP 왕복 측정값 | 미디어를 뺀 커널 NVMe/TCP QD1 왕복 21.39µs | SPDK 24.05 NVMe-oF TCP 보고서(Intel, 2024-07) Table 22 | `Σ` `Ⓑ` |
| 로컬과 iSCSI의 읽기 지연 측정값 | 4KB 읽기, 10GbE에서 iSCSI 평균 211µs, 로컬(SPDK) 78µs | ReFlex, ASPLOS'17 Table 2 | `Σ` `Ⓑ` |
| 로컬 디스크 자체에는 복제가 없지만 앱 복제를 쓰면 복제 비용이 다시 생김. Longhorn V2는 사본 수에 따라 쓰기 지연이 증가 | QD1 쓰기 지연: 1 replica 84µs → 3 replica 482µs | Longhorn v1.12.0 Performance Benchmark(위키) | `Σ` `Ⓑ` |
| 로컬 디스크에는 복제 데몬이 없음. Ceph RBD의 동기 쓰기 측정값 | 3x, 4K 순차 동기 쓰기, QD1 평균 0.421ms. 새 클러스터이며 로컬 기준선 없음 | Ceph Reef Freeze Part 1: RBD Performance(Mark Nelson, 2023-03-27) | `Σ` `Ⓑ` |
| 커널·QEMU 경로의 로컬 디스크에는 별도 스토리지 데몬이 없음. Mayastor에는 고정 자원 요구가 있음 | 노드마다 최소 2코어를 폴링에 사용하고 hugepage 2GiB를 확보 | OpenEBS 4.6.x 문서(Prerequisites, Performance Tips) | `Σ` `✓` |
| 로컬 디스크에는 복제 데몬이 없음. Ceph OSD의 CPU 사용 측정값 | 4K 랜덤 쓰기에서 OSD당 약 11코어 | Ceph Reef Freeze Part 1: RBD Performance(Mark Nelson, 2023-03-27) | `Σ` `Ⓑ` |
| 로컬 스택과 커널 NVMe/TCP host의 코어당 처리량 | 4K 랜덤 읽기, 커널 4.20. 로컬 스택 코어당 350K IOPS, 커널 NVMe/TCP host 코어당 96K IOPS | i10, NSDI'20 Figure 1 | `Σ` `Ⓑ` |
| 로컬 디스크에도 가상화 비용이 남음 | 02에서 다룬 디스크 전달 경로의 비용이 그대로 남음 | 02 VM 디스크 경로 | `Σ` `Ⓑ` |
| 전체 비용의 감소율은 확인하지 못함 | 로컬·전송·복제를 한 장비에서 같은 조건으로 이어서 잰 자료를 찾지 못해 “몇 퍼센트 덜 든다”는 단일 수치로 답할 수 없음 | — | `?` |
| Longhorn 비교의 NVMe 기준값에도 가상화 비용이 포함된 것으로 추정 | OCI VM 위에서 측정 | — | `≈` |
| Ceph 측정은 여유 공간이 많은 새 클러스터에서 수행 | 저자가 해당 조건을 밝힘 | — | `Ⓑ` |
| Nova의 로컬 NVMe도 virtio 경로를 거침 | flat·qcow2·lvm 백엔드로 제공하면 게스트에는 virtio 디스크로 보임 | — | `Σ` |
| virtio-blk의 베어메탈 대비 IOPS 비율 | QD1 4K 읽기. 기본 virtio-blk 28%, IOThread를 붙이면 59% | KVM Forum 2020 슬라이드(Hajnoczi) | `Ⓑ` `≈` |
| IOPS를 요청당 시간으로 환산 | 베어메탈 12.7µs, 기본 virtio-blk 45.8µs, IOThread를 붙이면 21.5µs | KVM Forum 2020 슬라이드(Hajnoczi) | `≈` |
| passthrough는 가상화 경로 비용을 대부분 없애는 것으로 추정 | 위 virtio 경로 비용과의 비교 | — | `≈` |
| passthrough의 기능 제약 | live migration과 소프트웨어 기능을 제한받음 | — | `✓` |

{{% /details %}}

## 3. 로컬 디스크가 약속하지 않는 것

VM을 다시 띄우는 기능만으로 기존 로컬 디스크까지 복구할 수 있는 것은 아닙니다. Nova 문서는 evacuate가 원본 이미지나 볼륨에서 인스턴스를 다시 만든다고 설명하고, 디스크 데이터를 보존하려면 공유 스토리지가 필요하다는 조건을 붙입니다. 두 설명을 종합하면 공유 스토리지 없는 로컬 디스크 인스턴스는 호스트 장애 뒤 ID·이름·IP만 남고 디스크는 새로 만들어진다고 해석할 수 있습니다. 문서에 이 결론이 그대로 적혀 있지는 않습니다.

| 시스템 | 데이터가 남는 경우 | 데이터를 잃는 경우 |
|---|---|---|
| Nova ephemeral(`images_type`이 로컬) | 계획 점검 때 block migration으로 옮김 | 호스트 장애. evacuate는 원본 이미지에서 다시 만들고 죽은 호스트의 디스크는 가져오지 않음 |
| AWS instance store | 재부팅, 전원 장애 뒤 재부팅 | stop, terminate, 인스턴스 retirement, 디스크 고장 |
| GCP Local SSD | 게스트 재부팅, live migration으로 설정한 인스턴스의 호스트 점검 | 호스트 오류 복구 실패(빈 디스크로 재시작), 선점, 강제 stop |
| Azure temporary disk | 정상 재시작 | 점검, 재배포, 정지 |

계획 점검에는 별도 경로가 있습니다. OpenStack Operations Guide는 block migration으로 인스턴스를 비운 뒤 nova-compute를 멈추도록 안내합니다. 이때 디스크 전체를 네트워크로 복사하며 완료 타임아웃에도 디스크 크기가 반영됩니다. 노드를 비우는 시간은 그 노드에 있는 인스턴스 디스크의 합을 실제 복사 속도로 나누어 추정할 수 있습니다.

NVMe를 PCI passthrough로 제공한 경우에도 이 절차로 옮길 수 있는지는 확인하지 못했습니다. KVM Forum 슬라이드는 게스트가 물리 하드웨어에 묶일 수 있다고 설명하고, Nova 문서는 장치별 live migration 지원 여부를 설정으로 밝히도록 요구합니다.

클라우드 사업자의 보존 조건도 사건과 설정에 따라 다릅니다. AWS·GCP·Azure 문서를 종합하면 재부팅 뒤에는 데이터를 유지할 수 있지만, 호스트 장애 뒤의 보존까지 보장하지는 않습니다. 계획 점검에서는 GCP가 live migration 설정의 데이터 보존을 명시하는 데 비해 Azure는 소실 가능성을 설명합니다. Nova의 로컬 디스크도 계획해서 옮기는 경로는 있어도 데이터 수명은 노드에 묶인다는 의미로 읽었습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Nova 로컬 ephemeral 디스크의 보존·소실 조건 | `images_type`이 로컬. 계획 점검 때 block migration으로 이동 가능. 호스트 장애 뒤 evacuate는 원본 이미지에서 다시 만들고 죽은 호스트의 디스크를 가져오지 않음 | — | `Σ` |
| AWS instance store의 보존·소실 조건 | 재부팅과 전원 장애 뒤 재부팅에는 보존. stop, terminate, 인스턴스 retirement, 디스크 고장에는 소실 | — | — |
| GCP Local SSD의 보존·소실 조건 | 게스트 재부팅과 live migration으로 설정한 인스턴스의 호스트 점검에는 보존. 호스트 오류 복구 실패 시 빈 디스크로 재시작하며, 선점·강제 stop에도 소실 | — | — |
| Azure temporary disk의 보존·소실 조건 | 정상 재시작에는 보존. 점검·재배포·정지에는 소실 가능 | — | — |
| Nova evacuate의 재생성 방식과 데이터 보존 조건 | "rebuilds the instance from the original image or volume". 디스크 데이터를 지키려면 공유 스토리지가 필요 | Nova 문서 | `✓` |
| 공유 스토리지 없는 로컬 디스크 인스턴스의 장애 복구 결과 | 위 문장들을 이으면 ID·이름·IP만 남고 디스크는 새로 만들어짐 | Nova 문서 | `Σ` |
| 계획 점검 절차 | `--live --block-migration`으로 인스턴스를 비운 뒤 nova-compute를 멈춤 | Operations Guide | `✓` |
| block migration의 복사량과 타임아웃 | 디스크 전체를 네트워크로 복사하며 완료 타임아웃에 디스크 크기가 더해짐 | Nova 문서(Configure live migrations) | `✓` |
| 노드 한 대를 비우는 시간의 추정 | 해당 노드의 인스턴스 디스크 합 ÷ 실제 복사 속도 | — | `Σ` |
| PCI passthrough NVMe가 이 경로로 이동하는지는 미확정 | live migration 가능 여부를 확정하지 못함 | — | — |
| passthrough 게스트가 물리 하드웨어에 묶일 수 있음 | "tied to physical hardware" | KVM Forum 2020 슬라이드 13쪽(Hajnoczi) | `✓` |
| 장치별 live migration 지원 명시 요구 | 설정으로 장치마다 지원 여부를 밝혀야 함 | Nova 문서 | `✓` |
| 세 사업자의 로컬 디스크 수명 계약에 관한 종합 | 재부팅에는 남고 다른 호스트로 옮겨지는 사건에는 남지 않는다는 해석. 계획 점검의 보존 여부에는 차이가 있음 | AWS·GCP·Azure 문서 | `Σ` |
| 계획 점검의 보존 조건 차이 | GCP는 live migration이면 보존, Azure는 점검 때 소실 가능 | GCP·Azure 문서 | `✓` |
| Nova 로컬 디스크의 수명 계약 해석 | 클라우드 사업자의 로컬 디스크 계약을 사설 클라우드에 적용한 형태 | — | `Σ` |

{{% /details %}}

## 4. 어떤 VM이 HA가 되는가

Nova 문서는 AZ(가용 영역) 자체에 HA 이점이 없다고 명시합니다. 호스트를 aggregate에 넣거나 빼는 작업으로 기존 인스턴스의 AZ가 바뀌는 경우도 거부합니다. 따라서 AZ마다 인스턴스를 따로 배치하는 것과 그 사이에 데이터를 복제하는 일을 함께 설계해야 합니다.

| 워크로드 | 로컬 디스크 + AZ 분산 | 이유 |
|---|---|---|
| 상태 없음(웹·API) | 됨 | 인스턴스를 AZ마다 두면 되고 디스크에 지킬 것이 없음 |
| 자체 복제가 있는 DB·로그(PostgreSQL, MySQL, Kafka, etcd, TiKV 등) | 됨 | AZ마다 한 대씩 두고 복제는 애플리케이션이 함 |
| 단일 인스턴스·레거시 DB | 안 됨 | 호스트 장애가 곧 데이터 소실. 비동기 복제로 받쳐도 지연만큼 잃음 |
| 작업환경 VM(개발·분석용 VM) | 안 됨 | 복제를 맡는 프로세스를 따로 두지 않으면 두 벌은 서로 무관한 VM |

Kubernetes 1.14의 local PV(노드의 로컬 저장 장치를 사용하는 영구 볼륨) GA 공지는 애플리케이션 계층에서 복제와 백업을 처리하는 워크로드에 로컬 스토리지를 권합니다. 나머지에는 원격으로 접근할 수 있고 가용성과 내구성을 갖춘 스토리지를 안내합니다. TiDB Operator 문서도 TiKV에는 로컬 SSD를, 복제본이 없는 모니터링·백업 컴포넌트에는 네트워크 스토리지를 권합니다.

이 권고를 작업환경 VM에 적용하면 차이가 분명해집니다. 사람이 VM 안에 쌓은 환경을 복제하는 프로세스가 없다면 두 번째 VM은 이미지에서 갓 만든 상태일 뿐입니다. 단일 인스턴스·레거시 DB에도 같은 문제가 생깁니다. 표의 구분은 VM 수보다 보존할 상태와 복제 기능을 기준으로 문서들을 종합한 판단입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 상태 없는 웹·API는 로컬 디스크와 AZ 분산으로 구성 가능 | AZ마다 인스턴스를 두고, 디스크에 보존할 상태가 없는 워크로드 | — | `Σ` |
| 자체 복제가 있는 DB·로그는 로컬 디스크와 AZ 분산으로 구성 가능 | PostgreSQL, MySQL, Kafka, etcd, TiKV 등. AZ마다 한 대씩 두고 애플리케이션이 복제 | — | `Σ` |
| 단일 인스턴스·레거시 DB는 로컬 디스크와 AZ 분산만으로 HA를 확보하지 못함 | 호스트 장애가 데이터 소실로 이어짐. 비동기 복제를 두어도 복제 지연만큼 유실 가능 | — | `Σ` |
| 작업환경 VM은 VM을 여러 벌 두는 것만으로 데이터를 복제하지 못함 | 개발·분석용 VM. 별도 복제 프로세스가 없으면 서로 무관한 VM | — | `Σ` |
| Nova AZ 자체에는 HA 이점이 없음 | "provide no intrinsic HA benefit by themselves" | Nova 문서 | `✓` |
| 기존 인스턴스의 AZ가 바뀌는 호스트 aggregate 변경은 거부 | 호스트를 aggregate에 넣거나 빼는 작업으로 인스턴스 AZ가 바뀌는 경우 | Nova 문서 | `✓` |
| AZ 수준 HA의 성립 조건 | 인스턴스를 AZ마다 따로 띄우고 그 사이의 데이터 복제를 애플리케이션이 담당 | — | `Σ` |
| Kubernetes local PV의 권장 워크로드 | Kubernetes 1.14 local PV GA 공지: "workloads that handle data replication and backup at the application layer"에 권장. 나머지는 "highly available, remotely accessible, durable storage" 사용 안내 | Kubernetes 1.14의 local PV GA 공지 | `✓` |
| TiDB Operator의 컴포넌트별 스토리지 권고 | TiKV에는 로컬 SSD, 복제본이 없는 모니터링·백업 컴포넌트에는 네트워크 스토리지 | TiDB Operator 문서 | `✓` |

{{% /details %}}

## 5. 두 곳에 전체 용량을 둘 때

{{< lane src="_lane/5-용량-산술.json" />}}

한 사이트가 멈춰도 피크 부하 L을 처리하려면 남은 사이트들의 연산 용량 합이 L 이상이어야 합니다. 사이트가 k곳이면 각 사이트에 L÷(k−1), 전체에 k×L÷(k−1)을 확보하는 계산입니다. 두 곳에는 각각 L이 필요해 전체 200%, 세 곳에는 각각 L의 절반이 필요해 전체 150%가 됩니다. 같은 부하에서 세 곳 구성이 연산 용량을 25% 덜 필요로 한다는 뜻입니다. 그림의 막대도 이 연산 용량을 표시합니다.

AWS Builders' Library는 3개 AZ에 50%의 여유 용량을 두고 각 AZ를 부하 시험 수준의 66%만 사용하도록 설명합니다. 위 산술과 같은 방향입니다. 점검 중에 다른 사이트까지 잃는 상황으로 조건을 바꾸면 두 곳으로는 버틸 수 없고, 세 곳의 전체 용량이 300%여야 합니다. 이 N+2 계산은 SRE Book의 인스턴스 단위 설명을 사이트 단위로 옮긴 추론입니다.

디스크 용량은 다른 계산을 따릅니다. 사이트마다 데이터 사본을 하나씩 두면 두 곳은 원본의 2배, 세 곳의 과반 합의형 복제는 3배를 저장합니다. 이 조건에서 세 곳은 필요한 연산 용량이 적고, 두 곳은 디스크 용량이 적습니다.

두 곳으로 구성할 때는 정족수도 확인해야 합니다. 구성원을 절반씩 나누면 한 곳을 잃은 뒤 남은 쪽이 과반을 확보하지 못합니다. etcd 문서의 정족수 표가 이 문제를 보여 줍니다. Ceph는 두 곳 구성에 셋째 위치의 tiebreaker 모니터를 요구합니다. CloudNativePG는 존이 둘뿐이면 Kubernetes 클러스터를 나누어 active/passive로 쓰도록 안내하며, 셋째 위치가 인프라 비용을 줄일 수 있다고 권합니다.

이 자료들을 종합하면 과반 합의형 복제에서 자동 failover를 하려면 셋째 위치가 필요합니다. 두 곳에 각각 전체 용량을 두는 선택은 사이트를 더 확보할 수 없고 primary–standby형으로 과반 없이 전환하거나, 셋째 위치에 정족수용 witness만 둘 수 있는 경우에 검토할 수 있습니다. 사람이 전환 여부를 판단할 수 있는지도 함께 결정해야 합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 한 사이트 장애를 견디는 연산 용량 | 사이트가 k곳이고 한 곳을 잃어도 남은 곳이 L을 수용. 사이트당 L÷(k−1), 전체 k×L÷(k−1) | — | `Σ` |
| 사이트 수에 따른 전체 연산 용량 | 2곳은 곳마다 L씩 두어 200%, 3곳은 곳마다 L의 절반씩 두어 150%, 4곳은 133% | — | `Σ` |
| 평상시 사용률 상한 | 2곳 50%, 3곳 66.7%, 4곳 75% | — | `Σ` |
| AWS의 AZ별 여유 용량 설명 | 3개 AZ에서 "overprovision by 50 percent". 각 AZ는 부하 시험 수준의 66%만 사용 | AWS Builders' Library | `✓` |
| 2곳과 3곳 구성의 연산 용량 차이 | 같은 부하에서 2L 대 1.5L로 차이는 0.5L. 3곳이 25% 덜 사용: ((2−1.5)÷2) | — | `Σ` |
| N+2를 사이트 단위로 적용한 용량 | 한 곳 점검 중 또 한 곳 장애까지 고려. 2곳으로는 식이 성립하지 않고, 3곳은 전체 300% 필요 | — | `Σ` |
| SRE Book의 N+2 적용 단위 | 인스턴스 단위의 설명 | SRE Book | `✓` |
| 사이트 수에 따른 데이터 사본 용량 | 2곳에 사본 하나씩이면 원본의 2배. 3곳에 과반 합의형 복제(사본 3)를 두면 3배 | — | `Σ` |
| etcd의 구성원 수와 장애 허용 | 구성원 2, 과반 2, 허용 장애 0 | etcd 문서 | `✓` |
| 두 사이트에 구성원을 반씩 배치할 때의 과반 문제 | 한 곳을 잃으면 남은 쪽이 과반에 못 미침 | — | `Σ` |
| Ceph의 두 곳 구성 요구 | 2곳에 사본 4개와 셋째 위치의 tiebreaker 모니터 필요 | Ceph 문서 | `✓` |
| CloudNativePG의 두 존 구성 안내와 셋째 위치 권고 | 존이 둘뿐이면 Kubernetes 클러스터를 둘로 나눠 active/passive 사용. 셋째 위치가 인프라 비용을 줄일 수 있다고 권고 | CloudNativePG 문서 | `✓` `Ⓥ` |

{{% /details %}}

## 6. "HA면 뭐가 문제냐"에 남는 것

{{< seq src="_seq/6-동기-커밋-한-건.json" />}}

### 커밋은 어디까지 기다리는가

로컬 디스크는 그림 위쪽에서 primary와 standby가 디스크에 기록하는 구간을 짧게 만듭니다. 로그를 보내고 응답을 받는 네트워크 왕복은 남습니다. PostgreSQL은 동기 복제의 최소 대기 시간을 primary와 standby 사이의 왕복 시간으로 설명하고, MySQL semisync도 최소한 TCP/IP 왕복 시간만큼 지연이 늘어난다고 적습니다. etcd 문서는 여기에 디스크 동기화 시간을 더합니다. 동기 standby가 죽으면 커밋이 끝나지 않을 수도 있습니다.

그림 아래쪽의 비동기 복제는 기록 응답을 기다리지 않는 대신 유실 가능성이 생깁니다. PostgreSQL 문서에 따르면 primary가 죽었을 때 이미 커밋된 트랜잭션이 standby에 없을 수 있고, 유실량은 전환 시점의 복제 지연에 비례합니다. Kafka의 `acks=1`도 팔로워가 복제하기 전에 리더가 죽으면 레코드를 잃습니다.

### 장애 뒤 사본을 다시 채우는 시간

문서들을 종합하면 로컬 디스크에만 남은 미복제 데이터는 죽은 노드가 돌아와야 회수할 수 있습니다. 원격 볼륨에는 다른 호스트에 연결해 마지막 커밋까지 복구할 경로가 남습니다. 로컬 디스크를 쓸 때는 장애 전까지 복제가 끝났는지가 복구 가능한 데이터의 범위를 좌우합니다.

노드를 잃으면 부족해진 사본도 다시 채워야 합니다. 복사 시간의 하한은 데이터 양을 네트워크·원본 읽기·대상 쓰기·복제 속도 제한 가운데 가장 느린 값으로 나눈 시간입니다. 1TB를 실제 1GB/s로 복사한다고 가정하면 약 17분, 100MB/s이면 약 2.8시간입니다. 서비스 트래픽과 대역을 나누고 밀린 DB 로그까지 따라잡으면 더 오래 걸립니다. 사본이 하나 적은 이 기간이 길어질수록 다음 장애와 겹칠 수 있는 시간도 늘어납니다.

원격·복제 스토리지에도 재복제가 필요합니다. 스토리지가 맡으면 공통 절차를 둘 수 있고, 앱이 맡으면 DB마다 복구 절차를 갖춰야 한다는 차이가 있습니다. 위 시간은 산술 예시이며 DB별 공식 재복제 속도와 측정 조건은 별도로 찾아보지 않았습니다.

### 논리 오류를 복구할 백업

ClickHouse 문서는 복제가 하드웨어 장애에는 대응해도 삭제, 잘못된 테이블, 소프트웨어 버그는 대개 모든 사본에 퍼진다고 설명합니다. MySQL과 PostgreSQL의 지연 복제 기능도 실수가 사본에 바로 전파되는 문제와 연결해 해석할 수 있습니다.

이 설명을 바탕으로 보면 로컬 디스크와 HA만 있고 백업이 없는 구성에는 논리 오류를 되돌릴 사본이 없습니다. 원격 스토리지의 스냅샷도 복제와 별개이므로 백업 요구는 어느 쪽에나 남습니다. 로컬 디스크를 선택할 때는 스냅샷과 백업을 애플리케이션마다 갖춰야 한다는 운영 차이가 있습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 그림 위쪽은 동기 복제의 커밋 한 건 | 로컬 디스크가 줄이는 구간은 primary·standby의 디스크 기록, 즉 그림의 1과 2 사이 및 2와 3 사이. 2번 로그 전송과 3번 응답으로 이루어진 네트워크 왕복은 남음 | — | — |
| PostgreSQL 동기 복제의 최소 대기 시간 | "the round-trip time between primary and standby" | PostgreSQL 문서 | `✓` |
| MySQL semisync의 추가 지연 하한 | "at least the TCP/IP roundtrip time" | MySQL semisync 문서 | `✓` |
| etcd 요청의 최소 시간 | 구성원 사이의 RTT에 fdatasync 시간을 더한 값 | etcd 문서 | `✓` |
| 동기 standby 장애 시 커밋이 완료되지 않을 수 있음 | 동기 standby가 죽은 경우 | — | `✓` |
| PostgreSQL 비동기 복제의 데이터 유실 가능성 | primary 장애 시 커밋된 트랜잭션이 standby에 없을 수 있음. 유실량은 failover 시점의 복제 지연에 비례 | PostgreSQL 문서 | `✓` |
| Kafka의 레코드 유실 조건 | `acks=1`에서 팔로워가 복제하기 전에 리더가 죽으면 유실 | Kafka 문서 | `✓` |
| 로컬 디스크와 원격 볼륨의 장애 후 복구 경로 차이 | 로컬 디스크는 죽은 노드의 디스크를 다른 호스트에 붙일 수 없어 미복제 구간을 되찾으려면 노드가 돌아와야 함. 원격 볼륨은 다른 호스트에 붙여 마지막 커밋까지 복구할 길이 남음 | — | `Σ` |
| 재복제 시간의 하한 | 데이터 양 D ÷ 네트워크·원본 읽기·대상 쓰기·복제 속도 제한 가운데 가장 느린 값 | — | `Σ` |
| 재복제 시간의 계산 예시 | D=1TB. 실제 복사 속도 1GB/s에서 약 17분, 100MB/s에서 약 2.8시간 | — | `Σ` |
| DB별 공식 재복제 속도는 미조사 | DB 종류별 속도를 측정 조건과 함께 밝힌 공식 수치를 따로 찾아보지 않음 | — | `?` |
| 복제는 논리 오류를 모든 사본에 전파할 수 있음 | 하드웨어 장애에는 대응하지만 삭제, 잘못된 테이블, 소프트웨어 버그는 대개 모든 사본에 전파 | ClickHouse 문서 | `✓` |
| MySQL과 PostgreSQL의 지연 복제 기능과 그 의미 | 지연 복제 기능이 있음. 실수가 사본에 바로 따라가는 문제와 연결한 해석 | MySQL·PostgreSQL 문서 | `✓` `Σ` |
| 로컬 디스크 + HA에서도 백업이 별도로 필요 | 백업이 없으면 논리 오류를 되돌릴 사본이 없음. 원격 스토리지의 스냅샷도 복제와 별개이므로 로컬만의 약점은 아님. 로컬은 스냅샷과 백업을 애플리케이션마다 따로 갖춰야 함 | — | `Σ` |

{{% /details %}}

## 7. Kubernetes에서는

| 항목 | 로컬 PV + 애플리케이션 복제 | 노드는 stateless, 복제 스토리지(Mayastor 등) |
|---|---|---|
| 파드 이동 | 노드에 묶임. 노드가 죽으면 파드가 Pending에 머묾 | 볼륨이 노드를 따라감. 감지되지 않은 노드 종료에서는 걸릴 수 있음 |
| 노드 장애 복구 | PVC와 파드를 지워야 다시 스케줄됨. 사람이나 오퍼레이터가 맡음 | 파드를 지우면 다른 노드에 다시 붙음(ECK 문서) |
| 쓰기 경로 | 로컬 쓰기 + 애플리케이션 복제 | 전원 응답을 기다리는 동기 미러 |
| 고정 비용 | 없음 | Mayastor io-engine 노드마다 코어 2개, hugepage 2GiB, RAM 1GiB |
| 사본 수 | 앱 사본 수(a=3이면 3) | 앱 사본 × 스토리지 사본(3×3=9) |
| 복제 없는 앱 | 노드나 디스크를 잃으면 데이터를 잃을 수 있음 | 지킬 수 있음 |
| 스토리지 제약 | 정적 PV만 가능, 동적 프로비저닝 없음 | zone에 묶인 볼륨은 AZ를 넘지 못함 |

### 앱 복제와 스토리지 복제가 겹칠 때

로컬 PV는 데이터를 노드에 두고 애플리케이션이 복제합니다. 복제 스토리지는 볼륨을 다른 노드에 연결할 수 있게 하지만, 앱도 복제하면 사본이 겹칩니다. 애플리케이션 사본이 a개, 스토리지 사본이 s개이면 물리 사본과 논리 쓰기 한 번당 장치 쓰기를 a×s로 계산할 수 있습니다. a=3, s=3이면 9입니다.

CloudNativePG는 Longhorn·Ceph식 스토리지 복제를 겹칠 때 쓰기 증폭이 생긴다고 설명하며 스토리지 복제를 권하지 않습니다. 스토리지 사본을 1로 낮출 때는 같은 클러스터의 여러 인스턴스 블록이 한 호스트에 모이지 않게 하도록 권합니다. Strimzi도 Kafka에 복제 스토리지가 필요 없다고 설명합니다.

로컬 디스크의 사본 수 역시 장애 가능성을 고려해 정해야 합니다. CockroachDB는 로컬 디스크에서 복제 계수를 기본 3에서 5로 높이는 방안을 고려하라고 안내합니다. 이 글의 산술에서 로컬 사본 5개는 앱과 스토리지를 각각 3중 복제한 물리 사본 9개보다 적지만, 로컬이면 기본 사본 3개로 충분하다는 뜻은 아닙니다.

### 고정 자원과 장애 전환 조건

Mayastor io-engine은 노드마다 코어 2개, hugepage 2GiB, RAM 1GiB를 요구합니다. 배정된 코어를 계속 사용하므로 문서는 `isolcpus`로 간섭을 줄이도록 안내합니다. 최소 노드 수는 3이고 볼륨은 NVMe-oF TCP로 내보냅니다. 타깃 장애 때 볼륨의 입구인 nexus를 새로 띄우는 전환 기능은 복제 수 2 이상과 `nvme_core.multipath=Y`를 요구합니다. 개발사 블로그에는 repl=1·repl=2의 IOPS만 있어서 repl=3(복제본 3개)의 지연을 로컬과 비교하지 못했습니다.

파드와 볼륨의 재연결에도 조건이 있습니다. ECK는 원격 볼륨이라면 파드를 지운 뒤 몇 초 안에 다른 호스트에 다시 연결되고 사람 개입도 필요 없다고 설명합니다. Kubernetes는 kubelet이 감지하지 못한 노드 종료에서 StatefulSet 파드와 VolumeAttachment가 남아 재연결을 막을 수 있다고 명시합니다. 이 동작은 Kubernetes 문서를 1차 근거로 판단했습니다. 노드에 상태를 두지 않더라도 장애 복구가 늘 자동으로 끝난다고 단정할 수는 없습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 로컬 PV의 파드 이동 제약 | 노드에 묶이며 노드가 죽으면 파드가 Pending에 머묾 | Kubernetes 1.14 local PV GA 공지 | `✓` |
| 복제 스토리지의 볼륨 이동과 예외 | 볼륨을 다른 노드에 연결할 수 있지만 감지되지 않은 노드 종료에서는 이동이 막힐 수 있음 | Kubernetes 문서(Node Shutdowns) | `✓` |
| 로컬 PV의 노드 장애 복구 절차 | PVC와 파드를 지워야 다시 스케줄됨. 사람이나 오퍼레이터가 수행 | Kubernetes 1.14 local PV GA 공지 | `✓` |
| 원격 볼륨의 노드 장애 복구에 관한 설명 | 파드를 지우면 다른 노드에 다시 붙음 | ECK 문서 | `Ⓥ` |
| 복제 스토리지의 쓰기 완료 조건 | 모든 사본의 응답을 기다리는 동기 미러 | — | `✓` |
| Mayastor io-engine의 노드별 자원 요구 | 코어 2개, hugepage 2GiB, RAM 1GiB | OpenEBS 4.6.x 문서(Prerequisites) | `✓` |
| 사본 중첩에 따른 물리 사본 수 | 로컬은 앱 사본 수로 a=3이면 3. 복제 스토리지는 앱 사본 × 스토리지 사본으로 3×3=9 | — | `Σ` |
| 복제 없는 앱이 로컬 PV를 쓸 때의 유실 가능성 | 노드나 디스크를 잃으면 데이터도 잃을 수 있음 | — | `✓` |
| 복제 없는 앱에 복제 스토리지를 제공하는 효과 | 데이터를 지킬 수 있다는 종합 판단 | — | `Σ` |
| 로컬 PV의 프로비저닝 제약 | 정적 PV만 가능하며 동적 프로비저닝 없음 | — | `✓` |
| zone에 묶인 볼륨의 배치 제약 | AZ를 넘지 못함 | — | `Σ` |
| 물리 사본과 장치 쓰기의 산술 | 애플리케이션 사본 a개, 스토리지 사본 s개이면 물리 사본 a×s개. 논리 쓰기 한 번당 장치 쓰기 a×s번. a=3, s=3이면 9 | — | `Σ` |
| 스토리지 복제를 겹칠 때의 쓰기 증폭과 사본 배치 권고 | Longhorn·Ceph식 복제 중첩에 "write amplification"이 생김. 스토리지 사본을 1로 낮추되 한 호스트가 같은 클러스터의 여러 인스턴스 블록을 갖지 않도록 권고 | CloudNativePG 문서 | `✓` |
| 스토리지 복제를 권하지 않는다는 명시적 문장 | CloudNativePG의 스토리지 권고 | CloudNativePG 문서 | `✓` |
| Kafka에 복제 스토리지가 필요 없다는 설명 | Kafka 스토리지 권고 | Strimzi 문서 | `✓` |
| 로컬 디스크에서 복제 계수 상향을 고려하도록 권고 | 디스크 장애 가능성이 크므로 기본 3에서 5로 상향 고려 | CockroachDB 문서 | `✓` |
| 로컬과 원격 복제 볼륨의 물리 사본 비교 | 로컬 + 사본 5는 물리 사본 5. 원격 3중 복제 볼륨 + 앱 사본 3은 물리 사본 9. 5 대 9로 로컬이 적지만 “로컬이면 3으로 끝”은 아님 | — | `Σ` |
| Mayastor io-engine의 CPU 사용 방식 | 배정된 코어를 쉬지 않고 돌아 100% 사용. `isolcpus`로 간섭을 줄이도록 안내 | OpenEBS 4.6.x 문서(Performance Tips) | `✓` |
| Mayastor의 노드 수와 전송 제약 | 최소 노드 수 3. NVMe-oF TCP로만 볼륨을 내보냄 | OpenEBS 4.6.x 문서(Prerequisites) | `✓` |
| Mayastor 타깃 장애 전환 조건 | 볼륨 입구 역할의 nexus를 새로 띄움. 복제 수 2 이상, `nvme_core.multipath=Y` 필수 | OpenEBS 4.6.x 문서(High Availability) | `✓` |
| 개발사 측정에 포함된 항목 | repl=1·repl=2의 IOPS만 있으며 지연 수치는 없음 | 개발사 블로그 | `Ⓥ` |
| Mayastor repl=3 지연 비교는 미확인 | 로컬과 견줄 지연 수치 없음 | — | `?` |
| 원격 볼륨의 빠른 재연결과 무인 복구에 관한 설명 | 호스트가 죽어도 파드를 지우면 몇 초 안에 다른 호스트에 다시 연결되며 사람 개입이 필요 없다고 설명 | ECK 문서 | `Ⓥ` |
| 감지되지 않은 노드 종료의 볼륨 재연결 문제 | kubelet이 감지하지 못하면 StatefulSet 파드가 Terminating에 걸리고 VolumeAttachment도 지워지지 않아 새 노드에 볼륨을 붙일 수 없음 | Kubernetes 문서 | `✓` |
| 상충하는 설명의 출처를 판단한 기준 | Kubernetes 문서를 1차 문서로 봄 | ECK 문서·Kubernetes 문서 | `Σ` |

{{% /details %}}

## 8. 표준안을 나눈다면

앞선 문서와 계산을 바탕으로 워크로드별 구성을 골랐습니다. 표의 권고는 이 글의 종합 판단입니다.

| 워크로드 | 권하는 구성 | 근거 |
|---|---|---|
| 상태 없는 서비스 | 로컬 디스크, 3곳 이상 AZ에 분산 | 3절·4절·5절 |
| 자체 복제 DB·로그, AZ 3곳 | 로컬 디스크 + 애플리케이션 복제, AZ마다 한 대. 스토리지 복제는 겹치지 않음 | 4절·6절·7절 |
| 자체 복제 DB, 사이트 2곳 | 로컬 디스크 + primary–standby, 전환은 사람이 판단하거나 셋째 위치에 witness | 5절 |
| 단일 인스턴스·레거시 DB | 원격(복제) 볼륨. 로컬 디스크를 쓴다면 백업을 전제로 | 3절·4절·6절 |
| 작업환경 VM | 원격 볼륨 + 스냅샷. 점검은 volume-backed live migration으로 | 3절·4절 |

복제 없는 VM에 로컬 디스크를 일괄 적용하면 호스트 장애가 데이터 소실로 이어질 수 있습니다. 자체 복제 DB에 원격 복제 스토리지를 일괄 적용하면 사본과 고정 코어 비용이 늘어납니다. 표준 구성에는 디스크 종류와 함께 복제 담당, 사이트별 배치, 장애 전환·재복제 절차를 포함해야 합니다. 어느 구성에서도 논리 오류를 복구할 백업은 별도로 갖춰야 합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

표의 권고는 모두 종합 추론(`Σ`)입니다. 상태 없는 서비스는 3·4·5절, AZ 3곳의 자체 복제 DB·로그는 4·6·7절, 두 사이트의 자체 복제 DB는 5절을 근거로 골랐습니다. 단일 인스턴스·레거시 DB는 3·4·6절, 작업환경 VM은 3·4절의 데이터 수명과 복구 경로를 적용했습니다.

{{% /details %}}

## 확인하지 못한 것

- Mayastor repl=3의 측정 조건을 밝힌 자료를 확인하지 못했다. replica 수와 지연의 관계, rebuild 속도·throttle 문서도 읽지 못했다.
- Ceph RBD와 로컬 NVMe를 같은 장비·같은 조건에서 잰 공식 자료를 찾지 못했다. Reef 글에는 로컬 QD1 기준선이 없다.
- 로컬 디스크 + 동기 애플리케이션 복제와 원격 복제 볼륨 + 단일 인스턴스를 같은 장비에서 비교한 자료를 찾지 못했다.
- Nova 문서에는 "공유 스토리지 없이 evacuate하면 데이터가 사라진다"는 문장이 그대로 있지 않다. 이 글은 문장 둘을 이어 결론을 냈다. 공유 스토리지 없는 노드가 완전히 고장 났을 때의 공식 복구 절차도 찾지 못했다.
- Operations Guide는 2013.2.1.dev판이다. 명령이 현행 클라이언트와 맞는지 대조하지 않았다. PCI passthrough한 NVMe의 live migration 가능 여부도 Nova 문서로 확정하지 못했다.
- DB 종류별 재복제 속도를 측정 조건과 함께 밝힌 수치는 확인하지 않았다. 6절의 시간은 식과 단위 환산으로 계산한 값이다.
- Elastic 문서에서 스토리지 복제 중첩을 경고하는 문장과 ScyllaDB Operator·Vitess 문서의 로컬 스토리지 권고를 확인하지 못했다.
- MySQL 문서는 Wayback 사본(2026-03 ~ 2026-09)으로 읽었으며 현행 페이지와 대조하지 않았다. Kafka 문서는 4.1 경로를 읽었다.
- PostgreSQL·MySQL 문서에는 "복제는 백업이 아니다"라는 문장이 그대로 있지 않다. ClickHouse 문서와 지연 복제 설명을 근거로 삼았다.

## 참고 자료

- [Nova 문서](https://docs.openstack.org/nova/latest/) — KVM backing storage, Configure live migrations, Evacuate instances, Availability Zones, PCI passthrough (nova 34.1.0.dev22)
- [OpenStack Operations Guide, Compute Node Failures and Maintenance](https://docs.openstack.org/operations-guide/ops-maintenance-compute.html) — 계획 점검 절차
- [Amazon EC2 User Guide, Data persistence for instance store volumes](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-store-lifetime.html) — instance store의 수명
- [Compute Engine, About Local SSD disks](https://docs.cloud.google.com/compute/docs/disks/local-ssd) — Local SSD의 보존 조건
- [Azure managed disks 소개](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview) · [temp NVMe FAQ](https://learn.microsoft.com/en-us/azure/virtual-machines/enable-nvme-temp-faqs) — 임시 디스크의 수명
- [Site Reliability Engineering, Appendix B](https://sre.google/sre-book/service-best-practices/) — N+2
- [Amazon Builders' Library, Static stability using Availability Zones](https://aws.amazon.com/builders-library/static-stability-using-availability-zones/) — 3개 AZ의 50% 초과 프로비저닝
- [etcd v3.6 문서](https://etcd.io/docs/v3.6/) — FAQ, Hardware recommendations, Performance
- [MySQL 8.4 Reference Manual](https://dev.mysql.com/doc/refman/8.4/en/) — semisync, Delayed Replication (Wayback 사본)
- [PostgreSQL 18 문서](https://www.postgresql.org/docs/current/warm-standby.html) — 동기·비동기 복제, synchronous_commit
- [Apache Kafka 4.1 문서](https://kafka.apache.org/41/) — acks, min.insync.replicas, ISR
- [ClickHouse, Backup and restore](https://clickhouse.com/docs/operations/backup/overview) — 복제와 백업의 차이
- [Kubernetes 문서, Volumes(local)](https://kubernetes.io/docs/concepts/storage/volumes/) · [Node Shutdowns](https://kubernetes.io/docs/concepts/cluster-administration/node-shutdown/) · [Running in multiple zones](https://kubernetes.io/docs/setup/best-practices/multiple-zones/)
- [Kubernetes 1.14: Local Persistent Volumes GA](https://kubernetes.io/blog/2019/04/04/kubernetes-1.14-local-persistent-volumes-ga/) — 로컬 PV의 적합 워크로드
- [OpenEBS 4.6.x 문서](https://openebs.io/docs/) — Mayastor I/O Path, Storage Class Parameters, Prerequisites, Performance Tips, High Availability
- [Ceph 문서, Architecture](https://docs.ceph.com/en/tentacle/architecture/) · [Stretch Clusters](https://docs.ceph.com/en/latest/rados/operations/stretch-mode/)
- [Ceph Reef Freeze Part 1: RBD Performance](https://ceph.io/en/news/blog/2023/reef-freeze-rbd-performance/) — Mark Nelson, 2023-03-27
- [CloudNativePG 1.28 문서](https://cloudnative-pg.io/docs/1.28/) — Storage, Architecture
- [Strimzi 문서](https://strimzi.io/docs/operators/latest/deploying) — Storage considerations
- [CockroachDB Performance on Kubernetes](https://www.cockroachlabs.com/docs/stable/kubernetes-performance) — 로컬 디스크의 복제 계수
- [TiDB on Kubernetes, Persistent Storage Class Configuration](https://docs.pingcap.com/tidb-in-kubernetes/stable/configure-storage-class/)
- [Elastic Cloud on Kubernetes, Storage recommendations](https://www.elastic.co/guide/en/cloud-on-k8s/current/k8s-storage-recommendations.html)
- 전송·가상화·복제 스토리지 실측의 출처는 [01]({{< relref "/data/block-storage/01-iscsi-nvme-of/index.md" >}})과 [02]({{< relref "/data/block-storage/02-vm-disk-paths/index.md" >}})의 참고 자료에 있다. Longhorn v1.12.0 벤치마크는 [Performance Benchmark 위키](https://github.com/longhorn/longhorn/wiki/Performance-Benchmark)에서 읽었다.
