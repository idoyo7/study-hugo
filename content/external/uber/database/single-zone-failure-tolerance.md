---
title: "무중단으로 전환한 Cassandra의 단일 존 장애 내성"
description: "우버가 단일 rack 구성이던 Cassandra 플랫폼을 가용 영역 하나가 죽어도 견디는 구성으로 실시간 전환한 과정을 요약합니다. 새 ring을 만들어 갈아타는 절차와 클라이언트 개선을 중심으로 정리했습니다."
date: 2026-11-10
weight: 10
---

# 무중단으로 전환한 Cassandra의 단일 존 장애 내성 (2024-06)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How Uber ensures Apache Cassandra®'s tolerance for single-zone failure](https://www.uber.com/us/en/blog/single-zone-failure-tolerance/)
- 매체 · 게시일: Uber Engineering Blog · 2024-06-20
- 저자: Gabriele Di Bernardo(전 Senior Software Engineer, Stateful Platform 팀), Jaydeepkumar Chovatia(Sr. Staff Software Engineer, Storage Platform), Shriniket Kale(Engineering Manager II, Storage Platform), Gopal Mor(Sr. Staff Software Engineer, Cassandra 팀 Tech Lead Manager), Long Pan(Senior Software Engineer, Cassandra 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 배경과 목표 {#background}

우버는 오픈소스 Apache Cassandra를 서비스형으로 6년 넘게 운영해 왔습니다. 초당 수백만 쿼리와 페타바이트 규모 데이터를 다루며 미션 크리티컬한 OLTP 워크로드를 받칩니다. 데이터센터가 여러 리전의 여러 존에 걸쳐 있어서 Cassandra 클러스터의 노드도 존과 리전에 분산됩니다. 목표는 가용 영역 하나가 통째로 내려가도 Cassandra 가용성이 영향을 받지 않는 것, 곧 SZFT(Single Zone Failure Tolerant)입니다. 대규모 플릿을 SZFT가 아닌 상태에서 무중단으로 전환한 방법이 이 글의 중심입니다.

## 존 장애가 가용성을 해치는 원리 {#how-zone-failure-hurts}

Cassandra는 데이터를 여러 복제본으로 둡니다. 복제본의 과반이 살아 있으면 레코드에 접근할 수 있습니다. 복제 계수가 3이고 존 1이 죽었다고 하면, 복제본 둘이 존 1에 있던 레코드는 과반을 잃어 접근할 수 없습니다. 복제본이 존 하나에 하나씩 퍼져 있던 레코드는 멀쩡합니다. 모든 레코드가 후자처럼 복제본을 존마다 고르게 두면 어느 존이 죽어도 전체 가용성에는 영향이 없습니다.

Cassandra에는 노드를 논리적으로 묶어 복제본을 그룹 사이에 나누는 기능이 있고, cassandra-rackdc.properties 파일에서 노드마다 dc와 rack을 지정합니다. 복제 전략이 NetworkTopologyStrategy이면 한 dc 안에서 가능한 한 많은 rack에 복제본을 배치합니다. rack을 존에 대응시키고 복제 계수 3으로 두면 어느 존이 내려가도 다른 존에 건강한 복제본이 둘 남아 읽기와 쓰기를 받을 수 있습니다.

우버는 이 rack 속성을 활용하지 않았습니다. 모든 노드가 같은 "default" rack 값을 가져서 리전 안에 rack이 하나뿐이었고, 그 결과 복제본 과반이나 전부가 한 존에 몰릴 수 있었습니다.

## 새 ring으로 갈아타는 이유 {#why-new-ring}

단일 rack 구성의 기존 노드를 제자리에서 다중 rack으로 바꾸는 것은 현실적이지 않았습니다. 새 rack을 가진 노드가 하나라도 들어오면 복제본 배치 알고리즘이 모든 레코드의 복제본 하나를 그 rack에 두려 해서, 노드가 하나뿐인 rack에 데이터가 몰려 즉시 핫스팟이 됩니다.

그래서 같은 리전 안에 다중 rack으로 구성한 새 ring(NetworkTopologyStrategy의 새 dc)을 만들고, 기존 ring에서 rebuild로 데이터를 채운 뒤, 트래픽을 옮기고 옛 ring을 제거하는 방식을 택했습니다. 전체 마이그레이션에는 네 가지 원칙을 세웠습니다.

- 고객 개입 없음: 서비스 로직, 클라이언트 코드, 라우팅을 바꾸지 않는다.
- 고가용성: 마이그레이션 중 다운타임이 없다.
- 지연 시간 같은 기존 성능 SLO를 유지한다.
- 롤백 가능: 비상시 옛 ring과 새 ring 사이를 오갈 수 있다.

## 리빌드 절차 {#rebuild-procedure}

1단계는 리전에 "오프라인" 다중 rack 노드 묶음을 새로 마련하는 것입니다. 노드 수, CPU, 메모리, 디스크 같은 하드웨어 자원은 기존 ring과 같게 하고 존마다 고르게 나누며, 각 노드의 cassandra-rackdc.properties를 존 기준으로 설정합니다. 새 노드는 native transport를 꺼서 CQL 연결을 막은 채 만듭니다. 나중에 트래픽을 매끄럽게 넘기는 데 꼭 필요한 조치입니다.

2단계는 실시간 쓰기의 동기화입니다. 모든 keyspace의 복제 설정에 새 ring을 추가하면 Cassandra의 dc 간 복제로 새 ring이 간접적으로 실시간 쓰기를 받기 시작합니다.

3단계는 과거 데이터 동기화입니다. 새 노드는 실시간 쓰기는 받아도 과거 데이터가 없습니다. 새 ring의 모든 노드에서 nodetool rebuild 명령을 실행해 옛 ring에서 데이터를 스트리밍합니다.

4단계는 트래픽 전환입니다. 새 ring 전체에서 native transport를 켜고 옛 ring 전체에서 끕니다. 클라이언트에서 할 일은 없게 만들었는데, 이유는 다음 절의 클라이언트 개선에 있습니다.

5단계는 옛 노드 제거입니다. 먼저 모든 keyspace의 복제 설정에서 옛 ring을 빼고, 그다음 옛 ring의 노드를 decommission합니다.

6단계는 다른 리전에 같은 절차를 반복하는 것입니다.

## 클라이언트 개선 {#client-enhancement}

우버는 GoCQL과 Java 드라이버를 포크해, 재시작 없이 한 ring에서 다른 ring으로 트래픽을 동적으로 옮기게 개선했습니다. 클라이언트에 요구된 조건은 셋입니다.

- 초기 접속 지점(토폴로지 탐색용 노드)을 늘 자기와 같은 리전에서 받는다.
- 코디네이터 노드를 늘 같은 리전에서 고른다.
- 4단계에서 native transport가 켜진 새 ring 노드에 자동으로 연결한다.

첫째는 Cassandra 클러스터의 접속 정보만 공개하는 전용 마이크로서비스로 풀었습니다. Cassandra 컨트롤 플레인과 연동되어 모든 클러스터의 토폴로지를 알고 있으며, 클라이언트가 대상 클러스터 이름만 보내면 같은 리전에 있는 노드들의 IP와 포트를 돌려줍니다. 이 로직은 클라이언트 API에 숨겨져서 사용자는 접속 지점을 넘기는 방법만 바꾸면 됩니다.

둘째는 우버가 클라이언트 안에 구현한 새 호스트 필터로 해결했습니다. 원격 리전의 코디네이터 노드를 모두 제외합니다.

셋째는 로드 밸런스 정책을 TokenAware와 RoundRobin 조합으로 지정해 해결했습니다. 중요한 것은 이 조합 자체보다 DCAwarePolicy를 쓰지 않는 것입니다. 우버의 많은 Cassandra 애플리케이션에 쓰이던 DCAwarePolicy는 코디네이터 선택을 옛 ring에 고정시킵니다. 오픈소스 클라이언트는 이미 native transport 변화를 제때 감지해 꺼진 노드와의 연결을 끊고 켜진 노드에 연결하므로, 같은 리전의 어느 ring과도 연결되게 허용하면 충분했습니다.

이 개선으로 사용자는 IP, 포트, dc 같은 저수준 토폴로지 정보에서 분리됩니다. 리전 기반 코디네이터 선택에 LOCAL_QUORUM 읽기와 쓰기를 더하면, 한 리전에서 리빌드하는 동안에도 다른 리전의 클라이언트는 자기 리전 노드와만 통신하므로 영향이 없고, 그 덕에 리전 단위로 SZFT 전환을 진행할 수 있었습니다.

## 존별 여유 용량의 불균일 {#spare-capacity}

rack이 존이면 존 수가 복제 계수 이상이어야 하고, 클러스터를 확장할 때 모든 rack이 고르게 커지려면 존마다 여유 서버 용량이 균일해야 합니다. 클러스터가 작거나 모든 존의 여유가 보장될 때는 부담이 덜하지만, 현실에서는 존별 가용 용량이 불균일한 경우가 흔합니다. 이때 급한 수평 확장을 하면 SZFT를 포기할 수밖에 없습니다.

두 요구를 함께 만족시킬 수 없다면 클러스터의 즉각적인 성능 요구를 위해 수평 확장을 우선합니다. 나중에 다른 존에 용량이 생기면 확장하며 추가한 노드를 최소한의 노드 교체로 원하는 존으로 "재배치"해 SZFT를 회복해야 합니다. 운영 부담이 큰 과정이라 정교한 자동화가 필요하고, 우버는 스토리지 관리와 컨트롤 플레인을 운영하는 Stateful Platform 팀 덕분에 이 상황을 완전 자동으로 처리할 준비가 되어 있다고 합니다. 원문은 용량 관리 영역이라며 더 깊이 다루지 않습니다.

## 결과 {#results}

- Cassandra 플릿 대부분에서 롤아웃이 끝났고, 이후 몇 달 동안 문제가 없었습니다.
- 롤아웃 중 큰 장애가 없었습니다.
- 이해관계자에게 전 과정이 투명했습니다.
- 운영 환경의 존 하나를 통째로 내리는 가상 테스트를 여러 차례 했을 때 Cassandra 이용 팀은 영향을 받지 않았습니다.

{{% details title="전환 절차와 클라이언트 설정 요약" closed="true" %}}

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
