---
title: "VictoriaLogs"
weight: 3
---

# VictoriaLogs — VM을 이미 쓴다면 가장 자연스러운 선택

VictoriaMetrics 패밀리의 로그 전용 저장소로, 단일 static Go 바이너리 · 외부 의존성 0으로 돌아간다. 코어는 오픈소스(Apache-2.0)이고 일부 기능(vlagent의 Kafka 소스, 테넌트별 stats/quota 등)만 Enterprise-gated다. 단일 노드는 v1.0.0(2024-11-12)에서 GA("production-ready")에 도달했고, 클러스터 모드는 2025-06에 공개돼 아직 ~1년 된 젊은 축이다. 릴리스가 잦아(2026년에도 v1.50·v1.51 등 분기당 수 회) 활발하지만, 그만큼 버전 pin이 필요하다.

## 강점

- **압도적인 리소스 효율.** 벤더는 다른 솔루션(Elasticsearch·Loki) 대비 RAM 최대 30x, 디스크 최대 15x 적게 쓰고 인덱스 튜닝이 필요 없다고 주장하며 `[벤더]`, 압축률은 40x~80x typical(100TB→2.5TB) `[벤더]`, Loki 대비 풀텍스트 검색은 최대 1000x 빠르다고 한다 `[벤더]`. 독립성이 완전하진 않은(VictoriaLogs-friendly) 소규모 3rd-party 벤치에서도 500GB 기준 RAM ~1.3GiB vs Loki 6–7GiB, 디스크 318 vs 501 GiB, needle 검색 ~900ms vs ~12s, ingest 66 vs 20 MB/s로 방향이 일치한다 `[벤치]`. 단, 대규모(multi-TB/day) 독립 벤치는 아직 공개된 게 없다.
- **낮은 운영 표면적.** 단일 바이너리 · ext4 로컬 디스크 · 설정 최소. 벤더는 단일 노드가 범용 하드웨어에서 수백 TB 스토리지와 초당 수백만 라인을 처리하며 single-node를 preferred 배포로 권장한다 `[벤더]`. 움직이는 부품이 적어 방치(rot)에 강한데, 로깅 스택이 기술보다 오너십 때문에 죽는다는 점에서 이는 실질적 이점이다.
- **목적에 맞춘 LogsQL + 고카디널리티.** 풀텍스트 검색에 풍부한 pipe 모델(stats · sort · limit/offset · coalesce · filter · subquery)을 얹었고, user_id · trace_id · IP 같은 고카디널리티 필드를 사전 스키마 설계 없이 바로 쿼리한다(같은 필드가 Loki 라벨에는 독). live tailing 지원, 언어 자체도 활발히 성장 중(v1.51에 coalesce pipe 등).
- **넓은 수집 호환.** fluent-bit / OTLP / syslog / **Loki push API**(Promtail · Grafana Alloy를 그대로 붙일 수 있음) / Filebeat / Fluentd / Logstash / Vector / Datadog agent / journald / Splunk(v1.50) / Elastic bulk API / native binary. 기존 collector fleet를 re-platform 없이 config 변경만으로 겨냥할 수 있다.
- **자체 collector vlagent.** `victoria-logs-collector` Helm chart로 DaemonSet 배포, pod/container 로그를 메타데이터 enrich와 함께 auto-discover한다. backend down 시 persistent on-disk buffer, 여러 대상으로 replicate, jsonline으로 외부 sink(Fluent Bit · Vector · ClickHouse)로 fan-out까지 가능. 벤더 collector 벤치에서 vlagent ~143k logs/s vs Fluent Bit ~31.3k `[벤더/벤치]`.
- **Grafana · UI 통합.** Grafana가 signed한 공식 `victorialogs-datasource`가 마켓플레이스에 있어 one-click 설치, 2026년에도 활발히 유지보수된다(heatmap 패널, ad-hoc filter). 별도 설정 없는 built-in web UI로 ad-hoc 탐색과 live tail도 된다.
- **VictoriaMetrics 패밀리와의 일관성.** 같은 flag 관습 · Helm chart 계열 · docs 스타일을 공유한다. 앞단 auth/routing/multitenancy에 vmauth/vmgateway를 쓸 수 있고, **vmalert가 LogsQL로 alert**를 걸 수 있어 metrics + logs를 하나의 alerting stack으로 묶는다. vlagent는 개념적으로 vmagent를 닮았다.

## 약점 · 한계

- **쿼리 가능한 오브젝트 스토리지 티어가 없다(headline gap).** 현재 local-disk-only다. native S3/GCS backend는 로드맵(issue #48)에 있으나 WIP이고 확정 일정이 없으며, native hot/warm/cold tiering도 downsampling도 없다 — partition detach/attach + snapshot을 이용한 DIY tiering만 가능하다. 따라서 보존 기간 전체가 붙은 block storage(EBS/NVMe) 위에 놓이고, OpenSearch UltraWarm 같은 값싼 티어가 방정식에서 빠진다. 완충 요인은 tiny footprint + 고압축이라 절대 스토리지 지출은 오히려 낮을 수 있다는 점 — 다만 이질적 마이크로서비스 로그의 실제 압축률은 40–80x best case보다 훨씬 낮으므로 자체 로그로 PoC 검증이 필요하다.
- **클러스터 내 복제(HA)가 없다.** vlinsert는 shard만 하고 replicate하지 않는다. vlstorage 노드가 죽으면 해당 쿼리는 partial result / 502를 반환한다(availability보다 consistency). 진짜 HA = 독립 클러스터를 2벌 이상 돌리고 vlagent로 ingestion을 mirror + vmauth/LB로 쿼리를 라우팅 → 스토리지 비용이 대략 2배가 된다(issue #1281). 단일 카피의 durability는 여전히 EBS/PD 내부 복제에 의존한다.
- **백업 tooling이 아직 얇다.** 전용 `vlbackup`/backup-manager가 없다(잘 다듬어진 `vmbackup`은 metrics 전용). 백업 = filesystem snapshot + rclone/restic 또는 볼륨 스냅샷 수준이다. roadmap(issue #123)에 있으나 미제공.
- **LogsQL은 proprietary.** LogQL(Loki)도 ES DSL/Lucene도 아니다. Loki/OpenSearch에서 옮기면 저장된 쿼리 · 대시보드 · alert를 전부 재작성해야 한다.
- **성숙도 · 레퍼런스가 얇다.** 클러스터 모드는 ~1년으로 젊고, 대규모 named public production 레퍼런스가 적다(공개 case study는 Airwallex 하나). ES/OpenSearch는 물론 Loki보다도 배울 peer와 공개 post-mortem이 적고, 대규모 독립 벤치도 부재하다.
- **기타 제약.** 일부 기능은 Enterprise-only(vlagent Kafka 수집, 테넌트별 stats/quota 등)라 완전 OSS 배포는 조금 더 DIY다. 트레이스 · RUM 기능은 없다(로그 전용). Grafana datasource도 Loki/ES 것보다 젊어 "Explore Logs"급 no-query UI parity는 아직 없다.

## 적합 / 부적합

| 적합 | 부적합 |
|---|---|
| 리소스 · 비용에 민감하고 footprint가 중요한 로그 저장 | 값싼 쿼리형 오브젝트-스토리지 cold 티어가 hard requirement일 때 |
| single-binary · 저운영을 원하는 팀 | 스토리지 2배 없이 엄격한 클러스터 내 HA가 필요할 때 |
| 풀텍스트 + 고카디널리티 필드 검색 | 로그 · 트레이스 · RUM을 한 저장소에서 원할 때 |
| 이미 VictoriaMetrics 생태계 안/근처인 환경 | 채택 전 대규모 검증된 public 레퍼런스가 꼭 필요한 조직 |
| 저~중 규모 로그 파이프라인, Loki/ES를 훨씬 가볍게 대체 | LogQL/ES-DSL 자산이 많아 쿼리 마이그레이션을 감당 못 할 때 |

## 우리 케이스에서는

우리는 이미 self-hosted VictoriaMetrics 클러스터를 운영 중이라 운영 모델과 muscle memory가 거의 그대로 이전된다 — 학습 · rot 비용이 0에 가까워, 로그 내재화를 시작하기에 리스크가 가장 작다. 규모가 크지 않은 istio 액세스 로그(~100–300GB/day)부터 얹으면 오브젝트-스토리지 부재가 걸리지 않고, cold(30–90일) tail만 S3 Parquet(VL cold mount / [CH-on-S3]({{< relref "04-clickhouse.md" >}}) / Athena)로 분리 설계하면 된다. VictoriaMetrics의 내부 동작은 [VictoriaMetrics 지식베이스]({{< relref "../monitoring/victoriametrics/_index.md" >}}) 참고.
