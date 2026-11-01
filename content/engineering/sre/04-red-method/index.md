---
title: "04 RED Method로 서비스의 요청을 살펴보는 법"
description: "Tom Wilkie의 RED Method는 서비스마다 요청량·실패·처리 시간을 살피는 방법입니다. 요청을 세는 경계와 실패의 기준부터 지연 분포, Prometheus 예제까지 연결해 설명합니다."
date: 2026-11-01
lastmod: 2026-11-01
weight: 4
url: "/sre/04-red-method/"
---

# 04 · RED Method로 서비스의 요청을 살펴보는 법

서버의 CPU와 메모리가 여유로워도 사용자는 오류를 보거나 응답을 오래 기다릴 수 있습니다. 서비스가 받은 요청이 얼마나 많고, 얼마나 실패하며, 처리에 얼마나 걸리는지를 함께 봐야 사용자에게 생긴 문제를 파악할 수 있습니다.

**RED Method**는 이 세 질문을 서비스마다 반복하는 방법입니다. 이름은 Rate, Errors, Duration에서 왔습니다. Tom Wilkie가 2015년에 고안했으며, [Grafana Labs의 발표 소개 글](https://grafana.com/blog/the-red-method-how-to-instrument-your-services/)은 여러 서비스의 상태를 일관된 방식으로 파악하는 데 목적이 있다고 설명합니다. 해당 글은 Wilkie의 발표를 Julie Dam이 정리한 자료입니다.

## 요청량·실패·시간을 같은 범위에서 본다

| 항목 | 확인할 질문 | 읽는 방법 |
| --- | --- | --- |
| Rate | 이 서비스가 초당 얼마나 많은 요청을 처리하는가? | 요청 수의 초당 증가량을 본다. 평소와 비교할 때는 같은 기능과 시간대를 맞춘다. |
| Errors | 그 요청 가운데 얼마나 실패하는가? | 실패 건수와 전체 요청 중 실패 비율을 함께 본다. |
| Duration | 요청을 처리하는 데 얼마나 걸리는가? | 평균과 함께 분포를 살펴 느린 요청을 확인한다. |

세 항목의 범위를 맞추는 일이 중요합니다. 주문 생성의 실패를 모든 API 요청 수로 나누면 다른 기능의 트래픽이 실패율을 가릴 수 있습니다. 주문 생성 요청의 처리량, 실패율, 지연 시간을 같은 서비스·기능·관찰 구간으로 묶어 읽어야 합니다.

요청을 셀 시점도 정해야 합니다. [Prometheus 계측 지침](https://prometheus.io/docs/practices/instrumentation/)은 시작과 종료 중 어느 쪽을 셀지 일관되게 정하고, 실패·지연 통계와 맞추기 쉬운 종료 시점을 권합니다. 종료 시점에 기록한다면 아직 끝나지 않은 요청은 요청 수와 지연 통계에 들어오지 않습니다. 따라서 처리 중인 요청 수를 함께 두면 요청이 쌓이는 상황을 파악하는 데 도움이 됩니다.

## 사용자 요청과 내부 호출을 구분한다

마이크로서비스에서는 사용자 요청 한 건이 여러 내부 호출을 만듭니다. 재시도나 병렬 호출이 있으면 서비스마다 기록되는 요청 수도 달라집니다. 아래는 주문 API가 내부 조회의 일시 오류를 재시도해 최종적으로 성공한 가상의 예시입니다.

{{< seq src="_seq/2-서비스마다-다르게-세는-요청.json" />}}

이때 내부 조회의 실패를 주문 API의 실패와 같은 뜻으로 읽으면 사용자 영향을 잘못 판단할 수 있습니다. 주문 API의 지연 시간에는 재시도에 걸린 시간도 포함되므로, 최종 결과가 성공이어도 사용자의 대기 시간은 길어질 수 있습니다. 서비스별 RED를 나란히 보면 이런 차이를 찾아볼 수 있습니다.

서비스 전체의 요청 수를 단순히 더한 값도 사용자 요청 수와 같지 않습니다. 사용자 접점에서의 요청과 각 내부 서비스의 호출을 각각 측정해야 합니다. 요청을 아예 받지 못한 서버는 그 요청을 기록할 수 없으므로, 클라이언트와 서버의 관측값을 비교하는 것도 유용합니다. Prometheus 역시 온라인 서비스의 [클라이언트·서버 양쪽 계측](https://prometheus.io/docs/practices/instrumentation/)을 권합니다.

## 실패의 기준을 서비스의 약속에 맞춘다

HTTP 서비스에서는 상태 코드가 편리한 출발점입니다. 그러나 정상 응답 코드가 항상 업무의 성공을 뜻하지는 않습니다. 예를 들어 응답 본문에 저장 실패를 담아 HTTP 200으로 반환하는 API라면, 상태 코드만 세어서는 그 실패를 찾기 어렵습니다.

반대로 잘못된 입력을 거절한 모든 응답을 서비스 장애로 셀 필요도 없습니다. 사용자의 요청이 서비스의 약속에 맞게 처리됐는지 기준을 정해야 합니다. 어떤 실패를 RED의 Errors에 포함하고, 어떤 업무 결과를 별도 지표로 볼지 문서화하면 팀마다 다른 실패율을 만드는 일을 줄일 수 있습니다.

실패율을 읽을 때는 분모도 함께 봅니다. 같은 실패 열 건이라도 전체 요청이 열 건인 경우와 만 건인 경우의 영향은 다릅니다. 요청량이 매우 적을 때에는 실패 한 건으로 비율이 크게 움직일 수 있고, 요청이 없을 때에는 실패율을 계산할 근거가 없습니다.

## 느린 요청은 평균 뒤에 숨을 수 있다

아홉 요청이 10ms에 끝나고 한 요청이 1초에 끝났다고 가정해 보겠습니다. 평균은 109ms지만, 한 사용자는 다른 사용자보다 훨씬 오래 기다렸습니다. 이처럼 평균과 함께 지연 분포를 보면 일부 요청에 집중된 느림을 살펴볼 수 있습니다.

P95는 관측값의 약 95%가 그 이하에 놓이는 지연 시간을 뜻합니다. 여러 인스턴스가 각각 계산한 P95를 평균 낸 값은 서비스 전체의 P95가 아닙니다. 서비스 전체의 분포가 필요하면 인스턴스들의 히스토그램을 합친 뒤 백분위수를 계산해야 합니다. [Prometheus의 히스토그램 설명](https://prometheus.io/docs/practices/histograms/)은 이런 집계와 사전에 계산된 백분위수의 차이를 다룹니다.

성공과 실패의 지연 시간도 나눠 보면 좋습니다. 오류를 즉시 반환하는 요청이 늘면 전체 평균이 낮아져 상태가 좋아진 것처럼 보일 수 있기 때문입니다. 평균, 느린 요청의 비중, 성공·실패별 분포 중 어떤 값이 실제 문제를 드러내는지 서비스의 동작에 맞춰 고릅니다.

## Prometheus에서 세 지표를 꺼내 보는 예시

다음은 주문 서비스에 맞춰 가정한 메트릭입니다. 특정 프레임워크가 기본으로 제공하는 이름은 아닙니다. 요청이 끝날 때마다 `shop_http_requests_total`을 하나 늘리고, 같은 요청의 처리 시간을 `shop_http_request_duration_seconds` 히스토그램에 기록한다고 하겠습니다. 두 메트릭에는 `service`, `route`, `outcome` 라벨이 있으며, `outcome`은 앞에서 정한 기준에 따라 `success` 또는 `error`입니다.

라벨의 `route`에는 `/orders/{id}`처럼 경로 패턴을 씁니다. 실제 주문 ID가 들어간 URL을 그대로 쓰면 라벨 값이 계속 늘어납니다. 시간은 초, 누적 요청 수는 `_total`로 이름을 짓는 방식은 [Prometheus 명명 지침](https://prometheus.io/docs/practices/naming/)을 따릅니다.

초당 요청 처리량은 누적 카운터의 증가 속도로 구합니다. 인스턴스별 카운터에 먼저 [`rate`](https://prometheus.io/docs/prometheus/latest/querying/functions/#rate)를 적용하고 서비스·경로별로 더합니다. 아래 식은 최근 5분의 평균적인 초당 처리량을 구합니다.

```promql
sum by (service, route) (
  rate(shop_http_requests_total[5m])
)
```

실패 비율은 같은 5분 동안 실패한 요청의 처리량을 전체 처리량으로 나눕니다. 아래 결과는 0~1의 비율이며, 0.01은 1%입니다.

```promql
sum by (service, route) (
  rate(shop_http_requests_total{outcome="error"}[5m])
)
/
sum by (service, route) (
  rate(shop_http_requests_total[5m])
)
```

이 예시는 계측할 경로마다 성공·실패 카운터 시계열을 0으로 미리 노출한다고 가정합니다. 실패 시계열이 없으면 결과가 사라질 수 있고, 전체 요청이 없으면 0으로 나누어 정상적인 실패율이 나오지 않습니다. 대시보드에서 값이 없는 상태를 실패율 0%와 구분해야 합니다.

Duration은 **classic histogram**을 사용한 예시입니다. 모든 인스턴스의 버킷 경계가 같다고 가정하고, 성공 요청의 버킷을 합친 뒤 P95를 추정합니다. 결과 단위는 초입니다.

```promql
histogram_quantile(
  0.95,
  sum by (service, route, le) (
    rate(shop_http_request_duration_seconds_bucket{outcome="success"}[5m])
  )
)
```

`le`는 classic histogram의 버킷 상한을 나타냅니다. P95의 정확도는 버킷 구성에 영향을 받으므로, 이 값을 정밀한 개별 요청 시간처럼 읽어서는 안 됩니다. Native histogram은 노출 형태와 집계식이 다르며, 선택 기준은 [공식 히스토그램 문서](https://prometheus.io/docs/practices/histograms/)를 참고할 수 있습니다. 여기의 5분은 설명을 위한 관찰 구간으로, 모든 서비스에 적합한 경보 설정값은 아닙니다.

## RED에서 원인 조사로 이어 간다

가상의 주문 서비스에서 요청 처리량은 비슷한데 실패율과 P95가 함께 높아졌다고 해 보겠습니다. 먼저 어떤 경로에서 변화가 시작됐는지 확인하고, 그 요청이 호출하는 내부 서비스의 RED와 비교할 수 있습니다. 특정 내부 서비스의 지연이 먼저 늘었다면 조사할 후보를 얻은 셈입니다. 시간상 함께 변했다는 사실만으로 원인이 확정되지는 않으므로 로그와 트레이스, 변경 이력으로 가설을 확인해야 합니다.

자원 병목이 의심되면 [USE Method]({{< relref "/engineering/sre/03-use-method/index.md" >}})로 CPU·메모리·저장장치 등의 사용률, 포화, 오류를 살펴볼 수 있습니다. Tom Wilkie도 두 방법을 함께 쓰도록 제안했습니다. RED는 요청이 겪는 상태를 보여 주고 USE는 그 요청을 처리하는 자원을 조사하는 데 도움을 줍니다. [Four Golden Signals]({{< relref "/engineering/sre/05-four-golden-signals/index.md" >}})는 요청 지연·트래픽·오류와 함께 서비스의 포화 상태를 살피는 관점을 제공합니다.

RED는 빠른 응답을 기대하는 서비스에서 공통 출발점이 됩니다. 비동기 작업에서는 요청을 받아들였다는 응답과 실제 처리가 끝났다는 결과가 다를 수 있습니다. 그런 시스템에는 처리 중인 항목, 대기 시간, 마지막 성공 시점 같은 지표를 더해 실제 완료까지 살펴야 합니다. [Prometheus 계측 지침](https://prometheus.io/docs/practices/instrumentation/)도 온라인 서비스, 오프라인 처리, 배치 작업의 측정 기준을 구분합니다.

## 참고 자료

- [The RED Method: How to Instrument Your Services — Grafana Labs](https://grafana.com/blog/the-red-method-how-to-instrument-your-services/): Tom Wilkie의 발표를 소개한 Julie Dam의 글.
- [Instrumentation — Prometheus](https://prometheus.io/docs/practices/instrumentation/): 서비스 유형별 계측과 요청·실패를 세는 기준.
- [Histograms and summaries — Prometheus](https://prometheus.io/docs/practices/histograms/): 지연 분포, 백분위수, 집계 방법.
- [Metric and label naming — Prometheus](https://prometheus.io/docs/practices/naming/): 단위·이름·라벨 설계.
