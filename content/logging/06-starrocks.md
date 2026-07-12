---
title: "StarRocks"
weight: 6
---

# StarRocks — S3 위 stateless 컴퓨트, 그러나 로그엔 이르다

Linux Foundation MPP OLAP 엔진(Apache-2.0). Doris 포크를 vectorized exec + CBO로 재설계했고, 상용 백커는 CelerData. **"EKS에서 pod/node가 ephemeral해도 클러스터링되는 NoSQL/OLAP"**라는 요구에 가장 정직하게 답하는 후보라 검토했다.

- **진짜 강점 — shared-data 모드**: FE(메타) + **CN(Compute Node, stateless)** 구조로, 1차 데이터가 **S3에** 있고 CN은 로컬 hot 캐시만 쓴다. **CN을 초 단위로 add/remove, 리밸런스 없음** — ClickHouse의 실험적/폐기된 zero-copy-S3와 달리 **first-class GA 설계**(v3.1 GA, 3.3~4.1 성숙). 1st-party K8s Operator + Helm, AWS 레퍼런스(EKS + KEDA + Karpenter)까지 있다. **이게 self-host에서 CH가 못 하는 유일하고 결정적인 차별점.**
- **중요한 단서**: "완전 ephemeral"은 과장이다. **FE 메타데이터 쿼럼은 여전히 stateful**(BDBJE 기반, 홀수 3/5 StatefulSet + PV 필수). durable 앵커는 항상 박힌다.
- **로그 적합성이 약점**: 로그의 핵심인 **풀텍스트 inverted index가 가장 미성숙**하다. shared-data(=S3 위 ephemeral, 유저가 쓸 모드)에서 동작하는 구현은 **v4.1(2026)에서 나온 Beta**이고 파서도 하나뿐. JSON/반정형(FLAT JSON GA v4.0)과 고카디널리티는 우수하지만, 정작 needle-search가 young하다.
- **수집 마찰**: 네이티브 OTLP 리시버 없음 → OTel Collector가 Kafka(Routine Load)나 Stream Load HTTP로 landing시켜야 한다. OTel 스파인 계획과 어긋난다.
- **결정적 갭 — 생태계**: **턴키 관측성 UI가 전무**하다(SQL 인터페이스만, live-tail/trace-waterfall/RUM 없음). Grab이 StarRocks 관측성에 자체 Golang 백엔드 + 커스텀 프론트를 만든 게 그 증거 — 그 glue를 직접 소유해야 한다. 게다가 스케일 로그 프로덕션 레퍼런스가 사실상 0(플래그십 유저는 전부 BI/레이크하우스/JOIN 용도). 운영 부담은 3개 후보 중 최고이고 VM 스킬 재사용은 0. 스폰서 CelerData가 2026-05 PhoenixAI로 피벗해 로드맵 불확실성도 있다.
- **압축**: ~5:1–10:1, ES 대비 인프라 50~80% 절감 `[벤더]`.

> 판단: **로그 스토어로는 아직 얼리어답터 영역.** "고동시성·JOIN-heavy·S3-elastic 분석/레이크하우스 플랫폼(로그는 그중 한 테넌트)"라는 별도 mandate가 생길 때만 back-pocket에 둔다. ClickHouse와의 정면 비교는 [ClickHouse vs StarRocks]({{< relref "07-clickhouse-vs-starrocks.md" >}}) 참고.
