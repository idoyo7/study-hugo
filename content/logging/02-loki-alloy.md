---
title: "Loki + Alloy"
weight: 2
---

# Loki + Alloy — PLG를 ALG로 되살리기

{{< callout type="info" >}}
**한눈에**
- object storage 네이티브 + 공격적 압축으로 장기 보존 비용이 낮다 — Lucene/OpenSearch 대비 **~10–15× 적은 스토리지**.
- **카디널리티는 foot-gun**이다. 나쁜 라벨 하나가 수백만 스트림·ingester OOM으로 이어지고, structured metadata가 완화하지만 팀이 그 규율을 지켜야 한다.
- **풀텍스트/미지값 검색이 느리다** — label+time으로 못 좁히면 brute-force decompress-scan이라, VictoriaLogs 대비 검색이 최대 십수 배 느리다는 벤치가 있다.
- **promtail은 EOL 확정**(2026-03-02)이고 **Simple Scalable(SSD) 모드는 Loki 4.0에서 제거 예정**이다 — 지금 SSD 위에 새로 짓는 것은 sunset feature 위에 짓는 것.
- 우리 케이스: istio access-log엔 잘 맞지만, **스택을 하나 더 얹는 것 자체가 방치(rot) 리스크**라 보류한다.
{{< /callout >}}

Grafana 진영의 로그 집계 스택(AGPLv3). 로그 **본문이 아니라 라벨 집합(스트림)만 인덱싱**하고, 압축 청크를 object storage에 얹어 값싸게 보존하는 설계다. 2018년 공개 후 3.7.x로 성숙했고(최신 패치 v3.7.3, 2026-06-24), promtail이 EOL되며 **Alloy**로 대체되어 PLG(Promtail-Loki-Grafana)가 ALG(Alloy-Loki-Grafana)로 재편됐다.

## 강점

- **object storage 네이티브 + 공격적 압축 → 장기 보존 비용이 낮다.** 본문에 대한 inverted index를 유지하지 않아 Lucene/OpenSearch 대비 **~10–15× 적은 스토리지** `[추정]`. 필드 리포트 rule-of-thumb: ~100GB/day raw → **~30GB/day 저장 + 인덱스 수 GB**(같은 입력을 Elasticsearch에 넣으면 ~500GB/day) `[추정]`. istio 규모(~100–300GB/day)를 90일 보존하면 S3 스토리지가 **~$70–190/mo** 수준 `[추정]`.
- **Grafana-native 단일 패러다임.** 이미 VictoriaMetrics용 Grafana를 운영 중이면 대시보드·알럿·로그 탐색이 한 UI로 묶인다. 별도 검색 UI 학습이 없다.
- **Alloy는 OpenTelemetry Collector 기반**이라 로그·메트릭·트레이스를 한 에이전트로 수집하고 **네이티브 OTLP ingest**를 지원한다. promtail 대비 수집 계층이 단일화된다.
- **structured metadata**(TSDB + schema v13, 3.x 기본 활성): trace ID·request ID·`path`·`upstream_host` 같은 **고카디널리티 필드를 스트림/인덱스를 늘리지 않고 저장·필터**할 수 있다. Loki 카디널리티 함정의 공식적으로 축복받은 탈출구이며, OTLP로 들어온 resource/log attribute가 매핑되는 곳이기도 하다. (라벨을 잘못 쓰면 독이지만, 이 필드들을 structured metadata로 보내면 무해해진다.)
- **라벨 규율을 지키면 빠르다.** 잘 라벨링된 시간·라벨 한정 쿼리는 **~1.16TB/day** 프로덕션(distributed)에서 **P99 push ~245ms / P99 query ~2.75s**를 보고한다 — 단 **~632 active streams**(뛰어난 라벨 규율)와 memcached **97.8% hit rate** 전제 `[추정]`.
- **sweet spot이 뚜렷하다.** low-cardinality · high-volume · label-filterable 로그(access log, ingress log, k8s pod log)에 최적이고, "known label + time window + 가끔 특정 문자열" 쿼리 패턴에 잘 맞는다.

## 약점 · 한계

- **새 운영 모델을 학습해야 한다.** TSDB 스키마·카디널리티 설계는 OpenSearch와 다른 사고방식이다.
- **카디널리티는 foot-gun이다.** 나쁜 라벨 하나(`request_id`/`user_id`/`path`/pod IP) → 수백만 스트림 → ingester OOM. structured metadata가 완화하지만 **팀이 그것을 쓸 줄 알아야** 한다.
- **풀텍스트/미지값 검색이 느리다.** 본문을 인덱싱하지 않아 label+time으로 못 좁히는 쿼리는 brute-force decompress-scan이다. 실측 사례: 500GB/7일에 대한 `{env=...} |= "<id>" | json` 검색이 **4–5분 걸리거나 timeout** `[추정]`. 별도 벤치: 500GB 풀텍스트에서 **VictoriaLogs ~900ms vs Loki ~12s** `[벤더/벤치]`. 인시던트 중 서비스 전반에 걸쳐 unknown value를 찾는 워크플로에는 맞서 싸운다.
- **async/resumable 쿼리가 없고 기본 타임아웃이 짧다**(≈1분). cold/old data 쿼리는 타임아웃을 수동으로 올리고 range를 좁혀야 하며, timeout = 작업 손실이다.
- **bloom filter는 여전히 experimental**(no SLA). Grafana는 **>75TB/month** ingest에서만 권장하고 `[벤더]`, single-binary 미지원 · **distributed 전용**에 stateful 컴포넌트 3개(Bloom Planner는 단일 인스턴스, Builder, Gateway)를 더 붙여야 한다. 2TB/day(≈60TB/mo)는 이 임계 아래라 어차피 무의미하다.
- **쿼리 UX가 Kibana보다 한 단계 낮다.** auto-populated field sidebar가 없고, 모든 쿼리에 parser stage(`| json`, `| logfmt`)를 써야 하며, ML 패턴 클러스터링이 없다.
- **distributed 규모의 운영 부담.** ingester는 **~16GiB·replication factor 3**으로 여럿 운영하고 `[추정]`, acceptable latency를 위해 memcached 티어가 사실상 필수다. S3 request/re-flush 함정도 있다(flush 확인 실패로 같은 객체를 재전송해 request 비용이 **~250× 스파이크**한 오설정 사례) `[추정]`.
- **Alloy DaemonSet 함정.** node-local discovery 누락 시 replica마다 cluster-wide로 pod를 중복 수집하고, custom taint에 tolerations가 없으면 그 노드의 로그를 조용히 잃는다. node churn + positions file까지 얽힌다 — **옛 PLG 스택이 썩은 원인일 가능성이 크다.**

{{< callout type="warning" >}}
**구조적 리스크:** promtail은 EOL 확정(2026-03-02, Loki 3.7.3부터 repo에서 제거)이고 Alloy가 유일한 first-party 경로다(`alloy convert`는 best-effort). 그리고 중간 규모용 **Simple Scalable Deployment(SSD, read/write/backend 3-target) 모드가 Loki 4.0에서 제거 예정**이다 — single-binary(monolithic)·distributed는 유지되지만, SSD가 사라지면 istio 규모는 HA-monolithic으로, 전체 앱 로그 규모는 distributed로 밀려 **2TB/day에는 편한 low-ops 중간 선택지가 사라진다.**
{{< /callout >}}

## 적합 / 부적합

| | 배치 모드 | 대략 상한 | 비고 |
|---|---|---|---|
| **Monolithic**(HA 2–3 replica) | small | **~20GB/day**(Grafana 가이드) `[벤더]`, HA+S3로 현실적으로 low-hundreds GB/day | 운영 최단순. blooms 미지원. **istio access-log의 sweet spot.** |
| **Simple Scalable(SSD)** | middle | **~1TB/day** `[추정]` | **DEPRECATED — Loki 4.0에서 제거.** 지금 이 위에 짓는 건 sunset feature 위에 짓는 것. |
| **Distributed** | large | **multi-TB/day** `[추정]` | 가장 복잡. blooms에 필요. 전담 owner 필수. |

- **적합**: 이미 Grafana를 쓰는 팀 · low-cardinality · high-volume · label-filterable 로그 · cost-sensitive · 짧은~중간 보존. istio ingress access log(~100–300GB/day, JSON, structured metadata로 고카디널리티 필드 격리)에 거의 완벽히 맞는다.
- **부적합**: search-heavy · high-cardinality · 서비스 전반 ad-hoc 풀텍스트 · archive spelunking. 전체 app 로그(~2TB/day)는 distributed를 강제하고 풀텍스트가 downgrade되어 Loki가 가장 자주 실망시키는 워크로드다.

## 우리 케이스에서는

istio access-log 경로(~100–300GB/day)에는 Grafana-native·저비용·저운영으로 정직하게 잘 맞는 후보지만, 전체 app 로그(~2TB/day)까지 흡수하려면 distributed로 밀리고 풀텍스트 검색력이 내려간다. 무엇보다 이미 한 스택을 방치한 전례가 있는 팀에게는 **운영할 스택이 하나 더 느는 것 자체가 rot 리스크**이므로 → **보류**. (search-heavy tail은 [HyperDX/ClickStack]({{< relref "05-hyperdx-clickstack.md" >}}), 저운영 단일 로그 저장소는 [VictoriaLogs]({{< relref "03-victorialogs.md" >}}) 비교 참고.)
