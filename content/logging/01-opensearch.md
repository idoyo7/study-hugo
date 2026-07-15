---
title: "OpenSearch (EFK)"
weight: 1
---

# OpenSearch (EFK) — 지금 쓰는 것, 왜 뚱뚱해 보이는가

{{< callout type="info" >}}
**한눈에**
- 강점은 임의 필드 ad-hoc 풀텍스트·고카디널리티 검색, SIEM/보안 완제품, 관리형 운영의 낮은 인건비다.
- 약점은 로그 저장 목적 대비 컴퓨트 헤비 — **비용의 ~90%가 인스턴스 시간**이고 스토리지는 ~10%뿐이다.
- **UltraWarm은 예약(RI) 불가**(hot만 예약 가능)라 전 클러스터 블렌디드 절감 상한이 **~25%**에 그친다 — "40% 절감" 기대는 성립하지 않는다.
- 진짜 절감은 **보존 tail을 컬럼나+S3로 이전하고 hot을 축소·OR로 전환**하는 데서 나오며, 이게 hot RI 최대 절감보다 크다.
- 우리 케이스: 90일 보존이 정말 필요한지부터 되묻고, tail 이전 + in-place 최적화를 먼저 한다.
{{< /callout >}}

Apache Lucene 기반 분산 검색·분석 엔진. 2021년 Elastic의 SSPL 전환 이후 Elasticsearch 7.10.2 / Kibana를 포크해 만들어졌고, **Apache 2.0** 라이선스로 현재 OpenSearch Software Foundation(Linux Foundation)이 관리한다 — 성숙도·생태계가 넓고 프로덕션 채택이 두텁다. AWS에서는 관리형 **Amazon OpenSearch Service**로 제공되며, 고객사는 `fluent-bit → Firehose → OpenSearch(+ UltraWarm)`로 운영 중이다. 파이프라인 구성 자체는 정석이고, 쟁점은 **로그 저장 용도 대비 요금 구조**다.

## 강점

- **임의 필드 풀텍스트 · 고카디널리티에 강하다**: Lucene 역색인이라 스키마·라벨을 미리 설계하지 않아도 **아무 필드나 ad-hoc 풀텍스트·정규식·관련도(relevance) 검색**이 즉시 된다. client IP·trace ID·URI처럼 카디널리티 높은 필드가 Loki에서는 라벨 독이 되지만 OpenSearch에서는 그냥 검색된다. "무엇을 찾을지 미리 모르는" 인시던트 조사에서 두드러지는 진짜 강점.
- **집계·대시보드·관측/보안 완제품**: 풍부한 aggregation 프레임워크와 OpenSearch Dashboards(Kibana 계보), 그리고 **SIEM·이상탐지·알럿·보안 분석** 플러그인이 턴키로 붙는다. 로그를 단순 저장이 아니라 검색·분석·보안 이벤트로 다루는 조직에 성숙한 완제품이다.
- **관리형 운영의 낮은 인건비**: Service는 컨트롤 플레인·자동 스냅샷·UltraWarm 티어링·노드 베이비시팅 제거를 제공한다. 관리형 `i7i.4xlarge.search`가 raw EC2의 **~1.60×** `≈`인데, 이 프리미엄은 본질적으로 셀프호스트 스택이 방치되어 rot되는 실패 모드를 피하는 보험료다 — 작은 플랫폼 팀에는 실질 가치.
- **보존 티어링 내장**: hot / UltraWarm(S3-backed) / cold 티어가 도메인에 내장되어, warm 8노드로 ~160 TB급을 addressing하며 보존을 관리형으로 늘릴 수 있다.
- **차세대 노드 타입(OR1/OR2/OM2)**: durable copy를 **S3-backed 관리형 스토리지($0.024/GB-mo)**에 두고 로컬/EBS는 성능 캐시로만 쓴다. AWS 자체 수치로 **~30% price-performance 개선, 색인 처리량 +26%(OR2 vs OR1)** `Ⓥ`, OR2 + Parquet 엔진은 스토리지 **~70%↓**(단 새 도메인 필요) `Ⓥ`. 게다가 **OR1/OR2는 RI/NURI 적격**이라 UltraWarm과 달리 예약 할인을 받는다.
- **성숙한 생태계·규정준수**: 넓은 커뮤니티·드라이버·통합(fluent-bit 네이티브 output 포함), 세분화된 접근제어와 전송/저장 암호화 등 보안·컴플라이언스 기능이 갖춰져 있다.

## 약점 · 한계

- **로그 저장 목적 대비 컴퓨트 헤비**: 역색인은 노드가 상시 가동돼야 서빙되므로 **비용의 ~90%가 인스턴스 시간, 스토리지는 ~10%** `≈`뿐이다. 스토리지가 지배하고 컴퓨트가 작은 컬럼나 로그 스토어와 정반대. 같은 로그의 on-disk footprint도 ClickHouse/VictoriaLogs/Loki 대비 **~10× 크다** `≈`.

{{< callout type="important" >}}
**UltraWarm은 RI 예약 불가**: 흔한 오해와 달리 **hot 데이터 노드와 dedicated master는 RI 적격**이다 — 예약 불가는 **UltraWarm과 Cold storage뿐**이다. 그래서 hot을 예약해도 warm compute가 온디맨드에 영구 고정돼 블렌디드 절감이 상한에 걸린다.

청구서 구조 예시 (현행 도메인 10 hot + 8 warm, 리스트가·us-east-1 파생 추정 `≈`):

| 항목 | 온디맨드 | 1yr RI | 3yr RI |
|---|---|---|---|
| Hot 10× i7i.4xlarge ($2.416/h) | $17,637 | $12,169 (~31%↓) | $9,169 (~48%↓) |
| UltraWarm 8× ultrawarm1.large ($2.68/h, **예약 불가**) | $15,651 | $15,651 (flat) | $15,651 (flat) |
| **compute 합계** | **$33,288** | $27,820 | $24,820 |
| **블렌디드 절감** | — | **~16%** | **~25%** |

hot을 3yr로 예약해 hot tier만 −48%를 받아도, UltraWarm이 잔여 compute의 ~63%(연 ~$188K)를 온디맨드로 고정하므로 **전 클러스터 블렌디드 절감 상한은 ~25%**다. "전체 클러스터 40% RI 절감"은 성립하지 않는다.
{{< /callout >}}

- **Cold tier 함정**: OpenSearch cold storage도 rehydrate에 (할인 불가) UltraWarm 노드가 필요하다. tail을 값싸게 빼는 경로로는 오히려 S3 Direct Query(zero-ETL)나 컬럼나+S3가 낫다.
- **셀프호스트 시 운영 리스크**: 1.5–2 TB/day 검색 클러스터를 self-manage하면 JVM heap·샤드·클러스터 사이징 튜닝 부담이 커지고, 관리형 전용인 UltraWarm 티어링도 없다(유사 기능은 searchable snapshots → S3). 관리형 프리미엄은 이 부담을 사는 값이다.

## 적합 / 부적합

- **적합**: 임의 필드 ad-hoc 풀텍스트·관련도 검색이 핵심인 워크로드, SIEM·보안 분석·이상탐지, 검색과 관측을 한 UI로 원하는 조직, 관리형 운영으로 인건비를 사려는 팀, 중간 규모 보존.
- **부적합**: 스토리지가 지배하는 대용량 장기 보존, 풀텍스트 관련도가 필요 없는 append-mostly 로그 아카이빙, 비용에 민감한 long-tail 보존 — 이 영역은 컬럼나+S3가 자릿수로 저렴하다.

## 우리 케이스에서는

90일 보존이 정말 필요한지부터 되묻는다. 절감의 대부분은 **보존 tail을 컬럼나+S3로 이전하고 hot을 축소·OR로 이전**하는 데서 나온다 — UltraWarm 8대(연 ~$188K 고정)를 컬럼나+S3 tail로 대체하면 대체 비용(~$24–48K/yr) 차감 후 **순 ~$140K+/yr 절감**으로 hot RI 최대 절감(~$100K/yr)을 압도한다 `≈`. 현행을 유지하더라도 UltraWarm+RI보다 **hot을 OR1/OR2로 옮겨 관리형 단순성은 지키되 스토리지 경제를 바꾸는 것**이 낫다. 대안 프로필은 [VictoriaLogs]({{< relref "03-victorialogs.md" >}}) · [ClickHouse]({{< relref "04-clickhouse.md" >}}), 우리 환경에 얹은 최종 판단은 [우리 케이스 · 권장안]({{< relref "08-recommendation.md" >}}) 참고.
