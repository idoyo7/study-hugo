---
title: "홈랩"
weight: 9
comments: false
---

# 홈랩

프로덕션에서 서비스 클러스터는 상태를 갖지 않습니다. 이 챕터는 그 패턴을 집 두 곳에 걸친 2-클러스터 홈랩에서 구현한 기록입니다. 두 집이 물리적으로 떨어져 있어 이 패턴에 꽤 불리한 조건인데, 거기서 무엇이 성립하고 무엇이 대가로 남는지를 다룹니다.

| 문서 | 한 줄 요약 |
|------|-----------|
| [01 hub/edge 2-클러스터 구조]({{< relref "01-hub-edge-architecture/index.md" >}}) | prod/stage를 버리고 hub/edge로 — 통합 전체 지도, stateless 원칙, 메트릭·GitOps·인증 파이프라인 |
| [02 개발환경]({{< relref "02-dev-workspace/index.md" >}}) | hub 위의 code-server 하나에 브라우저(Keycloak)와 아이패드(Claude Code 릴레이) 두 길로 붙는다 — 터미널은 tmux, 파일은 NAS |
