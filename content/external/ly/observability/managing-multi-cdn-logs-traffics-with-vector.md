---
title: "Vector로 개선한 멀티 CDN 로그·트래픽 모니터링"
description: "LINE의 Enablement Engineering 팀이 직접 개발한 익스포터를 Vector의 log_to_metric으로 바꾸고 쿠버네티스 위에 Vector 클러스터를 세운 과정을 정리했습니다. 로그 소실을 막은 버퍼링 모델과 클러스터 모니터링도 요약합니다."
date: 2026-11-14
weight: 8
---

# Vector로 개선한 멀티 CDN 로그·트래픽 모니터링 (2023-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Vector를 활용해 멀티 CDN 로그 및 트래픽 관리하기](https://techblog.lycorp.co.jp/ko/managing-multi-cdn-logs-traffics-with-vector)
- 매체 · 게시일: LY Corporation Tech Blog · 2023-10-13
- 저자: 어다희 (Enablement Engineering 팀, SRE)
- 원문 내용을 바탕으로 재구성한 요약입니다. 이전 LINE Engineering 블로그의 「Multi CDN 트래픽 모니터링을 위한 클러스터 구축기」(1탄)에 이은 2탄입니다.
{{< /callout >}}

## 개선 목표 {#개선-목표}

Enablement Engineering 팀은 미디어 플랫폼의 SRE와 함께 트래픽의 시작점인 GSLB와 CDN 업무를 맡고 있습니다. 1탄에서 만든 멀티 CDN 모니터링 시스템을 한동안 잘 써 왔지만 개선점이 쌓였고, 원문은 세 가지로 정리합니다.

- 통합: CDN별, 하위 상품별로 데이터 소스와 대시보드가 흩어져 있어 한 곳으로 모아 관리 포인트를 줄입니다.
- 익스포터 대체: 1탄에서 로그를 표준화하며 직접 개발한 익스포터는, CDN 업체가 포맷을 바꾸거나 커스텀 로그 필드를 추가할 때마다 함께 고쳐야 했습니다. 대안을 찾다 발견한 Vector의 `log_to_metric` 기능으로 익스포터를 대체하기로 했습니다.
- 통합 모니터링 체계 기반: CDN과 얽힌 내부 제품과 플랫폼마다 로그·메트릭 수집 체계가 따로 있어서, Vector로 바꾸기 어려운 로그와 메트릭을 재가공해 통합 체계의 기반을 마련합니다.

## Vector 소개 {#vector-소개}

Vector는 Datadog의 오픈소스 프로젝트로, 홈페이지는 자신을 '관찰 가능한 파이프라인을 구축하기 위한 가볍고 매우 빠른 도구'라고 소개합니다. 로그, 메트릭, 트레이스를 수집(Sources)하고 변환(Transforms)해 라우팅(Sinks)하는 구조입니다. 원문의 예시 설정은 표준 입력을 받아 JSON으로 파싱한 뒤 콘솔에 JSON으로 출력합니다.

비슷한 도구와의 차이로 원문은 이렇게 정리합니다. Logstash는 Java 기반이라 JVM이 필요하고 플러그인이 많지만 메모리를 많이 씁니다. Beats는 Golang으로 만든 경량 에이전트입니다. Fluentd는 C로 만든 저용량 메모리 수집기로 플러그인 생태계가 큽니다. FluentBit은 Fluentd의 경량판입니다. Vector는 2019년에 시작된 비교적 새 제품으로, Rust로 개발되어 메모리 안전성과 효율성을 갖추었고 전용 DSL로 데이터를 즉석에서 변환할 수 있으며 정확성과 전송 보장을 내세웁니다.

Vector가 제안하는 아키텍처는 Aggregator, Agent, Unified 세 가지입니다. Aggregator는 여러 업스트림 에이전트나 시스템의 데이터를 받는 방식으로, 가용성이 높고 설정이 쉬우며 복잡한 환경과 대규모 조직에 맞습니다. Agent는 각 노드에 에이전트로 배포해 로컬 데이터를 수집하는 방식으로 단순한 환경에 맞고, 스펙은 vCPU 2개와 RAM 4GB로 제한됩니다. Unified는 에지에서 수집한 뒤 집계하는 두 방식의 결합으로, 원문은 Datadog 파이프라인용 유료 엔터프라이즈 환경으로 설명합니다. 팀은 Aggregator를 골랐습니다.

## 클러스터 구축 {#클러스터-구축}

설치는 쿠버네티스에 Helm 차트로 배포하는 방법을 택했습니다. 공식 차트에는 이번 프로젝트와 무관한 리소스가 많아 차트를 새로 만들었습니다. 구성은 StatefulSet, PersistentVolumeClaim, 서비스, 서비스 어카운트, ConfigMap, HPA입니다. HPA로 클러스터의 유연성을 확보했고, 파드는 podAntiAffinity와 topologySpreadConstraints를 함께 써서 노드에 고르게 분배했습니다. 설정 파일이 세 개라 실행 인자는 `--config-dir /etc/vector/`로 주고 ConfigMap으로 마운트했으며, 버퍼용 볼륨은 `volumeClaimTemplates`로 PVC를 씁니다. 시작, 동작, 준비 상태는 모두 `/health`로 프로브합니다.

## log_to_metric 파이프라인 {#log-to-metric}

원문 저자는 Vector에서 가장 유용한 기능으로 `log_to_metric`을 꼽습니다. 팀이 쓰는 Akamai는 특성상 로그를 실시간으로 수집하기 어려워서, 이 기능으로 파이프라인을 만들어 상용 CDN을 모니터링합니다. 흐름은 네 단계입니다.

1. Sources: `http_server` 소스가 10010 포트로 CDN 실시간 로그를 text로 받습니다.
2. Transforms(remap): 메시지를 JSON으로 파싱하고 로그를 구분하는 `platform` 값을 달고, 타임스탬프 변환, 소문자 처리, percent 디코딩, IPv4·IPv6 판별 등 정규화를 합니다.
3. Transforms(log_to_metric): 정규화한 로그를 Prometheus 메트릭으로 바꿉니다. 타입은 counter, gauge, histogram, summary 중에서 고르고, `namespace`가 메트릭 이름 앞의 접두사가 됩니다. 원문의 예는 요청 수를 세는 `http_requests_total`(counter)과 응답 지연 `http_response_latency_milliseconds`(summary)입니다.
4. Sinks: 메트릭은 `prometheus_remote_write`로 Prometheus에, 정규화된 로그는 Kafka 토픽(`cdn.access_log`)으로 보냅니다.

설정 구조는 `vector graph` 명령으로 DOT 파일을 뽑아 GraphvizOnline에서 시각화할 수 있고, 이때 Sources는 정방향 사다리꼴, Transforms는 마름모, Sinks는 역방향 사다리꼴로 나옵니다. 결과는 Prometheus에서 `namespace` 접두사가 붙은 메트릭과 태그 값으로, Kibana에서는 `platform` 값으로 구분되는 로그로 확인했습니다.

## 로그 소실과 버퍼링 모델 {#버퍼링}

순조로워 보였지만 기존 익스포터로 받던 로그와 견주어 보니 일부 로그가 빠져 있었습니다. 원인은 Sinks가 실시간으로 모든 이벤트를 처리하지 못한 것이었고, Vector의 버퍼링 모델을 적용해 풀었습니다. 이 모델은 Sink가 처리할 수 있는 양보다 많은 이벤트가 들어올 때, 운영자가 성능과 내구성 중 무엇을 우선할지 고르게 해 줍니다. 원문 표의 개념은 이렇습니다. Buffer는 데이터를 잠시 담아 속도를 조절하는 영역, Batching은 버퍼의 데이터를 묶어 한 번에 처리해 효율을 높이는 일, Backpressure는 처리 속도가 버퍼링 속도를 넘을 때 속도를 제한해 손실을 막는 장치입니다. 적용한 뒤에는 Vector에 데이터가 차곡차곡 쌓였고 로그가 더는 사라지지 않았습니다. 설정은 Sink마다 `buffer.type = "disk"`와 용량 제한, 가득 찼을 때의 동작(`when_full`)으로 줍니다. 메트릭 Sink는 `drop_newest`, 로그를 Kafka로 보내는 Sink는 `block`입니다.

## Vector 모니터링과 부가 기능 {#모니터링}

Vector 자체는 `internal_metrics` 소스로 모니터링하고, 클러스터 상태는 노드별 node_exporter와 kube-state-metrics로 봅니다. 대시보드는 세 영역입니다. 노드별 Vector 파드 수와 CPU·메모리, Sources·Transforms·Sinks의 이벤트 수와 bytes/sec, 선택한 노드의 세부 정보입니다. 이 대시보드는 Grafana Labs에 Vector Cluster Monitoring(ID: 19611)으로 공유되어 있습니다.

원문은 그 밖의 기능으로 세 가지를 소개합니다. `vector top`은 동작 중인 Vector 프로세스의 주요 지표를 CLI에서 보여 줍니다. `vector tap`은 컴포넌트의 입출력을 들여다보며, `--inputs-of`와 `--outputs-of` 옵션을 씁니다. `vector vrl`은 VRL(Vector Remap Language)을 CLI에서 시험해 보는 기능으로 웹 버전도 있습니다.

{{% details title="구성 값 요약" closed="true" %}}
| 항목 | 값 |
|---|---|
| 쿠버네티스 노드 | CPU 8 core, RAM 32GB, SSD 100GB, 6대 |
| Akamai 로그 수신 | `http_server`, 포트 10010, text 인코딩 |
| 메트릭 Sink 버퍼 | disk, 2684354560 bytes(2.5GiB), 가득 차면 `drop_newest` |
| 로그 Sink(Kafka) 버퍼 | disk, 2684354560 bytes, 가득 차면 `block` |
| 종료 대기 | `VECTOR_GRACEFUL_SHUTDOWN_LIMIT_SECS=30` |
| 헬스 체크 | `/health`, 포트 8686 |
{{% /details %}}

## 마무리에서 짚은 점 {#마무리}

팀은 Vector로 1탄의 익스포터를 대체하고 통합 모니터링의 기반을 마련했으며, 쿠버네티스에 올려 오토 스케일링 같은 설정 업데이트 자동화도 구현했다고 정리합니다. 새 CDN이 추가되거나 기존 설정이 바뀌어도 Vector로 더 쉽고 빠르게 모니터링하기를 기대한다고 합니다. 저자도 Vector를 이번에 처음 써 보았고 국내 참고 자료가 많지 않아 시행착오가 많았다고 밝힙니다.
