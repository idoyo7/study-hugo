---
title: "clickhouse-operator 선택"
weight: 3
---

# clickhouse-operator 선택 — '쓸까 말까'가 아니라 '어느 것이냐'

{{< callout type="info" >}}
ClickHouse는 replica≥2·shard가 생기는 순간 수동 StatefulSet이 오류투성이가 되므로 operator가 사실상 필수입니다. "쓸까 말까"가 아니라 "어느 것이냐"의 문제입니다. 2026-07 기준 답은 Altinity clickhouse-operator(7년+ 트랙레코드, 사실상 표준)입니다.

- replica가 2개 이상 되는 순간 operator 이득이 러닝커브를 압도합니다 `≈`.
- 관측성(ClickStack)과 범용 분석 CH를 Altinity 하나로 수렴시킵니다 — ClickStack은 `clickhouse.enabled: false`로 내장 CH를 끄고 Altinity가 관리하는 외부 CH를 참조합니다(옵션 ③).
- 공식 operator는 알파(`v1alpha1`), Bitnami는 폐기 경로, 순수 StatefulSet은 단일 노드까지입니다.
{{< /callout >}}

"Helm에서 clickhouse-operator를 쓸까 말까"는 이미 답이 정해진 질문입니다. ClickHouse는 스토리지만 붙은 컨테이너가 아니라 토폴로지·설정 요구가 엄격한 분산 시스템입니다. 그래서 replica가 2개 이상이거나 shard가 하나라도 생기면 수동 StatefulSet은 remote_servers 관리·스키마 전파·롤링 순서·PDB·anti-affinity를 전부 손으로 짜야 해서 오류투성이가 됩니다 `✓`. 진짜 결정은 어느 operator를 쓸지입니다. 2026-07 기준 답은 Altinity clickhouse-operator입니다 — 7년+ 프로덕션 트랙레코드로 사실상 표준입니다. 공식·Bitnami·수동 경로는 각각 미성숙·폐기·비효율의 이유로 밀립니다. 이 페이지는 어느 operator냐까지만 다룹니다 — 실제 배포 구성은 [operator 배포 플레이북]({{< relref "04-deployment-playbook.md" >}}), 배포 후 스케일 in/out·롤링 업그레이드·GitOps 함정·복구 같은 운영 실무는 [변경관리·복구]({{< relref "05-altinity-operations.md" >}})에서 이어갑니다.

## 프레이밍 전환 — 손익분기점은 replica≥2

operator 추상화(CHI/CHK의 `configuration`/`templates` 구조, XML 렌더링 규칙)에는 러닝커브가 있습니다 `≈⁽구조적 사실 기반⁾`. 그 비용을 이득이 넘어서는 지점은 replica가 2개 이상이 되는 순간입니다 `≈` — 이때부터 자동 스키마 전파(새 replica에 DB/테이블 자동 생성), 안전한 롤링 업그레이드(replica를 분산쿼리에서 low-priority로 빼고 순차 교체), remote_servers 자동화, Keeper server_id 관리의 가치가 러닝커브를 압도합니다 `✓`.

| 규모 | 형태 | operator 판단 |
|---|---|---|
| 단일 노드 (1 shard / 1 replica) | PoC·소규모 범용 분석 | StatefulSet 직접도 합리적 `≈` |
| 소규모 (1 shard / 2~3 replica) | HA 시작점 | **손익분기점.** operator 이득이 나타나기 시작 → Altinity 권장 `≈` |
| 중규모 (수 shard × 2~3 replica) | 프로덕션 표준 | **operator 사실상 필수** `✓` |
| 대규모 (수십 노드·다중 클러스터) | 대규모 프로덕션 | operator 필수 + 전용 노드·anti-affinity·PDB·Keeper 분리 필수 `≈` |

단, 단일 노드라도 확장 계획이 뚜렷하면 처음부터 operator로 시작해 나중의 이행 비용을 피하는 편이 낫습니다 `≈`.

{{< callout type="warning" >}}
operator 간 마이그레이션(수동 STS→Altinity, Altinity↔공식)은 PVC/라벨/네이밍을 operator 기대값에 맞춰야 하는 non-trivial 작업입니다 `✓/≈`. "단일 노드로 시작 → 나중에 operator"를 택하더라도 데이터를 처음부터 ReplicatedMergeTree + clickhouse-backup(S3) 형태로 두면 새 operator 클러스터를 세우고 복제·복원으로 이전하는 재구축 경로가 열려 이행 위험을 관리할 수 있습니다 `≈`.
{{< /callout >}}

## 선택지 전수 비교

- Altinity clickhouse-operator · `ClickHouseInstallation`(CHI) / `ClickHouseKeeperInstallation`(CHK), `*.altinity.com/v1` — 성숙도는 성숙·표준(0.27.1, 2026-06-04)이고 신규 프로덕션에 권장합니다. 7년+ 트랙레코드, 평균 ~21일 릴리스 케이던스, Keeper GA 수준(0.27.0), FIPS-140(0.27.1) `✓`. Altinity.Cloud 자체가 이 위에서 구동됩니다.
- ClickHouse Inc. 공식 operator · `ClickHouseCluster` / `KeeperCluster`, `clickhouse.com/v1alpha1` — 성숙도는 알파, v0.0.1 2026-01-29 → 최신 v0.0.6 2026-06-19, 신규 프로덕션에서는 미션크리티컬에 부적합합니다. Kubebuilder 기반이고 replica당 STS 1개(스테이지드 업그레이드에 유리), admission webhook, `DatabaseReplicated` 네이티브. 리포는 2025-04 생성, Apache-2.0, 262 stars, README에 프로덕션 준비성 명시 없음. API가 `v1alpha1`이라 하위호환을 보장하지 않고 K8s 1.28+·cert-manager가 필요합니다 `✓`.
- Bitnami Helm chart · Altinity operator 재패키징 차트 — 성숙도는 폐기 경로여서 신규 프로덕션에서는 채택을 배제합니다. 2025-08-28 공개 카탈로그가 community subset으로 축소되고 기존 이미지는 `bitnamilegacy`로 아카이브(zero updates), 유료 Secure Images로 전환됐습니다. 2025-09-29이 기존 공개 카탈로그 삭제 예정일입니다 `✓`.
- 순수 StatefulSet · operator 없음 — 성숙도는 버전과 무관하고 신규 프로덕션에서는 단일 노드까지만입니다. remote_servers·스키마·롤링·PDB·anti-affinity를 전부 수동으로 짭니다. shard/replica가 있으면 오류투성이가 되므로 단일 노드/단일 replica·저빈도 변경 소규모에만 씁니다 `✓/≈`.

- Altinity가 표준인 근거: GitHub ~2.5k stars·88 releases, Altinity.Cloud의 수백 개 설치를 이 operator가 관리합니다 `✓`("전 세계 수만 대 서버 관리" 규모 수치 자체는 벤더 주장 `≈`). CHI 하나가 여러 클러스터의 토폴로지·설정·스토리지·템플릿을 선언하고 `layout`의 shard/replica 수만 바꾸면 스케일 in/out과 자동 스키마 전파가 됩니다 `✓`.

{{% details title="'성숙'의 실체 — 릴리즈로 다뤄온 프로덕션 운영 프리미티브 (①~⑧)" closed="true" %}}
오래됐다는 말이 아닙니다. 프로덕션에서 아픈 지점을 릴리즈마다 다뤄 왔습니다 `✓`.

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

- 공식 operator를 지금 안 쓰는 이유: 설계는 현대적이지만 `v1alpha1`은 하위호환을 보장하지 않습니다. 범용·미션크리티컬 CH를 알파 API에 얹기에는 이릅니다 `✓`. 다만 ClickStack 표준 Helm 경로를 그대로 따르면 자동으로 이 공식 operator를 쓰게 됩니다(아래 §공존 문제).
- KubeBlocks/KubeDB 같은 범용 DB operator도 있지만(각각 addon·상용 라이선스), CH 전용 성숙도·트랙레코드에서 Altinity를 대체할 근거가 약해 이 결정에서는 제외합니다 `≈`.

## operator "2종 공존" 문제와 해법

사용자 시나리오에는 (i) HyperDX/ClickStack 관측성용 CH와 (ii) 범용 분석용 CH가 함께 있습니다. 여기서 ClickStack v2 Helm 차트는 공식 operator(`ClickHouseCluster`/`KeeperCluster`)를 클러스터에 직접 설치합니다 `✓`. 범용 CH를 Altinity(CHI/CHK)로 운영하면 → 한 K8s 클러스터에 서로 다른 CRD 그룹의 operator 2종(`clickhouse.altinity.com` vs `clickhouse.com`)이 공존하게 됩니다.

| 선택지 | 내용 | 평가 |
|---|---|---|
| ① 2종 공존 허용 | CRD 그룹이 달라 기술적 충돌은 없음 | 운영·모니터링 표면 2배, 팀 학습 부담 증가 `≈` |
| ② 공식 operator로 통일 | ClickStack이 이미 쓰므로 수렴 | 공식 operator가 아직 알파 → 리스크 `✓` |
| ③ **Altinity 통일 + 외부 CH 연결** | `clickhouse.enabled: false`로 내장 CH를 끄고 Altinity CH 참조 | **가장 보수적·정합적** |

{{< callout type="important" >}}
권고는 옵션 ③입니다. 관측성·범용 CH를 하나의 성숙한 operator(Altinity)로 수렴시키는 가장 깔끔한 형태입니다. ClickStack의 내장 CH를 끄고 Altinity가 관리하는 외부 CH를 바라보게 하면, 미션크리티컬 CH의 안정성을 알파 operator에 맡기지 않으면서 관측성 스택도 유지됩니다. 공식 문서도 프로덕션에서는 CH를 별도로 관리하라고 권고합니다 `✓`. 공식 operator는 병렬로 스테이징에서 베타/GA 승격을 추적하다가 이후 재평가합니다 `≈`.
{{< /callout >}}

## 로컬 NVMe(i7i)와 CHI 상호작용

로컬 NVMe hot 티어를 쓰는 스토리지 전략의 상세는 [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}})에서 다룹니다. operator 관점에서는 "노드=데이터" 결합이 강해집니다.

- operator는 local을 포함한 모든 StorageClass를 지원합니다. operator는 `volumeClaimTemplates`로부터 PVC를 생성할 뿐이고 노드 유실 시 복구는 STS+PVC 삭제 → `kubectl patch chi`로 `taskID`를 바꿔 reconcile 트리거 → operator가 STS/PVC를 재생성하고 스키마를 전파하는 순서로 갑니다(Altinity 메인테이너 문서화 답변, issue #1859). 로컬 볼륨 프로비저너는 topolvm/open-local/csi-driver-host-path 등을 씁니다 `✓`.
- local PV는 파드를 특정 노드에 못박습니다(node affinity). 그 노드가 사라지면 파드는 새 PV/노드가 준비될 때까지 Pending이고, 데이터는 다른 replica로부터 복제로 재수화(rehydrate)해야 합니다(재수화 시간 ≈ 데이터량 / 네트워크·머지 속도) `≈`.
- ReplicatedMergeTree 쓰기는 모든 replica가 아니라 Keeper 로그의 ack만 요구하므로, 한 replica가 reschedule 중이어도 데이터 자체는 유실되지 않습니다. 단 뒤처진 replica가 따라잡기 전까지 쿼럼/로드밸런싱 쿼리는 stale 결과가 나올 수 있습니다 `✓`.
- 필수 전제: replica ≥ 2(shard당) — 단일 replica면 노드 유실이 곧 데이터 유실입니다. `podDistribution` anti-affinity(`topologyKey: kubernetes.io/hostname`)로 같은 shard의 두 replica가 한 노드에 co-locate되는 것을 막습니다(안 하면 그 노드 장애 시 shard 전체 장애). PDB `maxUnavailable: 1` per shard, drain 전 replica lag 확인 `✓`.
- 노드 교체는 대규모 재수화 이벤트입니다. 노드당 데이터량이 크면 재수화가 오래 걸리고 그동안 가용성·성능이 저하됩니다. 콜드 데이터는 S3 tiered storage로 빼서 로컬 NVMe에는 핫 데이터만 두는 설계로 노드당 데이터량을 줄입니다 `≈`.

## Keeper는 CHK로 3노드 분리 배포

operator 선택의 결론만 여기 남깁니다. Keeper는 Altinity operator의 CHK(`ClickHouseKeeperInstallation`)로 3노드(프로덕션 최소, 1 장애 허용) 분리 배포하고 데이터는 gp3(영속)에 둡니다 `✓`. 2노드는 분할 시 과반을 못 만들어 단일 장애가 전체 복제를 중단시키므로 금지입니다. 더 높은 가용성이 필요하면 5노드로 확장합니다 `✓`. 분리 배치는 Keeper를 쿼리 부하와 격리합니다. CH 파드에 co-locate하면 순환 의존성이 생깁니다. CH는 replicated 테이블 초기화에 Keeper quorum을 요구하는데 그 Keeper가 같은 CH 파드에 박혀 있어 기동 순서가 비결정적이 됩니다. 분리는 이를 피하는 실무 관행입니다. 공식 문서는 분리·co-locate를 모두 정식 옵션으로 병기합니다 `✓`. 정족수 산술(왜 3, 언제 5)·`server_id` 자동 할당·`fdatasync`와 20Gi급 용량·CHK 매니페스트 필드는 [operator 배포 플레이북 §CHK]({{< relref "04-deployment-playbook.md" >}})가 정본입니다.

ZooKeeper 별도 운영은 무겁고 신규 구축에서 권하지 않습니다 — operator를 쓴다면 그 operator의 Keeper CRD(Altinity면 CHK)를 쓰는 것이 자연스럽고 안전합니다 `✓`.

## 우리 케이스에서는

이 페이지의 권고(Altinity로 통일 + ClickStack 외부 CH 연결)는 ClickHouse 채택이 이미 결정된 뒤에만 발동합니다. 로깅 챕터의 결정과 모순되지 않습니다 — 로그는 VictoriaLogs로 가고([로깅 · 옵저버빌리티]({{< relref "../logging/_index.md" >}})), 통합 저장소는 earn-it-last로 보류하는 D4는 여전히 유효합니다. 전제가 다를 뿐입니다. 로깅 챕터는 로그 내재화 관점에서 로그만의 규모·형태로 저장소를 고릅니다. 이 페이지는 RUM을 Datadog에서 빼내고 범용 분석까지 CH로 흡수하며 인프라 운영 인력이 이미 있는 시나리오를 봅니다. 그 결정이 서지 않으면 이 operator 논의 자체가 무의미하고 로깅 챕터의 판단이 우선합니다.

채택이 결정된 경우 operator는 Altinity로 통일합니다 — replica≥2가 되는 순간 손익분기점을 넘고, 7년+ 트랙레코드가 알파 공식 operator·폐기 경로 Bitnami·수동 STS를 모두 앞섭니다. ClickStack은 `clickhouse.enabled: false`로 내장 CH를 끄고 Altinity가 관리하는 CH(또는 HyperDX only)를 참조하게 해, 관측성용과 범용 분석용 CH를 하나의 성숙한 operator로 수렴시킵니다. 공식 operator는 스테이징에서 베타/GA 승격을 추적하다 재평가합니다. operator 결정을 실제 매니페스트로 옮기는 배포 절차(CHK/CHI 필드, local PV 연동, 티어링 주입)는 [operator 배포 플레이북]({{< relref "04-deployment-playbook.md" >}})에서, 서고 난 뒤의 GitOps·업그레이드·복구 함정(ArgoCD `ignoreDifferences`, PVC `reclaimPolicy` 보호, operator 업그레이드 회귀 이력, Keeper 재시작 쿼럼 손실)은 [변경관리·복구]({{< relref "05-altinity-operations.md" >}})에서, 로컬 NVMe·티어링 등 스토리지 how는 [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}})에서, 실운영 사례는 [프로덕션 운영 사례]({{< relref "06-production-usecases.md" >}})에서 이어집니다. 시점 기준 2026-07.
