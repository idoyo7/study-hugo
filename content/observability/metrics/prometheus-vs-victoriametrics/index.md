---
title: "대규모 메트릭 운영, Prometheus와 VictoriaMetrics 중 무엇을 고를까"
linkTitle: "Prometheus vs VictoriaMetrics"
description: "수집·저장·쿼리의 확장 단위부터 Pod 장애, HA와 샤딩 비용, 집계 시점과 데이터 모델까지 비교해 대규모 운영의 선택 기준을 정리합니다."
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

## Pod 장애에는 자립성보다 복제 구성이 중요하다

단일 Prometheus Pod가 내려가면 그 인스턴스의 수집·조회·규칙 평가가 함께 멈춥니다. PVC가 남아 있다면 재기동 후 저장된 데이터와 WAL을 읽어 복구할 수 있지만, 로컬 디스크까지 영구 유실됐을 때 다른 서버에서 데이터를 가져오는 복제 기능은 Prometheus 자체에 없습니다. [Prometheus 로컬 저장소의 한계](https://prometheus.io/docs/prometheus/latest/storage/#on-disk-layout)

VM도 클러스터 모드라는 이유만으로 데이터 사본이 생기지는 않습니다. 애플리케이션 수준의 복제는 별도 설정이며, `replicationFactor=2`로 서로 다른 vmstorage에 저장된 데이터는 한쪽이 사라져도 다른 쪽에서 조회할 수 있습니다. 장애 중 새 데이터의 복제 수까지 유지하려면 충분한 노드와 여유 용량이 필요합니다. **Pod나 저장 장치 하나의 장애를 견디는 기준에서는, 적절히 복제한 VM 클러스터가 단일 Prometheus보다 유리합니다.** [VM 복제와 데이터 안전성](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#replication-and-data-safety)

Prometheus HA는 같은 타깃을 수집하고 같은 규칙을 평가하는 서버를 둘 이상 두는 방식입니다. 한쪽이 멈춰도 다른 쪽이 감시를 계속하지만, 수집·메모리·로컬 저장·규칙 평가 비용이 중복됩니다. 서로 다른 시점에 수집한 데이터이므로 두 서버의 조회 결과도 조금씩 다를 수 있습니다. [Prometheus Operator의 HA 설명](https://prometheus-operator.dev/docs/platform/high-availability/#prometheus)

VM의 복제에도 저장·전송·중복 제거 비용이 들고, vmagent의 수집까지 이중화하면 중복 scrape 비용이 생깁니다. 차이는 복제 비용의 존재 여부보다 **수집기, 저장소, 쿼리 계층의 이중화와 증설을 각각 설계할 수 있느냐**에 있습니다.

여기서 Prometheus의 자립성은 다른 장애를 가리킵니다. 예를 들어 서비스 클러스터와 중앙 저장소 사이의 연결이 끊겨도, 서비스 클러스터 안에 있는 Prometheus는 자신의 데이터로 조회와 규칙 평가를 계속할 수 있습니다. 이 이점은 현장에 VM 저장소와 vmalert를 배치해도 얻을 수 있습니다. 따라서 **로컬 배치의 이점을 Prometheus만의 내구성 우위로 해석해서는 안 됩니다.**

## 샤딩을 하면 수집 이후의 일도 나눠야 한다

Prometheus Operator의 기본 샤딩은 타깃 주소의 해시로 수집 대상을 나눕니다. 저장된 시계열을 하나의 분산 DB처럼 관리하는 방식과는 다릅니다. `shards: 4`, `replicas: 2`라면 Prometheus Pod는 여덟 개가 되고, 각 샤드의 HA 쌍이 자기 몫을 중복 수집합니다. 타깃마다 노출하는 시계열 수가 다르면 타깃 수가 비슷해도 샤드 부하는 불균등할 수 있습니다. [샤딩 방식](https://prometheus-operator.dev/docs/platform/sharding/#design)

수집 부하는 나눠졌지만, 서비스 전체의 오류율을 계산할 데이터가 여러 샤드에 흩어질 수 있습니다. 이때 전역 조회와 규칙 평가에는 Thanos Query·Ruler 같은 구성이나 중앙 remote-write 저장소가 필요합니다. 샤드 수를 바꿔도 과거 데이터가 새 배치에 맞춰 자동 이동하지 않습니다. Operator가 배포를 자동화해도 이 문제는 남습니다. [샤딩의 제약](https://prometheus-operator.dev/docs/platform/sharding/#design)

VM은 저장 노드에 분산된 데이터를 vmselect로 조회하는 경로가 기본 구성에 포함됩니다. 다만 VM 역시 노드를 추가한다고 과거 데이터가 자동으로 균등 재배치되는 것은 아닙니다. **전역 조회가 기본으로 제공되는 것과 기존 데이터의 재배치는 별개의 기능입니다.** [VM 재배치](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#rebalancing)

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

## 참고 자료

아래는 본문에서 사용한 공식 문서와 소스 코드입니다. 벤더의 성능 수치를 직접 비교한 벤치마크가 아니라, 각 제품의 동작과 제약을 확인하는 근거로 사용했습니다.

- **Prometheus 구조와 저장소**: [Architecture](https://prometheus.io/docs/introduction/overview/#architecture), [Storage](https://prometheus.io/docs/prometheus/latest/storage/) — 단일 서버의 역할, TSDB 블록 구조와 로컬 저장소의 한계.
- **Prometheus HA와 샤딩**: [Operator High Availability](https://prometheus-operator.dev/docs/platform/high-availability/#prometheus), [Sharding](https://prometheus-operator.dev/docs/platform/sharding/#design) — 복제본의 중복 수집, 타깃 분할과 과거 데이터 처리.
- **Prometheus 규칙 평가와 수집 전용 모드**: [Recording Rules](https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/), [Prometheus Agent](https://prometheus.io/docs/prometheus/latest/prometheus_agent/) — 같은 그룹의 규칙 평가 순서와 Agent 모드의 기능 범위.
- **Prometheus 데이터 표현과 최근 변경**: [Native Histograms](https://prometheus.io/docs/specs/native_histograms/), [3.15 변경 내역](https://github.com/prometheus/prometheus/blob/v3.15.0/CHANGELOG.md), [XOR 구현](https://github.com/prometheus/prometheus/blob/v3.15.0/tsdb/chunkenc/xor.go) — histogram 지원, XOR2와 float64 인코딩.
- **VictoriaMetrics 클러스터 운영**: [Architecture](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#architecture-overview), [Replication and Data Safety](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#replication-and-data-safety), [Rebalancing](https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/#rebalancing) — 역할별 확장, 복제 조건과 기존 데이터의 재배치.
- **VictoriaMetrics 값과 조회 시점**: [Raw Samples](https://docs.victoriametrics.com/victoriametrics/keyconcepts/#raw-samples), [Query Latency](https://docs.victoriametrics.com/victoriametrics/keyconcepts/#query-latency) — 값의 정밀도와 최근 데이터의 가시성.
- **VictoriaMetrics 규칙과 쿼리 의미**: [vmalert Limitations](https://docs.victoriametrics.com/victoriametrics/vmalert/#limitations), [MetricsQL](https://docs.victoriametrics.com/victoriametrics/metricsql/) — 비동기 규칙 결과 저장과 PromQL 대비 계산 차이.
- **VictoriaMetrics 수집과 histogram 변환**: [vmagent](https://docs.victoriametrics.com/victoriametrics/vmagent/), [Native Histograms](https://docs.victoriametrics.com/victoriametrics/integrations/prometheus/index.html#native-histograms) — 수집기의 기능과 native histogram 수신 후 저장 방식.
