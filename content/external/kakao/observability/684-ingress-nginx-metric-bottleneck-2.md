---
title: "Ingress Nginx Controller의 summary Metric 락 경합과 해결 (2부)"
description: "goroutine 프로파일로 병목을 확인하고, summary 타입 upstreamLatency의 Mutex 경합이 메모리 증가와 Metric 유실을 모두 일으킨 과정을 정리한 2부입니다. 두 해결안 중 Ingress 노드 증설을 택한 이유도 다룹니다."
date: 2026-11-14
weight: 3
---

# Ingress Nginx Controller의 summary Metric 락 경합과 해결 (2부) (2025-01)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Ingress Nginx Controller의 Prometheus Metric 병목 현상: 원인 분석과 해결 (2부)](https://tech.kakao.com/posts/684)
- 매체 · 게시일: 카카오 기술블로그 · 2025-01-17
- 저자: aiden.song (카카오 광고 추천팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 시리즈 위치 {#series}

2부작 중 2부입니다. [1부]({{< relref "/external/kakao/observability/683-ingress-nginx-metric-bottleneck-1.md" >}})에서 병목이 Controller의 Metric 처리부일 것이라 추정하고 마무리했고, 2부는 그 추정을 확인한 뒤 원인과 해결을 다룹니다. 글은 Golang, Kubernetes, Prometheus의 기본 이해를 전제로 합니다.

## Controller 프로세스 구성 {#controller-layout}

Ingress Nginx Controller(이하 IC) Pod에는 IC, Nginx master, Nginx worker 세 종류의 프로세스가 돌며 Pod의 리소스를 공유합니다. 그래서 IC 프로세스의 메모리가 늘어도 Pod의 메모리 사용량이 늘어납니다. IC 프로세스는 Nginx 프로세스를 실행하고 관리하며, Kubernetes 리소스로 관리되는 Nginx 설정을 동기화하고, 설정 제어와 메트릭 수집을 맡습니다. 이번 문제의 중심은 마지막인 메트릭 수집입니다.

## goroutine 프로파일로 확인한 병목 {#goroutine-profile}

Go의 프로파일 기능으로 `handleMessages()` 안의 goroutine 영역을 확인했습니다. goroutine이 총 4309개였고 그중 4213개가 같은 스택에 있었습니다. 호출 스택은 `SocketCollector.handleMessage`가 `prometheus.(*summary).Observe`에서 Mutex Lock을 얻으려고 block된 상태였습니다. 1부의 추정이 맞은 것입니다. 당시 쓰던 Ingress Controller 버전은 v1.5.1입니다.

`handleMessage()`는 소켓으로 받은 JSON을 `socketData` 배열로 바꾸고 유효한 항목마다 Prometheus 메트릭을 기록합니다. 막히는 곳은 `latencyMetric.Observe(stats.Latency)`였습니다. `Observe()`는 값을 기록할 때 `s.bufMtx.Lock()`을 잡습니다. I/O 비용을 줄이려고 buffer를 쓰고, Go의 `append`가 thread safe하지 않아 buffer 쓰기(`s.hotBuf = append(s.hotBuf, v)`)가 임계 영역이기 때문입니다.

그렇다면 왜 `Observe()`가 느린가. Prometheus의 분위값 메트릭은 histogram과 summary 두 가지이고, 대표적인 차이는 summary가 저장은 느리고 분위 조회가 빠르며 histogram은 저장이 빠르고 조회가 느리다는 점입니다. Nginx가 보낸 메트릭은 summary, histogram, counter 등 여러 타입으로 수집되는데, summary 타입인 `upstreamLatency`를 수집하는 데 연산이 더 들어 병목이 되었고 경합이 심해졌다는 설명입니다.

원문의 상황 정리는 이렇습니다. Nginx가 요청을 처리하며 만든 데이터를 모아 1초마다 IC로 보냅니다. IC가 `upstreamLatency`를 summary로 저장하는 데 지연이 생기고 `Unlock()`이 늦어 Lock 경합이 커집니다. IC는 1초 안에 처리하지 못해 goroutine과 처리하지 못한 `socketData` 배열이 쌓이고 메모리 점유율이 계속 늘어납니다.

## No Data가 생긴 이유 {#no-data}

이로써 메모리 증가는 설명되지만 No Data와는 이어지지 않습니다. Prometheus는 Pull 방식입니다. 서버가 수집 대상을 돌며 메트릭을 시간과 함께 저장하는 반면, 수집 대상 애플리케이션인 IC는 시간별 데이터를 쌓지 않고 항상 최신 값만 갖고 있다가 전달합니다. 따라서 IC가 Nginx 메트릭을 처리하지 못하더라도 그때까지 모은 값을 줄 수 있어, 그것만으로는 No Data가 생기지 않습니다. No Data는 Prometheus 서버가 IC에서 메트릭을 가져오다 Timeout 같은 에러로 실패해 그 시점 값을 null로 저장했을 때 생깁니다.

IC가 `/metrics` 응답을 만들 때 summary 타입은 `Write()`를 호출하고, 여기서도 `s.bufMtx.Lock()`을 잡습니다. 응답을 만들기 전에 buffer를 flush해 최신 데이터를 반영하려는 것입니다. 그런데 `Observe()`가 이미 많은 goroutine으로 Lock을 다투고 있어 `Write()`가 오래 block됩니다. 응답이 제때 나가지 못해 Timeout이 나고 Pull이 실패합니다.

| 문제 상황 | 원인 |
|---|---|
| File descriptor와 메모리 증가 | IC의 메트릭 수집 지연으로 소켓, goroutine, 메트릭 객체가 쌓임. 지연은 summary 데이터를 쌓는 과정의 Lock 경합 때문 |
| Prometheus Metric 유실 | Prometheus 서버의 수집 중 Timeout. IC가 응답을 만드는 과정에서 summary Lock 경합이 생겨서 |

## 해결 방안 두 가지 {#options}

첫째는 ingress-nginx 리소스 증설입니다. Nginx 지표는 기본적으로 1초에 최대 1만 개까지만 전달되고 넘으면 버려집니다. 운영 이력상 Nginx 한 대가 7~8K 수준을 받을 때는 문제가 없었고, 10K에 가까워진 시점부터 지표 누락과 메모리 증가가 시작되었습니다. IC 프로세스 하나가 처리할 양을 줄이면 해결되므로 Scale out은 가장 간단하지만 비싼 방법입니다.

둘째는 병목 지점을 없애는 것입니다. 소스에서 `upstreamLatency`는 `sc.upstreamLatency != nil`일 때만 수집하고, `summaryMetric()`은 제외 목록에 `ingress_upstream_latency_seconds`가 있으면 nil을 반환합니다. 실행 인자 `exclude-socket-metrics`에 그 이름을 넣으면 수집을 끌 수 있습니다.

## 선택한 해결 {#decision}

담당자 회의를 거쳐 Ingress 노드 증설로 정했습니다. 이유는 두 가지였습니다.

- Nginx 기본 설정이 초당 1만 개를 넘는 메트릭을 버리므로, IC에서 upstream latency를 제외해 병목을 없애도 메트릭 누락은 여전히 생깁니다.
- 수집을 끄려면 IC 실행 인자를 바꾸도록 Ingress-Nginx Helm Chart를 고쳐 배포해야 합니다. 전사 공통 Chart를 고치면 upstream latency를 모니터링하는 다른 서비스에 영향이 갈 수 있고, 광고 추천 조직만 별도 Chart로 운영하는 것도 장기적인 운영 리스크가 우려되었습니다.

## upstreamLatency의 근황 {#upstream-latency-status}

원문에 따르면 `upstreamLatency`는 과거부터 deprecated된 지표인데 하위 호환성 때문에 기본으로 수집되고 있었습니다. 2024년 12월 말에 릴리즈된 v1.12.0에서 드디어 기본 집계 대상에서 빠졌습니다.

{{% details title="확인한 수치와 설정" closed="true" %}}

| 항목 | 값 |
|---|---|
| 사용 버전 | Ingress Controller v1.5.1, client_golang v1.14.0 |
| goroutine 프로파일 | 총 4309개 중 4213개가 `Observe()`의 Mutex 대기 |
| Nginx 한 대당 문제없던 트래픽 | 7~8K |
| 지표 누락과 메모리 증가가 시작된 트래픽 | 10K 근처 |
| 수집 제외 인자 | `exclude-socket-metrics`에 `ingress_upstream_latency_seconds` 추가 |
| 기본 수집에서 제외된 버전 | v1.12.0 |

{{% /details %}}
