---
title: "06 AZ affinity — 워커 두 대를 존으로 나누고 로컬 볼륨을 NAS로 옮기기"
date: 2026-10-06
lastmod: 2026-10-06
weight: 6
url: "/homelab/06-az-affinity/"
---

# AZ affinity — 라벨은 존 둘, 묶던 것은 로컬 볼륨, 과반은 세 번째 노드

hub 클러스터에 2026-10-05 두 번째 워커가 들어왔습니다. 두 워커에 AWS 서울 리전의 존 라벨을 붙이고 EKS에서 쓰는 스케줄링 규칙을 그대로 걸어 봤습니다. 두 장비는 같은 집, 같은 스위치, 같은 전원에 있습니다. 한 존이 죽어도 다른 존이 버티는 격리는 여기에 없습니다. 목적은 존 기준 규칙을 직접 다뤄 보는 연습과, AWS용 매니페스트를 고치지 않고 올리는 호환입니다. 존 라벨을 기준으로 파드 배치를 정하는 규칙을 이 글에서는 AZ affinity라고 부릅니다.

2026-10-06까지 확인한 범위는 규칙별 배치 결과와, 파드를 한 노드에 묶던 로컬 볼륨 3개(AWX의 PostgreSQL 1개, HyperDX의 MongoDB 2개)를 NAS로 옮긴 뒤의 데이터 대조입니다. 노드 하나를 내려서 파드가 다른 존으로 넘어가는지는 시험하지 않았습니다.

NAS 주소와 공유 경로는 `198.51.100.30` 같은 가상 값으로 바꿨고 비밀값은 싣지 않았습니다. 클러스터 배치는 [hub / edge 구조]({{< relref "/platform/homelab/01-hub-edge-architecture/index.md" >}})에 있습니다.

## 존 라벨

hub는 Kubernetes v1.36.4이고 kubespray v2.32로 관리합니다. 노드는 control plane인 master1, 워커 node1(i5-12600K, 64GB), 새로 들어온 워커 node2(Ryzen 5 5600G, 64GB)입니다. node2는 빌드 서버로 쓰던 장비입니다. OS를 다시 깔지 않고 `scale.yml --limit node2`로 편입했습니다.

| 노드 | `topology.kubernetes.io/region` | `topology.kubernetes.io/zone` | `topology.k8s.aws/zone-id` |
|---|---|---|---|
| node1 | `ap-northeast-2` | `ap-northeast-2a` | `apne2-az1` |
| node2 | `ap-northeast-2` | `ap-northeast-2c` | `apne2-az3` |
| master1 | 없음 | 없음 | 없음 |

```bash
kubectl label node node1 \
  topology.kubernetes.io/region=ap-northeast-2 \
  topology.kubernetes.io/zone=ap-northeast-2a \
  topology.k8s.aws/zone-id=apne2-az1
```

라벨만 붙였고 노드도 파드도 재시작하지 않았습니다. 같은 값을 kubespray 인벤토리의 `host_vars/node1.yml`과 `host_vars/node2.yml`에 `node_labels`로 적었습니다. kubespray를 다시 실행해도 node-label 롤이 같은 라벨을 유지합니다. zone-id 매핑은 AWS 계정마다 다릅니다. `2a`를 `apne2-az1`, `2c`를 `apne2-az3`으로 둔 것은 흔한 매핑을 고른 값입니다.

### master1에는 붙이지 않았다

EKS에서는 control plane이 노드 목록에 나오지 않습니다. 그 모습에 맞춰 master1에는 존 라벨을 붙이지 않았습니다. `topologySpreadConstraints`는 `topologyKey` 라벨이 없는 노드를 계산에서 건너뜁니다. [쿠버네티스 문서](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/)에는 그런 노드 위의 파드가 `maxSkew` 계산에 들지 않고 새 파드도 그 노드로 가지 않는다고 적혀 있습니다.

master1을 세 번째 존(`2b`)으로 두는 안도 따져 봤습니다. master1에는 `node-role.kubernetes.io/control-plane:NoSchedule` taint가 있어 일반 파드가 가지 못합니다. 그런데 같은 문서에 따르면 `nodeTaintsPolicy`를 적지 않았을 때의 동작은 `Ignore`입니다. taint를 보지 않고 모든 노드를 계산에 넣습니다. 그러면 파드가 0개인 존이 하나 생깁니다. `maxSkew: 1`에 `DoNotSchedule`이면 두 존에 하나씩 놓인 뒤 세 번째 복제본이 놓일 곳을 찾지 못합니다. 이 안은 돌려 보지 않았습니다. 문서의 기본값으로 따진 결과입니다.

master1에도 떠야 하는 워크로드는 존 키 대신 `kubernetes.io/hostname`을 씁니다. 뒤에 나오는 ClickHouse Keeper가 그 예입니다.

### 붙이기 전에 본 것

존 라벨을 읽는 설정이 이미 있으면 라벨을 붙이는 순간 동작이 바뀝니다. 그런 설정을 먼저 찾았습니다.

| 찾은 대상 | 결과 |
|---|---|
| 존 라벨을 참조하는 기존 파드 | keycloak 하나. `preferredDuringSchedulingIgnoredDuringExecution`의 약한 선호 |
| 토폴로지 인지 라우팅을 쓰는 Service(`trafficDistribution`, topology 어노테이션) | 0개 |
| Istio DestinationRule의 `outlierDetection`·`localityLbSetting` | 0개. meshConfig에도 locality 설정 없음 |
| StorageClass의 `allowedTopologies` | 전부 `kubernetes.io/hostname` 기준. 기존 PV에 존 제약이 생기지 않음 |

## 스케줄링 시험

임시 네임스페이스에 pause 이미지 Deployment를 올려 배치를 보고 지웠습니다.

| 시험 | 설정 | 결과 |
|---|---|---|
| 존마다 고르게 | `topologySpreadConstraints`, `maxSkew: 1`, `DoNotSchedule`, 복제본 2 | node1(`2a`) 1개, node2(`2c`) 1개 |
| 특정 존 고정 | `nodeAffinity` required, zone `In [ap-northeast-2c]`, 복제본 2 | 2개 모두 node2 |
| 존당 하나만 | `podAntiAffinity` required, `topologyKey` zone, 복제본 3 | 2개 Running(`2a`, `2c`), 1개 Pending |

```yaml
# 존마다 고르게
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels: {app: spread}
---
# 특정 존 고정
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - {key: topology.kubernetes.io/zone, operator: In, values: [ap-northeast-2c]}
---
# 존당 하나만
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - topologyKey: topology.kubernetes.io/zone
        labelSelector:
          matchLabels: {app: one-per-az}
```

세 번째 시험에서 Pending 파드에 남은 이벤트는 `0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 node(s) didn't match pod anti-affinity rules.`입니다. 존이 둘이라 세 번째 파드가 갈 곳이 없습니다. AWS에서 `2a`와 `2c` 두 존만 쓸 때와 같은 결과입니다.

이 메시지에서 master1은 존 라벨이 아니라 taint로 걸러졌습니다. kube-scheduler v1.36.0의 [anti-affinity 필터 소스](https://github.com/kubernetes/kubernetes/blob/v1.36.0/pkg/scheduler/framework/plugins/interpodaffinity/filtering.go)는 노드에 `topologyKey` 라벨이 있을 때만 충돌을 따집니다. control-plane toleration이 있는 파드에 존 기준 anti-affinity를 걸면 라벨 없는 master1은 막히지 않는다는 뜻입니다. 이 조합은 시험하지 않았습니다.

## 라벨만 붙여서 바뀌는 것과 바뀌지 않는 것

스케줄러 설정은 kubespray 기본값 그대로이고 따로 만든 프로파일이 없습니다. [쿠버네티스 문서](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/#internal-default-constraints)에 따르면 이때 kube-scheduler는 아래 규칙을 지정한 것처럼 동작합니다.

```yaml
defaultConstraints:
  - maxSkew: 3
    topologyKey: "kubernetes.io/hostname"
    whenUnsatisfiable: ScheduleAnyway
  - maxSkew: 5
    topologyKey: "topology.kubernetes.io/zone"
    whenUnsatisfiable: ScheduleAnyway
```

적용 대상은 `topologySpreadConstraints`를 적지 않았고 Service, ReplicaSet, StatefulSet, ReplicationController 가운데 하나에 속한 파드입니다. 존 라벨이 없을 때는 zone 쪽 규칙이 셀 대상이 없었습니다. 문서대로라면 라벨을 붙인 뒤에 뜨는 파드부터 존 분산 선호가 걸립니다. 이 선호가 실제 배치에 준 영향은 따로 확인하지 않았습니다. `ScheduleAnyway`라서 선호일 뿐이고 배치를 막지는 않습니다.

이미 떠 있는 파드는 옮겨지지 않습니다. 스케줄러는 새로 뜨는 파드만 배치합니다. 라벨을 붙인 직후 복제본이 2개 이상인 워크로드 17개를 보니 8개가 두 존에 걸쳐 있었고 9개는 `2a`(node1)에만 있었습니다. 그 9개는 node2가 생기기 전에 떴고 그 뒤 재시작된 적이 없습니다.

두 노드의 메모리 사용량이 크게 다른 이유도 같습니다. node1에서는 파드 136개가 약 29.5GiB를 썼고 node2에서는 파드 17개가 약 1.3GiB를 썼습니다. 이 비교에 `kubectl top node`를 쓰면 값이 어긋납니다. `kubectl top node`의 메모리는 kubelet이 보는 working set이며 활성 파일 캐시를 포함합니다. node2는 21GiB(35%)로 나왔지만 파드 밖 프로세스까지 포함한 노드 전체 기준으로는 프로세스가 실제로 쓰는 메모리가 2.4GiB였습니다.

## 존을 넘지 못하게 묶던 것은 로컬 볼륨

존 규칙을 걸어도 로컬 디스크 PV를 쓰는 파드는 그 PV가 있는 노드에서만 뜹니다. 그래서 PVC가 어떤 스토리지를 쓰는지 조사했습니다.

| 종류 | PVC 수 | 내용 |
|---|---|---|
| NFS(동적 프로비저닝) | 37 | 기본 클래스 `synology` |
| NFS(고정 PV) | 4 | minio |
| 로컬 디스크(local-path 계열) | 10 | ClickHouse 2, Keeper 3, AWX PostgreSQL 1, HyperDX MongoDB 2(data, logs), 핫딜 알림 봇 Valkey 1, memos 1 |

아래 그림은 옮기기 전 PostgreSQL과 MongoDB가 놓여 있던 상태입니다.

{{< flow src="_flow/4-1-로컬-볼륨은-파드를-노드에-묶는다.json" />}}

로컬 디스크에는 memos와 ClickHouse(Keeper 포함)만 남기고 나머지는 NAS로 옮기기로 했습니다. memos는 SQLite를 쓰므로 NFS의 파일 잠금 문제를 피하려고 로컬에 둡니다. ClickHouse는 레플리카 2개(node1, node2)와 Keeper 3대로 스스로 복제하므로 노드마다 로컬 디스크를 갖는 쪽이 맞습니다. 애플리케이션이 직접 복제할 때만 로컬 디스크로 버틸 수 있다는 판단은 [로컬 디스크와 복제]({{< relref "/data/block-storage/03-local-disk-ha/index.md" >}})에 정리돼 있습니다.

### vmstorage가 node1에만 있던 이유는 볼륨이 아니었다

조사 중에 vmstorage 4개가 모두 node1에 있는 것을 보고 로컬 볼륨 때문이라고 추측했습니다. 틀린 추측이었습니다. vmstorage는 이미 NFS를 쓰고 있었고 nodeSelector도 affinity도 없었습니다. node2가 생기기 전에 떴다는 것이 이유의 전부였습니다. PV 종류는 파드 위치로 짐작하지 않고 `kubectl get pvc`의 StorageClass 칸으로 확인합니다.

### DB용 NFS 클래스를 따로 만들었다

기본 클래스 `synology`는 reclaim 정책이 Delete입니다. DB용으로 Retain 클래스를 따로 만들었습니다. 이 클래스에서는 PVC를 지워도 NAS의 디렉터리가 남습니다.

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: synology-db
provisioner: nfs.csi.k8s.io
parameters:
  server: 198.51.100.30      # 가상 값
  share: /export/k8s-db      # 가상 값
reclaimPolicy: Retain
volumeBindingMode: Immediate
mountOptions:
  - nfsvers=4.1
  - hard
  - noatime
```

실제로 마운트된 옵션은 `nfs4 rw,noatime,vers=4.1,...,hard,proto=tcp,timeo=600,retrans=2`였습니다. NFS에서 쓰기가 언제 저장된 것으로 인정되는지는 [NFS 부록]({{< relref "/data/block-storage/a2-nfs/index.md" >}})에서 다룹니다.

MongoDB의 [Production Notes](https://www.mongodb.com/docs/manual/administration/production-notes/)는 WiredTiger를 POSIX를 따르는 원격 파일 시스템에 둘 수 있다고 하면서 로컬보다 느려 성능이 떨어질 수 있다고 적습니다. NFS를 쓸 때의 옵션으로는 `bg`, `hard`, `nolock`, `noatime`, `nointr`을 듭니다. 이 클래스에 적은 것은 그중 `hard`와 `noatime`입니다. 이 MongoDB는 데이터가 작고 쓰기가 드물어 성능 저하를 감수했습니다. 옮기기 전에 새 클래스의 임시 볼륨에서 uid 2000으로 mongod를 띄워 `j:true` 쓰기 1건이 되는 것을 확인했습니다.

### MongoDB — volumeClaimTemplates는 고칠 수 없다

HyperDX의 MongoDB는 MongoDB Community 오퍼레이터(MCK 1.12.0)가 관리하는 1멤버 레플리카셋입니다. 버전은 6.0.29, 스토리지 엔진은 WiredTiger, 데이터는 컬렉션 14개에 문서 11개입니다. HyperDX가 MongoDB에 무엇을 두는지는 [HyperDX의 MongoDB]({{< relref "/observability/apm-rum/07-hyperdx-mongodb.md" >}})에 있습니다. 값 파일에서 고친 것은 `volumeClaimTemplates`의 `storageClassName` 두 줄입니다. 같은 Helm 릴리스에 ClickHouse가 들어 있어서 `helm template` 결과를 전후로 비교했습니다. 바뀐 문서는 MongoDBCommunity 하나였고 ClickHouseInstallation과 ClickHouseKeeperInstallation은 같았습니다.

StatefulSet의 `volumeClaimTemplates`는 수정할 수 없는 필드입니다. 값만 바꿔 머지하면 오퍼레이터가 보낸 StatefulSet 갱신이 Forbidden으로 거부되고 CR이 Failed가 됩니다. 기존 파드는 계속 돕니다. 이 오퍼레이터는 거부당한 StatefulSet을 스스로 지우고 다시 만들지 않으므로 사람이 지워야 합니다. 지우면 오퍼레이터가 새 템플릿으로 다시 만듭니다. 2026-10-06에 아래 순서로 옮겼습니다.

1. 옛 로컬 PV의 reclaim 정책을 Retain으로 바꿉니다.
2. 값 파일을 머지합니다. CR은 Failed가 되고 파드는 그대로 돕니다.
3. Argo CD Application에 skip-reconcile 어노테이션을 붙여 조정을 멈춥니다.
4. HyperDX 앱을 0으로 줄이고 알림 CronJob을 중지합니다.
5. 컬렉션별 문서 수와 sha256을 스냅샷으로 남기고 `mongodump`를 뜹니다.
6. PVC 2개와 StatefulSet 2개를 지웁니다. 오퍼레이터가 새 템플릿으로 StatefulSet을 다시 만들고 NFS PVC가 생깁니다.
7. `mongorestore`로 넣고 스냅샷과 대조합니다.
8. 앱과 Argo CD 조정을 재개합니다.

대조 결과는 스냅샷과 완전히 같았습니다. 작업하는 동안 로그 수집(otel-collector에서 ClickHouse로)은 끊기지 않았습니다. ClickHouse와 Keeper 파드의 UID와 시작 시각, CR의 generation이 전후로 같았습니다.

### PostgreSQL — 다시 만든 StatefulSet이 옛 PVC를 문다

AWX의 PostgreSQL 15는 awx-operator가 관리하며 DB 크기는 약 122MB입니다. 여기서는 `postgres_storage_class` 값만 바꿔서는 볼륨이 옮겨지지 않습니다. awx-operator는 StatefulSet 적용이 422로 거부되면 StatefulSet을 지우고 다시 만듭니다. StatefulSet 이름과 템플릿 이름이 고정이라 PVC 이름이 같습니다. PVC 보존 정책이 Retain이라 옛 PVC가 남아 있습니다. 다시 만든 StatefulSet은 그 옛 로컬 PVC를 그대로 사용합니다.

그래서 같은 이름의 PVC를 NFS 클래스로 직접 바꿔 끼웠습니다.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-15-awx-postgres-15-0   # StatefulSet이 찾는 이름 그대로
  namespace: awx
spec:
  storageClassName: synology-db
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 8Gi
```

1. 리허설을 먼저 합니다. 가동 중에 뜬 `pg_dump`를 임시 파드의 NFS 볼륨에 `pg_restore`해서 권한과 소요 시간을 봅니다. 서비스는 멈추지 않습니다.
2. Argo CD 조정을 멈추고 오퍼레이터를 0으로 줄입니다.
3. awx-web과 awx-task를 0으로 줄이고 DB 접속이 0인 것을 확인합니다.
4. 대조 기준값을 저장하고 `pg_dump -Fc`를 뜹니다.
5. PostgreSQL을 0으로 줄이고 옛 PVC를 지웁니다. 옛 PV는 Retain이라 남습니다.
6. 위 PVC를 만들고 PostgreSQL을 1로 올립니다. 빈 DB가 초기화됩니다.
7. `pg_restore --clean --if-exists`로 넣고 기준값과 대조합니다.
8. 값 파일을 머지하고 옛 StatefulSet을 지운 뒤 CR 값을 맞추고 Argo CD 조정을 재개합니다. 오퍼레이터가 새 템플릿으로 StatefulSet과 web·task를 올립니다.

대조 기준은 테이블 235개의 행 수, 시퀀스 150개의 값, 인덱스 1,210개, 제약 1,116개, Django 마이그레이션 294건, 주요 테이블의 md5입니다. 406줄이 전후로 완전히 같았습니다. 덤프는 8MB, 복원은 10초였습니다. 전환 뒤 첫 주기 작업인 hub-healthcheck와 edge-healthcheck가 성공했습니다. 암호화해 저장한 credential이 복원 뒤에도 풀린다는 뜻입니다.

리허설에서는 init 컨테이너의 `chown 26:0`이 NFS 위에서 되는 것도 확인했습니다. NAS가 root squash를 하지 않기 때문입니다. skip-reconcile 어노테이션은 붙인 직후에 믿으면 안 됩니다. 이미 진행 중이던 동기화가 한 번 더 돌아 오퍼레이터를 1로 되돌렸습니다. 다시 0으로 내린 뒤에는 3분 동안 유지됐습니다.

### 옮긴 결과

{{< basis "기준 2026-10-06" "범위 hub 클러스터" "중단 시간은 작업 기록의 시각 차이" >}}

{{< kpis >}}
{{< kpi label="HyperDX UI 중단" value="약 5분" sub="22:25:45 ~ 22:30" >}}
{{< kpi label="AWX 중단" value="약 3분" sub="22:41:27 ~ 22:44:31" >}}
{{< kpi label="PostgreSQL 대조" value="406줄 동일" sub="행 수·시퀀스·인덱스·제약·md5" tone="good" >}}
{{< kpi label="로컬 PVC" value="10 → 7개" sub="ClickHouse 2 · Keeper 3 · memos 1 · Valkey 1" >}}
{{< /kpis >}}

옮기기 전에 node1에 고정돼 있던 MongoDB와 PostgreSQL 파드는 다시 뜨면서 node2(`2c`)에 자리 잡았습니다. AWX의 web·task 파드도 node2에 떴습니다.

{{< flow src="_flow/4-2-NFS-볼륨은-어느-존에서든-붙는다.json" />}}

MongoDB의 data 볼륨과 PostgreSQL 볼륨은 `synology-db`에, MongoDB의 logs 볼륨은 기본 클래스 `synology`에 있습니다. 옛 로컬 PV 3개는 Retain으로 남아 Released 상태입니다(2026-10-06 `kubectl get pv`). 로컬에 남은 7개 가운데 Valkey는 다음 절의 이유로 따로 다룹니다.

## 존이 둘뿐이면 과반을 만들 수 없다

자동 장애 조치에는 과반 투표가 필요합니다. 존이 둘이면 한쪽이 죽었을 때 남은 쪽이 혼자 결정하지 못합니다. 상대가 죽은 것인지 네트워크가 끊긴 것인지 구분할 수 없기 때문입니다. [AWS 문서](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/AutoFailover.html)에는 Multi-AZ를 켰을 때 ElastiCache가 primary의 상태를 계속 감시하다가 장애가 나면 replica를 승격한다고 적혀 있습니다. 감시와 승격을 서비스가 맡는다는 뜻으로 읽었습니다. 홈랩에는 그 일을 맡을 제3자가 없습니다.

이 클러스터에서는 세 번째 투표자를 master1에 둡니다. ClickHouse Keeper 3대가 master1, node1, node2에 하나씩 떠 있습니다. control-plane toleration을 주고 `kubernetes.io/hostname` 기준 anti-affinity를 걸었습니다. Keeper가 2대 미만으로 남으면 ClickHouse 쓰기가 멈춥니다. 워커 한 대가 죽어도 Keeper는 2대가 남는 배치입니다.

핫딜 알림 봇의 Valkey에도 "쓰기 노드가 죽으면 읽기 노드가 이어받는" 구성을 검토했고 보류했습니다. 이 Valkey에는 중복 알림을 막는 키 34개가 TTL 7일로 들어 있습니다.

- 공식 valkey-io/valkey-operator는 클러스터 모드 전용이고 README에 "not ready for production use"라고 적혀 있습니다(2026-10-06 확인). 이 판정의 배경은 [두 갈래]({{< relref "/data/cache/valkey-cases/00-두-갈래.md" >}})와 [2,000노드 Valkey]({{< relref "/data/cache/valkey-cases/cluster-xl-scale/01-부러지는-것/index.md" >}})에 있습니다.
- 복제에 Sentinel을 붙이려면 Sentinel 3대가 필요하고 그중 하나는 master1에 가야 합니다.
- 영속성을 끈 복제는 [Valkey 문서](https://valkey.io/topics/replication/)가 경고하는 조합입니다. 빈 채로 다시 뜬 primary를 replica가 따라가면 데이터가 전부 지워질 수 있습니다. 문서는 primary와 replica 모두 영속성을 켜라고 강하게 권합니다.

대안으로 "단일 인스턴스, 디스크 없음, `2a` 선호에 `2c` fallback"을 설계해 뒀습니다. node1이 죽으면 약 2분 뒤 node2에서 빈 채로 다시 뜨고 영향은 중복 알림 3건 안팎입니다. 두 값 모두 추정입니다. 2분은 node-monitor-grace-period 40초, tolerationSeconds 60초, 기동 시간을 더한 값입니다. 이 설계는 아직 적용하지 않았습니다.

## 실제 AWS와 다른 점

라벨이 같아도 아래는 AWS와 다르게 동작합니다.

- 물리적 격리가 없습니다. 전원이나 스위치가 죽으면 두 존이 함께 죽습니다.
- EBS는 볼륨이 존에 묶여 파드가 그 존을 따라갑니다. 여기 NFS 볼륨에는 존 제약이 없어 어느 노드에서든 붙습니다. 로컬 볼륨은 존이 아니라 노드에 묶입니다. EBS를 전제로 한 "볼륨이 있는 존으로 파드가 간다"는 동작은 이 구성으로 연습하지 못합니다.
- zone-id 매핑은 계정마다 다릅니다. 라벨의 `apne2-az1`을 실제 계정의 값과 같다고 보면 안 됩니다.
- 같은 존 우선 라우팅은 Service마다 `trafficDistribution`을 켜야 작동하는데 켜지 않았습니다. 쿠버네티스 문서는 `PreferClose`를 `PreferSameZone`의 예전 별칭이자 deprecated로 적으므로, 켠다면 `PreferSameZone`을 씁니다.
- 상태가 NAS 한 대에 모였습니다. 노드 한 대가 죽는 것은 견디지만 NAS가 죽으면 NFS를 쓰는 워크로드 전부가 멈춥니다.

## 확인 범위와 남은 일

2026-10-05와 10-06에 확인한 것은 라벨 값, 시험 Deployment의 배치와 Pending 이벤트, 두 DB의 이전 전후 데이터 대조, 옮긴 뒤 남은 로컬 PVC 7개입니다. 라벨과 PVC의 StorageClass는 2026-10-06에 `kubectl get nodes -L`과 `kubectl get pvc -A`로 다시 조회했습니다.

장애 상황의 동작은 하나도 시험하지 않았습니다. 확인한 것은 정상 상태의 배치뿐입니다.

- 노드 하나를 내려 파드가 다른 존에서 다시 뜨는지 보지 않았습니다. NFS로 옮긴 DB 파드가 node1에서도 뜬다는 것은 볼륨에 존 제약이 없다는 사실에서 나온 판단입니다.
- `2a`에만 있는 워크로드 9개는 다시 뜰 때까지 그대로 남습니다.
- master1을 세 번째 존으로 두는 안과, 라벨 없는 노드에 대한 존 기준 anti-affinity는 문서와 소스로만 따졌습니다.
- Valkey 대안 설계는 적용하지 않았고 약 2분과 3건은 추정입니다.
- MongoDB를 NFS에 둔 뒤의 성능은 재지 않았습니다. 문서가 권하는 옵션 가운데 `bg`, `nolock`, `nointr`은 적지 않았습니다.
- NAS는 단일 실패점으로 남았습니다. 이번 작업으로 NAS에 의존하는 DB가 둘 늘었습니다.
