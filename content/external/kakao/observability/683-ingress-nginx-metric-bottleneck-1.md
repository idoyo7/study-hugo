---
title: "Ingress Nginx Controller에서 끊긴 Prometheus 지표"
description: "요청은 정상인데 Nginx request volume은 왜 사라졌을까요? 카카오 광고 추천팀은 메모리와 소켓, Goroutine이 함께 늘어나는 양상을 단서로 Metric 수신부의 병목을 의심했습니다."
date: 2026-11-14
weight: 2
---

# Ingress Nginx Controller에서 끊긴 Prometheus 지표 (2025-01)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Ingress Nginx Controller의 Prometheus Metric 병목 현상: 원인 분석과 해결 (1부)](https://tech.kakao.com/posts/683)
- 매체 · 게시일: 카카오 기술블로그 · 2025-01-17
- 저자: pooh.duck (카카오 광고 추천팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 정상 처리 중에도 비어 있던 그래프 {#symptom}

모든 Nginx의 request volume이 No Data라는 알람이 떴습니다. 간헐적으로 기록된 값도 정상치보다 훨씬 낮았습니다. request volume은 Nginx가 처리하는 요청 수인데, 정작 서비스를 점검하니 서버는 요청을 정상적으로 처리하고 있었습니다.

카카오 광고 추천팀 필자가 담당하는 광고 API 서버 하나는 피크 시간대에 최대 약 16만 req/sec를 처리합니다. Kubernetes에서 여러 Pod를 실행하고, Ingress Nginx Controller로 HTTP(S) 트래픽을 라우팅하는 구성입니다. 재해 복구와 부하 분산을 위해 두 Region에 Controller를 여럿 운영하며, 서비스 지표는 Prometheus로 수집해 Grafana로 살핍니다.

현상은 트래픽이 일정 기준을 넘을 때 재현됐습니다. Metric이 요동치다 사라지고, 트래픽이 줄면 복구됐습니다. 그동안 Nginx CPU는 Resource Limit에 비해 여유가 있었고 Spike도 없었습니다.

요청은 정상 처리되는데 Metric은 0이 아닌 No Data였습니다. CPU 부하까지 낮았으므로, 팀은 Nginx의 요청 처리보다 Metric을 처리하는 부분에 문제가 있다고 판단했습니다.

## 메모리와 함께 늘어난 소켓 {#pod-structure}

CPU와 달리 메모리는 비정상적으로 치솟았습니다. 원인을 찾으려면 Pod 안에서 요청 처리와 Metric 수집이 어떻게 나뉘는지부터 살펴봐야 했습니다.

Ingress Nginx Controller Pod에는 실제 트래픽을 처리하는 Nginx와 Metric 수집 같은 부가 기능을 맡는 Ingress Nginx Controller(이하 Controller)가 별도 프로세스로 실행됩니다. Nginx는 Lua 스크립트에서 `/tmp/prometheus-nginx.socket`을 이용해 Controller에 Metric을 보냅니다. 요청 처리가 정상이어도 이 전송 경로는 따로 확인해야 했습니다.

소켓도 커널이 File Descriptor로 관리하는 리소스입니다. 문제 시점에는 열린 File Descriptor 수인 `open_fds`가 메모리 사용량과 함께 치솟았습니다. Kubernetes 노드에서 실제로 열린 소켓을 확인하자, Metric 전송에 쓰는 `prometheus-nginx.socket`이 3,000개 넘게 쌓여 있었습니다.

## 넘치는 Metric을 버리는 Nginx {#finding-bottleneck}

소켓을 사용하는 코드를 따라가 보니 송신부에는 처리량 상한이 있었습니다. Nginx의 `monitor.lua`는 `FLUSH_INTERVAL`마다 `MAX_BATCH_SIZE`만큼의 Metric을 처리하도록 설정되어 있습니다. 기본값은 각각 1초와 10000으로, Nginx worker 하나를 기준으로 초당 1만이 상한입니다.

배치가 차면 이후 요청의 Metric은 전송하지 않습니다. 그대로 버리고 Warn 로그를 남깁니다. 트래픽이 더 늘어도 송신부가 정해진 최대 처리량을 넘겨 보내지는 않는 방식이므로, 팀은 이 부분에서 병목이 생길 가능성이 매우 낮다고 봤습니다.

수신부에도 같은 제한이 있는지는 별개의 문제였습니다. 조사는 Go로 작성된 Controller 쪽으로 이어졌습니다.

## 수신부에 쌓인 Goroutine {#goroutine}

Controller는 `NewSocketCollector`로 `SocketCollector`를 만들고 소켓을 Listen합니다. 이후 `Start()`는 연결 요청마다 소켓을 열고 Goroutine을 생성해 `handleMessages()`를 실행합니다. Go의 경량 스레드인 Goroutine이 연결별로 Metric을 병렬 처리하는 방식입니다.

팀은 트래픽이 늘면서 `handleMessages()`가 느려지고, 처리를 마치지 못한 Goroutine이 누적돼 메모리가 치솟는다고 추측했습니다. Grafana에서도 Goroutine 수가 메모리 사용량과 같은 양상으로 계속 증가하는 것을 확인했습니다.

누적은 확인했지만 함수가 느려지는 이유까지 밝혀진 것은 아니었습니다. 병렬로 Metric을 처리하는 과정에는 Critical Section이 있을 가능성이 높고, 이를 보호하는 Mutex 로직이 병목일 수 있다는 가설이 남았습니다.

이 글은 원인을 좁혀 가는 과정을 담은 2부작 중 1부입니다. 이어지는 [2부]({{< relref "/external/kakao/observability/684-ingress-nginx-metric-bottleneck-2.md" >}})에서는 Go 프로파일링으로 `handleMessages()`가 트래픽 증가에 따라 느려지는 이유를 확인하고 해결 방법을 다룹니다.

{{% details title="1부에서 확인한 수치" closed="true" %}}

| 항목 | 값 |
|---|---|
| 피크 트래픽 | 최대 약 16만 req/sec |
| Nginx Lua 기본 상한 | MAX_BATCH_SIZE 10000 / FLUSH_INTERVAL 1초 = 초당 1만 |
| 쌓인 소켓 | 3,000개 이상 |

{{% /details %}}
