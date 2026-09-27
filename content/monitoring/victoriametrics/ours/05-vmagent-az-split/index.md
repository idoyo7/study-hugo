---
title: "vmagent AZ 분할"
date: 2026-09-27
lastmod: 2026-09-27
weight: 5
---

# 05 · vmagent AZ 분할 — cross-AZ scrape 트래픽 없애기

{{< callout type="info" >}}
- vmagent 한 대가 `ap-northeast-2a`에 있고 타깃의 상당수가 `ap-northeast-2c`에 있어, scrape 응답 2.89MB/s(하루 약 250GB)가 매번 AZ 경계를 넘었습니다. AWS는 AZ 간 전송에 방향마다 $0.01/GB를 부과하므로 월 $150 안팎의 비용이 들었습니다.
- `promscrape.kubernetes.attachNodeMetadataAll=true`로 Node 라벨을 스크랩 메타라벨에 붙이고, 그 라벨을 기준으로 vmagent를 CR-A(2a)·CR-B(2c) 둘로 나눴습니다. 먼저 검토했던 Pod 라벨 복제 방식과 달리 별도 컨트롤러의 동기화 시점이나 라벨 정확성에 의존하지 않아 이 방식을 골랐습니다.
- 전환 과정에서 시리즈 identity가 잠깐 바뀌어 KEDA가 istiod를 8→16으로 과증설했다가 30분 안에 스스로 돌아왔습니다. 라벨 개수 한도를 넘어 일부 라벨이 잘린 시리즈도 나왔습니다.
- 전환 뒤 게이트는 전부 통과했고 순절감은 월 $133~143로 측정됐습니다. 다만 AZ별로 나눈 것은 scrape 경로뿐이라 쓰기 경로는 여전히 대부분 AZ를 넘습니다.
{{< /callout >}}

vmagent가 자기 AZ 밖의 타깃까지 수집하던 구조를 Node 메타데이터를 기준으로 둘로 나눴습니다. 방식을 고르고 설계를 검토할 때는 라벨의 정확성과 수집 누락을 살폈지만, 전환 과정에서는 시리즈 identity와 라벨 한도 문제도 드러났습니다. 비용은 줄었고, 이 분할만으로 줄일 수 없는 비용도 남았습니다.

> 관련 문서: [개념 03 수집]({{< relref "../../concepts/03-ingestion.md" >}}) · [01 스택 구성]({{< relref "../01-stack-overview.md" >}}) · [02 vmagent 전송 튜닝]({{< relref "../02-vmagent-transport-tuning.md" >}}) · [03 자기감시 메트릭]({{< relref "../03-self-monitoring-metrics.md" >}}) · [우리의 운영 허브]({{< relref "../_index.md" >}})

## ① 문제 — 왜 매달 돈이 새는가

stage 환경의 vmagent는 한 대뿐이고 `ap-northeast-2a`에서 실행됩니다. 그런데 수집 대상 Kubernetes 타깃 중 상당수는 `ap-northeast-2c` 노드에 있습니다. vmagent는 AZ를 가리지 않고 모든 타깃을 수집하므로, 2c 타깃의 scrape 응답은 매번 AZ 경계를 넘어 2a로 들어옵니다.

측정해 보니 이 cross-AZ 트래픽은 wire 기준 2.89MB/s, 하루로 환산하면 약 250GB였습니다. AWS는 같은 리전 안에서도 AZ를 넘는 전송에 요금을 부과합니다. 나가는 방향과 받는 방향 각각 $0.01/GB, 합쳐서 $0.02/GB입니다. 이 요율로 환산하면 순전히 AZ 경계를 넘는다는 이유만으로 월 $150 안팎이 청구됩니다.

한 클러스터에서는 이 비용이 크지 않아 보일 수 있습니다. 하지만 같은 구조를 트래픽이 훨씬 큰 prod 규모로 넓히면 비용도 커집니다. prod의 vmagent는 7일 평균 wire 기준 47~49MB/s를 처리하고, 그중 cross-AZ 전송량만 월 63~65TB에 이를 것으로 추정됩니다. 여기에 같은 요율을 적용하면 월 $1.2천대의 절감 여지가 있습니다. 이 prod 추정치는 청구서(AWS Cost and Usage Report)로 직접 확인한 숫자가 아니라 scrape 바이트에서 역산한 값입니다.

## ② 두 가지 방식 — 어떤 라벨을 기준으로 나눌 것인가

타깃을 AZ별로 나누려면 먼저 vmagent가 "이 타깃이 어느 AZ에 있는가"를 알아야 합니다. 이를 위해 두 가지 방법을 검토했습니다.

하나는 별도 컨트롤러가 Pod에 `topology.kubernetes.io/zone` 라벨을 미리 복제해 두고, vmagent는 그 Pod 라벨을 그대로 읽는 방식입니다. 먼저 시도했던 안이지만 채택하지 않았고, 지금 방식으로 대체했습니다.

다른 하나는 `promscrape.kubernetes.attachNodeMetadataAll: "true"`로 vmagent가 Pod·Endpoint를 발견할 때 해당 Pod가 실행 중인 Node의 메타데이터를 함께 붙이게 하는 방식입니다. 이렇게 하면 `__meta_kubernetes_node_label_topology_kubernetes_io_zone`이라는 메타라벨로 해당 Node의 zone을 바로 읽을 수 있습니다.

최종적으로 후자를 택했습니다. Pod 라벨 복제 방식은 컨트롤러가 제대로 동작하는지, 새 Pod가 뜬 직후 라벨이 언제 붙는지, 붙은 라벨이 실제 Node 위치와 맞는지에 계속 의존해야 합니다. Node 메타데이터 방식은 vmagent가 Kubernetes API에서 직접 읽으므로 이런 의존이 없습니다. 대신 대가도 있습니다. 이 옵션을 켜면 Pod·Endpoint를 발견하는 모든 Service Discovery 그룹이 Node까지 함께 watch하므로, API 서버로 나가는 watch 요청과 vmagent 자체 메모리 사용량이 늘어납니다.

## ③ 설계 — CR 둘로 쪼개기

vmagent를 관리하는 VMAgent CR을 두 개로 나눴습니다.

{{< flow src="_flow/3-asis-tobe-비교.json" />}}

CR-A는 기존 위치인 2a에 그대로 두고, 2c 타깃만 걸러내는 catch-all로 구성했습니다. `drop` 규칙 하나로 "2c가 아닌 전부"를 받도록 했습니다. 여기서 `keep 2a`가 아니라 `drop 2c`를 쓴 이유가 중요합니다. 양쪽에 `keep`을 쓰면 2a도 2c도 아닌 값(신규 AZ, 아직 라벨이 안 붙은 타깃)은 양쪽 모두의 수집 대상에서 제외됩니다. `drop`으로 여집합을 표현하면 그런 타깃은 자동으로 CR-A 쪽에 남습니다. Node zone을 판정할 수 없는 타깃에는 `az_bucket=fallback` 라벨을 붙여 CR-A가 수집합니다. 메트릭 전량 누락보다 일시적인 cross-AZ 비용을 택한 fail-open 정책입니다.

CR-B는 2c에 새로 띄우고 `keep ap-northeast-2c` 규칙 하나만 적용합니다. `VMStaticScrape`·`VMProbe`는 타깃에 Node 메타데이터가 없고 `VMScrapeConfig`는 SD 구성이 제각각이라 zone 분할에서 제외했습니다. 이 세 종류는 CR-B에서 전부 차단하고 CR-A가 전담합니다.

relabel 템플릿은 세 종류(Pod·Service·Node) 모두 같은 구조입니다. 아래는 CR-A 쪽 발췌입니다.

```yaml
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

CR-B에서는 마지막 규칙의 `drop`만 `keep`으로 바뀝니다. `debug_zone`은 수집 대상을 나누는 기능에는 쓰이지 않는 관측용 라벨입니다. 각 타깃이 어느 zone으로 판정됐는지 쿼리로 직접 확인하기 위한 교차검증 장치입니다.

CR-B는 차트 values의 `extraObjects`로 선언합니다. 아래는 핵심만 남긴 발췌입니다.

```yaml
extraObjects:
  - apiVersion: operator.victoriametrics.com/v1beta1
    kind: VMAgent
    metadata:
      name: vm-victoria-metrics-k8s-stack-2c
      labels:
        az-split: ap-northeast-2c
    spec:
      replicaCount: 1
      image:
        repository: <registry>/victoriametrics/vmagent
        tag: v1.106.1
      remoteWrite:
        - url: https://<vm-insert>/insert/0/prometheus/api/v1/write
      extraArgs:
        promscrape.kubernetes.attachNodeMetadataAll: "true"
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: topology.kubernetes.io/zone
                    operator: In
                    values: ["ap-northeast-2c"]
```

이 방식이 성립하려면 버전 조건이 맞아야 합니다. relabel 템플릿 필드는 operator v0.50.0부터, `attachNodeMetadataAll`은 vmagent v1.106.1부터 지원합니다. 두 번째 CR을 values 변경만으로 선언하려면 차트가 `extraObjects`를 지원해야 하는데, 현재 쓰는 chart 0.29.1이 이미 지원합니다. 버전을 새로 올릴 필요가 없어 CRD와 차트 기본값이 함께 바뀌는 위험까지 감수하지 않아도 됐습니다.

## ④ 리뷰에서 걸린 것 — 세 가지

설계 리뷰에서 세 가지 문제가 드러났습니다.

첫째, CR-B가 죽으면 2c 타깃 수집이 그대로 멈춥니다. CR-A가 대신 수집하는 인계 경로가 없는 fail-closed 구조입니다. CR-B는 replica 1이라 노드가 교체될 때마다 파드가 이동하고, 그동안 짧게나마 2c 쪽 수집이 중단됩니다. 다만 수집 중단 자체가 이 분할로 새로 생긴 위험은 아닙니다. 원래도 vmagent가 한 대뿐이라 그 한 대가 죽으면 전체 타깃의 수집이 100% 중단됩니다. 둘로 나눈 뒤에는 한쪽이 죽어도 나머지 절반가량은 계속 수집됩니다. 장애 반경은 줄었지만, CR-B 장애를 알려줄 알림 경로가 따로 없다는 점은 남은 과제입니다.

둘째, 전환하는 짧은 구간에 이중 합산이 일어납니다. 두 CR 모두 타깃에 `debug_zone` 라벨을 새로 붙이므로, 전환 순간 모든 시리즈의 identity가 바뀝니다. 옛 vmagent 파드는 graceful shutdown 때 stale 마커를 보내지 않기 때문에, 옛 라벨셋을 가진 시리즈와 새 라벨셋을 가진 시리즈가 조회 lookback 시간(5분) 동안 함께 잡힙니다. 그 결과 `sum()`으로 집계하는 값이 일시적으로 거의 두 배로 읽힙니다. 이 현상이 istiod를 감시하는 KEDA 트리거에서 나타나 istiod가 replica 8에서 16까지 늘었다가, 스케일다운 안정화 시간이 지나고서야 원래대로 돌아왔습니다.

셋째, 라벨 개수 한도 문제입니다. kubelet 경로는 `labelmap`으로 zone 라벨을 이미 갖고 있어 `debug_zone`을 더해도 새로운 정보가 생기지 않습니다. 그런데 vminsert에는 시계열 하나가 가질 수 있는 라벨 개수 상한(50개)이 있어, 상한을 넘으면 순서대로 앞 50개만 남기고 뒤의 라벨은 잘라냅니다. 라벨이 이미 50개에 가까웠던 일부 cadvisor 계열 시리즈(blkio 등)에 `debug_zone`이 더해지면서 맨 뒤에 있던 `prometheus` 라벨이 잘려 나갔습니다. 이 문제를 없애려면 nodeScrape 쪽 relabel 템플릿에서만 `debug_zone` 추가 규칙을 빼면 됩니다. kubelet 경로는 zone 정보를 이미 갖고 있으므로 잃을 정보가 없습니다.

## ⑤ 전환 실측 — 게이트와 사건

전환 뒤 두 시점에서 게이트를 확인했습니다.

| 항목 | 전환 +8분 | 전환 +1시간44분 | 기준 |
|---|---|---|---|
| 타깃 수 (CR-A / CR-B) | 487 / 241 | 485 / 231 | 전환 전 714 (단일 agent) |
| 방향 (kubelet 제외) | CR-A 전부 2a, CR-B 전부 2c | 동일 | 반대 AZ 0 |
| 두 agent 간 중복 | 0 | 0 | 0 |
| fallback 타깃 | 0 | 0 | 0 |
| down 타깃 | 0 | 0 | 0 |
| istiod 레플리카 | 16 | 8 | 8 |

두 시점의 타깃 수 합계는 각각 728과 716으로, 전환 전 714와 같은 수준입니다. 중복·fallback·down은 전부 0으로 기준을 충족했습니다.

전환 중 일어난 일을 시간 순으로 정리하면 다음과 같습니다.

- +1~+7분에는 `debug_zone` 라벨이 붙으며 시리즈 identity가 바뀌어 옛 시리즈와 새 시리즈가 5분 lookback 동안 함께 집계됐습니다. 그 결과 KEDA가 istiod를 8에서 16으로 늘렸습니다.
- +3분에는 istiod 증설분을 수용할 2c 노드가 새로 떴습니다.
- +28분에는 스케일다운 안정화 시간이 지나며 istiod가 16에서 8로 돌아왔습니다.
- +1시간13분에는 옛 2c 노드가 정리(consolidation)되며 CR-B 파드가 다른 노드로 옮겨갔습니다. 약 1분 동안 이중 수집이 있었지만, 15분 간격으로 보면 수집 공백은 없었습니다.

scrape·remoteWrite 트래픽은 전환 전후로 다음과 같이 바뀌었습니다.

| 경로 | 전환 전 | 전환 후 | 예측 |
|---|---|---|---|
| scrape wire 합계 | 7.08~7.39MB/s (agent 1대) | CR-A 4.51MB/s + CR-B 2.89MB/s | 합계 불변 |
| scrape cross-AZ | 2.89MB/s | 0 | - |
| remoteWrite 합계 | 465~470KB/s | CR-A 341KB/s + CR-B 133~137KB/s | 합계 불변 |
| remoteWrite cross-AZ | 0 | CR-B 몫, 하루 약 11.7GB | 하루 약 11.2GB |
| 순절감 ($0.02/GB) | - | 월 약 $133~143 | 월 $120~138 |

scrape 쪽 cross-AZ는 예측대로 0이 됐습니다. 반면 CR-B가 2c에서 쓰기를 보내는 목적지 LB는 2a에 있어, remoteWrite 쪽에는 새로운 cross-AZ 트래픽이 하루 약 11.7GB 생겼습니다. 이 트래픽의 비용을 절감액에서 빼면 순절감은 월 $133~143로, 사전 예측 $120~138와 비슷한 수준에서 실측됐습니다.

전환 검증에 쓴 대표 쿼리 몇 개입니다.

```promql
count by (prometheus)(up{cluster="stage"})
count by (prometheus,debug_zone)(up{cluster="stage",job!="kubelet"})
count(count by (job, namespace, pod, instance, metrics_path) (
  scrape_response_size_bytes{cluster="stage",az_bucket="fallback"}
)) or vector(0)
count(up{cluster="stage"}==0) or vector(0)
sum by (prometheus)(rate(vm_promscrape_conn_bytes_read_total{cluster="stage"}[5m]))
```

## ⑥ 남은 것 — 쓰기 경로는 그대로다

AZ별로 분할한 것은 scrape 경로뿐입니다. vmagent가 데이터를 쓰는 경로는 agent → 쓰기 LB → ingress → vminsert → vmstorage의 네 구간을 거치는데, 이 경로에는 AZ affinity가 없습니다.

{{< flow src="_flow/6-쓰기-경로-횡단.json" />}}

쓰기 LB의 IP는 하나뿐이고 2a에 있습니다. CR-B(2c)의 원격 쓰기는 이 구간에서 그대로 AZ를 넘습니다. LB 뒤의 ingress 파드 4대는 모두 2a 노드에 있어 LB에서 ingress까지는 같은 AZ 안입니다. 그런데 ingress에서 vminsert로 넘어갈 때는 2a·2b로 57:43 비율로 나뉘어 43%가 다시 AZ를 넘고, vminsert에서 vmstorage로 넘어갈 때는 세 AZ에 거의 고르게 나뉘어 약 3분의 2가 AZ를 넘습니다. 이 분산 비율은 변경 전과 같아, locality를 고려한 라우팅이 적용되고 있지 않은 것으로 보입니다.

즉 이번 변경으로 전체 쓰기 경로에서 달라진 곳은 첫 구간뿐이고, 나머지 세 구간은 손대지 않았습니다. 나머지 구간의 cross-AZ 비용까지 줄이려면 청구서의 `DataTransfer-Regional-Bytes` 항목과 VPC Flow Logs로 실제 AZ 간 전송량을 먼저 확인해야 합니다. prod로 확장하는 결정도 stage 파일럿을 1주일 정도 더 관찰한 뒤에 하기로 했습니다.

## 결론

Node 메타데이터로 타깃을 나눠 scrape 경로의 cross-AZ 비용을 없앤 결과는 그 대가와 함께 평가해야 합니다. 전환 순간의 이중 합산과 라벨 한도 문제를 새로 안았고, 쓰기 경로의 cross-AZ는 변경 범위 밖이라 그대로 남아 있기 때문입니다.
