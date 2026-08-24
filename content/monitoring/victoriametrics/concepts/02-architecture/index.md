---
title: "아키텍처"
weight: 2
aliases: ["/monitoring/victoriametrics/02-architecture/"]
---

# 02 · 아키텍처 — 4개 컴포넌트와 저장 원리

{{< callout type="info" >}}
- VM 클러스터는 vmagent(수집) → vminsert(라우팅·샤딩) → vmstorage(저장, n노드) → vmselect(fanout+merge 쿼리) 4컴포넌트로 흐릅니다.
- 배포 모드는 SingleNode(간편, SPOF)와 Cluster(수평확장, `replicationFactor`로 유실 방지) 둘입니다. vminsert/vmselect는 stateless라 k8s에, vmstorage는 stateful이라 물리 장비에 두는 편이 유리합니다.
- 대용량 write와 read를 함께 만족시키는 자료구조가 LSM 트리(append로 빠른 write, 정렬 유지로 빠른 read, merge는 백그라운드)입니다. VM의 파티션 구조가 이 구체화입니다.
- IndexDB(거의 불변, 지표이름+레이블 역색인)와 DataDB(TSID → timestamp+value, 계속 쌓임)를 나눠 두면 정규화 효과로 압축 효율이 크게 올라갑니다.
{{< /callout >}}

여기서는 VM 클러스터를 이루는 컴포넌트, 그 사이를 흐르는 데이터, 그 아래를 떠받치는 두 아이디어 — LSM 트리와 IndexDB/DataDB 분리 — 를 정리합니다. 컴포넌트 하나하나의 내부 동작은 뒤 문서에서 따로 깊게 파고듭니다.

> 관련 문서: [01 시계열과 VM]({{< relref "01-tsdb-and-victoriametrics.md" >}}) · [03 수집]({{< relref "03-ingestion.md" >}}) · [04 저장과 압축]({{< relref "04-storage-and-compression.md" >}}) · [05 쿼리·운영 컴포넌트]({{< relref "05-query-and-ops-components.md" >}}) · [실전 02 대규모 운영]({{< relref "../../practice/02-operations-at-scale.md" >}})

## 4개 컴포넌트의 데이터 흐름

VM 클러스터 버전은 컴포넌트 4개로 짜입니다. 대규모·고가용성(HA) 환경이라면 SingleNode 대신 이 클러스터 버전을 씁니다. 데이터가 들어가는 길은 왼쪽 → 오른쪽, 빠지는 길은 오른쪽 → 왼쪽입니다. 둘을 하나의 흐름으로 겹쳐 보면 이렇게 됩니다.

{{< flow src="_flow/4-개-컴포넌트의-데이터-흐름.json" />}}

한 줄 역할 요약:

- vmagent — 타깃에서 지표를 스크랩하고 릴레이블·드랍 같은 1차 가공까지 맡는 수집 컴포넌트입니다. → [03 수집]({{< relref "03-ingestion.md" >}})
- vminsert — 받은 데이터를 여러 vmstorage 노드로 라우팅·샤딩하는 수집 게이트웨이입니다. → [03 수집]({{< relref "03-ingestion.md" >}})
- vmstorage — 저장을 실제로 책임집니다. 월별 파티션 단위로 데이터를 두고 vmselect의 쿼리에 응답합니다. → [04 저장과 압축]({{< relref "04-storage-and-compression.md" >}})
- vmselect — 쿼리 엔진입니다. 들어온 쿼리를 모든 vmstorage에 던지고(Fanout) 돌아온 결과를 모아(Merge) 클라이언트에 반환합니다. → [05 쿼리·운영 컴포넌트]({{< relref "05-query-and-ops-components.md" >}})

여기에 운영용 컴포넌트인 vmalert(지표 선계산)와 vmauth(라우팅/인증 게이트웨이)가 더해집니다. 이 둘은 [05 쿼리·운영 컴포넌트]({{< relref "05-query-and-ops-components.md" >}})에서 다룹니다.

## SingleNode vs Cluster

배포 모드는 SingleNode와 Cluster입니다. 네이버 검색 SRE도 처음엔 SingleNode로 시작했다가 클러스터로 옮겨 갔습니다.

**SingleNode**

- 구성 — 바이너리 파일 하나에 모든 기능이 들어 있습니다.
- 장점 — 구축·사용이 간편합니다. VM 자체 최적화로 Prometheus보다 빠른 성능을 체감합니다.
- 단점 — 수천만 개 이상으로 늘면 단일 장비로 감당이 안 됩니다. 그 단일 장비가 SPOF(단일 장애점)입니다.

**Cluster**

- 구성 — write/read/storage 3역할을 vminsert·vmselect·vmstorage로 분리합니다.
- 장점 — 데이터 규모에 맞춰 컴포넌트만 추가하면 수평 확장(scale out)이 손쉽습니다. Prometheus의 최대 약점인 scale out 한계를 여기서 넘어섭니다. `replicationFactor`로 유실을 방지합니다.
- 단점 — 구조가 복잡하고 운영이 어렵습니다. 의존성은 Thanos·Cortex보다 적은 편입니다.

운영 방식은 컴포넌트 성격에 따라 달라집니다. Stateless 컴포넌트인 vminsert(write)·vmselect(read)는 Kubernetes에 올려 유연하게 scale out합니다. Stateful 컴포넌트인 vmstorage는 물리 장비에서 운영하는 편이 유리합니다. 이 구성이 초대규모에서 어떻게 확장되는지는 [실전 02 대규모 운영]({{< relref "../../practice/02-operations-at-scale.md" >}})에서 다룹니다.

## 왜 대용량 write/read가 어려운가 — LSM 트리

수천만 개의 시계열을 처리한다고 가정해 보겠습니다. 모니터링 시스템의 수집 주기는 15초·30초·1분처럼 짧습니다. 매 주기마다 수천만 개의 새 데이터가 한꺼번에 유입됩니다. 이걸 그때그때 다 써야 하니 빠른 대용량 write 성능이 필요합니다. 모든 지표를 계속 감시하다 이상이 보이면 즉시 경보해야 하므로 새로 들어온 데이터를 매번 다시 읽는 빠른 대용량 read 성능도 필요합니다.

두 요구는 소박하게 접근하면 서로 충돌합니다.

- write를 edit(수정) 방식으로 접근하면 대용량 처리가 어렵습니다. → append 위주 연산으로 써서 상수 시간(O(1)) 안에 처리되게 만듭니다.
- read를 랜덤 액세스로 찾으면 너무 느립니다. → 항상 정렬된 상태를 유지해 서브리니어 타임에 조회되게 만듭니다.

두 특성을 모두 만족시키는 자료구조가 LSM 트리(Log-Structured Merge Tree)입니다. HBase, Cassandra 같은 NoSQL DB도 쓰는 구조입니다. 동작은 다음과 같습니다.

```
[write]  스트림 유입 ─▶ 메모리에서 작은 조각 단위로 빠르게 정렬
                     ─▶ 주기적으로 파일로 flush (여기서 write는 끝)
                     ─▶ 백그라운드에서 정렬된 조각들을 merge → 점점 큰 파일로

[read]   이미 정렬돼 있으므로 이진 탐색으로 조회
         흩어진 여러 파일을 열어야 하는 단점 → Bloom filter로 완화
```

정렬은 작은 조각에서 미리 해 두고 조각을 합치는 merge는 백그라운드로 미룹니다. 이미 정렬된 조각들을 합치는 것이라 merge 비용도 높지 않습니다. 각 조각은 불변(immutable) 상태를 유지합니다. 그래서 append 위주 write와 정렬 유지 read를 둘 다 고성능으로 얻습니다. VM의 파티션 구조(인메모리 → Small → Big 머지)가 바로 이 LSM 트리의 구체화입니다(→ [04 저장과 압축]({{< relref "04-storage-and-compression.md" >}})).

## IndexDB / DataDB 분리 — 정규화 관점

유입되는 모니터링 데이터는 Time Series name, Unix timestamp, value 세 값입니다. 이걸 그대로 한 테이블에 저장할 수도 있지만 VM은 두 저장 공간으로 분리합니다.

| 저장 공간 | 담는 것 | 성질 |
|---|---|---|
| **IndexDB** | Time Series name(지표 이름 + 레이블 집합) | **거의 변하지 않는다** |
| **DataDB** | timestamp + value | **계속 쌓인다** |

이 분리는 일종의 DB 정규화입니다. 성질이 다른 데이터를 나눠 두면 각각에 맞는 압축이 가능해 압축 효율이 극단적으로 좋아집니다. 변하지 않는 이름은 매 샘플마다 반복 저장하지 않습니다. timestamp+value는 [01]({{< relref "01-tsdb-and-victoriametrics.md" >}})에서 예고한 Gorilla 계열 차분 압축으로 눌러 담습니다.

동작을 좀 더 보면:

- DataDB 쪽 — Time Series name마다 TSID(Time Series ID)를 하나 발급합니다. timestamp+value는 그 TSID에 매칭되는 공간에 차곡차곡 append합니다.
- IndexDB 쪽 — Time Series name을 레이블 단위로 뜯어 역색인(inverted index)을 만듭니다. 어떤 레이블 값으로 검색하든 원하는 시계열을 빠르게 찾으려는 장치입니다. 처음 보는 시계열이 들어올 때는 역색인을 새로 만드는 slow insert가 일어납니다. 같은 시계열의 추가 데이터는 TSID만 확인하는 fast insert로 처리됩니다.

TSID 변환·캐시와 역색인의 상세는 [04 저장과 압축]({{< relref "04-storage-and-compression.md" >}}), New TSID로 인한 카디널리티 폭발은 [실전 01 카디널리티]({{< relref "../../practice/01-cardinality.md" >}})에서 다룹니다.

## "거대하고 빠른 키-밸류 스토어"라는 추상화

한 발 물러서서 보면 IndexDB와 DataDB는 결국 둘 다 LSM 트리 형태의 거대하고 빠른 키-밸류 스토어입니다. IndexDB는 "레이블 → 시계열" 매핑을 담고 DataDB는 "TSID → (timestamp, value) 시퀀스"를 담습니다. append로 빠르게 쓰고 정렬로 빠르게 읽는 거대한 키-밸류 스토어 두 개 — VM의 저장 계층은 이 한 문장에 다 들어갑니다. 이 추상화를 쥐고 있으면 뒤 문서의 압축·파티션·쿼리 이야기가 전부 "이 키-밸류 스토어를 어떻게 더 잘게 눌러 담고 더 빠르게 뒤지느냐"의 변주로 읽힙니다.

## 출처

- Inside VictoriaMetrics (강민구, NAVER · 40:37) — `00:55~05:58` 아키텍처 오버뷰, 4컴포넌트 데이터 흐름, 클러스터/HA. `16:46~17:58` Time Series/Sample 분리와 IndexDB/DataDB 근거. https://d2.naver.com/helloworld/9290861
- VictoriaMetrics: 시계열 데이터 대혼돈의 멀티버스 (DEVIEW 2023, 손주식·이선규 · 33:50) — `06:11~14:52` IndexDB/DataDB 분리(정규화·역색인·TSID), 대용량 write/read 요구, LSM 트리(append 상수시간·정렬 서브리니어·merge·Bloom filter), "거대하고 빠른 키-밸류 스토어" 추상화. `20:40~22:06` SingleNode vs Cluster, Stateless/Stateful 운영. https://youtu.be/OUyXPgVcdw4
- 골격: `chapter9/victoriametrics.md` §2 · §4.1.
