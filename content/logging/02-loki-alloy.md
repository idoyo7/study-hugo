---
title: "Loki + Alloy"
weight: 2
---

# Loki + Alloy — PLG를 ALG로 되살리기

Grafana 진영의 로그 집계 스택. promtail이 EOL되고 **Alloy**로 대체되면서 PLG(Promtail-Loki-Grafana)가 ALG(Alloy-Loki-Grafana)로 재편됐다.

- **강점**: object storage(S3) 네이티브라 **장기 보존 비용이 낮다.** 라벨 카디널리티가 낮은 로그에 최적.
- **약점**: TSDB 스키마·카디널리티 설계라는 **새 운영 모델을 학습**해야 한다. istio 액세스 로그의 client IP·trace ID·URI·status 같은 **고카디널리티 필드는 Loki 라벨에 독**이다(같은 필드가 VictoriaLogs에는 무해). bloom filter 검색은 여전히 experimental.
- **구조적 리스크**: promtail은 EOL 확정(3.7.3부터 제거). 그리고 중간 규모용 **Simple Scalable Deployment(SSD, read/write/backend 3-target) 모드가 Loki 4.0 전에 제거 예정**이다 — single-binary(monolithic)·distributed 모드는 유지되지만, SSD가 사라지면 istio 규모(~100–300GB/day)는 HA-monolithic으로, 전체 앱 로그 규모(~2TB/day)는 distributed/microservices로 밀려 운영 부담이 커진다.
- 검색 성능 참고: 500GB 풀텍스트에서 **VictoriaLogs ~900ms vs Loki ~12s** `[벤더/벤치]`.

> 판단: Grafana는 그대로 쓰지만 **운영해야 할 스택이 하나 더 는다.** 이미 방치했던 전례가 있는 팀이라면 rot 리스크가 그대로 재현된다. → 보류.
