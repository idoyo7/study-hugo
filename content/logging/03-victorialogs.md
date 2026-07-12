---
title: "VictoriaLogs"
weight: 3
---

# VictoriaLogs — VM을 이미 쓴다면 가장 자연스러운 선택

VictoriaMetrics 패밀리의 로그 저장소. 메트릭에서 이미 검증한 **싱글 바이너리 / vmagent·vmalert·vmauth 운영 모델을 그대로 재사용**한다.

- **강점**: 초경량 · 낮은 리소스 · 풀텍스트(LogsQL) 지원. 수집 호환이 넓다 — fluent-bit / OTLP / syslog / **Loki push API**(Alloy를 그대로 붙일 수 있음) / vlagent. 내장 UI + Grafana 공식 데이터소스.
- **가장 큰 자산**: 팀이 이미 Victoria 운영 모델을 학습했다는 것. **학습·rot 비용이 0에 가깝다.**
- **제약**: 현재 **쿼리 가능한 네이티브 S3/오브젝트 티어 없음**(로드맵) → 90일 tail은 EBS/gp3에 얹어야 한다. 클러스터 내 복제가 없어 HA는 **미러 2클러스터**(2배 스토리지) 또는 EBS+백업 규율이 필요. 트레이스/RUM 기능은 없다(로그 전용).
- GA 이력: 단일 노드 2024-11, 클러스터 2025-06. 채택 사례는 아직 얇은 편.

> 판단: istio 로그처럼 규모가 크지 않은(~100–300GB/day) 로그부터 얹기에 가장 리스크가 작다. cold(30–90일) tail은 S3 Parquet(VL cold mount / CH-on-S3 / Athena)로 분리 설계. VictoriaMetrics의 내부 동작은 [VictoriaMetrics 지식베이스]({{< relref "../monitoring/victoriametrics/_index.md" >}}) 참고.
