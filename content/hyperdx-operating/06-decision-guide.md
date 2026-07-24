---
title: "의사결정 가이드 — 기본값·승급 트리거·실측 체크리스트"
weight: 6
aliases: ["/hyperdx/operating/06-decision-guide/"]
---

# 의사결정 가이드 — 기본값·승급 트리거·실측 체크리스트

{{< callout type="info" >}}
**한눈에**

- 7축(배포·hot 스토리지·cold 티어링·토폴로지·조정 계층·MongoDB·업그레이드) 각각을 **기본값 + 왜 안전/충분 + 승급 트리거** 한 표로 못박는다. 뼈대는 HyperDX Only(`clickhouse.enabled:false`)+Altinity CHI/CHK · 단일 gp3 · S3 TTL MOVE · 1 shard × RF2(2 AZ) · Keeper 3노드 · MongoDB 최소 · LTS 핀.
- 승급은 감이 아니라 **관측된 신호**로만 한다 — 각 트리거를 "어떤 신호를 어디서 보면 발동인가"(`system.parts`·`system.asynchronous_metrics`·CloudWatch EBS 지표·K8s 메트릭)까지 §2에서 한 단계 내렸다.
- 단 **업그레이드 축엔 승급 방향이 없다** — 온디스크 포맷이 바뀐 뒤의 다운그레이드는 "없다고 가정"하고, 유일한 되돌림은 업그레이드 직전 EBS 스냅샷이다.
- 배포 전 실측 4항목(0.7TB 해석·리플레이 압축비·기본 TTL·reattach 실소요)은 전부 `?`다 — **staging에서 측정해 `✓`로 승격**하는 것이 staging을 두는 캐파상 이유다(§3).
{{< /callout >}}

앞의 다섯 페이지가 각 축을 깊게 팠다면, 이 페이지는 그 결론을 **결정 매트릭스 하나로 접는다** — 매트릭스의 기준 문서는 이 페이지다. 각 축의 "왜"의 전개는 [아키텍처]({{< relref "01-architecture.md" >}})부터 [규모 산정]({{< relref "05-capacity.md" >}})까지의 섹션 페이지와 챕터 기준 문서로 위임하고, 여기서는 판단에 필요한 최소 근거·수치, 그리고 로드맵 요약에는 없던 한 단계 — **승급 트리거의 관측 지점** — 를 더한다.

## 1. 결정 매트릭스 — 기본값·왜 안전/충분·승급 트리거

| 축 | 기본값 | 왜 안전/충분 | 승급 트리거 | 상세 |
|---|---|---|---|---|
| 배포 | **HyperDX Only(`clickhouse.enabled:false`) + Altinity CHI/CHK** | 공식 operator 2종 공존 회피, 범용분석 CH와 운영 일원화 `✓` | — (구조 선택) | [01]({{< relref "01-architecture.md" >}}) · [스택 토폴로지]({{< relref "../hyperdx/01-stack-topology.md" >}}) |
| hot 스토리지 | **단일 gp3**(baseline IOPS + 소량 throughput) | throughput-bound + 인스턴스 EBS 파이프가 볼륨보다 먼저 천장, 내구성은 RF 복제가 담당 `✓/≈` | **io2**: >2,000 MiB/s 지속 · >80,000 IOPS/vol · 볼륨 99.999% 규제 | [02]({{< relref "02-tiering.md" >}}) · [hot EBS]({{< relref "../hyperdx/02-hot-storage-ebs.md" >}}) |
| cold 티어링 | **S3 TTL MOVE**(또는 **block-only**) | 긴 보존이 싼 이유는 S3($0.023/GB)에 쌓이고 리플레이는 30일 캡 `≈` | **block-only**: 짧은 보존(≤90일) · S3 미접근/규정 · 운영 단순성(staging) | [02]({{< relref "02-tiering.md" >}}) · [S3 티어링]({{< relref "../hyperdx/03-s3-cold-tiering.md" >}}) · [블록 온리]({{< relref "../hyperdx/08-block-only-tuning.md" >}}) |
| 토폴로지 | **1 shard × RF2(2 AZ)** | EBS는 노드 급사가 reattach+델타 catch-up이라 실질 RF1 창이 수 분 `≈` | **RF3**: AZ 무저하 요구 · `insert_quorum:2` 상시 · 규제 / **shard**: 노드 실용 상한 접근 | [04]({{< relref "04-operator-pattern.md" >}}) · [배포 플레이북]({{< relref "../clickhouse/04-deployment-playbook.md" >}}) |
| 조정 계층 | **Keeper 3노드(gp3 영속, 3 AZ)** | 정족수 3(1대 손실 허용) `✓`, gp3라 급사해도 Raft 메타가 살아 reattach로 복구 `≈` | **5노드**: 2대 동시 손실 허용이 요구일 때 | [03]({{< relref "03-availability.md" >}}) · [Keeper]({{< relref "../hyperdx/05-keeper.md" >}}) |
| MongoDB | **최소 규모·prod `members:3`**(또는 Atlas) | 부하는 데이터량 아닌 설정 수 비례, 인제스트 경로 밖 `≈` | **Atlas 위임**: 백업 공백 제거 | [01]({{< relref "01-architecture.md" >}}) · [스택 토폴로지]({{< relref "../hyperdx/01-stack-topology.md" >}}) |
| 업그레이드 | **LTS(24.8) 핀 + EBS 스냅샷 롤백** | 최신 추종 회피로 롤링 빈도↓, 스냅샷이 유일 확실 롤백 `✓/≈` | — (다운그레이드는 "없다고 가정") | [04]({{< relref "04-operator-pattern.md" >}}) · [버전·업그레이드]({{< relref "../hyperdx/09-version-upgrade-compat.md" >}}) |

"왜 안전/충분" 열은 성격이 다른 두 계열이 섞여 있음을 구분해 읽는다. **안전**의 근거는 장애 방어 메커니즘 — EBS reattach·RF 복제·Keeper 정족수·스냅샷 롤백 — 이고, **충분**의 근거는 규모 여유 — 0.7TB/월의 인제스트 피크 ~8 MB/s가 CPU·I/O 모두에 한참 못 미친다는 사실 — 이다 `≈`. 승급 트리거도 이 구분을 따른다: 안전 계열(RF3·Keeper 5노드)은 **요구사항이 바뀔 때** 발동하고, 충분 계열(io2·shard)은 **관측된 부하가 임계를 넘을 때** 발동한다. 전자는 지표를 아무리 봐도 안 나오는 트리거라는 점이 §2 표의 "요구사항 신호" 행들이 존재하는 이유다.

{{< callout type="warning" >}}
**"—"인 두 축은 되돌림이 없는 축이다.** 배포(HyperDX Only+Altinity)는 구조 선택이라 승급이 아니라 재설계의 문제고, 업그레이드는 온디스크 파트 포맷이 바뀐 순간(25.8 JSON·25.8 marks·25.10 String 직렬화) 이전 바이너리가 새 파트를 못 읽어 startup에서 죽는다 `✓`. `compatibility` 서버 설정은 "동작 기본값 회귀 방지"지 롤백이 아니다 `✓` — 실질 롤백은 **업그레이드 직전 EBS 스냅샷 + `clickhouse-backup` 이중 안전**뿐이다([버전·업그레이드]({{< relref "../hyperdx/09-version-upgrade-compat.md" >}})).
{{< /callout >}}

## 2. 승급 트리거의 관측 지점 — 무엇을 어디서 보면 발동인가

매트릭스의 트리거를 "관측 가능한 신호 + 그 신호를 보는 자리"까지 내린다. 임계값은 새로 만들지 않고 각 기준 문서의 수치를 그대로 쓴다.

| 승급 | 발동 신호 | 관측 지점 | 선행 단계 / 비고 |
|---|---|---|---|
| **gp3→io2** | 단일 볼륨 **2,000 MiB/s 지속 초과** 또는 **80,000 IOPS/vol 초과**(또는 볼륨 99.999% 규제) | CloudWatch EBS 볼륨 대역 지표 + `system.asynchronous_metrics` | 그 전에 **gp3 안에서 2단계**가 남아 있다: baseline 125 MiB/s 지속 초과가 보이면 먼저 provisioned throughput을 인스턴스 baseline(r7g.2xlarge ~312 MB/s)까지 상향 `≈` — io2는 그 다음이다([블록 온리 §5]({{< relref "../hyperdx/08-block-only-tuning.md" >}})) |
| **S3→block-only** | 메트릭이 아니라 **요구사항 신호**: 보존 ≤90일 확정 · S3 미접근 규정 · staging | 보존 정책·규정 (운영 지표 아님) | 채택 후 헬스는 `system.disks` 사용률 <80% · 파티션당 active parts <300 · `system.merges` 정체 없음 `≈`. 보존이 길어지면 발산(gp3 $0.08 vs S3 $0.023/GB, ~3.5x)하므로 S3 티어링으로 회귀 |
| **RF2→RF3** | 요구사항 신호(임의 2대 유실 무손실 · AZ 무저하 · 규제) + **`insert_quorum:2` 상시 필요** | reattach 창 실측치(§3 항목 4) · quorum 쓰기 차단 발생 여부 | RF2에서 `insert_quorum:2`를 켜면 replica 1대가 reattach 중일 때 확정 가능 replica가 1이라 **쓰기가 차단**된다 — 이 조합이 상시 요구면 RF3가 짝이다([배포 플레이북]({{< relref "../clickhouse/04-deployment-playbook.md" >}})) |
| **1 shard→shard 추가** | hot 단일사본/노드가 실용 상한(예 4~8TB) 접근 · 머지/쿼리 CPU 지속 포화 | 노드별 `system.parts` `bytes_on_disk` 합 · 데이터 노드 CPU 지속 >70%(K8s/CloudWatch) `≈` | 선행: replica 추가(읽기)·노드 사이즈업이 먼저다. 신규 shard 스키마·리밸런싱은 **수동**([Altinity 운영]({{< relref "../clickhouse/05-altinity-operations.md" >}})) |
| **Keeper 3→5노드** | 요구사항 신호: **2대 동시 손실 허용**이 요구일 때만 | — (부하 지표 아님) | Keeper 부하 신호(znode↑ · gp3 80%)는 5노드 승급이 아니라 **디스크 확장·작은 인서트 제거**로 대응한다 `≈` — Keeper 부하는 데이터량이 아니라 INSERT 빈도·파트 수 비례([Keeper]({{< relref "../hyperdx/05-keeper.md" >}})) |
| **MCK→Atlas 위임** | `mongodump` CronJob 공백(미구축·실패 방치) | CronJob 성공 여부 · 복원 리허설 결과 | MCK(Community Operator)에는 **내장 백업이 없다** `✓` — 백업·PITR·멀티AZ를 자력으로 못 메우면 Atlas M10(≈$57/mo `≈`)이 그 공백을 turnkey로 제거한다([스택 토폴로지]({{< relref "../hyperdx/01-stack-topology.md" >}})) |

두 가지를 덧붙인다. 첫째, **cold 축은 "이동이 실제로 도는가"도 관측 대상**이다 — TTL MOVE의 동작은 `system.storage_policies`(정책 로드)·`system.disks`(티어 등록)·`system.parts`의 `disk_name`(파트가 어느 티어에 있나)·`system.part_log`(이동 이력) 조회로 확인 가능한 표준 인터페이스다 `✓`([S3 티어링]({{< relref "../hyperdx/03-s3-cold-tiering.md" >}}) 기준 문서). 이동이 멎으면 hot이 차오르며 아래 경보로 이어지므로, cold 축의 일상 헬스는 이 네 뷰가 담당한다.

둘째, hot gp3의 일상 경보(승급 아닌 운영 대응)는 [규모 산정]({{< relref "05-capacity.md" >}})의 기준을 쓴다: 사용률 **70% 경고 / 80% 조치 / 85% 하드실링**, 조치는 gp3 온라인 확장 또는 TTL 단축·cold 이동 가속 `≈` — 디스크가 차면 머지 중단→TOO_MANY_PARTS→인서트 차단으로 이어지므로 hot 볼륨은 항상 30~40% 여유를 남긴다 `✓/≈`.

{{< flow caption="충분 계열(부하 관측으로 발동): 단일 gp3(baseline)는 125 MiB/s 지속 초과(CloudWatch·asynchronous_metrics)면 provisioned throughput을 인스턴스 baseline까지 올리고, 그래도 2,000 MiB/s 지속·80,000 IOPS/vol 초과(또는 볼륨 99.999% 규제)면 io2로 간다. 1 shard는 노드당 hot 실용 상한 접근·머지/쿼리 CPU 지속 >70%면 먼저 사이즈업·replica 추가, 그래도 포화면 shard 추가(수동). 안전 계열(요구사항 변경으로 발동): RF2는 임의 2대 무손실 요구 또는 insert_quorum:2 상시 필요가 생기면 RF3로, Keeper 3은 2대 동시 손실 허용이 요구일 때만 5노드로 — 둘 다 지표가 아니라 요구사항이 바뀔 때만 발동." >}}
{
  "groups": [
    {"id": "load", "label": "충분 계열(부하 관측)", "members": ["G", "P", "IO2", "ONE", "SZ", "SH"]},
    {"id": "req",  "label": "안전 계열(요구사항)",  "members": ["RF2", "RF3", "K3", "K5"]}
  ],
  "nodes": [
    {"id": "G",   "col": 0, "row": 0, "label": "단일 gp3",        "sub": "baseline",           "kind": "store"},
    {"id": "P",   "col": 1, "row": 0, "label": "gp3 provisioned", "sub": "인스턴스 baseline까지", "kind": "proc"},
    {"id": "IO2", "col": 2, "row": 0, "label": "io2",                                            "kind": "store"},
    {"id": "ONE", "col": 0, "row": 1, "label": "1 shard",                                        "kind": "store"},
    {"id": "SZ",  "col": 1, "row": 1, "label": "사이즈업·replica 추가",                            "kind": "proc"},
    {"id": "SH",  "col": 2, "row": 1, "label": "shard 추가",      "sub": "수동",                  "kind": "store"},
    {"id": "RF2", "col": 3, "row": 0, "label": "RF2",                                             "kind": "store"},
    {"id": "RF3", "col": 4, "row": 0, "label": "RF3",                                             "kind": "store"},
    {"id": "K3",  "col": 3, "row": 1, "label": "Keeper 3",                                        "kind": "store"},
    {"id": "K5",  "col": 4, "row": 1, "label": "Keeper 5",                                        "kind": "store"}
  ],
  "edges": [
    {"from": "G",   "to": "P",   "label": "125 MiB/s 지속 초과",         "dashed": true},
    {"from": "P",   "to": "IO2", "label": "2,000 MiB/s·80,000 IOPS 초과", "dashed": true},
    {"from": "ONE", "to": "SZ",  "label": "hot 실용 상한 접근·CPU>70%",  "dashed": true},
    {"from": "SZ",  "to": "SH",  "label": "그래도 포화",                 "dashed": true},
    {"from": "RF2", "to": "RF3", "label": "2대 무손실·quorum:2 상시",    "dashed": true},
    {"from": "K3",  "to": "K5",  "label": "2대 동시 손실 허용 요구",     "dashed": true}
  ]
}
{{< /flow >}}

## 3. 배포 전 실측 체크리스트 — `?` 4항목을 staging에서 `✓`로

아래 4개는 공개 실측이 없거나 문서 간 상충이 있어 전부 `?`다. staging에서 측정해 `✓`로 승격한다.

| 실측 항목 | 현재 | 측정 방법 | 승격 후 |
|---|---|---|---|
| 월 0.7TB = raw인가 on-disk인가 | `?` | `system.parts`의 월 `bytes_on_disk` 증가분 | `✓` — 배포 규모·비용 **2~3배** 확정 |
| 세션 리플레이 압축비(모델 5x, 밴드 4~6x `≈`) | `?` | `system.parts` `uncompressed/on_disk` 비율 | `✓` — [규모 산정]({{< relref "05-capacity.md" >}}) 산식 밴드 확정 |
| ClickStack 기본 TTL(`${TABLES_TTL}`, 문서상 3일) | `?` | `SHOW CREATE TABLE`로 실 TTL 확인 | `✓` — 우리 권장 오버라이드(리플레이 30일 DELETE·로그/트레이스 hot 14일)와 대조 |
| EBS reattach + part-load 실소요 | `?` | staging 노드 drain·강제 종료 리허설 | `✓` — `reconcile.statefulSet.update.timeout` 튜닝 |

항목 1·2는 쿼리 하나로 같이 잡힌다([용량 산정]({{< relref "../hyperdx/07-capacity-planning.md" >}}) 기준 문서):

```sql
SELECT table,
       formatReadableSize(sum(bytes_on_disk))               AS on_disk,
       formatReadableSize(sum(data_uncompressed_bytes))     AS uncompressed,
       round(sum(data_uncompressed_bytes)/sum(bytes_on_disk),1) AS ratio
FROM system.parts
WHERE active AND database = 'default'
GROUP BY table ORDER BY sum(bytes_on_disk) DESC;
```

`ratio`가 시그널별 실제 압축비, `on_disk`의 월 증가분이 해석 확정값이다. 항목 4의 리허설은 **두 갈래**로 한다 — graceful(cordon→drain: PDB 준수·자동 reattach)과 ungraceful(강제 종료: StatefulSet+RWO는 자동 복구가 안 되고 `out-of-service` taint 개입이 정석 `✓`). 실소요는 hot 데이터량·파트 수에 좌우되며 아직 실측 전이다 `?`([operator 패턴]({{< relref "04-operator-pattern.md" >}}) · [토폴로지·다운타임]({{< relref "../hyperdx/04-operator-topology-downtime.md" >}})). 여기에 버전 매트릭스 함정 하나를 staging 검증에 얹는다: operator 0.27.0+는 `async_replication`/`use_xid_64`를 기본 활성화해 **Keeper 25.3+를 요구**하는데 `✓`, 우리는 CH/Keeper를 24.8 LTS로 핀하므로 이 조합의 실동작 확인이 필요하다 `?`([버전·업그레이드]({{< relref "../hyperdx/09-version-upgrade-compat.md" >}})).

**왜 staging인가 — 캐파상 이유.** 위 4항목과 산정 모델의 `≈`(압축비·구성비 65/20/13/2)는 트래픽이 실제로 흘러야만 확정된다. staging은 샘플링 5~10% · RF1 · 짧은 TTL(cold 없음)로 극소화해도(~$150~250/mo `≈`) 이 실측이 전부 가능하다 — 즉 staging의 진짜 역할은 "동작 검증"이 아니라 **실측 캘리브레이션**이고, 이것이 staging을 두는 캐파상 이유다([규모 산정]({{< relref "05-capacity.md" >}})).

{{% details title="staging 최소 형상 — 실측 캘리브레이션에 필요한 만큼만" closed="true" %}}
[용량 산정 §7]({{< relref "../hyperdx/07-capacity-planning.md" >}}) 기준 문서의 요지: **1× r7g.large**(2vCPU/16GB) + **Keeper 1**(단일; 또는 임베디드) + **MongoDB 1-member** + gp3 100~200GB 단일, cold 티어 없음(블록 온리가 자연스럽다 — storage XML·IRSA 생략). 세션 샘플링 5~10% 또는 QA 트래픽만으로 월 on-disk ~35~70GB(해석 B) `≈`. 압축비·세션당 바이트·TTL 실스키마·reattach 리허설이 이 형상에서 전부 측정된다. RF1·Keeper 1은 HA가 아니므로 staging 한정이다.
{{% /details %}}

## 우리 케이스에서는

기본값 세트 — **HyperDX Only+Altinity CHI/CHK, 단일 gp3, S3 TTL MOVE(리플레이는 hot 30일 DELETE), 1 shard × RF2(2 AZ), Keeper 3노드(gp3·3 AZ), MongoDB `members:3`, CH/Keeper 24.8 LTS 핀** — 로 시작하고, io2·block-only·RF3·shard·Keeper 5노드·Atlas는 §2의 관측 지점에서 해당 신호가 실제로 잡힐 때만 올린다. 특히 io2는 gp3 provisioned throughput 상향이라는 선행 단계를 건너뛰고 갈 이유가 없고, RF3는 `insert_quorum:2` 상시 요구와 짝일 때만 의미가 있다.

착수 1번 작업은 §3의 4개 `?`를 staging에서 `✓`로 승격하는 것이다 — 0.7TB 해석 하나가 배포 규모·비용을 2~3배 가르므로, 이 실측 전의 모든 산정은 밴드로만 다룬다. 그리고 업그레이드 축만은 승급이 아니라 **불가역**의 축임을 기억한다: 올리기 전 EBS 스냅샷이 유일한 되돌림이므로, 매트릭스의 다른 축과 달리 "일단 올리고 관측"이 성립하지 않는다. 시점 기준 2026-07.
