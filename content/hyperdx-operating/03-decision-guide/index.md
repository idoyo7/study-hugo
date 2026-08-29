---
title: "의사결정 가이드 — 기본값·승급 트리거·실측 체크리스트"
date: 2026-08-01
weight: 3
aliases: ["/hyperdx-operating/06-decision-guide/", "/hyperdx/operating/06-decision-guide/"]
---

# 의사결정 가이드 — 기본값·승급 트리거·실측 체크리스트

{{< callout type="info" >}}
- 7축(배포·hot 스토리지·cold 티어링·토폴로지·조정 계층·MongoDB·업그레이드)을 **기본값 + 왜 안전/충분 + 승급 트리거** 한 표에 명시합니다. 뼈대는 HyperDX Only(`clickhouse.enabled:false`)+Altinity CHI/CHK · 단일 gp3 · S3 TTL MOVE · 1 shard × RF2(2 AZ) · Keeper 3노드 · MongoDB 최소 · LTS 핀입니다.
- 승급은 감이 아니라 **관측된 신호**로만 합니다. §2에서 각 트리거를 "어떤 신호를 어디서 보면 발동인가"(`system.parts`·`system.asynchronous_metrics`·CloudWatch EBS 지표·K8s 메트릭)까지 한 단계 내렸습니다.
- **업그레이드 축엔 승급 방향이 없습니다** — 온디스크 포맷이 바뀐 뒤의 다운그레이드는 "없다고 가정"하고 유일한 되돌림은 업그레이드 직전 EBS 스냅샷입니다.
- 배포 전 실측 항목은 전부 `?`입니다. 원래 4항목(0.7TB 해석·리플레이 압축비·기본 TTL·reattach 실소요)에 IRSA·경로·볼륨 회수 계열 5항목이 합쳐져 **9항목**이 됐습니다. 이 항목을 **staging에서 측정해 `✓`로 승격**하려고 staging을 둡니다(§3).
{{< /callout >}}

우리 형상의 **현황**은 [우리 배포 형상]({{< relref "01-our-deployment.md" >}})이, 사건이 났을 때의 **순서**는 [운영 런북]({{< relref "02-runbook.md" >}})이 맡습니다. 이 페이지는 **언제 무엇을 승급하나**를 맡습니다 — 결정 매트릭스 하나로 접고 그 매트릭스의 기준 문서가 이 페이지입니다. 각 축의 "왜"를 펼치는 일은 챕터 기준 문서에 위임합니다. 여기에는 판단에 필요한 최소 근거와 로드맵 요약에는 없던 한 단계 — **승급 트리거의 관측 지점** — 만 둡니다.

## 1. 결정 매트릭스 — 기본값·왜 안전/충분·승급 트리거

- **배포**
  - 기본값: **HyperDX Only(`clickhouse.enabled:false`) + Altinity CHI/CHK**
  - 왜 안전/충분: 공식 operator 2종 공존 회피, 범용분석 CH와 운영 일원화 `✓`
  - 승급 트리거: — (구조 선택)
  - 상세: [우리 배포 형상]({{< relref "01-our-deployment.md" >}}) · [스택 토폴로지]({{< relref "../../hyperdx/01-stack-topology.md" >}})
- **hot 스토리지**
  - 기본값: **단일 gp3**(baseline IOPS + 소량 throughput)
  - 왜 안전/충분: throughput-bound + 인스턴스 EBS 파이프가 볼륨보다 먼저 천장, 내구성은 RF 복제가 담당 `✓/≈`
  - 승급 트리거: **io2**: >2,000 MiB/s 지속 · >80,000 IOPS/vol · 볼륨 99.999% 규제
  - 상세: [hot 스토리지·EBS]({{< relref "../../hyperdx/02-hot-storage-ebs.md" >}})
- **cold 티어링**
  - 기본값: **S3 TTL MOVE**(또는 **block-only**)
  - 왜 안전/충분: 긴 보존이 싼 이유는 cold(S3)가 hot(gp3)보다 GB당 훨씬 싸기 때문이고 리플레이는 30일 캡 `≈`. GB 단가·배수는 [hot 스토리지 · EBS]({{< relref "../../hyperdx/02-hot-storage-ebs.md" >}}) §1.3이 정본
  - 승급 트리거: **block-only**: 짧은 보존(≤90일) · S3 미접근/규정 · 운영 단순성(staging)
  - 상세: [S3 티어링]({{< relref "../../hyperdx/03-s3-cold-tiering.md" >}}) · [블록 온리]({{< relref "../../hyperdx/08-block-only-tuning.md" >}})
- **토폴로지**
  - 기본값: **1 shard × RF2(2 AZ)**
  - 왜 안전/충분: EBS는 노드 급사가 reattach+델타 catch-up이라 실질 RF1 창이 수 분 `≈`
  - 승급 트리거: **RF3**: AZ 무저하 요구 · `insert_quorum:2` 상시 · 규제 / **shard**: 노드 실용 상한 접근
  - 상세: [운영 런북]({{< relref "02-runbook.md" >}}) · [배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}})
- **조정 계층**
  - 기본값: **Keeper 3노드(gp3 영속, 3 AZ)**
  - 왜 안전/충분: 정족수 3(1대 손실 허용) `✓`, gp3라 급사해도 Raft 메타가 살아 reattach로 복구 `≈`
  - 승급 트리거: **5노드**: 2대 동시 손실 허용이 요구일 때
  - 상세: [operator 토폴로지·다운타임]({{< relref "../../hyperdx/04-operator-topology-downtime.md" >}}) · [Keeper]({{< relref "../../hyperdx/05-keeper.md" >}})
- **MongoDB**
  - 기본값: **최소 규모·prod `members:3`**(또는 Atlas)
  - 왜 안전/충분: 부하는 데이터량 아닌 설정 수 비례, 인제스트 경로 밖 `≈`
  - 승급 트리거: **Atlas 위임**: 백업 공백 제거
  - 상세: [스택 토폴로지]({{< relref "../../hyperdx/01-stack-topology.md" >}})
- **업그레이드**
  - 기본값: **LTS(24.8) 핀 + EBS 스냅샷 롤백**
  - 왜 안전/충분: 최신 추종 회피로 롤링 빈도↓, 스냅샷이 유일 확실 롤백 `✓/≈`
  - 승급 트리거: — (다운그레이드는 "없다고 가정")
  - 상세: [운영 런북]({{< relref "02-runbook.md" >}}) · [버전·업그레이드]({{< relref "../../hyperdx/09-version-upgrade-compat.md" >}})

"왜 안전/충분" 열은 성격이 다른 두 계열이 섞여 있으니 구분해 읽습니다. **안전**의 근거는 장애 방어 메커니즘 — EBS reattach·RF 복제·Keeper 정족수·스냅샷 롤백 — 입니다. **충분**의 근거는 규모 여유, 즉 0.7TB/월의 인제스트 피크 ~8 MB/s가 CPU·I/O 모두에 한참 못 미친다는 사실입니다 `≈`. 승급 트리거도 같은 구분을 따릅니다. 안전 계열(RF3·Keeper 5노드)은 **요구사항이 바뀔 때** 발동하고 충분 계열(io2·shard)은 **관측된 부하가 임계를 넘을 때** 발동합니다. 전자는 지표를 아무리 봐도 안 나오는 트리거입니다. 그래서 §2 표에 "요구사항 신호" 행이 따로 있습니다.

{{< callout type="warning" >}}
**"—"인 두 축은 되돌림이 없는 축입니다.** 배포(HyperDX Only+Altinity)는 구조 선택이라 승급 대신 재설계로 다뤄야 합니다. 업그레이드는 온디스크 파트 포맷이 바뀐 순간 이전 바이너리가 새 파트를 못 읽어 startup에서 죽습니다 `✓`. 어느 변경이 어느 하한을 막는지는 [버전·업그레이드]({{< relref "../../hyperdx/09-version-upgrade-compat.md" >}}) §3.2 표가 **차단 버전의 단일 정본**이고 이 페이지는 숫자를 재기재하지 않습니다. `compatibility` 서버 설정은 "동작 기본값 회귀 방지"지 롤백이 아닙니다 `✓` — 실질 롤백은 **업그레이드 직전 EBS 스냅샷 + `clickhouse-backup` 이중 안전**뿐입니다([버전·업그레이드]({{< relref "../../hyperdx/09-version-upgrade-compat.md" >}})).
{{< /callout >}}

## 2. 승급 트리거의 관측 지점 — 무엇을 어디서 보면 발동인가

매트릭스의 트리거를 "관측 가능한 신호 + 그 신호를 보는 자리"까지 내립니다. 임계값은 새로 만들지 않고 각 기준 문서의 수치를 그대로 씁니다.

- **gp3→io2**
  - 발동 신호: 단일 볼륨 **2,000 MiB/s 지속 초과** 또는 **80,000 IOPS/vol 초과**(또는 볼륨 99.999% 규제)
  - 관측 지점: CloudWatch EBS 볼륨 대역 지표 + `system.asynchronous_metrics`
  - 선행 단계/비고: 그 전에 **gp3 안에서 2단계**가 남아 있다 — baseline 125 MiB/s 지속 초과가 보이면 먼저 provisioned throughput을 인스턴스 baseline(r7g.2xlarge ~312 MB/s)까지 상향 `≈`, io2는 그 다음입니다([블록 온리 §5]({{< relref "../../hyperdx/08-block-only-tuning.md" >}}))
- **S3→block-only**
  - 발동 신호: 메트릭이 아니라 **요구사항 신호**: 보존 ≤90일 확정 · S3 미접근 규정 · staging
  - 관측 지점: 보존 정책·규정(운영 지표 아님)
  - 선행 단계/비고: 채택 후 헬스는 `system.disks` 사용률 <80% · 파티션당 active parts <300 · `system.merges` 정체 없음 `≈`. 보존이 길어지면 스토리지 델타가 발산하므로 S3 티어링으로 회귀(서울 단가·배수와 지평별 금액은 [용량 산정]({{< relref "../../hyperdx/07-capacity-planning.md" >}}) §4.6)
- **RF2→RF3**
  - 발동 신호: 요구사항 신호(임의 2대 유실 무손실 · AZ 무저하 · 규제) + **`insert_quorum:2` 상시 필요**
  - 관측 지점: reattach 창 실측치(§3 항목 4) · quorum 쓰기 차단 발생 여부
  - 선행 단계/비고: RF2에서 `insert_quorum:2`를 켜면 replica 1대가 reattach 중일 때 확정 가능 replica가 1이라 **쓰기가 차단**된다 — 이 조합이 상시 요구면 RF3가 짝입니다([배포 플레이북]({{< relref "../../clickhouse/04-deployment-playbook.md" >}}))
- **1 shard→shard 추가**
  - 발동 신호: hot 단일사본/노드가 실용 상한(예 4~8TB) 접근 · 머지/쿼리 CPU 지속 포화
  - 관측 지점: 노드별 `system.parts` `bytes_on_disk` 합 · 데이터 노드 CPU 지속 >70%(K8s/CloudWatch) `≈`
  - 선행 단계/비고: 선행은 replica 추가(읽기)·노드 사이즈업입니다. 신규 shard 스키마·리밸런싱은 **수동**([Altinity 운영]({{< relref "../../clickhouse/05-altinity-operations.md" >}}))
- **Keeper 3→5노드**
  - 발동 신호: 요구사항 신호: **2대 동시 손실 허용**이 요구일 때만
  - 관측 지점: — (부하 지표 아님)
  - 선행 단계/비고: Keeper 부하 신호(znode↑ · gp3 80%)는 5노드 승급 대신 **디스크 확장·작은 인서트 제거**로 대응한다 `≈` — Keeper 부하는 데이터량이 아니라 INSERT 빈도·파트 수 비례([Keeper]({{< relref "../../hyperdx/05-keeper.md" >}}))
- **MCK→Atlas 위임**
  - 발동 신호: `mongodump` CronJob 공백(미구축·실패 방치)
  - 관측 지점: CronJob 성공 여부 · 복원 리허설 결과
  - 선행 단계/비고: MCK(Community Operator)에는 **내장 백업이 없다** `✓` — 백업·PITR·멀티AZ를 자력으로 못 메우면 Atlas M10(≈$57/mo `≈`)이 그 공백을 turnkey로 제거한다([스택 토폴로지]({{< relref "../../hyperdx/01-stack-topology.md" >}}))

**cold 축은 "이동이 실제로 도는가"도 관측 대상입니다.** TTL MOVE가 도는지는 `system.storage_policies`(정책 로드)·`system.disks`(티어 등록)·`system.parts`의 `disk_name`(파트가 어느 티어에 있나)·`system.part_log`(이동 이력)를 조회해 확인합니다. 넷 다 표준 인터페이스입니다 `✓`([S3 티어링]({{< relref "../../hyperdx/03-s3-cold-tiering.md" >}}) 기준 문서). 이동이 멎으면 hot이 차오르며 아래 경보로 이어지므로 cold 축의 일상 헬스는 이 네 뷰가 담당합니다.

hot gp3의 일상 경보(승급이 아닌 운영 대응)는 [용량 산정]({{< relref "../../hyperdx/07-capacity-planning.md" >}}) §8의 기준을 씁니다. 사용률 **70% 경고 / 80% 조치 / 85% 하드실링**입니다. 조치는 gp3 온라인 확장 또는 TTL 단축·cold 이동 가속입니다 `≈` — 디스크가 차면 머지 중단→TOO_MANY_PARTS→인서트 차단으로 이어지므로 hot 볼륨은 항상 30~40% 여유를 남깁니다 `✓/≈`.

{{< flow src="_flow/2-승급-트리거의-관측-지점.json" />}}

## 3. 배포 전 실측 체크리스트 — `?` 9항목을 staging에서 `✓`로

아래 9개는 공개 실측이 없거나 문서 간 상충이 있어 전부 `?`(또는 `≈`)입니다. staging에서 측정해 `✓`로 승격합니다. 앞 4개가 캐파·복구 계열이고 뒤 5개는 cold 티어링을 켜기 전에 확인할 인증·네트워크 경로·볼륨 회수 계열입니다.

| # | 실측 항목 | 현재 | 측정 방법 | 승격 후 |
|---|---|---|---|---|
| 1 | 월 0.7TB = raw인가 on-disk인가 | `?` | `system.parts`의 월 `bytes_on_disk` 증가분 | `✓` — 배포 규모·비용 **2~3배** 확정 |
| 2 | 세션 리플레이 압축비(5x, 4~6x `≈`) | `?` | `system.parts` `uncompressed/on_disk` 비율 | `✓` — [용량 산정]({{< relref "../../hyperdx/07-capacity-planning.md" >}}) §2 산식 밴드 확정 |
| 3 | ClickStack 기본 TTL(`${TABLES_TTL}`, 문서상 3일) | `?` | `SHOW CREATE TABLE`로 실 TTL 확인 | `✓` — 오버라이드와 대조 |
| 4 | EBS reattach + part-load 실소요 | `?` | staging drain·강제종료 리허설 | `✓` — `reconcile.statefulSet.update.timeout` 튜닝 |
| 5 | CH 서버 disk의 IRSA `use_environment_credentials` 실동작(최소 버전·필수 env·`AWS_EC2_METADATA_DISABLED` 영향) | `?` | staging에서 cold 디스크를 실제로 붙여 자격증명 픽업 확인 | `✓` — 근거·설정은 [S3 티어링]({{< relref "../../hyperdx/03-s3-cold-tiering.md" >}}) §3.3이 소유 |
| 6 | `region` 명시 필수 여부의 정확한 실패 모드(STS regional endpoint 서명 오류) | `≈` | `region` 생략 구성으로 실패 재현 | `✓` — 실패 모드 확정([S3 티어링]({{< relref "../../hyperdx/03-s3-cold-tiering.md" >}}) §3.3) |
| 7 | **operator issue #1619** — CHI/CHK `reclaimPolicy: Retain` 미준수로 클러스터 삭제 시 볼륨 소실. 기준 버전 0.27.1의 수정 여부 | `?` | 릴리스 노트 확인 + staging에서 CHI 삭제 후 PV 잔존 확인 | `✓` — 수정 확인 전까지는 **StorageClass 레벨 Retain을 이중으로** 건다 |
| 8 | part metadata 로컬 소비량(part 수 비례) | `?` | staging cold 이동 후 로컬 잔존분 측정 | `✓` — hot 사이징 반영([S3 티어링]({{< relref "../../hyperdx/03-s3-cold-tiering.md" >}}) §5.1) |
| 9 | **S3 Gateway VPC Endpoint가 워커 노드 서브넷에 실제로 걸려 있나** | `?` | 아래 확인 명령 — 워커 노드 서브넷의 **라우팅 테이블 ID가 결과에 있어야 한다** | `✓` — 없으면 cold 트래픽이 NAT를 타 절감액이 잠식된다([S3 티어링]({{< relref "../../hyperdx/03-s3-cold-tiering.md" >}}) §3.4가 요금·근거 소유) |

항목 5·6·8은 근거와 설정이 기준 문서에 있으니 여기서는 **실측 여부만** 추적합니다 — 문장을 복제하지 않습니다. 항목 7만은 기준 문서에 대응물이 없어 이 표가 유일한 기재 지점입니다.

```bash
# 항목 9 — 서울 리전 S3 Gateway Endpoint 존재·연결 라우팅 테이블 확인
aws ec2 describe-vpc-endpoints --region ap-northeast-2 \
  --filters Name=service-name,Values=com.amazonaws.ap-northeast-2.s3
```

항목 1·2는 쿼리 하나로 같이 잡힙니다([용량 산정]({{< relref "../../hyperdx/07-capacity-planning.md" >}}) 기준 문서):

```sql
SELECT table,
       formatReadableSize(sum(bytes_on_disk))               AS on_disk,
       formatReadableSize(sum(data_uncompressed_bytes))     AS uncompressed,
       round(sum(data_uncompressed_bytes)/sum(bytes_on_disk),1) AS ratio
FROM system.parts
WHERE active AND database = 'default'
GROUP BY table ORDER BY sum(bytes_on_disk) DESC;
```

`ratio`가 시그널별 실제 압축비입니다. `on_disk`의 월 증가분이 해석 확정값입니다. 항목 4의 리허설은 graceful(cordon→drain: PDB 준수·자동 reattach)과 ungraceful(강제 종료: StatefulSet+RWO는 자동 복구가 안 되고 `out-of-service` taint 개입이 정석 `✓`) **두 갈래**로 합니다. 실소요는 hot 데이터량·파트 수에 좌우되며 아직 실측 전입니다 `?`([운영 런북]({{< relref "02-runbook.md" >}}) §5 · [토폴로지·다운타임]({{< relref "../../hyperdx/04-operator-topology-downtime.md" >}}) §5.1). staging 검증에는 버전 매트릭스 함정 하나를 더 넣습니다. 최신 operator가 기본 활성화하는 복제 설정은 Keeper 하한을 밀어올립니다. 우리는 CH/Keeper를 LTS로 핀하므로 그 조합이 실제로 도는지 확인해야 합니다 `?`. **어느 operator 버전이 어느 Keeper 하한을 요구하는지는 [버전·업그레이드]({{< relref "../../hyperdx/09-version-upgrade-compat.md" >}}) §1이 정본입니다** — 이 트랙은 숫자를 재기재하지 않습니다.

**왜 staging일까요 — 캐파상 이유.** 위 캐파 계열 4항목과 산정 모델의 `≈`(압축비·구성비 65/20/13/2)는 트래픽이 실제로 흘러야만 확정됩니다. staging은 샘플링 5~10% · RF1 · 짧은 TTL(cold 없음)로 극소화해도(~$150~250/mo `≈`) 이 실측이 전부 가능합니다. staging의 진짜 역할은 "동작 검증"이 아니라 **실측 캘리브레이션**입니다. 캐파 관점에서 staging을 두는 이유도 거기 있습니다([용량 산정]({{< relref "../../hyperdx/07-capacity-planning.md" >}}) §7).

{{% details title="staging 최소 형상 — 실측 캘리브레이션에 필요한 만큼만" closed="true" %}}
[용량 산정 §7]({{< relref "../../hyperdx/07-capacity-planning.md" >}}) 기준 문서의 요지입니다. **1× r7g.large**(2vCPU/16GB) + **Keeper 1**(단일; 또는 임베디드) + **MongoDB 1-member** + gp3 100~200GB 단일, cold 티어 없음(블록 온리가 자연스럽습니다 — storage XML·IRSA 생략). 세션 샘플링 5~10% 또는 QA 트래픽만으로 월 on-disk ~35~70GB(해석 B) `≈`. 압축비·세션당 바이트·TTL 실스키마·reattach 리허설이 이 형상에서 전부 측정됩니다. RF1·Keeper 1은 HA가 아니므로 staging 한정입니다.
{{% /details %}}

## 우리 케이스에서는

기본값 세트 — **HyperDX Only+Altinity CHI/CHK, 단일 gp3, S3 TTL MOVE(리플레이는 hot 30일 DELETE), 1 shard × RF2(2 AZ), Keeper 3노드(gp3·3 AZ), MongoDB `members:3`, CH/Keeper 24.8 LTS 핀** — 로 시작합니다. io2·block-only·RF3·shard·Keeper 5노드·Atlas는 §2의 관측 지점에서 해당 신호가 실제로 잡힐 때만 올립니다. 특히 io2는 gp3 provisioned throughput 상향이라는 선행 단계를 건너뛰고 갈 이유가 없습니다. RF3는 `insert_quorum:2` 상시 요구와 짝일 때만 의미가 있습니다.

착수 1번 작업은 §3의 9개 `?`를 staging에서 `✓`로 승격하는 것입니다 — 0.7TB 해석 하나에 배포 규모·비용이 2~3배 차이 나므로 이 실측 전의 모든 산정은 밴드로만 다룹니다. 업그레이드 축만은 승급이 아니라 **불가역**의 축입니다. 올리기 전 EBS 스냅샷이 유일한 되돌림이므로 매트릭스의 다른 축과 달리 "일단 올리고 관측"이 성립하지 않습니다. 시점 기준 2026-08.
