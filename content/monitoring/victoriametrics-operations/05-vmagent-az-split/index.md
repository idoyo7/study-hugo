---
title: "클러스터 간 전송과 AZ 분할"
description: "클러스터별 vmagent와 원격 저장소 구성, AZ별 수집 분할 방법, stage에서 확인한 AZ 간 전송량과 네트워크 비용 감소를 정리합니다."
date: 2026-09-27
lastmod: 2026-09-27
aliases: ["/monitoring/victoriametrics/ours/05-vmagent-az-split/"]
weight: 5
---

# 05 · 클러스터 간 메트릭 전송과 vmagent AZ 분할

## 수집·저장 구조

stage·prod 클러스터에는 각각 vmagent를 두어 해당 클러스터의 메트릭을 수집합니다. 수집한 샘플은 remote write로 원격 저장 클러스터에 보냅니다. 쓰기 경로는 **vmagent → 쓰기 LB → ingress → vminsert → vmstorage**입니다. 메트릭의 영속 데이터와 보관 용량은 원격 저장 클러스터에서 관리합니다.

{{< flow src="_flow/0-클러스터-간-메트릭-전송.json" />}}

vmagent가 타깃에 scrape 요청을 보내면 응답에 담긴 샘플이 vmagent로 돌아옵니다. vmagent는 이를 모아 압축한 뒤 원격 쓰기 엔드포인트로 전송합니다. vmagent의 디스크 큐는 전송 지연에 대비한 임시 버퍼이고, 조회에 쓰는 메트릭은 vmstorage에 보관합니다.

이 구조에는 세 통신 구간이 있습니다.

| 구간 | 위치 | 역할 |
|---|---|---|
| 타깃 → vmagent | 워크로드 클러스터 내부 | scrape 응답 수신 |
| vmagent → 쓰기 LB → ingress | 워크로드 클러스터 → 원격 저장 클러스터 | 수집한 샘플 전송 |
| ingress → vminsert → vmstorage | 원격 저장 클러스터 내부 | 샘플 분산·저장 |

클러스터가 달라도 같은 AZ에 있을 수 있고, 같은 클러스터 안에서도 AZ를 넘을 수 있습니다. 이번 변경은 **stage의 타깃과 vmagent를 같은 AZ에 배치해 첫 번째 구간의 AZ 간 전송을 줄이는 작업**입니다.

## 기존 구조의 문제

변경 전 stage의 vmagent는 `ap-northeast-2a`에서 한 대만 실행됐습니다. 이 agent가 2a·2c의 모든 타깃을 수집했기 때문에, 2c 타깃의 scrape 응답은 AZ 경계를 넘어 2a로 들어왔습니다.

이 구간의 실제 네트워크 전송량(wire)은 **2.89MB/s, 하루 약 250GB**였습니다. 이를 양쪽 전송 비용을 합친 $0.02/GB로 환산하면 월 약 $150입니다. 타깃과 agent의 배치 때문에 원격 저장소로 보내기 전부터 AZ 간 전송 비용이 발생하고 있었습니다.

## vmagent를 AZ별로 분리

stage의 VMAgent CR을 두 개로 나누고, 각 agent의 실행 AZ와 수집 대상 AZ를 맞췄습니다. 원격 저장 엔드포인트는 그대로 유지했습니다.

{{< flow src="_flow/3-asis-tobe-비교.json" />}}

| 항목 | CR-A | CR-B |
|---|---|---|
| 실행 AZ | 2a | 2c |
| 수집 규칙 | 2c 타깃 제외: `drop ap-northeast-2c` | 2c 타깃만 수집: `keep ap-northeast-2c` |
| zone을 판정할 수 없는 타깃 | `az_bucket=fallback`을 붙여 수집 | 제외 |
| VMStaticScrape·VMProbe·VMScrapeConfig | 전담 | 제외 |

타깃의 AZ는 Node 라벨에서 읽습니다. `promscrape.kubernetes.attachNodeMetadataAll: "true"`를 켜면 Pod·Endpoint를 발견할 때 Node 메타데이터도 붙으므로, `__meta_kubernetes_node_label_topology_kubernetes_io_zone`을 기준으로 수집 대상을 나눌 수 있습니다. agent는 `nodeAffinity`로 각 AZ에 고정합니다.

CR-A를 `keep 2a`로 제한하지 않은 이유는 신규 AZ나 zone 정보가 없는 타깃도 수집하기 위해서입니다. CR-B가 맡지 않는 타깃은 CR-A에 남깁니다. Node 메타데이터가 없거나 SD 구성이 다른 VMStaticScrape·VMProbe·VMScrapeConfig도 CR-A에서만 수집합니다.

아래는 적용 당시 CR-A 설정 중 Node 메타데이터 옵션과 Pod 수집 규칙입니다. Service·Node 수집에도 같은 분할 규칙을 적용했고, CR-B는 마지막 `drop`을 `keep`으로 바꿨습니다.

```yaml
extraArgs:
  promscrape.kubernetes.attachNodeMetadataAll: "true"
podScrapeRelabelTemplate:
  - action: replace
    sourceLabels: [__meta_kubernetes_node_label_topology_kubernetes_io_zone]
    regex: '(.+)'
    replacement: '$1'
    targetLabel: debug_zone
  - action: replace
    sourceLabels: [__meta_kubernetes_node_label_topology_kubernetes_io_zone]
    regex: '^$'
    replacement: fallback
    targetLabel: az_bucket
  - action: drop
    sourceLabels: [__meta_kubernetes_node_label_topology_kubernetes_io_zone]
    regex: 'ap-northeast-2c'
```

`debug_zone`은 수집 대상의 AZ를 검증하려고 붙인 라벨입니다. 분할 자체는 Node 메타라벨로 처리합니다.

## 적용 결과

### 전송량과 비용

| 지표 | 변경 전 | 변경 후 |
|---|---|---|
| scrape wire 합계 | 7.08~7.39MB/s | CR-A 4.51 + CR-B 2.89 = 7.40MB/s |
| scrape의 AZ 간 전송 | 2.89MB/s, 하루 약 250GB | 0 |
| remote write 합계 | 465~470KB/s | CR-A 341 + CR-B 133~137 = 474~478KB/s |
| vmagent → 쓰기 LB의 AZ 간 전송 | 0 | CR-B에서 하루 약 11.7GB |
| 두 구간의 네트워크 비용 순절감 | — | 월 약 $133~143 |

scrape의 AZ 간 전송은 측정 구간에서 0이 됐습니다. CR-B는 2c에서 2a의 쓰기 LB로 보내므로 remote write에 하루 약 11.7GB의 AZ 간 전송이 새로 생겼습니다. **수집부터 쓰기 LB까지의 AZ 간 전송량은 하루 약 250GB에서 11.7GB로, 약 95% 줄었습니다.**

scrape 총량과 remote write 총량은 전환 전후 비슷한 수준이었고, AZ를 넘는 전송량이 줄었습니다.

월 $133~143는 새로 생긴 remote write 비용을 차감하고, 측정 전송량을 $0.02/GB로 환산한 **네트워크 비용 추정치**입니다. 청구서로 확인한 절감액이나 vmagent 추가 실행 비용까지 반영한 총비용 절감액은 아닙니다.

### 수집 상태와 전환 중 문제

| 항목 | 전환 +8분 | 전환 +1시간44분 |
|---|---|---|
| 타깃 수 (CR-A / CR-B) | 487 / 241 | 485 / 231 |
| 수집 방향 (kubelet 제외) | CR-A 전부 2a, CR-B 전부 2c | 동일 |
| 두 agent 간 중복 타깃 | 0 | 0 |
| fallback 타깃 | 0 | 0 |
| down 타깃 | 0 | 0 |
| istiod 레플리카 | 16 | 8 |

전환 전 단일 agent의 타깃 수는 714개였습니다. 전환 후 합계는 두 측정 시점에서 각각 728개와 716개였고, 중복·fallback·down 타깃은 모두 0이었습니다. 이 값은 각 시점의 확인 결과입니다. 전환 +1시간13분에 CR-B 파드가 노드 교체로 이동할 때는 약 1분간 이중 수집이 있었습니다.

| 문제 | 관측 결과와 조치 |
|---|---|
| 라벨 추가에 따른 일시적 이중 합산 | `debug_zone` 추가로 기존 시리즈와 새 시리즈가 5분 lookback 동안 함께 집계됐습니다. KEDA가 istiod를 8→16으로 늘렸고, +28분에 8로 복귀했습니다. |
| 라벨 개수 상한 초과 | 일부 cadvisor 시리즈가 vminsert의 50개 라벨 상한을 넘어 `prometheus` 라벨을 잃었습니다. zone 정보가 이미 있는 nodeScrape에서는 `debug_zone` 추가 규칙을 제거해야 합니다. |
| agent 장애 시 수집 중단 | CR-B는 replica 1이고 CR-A가 대신 수집하는 경로가 없습니다. CR-B 장애 시 2c 수집이 중단되므로 별도 장애 알림이 필요합니다. |

### 남은 AZ 간 전송

원격 저장 클러스터의 쓰기 경로는 변경하지 않았습니다.

{{< flow src="_flow/6-쓰기-경로-횡단.json" />}}

| 구간 | 현재 배치와 AZ 간 전송 |
|---|---|
| CR-B → 쓰기 LB | 2c → 2a. 하루 약 11.7GB |
| 쓰기 LB → ingress | LB와 ingress 파드 4대가 모두 2a |
| ingress → vminsert | 2a·2b로 57:43 분산. 43%가 AZ 경계를 넘음 |
| vminsert → vmstorage | 세 AZ로 분산. 약 3분의 2가 AZ 경계를 넘음 |

앞서 계산한 약 95% 감소는 **타깃 → vmagent와 vmagent → 쓰기 LB 두 구간에 한정**됩니다. 저장 클러스터 내부의 AZ 간 전송은 그대로 남아 있습니다. 후속 최적화는 `DataTransfer-Regional-Bytes`와 VPC Flow Logs로 구간별 전송량·비용을 확인한 뒤 판단해야 합니다. 이 글의 적용 결과는 stage 측정값입니다.

> 관련 문서: [스택 구성]({{< relref "../01-stack-overview.md" >}}) · [vmagent 전송 튜닝]({{< relref "../02-vmagent-transport-tuning.md" >}}) · [자기감시 메트릭]({{< relref "../03-self-monitoring-metrics.md" >}})
