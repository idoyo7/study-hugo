---
title: "Ops Insights"
type: docs
toc: false
---

# Ops Insights

운영하면서 겪은 분야별 인사이트를 도메인 단위로 정리하는 지식베이스다. 각 도메인은 개요 아래 토픽·문서로 나뉜다.

## 도메인

- **[모니터링]({{< relref "monitoring/_index.md" >}})** — VictoriaMetrics 내부·운영, 메트릭 400일 장기 보관 아키텍처.
- **[로깅]({{< relref "logging/_index.md" >}})** — ES(OpenSearch) 외 로그 내재화(Loki·VictoriaLogs·ClickHouse·HyperDX·StarRocks), RUM 대안, OpenSearch 비용 최적화, 최소 조합 아키텍처.
- **[APM (Datadog)]({{< relref "apm/_index.md" >}})** — Datadog APM 최적화. 작성 예정.
- **[RUM 내재화]({{< relref "rum/_index.md" >}})** — Datadog RUM(RWoL) 탈출: 웹은 HyperDX, 모바일은 대안 미성숙. HyperDX 도입 실사·Datadog RUM 커버리지 매트릭스·dd 프로토콜 프록시 검증·전 제품군 대체 매트릭스·이관 로드맵.
- **[Istio]({{< relref "istio/_index.md" >}})** — 사이드카 모드 운영 실전(메시 기초·istiod 컨트롤플레인·게이트웨이 격리·간헐 5xx 사고·관측성·nginx 이주·EnvoyFilter·xDS 커넥션 재분배), Envoy 자체와 Istio의 조립, CRD 카탈로그, ambient 이행 심사와 외부 도입기, 그리고 1.20→1.30 버전별 변경사항.
- **[ClickHouse 운영]({{< relref "clickhouse/_index.md" >}})** — RUM 내재화·범용 분석으로 ClickHouse를 채택했을 때의 운영 전략(how): managed vs self-host TCO, 로컬 NVMe+S3 스토리지, Altinity operator, 프로덕션 사례.
- **[HyperDX 내재화]({{< relref "hyperdx/_index.md" >}})** — HyperDX ClickStack 실전 자체 배포 청사진(EBS-first, RUM-only 월 0.7TB): 스택 토폴로지·MongoDB 최소 운영, gp3/io2 hot·S3 cold 티어링, operator 다운타임, Keeper, 복제·멀티마스터·failover, 3개월/1년 용량 산정.
- **[HyperDX 직접 운영하기]({{< relref "hyperdx-operating/_index.md" >}})** — 내재화 챕터의 기준 문서들 위에서 "직접 운영하려면 어떤 순서로 무엇을 판단해야 하나"를 6부로 구체화한 운영 트랙: 아키텍처 → 티어링 → 가용성 → operator 패턴 → 규모 산정 → 의사결정 가이드.
- **[EKS 버전 업그레이드]({{< relref "eks-upgrade/_index.md" >}})** — finance 클러스터 EKS 1.31→1.35 blue-green 이관 실전 기록: 왜 blue-green Terraform인가(배경·CAPA 진단), 목표 버전 판정, Fargate+karpenter 클러스터 설정, managed addon, 부트스트랩 오케스트레이션, 컷오버·롤백 계약, 컴포넌트별 마이그레이션.
- **[K8s 버전별 신기능]({{< relref "k8s-features/_index.md" >}})** — 릴리스 노트가 말해주지 않는 "우리 클러스터에서 지금 써도 되는가": 구현 코드·리포팅된 버그·케이스별 득실까지 내려가 판단한다. in-place pod resize(1.35 GA), CPU throttling(limit을 다 쓰지도 않았는데 잘리는 경로), CPU Burst(커널 5.14+, k8s 표면 부재).
- **[Karpenter]({{< relref "karpenter/_index.md" >}})** — 두 축으로 정리한다. **버전 축**: 0.36 이후 v1이 바꾼 것은 API가 아니라 동작(drift 강제 활성화·forceful expiration·ODCR 회귀), 1.7~1.14의 켤 만한 기능(flex 배제 라벨·Static NodePool·Capacity Buffers), NodePool requirements로 affinity를 통제하는 키워드 레퍼런스. **알고리즘 축**: 인스턴스를 최종적으로 고르는 건 EC2라는 사실부터 세대 선호 구성(NodePool 분리+weight), consolidation이 그것을 되돌리는 경로, ICE 폴백까지.
- **[Valkey]({{< relref "valkey/_index.md" >}})** — KubeCon EU 2026에서 15분 간격으로 이어진 두 발표를 맞붙인다. **①** AWS의 2,000노드 Valkey Cluster — 간판 수치 1B RPS는 Kubernetes가 아니라 EC2 실측이고, 엔진 수정 4건만 전이된다. **②** Braze의 Sentinel HA 581샤드 무중단 이관 — cluster mode를 쓰지 않는 클라이언트 해싱 구조를 NLB 경유 양방향 replication으로 Kubernetes에 옮긴 프로덕션 2년치 기록. 엔진 사실은 ①, 운영 사실은 ②에서 가져온다.
- **[커넥션 게이트웨이]({{< relref "gateway/_index.md" >}})** — POS 단말 1만~5만 대에 중앙에서 푸시하는 게이트웨이를 API Gateway WebSocket에서 자체 SSE로 옮길 때, **파드끼리 상태를 나눠 갖는 링이 정말 필요한가**를 판정한다. Loki ingester·vmagent·Alloy·Thanos compactor·Kafka consumer group이 각각 왜 다른 답을 냈는지 해부하고, 그 전제가 우리에게 있는지 대조한다. 결론은 수립 방향 하나로 갈린다 — 클라이언트가 걸면 링은 낭비이고, 파드가 걸면 링 위에 lease까지 필요하다.
