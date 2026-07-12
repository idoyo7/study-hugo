---
title: "수집 (vmagent·vminsert)"
weight: 3
---

# 03. 수집 — vmagent와 vminsert

VM에서 데이터가 들어오는 두 관문을 다룬다. **vmagent**는 무엇이든 받아 정제하고 리모트로 흘려보내는 만능 어댑터이자 버퍼이고, **vminsert**는 그 데이터를 여러 vmstorage 노드로 흩뿌리는 라우팅 게이트웨이다.

> 관련 블록: [02 아키텍처]({{< relref "02-architecture.md" >}}) · [04 저장·압축]({{< relref "04-storage-and-compression.md" >}}) · [05 쿼리·운영 컴포넌트]({{< relref "05-query-and-ops-components.md" >}}) · [06 카디널리티]({{< relref "06-cardinality.md" >}}) · [07 초대규모 운영]({{< relref "07-operations-at-scale.md" >}})

## vmagent — 무엇이든 받아서 정제하는 만능 어댑터

vmagent는 지표 **수집**과 **1차 가공**을 책임진다. 내부에는 deduplicator, relabeling, streaming aggregation, scraper, queue 같은 모듈이 함께 들어 있다.

### 입력 프로토콜의 다양성

입력 쪽이 대단히 넓다. 모니터링 진영에서 쓰이는 거의 모든 프로토콜을 받는다.

- **OpenTelemetry**, **InfluxDB**(라인 프로토콜), **Datadog**, **Graphite**, **Prometheus**(agent), **NewRelic**, **JSON**, **CSV** 등.
- `node_exporter`나 애플리케이션의 `/metrics` 엔드포인트에서 직접 스크랩도 한다.

출력은 단일하다. **`remote_write` 프로토콜**로 VM 본체(vminsert)나 다른 Prometheus 호환 스토리지로 보낸다. 한마디로 vmagent는 **"무엇이든 받아서 정제하고 `remote_write`로 내보내는 만능 어댑터"** 다.

### Pull(스크랩) vs Push

수집 방식은 두 가지를 모두 지원한다.

- **Pull (스크랩 / 폴링)**: Prometheus와 동일하다. `scrape.config` 파일에 스크랩 대상을 두면 주기적으로 익스포터를 찔러 지표를 가져온다. **보통 이쪽이 메인**이다.
- **Push**: 스크랩과 반대로 외부에서 vmagent로 직접 데이터를 밀어 넣는다. 예를 들어 InfluxDB 라인 프로토콜로 `/write` 엔드포인트에 한 줄짜리 지표를 보낸다.

```
# Push 예시 — InfluxDB 라인 프로토콜
curl -XPOST 'http://vmagent/write' \
  --data-binary 'cpu_usage,host=server1,region=kr-central value=72.5'
```

Push는 폐쇄망, 푸시만 가능한 환경, 또는 배치 잡 같은 **단발성 지표**에 주로 쓰인다.

### 내부 7단계 파이프라인

스크랩되거나 푸시된 데이터가 vmagent 안에서 거치는 경로는 7단계다.

```
1. 스크랩 & API 수신
2. 글로벌 릴레이블링(relabeling)
3. dedup + 스트리밍 어그리게이션(streaming aggregation)
4. 샤딩 + 리플리케이션
5. 퍼-리모트 튜닝 (리모트별 별도 릴레이블/드랍/dedup)
6. Fast Queue(메모리) → 가득 차면 Persistent Queue(디스크)
7. 리모트 플러시 (실제 전송)
```

여기서 두 가지를 기억하자.

**릴레이블링이 두 번 걸린다.** 전 트래픽 공통 룰은 **글로벌 단계(2번)** 에서, 특정 리모트에만 적용할 룰은 **퍼-리모트 단계(5번)** 에서 처리한다. "공통 트래픽에 걸 규칙"과 "이 리모트에만 걸 규칙"을 티어별로 나눠 적용할 수 있어, 하나의 vmagent가 여러 목적지에 서로 다른 정제 정책을 태울 수 있다.

**큐는 유실 방지 안전장치다.** 데이터는 먼저 **Fast Queue(인메모리 큐)** 에 대기한다. 이 메모리 큐마저 가득 차면 **Persistent Queue(디스크)** 로 떨어져 임시 저장된다. 지연이 해소되면 디스크에서 다시 꺼내 전송한다. 덕분에 vminsert와의 네트워크 장애나 순간적 지연으로 잠시 전송하지 못하더라도 **vmagent는 지표를 잃지 않는다.** 운영 관점에서 이것이 데이터 유실을 막는 핵심 안전장치다. 실전에서도 SRE 파이프라인은 이 버퍼링 성질을 노려 vmagent를 유실 방지 계층으로 끼워 넣는다([07 초대규모 운영]({{< relref "07-operations-at-scale.md" >}})).

## vminsert — 랑데부 해싱으로 라우팅하는 게이트웨이

vminsert는 인제스천(ingestion) 파이프라인이자, 데이터를 여러 **vmstorage 노드로 라우팅하는 수집 게이트웨이**에 가깝다. 실제 저장은 하지 않고 "어느 노드로 보낼지"만 결정한다.

### vmstorage 연결 시퀀스 — 압축 협의

vminsert가 vmstorage에 붙을 때 다음 순서를 밟는다.

```
1. TCP 커넥션 수립
2. vminsert → vmstorage: "어떤 압축 방식을 쓸까?"  (압축 협의)
3. vmstorage → vminsert: "zstd로 하자"           (프로토콜 합의)
4. 협의된 압축 방식으로 지표 데이터 본격 전송
5. (백그라운드, 점선) 지속적 헬스 체크
```

압축 협의가 연결 초반에 들어간다는 점이 특징이다. 여기에 **`rpc.disableCompression`** 옵션이 있다. 켜면 전송 시 압축을 하지 않는다.

- **압축 On(기본)**: 대역폭 절약, CPU 소비 증가.
- **`rpc.disableCompression` On(압축 Off)**: **CPU는 절약되지만 대역폭이 늘어난다.**

즉 네트워크 밴드위스는 충분하고 CPU를 아끼고 싶은 환경이라면 압축을 끄는 트레이드오프가 성립한다.

### 랑데부 해싱 — 왜 단순 해시가 아닌가

수많은 vmstorage 중 어느 노드로 보낼지가 핵심 문제다. 단순 모듈로/해시를 쓰면 노드가 하나 추가·삭제될 때 **거의 모든 시계열**이 원래 노드가 아닌 다른 노드로 옮겨간다. 리밸런싱 폭풍이 일어난다. 그래서 VM은 **랑데부 해싱(Rendezvous hashing)** 을 쓴다.

원리는 간단하다. 지표 하나가 들어오면 **모든 스토리지 노드에 대해 점수를 매긴다.** 점수는 `"지표 이름 + 노드 이름"`을 합쳐 해시한 값이고, **가장 점수가 높은 노드에만** 보낸다.

```
metric: http_requests_total{method="get"}
  node A → 0.82
  node B → 0.45
  node C → 0.91   ← 최고 점수 → 여기로 전송
```

노드 D가 추가되면? 각 지표에 대해 **D의 점수만 새로 계산**해, D가 기존 최고 점수를 넘긴 지표만 D로 옮긴다.

```
[노드 D 추가 후 재계산]
  같은 metric의 D 점수 → 0.68  <  C의 0.91  → 그대로 C에 남음 (이동 없음)
  다른 metric의 D 점수 → 0.95  >  기존 최고  → D로 이동
```

기존 노드들끼리의 상대 점수는 변하지 않으므로, D보다 점수가 낮은 시계열은 자리를 지킨다. **통계적으로 노드가 N개일 때 새 노드를 하나 더하면 전체 중 약 1/(N+1)만 재배치**된다(3→4 노드면 약 1/4). 최소한의 시계열만 움직여 클러스터 확장 비용을 크게 낮춘다.

### 페일오버

vminsert는 앞서 본 헬스 체크로 각 vmstorage 상태를 계속 파악하고 있다. 노드가 다운되면 그 사실을 인지해, 그 노드로 갈 지표를 **살아있는 노드들에 균등 분배(re-route)** 한다. 예를 들어 노드 1·2·3 중 2번이 죽으면, 2번으로 갈 지표를 1번과 3번에 나눠 넣는다. 노드가 복구되면 랑데부 해싱 규칙에 따라 원래 배치로 돌아간다.

### replicationFactor — 복제

한 시계열을 한 노드에만 한 번 저장하면, 그 노드가 죽는 순간 데이터가 유실된다. 이를 막기 위해 **`replicationFactor`** 를 둔다.

`replicationFactor=N`으로 두면, 랑데부 해싱으로 뽑힌 최고 점수 노드(primary)뿐 아니라 **스토리지 노드 목록에서 뒤따르는 N-1개 노드에도 복사본을 저장**한다. 예를 들어 `replicationFactor=2`면 같은 지표 A가 서로 다른 두 노드에 Copy 1, Copy 2로 저장된다. 그래서 한두 개 노드가 다운돼도 데이터를 정상적으로 읽을 수 있다.

이렇게 같은 데이터가 여러 벌 생기지만, 중복은 나중에 vmselect가 쿼리할 때 **dedup(dedup min scrape interval)** 으로 제거된다. 즉 **쓰기 시점의 복제(안정성)** 와 **읽기 시점의 dedup(정확성)** 이 짝을 이뤄 동작한다. 쿼리 시점 dedup의 세부는 [05 쿼리·운영 컴포넌트]({{< relref "05-query-and-ops-components.md" >}})에서 다룬다.

> 저장된 데이터가 vmstorage 안에서 어떻게 TSID로 바뀌고 압축·파티셔닝되는지는 [04 저장·압축]({{< relref "04-storage-and-compression.md" >}})에서 이어진다. `New TSID`가 폭증하는 카디널리티 문제는 [06 카디널리티]({{< relref "06-cardinality.md" >}})가 주인이다.

## 출처

- `02_대사집_Inside_VictoriaMetrics.md`(강민구, Inside VictoriaMetrics) — vmagent 입력 프로토콜·pull/push·7단계 파이프라인·2단계 릴레이블·큐(05:00~11:00), vminsert 연결 시퀀스·`rpc.disableCompression`·랑데부 해싱·페일오버·replicationFactor(11:00~15:30).
- `01_대사집_..._멀티버스.md`(손주식·이선규, DEVIEW 2023) — 데이터 유입 3요소, vmagent 버퍼링을 통한 유실 방지 운영 맥락(06:00~08:00, 27:00~28:30).
- 골격: `chapter9/victoriametrics.md` §3.1~3.2.
