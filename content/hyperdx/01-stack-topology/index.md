---
title: "스택 토폴로지 — 4컴포넌트 배치·데이터 흐름·MongoDB 최소 배포"
date: 2026-08-01
lastmod: 2026-08-24
weight: 1
---

# ClickStack을 Kubernetes에 배치하기

ClickStack을 Kubernetes에 올릴 때는 텔레메트리가 저장되는 경로와 HyperDX의 설정이 저장되는 경로를 따로 따라가면 배치가 이해됩니다. 브라우저가 보낸 이벤트는 Collector를 거쳐 ClickHouse로 들어가고, 사용자·대시보드·알럿 설정은 HyperDX API가 MongoDB에 저장합니다. 두 데이터베이스의 크기와 장애 영향이 다른 이유도 이 흐름에 있습니다.

이 구성에서는 범용 분석에 쓰는 ClickHouse를 Altinity operator로 함께 관리합니다. ClickStack 차트의 ClickHouse를 끄고 외부 ClickHouse에 연결하는 ‘HyperDX Only’ 배치입니다. 제품 기능과 배포 모드는 [HyperDX / ClickStack 심층 분석]({{< relref "../../rum/01-hyperdx-deep-dive.md" >}}), 로그 저장소로서의 검토는 [로깅 챕터]({{< relref "../../logging/05-hyperdx-clickstack.md" >}})에서 다뤘습니다.

## 1. Helm 차트와 operator 설치 {#1-배포-토폴로지-개관--2-helm-차트-그리고-operator-분기}

ClickStack 공식 Helm 경로(v2.x)는 순서가 있는 2개 차트로 나뉩니다. operator/CRD를 먼저 깔고 operator가 Ready된 뒤 본체를 올립니다.

| 차트 | 설치물 | 비고 |
|---|---|---|
| `clickstack-operators` | MongoDB Kubernetes Operator(MCK) + ClickHouse Operator 컨트롤러/CRD | 먼저 설치 필수 |
| `clickstack` | HyperDX(UI+API), OTel Collector(공식 subchart), 위 operator가 소비할 CR | operator Ready 이후 설치 |

설치되는 CRD 3종: `MongoDBCommunity`, `ClickHouseCluster`, `KeeperCluster`.

2026-07에 확인한 차트 main 브랜치는 ClickHouse `replicas:1`, Keeper `replicas:1`, MongoDB `members:1`을 기본으로 둡니다. 운영 환경에서 복제와 AZ 분산을 쓰려면 이 값을 바꿔야 합니다. MongoDB 배포 형태는 [별도 글]({{< relref "../../rum/07-hyperdx-mongodb.md" >}})에서도 확인할 수 있습니다. 제거할 때는 본체, operator 순으로 진행하고 남은 PVC를 별도로 정리합니다.

### 기존 Altinity ClickHouse에 연결하기 {#operator-분기--표준-install--altinity}

표준 차트는 ClickHouse Inc. 공식 operator의 `ClickHouseCluster`·`KeeperCluster` CRD를 사용합니다. 이 글의 예제는 Altinity의 `ClickHouseInstallation`(CHI)·`ClickHouseKeeperInstallation`(CHK)을 사용하므로 차트 기본 배포와 그대로 섞을 수 없습니다. [operator 선택 글]({{< relref "../../clickhouse/03-operator.md" >}})에서 검토한 운영 이력과 기존 분석 클러스터의 관리 방식을 따라 Altinity로 통일한 구성입니다.

차트에서 ClickHouse 생성을 끄고 Collector와 HyperDX의 외부 연결을 설정합니다. 아래는 필요한 설정을 보여주는 예시입니다.

```yaml
# clickstack 차트 values — 우리 케이스: CH/Keeper를 차트 밖으로 분리(HyperDX Only)
clickhouse:
  enabled: false          # ★ 차트 기본값은 true. 표준 공식 operator를 쓰지 않고 Altinity CHI로 외부 운영
otel-collector:
  enabled: true           # 게이트웨이는 차트로 유지(또는 별도 관리)
  replicaCount: 2         # 게이트웨이 HA (§5.1)
  # exporter 연결문자열에 async_insert=1(+wait_for_async_insert=1) 권장 (저볼륨)
  # file_storage extension으로 퍼시스턴트 큐 구성 — 상세 §5.3
hyperdx:
  api:                    # MONGO_URI / CLICKHOUSE_* 시크릿으로 외부 CH·Mongo를 참조
    envFrom:
      - secretRef: { name: clickhouse-creds }   # CLICKHOUSE_HOST/USER/PASSWORD 등
      - secretRef: { name: mongo-creds }        # MONGO_URI
```

ClickHouse와 Keeper의 CHI/CHK는 별도 매니페스트로 관리합니다. 이렇게 하면 관측성 때문에 ClickHouse operator를 하나 더 운영할 필요가 없습니다. [CHI/CHK 배치와 다운타임]({{< relref "04-operator-topology-downtime.md" >}}), [gp3 볼륨]({{< relref "02-hot-storage-ebs.md" >}}), [S3 티어링]({{< relref "03-s3-cold-tiering.md" >}}), [Keeper]({{< relref "05-keeper.md" >}})에서 각 설정을 이어갑니다. 변경과 복구 절차는 [Altinity 운영 글]({{< relref "../../clickhouse/05-altinity-operations.md" >}})을 참고합니다.

이 values는 배포용 완성본이 아닙니다. `otel-collector.replicaCount`나 `hyperdx.api.envFrom` 같은 키 경로는 사용할 차트의 `helm show values clickstack/clickstack` 출력과 맞춰야 합니다. MongoDB CR 예제는 아래 §6.3에 있습니다. [배포 모드 설명]({{< relref "_index.md" >}})에서 사용하는 ‘HyperDX Only’도 이 외부 연결 구성을 뜻합니다.

## 2. 컴포넌트 역할과 포트 {#2-컴포넌트-역할포트의존}

| 컴포넌트 | 프로세스/역할 | 리슨 포트 | 의존 방향 | 스테이트 |
|---|---|---|---|---|
| HyperDX app | Next.js UI(브라우저 대면) | 3000(내부; local/compose는 8080) | → api | 무상태 |
| HyperDX api | Node.js 백엔드(쿼리·알럿·OpAMP 서버) | 8000, OpAMP 4320 | →CH·Mongo, ←Collector(OpAMP) | 무상태 |
| OTel Collector | 게이트웨이(OTLP→CH) | 4317/4318/13133/8888¹ | →CH(insert), ←api(OpAMP) | 무상태(in-flight 큐) |
| ClickHouse | 모든 텔레메트리 저장·쿼리 원천 | 8123/9000/9009² | ←Collector, ←api, ↔Keeper | 스테이트풀(EBS) |
| Keeper | 복제 메타 합의(ZK 대체) | 2181/9444³ | ↔ ClickHouse | 스테이트풀(gp3) — {{< relref "05-keeper.md" >}} |
| MongoDB | 앱 메타데이터(user/team/dashboard/alert/source…) | 27017 | ← HyperDX api | 스테이트풀(gp3, 소용량) |

¹ 4317=gRPC, 4318=HTTP(SDK가 실제 쓰는 포트), 13133=health, 8888=metrics.
² 8123=HTTP, 9000=native, 9009=interserver.
³ 2181=client, 9444=raft — Altinity CHK 기본값(독립형 Keeper 기본값 9181/9234와 다름).

HyperDX는 UI인 app과 백엔드인 api 두 프로세스로 구성됩니다. local/all-in-one에서는 한 컨테이너에 묶이지만 Helm 배포에서는 app/api 포트를 따로 노출합니다.

Collector가 `OPAMP_SERVER_URL`에 지정한 API의 `/v1/opamp`로 접속하면 API가 파이프라인 설정을 내려줍니다. OpAMP의 제어 연결과 Collector → ClickHouse의 이벤트 전송은 별도 경로입니다.

`CUSTOM_OTELCOL_CONFIG_FILE`은 기본 Collector 설정에 새 receiver·processor 등을 병합하는 용도입니다. 기존 `batch`·`memory_limiter` 값을 바꾸려면 이 병합 경로의 제약을 확인하고 차트가 렌더링하는 기본 설정을 수정해야 합니다.

아래는 위 표의 역할·의존 관계를 담은 공식 아키텍처 그림입니다.

![HyperDX ClickStack 공식 아키텍처 다이어그램 — App/Infra → OTel Collector → ClickHouse ← HyperDX API ← HyperDX UI·MongoDB, OpAMP 폴링 구조](/images/hyperdx/hyperdx-architecture.png)
*Collector가 ClickHouse에 데이터를 적재하고 HyperDX API가 이를 조회합니다. MongoDB는 API의 앱 메타데이터를 저장하며 OpAMP는 Collector 설정을 전달합니다. 출처: [hyperdxio/hyperdx](https://github.com/hyperdxio/hyperdx) — © DeploySentinel, Inc., MIT License*

### HyperDX 조회 계정의 권한 {#hyperdx-api가-붙는-clickhouse-계정--readonly--네-설정-변경-권한}

위 표의 HyperDX api는 ClickHouse에 쿼리로만 붙으므로 계정 권한은 readonly로 충분합니다. 단 readonly 계정이라도 `max_rows_to_read`(최소 100만 이상)·`read_overflow_mode`·`cancel_http_readonly_queries_on_client_close`·`wait_end_of_query` 네 설정에 대한 변경 권한은 필요합니다.

기본 계정을 공유하는 대신 HyperDX 전용 읽기 사용자를 만듭니다. Collector의 쓰기 계정과 분리하면 두 경로의 권한을 각각 제한할 수 있습니다.

## 3. 브라우저 이벤트가 저장되는 경로 {#3-데이터-흐름--rum은-mongodb를-거치지-않는다}

{{< flow src="_flow/3-데이터-흐름-rum-은.json" />}}

브라우저 RUM SDK의 목적지는 Collector의 OTLP/HTTP `4318` 포트입니다. 세션 리플레이도 같은 경로로 들어와 ClickHouse의 `hyperdx_sessions`에 저장됩니다. RUM 데이터가 늘었다고 MongoDB 저장 공간을 같은 비율로 늘릴 필요는 없습니다.

쓰기와 읽기는 각각 Collector와 HyperDX API에서 시작하지만 결국 같은 ClickHouse 자원을 사용합니다. 대시보드 조회가 CPU·메모리·I/O를 많이 차지하면 적재도 늦어질 수 있습니다. [용량 산정]({{< relref "07-capacity-planning.md" >}})에서는 데이터 크기와 함께 이 동시 부하를 고려합니다.

## 4. Kubernetes 배치 {#4-우리-케이스-k8s-배치-mermaid}

ClickHouse/Keeper는 Altinity, MongoDB는 MCK가 관리하고 HyperDX가 두 저장소에 연결합니다. MongoDB를 Atlas에 맡기는 구성도 가능합니다.

{{< flow src="_flow/4-우리-케이스-k8s-배치.json" />}}

## 5. Collector의 크기와 큐 {#5-otel-collector-배치사이징}

### 5.1 RUM 수신용 Gateway {#51-agent-vs-gateway--rum-only는-게이트웨이만으로-충분}

Collector Agent는 노드나 호스트에서 로그·메트릭을 수집하며 DaemonSet·sidecar 등으로 배치합니다. Gateway는 OTLP를 받아 변환하고 배치하는 Deployment입니다. ClickStack Collector의 기본 배치는 이 Gateway 역할입니다.

브라우저 SDK만 수신한다면 Gateway Deployment와 Service로 시작할 수 있습니다. 가용성을 위해 replica를 2개 두고, 노드 로그 수집이 필요해질 때 DaemonSet Agent를 추가합니다.

### 5.2 이벤트 크기를 반영한 처리량 추정 {#52-사이징--단위는-mbs-eventss-환산은-추정}

이벤트 수만으로 Collector 크기를 정하기는 어렵습니다. 벤더 예시는 약 60,000 events/s에 3 core·12GB를 제시하지만, rrweb 이벤트처럼 본문이 큰 데이터에서는 같은 events/s라도 바이트 처리량이 달라집니다. 우리 입력량과 비교할 때는 MB/s로 환산해야 합니다.

월 0.7TB를 원본 입력량으로 해석하면 평균 약 0.27 MB/s입니다. 압축 후 저장량이라면 압축비 6배 가정에서 원본은 약 1.6 MB/s가 됩니다. 어느 쪽인지는 [용량 산정]({{< relref "07-capacity-planning.md" >}})의 실측 항목으로 남아 있습니다. 1~2 core Gateway로 시작할 수 있을 것으로 추정하지만, 평균값으로 버스트 처리와 장애 중 유실까지 보장할 수는 없습니다.

### 5.3 ClickHouse가 멈췄을 때의 대기와 유실 {#53-큐백프레셔유실-지점--durable-queue가-기본-존재하지-않는다}

```yaml
processors:
  memory_limiter: { check_interval: 1s, limit_mib: 2048, spike_limit_mib: 256 }
  batch: { timeout: 1s, send_batch_size: 10000 }   # CH는 큰 배치 선호(≥1,000행)
exporters:
  clickhouse: {}   # 저볼륨이면 연결문자열에 async_insert=1 (+wait_for_async_insert=1)
```

Collector의 `sending_queue`는 기본적으로 메모리에 있습니다. 파드가 종료돼도 큐를 이어 처리하려면 `file_storage` extension과 영속 볼륨을 연결해야 합니다. 사용할 ClickStack Collector 빌드에 extension이 포함되는지, 설정 병합으로 연결할 수 있는지는 배포 전에 확인합니다.

ClickHouse가 응답하지 않으면 exporter가 재시도하고 큐가 쌓입니다. 메모리 제한에 닿으면 `memory_limiter`가 수신을 거부하고 브라우저 SDK의 재시도 한도까지 소진되면 이벤트가 유실될 수 있습니다. [Keeper 글]({{< relref "05-keeper.md" >}})에서 설명하듯 Keeper가 그 이벤트를 대신 보관해주지는 않습니다.

같은 블록을 재전송할 때는 ClickHouse의 중복 제거를 활용할 수 있습니다. 다만 블록의 데이터·순서와 중복 제거 설정에 의존하므로 모든 재시도를 무조건 멱등하다고 가정하지 않습니다.

Gateway 2개와 영속 큐를 배치한 뒤에는 큐가 버티는 시간도 확인해야 합니다. `async_insert`와 `wait_for_async_insert=1`은 낮은 입력량에서 작은 INSERT를 모으는 데 사용하고, 장애 중 대기 가능한 양은 별도로 산정합니다.

## 6. MongoDB 배포 크기 {#6-mongodb-최소-규모-배포-사용자-핵심-질문--정면-답}

HyperDX의 MongoDB에는 사용자·팀·대시보드·알럿·소스 설정이 쌓입니다. 부하는 RUM 입력량보다 설정 수와 UI 사용량에 좌우됩니다. 작은 팀의 메타데이터를 수백 MB~수 GB로 예상할 수 있지만 실제 크기는 [MongoDB 모델과 부하 설명]({{< relref "../../rum/07-hyperdx-mongodb.md" >}})을 참고해 확인합니다.

### 6.1 캐시와 사이드카를 포함한 메모리 {#61-얼마나-작게--02-cpu200m은-함정}

MCK의 `specify_pod_resources` 예시는 mongod와 agent에 각각 0.2 CPU·200~250M 메모리를 둡니다. 이 값은 운영 최소값으로 쓰기 어렵습니다. WiredTiger 캐시만 최소 256MB이기 때문입니다. 기본 산식은 `max(0.5 × (RAM − 1GB), 256MB)`이며 연결과 집계, 프로세스 자체의 메모리도 추가로 필요합니다. 컨테이너에서는 `storage.wiredTiger.engineConfig.cacheSizeGB`를 명시하고 배포 버전의 cgroup 메모리 인식도 확인합니다.

| 항목 | 데모 극소(비권장) | 실전 최소 권고 |
|---|---|---|
| mongod requests | 0.2 CPU / 200Mi | 250m / 512Mi |
| mongod limits | 0.2 CPU / 250Mi | 1 CPU / 1Gi |
| `wiredTigerCacheSizeGB` | (미설정) | 0.25~0.5 명시 |
| mongodb-agent 사이드카 | 0.2 / 200Mi | 100~200m / 128~256Mi |
| 스토리지(PVC, gp3) | — | 10Gi(차트 기본; oplog 여유) |

파드에는 mongod 외에 mongodb-agent와 init 컨테이너도 들어갑니다. 표의 값으로 잡으면 단일 멤버에 약 0.4 vCPU·0.75~1.25Gi 메모리·gp3 10Gi가 필요하다는 추정입니다. mongod 하나의 request만 보고 노드 용량을 계산하지 않도록 주의합니다.

### 6.2 멤버 수와 장애 영향 {#62-members-1-vs-3--무엇이-달라지나}

| | `members: 1` (차트 기본) | `members: 3` (prod 권고) |
|---|---|---|
| 복제 | 없음(단일 mongod) | Primary + Secondary×2, 자동 failover |
| 장애 | 파드 재시작=짧은 다운, 노드/AZ 장애 중 접근 불가, 볼륨 소실 시 메타 유실 | 1 파드/노드/AZ 상실 견딤(정족수 2/3) |
| HyperDX 영향 | UI 오류·알럿 평가 중단·대시보드 조회 불가(CH 인제스트는 계속) | 선출 동안 일시 오류 가능(수 초 예상) |
| 비용 | 1× (~0.4 vCPU/1Gi/10Gi) | 3× (~1.2 vCPU/3Gi/30Gi) — 설정 예시의 합계 |

단일 멤버의 파드가 재시작해도 EBS 볼륨이 남아 있으면 메타데이터를 다시 읽어 올릴 수 있습니다. 그동안은 UI와 알럿 평가에 오류가 생길 수 있습니다. 노드 장애와 데이터 유실은 같은 사건이 아니며, AZ 장애 역시 우선 볼륨 접근 불가로 봐야 합니다. 볼륨이 손상되거나 사라졌을 때 백업이 없으면 메타데이터를 잃습니다.

운영 환경에서는 멤버 3개를 서로 다른 AZ에 두는 구성을 택합니다. 총량은 약 1.2 vCPU·3Gi 메모리·30Gi 스토리지로 예상합니다. 단일 멤버로 줄이는 비용보다 대시보드와 알럿을 다시 만드는 부담이 크다고 보기 때문입니다. staging에서는 멤버 1개로 시작할 수 있습니다.

### 6.3 MongoDBCommunity CR 예제 {#63-최소-배포-형상--mongodbcommunity-cr}

아래 예제는 3멤버, SCRAM, WiredTiger 캐시 0.5GB와 gp3 10Gi를 사용합니다. AZ 분산에 쓰는 라벨과 실제 이미지 태그는 `helm template` 출력 및 배포 파드에서 확인합니다.

```yaml
apiVersion: mongodbcommunity.mongodb.com/v1
kind: MongoDBCommunity
metadata:
  name: hyperdx-meta
  namespace: hyperdx
spec:
  members: 3
  type: ReplicaSet
  version: "5.0.32"               # ClickStack Helm 관찰값 (mongo 5.0.x)
  security:
    authentication:
      modes: ["SCRAM"]            # SCRAM 기본 활성 — 기본 비번은 반드시 교체
  users:
    - name: hyperdx
      db: hyperdx
      passwordSecretRef: { name: hyperdx-mongo-password }
      roles:
        - { name: dbOwner, db: hyperdx }
        - { name: clusterMonitor, db: admin }
      scramCredentialsSecretName: hyperdx-scram
  additionalMongodConfig:
    storage.wiredTiger.engineConfig.cacheSizeGB: 0.5   # ★ 컨테이너에선 명시 고정
  statefulSet:
    spec:
      template:
        spec:
          affinity:              # AZ 분산: 멤버가 한 AZ에 몰리면 members:3 무의미
            podAntiAffinity:
              requiredDuringSchedulingIgnoredDuringExecution:
                - labelSelector:
                    matchExpressions:
                      - { key: app, operator: In, values: [hyperdx-meta-svc] }
                  topologyKey: topology.kubernetes.io/zone
          containers:
            - name: mongod
              resources:
                requests: { cpu: "250m", memory: "512Mi" }
                limits:   { cpu: "1",    memory: "1Gi" }
            - name: mongodb-agent
              resources:
                requests: { cpu: "100m", memory: "128Mi" }
                limits:   { cpu: "250m", memory: "256Mi" }
      volumeClaimTemplates:
        - metadata: { name: data-volume }
          spec:
            accessModes: ["ReadWriteOnce"]
            storageClassName: gp3
            resources: { requests: { storage: 10Gi } }
```

### 6.4 인증·백업·버전 {#64-인증백업버전}

예제의 앱 사용자는 `hyperdx` DB의 `dbOwner`, `admin` DB의 `clusterMonitor` 권한을 가집니다. SCRAM을 사용하고 샘플 비밀번호는 실제 Secret으로 교체합니다. 차트 경로를 사용한다면 `clickstack-secret`의 `MONGODB_PASSWORD`도 확인합니다.

MCK Community Operator에는 내장 백업이 없습니다. 직접 배포할 때는 `mongodump` CronJob으로 S3에 덤프를 보내고 복원도 확인해야 합니다. Ops Manager 백업·PITR은 Enterprise 기능이며 EBS snapshot도 별도 대안입니다. 덤프 시간과 크기는 메타데이터 규모에 따라 달라집니다.

조사한 Helm values와 Docker Compose에는 MongoDB `5.0.32`가 쓰였습니다. 이는 관찰한 태그이며 새 배포 버전을 추천하는 의미는 아닙니다. operator 저장소도 `mongodb-kubernetes-operator`에서 `mongodb/mongodb-kubernetes`로 통합됐으므로 사용할 차트가 실제로 고정한 operator·mongod 태그를 확인합니다.

{{% details title="Atlas에 MongoDB 운영을 맡기는 경우" closed="true" %}}
HyperDX는 `MONGO_URI` 하나만 있으면 되므로 Atlas(SRV 연결문자열)도 그대로 붙습니다.

| 방식 | 장점 | 트레이드오프 |
|---|---|---|
| 자체 MCK(in-cluster) | 클러스터 내부·egress 없음·비용 최소 | HA·백업 자력(mongodump CronJob), operator 운영 부담 |
| Atlas M0(free, 512MB) | 무료·zero-ops, staging에 이상적 | shared 티어 제약, prod 부적합 |
| Atlas M10(≈$57/mo, 10GB) | 자동 백업·PITR·멀티AZ(MCK 백업 공백 제거) | 외부 의존, VPC peering/PrivateLink, 월비용 |

Atlas를 사용하면 HyperDX에 `MONGO_URI`를 연결하고 MongoDB의 복제·백업 운영을 외부로 넘길 수 있습니다. 대신 네트워크 연결, 리전별 가격, 백업 제공 범위를 확인해야 합니다. 표의 M10 약 $57/월은 비교용 가격이며 서울의 실제 견적은 별도로 확인합니다.

{{% /details %}}

## 배포 후 두 저장 경로 확인하기 {#우리-케이스에서는}

배포 전에는 차트가 만든 Collector 설정과 외부 연결 Secret을 확인합니다. 이어서 브라우저 이벤트가 ClickHouse에 쌓이는지, UI에서 만든 대시보드가 MongoDB 재시작 후에도 남는지 각각 확인합니다. 처리량이 작은 구성에서도 이 두 경로의 복구 확인은 필요합니다.

노드 장애와 AZ 장애를 포함한 검증은 [operator 토폴로지·다운타임]({{< relref "04-operator-topology-downtime.md" >}})에서 이어갑니다. 이 글의 자원 크기는 2026-07~08 조사에 기반한 시작값이며, Collector 버스트와 MongoDB 실제 사용량을 보고 조정합니다.
