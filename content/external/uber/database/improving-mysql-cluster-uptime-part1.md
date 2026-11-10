---
title: "Group Replication으로 설계한 MySQL 클러스터 장애 감지·완화와 합의 구조"
description: "우버가 외부 시스템에 기대던 MySQL 장애 조치를 MySQL Group Replication 기반 합의 그룹으로 바꾼 이유와 구조를 요약합니다. YCSB 벤치마크 지연 비교와 승격 시간 목표까지 정리했습니다."
date: 2026-11-10
weight: 1
---

# Group Replication으로 설계한 MySQL 클러스터 장애 감지·완화와 합의 구조 (2025-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Improving MySQL® Cluster Uptime: Designing Advanced Detection, Mitigation, and Consensus with Group Replication](https://www.uber.com/us/en/blog/improving-mysql-cluster-uptime-part1/)
- 매체 · 게시일: Uber Engineering Blog · 2025-12-02
- 저자: Siddharth Singh(Staff Software Engineer, Core Storage), Debadarsini Nayak(Senior Engineering Manager), Raja Sriram Ganesan(Sr Staff Software Engineer, Core Storage)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 단일 primary 비동기 복제의 한계 {#기존-구조의-한계}

우버는 ACID 트랜잭션과 관계형 모델이 필요한 서비스에 MySQL을 쓰고, 운영하는 클러스터는 2,600개가 넘습니다. 클러스터는 primary 하나와 replica 여러 대로 구성됩니다. 복제는 기본적으로 비동기여서 replica가 primary의 binlog를 가져가 반영합니다. 쓰기는 primary만 받고, 읽기는 리전 친화성을 두고 replica에 라운드 로빈으로 나눕니다.

2020년부터 2023년까지는 장애를 약속한 시간 안에 감지하고 완화하지 못한 사례가 적지 않았습니다. 사내 Slack 지원 채널로 접수된 일이 많았고, 그때마다 서비스는 몇 분씩 멈추고 매출도 새어 나갔습니다. primary가 죽으면 HC(Health Controller)와 MEPA(MySQL Emergency Promotion Automation) 같은 외부 시스템이 이상을 알아채고 새 primary를 올렸습니다.

원문이 꼽은 문제는 세 가지입니다.

- 감지부터 승격까지 걸리는 시간이 길었습니다. 완화 SLA는 약 120초였습니다.
- 외부 구성요소의 사슬에 기대는 구조여서, 하나라도 멈추면 장애 조치가 늦어지거나 아예 일어나지 않았습니다.
- 사람의 상시 개입 없이는 가동 시간을 보장하기 어려웠습니다.

## 합의 그룹과 확장형 read replica {#합의-그룹}

우버는 장애를 데이터베이스 안에서 처리하는 분산형 접근을 택했고, 그 수단이 MySQL Group Replication(MGR)입니다. MGR은 MySQL 서버 묶음이 하나의 내결함성 시스템처럼 동작하게 하는 플러그인으로, Paxos 계열 합의 프로토콜로 모든 멤버가 같은 데이터를 갖도록 합니다. primary가 쓰러지면 나머지 노드가 외부 도움 없이 새 primary를 뽑습니다.

클러스터 안에는 MySQL 노드 셋으로 이루어진 합의 그룹을 둡니다. 한 노드가 쓰기를 받는 primary이고, 같은 리전의 나머지 둘은 직접 쓰기는 받지 않지만 쓰기 합의에 참여하는 secondary입니다. 읽기 용량은 N개의 read replica로 늘립니다. replica는 여러 데이터센터에 흩어져 있고, 합의 그룹 안의 어느 secondary에서든 데이터를 복제해 옵니다.

원문이 꼽은 이점은 다섯 가지입니다.

- 장애 시 읽기 전용 replica를 승격하는 대신 그룹 안에서 새 primary를 자동으로 선출하므로 쓰기 중단이 짧아집니다.
- replica가 primary를 직접 읽지 않아서, primary가 죽으며 남긴 미커밋 트랜잭션이 그룹 밖으로 새지 않습니다. 따라서 errant GTID 문제가 생기지 않습니다.
- MGR의 내장 flow control이 빠르게 쓰는 primary가 secondary를 압도하는 것을 막습니다. secondary의 수신 트랜잭션 큐가 길어지면 primary에 신호를 보내 속도를 늦추게 합니다.
- 장애 조치가 빨라지는 만큼 애플리케이션 가용성이 올라갑니다.
- secondary에 read replica를 붙이면 쓰기 성능에 영향 없이 읽기를 늘릴 수 있습니다.

원문은 성능 오버헤드가 약간 생기지만 가동 시간과 확장성에서 얻는 것이 더 크다고 평가합니다.

## 합의 프로토콜과 단일 primary 선택 {#합의-프로토콜}

MGR은 Paxos를 기반으로 하며, 원문은 데이터베이스 트랜잭션에 맞춰 최적화된 Single-Decree Paxos 또는 Multi-Paxos 변형이라고 설명합니다. 운영 모드는 단일 primary와 다중 primary 두 가지이고, 원문은 다섯 항목으로 비교합니다.

- 복잡도: 단일 primary는 트랜잭션을 제안하는 노드가 하나라 합의가 단순합니다. 다중 primary는 충돌 해결이 필요합니다.
- 충돌 가능성: 단일 primary는 없습니다. 다중 primary는 높고, 외래 키의 연쇄 동작이 감지되지 않는 충돌을 낳을 위험 같은 알려진 한계가 있습니다.
- 쓰기 확장성: 단일 primary는 한 노드의 용량에 묶입니다. 다중 primary는 여러 노드가 동시에 쓸 수 있지만 결국 모든 쓰기가 모든 노드에 닿아야 합니다.
- 장애 영향: 단일 primary는 새 primary 선출 동안 잠깐 끊깁니다. 다중 primary는 다른 primary가 쓰기를 계속 받습니다.
- 일관성: 단일 primary는 트랜잭션의 출처가 하나라 유지하기 쉽습니다. 다중 primary는 순서와 충돌을 세심하게 관리해야 합니다.

우버는 단순함과 장점을 이유로 MGR 기본값이기도 한 단일 primary를 배포했습니다.

## YCSB 벤치마크 {#벤치마크}

새 구조를 검증하려고 YCSB(Yahoo! Cloud Serving Benchmark)로 기존 비동기, semi-synchronous 구성과 새 HA 구성을 견주었습니다. 시나리오는 삽입만, 갱신만, 읽기만, 읽기와 쓰기 혼합입니다. 지표는 연산 하나가 끝나기까지의 지연 시간입니다.

결과는 쓰기에서 작은 오버헤드가 있고 읽기에서는 거의 차이가 없다는 것입니다. 삽입 중앙값은 비동기 1.938ms에 HA 2.436ms로 약 0.5ms 늘었고, 갱신 중앙값은 1.432ms에서 1.771ms가 되었습니다. 읽기는 로컬 replica가 그룹과 통신 없이 처리하므로 중앙값이 0.821ms와 0.85ms로 사실상 같았습니다. 읽기 비중이 큰 우버 시스템에는 이 점이 크다고 합니다.

## 승격 시간 목표 {#승격-시간}

MGR 구성에서 달성한 SLA는 다음과 같습니다. 긴급 상황에서 MGR 플러그인이 primary를 선출하는 데 5초 이하, 라우팅 계층이 새 primary를 반영하는 데 5초 이하, 쓰기 불가 시간은 합계 10초 이하입니다. 이전의 약 120초와 견줍니다.

원문은 합의 기반 단일 primary 구성이 외부 시스템 의존을 줄이고 내부 선출로 장애 조치를 앞당기며 그룹 안 데이터 일관성을 지킨다고 맺습니다. 결과는 MySQL and Heatwave Summit 2025에서 공개했고, 자동화 워크플로, 노드 처리, 장애 조치 동작, 일관성 보장을 다룰 후속 글을 예고합니다. 이 글이 시리즈 1편입니다.

{{% details title="YCSB 지연 시간 비교 (비동기 / semi-synchronous / HA)" closed="true" %}}

| 연산 | 지표 | 비동기 | Semi-sync | HA |
|---|---|---|---|---|
| 삽입 | 중앙값 | 1.938ms | 2.384ms (Δ446μs) | 2.436ms (Δ520μs) |
| 삽입 | P95 | 3.831ms | 5.503ms (Δ1.6ms) | 4.159ms (Δ328μs) |
| 삽입 | P99 | 10.983ms | 13.631ms (Δ2.6ms) | 13.999ms (Δ3.016ms) |
| 갱신 | 중앙값 | 1.432ms | 1.625ms (Δ193μs) | 1.771ms (Δ339μs) |
| 갱신 | P95 | 2.065ms | 2.693ms (Δ628μs) | 2.359ms (Δ294μs) |
| 갱신 | P99 | 6.131ms | 7.899ms (Δ1.7ms) | 8.791ms (Δ2.6ms) |
| 읽기 | 중앙값 | 0.821ms | 0.82ms | 0.85ms (Δ30μs) |
| 읽기 | P95 | 1.01ms | 1.02ms (Δ10μs) | 1.04ms (Δ30μs) |
| 읽기 | P99 | 1.34ms | 1.35ms (Δ10μs) | 1.37ms (Δ30μs) |

{{% /details %}}

{{% details title="승격 시간 SLA와 기존 구성" closed="true" %}}

| 항목 | 값 |
|---|---|
| 기존 완화 SLA | 약 120초 |
| MGR primary 선출 | 5초 이하 |
| 라우팅 계층의 최신 primary 반영 | 5초 이하 |
| 쓰기 불가 시간 합계 | 10초 이하 |
| 운영 MySQL 클러스터 수 | 2,600개 이상 |

{{% /details %}}
