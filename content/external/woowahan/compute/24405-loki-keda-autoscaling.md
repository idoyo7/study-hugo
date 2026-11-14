---
title: "Grafana Loki 로그 시스템의 KEDA 오토스케일링 적용"
description: "하루 수십TB, 피크 초당 100만 단위 레코드를 받는 우아한형제들의 Loki 로그 시스템에 HPA의 한계를 넘어 KEDA를 도입한 과정을 정리했습니다. 메트릭 선정과 OverProvisioning 방지 설정을 다룹니다."
date: 2026-11-14
weight: 1
---

# Grafana Loki 로그 시스템의 KEDA 오토스케일링 적용 (2025-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [100만 TPS 로그 시스템, KEDA를 이용한 오토스케일링 적용기](https://techblog.woowahan.com/24405/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2025-11-27
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 풀타임 오토스케일링이 필요했던 이유 {#background}

우아한형제들의 운영환경 로그는 하루 수십TB가 처리되고 피크 기준 초당 레코드가 100만 단위를 넘습니다. 배달의민족은 점심과 저녁에 트래픽이 몰려, 로그 유입 기준으로 새벽 최저점 대비 저녁 피크에 10배 이상 많아집니다. 기존에도 소극적으로 HPA를 쓰고 야간에 스케일을 줄였지만, 비용 압박 속에서 풀타임 오토스케일링은 불가피했습니다. 이 글은 비용과 안정성을 함께 잡으려고 Grafana Loki에 KEDA를 도입한 경험입니다. 앞서 쓴 ELK Stack에서 Loki로 전환한 글을 사전에 읽어 두면 좋다고 안내합니다.

## 로그 시스템 구성 {#architecture}

전사 로그시스템 백엔드는 Fluentd와 Grafana Loki로 이루어지고 모든 컴포넌트는 복수 replica로 EKS에서 돕니다(S3 제외). 이 글은 리소스 대부분을 차지하는 Write Path만 다룹니다.

- Fluentd: 로그의 1차 도착점인 데이터 파이프라인으로, Loki의 컴포넌트는 아니다. 버퍼 역할을 해서 Loki가 느려지거나 장애로 전송이 실패해도 디스크에 저장해 유실을 막는다. CPU 의존도가 비교적 높아 스케일아웃이 늦으면 병목이 생기고, Loki 처리가 늦어져 버퍼 사용률이 오르면 스케일아웃이 필요하다. StatefulSet으로 운영한다.
- Distributor: 고가용성을 위해 로그를 복제해 여러 Ingester에 보내고 나면 Fluentd에 응답하고, 그러면 버퍼에서 로그가 지워진다. 상대적으로 가벼워 여유 있게 늘려도 비용 부담이 작다. Deployment로 운영한다.
- Ingester: S3에 쓰기 전에 로그를 쌓아 두는 곳이다. 매 레코드마다 보내면 HTTP 호출이 지나치게 많아 API Throttling에 걸릴 수 있어서, 일정량이 쌓이거나 시간이 지나면 쓴다. 전체에서 리소스를 가장 많이 쓰는 컴포넌트이고 특히 메모리 의존도가 높다. 새 Ingester가 뜨는 데 짧으면 1~2분, 로그량이 많고 할당량이 큰 경우 5분 이상 걸린다. StatefulSet으로 운영한다.

어느 한 컴포넌트라도 리소스가 모자라면 시스템이 정상 동작하지 못하고, Fluentd 버퍼가 가득 차면 로그 유실이라는 큰 장애로 이어집니다.

## 기본 HPA의 한계 {#hpa-limits}

기본 HPA는 대상 컴포넌트의 CPU와 Memory 사용률 평균이 임계치를 넘으면 계산식에 따라 스케일아웃합니다. 구성이 단순해 처음에는 HPA를 썼지만 평균에는 함정이 있었습니다.

첫째, Pod마다 사용률이 균일하지 않을 수 있습니다. Stateless 서버는 균일한 로드밸런싱으로 사용률이 평준화되지만, 상태가 있는 Fluentd와 Ingester는 그렇지 않습니다. Fluentd는 스케일아웃으로 새로 뜬 Pod의 버퍼가 상대적으로 낮고, Ingester는 로그를 메모리와 디스크에 쓰다가 일정 시간 뒤 flush하므로 신생 Pod의 메모리 사용률이 낮습니다. 트래픽이 균일해도 사용률은 균일하지 않습니다.

둘째, OOM Kill이 평균을 낮춥니다. Pod가 죽고 다시 뜨면 막 부하를 받기 시작해 사용률이 낮아서 전체 평균이 OOM 직전보다 오히려 떨어질 수 있습니다. 실제로 Ingester에서 이 현상이 심했고, 재기동한 Pod가 비어 있는 메모리에 데이터를 올리는 사이 HPA는 낮아진 평균 때문에 스케일아웃을 하지 않았고, 부하를 못 견딘 다른 Pod들이 차례로 죽었습니다. 결국 낮에는 높은 스케일을 유지하고 야간에는 배치로 줄이면서 HPA는 유명무실하게 두었습니다.

## KEDA와 ScaledObject {#keda}

KEDA는 Kubernetes Event Driven Autoscaling의 약자로, 제3의 소스를 이용해 오토스케일링하자는 것입니다. 2.18 버전 기준 79개의 스케일러를 지원하고 Prometheus, Datadog, AWS CloudWatch, Kafka 등이 있습니다. 핵심 커스텀 리소스는 ScaledObject이며, 선언하면 내부적으로 또 하나의 HPA가 만들어져 그 HPA를 조정하는 방식으로 스케일을 관리합니다. 원문은 `loki-ingester` StatefulSet을 대상으로 min 4, max 12, Prometheus 트리거와 memory 트리거, `pollingInterval` 60, `cooldownPeriod` 900을 둔 가상 예시를 보여 줍니다(실제 운영 리소스에 기반한 예시).

## 메트릭 선정과 주의점 {#metrics}

기본 지표인 CPU와 Memory를 `spec.triggers`로 먼저 지정했고 평균 사용률 60% 이상이면 스케일아웃하도록 했습니다. Utilization의 모수는 limits가 아니라 requests입니다. 여기에 시스템이 로그를 충분히 처리하지 못하면 Fluentd 버퍼가 쌓인다는 점을 위기 신호로 보고, Prometheus로 `avg(100 - fluentd_output_status_buffer_available_space_ratio{app="fluentd"})`를 가져와 버퍼 사용률이 5%를 넘으면 스케일아웃하는 트리거를 더했습니다.

삽질 포인트가 하나 있습니다. `metricType`을 쓰지 않으면 기본이 AverageValue라서 쿼리 결과를 현재 replica 수로 나눕니다. 결과가 20이고 replicas가 10이면 20/10=2가 되어 threshold 5에 못 미쳐 스케일링되지 않습니다. 이 트리거는 `metricType: Value`로 지정했습니다.

## OverProvisioning 방지 {#overprovisioning}

CPU, 메모리, 버퍼 사용률 중 하나라도 트리거되면 스케일아웃되는데, 버퍼로 트리거될 때 과대 스케일링이 생겼습니다. desiredReplicas 계산식 때문입니다. Value 타입은 `ceil(currentReplicas * (metricValue / targetValue))`, AverageValue 타입은 `ceil(metricValue / targetAverageValue)`입니다. 쿼리 결과가 10이고 replicas가 5이면 `ceil(5 * (10/5)) = 10`으로 두 배가 됩니다. Ingester는 뜨는 데 몇 분씩 걸리고 그동안 버퍼 메트릭이 계속 오르므로, 버퍼가 조금만 올라도 desired가 max를 향해 치솟았습니다.

해결은 ScaledObject의 `spec.advanced.horizontalPodAutoscalerConfig`로 K8s HPA의 behavior를 직접 지정하는 것입니다. 스펙은 KEDA가 아니라 K8s 공식 문서를 따릅니다. 원문은 scaleUp을 300초 동안 Pod 2대만 늘리도록 제한하는 예를 보여 줍니다. `stabilizationWindowSeconds`는 설정 시간 동안의 과거 메트릭 중 가장 보수적인 값으로 replicas를 정해 급격한 스파이크를 막는 기능인데, Fluentd 버퍼 메트릭은 갑자기 튀지 않고 조회 시점 값을 즉시 반영하는 편이 좋아서 0초로 두었습니다. 메트릭 특성에 맞춰 정하라는 것이 원문의 당부입니다.

## 결과와 클러스터 오토스케일링 {#results}

기존에는 주간과 야간 두 구간으로 requests 총량이 크게 갈리는 정적인 형태였습니다. KEDA 도입 뒤 시스템이 지연 없이 안정적으로 돌아가는 것을 확인하고 임계치를 더 공격적으로 적용했고, 클러스터 오토스케일링도 더 엄격하게 적용해 실시간으로 필요한 만큼의 Pod와 노드를 쓰게 됐다고 합니다(원문의 AS-IS와 TO-BE 비교 그림은 본문에서 수치로 제시되지 않습니다). 비용을 실제로 줄이려면 노드 수가 줄어야 하므로 인프라팀의 지원을 받아 Karpenter로 클러스터 오토스케일링을 적용했습니다. Pod의 requests가 줄어 노드의 유휴 자원이 늘면 Pod를 옮기고 노드를 제거하고, requests가 늘면 새 노드를 투입하는, Pod 오토스케일링이 노드 오토스케일링의 조건이 되는 체인입니다.

{{% details title="ScaledObject 설정과 계산식" closed="true" %}}

| 항목 | 값 |
|---|---|
| 예시 대상 | loki-ingester StatefulSet, min 4, max 12 |
| Prometheus 트리거 | 버퍼 사용률 5%, metricType Value |
| memory 트리거 | Utilization 60% |
| pollingInterval, cooldownPeriod | 60초, 900초 |
| scaleUp 제한(첫 예시) | 300초 동안 Pod 2대, stabilizationWindowSeconds 300 |
| scaleUp 제한(OverProvisioning 방지 예시) | 300초 동안 Pod 2대, stabilizationWindowSeconds 0 |
| Value 계산식 | ceil(currentReplicas * (metricValue / targetValue)) |
| AverageValue 계산식 | ceil(metricValue / targetAverageValue) |
| KEDA 스케일러 수 | 2.18 버전 기준 79개 |

{{% /details %}}
