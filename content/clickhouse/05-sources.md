---
title: "출처"
weight: 5
---

# 출처 — ClickHouse 배포·오퍼레이터·운영사례 조사 자료

이 표는 [managed vs self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}}), [로컬 NVMe 스토리지]({{< relref "02-storage-local-nvme.md" >}}), [오퍼레이터]({{< relref "03-operator.md" >}}), [프로덕션 운영사례]({{< relref "04-production-usecases.md" >}}) 네 페이지가 인용한 1차 조사 문서(배포 전략·스토리지 아키텍처, clickhouse-operator 채택, 프로덕션 운영 사례 전수조사, managed vs self-host TCO 보강)의 `## 출처` 섹션을 모아 중복 제거하고 주제별로 분류했다. 조사 기준일은 **2026-07-13**(각 조사 문서 frontmatter `updated` 값)이다.

개별 URL의 등급(확인됨/추정/미확인)은 원 조사 문서 본문의 인라인 태그를 따른다 — 이 표 자체는 출처 목록이며 등급을 재판정하지 않는다.

## AWS 공식 스펙

인스턴스 스토어 IOPS·EBS 볼륨 스펙·요금 등 AWS 1차 문서.

| 설명 | 링크 |
|---|---|
| EC2 i7i instances 제품 페이지 | [aws.amazon.com/ec2/instance-types/i7i](https://aws.amazon.com/ec2/instance-types/i7i/) |
| i7i 출시 What's New(2025-04-28) | [aws.amazon.com/.../i7i-high-performance-storage-optimized-instances](https://aws.amazon.com/about-aws/whats-new/2025/04/amazon-ec2-i7i-high-performance-storage-optimized-instances/) |
| i7ie now available(blog) | [aws.amazon.com/blogs/aws/.../i7ie-instances](https://aws.amazon.com/blogs/aws/now-available-storage-optimized-amazon-ec2-i7ie-instances/) |
| i7ie 추가 리전 발표 | [aws.amazon.com/.../i7ie-additional-aws-regions](https://aws.amazon.com/about-aws/whats-new/2025/06/amazon-ec2-i7ie-instances-additional-aws-regions/) |
| EC2 i8g instances 제품 페이지 | [aws.amazon.com/ec2/instance-types/i8g](https://aws.amazon.com/ec2/instance-types/i8g/) |
| i8g 소개(blog, Graviton4·3세대 Nitro SSD) | [aws.amazon.com/blogs/aws/.../i8g-instances](https://aws.amazon.com/blogs/aws/introducing-storage-optimized-amazon-ec2-i8g-instances-powered-by-aws-graviton4-processors-and-3rd-gen-aws-nitro-ssds/) |
| i4g/im4gn/is4gen instances | [aws.amazon.com/ec2/instance-types/i4g](https://aws.amazon.com/ec2/instance-types/i4g/) |
| i3en instances | [aws.amazon.com/ec2/instance-types/i3en](https://aws.amazon.com/ec2/instance-types/i3en/) |
| Storage optimized 인스턴스 목록 | [aws.amazon.com/ec2/instance-types/storage-optimized](https://aws.amazon.com/ec2/instance-types/storage-optimized/) |
| EBS volume types | [aws.amazon.com/ebs/volume-types](https://aws.amazon.com/ebs/volume-types/) |
| EBS General Purpose(gp3) 공식 문서·단가 | [docs.aws.amazon.com/ebs/.../general-purpose.html](https://docs.aws.amazon.com/ebs/latest/userguide/general-purpose.html) |
| io2 Block Express DB 성능(blog) | [aws.amazon.com/blogs/storage/.../io2-block-express-volumes](https://aws.amazon.com/blogs/storage/achieve-higher-database-performance-using-amazon-ebs-io2-block-express-volumes/) |
| Storage optimized 인스턴스 스펙 표(instance store IOPS 원출처) | [docs.aws.amazon.com/ec2/latest/instancetypes/so.html](https://docs.aws.amazon.com/ec2/latest/instancetypes/so.html) |
| 3세대 AWS Nitro SSD deep dive(re:Invent 2024 CMP334) | [reinvent.awsevents.com/.../CMP334](https://reinvent.awsevents.com/content/dam/reinvent/2024/slides/cmp/CMP334_Deep-dive-into-third-generation-AWS-Nitro-SSDs-.pdf) |
| Savings Plans(Compute/EC2 Instance) 단가 | [aws.amazon.com/savingsplans/compute-pricing](https://aws.amazon.com/savingsplans/compute-pricing/) |
| EC2 Reserved Instance pricing | [aws.amazon.com/ec2/pricing/reserved-instances/pricing](https://aws.amazon.com/ec2/pricing/reserved-instances/pricing/) |

## ClickHouse 공식

ClickHouse Inc.의 아키텍처·가격·운영 문서와 공식 블로그(다른 회사 사례가 아닌 제품/설계 설명 한정).

| 설명 | 링크 |
|---|---|
| No more disks: stateless compute | [clickhouse.com/blog/clickhouse-cloud-stateless-compute](https://clickhouse.com/blog/clickhouse-cloud-stateless-compute) |
| SharedMergeTree & Lightweight Updates | [clickhouse.com/blog/.../sharedmergetree-and-lightweight-updates](https://clickhouse.com/blog/clickhouse-cloud-boosts-performance-with-sharedmergetree-and-lightweight-updates) |
| docs — SharedMergeTree | [github.com/ClickHouse/clickhouse-docs/.../shared-merge-tree.md](https://github.com/ClickHouse/clickhouse-docs/blob/main/docs/cloud/features/05_infrastructure/shared-merge-tree.md) |
| Warehouses(compute-compute 분리) | [clickhouse.com/blog/introducing-warehouses-compute-compute-separation](https://clickhouse.com/blog/introducing-warehouses-compute-compute-separation-in-clickhouse-cloud) |
| docs — Separation of storage and compute | [clickhouse.com/docs/guides/separation-storage-compute](https://clickhouse.com/docs/guides/separation-storage-compute) |
| ClickHouse Pricing | [clickhouse.com/pricing](https://clickhouse.com/pricing) |
| Cloud Billing overview(worked example·egress·백업 과금) | [clickhouse.com/docs/cloud/manage/billing/overview](https://clickhouse.com/docs/cloud/manage/billing/overview) |
| BYOC on AWS GA(2025-02-20) | [clickhouse.com/blog/.../bring-your-own-cloud-on-aws](https://clickhouse.com/blog/announcing-general-availability-of-clickhouse-bring-your-own-cloud-on-aws) |
| docs — BYOC overview | [clickhouse.com/docs/cloud/reference/byoc](https://clickhouse.com/docs/cloud/reference/byoc) |
| ClickStack HyperDX-only deployment | [clickhouse.com/docs/.../deployment/hyperdx-only](https://clickhouse.com/docs/use-cases/observability/clickstack/deployment/hyperdx-only) |
| Building a Distributed Cache for S3 | [clickhouse.com/blog/building-a-distributed-cache-for-s3](https://clickhouse.com/blog/building-a-distributed-cache-for-s3) |
| docs — External disks / storing data | [clickhouse.com/docs/operations/storing-data](https://clickhouse.com/docs/operations/storing-data) |
| docs — Sizing & hardware recommendations | [clickhouse.com/docs/guides/sizing-and-hardware-recommendations](https://clickhouse.com/docs/guides/sizing-and-hardware-recommendations) |
| docs — Replication + scaling(cluster deployment) | [clickhouse.com/docs/architecture/cluster-deployment](https://clickhouse.com/docs/architecture/cluster-deployment) |
| docs — Replicated table engines | [clickhouse.com/docs/engines/table-engines/mergetree-family/replication](https://clickhouse.com/docs/engines/table-engines/mergetree-family/replication) |
| GitHub issue — zero-copy 데이터손상 #45346 | [github.com/ClickHouse/ClickHouse/issues/45346](https://github.com/ClickHouse/ClickHouse/issues/45346) |
| GitHub issue — zero-copy mutation 손실 #39560 | [github.com/ClickHouse/ClickHouse/issues/39560](https://github.com/ClickHouse/ClickHouse/issues/39560) |
| GitHub issue — s3 zero-copy cross-region #35684 | [github.com/ClickHouse/ClickHouse/issues/35684](https://github.com/ClickHouse/ClickHouse/issues/35684) |
| GitHub issue — zero-copy TTL NOT_ENOUGH_SPACE #85203 | [github.com/clickhouse/clickhouse/issues/85203](https://github.com/clickhouse/clickhouse/issues/85203) |
| GitHub issue — local-primary + object mirror 제안 #107269 | [github.com/clickhouse/clickhouse/issues/107269](https://github.com/clickhouse/clickhouse/issues/107269) |
| 하드웨어 벤치마크(benchmark.clickhouse.com) | [benchmark.clickhouse.com/hardware](https://benchmark.clickhouse.com/hardware/) |
| ClickStack Helm 배포 공식 문서 | [clickhouse.com/docs/.../clickstack/deployment/helm](https://clickhouse.com/docs/use-cases/observability/clickstack/deployment/helm) |
| ClickStack-helm-charts README | [github.com/ClickHouse/ClickStack-helm-charts](https://github.com/ClickHouse/ClickStack-helm-charts/blob/main/README.md) |
| hyperdxio/helm-charts(GitHub) | [github.com/hyperdxio/helm-charts](https://github.com/hyperdxio/helm-charts) |
| hyperdxio/hyperdx(GitHub) | [github.com/hyperdxio/hyperdx](https://github.com/hyperdxio/hyperdx) |
| docs — ClickHouse Keeper | [clickhouse.com/docs/guides/sre/keeper/clickhouse-keeper](https://clickhouse.com/docs/guides/sre/keeper/clickhouse-keeper) |
| docs — Observability 소개 | [clickhouse.com/docs/use-cases/observability/introduction](https://clickhouse.com/docs/use-cases/observability/introduction) |
| Observability: a year in review | [clickhouse.com/blog/observability-a-year-in-review](https://clickhouse.com/blog/observability-a-year-in-review) |
| Observability cost optimization playbook | [clickhouse.com/resources/.../cost-optimization-playbook](https://clickhouse.com/resources/engineering/observability-cost-optimization-playbook) |
| 13 mistakes(common getting started issues) | [clickhouse.com/blog/common-getting-started-issues-with-clickhouse](https://clickhouse.com/blog/common-getting-started-issues-with-clickhouse) |
| docs — Too many parts | [clickhouse.com/docs/tips-and-tricks/too-many-parts](https://clickhouse.com/docs/tips-and-tricks/too-many-parts) |
| ClickStack OSS 소개 | [clickhouse.com/blog/clickstack-a-high-performance-oss-observability-stack](https://clickhouse.com/blog/clickstack-a-high-performance-oss-observability-stack-on-clickhouse) |
| ClickStack half-year review | [clickhouse.com/blog/clickstack-a-year-in-review-2025](https://clickhouse.com/blog/clickstack-a-year-in-review-2025) |
| Announcing ClickStack in ClickHouse Cloud(Private Preview, 2025-08-06) | [clickhouse.com/blog/announcing-clickstack-in-clickhouse-cloud](https://clickhouse.com/blog/announcing-clickstack-in-clickhouse-cloud) |
| Introducing Managed ClickStack(beta, 2026-02-04) | [clickhouse.com/blog/introducing-managed-clickstack-beta](https://clickhouse.com/blog/introducing-managed-clickstack-beta) |
| Observability TCO & cost reduction | [clickhouse.com/resources/engineering/observability-tco-cost-reduction](https://clickhouse.com/resources/engineering/observability-tco-cost-reduction) |
| Datadog alternatives | [clickhouse.com/resources/engineering/datadog-alternatives](https://clickhouse.com/resources/engineering/datadog-alternatives) |
| ClickHouse adopters | [clickhouse.com/docs/about-us/adopters](https://clickhouse.com/docs/about-us/adopters) |
| How cloud data warehouses bill you | [clickhouse.com/blog/how-cloud-data-warehouses-bill-you](https://clickhouse.com/blog/how-cloud-data-warehouses-bill-you) |

## Altinity·operator

Altinity 자체 문서/저장소, ClickHouse Inc. 공식 operator, 대안 operator(KubeBlocks·KubeDB), Bitnami 정책 변경 관련 자료.

| 설명 | 링크 |
|---|---|
| Altinity Cloud Anywhere(open cloud) | [altinity.com/blog/altinity-cloud-anywhere-an-open-cloud](https://altinity.com/blog/altinity-cloud-anywhere-an-open-cloud-for-clickhouse) |
| Altinity Managed ClickHouse BYOC | [altinity.com/managed-clickhouse/bring-your-own-cloud](https://altinity.com/managed-clickhouse/bring-your-own-cloud/) |
| Altinity/clickhouse-operator(GitHub, 0.27.1) | [github.com/Altinity/clickhouse-operator](https://github.com/Altinity/clickhouse-operator) |
| issue #1859(node-local storage) | [github.com/Altinity/clickhouse-operator/issues/1859](https://github.com/Altinity/clickhouse-operator/issues/1859) |
| issue #1456(외부 config crashloop) | [github.com/Altinity/clickhouse-operator/issues/1456](https://github.com/Altinity/clickhouse-operator/issues/1456) |
| issue #1500(scale-to-0 STS 삭제 시 미재생성) | [github.com/Altinity/clickhouse-operator/issues/1500](https://github.com/Altinity/clickhouse-operator/issues/1500) |
| issue #1602(신규 replica 스키마 auto-creation 미동작) | [github.com/Altinity/clickhouse-operator/issues/1602](https://github.com/Altinity/clickhouse-operator/issues/1602) |
| Altinity KB — AWS EC2 Storage | [kb.altinity.com/.../aws-ec2-storage](https://kb.altinity.com/altinity-kb-setup-and-maintenance/aws-ec2-storage/) |
| Altinity — MergeTree on S3 아키텍처 | [altinity.com/blog/clickhouse-mergetree-on-s3-intro-and-architecture](https://altinity.com/blog/clickhouse-mergetree-on-s3-intro-and-architecture) |
| Altinity — DR tips & tricks | [altinity.com/webinarspage/.../disaster-recovery](https://altinity.com/webinarspage/clickhouse-disaster-recovery-tips-and-tricks-to-avoid-trouble-in-paradise) |
| Altinity/clickhouse-backup(GitHub) | [github.com/Altinity/clickhouse-backup](https://github.com/Altinity/clickhouse-backup) |
| Altinity operator 릴리즈노트(2025~2026) | [docs.altinity.com/releasenotes/altinity-kubernetes-operator-release-notes](https://docs.altinity.com/releasenotes/altinity-kubernetes-operator-release-notes/) |
| Altinity operator 제품 페이지 | [altinity.com/kubernetes-operator](https://altinity.com/kubernetes-operator/) |
| Artifact Hub — altinity-clickhouse-operator 0.27.1 | [artifacthub.io/.../altinity-clickhouse-operator](https://artifacthub.io/packages/helm/altinity-clickhouse-operator/altinity-clickhouse-operator) |
| DeepWiki — Altinity operator 개요/CHI | [deepwiki.com/Altinity/clickhouse-operator](https://deepwiki.com/Altinity/clickhouse-operator) |
| DeepWiki — ClickHouseKeeperInstallation(CHK) | [deepwiki.com/.../2.4-clickhousekeeperinstallation-(chk)](https://deepwiki.com/Altinity/clickhouse-operator/2.4-clickhousekeeperinstallation-(chk)) |
| Altinity CHI max 예제 YAML(spec 필드) | [raw.githubusercontent.com/.../99-clickhouseinstallation-max.yaml](https://raw.githubusercontent.com/Altinity/clickhouse-operator/master/docs/chi-examples/99-clickhouseinstallation-max.yaml) |
| Altinity storage.md(PVC/provisioner/reclaimPolicy) | [github.com/Altinity/clickhouse-operator/.../storage.md](https://github.com/Altinity/clickhouse-operator/blob/master/docs/storage.md) |
| Altinity KB — Kubernetes operator 사용 | [kb.altinity.com/altinity-kb-kubernetes](https://kb.altinity.com/altinity-kb-kubernetes/) |
| Altinity ArgoCD 블로그 | [altinity.com/blog/bring-up-clickhouse-on-kubernetes-with-argo-cd](https://altinity.com/blog/bring-up-clickhouse-on-kubernetes-with-argo-cd) |
| Altinity argocd-examples-clickhouse(GitHub) | [github.com/Altinity/argocd-examples-clickhouse](https://github.com/Altinity/argocd-examples-clickhouse) |
| Altinity ClickHouse 마이그레이션 가이드 | [altinity.com/clickhouse-support/clickhouse-migration](https://altinity.com/clickhouse-support/clickhouse-migration/) |
| Altinity — reclaimPolicy(스토리지 삭제 방지) | [altinity.com/blog/preventing-clickhouse-storage-deletion-with-the-altinity-kubernetes-operator-reclaimpolicy](https://altinity.com/blog/preventing-clickhouse-storage-deletion-with-the-altinity-kubernetes-operator-reclaimpolicy) |
| ClickHouse 공식 Kubernetes Operator 소개 블로그(2026-01-29) | [clickhouse.com/blog/clickhouse-kubernetes-operator](https://clickhouse.com/blog/clickhouse-kubernetes-operator) |
| ClickHouse 공식 operator(GitHub, v1alpha1) | [github.com/clickhouse/clickhouse-operator](https://github.com/clickhouse/clickhouse-operator) |
| KubeBlocks x ClickHouse | [kubeblocks.io/blog/kubeblocks-for-clickhouse](https://kubeblocks.io/blog/kubeblocks-for-clickhouse) |
| KubeDB — Run and Manage ClickHouse | [kubedb.com/.../run-and-manage-clickhouse-on-kubernetes](https://kubedb.com/kubernetes/databases/run-and-manage-clickhouse-on-kubernetes/) |
| Bitnami clickhouse-operator 차트(0.2.33, 폐기 경로) | [artifacthub.io/packages/helm/bitnami/clickhouse-operator](https://artifacthub.io/packages/helm/bitnami/clickhouse-operator) |
| Bitnami Deprecation Notice(chkk.io) | [chkk.io/blog/bitnami-deprecation](https://www.chkk.io/blog/bitnami-deprecation) |
| Bitnami 카탈로그 재편(lavx.hu) | [news.lavx.hu/.../bitnami-restructures-container-catalog](https://news.lavx.hu/article/bitnami-restructures-container-catalog-legacy-archive-and-secure-images-herald-new-devops-reality) |
| Chainguard — Bitnami Helm 차트 마이그레이션 가이드 | [chainguard.dev/.../migrating-helm-charts-from-bitnami](https://www.chainguard.dev/supply-chain-security-101/a-practical-guide-to-migrating-helm-charts-from-bitnami) |
| SigNoz charts #731(Bitnami 의존 마이그레이션) | [github.com/SigNoz/charts/issues/731](https://github.com/SigNoz/charts/issues/731) |
| SigNoz charts #782(Altinity operator subchart 제안) | [github.com/SigNoz/charts/issues/782](https://github.com/SigNoz/charts/issues/782) |
| langfuse-k8s #206(Bitnami 차트/이미지 변경) | [github.com/langfuse/langfuse-k8s/issues/206](https://github.com/langfuse/langfuse-k8s/issues/206) |

## 운영 사례 블로그·발표

각 회사의 공식 엔지니어링 블로그/발표. 이 중 다수(Zomato·Netflix·Didi·Trip.com·GitLab·Tesla·Character.AI·Anthropic·Clarity·LogHouse)는 `clickhouse.com/blog`에 ClickHouse Inc.가 게재한 고객 케이스스터디로, 자사 제품 홍보 맥락의 편향 가능성을 감안해 읽어야 한다.

| 설명 | 링크 |
|---|---|
| Cloudflare(ClickHouse blog, 2026-02-18) | [clickhouse.com/blog/cloudflare](https://clickhouse.com/blog/cloudflare) |
| Cloudflare — capacity estimation framework | [blog.cloudflare.com/clickhouse-capacity-estimation-framework](https://blog.cloudflare.com/clickhouse-capacity-estimation-framework/) |
| Cloudflare — 6M requests/sec analytics | [blog.cloudflare.com/http-analytics-for-6m-requests-per-second](https://blog.cloudflare.com/http-analytics-for-6m-requests-per-second-using-clickhouse/) |
| Cloudflare — log analytics using ClickHouse | [blog.cloudflare.com/log-analytics-using-clickhouse](https://blog.cloudflare.com/log-analytics-using-clickhouse/) |
| Cloudflare — query plan contention(2026) | [blog.cloudflare.com/clickhouse-query-plan-contention](https://blog.cloudflare.com/clickhouse-query-plan-contention/) |
| InfoQ — Cloudflare ClickHouse bottleneck(2026-06) | [infoq.com/news/2026/06/cloudflare-clickhouse-bottleneck](https://www.infoq.com/news/2026/06/cloudflare-clickhouse-bottleneck/) |
| Uber Engineering — logging platform(2021-02) | [uber.com/en-IN/blog/logging](https://www.uber.com/en-IN/blog/logging/) |
| StarTree — Evolution of OLAP at Uber | [startree.ai/.../evolution-of-olap-at-uber](https://startree.ai/resources/the-evolution-of-olap-at-uber-a-journey-toward-consolidation/) |
| eBay Tech — OLAP Journey with ClickHouse on Kubernetes | [innovation.ebayinc.com/stories/ou-online-analytical-processing](https://innovation.ebayinc.com/stories/ou-online-analytical-processing/) |
| Sentry blog — Introducing Snuba | [blog.sentry.io/introducing-snuba-sentrys-new-search-infrastructure](https://blog.sentry.io/introducing-snuba-sentrys-new-search-infrastructure/) |
| Snuba architecture 문서 | [getsentry.github.io/snuba/architecture/overview.html](https://getsentry.github.io/snuba/architecture/overview.html) |
| Sentry — 62x faster 비정형 쿼리 | [blog.sentry.io/.../62x-faster](https://blog.sentry.io/how-sentry-queries-unstructured-data-in-clickhouse-62x-faster/) |
| Zomato — cost-effective logging platform(2023-07) | [zomato.com/blog/.../petabyte-scale](https://www.zomato.com/blog/building-a-cost-effective-logging-platform-using-clickhouse-for-petabyte-scale/) |
| Zomato 소개 영상(ClickHouse) | [clickhouse.com/videos/zomatos-logging-platform-journey](https://clickhouse.com/videos/zomatos-logging-platform-journey) |
| PostHog docs — how PostHog works(ClickHouse) | [posthog.com/docs/how-posthog-works/clickhouse](https://posthog.com/docs/how-posthog-works/clickhouse) |
| PostHog handbook — data ingestion | [posthog.com/handbook/engineering/clickhouse/data-ingestion](https://posthog.com/handbook/engineering/clickhouse/data-ingestion) |
| PostHog handbook — ClickHouse clusters(로컬 NVMe 실측) | [posthog.com/handbook/engineering/clickhouse/clusters](https://posthog.com/handbook/engineering/clickhouse/clusters) |
| Microsoft Clarity — Why we chose ClickHouse | [clarity.microsoft.com/blog/why-microsoft-clarity-chose-clickhouse](https://clarity.microsoft.com/blog/why-microsoft-clarity-chose-clickhouse/) |
| ClickHouse blog — Clarity petabyte-scale behavior analytics | [clickhouse.com/blog/petabyte-scale-website-behavior-analytics](https://clickhouse.com/blog/petabyte-scale-website-behavior-analytics-using-clickhouse) |
| ClickHouse blog — Anthropic(2025-07) | [clickhouse.com/blog/how-anthropic-is-using-clickhouse](https://clickhouse.com/blog/how-anthropic-is-using-clickhouse-to-scale-observability-for-ai-era) |
| ClickHouse blog — Netflix petabyte-scale logging | [clickhouse.com/blog/netflix-petabyte-scale-logging](https://clickhouse.com/blog/netflix-petabyte-scale-logging) |
| ClickHouse 영상 — Netflix observability | [clickhouse.com/videos/netflix-observability](https://clickhouse.com/videos/netflix-observability) |
| ClickHouse blog — Didi ES→ClickHouse 마이그레이션 | [clickhouse.com/blog/didi-migrates-from-elasticsearch](https://clickhouse.com/blog/didi-migrates-from-elasticsearch-to-clickHouse-for-a-new-generation-log-storage-system) |
| ClickHouse blog — Trip.com 50PB logging | [clickhouse.com/blog/how-trip.com-migrated-from-elasticsearch](https://clickhouse.com/blog/how-trip.com-migrated-from-elasticsearch-and-built-a-50pb-logging-solution-with-clickhouse) |
| ClickHouse blog — GitLab sub-second analytics | [clickhouse.com/blog/how-gitlab-uses-clickhouse](https://clickhouse.com/blog/how-gitlab-uses-clickhouse-to-scale-analytical-workloads) |
| GitLab docs — ClickHouse 연동 | [docs.gitlab.com/integration/clickhouse](https://docs.gitlab.com/integration/clickhouse/) |
| GitLab handbook — Observability metrics 설계문서 | [handbook.gitlab.com/.../observability_metrics](https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/observability_metrics/) |
| ClickHouse blog — Tesla(Comet) quadrillion-scale | [clickhouse.com/blog/how-tesla-built-quadrillion-scale-observability-platform](https://clickhouse.com/blog/how-tesla-built-quadrillion-scale-observability-platform-on-clickhouse) |
| ClickHouse blog — Character.AI GPU observability | [clickhouse.com/blog/scaling-observabilty-for-thousands-of-gpus-at-character-ai](https://clickhouse.com/blog/scaling-observabilty-for-thousands-of-gpus-at-character-ai) |
| ClickHouse blog — LogHouse 100PB wide events(2025-06) | [clickhouse.com/blog/scaling-observability-beyond-100pb-wide-events-replacing-otel](https://clickhouse.com/blog/scaling-observability-beyond-100pb-wide-events-replacing-otel) |
| TipRanks — Shopee 대규모 배포 보도 | [tipranks.com/.../high-scale-shopee-deployment](https://www.tipranks.com/news/private-companies/high-scale-shopee-deployment-underscores-clickhouse-role-in-observability-infrastructure) |
| mrkrbrts — separated storage/compute 비용 효율 아키텍처 | [mrkrbrts.com/blog/.../separated-storage-and-compute](https://mrkrbrts.com/blog/how-to-run-a-cost-efficient-clickhouse-cluster-with-separated-storage-and-compute) |
| Severalnines — storage architecture and optimization | [severalnines.com/blog/clickhouse-storage-architecture-and-optimization](https://severalnines.com/blog/clickhouse-storage-architecture-and-optimization/) |
| Langfuse — self-hosting ClickHouse 인프라 가이드 | [langfuse.com/self-hosting/deployment/infrastructure/clickhouse](https://langfuse.com/self-hosting/deployment/infrastructure/clickhouse) |
| anthonynsimon — 1-node 프로덕션 배포 후기 | [anthonynsimon.com/blog/clickhouse-deployment](https://anthonynsimon.com/blog/clickhouse-deployment/) |

## 커뮤니티

third-party 기술 블로그, 벤치마크/가격 계산기, 리뷰 사이트, GitHub 이슈, Hacker News 토론.

| 설명 | 링크 |
|---|---|
| Quesma — ClickHouse Cloud 2025-01 가격 개편 | [quesma.com/blog/clickhouse-pricing](https://quesma.com/blog/clickhouse-pricing/) |
| Beton — ClickHouse pricing teardown | [getbeton.ai/blog/clickhouse-pricing-teardown](https://www.getbeton.ai/blog/clickhouse-pricing-teardown/) |
| Pulse — ClickHouse Cloud pricing guide | [pulse.support/kb/clickhouse-cloud-pricing-guide](https://pulse.support/kb/clickhouse-cloud-pricing-guide) |
| Pulse — ClickHouse Kubernetes Operator 프로덕션 pitfalls | [pulse.support/kb/clickhouse-kubernetes-operator](https://pulse.support/kb/clickhouse-kubernetes-operator) |
| Pulse — ClickHouse benchmark(코어당 스캔 GB/s) | [pulse.support/kb/clickhouse-benchmark](https://pulse.support/kb/clickhouse-benchmark) |
| OneUptime — SharedMergeTree engine 해설 | [oneuptime.com/.../clickhouse-shared-merge-tree](https://oneuptime.com/blog/post/2026-03-31-clickhouse-shared-merge-tree/view) |
| OneUptime — recover failed replica | [oneuptime.com/.../clickhouse-recover-failed-replica](https://oneuptime.com/blog/post/2026-03-31-clickhouse-recover-failed-replica/view) |
| OneUptime — ClickHouse Keeper as ZooKeeper replacement | [oneuptime.com/.../keeper-zookeeper-replacement](https://oneuptime.com/blog/post/2026-02-09-clickhouse-keeper-zookeeper-replacement/view) |
| OneUptime — Altinity ClickHouse Operator 사용법 | [oneuptime.com/.../clickhouse-operator-altinity-on-kubernetes](https://oneuptime.com/blog/post/2026-03-31-clickhouse-operator-altinity-on-kubernetes/view) |
| OneUptime — storage type 벤치마크(fio 순차 대역) | [oneuptime.com/.../clickhouse-benchmark-storage-types](https://oneuptime.com/blog/post/2026-03-31-clickhouse-benchmark-storage-types/view) |
| Vantage — EBS vs NVMe 가격·성능 | [vantage.sh/blog/ebs-vs-nvme-pricing-performance](https://www.vantage.sh/blog/ebs-vs-nvme-pricing-performance) |
| Vantage — i7i.8xlarge 요금·스펙 | [instances.vantage.sh/aws/ec2/i7i.8xlarge](https://instances.vantage.sh/aws/ec2/i7i.8xlarge) |
| Vantage — i8g.8xlarge 요금·스펙 | [instances.vantage.sh/aws/ec2/i8g.8xlarge](https://instances.vantage.sh/aws/ec2/i8g.8xlarge) |
| TowardsDev — ClickHouse tiered storage | [towardsdev.com/clickhouse-tiered-storage-...](https://towardsdev.com/clickhouse-tiered-storage-volumes-storage-policies-and-ttl-from-scratch-to-production-8758d8f3f066) |
| QueryPlane — backup & restore in practice | [queryplane.com/blog/clickhouse-backup-and-restore-in-practice](https://queryplane.com/blog/clickhouse-backup-and-restore-in-practice/) |
| OpenEBS lvm-localpv(GitHub) | [github.com/openebs/lvm-localpv](https://github.com/openebs/lvm-localpv) |
| InfoQ — OpenEBS stateful workloads | [infoq.com/articles/openebs-stateful-workloads](https://www.infoq.com/articles/openebs-stateful-workloads/) |
| Karpenter — instanceStorePolicy 문서 이슈 #7543 | [github.com/aws/karpenter-provider-aws/issues/7543](https://github.com/aws/karpenter-provider-aws/issues/7543) |
| Karpenter — Bottlerocket RAID0 #8562 | [github.com/aws/karpenter-provider-aws/issues/8562](https://github.com/aws/karpenter-provider-aws/issues/8562) |
| Karpenter docs — Disruption | [karpenter.sh/docs/concepts/disruption](https://karpenter.sh/docs/concepts/disruption/) |
| Cast AI — Karpenter best practices | [cast.ai/blog/karpenter-best-practices-10-tips](https://cast.ai/blog/karpenter-best-practices-10-tips-for-production-clusters/) |
| Improvado — ClickHouse pricing 2026 TCO | [improvado.io/blog/clickhouse-warehousing-pricing](https://improvado.io/blog/clickhouse-warehousing-pricing) |
| Tinybird — self-hosted ClickHouse cost 2026 | [tinybird.co/blog/self-hosted-clickhouse-cost](https://www.tinybird.co/blog/self-hosted-clickhouse-cost) |
| Tinybird — managed ClickHouse options 2026 | [tinybird.co/blog/managed-clickhouse-options](https://www.tinybird.co/blog/managed-clickhouse-options) |
| StorageReview — i8g/i7ie 확장 보도 | [storagereview.com/news/.../i8g-and-i7ie-types](https://www.storagereview.com/news/aws-expands-storage-optimized-ec2-instances-with-the-introduction-of-i8g-and-i7ie-types) |
| ScyllaDB docs — cloud instance recommendations | [docs.scylladb.com/.../cloud-instance-recommendations](https://docs.scylladb.com/manual/stable/getting-started/cloud-instance-recommendations.html) |
| Aiven for ClickHouse | [aiven.io/clickhouse](https://aiven.io/clickhouse) |
| Aiven for ClickHouse GA 발표 | [aiven.io/blog/aiven-for-clickhouse-now-generally-available](https://aiven.io/blog/aiven-for-clickhouse-now-generally-available) |
| Aiven — optimized plans 발표 | [aiven.io/blog/your-clickhouse-optimized-experience](https://aiven.io/blog/your-clickhouse-optimized-experience-more-flexible-price-performant-plans) |
| economize — i7i 전 사이즈 요금표 | [economize.cloud/.../i7i.12xlarge](https://www.economize.cloud/resources/aws/pricing/ec2/i7i.12xlarge/) |
| economize — i7i.xlarge 요금 | [economize.cloud/.../i7i.xlarge](https://www.economize.cloud/resources/aws/pricing/ec2/i7i.xlarge/) |
| DevZero — i8g.4xlarge 요금 | [devzero.io/instances/aws/i8g.4xlarge](https://www.devzero.io/instances/aws/i8g.4xlarge) |
| quantrail — Why ClickHouse needs an operator | [quantrail-data.com/why-clickhouse-needs-operator-kubernetes](https://quantrail-data.com/why-clickhouse-needs-operator-kubernetes/) |
| CIO Bulletin — Altinity 프로필 | [ciobulletin.com/magazine/profile/altinity](https://ciobulletin.com/magazine/profile/altinity-clickhouse-based-analytics-applications) |
| CubeAPM — What is ClickStack | [cubeapm.com/faqs/what-is-clickstack](https://cubeapm.com/faqs/what-is-clickstack/) |
| CubeAPM — HyperDX pricing review | [cubeapm.com/blog/hyperdx-pricing-review](https://cubeapm.com/blog/hyperdx-pricing-review/) |
| chistadata — ClickHouse/ClickStack/HyperDX 정리 | [chistadata.com/15-clickhouse-clickstack-hyperdx](https://chistadata.com/15-clickhouse-clickstack-hyperdx/) |
| BigDataBoutique — Too Many Parts | [bigdataboutique.com/blog/clickhouse-too-many-parts](https://bigdataboutique.com/blog/clickhouse-too-many-parts) |
| Lobsters — ClickHouse is winning the Observability Wars | [lobste.rs/s/asi79o/clickhouse_is_winning_observability](https://lobste.rs/s/asi79o/clickhouse_is_winning_observability) |
| charity.wtf — ClickHouse is winning(Charity Majors) | [charity.wtf/p/have-you-heard-clickhouse-is-winning](https://charity.wtf/p/have-you-heard-clickhouse-is-winning) |
| HN — Zomato 로깅 플랫폼 토론 | [news.ycombinator.com/item?id=36861429](https://news.ycombinator.com/item?id=36861429) |
| HN — Show HN: ClickStack | [news.ycombinator.com/item?id=44194082](https://news.ycombinator.com/item?id=44194082) |
| HN — "HyperDX 프로덕션 사용 후기" | [news.ycombinator.com/item?id=44194775](https://news.ycombinator.com/item?id=44194775) |
| HN — HyperDX vs ClickStack 혼란 | [news.ycombinator.com/item?id=44196718](https://news.ycombinator.com/item?id=44196718) |
| HN — HyperDX/SigNoz ClickHouse 커플링 논의 | [news.ycombinator.com/item?id=45294103](https://news.ycombinator.com/item?id=45294103) |
