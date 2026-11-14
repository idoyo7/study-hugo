---
title: "Ingress Nginx Controller의 메트릭을 막은 락 (2부)"
description: "summary 메트릭의 락 경합이 Ingress Nginx Controller의 메모리 증가와 No Data를 일으켰습니다. 메트릭 전달 한도와 전사 공통 Helm Chart의 운영 조건 때문에 수집 중단 대신 노드 증설을 택했습니다."
date: 2026-11-14
weight: 3
---

# Ingress Nginx Controller의 메트릭을 막은 락 (2부) (2025-01)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Ingress Nginx Controller의 Prometheus Metric 병목 현상: 원인 분석과 해결 (2부)](https://tech.kakao.com/posts/684)
- 매체 · 게시일: 카카오 기술블로그 · 2025-01-17
- 저자: aiden.song (카카오 광고 추천팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 병목을 찾고도 늘리기로 한 Ingress 노드 {#decision}

Nginx 한 대가 7~8K 수준의 트래픽을 받을 때는 문제가 없었습니다. 카카오 광고 추천팀의 운영 이력에서는 트래픽이 10K에 가까워지면서 지표 누락과 메모리 증가가 나타났습니다. 조사 끝에 메트릭 수집을 끄는 방법도 찾았지만, 담당자들이 고른 해법은 Ingress 노드 증설이었습니다.

[1부]({{< relref "/external/kakao/observability/683-ingress-nginx-metric-bottleneck-1.md" >}})에서 의심한 병목은 Nginx worker가 소켓으로 보낸 메트릭을 Controller가 처리하는 구간입니다. 2부는 그 추정을 프로파일과 코드로 확인하고, 병목을 찾고도 증설을 택한 이유까지 이어집니다. Golang, Kubernetes, Prometheus의 기본 이해를 전제로 합니다.

## 4213개 고루틴이 기다린 summary의 락 {#goroutine-profile}

Ingress Nginx Controller(이하 IC) Pod에서는 IC, Nginx master, Nginx worker 프로세스가 리소스를 공유합니다. IC는 Nginx 프로세스를 실행하고 관리하며, Kubernetes 리소스로 관리하는 Nginx 설정을 동기화하고 메트릭을 수집합니다. IC 프로세스의 메모리가 늘어도 Pod 메모리가 증가하는 구성입니다.

당시 Ingress Controller 버전은 v1.5.1이었습니다. Go의 goroutine 프로파일로 `handleMessages()` 안의 고루틴을 확인하자 총 4309개 중 4213개가 같은 스택에서 대기하고 있었습니다. `SocketCollector.handleMessage`가 호출한 `prometheus.(*summary).Observe`에서 Mutex를 얻으려다 막힌 상태입니다.

`handleMessage()`는 소켓으로 받은 JSON을 `socketData` 배열로 바꾸고 유효한 항목을 메트릭에 기록합니다. 대기가 생긴 호출은 `latencyMetric.Observe(stats.Latency)`였습니다. `Observe()`는 I/O 비용을 줄이려고 쓰는 버퍼를 `s.bufMtx.Lock()`으로 잠급니다. 값을 추가하는 `s.hotBuf = append(s.hotBuf, v)`가 임계 영역이고, Go의 `append`가 thread safe하지 않기 때문입니다.

문제는 락을 놓기까지 걸리는 시간이었습니다. Prometheus에서 분위값을 다루는 summary는 저장이 느린 대신 조회가 빠르고, histogram은 저장이 빠른 대신 조회가 느립니다. IC는 summary, histogram, counter 등 여러 타입으로 메트릭을 수집하는데, summary 타입인 `upstreamLatency`를 기록하는 데 더 많은 연산이 들었습니다. 그만큼 `Unlock()` 호출이 늦어져 락 경합이 심해진 것입니다.

Nginx는 요청을 처리하며 만든 로그를 모아 1초마다 IC로 보냅니다. IC가 이를 1초 안에 처리하지 못하자 소켓과 고루틴, 처리되지 않은 `socketData` 배열이 계속 쌓였습니다. File descriptor와 메모리가 늘어난 이유입니다.

## 같은 락을 기다리던 /metrics 응답 {#no-data}

메모리 증가를 설명했다고 Grafana의 No Data까지 풀린 것은 아닙니다. 새 메트릭 처리가 밀려도 이전 값은 남아 있습니다. Prometheus 서버는 Pull 방식으로 수집 대상을 주기적으로 방문해 메트릭을 가져오고 수집 시각과 함께 저장합니다. IC는 시간별 이력 대신 최신 값만 보관하므로, 처리가 늦어져도 그때까지 모은 값을 전달할 수 있습니다.

응답을 만드는 경로에도 같은 락이 있었습니다. Prometheus가 `/metrics`를 호출하면 IC는 메모리에 있는 메트릭을 모아 응답을 만듭니다. 이때 summary의 `Write()`는 버퍼에 임시 저장한 값까지 반영하려고 flush를 수행하며, 그 전에 `s.bufMtx.Lock()`을 획득해야 합니다.

이미 `Observe()`를 호출한 많은 고루틴이 그 락을 기다리는 상황입니다. `Write()`도 오래 대기하면서 IC는 제시간에 응답하지 못했습니다. 결국 Timeout으로 Pull이 실패하고, Prometheus가 해당 시점의 값을 null로 저장하면서 No Data가 나타났습니다. 메트릭을 기록하는 경로의 경합이 메트릭을 내보내는 경로까지 지연시킨 것입니다.

## 수집을 꺼도 남는 메트릭 누락 {#options}

코드에는 `upstreamLatency` 수집을 건너뛰는 조건이 이미 있었습니다. `sc.upstreamLatency != nil`일 때만 수집하고, 초기화 함수인 `summaryMetric()`은 제외 목록에 `ingress_upstream_latency_seconds`가 있으면 nil을 반환합니다. IC 실행 인자 `exclude-socket-metrics`에 이 이름을 넣으면 병목을 일으킨 지표 수집을 끌 수 있습니다.

하지만 메트릭은 IC에 도착하기 전에도 빠지고 있었습니다. Nginx는 기본 설정상 1초마다 최대 1만 개의 로그를 전달하고 초과분을 버립니다. `upstreamLatency` 수집을 꺼서 IC의 병목을 없애도, 이 한도를 넘는 메트릭은 계속 누락되는 상황입니다.

수집을 끄려면 IC 실행 인자를 바꿔 Ingress-Nginx Helm Chart를 수정하고 배포해야 했습니다. 이 Chart는 전사 공통으로 쓰고 있었습니다. 변경하면 upstream latency를 모니터링하는 다른 서비스에 영향을 줄 우려가 있었고, 광고 추천 조직만 별도 Chart를 운영하는 방안에도 장기적인 운영 리스크가 따랐습니다.

담당자 회의에서는 이런 조건을 고려해 Ingress 노드를 늘리기로 했습니다. IC 프로세스 하나가 처리할 메트릭 양을 줄이는 Scale out은 가장 간단하지만 비싼 방법이었습니다.

## 기본 집계에서 빠진 upstreamLatency {#upstream-latency-status}

`upstreamLatency`는 이미 deprecated된 지표였습니다. 하위 호환성을 위해 기본 수집을 유지하고 있었지만, 2024년 12월 말에 릴리즈된 v1.12.0에서는 기본 집계 대상에서 제외됐습니다.

{{% details title="진단 당시의 수치와 설정" closed="true" %}}

| 항목 | 값 |
|---|---|
| 사용 버전 | Ingress Controller v1.5.1, client_golang v1.14.0 |
| goroutine 프로파일 | 총 4309개 중 4213개가 `Observe()`의 Mutex 대기 |
| Nginx 한 대당 문제없던 트래픽 | 7~8K |
| 지표 누락과 메모리 증가가 시작된 트래픽 | 10K 근처 |
| 수집 제외 인자 | `exclude-socket-metrics`에 `ingress_upstream_latency_seconds` 추가 |
| 기본 수집에서 제외된 버전 | v1.12.0 |

{{% /details %}}
