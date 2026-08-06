---
title: "플랫폼 선례 해부 — 그들은 왜 링을 쓰는가"
linkTitle: "03 플랫폼 선례"
weight: 3
---

# 03 · 플랫폼 선례 해부 — 그들은 왜 링을 쓰는가

{{< callout type="info" >}}
**한눈에**
- **링을 쓰는 이유는 다섯 시스템이 전부 다르다.** "분산 시스템이니까 링"이 아니라, 각자 **못 피한 제약 하나**를 링으로 우회한 것이다. 그 제약이 우리에게 없으면 링도 필요 없다.
- **Loki/Mimir ingester가 링을 쓰는 진짜 이유는 쿼리다.** flush 전 chunk가 그 파드 메모리에만 있어서 **querier가 그 파드를 찾아가야 한다.** 링은 "누가 갖고 있나"를 O(1)로 답하는 주소록이고, 부하 분산은 부수 효과다.
- **vmagent는 링을 쓰지 않는다.** `hash(target) % membersCount`이고 `memberNum`은 플래그로 고정된다. **멤버십을 알지 못하고, 죽은 멤버의 몫을 아무도 인수하지 않는다** — 대신 `replicationFactor`로 미리 중복 스크랩해 덮는다.
- **Alloy는 반대를 택했다.** consistent hashing으로 노드당 512 토큰을 돌리고, 문서가 트레이드오프를 명시한다 — hashmod는 *fully consistent*지만 재분배가 전량이고, consistent hashing은 이동이 1/N이지만 ***eventually consistent***다. **"eventually"가 곧 일시적 중복 소유**이고, 이게 분기 B의 최대 위험이다.
- **Promtail은 분배 문제를 배치로 없앴다.** DaemonSet으로 노드마다 하나 두면 "누가 무엇을 맡나"가 질문조차 되지 않는다. **우리 분기 A에서 로드밸런서가 하는 역할이 정확히 이것이다.**
- **Thanos compactor는 링을 안 쓰고 상호배제를 사람에게 떠넘긴다.** *"you need to ensure on your own that only a single Compactor is running against a single stream"* — 이것이 링의 한계를 가장 정직하게 드러낸 문장이다. **링은 배정을 나눌 뿐 상호배제를 보장하지 않는다.**
- **판정 축은 셋이다** — ① 휘발성 상태가 파드 메모리에 있는가, ② 죽은 멤버의 몫을 인수해야 하는가, ③ 중복 소유가 사고인가. 우리 워크로드는 ①에 아니오, ②는 분기에 따라, ③은 분기 B에서만 예다.
{{< /callout >}}

> **왜 이 문서인가.** "Loki도 링을 쓰니 우리도 링"은 근거가 아니다. 이 문서는 다섯 시스템에서 **링을 채택하게 만든 제약**을 하나씩 뽑아내고, 그 제약이 POS 게이트웨이에 있는지를 대조한다. 결론을 먼저 말하면 — **분기 A에는 다섯 개 중 어느 제약도 없다.** 검증 기준: 각 프로젝트 공식 문서와 CLI 플래그 정의.

## 1. Loki / Mimir ingester — 링은 주소록이다

**구조.** distributor가 스트림(테넌트 ID + 레이블 집합)을 해시해 링에서 ingester를 고르고, 복제 인수만큼 복제해 보낸다. ingester는 받은 로그를 메모리에서 chunk로 쌓다가 조건이 되면 오브젝트 스토리지로 flush한다.

**링을 쓰게 만든 제약.** flush되기 전 데이터는 **그 ingester의 메모리에만 있다.** Loki 문서가 querier를 이렇게 설명한다 — querier는 *"fetches log data from both the ingesters and from long-term storage"*, 즉 **최근 데이터를 얻으려면 그것을 들고 있는 ingester를 직접 찾아가야 한다.**

그래서 링의 1차 용도는 부하 분산이 아니라 **주소 지정**이다. "이 스트림의 미flush 데이터는 어느 파드에 있나"를 쓰기 측과 읽기 측이 **같은 함수로** 답할 수 있어야 하고, 그 합의 구조가 링이다.

**딸려오는 것들.** 메모리에 미flush 데이터가 있으므로 프로세스가 죽으면 그게 날아간다. 그래서 WAL이 붙는다 — *"the ingester now includes a write ahead log (WAL) which persists incoming writes to disk to ensure they are not lost."* WAL은 디스크를 요구하고, 디스크는 PVC를 요구하고, PVC는 **StatefulSet을 요구한다.** 그리고 재시작 시 같은 링 토큰을 되찾아야 WAL이 의미가 있으므로 안정적 ID도 필요하다.

**멤버십.** [Mimir는 기본값이 memberlist(gossip)](https://grafana.com/docs/mimir/latest/references/architecture/memberlist-and-the-gossip-protocol/)다 — *"each instance maintains a copy of the hash rings and uses memberlist to propagate changes to other instances."* Consul·etcd로 바꿀 수도 있다. 어느 쪽이든 **멤버십을 실시간으로 알아야 한다.**

> **우리에게 이 제약이 있는가.** 없다. 재개 보장을 위해 이벤트를 파드 밖에 두기로 한 순간, **파드 메모리에 남는 휘발성 상태가 없어진다.** 그러면 주소록도, WAL도, StatefulSet도 이유를 잃는다.

## 2. vmagent — 링이 아니라 나눗셈, 그리고 인수 포기

**구조.** [vmagent 문서](https://docs.victoriametrics.com/victoriametrics/vmagent/)가 정의하는 플래그는 셋이다.

| 플래그 | 뜻 |
|---|---|
| `-promscrape.cluster.membersCount` | 그룹 총 인원 |
| `-promscrape.cluster.memberNum` | 내 번호 |
| `-promscrape.cluster.replicationFactor` | 같은 타깃을 몇 명이 중복 스크랩할지 |

각 인스턴스는 `hash(target) % membersCount`를 계산해 **자기 `memberNum`과 맞는 타깃만** 긁는다. Helm 차트는 `statefulSet.clusterMode`가 켜지면 `membersCount`를 `replicaCount`로 자동 주입한다.

**여기서 결정적인 것.** `membersCount`가 **플래그로 고정된 상수**라는 점이다. vmagent는 다른 멤버가 살아 있는지 죽었는지를 **알지 못하고, 알 필요도 없게 설계됐다.** 파드 3번이 죽으면 3번이 맡던 타깃은 **그냥 안 긁힌다.**

그 구멍을 메우는 것이 `replicationFactor`다. 2로 두면 모든 타깃을 두 인스턴스가 중복 스크랩하고, 하나가 죽어도 나머지가 이미 긁고 있다. 대신 원격 저장소에서 **중복 제거가 필수**가 된다 — 문서가 `-dedup.minScrapeInterval`을 `scrape_interval`과 맞추라고 못박는다.

**이것은 놀랍도록 값싼 설계다.** 멤버십 발견도, gossip도, 코디네이터도 없다. 대가는 두 가지 — 중복 작업을 상시로 감수하고, 결과를 뒤에서 dedup할 수 있어야 한다.

> **우리에게 쓸 수 있는가.** 분기 B라면 **못 쓴다.** "죽은 파드의 몫을 살아있는 파드가 주워간다"가 요구사항인데 이 방식은 정확히 그것을 포기한 방식이다. 그리고 중복 다이얼은 dedup으로 덮을 수 있는 종류의 중복이 아니다 — 단말에 같은 명령이 두 번 간다.

## 3. Alloy — consistent hashing의 대가를 문서가 직접 말한다

[Alloy clustering](https://grafana.com/docs/alloy/latest/configure/clustering/distribute-prometheus-scrape-load/)은 vmagent와 정반대를 택했다. `clustering { enabled = true }` 한 블록이면 `prometheus.scrape` 컴포넌트들이 **consistent hashing으로 타깃 소유권을 나눈다.** 노드당 512 토큰을 링에 올린다.

문서의 트레이드오프 문장이 이 도메인 전체에서 가장 중요한 인용이다.

> *"When a node joins or leaves the cluster, every peer recalculates ownership and continues scraping with the new target set. This performs better than hashmod sharding where all nodes have to be re-distributed, as only 1/N of the targets ownership is transferred, **but is eventually consistent (rather than fully consistent like hashmod sharding is)**."*

두 가지를 동시에 말하고 있다.

1. **이동량**: hashmod(`% N`)는 인원이 바뀌면 거의 **전량 재배정**된다. consistent hashing은 **1/N만** 움직인다.
2. **일관성**: 그 대가로 **eventually consistent**다. 멤버십 변화가 전파되는 동안 피어들의 뷰가 갈리고, **잠깐 두 노드가 같은 타깃을 자기 것이라 믿는 구간이 생긴다.**

메트릭 스크랩에서 2번은 중복 샘플 몇 개로 끝난다. **POS에 명령을 미는 게이트웨이에서는 같은 명령의 이중 전송이다.** 성질이 다르다.

> **판정.** 분기 B에서 consistent hashing을 쓰더라도, **eventual consistency 구간의 중복을 링이 막아주지 않는다.** 막으려면 §5의 lease가 별도로 필요하다.

## 4. Promtail / DaemonSet — 분배 문제를 배치로 없앤다

Promtail은 노드의 로컬 파일을 tail한다. 배포 형태가 DaemonSet이므로 **노드마다 정확히 하나**가 뜨고, 각 인스턴스는 **자기 노드의 파일만** 본다.

"누가 무엇을 맡나"라는 질문이 **아예 발생하지 않는다.** 링도, 샤딩도, 멤버십도 없다. 배치 토폴로지가 소유권을 정의해버렸기 때문이다.

> **우리 분기 A가 정확히 이 형태다.** 로드밸런서가 인바운드 연결을 파드에 꽂는 순간 소유권이 정해지고, 파드는 자기에게 꽂힌 것만 본다. **분배 알고리즘을 우리가 만들지 않는 이유는 이미 만들어져 있기 때문이다.** Promtail이 DaemonSet에 위임한 것을 우리는 L4/L7 로드밸런서에 위임한다.

## 5. Thanos compactor — 링의 한계를 가장 정직하게 말하는 곳

Thanos compactor는 오브젝트 스토리지의 블록을 병합한다. 수평 확장은 **`--selector.relabel-config-file`로 external label을 걸러 스트림을 나누는 정적 샤딩**이고, 링이 없다.

그리고 [문서](https://thanos.io/tip/components/compact.md/)가 이렇게 못박는다.

> *"Only one instance of Compactor may run against a single stream of blocks in a single object storage, and because **not all object storage providers implement a safe locking mechanism, you need to ensure on your own** that only a single Compactor is running against a single stream of blocks on a single bucket."*

이 한 문단이 두 가지를 말한다.

- **중복 실행이 데이터 손상으로 이어지는 작업에서는, 소유권 분배 알고리즘만으로 부족하다.** 상호배제는 별개의 메커니즘이다.
- 안전한 락이 없으면 **결국 사람이 보장해야 한다** — 즉 자동화할 수 없는 구간이 남는다.

**링은 "누가 맡을지"에 대한 합의를 만들 뿐, "동시에 둘이 맡지 않음"을 보장하지 않는다.** §3의 eventual consistency와 정확히 같은 이야기다.

## 6. Kafka consumer group — 사용자가 그린 그림의 성숙한 원형

"대상을 링으로 나눠 갖고, 죽은 멤버의 몫을 남은 멤버가 잘라 가져간다"는 그림에 가장 가까운 실제 시스템은 링 기반 스토리지가 아니라 **Kafka consumer group**이다.

- 파티션이 처리 단위, 컨슈머가 멤버
- **그룹 코디네이터**(브로커)가 멤버십을 관리한다 — gossip이 아니라 중앙 조정자
- 멤버가 세션 타임아웃 내에 하트비트를 못 보내면 **rebalance가 발동**하고 그 몫이 재배정된다
- rebalance 중에는 **모든 멤버가 일단 소유권을 놓는다**(eager) 또는 겹치지 않는 부분만 유지한다(cooperative)

핵심은 **"일단 놓고 다시 받는다"**는 규약이다. 이것이 §3의 중복 소유 구간을 없애는 정공법이다 — 이동량을 줄이는 대신, **재배정 순간에 소유권 공백을 만들어 중복을 원천 차단한다.**

> **분기 B를 설계한다면 링보다 이쪽이 참고 원형이다.** 중복이 사고인 도메인에서 검증된 방식은 "겹치지 않게 잘 나누기"가 아니라 "겹칠 바에 잠깐 비운다"다.

## 7. 축 세 개로 정리

| 시스템 | 소유권 분배 | 멤버십을 아는가 | 죽은 몫 인수 | 중복 소유 대응 |
|---|---|---|---|---|
| **Loki / Mimir ingester** | consistent hash ring | ✅ memberlist·Consul·etcd | ✅ (복제 인수로) | 복제 전제 — 중복이 정상 |
| **vmagent** | `hash % membersCount` | ❌ **플래그 상수** | ❌ **포기** | `replicationFactor` + 저장소 dedup |
| **Alloy** | consistent hash ring (512 토큰) | ✅ gossip | ✅ | **eventually consistent — 일시 중복 허용** |
| **Promtail** | 없음 (DaemonSet) | — | — | 발생 불가 |
| **Thanos compactor** | 정적 relabel 샤딩 | ❌ | ❌ | **운영자 책임** |
| **Kafka consumer group** | 코디네이터 배정 | ✅ 중앙 코디네이터 | ✅ rebalance | **소유권 공백으로 차단** |

여기서 판정 축 셋이 나온다.

**① 휘발성 상태가 파드 메모리에 있는가** → 있으면 주소록(링)이 필요하다. 없으면 필요 없다.
**② 죽은 멤버의 몫을 인수해야 하는가** → 인수해야 하면 **멤버십을 실시간으로 알아야 한다**(gossip 또는 코디네이터). 인수를 포기할 수 있으면 나눗셈으로 끝난다.
**③ 중복 소유가 사고인가** → 사고면 링만으로 부족하고 **lease 또는 소유권 공백 규약**이 추가로 필요하다.

## 8. 우리 워크로드 대조

| 축 | **분기 A** — POS가 건다 | **분기 B** — pod가 건다 |
|---|---|---|
| ① 파드 메모리의 휘발성 상태 | **없음** — 이벤트는 Redis, 소켓은 상태가 아니라 자원 | 없음 (동일) |
| ② 죽은 몫 인수 | **불필요** — POS가 재접속하고 LB가 재분배 | **필수** — 아무도 안 걸면 그 단말은 영원히 끊긴다 |
| ③ 중복 소유 | 발생 불가 — 단말이 한 곳에만 연결 | **사고** — 같은 명령 이중 전송 |
| **결론** | **링 불필요.** Promtail형(배치가 곧 소유권) | **링 + lease 필요.** Kafka형(공백 규약) |

①이 두 분기 모두 "없음"이라는 점이 중요하다. **Loki/Mimir가 링을 쓰는 이유는 우리에게 아예 없다.** 분기 B에서 링이 필요해지는 이유는 ②와 ③이고, 그건 *상태* 때문이 아니라 *능동적 소유권* 때문이다. 링을 도입하더라도 **Loki가 아니라 Kafka를 베껴야 한다는 뜻이다.**

각 분기의 실제 설계는 [04]({{< relref "04-branch-a-client-dials/index.md" >}})와 [05]({{< relref "05-branch-b-pod-dials/index.md" >}})로 넘어간다.
