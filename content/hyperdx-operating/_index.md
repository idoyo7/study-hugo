---
title: "HyperDX 직접 운영하기"
description: "우리 클러스터의 배포 형상·런북·의사결정 3장을 담은 트랙입니다. 우리만의 사실·순서는 이 트랙이, 버전·수치·매트릭스는 hyperdx 기준 문서가 소유한다는 경계 규칙 R1~R3를 정합니다."
date: 2026-07-18
lastmod: 2026-08-24
weight: 80
aliases: ["/hyperdx/00-operating-hyperdx/", "/hyperdx/operating/"]
cascade:
  type: docs
comments: false
---

# HyperDX 직접 운영하기

2026-08에 배포한 stage 구성과 이를 prod로 확장하기 위해 남겨 둔 작업을 기록합니다. 당시 stage는 ClickHouse replica 1, MongoDB 단일 멤버, Collector 인메모리 큐, EBS 단일 티어였습니다. prod 목표인 RF2·영속 큐·S3 cold 티어링이 모두 적용된 상태로 읽으면 안 됩니다. 이후의 문서 수정일도 클러스터를 다시 측정한 날짜를 뜻하지 않습니다.

우리 배포에는 표준 ClickStack에 없는 자체 RUM 컨버터가 있습니다. 브라우저·모바일 RUM을 ClickHouse에 직접 적재하고, 일반 텔레메트리는 OTel Collector로 수집합니다. 장애를 조사할 때도 어느 경로에서 멈췄는지 구분해야 합니다.

<span id="2-3부-구성"></span>

## 필요한 기록 찾기 {#1-경계-판정-규칙--어떤-문단이-어느-섹션에-속하나}

| 상황 | 문서 |
|---|---|
| 배포된 컴포넌트와 prod까지 남은 차이를 확인한다 | [우리 배포 형상]({{< relref "01-our-deployment.md" >}}) |
| UI 장애, 적재 중단, 노드 소실에 대응하거나 변경 작업을 준비한다 | [운영 런북]({{< relref "02-runbook.md" >}}) |
| 디스크·replica·Keeper를 늘릴지 판단하거나 배포 전 실측을 준비한다 | [의사결정 가이드]({{< relref "03-decision-guide.md" >}}) |

<span id="3-기준-문서와의-관계"></span>

구성을 이해하는 데 필요한 설명과 매니페스트는 [HyperDX 내재화]({{< relref "../hyperdx/_index.md" >}})에 있습니다. 컴포넌트 연결은 [스택 토폴로지]({{< relref "../hyperdx/01-stack-topology.md" >}}), 노드 교체와 장애 영향은 [토폴로지와 다운타임]({{< relref "../hyperdx/04-operator-topology-downtime.md" >}}), 보관 용량은 [용량 산정]({{< relref "../hyperdx/07-capacity-planning.md" >}})으로 이어집니다.

## prod 전에 확인할 것 {#우리-케이스에서는}

월 0.7TB의 의미와 리플레이 압축비부터 측정해야 합니다. 원본 수집량과 압축 후 저장량을 혼동하면 볼륨과 비용 계산이 달라집니다. 실제 테이블의 TTL, 노드 교체 시 EBS 재연결 시간도 아직 확인할 항목입니다.

S3 cold 티어링을 켜기 전에는 IRSA 인증, replica별 객체 경로, VPC Endpoint 연결, 로컬 메타데이터 크기와 볼륨 보존 설정을 검증합니다. [의사결정 가이드]({{< relref "03-decision-guide.md" >}})에 측정 방법과 남은 항목을 모았습니다. 검증되지 않은 설계는 `≈` 또는 `?`로 남겨 두고, 실제 관측 결과가 생기면 배포 기록과 함께 갱신합니다.
