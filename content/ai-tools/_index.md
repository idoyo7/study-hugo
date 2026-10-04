---
title: "AI 도구"
date: 2026-09-08
lastmod: 2026-09-22
weight: 180
comments: false
cascade:
  type: docs
---

# AI 도구

Claude Code 같은 AI 코딩 도구를 운영 관점에서 다루는 챕터입니다. 얼마를 쓰는지, 어디서 새는지, 어떤 설정이 비용과 품질을 갈랐는지를 숫자로 확인한 기록을 모읍니다. 03은 결이 조금 다릅니다. 에이전트 관련 용어를 같은 뜻으로 쓰려고 외부 발표를 전사해 정리했습니다.

| 문서 | 한 줄 요약 |
|------|-----------|
| [01 Claude Code 관측]({{< relref "01-claude-code-otel/index.md" >}}) | code-server 안의 Claude Code 사용량을 OTel로 hub 관측 스택에 — delta/increase 함정, 대시보드 셋, /context 프리픽스 프로브, 트랜스크립트 백필 |
| [02 Codex CLI 관측과 공통 대시보드]({{< relref "02-codex-otel/index.md" >}}) | Codex CLI를 같은 hub 파이프라인에 — delta 고정과 그 처리(지금은 VictoriaMetrics에 delta 그대로 저장), 이름 규칙, 비용 신호 부재, Claude와 토큰 4축을 맞춘 공통 대시보드, 14일 실측 |
| [03 에이전트 개념 정리]({{< relref "03-agent-concepts/_index.md" >}}) | NAVER D2 발표 전사 정리 — 워크플로우와 에이전트의 구분, 하네스와 Context/Memory, MCP/A2A |
