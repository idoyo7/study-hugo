---
title: "프로덕션 운영 사례"
date: 2026-07-13
lastmod: 2026-08-24
weight: 6
url: "/clickhouse/06-production-usecases/"
---

# ClickHouse 운영 사례의 규모와 배포 형태 {#프로덕션-운영-사례--검증된-것과-귀속歸屬-오류}

ClickHouse로 하루 PB 단위 로그를 처리하는 사례가 있습니다. 그러나 처리량이 크다는 사실만으로 EKS의 로컬 NVMe 구성까지 검증됐다고 볼 수는 없습니다. Cloudflare·Didi는 베어메탈이고, Anthropic·Character.AI·LogHouse는 오브젝트 스토리지를 활용합니다. eBay는 Kubernetes와 operator를 공개했지만 스토리지 하드웨어는 밝히지 않았습니다.

이 글은 각 사례에서 확인되는 배포 형태, 스토리지, 적재 방식을 나눠 기록합니다. ClickHouse가 발행한 케이스스터디의 비용·성능 수치는 `Ⓥ`로 표시했습니다. 실제 사용자 발표가 바탕이더라도 벤더가 소개한 조건이며, 우리 환경에서 그대로 재현되는 수치는 아닙니다.

## 대규모 운영 사례 매트릭스

출처 등급 범례: `자사`=해당 회사 자체 엔지니어링 블로그(상대적 독립) · `CH`=ClickHouse 자사 블로그/케이스스터디(자기 홍보 맥락, `Ⓥ`) · 규모 수치의 등급은 셀 내 표기.

| 회사 | 용도 | 배포 형태 | 스토리지 | 출처 |
|---|---|---|---|---|
| **Cloudflare** | HTTP/DNS/방화벽 분석·빌링 | 베어메탈(자체 DC 300+) | 로컬 디스크 중심 | 자사+CH |
| **Netflix** | 로그(관측성) | 자체 파이프라인 | 계층형 | CH |
| **MS Clarity** | 웹 세션/행동 분석 | "layer" 서브클러스터 | DC 간 복제 | 자사 |
| **Character.AI** | 관측성(로그) | ClickHouse Cloud(multi-cloud K8s) | S3(Cloud) | CH |
| **Tesla(Comet)** | 메트릭(관측성) | K8s 추정, OTel→Kafka→ETL | CH 네이티브 | CH |
| **Didi** | 로그 | 물리 노드(베어메탈) | 계층형(hot/cold) | CH |
| **Trip.com** | 로그 | **K8s StatefulSet** | 로컬+ (SMT/S3 테스트) | CH |
| **Uber** | 로그 | 자체 인프라 | 계층형 | 자사 |
| **eBay** | OLAP/모니터링 | **K8s + operator** | **미확인**(출처에 언급 없음) | 자사 |
| **Anthropic** | 관측성 | **air-gapped Cloud arch on K8s + operator** | **오브젝트 스토리지** | CH |
| **Sentry(Snuba)** | 에러/이벤트 검색 | 자체 인프라 | ClickHouse | 자사 |
| **PostHog** | 제품 분석 | 자체/Cloud | Sharded | 자사 |
| **GitLab** | 분석 + 관측성 | Cloud/자체 | — | 자사+CH |
| **LogHouse**(CH 도그푸딩) | 내부 관측성 | **K8s + operator** | 오브젝트 스토리지/S3 | CH |

배포 형태와 별도로 공개된 처리량·데이터량을 모았습니다. 수치마다 측정 시점과 원본 데이터·압축 데이터 구분이 다릅니다.

| 회사 | 규모(핵심 수치) |
|---|---|
| **Cloudflare** | 20+클러스터, >100 노드, 1000+ replica, ~90M rows/s, 100+ PB, 96조 events를 <2s(1일 창 1.61경도 <2s) `✓` |
| **Netflix** | 5 PB/day, 평균 10.6M events/s(peak 12.5M), 500~1000 QPS `Ⓥ` |
| **MS Clarity** | 수백 대 머신, 수백 PB, 수백조 events, 수십억 pv/day `✓` |
| **Character.AI** | 450 PB raw/월 → 샘플 후 50B/월, 10x 데이터·비용 -50% `Ⓥ` |
| **Tesla(Comet)** | 1B rows/s를 11일 지속 = 1 quadrillion rows 무장애 `Ⓥ` |
| **Didi** | 400+ 물리 노드, peak write 40 GB/s+, ~15M queries/day, PB/day, machine cost -30% vs ES `Ⓥ⁽자가보고⁾` |
| **Trip.com** | 50 PB(4PB ES에서 시작), 저장 -50%+, query 4~30x `Ⓥ` |
| **Uber** | millions logs/s, 수천 서비스, 수 PB, ingest <1min `✓` |
| **eBay** | Federated 다중 리전, 인프라 풋프린트 -90%+ `✓` |
| **Anthropic** | 3인 팀 운영(데이터량·비용 비공개) `✓` |
| **Sentry(Snuba)** | Kafka 인서트, Tagstore TB→GB, Alert이 전체 QPS의 ~40% `✓` |
| **PostHog** | Sharded CH, Kafka engine table + MV 인제스천 `✓` |
| **GitLab** | 100M rows 쿼리 30~40s→<1s, 일 57M+ traces, 3000+ 서비스 `✓` |
| **LogHouse**(CH 도그푸딩) | 100+ PB 비압축, ~500조 rows, SysEx 37M + OTel 2M logs/s `Ⓥ` |

Didi 수치는 2024-04 스냅샷이며 물리 노드 400+는 Log 300+/Trace 40+로 나뉩니다. machine cost -30%는 TCO보다 좁은 지표로 엔지니어링·마이그레이션 비용은 제외합니다. Uber 수치는 2021-02 스냅샷으로 단일 노드 300K logs/s 실측치이며 후속으로 비정형 Spark 로그는 CLP로 보완했습니다.

{{% details title="그 밖의 확인 사례 — Zomato · Shopee · OpenAI · Ahrefs" closed="true" %}}
Zomato(EC2 10×m6g.16xlarge, gp3 hot→cold TTL, ES 대비 연 $1M+ 절감 `Ⓥ`), Shopee(분산 트레이싱 ~3M rows/s, 30B+ trace rows `✓⁽요약⁾`). OpenAI는 일 PB급 로그를 자체 관리 ClickHouse 클러스터(90 샤드×2 리플리카, Fluent Bit→로드밸런서 인제스트, 최근 데이터는 디스크·구 데이터는 blob 스토리지로 티어링)로 인제스트하며 월 20%+ 성장합니다 `Ⓥ⁽자가보고⁾`(출처: clickhouse.com 블로그 + OpenAI 엔지니어 컨퍼런스 발표). 단 이 글은 Datadog 등 상용 벤더 이탈이나 K8s/EKS·인스턴스·로컬 NVMe를 전혀 언급하지 않습니다 — OpenAI는 순수 하이퍼스케일 증거일 뿐이므로 아래 §'K8s + 로컬 NVMe' 실증 목록에는 넣지 않습니다(C8). Ahrefs(초대형 베어메탈)는 이번 조사에서도 노드 수·용량을 명시한 1차 출처를 확보하지 못해 `?`으로 둡니다.
{{% /details %}}

확보한 자료에서 Cloudflare의 100+PB와 Didi의 400+노드는 베어메탈 운영 사례입니다. eBay·Trip.com·Anthropic·LogHouse에서는 Kubernetes 운영을 확인할 수 있지만 로컬 NVMe primary까지 공통으로 확인되지는 않습니다. 2026-07-14 추가 조사에서도 이 조합을 명시한 사례를 확보하지 못했습니다. 이는 공개 근거의 한계이며, 해당 구성이 실제로 쓰이지 않는다는 뜻은 아닙니다.

처리량 뒤에 어떤 작업이 있었는지도 함께 봐야 합니다. Netflix는 인제스트 방식을 바꿨고 Cloudflare는 대규모 장애를 견디는 운영 체계를 갖췄습니다. 노드 수만 복사해서 같은 성능과 가용성을 기대하기는 어렵습니다.

{{% details title="근거 — Netflix·Cloudflare가 규모를 낸 튜닝 상세" closed="true" %}}
Netflix는 5PB/day를 내려고 세 곳을 갈아엎었습니다 `Ⓥ`: 유사 로그 수백만 개를 하나로 collapse하는 fingerprinting, JDBC 배치 인서트를 커스텀 native 프로토콜 인코딩으로 교체, 태그 쿼리에 LowCardinality 적용(창시자 Alexey Milovidov 제안). Cloudflare는 오케스트레이션을 얇게 가져가 "북미 DC 연결을 끊어 용량 1/3을 제거해도 유럽 클러스터가 부하를 자동 인수"하는 회복력을 보였고 `✓`, 그럼에도 2026년 빌링 파이프라인이 쿼리 플래닝 단계의 락 경합으로 느려진 장애를 겪었습니다(안티패턴 §9).
{{% /details %}}

## 'K8s + operator + 로컬 NVMe' — 실증은 어디까지인가

eBay 사례는 출처를 구분할 필요가 있습니다. 일부 2차 자료는 hot 데이터에 로컬 SSD를 사용한다고 적지만, 확인한 eBay 공식 글에는 스토리지 하드웨어와 티어링 설명이 없습니다. 이 사례로 확인할 수 있는 것은 Kubernetes와 operator 사용까지입니다 `?`.

| 사례 | K8s | operator | 로컬 NVMe(hot) | 근거 등급 |
|---|:---:|:---:|:---:|---|
| **eBay** | O(federated, FCHI/FCHC) | O(자체 확장+OSS operator) | **미확인**(출처에 없음) | K8s+operator=`✓`, 스토리지=`?` |
| **Anthropic** | O | O(ClickHouse Operator) | 오브젝트 스토리지 백킹(로컬은 캐시 추정) | `✓`(로컬 캐시는 `≈`) |
| **Trip.com** | O(StatefulSet) | 자체 관리 | 로컬 → SharedMergeTree/S3 테스트로 이행 | `✓` |
| **ClickHouse LogHouse** | O | O(ClickHouse Operator) | 오브젝트 스토리지 | `Ⓥ` |
| **mrkrbrts**(참조 아키텍처) | O(EKS) | O(Altinity) | r7gd NVMe = **S3 write-through 캐시** | `✓`(개인 참조 아키텍처) |

eBay·Anthropic·LogHouse에서는 Kubernetes와 operator 운영이 확인됩니다. Trip.com 자료는 StatefulSet 기반 자체 관리를 설명합니다. 아래 참조 아키텍처의 로컬 NVMe는 S3 캐시이며, RMT의 유일한 데이터 디스크로 사용하는 것과 복구 방식이 다릅니다.

로컬 디스크를 primary로 쓰면 노드 종료 때 사본을 복구하는 작업을 맡아야 합니다. [데이터스토어별 노드 교체 비교]({{< relref "/data/clickhouse/storage/07-local-nvme-datastore-patterns.md" >}})에서 재복제·drain·PVC 정리를 다룹니다. 이 사례 목록만으로 그 절차가 자동화됐다고 가정하지 않습니다.

## 관측성 아키텍처 패턴

### 인제스천 파이프라인 — Kafka / Vector / OTel

적재 경로는 팀이 필요한 변환과 버퍼링 방식에 따라 다릅니다. 공개 사례에서 사용한 방식은 다음과 같습니다.

| 패턴 | 대표 사례 | 특징 | 트레이드오프 |
|---|---|---|---|
| **Kafka버퍼+커스텀워커** | Zomato, Trip.com, PostHog | 배치·백프레셔 제어, native포맷 인서트 | 워커 유지보수 부담 |
| **Kafka table engine + MV** | PostHog | CH 내장 컨슈머, 인프라 단순 | 튜닝 여지 제한, 장애 격리 약함 |
| **OTel Collector** | Tesla, Character.AI(DaemonSet), Netflix(일부) | 표준·벤더중립 | **대규모에서 CPU 병목**(아래) |
| **Vector** | Anthropic | 경량·고성능 파이프라인 | — |
| **CH → CH 직접(SysEx)** | ClickHouse LogHouse | native 포맷 byte-copy, 재직렬화 0 | ClickHouse 소스 한정 |

Kafka 버퍼 + 커스텀 워커 구현 언어는 Zomato가 Go, Trip.com이 GoHangout입니다. OTel Collector는 표준·벤더중립에 에코시스템 확장성까지 갖췄지만 대규모에서는 CPU 병목이 따라옵니다(아래 §OTel Collector의 CPU 병목).

공통 원칙은 어디서나 같습니다 `✓` — (1) 대형 배치 인서트(수천~수만 rows) 또는 async insert, (2) native 포맷(HTTP 대비 ~1.8x, Zomato `Ⓥ`), (3) 초당 인서트 빈도 제한(Sentry: ~1/s), (4) Kafka로 스파이크 흡수. 작은 INSERT가 높은 빈도로 이어지면 part가 쌓여 "too many parts" 문제가 생길 수 있습니다.

### wide events가 대세

관측성 스키마의 업계 방향은 wide events로 굳어지고 있습니다 `✓`(ClickHouse LogHouse의 100PB 설계, Charity Majors/Honeycomb 담론과 맞닿음). row마다 완전한 컨텍스트를 사전 집계 없이 저장하고(histogram 대신 개별 `insertDuration` 값), pod명·버전·네트워크 정보 같은 고카디널리티 차원을 그대로 보존해 쿼리 시점에 집계합니다. 전통 메트릭 스토어의 per-series cardinality explosion을 피하려는 게 핵심 동기입니다. ClickStack/HyperDX가 이 패턴을 UI로 지원합니다([HyperDX 심층]({{< relref "/observability/apm-rum/01-hyperdx-deep-dive.md" >}})). 대비되는 시그널별 테이블(logs/metrics/traces 분리, OTel 스키마 기본)도 여전히 유효하며 Tesla처럼 메트릭만 PromQL 전용 파이프라인으로 특화하는 하이브리드도 실전에서 쓸 만합니다.

실전 스키마 규칙(여러 사례 공통 `✓`): 필터 빈도 높은 2~3개 컬럼을 카디널리티 오름차순 ORDER BY(Trip.com `(log_level, timestamp, host_ip, host_name)`), LowCardinality(Netflix 태그 최적화의 핵심), 동적 태그는 Map 또는 JSON 타입(25.3 GA), 압축은 ZSTD(Trip.com 40%+·Character.AI 15~50x `Ⓥ`), skip index(tokenbf_v1/Bloom)는 남용 금지.

### OTel Collector의 CPU 병목 (대규모 교훈)

LogHouse 사례에서는 데이터베이스에 도착하기 전 변환 비용이 문제가 됐습니다. ClickHouse는 OTel Collector가 JSON 직렬화, 파싱·마샬링, OTel 변환을 반복하면서 초대형 처리량에서 CPU 병목이 됐다고 설명합니다. 아래는 자체 관측성 환경에서 보고한 수치입니다 `Ⓥ`.

- 20M rows/s를 OTel로 안정 처리하려면 ~8,000 CPU 코어가 필요하다고 추산.
- 그래서 CH→CH native byte-copy인 커스텀 SysEx로 전환: 800 OTel 코어 → 70 SysEx 코어로, 20배 볼륨을 이전 CPU의 <10%로 처리. OTel이 부하 시 로그를 drop하던 문제도 해소.
- 단 OTel을 완전히 폐기하지는 않았습니다 — crash-loop 등 system table 접근 불가 시나리오·stderr 캡처에는 여전히 유효 → 하이브리드 유지.

{{< callout type="warning" >}}
시사점 — 검토 중인 "dd 프로토콜 → OTel/HyperDX 프록시" 경로도 변환 단계의 CPU 비용을 신중히 벤치마크해야 합니다. 초대형에서는 변환 계층이 클러스터보다 비쌀 수 있습니다. 프록시 매핑의 성숙도·CPU 세금은 [dd 프록시 매핑]({{< relref "/observability/apm-rum/03-dd-proxy-mapping.md" >}})에서 별도로 다룹니다.
{{< /callout >}}

## Datadog 대비 비용 주장 — 출처 편향 경고

{{< callout type="warning" >}}
"ClickHouse가 Datadog보다 10~50배 쌉니다"는 문구가 널리 인용되지만 수치의 대부분이 ClickHouse Inc. 자료 출처임을 반드시 감안해야 합니다 `Ⓥ`.
{{< /callout >}}

| 항목 | 수치 | 비고 |
|---|---|---|
| Datadog vs 자체관리 ClickStack 비용비 | 1~5 TB/day 인제스트에서 **Datadog이 10~50배 비쌈** | ClickHouse 자료 `Ⓥ` |
| Character.AI (관측성 마이그레이션) | **10x 데이터, 비용 -50%** | ClickHouse Cloud+ClickStack `Ⓥ` |
| Zomato (ES→CH) | **연 $1M+ 절감** | ES 대비 `Ⓥ` |
| Didi (ES→CH) | **머신 비용 -30%** | `Ⓥ` |
| Trip.com (ES→CH) | 저장 **-50%+**, 쿼리 **4~30x** | `Ⓥ` |

Datadog 고비용의 원인(고카디널리티 과금 전가, custom metrics·인제스트+쿼리 이중 과금, 오토스케일에 붙는 per-host 페널티) 자체는 실재합니다 `✓`. 그러나 "10~50배"는 자체관리 인건비/운영비를 제외한 인프라 비용 기준일 가능성이 높습니다. TCO를 재평가할 때는 운영 인력·on-call·업그레이드 비용을 반드시 가산해야 합니다. 라이선스 절감분을 운영/개발 인건비 증가가 상쇄하는 영역(Security·Synthetics 등 제품형 기능)도 있습니다. 인프라 vs people TCO의 실제 크로스오버는 [Managed vs Self-hosted]({{< relref "/data/clickhouse/deployment/01-managed-vs-selfhosted.md" >}})에서 숫자로 다룹니다. 이관은 rip-and-replace 대신 dual-write → 고카디널리티 쿼리 속도 비교 → 단계적 전환 순서로 밟아 리스크를 줄이길 권합니다 `✓`.

## 공통 교훈 & 안티패턴

### 반복 등장하는 성공 패턴

1. 작은 INSERT를 합쳐 part 생성을 줄입니다. 사례에는 Kafka 버퍼와 native 배치, async insert 등 여러 경로가 있습니다. Kafka 사용이 모든 배포의 전제는 아닙니다.
2. 수직 확장 우선, 샤딩은 나중 — CH는 대형 단일 노드(수백 코어/TB RAM)에서 강합니다. 조기 수평 확장은 비용·복잡도만 늡니다(대개 replica 2개면 충분).
3. hot(로컬 NVMe) + cold(S3) tiering — 성능·비용 균형의 표준. SharedMergeTree(Cloud 전용)로 storage-compute 분리가 신흥 표준이나 self-host에선 불가.
4. LowCardinality + 필터순 ORDER BY + ZSTD — 압축·쿼리 성능의 3종 세트.
5. 쿼리 게이트웨이/거버넌스 — Trip.com(SQL 파싱·QPS 제한·대형 스캔 차단), Uber(QueryBridge). 대규모에선 쿼리 남용 통제가 필수.
6. 복제로 내구성, 오케스트레이션은 최소 — Cloudflare는 "용량 1/3을 빼도 그리 많은 게 잘못되지 않는다"고 표현.
7. 소규모 팀도 운영 가능 — Anthropic 3명, Character.AI 첫 SRE 1명. 단 그게 되려면 operator + 오브젝트 스토리지 백킹이 전제였습니다.

### 안티패턴 (피해야 할 것)

`✓` (ClickHouse "13 mistakes", BigDataBoutique):

1. Too Many Parts(가장 흔한 프로덕션 이슈) — 작은 인서트/고카디널리티 파티션 키가 원인. 파티션당 300 parts 초과면 조치. → 배치/async insert, 파티션 키 카디널리티 <1,000.
2. 고카디널리티 파티션 키 — 일 단위가 보통 적정, 그 이상 세분화 금지.
3. 소량(row 단위) 인서트 — 각 인서트가 파트 + Keeper 레코드 생성(Sentry 교훈: ~1/s 권장).
4. Mutation 남용 — classic mutation은 파트 전체 재작성 → lightweight delete/patch part 사용.
5. Keeper 과소 리소스 / 단일 앙상블 의존 — 조정 손실 시 테이블이 read-only로 전락. 전용 Keeper 다중 AZ로(Clarity의 단일 3노드 ZK 전면 의존은 리스크 포인트).
6. materialized view 남발(>50개)·skip index 남용 — 인서트 속도만 갉아먹고 성능 개선은 미미.
7. experimental/beta 기능을 코어에 사용 — GA 전 핵심 의존 금지.
8. (K8s 특화) 로컬 NVMe + 부주의한 node drain/upgrade — drain이 데이터 소실→재복제를 유발. `reclaimPolicy: Retain` + PVC affinity + rolling 절차 설계 필수.
9. (대규모) 쿼리 플래닝/컴파일 병목 — 데이터 경로 말고 플래닝 락 경합에서도 병목이 납니다(Cloudflare 2026 빌링 파이프라인 사례 `✓`).

{{< callout type="important" >}}
Anthropic·Character.AI의 소수 인력 운영에는 오브젝트 스토리지 기반 아키텍처와 벤더의 관리가 포함됩니다. 이 인력 규모를 로컬 NVMe primary self-host에 그대로 적용하기는 어렵습니다. 로컬 캐시와 공유 S3 구성은 사용하는 제품의 지원 범위를 확인한 뒤 비교합니다.

{{< /callout >}}

## 공개 사례를 우리 환경에 적용할 때 {#우리-케이스에서는}

공개 사례는 ClickHouse를 큰 규모로 운영할 수 있다는 근거입니다. 우리 EKS + Altinity + 로컬 NVMe 구성의 노드 교체 절차까지 증명해주지는 않습니다. 배포를 진행한다면 [operator 구성]({{< relref "/data/clickhouse/deployment/03-operator.md" >}})과 [스토리지 복구 설계]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})를 직접 검증해야 합니다.

소수 인력 사례를 볼 때는 벤더가 맡은 일을 함께 셉니다. 비용 절감률에도 자체 인건비와 on-call 비용을 추가해 [TCO]({{< relref "/data/clickhouse/deployment/01-managed-vs-selfhosted.md" >}})를 계산합니다. RUM과 범용 분석을 맡을 팀이 정해져야 이 운영 사례가 우리 선택에 도움이 됩니다.

로그만 내재화하는 범위에서는 [VictoriaLogs]({{< relref "/observability/logs/comparison/03-victorialogs.md" >}})를 선택한 [로깅 권장안]({{< relref "/observability/logs/comparison/08-recommendation.md" >}})을 유지합니다. 사례별 원문은 [출처]({{< relref "/data/clickhouse/10-sources.md" >}})에 있습니다. 시점 기준 2026-07.
