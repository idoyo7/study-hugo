---
title: "장애 복구를 그룹 안으로 옮긴 MySQL Group Replication"
description: "우버는 왜 MySQL 장애 조치를 데이터베이스 안으로 옮겼을까요? 외부 감지와 승격이 지연되던 문제를 MySQL Group Replication의 내부 선출로 풀고, 쓰기 중단을 10초 이하로 줄였습니다."
date: 2026-11-10
weight: 2
---

# 장애 복구를 그룹 안으로 옮긴 MySQL Group Replication (2025-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Improving MySQL® Cluster Uptime: Designing Advanced Detection, Mitigation, and Consensus with Group Replication](https://www.uber.com/us/en/blog/improving-mysql-cluster-uptime-part1/)
- 매체 · 게시일: Uber Engineering Blog · 2025-12-02
- 저자: Siddharth Singh(Staff Software Engineer, Core Storage), Debadarsini Nayak(Senior Engineering Manager), Raja Sriram Ganesan(Sr Staff Software Engineer, Core Storage)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 장애 조치가 늦어진 우버의 MySQL {#기존-구조의-한계}

2020년부터 2023년까지 우버의 사내 Slack 지원 채널에는 약속한 시간 안에 감지하거나 완화하지 못한 MySQL 장애가 여러 차례 보고됐습니다. 서비스는 몇 분씩 멈췄습니다. 그동안 매출 손실도 발생했습니다.

우버가 운영하는 MySQL 클러스터는 2,600개가 넘습니다. ACID 트랜잭션과 관계형 모델, SQL이 필요한 서비스의 기반입니다. 기존 구성에서는 primary 하나가 쓰기를 받고, 여러 replica가 비동기로 primary의 binlog를 가져왔습니다. 읽기는 리전 친화성을 두고 replica에 라운드 로빈으로 나누며, 읽기 요청량에 맞춰 replica 수를 늘리는 방식입니다.

primary가 고장 나면 HC(Health Controller)와 MEPA(MySQL Emergency Promotion Automation) 같은 외부 시스템이 장애를 감지하고 새 primary를 승격했습니다. 완화 SLA는 약 120초였습니다. 중요한 서비스에는 이 시간도 길었지만, 실제로는 그 안에 처리하지 못한 장애도 많았습니다.

복구가 외부 구성요소의 사슬에 달려 있다는 점도 문제입니다. 어느 하나라도 지연되거나 멈추면 장애 조치가 늦어지거나 아예 막혔습니다. 운영자가 계속 지켜보며 개입해야 하는 방식이었습니다.

## 쓰기를 한 노드에 모은 MGR {#합의-프로토콜}

우버가 바꾼 것은 새 primary를 뽑는 주체입니다. MySQL Group Replication(MGR)은 여러 MySQL 서버가 하나의 내결함성 시스템으로 동작하게 하는 플러그인으로, primary가 고장 나면 남은 멤버끼리 새 primary를 선출합니다. 외부 도움은 필요하지 않습니다. 합의에는 데이터베이스 트랜잭션에 맞춘 Single-Decree Paxos 또는 Multi-Paxos 변형을 씁니다.

쓰기를 받는 노드는 하나로 유지했습니다. MGR 기본값인 단일 primary 모드에서는 트랜잭션을 제안하는 노드가 하나여서 합의와 일관성 유지가 단순하고, primary 간 쓰기 충돌이 없습니다. 대신 쓰기 처리량은 한 노드의 용량에 묶이며, 장애 때 새 primary를 선출하는 동안 잠깐 쓰기가 중단됩니다.

다중 primary 모드라면 여러 노드가 쓰기를 받고, 한 primary가 고장 나도 다른 primary가 계속 처리합니다. 그래도 모든 쓰기는 모든 노드에 전파해야 합니다. 충돌 해결도 필요하며, 외래 키의 연쇄 동작에서는 충돌을 감지하지 못할 위험이 있습니다. 우버는 쓰기를 여러 노드에 분산하는 대신 단순함을 택했습니다.

## primary를 직접 읽지 않는 replica {#합의-그룹}

합의 그룹에는 같은 리전의 MySQL 노드 셋을 둡니다. primary 하나가 쓰기를 받고, secondary 둘은 직접 쓰기를 받지 않은 채 합의에 참여합니다. 세 노드가 유지하는 데이터는 강한 일관성을 갖습니다.

읽기 용량은 그룹 밖에서 늘립니다. 여러 데이터센터에 둔 N개의 read replica가 그룹 안의 어느 secondary에서든 데이터를 복제해 옵니다. secondary 아래에 replica를 추가하므로 쓰기 성능에 영향을 주지 않고 읽기를 확장하는 구성입니다.

replica가 primary를 직접 읽지 않는 배치에는 이유가 있습니다. 고장 난 primary가 복구 과정에서 미커밋 트랜잭션을 roll-forward하더라도, 그 트랜잭션이 그룹 밖의 replica로 새지 않게 합니다. 따라서 primary 장애 뒤 errant GTID가 생기지 않습니다.

그룹 안에서는 MGR의 내장 flow control이 secondary의 수신 트랜잭션 큐를 지켜봅니다. 큐가 너무 길어지면 primary에 속도를 늦추거나 쓰기를 잠시 멈추라는 신호를 보냅니다. 빠른 primary를 따라가지 못한 secondary가 그룹에서 빠지는 일을 막는 장치입니다.

## 새 primary를 반영하는 라우팅 계층 {#승격-시간}

그룹 내부의 선출은 읽기 전용 replica를 승격하던 방식보다 훨씬 빠릅니다. 선출 뒤에는 라우팅 계층도 바뀐 primary를 반영해야 합니다. 우버가 밝힌 SLA에서 쓰기 불가 시간은 이 과정까지 합쳐 10초 이하입니다.

긴급 상황에서 MGR이 새 primary를 선출하는 데 5초 이하, 라우팅 계층이 새 primary를 반영하는 데 5초 이하를 달성할 수 있다고 합니다. 기존 구성의 장애 완화 SLA인 약 120초와 비교하는 수치입니다.

{{% details title="MGR의 승격 시간 목표와 기존 SLA" closed="true" %}}

| 항목 | 값 |
|---|---|
| 기존 완화 SLA | 약 120초 |
| MGR primary 선출 | 5초 이하 |
| 라우팅 계층의 최신 primary 반영 | 5초 이하 |
| 쓰기 불가 시간 합계 | 10초 이하 |
| 운영 MySQL 클러스터 수 | 2,600개 이상 |

{{% /details %}}

## 읽기 지연이 거의 같았던 YCSB 벤치마크 {#벤치마크}

합의를 도입하는 데도 비용은 듭니다. 우버는 YCSB(Yahoo! Cloud Serving Benchmark)로 기존 비동기·semi-synchronous 구성과 새 HA 구성을 비교했습니다. 삽입만, 갱신만, 읽기만 수행하는 작업과 읽기·쓰기 혼합 작업을 대상으로 연산 하나가 끝날 때까지의 지연 시간을 쟀습니다.

쓰기 지연은 조금 늘었습니다. 삽입 중앙값은 비동기 1.938ms에서 HA 2.436ms로 약 0.5ms 늘었고, 갱신 중앙값은 1.432ms에서 1.771ms가 됐습니다. P99에서는 삽입이 10.983ms에서 13.999ms로, 갱신이 6.131ms에서 8.791ms로 늘었습니다.

읽기는 거의 차이가 없었습니다. 중앙값은 비동기 0.821ms, HA 0.85ms입니다. 읽기 요청은 로컬 replica가 합의 통신 없이 처리하므로, 읽기 비중이 큰 우버 시스템은 합의를 도입하고도 읽기 지연을 거의 그대로 유지했습니다.

우버는 이 정도의 쓰기 지연 증가를 감수하더라도, 데이터 손실 없이 빠르게 장애를 복구하고 읽기를 확장하는 편이 낫다고 판단했습니다.

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

이 설계와 결과는 MySQL and Heatwave Summit 2025에서 공개됐습니다. 이 글은 시리즈 1편이며, 후속 글에서는 자동화 워크플로와 노드 처리, 장애 조치 동작, 일관성 보장을 다룰 예정입니다.
