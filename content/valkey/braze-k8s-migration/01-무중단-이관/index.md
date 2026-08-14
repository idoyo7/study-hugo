---
title: "Redis 581샤드를 무중단으로 Kubernetes에 올리기 — 그리고 90%라는 숫자의 진실"
linkTitle: "01 무중단 이관"
weight: 1
---

# 01 · Redis 581샤드를 무중단으로 Kubernetes에 올리기 — 그리고 90%라는 숫자의 진실

{{< callout type="info" >}}
**한눈에**
- Braze는 Valkey Cluster를 쓰지 않는다. 앞 세션이 다룬 gossip·16384 슬롯의 단일 거대 클러스터가 아니라, Sentinel이 감시하는 독립 HA 샤드 581개다. 샤딩은 서버가 아니라 클라이언트 코드 안에 박힌 해싱이 한다(04:55~05:34). 두 발표를 같은 토폴로지 이야기로 섞어 읽으면 전부 틀린다.
- 이관을 어렵게 만든 건 Redis가 아니라 ClusterIP다. Sentinel은 replica를 IP로 추적하는데 파드가 롤되면 IP가 바뀐다 → 파드마다 Service를 붙여 고정 ClusterIP를 얻는다 → 그런데 ClusterIP는 클러스터 밖에서 안 보인다. 남은 EC2 primary가 안쪽 파드를 복제 대상으로 잡을 방법이 사라진다.
- 해법은 L4를 클러스터 밖으로 빼는 것이다. RESP가 L4 프로토콜이라 [NLB가 라우팅할 수 있고](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html), 서버·sentinel이 `replica-announce-ip`/`announce-ip`로 자기 주소를 NLB 주소라고 거짓말한다. 이 한 수로 무중단과 무손실 롤백이 동시에 성립한다.
- 이관 중에만 생기는 위험이 둘이다 — NLB 데이터 전송비 월 $100,000 초과 추정치, 그리고 sentinel이 6대로 늘어나며 생기는 split brain. 후자는 7번째 sentinel + quorum 5로 절대 과반을 강제해 막았다.
- Valkey 이관은 실제로 두 줄이었다. helm `_helpers.tpl`의 flavor 판별 함수와 values의 이미지 두 줄(`redis:7.2.4-alpine` → `valkey/valkey:8.1.1-alpine`). config는 한 줄도 안 고쳤고, 350샤드·10클러스터를 6주에 끝냈다.
- 90%는 최선값 하나다. 슬라이드 26쪽은 "90% p95 latency improvement"만 크게 띄우지만, 발표자 본인이 22:12~23:44에서 전체 평균 p95 15% · p50 5%를 덧붙인다. 90%만 인용하면 발표자가 무대에서 직접 부인한 주장을 하는 셈이 된다.
{{< /callout >}}

왜 이 문서인가. 이 발표는 이 도메인에서 Kubernetes 프로덕션 증거가 있는 유일한 소스입니다. 자매 챕터의 AWS 발표는 EC2 벤치마크였고, 이쪽은 2023년 2월부터 2024년 5월까지 실제로 이관해 그 뒤로 2년을 굴린 기록입니다. 이 문서는 발표 내용에 NLB 요금 자체 검산 · Kubernetes 스케줄링 프리미티브 판정 · in-place resize GA 시점 대조 · 회사 수치 원문 확인을 덧붙였고, 발표·슬라이드·1차 문서가 어긋나는 지점을 그대로 적었습니다. 검증 기준: 발표 전사(714줄) · 슬라이드 PDF 34장 · Braze 투자자 공시 · Redis/Valkey Sentinel 공식 문서 · AWS ELB 요금표 · Kubernetes 공식 문서와 KEP-1287.

출처: KubeCon + CloudNativeCon Europe 2026 — *[Redis on EC2 to Valkey on Kubernetes: A Zero-Downtime Case Study](https://kccnceu2026.sched.com/event/2CW6D/redis-on-ec2-to-valkey-on-kubernetes-a-zero-downtime-case-study-joe-heyburn-braze)* (Joe Heyburn · Staff Engineer, in-memory database team, Braze). 2026-03-26(목) 11:45–12:15 CET, Hall 8 | Room E — 앞 세션 바로 다음, 같은 방입니다. [영상 28:12](https://www.youtube.com/watch?v=rNZ6HLiFgYI) · [슬라이드 PDF 34장](https://hosted-files.sched.co/kccnceu2026/39/PDF%20Redis%20on%20EC2%20to%20Valkey%20on%20Kubernetes%20-%20%20KubeCon%20EU%202026%20%282%29.pdf).

자매 문서: [02 발표 전사]({{< relref "../02-발표-전사.md" >}}) · 두 발표를 맞붙인 [두 갈래]({{< relref "../../00-두-갈래.md" >}}) · 반대편 토폴로지를 다룬 [① 2,000노드에서 부러지는 것]({{< relref "../../cluster-xl-scale/01-부러지는-것.md" >}})

## 1. Braze가 굴리는 것은 Valkey Cluster가 아니다

이 문서에서 가장 먼저 박아야 할 사실입니다. 같은 방에서 15분 전에 끝난 AWS 발표는 cluster bus와 16384 슬롯을 말했습니다. Braze는 그 기능을 하나도 쓰지 않습니다.

Braze의 한 샤드는 primary 하나와 replica들로 이뤄진 HA 단위이고, 이걸 Sentinel이 감시합니다. 샤드끼리는 서로를 모릅니다 — 슬롯도, gossip도, cluster bus도 없습니다. 그러면 어느 키가 어느 샤드로 가는지는 누가 정하는가요? 발표자가 정확히 답합니다.

> the clients connect to Sentinel, and the clients decide what shard they need to write to based on their own hashing logic, which is baked into the client side. — 05:10~05:19

즉 샤딩 로직이 애플리케이션 코드 안에 있습니다. Sentinel은 "이 샤드의 현재 primary IP와 port가 무엇인가"만 답하고, "어느 샤드인가"는 클라이언트가 키를 해싱해 스스로 정합니다. 이 구조의 결과가 아래 대비입니다.

| | ① AWS 발표 | ② Braze 발표 |
|---|---|---|
| 토폴로지 | Valkey Cluster **1개**, 2,000노드 | Sentinel HA **581샤드**, 서로 독립 |
| 샤딩 주체 | 서버 — 슬롯 16384 | **클라이언트 해싱** — 코드에 내장 |
| 토폴로지 전파 | cluster bus full-mesh gossip | 없음. Sentinel이 primary 주소만 답한다 |
| 장애 감지 | 노드끼리 PFAIL/FAIL gossip | Sentinel quorum |
| 재샤딩 | slot migration(9.0 atomic) | **엔진이 못 한다** — 클라이언트 해싱을 바꿔야 한다 |
| 근거의 성질 | EC2 벤치마크(짧은 측정 구간) | **Kubernetes 프로덕션 2년** |
| 규모 | 1B RPS(벤치마크) | **36M ops/sec(실운영)** |

전이되는 교훈이 서로 겹치지 않습니다. AWS 발표의 재접속 폭풍·투표 분열·failure report는 전부 cluster bus 코드 안의 문제이므로 Braze 토폴로지에는 존재하지도 않습니다. 반대로 이 문서가 다루는 announce 주소 문제와 Sentinel split brain은 클러스터 모드에는 없습니다.

### 1.1 규모와 워크로드

슬라이드 5쪽의 수치는 셋뿐이고 전부 실운영 값입니다.

| 항목 | 값 | 무대에서의 표현 |
|---|---|---|
| HA instances(shards) | **581** | "about 600" |
| 초당 연산 | **36M ops/sec** | 그대로 |
| 메모리 총량 | **6.6TiB** | "6 and 1/2 terabytes" |

용도는 캐시 하나가 아닙니다 — rate limiting, distributed lock, message deduplication, 그리고 Sidekiq입니다(02:37~02:51). Sidekiq은 Ruby 잡 큐이고 Redis가 그 심장이므로, 이건 캐시가 아니라 작업 파이프라인 자체가 여기 얹혀 있다는 뜻입니다. 발표자 표현대로 "the entire backbone of the Braze platform"입니다. 다운타임을 못 받아들이는 이유가 여기서 나옵니다.

레거시는 EC2 + Chef였습니다. 3AZ에 primary/replica 쌍을 흩고, cluster-scoped Sentinel 3대(sentinel-001~003)가 그 클러스터의 모든 샤드를 한꺼번에 감시하는 구조입니다(슬라이드 7쪽).

### 1.2 회사 수치 — as-of 한 줄이 덮지 못하는 것

슬라이드 3쪽은 회사 규모를 한 판에 몰아 놓고 하단에 "All numbers As of January 31, 2025"라고 적습니다. 개별 수치는 틀리지 않았는데 그 한 줄이 세 군데서 실제 기준과 다릅니다.

| 슬라이드 | 확인 결과 | 판정 |
|---|---|---|
| 고객 2,296곳 | [투자자 공시](https://investors.braze.com/news/news-details/2025/Braze-Reports-Fiscal-Year-and-Fourth-Quarter-2025-Results/default.aspx) — "Total customers increased to 2,296 as of January 31, 2025" | 정확 |
| MAU 69억 | [Braze 블로그](https://www.braze.com/resources/articles/2024-how-braze-powered-exceptional-marketing-at-scale) — "6.9 billion (**as of October 31, 2024**)" | **기준일이 다르다** |
| "over $130M R&D expense **in 2024**" | 같은 공시 손익계산서 — "Research and development 133,969" = **$133.969M** | 액수는 부합. 다만 그 수치는 역년 2024가 아니라 **FY2025**(2024-02~2025-01) 값이다 |
| API 호출 8.6T · 메시지 3.9T | 같은 블로그 — 2024 **역년 전체** 수치, as-of 날짜 없음 | 기준이 다름 |

R&D를 두고 슬라이드가 틀렸다고 말하면 과합니다 — 원문이 "over $130M"이라 $133.969M은 그 안에 들어옵니다. 어긋나는 건 액수가 아니라 기간 라벨이고, 회계연도와 역년이 한 판에 섞여 있습니다. 인용할 일이 있으면 MAU 69억은 2024-10-31 기준, R&D는 FY2025 기준 $133.969M이라고 적는 편이 원문에 맞습니다. 발표 자체의 논지에는 영향이 없지만, 이 문서가 확인한 것은 그대로 적어 둡니다.

## 2. Kubernetes가 Sentinel을 깨뜨리는 지점

Braze는 이관을 시작하기 전부터 이미 greenfield Kubernetes 클러스터에 Helm으로 Redis를 띄워 본 상태였습니다. 그런데 그쪽 토폴로지가 레거시와 다릅니다.

| | 레거시 EC2 | Kubernetes |
|---|---|---|
| 샤드 단위 | primary 1 + replica 1 | **StatefulSet 1개 = 샤드 1개**, 파드 3개(primary 1 + replica 2) |
| Sentinel 배치 | **cluster-scoped** 3대가 전 샤드 감시 | **파드마다 사이드카 컨테이너** |
| Sentinel 감시 범위 | 클러스터 전체 | **그 샤드 하나만** |

사이드카로 내린 결정 자체는 좋습니다 — 샤드가 자기 감시자를 데리고 다니므로 샤드 추가가 곧 감시자 추가가 되고, cluster-scoped Sentinel 3대에 581샤드를 몰아 주는 병목이 사라집니다. 문제는 다른 데서 터집니다.

### 2.1 파드 IP가 바뀌면 Sentinel에 시체가 쌓인다

**Sentinel은 replica를 IP로 추적합니다.** 정확히는 primary의 `INFO` 출력에서 replica 목록을 읽어 자동으로 찾아내는데, [Redis 복제 문서](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)가 그 성질을 이렇게 적습니다 — replica는 "the IP address they use to connect to the master"로 보이고, 포트는 "the listening port configured into redis.conf"로 보입니다. 둘 다 **접속 시점의 실제 값**이지 논리 주소가 아닙니다.

Kubernetes에서 파드가 롤되면 파드 IP가 바뀝니다. Sentinel 입장에서는 **옛 IP가 응답을 멈춘 것**이고, 새 IP는 별개의 replica로 새로 등록됩니다. 슬라이드 8쪽의 `sentinel replicas cache-0` 출력에 그 상태가 그대로 남아 있습니다 — 살아 있는 셋 옆에 `down` 하나가 붙어 있습니다.

이게 왜 사고인가요? [Sentinel 문서](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)가 Docker/NAT 절에서 최악의 경우를 명시합니다.

> Since Sentinels auto detect replicas using masters INFO output information, the detected replicas will not be reachable, and Sentinel will never be able to failover the master, since there are no good replicas from the point of view of the system.

**stale replica가 쌓이는 건 표시가 지저분해지는 문제가 아니라 failover가 아예 안 되는 문제입니다.** 쓸 만한 replica가 하나도 없다고 판단하면 Sentinel은 승격을 시도하지 않습니다.

### 2.2 고정 ClusterIP + init 컨테이너

Braze의 해법은 두 조각입니다.

1. 파드마다 Service를 하나씩 붙인다. Service의 ClusterIP는 그 Service가 살아 있는 동안 바뀌지 않으므로 파드가 몇 번을 롤아웃해도 주소가 유지된다.
2. init 컨테이너가 그 ClusterIP를 조회한다. 서버와 sentinel은 자기 자신을 그 주소로 announce한다.

announce는 발명이 아니라 [문서화된 기능](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)입니다 — Redis 3.2.2부터 `replica-announce-ip` / `replica-announce-port`로 replica가 임의의 주소 쌍을 강제 광고할 수 있고 Sentinel 쪽에는 `sentinel announce-ip` / `sentinel announce-port`가 대응합니다. [Valkey도 같은 지시어를 그대로 문서화](https://valkey.io/topics/sentinel/)합니다. 원래 NAT·Docker 포트 매핑용으로 만들어진 장치를 Kubernetes 파드 IP 문제에 쓴 것입니다.

슬라이드 9쪽에서 `sentinel replicas cache-0` 출력이 파드 IP(`100.1.1.1`)에서 Service ClusterIP(`100.100.1.1`)로 바뀌고 `down` 항목이 사라집니다.

### 2.3 그리고 여기서 진짜 문제가 시작된다

{{< callout type="warning" >}}
**ClusterIP는 클러스터 밖에서 접근할 수 없습니다.** 파드끼리는 서로 잘 통신하지만 아직 EC2에 남아 있는 primary는 그 주소로 패킷을 보낼 수 없습니다.

이게 이관 전체를 어렵게 만든 단 하나의 제약입니다. 안쪽에서는 완결된 설계인데, **바깥에 남은 원본이 안쪽을 복제 대상으로 지목할 방법이 없습니다.**
{{< /callout >}}

## 3. 세 가지 이관안과 탈락 이유

요구사항은 둘뿐이었고 둘 다 타협 불가입니다.

- 무중단. Braze는 실시간 메시지 결정·발송이라 다운타임이 곧 메시지 지연이다.
- 데이터 손실 없는 롤백. Kubernetes 쪽이 마음에 안 들면 EC2로 되돌아갈 수 있어야 하고 그때 Kubernetes에서 쓴 데이터가 사라지면 안 된다.

두 번째가 첫 번째보다 훨씬 까다롭습니다. **되돌아갈 때 손실이 없으려면 EC2 쪽이 Kubernetes 쪽 쓰기를 계속 받고 있어야 하기 때문입니다.**

| 안 | 방식 | 무중단 | 무손실 롤백 | 판정 |
|---|---|---|---|---|
| 1 | RDB 스냅샷 복사 — EC2 primary의 RDB를 파드 볼륨으로 복사해 로드 | ✗ | ✅ | **부적합** |
| 2 | 내부 replication만 — 파드가 EC2 primary를 복제하고 Sentinel이 failover | ✅ | ✗ | **부적합** |
| 3 | **NLB 경유 양방향 replication** | ✅ | ✅ | **채택** (복잡함이 대가) |

**안 1이 깨지는 이유는 복사 시간이 아니라 일관성입니다.** RDB를 복사하는 동안 클라이언트가 계속 쓰면 복사본이 낡습니다. 그래서 복사 중에는 클라이언트를 멈춰야 하고 그 멈춤이 곧 다운타임입니다. 발표자는 이걸 인디아나 존스가 황금상을 모래주머니로 바꿔치기하다 1초 차이로 실패하는 장면에 빗댑니다 — 요구사항이 "짧은 다운타임"이 아니라 "무중단"인 이상 아무리 짧아도 통과가 안 됩니다.

**안 2가 깨지는 이유가 정확히 §2.3입니다.** 파드는 VPC에 닿을 수 있으므로 EC2 primary를 복제하는 방향은 됩니다. Sentinel이 failover를 조율해 파드를 primary로 승격시키는 것도 됩니다. 여기까지는 무중단이 성립합니다. 그런데 **승격 직후 EC2 쪽이 새 primary를 복제하려 하면 그 주소가 ClusterIP라 닿지 않습니다.** 그 순간부터 EC2는 데이터 갱신이 멈춘 낡은 사본이 되고 롤백은 그 시점 이후 쓰기를 전부 버리는 일이 됩니다.

**안 2와 안 3을 가르는 건 오직 "복제가 되돌아올 수 있는가" 하나입니다.**

## 4. 채택안 — L4를 클러스터 밖으로 빼기

관건은 EC2 primary가 클러스터 안쪽 파드에 닿게 만드는 것입니다. 발표자의 한 줄이 열쇠입니다.

> The Redis protocol operates on layer four, right? So, what we need is some routing infrastructure that sits outside the cluster and then routes it to the Kubernetes pods. — 11:38~11:47

RESP는 L7 HTTP가 아니라 **평범한 TCP 스트림**입니다. 그러면 [NLB](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html)를 쓸 수 있습니다 — NLB는 OSI 4계층에서 동작하고 TCP 연결 하나는 flow hash로 정해진 타깃에 그 연결 수명 내내 고정됩니다. 복제 링크처럼 오래 살아 있는 단일 TCP 연결에 정확히 맞는 성질입니다.

구성은 세 겹입니다.

- 파드별 Service에 nodePort를 준다: server `31000`, sentinel `31001`. 같은 샤드의 다음 파드가 `31002/31003`, 그다음이 `31004/31005`로 이어진다([기본 nodePort 범위](https://kubernetes.io/docs/concepts/services-networking/service/)가 30000–32767이니 전부 그 안이다).
- NLB에 리스너를 연다: server `6380`, sentinel `26380`. 타깃 그룹은 클러스터의 전 노드이고 위 nodePort를 향한다. 파드가 어느 노드에 있든 kube-proxy가 알아서 넘겨 주므로 타깃 목록이 파드 스케줄링을 따라다닐 필요가 없다.
- 서버와 sentinel이 자기 주소를 NLB 주소로 광고한다.

```conf
# server.conf
replica-announce-ip    10.1.1.100
replica-announce-port  6380

# sentinel.conf
announce-ip            10.1.1.100
announce-port          26380
```

{{< flow src="_flow/4-nlb-경유-복제.json" />}}

슬라이드 33쪽을 보면 이 쌍이 파드마다 따로 붙습니다 — `10.1.1.100:6380/26380`(nodePort 31000/31001), `10.1.1.200:6381/26381`(31002/31003), `10.1.1.300:6382/26382`(31004/31005). **파드 하나당 외부 주소 하나가 대응해야 Sentinel이 셋을 구분할 수 있기 때문입니다.**

### 4.1 3단계

Helm 차트에 "migration mode"를 넣어 단계를 값으로 넘겼습니다.

| 단계 | 하는 일 | 이 시점의 primary |
|---|---|---|
| **Setup** | 파드·Service·NLB 생성. 파드가 NLB 주소로 광고하고 **EC2 primary를 복제** | EC2 |
| **Migrate** | 사전 헬스체크 통과 후 failover 실행. **파드가 primary로 승격**되고 EC2가 NLB를 통해 역복제 | Kubernetes |
| **Remove NLB** | 전 클라이언트가 넘어온 뒤 **내부 ClusterIP 광고로 전환**, EC2와 NLB 제거 | Kubernetes |

**Remove NLB 단계의 순서가 중요합니다.** ClusterIP 광고로 바꾸는 순간 EC2는 아무것도 못 하게 되므로 EC2를 먼저 걷고 → 광고를 바꾸고 → 그다음 NLB를 걷습니다. 순서를 뒤집으면 EC2가 낡은 상태로 살아남아 롤백 경로가 조용히 망가집니다.

### 4.2 승격 대상은 아무 파드나가 아니다

failover로 승격시킬 파드는 **기존 EC2 primary와 같은 AZ에 있는 파드**를 고릅니다(15:51~15:58). 이유는 성능이 아니라 청구서입니다 — AWS의 [리전 내 cross-AZ 전송은 방향마다 GB당 $0.01](https://aws.amazon.com/blogs/networking-and-content-delivery/optimizing-data-transfer-costs-when-using-aws-network-load-balancer)이라 왕복이면 $0.02/GB입니다.

**이 선택은 이관 기간에만 드는 비용을 정하는 게 아니라 영구 비용을 정합니다.** 다른 AZ 파드를 승격시키면 그 샤드의 이후 모든 복제 트래픽에 cross-AZ 요금이 붙습니다. 이관 스크립트의 한 줄짜리 판단이 그 샤드의 수명 전체에 요금을 새깁니다.

(전사에는 "at Redis, we use a lot of AZ affinity"로 나오는데 **자동자막 오인식**이고 "at Braze"가 맞습니다.)

### 4.3 사전 헬스체크 — 플랫폼만 바뀌어야 한다

이관은 사람이 아니라 스크립트가 돌렸고, 실행 전에 세 가지를 양쪽에서 비교했습니다.

- 정상 replica 개수
- Sentinel 개수
- config가 양쪽에서 동일한지

원칙은 발표자가 15:19에 한 줄로 말합니다.

> when you're re-platforming, you want the only thing to have changed between those two to be the actual platform in itself

이 규칙이 이 발표에서 가장 이식성이 높은 조언입니다. re-platforming 중에 "이왕 하는 김에" 파라미터를 손대면, 뒤에 문제가 생겼을 때 원인이 플랫폼인지 설정인지 영영 못 가릅니다. §7에서 볼 90%/15%/5% 수치가 의미를 갖는 이유도 정확히 여기 있습니다 — like-for-like config였기 때문에 엔진 차이로 귀속시킬 수 있습니다.

## 5. 이관 중에만 존재하는 위험 둘

발표자는 "예상 못 한 것이 너무 많아 다 못 말한다"며 둘만 골랐습니다(17:06~17:16). 둘 다 정상 상태에는 없고 이관 창(window) 안에만 존재하는 위험이라는 공통점이 있습니다.

### 5.1 NLB 데이터 전송비 — 월 $100,000

Prometheus로 실제 read·write·replication 트래픽을 재서 NLB를 상시 유지할 때의 비용을 산정했고, 월 $100,000 이상이 나왔습니다(17:45~17:53). 그래서 NLB는 임시 장치가 될 수밖에 없었고, 모든 클라이언트가 Kubernetes로 넘어간 뒤에야 내부 ClusterIP 광고로 전환하고 NLB를 걷었습니다.

발표는 계산 과정을 공개하지 않습니다. 그러면 이 숫자가 그럴듯한지 직접 검산해 보면 됩니다. 재료는 [ELB 요금표](https://aws.amazon.com/elasticloadbalancing/pricing/)에 다 있습니다.

| 요금 항목 | 값 |
|---|---|
| NLB 기본 | **$0.0225 / LB-hour** |
| 사용량 | **$0.006 / NLCU-hour** |
| TCP에서 1 NLCU가 덮는 양 | 신규 연결 800/sec · 활성 연결 100,000 · **처리 바이트 1GB/hour** |

NLCU는 세 차원 중 그 시간에 가장 큰 것으로 청구됩니다. Braze 구성에서 어느 차원이 지배적인지부터 확인하겠습니다.

- 활성 연결로 $100,000를 채우려면 시간당 약 22,800 NLCU가 필요하고, 그건 활성 연결 22억 8천만 개를 뜻한다. 불가능하다.
- 신규 연결로 채우려면 초당 1,800만 건의 새 연결이다. 역시 불가능하다.
- 따라서 처리 바이트가 지배한다. 실효 단가는 GB당 약 $0.006이다.

이제 역산합니다.

| 단계 | 계산 | 결과 |
|---|---|---|
| 월 전송량 | $100,000 ÷ $0.006/GB | **약 16.7PB/월** |
| 시간당 | 16,700,000GB ÷ 730h | 약 **22,900GB/hour** |
| 초당 | ÷ 3,600 | 약 **6.3GB/sec** ≈ **51Gbps** |
| 연산당 바이트 | 6.3GB/s ÷ 36M ops/s | **약 176B / op** |
| 샤드당 | 6.3GB/s ÷ 581 | 약 **10.9MB/s** ≈ **87Mbps** |

여기서 replication fan-out을 넣어야 payload 크기가 나옵니다. Kubernetes 샤드는 primary 1 + replica 2이므로, 쓰기 하나가 NLB를 건너는 횟수가 1회(클라이언트→primary)가 아니라 최대 3회(+ replica 2개로 가는 복제)입니다.

| 가정 | NLB 통과 배수 | 함의되는 payload |
|---|---|---|
| 전부 쓰기, replica 2개 | ×3 | 약 **59B / 연산** |
| 읽기·쓰기 5:5, replica 2개 | ×2 | 약 **88B / 연산** |
| 전부 읽기(복제 없음) | ×1 | 약 **176B / 연산** |

$100,000는 부풀린 숫자가 아닙니다. rate limiting(`INCR`), distributed lock(`SET NX`), dedup 같은 워크로드는 값이 카운터나 플래그라서 커맨드·키 이름을 포함해도 수십~수백 바이트입니다. 위 표의 어느 행이든 그 범위 안에 정확히 들어옵니다. 오히려 보수적일 수 있습니다 — NLB 개수만큼 붙는 $0.0225/LB-hour(월 $16.4)는 위 계산에 안 들어갔고, 샤드마다 NLB를 뒀다면 581대 × $16.4 = 월 약 $9,500이 별도로 얹힙니다.

{{< callout type="warning" >}}
위 검산이 세운 가정을 그대로 밝힙니다. 발표는 payload 크기도, 읽기/쓰기 비율도, NLB를 몇 대 뒀는지도 말하지 않았습니다.

- payload 크기는 미상이다. 위 표는 세 시나리오로 범위만 잡았다.
- 읽기가 NLB를 통과하는지도 미상이다. 클라이언트가 아직 EC2에 있던 구간에서는 통과하지만, Kubernetes로 넘어간 클라이언트는 통과하지 않는다. 비율을 알 수 없다.
- 581샤드 전체가 동시에 이관 상태였던 것은 아니다. 발표자의 표현은 "NLB로 데이터를 무기한 흘렸을 때"의 정상 상태 추정이므로 전 샤드 기준으로 읽었지만, 그게 그의 산정 방식이었는지는 확인하지 못했다.
- replica 개수는 Kubernetes 쪽 2개를 썼다. 이관 중에는 EC2 쪽 replica도 살아 있어 실제 fan-out이 더 클 수 있다.

이 검산은 "$100,000가 정확하다"를 증명하지 않습니다. "36M ops/sec 규모에서 그 자릿수가 나오는 게 자연스럽다"까지만 말합니다.
{{< /callout >}}

### 5.2 Sentinel split brain

이관 중에는 한 샤드를 Sentinel 6대가 감시합니다 — 레거시 cluster-scoped 3대와 파드 사이드카 3대입니다. 여기서 두 플랫폼 사이의 연결이 끊기면 무슨 일이 생기나요?

발표자의 설명은 이렇습니다 — 각 진영 3대가 primary가 안 보인다고 판단하고 자기들끼리 failover를 결의합니다(18:22~18:40). 결과는 한 샤드에 primary 두 개입니다. [Sentinel 문서](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)가 그 결말을 그대로 적어 뒀습니다.

> we created two masters ... in a perfectly symmetrical way. Clients may write indefinitely to both sides

대칭이 문제입니다. 보통 split brain은 "소수파 쪽이 아무것도 못 한다"로 막힙니다 — 문서도 "Sentinel never performs a failover in the partition where a minority of Sentinels exist"라고 적습니다. 그런데 6대를 3:3으로 가르면 어느 쪽도 소수파가 아닙니다.

{{< callout type="warning" >}}
단, 발표자가 말한 위험과 Sentinel 문서의 메커니즘이 정확히 맞물리지는 않습니다. 문서는 failover 실행에 감지 quorum과 별개로 "authorization to a majority of Sentinels"를 요구합니다 — 6대의 과반은 4이므로, 3:3 분할이면 문서대로는 양쪽 다 승격을 못 해야 합니다. 이관 전 quorum 값이 얼마였는지도 발표·슬라이드 어디에도 없습니다(전사 18:55는 "updated the quorum Sentinel to be five"까지만 말합니다).

그래도 대응 자체는 정당합니다. 두 진영이 파티션 동안 서로를 sentinel 집합의 구성원으로 계속 세느냐에 따라 과반 계산이 갈리고, 그 상태를 이관 창 안에서 확신할 방법이 없습니다. 아래 수는 그 불확실성을 지우는 쪽에 건 것입니다.
{{< /callout >}}

해법은 두 수를 같이 두는 것입니다.

1. EC2 쪽에 7번째 Sentinel을 이관 기간에만 띄운다 → 6대의 대칭이 4:3으로 깨진다.
2. quorum을 5로 올린다 → 4도 3도 통과하지 못한다.

quorum 5가 왜 특별한지는 산수로 확인됩니다. 7의 단순 과반은 4입니다. Sentinel 문서는 quorum을 과반보다 크게 잡았을 때의 효과를 명시합니다.

> If a quorum is set to a value greater than the majority of Sentinels, we are making Sentinel able to failover only when there are a very large number (larger than majority) of well connected Sentinels which agree about the master being down.

즉 quorum 5는 "과반"이 아니라 "절대 과반"을 요구합니다. 파티션이 어떻게 그어지든 한 조각이 5대를 모으려면 반대편이 최대 2대여야 하고, EC2 4 / k8s 3 구성에서는 그런 분할이 나오지 않습니다.

{{< seq src="_seq/5-2-sentinel-split-brain.json" />}}

대가도 정확히 알고 썼습니다. quorum 5는 감지를 둔하게 만듭니다 — 진짜 장애가 났는데 sentinel 3대만 그걸 봤다면 failover가 안 일어납니다. 발표자가 그 절충을 밝힙니다: "if it so happened that it was at a time when we weren't monitoring it"(19:05~19:11). 사람이 지켜보는 동안에는 수동 개입이 가능하니, 자동 failover의 민감도를 낮추고 split brain을 확실히 막는 쪽을 택했습니다. 이관 기간에만 유지하는 설정이기에 성립하는 선택입니다.

## 6. Valkey 이관은 두 줄이었다

Kubernetes 이관은 **2023-02 ~ 2024-05**에 걸쳐 **274샤드 / 7클러스터 / 데이터 손실 0**으로 끝났습니다(무대에서는 "nearly 300"). 그 위에서 Valkey 전환이 시작됩니다.

배경부터 정확히 적어 둘 게 있습니다. [Redis 라이선스 변경](https://redis.io/blog/redis-adopts-dual-source-available-licensing/)은 2024-03-20 발표됐고 KubeCon Paris(2024-03-19~22) 회기 중이었습니다 — 발표자는 현장에 있었고 "another rug pull"이라는 표현을 씁니다. 8일 뒤 [Linux Foundation이 Valkey를 출범](https://www.linuxfoundation.org/press/linux-foundation-launches-open-source-valkey-community)시켰습니다. **포크 기준점이 Redis 7.2.4인데, 그게 정확히 Braze가 돌리던 태그입니다.**

> Braze wasn't directly impacted by the license change. But, we wanted to continue going where the community was going. — 20:09~20:17

**즉 라이선스가 강제한 이관이 아닙니다.** 이 구분이 중요한 건 강제 이관이었다면 "어쩔 수 없이 했다"로 끝나지만 자발적 이관이면 **얻는 게 있어야 정당화되기 때문**입니다. 그 정당화가 §7의 숫자입니다.

바꾼 것은 딱 둘입니다. 하나는 시작 명령을 이미지에서 유도하는 helm 템플릿 함수입니다.

```gotemplate
# _helpers.tpl
{{/*
Function to determine what flavor of Redis we are deploying out (Redis/Valkey)
*/}}
{{- define "redis-ha.flavor" -}}
{{ regexFind "[^/]+$" . }}
{{- end -}}

# statefulset.yaml
containers:
  - name: server
    image: {{ $.Values.image.repository }}:{{ $.Values.image.tag }}
    imagePullPolicy: {{ $.Values.image.pullPolicy }}
    command:
    - {{(include "redis-ha.flavor" $.Values.image.repository)}}-server
```

`regexFind "[^/]+$"`가 repository 문자열의 마지막 경로 조각을 뽑습니다 — `redis` → `redis`, `valkey/valkey` → `valkey`. 거기에 `-server`를 붙이면 `redis-server` / `valkey-server`가 됩니다. 나머지 하나는 values 두 줄입니다.

```yaml
# From                        To
image:                        image:
  repository: redis             repository: valkey/valkey
  tag: 7.2.4-alpine             tag: 8.1.1-alpine
```

**config는 한 줄도 안 고쳤습니다.** Valkey가 Redis 설정과 완전 하위호환이기 때문이고, Sentinel 쪽도 마찬가지입니다 — [Valkey는 Sentinel 문서를 직접 유지](https://valkey.io/topics/sentinel/)하며 `announce-ip`/`announce-port`를 포함해 Braze가 의존하던 지시어가 그대로 있습니다. 참고로 [8.1.1](https://github.com/valkey-io/valkey/releases/tag/8.1.1)은 2025-04-23 릴리스이고 urgency가 SECURITY입니다 — CVE-2025-21605(미인증 클라이언트 출력 버퍼 제한)를 포함한 버그 수정 11건짜리 패치 릴리스입니다.

| 이관 | 기간 | 샤드 | 클러스터 |
|---|---|---|---|
| EC2 → Kubernetes | 2023-02 ~ 2024-05 (약 15개월) | 274 | 7 |
| Redis → Valkey | **6주** | **350** | **10** |

**이 대비가 이 발표의 진짜 결론입니다.** 같은 회사가 더 커진 규모(274 → 350샤드)를 15개월이 아니라 6주에 옮겼습니다. 발표자는 그 원인을 Valkey가 아니라 **플랫폼**에 돌립니다 — "all thanks to the velocity that Kubernetes allowed us to move at". 첫 이관이 사 준 것은 성능이 아니라 **두 번째 이관의 비용**이었습니다.

## 7. 90%를 어떻게 읽을 것인가

{{< callout type="warning" >}}
**슬라이드 26쪽에는 "90% p95 latency improvement" 한 줄만 있습니다.** 다른 수치도, 조건도, 범위도 없습니다. 이 슬라이드만 보고 인용하면 **발표자 본인이 무대에서 곧바로 정정한 주장**을 하게 됩니다.
{{< /callout >}}

발표자는 90%를 띄운 직후 스스로 범위를 좁힙니다 — "that's the headline figure. That's like the best case. What did we just see on average?"(22:43~22:49). 전사 22:12~23:44을 그대로 펼치면 층이 셋입니다.

| 구간 | 개선 | 범위 |
|---|---|---|
| p95 — **최선값** | **90%** | busiest cluster **한 곳의 한 type** |
| p95 — 전체 평균 | **15%** | 전 클러스터 · 전 type |
| p50 | **5%** | 전 클러스터 · 전 type |

**90%와 15%의 거리는 6배입니다.** 이건 반올림 차이가 아니라 "가장 좋았던 한 곳"과 "평균"의 차이입니다. 두 수치를 바꿔치기하면 용량 계획이 통째로 틀어집니다. 자기 환경에 기대치를 잡을 때 쓸 숫자는 **15%와 5%**입니다.

### 7.1 그래도 5%를 무시하면 안 되는 이유

발표자의 반론에도 값어치가 있습니다. p50 5%를 "modest gains"라고 스스로 인정한 뒤 이렇게 잇습니다.

> remember the scale that Braze runs at is in the billions. In fact ... we're running in the trillions now. So, that 5% increase is multiplied over and over and over again. — 23:23~23:41

숫자가 뒷받침합니다. Braze의 [2024년 API 호출은 8.6조 건](https://www.braze.com/resources/articles/2024-how-braze-powered-exceptional-marketing-at-scale)입니다. **p50이 5% 빨라진다는 건 "거의 모든 요청이 조금씩 빨라진다"는 뜻입니다.** 조 단위에서는 그 합이 p95 꼬리 개선보다 총 대기시간을 더 많이 줄입니다. 꼬리 개선은 소수 요청에만 적용되기 때문입니다.

**두 숫자는 서로 다른 질문에 답한다.** p95 15%는 "최악의 경험이 얼마나 나아지나", p50 5%는 "시스템 전체가 얼마나 가벼워지나"다.

### 7.2 이 숫자가 귀속시키는 것과 안 시키는 것

**격리 조건이 좋습니다.** Redis 7.2.4 → Valkey 8.1.1이고 config는 한 줄도 안 바뀌었으며(§6), 플랫폼은 이미 1년 전에 Kubernetes로 옮겨 안정화된 뒤였습니다. 발표자도 "this is on a like-for-like configuration"이라고 못박습니다(22:36~22:39).

| 이 숫자가 귀속시키는 것 | 귀속시키지 않는 것 |
|---|---|
| **엔진 버전 차이** — 7.2.4 → 8.1.1 | Kubernetes 이관 효과. 그건 1년 전에 이미 끝났다 |
| 같은 config·같은 하드웨어 조건에서의 델타 | Valkey 전반의 성능 주장. **한 조직·한 워크로드 조합**의 관측이다 |
| 실운영 트래픽 하에서의 관측 | 원인. 무엇이 빨라졌는지(IO threading? 메모리 레이아웃?) 발표는 말하지 않는다 |

**공개된 데이터셋이 없다는 게 이 수치의 가장 큰 약점입니다.** 어떤 type이었는지, 표본 구간이 얼마인지, 비교 기준선을 어떻게 잡았는지 아무 자료도 없습니다. 그래서 이 문서는 **90/15/5를 "Braze가 관측했다고 보고한 값"으로 다루지 재현 가능한 벤치마크로 다루지 않습니다.**

## 8. 다음 과제

발표자가 밝힌 현재 미해결 문제 셋입니다. 셋 다 Braze만의 문제가 아니라 **Kubernetes에서 stateful을 굴리면 공통으로 만나는 것**이라 그대로 옮겨 옵니다.

### 8.1 bin-packing — 원하는 규칙을 표현할 프리미티브가 없다

**primary들이 한 노드에 몰린다.** 스케줄러 입장에서 그 파드들은 전부 똑같은 파드라 노드를 고르게 채우기만 하면 되고 그 결과 primary 셋이 한 노드에 앉는 배치가 아무렇지 않게 나온다(슬라이드 29쪽).

primary가 replica보다 훨씬 바쁘므로 결과는 hot node입니다 — CPU 편중, 대역폭 편중, 그리고 AWS에서는 **네트워크 상한**에 걸립니다. 발표자가 무대에서 이름을 더듬은 그 지표는 [ENA의 `bw_in_allowance_exceeded` / `bw_out_allowance_exceeded`](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/monitoring-network-performance-ena.html)입니다 — "the number of packets queued or dropped because the inbound aggregate bandwidth exceeded the maximum for the instance". **초과분은 에러가 아니라 큐잉과 드롭으로 나타납니다.** 애플리케이션에는 지연과 재전송으로만 보이므로 이 카운터를 안 보면 원인을 영영 못 찾습니다. `ethtool -S eth0`로 읽고 Linux에서는 ENA 드라이버 2.2.10 이상이 필요합니다(발표는 이 조건을 언급하지 않습니다).

원하는 규칙은 명확합니다 — **"Sidekiq 샤드의 primary가 한 노드에 2개를 넘지 않게"**(전사의 "psychic shard"는 오인식이고 Sidekiq입니다). 후보 프리미티브가 둘 있는데 **둘 다 이 문장을 표현하지 못합니다.**

| 프리미티브 | 표현할 수 있는 것 | 이 요구와 어긋나는 지점 | 판정 |
|---|---|---|---|
| [pod anti-affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#inter-pod-affinity-and-anti-affinity) | `topologyKey: kubernetes.io/hostname`으로 **노드당 정확히 1개** | "최대 N개" 모드가 **없다**. 2를 표현하려면 라벨 그룹을 미리 쪼개는 비공식 우회가 필요하다 | **부적합** |
| [topologySpreadConstraints](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/) | `maxSkew`로 도메인 간 **상대적 균등** | `maxSkew`는 "전역 최소값과의 허용 차이"지 **절대 상한이 아니다**. 노드가 줄면 균등한 채로 노드당 개수가 올라간다 | **반쪽** |

**그런데 진짜 장벽은 표현력이 아닙니다.** 둘 다 **스케줄링 시점** 제약이라는 게 문제입니다.

Braze 토폴로지에서 어느 파드가 primary인지는 **Sentinel이 런타임에 선출합니다.** 파드 셋은 동일한 StatefulSet에서 나왔고 스케줄 시점에는 역할이 정해져 있지도 않습니다. failover가 한 번 일어나면 재스케줄링 없이 primary가 다른 파드로 옮겨 가고 **그 순간 어떤 스케줄링 제약도 다시 평가되지 않습니다.** anti-affinity는 `requiredDuringScheduling**IgnoredDuringExecution**`이라 이름에 이미 그렇게 적혀 있습니다.

여기에 규모 문제가 겹칩니다. Kubernetes 문서가 anti-affinity에 명시적 경고를 답니다.

> Inter-pod affinity and anti-affinity require substantial amounts of processing which can slow down scheduling in large clusters significantly. We do not recommend using them in clusters larger than several hundred nodes.

581샤드 × 파드 3개 = 약 1,743파드입니다. **문서가 권하지 말라는 규모에 정확히 들어와 있습니다.**

**판정: 스케줄링 제약으로 표현할 수 있는 종류가 아닙니다.** 둘 중에서는 topologySpreadConstraints가 낫지만 그건 개수를 세기는 한다는 이유뿐입니다. primary 역할이 런타임에 이동하는 이상 이걸 유지하려면 **failover를 관측하고 배치를 사후 교정하는 컨트롤러**가 있어야 합니다 — 즉 §8.3의 operator나 descheduler 계열입니다. 발표자가 이 문제를 "다음 과제"로 남겨 둔 것 자체가 그 결론과 일치합니다.

### 8.2 vertical autoscaling — 발표자의 말은 문자 그대로 맞았다

Braze는 상시 스케일 인/아웃합니다("발표하는 동안에도 100번쯤 했을 것", 25:30). 그런데 Valkey는 정적으로 돌고 있어 노드에 여유가 있으면 **파드를 재생성하지 않고 컨테이너 자원을 늘리고 싶다**는 게 요구입니다.

발표자의 문장은 이랬습니다 — "the vertical pod auto scaler ... has taken on the in-place pod resizer to now be graduated to stable in the last Kubernetes version"(25:55~26:05). 무대에서 더듬으며 말한 문장이라 검증 대상으로 잡았는데 **두 갈래 모두 사실이었습니다.**

| 트랙 | 사건 | 날짜 |
|---|---|---|
| Kubernetes 코어 | [KEP-1287](https://github.com/kubernetes/enhancements/blob/master/keps/sig-node/1287-in-place-update-pod-resources/README.md) alpha 1.27 → beta 1.33 → **GA 1.35** | 1.35 릴리스 **2025-12-17** |
| VPA | `InPlaceOrRecreate` alpha 1.4.0 → beta 1.5.0 → **GA [vertical-pod-autoscaler-1.6.0](https://github.com/kubernetes/autoscaler/releases/tag/vertical-pod-autoscaler-1.6.0)** | **2026-02-12** |

발표는 2026-03-26이고 1.36은 아직 안 나왔습니다. **"last Kubernetes version"은 문자 그대로 정확합니다.** VPA 쪽 GA는 발표 약 6주 전이니 "over the last few months"도 맞습니다. 두 릴리스 트레인이 별개라는 걸 아는 상태에서 한 문장으로 압축한 셈인데, 무대에서 한 축약치고 정확도가 높습니다.

**GA에서만 열린 능력이 하나 있는데 Braze의 용례에 직결됩니다** — [메모리 limit **감소**](https://kubernetes.io/blog/2025/12/19/kubernetes-v1-35-in-place-pod-resize-ga)입니다. beta는 이걸 금지했습니다. 캐시를 워크로드에 맞춰 **키웠다가 다시 줄여야 하는데** 감소 방향이 없으면 반쪽입니다. 늘리기만 되는 오토스케일링은 오토스케일링이 아니라 사다리입니다.

경계도 같이 봐야 합니다. KEP-1287이 바꿀 수 있게 허용하는 건 `.spec.containers[*].resources`의 **cpu·memory뿐**이고 `resize` 서브리소스로만 가능하며, **QoS class를 바꾸는 변경은 전부 거부**됩니다. 이 레포에 이 기능만 파고든 문서가 따로 있습니다 — [k8s-features 01 In-Place Pod Resize]({{< relref "../../../k8s-features/01-inplace-pod-resize.md" >}}). 거기 결론 중 Braze 용례에 그대로 걸리는 것 둘: **늘리는 방향은 사실상 무위험이고 줄이는 방향만 조심하면 된다**는 것, 그리고 **재시작이 비싼 stateful에 가장 잘 맞는다**는 것입니다. Valkey 파드는 재시작이 곧 데이터 재동기화이므로 정확히 그 케이스입니다.

### 8.3 valkey-operator — 아직 아니다

발표자가 참여 중인 [valkey-io/valkey-operator](https://github.com/valkey-io/valkey-operator)는 여러 회사가 모인 community-led 프로젝트입니다. 슬라이드 31쪽의 지원 예정 모드가 넷입니다.

| 모드 | Braze와의 관계 |
|---|---|
| Cluster | AWS 발표가 다룬 그것 |
| Standalone | — |
| HA-replication (Operator / Sentinel) | 지금의 Sentinel 구성에 대응 |
| **Cells (non-clustered)** | **발표자가 "오늘 설명한 토폴로지가 바로 이것"이라고 말한 모드** |

로드맵에는 autoscaling · cluster resharding · plugins가 있습니다.

**판정은 자매 챕터와 같습니다 — 지금 도입할 것은 아닙니다.** README가 "This operator is in active development and **not ready for production use**"라고 못박고 API가 `v1alpha1`입니다.

한 가지 더 밝혀 둡니다. **Cells 모드는 슬라이드에만 있습니다.** 레포의 `docs/architecture.md`를 직접 받아 확인했으나 "Cells"라는 단어도, 모드 열거 자체도 없습니다. 인용할 거면 **repo 문서가 아니라 슬라이드 31쪽을 근거로 대야 합니다.**

## 9. 우리가 가져갈 것

| 항목 | 판정 | 이유 |
|---|---|---|
| **re-platforming 중엔 플랫폼만 바꿔라** | **필수** | 규모 무관. 이걸 지켜야 나중의 성능 델타를 무언가에 귀속시킬 수 있다(§7.2) |
| **롤백 요구사항을 무중단과 따로 적어라** | **필수** | 안 2가 무중단은 만족하고 롤백에서 탈락했다. 둘을 한 줄로 뭉치면 이 실패를 설계 단계에서 못 잡는다 |
| **파드 IP에 의존하는 컴포넌트를 먼저 찾아라** | **필수** | Sentinel만의 문제가 아니다. IP로 멤버십을 추적하는 모든 것(코디네이터·레지스트리·복제 링크)이 파드 롤에 깨진다 |
| announce 지시어로 논리 주소를 강제 | **좋음** | NAT·Docker용 기능이지만 Kubernetes 파드 IP 문제에 그대로 쓰인다. `replica-announce-*` / `sentinel announce-*` |
| **임시 인프라의 상시 비용을 먼저 계산하라** | **좋음** | NLB를 걷을 시점이 아니라 **NLB를 세울 때** 나왔어야 하는 계산이다. 임시로 세운 것이 눌러앉는 게 기본값이다 |
| 정족수 구성원 수가 바뀌는 창을 세라 | **좋음** | 이관 중 sentinel 6대는 "일시적"이지만 그 창 안에서 대칭 split brain 위험이 생긴다. **일시적이라는 게 안전을 뜻하지 않는다** |
| 파드별 Service로 고정 ClusterIP | **반쪽** | 581샤드면 Service가 1,743개다. 규모가 크면 Service·Endpoint 오브젝트 수가 컨트롤 플레인 부담이 된다 |
| NLB 경유 양방향 replication | **Braze 고유** | 클라이언트가 여러 플랫폼에 흩어져 있고 롤백 요구가 절대적일 때만 값어치가 있다. 클라이언트를 먼저 다 옮길 수 있으면 안 2로 충분하다 |
| 90% / 15% / 5% 수치 | **인용 주의** | 공개 데이터셋이 없다. 자기 환경 기대치는 15%·5% 쪽으로 잡아라 |
| valkey-operator | **아직 없음** | `v1alpha1` · "not ready for production use" |

**세 문장으로 줄이면.**
Braze의 이관을 어렵게 만든 건 Redis도 Kubernetes도 아니라 **ClusterIP가 클러스터 밖에서 안 보인다는 한 가지 사실**이었고 해법은 RESP가 L4라는 성질을 이용해 **논리 주소를 NLB 주소로 거짓말시키는 것**이었습니다 — 무중단보다 무손실 롤백이 훨씬 비싼 요구였습니다.
이관 중에만 존재하는 위험 둘(월 $100,000 전송비, sentinel 6대 대칭 split brain)은 **정상 상태 설계를 아무리 잘해도 안 잡히는 종류**이고 창의 길이가 아니라 창 안의 구성원 수를 세야 보입니다.
슬라이드에 크게 박힌 **90%는 최선값 하나**입니다 — 발표자 본인이 무대에서 전체 평균 p95 15% · p50 5%를 덧붙였으니 90%만 떼어 인용하면 발표자가 하지 않은 주장을 하는 것입니다.

## 10. 확인하지 못한 항목

{{< callout type="warning" >}}
아래는 이 문서가 확인하지 못했거나 1차 문서와 어긋나는 지점입니다. 인용할 때 그대로 밝혀야 합니다.

- 월 $100,000는 Braze 내부 추정치이고 산정 방법이 공개되지 않았다. §5.1의 검산은 이 문서가 [공개 ELB 요금표](https://aws.amazon.com/elasticloadbalancing/pricing/)로 자릿수만 맞춰 본 것이고 payload 크기·읽기/쓰기 비율·NLB 대수·이관 동시성은 **전부 이 문서의 가정**이다. 발표는 넷 중 어느 것도 말하지 않는다.
- 90 / 15 / 5 수치의 데이터셋이 없다. 어떤 type인지, 표본 구간이 얼마인지, 기준선을 어떻게 잡았는지 공개된 자료가 없다. 재현 가능한 벤치마크가 아니라 **보고된 관측값**으로 다뤄야 한다.
- 581이라는 샤드 수가 현재값인지 확인하지 못했다. 슬라이드 5쪽 수치이고 발표자는 "just this month, we have about 600"이라 말한다. 기준일 표기가 없다.
- Braze 회사 수치의 기준 시점이 슬라이드 표기와 어긋난다. MAU 69억은 [2024-10-31 기준](https://www.braze.com/resources/articles/2024-how-braze-powered-exceptional-marketing-at-scale)인데 슬라이드는 전 수치를 "As of January 31, 2025"로 묶었고 "over $130M R&D expense in 2024"에 대응하는 [공시치 $133.969M](https://investors.braze.com/news/news-details/2025/Braze-Reports-Fiscal-Year-and-Fourth-Quarter-2025-Results/default.aspx)은 역년 2024가 아니라 FY2025(2024-02~2025-01) 값이다. 액수 자체는 "over $130M"에 부합한다.
- 이관 전 Sentinel quorum 값을 확인하지 못했다. 발표·슬라이드는 "5로 올렸다"만 말한다. §5.2의 3:3 대칭 split brain은 발표자의 설명을 옮긴 것이고 Sentinel 문서가 요구하는 "majority authorization"과는 계산이 맞지 않는다는 점을 같은 절에 밝혀 뒀다.
- 발표자의 [Velero 블로그](https://www.braze.com/resources/articles/faster-cheaper-more-dependable-how-braze-uses-velero-to-power-backup-stateful-services-in-kubernetes)는 이관 후 토폴로지를 서술한다. "Each shard is managed by a StatefulSet, which creates three pods"는 **Kubernetes 시대**의 배치이고, EC2 시대는 BGSAVE→S3 백업 흐름만 다룬다. 581샤드 수치도, 클라이언트 해싱 서술도 이 글에는 없다 — 그 둘의 근거는 발표와 슬라이드뿐이다.
- valkey-operator의 "Cells" 모드는 슬라이드 31쪽에만 있다. 레포 `docs/architecture.md`를 직접 확인했으나 "Cells"도 모드 열거도 없다. repo 문서를 근거로 인용하면 안 된다.
- NLB를 샤드당 뒀는지 클러스터당 뒀는지 확인하지 못했다. 슬라이드 33쪽은 한 샤드에 NLB 하나가 붙은 그림이지만 설명 도식일 수 있다. §5.1의 LB-hour 추가분 계산이 이 값에 달려 있다.
- 이관 스크립트가 config 동일성을 어떤 범위로 비교했는지 알 수 없다. "the config is the same between the two"(15:18)까지만 나온다.
- nodePort 기본 범위는 [Kubernetes 문서](https://kubernetes.io/docs/concepts/services-networking/service/)로 확인했으나 해당 페이지의 `type: NodePort` 절 본문이 fetch에서 온전히 렌더되지 않아 30000–32767 범위는 [포트·프로토콜 레퍼런스](https://kubernetes.io/docs/reference/networking/ports-and-protocols/)로 교차 확인했다.
- §8.1의 판정은 이 문서의 추론이다. "primary 역할이 런타임에 이동하므로 스케줄링 제약으로는 못 잡는다"는 결론은 공식 문서의 개별 사실(anti-affinity가 노드당 1개 · `maxSkew`가 상대값 · `IgnoredDuringExecution` 의미론)을 조합한 것이고 발표자가 이렇게 말한 것은 아니다.
- 전사 오인식 주의. 자동 자막이 Joe Heyburn을 "Joe Hayburn/Joe Haben", Sidekiq을 "psychic", three-phase를 "a free phase", an NLB를 "no network load balancer", Braze를 "Redis"("at Redis, we use a lot of AZ affinity")로 적는다. 전사를 그대로 인용하지 마라.
{{< /callout >}}

## 11. 출처

### 발표

- 발표 영상(CNCF 채널, 28:12) — [youtube.com/watch?v=rNZ6HLiFgYI](https://www.youtube.com/watch?v=rNZ6HLiFgYI)
- 세션 페이지(sched, 초록·발표자·시간·방) — [kccnceu2026.sched.com/event/2CW6D](https://kccnceu2026.sched.com/event/2CW6D/redis-on-ec2-to-valkey-on-kubernetes-a-zero-downtime-case-study-joe-heyburn-braze)
- 슬라이드 원본(PDF 34장 — 581/36M/6.6TiB, announce 블록, 90% 슬라이드, operator 모드 목록) — [hosted-files.sched.co/.../PDF Redis on EC2 to Valkey on Kubernetes.pdf](https://hosted-files.sched.co/kccnceu2026/39/PDF%20Redis%20on%20EC2%20to%20Valkey%20on%20Kubernetes%20-%20%20KubeCon%20EU%202026%20%282%29.pdf)

### Braze · 발표자 글

- 발표자의 Velero 글(Kubernetes 시대 샤드 토폴로지 서술) — [braze.com/resources/articles/faster-cheaper-more-dependable-how-braze-uses-velero...](https://www.braze.com/resources/articles/faster-cheaper-more-dependable-how-braze-uses-velero-to-power-backup-stateful-services-in-kubernetes)
- 2024년 규모 수치(MAU 6.9B는 2024-10-31 기준, API 8.6T, 메시지 3.9T) — [braze.com/resources/articles/2024-how-braze-powered-exceptional-marketing-at-scale](https://www.braze.com/resources/articles/2024-how-braze-powered-exceptional-marketing-at-scale)
- FY2025 4분기 실적 발표(고객 2,296곳, R&D $133.969M) — [investors.braze.com/.../Braze-Reports-Fiscal-Year-and-Fourth-Quarter-2025-Results](https://investors.braze.com/news/news-details/2025/Braze-Reports-Fiscal-Year-and-Fourth-Quarter-2025-Results/default.aspx)
- valkey-helm 메인테이너 목록(jdheyburn @ braze.com) — [github.com/valkey-io/valkey-helm](https://github.com/valkey-io/valkey-helm/blob/main/README.md)

### Sentinel · Valkey 설정

- Redis Sentinel 문서(quorum·split brain·NAT announce·`SENTINEL REPLICAS`) — [redis.io/docs/latest/operate/oss_and_stack/management/sentinel](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)
- Redis 복제 문서(`replica-announce-ip`/`replica-announce-port`, 3.2.2~) — [redis.io/docs/latest/operate/oss_and_stack/management/replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)
- Valkey Sentinel 문서(같은 지시어를 그대로 유지) — [valkey.io/topics/sentinel](https://valkey.io/topics/sentinel/)
- Valkey 8.1.1 릴리스(이관 대상 태그, 2025-04-23, SECURITY) — [github.com/valkey-io/valkey/releases/tag/8.1.1](https://github.com/valkey-io/valkey/releases/tag/8.1.1)

### AWS

- Network Load Balancer 개요(L4·리스너·타깃 그룹·flow hash 고정) — [docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html)
- ELB 요금(NLB $0.0225/LB-hour, $0.006/NLCU-hour, TCP 1NLCU=1GB/hour) — [aws.amazon.com/elasticloadbalancing/pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)
- NLB 데이터 전송비 최적화(cross-AZ 방향당 $0.01/GB) — [aws.amazon.com/blogs/networking-and-content-delivery/optimizing-data-transfer-costs-when-using-aws-network-load-balancer](https://aws.amazon.com/blogs/networking-and-content-delivery/optimizing-data-transfer-costs-when-using-aws-network-load-balancer)
- ENA 네트워크 성능 지표(`bw_in/out_allowance_exceeded`) — [docs.aws.amazon.com/AWSEC2/latest/UserGuide/monitoring-network-performance-ena.html](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/monitoring-network-performance-ena.html)

### Kubernetes

- Service(`type: NodePort`) — [kubernetes.io/docs/concepts/services-networking/service](https://kubernetes.io/docs/concepts/services-networking/service/)
- nodePort 기본 범위 30000–32767 교차 확인 — [kubernetes.io/docs/reference/networking/ports-and-protocols](https://kubernetes.io/docs/reference/networking/ports-and-protocols/)
- Pod Topology Spread Constraints(`maxSkew`는 상대값) — [kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/)
- Inter-pod affinity/anti-affinity(노드당 1개·수백 노드 초과 비권장) — [kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#inter-pod-affinity-and-anti-affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#inter-pod-affinity-and-anti-affinity)
- In-Place Pod Resize GA 발표(1.35, 메모리 limit 감소 허용) — [kubernetes.io/blog/2025/12/19/kubernetes-v1-35-in-place-pod-resize-ga](https://kubernetes.io/blog/2025/12/19/kubernetes-v1-35-in-place-pod-resize-ga)
- KEP-1287(alpha 1.27 → beta 1.33 → stable 1.35, 변경 가능 범위) — [github.com/kubernetes/enhancements/.../1287-in-place-update-pod-resources](https://github.com/kubernetes/enhancements/blob/master/keps/sig-node/1287-in-place-update-pod-resources/README.md)
- VPA `updateMode` 문서(`InPlaceOrRecreate`·`InPlace`) — [kubernetes.io/docs/concepts/workloads/autoscaling/vertical-pod-autoscale](https://kubernetes.io/docs/concepts/workloads/autoscaling/vertical-pod-autoscale/)
- VPA 1.6.0 — `InPlaceOrRecreate` GA(2026-02-12) — [github.com/kubernetes/autoscaler/releases/tag/vertical-pod-autoscaler-1.6.0](https://github.com/kubernetes/autoscaler/releases/tag/vertical-pod-autoscaler-1.6.0)
- VPA 1.5.0 — In-Place beta(2025-09-23) — [github.com/kubernetes/autoscaler/releases/tag/vertical-pod-autoscaler-1.5.0](https://github.com/kubernetes/autoscaler/releases/tag/vertical-pod-autoscaler-1.5.0)

### operator · 배경

- valkey-io/valkey-operator(`v1alpha1`, not ready for production) — [github.com/valkey-io/valkey-operator](https://github.com/valkey-io/valkey-operator)
- Redis 라이선스 변경 발표(2024-03-20, KubeCon Paris 회기 중) — [redis.io/blog/redis-adopts-dual-source-available-licensing](https://redis.io/blog/redis-adopts-dual-source-available-licensing/)
- Linux Foundation Valkey 출범(2024-03-28, Redis 7.2.4 포크·BSD-3) — [linuxfoundation.org/press/linux-foundation-launches-open-source-valkey-community](https://www.linuxfoundation.org/press/linux-foundation-launches-open-source-valkey-community)
