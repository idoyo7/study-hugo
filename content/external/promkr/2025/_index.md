---
title: "promkr 뉴스레터로 본 2025년 Prometheus·Observability 소식"
description: "promkr 뉴스레터 2025년 1월호부터 12월호까지 열두 달 동안 반복된 주제를 묶고, 소식마다 원문을 요약한 호별 문서로 안내한다."
date: 2026-10-26
lastmod: 2026-10-26
weight: 20
comments: false
---

# promkr 뉴스레터로 본 2025년 Prometheus·Observability 소식

promkr 뉴스레터는 매달 Prometheus와 옵저버빌리티 관련 글, 릴리스, 오픈소스 도구를 골라 소개합니다. 이 문서는 2025년 1월호부터 12월호까지를 읽고 반복된 주제를 묶은 것입니다. 호별 문서에는 소식마다 링크가 가리키는 원문을 읽고 요약한 내용이 있습니다. 11월호와 12월호는 개별 기사 대신 PromCon EU 2025 발표를 정리했습니다.

## 이 분류에서 찾기 {#section-navigation}

- [1월호]({{< relref "/external/promkr/2025/01.md" >}}) — 2025-01-03 발행, 소식 10개
- [2월호]({{< relref "/external/promkr/2025/02.md" >}}) — 2025-02-02 발행, 소식 8개
- [3월호]({{< relref "/external/promkr/2025/03.md" >}}) — 2025-03-03 발행, 소식 8개
- [4월호]({{< relref "/external/promkr/2025/04.md" >}}) — 2025-04-04 발행, 소식 10개
- [5월호]({{< relref "/external/promkr/2025/05.md" >}}) — 2025-05-03 발행, 소식 10개
- [6월호]({{< relref "/external/promkr/2025/06.md" >}}) — 2025-06-04 발행, 소식 12개
- [7월호]({{< relref "/external/promkr/2025/07.md" >}}) — 2025-07-06 발행, 소식 11개
- [8월호]({{< relref "/external/promkr/2025/08.md" >}}) — 2025-08-14 발행, 소식 8개
- [9월호]({{< relref "/external/promkr/2025/09.md" >}}) — 2025-09-12 발행, 소식 9개
- [10월호]({{< relref "/external/promkr/2025/10.md" >}}) — 2025-10-06 발행, 소식 10개
- [11월호]({{< relref "/external/promkr/2025/11.md" >}}) — 2025-11-22 발행, 소식 9개
- [12월호]({{< relref "/external/promkr/2025/12.md" >}}) — 2025-12-27 발행, 소식 10개

## 올해 흐름

OpenTelemetry와 Prometheus의 관계가 한 해 내내 이어졌습니다. 1월 Jaeger v2가 OpenTelemetry Collector 위에서 나왔고, 3월에는 OpenTelemetry Collector와 vmagent 같은 메트릭 수집 에이전트의 벤치마크 비교가 실렸습니다. 4월과 5월에는 OCB와 otel-distro-builder로 collector를 직접 빌드하는 이야기가, 6월에는 Beyla의 OpenTelemetry 기부와 Sum Connector가 나옵니다. 8월에는 Prometheus 공동 창시자가 OTel 대신 네이티브 Prometheus 계측을 권하는 글이 소개됐고, 9월에는 Go 서비스에서 OpenTelemetry 오버헤드를 잰 결과가 이어집니다. 11월과 12월호는 PromCon EU 2025에서 다룬 델타 시간성 지원, OTLP 엔드포인트 개선, 자원 속성 UX 리서치로 같은 주제를 마무리합니다.

AI와 LLM을 운영에 쓰는 이야기는 2월 Uber의 온콜 Slack 봇 Genie에서 시작해 하반기에 늘어납니다. 7월에는 AI-SRE 동향과 온콜 에이전트 HolmesGPT, AI 신뢰성 엔지니어링, 사고 대응에서 사람과 AI의 협력을 다룬 글이 한꺼번에 실렸고, 8월에는 LLM으로 로그를 분석하는 LogSentinelAI와 LLM 없이 시계열 모델로 이상을 잡는 vm anomaly가 나왔습니다. 9월에는 ClickHouse가 LLM에게 근본 원인 분석을 맡겨 본 결과와 Claude Code 사용량을 OpenTelemetry로 보는 가이드가, 10월에는 시계열 언어 모델 OpenTSLM과 Mercari의 사고 대응 시스템이 이어집니다. 12월에는 자연어를 PromQL로 바꾸는 OpenSearch 에이전트 발표가 정리됩니다.

알림 쪽 소식도 꾸준했습니다. 3월 Alertmanager 알림을 쿠버네티스 노드 상태로 바꾸는 Sciuro, 6월 알림 상관관계를 찾는 Keep, 7월 알림 이력 시각화 AlertSnitch, 8월 Robusta로 알림 피로를 줄이는 세 단계, 9월 Prometheus 이상 경보, 10월 Alertmanager 대시보드 Karma가 차례로 소개됩니다. 11월에는 SAAFE 알림 모델 발표가, 12월에는 Alertmanager가 재부팅하면 알림 상태를 잃는 문제를 다룬 발표가 이어집니다.

eBPF와 프로파일링 도구가 여러 호에 걸쳐 나왔습니다. 1월 Retina로 AZ 간 파드 트래픽을 보는 방법, 3월 이그레스 트래픽을 보는 egressd, 5월 GitHub Actions 프로파일링, 7월 플레임 차트, 9월 Beyla 2.5와 ECS 사이드카 가이드, OOMKill 직전의 Go 힙 프로필을 모으는 OOMProf, 10월 Parca Agent 오프라인 모드와 고루틴을 추적하는 gmon이 그 예입니다. 12월에는 CPU 하드웨어 카운터 발표가 같은 흐름에 놓입니다.

대시보드를 코드로 관리하는 방식도 반복해서 나왔습니다. 5월 Perses 소개에 이어 6월에는 Grafana 12의 Git sync와 Foundation SDK가 실렸고, 10월에는 Go SDK로 타입 안전하게 대시보드를 만드는 Perses의 컴포저블 대시보드가, 11월에는 Weaver와 Perses 믹스인 발표가 정리됩니다. 8월에는 Coroot 에이전트 메트릭용 Grafana 대시보드 모음도 소개됐습니다.

저장소와 대규모 수집 구조에 대한 글도 이어졌습니다. 2월 InfluxDB 3 Core의 공개 알파, 4월과 5월 GreptimeDB, 7월 VictoriaLogs를 트레이싱 스토리지로 쓴 연구, 8월 대규모 옵저버빌리티 파이프라인 설계 패턴, 10월 OpenTelemetry와 ClickHouse로 구축한 카카오의 전사 플랫폼이 그 예입니다. 12월에는 TSDB를 Parquet 블록으로 바꾸는 parquet-common 발표가 같은 문제를 오브젝트 스토어 관점에서 다룹니다.

## 참고 자료

- [Prometheus & Observability - 2025년 1월 소식](https://promkr.substack.com/p/prometheus-and-observability-2025)
- [Prometheus & Observability - 2025년 2월 소식](https://promkr.substack.com/p/prometheus-and-observability-2025-cec)
- [Prometheus & Observability - 2025년 3월 소식](https://promkr.substack.com/p/prometheus-and-observability-2025-476)
- [Prometheus & Observability - 2025년 4월 소식](https://promkr.substack.com/p/prometheus-and-observability-2025-d6c)
- [Prometheus & Observability - 2025년 5월 소식](https://promkr.substack.com/p/prometheus-and-observability-2025-177)
- [Prometheus & Observability - 2025년 6월 소식](https://promkr.substack.com/p/prometheus-and-observability-2025-89e)
- [Prometheus & Observability - 2025년 7월 소식](https://promkr.substack.com/p/prometheus-and-observability-2025-358)
- [Prometheus & Observability - 2025년 8월 소식](https://promkr.substack.com/p/prometheus-and-observability-2025-29e)
- [Prometheus & Observability - 2025년 9월 소식](https://promkr.substack.com/p/prometheus-and-observability-2025-990)
- [Prometheus & Observability - 2025년 10월 소식](https://promkr.substack.com/p/prometheus-and-observability-2025-f45)
- [Prometheus & Observability - 2025년 11월 소식](https://promkr.substack.com/p/prometheus-and-observability-2025-902)
- [Prometheus & Observability - 2025년 12월 소식](https://promkr.substack.com/p/prometheus-and-observability-2025-973)
