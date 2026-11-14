---
title: "밥때 몰리는 로그에 맞춘 Grafana Loki의 KEDA 도입기"
description: "Pod가 잇달아 죽는데도 HPA가 확장하지 않던 로그 시스템에서 우아한형제들은 Fluentd 버퍼 사용률을 새 확장 신호로 삼았습니다. Grafana Loki에 KEDA를 도입하면서 메트릭과 증설 속도를 조정한 과정입니다."
date: 2026-11-14
weight: 1
---

# 밥때 몰리는 로그에 맞춘 Grafana Loki의 KEDA 도입기 (2025-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [100만 TPS 로그 시스템, KEDA를 이용한 오토스케일링 적용기](https://techblog.woowahan.com/24405/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2025-11-27
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## OOM 뒤에도 확장하지 않은 HPA {#hpa-limits}

Ingester가 OOM Kill로 재시작했는데도 HPA는 Pod를 늘리지 않았습니다. 우아한형제들의 Grafana Loki 로그 시스템에서 겪은 일입니다. 재기동한 Pod가 비어 있는 메모리에 데이터를 채우는 사이, 부하를 견디지 못한 다른 Pod들이 차례로 죽었습니다.

문제는 평균이었습니다. 기본 HPA는 대상 Pod들의 CPU·메모리 사용률 평균이 임계치를 넘으면 계산식에 따라 확장하는데, 재시작한 Pod의 낮은 사용률이 전체 평균까지 끌어내렸습니다. 구성이 단순해 먼저 도입했지만, 정작 부하가 심해 Pod가 죽는 상황에서는 스케일아웃을 놓친 것입니다.

밥때면 로그도 몰립니다. 운영환경에서 하루 수십TB를 처리하고 피크에는 초당 레코드 수가 100만 단위를 넘는 데다, 배달의민족의 점심·저녁 식사 시간에 유입이 집중됩니다. 저녁 피크의 로그 유입량은 새벽 최저점의 10배 이상입니다.

이 상태로 리소스를 빠듯하게 쓰며 오토스케일링하기는 어려웠습니다. 결국 낮에는 높은 스케일을 유지하고 야간에는 배치로 줄이면서 HPA를 소극적으로 썼습니다. 비용 압박이 커지자, 하루 내내 부하에 맞춰 규모를 조절할 방법이 필요해졌습니다.

## 처리 지연을 드러내는 Fluentd 버퍼 {#architecture}

전사 로그 시스템의 백엔드는 Fluentd와 Grafana Loki입니다. 리소스 대부분을 쓰는 Write Path, 즉 로그 유입 경로는 Fluentd → Distributor → Ingester → AWS S3 순서로 이어집니다. S3를 제외한 컴포넌트는 모두 EKS에서 복수 replica로 운영합니다. ELK Stack에서 이 구성으로 옮겨 온 배경은 앞선 글 「따끈따끈한 전사 로그 시스템 전환기: ELK Stack에서 Loki로 전환한 이유」에서 다뤘습니다.

Fluentd는 Loki의 컴포넌트가 아닌, 그 앞에서 로그를 받는 데이터 파이프라인입니다. 로그를 재가공하고 목적에 따라 라우팅하며, Loki가 느려지거나 전송에 실패하면 디스크 버퍼에 보관해 유실을 막습니다. StatefulSet으로 운영하고 CPU 의존도가 비교적 높아, 스케일아웃이 늦으면 여기서도 병목이 생깁니다.

Distributor는 고가용성을 위해 로그를 복제해 여러 Ingester에 보냅니다. 이후 Fluentd에 응답하면 버퍼에서 해당 로그가 삭제됩니다. Deployment로 운영하는 상대적으로 가벼운 컴포넌트라, 여유 있게 늘려 두어도 비용 부담은 작습니다.

가장 무거운 곳은 Ingester입니다. 메모리와 디스크에 로그를 쌓았다가 일정량이 모이거나 시간이 지나면 S3에 씁니다. 레코드마다 HTTP 요청을 보내면 API Throttling에 걸릴 수 있기 때문입니다. 메모리 의존도가 높고 StatefulSet으로 운영하며, 새 Ingester가 구동되는 데 짧으면 1~2분, 로그량이 많고 한 대에 할당한 리소스가 크면 5분 이상 걸리기도 합니다.

데이터를 쌓아 두는 특성은 평균 사용률에도 영향을 줍니다. 새로 뜬 Fluentd Pod는 버퍼가 덜 차 있고, 새 Ingester Pod는 메모리 사용률이 낮습니다. 트래픽을 고르게 나눠도 기존 Pod와 새 Pod의 리소스 사용률까지 균일하다고 보장할 수 없는 이유입니다.

어느 한 컴포넌트라도 리소스가 부족하면 시스템이 정상적으로 동작하지 못합니다. Loki의 처리가 늦어질수록 Fluentd 버퍼 사용률이 높아져 Fluentd의 확장도 필요해집니다. 이 버퍼마저 가득 차면 로그 유실로 이어집니다.

## Fluentd 버퍼를 확장 신호로 쓰는 KEDA {#metrics}

CPU와 메모리에 Fluentd 버퍼 사용률을 더했습니다. 로그를 충분히 처리하지 못할 때 버퍼가 쌓인다는 점을 확장 신호로 삼은 것입니다. 이 메트릭을 오토스케일링에 연결하기 위해 KEDA를 도입했습니다.

KEDA는 Kubernetes Event Driven Autoscaling의 약자로, 외부 소스를 이용해 스케일링합니다. 2.18 버전 기준 Prometheus, Datadog, AWS CloudWatch, Kafka 등 79개의 스케일러를 지원합니다. ScaledObject라는 커스텀 리소스에 대상과 트리거를 선언하면 KEDA가 내부적으로 HPA를 만들고 조정하는 방식입니다.

원문에 나온 설정 예시는 실제 운영 리소스를 바탕으로 만든 가상 설정입니다. CPU와 메모리는 `spec.triggers`에 지정하고, 평균 사용률이 60% 이상이면 스케일아웃하도록 했습니다. 여기서 `Utilization`은 실제 사용량을 Pod에 할당한 `requests`로 나눈 값이며, `limits`를 분모로 쓰지 않습니다.

버퍼 지표는 Prometheus에서 `avg(100 - fluentd_output_status_buffer_available_space_ratio{app="fluentd"})`로 가져옵니다. 예시의 임계치는 5%입니다. CPU·메모리 사용률에 더해, 버퍼 사용률이 이 값을 초과해도 확장하도록 트리거를 추가했습니다.

### replica 수로 한 번 더 나뉘는 쿼리 결과

이 쿼리에는 `metricType: Value`를 명시했습니다. `metricType`을 생략하면 기본값인 `AverageValue`가 적용돼 쿼리 결과를 현재 replica 수로 다시 나누기 때문입니다.

쿼리 결과가 20이고 replicas가 10이라면 계산 결과는 20/10=2입니다. 버퍼 사용률은 이미 기준을 넘었지만, 나눈 값은 threshold 5에 못 미쳐 스케일링이 일어나지 않습니다. 쿼리에서 구한 버퍼 사용률을 그대로 비교하려면 타입도 그 의미에 맞춰 지정해야 했습니다.

## 기동 중에도 치솟는 desiredReplicas {#overprovisioning}

버퍼를 확장 신호로 삼자 과도한 증설이 생겼습니다. CPU·메모리·버퍼 사용률 중 하나라도 트리거되면 스케일아웃하는 설정에서, 버퍼가 원인일 때 나타난 문제입니다.

`Value` 타입은 `ceil(currentReplicas * (metricValue / targetValue))`로 desiredReplicas를 계산합니다. `ceil`은 소수점 올림입니다. 임계치가 5인 예시에서 쿼리 결과가 10이고 현재 replicas가 5라면, `ceil(5 * (10/5)) = 10`으로 현재의 두 배를 요구합니다. Ingester가 구동되는 몇 분 동안에도 버퍼는 계속 쌓이므로, desiredReplicas가 Max Replicas를 향해 치솟는 경우가 생겼습니다.

늘리는 속도를 제한했습니다. ScaledObject의 `spec.advanced.horizontalPodAutoscalerConfig`에서 HPA의 `behavior`를 지정하고, 예시에서는 `scaleUp`을 300초 동안 Pod 2대만 추가하도록 설정했습니다. KEDA가 만드는 HPA의 동작을 조정하는 항목이므로, 설정 스펙은 Kubernetes의 HPA 공식 문서를 따릅니다.

`stabilizationWindowSeconds`는 증설량 제한과 별도로 판단했습니다. 이 설정은 지정한 기간의 과거 메트릭에서 가장 보수적인 값으로 replica 수를 정해 급격한 스파이크에 따른 확장을 막습니다. 예를 들어 300초로 설정했다면, 지금은 2대가 필요해도 5분 전 메트릭으로는 1대만 늘리면 됐던 경우 1대만 추가합니다.

Fluentd 버퍼 메트릭에는 갑작스러운 스파이크가 발생하지 않았습니다. 조회 시점의 값을 바로 반영하는 편이 좋았으므로, OverProvisioning 방지 예시에서는 `stabilizationWindowSeconds`를 0초로 두었습니다. 증설 속도는 제한하면서 버퍼 상태는 현재 값으로 판단한 설정입니다.

## 줄어든 requests를 노드 축소로 잇는 Karpenter {#results}

도입 전에는 Pod에 할당한 requests 총량이 주간과 야간에 크게 달라지는 정적인 형태였습니다. KEDA 도입 후 시스템이 지연 없이 안정적으로 동작하는 것을 확인하고, 임계치를 더 공격적으로 적용했습니다. 클러스터 오토스케일링도 더 엄격하게 적용해 실시간으로 필요한 만큼의 Pod와 노드를 쓰도록 했습니다.

비용을 줄이려면 EKS 노드도 줄어야 했습니다. Pod 오토스케일링과는 별개의 작업입니다. 우아한형제들은 사내 인프라팀의 지원을 받아 Karpenter로 클러스터 오토스케일링을 적용했습니다.

Pod의 requests가 줄어 노드의 유휴 자원이 늘면 Karpenter가 Pod를 옮기고 노드를 제거합니다. requests 요구량이 증가할 때는 새 노드를 투입합니다. Pod 오토스케일링이 노드 오토스케일링의 조건을 만드는 연결입니다. 원문은 도입 전후를 AS-IS와 TO-BE 그림으로 비교하며, 구체적인 절감 수치는 제시하지 않았습니다.

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
