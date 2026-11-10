---
title: "존 장애를 견디는 우버의 OpenSearch"
description: "우버가 OpenSearch 클러스터에서 존 하나가 통째로 사라져도 조회와 색인을 유지하려고 isolation group과 shard allocation awareness를 묶은 방식을 요약합니다. 데이터 노드와 클러스터 매니저 노드 각각의 장애 시나리오를 다룹니다."
date: 2026-11-10
weight: 2
---

# 존 장애를 견디는 우버의 OpenSearch (2026-06)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Zone-Failure-Resilient OpenSearch® at Uber](https://www.uber.com/us/en/blog/zone-failure-resilient/)
- 매체 · 게시일: Uber Engineering Blog · 2026-06-25
- 저자: Smit Patel(Senior Software Engineer, Search Platform 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 존 장애 내성이라는 필수 요건 {#background}

우버에서 OpenSearch는 모든 티어의 사용처에 쓰이고, 존 장애 내성(ZFR, Zone Failure Resilience)은 협상 대상이 아닌 요건입니다. 존 하나가 통째로 사라져도 조회와 데이터 색인 같은 핵심 기능이 영향을 받지 않아야 ZFR을 갖췄다고 봅니다.

우버는 OpenSearch의 shard allocation awareness 기능에 자체 isolation group 인프라를 결합해 이 요건을 맞췄습니다. isolation group은 우버의 컨테이너 오케스트레이션 플랫폼인 Odin 위에 만든 것입니다. 여기에 forced awareness를 더하면 존이 떨어졌을 때 샤드가 한꺼번에 재배치되는 일을 피할 수 있습니다. 샤드 복제본이 3개 이상이고 클러스터 매니저 노드가 5개이면, 존 하나가 나가고 노드 하나가 더 나가도 정족수와 데이터가 유지됩니다.

## 장애 도메인을 추상화한 isolation group {#isolation-group}

isolation group은 클러스터 노드를 존이나 랙 같은 장애 도메인에 더 고르고 예측 가능하게 나눠 놓는 논리적 분할 단위입니다. 특징은 세 가지입니다.

- 물리적 장애 도메인(존, 랙)에 깔끔하게 대응하도록 설계했습니다. 이상적인 구성에서는 여러 isolation group이 같은 존을 공유하지 않으며, 공유하면 스케줄러가 배치 페널티를 부과합니다.
- 노드를 역할(데이터 노드, 클러스터 매니저 노드)별로 isolation group에 균등하게 나눕니다. 중요한 역할이 한 장애 도메인에 몰리지 않습니다.
- 노드와 그 대체 노드는 물리 호스트가 바뀌어도 같은 isolation group에 속합니다. 샤드 배치 의미가 일정하게 유지되는 데 필요한 성질입니다.

우버의 대부분 기술은 OpenSearch를 포함해 isolation group을 3개 씁니다. 존 하나는 isolation group 하나에만 대응하므로, 존 하나가 나가도 잃는 용량은 최대 약 33%입니다. 물리 존은 보통 3개보다 많고, 모든 존에 노드를 고르게 배치하려면 존마다 용량을 맞춰야 해서 복잡합니다. isolation group은 이 문제를 덮는 추상화 계층입니다.

원문 그림 1은 shard allocation awareness가 샤드 복제본을 isolation group에 고르게 퍼뜨려 단일 존 장애에 대한 기본 내성을 준다는 점을 보여 줍니다.

## 복제본을 고르게 배치하는 shard allocation awareness {#shard-allocation-awareness}

OpenSearch는 노드의 논리적 묶음에 샤드 복제본을 고르게 나눠 담는 shard allocation awareness를 지원합니다. opensearch.yml에 사용자 정의 노드 속성을 정의하고, 클러스터 수준에서 그 속성 기준의 awareness를 켜면 됩니다. 원문 그림 2에 따르면 노드의 isolation group 속성은 technology worker 사이드카 컨테이너가 가져와 opensearch.yml에 넣습니다.

샤드 복제본이 모두 5개(프라이머리 1, 레플리카 4)라면 3개 isolation group에 2, 2, 1 꼴로 놓이고, 어느 두 그룹의 복제본 수 차이도 1을 넘지 않습니다. 다만 속성값마다 노드 풀이 어느 정도 균형 잡혀 있어야 합니다. 노드가 isolation group 사이에 고르지 않고 자원 제약 때문에 고른 분산을 못 지키면 일부 복제본은 할당되지 않은 채 남습니다. 노드를 고르게 나누는 일이 선결 조건인 이유입니다.

우버의 모든 OpenSearch 인덱스는 레플리카를 최소 2개, 즉 복제본 3개 이상으로 설정합니다. 이 3개가 isolation group 3개에 나뉘어 놓이므로 단일 존이나 단일 그룹 장애에서 데이터를 잃지 않는 기본 내성이 생깁니다.

## 장애 때 재배치를 막는 forced awareness {#forced-awareness}

정상 상태에서는 awareness만으로 충분하지만 존 장애는 다른 문제를 만듭니다. isolation group 하나의 노드가 전부 내려가면 OpenSearch는 사라진 복제본을 감지하고, 기본 동작으로 남은 isolation group에 고르게 다시 배치하려 합니다. 그러면 살아 있는 노드에서 디스크 I/O, CPU, 네트워크 대역폭이 크게 소모됩니다. 그 부하가 쿼리 지연을 키우고, 심하면 남은 존에서 연쇄 장애로 번질 수 있습니다.

forced shard allocation awareness는 이를 막습니다. 클러스터에 현재 존재하는 값이 아니라 기대하는 속성값 전체(예를 들어 isolation group 3개)를 명시해 두는 방식입니다. 그룹 하나가 사라지면 OpenSearch는 빠진 속성값이 있음을 알고 남은 그룹에 복제본을 과하게 할당하지 않습니다. 사라진 그룹에 속한 샤드는 미할당으로 남고 클러스터는 대체로 공격적인 재배치 대신 yellow 상태로 넘어갑니다.

이렇게 하면 두 가지 이점이 있습니다.

- 정상 존이 갑작스러운 재배치 부하를 받지 않아 기존 트래픽에 대해 안정적이고 성능이 유지됩니다.
- 미할당 샤드는 실패한 존이나 isolation group이 복구되어 같은 속성값의 노드가 돌아오거나, 관리자가 forced awareness 설정을 직접 제거하거나 바꿀 때만 할당됩니다. 후자는 예컨대 남은 존에 용량을 늘린 뒤 샤드를 재분배하기로 했을 때입니다.

원문은 이를 두고, 존 장애 중에는 즉각적인 완전 복제를 포기하는 대신 클러스터 안정성을 얻는 거래라고 설명합니다.

## 존 장애 뒤 노드 장애까지 견디는 구성 {#zone-and-node-failure}

가장 중요한 시나리오는 존 장애 직후 다른 존에서 노드 하나가 더 죽는 경우입니다.

데이터 노드는 설계가 단순합니다. 우버의 Tier 3 이하 OpenSearch/Elasticsearch 클러스터는 모두 샤드 복제본을 3개 이상 유지하고, 이를 shard allocation awareness로 isolation group 3개에 나눕니다. 존 장애로 isolation group 하나와 복제본 하나가 사라지고, 뒤이어 다른 존의 노드 장애로 복제본 하나가 더 사라져도 마지막 isolation group의 세 번째 복제본은 남습니다.

클러스터 매니저 노드는 사정이 다릅니다. 3개 중 2개가 죽으면 클러스터는 정족수를 잃고 전체가 멈춘 red 상태가 됩니다. OpenSearch는 `cluster.auto_shrink_voting_configuration: true`로 투표 구성을 살아 있는 클러스터 매니저 노드 집합으로 동적으로 줄일 수 있고, 우버는 이 기능을 쓰면서 클러스터 매니저 노드를 3개 대신 5개 둡니다. 장애는 다음 순서로 진행됩니다.

1. 클러스터 매니저 노드 5개가 3개 isolation group, 곧 여러 존에 나뉘어 있습니다.
2. 존 하나가 내려가면 최대 2개를 잃고 3개가 남습니다.
3. auto shrink가 작동해 투표 구성이 살아 있는 3개로 줄어듭니다.
4. 3개 중 2개의 정족수로 새 프라이머리 리더를 뽑습니다.
5. 뒤이어 클러스터 매니저 노드 1개가 더 죽어도 2개가 남아 정족수(2/3)가 충족되므로 리더를 뽑고 유지할 수 있습니다.

## 도입 효과 {#impact}

이전에는 물리 존 ID를 기준으로 삼았는데, 물리 존마다 노드 수가 고르지 않아 OpenSearch의 awareness 로직이 모든 샤드에 유효한 배치를 찾지 못했고 그 결과 클러스터가 yellow 상태로 남곤 했습니다. isolation group은 균형 잡힌 추상화라서 모든 그룹의 노드 수가 같게 보장되고, 샤드가 100% 할당되어 클러스터가 green으로 유지됩니다. 물리 존의 비대칭 때문에 생기던 디스크 편중과 핫 노드도 없앴습니다.

원문은 isolation group으로 물리 배치를, shard allocation awareness로 논리 배치를 맡겨 OpenSearch의 내성을 물리 데이터센터 토폴로지의 복잡성에서 분리했다고 정리합니다. 덕분에 존 장애에 노드 하나가 더 죽는 상황에서도 우버의 검색·분석 인프라가 안정적으로 가용성을 유지한다고 합니다.

{{% details title="원문의 구성 수치와 장애 시나리오 기준값" closed="true" %}}

| 항목 | 값 |
|---|---|
| isolation group 수 | 3개 (대부분의 우버 기술 공통) |
| 존 하나 장애 시 최대 용량 손실 | 약 33% |
| 인덱스 레플리카 수 | 최소 2개 (복제본 총 3개 이상) |
| 복제본 5개일 때 배치 | 2, 2, 1 (그룹 간 차이 1 이하) |
| 클러스터 매니저 노드 수 | 5개 |
| 존 장애 직후 남는 클러스터 매니저 노드 | 최대 2개 손실, 3개 생존 |
| 노드 1개 추가 장애 뒤 정족수 | 2개 생존, 2/3 충족 |
| 투표 구성 축소 설정 | cluster.auto_shrink_voting_configuration: true |
| 존 장애 시 클러스터 상태 | 대체로 yellow (재배치 대신 미할당 유지) |
| 3개 복제본 유지 대상 | Tier 3 이하 OpenSearch/Elasticsearch 클러스터 |

{{% /details %}}
