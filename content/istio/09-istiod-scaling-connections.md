---
title: "istiod 스케일링과 xDS 커넥션 재분배"
weight: 9
---

# 09 · istiod 스케일링 — 커넥션은 왜 새 파드로 옮겨가지 않는가

{{< callout type="info" >}}
**한눈에**
- istiod 메모리는 커넥션 **수**가 아니라 **커넥션 수 × 클러스터 config 크기**에 비례한다. 커넥션당 단가가 클러스터 규모를 따라 변한다.
- xDS는 **장수 gRPC 스트림**이라 스케일아웃해도 기존 커넥션이 새 파드로 옮겨가지 않는다. **Istio에 능동적 재분배 기능은 없다.**
- 공식이 가진 재분배 수단은 `keepaliveMaxServerConnectionAge` 강제 종료 하나뿐. Google Cloud 공식 문서도 이 불균형을 인정하고 **레플리카 다중화 + 사전 스케일링**만 권한다.
- 주기를 절반으로 줄이면 재연결 레이트가 정확히 2배가 된다(지터는 ±10%라 창을 넓혀줄 뿐이다). 상쇄하려면 **재연결 1건의 단가** — 곧 커넥션당 config 크기 — 를 깎아야 한다.
- `pilot_xds`(연결 수) 기반 오토스케일링은 **공식 권장이 아니다.** 공식 차트 HPA의 기본 지표는 CPU 80% 하나뿐이다.
- 실측(§7): **커넥션 분포가 가장 험한 순간과 CPU가 가장 험한 순간은 다르다.** CoV는 파드가 죽을 때, CPU·push 지연은 커넥션 총량이 늘 때 튄다. 재분배 지표만으로 CPU 부하를 추정하면 엉뚱한 손잡이를 잡는다.
- **`GOMAXPROCS`는 `limits.cpu`가 정한다**(§8). 차트가 Downward API로 주입하고 kubelet이 `math.Ceil`로 올림하므로, **소수점 CPU limit은 quota와 GOMAXPROCS가 항상 어긋난다.** 정수 코어로 걸 것.
- **명목 quota가 다 쓰이지도 않는다**(§7). CFS 슬라이스 좌초로 **600m가 실효 210m처럼 동작했다.** GOMAXPROCS=1이어도 OS 스레드는 17개라 좌초 표면적은 그대로다 — 병렬성만 잃는 최악의 조합.
{{< /callout >}}

> **그때 무슨 일이 있었나.** 대규모 이벤트 중 istiod가 20분 사이에 8대 재시작됐다. 커넥션 수(`pilot_xds`) 기반 KEDA 스케일링이 이미 걸려 있었고 24대 → 38대로 스케일아웃도 정상 동작했는데도 그랬다. 원인은 두 겹이었다 — **커넥션 한 개의 무게가 클러스터 규모를 따라 변했고**(0.66 → 1.95 MB/conn), **스케일아웃해도 커넥션이 재분배되지 않아** 기존 파드가 246~294 conn을 혼자 떠안았다. 이 문서는 그 두 성질의 근거를 공식 문서·소스코드 수준까지 내려가 정리하고, 손잡이별 트레이드오프를 표로 남긴다.

> 관련 문서: [02 컨트롤 플레인 해부: istiod]({{< relref "02-istiod-control-plane.md" >}}) — push가 CPU를 먹는 메커니즘과 `Sidecar` 스코핑의 기본 · [06 메시가 공짜로 주는 관측성]({{< relref "06-observability-points.md" >}})

> 이 사건을 이야기 흐름으로 읽으려면: [istiod 스케일링, 커넥션 수만 세면 될 줄 알았다](https://makgol.com/blog/istiod-scaling-metrics) — 1차 스케일링을 걸고 2차 이벤트에서 깨지기까지의 서사와 실측 차트. 이 문서는 그 밑에 깔린 근거와 손잡이별 트레이드오프를 레퍼런스로 편다.

## 1. 커넥션 하나의 무게는 고정이 아니다

istiod는 커넥션마다 "그 proxy에게 줄 클러스터 전체의 뷰"를 계산해 들고 있다. 그래서 부하는 커넥션 수만으로 결정되지 않는다.

> **istiod 메모리 ∝ 커넥션 수 × 클러스터 config 크기(endpoints)**

실측으로 확인한 값이다. 같은 "커넥션 100개"인데 이벤트 전후로 단가가 3배 차이 났다.

| 시점 | 총 커넥션 | 클러스터 endpoints | 커넥션당 비용 |
|---|---|---|---|
| 평시 | ~1,000 | ~1,700 | **0.66 MB/conn** |
| 이벤트 피크 | ~3,600 | ~5,400 | **1.95 MB/conn** |

일자별 회귀로 뽑은 모델과 검증:

```text
istiod 파드 메모리 ≈ 240MB(base) + 400B × (파드당 커넥션 수 × 클러스터 총 endpoints)
```

- 피크 당일 파드별 단면 상관계수 **r = 0.962**
- 한 달치 후보 메트릭 25개 상관 스윕 결과, istiod 메모리와 같이 움직인 외부 지표는 **클러스터 총 endpoints 수**뿐 (Spearman ρ = 0.92)
- 경과 시간과는 무관 ⇒ 누수(leak)가 아니라 **순간의 규모** 문제

공식 문서도 같은 이야기를 한다. `Performance and Scalability`는 istiod 리소스 사용량이 "배포 변경률·설정 변경률·연결된 proxy 수"에 비례한다고 서술한다.

**이 성질이 커넥션 수 트리거의 사각지대다.** `sum(pilot_xds)/replicas`를 임계로 잡는 순간 "모든 커넥션의 비용은 일정하다"는 전제를 깔게 되는데, 그 전제가 깨지는 시점이 하필 규모가 가장 큰 날이다.

## 2. xDS 커넥션은 재분배되지 않는다

각 sidecar는 istiod 파드 하나와 **장수 gRPC 스트림**(ADS)을 유지한다. 한번 맺어지면 끊길 때까지 그 파드에 붙어 있고, Kubernetes Service의 로드밸런싱은 **새 커넥션에만** 적용된다.

{{< flow caption="스케일아웃으로 istiod-c가 떠도 기존 커넥션은 옮겨가지 않는다 — 새 파드는 '새로 맺어지는 커넥션'만 받으므로 한동안 빈손이다" >}}
{
  "nodes": [
    { "id": "A", "col": 0, "row": 0, "label": "istiod-a", "sub": "294 conn · 과부하", "kind": "proc" },
    { "id": "B", "col": 0, "row": 1, "label": "istiod-b", "sub": "246 conn", "kind": "proc" },
    { "id": "C", "col": 0, "row": 2, "label": "istiod-c (신규)", "sub": "3 conn · idle", "kind": "query" },
    { "id": "S1", "col": 1, "row": 0, "label": "Envoy sidecar", "sub": "기존 커넥션 다수", "kind": "sink" },
    { "id": "S2", "col": 1, "row": 1, "label": "Envoy sidecar", "sub": "기존 커넥션", "kind": "sink" },
    { "id": "S3", "col": 1, "row": 2, "label": "Envoy sidecar", "sub": "새로 맺은 것만", "kind": "sink" }
  ],
  "edges": [
    { "from": "A", "to": "S1", "label": "xDS push", "rate": 380, "speed": "fast" },
    { "from": "B", "to": "S2", "rate": 650 },
    { "from": "C", "to": "S3", "rate": 1400, "speed": "slow" }
  ]
}
{{< /flow >}}

⇒ 스케일아웃은 desired replicas까지만 답하고, **커넥션이 어느 파드로 가는가는 트리거의 관할 밖**이다.

우리 클러스터만의 사정이 아니라 문서화된 성질이다. Google Cloud 서비스 메시 트러블슈팅 문서의 원문:

> Large changes in cluster size might cause a **temporarily unbalanced load, due to the long-lived connections**.

같은 문서가 내놓는 대응은 두 개뿐이다 — **istiod 레플리카를 여러 개 유지**할 것, 그리고 대규모 확장이 예상되면 **사전 스케일링(pre-scaling)**. 커넥션을 새 파드로 옮겨주는 기능이 따로 있는 게 아니다. 부작용으로 Envoy에 `gRPC config stream closed: 13`이 뜬다는 것까지 같은 문서에 적혀 있다.

**Istio 1.20+ 릴리스노트에서도 "커넥션 밸런싱/재분배"를 다루는 항목은 발견되지 않았다.** `keepaliveMaxServerConnectionAge` 강제 종료가 사실상 유일한 공식 메커니즘이다.

### 실측 관찰

파드별 `pilot_xds`를 1분 해상도로 3시간 그려보면 공백이 그대로 보인다.

- 스케일아웃으로 새 파드가 떠도 커넥션은 **바닥(2~6 conn)**에서 시작
- 파드 교체가 일어나자 갈 곳 잃은 커넥션이 살아남은 파드로 쏟아져 한 파드가 **154 conn**(그 시점 평균의 2배)까지 상승
- 바닥에 붙은 파드가 평균 밴드까지 올라오는 데 **약 30분**, 전체가 고르게 퍼지는 데 **약 40분** — keepalive 30분 주기와 맞는 시간 스케일
- 이벤트 당일은 더 심해서 쏠림 해소에 **27~42분**, 그 사이 기존 파드는 **294 conn**

교체 구간에 뜬 파드 중 일부는 커넥션을 받아보지도 못하고 3분 만에 사라지기도 했는데, 업스트림에 같은 모양의 리포트가 있다 — istiod CPU가 push 중에 스파이크로 튀면 HPA가 파드를 과하게 늘리고(사례에선 ~5대 → 30대+), **새로 뜬 파드는 push에 참여도 못 한 채 몇 분 뒤 스케일다운되는 스레싱**([istio/istio#42634](https://github.com/istio/istio/issues/42634)). 이 이슈는 helm 차트에 HPA `behavior` 지원을 추가하는 PR #44425로 닫혔다.

## 3. 공식이 말하는 스케일링 지표

**`pilot_xds` 기반 오토스케일링은 istio.io가 권장한 적이 없다.** 이건 커뮤니티 관행(Prometheus adapter로 커스텀 메트릭화 → HPA/KEDA)이지 공식 문서에 실린 방식이 아니다.

공식 차트(`manifests/charts/istio-control/istio-discovery/values.yaml`)의 HPA 기본값:

| 키 | 기본값 |
|---|---|
| `autoscaleEnabled` | `true` |
| `autoscaleMin` | `1` (Best Practices는 프로덕션에서 **2 이상** 권고 — 단일 replica는 admission webhook 단일장애점) |
| `autoscaleMax` | `5` |
| `cpu.targetAverageUtilization` | `80` |

즉 **공식 지표는 CPU 사용률 하나뿐**이다. 커스텀 메트릭 HPA는 사용자가 별도 구성해야 한다.

메트릭의 1차 출처는 문서가 아니라 소스(`pilot/pkg/xds/monitoring.go`)다. 실제 정의된 것들:

| 메트릭 | Help 문자열 (원문) |
|---|---|
| `pilot_xds` (label `version`) | Number of endpoints connected to this pilot using XDS |
| `pilot_proxy_convergence_time` | 설정 변경 → proxy가 필요한 설정을 모두 수신하기까지의 지연 |
| `pilot_proxy_queue_time` | proxy가 push 큐에서 대기한 시간 |
| `pilot_xds_push_time` (label `type`) | lds/rds/cds/eds push 소요 시간 |
| `pilot_xds_config_size_bytes` | 클라이언트에 push된 설정 크기 분포 |
| `pilot_debounce_time` | 디바운스 시작 → 병합된 push가 큐에 들어가기까지 |
| `pilot_pushcontext_init_seconds` | push context 초기화 총 소요 시간 |
| `pilot_push_triggers` (label `type`) | push가 유발된 횟수, 사유별 |
| `pilot_inbound_updates` (label `type`) | pilot이 수신한 업데이트 총수 |
| `pilot_services` | pilot이 아는 서비스 총수 |

{{< callout type="important" >}}
**이름에 속기 쉬운 것 둘**

- `pilot_xds_pushes`는 성공 카운터가 **아니라 에러 카운터**다. Help 문자열이 "Pilot build and send **errors** for lds, rds, cds and eds"이고 label도 `cds_senderr`/`eds_senderr`/`lds_senderr`/`rds_senderr`다.
- `pilot_xds_write_timeout`, `pilot_total_xds_rejects`는 **현재 master 소스에 존재하지 않는다.** 3rd-party 블로그에만 나오는 이름이니 알럿에 걸면 조용히 아무것도 안 잡는다.
{{< /callout >}}

트리거로 쓰기엔 부적합하지만 알럿으로는 쓸 만한 것들:

```promql
# 핫 파드 커넥션 쏠림 — 재시작의 직접 선행지표
max by (pod) (pilot_xds) > 200

# istiod 메모리 limit 근접
container_memory_working_set_bytes{container="discovery"} / limit > 0.85
```

## 4. keepaliveMaxServerConnectionAge — 유일한 재분배 손잡이

### CLI 기본값과 차트 기본값이 다르다

| 경로 | 기본값 |
|---|---|
| `pilot-discovery --keepaliveMaxServerConnectionAge` | `2562047h47m16.854775807s` — Go `time.Duration`의 MaxInt64, 사실상 **무제한(off)** |
| Helm 차트 `values.yaml` | **`30m`** |

즉 helm 경로로 배포된 istiod가 30분마다 커넥션을 끊는 건 **차트가 주입한 값** 때문이지 바이너리 기본 동작이 아니다. `pkg/keepalive/options.go`의 `DefaultOption()`은 `MaxServerConnectionAge: Infinity`를 반환한다.

### 지터는 이미 들어가 있다

같은 파일의 주석:

> Maximum duration a connection may persist before the server terminates it with a GoAway message. **A randomized offset is incorporated to prevent synchronized connection terminations.**

이 지터는 istio가 구현한 게 아니라 하위 grpc-go가 `MaxConnectionAge`에 붙이는 **±10%**이고, istio는 수치를 재정의하지 않는다. grpc-go 원문:

> A random jitter of **+/-10%** will be added to MaxConnectionAge to spread out connection storms.

### 주기를 줄이면 무엇이 늘어나는가

지터가 있으므로 늘어나는 건 순간적인 종료 폭발이 아니다. **정상상태 재연결 레이트 그 자체**다.

```text
재연결 레이트 ≈ 총 커넥션 수 / maxConnectionAge
지터가 흩어주는 창 = maxConnectionAge × ±10%
```

커넥션 3,600개 기준:

| 설정 | 재연결 레이트 | 지터 창 |
|---|---|---|
| 30m | ~2 conn/s | ±3분 |
| 15m | ~4 conn/s | ±1.5분 |

⇒ **정확히 2배.** 결정론적이라 예측 가능하고, 되돌리려면 빈도를 낮추거나 재연결 1건의 단가를 낮춰야 한다.

## 5. 재연결 1건의 단가를 낮추는 손잡이

여기서 §1의 계수가 다시 걸린다. 공식 `configuration-scoping` 문서의 문장:

> Each configuration has a cost (**in CPU and memory, primarily**) to maintain and keep up to date. At large scales, it is critical to limit the configuration scope to avoid excessive resource consumption.

**커넥션당 config 크기는 메모리 단가이기만 한 게 아니라 재연결 CPU 단가이기도 하다.** 재연결 빈도를 2배로 올렸으면 상쇄 수단은 단가 쪽에 있다.

### 설정 스코핑 (ROI 1순위)

| 수단 | 레이어 | 효과 |
|---|---|---|
| `Sidecar` 의 `egress.hosts` | 워크로드별 | 그 프록시가 import할 설정을 명시적으로 제한 |
| `exportTo` | 서비스별 | 서비스 소유자가 노출 네임스페이스를 제어 |
| `discoverySelectors` | 컨트롤플레인 | 매칭 안 되는 네임스페이스를 **istiod가 아예 무시** — 위 둘보다 상위 필터 |

공식 문서가 배제 1순위로 지목하는 건 **헤드리스 서비스(HTTP 타입 제외)** 다. 인스턴스 수에 비례해 설정이 커져서 특히 비싸다. 다만 스코프 제한은 트래픽 강제(enforcement)가 아니라서, 스코프 밖 목적지로의 요청은 unmatched traffic으로 처리된다는 점은 알고 써야 한다.

### push·요청 레이트 제어

소스(`pilot/pkg/xds/discovery.go`)에 thundering herd 방지 장치가 명시적으로 있다.

```go
RequestRateLimit *rate.Limiter
// rate.NewLimiter(rate.Limit(features.RequestLimit), 1)
//
// RequestRateLimit limits the number of new XDS requests allowed.
// This helps prevent thundering herd of incoming requests.
```

`WaitForRequestLimit`의 주석은 거부의 의도까지 밝힌다 — *"Client will connect to another instance in best case, or retry with backoff."* 즉 **거부가 곧 다른 인스턴스로의 분산**으로 이어지도록 설계돼 있다.

| 환경변수 | 기본값 | 역할 |
|---|---|---|
| `PILOT_MAX_REQUESTS_PER_SECOND` | 1.21+ `min(15+5*procs, 100)` 자동 스케일 (이전 고정 25.0) | 위 리미터의 rate |
| `PILOT_PUSH_THROTTLE` | 1.21+ 동일 공식 자동 스케일 (이전 고정 100) | 동시 push 허용 개수 |
| `PILOT_DEBOUNCE_AFTER` | `100ms` | 이벤트를 묶기 위한 최소 지연 |
| `PILOT_DEBOUNCE_MAX` | `10s` | 디바운스 최대 대기, 도달 시 강제 push |
| `PILOT_ENABLE_EDS_DEBOUNCE` | `true` | EDS도 디바운스 대상에 포함 |

{{< callout type="info" >}}
**리미터가 병목인지부터 확인할 것.** 커넥션 3,600개 / 15분 = ~4 conn/s인데, `PILOT_MAX_REQUESTS_PER_SECOND`의 자동 기본값은 2 vCPU 기준으로도 25/s다. 이 규모에서 리미터가 재연결을 억제하고 있을 가능성은 낮다 — 즉 관측되는 CPU는 **억제되지 않은 실제 작업량**이다. 리미터를 만지기 전에 `pilot_xds_config_size_bytes`·`pilot_xds_push_time`으로 단가부터 보는 게 순서다.
{{< /callout >}}

### 그 밖의 수단

| 수단 | 상태 | 트레이드오프 |
|---|---|---|
| **Delta xDS** (`ISTIO_DELTA_XDS`) | **1.22부터 기본 `true`** | 변경분만 전송해 push 비용↓. 재연결 절감폭은 실측 필요 — 아래 단서 참조 |
| **HPA `behavior`** stabilization window | 차트 지원됨 (#42634 → PR #44425) | 파드 churn 자체를 억제. scaleDown이 느려짐. KEDA는 `advanced.horizontalPodAutoscalerConfig.behavior`로 전달 |
| **사전 스케일링** | Google 공식 권고 | 이벤트 일정을 미리 아는 경우에만. 평시 낭비와 맞바꿈 |
| **ambient / ztunnel** | 구조적 해법 | 커넥션이 **파드당 → 노드당 1개**, ztunnel용 xDS는 L4 전용이라 훨씬 작다. 마이그레이션 비용, L7 기능엔 waypoint 필요 |
| **리비전 기반 샤딩** | 가능하나 목적 밖 | `istio.io/rev`로 프록시를 리비전별 istiod에 고정. 업그레이드/카나리아용 설계라 **동적 재분배가 아니라 정적 분할** |
| **클라이언트측 `idle_timeout`** (EnvoyFilter) | 커뮤니티 기법 | 서버 강제 종료 대신 프록시 아웃바운드에 idle timeout을 주입해 재연결 유도. 근거 설명이 없어 **추정 수준** |

{{< callout type="important" >}}
**Delta xDS와 재연결 — 확실하지 않은 부분**

xDS delta 프로토콜에는 재연결용 `initial_resource_versions` 필드가 있어서, 클라이언트가 이미 가진 리소스 버전을 알려주면 서버가 차분만 보낼 수 있다. **원리상 재연결 비용 절감이 설계 목표**다. 다만 Istio 팀 스스로 "완벽한 최소 diff는 아직 아니다"라고 밝힌 상태라 구현 완성도가 별개 변수다.

⇒ 켜기 전후로 `pilot_xds_config_size_bytes`·`pilot_xds_push_time`을 비교해 **실측으로 판단할 것.** 문서만 보고 절감을 가정하지 말 것.
{{< /callout >}}

## 6. 사례 — 확인된 것과 미확인

조사에서 "istiod를 스케일아웃했는데 재분배가 안 돼 OOM"을 정확히 다룬 **named 회사의 공개 포스트모템은 찾지 못했다.** 조각별 근거는 이렇다.

| 출처 | 확인된 내용 |
|---|---|
| Google Cloud (Anthos/CSM) 트러블슈팅 문서 | 장수 커넥션발 부하 불균형을 **공식 인정**. 30분 max-age + 레플리카 다중화 + 사전 스케일링 권고 |
| istio/istio#42634 | istiod CPU 스파이크 → HPA 스레싱(~5대 → 30대+), 새 파드가 push 참여 못 함. PR #44425로 차트에 `behavior` 추가 |
| istio/istio#57809 | 2,500노드에서 Gateway 롤링 재시작 시 xDS 수신 지연으로 Ready 실패. 재분배 문제는 아니지만 대규모 istiod 지연이 장애로 이어진 사례 |
| Charles Xu (전 Google Cloud Istio 팀 / 전 Cruise / 현 Snowflake) | "long-lived gRPC connections that persist indefinitely, creating uneven load distribution across istiod replicas over time" — 같은 문제를 서술. **실제 인시던트인지 일반론인지 글에서 구분되지 않음** |
| grpc-go `keepalive/keepalive.go` | `MaxConnectionAge` ±10% 지터 (1차 출처, 확정) |

**미확인으로 남긴 것:**

- istiod **자체**(데이터플레인 proxy 말고 컨트롤플레인)의 graceful shutdown 메커니즘·플래그 — 공식 문서 미발견
- "재연결 시 istiod가 전체 스냅샷을 재계산하는가"에 대한 공식 서술 — 미발견. 소스상으로는 push context가 설정 변경 시 한 번 빌드돼 캐싱되고 신규 커넥션은 그걸 필터링해 쓰는 구조라, 비용의 주원인은 재계산이 아니라 **다수 스트림의 초기 전체 push + gRPC/TLS 핸드셰이크**로 **추론**된다
- Uber/Pinterest/Lyft 등의 istiod 커넥션 재분배 공개 사례 — 미발견. "Netflix가 Istio로 하루 1000억 요청" 류 서술은 저품질 매체에만 나와 **인용 보류**

## 7. 실측 — 2026-07-25, keepalive 15m 적용 이후

{{< callout type="important" >}}
**초판 결론을 뒤집었다.** 커넥션 데이터만 봤을 때는 "09:40 파드 대량 소멸이 진짜 스파이크"라고 적었으나, CPU·스로틀·convergence·push_time 네 지표를 붙여보니 **스케일아웃 구간이 네 축 전부에서 더 나빴다.** 아래는 정정된 내용이다. 커넥션 분포만으로 CPU 부하를 추정하면 안 된다는 게 이 절의 첫 교훈이다.
{{< /callout >}}

데이터: Grafana Explore 내보내기, 08:29~11:44(195분), **15초 해상도**, 파드 컬럼 66개, 활성 24~34대. 파일 내 파드가 전부 동일 ReplicaSet(`646bd458b8`)이다.

### 09:40~09:47 — 파드 20대가 90초 만에 사라졌다

| 시각 | 등장 | 소멸 | 소멸 파드가 들고 있던 커넥션 |
|---|---|---|---|
| 09:40 | 0 | **10** | 365 |
| 09:41 | 2 | **10** | 615 |
| 09:42 | 14 | 4 | 316 |
| 09:46 | 1 | 6 | 229 |
| | | | **합계 1,525 conn 강제 이탈** |

- 09:41:00 **활성 24 → 5대**, 총 커넥션 862 → 169
- 09:41:30 12대가 864를 나눠 받으며 `f4cgm` 한 대가 138 conn
- 09:47~09:56 `7jp9c` 한 대가 **156 conn 독식**, 같은 시각 최소 파드는 **1 conn**
- CoV **146.5%가 약 15분 고착**, 완전 재수렴까지 **19.2분**

**같은 ReplicaSet 안에서** 20대가 동시에 죽었다. 재배포였다면 새 RS 해시가 떴을 테니, 노드 드레인·축출·스팟 회수 같은 **노드 레벨 이벤트**가 유력하다(미확인 — 노드 이벤트 대조 필요).

### 재연결 레이트 — 정상 순환과 교체발 강제 재접속의 분리

15분 버킷으로 나눠, 파드별 커넥션 증가분의 합(정상 순환)과 파드 소멸로 통째로 이탈한 양(강제 재접속)을 따로 셌다.

| 구간 | 활성 | 총 conn | 정상 재연결 | 교체발 강제 | CoV |
|---|---|---|---|---|---|
| 평시 08:29~09:29 | 24 | ~800 | 0.40~0.48/s | 0 | 15~19% |
| **09:29~09:44** | 24 | 855 | 0.68/s | **1.80/s** | **111%** |
| 피크 10:59~11:44 | 34 | ~2,900 | 1.02~1.06/s | 0 | 10~13% |
| (6월) 피크 16:00~16:45 | 30 | ~2,950 | 0.65~0.74/s | 0 | 9~23% |
| **(6월) 16:45~17:00** | 25 | 2,020 | 2.33/s | **2.22/s** | **57%** |

읽어낼 것 셋:

1. **keepalive 15m은 의도대로 작동한다.** 거의 같은 커넥션 규모(2,900 vs 2,950)에서 정상 재연결이 0.7/s → 1.0/s로 **약 1.5~2배**. 주기를 절반으로 줄인 효과와 맞는다.
2. **스케일아웃 수렴이 빨라졌다.** 오늘 10:29~11:00에 24 → 34대로 늘리며 CoV 25.9% → 9.8%까지 **17.5분**. 6월엔 같은 일에 **36.5분**이 걸렸다.
3. **커넥션 재분배 관점에서는 파드 교체가 가장 격했다.** 09:29~09:44 버킷의 합계는 이론치의 2.6배, 6월 16:45~17:00 버킷은 4.1배.

{{< callout type="info" >}}
**측정 방법의 한계 — 정상 재연결 수치는 하한이다.** 파드별 증가분의 합으로 셌기 때문에, 15초 스텝 안에서 끊기고 다시 붙은 것이 상쇄되면 잡히지 않는다. 실측 1.0/s는 이론치(2,900/900s = 3.2/s)의 0.3배인데 이 격차의 상당 부분은 측정 방식 탓이다. **절대값이 아니라 6월 대비 상대 비교로만 읽을 것.**
{{< /callout >}}

### CPU·스로틀을 붙이니 결론이 뒤집혔다

같은 날 09:30~11:00을 15초 해상도로, 네 지표를 한 시간축에 정렬한 결과다.

| 구간 | CPU 최대(코어) | 스로틀 최대 | `pilot_proxy_convergence_time` p99 | `pilot_xds_push_time` p99 |
|---|---|---|---|---|
| 평시 09:30~09:39 | 0.016 | 0.06 | 0.100 | 0.060 |
| 파드 대량소멸 09:40~09:47 | 0.139 | 2.00 | 0.314 | 0.076 |
| 쏠림 고착 09:48~10:00 | 0.064 | 0.54 | 0.325 | 0.080 |
| 회복 10:01~10:17 | 0.032 | 0.20 | 0.118 | 0.072 |
| **스케일아웃 10:18~11:00** | **0.207** | **2.43** | **0.940** | **0.782** |

**스케일아웃 구간이 네 축 전부에서 더 나쁘다.** `pilot_xds_push_time` p99가 0.0099초 → **0.782초로 79배**, convergence p99가 0.099초 → 0.940초로 9.5배 뛴다. 커넥션이 1,029 → 2,908로 3배 가까이 늘어난 구간이라 push 부하가 파드 교체보다 훨씬 컸다.

⇒ **정정된 결론**: 커넥션 분포(CoV)가 가장 험한 순간과 CPU가 가장 험한 순간은 **다르다.** CoV는 파드가 죽을 때 튀고, CPU·push 지연은 **커넥션 총량이 늘어날 때** 튄다. 재분배 지표만 보고 CPU 부하를 추정하면 엉뚱한 손잡이를 잡게 된다.

### 스로틀 쿼리부터 바로잡는다

처음 뽑은 `sum(rate(container_cpu_cfs_throttled_periods_total[2m])) by (pod)`에는 세 문제가 있었다. **`container` 필터가 없어** 파드 샌드박스 계열까지 합산될 수 있고, **분모가 없어** 해석에 "초당 10 period"라는 가정이 필요하며, **`[2m]`은 8샘플 평활**이라 관측 최대가 순간 피크가 아니다.

```promql
sum(rate(container_cpu_cfs_throttled_periods_total{container="discovery"}[1m])) by (pod)
  /
sum(rate(container_cpu_cfs_periods_total{container="discovery"}[1m])) by (pod)
```

보정 결과 **피크 스로틀 분율 30.9%**(p99 21.2%, 중앙값 0.9%). 조인된 (파드, 시각) 표본 9,217개 중 **77.2%에서 스로틀이 발생**했고, 평시조차 평균 0.46%로 0이 아니다.

그런데 같은 파드·같은 시각의 CPU와 짝지어 보면 숫자가 이상하다.

```text
10:39:30  파드 7jp9c    (CPU limit 600m ⇒ quota 60ms/100ms)
  CPU 평균     = 0.174 코어 = period당 17.4ms   ← quota의 29%
  스로틀 분율 f = 0.309                          ← 31%의 period가 잘림
```

**quota의 29%만 쓰면서 31%의 period에서 잘렸다.** 산술적으로 "스로틀된 period가 quota를 다 썼다"고 보면 그 몫(0.309 × 60ms = 18.5ms)만으로 전체 평균 17.4ms를 넘어버린다.

### 이 어긋남이 바로 CFS의 알려진 결함이다

여기서 "그럼 limit이 600m이 아닌가?"로 새면 안 된다. **전제가 틀렸다. 스로틀된 period가 반드시 quota를 다 쓴 것은 아니다.**

글로벌 quota는 CPU별 runqueue에 **슬라이스(기본 5ms) 단위로 미리 분배**된다. 슬라이스를 받아간 CPU에서 태스크가 곧 잠들면 그 몫은 **쓰이지 않은 채 소진 처리**되고 즉시 반환되지 않는다. 그래서 **실사용 총량이 quota에 한참 못 미쳐도 글로벌 풀이 마르면 스로틀이 걸린다.** kubernetes/kubernetes#67577로 보고된 현상이고, 제기자 본인이 "Kubernetes 버그가 아니라 Linux CFS quota 메커니즘의 한계"라고 밝혔다.

⇒ **"CPU 사용률 29%인데 스로틀 31%"는 모순이 아니라 이 결함의 전형적인 서명이다.**

### 실효 quota를 역산하면 명목의 3분의 1이다

관측된 스로틀 강도에 맞는 quota를 거꾸로 풀면 이렇게 나온다.

```text
① 스로틀된 period가 실효 quota를 소진하므로   f × Q_eff ≤ avg  ⇒  Q_eff ≤ min(avg / f) = 21.5ms
② avg는 Q_eff와 그 이하 값의 가중혼합이므로    avg < Q_eff      ⇒  Q_eff > max(avg) = 20.7ms

⇒ 실효 quota ≈ 21ms/period   (명목 60ms의 약 35%)
```

| | 값 |
|---|---|
| 명목 CPU limit | **600m** (quota 60ms/period) |
| 관측된 스로틀 강도에 맞는 실효 quota | **≈ 210m** (약 21ms/period) |
| 좌초된 몫 | **약 3분의 2** |

**600m를 걸어놨는데 200m처럼 잘리고 있었다.**

### 왜 GOMAXPROCS=1에서 특히 심한가 — 스레드 17개

사건 당시 istiod 프로세스의 **OS 스레드 총량은 17개**였다. GOMAXPROCS=1인데도 그렇다.

**GOMAXPROCS는 P(goroutine 실행용 논리 프로세서) 개수를 제한할 뿐, OS 스레드 개수를 줄이지 않는다.** sysmon, GC 마크 워커, netpoller, 시스템콜에 블록된 스레드는 전부 P 카운트 밖에서 돌고, 전부 같은 cgroup quota에 청구된다.

{{< flow caption="quota 60ms는 5ms 슬라이스 12조각. 스레드 17개가 조각 수보다 많아 여러 CPU가 슬라이스를 받아가고, 조금 쓰고 잠들면 나머지가 좌초된다 — 실효 21ms" >}}
{
  "nodes": [
    { "id": "Q", "col": 0, "row": 0, "label": "quota 60ms", "sub": "limit 600m · period당", "kind": "src" },
    { "id": "S", "col": 1, "row": 0, "label": "5ms 슬라이스 12조각", "sub": "sched_cfs_bandwidth_slice_us", "kind": "proc" },
    { "id": "T", "col": 2, "row": 0, "label": "OS 스레드 17개", "sub": "P는 1개 · 조각보다 많다", "kind": "proc" },
    { "id": "W", "col": 3, "row": 0, "label": "실사용 ≈ 21ms", "sub": "실효 quota", "kind": "sink" },
    { "id": "X", "col": 3, "row": 1, "label": "좌초 ≈ 39ms", "sub": "받아가고 안 쓴 몫", "kind": "query" }
  ],
  "edges": [
    { "from": "Q", "to": "S", "label": "분할" },
    { "from": "S", "to": "T", "label": "CPU별 배분", "rate": 420 },
    { "from": "T", "to": "W", "rate": 700 },
    { "from": "T", "to": "X", "label": "3분의 2", "rate": 380, "speed": "fast" }
  ]
}
{{< /flow >}}

{{< callout type="important" >}}
**GOMAXPROCS=1은 이 상황에서 최악의 조합이다.**

- **스트랜딩은 그대로 얻는다** — 스레드 17개가 여러 CPU에 흩어지는 건 GOMAXPROCS와 무관하다.
- **병렬성은 잃는다** — P가 하나라 CPU-bound 작업(xDS 마샬링·직렬화)은 직렬화된다.

즉 멀티스레드 프로세스의 좌초 표면적은 다 떠안으면서, 그 대가로 얻어야 할 병렬 처리량은 못 받는다. "GOMAXPROCS를 낮췄으니 quota를 천천히 태울 것"이라는 직관은 성립하지 않는다.
{{< /callout >}}

### 남는 것 셋

- **평균 사용률은 CPU limit 사이징의 근거가 못 된다.** `throttled_periods / periods`를 같이 보지 않으면 "CPU 여유 있는데 왜 느리지"에서 조사가 멈춘다.
- **quota가 작을수록 심해진다.** 슬라이스 5ms에 quota 60ms면 풀이 12조각뿐이라 몇 조각만 좌초돼도 비율로 크게 샌다. **limit을 올리는 것이 어긋남을 줄이는 직접적인 수단**인 이유다(§8).
- **뾰족한 파드는 평균 알럿에 안 걸린다.** 스로틀 상위 12개 시점의 argmax가 거의 전부 `9jvvj` 한 대였고, 10:48:30에는 CPU 최대가 다른 파드(`7jp9c`)인데 스로틀 최대는 여전히 `9jvvj`였다. CPU를 덜 쓰면서 더 잘린다.

{{< callout type="info" >}}
**히스토그램 분위수 읽을 때.** 평시값 `0.0990`·`0.0099`는 실제 지연이 아니라 **버킷 경계 아티팩트**다(0.1s·0.01s 버킷 바로 아래로 보간). 평시엔 "그 버킷보다 빠르다" 이상은 알 수 없고, 의미 있는 신호는 0.94/0.78로 튄 구간뿐이다.

**아직 확인 못 한 것** — 09:35~09:50 노드 이벤트(파드 20대 동시 소멸의 원인이 드레인/축출/스팟 회수인지).
{{< /callout >}}

## 8. GOMAXPROCS는 CPU limit이 정한다 — 차트 배선의 함정

§7에서 `GOMAXPROCS=1`이 나왔는데, 이건 **누가 설정한 값이 아니라 `limits.cpu`가 만들어낸 값**이다.

핵심은 이것 하나다. **`limits.cpu: 600m`을 한 번 걸면 그 값이 두 군데로 흘러가는데, 한쪽은 올림되고 한쪽은 안 된다.**

- **Go 런타임 쪽** — 차트가 `limits.cpu`를 `GOMAXPROCS`로 넣어준다. 정수여야 하므로 kubelet이 **올림**한다. `0.6 → 1`. Go는 "1코어 쓸 수 있다"고 믿고 자기 설정을 그에 맞춘다.
- **커널 쪽** — CFS quota는 올림이 없다. `0.6코어 = 100ms마다 60ms`, 딱 그만큼이다.

⇒ **Go는 1코어짜리라 생각하고 일을 벌이는데, 커널은 0.6코어에서 끊는다.**

{{< flow caption="같은 600m인데 위 갈래에서는 1코어로 올림되고, 아래 갈래에서는 0.6코어 그대로다. Go는 1코어라 믿고 커널은 0.6만 준다 — 이 어긋남이 스로틀의 출발점" >}}
{
  "nodes": [
    { "id": "L", "col": 0, "row": 0, "label": "limits.cpu: 600m", "sub": "내가 건 값 하나", "kind": "src" },
    { "id": "D", "col": 1, "row": 0, "label": "Istio 차트", "sub": "GOMAXPROCS env로 주입", "kind": "proc" },
    { "id": "C", "col": 2, "row": 0, "label": "kubelet", "sub": "올림: 0.6 → 1", "kind": "proc" },
    { "id": "G", "col": 3, "row": 0, "label": "GOMAXPROCS = 1", "sub": "Go: 1코어 쓸 수 있다", "kind": "sink" },
    { "id": "P", "col": 4, "row": 0, "label": "PushThrottle = 20", "sub": "동시 push 슬롯", "kind": "sink" },
    { "id": "Q", "col": 1, "row": 1, "label": "CFS quota 60ms", "sub": "커널: 0.6코어만 허용", "kind": "query" }
  ],
  "edges": [
    { "from": "L", "to": "D" },
    { "from": "D", "to": "C" },
    { "from": "C", "to": "G", "label": "올림한다", "rate": 500 },
    { "from": "G", "to": "P", "label": "여기서 파생", "rate": 900, "speed": "slow" },
    { "from": "L", "to": "Q", "label": "올림 없다", "rate": 500 }
  ],
  "groups": [
    { "label": "Go 런타임이 믿는 값 — 1코어", "members": ["D", "C", "G", "P"] },
    { "label": "커널이 강제하는 값 — 0.6코어", "members": ["Q"] }
  ]
}
{{< /flow >}}

### 차트가 Downward API로 주입한다

Istio 1.19부터 istiod Deployment 템플릿에 하드코딩돼 있다(1.24.1 `deployment.yaml` 197-205행).

```yaml
- name: GOMEMLIMIT
  valueFrom:
    resourceFieldRef:
      resource: limits.memory
- name: GOMAXPROCS
  valueFrom:
    resourceFieldRef:
      resource: limits.cpu
      divisor: "1"
```

`values.yaml`로 토글되는 옵션이 아니라 템플릿 고정 블록이다. 도입 PR #46253의 근거는 *"Basically this gives us performance improvements for free"* 였고, 1.19 체인지노트에 *"Added an automatically set GOMEMLIMIT and GOMAXPROCS to all deployments to improve performance"* 로 실렸다.

### kubelet이 올림으로 계산한다

`resourceFieldRef`의 값 변환은 커널이 아니라 kubelet 쪽 코드가 한다(`pkg/api/v1/resource/helpers.go`).

```go
func convertResourceCPUToString(cpu *resource.Quantity, divisor resource.Quantity) (string, error) {
	c := int64(math.Ceil(float64(cpu.MilliValue()) / float64(divisor.MilliValue())))
	return strconv.FormatInt(c, 10), nil
}
```

**`math.Ceil`이다.** `ceil(600/1000) = 1` ⇒ `GOMAXPROCS=1`.

{{< callout type="important" >}}
**소수점 CPU limit은 이 배선에서 항상 어긋난다.**

| | 계산 | limit 600m일 때 |
|---|---|---|
| GOMAXPROCS | `ceil(limit_cores)` — **올림** | **1** (런타임은 1.0코어를 태울 준비를 함) |
| CFS quota | `limit_cores × 100ms` — **정확값** | **60ms/100ms** (커널은 0.6코어만 허용) |
| 명목 어긋남 | 런타임 준비치 ÷ 커널 허용치 | **1.7배** |
| **실효 어긋남** | §7의 스트랜딩 반영(실효 quota ≈ 21ms) | **약 5배** |

1000m 미만의 어떤 값을 넣어도 GOMAXPROCS는 1로 올림되지만 quota는 그 값 그대로다. **작게 걸수록 어긋남이 커지고, 슬라이스 조각 수가 줄어 스트랜딩 비율까지 함께 나빠진다.** 1500m·2500m 같은 값도 마찬가지고, **정수 코어(1000m·2000m·4000m)만 둘이 일치한다.**
{{< /callout >}}

### PushThrottle까지 딸려 온다

`pilot/pkg/features/tuning.go`(1.24.1):

```go
procs := runtime.GOMAXPROCS(0)
// 1: 20 / 2: 25 / 4: 35 / 32: 100
return min(15+5*procs, 100)
```

그리고 push는 프록시별 goroutine으로 병렬 디스패치된다(`pilot/pkg/xds/discovery.go`의 `doSendPushes`, 세마포어 크기 = `features.PushThrottle`).

{{< callout type="info" >}}
**슬롯 20개가 잘못된 값은 아니다 — 동시성과 병렬성은 다르다.**

push 한 건은 `[설정 조립·마샬링·TLS]`(CPU-bound, P 필요) + `[스트림에 쓰고 네트워크 대기]`(I/O-bound, P 불필요)로 나뉜다. 뒤쪽이 대부분이고 Go에서 I/O 대기는 P를 점유하지 않으므로, **1코어에서 goroutine 20개가 떠 있는 것 자체는 정상**이다. 식의 기본값 15도 I/O 겹치기용 바닥값이고, 코어당 +5가 병렬성 몫이다.

문제는 **CPU-bound 구간이 P 하나에 직렬화**되고, 그 P마저 quota에서 잘린다는 것이다. 20이 많은 게 아니라 20건이 만드는 CPU 수요를 받아낼 자리가 없다.
{{< /callout >}}

§7에서 `pilot_xds_push_time` p99가 79배 뛴 게 이 구조와 정합한다. 다만 istiod에는 xDS 응답 캐시가 있어 스코프가 같은 프록시끼리는 마샬링을 재사용하므로, **실제 CPU-bound 비중은 프로파일 없이 단정할 수 없다** — 소스 구조에서 나온 추론이다.

### Istio 1.24와 Go 버전 — 런타임이 구제해주지 않는다

Go 1.25(2025-08 GA)부터 런타임이 cgroup CPU limit을 읽어 GOMAXPROCS를 자동 설정한다. 릴리스 노트 원문:

> "On Linux, the runtime considers the CPU bandwidth limit of the cgroup containing the process, if any. If the CPU bandwidth limit is lower than the number of logical CPUs available, GOMAXPROCS will default to the lower limit. ... **The Go runtime does not consider the "CPU requests" option.**"
>
> "Both of these behaviors are automatically disabled if GOMAXPROCS is set manually via the GOMAXPROCS environment variable or a call to `runtime.GOMAXPROCS`."

**그런데 Istio 1.24.1의 `go.mod`는 `go 1.22.0`이다.** Go 1.25 이전이라 이 기능이 없다.

| | Istio 1.24.1 (Go ≥1.22) | Go 1.25+ 로 빌드될 경우 |
|---|---|---|
| GOMAXPROCS 결정 주체 | **차트 Downward API 주입값이 전부** | 런타임이 cgroup에서 자동 산출 |
| 반올림 | kubelet의 `math.Ceil` | Go도 **올림**(go.dev 블로그: *"Go always rounds up"*) |
| env var 명시 시 | 그 값이 그대로 | **자동 로직이 꺼진다** |

두 번째 열의 함정에 주의할 것 — Istio 차트는 `GOMAXPROCS` **환경변수를 명시적으로 주입**하므로, 훗날 istiod가 Go 1.25+ 로 빌드돼도 **런타임 자동 감지는 계속 꺼진 상태로 남는다.** 차트 배선이 런타임보다 우선한다.

### 차트 기본값에는 CPU limit이 없다

1.24.1 차트의 pilot `resources` 기본값은 **request만** 있다.

```yaml
resources:
  requests:
    cpu: 500m
    memory: 2048Mi
  # limits 섹션 없음
```

limit이 없으면 Downward API는 노드 allocatable로 대체된다. Kubernetes 공식 문서:

> "If CPU and memory limits are not specified for a container, and you use the downward API to try to expose that information, then the kubelet defaults to exposing the maximum allocatable value for CPU and memory based on the node allocatable calculation."

⇒ **CPU limit을 거는 순간 GOMAXPROCS가 노드 코어 수에서 그 값으로 떨어진다.** 스로틀 상한을 걸었다고 생각했는데 병렬성까지 같이 줄인 것이고, 소수점 값이면 §2단계의 어긋남까지 얹힌다.

### 권고

| 선택지 | quota | GOMAXPROCS | 평가 |
|---|---|---|---|
| limit 없음 (차트 기본) | 없음 | 노드 코어 수 | 스로틀은 사라지나 큰 노드에서 과병렬 |
| `600m` (현재) | 60ms/100ms → **실효 ≈21ms** | 1 | **스트랜딩 + 직렬화.** 최악 조합 |
| `"1"` | 100ms/100ms | 1 | 어긋남은 해소, **직렬화는 그대로** |
| `"2"` | 200ms/100ms | 2 | 버스트 여유 3.3배 + 병렬 2배 + PushThrottle 25 |

```yaml
resources:
  requests:
    cpu: 500m
    memory: 2Gi
  limits:
    cpu: "2"        # 정수로. 소수점은 quota와 GOMAXPROCS가 어긋난다
    memory: 2Gi
```

`"2"`는 §7에서 버스트 시 단일 P 포화가 보였다는 근거에 기반한 출발점이지 실측으로 확정한 값이 아니다. 조정 후 §7의 네 지표를 다시 떠서 `pilot_xds_push_time` p99가 내려오는지로 검증할 것.

**메모리도 같이 본다.** `GOMEMLIMIT`이 `limits.memory`에서 같은 방식으로 주입되므로, 메모리 limit을 차트 기본 request(2048Mi)보다 낮게 잡으면 Go의 소프트 메모리 상한까지 함께 낮아진다.

## 이 문서에서 가져갈 것

- 커넥션 수 트리거는 "모든 커넥션의 비용이 일정하다"는 전제를 깔고, 그 전제는 **규모가 가장 큰 날 깨진다.** 임계를 잡을 때 `conn × endpoints`를 같이 봐야 한다.
- **Istio에 커넥션 능동 재분배는 없다.** `keepaliveMaxServerConnectionAge` 강제 종료가 전부이고, Google 공식 권고도 레플리카 다중화 + 사전 스케일링 두 개뿐이다.
- 주기를 절반으로 줄이면 재연결 레이트가 **정확히 2배**가 된다. 지터(±10%)는 창을 넓혀줄 뿐 총량을 줄이지 않는다.
- CPU를 되돌리는 지렛대는 빈도가 아니라 **단가** 쪽에 있다 — `Sidecar`·`exportTo`·`discoverySelectors`로 커넥션당 config 크기를 깎는 것.
- **재분배 지표와 CPU 지표는 다른 순간에 튄다**(§7). CoV는 파드 20대가 죽은 09:40에 146%로 튀었지만, CPU·스로틀·`pilot_xds_push_time`은 커넥션이 3배로 불어난 스케일아웃 구간에서 더 나빴다(push p99 79배). 커넥션 분포만 보고 CPU 부하를 추정하지 말 것.
- **평균 사용률로 CPU limit을 사이징하지 말 것**(§7). CPU 그래프는 여유로워 보이는데 (파드, 시각) 표본의 **77.2%에서 스로틀이 발생**했고 피크 분율은 30.9%였다. `throttled_periods / periods`를 같이 보지 않으면 이 상태는 보이지 않는다.
- **quota는 명목대로 다 쓰이지 않는다**(§7). CFS는 quota를 CPU별 5ms 슬라이스로 미리 분배하는데, 받아간 CPU가 곧 잠들면 그 몫이 좌초된다(kubernetes#67577). 실측에서 **명목 600m가 실효 210m처럼 동작했다** — 3분의 2가 샜다.
- **GOMAXPROCS를 낮춰도 OS 스레드는 안 줄어든다**(§7). GOMAXPROCS=1인데 프로세스 스레드는 17개였다. quota 60ms는 슬라이스 12조각뿐이라 조각보다 스레드가 많고, 좌초가 구조적으로 발생한다. **스트랜딩 표면적은 그대로 떠안고 병렬성만 잃는 조합**이다.
- **`GOMAXPROCS`는 설정하는 게 아니라 `limits.cpu`에서 파생된다**(§8). 차트 Downward API + kubelet `math.Ceil` 조합이라 소수점 limit은 항상 어긋나고, `PILOT_PUSH_THROTTLE`까지 그 값에서 파생된다. Istio 1.24는 Go 1.22 기반이라 Go 1.25의 컨테이너 인식 런타임도 없다.
- `pilot_xds_pushes`는 에러 카운터다. `pilot_xds_write_timeout`·`pilot_total_xds_rejects`는 존재하지 않는다. 알럿 걸기 전에 `:15014/metrics`를 직접 스크랩해 이름을 확인할 것.

## 소스

- Istio 공식 문서 — **Performance and Scalability**: <https://istio.io/latest/docs/ops/deployment/performance-and-scalability/>
- Istio 공식 문서 — **Configuration scoping** (설정 하나의 비용, `Sidecar`·`exportTo`·`discoverySelectors`): <https://istio.io/latest/docs/ops/configuration/mesh/configuration-scoping/>
- Istio 공식 문서 — **Best Practices / Deployment** (`autoscaleMin` 2 이상 권고): <https://istio.io/latest/docs/ops/best-practices/deployment/>
- Istio 공식 문서 — **pilot-discovery 커맨드 레퍼런스** (`--keepaliveMaxServerConnectionAge` 기본값): <https://istio.io/latest/docs/reference/commands/pilot-discovery/>
- Istio 1.21 Change Notes (`PILOT_MAX_REQUESTS_PER_SECOND`·`PILOT_PUSH_THROTTLE` 자동 스케일): <https://istio.io/latest/news/releases/1.21.x/announcing-1.21/change-notes/>
- istio/istio 소스 — `pilot/pkg/xds/monitoring.go` (메트릭 정의 1차 출처): <https://github.com/istio/istio/blob/master/pilot/pkg/xds/monitoring.go>
- istio/istio 소스 — `pkg/keepalive/options.go` (기본값 Infinity, 지터 주석): <https://github.com/istio/istio/blob/master/pkg/keepalive/options.go>
- istio/istio 소스 — `pilot/pkg/xds/discovery.go` (`RequestRateLimit`, thundering herd 주석): <https://github.com/istio/istio/blob/master/pilot/pkg/xds/discovery.go>
- istio/istio 차트 — `manifests/charts/istio-control/istio-discovery/values.yaml` (HPA·keepalive 기본값): <https://github.com/istio/istio/blob/master/manifests/charts/istio-control/istio-discovery/values.yaml>
- istio/istio 릴리스노트 — Delta xDS 기본 활성화: <https://github.com/istio/istio/blob/master/releasenotes/notes/delta-xds-default.yaml>
- istio/istio#42634 — istiod HPA 스레싱: <https://github.com/istio/istio/issues/42634>
- istio/istio#57809 — 2,500노드에서 Gateway xDS 수신 지연: <https://github.com/istio/istio/issues/57809>
- grpc-go 소스 — `keepalive/keepalive.go` (±10% 지터): <https://github.com/grpc/grpc-go/blob/master/keepalive/keepalive.go>
- Google Cloud — **Troubleshoot scaling** (장수 커넥션발 부하 불균형 공식 인정): <https://docs.cloud.google.com/service-mesh/docs/troubleshooting/troubleshoot-scaling>
- Google Cloud — **Scalability best practices**: <https://docs.cloud.google.com/service-mesh/docs/operate-and-maintain/scalability-best-practices>
- Google Cloud — **Troubleshoot uneven traffic distribution** (장수 커넥션 일반 원칙: 커넥션 풀·주기적 재생성·graceful drain): <https://docs.cloud.google.com/kubernetes-engine/docs/troubleshooting/troubleshoot-uneven-traffic-distribution>
- Istio 블로그 — **ztunnel** (커넥션 수 자체를 줄이는 접근): <https://istio.io/latest/blog/2023/rust-based-ztunnel/>
- Istio 블로그 — **discoverySelectors**: <https://istio.io/latest/blog/2021/discovery-selectors/>
- Charles Xu — **Scaling Istio** (practitioner 블로그, HPA behavior 예시·EnvoyFilter idle_timeout 기법): <https://charlesxu.io/scaling-istio/>

§8(GOMAXPROCS 사슬) 근거:

- istio/istio 1.24.1 — `manifests/charts/istio-control/istio-discovery/templates/deployment.yaml` 197-205행 (GOMAXPROCS·GOMEMLIMIT Downward API 주입): <https://github.com/istio/istio/blob/1.24.1/manifests/charts/istio-control/istio-discovery/templates/deployment.yaml>
- istio/istio PR #46253 — "Set GOMAXPROCS and GOMEMLIMIT" (도입 PR, 1.19.0): <https://github.com/istio/istio/pull/46253>
- istio/istio 1.24.1 `values.yaml` — pilot `resources` 기본값(request만, CPU limit 없음): <https://github.com/istio/istio/blob/1.24.1/manifests/charts/istio-control/istio-discovery/values.yaml>
- istio/istio 1.24.1 `go.mod` — `go 1.22.0`: <https://github.com/istio/istio/blob/1.24.1/go.mod>
- istio/istio 1.24.1 — `pilot/pkg/features/tuning.go` (`PushThrottle = min(15+5*GOMAXPROCS, 100)`): <https://github.com/istio/istio/blob/1.24.1/pilot/pkg/features/tuning.go>
- istio/istio 1.24.1 — `pilot/pkg/xds/discovery.go` (`doSendPushes`, 프록시별 goroutine 병렬 디스패치): <https://github.com/istio/istio/blob/1.24.1/pilot/pkg/xds/discovery.go>
- kubernetes/kubernetes — `pkg/api/v1/resource/helpers.go` (`convertResourceCPUToString`이 `math.Ceil` 사용): <https://github.com/kubernetes/kubernetes/blob/master/pkg/api/v1/resource/helpers.go>
- Kubernetes 공식 문서 — **Downward API** (limit 미지정 시 node allocatable로 대체된다는 원문): <https://kubernetes.io/docs/concepts/workloads/pods/downward-api/>
- Go 1.25 릴리스 노트 — **Container-aware GOMAXPROCS** (CPU requests는 고려하지 않음, env var 명시 시 자동 로직 비활성): <https://go.dev/doc/go1.25>
- Go 블로그 — **Container-aware GOMAXPROCS** (*"Go always rounds up"*): <https://go.dev/blog/container-aware-gomaxprocs>
- Linux 커널 문서 — **CFS Bandwidth Control** (quota/period 정의): <https://docs.kernel.org/scheduler/sched-bwc.html>
- kubernetes/kubernetes#67577 — CFS quota slice 분배로 인한 저사용률 스로틀 보고: <https://github.com/kubernetes/kubernetes/issues/67577>
- 버전·설정에 따라 기본값이 달라진다. 배포된 istiod의 `:15014/metrics`와 실제 차트 values를 직접 확인할 것.
