---
title: "존 하나가 멈춰도 버티는 Cassandra의 새 ring"
description: "여러 존에 노드를 나눈 Cassandra가 왜 존 하나의 장애에 취약했는지 짚습니다. Uber는 단일 rack 구성을 존별 rack을 갖춘 새 ring으로 바꾸고, 클라이언트 재시작 없이 트래픽을 옮겼습니다."
date: 2026-11-10
weight: 10
---

# 존 하나가 멈춰도 버티는 Cassandra의 새 ring (2024-06)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How Uber ensures Apache Cassandra®'s tolerance for single-zone failure](https://www.uber.com/us/en/blog/single-zone-failure-tolerance/)
- 매체 · 게시일: Uber Engineering Blog · 2024-06-20
- 저자: Gabriele Di Bernardo(전 Senior Software Engineer, Stateful Platform 팀), Jaydeepkumar Chovatia(Sr. Staff Software Engineer, Storage Platform), Shriniket Kale(Engineering Manager II, Storage Platform), Gopal Mor(Sr. Staff Software Engineer, Cassandra 팀 Tech Lead Manager), Long Pan(Senior Software Engineer, Cassandra 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 여러 존의 노드를 하나로 묶은 default rack {#background}

Uber는 Cassandra를 서비스형으로 6년 넘게 운영해 왔습니다. 초당 수백만 쿼리와 페타바이트 규모 데이터를 다루는, 미션 크리티컬 OLTP 워크로드의 기반입니다. 노드도 여러 리전과 존에 나눠 두었습니다. 그런데 존 하나가 멈추면 일부 데이터에 접근하지 못할 수 있었습니다.

노드가 흩어져 있어도 복제본은 한곳에 몰릴 수 있었습니다. 복제 계수가 3인 레코드 1의 복제본 둘이 존 1에 있다면, 그 존이 내려갈 때 과반을 잃어 레코드에 접근할 수 없게 됩니다. 같은 장애를 겪어도 존마다 복제본을 하나씩 둔 레코드 2에는 둘이 남습니다. 복제본의 과반이 살아 있으므로 계속 읽고 쓸 수 있습니다.

Uber의 기존 구성은 이런 차이를 막지 못했습니다. 모든 노드가 같은 `default` rack 값을 써서 리전마다 논리적인 rack이 하나뿐이었고, 한 레코드의 복제본 과반이나 전부가 같은 존에 놓일 수 있었습니다.

배치를 바로잡을 기능은 Cassandra에 이미 있었습니다. `cassandra-rackdc.properties`에서 노드마다 `dc`와 `rack`을 지정하면, `NetworkTopologyStrategy`가 한 dc 안에서 가능한 한 많은 rack에 복제본을 나눕니다. rack을 존에 대응시키고 복제 계수 3인 데이터의 복제본을 서로 다른 존에 두면, 어느 존이 내려가도 둘이 남는 배치가 됩니다. 이 배치를 모든 레코드에 적용해 존 하나의 장애가 가용성에 영향을 주지 않도록 하는 것이 단일 존 장애 내성(SZFT)의 목표였습니다.

## 새 rack의 첫 노드에 몰리는 데이터 {#why-new-ring}

설정은 단순해 보여도 기존 ring에서 rack 값을 바꾸는 방법은 쓸 수 없었습니다. 단일 rack 구성에 새로운 rack의 노드가 하나 들어오는 순간, 복제본을 가능한 한 많은 rack에 나누려는 알고리즘이 모든 레코드의 복제본 하나를 새 rack에 배치합니다. 노드는 하나인데 모든 레코드가 복제본을 보내는 것입니다. 새 노드는 곧바로 핫스팟이 됩니다.

Uber는 같은 리전에 다중 rack으로 구성한 새 ring을 만들기로 했습니다. Cassandra에서는 이를 별도의 dc로 구분합니다. 기존 ring이 서비스를 계속하는 동안 새 ring에 데이터를 채우고, 트래픽을 옮긴 뒤 옛 ring을 제거하는 방식입니다.

실제 트래픽 전환에는 이용 팀의 개입이 없어야 했습니다. 서비스 로직이나 클라이언트 코드, 라우팅을 바꾸지 않고도 전환이 끝나야 한다는 조건입니다. 다운타임 없이 지연 시간을 비롯한 기존 SLO를 지켜야 했고, 비상시에는 옛 ring과 새 ring 사이에서 트래픽을 다시 옮길 수도 있어야 했습니다.

## 같은 리전의 새 ring까지 연결하는 클라이언트 {#client-enhancement}

이 조건을 맞추려면 클라이언트부터 준비해야 했습니다. Uber는 GoCQL과 Java 드라이버를 포크해, 재시작 없이 같은 리전의 다른 ring으로 트래픽을 옮기도록 개선했습니다.

로드 밸런스 정책은 `TokenAware`와 `RoundRobin` 조합으로 통일했습니다. 이 조합보다 더 중요한 변화는 `DCAwarePolicy`를 빼는 일이었습니다. Uber의 많은 애플리케이션이 쓰던 이 정책은 코디네이터 선택을 옛 ring에 고정했기 때문입니다.

연결 상태를 추적하는 기능까지 새로 만들지는 않았습니다. 오픈소스 클라이언트는 CQL 연결을 받는 native transport의 변화를 이미 감지합니다. native transport가 꺼진 노드와는 연결을 끊고, 새로 켜진 노드에는 연결합니다. 같은 리전 안에서는 어느 ring에든 연결하도록 허용하면, 이 동작을 트래픽 전환에 그대로 쓸 수 있었습니다.

허용 범위는 같은 리전까지입니다. 새로 구현한 호스트 필터가 원격 리전의 노드를 코디네이터 후보에서 제외하도록 했습니다. 초기 접속 지점도 클라이언트가 속한 리전에서 받아야 했습니다.

접속 지점은 전용 마이크로서비스가 제공합니다. Cassandra 컨트롤 플레인과 연동해 클러스터 토폴로지를 파악하고 있으므로, 클라이언트가 클러스터 이름만 보내면 같은 리전에 있는 노드의 IP와 포트를 돌려주는 방식입니다. 사용자는 접속 지점을 넘기는 방식만 이 API에 맞추면 됩니다. IP·포트·dc 같은 저수준 토폴로지 정보를 직접 다루지 않도록 클라이언트 설정을 표준화한 것입니다.

리전 안에서 코디네이터를 고르고 읽기와 쓰기에 `LOCAL_QUORUM`을 쓰면, 한 리전을 리빌드하는 동안 다른 리전의 클라이언트는 영향을 받지 않습니다. Uber가 리전별로 전환을 진행할 수 있었던 조건입니다.

## CQL 연결을 막고 시작하는 교체 절차 {#rebuild-procedure}

기존 ring은 요청을 계속 처리합니다. 같은 리전에 노드 수와 CPU·메모리·디스크가 기존 ring과 같은 새 ring을 마련하고, 노드를 존마다 고르게 나눕니다. 각 노드의 `cassandra-rackdc.properties`에는 존에 맞는 rack을 지정합니다. 새 노드의 native transport는 꺼 둡니다. 이때의 새 ring은 CQL 연결을 받지 않는 “오프라인” 상태입니다.

CQL 연결을 막아도 복제는 가능합니다. 모든 keyspace의 복제 설정에 새 ring을 추가하면, dc 간 복제로 실시간 쓰기가 새 ring에도 전달됩니다. 클라이언트는 여전히 옛 ring에 요청하지만 새로 들어오는 데이터는 양쪽에 쌓이기 시작합니다.

과거 데이터는 따로 채워야 합니다. 새 ring의 모든 노드에서 `nodetool rebuild`를 실행해 옛 ring의 데이터를 스트리밍합니다. 예를 들어 새 ring인 `region1_new`의 노드들이 기존 `region1`에서 데이터를 가져오는 방식입니다. 실시간 쓰기를 받기 시작한 뒤 과거 데이터까지 동기화하는 순서입니다.

데이터가 준비되면 연결을 엽니다. 먼저 새 ring의 모든 노드에서 native transport를 켜고, 그다음 옛 ring의 모든 노드에서 끕니다. 앞서 준비한 클라이언트가 이 변화를 감지해 연결을 옮기므로, 이용 팀이 트래픽 전환에 손댈 일은 없습니다.

마지막으로 모든 keyspace의 복제 설정에서 옛 ring을 뺀 뒤, 옛 노드들을 decommission합니다. 한 리전의 교체가 끝나면 다른 리전에서도 같은 절차를 반복합니다.

## 운영 존 하나를 내려 본 가상 장애 시험 {#results}

Uber는 Cassandra 플릿 대부분을 이 방식으로 전환했습니다. 롤아웃 중 큰 장애는 없었고, 전환 이후 몇 달 동안도 문제가 없었습니다. 이용 팀이 개입하지 않아도 진행된 작업입니다.

운영 환경에서는 존 하나를 통째로 내리는 가상 테스트도 여러 차례 수행했습니다. 그동안 Cassandra 이용 팀은 영향을 받지 않았습니다.

## 전환 뒤에도 필요한 존별 여유 용량 {#spare-capacity}

rack을 존에 대응시켜 SZFT를 유지하려면 존 수가 복제 계수 이상이어야 합니다. 클러스터를 확장할 때 rack들이 고르게 커질 수 있도록 존마다 균일한 여유 서버 용량도 있어야 합니다. 현실의 용량은 그렇게 맞아떨어지지 않습니다.

문제는 급하게 노드를 늘려야 하는데 원하는 존에 서버가 없을 때입니다. 수평 확장과 SZFT를 함께 만족시킬 수 없다면 Uber는 당장의 성능 요구를 우선해 확장합니다. 이때는 SZFT를 일시적으로 포기할 수밖에 없습니다.

다른 존에 용량이 확보되면 확장하면서 추가한 노드를 원하는 존으로 재배치해 SZFT를 회복합니다. 이 과정에서 노드 교체 횟수는 최소한으로 줄여야 합니다. 존별 용량을 따라 노드를 옮기는 일은 운영 부담이 커서 자동화에 크게 의존합니다. Uber는 스토리지 관리와 컨트롤 플레인을 맡은 Stateful Platform 팀 덕분에 이런 상황을 완전 자동화된 방식으로 처리할 준비를 마쳤다고 밝히며, 원문에서는 용량 관리의 상세 구현까지 다루지는 않습니다.

{{% details title="전환 규모와 명령·설정" closed="true" %}}

| 항목 | 값 |
|---|---|
| 운영 기간 | 6년 이상 |
| 규모 | 초당 수백만 쿼리, 페타바이트 데이터 |
| 예시 복제 계수 | 3 |
| 새 ring 하드웨어 | 기존 ring과 동일(노드 수, CPU, 메모리, 디스크) |
| 새 ring 초기 상태 | native transport 비활성화 |
| 과거 데이터 동기화 | nodetool rebuild(새 ring 모든 노드) |
| 트래픽 전환 | 새 ring native transport 활성화 후 옛 ring 비활성화 |
| 클라이언트 로드 밸런스 | TokenAware + RoundRobin(DCAwarePolicy 제외) |
| 일관성 수준 | LOCAL_QUORUM 읽기·쓰기 |
| 전제 조건 | 존 수가 복제 계수 이상 |

{{% /details %}}
