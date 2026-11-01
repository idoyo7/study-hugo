---
title: "04 RED Method로 요청량·실패·지연을 함께 읽는 기준"
description: "RED Method의 요청량·실패·지연 시간을 함께 읽으려면 요청을 세는 경계와 실패 기준부터 맞춰야 합니다. 이 기준을 Prometheus 계측과 질의에 적용해 서비스별 차이와 지연 분포를 확인합니다."
date: 2026-11-01
lastmod: 2026-11-01
weight: 4
url: "/sre/04-red-method/"
---

# 04 · RED Method로 요청량·실패·지연을 함께 읽는 기준

서버에 여유가 있어도 요청은 실패하거나 늦게 끝날 수 있습니다. CPU와 메모리 사용률만으로는 사용자가 겪는 문제가 드러나지 않을 수 있습니다. 서비스가 받은 요청이 얼마나 많았는지, 그중 얼마나 실패했는지, 처리에 얼마나 걸렸는지를 함께 살펴봅니다.

Tom Wilkie가 2015년에 고안한 RED Method는 이 관찰을 서비스마다 반복합니다. Rate는 초당 요청 수, Errors는 그중 실패한 요청 수, Duration은 처리에 걸린 시간입니다. Wilkie의 발표를 Julie Dam이 정리한 [Grafana Labs 글](https://grafana.com/blog/the-red-method-how-to-instrument-your-services/)은 여러 서비스의 동작을 일관된 방식으로 파악하려는 방법이라고 설명합니다.

## 요청 수는 서비스 경계마다 달라진다

사용자 요청 한 건이 내부에서도 한 번의 호출로 끝나지는 않습니다. 마이크로서비스에서는 여러 내부 호출이 생기며, 재시도나 병렬 호출에 따라 각 서비스가 기록하는 요청 수도 달라집니다.

아래 그림은 주문 API가 내부 조회의 일시 오류를 재시도한 뒤 최종적으로 성공하는 가상의 상황입니다.

{{< seq src="_seq/2-서비스마다-다르게-세는-요청.json" />}}

내부 조회의 실패를 주문 API의 실패로 읽으면 사용자 영향을 잘못 판단하게 됩니다. 주문 API의 처리 시간에는 재시도에 걸린 시간도 포함되므로, 최종 응답이 성공이어도 사용자의 대기는 길어질 수 있습니다.

서비스별 RED를 나란히 보는 이유가 여기에 있습니다. 사용자 접점의 요청과 내부 서비스의 호출을 각각 측정해 어느 쪽에서 실패와 지연이 생겼는지 비교합니다. 각 서비스의 요청 수를 모두 더해도 사용자 요청 수가 되지는 않습니다.

서버가 받지 못한 요청도 생각해야 합니다. 서버에는 그 요청의 기록이 없으므로 클라이언트의 관측값과 비교하는 편이 유용합니다. Prometheus의 [온라인 서비스 계측 지침](https://prometheus.io/docs/practices/instrumentation/)도 클라이언트와 서버 양쪽에서 측정하도록 권합니다.

## 성공 응답과 작업 완료의 기준

HTTP 상태 코드만으로 업무의 성공까지 판단하기는 어렵습니다. 저장 실패를 응답 본문에 담으면서 HTTP 200을 반환하는 API라면, 코드상으로는 정상이어도 사용자가 요청한 작업은 실패한 상태입니다.

기준은 서비스의 약속입니다. 잘못된 입력을 거절한 응답을 모두 서비스 장애로 세기보다는, 요청이 약속에 맞게 처리됐는지를 기준으로 실패를 구분합니다. RED의 Errors에 포함할 실패와 별도 지표로 기록할 업무 결과를 문서화하면 팀마다 실패율을 다르게 계산하는 일을 줄이는 데 도움이 됩니다.

실패의 기준을 정했다면 요청을 언제 기록할지도 맞춥니다. [Prometheus 계측 지침](https://prometheus.io/docs/practices/instrumentation/)은 시작과 종료 중 어느 시점을 셀지 일관되게 정하되, 실패와 지연 통계를 맞추기 쉬운 종료 시점을 권합니다.

종료 때 기록하는 방식에는 아직 끝나지 않은 요청이 포함되지 않습니다. 요청 수와 지연 통계만으로는 진행 중인 작업이 드러나지 않으므로, 처리 중인 요청 수도 함께 측정하면 요청이 쌓이는 상황을 파악하는 데 도움이 됩니다.

비동기 작업에서는 완료의 뜻부터 달라집니다. 요청을 받아들였다는 응답이 실제 처리가 끝났다는 뜻은 아니기 때문입니다. 빠른 응답을 기대하는 서비스에서는 RED가 공통 출발점이 되지만, 비동기 시스템은 처리 중인 항목, 대기 시간, 마지막 성공 시점 같은 지표를 더해 실제 완료까지 살펴야 합니다. [Prometheus 계측 지침](https://prometheus.io/docs/practices/instrumentation/)도 온라인 서비스, 오프라인 처리, 배치 작업의 측정 기준을 구분합니다.

## 주문 서비스의 요청량과 실패율

주문 서비스가 요청 종료 때마다 `shop_http_requests_total`을 하나 늘리고, 그 요청의 처리 시간을 `shop_http_request_duration_seconds` 히스토그램에 기록한다고 가정하겠습니다. 예제를 위해 정한 이름입니다. 특정 프레임워크가 기본으로 제공하는 메트릭을 뜻하지는 않습니다.

두 메트릭에는 `service`, `route`, `outcome` 라벨을 붙입니다. `outcome`의 값은 앞서 정한 실패 기준에 따라 `success` 또는 `error`로 기록합니다. `route`에는 실제 주문 ID가 포함된 URL 대신 `/orders/{id}` 같은 경로 패턴을 사용합니다. 개별 URL을 그대로 넣으면 라벨 값이 계속 늘어나기 때문입니다. 시간의 단위를 초로 쓰고 누적 요청 수의 이름에 `_total`을 붙이는 방식은 [Prometheus 명명 지침](https://prometheus.io/docs/practices/naming/)에 따른 것입니다.

질의에서도 같은 요청끼리 비교해야 합니다. 주문 생성의 실패를 전체 API 요청 수로 나누면 다른 기능의 트래픽 때문에 실패율이 가려질 수 있습니다. 처리량·실패율·지연 시간을 같은 서비스와 기능, 같은 관찰 구간으로 묶는 이유입니다.

초당 처리량을 구할 때는 각 인스턴스의 카운터에 [`rate`](https://prometheus.io/docs/prometheus/latest/querying/functions/#rate)를 먼저 적용한 뒤 서비스·경로별로 합칩니다. 아래 식의 결과는 최근 5분 동안의 평균적인 초당 요청 처리량입니다. 평소보다 늘었는지 줄었는지 판단할 때도 같은 기능과 시간대를 맞춰 봅니다.

```promql
sum by (service, route) (
  rate(shop_http_requests_total[5m])
)
```

실패 건수는 이 처리량과 함께 읽습니다. 실패가 열 건이어도 전체 요청이 열 건일 때와 만 건일 때의 영향은 다릅니다. 요청량이 매우 적다면 실패 한 건에도 비율이 크게 움직이기도 합니다.

같은 5분 동안 실패한 요청의 처리량을 전체 처리량으로 나누면 실패 비율을 얻습니다. 결과는 0~1이며, 0.01은 1%입니다.

```promql
sum by (service, route) (
  rate(shop_http_requests_total{outcome="error"}[5m])
)
/
sum by (service, route) (
  rate(shop_http_requests_total[5m])
)
```

이 계산은 계측하는 경로마다 성공·실패 카운터 시계열을 0으로 미리 노출한다는 가정에 따릅니다. 실패 시계열 자체가 없으면 질의 결과가 사라질 수 있습니다.

요청이 없는 상태도 구분해야 합니다. 전체 요청이 없으면 0으로 나누게 되어 정상적인 실패율이 나오지 않습니다. 실패율을 계산할 근거가 없는 상태이므로, 대시보드에서 값이 없는 경우를 실패율 0%로 읽어서는 안 됩니다.

## 지연 시간을 분포로 읽는 이유

아홉 요청이 10ms에, 한 요청이 1초에 끝났다고 가정하면 평균은 109ms입니다. 한 사용자는 훨씬 오래 기다렸습니다. 평균만 보지 않고 지연 분포를 확인하면 일부 요청에 집중된 느림이 드러납니다.

성공과 실패를 섞었을 때도 평균의 해석이 달라집니다. 오류를 즉시 반환하는 요청이 늘면 전체 평균이 낮아져 서비스 상태가 좋아진 것처럼 보이기도 합니다. 성공·실패별 분포를 나눠 보고, 평균이나 느린 요청의 비중 중 어떤 값이 서비스의 실제 문제를 드러내는지 고릅니다.

P95는 관측값의 약 95%가 그 이하에 놓이는 지연 시간입니다. 여러 인스턴스에서 각각 계산한 P95를 평균 내서는 서비스 전체의 P95를 얻지 못합니다. 전체 분포를 보려면 인스턴스들의 히스토그램을 합친 뒤 백분위수를 계산해야 합니다. [Prometheus의 히스토그램 설명](https://prometheus.io/docs/practices/histograms/)은 분포를 집계하는 방식과 사전에 계산한 백분위수를 구분해 다룹니다.

주문 서비스의 Duration은 classic histogram으로 기록한다고 가정하겠습니다. 아래 식은 모든 인스턴스의 버킷 경계가 같다는 조건에서 성공 요청의 버킷을 합치고 P95를 추정합니다. 결과 단위는 초입니다.

```promql
histogram_quantile(
  0.95,
  sum by (service, route, le) (
    rate(shop_http_request_duration_seconds_bucket{outcome="success"}[5m])
  )
)
```

여기서 `le`는 버킷 상한을 나타내는 라벨입니다. P95의 정확도는 버킷 구성에 영향을 받습니다. 따라서 이 추정값을 개별 요청의 시간을 정밀하게 측정한 값처럼 해석해서는 안 됩니다. Native histogram은 메트릭을 노출하는 형태와 집계식이 다르며, 선택 기준은 [공식 히스토그램 문서](https://prometheus.io/docs/practices/histograms/)에 나와 있습니다.

예제에 사용한 5분은 설명을 위한 관찰 구간입니다. 모든 서비스의 경보에 그대로 적용할 설정값은 아닙니다.

## 지표의 변화에서 원인 후보를 찾기

가상의 주문 서비스에서 처리량은 비슷한데 실패율과 P95가 높아졌다고 가정하겠습니다. 조사할 출발점은 변화가 시작된 경로입니다. 해당 경로가 호출하는 내부 서비스의 RED와 비교하고, 특정 내부 서비스의 지연이 먼저 늘었다면 그 서비스를 원인 후보로 살펴봅니다.

시간상 함께 변했다는 사실만으로 원인을 확정할 수는 없습니다. 로그와 트레이스, 변경 이력을 확인해 가설이 맞는지 검증해야 합니다.

자원 병목이 의심될 때는 [USE Method]({{< relref "/engineering/sre/03-use-method/index.md" >}})로 CPU·메모리·저장장치 등의 사용률, 포화, 오류를 조사합니다. 요청이 겪는 상태를 RED로 확인하고, 그 요청을 처리하는 자원은 USE로 살펴보는 접근입니다. Tom Wilkie도 두 방법을 함께 쓰도록 제안했습니다.

05편에서 다루는 [Four Golden Signals]({{< relref "/engineering/sre/05-four-golden-signals/index.md" >}})는 요청 지연·트래픽·오류에 서비스의 포화 상태를 더해 살피는 관점입니다.

## 참고 자료

- [The RED Method: How to Instrument Your Services — Grafana Labs](https://grafana.com/blog/the-red-method-how-to-instrument-your-services/): Julie Dam이 정리한 Tom Wilkie의 발표와 RED Method의 목적.
- [Instrumentation — Prometheus](https://prometheus.io/docs/practices/instrumentation/): 서비스 유형별 계측 기준과 요청·실패의 측정 시점.
- [Histograms and summaries — Prometheus](https://prometheus.io/docs/practices/histograms/): 지연 분포의 집계와 백분위수 추정.
- [Metric and label naming — Prometheus](https://prometheus.io/docs/practices/naming/): 메트릭의 단위·이름과 라벨 설계.
