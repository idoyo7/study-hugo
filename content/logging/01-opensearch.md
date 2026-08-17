---
title: "OpenSearch (EFK)"
weight: 1
---

# OpenSearch (EFK) — 지금 쓰는 것, 왜 뚱뚱해 보이는가

{{< callout type="info" >}}
**한눈에**
- 강점은 임의 필드 ad-hoc 풀텍스트·고카디널리티 검색, SIEM/보안 완제품, 관리형 운영의 낮은 인건비입니다.
- 약점은 로그 저장 목적에 비해 컴퓨트가 무겁다는 것입니다 — 비용의 ~90%가 인스턴스 시간이고 스토리지는 ~10%뿐입니다.
- UltraWarm은 예약(RI) 불가(hot만 예약 가능)라 전 클러스터 블렌디드 절감 상한이 ~25%에 그칩니다 — "40% 절감" 기대는 성립하지 않습니다.
- 진짜 절감은 보존 tail을 컬럼나+S3로 옮기고 hot을 축소·OR로 전환하는 데서 나옵니다. 이게 hot RI 최대 절감보다 큽니다.
- 우리 케이스: 90일 보존이 정말 필요한지부터 되묻습니다. tail 이전 + in-place 최적화를 먼저 합니다.
{{< /callout >}}

Apache Lucene 기반 분산 검색·분석 엔진입니다. 2021년 Elastic이 SSPL로 전환한 뒤 Elasticsearch 7.10.2 / Kibana를 포크해 만들었습니다. 라이선스는 Apache 2.0이고 지금은 OpenSearch Software Foundation(Linux Foundation)이 관리합니다 — 성숙도·생태계가 넓고 프로덕션 채택이 두텁습니다. AWS에서는 관리형 Amazon OpenSearch Service로 제공됩니다. 고객사는 `fluent-bit → Firehose → OpenSearch(+ UltraWarm)`로 운영 중입니다. 파이프라인 구성 자체는 정석입니다. 쟁점은 로그 저장 용도에 비춘 요금 구조입니다.

## 강점

- 임의 필드 풀텍스트와 고카디널리티에 강합니다. Lucene 역색인이라 스키마·라벨을 미리 설계하지 않아도 아무 필드나 ad-hoc 풀텍스트·정규식·관련도(relevance) 검색이 즉시 됩니다. client IP·trace ID·URI처럼 카디널리티 높은 필드가 Loki에서는 라벨 독이 되지만 OpenSearch에서는 그냥 검색됩니다. "무엇을 찾을지 미리 모르는" 인시던트 조사에서 두드러지는 진짜 강점입니다.
- 풍부한 aggregation 프레임워크와 OpenSearch Dashboards(Kibana 계보)를 갖췄습니다. SIEM·이상탐지·알럿·보안 분석 플러그인도 턴키로 붙습니다. 로그를 단순 저장이 아니라 검색·분석·보안 이벤트로 다루는 조직에는 성숙한 완제품입니다.
- 관리형이라 인건비가 낮습니다. Service가 컨트롤 플레인과 자동 스냅샷, UltraWarm 티어링을 맡고 노드 베이비시팅을 없앱니다. 관리형 `i7i.4xlarge.search`가 raw EC2의 ~1.60× `≈`인데, 이 프리미엄은 셀프호스트 스택이 방치돼 rot되는 실패 모드를 피하는 보험료입니다 — 작은 플랫폼 팀에는 실질 가치가 있습니다.
- 보존 티어링이 내장입니다. hot / UltraWarm(S3-backed) / cold 티어가 도메인에 들어 있습니다. warm 8노드로 ~160 TB급을 addressing하며 보존을 관리형으로 늘릴 수 있습니다.
- 차세대 노드 타입(OR1/OR2/OM2)은 durable copy를 S3-backed 관리형 스토리지($0.024/GB-mo)에 두고 로컬/EBS는 성능 캐시로만 씁니다. AWS 자체 수치로 ~30% price-performance 개선, 색인 처리량 +26%(OR2 vs OR1) `Ⓥ`, OR2 + Parquet 엔진은 스토리지 ~70%↓(단 새 도메인 필요) `Ⓥ`. OR1/OR2는 RI/NURI 적격이라 UltraWarm과 달리 예약 할인도 받습니다.
- 생태계와 규정준수도 갖춰져 있습니다. 커뮤니티·드라이버·통합이 넓고(fluent-bit 네이티브 output 포함), 세분화된 접근제어와 전송/저장 암호화 같은 보안·컴플라이언스 기능이 붙어 있습니다.

## 약점 · 한계

- 로그 저장이 목적이라면 컴퓨트가 무겁습니다. 역색인은 노드가 상시 가동돼야 서빙되므로 비용의 ~90%가 인스턴스 시간, 스토리지는 ~10% `≈`뿐입니다. 스토리지가 지배하고 컴퓨트가 작은 컬럼나 로그 스토어와 정반대입니다. 같은 로그의 on-disk footprint도 ClickHouse/VictoriaLogs/Loki 대비 ~10× 큽니다 `≈`.

{{< callout type="important" >}}
UltraWarm은 RI로 예약할 수 없습니다. 흔한 오해와 달리 hot 데이터 노드와 dedicated master는 RI 적격입니다. 예약이 막힌 것은 UltraWarm과 Cold storage뿐입니다. 그래서 hot을 예약해도 warm compute가 온디맨드에 영구 고정돼 블렌디드 절감이 상한에 걸립니다.

청구서 구조 예시 (현행 도메인 10 hot + 8 warm, 리스트가·us-east-1 파생 추정 `≈`):

| 항목 | 온디맨드 | 1yr RI | 3yr RI |
|---|---|---|---|
| Hot 10× i7i.4xlarge ($2.416/h) | $17,637 | $12,169 (~31%↓) | $9,169 (~48%↓) |
| UltraWarm 8× ultrawarm1.large ($2.68/h, **예약 불가**) | $15,651 | $15,651 (flat) | $15,651 (flat) |
| **compute 합계** | **$33,288** | $27,820 | $24,820 |
| **블렌디드 절감** | — | **~16%** | **~25%** |

hot을 3yr로 예약해 hot tier만 −48%를 받아도, UltraWarm이 잔여 compute의 ~63%(연 ~$188K)를 온디맨드로 고정하므로 전 클러스터 블렌디드 절감 상한은 ~25%입니다. "전체 클러스터 40% RI 절감"은 성립하지 않습니다.
{{< /callout >}}

- Cold tier에도 함정이 있습니다. OpenSearch cold storage는 rehydrate할 때 (할인 불가) UltraWarm 노드가 필요합니다. tail을 값싸게 빼는 경로로는 오히려 S3 Direct Query(zero-ETL)나 컬럼나+S3가 낫습니다.
- 셀프호스트로 돌리면 운영 리스크가 커집니다. 1.5–2 TB/day 검색 클러스터를 self-manage하면 JVM heap·샤드·클러스터 사이징 튜닝 부담이 큽니다. 관리형 전용인 UltraWarm 티어링도 없습니다(유사 기능은 searchable snapshots → S3). 관리형 프리미엄은 이 부담을 사는 값입니다.

## 적합 / 부적합

- 적합: 임의 필드 ad-hoc 풀텍스트·관련도 검색이 핵심인 워크로드, SIEM·보안 분석·이상탐지, 검색과 관측을 한 UI로 원하는 조직, 관리형 운영으로 인건비를 사려는 팀, 중간 규모 보존.
- 부적합: 스토리지가 지배하는 대용량 장기 보존, 풀텍스트 관련도가 필요 없는 append-mostly 로그 아카이빙, 비용에 민감한 long-tail 보존 — 이 영역은 컬럼나+S3가 자릿수로 저렴합니다.

## 우리 케이스에서는

90일 보존이 정말 필요한지부터 되묻습니다. 절감의 대부분은 보존 tail을 컬럼나+S3로 옮기고 hot을 축소·OR로 전환하는 데서 나옵니다 — UltraWarm 8대(연 ~$188K 고정)를 컬럼나+S3 tail로 대체하면 대체 비용(~$24–48K/yr)을 빼고도 순 ~$140K+/yr 절감이라 hot RI 최대 절감(~$100K/yr)을 압도합니다 `≈`. 현행을 유지하더라도 UltraWarm+RI보다는 hot을 OR1/OR2로 옮겨 관리형 단순성은 지키면서 스토리지 경제를 바꾸는 편이 낫습니다. 대안 프로필은 [VictoriaLogs]({{< relref "03-victorialogs.md" >}}) · [ClickHouse]({{< relref "04-clickhouse.md" >}})에 정리했습니다. 우리 환경에 얹은 최종 판단은 [우리 케이스 · 권장안]({{< relref "08-recommendation.md" >}})에 있습니다.
