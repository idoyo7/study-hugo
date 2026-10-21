---
title: "부록 · 같은 AZ 분할을 Prometheus로 하면"
linkTitle: "부록 B Prometheus AZ 분할"
description: "05편의 vmagent AZ 분할을 Prometheus Operator로 옮기면 어떻게 되는지 설계 수준에서 검토합니다. Topology 샤딩, scrapeClass relabel, DaemonSet agent 세 경로를 05편의 fallback·외부 라벨·검증 규칙과 대조하고, 저장소가 AZ별로 갈라질 때 전역 조회와 알림 평가가 어디로 가야 하는지 정리합니다."
weight: 91
date: 2026-10-22
lastmod: 2026-10-22
url: "/monitoring/victoriametrics-operations/a2-prometheus-az-split/"
---

# 부록 · 같은 AZ 분할을 Prometheus로 하면

[05 vmagent AZ 분할]({{< relref "/observability/metrics/victoriametrics/operations/05-vmagent-az-split/index.md" >}})은 vmagent 두 대를 AZ a/c에 한 대씩 두고 Node 메타라벨로 담당 타깃을 나눴습니다. 같은 분할을 Prometheus로 해야 한다면 어떤 재료가 있고 어디가 달라지는지 정리합니다. 우리 환경에 적용한 구성은 아니며, Prometheus Operator의 문서와 설정 생성 코드를 읽고 05편의 결정과 대조한 설계 검토입니다.

Prometheus로 AZ 분할을 하는 길은 셋입니다.

| 경로 | 무엇이 타깃을 나누나 | 05편과의 거리 | 전제 |
|---|---|---|---|
| A. Operator Topology 샤딩 | `shardingStrategy.mode: Topology`가 zone 목록대로 샤드를 배정 | 선언 한 줄로 끝나지만 fallback 규칙이 05편과 반대 | Operator 0.91 이상, feature gate `PrometheusTopologySharding` |
| B. AZ별 Prometheus CR + scrapeClass | AZ마다 CR을 두고 기본 scrapeClass의 relabel로 keep/drop | 05편의 규칙을 그대로 옮길 수 있음 | Operator 0.76 이상(scrapeClass의 `attachMetadata`) |
| C. DaemonSet agent | 노드마다 agent를 띄워 같은 노드의 파드만 수집 | AZ 분할을 넘어 노드 분할 | Operator 0.77 이상, PodMonitor만 |

세 경로 모두 수집 쪽 이야기입니다. full Prometheus를 AZ별로 두면 TSDB도 AZ별로 갈라지므로, 저장 이후를 어떻게 할지는 경로와 별개로 정해야 합니다. 뒤에서 따로 다룹니다.

## 05편의 재료가 Prometheus에서는 무엇인가

vmagent에서 쓴 장치는 Prometheus와 Operator에 대응물이 있습니다. 이름만 다른 것이 대부분이고, 의미가 달라지는 항목은 둘입니다.

| 05편(vmagent) | Prometheus / Operator | 비고 |
|---|---|---|
| `promscrape.kubernetes.attachNodeMetadataAll` | `kubernetes_sd_configs.attach_metadata.node: true` | pod·endpoints·endpointslice 역할에서 Node 라벨을 `__meta_kubernetes_node_label_*`로 붙임. Nodes의 list/watch 권한 필요 |
| VMAgent 리소스 하나에 relabel 규칙 | ServiceMonitor·PodMonitor의 `attachMetadata.node`, 또는 scrapeClass | 모니터마다 켜거나, Prometheus CR의 기본 scrapeClass로 한 번에 켬 |
| 타깃 `keep`/`drop` relabel | scrapeClass `relabelings` | 기본 클래스의 규칙은 ServiceMonitor·PodMonitor·Probe·ScrapeConfig 전부에 들어가고, 모니터 자체 규칙보다 앞에 놓임 |
| agent의 `nodeAffinity` | Prometheus CR의 `nodeSelector`·`affinity` | Topology 샤딩은 Operator가 zone 라벨 nodeSelector를 샤드마다 넣어 줌 |
| 두 agent의 외부 라벨을 같게 | `externalLabels`·`replicaExternalLabelName` | Operator는 `prometheus_replica`에 파드 이름을 넣는 것이 기본. 샤드 라벨은 별도 |
| vmstorage의 중복 제거 | Thanos Query `--query.replica-label` 또는 VM 저장소의 dedup | Thanos Query는 기본값이 비어 있어 직접 지정해야 함 |

의미가 달라지는 첫 항목은 중복 제거입니다. vmagent 두 대가 같은 타깃을 잠깐 겹쳐 수집해도 vmstorage가 외부 라벨만 같으면 한 벌로 접었습니다. Prometheus가 각자 TSDB를 가지면 그 접는 일을 조회 계층이 맡습니다. 둘째는 fallback입니다. 경로 A는 zone을 판정하지 못한 타깃을 버리고, 경로 B는 05편처럼 한쪽이 거둬 갈 수 있습니다.

## 경로 A · Operator Topology 샤딩

Operator의 `shards`는 원래 `__address__`를 `hashmod`로 나눠 샤드 번호와 같은 타깃만 남기는 방식이었습니다. 주소 해시라 AZ를 모릅니다. 0.91.0부터 Topology 모드가 들어와 zone 목록을 받으면 샤드를 zone에 배정합니다. 0.92.0에서 feature gate `PrometheusTopologySharding`이 Beta로 올라가 기본으로 켜져 있습니다.

```yaml
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: workload
spec:
  shards: 2
  shardingStrategy:
    mode: Topology
    topology:
      values: ["ap-northeast-2a", "ap-northeast-2c"]
  scrapeClasses:
    - name: default
      default: true
      attachMetadata:
        node: true
```

설정 생성 코드가 하는 일은 이렇습니다.

- 샤드 번호를 zone 수로 나눈 나머지가 그 샤드의 zone입니다. `shards: 2`에 zone이 둘이면 샤드 0은 a, 샤드 1은 c입니다. `shards: 4`면 zone마다 두 샤드가 생기고, 같은 zone 안에서는 다시 주소 해시로 나눕니다.
- 타깃의 zone은 `__meta_kubernetes_endpointslice_endpoint_zone`을 먼저 보고, Kubernetes 1.35 이상에서 파드 토폴로지 라벨을 지원하면 `__meta_kubernetes_pod_label_topology_kubernetes_io_zone`, 아니면 `__meta_kubernetes_node_label_topology_kubernetes_io_zone`을 읽습니다. 05편이 쓴 Node 라벨은 마지막 순서입니다.
- 읽은 값을 `__tmp_topology`에 담고, 이 라벨이 비면 `keep` 규칙에서 떨어집니다. **zone을 판정하지 못한 타깃은 버려집니다.**
- 샤드 파드에는 zone 라벨 `nodeSelector`가 붙습니다. 수집 필터와 파드 배치를 함께 맞춰야 한다는 05편의 조건을 Operator가 대신 맞춰 줍니다. `affinity`나 topologySpreadConstraints는 넣지 않습니다.
- 0.91.0에 zone 값을 외부 라벨로 붙이는 변경(#8519)도 들어갔습니다.

### 05편의 fallback과 반대 방향

05편은 기존 agent가 AZ c만 `drop`하고 나머지를 전부 거두게 했습니다. 수명이 짧은 노드가 파드보다 먼저 지워져 zone을 못 읽는 타깃, VMStaticScrape·VMProbe처럼 Node 메타데이터가 없는 타깃이 어디에도 속하지 못하는 일을 막으려는 규칙이었습니다. 실제로 먼저 적용한 클러스터에서 그런 타깃이 중복 1건으로 잡혔고, 누락 대신 중복을 택한 설계가 맞았다고 기록했습니다.

Topology 모드는 그 타깃을 버립니다. 노드 라벨을 읽는 경로면 Node 객체가 먼저 사라진 파드는 마지막 몇 번의 scrape에서 빠집니다. Probe와 정적 타깃은 zone이 없으니 처음부터 수집되지 않습니다. 이런 타깃은 Topology 샤딩을 쓰지 않는 Prometheus를 하나 더 두거나, 모니터 쪽 relabel로 `__tmp_topology`를 채워 줘야 합니다. 후자는 Operator 내부 임시 라벨에 기대는 방법이라 버전이 바뀌면 깨질 수 있습니다.

### 샤드 수와 외부 라벨

샤드 수는 zone 수의 배수로 둬야 zone마다 같은 수의 샤드가 생깁니다. `shards: 3`에 zone이 둘이면 a에 둘, c에 하나가 됩니다. zone을 나중에 추가하면 샤드와 zone의 대응이 전부 바뀌어 모든 타깃의 담당 샤드가 이동합니다. 05편의 "두 agent를 한 번에 바꾸는 전환"과 같은 상황이 zone 추가 때마다 생깁니다.

zone 외부 라벨은 05편이 겪은 문제를 그대로 불러올 수 있습니다. 검증용 zone 라벨 하나가 시리즈 정체성을 바꿔 KEDA 트리거가 옛·새 시리즈를 더했고, 라벨 개수 상한에 걸린 시리즈도 있었습니다. Operator가 zone 라벨을 붙이는 동작이 기본인지, 끌 수 있는지는 쓰는 버전의 API 레퍼런스에서 확인한 뒤 결정해야 합니다. 저장 시리즈의 라벨을 바꾸지 않는 것이 05편의 결론이었습니다.

## 경로 B · AZ별 Prometheus CR과 scrapeClass

05편의 규칙을 그대로 옮기려면 Topology 모드 대신 AZ마다 Prometheus CR을 하나씩 두고, 기본 scrapeClass에 필터를 넣습니다. Topology 모드가 없는 Operator 버전에서도 됩니다.

```yaml
# AZ a · 기존 역할: AZ c만 drop, 나머지는 fallback으로 수집
spec:
  nodeSelector:
    topology.kubernetes.io/zone: ap-northeast-2a
  externalLabels:
    cluster: workload
  scrapeClasses:
    - name: az-a
      default: true
      attachMetadata:
        node: true
      relabelings:
        - sourceLabels: [__meta_kubernetes_node_label_topology_kubernetes_io_zone]
          regex: ap-northeast-2c
          action: drop
---
# AZ c · 새 역할: AZ c 타깃만 keep
spec:
  nodeSelector:
    topology.kubernetes.io/zone: ap-northeast-2c
  externalLabels:
    cluster: workload
  scrapeClasses:
    - name: az-c
      default: true
      attachMetadata:
        node: true
      relabelings:
        - sourceLabels: [__meta_kubernetes_node_label_topology_kubernetes_io_zone]
          regex: ap-northeast-2c
          action: keep
```

두 CR이 같은 ServiceMonitor·PodMonitor를 선택합니다. 기본 scrapeClass의 `relabelings`는 선택된 모든 모니터와 Probe·ScrapeConfig에 들어가고, 모니터 자체의 `relabelings`보다 앞에 놓입니다. 모니터를 AZ별로 복제하지 않아도 됩니다. 모니터가 `scrapeClassName`을 따로 지정하면 기본 클래스를 쓰지 않으므로, 그런 모니터가 있는지 먼저 확인해야 합니다.

Probe와 정적 ScrapeConfig는 Node 메타데이터가 없어 zone 라벨이 빕니다. AZ a 쪽은 `drop` 규칙이라 그대로 수집하고, AZ c 쪽은 `keep`에서 떨어집니다. 05편의 표와 같은 분담이 됩니다.

scrapeClass의 `relabelings`는 Operator 0.73.0, `attachMetadata`는 0.76.0부터입니다. 그 아래 버전이면 ServiceMonitor·PodMonitor마다 `attachMetadata.node`를 켜고 `relabelings`를 넣어야 하는데, 모니터가 AZ별 CR에 공유되므로 결국 모니터를 AZ별로 복제하게 됩니다. 이 경우 Topology 모드로 올라가는 편이 설정이 적습니다.

### 외부 라벨은 같게, 샤드 구분은 조회에서

05편은 두 agent의 외부 라벨을 같은 값으로 맞췄습니다. 경로 B도 두 CR의 `externalLabels`를 같게 둡니다. Operator가 붙이는 `prometheus` 라벨(네임스페이스/이름)과 `prometheus_replica`는 CR마다 달라지므로, 조회 계층에서 이 둘을 replica 라벨로 지정해 접어야 중복 수집 구간에서 시리즈가 둘로 보이지 않습니다. Thanos Query는 `--query.replica-label`의 기본값이 비어 있습니다.

AZ별로 수집했다는 사실을 저장 시리즈에 남길지는 별개의 결정입니다. 05편은 남기지 않았습니다. 수집 방향은 각 Prometheus의 타깃 목록으로 확인할 수 있습니다.

## 저장소가 갈라진 뒤의 조회와 알림

vmagent는 수집만 하고 저장은 중앙 vmstorage에 남겼습니다. 분할해도 쿼리는 전과 같은 곳을 봤습니다. full Prometheus를 AZ별로 두면 서비스 하나의 시계열이 두 TSDB에 나뉩니다. 서비스 전체 오류율처럼 AZ를 가로지르는 식은 어느 한쪽 Prometheus에서는 계산할 수 없습니다. [Prometheus와 VictoriaMetrics 비교]({{< relref "/observability/metrics/prometheus-vs-victoriametrics/index.md" >}})에서 샤딩하면 수집 이후의 일도 나눠야 한다고 적은 그 문제입니다.

{{< flow src="_flow/1-az별-prometheus와-전역-계층.json" />}}

| 할 일 | vmagent 분할(05편) | Prometheus AZ 분할 |
|---|---|---|
| 전역 조회 | vmselect가 그대로 | Thanos Query가 각 샤드의 사이드카를 묶고 replica 라벨로 중복 제거 |
| AZ를 가로지르는 알림·기록 규칙 | vmalert가 그대로 | Thanos Ruler로 옮김. 각 Prometheus의 로컬 규칙은 자기 AZ만 봄 |
| 장기 보관 | vmstorage | 사이드카 → 객체 저장소, 또는 remote write |
| 분할 뒤 남는 AZ 간 전송 | remote write와 저장 클러스터 내부 | 조회 계층 → 사이드카 읽기, 사이드카 → 객체 저장소 업로드 |

조회 계층이 한쪽 AZ에 있으면 다른 AZ 샤드를 읽는 쿼리는 경계를 넘습니다. scrape 응답처럼 30초마다 전부 흐르는 양은 아니고 대시보드와 규칙 평가가 읽는 만큼입니다. 다만 Thanos Ruler가 짧은 주기로 넓은 범위를 평가하면 그 양이 scrape 때와 비슷해질 수 있으므로, 분할 전에 규칙이 읽는 데이터 양을 먼저 봐야 합니다.

### agent 모드로 가면 05편과 같아진다

조회 계층을 새로 두고 싶지 않으면 Prometheus를 `--agent`로 돌립니다. Operator에서는 PrometheusAgent CR입니다. 로컬 조회·규칙·알림이 꺼지고, WAL이 remote write 뒤에 비워지며, 원격지가 끊기면 두 시간 남짓만 버팁니다. 그 대신 저장소는 하나로 남습니다.

이렇게 되면 05편의 구성과 수집기 이름만 다릅니다. 남는 AZ 간 전송도 remote write 구간뿐이고, 05편의 추정으로는 수집·저장 경로의 AZ 간 전송 가운데 약 13%가 그 구간이었습니다. 받는 쪽이 Thanos Receive면 hashring의 `az` 필드와 ketama 알고리즘(0.32 이상, 실험 기능)으로 복제본을 zone에 나눠 둘 수 있습니다. 이는 복제본 배치이지 쓰기 경로를 같은 AZ로 모으는 기능은 아닙니다. vminsert → vmstorage 구간이 수집 위치와 무관하게 AZ를 넘었던 것과 같은 성격입니다.

## HA는 샤드 안에서, AZ 안에서

05편은 새 agent가 죽어도 기존 agent가 AZ c를 대신 긁는 장애 전환은 없다고 적었습니다. Prometheus도 같습니다. HA를 원하면 샤드마다 `replicas: 2`를 두되 두 replica가 같은 AZ에 있어야 합니다. Topology 모드는 샤드 단위로 zone nodeSelector를 넣으므로 같은 샤드의 replica는 자동으로 같은 zone에 뜹니다. 경로 B는 CR의 `nodeSelector`가 그 역할을 합니다.

replica를 AZ 간에 펼치면 한쪽 replica는 항상 AZ를 넘어 수집합니다. 분할로 줄인 양을 HA가 다시 채우는 셈이라, 05편의 agent 가용성 항목(해당 AZ에서 다시 뜰 노드 여유, 담당 범위의 수집 중단 알림)을 그대로 가져가는 편이 맞습니다.

## 경로 C · DaemonSet agent

Operator 0.77.0부터 PrometheusAgent에 `mode: DaemonSet`이 있습니다. feature gate는 `PrometheusAgentDaemonSetFeature`입니다. 노드마다 agent가 떠서 같은 노드의 파드만 수집하므로 scrape 응답은 AZ는 물론 노드도 넘지 않습니다. 05편이 줄이려던 타깃 → agent 구간이 노드 안에서 끝납니다.

제약이 큽니다. PodMonitor만 지원하고 ServiceMonitor는 EndpointSlice 기반의 실험 지원입니다. Probe와 ScrapeConfig는 선택되지 않습니다. `replicas`·`shards`·`storage`를 쓸 수 없고, 노드 수만큼 agent가 뜨니 remote write 연결과 자기감시 시리즈도 노드 수만큼 늘어납니다. ServiceMonitor 중심으로 운영하는 환경에는 맞지 않고, 노드가 많고 파드당 응답이 큰 클러스터에서 scrape 전송을 끝까지 줄여야 할 때 검토할 경로입니다.

## 전환 검증은 05편 표를 그대로 쓴다

05편의 검증 표는 수집기가 바뀌어도 항목이 같습니다. Prometheus에서 달라지는 확인 방법만 적습니다.

| 확인 항목 | Prometheus에서 보는 곳 |
|---|---|
| 수집 범위 | 각 샤드의 `/api/v1/targets`로 중복·누락 대조. Topology 모드는 zone 없는 타깃이 어느 샤드에도 없는지 따로 확인 |
| 수집량 | `scrape_samples_scraped`·`prometheus_remote_storage_samples_total` 합이 전환 전후 비슷한지 |
| 외부 라벨 | 두 CR의 `externalLabels`가 같고, `prometheus`·`prometheus_replica`가 조회 계층의 replica 라벨에 들어 있는지 |
| 라벨 변경 | zone 외부 라벨이 붙었다면 KEDA·대시보드 쿼리의 lookback에서 옛·새 시리즈가 합산되지 않는지 |
| 전역 조회 | Thanos Query의 `--query.replica-label` 설정, 각 사이드카의 연결 상태 |
| 규칙 평가 | AZ를 가로지르는 규칙이 Thanos Ruler로 옮겨졌는지, 로컬 규칙에 남아 반쪽 값을 내지 않는지 |
| 샤드 가용성 | 샤드별 `up` 집계와 zone 안 노드 여유 |

## 05편과 다른 결정 네 가지

- 분류되지 않은 타깃을 **버릴지 거둘지**. Topology 모드는 버리고, 05편과 경로 B는 거둡니다. Probe와 정적 타깃이 있으면 이 차이가 곧바로 누락이 됩니다.
- **중복 제거의 위치**. vmstorage가 하던 일을 Thanos Query가 하며, replica 라벨을 직접 지정해야 합니다.
- **규칙 평가의 위치**. AZ를 가로지르는 규칙은 전역 계층으로 옮겨야 합니다. agent 모드면 이 결정이 사라집니다.
- **zone 추가 비용**. Topology 모드는 zone을 추가하면 샤드 배정이 전부 바뀝니다. 경로 B는 CR을 하나 더 두고 기존 `drop` 목록에 zone을 추가하면 됩니다.

## 출처

- Prometheus 설정 레퍼런스, `kubernetes_sd_configs`의 `attach_metadata` — [prometheus.io/docs/prometheus/latest/configuration/configuration/](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
- Prometheus agent 모드 — [prometheus.io/docs/prometheus/latest/prometheus_agent/](https://prometheus.io/docs/prometheus/latest/prometheus_agent/)
- Prometheus Operator CHANGELOG(scrapeClasses 0.72.0 #6199 · relabelings 0.73.0 #6379 · attachMetadata 0.76.0 #6756 · DaemonSet 0.77.0 #6879 · Topology 0.91.0 #8486/#8519/#8538 · 0.92.0 Beta 승격) — [github.com/prometheus-operator/prometheus-operator/blob/main/CHANGELOG.md](https://github.com/prometheus-operator/prometheus-operator/blob/main/CHANGELOG.md)
- Prometheus Operator API 레퍼런스(`shardingStrategy`, `scrapeClasses`, `replicaExternalLabelName`) — [prometheus-operator.dev/docs/api-reference/api/](https://prometheus-operator.dev/docs/api-reference/api/)
- Prometheus Operator 설정 생성 코드, Topology 샤드 배정과 scrapeClass relabel 순서 — [pkg/prometheus/promcfg.go](https://github.com/prometheus-operator/prometheus-operator/blob/main/pkg/prometheus/promcfg.go)
- ScrapeClass 문서와 제안서 — [prometheus-operator.dev/docs/developer/scrapeclass/](https://prometheus-operator.dev/docs/developer/scrapeclass/)
- PrometheusAgent DaemonSet 모드 제안서 — [prometheus-operator.dev/docs/proposals/accepted/agent-daemonset](https://prometheus-operator.dev/docs/proposals/accepted/agent-daemonset)
- Thanos Receive hashring의 `az`와 ketama — [thanos.io/tip/components/receive.md](https://thanos.io/tip/components/receive.md/)
- Thanos Query `--query.replica-label` — [thanos.io/tip/components/query.md](https://thanos.io/tip/components/query.md/)

버전과 PR 번호는 2026-10-21에 CHANGELOG와 코드에서 확인한 값입니다. Topology 모드의 Alpha/Beta 표기는 API 레퍼런스 안에서도 필드와 enum 설명이 서로 달라, 쓰는 버전의 feature gate 목록에서 다시 확인해야 합니다.

> 관련 문서: [05 vmagent AZ 분할]({{< relref "/observability/metrics/victoriametrics/operations/05-vmagent-az-split/index.md" >}}) · [부록 A Pod 네트워크 RTT]({{< relref "/observability/metrics/victoriametrics/operations/a1-pod-network-rtt/index.md" >}}) · [Prometheus와 VictoriaMetrics 비교]({{< relref "/observability/metrics/prometheus-vs-victoriametrics/index.md" >}}) · [sidecar와 receive]({{< relref "/observability/metrics/prometheus-thanos/03-sidecar-vs-receive.md" >}})
