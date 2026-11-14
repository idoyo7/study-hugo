---
title: "07 pstack — 설계와 검증으로 이끄는 병렬 작업"
description: "Lauren Tan(poteto)이 만든 pstack의 작업 절차를 따라가며 poteto-mode와 플레이북 23개·원칙 24개의 역할, Claude Code 공식 하네스와 pstack-claude 포트의 설치·설정 차이, 공개 이슈와 비교 사례에 나타난 한계를 살펴봅니다."
date: 2026-11-14
lastmod: 2026-11-14
weight: 7
url: "/ai-tools/07-pstack/"
---

# 07 · pstack — 설계와 검증으로 이끄는 병렬 작업

> 2026-11-14에 GitHub 저장소 원문(README, SKILL.md, plugin.json, 이슈)과 저자의 X 글을 읽고 작성한 글입니다. 직접 설치해 실행한 결과는 아닙니다. 버전·스타 수·모델 이름은 조회일 기준이며, 확인하지 못한 내용은 따로 밝힙니다. 리눅스의 스택 트레이스 도구 `pstack(1)`과는 이름만 같습니다.

## 에이전트의 신뢰를 목표로 만든 pstack

pstack은 코딩 에이전트에게 설계·위임·검증의 작업 절차를 가르치는 스킬 묶음입니다. 여러 에이전트를 병렬로 돌려도 그 결과를 믿을 수 있게 만드는 것이 목표입니다. 작업에 맞는 플레이북을 고르는 `poteto-mode`를 중심으로, 조사와 설계, 구현 위임, 검증에 필요한 스킬을 연결합니다.

만든 사람은 React 코어 팀에서 React Compiler를 만드는 Lauren Tan(GitHub·X 계정 poteto)입니다. Cursor에서 매일 쓰던 개인 스킬과 엔지니어링 원칙을 묶어 2026-05-25에 공개했습니다. README에서는 자신을 Meta, Netflix, Cursor에서 수백만 줄 규모의 코드를 다뤄 온 사람으로 소개합니다.

저자가 공개 글 「How I Use Cursor」에서 짚은 병목은 검증입니다. "The bottleneck with agents is verification." 여러 CLI를 한 화면에 띄워 동시에 돌리는 방식은 초점을 잘못 잡았으며, 자신은 에이전트를 믿을 수 있게 만드는 일에 관심을 뒀다고 씁니다. 에이전트를 끊임없이 기억을 잃는 신입에 비유합니다. 유능하지만 어리석고, 그래도 잘 가르칠 수 있는 존재라는 것입니다.

이 관점에서 무작정 병렬화하면 품질 낮은 생성물인 슬롭(slop)만 더 빨리 쌓입니다. "Naive parallelization just makes them write slop faster." 아직 믿지 못하는 에이전트를 늘리는 일은 토큰 낭비라는 비판입니다. pstack은 저자가 관찰한 실패 양상을 스킬로 옮긴 결과물이며, 저자는 이 방식을 깊이 우선으로 적용한 에이전트 오케스트레이션이라고 부릅니다.

원본은 Cursor의 공식 플러그인 모노레포 [`cursor/plugins`](https://github.com/cursor/plugins/tree/main/pstack) 안의 `pstack/` 폴더에 있습니다. `plugin.json` 기준 버전은 0.15.36, 라이선스는 MIT입니다. 별도 GitHub 릴리스나 태그 없이 `plugin.json`의 버전을 올리는 커밋으로 관리하며, `pstack/` 경로의 마지막 커밋은 2026-10-27입니다. 모노레포의 폴더이므로 pstack만의 스타 수는 없습니다.

## 요청에 맞는 절차를 고르는 poteto-mode

사용자가 프롬프트 앞에 `/poteto-mode`를 붙이면 `poteto-mode`가 요청에 맞는 플레이북을 고릅니다. 플레이북 23개 중 하나를 선택하고, 그 단계를 글자 그대로 todo 목록에 옮긴 뒤 작업을 시작합니다. 이후 각 단계에 필요한 스킬을 부릅니다.

플레이북은 작업 유형별 절차서입니다. investigation, bug-fix, perf-issue, feature, refactoring, prototype, eval, shipping, orchestrate, session-pickup, pause-safely, multi-phase-plan 등이 있습니다. opening-a-pr는 다른 모든 플레이북의 끝에서 실행합니다. 어느 플레이북에도 맞지 않거나 대형 마이그레이션이면 `figure-it-out` 스킬로 넘어갑니다.

계획 문서를 기본 출발점으로 삼지는 않습니다. README에는 "personally, i don't believe in planning. the best spec is code."라고 적혀 있습니다. plan → execute → review로 단계를 나눈 스킬 체인이 없고, init이나 doctor 스킬도 없습니다. 계획을 만드는 multi-phase-plan 플레이북은 있지만 기본 절차는 아닙니다.

작업 절차와 함께 에이전트가 지켜야 할 행동도 정합니다. `poteto-mode`의 SKILL.md에 담긴 지시는 다음과 같습니다.

- 첫 응답에서 사용자의 목표, 풀려는 문제, 예상하는 가장 작은 변경을 자기 말로 밝히고 확인을 기다리지 않는다.
- 실행하면 알 수 있는 사실은 사람에게 묻지 않고 Prototype 플레이북으로 직접 확인한다.
- 작업은 자율적으로 진행하되, 공유 브랜치 force-push, 배포, 데이터 삭제, 고객 메시지처럼 되돌릴 수 없는 쓰기 앞에서는 항상 멈춘다.
- 서브에이전트를 부른 쪽이 결과를 책임진다. diff를 직접 검토하고 요약도 직접 쓴다.
- 모든 주장에 근거를 달거나 측정·추론·추측 중 무엇인지 표시한다. 링크와 인용을 지어내지 않는다.

거의 모든 스킬에는 `disable-model-invocation: true`가 붙어 있습니다. 모델이 알아서 스킬을 부르지 않고 사용자가 `/이름`으로 호출하게 하는 설정입니다. Claude Code 포트에는 작업에 따라 `poteto-mode`를 부르도록 지시하는 훅이 추가되며, 이 차이는 설치 경로에서 살펴봅니다.

## 설계부터 PR까지 이어지는 Feature 플레이북

기능 추가를 맡겼을 때의 절차는 Feature 플레이북에서 확인할 수 있습니다. 메인 에이전트는 설계·리뷰·검증을 책임지고, 구현을 위임합니다. 아래 도식은 그 역할 분담을 보여줍니다.

{{< flow src="_flow/1-feature-플레이북의-위임과-검증.json" />}}

플레이북의 단계는 다음과 같습니다.

1. `how`로 영향받는 서브시스템을 파악한다.
2. `architect`로 타입과 모듈 모양을 병렬로 탐색한다.
3. 병렬화 점검 항목 네 개를 todo에 적는다. 먼저 끝나야 하는 단계, 독립 작업 흐름, 공유 가변 상태, 가장 작은 안전한 분해다.
4. 코드 작성을 구현용 모델에 위임한다. 구현 모양이 여럿 가능하면 `arena`로 넘긴다.
5. 해당 작업에 맞는 화면에서 검증한다. 결과가 불확실하거나 엉뚱한 화면에서 확인한 것은 통과로 치지 않는다.
6. 작고 순서 있는 커밋으로 rebase한다.
7. 설계에 이견이 있으면 `interrogate`를 돌린다.
8. opening-a-pr 플레이북을 실행한다.

병렬 작업에 쓰는 `swarm`과 `arena`는 일을 나누는 방식이 다릅니다. `swarm`은 워커 N개에 작업을 나눠 주거나 같은 과제로 경주시킨 뒤 보고서 하나로 취합합니다. `arena`에서는 여러 후보가 같은 과제를 각자의 git worktree에서 풉니다. 후보끼리 평가한 뒤 하나를 바탕으로 고르고 나머지의 장점을 접목합니다. `interrogate`는 다른 모델들에게 diff를 깨뜨려 보게 하고, 실행으로 입증된 지적만 남깁니다.

원본은 이 검토에 서로 다른 벤더의 모델을 씁니다. 코드 작성은 `grok-4.7-xhigh-fast`, 판단과 산문은 `claude-opus-5-5-xhigh`가 맡고, `arena`·`architect`·`interrogate`의 패널에는 둘을 하나씩 넣습니다. 같은 프롬프트를 다른 모델에 주는 것을 두 번째 의견으로 정의하므로, 다른 벤더 모델끼리의 적대적 검토가 설계의 전제입니다. 역할별 모델과 추론 예산(unlimited, large, medium, small)은 `setup-pstack`으로 고릅니다.

## 판단을 뒷받침하는 원칙과 기억 스킬

작업 절차만으로 판단 기준까지 정할 수는 없습니다. pstack은 원칙 스킬을 따로 두고 에이전트가 판단 근거로 인용하게 합니다. 단, 이번 세션에서 해당 SKILL.md를 실제로 읽은 원칙만 인용할 수 있습니다.

원본 `pstack/skills/` 아래의 SKILL.md는 58개입니다. 사용자가 부르는 스킬 34개와 `principle-`로 시작하는 원칙 스킬 24개로 구성됩니다. 여기에 `poteto-mode` 안의 플레이북 23개와 서브에이전트 정의 2개(`poteto-agent`, `comment-sicko`)가 있습니다. 2차 글마다 개수가 다른 것은 공개 뒤로 계속 늘어 왔기 때문으로 보입니다.

원칙 24개의 색인은 `poteto-mode` 본문에 들어 있습니다. core 10개(laziness-protocol, attack-the-premise, subtract-before-you-add 등), architecture 6개(model-the-domain, boundary-discipline, make-operations-idempotent 등), verification 5개(prove-it-works, fix-root-causes, test-behavior-not-implementation 등)가 있습니다. delegation 2개(guard-the-context-window, never-block-on-the-human)와 meta 1개(encode-lessons-in-structure)도 포함됩니다.

세션 사이의 기억은 별도 메모리 저장소를 두지 않고 트랜스크립트를 다시 읽어 복원합니다. 지난 작업을 이어 가는 스킬 외에도, 실수를 검토하고 반복을 막거나 사용자의 작업 습관을 스킬로 만드는 절차가 있습니다.

| 스킬 | 하는 일 |
|---|---|
| `recall` | 지난 세션 트랜스크립트를 빠르고 싼 모델의 서브에이전트들이 나눠 읽고, PR·이슈 같은 공유 기록과 합쳐 진행 중인 스레드와 다음 할 일을 정리 |
| `reflect` | 현재 트랜스크립트를 리뷰어 셋이 병렬로 검토하고 개선안을 Accepted·Rejected·Backlog로 분류. 승인 전에는 적용하지 않음 |
| `correct` | 두 번 일어난 실수 유형을 아키텍처, 타입·린트·CI, 테스트, 문서 순으로 가장 높은 수준에서 막음. 새 검사는 과거의 실제 실수에서 실패하는지 입증 |
| `automate-me` | 최근 2~4주 트랜스크립트에서 사용자의 작업 습관을 뽑아 개인용 `-mode` 스킬 초안을 만듦 |
| `show-me-your-work` | 의사결정을 `decisions.tsv`에 시각·단계·결정·이유·근거·결과로 기록 |

작업을 멈출 때는 `wip:` 커밋과 `/tmp/<slug>-resume.md` 메모를 남깁니다. 여러 작업을 동시에 진행할 때의 결정 기록은 `.audit/<task-slug>.tsv`에 둡니다.

## Claude Code용 공식 하네스와 pstack-claude 포트

Claude Code에서는 원본의 공식 하네스와 별도로 개발된 pstack-claude 포트를 설치할 수 있습니다. 원본도 2026-10-16부터 `cursor/plugins`에 Claude Code용 트리를 제공합니다.

```
/plugin marketplace add cursor/plugins
/plugin install pstack@cursor-plugins
```

원본 하네스는 Cursor용 스킬 문구를 유지하고, 에이전트가 세션마다 매핑표를 읽어 Claude Code의 이름과 도구로 번역하게 합니다. Automations, Bugbot, cloud agent처럼 Cursor 전용 기능이 필요한 단계에서는 건너뛰었다는 한 줄을 남기고 넘어갑니다.

[`michael-denyer/pstack-claude`](https://github.com/michael-denyer/pstack-claude) 포트는 이 이름 치환을 설치 전에 처리합니다. 원본 첫 커밋 사흘 뒤인 2026-05-26에 만들어졌으며, 조회일 기준 v0.9.138(2026-11-13 릴리스), 스타 4,200개 남짓입니다. Claude Code 외에 Codex, Copilot, Pi 등 여러 하네스용 어댑터를 함께 싣습니다. Claude Code용 설치에는 2.1.292 이상이 필요합니다.

```
/plugin marketplace add michael-denyer/pstack-claude
/plugin install pstack@pstack-claude
```

어느 경로로 설치하든 Claude Code의 명령은 `/pstack:poteto-mode`처럼 접두사가 붙습니다. 이름을 번역하는 시점 외에도 자동 라우팅, 기본 모델, 설정 파일과 일부 작업 정책에 차이가 있습니다.

| 항목 | 원본 공식 하네스 | pstack-claude 포트 |
|---|---|---|
| Cursor 이름 처리 | 스킬 원문을 유지하고 세션마다 매핑표(`docs/harness/claude-code.md`)를 읽어 런타임에 번역 | 설치 전에 이름을 미리 치환(`tools/substitutions.json`) |
| 훅 | 없음 | `SessionStart` 훅이 라우팅 문구를 주입. `setup-pstack`에서 끌 수 있음 |
| 스킬 수 | 공개 34 + 원칙 24 | 공개 43 + 원칙 24. `make-bot-ui`를 빼고 cursor-team-kit·thermos의 스킬과 자체 `babysit`을 추가 |
| 기본 모델 | grok과 opus를 섞는 다중 벤더. Claude Code에서는 grok 지정을 생략 | Claude 모델만 사용(기본 opus, 워커 sonnet, 최상위 fable) |
| 모델 설정 파일 | `~/.claude/rules/pstack-models.md`. 역할 줄을 CLAUDE.md에 넣지 말라고 명시 | `~/.claude/pstack-models.md`를 쓰고 `~/.claude/CLAUDE.md`에 `@` 참조 한 줄을 추가 |
| 정책 차이 | 원본 그대로 | `tools/forks.json`에 달리 고친 파일과 이유를 기록. 예로 autopilot-full은 직접 merge하지 않고 merge 직전에서 멈춤 |

포트의 `SessionStart` 훅은 파일 둘 이상을 건드리거나 다른 파일이 부르는 시그니처를 바꾸는 작업에 `pstack:poteto-mode`를 쓰라고 지시합니다. 설계 선택이 필요할 때, 원인을 모르는 버그를 다룰 때, 성능 문제를 다룰 때도 같은 지시를 적용합니다. 그보다 작은 작업은 직접 처리하게 합니다.

이름이 비슷한 `backnotprop/pstack`은 원본을 따라가는 미러입니다. README에서 미러임을 밝히고 있으며, 버전도 원본과 같은 0.15.36입니다. 이 경로의 설치 명령은 `npx skills add backnotprop/pstack`입니다.

### 설정 파일의 변경과 트랜스크립트 접근

포트에서 사용자 전역 설정을 건드리는 지점은 `setup-pstack`과 `automate-me`입니다. `setup-pstack`은 모델 설정을 참조하도록 `~/.claude/CLAUDE.md`에 `@` 줄을 덧붙입니다. `automate-me`는 사용자가 개인 스킬을 원할 때 `~/.claude/skills/<handle>-mode/`에 SKILL.md를 씁니다.

skillsllm의 스캔(2026-09-17)은 포트의 `automate-me`에서 “Claude config에 쓰기”를 medium 한 건으로 표시했습니다. 개인 스킬을 이 경로에 쓰라는 지시를 짚은 것으로 보입니다. 스캔 당시 해당 행의 원문은 확인하지 못했으므로 추정입니다. 사용자 전역 `~/.claude/CLAUDE.md`에 참조 줄을 추가하는 `setup-pstack`의 동작과는 구분해야 합니다.

데이터를 읽는 범위도 확인할 부분입니다. `recall`, `reflect`, `automate-me`는 세션 트랜스크립트를 읽습니다. 포트 README는 자체 서버나 텔레메트리가 없다고 밝히면서, 스킬이 에이전트에게 읽히는 내용은 트랜스크립트를 포함해 모두 모델 제공자에게 간다고 명시합니다. `automate-me`에는 현재 프로젝트의 트랜스크립트 경로만 쓰고 다른 프로젝트까지 glob하지 말라는 지시가 있습니다.

## 다른 스킬 묶음 사이의 pstack

pstack은 작업별 플레이북 안에서 설계와 검증을 진행하며, 계획 문서를 기본 출발점으로 삼지 않습니다. 계획 중심의 superpowers, 역할 페르소나를 쓰는 gstack, 팀 오케스트레이션을 앞세운 oh-my-claudecode와 비교하면 이 차이가 드러납니다.

| 항목 | pstack(원본) | superpowers | gstack | oh-my-claudecode |
|---|---|---|---|---|
| 저장소 | `cursor/plugins`의 `pstack/` | `obra/superpowers` | `garrytan/gstack` | `Yeachan-Heo/oh-my-claudecode` |
| 조회일 버전 | 0.15.36 | v7.0.2 | v1.99.2.0 | v5.8.4 |
| 접근 방식 | 라우터 하나가 플레이북을 고르고 원칙을 인용. 다른 모델의 적대적 검증. 계획 스킬 없음 | brainstorming → writing-plans → executing-plans로 이어지는 계획 중심 방법론 | CEO, 엔지니어링 매니저, QA 리드 같은 역할 페르소나 | 멀티 에이전트 팀과 오케스트레이션 |
| 스킬 수 | 공개 34 + 원칙 24, 플레이북 23 | 15 | 설명문 기준 23 | SKILL.md 84 |
| 기본 대상 | Cursor, Claude Code 공식 하네스 | Claude Code를 비롯한 다수 하네스 | Claude Code와 주요 코딩 에이전트 | Claude Code |

묶음 사이에 겹치는 스킬도 있습니다. oh-my-claudecode는 `how` 스킬의 frontmatter에 Lauren Tan과 pstack-claude를 출처로 적어 두었습니다. arena·interrogate·recall·reflect처럼 pstack과 이름이 같은 스킬도 여럿 있지만, `how` 외의 스킬이 pstack에서 왔는지는 확인하지 않았습니다.

## 공개 로그와 비교 사례에 나타난 한계

공개 이슈에는 라우팅 지시가 실행으로 이어지지 않거나 플레이북 단계가 빠진 사례가 있습니다. 포트 이슈 [#264](https://github.com/michael-denyer/pstack-claude/issues/264)에서 한 사용자가 집계한 45일치 로컬 로그를 보면, 훅 문구가 들어간 Claude Code 메인 세션 1,725개 중 `poteto-mode`를 연 세션은 332개(19%)였습니다. 플레이북을 연 세션과 원칙을 연 세션은 각각 3%였습니다. 메인테이너는 예전 훅 문구를 쓰던 시기의 수치라고 답했습니다. 0.9.31부터는 작은 작업을 직접 처리하도록 바꿨으므로 열람률이 낮은 것이 정상일 수 있다는 설명입니다.

이슈 [#387](https://github.com/michael-denyer/pstack-claude/issues/387)은 Claude 데스크톱 앱에서 플레이북 단계가 빠지는 문제를 다룹니다. 짧은 항목을 요구하는 데스크톱 앱의 계획 도구 지시가 “단계를 글자 그대로 옮기라”는 규칙보다 우선 적용됐다는 보고입니다. 알림 없이 빠진 단계는 터미널에서 24단계 중 0개, 데스크톱에서 36단계 중 17개였습니다. 포트는 짧은 계획과 `todo.md` 원문 체크리스트를 함께 두는 방식으로 고쳤습니다.

모델 구성에도 한계가 있습니다. Claude Code용 포트의 기본값은 Claude 모델만 쓰므로, 원본이 전제한 다른 벤더 모델끼리의 검토가 같은 벤더 안의 다른 모델끼리로 줄어듭니다. 이 문제를 지적한 이슈 [#310](https://github.com/michael-denyer/pstack-claude/issues/310)은 열려 있습니다.

비용과 시간에 관한 비평은 Rob Shocks의 「Pstack Is Agent Overkill. Use It Anyway!」(2026-09-08)에 나옵니다. 그는 직접 비교에서 시간이 두 배 걸렸고 돈도 훨씬 더 든다고 썼습니다. 작은 디자인 변경이나 프런트엔드 UI 손질에는 과하다는 평가입니다. 프로젝트 하나에서 나온 일화이므로 일반적인 성능 차이로 볼 수는 없습니다.

기본값만으로도 `reflect`는 리뷰어 셋을, `interrogate`와 `arena`는 패널 전원을 띄웁니다. 이 구성은 토큰이 많이 든다는 평가와도 맞습니다. 비용에 관한 이 해석은 구성에서 읽은 추정이며 측정값은 아닙니다. pstack을 쓴 에이전트와 쓰지 않은 에이전트를 통제해 비교한 벤치마크는 찾지 못했습니다.

## 확인하지 못한 자료와 동작

- 원본 플레이북 23개 가운데 단계까지 원문으로 읽은 것은 feature, multi-phase-plan, pause-safely와 orchestrate 일부다. 나머지는 이름과 README 설명만 확인했다.
- 2차 기사에 나오는 공개 첫 주 사내 사용량 수치는 원문으로 확인하지 못해 싣지 않았다.
- 원본이 말하는 "Project store"와 "agent store"가 Cursor에서 어느 경로인지 확인하지 못했다.
- gstack과 oh-my-claudecode의 스킬 수는 세는 방식에 따라 달라진다. gstack은 저장소 설명문의 숫자이고, oh-my-claudecode는 트리의 SKILL.md 개수다.
- 포트 문서의 하네스별 동작은 포트가 스스로 검증했다고 적은 내용이다. 직접 실행해 보지 않았다.

## 출처

- [cursor/plugins — pstack](https://github.com/cursor/plugins/tree/main/pstack), [README](https://github.com/cursor/plugins/blob/main/pstack/README.md), [poteto-mode SKILL.md](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/SKILL.md), [Feature 플레이북](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/playbooks/feature.md), [Claude Code 하네스 매핑](https://github.com/cursor/plugins/blob/main/pstack/docs/harness/claude-code.md)
- [michael-denyer/pstack-claude](https://github.com/michael-denyer/pstack-claude), [reference](https://github.com/michael-denyer/pstack-claude/blob/main/docs/reference.md), [forks.json](https://github.com/michael-denyer/pstack-claude/blob/main/tools/forks.json)
- [backnotprop/pstack](https://github.com/backnotprop/pstack)
- Lauren Tan, [How I Use Cursor](https://x.com/poteto/status/2058975157503570132) (X, 2026-05-25), [설치 안내 글](https://x.com/poteto/status/2110757066709356851) (X, 2026-10-15)
- Rob Shocks, [Pstack Is Agent Overkill. Use It Anyway!](https://the-agent-daily.org/agentnews-experimental/deep-dives/pstack-is-agent-overkill-use-it-anyway) (2026-09-08)
- [skillsllm — pstack-claude 스캔](https://skillsllm.com/skill/pstack-claude)
- [obra/superpowers](https://github.com/obra/superpowers), [garrytan/gstack](https://github.com/garrytan/gstack), [Yeachan-Heo/oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode)
