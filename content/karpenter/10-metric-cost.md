---
title: "메트릭 수집 비용 — 무엇을 버릴 것인가"
weight: 10
---

# 10 · 메트릭 수집 비용 — 무엇을 버릴 것인가

{{< callout type="info" >}}
- 비용을 만드는 건 메트릭 60개가 아니라 시리즈 수입니다. 60개 중 **파드 단위 6개**가 대부분을 차지하고 그 6개만 배포마다 전량 churn합니다.
- Datadog은 OpenMetrics로 긁은 것을 전부 custom metric으로 셉니다. 공식 문서 표현이 *"all metrics retrieved by the generic Prometheus check are considered custom metrics"* 입니다. 아무 설정 없이 붙이면 청구가 튑니다.
- OpenMetrics 체크에는 `max_returned_metrics` 기본 2000 상한이 있습니다. 대규모 클러스터에서는 이 선에서 경고 없이 잘립니다 — 없는 메트릭과 잘린 메트릭이 구분되지 않습니다.
- VM에서는 청구가 아니라 **`indexdb` 팽창**이 비용입니다. 시리즈 총수가 같아도 churn이 크면 인덱스가 계속 자랍니다.
- Prometheus의 보호 장치는 전부 기본으로 꺼져 있습니다 — `sample_limit`·`label_limit`·`target_limit` 기본값이 모두 `0`(무제한)입니다.
- 파드 6종을 버려도 잃는 게 거의 없습니다. 파드 단위 상태는 kube-state-metrics가 이미 더 잘 냅니다.
- 켜기 전에 잽니다. 엔드포인트를 직접 긁으면 백엔드에 아무것도 넣지 않고 시리즈 수를 셀 수 있습니다(§5.1). 붙였다가 줄이는 순서는 Datadog에서 그 달 청구가 이미 발생한 뒤입니다.
- drop보다 keep이 낫습니다. 업스트림이 메트릭을 추가하면 blocklist는 그것을 자동으로 통과시킵니다(§4.1).
{{< /callout >}}

[09]({{< relref "09-metrics-logs-events.md" >}})가 "무엇이 나오나"라면 여기는 "무엇을 저장할 것인가"입니다 — 60개를 다 긁는 것 자체는 문제가 아니고 비용이 백엔드마다 다른 이름으로 나타나는 게 주제입니다. 카디널리티 폭발의 원리는 [VictoriaMetrics / 카디널리티]({{< relref "../monitoring/victoriametrics/practice/01-cardinality.md" >}})가 소유합니다. 여기서는 그 결과만 다룹니다.

## 1. 비용을 만드는 축은 넷이다

시리즈 수는 곧 라벨 조합 수입니다. Karpenter 메트릭의 라벨은 네 축 중 하나에 붙습니다.

| 축 | 메트릭 수 | 시리즈 수 | churn |
|---|---|---|---|
| **파드 단위** | 6 | **6P** | **배포마다 전량** |
| 노드 단위 | 7 | 6NR + N | 노드 교체 시 |
| NodePool 단위 | 다수 | NP × 조합 | 거의 없음 |
| 전역 | 4 | 상수 | 없음 |

`P` 파드, `N` 노드, `NP` NodePool, `R` 노드의 실제 리소스 종류 수(고정 아님 — `ResourceList` 순회로 정해짐, `metrics/node/controller.go`의 `getNodeLabelsWithResourceType`). 보통 `cpu`·`memory`·`pods`·`ephemeral-storage`·`hugepages-1Gi`·`hugepages-2Mi` 여섯입니다.

### 1.1 파드 단위 6종 — 여기가 전부다

| 메트릭 | 라벨 |
|---|---|
| `karpenter_pods_state` | 파드 식별 + **노드 라벨셋 전체** |
| `karpenter_pods_unstarted_time_seconds` | `{name,namespace}` |
| `karpenter_pods_unbound_time_seconds` | `{name,namespace}` |
| `karpenter_pods_provisioning_unstarted_time_seconds` | `{name,namespace}` · ALPHA |
| `karpenter_pods_provisioning_unbound_time_seconds` | `{name,namespace}` · ALPHA |
| `karpenter_pods_provisioning_scheduling_undecided_time_seconds` | `{name,namespace}` · ALPHA |

`karpenter_pods_state`에는 노드 라벨셋(`nodepool`·`zone`·`instance_type`·`capacity_type`…)이 통째로 붙어 재스케줄만으로도 새 시리즈가 생깁니다. 여섯 모두 라벨에 파드 이름이 들어가므로 Deployment 롤링 한 번에 시리즈가 통째로 죽고 생깁니다.

### 1.2 규모 감각 — 예시 계산

실측이 아닌 예시입니다(자기 클러스터 수치는 §5로 잽니다). `P=3000`, `N=200`, `NP=35`, `R=6`일 때:

| 축 | 시리즈 | 비중 |
|---|---|---|
| 파드 단위 | 18,000 | **67%** |
| 노드 단위 | 7,400 | 27% |
| NodePool 단위 | ~1,600 | 6% |
| 전역 | ~10 | 0% |

롤링 배포 한 번이 18,000개 시리즈를 새로 만듭니다 — 총량보다 이 숫자가 더 아픕니다.

## 2. 백엔드는 이 비용을 어떻게 청구하나

같은 시리즈가 백엔드마다 다른 이름의 비용이 됩니다.

| | Datadog | VictoriaMetrics | Prometheus |
|---|---|---|---|
| 비용의 이름 | **custom metric 수** | `indexdb` 크기 · 메모리 | 메모리 · 디스크 |
| 세는 단위 | 메트릭명 + **유니크 태그 조합** | active time series | head series |
| 청구 | 시간별 distinct 수의 **월평균** | 없음(자체 운영) | 없음(자체 운영) |
| 무료 분량 | host당 100(Pro) / 200(Ent), **풀로 합산** | — | — |

### 2.1 Datadog — 긁은 것이 전부 custom metric이 된다

> "By default, all metrics retrieved by the generic Prometheus check are considered custom metrics."

OpenMetrics 체크로 붙이면 60개 전부와 그 태그 조합이 custom metric으로 과금됩니다 — §1.2 예시라면 27,000이 그대로 27,000 custom metric입니다. Pro 무료 분량(호스트당 100×200대=20,000)을 넘깁니다.

MWL(Metrics without Limits™)은 ingested/indexed를 분리해 태그 allowlist 밖을 드롭하지만 indexed만 줄고 ingested는 그대로입니다 — 유입을 줄이려면 Agent 단계(§3.3)에서 걸러야 합니다.

### 2.2 VictoriaMetrics — 청구가 아니라 인덱스가 문제다

active time series는 최근 1시간 안에 샘플을 받은 시계열이라 죽은 파드는 한 시간 뒤 빠집니다. 그러나 `indexdb`에서는 안 빠집니다 — 역인덱스가 모든 라벨 엔트리를 담기 때문입니다. churn이 계속되면 인덱스도 계속 자랍니다(공식 FAQ: `indexdb`가 `data`의 **2배를 넘기도 함**).

VM에서는 총 시리즈 수보다 churn이 먼저입니다 — 파드 6종은 총량도 크지만 churn으로는 압도적입니다.

### 2.3 Prometheus — 보호 장치가 전부 꺼져 있다

| 설정 | 기본값 | 무엇을 막나 |
|---|---|---|
| `sample_limit` | **0 (무제한)** | 스크랩당 샘플 수 |
| `label_limit` | **0 (무제한)** | 샘플당 라벨 수 |
| `target_limit` | **0 (무제한)** | 스크랩 설정당 타깃 수 |

셋 다 켜면 초과 시 스크랩 전체가 실패합니다. `sample_limit` 판정은 `metric_relabel_configs` **이후** 기준이라 drop 규칙과 함께 계산해야 합니다.

## 3. 수집 설정

### 3.1 엔드포인트

```
--metrics-port / METRICS_PORT   기본 8080   (options.go:114)
경로                            /metrics    (controller-runtime 기본)
```

### 3.2 VictoriaMetrics

vm-operator는 `VMServiceScrape`를 먹습니다(prometheus-converter가 켜져 있으면 `ServiceMonitor`도 자동 변환 — 차트에 `serviceMonitor.enabled`가 있으면 그쪽이 짧습니다).

```yaml
apiVersion: operator.victoriametrics.com/v1beta1
kind: VMServiceScrape
metadata:
  name: karpenter
  namespace: karpenter
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: karpenter
  endpoints:
    - port: http-metrics          # 차트의 서비스 포트 이름 확인 필요
      interval: 30s
      metricRelabelConfigs:
        # §4의 drop 규칙이 여기 들어간다
        - action: drop
          source_labels: [__name__]
          regex: 'karpenter_pods_(state|unstarted_time_seconds|unbound_time_seconds)'
        - action: drop
          source_labels: [__name__]
          regex: 'karpenter_pods_provisioning_.*'
```

`relabel_configs`가 아니라 `metricRelabelConfigs`입니다 — 전자는 스크랩 **전** 타깃 선정, 후자가 스크랩 **후** 저장 전 단계입니다. vmagent에서도 거를 수 있지만(`-remoteWrite.relabelConfig`) 스크랩 단계에서 미리 버리는 편이 낫습니다.

### 3.3 Datadog

파드 어노테이션으로 OpenMetrics 체크를 붙입니다. `metrics:`에 allowlist를 반드시 줍니다 — 안 주면 §2.1대로 전부 custom metric이 됩니다.

```yaml
ad.datadoghq.com/controller.checks: |
  {
    "openmetrics": {
      "init_config": {},
      "instances": [{
        "openmetrics_endpoint": "http://%%host%%:8080/metrics",
        "namespace": "karpenter",
        "metrics": [
          "karpenter_nodeclaims_disrupted_total",
          "karpenter_nodepools_allowed_disruptions",
          "karpenter_scheduler_unschedulable_pods_count",
          "karpenter_consolidation_score"
        ],
        "max_returned_metrics": 5000,
        "exclude_labels": ["name", "namespace"]
      }]
    }
  }
```

유입을 줄이는 유일한 수단이 `metrics:` allowlist입니다. `max_returned_metrics`(기본 2000)는 allowlist 없이 붙였을 때 경고 없이 잘리는 선입니다. `exclude_labels`는 파드 이름·네임스페이스를 Agent 단계에서 제거합니다. MWL의 태그 allowlist는 indexed만 줄이는 그다음 층이라 위 셋을 먼저 적용합니다.

## 4. 무엇을 버리고 무엇을 남기나

### 4.1 drop보다 keep이 낫다

blocklist보다 allowlist(keep-list)를 권합니다 — 업스트림이 메트릭을 추가하면 blocklist는 그것을 자동으로 통과시킵니다. 새 메트릭이 파드 단위면 아무 경고 없이 비용이 오릅니다.

```yaml
metricRelabelConfigs:
  - action: keep
    source_labels: [__name__]
    regex: 'karpenter_(nodeclaims_disrupted_total|nodepools_allowed_disruptions|nodepools_nodes_consuming_budgets|nodepools_(limit|usage)|consolidation_(score|moves_total)|voluntary_disruption_(eligible_nodes|decisions_total)|scheduler_(unschedulable_pods_count|pending_pods_by_effective_zone_count)|cluster_utilization_percent|cluster_state_(synced|node_count)|nodes_(created_total|terminated_total|total_pod_requests|total_daemon_requests|allocatable)|nodeclaims_(created_total|terminated_total)|cloudprovider_errors_total|build_info)'
```

대가는 새 메트릭을 자동으로 못 받는 것 — 업그레이드 후 §5.1로 훑습니다. blocklist로 가야 한다면 최소한 파드 축은 막습니다.

### 4.2 버리는 것 — 파드 단위 6종

```yaml
- action: drop
  source_labels: [__name__]
  regex: 'karpenter_pods_(state|unstarted_time_seconds|unbound_time_seconds)'
- action: drop
  source_labels: [__name__]
  regex: 'karpenter_pods_provisioning_.*'
```

버려도 잃는 게 거의 없습니다 — 근거 셋:

- 파드 단위 상태는 kube-state-metrics가 이미 더 잘 냅니다(대체재는 §4.5).
- `nodepool`·`capacity_type` 라벨은 노드 단위로도 얻습니다(§4.5).
- ALPHA 3종은 SLO에 못 씁니다 — Help의 *"this calculated from a point in memory, not by the pod creation timestamp"* 대로 재시작 시 기준점이 리셋됩니다([09 §4.5]({{< relref "09-metrics-logs-events.md" >}})).

### 4.3 남기는 것

[09 §2]({{< relref "09-metrics-logs-events.md" >}})의 여섯 개가 핵심 — 전부 NodePool·전역 축이라 시리즈가 묶입니다.

| 남길 것 | 시리즈 규모 |
|---|---|
| `karpenter_nodeclaims_disrupted_total` | NP × reason × capacity_type |
| `karpenter_nodepools_allowed_disruptions` | NP × 3 |
| `karpenter_nodepools_nodes_consuming_budgets` | NP × 3 |
| `karpenter_scheduler_unschedulable_pods_count` | 1 |
| `karpenter_scheduler_pending_pods_by_effective_zone_count` | zone 수 |
| `karpenter_consolidation_score` | NP × decision × policy |
| `karpenter_cluster_utilization_percent` | R |

### 4.4 판단이 갈리는 것 — 노드 단위 7종

`6NR + N`이라 200노드·R=6이면 7,400 — 무시할 양은 아니지만 churn이 낮고 대체재가 없습니다. `_total_pod_requests - _total_daemon_requests`는 "노드를 줄일 수 있는가"의 유일한 직접 근거입니다([08 §5]({{< relref "08-disruption-budgets.md" >}})).

줄이려면 메트릭 자체보다 `resource_type`을 자르는 쪽이 낫습니다 — `hugepages-*`를 안 쓰면 그 두 축이 통째로 낭비입니다.

```yaml
- action: drop
  source_labels: [__name__, resource_type]
  regex: 'karpenter_nodes_.*;hugepages-.*'
```

### 4.5 버린 뒤 무엇이 깨지나

drop하면 그 메트릭을 쓰던 대시보드·알림이 빈 결과를 냅니다 — 에러가 아니라 침묵입니다. 버리기 전에 대체재를 확인합니다.

| 잃는 것 | 대체 |
|---|---|
| 파드별 Pending 시간 | `kube_pod_status_phase{phase="Pending"}` |
| 파드별 Ready 여부 | `kube_pod_container_status_ready` |
| NodePool별 파드 분포 | `karpenter_nodes_total_pod_requests` (노드 축) |
| 파드 startup 지연 | kubelet `kubelet_pod_start_duration_seconds` |

대체 안 되는 것 하나 — `karpenter_pods_state`의 `capacity_type`은 KSM이 직접 주지 않습니다. 필요하면 조인합니다.

```promql
kube_pod_info * on(node) group_left(label_karpenter_sh_capacity_type) kube_node_labels
```

조인 비용이 있으므로 spot 비율을 파드 단위로 상시 감시해야 할 때만 `karpenter_pods_state`를 남깁니다.

## 5. 실측 방법

### 5.1 먼저 소스에서 잰다 — 수집을 켜기 전에

순서가 중요합니다 — 붙이기 전에 얼마인지 재고 시작합니다. 엔드포인트를 직접 긁으면 백엔드에 아무것도 넣지 않고 시리즈 수를 셀 수 있습니다.

```bash
kubectl -n karpenter port-forward svc/karpenter 8080:8080 &

# 메트릭별 시리즈 수 — 이 순위가 곧 비용 순위다
curl -s localhost:8080/metrics \
  | grep -v '^#' | cut -d'{' -f1 | sort | uniq -c | sort -rn | head -20

# 총 시리즈 수
curl -s localhost:8080/metrics | grep -vc '^#'

# 파드 축이 차지하는 비중
curl -s localhost:8080/metrics | grep -c '^karpenter_pods_'
```

이 숫자가 Datadog에서는 그대로 custom metric 개수, VM·Prometheus에서는 시리즈 수입니다. drop 규칙도 이 출력이 근거 — 상위 5개 비중이 무엇부터 버릴지를 정합니다.

### 5.2 켠 뒤에는 백엔드에서 잰다

```promql
count({__name__=~"karpenter_.*"}) by (__name__)                            # 메트릭별
count({__name__=~"karpenter_pods_.*"}) / count({__name__=~"karpenter_.*"}) # 파드 축 비중
```

VM이면 지표도 봅니다.

```promql
sum(max_over_time(vm_cache_entries{type="storage/hour_metric_ids"}[24h]))  # active series
sum(increase(vm_new_timeseries_created_total[24h]))                        # churn
```

churn은 배포일과 비배포일을 나눠서 봐야 의미가 있습니다 — 파드 축 제거 전후 이 값의 변화가 이 문서의 결론을 검증합니다. 메트릭·라벨별 분해는 vmui의 Cardinality Explorer(`/vmui/#/cardinality`)가 보여줍니다. Prometheus는 `/api/v1/status/tsdb`의 `seriesCountByMetricName`이 같은 답을 줍니다(기본 상위 10개, `limit`으로 확대).

### 5.3 적용 순서

1. §5.1로 소스에서 잽니다 — 아직 아무 비용도 안 듭니다
2. §4의 keep-list를 넣고 수집을 켭니다
3. §5.2로 백엔드에서 재서 예상과 맞는지 확인합니다
4. 알림·대시보드가 keep-list 안의 메트릭만 쓰는지 점검합니다(§4.5)
5. 배포가 있는 날 churn을 다시 잽니다

2번을 건너뛰고 켠 다음 줄이는 순서는 Datadog에서 특히 나쁩니다 — **그 달 청구는 이미 발생한 뒤**입니다.

## 6. 함정 넷

**① Datadog OpenMetrics는 2000개에서 경고 없이 자릅니다** — `max_returned_metrics` 기본값. 잘린 것과 원래 없는 것이 대시보드에서 구분되지 않으니 붙이자마자 §5로 상한에 닿는지 봅니다.

**② MWL은 유입을 줄이지 않습니다.** allowlist는 indexed만 줄입니다 — ingested 과금이 별도라는 전제로 계약을 봅니다.

**③ Prometheus의 한도는 전부 기본 0입니다.** 켜 두지 않으면 카디널리티 사고가 스크랩 실패 대신 메모리 증가로만 나타납니다. 발견이 늦습니다. 켤 때는 초과 시 스크랩 전체가 실패한다는 점을 감수해야 합니다.

**④ `karpenter_nodes_*`의 라벨 수는 코어보다 많습니다.** `WellKnownLabels`가 런타임에 확장되므로(`metrics/node/controller.go:62-64`) EKS는 `instance_family`·`instance_size` 등이 더 붙습니다 — 코어 소스만으로 계산한 시리즈 수는 과소추정입니다.

## 7. 근거

메트릭 목록·라벨은 [09 §8]({{< relref "09-metrics-logs-events.md" >}})의 근거를 그대로 씁니다(`kubernetes-sigs/karpenter` v1.14.0-6-gac7a021e). 추가로:

- `resource_type` 축이 노드의 실제 `ResourceList`에서 나옵니다 — `pkg/controllers/metrics/node/controller.go`의 `getNodeLabelsWithResourceType`
- 메트릭 포트 기본값 8080 — `pkg/operator/options/options.go:114`
- **Datadog** custom metric 정의·과금 단위·무료 분량 — [Custom Metrics](https://docs.datadoghq.com/metrics/custom_metrics/), [Custom Metrics Billing](https://docs.datadoghq.com/account_management/billing/custom_metrics/)
- **Datadog** OpenMetrics 수집분이 custom metric이라는 문장과 `max_returned_metrics` 기본 2000 — [Kubernetes Prometheus and OpenMetrics metrics collection](https://docs.datadoghq.com/containers/kubernetes/prometheus/)
- **Datadog** MWL의 ingested/indexed 분리 — [Metrics without Limits™](https://docs.datadoghq.com/metrics/metrics-without-limits/)
- **VM** active series 정의·churn·`indexdb` 팽창 — [VictoriaMetrics FAQ](https://docs.victoriametrics.com/victoriametrics/faq/)
- **VM** 측정 지표명과 Cardinality Explorer — [Understand Your Setup Size](https://docs.victoriametrics.com/guides/understand-your-setup-size/)
- **VM** relabel 적용 단계와 vmagent 플래그 — [Relabeling cookbook](https://docs.victoriametrics.com/victoriametrics/relabeling/)
- **Prometheus** `sample_limit`·`label_limit`·`target_limit` 기본값과 relabel 적용 시점 — [Configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
- **Prometheus** `/api/v1/status/tsdb` 반환 필드 — [HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/)

**확인하지 못한 것** — §1.2 시리즈 수는 예시 계산이지 실측이 아닙니다. Datadog 초과 단가는 계약별로 다릅니다. VictoriaMetrics Cloud 상용 과금은 조사하지 않았습니다(자체 운영 전제).
