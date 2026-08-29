---
title: "모니터링"
weight: 1
cascade:
  type: docs
---

# 모니터링

운영하면서 정리한 모니터링 도메인 인사이트.

- **[VictoriaMetrics]({{< relref "victoriametrics/_index.md" >}})** — 세 갈래: 네이버 D2 발표 정독(기본 개념)부터 설계 원칙·초대규모 운영 패턴(잘 쓰는 방법), 우리 스택 구성·튜닝·기준치(우리의 운영)까지.
- **[메트릭 장기보관 아키텍처 비교]({{< relref "longterm-retention/_index.md" >}})** — 400일 보관: A/B/C/D 옵션 비교와 권장안.
- **[Prometheus · Thanos · VictoriaMetrics 조립]({{< relref "prometheus-thanos/_index.md" >}})** — Prometheus 리텐션이 어디서 끝나고 Thanos Compactor가 어디서 시작하는지, Prometheus에는 Sidecar와 Receive 중 무엇으로 붙이는지, VictoriaMetrics에는 왜 붙지 않는지.
