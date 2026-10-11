---
title: "08 vmagent AZ 분할 — 존마다 수집기 하나씩"
date: 2026-10-11
lastmod: 2026-10-11
weight: 8
url: "/homelab/08-vmagent-az-split/"
---

# vmagent AZ 분할 — 존마다 수집기 하나씩, 라벨셋은 그대로

hub 클러스터의 vmagent는 node1에 한 대가 떠서 세 노드의 타깃을 전부 scrape했습니다. [06 글]({{< relref "/platform/homelab/06-az-affinity/index.md" >}})에서 node1에 `ap-northeast-2a`, node2에 `ap-northeast-2c` 존 라벨을 붙였으니, 수집도 존마다 나눠 봤습니다. 2026-10-11에 적용했고 설계는 [vmagent AZ 분할로 AZ 간 scrape 전송 줄이기]({{< relref "/observability/metrics/victoriametrics/operations/05-vmagent-az-split/index.md" >}})를 그대로 옮긴 것입니다.

두 워커는 같은 스위치에 물려 있어 존을 건너도 요금이 붙지 않습니다. 아끼는 돈은 없고, 얻은 것은 같은 구성을 작은 클러스터에서 처음부터 끝까지 적용해 본 경험입니다.

## 구성

VMAgent 리소스를 둘로 나눴습니다.

| VMAgent | 배치 | 맡는 타깃 |
|---|---|---|
| `vm` (기존, 차트가 만든다) | node1, 2a | 노드 존이 2c가 아닌 전부. 존 라벨이 없는 master1, apiserver, VMScrapeConfig 포함 |
| `vm-2c` (추가) | node2, 2c | 노드 존이 2c인 pod·service·node 타깃 |

두 agent 모두 `promscrape.kubernetes.attachNodeMetadataAll`을 켭니다. 이 플래그가 있어야 타깃이 올라간 노드의 라벨이 `__meta_kubernetes_node_label_*`로 붙고, relabel 규칙이 그 값으로 타깃을 고를 수 있습니다.

기존 `vm`은 2c만 버리는 catch-all입니다. 차트 values에 아래를 더했습니다.

```yaml
vmagent:
  spec:
    extraArgs:
      promscrape.kubernetes.attachNodeMetadataAll: "true"
    affinity:
      nodeAffinity:
        requiredDuringSchedulingIgnoredDuringExecution:
          nodeSelectorTerms:
            - matchExpressions:
                - key: topology.kubernetes.io/zone
                  operator: In
                  values: [ap-northeast-2a]
    podScrapeRelabelTemplate:
      - action: drop
        sourceLabels: [__meta_kubernetes_node_label_topology_kubernetes_io_zone]
        regex: ap-northeast-2c
    # serviceScrapeRelabelTemplate, nodeScrapeRelabelTemplate 도 같은 규칙
```

`vm-2c`는 차트 밖의 매니페스트로 따로 뒀습니다. 같은 자리에 `keep` 규칙을 쓰고, 노드 메타데이터가 없는 종류는 전부 버립니다.

```yaml
apiVersion: operator.victoriametrics.com/v1beta1
kind: VMAgent
metadata:
  name: vm-2c
  namespace: victoria-metrics
spec:
  image:
    tag: v1.152.0
  scrapeInterval: 20s
  selectAllByDefault: true
  externalLabels:
    cluster: hub
    prometheus: victoria-metrics/vm
  extraArgs:
    promscrape.streamParse: "true"
    promscrape.kubernetes.attachNodeMetadataAll: "true"
  # remoteWrite 와 2c nodeAffinity 는 생략
  podScrapeRelabelTemplate:
    - action: keep
      sourceLabels: [__meta_kubernetes_node_label_topology_kubernetes_io_zone]
      regex: ap-northeast-2c
  # serviceScrape, nodeScrape 도 keep
  staticScrapeRelabelTemplate:
    - action: drop
      sourceLabels: [__address__]
      regex: .*
  # probeScrape, scrapeConfig 도 drop
```

차트 밖 리소스는 차트 값을 물려받지 않습니다. 이미지 태그와 `scrapeInterval`을 직접 적었고, 차트 버전을 올릴 때 태그를 같이 올려야 합니다.

## 라벨셋을 건드리지 않는다

05 글에서 가장 비싸게 배운 것이 이 부분이라 세 가지를 그대로 따랐습니다.

operator는 VMAgent마다 `prometheus=<네임스페이스>/<이름>` 외부 라벨을 넣습니다. 그대로 두면 node2 타깃의 시리즈가 `victoria-metrics/vm-2c`를 달고 전부 새 시리즈가 됩니다. `vm-2c`의 `externalLabels`에 `prometheus: victoria-metrics/vm`을 직접 적어 기존 값과 맞췄습니다.

존을 시리즈 라벨로 붙이지 않았습니다. 존은 타깃을 고르는 데만 쓰고 relabel이 끝나면 사라집니다.

존을 알 수 없는 타깃에 표시를 다는 `az_bucket=fallback` 규칙도 넣지 않았습니다. hub에서는 master1에 존 라벨이 없어, 이 규칙을 넣으면 master1의 시리즈 전체에 라벨이 하나씩 늘어납니다.

전환 중에는 옛 파드와 새 파드가 같은 타깃을 잠깐 함께 긁습니다. 라벨셋이 같으니 vmstorage와 vmselect의 `dedup.minScrapeInterval: 30s`가 한 샘플로 합칩니다.

## 적용 결과

PR을 머지하고 Argo CD가 반영한 뒤 약 2분 지나 확인했습니다.

| 항목 | 전 | 후 |
|---|---|---|
| vmagent 파드 | node1에 1개 | node1에 `vm`, node2에 `vm-2c` |
| `count(up{cluster="hub"})` | 42 | 44 |
| `count by (prometheus)(up)`의 값 종류 | 1 | 1 |
| 두 agent의 up 타깃 합과 `count(up==1)` | - | 42와 42 |
| remoteWrite 드롭 | 0 | 0 |

타깃이 2개 늘어난 것은 `vm-2c` 자신과 그 config-reloader입니다. `vm-2c`가 맡은 타깃은 7개로, node2의 kubelet 네 종류(kubelet, cadvisor, probes, resources)와 node-exporter, 자기 자신 둘입니다. 나머지 37개는 `vm`이 맡습니다.

적용 전에는 node2에 있는 서비스 파드가 `vm-2c`로 더 넘어갈 줄 알았는데, 메트릭을 내놓는 파드는 대부분 node1에 있었습니다. 타깃이 어느 agent로 가는지는 서비스가 아니라 파드가 뜬 노드가 정합니다. 예상을 세울 때 서비스 이름으로 세면 틀립니다.

## 남는 것

vminsert와 vmstorage는 전부 node1에 있습니다. `vm-2c`의 remote write는 여전히 존을 건넙니다. 존 안에 머무는 구간은 scrape뿐이고, 원래 설계가 줄이려던 것도 압축되지 않은 scrape 응답 쪽입니다.

node2가 내려가면 `vm-2c`도 같이 내려갑니다. 그때는 긁을 2c 타깃도 없으니 수집 공백이 따로 생기지는 않습니다. node1이 내려가면 저장소까지 함께 내려가므로 이 분할과 무관하게 메트릭이 끊깁니다.

## 같이 고친 것

기준값을 뽑다가 down 타깃 2개를 봤습니다. master1의 kube-controller-manager(10257)와 kube-scheduler(10259)였고, 분할 전부터 죽어 있었습니다. vmagent의 오류는 이랬습니다.

```
x509: certificate is valid for localhost, localhost, not kubernetes
x509: certificate is valid for 127.0.0.1, not 192.168.0.51
```

두 컴포넌트는 인증서를 따로 받지 않으면 SAN이 `localhost`와 `127.0.0.1`뿐인 자체 서명 인증서로 뜹니다. 차트 기본 scrape는 클러스터 CA로 검증하므로 노드 IP로 붙으면 이름이 맞지 않습니다. 두 scrape의 `tlsConfig`를 `insecureSkipVerify: true`로 바꿨고 bearer 토큰 인증은 그대로 뒀습니다. `endpoints`는 리스트라 Helm이 통째로 교체하므로 기본 항목을 전부 다시 적어야 합니다.

```yaml
kubeControllerManager:
  vmScrape:
    spec:
      endpoints:
        - bearerTokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token
          port: http-metrics
          scheme: https
          tlsConfig:
            insecureSkipVerify: true
# kubeScheduler 도 같은 값
```

반영 뒤 두 타깃이 up으로 올라왔고 hub의 타깃 44개가 전부 up입니다.
