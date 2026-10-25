---
title: "Prometheus와 VictoriaMetrics의 확장 방식과 운영 비용 비교"
linkTitle: "Prometheus vs VictoriaMetrics"
description: "Prometheus와 VictoriaMetrics를 수집·저장·조회 구조, 공개 벤치마크, 복제와 샤딩, 규칙 평가 방식으로 비교합니다. 수치의 측정 조건과 전환 시 확인할 차이를 함께 설명합니다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 5
url: "/monitoring/prometheus-vs-victoriametrics/"
---

# Prometheus와 VictoriaMetrics의 확장 방식과 운영 비용 비교

메트릭 규모가 커질 때는 수집량, 보관 용량, 조회 부하 중 무엇이 늘어나는지부터 확인해야 합니다. Prometheus는 수집·저장·평가를 한 서버에서 처리하고, VictoriaMetrics(VM) 클러스터는 이 역할을 나눠 증설합니다. 같은 데이터를 받아도 구성 요소와 복제 방식에 따라 전체 비용이 달라집니다.

대규모 중앙 저장소를 새로 구성하고 역할별 확장을 우선한다면 VM 클러스터부터 검토할 수 있습니다. 기존 Prometheus의 데이터 모델과 규칙 계산을 유지해야 하거나 현장에서 계속 조회·평가해야 한다면 그 요구도 함께 비교해야 합니다. 여기서는 Prometheus 서버와 VM 클러스터의 차이를 설명하고, Prometheus에 Thanos 등을 추가했을 때 늘어나는 구성을 구분합니다.

## 수집·저장·조회가 함께 확장되는가, 따로 확장되는가 {#역할을-나누면-필요한-곳을-늘릴-수-있다}

Prometheus의 한 프로세스는 타깃 발견과 scrape, 로컬 TSDB 저장, PromQL 조회, recording·alerting rule 평가를 수행합니다. 수집한 데이터로 곧바로 조회와 규칙 평가를 할 수 있습니다. 경보 전달과 그룹화는 별도 Alertmanager가 담당합니다. [Prometheus 구조](https://prometheus.io/docs/introduction/overview/#architecture)

VM 클러스터는 보통 vmagent가 수집하고 vminsert가 쓰기를 분배합니다. vmstorage가 데이터를 저장하며 vmselect는 조회, vmalert는 규칙 평가를 맡습니다. 조회 요청에는 vmselect를, 보관량이나 수집 처리량에는 vmstorage를 늘리는 식으로 대응합니다. 조회 중에도 vmstorage를 읽으므로 역할을 나눈 것만으로 자원 경합이 없어지지는 않습니다. [VM 클러스터 구조와 확장](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#architecture-overview)

Prometheus는 구성 요소 간 통신과 관리 대상을 줄일 수 있습니다. VM은 구성 요소가 늘어나는 대신 역할별로 용량과 장애 대응을 설계할 수 있습니다. 수집량·보관량·조회 부하가 서로 다른 속도로 증가할수록 따로 증설할 수 있는 구성이 유용해집니다.

## 공개 벤치마크의 저장량과 메모리 차이 {#디스크와-메모리-공개-수치는-얼마나-차이-나는가}

공개 수치에는 용량 산정용 평균, 벤더가 주장하는 최대 절감 배수, 특정 조건에서 측정한 결과가 섞여 있습니다. 아래 배수는 원본 데이터의 압축률이 아니라 두 제품의 디스크·메모리 사용량을 비교한 값입니다.

| 공개 자료 | 제시하는 수치 | 읽는 기준 |
|---|---|---|
| Prometheus 저장소 문서 | 평균 **1–2 bytes/sample** | 용량을 대략 산정하는 값. 최솟값이나 최대 압축률 보장은 아님 |
| VM 용량 산정 가이드 | 압축된 샘플 데이터 평균 **약 1 byte/sample 이하 또는 그 수준** | 인덱스는 별도. 시계열 교체가 잦으면 효율이 낮아짐. 복제·병합 여유 공간도 필요 |
| VM 제품 소개 | Prometheus·Thanos·Cortex 대비 RAM·저장공간 **최대 약 1/7** | 벤더의 최대 절감 주장. RAM은 수백만 고유 시계열 조건을 명시 |

문서별 평균값을 나눠 특정 환경의 절감 배수를 구할 수는 없습니다. 반복되는 값과 계속 바뀌는 값의 압축 효율이 다르고, 수명이 짧은 시계열이 많으면 인덱스의 비중도 커집니다. 아래 자료가 제시한 산정 범위를 함께 봐야 합니다. [Prometheus Storage](https://prometheus.io/docs/prometheus/latest/storage/), [VM 용량 산정](https://docs.victoriametrics.com/guides/understand-your-setup-size/), [VM 제품 소개](https://docs.victoriametrics.com/victoriametrics/#prominent-features)

VM이 2024년 2월 공개한 시험은 두 제품의 단일 노드를 각각 3 vCPU·12 GiB로 실행했습니다. 같은 1,000개 node_exporter 타깃을 15초마다 수집했으며, 타깃당 약 1,200개 시계열로 초당 약 8만 샘플이 유입됐습니다. 약 초당 1회 읽고 10분마다 타깃의 5%를 교체하며 7일간 측정한 결과입니다. [시험 구성과 결과](https://victoriametrics.com/blog/reducing-costs-p1/)

| 측정 항목 | Prometheus | VM single-node | 이 시험에서의 차이 |
|---|---:|---:|---|
| 디스크 사용량 | 83.5 GiB | 33 GiB | VM이 약 **60% 적음** |
| 최대 메모리 사용량 | 8.12 GiB | 4.5 GiB | VM이 약 **45% 적음** |
| 평균 CPU 사용량 | 0.79 core | 0.76 core | 비슷함 |
| 읽기 지연 p50 | 70.5 ms | 4.3 ms | VM이 약 16.4배 빠름 |
| 읽기 지연 p99 | 7 s | 3.6 s | VM이 약 1.9배 빠름 |

이 시험에서 디스크 사용량은 약 2.53배, 최대 메모리는 약 1.80배 차이가 났습니다. 수집과 조회를 함께 수행하는 조건에서 VM의 저장·메모리 비용이 낮게 나온 사례입니다. 다만 제품 버전과 메모리 지표의 정의는 명시되지 않았습니다. 벤더가 수행한 2024년 단일 노드 시험이므로 최신 Prometheus 3.x와 VM 클러스터의 비교 결과로 확대할 수 없습니다.

같은 회사가 2024년 3월 공개한 수집기 비교에는 Prometheus 2.50.1과 VM 1.99.0을 remote-write 수신 저장소로 사용한 부가 시험도 있습니다. 5,000개 모의 호스트를 대상으로 12시간 동안 저장소마다 30 core·90 GB를 허용했습니다. CPU 사용량은 20.2 대 2.87 core, RSS는 69.0 대 16.8 GB였습니다. 읽기 쿼리가 없는 시험이므로 앞의 수집·조회 결과와 차이를 해석할 때 이 조건을 고려해야 합니다. 두 시험 모두 최대 수집 처리량을 구한 결과는 아닙니다. [2024년 3월 수집기 비교](https://victoriametrics.com/blog/comparing-agents-for-scraping/#a-bonus-round-using-prometheus-and-victoriametrics-stacks)

## 압축률 외에 메모리를 늘리는 시계열과 쿼리 비용 {#압축이-잘되는데도-prometheus-메모리가-커지는-이유}

디스크의 bytes/sample만으로 메모리 사용량을 설명할 수는 없습니다. Prometheus의 Head는 시계열 상태·레이블·인덱스와 현재 청크를 관리하고, 조회에는 중간 결과를 보관할 공간도 필요합니다. 완료된 Head 청크는 파일에 두고 mmap으로 읽으므로 최근 두 시간의 데이터를 모두 원시 형태로 Go heap에 쌓는 구성은 아닙니다. 활성 시계열 수, 레이블 크기, 시계열 생성·소멸 속도, 동시 쿼리가 메모리 사용량에 영향을 줍니다. [Prometheus Head 구현](https://github.com/prometheus/prometheus/blob/v3.15.0/tsdb/head.go)

100만 시계열을 10초마다 수집하는 경우와 1,000만 시계열을 100초마다 수집하는 경우는 모두 초당 10만 샘플입니다. 그러나 관리할 시계열 수는 다릅니다. `pod`, `path`, 사용자 ID 조합이 계속 늘면 디스크 압축률을 개선해도 시계열 관리 비용이 남습니다. Head 메모리를 줄이려면 장기 보관 기간보다 활성 시계열과 불필요한 레이블을 먼저 살펴야 합니다.

Remote write는 시계열 ID와 레이블의 대응 캐시, 전송 큐를 추가로 사용합니다. Prometheus 문서는 메모리가 약 25% 늘었다고 보고하는 사용자가 많다고 설명하지만, 데이터 형태에 따라 달라지는 관측치이므로 고정 가산율로 사용할 수는 없습니다. Prometheus를 현장 수집기로 유지하면서 중앙 VM을 추가한다면 로컬 수집·저장·전송 비용까지 합산해야 합니다. [Remote write 자원 사용량](https://prometheus.io/docs/practices/remote_write/#resource-usage)

Prometheus 3.5부터 제공한 Linux의 `use-uncached-io`는 병합 청크를 쓸 때 페이지 캐시를 우회합니다. 2026년 공식 글에 소개된 시험에서는 `container_memory_cache`가 20–50% 줄었습니다. 이 수치는 해당 캐시 지표의 변화이며 전체 RSS나 Go heap의 감소율은 아닙니다. [Uncached I/O in Prometheus](https://prometheus.io/blog/2026/03/05/uncached-io/)

전체 운영 비용에는 Prometheus의 모든 샤드·복제본과 추가 조회 계층을 포함해야 합니다. VM도 vmagent·vminsert·vmstorage·vmselect·vmalert와 복제본을 합산합니다. RSS, Go heap, 컨테이너 working set, 파일 캐시는 같은 지표끼리 비교하고 쿼리·병합·재시작 때의 최대 사용량도 확인합니다. VM의 `memory.allowedPercent`는 내부 캐시 등에 할당하는 예산이므로 프로세스 전체 메모리 상한으로 해석하면 안 됩니다. [VM 메모리 설정](https://docs.victoriametrics.com/victoriametrics/#resource-usage-limits)

VM은 들어온 데이터를 작은 메모리 part에서 디스크 part로 내린 뒤 병합합니다. 시계열을 찾는 IndexDB와 샘플 데이터도 나눠 관리합니다. Prometheus와 다른 저장·캐시 방식이 자원 사용 패턴을 바꾸지만, VM에서도 고카디널리티와 잦은 시계열 교체는 인덱스·캐시 비용을 늘립니다. 제품 전환의 효과와 불필요한 시계열을 줄이는 작업을 함께 평가해야 합니다. [VM 저장 구조](https://docs.victoriametrics.com/victoriametrics/#storage), [시계열 교체의 영향](https://docs.victoriametrics.com/guides/understand-your-setup-size/#churn-rate)

## 인스턴스 장애와 중앙 연결 단절에 대비하는 방법 {#pod-장애에는-자립성보다-복제-구성이-중요하다}

Prometheus Pod 하나가 중단되면 그 인스턴스의 수집·조회·규칙 평가도 멈춥니다. PVC가 남으면 재시작 후 저장된 데이터와 WAL로 복구할 수 있습니다. 로컬 디스크까지 영구 유실됐다면 다른 서버의 데이터를 가져와 복구하는 기능은 Prometheus 자체에 없습니다. [Prometheus 로컬 저장소의 한계](https://prometheus.io/docs/prometheus/latest/storage/#on-disk-layout)

VM 클러스터에서도 데이터 사본을 만들려면 복제를 설정해야 합니다. `replicationFactor=2`로 서로 다른 vmstorage에 저장했다면 한쪽이 사라져도 다른 쪽에서 읽을 수 있습니다. 장애 중 새 데이터도 같은 사본 수로 저장하려면 노드 수와 여유 용량을 확보해야 합니다. 이 조건을 갖춘 VM 클러스터는 단일 Prometheus보다 Pod·저장 장치 한 개의 장애에 대응하기 유리합니다. [VM 복제와 데이터 안전성](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#replication-and-data-safety)

Prometheus HA는 둘 이상의 서버가 같은 타깃을 수집하고 같은 규칙을 평가하도록 구성합니다. 한쪽이 멈춰도 다른 서버가 감시를 이어 가지만 수집·메모리·로컬 저장·규칙 평가 비용이 중복됩니다. 수집 시각도 서로 달라 조회 값이 조금씩 다를 수 있습니다. [Prometheus Operator의 HA 설명](https://prometheus-operator.dev/docs/platform/high-availability/#prometheus)

Prometheus에는 여러 TSDB를 하나로 관리하는 클러스터 모드가 없습니다. 복제 로그의 합의, 복제본 간 누락 데이터 복구, 여러 노드로의 PromQL 실행 분산을 내장하지 않습니다. 공식 문서가 로컬 저장소를 클러스터화·복제하지 않는다고 설명하는 이유입니다. HA와 샤딩은 독립된 Prometheus 서버를 조합해 구성합니다. [Prometheus의 범위](https://prometheus.io/docs/prometheus/latest/storage/#remote-storage-integrations), [공식 HA 권장](https://prometheus.io/docs/introduction/faq/#can-prometheus-be-made-highly-available)

HA, 샤딩, Federation, remote write/read, Alertmanager HA는 담당하는 데이터와 기능이 다릅니다.

| 기능 | 제공하는 것 | 제공하지 않는 것 |
|---|---|---|
| 같은 설정의 Prometheus HA 쌍 | 한쪽이 멈춰도 다른 쪽이 수집·평가 | 두 TSDB의 복제·동기화 |
| 타깃 샤딩 | 인스턴스별 수집 부하 분담 | 과거 데이터 재배치·전역 쿼리 |
| Federation | 하위 서버의 선택한 현재 값·집계 지표를 상위에서 재수집 | 원본 전체 이력에 대한 분산 쿼리 |
| Remote write / read | 외부 저장소로 전송 / 원시 시계열 읽기 | Prometheus끼리의 저장 클러스터 구성 |
| Alertmanager HA | 알림 중복 억제와 silence·notification log 공유 | 메트릭 데이터 복제 |

Federation은 하위 서버의 요약 지표를 상위 서버가 다시 수집·저장해 전체를 조회하는 데 사용할 수 있습니다. Remote read로 읽은 원시 시계열의 PromQL 계산은 Prometheus에서 수행합니다. Alertmanager의 gossip 클러스터는 메트릭 대신 알림 상태를 공유합니다. 각각의 기능을 TSDB 복제나 분산 조회와 구분해서 설계해야 합니다. [Federation](https://prometheus.io/docs/prometheus/latest/federation/), [Remote storage](https://prometheus.io/docs/prometheus/latest/storage/#remote-storage-integrations), [Alertmanager HA](https://prometheus.io/docs/alerting/latest/high_availability/)

VM에서도 저장·전송·중복 제거에 비용이 들며 vmagent까지 이중화하면 scrape가 중복됩니다. VM의 장점은 이 비용을 없애는 데 있지 않습니다. 수집·저장·조회 계층별로 이중화와 증설 범위를 선택할 수 있다는 점을 전체 비용과 비교해야 합니다.

중앙 저장소와의 연결 단절은 로컬 장치 장애와 다른 상황입니다. 서비스 클러스터에 Prometheus가 있으면 중앙과 통신하지 못해도 로컬 데이터로 조회·규칙 평가를 계속할 수 있습니다. 현장에 VM 저장소와 vmalert를 함께 배치해도 같은 목적을 달성할 수 있습니다. 이 경우에는 제품별 내구성보다 저장소와 평가기의 위치가 중요합니다.

## 샤딩한 데이터의 전역 조회와 복제 구성 {#샤딩을-하면-수집-이후의-일도-나눠야-한다}

Prometheus Operator의 기본 샤딩은 타깃 주소에 결정적 해시를 적용합니다. ServiceMonitor·PodMonitor는 기본적으로 `__address__`를 사용하므로 입력과 샤드 수가 같으면 배정도 같습니다. 저장된 시계열을 분산 DB처럼 재배치하는 방식은 아닙니다. `shards: 2`, `replicas: 2`에서는 Pod 네 개가 실행되고 각 샤드의 HA 쌍이 같은 데이터를 수집합니다. 타깃별 시계열 수가 다르면 타깃 수를 비슷하게 나눠도 부하는 고르지 않을 수 있습니다. [샤딩 방식](https://prometheus-operator.dev/docs/platform/sharding/#design)

샤딩 후에는 서비스 전체 오류율을 구할 데이터가 여러 서버에 흩어질 수 있습니다. 이를 통합 조회하고 규칙에 사용하려면 Thanos Query·Ruler나 중앙 remote-write 저장소를 추가합니다. 아래 예에서는 각 Prometheus의 sidecar를 Thanos Query에 연결합니다. 화살표는 수집 데이터와 조회 결과가 전달되는 방향입니다.

{{< flow src="_flow/1-prometheus-ha-sharding.json" />}}

샤드 수를 바꿔도 기존 데이터가 새 배정에 맞춰 이동하지는 않습니다. 샤드를 늘려 줄이는 것은 한 서버가 감당할 수집 부하입니다. 총 샘플 수는 그대로이고 복제본을 추가하면 수집·저장 비용이 늘어납니다. Operator는 배포를 자동화하지만 이러한 저장 특성까지 바꾸지는 않습니다. [샤딩의 제약](https://prometheus-operator.dev/docs/platform/sharding/#design)

VM은 여러 vmstorage의 데이터를 vmselect가 통합 조회하는 경로를 기본으로 제공합니다. 다만 저장 노드를 늘려도 과거 데이터가 자동으로 균등 재배치되지는 않습니다. 전역 조회와 기존 데이터의 재배치는 구분해서 확인해야 합니다. [VM 재배치](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#rebalancing)

{{< flow caption="vminsert는 같은 샘플을 두 vmstorage에 기록하고 vmselect가 조회 결과를 모읍니다. RF=2 최소 예시이며, 장애 중에도 새 데이터의 두 사본을 유지하려면 저장 노드가 더 필요합니다." >}}
{
  "font": 1.2,
  "nodes": [
    { "id": "targets", "col": 0, "row": 1, "label": "Targets", "sub": "수집 대상", "kind": "src" },
    { "id": "vmagent", "col": 1, "row": 0, "label": "vmagent", "sub": "scrape·buffer", "kind": "proc" },
    { "id": "vminsert", "col": 1, "row": 2, "label": "vminsert", "sub": "RF=2 직접 기록", "kind": "proc" },
    { "id": "storage-a", "col": 2, "row": 0, "label": "vmstorage A", "sub": "샘플 사본 1", "kind": "store" },
    { "id": "storage-b", "col": 2, "row": 2, "label": "vmstorage B", "sub": "샘플 사본 2", "kind": "store" },
    { "id": "vmselect", "col": 3, "row": 0, "label": "vmselect", "sub": "분산 조회", "kind": "query" },
    { "id": "vmalert", "col": 3, "row": 2, "label": "vmalert", "sub": "규칙 평가", "kind": "sink" }
  ],
  "edges": [
    { "from": "targets", "to": "vmagent", "label": "scrape" },
    { "from": "vmagent", "to": "vminsert", "label": "remote write" },
    { "from": "vminsert", "to": "storage-a", "label": "RF2 기록" },
    { "from": "vminsert", "to": "storage-b" },
    { "from": "storage-a", "to": "vmselect", "label": "조회 결과" },
    { "from": "storage-b", "to": "vmselect" },
    { "from": "vmselect", "to": "vmalert", "label": "조회 결과" }
  ]
}
{{< /flow >}}

위 VM 도식은 `replicationFactor=2`로 샘플을 두 저장 노드에 기록하는 최소 예입니다. vminsert가 각 사본을 분배하며 저장 노드끼리 복제하지 않습니다. 장애 중에도 새 데이터의 사본 두 개를 유지하려면 vmstorage가 최소 세 개 필요하고 여유 용량도 있어야 합니다. 수집·쓰기·조회 계층의 이중화는 별도로 구성합니다. vmalert는 vmselect로 조회하고 recording rule 결과를 vminsert로 전송합니다. [복제 조건](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#replication-and-data-safety)

vminsert의 `-replicationFactor=2`는 쓰기 사본 수를 지정합니다. vmselect의 같은 옵션은 장애 중 응답의 완전성을 판단할 복제 정보를 전달합니다. 저장 복제본의 동일 타임스탬프 샘플은 vmselect의 `-dedup.minScrapeInterval=1ms`로 중복 제거할 수 있습니다. HA 수집기의 중복 scrape까지 처리하려면 실제 수집 간격에 맞춰 더 큰 dedup 간격을 검토해야 합니다.

규모가 커진 Prometheus 구성에는 여러 서버 외에 전역 조회와 규칙 평가 계층이 추가됩니다. 이 단계에서는 단일 바이너리의 운영 편의만 비교하기보다, 추가한 구성 전체와 VM 클러스터의 관리 비용을 대조해야 합니다.

## 데이터 정밀도와 native histogram의 저장 차이 {#저장은-압축률과-데이터-표현을-함께-본다}

Prometheus는 시간 범위별 TSDB 블록에 인덱스·청크·메타데이터를 저장합니다. 문서화된 구조는 백업이나 장애 구간을 파악하는 데 도움이 됩니다. 저장 비용을 비교할 때는 같은 데이터·보관 기간·복제 조건에서 인덱스, WAL·버퍼와 병합 여유 공간까지 계산해야 합니다. 압축 효율은 활성 시계열 수와 교체 속도, 샘플 값에 따라 달라집니다. [Prometheus 저장 구조](https://prometheus.io/docs/prometheus/latest/storage/)

기본 XOR 인코딩의 Prometheus는 입력된 float64 비트를 보존합니다. VM 문서는 유효 숫자 12자리를 넘는 값의 낮은 자릿수에서 정밀도가 줄 수 있다고 설명합니다. 일반적인 인프라 지표에서는 이 차이가 선택을 좌우하는 경우가 제한적이지만, 압축 효율을 비교할 때 데이터 표현의 차이도 확인해야 합니다. [Prometheus XOR 구현](https://github.com/prometheus/prometheus/blob/v3.15.0/tsdb/chunkenc/xor.go), [VM 값의 정밀도](https://docs.victoriametrics.com/victoriametrics/keyconcepts/#raw-samples)

Prometheus 3.15에서는 선택 가능한 XOR2 float 청크 인코딩이 안정화됐습니다. 기본값은 XOR로 유지됩니다. XOR2를 쓰려면 TSDB 블록을 직접 읽는 외부 도구가 지원하는지 확인해야 합니다. 이 변경만으로 VM보다 압축 효율이 높다고 판단할 근거는 없습니다. [Prometheus 3.15 변경 내역](https://github.com/prometheus/prometheus/blob/v3.15.0/CHANGELOG.md)

Native histogram에서는 저장 모델의 차이가 더 직접적으로 드러납니다. Prometheus는 버킷·합계·개수를 하나의 복합 샘플로 저장하고 PromQL에서도 histogram으로 다룹니다. 3.8부터 안정화됐지만 수집하려면 `scrape_native_histograms: true`가 필요합니다. 조사 기준일의 VM 문서는 수신한 histogram을 `vmrange` 레이블이 있는 `_bucket`, `_sum`, `_count` 시계열로 변환한다고 설명합니다. 이를 사용하는 계측·규칙이 있다면 수신 지원뿐 아니라 변환 후 시계열 수와 쿼리 차이를 확인해야 합니다. [Native histogram 명세](https://prometheus.io/docs/specs/native_histograms/), [VM의 변환 방식](https://docs.victoriametrics.com/victoriametrics/integrations/prometheus/index.html#native-histograms)

## 쿼리 성능과 규칙 평가 결과의 차이 {#쿼리는-계산-속도와-평가-시점을-구분한다}

Prometheus는 로컬 데이터를 읽어 저장 노드 간 RPC가 필요 없습니다. VM은 저장 노드의 작업을 병렬화하고 조회 계층을 따로 늘릴 수 있습니다. 성능은 조회 기간, 선택 시계열, 연산, 캐시와 동시 요청에 따라 달라지므로 단일 서버라는 이유만으로 속도 우위를 정할 수는 없습니다.

규칙이 다른 규칙의 결과를 사용할 때는 저장 시점도 영향을 줍니다. Prometheus의 기본 순차 평가에서는 같은 rule group의 앞 recording rule이 저장한 결과를 뒤 규칙이 같은 평가 시각에 읽을 수 있습니다. vmalert도 순서대로 평가하지만 결과는 비동기 remote write로 저장하므로 다음 규칙이 방금 계산한 값을 읽지 못할 수 있습니다. [Prometheus 규칙 평가](https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/), [vmalert의 제약](https://docs.victoriametrics.com/victoriametrics/vmalert/#limitations)

이 지연은 평가 주기 하나로 고정되지 않습니다. 전송·저장이 늦으면 이전 결과를 읽거나 값이 없을 수 있습니다. VM의 기본 30초 `latencyOffset`은 최근 데이터가 덜 들어온 상태에서 조회하는 문제를 줄이기 위한 설정이며 쿼리 실행시간과 구분해야 합니다. 규칙에서 이 지연을 고려할 수 있다면 Prometheus만을 선택해야 할 근거는 약해집니다. 원본을 `sum(rate(...))`로 한 번에 집계하는 경우에도 Prometheus가 모든 타깃을 같은 순간에 수집하는 것은 아닙니다. [VM 쿼리의 최근 데이터 처리](https://docs.victoriametrics.com/victoriametrics/keyconcepts/#query-latency)

MetricsQL은 PromQL과 폭넓게 호환되지만 `rate()`·`increase()` 등의 계산에는 의도적인 차이가 있습니다. 검증해 둔 SLO와 경보 규칙이 많다면 설정 파일을 옮기는 작업에 더해 동일한 원본으로 계산 결과를 비교해야 합니다. 기존 환경에서는 전환 비용이 되지만, 신규 환경에서 VM을 제외할 근거로 바로 이어지지는 않습니다. [MetricsQL과 PromQL의 차이](https://docs.victoriametrics.com/victoriametrics/metricsql/)

## 요구사항에 맞춰 남길 기능과 구성을 정하기 {#무엇을-고를-것인가}

구조와 기능 차이를 기준으로 요구별 검토 대상을 묶었습니다. 같은 환경에서 실측해 순위를 정한 표는 아닙니다.

| 우선하는 요구 | 먼저 검토할 구성 | 판단 근거 |
|---|---|---|
| 대규모 중앙 저장, 전역 조회, 역할별 독립 증설 | vmagent + VM 클러스터 + vmalert | 데이터 분산과 전역 조회 경로가 기본 구성에 포함됨 |
| 기존 PromQL·native histogram 규칙 유지, 담당 범위가 서버 용량 안에 들어옴 | Prometheus, 필요하면 HA 쌍 | 계산 방식과 수집·저장·평가 흐름을 유지하기 쉬움 |
| 중앙 연결이 끊겨도 현장 경보 평가 필요 | 현장 Prometheus 또는 현장 VM 저장소 + vmalert | 제품 이름보다 데이터와 평가기가 어디에 있는지가 중요함 |
| 현장에서는 Prometheus를 유지하고 중앙에서 장기·전역 조회 | Prometheus + remote write + VM 클러스터 | 두 요구를 함께 충족하지만 로컬·중앙 저장과 전송 비용이 더해짐 |

현장에 수집 기능만 필요하면 Prometheus 형식의 scrape 설정·서비스 디스커버리·relabeling을 지원하는 vmagent를 사용할 수 있습니다. 로컬 조회와 규칙 평가가 필요해 Prometheus를 유지한다면, 이 기능이 없는 Prometheus Agent 모드와 구분해서 배치해야 합니다. [vmagent](https://docs.victoriametrics.com/victoriametrics/vmagent/), [Prometheus Agent 모드](https://prometheus.io/docs/prometheus/latest/prometheus_agent/)

대규모 중앙 플랫폼을 새로 만든다면 이 글에서는 VM 클러스터를 우선 검토 대상으로 봅니다. Prometheus도 함께 둘 경우에는 로컬 조회·규칙 평가·데이터 모델 중 어떤 요구를 담당하는지 정해야 합니다. 담당할 기능이 없다면 수집과 저장을 중복 운영하는 비용만 늘 수 있습니다. 기존 환경에서는 대표 쿼리와 경보를 같은 데이터로 대조하고 저장량·메모리·지연·장애 중 동작을 측정해 전환 여부를 결정할 수 있습니다.

기능 설명의 기준은 2026-10-21에 확인한 공식 문서와 Prometheus 3.15 변경 내역입니다. 보관 기간을 늘리는 구성은 [장기 보관 비교]({{< relref "/observability/metrics/longterm-retention/_index.md" >}}), Thanos 구성은 [Prometheus·Thanos 연동]({{< relref "/observability/metrics/prometheus-thanos/_index.md" >}})에서 이어집니다.

여러 Kubernetes 클러스터·리전을 연결할 때의 중앙 수집, 지역별 독립 운영, 객체 스토리지 활용은 [멀티클러스터 구성]({{< relref "/observability/metrics/prometheus-vs-victoriametrics-multi-cluster/index.md" >}})에서 설명합니다.

## 참고 자료

본문의 기능 설명은 공식 문서·소스 코드에, 성능 수치는 벤더가 공개한 시험에 근거합니다. 측정 환경과 공개 시점은 각 비교에 함께 적었습니다. 이 글에서 두 제품을 새로 실측하지는 않았습니다.

- **압축·용량 기준과 최대 절감 주장**: [VM 용량 산정 가이드](https://docs.victoriametrics.com/guides/understand-your-setup-size/), [VM 제품 소개](https://docs.victoriametrics.com/victoriametrics/#prominent-features) — bytes/sample과 최대 절감 배수의 적용 조건.
- **동일 워크로드의 자원 비교**: [2024-02 단일 노드 수집·읽기 시험](https://victoriametrics.com/blog/reducing-costs-p1/), [2024-03 Agent 및 수신 저장소 시험](https://victoriametrics.com/blog/comparing-agents-for-scraping/) — CPU·메모리·디스크·쿼리 수치의 원문.
- **메모리 비용과 최근 개선**: [Prometheus Head 구현](https://github.com/prometheus/prometheus/blob/v3.15.0/tsdb/head.go), [Remote write tuning](https://prometheus.io/docs/practices/remote_write/), [Uncached I/O](https://prometheus.io/blog/2026/03/05/uncached-io/), [VM 자원 제한](https://docs.victoriametrics.com/victoriametrics/#resource-usage-limits) — 시계열 관리·전송 큐·페이지 캐시와 메모리 제한의 범위.
- **클러스터링과 구분할 기능**: [Prometheus FAQ](https://prometheus.io/docs/introduction/faq/#can-prometheus-be-made-highly-available), [Federation](https://prometheus.io/docs/prometheus/latest/federation/), [Alertmanager HA](https://prometheus.io/docs/alerting/latest/high_availability/) — 서버 이중화·계층 집계·알림 상태 공유.
- **Prometheus 구조와 저장소**: [Architecture](https://prometheus.io/docs/introduction/overview/#architecture), [Storage](https://prometheus.io/docs/prometheus/latest/storage/) — 단일 서버의 역할, TSDB 블록 구조와 로컬 저장소의 한계.
- **Prometheus HA와 샤딩**: [Operator High Availability](https://prometheus-operator.dev/docs/platform/high-availability/#prometheus), [Sharding](https://prometheus-operator.dev/docs/platform/sharding/#design) — 복제본의 중복 수집, 타깃 분할과 과거 데이터 처리.
- **Prometheus 규칙 평가와 수집 전용 모드**: [Recording Rules](https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/), [Prometheus Agent](https://prometheus.io/docs/prometheus/latest/prometheus_agent/) — 같은 그룹의 규칙 평가 순서와 Agent 모드의 기능 범위.
- **Prometheus 데이터 표현과 최근 변경**: [Native Histograms](https://prometheus.io/docs/specs/native_histograms/), [3.15 변경 내역](https://github.com/prometheus/prometheus/blob/v3.15.0/CHANGELOG.md), [XOR 구현](https://github.com/prometheus/prometheus/blob/v3.15.0/tsdb/chunkenc/xor.go) — histogram 지원, XOR2와 float64 인코딩.
- **VictoriaMetrics 클러스터 운영**: [Architecture](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#architecture-overview), [Replication and Data Safety](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#replication-and-data-safety), [Rebalancing](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#rebalancing) — 역할별 확장, 복제 조건과 기존 데이터의 재배치.
- **VictoriaMetrics 값과 조회 시점**: [Raw Samples](https://docs.victoriametrics.com/victoriametrics/keyconcepts/#raw-samples), [Query Latency](https://docs.victoriametrics.com/victoriametrics/keyconcepts/#query-latency) — 값의 정밀도와 최근 데이터의 가시성.
- **VictoriaMetrics 규칙과 쿼리 의미**: [vmalert Limitations](https://docs.victoriametrics.com/victoriametrics/vmalert/#limitations), [MetricsQL](https://docs.victoriametrics.com/victoriametrics/metricsql/) — 비동기 규칙 결과 저장과 PromQL 대비 계산 차이.
- **VictoriaMetrics 수집과 histogram 변환**: [vmagent](https://docs.victoriametrics.com/victoriametrics/vmagent/), [Native Histograms](https://docs.victoriametrics.com/victoriametrics/integrations/prometheus/index.html#native-histograms) — 수집기의 기능과 native histogram 수신 후 저장 방식.
