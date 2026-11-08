---
title: "VictoriaLogs vs Elasticsearch — 로그 한 줄이 저장되는 모양과 자원 차이"
linkTitle: "ES vs VictoriaLogs"
description: "두 엔진이 로그 한 줄을 어디에 어떤 모양으로 저장하는지 같은 배치의 도식으로 나란히 놓습니다. 그 차이가 메모리와 디스크 사용량으로 이어지는 지점을 공식 문서와 벤더 주장으로 나눠 확인합니다."
weight: 90
date: 2026-11-09
url: "/logging/victorialogs-internals/es-vs-victorialogs/"
---

# VictoriaLogs vs Elasticsearch — 로그 한 줄이 저장되는 모양과 자원 차이

VictoriaLogs 문서는 Elasticsearch보다 RAM을 최대 30배, 디스크를 최대 15배 적게 쓴다고 말합니다. 이 글은 그 말을 믿을지 정하기보다, 두 엔진이 로그 한 줄을 저장하는 모양을 나란히 놓고 차이가 어디서 생기는지를 따라갑니다. 쿼리 언어와 에코시스템의 비교는 범위 밖입니다.

조사 기준일은 2026-11-09이고, 버전은 VictoriaLogs v1.53.0(2026-10-01 릴리스)과 Elasticsearch 9.5.6(2026-11-02 릴리스)입니다. Elasticsearch는 9.0부터 `logs-*-*` 데이터 스트림에 logsdb 모드가 기본으로 켜져서, 8.x 시절의 기본 설정과는 비교 대상이 다릅니다. VictoriaLogs의 데이터 모델은 [로그 한 줄의 저장 경로]({{< relref "/observability/logs/victorialogs-internals/01-data-model/index.md" >}})에서 먼저 다뤘습니다.

## Elasticsearch가 로그 한 줄을 저장하는 모양 {#es-저장}

Elasticsearch에서 인덱스는 샤드로 나뉘고, 샤드 하나가 곧 Lucene 인덱스입니다. 샤드 안의 데이터는 한 번 쓰면 바뀌지 않는 세그먼트에 쌓이고, 작은 세그먼트는 백그라운드에서 큰 세그먼트로 병합됩니다.

기본(standard) 모드에서는 같은 값이 세그먼트 안에 세 번 들어갑니다. 필드마다 term에서 문서 목록으로 가는 역색인이 있고, 정렬과 집계를 위한 컬럼 구조인 doc_values가 있으며, 받은 JSON을 그대로 보관하는 `_source`가 있습니다. 세그먼트의 메타데이터와 매핑 필드 정보 일부는 JVM 힙에 올라가고, 데이터 파일은 힙 바깥의 파일시스템 캐시가 맡습니다.

{{< flow src="_flow/1-elasticsearch-저장.json" />}}

## VictoriaLogs가 로그 한 줄을 저장하는 모양 {#vl-저장}

VictoriaLogs는 로그를 UTC 하루 단위 파티션에 넣습니다. 파티션 안에서 `datadb`는 불변 part를 모아 두고, `indexdb`는 그날 어떤 스트림이 있는지를 적은 카탈로그입니다. part 안의 블록은 한 스트림의 행만 담고, 블록은 필드별 컬럼 파일로 갈라집니다. 컬럼마다 블룸 필터가 짝을 이루어, 검색어가 없다고 확실한 블록은 열지 않습니다. 스트림과 파티션 배정은 [1편]({{< relref "/observability/logs/victorialogs-internals/01-data-model/index.md" >}})에서 다뤘습니다.

원본 JSON은 따로 두지 않고 평탄화한 필드 컬럼만 저장합니다. 메모리에 상주하는 것은 블록의 위치를 찾는 metaindex 정도이고, 나머지 데이터와 블룸 파일은 운영체제의 페이지 캐시에 맡깁니다. 아래 도식은 앞 도식과 같은 열과 행에 같은 역할을 놓았습니다. 달라진 곳은 `indexdb`가 생긴 자리와, 원본 문서 자리가 비어 있는 점입니다.

{{< flow src="_flow/2-victorialogs-저장.json" />}}

## 구조 대응표 {#구조-대응}

| 역할 | Elasticsearch | VictoriaLogs | 자원에 미치는 영향 |
|---|---|---|---|
| 시간 단위 분할 | 데이터 스트림의 backing index | 일 파티션 | VictoriaLogs는 보존 만료가 디렉터리 삭제 |
| 수평 분할 | 샤드와 레플리카 | 클러스터의 vlstorage 노드, 복제 없음 | 샤드 수가 늘수록 Elasticsearch는 힙 오버헤드가 커짐 |
| 불변 저장 단위 | 세그먼트 | part | 둘 다 백그라운드 병합 |
| 검색 색인 | 필드별 역색인 | 블록·컬럼별 블룸 필터 | 블룸은 문서 위치 목록이 없어 색인이 작음 |
| 스트림 색인 | 없음, keyword 역색인으로 대체 | indexdb | 스트림 필터가 블록 읽기 전에 후보를 줄임 |
| 컬럼 저장 | doc_values | 컬럼 파일 | VictoriaLogs는 dict, const, 숫자, IP로 인코딩 |
| 원본 문서 | `_source` | 없음 | 같은 값의 중복 저장 여부가 갈림 |
| 점수 데이터 | norms | 없음 | norms는 필드당 문서당 약 1바이트 |
| 스키마 | 매핑, 기본 필드 상한 1000 | 스키마리스, 엔트리당 필드 상한 2000 | 사전 매핑과 필드 메타데이터 부담이 갈림 |
| 메모리 | JVM 힙 + 파일시스템 캐시 | Go 프로세스 캐시 + 페이지 캐시 | 힙 상한과 오버헤드 규칙의 유무 |
| 압축 | stored fields는 LZ4, `best_compression`은 ZSTD | 컬럼 블롭에 zstd level 1~3 | 압축 대상이 문서인지 컬럼인지가 다름 |
| 콜드 티어 | searchable snapshot, frozen tier | 미지원, 로드맵 항목 | 오래된 로그의 저장 비용에서 갈림 |

## 자원 차이가 생기는 지점 {#자원-차이}

차이가 생기는 곳은 다섯 군데입니다. 근거 열의 "공식 문서"는 양쪽 공식 문서가 구조를 서술한다는 뜻이고, "구조상 추정"은 구조에서 따라 나오지만 크기를 비교한 공식 수치는 없다는 뜻입니다.

| 지점 | 구조 차이 | 근거 성격 | 대가 |
|---|---|---|---|
| 인덱스 크기 | 역색인은 term과 문서 위치 목록을 저장하고, 블룸은 블록의 고유 토큰만 토큰당 약 2바이트로 기록 | 구조는 공식 문서, 크기가 작다는 결론은 구조상 추정 | 블룸이 통과시킨 블록은 통째로 풀어 스캔 |
| 압축률 | 스트림별로 비슷한 줄을 모으고 컬럼마다 타입에 맞게 인코딩한 뒤 zstd | 공식 문서가 "보통 10배 이상" 압축이라 설명, 이 수치는 벤더 주장 | Elasticsearch도 logsdb에서 정렬로 같은 효과를 노림 |
| 원본 중복 | standard 모드는 역색인, doc_values, `_source`에 같은 값이 공존 | 공식 문서 조합으로 확인, 중복 크기 비율은 미확인 | VictoriaLogs는 원본 키 순서와 중첩 구조를 보존하지 않음 |
| 메모리 | Elasticsearch는 힙(노드 메모리의 50% 이하, 대개 약 30GB 이하)과 세그먼트·필드·샤드별 오버헤드, VictoriaLogs는 metaindex만 상주 | 구조는 공식 문서, 가볍다는 정량 근거는 벤더 주장 | 페이지 캐시가 모자라면 읽기가 디스크로 직행 |
| 스키마 | Elasticsearch는 동적 매핑이 필드마다 매핑을 만들고, 문자열은 text와 keyword 서브필드로 이중 색인 | 공식 문서 | VictoriaLogs도 고유 키가 많은 JSON은 넣지 말라고 경고 |

압축률 항목은 VictoriaLogs의 고유한 장점이라기보다 Elasticsearch의 standard 모드와 견줄 때 보이는 차이입니다. logsdb는 `host.name`과 `@timestamp`로 정렬하고 ZSTD를 기본으로 써서 같은 방향의 최적화를 합니다. 원본 중복도 마찬가지여서, 유료 구독의 synthetic `_source`를 쓰면 `_source`를 따로 저장하지 않아도 됩니다.

쿼리가 데이터를 읽지 않고 건너뛰는 경로도 구조의 일부입니다. 인덱스가 작은 대신 읽기 전에 후보를 줄이는 단계가 여럿 있습니다.

{{< flow src="_flow/3-victorialogs-건너뛰기.json" />}}

## 벤치마크의 수치와 조건 {#벤치마크}

배수를 비교하기 전에 측정한 쪽과 조건부터 봐야 합니다. 아래 수치는 모두 표에 적은 시점의 버전과 설정에서 나온 값입니다.

| 측정자 | 대상과 시점 | 조건 | 결과 | 성격 |
|---|---|---|---|---|
| VictoriaLogs 벤치 스위트 | Elasticsearch 8.8.0, 결과 커밋 2023-10-13 | 단일 노드, 힙 2GB, 초당 1만 줄, 약 1시간 구간, 쿼리 부하 없음 | 메모리 평균 4.44GiB 대 144MiB, 디스크 평균 53.9GB 대 4.20GB | 벤더 |
| JSONBench (ClickHouse 운영) | VictoriaLogs v1.17.0(2025-03-28), Elasticsearch 8.17.0(2025-01-14) | Bluesky JSON 10억 건, `best_compression`, standard 모드 | VictoriaLogs 121.9GB, Elasticsearch 386.1GB(`_source` 제외 235.8GB) | 제3자, 경쟁사 주관 |
| 사용자 게시글(2025-05-28, Write-Ahead 1편이 인용) | Elasticsearch 27노드에서 VictoriaLogs 단일 노드로 이전 | 보존량과 조건 미확인 | 588코어·RAM 4656GB에서 8코어·64GB로 | 제3자, 일화 |
| Elastic의 logsdb 발표 | Elasticsearch logsdb, 2024-12와 8.19·9.1 글 | 8.17 standard 모드와 비교 | 저장 최대 65% 절감, 최대 4배 효율, 색인 처리량 손해 최대 10% | 벤더 |

첫 줄의 배수는 메모리 약 31배, 디스크 약 13배이며 문서가 말하는 30배와 15배는 이 측정이 출처입니다. 이 측정에는 logsdb가 없었고, 메모리 지표가 페이지 캐시를 포함하는지도 확인하지 못했습니다. JSONBench의 배수는 3.2배와 1.9배로 훨씬 작은데, 로그가 아닌 이벤트 JSON이고 VictoriaLogs는 구조를 보존하지 않으며 Elasticsearch logsdb는 쓰지 않았다는 한계가 있습니다. VictoriaLogs와 Elasticsearch logsdb를 직접 견준 공개 벤치마크는 찾지 못했습니다. 2023년의 15배와 30배가 9.x 기준으로 다시 측정된 적은 없다는 뜻입니다.

## Elasticsearch가 앞서는 곳과 VictoriaLogs의 한계 {#한계}

| 항목 | Elasticsearch | VictoriaLogs |
|---|---|---|
| 정확한 필드 값 조회 | 역색인이 term에서 문서 목록으로 바로 접근 | 블룸을 통과한 블록을 풀어 스캔, 넓은 기간·고카디널리티 지연은 공개 비교 없음 |
| 검색 기능과 에코시스템 | 점수 기반 검색, 하이라이트, ES\|QL, 집계, Kibana, 보안, ML | 공식 기능 목록 수준의 비교만 가능, 성능 비교는 미확인 |
| 오브젝트 스토리지 티어 | searchable snapshot, frozen tier | 미지원, 이슈 #48이 2026-11-05 기준 열려 있음 |
| 복제와 고가용성 | 샤드 레플리카로 클러스터 내부 복제 | vlinsert는 복제 없이 샤딩만 하고, vlstorage 하나가 내려가면 쿼리는 기본 502 |
| 문서 구조 보존 | `_source`가 원본 그대로 | 평탄화하여 키 순서와 중첩 구조를 보존하지 않음 |
| 필드와 줄 크기 | 기본 필드 상한 1000 | 엔트리당 필드 2000, 줄 최대 2MB, 필드명 128바이트 |

VictoriaLogs에서 고가용성이 필요하면 vlagent로 독립된 클러스터 두 벌에 이중 전송하고 vmauth로 라우팅하는 방법이 문서에 있습니다. 오브젝트 스토리지가 없는 동안의 대안은 스냅샷을 rclone으로 S3에 백업하거나, NVMe 인스턴스에서 HDD 인스턴스로 오래된 파티션을 옮기는 것입니다.

## 조건별 선택 {#선택}

로그를 주로 시간 범위와 스트림으로 좁혀서 읽고, 보존 기간 안의 데이터를 로컬 디스크에 둘 수 있다면 VictoriaLogs의 구조가 자원 면에서 유리하게 작동합니다. 이 판단은 구조에서 나오며, 크기는 여러 측정에서 방향이 일치하지만 배수는 조건에 따라 2배 안팎부터 30배까지 갈립니다.

반대로 검색 결과에 점수를 매기거나 Kibana와 보안 기능을 쓰고 있다면 역색인과 에코시스템을 포기하는 비용이 자원 절감보다 클 수 있습니다. 오래된 로그를 오브젝트 스토리지에 두는 구성이나 클러스터 내부 복제가 요구 조건이라면 지금은 Elasticsearch 쪽만 문서화된 길이 있습니다.

이미 Elasticsearch 9.x의 logsdb를 쓰고 있다면 이전의 이득은 이 글의 배수보다 작을 수 있습니다. 이전을 검토할 때는 자신의 로그를 같은 조건으로 두 엔진에 흘려 보내 측정하는 것이 이 글의 어떤 수치보다 신뢰할 만합니다.

{{% details title="근거와 출처" closed="true" %}}

확인일은 모두 2026-11-09입니다. 성격 열의 "공식"은 공식 문서, "소스"는 소스 코드, "벤더"는 벤더 주장, "제3자"는 제3자 벤치나 글, "추정"은 이 글의 추론입니다.

| 항목 | 출처 | 성격 |
|---|---|---|
| VictoriaLogs 저장 구조(파티션, part, 블록, 컬럼, 블룸, 압축, 메모리) | https://victoriametrics.com/blog/victorialogs-internals-columnar-storage-on-disk/ | 공식 |
| 스트림 필드, 평탄화, 필드 상한, 용량 계획 | https://docs.victoriametrics.com/victorialogs/keyconcepts/ , https://docs.victoriametrics.com/victorialogs/faq/ | 공식 |
| 타입 인코딩과 압축 레벨 | https://github.com/VictoriaMetrics/VictoriaLogs/tree/master/lib/logstorage | 소스 |
| VictoriaLogs 변경 이력, v1.53.0 | https://docs.victoriametrics.com/victorialogs/changelog/ | 공식 |
| 클러스터 복제와 장애 동작 | https://docs.victoriametrics.com/victorialogs/cluster/ | 공식 |
| 오브젝트 스토리지 로드맵 | https://docs.victoriametrics.com/victorialogs/roadmap/ , https://github.com/VictoriaMetrics/VictoriaLogs/issues/48 | 공식 |
| RAM 30배·디스크 15배 주장 | VictoriaLogs 문서 Features·FAQ | 벤더 |
| 벤치 스위트와 결과 | https://github.com/VictoriaMetrics/VictoriaLogs/tree/master/deployment/logs-benchmark | 벤더, 결과는 이미지 판독 |
| JSONBench | https://github.com/ClickHouse/JSONBench | 제3자 |
| 27노드 교체 사용자 게시글(2025-05-28) | https://write-ahead.github.io/victorialogs/internals/storage-engine/data-model/ 의 인용 | 제3자, 일화 |
| Elasticsearch 버전 | https://github.com/elastic/elasticsearch/releases | 공식 |
| 세그먼트 병합 | https://www.elastic.co/docs/reference/elasticsearch/index-settings/merge | 공식 |
| 역색인과 doc_values | https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/doc-values | 공식 |
| `_source`, 디스크 사용 | https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/mapping-source-field , https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/disk-usage | 공식 |
| norms | https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/norms | 공식 |
| 압축 codec | https://www.elastic.co/docs/reference/elasticsearch/index-settings/index-modules | 공식 |
| JVM 힙 | https://www.elastic.co/docs/reference/elasticsearch/jvm-settings | 공식 |
| 샤드와 힙 오버헤드, frozen tier | https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/size-shards | 공식 |
| 매핑 필드 상한 | https://www.elastic.co/docs/reference/elasticsearch/index-settings/mapping-limit | 공식 |
| logsdb 모드 | https://www.elastic.co/docs/manage-data/data-store/data-streams/logs-data-stream | 공식 |
| logsdb 절감 수치 | https://www.elastic.co/search-labs/blog/elastic-logsdb-tsds-enhancements | 벤더 |
| 블룸이 인덱스를 작게 만든다는 결론, 원본 중복의 크기 | 구조에서 도출, 크기 비교 수치 없음 | 추정 |

{{% /details %}}
