---
title: "부록 · 발표 전사 — Redis on EC2 to Valkey on Kubernetes (KubeCon EU 2026)"
linkTitle: "02 발표 전사"
weight: 2
---

# 02 · 발표 전사 — Redis on EC2 to Valkey on Kubernetes: A Zero-Downtime Case Study

{{< callout type="info" >}}
이 문서는 KubeCon + CloudNativeCon Europe 2026 발표 *Redis on EC2 to Valkey on Kubernetes: A Zero-Downtime Case Study*(Joe Heyburn, Braze)의 **전사 정리본**입니다. YouTube 자동 자막(타임스탬프 714줄)을 원본으로 삼되, 발표자 본인의 슬라이드 덱과 대조해 오인식을 교정했습니다 — Joe Hayburn/Joe Haben→**Joe Heyburn**(핸들 `@jdheyburn`), "psychic shard"→**Sidekiq** shard, "a free phase approach"→**three-phase** approach, "no network load balancer"→**an NLB**, "at Redis, we use AZ affinity"→**at Braze**, "31,000"→nodePort **31000**, "custom resharding"→**Cluster resharding**.

이 문서는 **기록**입니다. 무엇을 말했고 무엇이 슬라이드에 있었는지만 정리했습니다. 그 수치가 무엇을 증명하는지·소스 1(AWS Valkey Cluster 발표)과 어떻게 다른지는 판단하지 않습니다. 그 판단은 자매 문서 [01 무중단 이관]({{< relref "../01-무중단-이관.md" >}})에 있습니다.

원본: [발표 영상](https://www.youtube.com/watch?v=rNZ6HLiFgYI) · [세션 페이지](https://kccnceu2026.sched.com/event/2CW6D/redis-on-ec2-to-valkey-on-kubernetes-a-zero-downtime-case-study-joe-heyburn-braze) · [슬라이드(PDF, 34장)](https://hosted-files.sched.co/kccnceu2026/39/PDF%20Redis%20on%20EC2%20to%20Valkey%20on%20Kubernetes%20-%20%20KubeCon%20EU%202026%20%282%29.pdf)
{{< /callout >}}

## 00:00 인사와 자기소개

Joe Heyburn이 자신을 소개합니다 — Braze의 in-memory database team 소속 staff engineer입니다. 그리고 2022년 이야기로 말을 엽니다. 그해 Braze는 거의 300개에 달하는 Redis 인스턴스를 Kubernetes로 옮기기로 했습니다. 조건이 둘 붙었습니다 — 다운타임은 없어야 하고 매 단계마다 롤백 경로가 있어야 합니다. 다만 오늘 보여주고 싶은 건 그 이관 자체가 아니라 이관이 가능케 한 다음 단계라고 합니다 — 완전히 매끄러운 Valkey 전환, 그리고 거기서 얻은 최대 90%의 지연 개선입니다.

## 00:51 Braze란 무엇인가

Braze는 customer engagement platform입니다. 브랜드가 적절한 사람에게 적절한 시점에 적절한 메시지를 보내도록 돕습니다. 여기서 메시지란 이메일·푸시 알림·SMS를 아우르는 고도로 개인화된 실시간 인게이지먼트입니다 — 심지어 물리적 편지를 쓰는 고객도 있다는 농담을 던집니다. 발송 트리거는 Braze API로 들어오는 데이터입니다. 신규 가입자에게 보내는 환영 이메일, 장바구니를 두고 떠난 고객에게 쿠폰과 함께 보내는 예약 푸시 알림 같은 캠페인이 그렇게 돌아갑니다. 고객이 발송 전에 구매를 완료하면 예약된 메시지를 취소할 수도 있습니다. Braze는 이 모든 걸 하루에도 수십억 번씩 처리합니다. 고객사는 2,000곳이 넘고 이들 모두가 Braze와 함께 스케일하기를 기대합니다 — 그래서 Valkey도 함께 스케일해야 합니다.

## 02:18 Braze 안에서 Valkey의 규모

Braze에서 Valkey는 단일 워크로드가 아닙니다. rate limiting, distributed locks, message deduplication, 그리고 **Sidekiq**에 씁니다 — Sidekiq을 안다면 Valkey가 그 심장부에 있다는 것도 알 것입니다. 곧 Braze 플랫폼 전체의 backbone입니다.

이번 달 기준 규모를 짚습니다 — highly available instance, 즉 shard가 약 600개, 이들이 합쳐서 초당 3,600만(36M) operation을 처리하고 총 메모리 용량은 6.5테라바이트입니다.

"Valkey by numbers"는 **슬라이드 5**이고 숫자는 셋뿐입니다 — **581 HA instances(shards)** · **36M operations/sec** · **6.6TiB**. 발표의 "약 600"은 어림수이고 실제 소스는 슬라이드입니다.

회사 규모는 그 앞의 **슬라이드 3**으로 별개 장입니다 — 고객 2,296곳, 그중 300곳 이상이 연 10억 건 이상 메시지 발송, 2024년 API 호출 8.6T, 메시지·Canvas 액션 3.9T, MAU 6.9B, "over $130M R&D expense in 2024". 2011년 창업, 2021년 나스닥(BRZE) 상장. 하단에 "All numbers As of January 31, 2025"가 붙지만 **MAU 6.9B는 2024-10-31 기준**이고 R&D 공시치는 **$133.969M(FY2025)**입니다 — 대조 결과는 [01 §1.2]({{< relref "../01-무중단-이관.md" >}})에 있습니다.

## 03:31 레거시 토폴로지 — EC2와 Chef의 "돌도끼 시대"

Joe는 청중을 "Braze의 돌도끼 시대"로 데려갑니다. Redis를 EC2 위에서 돌렸고 **Chef**가 그걸 관리했습니다. 레거시 토폴로지에서는 워크로드 타입 하나하나를 킹덤컴까지 샤딩했습니다 — 캐싱용으로도, Sidekiq용으로도. 타입마다 shard를 하나 이상 두어 개별적으로 수평 확장할 수 있게 했습니다. 각 shard는 primary와 replica로 이뤄진 고가용성 쌍이고 이 쌍을 **cluster-scoped Sentinel**이 관리합니다.

Joe는 Sentinel을 쓰는 사람이 얼마나 되는지 손을 들어보라고 청중에게 묻습니다 — 많은 손이 올라가자 "죽어가는 제품이 아니었네요, 계속 붙잡고 가야겠다"고 농담합니다. Sentinel의 역할은 워치독입니다 — primary가 살아있는지 헬스체크하고 죽었다면 replica로 failover를 트리거합니다. 그런데 Braze 환경에서 Sentinel은 한 가지 역할을 더 합니다 — 클라이언트가 어떤 primary의 IP와 포트에 붙어야 하는지 알아내는 데도 Sentinel을 씁니다. 클라이언트는 Sentinel에 연결하고 **자기가 어느 shard에 써야 할지는 클라이언트 쪽에 내장된 해싱 로직으로 스스로 결정합니다** — 키나 데이터 조각을 해싱해서 어느 shard로 써야 할지 정하는 식입니다.

슬라이드 7이 이 토폴로지를 그대로 그립니다 — 3개 AZ에 걸쳐 cache-0/cache-1/cache-2 세 shard의 primary·replica가 나뉘어 있고 cluster-scoped sentinel-001~003 세 대가 전체를 헬스체크합니다.

## 05:34 Kubernetes 토폴로지와 stale replica 문제

Braze에는 이미 Kubernetes 위에 돌아가는 greenfield 클러스터가 있었고 거기에 Helm chart로 Redis를 배포해 둔 상태였습니다 — 방금 본 것과는 조금 다른 토폴로지입니다. 매핑은 StatefulSet 1개 = shard 1개이고 그 StatefulSet 안에 파드가 3개 있습니다 — primary 1개, replica 2개입니다. 이 파드 안에는 Sentinel이 **사이드카 컨테이너**로 함께 돕니다. 여기서는 cluster-scoped Sentinel이 아닙니다 — Sentinel은 자기가 속한 그 shard 하나만 감시합니다.

문제는 Sentinel이 IP 주소로 작동한다는 데 있습니다 — replica의 IP가 고정돼 있어야 합니다. 그런데 Kubernetes에서는 파드가 롤되면 파드 IP가 바뀝니다. 그러면 Sentinel의 replica 맵에서 옛 IP 주소가 죽은 것으로 보이고 stale replica가 쌓입니다. Sentinel은 항상 최신 replica 이름을 알고 있어야 좋은데 이건 그렇지 못한 상태입니다.

슬라이드 8의 `# sentinel replicas cache-0` 출력이 이 문제를 그대로 캡처합니다 — 네 줄이고 `100.1.1.1 ok`, `100.3.3.3 ok`, IP가 빈 채 `down`, `100.4.4.4 ok` 순입니다. 살아 있는 셋 옆에 옛 IP 하나가 `down`으로 남아 있고 롤 이후 새로 붙은 IP(`100.4.4.4`)는 별개 replica로 따로 등록됩니다 — stale replica가 쌓이는 기전이 이 네 줄에 다 있습니다.

## 07:04 해결책 — 파드별 Service와 ClusterIP, 그리고 그 한계

이걸 피하려고 Braze는 파드마다 **Service**를 하나씩 붙입니다. 그 Service는 자기 생명주기 동안 계속 같은 **ClusterIP**를 유지합니다. 그리고 **init 컨테이너**가 그 ClusterIP를 찾아내서 파드가 자기 자신을 그 ClusterIP로 announce하게 합니다.

여기서 반드시 기억해야 할 게 있습니다 — 이 파드들은 클러스터 안에서는 서로 통신할 수 있지만 **이 ClusterIP들은 클러스터 밖에서는 접근할 수 없습니다.** 이관이 어려워지는 건 바로 이 지점입니다.

## 08:03 이관 요구사항

그럼 Redis를 어떻게 Kubernetes로 옮길 것인가. 먼저 요구사항부터입니다 — 아주 단순한 두 가지입니다. 첫째, **무중단**이어야 합니다 — Braze는 실시간 메시지 결정과 발송에 의존하는 회사라 어떤 다운타임이든 메시지 지연으로 직결되고 고객이 좋아할 리 없습니다. 둘째, **롤백할 수 있어야 합니다** — Kubernetes로 옮긴 뒤 뭔가 마음에 안 들면 EC2로 되돌아갈 수 있어야 하는데 그때 Kubernetes 위에서 쓰인 데이터를 잃어서는 안 됩니다.

## 09:15 옵션 1 — RDB 스냅샷 복사

Redis와 Valkey는 상태를 RDB 파일로 디스크에 남길 수 있습니다. EC2 primary의 RDB 파일을 가져와 Kubernetes에서 primary가 될 파드의 볼륨에 복사하고 리로드하면 되지 않을까? 단순하긴 합니다. 하지만 복사하는 동안 새 데이터가 쓰이지 않도록 클라이언트를 멈춰야 합니다 — 안 그러면 데이터를 잃습니다. 그러니 단순함과 별개로 **다운타임**이 생깁니다. 이미 다운타임은 허용되지 않는다고 정한 요구사항에 어긋납니다.

## 10:32 옵션 2 — 내부 replication만

파드가 EC2 VPC에 도달할 수 있다는 걸 이용해 서버가 EC2 primary를 replicate하도록 설정하고 Sentinel로 failover를 조정해 Kubernetes 파드를 primary로 승격시키면 어떨까. 무중단은 얻습니다. 하지만 ClusterIP는 클러스터 내부 전용이라 EC2 primary 인스턴스는 승격된 그 파드에 접근할 수 없습니다. 무중단은 Sentinel에서 얻지만 **롤백 시 데이터 손실 없음**은 잃습니다.

## 11:25 옵션 3(채택) — NLB 경유 양방향 replication

Redis 프로토콜은 **layer 4**에서 동작합니다. 그러니 필요한 건 클러스터 밖에 있으면서 Kubernetes 파드로 라우팅해줄 인프라입니다 — 여기서 **AWS Network Load Balancer(NLB)**를 씁니다. 서버가 그 NLB의 IP·포트에 자기 가용성을 announce하게 하면 failover가 일어난 뒤에도 EC2 primary가 클러스터 안쪽으로 replicate할 방법이 생깁니다. Sentinel에서 오는 무중단과 롤백 시 데이터 손실 없음을 둘 다 얻습니다. 조금 더 복잡하지만 엔지니어답게 제대로 풀어보자는 게 Joe의 표현입니다.

## 12:34 파드 상세 아키텍처

빈 클러스터에 파드 하나가 있고 그 앞에 Service가 붙습니다. 여기에 **nodePort**를 부여합니다 — 예시로 31000을 골랐다고 합니다. nodePort 31000은 항상 server 컨테이너로 트래픽을 라우팅하도록 정합니다. 여기에 NLB를 붙이고 리스너를 만듭니다 — 포트 6380이 target group, 즉 클러스터 안의 모든 Kubernetes 노드의 nodePort 31000으로 트래픽을 라우팅하도록 합니다. 이걸로 트래픽이 파드(정확히는 컨테이너)까지 끝에서 끝까지 도달하는 경로가 완성됩니다. 마지막으로 Redis/Valkey에 그 NLB IP와 리스너 포트로 자기 가용성을 announce하라고 설정합니다.

Sentinel도 같은 패턴을 반복합니다 — 새 nodePort 31001, 새 리스너 포트 26380을 붙이고 Sentinel도 그 NLB IP·리스너 포트로 스스로를 announce하도록 설정합니다.

```
# server.conf
replica-announce-ip    10.1.1.100
replica-announce-port  6380

# sentinel.conf
announce-ip            10.1.1.100
announce-port          26380
```

## 15:29 이관 3단계와 AZ affinity

실제 이관은 **three-phase** approach로 진행했습니다(ASR은 "a free phase approach"로 오인식). Helm chart에 migration mode임을 알려주면 파드와 Service를 평소처럼 만들되 NLB도 함께 배치하고 Kubernetes 파드가 EC2 서버를 replicate하도록 설정합니다 — 이게 **Setup** 단계입니다.

실제 마이그레이션 실행은 **스크립트**가 관리했습니다. 헬스체크를 먼저 돌려 정확히 기대한 상태인지 확인합니다 — healthy replica 수, Sentinel 수, 그리고 **양쪽 config가 동일한지**입니다. Joe는 이걸 이렇게 표현합니다 — "re-platforming을 할 때는 두 상태 사이에서 오직 플랫폼 그 자체만 바뀌어야 합니다." 헬스체크가 끝나면 마이그레이션을 실행합니다 — 색이 왼쪽에서 오른쪽으로 바뀌면서 서버가 스스로 primary라고 announce합니다. 이때 승격 대상으로 고르는 파드는 **기존 EC2 primary와 같은 AZ에 있는 파드**입니다 — Braze는 AZ affinity를 적극적으로 활용해 cross-AZ 데이터 전송비를 줄입니다(ASR은 이 문장을 "at Redis, we use a lot of AZ affinity"로 오인식했지만, 주어는 **Braze** 자신입니다).

이제 Kubernetes 위에서 돌아가는 상태가 되고 모든 트래픽은 NLB를 거쳐 replicate됩니다. 하지만 이 상태를 영구히 유지하고 싶진 않습니다 — 최종적으로는 애초에 보여줬던 순수 Kubernetes 토폴로지로 돌아가야 합니다. 그러려면 파드들이 내부 Service ClusterIP로 자기 자신을 announce해야 하는데 그 주소로는 바깥에서 아무것도 통신할 수 없습니다. 그래서 **EC2 인스턴스를 먼저 보냅니다** — "ta-da, see you later". 그다음 파드들을 재설정해 내부 ClusterIP로 광고하게 합니다. 이 시점에는 NLB를 지나는 트래픽이 없으니 NLB도 제거합니다 — 이게 **Remove NLB** 단계입니다. 이 세 단계로 shard 하나의 이관이 끝났습니다.

## 17:06 예상 못 한 문제 둘

Joe는 목록이 너무 많아 다 못 다룬다며 두 가지만 짚습니다.

첫째는 **NLB 트래픽 비용**입니다. NLB를 거쳐 데이터를 무기한으로 흘려보내면 비용이 얼마나 들지 분석했습니다 — 얼마나 쓰이고, 얼마나 읽히고, 얼마나 replicate되는지, 이 이관 구성에서 붙어 있는 replica 수까지 감안해 Prometheus로 실제 트래픽을 쟀습니다. 결과는 데이터 전송비만으로 **월 $100,000를 넘는** 수준이었습니다. 그래서 NLB를 그대로 상시로 둘 수는 없고 **모든 클라이언트가 Kubernetes로 옮겨갈 때까지 기다렸다가** NLB를 제거하고 내부 ClusterIP로 광고를 전환하기로 했습니다.

둘째는 **Sentinel split brain**입니다. 이관 중에는 EC2 클러스터 레벨의 Sentinel 3대와 파드 레벨의 Sentinel 3대가 동시에 떠 있습니다 — 서로 다른 플랫폼 위에서입니다. 이 둘 사이 연결이 끊기면 양쪽 각각의 3대가 "primary에 접근할 수 없다"고 판단해 각자 failover를 결의합니다 — 그러면 한 shard 안에 primary가 둘 생기는 전형적인 split brain이고 이 시나리오는 항상 데이터 손실로 이어집니다. 해법으로 **일곱 번째 Sentinel**을 EC2 쪽에 추가했습니다 — 이관 기간 동안만 떠 있는 임시 Sentinel입니다. 그리고 quorum Sentinel 수를 **5**로 올려 항상 절대 과반의 Sentinel이 동의해야만 primary가 죽었다고 판단하도록 했습니다.

> **슬라이드**: 슬라이드 20의 표가 문제·설명·해법 3열로 이 둘을 정리합니다 — NLB 트래픽 비용은 "Estimated $100,000+ monthly cost on data transfer" → "Wait for all clients to migrate to K8s first". Sentinel split brain 위험은 "6 Sentinels during migration: 3 legacy + 3 K8s" → "Add a fourth EC2 Sentinel during migration (7 total)", "Set quorum: 5 on Sentinel".

## 19:13 Kubernetes 이관 성과

마이그레이션은 2023년 2월부터 2024년 5월까지 진행됐습니다. Joe는 "거의 300개 shard를 7개 클러스터 전체에 걸쳐 한 번에 처리했고, 그 전체를 데이터 손실 없이 해냈다"고 말합니다 — 완전한 re-platforming을 고객이 전혀 눈치채지 못하게 끝낸 것이 놀라웠다고 덧붙입니다.

> **슬라이드**: "Migration by numbers"는 **슬라이드 21**이고 정확한 숫자는 **274 shards · 7 clusters · 0 data loss**입니다. 발표의 "nearly 300"은 어림수입니다.

## 19:39 라이선스 변경과 Valkey로 가는 이유

Joe는 몇 년 전 KubeCon Paris로 이야기를 돌립니다. 그 컨퍼런스 기간에 Redis가 라이선스 변경을 발표한 걸 기억하는 사람도 있을 것입니다 — Joe도 그 현장에 있었습니다. 그날 현장 분위기를 "또 한 번의 rug pull"이라고 표현합니다. 이후 여러 회사가 Redis를 계속 오픈으로 유지하고 싶어 fork해 Valkey를 만들었습니다. **Braze는 이 라이선스 변경에 직접 영향을 받지는 않았습니다.** 그래도 커뮤니티가 가는 방향은 계속 따라가고 싶었다고 합니다. 벤치마크를 돌려보니 결과가 꽤 좋았고 이제 막 Kubernetes 위로 올라온 참이라 얼마나 빠르게 옮길 수 있는지 시험해보기로 했습니다.

## 20:30 Valkey로 전환 — Helm 변경 두 줄

먼저 뭘 바꿔야 하는지부터 봤습니다. 기존 Helm chart는 server 컨테이너의 시작 명령이 `redis-server`로 하드코딩돼 있었습니다. Valkey에서는 이게 `valkey-server`로 바뀝니다. 그래서 배포하는 이미지가 Valkey인지 Redis인지에 따라 시작 명령을 동적으로 정하도록 템플릿을 조금 손봤습니다.

두 번째 변경에서 Joe는 "많을 각오를 하라"고 운을 띄운 뒤 곧바로 "사실 별거 없었다"고 정정합니다 — 딱 두 줄이었습니다. 배포할 이미지 이름과 버전만 바꾸면 됐습니다.

```yaml
# From              →  To
repository: redis      repository: valkey/valkey
tag: 7.2.4-alpine      tag: 8.1.1-alpine
```

정말 그게 다였습니다. 게다가 Valkey는 Redis 설정과 **완전히 하위호환**이라 일이 더 쉬웠습니다 — config는 한 줄도 바꿀 필요가 없었습니다. 남은 일은 "이날 이 shard들을 옮긴다"고 정하는 것뿐이었습니다.

## 21:45 Valkey 이관 성과 — 350/10/6주

실제 이관 시점에는 Braze가 Kubernetes 이관 이후로 조금 더 커져 있었습니다. 그래서 **350개 shard**를 **10개 클러스터**에 걸쳐 옮겼고 이 전부를 단 **6주** 만에 끝냈습니다 — Kubernetes가 준 속도 덕분이라고 짚습니다.

## 22:12 지연 개선 — 세 수치를 함께

성능은 어땠을까요? 헤드라인 수치부터입니다 — 가장 바쁜 클러스터 중 한 곳의 한 타입에서 마이그레이션만으로 **p95 지연이 90% 줄었습니다**. config를 하나도 바꾸지 않은 like-for-like 비교라는 걸 다시 강조합니다.

그런데 Joe는 곧바로 이 수치의 한계를 스스로 밝힙니다 — "이게 헤드라인 수치이고, 최선의 경우입니다." 평균은 어땠을까요? 전체 타입, 전체 클러스터를 통틀어 **평균 p95 지연 개선은 15%**였습니다 — 그래도 tail-end 지연이 확실히 줄어드는 효과였다고 합니다. 대다수가 겪는 p50은 **5%**입니다 — Joe도 "소박한 수치"라고 인정합니다. 하지만 Braze가 돌아가는 규모는 조 단위입니다 — 발표 며칠 전 실적 발표에서 확인했듯 이제 호출량은 trillion 단위로 올라섰습니다. 그러니 5%라는 개선도 그 규모에서 거듭 곱해지면 고객 경험을 확실히 바꾼다는 게 요지입니다.

슬라이드 26에는 "**90%** p95 latency improvement" 한 줄만 크게 있습니다. 15%와 5%는 슬라이드에 없고 구어로만 나옵니다 — 평균·p50 수치는 발표에서만 확인할 수 있습니다.

## 23:53 다음 과제

re-platforming도 Valkey 이관도 끝냈습니다. 그래도 Joe는 "Braze에서 Valkey 상태를 개선하는 일은 끝난 적이 없다"고 말하며 몇 년째 Kubernetes 위에서 운영하면서 마주한 문제들로 넘어갑니다.

첫째는 **intelligent bin-packing**입니다. 파드가 노드에 고르게 분산되지 않아 primary들이 특정 노드 하나에 몰립니다 — hot node가 생기고 CPU 사용률이 불균등해지고 대역폭도 편중됩니다. 이렇게 몰린 hot node는 AWS의 "bandwidth allowance exceeded"에 걸리기도 합니다. 용량을 더 사면 풀리는 문제이긴 하지만 그건 돈이 듭니다. Braze가 원하는 건 더 지능적인 해법입니다 — 예를 들어 "같은 노드에 특정 **Sidekiq** shard의 primary가 2개를 넘지 않게" 같은 규칙을 정의해서 고르게 분산시키고 트러블슈팅 부담도 줄이고 싶어 합니다(ASR은 이 대목을 "psychic shard"로 오인식했습니다).

둘째는 **vertical autoscaling**입니다. Braze는 항상 scale in/out을 합니다 — Joe는 자신이 오늘 발표하는 동안에도 아마 100번쯤 scale in/out이 일어났을 거라고 농담합니다. 지금은 정적으로 리소스를 잡아두는데 워크로드에 맞춰 Valkey 데이터베이스가 동적으로 움직이는 세계를 원한다고 말합니다. 최근 몇 달 사이 큰 진전이 있었습니다 — vertical pod autoscaler가 in-place pod resizer를 흡수했고 이게 최근 Kubernetes 버전에서 **stable**로 승격됐습니다. 노드에 여력이 있고 메모리가 더 필요하면 파드를 재생성하지 않고 컨테이너에 리소스를 더 얹을 수 있습니다.

in-place pod resize의 GA 자체는 이 레포의 [k8s-features 01 in-place pod resize]({{< relref "../../../k8s-features/01-inplace-pod-resize.md" >}}) 문서에 따로 정리해 뒀습니다.

셋째는 **valkey-operator**입니다. Kubernetes 위에서 Valkey를 훨씬 쉽게 운영할 방법을 만들자는 취지로 여러 회사가 모여 community-led operator를 만들고 있고 Joe도 참여자입니다. 아직 개발 중이지만 프로덕션 준비가 되면 지원할 모드로 cluster mode, standalone, replication(Sentinel이든 아니든), 그리고 **cells** 개념까지 목표로 잡고 있습니다 — cells는 사실상 오늘 설명한 바로 그 토폴로지라고 짚습니다. 로드맵에는 autoscaling, cluster resharding, plugins가 올라 있습니다(ASR은 "cluster"를 "custom"으로 오인식했습니다). QR 코드로 GitHub repo를 안내하며 아이디어와 기여를 독려합니다.

슬라이드 31이 이 로드맵을 표로 정리합니다 — Planned supported modes: Cluster · Standalone · HA-replication(Operator / Sentinel) · Cells(Non-clustered). Roadmap: Autoscaling · Cluster resharding · Plugins.

## 27:22 마무리

Joe는 발표를 정리하며 QR 코드 두 개를 안내합니다 — 하나는 Braze 채용(braze.com/careers)이고 하나는 피드백입니다. "제 이름은 다시 한번 Joe Heyburn입니다. 소셜에서는 `@jdheyburn`으로 찾을 수 있습니다"로 발표를 닫습니다(ASR은 이름을 "Joe Haben", 핸들을 "jdehaben"으로 오인식했습니다).

## 원본

- 발표 영상(CNCF, YouTube, 28:12) — [youtube.com/watch?v=rNZ6HLiFgYI](https://www.youtube.com/watch?v=rNZ6HLiFgYI)
- 세션 페이지(sched.com) — [kccnceu2026.sched.com/event/2CW6D](https://kccnceu2026.sched.com/event/2CW6D/redis-on-ec2-to-valkey-on-kubernetes-a-zero-downtime-case-study-joe-heyburn-braze)
- 슬라이드 덱(PDF, 34장) — [PDF Redis on EC2 to Valkey on Kubernetes - KubeCon EU 2026 (2).pdf](https://hosted-files.sched.co/kccnceu2026/39/PDF%20Redis%20on%20EC2%20to%20Valkey%20on%20Kubernetes%20-%20%20KubeCon%20EU%202026%20%282%29.pdf)
