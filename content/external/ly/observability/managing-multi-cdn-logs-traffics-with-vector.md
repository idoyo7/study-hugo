---
title: "멀티 CDN 모니터링의 관리 부담을 줄인 Vector 클러스터"
description: "CDN 로그가 바뀔 때마다 익스포터를 고쳐야 하는 부담을 어떻게 줄였을까요? LINE Enablement Engineering 팀은 Vector의 log_to_metric으로 익스포터를 대체하고, 버퍼링을 적용한 쿠버네티스 클러스터에 통합 모니터링의 기반을 마련했습니다."
date: 2026-11-14
weight: 8
---

# 멀티 CDN 모니터링의 관리 부담을 줄인 Vector 클러스터 (2023-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Vector를 활용해 멀티 CDN 로그 및 트래픽 관리하기](https://techblog.lycorp.co.jp/ko/managing-multi-cdn-logs-traffics-with-vector)
- 매체 · 게시일: LY Corporation Tech Blog · 2023-10-13
- 저자: 어다희 (Enablement Engineering 팀, SRE)
- 원문 내용을 바탕으로 재구성한 요약입니다. 이전 LINE Engineering 블로그의 「Multi CDN 트래픽 모니터링을 위한 클러스터 구축기」(1탄)에 이은 2탄입니다.
{{< /callout >}}

## 로그가 바뀔 때마다 함께 고치던 익스포터 {#개선-목표}

LINE Enablement Engineering 팀은 미디어 플랫폼의 SRE와 트래픽의 시작점인 GSLB·CDN 업무를 맡고 있습니다. 1탄에서 만든 모니터링 시스템은 잘 돌아갔습니다. 익스포터는 계속 손봐야 했습니다. CDN 업체가 로그 포맷을 바꾸거나 커스텀 로그 필드를 추가할 때마다, 로그를 표준화하려고 직접 개발한 익스포터도 함께 수정해야 했기 때문입니다.

흩어진 모니터링도 과제였습니다. CDN별·하위 상품별로 데이터 소스와 대시보드가 나뉘어 있었고, CDN과 연결된 내부 제품·플랫폼도 저마다 로그와 메트릭을 수집하고 있었습니다. 데이터 소스와 대시보드를 한곳에 모아 관리 지점을 줄이면서, 내부 제품까지 아우를 통합 모니터링의 기반을 마련하려 했습니다.

팀이 고른 대안은 Vector입니다. `log_to_metric`으로 익스포터를 대체하고, Vector로 바로 바꾸기 어려운 로그와 메트릭은 재가공해 통합의 기반을 만들었습니다. 새 CDN이 추가되거나 기존 CDN 설정이 바뀔 때 더 쉽고 빠르게 모니터링할 수 있으리라는 기대도 있습니다.

## 수집부터 전송까지 설정으로 연결하는 Vector {#vector-소개}

Vector는 Datadog의 오픈소스 프로젝트입니다. Sources에서 로그·메트릭·트레이스를 수집하고, Transforms에서 변환한 뒤, Sinks에서 외부 서비스로 보냅니다. 표준 입력을 받아 JSON으로 파싱하고 콘솔에 JSON으로 출력하는 설정도 이 흐름으로 작성합니다. CDN 로그를 메트릭으로 만드는 작업은 이 가운데 변환 단계에 들어갑니다.

로그를 모으는 도구는 이미 여럿입니다. Java 기반인 Logstash는 JVM이 필요하고 플러그인이 풍부하지만 메모리를 많이 씁니다. Golang으로 만든 Beats는 경량 에이전트이며, C로 만든 Fluentd는 메모리를 적게 쓰는 수집기로 플러그인 생태계가 큽니다. FluentBit은 Fluentd를 경량화한 도구입니다.

2019년에 시작된 Vector는 비교적 새로운 제품입니다. Rust로 개발돼 메모리 안전성과 효율성을 갖췄으며, 정확성과 전송 보장을 내세웁니다. 전용 DSL로 데이터를 즉석에서 변환하는 기능도 제공합니다. 팀은 그 변환 기능 중 로그를 메트릭으로 바꾸는 `log_to_metric`을 익스포터 대신 사용했습니다.

## Akamai 로그를 메트릭으로 바꾸는 경로 {#log-to-metric}

팀이 사용하는 Akamai는 특성상 로그와 메트릭을 실시간으로 수집하기 어려웠습니다. 이를 해결하려고 `log_to_metric`을 사용하는 파이프라인을 만들었습니다. 저자가 Vector에서 가장 유용하게 꼽은 기능이기도 합니다.

입구는 `http_server` 소스입니다. 10010 포트로 text 데이터를 받아 `remap`에 넘기면, 메시지를 JSON으로 파싱하고 여러 로그를 구별할 `platform` 값을 붙입니다. 타임스탬프 변환, 소문자 처리, percent 디코딩, IPv4·IPv6 판별도 여기서 수행합니다. 메트릭을 만들기 전에 로그를 정규화하는 단계입니다.

이어서 `log_to_metric`이 정규화한 로그를 Prometheus 메트릭으로 바꿉니다. 설정 예제에서는 요청 수를 `http_requests_total`이라는 counter로, 응답 지연을 `http_response_latency_milliseconds`라는 summary로 만듭니다. 메트릭 유형은 counter, gauge, histogram, summary 중에서 선택하며, `field`에는 입력받은 데이터 안에 실제로 존재하는 필드를 지정해야 합니다. `namespace`에 지정한 값은 메트릭 이름의 접두사가 됩니다.

정규화한 로그도 별도로 보냅니다. 메트릭은 `prometheus_remote_write`로 Prometheus에 전송하고, 로그는 Kafka의 `cdn.access_log` 토픽으로 보냅니다. 전송 후 Prometheus에서는 접두사와 태그가 붙은 메트릭을 확인했고, Kibana에서는 `platform` 값으로 로그를 구분해 쌓이는 모습을 확인했습니다.

## 전송이 순조로워 보일 때 사라진 로그 {#버퍼링}

결과가 보인다고 끝난 일은 아니었습니다. 기존 익스포터로 받던 로그와 비교하자 일부가 빠져 있었습니다. Sinks가 들어오는 이벤트를 실시간으로 모두 처리하지 못한 것이 원인이었습니다. 팀은 이 지점에 Vector의 버퍼링 모델을 적용했습니다.

버퍼링 모델은 Sink가 처리할 수 있는 양보다 많은 이벤트가 들어올 때 성능과 내구성 중 무엇을 우선할지 정하는 기능입니다. 버퍼는 데이터를 잠시 저장해 처리 속도를 조절하고, Batching은 쌓인 데이터를 묶어 한 번에 처리해 효율을 높입니다.

이 파이프라인에서는 메트릭과 로그 Sink 모두 `buffer.type = "disk"`로 설정했습니다. 용량 제한과 함께 정해야 하는 값은 버퍼가 가득 찼을 때의 동작인 `when_full`입니다. Prometheus로 보내는 메트릭 Sink에는 `drop_newest`를, Kafka로 보내는 로그 Sink에는 `block`을 지정했습니다. 목적지가 다른 두 Sink에 같은 동작을 적용하지 않은 설정입니다.

버퍼링을 적용한 뒤에는 데이터가 Vector에 차곡차곡 쌓였습니다. 팀은 이전에 발견했던 로그 소실이 더는 나타나지 않는 것도 확인했습니다.

## 디스크 버퍼를 보관하는 StatefulSet {#클러스터-구축}

이 파이프라인을 배치한 방식은 Aggregator입니다. 여러 업스트림 에이전트나 시스템에서 데이터를 받는 형태로, 가용성이 높고 설정이 쉬우며 복잡한 환경과 대규모 조직에 적합합니다.

Vector에는 다른 배치 방식도 있습니다. Agent는 각 노드에서 로컬 데이터를 수집하고 처리하는 형태로 단순한 환경에 맞으며, 스펙은 vCPU 2개와 RAM 4GB로 제한됩니다. Unified는 Agent와 Aggregator를 결합해 에지에서 수집한 데이터를 집계하는 방식입니다. Datadog의 유료 엔터프라이즈 파이프라인 구축에도 사용됩니다.

팀은 쿠버네티스 노드 6대에 Helm 차트로 Vector를 배포했습니다. 공식 차트에는 이번 프로젝트와 관련 없는 리소스가 많아 차트를 새로 만들었습니다. 구성에는 StatefulSet과 PersistentVolumeClaim(PVC), 서비스, 서비스 어카운트, ConfigMap, HPA가 들어갑니다. 디스크 버퍼는 StatefulSet의 `volumeClaimTemplates`로 만든 PVC를 사용하며, 컨테이너의 `/var/lib/vector`에 마운트합니다.

파드 배치와 확장도 설정했습니다. `podAntiAffinity`와 `topologySpreadConstraints`를 함께 사용해 파드를 노드에 고르게 분배하고, HPA로 오토 스케일링을 구성했습니다. 설정 파일은 세 개여서 실행 인자를 `--config-dir /etc/vector/`로 지정하고 ConfigMap으로 마운트했습니다. 시작 여부와 동작 여부, 준비 상태를 확인하는 프로브는 모두 `/health`를 사용합니다.

## 파이프라인 안쪽을 들여다보는 Vector 운영 도구 {#모니터링}

이제 Vector 자체가 잘 처리하는지도 확인해야 합니다. 팀은 Vector가 제공하는 `internal_metrics` 소스를 사용하고, 쿠버네티스 클러스터 상태는 노드별 node_exporter와 kube-state-metrics로 모니터링합니다.

대시보드에는 노드별 Vector 파드 수와 CPU·메모리 사용량, Sources·Transforms·Sinks로 들어오는 이벤트 수와 bytes/sec, 선택한 노드의 상세 정보를 모았습니다. Transforms와 Sinks의 사용량도 표시합니다. 이 대시보드는 Grafana Labs에 Vector Cluster Monitoring(ID: 19611)이라는 이름으로 공유되어 있습니다.

설정의 연결 관계나 실행 중인 컴포넌트를 확인할 때는 CLI 기능도 사용할 수 있습니다.

- `vector graph`: 설정을 DOT 파일로 출력하는 명령. GraphvizOnline에서 시각화하면 Sources는 정방향 사다리꼴, Transforms는 마름모, Sinks는 역방향 사다리꼴로 표시
- `vector top`: 실행 중인 로컬 또는 원격 Vector 프로세스의 주요 지표 확인
- `vector tap`: `--inputs-of`와 `--outputs-of` 옵션으로 컴포넌트의 입출력 확인
- `vector vrl`: VRL(Vector Remap Language)을 CLI에서 시험하는 기능. 웹 버전도 제공

{{% details title="클러스터와 Sink의 설정 값" closed="true" %}}
| 항목 | 값 |
|---|---|
| 쿠버네티스 노드 | CPU 8 core, RAM 32GB, SSD 100GB, 6대 |
| Akamai 로그 수신 | `http_server`, 포트 10010, text 인코딩 |
| 메트릭 Sink 버퍼 | disk, 2684354560 bytes(2.5GiB), 가득 차면 `drop_newest` |
| 로그 Sink(Kafka) 버퍼 | disk, 2684354560 bytes, 가득 차면 `block` |
| 종료 대기 | `VECTOR_GRACEFUL_SHUTDOWN_LIMIT_SECS=30` |
| 헬스 체크 | `/health`, 포트 8686 |
{{% /details %}}
