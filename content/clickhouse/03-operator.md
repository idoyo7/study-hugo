---
title: "clickhouse-operator 선택"
weight: 3
---

# clickhouse-operator 선택 — '쓸까 말까'가 아니라 '어느 것이냐'

{{< callout type="info" >}}
**한눈에** — ClickHouse는 replica≥2·shard가 생기는 순간 수동 StatefulSet이 오류투성이가 되므로 operator는 사실상 필수다. "쓸까 말까"가 아니라 "어느 것이냐"의 문제이며, 2026-07 기준 답은 **Altinity clickhouse-operator**(7년+ 트랙레코드, 사실상 표준)다.

- **손익분기점**: replica가 2개 이상 되는 순간 operator 이득이 러닝커브를 압도한다 `[추정]`.
- **통일**: 관측성(ClickStack)·범용 분석 CH를 Altinity 하나로 수렴 — ClickStack은 `clickhouse.enabled: false`로 내장 CH를 끄고 Altinity 관리 외부 CH를 참조(옵션 ③).
- **배제 근거**: 공식 operator는 알파(`v1alpha1`), Bitnami는 폐기 경로, 순수 StatefulSet은 단일 노드만.
{{< /callout >}}

"Helm에서 clickhouse-operator를 쓸까 말까"는 이미 답이 정해진 질문이다. ClickHouse는 스토리지만 붙은 컨테이너가 아니라 **엄격한 토폴로지·설정 요구를 가진 분산 시스템**이라, replica가 2개 이상이거나 shard가 하나라도 생기는 순간 수동 StatefulSet은 remote_servers 관리·스키마 전파·롤링 순서·PDB·anti-affinity를 전부 손으로 짜야 해서 오류투성이가 된다 `[확인됨]`. 그래서 진짜 결정은 "operator를 쓸지"가 아니라 **"어느 operator를 쓸지"**다. 2026-07 기준 답은 **Altinity clickhouse-operator**다 — 7년+ 프로덕션 트랙레코드로 사실상 표준이고, 공식·Bitnami·수동 경로는 각각 미성숙·폐기·비효율의 이유로 밀린다. 이 페이지는 "어느 operator냐"까지만 다룬다 — 실제 배포 구성은 [operator 배포 플레이북]({{< relref "04-deployment-playbook.md" >}}), 배포 후 스케일 in/out·롤링 업그레이드 같은 운영 실무는 [Altinity operator 운영]({{< relref "05-altinity-operations.md" >}})에서 이어간다.

## 프레이밍 전환 — 손익분기점은 replica≥2

operator 추상화(CHI/CHK의 `configuration`/`templates` 구조, XML 렌더링 규칙)에는 러닝커브가 있다 `[추정, 구조적 사실 기반]`. 그 비용을 이득이 넘어서는 지점이 **replica가 2개 이상이 되는 순간**이다 `[추정]` — 이때부터 자동 스키마 전파(새 replica에 DB/테이블 자동 생성), 안전한 롤링 업그레이드(replica를 분산쿼리에서 low-priority로 빼고 순차 교체), remote_servers 자동화, Keeper server_id 관리의 가치가 러닝커브를 압도한다 `[확인됨]`.

| 규모 | 형태 | operator 판단 |
|---|---|---|
| 단일 노드 (1 shard / 1 replica) | PoC·소규모 범용 분석 | StatefulSet 직접도 합리적. 단 확장 계획이 뚜렷하면 처음부터 operator로 시작해 이행 비용 회피 `[추정]` |
| 소규모 (1 shard / 2~3 replica) | HA 시작점 | **손익분기점.** operator 이득이 나타나기 시작 → Altinity 권장 `[추정]` |
| 중규모 (수 shard × 2~3 replica) | 프로덕션 표준 | **operator 사실상 필수** `[확인됨]` |
| 대규모 (수십 노드·다중 클러스터) | 대규모 프로덕션 | operator 필수 + 전용 노드·anti-affinity·PDB·Keeper 분리 필수 `[추정]` |

{{< callout type="warning" >}}
operator 간 마이그레이션(수동 STS→Altinity, Altinity↔공식)은 PVC/라벨/네이밍을 operator 기대값에 맞춰야 하는 non-trivial 작업이다 `[확인됨/추정]`. "단일 노드로 시작 → 나중에 operator"를 택하더라도 데이터를 처음부터 **ReplicatedMergeTree + clickhouse-backup(S3)** 형태로 두면 "새 operator 클러스터를 세우고 복제·복원으로 이전"하는 재구축 경로가 열려 이행 위험이 관리 가능해진다 `[추정]`.
{{< /callout >}}

## 선택지 전수 비교

| operator/방식 | 식별 (CRD/방식) | 성숙도 (2026-07) | 신규 프로덕션 | 비고 |
|---|---|---|---|---|
| **Altinity clickhouse-operator** | `ClickHouseInstallation`(CHI) / `ClickHouseKeeperInstallation`(CHK), `*.altinity.com/v1` | **성숙·표준, 0.27.1** (2026-06-04) | ✅ 권장 | 7년+ 트랙레코드, 평균 ~21일 릴리스 케이던스, Keeper GA 수준(0.27.0), FIPS-140(0.27.1) `[확인됨]`. Altinity.Cloud 자체가 이 위에서 구동 |
| **ClickHouse Inc. 공식 operator** | `ClickHouseCluster` / `KeeperCluster`, `clickhouse.com/v1alpha1` | **알파**, v0.0.1 2026-01-29 → 최신 **v0.0.6 2026-06-19** | ❌ 미션크리티컬 부적합 | Kubebuilder 기반, replica당 STS 1개(스테이지드 업그레이드 유리), admission webhook, `DatabaseReplicated` 네이티브. 리포는 2025-04 생성, Apache-2.0, 262 stars, README에 프로덕션 준비성 명시 없음. API가 `v1alpha1`(하위호환 미보장), K8s 1.28+·cert-manager 필요 `[확인됨]` |
| **Bitnami Helm chart** | Altinity operator 재패키징 차트 | **폐기 경로** | ❌ 신규 채택 배제 | 2025-08-28 공개 카탈로그가 community subset으로 축소·기존 이미지 `bitnamilegacy` 아카이브(zero updates)·유료 Secure Images 전환, 2025-09-29 기존 공개 카탈로그 삭제 예정일 `[확인됨]` |
| **순수 StatefulSet** | operator 없음 | (버전 무관) | △ 단일 노드만 | remote_servers·스키마·롤링·PDB·anti-affinity를 전부 수동. shard/replica 있으면 오류투성이 → 단일 노드/단일 replica·저빈도 변경 소규모에만 `[확인됨/추정]` |

- **Altinity가 왜 표준인가**: GitHub ~2.5k stars·88 releases, Altinity.Cloud의 수백 개 설치를 이 operator가 관리 `[확인됨]`("전 세계 수만 대 서버 관리" 규모 수치 자체는 벤더 주장 `[추정]`). CHI 하나가 여러 클러스터의 토폴로지·설정·스토리지·템플릿을 선언하고, `layout`의 shard/replica 수만 바꿔 스케일 in/out + 자동 스키마 전파가 된다 `[확인됨]`.

{{% details title="'성숙'의 실체 — 릴리즈로 다뤄온 프로덕션 운영 프리미티브 (①~⑧)" closed="true" %}}
단순히 오래됐다는 게 아니라, 프로덕션에서 아픈 지점을 릴리즈마다 다뤄 왔다는 뜻이다 `[확인됨]`.

- ① **롤링 업그레이드** 시 replica를 remote_servers에서 빼는 대신 low-priority로 설정해 분산쿼리 드롭을 최소화(0.26.0)
- ② Operator provisioner + `allowVolumeExpansion` CSI에서 **STS 재생성·파드 재시작 없이 볼륨 확장**
- ③ `.spec.suspend`로 리컨사일 일시중지(0.26.0)·실패 파드 복귀 시 자동 리컨사일 재시작(0.27.0)
- ④ replica 삭제 시 활성 replica는 절대 drop하지 않는 안전장치(0.25.5)
- ⑤ Prometheus 메트릭 익스포트
- ⑥ 0.27.0부터 CHI가 CHK를 **이름으로 직접 참조**하고 `async_replication`/`use_xid_64`가 기본 활성화(단 Keeper 25.3+ 필요)
- ⑦ STS recreate 정책으로 파드 스펙 변경 시 재생성 방식을 제어
- ⑧ 0.27.0에 실험적 **pre/post SQL 훅**(예: `HostShutdown` 이벤트에 `SYSTEM STOP REPLICATION QUEUES` 실행)이 추가돼 노드 종료 전 복제 큐를 안전하게 멈출 수 있다

수동 STS로는 이 하나하나를 직접 구현해야 한다.
{{% /details %}}

- **공식 operator를 지금 안 쓰는 이유**: 설계는 현대적이지만 `v1alpha1`은 하위호환을 보장하지 않는다. 범용·미션크리티컬 CH를 알파 API에 얹는 것은 이르다 `[확인됨]`. 다만 ClickStack 표준 Helm 경로를 그대로 따르면 **자동으로 이 공식 operator를 쓰게 된다**(아래 §공존 문제).
- **KubeBlocks/KubeDB** 같은 범용 DB operator도 존재하나(각각 addon·상용 라이선스), CH 전용 성숙도·트랙레코드에서 Altinity를 대체할 근거가 약해 이 결정에서는 제외 `[추정]`.

## operator "2종 공존" 문제와 해법

사용자 시나리오에는 (i) HyperDX/ClickStack 관측성용 CH와 (ii) 범용 분석용 CH가 함께 있다. 문제는 **ClickStack v2 Helm 차트가 공식 operator(`ClickHouseCluster`/`KeeperCluster`)를 클러스터에 설치**한다는 점이다 `[확인됨]`. 범용 CH를 Altinity(CHI/CHK)로 운영하면 → **한 K8s 클러스터에 서로 다른 CRD 그룹의 operator 2종**(`clickhouse.altinity.com` vs `clickhouse.com`)이 공존하게 된다.

| 선택지 | 내용 | 평가 |
|---|---|---|
| ① 2종 공존 허용 | CRD 그룹이 달라 기술적 충돌은 없음 | 운영·모니터링 표면 2배, 팀 학습 부담 증가 `[추정]` |
| ② 공식 operator로 통일 | ClickStack이 이미 쓰므로 하나로 수렴 | 공식 operator가 아직 알파 → 범용/미션크리티컬을 얹기엔 리스크 `[확인됨]` |
| ③ **Altinity로 통일 + ClickStack 외부 CH 연결** | ClickStack `clickhouse.enabled: false`로 내장 CH를 끄고, Altinity가 관리하는 CH(또는 HyperDX only 모드)를 참조 | **가장 보수적·정합적** — 공식 문서도 프로덕션에선 CH 별도 관리 권고 `[확인됨]` |

{{< callout type="important" >}}
**권고: 옵션 ③.** 관측성·범용 CH를 하나의 성숙한 operator(Altinity)로 수렴시키는 가장 깔끔한 형태다. ClickStack의 내장 CH를 끄고 Altinity가 관리하는 외부 CH를 바라보게 하면, 미션크리티컬 CH의 안정성을 알파 operator에 의존시키지 않으면서 관측성 스택도 유지된다. 공식 operator는 병렬로 스테이징에서 **베타/GA 승격을 추적하다가** 이후 재평가한다 `[추정]`.
{{< /callout >}}

## 운영 주의

Altinity operator를 GitOps(ArgoCD)·Helm 워크플로에 얹을 때 반복되는 함정이다.

{{< callout type="warning" >}}
**설정은 반드시 CHI `settings`/`files`로만 주입한다.** operator가 관리하는 설정과 외부에서 주입한 config가 충돌하면 CH 파드가 CrashLoop에 빠진다 — ArgoCD로 Vault의 `named_collections.xml`을 외부 주입했다가 operator 렌더링과 충돌한 실제 이슈(#1456)가 있다 `[확인됨]`. 커스텀 `config.xml`은 `configuration.settings`(구조화) 또는 `configuration.files`(원본 XML)로, `users.xml`은 `configuration.users`/`profiles`/`quotas`로 선언하면 operator가 XML로 렌더링해 ConfigMap으로 마운트한다 `[확인됨]`.
{{< /callout >}}

- **ArgoCD `ignoreDifferences`가 필요하다.** operator가 CR 상태를 계속 갱신하고 일부 필드(예: `resourceFieldRef.divisor`)를 채워 넣어 GitOps 도구가 **영구 OutOfSync diff**를 보이는 이슈가 있었다(0.27.1에서 수정) `[확인됨]`. operator는 **0.27.1+를 권장**하고, Altinity가 제공하는 argocd-examples를 참고해 diff/self-heal을 신중히 설정한다.
- **PVC `reclaimPolicy`와 삭제 보호.** operator/Helm이 만든 PVC는 `helm uninstall`로 삭제되지 않는다(데이터 보호) `[확인됨]`. EBS 계열은 `reclaimPolicy: Retain`이 churn·재생성 시 데이터를 지키는 직접적 의미가 크고(문서 예제는 `Delete`), 로컬 NVMe에서는 데이터가 어차피 노드와 함께 사라지므로 "PVC를 지워도 STS만 재생성되게" 하는 운영상 보호 용도로 쓴다 `[추정]`.
- **operator 업그레이드도 스테이징에서 검증한다.** operator 자체 업그레이드가 리컨사일 동작을 바꿔 예기치 않은 롤링 재시작을 유발할 수 있다 — RollingUpdate 중 CrashLoopBackOff(0.26.3 수정), 동시 config+version 업데이트 race(0.26.2 수정) 등 회귀 이력이 있다 `[확인됨]`. STS를 scale-to-0 없이 삭제하면 스키마가 재생성되지 않는 등 특정 조작 순서에서 나는 엣지 버그(#1500, #1602)가 있으니 스케일 순서 등 운영 룰을 지킨다 `[확인됨]`.
- **Keeper 재시작이 쿼럼을 잃었던 이력이 있다.** 0.24.0은 이전 Keeper 파드가 Running 상태인지 확인하지 않고 순차 재시작해, CHK 설정 변경 시 한 파드가 ContainerCreating인 동안 다음 파드가 Terminating으로 겹쳐 **일시적 쿼럼 손실**(테이블 read-only 전락)을 유발했다. 이 문제는 0.25.3(2025-08 보고)까지 잔존해 CHK PodDisruptionBudget도 준수하지 않았고, **v0.26.1(2026-03-13)에서 수정**됐다(issue #1598) `[확인됨]`. 마이그레이션·업그레이드 계획 시 **최소 0.26.1 이상**을 쓰고, 신규 도입이면 실무상 최신 0.27.x를 권장한다.

## 로컬 NVMe(i7i)와 CHI 상호작용

로컬 NVMe hot 티어를 쓰는 스토리지 전략의 상세는 [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}})에서 다룬다. operator 관점에서 핵심은 **"노드=데이터" 결합이 강해진다**는 점이다.

- **operator는 local을 포함한 모든 StorageClass를 지원한다.** operator는 `volumeClaimTemplates`로부터 PVC를 생성할 뿐이고, 노드 유실 시 복구 절차는 STS+PVC 삭제 → `kubectl patch chi`로 `taskID`를 바꿔 reconcile 트리거 → operator가 STS/PVC를 재생성하고 스키마를 전파하는 흐름이다(Altinity 메인테이너 문서화 답변, issue #1859). 로컬 볼륨 프로비저너는 topolvm/open-local/csi-driver-host-path 등을 쓴다 `[확인됨]`.
- **local PV는 파드를 특정 노드에 못박는다(node affinity).** 그 노드가 사라지면 파드는 새 PV/노드가 준비될 때까지 Pending이고, 데이터는 다른 replica로부터 **복제로 재수화(rehydrate)** 해야 한다(재수화 시간 ≈ 데이터량 / 네트워크·머지 속도) `[추정]`.
- **데이터 무손실 보장 지점.** ReplicatedMergeTree 쓰기는 모든 replica가 아니라 Keeper 로그의 ack만 요구하므로, 한 replica가 reschedule 중이어도 데이터 자체는 유실되지 않는다. 단 뒤처진 replica가 따라잡기 전까지 쿼럼/로드밸런싱 쿼리는 **stale 결과**가 가능하다 `[확인됨]`.
- **필수 전제**: **replica ≥ 2(shard당)** — 단일 replica면 노드 유실 = 데이터 유실. `podDistribution` **anti-affinity(`topologyKey: kubernetes.io/hostname`)** 로 같은 shard의 두 replica가 한 노드에 co-locate되는 것을 막는다(안 하면 그 노드 장애 시 shard 전체 장애). **PDB `maxUnavailable: 1` per shard** + drain 전 replica lag 확인 `[확인됨]`.
- **노드 교체 = 대규모 재수화 이벤트.** 노드당 데이터량이 크면 재수화가 오래 걸리고 그동안 가용성·성능이 저하된다. 콜드 데이터는 S3 tiered storage로 빼서 로컬 NVMe에는 핫 데이터만 두는 설계로 노드당 데이터량을 줄인다 `[추정]`.

## Keeper는 CHK로 3노드 분리 배포

Keeper는 Altinity operator의 **CHK(`ClickHouseKeeperInstallation`)로 3노드 분리 배포**한다.

- **CHK가 replica ordinal별 `server_id`(Raft peer 식별)를 자동 할당**해 파드 재시작 시 Raft peer discovery가 깨지지 않는다(수동 관리 시 흔한 실패 지점). 0.27.0부터 Keeper 지원이 GA 수준으로 승격돼 **CHI에서 Keeper를 서비스 엔드포인트가 아니라 이름으로 직접 참조**할 수 있다 `[확인됨]`.
- **정족수는 프로덕션 최소 3노드**(1 장애 허용)다. 2노드는 분할 시 과반을 못 만들어 단일 장애가 전체 복제를 중단시킨다 `[확인됨]`. 더 높은 가용성이 필요하면 5노드로 확장 가능하다 `[확인됨]`.
- **분리 배치**는 Keeper를 쿼리 부하와 격리하고, CH 파드 안에 co-locate했을 때 생길 수 있는 순환 의존성(CH가 replicated 테이블 초기화에 Keeper quorum이 필요한데 Keeper가 CH 파드에 박혀 기동 순서가 비결정적)을 피하는 실무 관행이다. 공식 문서는 분리·co-locate를 모두 정식 옵션으로 병기한다 `[확인됨]`.
- **Keeper 스토리지는 저지연 `fdatasync`가 관건**이고 용량은 소량(20Gi급)이면 충분하다 `[확인됨]`. 로컬 NVMe에 함께 두더라도 무방하나, Keeper 데이터는 영속 볼륨(gp3)에 두어 노드 교체와 무관하게 quorum을 지키는 편이 안전하다.

ZooKeeper 별도 운영은 무겁고 신규 구축에서 권하지 않는다 — operator를 쓴다면 그 operator의 Keeper CRD(Altinity면 CHK)를 쓰는 것이 자연스럽고 안전하다 `[확인됨]`.

## 우리 케이스에서는

이 페이지의 권고(Altinity로 통일 + ClickStack 외부 CH 연결)는 **ClickHouse 채택이 이미 결정된 뒤에만** 발동한다. 로깅 챕터의 결정과 모순되지 않는다 — 로그는 VictoriaLogs로 가고([로깅 · 옵저버빌리티]({{< relref "../logging/_index.md" >}})), 통합 저장소는 **earn-it-last**로 보류하는 D4는 여전히 유효하다. 전제가 다를 뿐이다: 로깅 챕터는 **로그 내재화** 관점(로그만의 규모·형태로 저장소 선택)이고, 이 페이지는 **RUM을 Datadog에서 빼내고 범용 분석까지 CH로 흡수하며 인프라 운영 인력이 이미 있는** 시나리오 관점이다. 그 결정이 서지 않으면 이 operator 논의 자체가 무의미하고 로깅 챕터의 판단이 우선한다.

채택이 결정된 경우, operator는 **Altinity로 통일**한다 — replica≥2가 되는 순간 손익분기점을 넘고, 7년+ 트랙레코드가 알파 공식 operator·폐기 경로 Bitnami·수동 STS를 모두 앞선다. ClickStack은 `clickhouse.enabled: false`로 내장 CH를 끄고 Altinity가 관리하는 CH(또는 HyperDX only)를 참조하게 해, 관측성용과 범용 분석용 CH를 하나의 성숙한 operator로 수렴시킨다. 공식 operator는 스테이징에서 베타/GA 승격을 추적하다 재평가한다. operator 결정을 실제 매니페스트로 옮기는 배포 절차(CHK/CHI 필드, local PV 연동, 스케일·업그레이드·재수화 런북)는 [operator 배포 플레이북]({{< relref "04-deployment-playbook.md" >}})에서, 로컬 NVMe·티어링 등 스토리지 how는 [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}})에서, 실운영 사례는 [프로덕션 운영 사례]({{< relref "06-production-usecases.md" >}})에서 이어진다. 시점 기준 2026-07.
