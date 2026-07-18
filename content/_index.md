---
title: "Ops Insights"
type: docs
toc: false
---

# Ops Insights

운영하면서 겪은 분야별 인사이트를 도메인 단위로 정리하는 지식베이스다. 각 도메인은 개요 아래 토픽·블록으로 나뉜다.

## 도메인

- **[모니터링]({{< relref "monitoring/_index.md" >}})** — VictoriaMetrics 내부·운영, 메트릭 400일 장기 보관 아키텍처.
- **[로깅]({{< relref "logging/_index.md" >}})** — ES(OpenSearch) 외 로그 내재화(Loki·VictoriaLogs·ClickHouse·HyperDX·StarRocks), RUM 대안, OpenSearch 비용 최적화, 최소 조합 아키텍처.
- **[APM (Datadog)]({{< relref "apm/_index.md" >}})** — Datadog APM 최적화. 작성 예정.
- **[RUM 내재화]({{< relref "rum/_index.md" >}})** — Datadog RUM(RWoL) 탈출: 웹은 HyperDX, 모바일은 대안 미성숙. HyperDX 도입 실사·Datadog RUM 커버리지 매트릭스·dd 프로토콜 프록시 검증·전 제품군 대체 매트릭스·이관 로드맵.
- **[Istio]({{< relref "istio/_index.md" >}})** — 서비스 메시 운영. 작성 예정.
- **[ClickHouse 운영]({{< relref "clickhouse/_index.md" >}})** — RUM 내재화·범용 분석으로 ClickHouse를 채택했을 때의 운영 전략(how): managed vs self-host TCO, 로컬 NVMe+S3 스토리지, Altinity operator, 프로덕션 사례.
- **[HyperDX 내재화]({{< relref "hyperdx/_index.md" >}})** — HyperDX ClickStack 실전 자체 배포 청사진(EBS-first, RUM-only 월 0.7TB): 스택 토폴로지·MongoDB 최소 운영, gp3/io2 hot·S3 cold 티어링, operator 다운타임, Keeper, 복제·멀티마스터·failover, 3개월/1년 용량 산정.
- **[HyperDX 직접 운영하기]({{< relref "hyperdx-operating/_index.md" >}})** — 내재화 챕터의 정본 문서들 위에서 "직접 운영하려면 어떤 순서로 무엇을 판단해야 하나"를 6부로 실체화한 운영 트랙: 아키텍처 → 티어링 → 가용성 → operator 패턴 → 규모 산정 → 의사결정 가이드.
