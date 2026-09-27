---
title: "운영 런북 — 장애·변경이 났을 때 무엇을 어떤 순서로"
description: "UI 장애·적재 중단·INSERT 거부 등 증상별로 판별 신호와 절차, 확인 방법을 표로 라우팅합니다. 노드 급사는 재부팅 여부를 먼저 확인하지 않고 taint를 걸면 RWO 볼륨이 이중 마운트로 깨집니다."
date: 2026-08-13
lastmod: 2026-08-24
weight: 2
aliases: ["/hyperdx-operating/04-operator-pattern/", "/hyperdx/operating/04-operator-pattern/"]
---

# HyperDX 운영 런북

장애가 나면 조회와 적재 중 어느 쪽이 멈췄는지 확인합니다. 우리 구성은 RUM 컨버터와 OTel Collector가 별도로 ClickHouse에 쓰므로, 수집 장애도 두 경로를 나누어 확인해야 합니다.

이 런북은 HyperDX Only와 Altinity CHI·CHK 구성을 전제로 합니다. [배포 기록]({{< relref "01-our-deployment.md" >}})의 stage는 ClickHouse replica 1, Collector 인메모리 큐, gp3 단일 티어입니다. 아래 절차에서 다른 replica의 서빙이나 영속 큐에 기대는 부분은 해당 구성을 적용한 뒤에만 성립합니다.

## 1. 증상별 확인 순서 {#1-증상별-진입--무엇을-보고-어디로-가나}

| 증상 | 확인할 것 | 다음 조치 |
|---|---|---|
| UI·대시보드가 열리지 않는다 | hdx 파드와 MongoDB 연결, ClickHouse 신규 적재 여부 | 적재가 계속되면 조회 계층을 복구한다. [컴포넌트별 장애 영향]({{< relref "../hyperdx/04-operator-topology-downtime.md" >}}) 참고 |
| 새 RUM 데이터가 없다 | 자체 컨버터의 수신·오류·ClickHouse 쓰기 상태 | Collector 경로와 구분해 컨버터를 조사한다 |
| 표준 로그·트레이스·메트릭이 들어오지 않는다 | Collector 상태·큐 적체·export 오류 | 큐 상태를 기록한 뒤 수집 경로를 복구한다. 인메모리 큐의 유실 구간도 확인한다 |
| INSERT/DDL이 거부된다 | `system.replicas.is_readonly`, Keeper 생존 수와 연결 오류 | §3에서 정족수 상태를 확인한다 |
| CH 파드가 Terminating에 머문다 | 노드 전원 상태와 재부팅 여부 | 노드가 완전히 정지한 것을 확인한 뒤 §2의 복구 절차를 진행한다 |
| hot 디스크가 찬다 | `system.disks`, TTL 이동과 `system.part_log` | [의사결정 가이드]({{< relref "03-decision-guide.md" >}})에 따라 확장·보관 정책을 검토한다 |
| 업그레이드 후 기동에 실패한다 | 오류 로그, 변경 버전과 온디스크 포맷 | §4의 사전 백업과 [버전별 복원 조건]({{< relref "../hyperdx/09-version-upgrade-compat.md" >}})을 확인한다 |

## 2. 노드 소실과 EBS 재연결 {#2-노드가-죽었을-때--판별이-첫-단계다}

EBS 볼륨이 살아 있고 같은 AZ에 노드를 배치할 수 있다면, 기존 볼륨을 다시 연결해 복구합니다. 로컬 NVMe를 잃은 경우처럼 전체 데이터를 새로 채울 필요는 없지만 detach·attach와 part 로딩, 복제 지연 해소에는 시간이 걸립니다.

1. drain이나 consolidation 같은 계획된 교체인지 확인합니다. Eviction API를 쓰는 교체에서는 PDB가 중단 수를 제한합니다. 새 파드의 배치, EBS 연결, 복제 지연 해소까지 관찰합니다.
2. 갑자기 응답을 잃은 노드라면 전원이 완전히 꺼졌는지 확인합니다. 네트워크 단절이나 재부팅을 노드 소실로 오인한 상태에서 강제 detach하면 기존 노드의 쓰기와 충돌해 데이터가 손상될 수 있습니다.
3. 노드 정지를 확인한 뒤 `out-of-service` taint로 정리합니다. 부여·해제 명령과 강제 파드 삭제만으로 해결되지 않는 이유는 [노드 급사 복구 절차]({{< relref "../hyperdx/04-operator-topology-downtime.md" >}})에 있습니다.
4. 새 파드의 볼륨 연결과 복제 상태를 확인합니다. 기존 노드를 다시 쓸 수 있게 되면 taint도 해제합니다.

AZ 전체를 사용할 수 없으면 그 AZ의 EBS를 다른 AZ에 바로 붙일 수 없습니다. 다른 AZ의 replica가 있어야 서비스를 이어갈 수 있습니다. stage의 단일 replica에는 이 여유가 없습니다.

자동 taint 적용은 아직 검토 항목입니다. node-problem-detector 등의 신호가 실제 전원 정지를 충분히 구분하는지 리허설한 뒤 적용 여부를 정합니다.

## 3. Keeper 정족수 상실 {#3-keeper-정족수를-잃었을-때--읽기는-살아-있다}

Keeper 3대 중 2대를 잃으면 정족수를 충족하지 못합니다. 복제 테이블이 읽기 전용으로 바뀌면서 쓰기가 거부될 수 있지만, 기존 로컬 데이터를 읽는 SELECT는 계속될 수 있습니다. `system.replicas.is_readonly=1`과 `TABLE_IS_READ_ONLY` 오류가 나타나면 Keeper 연결 상태부터 확인합니다.

CHK 파드와 영속 볼륨을 조사하고, 볼륨이 남아 있으면 재연결해 정족수를 복구합니다. 연결이 회복된 뒤에는 read-only 해제와 실제 INSERT 성공, 복제 큐 감소를 확인합니다. 그동안 실패한 요청의 재전송과 중복 처리는 수집기·클라이언트의 설정에 달려 있습니다. 자세한 동작은 [복제와 failover]({{< relref "../hyperdx/06-replication-failover.md" >}})에 있습니다.

## 4. 계획된 변경 {#4-계획된-변경--롤링업그레이드스케일}

이미지, 설정, 볼륨 크기는 각각 별도의 reconcile에서 변경합니다. 실패했을 때 어떤 변경이 원인인지 추적하기 쉬워집니다. shard·replica 변경과 CRD 취급은 [Altinity operator 운영]({{< relref "../clickhouse/05-altinity-operations.md" >}}), 컴포넌트 버전 조합은 [버전 호환과 업그레이드]({{< relref "../hyperdx/09-version-upgrade-compat.md" >}})에서 확인합니다.

업그레이드 전에는 데이터 볼륨 스냅샷과 `clickhouse-backup` 백업을 만들고 복원 경로를 확인합니다. 새 버전이 쓴 part를 이전 바이너리가 읽지 못할 수 있으므로, 이미지 태그를 되돌리는 것만으로 복구할 계획을 세우면 안 됩니다.

RF2·RF3 구성은 replica를 하나씩 변경하고, 복제 지연이 해소된 뒤 다음으로 넘어갑니다. 실패한 replica를 스냅샷에서 복원해도 백업 이후 데이터는 다른 replica에서 받을 수 있어야 합니다. stage는 replica 1이므로 다른 replica의 서빙이나 데이터 보충을 기대할 수 없습니다.

변경 후 24~48시간을 관찰하는 동안 `OPTIMIZE ... FINAL`이나 새 컬럼 타입 도입처럼 복원을 더 어렵게 만드는 작업을 피합니다. 다만 백그라운드 merge도 part를 다시 쓸 수 있으므로 이것만으로 바이너리 롤백이 보장되지는 않습니다. 복원 명령과 버전별 조건은 [업그레이드 절차]({{< relref "../hyperdx/09-version-upgrade-compat.md" >}})를 따릅니다.

CHI의 `pdbMaxUnavailable: 1`, hostname anti-affinity, AZ topology spread는 중단 수와 배치 위치를 관리하는 설정입니다. 역할은 서로 다릅니다. 특히 [PDB는 노드 급사를 막지 못하며, StatefulSet 자체의 롤링 업데이트를 제한하는 장치도 아닙니다](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/). operator의 reconcile 순서와 복제 상태 확인을 함께 적용해야 합니다.

<span id="우리-케이스에서는"></span>

## 5. stage에서 복구 시험하기 {#5-stage-리허설--절차를-사람-손에-익히는-자리}

계획된 교체는 cordon·drain으로, 급사는 노드 강제 종료로 따로 시험합니다. 전자는 PDB와 자동 재연결이 어떻게 작동하는지, 후자는 파드·볼륨 정리가 어디서 멈추고 언제 `out-of-service` 개입이 필요한지 기록합니다.

EBS 재연결과 part 로딩의 실제 소요 시간은 아직 측정하지 않았습니다 `?`. [의사결정 가이드]({{< relref "03-decision-guide.md" >}})의 실측 항목에 결과를 남깁니다. 단일 replica stage에서 절차를 익힐 수는 있지만, prod의 장애 중 서비스 지속 여부는 RF2와 영속 큐를 갖춘 구성에서 다시 검증해야 합니다.
