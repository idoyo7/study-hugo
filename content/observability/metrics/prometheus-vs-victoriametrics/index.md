---
title: "대규모 메트릭 운영, Prometheus와 VictoriaMetrics 중 무엇을 고를까"
linkTitle: "Prometheus vs VictoriaMetrics"
description: "공식 압축·메모리 수치와 동일 조건 벤치마크, HA·샤딩 비교 도식으로 Prometheus와 VictoriaMetrics의 대규모 운영 비용과 선택 기준을 정리합니다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 5
url: "/monitoring/prometheus-vs-victoriametrics/"
---

# 대규모 메트릭 운영, Prometheus와 VictoriaMetrics 중 무엇을 고를까

메트릭이 많아지면 Prometheus의 익숙함만으로는 선택을 설명하기 어려워집니다. VictoriaMetrics는 저장 효율을 강조하고, 클러스터 모드에서는 수집·저장·쿼리를 따로 늘릴 수 있습니다. 이때 단일 서버로 동작하는 Prometheus에 어떤 이점이 남는지 궁금해집니다.

**대규모 중앙 메트릭 플랫폼의 확장성과 운영 효율을 우선한다면 VictoriaMetrics 클러스터가 더 자연스러운 후보입니다.** Prometheus를 유지할 이유는 필요한 데이터 모델, 기존 규칙의 계산 방식, 현장에서 감시를 계속해야 하는 요구에서 찾아야 합니다. 이 글은 Prometheus 서버 자체와 VM 클러스터를 비교하고, Thanos처럼 확장을 위해 추가하는 구성은 별도로 구분합니다.

## 역할을 나누면 필요한 곳을 늘릴 수 있다

Prometheus는 타깃 발견, scrape, 로컬 TSDB 저장, PromQL 실행, recording·alerting rule 평가를 한 프로세스에서 처리합니다. 경보의 전달·그룹화는 별도 Alertmanager가 맡습니다. 수집한 데이터를 같은 서버에서 바로 조회하고 규칙에 사용할 수 있는 구조입니다. [Prometheus 구조](https://prometheus.io/docs/introduction/overview/#architecture)

VM 클러스터에서는 보통 vmagent가 수집하고, vminsert가 데이터를 분배하고, vmstorage가 저장하며, vmselect가 조회를 처리합니다. 규칙 평가는 vmalert가 맡습니다. 읽기 요청이 늘면 vmselect를, 저장 용량이나 수집 처리량이 부족하면 vmstorage를 증설하는 식으로 대응할 수 있습니다. 다만 쿼리도 vmstorage를 읽으므로, 컴포넌트를 나눴다고 자원 경합까지 없어지는 것은 아닙니다. [VM 클러스터 구조와 확장](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#architecture-overview)

확장 단위만 보면 모놀리스와 MSA의 차이에 가깝습니다. Prometheus는 구성 요소 사이의 통신과 운영 지점을 줄이고, VM은 역할별 증설과 장애 대응의 자유도를 얻습니다. 규모가 커져 수집량·보관량·조회 부하가 서로 다른 속도로 증가하면 후자의 이점이 커집니다.

## 디스크와 메모리, 공개 수치는 얼마나 차이 나는가

수치로 비교할 수 있습니다. 다만 **용량 산정용 평균값, 벤더가 제시하는 최대 절감 배수, 동일 조건에서 측정한 결과**는 구분해야 합니다. 여기서 배수는 원본 대비 압축률이 아니라 두 제품이 차지하는 공간·메모리의 비율입니다.

| 공개 자료 | 제시하는 수치 | 읽는 기준 |
|---|---|---|
| Prometheus 저장소 문서 | 평균 **1–2 bytes/sample** | 용량을 대략 산정하는 값. 최솟값이나 최대 압축률 보장은 아님 |
| VM 용량 산정 가이드 | 압축된 샘플 데이터 평균 **약 1 byte/sample 이하 또는 그 수준** | 인덱스는 별도. 시계열 교체가 잦으면 효율이 낮아짐. 복제·병합 여유 공간도 필요 |
| VM 제품 소개 | Prometheus·Thanos·Cortex 대비 RAM·저장공간 **최대 약 1/7** | 벤더의 최대 절감 주장. RAM은 수백만 고유 시계열 조건을 명시 |

출처: [Prometheus Storage](https://prometheus.io/docs/prometheus/latest/storage/), [VM 용량 산정](https://docs.victoriametrics.com/guides/understand-your-setup-size/), [VM 제품 소개](https://docs.victoriametrics.com/victoriametrics/#prominent-features). 이 표의 서로 다른 평균값을 나눠서 우리 환경의 절감 배수를 계산할 수는 없습니다. 같은 값이 반복되는 메트릭과 계속 변하는 값은 압축 결과가 다르고, 짧게 생겼다 사라지는 시계열은 인덱스 비용의 비중도 커집니다.

비교 조건이 더 분명한 자료는 **VM이 2024년 2월 공개한 단일 노드 대 단일 노드 시험**입니다. 각각 3 vCPU·12 GiB에서 같은 1,000개 node_exporter 타깃을 15초마다 수집했습니다. 타깃당 약 1,200개 시계열, 초당 약 8만 샘플, 약 초당 1회 읽기, 10분마다 타깃 5% 교체 조건으로 7일간 실행했습니다. [시험 구성과 결과](https://victoriametrics.com/blog/reducing-costs-p1/)

| 측정 항목 | Prometheus | VM single-node | 이 시험에서의 차이 |
|---|---:|---:|---|
| 디스크 사용량 | 83.5 GiB | 33 GiB | VM이 약 **60% 적음** |
| 최대 메모리 사용량 | 8.12 GiB | 4.5 GiB | VM이 약 **45% 적음** |
| 평균 CPU 사용량 | 0.79 core | 0.76 core | 비슷함 |
| 읽기 지연 p50 | 70.5 ms | 4.3 ms | VM이 약 16.4배 빠름 |
| 읽기 지연 p99 | 7 s | 3.6 s | VM이 약 1.9배 빠름 |

원문의 측정값으로 계산하면 디스크는 약 2.53배, 최대 메모리는 약 1.80배 차이입니다. **수집과 읽기를 함께 수행하면서 저장·메모리 비용이 실제로 줄어든 공개 사례**라는 점이 유용합니다. 다만 제품 버전과 메모리 지표의 정의는 원문에 명시되지 않았고, 벤더가 수행한 2024년 시험입니다. 최신 Prometheus 3.x 대 VM 클러스터의 실측 결과로 읽어서는 안 됩니다.

더 큰 차이가 나온 시험도 있습니다. 같은 회사의 [2024년 3월 수집기 비교](https://victoriametrics.com/blog/comparing-agents-for-scraping/#a-bonus-round-using-prometheus-and-victoriametrics-stacks)에는 Prometheus 2.50.1과 VM 1.99.0을 **remote-write 수신 저장소로 비교한 부가 시험**이 있습니다. 5,000개 모의 호스트, 12시간, 저장소별 30 core·90 GB 한도에서 CPU는 20.2 대 2.87 core, RSS는 69.0 대 16.8 GB였습니다. 여기서는 읽기 쿼리를 실행하지 않았습니다. 앞 표와 차이가 큰 이유를 이해하려면 수집 방식과 읽기 부하부터 봐야 합니다. 두 시험 모두 제품의 최대 수집 처리량을 측정한 것은 아닙니다.

## 압축이 잘되는데도 Prometheus 메모리가 커지는 이유

**디스크의 bytes/sample과 메모리의 bytes/series는 다른 비용입니다.** Prometheus는 새 샘플을 받는 Head의 시계열 상태·레이블·인덱스, 현재 청크와 조회 중간 결과를 관리합니다. 완료된 Head 청크는 파일에 두고 mmap으로 접근하므로, 최근 두 시간의 데이터 전부를 Go heap에 원시 형태로 쌓는 구조로 설명하는 것도 부정확합니다. 활성 시계열 수, 레이블 크기, 시계열 생성·소멸, 동시 쿼리가 함께 메모리를 좌우합니다. [Prometheus Head 구현](https://github.com/prometheus/prometheus/blob/v3.15.0/tsdb/head.go)

예를 들어 같은 초당 10만 샘플이라도 100만 시계열을 10초마다 수집하는 경우와 1,000만 시계열을 100초마다 수집하는 경우의 시계열 관리 비용은 같지 않습니다. `pod`, `path`, 사용자 ID 같은 레이블 조합이 계속 늘면 저장 압축만 개선해서는 해결되지 않습니다. 장기 보관 기간을 줄이는 것보다 활성 시계열과 불필요한 레이블을 줄이는 편이 Head 메모리에 직접 영향을 줍니다.

Prometheus 공식 문서는 **remote write 사용 시 약 25%의 메모리 증가를 보고하는 사용자가 많다**고 설명합니다. 시계열 ID와 레이블을 연결하는 캐시, 전송 큐가 추가되기 때문입니다. 데이터 형태에 따른 관측치이며 고정 가산율은 아닙니다. 즉 Prometheus를 수집기로 남기고 중앙 VM을 추가하면, 중앙 저장소가 가벼워져도 현장의 수집·저장·전송 비용은 함께 남습니다. [Remote write 자원 사용량](https://prometheus.io/docs/practices/remote_write/#resource-usage)

Prometheus 쪽 개선도 있습니다. 2026년 공식 글은 3.5부터 제공된 Linux의 `use-uncached-io` 기능으로 병합 청크 쓰기의 페이지 캐시를 우회했을 때 **`container_memory_cache`가 20–50% 감소한 시험 결과**를 소개합니다. 전체 RSS나 Go heap이 그만큼 감소했다는 뜻은 아닙니다. [Uncached I/O in Prometheus](https://prometheus.io/blog/2026/03/05/uncached-io/)

운영 비용을 비교할 때는 Prometheus 모든 샤드·복제본과 추가 조회 계층을 합산하고, VM도 vmagent·vminsert·vmstorage·vmselect·vmalert 및 복제본을 합산해야 합니다. RSS, Go heap, 컨테이너 working set, 파일 캐시를 같은 지표끼리 비교하고, 평상시뿐 아니라 쿼리·병합·재시작 중 최대 사용량을 봅니다. VM의 `memory.allowedPercent`도 내부 캐시 등에 주는 예산이지 프로세스 전체의 메모리 상한은 아닙니다. [VM 메모리 설정](https://docs.victoriametrics.com/victoriametrics/#resource-usage-limits)

VM은 유입 데이터를 메모리의 작은 part에서 디스크 part로 내리고 병합하며, 시계열 검색용 IndexDB와 샘플 데이터를 나눠 관리합니다. 이 저장 경로와 캐시 관리의 차이가 자원 사용 패턴을 바꿉니다. 하지만 VM에서도 고카디널리티·잦은 시계열 교체는 인덱스와 캐시 비용을 늘립니다. **제품을 바꾸면 같은 데이터의 처리 비용을 줄일 수 있지만, 불필요한 시계열을 무제한으로 받아도 되는 것은 아닙니다.** [VM 저장 구조](https://docs.victoriametrics.com/victoriametrics/#storage), [시계열 교체의 영향](https://docs.victoriametrics.com/guides/understand-your-setup-size/#churn-rate)

## Pod 장애에는 자립성보다 복제 구성이 중요하다

단일 Prometheus Pod가 내려가면 그 인스턴스의 수집·조회·규칙 평가가 함께 멈춥니다. PVC가 남아 있다면 재기동 후 저장된 데이터와 WAL을 읽어 복구할 수 있지만, 로컬 디스크까지 영구 유실됐을 때 다른 서버에서 데이터를 가져오는 복제 기능은 Prometheus 자체에 없습니다. [Prometheus 로컬 저장소의 한계](https://prometheus.io/docs/prometheus/latest/storage/#on-disk-layout)

VM도 클러스터 모드라는 이유만으로 데이터 사본이 생기지는 않습니다. 애플리케이션 수준의 복제는 별도 설정이며, `replicationFactor=2`로 서로 다른 vmstorage에 저장된 데이터는 한쪽이 사라져도 다른 쪽에서 조회할 수 있습니다. 장애 중 새 데이터의 복제 수까지 유지하려면 충분한 노드와 여유 용량이 필요합니다. **Pod나 저장 장치 하나의 장애를 견디는 기준에서는, 적절히 복제한 VM 클러스터가 단일 Prometheus보다 유리합니다.** [VM 복제와 데이터 안전성](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#replication-and-data-safety)

Prometheus HA는 같은 타깃을 수집하고 같은 규칙을 평가하는 서버를 둘 이상 두는 방식입니다. 한쪽이 멈춰도 다른 쪽이 감시를 계속하지만, 수집·메모리·로컬 저장·규칙 평가 비용이 중복됩니다. 서로 다른 시점에 수집한 데이터이므로 두 서버의 조회 결과도 조금씩 다를 수 있습니다. [Prometheus Operator의 HA 설명](https://prometheus-operator.dev/docs/platform/high-availability/#prometheus)

**Prometheus 서버 자체에는 여러 TSDB를 하나로 묶는 클러스터 모드가 없습니다.** 복제 로그를 합의해 저장하거나, 복제본끼리 빠진 데이터를 복구하거나, 여러 노드에 PromQL 실행을 분산하는 기능을 내장하지 않습니다. 공식 문서도 로컬 저장소가 클러스터화·복제되지 않는다고 명시합니다. HA와 샤딩은 독립 서버들을 조합하는 배치 방식입니다. [Prometheus의 범위](https://prometheus.io/docs/prometheus/latest/storage/#remote-storage-integrations), [공식 HA 권장](https://prometheus.io/docs/introduction/faq/#can-prometheus-be-made-highly-available)

그렇다고 연결 수단이 없는 것은 아닙니다. 다음 기능들은 서로 다른 문제를 해결합니다.

| 기능 | 제공하는 것 | 제공하지 않는 것 |
|---|---|---|
| 같은 설정의 Prometheus HA 쌍 | 한쪽이 멈춰도 다른 쪽이 수집·평가 | 두 TSDB의 복제·동기화 |
| 타깃 샤딩 | 인스턴스별 수집 부하 분담 | 과거 데이터 재배치·전역 쿼리 |
| Federation | 하위 서버의 선택한 현재 값·집계 지표를 상위에서 재수집 | 원본 전체 이력에 대한 분산 쿼리 |
| Remote write / read | 외부 저장소로 전송 / 원시 시계열 읽기 | Prometheus끼리의 저장 클러스터 구성 |
| Alertmanager HA | 알림 중복 억제와 silence·notification log 공유 | 메트릭 데이터 복제 |

Federation은 요약 지표를 모아 글로벌 뷰를 만드는 유효한 방법입니다. 다만 상위 서버가 다시 수집·저장하는 계층이며, remote read도 가져온 데이터의 PromQL 계산은 Prometheus에서 수행합니다. Alertmanager의 gossip 클러스터는 알림 상태를 다룹니다. 이 세 가지를 TSDB 클러스터와 구분해야 합니다. [Federation](https://prometheus.io/docs/prometheus/latest/federation/), [Remote storage](https://prometheus.io/docs/prometheus/latest/storage/#remote-storage-integrations), [Alertmanager HA](https://prometheus.io/docs/alerting/latest/high_availability/)

VM의 복제에도 저장·전송·중복 제거 비용이 들고, vmagent의 수집까지 이중화하면 중복 scrape 비용이 생깁니다. 차이는 복제 비용의 존재 여부보다 **수집기, 저장소, 쿼리 계층의 이중화와 증설을 각각 설계할 수 있느냐**에 있습니다.

여기서 Prometheus의 자립성은 다른 장애를 가리킵니다. 예를 들어 서비스 클러스터와 중앙 저장소 사이의 연결이 끊겨도, 서비스 클러스터 안에 있는 Prometheus는 자신의 데이터로 조회와 규칙 평가를 계속할 수 있습니다. 이 이점은 현장에 VM 저장소와 vmalert를 배치해도 얻을 수 있습니다. 따라서 **로컬 배치의 이점을 Prometheus만의 내구성 우위로 해석해서는 안 됩니다.**

## 샤딩을 하면 수집 이후의 일도 나눠야 한다

Prometheus Operator의 기본 샤딩은 **무작위 인덱싱 분할이 아니라 타깃 주소에 대한 결정적 해시 분할**입니다. 같은 샤드 수와 입력에는 같은 배정이 나옵니다. ServiceMonitor·PodMonitor는 기본적으로 `__address__`를 기준으로 나누며, 저장된 시계열을 하나의 분산 DB처럼 관리하는 방식과는 다릅니다. `shards: 2`, `replicas: 2`라면 Prometheus Pod는 네 개가 되고, 각 샤드의 HA 쌍이 자기 몫을 중복 수집합니다. 타깃마다 노출하는 시계열 수가 다르면 타깃 수가 비슷해도 샤드 부하는 불균등할 수 있습니다. [샤딩 방식](https://prometheus-operator.dev/docs/platform/sharding/#design)

수집 부하는 나눠졌지만, 서비스 전체의 오류율을 계산할 데이터가 여러 샤드에 흩어질 수 있습니다. 원본을 가로지르는 조회와 규칙 평가에는 Thanos Query·Ruler 같은 구성이나 중앙 remote-write 저장소를 추가합니다. 아래 그림은 각 Prometheus에 sidecar를 붙이고 Thanos Query로 조회 결과를 모으는 예입니다. 화살표는 수집 데이터와 조회 결과가 흐르는 방향입니다.

{{< flow src="_flow/1-prometheus-ha-sharding.json" />}}

샤드 수를 바꿔도 과거 데이터가 새 배치에 맞춰 자동 이동하지 않습니다. 또한 같은 총 수집량을 더 많은 샤드로 나누는 것은 **서버 한 대의 부담을 줄이는 일**입니다. 전체 샘플 수가 줄지는 않고, 복제본 수를 늘리면 중복 비용이 더해집니다. Operator가 배포를 자동화해도 이 성질은 남습니다. [샤딩의 제약](https://prometheus-operator.dev/docs/platform/sharding/#design)

VM은 저장 노드에 분산된 데이터를 vmselect로 조회하는 경로가 기본 구성에 포함됩니다. 다만 VM 역시 노드를 추가한다고 과거 데이터가 자동으로 균등 재배치되는 것은 아닙니다. **전역 조회가 기본으로 제공되는 것과 기존 데이터의 재배치는 별개의 기능입니다.** [VM 재배치](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#rebalancing)

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

VM 그림은 한 샘플을 두 저장 노드에 쓰는 `replicationFactor=2` 예입니다. 저장 노드끼리 복제하는 것이 아니라 vminsert가 사본을 분배합니다. 장애 중에도 새 데이터의 두 사본을 유지하는 구성에는 최소 세 vmstorage와 여유 용량이 필요하며, 수집·쓰기·조회 계층도 별도로 이중화해야 합니다. vmalert는 vmselect로 조회하고, recording rule 결과는 vminsert로 다시 씁니다. [복제 조건](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#replication-and-data-safety)

설정도 쓰기와 읽기를 나눠 봅니다. vminsert의 `-replicationFactor=2`는 쓰기 사본 수를, vmselect의 같은 옵션은 장애 시 응답 완전성 판단을 위한 복제 정보를 지정합니다. 저장 복제본의 동일 타임스탬프 중복은 vmselect의 `-dedup.minScrapeInterval=1ms`로 제거할 수 있습니다. HA 수집기까지 중복 scrape한다면 그보다 큰 실제 수집 간격에 맞춘 dedup 정책이 필요합니다.

따라서 규모가 커질수록 비교 대상은 Prometheus 한 개에서, 여러 Prometheus와 전역 조회·규칙 평가 계층을 합친 전체 구성으로 넓어집니다. 이 단계에서 처음의 단일 바이너리라는 단순함은 상당 부분 줄어듭니다.

## 저장은 압축률과 데이터 표현을 함께 본다

Prometheus의 TSDB 블록은 시간 범위별로 나뉘고 인덱스·청크·메타데이터 구조가 문서화돼 있어, 백업이나 문제 구간을 이해하기 쉽습니다. 하지만 이 가독성이 대용량 저장 비용의 우위를 뜻하지는 않습니다. 압축 효율은 활성 시계열 수, 시계열이 생성·소멸하는 속도, 샘플 값과 보관 기간에 따라 달라집니다. 비교할 때는 같은 원본과 보관·복제 조건에서 인덱스, WAL·버퍼, 병합 중 여유 공간까지 포함해야 합니다. [Prometheus 저장 구조](https://prometheus.io/docs/prometheus/latest/storage/)

값의 보존 방식도 다릅니다. Prometheus의 기본 XOR 인코딩은 입력된 float64 비트를 보존합니다. VM 문서는 유효 숫자 12자리를 넘는 값에서 낮은 자릿수의 정밀도가 줄어들 수 있다고 설명합니다. 일반적인 인프라 지표에서 이 차이만으로 선택이 갈리는 경우는 제한적이지만, 압축률만 비교하면 빠지는 조건입니다. [Prometheus XOR 구현](https://github.com/prometheus/prometheus/blob/v3.15.0/tsdb/chunkenc/xor.go), [VM 값의 정밀도](https://docs.victoriametrics.com/victoriametrics/keyconcepts/#raw-samples)

최근 Prometheus도 저장 방식을 개선하고 있습니다. 3.15에서는 선택 가능한 XOR2 float 청크 인코딩이 안정화됐고, 기본값은 여전히 XOR입니다. XOR2를 선택할 때는 TSDB 블록을 직접 읽는 외부 도구의 지원 여부를 확인해야 하며, 이 개선이 VM 대비 압축 우위를 입증하는 것은 아닙니다. [Prometheus 3.15 변경 내역](https://github.com/prometheus/prometheus/blob/v3.15.0/CHANGELOG.md)

더 직접적인 차이는 native histogram입니다. Prometheus는 버킷·합계·개수를 하나의 복합 샘플로 저장하고 PromQL에서 histogram으로 다룹니다. 3.8부터 안정화된 기능이지만 수집은 `scrape_native_histograms: true`로 활성화해야 합니다. VM은 현재 공식 문서 기준으로 이를 수신한 뒤 `vmrange` 레이블을 가진 `_bucket`, `_sum`, `_count` 시계열로 변환합니다. Native histogram을 중심으로 계측과 규칙을 구성했다면, 수신 가능 여부에 더해 변환 후 시계열 수와 쿼리 변경까지 비교해야 합니다. [Native histogram 명세](https://prometheus.io/docs/specs/native_histograms/), [VM의 변환 방식](https://docs.victoriametrics.com/victoriametrics/integrations/prometheus/index.html#native-histograms)

## 쿼리는 계산 속도와 평가 시점을 구분한다

단일 Prometheus는 로컬 저장소에서 데이터를 읽으므로 저장 노드 사이의 RPC가 필요 없습니다. 반면 VM은 저장 노드의 작업을 병렬로 수행하고 쿼리 계층을 따로 늘릴 수 있습니다. 어느 쪽이 빠른지는 조회 기간, 선택한 시계열 수, 연산, 캐시와 동시 요청량에 따라 달라집니다. 단일 서버라는 이유만으로 쿼리가 항상 빠르다고 볼 수는 없습니다.

Prometheus의 구체적인 이점은 같은 rule group 안의 의존 관계입니다. 기본 순차 평가에서는 앞 recording rule이 서비스별 요청률을 저장하고 뒤 규칙이 같은 평가 시각의 결과로 경보를 판단할 수 있습니다. vmalert도 규칙을 순서대로 실행하지만 결과 저장이 비동기 remote write라서, 다음 규칙이 방금 계산한 값을 아직 읽지 못할 수 있습니다. [Prometheus 규칙 평가](https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/), [vmalert의 제약](https://docs.victoriametrics.com/victoriametrics/vmalert/#limitations)

이 차이는 항상 한 평가 주기만 늦는다는 뜻은 아닙니다. 전송과 저장 지연에 따라 이전 결과를 읽거나 결과가 없을 수 있고, VM은 최근 데이터의 불완전한 조회를 줄이기 위해 기본 30초의 `latencyOffset`을 둡니다. 조정 가능한 데이터 가시성 정책이며 쿼리 실행시간과는 다릅니다. 지연을 고려해 규칙을 구성할 수 있다면, 이것만으로 Prometheus를 선택할 근거는 약합니다. 원본을 한 쿼리에서 `sum(rate(...))`로 집계하는 경우에는 Prometheus도 모든 타깃을 같은 순간에 수집하지 않습니다. [VM 쿼리의 최근 데이터 처리](https://docs.victoriametrics.com/victoriametrics/keyconcepts/#query-latency)

또 하나는 계산 의미의 유지입니다. MetricsQL은 PromQL과 넓게 호환되지만 `rate()`·`increase()` 등의 계산에 의도적인 차이가 있습니다. 이미 검증한 SLO와 경보 규칙이 많다면, 전환 비용에는 설정 파일 이관뿐 아니라 동일한 원본에서 결과를 대조하는 작업도 들어갑니다. 기존 Prometheus를 유지하는 이유가 될 수 있지만, 신규 구축에서 VM을 배제할 이유는 아닙니다. [MetricsQL과 PromQL의 차이](https://docs.victoriametrics.com/victoriametrics/metricsql/)

## 무엇을 고를 것인가

지금까지의 차이를 선택 조건으로 옮기면 다음과 같습니다. 아래 판단은 같은 환경에서 두 제품을 실측한 순위가 아니라, 구조와 기능에 따른 선택 기준입니다.

| 우선하는 요구 | 먼저 검토할 구성 | 판단 근거 |
|---|---|---|
| 대규모 중앙 저장, 전역 조회, 역할별 독립 증설 | vmagent + VM 클러스터 + vmalert | 데이터 분산과 전역 조회 경로가 기본 구성에 포함됨 |
| 기존 PromQL·native histogram 규칙 유지, 담당 범위가 서버 용량 안에 들어옴 | Prometheus, 필요하면 HA 쌍 | 계산 방식과 수집·저장·평가 흐름을 유지하기 쉬움 |
| 중앙 연결이 끊겨도 현장 경보 평가 필요 | 현장 Prometheus 또는 현장 VM 저장소 + vmalert | 제품 이름보다 데이터와 평가기가 어디에 있는지가 중요함 |
| 현장에서는 Prometheus를 유지하고 중앙에서 장기·전역 조회 | Prometheus + remote write + VM 클러스터 | 두 요구를 함께 충족하지만 로컬·중앙 저장과 전송 비용이 더해짐 |

수집기만 필요하다면 Prometheus 서버를 반드시 유지할 이유는 없습니다. vmagent도 Prometheus 형식의 scrape 설정, 서비스 디스커버리와 relabeling을 지원합니다. 반대로 현장 조회와 규칙 평가 때문에 Prometheus를 두는 경우에는, 그 기능이 없는 Agent 모드와 구분해야 합니다. [vmagent](https://docs.victoriametrics.com/victoriametrics/vmagent/), [Prometheus Agent 모드](https://prometheus.io/docs/prometheus/latest/prometheus_agent/)

대규모 중앙 플랫폼을 새로 구축한다면 VM 클러스터를 우선 검토하겠습니다. Prometheus를 함께 둘 때는 그 서버가 맡을 조회·규칙·데이터 모델 요구를 먼저 정하겠습니다. 그 요구가 없다면 Prometheus의 중복 수집과 저장을 추가하는 비용을 정당화하기 어렵습니다. 기존 환경을 바꾼다면 대표 쿼리와 경보를 같은 원본으로 대조하고, 저장량·메모리·쿼리 지연·장애 중 동작을 측정한 뒤 전환 여부를 결정할 수 있습니다.

기능 설명은 2026-10-21에 확인한 공식 문서와 Prometheus 3.15 변경 내역을 기준으로 합니다. 장기 보관 방식은 [장기 보관 비교]({{< relref "/observability/metrics/longterm-retention/_index.md" >}}), Thanos를 추가하는 구성은 [Prometheus·Thanos 연동]({{< relref "/observability/metrics/prometheus-thanos/_index.md" >}})에서 이어집니다.

여러 Kubernetes 클러스터와 리전을 연결하는 선택은 [부록: Thanos와 VictoriaMetrics의 멀티클러스터 구성]({{< relref "/observability/metrics/prometheus-vs-victoriametrics-multi-cluster/index.md" >}})에서 중앙 수집·지역 자립·객체 스토리지 경로로 나눠 설명합니다.

## 참고 자료

아래는 본문에서 사용한 공식 문서·소스 코드와 벤더가 공개한 시험입니다. 벤치마크 수치는 해당 시험의 조건·발표 시점을 함께 적었으며, 이 글에서 새로 실측한 결과는 아닙니다.

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
