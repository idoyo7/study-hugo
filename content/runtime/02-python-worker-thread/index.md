---
title: "Python 워커 16개 vs 워커 2 + 스레드 32"
date: 2026-08-29
lastmod: 2026-08-29
linkTitle: "02 Python 워커와 스레드"
weight: 2
---

# 02 · 워커 16개 vs 워커 2개 + 스레드 32개 — 무엇이 정말 달라지나

{{< callout type="info" >}}
- `--threads 32`를 주면 워커 클래스가 통째로 바뀝니다. gunicorn 문서에 그대로 적혀 있습니다. "If you try to use the `sync` worker type and set the `threads` setting to more than 1, the `gthread` worker type will be used instead." 그러니 "동기 워커에 스레드를 붙였다"는 말 자체가 성립하지 않습니다.
- 최대 처리량은 거의 같습니다. CPU limit이 같으면 두 배치 모두 상한이 `limit ÷ 요청당 CPU 시간`이기 때문입니다. 차이는 그 상한까지 어떤 경로로 가는지, 그리고 상한을 넘긴 부하가 어디에 쌓이는지에 있습니다.
- 스레드 32개가 실제로 겹쳐 도는 구간은 GIL을 놓는 곳뿐입니다. DB 대기와 외부 HTTP 호출은 GIL 밖에 있지만, ORM이 행을 객체로 바꾸는 순간부터 직렬화와 템플릿 렌더링까지는 전부 GIL 안입니다. 이득은 요청 시간 가운데 대기가 차지하는 비중에 정비례합니다.
- `--timeout`의 뜻이 달라집니다. 동기 워커에서는 사실상 요청 상한 노릇을 했지만 gthread에서는 "프로세스가 살아 있다"는 신호에 그칩니다. 상한을 다른 곳에 옮겨 심지 않으면 그냥 사라집니다.
- "느린 요청 하나가 그 워커의 후속을 막는다"는 서술은 기본 설정에서는 틀린 말입니다. 커널 accept 큐가 하나뿐이라 워커에 미리 배정된 후속 요청이란 게 없습니다. 오히려 gthread 쪽이 커넥션을 먼저 집어가면서 그 한 줄을 워커 수만큼 쪼개 놓습니다.
- 장애 반경은 16배 차이가 납니다. 워커 하나가 죽으면 (A)는 요청 1개를 잃고, (B)는 최대 32개에 그 워커가 물고 있던 keep-alive 커넥션까지 전부 잃습니다.
- 스레드는 동시성을 늘릴 뿐 durability를 만들어 주지 않습니다. Celery를 대신할 수 없고, 오히려 순서가 반대입니다. Celery로 무거운 작업을 빼낸 뒤에야 (B)가 유리해지는 조건이 갖춰집니다.
{{< /callout >}}

파드도 같고 CPU limit도 같은 조건에서 두 배치 중 하나를 골라야 하는 상황입니다.

```bash
# (A)
gunicorn app:wsgi --workers 16

# (B)
gunicorn app:wsgi --workers 2 --threads 32
```

"어느 쪽이 빠른가"라고 물으면 답이 안 나옵니다. 최대 처리량이 거의 같기 때문입니다. 실제 차이는 지연이 어떻게 분포하는지, 메모리와 DB 커넥션을 얼마나 쓰는지, 워커 하나가 죽을 때 얼마를 잃는지에서 납니다. 여기에 더해 전환 과정에서 안전장치 하나가 없어지는데, 이게 눈에 잘 띄지 않습니다.

GIL 자체와 CFS 스로틀의 일반론은 [k8s 06 Python GIL × CPU Limit]({{< relref "../../k8s-features/06-python-gil-cfs/index.md" >}})에서 이미 다뤘습니다. 이 문서는 그 바탕 위에서 배포 배치 두 개를 직접 맞대 봅니다.

자매 문서: [01 JVM vs GraalVM]({{< relref "../01-jvm-graalvm/index.md" >}}) — 같은 질문을 JIT과 AOT 축에서 봅니다 · [k8s 02 CPU Throttling]({{< relref "../../k8s-features/02-cpu-throttling/index.md" >}})

## 1. 스레드를 더하는 게 아니라 워커를 갈아 끼우는 것

출발점은 gunicorn 설정 문서의 한 줄입니다.

> If you try to use the `sync` worker type and set the `threads` setting to more than 1, the `gthread` worker type will be used instead.
>
> — 출처: gunicorn Settings, `threads`

`--worker-class`를 따로 적지 않아도 워커 구현이 통째로 바뀝니다. 그리고 두 구현은 구조부터 다릅니다.

동기 워커(`gunicorn/workers/sync.py`)는 단순합니다. 논블로킹 `accept()`를 돌리다가 커넥션이 없으면 `select()`로 잠들고, 커넥션이 오면 `handle()` → `handle_request()`를 차례로 처리합니다. 한 번에 커넥션 하나씩입니다. 여기에 `handle_request()`가 `resp.force_close()`를 명시적으로 호출하는 코드가 있고, keep-alive 미지원의 근거가 바로 그 호출입니다. 문서도 같은 말을 합니다. "each connection is closed after response has been sent (even if you manually add `Keep-Alive` or `Connection: keep-alive` header in your application)."

gthread(`gunicorn/workers/gthread.py`)는 이벤트 루프에 스레드풀을 결합한 하이브리드입니다. `selectors.DefaultSelector` 하나가 리스너 소켓과 keep-alive 상태의 클라이언트 소켓, 아직 데이터가 오지 않은 커넥션을 한꺼번에 감시하다가 커넥션이 준비되면 `ThreadPoolExecutor.submit()`으로 스레드에 넘깁니다. 완료 콜백은 OS 파이프를 타고 메인 루프로 돌아옵니다.

나머지 차이는 전부 이 구조에서 파생됩니다. 뒤의 절들을 읽으려면 특히 아래 둘을 기억해 두는 게 좋습니다.

- 하트비트를 찍는 주체는 selector 메인 루프입니다. 스레드 32개가 전부 긴 요청에 붙들려 있어도 메인 루프는 계속 돌면서 아비터에 "살아 있다"고 보고합니다.
- `threads`는 accept 상한과 무관하고, 실제 상한은 `worker_connections`(기본 1000)입니다. 워커 2개면 최대 2,000개 커넥션을 받아들여 64개 스레드에 태우고, 나머지는 `ThreadPoolExecutor`의 내부 큐에 쌓입니다. 그 큐에는 상한이 없습니다.

## 2. 요청 하나가 GIL 안팎으로 갈린다

스레드를 아무리 늘려도 파이썬 바이트코드는 한 순간에 한 줄만 실행됩니다. CPython 용어집은 같은 문단에서 예외까지 함께 적어 뒀습니다.

> some extension modules, either standard or third-party, are designed so as to release the GIL when doing computationally intensive tasks such as compression or hashing. **Also, the GIL is always released when doing I/O.**
>
> — 출처: CPython 용어집, global interpreter lock

(B)의 32 스레드가 얻는 병렬성은 딱 "GIL을 놓는 구간"만큼입니다. 그 구간이 어디인지 하나씩 짚어 보면 판단이 훨씬 쉬워집니다.

{{< flow src="_flow/2-겹치는-구간.json" />}}

| 놓는다 | 근거 |
|---|---|
| 모든 소켓·파일 I/O | 용어집 "the GIL is always released when doing I/O" |
| `psycopg2`의 쿼리 실행·결과 수신 | `pqpath.c`가 `PQexec`·`PQgetResult`·`PQconsumeInput`을 `Py_BEGIN_ALLOW_THREADS`로 감싼다 |
| `hashlib` | **2047바이트 초과** 데이터에 한해 (문서에 임계값 명시) |
| `numpy` | `NPY_BEGIN_THREADS` 구간. 단 `dtype=np.object_` 배열은 예외 |
| `lxml` | 디스크·메모리 파싱, RelaxNG·XSD 검증, XSLT. 파서를 스레드마다 따로 둘 것 |

| 안 놓는다 | 근거 |
|---|---|
| ORM 행 → 객체 매핑 | 파이썬 객체 생성은 정의상 GIL 보유. SQLAlchemy FAQ가 이 구간을 자기 느림의 원인으로 지목 |
| JSON 직렬화·역직렬화 (`_json` C 가속기) | GIL을 껐다 켜는 비용이 파싱보다 커서 아예 안 놓는 선택 |
| 템플릿 렌더링, 시리얼라이저, 검증 | 순수 파이썬 |

전형적인 Django/FastAPI 요청을 이 표에 대보면 결론은 선명합니다. 겹쳐 도는 구간은 DB 대기와 외부 HTTP 대기 두 개뿐이고, 응답을 만드는 나머지 과정은 여전히 한 줄로 흐릅니다. 그러니 (B)의 이득을 정하는 건 스레드 32개라는 숫자가 아닙니다. 요청 시간에서 대기가 차지하는 비중이고, 이득은 거기에 정비례합니다.

{{< callout type="warning" >}}
gevent/eventlet과 gthread의 차이도 여기서 비롯됩니다. 그린렛은 몽키패칭에 기대는데 psycopg2는 C 확장이라 패치가 되지 않습니다. psycopg2 쪽 설명은 분명합니다. "Because psycopg2's main module is a C extension it cannot be monkey-patched to become coroutine-friendly." 그래서 gevent에서는 `psycogreen.gevent.patch_psycopg()`를 `post_fork()`에서 불러 줘야 합니다. gthread에는 이런 문제가 없습니다. psycopg2가 libpq를 부르기 전에 GIL을 놓기 때문에 OS 스레드는 별다른 손질 없이 잘 돕니다. 드라이버 호환성만 놓고 보면 gthread가 그린렛보다 다루기 쉬운 이유가 이것입니다.
{{< /callout >}}

겹칠 구간이 거의 없는데 스레드만 늘리면 어떻게 되는지를 보여 주는 기록도 있습니다. 에코 서버 실측에서 I/O 스레드만 돌 때는 약 30,000 rps가 나왔는데, 같은 프로세스에 CPU-bound 스레드를 하나 넣자 약 100 rps로 주저앉았습니다. 그 스레드를 별도 프로세스로 빼면 20,000 rps로 돌아옵니다. 1바이트 요청의 원래 처리 시간은 30µs인데 `recv()`·`send()`마다 5ms씩 붙어 10ms가 되는 구조입니다. switch interval 5ms를 I/O 왕복마다 물어내는 것입니다. GIL의 convoy effect 일반론은 [06 §1]({{< relref "../../k8s-features/06-python-gil-cfs/index.md" >}})에 정리돼 있습니다.

## 3. 대기열이 한 줄에서 두 줄로

"동기 워커는 느린 요청 하나가 그 프로세스의 후속 요청을 막는다." 흔히 도는 말이지만 gunicorn 기본 설정에서는 틀린 서술입니다.

리스닝 소켓은 아비터가 `start()`에서 한 번만 만들고, 워커들은 fork로 그 fd를 물려받습니다. 설계 문서의 표현도 같습니다. "Gunicorn relies on the operating system to provide all of the load balancing when handling requests." 워커에 미리 배정된 후속 요청이라는 건 존재하지 않습니다. 큐잉 이론으로 옮기면 c=16짜리 M/M/c, 창구 16개에 줄은 하나인 모델입니다.

{{< flow src="_flow/3-한-줄이-두-줄로.json" />}}

gthread는 이 구조를 바꿉니다. `nr_conns < worker_connections`인 동안 계속 accept하므로 워커가 자기 처리 능력을 넘는 커넥션까지 미리 집어옵니다. 32번째까지는 스레드가 받지만 33번째부터는 executor 큐에서 기다려야 하고, 옆 워커가 놀고 있어도 그 요청이 옮겨 가는 일은 없습니다.

| | (A) sync × 16 | (B) gthread 2 × 32 |
|---|---|---|
| 큐 구조 | 커널 accept 큐 1개 + 서버 16 | 커널 큐 → 워커가 최대 1000씩 선점 → 워커별 무제한 executor 큐 + 서버 32 |
| 대기열 | 단일 | 워커 수만큼 분리 |
| 재분배 | 커널이 비는 워커로 보낸다 | 없음 |
| 초과 부하의 모양 | accept 큐에 쌓임 (backlog 2048 초과 시 거부) | executor 큐에 무한정 쌓임 — **에러가 아니라 지연으로 나타난다** |

두 배치의 성격 차이가 여기서 드러납니다. (A)는 과부하를 거부로 드러내고 (B)는 지연으로 드러냅니다. 앞단에 타임아웃이 없으면 (B)는 클라이언트가 이미 포기한 요청까지 붙들고 계속 처리합니다.

요청 시간의 분산이 커지면 슬롯 수가 적은 쪽이 먼저 무너집니다. 그 차이는 `dhensen/gunicorn-benchmark`에 나와 있습니다(siege, 동시성 10, 1분).

| 워커 클래스 | 워커 | 요청 처리 시간 | 가용성 | 처리량 |
|---|---|---|---|---|
| sync | 9 | 고정 1초 | 100.00% | 8.88 t/s |
| sync | 9 | **random 0~60초** | **76.19%** | 0.27 t/s |
| gevent | 9 | random 0~60초 | 100.00% | 2.82 t/s |
| gevent | **2** | random 0~60초 | 100.00% | 2.79 t/s |

마지막 두 줄이 (B)의 논리를 그대로 보여 줍니다. 동시성이 프로세스 바깥의 축에서 나오면 워커 수는 거의 의미를 잃어서, 9개나 2개나 결과가 같습니다. 이 벤치의 "1초 sleep"은 GIL을 놓는 순수 대기라 실제 앱보다 스레드·그린렛 쪽에 유리한 조건이고, gthread는 목록에 아예 없습니다.

{{< callout type="warning" >}}
벤치마크에서 (B)가 (A)를 몇 배로 이겼다는 숫자를 만나면 keep-alive부터 의심해야 합니다. Django 포럼에 I/O가 전혀 없는 `JSONResponse` 워크로드 실측이 하나 있는데, sync 8워커가 501 req/s를 낼 때 8워커 × 2스레드는 3,796 req/s로 7.5배가 났습니다. I/O가 없으니 GIL 병렬성으로는 설명되지 않습니다. 동기 워커의 `force_close()` 때문에 매 요청마다 TCP를 새로 열고 닫는다는 설명이 가장 그럴듯합니다(이 가설은 해당 스레드에서 명시적으로 검증되지 않았습니다). 이 설명이 맞다면 격차는 프록시를 앞에 두는 순간 사라집니다. gunicorn 문서가 "동기 워커는 nginx 뒤 전제"라고 분명히 적어 둔 이유도 여기에 있습니다.
{{< /callout >}}

## 4. CPU limit과의 정합성 — 우연히 맞아떨어지는 지점

[06 §3]({{< relref "../../k8s-features/06-python-gil-cfs/index.md" >}})의 결론은 이랬습니다. limit이 1코어 이상이면 순수 파이썬 프로세스 하나는 바이트코드만으로는 스로틀될 수 없습니다. 그 보장을 깨는 첫 번째 경로가 [06 §4]({{< relref "../../k8s-features/06-python-gil-cfs/index.md" >}})에 있었는데, 워커를 N개 띄우면 N코어분을 태울 수 있다는 것이었습니다.

이걸 두 배치에 그대로 대입하면 이렇게 됩니다.

| | 동시에 CPU를 태울 수 있는 단위 | CPU limit 2코어에서 |
|---|---|---|
| (A) 워커 16 | 16 | quota를 최대 **8배 속도**로 태운다 → 스로틀 |
| (B) 워커 2 × 스레드 32 | 2 (GIL 해제 구간 제외) | limit과 **정확히 일치** |

GIL의 천장과 CPU limit의 천장이 우연히 겹치는데, 여기에 (B)의 숨은 장점이 있습니다. 프로세스가 스레드를 몇 개 돌리든 바이트코드 실행은 프로세스당 1코어를 넘지 못하므로, 프로세스 수를 limit에 맞춰 두면 quota 소진 속도가 저절로 맞아 들어갑니다.

반례는 §2 표의 왼쪽 열입니다. numpy·lxml·psycopg2가 GIL을 놓는 구간에서는 (B)도 코어 여러 개를 한꺼번에 씁니다. 네이티브 스레드풀을 쓰는 라이브러리까지 있으면 스레드 위에 스레드풀이 한 겹 더 생기니, `OMP_NUM_THREADS` 계열 환경변수를 고정하는 일이 (B)에서는 훨씬 중요해집니다([06 §4 ②]({{< relref "../../k8s-features/06-python-gil-cfs/index.md" >}})).

`2 × CPU + 1` 공식은 이 논의에 끌어오면 안 됩니다. 그 공식의 근거를 gunicorn 문서 스스로 밝히고 있습니다. "one worker will be reading or writing from the socket while the other worker is processing a request." 프록시 뒤에서 요청이 이미 버퍼링돼 있으면 이 근거의 절반이 사라집니다. 공식 자체가 동기 워커를 전제하므로 gthread에 그대로 적용하면 실행 단위가 `workers × threads`로 곱해지는 문제도 있습니다. 문서가 `threads` 항목에 같은 범위를 한 번 더 적어 둔 탓에 두 값을 곱해 버리는 사고가 나기 쉽습니다.

## 5. 메모리와 커넥션 — 계산부터 틀리기 쉬운 곳

### 메모리는 16배가 아니다

"워커 16개 × RSS 300MB = 4.8GB"라는 계산은 틀렸습니다. RSS는 공유 페이지를 프로세스마다 따로 세기 때문에 더하면 같은 페이지가 여러 번 잡힙니다. 실제 물리 사용량은 PSS를 합해서 봐야 합니다.

그럼 얼마나 공유되나. `preload_app`을 켜면 fork 전에 앱이 로드되니 코드와 임포트 힙은 COW로 공유됩니다. 문제는 파이썬에서는 COW가 잘 먹지 않는다는 데 있습니다. 이유와 처방은 CPython 문서가 함께 적어 뒀습니다.

> avoiding creation of freed "holes" in memory pages in the parent process and ensuring that GC collections in child processes won't touch the `gc_refs` counter of long-lived objects originating in the parent process. To accomplish both, call `gc.disable()` early in the parent process, `gc.freeze()` right before `fork()`, and `gc.enable()` early in child processes.
>
> — 출처: CPython `gc.freeze()` 문서

객체를 읽기만 해도 참조 카운트가 올라가고, 그 순간 페이지에 쓰기가 발생합니다. 커널로서는 그 페이지를 COW로 복사하는 수밖에 없습니다. GC의 세대 승격 역시 `gc_refs`를 건드려 같은 일을 벌입니다. `gc.freeze()`가 3.7에 들어온 배경이 이것입니다.

공개된 실측도 하나 있습니다. preload와 COW 정리를 적용하자 limit에 닿던 파드 메모리가 6GiB에서 약 1.3GB로 떨어졌고, 워커를 하나 더할 때의 한계비용이 수백 MB에서 수십 MB로 내려갔다는 보고입니다(워커 수와 앱 크기는 비공개).

그러니 (A)와 (B)의 메모리 차이는 "16벌 대 2벌"로 계산할 게 아닙니다. 워커 추가의 한계비용 × 14이고, 그 한계비용은 앱이 요청을 처리하면서 얼마나 쓰기를 하느냐에 달렸습니다. `preload_app`을 켜지 않았다면 차이가 크고, 켜고 `gc.freeze()`까지 해 뒀다면 생각보다 작습니다.

### DB 커넥션은 계산이 정직하게 갈린다

SQLAlchemy 기본 풀은 `pool_size=5`, `max_overflow=10`라서 프로세스 하나가 최대 15개를 엽니다. 풀은 프로세스 경계를 넘지 못합니다. 공식 문서가 "It's critical that ... the pooled connections are not shared to a forked process"라고 경고하면서 자식 프로세스에서는 `Engine.dispose(close=False)`를 부르라고 안내합니다.

| | 프로세스 | 프로세스당 풀 | 파드당 | 파드 10개 |
|---|---|---|---|---|
| (A) 워커 16 | 16 | 5 (+10) | 80 ~ 240 | **800 ~ 2,400** |
| (B) 워커 2 × 스레드 32 | 2 | 32 필요 | 64 | 640 |

PostgreSQL `max_connections` 기본값은 100이고, 두 배치 모두 이 값을 넘깁니다. 그런데 두 숫자의 성격이 다릅니다.

(A)의 워커는 한 번에 요청 하나만 처리하니 자기 풀에서 같은 순간에 쓰는 커넥션은 최대 1개입니다. 80개를 열어 두고도 실제로 한꺼번에 쓰는 건 16개이고, 나머지 64개는 열린 채 놀고 있습니다. (B)에서는 32 스레드가 정말로 32개를 한꺼번에 씁니다. (A)의 초과분은 낭비지만 (B)의 숫자는 실사용입니다. 그래서 PgBouncer를 transaction 모드로 앞에 두면 (B) 쪽이 훨씬 잘 접힙니다.

## 6. 장애 반경, 그리고 사라지는 타임아웃

(A)에서 (B)로 옮길 때 위험이 가장 눈에 띄지 않게 커지는 대목입니다.

`timeout` 설정 문서를 한 글자씩 그대로 읽을 필요가 있습니다.

> Workers silent for more than this many seconds are killed and restarted. ... **For the non sync workers it just means that the worker process is still communicating and is not tied to the length of time required to handle a single request.**
>
> — 출처: gunicorn Settings, `timeout`

§1에서 본 대로 gthread의 하트비트는 selector 메인 루프가 찍습니다. 스레드 32개가 전부 60초짜리 쿼리에 매달려 있어도 메인 루프는 멀쩡히 돌고, 아비터는 아무 이상도 감지하지 못합니다. 동기 워커에서 사실상 요청 상한이던 `--timeout 30`이 gthread에서는 요청 시간과 아무 관계도 없어집니다.

전환한다면 상한을 다른 층으로 옮겨 심어야 합니다. DB `statement_timeout`, HTTP 클라이언트 타임아웃, 앞단 프록시 타임아웃이 그 자리입니다. 이 이관을 빼먹으면 며칠 뒤에 "왜 요청이 안 끝나지"가 찾아옵니다.

나머지 격리 항목은 표로 모았습니다.

| 사건 | (A) sync × 16 | (B) gthread 2 × 32 |
|---|---|---|
| 세그폴트·OOM으로 워커 1개 사망 | 요청 1개 손실, 용량 1/16 감소 | **최대 32개 손실** + 물고 있던 keep-alive 커넥션(최대 1000) 전부 끊김, 용량 **절반** 감소 |
| `--timeout` 초과 | SIGABRT → SIGKILL. 사실상 요청 타임아웃 | **발동 안 함** |
| `max_requests` 재활용 | 1/16씩 순환, 용량 진동 작음 | 하나 빠질 때 용량 절반. **jitter 필수** |
| 메모리 누수 | 잦은 재활용이 사실상 완화책 | 두 프로세스가 오래 살며 누적 |
| 롤링 배포 SIGTERM | 워커당 요청 1개 정리 | 워커당 최대 32개, `graceful_timeout` 30초 안에 못 끝나면 SIGKILL |

특히 조심할 값은 `max_requests_jitter` 기본값 0입니다. 워커가 2개뿐인데 둘이 같은 시점에 재활용되면 그 순간 용량은 0이 됩니다. 워커 수가 적을수록 jitter가 더 절실해집니다.

그레이스풀 종료에 알려진 구멍도 (B)에서 더 아프게 옵니다. 워커는 TERM을 받으면 accept를 멈추기 때문에, 소켓 backlog에 남아 아직 accept되지 않은 요청은 그대로 버려집니다([#3397](https://github.com/benoitc/gunicorn/issues/3397)). 워커 2개가 각각 최대 1,000개 커넥션을 물고 있는 상태라면 버려지는 양도 그만큼 큽니다.

## 7. Celery 자리에 스레드를 놓을 수 있나

"셀러리 워커 말고 스레드로 비동기를 같이 나누면" 어떠냐는 질문에는 답이 분명합니다. 아니오. 순서를 뒤집으면 맞는 말이 됩니다.

Celery가 파는 물건은 동시성이 아니라 durability입니다. 문서가 보장하는 것도 딱 그것 하나입니다.

> A task message is not removed from the queue until that message has been acknowledged by a worker.
>
> — 출처: Celery Tasks 사용자 가이드

워커가 죽으면 메시지는 다른 워커로 다시 전달됩니다. 스레드에는 이런 성질이 전혀 없습니다. 응답을 돌려준 뒤에도 돌고 있는 스레드는 `max_requests` 재활용, 롤링 배포의 SIGTERM, `graceful_timeout` 만료의 SIGKILL 앞에서 그대로 사라집니다. gunicorn의 그레이스풀이 세는 단위는 HTTP 요청이지, 응답이 이미 나간 뒤의 스레드가 아닙니다.

FastAPI 공식 문서가 제시하는 판단 기준도 같은 선 위에 있습니다.

> if you need to access variables and objects from the same FastAPI app, or you need to perform **small** background tasks (like sending an email notification), you can simply just use `BackgroundTasks`.
>
> — 출처: FastAPI Background Tasks

무게는 "small"에 실려 있습니다. 그리고 `BackgroundTasks`가 쓰는 스레드풀에는 함정이 하나 더 숨어 있습니다.

{{< callout type="warning" >}}
`def` 라우트 핸들러와 `BackgroundTasks`의 동기 함수는 같은 리미터를 나눠 씁니다. Starlette의 `BackgroundTask.__call__`은 동기 함수를 `run_in_threadpool()`로 넘기는데, 그 뒤에 있는 anyio 기본 스레드 리미터가 40 토큰입니다. `def`로 선언한 엔드포인트도 같은 40개에서 가져다 씁니다. 백그라운드 작업이 느려지면 요청 처리 슬롯이 그만큼 줄어듭니다. 백프레셔로 밀어내는 게 아니라 슬롯을 잠식하는 것입니다. `to_thread.current_default_thread_limiter().total_tokens`로 올릴 수는 있지만, 올리는 순간 GIL 경합도 함께 올라갑니다.
{{< /callout >}}

| 요청 프로세스 안 스레드로 충분한 것 | Celery로 가야 하는 것 |
|---|---|
| 잃어도 사용자가 재시도로 복구 가능한 작업 (알림 메일 1통) | 잃으면 정합성이 깨지는 작업 |
| 초 단위 이하로 끝나는 단발 I/O (웹훅 발사, 로그 적재) | 배포 주기보다 오래 걸리는 작업 |
| 아무도 결과를 조회하지 않는 작업 | 상태·진행률을 조회해야 하는 작업 |
| 재시도가 필요 없는 작업 | 재시도 정책·백오프가 필요한 작업 |
| | 처리량을 요청 트래픽과 독립적으로 스케일해야 하는 작업 |
| | CPU를 오래 쓰는 작업 — GIL을 붙들어 그 워커의 모든 스레드를 굶긴다 |

마지막 줄은 §2의 30,000 → 100 rps 사례와 같은 상황입니다. 무거운 CPU 작업이 요청 프로세스 안에 하나라도 있으면 스레드를 몇 개 두든 그 프로세스는 멈춰 섭니다.

순서가 있는 이유가 여기 있습니다. Celery로 무거운 작업을 먼저 빼내면 요청당 CPU 시간 비중이 떨어지고, 그때 비로소 (B)가 유리해지는 조건이 갖춰집니다. 스레드는 Celery를 대체하지 못합니다. Celery가 스레드를 쓸 만하게 만들어 줄 뿐입니다.

## 8. 그래서 어느 쪽인가

### 이론 상한부터 맞춰 놓기

CPU limit 2코어, 요청당 CPU 시간 `c`, I/O 대기 `w`라고 두면 처리량 상한은 이렇게 됩니다.

- **(A)** 처리량 상한 `min(16/(c+w), 2/c)`
- **(B)** 처리량 상한 `min(64/(c+w), 2/c)`

두 번째 항은 양쪽이 같습니다. `2/c`는 CPU limit이 정하는 천장이라 배치와 무관하고, 그래서 최대 처리량이 같습니다. (B)가 앞서는 구간은 첫 번째 항이 지배할 때, 곧 `c`가 아주 작고 `w`가 아주 큰 워크로드(전형적인 API 게이트웨이, 외부 API 조합)뿐입니다. 이론상 최대 4배(64/16)입니다.

### 결정 변수 다섯 개

| 변수 | 재는 법 | (A)가 낫다 | (B)가 낫다 |
|---|---|---|---|
| 요청당 GIL 보유 시간 비중 | APM 스팬에서 DB·외부호출 시간을 뺀 나머지 ÷ 전체 | 높다 (>50%) | 낮다 (<20%) |
| 요청 시간의 분산 | p99 ÷ p50 | 작다 (<3) | 크다 (>10) |
| 메모리 여유 | preload 켜고 **PSS**로 측정 (RSS 합산 금지) | 여유 있음 | 빠듯함 |
| DB 커넥션 상한 여유 | `파드 × 워커 × pool_size` | 여유 있음 | 빠듯함 · PgBouncer 없음 |
| CPU limit과 실행 단위의 정합 | `workers` vs `limits.cpu` | limit ≥ 워커 수 | limit이 1~2코어 |

수치만으로는 결론이 나지 않는 요구사항도 있습니다.

| 요구사항 | 갈림 |
|---|---|
| 요청 타임아웃이 gunicorn 층에 있어야 한다 | (A). (B)로 가려면 DB·클라이언트·프록시로 옮겨 심고 갈 것 |
| 인플라이트 손실을 최소화해야 한다 | (A). 워커 1개 사망의 대가가 16배 다르다 |
| 앞단 프록시 없이 인터넷에 직접 노출된다 | (B) 또는 async. 동기 워커는 느린 클라이언트에 공식 비권장 |
| numpy·BLAS·lxml을 쓴다 | 어느 쪽이든 스레드 수 환경변수 고정이 먼저. (B)에서 특히 |
| 메모리 누수가 있다 | (A)의 잦은 재활용이 사실상 완화책. (B)면 `max_requests` + jitter 필수 |

### 그런데 공식 방향은 둘 다 아니다

gunicorn 문서는 워커 수 상한을 이렇게 적어 뒀습니다. "Gunicorn should only need **4-12 worker processes** to handle hundreds or thousands of requests per second." (A)의 16은 이 범위 바깥입니다. FastAPI 문서는 한 걸음 더 나갑니다. "when running on Kubernetes you will probably not want to use workers and instead run a **single Uvicorn process per container**."

컨테이너 환경에서 두 문서가 같이 권하는 방향은 프로세스를 적게 두고 파드로 수평 확장하는 쪽입니다. (B)가 거기에 더 가깝습니다. 근거는 §4의 우연한 일치입니다. GIL의 천장이 곧 CPU limit의 천장이므로, 프로세스 수를 limit에 맞춘 배치가 자원 회계상 가장 정직합니다.

## 9. free-threading이 이 논쟁을 끝내나

아직 아닙니다.

Python 3.14에서 PEP 779로 free-threaded 빌드가 공식 지원에 들어갔습니다. 단일 스레드 성능 페널티도 크게 줄었는데, 공식 수치가 두 군데에 있고 값이 조금씩 다릅니다.

| 출처 | 수치 |
|---|---|
| What's New in 3.14 | "roughly **5-10%**, depending on the platform and C compiler" |
| Free-threading HOWTO | "average overhead ranges from about **1% on macOS aarch64 to 8% on x86-64 Linux**" |

컨테이너는 x86-64 Linux가 절대다수이니 실무 기준선은 약 8%로 잡는 게 맞습니다. 같은 CPU limit 안에서 아무 대가 없이 빠져나가는 비용입니다.

더 큰 문턱은 생태계 쪽에 있습니다. 2026년 2월 기준으로 다운로드 상위 360개 네이티브 확장 패키지 가운데 free-threaded 휠을 올린 쪽이 절반을 막 넘긴 정도입니다. 휠 태그(`cp313t`/`cp314t`)가 없는 패키지가 하나만 있어도 스택 전체의 전환이 막힙니다. 안정 ABI는 아직 PEP 803(`abi3t`) 단계입니다.

numpy 문서가 붙여 둔 경고도 흘려 넘길 게 아닙니다. `dtype=np.object_` 배열이 GIL의 보호를 받지 못하게 되면서, free-threading 이전에는 없던 데이터 레이스가 생깁니다.

3.14의 `concurrent.interpreters`(PEP 734)는 또 다른 갈래입니다. "프로세스의 격리와 스레드의 효율"을 노리지만, 공식 문서가 밝히는 현재 한계가 적지 않습니다. 인터프리터 기동은 아직 최적화되지 않았고, 인터프리터마다 메모리가 필요 이상으로 들고, 객체 공유는 `memoryview` 수준에 묶여 있으며, PyPI 확장 모듈 상당수가 비호환입니다.

오늘의 (A) vs (B) 결정에 free-threading을 "곧 해결될 것"이라며 끌어오면 안 됩니다. 정말 GIL 없이 돌 수 있는 스택이라면 (B)의 천장이 사라지는 게 맞습니다. 그 조건에 이미 들어와 있는지부터 확인하는 게 순서입니다.

## 이 문서에서 가져갈 것

- `--threads`를 주는 건 스레드를 더하는 게 아니라 워커 구현을 바꾸는 일입니다. keep-alive, accept 모델, 타임아웃의 의미가 전부 함께 바뀝니다.
- 두 배치의 최대 처리량은 같습니다. 천장은 `limit ÷ 요청당 CPU 시간`이 정하고 배치로는 바꿀 수 없습니다. 배치가 바꾸는 건 지연 분포, 메모리, 커넥션, 장애 반경입니다.
- 스레드가 얻는 병렬성은 GIL을 놓는 구간만큼입니다. DB·외부 HTTP 대기는 겹치지만 ORM 매핑부터 직렬화까지는 겹치지 않습니다. 이득을 예측하려면 APM에서 그 비율부터 재세요.
- `--timeout`은 더 이상 요청 상한이 아닙니다. 전환할 때 DB `statement_timeout`, 클라이언트 타임아웃, 프록시 타임아웃으로 옮겨 심어야 하는데, 가장 자주 빠뜨리는 항목이 이것입니다.
- 워커를 줄이면 `max_requests_jitter`는 필수가 됩니다. 워커 2개가 한꺼번에 재활용되는 순간 용량이 0이기 때문입니다.
- 스레드는 Celery를 대체하지 못합니다. 순서는 반대여서, 무거운 작업을 Celery로 뺀 결과로 (B)가 유리해지는 조건이 생깁니다.
- 메모리를 볼 땐 RSS를 합산하지 마세요. PSS로 재고, `preload_app`과 `gc.freeze()`를 켠 상태에서 워커 하나를 더할 때의 한계비용을 봅니다.

## 참고 자료

**gunicorn**
- [Settings](https://gunicorn.org/reference/settings/) — `threads`가 gthread를 강제한다는 서술, `timeout`이 non-sync에서 갖는 의미, `worker_connections` 1000, `keepalive`가 sync에서 무시된다는 서술
- [Design](https://gunicorn.org/design/) · [설계 문서 원문(23.0.0)](https://github.com/benoitc/gunicorn/blob/23.0.0/docs/source/design.rst) — OS가 로드밸런싱한다, `2 × cores + 1`의 근거, "4-12 worker processes", 동기 워커는 nginx 뒤 전제 · [FAQ](https://gunicorn.org/faq/)
- 소스 [`sync.py`](https://github.com/benoitc/gunicorn/blob/master/gunicorn/workers/sync.py) · [`gthread.py`](https://github.com/benoitc/gunicorn/blob/master/gunicorn/workers/gthread.py) · [`arbiter.py`](https://github.com/benoitc/gunicorn/blob/master/gunicorn/arbiter.py)
- 이슈 [#3129](https://github.com/benoitc/gunicorn/issues/3129) — timeout 의미 문서화 제안 · [#2529](https://github.com/benoitc/gunicorn/issues/2529) · [#3397](https://github.com/benoitc/gunicorn/issues/3397) — 그레이스풀 종료의 구멍 · [PR #2938](https://github.com/benoitc/gunicorn/pull/2938) — `reuse_port`

**CPython**
- [용어집 — GIL](https://docs.python.org/3/glossary.html#term-global-interpreter-lock) · [`sys.setswitchinterval`](https://docs.python.org/3/library/sys.html#sys.setswitchinterval) · [`hashlib`](https://docs.python.org/3/library/hashlib.html) (2047바이트) · [`gc.freeze`](https://docs.python.org/3/library/gc.html) · [`concurrent.futures`](https://docs.python.org/3/library/concurrent.futures.html) · [`asyncio.to_thread`](https://docs.python.org/3/library/asyncio-task.html#asyncio.to_thread)
- [What's New 3.13](https://docs.python.org/3/whatsnew/3.13.html) · [What's New 3.14](https://docs.python.org/3/whatsnew/3.14.html) · [Free-threading HOWTO](https://docs.python.org/3/howto/free-threading-python.html) · [PEP 684](https://peps.python.org/pep-0684/) · [PEP 803](https://peps.python.org/pep-0803/)

**라이브러리**
- [numpy Thread Safety](https://numpy.org/doc/stable/reference/thread_safety.html) · [lxml FAQ](https://lxml.de/FAQ.html) · [psycopg2 `pqpath.c`](https://github.com/psycopg/psycopg2/blob/master/psycopg/pqpath.c) · [psycogreen](https://github.com/psycopg/psycogreen/)
- [SQLAlchemy Pooling](https://docs.sqlalchemy.org/en/20/core/pooling.html) · [Performance FAQ](https://docs.sqlalchemy.org/en/20/faq/performance.html) · [PostgreSQL 연결 설정](https://www.postgresql.org/docs/current/runtime-config-connection.html) · [PgBouncer](https://www.pgbouncer.org/config.html)
- [Celery Tasks](https://docs.celeryq.dev/en/stable/userguide/tasks.html) · [Celery Concurrency](https://docs.celeryq.dev/en/latest/userguide/concurrency/index.html)
- [FastAPI async](https://fastapi.tiangolo.com/async/) · [BackgroundTasks](https://fastapi.tiangolo.com/tutorial/background-tasks/) · [Server Workers](https://fastapi.tiangolo.com/deployment/server-workers/) · [Starlette `background.py`](https://github.com/encode/starlette/blob/master/starlette/background.py) · [anyio threads](https://anyio.readthedocs.io/en/stable/threads.html) (40 토큰)

**실측 — 조건을 함께 읽을 것**
- [tenthousandmeters — GIL and its effects](https://tenthousandmeters.com/blog/python-behind-the-scenes-13-the-gil-and-its-effects-on-python-multithreading/) — 에코 서버 30,000 → 100 rps. 합성 마이크로벤치라 배율과 메커니즘만
- [dhensen/gunicorn-benchmark](https://github.com/dhensen/gunicorn-benchmark) — 요청 시간 분산. gthread는 목록에 없음
- [Django 포럼 — async vs sync is slow](https://forum.djangoproject.com/t/django-async-vs-sync-is-slow/21541) — sync 501 → gthread 3,796 req/s. keep-alive 가설은 그 스레드에서 검증되지 않음
- [Bolna — cutting per-pod memory with gunicorn preload](https://www.bolna.ai/blog/cutting-per-pod-memory-gunicorn-preload) — PSS vs RSS, 6GiB → 1.3GB. 워커 수 비공개
- [kisspeter — FastAPI workers and threads](https://kisspeter.github.io/fastapi-performance-optimization/workers_and_threads.html) — Python 3.14.6, 2코어. 워커 클래스 미명시
- [pythonspeed — Python's GIL](https://pythonspeed.com/articles/python-gil/) — JSON 파서가 GIL을 안 놓는 이유
