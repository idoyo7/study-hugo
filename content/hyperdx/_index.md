---
title: "HyperDX 내재화"
date: 2026-07-15
lastmod: 2026-08-24
weight: 70
cascade:
  type: docs
---

# HyperDX 내재화 — 실전 배포 청사진

[RUM 내재화]({{< relref "../rum/_index.md" >}})가 "왜·무엇으로 Datadog RUM에서 빠져나오나"를, [ClickHouse 운영]({{< relref "../clickhouse/_index.md" >}})이 "ClickHouse를 채택했다면 범용으로 어떻게 운영하나(how)"를 다뤘다면, 이 챕터는 그 사이를 잇는 **실전 운용 케이스**입니다 — HyperDX ClickStack을 **우리의 실제 RUM 워크로드**로 K8s(EKS)에 올리고 장애를 견디게 하고 용량을 산정하는 청사진. 전제는 아주 구체적으로 정해 둡니다: **RUM-only**(세션 리플레이·로그·트레이스·Web Vitals), **staging→prod 승급**, **EBS(gp3/io2)-first** 스토리지(로컬 NVMe는 옵셔널), 그리고 **prod 세션 샘플링 100% = 월 0.7TB** 규모입니다. 이 챕터는 이론·의사결정 대신 매니페스트·DDL·다운타임 타임라인·달러 산식을 그대로 노출합니다.

{{< callout type="info" >}}
핵심 결정부터 먼저 봅니다.

- 스택 조립: ClickStack 표준 2-Helm 차트를 그대로 쓰지 않고 `clickhouse.enabled: false`(자체(self-hosted) ClickHouse에 연결하는 **'HyperDX Only'**)로 붙입니다. ClickHouse/Keeper는 **Altinity operator(CHI/CHK)**로 분리 운영하고 HyperDX·OTel Collector·MongoDB만 차트/operator로 남깁니다. `✓`
- hot 스토리지: 기본은 **gp3 단일 볼륨**입니다. ClickHouse는 throughput-bound라 IOPS를 살 이유가 거의 없습니다. io2 Block Express는 극한 IOPS·sub-ms·볼륨 99.999%가 필요할 때만, 로컬 NVMe는 옵셔널 업그레이드 경로입니다. `✓/≈`
- cold 티어링: **S3 Standard + cache disk**를 쓰고 이동은 시간 기반 TTL `TO VOLUME 'cold'`입니다(`move_factor`는 안전판) `✓`. 인증은 IRSA인데, CH 서버 disk가 web-identity 자격증명을 런타임에 실제로 집어드는지는 배포 후 확인해야 합니다 `?`({{< relref "03-s3-cold-tiering.md" >}}).
- 조정 계층: **Keeper 3노드**(gp3 영속, 3 AZ). Keeper는 Kafka식 durable queue가 아닙니다 — CH가 죽으면 in-flight INSERT는 큐잉되지 않습니다. `✓`
- MongoDB: 메타데이터 전용이라 아주 작게 돌릴 수 있습니다. prod는 `members:3` 또는 Atlas가 값싼 보험입니다. 실효 바닥 사이징은 {{< relref "01-stack-topology.md" >}}가 정본입니다. `≈`
- 용량/비용: **월 0.7TB(on-disk 해석)** 기준이면 **1 shard × RF2**로 1년+ 버팁니다. hot·컴퓨트는 지평과 무관하게 고정입니다. 3→12개월 증분은 대부분 싼 S3 cold입니다. prod 월 **~$1.0~1.4K** `≈`(us-east-1 기준, 서울 ~10~15%↑).
{{< /callout >}}

## 이 챕터의 위치 — 전제 차이

study-hugo에는 이미 겹치는 주제의 깊은 문서가 있습니다. 이 챕터가 기존 문서와 **모순처럼 보이면 안 됩니다** — 특히 "로컬 NVMe vs EBS"는 규모·목표가 다른 별개 시나리오입니다. 어느 쪽이 옳은지 가릴 문제가 아닙니다. 아래 축으로 읽습니다.

| 축 | 기존 `clickhouse/` 운영 | 기존 `rum/` 내재화 | **이 챕터 `hyperdx/`** |
|---|---|---|---|
| 질문 | CH 채택 시 범용 운영법(how) | RUM 왜·무엇 내재화(도입 실사) | HyperDX **실전 배포·운영**(실전 케이스) |
| 전제 스토리지 | **로컬 NVMe(i7i/i8g) 1차** + S3 cold | — | **EBS(gp3/io2) 1차** + S3 cold(NVMe 옵셔널) |
| 규모 전제 | 20TB+·성능 극대화·상시 가동·인력 보유 | — | **RUM-only, 월 0.7TB**, staging→prod |
| 성격(톤) | 이론·의사결정·"채택했다면" | 비교·매트릭스·마이그레이션 | **실전 운용** — 실제 배포·장애·산정 |

{{< callout type="warning" >}}
**두 스토리지 전략은 충돌이 아닙니다.** [로컬 NVMe 문서]({{< relref "../clickhouse/02-storage-local-nvme.md" >}})는 20TB+·성능 극대화를 전제로 출발하고, 이 챕터는 0.7TB/월·운영 단순성·내구성 우선을 전제로 EBS를 1차로 둡니다. EBS-first의 값어치는 성능이 아니라 재수화가 필요 없다는 운영 프로파일입니다 — 이벤트별 재수화 필요 여부와 재수화 위험 창은 [hot 스토리지·EBS]({{< relref "02-hot-storage-ebs.md" >}})가 정본이고 창의 정의·MTTR 산식은 로컬 NVMe 문서가 소유합니다. 노드가 유실될 때의 물리 역학은 {{< relref "04-operator-topology-downtime.md" >}}입니다.
{{< /callout >}}

**operator 분기(중요)** — 표준 Helm 2-차트가 딸려 오는 ClickHouse operator는 Altinity가 아니라 **ClickHouse Inc.의 공식 operator**입니다. 우리는 `clickhouse.enabled: false`(HyperDX Only)로 ClickHouse를 차트 밖으로 빼 **Altinity operator의 CHI/CHK**로 분리 운영합니다 `✓`. 이 챕터 전체가 이 전제 위에 있습니다 — CRD 이름·채택 근거·이 분기를 흐렸을 때의 오독은 {{< relref "01-stack-topology.md" >}}와 [operator 선택]({{< relref "../clickhouse/03-operator.md" >}})이 정본입니다.

{{< callout type="info" >}}
**배포 모드 이름 — 섞으면 결론이 뒤집힙니다** `✓`

- "BYOD"는 공식 문서에도 이 레포에도 없는 말입니다. 어디서 흘러든 표현이든, 아래 셋 중 무엇을 가리키는지 먼저 구분해야 합니다.
- 공식 표현은 ClickStack Docker Compose 문서의 "BYO ClickHouse"와 HyperDX Only 문서의 "already have a running ClickHouse instance"입니다. 둘 다 "이미 돌고 있는 CH에 붙인다"는 같은 뜻입니다.
- 우리 표현은 "HyperDX Only"(`clickhouse.enabled: false`)이고 이 챕터·트랙 전체가 이 표기를 씁니다.
- BYOC(Bring Your Own Cloud)는 ClickHouse Cloud 상품이라 완전히 다른 축입니다. 이걸 self-host로 착각하면 결론이 반대로 뒤집힙니다 — managed와 self-host의 부품 경계는 [managed vs self-host]({{< relref "../clickhouse/01-managed-vs-selfhosted.md" >}})입니다.
{{< /callout >}}

## 핵심 결정 요약

| 축 | 결정 |
|---|---|
| 스택 조립 | HyperDX-only + Altinity CHI/CHK + MongoDB(MCK 또는 Atlas) |
| hot 스토리지 | 단일 gp3(baseline IOPS + 인스턴스 baseline에 맞춘 소량 throughput) |
| io2 / 로컬 NVMe | io2는 필요 시 각주, 로컬 NVMe는 업그레이드 경로 |
| cold 티어링 | S3 Standard + cache disk, 시간 기반 TTL MOVE, IRSA |
| 토폴로지 | **1 shard × RF2**(2 AZ), RF3는 트리거 승급 |
| 조정 계층 | Keeper 3노드(gp3 영속, 3 AZ) |
| ingest 신뢰성 | OTel Collector persistent queue + `async_insert=1, wait=1` + dedup |
| MongoDB | 메타데이터 전용 최소 규모, prod는 `members:3`/Atlas + SCRAM + mongodump |
| CH 버전 | 예제는 **24.8 LTS**(ClickStack 24.8+ 요구) |
| 용량·비용 | on-disk 해석 1차, 지평별(3/6/12개월) 워크드 모델 |

각 결정의 근거·조건:

- 스택 조립 — 표준 차트=공식 operator를 회피, CH를 범용 분석과 일원화 `✓` → {{< relref "01-stack-topology.md" >}}
- hot 스토리지 — ClickHouse는 throughput-bound, 인스턴스 EBS 파이프가 볼륨보다 먼저 천장 `✓/≈` → {{< relref "02-hot-storage-ebs.md" >}}
- io2 / 로컬 NVMe — gp3 99.9% + RF 복제로 충분, io2 99.999%는 이 스케일에 과잉 `≈`
- cold 티어링 — Glacier 전환 금지, `{replica}` 경로 분리(shared-nothing) `✓` → {{< relref "03-s3-cold-tiering.md" >}}
- 토폴로지 — 0.7TB/월엔 shard가 부채, EBS는 노드 급사가 데이터 소실이 아님 `≈` → {{< relref "04-operator-topology-downtime.md" >}}
- 조정 계층 — 정족수 3(1 장애 허용), Keeper는 큐가 아님 `✓` → {{< relref "05-keeper.md" >}}
- ingest 신뢰성 — in-flight 유실은 Keeper가 아니라 앞단 큐·클라 재시도로 방어 `✓` → {{< relref "05-keeper.md" >}}
- MongoDB — 부하는 데이터량 아닌 사용자·설정 수에 비례, 인제스트 경로 밖 `≈` → {{< relref "01-stack-topology.md" >}}
- CH 버전 — 차트 기본 태그는 관찰값으로만 `✓`
- 용량·비용 — hot·컴퓨트 고정 + 증분은 S3 cold `≈` → {{< relref "07-capacity-planning.md" >}}

## 우리 케이스 청사진 (한 장 토폴로지)

{{< flow src="_flow/우리-케이스-청사진-한.json" />}}

RUM 인제스트 경로에 **MongoDB는 없습니다** — 브라우저 SDK가 OTel Collector로 직접 보내고 MongoDB는 UI에서 대시보드·알럿·소스를 만들 때만 쓰입니다. 그래서 MongoDB 다운은 "관측 정지"가 아니라 "**설정·알럿·UI 정지**"입니다. 이 구조라서 MongoDB를 아주 작게 돌려도 됩니다 `✓`. 포트·컴포넌트별 역할·세션 리플레이 적재 테이블은 {{< relref "01-stack-topology.md" >}}가 정본입니다.

## 이 챕터 구성 (문서 지도)

- [HyperDX 직접 운영하기]({{< relref "../hyperdx-operating/_index.md" >}}) · 운영 트랙(**3부**, 별도 챕터) — 이 챕터가 표준을 소유한다면 그 트랙은 **우리 클러스터의 현황 → 사건 시 순서 → 승급 판단**을 소유합니다: ①{{< relref "../hyperdx-operating/01-our-deployment.md" >}}(우리 배포 형상) ②{{< relref "../hyperdx-operating/02-runbook.md" >}}(운영 런북) ③{{< relref "../hyperdx-operating/03-decision-guide.md" >}}(의사결정 가이드). 버전·수치·용량·요금은 트랙이 재기재하지 않고 아래 기준 문서 01~09·출처 10을 가리킵니다.
- {{< relref "01-stack-topology.md" >}} · ClickStack 4컴포넌트 배포 토폴로지·데이터 흐름, OTel Collector 배치/사이징, **MongoDB 최소 규모 배포·운영**. 4컴포넌트/배포 6모드는 {{< relref "../rum/01-hyperdx-deep-dive.md" >}}, MongoDB 부하 프로파일은 {{< relref "../rum/07-hyperdx-mongodb.md" >}}에 위임.
- {{< relref "02-hot-storage-ebs.md" >}} · **gp3 vs io2 vs io2 Block Express** 실전 상세, ClickHouse I/O 적합성, 왜 EBS-first, operator StorageClass/VolumeClaimTemplate. 로컬 NVMe 상세·EBS 대역 한계는 {{< relref "../clickhouse/02-storage-local-nvme.md" >}}에 위임.
- {{< relref "03-s3-cold-tiering.md" >}} · **S3 cold worked example**: storage_configuration 전문·TTL MOVE DDL·IRSA·우리 RUM 테이블 튜닝. 티어링≠내구성·zero-copy 금지는 {{< relref "../clickhouse/02-storage-local-nvme.md" >}}에 위임.
- {{< relref "04-operator-topology-downtime.md" >}} · **사고 진입점** — **컴포넌트별 가용성 종합**(무엇이 죽으면 무엇이 멈추나·blast radius·무손실 2트랙, 전에는 01 §7과 운영 트랙에 갈라져 있던 축의 정본) + EBS 기반 replication/sharding + **다운타임 상세 시나리오**(재부착·rolling·PDB·AZ 장애·ungraceful death). CHI/CHK 필드·스케일 함정·롤링 업그레이드는 {{< relref "../clickhouse/04-deployment-playbook.md" >}}·{{< relref "../clickhouse/05-altinity-operations.md" >}}에 위임.
- {{< relref "05-keeper.md" >}} · Keeper 상세: Raft·저장/비저장, **"큐가 아니다" 정정**, async_insert 세만틱, 유실 방지 설계. 정족수 산술·CHK 매니페스트·쓰기 내구성 노브는 {{< relref "../clickhouse/04-deployment-playbook.md" >}}에 위임.
- {{< relref "06-replication-failover.md" >}} · **복제 구조·멀티마스터·중단/failover**: RMT pull 복제, 승격 없는 failover, ZooKeeper/Keeper 복제 역할, split-brain 방지, RF2+consolidation 안전성. 다운타임 물리 역학은 {{< relref "04-operator-topology-downtime.md" >}}, Keeper 자체는 {{< relref "05-keeper.md" >}}에 위임.
- {{< relref "07-capacity-planning.md" >}} · **월 0.7TB RUM 워크드 모델**: 압축비·raw vs on-disk·3/6/12개월·hot/cold·RF·gp3 vs io2·TTL·비용. RF 선택 확률·insert_quorum은 {{< relref "../clickhouse/04-deployment-playbook.md" >}}에 위임.
- {{< relref "08-block-only-tuning.md" >}} · **블록 스토리지 온리(무 S3)**: 단일 `default` 정책·TTL DELETE-only·gp3 온라인 확장·merge/background 풀 튜닝·블록온리 vs S3 선택. hot gp3 스펙은 {{< relref "02-hot-storage-ebs.md" >}}, S3 티어링은 {{< relref "03-s3-cold-tiering.md" >}}, 사이징은 {{< relref "07-capacity-planning.md" >}}에 위임.
- {{< relref "09-version-upgrade-compat.md" >}} · **버전 호환·업그레이드**: 6구성요소 호환 매트릭스·`compatibility` 설정·다운그레이드 비지원·EBS 스냅샷 롤백·ClickStack v1→v2. 일반 CH/operator/Keeper 업그레이드 런북은 {{< relref "../clickhouse/05-altinity-operations.md" >}}에 위임.
- {{< relref "10-sources.md" >}} · 출처 URL 모음(분류 표).

## 자매 챕터

- [우리 배포 형상]({{< relref "../hyperdx-operating/01-our-deployment.md" >}}) — **우리 케이스**: 실제 RUM 수집 스택 종합도(자체 RUM 컨버터 포함)·실행 단위 분할·컴포넌트별 HA·stage/prod 격차. 이 챕터는 표준을 다루므로 우리 형상을 섞지 않으려고 운영 트랙으로 옮겼습니다(R1). 표준 4컴포넌트·가용성·Keeper·복제는 {{< relref "01-stack-topology.md" >}}·{{< relref "04-operator-topology-downtime.md" >}}·{{< relref "05-keeper.md" >}}·{{< relref "06-replication-failover.md" >}}가 소유합니다.
- [ClickHouse 운영]({{< relref "../clickhouse/_index.md" >}}) — ClickHouse 범용 운영 how(operator 선택·로컬 NVMe·배포 플레이북·스케일/롤링). 이 챕터가 relref로 위임하는 대부분의 배경이 여기 있습니다.
- [RUM 내재화]({{< relref "../rum/_index.md" >}}) — Datadog RUM에서 빠져나오는 why/what(비교·매트릭스·마이그레이션). 이 챕터의 상류.
- [HyperDX/ClickStack 심층]({{< relref "../rum/01-hyperdx-deep-dive.md" >}}) — HyperDX 4컴포넌트·배포 6모드·HyperDX Only 의존성의 기준 문서.
- [HyperDX(ClickStack) — 로깅 관점]({{< relref "../logging/05-hyperdx-clickstack.md" >}}) — 로그 내재화 후보로서의 ClickStack 요약 판단.

## 우리 케이스에서는

**HyperDX-only + Altinity CHI/CHK + MongoDB(MCK 또는 Atlas)** 로 조립하고, hot은 **단일 gp3**, cold는 **S3 + TTL MOVE**, 조정은 **Keeper 3노드**, 토폴로지는 **1 shard × RF2(2 AZ)** 로 시작합니다. io2·로컬 NVMe·RF3·샤딩은 전부 **트리거 기반 승급**으로 미뤄둡니다 — 0.7TB/월 규모에서 조기 수평 확장·고성능 스토리지는 비용과 운영 부채만 남깁니다.

배포 전에 확정해야 할 것이 아직 `≈`·`?`로 남아 있습니다. **"월 0.7TB"의 해석(raw ingest냐 on-disk냐)**, 그리고 **세션 리플레이 압축비·구성비·ClickStack 기본 TTL**입니다. 해석 분기가 배포 규모·비용에 어떻게 번지는지, 그리고 무엇을 어떤 쿼리로 실측해 `✓`으로 올리는지는 [용량 산정]({{< relref "07-capacity-planning.md" >}})이 정본입니다 — 캐파 관점에서 staging을 두는 이유가 이 실측 한 번입니다. 시점 기준 2026-08.

> **근거 표기 범례**: `✓` 확인됨(1차 출처 검증) · `≈` 추정 · `Ⓥ` 벤더 주장 · `?` 미확인 · `Ⓑ` 퍼블릭 벤치마크 · `Σ` 종합 판단. `⁽ ⁾`는 부가 설명, `✓/≈`처럼 병기하면 혼재를 뜻합니다.
