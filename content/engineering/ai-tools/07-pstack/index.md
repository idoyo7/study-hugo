---
title: "07 pstack의 작업 위임과 검증"
description: "Lauren Tan의 pstack이 플레이북으로 작업을 나누고 검증하는 방식, Claude Code의 두 설치 경로와 설정 차이, 공개 이슈와 비용 비평에 나타난 한계를 살펴봅니다."
date: 2026-11-14
lastmod: 2026-11-14
weight: 7
url: "/ai-tools/07-pstack/"
---

# 07 · pstack의 작업 위임과 검증

> 2026-11-14에 GitHub 저장소 원문(README, SKILL.md, plugin.json, 이슈)과 저자의 X 글을 읽고 작성했습니다. 버전과 모델 이름은 조회일 기준입니다. 직접 돌려 본 것은 과제 세 개를 조건마다 한두 번 실행한 시험뿐이며, 그 결과는 별도 절에 있습니다. 리눅스의 스택 트레이스 도구 `pstack(1)`과는 이름만 같습니다.

## pstack의 출발점과 검증 병목

pstack은 코딩 에이전트에게 설계·위임·검증의 작업 절차를 가르치는 스킬 묶음입니다. 여러 에이전트를 병렬로 돌려도 결과를 믿을 수 있게 만드는 것이 목표입니다.

만든 사람은 React 코어 팀에서 React Compiler를 만드는 Lauren Tan(GitHub·X 계정 poteto)입니다. Cursor에서 매일 쓰던 개인 스킬과 엔지니어링 원칙을 묶어 2026-05-25에 공개했습니다.

저자는 「How I Use Cursor」에서 "The bottleneck with agents is verification."이라고 썼습니다. 여러 CLI를 동시에 돌리는 일보다 에이전트를 믿을 수 있게 만드는 일에 관심을 뒀다는 설명입니다. 믿지 못하는 에이전트를 무작정 늘리면 품질 낮은 생성물인 슬롭(slop)만 빨리 쌓이고 토큰을 낭비한다고 비판합니다.

원본은 Cursor의 공식 플러그인 모노레포 [`cursor/plugins`](https://github.com/cursor/plugins/tree/main/pstack) 안의 `pstack/` 폴더에 있습니다. `plugin.json` 기준 버전은 0.15.36, 라이선스는 MIT입니다.

## 요청에 맞는 절차를 고르는 poteto-mode

사용자가 프롬프트 앞에 `/poteto-mode`를 붙이면 `poteto-mode`가 플레이북 23개 중 하나를 고릅니다. 플레이북의 단계를 글자 그대로 todo 목록에 옮긴 뒤, 각 단계에 필요한 스킬을 부릅니다. 맞는 플레이북이 없거나 대형 마이그레이션이면 `figure-it-out` 스킬로 넘어갑니다. opening-a-pr는 다른 모든 플레이북의 끝에서 실행합니다.

계획 문서는 기본 출발점이 아닙니다. 계획 스킬이나 plan → execute → review로 단계를 나눈 스킬 체인은 없습니다. 계획을 만드는 multi-phase-plan 플레이북은 있지만 기본 절차는 아닙니다.

작업은 자율적으로 진행하되, 공유 브랜치 force-push, 배포, 데이터 삭제, 고객 메시지처럼 되돌릴 수 없는 쓰기 앞에서는 항상 멈추도록 지시합니다. 서브에이전트를 부른 쪽은 diff를 직접 검토하고 결과를 책임져야 합니다.

거의 모든 스킬에 붙은 `disable-model-invocation: true`는 모델이 알아서 스킬을 부르지 않고 사용자가 `/이름`으로 호출하게 하는 설정입니다. Claude Code 포트에는 작업에 따라 `poteto-mode`를 부르도록 지시하는 훅이 추가됩니다.

## Feature 플레이북의 역할 분담

기능 추가를 맡기면 메인 에이전트는 설계·리뷰·검증을 책임지고 구현을 위임합니다. Feature 플레이북의 역할 분담은 다음과 같습니다.

{{< flow src="_flow/1-feature-플레이북의-위임과-검증.json" />}}

병렬화 점검 항목 네 개도 todo에 적습니다. 먼저 끝나야 하는 단계, 독립 작업 흐름, 공유 가변 상태, 가장 작은 안전한 분해입니다. 검증 결과가 불확실하거나 엉뚱한 화면에서 확인한 것은 통과로 치지 않습니다.

`swarm`은 워커 N개에 작업을 나눠 주거나 같은 과제로 경주시킨 뒤 보고서 하나로 취합합니다. `arena`에서는 여러 후보가 같은 과제를 각자의 git worktree에서 풉니다. 후보끼리 평가한 뒤 하나를 바탕으로 고르고 나머지의 장점을 접목합니다. `interrogate`는 다른 모델들에게 diff를 깨뜨려 보게 하고, 실행으로 입증된 지적만 남깁니다.

원본은 코드 작성에 `grok-4.7-xhigh-fast`, 판단과 산문에 `claude-opus-5-5-xhigh`를 씁니다. `arena`·`architect`·`interrogate`의 패널에는 둘을 하나씩 넣습니다. 다른 벤더 모델끼리의 적대적 검토가 설계의 전제입니다. 역할별 모델은 `setup-pstack`으로 고릅니다.

## 트랜스크립트를 읽는 기억 스킬

pstack은 별도 메모리 저장소 없이 트랜스크립트를 다시 읽어 세션 사이의 기억을 복원합니다. 지난 작업을 이어 가거나 현재 작업을 검토하고, 사용자의 작업 습관으로 개인 스킬을 만드는 절차입니다.

| 스킬 | 하는 일 |
|---|---|
| `recall` | 빠르고 싼 모델의 서브에이전트들이 지난 세션 트랜스크립트를 나눠 읽고, PR·이슈 같은 공유 기록과 합쳐 진행 중인 스레드와 다음 할 일을 정리 |
| `reflect` | 리뷰어 셋이 현재 트랜스크립트를 병렬로 검토하고 개선안을 Accepted·Rejected·Backlog로 분류. 승인 전에는 적용하지 않음 |
| `automate-me` | 최근 2~4주 트랜스크립트에서 사용자의 작업 습관을 뽑아 개인용 `-mode` 스킬 초안 작성 |

## Claude Code의 두 설치 경로

Claude Code에는 원본 공식 하네스와 별도로 개발된 pstack-claude 포트가 있습니다. 원본은 2026-10-16부터 `cursor/plugins`에 Claude Code용 트리를 제공합니다.

```
/plugin marketplace add cursor/plugins
/plugin install pstack@cursor-plugins
```

원본 하네스는 Automations, Bugbot, cloud agent처럼 Cursor 전용 기능이 필요한 단계에서 건너뛰었다는 한 줄을 남기고 넘어갑니다.

별도 포트인 [`michael-denyer/pstack-claude`](https://github.com/michael-denyer/pstack-claude)는 조회일 기준 v0.9.138(2026-11-13 릴리스)입니다. Claude Code용 설치에는 2.1.292 이상이 필요합니다.

```
/plugin marketplace add michael-denyer/pstack-claude
/plugin install pstack@pstack-claude
```

어느 경로로 설치하든 Claude Code의 명령은 `/pstack:poteto-mode`처럼 접두사가 붙습니다.

| 항목 | 원본 공식 하네스 | pstack-claude 포트 |
|---|---|---|
| Cursor 이름 처리 | 스킬 원문을 유지하고 세션마다 매핑표(`docs/harness/claude-code.md`)를 읽어 런타임에 번역 | 설치 전에 이름을 미리 치환(`tools/substitutions.json`) |
| 훅 | 없음 | `SessionStart` 훅이 라우팅 문구를 주입. `setup-pstack`에서 끌 수 있음 |
| 기본 모델 | grok과 opus를 섞는 다중 벤더. Claude Code에서는 grok 지정을 생략 | Claude 모델만 사용(기본 opus, 워커 sonnet, 최상위 fable) |
| 모델 설정 파일 | `~/.claude/rules/pstack-models.md`. 역할 줄을 CLAUDE.md에 넣지 말라는 지시 | `~/.claude/pstack-models.md` |

포트의 `SessionStart` 훅은 파일 둘 이상을 건드리거나 다른 파일이 부르는 시그니처를 바꾸는 작업에 `pstack:poteto-mode`를 쓰라고 지시합니다. 설계 선택이 필요할 때, 원인을 모르는 버그나 성능 문제를 다룰 때도 같은 지시를 적용합니다. 그보다 작은 작업은 직접 처리하게 합니다.

### 전역 설정과 트랜스크립트 접근

포트의 `setup-pstack`은 모델 설정 파일을 참조하도록 사용자 전역 `~/.claude/CLAUDE.md`에 `@` 줄을 덧붙입니다. `automate-me`는 사용자가 개인 스킬을 원할 때 `~/.claude/skills/<handle>-mode/`에 SKILL.md를 씁니다.

포트 README는 자체 서버나 텔레메트리가 없다고 밝힙니다. 스킬이 에이전트에게 읽게 하는 내용은 트랜스크립트를 포함해 모두 모델 제공자에게 간다고 명시합니다. `automate-me`에는 현재 프로젝트의 트랜스크립트 경로만 쓰고 다른 프로젝트까지 glob하지 말라는 지시가 있습니다.

## 세 과제로 비교한 네 조건

2026-11-14에 Claude Code 2.1.325에서 원본 하네스와 포트를 시험용 저장소에 `--scope local`로 설치했습니다. 둘 다 오류 없이 설치됐으며, `claude plugin details`에는 원본 스킬 58개·에이전트 2개·훅 0개, 포트 스킬 67개·에이전트 4개·`SessionStart` 훅 1개가 표시됐습니다. 세션마다 항상 실리는 분량은 각각 약 4,802토큰·약 5,676토큰으로 표시됐습니다.

### 작은 Node CLI의 옵션 추가

첫 과제는 파일 네 개짜리 Node CLI에 `--json` 옵션을 추가하고 테스트와 README를 고치는 일입니다. 사용자 전역 설정을 빼고 메인 모델을 sonnet으로 고정해 `claude -p`로 조건마다 한 번씩 실행했습니다.

| 조건 | 비용(USD) | pstack 없음 대비 | 걸린 시간 | 관찰 |
|---|---|---|---|---|
| pstack 없음 | 0.09 | 1배 | 21초 | 직접 구현. 테스트 5개 통과 |
| 원본 하네스 + `/pstack:poteto-mode` | 0.30 | 3.4배 | 62초 | 목표를 자기 말로 밝힌 뒤 `pstack:poteto-agent` 하나에 구현 위임. diff를 검토해 출력 형식과 README를 직접 수정. `how`·`architect` 단계는 작은 변경이라며 건너뜀. 테스트 6개 통과 |
| 포트 + `/pstack:poteto-mode` | 0.17 | 1.8배 | 26초 | 목표를 자기 말로 밝힌 뒤 파일 3개 규모라며 서브에이전트 없이 직접 구현. 테스트 5개 통과 |
| 포트, 접두사 없이 훅만 | 0.11 | 1.3배 | 20초 | 훅 문구는 주입됐지만 `poteto-mode`를 부르지 않고 직접 구현. 테스트 6개 통과 |

네 조건 모두 JSON 출력이 동작했습니다. 훅만 둔 조건의 비용이 1.3배로 늘어난 것은 항상 실리는 스킬 목록과 훅 문구가 입력을 늘렸기 때문으로 보입니다.

### 할 일 관리 CLI의 기능 명세 구현

두 번째는 소스 파일 11개짜리 할 일 관리 CLI에 기능 명세서(SPEC.md) 한 편을 구현하는 과제입니다. 명세는 작업 간 의존 관계·순환 감지·반복 작업·저장 형식 v1에서 v2로의 마이그레이션·원자적 쓰기·undo를 요구합니다. 숨은 수용 테스트 45개를 미리 만들고 참조 구현이 모두 통과하는 것을 확인했습니다. 구현 전 저장소는 45개 중 7개만 통과했습니다. 조건은 앞과 같고 조건마다 두 번씩 실행했습니다.

| 조건 | 숨은 테스트 통과 | 평균 비용(USD) | pstack 없음 대비 | 걸린 시간 | 직접 쓴 테스트 수 |
|---|---|---|---|---|---|
| pstack 없음 | 45/45, 45/45 | 0.39 | 1배 | 136초, 133초 | 35, 35 |
| 원본 하네스 + `/pstack:poteto-mode` | 45/45, 45/45 | 0.45 | 1.2배 | 129초, 153초 | 38, 53 |
| 포트 + `/pstack:poteto-mode` | 45/45, 45/45 | 0.49 | 1.3배 | 150초, 151초 | 49, 49 |
| 포트, 접두사 없이 훅만 | 45/45, 45/45 | 0.45 | 1.2배 | 167초, 154초 | 50, 51 |

여덟 번 모두 숨은 테스트를 통과해 품질 차이는 드러나지 않았습니다. CLI 계약이 명확해 sonnet은 pstack 없이도 2분 남짓에 끝냈습니다. pstack 설치 조건의 비용은 1.2~1.3배, 직접 쓴 테스트는 pstack 없는 조건의 35개보다 많은 38~53개였습니다. 훅만 둔 조건도 테스트가 많아 이 차이가 `poteto-mode` 때문인지는 알 수 없습니다.

`/pstack:poteto-mode`를 붙인 네 번 모두 서브에이전트 없이 처리했고, 플레이북 파일과 `how`·`architect`를 열지 않았습니다.

### 제보 세 건으로 버그를 찾는 시험

세 번째 시험은 메인 모델을 opus로 올려 버그를 찾게 했습니다. 두 번째 시험의 참조 구현에 버그 여섯 개를 심었으며, 자체 테스트 28개는 모두 통과하는 상태였습니다. 에이전트에게는 버그 셋에 해당하는 모호한 제보 세 건과 "원인을 찾아 고쳐 달라, 동작의 기준은 SPEC.md"라는 요청만 줬습니다. 제보 밖 셋 중 둘은 제보된 버그와 같은 파일이나 흐름에, 하나는 무관한 모듈에 있습니다. 버그마다 따로 만든 숨은 테스트 16개로 채점했으며, 버그 하나를 되돌리면 해당 버그의 테스트만 통과로 바뀌는 것을 미리 확인했습니다. 조건마다 두 번씩 실행했습니다.

| 조건 | 제보된 버그 3개 | 제보에 없는 버그 3개 | 평균 비용(USD) | pstack 없음 대비 | 걸린 시간 |
|---|---|---|---|---|---|
| pstack 없음 | 3개 수정, 3개 수정 | 3개 수정, 3개 수정 | 0.42 | 1배 | 77초, 75초 |
| 원본 하네스 + `/pstack:poteto-mode` | 3개 수정, 3개 수정 | 2개 수정·1개 놓침, 3개 보고만 | 0.68 | 1.6배 | 124초, 107초 |
| 포트 + `/pstack:poteto-mode` | 3개 수정, 3개 수정 | 3개 보고만, 3개 보고만 | 0.97 | 2.3배 | 172초, 106초 |
| 포트, 접두사 없이 훅만 | 3개 수정, 3개 수정 | 1개 수정·1개 보고·1개 놓침, 3개 보고만 | 0.60 | 1.4배 | 102초, 68초 |

제보된 버그 셋은 여덟 번 모두 고쳤습니다. 제보 밖 버그는 여섯 번은 셋 모두 찾았고, 두 번은 하나씩 놓쳤습니다. pstack 없는 조건은 두 번 모두 제보 밖 버그까지 고치고 원하지 않으면 되돌릴 수 있다고 알렸습니다. pstack을 설치한 여섯 번 중 네 번은 셋을 재현하고도 요청 범위가 제보 세 건이라는 이유로 고치지 않고 보고만 했으며, 한 실행은 Laziness Protocol을 근거로 들었습니다. 숨은 테스트 통과 수만 보면 pstack 없는 조건이 가장 높습니다. 어느 쪽이 나은지는 요청자의 기대에 달려 있어, 이 시험으로 우열을 정할 수는 없습니다.

`/pstack:poteto-mode`를 붙인 네 번 중 두 번은 bug-fix 플레이북 파일을 읽었습니다. 원본의 한 실행은 실패하는 회귀 테스트를 먼저 커밋한 뒤 수정을 커밋했습니다. 포트의 한 실행은 `pstack:poteto-agent` 하나를 opus로 띄워 세 수정의 독립 리뷰를 맡겼으며, 비용이 1.25달러로 가장 높았습니다.

### 플레이북 규칙과 훅 호출

세 시험에서 `/pstack:poteto-mode`를 붙인 실행에는 todo 도구 호출이 없었습니다. 명시 호출 중 첫 시험의 포트와 두 번째 시험의 두 실행은 원칙 스킬을 읽지 않고 원칙을 인용해, 이번 세션에서 읽은 원칙만 인용하라는 규칙과 어긋났습니다.

훅만 둔 조건은 sonnet을 쓴 앞선 두 시험에서는 `poteto-mode`를 열지 않았고, opus를 쓴 세 번째 시험에서는 두 번 모두 `pstack:poteto-mode`를 스스로 불렀습니다.

과제 세 개를 조건마다 한두 번만 실행했고, `setup-pstack`은 실행하지 않았습니다. 다른 벤더 모델의 검토는 없었고 `arena`·`interrogate`도 발동하지 않았습니다. 설계 선택이 열린 작업과 큰 기존 코드베이스는 시험하지 못했습니다. 큰 작업에서 품질이 달라지는지는 이 결과로 알 수 없습니다.

## 다른 스킬 묶음 사이의 pstack

pstack은 작업별 플레이북 안에서 설계와 검증을 진행하며, 계획 문서를 기본 출발점으로 삼지 않습니다. 계획 중심의 superpowers, 역할 페르소나를 쓰는 gstack, 팀 오케스트레이션을 앞세운 oh-my-claudecode와 비교하면 이 차이가 드러납니다.

| 항목 | pstack(원본) | superpowers | gstack | oh-my-claudecode |
|---|---|---|---|---|
| 저장소 | `cursor/plugins`의 `pstack/` | `obra/superpowers` | `garrytan/gstack` | `Yeachan-Heo/oh-my-claudecode` |
| 조회일 버전 | 0.15.36 | v7.0.2 | v1.99.2.0 | v5.8.4 |
| 접근 방식 | 라우터 하나가 플레이북을 고르고 원칙을 인용. 다른 모델의 적대적 검증. 계획 스킬 없음 | brainstorming → writing-plans → executing-plans로 이어지는 계획 중심 방법론 | CEO, 엔지니어링 매니저, QA 리드 같은 역할 페르소나 | 멀티 에이전트 팀과 오케스트레이션 |
| 스킬 수 | 공개 34 + 원칙 24, 플레이북 23 | 15 | 설명문 기준 23 | SKILL.md 84 |
| 기본 대상 | Cursor, Claude Code 공식 하네스 | Claude Code를 비롯한 다수 하네스 | Claude Code와 주요 코딩 에이전트 | Claude Code |

## 공개 이슈와 비용 비평의 한계

포트 이슈 [#264](https://github.com/michael-denyer/pstack-claude/issues/264)에서 한 사용자가 집계한 45일치 로컬 로그를 보면, 훅 문구가 들어간 Claude Code 메인 세션 1,725개 중 `poteto-mode`를 연 세션은 332개(19%)였습니다. 플레이북을 연 세션과 원칙을 연 세션은 각각 3%였습니다. 메인테이너는 예전 훅 문구를 쓰던 시기의 수치라고 답했습니다. 0.9.31부터는 작은 작업을 직접 처리하도록 바꿨으므로 낮은 열람률이 정상일 수 있다는 설명입니다.

이슈 [#387](https://github.com/michael-denyer/pstack-claude/issues/387)은 Claude 데스크톱 앱에서 플레이북 단계가 빠지는 문제를 다룹니다. 짧은 항목을 요구하는 계획 도구의 지시가 단계를 글자 그대로 옮기라는 규칙보다 우선 적용됐다는 보고입니다. 알림 없이 빠진 단계는 터미널에서 24단계 중 0개, 데스크톱에서 36단계 중 17개였습니다. 포트는 짧은 계획과 `todo.md` 원문 체크리스트를 함께 두는 방식으로 고쳤습니다.

Claude Code용 포트는 기본값으로 Claude 모델만 씁니다. 원본이 전제한 다른 벤더 모델끼리의 검토가 같은 벤더 안의 다른 모델끼리로 줄어드는 것입니다. 이 문제를 지적한 이슈 [#310](https://github.com/michael-denyer/pstack-claude/issues/310)은 열려 있습니다.

Rob Shocks는 「Pstack Is Agent Overkill. Use It Anyway!」(2026-09-08)에서 직접 비교한 결과 시간이 두 배 걸렸고 돈도 훨씬 더 든다고 썼습니다. 작은 디자인 변경이나 프런트엔드 UI 손질에는 과하다는 평가입니다. 프로젝트 하나에서 나온 일화이므로 일반적인 성능 차이로 볼 수는 없습니다. pstack을 쓴 에이전트와 쓰지 않은 에이전트를 통제해 비교한 공개 벤치마크는 찾지 못했습니다.

## 출처

- [cursor/plugins — pstack](https://github.com/cursor/plugins/tree/main/pstack), [README](https://github.com/cursor/plugins/blob/main/pstack/README.md), [poteto-mode SKILL.md](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/SKILL.md), [Feature 플레이북](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/playbooks/feature.md), [Claude Code 하네스 매핑](https://github.com/cursor/plugins/blob/main/pstack/docs/harness/claude-code.md)
- [michael-denyer/pstack-claude](https://github.com/michael-denyer/pstack-claude), [reference](https://github.com/michael-denyer/pstack-claude/blob/main/docs/reference.md)
- Lauren Tan, [How I Use Cursor](https://x.com/poteto/status/2058975157503570132) (X, 2026-05-25), [설치 안내 글](https://x.com/poteto/status/2110757066709356851) (X, 2026-10-15)
- Rob Shocks, [Pstack Is Agent Overkill. Use It Anyway!](https://the-agent-daily.org/agentnews-experimental/deep-dives/pstack-is-agent-overkill-use-it-anyway) (2026-09-08)
- [obra/superpowers](https://github.com/obra/superpowers), [garrytan/gstack](https://github.com/garrytan/gstack), [Yeachan-Heo/oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode)
