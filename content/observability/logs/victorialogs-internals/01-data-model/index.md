---
title: "VictoriaLogs에서 로그 한 줄이 디스크에 놓이는 자리"
linkTitle: "1. 로그 한 줄의 경로"
description: "VictoriaLogs에 보낸 로그 한 줄은 디스크의 어디에 저장될까요? 선택한 필드가 스트림을 정하고 _time이 일 파티션을 고르는 과정을 따라가며, 다섯 줄을 넣어 datadb와 indexdb에 생기는 파일을 확인합니다."
weight: 1
date: 2026-11-08
url: "/logging/victorialogs-internals/01-data-model/"
---

# VictoriaLogs에서 로그 한 줄이 디스크에 놓이는 자리

{{< callout type="info" >}}
Write-Ahead 블로그에 2026-11-07 게시된 [「VictoriaLogs storage internals: the data model and the map of the engine」](https://write-ahead.github.io/victorialogs/internals/storage-engine/data-model/) 원문을 읽고 재구성한 정리입니다. 실습 명령은 원문에서 사용한 v1.52.0 기준입니다. 시리즈 안내는 [VictoriaLogs 스토리지 내부 구조]({{< relref "/observability/logs/victorialogs-internals/_index.md" >}})에 있습니다.
{{< /callout >}}

## 소방호스를 삼키는 로그 저장소 {#읽는-이유}

방금 보낸 로그 한 줄은 디스크의 어느 파일에 들어갈까요? VictoriaLogs는 그 줄을 문자열 필드 가방으로 펼치고, 지정한 필드의 해시로 스트림을 정한 뒤, `_time`에 맞는 일 단위 파티션에 넣습니다. 그 안에서 실제 로그 필드는 `datadb`에, 스트림 색인은 `indexdb`에 저장됩니다.

로그 저장소는 소방호스를 삼킵니다. 수천 곳에서 시간당 수백만 줄이 쏟아져도, 받아 적는 일에는 파일과 디스크만 있으면 됩니다. 어려운 일은 다시 꺼내는 쪽입니다. 테라바이트의 데이터 앞에서 “이 파드의 최근 15분 에러를 보여 달라”는 요청에 나머지 99.99%를 읽지 않고 밀리초 만에 답해야 합니다. 빠른 조회의 이유를 찾으려면 바이트가 놓인 자리부터 봐야 합니다.

VictoriaLogs 프로젝트가 발표한 수치는 Elasticsearch 대비 RAM 최대 30배, 디스크 최대 15배 절감, Loki 대비 전문 검색 최대 1000배 향상입니다. 같은 워크로드에서 Elasticsearch 27노드 클러스터를 VictoriaLogs 한 노드로 교체했다는 사용자 사례도 소개합니다. 배수는 최선의 경우에 얻은 최대치이지 독립 벤치마크 결과가 아닙니다. 원문도 자기 로그로 직접 측정하라고 권하며, 비교 맥락은 [VictoriaLogs 평가]({{< relref "/observability/logs/comparison/03-victorialogs.md" >}})에 있습니다.

이 성능 자랑 목록은 사실 변장한 목차입니다. 원문은 이 숫자들을 컬럼형 저장, 스트림별 묶음, 블룸 필터, 직접 고르는 스트림 필드라는 설계에 연결합니다. 그중 스트림 필드 선택은 사용자가 직접 바이트 배치에 관여하는 자리입니다.

## 빈 값이 사라지는 문자열 필드 가방 {#데이터-모델}

로그 한 줄의 출발점은 필드 가방입니다. 키와 값이 모두 문자열이고, 중첩 없이 평평합니다.

```
{ "app": "api", "pod": "api-7", "level": "error",
  "trace_id": "t-aaa", "_msg": "db timeout" }
```

입력부터 이 모양일 필요는 없습니다. 엔진이 수집할 때 중첩 객체의 키를 점으로 이어 평탄화합니다.

```
{ "host": { "os": { "version": "1.2.3" } } }   →   { "host.os.version": "1.2.3" }
```

배열, 숫자, 불리언도 모두 문자열로 바꿉니다. 덕분에 어느 필드든 전문 검색은 같은 방식으로 동작합니다.

```
{ "offset": 12345, "is_error": false }   →   { "offset": "12345", "is_error": "false" }
```

빈 값은 조금 뜻밖입니다. `{"_msg":"x","region":""}`와 `{"_msg":"x"}`는 VictoriaLogs에 같은 로그이며, 엔진은 다른 처리를 시작하기 전에 빈 `region`부터 버립니다. 뒤에서 스트림을 계산할 때도 이 필드는 이미 사라진 상태입니다.

로그 메시지 `_msg`는 이름부터 특별한 취급을 받습니다. 내부 이름이 빈 문자열 `""`이고, 디스크에서도 다른 컬럼과 떨어진 전용 파일을 갖습니다. 타임스탬프 `_time`에도 저장 위치를 정하는 역할이 있습니다. 시간 필터에 쓰이는 값이면서, 이 줄을 어느 날짜의 파티션에 넣을지 결정합니다.

보내는 쪽에서는 `_msg`와 일반 필드, 필요하면 `_time`을 준비합니다. 스트림 레이블 `_stream`과 고유 ID `_stream_id`는 직접 보내지 않습니다. 이 값들은 엔진이 만들며, 그 재료를 고르는 일이 스트림 필드 지정입니다.

## app과 pod로 고르는 스트림 {#스트림}

스트림이 묶으려는 대상은 실행 중인 인스턴스 하나의 로그 전부입니다. 어떤 필드가 그 인스턴스를 가리키는지는 엔진이 짐작할 수 없으므로, 수집할 때 사용자가 `app`, `pod`처럼 스트림 필드를 지정합니다.

`app`과 `pod`를 골랐다면 그 필드들만 줄의 정체성을 정합니다. 메시지가 전혀 다르고 `level`, `trace_id`가 바뀌어도 `app`과 `pod`가 같으면 같은 스트림입니다. 한 인스턴스의 로그를 모아 두면 압축이 잘 되고, `{app="api"}` 쿼리는 다른 스트림의 데이터를 건너뜁니다. 어떤 필드를 고르느냐가 압축과 조회 양쪽에 영향을 주는 이유입니다.

입력 순서를 맞출 필요는 없습니다. 엔진은 고른 필드를 정렬한 뒤 해시하고, 빈 값은 그 전에 버렸습니다. 따라서 필드 값이 같다면 `{pod, app}`과 `{app, pod, region=""}`는 같은 스트림을 만듭니다.

해시 앞에는 테넌트도 붙습니다. 실제 `_stream_id`는 `tenant + hash128(tags)`이며, account와 project 정수 한 쌍 뒤에 정렬된 스트림 필드의 128비트 해시를 이은 값입니다. 단일 테넌트 저장소의 테넌트는 (0, 0)이라 ID 앞부분에 0이 줄지어 나타납니다. 곧 조회 결과에서 확인할 모양입니다.

여기에 `trace_id`까지 스트림 필드로 넣으면 어떨까요? 원문이 경고하는 실수가 바로 이 선택입니다. `trace_id`, `ip`, `user_id`처럼 카디널리티가 높은 필드를 고르면 로그 한 줄마다 고유한 해시와 자기만의 스트림이 생깁니다. 스트림 수가 폭발하고 수집이 느려지며 메모리가 부풀어 오릅니다. 엔진은 지정받은 필드로 정체성을 만들었을 뿐입니다.

이 필드들은 일반 필드로 두어도 검색됩니다. 인스턴스를 묶을 기준에 넣지 않아도 검색할 수 있다는 구분을 기억하면 스트림 필드를 고르기가 한결 분명해집니다.

아무 필드도 지정하지 않는 선택도 있습니다. 모든 로그가 빈 스트림 `{}` 하나에 들어가며 동작은 계속됩니다. 대신 인스턴스별로 로그를 모을 때 얻는 압축과 쿼리 지역성의 이점을 잃습니다.

## 날짜별 파티션 안의 독립된 LSM 트리 {#엔진-지도}

스트림을 정한 로그는 `_time`이 가리키는 날짜로 들어갑니다. Storage는 하루에 하나씩 파티션을 두고, 각 파티션 안에는 서로 완전히 독립된 LSM 트리 `datadb`와 `indexdb`가 있습니다. 아래 그림은 이 포함 관계를 보여 줍니다.

{{< flow src="_flow/1-엔진-지도.json" />}}

실제 로그 필드는 `datadb`에 컬럼 단위로 저장됩니다. `indexdb`는 `app="api"` 태그를 가진 스트림을 찾는 색인입니다. 쿼리는 이 색인에서 대상 스트림을 찾으므로 스트림들을 직접 훑을 필요가 없습니다. 어떤 스트림을 읽을지 찾는 일과 그 스트림의 로그 필드를 읽는 일이 서로 다른 트리에 놓여 있습니다.

백그라운드 병합기도 따로 돕니다. 뒤에서 디렉터리를 열면 파일 구성까지 다르게 나타나므로, 처음부터 두 트리를 구분해 두어야 합니다.

이 흐름을 맡는 바이너리는 하나입니다. 단일 노드, insert, select가 각각 별도 프로그램인 것은 아니며, 같은 실행 파일이 플래그에 따라 다르게 동작합니다. 여기서 따라가는 단일 노드 경로에서는 엔진 전체가 Go 패키지 하나에 들어 있습니다.

## 다섯 줄로 확인하는 스트림 필드 선택 {#직접-해보기}

설명을 실제 파일로 확인할 차례입니다. 도커나 설정 파일 없이 약 5분이면 로그 다섯 줄을 넣고, 스트림이 어떻게 정해졌는지 조회한 뒤 디스크까지 들여다볼 수 있습니다.

### uname -sm으로 고르는 바이너리 {#받기와-실행}

작업 디렉터리를 만들고 OS와 CPU 아키텍처를 확인합니다. 릴리스 아카이브는 이 결과에 맞는 `victoria-logs-<os>-<arch>-<version>.tar.gz`를 골라야 합니다.

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

아래 다운로드 명령은 Apple Silicon 맥용입니다.

```
curl -L -O https://github.com/VictoriaMetrics/VictoriaLogs/releases/download/v1.52.0/victoria-logs-darwin-arm64-v1.52.0.tar.gz
tar xzf victoria-logs-darwin-arm64-v1.52.0.tar.gz    # unpacks a single `victoria-logs-prod`
```

`exec format error`가 나오면 아키텍처가 다른 아카이브를 받은 것이므로 `uname -sm`과 다시 대조합니다. macOS에서 개발자를 확인할 수 없다는 경고가 나오면 `xattr -d com.apple.quarantine ./victoria-logs-prod`로 해제합니다.

컨테이너나 소스로 시작해도 디스크 포맷은 같습니다.

- 컨테이너 실행: `docker run --rm -p 9428:9428 docker.io/victoriametrics/victoria-logs:latest`
- 소스 빌드: `go build ./app/victoria-logs`

내려받은 바이너리에는 인수를 붙이지 않아도 됩니다.

```
./victoria-logs-prod
```

9428번 포트에서 실행되며 바이너리 옆에 `victoria-logs-data/` 디렉터리가 생깁니다. 앞으로 확인할 파일이 모두 이곳에 들어갑니다. 서버는 그대로 실행해 두고, 로그를 보낼 새 터미널을 엽니다.

### app과 pod를 지정한 sample.jsonl 전송 {#다섯-줄-적재}

아래 다섯 줄을 `sample.jsonl`에 저장합니다. 앞의 세 줄은 `app=api`, `pod=api-7`을 공유하지만 메시지와 일반 필드는 다릅니다. 세 번째 줄은 필드 순서까지 바꾸고 빈 `region`도 넣었습니다. 마지막 두 줄은 다른 `pod`를 쓰며, 맨 끝 줄은 `app`도 다릅니다.

```
{"_time":"2026-10-31T10:00:01Z","app":"api","pod":"api-7","level":"info","trace_id":"t-aaa","_msg":"user logged in"}
{"_time":"2026-10-31T10:00:02Z","app":"api","pod":"api-7","level":"error","trace_id":"t-bbb","_msg":"db timeout after 3s"}
{"_time":"2026-10-31T10:00:03Z","pod":"api-7","app":"api","region":"","_msg":"field order and empty region do not change the stream"}
{"_time":"2026-10-31T10:00:04Z","app":"api","pod":"api-9","_msg":"different pod = different stream"}
{"_time":"2026-10-31T10:00:05Z","app":"worker","pod":"w-2","_msg":"different app = different stream"}
```

샘플의 날짜는 2026-10-31로 고정되어 있습니다. 뒤에서 쓸 `_time:1d`는 최근 하루만 조회하므로, 아래 조회에서 로그를 찾으려면 넣은 로그의 `_time`도 조회 시점의 그 범위 안에 있어야 합니다.

`app`과 `pod`를 스트림 필드로 지정해 jsonline 엔드포인트로 보냅니다.

```
curl -X POST -H 'Content-Type: application/stream+json' --data-binary @sample.jsonl \
  'http://localhost:9428/insert/jsonline?_stream_fields=app,pod'
```

`Content-Type`은 빠뜨리면 안 됩니다. 이 헤더가 없으면 엔진이 본문을 웹 폼으로 읽어 아무것도 저장하지 않습니다. 본문이 빈 200 응답을 받으면 성공입니다.

### 세 줄에 나란히 찍힌 _stream_id {#조회로-확인}

엔진이 만든 `_stream`과 `_stream_id`를 메시지 옆에 놓고 비교합니다. 아래 LogsQL 쿼리는 최근 하루의 로그를 시간순으로 정렬하고 이 필드들만 남깁니다.

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

앞의 세 줄에 같은 ID가 찍혔습니다. 서로 다른 메시지, 뒤바뀐 필드 순서, 빈 `region` 어느 것도 스트림을 바꾸지 않았고, 지정한 스트림 필드의 값이 달라진 마지막 두 줄에서 ID가 바뀝니다.

앞의 0 열여섯 개는 테넌트 (0, 0)이며, 나머지는 정렬된 태그의 128비트 해시입니다. 서로 다른 ID를 세어 보면 다섯 줄이 스트림 셋으로 모였다는 사실이 드러납니다.

```
curl http://localhost:9428/select/logsql/query -d 'query=_time:1d | count_uniq(_stream_id)'
# {"count_uniq(_stream_id)":"3"}
```

## 디렉터리로 스스로 그려지는 엔진 지도 {#정리}

### 로그 날짜가 붙은 디렉터리 {#디스크-파일}

이제 디스크를 볼 차례입니다. 메모리의 데이터는 `-inmemoryDataFlushInterval`에 따라 내려가며 기본 간격은 5초입니다. 잠시 뒤 `victoria-logs-data/`를 열면 앞서 본 포함 관계가 디렉터리로 스스로 그려집니다.

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

파티션 날짜는 로그의 `_time`을 따릅니다. 원문의 `20261031/`도 샘플에 적힌 날짜이며, 그 아래에 `datadb`와 `indexdb`가 따로 자리 잡았습니다. 각 트리의 `parts.json`에는 현재 사용하는 part 목록이 있고, part 자체는 불변 디렉터리입니다.

### 다섯 행을 세 블록에 담은 datadb part {#part-해부}

`datadb`의 part 안에는 작은 파일 열두 개가 있습니다. 아래 크기는 원문의 실행에서 나온 값입니다.

```
   200  metadata.json              53  metaindex.bin
   133  index.bin                   5  timestamps.bin
    44  column_names.bin           27  values.bin0
   259  columns_header.bin          0  bloom.bin0
    37  columns_header_index.bin    9  message_values.bin
     7  column_idxs.bin             0  message_bloom.bin
```

낯선 파일 이름 사이에서 먼저 열 것은 part의 요약을 담은 `metadata.json`입니다. 방금 넣은 줄 수와 스트림 수가 여기서는 행과 블록으로 나타납니다.

```
{ "FormatVersion": 3, "RowsCount": 5, "BlocksCount": 3,
  "CompressedSizeBytes": 574, "UncompressedSizeBytes": 729, "BloomValuesShardsCount": 1 }
```

다섯 행에 블록 셋입니다. 행을 (스트림, 시간) 순으로 정렬하고 스트림이 바뀔 때마다 블록을 끊으므로, 이 샘플의 스트림 셋은 블록 셋으로 이어집니다. 한 블록에는 서로 다른 스트림이 섞이지 않으며, 블록 안에서는 필드를 컬럼별로 저장합니다. 스트림을 함께 모은다는 설명이 파일 안의 배치로 나타난 것입니다.

`_msg`의 전용 파일도 눈에 들어옵니다. `message_values.bin`과 `message_bloom.bin`이 다른 필드의 파일과 따로 존재합니다. 앞에서 본 빈 이름의 메시지 컬럼이 디스크에서도 별도로 저장된 흔적입니다.

`"FormatVersion": 3`과 `columns_header_index.bin`, `column_idxs.bin`은 와이드 이벤트 개편의 흔적입니다. 이 파일들에는 저장 방식을 다시 설계한 이력도 남아 있습니다.

### 스트림 해시가 보이는 indexdb의 metadata.json {#색인-파일}

옆의 `indexdb` part를 열면 파일 구성이 달라집니다. 여기는 정렬된 키-값 저장소인 mergeset이며, `items.bin`, `lens.bin` 같은 파일을 사용합니다. `metadata.json`도 로그 행 대신 항목 수를 셉니다.

```
{ "ItemsCount": 11, "BlocksCount": 1,
  "FirstItem": "000000000000000000311d0b67ca7c3f9d942fbbf2440e9470", … }
```

`FirstItem`의 긴 16진수를 눈여겨보면 익숙한 `311d0b67…`이 보입니다. 조회 결과에서 `pod=api-9`에 붙었던 스트림 해시입니다. 색인이 실제로 스트림을 저장하고 있어서, `{app="api"}` 쿼리는 대상 스트림을 찾는 단계에서 `datadb`를 건드리지 않습니다. 조회 화면에서 본 ID가 다른 트리의 파일 안에 그대로 남아 있습니다.

다음 편에서는 HTTP 요청으로 들어온 한 줄이 `datadb` 안의 정렬된 불변 바이트가 될 때까지 따라갑니다. 그 과정에서 가장 단순한 설계가 처음 부딪히는 벽을 확인합니다.
