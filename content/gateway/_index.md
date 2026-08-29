---
title: "커넥션 게이트웨이"
weight: 140
cascade:
  type: docs
---

# 커넥션 게이트웨이 — 링이 필요한 순간과 필요 없는 순간

{{< callout type="info" >}}
- **링이 필요한지는 규모가 아니라 "누가 연결을 거느냐"가 정합니다.** 클라이언트가 걸면 로드밸런서가 소유권을 이미 정해버려서 파드끼리 나눌 것이 없습니다. 파드가 걸어야 소유권이 파드들의 문제가 되고 그때 비로소 링이 값을 합니다.
- **재개 보장(Last-Event-ID)을 요구하는 순간 링이 필요할 이유는 대부분 사라집니다.** 이벤트가 파드 밖에 남아야 하니 "이 단말의 상태를 누가 들고 있나"를 물을 일이 없어집니다. Loki ingester가 링을 쓰는 것도 팬아웃 때문이 아닙니다. **flush 전 chunk가 그 파드 메모리에만 있어서**입니다.
- **API Gateway WebSocket API의 `Connection duration for WebSocket API: 2 hours`는 상향할 수 없습니다**([공식 쿼터 표](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-execution-service-websocket-limits-table.html)). 상시 연결을 전제하는 POS 워크로드와 여기서 어긋납니다.
- **비용은 떠나는 이유가 못 됩니다.** 5만 대를 한 달 내내 붙여둬도 connection-minutes는 2,160M × $0.25 = **월 $540** 수준입니다. "API GW가 비싸서"로 논거를 세우면 검토가 첫 질문에서 무너집니다.
- **`hash % membersCount`는 링이 아닙니다.** vmagent가 쓰는 방식이 바로 이것입니다([문서](https://docs.victoriametrics.com/victoriametrics/vmagent/)). **죽은 멤버의 몫은 아무도 인수하지 않고** 대신 `replicationFactor`로 미리 중복 스크랩해 덮습니다. "죽은 몫을 살아있는 파드가 주워간다"는 요구가 있으면 이 방식은 못 씁니다.
- **링은 배정을 나눌 뿐 상호배제를 보장하지 않습니다.** Thanos 문서가 *"not all object storage providers implement a safe locking mechanism, you need to ensure on your own that only a single Compactor is running against a single stream"*라고 명시하는 이유입니다([compact.md](https://thanos.io/tip/components/compact.md/)). 중복 실행이 사고가 되는 설계라면 링 위에 lease가 따로 필요합니다.
- **커넥션 게이트웨이 자체는 Deployment로 충분합니다.** StatefulSet은 "안정적 ordinal이 샤드 배정을 고정한다"는 값을 줄 때만 의미가 있고 그 값은 파드가 거는 분기에서만 생깁니다.
- **SSE에는 WebSocket에 없는 표준 필드가 하나 있습니다 — `retry:`.** 종료 직전에 커넥션마다 jitter를 섞어 재연결 지연을 지정할 수 있습니다. 5만 대 재접속 폭풍을 프로토콜 레벨에서 분산하는 유일한 수단입니다.
{{< /callout >}}

**왜 이 도메인인가.** 출발점은 "POS 단말 1만~5만 대에 중앙에서 푸시하는 게이트웨이를 Kotlin으로 만들고, AWS API Gateway WebSocket에서 자체 SSE로 옮긴다"는 구체적 과제입니다. 그런데 이 과제에서 나오는 질문 — *파드들끼리 어떻게 상태를 나눠 갖나, 죽은 파드의 몫은 누가 줍나, StatefulSet이어야 하나* — 은 관측성 스택들이 이미 각자 다른 답을 낸 문제입니다. 이 도메인에서는 **그 답들이 각각 어떤 전제 위에 서 있는지를 먼저 해부하고 그 전제가 우리에게 있는지를 판정합니다.** 링을 만들기 전에 링이 필요한지부터 따지는 것이 목적입니다.

## 이 도메인이 다루는 워크로드

| 항목 | 값 |
|---|---|
| 단말 | POS, 매장 상주 |
| 동시 연결 | 1만~5만 |
| 흐름 방향 | 중앙 → 단말 **일방** (단말 → 중앙은 별도 REST) |
| 전송 | SSE (전환 대상), 현행 API Gateway WebSocket API |
| 전달 보장 | **재개 보장** — 재접속 시 `Last-Event-ID` 이후부터 |
| 상태 | 파드에 저장하지 않음. 필요하면 Redis까지 |
| 런타임 | Kotlin, Kubernetes 파드 |

## 미결 분기 — 이 도메인 전체의 뼈대

**POS가 중앙에 거는가, 중앙이 POS에 거는가.** 이 하나가 나머지를 전부 결정합니다.

| | **분기 A** — POS가 건다 | **분기 B** — pod가 건다 |
|---|---|---|
| 커넥션 소유권 | 로드밸런서가 정한다 (파드는 못 고름) | **파드끼리 합의해야 한다** |
| 파드 사망 시 | POS가 알아서 재접속 | **생존 파드가 몫을 인수해야 한다** |
| 중복 방지 | 불필요 | 필수 — 두 파드가 같은 POS에 걸면 안 됨 |
| 링 | **불필요** | **필수** |
| 닮은 선례 | Loki ingester · API Gateway | vmagent 스크랩 샤딩 · Thanos compactor |
| k8s 형태 | Deployment | StatefulSet 검토 대상 |
| 전송 | SSE 그대로 | SSE는 방향이 안 맞음 — 재검토 |

판정법은 [02]({{< relref "02-connect-direction.md" >}})에 있고 **현행 API Gateway 접속 로그의 소스 IP 한 번이면 끝납니다.**

## 문서 지도

- **[01 문제의 형태 — API Gateway를 떠나는 진짜 이유]({{< relref "01-problem-shape.md" >}})** · 2시간 강제 종료·10분 idle·32KB 프레임이 각각 무엇을 강제하는가. 비용 논거가 왜 성립하지 않는지, SSE와 WebSocket 중 무엇이 이 워크로드에 맞는지.
- **[02 수립 방향이라는 분기점]({{< relref "02-connect-direction.md" >}})** · 연결 수립 방향과 데이터 흐름 방향은 별개입니다. 두 분기가 각각 무엇을 강제하는지, 그리고 어느 쪽인지 판정하는 체크리스트.
- **[03 플랫폼 선례 해부 — 그들은 왜 링을 쓰는가]({{< relref "03-platform-precedents.md" >}})** · Loki/Mimir ingester ring, vmagent 샤딩, Thanos compactor 샤딩, memberlist vs 외부 KV. **각각의 전제**를 뽑아내고 우리에게 그 전제가 있는지 대조합니다.
- **[04 분기 A — POS가 건다]({{< relref "04-branch-a-client-dials/index.md" >}})** · Redis Streams 샤드 pull 설계 전문. Stream ID = `Last-Event-ID` 직결, 읽기 증폭 공식과 탈출 임계, 재개 창 계약, 레지스트리 방식으로 넘어가는 조건.
- **[05 분기 B — pod가 건다]({{< relref "05-branch-b-pod-dials/index.md" >}})** · 배정 링 설계. `hash % N` vs consistent hashing, 멤버십을 어떻게 아는가, 중복 다이얼 방지, 사망 파드 몫 인수, 리밸런싱 폭풍 억제.
- **[06 k8s 형태 판정]({{< relref "06-k8s-shape.md" >}})** · Deployment / StatefulSet / headless service를 분기별로 결론짓습니다. graceful shutdown, PDB, HPA 지표, LB idle timeout과 프록시 버퍼링.
- **[07 Kotlin 구현 노트]({{< relref "07-kotlin-notes.md" >}})** · WebFlux vs Ktor, 커넥션당 실제 비용, 느린 소비자 처리, Lettuce 스레드 모델, 하트비트.

자매 문서: [Valkey / 2,000노드에서 부러지는 것]({{< relref "../valkey/cluster-xl-scale/01-부러지는-것/index.md" >}}) — 재접속 폭풍이 실제로 무엇을 먼저 부러뜨리는지 실측한 결과가 거기 있습니다. · [Istio]({{< relref "../istio/_index.md" >}}) — xDS 커넥션 재분배는 같은 문제의 컨트롤플레인판입니다.
