---
title: "Cortex vs Thanos 비교와 선택"
linkTitle: "Cortex vs Thanos"
description: "2026-11-01 기준 Thanos와 Cortex의 아키텍처, 중복 제거, 멀티테넌시, 보존과 운영을 비교한다. 공개 성능 수치의 측정 조건을 짚고 필요한 기능에 따라 선택 기준을 제시한다."
date: 2026-11-01
lastmod: 2026-11-01
weight: 9
url: "/monitoring/cortex-vs-thanos/"
---

# Cortex vs Thanos 비교와 선택

## 1. Thanos는 Prometheus를 확장하고 Cortex는 쓰기를 모은다

Thanos는 기존 Prometheus에 장기 저장과 전역 조회를 붙이는 프로젝트입니다. Sidecar로 로컬 블록을 오브젝트 스토리지에 올리거나 Receive로 remote_write를 받고, Query가 여러 저장소의 데이터를 하나의 결과로 묶어 조회합니다.

{{< flow src="_flow/1-thanos.json" />}}

Cortex는 remote_write를 중앙 클러스터로 모으고 테넌트별로 데이터를 구분하는 멀티테넌트 장기 저장소입니다. Thanos와 코드를 주고받으며 오브젝트 스토리지 클라이언트도 같은 `thanos-io/objstore`를 씁니다.

ingester가 테넌트별 TSDB(시계열 데이터베이스)에 쓰고 querier가 읽는 흐름입니다.

{{< flow src="_flow/1-cortex.json" />}}

근거 표기 — `✓` 1차 출처 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 이 글에서 `Ⓑ`는 제3자 측정과 도입 조직의 사례를 함께 뜻합니다. 조사 기준일은 2026-11-01입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| Thanos 최소 구성 | Sidecar 방식은 Prometheus+Sidecar, Query, Store, Compactor. KV 없음 | Thanos 문서 | `✓` |
| Cortex 모듈 | `pkg/cortex/modules.go`에 30개 남짓. 단일 바이너리 `-target`으로 선택 | Cortex 저장소 | `✓` |
| Cortex의 Thanos 의존 | 테스트 제외 Go 파일 72개가 `thanos-io/thanos/pkg/...`를 import. Cortex 0.4.0(2019-12-02)이 "flush blocks to S3/GCS ala Thanos"로 시작 | Cortex master a55f319(2026-10-30), Cortex CHANGELOG | `✓` |
| Thanos 안의 Cortex 코드 | Query Frontend 문서 첫 문단 "based on the Cortex Query Frontend". `internal/cortex/`에 테스트 제외 Go 파일 59개 | Thanos 문서, 로컬 clone 집계 | `✓` |
| 공동 메인테이너 | Ben Ye(@yeya24, AWS)가 양쪽 MAINTAINERS에 있음 | 양쪽 MAINTAINERS.md | `✓` |
| blocks storage의 기원 | "Cortex blocks storage는 Thanos의 shipper, bucket store, compactor 위에 만들어졌다"는 설명 | Grafana 블로그(2020-07-17) | `Ⓥ` |

{{% /details %}}

## 2. 쓰기 경로에 따라 구성과 의존성이 달라진다

도입 방식은 기존 Prometheus의 쓰기를 유지할지, 중앙으로 push할지에서 달라집니다. Grafana의 2020년 글은 Thanos를 Sidecar부터 점진적으로 붙일 수 있는 구조로, Cortex를 "all-or-none"으로 평했습니다. 2022년 이후에는 Receive와 Cortex ingester가 테넌트별 독립 TSDB를 둔다는 점에서 비슷해졌습니다.

### Sidecar는 쓰기 경로를 유지하고 Receive와 Cortex는 push를 받는다

| 모델 | 데이터 소유 | 도입 방식 | 특징 |
|---|---|---|---|
| Thanos Sidecar | Prometheus가 계속 소유 | 기존 쓰기 경로 유지, Sidecar만 추가 | 2시간 블록 업로드, 최근 구간은 Sidecar가 Prometheus에서 직접 노출 |
| Thanos Receive | Receive가 테넌트별 TSDB로 소유 | remote_write push | 문서는 air-gapped·egress only 환경에 권장 |
| Cortex | ingester가 테넌트별 TSDB로 소유 | remote_write push | push만 지원 |

### 컴포넌트는 역할로 대응시킬 수 있다

| 역할 | Thanos v0.42 | Cortex v1.21 |
|---|---|---|
| 수집(pull) | Sidecar | 없음 |
| 수집(push) | Receive(router·ingestor 역할 분리 가능) | distributor → ingester |
| 쿼리 | Query | querier |
| 쿼리 앞단 | Query Frontend | query-frontend, 선택적 query-scheduler |
| 버킷 조회 | Store Gateway | store-gateway |
| 컴팩션 | Compactor | compactor |
| 규칙 | Ruler | ruler |
| 그 밖 | tools | alertmanager, overrides-exporter, parquet-converter, purger |

### 외부 의존성은 링과 HA 처리에서 차이가 난다

| 항목 | Thanos | Cortex |
|---|---|---|
| 오브젝트 스토리지 | 필수 | 필수 |
| 해시 링 KV | 없음<br>Receive hashring은 JSON 파일 | memberlist, Consul, etcd 중 하나 |
| HA 중복 제거용 KV | 필요 없음<br>조회 시점 중복 제거 | HA tracker에 Consul·etcd<br>1.21에서 memberlist가 experimental로 추가 |
| 캐시 | 선택<br>in-memory·memcached·redis·groupcache(experimental) | 선택<br>in-memory·memcached·redis |
| 서비스 발견 | `--endpoint`, DNS SD | 링 |

쿠버네티스에서 Receive의 hashring 설정은 ConfigMap으로 갱신합니다. 자동화는 별도 프로젝트(thanos-receive-controller)가 맡습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| Sidecar·Receive 동작 | Sidecar는 로컬 블록 2시간 업로드와 StoreAPI 노출. Receive는 테넌트 헤더로 테넌트별 독립 TSDB를 만들고 `tenant_id` 외부 라벨로 업로드 | Thanos receive 문서 | `✓` |
| Receive 권장 환경 | "users who can only push … due to air-gapped, or egress only environments" | Thanos receive 문서 | `✓` |
| 점진 도입 vs all-or-none | Thanos는 Sidecar부터, Cortex는 "all-or-none" | Grafana 블로그(2020-07-17, Marco Pracucci) | `Ⓥ` |
| 컴포넌트 대응 | Thanos 서브커맨드는 sidecar·store·query·rule·compact·tools·receive이고 query-frontend는 별도 등록 | Thanos `cmd/thanos/main.go` | `✓` |
| Thanos KV 없음 | hashring은 JSON 파일, 서비스 발견은 `--endpoint`·DNS SD | Thanos receive·query 문서 | `✓` |
| Cortex HA tracker KV | 가이드에 "Only Consul and etcd are currently supported". 1.21 릴리스 노트에서 memberlist가 experimental로 추가 | Cortex ha-pair-handling 문서, v1.21.0 릴리스 | `✓` |
| 캐시 종류 | Thanos groupcache는 experimental | Thanos store·query-frontend 문서, Cortex 문서 | `✓` |

{{% /details %}}

## 3. 복제본과 테넌트를 다루는 방식이 다르다

### 같은 기능도 적용 위치와 범위가 다르다

| 비교 축 | Thanos | Cortex |
|---|---|---|
| HA·복제와 중복 제거 | 조회 시점 중복 제거(replica label)<br>Receive 복제 기본 RF 1<br>저장 단계 vertical compaction은 숨은 experimental flag | 쓰기 시점에 HA tracker가 한 replica만 받음<br>ingester RF 보통 3<br>compactor가 기본으로 1배로 합침 |
| 멀티테넌시 | 쓰기 경로(Receive)에 집중, limit은 experimental<br>읽기·저장·컴팩션은 라벨 기반 | 모든 컴포넌트에 테넌트 개념<br>테넌트별 런타임 overrides, shuffle sharding, 테넌트 federation |
| 다운샘플링 | 5m·1h 블록 생성, 해상도별 보존 | 없음 |
| 보존 설정 | 해상도별 flag 3개, Compactor stream 단위 | 테넌트별 overrides, 해상도 1개 |
| 쿼리 엔진·샤딩·캐시 | 기본 Prometheus 엔진, Thanos 엔진 experimental<br>Query Frontend 분할·vertical sharding·결과 캐시 | 기본 Prometheus 엔진, Thanos 엔진 experimental<br>query-frontend 분할·vertical sharding·query priority |
| 외부 의존성 | 오브젝트 스토리지(필수), KV 없음 | 오브젝트 스토리지, 링 KV, HA tracker용 Consul·etcd |
| 라이선스·CNCF | Apache-2.0<br>Incubating(2020-08-19) | Apache-2.0<br>Incubating(2020-08-20) |
| 현재 버전 | v0.42.5(2026-10-27)<br>0.y.z | v1.21.1(2026-06-05)<br>v1.22.0-rc.3 |

### 장단점은 필요한 기능에 따라 달라진다

| 제품 | 장점 | 단점 | 맞는 조건 |
|---|---|---|---|
| Thanos | Sidecar로 기존 Prometheus에 점진 도입<br>다운샘플링<br>링 KV 없음<br>StoreAPI 연합 조회 | 기본 설정에서 버킷에 복제본이 그대로 쌓임(추론)<br>Compactor는 stream당 싱글턴<br>Receive의 limit·active series 제한이 experimental·best-effort<br>마이너마다 breaking 변경 가능 | Prometheus가 여러 클러스터에 흩어져 있고 쓰기 경로를 바꾸기 어려움<br>수개월 범위 대시보드 필요<br>별도 KV를 두고 싶지 않음 |
| Cortex | 테넌트별 limit·보존·shuffle sharding<br>compactor가 기본으로 복제본 중복 제거<br>링 기반 compactor·store-gateway 샤딩<br>v1 안정성 보장 | 다운샘플링 없음<br>링 KV와 HA tracker용 Consul·etcd 필요<br>push만 지원 | 내부 SaaS형 멀티테넌트 플랫폼<br>중앙 클러스터로 push를 모음 |

테넌트를 구분하는 기능이 인증을 대신하지는 않습니다. Thanos 운영 문서는 "there are no authentication mechanisms in Thanos"라고 명시하고, Cortex도 인증은 앞단 프록시에 맡깁니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| Thanos 중복 제거 | `--query.replica-label`로 조회 시점에 합침. 알고리즘 기본 `penalty`, v0.38의 `chain`은 1:1 병합 | Thanos query 문서, 릴리스 노트 | `✓` |
| Thanos vertical compaction | 숨은 flag `--compact.enable-vertical-compaction`. 관련 flag 설명이 "Experimental". 잘못 합친 시리즈는 "no easy way to split them back" | Thanos compact 문서 | `✓` |
| Thanos 버킷 N배 | 기본 설정에서 버킷 용량이 HA replica 수(또는 Receive RF)만큼 늘어난다는 문장. 문서에 직접 적힌 문장은 없고 위 두 항목을 조합한 결론 | 보고서 조합 | `Σ` |
| Receive 복제 | `--receive.replication-factor` 기본 1. 쓰기 쿼럼은 RF/2+1이지만 RF=2만 1(v0.37). 분배 기본 hashmod는 "discouraged"이고 ketama 권장 | Thanos receive 문서, v0.37 릴리스 | `✓` |
| Cortex 중복 제거 | compactor가 복제로 N개 블록에 쓰인 샘플을 별도 flag 없이 중복 제거. HA tracker는 `cluster`·`__replica__` 라벨로 리더를 정하고 30초(기본) 무샘플이면 교체, 다른 replica 샘플은 버림 | Cortex compactor·ha-pair-handling 문서 | `✓` |
| Thanos 테넌트 | `THANOS-TENANT` 헤더, 없으면 `default-tenant`. 절 제목 "Limits & gates (experimental)", 기본 꺼짐. 413 응답은 "will cause data loss at the client". active series 제한은 meta-monitoring(15초 조회) 기반이며 죽으면 제한 없음 | Thanos receive 문서 | `✓` |
| Thanos 읽기 테넌시 | `--query.enforce-tenancy`로 라벨 matcher 주입. "there are no authentication mechanisms in Thanos". 운영 문서는 Sidecar와 계층형 Query 권장 | Thanos query·multi-tenancy 문서 | `✓` |
| Cortex 테넌트 | `X-Scope-OrgID`. 런타임 overrides(수집률·시리즈·쿼리·보존·shard 크기), 1.21 Overrides API. shuffle sharding은 ingester·query-frontend/scheduler·store-gateway·ruler·compactor, 기본 꺼짐. 테넌트 federation | Cortex 문서, v1.21.0 릴리스 | `✓` |
| 엔진 | Thanos `--query.promql-engine` 기본 `prometheus`, Thanos 엔진 experimental. Cortex `-querier.thanos-engine` 기본 false, experimental(1.15에서 도입) | Thanos query 문서, Cortex v1guarantees | `✓` |
| 쿼리 앞단 | Thanos Query Frontend 기본 24시간 분할·재시도·결과 캐시, `--query-frontend.vertical-shards`. Cortex는 시간 분할·vertical sharding·동적 분할·query priority | Thanos·Cortex 문서, Cortex 블로그(2025) | `✓` |
| Thanos 앞단 범위 | 문서 NOTE는 range 쿼리만 분할·캐시한다고 적지만 instant 재시도 flag가 있어 현재 동작은 불명확 | Thanos query-frontend 문서 | `?` |
| 라이선스·CNCF | 둘 다 Apache-2.0. Thanos 2019-07-14 수락·2020-08-19 Incubating, Cortex 2018-09-20 수락·2020-08-20 Incubating | CNCF 프로젝트 페이지, Cortex roadmap | `✓` |
| 버전 | Thanos v0.42.5(2026-10-27), 다음 v0.43 rc 없음. CHANGELOG에 "all 0.y.z releases can contain breaking changes". Cortex v1.21.1(2026-06-05), v1.22.0-rc.3(2026-10-06) | 각 릴리스, Thanos CHANGELOG | `✓` |

{{% /details %}}

## 4. 공개 성능 수치는 각자의 조건에서 읽어야 한다

Cortex와 Thanos를 같은 조건에서 직접 잰 공개 벤치마크는 찾지 못했습니다. 아래는 2026-11-01까지 확인한 각 프로젝트의 성능 자료입니다. 프로젝트와 개발자가 서로 다른 조건에서 잰 수치라 제품 간 순위를 매길 수 없습니다.

| 제품 | 시점 | 내용 | 공개 수치 | 조건 |
|---|---|---|---|---|
| Thanos | v0.29.0(2022-11-03) | Query 프록시를 k-way merge로 교체 | CPU 약 25~80% 감소<br>RAM 약 30~50% 감소 | 릴리스 노트의 "according to our benchmarks", 상세 조건 없음 |
| Thanos | v0.41.0(2026-02-12) | Series·Query RPC를 64개 단위 배치 | 많은 경우 snappy 기준 네트워크 처리량 50% 미만<br>한 배포 예에서 70% 넘게 감소 | 프로젝트 블로그의 그래프 |
| Thanos promql-engine | README, 측정 시점 미표기 | Prometheus 엔진 대비 마이크로벤치 | 빨라진 쿼리: `sum_by_pod` -68%, `histogram_quantile` -65%, `complex_func_query` -85%<br>느려진 쿼리: `vector_selector` +30%, `rate` +10%, `unary_negation` +31%<br>메모리 할당은 `rate` +60%, `topk` +72%처럼 늘어난 경우도 있음 | Apple M1 Pro 단일 코어, 개발자 마이크로벤치. 측정 날짜·Prometheus 버전·데이터 크기 미표기 |
| Cortex | 1.22 rc(2026) | distributor 쿼리 fan-out의 goroutine 스택 복사 오버헤드 제거 | CPU 약 8% | 릴리스 노트의 유일한 % 항목 |
| Cortex | 1.20~1.22(2025~2026) | Parquet 저장·조회 | 수치 없음 | 실험 기능, 설계 문서는 동기만 설명 |

promql-engine 수치는 "몇 배 빠르다"로 요약할 수 없고, 단순 selector와 rate는 오히려 느려졌습니다.

Grafana의 2019년 PromCon 리캡은 당시 Cortex가 NoSQL 인덱스 덕분에 쿼리 성능과 확장성에서 앞서지만 총소유비용이 더 든다고 봤습니다. chunks storage 시절의 평가라 현재 아키텍처에 그대로 적용하기 어렵습니다. Cortex의 2022년 이후 릴리스 노트와 블로그에서는 정량 수치를 거의 찾지 못했습니다. 직접 비교에 쓸 도구로는 두 제품을 모두 지원하는 VictoriaMetrics의 `prometheus-benchmark`가 있습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| 직접 비교 없음 | 같은 워크로드로 CPU·메모리·지연을 잰 Cortex 대 Thanos 공개 결과를 찾지 못함 | 보고서 검색 결과 | `?` |
| 2019 정성 비교 | PromCon 리캡. Cortex가 쿼리 성능·확장성에서 앞서지만 TCO가 더 듦. chunks storage 시절 | Grafana 블로그(2019-11-21) | `Ⓥ` |
| 2026 비교 블로그 | oodle.ai, devopsboys 등. 측정 방법 미공개 | 해당 블로그 | `?` |
| prometheus-benchmark | VictoriaMetrics 측 도구가 Cortex·Thanos를 대상으로 지원 | VictoriaMetrics 저장소 | `✓` |
| Thanos v0.29.0 | "~25-80% less CPU usage, ~30-50% less RAM usage according to our benchmarks" (#5296) | Thanos CHANGELOG | `✓` |
| Thanos v0.41.0 | "fewer than 50% network throughput compared to previously when using snappy" | Thanos 프로젝트 블로그(2026-02-19) | `✓` |
| promql-engine 마이크로벤치 | Apple M1 Pro 단일 코어. 날짜·버전·데이터 크기 README에 없음 | promql-engine README | `Ⓥ` |
| Cortex 개선 수치 | 1.22 rc의 "~8% CPU". 블로그 7편(2025-04~2026-07) 중 성능 글 두 편에는 측정값 없음 | Cortex CHANGELOG, Cortex 블로그 | `✓` |
| Cortex Parquet 성능 | 전후 수치 없음 | Cortex parquet-mode 문서 | `?` |

{{% /details %}}

## 5. Thanos는 해상도별로, Cortex는 테넌트별로 보존을 나눈다

| 항목 | Thanos | Cortex |
|---|---|---|
| 다운샘플링 | raw → 5m(40시간 이후) → 1h(10일 이후), native histogram도 지원(v0.38) | 없음 |
| 보존 flag | `--retention.resolution-raw`·`-5m`·`-1h` | limits의 `compactor_blocks_retention_period` |
| 보존 단위 | 해상도별, 전역(Compactor stream 단위) | 테넌트별, 해상도 1개 |
| 기본값 | 0d = 영구 보관 | 테넌트 overrides로 지정 |
| 테넌트별 다르게 | `--selector.relabel-config`로 나눈 Compactor를 따로 운영 | overrides로 바로 지정 |
| 적용 시점 | 컴팩션·다운샘플링 루프 직후, 루프가 실패하면 삭제되지 않음 | compactor |
| 서로의 블록 | 다운샘플 블록은 vertical compaction 대상에서 제외(v0.36) | Thanos 다운샘플 블록은 `thanosconvert`가 건너뛰고 올리면 조회 불가 |

해상도별 보존의 설정 예와 다운샘플링 원리는 [Prometheus·Thanos 연동]({{< relref "/observability/metrics/prometheus-thanos/_index.md" >}})과 [장기 보관]({{< relref "/observability/metrics/longterm-retention/_index.md" >}})에서 다룹니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| Thanos 다운샘플링 | Compactor가 raw→5m(40시간 이후), 5m→1h(10일 이후) 생성. native histogram 다운샘플링 v0.38.0(#8110) | Thanos 문서, v0.38.0 릴리스 | `✓` |
| Thanos 보존 | 해상도별 flag 3개, 기본 0d. 적용은 컴팩션 루프가 성공해야 일어남 | Thanos Compactor 문서 | `✓` |
| Thanos 테넌트별 보존 없음 | Compactor는 테넌트 개념이 없고 `--selector.relabel-config`로 stream을 나눠 맡김 | Thanos compact 문서 | `✓` |
| Cortex 보존 | limits의 `compactor_blocks_retention_period`, 테넌트 overrides 대상 | Cortex 설정 파일 레퍼런스 | `✓` |
| Cortex 다운샘플링 | roadmap에 항목만 있음. 이슈 #4322(2021-06 개설) open. "If downsampled blocks are uploaded to the Cortex bucket, they cannot be queried" | Cortex roadmap, 마이그레이션 문서 | `✓` |
| v0.36 제외 | 다운샘플 블록이 vertical compaction 대상에서 빠짐(`no-compact-mark.json` panic 수정) | Thanos v0.36.0 릴리스 | `✓` |

{{% /details %}}

## 6. 운영 부담과 프로젝트 활동을 함께 본다

| 항목 | Thanos | Cortex |
|---|---|---|
| 최소 구성 | Sidecar 방식: Prometheus+Sidecar, Query, Store, Compactor<br>Receive 방식: Receive, Query, Store, Compactor + hashring 파일 관리 | distributor, ingester, querier, store-gateway, compactor + 링 KV<br>실무에서는 query-frontend·캐시·ruler 추가 |
| 업그레이드 | 0.y.z라 마이너마다 breaking 가능<br>v0.42에서 Receive·Store flag 제거, Query Frontend 로그 필드 변경 | v1 안정성 보장, experimental이 아닌 설정은 하위 호환 |
| 릴리스 간격 | 문서 목표 6주, 최근 마이너 간격 약 12·17·15·21주 | 명시 주기 없음, 1.19→1.20 약 37주, 1.20→1.21 약 24주 |
| 최근 52주 병합 PR | 245 | 453(dependabot 18 포함) |
| 최근 52주 커밋 | 641(머지 커밋 242 포함) | 462(머지 커밋 6) |
| 최근 52주 고유 작성자 | 80 | 43 |
| 메인테이너 | 9명(Google·Dash0·Vinted·Red Hat 3·AWS·Shopify·Cloudflare) | 6명(AWS 3·Apple 2·KakaoEnterprise 1) |
| 공개 도입 목록 | 88곳 | 23곳 |
| Parquet | 별도 저장소 `thanos-parquet-gateway`, beta | 본 저장소의 parquet-converter와 store-gateway parquet 모드, experimental |

활동량은 커밋 수 하나로 판단하기 어렵습니다. Thanos는 merge commit, Cortex는 squash 방식을 쓰므로 병합 PR과 고유 작성자 수를 함께 봐야 합니다. Cortex의 활동 감소를 논의한 2022년 CNCF TOC 이슈 #899는 Mimir 포크 직후의 상황을 다뤘으며, 최근 집계에서는 연 450건 안팎의 PR이 병합됐습니다.

Medallia(Thanos, 2022)는 active series 9억~11억 규모에서 Sidecar와 Receive를 섞어 쓰고, Aiven(Thanos, 2023)은 M3DB에서 옮기며 Cortex를 검토 대상에서 뺐습니다. AWS(Cortex, 2020)는 Thanos를 검토한 뒤 멀티테넌트 환경의 장기 확장성을 이유로 Cortex를 골랐습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| 활동량 집계 | 2025-11-01~2026-10-31, committer 날짜 기준. 봇(login의 `[bot]`, type Bot) 제외 | GitHub API(`commits`, `search/issues`) | `✓` |
| 커밋·PR·작성자 | Thanos 641·245·80, Cortex 462·453·43 | 같은 집계 | `✓` |
| 메인테이너·도입 목록 | Thanos 9명·adopters.yml 88곳, Cortex 6명·ADOPTERS.md 23곳 | 양쪽 MAINTAINERS.md, adopters 목록 | `✓` |
| 릴리스 주기 | Thanos 문서 "one release per 6 weeks", 실제 마이너 간격 약 12·17·15·21주 | Thanos release-process 문서, 릴리스 노트 | `✓` |
| Thanos breaking 변경 | v0.37 Store gRPC Info 함수 제거, v0.38 `--store.sd-file` 폐기, v0.41 Receive shuffle sharding 배치 변경, v0.42 flag 제거·로그 필드명 변경 | Thanos 릴리스 노트 | `✓` |
| Cortex 안정성 | v1-guarantees가 실험 기능이 아닌 설정의 하위 호환을 보장 | Cortex 문서 | `✓` |
| CNCF TOC #899 | "Health of cortex project"(2022-08), 2024-01 프로젝트 쪽 이슈 #5728로 이어짐 | cncf/toc 이슈 | `✓` |
| Medallia | active series 9억~11억, 초당 1,300만~1,700만 샘플, 보존 366일, Query 66·Sidecar 286·Receive 133·Store 88·Compactor 11. Cortex를 비교한 뒤 고른 글은 아님 | Thanos 블로그(2022-09-08) | `Ⓑ` |
| Aiven | M3DB에서 이전, Cortex는 "Mimir가 개선된 포크라 쓰는 회사가 적다"는 이유로 제외. 글 안의 M3 비용 수치가 서로 맞지 않아 인용하지 않음 | Thanos 블로그(2023-06-08) | `Ⓑ` |
| AWS | "the most appropriate choice for long-term scalability in a multi-tenant environment" | AWS 오픈소스 블로그(2020-12) | `Ⓥ` |
| Parquet | Cortex 1.22 rc에 sharded parquet 변환·조회(#7610). Thanos Store 문서는 "Parquet support (beta)", 별도 저장소는 GitHub 릴리스 없음 | Cortex·Thanos 문서, GitHub API | `✓` |
| 이전 사례 | Thanos와 Cortex 사이를 옮긴 조직의 공개 글 | 보고서 검색 결과 | `?` |

{{% /details %}}

## 7. 쓰기 경로와 필요한 기능에 맞춰 고른다

두 제품 모두 Apache-2.0이고 CNCF Incubating이라 라이선스와 거버넌스로는 선택이 정해지지 않습니다. Aiven과 AWS는 각자 조건에 따라 서로 다른 제품을 골랐습니다. 아래 표는 앞 절의 사실을 종합한 판단입니다.

| 조건 | 더 맞는 쪽 | 이유 |
|---|---|---|
| Prometheus가 여러 클러스터·지역에 흩어져 있고 쓰기 경로를 바꾸기 어려움 | Thanos | Sidecar만 붙여 장기 저장과 전역 조회를 얻음 |
| 수개월~수년 범위 대시보드를 싸게 그려야 함 | Thanos | 다운샘플링은 Thanos에만 있음 |
| 링 KV 같은 별도 상태 저장소를 두기 싫음 | Thanos | Sidecar 방식은 KV가 필요 없음 |
| 테넌트별 수집·쿼리 limit, 보존, shuffle sharding을 기본 기능으로 써야 함 | Cortex | 모든 컴포넌트에 테넌트 개념이 있음 |
| 중앙 클러스터로 push를 모으고 복제본 중복을 저장 단계에서 기본으로 제거하고 싶음 | Cortex | compactor가 기본으로 합침 |
| 다운샘플링이 반드시 필요함 | Thanos | Cortex는 답이 되지 못함 |

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| 조건별 판단 | 위 표는 3~6절의 사실을 조합한 판단이며 같은 조건 비교 측정에 기대지 않음 | 이 글의 종합 | `Σ` |
| Thanos 권장 시나리오 | 운영 문서가 멀티테넌시에 Sidecar와 계층형 Query를 권장 | Thanos multi-tenancy 문서 | `✓` |
| 분산 실행 | `--query.mode=distributed`(v0.35, experimental)로 지역 간 데이터를 옮기지 않고 조회를 연합. 직접 붙은 Store Gateway·Ruler는 분산 실행에서 빠짐 | Thanos query 문서 | `✓` |

{{% /details %}}

## 8. 확인하지 못한 것

- Cortex와 Thanos를 같은 조건에서 직접 비교한 측정(시기 무관)
- promql-engine README 벤치마크의 측정 날짜와 조건(데이터 크기, Prometheus 버전)
- Thanos Query Frontend가 지금도 range 쿼리만 분할·캐시하는지
- Cortex Parquet 모드와 Thanos parquet-gateway의 성능 수치
- Thanos와 Cortex 사이를 실제로 옮긴 조직의 사례

## 9. 참고 자료

- Thanos 릴리스: https://github.com/thanos-io/thanos/releases
- Thanos CHANGELOG: https://github.com/thanos-io/thanos/blob/main/CHANGELOG.md
- Thanos Receive: https://thanos.io/tip/components/receive.md/
- Thanos Compactor: https://thanos.io/tip/components/compact.md/
- Thanos Query: https://thanos.io/tip/components/query.md/
- Thanos Query Frontend: https://thanos.io/tip/components/query-frontend.md/
- Thanos Store: https://thanos.io/tip/components/store.md/
- Thanos 멀티테넌시: https://thanos.io/tip/operating/multi-tenancy.md/
- Thanos 릴리스 프로세스: https://github.com/thanos-io/thanos/blob/main/docs/release-process.md
- Thanos 2026-02 업데이트: https://thanos.io/blog/2026-02-19-thanos-project-updates/
- Thanos promql-engine: https://github.com/thanos-io/promql-engine
- Thanos at Medallia: https://thanos.io/blog/2022-09-08-thanos-at-medallia/
- Thanos at Aiven: https://thanos.io/blog/2023-06-08-thanos-at-aiven/
- CNCF Thanos: https://www.cncf.io/projects/thanos/
- Cortex compactor: https://cortexmetrics.io/docs/blocks-storage/compactor/
- Cortex HA pair 처리: https://cortexmetrics.io/docs/guides/ha-pair-handling/
- Cortex store-gateway: https://cortexmetrics.io/docs/blocks-storage/store-gateway/
- Cortex v1guarantees: https://cortexmetrics.io/docs/configuration/v1guarantees/
- Cortex 설정 파일 레퍼런스: https://cortexmetrics.io/docs/configuration/configuration-file/
- Cortex 로드맵: https://github.com/cortexproject/cortex/blob/master/docs/roadmap.md
- Cortex Thanos 마이그레이션: https://cortexmetrics.io/docs/blocks-storage/migrate-storage-from-thanos-and-prometheus/
- Cortex Parquet 모드: https://cortexmetrics.io/docs/guides/parquet-mode/
- Cortex 블로그: https://cortexmetrics.io/blog/
- Cortex MAINTAINERS: https://github.com/cortexproject/cortex/blob/master/MAINTAINERS.md
- CNCF TOC 이슈 #899: https://github.com/cncf/toc/issues/899
- Grafana 2020 협업 글: https://grafana.com/blog/how-the-cortex-and-thanos-projects-collaborate-to-make-scaling-prometheus-better-for-all/
- Grafana 2019 PromCon 리캡: https://grafana.com/blog/2019/11/21/promcon-recap-two-households-both-alike-in-dignity-cortex-and-thanos/
- AWS와 Grafana Labs의 Cortex 글: https://aws.amazon.com/blogs/opensource/how-aws-and-grafana-labs-are-scaling-cortex-for-the-cloud/
- VictoriaMetrics prometheus-benchmark: https://github.com/VictoriaMetrics/prometheus-benchmark
