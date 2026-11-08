---
title: "VictoriaLogs 로그 한 줄의 스트림과 디스크 배치"
linkTitle: "로그 한 줄의 저장 경로"
description: "로그 한 줄은 디스크의 어느 파일에 저장될까요? 일 단위 파티션의 datadb에는 로그 필드를, indexdb에는 스트림 색인을 담는 과정을 다섯 줄로 확인합니다."
weight: 1
date: 2026-11-08
url: "/logging/victorialogs-internals/01-data-model/"
---

# VictoriaLogs 로그 한 줄의 스트림과 디스크 배치

{{< callout type="info" >}}
Write-Ahead 블로그의 「VictoriaLogs storage internals: the data model and the map of the engine」(2026-11-07)을 읽고 재구성한 정리입니다. 원문은 [여기](https://write-ahead.github.io/victorialogs/internals/storage-engine/data-model/)에서 볼 수 있으며, 실습 명령은 원문에서 사용한 v1.52.0 기준입니다. 시리즈 안내는 [VictoriaLogs 스토리지 내부 구조]({{< relref "/observability/logs/victorialogs-internals/_index.md" >}})에 있습니다.
{{< /callout >}}

로그 한 줄의 필드는 일 단위 파티션의 `datadb`에 컬럼별로 저장됩니다. `{app="api"}` 같은 조건에 맞는 스트림은 같은 파티션의 `indexdb`에서 찾습니다. 로그 데이터를 읽기 전에, 조건에 맞는 스트림부터 찾는 배치입니다.

## 문자열로 펼쳐 놓은 필드 가방 {#데이터-모델}

VictoriaLogs에서 로그 한 줄은 평평한 필드 가방입니다. 키와 값은 모두 문자열이며, 로그 메시지도 `_msg`라는 필드에 들어갑니다.

```
{ "app": "api", "pod": "api-7", "level": "error",
  "trace_id": "t-aaa", "_msg": "db timeout" }
```

이 형태는 입력 관례가 아닙니다. 엔진이 수집 시점에 강제합니다. 중첩 객체가 들어오면 키를 점으로 이어 평탄화하므로, 객체 안쪽의 값도 하나의 필드로 펼쳐집니다.

```
{ "host": { "os": { "version": "1.2.3" } } }   →   { "host.os.version": "1.2.3" }
```

배열, 숫자, 불리언도 문자열로 바뀝니다. 모든 필드에서 전문 검색이 같은 방식으로 동작하는 이유입니다.

```
{ "offset": 12345, "is_error": false }   →   { "offset": "12345", "is_error": "false" }
```

빈 값은 남기지 않습니다. `{"_msg":"x","region":""}`와 `{"_msg":"x"}`는 VictoriaLogs에서 같은 로그입니다. 빈 `region`은 다른 어떤 처리보다 먼저 버려지므로, 뒤에서 스트림을 계산할 때도 영향을 주지 못합니다.

이 필드 가방에서 특별하게 취급하는 필드는 넷입니다. 나머지는 모두 일반 필드로 다룹니다.

| 필드 | 담긴 내용 | 저장과 조회에서의 역할 |
|---|---|---|
| `_msg` | 로그 메시지 | 내부 이름은 빈 문자열 `""`, 다른 컬럼과 별개의 파일에 저장 |
| `_time` | 타임스탬프 | 시간 필터에 사용하며, 로그가 들어갈 일 단위 파티션을 결정 |
| `_stream` | 스트림 레이블 `{k="v",…}` | 직접 보내는 값이 아닌 파생 값 |
| `_stream_id` | 스트림의 고유 id | 줄이 들어올 때 해시를 계산해 만드는 파생 값 |

## 인스턴스의 로그를 모으는 스트림 필드 {#스트림}

로그 저장소에서 어려운 쪽은 읽기입니다. “이 파드의 최근 15분 에러”를 밀리초에 꺼내려면 나머지 99.99%를 읽지 않아야 합니다. VictoriaLogs는 실행 중인 인스턴스 하나의 로그를 스트림으로 묶습니다. 한 인스턴스의 줄을 모아 두면 압축이 잘 되고, `{app="api"}` 같은 쿼리로 다른 데이터를 건너뛰게 됩니다.

어떤 필드가 인스턴스를 가리키는지는 엔진이 짐작하지 않습니다. 수집할 때 사용자가 `app`, `pod`처럼 스트림 필드를 지정해야 합니다. 이 필드들의 값이 같으면 `level`, `trace_id`, `_msg`가 달라도 같은 스트림에 들어갑니다.

필드를 보낸 순서도 무관합니다. 엔진은 선택한 필드를 정렬한 정규형으로 해시를 계산합니다. 빈 값은 그전에 버렸으므로 `{pod, app}`과 `{app, pod, region=""}`는 같은 스트림을 가리킵니다.

실제 `_stream_id`에는 테넌트도 들어갑니다. `tenant`와 `hash128(tags)`를 이은 값으로, account·project 정수 한 쌍 뒤에 128비트 해시가 붙습니다. 단일 테넌트 저장소에서는 테넌트가 (0, 0)이어서 id 앞에 0이 줄지어 나타납니다.

스트림 필드로 `trace_id`, `ip`, `user_id`처럼 카디널리티가 높은 필드를 고르면 결과가 달라집니다. 모든 줄이 고유한 해시를 얻어 자기만의 스트림을 갖습니다. 스트림 수가 폭발하면서 수집이 느려지고 메모리 사용량도 늘지만, 엔진은 지정받은 필드대로 동작한 것입니다. 이런 값은 일반 필드로 남겨도 검색됩니다.

아무 필드도 지정하지 않으면 모든 줄이 빈 스트림 `{}` 하나에 모입니다. 동작은 하지만 압축과 쿼리 지역성을 잃습니다. 스트림 필드를 고르는 일은 어떤 줄을 함께 모아 저장할지 정하는 일입니다. 스트림 필드 선택은 사용자가 쥔 가장 큰 지렛대입니다.

원문은 컬럼형 저장, 스트림 단위 묶음, 블룸 필터, 사용자가 직접 고르는 스트림 필드를 성능 차이의 이유로 봅니다. 인용한 수치는 VictoriaLogs 자체 발표로, Elasticsearch 대비 RAM 최대 30배, 디스크 최대 15배 절감과 Loki 대비 최대 1000배 빠른 전문 검색입니다. 벤더가 발표한 최선의 경우의 최대치이며 독립 벤치마크는 아닙니다. 원문도 자기 로그로 재 보라고 권합니다. 비교 맥락은 [VictoriaLogs 평가]({{< relref "/observability/logs/comparison/03-victorialogs.md" >}})에 있습니다.

## 다섯 줄로 확인하는 _stream과 _stream_id {#직접-해보기}

도커나 설정 파일 없이도 5분이면 스트림과 디스크 파일을 확인합니다. 사용하는 바이너리는 하나입니다. 단일 노드, insert, select는 플래그에 따라 역할이 달라지는 같은 실행 파일이며, 원문은 엔진 전체가 Go 패키지 하나에 들어 있는 단일 노드 경로를 따라갑니다.

### OS와 CPU에 맞는 victoria-logs-prod {#받기와-실행}

`uname -sm`으로 OS와 CPU 구조를 확인합니다. 릴리스 페이지에서 고를 아카이브의 이름은 `victoria-logs-<os>-<arch>-<version>.tar.gz` 형식입니다.

```
mkdir vl-quick-start && cd vl-quick-start
uname -sm        # your OS + arch, e.g. "Darwin arm64" or "Linux x86_64"
```

| `uname -sm` | 아카이브 |
|---|---|
| Darwin arm64 | victoria-logs-darwin-arm64-… (Apple Silicon) |
| Darwin x86_64 | victoria-logs-darwin-amd64-… (Intel Mac) |
| Linux x86_64 | victoria-logs-linux-amd64-… |
| Linux aarch64 | victoria-logs-linux-arm64-… |

애플 실리콘 맥에서는 아래 아카이브를 받아 풉니다.

```
curl -L -O https://github.com/VictoriaMetrics/VictoriaLogs/releases/download/v1.52.0/victoria-logs-darwin-arm64-v1.52.0.tar.gz
tar xzf victoria-logs-darwin-arm64-v1.52.0.tar.gz    # unpacks a single `victoria-logs-prod`
```

`exec format error`는 CPU 구조가 다른 아카이브를 받았다는 뜻입니다. macOS에서 개발자 확인 경고가 뜨면 `xattr -d com.apple.quarantine ./victoria-logs-prod`로 풉니다.

컨테이너 실행 명령은 `docker run --rm -p 9428:9428 docker.io/victoriametrics/victoria-logs:latest`, 소스 빌드 명령은 `go build ./app/victoria-logs`입니다. 바이너리를 어느 경로로 얻어도 디스크 포맷은 같습니다.

압축을 푼 바이너리는 인수 없이 실행합니다.

```
./victoria-logs-prod
```

9428번 포트에서 실행되며, 바이너리 옆에 `victoria-logs-data/`가 생깁니다. 이 터미널을 둔 채 새 터미널을 엽니다.

### app과 pod로 묶을 sample.jsonl {#다섯-줄-적재}

아래 다섯 줄을 `sample.jsonl`에 저장합니다. 앞의 세 줄은 메시지와 다른 필드가 달라도 `app=api`, `pod=api-7`이 같습니다. 세 번째 줄에는 필드 순서를 바꾸고 빈 `region`도 넣었습니다.

```
{"_time":"2026-10-31T10:00:01Z","app":"api","pod":"api-7","level":"info","trace_id":"t-aaa","_msg":"user logged in"}
{"_time":"2026-10-31T10:00:02Z","app":"api","pod":"api-7","level":"error","trace_id":"t-bbb","_msg":"db timeout after 3s"}
{"_time":"2026-10-31T10:00:03Z","pod":"api-7","app":"api","region":"","_msg":"field order and empty region do not change the stream"}
{"_time":"2026-10-31T10:00:04Z","app":"api","pod":"api-9","_msg":"different pod = different stream"}
{"_time":"2026-10-31T10:00:05Z","app":"worker","pod":"w-2","_msg":"different app = different stream"}
```

`app`과 `pod`를 스트림 필드로 지정하고 jsonline 엔드포인트로 보냅니다.

```
curl -X POST -H 'Content-Type: application/stream+json' --data-binary @sample.jsonl \
  'http://localhost:9428/insert/jsonline?_stream_fields=app,pod'
```

성공하면 본문이 빈 200 응답이 돌아옵니다. `Content-Type` 헤더를 빠뜨리면 본문을 웹 폼으로 읽어 아무것도 저장하지 않습니다.

이제 LogsQL로 각 줄의 `_stream`과 `_stream_id`를 조회합니다. `_time:1d`는 최근 하루라는 뜻입니다.

```
curl http://localhost:9428/select/logsql/query \
  -d 'query=_time:1d | sort by (_time) | keep _stream, _stream_id, _msg'
```

```
{app="api",pod="api-7"}    0000000000000000f9857ac5ce08a117958ea2f865a13e65   user logged in
{app="api",pod="api-7"}    0000000000000000f9857ac5ce08a117958ea2f865a13e65   db timeout after 3s
{app="api",pod="api-7"}    0000000000000000f9857ac5ce08a117958ea2f865a13e65   field order and empty region do not change the stream
{app="api",pod="api-9"}    0000000000000000311d0b67ca7c3f9d942fbbf2440e9470   different pod = different stream
{app="worker",pod="w-2"}   00000000000000005bf978436a7c2bfaac1faf4208696354   different app = different stream
```

앞의 세 줄은 id가 같습니다. 메시지, 필드 순서, 빈 `region`이 스트림을 바꾸지 않았습니다. `pod=api-9`인 줄과 `app=worker`인 줄에는 각각 다른 id가 붙습니다. 앞의 0 열여섯 개는 테넌트 (0,0), 나머지는 정렬된 태그의 128비트 해시입니다.

줄은 다섯이지만 스트림은 셋입니다. 같은 시간 범위에서 고유한 id를 세면 이 차이가 드러납니다.

```
curl http://localhost:9428/select/logsql/query -d 'query=_time:1d | count_uniq(_stream_id)'
# {"count_uniq(_stream_id)":"3"}
```

## _time이 고른 일 파티션의 두 LSM 트리 {#엔진-지도}

스트림이 정해진 줄은 `_time`에 해당하는 날짜의 파티션으로 갑니다. Storage는 하루에 하나씩 파티션을 두며, 각 파티션 안에는 서로 완전히 독립된 LSM 트리인 `datadb`와 `indexdb`가 있습니다.

`datadb`에는 실제 로그 필드가 컬럼 단위로 저장됩니다. `indexdb`는 `app="api"` 태그를 가진 스트림이 무엇인지 답하는 색인입니다. 쿼리가 스트림을 스캔 없이 찾는 데 쓰이며, 백그라운드 병합기도 `datadb`와 따로 돕니다. 원문이 두 트리를 하나로 뭉뚱그리지 말라고 강조하는 이유입니다.

Storage에서 날짜별 파티션으로, 다시 독립된 두 트리로 내려가는 포함 관계입니다.

{{< flow src="_flow/1-엔진-지도.json" />}}

메모리의 데이터는 `-inmemoryDataFlushInterval`에 맞춰 디스크로 내려갑니다. 기본값은 5초입니다. 잠시 뒤 `victoria-logs-data/`를 보면 이 관계가 디렉터리로 나타납니다. 예제의 다섯 줄은 `_time`의 날짜에 따라 `20261031` 아래에 놓입니다.

```
victoria-logs-data/
└── partitions/
    └── 20261031/                    ← one partition — today (YYYYMMDD)
        ├── datadb/                  ← LSM tree #1: the log DATA
        │   ├── parts.json           ← the list of live parts
        │   └── 18E396AD68651529/    ← a "part": an immutable directory
        └── indexdb/                 ← LSM tree #2: the stream INDEX
            ├── parts.json
            └── 18E396AD6862BF81/    ← a part, but a different shape (see below)
```

### 로그 필드를 나눈 datadb part {#part-해부}

`datadb`의 part 디렉터리에는 작은 파일 열두 개가 들어 있습니다. 아래 크기는 이 실행에서 나온 값입니다.

```
   200  metadata.json              53  metaindex.bin
   133  index.bin                   5  timestamps.bin
    44  column_names.bin           27  values.bin0
   259  columns_header.bin          0  bloom.bin0
    37  columns_header_index.bin    9  message_values.bin
     7  column_idxs.bin             0  message_bloom.bin
```

역할에 따라 네 가지로 묶이는 파일들입니다. 바이트 단위의 해부는 이후 편으로 남겨 두고, 여기서는 part의 요약을 담은 `metadata.json`부터 확인합니다.

```
{ "FormatVersion": 3, "RowsCount": 5, "BlocksCount": 3,
  "CompressedSizeBytes": 574, "UncompressedSizeBytes": 729, "BloomValuesShardsCount": 1 }
```

다섯 행이 블록 셋에 담겼습니다. 행을 (스트림, 시간) 순으로 정렬하고 스트림이 바뀔 때마다 블록을 끊기 때문에, 이번 실행에서는 스트림 셋이 블록 셋으로 이어집니다. 한 블록 안에 서로 다른 스트림이 섞이지 않습니다.

메시지 파일도 눈에 들어옵니다. `message_values.bin`과 `message_bloom.bin`은 `_msg`를 다른 모든 필드와 떨어뜨려 저장한 결과입니다.

`"FormatVersion": 3`과 `columns_header_index.bin`, `column_idxs.bin`은 와이드 이벤트 개편의 흔적입니다. 원문은 이 개편에 한 편을 따로 할애한다고 예고합니다.

### 태그로 스트림을 찾는 indexdb part {#색인-파일}

같은 파티션의 `indexdb` part는 파일 구성이 다릅니다. 컬럼형 저장소 대신 정렬된 키-값 저장소인 mergeset을 사용하므로 `items.bin`, `lens.bin`이 있습니다. 여기의 `metadata.json`은 로그 행 대신 항목을 셉니다.

```
{ "ItemsCount": 11, "BlocksCount": 1,
  "FirstItem": "000000000000000000311d0b67ca7c3f9d942fbbf2440e9470", … }
```

`FirstItem` 안의 `311d0b67…`은 앞서 `pod=api-9`에서 확인한 해시입니다. 색인에 스트림 자체가 저장돼 있습니다. 그래서 `{app="api"}` 조건에 맞는 스트림을 찾는 단계에서는 `datadb`를 건드리지 않습니다.

다음 편은 HTTP 요청으로 들어온 줄이 `datadb` 안의 정렬된 불변 바이트가 되기까지를 따라갑니다. 원문이 예고한 범위는 그 과정에서 가장 단순한 설계가 처음 부딪히는 벽까지입니다.
