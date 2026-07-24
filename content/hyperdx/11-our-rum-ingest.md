---
title: "우리 RUM 수집 스택 — 컴포넌트·HA"
weight: 11
---

# 11 · 우리 RUM 수집 스택 — 컴포넌트 분할·HA·자체 RUM 컨버터

{{< callout type="info" >}}
**한눈에**
- 우리 RUM 수집 스택은 **자체 개발 RUM 컨버터** + ClickStack(HyperDX Only) + **Altinity operator**(ClickHouse·Keeper)로 구성된다.
- **두 인제스트 경로가 ClickHouse에서 합류한다**: ① RUM(브라우저 SDK·Mobile RUM)은 자체 컨버터를 통해 **ClickHouse에 직접 적재**(Datadog Agent의 RUM 전송 방식을 참조해 구현), ② 표준 텔레메트리는 OTel Collector가 적재. **컨버터와 Collector는 서로 직접 호출하지 않는다.**
- 실제 **실행 단위는 6개**: hdx(app·api·OpAMP를 **한 Deployment**에서 함께 기동) · RUM 컨버터 · OTel Collector · ClickHouse(CHI) · Keeper(CHK) · MongoDB.
- HA 설계 목표: ClickHouse **RF2(2 AZ) + `insert_quorum`**, Keeper **3노드 정족수(client 2181)**, MongoDB **`members:3`**. 이 수치는 **prod 목표**이고, 현재 실제 배포는 stage 축소판이다(아래 경고 참조).
{{< /callout >}}

{{< callout type="warning" >}}
**stage 실제 vs prod 목표** — 현재 hdx는 **stage 전용**이다(`values/stage/chain/hdx.yaml`만 있고 prod values 없음). 아래 규모·HA는 대부분 **prod 목표 설계**이며, 실제 돌아가는 건 그 축소판이다.

| 항목 | prod 목표 | stage 실제 |
| --- | --- | --- |
| hdx replicas | 2+ | **1** |
| ClickHouse replica | RF2 (2) | **Phase 1은 1** (values는 RF2) |
| MongoDB | `members:3` | **`members:1`** |
| OTel Collector 큐 | `file_storage` 퍼시스턴트 큐 | **인메모리 큐만** (미구성 → 재시작 시 in-flight 유실 리스크) |
| 스토리지 | hot gp3 + cold S3 (검토) | **EBS gp3 단일 티어** (S3 cold 미구성 = 블록 온리) |

다이어그램은 values/설계(RF2·Keeper 3·members:3) 기준으로 그렸고, 위 항목만 stage에서 다르다.
{{< /callout >}}

기준 문서([스택 토폴로지]({{< relref "01-stack-topology.md" >}})·[가용성]({{< relref "../hyperdx-operating/03-availability.md" >}})·[Keeper]({{< relref "05-keeper.md" >}})·[복제·failover]({{< relref "06-replication-failover.md" >}}))가 표준 ClickStack을 다룬다면, 이 문서는 **우리가 실제로 배포한 형상**을 한 장에 모은다. 표준과 다른 점은 RUM 데이터(브라우저 SDK·Mobile RUM)를 받기 위해 별도로 만든 **자체 RUM 컨버터**다 — Datadog Agent가 RUM을 보내는 방식을 참조해 구현했고, OTel Collector를 거치지 않고 ClickHouse에 직접 적재한다. HyperDX 웹 데이터 경로도 일부 커스터마이즈했다.

## 수집·저장 토폴로지

{{< flow caption="두 인제스트 경로가 ClickHouse에서 합류한다. RUM(브라우저 SDK·Mobile RUM)은 자체 컨버터(Datadog Agent의 RUM 전송 방식 참조)를 통해 ClickHouse에 직접 적재하고, 표준 텔레메트리는 OTel Collector가 적재한다 — 컨버터·Collector는 서로 직접 호출하지 않는다. hdx는 app·api·OpAMP를 한 Deployment에서 함께 기동하며 ClickHouse(쿼리)·MongoDB(메타)를 읽는다. Keeper 3노드(client 2181)는 데이터가 지나가는 길이 아니라 복제 정족수를 잡는 조정 계층이다(점선). ClickHouse·Keeper는 Altinity operator가 StatefulSet으로 관리." >}}
{
  "groups": [
    {"id": "op", "label": "Altinity operator · StatefulSet", "members": ["cha", "chb", "k1", "k2", "k3"]}
  ],
  "nodes": [
    {"id": "rum",  "col": 0, "row": 0, "label": "브라우저 SDK",       "sub": "rrweb·에러·Web Vitals",  "kind": "src"},
    {"id": "mob",  "col": 0, "row": 1, "label": "Mobile RUM",         "sub": "모바일 앱 RUM",          "kind": "src"},
    {"id": "conv", "col": 1, "row": 0, "label": "RUM 컨버터",         "sub": "자체 개발 · Datadog Agent 참조", "kind": "proc"},
    {"id": "tel",  "col": 0, "row": 3, "label": "앱·인프라 텔레메트리", "sub": "로그·트레이스·메트릭",   "kind": "src"},
    {"id": "otel", "col": 1, "row": 3, "label": "OTel Collector",     "sub": "OTLP 4317/4318",         "kind": "proc"},
    {"id": "cha",  "col": 2, "row": 0, "label": "ClickHouse",         "sub": "replica A",              "kind": "store"},
    {"id": "chb",  "col": 2, "row": 1, "label": "ClickHouse",         "sub": "replica B",              "kind": "store"},
    {"id": "k1",   "col": 3, "row": 0, "label": "Keeper",             "sub": "node 1 · 2181",          "kind": "store"},
    {"id": "k2",   "col": 3, "row": 1, "label": "Keeper",             "sub": "node 2",                 "kind": "store"},
    {"id": "k3",   "col": 3, "row": 2, "label": "Keeper",             "sub": "node 3",                 "kind": "store"},
    {"id": "hdx",  "col": 1, "row": 5, "label": "HyperDX",            "sub": "app·api·OpAMP · 단일 Deployment", "kind": "query"},
    {"id": "mongo","col": 2, "row": 5, "label": "MongoDB",            "sub": "ReplicaSet",             "kind": "store"}
  ],
  "edges": [
    {"from": "rum",  "to": "conv", "label": "RUM 이벤트", "rate": 720},
    {"from": "mob",  "to": "conv", "rate": 720},
    {"from": "conv", "to": "cha",  "label": "적재(RUM)",  "rate": 560},
    {"from": "tel",  "to": "otel", "label": "OTLP",       "rate": 720},
    {"from": "otel", "to": "chb",  "label": "insert",     "rate": 560},
    {"from": "hdx",  "to": "chb",  "label": "쿼리", "kind": "query", "rate": 820},
    {"from": "hdx",  "to": "mongo","label": "메타 R/W",   "rate": 900},
    {"from": "chb",  "to": "k2",   "label": "복제 조정",  "dashed": true}
  ]
}
{{< /flow >}}

## 컴포넌트가 어떻게 쪼개지나 — 6 실행 단위

"4컴포넌트"는 논리 구분이고, 실제 배치(실행) 단위는 **6개**다: **hdx** · **RUM 컨버터** · **OTel Collector** · **ClickHouse(CHI)** · **Keeper(CHK)** · **MongoDB**. HyperDX는 app·api·OpAMP를 한 컨테이너에서 `concurrently`로 함께 기동하고, ClickHouse는 CHI/CHK 두 StatefulSet으로 갈린다.

- **RUM 컨버터(자체 개발)** — 브라우저 SDK와 Mobile RUM이 보내는 RUM 데이터를 받아 **ClickHouse에 직접 적재**한다. Datadog Agent가 RUM 데이터를 전송하는 방식을 참조해 구현했고, **OTel Collector를 거치지 않는 별도 인제스트 경로**다. 표준 ClickStack엔 없는 우리 추가 컴포넌트다.
- **OTel Collector** — 표준 OTLP 텔레메트리(로그·트레이스·메트릭)를 받아 ClickHouse로 export하는 인제스트 게이트웨이(gRPC 4317 / HTTP 4318). RUM 경로(컨버터)와 독립이며 서로 직접 호출하지 않는다. **큐: 현재 stage는 인메모리 큐만 쓴다** — `file_storage` 퍼시스턴트 큐는 prod 목표이며, 미구성 상태에선 재시작 시 in-flight가 유실될 수 있다.
- **HyperDX (app·api·OpAMP)** — **단일 Deployment/파드**에서 조회 UI(app `:3000`)·백엔드 api(`:8000`, 쿼리 오케스트레이션·알럿 평가)·OpAMP 서버(`:4320`)를 `concurrently`로 함께 기동한다. 2 프로세스지만 **배포·스케일 노브는 하나**다(replicas 하나로 함께 확장). 무상태(메타=MongoDB, 텔레메트리=ClickHouse). 웹 데이터 경로는 일부 커스터마이즈했다.
- **ClickHouse (Altinity CHI)** — 두 경로가 적재하는 텔레메트리 저장소(`otel_logs`/`traces`/`otel_metrics_*` + `hyperdx_sessions`, DB `default`). 쓰기(`otelcollector`, rw)·읽기(`app`, ro) 유저를 분리한다. 1 shard × RF2 설계(values 기준 replica 2; stage Phase 1은 1).
- **ClickHouse Keeper (Altinity CHK)** — replica 복제 조정. 이벤트 데이터는 보관하지 않고 쓰기 정족수만 좌우한다. **클라이언트 포트 2181**(Altinity CHK 관례; 독립형 Keeper 기본값 9181이 아니다), raft는 operator 기본 9444.
- **MongoDB** — 대시보드·알럿·유저·소스 메타데이터. 인제스트 경로 밖(UI 전용). `members:3`(prod) / stage는 `members:1`.

`clickhouse.enabled:false`(HyperDX Only)로 HyperDX 차트는 자체 ClickHouse를 띄우지 않고, Altinity operator가 관리하는 CHI/CHK 클러스터에 연결한다. 조립·분리 근거는 [operator 패턴]({{< relref "../hyperdx-operating/04-operator-pattern.md" >}}) 참고.

## 컴포넌트별 HA 구성

| 컴포넌트 | 배포 종류 | HA 설계(prod 목표) | stage 실제 | 다운 시 영향 |
| --- | --- | --- | --- | --- |
| hdx (app·api·OpAMP) | **단일 Deployment** | 무상태 replica 2+ 수평 확장 | replicas **1** | UI·쿼리만 — 적재 경로와 무관 |
| RUM 컨버터(자체) | Deployment | 무상태면 replica 수평 확장 | 구성 확인 | RUM 신규 수집만 정지 (텔레메트리·조회 무관) |
| OTel Collector | Deployment | replica ≥2 + `file_storage` 퍼시스턴트 큐 | replica + **인메모리 큐만** | 표준 텔레메트리 ingest만 — stage는 재시작 시 in-flight 유실 리스크 |
| ClickHouse | StatefulSet (Altinity CHI) | 1 shard × RF2, 2 AZ, `insert_quorum` | **Phase 1 replica 1** | replica 1대 상실은 조회·쓰기 유지(정족수 내) |
| ClickHouse Keeper | StatefulSet (Altinity CHK) | 3노드 정족수, 3 AZ (client 2181) | 3노드 | **정족수 상실 시 CH 쓰기 정지** — 진짜 SPOF |
| MongoDB | ReplicaSet | `members:3` + `mongodump`→S3 | **`members:1`** | 설정·알럿·UI만 — 적재 데이터 무관 |

광범위 관측 정지는 두 지점뿐이다 — **ClickHouse 전체 다운**(저장 원천)과 **Keeper 정족수 상실**(쓰기 경로). 나머지 컴포넌트 다운은 수집 일부·조회·설정에 국한된다 — 특히 RUM 컨버터와 OTel Collector는 독립 경로라 한쪽이 죽어도 다른 경로 적재는 계속된다. 단 stage는 위 축소 구성(replica 1·인메모리 큐·단일 티어)이라 이 방어선이 아직 prod만큼 두껍지 않다. 근거·매니페스트는 [가용성]({{< relref "../hyperdx-operating/03-availability.md" >}})·[Keeper]({{< relref "05-keeper.md" >}})·[복제·failover]({{< relref "06-replication-failover.md" >}})가 담당한다.

## 관련 문서

- 표준 4컴포넌트 배치·포트·의존: [스택 토폴로지]({{< relref "01-stack-topology.md" >}})
- 컴포넌트별 blast radius·무손실 2트랙: [가용성]({{< relref "../hyperdx-operating/03-availability.md" >}})
- Keeper 역할(조정 계층이지 큐가 아니다): [ClickHouse Keeper]({{< relref "05-keeper.md" >}})
- 승격 없는 복제·EBS reattach·failover: [복제·failover]({{< relref "06-replication-failover.md" >}})
