---
title: "AWS 에서 엔드포인트는 어떻게 바뀌나"
weight: 7
---

# 07 · AWS 에서 엔드포인트는 어떻게 바뀌나 — CMD · CME · Serverless · MemoryDB

{{< callout type="info" >}}
**한눈에**
- **엔드포인트는 접속 주소처럼 보이지만 실제로는 토폴로지의 표현이다.** CMD(cluster mode disabled)는 primary·reader·node 3종을 갖고, CME(cluster mode enabled)는 configuration endpoint **1개뿐**이다. CME 에는 primary/reader endpoint 라는 개념 자체가 없다 `✓` — `DescribeReplicationGroups` 응답에 그 필드가 나오지 않는 것은 문서의 응답 예시로 확인한 것이고 규정 문장은 없다 `≈`
- **이름으로 판별할 수 있다.** 이름 안에 `clustercfg` 가 있으면 cluster 프로토콜 전용(CME 또는 MemoryDB), `.ng.0001.` 이면 CMD primary, `.serverless.` 면 Serverless, `.cfg.` 면 Memcached 다 `✓`
- **모드 전환은 단방향이다.** `disabled → compatible → enabled` 2단계이고 AWS 문서가 *"Reverting this configuration is not possible"* 라고 못박았다. 되돌릴 수 있는 것은 `compatible → disabled` 뿐이다 `✓`
- **"엔드포인트만 갈아끼우면 된다"가 틀리는 이유는 3종 세트이기 때문이다** — 엔드포인트 문자열 + 클라이언트(cluster 프로토콜 지원) + 애플리케이션의 다중 키 연산(같은 슬롯 강제). 하나라도 빠지면 `CROSSSLOT` 으로 런타임에 터진다 `✓`
- **엔진 전환은 정반대다.** Redis OSS → Valkey 는 in-place 이고 *"including the endpoint DNS name, will remain unchanged"* 다. 바뀌는 것은 노드 IP 뿐이다 — 모드 전환과 엔진 전환의 리스크를 섞으면 계획서가 통째로 틀린다 `✓`
- **TLS 켜기는 설정 토글로 보이지만 실은 엔드포인트 마이그레이션이다.** 포트는 6379 그대로이고 **DNS 레코드 형식**이 바뀐다. per-node DNS 이름은 `preferred` 로 넘어가는 시점에 이미 삭제·재생성되고, 구 non-TLS primary/reader 는 `required` 에서 **삭제**된다 `✓`
- **failover 자체는 몇 초다. 장애 시간을 만드는 것은 클라이언트 DNS 캐시다.** AWS 문서가 JVM `networkaddress.cache.ttl` 을 5~10초로 낮추라고 직접 지시하고, 기본값이면 *"never refresh DNS entries until the JVM is restarted"* 라고 경고한다. security property 라서 `-D` 플래그로는 안 들어간다 `✓`
- **Serverless 는 클라이언트를 편하게 해주지 않는다.** 항상 cluster mode 로 동작하고 TLS 가 강제이며, Read from Replica 를 쓰지 않아도 **6380 을 열어야** 커넥션 수립이 느려지지 않는다 `✓`
- **관리형은 `config`·`debug`·`cluster setslot` 을 막는다.** 남는 유일한 설정 경로가 파라미터 그룹이고, 이것이 self-host 를 고민하는 실질적 이유다 `✓`
{{< /callout >}}

> **왜 이 문서인가.** ElastiCache 로 넘어갈 때 가장 흔한 실패는 "주소만 바꾸면 되는 줄 알았다"다. 그런데 ElastiCache 의 엔드포인트는 편의를 위한 별칭이 아니라 **클러스터 토폴로지를 DNS 로 노출한 결과물**이다. 그래서 모드를 바꾸면 주소 구조가 바뀐다. 주소 구조가 바뀌면 클라이언트 라이브러리의 종류가 바뀌고, 클라이언트가 바뀌면 애플리케이션의 다중 키 연산까지 바뀐다. 이 연쇄를 끊어서 보면 어느 단계에서든 사고가 난다. 반대로 이 연쇄를 알면 **엔드포인트 문자열만 보고도 그 앱이 무엇을 해야 하는지 판정**할 수 있다.

> 근거 기준: AWS 관련 사실은 전량 `docs.aws.amazon.com` · `aws.amazon.com/about-aws/whats-new` 본문을 직접 읽어 인용했고, 확인 시점은 **2026-08-06** 이다. **DNS 패턴은 AWS 문서에 실린 예시만 옮겼다** — 실계정 `aws elasticache describe-*` 로 교차검증하지 않았으므로 문서에 없는 형태는 `?` 로 남겼다 `✓` 자체 운영 대조군(§10)은 로컬 클론 `valkey 9.1.1:valkey.conf` 와 valkey.io 공식 문서를 근거로 한다. cluster 자체의 내부 원리(슬롯·MOVED/ASK·gossip)는 [cluster mode]({{< relref "../06-cluster-mode/index.md" >}})가, 엔진 버전별 기능은 [Redis 7.0 → 8.10]({{< relref "../04-redis-7-to-8.md" >}})·[Valkey 8.0 → 9.1]({{< relref "../05-valkey-8-to-9/index.md" >}})이 소유한다.

## 1. 엔드포인트 종류 — 배포 형태가 주소 구조를 결정한다

이 표가 이 문서의 핵심 산출물이다. **DNS 패턴 열에는 AWS 문서에 실제로 실린 예시·템플릿만 넣었다.** 문서에 없는 것은 지어내지 않고 `?` 로 표시했다.

| 배포 형태 | 엔드포인트 이름 | 용도 | 개수 | DNS 패턴 |
|---|---|---|---|---|
| ElastiCache **CMD** | **primary endpoint** | 쓰기 전량. 항상 현 primary 로 resolve — replica 승격에 영향받지 않는다 | 1 (단일 노드 클러스터에는 **없다**) | `{{clusterName.xxxxxx}}.{{nodeId}}.{{regionAndAz}}.cache.amazonaws.com:{{port}}` → 실례 `redis-01.7abc2d.0001.usw2.cache.amazonaws.com:6379`. CLI 응답 실례에는 **`.ng.0001.`** 세그먼트 (`redis12.v5r9dc.ng.0001.usw2.cache.amazonaws.com`) `✓` |
| ElastiCache CMD | **reader endpoint** | 읽기. replica 들에 커넥션을 분산 | 1 | 접미 **`-ro`** — `test-cluster-ro.g2xbih.ng.0001.usw2.cache.amazonaws.com` (CLI 레퍼런스 예시) `✓` |
| ElastiCache CMD | **node endpoint** (API/CLI 명칭 `ReadEndpoint`) | 특정 노드 지정 | 노드 수 | 접미 `-001`/`-002`, `ng` 없음 — `redis12-001.v5r9dc.0001.usw2.cache.amazonaws.com` `✓` |
| ElastiCache CMD, **TLS on** | primary endpoint | 위와 동일 | 1 | `master.{{clusterName}}.{{xxxxxx}}.{{regionAndAz}}.cache.amazonaws.com:{{port}}` → 실례 `master.ncit.ameaqx.use1.cache.amazonaws.com:6379`. **다른 페이지의 stunnel 예시는 `primary.` 접두사를 쓴다 — 문서 간 불일치** `?` |
| ElastiCache **CME** | **configuration endpoint** | 토폴로지 진입점. 여기 붙어 각 샤드의 primary·read 엔드포인트를 발견한다. **primary/reader endpoint 는 존재하지 않는다** | 1 | **infix 형만 문서화**: `redis2x2.9dcv5r.clustercfg.usw2.cache.amazonaws.com:6379`. 실무에서 흔한 prefix 형 `clustercfg.<name>.…` 은 **ElastiCache 문서에 없다** `?` |
| ElastiCache CME | node endpoint | 개별 노드에서 읽기(선택) | 노드 수 | CME 절에 DNS 예시가 없다 `?` |
| ElastiCache **Serverless** | primary (포트 **6379**) | 강한 일관성 · 쓰기 | DNS 1개 | `test-12345.serverless.use1.cache.amazonaws.com:6379` `✓` |
| ElastiCache Serverless | read-optimized (포트 **6380**) | 가능하면 클라이언트와 같은 AZ 의 replica 로 읽기 라우팅 | 같은 DNS | `test-12345.serverless.use1.cache.amazonaws.com:6380` `✓` |
| **MemoryDB** | **cluster endpoint** | 모든 연산. cluster 프로토콜 전용 | 1 | **prefix 형**: `clustercfg.my-cluster.xxxxxx.memorydb.us-east-1.amazonaws.com:6379` `✓` |
| ElastiCache **Memcached** | configuration endpoint | auto-discovery 진입점 | 1 | `.cfg.` **infix** — 템플릿 `{{myclustername.xxxxxx}}.cfg.usw2.cache.amazonaws.com:{{port}}`, 실례 `mycluster.fnjyzo.cfg.use1.cache.amazonaws.com:11211` `✓` |
| ElastiCache Memcached | node endpoint | 개별 노드 | 노드 수 | `{{myclustername.xxxxxx}}.0001.usw2.cache.amazonaws.com:{{port}}` `✓` |
| Memcached **Serverless** | cluster endpoint | 11211 + 11212 | 1 | `serverless-memcached-01.amazonaws.com` (문서에서 도메인 축약) `✓` |

**판별 규칙.** 이름 안에 `clustercfg` 가 있으면 cluster 프로토콜 엔드포인트이므로 cluster-aware 클라이언트가 필수다. `.ng.0001.` 은 CMD primary, `.serverless.` 는 ElastiCache Serverless, `cfg` 는 Memcached 다. IaC 리뷰나 인시던트 대응에서 이 규칙만으로 "이 앱이 cluster 클라이언트를 써야 하는가"를 판정할 수 있다 `Σ`

**그런데 CME 의 이름 형식은 문서가 규정한 적이 없다.** CMD 절은 TLS 유·무 두 템플릿을 다 주는데, CME 절("Finding Endpoints for a … Cluster Mode Enabled Cluster")은 *"The Configuration endpoint is displayed under Cluster details"* 로 끝나고 DNS 예시가 없다 `✓` 그래서 **CME configuration endpoint 의 이름을 미리 계산해 방화벽 규칙이나 CNAME 에 박아둘 문서적 근거가 없다.** Valkey/Redis CME 에 대한 CNAME 규칙도 문서에 없다 — `.cfg.` 를 CNAME 에 포함해야 한다는 규칙은 **Memcached auto-discovery 한정**이다 `✓`

### 1.1 Serverless — 단일 DNS, 포트 2개, 내부는 항상 cluster mode

Serverless 는 *"two different endpoints, for different consistency requirements. The two endpoints use the same DNS name but different ports"* 구조다 `✓` 6379 는 쓰기와 강한 일관성, 6380 은 read-optimized 다. 여기에 함정이 하나 있다 — *"Some clients establish connectivity to both ports for every new connection, even if your application is not using the Read from Replica feature"* 이므로 **6380 을 보안 그룹에서 안 열면 쓰지 않는데도 커넥션 수립이 느려진다** `✓`

샤드 수는 사용자에게 감춰지지만 **슬롯의 물리는 그대로 노출된다** — 단일 슬롯 한계가 30,000 ECPUs/s(Read from Replica 시 90,000)이므로 hot slot 은 그대로 병목이다 `✓` 스케일 속도는 *"up to 10-12 minutes to double the request rate"* 다 `✓` 그리고 Serverless 는 지정한 서브넷에 VPC Endpoint 를 만들기 때문에, 앱이 다른 AZ 에 있으면 cross-AZ hop 이 붙는다 `✓`

가장 중요한 것은 **CMD 앱을 Serverless 로 옮기는 것이 CMD → CME 전환과 같은 작업**이라는 점이다. *"ElastiCache Serverless always operates in Cluster Mode"* 이고 *"only accessible using clients that support the … cluster mode protocol"* 이며 TLS 가 강제다. CMD 가 필요하면 *"you must create a node-based cluster"* 다 `✓`

### 1.2 MemoryDB — cluster endpoint 하나, 그리고 2026 년에 포지셔닝이 바뀌었다

MemoryDB 는 엔드포인트가 `cluster endpoint` 하나이고 *"You need to connect to the cluster endpoint to discover node endpoints using cluster nodes or cluster slots command"* 다 — 즉 구조적으로 CME 와 같다 `✓` 노드별 엔드포인트는 *"not necessary for normal usage"* 로 명시된다 `✓` (문서가 "MemoryDB 는 항상 cluster mode 다"라고 직접 쓴 문장은 찾지 못했다. `ClusterMode`/`cluster-enabled` 에 해당하는 API 파라미터가 없다는 **간접 근거**뿐이다 `?`)

판단에 직접 영향을 주는 변화는 2026-06 에 왔다. ElastiCache 문서의 서비스 비교 항목이 *"With durability enabled, ElastiCache for Valkey can also serve as a durable datastore"* 로 바뀌고, MemoryDB 권고가 **"You should consider using MemoryDB if your workload requires multi-Region active-active replication with conflict-free data types (CRDTs). For single-Region durable workloads, consider using ElastiCache with durability enabled."** 로 좁아졌다 `✓` 즉 **"내구성이 필요하면 MemoryDB" 라는 2021\~2025 년의 판단 근거는 더 이상 AWS 자신의 권고가 아니다.** 엔진 버전 격차도 실무 요소다 — MemoryDB 문서의 엔진 버전 목록은 7.3(2024-12-01) / Valkey 7.2.6 까지인데 ElastiCache 는 Valkey 9.1 까지 간다 `✓` (2025\~2026 년에 MemoryDB 용 Valkey 8/9 발표가 있었는지는 확인하지 못했다 `?`)

## 2. 같은 애플리케이션이 CMD 와 CME 에서 어디로 붙나

{{< flow src="_flow/2-cmd-와-cme-의-엔드포인트.json" />}}

## 3. CMD 의 동작 — DNS 로 primary 를 옮기고, 클라이언트 캐시가 그것을 망친다

노드가 여러 개인 CMD 클러스터는 *"three types of endpoints; the primary endpoint, the reader endpoint and the node endpoints"* 를 갖는다 `✓`

**primary endpoint** 는 *"a DNS name that always resolves to the primary node in the cluster. The primary endpoint is immune to changes to your cluster, such as promoting a read replica to the primary role"* 다 `✓` failover 가 나면 ElastiCache 가 *"propagates the Domain Name Service (DNS) name of the promoted replica"* 하므로 애플리케이션 설정은 바꿀 필요가 없고, 쓰기 재개는 *"typically just a few seconds"* 다 `✓` 엔진 버전이 갈리는 지점이 있다 — Multi-AZ 를 켠 CMD 는 **5.0.6 이상**에서 계획된 노드 교체가 쓰기를 계속 처리하며 끝나지만, **4.0.10 이하**는 *"a brief write interruption associated with DNS updates"* 가 생긴다 `✓`

**reader endpoint 는 로드밸런서가 아니다.** 문서가 명시적으로 부정한다 — *"A reader endpoint is not a load balancer. It is a DNS record that will resolve to an IP address of one of the replica nodes in a round robin fashion."* `✓` 대신 replica 증감은 실시간으로 따라간다(*"keep up with cluster changes in real-time as replicas are added or removed"*) `✓` 여기서 실무 함정이 나온다. 커넥션 풀을 프로세스 시작 시 한 번 만들어 계속 재사용하는 앱은 **한 replica 에 모든 커넥션이 몰릴 수 있다.** 문서도 *"Additional factors such as when the application creates the connections or how the application (re)-uses the connections will determine the traffic distribution"* 라고 인정한다 `✓` 읽기 부하를 진짜로 나누려면 클라이언트 측 read-preference 설정을 쓰거나 CME 로 가야 한다 `Σ`

**node endpoint** 는 *"resolve to specific endpoints. If you make a change in your cluster, such as adding or deleting a replica, you must update the node endpoints in your application"* 이다 `✓` 즉 이 주소를 설정에 박아둔 앱은 스케일링과 TLS 전환에서 반드시 깨진다.

### 3.1 DNS TTL — AWS 문서가 직접 지목하는 유일한 클라이언트 설정

failover 는 몇 초에 끝나지만, 우리 앱이 겪는 장애 시간은 **새 IP 를 언제 인지하느냐**로 결정된다. AWS 문서가 이례적으로 구체적으로 지시한다 — *"Because ElastiCache nodes use DNS name entries that might change, we recommend that you configure your JVM with a low TTL of 5 to 10 seconds."* 그리고 결정적 경고: **"On some Java configurations, the JVM default TTL is set so that it will never refresh DNS entries until the JVM is restarted."** `✓`

대상 값은 `networkaddress.cache.ttl` 인데 이것은 **security property 라서 `-D` 시스템 프로퍼티로 넣을 수 없다** — `java.security.Security.setProperty("networkaddress.cache.ttl", "5")` 를 코드에서 호출하거나 `java.security` 파일을 고쳐야 한다 `✓` 그리고 캐시는 한 층이 아니다 — *"Client-side DNS caching can occur in multiple places, including client libraries, the language runtime, or the client operating system"* `✓`

**CMD 는 토폴로지 디스커버리를 아예 쓸 수 없다.** 문서 원문: *"Cluster mode disabled clusters don't support the cluster discovery commands and aren't compatible with all clients dynamic topology discovery functionality."* Lettuce 를 쓰는 경우 `MasterSlaveTopologyRefresh` 가 호환되지 않으므로 `StaticMasterReplicaTopologyProvider` 에 read/write 엔드포인트를 주는 방식이 문서 권고다 `✓` 즉 **CMD 에서 "클라이언트가 알아서 새 primary 를 찾는" 경로는 없다.** DNS 가 유일한 통보 수단이고, 그래서 TTL 이 전부다 `Σ`

Multi-AZ 자동 failover 자체에도 전제가 붙는다 — 샤드마다 노드가 2개 이상이어야 하고(*"only supported on … clusters with more than one node in each shard"*), CMD 는 *"at least one available read replica"* 가 필요하며, **AOF 와는 상호배타**다(*"Multi-AZ and append-only file (AOF) are mutually exclusive"*) `✓` 그리고 *"A customer-initiated reboot of a primary doesn't trigger automatic failover"* — 사용자가 primary 를 리부트하면 failover 가 아니라 데이터 소실로 간다 `✓`

## 4. CME 의 동작 — configuration endpoint 는 접속점이 아니라 토폴로지 진입점이다

CME 는 *"a single configuration endpoint. By connecting to the configuration endpoint, your application is able to discover the primary and read endpoints for each shard in the cluster"* 다 `✓` 그리고 클라이언트 요구사항이 문서에 조건으로 박혀 있다 — *"You must use a client that supports either Valkey Cluster or Redis OSS Cluster."* `✓`

구조가 API 응답에서도 드러난다. CME 의 `DescribeReplicationGroups` 는 최상위에 `ConfigurationEndpoint` + `ClusterEnabled: true` 를 담고 `NodeGroups[]` 안에 `PrimaryEndpoint`/`ReaderEndpoint` 가 **없다**. CMD 는 반대로 `NodeGroups[0].PrimaryEndpoint` + `ReaderEndpoint` 를 담고 `ConfigurationEndpoint` 가 없다 `✓` (스키마상 두 필드 모두 `Required: No` 이고, 어느 모드에서 어느 필드가 나온다고 **규정한 문장은 없다** — 문서 예시로 확인한 것이다 `≈`) "CME 로 갔는데 primary endpoint 를 못 찾겠다"는 혼란의 근본 원인이 여기다. **없는 게 정상이다.**

configuration endpoint 는 단일 A 레코드가 아니다 — *"The DNS lookup for this URI returns a list of all available nodes in the cluster, and is randomly resolved to one of them during the cluster initialization."* `✓` 즉 부트스트랩 시 임의의 한 노드로 들어가 거기서 슬롯 맵을 받는다. 그 뒤부터 라우팅 책임은 클라이언트에 있고, 그래서 **클라이언트의 토폴로지 갱신 설정이 곧 가용성 설정**이 된다. 문서가 지목하는 항목이 네 개다 `✓`

| 클라이언트 설정 | 문서가 말하는 동작 | 안 하면 |
|---|---|---|
| 주기적 토폴로지 갱신 | 기본 60초 간격. 끄면 *"the client updates the cluster topology only when errors occur"* | 장애를 커맨드 실패로만 알게 된다 |
| adaptive refresh trigger | `MOVED_REDIRECT`·`ASK_REDIRECT`·`PERSISTENT_RECONNECTS`·`UNCOVERED_SLOT`·`UNKNOWN_NODE` 를 받으면 즉시 재조회(기본 rate limit 30초) | 슬롯 이동 후 오래 헤맨다 |
| 동적 refresh source | `true` 면 발견한 **모든 노드**를 소스로 써 가장 정확한 뷰를 고른다. `false` 면 seed 만 쓰는데, *"if the cluster configuration endpoint is resolved to a failed node, trying to refresh the cluster view fails and leads to exceptions"* | 죽은 노드가 목록에서 빠지기 전 창에서 예외가 난다 |
| node filter | FAIL/EVENTUAL_FAIL/HANDSHAKE/NOADDR 노드를 걸러야 한다. failover 직후 *"the cluster bus nodes map has a short period of time that the down node is listed as a FAIL node"* 이고 클라이언트가 그것을 정상 노드로 보고 계속 붙어 *"causes a failure after retrying is exhausted"* | 재시도 소진 후 실패한다 |

여기에 타임아웃 순서까지 문서가 규정한다 — *"Use a lower connect timeout value than your command timeout"* 이며, 그렇지 않으면 토폴로지 갱신 직후 *"a period of persistent failure"* 가 생긴다 `✓`

슬롯·`MOVED`/`ASK`·gossip 의 동작 원리 자체는 이 문서의 소유가 아니다 — [cluster mode]({{< relref "../06-cluster-mode/index.md" >}})가 소유한다. 여기서 필요한 사실은 하나다. **CME 로 가는 순간 라우팅이 AWS 의 DNS 에서 우리 클라이언트 라이브러리로 넘어온다** `Σ`

## 5. 모드를 바꿀 때 실제로 무엇이 바뀌나

"엔드포인트만 바꾸면 된다"가 틀리는 이유는, 바뀌는 것이 네 층이기 때문이다.

| 바뀌는 층 | CMD | CME | 실제로 해야 하는 일 |
|---|---|---|---|
| **엔드포인트 문자열** | primary + reader (+ node) | configuration endpoint 1개 | 설정 교체. AWS 문서는 *"the cluster endpoints will change"* 라고만 하고, 2차 근거(AWS Knowledge Center)는 *"there's no longer a primary or reader endpoint"* 라고 한다 `≈` |
| **클라이언트 클래스** | cluster 프로토콜 불필요. 토폴로지 디스커버리 **불가** | cluster 프로토콜 **필수** — *"You must use a client that supports either Valkey Cluster or Redis OSS Cluster"* | 클라이언트 객체를 cluster 계열로 교체 + 토폴로지 갱신 설정(§4 표). `valkey-cli` 는 `-c` 플래그를 붙여야 *"follow MOVED and ASK redirections automatically"* 한다 `✓` |
| **애플리케이션의 다중 키 연산** | 제약 없음 | 같은 해시 슬롯에 있어야 한다 — *"Multi-key operations, transactions, or Lua scripts involving multiple keys are allowed only if all the keys involved are in the same hash slot"* | 해시 태그 도입 또는 연산 분해. 안 고치면 `ERR CROSSLOT Keys in request don't hash to the same slot` `✓` — AWS 문서 표기는 `CROSSLOT` 이지만 엔진이 실제로 반환하는 에러 코드는 `CROSSSLOT` 이다. 로그를 grep 할 때 갈린다 `Σ` |
| **파라미터 그룹** | `cluster-enabled = no` | `cluster-enabled = yes` 인 그룹 필요 | 기본 그룹을 쓰면 ElastiCache 가 대응 그룹을 자동 선택한다 `✓` |

여기에 구조적 제약이 얹힌다. CMD 는 샤드 1개 + replica 0\~5 이고, CME 는 샤드 1\~500(엔진 5.0.6 이상, 그 이하는 250) + 샤드당 replica 0\~5 다 `✓` Multi-AZ 는 CMD 에서 "Optional" 이지만 CME 에서는 **"Required"** 이고 기본 켜짐이다 `✓` 데이터베이스도 갈린다 — CME 는 DB 0 만 쓸 수 있었고, **ElastiCache Valkey 9.0(2026-05-05)부터 cluster mode 에서 `SELECT 0`–`15` 가 열렸다** `✓`

### 5.1 전환 절차 — 단방향이고, 중간에 `compatible` 이 끼어 있다

`ModifyReplicationGroup` 의 `ClusterMode` 는 `disabled`/`compatible`/`enabled` 3값이다. 문서의 Important 박스가 방향을 못박는다 — **"Cluster mode configuration can only be changed from cluster mode disabled to cluster mode enabled. Reverting this configuration is not possible."** `✓`

전제조건 4개가 문서에 열거돼 있다 `✓`
- *"The cluster may only have keys in database 0 only."*
- *"Applications must use a Valkey or Redis OSS client that is capable of using Cluster protocol and use a configuration endpoint."*
- *"Auto-failover must be enabled on the cluster with a minimum of 1 replica."*
- *"The minimum engine version required for migration is Valkey 7.2 and above, or Redis OSS 7.0 and above."*

절차는 2단계다.

1. **`disabled → compatible`.** *"Compatible mode means the client application can use either protocol to communicate with the cluster."* 이 상태가 되면 `DescribeReplicationGroups` 가 configuration endpoint 를 반환하기 시작한다 — 즉 **새 엔드포인트가 생기고 기존 primary/reader 도 살아 있는 창**이 열린다. 여기서 애플리케이션을 cluster 클라이언트 + config endpoint 로 무중단 이전한다 `✓` 이 상태에는 제약이 있다: *"In compatible mode, other modification operations such as scaling and engine version are not allowed"* 이고 `cacheParameterGroupName` 외의 파라미터도 같은 요청에서 못 바꾼다 `✓` **되돌리려면 여기서 되돌려야 한다** — *"You can also choose to revert back to cluster mode disabled (CMD) from cluster mode compatible and preserve the original configurations."* `✓`
2. **`compatible → enabled`.** *"Note that the cluster endpoints will change once the cluster mode is changed to enabled. Make sure to update your applications with the new endpoints."* `✓` 이 지점을 넘으면 복귀 경로가 없다.

### 5.2 문서가 답하지 않는 것 — 런북에 그대로 반영해야 하는 미확정 4건

이 절은 실무 런북의 핵심인데, AWS 1차 문서가 답하지 않는 항목이 넷 있다. 확인한 범위를 명시해 둔다.

| 질문 | 문서 상태 | 런북에서의 처리 |
|---|---|---|
| `enabled` 후 기존 primary/reader DNS 레코드가 **삭제되는가** | **문서에 없다.** "delete/remove" 라는 단어가 관련 페이지 어디에도 없고 *"endpoints will change"* 뿐이다. AWS 는 TLS 전환에 대해서는 *"Old non-TLS primary and reader endpoints will be deleted"* 라고 명시하므로, 말할 때는 명시하는 회사다 `?` | 유예를 가정하지 않는다. 전환 전에 클라이언트를 config endpoint 로 **완전히** 옮긴 뒤 넘어간다 |
| `compatible` 에서 얻은 config endpoint 이름이 `enabled` 후에도 **같은가** | **문서에 없다.** *"the cluster endpoints will change"* 의 범위에 config endpoint 가 포함되는지 구분되지 않는다 `?` | `enabled` 완료 후 `describe-replication-groups` 로 **재조회해 확정**하는 단계를 반드시 넣는다 |
| `compatible` 상태의 API 응답에 `ConfigurationEndpoint` 와 primary/reader 가 **동시에** 실리는가 | **문서에 예시가 없다.** 2차 근거(AWS Knowledge Center)는 두 계열을 **동시에 쓸 수 있다**고 말하지만, API 필드 동시 노출을 진술한 것은 아니다 `?` | 두 필드 동시 노출을 전제로 자동화를 쓰려면 실계정에서 1회 확인한다 |
| *"make sure … the cluster's configuration endpoint is not in use"* 는 무슨 뜻인가 | **해명 문장이 어디에도 없다.** 같은 페이지의 직전 단계가 "config endpoint 로 옮기라"고 지시하므로 **문서 내부 상충**이고, AWS 자신의 KC 런북에는 이 조건이 아예 없다 `?` | 이 문장을 근거로 다운타임 단계를 설계하지 않는다. 실제 전제는 "모든 클라이언트가 cluster 프로토콜 + config endpoint 로 이전 완료" 로 잡는다 |

**타 클라우드와의 대조가 이 전환의 가치를 보여준다.** Google Memorystore for Valkey 는 *"After you create an instance with either Cluster Mode Enabled or Cluster Mode Disabled, you can't change the instance to the other mode"* 이고, Azure Managed Redis 는 clustering policy 를 *"you can't change it … you must delete the Redis cache and recreate it"* 다 `✓` 즉 **사후 전환을 제공하는 것은 AWS 뿐이고, 그것조차 단방향이다.** 멀티클라우드를 전제한 설계에서 CMD 를 고르면 다른 클라우드로 그대로 못 옮긴다 `Σ`

## 6. 스케일링 중의 엔드포인트

엔드포인트를 손대야 하는 스케일링은 **offline 경로 하나뿐**이다.

| 작업 | 엔드포인트 | 무중단 | 문서가 붙이는 제약 |
|---|---|---|---|
| **online resharding** (샤드 추가·삭제·리밸런스) | 유지 | *"scale … dynamically with no downtime … can continue to serve requests even while scaling or rebalancing is in process"* `✓` | 256MB 초과 아이템이 든 키는 이전되지 않아 샤드가 불균형해지고 그 샤드는 scale-in 에서 삭제되지 않는다. scale-out 시 새 샤드의 노드 수 = 기존 최소 샤드의 노드 수 `✓` |
| **offline resharding** | **바뀐다** — *"Update the endpoints in your application to the new cluster's endpoints"* `✓` | 아니오 | 대가로 샤드별 키스페이스·노드 타입·AZ·엔진 버전을 자유롭게 지정할 수 있다 `✓` |
| **online vertical scaling** (노드 타입 변경) | 유지 | *"allows scaling up/down while the cluster continues serving incoming requests"* `✓` | — |
| **replica 추가·삭제** | reader endpoint 유지(실시간 추종) | 예 | **node endpoint 를 박아둔 앱은 깨진다** `✓` |
| 전체 장애 후 노드 교체 | 유지 | — | *"each of the replacement nodes has the same endpoint as the node it's replacing, you don't need to make any endpoint changes"* `✓` |

**슬롯 재배치 중 클라이언트가 실제로 겪는 것은 무엇인가.** 문서는 `MOVED`/`ASK` 를 애플리케이션 에러로 설명하지 않고 **클라이언트 라이브러리가 처리하는 신호**로 설명한다 — `valkey-cli` 는 `-c` 로 *"follow MOVED and ASK redirections automatically"*, 라이브러리는 리다이렉트를 토폴로지 재조회 트리거로 쓴다 `✓` 앱까지 올라오는 증상은 리다이렉트 에러가 아니라 **레이턴시 상승과 타임아웃**이다 — *"Some clients might observe higher latency during online cluster resizing. Configuring your client library with a higher timeout can help…"* `✓` (**"`MOVED` 가 앱 예외로 올라오는가"를 직접 답한 문서 문장은 찾지 못했다.** 재시도를 소진하면 예외가 된다는 것은 node filter 설명의 *"causes a failure after retrying is exhausted"* 에서 간접 추론한 것이다 `?`)

resharding 중에는 기능 제약도 붙는다 — *"FLUSHALL and FLUSHDB commands are not supported inside Lua scripts during a resharding operation"* 이고, Redis OSS 6 이전에는 마이그레이션 중인 슬롯에 대한 `BRPOPLPUSH` 가 미지원이다 `✓` 사전 조건으로 문서가 권하는 수치도 있다 — scale-in 전 남길 샤드의 여유 메모리가 제거할 샤드 사용량의 **1.5배 이상**, CPU 는 멀티코어 80% 미만·싱글코어 50% 미만 `✓` durability 를 켠 클러스터에는 새 한계가 하나 더 생긴다 — *"Durability-enabled clusters support up to 100 MiBps of write throughput per primary node"* 이므로 이 한계에 걸리면 샤드를 늘려야 한다 `✓`

## 7. 엔진 전환 — Redis OSS → Valkey 는 엔드포인트가 그대로다

모드 전환과 정반대다. 문서 원문: *"Valkey is designed as a drop-in replacement for Redis OSS 7. … **All aspects of your application, including the endpoint DNS name, will remain unchanged**, except that for node-based clusters, the underlying node IP addresses will change during the upgrade."* `✓`

| 항목 | 사실 | 근거 |
|---|---|---|
| 방식 | in-place. `modify-replication-group --engine valkey --engine-version 9.0` 로 엔진과 버전만 지정. serverless 는 `modify-serverless-cache --engine valkey --major-engine-version 9` | `✓` |
| 다운타임 | Redis OSS **5.0.6 이상**은 failover 몇 초. 그 미만은 *"a failover time of 30 to 60 seconds during the DNS propagation"* | `✓` |
| 엔드포인트 | DNS 이름 유지. **노드 IP 는 바뀐다** → §3.1 의 DNS TTL 설정이 여기서도 그대로 걸린다 | `✓` |
| 롤백 | *"ElastiCache only supports rolling back from Valkey 7.2 to Redis OSS 7.1."* 더 이전 버전에서 올라왔어도 이 한 경로뿐이다. user/user group 이 `engine type REDIS` 여야 한다 | `✓` |
| 사전 조건 | 커스텀 파라미터 그룹을 쓰면 *"must have the same Redis OSS static parameter values"* 인 Valkey 용 그룹을 같이 넘긴다. 단일 노드 CMD 는 먼저 replication group 에 편입해야 한다. AWS CLI v1 ≥ 1.35.2 / v2 ≥ 2.18.2 | `✓` |
| MemoryDB | cross-engine 업그레이드는 되지만 **다운그레이드 불가** — *"you must delete the existing cluster and create it anew"* | `✓` |

**지원 버전이 선택을 사실상 결정한다.** ElastiCache 의 Valkey 는 9.1 / 9.0 / 8.2 / 8.1 / 8.0 / 7.2.6 이고, Redis OSS 는 *"all Redis OSS versions 7.1 and before"* 다 — 즉 **ElastiCache 에 Redis 8.x 는 없다.** 7.1 위로 가려면 Valkey 로만 간다 `✓` 그리고 AWS 의 버전 번호는 업스트림과 1:1 이 아니다 — *"ElastiCache v8.2 is compatible with Valkey v8.1"*, *"ElastiCache v7.1 is compatible with Redis OSS v7.0"* `✓` 업스트림 릴리스 이력과 기능 대응은 [Valkey 8.0 → 9.1]({{< relref "../05-valkey-8-to-9/index.md" >}})이 소유한다.

전환 시점의 릴리스 이력도 함께 본다 — ElastiCache Valkey 8.0(2024-11-21) · 8.1(2025-07-24) · 8.2 벡터 검색(2025-10-13) · **9.0(2026-05-05, node-based + serverless)** · durability GA(2026-06-02) · **9.1(2026-06-23, node-based only)** 이다 `✓` 9.1 은 발표문 기준 serverless 미포함이며, 2026-08-06 시점에 serverless 에 추가됐는지는 확인하지 못했다 `?`

**가격.** 2024-10-08 출시 발표문의 수치이고, 비교 기준은 *"other supported engines"*(= Redis OSS) 다 `Ⓥ`
- ElastiCache: Serverless *"33% lower"*, node-based *"20% lower"*
- ElastiCache Serverless 최소 스토리지 **100MB**(*"90% lower than ElastiCache Serverless for Redis OSS"*), 시작 비용 *"as low as $6/month"*
- MemoryDB for Valkey: MemoryDB for Redis OSS 대비 **30% 저가**, 쓰기는 월 10TB 무료 + 초과분 $0.04/GB(Redis OSS 대비 80% 저가)
- Valkey 9.0·9.1 과 벡터 검색(8.2)은 *"at no additional cost"* `✓`

**이 값들은 AWS 자신의 발표문 수치이고 우리가 검증하지 않았다.** 인스턴스 타입·리전·약정에 따라 실효 절감률이 달라지므로 이 숫자를 예산 근거로 쓰기 전에 리전별 가격표로 재계산해야 한다 `Σ`

## 8. TLS 와 인증 — TLS 는 포트가 아니라 DNS 이름을 바꾼다

가장 덜 알려진 함정이 여기 있다. **TLS-enabled 클러스터는 TLS-disabled 클러스터와 DNS 레코드 형식이 다르다** — *"TLS-enabled clusters use a different format of DNS records than TLS-disabled clusters."* 그래서 전환 절차 자체가 엔드포인트 마이그레이션이고, 문서가 Note 로 경고한다 — *"We are changing and deleting old endpoints during this process. Incorrect usage of the endpoints can result in the … client using old and deleted endpoints that will prevent it from connecting to the cluster."* `✓`

| 단계 | 엔드포인트 상태 | 다운타임 |
|---|---|---|
| `encryption mode: preferred` | 구 non-TLS primary/reader 가 **살아 있고**, 새 TLS 엔드포인트가 생성된다. *"This new endpoints will resolve to the same IP(s) as the old ones (non-TLS)"* — 반면 per-node DNS 이름은 이 단계에서 이미 갈린다: *"the old per-node DNS names are deleted and new ones are generated when migrating the cluster from no-TLS to TLS-preferred"* | 없음 `✓` |
| `encryption mode: required` | **"Old non-TLS primary and reader endpoints will be deleted."** *"There will be no downtime of TLS cluster endpoints."* | TLS 엔드포인트에는 없음 `✓` |

즉 `preferred` 창에서 앱을 새 DNS 로 옮기고 나서 `required` 로 가야 한다. 문서의 권고가 이례적으로 강하다 — *"Don't hardcode a cluster configuration endpoint in your application, as it will change during this process."* `✓` 그리고 전환은 즉시가 아니다 — 큰 클러스터에서는 시간이 걸리고 *"you should not create clients that will try to establish TLS connections to the cluster until the in-transit encryption is completed"* 다. 완료 확인은 SNS·`describe-events`·콘솔·`transit_encryption_enabled` 폴링으로 하고, 검증은 `INFO` 의 SSL 섹션에서 `tls_mode_connected_tcp_clients:0` 을 본다 `✓`

**포트는 바뀌지 않는다.** 문서의 모든 TLS 예시가 `-p 6379` 를 쓴다. Serverless 의 6380 은 TLS 때문이 아니라 read-optimized 엔드포인트다 `✓`

제약도 정리해 둔다 — 기존 클러스터의 TLS 토글은 *"Valkey 7.2 and later, and Redis OSS version 7 and later"* 에서만 되고, Memcached 는 *"only when creating the cluster"* 다 `✓` VPC 필수, M1/M2 노드 미지원, **mTLS 미지원**(*"ElastiCache does not support mTLS (mutual TLS)"*), 그리고 클러스터 이름이 공개 Certificate Transparency 로그에 실리므로 *"Don't include confidential or sensitive information in cluster names"* 다 `✓` 최소 TLS 버전은 **2026-04-28 부터 1.2** 로 상향됐다(Valkey 7.2+ / Redis OSS 6+) `✓`

**인증은 3계층이다** `✓`

| 계층 | 범위 | 걸리는 조건 |
|---|---|---|
| `AUTH` | in-transit encryption 기능의 일부 — *"the server can authenticate the clients"* | — |
| **RBAC** (user / user group) | `create-user` → `create-user-group` → 클러스터에 `--user-group-id` 부착 | user·user group 에도 `--engine redis\|valkey` 를 지정한다. Valkey → Redis 롤백에서 `engine type REDIS` 를 요구하는 이유가 이것이다 |
| **IAM 인증** | *"available when using ElastiCache for Valkey 7.2 and above or Redis OSS version 7.0 and above"* | *"requires in-transit encryption (TLS) to be enabled"*. 토큰은 SigV4 pre-signed URL **15분 유효**, IAM 인증 커넥션은 **12시간 후 자동 종료**(새 토큰으로 `AUTH`/`HELLO` 하면 연장). `MULTI`/`EXEC`·Lua 안에서 재인증 불가. IAM user 이름 == user id 여야 하고, **캐시 이름이 생성 시 소문자로 변환**되므로 인증 코드도 소문자를 넘겨야 한다 |

## 9. 관리형이 막는 것

ElastiCache 는 *"To deliver a managed service experience, ElastiCache restricts access to certain cache engine-specific commands that require advanced privileges"* 라며 다음을 막는다 — `bgrewriteaof` · `bgsave` · **`config`** · `debug` · `migrate` · `replicaof` · `save` · `slaveof` · `shutdown` · `sync` `✓`

MemoryDB 는 더 넓다 — 위 목록에 **`acl deluser`/`acl load`/`acl save`/`acl setuser`** · **`cluster addslot`/`cluster delslot`/`cluster setslot`** · **`module`** · `psync` 가 추가된다 `✓` ACL 을 커맨드로 못 만지게 하고 AWS API 로만 관리하도록 강제한다는 뜻이다.

**CLUSTER 관리 커맨드는 ElastiCache 도 3.2.4 시점부터 전량 막았다** — `cluster meet` · `replicate` · `flushslots` · `addslots` · `delslots` · `setslot` · `saveconfig` · `forget` · `failover` · `bumpepoch` · `set-config-epoch` · `reset` 이고, 같은 문서가 미지원 기능으로 *"Replica migration / Cluster rebalancing / Lua debugger"* 를 열거한다 `✓`

그래서 남는 유일한 설정 경로가 **파라미터 그룹**이다. CMD/CME 도 파라미터 그룹으로 갈리고(`cluster-enabled` = `no`/`yes`), 3.2 시대에는 `default.redis3.2` vs `default.redis3.2.cluster.on` 로 나뉘었다 `✓` 위험한 커맨드는 차단이 아니라 **개명**으로 다룬다 — 5.0.3 이상에서 `rename-commands` 파라미터를 쓰고(알파뉴메릭, 새 이름 최대 20자), 완전 차단은 `ParameterValue='flushall blocked'` 다. 변경은 즉시 적용되며 노드 재부팅 없이 클러스터 전체에 전파된다 `✓` `appendonly`/`appendfsync` 는 2.8.22 이후 미지원이고 AOF 와 Multi-AZ 는 상호배타다 `✓`

**이것이 "왜 굳이 self-host 하나"의 실질적 답이다.** 셋 중 하나가 걸릴 때 self-host 가 후보가 된다 `Σ`
1. **`CONFIG SET` 이 필요하다** — 런타임 파라미터 실험, 벤치마킹, `maxmemory-policy` 즉시 변경 같은 긴급 대응. 관리형에서는 파라미터 그룹 수정 → 적용 대기 사이클을 타야 한다.
2. **모듈이 필요하다** — MemoryDB 는 `module` 자체를 막고, ElastiCache 는 AWS 가 고른 것(JSON·벡터 검색)만 준다.
3. **슬롯을 직접 통제해야 한다** — `cluster setslot`/`addslots` 차단으로 커스텀 슬롯 배치가 불가능하다. ElastiCache 에서 샤드별 키스페이스를 지정할 수 있는 경로는 offline resharding 뿐이다.

추가로 `DEBUG`·`SAVE`·`BGSAVE` 차단은 디버깅 방식과 백업 자동화를 바꾼다 — 스냅샷은 AWS API 로만 만든다 `✓` managed 와 self-host 의 최종 판단표는 [무엇을 고를 것인가]({{< relref "../08-choosing.md" >}})가 소유한다.

## 10. 대조군 — k8s 에서 직접 굴리면

관리형 엔드포인트 구조가 왜 그 모양인지는, 직접 굴렸을 때 무엇을 해야 하는지를 보면 드러난다.

**Cluster 는 NAT 를 지원하지 않는다.** valkey.io 공식 튜토리얼 원문: *"Valkey Cluster does not support NATted environments and in general environments where IP addresses or TCP ports are remapped."* 권고 해법은 *"you need to use Docker's host networking mode"* 다 `✓`

원인은 **노드가 자기 주소를 스스로 광고한다**는 설계다. 각 노드가 cluster bus 패킷에 자기 IP·포트를 실어 보내고 클라이언트는 그 주소를 받아 **직접** 붙는다. 그래서 파드 IP 나 컨테이너 포트가 외부에서 다르게 보이면 클라이언트는 도달할 수 없는 주소를 받는다 — L4 LoadBalancer 나 Ingress 로 감싸면 정확히 이 조건이 된다 `Σ`

해결 파라미터군이 `valkey.conf` 에 문서화돼 있다 — `cluster-announce-ip` · `cluster-announce-client-ipv4`/`ipv6` · `cluster-announce-port` · `cluster-announce-tls-port` · `cluster-announce-bus-port` · `cluster-announce-client-port` · `cluster-announce-client-tls-port` 이고, 설명 원문은 *"Each instructs the node about its address, possibly other addresses to expose to clients, client ports … and cluster message bus port. The information is then published in the bus packets so that other nodes will be able to correctly map the address of the node publishing the information."* 다(`valkey 9.1.1:valkey.conf:2088-2134`) `✓` 핵심은 **노드 간 주소와 클라이언트용 주소를 분리할 수 있다**는 것이다 — *"If the port that clients will use to connect to Valkey is different than the one other valkey nodes in the cluster will connect to it on … you can configure the port that clients will see by setting cluster-announce-client-port or cluster-announce-client-tls-port."* `✓`

**cluster bus 포트를 빼먹으면 클러스터가 형성되지 않는다.** 기본값은 데이터 포트 + 10000(6379 → 16379)이고, 리맵된 환경에서는 *"the bus port may not be at the fixed offset of clients port + 10000, so you can specify any port and bus-port depending on how they get remapped"* 다 `✓`

| 항목 | ElastiCache CME | k8s self-host (StatefulSet) |
|---|---|---|
| 토폴로지 진입점 | configuration endpoint 1개 — 멀티 A 레코드, 죽은 노드를 AWS 가 목록에서 제거 | Headless Service(`clusterIP: None`)의 A 레코드 집합 + readinessProbe 로 근사 |
| 노드 주소 | AWS 관리 DNS, 이름 고정 · IP 변동 | 파드 안정 DNS `<pod>.<svc>.<ns>.svc.cluster.local`, IP 변동 |
| cluster bus | AWS 가 감춘다 — 16379 를 볼 일이 없다 | 6379 **와 16379 를 반드시 같이 노출** |
| NAT · LB 뒤 | 해당 없음 (VPC 내부 전용) | `cluster-announce-*` 로 광고 주소를 직접 교정하거나 hostNetwork. 안 하면 깨진다 |
| 슬롯 관리 | AWS API (`modify-replication-group-shard-configuration`) — CLUSTER 커맨드 차단 | `cluster addslots`/`setslot` 직접 사용 |
| failover | Multi-AZ 자동 + DNS 전파 | 엔진 자체 failover + 감시·자동화를 직접 만든다 |

**그래서 ElastiCache 가 VPC 밖에서 접근되지 않는 것은 제약처럼 보이지만 실은 조건이다.** "cluster mode 가 주소 리맵을 못 견딘다"는 것이 엔진의 근본 제약이다. 관리형의 엔드포인트 구조는 이 제약을 **VPC 내부 평면 네트워크 + 관리형 DNS** 로 우회한 결과물이다. k8s 에서 같은 것을 만들려면 hostNetwork 또는 `cluster-announce-*` 를 정확히 세팅해야 하고, "서비스를 L4 LB 로 노출한다"는 일반적인 패턴은 통하지 않는다 `Σ` 클라이언트가 그 광고 주소를 어떻게 쓰는지(`CLUSTER SLOTS`·`MOVED`)는 [cluster mode]({{< relref "../06-cluster-mode/index.md" >}})가 소유한다.

## 11. 근거

- **엔드포인트 종류·DNS 패턴**: `AmazonElastiCache/latest/dg/` 의 `Endpoints.html` · `Replication.Endpoints.html` · `ClientConfig.ReplicationGroup.html` · `AutoFailover.html` · `ReadReplicas.html` · `nodes-connecting.html`, `MemoryDB/latest/devguide/endpoints.html`, 그리고 CLI 레퍼런스 `elasticache/modify-replication-group`. 표의 모든 DNS 문자열은 이 페이지들의 **템플릿 또는 예시 원문**이다.
- **모드 전환**: `modify-cluster-mode.html`(Important 박스·전제조건·2단계 절차) · `Replication.Modify.html`, API 레퍼런스 `API_ModifyReplicationGroup` · `API_DescribeReplicationGroups` · `API_ReplicationGroup` · `API_NodeGroup`. §5.2 의 미확정 4건은 이 페이지 전량을 읽고도 답을 찾지 못한 항목이며, 2차 근거로 표시한 것은 AWS Knowledge Center 문서(`repost.aws/knowledge-center/elasticache-update-cme-to-cmd`, AWS OFFICIAL)다.
- **failover · 클라이언트 설정**: `AutoFailover.html` · `ClientConfig.DNS.html` · `BestPractices.Clients-lettuce.html`. JVM `networkaddress.cache.ttl` 지시와 "JVM 재시작까지 갱신하지 않는다"는 경고, 토폴로지 갱신 4항목·타임아웃 순서 권고가 모두 여기 원문이다.
- **스케일링**: `scaling-redis-cluster-mode-enabled.html` · `best-practices-online-resharding.html` · `durability.html`(100 MiBps 한계).
- **엔진 전환·버전·가격**: `VersionManagement.HowTo.html` · `engine-versions.html`, What's New 게시물 — ElastiCache for Valkey(2024-10-08) · MemoryDB for Valkey(2024-10-08) · 8.0(2024-11-21) · 8.1(2025-07-24) · 벡터 검색(2025-10-13) · 9.0(2026-05-05) · durability GA(2026-06-02) · 9.1(2026-06-23). 가격 수치는 전부 발표문 원문이고 우리가 검증하지 않았다 `Ⓥ`
- **TLS·인증**: `in-transit-encryption.html` · `connect-tls.html` · `enable-python-best-practices.html`(preferred → required 의 DNS 레코드 처리) · `auth-iam.html`.
- **차단 커맨드**: `ClientConfig.RestrictedCommands.html` · `memorydb/latest/devguide/restrictedcommands.html` · `engine-versions.html`(3.2.4 의 CLUSTER 커맨드 차단 목록) · `WhatIs.Components.html`.
- **Serverless**: `wwe-troubleshooting.html`(항상 cluster mode · CROSSLOT) · `ReadReplicas.html`(6379/6380) · `set-up.html`(VPC Endpoint · 두 포트 개방).
- **MemoryDB 포지셔닝**: `related-services-choose-between-memorydb-and-redis.html`(2026-06 이후의 권고 문장) · `memorydb/latest/devguide/{what-is-memorydb,components,clusters,engine-versions}.html`.
- **타 클라우드 대조**: `cloud.google.com/memorystore/docs/valkey/cluster-mode-enabled-and-disabled`, `learn.microsoft.com/azure/redis/architecture`.
- **자체 운영 대조군**: `valkey 9.1.1:valkey.conf:2088-2134`(`cluster-announce-*` 주석 전문, 로컬 blobless 클론 `~/evejuni/valkey` 에서 `git show` 로 실측), `valkey.io/topics/cluster-tutorial`(NAT 미지원·bus 포트 +10000).
- **확인하지 못한 것**: (a) 실계정 `aws elasticache describe-*` 로 DNS 패턴을 교차검증하지 않았다 — 표의 모든 문자열은 문서 예시다. (b) CME configuration endpoint 의 prefix 형(`clustercfg.<name>.…`) 예시는 ElastiCache 문서에 없다(MemoryDB 문서에만 있다). (c) TLS 켠 CMD primary 의 접두사가 `master.` 인지 `primary.` 인지 문서 간 불일치가 있고, TLS 켠 reader 의 접두사는 어느 문서에도 없다. (d) `compatible` 상태의 API 응답 예시, `enabled` 후 구 엔드포인트의 삭제 여부·시점, config endpoint 이름의 동일성은 전부 문서에 없다. (e) MemoryDB 의 Valkey 8/9 지원 여부와 Serverless 의 9.1 추가 여부는 확인하지 못했다. (f) Global Datastore(크로스리전 복제)의 엔드포인트 구조는 이번 범위에서 다루지 못했다.
- 챕터 전체 URL 목록은 [출처]({{< relref "../99-sources.md" >}})가 모은다.

