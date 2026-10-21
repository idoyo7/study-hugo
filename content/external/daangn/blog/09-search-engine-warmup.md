---
title: "당근 검색 엔진, 쿠버네티스로 쉽게 운영하기 2편 — 데이터 노드 웜업 적용"
description: "당근 검색 플랫폼팀이 Elasticsearch 롤링 리스타트 때 생기던 지연 급증을 search-coordinator 프록시와 데이터 노드 웜업으로 해결한 과정의 요약입니다. 피크 시간에도 배포할 수 있게 됐습니다."
date: 2026-10-21
weight: 2
---

# 당근 검색 엔진, 쿠버네티스로 쉽게 운영하기 2편 — 데이터 노드 웜업 적용 (2025-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [당근 검색 엔진, 쿠버네티스로 쉽게 운영하기 2편 — 데이터 노드 웜업 적용](https://medium.com/daangn/%EB%8B%B9%EA%B7%BC-%EA%B2%80%EC%83%89-%EC%97%94%EC%A7%84-%EC%BF%A0%EB%B2%84%EB%84%A4%ED%8B%B0%EC%8A%A4%EB%A1%9C-%EC%89%BD%EA%B2%8C-%EC%9A%B4%EC%98%81%ED%95%98%EA%B8%B0-2%ED%8E%B8-%EB%8D%B0%EC%9D%B4%ED%84%B0-%EB%85%B8%EB%93%9C-%EC%9B%9C%EC%97%85-%EC%A0%81%EC%9A%A9-f687a6c2c00a)
- 영문판: [Running Elasticsearch on Kubernetes the Easy Way, Part 2: Data Node Warm-up](https://medium.com/daangn/running-elasticsearch-on-kubernetes-the-easy-way-part-2-data-node-warm-up-0d81d433c5c1)
- 매체 · 게시일: Medium 당근 블로그 · 2025-12-15
- 저자: Dongsun Shin (Ellie, Jarry, 당근 검색 플랫폼팀). SRE팀 클러스터 파트 글이 아닙니다.
- 근거: 블로그 본문 한국어판 (도식과 그래프 속 수치는 확인하지 않았습니다. 영문판은 링크만 확인했습니다)
- 이 문서는 원문을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## 롤링 리스타트가 배포를 제한한 이유

1편에서 ECK로 배포를 자동화했어도 피크 시간은 피해야 했습니다. 2년 사이 클러스터가 네 개로 늘면서 클러스터당 90분씩 걸리는 배포에 담당자가 6시간 넘게 붙어 있어야 했습니다. 피크·점심·퇴근 전후를 빼면 배포 가능한 시간은 하루 몇 시간뿐이었고, 배포는 여전히 큰 이벤트처럼 느껴졌습니다.

Elastic Operator 버전 이슈로 모든 StatefulSet이 롤링 리스타트됐을 때, Pod가 Ready가 되자마자 다음 Pod가 재시작됐습니다. ES 캐시는 비어 있었고 일부 샤드는 primary와 replica가 연이어 영향을 받아 검색 서비스 전반에 큰 장애가 났습니다.

쿠버네티스의 readinessProbe나 postStart hook으로는 이 상황을 막을 수 없었습니다. ES 프로세스는 뜨자마자 클러스터에 join해 샤드를 받습니다. 요청 역시 Service를 거치지 않고 ES 내부 라우팅으로 들어옵니다.

## 요청 전달과 웜업을 맡는 search-coordinator

서버와 ES 사이에 둔 프록시 search-coordinator는 검색 요청 전달과 웜업을 맡습니다. 검색 대상 데이터 노드 목록인 prefer_nodes는 Central Dogma에 저장했으며, search-coordinator만 이 목록을 읽고 씁니다. 네임스페이스마다 ECK 클러스터 하나와 search-coordinator 하나를 짝지었습니다.

노드 종료 시 preStop 스크립트가 알리면 search-coordinator는 해당 노드를 prefer_nodes에서 빼고 Redis Sorted Set 웜업 대기열에 넣습니다. preStop이 실패하면 Pod 이벤트를 구독하는 controller가 대신 처리합니다.

노드가 올라온 뒤에는 Redis 분산 락을 획득한 Pod 하나가 웜업을 맡습니다. Kafka에 쌓인 실제 검색 요청 로그를 쿼리로 사용하며, 같은 쿼리를 여러 번 받아야 캐시하는 Lucene 캐시 정책에 맞춰 최대 5회 재사용합니다. 최소 요청 수와 최소 실행 시간을 채우고 최근 응답의 p50과 p90 지연이 임계값 이내여야 통과입니다. 통과한 노드는 대기열에서 빼고 prefer_nodes에 추가하며, 실패한 노드는 대기열에 남겨 다른 Pod가 재시도하게 합니다.

샤드 부족을 막기 위해 한꺼번에 웜업하는 노드는 최대 2개로 제한했습니다. 모든 인덱스에 샤드당 replica를 2개 이상 두도록 강제해 최악에도 한 복사본은 남게 했습니다.

## 배포 시간과 검색 지연의 변화

- 롤링 리스타트 때 평소의 3~5배까지 치솟던 p90 지연이 평소 수준으로 유지되며, p99도 1초 이내로 서빙합니다.
- 네 클러스터를 한꺼번에 롤링 리스타트해 전체 배포를 1~2시간 안에 마칩니다.
- 피크 시간에도 배포할 수 있고, 예기치 못하게 재시작한 노드도 자동으로 제외·웜업·복귀 과정을 거칩니다.

## 웜업이 보장하지 못하는 범위

대기열에 노드가 3개 이상 쌓이면 가장 오래된 노드는 웜업을 마치지 못했어도 복귀시킵니다. 검색 쿼리 DSL 구조가 크게 바뀔 때는 Kafka에 쌓인 쿼리 패턴과 실제 트래픽이 어긋나 웜업 효과가 떨어질 수 있습니다. ES 클러스터 전체가 불능이거나 네트워크 장애로 ES에 닿지 못하는 상황에는 search-coordinator도 거의 대응하지 못합니다.

이 글은 [1편]({{< relref "/external/daangn/blog/07-search-engine-on-kubernetes.md" >}})에서 이어집니다.

{{% details title="근거와 세부 수치" closed="true" %}}

| 항목 | 도입 전 | 도입 후 |
|---|---|---|
| 클러스터 수 | 1편 당시 1개 | 4개 |
| 클러스터당 배포 시간 | 약 90분 | 해당 없음 |
| 전체 배포 | 6시간 이상, 담당자 상주 | 1~2시간 |
| 롤링 리스타트 중 p90 지연 | 평소의 3~5배 | 평소 수준 |
| p99 지연 목표 | 해당 없음 | 1초 이내 |
| 동시 웜업 상한 | 해당 없음 | 2개 (샤드당 primary 1개 + replica 2개 기준) |
| 웜업 쿼리 재사용 | 해당 없음 | 최대 5회 |

{{% /details %}}
