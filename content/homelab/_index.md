---
title: "홈랩"
weight: 9
---

# 홈랩

프로덕션에서 서비스 클러스터는 상태를 갖지 않습니다. 이 시리즈는 그 패턴을 집 두 곳에 걸친 2-클러스터 홈랩에서 구현한 기록입니다. 두 집이 물리적으로 떨어져 있어 이 패턴에 꽤 불리한 조건인데, 거기서 무엇이 성립하고 무엇이 대가로 남는지를 평면별로 나눠 다룹니다.

| 문서 | 한 줄 요약 |
|------|-----------|
| [01 토폴로지와 stateless 원칙]({{< relref "01-topology/index.md" >}}) | 무엇이 어디에 있고 상태는 어디에 있나 — hub/edge 리네임, 전체 지도, 앱 인벤토리 |
| [01B 두 클러스터와 두 개의 다리]({{< relref "01-topology-chain/index.md" >}}) | 전체 지도를 다시 그린 시안 — 독립적인 GitOps 체인과 공인망을 건너는 두 연결 |
| [02 관측 평면]({{< relref "02-observability/index.md" >}}) | 저장을 안 두면 메트릭은 어디로 가나 — 공인망 remote write와 vmauth 단일 관문 |
| [03 배포·접근 평면]({{< relref "03-deployment-access/index.md" >}}) | 코드가 클러스터에 닿는 경로(GitOps·CI)와 사람이 들어오는 경로(ArgoCD OIDC 위임) |
