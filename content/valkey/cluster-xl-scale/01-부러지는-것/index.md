---
title: "2,000노드 Valkey — 무엇이 먼저 부러지고, 그중 무엇이 Kubernetes로 넘어오는가"
linkTitle: "01 2,000노드에서 부러지는 것"
weight: 1
---

# 01 · 2,000노드 Valkey — 무엇이 먼저 부러지고, 그중 무엇이 Kubernetes로 넘어오는가

{{< callout type="info" >}}
**한눈에**
- **간판 수치는 Kubernetes에서 잰 게 아니다.** 2,000노드·1B RPS의 서면판인 [valkey.io 블로그](https://valkey.io/blog/1-billion-rps/) 원문에 Kubernetes·pod·StatefulSet·container가 한 번도 나오지 않고, 실험대는 `r7g.2xlarge`(8코어/64GB) 클러스터 + 부하 생성기 `c7g.16xlarge` 750대였다. 발표 시작 13초에 본인들이 "we come from Amazon, which is mostly a **VM based world**"라고 밝힌다.
- **그래도 엔진 수정 4건은 인프라와 무관하게 넘어온다.** [#654](https://github.com/valkey-io/valkey/pull/654)·[#1018](https://github.com/valkey-io/valkey/pull/1018)·[#2154](https://github.com/valkey-io/valkey/pull/2154)·[#2277](https://github.com/valkey-io/valkey/pull/2277)은 배포 방식이 아니라 cluster bus 코드 안에 들어갔다. **필요한 건 버전을 맞추는 것뿐이다** — 각각 8.0 / 8.1 / 9.0 / 9.0.
- **CPU 100% 그래프를 클러스터 전체로 읽으면 틀린다.** 슬라이드에서 천장에 붙는 계열은 `engine_cpu_percent_p99`고 같은 차트의 p90·avg는 한 자릿수다(스냅샷 p90 6.2 / avg 5.80). 발표자 노트는 포화 범위를 "atleast 5% of the nodes"(오타는 원문 그대로)라 적는다 — **하한이지 점추정이 아니다.** 2,000노드가 전부 탄 게 아니라 최소 100대가 탔다는 뜻이고, 발표는 이 구분을 하지 않는다.
- **Kubernetes 조언 중 실측이 뒷받침하는 건 사실상 하나다** — CPU limit을 걸지 마라. 나머지(StatefulSet, headless service 부트스트랩, IP 직결, AZ 분산)는 전부 경험칙이고 발표에 수치가 붙지 않는다.
- **operator는 아직 도입 대상이 아니다.** API가 `v1alpha1`이고 README가 "not ready for production use"라 못박으며 scale-out/in에 Valkey 9.0+를 요구한다. 다만 `spec.shards`는 진짜 최상위 필드라 Q&A의 "shard가 first-class" 주장 자체는 맞다.
- **2,000노드에서 먼저 부러지는 건 처리량이 아니라 장애 복구다.** 정상 상태 gossip 비용은 노드 수에 선형이었고, 터진 곳은 전부 primary를 수백 개씩 한 번에 죽였을 때의 재접속(415~455 kill)·failure report(499 kill)·투표 경로였다.
{{< /callout >}}

> **왜 이 문서인가.** 발표 제목은 *Kubernetes at XL Scale*인데 간판 수치인 2,000노드 / 1B RPS는 EC2에서 나왔다. 이 문서는 발표가 **증명한 것**(엔진 한계와 그 수정)과 **조언에 그친 것**(Kubernetes 배치·리소스)을 갈라, 그중 무엇이 Kubernetes로 전이되는지만 남긴다. 검증 기준: 발표 전사(942줄)·발표자 노트가 붙은 슬라이드 원본 54장·valkey.io 블로그·업스트림 PR 4건·`valkey.conf` unstable 브랜치.
>
> **출처**: KubeCon + CloudNativeCon Europe 2026 — *[Scaling Valkey the Right Way: Kubernetes at XL Scale](https://kccnceu2026.sched.com/event/2CW5d)* (Sarthak Aggarwal · Madelyn Olson, AWS ElastiCache). 2026-03-26(목) 11:00–11:30 CET, Hall 8 | Room E. 슬라이드 원본은 [PPTX 54장](https://hosted-files.sched.co/kccnceu2026/06/Scaling%20Large%20Clusters%20with%20Valkey%20FINAL.pptx)이다. 이 글은 발표 내용에 **업스트림 PR 대조·슬라이드 그래프 재해석·근거 등급 판정**을 덧붙였고, 발표가 말한 것과 1차 문서가 말하는 것이 어긋나는 지점을 그대로 적었다.
>
> 자매 문서: [02 발표 전사]({{< relref "02-발표-전사.md" >}})

## 1. 이 발표가 증명한 것과 증명하지 않은 것

발표 제목에 Kubernetes가 들어가 있고 실제로 Kubernetes 조언이 절반을 차지한다. 그런데 **간판 수치를 만든 실험은 Kubernetes 위에서 돌지 않았다.**

근거는 추측이 아니라 서면판에 있다. 같은 실험을 글로 옮긴 [Scaling a Valkey Cluster to 1 Billion Request per Second](https://valkey.io/blog/1-billion-rps/) 원문에 **Kubernetes·EKS·pod·StatefulSet·container 언급이 0회**다. 대신 이렇게 적혀 있다 — "Valkey cluster was deployed on AWS `r7g.2xlarge` instance type... we used 750 instances of AWS `c7g.16xlarge`." 튜닝도 코어 피닝(`taskset`, `cset`)과 NIC 인터럽트 어피니티(`ethtool`)를 손으로 잡았다. 셋 다 Kubernetes 위에서는 하기 까다롭거나 아예 안 하는 것들이다.

슬라이드 그래프의 계열 이름이 `engine_cpu_percent_p99`인 것도 같은 방향을 가리킨다 — Prometheus 메트릭이 아니라 ElastiCache/AWS 내부 대시보드다. 발표자 본인 진술이 가장 명확하다.

> we come from Amazon, which is mostly a **VM based world**. So, we're all we look over here at Kubernetes and we're like, "Wow, this technology is amazing. I wish we could use more of it." — 00:13~00:24

그렇다고 Kubernetes가 없는 발표는 아니다. **역할이 다를 뿐이다** — 증거가 아니라 조언이다. 발표를 층위로 갈라 보면 이렇게 나뉜다.

| 층위 | 내용 | 근거의 출처 |
|---|---|---|
| 엔진 한계·수정 | 풀메시 cluster bus, 16384 슬롯, 재접속 폭풍, failure report O(N), 투표 분열, pub/sub 헤더 | **EC2 2,000노드 실측** — 단 #654(8.0)와 #1018(8.1)은 이 캠페인 이전에 이미 머지됐다. 슬라이드 37 노트도 "Before Valkey 9, the community made some other important improvements"라 적는다 |
| Kubernetes 배치 조언 | standalone은 StatefulSet+Helm, headless service 부트스트랩, pod name을 hostname으로, CoreDNS 지연 피해 IP 직결, primary/replica AZ 분산 | 실측 없음 — 경험칙 |
| Kubernetes 리소스 조언 | 캐시는 메모리로 스케일하니 CPU 집약 워크로드와 co-locate, **CPU limit 걸지 마라** | 실측 없음 — 경험칙 |
| 미래 | valkey-operator 개발 중, shard를 first-class 구성 요소로 | 아직 없음 |

**이 문서의 기여는 이 표의 1행과 2·3행을 섞어 읽지 않는 것이다.** 1행은 엔진 안에 들어간 코드라 인프라를 가리지 않고 따라온다. 2·3행은 두 AWS 엔지니어의 운영 감각이고, 좋은 감각이지만 이 발표의 숫자가 뒷받침하지는 않는다.

발표 주체의 편향도 밝혀 둘 값어치가 있다. Valkey 자체는 [Linux Foundation 산하 벤더 중립 BSD-3 프로젝트](https://www.linuxfoundation.org/press/linux-foundation-launches-open-source-valkey-community)지만, **이 발표의 수치는 AWS가 AWS 하드웨어에서 잰 것**이다. 발표자 둘 다 AWS ElastiCache 팀이고, valkey.io 블로그도 공저자 4명 중 셋이 AWS 소속으로 적혀 있다. 아래에서 볼 수정 PR 작성자 중 Sarthak Aggarwal과 Seungmin Lee도 AWS다(블로그 저자 표기·GitHub 프로필로 확인). 투표 분열을 고친 Binbin Zhu만 Tencent Cloud 소속이다. Roshan Khatri의 소속은 공개 프로필에 없어 이 문서가 확인하지 못했다.

## 2. 왜 2,000노드에서 멈추는가

발표는 첫 슬라이드부터 못을 박는다 — "You shouldn't run a 2000 node Valkey cluster, **but you might have to.**" 2,000이라는 숫자는 목표가 아니라 세 개의 천장이 겹치는 지점이다.

| 천장 | 성질 | 2,000노드에서의 값 |
|---|---|---|
| full-mesh cluster bus | 연결 수가 노드 수의 제곱 | 노드당 1,999개 링크, 전체 1,999,000개 |
| 16384 슬롯 고정 | 재샤딩 입도가 노드 수에 반비례 | primary 1,000대 기준 primary당 16.4슬롯 |
| `cluster-node-timeout` | 감지 시간이 규모에 종속 | 기본 15000ms — 낮추면 대형 클러스터에서 깨진다 |

### 2.1 full-mesh는 저장소를 안 쓰는 대가다

Valkey cluster는 토폴로지를 외부 저장소에 두지 않는다. 발표자가 직접 대비시킨다 — "a much more cloud native solution to this might be storing all of this topology information [in] something like **etcd**. What Valkey does instead is every shard owns their state." 공식 [cluster specification](https://valkey.io/topics/cluster-spec/)도 같은 문장을 쓴다: "Valkey Cluster is a full mesh where every node is connected with every other node using a TCP connection."

etcd가 없다는 건 컨트롤 플레인 의존이 없다는 뜻이고, 동시에 **모든 노드가 나머지 전부와 TCP 연결을 유지한다**는 뜻이다. N노드면 링크가 `N(N-1)/2`다. 2,000노드에서 노드 하나가 1,999개 연결을 들고 있고 클러스터 전체로는 약 200만 개다. 이 상수가 나중에 §3.1의 재접속 폭풍을 만든다.

발표는 "1,000노드 부근에서 CPU 1~2%"라는 수치로 이 비용을 요약한다(05:38). **이 수치는 슬라이드 밖 1차 출처를 찾지 못했다** — cluster-spec에도, 1-billion-rps 블로그에도 없다. 슬라이드-only 주장으로 표시하고 인용할 때 그렇게 밝히는 편이 안전하다.

반대로 확인된 것은 **정상 상태에서 gossip 비용이 선형으로 늘었다**는 관찰이다(19:10~19:22). 즉 평시 오버헤드는 예측 가능했고, 문제는 전부 장애 시점에 몰렸다.

### 2.2 슬롯은 개수가 아니라 열 분산이 먼저 문제가 된다

16384라는 상수는 [cluster-spec](https://valkey.io/topics/cluster-spec/)이 "effectively setting an upper limit for the cluster size of 16384 primary nodes"라고 적어 둔 대로 primary 수의 절대 상한이다. 그런데 **2,000노드에서 부딪히는 건 이 상한이 아니다.**

발표자의 설명이 정확하다(09:29~09:49) — 슬롯을 옮기려 할 때 "there's too much variance in heat between various slots to actually kind of have a uniform cluster, and you'll start seeing spikiness."

산수로 옮기면 이렇다. primary 1,000대 구성이면 primary당 `16384 / 1000 ≈ 16.4`슬롯이다. **슬롯 하나를 옮기는 것이 그 노드 데이터의 약 6%를 옮기는 일이 된다.** 100노드였다면 슬롯 하나가 노드의 0.6%였고, 그 정도 입도로는 열을 부드럽게 재분배할 수 있다. 노드가 늘수록 재샤딩의 최소 단위가 상대적으로 굵어지고, 그래서 슬롯 개수가 바닥나기 훨씬 전에 **균등 분배가 먼저 불가능해진다.**

여기 대응하는 도구가 두 개 있다. 관측은 [`CLUSTER SLOT-STATS`](https://valkey.io/commands/cluster-slot-stats/)로, Valkey 8.0.0부터 슬롯 단위 `key-count` · `cpu-usec` · `network-bytes-in` · `network-bytes-out`을 준다(`key-count` 외 셋은 `cluster-slot-stats-enabled yes`가 필요하다). 이동은 Valkey 9.0의 [atomic slot migration](https://valkey.io/topics/atomic-slot-migration/)으로, 예전 CLI 기반 키 단위 `MIGRATE` 대신 복제 링크처럼 슬롯 전체를 스트리밍하고 **소유권은 맨 마지막에야 넘긴다.**

발표에서 가장 실무적인 한 줄은 여기서 나온다 — **가장 뜨거운 슬롯은 건드리지 말고 두 번째로 뜨거운 슬롯을 옮겨라.** 제일 뜨거운 걸 옮기는 게 가장 큰 작업이기 때문이고, 목표는 "그 노드에서 hottest 아닌 것들을 먼저 걷어내는 것"이다(14:17~14:26).

### 2.3 `cluster-node-timeout`은 규모에 종속된다

기본값 15초는 확인했다 — `valkey.conf` unstable 브랜치 1844행 `# cluster-node-timeout 15000`. 발표에서 두 번(06:14, 20:15) 인용되는 값이고 둘 다 맞다.

핵심은 값 자체가 아니라 **이 값이 규모와 묶여 있다**는 점이다. 소규모 클러스터에서는 1초, 500ms까지 내릴 수 있지만 "that won't scale very well" — 노드가 늘면 감지·전파가 그만큼 오래 걸린다. 그리고 §3.1에서 보듯 이 타임아웃은 재접속 예산의 분모이기도 하다. Kubernetes로 옮겨도 이 상수는 그대로 따라온다.

## 3. 대량 장애에서 부러진 네 곳

테스트 시나리오부터 확인하고 가자. 2,000노드(primary 1,000 / replica 1,000)에서 primary를 1 → 100 → 250 → 330 → 499개까지 늘려 가며 죽였다. **499에서 멈춘 이유는 quorum이다** — primary 1,000대 중 501대가 살아 있어야 클러스터가 스스로 회복할 수 있으므로 499가 자가 치유의 한계선이다. 2AZ·3AZ 구성을 모두 걸었고 그중 3AZ에서 AZ 하나를 통째로 날리는 시험(약 666노드 동시 실패)도 돌렸다(17:19). 부하는 25M → 100M → 1B RPS로 올렸다. 클라이언트는 valkey-py · valkey-glide · valkey-go에 더해 발표자 노트 기준 iovalkey · redisson까지 다섯 종을 걸었다.

네 곳이 부러졌다. 전부 정상 상태가 아니라 **대량 장애 직후의 경로**다.

### 3.1 재접속 폭풍 — valkey-io/valkey#2154

primary를 415~455개씩 죽이면, **살아남은 노드들이 죽은 노드에 100ms마다 재접속을 시도했다.** `clusterCron`이 매 사이클 `link == NULL`인 피어(PFAIL/FAIL 상태)에 다시 다이얼을 걸었기 때문이다. 연결이 성공할 리 없다는 걸 알면서도 여는 비용과 해제하는 비용을 계속 냈다.

풀메시가 이 비용을 곱해 준다. 죽은 노드가 450개면 살아남은 노드 하나가 매 100ms마다 450번의 실패할 connect를 시도한다. 발표자 노트가 결과를 그대로 적는다 — "The compute was consistently 100% for at atleast 5% of the nodes at a time. Specially in cases where we failed anything north of 450 primaries, the cluster was almost never able to recover."(`atleast`·`Specially`는 노트 원문 표기다.) **여기서 5%는 하한이다** — 5%일 수도, 그보다 훨씬 많을 수도 있다는 뜻으로 읽어야 한다.

프로파일링은 특별한 도구를 쓰지 않았다. Q&A에서 밝힌 대로 "it was just a normal `perf` tool"이고, 거기서 뽑은 flame graph가 슬라이드에 그대로 붙어 있다([기법 자체의 표준 레퍼런스](https://www.brendangregg.com/flamegraphs.html)는 Brendan Gregg의 페이지지만 발표자가 이 출처를 지목한 적은 없다). 아래 콜 경로는 그 **슬라이드 이미지에서 직접 읽은 것**이고, 전사에도 슬라이드 텍스트에도 나오지 않는다.

{{< flow src="_flow/3-1-재접속-폭풍-콜스택.json" />}}

수정은 [#2154](https://github.com/valkey-io/valkey/pull/2154)다. 작성자가 발표자 본인(Sarthak Aggarwal)이고, 2025-07-22 머지, 이슈 [#2122](https://github.com/valkey-io/valkey/issues/2122)를 닫는다. 방식은 **재시도 총량을 `cluster-node-timeout` 안으로 예산화**하는 것이다 — 100ms마다 무한정 두드리는 대신 PFAIL 구간 전체에 약 10회를 흩뿌린다(기본값에서 재시도 간격 약 750ms). 모든 죽은 노드가 "fair chance"를 받되 컴퓨트를 태우지는 않게 하는 절충이다.

측정치는 세 갈래로 나뉜다.

| 조건 | 지표 | 개선 |
|---|---|---|
| 20~30노드 클러스터 | P99 노드 CPU | **-35%** |
| 200~300노드 클러스터 | P90 / Avg CPU | -10% |
| primary 1,000 중 450 kill | P99 노드 CPU | **-75%** |
| 슬라이드 노트 기준 | engine CPU 상한 | 100% → **40%** |

### 3.2 failure report O(N) — #2277

499개를 죽인 직후 CPU가 두 번 크게 치솟았다가 스스로 내려왔다. 원인은 죽은 노드가 아니라 **살아남은 노드들끼리의 뒷정리**였다. 발표자 노트가 규모를 준다 — 2,000노드 중 499개를 죽인 뒤 남은 **1,501노드가 이미 failed로 마킹된 노드에 대해 계속 gossip과 report를 주고받았다.**

failure report는 리스트로 관리됐고, 정리(`clusterNodeCleanupFailureReports`)가 **O(N) 스캔**이었다. 2,000노드에서 이 O(N)이 곱해지면 정리 작업만으로 CPU의 상당 부분이 사라진다.

수정은 [#2277](https://github.com/valkey-io/valkey/pull/2277)이다. Seungmin Lee 작성, 2025-07-28 unstable 머지, 이슈 [#2139](https://github.com/valkey-io/valkey/issues/2139)를 닫는다. 리스트를 **만료 타임스탬프로 버킷팅한 radix tree(rax)**로 바꿨다. 발표자 노트가 설계 의도를 한 줄로 요약한다 — 만료 시각을 **1초 단위로 올림해서 묶어 저장**한다. 그러면 같은 초에 만료될 report들이 한 노드에 모이고, 만료 정리가 개별 스캔이 아니라 버킷 단위 삭제가 된다.

PR 자체 벤치마크는 `m7g.2xlarge` 2,000노드(primary 1,000 / replica 1,000)에서 잰 것이다 — baseline은 300노드 failover 중 CPU 약 100%였고 그중 정리 작업이 약 60%를 차지했다. 최적화 후에는 **더 큰** 450노드 failover에서 CPU 약 30~35%였다. 무대에서 말한 "28~30%"는 조금 후한 반올림이다.

### 3.3 투표 분열 — #1018

이게 발표자가 "the main problem"이라 부른 것이다. 메커니즘은 이렇다. primary가 죽으면 그 shard의 replica가 살아 있는 primary들에게 표를 구한다. 그런데 Valkey는 **한 epoch에 primary 하나가 한 번만 투표할 수 있다** — 여러 replica가 같은 shard의 소유권을 두고 무한히 도는 걸 막기 위한 정상적인 설계다.

문제는 서로 다른 shard 둘이 **동시에** 표를 구할 때 생긴다. 살아 있는 primary들이 갈라져서 투표하면 어느 쪽도 quorum을 못 채우고, 둘 다 승격에 실패한 채 다음 epoch을 기다린다. shard 수백 개가 한꺼번에 죽는 상황에서는 이 분열이 반복돼 회복이 사실상 멈춘다.

{{< seq src="_seq/3-3-투표-분열.json" />}}

해결은 [#1018](https://github.com/valkey-io/valkey/pull/1018)이다. Valkey 메인테이너 Binbin Zhu 작성, 2025-01-11 머지 — **네 건 중 유일하게 AWS가 아닌 Tencent Cloud 소속 작성자**이고 유일하게 Valkey 8.1에 들어갔다. `failed_primary_rank` 필드를 추가해 failover 요청을 순서대로 흘린다. rank가 하나 밀릴 때마다 `FAILOVER_AUTH_REQUEST`를 약 500ms씩 뒤로 미뤄, 여러 primary가 동시에 죽어도 투표 창이 겹치지 않는다. primary가 하나만 죽는 경우의 동작은 그대로다.

무대 표현 하나는 정정이 필요하다. 발표자는 "we ordered it **lexicographically**"라고만 말하는데(23:29), PR이 실제로 정렬하는 키는 **죽은 primary의 shard-id**이고 대상도 **failed shard들 사이**로 한정된다. 노드 ID를 사전순으로 줄 세우는 게 아니다. 같은 PR·같은 저자·같은 메커니즘이니 틀린 말은 아니고 무대용 축약이다.

결과는 회복 시간 그래프로 나온다. **primary 1개 실패부터 499개 실패까지 전부 1분 이내에 자가 치유**했다.

### 3.4 pub/sub 헤더 2KB — #654

Valkey의 pub/sub은 cluster bus를 그대로 탄다. 아무 노드에나 publish하면 구독자가 붙은 노드로 전달되는 편의가 여기서 나온다. 문제는 **cluster bus 메시지 헤더가 pub/sub에 필요 없는 정보를 통째로 싣고 다녔다**는 것이다.

가장 큰 덩어리가 슬롯 소유권 비트맵이다. 산수가 정확히 맞는다 — `16384비트 = 2048바이트`, 즉 발표가 말한 2KB다. **100바이트짜리 메시지에 2KB 헤더가 붙는다.** 그런데 pub/sub 메시지는 슬롯을 신경 쓰지 않는다.

수정은 [#654](https://github.com/valkey-io/valkey/pull/654)다. Roshan Khatri 작성, 2024-07-26 머지, 이슈 [#557](https://github.com/valkey-io/valkey/issues/557)을 닫고 **Valkey 8.0**에 들어갔다 — 네 건 중 가장 이르다. `clusterMsgLight`라는 경량 헤더를 도입해 data union 앞에 고정 헤더만 남겼다. 8.0 이전 엔진과 통신할 때는 전체 메시지로 폴백한다.

여기서 발표와 공식 블로그가 어긋나는데, **어긋나는 쪽은 블로그다.** `clusterMsgLight`의 필드를 더하면 정확히 16바이트다.

| 필드 | 타입 | 바이트 |
|---|---|---|
| `sig[4]` | char[4] | 4 |
| `totlen` | uint32 | 4 |
| `ver` | uint16 | 2 |
| `notused1` | uint16 | 2 |
| `type` | uint16 | 2 |
| `notused2` | uint16 | 2 |
| **합계** | | **16** |

발표와 슬라이드는 16바이트라 말하고 이 구조체와 일치한다. [valkey.io 블로그](https://valkey.io/blog/1-billion-rps/)만 "~30 bytes"라고 적는다. **머지된 구조체가 이기므로 16바이트가 맞고 블로그가 이상값이다.** 최종 커밋을 바이트 단위로 대조하지는 않았으니 정밀도가 중요하면 `src/cluster_legacy.h`의 `clusterMsgLight`를 직접 읽는 게 맞다.

### 3.5 네 건 정리

| PR | 작성자 | 머지일 | 반영 버전 | 측정치 | 발표 주장과의 차이 |
|---|---|---|---|---|---|
| [#654](https://github.com/valkey-io/valkey/pull/654) pub/sub 경량 헤더 | Roshan Khatri | 2024-07-26 | **8.0** | 헤더 2048B → **16B** | 없음 — 발표가 맞고 valkey.io 블로그의 "~30B"가 이상값 |
| [#1018](https://github.com/valkey-io/valkey/pull/1018) failover 랭킹 | Binbin Zhu (Tencent Cloud) | 2025-01-11 | **8.1** | rank당 약 500ms 지연, 499 primary 실패도 60초 내 회복 | "lexicographically"는 축약 — 실제 정렬 키는 failed primary의 shard-id |
| [#2154](https://github.com/valkey-io/valkey/pull/2154) 재접속 스로틀링 | Sarthak Aggarwal (AWS) | 2025-07-22 | **9.0** | 450 kill 시 P99 CPU **-75%**, 노트 기준 100% → 40% | 없음 |
| [#2277](https://github.com/valkey-io/valkey/pull/2277) failure report rax | Seungmin Lee (AWS) | 2025-07-28 | **9.0** | 450노드 failover에서 CPU **30~35%** | 무대에서는 "28~30%" — 약간 후하다 |

**버전이 세 갈래로 갈린다는 게 실무에서 제일 중요하다.** "2,000노드가 된다"는 결론은 9.0의 것이지만, 네 수정 중 둘은 8.0/8.1에 이미 들어가 있다. 8.x에 머물러 있어도 pub/sub 헤더와 투표 분열은 이미 고쳐진 상태다.

## 4. 그래프를 다시 읽어라 — p99와 클러스터 전체는 다르다

여기가 이 문서가 발표에 가장 크게 덧붙이는 지점이다.

슬라이드의 CPU 스파이크 그래프는 100%에 붙는다. 그리고 이야기는 "재접속 폭풍이 컴퓨트를 태웠다"로 이어진다. 그런데 **그래프를 자세히 보면 100%에 붙는 계열은 하나뿐이고 그 이름이 `engine_cpu_percent_p99`다.** 같은 차트의 p90과 avg는 바닥에 깔린 채 거의 움직이지 않는다. 스로틀링 적용 후 슬라이드에는 스냅샷 시점 값이 p99 24.363 / p90 6.2 / avg 5.80으로 찍혀 있다.

| 계열 | 스파이크 구간 | 뜻 |
|---|---|---|
| `engine_cpu_percent_p99` | **100% 도달** | 상위 1% 노드가 포화 |
| `engine_cpu_percent_p90` | 한 자릿수 (스냅샷 6.2) | 상위 10%도 여유 |
| `engine_cpu_percent_avg` | 한 자릿수 (스냅샷 5.80) | 클러스터 평균은 한산 |

**즉 2,000노드 전체가 탄 게 아니라 일부 노드만 탔다.** 다만 그 "일부"의 크기는 노트가 확정해 주지 않는다 — "compute was consistently 100% for at atleast **5% of the nodes** at a time"은 **하한**이다. 2,000노드의 5%면 100대이니 최소 100대이고, 실제로는 그보다 많았을 수 있다. 이 문서도 정확한 규모는 확인하지 못했다.

이 구분이 왜 중요한가. 세 가지가 달라진다.

- **용량 산정이 달라진다.** 평균 한 자릿수를 보고 노드를 줄이면 정확히 그 포화 노드들이 먼저 죽는다. 반대로 p99 100%를 보고 전 클러스터를 키우면 대부분의 용량이 논다.
- **알람 설계가 달라진다.** 클러스터 평균 CPU 임계값으로는 이 사고가 안 잡힌다. 잡히는 건 **분위수 알람과 "포화 노드 비율"** 알람이다.
- **원인 추적이 달라진다.** 소수 노드가 탄다는 건 부하가 아니라 토폴로지 비대칭 — 어떤 노드가 유난히 많은 죽은 피어를 붙들고 있었다는 뜻이다.

**발표는 이 구분을 하지 않는다.** 스파이크를 클러스터 전체 현상처럼 서술하고 넘어간다. 잘못된 서술은 아니지만, 그래프를 그대로 옮겨 "2,000노드 클러스터가 CPU 100%를 쳤다"고 인용하면 원 데이터보다 훨씬 센 주장이 된다.

한 가지 더. 이 계열 이름들은 **ElastiCache/AWS 내부 메트릭이지 Prometheus 지표가 아니다.** Kubernetes에서 같은 그림을 그리려면 대응 지표를 직접 만들어야 한다 — pod별 CPU를 분위수로 집계하고, "CPU 90% 이상인 pod 수 / 전체 pod 수"를 별도 시계열로 뽑는 쪽이 이 발표의 그래프에 가장 가깝다.

## 5. Kubernetes로 올릴 때 — 조언과 그 근거 등급

발표의 Kubernetes 파트는 유용하지만, **대부분이 실측이 아니라 두 AWS 엔지니어의 운영 감각이다.** 그대로 두면 §3의 실측치와 같은 무게로 읽히므로 항목마다 등급을 붙였다.

등급은 셋이다. **EC2 실측** — 이 발표나 인용된 1차 문서에 수치가 있다. **경험칙** — 발표자의 운영 경험이고 수치가 없다. **미검증** — 발표는 말했지만 1차 문서에서 확인하지 못했다.

### 5.1 배치와 디스커버리

| 조언 | 근거 등급 | 근거 실체 |
|---|---|---|
| standalone은 StatefulSet + Helm 차트 | 경험칙 | [valkey-io/valkey-helm](https://github.com/valkey-io/valkey-helm)에 `valkey`(standalone/replication) 차트가 실제로 있다. 수치는 없다 |
| headless service 하나를 부트스트랩 시드로 | 경험칙 | 09:01 "typically in Kubernetes, you'll maybe have a headless service that just always has one configured node" |
| pod name을 node hostname으로 지정 | 경험칙 | 노드 ID는 기본 무작위다. 직접 지정할 수 있지만 발표자가 "프로덕션에서 쓰는 걸 많이 보지 못했다"고 덧붙인다(10:03) |
| CoreDNS 지연 피해 IP로 직결 | 경험칙 | 10:24~10:36. hostname은 TLS 검증용으로만 쓰라는 단서가 붙는다 |
| primary를 AZ에 고르게 분산 | 경험칙 | failover에 primary quorum이 필요하니 한 AZ에 몰리면 안 된다는 논리. AZ 장애 시험(3AZ, 약 666노드 동시 실패) 자체는 EC2 실측이지만 배치 규칙에 붙은 수치는 아니다 |
| replica를 primary와 다른 AZ에 | 경험칙 | 08:04. Valkey에 내장 수단이 없고 operator가 풀 문제라고 본인이 인정한다 |
| 클라이언트 AZ-local read | **EC2 실측**(단, 별건) | 이 발표가 아니라 [AZ affinity 블로그](https://valkey.io/blog/az-affinity-strategy/)의 AWS 워크로드 예시다 |

토폴로지를 클라이언트에 넘기는 명령을 발표는 [`CLUSTER SLOTS`](https://valkey.io/commands/cluster-slots/)로 시연한다(슬라이드 12~16). 슬라이드에 찍힌 응답에는 슬롯 범위, ip/port, 노드 id에 더해 `hostname`과 `availability-zone`이 들어 있다. **그런데 공식 문서와 어긋난다** — [`CLUSTER SHARDS` 문서](https://valkey.io/commands/cluster-shards/)는 노드 수준 `availability-zone`을 돌려주는 건 `CLUSTER SHARDS`이고 레거시 `CLUSTER SLOTS`는 hostname·AZ를 같은 방식으로 싣지 않는다고 적는다. 슬라이드가 설명용으로 손본 응답인지 문서가 뒤처진 것인지 이 문서는 확정하지 못했다. 실제로 토폴로지를 파싱할 거면 `CLUSTER SHARDS`를 쓰는 쪽이 문서와 일치한다. AZ-local read의 값어치는 이 발표가 아니라 [AZ affinity 블로그](https://valkey.io/blog/az-affinity-strategy/)에 숫자로 있다.

| 항목 | AZ affinity 없음 | 있음 |
|---|---|---|
| cross-AZ 데이터 전송 | 약 **$3,285/월** | 약 **$0** |
| 클러스터 기본 비용 | $1,088/월 | $1,088/월 |
| 지연 | 약 **800µs** | 약 **300µs** (-60%) |

[GLIDE](https://glide.valkey.io/how-to/connections/read-strategy/)는 네 가지 read 전략을 제공한다 — `PRIMARY`(기본), `PREFER_REPLICA`, `AZ_AFFINITY`, `AZ_AFFINITY_REPLICAS_AND_PRIMARY`. `AZ_AFFINITY`는 클라이언트가 자기 AZ를 `client_az`로 알려 줘야 동작하고, 서버 쪽은 Valkey 8.0+가 필요하다. **캐시 워크로드에서 이건 가장 저렴한 개선 중 하나다** — 코드 변경이 클라이언트 설정 두 줄이고 효과가 지연과 청구서 양쪽에 나온다.

### 5.2 리소스 — CPU limit을 걸지 마라

**발표가 내놓는 유일하게 모호하지 않은 판정이다.** 슬라이드 노트 원문이 명령형이다.

> Most caching scales on memory, not CPU. So co-locate caches. **Avoid setting CPU limits, because that will cause latency spikes!**

논리 사슬은 짧고 정확하다. 캐시는 메모리로 스케일하니 CPU가 남는다 → CPU 집약 워크로드와 같은 노드에 얹으면 양쪽 사용률이 좋아진다 → **그런데 캐시에 CPU limit을 걸면 동시 명령이 몰릴 때 지연 스파이크가 난다.**

왜 그런지는 발표가 다른 곳에서 이미 깔아 뒀다. Valkey의 메인 스레드는 여전히 단일 스레드다(12:22). 요청 하나는 마이크로초 단위지만 커넥션 수립은 수백 마이크로초다(27:57). **큐가 짧고 개별 작업이 짧은 시스템일수록 CFS throttle 한 번의 상대적 타격이 크다.** 평균 CPU 사용률이 limit의 절반이어도 순간 수요만으로 throttle이 걸리는 구조라, 지표상으로는 여유 있어 보이는데 p99만 무너진다.

| 판정 | 항목 | 근거 등급 |
|---|---|---|
| **필수** | CPU limit 제거 (requests만 설정) | 경험칙 — 발표자 노트가 명령형으로 적시. 수치는 없다 |
| 좋음 | 캐시와 CPU 집약 워크로드 co-locate | 경험칙 |

**메모리 쪽 조언은 이 표에 없다.** 발표도 슬라이드 노트도 메모리 requests·limits 설정을 한 번도 언급하지 않기 때문이다. 캐시가 메모리로 스케일한다는 전제를 받아들이면 메모리는 `requests = limits`로 고정하는 쪽이 맞다고 보지만, 그건 **이 문서의 추론이지 발표자의 조언이 아니다.**

같은 CPU limit 문제를 커널 쪽에서 본 문서가 [k8s-features 03 CPU Burst]({{< relref "../../../k8s-features/03-cpu-burst.md" >}})다 — throttling이 평균이 아니라 꼬리를 망가뜨린다는 게 거기 실측으로 나온다.

### 5.3 커넥션

발표자가 "Kubernetes 클러스터에서 보는 가장 큰 문제"로 지목한 것이 커넥션이다(11:30~11:44) — pod 수천 개가 각자 캐시 노드로 연결을 여는 순간 개별 노드가 죽는다.

| 조언 | 근거 등급 | 근거 실체 |
|---|---|---|
| connection pooling 필수 | **EC2 실측**(별건) | [AWS Database 블로그](https://aws.amazon.com/blogs/database/best-practices-valkey-redis-oss-clients-and-amazon-elasticache/) 벤치마크 — PHPRedis 풀링 없음 2.82ms/op vs 영속 연결+풀링 0.21ms/op, 약 13배 |
| retry 상한 + jitter 백오프 | 경험칙 | 발표는 "limit connection retries"까지만. 지수 백오프+지터의 구체 파라미터는 위 AWS 블로그(Lettuce 기준 min 1s / max 5s) |
| topology refresh를 합쳐라 | 경험칙 | 12:34~12:46. [GLIDE](https://github.com/valkey-io/valkey-glide)가 커넥션별 개별 refresh를 하나로 모은다 |
| Envoy는 **커넥션 풀링 용도로만** | 경험칙 | 11:45~11:54 |
| 1B RPS 실험도 풀링을 썼다 | **EC2 실측** | Q&A 27:40 — 질문이 정확히 이것이었고 답이 "yes" |

**Envoy에 대한 발표의 입장이 두 갈래라는 걸 놓치면 안 된다.** 토폴로지를 숨기려고 Envoy를 앞에 두는 건 "a little bit of an antiquated concept"이라고 깎는다 — 요즘 클라이언트가 충분히 좋고, RESP는 L7 HTTP 프록시가 이해하기엔 특이한 프로토콜이라 엔진에 직접 붙을 때의 이점을 잃는다는 것이다. 그런데 **커넥션 풀링을 Envoy 계층에서 하는 건 "one good reason"이라고 명시적으로 인정한다.** 슬라이드도 "Proxies (like envoy!) can help with **connection limits**"라고 용도를 좁혀 적는다. 토폴로지 추상화용으로 쓰면 안 되고, 커넥션 수를 줄이는 용도면 쓸 만하다.

이 실패 모드 자체를 정면으로 다룬 별도 글이 [Managing Connection Storms in Valkey at Scale](https://valkey.io/blog/managing-connection-storms-in-valkey-at-scale/)이다 — 멀티플렉싱으로 `n×p` 커넥션 방정식을 줄이는 방법, 프록시 계층이 커넥션 증가를 곱셈에서 선형으로 바꾸는 구조, Uber와 Snap의 대응(노드별 rate limiter·서킷 브레이커, CPU 95%에서 load shedding)이 정리돼 있다.

## 6. operator는 지금 쓸 수 있나

발표가 여러 번 가리키는 미래가 [valkey-io/valkey-operator](https://github.com/valkey-io/valkey-operator)다. Q&A의 마지막 질문 — "초기화할 때 모든 pod가 primary가 돼 버리지 않게 어떻게 보장하나" — 에 대한 답도 결국 operator였다.

**판정: 부적합.** 지금 프로덕션에 넣을 것은 아니다.

| 항목 | 상태 | 판정 |
|---|---|---|
| API 버전 | `valkey.io/v1alpha1`, README가 "may change in future releases" | **부적합** |
| 성숙도 | README 원문 "This operator is in active development and **not ready for production use**" | **부적합** |
| 서버 요구사항 | scale-out/in에 **Valkey 9.0+** 필요 | **반쪽** |
| 배포 모드 | cluster 모드 전용 | **반쪽** |
| 미지원 | cert-manager, module, backup | **없음** |
| `spec.shards` / `spec.replicas` | quickstart CR에 최상위 필드로 실재 | **좋음** |

마지막 행이 Q&A 주장을 확인해 준다. quickstart 예제가 `spec: {shards: 3, replicas: 1}`로 "3-shard cluster with 1 replica per shard (6 pods total)"를 만든다. **shard가 StatefulSet 개수로 환산되는 파생 개념이 아니라 진짜 1급 필드다** — "the operator does basically support these first-class constructs as shards"는 정확한 서술이다.

그동안의 대안으로 발표자가 준 것이 replica migration이다. 본인이 "the poor man's solution"이라 부른다. 노드를 전부 클러스터에 넣고 일부를 replica로 세워 두면, replica 없는 primary가 생겼을 때 유휴 노드가 알아서 가서 붙는다. 관련 설정 세 개를 `valkey.conf`에서 확인했다.

| 설정 | 기본값 | 동작 |
|---|---|---|
| `cluster-migration-barrier` | 1 | 자기 primary에 replica가 최소 1개 남을 때만 이주한다 |
| `cluster-allow-replica-migration` | yes | `no`면 고아 primary로의 이주가 꺼진다 |
| `cluster-node-timeout` | 15000 (ms) | 장애 감지 창 |

부수적인 사실 하나. valkey-helm 메인테이너 목록에 `jdheyburn`이 있는데, **바로 다음 세션의 발표자 Joe Heyburn(Braze)이다.** 발표자가 "Joe가 operator를 얘기할 것"이라 예고한 배경이 이것이다. 다만 [Joe의 세션 초록](https://kccnceu2026.sched.com/event/2CW6D/redis-on-ec2-to-valkey-on-kubernetes-a-zero-downtime-case-study-joe-heyburn-braze)에는 operator라는 단어가 없다 — Redis 250여 인스턴스를 EC2에서 Kubernetes로 무중단 이관한 사례 발표고, operator 언급은 [YouTube 설명란](https://www.youtube.com/watch?v=rNZ6HLiFgYI)에서만 확인된다.

## 7. 정리 — 넘어오는 것과 안 넘어오는 것

| 항목 | Kubernetes로 넘어오는가 | 이유 |
|---|---|---|
| 엔진 수정 4건 (#654 / #1018 / #2154 / #2277) | ✅ 그대로 | 배포 방식이 아니라 cluster bus 코드다. 버전만 맞추면 된다 |
| full-mesh · 16384 슬롯 · `cluster-node-timeout` | ✅ 그대로 | 인프라와 무관한 프로토콜 상수 |
| `CLUSTER SLOT-STATS` 기반 재샤딩 절차 | ✅ 그대로 | 명령 단위 도구, 8.0+ |
| atomic slot migration | ✅ 그대로 | 9.0+ |
| p99와 클러스터 전체를 가르는 관측 규율 | ✅ 오히려 더 필요 | pod가 많을수록 소수 포화가 평균에 더 묻힌다 |
| CPU limit 금지 | ✅ Kubernetes 전용 조언 | EC2에는 해당 개념이 없다 |
| 499 primary 실패 후 60초 내 회복 | ⚠️ 반쪽 | 엔진 회복 시간이다. pod 재스케줄·CNI·이미지 pull은 별도로 얹힌다 |
| 1B RPS | ✗ | `c7g.16xlarge` 750대의 부하 생성 능력이 전제다 |
| 코어 피닝(`taskset`/`cset`)·IRQ 어피니티(`ethtool`) | ✗ | cpuset·특권 컨테이너·노드 수준 접근이 필요하다 |
| "2,000노드 실증" 그 자체 | ✗ | Kubernetes에서 잰 적이 없다 |
| operator 기반 shard 관리 | ✗ 지금은 | `v1alpha1`, "not ready for production use" |

**세 문장으로 줄이면.**
이 발표가 증명한 건 Valkey **엔진**이 2,000노드에서 자가 치유한다는 것이고, 그 증명은 EC2에서 이뤄졌으며 코드는 8.0·8.1·9.0에 나눠 들어가 있다 — 그래서 Kubernetes에서 챙길 첫 번째는 배포 토폴로지가 아니라 **버전**이다.
Kubernetes 파트에서 실측이 뒷받침하는 조언은 사실상 **CPU limit을 걸지 마라** 하나뿐이고, 나머지 배치·디스커버리 조언은 좋은 경험칙이되 이 발표의 수치와 같은 무게로 인용하면 안 된다.
그리고 슬라이드의 CPU 100% 그래프는 `p99` 계열이다 — **소수 노드가 탔지 클러스터가 탄 게 아니고**, 이 구분이 용량 산정과 알람 설계를 바꾼다.

## 8. 확인하지 못한 항목

{{< callout type="warning" >}}
**아래는 이 문서가 확인하지 못했거나 1차 문서와 어긋나는 지점이다.** 인용할 때 그대로 밝혀라.

- **"1,000노드 부근에서 cluster bus CPU 1~2%"(05:38)의 1차 출처를 찾지 못했다.** cluster-spec에도 1-billion-rps 블로그에도 없다. **슬라이드-only 주장**으로 취급하라.
- **발표자가 언급한 2025년 선행 발표(02:49 "we did a similar talk last year")를 찾지 못했다.** kccnceu2025 전 일정, 양 발표자의 valkey.io 저자 페이지, YouTube/CNCF 검색을 모두 훑었으나 일치하는 것이 없었다. KubeCon NA 2025(Atlanta)는 확인하지 않았고 남은 후보로 가장 유력하다.
- **`CLUSTER SHARDS`의 `availability-zone` 필드 시점이 어긋난다.** [명령 문서](https://valkey.io/commands/cluster-shards/)는 노드 수준 `availability-zone` 필드가 **9.1.0에서 추가**됐다고 적는데, [AZ affinity 블로그](https://valkey.io/blog/az-affinity-strategy/)는 서버 `availability-zone` **설정**이 Valkey 8에 들어왔다고 적는다. 설정과 응답 필드가 서로 다른 릴리스에 들어온 것으로 보이지만 **이 문서는 그 관계를 확정하지 못했다.**
- **슬라이드의 `CLUSTER SLOTS` 응답이 명령 문서와 어긋난다.** 슬라이드 13~16의 `CLUSTER SLOTS` 응답에는 `hostname`과 `availability-zone`이 들어 있는데, `CLUSTER SHARDS` 문서는 레거시 `CLUSTER SLOTS`가 이 둘을 같은 방식으로 싣지 않는다고 적는다. 슬라이드가 설명을 위해 손본 응답인지 문서가 뒤처진 것인지 **확인하지 못했다.**
- **재접속 폭풍 콜스택은 슬라이드 이미지에서 읽었다.** 전사에도 슬라이드 텍스트 추출본에도 이 심볼들은 없다. 이미지 판독 결과이므로 정확한 심볼명이 중요하면 원본 PPTX의 해당 flame graph를 직접 보라.
- **재접속 폭풍이 태운 노드 규모는 하한만 알 수 있다.** 슬라이드 노트의 "atleast 5% of the nodes"는 최소값이고, 실제 포화 노드 비율을 밝힌 자료를 찾지 못했다.
- **Roshan Khatri(#654 작성자)의 소속을 확인하지 못했다.** GitHub 프로필에 회사 표기가 없고 1-billion-rps 블로그 저자 목록에도 없다. 나머지 세 명(Sarthak Aggarwal·Seungmin Lee = AWS, Binbin Zhu = Tencent Cloud)은 확인했다.
- **#2154 / #2277 / #1018의 버전 귀속은 GitHub milestone이 아니라 추론이다.** 세 PR 모두 milestone 필드가 비어 있어, valkey.io 블로그의 명시적 서술 + 머지일과 9.0.0 GA(2025-10-21)의 시간 관계로 판정했다. #654 → 8.0도 같은 종류의 추론이다.
- **#654의 16바이트는 PR 본문의 구조체 정의에서 합산한 값이다.** 최종 머지 커밋을 바이트 단위로 대조하지는 않았다.
- **Pokémon Go / Niantic의 "예측 대비 50배" 이야기(01:15~02:00)를 확인하지 않았다.** 슬라이드에 [Google Cloud 블로그 링크](https://cloud.google.com/blog/products/containers-kubernetes/bringing-pokemon-go-to-life-on-google-cloud)가 붙어 있지만 이 문서의 검증 대상이 아니었다.
- **발표가 참조한 Envoy 관련 Valkey 공식 문서를 찾지 못했다**(13:02). 발표자의 경험칙 이상으로 볼 근거가 없다.
- **전사 오인식 주의.** 자동 자막이 Valkey를 "Valkyrie", Madelyn을 "Madeline/Merlin/Marlin", StatefulSet을 "stateless set", etcd를 "CD", RESP를 "the REST protocol", 16384를 "16,000"으로 적는다. 전사를 그대로 인용하지 마라.
{{< /callout >}}

## 9. 출처

### 발표

- **발표 영상(CNCF 채널, 30:27)** — [youtube.com/watch?v=t0qax1qQm14](https://www.youtube.com/watch?v=t0qax1qQm14)
- **세션 페이지(sched, 초록·발표자·시간·방)** — [kccnceu2026.sched.com/event/2CW5d](https://kccnceu2026.sched.com/event/2CW5d)
- **슬라이드 원본(PPTX, 54장, 발표자 노트 포함)** — [hosted-files.sched.co/.../Scaling Large Clusters with Valkey FINAL.pptx](https://hosted-files.sched.co/kccnceu2026/06/Scaling%20Large%20Clusters%20with%20Valkey%20FINAL.pptx)
- **KubeCon EU 2026 개최 정보(Amsterdam, 3/23~26)** — [cncf.io/blog/2025/08/05/kubecon-cloudnativecon-europe-2026-returning-to-amsterdam](https://www.cncf.io/blog/2025/08/05/kubecon-cloudnativecon-europe-2026-returning-to-amsterdam-23-26-march/)
- **서면판 — 1B RPS 스케일 테스트 전말** — [valkey.io/blog/1-billion-rps](https://valkey.io/blog/1-billion-rps/)
- **flame graph 기법(발표가 쓴 `perf` 결과물의 표준 레퍼런스)** — [brendangregg.com/flamegraphs.html](https://www.brendangregg.com/flamegraphs.html)

### Valkey 공식 문서

- **Cluster specification(full mesh · gossip · 16384 슬롯 · replica migration)** — [valkey.io/topics/cluster-spec](https://valkey.io/topics/cluster-spec/)
- **`valkey.conf` unstable(`cluster-node-timeout` 1844행, migration 관련 1895~1922행)** — [raw.githubusercontent.com/valkey-io/valkey/unstable/valkey.conf](https://raw.githubusercontent.com/valkey-io/valkey/unstable/valkey.conf)
- **`CLUSTER SLOT-STATS`(8.0.0~, 슬롯 단위 4개 지표)** — [valkey.io/commands/cluster-slot-stats](https://valkey.io/commands/cluster-slot-stats/)
- **`CLUSTER SHARDS`(슬롯 범위·endpoint·`availability-zone`)** — [valkey.io/commands/cluster-shards](https://valkey.io/commands/cluster-shards/)
- **Atomic Slot Migration(9.0~)** — [valkey.io/topics/atomic-slot-migration](https://valkey.io/topics/atomic-slot-migration/)
- **Valkey 9.0 릴리스 소개** — [valkey.io/blog/introducing-valkey-9](https://valkey.io/blog/introducing-valkey-9/)
- **Valkey 9.0.0 릴리스 노트(GA 2025-10-21)** — [github.com/valkey-io/valkey/releases/tag/9.0.0](https://github.com/valkey-io/valkey/releases/tag/9.0.0)
- **Linux Foundation Valkey 출범 발표(Redis 7.2 포크·BSD-3)** — [linuxfoundation.org/press/linux-foundation-launches-open-source-valkey-community](https://www.linuxfoundation.org/press/linux-foundation-launches-open-source-valkey-community)

### 업스트림 PR · 이슈

- **재접속 스로틀링 PR(9.0)** — [valkey-io/valkey#2154](https://github.com/valkey-io/valkey/pull/2154)
- **위 PR이 닫은 이슈(clusterCron 재접속 CPU 오버헤드)** — [valkey-io/valkey#2122](https://github.com/valkey-io/valkey/issues/2122)
- **failure report radix tree PR(9.0)** — [valkey-io/valkey#2277](https://github.com/valkey-io/valkey/pull/2277)
- **위 PR이 닫은 이슈(`clusterNodeCleanupFailureReports` 병목)** — [valkey-io/valkey#2139](https://github.com/valkey-io/valkey/issues/2139)
- **failover 랭킹 PR — 투표 분열 해소(8.1)** — [valkey-io/valkey#1018](https://github.com/valkey-io/valkey/pull/1018)
- **pub/sub 경량 헤더 PR(8.0)** — [valkey-io/valkey#654](https://github.com/valkey-io/valkey/pull/654)
- **위 PR이 닫은 이슈(모든 cluster bus 메시지에 2KB 슬롯 비트맵)** — [valkey-io/valkey#557](https://github.com/valkey-io/valkey/issues/557)

### 생태계

- **valkey-operator(WIP, `v1alpha1`)** — [github.com/valkey-io/valkey-operator](https://github.com/valkey-io/valkey-operator)
- **valkey-operator quickstart(`spec.shards` CR 예제·현재 제약)** — [raw.githubusercontent.com/valkey-io/valkey-operator/main/docs/quickstart.md](https://raw.githubusercontent.com/valkey-io/valkey-operator/main/docs/quickstart.md)
- **valkey-helm(차트 3종, 메인테이너에 jdheyburn)** — [github.com/valkey-io/valkey-helm](https://github.com/valkey-io/valkey-helm)
- **Helm 저장소 인덱스** — [valkey.io/valkey-helm](https://valkey.io/valkey-helm/)
- **valkey-glide(Rust 코어 다국어 클라이언트)** — [github.com/valkey-io/valkey-glide](https://github.com/valkey-io/valkey-glide)
- **GLIDE read 전략 — AZ affinity 설정법** — [glide.valkey.io/how-to/connections/read-strategy](https://glide.valkey.io/how-to/connections/read-strategy/)
- **AZ affinity의 지연·비용 효과($3,285/월 → $0, 800µs → 300µs)** — [valkey.io/blog/az-affinity-strategy](https://valkey.io/blog/az-affinity-strategy/)
- **valkey-py** — [github.com/valkey-io/valkey-py](https://github.com/valkey-io/valkey-py)
- **valkey-go(auto-pipelining·client-side caching)** — [github.com/valkey-io/valkey-go](https://github.com/valkey-io/valkey-go)
- **커넥션 스톰 대응 정리(Uber·Snap 사례 포함)** — [valkey.io/blog/managing-connection-storms-in-valkey-at-scale](https://valkey.io/blog/managing-connection-storms-in-valkey-at-scale/)
- **클라이언트 베스트프랙티스 — 풀링 13배·백오프 파라미터** — [aws.amazon.com/blogs/database/best-practices-valkey-redis-oss-clients-and-amazon-elasticache](https://aws.amazon.com/blogs/database/best-practices-valkey-redis-oss-clients-and-amazon-elasticache/)
- **IO thread 최적화로 단일 노드 1M RPS(8.0)** — [valkey.io/blog/unlock-one-million-rps](https://valkey.io/blog/unlock-one-million-rps/)

### 관련 세션

- **바로 다음 세션 — Redis on EC2 to Valkey on Kubernetes(Joe Heyburn, Braze) 세션 페이지** — [kccnceu2026.sched.com/event/2CW6D](https://kccnceu2026.sched.com/event/2CW6D/redis-on-ec2-to-valkey-on-kubernetes-a-zero-downtime-case-study-joe-heyburn-braze)
- **같은 세션 영상(operator 언급이 확인되는 설명란)** — [youtube.com/watch?v=rNZ6HLiFgYI](https://www.youtube.com/watch?v=rNZ6HLiFgYI)
- **슬라이드가 인용한 Pokémon Go 용량 사례(미검증)** — [cloud.google.com/blog/.../bringing-pokemon-go-to-life-on-google-cloud](https://cloud.google.com/blog/products/containers-kubernetes/bringing-pokemon-go-to-life-on-google-cloud)
