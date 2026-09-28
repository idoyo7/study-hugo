---
title: "vmagent AZ 분할: stage 실측과 prod 추정"
description: "vmagent를 AZ별로 나눠 stage에 적용하자 agent 경로의 AZ 간 전송이 하루 249.7GB에서 11.7GB로 95.3% 줄었다. 전환 때 겪은 KEDA 이중 합산과 라벨 상한 문제, 구간별 전송 분해, 실측으로 다시 계산한 prod 월 $1.1~1.2k 절감 추정을 정리한다."
date: 2026-09-27
lastmod: 2026-09-28
aliases: ["/monitoring/victoriametrics/ours/05-vmagent-az-split/"]
weight: 5
---

# 05 · vmagent AZ 분할: stage 실측과 prod 추정

{{< basis "기준 2026-09-28 08:30 KST" "stage 실측 · prod 7일 평균 추정" "단가 $0.02/GB" "1GB=10⁹B · 금액은 GiB~GB 환산 범위" >}}

{{< kpis >}}
{{< kpi label="stage agent 경로 AZ 간 전송" value="−95.3%" sub="하루 249.7GB → 11.7GB" tone="good" >}}
{{< kpi label="stage 순절감(월)" value="$133~143" sub="적용 전 예측 $120~138" tone="good" >}}
{{< kpi label="prod scrape 절감 추정(월)" value="$1.1~1.2k" sub="$1,138~1,222 · 청구서 미검증" tone="warn" >}}
{{< kpi label="prod 전체 AZ 간 전송 추정" value="−87%" sub="월 70.2TB → 9.2TB" >}}
{{< /kpis >}}

처음 이 글은 적용 전 추정만 담고 있었습니다. 그 뒤 같은 분할을 stage 클러스터에 먼저 적용했고, 전환 전후 트래픽을 직접 쟀습니다. 여기서는 그 실측과, 실측으로 모델을 다시 맞춘 prod 추정을 함께 적습니다. prod에는 아직 적용하지 않았습니다.

## 문제: scrape 응답이 AZ를 넘는다

워크로드 수집 vmagent는 클러스터마다 한 대였습니다. 타깃이 어느 AZ에 있든 이 agent 하나가 모두 긁어 오기 때문에, 다른 AZ에 있는 타깃의 scrape 응답은 전부 AZ 간 전송으로 잡힙니다.

{{< flow src="_flow/0-클러스터-간-메트릭-전송.json" />}}

수집한 메트릭은 원격 저장 클러스터로 보냅니다. 쓰기 경로는 vmagent → 쓰기 LB → ingress → vminsert → vmstorage입니다. 이 경로 가운데 **타깃 → vmagent** 구간이 유독 큽니다. scrape 응답은 압축하지 않은 Prometheus 텍스트이고, agent를 지난 뒤부터는 압축해서 보내기 때문입니다.

prod에서는 agent가 2c에 있고, scrape 바이트의 52.2%가 2a 타깃에서 나옵니다. 7일 평균 scrape wire로 계산하면 이렇습니다.

**45.16MB/s × 2a 바이트 비중 52.2% × 86,400초 ≈ 하루 2.04TB**

30일이면 61.1TB, 월 $1,138~1,222입니다. 처음 추정은 야간 1시간 값을 샘플 비율로 늘린 48MB/s와 파드 수 비중 51%를 썼는데, 7일 `increase`로 다시 재 보니 wire가 6%쯤 작았습니다. 파드 수 비중 대신 바이트 비중을 직접 잰 것도 달라진 점입니다.

stage는 거꾸로 agent가 2a에 있었습니다. 2c 타깃 몫인 39.0%, 2.89MB/s가 AZ를 넘고 있었습니다.

## 분할 설계: zone으로 나누고 fallback은 기존 agent에 둔다

agent를 한 대 더 띄워 두 AZ에 하나씩 두고, 각자 자기 AZ 타깃만 긁게 했습니다. 타깃의 AZ는 Node 라벨에서 읽습니다. `promscrape.kubernetes.attachNodeMetadataAll: "true"`로 Pod·Endpoint에 Node 메타데이터를 붙이고 `__meta_kubernetes_node_label_topology_kubernetes_io_zone`으로 keep/drop을 겁니다. agent가 뜨는 AZ는 `nodeAffinity`로 고정합니다.

prod와 stage는 기존 agent가 놓인 AZ가 서로 반대입니다. 헷갈리지 않도록 아래에서는 "기존 agent AZ"와 "새 agent AZ"로 부릅니다.

| 구성 | 기존 agent | 새 agent |
|---|---|---|
| 실행 AZ | prod 2c · stage 2a | prod 2a · stage 2c |
| 수집 규칙 | 새 agent AZ 타깃 `drop` | 새 agent AZ 타깃만 `keep` |
| zone 판정 불가 타깃 | fallback으로 수집 | 제외 |
| VMStaticScrape·VMProbe·VMScrapeConfig | 전담 | 제외 |

기존 agent를 `keep <자기 AZ>`로 좁히지 않은 이유는 누락 때문입니다. 새로 생긴 AZ나 zone 정보가 없는 타깃이 생겨도 기존 agent가 받아 줍니다. Node 메타데이터가 붙지 않는 세 종류의 수집 설정도 기존 agent 몫으로 남겼습니다.

반대 방향은 fail-closed입니다. 새 agent가 죽으면 새 agent AZ의 타깃은 아무도 수집하지 않습니다. 그래도 agent 한 대가 죽을 때 수집이 끊기는 범위는 100%에서 약 50%로 줄어듭니다. agent마다 수집 중단 알림을 따로 거는 것이 전제입니다.

{{< flow src="_flow/3-asis-tobe-비교.json" />}}

## stage 전환 결과

stage에서는 분할 전 약 714개였던 타깃이 기존 agent(2a) 485개, 새 agent(2c) 231개로 갈렸습니다. 두 숫자를 더하면 714와 조금 다른데, 조회 시점 사이의 파드 churn 때문입니다.

| 게이트 | 결과 | 판정 |
|---|---|---|
| 두 agent 사이 중복 타깃 | 0 | {{< badge "통과" good >}} |
| fallback으로 들어온 타깃 | 0 | {{< badge "통과" good >}} |
| down 타깃 | 0 | {{< badge "통과" good >}} |
| 수집 방향 (kubelet 제외) | 기존 agent 전부 2a, 새 agent 전부 2c | {{< badge "통과" good >}} |
| job+instance 중복 | 34 (분할 전 32) | {{< badge "기존 값" info >}} |

job+instance 중복 34는 kubelet·node-exporter에 원래 있던 것이고 두 agent 사이의 중복이 아닙니다.

{{< flow src="_flow/4-stage-전환-전후.json" />}}

| 경로 | AS-IS · agent 1대 | TO-BE · agent 2대 | 판정 |
|---|---|---|---|
| scrape 합계 | 7.08~7.39MB/s | 4.51 + 2.89MB/s | {{< badge "합계 유지" info >}} |
| scrape AZ 횡단 | 2.89MB/s | 0 | {{< badge "제거" good >}} |
| remote write 합계 | 465~470KB/s | 341 + 133~137KB/s | {{< badge "합계 유지" info >}} |
| remote write AZ 횡단 | 0 | 0.135MB/s | {{< badge "새로 생김" warn >}} |
| agent 경로 AZ 횡단 (하루) | 249.7GB | 11.7GB | {{< badge "−95.3%" good >}} |

AS-IS는 전환 1시간 전과 전날 같은 시각의 1시간 평균이고, TO-BE는 전환 후 5분 rate입니다. 다음 날 아침 12.5시간 누적으로 다시 뽑았을 때는 256.4GB → 11.6GB, −95.5%(월 −$137~147)였습니다. 5분 rate 값과 3% 안에서 맞습니다.

새로 AZ를 넘게 된 몫은 새 agent의 remote write 전량입니다. stage 쓰기 LB가 2a에 IP 하나만 두고 있어서, 2c에 있는 새 agent가 보내는 샘플은 모두 AZ를 건너갑니다. 하루 11.7GB, 월 $6.5~7입니다.

적용 전 예측과 비교하면 이렇습니다.

| 항목 | 예측 | 실측 |
|---|---|---|
| stage 순절감 (월) | $120~138 | $133~143 (재추출 $137~147) |
| 새 agent → 쓰기 LB AZ 횡단 (하루) | 11.2GB | 11.7GB |
| 라벨 상한에 걸리는 시리즈 | 74개 | 78개 |

순절감은 범위 양 끝끼리 비교하면 실측이 4~11% 컸습니다. 방향과 크기 모두 모델이 크게 빗나가지 않았다는 뜻이고, prod 추정을 같은 방식으로 다시 계산한 근거가 됐습니다.

agent 실사용량은 기존 agent 0.17 CPU·264MiB, 새 agent 0.08 CPU·168MiB였습니다. 새 agent는 기존 system 노드에 그대로 들어갔습니다.

## 전환 때 실제로 겪은 것

처음 글에 "검증용 라벨을 새로 붙이면 lookback 구간에서 함께 집계되거나 라벨 개수 상한에 걸릴 수 있다"고 적어 두었습니다. stage에서는 둘 다 실제로 일어났습니다.

### KEDA `sum()`이 5분 동안 두 배로 읽혔다

stage 전환에서는 검증용 zone 라벨을 붙였고, 새 agent의 외부 라벨도 기존 agent와 다르게 두었습니다. 둘 다 시리즈 정체성을 바꿉니다. 옛 agent는 내려갈 때 stale marker를 보내지 않고, vmselect는 `search.maxStalenessInterval: "0"`이라 instant query 창이 5분입니다. 그 5분 동안 같은 istiod 파드의 옛 시리즈와 새 시리즈가 함께 잡혔습니다.

istiod를 늘리는 KEDA 트리거가 `sum(pilot_xds)`였습니다. 평소 612 안팎이던 값이 약 1,220까지 올라 증설 문턱(8대 × 80 × 1.1 ≈ 704)을 넘었고, istiod가 8대에서 16대로 늘었습니다. 늘어난 파드를 받느라 2c 노드가 한 대 임시로 생겼고, 20분쯤 지나 8대로 돌아왔습니다.

전환 구간을 instant query로 다시 돌려 쿼리 네 가지를 비교했습니다.

| 쿼리 | 10:47 | 10:49 | 10:50 | 10:53 | 10:54 | 판정 |
|---|---|---|---|---|---|---|
| `sum(pilot_xds)` (기존) | 612 | 1,011 | 1,221 | 1,221 | 608 | {{< badge "2배" bad >}} |
| `sum(max by (pod)(pilot_xds))` | 612 | 615 | 624 | 658 | 608 | {{< badge "들쭉날쭉" warn >}} |
| `sum(last_over_time(pilot_xds[1m]))` | 612 | 1,069 | 612 | 614 | 608 | {{< badge "1분 튐" warn >}} |
| 두 방식 결합 (적용) | 611 | 609 | 615 | 612 | 613 | {{< badge "평탄" good >}} |

시각은 UTC입니다. `last_over_time[1m]`만 쓰면 한 번 튀는 값으로도 8→12가 됩니다. scaleUp 안정화 창이 0이기 때문입니다. 그래서 둘을 겹쳐 트리거를 바꿨습니다.

```promql
sum(max by (pod) (last_over_time(pilot_xds[1m])))
sum(max by (pod, type) (rate(pilot_xds_pushes[5m])))
```

평시에는 기존 쿼리와 값이 같습니다(612/612, push-rate 5.07/5.07). 배포 뒤 스케일러 에러도 0이었습니다.

측정에도 함정이 있었습니다. step 60초짜리 range query로 그리면 이 2배가 보이지 않습니다. KEDA가 읽는 값을 재현하려면 instant query를 써야 합니다.

### 라벨 개수 상한 50에 걸렸다

검증용 zone 라벨이 node scrape에도 붙으면서, 라벨이 원래 많던 `container_blkio_device_usage_total` 78개 시리즈가 vminsert `maxLabelsPerTimeseries=50`을 넘었습니다. vminsert는 넘친 라벨을 잘라 내고, 이 시리즈들은 `prometheus` 라벨을 잃었습니다. 적용 전에 74개로 예상했던 문제입니다. node scrape에서 검증용 라벨을 걷어내는 후속 변경을 준비해 두었고, 아직 적용 전입니다.

### 그 밖에 확인한 것

- 전환 20분 동안 stage HPA 362개 중 증설은 istiod(8→16)와 kiali(1→2) 둘. 1시간 전 같은 길이의 대조 구간에도 1개가 늘었다
- RPS 트리거를 쓰는 서비스 HPA는 영향 없음. stage RPS가 임계보다 크게 낮다
- 전환 1회 비용: 시리즈 약 1.3M 재생성(인덱스 약 1GB)
- 새 agent는 replica 1이라 노드 정리 때 파드가 옮겨 가며 약 1분 이중 수집이 생겼다. 수집 공백은 없었다
- 파드가 바뀐 직후 `sum(rate(...[1h]))`는 과대 계산된다. 교체된 새 agent에서 5.77MB/s로 나왔지만 실제 5분 rate는 2.89MB/s였다

### prod는 외부 라벨을 같게 두고 전환한다

prod는 ScaledObject 136개 중 87개가 RPS 트리거를 씁니다. 같은 일이 prod에서 나면 istiod만이 아니라 서비스 전반이 몇 분 동안 두 배 트래픽을 본 것처럼 늘어납니다. 검증용 라벨이 없었더라도 외부 라벨 차이만으로 stage 값이 약 1.3배(약 810)가 되어 문턱을 넘었을 것으로 추정합니다.

그래서 prod에서는 두 agent의 외부 라벨을 같게 두고, 검증용 라벨 없이 전환합니다. 중복 수집 여부는 vmagent 자체 메트릭(`vm_promscrape_targets`)으로 확인합니다. istiod 트리거는 전환 전에 stage와 같은 쿼리로 먼저 바꿉니다. prod istiod는 최소 24대라 두 배로 읽히면 48대 이상으로 불어납니다.

## 구간별로 나눠 보면

AZ 분할이 바꾸는 구간은 scrape와 agent → 쓰기 LB 둘뿐입니다. 그 뒤로는 경로 어디에도 AZ affinity가 없습니다. stage에서 구간마다 확인한 결과입니다.

| 구간 | 관측 | AZ affinity |
|---|---|---|
| agent → 쓰기 LB | DNS가 2a IP 하나만 돌려준다. 새 agent(2c) 전량이 AZ를 넘는다 | {{< badge "없음" bad >}} |
| LB → ingress | ingress 파드 4개가 모두 2a 노드 한 대에 있다 | {{< badge "없음" bad >}} |
| ingress → vminsert | 2a 57% / 2b 43%, 전날과 같은 분배 | {{< badge "없음" bad >}} |
| vminsert → vmstorage | 시리즈 해시로 3개 AZ에 고르게, RF=2라 약 2/3가 AZ를 넘는다 | {{< badge "구조상 불가" info >}} |

덤으로 드러난 것이 있습니다. stage는 쓰기 LB와 ingress가 2a에만 있어서, 2a에 장애가 나면 쓰기와 조회가 함께 멈춥니다. 비용보다는 가용성 쪽 숙제입니다.

scrape가 AZ 간 전송의 대부분을 차지하는 이유는 샘플 한 개가 구간마다 차지하는 크기를 보면 드러납니다(prod, 1일 평균).

| 구간 | 샘플당 크기 | scrape 대비 |
|---|---|---|
| 타깃 → agent (무압축 텍스트) | 470B | 1× |
| agent → vminsert (remote write, 압축) | 13.7B | 약 1/34 |
| vminsert → vmstorage (RPC 압축, RF=2 두 벌) | 47.9B | 약 1/10 |
| vmstorage 디스크 (데이터) | 0.70B | 약 1/670 |

stage 구간별 AZ 간 전송(실측, 월)은 이렇습니다.

| 구간 | 전체 | AS-IS AZ 횡단 | 비중 | | TO-BE AZ 횡단 |
|---|---|---|---|---|---|
| 타깃 → agent | 19.2TB | 7.48TB, $139~150 | 66.1% | {{< bar 66.1 >}} | 0 |
| agent → 쓰기 LB | 1.23TB | 0 | 0% | {{< bar 0 >}} | 0.35TB, $7 |
| gateway → vminsert | 1.99TB | 0.86TB, $16~17 | 7.6% | {{< bar 7.6 >}} | 같음 |
| vminsert → vmstorage | 4.46TB | 2.97TB, $55~59 | 26.3% | {{< bar 26.3 >}} | 같음 |
| 합계 | | 11.3TB, $211~226 | | | 4.18TB, $78~84 (−63%) |

stage는 뒤 두 구간에 다른 클러스터 트래픽이 섞여 있고 scrape 비중이 39%로 낮아서, 전체 감소율이 −63%에 그칩니다. prod는 사정이 다릅니다.

| 구간 | 전체 | AS-IS AZ 횡단 | 비중 | | TO-BE AZ 횡단 |
|---|---|---|---|---|---|
| 타깃 → agent | 117.1TB | 52.2%, 61.1TB, $1,138~1,222 | 87.1% | {{< bar 87.1 >}} | 0.1%, 약 $2 |
| agent → 쓰기 LB | 약 3.4TB | 50%(가정), 1.73TB, $32~35 | 2.5% | {{< bar 2.5 >}} | 같음 |
| gateway → vminsert | 4.38TB | 50%(추정), 2.19TB, $41~44 | 3.1% | {{< bar 3.1 >}} | 같음 |
| vminsert → vmstorage | 약 14TB | 36.6%(실측), 5.15TB, $96~103 | 7.3% | {{< bar 7.3 >}} | 같음 |
| 합계 | | 70.2TB, $1,307~1,403 | | | 9.2TB, $171~184 (−87%) |

prod 수신 쪽은 vmstorage가 2a 5대, 2c 1대로 치우쳐 있습니다. 그래서 vminsert → vmstorage 가운데 36.6%가 AZ를 넘고, 배치로 계산한 이론값 35.3%와도 맞습니다. 분할 뒤에도 남는 월 9.2TB 가운데 가장 큰 몫이지만, 이 치우침은 비용보다 2a 장애 때 조회가 막히는 문제 때문에 따로 다룰 작업입니다.

## prod 추정과 남은 확인

prod의 AZ 분배는 job별로 봐도 고릅니다. 노드가 두 AZ에 거의 반반이라 주요 job이 약 51:49로 나뉩니다.

| job | scrape 중 비중 | | 2a / 2c | |
|---|---|---|---|---|
| istio-dataplane | 81.6% | {{< bar 81.6 >}} | 51.0 / 48.8 | {{< bar 51.0 48.8 >}} |
| kubelet | 13.4% | {{< bar 13.4 >}} | 50.6 / 49.4 | {{< bar 50.6 49.4 >}} |
| node-exporter | 2.4% | {{< bar 2.4 >}} | 50.5 / 49.5 | {{< bar 50.5 49.5 >}} |
| kube-state-metrics | 1.7% | {{< bar 1.7 >}} | 100 / 0 | {{< bar 100 0 >}} |
| 기타 | 0.8% | {{< bar 0.8 >}} | 93 / 7 | {{< bar 93 7 >}} |

kube-state-metrics는 파드가 2a에 하나뿐이라 새 agent가 전부 맡습니다. 평일 아침에 다시 재도 2a 비중은 51~52%였습니다. 2a 비중을 50~55%로 넓게 잡아도 scrape 절감은 월 $1,090~1,288 사이에 들어옵니다.

네트워크 절감은 **월 $1.1~1.2k**(연 약 $14~15k)로 봅니다. agent당 피크 CPU가 3.8코어에서 약 1.9코어로 줄 전망이라, 리소스 요청을 7 CPU/10Gi에서 2대 × (2 CPU/3Gi)로 낮추면 컴퓨트 쪽에서 월 약 $100이 더 줄어듭니다. 다만 이 값은 전망이고 네트워크 절감과는 따로 셉니다.

prod에 적용하기 전에 남은 확인은 다음과 같습니다.

| 항목 | 상태 | 판정 |
|---|---|---|
| AWS 청구서(CUR)로 전송량 대조 | 모든 prod 수치가 메트릭 기반 추정 | {{< badge "미검증" warn >}} |
| 쓰기 LB의 AZ 구성 | IP 2개가 AZ마다 하나로 보이나 미확인. 결과에 따라 월 ±$32~35 | {{< badge "미확인" warn >}} |
| 외부 라벨 유지 전환 | 두 agent 외부 라벨 동일, 검증용 라벨 없음 | {{< badge "계획" info >}} |
| istiod 트리거 선교체 | stage와 같은 쿼리 | {{< badge "계획" info >}} |
| AZ마다 system 노드 여유 | agent가 AZ에 고정되므로 필요 | {{< badge "확인 필요" warn >}} |

측정 방법에서 얻은 교훈도 하나 있습니다. prod 첫 계산에서는 바이트의 18%가 어느 AZ인지 매핑되지 않았습니다. 파드·노드 목록을 조회 시점 한 번만 받았더니 1시간 안에 사라진 파드를 찾지 못한 것입니다. 목록을 70분 창으로 받자 미매핑이 0.1%로 줄었습니다. 일요일 밤 한 시간 동안 파드 2,825개 중 1,358개, 노드 72대 중 23대가 사라질 만큼 churn이 큽니다. vmagent는 타깃을 발견하는 순간 zone을 붙이므로 분할 자체는 이 문제를 겪지 않습니다.

## 다음 레버: Istio 사이드카 메트릭

AZ 분할은 scrape 응답이 가는 길만 바꿉니다. 응답 크기 자체는 그대로입니다. prod scrape 바이트의 81.6%가 istio-dataplane이라, 다음으로 볼 곳은 사이드카 응답입니다.

stage에서 응답이 가장 큰 파드 하나를 골라 Istio 1.24.1 사이드카에 직접 요청해 봤습니다. vmagent는 압축을 요청하지만, 15090 `/stats/prometheus`와 15020 병합 엔드포인트 모두 gzip 요청을 무시하고 평문으로 답했습니다. 972,233B짜리 응답을 로컬에서 gzip -6으로 압축하면 15,005B, 원래의 1.5%입니다. 15090은 Envoy bootstrap의 정적 리스너라 EnvoyFilter로 compressor를 붙일 수 없고, 이 버전에서 압축을 켜는 설정은 찾지 못했습니다.

응답의 대부분은 히스토그램 버킷입니다. 줄 하나가 라벨 26개를 달고 약 750B를 차지합니다.

| 메트릭 | 응답 대비 | |
|---|---|---|
| `istio_request_duration_milliseconds_bucket` | 29.0% | {{< bar 29.0 >}} |
| `istio_response_bytes_bucket` | 28.6% | {{< bar 28.6 >}} |
| `istio_request_bytes_bucket` | 28.6% | {{< bar 28.6 >}} |
| 나머지 (sum·count·requests_total·envoy_*) | 13.8% | {{< bar 13.8 >}} |

`_bucket` 세 종류가 **86.2%**입니다. 감축안은 두 가지를 검토하고 있습니다.

| 방안 | 응답 감소 | 영향 | 판정 |
|---|---|---|---|
| A. bytes 히스토그램 2종의 `_bucket`을 소스에서 제거 | −57%, 저장 시리즈 −26.8% | KEDA RPS 트리거와 무관 | {{< badge "방법 검증 전" warn >}} |
| B. 다른 라벨로 알 수 있는 라벨 9개 제거 | −37% | 모든 istio 시리즈 정체성이 바뀌어 RPS 이중 합산 위험 | {{< badge "트리거 보강 뒤" bad >}} |

metric relabel로 버킷을 버리는 방법도 있지만, 그러면 저장량만 줄고 wire 바이트는 그대로입니다. 소스에서 없애야 전송량·vmagent CPU·저장량이 함께 줄어듭니다. AZ 분할 없이 A만 했어도 scrape 응답이 절반 가까이 줄어 AZ 간 전송도 그만큼 줄었을 것입니다. 분할 뒤에는 AZ 간 전송이 이미 0에 가까워서, A의 효과는 agent CPU와 저장량 쪽으로 옮겨 갑니다.

> 관련 문서: [스택 구성]({{< relref "../01-stack-overview.md" >}}) · [vmagent 전송 튜닝]({{< relref "../02-vmagent-transport-tuning.md" >}}) · [자기감시 메트릭]({{< relref "../03-self-monitoring-metrics.md" >}})
