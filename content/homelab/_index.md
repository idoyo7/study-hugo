---
title: "홈랩"
weight: 9
---

# 홈랩

두 집에 걸친 2-클러스터 홈랩의 구조와 운영 기록입니다. 중앙(hub)과 원격 스포크(edge)로 역할을 나누고, 스토리지가 없는 클러스터를 어떻게 stateless하게 관리하는지를 다룹니다.

> **리뷰용 분기**: 같은 내용을 두 가지 편집안으로 나란히 두었습니다. 하나를 고르면 나머지는 정리합니다.
> - **안 A (통합본)** — 01 한 편에 토폴로지·관측·배포·인증을 모두 담은 구성.
> - **안 B (평면 분리안)** — 02~04 세 편으로 나눠 각 편이 질문 하나씩만 답하는 구성. ArgoCD 인증/인가(사람의 접근) 다이어그램은 안 B에만 있습니다.

| 문서 | 한 줄 요약 |
|------|-----------|
| [01 hub/edge 2-클러스터 구조 (안 A · 통합본)]({{< relref "01-hub-edge-architecture/index.md" >}}) | 한 편에 전부 — 토폴로지, stateless 원칙, 메트릭·GitOps·인증 |
| [02 토폴로지와 stateless 원칙 (안 B · 1/3)]({{< relref "02-b-topology/index.md" >}}) | 무엇이 어디에 있고 상태는 어디에 있나 — 리네임 배경, NAS 이사 사건, 앱 인벤토리 |
| [03 관측 평면 (안 B · 2/3)]({{< relref "03-b-observability/index.md" >}}) | 메트릭이 어떻게 흐르고 어디서 인증되나 — vmauth 단일 관문, 무중단 전환 순서 |
| [04 배포·접근 평면 (안 B · 3/3)]({{< relref "04-b-deployment-access/index.md" >}}) | 코드의 흐름(GitOps·CI·self-managed apps-root)과 사람의 접근(ArgoCD OIDC 위임·RBAC) |
