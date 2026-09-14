---
title: "operator 토폴로지·다운타임 — EBS 재부착이 바꾸는 복구 모델"
date: 2026-08-01
lastmod: 2026-08-24
weight: 4
aliases: ["/hyperdx-operating/03-availability/", "/hyperdx/operating/03-availability/"]
---

# EBS 기반 ClickHouse의 장애와 복구

ClickHouse 노드가 내려갔을 때 EBS 볼륨에 데이터가 남아 있다면 새 노드에서 처음부터 채울 필요는 없습니다. 같은 AZ에 볼륨을 다시 붙이고 ClickHouse를 시작한 뒤, 중단 중 쌓인 파트만 따라잡으면 됩니다. 다만 볼륨이 살아 있다는 사실과 요청을 처리할 수 있다는 사실은 다릅니다. 재부착이 끝날 때까지는 남은 replica가 부하를 맡습니다.

이 글은 월 0.7TB RUM, gp3 기반 ClickHouse 1 shard·2 replica, Keeper 3노드를 가정합니다. ClickStack은 외부 ClickHouse에 연결하고 CHI/CHK는 Altinity operator로 관리합니다. [operator 선택]({{< relref "../../clickhouse/03-operator.md" >}}), [배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}}), [Altinity 운영 절차]({{< relref "../../clickhouse/05-altinity-operations.md" >}})에서 정한 구성에 EBS의 복구 조건을 적용한 내용입니다.

장애를 판단할 때는 어느 기능이 멈췄는지 확인한 뒤, 파드 재시작인지 노드 소실인지 AZ 장애인지 구분합니다. 같은 replica 장애라도 볼륨을 바로 재사용할 수 있는지에 따라 복구 시간이 달라집니다.

## 1. 멈춘 컴포넌트와 영향 범위 {#1-무엇이-죽으면-무엇이-멈추나--컴포넌트-축}

브라우저 → Collector → ClickHouse가 적재 경로이고, HyperDX API → ClickHouse·MongoDB가 조회와 설정 경로입니다. [스택 토폴로지]({{< relref "01-stack-topology.md" >}})의 이 연결을 따라가면 화면 오류와 수집 중단을 구별할 수 있습니다. 아래 표는 해당 컴포넌트 전체가 사용할 수 없을 때의 영향이며, replica 하나의 장애는 나머지 인스턴스와 요청 재시도 설정에 따라 흡수할 수 있습니다.

### 1.1 수집·조회·설정의 장애 영향 {#11-컴포넌트별-종합-매트릭스}

| 컴포넌트 | 사용할 수 없을 때의 영향 | 복제·데이터 보호 |
|---|---|---|
| HyperDX app/api | UI·조회·알럿 평가에 영향. Collector로 직접 보내는 적재는 계속 가능 | Service 뒤 replica 2개 이상, 설정은 MongoDB에 보관 |
| OTel Collector | 신규 이벤트 수신·전송 중단. 이미 영속 큐에 기록된 이벤트는 복구 후 재전송 가능 | Gateway 2개 이상, `file_storage`, 클라이언트 재시도 |
| ClickHouse | 전체 장애면 조회와 적재 중단. replica 하나만 장애면 나머지로 요청 가능 | 멀티 AZ RMT 복제, 필요에 따른 `insert_quorum`, 백업 |
| Keeper | 정족수 상실 시 복제 테이블의 쓰기·조정 작업 중단. 기존 로컬 데이터 조회는 가능 | 3 AZ에 3노드, Raft 메타데이터를 gp3에 보관 |
| MongoDB | 설정·대시보드·알럿·UI에 영향. Collector → ClickHouse 적재는 계속 가능 | ReplicaSet 3멤버와 `mongodump`, 또는 Atlas |

Collector의 디스크 큐는 이미 받아 기록한 데이터를 지킵니다. Collector 전체가 멈춘 동안 새 이벤트를 수신하는 장치는 아니므로 클라이언트 재시도 시간과 장애 지속 시간이 중요합니다. ClickHouse 복제 역시 백업을 대신하지 않습니다. 잘못된 삭제는 복제본에도 반영될 수 있습니다.

상세 문서

| 컴포넌트 | 상세 |
|---|---|
| HyperDX app/api | [스택 토폴로지]({{< relref "01-stack-topology.md" >}}) §2 역할·포트·의존 · §4 K8s 배치 |
| OTel Collector | [스택 토폴로지]({{< relref "01-stack-topology.md" >}}) §5 배치·사이징 · [Keeper]({{< relref "05-keeper.md" >}})(유실 지점) |
| ClickHouse | 이 장 §2~§5 · [복제·멀티마스터·failover]({{< relref "06-replication-failover.md" >}}) |
| ClickHouse Keeper | [Keeper]({{< relref "05-keeper.md" >}}) · [복제·멀티마스터·failover]({{< relref "06-replication-failover.md" >}}) |
| MongoDB | [스택 토폴로지]({{< relref "01-stack-topology.md" >}}) §6 최소 규모 배포 · [MongoDB 최소 배포]({{< relref "../../rum/07-hyperdx-mongodb.md" >}}) |

### 1.2 수집 중단을 놓치지 않기 {#12-blast-radius--어디까지-번지나}

ClickHouse 전체 장애는 조회와 적재에 동시에 영향을 줍니다. Keeper 정족수를 잃으면 데이터 노드가 살아 있어도 쓰기가 막힐 수 있습니다. 반면 HyperDX API나 MongoDB가 내려가도 Collector의 ClickHouse 적재 경로가 정상이라면 새 데이터는 계속 저장됩니다.

Collector 장애는 화면보다 수집 지표에서 먼저 드러날 수 있습니다. 오래된 데이터가 정상 조회된다는 이유로 우선순위를 낮추면 새 이벤트가 유실되는 시간을 놓칠 수 있습니다. 수신량·전송 실패·큐 잔량을 함께 확인해야 합니다.

각 장애가 얼마나 이어지는지는 §5에서 살펴봅니다. Keeper 정족수 상실의 판별 지표와 read-only 동작은 [복제·failover]({{< relref "06-replication-failover.md" >}})에 있습니다.

## 2. 노드 교체 후 기존 데이터 재사용 {#2-전제-뒤집기--ebs면-노드데이터-결합이-끊긴다}

[로컬 NVMe 구성]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})에서는 인스턴스가 소실되면 새 노드에 데이터 전체를 복사해야 합니다. 시간은 데이터량과 복제 대역폭에 좌우되며 그동안 남은 replica에 의존합니다. 단순 재부팅과 인스턴스 소실은 구분해야 합니다.

EBS는 인스턴스와 독립된 볼륨을 사용합니다. 볼륨이 보존된 노드 교체라면 기존 데이터를 재사용하고 누락분만 복제할 수 있습니다. 이 차이가 복구 과정에서 전송할 데이터량을 줄입니다.

{{< flow src="_flow/전제-뒤집기-ebs-면.json" />}}

재부착 후 RMT는 로컬 파트를 확인하고 Keeper의 복제 로그를 따라 필요한 파트를 가져옵니다. 사본이 디스크에 남아 있어도 replica가 준비되기 전까지 서비스 가능한 사본 수는 줄어 있습니다. 실제 시간은 attach 대기, 파트 로드, 밀린 데이터량에 달려 있으며 아직 측정하지 않았습니다.

| 축 | 로컬 NVMe | EBS gp3/io2 |
|---|---|---|
| 노드 유실 시 데이터 | 소실 | 생존(볼륨에 잔존) |
| 복구 동작 | 다른 replica에서 전량 재fetch | 볼륨 reattach + 델타 catch-up |
| 복구 시간 지배 요인 | 노드당 데이터량 / 복제 대역 (수 시간) | detach/attach latency + CH startup (수 분) |
| 복구 중 redundancy | RF2 → 실질 RF1 (창 = 수 시간) | 기존 사본 보존, 서비스 가능한 replica는 감소 |
| 2차 장애 노출 | 재수화 창 내내 (길다) | reattach 창만 (짧다) |
| AZ 이동 | 데이터 없으니 어느 AZ든 새로 채움 | 같은 AZ만 reattach 가능(볼륨이 AZ-bound) |

EBS가 전량 복사를 줄여줄 수 있어 이 규모에서는 RF2로 시작하는 구성을 검토합니다. 다만 “재부착은 수 분”을 보장값으로 사용할 수는 없습니다. 같은 AZ에 노드를 확보할 수 있어야 하고, 비정상 종료 노드의 볼륨을 안전하게 떼는 과정도 필요합니다.

## 3. 같은 AZ에 노드가 필요한 이유 {#3-ebs는-az에-묶인다--reattach의-숨은-전제}

EBS 볼륨은 생성된 AZ에 물리적으로 고정됩니다(zonal resource). Kubernetes에서 이 볼륨을 감싼 PV는 `nodeAffinity`로 `topology.ebs.csi.aws.com/zone: <az>` 라벨을 달고 이 제약은 영구적입니다.

StorageClass의 `WaitForFirstConsumer`는 파드가 배치될 AZ에 볼륨을 생성하도록 바인딩을 늦춥니다. `Immediate`로 만든 볼륨과 파드 배치가 다른 AZ를 가리키면 `volume node affinity conflict`가 발생할 수 있습니다. [gp3 StorageClass 예제]({{< relref "02-hot-storage-ebs.md" >}})에 이 설정이 포함돼 있습니다.

기존 PVC를 사용하는 파드는 해당 볼륨과 같은 AZ에만 배치할 수 있습니다. 그 AZ에 노드가 부족하면 파드는 Pending에 남습니다. AZ 전체 장애에서는 볼륨을 다른 AZ에 재부착할 수 없으므로 다른 AZ의 replica로 서비스해야 합니다.

io2의 99.999% 내구성도 이 제약을 없애지 않습니다. 볼륨이 데이터를 보존해도 노드나 AZ에 접근할 수 없으면 요청을 처리하지 못합니다. gp3 자체 장애 가능성(AFR 최대 0.2%)과 함께 복제와 백업이 필요한 이유입니다.

### 3.1 multi-attach를 사용하지 않는 이유 {#31-ebs-multi-attach로-replica를-대체할-수-없다}

EBS multi-attach는 io1/io2 볼륨 하나를 같은 AZ의 여러 Nitro 인스턴스에 연결하는 기능입니다. 최대 16 인스턴스를 지원하지만 ClickHouse replica를 대신하는 용도로 사용하지 않습니다.

표준 XFS/ext4는 여러 노드가 같은 파일시스템을 동시에 쓰는 구성을 전제로 하지 않습니다. cluster-aware 파일시스템이나 별도 동시 접근 제어 없이 공유 마운트하면 손상 위험이 있습니다. ClickHouse는 각 replica가 독립 볼륨을 사용하는 RMT 복제로 구성합니다. 부팅 볼륨에는 multi-attach를 사용할 수 없고 부착 중 속성 변경에도 제약이 있습니다.

## 4. 단일 shard와 멀티 AZ 복제 {#4-ebs-기반-replication--sharding--우리-스케일의-토폴로지}

### 4.1 1 shard·RF2로 시작하는 구성 {#41-왜-1-shard--rf2-또는-rf3인가}

RUM 입력량은 월 0.7TB, 운영 세션 샘플링은 100%로 가정합니다. [용량 산정]({{< relref "07-capacity-planning.md" >}})상 단일 shard로 시작할 수 있는 크기이며, gp3와 io2의 최대 용량은 각각 64TiB입니다. 다만 볼륨 최대 크기가 쿼리 성능까지 보장하지는 않으므로 동시 부하는 별도로 확인합니다.

shard를 늘리면 데이터를 나눠 저장하고 처리할 수 있지만 이후 [수동 리샤딩]({{< relref "../../clickhouse/05-altinity-operations.md" >}})을 고려해야 합니다. 현재는 `shardsCount: 1`, `replicasCount: 2`로 두고 replica를 2 AZ에 분산합니다. Keeper는 3 AZ에 3노드로 배치합니다.

![멀티 AZ에 걸친 ClickHouse RF2 복제와 Keeper 3노드 쿼럼 배치, 그리고 AZ 한 개가 다운됐을 때의 동작을 정상·장애 두 패널로 정리한 그림](/images/hyperdx/availability-keeper-rf.svg)
*멀티 AZ에 걸친 ClickHouse RF2 복제(ReplicatedMergeTree)와 Keeper 3노드 쿼럼의 배치, 그리고 AZ 하나가 다운돼도 남은 replica가 승격 없이 read+write를 잇고 Keeper 2/3 과반으로 쓰기가 지속되는 동작을 정상·장애 두 패널로 정리했습니다.*

### 4.2 재부착 후 파트 동기화 {#42-replication-메커니즘-ebs-관점-재해석}

operator는 `layout`에서 `remote_servers`와 호스트별 `{shard}`·`{replica}`·`{cluster}` 매크로를 생성합니다. 테이블은 self-hosted 복제 엔진인 `ReplicatedMergeTree` 계열을 사용합니다. Cloud의 `SharedMergeTree`를 전제로 한 구성과는 다릅니다.

기본 비동기 복제에서는 다른 replica가 모두 파트를 받기 전에 INSERT 성공을 반환할 수 있습니다. 이후 replica들이 복제 로그를 따라 파트를 가져옵니다. EBS 재부착 후에도 같은 방식으로 누락분을 채웁니다.

단일 shard에서는 분산용 sharding key가 필요하지 않습니다. 다만 operator의 replica 개수 선언만으로 일반 MergeTree 테이블이 복제 엔진으로 바뀌는 것은 아니므로 실제 테이블 DDL을 확인해야 합니다. Distributed 테이블과 여러 shard의 데이터 배치는 [Altinity 운영]({{< relref "../../clickhouse/05-altinity-operations.md" >}})에서 다룹니다.

### 4.3 RF3가 필요한 가용성 요구 {#43-rf2-vs-rf3--ebs에서-판단이-어떻게-달라지나}

RF를 정할 때는 서비스 가능한 사본과 디스크에 남은 사본을 구별합니다. EBS 재부착 중 기존 데이터가 남아 있어도 요청을 받을 replica는 하나 줄어듭니다. [배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})의 RF·`insert_quorum` 판단에 이 복구 조건을 함께 적용합니다.

| | RF2 (2 AZ) — EBS 기본 | RF3 (3 AZ) — 승급 |
|---|---|---|
| shard당 사본 | 2 | 3 |
| 노드 급사 1대 | 데이터 생존(reattach), 그 replica 수 분 offline | 동일, 여유 큼 |
| AZ 1개 소실 | 다른 AZ 1 replica가 서빙(실질 RF1, 데이터 온전) | 다른 2 AZ에 2 replica 잔존, 남은 처리 용량 확인 필요 |
| 볼륨 자체 장애(AFR ≤0.2%) | 다른 replica가 방어 | 2 replica 방어 |
| 비용 배수(산정은 06) | ×2 (EBS $/GB + cross-AZ 복제 트래픽) | ×3 |

AZ 하나가 중단된 동안에도 두 사본을 서비스에 사용해야 한다면 RF3를 택합니다. `insert_quorum: 2`를 계속 사용할 때도 차이가 납니다. RF2에서 한 replica가 재부착 중이면 두 사본의 확인을 받을 수 없어 쓰기가 막히지만, RF3에서는 나머지 둘로 조건을 충족할 수 있습니다.

이 RUM 구성은 RF2를 시작값으로 둡니다. 이후 복구 시간 실측과 가용성 요구, 추가 사본 비용을 보고 RF3를 결정합니다. RF3라고 부하 저하나 모든 유실 가능성이 사라지는 것은 아닙니다.

### 4.4 CHI/CHK 배치 초안 {#44-ebs-기반-chichk-yaml-초안}

아래 CHI/CHK는 배치 초안입니다. [배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})과 함께 볼륨 보존, AZ 분산, 실제 라벨을 확인한 뒤 적용합니다.

{{% details title="EBS 기반 CHI(1 shard × RF2, gp3, 2 AZ) · CHK(3노드, gp3, 3 AZ) YAML 초안 전문" closed="true" %}}
데이터 노드는 r7g 메모리 최적화 노드풀을 가정합니다. 인스턴스의 EBS 대역폭이 gp3 설정을 제한할 수 있으므로 [hot 스토리지]({{< relref "02-hot-storage-ebs.md" >}})의 수치를 함께 봅니다. [로컬 NVMe]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})로 바꿀 때는 볼륨 배치와 복구 절차를 다시 설계해야 합니다.

CHI — 1 shard × RF2, gp3, 2 AZ

```yaml
apiVersion: "clickhouse.altinity.com/v1"
kind: "ClickHouseInstallation"
metadata:
  name: hyperdx-ch
  namespace: clickhouse
spec:
  defaults:
    storageManagement:
      provisioner: StatefulSet     # EBS도 기본 StatefulSet. 온라인 확장이 필요하면 Operator provisioner(§노브 주의)
      reclaimPolicy: Retain        # CHI/STS 삭제·helm uninstall에도 EBS PVC 잔존(실수 삭제 방어)
    templates:
      podTemplate: ch-ebs
      dataVolumeClaimTemplate: data-gp3     # → /var/lib/clickhouse
      logVolumeClaimTemplate:  log-gp3      # → /var/log/clickhouse-server
      serviceTemplate: ch-svc
  configuration:
    zookeeper:
      keeper: { name: hyperdx-keeper }      # 아래 CHK를 이름으로 참조(0.27.0+). 고전 nodes 방식은 clickhouse/04
      session_timeout_ms: 30000
    clusters:
      - name: main
        pdbManaged: "yes"          # PDB 자동 생성(§9)
        pdbMaxUnavailable: 1       # 한 번에 replica 1개만 down → 자발적 중단 직렬화
        layout:
          shardsCount: 1           # 우리 스케일: 단일 shard로 충분(리샤딩 부채 회피)
          replicasCount: 2         # RF2. AZ 무저하 요구 시 3
    settings:
      max_concurrent_queries: 200
      logger/level: information
    users:
      app/k8s_secret_password: default/ch-secret/password_sha256   # 시크릿 참조(평문 금지)
      app/networks/ip: ["10.0.0.0/8"]
      app/profile: default
  templates:
    podTemplates:
      - name: ch-ebs
        podDistribution:
          - { type: ClickHouseAntiAffinity, topologyKey: "kubernetes.io/hostname" }   # replica를 서로 다른 노드에(1 shard라 ShardAntiAffinity와 동치)
        spec:
          # AZ 분산은 topologySpreadConstraints로 강제(EBS AZ-bound 방어의 핵심)
          topologySpreadConstraints:
            - maxSkew: 1
              topologyKey: "topology.kubernetes.io/zone"
              whenUnsatisfiable: DoNotSchedule
              labelSelector:
                matchLabels:
                  clickhouse.altinity.com/cluster: main   # [미확인] 정확한 라벨 키는 배포 후 kubectl get pod --show-labels로 확인
          nodeSelector: { workload: clickhouse }          # r7g 전용 노드풀
          tolerations:
            - { key: dedicated, operator: Equal, value: clickhouse, effect: NoSchedule }
          containers:
            - name: clickhouse
              image: clickhouse/clickhouse-server:24.8   # ClickStack 병용 요구: 24.8 LTS+. 차트 기본태그는 관찰값일 뿐
              resources:
                requests: { cpu: "4", memory: "32Gi" }
                limits:   { cpu: "4", memory: "32Gi" }
    volumeClaimTemplates:
      - name: data-gp3
        reclaimPolicy: Retain
        spec:
          accessModes: ["ReadWriteOnce"]           # EBS는 RWO(multi-attach 불가, §3.1)
          storageClassName: gp3                     # WaitForFirstConsumer gp3 SC(자매 02로 위임)
          resources: { requests: { storage: 1000Gi } }   # prod hot 티어 노드당 order ~1TB. staging은 훨씬 작게(10~100Gi). 실값은 06
      - name: log-gp3
        spec:
          accessModes: ["ReadWriteOnce"]
          storageClassName: gp3
          resources: { requests: { storage: 50Gi } }
    serviceTemplates:
      - name: ch-svc
        spec:
          type: ClusterIP
          ports:
            - { name: http, port: 8123 }
            - { name: tcp,  port: 9000 }
```

`podDistribution`에는 `ClickHouseAntiAffinity`·`ShardAntiAffinity`·`ReplicaAntiAffinity`·`MaxNumberPerNode`·`CircularReplication` 등이 있습니다. 예제는 hostname에서 파드를 분리하고 zone의 `topologySpreadConstraints`로 AZ 배치를 제어합니다. 여러 shard로 확장한다면 shard별 분산 제약을 다시 확인합니다.

CHK — 3노드, gp3, 3 AZ

```yaml
apiVersion: "clickhouse-keeper.altinity.com/v1"
kind: "ClickHouseKeeperInstallation"
metadata:
  name: hyperdx-keeper
  namespace: clickhouse
  annotations: { prometheus.io/port: "7000", prometheus.io/scrape: "true" }
spec:
  configuration:
    clusters:
      - name: keeper
        layout: { replicasCount: 3 }      # 홀수 3노드 정족수(1 장애 허용). Raft 산술은 05-keeper로 위임
    settings:
      keeper_server/tcp_port: "2181"
      listen_host: "0.0.0.0"
      keeper_server/four_letter_word_white_list: "*"   # ruok/imok 라이브니스(0.27.0+)
      prometheus/endpoint: "/metrics"
      prometheus/port: "7000"
      prometheus/metrics: "true"
  defaults:
    templates: { podTemplate: keeper-pod, dataVolumeClaimTemplate: keeper-data }
  templates:
    podTemplates:
      - name: keeper-pod
        spec:
          affinity:
            podAntiAffinity:
              requiredDuringSchedulingIgnoredDuringExecution:
                - labelSelector:
                    matchExpressions:
                      - { key: "app", operator: In, values: ["clickhouse-keeper"] }
                  topologyKey: "kubernetes.io/hostname"      # 3 Keeper를 서로 다른 노드(가능하면 3 AZ)
          containers:
            - name: clickhouse-keeper
              image: "clickhouse/clickhouse-keeper:24.8"     # CH와 버전 정렬(24.8 LTS+)
              resources:
                requests: { memory: "256M", cpu: "1" }
                limits:   { memory: "4Gi",  cpu: "2" }
    volumeClaimTemplates:
      - name: keeper-data
        spec:
          accessModes: ["ReadWriteOnce"]
          storageClassName: gp3      # Keeper는 gp3(영속) — 로컬 NVMe에 두면 노드 급사 시 Raft 메타 소실. 저지연 fdatasync가 관건, 20Gi급 충분(05-keeper로 위임)
          resources: { requests: { storage: 20Gi } }
```

Keeper의 Raft 로그와 snapshot도 gp3에 남겨 재부착 후 재사용합니다. 이 초안의 Keeper anti-affinity는 hostname 분산만 표현하므로, 목표인 3 AZ 분산을 보장하려면 실제 라벨에 맞는 zone 제약을 추가해야 합니다. 데이터 경로와 조정 경로 모두 볼륨 보존 여부를 확인해 복구합니다.

{{% /details %}}

## 5. 설정 변경부터 AZ 장애까지 {#5-다운타임-상세--이벤트-축-s1s9-ebs-관점}

아래는 1 shard·RF2·2 AZ와 Keeper 3노드·3 AZ, `insert_quorum` 미설정 상태를 가정한 시나리오입니다. 남은 replica로 요청을 보내는 Service와 클라이언트 재시도가 동작해야 서비스를 이어갈 수 있습니다. [복제·failover 설명]({{< relref "06-replication-failover.md" >}})의 조건도 함께 적용됩니다.

| 사건 | 복구 경로와 영향 |
|---|---|
| S1 설정 변경 reconcile | 재시작이 필요한 변경이면 host를 순서대로 교체합니다. 같은 노드에서 볼륨을 재사용할 수 있으며, 재시작 동안 남은 replica가 요청을 맡습니다. |
| S2 ClickHouse 이미지 롤링 | replica별 종료·시작·catch-up 시간이 누적됩니다. 혼합 버전 구간과 절차는 [Altinity 운영]({{< relref "../../clickhouse/05-altinity-operations.md" >}})을 따릅니다. |
| S3 operator 업그레이드 | controller 교체만으로는 보통 데이터 파드가 재시작하지 않습니다. 실제 reconcile 변경이 있는지 확인합니다. |
| S4 계획된 노드 교체 | cordon·drain 후 볼륨을 같은 AZ 새 노드에 붙입니다. 소요는 detach·attach·startup·catch-up의 합이며 수 분을 예상하되 실측이 필요합니다. |
| S5 노드 재부팅 | 기존 볼륨으로 다시 시작합니다. 중단 중 남은 replica가 요청을 처리하고 복귀 후 동기화합니다. 단순 reboot는 로컬 NVMe 데이터도 보존합니다. |
| S6 정상 pod 삭제·재스케줄 | kubelet의 볼륨 정리가 완료되면 같은 AZ에서 재부착합니다. 새 노드를 써야 하는지에 따라 지연이 달라집니다. |
| S7 노드 급사·OS hang | 옛 파드 종료를 확인하지 못해 Terminating과 볼륨 해제가 지연될 수 있습니다. 아래 복구 절차가 필요할 수 있습니다. |
| S8 AZ 장애 | 해당 AZ의 replica·EBS에 접근할 수 없습니다. 다른 AZ replica로 서비스하고 장애 AZ 복구 또는 새 replica 구축을 기다립니다. |
| S9 Keeper 정족수 상실 | 복제 테이블의 쓰기·조정 작업이 멈춥니다. 기존 로컬 파트 조회는 가능하며 Keeper 정족수 복구가 필요합니다. [Keeper 운영]({{< relref "05-keeper.md" >}})을 참고합니다. |

Karpenter의 계획된 교체는 PDB와 볼륨 정리 절차를 따르는 경로입니다. 기존 조사에서는 v1.0 이상이 VolumeAttachment 삭제를 기다린 뒤 노드를 종료하는 동작을 확인했습니다. 그렇더라도 불필요한 교체가 반복되면 매번 replica 가용 용량이 줄므로 교체 빈도도 관리합니다.

### 5.1 비정상 종료 노드의 볼륨 해제 {#51-s7-상세--ungraceful-node-death의-진짜-다운타임-ebs-최대-함정}

정상 drain에서는 kubelet이 파드와 볼륨을 정리할 수 있습니다. 하드웨어 장애나 OS hang에서는 그 확인이 불가능해 StatefulSet 파드가 Terminating에 남을 수 있습니다. EBS 데이터가 살아 있어도 이 정리 절차가 끝나지 않으면 새 노드에 바로 붙일 수 없습니다.

{{% details title="Terminating이 끝나지 않을 때의 확인과 복구" closed="true" %}}
Kubernetes는 응답 없는 노드에서 프로세스가 실제로 멈췄는지 확신할 수 없습니다. 그 상태에서 같은 볼륨을 다른 노드에 연결하면 두 프로세스가 동시에 쓸 위험이 있습니다. StatefulSet의 단일 인스턴스 보장과 RWO 볼륨 해제 절차 때문에 대체 파드 생성이나 attach가 지연될 수 있습니다.

{{< seq src="_seq/s7-상세-ungraceful-node.json" />}}

일반적인 흐름에서는 `node-monitor-grace-period` 약 40초 뒤 노드가 NotReady가 되고, 기본 `unreachable:NoExecute` toleration 300초 뒤 파드 삭제가 요청됩니다. Attach/Detach controller의 force-detach 대기에는 6분 값이 사용되지만, 이 숫자들을 합쳐 복구 상한으로 삼으면 안 됩니다. EKS 설정과 CSI 상태, 옛 파드 정리에 따라 더 오래 걸릴 수 있습니다.

새 노드에서 `Multi-Attach error for volume ... already exclusively attached to one node`가 보인다면 옛 attachment가 남아 있는지 확인합니다. 그동안 다른 replica가 서빙하더라도 서비스 가능한 사본 수는 줄어든 상태입니다.

복구(개입):

```bash
# 1. 노드가 정말 죽었음을 확인(재부팅 중이 아님) — 오판하면 더블 마운트 위험
# 2. out-of-service taint로 강제 정리(K8s 1.28 GA, NodeOutOfServiceVolumeDetach)
kubectl taint nodes <dead-node> node.kubernetes.io/out-of-service=nodeshutdown:NoExecute
#    → 파드 강제 삭제 + EBS 즉시 detach → 같은 AZ 새 노드에 reattach → CH startup → 델타 catch-up
# 3. 노드 복구 후 taint 제거
kubectl taint nodes <dead-node> node.kubernetes.io/out-of-service=nodeshutdown:NoExecute-
```

`kubectl delete pod --force`로 파드만 지워도 볼륨 해제 문제가 남을 수 있습니다. 위 `out-of-service` taint는 종료된 노드의 파드와 볼륨 정리를 촉진하는 경로이며, 노드가 실제로 꺼졌다는 확인 후 사용해야 합니다.

node-problem-detector나 Medik8s NHC 같은 도구로 자동화할 수 있는지는 별도로 검증합니다. 네트워크 단절을 노드 종료로 오판하면 동시 쓰기 위험이 생기므로 자동화 조건과 복귀 절차까지 staging에서 확인해야 합니다.

{{% /details %}}

## 6. 이벤트와 설정 데이터 복구 {#6-무엇을-지켰나--무손실은-두-트랙으로-갈린다}

수집 중인 이벤트와 HyperDX 설정은 서로 다른 저장소에 있으므로 복구 방법도 다릅니다. 어느 단계까지 저장됐는지를 따라 확인합니다.

{{< flow src="_flow/3-무손실은-두-트랙-텔레메트리.json" />}}

### 6.1 Collector 큐와 ClickHouse 복제 {#61-트랙-1--텔레메트리대량스트리밍}

브라우저에서 ClickHouse에 저장되기 전까지는 Collector 큐와 재시도에 의존하고, 저장된 이후에는 ClickHouse 복제와 백업에 의존합니다.

1. Collector의 `sending_queue`는 기본 메모리 큐입니다. `file_storage`와 영속 볼륨을 연결하면 기록된 큐를 재시작 후 이어 처리할 수 있습니다. `block_on_overflow`는 큐가 가득 찼을 때 대기하게 하지만, 전체 경로의 타임아웃과 클라이언트 재시도까지 무한히 늘려주지는 않습니다. 배포할 Collector 빌드의 지원 여부를 확인합니다.

   ```yaml
   exporters:
     clickhouse:
       sending_queue:
         enabled: true
         storage: file_storage/otc   # 메모리 → 디스크 WAL
         block_on_overflow: true     # 가득 차면 드롭 대신 블록
   ```

2. ClickHouse에서는 RF2/3 복제를 사용하고, 두 사본 이상에 기록됐다는 확인이 필요하면 `insert_quorum`을 검토합니다. 블록 중복 제거는 재시도 중복을 줄이지만 데이터·순서·dedup 설정에 의존하므로 전체 경로의 exactly-once를 보장한다고 표현하지 않습니다. 파트 백업은 clickhouse-backup이 담당합니다.

Keeper는 이벤트 본문을 보관하지 않습니다. 쓰기가 멈춘 동안 보낼 데이터를 대기시키는 곳은 Collector 큐입니다. [Keeper와 유실 지점]({{< relref "05-keeper.md" >}}), [복제·failover]({{< relref "06-replication-failover.md" >}})에서 각각의 확인 조건을 다룹니다.

### 6.2 MongoDB 복제와 덤프 {#62-트랙-2--메타데이터소량문서}

HyperDX API가 MongoDB에 저장한 사용자·대시보드·알럿 설정은 ReplicaSet과 백업으로 보호합니다. 3멤버를 분산하면 한 멤버 장애 시 선출 후 다른 멤버로 연결할 수 있습니다. 단일 멤버도 EBS가 보존됐다면 재시작 후 데이터를 복구할 수 있지만, 그동안 UI와 알럿에 영향을 줍니다.

MCK Community Operator에는 내장 백업이 없으므로 `mongodump` CronJob으로 S3에 보관하고 복원을 확인합니다. 소규모 메타데이터라 덤프 부담은 상대적으로 작지만 실제 시간과 크기는 데이터량에 따라 측정합니다. [MongoDB 배포 글]({{< relref "../../rum/07-hyperdx-mongodb.md" >}})에는 최소 자원과 Atlas 대안이 있습니다.

## 7. 무엇을 늘릴지 결정하기 {#7-스케일-축--처리량-vs-가용성-vs-용량}

| 늘리는 대상 | 주로 얻으려는 효과 | 이 구성에서의 판단 |
|---|---|---|
| HyperDX app/api·Collector replica | 동시 요청 처리와 인스턴스 장애 대응 | 2개 이상 배치 후 부하 측정 |
| ClickHouse replica | 사본과 가용 처리 용량 확보 | 2 AZ의 RF2로 시작, 요구에 따라 RF3 |
| ClickHouse shard | 데이터 분할과 쓰기·스캔 병렬화 | 월 0.7TB에서는 우선 단일 shard 검증 |
| Keeper 노드 | 정족수와 장애 허용 수 확보 | 3노드를 3 AZ에 배치 |
| MongoDB 멤버 | 메타데이터 가용성 | 3멤버 복제, 적재량에 비례한 확장은 불필요 |

새 replica를 추가할지 shard를 늘릴지는 병목과 장애 요구에 따라 결정합니다. 저장 용량만 부족하다면 [gp3 확장]({{< relref "02-hot-storage-ebs.md" >}}), [S3 이동]({{< relref "03-s3-cold-tiering.md" >}}), [블록 전용 튜닝]({{< relref "08-block-only-tuning.md" >}})도 먼저 비교할 수 있습니다.

## 8. 노드·AZ 분산과 PDB {#8-배치-강제--노드az-1개-소실이-shard-전멸이-되지-않게}

replica 두 개를 같은 노드나 AZ에 두면 하나의 장애로 둘 다 사용할 수 없게 됩니다. 특히 EBS는 다른 AZ에 재부착할 수 없으므로 데이터 파드의 zone 분산을 실제 배치 결과로 확인해야 합니다.

| 기제 | 필드 | 막는 것 | EBS 관점 |
|---|---|---|---|
| hostname 분산 | `podDistribution: ClickHouseAntiAffinity` | 같은 shard replica 노드 몰림 | 한 노드 죽어도 shard 생존 |
| AZ topology spread¹ | `topologySpreadConstraints` | shard replica AZ 몰림 | EBS 핵심 — reattach 불가, cross-AZ만 방어 |
| PDB | `pdbManaged: yes` + `pdbMaxUnavailable: 1` | eviction에 따른 동시 중단 | drain·consolidation의 eviction 제한 |

¹ 필드는 `whenUnsatisfiable: DoNotSchedule`로 설정합니다. 다중 shard면 `ShardAntiAffinity`(zone)도 병용합니다.

RF2를 2 AZ에 두면 한 AZ 장애 후 서비스 가능한 replica는 하나입니다. 그 상태에서도 필요한 부하를 감당하는지 확인하고, 사본을 두 개 유지해야 한다면 RF3를 사용합니다.

PDB는 eviction API를 통한 자발적 중단을 제한합니다. 노드 급사 같은 비자발적 장애를 막지 못하며, operator의 직접 파드 교체까지 PDB가 모두 직렬화한다고 가정하면 안 됩니다. operator의 reconcile 대기 설정도 함께 확인합니다.

## 9. 롤링 중 readiness와 복제 대기 {#9-pdbprobereconcile-노브가-롤링-다운타임에-미치는-영향}

롤링 중에는 새 replica가 어느 상태가 돼야 다음 replica로 넘어갈지를 정해야 합니다. 버전 호환과 rollback 계획은 [버전·업그레이드 글]({{< relref "09-version-upgrade-compat.md" >}})에서 다루고, 여기서는 준비 상태와 복제 지연을 기다리는 설정을 봅니다.

operator는 CHI → Cluster → Shard → Host 순으로 reconcile하며 새 StatefulSet generation을 기다립니다. 이때 readiness만 확인할지, 복제 지연도 기다릴지에 따라 롤링 시간과 가용 용량이 달라집니다.

![clickhouse-operator의 reconcile 내부 흐름 — ListenQueue부터 waitStatefulSetGeneration까지](/images/hyperdx/altinity-operator-reconciler.png)
*clickhouse-operator의 reconcile 이벤트 처리 흐름: ListenQueue가 CHI Add/Update/Delete 이벤트를 받아 WalkTillError로 CHI → Cluster → Shard → Host 단위를 순차 reconcile하고 host 단계 마지막의 waitStatefulSetGeneration에서 새 StatefulSet generation이 준비될 때까지 대기합니다("Waiting HERE most of the time"). 출처: [Altinity/clickhouse-operator](https://github.com/Altinity/clickhouse-operator) — © Altinity Ltd, Apache License 2.0*

`pdbManaged`는 cluster 단위 PDB 생성을 관리하고 `pdbMaxUnavailable: 1`은 허용할 eviction 수를 제한합니다. `0`으로 두면 해당 자발적 eviction을 막습니다. operator가 수행하는 롤링 순서는 reconcile 설정과 함께 확인합니다.

`reconcile.host.wait.probes`는 새 host의 probe를 기다리는 설정입니다. 조사한 기본값에서는 readiness를 기다리고 startup은 기다리지 않습니다. EBS 재부착 뒤 파트를 로드하고 `/ping`(HTTP 8123)에 응답할 때까지 시간이 걸릴 수 있습니다. `suspend: true`는 probe를 비활성화하므로 운영 중 값도 확인합니다.

`reconcile.host.wait.replicas`의 `.new`·`.all`·`.delay`는 복제 따라잡기를 기다리는 조건입니다. EBS에 기존 파트가 남아 있다면 전량 복사보다 짧아질 수 있지만 밀린 쓰기량에 따라 달라집니다. readiness와 catch-up 시간을 각각 기록해야 다음 단계로 넘길 조건을 정할 수 있습니다.

`reconcile.statefulSet.update`에는 `timeout`(0–3600s), `pollInterval`(1–600s), `onFailure`(`abort`·`rollback`·`ignore`)가 있습니다. 재부착이나 파트 로드가 timeout을 넘었을 때 무엇을 할지 미리 정합니다.

볼륨을 실제로 잃어 새로 만드는 경우에는 `reconcile.host.drop.replicas`의 `onDelete`·`onLostVolume`·`active`를 확인합니다. `onLostVolume: yes`와 `active: no` 예시는 잃은 replica 등록을 정리하면서 살아 있는 replica는 drop하지 않으려는 설정입니다. 자동 처리 전 실제 볼륨 상태를 확인해야 합니다.

다중 shard에서는 `reconcileShardsThreadsNumber`와 `reconcileShardsMaxConcurrencyPercent`가 동시 reconcile 수에도 영향을 줍니다. 조사한 값은 각각 1과 50%이며, 이 단일 shard 구성에서는 병렬 처리 이점이 없습니다. 확장 시 설정은 [Altinity 운영]({{< relref "../../clickhouse/05-altinity-operations.md" >}})을 참고합니다.

## 장애 리허설에서 확인할 것 {#우리-케이스에서는}

staging에서 계획된 drain과 비정상 노드 종료를 따로 재현합니다. drain에서는 detach부터 ClickHouse readiness까지 시간을 재고, 급사에서는 옛 파드와 attachment가 남는지 확인한 뒤 종료가 확인된 노드에 `out-of-service` taint를 적용합니다. 복귀 후 파트 동기화 시간도 기록합니다.

AZ 하나를 사용할 수 없는 상황에서는 남은 ClickHouse replica와 Keeper 2/3으로 읽기·쓰기가 이어지는지 확인합니다. `insert_quorum: 2`를 사용할 계획이라면 RF2 장애 중 쓰기가 막히는 경우도 함께 검증해야 합니다. 이 결과로 RF3 필요 여부와 reconcile timeout을 정합니다.

Karpenter의 데이터 노드 정책은 `do-not-disrupt`와 `consolidationPolicy: WhenEmpty`를 검토해 불필요한 재부착을 줄입니다. 경보는 Keeper 정족수와 ClickHouse replica 상태뿐 아니라 Collector 수신·전송 실패와 큐 잔량도 포함합니다. Collector 전체 장애는 신규 이벤트 유실로 이어질 수 있습니다.

실제 증상별 실행 순서는 [운영 런북]({{< relref "../../hyperdx-operating/_index.md" >}})으로 이어집니다. 복구 시간은 아직 측정 전이며 본문의 수 분 추정과 설정 관찰값은 2026-08 조사에 기반합니다.
