---
title: "Ingress Nginx Controller의 Prometheus Metric 유실 원인 추적 (1부)"
description: "카카오 광고 추천팀이 고트래픽 시간대에 Nginx request volume이 No Data가 된 현상을 추적한 1부입니다. Pod 구조와 소켓, goroutine 누적을 근거로 병목이 Metric 처리부에 있다고 좁혀 갑니다."
date: 2026-11-14
weight: 2
---

# Ingress Nginx Controller의 Prometheus Metric 유실 원인 추적 (1부) (2025-01)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Ingress Nginx Controller의 Prometheus Metric 병목 현상: 원인 분석과 해결 (1부)](https://tech.kakao.com/posts/683)
- 매체 · 게시일: 카카오 기술블로그 · 2025-01-17
- 저자: pooh.duck (카카오 광고 추천팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 시리즈 위치 {#series}

2부작 중 1부입니다. 문제가 나타난 배경과 원인을 좁혀 가는 과정을 다루고, Go 프로파일링으로 근본 원인을 확인하고 해결하는 내용은 [2부]({{< relref "/external/kakao/observability/684-ingress-nginx-metric-bottleneck-2.md" >}})로 넘깁니다.

## 배경 {#background}

필자가 맡은 광고 API 서버 중 하나는 피크 시간대에 최대 약 16만 req/sec를 처리합니다. 서버는 Kubernetes 위에서 여러 Pod로 돌고, HTTP(S) 트래픽은 Ingress로 라우팅하며, 구현체는 가장 범용적인 Ingress Nginx Controller입니다. 재해 복구와 부하 분산을 위해 두 Region에 걸쳐 Ingress Nginx Controller를 여럿 운영합니다. 서비스 지표는 Prometheus로 수집하고 Grafana로 봅니다.

## 증상, 모든 Nginx request volume이 No Data {#symptom}

어느 날 모든 Nginx의 request volume이 No Data라는 알람이 떴습니다. 간헐적으로 찍힌 값도 정상치보다 훨씬 낮았습니다. 그런데 서비스를 점검하니 서버는 요청을 정상 처리하고 있었습니다. Nginx 자체에 문제가 있었다면 불가능한 일입니다.

현상은 트래픽이 일정 기준을 넘으면 재현되었습니다. Metric이 요동치다 유실되고, 트래픽이 줄면 복구되었습니다. Nginx의 CPU는 Resource Limit에 비해 여유가 있었고 Spike도 없었습니다. 원문은 다음 세 가지를 근거로 Nginx가 아니라 Metric을 처리하는 부분에 문제가 생겼다고 판단했습니다.

- 서버가 요청을 정상 처리하고 있다.
- Metric이 0이 아니라 No Data다.
- Nginx CPU 부하가 높지 않다.

## Pod 구조와 소켓 {#pod-structure}

CPU와 달리 Memory는 비정상적으로 치솟았습니다. Ingress Nginx Controller Pod는 두 프로세스로 이루어집니다. 실제 트래픽을 처리하는 Nginx, 그리고 Metric 수집 같은 부가 기능을 맡는 Ingress Nginx Controller(이하 Controller)입니다. Nginx는 Lua 스크립트로 `/tmp/prometheus-nginx.socket`을 통해 Controller에 Metric을 보냅니다.

문제 시점에 Open된 File Descriptor 수(`open_fds`)가 Memory 사용량과 같이 치솟았고, 노드에서 실제 소켓을 보니 `prometheus-nginx.socket`이 3,000개 넘게 쌓여 있었습니다.

## 병목 지점 찾기 {#finding-bottleneck}

소스 코드 수준에서 소켓의 양쪽 끝을 따라갔습니다.

송신 쪽인 Nginx의 Lua 스크립트(`monitor.lua`)는 `FLUSH_INTERVAL`(1초)마다 `MAX_BATCH_SIZE`(10000)만큼의 Metric을 처리하도록 되어 있고, 한도를 넘으면 전송하지 않고 버리고 Warn 로그를 남깁니다. 기본값으로 초당 1만이 상한이라, 이 구조는 트래픽과 상관없이 정해진 최대 처리량까지만 지원합니다. 그래서 여기서 병목이 날 가능성은 매우 낮다고 봤습니다.

수신 쪽은 다릅니다. Go로 작성된 Controller는 `NewSocketCollector`로 `SocketCollector`를 만들어 소켓을 Listen하고, `Start()`가 연결 요청마다 소켓을 Open하고 Goroutine을 만들어 `handleMessages()`를 실행합니다. 처리 속도가 트래픽에 따라 느려지면 Goroutine이 쌓입니다. Grafana에서 실제로 Memory 그래프와 같은 양상으로 Goroutine이 계속 쌓이는 것이 확인되었습니다.

이 시점에는 `handleMessages()`가 왜 느려지는지 확신할 수 없었습니다. 필자는 병렬로 Metric을 처리하는 곳에는 Critical Section이 있기 마련이니, 이를 보호하는 Mutex 로직이 원인일 수 있다고 추측했습니다. 이 추측을 Go 프로파일링으로 검증하는 것이 2부의 일입니다.

{{% details title="1부에서 확인한 수치" closed="true" %}}

| 항목 | 값 |
|---|---|
| 피크 트래픽 | 최대 약 16만 req/sec |
| Nginx Lua 기본 상한 | MAX_BATCH_SIZE 10000 / FLUSH_INTERVAL 1초 = 초당 1만 |
| 쌓인 소켓 | 3,000개 이상 |

{{% /details %}}
