---
title: "수천 억 파일을 탐색하는 MetaKage의 분산 Radix Tree"
description: "수천 억 개 파일의 목록을 순서대로 조회하면서 갱신의 정합성과 탐색 병목을 어떻게 풀었을까요? MetaKage는 Hash Table 위에 분산 Radix Tree를 만들고, 두 번의 PUT으로 끝나는 Split과 Bloom Filter를 이용한 탐색을 구현했습니다."
date: 2026-11-14
weight: 9
---

# 수천 억 파일을 탐색하는 MetaKage의 분산 Radix Tree (2022-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Object Storage 구현을 위한 분산 Radix Tree](https://tech.kakao.com/posts/532)
- 매체 · 게시일: 카카오 기술블로그 · 2022-08-18
- 저자: yanoo.kim (분산기술셀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## Meta가 필요해진 Kage의 파일 목록 {#background}

Kage에는 원래 Meta가 없었습니다. SNS성 대규모 업로드와 다운로드를 처리할 때도 Meta 때문에 성능이 떨어지는 일은 없었습니다. 하지만 복잡한 기능을 넣으려면 파일 정보와 여러 보조 정보를 기록할 곳이 필요했습니다. 개발팀은 Meta를 도입하는 김에 Openstack Object Storage API를 준수해 오픈소스 서드파티도 쓸 수 있는 MetaKage를 만들려 했습니다.

문제는 파일 개수였습니다. Kage에 이미 엄청난 양의 파일이 있었으니 MetaKage도 그 규모를 감당해야 했습니다. 실제로 서비스 7년여가 지난 시점에는 수천 억 개의 파일이 저장돼 있었습니다. 파일 하나의 정보를 1KB로 가정하면 Meta만 수백 TB가 필요한 규모입니다.

단일 저장소로는 용량도 성능도 감당하기 어려웠습니다. Meta를 분산 저장하면서 파일 목록을 순서대로 조회하는 Ordered Listing을 제공해야 했습니다.

## Range Scan에서 출발한 BTree 검토 {#btree}

개발팀이 처음 눈여겨본 것은 BTree였습니다. 갱신할 때마다 In-place Update로 트리를 수정하므로 Random Write가 발생하지만, Range Scan에는 이점이 있었습니다. Random Write에 강한 Distributed Key-Value Storage에서 Key-Value 하나를 트리의 노드 하나로 쓰면 Ordered Listing을 구현할 수 있겠다는 생각이었습니다.

HBase와 Cassandra의 Range Query는 LSMT(Log-Structured Merge Tree)를 기반으로 합니다. LSMT는 삽입 데이터를 모아 정렬한 뒤 SSTable에 한꺼번에 저장합니다. Sequential Write가 일어나므로 쓰기 패턴은 BTree보다 좋습니다. 그러나 범위 조회에는 비용이 따릅니다. Get, Put, Delete에서는 Bloom Filter로 해당 키를 가진 SSTable만 추려 조회할 수 있지만, Range Scan은 모든 SSTable에서 Binary Search로 범위를 찾고 데이터를 가져와야 합니다. 짧은 범위라도 CPU와 IO를 꽤 소모합니다.

SSTable을 합치는 Compaction으로 조회 비용을 줄일 수는 있습니다. 그 작업 자체가 CPU와 IO를 많이 쓴다는 점이 문제였습니다. NAND Flash의 용량과 병렬성이 늘면서 IO 부담은 줄어도 CPU 부담은 줄지 않았습니다. Key 앞에 Salt를 붙여 파티셔닝하면 Hot Spot을 분산할 수 있지만, 한번 정한 Salt 범위는 바꾸기 어렵고 클러스터 전체의 Range Query 부담도 줄이지 못합니다.

BTree에도 해결해야 할 문제가 남았습니다. Split처럼 트리의 모양을 바꾸는 SMO에서는 새 노드를 만들고, 기존 아이템을 옮기고, 부모에 새 노드의 링크를 추가해야 합니다. 세 노드의 갱신이 모두 성공해야 트리가 온전합니다. 하나라도 실패하면 트리가 깨지는데, 분산 환경에서 이를 트랜잭션으로 묶는 비용은 매우 비쌉니다.

탐색의 출발점도 문제였습니다. Insert, Delete, Scan이 모두 Root Node에서 시작하므로 Root를 가진 스토리지 장비에 I/O가 몰려 병목이 될 수 있습니다. BTree에서는 Cache를 잘못 쓰면 트리를 잘못 조회하거나 깨뜨릴 수도 있습니다. 분산 Radix Tree는 이 Split의 정합성과 Root 병목을 해결하기 위해 만든 트리입니다.

## Hash Table 위에 배치한 Radix Tree 노드 {#structure}

분산 Radix Tree의 바탕은 용량이 매우 큰 Hash Table입니다. LSMT나 다른 DBMS의 스토리지 시스템이 File System 위에 만들어지듯, 이 트리는 Hash Table 위에 구축됩니다.

각 노드는 Key-Value 아이템 하나와 1:1로 대응합니다. 노드의 Key는 Prefix를 바탕으로 표현하고 시스템 문자 `$`를 붙입니다. 노드 안에는 Child가 있으며, 자기 Key와 Child를 합친 이름으로 다음 노드를 찾습니다. 실제 Item의 존재 여부는 Data flag로 확인합니다.

`SCAN(/12345)`의 예를 따라가면 탐색 과정이 드러납니다. 먼저 `$`로 RootNode를 찾고, Binary Search로 Child `/1`을 골라 `$/1`로 내려갑니다. 여기서 다시 `2345`를 찾아 `$/12345`로 이동합니다. 이 노드에서는 Begin Range인 `/89`를 찾은 뒤 그 뒤의 Child들을 순회합니다.

논리적으로 이어진 노드들이 같은 장비에 모여 있는 것은 아닙니다. 예시의 물리 배치에서는 각 Key를 Hash한 Digest값에 따라 Datanode A, B, C에 나누어 저장합니다. 앞의 탐색은 트리 노드를 읽는 GET 3번, 찾아낸 `/12345/89`와 `/1234567`의 원본을 읽는 GET 2번을 합쳐 총 5번의 GET으로 이뤄집니다.

## 두 번의 PUT으로 끝나는 Split {#split}

분산 Radix Tree의 Split은 여러 노드의 갱신을 하나의 트랜잭션으로 묶지 않습니다. 먼저 Child Node를 쓰고, 그다음 기존 노드에서 새 Child Node로 가는 링크를 만듭니다. 이 순서 덕분에 작업이 중간에 멈춰도 조회가 잘못된 노드로 향하지 않습니다.

각 노드의 Child는 정렬된 배열로 저장되며, 배열의 최대 크기는 4KB입니다. 삽입을 계속해 공간이 모자라면 Split이 필요합니다. `$/foo`에 `cde`를 넣으려다 공간 부족으로 실패한 경우가 그 예입니다.

먼저 `$/fooc`라는 Child Node를 만듭니다. 기존 `$/foo`의 `ccc`와 새로 넣으려던 `cde`를 이 노드에 담아 PUT합니다. 이어서 `$/foo`에서는 옮겨 간 `ccc`를 지우고 새 노드를 가리키는 `c`를 넣어 다시 PUT합니다. Backend에 쓰는 작업은 이 두 번으로 끝납니다.

첫 번째 PUT만 성공하면 어떻게 될까요? `/fooccc`라는 Key가 `$/foo`와 `$/fooc`에 함께 남습니다. 두 노드가 서로 다른 상태를 나타내면 어떤 클라이언트는 새 항목을 읽고 다른 클라이언트는 읽지 못할 것처럼 보입니다.

하지만 이 단계에서는 `$/fooc`로 가는 링크가 없습니다. Root부터 내려오는 탐색은 새 노드의 존재를 알 수 없으므로 그 노드를 읽지 않습니다. Child Node가 허상 참조(Dangling Reference)로 남았을 뿐, 조회에 쓰는 트리는 올바른 상태입니다. 두 번째 PUT이 성공해 링크가 생기면 새 노드로 탐색을 이어 갑니다.

Scan 중에는 Stack으로 구성한 Cursor로 노드의 연결 여부도 확인합니다. 연결이 끊겼으면 잘못 쓰인 Child Node를 삭제하는 복구 로직이 동작합니다.

## Root를 건너뛰게 하는 Bloom Filter의 힌트 {#bloom-filter}

Split의 정합성을 해결해도 모든 탐색이 Root에서 시작하면 병목은 남습니다. 접근이 몰리는 곳은 Root만이 아닙니다. 상위 Internal Node도 같은 문제를 겪습니다.

개발팀은 Bloom Filter에 노드의 존재를 표시해 탐색의 시작점을 바꿨습니다. 여기서 Bloom Filter는 각 분산 Radix Tree 모듈의 메모리에 있는 Hint입니다. 접근 비용이 들지 않고, 힌트로 쓰므로 아직 마킹되지 않은 노드가 있어도 됩니다. 트리가 동작하면서 노드의 존재를 확인할 때마다 마킹해 내용을 채워 갑니다.

`SCAN(/foo/abcd)`를 시작하면 먼저 `$`를 붙인 `$/foo/abcd`를 Bloom Filter에서 찾습니다. 없으면 뒤에서 한 글자씩 빼며 마킹된 노드가 나올 때까지 확인합니다. 예시에서는 `$/foo/abc`가 아직 마킹되지 않아 `$/foo`를 찾습니다. 이제 스토리지 탐색은 Root 대신 중간 노드인 `$/foo`에서 시작합니다. Root에 접근할 필요가 없어져 Root 병목도 사라집니다.

탐색을 마치면 힌트도 달라집니다. `$/foo/abc`의 존재를 확인해 Bloom Filter에 마킹하므로 다음 탐색은 그 노드부터 이어 갈 수 있습니다.

이 분산 Radix Tree를 쓰는 MetaKage는 2015년에 개발됐습니다. 원문이 쓰인 2022년 8월에는 수천 억 개의 파일을 저장하며 운영 중이었습니다. 그동안 자잘한 버그와 오류는 있었지만 치명적인 오류 없이 서비스를 이어 갔습니다.
