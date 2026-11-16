---
title: "D1 글로벌 읽기 복제본 사이에서 순서를 지키는 북마크"
description: "D1은 요청이 다른 복제본으로 옮겨 가도 어떻게 방금 쓴 데이터를 읽게 할까요? Sessions API의 북마크로 쿼리 순서를 지키고, SQLite WAL을 빠르게 전파해 복제 지연을 줄입니다."
date: 2026-11-16
weight: 11
---

# D1 글로벌 읽기 복제본 사이에서 순서를 지키는 북마크 (2025-04)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Sequential consistency without borders: how D1 implements global read replication](https://blog.cloudflare.com/d1-read-replication-beta)
- 매체 · 게시일: The Cloudflare Blog · 2025-04-10
- 저자: Justin Mazzola Paluska, Lambros Petrou
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 가까운 복제본에서 보이지 않는 주문 {#global-read-replication}

주문을 마쳤으면 목록에도 보여야 합니다. 원본인 primary 데이터베이스가 주문을 저장했어도, 계정 페이지의 조회를 맡은 읽기 복제본이 아직 그 쓰기를 받지 못했다면 새 주문이 빠질 수 있습니다.

공개 베타로 나온 D1 읽기 복제는 데이터베이스의 읽기 전용 복사본을 Cloudflare 네트워크의 여러 리전에 배치합니다. 전자상거래, 콘텐츠 관리 도구, 모바일 앱처럼 읽기가 많은 애플리케이션을 위한 기능입니다. 가까운 복제본에서 읽기를 처리하면 평균 지연이 줄고, 읽기 부하가 줄어든 primary는 더 많은 쓰기를 처리할 여유를 얻습니다. 복제본 생성과 유지, 요청 라우팅은 D1이 맡습니다.

문제는 요청의 목적지가 바뀐다는 데 있습니다. 사용자가 WiFi에서 모바일 네트워크로 전환하거나 데이터센터에 장애·유지보수가 발생하면 다음 요청은 다른 복제본에 도착할 수 있습니다. 복제는 비동기입니다. 새 복제본이 이전 복제본보다 뒤처져 있다면, 별도의 장치 없이는 과거 어느 시점에 커밋된 데이터를 읽는다는 read committed 수준의 보장만 남습니다.

## 다음 요청까지 순서를 잇는 D1 세션 {#session-and-bookmark-consistency}

D1 Sessions API는 같은 복제본으로 보내는 대신, 도착한 복제본이 세션에서 요구한 데이터 상태를 갖추도록 합니다. 세션은 브라우저 하나나 한 사용자의 모바일 앱에서 오는 요청들처럼 논리적으로 이어지는 쿼리를 묶습니다. 그 안에서는 읽기와 쓰기가 코드에 적은 순서를 따릅니다. 자신의 쓰기를 후속 읽기에서 확인하고, 읽기 뒤의 쓰기도 그 순서를 지키며, 모든 복제본이 커밋을 같은 순서로 관찰하는 순차 일관성입니다.

주문을 저장한 primary가 `Bookmark 100`을 돌려줬다고 가정하겠습니다. 세션 객체는 이 북마크를 기억합니다. 뒤이은 주문 목록 조회를 받은 복제본은 적어도 `Bookmark 100`까지 반영한 뒤에야 쿼리를 실행합니다. 두 쿼리 사이에 다른 클라이언트의 쓰기까지 복제됐다면, 응답에는 더 최신인 `Bookmark 104`가 담길 수도 있습니다.

세션을 만드는 `withSession()`에는 북마크 또는 첫 쿼리의 처리 제약을 전달합니다. 이전 세션의 북마크를 넘기면 그만큼 최신인 상태에서 이어서 시작합니다. `first-primary`는 첫 쿼리를 primary로 보내고, `first-unconstrained`는 최신 상태에 제약을 두지 않고 임의의 복제본에서 첫 쿼리를 처리하도록 허용합니다.

세션 객체는 쿼리마다 관찰한 최신 북마크를 추적해 후속 쿼리에 붙입니다. 요청이 끝날 때 `getBookmark()`의 결과를 응답 헤더·쿠키·본문에 담고 클라이언트가 다음 요청에 전달하면, HTTP 요청이 끝나도 세션의 순서는 이어집니다. 세션 객체 밖에서 실행한 쿼리에는 이 세션 쿼리들과의 순차 일관성이 보장되지 않습니다.

## 쓰기 요청을 primary로 넘기는 Durable Objects {#unconfirmed-writes-and-routing}

고객 Worker의 바인딩에서 나온 요청은 같은 위치의 무상태 D1 Worker를 거쳐 SQL을 실행하는 Durable Objects로 향합니다. D1 Worker가 데이터베이스 ID에 맞는 Durable Object를 찾으면, Durable Objects 라우팅 계층이 해당 위치로 RPC 연결을 맺습니다. 복제하지 않는 데이터베이스라면 Durable Object 하나가 전부입니다.

읽기 복제를 켜면 목적지가 늘어납니다. 게시 당시 D1의 배치 정책은 지원하는 모든 리전에 정적인 복제본 집합을 만들고, 사용자 요청에 가까운 리전의 복제본으로 라우팅하는 방식입니다. 최종적으로 쿼리를 처리할 인스턴스는 성능 휴리스틱, 쿼리 종류, 애플리케이션이 명시한 일관성 요구에 따라 정해집니다.

읽기와 쓰기의 구분은 라우팅 이후 SQLite가 수행합니다. 읽기 전용 복제본에도 쓰기 요청이 도착하는 이유입니다. 각 복제본은 primary 참조를 가지고 있다가 쓰기 요청을 primary로 넘깁니다. `first-primary` 제약이 붙은 요청도 같은 경로를 따르며, 복제본에서 처리할 읽기는 필요한 북마크까지 따라잡은 뒤 로컬에서 실행됩니다.

## 커밋보다 먼저 복제본에 닿는 SQLite WAL {#sqlite-wal-replication}

이 동작의 바탕에는 SQLite와 Storage Relay Service가 있습니다. Durable Object의 SQLite는 로컬 디스크에서 쓰기 선행 로그인 WAL을 사용합니다. 쓰기가 WAL에 추가되면 Storage Relay Service leader는 다른 데이터센터의 서버에 있는 durability follower 5개에 동기 복제하고, 그중 최소 3개가 안전한 저장을 확인해야 커밋을 허용합니다. 그 뒤 Durable Object의 출력 게이트가 열려 응답을 보냅니다.

앞에서 본 북마크는 각 쓰기에 붙이는 Lamport 타임스탬프입니다. 데이터베이스 안에서 엄격하게 증가하며 WAL의 각 항목을 식별합니다. WAL을 순서대로 재생하면 데이터베이스를 복원할 수 있고, 특정 북마크까지만 재생하는 방식은 시점 복구(PITR)에도 쓰입니다.

로그를 다루는 비용은 줄여야 합니다. SQLite는 WAL 내용을 주 데이터베이스 파일에 체크포인트하고, Storage Relay Service는 콜드 스토리지에 스냅샷을 저장합니다. 새 읽기 복제본은 최신 스냅샷을 가져온 뒤 primary leader가 마지막으로 커밋한 북마크까지 WAL을 재생하므로, 로그 전체를 처음부터 내려받지 않아도 됩니다.

하지만 이것만으로는 복제본을 다시 시작하기 전까지 데이터가 갱신되지 않습니다. 계속 따라오게 하려면 복제본 leader를 primary leader에 등록해 새 WAL 항목을 받아야 합니다. 이때 primary는 durability follower에 WAL을 보내면서 복제본에도 곧바로 전송합니다. 정족수 확인을 기다리지 않으므로, 복제본에 도착한 쓰기는 아직 미확정 상태입니다.

복제본은 이 쓰기를 읽기에 노출해서는 안 됩니다. 복제본 leader는 SQLite WAL-index 프로토콜에 필요한 부분을 구현해, 도착한 항목이 다른 SQLite 클라이언트가 수행 중인 미확정 쓰기처럼 보이게 합니다. WAL에는 즉시 기록하되 SQLite는 읽기에서 무시하고, primary가 확정을 알리면 복제본에서도 커밋합니다.

쓰기가 생기자마자 보내는 방식은 복제 지연을 줄입니다. 복제본을 거쳐 primary에 쓰기를 보냈다면, 이론적으로 쓰기 응답과 복제 갱신 메시지가 거의 같은 시점에 복제본에 도착해 지연이 없는 것처럼 보일 수도 있습니다.

## 빛의 속도 앞에 남은 복제 지연 {#replication-lag-and-observability}

Cloudflare가 측정하는 confirm lag는 primary가 변경을 확정한 시점부터 복제본이 같은 변경을 확정한 시점까지의 시간입니다. 서로 다른 리전에 primary를 둔 데이터베이스에서 제시한 측정값은 30~75ms였습니다. 애플리케이션의 응답 지연이나 처리량 개선 실측은 제시되지 않았습니다.

측정값에는 데이터센터 사이의 네트워크 왕복 시간이 드러납니다. 항공 노선을 짜는 사람에게 익숙할 거리 차이입니다. ENAM에서는 EEUR이 WEUR보다 더 멀지만, WNAM에서는 두 유럽 리전까지의 거리가 비슷합니다. 실제로 Database A의 유럽 복제본은 각각 67ms와 55ms였고, Database B의 두 유럽 복제본은 모두 75ms였습니다.

리전 이름만으로 거리가 정해지는 것도 아닙니다. ENAM과 WNAM 자체가 넓어서 같은 리전 안에서도 primary가 정확히 어디에 놓였는지에 따라 지연이 달라집니다. 복제를 서둘러도 빛의 속도를 이길 수는 없습니다.

{{% details title="복제 설정과 confirm lag 실측" closed="true" %}}
| 항목 | 값 |
|---|---|
| 내구성 복제 대상 | 서로 다른 데이터센터의 서버에 있는 durability follower 5개 |
| 쓰기 커밋 조건 | durability follower 5개 중 최소 3개가 안전한 저장을 확인 |
| `first-unconstrained` | 첫 쿼리는 최신 상태의 제약 없이 임의의 복제본에서 처리 가능 |
| `first-primary` | 첫 쿼리를 primary로 전달 |
| 명시적 북마크 | 처리 인스턴스가 해당 북마크 이상으로 최신이어야 실행 |
| 실측 데이터베이스의 primary 위치 | Database A는 ENAM, Database B는 WNAM |
| ENAM 복제본의 confirm lag | Database A: N/A, Database B: 30ms |
| WNAM 복제본의 confirm lag | Database A: 45ms, Database B: N/A |
| WEUR 복제본의 confirm lag | Database A: 55ms, Database B: 75ms |
| EEUR 복제본의 confirm lag | Database A: 67ms, Database B: 75ms |
| N/A의 의미 | 해당 조합의 데이터 없음 |
{{% /details %}}

## 복제본을 켜기 전에 준비하는 Worker {#adoption-and-remaining-support}

도입은 Worker가 Sessions API를 사용하도록 바꾸는 데서 시작합니다. 복제를 켜지 않은 데이터베이스에서도 API가 동작하므로 코드 변경을 먼저 배포한 뒤, Cloudflare 대시보드의 데이터베이스 설정에서 복제본을 활성화하면 됩니다. 공개 베타인 만큼 Cloudflare는 non-production 데이터베이스에서 용도에 맞게 동작하는지 검증한 뒤 production 워크로드로 옮기기를 권장합니다.

복제본에 별도 스토리지·컴퓨트 요금은 없습니다. 복제 여부와 관계없이 쿼리의 `rows_read`와 `rows_written`을 기준으로 같은 방식으로 사용량을 산정합니다.

쿼리가 어디서 처리됐는지는 응답에서 확인합니다. `meta.served_by_region`은 처리 리전을 나타내며, `meta.served_by_primary`는 primary에서 처리했을 때만 `true`입니다. 대시보드에서도 primary·복제본별 쿼리 수와 리전별 쿼리 수·읽은 행 수를 확인할 수 있습니다.

게시 시점에 Sessions API를 사용할 수 있는 경로는 D1 Worker Binding뿐입니다. HTTP REST API 지원은 후속 계획이며, 복제본 배치 정책도 개선·확장 중입니다.
