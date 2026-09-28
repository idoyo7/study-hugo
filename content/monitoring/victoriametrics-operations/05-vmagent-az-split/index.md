---
title: "vmagent AZ 분할로 하루 2TB의 AZ 간 전송 줄이기"
description: "전체 네트워크 트래픽의 약 90%를 차지하던 inter-AZ 트래픽을 vmagent AZ 분할로 약 10% 줄인 과정과, 전송 경로·대략적인 감소 규모를 정리합니다."
date: 2026-09-27
lastmod: 2026-09-28
aliases: ["/monitoring/victoriametrics/ours/05-vmagent-az-split/"]
weight: 5
---

# 05 · vmagent AZ 분할로 하루 2TB의 AZ 간 전송 줄이기

{{< basis "두 AZ에 agent 1대씩 배치" "수치는 대략적인 규모로 표시" >}}

{{< kpis >}}
{{< kpi label="전체 트래픽 중 inter-AZ 비중" value="약 90%" sub="AZ 간 내부 통신" >}}
{{< kpi label="전체 inter-AZ 트래픽 감소" value="약 10%" sub="vmagent AZ 분할 적용 결과" tone="good" >}}
{{< kpi label="AZ 간 scrape 전송(하루)" value="약 2TB" sub="분할 전 추정" >}}
{{< /kpis >}}

## 전체 네트워크에서 AZ 간 내부 통신이 차지하는 비중

전체 네트워크 트래픽을 확인해 보니 **약 90%가 AZ 간 내부 통신(inter-AZ traffic)**이었습니다. 내부 컴포넌트끼리 주고받는 데이터가 AZ 경계를 넘는 양이 커서, 수집·전송 경로를 살펴봤습니다.

그중 vmagent가 다른 AZ의 타깃에서 scrape 응답을 가져오는 경로를 AZ별 수집으로 바꿨습니다. 이 변경으로 **전체 네트워크의 inter-AZ 트래픽을 약 10% 줄일 수 있었습니다.** 감소율의 기준은 변경 전 전체 inter-AZ 트래픽입니다.

아래에서는 이 효과를 만든 수집 구조와 분할 방식을 설명합니다. 환경명은 생략하고, 수치는 대략적인 규모로 표시했습니다. scrape 구간에서 줄일 수 있는 AZ 간 전송량은 하루 약 2TB로 추정했습니다.

## 분할 전 구성: 수집 응답이 하루 약 2TB씩 AZ를 넘는다

워크로드 수집 vmagent가 한 AZ에 한 대 있고, 다른 AZ 타깃에서 나오는 scrape 응답이 전체 전송량의 절반 정도인 구성입니다. 이 응답은 매번 AZ 경계를 넘어 agent로 들어옵니다. **타깃 → vmagent 구간에서만 하루 약 2TB, 한 달 약 60TB가 AZ를 넘는 규모였습니다.**

수집한 메트릭은 원격 저장 클러스터에 보관합니다. 쓰기 경로는 **vmagent → 쓰기 LB → ingress → vminsert → vmstorage**입니다. vmagent는 샘플을 모아 압축해 보내고, vmstorage가 영속 데이터와 보관 용량을 관리합니다.

{{< flow src="_flow/0-클러스터-간-메트릭-전송.json" />}}

문제는 원격 저장소로 보내기 전의 **타깃 → vmagent** 구간입니다. 타깃이 어느 AZ에 있든 한 agent가 수집하기 때문에, 다른 AZ의 응답이 모두 AZ 간 전송으로 잡힙니다. scrape 응답은 압축하지 않은 Prometheus 텍스트이고, agent를 지난 뒤부터는 압축해서 보내므로 수집 구간의 전송량이 특히 큽니다.

전송 규모는 평균 scrape 전송량과 다른 AZ에서 발생하는 바이트 비중으로 추정했습니다. 파드 수가 비슷해도 응답 크기는 다를 수 있으므로, 타깃 개수보다 실제 전송량을 기준으로 봤습니다.

## AZ별 분할: 같은 AZ에서 수집하고 원격 저장은 유지한다

vmagent를 한 대 추가해 **두 AZ에 한 대씩, 총 두 대**로 나눴습니다. 각 agent는 같은 AZ의 타깃을 수집한 뒤, 샘플을 모아 기존 원격 저장 엔드포인트로 보냅니다.

{{< flow src="_flow/3-asis-tobe-비교.json" />}}

변경 후에도 타깃에서 나오는 응답량은 같습니다. **하루 약 2TB가 AZ를 넘어 이동하던 경로를 같은 AZ 안에서 끝내는 것**이 개선의 핵심입니다.

### 수집 대상과 실행 위치를 함께 나눈다

타깃의 AZ는 Node 라벨에서 읽습니다. `promscrape.kubernetes.attachNodeMetadataAll: "true"`로 Pod·Endpoint에 Node 메타데이터를 붙이고, `__meta_kubernetes_node_label_topology_kubernetes_io_zone`을 기준으로 수집 대상을 나눕니다. agent의 실행 AZ는 `nodeAffinity`로 고정합니다.

| 구성 | 기존 agent | 새 agent |
|---|---|---|
| 수집 규칙 | 새 agent가 있는 AZ의 타깃 `drop` | 자신과 같은 AZ의 타깃만 `keep` |
| zone을 판정할 수 없는 타깃 | fallback으로 수집 | 제외 |
| VMStaticScrape·VMProbe·VMScrapeConfig | 전담 | 제외 |

기존 agent는 자기 AZ만 `keep`하도록 제한하지 않습니다. 신규 AZ나 zone 정보가 없는 타깃도 기존 agent에 남겨 수집 누락을 막습니다. Node 메타데이터가 없거나 SD 구성이 다른 세 종류의 수집 설정도 기존 agent가 맡습니다.

새 agent가 죽었을 때 기존 agent가 대신 수집하는 구성은 아닙니다. 각 agent가 맡는 범위의 수집 중단을 따로 감시해야 합니다.

## 변경 전후: 하루 약 2TB의 AZ 간 scrape 전송을 줄인다

비교 범위는 **타깃 → vmagent의 AZ 간 scrape 전송**입니다. 분할 전 규모와 분할로 줄일 수 있는 양을 대략적으로 비교했습니다.

| 지표 | AS-IS · agent 1대 | TO-BE · AZ별 agent | 예상 감소량 |
|---|---|---|---|
| 하루 AZ 간 전송량 | **약 2TB** | 거의 없음 | **하루 약 2TB** |
| 월 AZ 간 전송량 | 약 60TB | 거의 없음 | 월 약 60TB |

대상 타깃을 모두 같은 AZ에서 수집하면 해당 구간의 AZ 간 전송을 거의 없앨 수 있습니다. 수집하는 메트릭의 양과 저장량은 유지하면서, 수집 위치를 바꿔 AZ를 넘는 트래픽을 줄이는 효과입니다.

## 전환할 때 확인할 것

수집 대상을 나눌 때는 중복과 누락을 함께 확인해야 합니다.

| 확인 항목 | 확인할 내용 |
|---|---|
| 수집 범위 | 두 agent 사이의 중복·누락, fallback 타깃, down 타깃 |
| 수집량 | scrape와 remote write 총량이 전환 전후 비슷한지 |
| 외부 라벨 | 두 agent의 외부 라벨을 기존과 동일하게 유지하는지 |
| 검증용 라벨 | 새 라벨이 시리즈 정체성을 바꾸거나 라벨 개수 상한을 넘지 않는지 |
| 자동 확장 쿼리 | lookback 구간에서 옛 시리즈와 새 시리즈를 함께 합산하지 않는지 |
| agent 가용성 | AZ별 실행 노드 여유와 수집 중단 알림이 있는지 |

검증용 라벨을 새로 붙이거나 외부 라벨을 바꾸면 같은 타깃의 메트릭이 새로운 시리즈가 됩니다. lookback 구간에서 옛 시리즈와 새 시리즈가 함께 조회되면 `sum()`을 사용하는 자동 확장 트리거가 값을 과대 계산할 수 있습니다. 분할에는 Node 메타라벨을 사용하고, 저장되는 라벨의 변경은 최소화합니다. 중복 수집 여부는 vmagent 자체 메트릭(`vm_promscrape_targets`)과 타깃 목록으로 확인합니다.

측정 창도 맞춰야 합니다. 파드가 교체된 직후의 짧은 rate와 긴 구간의 평균을 섞지 않고, 전환 전후를 같은 기준으로 비교합니다. 과거 전송량을 AZ별로 나눌 때는 해당 기간에 사라진 파드·노드도 매핑할 수 있도록 목록의 조회 범위를 맞춥니다.

## 원격 저장 경로에는 AZ 간 전송이 남는다

**하루 약 2TB는 scrape 구간에서 줄일 수 있는 AZ 간 전송량**입니다. 원격 저장소로 보내는 remote write와 저장 클러스터 내부 통신은 계속 발생합니다.

새 agent의 출발 AZ가 달라지면 agent → 쓰기 LB 구간의 AZ 간 전송이 늘어날 수도 있습니다. 따라서 scrape 구간의 감소와 전체 네트워크의 감소는 따로 봐야 합니다. 이번 변경으로 확인한 전체 inter-AZ 트래픽 감소는 약 10%입니다.

> 관련 문서: [스택 구성]({{< relref "../01-stack-overview.md" >}}) · [vmagent 전송 튜닝]({{< relref "../02-vmagent-transport-tuning.md" >}}) · [자기감시 메트릭]({{< relref "../03-self-monitoring-metrics.md" >}})
