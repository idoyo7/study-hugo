---
title: "로깅"
weight: 2
cascade:
  type: docs
---

# 로깅 · 옵저버빌리티 — ES 말고 어떻게 관리할까

> MSA 환경에서 로그·메트릭·RUM을 여러 저장소에 흩뿌리고 있는 팀이, **"이거랑 저거만 있으면 다 될 것 같은"** 최소 조합을 찾아가는 과정에서 검토한 솔루션들을 정리한 챕터다. Elasticsearch(OpenSearch) 기반 EFK 외에 애플리케이션 로깅을 어떤 방식으로 내재화할 수 있는지, 각 솔루션의 성격과 우리 케이스에서의 선택을 다룬다.

> 자매 챕터: [VictoriaMetrics 지식베이스]({{< relref "../monitoring/victoriametrics/_index.md" >}}) · [메트릭 400일 보관]({{< relref "../monitoring/longterm-retention/_index.md" >}}) — 메트릭 계층은 그쪽에서, 로그·RUM 계층은 이 챕터에서 다룬다. istio 액세스 로그·APM·RUM의 단독 심화는 별도 도메인([Istio]({{< relref "../istio/_index.md" >}}) · [APM]({{< relref "../apm/_index.md" >}}) · [RUM 내재화]({{< relref "../rum/_index.md" >}}))에서 이어질 예정.

## 먼저, 이건 "하나의 큰 결정"이 아니다

여러 이야기가 섞여 있어 하나로 뭉뚱그리면 ROI 판단이 불가능해진다. 발라내면 **서로 독립적인 4개의 결정**이다. 답이 각각 다르므로 따로 판단해야 한다.

| 결정 | 질문 | 결론 |
|---|---|---|
| **D1. istio 로그 부활** | PLG를 살릴까, VictoriaLogs로 갈까 | 즉시·저위험 → **VictoriaLogs** |
| **D2. OpenSearch 뚱뚱함** | 90d/160TB EFK를 어떻게 다이어트하나 | 강한 YES → **tail 이전 + in-place RI/OR 최적화** |
| **D3. RUM 내재화** | Datadog RUM 2배 인상, 빼올까 | **웹 YES / 모바일 NO** |
| **D4. 단일 통합 저장소** | ClickHouse로 로그+트레이스+RUM 다 합칠까 | 가능하나 **최후에** ("earn it last") |

이 프레이밍을 먼저 못 박는 이유: D1은 스프린트 단위로 끝나는 저위험 작업이고, D2는 자릿수 절감이 걸린 큰 건이며, D4는 조건이 성숙해야 성립하는 장기 베팅이다. 하나로 묶으면 "전면 이전 ROI 나올까?"라는 답 없는 질문이 된다.

## 왜 이 고민을 하는가 — 현재 구조의 겹침

규모 있는 MSA를 운영하면 옵저버빌리티 데이터가 자연스럽게 여러 저장소로 번진다. 문제는 **같은 성격의 데이터를 여러 곳에 중복 수집·저장**하면서 비용과 운영 부담만 늘어난다는 점이다.

| 레이어 | 흔한 현재 모습 | 중복도 | 진단 |
|---|---|---|---|
| 수집 에이전트 | Datadog agent + fluent-bit + (방치된) promtail | 3중 | 통합 1순위 |
| 로그 저장 | Datadog logs(7d) + OpenSearch(90d) + (죽은) Loki | 3중 | 최대 비용처 |
| 메트릭 | Datadog infra + VictoriaMetrics 클러스터 | 2중 | VM은 잘 운영 중 — 확장 기반 |
| APM/트레이스 | Datadog 단독 | 1중 | 당분간 유지 |
| RUM (웹/모바일) | Datadog 단독 | 1중 | RWoL 재요율로 ~2배 인상 |

핵심 통찰 하나: **로깅 스택이 죽는 원인은 대개 기술이 아니라 오너십**이다. promtail이 방치되고 DaemonSet이 노드 교체와 함께 사라지는 것은 도구를 바꾼다고 해결되지 않는다. 그래서 "어떤 솔루션이냐"만큼 "우리가 스택 하나를 더 썩히지 않을 수 있느냐"가 선택의 실질적 기준이 된다.

## 솔루션 한눈에 보기

| 솔루션 | 계열 | 한 줄 성격 | 우리 케이스 포지션 |
|---|---|---|---|
| **OpenSearch (EFK)** | 검색엔진(Lucene) | 강력한 풀텍스트 검색, 그러나 비용의 ~90%가 인스턴스 시간 | 현행 — tail 이전 + in-place 최적화 |
| **Loki + Alloy** | 라벨 인덱스 + object storage | 저비용 로그 집계, 그러나 새 운영 모델 학습 부담 | 보류(SSD 모드 EOL 예정) |
| **VictoriaLogs** | Victoria 패밀리 | VM과 동일한 운영 모델, 초경량 · 풀텍스트 | **추천 — 로그 내재화의 축** |
| **ClickHouse (self-hosted)** | 컬럼형 OLAP | 극단적 압축, 로그+트레이스+RUM 통합 흡수 | 통합 이유가 생겼을 때(D4) |
| **HyperDX / ClickStack** | ClickHouse 위 UI 스택 | 웹 RUM·로그·트레이스 통합 프론트(턴키) | 웹 RUM 중계처 후보 |
| **StarRocks** | 컬럼형 MPP OLAP | S3 위 stateless 컴퓨트가 강점, 그러나 로그·UI는 미성숙 | 별도 mandate 없으면 제외 |
| **RUM 대안군** | Sentry/OpenReplay/Faro 등 | 셀프호스트 세션 리플레이 | → 별도 [RUM 내재화]({{< relref "../rum/_index.md" >}}) 도메인 |

## 블록 지도

| 블록 | 내용 |
|---|---|
| [솔루션별 특징]({{< relref "01-solutions.md" >}}) | OpenSearch·Loki·VictoriaLogs·ClickHouse·HyperDX·StarRocks 장단점, ClickHouse vs StarRocks |
| [우리 케이스 · 권장안]({{< relref "02-recommendation.md" >}}) | 최소 조합 아키텍처, 인건비 게이트, 저후회 시퀀싱, 하지 말 것, 결론 |
