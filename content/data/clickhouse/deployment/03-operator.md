---
title: "clickhouse-operator 선택"
date: 2026-07-13
lastmod: 2026-08-24
weight: 3
url: "/clickhouse/03-operator/"
---

# ClickHouse를 Altinity operator로 운영하기 {#clickhouse-operator-선택--쓸까-말까가-아니라-어느-것이냐}

ClickHouse를 StatefulSet으로 띄우는 일은 어렵지 않습니다. replica와 shard를 늘리면 관리할 대상이 달라집니다. 새 replica의 스키마를 만들고, `remote_servers`를 갱신하고, 같은 shard의 replica를 동시에 재시작하지 않도록 순서를 관리해야 합니다. operator는 이 반복 작업을 CHI 선언과 reconcile로 처리합니다.

이 글에서는 관측성용 ClickHouse와 범용 분석용 ClickHouse를 Altinity operator로 운영하는 구성을 선택했습니다. 2026-07 조사 당시 Altinity는 0.27.1, ClickHouse 공식 operator는 `v1alpha1` API였습니다. 이미 축적된 운영 기능과 변경 이력을 보고 고른 선택입니다. 단일 노드 PoC에는 수동 StatefulSet도 사용할 수 있습니다.

ClickStack과 함께 쓸 때는 Helm 차트가 설치하는 공식 operator까지 고려해야 합니다. 아래에서 두 operator의 공존 여부를 다룬 뒤, [배포 플레이북]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}})과 [변경관리·복구]({{< relref "/data/clickhouse/operations/05-altinity-operations.md" >}})로 이어갑니다.

## replica를 늘릴 때 operator가 맡는 일 {#프레이밍-전환--손익분기점은-replica2}

Altinity의 CHI/CHK를 쓰려면 `configuration`, `templates`, XML 렌더링 규칙을 익혀야 합니다. replica를 두 개 이상 유지하는 구성에서는 그 학습 비용과 수동 운영 비용을 비교할 수 있습니다 `≈`. 새 replica의 DB·테이블 생성, `remote_servers` 갱신, 롤링 중 쿼리 우선순위 조정, Keeper `server_id` 관리를 자동화하는 점이 이득입니다 `✓`.

| 규모 | 형태 | operator 판단 |
|---|---|---|
| 단일 노드 (1 shard / 1 replica) | PoC·소규모 범용 분석 | StatefulSet 직접도 합리적 `≈` |
| 소규모 (1 shard / 2~3 replica) | HA 시작점 | **손익분기점.** operator 이득이 나타나기 시작 → Altinity 권장 `≈` |
| 중규모 (수 shard × 2~3 replica) | 프로덕션 표준 | **operator 권장** `✓` |
| 대규모 (수십 노드·다중 클러스터) | 대규모 프로덕션 | operator 필수 + 전용 노드·anti-affinity·PDB·Keeper 분리 필수 `≈` |

단, 단일 노드라도 확장 계획이 뚜렷하면 처음부터 operator로 시작해 나중의 이행 비용을 피하는 편이 낫습니다 `≈`.

{{< callout type="warning" >}}
operator 간 마이그레이션(수동 STS→Altinity, Altinity↔공식)은 PVC/라벨/네이밍을 operator 기대값에 맞춰야 하는 non-trivial 작업입니다 `✓/≈`. "단일 노드로 시작 → 나중에 operator"를 택하더라도 데이터를 처음부터 ReplicatedMergeTree + clickhouse-backup(S3) 형태로 두면 재구축 경로가 열립니다. 새 operator 클러스터를 세우고 복제·복원으로 옮기면 되니 이행 위험을 관리할 수 있습니다 `≈`.
{{< /callout >}}

## Altinity와 공식 operator 비교 {#선택지-전수-비교}

- Altinity clickhouse-operator · `ClickHouseInstallation`(CHI) / `ClickHouseKeeperInstallation`(CHK), `*.altinity.com/v1` — 성숙·표준 단계(0.27.1, 2026-06-04)이고 신규 프로덕션에 권장합니다. 7년+ 트랙레코드, 평균 ~21일 릴리스 케이던스, Keeper GA 수준(0.27.0), FIPS-140(0.27.1) `✓`. Altinity.Cloud 자체가 이 위에서 구동됩니다.
- ClickHouse Inc. 공식 operator · `ClickHouseCluster` / `KeeperCluster`, `clickhouse.com/v1alpha1` — 아직 알파입니다. v0.0.1 2026-01-29에서 최신 v0.0.6 2026-06-19까지 왔고 이 글의 신규 프로덕션 후보에서는 제외했습니다. Kubebuilder 기반이고 replica당 STS 1개(스테이지드 업그레이드에 유리), admission webhook, `DatabaseReplicated` 네이티브. 리포는 2025-04 생성, Apache-2.0, 262 stars, README에 프로덕션 준비성 명시 없음. API가 `v1alpha1`이라 하위호환을 보장하지 않고 K8s 1.28+·cert-manager가 필요합니다 `✓`.
- Bitnami Helm chart · Altinity operator 재패키징 차트 — 폐기 경로라 신규 프로덕션에서는 채택을 배제합니다. 2025-08-28 공개 카탈로그가 community subset으로 축소되고 기존 이미지는 `bitnamilegacy`로 아카이브(zero updates), 유료 Secure Images로 전환됐습니다. 2025-09-29이 기존 공개 카탈로그 삭제 예정일입니다 `✓`.
- 순수 StatefulSet · operator 없음 — 성숙도를 버전으로 따질 대상이 아니고 신규 프로덕션에서는 단일 노드까지만 씁니다. remote_servers·스키마·롤링·PDB·anti-affinity를 전부 수동으로 짭니다. shard/replica가 늘면 수동 관리 부담도 커지므로 단일 노드/단일 replica·저빈도 변경 소규모에만 씁니다 `✓/≈`.

- Altinity가 표준인 근거: GitHub ~2.5k stars·88 releases, Altinity.Cloud의 수백 개 설치를 이 operator가 관리합니다 `✓`("전 세계 수만 대 서버 관리" 규모 수치 자체는 벤더 주장 `≈`). CHI 하나가 여러 클러스터의 토폴로지·설정·스토리지·템플릿을 선언하고 `layout`의 shard/replica 수만 바꾸면 스케일 in/out과 자동 스키마 전파가 됩니다 `✓`.

{{% details title="'성숙'의 실체 — 릴리즈로 다뤄온 프로덕션 운영 프리미티브 (①~⑧)" closed="true" %}}
Altinity의 릴리스에는 롤링 중 분산쿼리, 볼륨 확장, 실패한 reconcile 재개처럼 운영 중 반복해서 만나는 문제가 반영돼 있습니다 `✓`.

- ① 롤링 업그레이드 시 replica를 remote_servers에서 빼는 대신 low-priority로 설정해 분산쿼리 드롭을 최소화(0.26.0)
- ② Operator provisioner + `allowVolumeExpansion` CSI에서 STS 재생성·파드 재시작 없이 볼륨 확장
- ③ `.spec.suspend`로 리컨사일 일시중지(0.26.0)·실패 파드 복귀 시 자동 리컨사일 재시작(0.27.0)
- ④ replica 삭제 시 활성 replica는 절대 drop하지 않는 안전장치(0.25.5)
- ⑤ Prometheus 메트릭 익스포트
- ⑥ 0.27.0부터 CHI가 CHK를 이름으로 직접 참조하고 `async_replication`/`use_xid_64`가 기본 활성화(단 Keeper 25.3+ 필요)
- ⑦ STS recreate 정책으로 파드 스펙 변경 시 재생성 방식을 제어
- ⑧ 0.27.0에 실험적 pre/post SQL 훅(예: `HostShutdown` 이벤트에 `SYSTEM STOP REPLICATION QUEUES` 실행)이 추가돼 노드 종료 전 복제 큐를 안전하게 멈출 수 있습니다

수동 STS로는 이 하나하나를 직접 구현해야 합니다.
{{% /details %}}

- 공식 operator를 지금 안 쓰는 이유: 설계는 현대적이지만 `v1alpha1`은 하위호환을 보장하지 않습니다. 범용·미션크리티컬 CH를 알파 API 위에 두기에는 이릅니다 `✓`. 그런데 ClickStack 표준 Helm 경로를 그대로 따르면 자동으로 이 공식 operator를 쓰게 됩니다(아래 §공존 문제).
- KubeBlocks/KubeDB 같은 범용 DB operator도 있지만(각각 addon·상용 라이선스), CH 전용 성숙도·트랙레코드에서 Altinity를 대체할 근거가 약해 이 결정에서는 제외합니다 `≈`.

## operator "2종 공존" 문제와 해법

관측성용 ClickHouse와 범용 분석용 ClickHouse를 같은 Kubernetes 클러스터에 둘 예정입니다. ClickStack v2 Helm 차트는 공식 operator(`ClickHouseCluster`/`KeeperCluster`)를 설치합니다 `✓`. 범용 분석은 Altinity의 CHI/CHK로 관리하면 `clickhouse.altinity.com`과 `clickhouse.com` 두 CRD 그룹을 함께 운영하게 됩니다. 그룹이 달라 공존은 가능하지만, 설정·업그레이드·장애 대응 방법을 각각 익혀야 합니다.

| 선택지 | 내용 | 평가 |
|---|---|---|
| ① 2종 공존 허용 | CRD 그룹이 달라 기술적 충돌은 없음 | 운영·모니터링 표면 2배, 팀 학습 부담 증가 `≈` |
| ② 공식 operator로 통일 | ClickStack이 이미 쓰므로 수렴 | 공식 operator가 아직 알파 → 리스크 `✓` |
| ③ **Altinity 통일 + 외부 CH 연결** | `clickhouse.enabled: false`로 내장 CH를 끄고 Altinity CH 참조 | **가장 보수적·정합적** |

{{< callout type="important" >}}
이 구성에서는 옵션 ③을 사용합니다. `clickhouse.enabled: false`로 ClickStack 내장 ClickHouse를 끄고 Altinity가 관리하는 외부 클러스터에 연결합니다. DB를 용도별로 나누더라도 operator 운영 방법은 공유할 수 있습니다. 공식 문서 역시 프로덕션에서 ClickHouse를 별도로 관리하는 구성을 권합니다 `✓`. 공식 operator는 스테이징에서 안정화 여부를 확인합니다.

{{< /callout >}}

## 로컬 NVMe(i7i)와 CHI 상호작용

로컬 NVMe hot 티어를 쓰는 스토리지 전략의 상세는 [스토리지 · 로컬 NVMe]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})에서 다룹니다. operator 쪽에서 보면 "노드=데이터" 결합이 강해집니다.

- operator는 local을 포함한 모든 StorageClass를 지원합니다. operator는 `volumeClaimTemplates`를 보고 PVC를 만들 뿐이고 노드 유실 시 복구는 STS+PVC 삭제 → `kubectl patch chi`로 `taskID`를 바꿔 reconcile 트리거 → operator가 STS/PVC를 재생성하고 스키마를 전파하는 순서로 갑니다(Altinity 메인테이너 문서화 답변, issue #1859). 로컬 볼륨 프로비저너는 topolvm/open-local/csi-driver-host-path 등을 씁니다 `✓`.
- local PV는 파드를 특정 노드에 고정합니다(node affinity). 그 노드가 사라지면 파드는 새 PV/노드가 준비될 때까지 Pending이고, 데이터는 다른 replica에서 복제로 재수화(rehydrate)해야 합니다(재수화 시간 ≈ 데이터량 / 네트워크·머지 속도) `≈`.
- ReplicatedMergeTree의 기본 복제는 비동기입니다. 살아 있는 replica로 조회와 쓰기를 이어갈 수 있지만, ACK 직후 쓰기를 받은 노드가 사라지면 아직 복제되지 않은 파트는 잃을 수 있습니다. 뒤처진 replica를 조회하면 stale 결과가 나올 수도 있습니다. [공식 복제 문서](https://clickhouse.com/docs/reference/engines/table-engines/mergetree-family/replication)도 단일 사본 손실 가능성을 설명합니다. ACK 전에 여러 사본을 확보하려면 [배포 플레이북의 `insert_quorum`]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}})을 검토합니다.
- 필수 전제: replica ≥ 2(shard당) — 단일 replica면 노드 유실이 곧 데이터 유실입니다. `podDistribution` anti-affinity(`topologyKey: kubernetes.io/hostname`)로 같은 shard의 두 replica가 한 노드에 co-locate되는 것을 막습니다(안 하면 그 노드 장애 시 shard 전체 장애). PDB `maxUnavailable: 1` per shard, drain 전 replica lag 확인 `✓`.
- 노드 교체는 대규모 재수화 이벤트입니다. 노드당 데이터량이 크면 재수화가 오래 걸리고 그동안 가용성·성능이 저하됩니다. 콜드 데이터는 S3 tiered storage로 빼서 로컬 NVMe에는 핫 데이터만 두는 설계로 노드당 데이터량을 줄입니다 `≈`.

## Keeper는 CHK로 3노드 분리 배포

Keeper는 CHK(`ClickHouseKeeperInstallation`)로 데이터 노드와 분리해 배포하고 gp3에 저장합니다. 이 구성의 시작점은 3노드로, 한 대 장애를 허용합니다. 두 대 장애까지 고려하면 5노드를 검토합니다 `✓`. 2노드는 과반이 2이므로 한 대만 잃어도 복제 조정이 멈춥니다.

분리 배치하면 쿼리 부하와 Keeper 부하를 격리하고 기동 순서도 관리하기 쉽습니다. 공식 문서는 분리 배치와 co-location을 모두 지원하는 형태로 설명합니다 `✓`. 정족수 계산, `server_id`, `fdatasync`, 20Gi급 볼륨과 CHK 필드는 [배포 플레이북 §CHK]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}})에서 다룹니다.

ZooKeeper 별도 운영은 무겁고 신규 구축에서 권하지 않습니다 — operator를 쓴다면 그 operator의 Keeper CRD(Altinity면 CHK)를 쓰는 것이 자연스럽고 안전합니다 `✓`.

## 관측성과 분석에 적용할 구성 {#우리-케이스에서는}

ClickHouse를 RUM·범용 분석에 도입하기로 했다면 Altinity operator로 관리합니다. ClickStack은 외부 ClickHouse를 참조하고, 관측성용과 분석용 CHI는 각각 둡니다. 공식 operator가 안정화되면 당시 기능과 마이그레이션 비용을 다시 비교할 수 있습니다.

이 선택이 로그 저장소 이전까지 뜻하지는 않습니다. 로그 내재화는 [로깅 챕터]({{< relref "/observability/logs/_index.md" >}})의 VictoriaLogs 판단을 따릅니다. RUM 대체와 범용 분석을 운영할 담당자가 정해지지 않았다면 operator를 고르기 전에 ClickHouse 도입부터 결정해야 합니다.

다음 작업은 [CHK/CHI 배포]({{< relref "/data/clickhouse/deployment/04-deployment-playbook.md" >}})와 [업그레이드·복구 리허설]({{< relref "/data/clickhouse/operations/05-altinity-operations.md" >}})입니다. 로컬 디스크를 쓴다면 [스토리지 설계]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})의 노드 소실 조건도 함께 검증합니다. [운영 사례]({{< relref "/data/clickhouse/operations/06-production-usecases.md" >}})는 공개된 배포 형태와 규모를 참고하는 자료입니다. 시점 기준 2026-07.
