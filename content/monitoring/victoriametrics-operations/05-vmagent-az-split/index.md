---
title: "클러스터 간 전송과 AZ 분할"
description: "prod의 월 62.7~64.8TB AZ 간 scrape 전송 추정과 vmagent 분할 설계, 월 $1,254~1,296의 수집 구간 절감 여지 및 stage 검증 결과를 정리합니다."
date: 2026-09-27
lastmod: 2026-09-27
aliases: ["/monitoring/victoriametrics/ours/05-vmagent-az-split/"]
weight: 5
---

# 05 · prod 메트릭 전송 규모와 vmagent AZ 분할

## 수집·저장 구조

stage·prod 클러스터에는 각각 vmagent를 두어 해당 클러스터의 메트릭을 수집합니다. prod는 용도별로 두 계열의 vmagent를 운영합니다. 수집한 샘플은 remote write로 원격 저장 클러스터에 보냅니다. 쓰기 경로는 **vmagent → 쓰기 LB → ingress → vminsert → vmstorage**입니다. 메트릭의 영속 데이터와 보관 용량은 원격 저장 클러스터에서 관리합니다.

{{< flow src="_flow/0-클러스터-간-메트릭-전송.json" />}}

vmagent가 타깃에 scrape 요청을 보내면 응답에 담긴 샘플이 vmagent로 돌아옵니다. vmagent는 이를 모아 압축한 뒤 원격 쓰기 엔드포인트로 전송합니다. vmagent의 디스크 큐는 전송 지연에 대비한 임시 버퍼이고, 조회에 쓰는 메트릭은 vmstorage에 보관합니다.

이 구조에는 세 통신 구간이 있습니다.

| 구간 | 위치 | 역할 |
|---|---|---|
| 타깃 → vmagent | 워크로드 클러스터 내부 | scrape 응답 수신 |
| vmagent → 쓰기 LB → ingress | 워크로드 클러스터 → 원격 저장 클러스터 | 수집한 샘플 전송 |
| ingress → vminsert → vmstorage | 원격 저장 클러스터 내부 | 샘플 분산·저장 |

클러스터가 달라도 같은 AZ에 있을 수 있고, 같은 클러스터 안에서도 AZ를 넘을 수 있습니다. 최적화 대상은 **타깃과 vmagent 사이의 AZ 간 전송**입니다. prod의 전송 규모를 기준으로 효과를 산정하고, AZ 분할은 stage에 먼저 적용해 검증했습니다.

## prod에서 월 62.7~64.8TB가 AZ를 넘는 구조

분석 당시 prod의 워크로드 수집 vmagent는 2c에 한 대 있었고, 타깃 파드는 2a에 약 51%, 2c에 약 49%가 있었습니다. 2a 타깃의 scrape 응답이 2c의 agent로 넘어오면서 원격 저장소에 쓰기 전부터 AZ 간 전송 비용이 발생했습니다. 아래 수치는 이 agent를 기준으로 하며 다른 용도의 agent는 포함하지 않습니다.

2026-09-26~27에 수집한 자료에서 야간 1시간의 scrape 네트워크 전송량(wire)은 **28.64MB/s**였습니다. 이를 당시 샘플 수와 7일 평균 샘플 수의 비율로 보정하면 평균 부하에 해당하는 전송량은 **47.4~49.0MB/s**로 추정됩니다.

| prod 지표 | 규모 | 산정 기준 |
|---|---|---|
| 야간 scrape wire | 28.64MB/s | `vm_promscrape_conn_bytes_read_total`의 1시간 rate |
| 7일 평균 부하로 보정한 wire | 47.4~49.0MB/s | 야간 wire × 7일 평균 98.7k samples/s ÷ 야간 환산 57.7~59.6k samples/s |
| AZ 간 scrape 전송량 | 월 약 62.7~64.8TB | 보정 wire × 2a 타깃 비중 51% × 30일 |
| 해당 구간의 전송 비용 | 월 약 $1,254~1,296 | 62,700~64,800GB × $0.02/GB |

월 환산은 30일(2,592,000초), 단위는 1MB=1,000,000B·1TB=1,000GB, 비용은 양쪽 전송을 합친 $0.02/GB를 사용했습니다. **파드의 AZ별 비중이 바이트 비중과 같고, 샘플당 바이트가 유지된다는 가정**이 들어갑니다. 청구서 대조 전의 추정치입니다.

## vmagent를 AZ별로 분리

prod의 기존 2c agent는 2c 타깃을 맡기고, 2a에 agent를 추가해 2a 타깃을 수집하도록 나눕니다. 각 agent가 샘플을 모아 압축한 뒤 기존 원격 저장 엔드포인트로 보냅니다. 기존 두 계열은 용도에 따른 구분이므로, 이번 분할에서도 워크로드 수집 범위를 유지합니다.

같은 방식은 stage에 먼저 적용해 검증했습니다. stage는 기존 agent가 2a에 있어 prod와 방향이 반대입니다. 2c에 VMAgent CR을 추가하고 각 agent의 실행 AZ와 수집 대상 AZ를 맞췄습니다.

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

## prod 예상 효과와 stage 검증

### prod에서 기대하는 개선

prod에서도 타깃을 같은 AZ에서 수집하면 수집 구간의 AZ 간 전송을 거의 없앨 수 있습니다. 기존 전송량 추정에 따른 절감 여지는 다음과 같습니다.

| prod 워크로드 수집 agent | 변경 전 | 분할 후 예상 |
|---|---|---|
| AZ 간 scrape 전송량 | 월 62.7~64.8TB 추정 | 약 0 |
| 해당 scrape 구간의 비용 | 월 $1,254~1,296 추정 | 약 0 |
| agent당 피크 CPU | 약 3.8코어 | 약 1.9코어 |
| agent당 최대 RSS | 3.43GB | 약 1.8GB |
| CPU·메모리 요청 합계 | 7 CPU / 10Gi | 제안값 2 × (2 CPU / 3Gi) = 4 CPU / 6Gi |

CPU·RSS 예상은 부하가 두 agent에 비슷하게 나뉜다는 가정입니다. 요청량은 원자료의 제안값이며 prod 적용 후 측정값은 아닙니다. 총 수집량을 유지하면서 AZ 간 통신과 agent 한 대에 몰리는 부하를 줄이는 설계입니다.

**월 $1,254~1,296는 scrape 구간에서 줄일 수 있는 비용**입니다. remote write 경로의 AZ 간 전송 변화와 agent 실행 비용을 반영한 순절감액은 prod 적용 후 따로 산정해야 합니다. 원자료에서 야간~평균 부하와 AZ 비중 45~55%를 조합한 비용 범위는 월 $668~1,397였습니다.

### stage에서 확인한 전송량

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

### stage 전환에서 확인한 문제

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

### 원격 저장 경로의 남은 AZ 간 전송

AZ 분할 후에도 원격 저장 클러스터의 쓰기 경로에는 AZ 간 전송이 남습니다. stage 검증에서 확인한 배치는 다음과 같습니다.

{{< flow src="_flow/6-쓰기-경로-횡단.json" />}}

| 구간 | 현재 배치와 AZ 간 전송 |
|---|---|
| CR-B → 쓰기 LB | 2c → 2a. 하루 약 11.7GB |
| 쓰기 LB → ingress | LB와 ingress 파드 4대가 모두 2a |
| ingress → vminsert | 2a·2b로 57:43 분산. 43%가 AZ 경계를 넘음 |
| vminsert → vmstorage | 세 AZ로 분산. 약 3분의 2가 AZ 경계를 넘음 |

stage의 약 95% 감소는 **타깃 → vmagent와 vmagent → 쓰기 LB 두 구간에 한정**됩니다. prod 적용 후에는 이 두 구간의 감소량을 다시 측정하고, `DataTransfer-Regional-Bytes`와 VPC Flow Logs로 비용을 대조해야 합니다. 저장 클러스터 내부 전송은 별도 최적화 대상입니다.

> 관련 문서: [스택 구성]({{< relref "../01-stack-overview.md" >}}) · [vmagent 전송 튜닝]({{< relref "../02-vmagent-transport-tuning.md" >}}) · [자기감시 메트릭]({{< relref "../03-self-monitoring-metrics.md" >}})
