---
title: "변경관리·스케일·롤링 업그레이드·복구"
date: 2026-07-15
lastmod: 2026-08-24
weight: 5
url: "/clickhouse/05-altinity-operations/"
---

# 변경관리·스케일·롤링 업그레이드·복구

ClickHouse의 shard를 늘리는 변경과 replica를 늘리는 변경은 작업 결과가 다릅니다. 새 replica는 기존 shard의 사본을 받아오지만, 새 shard에 과거 데이터가 자동으로 옮겨지지는 않습니다. 매니페스트의 숫자 하나를 바꿨더라도 데이터 이동과 확인 절차까지 따로 계획해야 합니다.

이 글은 배포된 Altinity 클러스터의 용량 변경, 서버·operator·Keeper 업그레이드, 데이터 노드와 Keeper 복구를 다룹니다. 조사 기준은 Altinity Kubernetes Operator 0.27.1(2026-06-04 릴리스)이며 2026-07-15에 확인했습니다. 처음 만드는 CHK/CHI와 StorageClass는 [배포 플레이북]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}}), 선택 배경은 [operator 비교]({{< relref "/data/clickhouse/deployment/03-operator.md" >}})에 있습니다.

복구 명령에는 환경별 리소스 이름과 확인되지 않은 필드가 남아 있습니다. 스테이징에서 절차를 완성하고 소요 시간을 측정한 뒤 운영 런북으로 사용합니다.

## 규모별 CHI/CHK 구성 패턴

CHI의 `layout.shardsCount`와 `layout.replicasCount`를 선언하면 operator가 StatefulSet과 파드를 구성합니다 `✓`. Keeper 연결은 `spec.configuration.zookeeper.nodes`에 주소를 적거나, 0.27.0부터 지원하는 CHK 이름 참조를 사용할 수 있습니다. 아래는 주소를 직접 지정한 예시이고 이름 참조는 [배포 플레이북]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}})에 있습니다.

### 소규모 — 1 shard × 2~3 replica + CHK 3노드

한 shard에 replica 2~3개를 두는 HA 구성입니다. CHK 3노드를 준비하고 아래 CHI에서 Keeper 엔드포인트를 참조합니다. gp3와 probe를 포함한 [CHK 매니페스트]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}})는 배포 글을 참고합니다.

```yaml
apiVersion: "clickhouse.altinity.com/v1"
kind: "ClickHouseInstallation"
metadata:
  name: analytics
  namespace: clickhouse
spec:
  configuration:
    zookeeper:
      nodes:
        - host: chk-keeper-keeper-0-0.clickhouse.svc.cluster.local
          port: 2181
        - host: chk-keeper-keeper-0-1.clickhouse.svc.cluster.local
          port: 2181
        - host: chk-keeper-keeper-0-2.clickhouse.svc.cluster.local
          port: 2181
    clusters:
      - name: analytics
        layout:
          shardsCount: 1
          replicasCount: 3
  defaults:
    templates:
      podTemplate: clickhouse-pod-template
      dataVolumeClaimTemplate: clickhouse-data-volume
  templates:
    podTemplates:
      - name: clickhouse-pod-template
        podDistribution:
          - type: ClickHouseAntiAffinity
            topologyKey: "kubernetes.io/hostname"
        spec:
          containers:
            - name: clickhouse
              image: "clickhouse/clickhouse-server:24.8"
    volumeClaimTemplates:
      - name: clickhouse-data-volume
        spec:
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 500Gi
          storageClassName: local-nvme
```

`podDistribution`의 `ClickHouseAntiAffinity`+`topologyKey: kubernetes.io/hostname`는 [필수 전제]({{< relref "/data/clickhouse/deployment/03-operator.md" >}})를 구현합니다. 같은 shard의 replica 2개가 한 노드에 co-locate되지 않도록 막는 장치입니다 — 이 anti-affinity 없이 로컬 NVMe를 쓰면 그 노드가 죽을 때 shard 전체가 죽습니다 `✓`.

### 중규모 — 수 shard × 2~3 replica

소규모 CHI에서 달라지는 부분만 표시합니다.

```yaml
    clusters:
      - name: analytics
        layout:
          shardsCount: 3
          replicasCount: 2
```

이 규모에서는 자동 생성된 PDB와 파드 배치를 함께 확인합니다. operator는 클러스터당 기본 `maxUnavailable: 1`짜리 PDB를 자동 생성합니다. 노드당 ClickHouse 파드를 2개 이상 배치하는 토폴로지(예: 3 shard × 2 replica를 3노드에)에서는 이 PDB가 롤링 업데이트를 막은 사례가 보고됐습니다 `≈`. Altinity 메인테이너는 PDB 설정을 손대는 대신 `podDistribution` 타입을 `CircularReplication`으로 바꿔 파드 배치 자체를 조정하라고 답했습니다 `≈`.

### 대규모 — 수십 노드·다중 클러스터

다수의 데이터 노드를 운영할 때는 전용 노드풀에 파드를 배치합니다.

```yaml
        spec:
          nodeSelector:
            workload: clickhouse
          tolerations:
            - key: dedicated
              operator: Equal
              value: clickhouse
              effect: NoSchedule
```

전용 노드풀(`nodeSelector`/`tolerations`)과 앞서 쓴 `podDistribution`/`volumeClaimTemplates`을 병행합니다. 다중 클러스터는 하나의 CHI 안에 `clusters` 배열 항목을 여러 개 두거나, 클러스터별로 CHI를 분리해 운영합니다.

shard 수가 많으면 operator는 이 규모의 설정 변경을 staged rollout으로 처리합니다 — 변경을 첫 shard(모든 replica) 전체에 먼저 순차 probe해 성공을 확인한 뒤에만 나머지 shard의 최대 50%까지 동시 적용합니다. 이 동시 적용 비율은 operator 설정 값 `reconcileShardsThreadsNumber`/`reconcileShardsMaxConcurrencyPercent`(기본 50%)가 정합니다 `✓`. 첫 shard가 실패하면 나머지에는 아예 전파되지 않으니 대규모 클러스터에서 설정 변경의 조기 경보(early warning) 역할을 합니다.

## 스케일 out

`layout.shardsCount`를 늘려 적용하면 operator가 새 shard의 StatefulSet과 파드를 만듭니다 `✓`. 이후 확인할 것은 스키마와 데이터 분포입니다.

- ClickHouse는 기존 데이터를 새 shard로 자동 재분배하지 않습니다. Distributed 테이블은 신규 insert만 전체 shard에 분산합니다. 과거 데이터는 원래 shard에 그대로 남습니다 `✓`. 기존 데이터를 옮기려면 partition detach/attach, `INSERT ... SELECT`, 또는 clickhouse-copier를 수동으로 써야 합니다 `✓`. 실무 대응은 셋 중 하나입니다 — ① shard weight 편중(append-only 관측성에 최적, 기존 데이터 이동 불필요), ② `INSERT INTO SELECT` 재수집(균등 분포가 필요한 범용 분석. 대용량이면 무거움), ③ 파트 수동 이동(대규모엔 비현실적). 초기 shard 수를 넉넉히 잡아 리샤딩 빈도를 낮추는 편이 최선입니다.
- 신규 shard에 스키마가 자동 전파된다고 가정하지 마십시오. 이 글의 절차에서는 신규 shard의 DB·테이블을 별도로 생성하고 확인합니다. 자동 생성 여부에 기대어 적재를 시작하지 않습니다. 기존 shard에 replica를 추가하는 경우와는 다르니 혼동하지 않도록 합니다.

기존 shard에 replica를 추가하면 operator가 새 host/STS/PVC를 만들고 스키마를 전파한 뒤 `remote_servers`를 갱신합니다 `✓`. `reconcile.host.wait.replicas.new: "yes"`는 catch-up을 기다리게 합니다. 다만 #1500/#1602처럼 조작 순서에 따라 스키마 생성이 빠진 사례가 있어, CHI를 통한 변경 후 실제 테이블과 복제 상태를 확인합니다. [설정 필드]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}})를 바꾼 것만으로 검증이 끝나지는 않습니다.

## 스케일 in

replica/shard 제거는 scale-out보다 위험이 큽니다.

- 활성(active) replica는 절대 자동으로 drop되지 않습니다(0.25.5 안전장치) — 상세는 [operator 선택 페이지]({{< relref "/data/clickhouse/deployment/03-operator.md" >}}) 참조. drop 세부 동작은 `onDelete`/`onLostVolume`/`active` 플래그로 설정합니다(0.25.5 changelog) `✓/≈`.
- 볼륨 재프로비저닝이 필요한 경우(디스크 손상 등으로 PV를 직접 지워야 할 때), 신뢰할 수 있는 절차로 보고된 것은 둘뿐입니다 — ① PVC와 StatefulSet을 함께 삭제, ② PV 삭제 후 파드를 재시작해 PV unbind를 강제. 둘 다 operator가 스토리지와 스키마를 정상적으로 재생성한다고 보고됐습니다 `✓/≈`. 이 순서를 벗어난 임의 조작(예: STS는 그대로 두고 PV만 삭제)은 파드가 ephemeral 스토리지로 뜨거나 스키마가 빈 채로 남는 race condition을 일으킨 사례가 있습니다 `≈`.
- PVC는 `helm uninstall`로 삭제되지 않습니다(데이터 보호) `✓`. EBS 계열에서는 `reclaimPolicy: Retain`이 churn·재생성 때 데이터를 지키는 직접적 의미가 큽니다(문서 예제는 `Delete`). 로컬 NVMe에서는 데이터가 어차피 노드와 함께 사라지니 "PVC를 지워도 STS만 재생성되게" 하는 운영상 보호 용도로 씁니다 `≈`. 노드를 회수하기 전에 이 값을 반드시 확인합니다.

{{< callout type="warning" >}}
미해결 버그 리드도 하나 있습니다. GitHub 이슈 기반의 미검증 리드에 따르면 replica 제거 시 operator의 정리(cleanup) 로직이 shard의 첫 replica(`*-0`, `shard.FirstHost()`)에서 `SYSTEM DROP REPLICA`를 실행하도록 하드코딩돼 있습니다. 그 탓에 제거 대상이 `*-0`이 아니거나 `*-0` 자신이 마침 복구 중(재수화 중이라 Keeper 메타데이터가 없는 상태)이면 엉뚱한 replica 이름에 DROP 명령이 나가거나 명령 자체가 실패한다는 보고가 있습니다 `≈`. Kubernetes 상 StatefulSet/파드 자체는 정상적으로 정리되므로 겉보기엔 scale-in이 끝난 것처럼 보여도 ZooKeeper/Keeper에 stale 메타데이터가 남을 수 있습니다. 이 리드는 3-vote 검증을 거치지 않았으므로 실제 영향 범위는 도입 시점에 재확인이 필요합니다.

scale-in 전 체크리스트:
1. 제거 대상 replica의 replication lag가 0에 수렴했는지 확인
2. 제거 대상이 shard의 유일한 온라인 replica가 아닌지 확인
3. `kubectl apply` 후 ZooKeeper/Keeper 경로(`/clickhouse/{cluster}/tables/...`)에 제거된 replica 흔적이 실제로 정리됐는지 수동 확인(위 미해결 리드 때문에 자동 정리를 100% 신뢰하지 않습니다)
4. 노드 자체를 회수하기 전에 PVC `reclaimPolicy`가 `Retain`인지 재확인
{{< /callout >}}

## ClickHouse 버전 롤링 업그레이드 런북

ClickHouse 서버를 올릴 때는 podTemplate의 이미지 태그를 변경합니다. operator가 replica를 순서대로 교체하는 동안 같은 shard에 조회와 복제를 맡을 replica가 남아 있어야 합니다 `✓`. operator 자체의 버전 변경은 다음 절에서 별도로 다룹니다.

1. shard 내부에서는 replica를 한 번에 하나씩만 처리합니다: 해당 replica의 ClickHouse를 shutdown → 새 버전으로 업그레이드 → 재기동 → Keeper 메시지로 시스템 안정을 확인 → 다음 replica로 이동. shard 전체가 동시에 오프라인이 되는 순간이 없어야 합니다 `✓`.
2. shard 간에는 병렬 업그레이드가 허용됩니다 — "한 shard의 모든 replica가 동시에 오프라인"이 되지만 않으면 서로 다른 shard의 replica를 동시에 업그레이드해도 됩니다 `✓`.
3. 혼합 버전 호환 창은 약 1년(또는 2 LTS 미만)입니다. 그 이상 벌어진 버전 간에는 mixed-version 상태로 롤링을 진행하지 말고 다운타임을 감수한 일괄 업그레이드를 하거나 중간 버전을 경유해야 합니다 `✓`. 버전 스킵은 금지입니다. 중간 릴리즈 노트는 LTS 징검다리로 순차 확인합니다.
4. 이 순서를 operator가 어떻게 자동화하는지 — 롤링 중 replica를 `remote_servers`에서 완전히 빼는 대신 분산쿼리 우선순위를 낮추는(low-priority) 처리로 트래픽을 차단하는 것 등 — 는 [operator 선택 페이지]({{< relref "/data/clickhouse/deployment/03-operator.md" >}})에서 다룬 내용을 그대로 따릅니다. 안전장치는 겹쳐서 걸립니다: PDB(`pdbMaxUnavailable: 1`)는 Eviction API 기반 중단을 제한하며, operator의 롤링 순서와 `reconcile.host.wait.replicas`가 별도로 catch-up을 관리합니다. 위 1년/2 LTS 호환 창 자체는 operator가 강제하지 않습니다. 운영자가 직접 지켜야 하는 규칙입니다 — operator는 어떻게 순차 롤링할지를 돕지만 얼마나 버전 차이를 벌려도 되는지는 판단해주지 않습니다.

## operator 자체 업그레이드 런북

Altinity operator는 minor 버전 단계별 업그레이드만 지원합니다(예: 0.26→0.27) — 여러 minor를 건너뛰는 경로는 CI로 검증되지 않으니 오래된 버전에서 온다면 단계별로 순차 업그레이드합니다 `✓`. CRD는 Helm이 건드리지 않으므로 별도 단계로 apply합니다(`kubectl apply -f .../crd.yaml`).

{{< callout type="error" >}}
절대 금지: CRD 삭제. operator 업그레이드 중 어떤 경우에도 CustomResourceDefinition을 삭제하지 마십시오 — Kubernetes가 해당 CRD에 속한 모든 `chi`/`chk` 리소스를 연쇄 삭제하려 시도합니다. 관리 중인 모든 ClickHouse/Keeper 클러스터가 그대로 삭제 대상이 됩니다 `✓`.
{{< /callout >}}

operator 업그레이드는 반드시 스테이징에서 먼저 검증합니다. operator 자체 업그레이드가 리컨사일 동작을 바꿔 예기치 않은 롤링 재시작을 유발할 수 있습니다 — RollingUpdate 중 CrashLoopBackOff(0.26.3 수정), 동시 config+version 업데이트 race(0.26.2 수정) 같은 회귀 이력이 있습니다 `✓`. STS를 scale-to-0 없이 삭제하면 스키마가 재생성되지 않는 등 특정 조작 순서에서 나는 엣지 버그(#1500, #1602)도 여기 속합니다 `✓`.

업그레이드에서 보고된 문제:

- (a) 이미지+설정 동시 변경 시 crash (v0.24.3, issue #1926). 이 버전대의 reconcile 순서는 ConfigMap을 새 버전 설정값으로 먼저 갱신한 뒤 `SYSTEM SHUTDOWN`으로 파드를 재기동시킵니다. 이미지 업그레이드와 새 설정 변경을 한 reconcile에 같이 넣으면 파드가 구 이미지 + 신 ConfigMap 조합으로 재시작해 인식 못 하는 설정값 때문에 crash할 수 있습니다(PR #1956에서 순서 수정) `✓`. 교훈: 이미지 업그레이드와 신규 설정 변경은 별도 reconcile로 분리합니다. 이 원칙을 넘어서는 공식 가이드는 따로 확인되지 않았습니다 `?`.
- (b) 0.27.1 업그레이드 후 감춰졌던 실패가 표면화. 이전 버전에서는 특정 실패(호스트가 `Replicas=0`인데 CHI는 reconciled로 보고되는 상태)가 아무 표시 없이 삼켜졌지만 0.27.1부터는 첫 reconcile에서 이런 CHI가 `Aborted` 상태로 전환됩니다. 복구하려면 CHI spec을 재적용(re-apply)해 informer 재reconcile을 트리거합니다 `✓`.

안전장치 3층(버전순):

- STS recreate 정책(0.26.0) — `reconcile.statefulSet.recreate.onUpdateFailure: abort | recreate`: 실패한 StatefulSet 업데이트를 그대로 둘지(abort) 재생성할지(recreate) 고릅니다 `✓`.
- aborted reconcile 자동 재개(0.27.0) — `reconcile.recovery.from.aborted.onPodReady`: 실패했던 파드가 다시 Ready가 되면 중단된 reconcile을 자동 재개합니다. 단 모든 파드가 Ready인 채로 발생하는 일시적 K8s API 오류는 이 범위 밖입니다 `✓`.
- pre/post SQL 훅(0.27.0, 실험적) — `HostCreate`/`HostShutdown`/`HostRollout`/`HostDelete` 등 이벤트에 SQL을 주입합니다(예: `HostShutdown`에 `SYSTEM STOP REPLICATION QUEUES`). 대상은 `FirstHost`/`AllHosts`/`AllShards`, `failurePolicy: Fail | Ignore` `✓`. 매니페스트 선언 형태는 [배포 플레이북 §reconcile hooks]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}}).

## Keeper(CHK) 업그레이드

0.26.x→0.27.0 경로에서는 데이터 마이그레이션이 필요 없습니다. operator가 렌더링하는 keeper 설정(4-letter-word whitelist 추가, liveness probe가 `pgrep`에서 `ruok`/`imok` 4LW로 전환)만 바뀌니 기존 Keeper 파드는 startup probe로 게이트된 순차 롤링으로 재기동됩니다 `✓`. (0.23.x에서 오는 경우는 예외로, 수동 PV 마이그레이션이 필요하다고 별도 문서화돼 있습니다 `✓`.) 3노드 쿼럼 전제·정족수 산술·분리 배치 근거는 [배포 플레이북 §CHK]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}})를 참조합니다.

{{< callout type="warning" >}}
Keeper 재시작이 쿼럼을 잃었던 이력이 있습니다. 0.24.0은 이전 Keeper 파드가 Running 상태인지 확인하지 않고 순차 재시작했습니다. CHK 설정 변경 시 한 파드가 ContainerCreating인 동안 다음 파드가 Terminating으로 겹쳐 일시적 쿼럼 손실(테이블 read-only 전락)을 유발했습니다. 이 문제는 0.25.3(2025-08 보고)까지 잔존해 CHK PodDisruptionBudget도 준수하지 않았습니다. v0.26.1(2026-03-13)에서 수정됐습니다(issue #1598) `✓`. 마이그레이션·업그레이드 계획 시 최소 0.26.1 이상을 씁니다. 신규 도입이면 실무상 최신 0.27.x를 권장합니다.
{{< /callout >}}

## 복구 런북 — 노드 소실 재수화와 Keeper 정족수 상실

데이터 노드를 잃으면 다른 replica에서 파트를 받아 복구합니다. Keeper 과반을 잃으면 조정 계층부터 복구해야 합니다. 전자는 데이터 사본과 재전송 대역을, 후자는 Raft 로그·스냅샷과 정족수 상태를 확인하는 작업입니다.

### 노드 소실 · 재수화 (로컬 NVMe 핵심)

로컬 NVMe 노드가 사라지면 그 데이터는 영구 소실 → healthy replica에서 재수화합니다 `✓`.

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

재수화하려면 살아 있는 replica에 복구할 파트가 남아 있어야 합니다. replica 수와 anti-affinity만으로 ACK 직후 미복제 데이터까지 보존되지는 않습니다. RF2에서 한 대를 잃으면 해당 shard는 복구가 끝날 때까지 단일 사본이므로 같은 shard의 다른 노드를 교체하지 않습니다. PDB는 Eviction API 기반 중단을 제한할 뿐 모든 교체를 직렬화하지 않으므로 operator의 reconcile 순서와 복제 상태를 확인해야 합니다. 이 시간에 남은 사본까지 잃으면 replica에서 복구할 수 없습니다. RF3는 복제 완료된 파트의 사본을 더 남길 수 있지만, 실제 데이터 보존과 쓰기 지속은 쓰기 확인 조건에도 달려 있습니다([배포 플레이북 §RF 선택]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}})). 재수화 시간은 노드당 데이터를 작게(shard 수평 확장) 줄여 낮춥니다. TB당 정확한 소요는 스테이징에서 실측합니다 `?` — 창 자체의 정의와 두 레버는 [스토리지 · 로컬 NVMe]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})의 재수화 위험 창에 정리돼 있습니다. 관련 필드: `reconcile.statefulSet.recreate.onDataLoss: recreate`, `host.drop.replicas.onLostVolume: "yes"` + `active: "no"`, 자동복구 `reconcile.recovery.from.aborted.onPodReady: retry`(0.27.1).

### Keeper 정족수 상실

Keeper 3노드 중 2대 또는 5노드 중 3대를 잃으면 과반이 없어집니다. 이때 ClickHouse 데이터가 남아 있어도 신규 파트 등록과 복제 조정이 진행되지 않아 쓰기가 멈춥니다 `✓`. 정족수와 배치는 [CHK 설계]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}}), 관련 장애 양상은 [operator 설명]({{< relref "/data/clickhouse/deployment/03-operator.md" >}})과 [운영 사례]({{< relref "/data/clickhouse/operations/06-production-usecases.md" >}})를 참고합니다.

| 멈추는 것 | 견디는 것 |
|---|---|
| replication 조정·신규 파트 등록·replica 동기화 정지 | 이미 로컬에 있는 파트에 대한 **read 쿼리** |
| DDL(테이블 생성/변경) 차단 | 진행 중이던 조회의 완료 |
| INSERT — 파트 등록 불가라 사실상 read-only 전락 | |

```bash
# 1. 증상 식별 — CH가 read-only, DDL/INSERT 실패. Keeper 파드 상태·4LW로 리더 부재 확인
kubectl get pods -l "clickhouse-keeper.altinity.com/chk=analytics-keeper" -n clickhouse -o wide  # [미확인] 라벨 키 배포 후 확인
echo mntr | nc <keeper-pod> 2181 | grep zk_server_state    # leader/follower 확인(4LW, 0.27.0+)
# 2. 남은 Keeper 노드와 gp3 데이터 보존 확인 — gp3 영속이라 Raft 로그/스냅샷 생존
kubectl get pvc -l "clickhouse-keeper.altinity.com/chk=analytics-keeper" -n clickhouse
# 3. 소실 노드 재프로비저닝 → CHK가 server_id·Raft peer 재구성 → 과반 복구 시 쓰기 자동 재개
#    (CHK는 파드 복귀 시 자동 리컨사일; 수동 트리거가 필요하면 taskID patch [미확인] CHK 지원 여부 확인)
```

gp3 영속이 여기서 값을 합니다 — Keeper 데이터를 로컬 NVMe에 뒀다면 노드 소실이 곧 Raft 메타데이터 소실이라 정족수 재구성이 훨씬 번거롭습니다(그래서 배포 시점에 Keeper만은 gp3입니다). 남은 노드가 과반을 유지하는 한(3노드에서 1대만 잃음) 쓰기는 애초에 멈추지 않고 잃은 노드만 교체하면 자동 복구됩니다. 과반을 이미 잃었다면 살아있는 노드의 최신 스냅샷에서 앙상블을 재구성합니다.

## 모니터링·백업 연계

백업 사이드카와 메트릭 엔드포인트는 [배포 시점]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}})에 준비하지만, 백업 복원과 상태 수집은 지속적인 운영 작업입니다. 아래 설정 가운데 스케일·업그레이드 이벤트의 대시보드 연계는 별도 실측이 남아 있습니다 `?`.

- 백업 — clickhouse-backup 사이드카 → S3 `✓`: 로컬 NVMe는 휘발성이므로 복제 외에 S3 백업이 두 번째 방어선입니다. CHI podTemplate에 `altinity/clickhouse-backup` 컨테이너를 CH와 같은 pod에 추가(하드링크 백업), REST API `:7171`, `S3_PATH: backup/shard-{shard}`(operator `{shard}` 매크로로 shard당 1 백업), 자격증명은 IRSA. CronJob으로 각 shard 첫 replica에 접속해 `system.backup_actions`에 주간 full + 일간 incremental(`concurrencyPolicy: Forbid`). incremental 체인은 이전 백업 전체에 의존하므로 하나라도 손상되면 이후 복구가 불가합니다. S3 lifecycle로 base가 Glacier 되면 체인이 붕괴합니다 `✓⁽02 문서 기준⁾`(상세는 [스토리지 · 로컬 NVMe]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})의 내구성 3종 세트). operator가 백업 스케줄링이나 restore 자체를 관리하지는 않으니 백업/restore drill은 별도 CronJob 등으로 직접 소유해야 합니다 `≈`.
- PDB `✓`: operator 자동 생성. `pdbManaged: "yes"`(기본) + `pdbMaxUnavailable: 1`. CHK에서도 PDB 적용 범위와 실제 롤링 순서를 확인해 Keeper 과반이 유지되도록 합니다.
- 모니터링 `✓`: metrics-exporter `:8888/metrics`(`chi_clickhouse_metric_*`/`_event_*`), CHK `:7000`, 백업 사이드카 `:7171`. 0.27.0에서 노이즈성 per-CPU OS 메트릭이 기본 제외됐습니다(복구는 `excludeRegexp: []`). operator/CH가 Prometheus 메트릭을 노출한다는 사실 자체는 [operator 선택 페이지]({{< relref "/data/clickhouse/deployment/03-operator.md" >}}) 기준 `✓`입니다. 스케일 in/out·롤링 업그레이드 이벤트를 대시보드에서 추적하려면 CHI 리소스 상태(`Completed`/`InProgress`/`Aborted`)를 메트릭이나 이벤트로 별도 수집하는 편이 안전합니다 `≈` — operator가 이 상태 전이를 Prometheus 메트릭으로 직접 노출하는지는 이번 조사에서 확인하지 못했습니다 `?`.
- ArgoCD `ignoreDifferences` `✓`: operator가 CR 상태를 계속 갱신하고 일부 필드(예: `resourceFieldRef.divisor`)를 채워 넣어 GitOps 도구가 영구 OutOfSync diff를 보이는 이슈가 있었습니다(#958/#1799, `resourceFieldRef.divisor`는 0.27.1에서 수정) `✓`. ArgoCD `Application.spec.ignoreDifferences`에 `{group: clickhouse.altinity.com, kind: ClickHouseInstallation, jsonPointers: [/status]}`를 넣어 상태 필드를 무시하고 self-heal 사용 시 `syncOptions: [RespectIgnoreDifferences=true]`로 동기화 루프를 막습니다. operator는 0.27.1+를 권장합니다. Altinity가 제공하는 argocd-examples를 참고해 diff/self-heal을 신중히 설정합니다.

{{< callout type="warning" >}}
설정은 반드시 CHI `settings`/`files`로만 주입합니다. operator가 관리하는 설정과 외부에서 주입한 config가 충돌하면 CH 파드가 CrashLoop에 빠집니다 — ArgoCD로 Vault의 `named_collections.xml`을 외부 주입했다가 operator 렌더링과 충돌한 실제 이슈(#1456)가 있습니다 `✓`. 커스텀 `config.xml`은 `configuration.settings`(구조화) 또는 `configuration.files`(원본 XML)로, `users.xml`은 `configuration.users`/`profiles`/`quotas`로 선언하면 operator가 XML로 렌더링해 ConfigMap으로 마운트합니다 `✓`. GitOps로 운영하는 동안 이 규칙이 가장 자주 깨집니다.
{{< /callout >}}

이 영역은 클러스터 규모가 커질수록(특히 대규모 다중 클러스터) 운영 리스크가 커지니 도입 전에 따로 검증해야 합니다.

## 운영 시작 전 복구 리허설 {#우리-케이스에서는}

이 운영 예시는 1 shard × 3 replica와 CHK 3노드에서 시작합니다. 데이터가 늘면 노드당 복구 시간을 측정해 shard 추가 시점을 정합니다. 신규 shard에는 스키마를 확인하고 적재를 연결하며, 과거 데이터 이동 여부도 별도로 결정합니다. 규모와 복구 시간의 관계는 [스토리지 글]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})을 참고합니다.

서버 이미지와 신규 설정은 별도 reconcile로 변경합니다. operator는 검증된 minor 경로를 따라 올리고 CRD는 삭제하지 않습니다. replica를 제거한 뒤에는 파드가 없어졌는지만 보지 않고 Keeper의 등록 상태도 확인합니다.

운영 전에는 데이터 노드 소실과 Keeper 장애를 각각 재현해봅니다. 재수화 시간, 남은 replica의 쓰기 가능 여부, 복구 후 사본 수를 확인해야 SLA와 노드당 용량을 정할 수 있습니다. 시점 기준 2026-08.
