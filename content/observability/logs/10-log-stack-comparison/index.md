---
title: "앱 로그와 Istio 로그를 한곳에 모을 저장소를 고를 때 먼저 정할 조건"
linkTitle: "로그 스택 통합 비교"
description: "2026-10-22 기준 앱 로그와 Istio 액세스 로그에 맞는 로그 스택을 비교한다. 검색·보안 요구, 보관 기간과 복제 방식에 따라 OpenSearch를 유지할 조건과 Loki·VictoriaLogs·ClickHouse와 HyperDX를 선택할 조건이 달라진다."
date: 2026-10-22
lastmod: 2026-10-22
weight: 10
url: "/logging/10-log-stack-comparison/"
---

# 앱 로그와 Istio 로그를 한곳에 모을 저장소를 고를 때 먼저 정할 조건

## 1. 포기할 수 없는 조건을 먼저 정한다

Kubernetes에서 앱 로그와 Istio 액세스 로그를 모으면 성격이 다른 로그가 함께 들어옵니다. JSON 앱 로그에는 user_id와 trace_id 같은 고카디널리티 필드(값의 종류가 계속 늘어나는 필드)가 있습니다. Istio의 Envoy 액세스 로그는 요청마다 한 줄씩 쌓이고, 정해진 필드가 반복됩니다. 본문에서 값을 찾는 일과 반복되는 대량 로그를 쌓아 두는 일을 한 저장소가 함께 맡게 됩니다.

이미 Fluent Bit → 집계기 → OpenSearch 경로를 쓰고 있다면, 이전 여부는 머물 이유와 떠날 이유를 나눠 따져 볼 문제입니다. OpenSearch에 남을 이유는 풀텍스트 검색, 보안 기능, 관리형 서비스입니다. 다른 저장소를 검토할 이유는 인스턴스 시간에 쏠리는 비용과 샤드 설계 부담입니다. 포기하기 가장 어려운 조건부터 겹쳐 보면 후보가 빨리 좁혀집니다.

| 조건 | 맞는 쪽 | 이유 |
|---|---|---|
| 이미 VictoriaMetrics를 운영 중이고 로그 운영 표면을 늘리고 싶지 않다 | VictoriaLogs | 같은 플래그 관례와 vmauth, vmalert, operator, Helm 계열을 공유 |
| 로그, 트레이스, 세션, 메트릭을 한 저장소와 SQL로 합치려 한다 | ClickHouse와 HyperDX | 한 저장소에서 신호를 상관하고 text index가 풀텍스트 공백을 줄임 |
| 풀텍스트, 보안 플러그인, 관리형을 우선한다 | OpenSearch | 역색인 검색, 문서·필드 수준 보안, 여러 회사의 관리형이 있음 |
| Grafana 생태계에 깊이 들어가 있고 오브젝트 스토리지 비용이 우선이다 | Loki | 같은 UI와 라벨 체계, 오브젝트 스토리지 하나로 장기 보존. VictoriaLogs도 Grafana 플러그인이 있으나 Drilldown은 0.x |
| 보관이 길고(90일 이상) 오래된 데이터를 거의 조회하지 않는다 | 오브젝트 계층이 있는 쪽 | Loki, ClickHouse의 S3 디스크, OpenSearch의 warm 계층 |
| 보관이 짧고 단일 노드로 충분하며 운영 인력이 적다 | VictoriaLogs | 단일 바이너리, 외부 의존성 없음 |
| 요청 ID나 UUID로 값을 모르고 찾는 검색이 잦다 | OpenSearch 또는 ClickHouse | 역색인과 text index가 있고 Loki는 청크 스캔이며 OSS 해법이 아직 없음. ClickHouse는 값 분포에 따라 편차가 있음 |
| 클러스터 안의 복제로 가용성을 얻어야 한다 | OpenSearch, Loki, ClickHouse | VictoriaLogs는 독립 클러스터 둘이 필요해 저장이 두 배 |
| AGPL이 부담스럽고 Grafana를 UI로 쓰지 않는다 | Loki 외 셋 | Loki와 Grafana는 AGPL-3.0이라 Grafana를 UI로 쓰면 같은 고려가 남음. VictoriaLogs는 vmui, ClickHouse는 HyperDX(MIT)를 쓰면 Apache-2.0이나 MIT |

액세스 로그처럼 필드가 정해져 있고 반복이 많은 데이터는 VictoriaLogs와 ClickHouse의 컬럼 압축에서 저장 효율을 기대할 수 있습니다. Loki에서도 라벨을 적게 쓰고 나머지를 structured metadata(인덱싱하지 않고 로그 줄에 붙이는 속성)로 두는 구성이 가능합니다. 앱 로그의 본문을 풀텍스트로 자주 찾는다면 OpenSearch나 ClickHouse의 text index 쪽이 편해 보입니다.

두 로그를 한 저장소에 넣어야 할 필요는 없습니다. 수집 두 단을 그대로 두면 저장소만 나눠 보낼 수 있습니다. VictoriaMetrics를 이미 운영한다면 [VictoriaMetrics 지식베이스]({{< relref "/observability/metrics/victoriametrics/_index.md" >}})의 운영 방식이 그대로 이어집니다. VictoriaLogs는 Loki push와 Elasticsearch bulk를 받으므로 기존 수집기를 바꾸지 않고 시험해 볼 수 있습니다.

EFK를 유지하면서 비용을 줄이는 선택지도 있습니다. OpenSearch 3.x에는 derived source, zstd 코덱, append-only 인덱스가 있습니다. 프로젝트 실험에서 derived source는 저장량을 43~58% 줄였지만 검색 지연은 최대 100% 악화됐습니다(버전과 하드웨어는 밝히지 않았습니다). 문서의 nyc_taxi 벤치마크에서 zstd는 크기를 35% 줄이고 처리량을 7% 높였습니다. 이전을 결정하기 전에 시험해 볼 수단이지만 적용 조건을 함께 봐야 합니다. derived source는 3.2.0부터 제공하며 인덱스를 만들 때만 켤 수 있고, append-only는 업데이트·삭제를 막으며 사용자 지정 문서 ID도 거부합니다. 재시도 중복을 막으려고 ID를 부여하는 구성과는 함께 쓰기 어렵습니다. 관리형의 Optimized 엔진은 서울 리전을 지원하지 않습니다.

어느 후보를 택하든 실제 하루치 로그로 압축비와 대표 쿼리 시간을 재는 편이 공개 수치를 그대로 적용하는 것보다 믿을 만해 보입니다. 공개 수치는 후보를 좁히는 데 쓰고, 실제 데이터의 무작위성과 검색 요구는 직접 확인해야 합니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-22이며 OpenSearch 3.9.0, Loki 3.7.9, VictoriaLogs v1.53.0, ClickHouse 26.9와 HyperDX 2.41.0, Fluent Bit 5.1.5, Vector 0.60.0, OTel Collector contrib v0.163.0, Alloy v1.21.0, Istio 1.31.2를 봤습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| OpenSearch 버전 | 3.9.0(2026-09-29). 2.x 유지보수선은 2.19.7 | OpenSearch 릴리스 | `✓` |
| Amazon OpenSearch Service 지원 | 관리형 최신 지원은 3.7, 오픈소스는 3.9. 개요 페이지는 3.5까지만 적어 문서끼리 어긋남 | AWS 개발자 가이드 | `✓` |
| Loki 버전 | 3.7.9(2026-10-20). 3.7.0(2026-03-26) 이후 새 minor 없음. 3.8·4.0 태그 없음 | Loki 릴리스 | `✓` |
| VictoriaLogs 버전 | v1.53.0(2026-10-01). LTS 라인은 v1.52.1 | VictoriaLogs 릴리스 | `✓` |
| ClickHouse 버전 | 26.9 stable(26.9.23.15, 2026-10-20). LTS는 26.8과 26.3 | ClickHouse 릴리스 | `✓` |
| HyperDX 버전 | 2.41.0(2026-10-13) | HyperDX 릴리스 | `✓` |
| 수집기·메시 버전 | Fluent Bit 5.1.5, Vector 0.60.0, OTel Collector contrib v0.163.0, Alloy v1.21.0. Istio 1.31.2(2026-10-16) | 각 릴리스 페이지, Istio 지원 릴리스 | `✓` |
| VictoriaMetrics 운영 모델 공유 | 같은 플래그 관례, vmauth, vmalert, operator, Helm 계열 | VictoriaLogs 문서 | `✓` |
| 한 저장소로 합치는 쪽 | ClickStack이 ClickHouse, HyperDX, Collector를 한 스택으로 묶음. text index GA는 26.2 | ClickStack architecture, ClickHouse 26.2 블로그 | `✓` |
| OpenSearch의 폭 | 풀텍스트와 집계, 문서·필드 수준 보안, 이상 탐지, AWS·Aiven·Instaclustr 등 관리형 | OpenSearch·AWS 문서 | `✓` |
| Loki와 Grafana | Logs Drilldown 기본 번들, 같은 라벨 체계, 스토리지는 오브젝트 스토리지 하나 | Grafana·Loki 문서 | `✓` |
| 오브젝트 계층 | Loki 오브젝트 스토리지, ClickHouse S3 디스크, OpenSearch UltraWarm·searchable snapshot. VictoriaLogs는 미출시 | 6절과 7절 근거 | `✓` |
| VictoriaLogs의 단순함 | 단일 정적 바이너리, 외부 의존성 없음. 단일 노드로 감당되면 클러스터보다 단일 노드를 우선하라는 문서 권고 | VictoriaLogs README·cluster 문서 | `✓` |
| needle 검색 | OpenSearch 역색인, ClickHouse text index(26.2 GA), Loki는 청크 스캔이고 Logline은 OSS 미출시. TraceId는 ClickStack이 text(array) 인덱스로 처리 | 5절 근거, ClickStack 문서 | `✓` |
| ClickHouse needle 검색의 편차 | 정렬키 밖 고카디널리티 값(요청 ID 등)의 needle 검색은 granule 단위 건너뛰기라 값이 고르게 흩어지면 효과가 줄어듦 | ClickHouse 문서 원리 | `≈` |
| 복제 | VictoriaLogs는 클러스터 내 복제 없음. 독립 클러스터 둘이 권장 HA이며 저장이 복제 수만큼 곱해짐 | VictoriaLogs cluster 문서 | `✓` |
| 라이선스 | Loki·Grafana AGPL-3.0, OpenSearch·ClickHouse·VictoriaLogs Apache-2.0, HyperDX MIT | GitHub 라이선스 메타데이터 | `✓` |
| Grafana UI 경로 | VictoriaLogs와 ClickHouse에도 Grafana 플러그인 경로가 있음. 자체 UI는 VictoriaLogs vmui, HyperDX | VictoriaLogs 데이터소스, ClickHouse 데이터소스 릴리스, ClickStack 문서 | `✓` |
| 두 로그의 성격 분리 | 액세스 로그는 정형·반복, 앱 로그는 본문 검색 비중이 크다는 전제에서 저장소를 나눠 보는 판단 | 2절·4절·5절 근거 | `Σ` |
| 액세스 로그의 압축 기대 | 컬럼 압축의 이점은 반복이 많은 로그에서 크다는 점은 VictoriaLogs FAQ 문구(반복 많은 로그는 100배 이상)를 근거로 한 기대 | VictoriaLogs FAQ | `≈` |
| 적용 조건 | derived source는 Final 설정이라 인덱스 생성 시에만 켜며 3.2.0부터 제공. append-only는 사용자 지정 `_id` 색인 요청을 거부해 Fluent Bit `generate_id`·Vector `id_key`와 충돌 | OpenSearch 문서 | `✓` |
| 이전 전 시험 | derived source는 저장 43~58%↓하지만 검색 지연이 최대 100% 악화(프로젝트 실험, 버전·하드웨어 미기재). zstd는 nyc_taxi 크기 35%↓, 처리량 7%↑(문서 벤치). append-only는 업데이트·삭제 차단. Optimized 엔진은 서울 미지원 | OpenSearch 문서·블로그, AWS What's New | `Ⓥ` |
| 선택 순서 | 가장 비싼 조건부터 겹쳐 보고 실제 하루치 로그로 재는 것이 공개 수치보다 믿을 만하다는 판단. 사용자의 실제 압축비는 데이터 무작위성에 좌우됨 | 6절 근거 | `Σ` |

{{% /details %}}

## 2. user_id를 어디에 두느냐에 따라 저장과 검색이 달라진다

고카디널리티 필드가 있다는 사실만으로 후보가 정해지지는 않습니다. 같은 user_id라도 OpenSearch의 필드, Loki의 라벨, VictoriaLogs의 스트림 필드, ClickHouse의 맵 속성에 놓았을 때 결과가 다릅니다. 저장 단위와 검색 장치가 다르기 때문입니다.

Loki는 같은 라벨 집합에 속한 로그를 스트림으로 묶습니다. 라벨의 값이 늘면 스트림 수가 곱으로 불어납니다. Loki 문서가 trace ID, 사용자 ID, Kubernetes pod 이름을 라벨에서 피하라고 하는 이유입니다. 기본 라벨 수 한도는 15개이고, 테넌트당 활성 스트림 한도도 기본 5,000개입니다. 문서의 활성 스트림 100,000개 미만 가이드는 하루 10TB를 넘는 대형 테넌트 기준이고, 그보다 작은 테넌트는 라벨도 그만큼 적게 쓰라고 문서가 권합니다.

이런 값은 structured metadata로 보내면 됩니다. 인덱싱하지 않고 로그 줄에 붙이며, 쿼리에서는 `{job="x"} | trace_id="..."`처럼 파서 없이 거를 수 있습니다. 이 기능은 스키마 v13과 TSDB 인덱스가 전제이고, 줄당 64KB와 128개 항목을 넘으면 400으로 거부됩니다(Alloy와 모드별 구성은 [Loki 비교 글]({{< relref "/observability/logs/comparison/02-loki-alloy.md" >}})).

VictoriaLogs도 스트림 필드를 고르지만 스키마를 미리 만들지는 않습니다. 문서는 컨테이너나 인스턴스처럼 애플리케이션 인스턴스를 식별하는 값을 스트림 필드로 두고, ip·user_id·trace_id처럼 줄마다 바뀌는 값은 넣지 말라고 명시합니다. 고카디널리티 값도 일반 필드로 두면 문제없다는 설명입니다. 줄당 필드는 2,000개, 필드 이름은 128바이트, 레코드는 2MB까지 받습니다. 저장은 필드별 컬럼 블록으로 하며, VictoriaLogs 문서는 ClickHouse의 설계에서 영감을 받았다고 밝힙니다. 구조와 한계는 [VictoriaLogs 비교 글]({{< relref "/observability/logs/comparison/03-victorialogs.md" >}})에서 따로 다뤘습니다.

OpenSearch와 ClickHouse에서는 스트림 대신 필드와 컬럼 설계가 중요해집니다. OpenSearch의 동적 매핑은 기본적으로 문자열을 text로 잡고 keyword 하위 필드를 붙입니다. 필드 수 한도는 기본 1,000개입니다. OpenSearch 문서는 명시 매핑과 동적 템플릿을 권하며, 임의의 키와 값은 flat_object로 받도록 안내합니다. request_id나 x_forwarded_for를 keyword 필드로 두는 선택은 이 매핑 규칙에 맞아 보입니다.

OpenSearch에서는 샤드(인덱스를 나눠 저장하는 단위)도 미리 설계해야 합니다. 프라이머리 샤드 수는 나중에 바꾸기 어렵습니다. AWS 문서는 쓰기가 많은 로그 인덱스에 샤드 크기 30~50GiB를 권하고, heap 1GiB당 샤드를 25개 이하로 잡도록 안내합니다. 비용과 샤드 설계의 세부는 [OpenSearch 비교 글]({{< relref "/observability/logs/comparison/01-opensearch.md" >}})에 있습니다.

ClickHouse는 테이블 스키마를 직접 정합니다. HyperDX가 사용하는 ClickStack의 로그 테이블은 시각과 서비스 이름으로 정렬하고, 속성을 `Map(LowCardinality(String), String)` 세 개에 담습니다. Kubernetes 이름 여덟 가지는 별도 컬럼으로 물리화하고, 맵 속성 검색은 text index로 보강합니다. text index는 26.2에서 GA가 됐으며 기존 `tokenbf_v1`과 `ngrambf_v1`은 문서에 deprecated로 표기됩니다.

JSON 타입 자체는 ClickHouse 25.3부터 정식으로 쓸 수 있습니다. ClickStack의 JSON 스키마는 아직 beta이고, 문서는 일반 워크로드에 맵 스키마를 권합니다. JSON 타입을 쓰면 동적 경로의 기본 한도 1,024개도 고려해야 합니다. 한도를 넘는 경로는 맵 형태의 shared data로 저장되어 읽기 효율이 떨어집니다. 스키마와 적재 구성은 [ClickHouse 비교 글]({{< relref "/observability/logs/comparison/04-clickhouse.md" >}})과 [HyperDX와 ClickStack 글]({{< relref "/observability/logs/comparison/05-hyperdx-clickstack.md" >}})에 있습니다.

| 축 | OpenSearch | Loki | VictoriaLogs | ClickHouse |
|---|---|---|---|---|
| 저장 단위 | 샤드 안의 Lucene 세그먼트 | 스트림별 압축 청크와 작은 인덱스 | 일 단위 파티션의 필드별 컬럼 블록 | MergeTree 파트의 컬럼 파일 |
| 검색을 돕는 장치 | 역색인, doc_values | 라벨 인덱스(스트림 선택) | 스트림 필터, 블록 bloom filter, 시간 희소 인덱스 | 정렬키, skip index, text index |
| 스키마 | 매핑(동적 또는 명시) | 라벨, structured metadata, 본문 | 없음(평탄화한 JSON) | 테이블 DDL(맵 또는 JSON 타입) |
| 고카디널리티 필드의 자리 | keyword 필드 | structured metadata | 스트림 밖의 일반 필드 | 맵 속성과 인덱스 |
| 미리 정할 것 | 샤드 수, 매핑, 템플릿 | 라벨 셋 | 스트림 필드 | ORDER BY, TTL, 인덱스 |

사고를 막는 방법도 저장소마다 다릅니다. Loki와 VictoriaLogs에서는 고카디널리티 필드를 스트림에 넣지 않는 규칙이 중요합니다. OpenSearch에서는 필드가 늘어나 매핑 한도를 넘는 일을, ClickHouse의 JSON 타입에서는 동적 경로가 넘쳐 읽기 효율이 낮아지는 일을 경계해야 합니다. 같은 JSON 로그를 받더라도 설계할 대상은 서로 다릅니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| OpenSearch 동적 매핑 | 문자열은 text에 keyword 하위 필드. date_detection 기본 켜짐, numeric_detection 꺼짐 | OpenSearch 매핑 문서 | `✓` |
| OpenSearch 매핑 한도 | total_fields 1000, depth 20, nested_fields 50. 문서 권장은 명시 매핑, 동적 템플릿, flat_object | OpenSearch mapping explosion 문서 | `✓` |
| OpenSearch 샤드 권장 | 프라이머리 수는 나중에 바꾸기 어려움. 로그 샤드 30~50GiB, heap 1GiB당 샤드 25개 이하 | AWS 샤딩 문서 | `✓` |
| Loki 라벨 한도 | `max_label_names_per_series` 기본 15. 피할 라벨은 timestamp, IP, pod 이름, user ID, trace ID 등 | Loki cardinality 문서, config 3.7.9 | `✓` |
| Loki structured metadata | 줄당 64KB·128개 초과 시 HTTP 400. schema v13과 TSDB 필요. 파서 없이 `\| trace_id="..."`로 필터 | Loki structured metadata 문서 | `✓` |
| Loki 스트림 한도 | `max_global_streams_per_user` 기본 5000. 가이드는 활성 100,000 미만·일일 누적 1,000,000 미만이고 하루 10TB 초과 대형 테넌트 기준 | Loki 라벨 모범 사례, config 3.7.9 | `✓` |
| VictoriaLogs 스트림 필드 | 인스턴스 식별 필드는 스트림 필드, ip·user_id·trace_id는 절대 넣지 않음. 고카디널리티 필드는 일반 필드면 문제없음 | VictoriaLogs key concepts | `✓` |
| VictoriaLogs 한도 | 줄당 필드 2000개, 필드명 128바이트, 레코드 2MB | VictoriaLogs FAQ | `✓` |
| VictoriaLogs 저장 구조 | 일 단위 파티션, 필드별 컬럼 블록, 블록 bloom filter, `_time` 희소 인덱스. ClickHouse 설계에서 영감을 받았다고 문서가 밝힘 | VictoriaLogs FAQ | `✓` |
| ClickStack 로그 테이블 | ORDER BY `(toStartOfFiveMinutes(Timestamp), ServiceName, Timestamp)`. 속성 맵 3개, Kubernetes 키 8개 물리화 | HyperDX 스키마 seed SQL | `✓` |
| text index | 25.9 experimental, 25.12 beta, 26.2 GA. `tokenbf_v1`·`ngrambf_v1`은 skipping index 문서에서 deprecated 표기 | ClickHouse 문서, 26.2 릴리스 블로그 | `✓` |
| OpenSearch의 고카디널리티 필드 | request_id, x_forwarded_for 같은 값은 keyword로 두는 것이 자연스러움. 문서에 명시된 규칙은 아니고 매핑 규칙에서 따진 것 | OpenSearch 매핑 문서 | `≈` |
| JSON 동적 경로 | `max_dynamic_paths` 기본 1024개. 넘치는 경로는 shared data(맵 형태)로 저장돼 읽기 효율이 떨어짐 | ClickHouse JSON 문서 | `✓` |
| JSON 타입 | ClickHouse 25.3부터 정식 사용 가능. ClickStack JSON 스키마는 2.0.4부터 beta이고 문서는 맵 스키마를 권함 | ClickHouse JSON 문서, ClickStack map-vs-json | `✓` |
| 두 갈래 정리 | 스트림 단위가 있는 쪽(Loki, VictoriaLogs)과 필드·컬럼을 직접 설계하는 쪽(OpenSearch, ClickHouse)으로 나눔 | 위 항목의 종합 | `Σ` |

{{% /details %}}

## 3. 수집 경로는 이어 쓰고 저장소의 입구를 맞춘다

저장소를 바꿔도 수집은 DaemonSet 수집기와 게이트웨이의 두 단 구조를 그대로 쓸 수 있습니다. 바꿔야 하는 것은 저장소가 받는 입구에 맞춘 수집기 출력입니다. 네 스택 모두 노드마다 DaemonSet 수집기를 두어 컨테이너 로그 파일을 읽고, 클러스터 안의 게이트웨이가 모아 저장소로 보내는 구성으로 만들 수 있습니다.

게이트웨이는 저장소가 느려질 때 필요해집니다. 노드 에이전트의 버퍼는 노드 디스크에 묶여 있습니다. 저장소로 보내지 못하는 시간이 길어지면 kubelet의 로그 로테이션이 아직 읽지 않은 파일을 지울 수 있습니다. 게이트웨이는 재시도와 디스크 버퍼, 실패분 격리, 여러 목적지로의 라우팅, 변환을 한곳에서 처리합니다. Vector 문서도 agent와 aggregator를 정식 역할로 나누며, 하나의 모놀리스 aggregator가 단일 장애점이 되지 않도록 클러스터·VPC마다 두기를 권합니다. 이 구조의 자세한 구성은 [Vector와 ClickHouse 파이프라인 글]({{< relref "/observability/logs/09-vector-clickhouse-pipeline/index.md" >}})에 있습니다.

수집기를 고를 때는 처리량에 앞서 저장소가 받는 프로토콜과 수집기의 출력을 맞춰야 합니다.

| 축 | OpenSearch | Loki | VictoriaLogs | ClickHouse와 HyperDX |
|---|---|---|---|---|
| 받는 입구 | Elasticsearch `_bulk`, Data Prepper의 OTLP 소스 | `/otlp`, Loki push | `_bulk`, jsonline, Loki push, OTLP/HTTP, syslog 등 | 서버는 OTLP를 받지 않음. Collector가 받아 insert |
| 잘 붙는 수집기 | Fluent Bit, Fluentd, Vector | Alloy | vlagent, Fluent Bit, Vector, Alloy | OTel Collector, Vector |
| OTel Collector exporter | opensearchexporter(logs alpha) | otlphttp(lokiexporter는 제거됨) | otlphttp 또는 elasticsearch exporter | clickhouseexporter(logs beta) |
| 비고 | OTLP를 표준으로 삼으면 exporter 안정도가 걸림 | promtail은 2026-03-02에 EOL | OTLP/gRPC 수신은 문서에 없음 | Fluent Bit과 Alloy에는 전용 출력이 없음 |

OpenSearch는 Elasticsearch `_bulk`와 호환되어 수집기 선택지가 넓습니다. Fluent Bit에는 `opensearch` 출력과 재시도 중복을 막는 `generate_id`가 있고, Vector의 elasticsearch sink도 OpenSearch를 공식 지원합니다. OTLP를 쓰려면 경로를 더 살펴야 합니다. OTel Collector의 opensearchexporter는 로그가 아직 alpha이고, OpenSearch 프로젝트는 Data Prepper의 OTLP 수신 경로를 제공합니다. OpenSearch 코어가 OTLP를 직접 받는 엔드포인트는 확인하지 못했습니다.

OpenSearch는 저장소 노드가 샤드를 들고 있어서 보관 비용이 노드 수로 이어집니다.

{{< flow src="_flow/1-opensearch.json" />}}

Loki는 `/otlp`에서 OTLP를 직접 받고 OTel Collector는 otlphttp exporter로 보냅니다. contrib v0.163.0 트리에서 lokiexporter는 제거됐습니다. Alloy를 쓰면 `loki.write`나 otelcol exporter를 고를 수 있습니다.

OTLP 속성이 Loki에 들어갈 때는 라벨 변환을 확인해야 합니다. 기본 인덱스 라벨은 17종인데 기본 라벨 수 상한은 15개입니다. 같은 문서는 신규 사용자에게 k8s.pod.name과 service.instance.id를 structured metadata로 옮기도록 권합니다. 나머지 속성도 structured metadata로 가며, 이름의 점은 밑줄로 바뀝니다.

Loki는 노드에 최근 데이터만 남고 나머지는 오브젝트 스토리지에 있습니다.

{{< flow src="_flow/1-loki.json" />}}

VictoriaLogs는 Loki push, Elasticsearch bulk, OTLP/HTTP 등 여러 입구를 제공합니다. 기존 수집기를 유지한 채 저장소를 바꿔 시험하기 쉬운 구성입니다. 전용 수집기 vlagent는 Kubernetes 파드 로그를 자동으로 찾아 수집하고, 여러 `-remoteWrite.url`로 복제 전송하며 대상마다 독립된 디스크 버퍼를 둡니다. 멀티라인 병합과 사용자 정의 포맷 파싱은 지원하지 않습니다. Vector에서는 전용 sink 대신 elasticsearch sink나 http jsonline을 사용합니다.

VictoriaLogs는 클러스터 안에 복제가 없어서 사본이 필요하면 수집 쪽에서 두 번 보냅니다. 클러스터의 vlinsert는 데이터를 나눠 보내지만 복제하지는 않습니다.

{{< flow src="_flow/1-victorialogs.json" />}}

ClickHouse 서버는 OTLP를 직접 받지 않습니다. ClickStack에 동봉된 OTel Collector가 4317과 4318 포트로 받아 clickhouseexporter로 적재합니다. 이 exporter의 로그 지원은 beta입니다. 기본 메모리 큐를 쓰므로 재시작 뒤에도 at-least-once(적어도 한 번 전달)를 원하면 storage extension이 필요합니다. Vector의 clickhouse sink는 stable 등급입니다. Fluent Bit은 전용 출력이 없어서 http 출력으로 ClickHouse의 HTTP 인터페이스에 넣거나 opentelemetry 출력으로 Collector에 보냅니다.

ClickHouse 경로는 직접 고르고 운영할 부품이 가장 많습니다. ReplicatedMergeTree로 복제할 때는 Keeper가 추가됩니다.

{{< flow src="_flow/1-clickhouse.json" />}}

Alloy를 계속 쓰면서 OpenSearch나 ClickHouse로 옮기는 길도 있습니다. Alloy에는 두 저장소의 전용 exporter가 없지만 OTLP exporter는 있습니다. OTLP를 받는 Data Prepper나 ClickStack의 Collector를 중간에 두면 연결할 수 있습니다.

수집기 성능을 같은 조건으로 비교한 공개 자료는 VictoriaMetrics의 2026년 3월 벤치마크가 거의 유일합니다. 측정자는 vlagent 제작사입니다. 수집기마다 1 CPU와 1GiB를 주고 Helm 기본값으로 평균 216바이트 JSON 로그를 보냈을 때, 최대 처리량은 vlagent 초당 143,000줄, Fluent Bit 31,300줄, Vector 25,000줄, OTel Collector 20,500줄, Alloy 15,700줄이었습니다. 파싱과 보강을 거의 하지 않았고 측정 버전도 조사 기준일의 버전보다 오래됐으므로 실제 구성의 처리량 순서로 읽어서는 안 됩니다. 같은 측정에서는 로그 로테이션 중 깨진 레코드가 한 시간 동안 Fluent Bit에서 34건, Vector에서 2건 나왔습니다. 처리량과 함께 정확성을 확인할 이유입니다.

OTLP를 앱 로그의 표준으로 삼을 계획이라면 각 스택의 수신 경로도 선택 조건입니다. OTel은 2026-05-21에 CNCF 졸업을 발표했고 로그의 프로토콜과 SDK 사양은 stable입니다. Loki와 VictoriaLogs는 네이티브 수신, ClickStack은 동봉 Collector, OpenSearch는 코어의 직접 수신을 확인하지 못했고, 확인된 경로는 Data Prepper나 exporter입니다. 같은 OTLP를 사용해도 운영할 중간 컴포넌트와 exporter의 안정도는 같지 않습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| 2단 구성의 이유 | 노드 버퍼는 노드 디스크에 묶이고, 저장소 지연 시 kubelet 로테이션에 밀려 읽기 전 유실. Fluent Bit tail과 Vector kubernetes_logs 공통 | 기존 09편 확인 | `✓` |
| Vector의 역할 분리 | agent와 aggregator를 정식 역할로 나눔. 단일 모놀리스 aggregator는 단일 장애점이라 클러스터·VPC마다 둘 것을 권함 | Vector architecting 문서 | `✓` |
| OTel gateway | load-balancing exporter로 1단에서 2단으로 나누는 구성을 문서가 설명 | OTel gateway 문서 | `✓` |
| VictoriaLogs 복제 | vlinsert는 복제하지 않고 vlstorage에 샤딩만 함 | VictoriaLogs cluster 문서 | `✓` |
| Loki의 저장 위치 | 청크와 인덱스 모두 하나의 오브젝트 스토리지에 둠 | Loki architecture 문서 | `✓` |
| ClickStack 구성 | OSS는 ClickHouse, HyperDX, OTel Collector, MongoDB 넷. MongoDB는 앱 상태(대시보드·알림·사용자) 저장. Keeper는 ReplicatedMergeTree로 복제할 때만 필요 | ClickStack architecture 문서 | `✓` |
| OpenSearch warm 이동 | ISM 정책으로 hot에서 warm·cold로 이동. 관리형은 UltraWarm·cold, 오픈소스는 searchable snapshot | OpenSearch ISM 문서, AWS 문서 | `✓` |
| Fluent Bit OpenSearch 출력 | `generate_id`로 재시도 중복 방지, `suppress_type_name On` 필수(2.0+), `aws_auth` 지원 | Fluent Bit 문서 | `✓` |
| Vector와 OpenSearch | elasticsearch sink가 OpenSearch를 공식 지원, 관리형·Serverless 옵션 | Vector 문서 | `✓` |
| opensearchexporter | 로그·트레이스 alpha, 메트릭 development | OTel contrib README | `✓` |
| Data Prepper | `otel_logs_source`가 OTLP/gRPC를 받음 | OpenSearch 문서 | `✓` |
| OpenSearch 코어의 OTLP 수신 | 코어가 OTLP를 직접 받는 엔드포인트는 확인하지 못함 | OpenSearch 문서 | `?` |
| append-only와 문서 ID | append-only는 사용자 지정 `_id` 색인 요청을 거부. Fluent Bit `generate_id`·Vector `id_key`와 충돌한다는 판단은 문서 조합에서 도출 | OpenSearch append-only 문서 | `≈` |
| Loki OTLP | `/otlp` 엔드포인트, otlphttp exporter 사용. 점은 밑줄로 변환 | Loki OTel 문서 | `✓` |
| Loki 기본 라벨 | OTLP 기본 인덱스 라벨 17종, 라벨 상한 기본 15. pod 이름·service.instance.id는 structured metadata 권장 | Loki OTel 문서 | `✓` |
| lokiexporter | contrib v0.163.0 트리에서 제거됨 | OTel contrib 메타데이터 | `✓` |
| promtail | EOL 2026-03-02, 3.7.3에서 저장소 제거 | Loki promtail 문서, v3.7 노트 | `✓` |
| Alloy 출구 | `loki.write`와 otelcol exporter(otlp, otlphttp, kafka 등). OpenSearch·ClickHouse 전용 exporter 없음. ClickStack Collector(4317·4318)와 Data Prepper `otel_logs_source`는 OTLP를 받으므로 이 경로로 연결 가능 | Alloy v1.21.0 컴포넌트 문서 | `✓` |
| VictoriaLogs 입구 | `_bulk`, jsonline, Loki push, OTLP/HTTP, syslog, Splunk, DataDog, native. OTLP/gRPC는 문서에 없음 | VictoriaLogs 수집 문서 | `✓` |
| vlagent | Kubernetes 자동 수집, 복제 전송과 URL별 디스크 버퍼. 멀티라인 병합과 사용자 정의 파싱 미지원 | vlagent 문서, 수집기 벤치 글 | `✓` |
| Vector와 VictoriaLogs | 전용 sink 없음. elasticsearch sink(api_version v8)나 http jsonline 예시를 문서가 제시 | Vector 문서, VictoriaLogs 문서 | `✓` |
| ClickStack 수집 | 동봉 OTel Collector(4317·4318)가 받아 clickhouseexporter로 적재. exporter 로그 beta | ClickStack architecture, exporter README | `✓` |
| clickhouseexporter 큐 | 메모리 `sending_queue` 기본 활성. 재시작 후 at-least-once는 storage extension 필요 | exporter README | `✓` |
| Fluent Bit과 ClickHouse | 전용 출력 없음. http 또는 opentelemetry 출력 사용 | Fluent Bit 문서 목록 | `✓` |
| 수집기 처리량 | 1 CPU·1GiB 제한, Helm 기본값, 평균 216B JSON, GCP n2-highcpu-32 단일 노드 kind. 측정 버전은 vlagent v1.48.0, Fluent Bit v4.2.3, Vector v0.53.0, OTel Collector v0.146.1, Alloy v1.13.2. vlagent 143,000, Fluent Bit 31,300, Vector 25,000, OTel Collector 20,500, Alloy 15,700 logs/s. 측정자는 vlagent 제작사 | VictoriaMetrics 수집기 벤치(2026-03-20) | `Ⓑ` |
| 로테이션 중 깨진 레코드 | 1시간·10k logs/s 조건에서 Fluent Bit 34건, Vector 2건(위와 같은 측정 버전) | VictoriaMetrics 수집기 벤치 | `Ⓑ` |
| OTel 상태 | 2026-05-21 CNCF 졸업 발표. 로그의 Bridge API·SDK·Protocol stable | CNCF 발표, OTel 상태 페이지 | `✓` |
| OTLP 일급 경로의 비대칭 | Loki·VictoriaLogs는 네이티브 수신, ClickStack은 동봉 Collector 경유. OpenSearch 코어의 OTLP 수신은 확인하지 못했고 Data Prepper와 exporter가 확인된 경로 | 위 항목의 종합 | `Σ` |
| 중간 단 필요 여부 | 전용 exporter가 없는 Alloy는 OpenSearch·ClickHouse로 갈 때 OTLP를 받는 중간 단이 필요하고, VictoriaLogs는 중간 단 없이 저장소만 바꿔 볼 수 있다는 판단 | 위 항목의 종합 | `Σ` |

{{% /details %}}

## 4. Istio 로그는 필드 배치와 출력 타입을 함께 정한다

Istio 액세스 로그는 값의 종류가 적은 필드와 계속 늘어나는 필드를 나눠 배치하는 데서 시작합니다. 서비스나 방향처럼 값이 제한된 필드는 라벨·스트림 키·정렬키 후보가 됩니다. 요청 ID나 클라이언트 IP처럼 계속 바뀌는 값은 본문·일반 필드·컬럼에 두는 쪽입니다.

| 값의 종류가 적은 필드 | 값의 종류가 계속 늘어나는 필드 |
|---|---|
| namespace, 서비스(app), workload, cluster | x_request_id, trace_id |
| method, response_code, response_flags | path(쿼리스트링 포함), user_agent |
| upstream_cluster, route_name | 클라이언트 IP, x_forwarded_for |
| 방향(inbound·outbound), mTLS 여부 | upstream_host(파드 IP와 포트), pod 이름 |

이 분류를 저장소에 적용하면 다음 구성이 나옵니다. 각 저장소의 일반 규칙을 적용한 판단이며, Envoy 액세스 로그 전용 권장 구성으로 확인한 것은 아닙니다.

| 저장소 | 값이 적은 필드 | 값이 늘어나는 필드 | 주의 |
|---|---|---|---|
| OpenSearch | keyword나 숫자 필드로 명시 매핑 | keyword(`ignore_above` 지정), path는 필요하면 text 하위 필드 | data stream과 index template, 동적 매핑 끄기, 숫자 타입 명시 |
| Loki | 라벨은 cluster, namespace, service_name, container 정도 | structured metadata 또는 본문 | response_code와 method는 스트림 수를 곱하므로 structured metadata가 무난 |
| VictoriaLogs | 스트림 필드는 namespace, pod 또는 workload, container | 일반 필드 | `envoyOtelAls`로 보내면 resource 속성이 모두 스트림이 되므로 헤더로 명시 |
| ClickHouse | 자주 거르는 값은 LowCardinality 물리화 컬럼 | 맵 속성 | 26.9의 `keyValuePairs` 토크나이저를 쓰면 맵 조회도 인덱스를 탐 |

출력은 JSON을 전제로 합니다. Istio 문서가 권하는 활성화 방법은 Telemetry API의 `accessLogging`에 `envoy` 프로바이더를 지정하는 것입니다. 적용 범위는 네임스페이스나 워크로드로 좁힐 수 있습니다. 출력 형식은 `meshConfig.accessLogEncoding`에서 고르며 기본값은 TEXT입니다.

JSON으로 바꿨다고 숫자 타입까지 확정되는 것은 아닙니다. Istio는 `json_format`을 사용합니다. Envoy API 정의는 값을 "strings, numbers, or boolean values as appropriate"로 낸다고 설명하지만, Envoy 사용 문서는 `json_format`이 `"duration": "123"` 같은 문자열을 내며 숫자 보존에는 `typed_json_format`이 필요하다고 적습니다. 헤더에서 온 값은 문자열입니다. Istio 1.31의 실제 출력에서 duration과 bytes가 숫자인지는 직접 확인하지 못했습니다.

이 차이는 OpenSearch에서 중요합니다. 문자열 숫자가 동적 매핑으로 text와 keyword에 들어가면 범위 질의와 평균 집계를 할 수 없습니다. 날짜처럼 보이는 문자열은 첫 문서에서 date로 잡히고, 이후 다른 형식이 들어오면 색인이 거부될 수 있습니다. response_code, bytes, duration, upstream_service_time은 템플릿에 숫자 타입을 명시하고, 값이 `"-"`일 수 있다면 `ignore_malformed`나 수집기 변환을 두는 구성이 필요합니다.

액세스 로그에는 비율 샘플링 필드가 없으며 `randomSamplingPercentage`는 트레이싱 전용입니다. Telemetry의 CEL 필터나 수집기 필터로 줄일 수 있고, 문서의 CEL 예시는 `response.code >= 400`입니다. 사이드카 모드에서는 메시 안의 호출 한 건에 클라이언트와 서버 사이드카가 각각 한 줄을 낼 수 있습니다. 모드 정의대로라면 `match.mode`로 한쪽만 남길 때 두 줄이 한 줄로 줄어듭니다. 실제 줄 수는 재 보지 못했습니다. ambient 모드는 로그 단위부터 다릅니다. ztunnel은 연결 단위 L4 로그를 key=value로 남기고, 요청 단위 L7 로그는 waypoint의 Envoy에서 나옵니다.

파일 수집을 건너뛰는 경로도 있습니다. MeshConfig의 `envoyOtelAls`를 쓰면 사이드카가 OTLP/gRPC로 Collector에 직접 전송합니다. `logFormat.text`는 OTel 본문이 되고 `logFormat.labels`는 속성이 됩니다. 앞의 도식은 파일을 읽는 경로를 그렸지만, 이 설정을 쓰면 DaemonSet 수집 단계를 거치지 않고 게이트웨이에 바로 보낼 수 있습니다.

ClickHouse에서는 이렇게 받은 사이드카 로그의 `labels`가 `LogAttributes` 맵에 들어갑니다. ClickStack이 Kubernetes 리소스 속성을 `__hdx_materialized_*` 컬럼으로 분리한 방식에 비춰 보면, response_code·response_flags·upstream_cluster도 물리화 컬럼으로 빼는 구성이 자연스러워 보입니다. Istio 액세스 로그를 ClickHouse에 넣은 공개 사례와 권장 스키마는 찾지 못했으므로 추론입니다. Istio 쪽 설정은 [Istio 분류]({{< relref "/platform/istio/_index.md" >}})에서 이어집니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| 켜는 방법 | Telemetry API의 `accessLogging`에 `envoy` 프로바이더가 권장. `accessLogEncoding` 기본 TEXT, JSON 선택 | Istio 액세스 로그 문서, MeshConfig 레퍼런스 | `✓` |
| 샘플링과 필터 | 액세스 로그에 비율 샘플링 필드 없음(`randomSamplingPercentage`는 tracing 전용). CEL 필터와 `match.mode` 제공 | Istio Telemetry 레퍼런스 | `✓` |
| 사이드카의 두 줄 | 클라이언트·서버 사이드카가 각 한 줄을 낼 수 있고, `match.mode`로 한쪽만 남기면 절반. 실측 아님 | Istio Telemetry 레퍼런스의 모드 정의 | `≈` |
| ambient 로그 | ztunnel은 연결 단위 L4 로그(key=value). L7 로그는 waypoint의 Envoy에서 나옴 | Istio ztunnel·waypoint 문서 | `✓` |
| OTel ALS | `envoyOtelAls`로 사이드카가 OTLP/gRPC(예시 포트 4317)로 Collector에 직접 전송. `logFormat.text`는 body, `labels`는 attributes | Istio OTel 프로바이더 문서, MeshConfig 레퍼런스 | `✓` |
| 카디널리티 분류표 | 값이 적은 필드와 늘어나는 필드의 구분은 필드 의미에서 따진 분석. Loki가 `k8s.pod.name`과 `service.instance.id`를 고카디널리티로 지목한 것은 문서에 있음 | Loki OTel 문서 | `≈` |
| 저장소별 Istio 구성 | OpenSearch의 data stream과 명시 매핑 템플릿, Loki 라벨 셋, VictoriaLogs 스트림 필드, ClickHouse 물리화 컬럼은 각 저장소의 일반 규칙을 적용해 도출. Loki·VictoriaLogs 문서에서 Envoy 액세스 로그 전용 지침을 찾지 못함. OpenSearch도 전용 권장은 찾지 못했고, ClickHouse는 공개 사례와 권장 스키마를 찾지 못함 | 각 저장소 문서 | `≈` |
| OpenSearch 동적 매핑 결과 | 문자열 숫자는 text·keyword. 날짜형 문자열은 첫 문서로 date 고정. 이후 형식이 다르면 거부될 수 있다는 점은 기본값에서 따진 것 | OpenSearch 매핑 문서 | `≈` |
| Envoy 타입 표현 | Istio는 `json_format` 사용, API 정의는 "strings, numbers, or boolean values as appropriate". Envoy 사용 문서는 json_format이 문자열을 내고 타입 보존은 `typed_json_format`이라고 설명. 헤더에서 온 값은 문자열 | Istio `telemetry_logging.go`, Envoy SubstitutionFormatString proto, Envoy access log 문서 | `✓` |
| Istio 1.31 실제 출력 | duration·bytes가 숫자인지, 미설정 값이 `"-"`인지 null인지 실측하지 못함 | — | `?` |
| ClickHouse의 Istio 구성 | 물리화 컬럼과 `keyValuePairs` 토크나이저(26.9) 조합은 ClickStack의 방식에서 추론. 공개 사례 확인 못 함 | ClickHouse changelog, HyperDX seed SQL | `≈` |

{{% /details %}}

## 5. 찾으려는 로그에 따라 검색 성능의 의미가 달라진다

요청 ID나 UUID를 찾는 needle 검색과 본문의 구문을 찾는 검색, 여러 필드를 묶는 집계는 같은 작업이 아닙니다. 저장소가 어느 단계에서 읽을 데이터를 줄이는지 보면 공개 성능 수치를 이해하기 쉽습니다.

OpenSearch는 역색인(단어에서 문서를 찾는 색인)을 사용합니다. 구문·퍼지·와일드카드 검색과 BM25 관련도 점수, 집계와 경보를 한 제품에서 다룰 수 있습니다. Loki는 라벨과 시간으로 범위를 좁힌 뒤 청크를 내려받아 훑습니다. bloom filter(읽지 않아도 될 블록을 거르는 장치)는 structured metadata의 동등 필터만 가속하며 라인 필터에는 도움이 되지 않습니다. 이 기능은 3.7.9에서도 experimental입니다. Grafana가 소개한 Logline 인덱스는 Grafana Cloud 비공개 프리뷰이며 Grafana는 오픈소스에도 다음 major에서 넣겠다고 밝혔습니다.

VictoriaLogs는 블록 bloom filter로 단어와 구문 필터를 돕습니다. trace_id 전용 인덱스는 없어서 시간 범위를 얼마나 좁히는지가 조회 성능에 크게 영향을 줍니다. ClickHouse의 text index는 26.2에서 GA가 되어 풀텍스트 검색의 선택지가 넓어졌습니다. 토큰 존재 여부를 판정하는 방식이며 관련도 점수 기능은 문서에 언급되어 있지 않습니다.

색인이 검색을 도와도 적재 비용까지 줄이는 것은 아닙니다. ClickHouse가 공개한 50TB 로그 실험에서는 text index를 사용했을 때 insert 처리량이 약 50% 줄었습니다. 별도의 GitHub Events 테이블에서는 압축이 약 9배에서 약 6배로 낮아졌습니다.

기존 쿼리를 옮기는 비용도 있습니다. OpenSearch는 Query DSL·SQL·PPL을 사용합니다. Loki 문서는 LogQL에서 시간과 라벨로 좁힌 뒤 라인 필터와 파서를 왼쪽부터 적용하도록 권합니다. VictoriaLogs의 LogsQL은 필터와 50여 개 파이프로 구성되며 LogQL·SQL 변환 가이드가 있습니다. HyperDX는 Lucene 스타일 검색과 SQL을 받지만 SQL 모드에는 WHERE 절만 넣을 수 있습니다.

네 저장소를 같은 조건에서 잰 독립 측정은 찾지 못했습니다. 공개 수치는 대체로 제품을 짝지어 비교했고, 측정자도 한쪽 제품의 벤더인 경우가 많습니다. 다음 결과는 측정 대상과 조건을 함께 읽어야 합니다.

ClickHouse가 직접 수행한 TextBench는 OTel 데모 로그 500억 행을 단일 복제본으로 저장했습니다. ClickHouse 26.3은 2.43TiB, Elasticsearch 9.3.2는 12.01TiB를 사용했으며, 모든 측정 규모에서 저장량 차이는 4.95배였습니다. 아홉 질의의 합계 시간은 캐시를 끈 콜드 상태에서 26.2초 대 111.4초, 핫 상태에서 20.3초 대 34.2초였습니다. 각각 m6i.8xlarge 한 대를 사용한 결과이고 비교 대상은 Elasticsearch입니다. Elasticsearch의 LogsDB 모드를 썼는지는 적혀 있지 않습니다. OpenSearch의 결과로 대입할 수는 없습니다.

OpenSearch와 ClickHouse를 함께 잰 공개 자료는 Apache Doris 쪽 벤더인 VeloDB의 측정 하나뿐입니다. 합성 에이전트 JSON 1억 행에서 OpenSearch 3.6.0은 194.7GB, ClickHouse 26.2는 53.8GB로 3.6배 차이가 났습니다. OpenSearch 설정은 공개되지 않았습니다.

VictoriaLogs까지 같은 하드웨어에서 비교한 저장량 자료는 ClickHouse가 운영하는 JSONBench입니다. 로그가 아닌 Bluesky 소셜 JSON 10억 건에서 VictoriaLogs v1.17.0은 113.5GiB, ClickHouse 25.11은 92.7GiB, Elasticsearch 8.17.0의 no-source 설정은 219.6GiB를 사용했습니다. VictoriaLogs 결과는 오래된 버전이며 JSON 구조를 보존하지 않는 조건입니다.

VictoriaLogs와 Loki의 비교는 TrueFoundry 소속 저자의 측정이 대표적입니다. 동일한 4 vCPU·8GiB 노드에 합성 로그 약 500GB를 7일 치로 넣었을 때 저장량은 Loki 501GB, VictoriaLogs 318GB였습니다. needle 검색은 12초 대 약 0.9초였습니다. 저자의 소속사는 VictoriaLogs를 기본으로 채택한 곳이고, 제품 버전과 Loki 저장 백엔드는 기재하지 않았습니다. 본문 안의 수치도 서로 어긋나므로 여러 매체의 재게시를 별도 검증으로 셀 수는 없습니다. VictoriaLogs 문서가 내세우는 Loki 대비 풀텍스트 최대 1000배, Elasticsearch·Loki 대비 RAM 최대 30배와 디스크 최대 15배 절감은 측정 조건이 없는 벤더 주장입니다.

집계에서는 OpenSearch 프로젝트의 자체 결과가 있습니다. 3.3과 1.3.18을 비교한 Big5 워크로드는 약 100GB 데이터를 c5.2xlarge 한 대에 넣고 레플리카 없이 측정했습니다. 지오메트릭 질의의 평균 지연은 159.04ms에서 14.03ms로 약 11배 줄었습니다. OpenSearch는 star-tree로 고카디널리티 집계를 미리 계산할 수도 있습니다. 프로젝트 문서가 제시하는 향상 폭은 고카디널리티 multi-term 집계 약 3배, 복잡한 쿼리 최대 약 40배이며, append-only 인덱스와 사전 차원 정의가 필요합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| 독립 벤치의 부재 | 네 저장소를 같은 하드웨어·같은 로그로 잰 2025~2026 독립 벤치마크는 찾지 못함 | 조사 전체 | `?` |
| 질의 언어 | OpenSearch는 DSL·SQL·PPL, LogQL 권장 순서는 시간, 라벨, 라인 필터, 파서. LogsQL 파이프 50여 개와 변환 가이드. HyperDX SQL 모드는 WHERE 절만 | 각 저장소 문서 | `✓` |
| OpenSearch 풀텍스트 | phrase·fuzzy·wildcard·BM25와 집계·경보가 한 제품에 있음 | OpenSearch 문서 종합 | `✓` |
| Loki needle 검색 | 인덱스는 라벨 집합만 가리키고 청크를 내려받아 훑음. bloom은 structured metadata 동등 필터만 가속(라인 필터 제외), experimental | Loki architecture, query acceleration, bloom 문서 | `✓` |
| Logline 인덱스 | Grafana Cloud 비공개 프리뷰, 오픈소스는 다음 major. UUID 쿼리 3.5TB 스캔이 8GB로 줄었다는 초기 벤치(데이터셋·하드웨어 미기재) | Grafana Logline 인수 블로그 | `Ⓥ` |
| VictoriaLogs trace_id | 블록 bloom filter는 있으나 trace_id 전용 인덱스 없음. 조회는 시간 범위에 크게 좌우 | VictoriaMetrics 개발 노트(2025-06-09) | `✓` |
| text index 비용 | 50TB 로그(Cloud 59 vCPU·256GB) 실험에서 insert 처리량 약 50% 감소. 압축 약 9배에서 약 6배는 별도 GitHub Events 100억 행 이상 테이블 | ClickHouse text index GA 블로그(2026-03-10) | `Ⓥ` |
| text index 한계 | 토큰 존재만 판정, 관련도 점수 기능 언급 없음 | ClickHouse text index 문서 | `✓` |
| TextBench | ClickHouse 26.3 대 Elasticsearch 9.3.2, 각 m6i.8xlarge(32 vCPU·128GiB, gp3 16k IOPS) 단일 노드·복제 없음. ES는 best_compression, 샤드 약 50GB, force-merge. 50B행 저장 2.43TiB 대 12.01TiB(4.95배, 전 규모 동일), 9개 질의 합계 cold 26.2s 대 111.4s, hot 20.3s 대 34.2s. 측정자는 ClickHouse, 비교 대상은 OpenSearch 아님 | ClickHouse TextBench 블로그(2026-04-23) | `Ⓑ` |
| JSONBench | ClickHouse 운영. m6i.8xlarge·gp3, Bluesky JSON 10억 건(로그 아님). VictoriaLogs v1.17.0(2025-03-28 측정) 113.5GiB, ClickHouse 25.11 92.7GiB, Elasticsearch 8.17.0 no-source 219.6GiB. VictoriaLogs 결과는 구조 보존 안 함 조건이고 버전이 오래됨 | JSONBench 저장소 | `Ⓑ` |
| VeloDB 벤치 | m6i.8xlarge 단일 노드, AgentLogsBench 합성 JSON 1억 행. OpenSearch 3.6.0 194.7GB, Elasticsearch 191.9GB, Doris 62.2GB, ClickHouse 26.2 53.8GB. OpenSearch 설정 미공개. 측정자는 경쟁 벤더 | VeloDB 블로그(2026-08-27) | `Ⓑ` |
| TrueFoundry 측정 | 4 vCPU/8GiB 동일 노드, flog 합성 로그 약 500GB/7일, 캐시 끄고 재시작 후 측정. 저장 Loki 501GB 대 VictoriaLogs 318GB, needle 12s 대 약 0.9s. 버전·Loki 백엔드 미기재, 절 사이 수치 불일치. 저자 소속사가 VictoriaLogs 채택 | harshit.cloud 블로그 | `Ⓑ` |
| VictoriaLogs 벤더 주장 | Loki 대비 풀텍스트 최대 1000배, Elasticsearch·Loki 대비 RAM 최대 30배·디스크 최대 15배. 조건 미기재 | VictoriaLogs FAQ, README | `Ⓥ` |
| OpenSearch 3.3 성능 | Big5(약 100GB, 1억 1,600만 문서), c5.2xlarge 단일 노드, 프라이머리 1·레플리카 0. 지오메트릭 평균 지연 159.04ms에서 14.03ms(약 11배). 3.3 대 1.3.18. 측정자는 프로젝트 | OpenSearch 블로그(3.3 성능) | `Ⓥ` |
| star-tree | 고카디널리티 multi-term 집계 약 3배, 복잡한 쿼리 최대 약 40배. append-only와 사전 차원 정의 필요 | OpenSearch star-tree 문서 | `Ⓥ` |

{{% /details %}}

## 6. 보관료 비교와 총비용은 다르다

하루 원본 로그 100GB를 30일 보관하면 원본은 3TB, 90일이면 9TB입니다. 공개 단가로 추정하면 스토리지 비용 차이는 크게 보입니다. 서울 리전 단가와 서로 다른 출처의 압축비를 적용한 예시에서, 30일 보관의 월 비용은 OpenSearch 약 459달러, Loki 약 18달러, VictoriaLogs와 ClickHouse 각각 약 27달러입니다. 90일이면 각각 약 1,377달러, 약 55달러, 약 82달러입니다.

이 계산은 총비용 비교가 아닙니다. 네 저장소 모두 단일 사본이고 운영 여유를 더하지 않았으며, 컴퓨트·요청·전송 비용을 제외했습니다. OpenSearch는 원본의 110%를 관리형 gp3에, Loki는 4.1배 압축한 데이터를 S3 Standard에 두었습니다. VictoriaLogs와 ClickHouse는 10배 압축을 가정해 EBS gp3에 두었습니다. 레플리카와 여유를 반영하려면 네 저장소에 같은 방식으로 곱해야 하고, 압축비가 달라지면 계산 결과도 비례해 달라집니다.

압축비의 출처부터 서로 다릅니다. AWS 문서는 OpenSearch 로그 인덱스가 원본의 약 110%이고, 레플리카 하나와 운영 여유를 더하면 최소 디스크가 원본의 약 2.9배라고 설명합니다. ClickHouse의 자체 측정에서 Elasticsearch는 비압축 컬럼 크기의 약 0.38배였고 ClickHouse는 내부적으로 약 16.3배 압축됐습니다. ClickStack 사이징 문서는 로그의 10배 압축을 보수적인 가정으로 둡니다. VictoriaLogs 문서는 보통 10배 이상, 반복이 많은 로그는 100배 이상이라고 설명하면서 무작위 값이 많으면 압축률이 매우 낮을 수 있다고 덧붙입니다. Loki는 Grafana의 공식 압축비를 찾지 못했고, 4.1배는 소규모 독립 측정에서 원본 40.9MB가 10.1MB로 줄어든 결과입니다.

따라서 예시의 저장량 차이를 제품 간 압축 성능 차이로 읽어서는 안 됩니다. OpenSearch 1.1배와 VictoriaLogs·ClickHouse 10배 압축을 적용하면 용량 차이가 약 11배가 됩니다. OpenSearch와 ClickHouse를 VeloDB가 단일 사본으로 잰 차이는 3.6배이고, ClickHouse가 Elasticsearch와 잰 차이는 4.95배입니다. 10배는 측정값이 아니라 벤더 문서의 가정이고, 같은 하드웨어에서 잰 JSONBench에서는 VictoriaLogs가 ClickHouse보다 약 1.2배 컸습니다. Loki도 Grafana가 발표한 현행 구조의 내부 메트릭에서 로그 한 줄을 평균 2.3번 저장하므로, 단일 사본을 가정한 예시 비용은 낮게 잡혔습니다.

실제로 비용이 쏠리는 곳은 저장 방식에 따라 다릅니다. OpenSearch는 역색인과 doc_values를 서빙하는 인스턴스가 상시 필요합니다. AWS 사이징 공식은 원본에 (1+레플리카)와 1.45를 곱하고, 로컬 NVMe 인스턴스는 디스크가 인스턴스 요금에 포함됩니다. 저장량이 늘면 인스턴스 수도 늘어나는 구성입니다. 기존 비교 글에서 인스턴스 시간이 비용의 약 90%일 것으로 본 이유입니다.

Loki는 오브젝트 스토리지의 용량·요청 수와 쿼리가 읽는 바이트에 비례하는 컴퓨트 비용이 중요해 보입니다. 작은 라벨 인덱스는 디스크 사용을 줄입니다. VictoriaLogs는 로컬 블록 디스크와 단일 바이너리의 컴퓨트 비용이 중심이며, 고가용성을 위해 독립 클러스터 두 벌을 두면 저장량도 두 배가 됩니다. ClickHouse는 압축 후 디스크나 S3 디스크와 머지 CPU가 비용에 영향을 주고, 복제하면 레플리카 수만큼 저장량이 늘어납니다.

하루 100GB에서는 컴퓨트가 스토리지보다 비용을 크게 좌우할 수 있습니다. 서울 단가로 OpenSearch의 r8g.2xlarge.search 한 대를 한 달 내내 켜면 약 689달러이고, i7i.4xlarge.search는 약 2,069달러입니다. Loki 문서는 monolithic을 하루 약 20GB까지, SSD를 하루 1TB 가까이까지로 설명합니다. 하루 100GB는 그 사이지만 SSD 모드는 4.0에서 제거될 예정입니다. 공식 사이징 표는 microservices 기준만 제공하며, 하루 3TB 미만 구간의 요청 자원을 CPU 38개와 메모리 59Gi로 적습니다. 이를 하루 100GB에 그대로 적용하기는 어렵습니다.

ClickStack 사이징 문서는 수집 10MB/s마다 1 vCPU를 제시합니다. 하루 100GB는 약 1.2MB/s입니다. 질의 CPU는 문서의 본문과 표가 서로 어긋나므로 이 공식만으로 전체 자원을 정할 수는 없습니다.

보관 기간이 길어지면 디스크 종류의 영향이 커집니다. 30일은 대부분 핫 계층에 둔다는 전제에서 블록 스토리지와 쿼리 컴퓨트가 주요 비용이며, 저장소 간 차이는 RAM과 CPU에서 더 클 것으로 보입니다. 90일이면 용량이 세 배가 됩니다. 서울의 EBS gp3는 GB-월 0.0912달러, S3 Standard는 0.025달러로 약 3.6배 차이가 나므로 오브젝트 계층을 쓸 수 있는 저장소가 유리해지는 구간으로 추정합니다. 180일 보관에서 오래된 데이터를 거의 조회하지 않는다면 S3 요청 요금과 콜드 쿼리 지연도 비용 판단에 들어갈 것으로 보입니다.

VictoriaLogs에는 정식 오브젝트 스토리지 계층이 없어 보관 기간만큼 블록 디스크를 늘려야 합니다. 구현 PR은 열려 있고 메인테이너가 밝힌 머지 목표는 2026년 11월입니다. 공개된 설계에서는 최근 하루 이상을 로컬 디스크에 남기며, 옮긴 파티션은 읽기 전용이 됩니다.

관리형은 과금 단위가 또 다릅니다. ClickHouse 가격 페이지의 Cloud Enterprise 단가는 AWS us-east-1에서 컴퓨트 유닛(8GiB, 2vCPU) 시간당 0.3903달러, 스토리지 TB-월 25.30달러입니다. ClickStack에는 GB당 수집 요금이 없습니다. AWS는 Amazon OpenSearch Service Optimized 엔진으로 스토리지를 최대 70% 줄이고 price-performance를 최대 4배 높일 수 있다고 발표했습니다. 이 수치는 AWS 내부 벤치마크 결과이고, 서울 리전에서는 쓸 수 없습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| OpenSearch 비용 구조 | 사이징 공식은 원본×(1+레플리카)×1.45. i7i·OI2는 로컬 NVMe가 인스턴스 요금에 포함. 인스턴스 시간이 비용의 약 90%라는 추정은 구조 근거로 보강됨 | AWS 스토리지 계산 문서, 가격표 | `≈` |
| OpenSearch 인덱스 크기 | 원본 대비 약 110%, 인덱스는 최대 10%. 레플리카 1개면 2.2배, 여유 포함 2.9배 | AWS 스토리지 계산 문서 | `✓` |
| Loki·VictoriaLogs·ClickHouse 쏠림 | 각 저장소 구조에서 따진 것. Loki는 오브젝트 스토리지 요청과 쿼리 컴퓨트, VictoriaLogs는 로컬 디스크와 HA 시 2배, ClickHouse는 압축 후 디스크와 머지 CPU | 각 저장소 문서 | `≈` |
| ES·ClickHouse 압축 | OTel 로그 1B행 기준 Elasticsearch 245.06GiB는 비압축 컬럼 642.42GiB의 약 0.38배. ClickHouse 내부 압축 약 16.3배(비압축 31.31TiB 기준). 측정자는 ClickHouse | ClickHouse TextBench 블로그 | `Ⓑ` |
| ClickStack 압축 가정 | 로그·트레이스에 10배는 대체로 보수적이라는 사이징 문서의 전제 | ClickStack estimating-resources | `Ⓥ` |
| VictoriaLogs 압축 | 보통 10배 이상(README), 반복 많은 로그 100배 이상·무작위 값 많으면 매우 낮음(FAQ) | VictoriaLogs README·FAQ | `Ⓥ` |
| Loki 압축 | 공식 수치 미확인. Loki 3.7.8 단일 바이너리에서 40.9MB 원본이 10.1MB(원본의 24.6%, 약 4.1배). 300k 줄 소규모, 단일 노드 | Platform Monkey 블로그(2026-09-19) | `Ⓑ` |
| 예시 계산 전제 | 하루 원본 100GB, 보관 30일 3TB·90일 9TB. 네 저장소 모두 복제 계수 1·운영 여유 0(레플리카·여유는 곱하지 않음), 컴퓨트·요청·전송 제외 | 이 글의 계산 | `≈` |
| 예시: OpenSearch | 원본의 1.1배 적용 시 30일 3,300GB·90일 9,900GB. 서울 관리형 gp3 $0.1391/GB-월로 월 약 $459와 $1,377 | AWS Price List(ap-northeast-2, 2026-10-20) | `≈` |
| 예시: Loki | 4.1배 압축 시 30일 약 732GB·90일 약 2,195GB. 서울 S3 Standard $0.025/GB-월로 월 약 $18.3과 $54.9 | AWS Price List(S3, 2026-10-15) | `≈` |
| 예시: VictoriaLogs·ClickHouse | 10배 압축 시 30일 300GB·90일 900GB. 서울 EBS gp3 $0.0912/GB-월로 월 약 $27.4와 $82.1. ClickHouse를 S3 디스크에 두면 약 $7.5와 $22.5 | AWS Price List(EBS·S3, 2026-10-15) | `≈` |
| 용량 격차 | 예시 가정(OpenSearch 1.1배 대 10배 압축)의 격차는 약 11배. 단일 사본 공개 실측은 VeloDB 3.6배, TextBench 4.95배. JSONBench에서 VictoriaLogs v1.17.0 113.5GiB 대 ClickHouse 25.11 92.7GiB(약 1.2배) | 5절 근거, 이 글의 계산 | `≈` |
| Loki 저장 횟수 | Grafana 내부 메트릭상 현행 RF3 구조에서 로그 한 줄이 평균 2.3번 저장(조건 미기재). 예시의 Loki는 단일 사본이라 저장량이 낮게 잡힘 | InfoQ, GrafanaCON 2026 세션 | `Ⓥ` |
| OpenSearch 인스턴스 예시 | 서울 r8g.2xlarge.search $0.944/h, i7i.4xlarge.search $2.834/h. 730시간 상시 가동 시 월 약 $689와 $2,069 | AWS Price List(ap-northeast-2, 2026-10-20) | `≈` |
| Loki 배포 모드 | monolithic은 문서가 약 20GB/day까지, SSD는 close to a TB/day이고 4.0에서 제거. 하루 100GB가 그 사이라는 판단은 두 수치의 비교 | Loki 배포 모드 문서 | `✓` |
| Loki 사이징 표 | microservices 기준만 있음. 3TB/day 미만 티어 요청 합계 CPU 38·메모리 59Gi(p90 기준) | Loki 사이징 문서 | `✓` |
| ClickStack 사이징 | 수집 10MB/s당 1 vCPU, 압축 10배 가정. 하루 100GB는 약 1.157MB/s. 질의 CPU는 본문과 표가 서로 어긋남 | ClickStack estimating-resources | `Ⓥ` |
| 단가 차이 | 서울 EBS gp3 $0.0912 대 S3 Standard $0.025(약 3.65배). OpenSearch 관리형 gp3 $0.1391 대 UltraWarm·관리형 스토리지 $0.025~0.026 | AWS Price List | `✓` |
| 보관 기간별 쏠림 | 30일은 블록과 컴퓨트, 90일은 블록 대 오브젝트 단가 차, 180일은 S3 요청 요금과 콜드 지연이 중요해진다는 판단 | 위 항목의 종합 | `≈` |
| VictoriaLogs 오브젝트 스토리지 | 정식 릴리스에 없음. PR #1155 열림, 테스트 이미지 공개(2026-10-19), 머지 ETA 2026-11(메인테이너 2026-10-08). 최소 offload 1일, offload 파티션은 읽기 전용 | VictoriaLogs 이슈 #48, PR #1155 | `✓` |
| ClickHouse Cloud 단가 | Enterprise 컴퓨트 $0.3903/유닛-시간(8GiB·2vCPU), 스토리지 $25.30/TB-월(AWS us-east-1), GB당 수집 요금 없음 | ClickHouse 가격 페이지 | `Ⓥ` |
| AWS Optimized 엔진 | 2026-07-01 출시, OpenSearch 3.5 이상 새 도메인. 스토리지 최대 70%↓, price-performance 최대 4배, 추가 요금 없음. 측정 조건 미공개, 서울 미지원 | AWS What's New | `Ⓥ` |

{{% /details %}}

## 7. 운영팀이 맡을 범위는 UI와 복제 방식까지 포함한다

로그를 저장한 뒤에는 누가 볼 수 있는지, 트레이스와 어떻게 이어 보는지, 장애와 업그레이드를 어떻게 처리하는지가 남습니다. 이 절은 컴포넌트 수, 가용성, 오브젝트 스토리지, 접근 제어와 경보를 저장소별로 놓고 봅니다.

| 축 | OpenSearch | Loki | VictoriaLogs | ClickHouse와 HyperDX |
|---|---|---|---|---|
| 컴포넌트 | 데이터·마스터 노드, Dashboards, 집계기 | microservices 10개 안팎, bloom까지 쓰면 3개 추가 | 단일 바이너리 하나. 클러스터도 같은 바이너리 | ClickHouse, Keeper, HyperDX, Collector, MongoDB |
| 가용성 | 레플리카 샤드 | ingester 복제(기본 3)와 WAL | 클러스터 내 복제 없음. 독립 클러스터 둘과 이중 전송 | ReplicatedMergeTree와 Keeper |
| 오브젝트 스토리지 | remote-backed storage, searchable snapshot, 관리형은 UltraWarm | 필수(청크와 인덱스) | 미출시(PR 진행 중) | S3 디스크와 캐시 디스크로 계층화 |
| 멀티테넌시·접근 제어 | 문서·필드 수준 보안, Dashboards 테넌시 | `X-Scope-OrgID`. 라벨 기반 접근 제어는 유료 GEL | (AccountID, ProjectID). 인가는 vmauth 등에 위임 | HyperDX RBAC은 Managed 전용 |
| 경보 | Alerting 모니터 6종, 3.9 통합 경보 화면 | ruler의 LogQL 규칙 | vmalert(`type: vlogs`) | HyperDX 검색·차트 경보 |
| 관리형 | Amazon OpenSearch Service, Serverless, Ingestion | Grafana Cloud Logs | VictoriaMetrics Cloud | ClickHouse Cloud, Managed ClickStack |
| 라이선스 | Apache-2.0 | AGPL-3.0(Alloy는 Apache-2.0) | Apache-2.0(일부 Enterprise) | ClickHouse Apache-2.0, HyperDX MIT |

OpenSearch는 컴포넌트 수가 비교적 적고 문서·필드 수준 보안과 Dashboards 멀티테넌시를 제공합니다. Data Prepper가 OTel 로그와 트레이스를 받으며, 3.9에서는 통합 경보 화면이 GA입니다. 운영자는 초기에 샤드 수·크기, heap 상한, 노드당 샤드 한도를 정해야 합니다. 관리형 OR 계열은 refresh가 10초 이상이고 전환을 되돌릴 수 없습니다. 오래된 데이터를 UltraWarm이나 cold로 옮길 때도 제약이 있습니다. UltraWarm은 예약 할인 대상이 아니며 cold 데이터를 조회하려면 UltraWarm 노드에 붙여야 합니다.

Loki는 Grafana의 라벨 체계로 Tempo·Mimir와 연결됩니다. Grafana에 기본 번들된 Logs Drilldown은 패턴 탐지까지 제공하며 pattern ingester는 기본 꺼져 있습니다. microservices 구성은 운영할 부품이 많고, 문서는 아주 큰 클러스터에만 이 모드를 권합니다. 보관 처리는 compactor가 맡으며 `retention_enabled`는 기본 꺼져 있습니다.

Loki는 다음 버전에서 구조가 바뀔 수 있어 도입 시점을 따져 봐야 합니다. GrafanaCON 2026에서는 distributor가 Kafka에 쓰고 ingester가 파티션별로 소비하는 구성을 소개했습니다. 발표자는 분산 배포에 Kafka가 필요하다고 밝혔고, Grafana는 자체 대형 클러스터의 비용을 최대 30% 줄일 수 있다고 주장했습니다. 3.7.9 설정에도 관련 항목이 들어 있습니다. 출시일은 공식 발표되지 않았지만 지금 도입하면 큰 구성 전환을 맞을 가능성이 있어 보입니다. OSS Helm 차트는 2026-03-16부터 grafana-community로 옮겨졌고 grafana/loki 저장소의 차트는 GEL 전용입니다.

VictoriaLogs는 단일 바이너리로 운영할 수 있습니다. 클러스터 모드는 v1.18.0(2025-04-10)에 도입되어 조사 시점에 약 1년 6개월이 지났습니다. 메인테이너는 클러스터 내부 복제가 없는 것이 의도된 설계라고 밝혔습니다. 자동 리밸런싱도 없어 노드를 추가해도 과거 데이터는 옮겨지지 않습니다. 스트림·필드별 보관 정책과 다운샘플링도 없습니다.

수집 내구성과 업그레이드 동작도 살펴야 합니다. VictoriaLogs는 수집 요청을 파싱하고 수락하면 디스크 flush를 기다리지 않고 성공을 반환하며, 이를 바꾸자는 이슈가 열려 있습니다. 롤링 업그레이드 중 vlselect와 vlstorage의 내부 API 버전이 다르면 쿼리가 502를 낼 수 있습니다. v1.51.1에서는 구버전 vlselect 호환이 추가됐습니다. Enterprise의 v1.53.0 전용 플래그는 mTLS, TLS 자동 발급, 라이선스뿐이며 vlagent의 Kafka 수집과 테넌트별 통계·쿼터는 미출시 로드맵 항목입니다.

VictoriaLogs를 Grafana에서 보는 경로도 있습니다. 데이터소스 플러그인 v0.33.0(2026-10-15)은 LogsQL 없이 필드·스트림·메시지 패턴으로 나눠 보는 Drilldown을 추가했습니다. 이 플러그인은 0.x 버전이며 Drilldown은 Explore 코드 모드에서만 열리고 현재 쿼리를 이어받지 않습니다. 트레이스는 별도 VictoriaTraces가 맡는데 v0.12.0으로 아직 GA 전입니다.

ClickHouse와 HyperDX는 로그·트레이스·세션 리플레이·메트릭을 한 저장소와 UI에서 상관 분석합니다. 직접 운영할 때는 ClickHouse의 복제와 Keeper, 백업, 업그레이드에 MongoDB까지 맡아야 합니다. OSS에는 RBAC가 없고 SSO 지원은 문서에서 확인하지 못했으며, Slack API와 PagerDuty 알림은 Cloud 전용입니다.

ClickStack의 기본 보관 기간은 3일입니다. 더 오래 저장하려면 TTL(보관 기간 설정)을 직접 바꿔야 합니다. 스키마도 서버 버전에 따라 달라집니다. ClickHouse 26.2 이상은 text index 스키마를 만들고, 미만은 bloom_filter와 `tokenbf_v1`을 쓰는 호환 스키마를 만듭니다. seed SQL이 `CREATE TABLE IF NOT EXISTS`를 사용하므로 서버를 올려도 기존 테이블이 자동으로 text index 스키마로 바뀌지는 않을 것으로 보입니다.

차트와 operator의 변경도 이어지고 있습니다. ClickStack 차트 3.4.0은 operator의 기본 trace 로그로 디스크가 커지는 문제를 막으려고 로그 레벨을 낮췄습니다. Managed ClickStack을 쓰면 MongoDB가 필요 없고 백업·업그레이드는 서비스가 맡지만 Collector는 사용자가 운영합니다. 승급 기준과 실측 체크리스트는 [HyperDX 선택 가이드]({{< relref "/observability/hyperdx/operations/03-decision-guide/index.md" >}})에 있습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| OpenSearch 설계 제약 | 프라이머리 수 변경 어려움, heap은 RAM의 50%·최대 32GiB, 노드당 샤드 한도 | AWS 샤딩·Auto-Tune 문서 | `✓` |
| OR 계열 제약 | refresh 10초 이상, 되돌릴 수 없는 전환, 레플리카 수 초 지연, 높은 수집 지연 | AWS OR1 문서 | `✓` |
| 장기 보관 | UltraWarm은 예약 할인 대상이 아님. cold는 조회 시 UltraWarm에 붙여야 하고 warm 활성화가 전제 | AWS 가격표, cold storage 문서 | `✓` |
| OpenSearch 보안·경보 | 문서·필드 수준 보안, Dashboards 멀티테넌시. Alerting 모니터 6종, 3.9 Unified alerts view GA | OpenSearch·AWS 문서 | `✓` |
| Loki 컴포넌트 | distributor, ingester, query-frontend, query-scheduler, querier, index gateway, compactor, ruler 등. bloom은 planner·builder·gateway 3개, experimental | Loki components 문서 | `✓` |
| Loki 배포 모드 | monolithic 약 20GB/day, SSD는 deprecated·4.0에서 제거, microservices는 very large에서만 권장 | Loki 배포 모드 문서 | `✓` |
| Loki 다음 버전 구조 | distributor가 Kafka에 쓰고 파티션마다 ingester 하나가 소비. 분산 배포는 Kafka 필요라고 발표자가 언급. 대형 클러스터 비용 최대 30% 감소 주장(Grafana 자체 클러스터). 3.7.9 config에 `kafka_config`·`dataobj` 이미 존재 | GrafanaCON 2026 세션, InfoQ, Loki config 3.7.9 | `Ⓥ` |
| Loki 다음 버전 일정 | 출시일 공식 발표 없음. 3.7.0 이후 7개월째 3.7 패치만 나옴 | Loki 릴리스 | `✓` |
| 다음 버전 전환 부담 | 지금 도입 시 구조 전환을 맞을 가능성이 있다는 판단 | 위 항목의 종합 | `Σ` |
| Loki Helm 차트 | OSS 차트는 2026-03-16부터 grafana-community로 이관, grafana/loki 저장소 차트는 GEL 전용 | Loki 이슈 #20705 | `✓` |
| Loki 보관 | `retention_enabled` 기본 false. 보관은 compactor가 수행 | Loki retention 문서 | `✓` |
| Loki 멀티테넌시 | `X-Scope-OrgID`로 테넌트 분리. LBAC·크로스 테넌트 쿼리·토큰 관리는 GEL | Loki architecture, GEL 문서 | `✓` |
| VictoriaLogs 클러스터 도입 | v1.18.0(2025-04-10)에 도입, 2026-10 기준 약 1년 6개월 | VictoriaLogs CHANGELOG | `✓` |
| VictoriaLogs 복제 | 클러스터 내 복제 없음이 의도된 설계(이슈 #1281에서 메인테이너 답변). 이유로 쿼리 시점 dedup 필요와 pushdown 차단을 듦 | VictoriaLogs cluster 문서, 이슈 #1281 | `✓` |
| VictoriaLogs 빠진 기능 | 자동 리밸런싱, 스트림·필드별 retention filter, 다운샘플링이 v1.53 문서에 없음 | VictoriaLogs cluster·README·로드맵 | `✓` |
| 수집 내구성 | 수집 요청이 파싱·수락 시점에 성공을 반환, flush 대기 안 함. 이슈 #1389 열림 | VictoriaLogs 이슈 #1389 | `✓` |
| 롤링 업그레이드 | 내부 API 버전이 다르면 vlselect 쿼리 502. v1.51.1에서 구버전 vlselect 호환 추가 | VictoriaLogs CHANGELOG | `✓` |
| VictoriaLogs Enterprise | v1.53.0 전용 플래그는 mTLS, `-tlsAutocert*`, 라이선스. Kafka 수집(#885)·테넌트별 통계(#65)·쿼터(#9)는 Enterprise 예정이고 미출시 | VictoriaLogs README, 로드맵 | `✓` |
| VictoriaLogs 멀티테넌시·경보 | (AccountID, ProjectID), 테넌트별 인가는 하지 않음. vmalert `type: vlogs` | VictoriaLogs 문서 | `✓` |
| ClickHouse 백업·복제 | ReplicatedMergeTree와 Keeper(Raft). 네이티브 BACKUP·RESTORE, 증분 백업은 base 체인 필요 | ClickHouse 백업 문서 | `✓` |
| ClickHouse 계층화 | local과 S3 디스크를 hot·cold volume으로 묶고 TTL MOVE, 앞단에 cache 디스크. zero-copy 복제는 22.8부터 기본 비활성이고 운영 사용을 권하지 않음 | ClickHouse storing-data 문서 | `✓` |
| 스키마의 버전 분기 | 26.2 이상은 text index 스키마, 미만은 호환 스키마. seed가 `CREATE TABLE IF NOT EXISTS`라는 점에서 자동 전환이 안 된다고 추정 | HyperDX seed SQL | `≈` |
| ClickStack 기본 TTL | 기본 보관 3일. 스키마 원문은 `${LOGS_TTL}` 변수로 주입하며 `ALTER TABLE ... MODIFY TTL`이나 exporter `ttl`로 변경 | ClickStack TTL 문서, HyperDX seed SQL | `✓` |
| ClickStack 차트 변경 | 3.4.0은 operator 로그 레벨을 information으로 낮추고 시스템 테이블 5개에 7일 TTL 설정 | ClickStack Helm 차트 릴리스 | `✓` |
| HyperDX 제약 | RBAC은 Managed 전용(OSS 이슈 #1293은 2025-11-04 not planned로 종료). Slack API·PagerDuty는 Cloud 전용. OSS는 MongoDB 필요. OSS SSO 지원은 문서에서 찾지 못함 | ClickStack RBAC·alerts·architecture 문서 | `✓` |
| Managed ClickStack | MongoDB 불필요, ClickHouse Cloud가 호스팅. Collector는 사용자가 운영 | ClickStack managed 문서 | `✓` |
| VictoriaMetrics Cloud | 고정 티어(컴퓨트·디스크 크기)에 egress 과금. VictoriaLogs 최소 티어 월 약 $190 | VictoriaMetrics Cloud 과금 문서 | `Ⓥ` |
| 라이선스 | OpenSearch·ClickHouse·VictoriaLogs·Alloy Apache-2.0, Loki·Grafana AGPL-3.0, HyperDX MIT | GitHub 라이선스 메타데이터 | `✓` |
| 상관 분석 | HyperDX는 로그·트레이스·세션·메트릭을 한 UI에서 상관. Logs Drilldown은 Grafana에 기본 번들, pattern ingester는 기본 off. VictoriaTraces v0.12.0은 GA 전. VictoriaLogs Grafana 플러그인 v0.33.0에 Drilldown 추가(코드 모드 한정, 쿼리 미승계). Data Prepper가 OTel 로그·트레이스 수신, 3.9의 경보 통합 화면 GA | ClickStack·Grafana·VictoriaTraces·VictoriaLogs 데이터소스·OpenSearch 문서 | `✓` |

{{% /details %}}

## 8. 확인하지 못한 것

- 네 저장소를 같은 하드웨어와 같은 로그로 견준 2025~2026년 독립 벤치마크. ClickHouse와 OpenSearch(Elasticsearch가 아닌)를 직접 견준 독립 벤치마크도 찾지 못했다.
- Istio 1.31의 실제 JSON 액세스 로그에서 duration과 bytes가 숫자로 나오는지, 미설정 값이 `"-"`인지 null인지. 액세스 로그 한 줄의 실측 바이트 수와 요청당 사이드카 로그 줄 수도 재지 못했다.
- Loki 4.0의 출시일과 범위, Kafka 구조가 오픈소스에서 GA가 되는 버전, 그 구조에서 ingester 장애 때 최근 데이터를 조회할 수 있는지. Loki 공식 압축비와 Logs Drilldown의 GA 여부.
- VictoriaLogs 오브젝트 스토리지 구현의 실제 머지일과 쿼리 성능, 수 TB/일 규모의 독립 벤치나 공개 운영 사례, OTLP/gRPC 수신 지원 여부.
- OpenSearch 코어의 네이티브 OTLP 수신 여부. AWS Optimized 엔진의 지원 인스턴스 타입, Query DSL과 UltraWarm, ISM 호환, 오픈소스 반영 여부.
- TextBench에서 Elasticsearch LogsDB 모드를 썼는지. Managed ClickStack GA의 정식 공지. 26.2 미만에서 만든 테이블을 text index 스키마로 옮기는 공식 절차.
- Grafana 플러그인 세 개의 서명 등급, Grafana Cloud Logs 요금 항목의 단위 정의, AWS 인터넷 egress 단가.

## 참고 자료

- [OpenSearch 릴리스](https://github.com/opensearch-project/OpenSearch/releases)
- [Loki 릴리스](https://github.com/grafana/loki/releases)
- [VictoriaLogs 릴리스](https://github.com/VictoriaMetrics/VictoriaLogs/releases)
- [VictoriaLogs CHANGELOG](https://docs.victoriametrics.com/victorialogs/changelog/)
- [ClickHouse 릴리스](https://github.com/ClickHouse/ClickHouse/releases)
- [ClickHouse changelog](https://clickhouse.com/docs/whats-new/changelog)
- [HyperDX 저장소와 릴리스, 스키마 seed](https://github.com/hyperdxio/hyperdx)
- [Fluent Bit 릴리스](https://github.com/fluent/fluent-bit/releases)
- [Vector 릴리스](https://github.com/vectordotdev/vector/releases)
- [OTel Collector contrib v0.163.0](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/v0.163.0)
- [OTel clickhouseexporter README](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/exporter/clickhouseexporter)
- [OTel opensearchexporter README](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/exporter/opensearchexporter)
- [Grafana Alloy v1.21.0 컴포넌트 문서](https://github.com/grafana/alloy/tree/v1.21.0/docs/sources/reference/components)
- [Istio 지원 릴리스](https://istio.io/latest/docs/releases/supported-releases/)
- [Istio Envoy 액세스 로그](https://istio.io/latest/docs/tasks/observability/logs/access-log/)
- [Istio OpenTelemetry 액세스 로그 프로바이더](https://istio.io/latest/docs/tasks/observability/logs/otel-provider/)
- [Istio Telemetry API 레퍼런스](https://istio.io/latest/docs/reference/config/telemetry/)
- [Istio MeshConfig 레퍼런스](https://istio.io/latest/docs/reference/config/istio.mesh.v1alpha1/)
- [Istio ztunnel 문제 해결](https://istio.io/latest/docs/ambient/usage/troubleshoot-ztunnel/)
- [Istio waypoint 문제 해결](https://istio.io/latest/docs/ambient/usage/troubleshoot-waypoint/)
- [Envoy 액세스 로그 사용법](https://www.envoyproxy.io/docs/envoy/latest/configuration/observability/access_log/usage)
- [Istio telemetry_logging.go](https://github.com/istio/istio/blob/master/pilot/pkg/model/telemetry_logging.go)
- [Envoy SubstitutionFormatString proto](https://github.com/envoyproxy/envoy/blob/main/api/envoy/config/core/v3/substitution_format_string.proto)
- [Amazon OpenSearch Service 소개](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/what-is.html)
- [Amazon OpenSearch Service 문서 이력](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/release-notes.html)
- [AWS What's New: OpenSearch Service optimized for log analytics (2026-07-01)](https://aws.amazon.com/about-aws/whats-new/2026/07/amazon-opensearch-service-optimized-log-analytics)
- [OpenSearch optimized 인스턴스(OR1·OR2)](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/or1.html)
- [Cold storage](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/cold-storage.html)
- [스토리지 요구량 계산](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/bp-storage.html)
- [샤드 수 선택](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/bp-sharding.html)
- [Auto-Tune](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/auto-tune.html)
- [AWS Price List API, OpenSearch 서울](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonES/current/ap-northeast-2/index.json)
- [AWS Price List API 인덱스(S3·EC2·EBS)](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json)
- [OpenSearch 매핑](https://docs.opensearch.org/latest/mappings/)
- [OpenSearch mapping explosion](https://docs.opensearch.org/latest/mappings/mapping-explosion/)
- [OpenSearch append-only 인덱스](https://docs.opensearch.org/latest/im-plugin/append-only-index/)
- [OpenSearch star-tree 필드 타입](https://docs.opensearch.org/latest/mappings/supported-field-types/star-tree/)
- [OpenSearch ISM 작업](https://docs.opensearch.org/latest/im-plugin/ism/policies-operations/)
- [OpenSearch Data Prepper otel_logs_source](https://docs.opensearch.org/latest/data-prepper/pipelines/configuration/sources/otel-logs-source/)
- [OpenSearch Alerting 모니터](https://docs.opensearch.org/latest/observing-your-data/alerting/monitors/)
- [OpenSearch 블로그: 3.3 성능](https://opensearch.org/blog/opensearch-3-3-performance-innovations-for-ai-search-solutions/)
- [OpenSearch 3.9.0 릴리스 노트](https://github.com/opensearch-project/opensearch-build/blob/main/release-notes/opensearch-release-notes-3.9.0.md)
- [OpenSearch _source와 derived source](https://docs.opensearch.org/latest/mappings/metadata-fields/source/)
- [OpenSearch 블로그: derived source](https://opensearch.org/blog/save-up-to-2x-on-storage-with-derived-source/)
- [OpenSearch index codecs](https://docs.opensearch.org/latest/im-plugin/index-codecs/)
- [Fluent Bit OpenSearch 출력](https://docs.fluentbit.io/manual/data-pipeline/outputs/opensearch)
- [Fluent Bit 문서 색인](https://docs.fluentbit.io/manual/llms.txt)
- [Vector Elasticsearch sink](https://vector.dev/docs/reference/configuration/sinks/elasticsearch/)
- [Vector ClickHouse sink](https://vector.dev/docs/reference/configuration/sinks/clickhouse/)
- [Vector 아키텍처 가이드](https://vector.dev/docs/setup/going-to-prod/architecting/)
- [OTel Collector gateway 배포](https://opentelemetry.io/docs/collector/deploy/gateway/)
- [OTel 사양 상태](https://opentelemetry.io/docs/specs/status/)
- [CNCF, OpenTelemetry 졸업 발표](https://www.cncf.io/announcements/2026/05/21/cloud-native-computing-foundation-announces-opentelemetrys-graduation/)
- [Loki 배포 모드](https://grafana.com/docs/loki/latest/get-started/deployment-modes/)
- [Loki 아키텍처](https://grafana.com/docs/loki/latest/get-started/architecture/)
- [Loki 컴포넌트](https://grafana.com/docs/loki/latest/get-started/components/)
- [Loki 카디널리티](https://grafana.com/docs/loki/latest/get-started/labels/cardinality/)
- [Loki 쿼리 모범 사례](https://grafana.com/docs/loki/latest/query/bp-query/)
- [Grafana Logs Drilldown 접근](https://grafana.com/docs/grafana/latest/explore/simplified-exploration/logs/access/)
- [Loki 라벨 모범 사례](https://grafana.com/docs/loki/latest/get-started/labels/bp-labels/)
- [Loki structured metadata](https://grafana.com/docs/loki/latest/get-started/labels/structured-metadata/)
- [Loki bloom filter](https://grafana.com/docs/loki/latest/operations/bloom-filters/)
- [Loki 쿼리 가속](https://grafana.com/docs/loki/latest/query/query_acceleration/)
- [Loki 보관](https://grafana.com/docs/loki/latest/operations/storage/retention/)
- [Loki 클러스터 사이징](https://grafana.com/docs/loki/latest/setup/size/)
- [Loki 설정 레퍼런스 v3.7.9](https://github.com/grafana/loki/blob/v3.7.9/docs/sources/shared/configuration.md)
- [Loki OpenTelemetry 수집](https://grafana.com/docs/loki/latest/send-data/otel/)
- [Loki v3.7 릴리스 노트](https://grafana.com/docs/loki/latest/release-notes/v3-7/)
- [Loki promtail](https://grafana.com/docs/loki/latest/send-data/promtail/)
- [Loki Helm 차트 이관 공지 #20705](https://github.com/grafana/loki/issues/20705)
- [Grafana Enterprise Logs](https://grafana.com/docs/enterprise-logs/latest/)
- [GrafanaCON 2026: Loki 페타바이트 아키텍처 세션](https://grafana.com/events/grafanacon/agenda/loki-petabyte-scale-logging-architecture/)
- [Grafana Labs, Logline 인수](https://grafana.com/blog/grafana-labs-acquires-logline/)
- [InfoQ, Grafana의 Loki Kafka 재설계](https://infoq.com/news/2026/04/grafana-loki-ai-agents)
- [VictoriaLogs 문서 개요](https://docs.victoriametrics.com/victorialogs/)
- [VictoriaLogs cluster](https://docs.victoriametrics.com/victorialogs/cluster/)
- [VictoriaLogs key concepts](https://docs.victoriametrics.com/victorialogs/keyconcepts/)
- [VictoriaLogs FAQ](https://docs.victoriametrics.com/victorialogs/faq/)
- [VictoriaLogs 로드맵](https://docs.victoriametrics.com/victorialogs/roadmap/)
- [VictoriaLogs 수집 문서](https://docs.victoriametrics.com/victorialogs/data-ingestion/)
- [VictoriaLogs Vector 설정](https://docs.victoriametrics.com/victorialogs/data-ingestion/vector/)
- [VictoriaLogs LogsQL](https://docs.victoriametrics.com/victorialogs/logsql/)
- [VictoriaLogs vlagent](https://docs.victoriametrics.com/victorialogs/vlagent/)
- [VictoriaLogs vmalert](https://docs.victoriametrics.com/victorialogs/vmalert/)
- [VictoriaLogs 이슈 #48, 오브젝트 스토리지](https://github.com/VictoriaMetrics/VictoriaLogs/issues/48)
- [VictoriaLogs PR #1155](https://github.com/VictoriaMetrics/VictoriaLogs/pull/1155)
- [VictoriaLogs 이슈 #1281](https://github.com/VictoriaMetrics/VictoriaLogs/issues/1281)
- [VictoriaLogs 이슈 #1389](https://github.com/VictoriaMetrics/VictoriaLogs/issues/1389)
- [VictoriaLogs Grafana 데이터소스](https://github.com/VictoriaMetrics/victorialogs-datasource)
- [VictoriaTraces 로드맵](https://docs.victoriametrics.com/victoriatraces/roadmap/)
- [VictoriaMetrics Cloud 과금](https://docs.victoriametrics.com/victoriametrics-cloud/billing/)
- [VictoriaMetrics 개발 노트: VictoriaLogs로 분산 트레이싱](https://victoriametrics.com/blog/dev-note-distributed-tracing-with-victorialogs/)
- [VictoriaMetrics 수집기 벤치마크(2026-03-20)](https://victoriametrics.com/blog/log-collectors-benchmark-2026/)
- [ClickHouse text index 문서](https://clickhouse.com/docs/engines/table-engines/mergetree-family/textindexes)
- [ClickHouse 26.2 릴리스 블로그](https://clickhouse.com/blog/clickhouse-release-26-02)
- [ClickHouse 풀텍스트 검색 GA 공지](https://clickhouse.com/blog/full-text-search-ga-release)
- [ClickHouse skipping index](https://clickhouse.com/docs/optimize/skipping-indexes)
- [ClickHouse JSON 타입](https://clickhouse.com/docs/sql-reference/data-types/newjson)
- [ClickHouse 백업 개요](https://clickhouse.com/docs/operations/backup/overview)
- [ClickHouse 외부 디스크 저장](https://clickhouse.com/docs/operations/storing-data)
- [ClickHouse 블로그: TextBench(Elasticsearch와 로그 분석 비교)](https://clickhouse.com/blog/elasticsearch-log-analytics-clickhouse)
- [JSONBench VictoriaLogs 결과](https://github.com/ClickHouse/JSONBench/tree/main/victorialogs/results)
- [ClickHouse 가격](https://clickhouse.com/pricing)
- [ClickStack 아키텍처](https://clickhouse.com/docs/use-cases/observability/clickstack/architecture)
- [ClickStack 검색](https://clickhouse.com/docs/use-cases/observability/clickstack/search)
- [ClickStack 프로덕션 가이드](https://clickhouse.com/docs/use-cases/observability/clickstack/production)
- [ClickStack TTL](https://clickhouse.com/docs/use-cases/observability/clickstack/ttl)
- [Grafana ClickHouse 데이터소스 릴리스](https://github.com/grafana/clickhouse-datasource/releases)
- [ClickStack Managed 배포](https://clickhouse.com/docs/clickstack/deployment/managed)
- [ClickStack 알림](https://clickhouse.com/docs/use-cases/observability/clickstack/alerts)
- [ClickStack RBAC](https://clickhouse.com/docs/clickstack/managing/rbac)
- [ClickStack Map와 JSON 스키마](https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/schema/map-vs-json)
- [ClickStack 자원 산정](https://clickhouse.com/docs/use-cases/observability/clickstack/estimating-resources)
- [ClickStack Helm 차트 릴리스](https://github.com/ClickHouse/ClickStack-helm-charts/releases)
- [HyperDX 이슈 #1293, RBAC](https://github.com/hyperdxio/hyperdx/issues/1293)
- [VeloDB, 에이전트 워크로드의 동적 JSON 벤치마크](https://www.velodb.io/blog/dynamic-json-in-agent-workloads-apache-doris-clickhouse-elasticsearch-and-opensearch)
- [harshit.cloud, VictoriaLogs vs Loki](https://harshit.cloud/blog/victorialogs-vs-loki)
- [Platform Monkey, Loki vs. Elasticsearch in 2026](https://platform-monkey.com/guides/loki-vs-elasticsearch)
