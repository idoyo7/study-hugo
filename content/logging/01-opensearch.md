---
title: "OpenSearch (EFK)"
weight: 1
---

# OpenSearch (EFK) — 지금 쓰는 것, 왜 뚱뚱해 보이는가

`fluent-bit → Firehose → OpenSearch(+ UltraWarm)` 파이프라인 자체는 정석이다. 문제는 **요금 구조**다.

- **비용의 ~90%가 인스턴스 시간**, 스토리지는 10%뿐이다. 로그가 S3를 적극적으로 쓰는 것처럼 보여도 청구서는 컴퓨트에 묶여 있다.
- **UltraWarm 노드는 RI(예약 인스턴스) 예약 불가**다. 반면 흔한 오해와 달리 **hot 데이터 노드와 dedicated master는 RI 적격**이다. 예약 불가는 UltraWarm과 Cold storage뿐.

**청구서 해부 (리스트가, us-east-1 기준 파생 추정):**

| 항목 | 온디맨드 | 1yr RI | 3yr RI |
|---|---|---|---|
| Hot 10× i7i.4xlarge ($2.416/h) | $17,637 | $12,169 (~31%↓) | $9,169 (~48%↓) |
| UltraWarm 8× ultrawarm1.large ($2.68/h, **예약 불가**) | $15,651 | $15,651 (flat) | $15,651 (flat) |
| **compute 합계** | **$33,288** | $27,820 | $24,820 |
| **블렌디드 절감** | — | **~16%** | **~25%** |

여기서 나오는 정정: **"전체 클러스터 40% RI 절감"은 성립하지 않는다.** hot을 예약해도 UltraWarm이 잔여 compute의 ~63%를 차지하며 **영구 온디맨드로 고정**(연 ~$188K)되기 때문에, 블렌디드 절감 상한은 ~25%다. → 결론은 **warm/cold tail을 컬럼나+S3로 빼는 것**이 RI보다 절감폭이 크다는 방향으로 강화된다.

**in-place 최적화 카드 (해체 없이 지금 할 수 있는 것):**

- **OR1 / OR2 "Standard" 계열로 이전** — replica가 로컬 NVMe가 아니라 **S3-backed**라 replica compute/EBS 비용이 소멸한다. AWS 자체 수치로 **~30% price-performance 개선, 색인 처리량 +26%(OR2 vs OR1)** `[벤더]`. 게다가 **OR1/OR2는 RI/NURI 적격**이라, hot을 작게 만들어 OR로 옮긴 뒤 그 작은 tier에 NURI를 얹는 조합이 가능. OR2 + Parquet 엔진은 스토리지 ~70%↓(단 새 도메인 필요) `[벤더]`.
- **Cold tier 함정**: OpenSearch cold storage도 rehydrate에 (할인 불가) UltraWarm 노드가 필요하다. cold 노드 대신 **S3 Direct Query(zero-ETL)** 또는 컬럼나+S3로 tail을 빼는 게 낫다.

- **장점**: 풀텍스트 검색·집계 성숙도, Kibana/Dashboards·SIEM 플러그인, 관리형 운영.
- **단점**: 로그 저장 목적 대비 과한 비용 구조, 노드 상시 가동 전제, UltraWarm 영구 온디맨드.

> 판단: 90일 보존이 정말 필요한지부터 되묻는다. 절감의 대부분은 **보존 tail을 컬럼나+S3로 이전 + hot 축소·OR 이전**에서 나온다. UltraWarm 8대(연 ~$188K 고정)를 컬럼나+S3 tail로 대체하면, 대체 비용(~$24–48K/yr) 차감 후 **순 ~$140K+/yr 절감**(hot RI 최대 절감 ~$100K/yr를 압도).
