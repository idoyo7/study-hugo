---
title: "우리 배포 형상 — 자체 RUM 컨버터·6 실행 단위·stage/prod 격차"
description: "Datadog Agent 방식을 참조해 만든 자체 RUM 컨버터가 표준 5실행 단위에 하나를 더해 6개가 됐습니다. stage는 replica 1·인메모리 큐로 prod 목표의 축소판입니다."
date: 2026-08-13
lastmod: 2026-09-08
weight: 1
aliases: ["/hyperdx/11-our-rum-ingest/", "/hyperdx-operating/01-architecture/", "/hyperdx/operating/01-architecture/"]
---

# 우리 배포 형상

우리 RUM 데이터는 자체 컨버터를 거쳐 ClickHouse에 들어갑니다. 브라우저 SDK와 Mobile RUM이 보내는 데이터를 받기 위해 Datadog Agent의 RUM 전송 방식을 참고해 구현했습니다. 표준 로그·트레이스·메트릭은 별도의 OTel Collector로 수집합니다. 두 수집기는 서로 호출하지 않고 ClickHouse에서 데이터를 합칩니다 `✓`.

HyperDX는 이 데이터를 조회하는 UI와 API를 제공하며, 웹 데이터 경로 일부를 커스터마이즈했습니다. ClickStack 차트의 `clickhouse.enabled:false` 설정으로 내장 ClickHouse를 끄고 Altinity operator의 CHI·CHK에 연결합니다. operator 선택 배경과 표준 포트는 [스택 토폴로지]({{< relref "../../hyperdx/01-stack-topology.md" >}})에 있습니다.

## 1. 두 수집 경로 {#1-수집저장-토폴로지--두-경로가-clickhouse에서-합류한다}

{{< flow src="_flow/수집-저장-토폴로지.json" />}}

RUM 컨버터가 멈추면 RUM 신규 수집을, Collector가 멈추면 표준 텔레메트리 수집을 조사합니다. ClickHouse나 공통 인프라의 장애가 없다면 한 수집기의 장애가 다른 수집기를 직접 멈추지는 않습니다. 다만 RUM 컨버터의 재시도·버퍼 동작은 Collector 설정만 보고 판단할 수 없습니다.

## 2. 배포한 컴포넌트 {#2-실행-단위--표준-조립-5개-우리-실제-6개}

HyperDX Only 구성의 hdx, OTel Collector, ClickHouse, Keeper, MongoDB에 자체 RUM 컨버터를 더해 여섯 단위를 운영합니다. hdx는 app·api·OpAMP 기능을 한 Deployment에서 띄우므로 replica를 늘리면 함께 확장됩니다.

{{< flow src="_flow/3-데이터-흐름-rum-인제스트.json" />}}

| 실행 단위 | 배포·관리 | 저장하는 상태 |
|---|---|---|
| hdx(app·api·OpAMP) | ClickStack 차트의 Deployment | 텔레메트리는 ClickHouse, 앱 설정은 MongoDB에 저장 `✓` |
| 자체 RUM 컨버터 | 자체 Deployment | 무상태 애플리케이션. RUM을 ClickHouse에 직접 적재 `✓` |
| OTel Collector | ClickStack 차트의 Deployment | stage는 인메모리 큐. prod에서는 gp3 기반 영속 큐 검토 `✓/≈` |
| ClickHouse(CHI) | Altinity operator의 StatefulSet | 텔레메트리. stage는 gp3, prod는 S3 cold 추가 검토 `✓/≈` |
| Keeper(CHK) | Altinity operator의 StatefulSet | gp3에 복제 조정용 메타데이터 저장 `✓` |
| MongoDB | MCK ReplicaSet 또는 Atlas | 사용자·대시보드·알림·소스 설정. gp3 10Gi는 설계값 `≈` |

ClickHouse의 `default` DB에 표준 텔레메트리 테이블과 `hyperdx_sessions`를 둡니다. 쓰기는 `otelcollector` 계정(rw), 조회는 `app` 계정(ro)으로 분리했습니다 `✓`. 읽기 계정에도 변경을 허용해야 하는 쿼리 설정이 있으므로 [스택 토폴로지의 계정 설정]({{< relref "../../hyperdx/01-stack-topology.md" >}})을 함께 적용해야 합니다.

Keeper는 이벤트 본문을 보관하지 않습니다. 우리 Altinity CHK 구성의 클라이언트 포트는 2181, Raft 포트는 9444입니다 `✓`. 독립형 Keeper 기본 클라이언트 포트인 9181과 혼동하지 않도록 연결 설정을 확인합니다. [Keeper의 역할]({{< relref "../../hyperdx/05-keeper.md" >}})과 [복제 과정]({{< relref "../../hyperdx/06-replication-failover.md" >}})에서 동작을 설명합니다.

<span id="우리-케이스에서는"></span>

## 3. stage 구성과 prod 목표 {#3-컴포넌트별-ha--prod-목표와-stage-실제}

아래 stage 열은 2026-08 배포 기록입니다. 당시 `values/stage/chain/hdx.yaml`만 있었고 prod values는 없었습니다. 다이어그램에 표시한 RF2·Keeper 3노드·MongoDB 3멤버는 values 또는 설계에 따른 구성이며, 실행 상태는 표와 차이가 있습니다. 2026-09의 문서 수정은 클러스터를 재실측했다는 뜻이 아닙니다.

| 항목 | stage 기록 | prod 목표 | 장애 시 확인할 점 |
|---|---|---|---|
| hdx | replica 1 `✓` | replica 2 이상 `≈` | UI·조회·알림 처리. 적재가 계속되는지 별도 확인 |
| RUM 컨버터 | replica 구성 미확인 `?` | 수평 확장 `≈` | RUM 수신과 재시도 상태 |
| OTel Collector | 인메모리 큐 `✓` | replica 2 이상·`file_storage` 큐 `≈` | 재시작 시 큐에 남은 데이터 유실 가능 |
| ClickHouse | Phase 1 replica 1, values는 RF2 `✓` | 1 shard × RF2, 2 AZ `≈` | stage는 단일 replica 장애로 읽기·쓰기 중단 |
| Keeper | 3노드 `✓` | 3노드, 3 AZ `≈` | 정족수 상실 시 복제 테이블 쓰기 중단 |
| MongoDB | `members:1` `✓` | `members:3` 또는 Atlas, 정기 백업 `≈` | 사용자·설정·UI·알림 영향 |
| ClickHouse 스토리지 | EBS gp3 단일 티어 `✓` | hot gp3 + cold S3 검토 `≈` | stage에는 S3로 이동할 경로가 없음 |

RF2를 적용해도 쓰기 가용성은 `insert_quorum`에 따라 달라집니다. 두 replica의 확인을 모두 요구하면 한 대가 재연결 중인 동안 쓰기가 대기하거나 실패할 수 있습니다. 컴포넌트별 장애 영향과 수집·저장 단계의 유실 조건은 [토폴로지와 다운타임]({{< relref "../../hyperdx/04-operator-topology-downtime.md" >}})에서 다룹니다.

stage 스토리지의 실제 튜닝은 [블록 스토리지만 쓰는 구성]({{< relref "../../hyperdx/08-block-only-tuning.md" >}})을 따릅니다. S3 티어링 예제를 stage에 이미 적용된 설정으로 취급하면 안 됩니다.

## 4. S3를 거치는 수집을 채택하지 않은 이유 {#4-검토했으나-채택하지-않은-것--s3queue--s3cluster}

현재 수집 경로에서는 컨버터와 Collector가 ClickHouse에 직접 씁니다. 중간에 S3를 두는 방식을 채택하지 않았으므로 `S3Queue`나 `s3Cluster`를 통한 수집도 없습니다.

S3를 경유하면 객체를 만드는 단계와 읽어 들이는 단계를 추가로 운영해야 합니다. `S3Queue`는 23.11에서 production ready로 발표됐지만 exactly-once 보장을 전제로 쓸 수 없어 중복 처리도 검토해야 합니다 `✓`. ClickHouse Cloud의 S3 ClickPipes와 직접 운영하는 `S3Queue`는 기능과 운영 책임이 다릅니다. [Iceberg·레이크하우스]({{< relref "../../clickhouse/09-iceberg-lakehouse.md" >}})에서 각 수집·저장 방식을 비교합니다.

prod 준비 작업은 위 표의 차이를 해소하는 일입니다. 실제 조치 순서는 [운영 런북]({{< relref "02-runbook.md" >}}), 변경 전에 확인할 조건과 실측 항목은 [의사결정 가이드]({{< relref "03-decision-guide.md" >}})에 정리했습니다.
