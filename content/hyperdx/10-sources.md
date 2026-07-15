---
title: "출처"
weight: 10
---

# 출처 — HyperDX 내재화(실전 배포) 조사 자료

이 표는 [개요]({{< relref "_index.md" >}}), [스택 토폴로지·MongoDB 최소 규모]({{< relref "01-stack-topology.md" >}}), [hot 스토리지(EBS)]({{< relref "02-hot-storage-ebs.md" >}}), [S3 cold 티어링]({{< relref "03-s3-cold-tiering.md" >}}), [operator 토폴로지·다운타임]({{< relref "04-operator-topology-downtime.md" >}}), [Keeper]({{< relref "05-keeper.md" >}}), [복제·멀티마스터·failover]({{< relref "06-replication-failover.md" >}}), [용량 산정]({{< relref "07-capacity-planning.md" >}}), [블록 온리 튜닝]({{< relref "08-block-only-tuning.md" >}}), [버전 호환·업그레이드]({{< relref "09-version-upgrade-compat.md" >}}) 열 페이지가 인용한 1차 조사(R1~R9)의 `## 출처` 섹션을 모아 중복을 제거하고 주제별로 분류했다. 조사 기준일은 **2026-07-16**다.

각 조사가 다룬 범위는 ClickStack 4컴포넌트 배포 토폴로지와 MongoDB 최소 규모 운영, EBS(gp3/io2/io2 Block Express) hot 스토리지 선택, S3 cold 티어링 worked example, Altinity operator 기반 replication·sharding·다운타임 시나리오, ClickHouse Keeper 상세와 "큐가 아니다" 정정, 그리고 0.7TB/월 RUM 워크로드의 용량 산정이다.

개별 URL의 등급(`✓`/`≈`/`?`/`Ⓥ`/`Ⓑ`)은 각 페이지 본문의 인라인 태그를 따른다 — 이 표 자체는 출처 목록이며 등급을 재판정하지 않는다. 기존 study-hugo 코퍼스(`content/clickhouse/*`, `content/rum/*`) 및 선행 research(`research/hyperdx-clickhouse/*`) 참조는 각 페이지에서 relref로 인라인 연결하며 외부 URL이 아니므로 아래 표에는 싣지 않았다.

## ClickStack · HyperDX 공식

HyperDX·ClickStack 배포 문서, 스키마/TTL 설정, Browser SDK, 그리고 실물 Helm 차트 값·매니페스트.

| 설명 | 링크 |
|---|---|
| ClickStack Helm 배포 가이드(2-차트 구조·PVC 보호) | [clickhouse.com/docs/.../clickstack/deployment/helm](https://clickhouse.com/docs/use-cases/observability/clickstack/deployment/helm) |
| ClickStack OTel Collector(역할·포트·배치·큐·사이징) | [clickhouse.com/docs/.../clickstack/ingesting-data/otel-collector](https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/otel-collector) |
| ClickStack Tables and schemas(otel_logs/traces/metrics·hyperdx_sessions ORDER BY·TTL·partition) | [clickhouse.com/docs/.../clickstack/ingesting-data/schemas](https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/schemas) |
| ClickStack Managing TTL(기본 3일·`${TABLES_TTL}`·ALTER MODIFY TTL·MATERIALIZE TTL) | [clickhouse.com/docs/.../clickstack/ttl](https://clickhouse.com/docs/use-cases/observability/clickstack/ttl) |
| ClickStack Configuration options | [clickhouse.com/docs/.../clickstack/config](https://clickhouse.com/docs/use-cases/observability/clickstack/config) |
| ClickStack Session replay(rrweb → hyperdx_sessions·Body/LogAttributes) | [clickhouse.com/docs/.../clickstack/session-replay](https://clickhouse.com/docs/use-cases/observability/clickstack/session-replay) |
| ClickStack OSS 소개(otel_* + hyperdx_sessions·ZSTD) | [clickhouse.com/blog/clickstack-a-high-performance-oss-observability-stack](https://clickhouse.com/blog/clickstack-a-high-performance-oss-observability-stack-on-clickhouse) |
| HyperDX Browser SDK(4318 인제스트) | [hyperdx.io/docs/install/browser](https://www.hyperdx.io/docs/install/browser) |
| HyperDX LOCAL.md(포트 8080/8000/8002/4317/4318) | [github.com/hyperdxio/hyperdx/.../LOCAL.md](https://github.com/hyperdxio/hyperdx/blob/main/LOCAL.md) |
| ClickStack-helm-charts README(2-차트 구조·PVC 보호) | [github.com/ClickHouse/ClickStack-helm-charts/.../README.md](https://github.com/ClickHouse/ClickStack-helm-charts/blob/main/README.md) |
| ClickStack-helm-charts values.yaml(members:1·mongo 5.0.32·storage 10Gi·otel mode:deployment·이미지 태그) | [raw.githubusercontent.com/.../clickstack/values.yaml](https://raw.githubusercontent.com/ClickHouse/ClickStack-helm-charts/main/charts/clickstack/values.yaml) |
| ClickStack-helm-charts UPGRADE.md | [github.com/ClickHouse/ClickStack-helm-charts/.../UPGRADE.md](https://github.com/ClickHouse/ClickStack-helm-charts/blob/main/docs/UPGRADE.md) |

## ClickHouse 공식 (docs · 엔지니어링)

ClickHouse Inc.의 스토리지·복제·insert·Keeper 문서와 압축·비용 엔지니어링 자료, GitHub PR.

| 설명 | 링크 |
|---|---|
| External disks for storing data(type=s3/object_storage·cache disk·metadata_type/path) | [clickhouse.com/docs/operations/storing-data](https://clickhouse.com/docs/operations/storing-data) |
| Integrating S3(type=s3 예제·ReplicatedMergeTree on S3) | [clickhouse.com/docs/integrations/s3](https://clickhouse.com/docs/integrations/s3) |
| Observability managing data(TTL·ttl_only_drop_parts·merge_with_ttl_timeout·MATERIALIZE TTL) | [clickhouse.com/docs/observability/managing-data](https://clickhouse.com/docs/observability/managing-data) |
| ClickHouse Keeper(NuRaft/Raft·ZK 호환·저장 대상·3노드) | [clickhouse.com/docs/guides/sre/keeper/clickhouse-keeper](https://clickhouse.com/docs/guides/sre/keeper/clickhouse-keeper) |
| Replicated* table engines(Keeper=메타만·데이터 직송·~10 znode/INSERT·블록 dedup) | [clickhouse.com/docs/engines/table-engines/mergetree-family/replication](https://clickhouse.com/docs/engines/table-engines/mergetree-family/replication) |
| Asynchronous inserts(wait 1/0·메모리 버퍼 크래시 유실·flush 트리거·async dedup off) | [clickhouse.com/docs/optimize/asynchronous-inserts](https://clickhouse.com/docs/optimize/asynchronous-inserts) |
| Selecting an insert strategy(동기 멱등·기본 dedup·배칭 1k~100k·at-least-once) | [clickhouse.com/docs/best-practices/selecting-an-insert-strategy](https://clickhouse.com/docs/best-practices/selecting-an-insert-strategy) |
| Deduplicating inserts on retries(replicated_deduplication_window(_seconds)·insert_deduplication_token) | [clickhouse.com/docs/guides/developer/deduplicating-inserts-on-retries](https://clickhouse.com/docs/guides/developer/deduplicating-inserts-on-retries) |
| Using the Kafka table engine(Kafka engine→MV→MergeTree·파괴적 읽기·offset) | [clickhouse.com/docs/integrations/kafka/kafka-table-engine](https://clickhouse.com/docs/integrations/kafka/kafka-table-engine) |
| Insert quorum parallel by default (PR #17567·insert_quorum_parallel 기본 1) | [github.com/ClickHouse/ClickHouse/pull/17567](https://github.com/ClickHouse/ClickHouse/pull/17567) |
| nginx 로그 압축 170x(52~178x·낙관 상한 명시) | [clickhouse.com/blog/log-compression-170x](https://clickhouse.com/blog/log-compression-170x) |
| 압축 codec/ratio 개관 | [clickhouse.com/resources/engineering/database-compression](https://clickhouse.com/resources/engineering/database-compression) |
| Observability cost optimization playbook(10~20x·7일 hot/cold·365 DELETE 예시) | [clickhouse.com/resources/.../observability-cost-optimization-playbook](https://clickhouse.com/resources/engineering/observability-cost-optimization-playbook) |
| Data Replication(멀티마스터·비동기·"only source data transferred"·SELECT은 Keeper 안 탐·블록 dedup) | [clickhouse.com/docs/engines/table-engines/mergetree-family/replication](https://clickhouse.com/docs/engines/table-engines/mergetree-family/replication) |
| system.replicas(is_leader "multiple leaders"·is_readonly·log_pointer vs log_max_index·absolute_delay) | [clickhouse.com/docs/operations/system-tables/replicas](https://clickhouse.com/docs/operations/system-tables/replicas) |
| system.replication_queue(type enum GET_PART/MERGE_PARTS/MUTATE_PART/DROP_RANGE·num_tries·postpone_reason) | [clickhouse.com/docs/operations/system-tables/replication_queue](https://clickhouse.com/docs/operations/system-tables/replication_queue) |
| Distributed 테이블 엔진(load_balancing·native connection failover) | [clickhouse.com/docs/engines/table-engines/special/distributed](https://clickhouse.com/docs/engines/table-engines/special/distributed) |
| Read consistency KB(insert_quorum·select_sequential_consistency·read-after-write) | [clickhouse.com/docs/knowledgebase/read_consistency](https://clickhouse.com/docs/knowledgebase/read_consistency) |
| leader election 제거 — issue #10367 / PR #11639·#11795(20.6+ multiple leaders) | [github.com/ClickHouse/ClickHouse/pull/11639](https://github.com/ClickHouse/ClickHouse/pull/11639) |
| TABLE_IS_READ_ONLY(에러 242) — Keeper/ZK 미가용 시 RMT read-only(issue #65424·#31052) | [github.com/ClickHouse/ClickHouse/issues/65424](https://github.com/ClickHouse/ClickHouse/issues/65424) |

## AWS 공식 (EBS · EC2 · S3)

EBS 볼륨 스펙·요금·내구성, gp3 상향 발표, io2 Block Express, EBS-optimized 인스턴스 대역, Multi-Attach.

| 설명 | 링크 |
|---|---|
| EBS General Purpose SSD (gp3) User Guide(baseline 3,000/125·max 80,000 IOPS/2,000 MiB/s·64 TiB·durability·Outposts 16,000/1,000 한계) | [docs.aws.amazon.com/ebs/.../general-purpose.html](https://docs.aws.amazon.com/ebs/latest/userguide/general-purpose.html) |
| EBS Volume Types(io2 BE 256,000 IOPS/4,000 MB/s·99.999%·<500µs·gp3·io1) | [aws.amazon.com/ebs/volume-types](https://aws.amazon.com/ebs/volume-types/) |
| EBS Provisioned IOPS SSD (io2/io2 Block Express) User Guide | [docs.aws.amazon.com/ebs/.../provisioned-iops.html](https://docs.aws.amazon.com/ebs/latest/userguide/provisioned-iops.html) |
| EBS pricing(gp3 $0.08/GB·$0.005/IOPS·throughput·io2 tiered IOPS·$0.125/GB) | [aws.amazon.com/ebs/pricing](https://aws.amazon.com/ebs/pricing/) |
| What's New — gp3 max size & provisioned performance 상향(2025-09·80,000/2,000/64TiB) | [aws.amazon.com/.../2025/09/amazon-ebs-size-provisioned-performance-gp3-volumes](https://aws.amazon.com/about-aws/whats-new/2025/09/amazon-ebs-size-provisioned-performance-gp3-volumes/) |
| Storage Blog — larger and faster gp3(스트라이핑 대체·요금 동일·단일 볼륨 내구성) | [aws.amazon.com/blogs/storage/improve-your-application-resiliency-with-larger-and-faster-gp3-volumes](https://aws.amazon.com/blogs/storage/improve-your-application-resiliency-with-larger-and-faster-gp3-volumes/) |
| EBS-optimized instance types(r7g/m7g baseline vs burst 대역·IOPS) | [docs.aws.amazon.com/AWSEC2/.../ebs-optimized.html](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ebs-optimized.html) |
| EC2 r7g instances(EBS Gbps by size) | [aws.amazon.com/ec2/instance-types/r7g](https://aws.amazon.com/ec2/instance-types/r7g/) |
| EC2 memory-optimized specifications | [docs.aws.amazon.com/ec2/.../mo.html](https://docs.aws.amazon.com/ec2/latest/instancetypes/mo.html) |
| Storage Blog — io2 Block Express higher DB performance(<500µs) | [aws.amazon.com/blogs/storage/achieve-higher-database-performance-using-amazon-ebs-io2-block-express-volumes](https://aws.amazon.com/blogs/storage/achieve-higher-database-performance-using-amazon-ebs-io2-block-express-volumes/) |
| EBS Multi-Attach(io1/io2 전용·같은 AZ·최대 16 Nitro·cluster-aware FS 필수) | [docs.aws.amazon.com/ebs/.../ebs-volumes-multi.html](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes-multi.html) |
| What's New — io2 Block Express 전 리전 지원(2025-07) | [aws.amazon.com/.../2025/07/amazon-ebs-io2-block-express](https://aws.amazon.com/about-aws/whats-new/2025/07/amazon-ebs-io2-block-express/) |
| What's New — 128 volume attachments per instance(7세대·기본 32 dedicated) | [aws.amazon.com/.../2023/08/amazon-ebs-128-volume-attachments-ec2-instance](https://aws.amazon.com/about-aws/whats-new/2023/08/amazon-ebs-128-volume-attachments-ec2-instance/) |

## Altinity · clickhouse-operator

Altinity operator/backup 문서·GitHub 이슈, EBS/S3 KB, CRD install bundle, tiered-S3 예제 YAML, dedup/Keeper KB.

| 설명 | 링크 |
|---|---|
| KB — AWS EC2 Storage(gp3 native·1-3 volume·7,000 IOPS/1,000 MiB/s safe·io2 500 MiB/s 낡은 주장) | [kb.altinity.com/.../aws-ec2-storage](https://kb.altinity.com/altinity-kb-setup-and-maintenance/aws-ec2-storage/) |
| Blog — Managing EBS gp3 Volumes in EKS(StorageClass ebs.csi.aws.com·throughput·allowVolumeExpansion·WaitForFirstConsumer) | [altinity.com/blog/managing-ebs-gp3-volumes-in-eks](https://altinity.com/blog/managing-ebs-gp3-volumes-in-eks) |
| Blog — reclaimPolicy(volumeClaimTemplate reclaimPolicy: Retain·라벨·수동삭제) | [altinity.com/blog/preventing-clickhouse-storage-deletion-...reclaimpolicy](https://altinity.com/blog/preventing-clickhouse-storage-deletion-with-the-altinity-kubernetes-operator-reclaimpolicy) |
| operator docs/storage.md(volumeClaimTemplates·storageClassName) | [github.com/Altinity/clickhouse-operator/.../storage.md](https://github.com/Altinity/clickhouse-operator/blob/master/docs/storage.md) |
| operator CRD install bundle(reconcile.host.wait.probes·statefulSet.update·runtime·pdbManaged·podDistribution enum·suspend) | [raw.githubusercontent.com/.../clickhouse-operator-install-bundle.yaml](https://raw.githubusercontent.com/Altinity/clickhouse-operator/master/deploy/operator/clickhouse-operator-install-bundle.yaml) |
| chi-example 03-persistent-volume-08-tiered-s3.yaml(storage_configuration.xml·s3_disk/s3_cache/정책 3종·hot=default) | [raw.githubusercontent.com/.../03-persistent-volume-08-tiered-s3.yaml](https://raw.githubusercontent.com/Altinity/clickhouse-operator/master/docs/chi-examples/03-persistent-volume-08-tiered-s3.yaml) |
| KB — AWS S3 Recipes(IAM 정책·IRSA SA annotation·use_environment_credentials·endpoint 포맷) | [kb.altinity.com/.../aws-s3-recipes](https://kb.altinity.com/altinity-kb-setup-and-maintenance/altinity-kb-s3-object-storage/aws-s3-recipes/) |
| KB — S3Disk | [kb.altinity.com/.../s3disk](https://kb.altinity.com/altinity-kb-setup-and-maintenance/altinity-kb-s3-object-storage/s3disk/) |
| KB — Insert Deduplication / Idempotency(블록 체크섬을 Keeper /blocks znode 파티션별 저장) | [kb.altinity.com/altinity-kb-schema-design/insert_deduplication](https://kb.altinity.com/altinity-kb-schema-design/insert_deduplication/) |
| KB — Using clickhouse-keeper | [kb.altinity.com/.../clickhouse-keeper](https://kb.altinity.com/altinity-kb-setup-and-maintenance/altinity-kb-zookeeper/clickhouse-keeper/) |
| KB — DDLWorker and DDL queue problems(task_queue/ddl znode·직렬 sequential·task_max_lifetime) | [kb.altinity.com/.../altinity-kb-ddlworker](https://kb.altinity.com/altinity-kb-setup-and-maintenance/altinity-kb-ddlworker/) |
| operator issue #1619 — reclaimPolicy Retain not honored | [github.com/Altinity/clickhouse-operator/issues/1619](https://github.com/Altinity/clickhouse-operator/issues/1619) |
| operator issue #1385 — PVC volume template 확장 시 데이터 손실 | [github.com/Altinity/clickhouse-operator/issues/1385](https://github.com/Altinity/clickhouse-operator/issues/1385) |
| operator issue #1408 — reclaimPolicy in ClickHouseKeeper | [github.com/Altinity/clickhouse-operator/issues/1408](https://github.com/Altinity/clickhouse-operator/issues/1408) |
| clickhouse-backup issue #798 — IRSA self-assume 버그 | [github.com/Altinity/clickhouse-backup/issues/798](https://github.com/Altinity/clickhouse-backup/issues/798) |
| clickhouse-backup issue #1025 — use_environment_credentials IRSA | [github.com/Altinity/clickhouse-backup/issues/1025](https://github.com/Altinity/clickhouse-backup/issues/1025) |
| KB — Load balancers(native 9000 TCP 한계·HTTP 8123 chproxy/HAProxy·클라 측 LB 3전략) | [kb.altinity.com/.../load-balancers](https://kb.altinity.com/altinity-kb-setup-and-maintenance/load-balancers/) |
| KB — Check replication & DDL queue(system.replicas/replication_queue 점검·SYSTEM RESTART/SYNC/RESTORE REPLICA) | [kb.altinity.com/.../altinity-kb-check-replication-ddl-queue](https://kb.altinity.com/altinity-kb-setup-and-maintenance/altinity-kb-check-replication-ddl-queue/) |

## MongoDB · MCK

HyperDX 메타데이터 스토어(MongoDB) 최소 규모 운영·WiredTiger 캐시·백업·Community/Enterprise 통합 operator.

| 설명 | 링크 |
|---|---|
| mongodb/mongodb-kubernetes(MCK — community+enterprise 통합 리네임) | [github.com/mongodb/mongodb-kubernetes](https://github.com/mongodb/mongodb-kubernetes) |
| Community Operator 샘플(pod resources·SCRAM·members:3) | [github.com/mongodb/mongodb-kubernetes-operator/.../specify_pod_resources.yaml](https://github.com/mongodb/mongodb-kubernetes-operator/blob/master/config/samples/mongodb.com_v1_mongodbcommunity_specify_pod_resources.yaml) |
| WiredTiger 스토리지 엔진(캐시 산식) | [mongodb.com/docs/manual/core/wiredtiger](https://www.mongodb.com/docs/manual/core/wiredtiger/) |
| MongoDB 백업 방법(mongodump vs Ops Manager) | [mongodb.com/docs/manual/core/backups](https://www.mongodb.com/docs/manual/core/backups/) |
| Community Operator 백업 부재 → mongodump(forums) | [mongodb.com/community/forums/t/backups-from-kubernetes/161702](https://www.mongodb.com/community/forums/t/backups-from-kubernetes/161702) |

## OpenTelemetry

Collector exporter·persistent queue·resiliency 문서(CH 앞단 유실 방어 근거).

| 설명 | 링크 |
|---|---|
| ClickHouse exporter README(create_schema·ttl_days) | [github.com/open-telemetry/opentelemetry-collector-contrib/.../clickhouseexporter/README.md](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/clickhouseexporter/README.md) |
| exporterhelper README(sending_queue.storage·queue_size 1000·num_consumers 10·block_on_overflow·WAL 재개) | [github.com/open-telemetry/opentelemetry-collector/.../exporterhelper/README.md](https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/exporterhelper/README.md) |
| Resiliency(persistent queue·at-least-once·file_storage) | [opentelemetry.io/docs/collector/resiliency](https://opentelemetry.io/docs/collector/resiliency/) |

## Kubernetes · 노드/스토리지 운영 (다운타임)

노드 급사·비정상 종료·PVC AZ 고정·force-detach·Karpenter disruption 등 EBS 기반 다운타임 시나리오 근거.

| 설명 | 링크 |
|---|---|
| Non-Graceful Node Shutdown GA(1.28·out-of-service taint·StatefulSet+PV 무한 Terminating 해결) | [kubernetes.io/blog/2023/08/16/kubernetes-1-28-non-graceful-node-shutdown-ga](https://kubernetes.io/blog/2023/08/16/kubernetes-1-28-non-graceful-node-shutdown-ga/) |
| Node Shutdowns 개념 | [kubernetes.io/docs/concepts/cluster-administration/node-shutdown](https://kubernetes.io/docs/concepts/cluster-administration/node-shutdown/) |
| aws-ebs-csi-driver FAQ(6분 force-detach·노드 급사 reattach 지연·Multi-Attach error·완화책) | [github.com/kubernetes-sigs/aws-ebs-csi-driver/.../faq.md](https://github.com/kubernetes-sigs/aws-ebs-csi-driver/blob/master/docs/faq.md) |
| rack2cloud — EBS PVC AZ lock-in(topology.ebs.csi.aws.com/zone nodeAffinity·WaitForFirstConsumer·volume node affinity conflict) | [rack2cloud.com/kubernetes-pvc-stuck-volume-node-affinity](https://www.rack2cloud.com/kubernetes-pvc-stuck-volume-node-affinity/) |
| Kubernetes 기본 pod eviction(unreachable/not-ready toleration 300s·node-monitor-grace-period) | [devops-notes.com/kubernetes/eviction.html](https://devops-notes.com/kubernetes/eviction.html) |
| Karpenter — Disruption(voluntary/consolidation·do-not-disrupt·≥v1.0 VolumeAttachment 삭제 대기) | [karpenter.sh/docs/concepts/disruption](https://karpenter.sh/docs/concepts/disruption/) |

## 커뮤니티 · 2차 자료 · 사례

third-party 기술 블로그·실사례·RUM 리플레이 벤더 문서·EBS 실패율 실측. 편향 가능성을 감안해 읽는다.

| 설명 | 링크 |
|---|---|
| OneUptime — S3 cold storage worked example(disk/cache/policy/TTL/모니터링) | [oneuptime.com/.../clickhouse-s3-cold-storage](https://oneuptime.com/blog/post/2026-03-31-clickhouse-s3-cold-storage/view) |
| OneUptime — Storage policies(move_factor 정밀 정의·max_data_part_size·system.storage_policies) | [oneuptime.com/.../clickhouse-storage-policies](https://oneuptime.com/blog/post/2026-03-31-clickhouse-storage-policies/view) |
| OneUptime — S3 disk storage | [oneuptime.com/.../clickhouse-s3-disk-storage](https://oneuptime.com/blog/post/2026-03-31-clickhouse-s3-disk-storage/view) |
| OneUptime — How ClickHouse Replication Protocol Works(복제 log/queue znode·block_numbers) | [oneuptime.com/.../clickhouse-replication-protocol](https://oneuptime.com/blog/post/2026-03-31-clickhouse-replication-protocol/view) |
| OneUptime — Configure quorum inserts(insert_quorum) | [oneuptime.com/.../clickhouse-configure-quorum-inserts](https://oneuptime.com/blog/post/2026-03-31-clickhouse-configure-quorum-inserts/view) |
| OneUptime — Estimate cluster size(5~10x·8x 예시·30% 헤드룸·노드/RAM/CPU 공식) | [oneuptime.com/.../clickhouse-estimate-cluster-size](https://oneuptime.com/blog/post/2026-03-31-clickhouse-estimate-cluster-size/view) |
| OneUptime — ClickStack unified observability(세션/로그/트레이스/메트릭 스키마·기본 TTL 서술) | [oneuptime.com/.../clickstack-unified-observability](https://oneuptime.com/blog/post/2026-02-06-clickstack-unified-observability/view) |
| OneUptime — MongoDB Community Operator on k8s | [oneuptime.com/.../mongodb-how-to-use-the-mongodb-community-operator](https://oneuptime.com/blog/post/2026-03-31-mongodb-how-to-use-the-mongodb-community-operator-on-kubernetes/view) |
| OneUptime — WiredTiger cache size 구성 | [oneuptime.com/.../mongodb-how-to-configure-wiredtiger-cache-size](https://oneuptime.com/blog/post/2026-03-31-mongodb-how-to-configure-wiredtiger-cache-size-in-mongodb/view) |
| PlanetScale — The Real Failure Rate of EBS(실측 degradation 빈도·AZ 상관 장애·io2도 예외 아님) | [planetscale.com/blog/the-real-fail-rate-of-ebs](https://planetscale.com/blog/the-real-fail-rate-of-ebs) |
| langfuse discussion #13013 — EKS S3 tiered storage(object_storage 신문법·move_factor 0.2·325GB/66일) | [github.com/orgs/langfuse/discussions/13013](https://github.com/orgs/langfuse/discussions/13013) |
| Cloudflare — ClickHouse Capacity Estimation Framework(디스크 1순위·shardgroup 단일사본·Prophet 예보) | [blog.cloudflare.com/clickhouse-capacity-estimation-framework](https://blog.cloudflare.com/clickhouse-capacity-estimation-framework/) |
| Character.AI GPU 관측성(15~20x 압축·샘플 후 3~4개월 150TB) | [clickhouse.com/blog/scaling-observabilty-for-thousands-of-gpus-at-character-ai](https://clickhouse.com/blog/scaling-observabilty-for-thousands-of-gpus-at-character-ai) |
| PostHog — session replay ingestion(스냅샷=S3 blob·CH엔 집계만 — HyperDX와 대비) | [posthog.com/docs/how-posthog-works/recordings-ingestion](https://posthog.com/docs/how-posthog-works/recordings-ingestion) |
| rrweb(DOM 이벤트 기록·재구성·영상 아님) | [github.com/rrweb-io/rrweb](https://github.com/rrweb-io/rrweb) |
| rrweb — optimize storage(샘플링·blocking으로 볼륨 절감) | [rrweb.com/docs/recipes/optimize-storage](https://rrweb.com/docs/recipes/optimize-storage) |
| Datadog — 브라우저 세션 리플레이 대역(<100KB/분) | [docs.datadoghq.com/real_user_monitoring/session_replay/browser](https://docs.datadoghq.com/real_user_monitoring/session_replay/browser/) |
| Datadog — 모바일 세션 리플레이 대역(iOS 12KB/s·Android 1.22KB/s) | [docs.datadoghq.com/real_user_monitoring/session_replay/mobile/app_performance](https://docs.datadoghq.com/real_user_monitoring/session_replay/mobile/app_performance/) |
| GlassFlow — OpenTelemetry to ClickHouse: Do You Need Kafka?(Kafka가 푸는 문제·안 필요한 경우·배칭) | [glassflow.dev/blog/opentelemetry-to-clickhouse-do-you-need-kafka](https://www.glassflow.dev/blog/opentelemetry-to-clickhouse-do-you-need-kafka) |
| InfoQ — ClickHouse Keeper: Efficient ZooKeeper Alternative(C++·Raft·NuRaft 배경) | [infoq.com/news/2023/12/clickhouse-keeper-raft](https://www.infoq.com/news/2023/12/clickhouse-keeper-raft/) |
| matduggan — ClickHouse is winning the Observability Wars(10~14x 압축·ES 2~3x 대비) | [matduggan.com/clickhouse-is-winning-the-observability-wars](https://matduggan.com/clickhouse-is-winning-the-observability-wars/) |
| Tasrie — ClickStack setup(docker/helm/k8s) | [tasrieit.com/blog/clickstack-setup-guide-docker-helm-kubernetes-2026](https://tasrieit.com/blog/clickstack-setup-guide-docker-helm-kubernetes-2026) |

## R8·R9 추가 — 블록 온리 튜닝·버전/업그레이드

블록 스토리지 온리([08]({{< relref "08-block-only-tuning.md" >}}))·버전 호환·업그레이드([09]({{< relref "09-version-upgrade-compat.md" >}})) 조사에서 추가된 1차 출처.

### ClickHouse 공식 (설정·업그레이드·백업)

| 설명 | 링크 |
|---|---|
| MergeTree table settings(background/merge 풀·`ttl_only_drop_parts`·`merge_with_ttl_timeout`·`parts_to_throw_insert`) | [clickhouse.com/docs/operations/settings/merge-tree-settings](https://clickhouse.com/docs/operations/settings/merge-tree-settings) |
| Server settings(`background_pool_size`·`background_merges_mutations_concurrency_ratio`) | [clickhouse.com/docs/operations/server-configuration-parameters/settings](https://clickhouse.com/docs/operations/server-configuration-parameters/settings) |
| ClickHouse Upgrades(compatibility·업그레이드 정책·채널) | [clickhouse.com/docs/manage/updates](https://clickhouse.com/docs/manage/updates) |
| `compatibility` 설정(정의·미변경 설정만 영향) | [clickhouse.com/docs/operations/settings/settings#compatibility](https://clickhouse.com/docs/operations/settings/settings#compatibility) |
| 2025 changelog(v25.12 JSON·v25.11 String 직렬화 → 다운그레이드 하한) | [clickhouse.com/docs/whats-new/changelog/2025](https://clickhouse.com/docs/whats-new/changelog/2025) |
| Backup/Restore 공식(`BACKUP ... TO`) | [clickhouse.com/docs/operations/backup/overview](https://clickhouse.com/docs/operations/backup/overview) |
| issue #86837(25.8→25.3 marks 롤백 불가)·#68198·#68408(업그레이드 후 broken parts) | [github.com/ClickHouse/ClickHouse/issues/86837](https://github.com/ClickHouse/ClickHouse/issues/86837) |

### Altinity · operator (스토리지 확장·업그레이드)

| 설명 | 링크 |
|---|---|
| KB — Aggressive merges(`background_pool_size` 36·ratio·`max_bytes_to_merge_at_max_space_in_pool` ~150GB·주의) | [kb.altinity.com/.../altinity-kb-aggressive_merges](https://kb.altinity.com/altinity-kb-setup-and-maintenance/altinity-kb-aggressive_merges/) |
| KB — Using the Kubernetes Operator(`storageManagement` provisioner·`allowVolumeExpansion`) | [kb.altinity.com/altinity-kb-kubernetes](https://kb.altinity.com/altinity-kb-kubernetes/) |
| Blog — What's New in Altinity operator(provisioner Operator=STS 재생성 없이 온라인 확장) | [altinity.com/blog/whats-new-in-altinity-clickhouse-operator](https://altinity.com/blog/whats-new-in-altinity-clickhouse-operator) |
| operator 릴리즈노트(0.27.0 Keeper GA·`async_replication` 기본→Keeper 25.3+) | [docs.altinity.com/releasenotes/...](https://docs.altinity.com/releasenotes/altinity-kubernetes-operator-release-notes/) |
| operator 0.27.1 — Artifact Hub(CH 21.11+·K8s 1.25+) | [artifacthub.io/.../altinity-clickhouse-operator](https://artifacthub.io/packages/helm/altinity-clickhouse-operator/altinity-clickhouse-operator) |
| KB — ClickHouse 버전/업그레이드(스테이징 다운그레이드 리허설·혼합버전 증상) | [kb.altinity.com/upgrade](https://kb.altinity.com/upgrade/) |
| clickhouse-backup(업그레이드 전 백업·restore) | [github.com/Altinity/clickhouse-backup](https://github.com/Altinity/clickhouse-backup) |
| issue #1263·#457 — CHI 재생성/AKS PVC 리사이즈 실패 사례 | [github.com/Altinity/clickhouse-operator/issues/1263](https://github.com/Altinity/clickhouse-operator/issues/1263) |

### AWS EBS (Elastic Volumes·스냅샷 롤백)

| 설명 | 링크 |
|---|---|
| Modify an EBS volume using Elastic Volumes | [docs.aws.amazon.com/ebs/.../ebs-modify-volume.html](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-modify-volume.html) |
| Requirements for EBS volume modifications(OPTIMIZING 상태·수정 제약) | [docs.aws.amazon.com/ebs/.../modify-volume-requirements.html](https://docs.aws.amazon.com/ebs/latest/userguide/modify-volume-requirements.html) |
| EBS Elastic Volumes 6시간 쿨다운 폐지·24h당 4회(2026-01-15) | [dev.classmethod.jp/.../ebs-elastic-volumes-4-modifications](https://dev.classmethod.jp/en/articles/ebs-elastic-volumes-4-modifications/) |
| EBS 스냅샷 생성·복원(`create-volume --snapshot-id --volume-type gp3`) | [docs.aws.amazon.com/ebs/.../ebs-restoring-volume.html](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-restoring-volume.html) |

### ClickStack (배포·업그레이드)

| 설명 | 링크 |
|---|---|
| ClickStack HyperDX-only 배포(외부 CH·`MONGO_URI`) | [clickhouse.com/docs/.../clickstack/deployment/hyperdx-only](https://clickhouse.com/docs/use-cases/observability/clickstack/deployment/hyperdx-only) |

시점 기준 2026-07.
