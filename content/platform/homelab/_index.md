---
title: "홈랩"
date: 2026-08-20
lastmod: 2026-10-07
weight: 50
comments: false
cascade:
  type: docs
url: "/homelab/"
linkTitle: "홈랩"
---

# 홈랩

## 이 분류에서 찾기 {#section-navigation}

- [01 hub/edge 2-클러스터 구조]({{< relref "/platform/homelab/01-hub-edge-architecture/index.md" >}})
- [02 개발환경 — 브라우저와 아이패드]({{< relref "/platform/homelab/02-dev-workspace/index.md" >}})
- [03 관측 스택 일원화 — Vector와 HyperDX 컬렉터로 모으기]({{< relref "/platform/homelab/03-observability-consolidation/index.md" >}})
- [04 DNS 장애 전환 — Kuma가 깨우고 GitHub Actions가 Route53을 바꾼다]({{< relref "/platform/homelab/04-dns-failover/index.md" >}})
- [05 kagent — 파드로 도는 에이전트와 2026-10 점검]({{< relref "/platform/homelab/05-kagent/index.md" >}})
- [06 AZ affinity — 워커 두 대를 존으로 나누고 로컬 볼륨을 NAS로 옮기기]({{< relref "/platform/homelab/06-az-affinity/index.md" >}})
- [07 ClickHouse 복제 전환 — 레플리카 둘과 Keeper 세 대, 데이터는 제자리에서]({{< relref "/platform/homelab/07-clickhouse-replication/index.md" >}})

프로덕션에서 서비스 클러스터는 상태를 갖지 않습니다. 이 챕터는 그 패턴을 집 두 곳에 걸친 2-클러스터 홈랩에서 구현한 기록입니다. 두 집이 물리적으로 떨어져 있어 이 패턴에 꽤 불리한 조건인데, 거기서 무엇이 성립하고 무엇이 대가로 남는지를 다룹니다.

| 문서 | 한 줄 요약 |
|------|-----------|
| [01 hub/edge 2-클러스터 구조]({{< relref "/platform/homelab/01-hub-edge-architecture/index.md" >}}) | prod/stage를 버리고 hub/edge로 — 통합 전체 지도, stateless 원칙, 메트릭·GitOps·인증 파이프라인 |
| [02 개발환경]({{< relref "/platform/homelab/02-dev-workspace/index.md" >}}) | hub 위의 code-server 하나에 브라우저(Keycloak)와 아이패드(Claude Code 릴레이) 두 길로 붙는다 — 터미널은 tmux, 파일은 NAS |
| [03 관측 스택 일원화]({{< relref "/platform/homelab/03-observability-consolidation/index.md" >}}) | 로그·트레이스·APM 입구를 Vector와 HyperDX 컬렉터 둘로, 저장소를 ClickHouse와 VictoriaMetrics 둘로 — 수집기·저장소·OTLP 입구·메트릭 경로·대시보드마다 써 본 선택지와 최종 선택, 치른 대가 |
| [04 DNS 장애 전환]({{< relref "/platform/homelab/04-dns-failover/index.md" >}}) | edge가 죽으면 도메인을 hub로 — Route53 health check를 되돌린 뒤, Kuma가 깨우고 GitHub Actions가 OIDC로 레코드 두 개만 바꾸는 구조와 그 권한 설계 |
| [05 kagent]({{< relref "/platform/homelab/05-kagent/index.md" >}}) | 에이전트는 파드, 도구는 MCP, 모델은 ModelConfig 하나 — 질문 하나가 모델까지 가는 길, 운영하며 걸린 것, 7일 남짓 실행 1건이던 2026-10 점검에서 줄이고 올리고 보류한 것 |
| [06 AZ affinity]({{< relref "/platform/homelab/06-az-affinity/index.md" >}}) | 라벨은 존 둘, 파드를 묶던 것은 로컬 볼륨, 과반은 세 번째 노드 — 존 라벨과 스케줄링 시험, PostgreSQL·MongoDB 볼륨을 NAS로 옮긴 절차, 존이 둘일 때의 과반, 시험하지 않은 장애 동작 |
| [07 ClickHouse 복제 전환]({{< relref "/platform/homelab/07-clickhouse-replication/index.md" >}}) | 레플리카는 워커 둘에, Keeper 과반은 세 노드에, 데이터는 제자리 변환 — Keeper 3대와 노드 한정 StorageClass를 고른 이유, 리허설에서 바뀐 설계, Argo를 멈춘 채 머지하는 단계와 그 멈춤이 깨진 조건, 스크립트가 세 번 멈춘 경과, 레플리카 1의 콜드 티어를 S3로 바꾼 뒤 남은 한계 |
