---
title: "우리 배포 형상 — 자체 RUM 컨버터·6 실행 단위·stage/prod 격차"
date: 2026-08-13
lastmod: 2026-08-24
weight: 1
aliases: ["/hyperdx/11-our-rum-ingest/", "/hyperdx-operating/01-architecture/", "/hyperdx/operating/01-architecture/"]
---

# 우리 배포 형상 — 자체 RUM 컨버터·6 실행 단위·stage/prod 격차

{{< callout type="info" >}}
우리가 실제로 돌리는 것은 표준 조립에 컴포넌트 하나가 더 붙은 형상입니다.

- 구성: 자체 개발 RUM 컨버터 + ClickStack(HyperDX Only) + Altinity operator(ClickHouse·Keeper) `✓`.
- 인제스트 경로는 둘이고 ClickHouse에서 합류합니다 — ① RUM(브라우저 SDK·Mobile RUM)은 자체 컨버터가 ClickHouse에 직접 적재하고(Datadog Agent의 RUM 전송 방식을 참조해 구현), ② 표준 텔레메트리는 OTel Collector가 적재합니다. 컨버터와 Collector는 서로 직접 호출하지 않습니다 `✓`.
- 실행 단위는 표준 조립대로 5개, 우리 실제로는 6개입니다 — 차이는 자체 RUM 컨버터 하나입니다(§2) `✓`.
- HA 설계 목표: ClickHouse RF2(2 AZ) + `insert_quorum`, Keeper 3노드 정족수(client 2181), MongoDB `members:3`. 이 수치는 prod 목표입니다 `≈`. 현재 실제 배포는 stage 축소판입니다 `✓`.
- 지금 stage는 EBS gp3 단일 티어라 사실상 블록 온리 형상입니다 — 그 형상 자체의 손익·튜닝은 [블록 온리 튜닝]({{< relref "../../hyperdx/08-block-only-tuning.md" >}})이 기준 문서입니다 `✓`.
{{< /callout >}}

{{< callout type="warning" >}}
stage 실제 vs prod 목표 — 현재 hdx는 stage 전용입니다(`values/stage/chain/hdx.yaml`만 있고 prod values 없음) `✓`. 아래 규모·HA는 대부분 prod 목표 설계이며 실제 돌아가는 건 그 축소판입니다.

| 항목 | prod 목표 | stage 실제 |
| --- | --- | --- |
| hdx replicas | 2+ `≈` | **1** `✓` |
| ClickHouse replica | RF2 (2) `≈` | **Phase 1은 1** (values는 RF2) `✓` |
| MongoDB | `members:3` `≈` | **`members:1`** `✓` |
| OTel Collector 큐 | `file_storage` 퍼시스턴트 큐 `≈` | **인메모리 큐만** (미구성 → 재시작 시 in-flight 유실 리스크) `✓` |
| 스토리지 | hot gp3 + cold S3 (검토) `≈` | **EBS gp3 단일 티어** (S3 cold 미구성 = 블록 온리) `✓` |

다이어그램은 values/설계(RF2·Keeper 3·members:3) 기준으로 그렸고 위 항목만 stage에서 다릅니다.
{{< /callout >}}

기준 문서는 표준이 어떻게 생겼고 왜 그렇게 정했나를 다룹니다. 이 장은 우리 클러스터가 지금 어떤 상태인가만 다룹니다. 표준 4컴포넌트의 배치·포트·의존은 [스택 토폴로지]({{< relref "../../hyperdx/01-stack-topology.md" >}}), 컴포넌트별 가용성 종합·blast radius·무손실 2트랙은 [operator 토폴로지·다운타임]({{< relref "../../hyperdx/04-operator-topology-downtime.md" >}}), Keeper의 역할과 유실 지점은 [Keeper]({{< relref "../../hyperdx/05-keeper.md" >}}), 승격 없는 복제와 EBS reattach는 [복제·failover]({{< relref "../../hyperdx/06-replication-failover.md" >}})가 소유합니다. 여기서 반복하지 않습니다.

표준과 다른 점은 하나입니다. RUM 데이터(브라우저 SDK·Mobile RUM)를 받으려고 따로 만든 자체 RUM 컨버터입니다 `✓` — Datadog Agent가 RUM을 보내는 방식을 참조해 구현했습니다. OTel Collector를 거치지 않고 ClickHouse에 직접 적재합니다. HyperDX 웹 데이터 경로도 일부 커스터마이즈했습니다 `✓`.

## 1. 수집·저장 토폴로지 — 두 경로가 ClickHouse에서 합류한다

{{< flow src="_flow/수집-저장-토폴로지.json" />}}

## 2. 실행 단위 — 표준 조립 5개, 우리 실제 6개

"4컴포넌트"는 논리 구분이고 실제 배치(실행) 단위는 그보다 많습니다. 그런데 세는 수가 두 개입니다 — 표준 조립대로 세면 5개, 우리가 실제로 돌리는 것은 6개입니다. 세는 축이 다를 뿐이라 두 숫자는 서로 충돌하지 않습니다.

| 축 | 실행 단위 | 목록 |
|---|---|---|
| **표준 조립**(HyperDX Only 경로) | **5** `≈` | hdx(app·api·OpAMP 한 Deployment) · OTel Collector · ClickHouse(CHI) · Keeper(CHK) · MongoDB |
| **우리 실제** | **6** `✓` | 위 5개 + **자체 RUM 컨버터** |

차이는 자체 RUM 컨버터 하나입니다 `Σ`. 표준 ClickStack에는 없는 우리 추가 컴포넌트라서 "표준이 5개"라는 서술과 "우리가 6개"라는 서술을 같은 자리에 두면 어느 쪽이 틀린 것처럼 보입니다 — 조립 문서(기준 문서)는 5를, 현황 문서(이 장)는 6을 씁니다.

소유권 경계도 같은 그림에서 나뉩니다. 차트가 관리하는 영역(`clickhouse:false`로 CH를 뺀 뒤 남는 것)과 Altinity operator가 관리하는 영역이 다릅니다.

{{< flow src="_flow/3-데이터-흐름-rum-인제스트.json" />}}

배치 형태와 상태 보유는 컴포넌트마다 한 줄씩 적었습니다. 표준 리슨 포트·의존 방향의 정본은 [스택 토폴로지]({{< relref "../../hyperdx/01-stack-topology.md" >}}) §2 표입니다. 여기서는 그 기본값과 어긋나는 우리 값만 짚습니다(Altinity CHK의 클라이언트 포트 등).

| 실행 단위 | 배포 형태 | 관리 주체 | 스토리지 | 상태 |
|---|---|---|---|---|
| hdx(app·api·OpAMP) | Deployment(단일) | clickstack 차트 | 없음 | 무상태 — 한 파드에서 `concurrently`로 함께 기동 `✓` |
| RUM 컨버터 | Deployment | 우리 자체 배포 | 없음 | 무상태(표준 ClickStack엔 없는 단위) `✓` |
| OTel Collector | Deployment(게이트웨이) | clickstack 차트 | 큐만 소량(gp3) `≈` | 준무상태 — stage는 큐가 인메모리라 사실상 무상태 `✓` |
| ClickHouse(CHI) | StatefulSet | Altinity operator | EBS gp3(hot) + S3(cold, prod 목표) `≈` | 스테이트풀 `✓` |
| Keeper(CHK) | StatefulSet | Altinity operator | gp3(메타·소량) `✓` | 스테이트풀 `✓` |
| MongoDB | ReplicaSet | MCK 또는 Atlas | gp3 10Gi `≈` | 스테이트풀(소량) `✓` |

- RUM 컨버터(자체 개발) — 브라우저 SDK와 Mobile RUM이 보내는 RUM 데이터를 받아 ClickHouse에 직접 적재합니다 `✓`. Datadog Agent가 RUM 데이터를 전송하는 방식을 참조해 구현했습니다. OTel Collector를 거치지 않는 별도 인제스트 경로입니다. 표준 ClickStack엔 없는 우리 추가 컴포넌트입니다.
- OTel Collector — 표준 OTLP 텔레메트리(로그·트레이스·메트릭)를 받아 ClickHouse로 export하는 인제스트 게이트웨이 `✓`. RUM 경로(컨버터)와 독립이며 서로 직접 호출하지 않습니다. 큐는 현재 stage에서 인메모리만 씁니다 `✓` — `file_storage` 퍼시스턴트 큐는 prod 목표입니다 `≈`. 지금처럼 미구성 상태면 재시작 때 in-flight가 유실될 수 있습니다.
- HyperDX (app·api·OpAMP) — 단일 Deployment/파드에서 조회 UI(app)·백엔드 api(쿼리 오케스트레이션·알럿 평가)·OpAMP 서버를 `concurrently`로 함께 기동합니다 `✓`. 2 프로세스지만 배포·스케일 노브는 하나입니다(replicas 하나로 함께 확장). 무상태(메타=MongoDB, 텔레메트리=ClickHouse). 웹 데이터 경로는 일부 커스터마이즈했습니다 `✓`.
- ClickHouse (Altinity CHI) — 두 경로가 적재하는 텔레메트리 저장소(`otel_logs`/`traces`/`otel_metrics_*` + `hyperdx_sessions`, DB `default`) `✓`. 우리는 쓰기(`otelcollector`, rw)·읽기(`app`, ro) 유저를 분리합니다 `✓` — 읽기 계정이 readonly로 충분한 이유와 그럼에도 변경 권한이 필요한 4개 설정은 [스택 토폴로지]({{< relref "../../hyperdx/01-stack-topology.md" >}}) §2가 소유합니다. 1 shard × RF2 설계(values 기준 replica 2; stage Phase 1은 1) `✓`.
- ClickHouse Keeper (Altinity CHK) — replica 복제 조정. 이벤트 데이터는 보관하지 않고 쓰기 정족수만 좌우합니다 `✓`. 클라이언트 포트는 2181입니다(Altinity CHK 관례; 독립형 Keeper 기본값 9181이 아닙니다) `✓`. raft는 operator 기본 9444입니다 `✓`.
- MongoDB — 대시보드·알럿·유저·소스 메타데이터. 인제스트 경로 밖(UI 전용) `✓`. `members:3`(prod) `≈` / stage는 `members:1` `✓`.

`clickhouse.enabled:false`(HyperDX Only)로 HyperDX 차트는 자체 ClickHouse를 띄우지 않고 Altinity operator가 관리하는 CHI/CHK 클러스터에 연결합니다 `✓`. 이 분기를 왜 택했는지(공식 operator 2종 공존 회피·범용분석 CH와 일원화)는 [스택 토폴로지]({{< relref "../../hyperdx/01-stack-topology.md" >}}) §1이 기준 문서입니다. 그 분기 위에서 사건이 났을 때 무엇을 어떤 순서로 하는지는 [운영 런북]({{< relref "02-runbook.md" >}})이 담당합니다.

## 3. 컴포넌트별 HA — prod 목표와 stage 실제

| 컴포넌트 | 배포 종류 | HA 설계(prod 목표) | stage 실제 | 다운 시 영향 |
| --- | --- | --- | --- | --- |
| hdx (app·api·OpAMP) | **단일 Deployment** | 무상태 replica 2+ 수평 확장 `≈` | replicas **1** `✓` | UI·쿼리만 — 적재 경로와 무관 `Σ` |
| RUM 컨버터(자체) | Deployment | 무상태면 replica 수평 확장 `≈` | 구성 확인 필요 `?` | RUM 신규 수집만 정지 (텔레메트리·조회 무관) `Σ` |
| OTel Collector | Deployment | replica ≥2 + `file_storage` 큐 `≈` | replica, **인메모리 큐** `✓` | ingest 정지, stage는 유실 위험 `Σ` |
| ClickHouse | StatefulSet(CHI) | 1shard×RF2, 2AZ `≈` | **Phase 1 replica 1** `✓` | replica 1대 상실은 정족수 내 유지 `✓` |
| ClickHouse Keeper | StatefulSet(CHK) | 3노드 정족수, 3AZ `≈` | 3노드 `✓` | **정족수 상실 시 CH 쓰기 정지** — SPOF `✓` |
| MongoDB | ReplicaSet | `members:3` + `mongodump`→S3 `≈` | **`members:1`** `✓` | 설정·알럿·UI만 — 적재 데이터 무관 `✓` |

광범위 관측 정지는 두 지점뿐입니다 — ClickHouse 전체 다운(저장 원천)과 Keeper 정족수 상실(쓰기 경로) `Σ`. 나머지 컴포넌트 다운은 수집 일부·조회·설정에 국한됩니다. 특히 RUM 컨버터와 OTel Collector는 독립 경로라 한쪽이 죽어도 다른 경로 적재는 계속됩니다 `Σ`. 단 stage는 위 축소 구성(replica 1·인메모리 큐·단일 티어)이라 이 방어선이 아직 prod만큼 두껍지 않습니다 `Σ`. 컴포넌트별 blast radius의 근거와 무손실 2트랙의 종합은 [operator 토폴로지·다운타임]({{< relref "../../hyperdx/04-operator-topology-downtime.md" >}}) §1·§6이 소유합니다.

## 4. 검토했으나 채택하지 않은 것 — S3Queue / s3Cluster

S3를 인제스트 경로에 끼우는 방식(S3에 객체를 떨어뜨리고 ClickHouse가 그걸 빨아들이는 형태)은 우리 경로에 없습니다. 이유는 하나입니다 — 우리 인제스트는 OTel Collector와 자체 RUM 컨버터가 ClickHouse에 직접 쓰므로 S3를 경유할 지점 자체가 없습니다 `✓`. 굳이 끼우면 경로가 하나 늘어납니다. `S3Queue`는 23.11에 production ready로 발표됐지만 exactly-once를 보장하지 않는다고 공식 문서가 명시하므로 `✓` 중복 제거 책임을 우리가 새로 져야 합니다. 여기에 ClickHouse Cloud의 S3 ClickPipes 광고를 self-host의 `S3Queue`와 같은 것으로 읽으면 판단이 뒤집힙니다 `Σ`. 두 엔진의 기능 서술과 S3를 메인 스토리지로 쓰는 갈래의 판정은 [Iceberg·레이크하우스]({{< relref "../../clickhouse/09-iceberg-lakehouse.md" >}})가 소유합니다. 이 장은 "우리 경로에 왜 없나"만 기록합니다.

## 우리 케이스에서는

지금 돌아가는 것은 stage 축소판 하나입니다 — hdx replicas 1, ClickHouse Phase 1 replica 1, MongoDB `members:1`, Collector 인메모리 큐, EBS gp3 단일 티어. 표에 적힌 prod 목표(RF2 2AZ·Keeper 3노드·`members:3`·`file_storage` 큐·hot gp3+cold S3)는 아직 설계이고 그 격차가 곧 승급 작업 목록입니다 — 무엇을 어떤 신호에서 올리는지는 [의사결정 가이드]({{< relref "03-decision-guide.md" >}})가 소유합니다.

표준과 우리 사이의 차이는 자체 RUM 컨버터 한 컴포넌트이고 이 하나 때문에 실행 단위가 5에서 6이 됩니다. 이 컨버터가 OTel Collector와 독립 경로라는 점은 이득이자 부채입니다 — 한쪽이 죽어도 다른 경로 적재는 계속됩니다 `Σ`. 대신 표준 문서의 Collector 중심 서술이 우리 RUM 경로에는 그대로 적용되지 않습니다. stage 스토리지가 블록 온리 형상이라는 점도 같은 성격입니다 — S3 티어링을 전제한 기준 문서 대신 [블록 온리 튜닝]({{< relref "../../hyperdx/08-block-only-tuning.md" >}})을 읽어야 지금 형상의 손익이 맞습니다. 사건이 났을 때의 순서는 [운영 런북]({{< relref "02-runbook.md" >}})으로 넘깁니다. 시점 기준 2026-08.
