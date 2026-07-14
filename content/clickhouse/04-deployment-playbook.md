---
title: "operator 배포 플레이북 — 로컬 NVMe 실전 구성"
weight: 4
---

# operator 배포 플레이북 — 로컬 NVMe 실전 구성

앞의 두 페이지는 각각 "**어느** operator냐"([Altinity operator]({{< relref "03-operator.md" >}}))와 "**어떤** 스토리지 매체냐"([스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}}))를 결정했다. 이 페이지는 그 둘을 **하나의 실행 가능한 배포 절차**로 묶는 캡스톤이다 — "AWS EKS 위에서 Altinity clickhouse-operator로 i7i/i8g 로컬 NVMe를 데이터 디스크 삼아 ReplicatedMergeTree 클러스터를 CHK/CHI 매니페스트 필드 수준까지 배포·운영하는 법". 앞 페이지가 **확정한 전제**(Altinity operator, self-host RMT, 로컬 NVMe hot + S3 cold, Keeper는 gp3 영속, i7i/i8g.4xlarge 단일 디스크 단위, `instanceStorePolicy`는 ephemeral이라 PV가 아님)는 재론하지 않고 그 위에 **필드·순서·값**을 얹는다. 개별 필드 근거는 [출처]({{< relref "07-sources.md" >}})의 operator·CRD·local PV 분류로 인용한다. 시점 기준 2026-07, operator **0.27.1**, CRD `clickhouse.altinity.com/v1` / `clickhouse-keeper.altinity.com/v1`.

> **표기**: `[확인됨]` = CRD 원문·공식 예제 YAML·릴리즈노트로 직접 검증. `[추정]` = 확정 사실에 기반한 설계 판단. `[미확인]` = 배포 후 실측·재확인 필요. 검증 못 한 YAML 필드는 `# [미확인]` 주석을 단다.

## 배포 청사진 — 5계층과 순서

로컬 디스크가 ClickHouse 데이터 PV가 되기까지 **5계층**을 지난다 `[확인됨]`. operator는 이 중 [4]~[5]만 담당하고 [1]~[3]은 노드/인프라 책임이다 — 이 경계가 로컬 NVMe 배포의 핵심 오해 지점이다.

```
[1] 노드 부트스트랩(userData)   mkfs.xfs → /mnt/fast-disks/<uuid> 마운트     책임: Karpenter EC2NodeClass
        ▼                       (i7i/i8g.4xlarge = 단일 디스크 → RAID0 불필요)
[2] local PV provisioner        DaemonSet이 /mnt/fast-disks 감시 → Local PV 자동 생성   책임: local-static-provisioner
        ▼                       (PV에 nodeAffinity + storageClassName: fast-disks)
[3] StorageClass                fast-disks(no-provisioner, WaitForFirstConsumer) / gp3(ebs.csi)   책임: 클러스터 관리자
        ▼
[4] CHK + CHI 매니페스트         CHK(Keeper 3노드, gp3) → CHI(shard×replica, fast-disks)   책임: Altinity operator
        ▼                       volumeClaimTemplates[].storageClassName 로 [3] 참조
[5] Pod 스케줄 시점             파드가 간 노드의 로컬 PV에 PVC late-bind → /var/lib/clickhouse 마운트

배포 순서:  operator 설치(CRD 포함) → StorageClass 2종 → 스토리지 NodePool → CHK apply → CHK Ready 확인
           → CHI apply(zookeeper.keeper 이름 참조) → 스키마·anti-affinity·PDB 확인 → 백업 사이드카·모니터링
```

참조 아키텍처는 [스토리지 페이지의 참조 배치]({{< relref "02-storage-local-nvme.md" >}})를 operator 관점으로 구체화한 것이다 — `clickhouse-data` NodePool(i8g/i7i.4xlarge, On-Demand, taint `dedicated=clickhouse`) + `clickhouse-keeper` NodePool(소형, gp3, 멀티 AZ) + clickhouse-backup 사이드카 → S3.

## 1. 사전 준비 — 노드·프로비저너·StorageClass

CHI/CHK를 apply하기 **전에** 이 계층이 서 있어야 바인딩이 된다.

### 스토리지 노드풀 — taint / label / userData

Karpenter EC2NodeClass/NodePool에서 `[확인됨]`: 인스턴스는 **i8g/i7i.4xlarge**(단일 3,750GB NVMe) 기본, 용량은 노드를 늘려 **shard/replica로 수평 확장**(대형 노드 + RAID0보다 재수화·blast radius에서 유리). taint `dedicated=clickhouse:NoSchedule`, label `workload=clickhouse`. userData는 `mkfs.xfs` 후 `/mnt/fast-disks/<uuid>` 마운트하며 **`instanceStorePolicy: RAID0`는 설정하지 않는다**(kubelet ephemeral 전용이라 PV를 만들지 않음, 상세는 [스토리지 · 로컬 PV]({{< relref "02-storage-local-nvme.md" >}})). disruption 방어는 `do-not-disrupt`(voluntary만 방지) + `consolidationPolicy: WhenEmpty` + **Spot 금지·On-Demand/Reserved**(로컬 디스크 노드 소실 = 재수화 이벤트).

### local PV provisioner 선택

| provisioner | 언제 쓰나 | 특성 |
|---|---|---|
| **local-static-provisioner** (기본 권장) | 노드 NVMe **전부**를 1 ClickHouse가 사용, 안정 최우선 | `no-provisioner`, **1 PV = 1 디스크/배열**, 사전 마운트 필수. AWS 공식 DB 레시피. DB 정석 `[확인됨]` |
| **TopoLVM** | 한 노드 NVMe를 **여러 PVC로 분할**·용량 격리·온라인 확장 필요 | `topolvm.io`, LVM VG에서 LV 동적 절단, capacity-aware 스케줄링, `allowVolumeExpansion`, cert-manager 의존 `[확인됨]` |
| **OpenEBS LocalPV-LVM/Device** | 이미 OpenEBS 생태계이거나 thin·변종 필요 | LVM(`local.csi.openebs.io`) / Device(`openebs.io/local`, `cas-type: local`). TopoLVM과 기능 동급 `[확인됨]` |

**기본은 local-static-provisioner** — 4xlarge 단일 디스크·노드=단일 CH 전용이면 계층이 가장 얕고 격리가 명확하다 `[확인됨]`. "한 로컬 디스크를 data/log로 쪼개거나" "온라인 확장"이 필요해지는 시점에만 LVM 계열로 승급한다(단 **로컬 볼륨은 확장 불가**이므로 확장이 목적이면 LVM + `provisioner: Operator` 조합이라야 의미가 있다, §2.3).

### StorageClass 2종 — 로컬 CH용 + gp3 Keeper/로그용

두 개를 만든다. 로컬 SC는 **반드시 `WaitForFirstConsumer`** — 로컬 PV는 `nodeAffinity`로 특정 노드에 못박혀 있어, 파드 스케줄 전에 바인딩하면 스케줄러가 노드 제약을 반영 못 해 엉뚱한 노드로 가거나 Pending에 빠진다(k8s 공식은 이 모드를 "recommended"로 서술하나 로컬에선 사실상 필수) `[확인됨]`.

```yaml
# (1) ClickHouse 데이터용 — 로컬 NVMe
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata: { name: fast-disks }
provisioner: kubernetes.io/no-provisioner   # 로컬 볼륨은 동적 프로비저닝 없음
volumeBindingMode: WaitForFirstConsumer      # 로컬 PV 필수
reclaimPolicy: Delete                        # SC 레벨은 Delete, CHI VCT에서 Retain으로 이중 보호(§2.3)
---
# (2) Keeper 데이터 + CH 로그용 — 영속 EBS
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata: { name: gp3 }
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true                   # gp3는 온라인 확장 가능
reclaimPolicy: Delete
parameters: { type: gp3 }
```

**provisioner 없이 직접 마운트 — hostPath / emptyDir(로컬 강조)** `[확인됨]`. Altinity 공식 예제는 provisioner를 거치지 않는 로컬 경로도 시연한다: `11-local-storage-01/02-*-host-path`(hostPath 데이터 디렉토리 직접 마운트), `03-persistent-volume-09-with-template-emptydir`(노드 로컬 임시 볼륨). **hostPath**는 PV/provisioner 없이 노드 디렉토리를 그대로 붙여 PoC·단일 노드엔 최단 경로지만 node affinity·용량 회계·권한을 손으로 져야 한다. **emptyDir**은 파드 수명과 함께 사라져 stateful CH 데이터엔 부적합(rolling update 예제 전용). 프로덕션 로컬 NVMe는 provisioner 경로(local-static-provisioner)가 정석이고, hostPath/emptyDir은 "provisioner 세우기 전 빠른 검증"이나 재생성 가능 데이터에 한정한다 `[추정]`.

## 2. 핵심 배포 — CHK + CHI

배포 순서상 **Keeper(CHK)를 먼저 Ready로** 만든 뒤 CHI가 `zookeeper.keeper` 이름으로 붙는다.

### CHK — Keeper 3노드 (gp3 영속)

`layout.replicasCount: 3`(1 장애 허용, 프로덕션 최소). 데이터는 **gp3** — 로컬 NVMe에 두면 노드 소실 시 Raft 로그/스냅샷이 날아가 quorum 복구가 번거롭다. 소량(20Gi급)이면 충분하고 저지연 `fdatasync`가 관건이다 `[확인됨]`.

```yaml
apiVersion: "clickhouse-keeper.altinity.com/v1"
kind: "ClickHouseKeeperInstallation"
metadata:
  name: analytics-keeper
  annotations: { prometheus.io/port: "7000", prometheus.io/scrape: "true" }
spec:
  defaults:
    templates: { podTemplate: keeper-pod, dataVolumeClaimTemplate: keeper-data }
  configuration:
    clusters:
      - name: keeper
        layout: { replicasCount: 3 }        # 홀수 3노드 정족수. 더 높은 가용성은 5노드
    settings:                               # Keeper config.xml
      keeper_server/tcp_port: "2181"
      listen_host: "0.0.0.0"
      keeper_server/four_letter_word_white_list: "*"   # ruok/imok 라이브니스(0.27.0+)
      prometheus/endpoint: "/metrics"
      prometheus/port: "7000"
      prometheus/metrics: "true"
  templates:
    podTemplates:
      - name: keeper-pod
        spec:                               # 표준 PodSpec — Keeper끼리 서로 다른 노드/AZ
          affinity:
            podAntiAffinity:
              requiredDuringSchedulingIgnoredDuringExecution:
                - labelSelector:
                    matchExpressions:
                      - { key: "app", operator: In, values: ["clickhouse-keeper"] }
                  topologyKey: "kubernetes.io/hostname"
          containers:
            - name: clickhouse-keeper
              image: "clickhouse/clickhouse-keeper:24.8"   # 태그 고정(프로덕션)
              resources:
                requests: { memory: "256M", cpu: "1" }
                limits:   { memory: "4Gi",  cpu: "2" }      # Keeper는 4GB면 충분
    volumeClaimTemplates:
      - name: keeper-data                    # → /var/lib/clickhouse-keeper
        spec:
          accessModes: ["ReadWriteOnce"]
          storageClassName: gp3              # ← CH는 fast-disks(로컬), Keeper는 gp3(영속)
          resources: { requests: { storage: 20Gi } }
```

CHK가 pod ordinal별 `server_id`(Raft peer), quorum/startup, 4LW 라이브니스를 자동 관리한다(수동 STS 대비 Raft 실수 제거). `hostTemplates`로 포트를 바꾸지 않으면 operator CHK 관례 기본은 **zkPort 2181 / raftPort 9444**다(9181/9234는 독립형 Keeper의 네이티브 기본값) `[확인됨]`. CHK 전용 수명주기 필드로 `spec.suspend`(리컨사일 일시중지, CHI의 `stop`에 대응)가 있다 `[확인됨]`.

### CHI — 범용 분석 클러스터 (로컬 NVMe, 데이터/로그 분리)

2 shard × 2 replica, 데이터=로컬 NVMe(`fast-disks`), 로그=gp3, CHK 이름 참조, anti-affinity(hostname+zone 이중), `storageManagement` Retain, 볼륨 `securityContext` `[확인됨]`.

```yaml
apiVersion: "clickhouse.altinity.com/v1"
kind: "ClickHouseInstallation"
metadata:
  name: analytics
spec:
  defaults:
    storageManagement:
      provisioner: StatefulSet          # 로컬 NVMe: 확장 불가 → 기본값으로 충분(§2.3)
      reclaimPolicy: Retain             # 실수 삭제 방어(STS/CHI 삭제해도 PVC 잔존)
    templates:
      podTemplate: ch-nvme
      dataVolumeClaimTemplate: data-nvme      # → /var/lib/clickhouse
      logVolumeClaimTemplate:  log-gp3        # → /var/log/clickhouse-server
      serviceTemplate: ch-svc
  configuration:
    zookeeper:
      keeper: { name: analytics-keeper }  # 위 CHK를 이름으로 참조(0.27.0+ 권장)
      session_timeout_ms: 30000
    clusters:
      - name: main
        pdbManaged: "yes"               # PDB operator 자동 생성(§5)
        pdbMaxUnavailable: 1            # 한 번에 pod 1개만 down → shard 정족수 보호
        layout:
          shardsCount: 2
          replicasCount: 2              # 로컬 NVMe 하한: shard당 replica ≥ 2(내구성)
    settings:                           # config.xml (config.d)
      max_concurrent_queries: 200
      logger/level: information
    users:                              # users.xml (users.d) — 시크릿 참조(평문 금지)
      app/k8s_secret_password: default/ch-secret/password_sha256
      app/networks/ip: ["10.0.0.0/8"]
      app/profile: default
  templates:
    podTemplates:
      - name: ch-nvme
        zone:                           # AZ 핀(선택) → nodeAffinity로 렌더
          key: "topology.kubernetes.io/zone"
          values: ["ap-northeast-2a", "ap-northeast-2b", "ap-northeast-2c"]
        podDistribution:
          - { type: ShardAntiAffinity, topologyKey: "kubernetes.io/hostname" }        # 같은 shard replica를 다른 노드로
          - { type: ShardAntiAffinity, topologyKey: "topology.kubernetes.io/zone" }   # 같은 shard replica를 다른 AZ로
        spec:                           # 표준 PodSpec
          securityContext:              # 로컬/hostPath 데이터 디렉토리 권한(03-persistent-volume-07-security-context)
            fsGroup: 101                # [미확인] 이미지의 clickhouse uid/gid에 맞춰 조정
            runAsUser: 101
            runAsGroup: 101
          nodeSelector: { workload: clickhouse }   # 스토리지 노드풀 label(§1)
          tolerations:
            - { key: dedicated, operator: Equal, value: clickhouse, effect: NoSchedule }
          containers:
            - name: clickhouse
              image: clickhouse/clickhouse-server:24.8   # ClickStack 병용 시 24.8 LTS+
              resources:
                requests: { cpu: "8", memory: "60Gi" }   # R-type 8GB:1core
                limits:   { cpu: "8", memory: "60Gi" }
              volumeMounts:              # VCT 이름과 정확히 일치해야 바인딩
                - { name: data-nvme, mountPath: /var/lib/clickhouse }
                - { name: log-gp3,   mountPath: /var/log/clickhouse-server }
    volumeClaimTemplates:
      - name: data-nvme
        reclaimPolicy: Retain            # 로컬 데이터 보호(VCT 개별 override)
        spec:
          accessModes: ["ReadWriteOnce"] # 로컬 PV는 RWO
          storageClassName: fast-disks   # WaitForFirstConsumer 로컬 SC(§1)
          resources: { requests: { storage: 3400Gi } }   # 3.75TB 중 여유 제외 [미확인: 실측 조정]
      - name: log-gp3                     # 로그는 작은 gp3로 분리(로컬 NVMe를 데이터 전용으로)
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

`layout`을 선언하면 operator가 **`remote_servers`와 per-host `macros`(`{shard}`/`{replica}`/`{cluster}`)를 자동 렌더**하므로 config.d에 손으로 remote_servers를 쓸 필요가 없다 `[확인됨]`. 데이터 mountPath `/var/lib/clickhouse`는 확정, 로그 자동 mountPath는 슬롯명 기반 기본값이라 위처럼 `volumeMounts`에 명시하면 확실하다 `[추정]`.

### 데이터/로그 볼륨 분리와 storageManagement

**볼륨 분리** `[확인됨]`: VCT를 두 개 만들고 `dataVolumeClaimTemplate`(→ `/var/lib/clickhouse`)·`logVolumeClaimTemplate`(→ `/var/log/clickhouse-server`)에 각각 지정하면 operator가 자동 매핑한다. 로컬 볼륨은 **1 디스크=1 PV**라 같은 로컬 디스크를 data/log로 쪼갤 수 없으므로 **로그는 gp3로 빼서** 로컬 NVMe를 데이터 전용으로 지키는 것이 자연스럽다(같은 로컬 디스크 분할이 필요하면 TopoLVM 계열).

**storageManagement** `[확인됨]`:

| 필드 | 값 | 로컬 NVMe 권고 |
|---|---|---|
| `provisioner` | `StatefulSet`(기본) \| `Operator` | **`StatefulSet`**. `Operator`는 CSI `allowVolumeExpansion` 환경에서 파드 재시작 없이 온라인 확장할 때만 — 로컬 NVMe는 물리적으로 확장 불가라 이점 없음 |
| `reclaimPolicy` | `Retain` \| `Delete`(기본) | **`Retain`**. STS/CHI 삭제·`helm uninstall`에도 PVC 잔존 → 실수 삭제 방어. `stop: 1`은 Replicas=0으로 만들되 PVC intact |

> **주의**: `Operator` provisioner + VCT 크기 변경 시 과거 데이터 손실 회귀(#1385/#457)가 있었다. 확장은 스테이징 검증 후에만 `[확인됨]`.

## 3. 필드 레벨 티어링 — hot NVMe → S3 cold

티어링의 **원칙**(≠내구성, 사본 경제, gp3의 자리)은 [스토리지 · 티어링 설계]({{< relref "02-storage-local-nvme.md" >}})가 담당한다. 여기서는 그 설계를 **CHI가 실제로 주입하는 필드 형태**만 다룬다 — `storage_configuration`은 CHI `settings`(점표기) 또는 `files`(원본 XML)로 넣고, TTL은 테이블 DDL에 둔다 `[확인됨]`(공식 예제 `03-persistent-volume-08-tiered-s3`).

```yaml
spec:
  configuration:
    settings:
      # disks — S3 원격 + 로컬 LRU 캐시  [미확인] 정확한 키는 03-persistent-volume-08-tiered-s3로 확정
      storage_configuration/disks/s3_disk/type: s3
      storage_configuration/disks/s3_disk/endpoint: https://ch-cold.s3.ap-northeast-2.amazonaws.com/data/
      storage_configuration/disks/s3_disk/use_environment_credentials: "true"   # IRSA
      storage_configuration/disks/s3_cache/type: cache
      storage_configuration/disks/s3_cache/disk: s3_disk
      storage_configuration/disks/s3_cache/path: /var/lib/clickhouse/s3_cache/
      storage_configuration/disks/s3_cache/max_size: "200Gi"
      # policies — hot(로컬 NVMe) → cold(S3+cache)
      storage_configuration/policies/hot_to_cold/volumes/hot/disk: default
      storage_configuration/policies/hot_to_cold/volumes/cold/disk: s3_cache
```

```sql
-- 테이블에 정책·TTL 적용 (관측성 예: 7일 후 S3로 이동)
CREATE TABLE otel_logs (...) ENGINE = ReplicatedMergeTree
SETTINGS storage_policy = 'hot_to_cold'
TTL toDateTime(timestamp) + INTERVAL 7 DAY TO VOLUME 'cold';
```

`use_environment_credentials`로 IRSA 자격증명을 태우고, `s3_cache`가 없으면 cold 쿼리가 S3 지연에 직접 노출된다. 주 이동은 시간 기반 TTL MOVE로 하고 `move_factor`는 hot 포화 안전판으로만 쓴다(원칙은 [스토리지 페이지]({{< relref "02-storage-local-nvme.md" >}})). **self-host는 shared-nothing이라 cold도 replica 수(RF)만큼 S3에 중복 저장**되며 zero-copy replication은 프로덕션 금지다.

## 4. 자주 조정하는 CHI 옵션

| 옵션 | 무엇을 | 언제 조정 | 주의 |
|---|---|---|---|
| `clusters[].layout.shardsCount/replicasCount` | 토폴로지 격자 | 용량·내구성 스케일 | replica↑=자동, shard↑=수동 리샤딩(§5). 로컬 NVMe는 replica ≥ 2 하한 |
| `zookeeper.keeper.name` | CHK 이름 참조 | 0.27.0+ 항상 권장 | 참조 CHK 엔드포인트 변경 시 의존 CHI 자동 재리컨사일 |
| `settings` / `files` | config.xml / 임의 XML | 커스텀 설정·dictionary·티어링 | **반드시 이 필드로만** 주입. 외부 볼륨/ArgoCD 직접 마운트는 렌더 충돌 → CrashLoop(#1456) |
| `users`/`profiles`/`quotas` | users.xml | 계정·권한 | 시크릿은 `k8s_secret_password`로(평문 금지). 업그레이드 시 `clickhouse_operator` 프로파일 소실 주의(#1744) |
| `podDistribution` + `topologySpreadConstraints` | 배치 강제 | AZ/노드 분산 | shard-aware는 podDistribution, AZ 균등 하드 제약(`whenUnsatisfiable: DoNotSchedule`)은 topologySpread. 병용 |
| `reconcile.host.wait.replicas.new` | 신규 replica catch-up 대기 | scale-out·재수화 | `new: "yes"`로 따라잡을 때까지 다음 단계 대기 |
| `reconcile.statefulSet.update.onFailure` | STS 업데이트 실패 처리 | 롤링 안전장치 | `rollback`(이전 Generation) / `abort` / `ignore` |
| `reconcile.statefulSet.recreate.onDataLoss` | 볼륨 소실 시 STS 재생성 | 로컬 NVMe 노드 소실 | `recreate`로 두면 재수화 자동화의 일부 |
| `reconcile.host.drop.replicas.{onLostVolume,active}` | 소실 replica의 Keeper 등록 정리 | 재수화 | `onLostVolume: yes` + `active: no`(살아있는 replica는 절대 drop 안 함) |
| `pdbManaged` / `pdbMaxUnavailable` | PDB 자동 생성·튜닝 | 항상 | `pdbMaxUnavailable: 1`로 shard 정족수 보호 |
| `stop` / `taskID` / `restart` / `troubleshoot` | 운영 제어 노브 | 정지·강제 재조정·디버깅 | 노드 소실 복구 시 `taskID` patch로 재조정 트리거(§5) |

## 5. 운영 런북

### replica 추가(자동) vs shard 추가(수동)

`[확인됨]` **replica 추가**: `replicasCount++` → apply. operator가 새 host/STS/PVC 생성 → **스키마 자동 전파** → `remote_servers` 자동 갱신 → catch-up 대기(`reconcile.host.wait.replicas.new: "yes"`). 함정: 특정 조작 순서에서 스키마 auto-creation 미동작(#1500/#1602) → 스케일은 반드시 CHI를 통해 정해진 순서로. **shard 추가**: `shardsCount++`는 pod/STS를 만들고 `remote_servers`에 추가하지만 **기존 데이터를 자동 재분배하지 않는다**(ClickHouse가 자동 rebalance 미지원). 대응: ① shard weight 편중(append-only 관측성에 최적, 기존 데이터 이동 불필요) ② `INSERT INTO SELECT` 재수집(균등 필요한 범용 분석, 대용량이면 무거움) ③ 파트 수동 이동(대규모엔 비현실적). **초기 shard 수를 넉넉히** 잡아 리샤딩 빈도를 낮추는 게 최선.

### 롤링 업그레이드

**operator 자체** `[확인됨]`: `이전 minor → 현재 minor`(0.26→0.27)만 CI 검증 — **minor 스킵 금지**, 순차로. CRD는 Helm이 건드리지 않으므로 **별도 단계로 apply**(`kubectl apply -f .../crd.yaml`), **절대 삭제 금지**(삭제 시 모든 CHI/CHK CR 동반 삭제). operator 업그레이드가 리컨사일 동작을 바꿔 예기치 않은 롤링을 유발한 회귀 이력 → 스테이징 선검증 필수. ArgoCD 병용 시 0.27.1+ 권장.

**ClickHouse 버전** `[확인됨]`: podTemplate 이미지 태그 변경 → apply → operator가 replica 1개씩 롤링(롤링 중 replica를 분산쿼리에서 low priority로 빼 트래픽 차단). PDB가 동시 다운 방지, `reconcile.host.wait.replicas`로 catch-up 게이팅. **one-year 호환 창(2 LTS 포함)** 준수, **버전 스킵 금지**(중간 릴리즈 노트를 LTS 징검다리로 순차 확인).

### 노드 소실 · 재수화 (로컬 NVMe 핵심)

로컬 NVMe 노드가 사라지면 그 데이터는 영구 소실 → healthy replica에서 재수화 `[확인됨]`.

```bash
# 1. 소실 노드의 Pod는 Pending(로컬 PV node affinity로 그 노드 고정). 남은 replica로 쿼리는 계속 서빙(RMT)
kubectl get pods -n clickhouse -o wide
# 2. stale PVC/PV 정리 (Retain 정책 하 자동 정리 안 됨)
kubectl delete pvc data-nvme-<chi>-<shard>-<replica>-0 -n clickhouse
kubectl delete pv  <released-local-pv>
# 3. 신규 노드 프로비저닝(Karpenter/ASG) → userData 마운트 → local-static-provisioner가 새 PV 발견
# 4. operator reconcile 트리거 — STS/PVC 재생성 + 스키마 전파
kubectl patch chi analytics -n clickhouse --type=merge \
  -p '{"spec":{"taskID":"recover-'"$(date +%s)"'"}}'
# 5. 새 replica가 Keeper 통해 healthy replica에서 누락 파트 다운로드. 필요 시:
#    SYSTEM RESTART REPLICA db.table;  SYSTEM SYNC REPLICA db.table;
```

무손실 재수화는 **shard당 replica ≥ 2 + anti-affinity**가 전제다. replica=2에서 1노드 소실 시 그 shard는 재수화 완료까지 단일 사본이므로 **동시에 여러 노드를 교체하지 말 것**(`pdbMaxUnavailable: 1`이 강제). 재수화 시간은 노드당 데이터를 작게(shard 수평 확장) 줄이고, TB당 정확한 소요는 스테이징에서 실측한다 `[미확인]`. 관련 필드: `reconcile.statefulSet.recreate.onDataLoss: recreate`, `host.drop.replicas.onLostVolume: "yes"` + `active: "no"`, 자동복구 `reconcile.recovery.from.aborted.onPodReady: retry`(0.27.1).

### reconcile hooks — pre/post SQL 자동화

재조정 전후에 임의 SQL을 자동 실행하는 공식 훅이 있다(`reconcile.host.hooks` / `reconcile.cluster.hooks`, 0.27.0 experimental) `[확인됨]`. 롤링·drain 전 `SYSTEM STOP MERGES`·`SYSTEM FLUSH LOGS`, 완료 후 `SYSTEM START MERGES` 같은 무중단 운영 자동화를 매니페스트에 선언적으로 박아 둘 수 있다.

```yaml
spec:
  reconcile:
    host:                               # 호스트 재조정 전후
      hooks:
        pre:  [ { sql: { queries: ["SYSTEM STOP MERGES"] } } ]    # [미확인] 하위 구조는 CRD 재확인
        post: [ { sql: { queries: ["SYSTEM START MERGES"] } } ]
    cluster:                            # 클러스터 재조정 전후(target 지정 가능)
      hooks:
        pre:  [ { sql: { queries: ["SYSTEM FLUSH LOGS"] } } ]
```

### 백업 — clickhouse-backup 사이드카 → S3

로컬 NVMe는 휘발성이므로 복제 외에 S3 백업이 두 번째 방어선 `[확인됨]`. CHI podTemplate에 `altinity/clickhouse-backup` 컨테이너를 CH와 같은 pod에 추가(하드링크 백업), REST API `:7171`, `S3_PATH: backup/shard-{shard}`(operator `{shard}` 매크로로 **shard당 1 백업**), 자격증명은 IRSA. CronJob으로 각 shard 첫 replica에 접속해 `system.backup_actions`에 주간 full + 일간 incremental(`concurrencyPolicy: Forbid`). **incremental 체인은 이전 백업 전체에 의존** → S3 lifecycle로 base가 Glacier 되면 체인 붕괴(상세는 [스토리지 페이지]({{< relref "02-storage-local-nvme.md" >}})의 내구성 3종 세트).

### PDB · 모니터링 · ArgoCD

- **PDB** `[확인됨]`: operator 자동 생성. `pdbManaged: "yes"`(기본) + `pdbMaxUnavailable: 1`. CHK도 동일 필드로 Keeper 정족수 보호.
- **모니터링** `[확인됨]`: metrics-exporter `:8888/metrics`(`chi_clickhouse_metric_*`/`_event_*`), CHK `:7000`, 백업 사이드카 `:7171`. 0.27.0에서 노이즈성 per-CPU OS 메트릭 기본 제외(복구는 `excludeRegexp: []`).
- **ArgoCD `ignoreDifferences`** `[확인됨]`: operator가 `/status`·일부 PVC/애노테이션을 계속 갱신해 영구 OutOfSync(#958/#1799). ArgoCD `Application.spec.ignoreDifferences`에 `{group: clickhouse.altinity.com, kind: ClickHouseInstallation, jsonPointers: [/status]}`를 넣어 상태 필드를 무시하고, self-heal 사용 시 `syncOptions: [RespectIgnoreDifferences=true]`로 동기화 루프를 막는다. operator는 0.27.1+ 권장(`resourceFieldRef.divisor` 영구 diff 수정).

## 6. operator 레벨 튜닝 · 템플릿 재사용 · 워크로드 분리

### operator self-config (멀티테넌시·성능)

CHI/CHK가 아니라 **operator 자체**를 튜닝하는 설정이 별도로 있다 `[확인됨]`. `ClickHouseOperatorConfiguration` **CRD**(또는 `etc-clickhouse-operator-files` ConfigMap)로 `watchNamespaces`(감시 네임스페이스 한정 → 멀티 operator 격리·멀티테넌시), `reconcileThreadsNumber`(기본 10, 동시 reconcile 상한 → 대규모 다중 CHI 성능)를 조정한다. **주의**: operator는 자기 설정을 self-reconcile하지 않아 변경은 **시작 시에만 반영**되므로 operator 재시작이 필요하다.

### useTemplates / CHIT — 공유 설정 재사용

관측성 CH와 범용 분석 CH가 공통 설정(podTemplate·VCT·리소스·티어링 등)을 공유한다면, `ClickHouseInstallationTemplate`(CHIT)에 한 번 정의하고 두 CHI가 `useTemplates`로 참조해 중복을 없앤다 `[확인됨]`(`chit-examples` 디렉토리, 세부 파일 목록은 `[미확인]`).

```yaml
# 공유 템플릿 (한 번 정의)
apiVersion: "clickhouse.altinity.com/v1"
kind: "ClickHouseInstallationTemplate"
metadata: { name: ch-common }
spec:
  templates:
    podTemplates: [ { name: ch-nvme, spec: { ... } } ]
    volumeClaimTemplates: [ { name: data-nvme, spec: { storageClassName: fast-disks, ... } } ]
---
# 각 CHI가 참조
spec:
  useTemplates:
    - { name: ch-common, useType: merge }
```

### 관측성 CH vs 범용 분석 CH — 분리

두 워크로드는 **별도 CHI(가능하면 별도 노드풀)로 분리** 권장 `[추정]` — 관측성은 고volume append-only ingest·짧은 hot+S3 cold·shard 넉넉히, 범용 분석은 배치/간헐 적재·장기 보존·쿼리 패턴 기준. 하나의 operator가 CHI 2개를 관리하고, Keeper는 공유 CHK를 두 CHI가 참조하되 **ZK root path를 다르게**(`zookeeper.root`) 격리하거나 강한 격리가 필요하면 CHK도 분리한다. ClickStack v2는 공식 operator를 끌고 들어오므로, 범용 CH를 Altinity로 통일하려면 ClickStack의 `clickhouse.enabled: false`로 내장 CH를 끄고 Altinity 관리 CH를 바라보게 한다(배경은 [operator 페이지]({{< relref "03-operator.md" >}})의 2종 공존 문제, 관측성 프론트 상세는 [HyperDX 심층]({{< relref "../rum/01-hyperdx-deep-dive.md" >}})).

## 7. 안티패턴 · 배포 전 체크리스트

### 하지 말 것

- ❌ **로컬 NVMe에 Keeper 데이터** → 노드 소실 시 quorum 메타데이터 소실. Keeper는 gp3(영속).
- ❌ **shard당 단일 replica로 로컬 NVMe** → 노드 소실 = 영구 데이터 손실. replica ≥ 2 필수.
- ❌ **config를 외부 볼륨/ArgoCD로 직접 마운트** → operator 렌더와 충돌 CrashLoop(#1456). 반드시 `settings`/`files`/`users`로.
- ❌ **`instanceStorePolicy: RAID0`를 CH PV로 기대** → kubelet ephemeral 전용, PV를 만들지 않음.
- ❌ **4xlarge 단일 디스크에 RAID0** → 이득 없음 + 신형 AL2023 단일 디스크 RAID0 부팅 버그(#2386). 직접 mkfs.xfs.
- ❌ **CRD를 helm/kubectl로 삭제** → 모든 CHI/CHK CR 동반 삭제. 업그레이드는 CRD 별도 apply.
- ❌ **operator/CH minor 버전 스킵 업그레이드** → 순차로, LTS 징검다리.
- ❌ **shardsCount 늘리고 자동 rebalance 기대** → weight 또는 INSERT INTO SELECT.
- ❌ **zero-copy replication 사용**, **로컬 볼륨에 `provisioner: Operator`로 확장 시도**(물리 확장 불가).
- ❌ **동시에 한 shard의 여러 노드 교체** → 재수화 중 redundancy 0 창에서 데이터 손실 위험.
- ❌ **CH 데이터 노드를 Spot으로** → 중단 = 재수화 이벤트. On-Demand/Reserved.
- ❌ **emptyDir을 CH 데이터로** → 파드 재시작 시 소실. hostPath는 provisioner 세우기 전 검증용에 한정.
- ❌ **`kubectl delete chi`가 Terminating에서 멈춤** → finalizer hang. `reclaimPolicy`/PVC 상태를 확인하고 필요 시 finalizer를 수동 제거(Altinity KB "DELETE finalizers") `[확인됨]`.

### 배포 전 점검 리스트

- [ ] **operator**: Altinity 0.27.1+ 설치, CRD apply 확인. ArgoCD면 `ignoreDifferences /status` + `RespectIgnoreDifferences`.
- [ ] **노드풀**: i8g/i7i.4xlarge, taint `dedicated=clickhouse`, label `workload=clickhouse`, userData mkfs.xfs → `/mnt/fast-disks`, `instanceStorePolicy` 미설정, On-Demand, do-not-disrupt.
- [ ] **provisioner/SC**: local-static-provisioner DaemonSet 기동, `fast-disks`(no-provisioner, **WaitForFirstConsumer**) + `gp3`(ebs.csi, 확장 가능).
- [ ] **Keeper**: CHK 3노드, 데이터 `gp3`, podAntiAffinity(노드/AZ), Ready 확인 후 CHI apply.
- [ ] **CHI 레이아웃**: shard당 replica ≥ 2, `podDistribution: ShardAntiAffinity`(hostname+zone 이중), `zone`으로 AZ 핀.
- [ ] **스토리지**: `storageManagement.provisioner: StatefulSet` + `reclaimPolicy: Retain`, 데이터 `fast-disks`/로그 `gp3` 분리, 볼륨 `securityContext.fsGroup`.
- [ ] **설정 주입**: 모든 config는 `settings`/`files`/`users`로만. 시크릿은 `k8s_secret_*`(평문 금지).
- [ ] **티어링**: hot=로컬 NVMe → cold=S3 `storage_configuration`(+cache) + TTL MOVE TO VOLUME.
- [ ] **PDB / 백업 / 모니터링**: `pdbMaxUnavailable: 1`; clickhouse-backup 사이드카(:7171)+CronJob `shard-{shard}` IRSA; metrics :8888/:7000/:7171 스크레이프.
- [ ] **보안**: 전송구간 TLS를 켤 경우 `security.clickhouse.tls`(rootCASecretRef 등)로 선언, HTTPS **8443**·native **9440** secure 포트 노출 `[추정: 표준 CH secure 포트]`.
- [ ] **분리·재사용**: 관측성/범용을 별도 CHI(+노드풀), 공통은 CHIT `useTemplates`. ClickStack은 `clickhouse.enabled: false`로 외부 CH 연결.
- [ ] **검증**: apply 후 파드 Running, `remote_servers`/macros 자동 생성, 스키마 전파, anti-affinity 배치, **노드 소실 리허설(스테이징)**.

이 배포도가 managed와 어떻게 갈리는지는 [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}}), 실제 프로덕션 운영 사례는 [프로덕션 운영 사례]({{< relref "05-production-usecases.md" >}})에서 이어진다. 시점 기준 2026-07.
