---
title: "모니터링"
date: 2026-07-12
lastmod: 2026-10-21
weight: 10
cascade:
  type: docs
comments: false
url: "/monitoring/"
linkTitle: "메트릭"
---

# 모니터링

## 이 분류에서 찾기 {#section-navigation}

- [Prometheus와 VictoriaMetrics의 확장 방식과 운영 비용 비교]({{< relref "/observability/metrics/prometheus-vs-victoriametrics/index.md" >}})
- [여러 클러스터의 메트릭을 모으는 Thanos와 VictoriaMetrics 구성]({{< relref "/observability/metrics/prometheus-vs-victoriametrics-multi-cluster/index.md" >}})
- [VictoriaMetrics]({{< relref "/observability/metrics/victoriametrics/_index.md" >}})
- [장기 보관]({{< relref "/observability/metrics/longterm-retention/_index.md" >}})
- [Prometheus·Thanos 연동]({{< relref "/observability/metrics/prometheus-thanos/_index.md" >}})

운영하면서 정리한 모니터링 도메인 인사이트.

- **[Prometheus와 VictoriaMetrics의 확장 방식과 운영 비용 비교]({{< relref "/observability/metrics/prometheus-vs-victoriametrics/index.md" >}})** — 압축·메모리 공개 수치, HA·샤딩 비교 도식과 경보 평가 방식으로 선택 기준을 정리합니다.
- **[여러 클러스터의 메트릭을 모으는 Thanos와 VictoriaMetrics 구성]({{< relref "/observability/metrics/prometheus-vs-victoriametrics-multi-cluster/index.md" >}})** — 중앙 수집과 지역 자립, WAN 단절, 복제·테넌트·객체 스토리지의 역할을 비교합니다.
- **[VictoriaMetrics]({{< relref "/observability/metrics/victoriametrics/_index.md" >}})** — 기본 개념, 설계 원칙·초대규모 운영 패턴, 네이버 D2 원문별 정리.
- **[VictoriaMetrics 사용기]({{< relref "/observability/metrics/victoriametrics/operations/_index.md" >}})** — 우리 스택 구성·전송 튜닝·관측·용량 기준과 클러스터 간 전송·AZ 분할 기록.
- **[메트릭 장기보관 아키텍처 비교]({{< relref "/observability/metrics/longterm-retention/_index.md" >}})** — 400일 보관: A/B/C/D 옵션 비교와 권장안.
- **[Prometheus · Thanos · VictoriaMetrics 조립]({{< relref "/observability/metrics/prometheus-thanos/_index.md" >}})** — Prometheus 리텐션이 어디서 끝나고 Thanos Compactor가 어디서 시작하는지, Prometheus에는 Sidecar와 Receive 중 무엇으로 붙이는지, VictoriaMetrics에는 왜 붙지 않는지.
