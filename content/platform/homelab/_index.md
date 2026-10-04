---
title: "홈랩"
date: 2026-08-20
lastmod: 2026-10-04
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

프로덕션에서 서비스 클러스터는 상태를 갖지 않습니다. 이 챕터는 그 패턴을 집 두 곳에 걸친 2-클러스터 홈랩에서 구현한 기록입니다. 두 집이 물리적으로 떨어져 있어 이 패턴에 꽤 불리한 조건인데, 거기서 무엇이 성립하고 무엇이 대가로 남는지를 다룹니다.

| 문서 | 한 줄 요약 |
|------|-----------|
| [01 hub/edge 2-클러스터 구조]({{< relref "/platform/homelab/01-hub-edge-architecture/index.md" >}}) | prod/stage를 버리고 hub/edge로 — 통합 전체 지도, stateless 원칙, 메트릭·GitOps·인증 파이프라인 |
| [02 개발환경]({{< relref "/platform/homelab/02-dev-workspace/index.md" >}}) | hub 위의 code-server 하나에 브라우저(Keycloak)와 아이패드(Claude Code 릴레이) 두 길로 붙는다 — 터미널은 tmux, 파일은 NAS |
| [03 관측 스택 일원화]({{< relref "/platform/homelab/03-observability-consolidation/index.md" >}}) | 로그·트레이스·APM 입구를 Vector와 HyperDX 컬렉터 둘로, 저장소를 ClickHouse와 VictoriaMetrics 둘로 — 수집기·저장소·OTLP 입구·메트릭 경로·대시보드마다 써 본 선택지와 최종 선택, 치른 대가 |
