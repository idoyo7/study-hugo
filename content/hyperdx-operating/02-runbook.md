---
title: "운영 런북 — 장애·변경이 났을 때 무엇을 어떤 순서로"
date: 2026-08-13
lastmod: 2026-08-24
weight: 2
aliases: ["/hyperdx-operating/04-operator-pattern/", "/hyperdx/operating/04-operator-pattern/"]
---

# 운영 런북 — 장애·변경이 났을 때 무엇을 어떤 순서로

{{< callout type="info" >}}
이 페이지는 메커니즘을 설명하지 않고 **순서와 판별 신호만** 담습니다.

- 진입은 증상입니다. "UI가 안 뜬다"·"신규 데이터가 안 들어온다"·"INSERT가 거부된다"는 각각 다른 절차로 나뉩니다. §1 표가 증상 → 판별 → 절차 → 확인의 라우팅입니다.
- 판별을 건너뛰지 않습니다. 특히 노드 급사에서 "정말 죽었나"를 확인하기 전에 taint를 걸면 RWO 볼륨 더블 마운트로 데이터가 깨집니다 `✓`.
- 명령 정본은 기준 문서에 있습니다. 이 페이지는 우리 형상의 파라미터·순서·판별 신호만 자기 문장으로 쓰고 명령 블록은 relref로 보냅니다.
- 버전·용량·요금 숫자는 이 페이지에 없습니다. 다운그레이드 차단 버전은 [버전 호환·업그레이드]({{< relref "../hyperdx/09-version-upgrade-compat.md" >}}) §3.2, 경보 임계·물리량은 [용량 산정]({{< relref "../hyperdx/07-capacity-planning.md" >}})이 단일 정본입니다.
{{< /callout >}}

전제는 [우리 배포 형상]({{< relref "01-our-deployment.md" >}})이 기록한 그대로입니다 — HyperDX Only(`clickhouse.enabled:false`) + Altinity CHI/CHK, 1 shard × RF2(2 AZ) + CHK 3노드(3 AZ), 쓰기는 기본 async. **현재 stage는 그 축소판**(replica 1·인메모리 큐·gp3 단일 티어)이라 아래 절차 중 "다른 replica가 계속 서빙한다"에 기대는 항목은 prod 목표 형상에서만 성립합니다.

## 1. 증상별 진입 — 무엇을 보고 어디로 가나

| 증상 | 먼저 볼 판별 신호 | 절차 | 확인 |
|---|---|---|---|
| UI·대시보드가 안 뜬다 | hdx 파드 상태 · MongoDB 연결. **적재는 계속되는지** 먼저 가른다 | 조회 계층만의 장애 — 적재 경로와 무관 | 새 데이터가 계속 쌓이는지 확인 → [가용성 종합]({{< relref "../hyperdx/04-operator-topology-downtime.md" >}}) §1 |
| 신규 데이터가 안 들어온다 | Collector 파드 상태 · 큐 적체. **stage는 인메모리 큐**라 재시작 구간이 곧 유실 구간이다 | Collector 복구 후 재개. 유실 구간을 기록한다 | [우리 배포 형상]({{< relref "01-our-deployment.md" >}}) stage 표 |
| INSERT/DDL이 거부된다 | `system.replicas.is_readonly` · Keeper 정족수(3노드 중 몇 대 생존) | Keeper 정족수 복구 → §3 | [복제·failover]({{< relref "../hyperdx/06-replication-failover.md" >}}) 정족수 상실 절 |
| CH 파드가 Terminating에서 안 내려온다 | 노드가 **정말** 죽었나(재부팅 중이 아닌가) | ungraceful death 복구 → §2 | [operator 토폴로지·다운타임]({{< relref "../hyperdx/04-operator-topology-downtime.md" >}}) §5.1 |
| hot 디스크가 차오른다 | `system.disks` 사용률 · TTL 이동이 실제로 도는지(`system.part_log`) | 확장 또는 TTL 단축·cold 이동 가속 | 경보 임계·조치 순서는 [의사결정 가이드]({{< relref "03-decision-guide.md" >}}) §2 |
| 업그레이드 후 startup에서 죽는다 | 온디스크 포맷이 바뀌는 경계를 넘었는지 | 롤백 창이 남았으면 바이너리만 되돌리고, 아니면 스냅샷 복원 → §4 | 차단 버전 판정은 [버전 호환·업그레이드]({{< relref "../hyperdx/09-version-upgrade-compat.md" >}}) §3.2 |

## 2. 노드가 죽었을 때 — 판별이 첫 단계다

EBS-first라 노드가 급사해도 볼륨이 남으므로 데이터는 사라지지 않습니다. 그래서 복구는 재수화가 아니라 **detach → 같은 AZ 새 노드에 reattach → 델타 catch-up**입니다 — 그 물리 역학과 왜 로컬 NVMe와 다른지는 [operator 토폴로지·다운타임]({{< relref "../hyperdx/04-operator-topology-downtime.md" >}}) §2가 소유합니다. 런북이 지킬 것은 순서입니다.

1. **계획된 교체(drain·consolidation)인지 급사인지 구분합니다.** 계획된 쪽은 개입이 없습니다 — PDB가 한 번에 한 replica로 직렬화하고 reattach·catch-up이 자동으로 돕니다.
2. **급사면 "정말 죽었나"를 먼저 확정합니다.** 재부팅 중인 노드에 taint를 걸면 RWO 볼륨이 두 곳에 붙어 데이터가 깨집니다 `✓`. 이 확인을 건너뛰는 것이 이 절차의 유일한 비가역 실수입니다.
3. **확정 후 `out-of-service` taint로 강제 정리합니다.** 명령 전문(taint 부여·해제, `--force` 삭제로는 부족한 이유)은 [operator 토폴로지·다운타임]({{< relref "../hyperdx/04-operator-topology-downtime.md" >}}) §5.1이 정본입니다.
4. **복구 후 taint를 되돌립니다.** 지우지 않으면 그 노드에 파드가 다시 배치되지 않습니다.
5. **AZ 하나가 통째로 죽으면 위 절차가 통하지 않습니다.** EBS는 AZ-bound라 reattach 자체가 불가하고 방어는 cross-AZ replica뿐입니다 `✓`.

우리 형상에서 이 개입을 자동화할지는 열린 항목입니다 — node-problem-detector 기반 자동 taint는 "정말 죽었나"를 오판할 위험이 있어 staging 리허설로 도구·타이밍을 검증한 뒤 팀 룰로 정합니다(§5).

## 3. Keeper 정족수를 잃었을 때 — 읽기는 살아 있다

3노드 중 2대를 잃으면 SELECT는 계속되지만 INSERT/DDL/머지가 멈춥니다. 판별 신호는 `system.replicas.is_readonly=1`이고 클라이언트에는 `TABLE_IS_READ_ONLY`로 떨어집니다 — 이 전락의 메커니즘과 왜 일부러 막는 보호 장치인지는 [복제·failover]({{< relref "../hyperdx/06-replication-failover.md" >}})가 단일 정본입니다.

런북 순서: ① 데이터 노드를 먼저 의심하지 않습니다(멀쩡할 수 있습니다) → ② CHK 파드 생존 수를 셉니다 → ③ gp3 영속 볼륨이 살아 있으면 데이터 경로와 **같은 reattach 절차**로 정족수를 되살립니다 `≈` → ④ 정족수가 돌아오면 쓰기가 자동 재개되므로 애플리케이션 측 조치는 없습니다. Keeper 부하 신호(znode 증가·gp3 사용률)는 이 절차가 아니라 승급 판단이므로 [의사결정 가이드]({{< relref "03-decision-guide.md" >}})로 넘깁니다.

## 4. 계획된 변경 — 롤링·업그레이드·스케일

**이미지·설정·볼륨확장을 한 reconcile에 섞지 않습니다** — 각각 별도 reconcile로 돌립니다 `✓`. 한꺼번에 바꾸면 crash가 났을 때 원인을 특정할 수 없습니다. 일반 operator 런북(스케일 in/out 함정·롤링 순서·CRD 삭제 금지)은 [Altinity operator 운영]({{< relref "../clickhouse/05-altinity-operations.md" >}})이, 6구성요소 버전 매트릭스와 롤백 경로는 [버전 호환·업그레이드]({{< relref "../hyperdx/09-version-upgrade-compat.md" >}})가 기준 문서입니다.

업그레이드 순서:

1. **올리기 전에 되돌릴 자리를 만듭니다** — 데이터 볼륨 EBS 스냅샷 + `clickhouse-backup` 이중 안전. 명령 전문은 [버전 호환·업그레이드]({{< relref "../hyperdx/09-version-upgrade-compat.md" >}}) §3.3·§4.1이 정본입니다.
2. **차단 경계를 먼저 확인합니다.** 온디스크 포맷이 바뀌는 버전 경계를 넘으면 바이너리 롤백이 막힙니다 — 어느 버전이 어느 하한을 막는지는 §3.2 표가 유일한 출처이고 이 페이지는 숫자를 재기재하지 않습니다.
3. **replica 단위로 좁힙니다.** RF2/RF3면 한 replica씩 스냅샷 → 업그레이드 → 실패 시 그 replica만 복원 → 나머지에서 델타 catch-up이 성립합니다 `≈`. stage는 replica 1이라 이 안전망이 없습니다 — stage 업그레이드는 스냅샷이 유일한 되돌림입니다.
4. **관찰 창(24~48h) 동안 롤백 창을 닫지 않습니다** — `OPTIMIZE ... FINAL`과 신규 컬럼 타입 사용을 금지합니다 `✓`. `OPTIMIZE FINAL` 한 번이 파트를 새 포맷으로 재작성해 스스로 롤백 창을 닫습니다.
5. **다운그레이드는 없다고 가정합니다.** 사고 대응 계획을 스냅샷·백업 복구 중심으로 짭니다.

우리 형상의 직렬화 파라미터는 CHI 클러스터에 `pdbMaxUnavailable: 1`, 파드 분산에 hostname anti-affinity, AZ에 topologySpread입니다. 이 셋이 자발적 중단(drain·consolidation·롤링)을 "한 번에 한 replica"로 묶습니다. **PDB는 자발적 중단만 막습니다** — §2의 급사 같은 비자발적 사건은 PDB로 못 막고 RF가 방어합니다 `✓`. 매니페스트 전문·`reconcile.*` 노브는 [operator 토폴로지·다운타임]({{< relref "../hyperdx/04-operator-topology-downtime.md" >}})으로 위임합니다.

## 5. stage 리허설 — 절차를 사람 손에 익히는 자리

위 절차 중에는 문서로 읽는 것과 실제로 하는 것이 다른 대목이 있습니다. staging에서 미리 돌립니다.

- graceful 리허설 — cordon → drain. PDB가 실제로 직렬화하는지, reattach가 자동으로 도는지를 봅니다.
- ungraceful 리허설 — 강제 종료. StatefulSet + RWO가 자동 복구되지 않는 것을 눈으로 확인하고 `out-of-service` taint 개입 시점을 잽니다 `✓`.

두 리허설의 실소요는 아직 재보지 않아 `?`이며 배포 전 실측 체크리스트에 한 항목으로 올라 있습니다 — 측정 방법과 승격 기준은 [의사결정 가이드]({{< relref "03-decision-guide.md" >}}) §3에 있습니다.

## 우리 케이스에서는

사건이 났을 때 이 페이지를 먼저 펴고 §1 표에서 증상 한 줄을 찾습니다. 그 줄이 가리키는 절차만 수행하고 "왜 그렇게 되는가"는 대응이 끝난 뒤 기준 문서에서 읽습니다 — 판별을 건너뛰고 메커니즘을 읽기 시작하면 대응이 늦어집니다. 판별 없이 절차만 실행하면 노드 급사 항목에서 데이터를 깨뜨립니다.

지금 stage 형상에서는 세 절차의 전제가 약합니다. replica 1이라 "다른 replica가 계속 서빙한다"가 성립하지 않고 인메모리 큐라 Collector 재시작 구간이 유실이며 업그레이드 실패 시 replica 단위 좁히기가 불가능합니다. 그래서 stage에서는 각 절차의 순서를 익히는 것이 목적이고 절차가 방어선으로 실제 작동하는 것은 prod 목표 형상(RF2·`file_storage` 큐·Keeper 3노드)이 선 다음입니다 — 그 승급 시점 판단은 [의사결정 가이드]({{< relref "03-decision-guide.md" >}})에, 현재 격차의 목록은 [우리 배포 형상]({{< relref "01-our-deployment.md" >}})에 있습니다. 시점 기준 2026-08.
