---
title: "VictoriaMetrics 사용기"
description: "우리 환경의 VictoriaMetrics 스택 구성, vmagent 전송 튜닝, 자기감시 메트릭, 용량 기준과 클러스터 간 전송·AZ 분할 경험을 기록합니다."
date: 2026-07-18
lastmod: 2026-10-04
aliases: ["/monitoring/victoriametrics/ours/"]
weight: 2
comments: false
---

# VictoriaMetrics 사용기

{{< callout type="info" >}}
- 우리 환경의 실제 구성·튜닝·기준치·노하우를 다룹니다.
- 각 워크로드 클러스터의 vmagent가 수집·전송을 맡고, 원격 저장 클러스터의 vmstorage가 메트릭을 영속 보관합니다.
- Phase 1에서는 VM native protocol(zstd)을 고정하고(`forceVMProto`) 디스크 큐 상한을 명시했습니다(`maxDiskUsagePerURL`).
- 개념(concepts)에서 배운 원리와 실전(practice)의 설계 원칙을 우리 값·우리 임계로 옮긴 계층입니다.
{{< /callout >}}

우리 환경에서 VictoriaMetrics를 구성하고 운영하며 남긴 기록입니다. 어떤 리소스로 vmagent를 띄웠는지, 무엇을 왜 튜닝했는지, 어떤 메트릭을 어떤 임계로 감시하는지 다룹니다. 내부 동작과 일반적인 설계 원칙은 별도 [VictoriaMetrics]({{< relref "../victoriametrics/_index.md" >}}) 섹션에서 이어 볼 수 있습니다.

> 관련 문서: [개념 03 수집]({{< relref "../victoriametrics/concepts/03-ingestion.md" >}}) · [실전 01 카디널리티]({{< relref "../victoriametrics/practice/01-cardinality.md" >}}) · [메트릭 장기보관]({{< relref "../longterm-retention/_index.md" >}}) · [VictoriaMetrics]({{< relref "../victoriametrics/_index.md" >}})

## 관련 문서의 역할

| 계층 | 무엇을 다루나 | 사실 원천 |
|------|--------------|-----------|
| **concepts (기본 개념)** | TSDB·아키텍처·수집·저장·쿼리의 원리 | 네이버 D2/DEVIEW 발표 정독 |
| **practice (잘 쓰는 방법)** | 카디널리티·초대규모 운영·무중단 전환 설계 원칙 | 위 개념의 실전 적용 |
| **VictoriaMetrics 사용기** | 우리 클러스터의 실제 구성·튜닝·기준치 | 우리 환경 실측·변경 이력 |

원리가 궁금하면 VictoriaMetrics의 기본 개념으로, 설계 패턴이 궁금하면 잘 쓰는 방법으로 이어집니다. 우리 환경의 실제 값과 변경 이력은 이 사용기에 모읍니다.

## 문서 지도

| 문서 | 주제 | 한 줄 요약 |
|------|------|-----------|
| [01 스택 구성]({{< relref "01-stack-overview.md" >}}) | 구조 | k8s + VM operator vmagent → 중앙 vminsert, stage/prod 값 차이 |
| [02 vmagent 전송 튜닝]({{< relref "02-vmagent-transport-tuning.md" >}}) | Phase 1 | `forceVMProto`(zstd 고정)·`maxDiskUsagePerURL`(디스크 큐 상한), 적용 순서 |
| [03 자기감시 메트릭]({{< relref "03-self-monitoring-metrics.md" >}}) | 관측 | 전송 재시도·드랍·바이트·pending 큐 4지표 + 카디널리티 인벤토리 |
| [04 스케일링·용량 기준치]({{< relref "04-scaling-thresholds.md" >}}) | 용량 | 디스크 큐 산정식, 리소스 기준치, HA 트레이드오프, slow insert 임계 |
| [05 vmagent AZ 분할]({{< relref "05-vmagent-az-split.md" >}}) | 통신·전송량 | AZ a/c 분산 수집으로 inter-AZ 트래픽을 약 10% 줄인 설계, 두 단계 전환과 검증, AZ를 넘어도 청구되지 않는 구간 |

## 읽는 순서

- 01에서 우리 스택 전체 그림과 stage/prod 값 차이를 잡습니다.
- 02에서 Phase 1의 zstd 고정·디스크 큐 상한 변경 근거를 봅니다.
- 03의 자기감시 메트릭 4개로 적용 효과와 이상을 판정합니다.
- 04에서 큐 상한 산정식과 리소스·HA 기준치를 정리합니다.
- 05에서 vmagent AZ 분할 설계와 두 단계 전환, 라벨 변경에 따른 자동 확장 문제, 검증 방법과 구간별 과금 여부를 봅니다.
