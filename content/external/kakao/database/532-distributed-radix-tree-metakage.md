---
title: "Object Storage MetaKage의 분산 Radix Tree"
description: "카카오 사내 Object Storage MetaKage가 Ordered Listing을 위해 쓰는 분산 Radix Tree를 정리했습니다. LSMT와 BTree의 한계, Hash Table 위에 만든 Radix Tree의 구조와 Split, Bloom Filter 병목 해소를 요약합니다."
date: 2026-11-14
weight: 9
---

# Object Storage MetaKage의 분산 Radix Tree (2022-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Object Storage 구현을 위한 분산 Radix Tree](https://tech.kakao.com/posts/532)
- 매체 · 게시일: 카카오 기술블로그 · 2022-08-18
- 저자: yanoo.kim (분산기술셀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 문제 배경 {#background}

Kage는 원래 Meta가 없는 스토리지라 SNS성 대규모 업로드와 다운로드에서도 Meta 때문에 성능이 떨어지지 않았습니다. 그런데 복잡한 기능을 넣으려면 파일의 복잡한 정보와 보조 정보를 기록할 Meta가 필요했고, 그 김에 Openstack Object Storage API를 지켜 오픈소스 서드파티를 쓸 수 있는 MetaKage를 만들려 했습니다.

문제는 파일 개수였습니다. WebScale Object Storage를 목표로 했고, 서비스 7년여 만에 MetaKage에는 수천 억 개의 파일이 저장돼 있습니다. 파일 한 개의 정보를 1KB로 잡으면 수백 TB가 필요한 규모라 단일 저장소로는 성능으로도 용량으로도 다루기 어렵습니다. 그래서 분산 스토리지에 저장해야 했고, 필요한 기능은 Ordered Listing, 곧 Range Query입니다.

## LSMT의 한계 {#lsmt}

HBase와 Cassandra는 널리 쓰이는 분산 스토리지이고 둘 다 Range Query를 LSMT(Log-Structured Merge Tree) 기반으로 제공합니다. LSMT는 삽입 데이터를 모아 정렬해 SSTable로 저장합니다. Get, Put, Delete는 Bloom Filter로 키를 가진 SSTable만 골라 비용을 줄이지만, Range Scan은 모든 SSTable에서 Binary Search로 범위를 특정해야 해서 짧은 Range Scan도 CPU와 IO를 꽤 씁니다.

비용을 줄이려면 여러 SSTable을 합치는 Compaction이 필요한데 CPU와 IO 모두 비쌉니다. NAND Flash의 용량과 병렬성이 늘면서 IO 부담은 줄었지만 CPU 부담은 그대로여서 LSMT는 CPU를 크게 쓰는 자료구조가 됐다고 원문은 짚습니다. Hot Spot을 나누려고 Key 앞에 Salt를 붙여 파티셔닝하기도 하지만, 한번 정한 Salt 범위는 바꾸기 어렵고 클러스터 전체에 걸리는 Range Query 부담은 줄이지 못합니다.

## 분산 BTree가 안 되는 이유 {#btree}

BTree는 갱신 즉시 In-place Update를 하므로 Random Write가 생기고, LSMT는 모아서 정렬해 Sequential Write를 하므로 쓰기 패턴은 LSMT가 낫습니다. 반면 즉시 갱신하는 BTree는 Range Scan에 이점이 있습니다. Distributed Key-Value Storage는 Random Write에 강하니, Key-Value를 Tree의 노드로 삼으면 LSMT 없이도 Ordered Listing을 제공할 수 있을 것 같았습니다. 그러나 두 가지 문제가 있었습니다.

- Split 같은 SMO의 정합성을 보장하기 어렵습니다. 새 노드를 만들고 기존 아이템을 옮기고 부모에 링크를 더하는 세 노드 갱신이 모두 성공해야 하는데, 하나라도 실패하면 BTree가 깨지고 분산 환경에서 트랜잭션은 비쌉니다.
- Root Node가 병목입니다. 모든 연산이 Root에서 시작해 그 노드를 가진 스토리지에 I/O가 몰립니다. BTree에서 Cache를 잘못 쓰면 Tree를 잘못 읽거나 깨뜨릴 수도 있습니다.

## 분산 Radix Tree의 구조 {#structure}

이 두 문제를 푼 것이 분산 Radix Tree입니다. LSMT나 다른 DBMS의 스토리지 엔진이 파일 시스템 위에 만들어지듯, 이 Radix Tree는 용량이 매우 큰 Hash Table 위에 구축됩니다.

논리 구조에서 모든 Node는 Key-Value 아이템 하나와 1:1로 대응하고, Node의 Key는 Prefix로 표현되며 `$`라는 시스템 문자를 접미사로 갖습니다. Node는 Child를 갖고, 자기 Key와 Child를 합친 이름으로 Child Node를 찾거나 Data flag로 실제 Item의 존재를 확인합니다. `/12345` 탐색 예는 이렇습니다. `$`로 RootNode를 찾고, Binary Search로 `/1`을 찾아 `$/1` Node로 내려가고, 다시 `2345`를 찾아 `$/12345`를 만든 뒤, 거기서 Begin Range인 `/89`를 찾아 뒤의 Child들을 순회합니다.

물리 배치에서는 Sharding된 Datanode A, B, C에 각 Key를 Hash해 Digest값에 따라 분산합니다. 원문의 예로 `SCAN(/12345)`는 Tree에 대한 GET 3번과, 찾아낸 `/12345/89`와 `/1234567` 두 Key의 원본 GET 2번을 합쳐 총 5번의 GET으로 이뤄집니다.

## Split과 정합성 {#split}

BTree는 Split에서 여러 노드의 원자적 갱신이 필요하지만, 분산 Radix Tree에는 그런 요구가 없어 분산 환경에서 쓰기 쉽습니다. Node는 정렬된 Child 배열이고 최대 4KB라, 삽입을 계속하다 공간이 모자라면 Split이 일어납니다. `$/foo`에 `cde`를 넣으려다 실패한 경우를 보면 이렇습니다.

- Child Node `$/fooc`를 새로 만들고, `$/foo`의 `ccc`와 새로 넣을 `cde`를 거기 보냅니다. 이것이 PUT 한 번입니다.
- `$/foo`에서 넘어간 Child `ccc`를 지우고 새 Child Node를 가리키는 `c`를 넣어 다시 PUT합니다.

Split은 Backend에 두 번의 PUT으로 끝납니다. 트랜잭션 없이 동작하므로 두 번째 PUT 없이 첫 번째만 성공한 상태가 남을 수 있습니다. 이때 조회에는 문제가 없습니다. Child Node가 허상 참조(Dangling Reference)가 됐을 뿐 Tree는 올바릅니다. `/fooccc`라는 Key가 `$/foo`와 `$/fooc` 두 노드에 동시에 있어 클라이언트마다 다른 상태를 읽을 것 같지만, `$/fooc`로 가는 링크가 없고 모든 탐색은 Root에서 시작하므로 연결이 끊긴 노드는 읽히지 않습니다. 또 Scan 중 Stack으로 구성한 Cursor로 노드가 끊어졌는지 확인하며 읽고, 끊겼으면 잘못 쓰인 Child Node를 지우는 복구 로직이 돕니다.

## Bloom Filter로 Root 병목 제거 {#bloom-filter}

같은 구현이면 BTree처럼 Root뿐 아니라 상위 Internal Node 모두에 병목이 생깁니다. 이를 Bloom Filter로 풀었습니다. 여기서 Bloom Filter는 Tree 탐색을 돕는 Node 존재 Hint이고 각 분산 Radix Tree 모듈의 메모리에 있어 접근 비용이 들지 않습니다. Hint라서 정확할 필요가 없고, Node의 존재를 확인할 때마다 로직이 마킹하며 필터를 쌓아 갑니다.

`SCAN(/foo/abcd)`는 키에 `$`를 붙여 `$/foo/abcd`를 Bloom Filter에서 찾고, 없으면 뒤에서 한 글자씩 빼며 있을 때까지 찾습니다. 메모리 연산이라 비용이 없습니다. `/foo`가 있다고 확인되면 Root부터 시작하지 않고 중간 노드 `$/foo`부터 탐색하므로 Root 접근이 필요 없어집니다. `$/foo/abc`는 아직 마킹되지 않아 이번엔 `$/foo`부터 찾았지만, 존재가 확인되어 설정되므로 다음 탐색부터는 `$/foo/abc`에서 이어 갑니다.

## 운영 현황 {#status}

이 분산 Radix Tree를 쓰는 MetaKage는 2015년에 개발됐습니다. 자잘한 버그와 오류는 있었지만 치명적인 오류 없이 수천 억 개의 파일을 저장하며 서비스 중이라고 원문은 맺습니다.
