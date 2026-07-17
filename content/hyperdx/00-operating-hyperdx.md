---
title: "HyperDX 직접 운영하기"
weight: 0
---

# HyperDX 직접 운영하기 — 로드맵

이 카테고리는 HyperDX ClickStack을 우리 RUM 워크로드로 실제 배포·운영하는 청사진을 10개 문서에 나눠 담았다. 각 주제의 정본은 링크된 문서에 있고, 이 페이지는 그 위에 **"직접 운영하려면 어떤 순서로 무엇을 이해해야 하나"**를 세우는 로드맵/오버뷰다. 세부를 재서술하지 않고 **큰 그림 + 읽는 순서 + 각 결정의 근거만** 짚은 뒤 relref로 위임한다.

이 로드맵을 관통하는 원칙 하나: **모든 결정을 "왜/어떻게 안전한가"와 함께 본다.** 배포·스토리지·토폴로지·조정 계층의 기본값을 정할 때마다 "이 기본값이 어떤 장애를 어떻게 견디나", "이 규모에 왜 충분한가", "무엇이 승급 트리거인가"를 같은 자리에서 판단한다 — 안전·충분의 근거 없이 기본값만 나열하면 규모가 커질 때 무엇을 올려야 할지 판단할 수 없기 때문이다.

{{< callout type="info" >}}
**한눈에 — 6단계**

1. **솔루션 아키텍처** — ClickStack 4컴포넌트를 `clickhouse.enabled:false`(BYO)로 붙여 CH/Keeper만 Altinity로 분리. RUM 인제스트에 MongoDB 없음. → {{< relref "01-stack-topology.md" >}}
2. **데이터 티어링** — hot=EBS gp3 + cold=S3 TTL MOVE, 리플레이는 hot만·30일 DELETE, S3 없는 block-only 대안. → {{< relref "02-hot-storage-ebs.md" >}}·{{< relref "03-s3-cold-tiering.md" >}}·{{< relref "08-block-only-tuning.md" >}}
3. **무엇을 어떻게 관리하나 — 컴포넌트별 가용성** — 가용성 매트릭스·blast radius·무손실 2트랙. **별도 문서가 아니라 01의 §7.** → {{< relref "01-stack-topology.md" >}}(§7)
4. **operator 패턴 — 클러스터 위 운영 난이도** — 복제·다운타임·Keeper 정족수(쓰기 SPOF)·버전/업그레이드를 Altinity CHI/CHK로 얹는 난이도, EBS-first가 낮추는 법. → {{< relref "04-operator-topology-downtime.md" >}}·{{< relref "05-keeper.md" >}}·{{< relref "06-replication-failover.md" >}}·{{< relref "09-version-upgrade-compat.md" >}}
5. **규모 산정** — 0.7TB/월(raw vs on-disk)·블렌디드 압축비·리플레이 안 쌓임·3/6/12개월 hot/cold·RF·비용. → {{< relref "07-capacity-planning.md" >}}
6. **의사결정 가이드** — 결정 매트릭스(기본값·왜 안전/충분·승급 트리거) + 배포 전 실측 체크리스트. → 이 페이지 §의사결정 가이드
{{< /callout >}}

## 권장 읽기 순서

파일을 리넘버하지 않으므로 **파일 번호 ≠ 읽기 순서**다. 아래 순서로 읽기를 권한다.

| 순서 | 문서(relref) | 부 | 한 줄 |
|---|---|---|---|
| 1 | {{< relref "01-stack-topology.md" >}} | 1부 아키텍처(+ §7 = 3부 관리) | 4컴포넌트 배치·BYO 분기·MongoDB 최소 배포·가용성 종합 |
| 2 | {{< relref "02-hot-storage-ebs.md" >}} | 2부 티어링 | hot=gp3, io2/로컬 NVMe는 각주, EBS-first의 값어치 |
| 3 | {{< relref "03-s3-cold-tiering.md" >}} | 2부 티어링 | cold=S3 worked example·TTL 정본·IRSA |
| 4 | {{< relref "08-block-only-tuning.md" >}} | 2부 티어링(S3 없는 대안) | 블록 온리 델타·DELETE-only·머지 풀 튜닝 |
| 5 | {{< relref "04-operator-topology-downtime.md" >}} | 4부 operator 패턴 | EBS 재부착이 바꾸는 복구 모델·다운타임 S1~S9 |
| 6 | {{< relref "05-keeper.md" >}} | 4부 operator 패턴 | 조정 계층이지 durable queue가 아니다 |
| 7 | {{< relref "06-replication-failover.md" >}} | 4부 operator 패턴 | 멀티마스터·승격 없는 failover·split-brain 방지 |
| 8 | {{< relref "09-version-upgrade-compat.md" >}} | 4부 operator 패턴 | 6구성요소 버전 매트릭스·다운그레이드 비지원·EBS 스냅샷 롤백 |
| 9 | {{< relref "07-capacity-planning.md" >}} | 5부 규모 산정 | 월 0.7TB 워크드 모델·리플레이는 안 쌓인다 |
| 10 | {{< relref "10-sources.md" >}} | 출처 | 1차 조사 URL 분류 |

> **파일 번호는 기존 배포를 유지하느라 그대로 두었고, 위 '읽기 순서'가 이 로드맵이 권하는 순서다(08·07이 번호와 다른 위치에 오는 이유). 3부(관리)는 별도 문서가 아니라 01의 §7이라 01을 읽을 때 함께 본다.**

## 1부 — 솔루션 아키텍처

ClickStack은 **HyperDX(app+api) · OTel Collector · ClickHouse · MongoDB** 4컴포넌트를 2개 Helm 차트로 얹는다. 우리는 표준 차트를 그대로 쓰지 않고 `clickhouse.enabled: false`(**BYO**)로 CH/Keeper를 차트 밖으로 빼, ClickHouse Inc. 공식 operator가 아니라 **Altinity CHI/CHK**로 분리 운영한다 — 범용분석 CH와 운영 체계를 하나로 일원화하기 위해서다 `✓`. 브라우저 RUM SDK는 HyperDX api가 아니라 OTel Collector(`:4318`)로 직접 텔레메트리를 보내고, 세션 리플레이는 ClickHouse `hyperdx_sessions` 테이블로 적재된다 — **RUM 인제스트 경로에 MongoDB는 없다** `✓`.

**왜 안전한가**: 컴포넌트 경계가 분리돼 있어 하나가 죽어도 전체가 멈추지 않는다(§3부). 특히 인제스트 경로에 MongoDB가 없다는 사실이 "MongoDB 다운 = 관측 정지"가 아니라 "설정·알럿·UI 정지"임을 보장하고, MongoDB를 아주 작게 돌려도 되는 구조적 근거가 된다. 4컴포넌트 배치·데이터 흐름·MongoDB 최소 규모 배포는 {{< relref "01-stack-topology.md" >}}가 정본이다.

## 2부 — 데이터 티어링

hot 데이터의 정답은 **노드당 단일 gp3 볼륨**(baseline IOPS + 인스턴스 baseline에 맞춘 소량 throughput)이다. ClickHouse는 throughput-bound이고 인스턴스 EBS 파이프가 볼륨보다 먼저 천장이라, 0.7TB/월 규모에서 gp3를 상한까지 올리거나 스트라이핑할 이유가 없다 — io2·로컬 NVMe는 트리거 승급용 각주다({{< relref "02-hot-storage-ebs.md" >}}). cold는 **S3 Standard + cache disk**로, 이동은 **시간 기반 TTL `TO VOLUME 'cold'`**(`move_factor`는 안전판만)로 한다. 리플레이는 볼륨을 지배하면서도 유용 수명이 짧아 **S3에 안 내리고 hot 30일 후 DELETE**한다({{< relref "03-s3-cold-tiering.md" >}}). S3를 아예 쓰지 않는 **block-only(EBS 단일 티어)**는 짧은 보존·staging·규정상 S3 금지 경로의 대안이다({{< relref "08-block-only-tuning.md" >}}).

**왜 안전한가**: **티어링은 내구성이 아니다** — 데이터 내구성은 티어링이 아니라 멀티 AZ RF 복제 + 백업이 담당한다. cold(S3)도 `{replica}` 경로에 **RF배수 사본**을 두는 shared-nothing이고(UltraWarm식 단일사본 절감은 self-host에 없음), zero-copy replication은 프로덕션 금지다 `✓`. hot=gp3의 99.9% 볼륨 내구성은 데이터 안전이 아니라 볼륨을 안 잃을 확률일 뿐이라, RF 복제가 없으면 무의미하다.

## 3부 — 무엇을 어떻게 관리하나 (컴포넌트별 가용성)

3부는 별도 문서가 아니라 **{{< relref "01-stack-topology.md" >}}의 §7**이다 — 01을 읽을 때 함께 본다. 각 컴포넌트를 (a)무슨 역할인지, (b)죽으면 무엇이 멈추는지, (c)HA·스케일이 되는지, (d)무손실을 어떻게 지키는지 한 장으로 종합한 절이다 `Σ`. 핵심은 **어느 하나의 다운도 "전체 관측 정지"가 아니다**라는 blast radius 판단이다: app 다운은 UI·쿼리만, Collector 다운은 신규 ingest만(퍼시스턴트 큐가 완충), MongoDB 다운은 설정·알럿·UI만 멈춘다. 광범위한 정지는 **CH 전체 다운**(저장 원천)과 **Keeper 정족수 상실**(쓰기 경로) 둘뿐이다.

**왜 안전한가**: 무손실 방어가 성격이 다른 **두 트랙**으로 갈린다 — 트랙 1(텔레메트리)은 OTel Collector `file_storage` 퍼시스턴트 큐 + CH RMT 복제(+`insert_quorum`)로, 트랙 2(메타데이터)는 MongoDB ReplicaSet + `mongodump`로 지킨다. Keeper 정족수는 트랙 1의 **쓰기 가용성**을 좌우할 뿐 그 자체가 이벤트 데이터를 보관하지 않는다({{< relref "05-keeper.md" >}}). 이 두 트랙과 blast radius를 구분해야 "무엇을 지켜야 하나"의 우선순위가 선다. Keeper·복제의 자세한 메커니즘은 {{< relref "05-keeper.md" >}}·{{< relref "06-replication-failover.md" >}}로 이어진다.

## 4부 — operator 패턴 (클러스터 위 운영 난이도)

Altinity CHI/CHK로 클러스터를 얹으면 그 위에서 **복제·다운타임·Keeper 정족수·버전/업그레이드**라는 운영 난이도가 실제로 발생한다. 기본 토폴로지는 **1 shard × RF2(2 AZ)** + CHK 3노드(3 AZ)이고, 복제는 승격 없는 멀티마스터라 replica 하나가 죽어도 살아있는 replica가 read+write를 계속한다({{< relref "06-replication-failover.md" >}}). 이 아키텍처의 진짜 SPOF는 데이터 노드가 아니라 **Keeper 정족수**다 — 과반을 잃으면 데이터 노드가 멀쩡해도 CH가 read-only로 전락한다(쓰기 SPOF, {{< relref "05-keeper.md" >}}). 버전은 6개 구성요소가 독립적으로 돌므로 각자 별도 케이던스로 올리고, 다운그레이드는 온디스크 포맷 변경 이후 사실상 불가하다고 가정한다({{< relref "09-version-upgrade-compat.md" >}}). CHI/CHK 필드·스케일 함정·롤링 순서의 일반 런북은 {{< relref "../clickhouse/05-altinity-operations.md" >}}가 정본이다.

**어떻게 안전한가**: EBS-first가 난이도를 근본적으로 낮춘다 `≈`. ① 노드 급사가 데이터 소실이 아니라 **볼륨 reattach + 델타 catch-up**(수 분)이라, 로컬 NVMe의 전량 재수화(수 시간, RF2→실질 RF1)가 사라진다({{< relref "04-operator-topology-downtime.md" >}}). ② **RF2 + anti-affinity(hostname) + topologySpread(AZ) + PDB(maxUnavailable 1)**가 자발적 중단을 직렬화해 consolidation·롤링을 "한 번에 한 replica"로 막는다. ③ **Keeper 3노드 정족수**(gp3 영속·3 AZ)가 1대 손실을 견디고, gp3라 급사해도 Raft 메타가 살아남아 reattach로 복구된다. ④ 업그레이드는 직전 **EBS 스냅샷 + `clickhouse-backup` 이중 안전**으로 replica 단위 롤백이 성립한다({{< relref "09-version-upgrade-compat.md" >}}). 단 EBS는 **AZ-bound**라 AZ 장애는 reattach로 못 풀고 cross-AZ RF만이 방어한다 — AZ 분산이 타협 불가인 이유다.

## 5부 — 규모 산정

캐파의 첫 갈림길은 **"월 0.7TB가 raw ingest냐 on-disk(압축 후)냐"**다 — 이 해석에 배포 규모·비용이 2~3배 갈린다({{< relref "07-capacity-planning.md" >}}). on-disk 해석 B를 1차 모델로 삼되, 시그널별 블렌디드 압축비(~6x)를 산식으로 노출해 재계산 가능하게 하고, 배포 후 `system.parts`로 1회 실측해 확정한다. 가장 큰 지렛대는 **리플레이가 on-disk의 ~78%를 먹지만 30일 DELETE라 누적되지 않는다**는 것이다 — "0.7TB×12=8.4TB" 순진한 누적은 틀리고, 실제 1년 누적(단일사본)은 ~2.35TB다 `≈`. hot·컴퓨트는 보관 지평과 무관하게 고정되고(hot gp3 ~2TB, 2× r7g.2xlarge), 3→12개월 증분은 거의 전부 싼 S3 cold다.

**왜 충분한가**: 이 규모의 인제스트 피크는 ~8 MB/s로 CPU·I/O 모두 여유라, **1 shard × RF2로 1년+ 충분**하고 gp3로 충분하다(io2 트리거는 도달 안 함). 샤딩은 이 규모에서 부채이므로 불필요하고, Keeper 3노드·MongoDB 3멤버는 데이터량과 무관하게 소형 고정이다. prod 월 ~$1.0K(us-east-1, RF3 시 ~$1.5K, 서울 +10~15%) `≈`.

## 6부 — 의사결정 가이드

### 결정 매트릭스

각 축의 기본값을 "왜 안전/충분한가"와 "무엇이 승급 트리거인가"와 함께 못박는다.

| 축 | 기본값 | 왜 안전/충분 | 승급 트리거 |
|---|---|---|---|
| 배포 | **BYO(`clickhouse.enabled:false`) + Altinity CHI/CHK** | 공식 operator 2종 공존 회피, 범용분석 CH와 일원화 `✓` | — (구조 선택) |
| hot 스토리지 | **단일 gp3**(baseline IOPS + 소량 throughput) | throughput-bound + 인스턴스 파이프가 먼저 천장, RF 복제가 내구성 담당 `✓/≈` | **io2**: >2,000 MiB/s 지속·>80,000 IOPS/vol·볼륨 99.999% 규제 |
| cold 티어링 | **S3 TTL MOVE**(또는 **block-only**) | 긴 보존이 싼 이유는 S3에 쌓이고 리플레이는 30일 캡 `≈` | **block-only**: 짧은 보존(≤90일)·S3 미접근/규정·운영 단순성(staging) |
| 토폴로지 | **1 shard × RF2(2 AZ)** | EBS는 노드 급사가 reattach라 실질 RF1 창이 수 분 `≈` | **RF3**: AZ 무저하 요구·`insert_quorum:2` 상시·규제 / **shard**: 노드 실용 상한 접근 |
| 조정 계층 | **Keeper 3노드(gp3 영속, 3 AZ)** | 정족수 3(1 장애 허용), gp3라 급사해도 Raft 메타 생존 `✓` | 5노드(2대 손실 허용이 요구일 때) |
| MongoDB | **최소 규모·prod `members:3`**(또는 Atlas) | 부하는 데이터량 아닌 설정 수 비례, 인제스트 경로 밖 `≈` | Atlas 위임(백업 공백 제거) |
| 업그레이드 | **LTS(24.8) 핀 + EBS 스냅샷 롤백** | 최신 추종 회피로 롤링 빈도↓, 스냅샷이 유일 확실 롤백 `✓/≈` | — (다운그레이드는 "없다고 가정") |

### 배포 전 실측 체크리스트

아래 4개는 공개 실측이 없거나 문서 간 상충이 있어 전부 `?`다 — staging에서 측정해 `✓`으로 승격하는 것이 staging을 두는 캐파상 이유다.

| 실측 항목 | 현재 | 측정 방법 | 승격 후 |
|---|---|---|---|
| 월 0.7TB = raw인가 on-disk인가 | `?` | `system.parts`의 월 `bytes_on_disk` 증가분 | `✓` — 배포 규모·비용 2~3배 확정 |
| 세션 리플레이 압축비(모델 5x) | `?` | `system.parts` `uncompressed/on_disk` 비율 | `✓` — §5부 산식 밴드 확정 |
| ClickStack 기본 TTL(`${TABLES_TTL}`) | `?` | `SHOW CREATE TABLE`로 실 TTL 확인 | `✓` — 우리 권장 오버라이드와 대조 |
| EBS reattach + part-load 실소요 | `?` | staging 노드 drain·강제 종료 리허설 | `✓` — `reconcile.statefulSet.update.timeout` 튜닝 |

## 우리 케이스에서는

**BYO + Altinity CHI/CHK**로 조립하고 hot은 **단일 gp3**, cold는 **S3 TTL MOVE**(리플레이는 hot만·30일 DELETE), 조정은 **Keeper 3노드**, 토폴로지는 **1 shard × RF2(2 AZ)**로 시작한다. 모든 기본값을 "왜 안전/충분한가"와 함께 정했으므로 — 안전은 EBS reattach·RF 복제·정족수·스냅샷 롤백이, 충분은 0.7TB/월의 낮은 인제스트가 보장한다 — io2·RF3·shard·block-only는 결정 매트릭스의 승급 트리거를 실제로 넘길 때만 올린다. 배포 전 4개 실측 항목(`?`)을 staging에서 `✓`으로 승격하는 것을 착수 1번 작업으로 둔다.

---

**근거 표기 범례**: `✓` 확인 · `≈` 추정 · `Ⓥ` 벤더 · `?` 미확인 · `Ⓑ` 벤치 · `Σ` 종합. 병기 `✓/≈`는 혼재, 위첨자 `⁽ ⁾`는 부가 설명. 시점 기준 2026-07.
