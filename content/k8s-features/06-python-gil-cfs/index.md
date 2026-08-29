---
title: "Python GIL × CPU Limit"
date: 2026-08-06
weight: 6
---

# 06 · Python GIL × CPU Limit — "1코어 런타임"은 왜 잘리는가

{{< callout type="info" >}}
- GIL은 성능 장치가 아니라 **뮤텍스**입니다. 바이트코드를 실행하는 스레드가 한 순간에 하나뿐이므로 순수 파이썬 프로세스의 CPU 소비는 **정의상 코어 하나 분을 넘지 못합니다** — limit이 1코어 이상이면 바이트코드만으로는 스로틀이 성립하지 않습니다.
- CFS quota는 "코어당 지분"이 아니라 **시간 예산 풀**입니다. 4코어 노드의 limit 1이 "코어마다 25%씩"을 뜻하지는 않습니다. 실행할 스레드가 있는 런큐만 전역 풀에서 5ms 슬라이스를 꺼내가는 구조입니다.
- 그런데도 실제 파이썬 컨테이너는 잘립니다. 경로는 네 갈래입니다 — **워커 프로세스 다중화 · GIL을 놓는 네이티브 스레드풀 · 1코어 미만 limit의 슬라이스 입도 · free-threading.** 현행 커널의 파이썬 스로틀 사고는 전부 여기 속합니다.
- 잘리면 더 아픕니다. throttle은 per-CPU 단위라 **GIL 홀더가 있는 코어만 잘려도 프로세스 전체가 유저스페이스에서 멈춥니다.** 커널은 이 문제의 커널 락 버전을 고치는 중이지만 GIL은 유저스페이스 락이라 보호 밖입니다.
- Python은 Go 1.25와 달리 **cgroup을 안 봅니다.** `os.cpu_count()`는 노드 코어 수를 돌려주고 3.13의 해법(`PYTHON_CPU_COUNT`)도 수동 주입입니다. 처방은 전부 배포 파이프라인의 몫입니다.
{{< /callout >}}

왜 이 문서가 따로 있나. [02 CPU Throttling]({{< relref "02-cpu-throttling.md" >}})이 "스로틀이 무엇이고, 어떻게 보이고, 무엇으로 대응하나"를 다룬다면 이 문서는 같은 문제를 **언어 런타임 쪽에서** 봅니다. 파이썬의 GIL은 두 개의 그럴듯한 오해를 만듭니다 — "GIL은 1코어를 갈구도록 설계된 구조다"와 "limit 1은 4코어에서 25%씩 배급받는다는 뜻이다". 이 문서는 두 오해를 커널·CPython 소스 수준에서 바로잡고 그 위에서 "그런데 왜 실제 파이썬 컨테이너는 잘리는가"를 답합니다. 02 §4의 런타임 표(Go·JVM·Node.js)에서 비어 있던 Python 행이 이 문서입니다.

자매 문서: [챕터 개요]({{< relref "_index.md" >}}) · 스로틀의 증상·관측·대응 일반론은 [02 CPU Throttling]({{< relref "02-cpu-throttling.md" >}}) · 안 쓴 quota를 적립하는 커널 기능은 [03 CPU Burst]({{< relref "03-cpu-burst.md" >}}) · limit을 무중단으로 바꾸는 [01 In-Place Pod Resize]({{< relref "01-inplace-pod-resize.md" >}}) · 이 사실들을 배포 배치 선택에 적용한 [런타임 02 Python 워커와 스레드]({{< relref "../../runtime/02-python-worker-thread/index.md" >}})

## 1. 오해 ① — "GIL은 1코어를 갈구도록 설계된 구조다"

GIL은 최적화가 아니라 **인터프리터 내부 상태를 지키는 뮤텍스**입니다. CPython 공식 용어집의 정의가 정확합니다 — "only one thread executes Python bytecode at a time. This simplifies the CPython implementation by making the object model (including critical built-in types such as dict) **implicitly safe** against concurrent access." 지키는 대상은 레퍼런스 카운팅과 내장 타입의 내부 상태입니다. 그 대가로 세밀한 락 없는 빠른 단일 스레드 실행과 단순한 C 확장 모델을 얻습니다. "1코어를 잘 갈군다"는 부산물일 뿐입니다.

이 정의에서 정정 두 개가 따라 나옵니다.

**GIL은 스레드를 코어에 고정하지 않습니다.** 배치는 OS 로드밸런서의 몫입니다. GIL 홀더는 베어메탈에서든 컨테이너에서든 코어 사이를 옮겨 다닙니다. "한 코어에 눌러앉아 캐시를 데우며 돈다"는 GIL이 보장해 주는 게 아닙니다 — 그건 cpuset의 영역입니다([02 BP ②]({{< relref "02-cpu-throttling.md" >}})).

**GIL은 멀티코어를 만나면 오히려 못합니다.** David Beazley가 이걸 처음 실측했습니다. CPU-bound 스레드와 I/O 스레드를 섞은 벤치마크에서:

| 조건 | 처리 시간 |
|---|---|
| 1코어 | 0.297초 |
| **2코어** + CPU-bound 스레드 1개 | **9.166초** |
| 2코어 + CPU-bound 스레드 2개 | 28.064초 |

코어를 늘렸는데 30배 느려집니다. I/O 스레드가 `recv()`에서 GIL을 놓았다 되찾으려는 순간 다른 코어의 CPU-bound 스레드가 먼저 낚아채기 때문입니다. 이게 **convoy effect**입니다. CPython 이슈 [bpo-7946](https://bugs.python.org/issue7946)에는 더 극단적인 값이 남아 있습니다 — 같은 코드가 멀티코어에서 59.5초, 단일 코어로 강제하면 0.120초. **약 500배.** Python 3.2의 새 GIL(5ms switch interval, `sys.setswitchinterval`)이 최악 케이스를 완화했지만 bpo-7946 자체는 여러 패치 제안 끝에 "무기한 보류"로 닫혔습니다. 잔존 convoy는 지금도 있습니다. 이 문서 관점에서 중요한 건 방향입니다 — **GIL의 문제는 코어를 못 쓰는 것이지, 코어를 잘 쓰는 게 아닙니다.**

복선 하나. 용어집 정의의 뒷문장 — 확장 모듈은 압축·해시 같은 연산 집약 구간에서 GIL을 자발적으로 놓을 수 있고(`Py_BEGIN_ALLOW_THREADS`), **I/O 중에는 항상 놓습니다.** "바이트코드 실행은 한 스레드"라는 천장은 파이썬 바이트코드에만 적용됩니다. §4에서 이 문장이 돌아옵니다.

## 2. 오해 ② — "4코어 노드에서 limit 1이면 코어당 25%씩 배급받는다"

limit이 quota로 변환되는 산수(quota = limit × period, 기본 100ms)와 "period 간 이월 없음"은 [02 §1]({{< relref "02-cpu-throttling.md" >}})이 다뤘습니다. 이 절은 그 아래층을 봅니다 — **그 quota가 코어에 어떻게 도달하는가**. 커널 문서(sched-bwc.rst)의 한 문장이 구조를 그대로 말해줍니다: "quota is assigned to per-cpu run queues **in slices** as threads in the cgroup become runnable... transferred to cpu-local 'silos' **on a demand basis**."

1. period마다 cgroup의 **전역 풀**에 quota가 충전됩니다.
2. 각 코어의 런큐는 **그 코어에서 이 cgroup의 스레드가 실행되려 할 때만** 풀에서 슬라이스를 꺼내옵니다. 단위는 5ms입니다(`sched_cfs_bandwidth_slice_us`, 기본 5000µs).
3. 그 코어의 스레드가 전부 잠들면 slack 타이머가 로컬 잔여분을 **1ms만 남기고** 풀로 반납합니다(`min_cfs_rq_runtime`).

{{< flow src="_flow/2-쿼터는-풀이다.json" />}}

"코어당 25ms 예약" 같은 것은 어디에도 없습니다. 실행 스레드가 1개면 그 스레드가 올라간 코어 하나만 5ms씩 계속 꺼내갑니다. 나머지 코어는 꺼내갈 이유가 없습니다. "25ms × 4"라는 숫자가 나오는 유일한 조건은 **동시에 실행 중인 스레드가 4개일 때**입니다 — 4개 런큐가 각자 인출해 100ms를 wall-clock 25ms에 태우고 남은 75ms는 전원 정지입니다. 이 그림은 수요가 만든 결과일 뿐입니다([02 §4]({{< relref "02-cpu-throttling.md" >}})).

throttle의 단위도 흔한 서술과 다릅니다. 커널 함수 시그니처가 `throttle_cfs_rq(struct cfs_rq *)` — **잘리는 것은 cgroup 전체가 아니라 개별 코어의 런큐**입니다. 전역 풀이 마르면 각 코어가 로컬 잔여분을 소진하는 순서대로 하나씩 잘립니다. 잘린 런큐의 태스크는 `dequeue_entity(DEQUEUE_SLEEP)`로 **런큐에서 제거**됩니다. 우선순위가 낮아지는 정도가 아닙니다. 부활 시점도 "다음 period"가 유일한 답은 아닙니다. period 타이머의 리필·분배가 기본이지만 다른 코어가 반납한 slack이 충분히 쌓이면 slack 타이머의 `distribute_cfs_runtime()`이 period 경계 전에 깨우기도 합니다. "period 경계 또는 slack 분배 중 먼저 오는 쪽"이 답입니다.

{{< callout type="info" >}}
**"내 노드는 CFS가 아닌데?"** — 커널 6.6부터 기본 픽 정책은 EEVDF로 바뀌었습니다. 하지만 bandwidth control(전역 풀·슬라이스·throttle)은 `kernel/sched/fair.c` 안에 CFS 시절 구조 그대로 남아 있고 `cpu.max` 인터페이스도 불변입니다. 이 문서의 서술은 EEVDF 노드에도 그대로 적용됩니다.
{{< /callout >}}

{{< callout type="warning" >}}
**슬라이스에는 두 시대가 있습니다.** 지금 커널 문서는 "Once a slice is assigned to a cpu **it does not expire**"라고 말하지만 2018~2019년에는 달랐습니다. 2014년 v3.16에 들어간 만료 로직(51f2176d74ac)이 조건문 버그로 5년간 죽어 있었습니다. 4.18의 유효한 수정(512ac999d275)이 이를 깨웠습니다. 그러면서 88코어 노드 기준 period당 최대 87ms의 quota가 "남았는데 못 쓰는" 채 증발하는 시대가 열렸습니다. Indeed가 이걸 git bisect로 추적해 만료 제거 패치(de53fd7aedb1)를 5.4에 넣었고 4.19.x·4.14.x stable로도 백포트됐습니다. **"사용률이 낮은데 잘린다 → limit을 빼라"는 조언의 유행은 상당 부분 이 시대의 유산입니다**([02 BP ①]({{< relref "02-cpu-throttling.md" >}})의 #67577 포함). 현행 커널에서 같은 증상을 본다면 원인은 커널 버그가 아니라 §4입니다.
{{< /callout >}}

## 3. 겹쳐 보면 — limit ≥ 1코어인 GIL 프로세스는 잘릴 수 없다

두 정정을 곱하면 이 문서의 첫 결론이 나옵니다. 바이트코드 실행이 소비하는 CPU-time은 스레드가 몇 개든 GIL 때문에 **최대 코어 하나 분**입니다. limit 1코어의 충전 속도도 코어 하나 분입니다. 소진이 충전을 초과할 수 없으니 **스로틀이 수학적으로 성립하지 않습니다.** 스로틀된 적 없는 cgroup에게 period 경계는 아무 이벤트도 아니어서 스레드는 경계를 인지하지 못한 채 그냥 돕니다. GIL 대기 스레드가 5ms마다 깨어나는 오버헤드 같은 잔돈이 있어 딱 1.0은 아닙니다. 그래도 1코어 limit을 뚫지는 못합니다.

**GIL과 limit 1은 아귀가 맞는 조합입니다.** 순수 파이썬 프로세스에 limit 4를 줘도 3코어분은 영영 못 씁니다 — 이 방향의 낭비가 걱정이라면 답은 limit 상향이 아니라 워커 수입니다(§7).

이 "보장"이 어느 층의 것인지는 분명히 해 둬야 합니다. quota 층이 보장하는 것은 **"쿼터 때문에 멈추는 일은 없습니다" 하나뿐**입니다. 스케줄링 층은 별개입니다 — 스레드는 period 중간에도 코어를 옮겨 다니고, 같은 코어의 이웃과는 가중치 비례로 시분할합니다. 그 가중치(requests)는 예약이 아닙니다. [03 §1]({{< relref "03-cpu-burst.md" >}})의 표가 이 구분의 커널 구현이고 진짜 예약은 cpuset뿐입니다:

| 메커니즘 | K8s 표면 | 성격 |
|---|---|---|
| `cpu.shares` / `cpu.weight` | requests | 경합 시 **비례 지분** — 하한처럼 동작하는 경향, 계약 아님 |
| CFS bandwidth (`cpu.max`) | limits | **하드 상한** — 위를 자를 뿐 아래를 약속하지 않음 |
| cpuset | CPU Manager static | **전용 코어** — 유일한 진짜 예약 ([02 BP ②]({{< relref "02-cpu-throttling.md" >}})) |

층위를 섞으면 관측 함정이 하나 생깁니다. **per-core 그래프에서 GIL 프로세스는 "코어마다 25%씩"처럼 보입니다.** 단일 실행 스레드가 관측 구간 동안 4개 코어를 옮겨 다닌 흔적인데 합치면 연속된 1코어 100%입니다. Brendan Gregg가 권하는 대로 `mpstat -P ALL`로 순간 단면을 뜨면 어느 순간이든 코어 하나만 뜨겁습니다. 하필 이 착시가 오해 ②("코어당 25% 배급")를 그래프로 확증해 주기 때문에 두 오해는 서로를 강화하며 오래 삽니다.

## 4. 그런데 실제 파이썬 컨테이너는 잘린다 — 네 갈래

§3의 결론에는 전제가 숨어 있습니다: **"CPU를 태우는 실행 단위가 하나뿐이라면."** 이 전제가 깨지는 경로가 네 개 있습니다. 현행 커널에서 보고되는 파이썬 스로틀 사고는 전부 이 넷 중 하나로 분류됩니다.

{{< cfstl variant="threads" caption="같은 1코어 limit인데 동시 실행이 2·4개면 quota가 2·4배 속도로 마른다. GIL은 이 그림을 기본값으로 막아준다 — 아래 네 갈래가 그 방어를 각각 다른 방식으로 뚫는다." >}}

### ① 워커 프로세스 다중화 — 공식이 노드를 본다

GIL의 천장은 **프로세스당**입니다. gunicorn 워커를 N개 띄우면 N코어분을 태울 수 있습니다. 문제는 그 N을 정하는 관습입니다. gunicorn 설계 문서의 `(2 × 코어) + 1` 공식은 물리 서버 전제인데, 코어 수를 `os.cpu_count()`로 얻으면 **파드 limit이 아니라 노드 코어 수**가 나옵니다. 64코어 노드의 2코어 파드에서 워커 129개가 뜹니다. 이들이 200ms 분의 quota를 놓고 컨텍스트 스위칭 경쟁을 벌입니다.

이건 이론이 아닙니다. 반복해서 실측된 사고 패턴입니다. LLM 게이트웨이 LiteLLM은 프로덕션 가이드에서 `$(nproc)` 기반 워커 산정을 권했다가 이 문제로 지적받고 **"파드당 uvicorn 워커 1개 + 수평 스케일"로 문서를 재작성**했습니다. FastAPI 공식 배포 문서도 같은 결론을 이미 명시해 뒀습니다 — "when running on Kubernetes you will probably not want to use workers and instead **run a single Uvicorn process per container**." 복제는 컨테이너 안(워커)이 아니라 클러스터(replicas)에서 하라는 뜻입니다.

### ② GIL을 놓는 네이티브 스레드풀 — 파이썬이 아닌 것들이 태운다

§1의 복선이 여기서 돌아옵니다. NumPy 자체는 함수 호출 중 단일 스레드입니다. 그런데 그 아래 BLAS 백엔드(OpenBLAS·MKL)는 **자기 스레드풀을 따로 굴리고 GIL을 놓은 채 돕니다.** 그 풀의 크기가 호스트 코어 수에서 나오는 게 문제입니다. OpenBLAS는 cgroup 제한을 인식하지 못해 4코어 제한 안에서도 16스레드를 만들고, 그 스레드들이 서로 경쟁합니다. 이 이슈([#1155](https://github.com/OpenMathLib/OpenBLAS/issues/1155))는 2017년부터 열려 있습니다.

크기는 HuggingFace text-embeddings-inference의 실측에서 드러납니다. 같은 `--cpus=2` 제한에서 스레드풀 환경변수만 limit에 맞췄을 때 처리량이 **1.82 → 11.03 req/s, 6배**입니다(제한 없는 기준선은 16.87입니다. 여기서 "limit을 걸면 9배 느려진다"고 읽으면 안 됩니다. CPU가 4→2로 준 몫을 빼고 남은 스레드풀 불일치의 몫이 6배입니다).

파이썬 고유의 복병도 하나 있습니다. FastAPI에서 `async def`가 아닌 `def` 경로 함수는 [anyio 스레드풀](https://anyio.readthedocs.io/en/stable/threads.html)에서 돕니다. 그 풀의 기본 토큰은 **40개**입니다. `os.cpu_count()`와 무관하게 500m 파드 안에서 GIL을 다투는 스레드 40개가 생길 수 있습니다 — "워커 수만 줄이면 된다"는 처방의 사각지대입니다.

### ③ 1코어 미만 limit — 슬라이스 입도가 무기가 된다

§2의 5ms 슬라이스가 여기서 문제로 변합니다. limit 100m은 period당 quota 10ms인데 커널이 런큐 하나에 주는 인출 단위가 5ms입니다. **온전한 슬라이스가 period당 2개뿐**이라는 뜻입니다. 96코어 노드에서 워커·스레드가 흩어지면 런큐 96개가 슬라이스 2개를 다투고 대다수는 빈손으로 돌아갑니다.

Numerator의 사고가 이 산수 그대로입니다. nginx 부하 테스트에서 limit은 **양쪽 다 100m으로 고정**인데 노드만 2vCPU → 96vCPU로 바꾸자 처리량이 1,221 → 455 rps로 떨어지고 p99가 195ms → 2.5s로 치솟았습니다. 바뀐 것은 limit이 아니라 `nproc`이 정한 nginx 워커 수입니다(원문은 "limit을 빼라"로 결론냈지만 데이터가 가리키는 범인은 워커 수 쪽입니다). `sched_cfs_bandwidth_slice_us`를 낮추는 우회가 없지는 않지만 노드 전역 튜너블이라 이웃 전체에 영향을 줍니다 — 조합 자체를 피하는 게 맞습니다: **1코어 미만 limit에는 실행 단위 1개.**

### ④ free-threading — 천장 자체가 사라진다

PEP 703의 free-threaded 빌드는 3.13에서 실험(`python3.13t`), PEP 779 승인을 거쳐 **3.14부터 공식 지원**입니다. GIL이 사라지면 이 문서의 §3이 통째로 무효가 됩니다 — 같은 파이썬 코드가 N코어를 동시에 태우며 quota를 100/N ms 만에 소진할 수 있습니다. 파이썬도 Go·JVM처럼 [02 §4]({{< relref "02-cpu-throttling.md" >}})의 병렬도 문제를 정면으로 맞습니다. 게다가 싱글스레드 오버헤드 5~10%(3.14 실측)는 **같은 quota에서 추가로 나가는 CPU-time**입니다. 그래서 free-threaded로 갈아타는 순간 CPU limit은 재산정 대상입니다. 지금까지 GIL이 공짜로 해주던 "동시 실행 1개" 상한을 스레드풀 설정이 대신 맡아야 합니다. 역설처럼 들리지만 **GIL 제거는 스로틀 문제를 "얻는" 일입니다.**

## 5. 잘리면 더 아프게 잘린다 — GIL 홀더 스로틀

§4가 **잘리게 되는 경로**였다면 이 절은 **잘린 순간의 비용**입니다 — 네 갈래 중 어느 길로 잘렸든 여기부터는 공통입니다. [02 §3]({{< relref "02-cpu-throttling.md" >}})의 "컨테이너 전체가 동시에 멈춘다"가 파이썬에서는 한 단계 더 나쁘게 성립합니다. §2에서 본 대로 throttle은 per-CPU 런큐 단위입니다 — 그런데 **GIL 홀더가 있는 런큐 하나만 잘려도 다른 코어에서 아직 quota가 남아 멀쩡히 돌 수 있는 스레드들까지 전부 GIL 대기로 멈춥니다.** 커널 회계로는 일부만 잘렸는데 애플리케이션은 전면 정지입니다. 잘린 시간은 [02 §3]({{< relref "02-cpu-throttling.md" >}})의 경로 그대로 APM 스팬 사이의 빈 구간이 되고 여기에 GIL 대기분이 더해집니다.

이건 OS 이론의 **lock-holder preemption**과 같은 구조입니다(락을 쥔 스레드가 멈추면 코어가 남아돌아도 대기자 전원이 멈춥니다). 커널의 최근 행보를 겹쳐 보면 대비가 선명합니다. "CFS tasks can end up **throttled while holding locks** that other, non-throttled tasks are blocking on"이라는 문제 인식 아래 커널은 스로틀 대상을 즉시 dequeue하지 않고 **유저스페이스 복귀 지점까지 미루는** 쪽으로 움직여 왔습니다(defer throttle to user entry). 커널 락을 쥔 채 얼어붙는 일을 막으려는 조치입니다. 그런데 GIL은 futex 기반 **유저스페이스 락이라 이 보호의 범위 밖입니다.** 커널이 자기 집의 우선순위 역전은 고쳐도 같은 형태의 파이썬 문제는 그대로 남습니다.

덤으로, 스로틀이 없어도 멀티코어의 GIL에는 §1의 잔존 convoy가 상존합니다 — I/O를 마친 스레드가 GIL을 되찾는 데 최소 한 번의 switch interval(5ms)을 기다립니다. 그래서 파이썬에서는 **cpuset을 좁히는 쪽(코어 수 축소)이 오히려 지연을 개선하는 반직관**이 실제로 관측됩니다.

## 6. 관측 — 파이썬 각도

스로틀 분율·절대량·표본 정제 같은 일반 지표는 [02 §5]({{< relref "02-cpu-throttling.md" >}}) 그대로입니다. 파이썬 컨테이너에서는 여기에 겹쳐 볼 것이 있습니다:

**① `py-spy --gil` — 단, 맹점을 알고 씁니다.** `py-spy top`의 %GIL 컬럼이 GIL 점유율을 실시간으로 보여줍니다. 파드에 붙이려면 `SYS_PTRACE` capability나 `kubectl debug --target`(ephemeral container + PID 네임스페이스 공유)이 필요합니다. `--gil`은 **GIL을 쥔 스레드만 샘플링하므로 GIL을 놓고 도는 네이티브 코드(§4 ②)는 안 보입니다.** 그러니 "스로틀 분율은 높은데 %GIL은 낮다"는 조합은 모순이 아니라 **경로 ②의 시그니처**입니다. (구형 도구 gil_load는 Python 2.7~3.7 시대 LD_PRELOAD 방식이라 권하지 않습니다.)

**② cgroup의 `cpu.pressure` — `full`이 스로틀의 가장 직접적인 신호입니다.** PSI의 `full`은 "cgroup의 모든 non-idle 태스크가 동시에 멈춘 시간"입니다. 이 정의는 cpu.max 스로틀과 그대로 겹칩니다 — 이 지표를 cgroup에 도입한 커널 커밋(e7fcd7622823, v5.13)이 스로틀을 명시적 사용처로 적어 뒀습니다. 한 가지 조심할 게 있습니다. **시스템 레벨**(`/proc/pressure/cpu`)의 full은 정의되지 않아 항상 0입니다 — "full은 무의미하다"는 통설은 그쪽 이야기고 **cgroup 레벨에서는 정반대**입니다. avg10이 10초 해상도를 주므로 [02 §5]({{< relref "02-cpu-throttling.md" >}})의 "rate 윈도우가 버스트를 뭉갠다" 문제의 부분 해법이기도 합니다. K8s 표면은 KubeletPSI가 1.34 beta → **1.36 GA**(cgroup v2 필요)입니다. Prometheus(`/metrics/cadvisor`)로는 some(`container_pressure_cpu_waiting_seconds_total`)만 나오고 **full은 Summary API 쪽**(`cpu.full`)에 있습니다. cpu.stat도 현행 커널은 5필드입니다 — `nr_periods nr_throttled throttled_usec nr_bursts burst_usec`(v2 기준, v1은 ns 단위).

**③ per-core 착시(§3)를 전제로 그래프를 읽습니다.** 코어별 그래프의 "여러 코어에 낮게 분산"은 GIL 직렬화와 모순되지 않습니다. 순간 단면(`mpstat -P ALL 1`)에서 코어 하나만 뜨거우면 단일 실행 스레드가 옮겨 다닌 것입니다.

## 7. 처방 — 파이썬 컨테이너의 리소스 계약

이 문서의 결론을 결정표로 접으면:

| 상황 | 처방 |
|---|---|
| 온라인 서비스 (FastAPI·Django·Flask) | **컨테이너당 워커 1개 + 수평 스케일**(FastAPI·LiteLLM 공식 가이드). limit은 정수 코어로([02 §4]({{< relref "02-cpu-throttling.md" >}})의 소수점 함정) |
| NumPy·PyTorch 등 수치 연산 포함 이미지 | `OMP_NUM_THREADS` `OPENBLAS_NUM_THREADS` `MKL_NUM_THREADS` `NUMEXPR_NUM_THREADS`를 **이미지·매니페스트 레벨에서 명시** — 파이썬 컨테이너의 단일 최고 레버리지 조치. 코드 레벨 제어는 threadpoolctl |
| FastAPI에 동기(`def`) 엔드포인트 존재 | anyio 스레드풀 기본 40토큰을 인지하고 `total_tokens` 조정 검토 |
| limit < 1코어 | 실행 단위(워커·스레드)를 1로 — 슬라이스 입도(§4 ③) 때문에 병렬화가 역효과 |
| 워커 수를 정말 계산해야 한다면 | 아래 Downward API 패턴 + **메모리 축으로도 캡** — 워커는 fork라 CPU 스로틀(회복 가능)과 달리 OOMKill(회복 불가)로 죽는다 |
| free-threaded(3.13t/3.14+)로 전환 | limit 재산정 + 스레드 수 상한을 명시적으로 — GIL이 해주던 "동시 실행 1개"가 사라진다(§4 ④) |

워커 수 계산이 필요할 때의 배선 — `os.cpu_count()` 대신 limit을 컨테이너에 직접 넘깁니다. Downward API의 divisor 기본값이 1(코어 단위, **올림**)이라 `600m`이 `1`로 뭉개지므로 `divisor: 1m`이 필수입니다:

```yaml
env:
  - name: CPU_LIMIT_MILLI
    valueFrom:
      resourceFieldRef:
        resource: limits.cpu
        divisor: 1m        # 없으면 ceil(0.6) = 1 — 02 §4의 그 함정
```

```bash
# entrypoint.sh — 워커는 CPU와 메모리 중 낮은 쪽으로 캡 (Heroku WEB_CONCURRENCY 패턴)
CPU_WORKERS=$(( CPU_LIMIT_MILLI / 1000 )); [ "$CPU_WORKERS" -lt 1 ] && CPU_WORKERS=1
MEM_WORKERS=$(( MEM_LIMIT_MB / WORKER_RSS_MB ))
WORKERS=$(( CPU_WORKERS < MEM_WORKERS ? CPU_WORKERS : MEM_WORKERS ))
exec gunicorn -w "$WORKERS" app:app
```

`PYTHON_CPU_COUNT`(3.13+, `-X cpu_count`)로 `os.cpu_count()` 계열 전체를 오버라이드할 수도 있습니다. 이 값이 어디서 왔는지는 알아 둬야 합니다 — CPython은 cgroup 자동 감지를 **의도적으로 채택하지 않았습니다.** 2019년의 요청(#80235)은 2023년에 닫혔습니다. 구현된 것은 자동 감지가 아니라 수동 오버라이드 통로입니다(JDK가 `-XX:ActiveProcessorCount`로 간 것과 같은 판단). **Go 1.25는 cgroup quota를 직접 읽어 GOMAXPROCS를 잡고 limit이 바뀌면 주기적으로 재조정까지 합니다.** 이 차이가 실제 함정이 되는 곳이 [01 In-Place Pod Resize]({{< relref "01-inplace-pod-resize.md" >}})입니다 — resize가 `cpu.max`를 무중단으로 바꾸는 순간 Go는 따라가지만 기동 시 1회 읽는 `PYTHON_CPU_COUNT`·워커 수·`OMP_NUM_THREADS`는 전부 stale이 됩니다. **in-place resize를 쓰는 클러스터에서 파이썬 컨테이너는 CPU 변경 시 재시작(RestartContainer resize policy)이 오히려 정합적입니다.**

## 8. 체크리스트

- [ ] **스로틀 분율이 실제로 0이 아닌가** — 아니면 이 문서는 남의 얘기입니다([02 §7]({{< relref "02-cpu-throttling.md" >}}) 먼저)
- [ ] **커널 시대를 확인한다** — 5.4 미만(또는 백포트 없는 stable)이면 §2의 만료 버그부터 의심, 이상이면 §4의 네 갈래
- [ ] **워커 수의 출처를 찾는다** — `os.cpu_count()`·`nproc`·`multiprocessing.cpu_count()` 기반이면 경로 ①
- [ ] **%GIL과 스로틀 분율을 겹쳐 본다** — 스로틀↑ + %GIL↓이면 경로 ②, BLAS/OpenMP 환경변수 확인
- [ ] **limit이 1코어 미만인데 스레드가 여럿인가** — 경로 ③, 실행 단위를 1로
- [ ] **`cpu.pressure`의 full을 본다**(cgroup 레벨, K8s 1.36+ PSI) — nr_throttled보다 "얼마나 아팠나"에 가깝습니다
- [ ] **limit을 정수 코어로** — 소수점은 Downward API 올림과 커널 quota가 어긋납니다
- [ ] **in-place resize를 쓴다면** 파이썬 컨테이너의 CPU resize policy는 재시작으로
- [ ] **free-threaded 전환 계획이 있다면** limit 재산정과 스레드 상한 명시를 전환 항목에 포함

## 이 문서에서 가져갈 것

- GIL은 **뮤텍스이지 최적화가 아닙니다.** 코어 고정도, 코어 활용도 GIL이 해주지 않습니다 — 멀티코어에서는 오히려 convoy로 느려집니다.
- quota는 **전역 풀 + 수요 기반 5ms 슬라이스 인출**입니다. "코어당 25%씩"은 구조가 아니라 동시 실행 4개가 만든 결과이고, throttle의 단위도 cgroup이 아닌 per-CPU 런큐입니다.
- 그래서 **limit ≥ 1코어인 순수 파이썬 프로세스는 스로틀될 수 없습니다** — 소진이 충전을 못 이깁니다. 이 보장은 quota 층의 것이고 코어 이동·이웃 경쟁은 별개 층입니다.
- 실제로 잘린다면 범인은 넷 중 하나입니다 — **워커 다중화 · GIL 놓는 네이티브 스레드풀 · 1코어 미만 limit의 슬라이스 입도 · free-threading.** 전부 "실행 단위 수 ≠ limit"의 변주입니다.
- **GIL 홀더가 잘리면 프로세스 전체가 멈춥니다.** 커널은 커널 락의 같은 문제를 고치는 중이지만 유저스페이스 락인 GIL은 보호 밖입니다.
- 파이썬의 처방은 전부 **수동**입니다 — 스레드풀 env 고정이 최고 레버리지, 워커는 컨테이너당 1개 + 수평 스케일, 계산이 필요하면 Downward API `divisor: 1m`. Go 1.25처럼 런타임이 따라와 주지 않으므로 in-place resize와는 재시작 정책으로 화해합니다.

## 참고 자료

- [Linux / CFS Bandwidth Control](https://docs.kernel.org/scheduler/sched-bwc.html) — 전역 풀·슬라이스·slack 반납·burst의 1차 소스 · 동작 서술의 근거 코드: `kernel/sched/fair.c`(`sched_cfs_bandwidth_slice` 5ms, `min_cfs_rq_runtime` 1ms, `throttle_cfs_rq`, `distribute_cfs_runtime`)
- [Python / glossary — global interpreter lock](https://docs.python.org/3/glossary.html#term-global-interpreter-lock) · [sys.setswitchinterval](https://docs.python.org/3/library/sys.html#sys.setswitchinterval) — GIL 정의와 5ms switch interval
- [David Beazley — Revisiting thread priorities and the new GIL](http://dabeaz.blogspot.com/2010/02/revisiting-thread-priorities-and-new.html) · [bpo-7946 Convoy effect](https://bugs.python.org/issue7946) — §1의 실측 수치
- [Indeed — Unthrottled 2부작](https://engineering.indeedblog.com/blog/2019/12/unthrottled-fixing-cpu-limits-in-the-cloud/) · [LWN — The bandwidth controller and slice expiration](https://lwn.net/Articles/792268/) — §2 "두 시대"의 전말(51f2176 → 512ac999 → de53fd7)
- [LWN — Deferring CFS throttling to user entry](https://lwn.net/Articles/1021903/) — §5의 커널 쪽 lock-holder preemption 대응
- [PEP 703](https://peps.python.org/pep-0703/) · [PEP 779](https://peps.python.org/pep-0779/) · [What's New in 3.14](https://docs.python.org/3/whatsnew/3.14.html) — free-threading 로드맵과 오버헤드 수치
- [CPython #109595](https://github.com/python/cpython/issues/109595) — `PYTHON_CPU_COUNT`가 "자동 감지의 의도적 포기"인 이유(JDK-8281571 인용) · [#80235](https://github.com/python/cpython/issues/80235) — 2019년 요청이 2023년 수동 오버라이드로 닫힌 경위
- [Go 1.25 — container-aware GOMAXPROCS](https://go.dev/blog/container-aware-gomaxprocs) — 대비군: quota 자동 반영 + 주기 재조정
- 사례: [Numerator — Requests are all you need](https://www.numeratorengineering.com/requests-are-all-you-need-cpu-limits-and-throttling-in-kubernetes/)(§4 ③으로 재해석) · [HuggingFace TEI #170](https://github.com/huggingface/text-embeddings-inference/issues/170)(§4 ②) · [LiteLLM prod 가이드](https://docs.litellm.ai/docs/proxy/prod)(§4 ①) · [OpenBLAS #1155](https://github.com/OpenMathLib/OpenBLAS/issues/1155)
- [FastAPI — Docker 배포](https://fastapi.tiangolo.com/deployment/docker/) · [gunicorn design](https://gunicorn.org/design/) — 워커 산정의 공식 입장 · [anyio — threads](https://anyio.readthedocs.io/en/stable/threads.html) — §4 ②의 기본 40토큰 리미터
- [kernel PSI](https://docs.kernel.org/accounting/psi.html) · [commit e7fcd7622823](https://github.com/torvalds/linux/commit/e7fcd762282332f765af2035a9568fb126fa3c01) — cgroup 레벨 `full`의 의미 · [K8s PSI metrics](https://kubernetes.io/docs/reference/instrumentation/understand-psi-metrics/) · [py-spy](https://github.com/benfred/py-spy)
