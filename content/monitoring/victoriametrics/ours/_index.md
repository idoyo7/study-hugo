---
title: "우리의 운영"
weight: 3
---

# 우리의 운영 — 우리 환경의 구성·튜닝·기준치

{{< callout type="info" >}}
**한눈에**
- 이 서브섹션은 네이버 D2 사례가 아니라 **우리 환경의 실제 구성·튜닝·기준치·노하우**를 다룬다.
- 출발점은 k8s 위 VM operator로 띄운 **stateless vmagent**가 중앙 VM 클러스터의 vminsert로 `remote_write` 하는 구조다.
- Phase 1 튜닝의 두 축: **VM native protocol(zstd) 고정**(`forceVMProto`)과 **디스크 큐 상한 명시**(`maxDiskUsagePerURL`).
- 개념(concepts)에서 배운 원리와 실전(practice)의 설계 원칙을 **우리 값·우리 임계**로 번역한 계층이다.
{{< /callout >}}

concepts는 네이버 D2/DEVIEW 발표를 정독해 VM의 내부 동작을 잡았고, practice는 그 위에서 카디널리티·초대규모 운영 같은 설계 원칙을 정리했다. 이 서브섹션은 그 원리와 원칙을 **우리 환경의 구체적인 값**으로 옮긴다. 어떤 리소스로 vmagent를 띄웠고, 무엇을 왜 튜닝했으며, 어떤 메트릭을 어떤 임계로 감시하는지 — 즉 "네이버는 이렇게 한다"가 아니라 "우리는 이렇게 운영한다"를 담는다.

> 관련 블록: [개념 03 수집]({{< relref "../concepts/03-ingestion.md" >}}) · [실전 01 카디널리티]({{< relref "../practice/01-cardinality.md" >}}) · [메트릭 장기보관]({{< relref "../../longterm-retention/_index.md" >}}) · [VM Deep Dive 허브]({{< relref "../_index.md" >}})

## 세 계층의 관계

| 계층 | 무엇을 다루나 | 사실 원천 |
|------|--------------|-----------|
| **concepts (기본 개념)** | TSDB·아키텍처·수집·저장·쿼리의 원리 | 네이버 D2/DEVIEW 발표 정독 |
| **practice (잘 쓰는 방법)** | 카디널리티·초대규모 운영·무중단 전환 설계 원칙 | 위 개념의 실전 적용 |
| **ours (우리의 운영)** | 우리 클러스터의 실제 구성·튜닝·기준치 | 우리 환경 실측·변경 이력 |

원리가 궁금하면 concepts로, "어떻게 설계해야 하나"가 궁금하면 practice로 올라가고, "우리는 지금 어떤 값으로 돌고 있나"가 궁금하면 이 서브섹션에 머문다.

## 문서 지도

| 문서 | 주제 | 한 줄 요약 |
|------|------|-----------|
| [01 스택 구성]({{< relref "01-stack-overview.md" >}}) | 구조 | k8s + VM operator vmagent → 중앙 vminsert, stage/prod 값 차이 |
| [02 vmagent 전송 튜닝]({{< relref "02-vmagent-transport-tuning.md" >}}) | Phase 1 | `forceVMProto`(zstd 고정)·`maxDiskUsagePerURL`(디스크 큐 상한), 적용 순서 |
| [03 자기감시 메트릭]({{< relref "03-self-monitoring-metrics.md" >}}) | 관측 | 전송 재시도·드랍·바이트·pending 큐 4지표 + 카디널리티 인벤토리 |
| [04 스케일링·용량 기준치]({{< relref "04-scaling-thresholds.md" >}}) | 용량 | 디스크 큐 산정식, 리소스 기준치, HA 트레이드오프, slow insert 임계 |

## 읽는 순서

- **구조부터**: 01에서 우리 스택 전체 그림과 stage/prod 값 차이를 잡는다.
- **왜 이렇게 튜닝했나**: 02에서 Phase 1 두 변경(zstd 고정·디스크 큐 상한)의 근거를 본다.
- **잘 도는지 확인**: 03의 4개 자기감시 메트릭으로 적용 효과와 이상을 판정한다.
- **얼마나 버티나**: 04에서 큐 상한 산정식과 리소스·HA 기준치를 정리한다.
