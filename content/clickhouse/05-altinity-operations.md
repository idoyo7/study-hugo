---
title: "Altinity operator 운영 — 규모별 구성·스케일링·롤링 업그레이드"
weight: 5
---

# Altinity operator 운영 — 규모별 구성·스케일링·롤링 업그레이드

[Altinity operator 선택]({{< relref "03-operator.md" >}})이 "어느 operator를 쓸지"를, [operator 배포 플레이북]({{< relref "04-deployment-playbook.md" >}})이 "로컬 NVMe 위에 처음 어떻게 배포하는지"(StorageClass·CHK/CHI 매니페스트 전문·티어링·노드 소실 재수화)를 다뤘다면, 이 페이지는 **배포 이후의 변경 관리** — 규모가 달라질 때의 구성 관점, 스케일 in/out, ClickHouse 버전·operator 자체·Keeper의 롤링 업그레이드 — 를 다룬다. 선택 근거·operator 2종 공존·Keeper 배치 근거·배포 매니페스트 상세는 반복하지 않고 relref로 위임한다. 기준 버전은 **Altinity Kubernetes Operator 0.27.1**(2026-06-04 릴리스)이며, 2026-07-15 확인 시점에도 최신 릴리스다 `[확인됨]`.

## 규모별 CHI/CHK 구성 패턴

CHI(`ClickHouseInstallation`) manifest는 replica를 하나하나 선언하지 않고 `layout.shardsCount`/`layout.replicasCount`로 토폴로지를 선언한다 — operator가 이를 StatefulSet/파드 집합으로 자동 확장한다 `[확인됨]`. Keeper/ZooKeeper 연결은 두 방식이 있다: ① `spec.configuration.zookeeper.nodes`에 host:port를 명시하는 고전 방식, ② CHK(`ClickHouseKeeperInstallation`)를 이름으로 직접 참조하는 방식(0.27.0부터 GA 수준) `[확인됨]`. 아래 스니펫은 ①번 명시 방식으로 작성했다 — ②번의 정확한 필드 문법은 버전마다 바뀔 수 있어 도입 시점의 CHK 문서로 재확인을 권한다 `[미확인]`.

### 소규모 — 1 shard × 2~3 replica + CHK 3노드

[operator 선택 페이지의 손익분기점 표]({{< relref "03-operator.md" >}})가 말하는 "HA 시작점"에 해당한다. CHK 3노드를 먼저 배포한다 — CHK 매니페스트 전문(gp3 영속 볼륨·probe·PDB 포함)은 [배포 플레이북 §CHK]({{< relref "04-deployment-playbook.md" >}})에 있으므로 반복하지 않는다. 여기서는 규모 관점에서 달라지는 CHI의 뼈대만 본다 — CHI는 Keeper를 `zookeeper.nodes`로 명시 참조한다.

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

`podDistribution`의 `ClickHouseAntiAffinity`+`topologyKey: kubernetes.io/hostname`는 같은 shard의 replica 2개가 한 노드에 co-locate되는 것을 막는 [필수 전제]({{< relref "03-operator.md" >}})를 구현한 것이다 — 이 anti-affinity 없이 로컬 NVMe를 쓰면 그 노드 장애 시 shard 전체가 죽는다 `[확인됨]`.

### 중규모 — 수 shard × 2~3 replica

소규모 CHI에서 달라지는 부분만 표시한다.

```yaml
    clusters:
      - name: analytics
        layout:
          shardsCount: 3
          replicasCount: 2
```

이 규모부터 auto-generated PDB의 함정이 나타난다. operator는 클러스터당 기본 `maxUnavailable: 1`짜리 PDB를 자동 생성하는데, 노드당 ClickHouse 파드를 2개 이상 배치하는 토폴로지(예: 3 shard × 2 replica를 3노드에)에서는 이 PDB가 롤링 업데이트를 막는 사례가 보고됐다 `[추정]`. Altinity 메인테이너가 제시한 해법은 PDB 설정을 바꾸는 대신 `podDistribution` 타입을 `CircularReplication`으로 바꿔 파드 배치 자체를 조정하는 것이다 `[추정]`.

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

전용 노드풀(`nodeSelector`/`tolerations`)과 앞서 쓴 `podDistribution`/`volumeClaimTemplates`을 병행한다. 다중 클러스터는 하나의 CHI 안에 `clusters` 배열 항목을 여러 개 두거나, 클러스터별로 CHI를 분리해 운영한다.

이 규모에서 설정 변경은 shard 수가 많으면 operator가 **staged rollout**으로 처리한다 — 변경을 첫 shard(모든 replica) 전체에 먼저 순차 probe해 성공을 확인한 뒤에만 나머지 shard의 최대 50%까지 동시 적용한다. 이 동시 적용 비율은 operator 설정 값 `reconcileShardsThreadsNumber`/`reconcileShardsMaxConcurrencyPercent`(기본 50%)로 제어된다 `[확인됨]`. 첫 shard가 실패하면 나머지에는 아예 전파되지 않으므로, 대규모 클러스터에서 설정 변경의 조기 경보(early warning) 역할을 한다.

## 스케일 out

`layout.shardsCount`를 늘리고 `kubectl apply`로 재적용하면 operator가 새 shard의 StatefulSet/파드를 생성한다 `[확인됨]`. 여기서 반드시 알아야 할 것 두 가지.

- **자동 리밸런싱은 없다.** ClickHouse는 기존 데이터를 새 shard로 자동 재분배하지 않는다. Distributed 테이블은 신규 insert만 전체 shard에 분산할 뿐이고, 과거 데이터는 원래 shard에 그대로 남는다 `[확인됨]`. 기존 데이터를 옮기려면 partition detach/attach, `INSERT ... SELECT`, 또는 clickhouse-copier를 수동으로 써야 한다 `[확인됨]`.
- **신규 shard에 스키마가 자동 전파된다고 가정하지 마라.** "새 shard가 원래 shard와 같은 DB/테이블 구성을 자동으로 갖는다"는 주장은 딥리서치 적대검증에서 3-0으로 **기각**됐다 — 일반적인 경우 신규 shard에는 테이블 스키마를 별도로 생성해줘야 한다 `[확인됨, 기각 근거 반영]`. 이는 기존 shard에 **replica**를 추가하는 경우([operator 선택 페이지]({{< relref "03-operator.md" >}}) 기준 자동 스키마 전파가 `[확인됨]`)와 다르다 — 혼동하지 말 것.

## 스케일 in

replica/shard 제거는 scale-out보다 위험이 크다.

- **활성(active) replica는 절대 자동으로 drop되지 않는다**(0.25.5 안전장치) — 상세는 [operator 선택 페이지]({{< relref "03-operator.md" >}}) 참조. drop 세부 동작은 `onDelete`/`onLostVolume`/`active` 플래그로 설정 가능하다(0.25.5 changelog) `[확인됨/추정]`.
- **미해결 버그 리드(경고)**: GitHub 이슈 기반의 미검증 리드에 따르면, replica 제거 시 operator의 정리(cleanup) 로직이 shard의 첫 replica(`*-0`, `shard.FirstHost()`)를 통해 `SYSTEM DROP REPLICA`를 실행하도록 하드코딩돼 있어, 제거 대상이 `*-0`이 아니거나 `*-0` 자신이 마침 복구 중(재수화 중이라 Keeper 메타데이터가 없는 상태)이면 엉뚱한 replica 이름에 DROP 명령이 나가거나 명령 자체가 실패한다는 보고가 있다 `[추정]`. Kubernetes 상 StatefulSet/파드 자체는 정상적으로 정리되므로, 겉보기엔 scale-in이 끝난 것처럼 보여도 ZooKeeper/Keeper에 stale 메타데이터가 남을 수 있다는 뜻이다. 이 리드는 3-vote 검증을 거치지 않았으므로 실제 영향 범위는 도입 시점에 재확인이 필요하다.
- **scale-in 전 체크리스트**: (1) 제거 대상 replica의 replication lag가 0에 수렴했는지 확인, (2) 제거 대상이 shard의 유일한 온라인 replica가 아닌지 확인, (3) `kubectl apply` 후 ZooKeeper/Keeper 경로(`/clickhouse/{cluster}/tables/...`)에 제거된 replica 흔적이 실제로 정리됐는지 수동 확인(위 미해결 리드 때문에 자동 정리를 100% 신뢰하지 않는다), (4) 노드 자체를 회수하기 전에 PVC `reclaimPolicy`가 `Retain`인지 재확인.
- **볼륨 재프로비저닝이 필요한 경우**(디스크 손상 등으로 PV를 직접 지워야 할 때), 신뢰할 수 있는 절차로 보고된 것은 두 가지뿐이다 — ① PVC와 StatefulSet을 함께 삭제, ② PV 삭제 후 파드를 재시작해 PV unbind를 강제. 둘 다 operator가 스토리지와 스키마를 정상적으로 재생성한다고 보고됐다 `[확인됨/추정]`. 이 순서를 벗어난 임의 조작(예: STS는 그대로 두고 PV만 삭제)은 파드가 ephemeral 스토리지로 뜨거나 스키마가 비어있는 채로 남는 등 race condition을 유발한 사례가 있다 `[추정]`.

## ClickHouse 버전 롤링 업그레이드 런북

여기서 말하는 "업그레이드"는 operator 자체가 아니라 **ClickHouse 서버 바이너리 버전**이다 — 독립된 관심사다.

1. shard **내부**에서는 replica를 한 번에 하나씩만 처리한다: 해당 replica의 ClickHouse를 shutdown → 새 버전으로 업그레이드 → 재기동 → Keeper 메시지로 시스템 안정을 확인 → 다음 replica로 이동. shard 전체가 동시에 오프라인이 되는 순간이 없어야 한다 `[확인됨]`.
2. shard **간**에는 병렬 업그레이드가 허용된다 — "한 shard의 모든 replica가 동시에 오프라인"이 되지만 않으면, 서로 다른 shard의 replica를 동시에 업그레이드해도 된다 `[확인됨]`.
3. **혼합 버전 호환 창은 약 1년(또는 2 LTS 미만)이다.** 그 이상 벌어진 버전 간에는 mixed-version 상태로 롤링을 진행하지 말고, 다운타임을 감수한 일괄 업그레이드를 하거나 중간 버전을 경유해야 한다 `[확인됨]`.
4. 이 순서를 operator가 어떻게 자동화하는지 — 롤링 중 replica를 `remote_servers`에서 완전히 빼는 대신 분산쿼리 우선순위를 낮추는(low-priority) 처리 등 — 는 [operator 선택 페이지]({{< relref "03-operator.md" >}})에서 다룬 내용을 그대로 따른다. 다만 위 1년/2 LTS 호환 창 자체는 operator가 강제하는 것이 아니라 **운영자가 직접 지켜야 하는 규칙**이다 — operator는 어떻게 순차 롤링할지를 돕지만, 얼마나 버전 차이를 벌려도 되는지는 판단해주지 않는다.

## operator 자체 업그레이드 런북

Altinity operator는 **minor 버전 단계별 업그레이드만 지원**한다(예: 0.26→0.27) — 여러 minor를 건너뛰는 경로는 CI로 검증되지 않으므로, 오래된 버전에서 온다면 단계별로 순차 업그레이드한다 `[확인됨]`.

**절대 금지: CRD 삭제.** operator 업그레이드 중 어떤 경우에도 CustomResourceDefinition을 삭제하지 마라 — Kubernetes가 해당 CRD에 속한 모든 `chi`/`chk` 리소스를 연쇄 삭제하려 시도한다. 즉 관리 중인 모든 ClickHouse/Keeper 클러스터가 삭제 대상이 된다 `[확인됨]`.

알려진 업그레이드 함정 두 가지:

- **(a) 이미지+설정 동시 변경 시 crash (v0.24.3, issue #1926).** 이 버전대의 reconcile 순서는 ConfigMap을 새 버전 설정값으로 먼저 갱신한 뒤 `SYSTEM SHUTDOWN`으로 파드를 재기동시킨다. 이미지 업그레이드와 새 설정 변경을 한 reconcile에 같이 넣으면, 파드가 **구 이미지 + 신 ConfigMap** 조합으로 재시작해 인식 못 하는 설정값 때문에 crash할 수 있다(PR #1956에서 순서 수정) `[확인됨]`. 교훈: 이미지 업그레이드와 신규 설정 변경은 별도 reconcile로 분리한다. 이 원칙을 넘어서는 공식 가이드가 별도로 확인되지는 않았다 `[미확인]`.
- **(b) 0.27.1 업그레이드 후 감춰졌던 실패가 표면화.** 이전 버전에서는 특정 실패(호스트가 `Replicas=0`인데 CHI는 reconciled로 보고되는 상태)가 조용히 삼켜졌으나, 0.27.1부터는 첫 reconcile에서 이런 CHI가 정확히 `Aborted` 상태로 전환된다. 복구하려면 CHI spec을 재적용(re-apply)해 informer 재reconcile을 트리거한다 `[확인됨]`.

안전장치 3층(버전순):

| 레이어 | 도입 버전 | 내용 |
|---|---|---|
| STS recreate 정책 | 0.26.0 | `reconcile.statefulSet.recreate.onUpdateFailure: abort \| recreate` — 실패한 StatefulSet 업데이트를 그대로 둘지(abort) 재생성할지(recreate) 선택 `[확인됨]` |
| aborted reconcile 자동 재개 | 0.27.0 | `reconcile.recovery.from.aborted.onPodReady` — 실패했던 파드가 다시 Ready가 되면 중단된 reconcile을 자동 재개. 단 모든 파드가 Ready인 채로 발생하는 일시적 K8s API 오류는 이 범위 밖 `[확인됨]` |
| pre/post SQL 훅 | 0.27.0(실험적) | `HostCreate`/`HostShutdown`/`HostRollout`/`HostDelete` 등 이벤트에 SQL 주입(예: `HostShutdown`에 `SYSTEM STOP REPLICATION QUEUES`), 대상은 `FirstHost`/`AllHosts`/`AllShards`, `failurePolicy: Fail \| Ignore` `[확인됨]` |

## Keeper(CHK) 업그레이드

0.26.x→0.27.0 경로에서는 **데이터 마이그레이션이 필요 없다.** operator가 렌더링하는 keeper 설정(4-letter-word whitelist 추가, liveness probe가 `pgrep`에서 `ruok`/`imok` 4LW로 전환)만 바뀌므로, 기존 Keeper 파드는 startup probe로 게이트된 **순차 롤링**으로 재기동된다 `[확인됨]`. (0.23.x에서 오는 경우는 예외로, 수동 PV 마이그레이션이 필요하다고 별도 문서화돼 있다 `[확인됨]`.) 3노드 쿼럼 전제와 분리 배치 근거는 [operator 선택 페이지]({{< relref "03-operator.md" >}})를 참조한다.

## 모니터링·백업 연계

이 부분은 이번 딥리서치 라운드에서 전용 검증이 이뤄지지 않았다 `[미확인]` — 구체 구성(clickhouse-backup 사이드카→S3, PDB·모니터링 주입)은 [배포 플레이북 §운영 런북]({{< relref "04-deployment-playbook.md" >}})을 따르고, 아래는 기존 문서 근거로만 간결히 정리한다.

- **메트릭**: operator/CH는 Prometheus 메트릭을 노출한다([operator 선택 페이지]({{< relref "03-operator.md" >}}) 기준 `[확인됨]`). 스케일 in/out·롤링 업그레이드 이벤트를 대시보드에서 추적하려면 CHI 리소스 상태(`Completed`/`InProgress`/`Aborted`)를 메트릭이나 이벤트로 별도 수집하는 편이 안전하다 `[추정]` — operator가 이 상태 전이를 Prometheus 메트릭으로 직접 노출하는지는 이번 조사에서 확인하지 못했다 `[미확인]`.
- **백업**: clickhouse-backup 연계는 [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}})에서 다룬 incremental 체인의 취약성(하나라도 손상되면 이후 복구 불가)이 operator 운영에도 그대로 적용된다 `[확인됨, 02 문서 기준]`. operator가 백업 스케줄링이나 restore 자체를 관리하지는 않으므로, 백업/restore drill은 별도 CronJob 등으로 직접 소유해야 한다 `[추정]`.
- 이 영역은 클러스터 규모가 커질수록(특히 대규모 다중 클러스터) 운영 리스크가 커지는 지점이므로, 도입 전 별도 검증이 필요하다.

## 우리 케이스에서는

**소규모(1 shard × 3 replica) + CHK 3노드**로 시작한다 — 위 소규모 스니펫이 그 뼈대다. RUM 데이터가 성장해 노드당 데이터량이 커지면 — 기준은 고정 숫자가 아니라 [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}})의 재수화 논리다: 노드 하나를 재수화하는 시간이 replica 여유도를 위협하기 시작하는 지점 — `layout.shardsCount`를 늘리는 스케일 out 경로로 넘어가되, 신규 shard의 스키마는 수동으로 생성하고 과거 데이터는 옮기지 않는다는 전제를 팀 룰로 못박는다.

업그레이드 룰 세 가지를 고정한다: ① ClickHouse 이미지 업그레이드와 새 설정 변경은 항상 별도 reconcile로 분리한다(v0.24.3 함정 회피), ② operator 자체는 minor 단계별로만 올린다(0.26→0.27처럼) — 건너뛰지 않는다, ③ CRD는 어떤 상황에서도 삭제하지 않는다. scale-in은 이 페이지의 체크리스트를 통과할 때만 진행하고, 미해결 DROP REPLICA 리드를 고려해 제거 후 ZooKeeper/Keeper 경로를 수동으로 한 번 더 확인한다. 시점 기준 2026-07.
