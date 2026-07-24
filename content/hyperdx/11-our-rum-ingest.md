---
title: "우리 RUM 수집 스택 — 컴포넌트·HA"
weight: 11
---

# 11 · 우리 RUM 수집 스택 — 컴포넌트 분할·HA·자체 RUM 컨버터

{{< callout type="info" >}}
**한눈에**
- 우리 RUM 수집 스택은 **자체 개발 RUM 컨버터** + ClickStack(HyperDX Only) + **Altinity operator**(ClickHouse·Keeper)로 구성된다.
- **두 인제스트 경로가 ClickHouse에서 합류한다**: ① RUM은 자체 컨버터가 **ClickHouse에 직접 적재**(Datadog Agent의 RUM 전송 방식을 참조해 구현), ② 표준 텔레메트리는 OTel Collector가 적재. **컨버터와 Collector는 서로 직접 호출하지 않는다.**
- HA 뼈대: ClickHouse **RF2(replica 2 · 2 AZ) + `insert_quorum`**, ClickHouse Keeper **3노드 정족수(3 AZ)**, MongoDB **ReplicaSet `members:3`**, 무상태 컴포넌트(app·api·Collector·컨버터)는 **replica 수평 확장**.
- ClickHouse·Keeper는 **Altinity operator가 StatefulSet으로 관리**하고, HyperDX 컴포넌트는 `clickhouse.enabled:false`로 그 operator 클러스터에 붙는다. HyperDX 웹 데이터 경로도 일부 커스터마이즈했다.
{{< /callout >}}

기준 문서([스택 토폴로지]({{< relref "01-stack-topology.md" >}})·[가용성]({{< relref "../hyperdx-operating/03-availability.md" >}})·[Keeper]({{< relref "05-keeper.md" >}})·[복제·failover]({{< relref "06-replication-failover.md" >}}))가 표준 ClickStack을 다룬다면, 이 문서는 **우리가 실제로 배포한 형상**을 한 장에 모은다. 표준과 다른 점은 RUM 데이터를 받기 위해 별도로 만든 **자체 RUM 컨버터**다 — Datadog Agent가 RUM을 보내는 방식을 참조해 구현했고, OTel Collector를 거치지 않고 ClickHouse에 직접 적재한다. 나머지는 HyperDX Only + Altinity CHI/CHK 기본 형상 그대로다(HyperDX 웹 데이터 경로만 일부 손봤다).

## 수집·저장 토폴로지

{{< flow caption="두 인제스트 경로가 ClickHouse에서 합류한다. RUM은 자체 컨버터(Datadog Agent의 RUM 전송 방식 참조)가 ClickHouse에 직접 적재하고, 표준 텔레메트리는 OTel Collector가 적재한다 — 컨버터·Collector는 서로 직접 호출하지 않는다. Keeper 3노드가 복제 정족수를 잡고, HyperDX api는 ClickHouse(쿼리)·MongoDB(메타)를 읽는다. 점선(복제 조정)은 데이터 흐름이 아니다. ClickHouse·Keeper는 Altinity operator가 StatefulSet으로 관리." >}}
{
  "groups": [
    {"id": "op", "label": "Altinity operator · StatefulSet", "members": ["cha", "chb", "k1", "k2", "k3"]}
  ],
  "nodes": [
    {"id": "rum",  "col": 0, "row": 0, "label": "브라우저 RUM SDK",   "sub": "rrweb·에러·Web Vitals",  "kind": "src"},
    {"id": "conv", "col": 1, "row": 0, "label": "RUM 컨버터",         "sub": "자체 개발 · Datadog Agent 참조", "kind": "proc"},
    {"id": "tel",  "col": 0, "row": 2, "label": "앱·인프라 텔레메트리", "sub": "로그·트레이스·메트릭",   "kind": "src"},
    {"id": "otel", "col": 1, "row": 2, "label": "OTel Collector",     "sub": "OTLP 4317/4318 · 큐",     "kind": "proc"},
    {"id": "cha",  "col": 2, "row": 0, "label": "ClickHouse",         "sub": "replica A",              "kind": "store"},
    {"id": "chb",  "col": 2, "row": 1, "label": "ClickHouse",         "sub": "replica B",              "kind": "store"},
    {"id": "k1",   "col": 3, "row": 0, "label": "Keeper",             "sub": "node 1",                 "kind": "store"},
    {"id": "k2",   "col": 3, "row": 1, "label": "Keeper",             "sub": "node 2",                 "kind": "store"},
    {"id": "k3",   "col": 3, "row": 2, "label": "Keeper",             "sub": "node 3",                 "kind": "store"},
    {"id": "app",  "col": 0, "row": 4, "label": "HyperDX app",        "sub": "UI · 무상태",            "kind": "sink"},
    {"id": "api",  "col": 1, "row": 4, "label": "HyperDX api",        "sub": "쿼리·알럿 · 무상태",      "kind": "query"},
    {"id": "mongo","col": 2, "row": 4, "label": "MongoDB",            "sub": "ReplicaSet ×3",          "kind": "store"}
  ],
  "edges": [
    {"from": "rum",  "to": "conv", "label": "RUM 이벤트", "rate": 720},
    {"from": "conv", "to": "cha",  "label": "적재(RUM)",  "rate": 560},
    {"from": "tel",  "to": "otel", "label": "OTLP",       "rate": 720},
    {"from": "otel", "to": "chb",  "label": "insert",     "rate": 560},
    {"from": "app",  "to": "api",  "label": "UI 요청",    "rate": 900},
    {"from": "api",  "to": "mongo","label": "메타 R/W",   "rate": 900},
    {"from": "api",  "to": "chb",  "label": "쿼리", "kind": "query", "rate": 820},
    {"from": "chb",  "to": "k2",   "label": "복제 조정",  "dashed": true}
  ]
}
{{< /flow >}}

## 컴포넌트가 어떻게 쪼개지나

- **RUM 컨버터(자체 개발)** — 브라우저 RUM SDK가 보내는 데이터를 받아 **ClickHouse에 직접 적재**한다. Datadog Agent가 RUM 데이터를 전송하는 방식을 참조해 구현했고, **OTel Collector를 거치지 않는 별도 인제스트 경로**다. 표준 ClickStack엔 없는 우리 추가 컴포넌트다.
- **OTel Collector** — 표준 OTLP 텔레메트리(로그·트레이스·메트릭)를 받아 ClickHouse로 export하는 인제스트 게이트웨이(gRPC 4317 / HTTP 4318). RUM 경로(컨버터)와 독립이며 서로 직접 호출하지 않는다. `file_storage` 퍼시스턴트 큐로 in-flight를 디스크에 붙잡는다.
- **HyperDX app / api** — app은 조회 UI(웹 데이터 경로 일부 커스터마이즈), api는 쿼리 오케스트레이션·알럿 평가·OpAMP 서버(`:4320`). 둘 다 무상태(메타=MongoDB, 텔레메트리=ClickHouse).
- **ClickHouse (Altinity CHI)** — 두 경로가 적재하는 텔레메트리 저장소(`otel_logs`/`traces`/`metrics` + `hyperdx_sessions`). 1 shard × RF2로 replica 2대.
- **ClickHouse Keeper (Altinity CHK)** — replica 복제 조정. 이벤트 데이터는 보관하지 않고 쓰기 정족수만 좌우한다.
- **MongoDB** — 대시보드·알럿·유저·소스 메타데이터. 인제스트 경로 밖.

`clickhouse.enabled:false`(HyperDX Only)로 HyperDX 차트는 자체 ClickHouse를 띄우지 않고, Altinity operator가 관리하는 CHI/CHK 클러스터에 연결한다. 조립·분리 근거는 [operator 패턴]({{< relref "../hyperdx-operating/04-operator-pattern.md" >}}) 참고.

## 컴포넌트별 HA 구성

| 컴포넌트 | 배포 종류 | HA 구성 | 다운 시 영향 |
| --- | --- | --- | --- |
| RUM 컨버터(자체) | Deployment | 무상태면 replica 수평 확장 (구성 확인 필요) | RUM 신규 수집만 정지 (표준 텔레메트리·조회 무관) |
| OTel Collector | Deployment | replica ≥2 + `file_storage` 퍼시스턴트 큐(at-least-once) | 표준 텔레메트리 신규 ingest만 — 큐가 in-flight 완충 후 복귀 시 재개 |
| HyperDX app / api | Deployment | 무상태, Service 뒤 replica 2+ 수평 확장 | UI·쿼리만 — 적재 경로와 무관 |
| ClickHouse | StatefulSet (Altinity CHI) | **1 shard × RF2, 2 AZ**, `insert_quorum`으로 승격 없는 멀티마스터 복제 | replica 1대 상실은 조회·쓰기 유지(정족수 내) |
| ClickHouse Keeper | StatefulSet (Altinity CHK) | **3노드 정족수, 3 AZ** | **정족수 상실 시 CH 쓰기 정지** — 진짜 SPOF |
| MongoDB | ReplicaSet | **`members:3`**(Primary+Secondary×2) 자동 failover + `mongodump`→S3 | 설정·알럿·UI만 — 적재 데이터 무관 |

광범위 관측 정지는 두 지점뿐이다 — **ClickHouse 전체 다운**(저장 원천)과 **Keeper 정족수 상실**(쓰기 경로). 나머지 컴포넌트 다운은 수집 일부·조회·설정에 국한된다 — 특히 RUM 컨버터와 OTel Collector는 독립 경로라 한쪽이 죽어도 다른 경로 적재는 계속된다. 근거·매니페스트는 [가용성]({{< relref "../hyperdx-operating/03-availability.md" >}})·[Keeper]({{< relref "05-keeper.md" >}})·[복제·failover]({{< relref "06-replication-failover.md" >}})가 담당한다.

## 관련 문서

- 표준 4컴포넌트 배치·포트·의존: [스택 토폴로지]({{< relref "01-stack-topology.md" >}})
- 컴포넌트별 blast radius·무손실 2트랙: [가용성]({{< relref "../hyperdx-operating/03-availability.md" >}})
- Keeper 역할(조정 계층이지 큐가 아니다): [ClickHouse Keeper]({{< relref "05-keeper.md" >}})
- 승격 없는 복제·EBS reattach·failover: [복제·failover]({{< relref "06-replication-failover.md" >}})
