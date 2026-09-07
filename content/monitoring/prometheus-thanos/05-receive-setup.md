---
title: "Receive 실전 구성"
date: 2026-08-30
lastmod: 2026-08-30
weight: 5
---

# Thanos Receive 실전 구성

앞 문서에서 내린 결론을 실제 배치로 옮기는 단계입니다. 뜨는 파드는 Receive, Compactor, Store Gateway, Querier 넷이고, 캐시까지 붙이면 다섯이 됩니다.

```
vmagent / Prometheus(agent) ──remote write──▶ Receive (로컬 TSDB → 2h마다 업로드)
                                                  │
                                                  ▼
                                            오브젝트 스토리지
                                                  ▲
                        Compactor (병합·다운샘플·리텐션, 싱글턴)
                                                  │
Grafana ◀── Querier ◀── Store Gateway ────────────┘
              └────── Receive (최근 구간)
```

## 버킷 설정 (공통)

네 컴포넌트가 같은 파일을 Secret으로 마운트합니다.

```yaml
type: S3
config:
  bucket: thanos-metrics
  endpoint: s3.ap-northeast-2.amazonaws.com
  region: ap-northeast-2
  access_key: ...
  secret_key: ...
```

MinIO나 사내 오브젝트 스토리지를 쓴다면 `endpoint`를 해당 서비스 주소로 바꾸고, 평문 통신이면 `insecure: true`를 넣습니다.

스토리지 클래스는 S3 Standard여야 합니다. Standard-IA나 Glacier IR을 고르면 Store Gateway가 블록을 동기화할 때와 쿼리를 처리할 때마다 GB당 리트리벌 수수료가 붙습니다. 근거는 [스토리지 단가]({{< relref "../longterm-retention/06-storage-pricing.md" >}}) 문서에 있습니다.

## Receive (StatefulSet)

```
thanos receive
  --tsdb.path=/var/thanos/receive
  --tsdb.retention=15d
  --remote-write.address=0.0.0.0:19291
  --grpc-address=0.0.0.0:10901
  --http-address=0.0.0.0:10902
  --receive.replication-factor=1
  --label=receive_replica="$(POD_NAME)"
  --label=receive_cluster="prod"
  --objstore.config-file=/etc/thanos/objstore.yml
```

`--tsdb.retention`의 기본값은 `15d`입니다. Receive에서는 이 값이 tenant 데이터를 로컬에 얼마나 오래 들고 있을지를 정합니다. 블록이 2시간마다 버킷으로 올라가니 로컬에 15일을 쌓아둘 이유는 대개 없고, 줄이는 만큼 EBS 비용도 내려갑니다. 그렇다고 업로드 주기보다 짧게 잡으면 올라가기도 전에 지워지므로 여유는 남겨 둡니다.

`--label` 값은 레플리카마다 달라야 합니다. 가장 안전한 방법은 `$(POD_NAME)`을 downward API로 주입하는 것인데, 그러면 StatefulSet 인덱스가 그대로 들어갑니다. 여기가 겹치면 앞에서 본 Compactor halt로 이어집니다.

단일 노드라면 hashring 파일을 주지 않아도 되고, 이때는 라우팅 없이 ingestor로만 동작합니다. `--receive.hashrings-file`과 `--receive.local-endpoint`는 레플리카를 늘려 샤딩할 때 비로소 필요해집니다.

Receive는 무상태가 아닙니다. PVC 없이 Deployment로 띄우면 재시작할 때마다 아직 업로드되지 않은 구간이 사라집니다.

## Compactor (replicas: 1 고정)

```
thanos compact
  --data-dir=/var/thanos/compact
  --objstore.config-file=/etc/thanos/objstore.yml
  --retention.resolution-raw=14d
  --retention.resolution-5m=90d
  --retention.resolution-1h=1y
  --delete-delay=48h
  --compact.concurrency=1
  --downsample.concurrency=1
  --wait
```

`--wait`가 없으면 한 번 실행하고 그대로 종료하므로, 상주시킬 생각이면 반드시 넣습니다.

`--data-dir`은 Compactor의 작업 공간입니다. 병합 대상 블록을 여기에 내려받아 펼치기 때문에 디스크가 있어야 하고, 필요한 크기는 데이터 규모를 따라갑니다.

`--delete-delay`는 삭제 표시가 붙은 뒤 실제로 지워지기까지의 유예이고 기본값은 48h입니다. 리텐션을 잘못 잡았을 때 되돌릴 시간을 이 유예가 벌어줍니다.

## Store Gateway

```
thanos store
  --data-dir=/var/thanos/store
  --objstore.config-file=/etc/thanos/objstore.yml
  --grpc-address=0.0.0.0:10901
  --index-cache-size=500MB
  --chunk-pool-size=500MB
```

Store Gateway는 블록마다 index-header를 로컬에 만들어 보관합니다. 그래서 버킷의 블록 수가 늘어나는 만큼 디스크와 메모리도 같이 늡니다. 규모가 어느 선을 넘으면 memcached 기반 index/chunk/bucket 캐시를 따로 붙입니다.

## Querier

```
thanos query
  --http-address=0.0.0.0:9090
  --endpoint=dnssrv+_grpc._tcp.thanos-store.monitoring.svc.cluster.local
  --endpoint=dnssrv+_grpc._tcp.thanos-receive.monitoring.svc.cluster.local
  --query.replica-label=receive_replica
```

`--query.replica-label`을 빠뜨리면 안 됩니다. Receive 레플리카마다 다른 라벨을 붙여 두었기 때문에, 조회 단계에서 그 라벨을 기준으로 중복을 걷어내지 않으면 같은 시리즈가 두 줄로 나옵니다.

Grafana에는 Prometheus 타입 데이터소스로 붙입니다. 쿼리 언어는 PromQL입니다.

## 송신측

vmagent를 쓴다면 설정은 이렇게 잡습니다.

```
-remoteWrite.url=http://thanos-receive.monitoring.svc:19291/api/v1/receive
-remoteWrite.queues=1
-remoteWrite.maxDiskUsagePerURL=10GB
```

tenant를 나눌 계획이라면 `-remoteWrite.headers`로 `THANOS-TENANT`를 함께 실어 보내고, 따로 주지 않으면 `default-tenant`로 들어갑니다.

Prometheus를 agent 모드로 쓴다면 `remote_write` 블록에 같은 URL을 넣고, tenant는 `headers`로 지정합니다.

## 밟기 쉬운 것들

Compactor halt는 알림으로 잡습니다. `thanos_compact_halted == 1`에 알림을 걸어 두지 않으면 정지된 사실을 몇 주 뒤 청구서로 알게 됩니다.

리텐션 기본값도 확인합니다. `--retention.resolution-*`의 기본은 `0d`이고, 그 뜻은 무제한 보존입니다. 세 개를 직접 명시하지 않으면 아무것도 지워지지 않습니다.

다운샘플에는 성립 조건이 있습니다. `--retention.resolution-raw`를 40시간보다 짧게 잡으면 5m 블록이 생기지 않습니다.

Compactor 중복 실행은 배포 도중에도 일어납니다. 이전 파드와 새 파드가 잠깐 겹치는 순간도 중복이므로, 롤링 업데이트 전략을 `Recreate`로 둡니다.

Istio 메시 안이라면 Service 포트 이름을 `grpc-`로 시작하게 짓습니다. 이름이 맞지 않으면 Envoy가 그 트래픽을 평범한 TCP로 취급해 Querier의 gRPC 팬아웃 로드밸런싱이 제대로 동작하지 않습니다.

차트를 고를 때는 bitnami/thanos가 널리 쓰이지만, 이미지 배포 정책이 바뀐 뒤라 이미지 레지스트리를 `quay.io/thanos/thanos`로 override 하거나 kube-thanos 계열을 쓰는 편이 안전합니다.

## 참고

- thanos.io Receive / Compact / Store / Query 컴포넌트 문서
- 비용 대입과 컴포넌트별 실패 모드: [Thanos — Receive → S3]({{< relref "../longterm-retention/03-thanos-s3.md" >}})
