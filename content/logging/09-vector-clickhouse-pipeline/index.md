---
title: "수집 경로 다시 그리기 — Vector와 ClickHouse"
linkTitle: "Vector · ClickHouse 파이프라인"
description: "Fluent Bit → Firehose → OpenSearch 파이프라인에서 앞의 두 단을 Vector로 바꾸는 네 가지 방법과, 저장소를 ClickHouse로 옮길 때 적재 경로에서 달라지는 점을 검토합니다."
weight: 9
date: 2026-10-04
lastmod: 2026-10-04
---

# 수집 경로 다시 그리기 — Fluent Bit·Firehose를 Vector로, 저장소를 ClickHouse로

이 연재는 지금까지 저장소를 골랐습니다. [OpenSearch]({{< relref "/logging/01-opensearch.md" >}})의 요금 구조를 뜯어봤고 [ClickHouse]({{< relref "/logging/04-clickhouse.md" >}})를 후보로 평가했지만, 로그가 저장소에 닿기까지의 길인 `fluent-bit → Firehose → OpenSearch`의 앞 두 단은 "정석 구성"이라고만 적고 지나갔습니다. 이 글은 그 앞단으로 돌아갑니다. Fluent Bit과 Firehose를 Vector로 바꾸는 방법이 몇 가지인지, 각각 무엇을 얻고 무엇을 직접 떠안는지를 먼저 보고, 이어서 저장소가 ClickHouse일 때 적재 경로가 어떻게 달라지는지를 한 구성으로 묶어 봅니다.

홈랩에서는 같은 조합을 이미 돌리고 있습니다. 수집기 셋을 나란히 돌려 Vector를 남긴 경위와 실측은 [관측 스택 일원화]({{< relref "/homelab/03-observability-consolidation/index.md" >}})에 있습니다. 여기서 다루는 것은 AWS 관리형 구성에서 출발하는 경우이고, 수치는 공식 문서와 공개 사례에서 가져온 것이라 우리 로그로 잰 값이 아닙니다. 버전은 2026-10-04 기준으로 Vector 0.58.0, Fluent Bit 5.1.3, ClickHouse 26.9입니다.

## 1. 지금 파이프라인에서 Firehose가 하는 일

{{< flow src="_flow/1-현재-파이프라인.json" />}}

Firehose를 걷어낼지 정하려면 Firehose가 대신 해주던 일을 먼저 적어야 합니다. 대상이 OpenSearch일 때 버퍼는 크기 1~100MB(기본 5MB), 간격 0~900초(기본 300초)이고 둘 중 먼저 찬 쪽이 전송을 일으킵니다 `✓`. 기본값이라면 한가한 시간대의 로그는 최대 5분 늦게 검색됩니다. OpenSearch가 받지 못하면 0~7200초 범위에서 정한 기간만큼 재시도하고, 그 뒤에는 해당 문서를 S3의 `AmazonOpenSearchService_failed/` 아래에 남기고 넘어갑니다 `✓`. Direct PUT으로 받은 레코드는 대상이 죽어 있어도 24시간까지 보관합니다. 이 세 가지(버퍼, 재시도, 실패분 보관)가 운영자 손을 타지 않고 돌아간다는 점이 Firehose의 값어치입니다.

요금은 수집 GB당 $0.029(us-east-1, 첫 500TB)로 보이지만 Direct PUT에는 레코드마다 5KB 단위로 올림하는 규칙이 붙습니다 `✓`. 3KB 레코드는 5KB로, 12KB 레코드는 15KB로 계산합니다. 컨테이너 로그 한 줄은 수백 바이트인 경우가 많아서, 한 줄을 레코드 하나로 보내면 실제 바이트의 열 배 안팎이 과금량으로 잡힐 수 있습니다 `≈`. Fluent Bit의 `kinesis_firehose` 출력에는 여러 줄을 한 레코드로 묶는 `simple_aggregation` 옵션이 있고 기본은 꺼져 있습니다. Firehose 요금이 거슬린다면 구조를 바꾸기 전에 이 옵션부터 확인할 만합니다.

변환이 필요하면 Lambda를 끼우게 되는데 여기에도 한도가 있습니다. 호출당 요청·응답이 각각 6MB, 실행 시간은 최대 5분이고, 세 번 재시도한 뒤에도 실패한 배치는 S3의 `processing-failed`로 빠집니다 `✓`. `PutRecordBatch`는 호출당 500건 또는 4MiB로 고정입니다.

## 2. 앞의 두 단을 바꾸는 네 가지 방법

Vector는 한 바이너리가 설정에 따라 노드마다 뜨는 agent도 되고 중앙에서 모으는 aggregator도 됩니다. 공식 Helm 차트의 `role`도 `Agent`(DaemonSet), `Aggregator`(StatefulSet), `Stateless-Aggregator`(Deployment) 셋으로 나뉩니다. Fluent Bit 자리에는 agent가, Firehose 자리에는 aggregator가 들어가므로 어느 쪽을 바꾸느냐에 따라 경우가 갈립니다.

| 방법 | 구성 | 얻는 것 | 떠안는 것 |
|---|---|---|---|
| a. 에이전트만 교체 | Vector agent → Firehose → OpenSearch | VRL로 변환을 옮겨 Lambda 제거 | Firehose 요금·지연은 그대로, 에이전트 메모리 증가 |
| b. Firehose만 교체 | Fluent Bit → Vector aggregator → OpenSearch | GB당 요금과 5KB 올림, 버퍼 지연 제거 | 버퍼·재시도·실패분 보관을 직접 운영 |
| c. 둘 다 교체 | Vector agent → Vector aggregator → OpenSearch | 도구와 설정 언어 하나, 다중 sink | b의 부담 + 에이전트 교체 위험 |
| d. 중간에 Kafka | agent → Kafka(MSK) → Vector → 저장소 | 내구성 버퍼, 오프셋을 되감는 재처리 | Kafka 비용과 운영 |

a는 넷 중 이득이 가장 작습니다. Vector의 `aws_kinesis_firehose` sink도 호출당 500건·4MiB 한도를 그대로 따르고, 여러 이벤트를 한 레코드로 묶는 옵션은 문서에서 찾지 못했습니다 `?`. 그렇다면 5KB 올림은 Fluent Bit에서 `simple_aggregation`을 켠 경우보다 오히려 불리해집니다. Lambda 변환을 없애는 것이 목적일 때만 고를 이유가 있습니다.

b는 에이전트를 건드리지 않고 Firehose 요금만 걷어내는 길입니다. Fluent Bit의 `forward` 출력을 Vector의 `fluent` 소스가 받습니다. 이 소스는 acknowledgement를 지원해서, aggregator가 OpenSearch에 써넣은 뒤에야 Fluent Bit에 수신을 확인해 줄 수 있습니다. 걸리는 점은 둘입니다. `fluent` 소스는 TLS는 되지만 forward 프로토콜의 shared key 인증은 받지 않습니다. 그리고 Fluent Bit 5.0부터 forward 출력의 `retain_metadata_in_forward_mode`가 기본으로 켜졌는데, 이 상태로 Vector가 문제없이 받는지는 확인하지 못했습니다 `?`.

c에서는 구간별 전달 보장이 b와 달라집니다. Vector의 `kubernetes_logs` 소스는 전달 보장이 best effort이고 acknowledgement를 지원하지 않습니다 `✓`. 어디까지 읽었는지는 체크포인트로 기억하지만, 뒷단이 막혀 읽기가 밀리는 동안 kubelet이 파일을 로테이션해 지우면 그 로그는 사라집니다. 이 사정은 Fluent Bit의 tail도 마찬가지입니다. 다만 "Vector로 통일하면 끝에서 끝까지 보장된다"고 기대했다면 그렇지 않다는 점을 알고 들어가야 합니다. agent에서 aggregator로 가는 `vector` sink부터는 acknowledgement가 이어집니다.

d는 유실을 허용할 수 없거나 같은 로그를 여러 소비자가 읽어야 할 때의 변형입니다. Vector의 `kafka` 소스는 acknowledgement를 지원하므로 저장소 적재가 끝난 뒤에 오프셋을 커밋할 수 있습니다. MSK를 IAM 인증으로 쓴다면 미리 확인할 것이 있습니다. `kafka` sink의 `sasl` 옵션은 PLAIN과 SCRAM 계열만 다루고, MSK IAM 지원 여부는 확인하지 못했습니다 `?`. 참고로 ClickHouse가 사내 로그 플랫폼(LogHouse)을 소개한 글은 Kafka 없이 agent → gateway → ClickHouse로 직결했다고 밝히고 `Ⓥ`, Zomato는 Kafka를 가운데 두었다고 알려져 있습니다 `?`.

표에 넣지 않은 선택지로 OpenSearch Ingestion(OSIS)이 있습니다. Data Prepper를 관리형으로 돌리는 서비스이고, 72시간 보관하는 persistent buffering을 켤 수 있어서 Firehose 자리를 AWS 관리형으로 유지하면서 변환까지 넣고 싶을 때 맞습니다. 로그가 흐르지 않아도 할당한 OCU만큼 과금됩니다.

## 3. Firehose를 빼면 직접 책임질 것

b와 c는 1절에서 적은 세 가지를 Vector 설정으로 다시 만들어야 합니다.

| Firehose가 해주던 일 | Vector에서의 대체 | 한계 |
|---|---|---|
| 24시간 관리형 보관 | aggregator의 디스크 버퍼 + PVC | 노드나 AZ를 잃으면 PVC가 다시 붙을 때까지 그 버퍼는 묶임, fsync 간격 500ms |
| 재시도(0~7200초) | sink 재시도 + `when_full: block` 백프레셔 | 버퍼가 차면 상류가 막히고 끝내 에이전트 구간에서 유실 |
| 실패분만 S3로 | `aws_s3` sink를 나란히 연결 | 실패분이 아니라 전량이 쌓임 |
| 부분 실패 처리 | `request_retry_partial: true` | 중복 가능, `id_key`로 문서 ID를 고정해야 멱등 |
| 용량 자동 확장 | HPA | StatefulSet을 줄일 때 PVC에 남은 버퍼 처리 |

차트 기본값은 `persistence.enabled: false`입니다. 이대로 디스크 버퍼를 켜면 버퍼가 Pod와 함께 사라지므로 PVC부터 켜야 합니다. 디스크 버퍼는 압축을 지원하지 않아 용량을 원본 크기로 잡아야 하고, 최소 크기는 약 256MiB입니다.

S3 sink를 나란히 붙일 때는 acknowledgement의 동작을 알아야 합니다. 한 입력을 여러 sink로 보내면 Vector는 모든 sink가 처리한 뒤에야 소스에 확인을 돌려줍니다. S3 쪽이 막히면 OpenSearch 적재까지 같이 밀립니다. sink마다 버퍼를 따로 두고, 보조 경로는 acknowledgement를 끄거나 `when_full: drop_newest`로 격리할지 정해야 합니다.

비용 항목도 하나 새로 생깁니다. Firehose는 리전 엔드포인트로 받았지만 aggregator는 특정 AZ의 Pod이므로, 다른 AZ의 agent가 보내는 트래픽에는 AZ 간 전송비가 붙습니다. `vector` sink의 `compression: zstd`로 바이트를 줄이거나 같은 AZ의 aggregator로 보내도록 라우팅해야 합니다.

## 4. Vector를 에이전트로 쓸 때 알아둘 것

Vector는 2021년에 Datadog이 인수한 MPL-2.0 프로젝트로, 여섯 주쯤마다 릴리스가 나옵니다. 아직 1.0 전이어서 0.58에도 호환이 깨지는 변경이 일곱 건 들어 있습니다. 버퍼 메트릭 `buffer_byte_size`와 `buffer_events`가 이 릴리스에서 없어졌으니 기존 대시보드가 있다면 고쳐야 합니다. 버전을 고정하고 릴리스 노트를 읽는 사람이 있어야 한다는 뜻입니다.

리소스는 Fluent Bit 쪽이 가볍습니다. VictoriaMetrics가 2026-03에 공개한 벤치마크(수집기당 1 CPU·1GiB 제한, 튜닝 없음)에서 초당 약 1만 건을 처리할 때 Fluent Bit 4.2.3은 0.26코어와 78MiB, Vector 0.53.0은 0.41코어와 154MiB를 썼습니다 `Ⓑ`. 최대 처리량은 Fluent Bit 31,300건, Vector 25,000건이었습니다. 측정한 쪽이 경쟁 수집기(vlagent)를 만드는 회사라는 점은 감안해야 하고, 두 수집기를 최신 버전으로 견준 독립 벤치마크는 찾지 못했습니다. Vector README의 성능표는 Vector 쪽 자체 측정이고 오래된 버전 기준이라 근거로 쓰지 않습니다.

`kubernetes_logs` 소스에는 열려 있는 이슈가 여럿 있습니다.

| 이슈 | 증상 | 상태 |
|---|---|---|
| #24981 | 로테이션 경계에 걸친 한 줄이 두 레코드로 쪼개짐 | open |
| #22954 | 생성 속도가 소비 속도를 넘는 중에 재시작하면 로테이션된 파일의 로그 유실 | open |
| #25385 | 한 Pod 경로에 watcher가 여럿 붙어 source lag이 2천 초대로 늘어남 | open |
| #26465 | 0.55 이후 백로그를 한꺼번에 읽어 메모리 폭증, 1분 안팎에 OOM | 2026-09-28 closed |

마지막 이슈는 129MB 백로그에 1.7GiB를 썼다는 보고이고 0.58.0도 영향 버전에 들어 있습니다. 닫히기는 했지만 수정이 어느 릴리스에 실리는지는 확인하지 못했습니다 `?`. 그때까지는 `read_from: end`로 두거나 메모리 한도를 넉넉히 주는 우회가 보고돼 있습니다. 홈랩에서 체크포인트 없이 새로 띄운 0.58.0 파드로 재현해 보니 `read_from: end`는 듣지 않았습니다. 일주일 전 로그부터 읽기 시작했고, 한도 512Mi에서는 파일을 찾은 직후 OOM으로 죽었습니다. 3Gi로 올리자 2분 남짓 동안 225만 건을 읽으며 1.1GiB를 넘겼다가 700MiB 선에서 멎었습니다 `✓`. 이 파드는 agent와 aggregator 역할을 한 프로세스에서 돌렸으니 소스만의 사용량은 아니지만, 새 노드에 agent가 처음 뜰 때의 메모리는 평소 한도와 따로 잡아야 한다는 점은 분명합니다. 홈랩에서 Fluent Bit과 Vector를 나란히 돌렸을 때 수집 건수는 2,400,004건과 2,399,840건으로 거의 같았지만, 그건 로그가 적은 클러스터에서의 결과입니다.

OTel Collector와는 역할이 겹칩니다. 둘 다 agent와 gateway를 겸하는데, Collector는 OTLP 세 신호와 수신기 생태계가, Vector는 VRL과 버퍼·acknowledgement 모델, 다중 sink 라우팅이 강점입니다. Vector의 `opentelemetry` 소스와 sink는 둘 다 beta이고 트레이스는 내부 타입 없이 key/value 맵으로 다룹니다. 로그만 Vector로 나르고 트레이스와 메트릭은 Collector에 두는 분담이 무리가 없습니다.

## 5. 저장소가 ClickHouse일 때 달라지는 것

저장소 자체의 장단점은 [ClickHouse 평가 글]({{< relref "/logging/04-clickhouse.md" >}})에서 다뤘으므로 여기서는 수집 경로에 영향을 주는 부분만 봅니다.

### 얻는 것

가장 큰 차이는 저장량에서 납니다. ClickHouse가 2026-04에 낸 OTel 로그 벤치마크에서 500억 행이 ClickHouse 26.3에서는 2.43TiB, Elasticsearch 9.3.2에서는 12.01TiB였습니다 `Ⓑ`. 4.95배 차이인데, 비교 대상이 OpenSearch가 아니라 Elasticsearch이고 벤더가 잰 값입니다. 사용자 쪽 수치는 편차가 큽니다. Uber는 압축률을 3배(일부 로그는 30배)로 적었고, ClickHouse 사내 플랫폼은 19PiB를 1.13PiB로 줄여 17배라고 밝혔습니다 `Ⓥ`. 정렬키와 로그의 반복성, 컬럼으로 뽑아낸 정도에 따라 이만큼 벌어지므로, 용량 계산에는 우리 로그로 잰 값을 넣어야 합니다.

OpenSearch 쪽 기준선도 같이 놓고 봐야 차이가 보입니다. AWS 문서는 로그 워크로드의 인덱스 크기를 원본의 약 1.1배로 잡고, 프라이머리 20GiB에 레플리카 하나를 두면 여유 공간까지 약 58GiB가 필요하다고 계산합니다 `✓`. [OpenSearch 글]({{< relref "/logging/01-opensearch.md" >}})에서 본 대로 그 디스크를 서빙하는 인스턴스 시간이 비용의 대부분입니다.

보존 관리도 테이블 정의 안으로 들어옵니다. 날짜로 파티션을 나누고 TTL을 걸면 만료된 파트를 통째로 지우며(`ttl_only_drop_parts = 1`), 같은 TTL 문법으로 며칠 지난 파트를 S3 볼륨으로 옮길 수 있습니다. ISM 정책과 UltraWarm 이전에 해당하는 일을 DDL 한 곳에서 합니다.

전문검색의 공백은 예전보다 줄었습니다. 텍스트 인덱스가 26.2에서 GA가 됐고 `hasToken`, `hasAllTokens`, `LIKE` 같은 조건을 가속합니다 `✓`. 예전의 `tokenbf_v1`·`ngrambf_v1`은 문서에서 deprecated로 표기합니다. 공짜는 아닙니다. GA 공지에 실린 50TB 로그 실험에서 텍스트 인덱스를 붙이자 insert 처리량이 절반쯤 줄고 전체 압축률이 9배에서 6배 수준으로 내려갔습니다 `Ⓥ`.

### 내주는 것

관련도 랭킹이 없습니다. 텍스트 인덱스는 토큰이 있는지를 빨리 찾아줄 뿐 BM25 같은 점수를 매기지 않습니다. 정렬키에 없는 고카디널리티 필드를 임의로 뒤지는 검색도 OpenSearch만큼 고르게 빠르지 않고, 스킵 인덱스는 정렬키와 상관이 약하면 건너뛸 블록이 없어서 실데이터로 시험해야 합니다. Dashboards에 딸려 있던 Security Analytics, Alerting, Anomaly Detection과 문서·필드 단위 접근제어도 따라오지 않습니다. 알림은 Grafana나 HyperDX에서 다시 만들어야 합니다. 보안 분석이나 자유 탐색이 주 용도라면 그 로그는 OpenSearch에 두는 편이 맞습니다.

### 적재 경로가 받는 제약

OpenSearch에 `_bulk`를 보낼 때는 3~5MiB 요청을 자주 보내도 됐습니다. ClickHouse는 insert마다 파트를 하나 만들고 뒤에서 병합하므로 작은 insert가 잦으면 병합이 따라가지 못해 "too many parts" 오류가 납니다(`parts_to_throw_insert` 기본 3000). 공식 권고는 한 번에 최소 1,000행, 되도록 1만~10만 행을 넣고 동기 insert는 초당 한 번 안팎으로 묶으라는 것입니다 `✓`.

수집기 쪽에서 이 조건을 맞추는 방법은 둘입니다. 배치를 크게 잡거나, 서버가 여러 insert를 모아 한 파트로 쓰는 async insert를 켭니다. aggregator가 여러 대면 "replica 수 × 초당 한 번"이 되므로 async insert를 켜두는 편이 안전합니다. 이때 `wait_for_async_insert=1`이어야 수집기가 받은 성공 응답이 "디스크에 쓰였다"는 뜻이 됩니다. 0으로 두면 응답은 빨라지지만 서버가 버퍼를 비우기 전에 죽었을 때 그 로그를 되찾을 방법이 없습니다.

## 6. Vector → ClickHouse 통합 구성

{{< flow src="_flow/6-통합-구성.json" />}}

테이블은 OTel Collector의 `clickhouse` exporter가 만드는 `otel_logs` DDL을 뼈대로 삼고 컬럼을 쿠버네티스 중심으로 줄였습니다. 아래 DDL과 설정은 문서와 exporter 원문에서 조립한 뒤 홈랩(Vector 0.58.0, ClickHouse 25.3.14)에서 돌려 봤습니다. 설정은 `vector validate`를 통과했고, 임시 파드에서 `kubernetes_logs` → `vector` sink → `vector` 소스 → `remap`을 거친 실제 로그 225만 건이 오류 없이 변환됐으며, 그 출력 표본을 `JSONEachRow`로 넣어 컬럼이 모두 채워지는 것을 확인했습니다 `✓`. `clickhouse` sink가 HTTP로 직접 넣는 구간(배치, 디스크 버퍼, acknowledgement)은 아직 돌려 보지 못했습니다.

```sql
CREATE TABLE logs.k8s_logs
(
    `timestamp` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    `namespace` LowCardinality(String),
    `pod`       String CODEC(ZSTD(1)),
    `container` LowCardinality(String),
    `node`      LowCardinality(String),
    `stream`    LowCardinality(String),
    `level`     LowCardinality(String),
    `message`   String CODEC(ZSTD(1)),
    `labels`    Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    INDEX idx_message lower(message) TYPE text(tokenizer = 'splitByNonAlpha')
)
ENGINE = MergeTree
PARTITION BY toDate(timestamp)
ORDER BY (namespace, container, toStartOfFiveMinutes(timestamp), timestamp)
TTL toDateTime(timestamp) + INTERVAL 30 DAY DELETE
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
```

코덱과 `LowCardinality`, 일 단위 파티션, `ttl_only_drop_parts`는 exporter DDL을 그대로 따랐습니다. 정렬키는 다르게 잡았습니다. exporter 기본은 `(toStartOfFiveMinutes(Timestamp), ServiceName, Timestamp)`이고 ClickHouse 사내 플랫폼은 `(PodName, Timestamp)`를 씁니다. 여기서는 조회가 대개 namespace와 container로 좁힌 뒤 시간 범위를 본다고 가정했습니다. 가장 자주 쓰는 필터를 앞에 두는 것이 원칙이므로 실제 쿼리 패턴이 다르면 바꿔야 합니다. 텍스트 인덱스는 5절에서 본 비용이 있어 `message`에만 붙였고, 26.2보다 낮은 버전에서는 이 줄 때문에 테이블이 만들어지지 않습니다. 25.3.14는 `Only literals can be skip index arguments` 오류를 냈고, 인덱스 줄을 `INDEX idx_message lower(message) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 8`로 바꾸자 생성됐습니다 `✓`. 복제를 쓰면 엔진이 `ReplicatedMergeTree`가 되고 Keeper가 따라옵니다. 그쪽 구성은 [ClickHouse 운영]({{< relref "/clickhouse/_index.md" >}})에 있습니다.

aggregator 설정은 이렇습니다.

```yaml
sources:
  from_agents:
    type: vector
    address: 0.0.0.0:6000

transforms:
  to_columns:
    type: remap
    inputs: [from_agents]
    source: |
      level = "unknown"
      parsed, err = parse_json(.message)
      if err == null && is_object(parsed) {
        level = string(parsed.level) ?? "unknown"
      }
      . = {
        "timestamp": .timestamp,
        "namespace": .kubernetes.pod_namespace,
        "pod":       .kubernetes.pod_name,
        "container": .kubernetes.container_name,
        "node":      .kubernetes.pod_node_name,
        "stream":    .stream,
        "level":     level,
        "message":   .message,
        "labels":    .kubernetes.pod_labels
      }

sinks:
  clickhouse:
    type: clickhouse
    inputs: [to_columns]
    endpoint: http://clickhouse.logging.svc:8123
    database: logs
    table: k8s_logs
    compression: zstd
    date_time_best_effort: true
    batch:
      max_events: 50000
      timeout_secs: 5
    buffer:
      type: disk
      max_size: 10737418240
      when_full: block
    acknowledgements:
      enabled: true
    query_settings:
      async_insert_settings:
        enabled: true
        wait_for_processing: true
```

sink의 기본 배치는 10MB 또는 1초입니다. 1초마다 insert를 내보내는 설정이라 5절의 권고에 맞춰 5만 건 또는 5초로 늘렸습니다. `wait_for_processing`은 `wait_for_async_insert`에 대응합니다. `date_time_best_effort`가 꺼져 있으면 RFC 3339 형식의 타임스탬프를 `DateTime64`로 읽지 못합니다. 같은 입력 형식 설정 없이 넣었을 때 `Cannot parse input ... while reading the value of key timestamp`로 실패했습니다 `✓`. VRL에서 level을 꺼낼 때 `to_string`이 아니라 `string`을 쓴 것도 돌려 보고 고친 부분입니다. `to_string`은 null을 빈 문자열로 바꿔 버려서, JSON이지만 `level` 키가 없는 로그가 `unknown`이 아닌 빈 값으로 들어갔습니다. 대소문자도 원문 그대로 들어오므로(`info`와 `DEBUG`가 섞여 있었습니다) 필요하면 여기서 정규화합니다. `skip_unknown_fields`는 일부러 넣지 않았습니다. 켜면 테이블에 없는 필드를 조용히 버리기 때문에, 처음에는 오류가 나게 두고 스키마가 어긋난 곳을 찾는 편이 낫습니다.

이 sink는 HTTP 인터페이스로만 붙고 기본 포맷이 `JSONEachRow`입니다. ClickHouse 문서는 Native 포맷이 가장 효율적이고 JSONEachRow는 파싱 비용이 크다고 적습니다. 대안인 `arrow_stream`은 아직 beta이며 테이블 이름에 템플릿을 쓸 수 없고 시작할 때 스키마를 한 번만 읽습니다. 수집량이 커지면 이 포맷 차이가 ClickHouse 쪽 CPU로 드러날 수 있으니 이중 적재 기간에 같이 재 볼 항목입니다.

## 7. 옮기는 순서

저장소를 한 번에 갈아 끼우지 않고, aggregator에 sink를 하나 더 붙여 두 저장소에 같은 로그를 넣으면서 견주는 방식이 안전합니다.

1. Fluent Bit에 `forward` 출력을 하나 더 달아 Vector aggregator로도 보낸다(2절의 b). Firehose 경로는 그대로 둔다.
2. aggregator에서 `clickhouse` sink만 먼저 연결하고 acknowledgement는 끈 채 건수와 저장량을 본다.
3. 같은 시간 창에서 건수가 맞는지, 압축 전후 크기(`system.parts`), 대표 쿼리의 지연, 적재 지연을 OpenSearch와 견준다.
4. 조회 화면(Grafana 데이터소스나 HyperDX)과 알림을 ClickHouse 쪽에 다시 만든다.
5. aggregator에 `elasticsearch` sink를 붙여 Firehose를 걷거나, OpenSearch 보존 기간을 줄여 나간다.

비교할 때 OpenSearch의 인덱스 크기에는 레플리카가 들어 있다는 점을 빼먹기 쉽습니다. ClickHouse도 복제본 수만큼 곱해서 같은 기준으로 맞춥니다. 두 저장소는 스키마가 달라서(OpenSearch는 문서 그대로, ClickHouse는 컬럼) transform을 sink별로 갈라야 하고, 이중 적재 기간에는 비용도 이중으로 나갑니다.

Grafana의 ClickHouse 데이터소스는 Explore 로그 뷰와 로그 볼륨 히스토그램, 알림 규칙을 지원합니다. `otel_logs` 스키마라면 토글 하나로 컬럼을 인식하지만, 위처럼 자체 스키마를 쓰면 `timestamp`·`level`·`body` 별칭을 직접 맞춰야 합니다.

## 8. Vector sink와 OTel exporter 중 어느 쪽으로 넣을까

ClickHouse에 로그를 넣는 수집기는 Vector만이 아닙니다. OTel Collector의 `clickhouse` exporter가 같은 일을 합니다.

| 관점 | Vector `clickhouse` sink | OTel Collector `clickhouse` exporter |
|---|---|---|
| 성숙도 | sink는 stable, Vector 본체는 0.x | logs·traces beta, metrics alpha |
| 스키마 | 직접 설계 | `otel_logs` 자동 생성 |
| 전송 | HTTP, JSONEachRow 기본 | 네이티브 프로토콜 |
| 변환 | VRL | OTTL |
| 버퍼 | 디스크 버퍼, acknowledgement | `sending_queue`, 재시도 |
| 조회 도구 | 컬럼 매핑을 직접 | Grafana·ClickStack이 바로 인식 |

트레이스와 로그를 `TraceId`로 잇고 ClickStack 화면을 그대로 쓰려면 exporter 쪽이 손이 덜 갑니다. 앞단이 이미 Vector이고, 컬럼을 줄인 자체 스키마가 필요하고, 이중 적재처럼 sink를 여러 개 다뤄야 한다면 Vector sink가 맞습니다. 홈랩은 둘을 이어 붙인 경우입니다. 로그는 Vector가 모으지만 aggregator가 `clickhouse` sink 대신 OTLP로 HyperDX 컬렉터에 넘기고, 컬렉터의 exporter가 트레이스·메트릭과 함께 `otel_logs`에 넣습니다. 변환은 VRL로 하면서 스키마와 조회 화면은 exporter 쪽 것을 그대로 쓰는 절충입니다.

## 9. 어느 조건에서 무엇을 고를까

아래 경계는 앞에서 모은 사실로 내린 판단이고 `Σ` 공식 기준이 아닙니다.

| 선택 | 맞는 조건 |
|---|---|
| 현행 유지 | 하루 수십 GB 이하, 5분 지연이 문제되지 않음, 파이프라인을 운영할 사람이 없음. 레코드가 작으면 `simple_aggregation`부터 |
| a. Vector agent + Firehose | Lambda 변환을 없애는 것만 목적일 때 |
| b. Fluent Bit + Vector aggregator | Firehose 요금과 지연이 부담이고 에이전트는 그대로 두고 싶을 때. StatefulSet과 PVC를 운영할 수 있어야 함 |
| c. Vector 두 층 | 도구를 하나로 줄이고 이중 적재를 바로 시험하려 할 때. `kubernetes_logs` 이슈를 따라갈 사람이 필요 |
| d. Kafka 삽입 | 유실 불가, 다중 소비자, 백필 요구 |
| OSIS | AWS 관리형을 유지하면서 변환과 72시간 버퍼가 필요할 때 |
| ClickHouse + OTel exporter | 필터와 집계 중심 조회, 30일 이상 보존, 이미 OTel 스택이 있을 때 |
| Vector → ClickHouse | 위 조건에 더해 앞단이 Vector이고 자체 스키마가 필요할 때 |
| OpenSearch 유지 | 관련도 랭킹, 임의 필드 탐색, SIEM 규칙이 주 용도인 로그 |

[권장안]({{< relref "/logging/08-recommendation.md" >}})의 순서를 따르면 먼저 손댈 곳은 b입니다. 에이전트를 건드리지 않아 되돌리기 쉽고, 같은 aggregator가 이후에 ClickHouse든 VictoriaLogs든 두 번째 저장소로 가는 분기점이 됩니다. 저장소를 바꿀지는 7절의 이중 적재에서 우리 로그로 잰 압축률과 쿼리 지연이 나온 뒤에 정해도 늦지 않습니다.

## 참고 출처

- Firehose: [버퍼링 힌트](https://docs.aws.amazon.com/firehose/latest/dev/create-configure-backup.html) · [쿼터와 5KB 올림](https://docs.aws.amazon.com/firehose/latest/dev/limits.html) · [요금](https://aws.amazon.com/firehose/pricing/) · [전송 실패 처리](https://docs.aws.amazon.com/firehose/latest/dev/retry.html) · [Lambda 변환](https://docs.aws.amazon.com/firehose/latest/dev/data-transformation.html)
- Fluent Bit: [kinesis_firehose 출력](https://docs.fluentbit.io/manual/data-pipeline/outputs/firehose.md) · [5.0 업그레이드 노트](https://docs.fluentbit.io/manual/installation/upgrade-notes.md)
- OpenSearch Service: [운영 모범 사례](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/bp.html) · [UltraWarm](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/ultrawarm.html) · [OpenSearch Ingestion](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/ingestion.html)
- Vector: [배포 역할](https://vector.dev/docs/setup/deployment/roles/) · [버퍼 모델](https://vector.dev/docs/architecture/buffering-model/) · [end-to-end acknowledgements](https://vector.dev/docs/architecture/end-to-end-acknowledgements/) · [kubernetes_logs](https://vector.dev/docs/reference/configuration/sources/kubernetes_logs/) · [clickhouse sink](https://vector.dev/docs/reference/configuration/sinks/clickhouse/) · [elasticsearch sink](https://vector.dev/docs/reference/configuration/sinks/elasticsearch/) · [0.58.0 릴리스 노트](https://vector.dev/releases/0.58.0/)
- Vector 이슈: [#24981](https://github.com/vectordotdev/vector/issues/24981) · [#22954](https://github.com/vectordotdev/vector/issues/22954) · [#25385](https://github.com/vectordotdev/vector/issues/25385) · [#26465](https://github.com/vectordotdev/vector/issues/26465)
- 수집기 벤치마크: [VictoriaMetrics, 2026-03](https://victoriametrics.com/blog/log-collectors-benchmark-2026/)
- ClickHouse: [텍스트 인덱스](https://clickhouse.com/docs/engines/table-engines/mergetree-family/textindexes) · [텍스트 인덱스 GA 공지](https://clickhouse.com/blog/full-text-search-ga-release) · [insert 전략](https://clickhouse.com/docs/best-practices/selecting-an-insert-strategy) · [async insert](https://clickhouse.com/docs/optimize/asynchronous-inserts) · [관측 스키마 설계](https://clickhouse.com/docs/use-cases/observability/schema-design) · [Elasticsearch 비교 벤치마크](https://clickhouse.com/blog/elasticsearch-log-analytics-clickhouse)
- 사례: [ClickHouse LogHouse](https://clickhouse.com/blog/building-a-logging-platform-with-clickhouse-and-saving-millions-over-datadog) · [Uber](https://www.uber.com/blog/logging/) · [Zomato](https://www.zomato.com/blog/building-a-cost-effective-logging-platform-using-clickhouse-for-petabyte-scale/)
- OTel: [clickhouse exporter](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/clickhouseexporter/README.md) · [otel_logs DDL](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/clickhouseexporter/internal/sqltemplates/logs_table.sql)
- 조회: [Grafana ClickHouse 데이터소스](https://grafana.com/docs/plugins/grafana-clickhouse-datasource/latest/)
