---
title: "Cortex vs VictoriaMetrics 비교와 선택"
linkTitle: "Cortex vs VictoriaMetrics"
description: "2026-11-01 기준 Cortex, Mimir, VictoriaMetrics의 저장 방식과 장단점, 공개 지표를 비교한다. 보존 설정과 운영 조건에 따라 선택 기준을 좁힌다."
date: 2026-11-01
lastmod: 2026-11-01
weight: 8
url: "/monitoring/cortex-mimir-vs-victoriametrics/"
---

# Cortex vs VictoriaMetrics 비교와 선택

## 1. 한눈 비교와 선택 조건

Prometheus의 remote_write를 받는 Cortex·Grafana Mimir와, vmagent 또는 Prometheus가 전송하는 VictoriaMetrics cluster를 비교합니다. 단일 서버 단계의 선택은 [Prometheus와 VictoriaMetrics의 확장 방식과 운영 비용 비교]({{< relref "/observability/metrics/prometheus-vs-victoriametrics/index.md" >}})에, 여러 클러스터를 연결하는 구성은 [여러 클러스터의 메트릭을 모으는 Thanos와 VictoriaMetrics 구성]({{< relref "/observability/metrics/prometheus-vs-victoriametrics-multi-cluster/index.md" >}})에 있습니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다.

### 한눈 비교표

| 비교 축 | Cortex | Mimir | VictoriaMetrics |
|---|---|---|---|
| 장기 저장 위치 | 오브젝트 스토리지 | 오브젝트 스토리지 | vmstorage 로컬 디스크 |
| 복제와 저장 용량 | compactor 중복 제거<br>장기 용량 대략 1배 | compactor 중복 제거<br>장기 용량 대략 1배 | 복제 계수 N에 따라 N배<br>조회 시 dedup |
| 외부 의존성 | 오브젝트 스토리지<br>캐시(memcached·redis·in-memory) | 오브젝트 스토리지·memcached 캐시<br>ingest storage는 Kafka 추가 | 없음 |
| 쿼리 언어·엔진 | PromQL·Prometheus 엔진 | PromQL·MQE | MetricsQL |
| 멀티테넌시 | 테넌트별 런타임 overrides | 테넌트별 런타임 overrides | 테넌트 식별 지원<br>OSS 테넌트별 수집·시리즈 limit 없음 |
| 다운샘플링 | 없음 | 없음 | Enterprise만 |
| 라이선스 | Apache-2.0 | AGPL-3.0 | OSS Apache-2.0<br>Enterprise 상용 |
| 현재 버전 | v1.21.1 | 3.2.4 | v1.155.0<br>LTS v1.148.x·v1.136.x(Enterprise) |

### 장점·단점 표

| 제품 | 장점 | 단점 | 맞는 조건 |
|---|---|---|---|
| Cortex | Apache-2.0<br>CNCF 거버넌스<br>테넌트별 limit | 다운샘플링 미제공<br>다른 두 제품보다 적은 최근 52주 커밋·작성자 수 | Apache-2.0·재단 거버넌스 필요<br>테넌트별 한도 필요 |
| Mimir | 오브젝트 스토리지 장기 보존<br>테넌트별 limit·shuffle sharding | ingest storage의 Kafka 운영<br>classic → ingest storage 이전 시 병행 클러스터 | 테넌트 격리 우선<br>AGPL-3.0 수용<br>ingest storage 선택 시 Kafka 운영 가능 |
| VictoriaMetrics | 외부 의존성 없는 구성<br>수신·저장·조회 역할 분리 | 복제 계수만큼 디스크 증가<br>MetricsQL 계산 차이<br>다운샘플링·LTS의 Enterprise 제한 | 로컬 디스크 중심 운영<br>기존 쿼리 결과 검증 가능 |

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| Cortex 버전 | v1.21.1(2026-06-05). v1.22.0은 rc.3(2026-10-06)까지만 나옴 | Cortex 릴리스 | `✓` |
| Mimir 버전 | 3.2.4(2026-10-30). 3.1.x도 병행 패치(3.1.9). 3.0.0은 2025-10-31 | Mimir 릴리스 | `✓` |
| VictoriaMetrics 버전 | v1.155.0(2026-10-26). LTS는 v1.148.x와 v1.136.x | VictoriaMetrics 릴리스, LTS 문서 | `✓` |
| Cortex 중복 제거 | compactor가 복제로 여러 블록에 쓰인 샘플을 중복 제거 | Cortex compactor 문서 | `✓` |
| Mimir 중복 제거 규모 | 10억 active series 테스트에서 30억 시리즈가 들어와 compaction 중 10억으로 중복 제거 | Grafana Labs 블로그(2022-04-08) | `Ⓥ` |
| ingest storage 중복 제거 | compactor가 여러 ingester 블록을 합쳐 중복 제거 | Mimir ingest storage 문서 | `✓` |
| VM 용량 산정 | 공식에 Replication Factor가 곱해짐 | VictoriaMetrics 용량 산정 가이드 | `✓` |
| Cortex 링 KV·캐시 | Consul, etcd, memberlist. 캐시는 memcached·redis·in-memory, 다단 가능 | Cortex 아키텍처·querier 문서 | `✓` |
| VM 외부 의존성 | 없음. 오브젝트 스토리지는 vmbackup 대상 | VictoriaMetrics cluster 문서 | `✓` |
| Cortex·Mimir limit | 런타임 overrides. Cortex 1.21 Overrides API. Mimir 3.1은 헤더 메타데이터 기반 부분 limit | Cortex v1.21.0 릴리스, Mimir 3.1 릴리스 | `✓` |
| VM tenant limit | OSS에는 tenant별 수집·시리즈 limit 없음. 노드 단위 합산 limit만. tenant별 속도 제한은 vmgateway(Enterprise) | VictoriaMetrics cluster·Enterprise 문서 | `✓` |
| shuffle sharding | Cortex·Mimir 모두 기본 꺼짐. Mimir는 쓰기 경로에서 켜면 읽기 경로도 자동 적용 | Cortex·Mimir shuffle sharding 문서 | `✓` |
| Cortex 엔진 | 기본 Prometheus PromQL 엔진. Thanos 엔진은 experimental(`-querier.thanos-engine`). 1.21에서 논리 플랜 분할·projection pushdown 추가 | Cortex v1guarantees·querier 문서, v1.21.0 릴리스 | `✓` |
| Mimir MQE | 3.0부터 querier·query-frontend 기본. `-querier.query-engine=prometheus`로 복귀. 관련 flag는 도움말에서 experimental 표시 | Mimir 3.0 릴리스 노트, help-all, versioning 문서 | `✓` |
| MetricsQL 차이 | rate·increase 외삽 없음, 직전 샘플 포함, 창 생략 시 step과 스크레이프 간격 중 큰 값, NaN 제거, scalar 처리, `offset`·WITH 확장 | VictoriaMetrics MetricsQL 문서 | `✓` |
| Cortex 다운샘플링 | 로드맵 항목뿐. thanosconvert가 Thanos 다운샘플 블록을 건너뜀 | Cortex roadmap, 마이그레이션 문서 | `✓` |
| Mimir 다운샘플링 | 웨비나 Q&A에서 미제공이라 답변. 2022년 잔여 코드 제거 PR #3024, 2023년 제안 PR #5028은 open | Grafana 커뮤니티 Q&A, Mimir PR | `Ⓥ` |
| VM 다운샘플링 | `-downsampling.period`, 다단계, tenant별. 마지막 샘플 유지라 gauge·summary 일부 손실. 다중 보존기간(`-retentionFilter`)도 Enterprise | VictoriaMetrics Enterprise 문서 | `✓` |
| LTS 범위 | 문서 원문은 "LTS releases are published only for Enterprise versions" | VictoriaMetrics LTS 문서 | `✓` |
| 라이선스 | Cortex Apache-2.0, Mimir AGPL-3.0, VM OSS Apache-2.0(Enterprise는 상용) | 각 프로젝트 저장소 | `✓` |
| Cortex 거버넌스 | CNCF Incubating(2018-09-20 Sandbox, 2020-08-20 Incubating) | CNCF 프로젝트 페이지 | `✓` |
| classic 이전 경로 | 새 클러스터를 병행 구성하고 이중 쓰기 뒤 읽기 이전 | Grafana Mimir 3.0 블로그 | `Ⓥ` |

{{% /details %}}

## 2. 아키텍처와 배포 기본값

Grafana 문서는 Mimir ingest storage를 안정적이며 권장하는 방식으로 설명합니다. 바이너리의 `-ingest-storage.enabled`는 기본 꺼짐이고, Helm 차트 `mimir-distributed` 6.0은 ingest storage가 기본입니다. 차트에 포함된 Kafka는 데모용 단일 노드이며, 문서는 운영에 외부 Kafka 호환 클러스터를 쓰라고 안내합니다.

### Cortex

{{< flow src="_flow/1-cortex.json" />}}

### Mimir ingest storage

{{< flow src="_flow/1-mimir.json" />}}

### VictoriaMetrics cluster

{{< flow src="_flow/1-victoriametrics.json" />}}

VictoriaMetrics 문서는 초당 100만 데이터 포인트 미만이면 single-node를 권합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| Cortex 쓰기·읽기 경로 | distributor, ingester(메모리+WAL, 2시간 블록 업로드), query-frontend(선택), querier, store-gateway, compactor | Cortex 아키텍처 문서 | `✓` |
| Mimir 두 아키텍처 | 3.0부터 ingest storage와 classic 지원. 문서에 "stable and the preferred way" | Mimir 아키텍처 문서 | `✓` |
| Mimir 기본값 | 바이너리 `-ingest-storage.enabled`는 기본 꺼짐. Helm 차트 6.0은 기본 ingest storage이고 데모용 단일 노드 Kafka를 함께 띄움 | Mimir 3.2.4 flag 도움말, Helm 6.0 릴리스 노트 | `✓` |
| ingest storage 쓰기 | Kafka가 복제·영속화를 확인하면 응답. 기본은 시리즈 하나가 파티션 하나. ingester는 파티션 하나 소비 | Mimir ingest storage 문서 | `✓` |
| VM 컴포넌트 | vminsert(consistent hashing), vmstorage(stateful), vmselect. `-storageNode` 목록 직접 지정, 자동 발견은 Enterprise | VictoriaMetrics cluster 문서 | `✓` |
| single-node 권고 | 초당 100만 데이터 포인트 미만이면 single-node 권장 | VictoriaMetrics cluster 문서 | `✓` |

{{% /details %}}

## 3. 공개 벤치마크·지표

| 지표 | Cortex | Mimir | VictoriaMetrics | 측정자·조건 |
|---|---|---|---|---|
| CPU (2019) | 1.08코어 | — | cluster 1.14코어<br>single 0.49코어 | adidas, PromCon EU 2019<br>DynamoDB 청크 저장 시절 Cortex<br>약 430K·900K 시리즈, 약 88K samples/s |
| 메모리 (2019) | 24.15GiB | — | cluster 13.4GiB<br>single 11.94GiB | 위 측정 |
| 샘플당 바이트 (2019) | 3.68B<br>DynamoDB 1133 WCU 별도 | — | 1.20B | 위 측정 |
| 할당 CPU·RAM | — | 43.2 CPU·283GiB | 44 CPU·208GiB | VictoriaMetrics 측, 2022-09-09<br>Mimir 2.2.0(RF 3)·VM 1.80.0(RF 2), GKE e2-standard-16<br>약 550만 active series·36만 samples/s·24시간 |
| 평균 CPU 사용량 | — | — | Mimir보다 약 1.7배 적음 | 위 시험 |
| 평균 RAM 사용량 | — | — | Mimir보다 약 5배 적음 | 위 시험 |
| 저장 용량 | — | 로컬 369GiB + 오브젝트 스토리지 149.7GiB | 49GiB | 위 시험 |
| instant 쿼리 p99 | — | 약 47초 | 약 20초 | 위 시험; range 쿼리 미측정 |
| 대규모 시험 | — | 10억 active series<br>약 1500 레플리카·7000 CPU 코어·30TiB RAM | — | Grafana Labs, 시험 2021·발표 2022<br>단일 tenant |
| Mimir 3.0 발표 수치 | — | 리소스 최대 15% 감소<br>MQE 쿼리 최대 메모리 최대 92% 감소 | — | Grafana Labs 자체 주장<br>리소스는 대형 내부 클러스터 기준 |
| 샘플당 바이트 | 약 0.7~3.5바이트<br>구버전 예시 환산 | 2바이트<br>산정 가정 | 압축 후 평균 1바이트 안팎<br>공식 안내값 | Cortex chunks 시절 자료<br>Mimir compacted block·실측 아님<br>VM은 churn 증가 시 압축 악화 |
| 최근 52주 커밋 | 462 | 2,648 | 1,546 | `gh api` 집계, 2026-11-01 |
| 최근 52주 고유 작성자 | 44 | 137 | 104 | 같은 집계, 봇 제외 |

위 표의 CPU·RAM·디스크·쿼리 수치는 2022년 9월 시점의 Mimir 2.2.0과 VictoriaMetrics 1.80.0을 VictoriaMetrics가 직접 잰 값입니다. 복제 계수도 3과 2로 달랐고, Cortex는 시험 대상이 아니었습니다. Cortex와 VictoriaMetrics를 직접 잰 공개 수치는 2019년 PromCon에서 adidas가 발표한 측정 하나입니다. 이때의 Cortex는 청크를 DynamoDB에 쓰던 구조라 지금의 blocks storage와 다르고, CPU는 비슷했으며 차이는 메모리와 샘플당 바이트에서 났습니다. VictoriaMetrics README의 "Cortex보다 RAM 최대 7배 적다"는 문구는 Prometheus와 VictoriaMetrics를 비교한 벤치마크 글을 링크하고 있어 Cortex 측정치로 볼 수 없습니다. 2022년 이후 둘 이상을 같은 조건에서 다시 잰 공개 벤치마크는 찾지 못했으므로, 지금도 이 시험이 유일한 직접 비교입니다. 샘플당 바이트는 구버전 환산값·산정 가정·공식 안내값이라 실측 순위로 읽을 수 없습니다.

### 2022년 이후 제품별 개선

그 뒤 각 프로젝트가 밝힌 개선은 아래와 같습니다. 대부분 벤더가 자기 제품을 잰 값이고 "최대"가 붙은 수치가 많아서, 2022년 격차가 얼마나 줄었는지 이 표로 계산할 수는 없습니다.

| 제품 | 버전·시점 | 개선 | 공개 수치 | 조건 |
|---|---|---|---|---|
| Mimir | 2.7 (2023) | store-gateway 스트리밍 기본값 | OOM 약 90% 감소 | Grafana 운영 환경 비교 |
| Mimir | 2.9 (2023) | 넓은 매처 쿼리의 인덱스 조회 생략 | store-gateway 메모리 request 평균 30% 감소<br>일부 클러스터 최대 64% | Grafana 클러스터 적용 결과 |
| Mimir | 2.10 (2023-09) | 라벨 자료구조 변경 | ingester 메모리 약 15% 감소 | 라벨 패턴·테넌트 수에 따라 다름 |
| Mimir | 2.13 (2024-07) | OTLP 네이티브 변환 | distributor 메모리 최대 30%·CPU 최대 8% 감소 | OTLP 수집 경로 |
| Mimir | 2.17~3.0 (2025) | MQE 기본 엔진 | 최대 메모리 92% 감소·39% 빠름 | Prometheus 엔진 대비, 쿼리 1종·입력 10만 시리즈 |
| Mimir | 3.0 (2025-11) | ingest storage(Kafka) | Grafana Cloud TCO 25% 감소 | 메인테이너 팟캐스트 발언, CPU·RAM 단독 수치 아님 |
| VictoriaMetrics | v1.82.0 (2022-10) | MetricsQL regex 필터 | 쿼리 최대 4배 빠름 | 단순하지 않은 regex 필터 쿼리 |
| VictoriaMetrics | v1.92.0 (2023-07) | TSID 인덱스를 일별로 전환 | 메모리 최대 5배 감소 | churn이 높고 보존 기간이 긴 환경 |
| VictoriaMetrics | v1.133.0 (2026-01) | 파티션별 indexDB | 수치 없음, indexDB 디스크 감소 | 기존 인덱스가 보존 밖으로 나간 뒤 효과 |
| Cortex | 1.15 (2023-04) | Thanos PromQL 엔진 | 수치 없음 | 실험 기능 |
| Cortex | 1.20~1.21 (2025-11~2026-06) | Parquet 저장·조회 | 수치 없음 | 실험 기능 |

Mimir는 2022년 시험에서 문제가 됐던 영역을 직접 다룬 수치를 가장 많이 냈습니다. 2022년 시험의 Mimir는 RF 3이었는데, Grafana는 3.0의 ingest storage가 RF 3·쿼럼 2 구조를 없앴다고 설명합니다. VictoriaMetrics의 저장 경로 개선 중 수치가 붙은 것은 v1.92의 "최대 5배"뿐이고, 그것도 churn이 높고 보존이 긴 환경에 한정됩니다. Cortex는 1.14~1.21.1의 공식 자료에서 자원·쿼리 성능 개선 수치를 찾지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| adidas Cortex·VM 측정 | PromCon EU 2019. Cortex는 distributor 2·ingester 4, 청크 저장 DynamoDB. VM cluster는 insert 2·storage 4, single 2노드. 약 430K·900K 시리즈, 15초, 약 88K samples/s. CPU 1.08/1.14/0.49코어, 메모리 24.15/13.4/11.94GiB, 바이트/샘플 3.68/1.20/1.20B, DynamoDB 1133 WCU. 버전 미기재 | adidas 발표 슬라이드 23쪽 | `Ⓑ` |
| VM README의 Cortex 비교 문구 | "up to 7x less RAM than Prometheus, Thanos or Cortex"의 링크 대상은 "Prometheus vs VictoriaMetrics benchmark on node_exporter metrics" 글. "7x less storage" 문구도 같은 글을 링크 | VictoriaMetrics README | `Ⓥ` |
| VM 측 Mimir 비교 | GKE e2-standard-16, Mimir 2.2.0(RF 3) vs VM 1.80.0(RF 2), node_exporter 6000타깃, 15초, 약 550만 active series, 36만 samples/s, 10분마다 타깃 1% churn, 24시간 | VictoriaMetrics 블로그(2022-09-09) | `Ⓑ` |
| 위 벤치마크 결과 | 할당 Mimir 43.2 CPU/283GiB, VM 44 CPU/208GiB. 평균 CPU 약 1.7배, RAM 약 5배 차이. 디스크 VM 49GiB vs Mimir 369GiB+149.7GiB. instant p99 약 47초 vs 약 20초. 5배 부하에서 Mimir ingester OOM | VictoriaMetrics 블로그(2022-09-09) | `Ⓑ` |
| 위 벤치마크 한계 | 저자 명시: 24시간이라 compaction 미완 가능, active series 계산법 상이, range 쿼리 미측정, 저자가 Mimir에 익숙지 않음, 복제 계수 상이. Mimir 2.2 기준이라 MQE·ingest storage 이전 | 같은 글 | `Ⓑ` |
| Grafana 10억 series 시험 | 단일 tenant 10억 active series, 약 1500 레플리카·7000 CPU 코어·30TiB RAM, 20초 기준 약 5000만 samples/s 추정. SLO는 쓰기 요청 99.9%가 10초 미만 | Grafana Labs 블로그(2022-04-08) | `Ⓥ` |
| Mimir 3.0 자체 주장 | 대형 내부 클러스터 리소스 최대 15% 감소, MQE로 쿼리 최대 메모리 최대 92% 감소 | Grafana Mimir 3.0 블로그 | `Ⓥ` |
| Cortex 샘플당 바이트 | 12시간·15초 간격에 약 2KB~10KB 예시를 환산하면 약 0.7~3.5바이트. 문서가 out of date로 표시 | Cortex 용량 계획 문서(구버전) | `≈` |
| Mimir 샘플당 바이트 | compacted block 2바이트 가정. 15초 스크레이프, 1년 보존, 100만 active series당 13GB. 실측 아님 | Mimir 용량 계획 문서 | `✓` |
| VM 샘플당 바이트 | "less or around 1 byte after compression" | VictoriaMetrics 용량 산정 가이드 | `✓` |
| 52주 활동량 | 커밋 462/2,648/1,546, 병합 PR 453/2,815/882, 고유 작성자(봇 제외) 44/137/104, stars 5,877/5,270/17,990. 2026-11-01 집계 | `gh api` 직접 집계 | `✓` |
| 현행 버전 중립 벤치마크 | 찾지 못함. VM이 `prometheus-benchmark` 도구를 공개(Cortex·Mimir·Thanos 대상 지원) | VictoriaMetrics GitHub | `?` |
| 2022 이후 비교 벤치마크 | 둘 이상을 비교한 새 측정은 찾지 못함. 2024 SlideShare는 2022 시험의 재발표. Criteo(2023-09) 평가는 원문 미열람. 2025~2026 비교 글은 자체 측정 없음 | 검색·원문 대조 | `?` |
| Mimir 2.7 store-gateway | "The streaming store-gateway reduced out-of-memory errors by about 90%" | Grafana 블로그(2023-07-06) | `Ⓥ` |
| Mimir 2.9 인덱스 조회 생략 | "reduce the store-gateway memory requests by 30%", "in some clusters by up to 64%" | Grafana 블로그(2023-08-21), Mimir 2.9.0 릴리스 | `Ⓥ` |
| Mimir 2.10 라벨 구조 | "Expect ingesters to use around 15% less memory with this change, depending on the pattern of labels used, number of tenants, etc." | Mimir 2.10.0 릴리스 | `✓` |
| Mimir 2.13 OTLP | "reduces memory usage in the distributor by up to 30% and CPU usage by up to 8%" | Mimir 2.13.0 릴리스 | `✓` |
| MQE | "92% lower peak memory utilization and runs 39% faster than Prometheus' PromQL engine". 쿼리 `sum by (group)` 1종, 입력 10만 시리즈, 하드웨어·버전 미기재 | Grafana 블로그(2025-09-17) | `Ⓥ` |
| Mimir ingest storage TCO | "In Grafana Cloud, we reduced the Mimir TCO by 25% moving from the old architecture to the new architecture." RF 3·쿼럼 2 제거 설명 포함 | Grafana 팟캐스트 전사(2026-01-02) | `Ⓥ` |
| VM v1.82.0 regex | "improve performance by up to 4x for queries containing non-trivial `regex` filters" | VictoriaMetrics v1.82.0 CHANGELOG | `✓` |
| VM v1.92.0 일별 인덱스 | "reduce memory usage by up to 5x for setups with high churn rate and long retention" | VictoriaMetrics v1.92.0 CHANGELOG | `✓` |
| VM v1.133.0 파티션별 indexDB | "This should reduce disk space occupied by indexDBs as they get deleted along with the corresponding partitions". 수치 없음 | VictoriaMetrics v1.133.0 CHANGELOG | `✓` |
| Cortex 1.14~1.21.1 | Thanos 엔진(1.15)·Parquet(1.20~1.21)은 실험 기능, 공식 자료에 자원·쿼리 성능 수치 없음 | Cortex CHANGELOG, Parquet 문서 | `✓` |

{{% /details %}}

## 4. Thanos와 비교한 보존(retention) 설정

'—'는 공식 문서에서 해당 설정을 확인하지 못한 칸입니다.

| 항목 | Thanos | Cortex | Mimir | VictoriaMetrics OSS | VictoriaMetrics Enterprise |
|---|---|---|---|---|---|
| 전역 보존 설정 | compactor의 해상도별 설정<br>기본 0d = 영구 보관 | `compactor_blocks_retention_period` | `-compactor.blocks-retention-period` 또는 `compactor_blocks_retention_period` | `-retentionPeriod`<br>기본 1M·최소 24h | `-retentionPeriod`가 필터 보존 기간의 상한 |
| 해상도별 보존 | `--retention.resolution-raw`<br>`--retention.resolution-5m`<br>`--retention.resolution-1h` | — | — | 보존 하나만 지원 | — |
| 테넌트별 보존 | — | 테넌트 overrides | runtime overrides<br>`compactor_blocks_retention_period`·0이면 삭제 안 함 | 보존 하나만 지원 | — |
| 시리즈별 보존 | — | — | 시리즈 단위 보존·삭제 미지원 | 보존 하나만 지원 | `-retentionFilter=filter:duration`<br>`-retentionPeriod` 이하<br>여러 필터 일치 시 가장 짧은 값 |
| 삭제 방식 | 컴팩션·다운샘플링 루프 직후<br>루프 실패 시 삭제 안 함 | — | compactor | 보존 밖 파티션은 새 달 첫날<br>완전히 보존 밖인 part는 백그라운드 병합 중 삭제 | — |

Thanos를 붙이는 방식은 [Prometheus · Thanos · VictoriaMetrics 조립]({{< relref "/observability/metrics/prometheus-thanos/_index.md" >}})에서, 보존 기간에 따른 구성은 [메트릭 장기보관 아키텍처 비교]({{< relref "/observability/metrics/longterm-retention/_index.md" >}})에서 따로 다룹니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| Thanos 보존 | compactor `--retention.resolution-raw`·`--retention.resolution-5m`·`--retention.resolution-1h`, 기본 0d = 영구 보관. 보존은 컴팩션·다운샘플링 루프 직후 적용되며 그 루프가 실패하면 삭제되지 않음 | Thanos Compactor 문서 | `✓` |
| Mimir 전역 보존 | compactor가 담당. `-compactor.blocks-retention-period` 또는 limits의 `compactor_blocks_retention_period` | Mimir 보존 설정 문서 | `✓` |
| Mimir 테넌트별 보존 | runtime configuration의 overrides로 테넌트마다 `compactor_blocks_retention_period` 지정, 0이면 삭제 안 함 | Mimir 보존 설정 문서 | `✓` |
| Mimir 시리즈별 보존 | 시리즈 단위 삭제·보존과 Prometheus Delete series API를 지원하지 않음 | Mimir 보존 설정 문서 | `✓` |
| Cortex 보존 | 설정 레퍼런스의 limits에 `compactor_blocks_retention_period`가 있음(Mimir와 같은 이름, 테넌트 overrides 대상) | Cortex 설정 파일 레퍼런스 | `✓` |
| VM 보존(OSS) | `-retentionPeriod` 하나, 단위 h·d·w·M·y, 단위 없으면 월(31일), 기본 1M, 최소 24h | VM single-server 문서 Retention | `✓` |
| VM 삭제 시점 | 데이터는 월 단위 파티션. 보존 밖 파티션은 새 달 첫날 삭제, 보존 밖 part는 백그라운드 병합 중 결국 삭제(part가 보존 밖으로 완전히 나가야 삭제) | VM single-server 문서 Retention | `✓` |
| VM 다중 보존(OSS) | 커뮤니티판은 보존 하나만 지원. 여러 보존이 필요하면 `-retentionPeriod`·`-storageDataPath`·`-httpListenAddr`를 달리한 인스턴스를 여러 개 띄움 | VM 문서 Multiple retentions | `✓` |
| VM retention filters | Enterprise. `-retentionFilter=filter:duration`, `-retentionPeriod` 이하만 가능, 여러 필터에 걸리면 가장 짧은 값 적용 | VM 문서 Retention filters | `✓` |

{{% /details %}}

## 5. 확인하지 못한 것

- Mimir classic 아키텍처의 폐기 계획
- Mimir ingest storage에서 ingester를 늘리고 줄이는 세부 절차
- VictoriaMetrics vmstorage의 active series당 RAM 공식 수치

{{% details title="근거와 측정 조건" closed="true" %}}

| 항목 | 값·조건 | 출처 | 근거 |
|---|---|---|---|
| classic 폐기 계획 | 3.1·3.2 릴리스 노트와 versioning 문서에서 일정을 찾지 못함 | Mimir 릴리스 노트 | `?` |
| ingest storage 확장 절차 | 파티션 수 조정과 묶임. 세부 절차는 조사하지 못함 | Mimir 문서 | `?` |
| VM 메모리 | 현재 문서에 active series당 RAM 수치 없음. series ID 캐시 부족 시 성능 급락, 여유 RAM 50% 권장 | VictoriaMetrics FAQ, cluster 문서 | `✓` |

{{% /details %}}

## 참고 자료

- Cortex 아키텍처: https://cortexmetrics.io/docs/architecture/
- Cortex compactor: https://cortexmetrics.io/docs/blocks-storage/compactor/
- Cortex querier: https://cortexmetrics.io/docs/blocks-storage/querier/
- Cortex v1guarantees: https://cortexmetrics.io/docs/configuration/v1guarantees/
- Cortex shuffle sharding: https://cortexmetrics.io/docs/guides/shuffle-sharding/
- Cortex 용량 계획(구버전): https://cortexmetrics.io/docs/guides/capacity-planning/
- Cortex v1.21.0 릴리스: https://github.com/cortexproject/cortex/releases/tag/v1.21.0
- Cortex 릴리스: https://github.com/cortexproject/cortex/releases
- Cortex 로드맵: https://github.com/cortexproject/cortex/blob/master/docs/roadmap.md
- Cortex Thanos 마이그레이션: https://github.com/cortexproject/cortex/blob/master/docs/blocks-storage/migrate-storage-from-thanos-and-prometheus.md
- CNCF Cortex: https://www.cncf.io/projects/cortex/
- Mimir 릴리스: https://github.com/grafana/mimir/releases
- Mimir 아키텍처: https://grafana.com/docs/mimir/latest/get-started/about-grafana-mimir-architecture/
- Mimir ingest storage: https://grafana.com/docs/mimir/latest/get-started/about-grafana-mimir-architecture/about-ingest-storage-architecture/
- Mimir 3.0 릴리스 노트: https://grafana.com/docs/mimir/latest/release-notes/v3.0/
- Mimir versioning: https://grafana.com/docs/mimir/latest/configure/about-versioning/
- Mimir shuffle sharding: https://grafana.com/docs/mimir/latest/configure/configure-shuffle-sharding/
- Mimir 용량 계획: https://grafana.com/docs/mimir/latest/manage/run-production-environment/planning-capacity/
- Mimir Helm 6.0 릴리스 노트: https://grafana.com/docs/helm-charts/mimir-distributed/latest/release-notes/v6.0/
- Grafana Mimir 10억 active series(2022-04-08): https://grafana.com/blog/2022/04/08/how-we-scaled-our-new-prometheus-tsdb-grafana-mimir-to-1-billion-active-series/
- Grafana Mimir 3.0 블로그(2025-11-03): https://grafana.com/blog/2025/11/03/grafana-mimir-3-0-release-all-the-latest-updates/
- Mimir 웨비나 Q&A: https://community.grafana.com/t/intro-to-mimir-webinar-q-a/102614
- Mimir 다운샘플링 제안 PR: https://github.com/grafana/mimir/pull/5028
- VictoriaMetrics cluster: https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/
- VictoriaMetrics LTS: https://docs.victoriametrics.com/victoriametrics/lts-releases/
- VictoriaMetrics Enterprise: https://docs.victoriametrics.com/victoriametrics/enterprise/
- VictoriaMetrics MetricsQL: https://docs.victoriametrics.com/victoriametrics/metricsql/
- VictoriaMetrics FAQ: https://docs.victoriametrics.com/victoriametrics/faq/
- VictoriaMetrics 용량 산정: https://docs.victoriametrics.com/guides/understand-your-setup-size/
- VictoriaMetrics 릴리스: https://github.com/VictoriaMetrics/VictoriaMetrics/releases
- VictoriaMetrics prometheus-benchmark: https://github.com/VictoriaMetrics/prometheus-benchmark
- VictoriaMetrics의 Mimir 비교(2022-09-09): https://victoriametrics.com/blog/mimir-benchmark/
- adidas, Remote Write Storage Wars(PromCon EU 2019): https://promcon.io/2019-munich/talks/remote-write-storage-wars/
- 같은 발표 슬라이드: https://promcon.io/2019-munich/slides/remote-write-storage-wars.pdf
- VictoriaMetrics README: https://github.com/VictoriaMetrics/VictoriaMetrics/blob/master/README.md
- Mimir store-gateway OOM 개선(2023-07-06): https://grafana.com/blog/2023/07/06/breaking-the-memory-barrier-how-grafana-mimirs-store-gateway-overcame-out-of-memory-errors
- Mimir 인덱스 조회 생략(2023-08-21): https://grafana.com/blog/2023/08/21/less-is-more-how-grafana-mimir-queries-run-faster-and-more-cost-efficiently-with-fewer-indexes/
- Mimir 2.9.0 릴리스: https://github.com/grafana/mimir/releases/tag/mimir-2.9.0
- Mimir 2.10.0 릴리스: https://github.com/grafana/mimir/releases/tag/mimir-2.10.0
- Mimir 2.13.0 릴리스: https://github.com/grafana/mimir/releases/tag/mimir-2.13.0
- Mimir Query Engine(2025-09-17): https://grafana.com/blog/2025/09/17/faster-more-memory-efficient-performance-in-grafana-mimir-a-closer-look-at-mimir-query-engine
- Mimir 차세대 아키텍처 팟캐스트: https://grafana.com/blog/mimir-s-next-gen-architecturekafka-in-the-middle-object-storage-underneath-and-a-whole-lot-less-coupling/
- VictoriaMetrics v1.82.0: https://github.com/VictoriaMetrics/VictoriaMetrics/releases/tag/v1.82.0
- VictoriaMetrics v1.92.0: https://github.com/VictoriaMetrics/VictoriaMetrics/releases/tag/v1.92.0
- VictoriaMetrics v1.133.0: https://github.com/VictoriaMetrics/VictoriaMetrics/releases/tag/v1.133.0
- Cortex CHANGELOG: https://github.com/cortexproject/cortex/blob/master/CHANGELOG.md
- Cortex Parquet 모드: https://cortexmetrics.io/docs/guides/parquet-mode/
- Thanos 보존 설정: https://thanos.io/tip/components/compact.md/#enforcing-retention-of-data
- Mimir 보존 설정: https://grafana.com/docs/mimir/latest/configure/configure-metrics-storage-retention/
- Mimir 런타임 설정: https://grafana.com/docs/mimir/latest/configure/about-runtime-configuration/
- Cortex 설정 파일 레퍼런스: https://cortexmetrics.io/docs/configuration/configuration-file/
- VictoriaMetrics 보존 설정: https://docs.victoriametrics.com/victoriametrics/single-server-victoriametrics/#retention
- VictoriaMetrics 다중 보존: https://docs.victoriametrics.com/victoriametrics/single-server-victoriametrics/#multiple-retentions
- VictoriaMetrics retention filters: https://docs.victoriametrics.com/victoriametrics/single-server-victoriametrics/#retention-filters
