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
- 실측(§7)으로는 **정상 순환보다 파드 교체가 훨씬 비쌌다.** 재연결 주기를 조이기 전에 파드가 어떻게 죽는지(PDB·`maxUnavailable`·노드 드레인)부터 볼 것.
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

⇒ 신규 istiod 파드는 "새로 맺어지는 커넥션"만 받을 수 있다. 스케일아웃은 desired replicas까지만 답하고, **커넥션이 어느 파드로 가는가는 트리거의 관할 밖**이다.

이건 우리 클러스터만의 사정이 아니라 문서화된 성질이다. Google Cloud 서비스 메시 트러블슈팅 문서의 원문:

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
**작성 시점 상태**: CPU·스로틀링 메트릭을 아직 대조하지 못했다. 아래 인과는 `pilot_xds` 단독 관측에 근거한 **추론**이며, 스로틀 발생 시각을 확인하면 결론이 바뀔 수 있다. 확정 전까지 이 절은 골격으로 둔다.
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
3. **진짜 스파이크는 정상 순환이 아니라 파드 교체다.** 09:29~09:44 버킷의 합계는 이론치의 2.6배, 6월 16:45~17:00 버킷은 4.1배. 두 사건 모두 같은 모양이다.

⇒ 잠정 결론: **문제는 "얼마나 자주 다시 맺게 할 것인가"가 아니라 "파드가 어떻게 죽는가"였다.** 손잡이가 `keepaliveMaxServerConnectionAge`가 아니라 PDB·`maxUnavailable`·노드 드레인 정책 쪽에 있다는 뜻이다.

{{< callout type="info" >}}
**측정 방법의 한계 — 정상 재연결 수치는 하한이다.** 파드별 증가분의 합으로 셌기 때문에, 15초 스텝 안에서 끊기고 다시 붙은 것이 상쇄되면 잡히지 않는다. 실측 1.0/s는 이론치(2,900/900s = 3.2/s)의 0.3배인데 이 격차의 상당 부분은 측정 방식 탓이다. **절대값이 아니라 6월 대비 상대 비교로만 읽을 것.**
{{< /callout >}}

### 결론을 확정하려면 필요한 데이터

- `container_cpu_cfs_throttled_seconds_total{container="discovery"}` 파드별 — 스로틀 시각이 09:41~09:56인지 10:44~11:00 스케일아웃인지가 결론을 가른다
- 09:35~09:50 노드 이벤트 — 드레인/축출/스팟 회수 여부
- 같은 창의 `pilot_proxy_convergence_time`, `pilot_xds_push_time` — 재연결 1건의 단가 확인

## 이 문서에서 가져갈 것

- 커넥션 수 트리거는 "모든 커넥션의 비용이 일정하다"는 전제를 깔고, 그 전제는 **규모가 가장 큰 날 깨진다.** 임계를 잡을 때 `conn × endpoints`를 같이 봐야 한다.
- **Istio에 커넥션 능동 재분배는 없다.** `keepaliveMaxServerConnectionAge` 강제 종료가 전부이고, Google 공식 권고도 레플리카 다중화 + 사전 스케일링 두 개뿐이다.
- 주기를 절반으로 줄이면 재연결 레이트가 **정확히 2배**가 된다. 지터(±10%)는 창을 넓혀줄 뿐 총량을 줄이지 않는다.
- CPU를 되돌리는 지렛대는 빈도가 아니라 **단가** 쪽에 있다 — `Sidecar`·`exportTo`·`discoverySelectors`로 커넥션당 config 크기를 깎는 것.
- **실측해보면 정상 순환보다 파드 교체가 훨씬 비싸다.** 2026-07-25 관측에서 keepalive 15m의 정상 재연결은 피크에도 ~1.0 conn/s인데, 파드 20대가 동시에 죽은 15분 버킷에서는 강제 재접속만 1.80 conn/s였고 CoV가 146%까지 튀었다. **재연결 주기를 조이기 전에 파드가 어떻게 죽는지부터 볼 것** — PDB·`maxUnavailable`·노드 드레인 정책(§7).
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
- 버전·설정에 따라 기본값이 달라진다. 배포된 istiod의 `:15014/metrics`와 실제 차트 values를 직접 확인할 것.
