---
title: "MongoDB 8.0 업그레이드를 검토하는 12가지 이유"
description: "카카오 DBA 팀이 MongoDB 8.0의 주요 개선 사항 열두 가지를 운영 관점에서 검토한 글을 정리했습니다. 쓰기 성능과 쿼리 실행, 샤딩 운영 기능, 메모리 할당자와 검색 기능까지 다루고, 검토 중 MongoDB에 제보한 주의 사항도 요약합니다."
date: 2026-11-14
weight: 1
---

# MongoDB 8.0 업그레이드를 검토하는 12가지 이유 (2025-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [MongoDB 8.0 업그레이드 해야하는 12가지 이유](https://tech.kakao.com/posts/803)
- 매체 · 게시일: 카카오 기술블로그 · 2025-12-17
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 글의 전제 {#전제}

카카오는 새 MongoDB GA 버전이 나오면 약 1년의 안정화 기간을 두고 충분히 검증된 시점에 업그레이드를 검토합니다. 8.0이 출시 1년쯤 된 시점에 DBA 관점으로 주요 개선 사항을 검토한 결과가 이 글입니다. 업그레이드는 성능이 오히려 떨어지는 사례도 흔해 늘 조심스러운 일이고, MongoDB도 기능을 많이 넣는 대신 성능에는 아쉬운 평가가 있었는데 8.0은 성능과 안정성 개선에 많이 투자했다고 MongoDB가 강조한다는 소개로 시작합니다.

## 성능과 쿼리 실행 개선 {#성능-쿼리}

지원 정책(1번). 메이저 버전의 지원 기간이 약 3년이었는데 8.0은 2024년 10월 출시 뒤 2029년 10월 31일까지 약 5년 지원이 예정되어 있습니다. MongoDB가 LTS라고 공식 명명한 것은 아니지만 장기 운용을 전제한 정책 변화로 볼 수 있다는 해석입니다. 8.2부터는 Atlas 전용이던 래피드 릴리스가 온프레미스의 마이너 릴리스로 확장되어, 안정성을 우선할지 새 기능을 빨리 쓸지 서비스별로 고를 여지가 생겼습니다.

Write Concern majority(2번). 5.0부터 기본값이 된 majority는 내구성을 보장하는 대신 쓰기 성능 저하의 원인으로 꼽혔습니다. 8.0은 세컨더리가 majority 여부를 판단하는 기준을 데이터 파일에 적용한 시점(`lastApplied`)에서 oplog.rs에 쓴 시점(`lastWritten`)으로 바꿨습니다. 세컨더리의 복제를 Fetch, Write, Apply 세 단계로 보면 Apply를 기다릴 필요가 없어진 것입니다. YCSB, mongo-perf, 사내 도구로 측정한 결과 7.0 대비 쓰기 처리량이 약 30~47% 올랐고 배치가 클수록 개선 폭이 컸으며, MongoDB 공식 수치와 대체로 맞았습니다. 대가로 majority 쓰기 직후 세컨더리를 읽으면 아직 Apply 전이라 최신 변경이 안 보일 수 있고, 이는 인과적 일관성 세션(Causally Consistent Session)으로 보완할 수 있습니다. OplogWriter와 OplogApplier 사이에 새 버퍼가 생겨 `metrics.repl.buffer.*` 메트릭이 `apply`와 `write`로 나뉘었으니 모니터링 때 확인해야 합니다.

Bulk Write(3번). 여러 컬렉션을 한 요청으로 처리하는 `bulkWrite` 데이터베이스 명령이 새로 생겼고(컬렉션은 `nsInfo` 배열로 지정), 벌크 insert의 oplog 엔트리를 가능한 한 하나로 묶습니다. 이전에는 도큐먼트마다 엔트리가 있었지만 WiredTiger가 이미 벌크 insert를 단일 트랜잭션으로 처리하므로 비효율이었습니다. 묶는 한도는 `internalInsertMaxBatchSize`(기본 500)입니다. 세컨더리 동기화 효율이 오르고 복제 지연 가능성이 줄어 대규모 쓰기 환경에서 효과를 기대합니다.

Express Plan(4번). `_id` 단건 조회는 이전에도 IDHACK 스테이지가 있었지만 그 앞의 범용 쿼리 플래닝 비용이 남아 있었습니다. 8.0의 Express Plan은 조건이 맞으면 파싱 직후 플래닝, 플랜 캐시 조회, Executor 구성, Halloween Problem 검증을 모두 건너뜁니다. 대상은 `_id` 단일 값 조회(IdPointQueryEligible)와 유니크 인덱스 또는 `limit: 1`로 단건이 보장되는 조회(IndexedEqualityEligible)이고, hint, sort, skip이나 범위, 정규식이 있으면 기존 방식으로 돌아갑니다. 단일 스레드 mongo-perf에서 7.0 대비 처리량이 평균 45% 이상 오르고 응답 시간은 약 30% 줄었습니다.

쿼리 형태 기반 제어(8번). 기존 `cursor.hint()`는 클라이언트 코드를 고쳐야 하고 삭제된 인덱스를 몰라 장애를 낼 수 있었습니다. Index Filter는 노드마다 설정해야 하고 재시작하면 사라지며 엉뚱한 인덱스를 지정해도 그대로 풀스캔을 유발했습니다. 8.0은 쿼리 구조를 식별하는 Query Shape과 그 단위로 정책을 거는 Query Settings(`setQuerySettings`)를 도입하며 Index Filter를 완전히 제거했습니다. 설정은 클러스터 전체에 영구 적용되고, `indexHints`, `queryFramework`(classic 또는 sbe), `reject`(해당 형태 쿼리 차단), `comment`를 지정할 수 있습니다. 못 쓰는 인덱스가 걸리면 쿼리 세팅을 무시하고 플래너를 다시 돌리므로 쓰지 않는 설정은 정리해야 합니다. Query Shape 식별에는 값을 지우고 타입만 남겨 SHA256으로 만든 `queryShapeHash`를 씁니다. 기존 `queryHash`는 `planCacheShapeHash`로 이름이 바뀌었습니다.

## 샤딩 운영 기능 {#샤딩-운영}

Resharding(5번). 5.0의 Live Resharding은 실무에 바로 쓰기 어려웠지만 8.0에서 성능과 안정성이 크게 좋아졌고, 같은 샤드키로 재분배하는 `forceRedistribution` 옵션이 생겼습니다. Coordinator, Donor, Recipient 세 서비스가 상태 기계로 움직이며, 흐름은 이렇습니다. 새 샤드키 기준으로 청크 메타데이터를 만들고, Donor oplog에 `destinedRecipient`를 붙이기 시작한 가장 큰 `minFetchTimestamp`를 `cloneTimestamp`로 정합니다. Recipient는 임시 컬렉션에 snapshot read로 복제하는데, 8.0부터는 인덱스 스캔 대신 `$natural` 전체 조회로 복제하고 인덱스 빌드는 복제가 끝난 뒤로 미뤄 성능이 크게 개선됐습니다. 이어 oplog를 따라잡다가 임계치 `remainingReshardingOperationTimeThresholdMillis`를 만족하면(기본값이 2초에서 500ms로 줄었습니다) 쓰기를 막고 마저 반영한 뒤 임시 컬렉션 이름을 바꿔 커밋합니다. 쓰기 중단이 최대 2초 일어나므로 허용 가능한지 미리 확인해야 하고, 임시 컬렉션에 전부 복제하므로 충분한 디스크 공간이 필요합니다. `forceRedistribution`은 신규 샤드 추가 때 백그라운드 밸런싱을 오래 기다리거나 Stale Config로 쿼리가 지연되는 문제를 피할 수 있어 대규모 서비스에서 검토할 만하다고 봅니다.

컬렉션 이동과 샤딩 해제(6번). 이전에는 `movePrimary`가 이동 중 데이터베이스의 모든 요청을 막았고, 샤딩된 컬렉션을 되돌리는 명령이 없어 새 컬렉션으로 마이그레이션해야 했습니다. 8.0은 리샤딩을 활용한 `moveCollection`과 `unshardCollection`을 공식 지원합니다. 결과 컬렉션은 `unsplittable` 플래그로 구분되어 샤딩 컬렉션의 제약을 받지 않습니다. 자주 쓸 명령은 아니지만 공용 클러스터에서 트래픽에 따라 샤딩을 걸었다 풀며 자원을 유연하게 쓰는 운영이 가능해진다고 봅니다.

샤드키 필터 완화(7번). `findAndModify`, `deleteOne`, `upsert` 있는 `updateOne`이 7.0까지는 필터에 샤드키가 필요해 `ShardKeyNotFound` 오류가 났지만 8.0에서는 불필요합니다. 먼저 `_clusterQueryWithoutShardKey`로 관련 샤드에 단건 조회를 보내 대상 샤드를 하나 고르고, 이어 `_clusterWriteWithoutShardKey`가 그 샤드에만 쓰는 Two-Phase Protocol입니다. 단일 샤드 트랜잭션이라 2PC와는 다릅니다. 최소 두 번의 왕복이 필요해 성능을 위해서는 여전히 샤드키를 필터에 넣는 것이 권장됩니다.

Config Shard(9번). 컨피그 서버가 사용자 데이터도 저장할 수 있게 되어, 단일 샤드 클러스터에도 필요하던 컨피그 서버 3노드를 따로 둘 필요가 줄었습니다. `transitionFromDedicatedConfigServer`와 `transitionToDedicatedConfigServer`로 전환합니다. 처음엔 레플리카 셋처럼 쓰다 필요할 때 샤드를 늘릴 수 있으나, Queryable Encryption 컬렉션이 있거나 온프레미스 Queryable Backup을 쓰면 쓸 수 없습니다. 메타데이터와 사용자 워크로드를 함께 처리하므로 테스트나 소규모 운영에 권장하고, 일정 규모 이상에서는 전용 컨피그 서버가 안정성에 유리하다고 봅니다.

## 내부 개선과 검색 {#내부-개선}

PBWM 제거(10번). 세컨더리가 oplog 배치를 병렬 적용할 때 쓰는 글로벌 락 PBWM은 배치 동안 읽기를 모두 대기시켰습니다. 4.0부터 `lastApplied` 기반 timestamp 조회로, 5.0의 Lock-Free Operations로 상당 부분 풀렸고, 7.1에서 락을 제거하기로 결정해 커뮤니티 바이너리 기준 8.0에서 락으로 인한 위험이 모두 사라졌습니다. 대부분의 서비스가 체감하기는 어렵다고 합니다.

Per-CPU TCMalloc(11번). MongoDB가 쓰는 TCMalloc은 스레드가 많으면 캐시가 분산되고 파편화가 생기는 문제가 지적되어 왔습니다. 8.0은 캐시 수가 스레드 수가 아닌 CPU 코어 수에 비례하는 Per-CPU Cache를 적용했고, Linux Kernel 4.18의 rseq로 대부분의 요청을 코어 안에서 잠금 없이 처리합니다. 백엔드에는 Hugepage-Aware PageHeap이 들어가 2MB 단위로 메모리를 관리하므로 8.0부터 THP 활성화를 권장합니다(대부분의 DBMS는 THP 비활성화를 권했습니다). `usingPerCPUCaches` 같은 메트릭이 추가됐습니다. 상세는 공식 문서를 참고하라고 원문이 권합니다.

MongoDB Search(12번). 8.0 자체 기능은 아니지만 8.2부터 Atlas 전용이던 Lucene 기반 전문 검색과 Vector Search가 Community Edition에서 Public Preview로 열렸고 내년 정식 릴리스가 예정되어 있습니다. 별도 프로세스 `mongot`가 Change Streams로 `mongod` 데이터를 동기화해 검색 인덱스를 만들고, `$search`를 받은 `mongod`가 `mongot`가 돌려준 `_id` 목록으로 도큐먼트를 조회합니다. `mongot`는 레플리카 셋을 syncSource로 잡을 수 있고 검색 요청이 stateless라 GSLB나 DNS로 여러 대를 묶을 수 있습니다. 중단이 길어 oplog 보관 기간을 넘기면 Initial Sync로 인덱스를 다시 만들어야 하므로 oplog 보관 기간을 넉넉히 잡아야 합니다. 원문은 Elasticsearch 대비 기능 다양성은 아직 부족하므로 검색 요구사항을 검토한 뒤 도입하라고 덧붙입니다.

## 검토 중 제보한 주의 사항 {#제보-사항}

카카오가 검토 중 발견해 MongoDB에 제보한 사항이 있고, 일부는 최신 버전에서 수정됐으며 일부는 진행 중이라고 합니다.

- sort 옵션: 8.0부터 `updateOne()`과 `replaceOne()`에도 정렬 옵션을 줄 수 있습니다. 하지만 8.0 호환성을 충족하는 Node.js 드라이버 6.16.0에는 구현이 없어 무시되고, 같은 드라이버를 쓰는 mongosh 2.5.6도 같았습니다. 드라이버 6.17.0, mongosh 2.5.7에서 해결됐으므로 엉뚱한 도큐먼트가 갱신되면 드라이버를 올리라고 합니다.
- 샤딩 컬렉션의 `_id` 필터: `_id`가 샤드키가 아니면 샤드 간 고유성을 보장하지 않지만 MongoDB는 애플리케이션이 이를 지킨다고 가정합니다. 서로 다른 샤드에 같은 `_id`가 있는 상태에서 `{_id: 10}`으로 `updateOne()`을 하면 Two-Phase Protocol이 적용되지 않고 브로드캐스트되어 두 도큐먼트가 모두 갱신되는데 `matchedCount`와 `modifiedCount`는 1로 나옵니다. 건수 표시 불일치는 단순 버그라 곧 패치될 예정이고, `_id` 고유 가정 자체는 얽힌 부분이 많아 해결책에 시간이 걸릴 것으로 봅니다. 드라이버가 만드는 ObjectId를 쓰거나 `_id`를 샤드키로 지정하라고 권합니다.
- 공식 문서: 변경이 많아 문서에 반영되지 않은 동작과 파라미터가 있고, 확인한 부분은 수정을 요청했으며 서비스 운영에 문제될 정도는 아니었다고 합니다.

원문은 성능 향상을 체감하고 운영 편의성도 늘었다고 판단해 8.0을 좋게 평가하지만, 항상 최신 버전이 정답은 아니며 팀 상황과 서비스 특성에 맞는 시점을 고르는 것이 중요하다고 맺습니다.

{{% details title="원문이 든 측정값과 설정값" closed="true" %}}

| 항목 | 값 |
|---|---|
| 지원 기간 | 8.0은 2024년 10월 출시, 2029년 10월 31일까지 약 5년 (기존 약 3년) |
| majority 쓰기 처리량 | 7.0 대비 약 30~47% 향상, 배치가 클수록 개선 폭 증가 |
| majority 판단 기준 | `lastApplied`에서 `lastWritten`으로 변경 |
| Bulk insert oplog 묶음 한도 | `internalInsertMaxBatchSize` 기본 500 |
| Express Plan 개선 | 평균 처리량 45% 이상 향상, 응답 시간 약 30% 감소 |
| Queries.IntNonIdFindOne | 43,092에서 64,365 ops/s (+49.4%), 0.0232에서 0.0155 ms/op (-33.0%) |
| Queries.IdentityView.IntNonIdFindOne | 52,530에서 77,443 ops/s (+47.4%), 0.0190에서 0.0129 ms/op (-32.2%) |
| Queries.NonIdFindOne | 39,281에서 58,824 ops/s (+49.8%), 0.0255에서 0.0170 ms/op (-33.3%) |
| 리샤딩 임계치 기본값 | `remainingReshardingOperationTimeThresholdMillis` 2초에서 500ms |
| 리샤딩 쓰기 중단 | 최대 2초 |
| queryShapeHash | SHA256, 64자리 16진수 |
| planCacheShapeHash (구 queryHash) | MurmurHash, 8자리 16진수 |
| Per-CPU Cache 조건 | Linux Kernel 4.18 이상, rseq 사용 가능 |
| sort 옵션 수정 | Node.js 드라이버 6.17.0, mongosh 2.5.7 |

{{% /details %}}
