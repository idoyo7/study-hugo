---
title: "operator 패턴 — 복제·다운타임·정족수·업그레이드"
weight: 4
---

# operator 패턴 — 복제·다운타임·정족수·업그레이드

{{< callout type="info" >}}
**한눈에**

- **복제**: RMT는 멀티마스터라 승격(promotion) 절차가 없다 — replica 하나가 죽어도 살아있는 replica가 read+write를 그대로 계속한다 `✓`.
- **다운타임**: EBS-first라 노드 급사는 볼륨 reattach + 델타 catch-up(수 분)이지, 로컬 NVMe의 전량 재수화(수 시간, RF2→실질 RF1)가 아니다 `≈`. 단 **ungraceful** death는 자동 복구되지 않고 개입이 필요하다 `✓`.
- **Keeper 정족수**: 이 아키텍처의 진짜 SPOF는 데이터 노드가 아니라 Keeper 과반이다 — 잃으면 데이터 노드가 멀쩡해도 CH가 read-only로 전락한다 `✓`.
- **버전/업그레이드**: CH·Keeper·operator·HyperDX·OTel Collector·MongoDB **6개가 독립 케이던스**로 돈다. 다운그레이드는 "없다고 가정"하고, 직전 EBS 스냅샷 + `clickhouse-backup` 이중 안전으로 replica 단위 롤백한다.
- 네 축을 관통하는 안전장치: **RF2 + anti-affinity(hostname) + topologySpread(AZ) + PDB(maxUnavailable 1)**가 자발적 중단을 직렬화한다. 단 EBS는 **AZ-bound**라 AZ 장애만은 reattach로 못 풀고 cross-AZ RF로만 방어된다.
{{< /callout >}}

Altinity CHI/CHK 위에 클러스터를 얹으면 그 위에서 네 가지 운영 난이도가 실제로 발생한다 — **복제**(누가 죽으면 무슨 일이 나나) · **다운타임**(복구가 얼마나 걸리나) · **Keeper 정족수**(진짜 SPOF가 어디인가) · **버전/업그레이드**(6개 구성요소를 어떻게 올리고 되돌리나). [컴포넌트별 가용성]({{< relref "03-availability.md" >}})이 blast radius를 컴포넌트 단위로 종합했다면, 이 페이지는 그중 **ClickHouse/Keeper 두 컴포넌트 내부에서 operator가 실제로 만들어내는 운영 난이도**를 한 층 더 파고든다. 각 축의 정본은 [operator 토폴로지·다운타임]({{< relref "../04-operator-topology-downtime.md" >}}) · [Keeper]({{< relref "../05-keeper.md" >}}) · [복제·멀티마스터·failover]({{< relref "../06-replication-failover.md" >}}) · [버전 호환성·업그레이드]({{< relref "../09-version-upgrade-compat.md" >}})이고, CHI/CHK 필드 전수·스케일 함정·롤링 런북은 [Altinity operator 운영]({{< relref "../../clickhouse/05-altinity-operations.md" >}})이 정본이다. 여기서는 반복 없이 판단에 필요한 수치·표·설정 조각만 추린다.

전제: **1 shard × RF2(2 AZ) + CHK 3노드(3 AZ)**, BYO(`clickhouse.enabled:false`) + Altinity CHI/CHK, 쓰기는 기본 async.

## ① 복제 — 멀티마스터, 승격 없는 failover

RMT는 shared-nothing이고 각 replica가 완전한 사본을 자기 EBS 볼륨에 갖는다. 복제는 row/statement 스트림이 아니라 **part 단위**로 동작한다 — INSERT가 로컬에서 즉시 하나의 part로 굳고, 그 존재만 Keeper `/log`에 등록되면 다른 replica가 그 로그를 보고 **part 바이트를 sibling에서 직접 pull**한다 `✓`. 잠깐 offline이던 replica는 복귀 후 자기 `log_pointer` 이후 밀린 엔트리만 이어 소비(catch-up)한다.

가장 흔한 오해는 "replica 중 하나가 leader이고 죽으면 승격한다"이다. **틀렸다.** `is_leader`/`can_become_leader`는 primary 표시가 아니라 **머지/뮤테이션 할당 참여 여부**이고, 20.6부터 여러 replica가 동시에 leader일 수 있다 `✓`. INSERT·ALTER는 애초에 아무 살아있는 replica로나 보낼 수 있으므로(멀티마스터), 죽은 replica가 있어도 "승격"할 대상 자체가 없다.

| 축 | 전통 primary-replica | ClickHouse RMT |
|---|---|---|
| 쓰기 수용 노드 | primary 1개만 | **모든 replica**(멀티마스터) `✓` |
| 장애 시 조치 | standby → primary 승격 | **승격 없음** — 살아있는 replica가 계속 `✓` |
| failover 오케스트레이터 | Patroni·repmgr 등 외부 | **없음** |
| split-brain 방지 | fencing/STONITH | **Keeper Raft 정족수** — 소수파는 쓰기 불가 `✓` |

라우팅은 여전히 필요하다 — 죽은 replica로 요청이 안 가야 한다. 우리 기본 경로는 HyperDX → operator가 만든 cluster Service(ClusterIP, 8123/9000)이고, readiness probe(`/ping`)가 죽은 replica를 엔드포인트에서 뺀다 `≈`. 1 shard라 `remote_servers`의 `load_balancing`·Distributed 프록시는 지금은 불필요하고, chproxy는 사용자별 쿼터나 shard 2+가 실제 요구가 될 때 얹는다.

**RF2 consolidation의 안전성**: replica A를 drain/재부팅하는 동안 replica B가 승격 절차 없이 read+write를 그대로 서빙한다 `✓`. 이 창 동안 그 shard는 **실질 RF1**이라 2차 독립 장애에는 취약하지만, EBS라 창이 수 분으로 짧아 RF2가 방어 가능한 기본값이 된다(②). 동시 하락은 PDB `maxUnavailable: 1`이 직렬화한다(⑤).

## ② 다운타임 — EBS reattach가 재수화를 대체한다

전제 뒤집기 한 줄: 로컬 NVMe는 노드 급사=데이터 소실=**전량 재수화**(수 시간, RF2→실질 RF1)이지만, EBS 볼륨은 인스턴스와 독립된 네트워크 블록 스토리지라 노드가 죽어도 데이터는 볼륨에 남는다. 그래서 EBS-first의 복구 동작은 "재수화"가 아니라 **"detach → 같은 AZ 새 노드에 reattach → Keeper 로그가 가리키는 델타만 catch-up"**이 된다 `≈`. 정확한 reattach+part-load 실소요는 hot 데이터량·파트 수에 좌우되며 아직 실측 전이다 `?`(staging 리허설로 메운다).

| 시나리오 | 데이터 | 복구 동작 | 대략 소요 | 개입 |
|---|---|---|---|---|
| 계획된 노드 교체(drain, Karpenter voluntary) | 생존 | detach → 같은 AZ reattach → catch-up | 수 분 `≈` | 자동 |
| 노드 급사(**ungraceful**: HW/OS hang) | 생존 | 파드 **Terminating에 무한정 잔류** → 개입 필요 | 무개입 시 무한/6분+, 개입 시 수 분 `✓` | **out-of-service taint 필수** |
| AZ 1개 장애 | 그 AZ만 접근 불가(볼륨 AZ-bound) | reattach 자체가 불가 | AZ 복구까지 | cross-AZ RF만 방어 |
| 롤링 업그레이드/설정 reconcile | 무영향 | in-place 재시작, detach 없음 | replica수 × (재시작+catch-up) | 자동 |

ungraceful death가 최대 함정이다. Kubernetes는 죽은 노드의 파드가 정말 멈췄는지 확인할 수 없고, RWO 볼륨 더블 마운트(=데이터 손상)를 막기 위해 컨트롤 플레인은 파드를 Terminating으로 남긴 채 새 파드를 만들지 않는다. force-detach는 6분 뒤 시도되지만 CSI 정합성 때문에 지연될 수 있다. 정석 복구는 `out-of-service` taint(K8s 1.28 GA)다 `✓`:

```bash
# 노드가 정말 죽었음을 확인(재부팅 중이 아님 — 오판 시 더블 마운트 위험)한 뒤
kubectl taint nodes <dead-node> node.kubernetes.io/out-of-service=nodeshutdown:NoExecute
# → 파드 강제 삭제 + EBS 즉시 detach → 같은 AZ 새 노드에 reattach → CH startup → 델타 catch-up
```

읽기·쓰기 자체는 RF2의 다른 replica가 계속 서빙하므로 클러스터 다운은 아니다(저하 상태) — 하지만 개입 없이는 그 replica가 무한정 미가용이라는 점이 EBS 특유의 운영 부담이다. AZ 장애는 EBS·로컬 NVMe 모두 cross-AZ replica가 유일 방어라는 점에서 EBS의 이점이 미치지 않는 유일한 축이다. 상세 S1~S9 시나리오·PDB/probe/reconcile 노브는 [operator 토폴로지·다운타임]({{< relref "../04-operator-topology-downtime.md" >}})이 정본이다.

## ③ Keeper 정족수 — 데이터 노드가 아니라 조정 계층이 진짜 SPOF

Keeper는 NuRaft로 합의를 돌리고 홀수 노드로 배치한다(`floor(N/2)+1`이 과반).

| Keeper 노드 수 | 과반 | 견디는 손실 |
|---|---|---|
| 3 | 2 | 1대 |
| 4 | 3 | 1대(3노드와 동일 — 배치 의미 없음) |
| 5 | 3 | 2대 |

과반을 잃으면(우리 3노드 기준 2대 소실) **SELECT은 계속**되지만 **INSERT/DDL/머지/뮤테이션은 정지**한다 — `TABLE_IS_READ_ONLY`(에러 코드 242), `system.replicas.is_readonly=1`로 드러난다 `✓`. part 등록·블록번호 배정·복제 로그 기록이 전부 Keeper 쓰기를 요구하므로, **데이터 replica가 셋 다 멀쩡해도** 쓰기 경로가 통째로 멈춘다 — 이것이 데이터 노드가 아니라 조정 계층이 진짜 SPOF인 이유다. 정족수 없이 쓰기를 허용하면 일관성을 보장할 수 없으므로 일부러 막는 보호 장치다.

우리 CHK는 gp3 영속 볼륨을 쓰므로, Keeper 노드가 급사해도 Raft 로그/스냅샷이 볼륨에 살아남아 **데이터 경로와 동일하게 reattach로 정족수를 되살린다** `≈`. 로컬 NVMe였다면 Keeper 노드 급사가 곧 메타데이터 소실이라 앙상블 재구성이 훨씬 번거로웠을 것 — EBS-first는 데이터 경로와 조정 경로의 복구 모델을 통일한다.

한 가지 더 못박을 것: Keeper는 이벤트 **데이터**를 큐잉하지 않는다. 정족수 상실이 쓰기를 막는 이유는 조정 메타데이터(파트 참조·복제 로그·dedup 체크섬)를 못 쓰기 때문이지, Keeper가 in-flight INSERT를 들고 있다가 잃어서가 아니다 — 이 구분과 ingest 유실 방지 설계(OTel persistent queue·`insert_quorum`)는 [Keeper]({{< relref "../05-keeper.md" >}})가 정본이다.

## ④ 버전·업그레이드 — 6구성요소 독립 케이던스, 다운그레이드는 없다고 가정

이 스택은 **ClickHouse · Keeper · Altinity operator · HyperDX · OTel Collector · MongoDB** 6개가 독립적으로 버전이 돈다. "한 번에 다 올리기"는 원인 추적을 불가능하게 하므로 각자 별도 케이던스로 올린다 `≈`.

| 구성요소 | 핀 정책 | 근거/함정 |
|---|---|---|
| ClickHouse | **24.8 LTS**(또는 검증된 안정판) | ClickStack 최소요구는 24.8+, 차트 기본 태그(25.7)와는 별개 숫자 — self-host BYO라 우리가 분리 통제 `✓` |
| Keeper | CH와 동일 태그 정렬(24.8) | 별도 이미지라 명시 정렬이 필요 `≈` |
| Altinity operator | **0.27.1**, minor 단계별로만(0.26→0.27) | CH 21.11+·K8s 1.25+ 요구. **CRD 삭제는 절대 금지**(연쇄 삭제) `✓` |
| HyperDX app | 차트 `appVersion` 추종 | MergeTree 표준 기능만 사용 → CH 하한을 새로 밀어올리는 경우는 드묾 `≈` |
| OTel Collector | 배포판 태그(2.29.0) | ClickStack 배포판. persistent queue 확장 포함 여부는 버전마다 재확인 `?` |
| MongoDB | 5.0.32(차트 기본) | 메타데이터 전용, 버전 민감도 낮음 `✓` |

{{< callout type="warning" >}}
**매트릭스 함정**: operator **0.27.0+**는 `async_replication`/`use_xid_64`를 **기본 활성화**하는데 이 기능은 **Keeper 25.3+**를 요구한다 `✓`. 우리가 CH/Keeper를 24.8 LTS로 핀하면 이 기본값이 충돌할 수 있다 — operator가 Keeper 버전을 감지해 자동 무효화하는지, 아니면 그대로 켜서 오류를 내는지는 **배포 스테이징에서 반드시 실동작 검증**이 필요하다 `?`.
{{< /callout >}}

**CH는 함부로 못 내린다.** 온디스크 파트 포맷이 바뀐 뒤로는 이전 버전이 새 파트를 못 읽어 startup에서 죽는다.

| 다운그레이드 차단 트리거 | 효과 |
|---|---|
| marks 포맷 변경(25.8) | `25.8→25.3` 롤백 불가(startup fatal) `✓⁽#86837⁾` |
| String `with_size_stream` 직렬화(25.11) | 25.10 미만으로 불가 `✓⁽v25.11 BIC⁾` |
| JSON advanced shared data(25.12) | 25.8 미만으로 불가 `✓⁽v25.12 BIC⁾` |
| `OPTIMIZE TABLE ... FINAL` 실행 | 파트를 새 포맷으로 재작성 — 롤백 창을 스스로 닫음 `✓` |

{{< callout type="error" >}}
`compatibility` 서버 설정은 **명시적으로 안 바꾼 설정의 기본값만** 옛 버전 것으로 되돌린다 — 조용한 동작 회귀는 막지만, **온디스크 포맷·바이너리 버전은 되돌리지 못한다**. "롤백 노브"가 아니다 `✓`.
{{< /callout >}}

**실질 롤백은 스냅샷/백업뿐이다.** EBS-first에서는 업그레이드 직전 **데이터 볼륨 EBS 스냅샷**이 가장 확실한 롤백 지점이고, `clickhouse-backup`을 이중 안전으로 건다 `✓⁽AWS⁾`. RF2/RF3라 replica 단위로 좁힐 수 있다 — 한 replica씩 스냅샷 → 업그레이드 → 실패 시 그 replica만 스냅샷 복원 → 나머지 healthy replica에서 델타 catch-up `≈`.

```bash
clickhouse-backup create_remote pre-upgrade-$(date +%Y%m%d)     # 업그레이드 직전 백업(이중 안전 ②)
# 실패 시: 스냅샷에서 gp3 볼륨 복원(원 볼륨과 같은 AZ — EBS는 AZ-bound)
aws ec2 create-volume --snapshot-id snap-0abc... --volume-type gp3 \
  --availability-zone ap-northeast-2a
```

업그레이드 3규칙: ① 이미지·설정·볼륨확장은 각각 별도 reconcile(동시변경 crash 회피, v0.24.3 함정) `✓`, ② 관찰 24~48h 동안 `OPTIMIZE FINAL`·신규 컬럼 타입 사용 금지로 롤백 창 유지 `✓`, ③ 다운그레이드는 "없다고 가정"하고 스냅샷/백업 복구를 유일한 롤백 경로로 취급한다. 6구성요소 매트릭스 전문·ClickStack v1→v2 파괴적 변경은 [버전 호환성·업그레이드]({{< relref "../09-version-upgrade-compat.md" >}})가, operator 자체 minor 단계·CRD 금지·Keeper 0.26→0.27 무마이그레이션의 일반 런북은 [Altinity operator 운영]({{< relref "../../clickhouse/05-altinity-operations.md" >}})이 정본이다.

## 안전장치가 네 축을 하나로 묶는다

네 축 모두를 관통하는 배치 규칙은 하나다 — **RF2 + anti-affinity(hostname) + topologySpread(AZ) + PDB(maxUnavailable 1)**가 자발적 중단(drain·consolidation·롤링)을 "한 번에 한 replica"로 직렬화한다.

```yaml
spec:
  configuration:
    clusters:
      - name: main
        pdbManaged: "yes"
        pdbMaxUnavailable: 1          # 동시에 2대가 못 내려가게 직렬화
        layout: { shardsCount: 1, replicasCount: 2 }
  templates:
    podTemplates:
      - name: ch-ebs
        podDistribution:
          - { type: ClickHouseAntiAffinity, topologyKey: "kubernetes.io/hostname" }
        spec:
          topologySpreadConstraints:
            - { maxSkew: 1, topologyKey: "topology.kubernetes.io/zone", whenUnsatisfiable: DoNotSchedule }
```

단 이 안전망에는 구조적 한계가 하나 있다 — **EBS는 AZ-bound**라 볼륨을 다른 AZ로 못 옮긴다. anti-affinity·topologySpread·PDB는 모두 "자발적" 중단을 직렬화할 뿐이고, AZ 장애처럼 그 AZ 자체가 통째로 죽는 비자발적 사건은 reattach로 풀 수 없다 — 이 지점에서만 **cross-AZ RF(복제)가 유일한 방어**가 되고 EBS·로컬 NVMe의 처방이 수렴한다. 전문 매니페스트·podDistribution enum·`reconcile.*` 노브는 [operator 토폴로지·다운타임]({{< relref "../04-operator-topology-downtime.md" >}})으로 위임한다.

## 우리 케이스에서는

**토폴로지 `shardsCount: 1` × `replicasCount: 2`(2 AZ) + CHK 3노드(3 AZ)**로 시작한다. 복제는 승격 없는 멀티마스터라 별도 failover 오케스트레이터를 두지 않고, HyperDX → cluster Service(readiness 기반)로 라우팅만 잡는다. 다운타임은 EBS-first가 로컬 NVMe의 전량 재수화 위험을 없애주지만 **ungraceful death는 여전히 사람 개입**(out-of-service taint)이 필요하므로, node-problem-detector 기반 자동화를 staging에서 먼저 검증한 뒤 팀 룰로 못박는다. Keeper 3노드 정족수는 데이터 노드보다 먼저 지켜야 할 SPOF이므로 gp3 영속·CH와 분리 배치를 타협하지 않는다.

버전은 위 6구성요소 핀 표를 그대로 채택하되, **operator 0.27+ 기본값 ↔ Keeper 25.3+ 매트릭스 함정**을 배포 전 스테이징 실측 항목으로 못박는다. 업그레이드는 이미지·설정·볼륨확장을 분리한 reconcile + 직전 EBS 스냅샷 + `clickhouse-backup` 이중 안전 + 24~48h 관찰창으로 진행하고, **다운그레이드는 없다고 가정**해 사고 대응 계획을 스냅샷/백업 복구 중심으로 짠다. RF3·5노드 Keeper·chproxy는 이 페이지의 각 트리거(AZ 무저하 요구·`insert_quorum:2` 상시·2대 손실 허용 요구·shard 2+)가 실제로 넘어올 때만 승급한다. 시점 기준 2026-07.
