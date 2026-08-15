---
title: "변경관리·스케일·롤링 업그레이드·복구"
weight: 5
---

# 변경관리·스케일·롤링 업그레이드·복구

{{< callout type="info" >}}
**한눈에** — 이미 서 있는 Altinity operator 클러스터를 규모 변화·업그레이드·장애 앞에서 어떻게 바꾸고 되돌리나. 기준 버전은 **Altinity Kubernetes Operator 0.27.1**(2026-06-04).

- **스케일 out**은 자동 리밸런싱·스키마 전파가 없습니다 — 새 shard는 신규 insert만 받고, 스키마는 수동 생성해야 합니다(기존 shard의 replica 추가와는 다름).
- **스케일 in**은 활성 replica가 자동 drop되지는 않지만, 미검증 DROP REPLICA 버그 리드가 있어 제거 전 체크리스트로 수동 확인이 필요합니다.
- **operator 자체 업그레이드는 minor 단계별로만**, CRD는 절대 삭제 금지 — 삭제 시 관리 중인 모든 CHI/CHK가 연쇄 삭제됩니다.
- ClickHouse 버전 롤링은 **shard 내부는 순차, shard 간은 병렬** 가능하나 혼합 버전 호환 창은 약 1년(2 LTS 미만)입니다.
- **복구는 두 축이 독립**입니다 — 로컬 NVMe 데이터 경로 재수화와 Keeper 정족수 복구는 서로를 기다리지 않습니다.
{{< /callout >}}

[Altinity operator 선택]({{< relref "03-operator.md" >}})이 "어느 operator를 쓸지"를, [operator 배포 플레이북]({{< relref "04-deployment-playbook.md" >}})이 "로컬 NVMe 위에 **처음** 어떻게 배포하는지"(StorageClass·CHK/CHI 매니페스트 전문·필드 레벨 티어링)를 다뤘다면, 이 페이지는 **배포 이후의 변경 관리와 복구**를 다룹니다 — 규모가 달라질 때의 구성 관점, 스케일 in/out, ClickHouse 버전·operator 자체·Keeper의 롤링 업그레이드, 노드 소실 재수화와 Keeper 정족수 상실, 그리고 백업·모니터링·GitOps 연계입니다. 두 페이지의 경계는 **시간축**입니다: 배포 시점의 선언 필드는 04가, 서고 난 뒤 그 필드를 움직이는 절차는 이 페이지가 소유합니다. 선택 근거·operator 2종 공존·Keeper 배치 근거·배포 매니페스트 상세는 반복하지 않고 relref로 위임합니다. 기준 버전은 **Altinity Kubernetes Operator 0.27.1**(2026-06-04 릴리스)이며, 2026-07-15 확인 시점에도 최신 릴리스입니다 `✓`.

## 규모별 CHI/CHK 구성 패턴

CHI(`ClickHouseInstallation`) manifest는 replica를 하나하나 선언하지 않고 `layout.shardsCount`/`layout.replicasCount`로 토폴로지를 선언합니다 — operator가 이를 StatefulSet/파드 집합으로 자동 확장합니다 `✓`. Keeper/ZooKeeper 연결은 두 방식이 있습니다: ① `spec.configuration.zookeeper.nodes`에 host:port를 명시하는 고전 방식, ② CHK(`ClickHouseKeeperInstallation`)를 이름으로 직접 참조하는 방식(0.27.0부터 GA 수준) `✓`. 아래 스니펫은 ①번 명시 방식으로 작성했습니다 — ②번의 정확한 필드 문법은 버전마다 바뀔 수 있어 도입 시점의 CHK 문서로 재확인을 권합니다 `?`.

### 소규모 — 1 shard × 2~3 replica + CHK 3노드

[operator 선택 페이지의 손익분기점 표]({{< relref "03-operator.md" >}})가 말하는 "HA 시작점"에 해당합니다. CHK 3노드를 먼저 배포합니다 — CHK 매니페스트 전문(gp3 영속 볼륨·probe·PDB 포함)은 [배포 플레이북 §CHK]({{< relref "04-deployment-playbook.md" >}})에 있으므로 반복하지 않습니다. 여기서는 규모 관점에서 달라지는 CHI의 뼈대만 봅니다 — CHI는 Keeper를 `zookeeper.nodes`로 명시 참조합니다.

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

`podDistribution`의 `ClickHouseAntiAffinity`+`topologyKey: kubernetes.io/hostname`는 같은 shard의 replica 2개가 한 노드에 co-locate되는 것을 막는 [필수 전제]({{< relref "03-operator.md" >}})를 구현한 것입니다 — 이 anti-affinity 없이 로컬 NVMe를 쓰면 그 노드 장애 시 shard 전체가 죽습니다 `✓`.

### 중규모 — 수 shard × 2~3 replica

소규모 CHI에서 달라지는 부분만 표시합니다.

```yaml
    clusters:
      - name: analytics
        layout:
          shardsCount: 3
          replicasCount: 2
```

이 규모부터 auto-generated PDB의 함정이 나타납니다. operator는 클러스터당 기본 `maxUnavailable: 1`짜리 PDB를 자동 생성하는데, 노드당 ClickHouse 파드를 2개 이상 배치하는 토폴로지(예: 3 shard × 2 replica를 3노드에)에서는 이 PDB가 롤링 업데이트를 막는 사례가 보고됐습니다 `≈`. Altinity 메인테이너가 제시한 해법은 PDB 설정을 바꾸는 대신 `podDistribution` 타입을 `CircularReplication`으로 바꿔 파드 배치 자체를 조정하는 것입니다 `≈`.

### 대규모 — 수십 노드·다중 클러스터

역시 달라지는 부분만.

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

이 규모에서 설정 변경은 shard 수가 많으면 operator가 **staged rollout**으로 처리합니다 — 변경을 첫 shard(모든 replica) 전체에 먼저 순차 probe해 성공을 확인한 뒤에만 나머지 shard의 최대 50%까지 동시 적용합니다. 이 동시 적용 비율은 operator 설정 값 `reconcileShardsThreadsNumber`/`reconcileShardsMaxConcurrencyPercent`(기본 50%)로 제어됩니다 `✓`. 첫 shard가 실패하면 나머지에는 아예 전파되지 않으므로, 대규모 클러스터에서 설정 변경의 조기 경보(early warning) 역할을 합니다.

## 스케일 out

`layout.shardsCount`를 늘리고 `kubectl apply`로 재적용하면 operator가 새 shard의 StatefulSet/파드를 생성합니다 `✓`. 여기서 반드시 알아야 할 것 두 가지.

- **자동 리밸런싱은 없다.** ClickHouse는 기존 데이터를 새 shard로 자동 재분배하지 않는다. Distributed 테이블은 신규 insert만 전체 shard에 분산할 뿐이고, 과거 데이터는 원래 shard에 그대로 남는다 `✓`. 기존 데이터를 옮기려면 partition detach/attach, `INSERT ... SELECT`, 또는 clickhouse-copier를 수동으로 써야 한다 `✓`. 실무 대응은 셋 중 하나다 — ① **shard weight 편중**(append-only 관측성에 최적, 기존 데이터 이동 불필요), ② `INSERT INTO SELECT` **재수집**(균등 분포가 필요한 범용 분석. 대용량이면 무거움), ③ 파트 수동 이동(대규모엔 비현실적). **초기 shard 수를 넉넉히** 잡아 리샤딩 빈도를 낮추는 게 최선이다.
- **신규 shard에 스키마가 자동 전파된다고 가정하지 마라.** "새 shard가 원래 shard와 같은 DB/테이블 구성을 자동으로 갖는다"는 주장은 딥리서치 적대검증에서 3-0으로 **기각**됐다 — 일반적인 경우 신규 shard에는 테이블 스키마를 별도로 생성해줘야 한다 `✓⁽기각 근거 반영⁾`. 이는 기존 shard에 **replica**를 추가하는 경우와 다르다 — 혼동하지 말 것.

**replica 추가는 반대로 거의 전자동입니다** `✓`. `replicasCount++` 후 apply하면 operator가 새 host/STS/PVC를 만들고 → **스키마를 자동 전파**하고([operator 선택 페이지]({{< relref "03-operator.md" >}}) 기준 `✓`) → `remote_servers`를 자동 갱신하고 → `reconcile.host.wait.replicas.new: "yes"`로 신규 replica가 따라잡을 때까지 다음 단계를 대기합니다. 함정은 특정 조작 순서에서 스키마 auto-creation이 동작하지 않은 사례(#1500/#1602)입니다 — **스케일은 반드시 CHI를 통해 정해진 순서로** 합니다. 필드 자체의 정의는 [배포 플레이북 §자주 조정하는 CHI 옵션]({{< relref "04-deployment-playbook.md" >}})에 있습니다.

## 스케일 in

replica/shard 제거는 scale-out보다 위험이 큽니다.

- **활성(active) replica는 절대 자동으로 drop되지 않는다**(0.25.5 안전장치) — 상세는 [operator 선택 페이지]({{< relref "03-operator.md" >}}) 참조. drop 세부 동작은 `onDelete`/`onLostVolume`/`active` 플래그로 설정 가능하다(0.25.5 changelog) `✓/≈`.
- **볼륨 재프로비저닝이 필요한 경우**(디스크 손상 등으로 PV를 직접 지워야 할 때), 신뢰할 수 있는 절차로 보고된 것은 두 가지뿐이다 — ① PVC와 StatefulSet을 함께 삭제, ② PV 삭제 후 파드를 재시작해 PV unbind를 강제. 둘 다 operator가 스토리지와 스키마를 정상적으로 재생성한다고 보고됐다 `✓/≈`. 이 순서를 벗어난 임의 조작(예: STS는 그대로 두고 PV만 삭제)은 파드가 ephemeral 스토리지로 뜨거나 스키마가 비어있는 채로 남는 등 race condition을 유발한 사례가 있다 `≈`.
- **PVC는 `helm uninstall`로 삭제되지 않는다**(데이터 보호) `✓`. EBS 계열에서는 `reclaimPolicy: Retain`이 churn·재생성 시 데이터를 지키는 직접적 의미가 크고(문서 예제는 `Delete`), 로컬 NVMe에서는 데이터가 어차피 노드와 함께 사라지므로 "PVC를 지워도 STS만 재생성되게" 하는 **운영상 보호 용도**로 쓴다 `≈`. 노드를 회수하기 전에 이 값을 반드시 확인한다.

{{< callout type="warning" >}}
**미해결 버그 리드**: GitHub 이슈 기반의 미검증 리드에 따르면, replica 제거 시 operator의 정리(cleanup) 로직이 shard의 첫 replica(`*-0`, `shard.FirstHost()`)를 통해 `SYSTEM DROP REPLICA`를 실행하도록 하드코딩돼 있어, 제거 대상이 `*-0`이 아니거나 `*-0` 자신이 마침 복구 중(재수화 중이라 Keeper 메타데이터가 없는 상태)이면 엉뚱한 replica 이름에 DROP 명령이 나가거나 명령 자체가 실패한다는 보고가 있습니다 `≈`. Kubernetes 상 StatefulSet/파드 자체는 정상적으로 정리되므로, 겉보기엔 scale-in이 끝난 것처럼 보여도 ZooKeeper/Keeper에 stale 메타데이터가 남을 수 있다는 뜻입니다. 이 리드는 3-vote 검증을 거치지 않았으므로 실제 영향 범위는 도입 시점에 재확인이 필요합니다.

**scale-in 전 체크리스트**:
1. 제거 대상 replica의 replication lag가 0에 수렴했는지 확인
2. 제거 대상이 shard의 유일한 온라인 replica가 아닌지 확인
3. `kubectl apply` 후 ZooKeeper/Keeper 경로(`/clickhouse/{cluster}/tables/...`)에 제거된 replica 흔적이 실제로 정리됐는지 수동 확인(위 미해결 리드 때문에 자동 정리를 100% 신뢰하지 않는다)
4. 노드 자체를 회수하기 전에 PVC `reclaimPolicy`가 `Retain`인지 재확인
{{< /callout >}}

## ClickHouse 버전 롤링 업그레이드 런북

여기서 말하는 "업그레이드"는 operator 자체가 아니라 **ClickHouse 서버 바이너리 버전**입니다 — 독립된 관심사입니다. 실행 트리거는 podTemplate 이미지 태그를 바꿔 apply하는 것이고, 그다음은 operator가 replica를 하나씩 롤링합니다 `✓`.

1. shard **내부**에서는 replica를 한 번에 하나씩만 처리한다: 해당 replica의 ClickHouse를 shutdown → 새 버전으로 업그레이드 → 재기동 → Keeper 메시지로 시스템 안정을 확인 → 다음 replica로 이동. shard 전체가 동시에 오프라인이 되는 순간이 없어야 한다 `✓`.
2. shard **간**에는 병렬 업그레이드가 허용된다 — "한 shard의 모든 replica가 동시에 오프라인"이 되지만 않으면, 서로 다른 shard의 replica를 동시에 업그레이드해도 된다 `✓`.
3. **혼합 버전 호환 창은 약 1년(또는 2 LTS 미만)이다.** 그 이상 벌어진 버전 간에는 mixed-version 상태로 롤링을 진행하지 말고, 다운타임을 감수한 일괄 업그레이드를 하거나 중간 버전을 경유해야 한다 `✓`. **버전 스킵은 금지**이며, 중간 릴리즈 노트를 LTS 징검다리로 순차 확인한다.
4. 이 순서를 operator가 어떻게 자동화하는지 — 롤링 중 replica를 `remote_servers`에서 완전히 빼는 대신 분산쿼리 우선순위를 낮추는(low-priority) 처리로 트래픽을 차단하는 것 등 — 는 [operator 선택 페이지]({{< relref "03-operator.md" >}})에서 다룬 내용을 그대로 따른다. 두 안전장치가 함께 걸린다: **PDB**(`pdbMaxUnavailable: 1`)가 동시 다운을 막고, `reconcile.host.wait.replicas`가 catch-up 게이팅을 한다. 다만 위 1년/2 LTS 호환 창 자체는 operator가 강제하는 것이 아니라 **운영자가 직접 지켜야 하는 규칙**이다 — operator는 어떻게 순차 롤링할지를 돕지만, 얼마나 버전 차이를 벌려도 되는지는 판단해주지 않는다.

## operator 자체 업그레이드 런북

Altinity operator는 **minor 버전 단계별 업그레이드만 지원**합니다(예: 0.26→0.27) — 여러 minor를 건너뛰는 경로는 CI로 검증되지 않으므로, 오래된 버전에서 온다면 단계별로 순차 업그레이드합니다 `✓`. **CRD는 Helm이 건드리지 않으므로 별도 단계로 apply**합니다(`kubectl apply -f .../crd.yaml`).

{{< callout type="error" >}}
**절대 금지: CRD 삭제.** operator 업그레이드 중 어떤 경우에도 CustomResourceDefinition을 삭제하지 마십시오 — Kubernetes가 해당 CRD에 속한 모든 `chi`/`chk` 리소스를 연쇄 삭제하려 시도합니다. 즉 관리 중인 모든 ClickHouse/Keeper 클러스터가 삭제 대상이 됩니다 `✓`.
{{< /callout >}}

**operator 업그레이드는 반드시 스테이징에서 먼저 검증합니다.** operator 자체 업그레이드가 리컨사일 동작을 바꿔 예기치 않은 롤링 재시작을 유발할 수 있습니다 — RollingUpdate 중 CrashLoopBackOff(0.26.3 수정), 동시 config+version 업데이트 race(0.26.2 수정) 같은 회귀 이력이 있습니다 `✓`. STS를 scale-to-0 없이 삭제하면 스키마가 재생성되지 않는 등 특정 조작 순서에서 나는 엣지 버그(#1500, #1602)도 여기 속합니다 `✓`.

알려진 업그레이드 함정 두 가지:

- **(a) 이미지+설정 동시 변경 시 crash (v0.24.3, issue #1926).** 이 버전대의 reconcile 순서는 ConfigMap을 새 버전 설정값으로 먼저 갱신한 뒤 `SYSTEM SHUTDOWN`으로 파드를 재기동시킨다. 이미지 업그레이드와 새 설정 변경을 한 reconcile에 같이 넣으면, 파드가 **구 이미지 + 신 ConfigMap** 조합으로 재시작해 인식 못 하는 설정값 때문에 crash할 수 있다(PR #1956에서 순서 수정) `✓`. 교훈: 이미지 업그레이드와 신규 설정 변경은 별도 reconcile로 분리한다. 이 원칙을 넘어서는 공식 가이드가 별도로 확인되지는 않았다 `?`.
- **(b) 0.27.1 업그레이드 후 감춰졌던 실패가 표면화.** 이전 버전에서는 특정 실패(호스트가 `Replicas=0`인데 CHI는 reconciled로 보고되는 상태)가 조용히 삼켜졌으나, 0.27.1부터는 첫 reconcile에서 이런 CHI가 정확히 `Aborted` 상태로 전환된다. 복구하려면 CHI spec을 재적용(re-apply)해 informer 재reconcile을 트리거한다 `✓`.

안전장치 3층(버전순):

- **STS recreate 정책**(0.26.0) — `reconcile.statefulSet.recreate.onUpdateFailure: abort | recreate`: 실패한 StatefulSet 업데이트를 그대로 둘지(abort) 재생성할지(recreate) 선택한다 `✓`.
- **aborted reconcile 자동 재개**(0.27.0) — `reconcile.recovery.from.aborted.onPodReady`: 실패했던 파드가 다시 Ready가 되면 중단된 reconcile을 자동 재개한다. 단 모든 파드가 Ready인 채로 발생하는 일시적 K8s API 오류는 이 범위 밖이다 `✓`.
- **pre/post SQL 훅**(0.27.0, 실험적) — `HostCreate`/`HostShutdown`/`HostRollout`/`HostDelete` 등 이벤트에 SQL을 주입한다(예: `HostShutdown`에 `SYSTEM STOP REPLICATION QUEUES`). 대상은 `FirstHost`/`AllHosts`/`AllShards`, `failurePolicy: Fail | Ignore` `✓`. 매니페스트 선언 형태는 [배포 플레이북 §reconcile hooks]({{< relref "04-deployment-playbook.md" >}}).

## Keeper(CHK) 업그레이드

0.26.x→0.27.0 경로에서는 **데이터 마이그레이션이 필요 없습니다.** operator가 렌더링하는 keeper 설정(4-letter-word whitelist 추가, liveness probe가 `pgrep`에서 `ruok`/`imok` 4LW로 전환)만 바뀌므로, 기존 Keeper 파드는 startup probe로 게이트된 **순차 롤링**으로 재기동됩니다 `✓`. (0.23.x에서 오는 경우는 예외로, 수동 PV 마이그레이션이 필요하다고 별도 문서화돼 있습니다 `✓`.) 3노드 쿼럼 전제·정족수 산술·분리 배치 근거는 [배포 플레이북 §CHK]({{< relref "04-deployment-playbook.md" >}})를 참조합니다.

{{< callout type="warning" >}}
**Keeper 재시작이 쿼럼을 잃었던 이력이 있습니다.** 0.24.0은 이전 Keeper 파드가 Running 상태인지 확인하지 않고 순차 재시작해, CHK 설정 변경 시 한 파드가 ContainerCreating인 동안 다음 파드가 Terminating으로 겹쳐 **일시적 쿼럼 손실**(테이블 read-only 전락)을 유발했습니다. 이 문제는 0.25.3(2025-08 보고)까지 잔존해 CHK PodDisruptionBudget도 준수하지 않았고, **v0.26.1(2026-03-13)에서 수정**됐습니다(issue #1598) `✓`. 마이그레이션·업그레이드 계획 시 **최소 0.26.1 이상**을 쓰고, 신규 도입이면 실무상 최신 0.27.x를 권장합니다.
{{< /callout >}}

## 복구 런북 — 노드 소실 재수화와 Keeper 정족수 상실

배포 시점 설계가 아무리 맞아도 노드는 죽습니다. 두 시나리오는 **서로 독립적**이라 별개 런북으로 다룹니다 — 데이터 노드가 멀쩡해도 Keeper 정족수만으로 전체 쓰기가 멈출 수 있고, 그 반대도 성립합니다.

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

무손실 재수화는 **shard당 replica ≥ 2 + anti-affinity**가 전제입니다. replica=2에서 1노드 소실 시 그 shard는 재수화 완료까지 단일 사본이므로 **동시에 여러 노드를 교체하지 말 것**(`pdbMaxUnavailable: 1`이 강제). 단 이는 **동시(자발적) 중단**만 막습니다 — RF2에서 재수화 창(수 시간) 동안 그 shard는 실질 RF1(단일 사본)이라, 이 창 안에 같은 shard의 다른 replica가 **시간차 독립 하드웨어 장애**로 죽으면 shard가 소실됩니다. anti-affinity·PDB는 이 2차 타격을 못 막고, 유일한 방어는 **RF3**(창 동안에도 2사본 유지 → 2차 장애 생존)입니다([배포 플레이북 §RF 선택]({{< relref "04-deployment-playbook.md" >}})). 재수화 시간은 노드당 데이터를 작게(shard 수평 확장) 줄이고, TB당 정확한 소요는 스테이징에서 실측합니다 `?` — 창 자체의 정의와 두 레버는 [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}})의 재수화 위험 창이 정본입니다. 관련 필드: `reconcile.statefulSet.recreate.onDataLoss: recreate`, `host.drop.replicas.onLostVolume: "yes"` + `active: "no"`, 자동복구 `reconcile.recovery.from.aborted.onPodReady: retry`(0.27.1).

### Keeper 정족수 상실

Keeper가 과반을 잃으면(3노드 중 2대·5노드 중 3대 소실, 산술은 [배포 플레이북 §CHK '정족수 산술']({{< relref "04-deployment-playbook.md" >}})) 클러스터는 조정 불능에 빠집니다 — 노드 데이터가 멀쩡해도 **쓰기 경로가 멈춥니다** `✓`. 데이터 경로가 아닌 소규모 조정 계층이 전체 쓰기 가용성의 SPOF가 되는 지점입니다. 흩어진 서술(2노드 정족수 함정 [operator 페이지]({{< relref "03-operator.md" >}}), read-only 전락 [프로덕션 사례]({{< relref "06-production-usecases.md" >}}) 안티패턴 #5)을 이 절이 참조해 한 곳에 통합합니다.

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

**gp3 영속이 핵심**입니다 — Keeper 데이터를 로컬 NVMe에 뒀다면 노드 소실이 곧 Raft 메타데이터 소실이라 정족수 재구성이 훨씬 번거롭습니다(그래서 배포 시점에 Keeper만은 gp3입니다). 남은 노드가 과반을 유지하는 한(3노드에서 1대만 잃음) 쓰기는 애초에 멈추지 않고 잃은 노드만 교체되면 자동 복구됩니다. 과반을 이미 잃었다면 살아있는 노드의 최신 스냅샷에서 앙상블을 재구성합니다.

## 모니터링·백업 연계

배포 시점에 사이드카·PDB·메트릭 엔드포인트를 심는 것은 [배포 플레이북]({{< relref "04-deployment-playbook.md" >}})의 체크리스트지만, 그 뒤로 계속 손이 가는 **운영 연계**는 이 절이 소유합니다. 스케일·업그레이드 이벤트를 관측하는 부분은 이번 딥리서치 라운드에서 전용 검증이 이뤄지지 않았습니다 `?`.

- **백업 — clickhouse-backup 사이드카 → S3** `✓`: 로컬 NVMe는 휘발성이므로 복제 외에 S3 백업이 두 번째 방어선이다. CHI podTemplate에 `altinity/clickhouse-backup` 컨테이너를 CH와 같은 pod에 추가(하드링크 백업), REST API `:7171`, `S3_PATH: backup/shard-{shard}`(operator `{shard}` 매크로로 **shard당 1 백업**), 자격증명은 IRSA. CronJob으로 각 shard 첫 replica에 접속해 `system.backup_actions`에 주간 full + 일간 incremental(`concurrencyPolicy: Forbid`). **incremental 체인은 이전 백업 전체에 의존**하므로 하나라도 손상되면 이후 복구가 불가하고, S3 lifecycle로 base가 Glacier 되면 체인이 붕괴한다 `✓⁽02 문서 기준⁾`(상세는 [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}})의 내구성 3종 세트). operator가 백업 스케줄링이나 restore 자체를 관리하지는 않으므로, 백업/restore drill은 별도 CronJob 등으로 **직접 소유**해야 한다 `≈`.
- **PDB** `✓`: operator 자동 생성. `pdbManaged: "yes"`(기본) + `pdbMaxUnavailable: 1`. CHK도 동일 필드로 Keeper 정족수를 보호한다.
- **모니터링** `✓`: metrics-exporter `:8888/metrics`(`chi_clickhouse_metric_*`/`_event_*`), CHK `:7000`, 백업 사이드카 `:7171`. 0.27.0에서 노이즈성 per-CPU OS 메트릭이 기본 제외됐다(복구는 `excludeRegexp: []`). operator/CH가 Prometheus 메트릭을 노출한다는 사실 자체는 [operator 선택 페이지]({{< relref "03-operator.md" >}}) 기준 `✓`이지만, 스케일 in/out·롤링 업그레이드 이벤트를 대시보드에서 추적하려면 CHI 리소스 상태(`Completed`/`InProgress`/`Aborted`)를 메트릭이나 이벤트로 **별도 수집**하는 편이 안전하다 `≈` — operator가 이 상태 전이를 Prometheus 메트릭으로 직접 노출하는지는 이번 조사에서 확인하지 못했다 `?`.
- **ArgoCD `ignoreDifferences`** `✓`: operator가 CR 상태를 계속 갱신하고 일부 필드(예: `resourceFieldRef.divisor`)를 채워 넣어 GitOps 도구가 **영구 OutOfSync diff**를 보이는 이슈가 있었다(#958/#1799, `resourceFieldRef.divisor`는 0.27.1에서 수정) `✓`. ArgoCD `Application.spec.ignoreDifferences`에 `{group: clickhouse.altinity.com, kind: ClickHouseInstallation, jsonPointers: [/status]}`를 넣어 상태 필드를 무시하고, self-heal 사용 시 `syncOptions: [RespectIgnoreDifferences=true]`로 동기화 루프를 막는다. operator는 **0.27.1+를 권장**하고, Altinity가 제공하는 argocd-examples를 참고해 diff/self-heal을 신중히 설정한다.

{{< callout type="warning" >}}
**설정은 반드시 CHI `settings`/`files`로만 주입합니다.** operator가 관리하는 설정과 외부에서 주입한 config가 충돌하면 CH 파드가 CrashLoop에 빠집니다 — ArgoCD로 Vault의 `named_collections.xml`을 외부 주입했다가 operator 렌더링과 충돌한 실제 이슈(#1456)가 있습니다 `✓`. 커스텀 `config.xml`은 `configuration.settings`(구조화) 또는 `configuration.files`(원본 XML)로, `users.xml`은 `configuration.users`/`profiles`/`quotas`로 선언하면 operator가 XML로 렌더링해 ConfigMap으로 마운트합니다 `✓`. GitOps로 운영하는 동안 이 규칙이 가장 자주 깨집니다.
{{< /callout >}}

이 영역은 클러스터 규모가 커질수록(특히 대규모 다중 클러스터) 운영 리스크가 커지는 지점이므로, 도입 전 별도 검증이 필요합니다.

## 우리 케이스에서는

**소규모(1 shard × 3 replica) + CHK 3노드**로 시작합니다 — 위 소규모 스니펫이 그 뼈대입니다. RUM 데이터가 성장해 노드당 데이터량이 커지면 — 기준은 고정 숫자가 아니라 [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}})의 재수화 논리입니다: 노드 하나를 재수화하는 시간이 replica 여유도를 위협하기 시작하는 지점 — `layout.shardsCount`를 늘리는 스케일 out 경로로 넘어가되, 신규 shard의 스키마는 수동으로 생성하고 과거 데이터는 옮기지 않는다는 전제를 팀 룰로 못박습니다.

업그레이드 룰 세 가지를 고정합니다: ① ClickHouse 이미지 업그레이드와 새 설정 변경은 항상 별도 reconcile로 분리합니다(v0.24.3 함정 회피), ② operator 자체는 minor 단계별로만 올립니다(0.26→0.27처럼) — 건너뛰지 않습니다, ③ CRD는 어떤 상황에서도 삭제하지 않습니다. scale-in은 이 페이지의 체크리스트를 통과할 때만 진행하고, 미해결 DROP REPLICA 리드를 고려해 제거 후 ZooKeeper/Keeper 경로를 수동으로 한 번 더 확인합니다. 복구는 스테이징에서 노드 소실 리허설을 한 번 돌려 TB당 재수화 시간을 실측한 뒤에야 프로덕션 SLA를 말합니다 `?`. 시점 기준 2026-08.
