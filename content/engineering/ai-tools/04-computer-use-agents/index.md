---
title: "04 Computer Use Agent — 어디에 쓰고 어디엔 쓰지 않나"
description: "CUA의 동작 원리, 제품·API 지형, 실제 쓰이는 곳과 한계, 안전하게 쓰는 법을 2026-10-06 기준으로 정리하고 API·접근성 트리·픽셀 중 무엇을 먼저 쓸지 판단 기준을 제시한다."
date: 2026-10-06
lastmod: 2026-10-06
weight: 4
url: "/ai-tools/04-computer-use-agents/"
---

# 04 · Computer Use Agent — 어디에 쓰고 어디엔 쓰지 않나

## 1. CUA는 무엇이고 무엇이 아닌가

CUA(Computer Use Agent)는 사람이 보는 화면을 보고, 사람이 쓰는 입력 수단으로 소프트웨어를 조작하는 에이전트입니다. 스크린샷을 받아 어디를 누르고 무엇을 칠지 정하고, 그 행동을 실행한 뒤 바뀐 화면을 다시 봅니다. API가 없는 사내 포털이든 데스크톱 앱이든, 사람이 마우스와 키보드로 할 수 있는 일이면 같은 방식으로 다룹니다.

요즘 여기저기서 보이는 CUA를 플랫폼 엔지니어, SRE, 개발자가 어디에 쓸 수 있을까요. 이 글이 따라가는 질문입니다. 답을 먼저 적어 두면, CUA는 API가 없거나 막힌 곳에서만 경제성이 나옵니다. API가 있으면 API를 부르는 에이전트가 먼저입니다. 화면이 필요해도 접근성 트리나 코드로 풀리는지 먼저 봅니다. 픽셀을 보고 클릭하는 방식은 그다음, 마지막 수단입니다.

이 문장이 어디까지 맞는지 정의, 동작 원리, 제품, 사례, 한계, 비용, 안전, 직접 해보기 순으로 확인하고 마지막 절에서 판단 기준으로 묶습니다.

CUA는 에이전트의 한 종류입니다. 워크플로우와 에이전트를 어떻게 구분하는지, 모델 바깥에서 도구와 루프를 돌리는 하네스가 무엇인지는 [03 에이전트 개념 정리]({{< relref "/engineering/ai-tools/03-agent-concepts/_index.md" >}})에서 다뤘습니다. CUA에서 달라지는 점은 도구가 "함수 호출"이 아니라 "화면 조작"이라는 것 하나입니다. Anthropic의 API에서 computer use는 클라이언트 측 도구입니다. 가상 머신이든 컨테이너든 환경은 개발자가 띄우고, 모델은 스크린샷을 보고 행동을 요청할 뿐입니다 `✓`. 환경을 띄우고 행동을 실행하는 쪽이 하네스, 곧 내가 짜야 하는 부분입니다.

비슷해 보이는 것과의 경계도 짚어 둡니다.

- RPA는 정해 둔 화면 좌표나 셀렉터를 따라 움직이는 결정적 자동화입니다. 화면이 바뀌면 깨집니다. CUA는 화면을 매번 읽어서 판단하므로 바뀐 화면에 덜 깨지는 대신 느리고 비쌉니다.
- API 에이전트는 화면을 거치지 않고 함수나 CLI를 직접 부릅니다. 같은 일이 API로 되면 화면은 필요 없습니다.
- 브라우저 자동화 라이브러리(Playwright 등)는 사람이 짠 스크립트가 움직입니다. 모델이 판단하는 부분을 더하면 브라우저 에이전트가 됩니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `Ⓑ` 공개 벤치마크 · `≈` 추정·계산 · `?` 미확인 · `Σ` 종합 판단. 수치가 나오는 문장 끝에만 붙이고, 조건과 출처는 절마다 접어 둔 표에 모았습니다. 조사 기준일은 2026-10-06입니다.

## 2. 어떻게 동작하나

### 2.1 관찰, 추론, 행동, 다시 관찰

CUA의 뼈대는 루프 하나입니다. 환경에서 화면을 캡처해 모델에 주고, 모델이 다음 행동을 정하면 하네스가 실행하고, 바뀐 화면을 다시 캡처합니다. 아래 도식은 그 루프와, 루프 바깥에 놓이는 검사 단계를 함께 보여 줍니다.

{{< flow src="_flow/2-관찰-추론-행동-루프.json" />}}

분류기와 사람 확인은 모델 바깥에 두는 장치입니다. Anthropic API는 도구 결과를 스캔하는 인젝션 분류기를 기본으로 켜 두고, 의심스러우면 그 지시가 정말 사용자에게서 왔는지 확인하도록 모델을 유도합니다 `✓`. 어느 단계에서 누가 멈추는지는 벤더마다 다르므로 7절에서 따로 봅니다.

모델이 낼 수 있는 행동의 목록은 도구 정의가 정합니다. Anthropic의 `computer_toolset_20260801`에는 멤버 도구가 17개 있습니다. `screenshot`, `zoom`, 여러 종류의 클릭, `left_click_drag`, `type`, `key`, `scroll`, `wait` 같은 것들입니다 `✓`. 좌표는 모델에게 보낸 스크린샷의 픽셀 공간 기준이라, 하네스가 실제 화면 좌표로 되돌려 계산해야 합니다. macOS Retina처럼 화면 배율이 2인 환경에서는 절반으로 나누거나 스크린샷을 줄여서 보냅니다 `✓`.

한 응답에 행동 여러 개를 담는 배치 액션도 있습니다. 클릭하고 타이핑하고 스크린샷을 찍는 식으로 이어 붙이면 왕복이 줄어듭니다. 하네스는 순서대로 실행하다 첫 실패에서 멈추고, 남은 블록에는 "실행하지 않았다"는 고정 문구로 답합니다. 앞 행동이 바꾼 화면에 뒤 행동이 의존한다면 배치로 묶으면 안 됩니다 `✓`. 작은 글씨나 밀집한 화면은 `zoom`으로 영역을 원해상도로 다시 봅니다 `✓`.

웹 안에서 끝나는 일이면 브라우저 전용 툴셋이 따로 있습니다. `browser_toolset_20260801`은 멤버가 31개(기본 활성 27개)이고, 요소 참조와 접근성 트리를 쓰며 `javascript_exec`·`file_upload`처럼 위험한 도구는 기본이 꺼져 있습니다 `✓`. 이 분리가 이 글의 주제와 이어집니다. 화면 전체가 필요한 일과 웹 페이지 안에서 끝나는 일은 쓰는 도구부터 다릅니다.

{{% details title="2.1 근거 표" closed="true" %}}
| 항목 | 내용 | 출처 | 배지 |
|---|---|---|---|
| 클라이언트 측 도구 | 환경(VM·컨테이너·데스크톱)은 개발자가 띄우고 Anthropic은 호스팅하지 않음 | [Computer use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) | ✓ |
| 툴셋 구성 | `computer_toolset_20260801` 멤버 17개, `configs`로 멤버별 on/off | 같은 문서 | ✓ |
| 브라우저 툴셋 | `browser_toolset_20260801` 멤버 31개(기본 활성 27, 옵션 4: `file_upload`·`read_console`·`read_network`·`javascript_exec`) | [Browser use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool) | ✓ |
| 좌표 | 보낸 스크린샷의 픽셀 공간 기준, 클라이언트가 역스케일. Retina DPR 2 | Computer use tool | ✓ |
| 배치 액션 | 순서대로 실행, 첫 실패에서 중단, 나머지는 `Not executed` 고정 문구. 왕복·지연 감소를 정량으로 주장하는 문장은 문서에 없음 | 같은 문서 | ✓ |
| 분류기 | 도구 결과를 스캔해 인젝션 의심 시 사용자 확인을 유도. 지원팀 요청으로 끌 수 있음 | 같은 문서 | ✓ |
{{% /details %}}

### 2.2 무엇을 보고 조작하나

관찰 방식은 스크린샷만 쓰는 방식, 접근성 트리나 DOM을 쓰는 방식, 둘을 섞는 방식으로 나뉩니다.

| 방식 | 장점 | 단점 |
|---|---|---|
| 픽셀(스크린샷만) | 앱 종류와 무관하다. 캔버스, 원격 데스크톱, 게임까지 사람과 같은 인터페이스로 본다 | 좌표 오차, 이미지 토큰 비용, 작은 요소 판독 한계 |
| 접근성 트리·DOM | 요소를 결정적으로 가리킨다. 비전 모델이 필요 없고 토큰이 적다 | 트리가 없거나 부정확한 앱(캔버스, 일부 데스크톱 앱)에서 무력하다. 트리 자체가 길 수 있다 |
| 하이브리드(스크린샷+트리, Set-of-Mark) | 트리 좌표로 번호 박스를 그려 "몇 번을 눌러라"로 좌표 문제를 피한다 | 트리 품질에 종속되고 입력이 길어진다 |

2024년 OSWorld 원 논문에서는 스크린샷만 쓴 GPT-4V가 5.26%, 접근성 트리를 쓴 GPT-4가 12.24%였습니다 `Ⓑ`. 텍스트 구조가 픽셀보다 나았던 시절입니다. 지금은 방향이 반대입니다. OSWorld-Verified 공식 시트 상위 20개 행이 모두 접근성 트리를 따로 쓰지 않는 스크린샷 기반입니다 `Ⓑ`. 모델이 화면을 읽는 힘이 그만큼 올랐다는 뜻입니다.

그렇다고 이 점수를 "픽셀이면 충분하다"로 읽으면 안 됩니다. 같은 상위권 가운데 상당수가 GUI 대신 코드를 실행하는 행동을 허용합니다 `Ⓑ`. 순수 GUI 조작 점수와 코드 실행을 섞은 점수는 같은 줄에 놓고 비교할 수 없습니다.

### 2.3 계획과 위치 찾기를 나누나, 합치나

CUA 모델의 설계는 둘로 갈립니다. 상위 모델이 "무엇을 할지"를 정하고 별도의 grounding 모델이 "어디를 누를지" 좌표를 찍는 분리형이 하나입니다. Agent S3는 주 에이전트에 GPT-5, grounding에 UI-TARS-1.5-7B를 권장 구성으로 둡니다 `Ⓥ`. 한 모델이 스크린샷을 받아 생각과 좌표를 한 번에 내는 통합형이 다른 하나입니다. UI-TARS, Fara가 여기에 듭니다.

분리형이 나온 동기는 클릭 오차입니다. 2024년 OSWorld에서 실패한 사례 550건을 분석했더니 75% 이상에 마우스 클릭 부정확이 끼어 있었습니다 `✓`.

2026년의 흐름은 한 걸음 더 나갑니다. OpenAI의 샘플 앱은 모델이 Playwright나 PyAutoGUI 코드를 써서 소프트웨어를 조작하는 구조가 기본이고 `✓`, OpenAI 문서도 GPT-6 Astra에는 code execution을 권장하면서 `computer` 도구도 계속 지원한다고 적습니다 `✓`. H Company의 Holo4는 같은 모델이 코드를 쓰고 MCP 서버와 REST API까지 직접 부른다고 소개합니다 `Ⓥ`. 픽셀 클릭이 줄고 코드와 API가 섞이는 방향입니다. 9절의 판단 기준이 이 흐름과 맞닿아 있습니다.

{{% details title="2.2~2.3 근거 표" closed="true" %}}
| 항목 | 내용 | 출처 | 배지 |
|---|---|---|---|
| OSWorld 2024 관찰 방식 비교 | 스크린샷만 GPT-4V 5.26% / a11y 트리 GPT-4 12.24% / 스크린샷+a11y GPT-4V 12.17% / SoM GPT-4V 11.77% | [OSWorld](https://arxiv.org/abs/2404.07972) | ✓ Ⓑ |
| a11y 트리 길이 | a11y 관찰 90%를 담으려면 약 6,000토큰 | 같은 논문 | ✓ |
| 공식 시트 상위 | 상위 20개 행 모두 "Additional a11y tree used = No". 상위 상당수는 "coding-based action = Yes" | [OSWorld-Verified 공식 시트](http://osworld-v1.xlang.ai/) | Ⓑ |
| 클릭 오차 | 실패 550건 중 75% 이상에 마우스 클릭 부정확 | OSWorld 논문 v2 | ✓ |
| Agent S3 구성 | 주 에이전트 GPT-5 + grounding UI-TARS-1.5-7B | [Agent-S README](https://github.com/simular-ai/Agent-S) | Ⓥ |
| OpenAI 방향 | 샘플 앱은 Playwright JS 또는 PyAutoGUI Python 런타임에서 모델이 코드로 조작. GPT-6 Astra에는 code execution 권장 | [openai-cua-sample-app](https://github.com/openai/openai-cua-sample-app), [Computer use 가이드](https://developers.openai.com/api/docs/guides/tools-computer-use) | ✓ |
| Holo4 | 코드 작성, MCP·REST API 직접 호출 (발표 보도, 2026-09-28) | H Company 발표 보도 | Ⓥ |
{{% /details %}}

## 3. 지금 쓸 수 있는 제품과 API

2026-10-06 기준으로 쓸 수 있는 것은 세 갈래로 나뉩니다. 환경을 내가 띄우고 API로 부르는 것, 벤더가 브라우저나 데스크톱까지 묶어 내놓은 제품, 코드 없이 에이전트를 만드는 업무 플랫폼입니다.

| 제공자 | 형태 | 실행 위치 | 안전장치의 기본값 | 가격·접근 | 배지 |
|---|---|---|---|---|---|
| Anthropic API | `computer_toolset_20260801`, `browser_toolset_20260801` | 개발자 환경 | 인젝션 분류기 기본 켜짐 | 일반 tool use 요금. 툴셋 선언 시 입력 약 4,500토큰 추가 | ✓ |
| Claude in Chrome | Chrome 확장. 2026-08-26 GA | 사용자의 로컬 브라우저 | 기본이 자동 승인 모드(행동마다 분류기가 검토). 수동 승인으로 바꿀 수 있음 | 유료 플랜에 포함 | ✓ |
| Claude 데스크톱 computer use | Cowork·Claude Code 안의 화면 제어 | 사용자 PC | 앱마다 첫 접근 때 허가. 투자·암호화폐 앱 기본 차단 | Pro·Max만. 지원 문서는 beta, 발표 글은 research preview | ✓ |
| OpenAI API | Responses API `computer` 도구, `gpt-6-astra`·`gpt-6.1-sol` | 개발자 환경 | 위험 행동 직전 확인을 개발자가 구현 | Astra 입력 $10 / 출력 $50, Sol 입력 $2 / 출력 $10 (1M 토큰당) | ✓ |
| ChatGPT agent·Work | agent는 원격 가상 브라우저, Work는 데스크톱 앱 | 원격 또는 로컬 | takeover·watch mode, 확인 요청 | 플랜별 차등, 한도는 확인하지 못함 | ≈ |
| Google Gemini API | Computer Use 도구(Preview). 브라우저·모바일·데스크톱 환경 | 개발자 환경 | 모델이 `require_confirmation` 반환, 인젝션 탐지는 기본 꺼짐 | 별도 요금 없이 모델 토큰 요금 | ✓ |
| Chrome auto browse | Chrome의 Gemini 사이드 패널 | 사용자의 로컬 Chrome | 민감 행동 전 확인, origin 제한 | AI Pro·Ultra 구독 | ✓ ≈ |
| Microsoft Copilot Studio | computer use 도구. 2026-05 GA | Windows 365 호스티드 브라우저 또는 고객 Windows 머신 | 허용 사이트·앱 목록, 사람 검토자 메일 | 스텝당 5 크레딧(표준) 또는 15 크레딧(프리미엄) | ✓ |
| Amazon Nova Act | 브라우저 UI 워크플로용 에이전트 서비스와 SDK | AWS 관리형 | URL 허용·차단 목록, 사람 검증 지점 | 에이전트 1시간당 $4.75 | ✓ |
| 오픈소스 | Browser Use(MIT), Stagehand(MIT), Skyvern(AGPL-3.0), Playwright MCP(Apache-2.0) | 내 환경 | 제품마다 다름 | 무료. 호스팅 클라우드는 별도 | ✓ |

표에서 눈여겨볼 곳이 몇 군데 있습니다.

Anthropic API에서는 형식이 바뀌었습니다. 새 모델인 Opus 5.5와 Sonnet 5.5는 Claude API와 Google Cloud에서 툴셋 형식만 받습니다. 이전 형식 `computer_20251124`를 보내면 400 오류가 납니다 `✓`. Bedrock에서는 5.5 모델도 이전 형식을 받는다고 하지만 자료끼리 서술이 조금 엇갈려 재확인이 필요합니다 `≈`. 기존 코드를 새 모델로 옮기려는 개발자는 `tools` 항목 교체, 결과마다 `toolset_name` 되돌려주기, 스크린샷 직접 리사이즈 같은 변경을 거칩니다 `✓`.

안전장치의 기본값은 벤더마다 다릅니다. Gemini API는 스크린샷 안에 숨은 적대 지시를 검사하는 인젝션 탐지를 기본으로 꺼 두고 `enable_prompt_injection_detection`으로 켜게 합니다 `✓`. Anthropic은 반대로 기본이 켜진 분류기를 끄려면 지원팀에 요청해야 합니다 `✓`. 어느 쪽이 낫다는 이야기가 아닙니다. 켜져 있다고 믿고 쓰다가 꺼져 있는 API를 만나는 경우를 조심하자는 이야기입니다.

OpenAI 쪽은 1차 문서 일부가 이 조사 환경에서 403으로 막혀, 제품(ChatGPT agent·Work) 관련 사실은 2차 출처로만 확인했습니다 `≈`. API 가이드와 모델 문서는 developers.openai.com에서 직접 읽었습니다 `✓`.

오픈 웨이트 모델도 실용권에 들어왔습니다. OSWorld-Verified 공식 시트에서 오픈 웨이트 1위인 Holo3-35B-A3B(활성 파라미터 3B, Apache-2.0)는 82.56%입니다 `Ⓑ`. 같은 회사라도 크기별 라이선스가 다릅니다. Holo4-27B는 비상업 라이선스(CC-BY-NC-4.0), Holo4-35B-A3B는 Apache-2.0입니다 `✓`. Microsoft의 Fara1.5(4B·9B·27B, MIT)는 스크린샷만으로 웹을 조작하는 소형 모델입니다 `Ⓥ`. 가중치가 공개돼 있다는 말과 내 업무에서 그 점수가 나온다는 말은 다릅니다. 점수를 낸 하네스와 스텝 한도가 모델마다 다릅니다.

브라우저 런타임을 파는 곳도 있습니다. Browserbase는 에이전트용 클라우드 Chromium을 시간제로 팔고, Developer 플랜은 월 $20에 100시간입니다 `Ⓥ`. Browser Use Cloud는 README 기준 브라우저 1시간에 약 $0.02입니다 `Ⓥ`. 모델 비용과 별개로, 화면을 돌릴 자리에 드는 돈입니다.

{{% details title="3절 근거 표" closed="true" %}}
| 항목 | 내용 | 출처 | 배지 |
|---|---|---|---|
| 툴셋 전환 | Claude API·Google Cloud에서 Opus 5.5·Sonnet 5.5는 툴셋만 받음. `computer_20251124`는 400. Bedrock 5.5의 이전 형식 허용 여부는 서술이 엇갈림 | Computer use tool, Claude API 마이그레이션 가이드(로컬 번들) | ✓ / ≈ |
| 선언 오버헤드 | 툴셋 기본 선언 시 입력 약 4,500토큰(모델별 4,520·4,590). zoom 끄면 약 410토큰 감소 | Computer use tool | ✓ |
| Claude in Chrome | 2026-08-26 GA, 기본 자동 승인, Enterprise는 allowlist·blocklist, 모든 유료 플랜에 포함 | [Claude in Chrome GA](https://claude.com/blog/claude-in-chrome-generally-available) | ✓ |
| 데스크톱 computer use | Pro·Max만, Team·Enterprise 미제공, macOS 15+·Windows | Claude 지원 문서 | ✓ |
| OpenAI 가격 | `gpt-6-astra` $10 / 캐시 $1 / $50, `gpt-6.1-sol` $2 / $0.1 / $10 (1M 토큰당) | developers.openai.com 모델 문서 | ✓ |
| ChatGPT agent·Work | 원격 가상 브라우저 / 로컬 데스크톱 조작. 플랜별 한도 불명 | 2차 보도 | ≈ |
| Gemini | Preview, 환경 3종(`BROWSER`·`MOBILE`·`DESKTOP`), 좌표 0~999 정규화, 정책 7종, 인젝션 탐지 기본 꺼짐 | [Gemini API Computer Use](https://ai.google.dev/gemini-api/docs/computer-use) | ✓ |
| Chrome auto browse | Android(미국) 2026-08-18 ✓, 데스크톱 발표(2026-01-28)는 2차 | Google 블로그 / 2차 보도 | ✓ ≈ |
| Copilot Studio | 단계당 5/15 Copilot Credits. 모델 선택표에 OpenAI CUA, Claude Sonnet 4.5(GA) 등 | [Computer use in Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/computer-use) | ✓ |
| Nova Act | $4.75/에이전트-시간(실제 경과 시간, 병렬은 각각, 사람 응답 대기 제외). GA는 2025-12(2차) | [AWS Nova 가격](https://aws.amazon.com/nova/pricing/) | ✓ / ≈ |
| Holo 라이선스 | Holo3-35B-A3B Apache-2.0, Holo4-27B CC-BY-NC-4.0, Holo4-35B-A3B Apache-2.0. 공개일은 HF API로 확인 | Hugging Face | ✓ |
| Fara1.5 | 4B·9B·27B, MIT, Qwen3.5 기반. Online-Mind2Web 57.3/63.4/72.3 (자체 보고) | [microsoft/fara](https://github.com/microsoft/fara) | Ⓥ |
| Browserbase·Browser Use Cloud | Developer $20/월(100시간, 초과 $0.12/h) / 약 $0.02/브라우저-시간 | 각 사 가격 페이지·README | Ⓥ |
{{% /details %}}

## 4. 실제로 어디에 쓰이나

공개된 사례를 모아 보면 CUA가 돈을 받고 일하는 곳은 두 곳으로 모입니다. API가 깨끗하게 열려 있지 않은 포털과 레거시 화면을 반복 처리하는 백오피스, 그리고 QA·E2E 테스트입니다. a16z가 운영 사례를 인터뷰해 정리한 글도, UiPath·Automation Anywhere·Copilot Studio·Nova Act 같은 업무 자동화 제품의 대표 시나리오도 이 두 축에 몰립니다 `Σ`.

사례는 신뢰도가 서로 다른 세 종류로 갈라 읽어야 합니다. 실제로 돌아간다고 밝힌 운영 사례는 대부분 벤더 마케팅이나 익명 인터뷰라 수치를 검증할 수 없습니다. 공식 문서에 실린 예시는 실고객이 아니라 샘플입니다. 마지막으로 "이런 데 쓸 수 있다"는 가능성이 있고, 플랫폼·SRE 업무는 여기에 들어갑니다.

### 4.1 실사례

| 영역 | 내용 | 결과 | 구분 | 배지 |
|---|---|---|---|---|
| 리테일 데이터 포털 | CPG 데이터 플랫폼이 리테일러 포털 상호작용을 자동화. 결정적 자동화가 UI 변경으로 깨질 때 CUA를 대체 경로로 씀 | 월 약 1,500만~2,000만 건, 유지보수 팀 절반으로 축소 | 운영 사례(익명 인터뷰) | Ⓥ |
| IT 티켓 처리 | 글로벌 SI가 CUA 워크플로 27개로 IT 티켓 처리 | 하루 약 1,500~2,100건, 인력 20~25% 재배치가 목표 | 운영 사례(익명 인터뷰) | Ⓥ |
| 채용 ATS 입력 | 채용 대행사가 후보자 데이터를 ATS에 끝까지 입력, 저렴한 비프런티어 모델 | 수치 없음 | 운영 사례(익명 인터뷰) | Ⓥ |
| 복리후생 플랜 변경 테스트 | Alight가 기존에 수개월, 수백 명이 걸리던 테스트를 UI Agents로 자동화 | 정량 결과 없음. 벤더는 효율 3배, 자동화 복원력 60% 향상 주장 | 고객 사례(벤더 발표) | Ⓥ |
| UI 테스트 | Google 팀이 Gemini 2.5 Computer Use를 UI 테스트에 프로덕션 배포 | 정량 결과 없음 | 벤더 주장 | Ⓥ |
| 자율 QA | QA.tech가 Claude computer use를 자율 테스트 플랫폼에 통합. 스크린샷만으로 동작 | 정량 결과 없음 | 벤더 블로그 | Ⓥ |
| 송장 이관·재고 입력 | PDF 송장 데이터를 웹 폼에 옮겨 제출, 품목 5건 입력 | 샘플 | 공식 문서의 예시 | ✓ |
| 복리후생 신청 입력 | 건강보험 신청 입력, PDF 추출, 누락 시 HR 에스컬레이션 | 샘플 | 공식 서비스 카드의 예시 | ✓ |

운영 사례에서 눈에 띄는 것은 CPG 사례의 구조입니다. CUA가 주인공이 아닙니다. 평소에는 결정적 자동화가 돌고, UI가 바뀌어 그것이 깨질 때만 CUA가 스스로 복구하는 대체 경로로 들어옵니다 `Ⓥ`. 수치가 가장 큰 사례가 CUA를 첫 번째 수단이 아니라 마지막 수단으로 쓴다는 점은 이 글의 결론과 방향이 같습니다.

한계도 같은 글에 있습니다. 에이전트가 "net 60"을 "net 30"으로 잘못 읽어도 결과가 그럴듯해 보였고, 보험 청구가 "접수됨"으로 보이다가 며칠 뒤 조정 단계에서 실패한 사례가 나옵니다 `Ⓥ`. 사람이 2~3분 하는 일을 에이전트는 8~10분에 한다는 체감도 같은 글에서 나옵니다 `Ⓥ`.

소비자용 구매·예약 대행은 사정이 다릅니다. Operator에서 ChatGPT agent로 이어진 계열은 로그인, 결제, CAPTCHA 앞에서 사용자에게 조작을 넘깁니다 `≈`. 완전한 위임이 아니라 "사람이 필요한 지점에서 멈추는" 구조입니다. ChatGPT agent의 시스템 카드에는 권한 편집, 고위험 커뮤니케이션 발송, 금융 거래 완료에서 확인을 요청한 비율이 99.9~100%로 적혀 있습니다. 내부 평가 수치입니다 `✓`.

### 4.2 QA·E2E 테스트

테스트는 CUA가 가장 자연스럽게 맞는 영역입니다. 지연이 커도 괜찮고, 결과를 기계적으로 판정하기 쉽고, 틀려도 운영 데이터를 건드리지 않습니다. Anthropic의 공식 한계 설명도 지연이 사람의 직접 조작보다 느릴 수 있으니 백그라운드 정보 수집이나 자동 테스트처럼 속도가 중요하지 않은 용도에 집중하라고 권합니다 `✓`. Claude in Chrome 파일럿의 내부 용도에도 "새 웹사이트 기능 테스트"가 들어 있었습니다 `✓`.

한편 이름이 알려진 QA 전용 SaaS(QA Wolf, Momentic, Checksum)의 정량 고객 결과는 찾지 못했습니다 `?`. 사례가 많은 만큼 숫자가 적은 영역입니다.

### 4.3 플랫폼·SRE 업무는 가능성으로만 말할 수 있다

플랫폼과 SRE 업무에 CUA를 써서 얻은 공개 실사례는 찾지 못했습니다 `?`. 아래는 공식 언급과 추정을 가른 목록입니다.

| 구분 | 내용 | 배지 |
|---|---|---|
| 공식 언급 | Anthropic이 Claude in Chrome GA 글에서 연동이 없는 대상으로 내부 대시보드, 레거시 시스템, 벤더 포털을 꼽음 | ✓ |
| 공식 기능 | Claude Code에서 빌드·배포한 뒤 Chrome 확장으로 브라우저에서 테스트·검증하고 콘솔 로그를 읽는 연동 | ✓ |
| 공식 기능 | Claude in Chrome 예약 작업(일·주·월·연 반복). 대시보드 정기 점검에 쓸 수 있다는 것은 추정 | ✓ / ≈ |
| 가능성 | API 없는 외부 포털(일부 도메인 등록기관, 인증서 포털, SaaS 관리 콘솔)의 저빈도 클릭 작업 | ≈ |
| 가능성 | 배포 직후 UI 스모크 확인, 대시보드 스크린샷 점검 | ≈ |
| 비교 대상(CUA 아님) | Azure SRE Agent는 런북을 읽어 진단 단계를 실행하고, Claude Managed Agents의 SRE 쿡북은 bash로 로그와 IaC를 조사하며 PR은 사람이 승인. 둘 다 화면이 아닌 API·CLI·로그 도구로 동작 | Ⓥ ✓ |

반론이 먼저 와야 공정합니다. 이미 API나 CLI 경로가 있는 일은 그쪽이 싸고 빠릅니다. 인증서 자동 갱신처럼 관리형 경로가 있는 작업은 CUA의 대상이 아닙니다 `Σ`. 온콜 런북을 실행하는 용도로는 API·CLI 에이전트가 이미 있고, 앞서 본 대로 CUA는 같은 일을 몇 배 느리게 합니다. 플랫폼 팀에서 CUA가 의미 있는 자리는 좁습니다. API가 없거나 막힌 외부 포털의 저빈도 작업, 그리고 배포 뒤 화면에서만 확인되는 검증 정도입니다 `Σ`.

보안 쪽의 공개 연구도 있습니다. 허가된 환경에서 CUA에 취약한 웹앱 36개를 공격하게 한 HackWorld(ICLR 2026)에서 가장 나은 Claude 3.7 Sonnet의 평균 성공률이 10.18%였습니다 `Ⓑ`. 2025년 모델 기준이라 지금 세대로 다시 잰 공개 수치는 찾지 못했습니다 `?`.

{{% details title="4절 근거 표" closed="true" %}}
| 항목 | 내용 | 출처 | 배지 |
|---|---|---|---|
| a16z 운영 사례 | CPG 포털 월 1,500만~2,000만 건·팀 절반 축소, IT 티켓 워크플로 27개·하루 1,500~2,100건, ATS 입력. "net 60 → net 30" 오독, 사람 2~3분 대 에이전트 8~10분 | [Can agents use a computer yet?](https://a16z.com/can-agents-use-a-computer-yet-weve-got-the-data/) | Ⓥ |
| Alight | 플랜 변경 테스트 자동화, "3x higher efficiency", "60% greater automation resiliency"는 벤더 주장 | Automation Anywhere 보도자료 2025-05-13 | Ⓥ |
| Google UI 테스트 | Project Mariner, Firebase Testing Agent, Search AI Mode 에이전트 기능에도 사용했다고 밝힘 | [Gemini 2.5 Computer Use 발표](https://blog.google/technology/google-deepmind/gemini-computer-use-model/) | Ⓥ |
| QA.tech | 자사 모델은 DOM+스크린샷이 필요했지만 Claude는 스크린샷만으로 동작, 정량치 없음 | QA.tech 블로그 | Ⓥ |
| Copilot Studio 샘플 | 송장 이관, 재고 입력. 문서의 대표 용도는 데이터 입력·송장 처리·데이터 추출 | Computer use in Copilot Studio | ✓ |
| Nova Act 서비스 카드 | 4대 용도 중 하나가 QA 테스트. 초기 고객 90%+ 종단 신뢰도는 벤더 주장 | AWS Service Card, [AWS 블로그](https://aws.amazon.com/blogs/aws/build-reliable-ai-agents-for-ui-workflow-automation-with-amazon-nova-act-now-generally-available) | ✓ / Ⓥ |
| ChatGPT agent 확인 정책 | 권한 편집 100.0%, 고위험 커뮤니케이션 발송 99.9%, 금융 거래 완료 100.0% 확인 요청. 전체 confirmation recall 91.0% | [ChatGPT agent system card](https://deploymentsafety.openai.com/chatgpt-agent) | ✓ |
| takeover | 로그인·결제·CAPTCHA에서 사용자에게 조작을 넘김. 1차 페이지는 403이라 2차 보도로만 확인 | 2차 보도 | ≈ |
| SRE 비교 대상 | Azure SRE Agent는 마크다운 런북 기반(블로그), Managed Agents SRE 쿡북은 Skill·bash·사람 승인 PR | Microsoft 블로그, Claude 쿡북 | Ⓥ / ✓ |
| HackWorld | 취약 웹앱 36개(11개 프레임워크·7개 언어), 최고 Claude 3.7 Sonnet 평균 10.18%. 실패 원인은 도구 선택·출력 파싱·복구 실패 등 | arXiv 2510.12200 | Ⓑ |
| 반론 근거 | ACM 자동 갱신 등 API·관리형 경로가 있는 작업은 CUA 대상이 아님. InfoQ 보도는 검색 요약으로만 확인 | 검색 요약 | Σ |
{{% /details %}}

## 5. 어디까지 되나

### 5.1 벤치마크는 두 줄로 나눠 읽는다

OSWorld-Verified는 데스크톱 과제 369개로 이뤄진 벤치마크이고, 사람 기준이 72.36%입니다 `Ⓑ`. 원 논문이 나온 2024년의 최고 모델은 12.24%였습니다 `Ⓑ`. 지금 공식 검증 시트(2026-08-01 기준) 상위는 사람 기준을 한참 넘습니다. 코드 실행 없이 GUI만으로 낸 최고치가 claude-fable-5의 85.96%, 코드 액션을 허용한 프레임워크는 90.19%, 오픈 웨이트 최고는 앞서 본 Holo3-35B-A3B의 82.56%입니다 `Ⓑ`. 상위권이 사람 기준을 넘어 변별력이 떨어졌고, 이 벤치마크는 포화 단계로 봅니다.

점수끼리 비교할 때 지킬 선이 몇 가지 있습니다. 공식 시트에는 15·50·100스텝 행이 따로 있고, 같은 모델도 스텝 한도에 따라 5%p 넘게 달라집니다. OpenAI의 computer-use-preview는 15스텝에서 26%, 100스텝에서 31.4%였습니다 `Ⓑ`. 벤더가 따로 발표한 Qwen3.8-27B의 84.3%("Claude Code 하네스로 평가")나 Holo4-27B의 85.2%는 공식 시트에 없는 자가 보고입니다 `Ⓥ`. 모델 점수가 아니라 모델과 하네스를 합친 점수이므로 공식 시트와 같은 줄에 두지 않습니다.

그래서 나온 후속이 OSWorld 2.0입니다. 108개 장기 업무 과제에 상한이 500스텝이고, 과제당 평균 툴 호출이 318회입니다(1.0은 약 30회) `✓`. 사람이 푸는 데 걸리는 시간의 중앙값이 약 1.6시간입니다 `✓`. 결과는 완료 여부 하나로 판정하는 이진 완료율과, 체크포인트별로 점수를 매기는 부분 점수로 나눠 발표합니다. 공식 사이트에서는 Claude Opus 4.8이 이진 완료 20.6%에 부분 점수 54.8%였습니다 `Ⓑ`.

이 둘을 한 문장에 섞으면 오해가 생깁니다. Anthropic이 Opus 5.5에 대해 발표한 OSWorld 2.1의 81.8%는 부분 점수입니다 `Ⓥ`. 같은 벤치마크의 이진 완료율 최고치와는 다른 척도이고, 신형 모델의 이진 완료율은 확인하지 못했습니다 `?`. 2.1은 2.0의 버그를 고친 판이라 2.0과도 직접 비교할 수 없습니다 `Ⓑ`.

과제 길이를 따라가 보면 한계가 더 선명합니다. 45분 미만 과제의 이진 완료율은 20~24%, 137~163분 구간은 어떤 모델도 10%를 넘지 못했고, 163분을 넘는 과제는 모든 모델이 0%였습니다 `Ⓑ`. 한 시간짜리 사람 업무를 통째로 맡기는 단계와는 거리가 있습니다.

### 5.2 웹 벤치마크는 하네스에 따라 40%대와 90%대가 공존한다

Online-Mind2Web은 실제 웹사이트 136곳에서 300개 과제를 푸는 벤치마크입니다. 같은 벤치마크인데 순위표를 보면 한쪽에는 40%대, 다른 쪽에는 90%대가 있습니다. 통일한 하네스로 비용까지 공개하는 HAL에서는 SeeAct와 GPT-5 조합이 42.33%입니다. 반면 자기보고 리더보드에는 Browser Use Cloud 97.0%, GPT-5.4 93.0%가 올라 있고, 독립 검증이 붙은 행은 ABP와 Claude Opus 4.6의 90.53%, TinyFish의 90.0%입니다 `Ⓑ`. 판정기가 제출마다 달라서 리더보드 스스로 행 사이를 비교할 수 없다고 경고합니다. 어려운 과제로 갈수록 정확도가 약 47%p 떨어진다는 원 논문의 보고도 있습니다 `Ⓑ`. 모바일 AndroidWorld는 자기보고 점수 상위가 100%에 닿아 사실상 포화입니다 `Ⓑ`.

### 5.3 느리다

정확도와 별개로 속도가 있습니다. OSWorld-Human은 최고 에이전트도 사람이 필요로 하는 스텝의 2.7~4.3배를 쓴다고 보고합니다 `Ⓑ`. 줄 간격을 바꾸는 일이 사람에게는 30초 미만이었는데 에이전트는 12분이 걸렸습니다 `Ⓑ`. 지연의 75~94%는 계획과 반성을 맡은 대형 모델 호출에서 나오고, 뒤쪽 스텝은 쌓인 히스토리 때문에 초반보다 최대 3배 느려집니다 `Ⓑ`. Anthropic 문서가 CUA를 속도가 중요하지 않은 용도에 쓰라고 권하는 이유입니다.

### 5.4 어디서 틀리나

Anthropic이 공식 문서에 적어 둔 한계는 좌표 출력의 오류와 환각, 도구 선택 오류(특히 틈새 앱과 다중 앱), 스크롤의 불안정, 스프레드시트 셀 선택, 소셜 플랫폼 계정 생성과 콘텐츠 게시 제한, 프롬프트 인젝션입니다 `✓`. 실패는 몇 가지 모양으로 반복됩니다.

- 좌표와 클릭 오차. 2024년 분석에서 실패의 75% 이상에 걸려 있었습니다.
- 장기 과제의 상태 추적. OSWorld 2.0 분석에서 제약 조건 망각, 중간에 갱신된 정보 놓침, 확인 질문 대신 추측하기, 숨은 상태 검증 부족이 실패 축으로 나옵니다 `✓`.
- 그럴듯한 오독. 위의 "net 60" 사례처럼 틀린 결과가 맞는 것처럼 보여 며칠 뒤에야 드러납니다.
- 끝났다는 착각. OpenAI 샘플 앱 README는 "실행 종료"가 루프가 정상적으로 끝났다는 뜻일 뿐 최종 답이 과제 성공을 증명하지는 않는다고 적습니다 `✓`.
- CAPTCHA. Open CaptchaWorld에서 사람은 93.3%를 풀고 최고 에이전트는 40.0%였습니다 `Ⓑ`. 풀려고 해서도 안 됩니다. Claude in Chrome과 Gemini 모두 CAPTCHA 우회를 금지합니다 `✓`.
- 로그인과 2FA. 실패율을 정량으로 다룬 1차 자료는 찾지 못했습니다 `?`.

{{% details title="5절 근거 표" closed="true" %}}
| 항목 | 내용 | 출처 | 배지 |
|---|---|---|---|
| OSWorld 기준선 | 369과제, 사람 72.36%, 2024 최고 12.24% | OSWorld | ✓ Ⓑ |
| 공식 시트 상위(2026-08-01) | Intelligence-Indeed Agent 90.19%(코드 액션 예), claude-fable-5 85.96%(코드 액션 아니오), Pointer Agent w/ Opus 4.7 83.64%, claude-opus-5 83.39%, Coasty CUA v1 82.81%, Holo3-35B-A3B 82.56% | OSWorld-Verified 공식 시트 | Ⓑ |
| 스텝 한도 | computer-use-preview 15스텝 26% → 50스텝 31.3% → 100스텝 31.4% | 같은 시트 | Ⓑ |
| 자가 보고 | Qwen3.8-27B 84.3%(Claude Code 하네스), Holo4-27B 85.2%. 공식 시트에 없음. 집계 사이트의 Qwen3.8 Max 86.1%는 공식 시트에서 확인하지 못함 | HF 모델 카드 | Ⓥ / ? |
| OSWorld 2.0 | 108과제, 21개 하위 범주, 500스텝 상한, 툴 호출 평균 318회(1.0은 약 30), 사람 중앙값 약 1.6시간. 이진과 부분 점수 병기 | [OSWorld 2.0](https://osworld-v2.xlang.ai/), arXiv 2606.29537 | ✓ Ⓑ |
| 2.0 공식 점수 | Opus 4.8 이진 20.6% / 부분 54.8%, Opus 4.7 이진 18.2%, GPT-5.5 이진 약 14% | 같은 사이트 | ✓ Ⓑ |
| 2.1 벤더 발표 | Opus 5.5 81.8%(2026-09-22), Fable 5.1 80.7%, Opus 5 74.0%. 모두 부분 점수. 집계 사이트 기준 Sonnet 5.5 80.1% | [Claude Opus 5.5 발표](https://www.anthropic.com/news/claude-opus-5-5) | ✓ Ⓥ |
| 과제 길이별 | 45분 미만 이진 20~24%, 137~163분 모든 모델 10% 미만, 163분 초과 전 모델 0% | OSWorld 2.0 사이트 | ✓ Ⓑ |
| Online-Mind2Web | 300과제·136개 사이트. HAL 통일 하네스 SeeAct+GPT-5 42.33%. 자기보고 Browser Use Cloud 97.0%, GPT-5.4 93.0%, 독립 검증 ABP+Opus 4.6 90.53%, TinyFish 90.0% | [HAL](https://benchmarklist.com/benchmarks/hal_online_mind2web/), leaderboard.steel.dev | Ⓑ |
| 쉬운 과제 대비 하락 | 어려운 과제에서 약 47%p 하락 | arXiv 2504.01382 | ✓ Ⓑ |
| AndroidWorld | 시트가 "커뮤니티 제출, 독립 검증 없음, 자기보고"라고 명시. 상위 100% | AndroidWorld 공식 리더보드 | Ⓑ |
| OSWorld-Human | 필요 스텝의 2.7~4.3배(v2, 2026-05-18 개정, v1은 1.4~2.7배), 줄 간격 변경 사람 30초 미만 vs 에이전트 12분, 계획·반성이 지연의 75~94%, 뒤쪽 스텝 최대 3배 느림 | [OSWorld-Human](https://arxiv.org/abs/2506.16042) | ✓ Ⓑ |
| 장기 과제 실패 축 | 제약 망각, 중간 갱신 놓침, 질문 대신 추측, 숨은 상태 검증 부족 | OSWorld 2.0 | ✓ |
| CAPTCHA | Open CaptchaWorld 20종·225개, 사람 93.3% vs 최고 에이전트 40.0%(OpenAI o3) | arXiv 2505.24878 | ✓ Ⓑ |
| 팝업 공격 | OSWorld·VisualWebArena에 적대적 팝업 삽입 시 공격 성공률 평균 86%, 과제 성공률 47% 하락. "팝업 무시" 프롬프트 같은 기본 방어는 효과 없음 | arXiv 2411.02391 | ✓ Ⓑ |
| OpenAI 샘플 앱 | "실행 종료는 정상 종료일 뿐 최종 답이 과제 성공을 증명하지 않는다" | openai-cua-sample-app | ✓ |
| Anthropic 공식 한계 | 좌표 환각, 도구 선택 오류, 스크롤, 셀 선택, 계정 생성·게시 제한, 인젝션 | Computer use tool | ✓ |
{{% /details %}}

## 6. 한 번 돌리면 얼마나 드나

CUA의 비용은 스크린샷에서 시작합니다. Anthropic의 비전 문서는 28×28 픽셀 패치 하나를 시각 토큰 하나로 세고, 이미지 한 장의 비용을 ⌈w/28⌉ × ⌈h/28⌉으로 계산합니다 `✓`. 1280×720이면 1,196토큰, 1024×768이면 1,036토큰, 1920×1080이면 2,691토큰입니다 `≈`. 한 장이 대략 1,000~1,800 입력 토큰이라는 문서의 표현과 맞습니다 `✓`.

모델의 한도는 긴 변 2,576픽셀, 시각 토큰 4,784개입니다. 툴셋은 이 한도를 넘는 스크린샷을 알아서 줄여 주지 않고 오류로 거부하므로, 하네스가 미리 줄여서 보내야 합니다 `✓`. 해상도는 클수록 읽기는 좋아지지만 비용도 그만큼 늘어납니다. 문서가 권하는 범위는 일반 데스크톱에 1024×768이나 1280×720, 웹 앱에 1280×800이나 1366×768이고 1920×1080을 넘기는 것은 피하라고 합니다 `✓`. 흔히 "1080p를 권장한다"고 알려져 있지만 문서의 표현은 상한에 가깝습니다. 한 요청에 담는 이미지는 20장 이하로 권하고, 넘으면 장당 픽셀 한도가 엄격해집니다 `✓`.

스크린샷은 스텝마다 쌓입니다. 1280×800 스크린샷이 1,334토큰이니 컨텍스트에 20장을 들고 있으면 이미지만 약 2만 7천 토큰입니다. 입력 단가가 100만 토큰당 $5인 모델이면 캐시 없이 스텝마다 이미지 입력만 약 $0.13입니다 `≈`. 여기에 툴셋 선언 오버헤드 약 4,500토큰이 요청마다 붙습니다 `✓`.

줄이는 방법은 문서와 블로그에 비교적 구체적으로 나와 있습니다.

- 오래된 스크린샷 가지치기. 최근 3장만 두고 25장 단위로 묶어서 치우라고 합니다. 매 턴 치우면 프롬프트 캐시가 깨집니다 `✓`. Claude 5.5 이후 모델에서 생각(thinking) 블록과 함께 쓸 때는 클라이언트 측 가지치기 대신 서버 측 tool result clearing을 권합니다 `✓`.
- 프롬프트 캐싱. 캐시에 맞으면 입력 비용이 10% 요율입니다 `✓`.
- 배치 액션. 기계적으로 이어지는 행동은 한 왕복으로 묶습니다.
- 생각 강도. Opus 4.7에서는 high가 max의 약 절반 출력 토큰으로 거의 같은 성공률을 냈다고 합니다 `✓`.
- 접근성 트리. 일반 웹 페이지에서는 트리가 스크린샷보다 토큰이 적습니다 `✓`.
- 코드 우선. 코드로 상태를 읽고 쓰고 GUI는 필요할 때만 쓰는 StateAct는 스크린샷 전용 기준선 대비 작업당 비용이 약 1/9이고 성공률도 올랐다고 합니다. 요약 기사로만 확인했고 원문은 보지 못했습니다 `Ⓑ`.

과제 한 건의 비용은 모델과 하네스에 따라 자릿수가 달라집니다. HAL이 같은 300개 과제에 든 실행 비용을 공개한 표에서 SeeAct와 GPT-5는 $171.07에 42.33%, Browser Use와 Claude Sonnet 4는 $1,577.26에 40%였습니다. 과제당 환산하면 약 $0.57과 약 $5.26이고 정확도는 비슷한데 비용은 10배 가까이 차이가 납니다 `Ⓑ`. 벤더가 밝힌 값으로는 Holo4-27B가 OSWorld 과제당 $0.08, OSWorld 2.0 과제당 $1.22입니다 `Ⓥ`.

Copilot Studio는 스텝 단위로 청구합니다. 표준 모델은 스텝당 5 Copilot Credits, 프리미엄 모델(Claude Opus 4.6)은 15 크레딧이고, 4스텝짜리 타임시트 작업이 각각 20과 60 크레딧입니다 `✓`. 크레딧 단가는 종량제 $0.01로 알려져 있지만 Microsoft의 가격 페이지에서 직접 확인하지 못해 3자 정리에 기댔습니다. 그 가정으로 환산하면 스텝당 약 $0.05와 $0.15, 4스텝 작업 약 $0.20과 $0.60입니다 `≈`. Nova Act는 에이전트 1시간에 $4.75이고 병렬 에이전트는 각각 과금합니다 `✓`.

사람 노동과 견주는 수치는 a16z의 추정에 있습니다. CUA의 시간당 비용이 $6~8(범위 $3~15)이고, 오프쇼어 BPO가 약 $10, 미국 백오피스가 $30~45라는 계산입니다 `Ⓥ`. 추론 비용에 재시도가 포함되어 있습니다. 실패한 시도도 토큰을 쓰기 때문입니다. 이 비교에서 읽을 점은 CUA가 사람보다 압도적으로 싸다는 것이 아닙니다. 싼 노동력과 같은 자릿수에서 경쟁한다는 것입니다. 같은 일을 API 한 번으로 끝낼 수 있으면 스텝도 이미지도 재시도도 없으므로, API와의 비용 격차가 훨씬 큽니다 `Σ`.

{{% details title="6절 근거 표" closed="true" %}}
| 항목 | 내용 | 출처 | 배지 |
|---|---|---|---|
| 이미지 토큰 공식 | ⌈w/28⌉ × ⌈h/28⌉. 1920×1080은 2,691토큰, 3840×2160은 2576×1449로 줄어 4,784토큰(문서 표). 1024×768=1,036, 1280×720=1,196, 1280×800=1,334, 1366×768=1,372는 공식으로 계산 | [Vision](https://platform.claude.com/docs/en/build-with-claude/vision) | ✓ / ≈ |
| 한도 | 고해상도 티어(Claude 4.7 이후) 긴 변 2,576px·4,784토큰(약 3.75MP), 이전 모델 1,568px·약 1.15MP. 툴셋은 초과 시 거부 | Vision, Computer use tool | ✓ |
| 해상도 권장 | 일반 데스크톱 1024×768·1280×720, 웹 앱 1280×800·1366×768, 1920×1080 초과 지양. quickstart README는 XGA 권장·XGA/WXGA 초과 지양. 일부 블로그·마이그레이션 문서에는 신모델에 1080p부터를 권한다는 문장도 있어 출처마다 기준 모델이 다름 | Computer use tool, [computer-use-demo](https://github.com/anthropics/claude-quickstarts/tree/main/computer-use-demo), [Best practices](https://claude.com/blog/best-practices-for-computer-and-browser-use-with-claude) | ✓ |
| 20장 규칙 | 요청당 이미지 20장 이하 권장 | Computer use tool | ✓ |
| 스텝당 입력 추정 | 1,334토큰 × 20장 ≈ 26,680토큰, $5/M이면 약 $0.133 (캐시 미적용) | 위 공식과 단가로 계산 | ≈ |
| 가지치기·캐싱 | 최근 3장 유지, 25장 단위, 약 150k 입력 토큰에서 compaction, 캐시 브레이크포인트 최대 4개(시스템·도구 뒤 1 + 최근 tool_result 3), 히트 시 입력 10% | Best practices, Computer use tool | ✓ |
| 생각 강도 | Opus 4.7 high ≈ max의 절반 출력 토큰으로 거의 최고 성공률. 4.6은 medium이 high의 절반 | Best practices | ✓ |
| StateAct | 코드 우선, 작업당 비용 약 1/9. GUI 서브에이전트는 108개 중 28개 과제에서만 호출. OSWorld 2.0 이진 20.6% → 26.9%, 부분 54.8% → 61.6% (Opus 4.8) | arXiv 2607.22798(aiweekly 요약) | Ⓑ |
| HAL 비용 | Online-Mind2Web 300과제: SeeAct+GPT-5 Medium $171.07(42.33%), Browser-Use+Claude Sonnet 4 $1,577.26(40%). 과제당 약 $0.57 / 약 $5.26 | HAL | Ⓑ ≈ |
| Holo4 비용 | OSWorld $0.08, OSWorld 2.0 $1.22(27B) / $0.61(35B-A3B). OSWorld 2.0 점수가 부분인지 이진인지 불명 | HF 모델 카드 | Ⓥ |
| 출력 토큰 | OSWorld 2.0 과제당 출력 토큰 Opus 4.8 약 244K, Opus 4.7 약 150K, GPT-5.5 약 39K. 평균인지 합인지 불명 | OSWorld 2.0 사이트 | ✓ ? |
| Copilot Studio | 표준 5 / 프리미엄 15 크레딧·스텝. 4스텝 20 / 60. 단가 $0.01(종량), 용량팩 $200/25,000(약 $0.008)은 3자 정리 | Computer use in Copilot Studio | ✓ / ? |
| a16z 비용 | CUA $6~8/시간(범위 $3~15), 오프쇼어 BPO 약 $10, 미국 백오피스 $30~45 | a16z | Ⓥ ≈ |
| 선언 오버헤드 | 약 4,500토큰. 구버전은 시스템 프롬프트 466~499 + 도구 정의 약 735 | Computer use tool | ✓ |
{{% /details %}}

## 7. 안전하게 쓰려면

### 7.1 화면에 있는 글자는 전부 입력이다

CUA는 사람이 아니라 모델이 화면을 읽습니다. 웹 페이지, 이미지, 문서 속의 문장이 사용자의 지시를 덮어쓸 수 있다는 뜻입니다. Anthropic과 OpenAI가 공통으로 경고하는 위협이고, 화면 기반 인젝션이 OWASP의 에이전트 애플리케이션 상위 위험 목록에서 목표 탈취(ASI01)에 해당합니다 `Σ`. 현실의 사고도 있었습니다. Brave가 공개한 Perplexity Comet 취약점에서는 페이지 내용이 이메일과 일회용 비밀번호(OTP)를 빼 가는 경로가 됐고, 스크린샷 속에 거의 보이지 않게 숨긴 글자까지 명령으로 처리됐습니다 `✓`.

수치는 벤더가 내놓은 것만 몇 개 봅니다. Anthropic은 2025-11에 Claude Opus 4.5를 적응형 공격자로 시험했을 때 인젝션 성공률이 약 1%라면서도 "1%도 의미 있는 위험"이라고 스스로 적었습니다 `Ⓥ`. 2026-08 Chrome GA 글에서는 전문 레드팀의 더 강한 공격 기준으로, 추가 방어 없이 모델에 도달한 공격의 성공률이 Opus 5에서 3.8%였고 탐지 probe와 분류기를 더하면 Sonnet 5·Opus 5·Mythos 5가 0%, Fable 5가 0.3%였습니다 `Ⓥ`. 학술 벤치마크 RedTeamCUA에서는 Claude 4.5 Sonnet의 공격 성공률이 60%로 가장 높았습니다 `Ⓑ`.

이 수치들은 측정 조건이 달라 같은 축에서 비교하면 안 됩니다. 공격자가 어떤 모델인지, 몇 번 시도했는지, 방어 계층을 포함했는지가 제각각입니다. "0.3%니까 안전하다"와 "60%니까 위험하다"는 둘 다 읽는 방법이 아닙니다. 읽을 수 있는 것은 벤더가 방어 계층(분류기, probe, 확인 단계)을 쌓아야 낮은 수치를 얻는다는 사실입니다.

### 7.2 벤더가 깔아 주는 것과 내가 깔아야 하는 것

벤더 제품은 확인 단계를 이미 넣어 두었습니다. 설계 철학은 조금씩 다릅니다.

- Claude in Chrome은 GA 이후 기본이 자동 승인입니다. Claude가 각 행동의 안전성을 검토하고 필요할 때만 멈춰 묻습니다. 설정에서 끄고 수동 승인으로 돌릴 수 있고, Enterprise 관리자는 사이트 allowlist·blocklist를 걸 수 있습니다 `✓`.
- 데스크톱 computer use는 앱마다 처음 접근할 때 허가를 묻고, 투자·트레이딩·암호화폐 앱은 기본 차단합니다 `✓`.
- Gemini API는 모델이 `require_confirmation`을 돌려주고, 금융 거래, 민감 데이터 수정, 메일·메시지 자율 발송, 계정 생성, 약관 동의 같은 일곱 가지 정책이 내장되어 있습니다 `✓`.
- Copilot Studio는 허용 사이트·앱 목록을 쓰는데, 목록은 앱을 여는 것은 막지 못하고 조작만 막는다고 문서가 적습니다. 유해 지시가 감지되면 지정한 검토자에게 메일을 보내고 응답 제한시간이 지나면 실행을 멈춥니다 `✓`.

API로 직접 만든다면 이 장치는 내가 직접 만들어야 합니다. 공식 문서들이 공통으로 권하는 운영 원칙을 모으면 이렇습니다.

- 전용 VM이나 컨테이너에서, 최소 권한 계정으로 돌립니다. 로그인 정보나 API 키 같은 민감 데이터를 직접 주지 않습니다 `✓`.
- 도메인은 허용 목록으로 제한하고, 리다이렉트 이후에도 같은 검사를 거치게 합니다. Anthropic은 이동 처리기에서 도메인 허용 목록을 강제하고, loopback·사설 대역과 `javascript:`·`file:`·`data:`·`chrome:` 스킴을 문자열 접두어가 아니라 URL 파서로 걸러내라고 적습니다 `✓`.
- 확인은 위험 행동 바로 직전에 받습니다. OpenAI 가이드는 구매, 데이터 전송, 파괴적 변경을 사용자 통제 아래 두고, 폼에 민감 정보를 입력하는 것도 전송으로 간주하라고 합니다. 확인 여부를 모델의 주장에 맡기지 말라고도 합니다 `✓`.
- 스텝, 시간, 비용에 상한을 두고 취소할 수 있게 합니다 `✓`.
- 스크린샷과 행동 로그를 남깁니다. 세션 전체를 영상처럼 되감는 리플레이를 기본 기능으로 명시한 1차 문서는 찾지 못했습니다 `?`.
- 결과를 사후 검증합니다. 모델이 "끝났다"고 한 말은 증거가 아닙니다.

참고 구현을 그대로 운영에 쓰면 안 된다는 경고도 곳곳에 있습니다. Playwright MCP README는 스스로 "보안 경계가 아니다"라고 적습니다 `✓`. OpenAI 샘플 앱의 Python 판은 사용자 권한으로 샌드박스 없이 실제 마우스와 키보드를 잡습니다 `✓`. Anthropic의 quickstart 데모도 에이전트 루프가 조작 대상 컨테이너 안에서 돌고 한 번에 한 세션만 가능한 최소 참조 구현이라고 밝힙니다 `✓`. 또 Copilot Studio에서 에이전트를 공유할 때 기본값인 제작자 자격증명을 그대로 두면 받는 사람이 제작자 권한으로 행동한다고 문서가 경고합니다 `✓`.

2FA와 OTP를 에이전트에 넘기는 것에 대한 명시 정책은 찾지 못했습니다 `?`. 앞서 본 Comet 사례가 반례로 읽힙니다. 이 두 가지는 사람이 쥐고 있는 편이 안전합니다 `Σ`.

{{% details title="7절 근거 표" closed="true" %}}
| 항목 | 내용 | 출처 | 배지 |
|---|---|---|---|
| Claude for Chrome 파일럿 | 123 케이스·29 시나리오, 완화책 없는 자율 모드 23.6% → 완화 후 11.2%. 브라우저 특화 공격 4종 35.7% → 0%. 123/29는 2차 요약에서 나옴 | [Claude for Chrome](https://claude.com/blog/claude-for-chrome) | Ⓥ |
| 인젝션 방어 연구 | Opus 4.5, 내부 적응형 Best-of-N 공격자(환경당 100회 시도) 약 1%. 방어 3축: RL 견고성 학습, 비신뢰 콘텐츠 분류기 스캔, 사람 레드팀 | [Prompt injection defenses](https://www.anthropic.com/research/prompt-injection-defenses) | Ⓥ |
| Chrome GA | 전문 레드팀 기준, 추가 방어 없이 도달한 공격 성공률 Opus 5 3.8%. probe+분류기 적용 시 Sonnet 5·Opus 5·Mythos 5 0%, Fable 5 0.3%. 성공한 공격은 모두 저심각도 시나리오. Opus 4.5 수치는 17.6%와 16.7%가 갈려 본문에서 뺌 | Claude in Chrome GA | Ⓥ |
| 지원 문서 수치 | 현재 구성의 내부 테스트 성공률 0.08% 미만. 측정 모델·조건 불명 | [Using Claude in Chrome safely](https://support.claude.com/en/articles/12902428-using-claude-in-chrome-safely) | ✓ ? |
| RedTeamCUA | RTC-Bench 864건, 성공률 Claude 3.7 Sonnet 42.9%, Claude 4.5 Sonnet 60%(최고), Operator 7.6%(최저). 시도율 최대 92.5% | [RedTeamCUA](https://arxiv.org/abs/2505.21936) | Ⓑ |
| ChatGPT agent 저항률 | 무관 지시(텍스트 브라우저) 99.5%, 무관 지시(시각 브라우저) 95%, 맥락 내 데이터 유출 78%, 능동 유출 67% | ChatGPT agent system card | ✓ |
| Comet | 2025-07-25 제보, 이틀 뒤 1차 수정. 이메일·OTP 유출 가능성 | [Brave](https://brave.com/blog/comet-prompt-injection/) | ✓ |
| Gemini 안전 | 정책 7종(`FINANCIAL_TRANSACTIONS`, `SENSITIVE_DATA_MODIFICATION`, `COMMUNICATION_TOOL`, `ACCOUNT_CREATION`, `DATA_MODIFICATION`, `USER_CONSENT_MANAGEMENT`, `LEGAL_TERMS_AND_AGREEMENTS`). 인젝션 탐지는 기본 꺼짐 | Gemini API Computer Use | ✓ |
| 브라우저 툴셋 권고 | 새 프로필(자격 증명 없음), navigate 핸들러의 허용 목록, loopback·사설 대역 차단, 위험 스킴은 URL 파서로 거부 | Browser use tool | ✓ |
| OpenAI 가이드 | 격리 브라우저/VM + 허용 목록, 화면 콘텐츠는 비신뢰 입력, 위험 지점에서 확인(모델 주장에 의존 금지), 단계·시간·비용 상한 | Computer use 가이드 | ✓ |
| Copilot Studio | 허용 목록은 열기를 막지 못하고 조작만 막음. Human supervision 메일. 기본 제작자 자격증명 공유 경고. 머신 권고: 전용 머신, 최소 권한, Intune으로 Edge 허용 목록, App Control | Computer use in Copilot Studio | ✓ |
| 참조 구현 한계 | Playwright MCP "not a security boundary"(`--isolated`, `--allowed-origins`). 샘플 앱 샌드박스 없음. quickstart 한 번에 한 세션 | 각 README | ✓ |
| CAPTCHA 금지 | Claude in Chrome 지원 문서, Gemini 블로그 | 각 문서 | ✓ |
| OWASP | Top 10 for Agentic Applications 2026, ASI01 Agent Goal Hijack. 보안 벤더 해설로 확인, 원문은 미확인 | 해설 기사 | Σ |
{{% /details %}}

## 8. 직접 써보기

혼자 시험해 볼 수 있는 경로를 네 가지로 추렸습니다. 전제, 비용, 주의점을 같이 적습니다.

### 8.1 Anthropic computer-use-demo (Docker)

가장 직접적인 체험입니다. Docker와 `ANTHROPIC_API_KEY`(또는 Bedrock·Vertex 설정)가 있으면 Linux 데스크톱이 들어 있는 컨테이너를 띄우고, 그 안에서 에이전트가 화면을 조작하는 모습을 브라우저로 볼 수 있습니다. 이미지는 `ghcr.io/anthropics/anthropic-quickstarts:computer-use-demo-latest`이고, 포트는 8080이 통합 UI, 6080이 noVNC, 5900이 VNC, 8501이 Streamlit입니다. `WIDTH`와 `HEIGHT` 환경 변수로 해상도를 정하며 README는 XGA(1024×768)를 권합니다 `✓`.

비용은 API 종량제이고 대부분 스크린샷 토큰입니다. 기본 모델이 Claude Opus 4.8로 표기돼 있는데 README 갱신이 늦었을 수 있으니 실제 설정을 확인합니다 `✓`. 컨테이너 안의 Linux 데스크톱이라 격리는 쉽지만, 공개 포트에 인증 없이 열지 않도록 합니다 `≈`. 참조 구현이지 운영용이 아닙니다.

### 8.2 Claude in Chrome

설치가 가장 쉽습니다. Chrome 전용이고 유료 플랜(Pro·Max·Team·Enterprise)이 필요하며 다른 Chromium 계열 브라우저와 모바일은 지원하지 않습니다 `✓`. 비용은 구독에 포함됩니다. 예약 작업, 워크플로 녹화, Claude Code 연동을 지원하고 2026-08-26에 GA가 됐습니다 `✓`.

주의할 점은 내 로그인 세션이 그대로 쓰인다는 것입니다. 안전 지원 문서는 연구나 폼 작성 같은 단순한 작업부터 시작하라고 권하고, 금융·법률·의료·민감한 업무 계정은 피하라고 합니다 `✓`. 별도 브라우저 프로필을 쓰는 편이 안전합니다.

### 8.3 Playwright MCP + 코딩 에이전트

플랫폼 엔지니어가 가장 빨리 가치를 볼 경로로 추천합니다 `Σ`. Node.js가 있으면 `claude mcp add playwright npx @playwright/mcp@latest` 한 줄로 코딩 에이전트에 붙습니다. 접근성 스냅샷이 기본이라 픽셀을 쓰지 않고, 좌표 클릭이 필요하면 `--caps vision`으로 옵트인합니다 `✓`. 배포 뒤 UI 스모크 확인이나 대시보드 점검을 코딩 에이전트 안에서 시험해 볼 수 있습니다. 이 글의 판단 기준에서 "접근성 트리 먼저"에 해당하는 도구이기도 합니다.

비용은 코딩 에이전트 구독이나 API에 포함됩니다. 주의점은 앞서 본 대로 보안 경계가 아니라는 점입니다. `--isolated`, `--allowed-origins`·`--blocked-origins`, `--storage-state`로 세션과 범위를 따로 제한합니다. README는 코딩 에이전트라면 MCP보다 Playwright CLI와 스킬 조합이 토큰 효율이 나을 수 있다고도 안내합니다. 큰 도구 스키마와 긴 접근성 트리를 컨텍스트에 싣지 않기 때문입니다 `✓`.

### 8.4 Browser Use + 로컬 모델

비용을 0에 가깝게 해 보고 싶다면 Browser Use와 Ollama 조합입니다. Python 3.12와 uv를 쓰는 설치 순서가 `uv pip install browser-use`, `uvx browser-use install`이고, 모델은 `ChatOllama(model="qwen3-vl:8b")`처럼 붙입니다. 최소 사양은 VRAM 8GB에 8B 모델, 안정권은 24GB 이상에 30B급입니다 `Ⓥ`. `num_ctx`를 32768로, 타임아웃을 120초로 올리고, 비전이 없는 모델이면 `use_vision=False`를 줍니다. 공식 문서의 예시는 `llama3.1:8b`입니다 `✓`.

기대치는 낮춰야 합니다. 한 블로그의 비독립 관찰로는 8B 모델이 단순한 조회는 대체로 성공하고, 다단계 검색·비교와 로그인·팝업이 끼면 대부분 실패하며, 작은 모델이 잘못된 JSON 액션 스키마를 냅니다. Ollama 비전 모델의 잘못된 JSON 문제는 2026-08 기준 미해결이라고 합니다 `Ⓥ`. 로컬 소형 모델은 데모 수준이라고 보는 것이 맞습니다.

{{% details title="8절 근거 표" closed="true" %}}
| 항목 | 내용 | 출처 | 배지 |
|---|---|---|---|
| computer-use-demo | 포트 8080(통합 UI)·6080(noVNC)·5900(VNC)·8501(Streamlit), `WIDTH`/`HEIGHT`, XGA 권장, 기본 모델 표기 Opus 4.8(README 갱신 지연 가능) | computer-use-demo README | ✓ |
| Claude in Chrome 요건 | Chrome 전용, 유료 플랜, 디버거 권한. 예약 작업·워크플로 녹화·Claude Code 연동 | [시작하기](https://support.claude.com/en/articles/12012173-getting-started-with-claude-for-chrome) | ✓ |
| Playwright MCP | 접근성 스냅샷 기본, `--caps vision`, "not a security boundary", `--isolated`·`--allowed-origins`·`--storage-state`, CLI+스킬 권장 | [playwright-mcp](https://github.com/microsoft/playwright-mcp) | ✓ |
| Browser Use + Ollama | 설치 순서, `ChatOllama`, 8GB VRAM+8B 최소·24GB+30B 안정, 8B는 단순 조회만 | [Browser Use 모델 문서](https://docs.browser-use.com/customize/supported-models) ✓, 개인 블로그(2026-09-06) Ⓥ | ✓ / Ⓥ |
{{% /details %}}

## 9. 언제 CUA를 쓰고 언제 쓰지 않나

앞 절들을 한 장으로 묶으면 위에서 아래로 내려가는 사다리가 됩니다. 위 단계로 풀리면 아래로 내려가지 않습니다.

| 단계 | 쓰는 때 | 근거 |
|---|---|---|
| API·CLI 에이전트 | API나 CLI가 있을 때. 화면이 필요 없다 | SRE 에이전트 제품은 API·CLI·로그로 동작한다. 관리형 경로가 있는 일은 CUA 대상이 아니다 |
| 접근성 트리·DOM | 화면은 필요하지만 웹이고 구조가 읽힐 때 | 비전 모델이 필요 없고 토큰이 적다. 웹 안에서 끝나는 일은 브라우저 툴셋·Playwright MCP |
| 코드 우선 | 화면의 상태를 코드로 읽고 쓸 수 있을 때 | OpenAI의 code execution 권고, StateAct의 비용 약 1/9 |
| 픽셀 CUA | 위가 모두 막혔을 때. 레거시 데스크톱, 캔버스, 원격 데스크톱, API가 없는 포털 | a16z의 운영 사례도 결정적 자동화가 깨질 때의 대체 경로로 쓴다 |

사다리의 마지막 칸으로 내려오더라도 몇 가지를 더 물어봅니다.

- 얼마나 자주 하는 일인가. 월에 한 번 하는 클릭 작업은 하네스를 짜는 비용을 회수하지 못합니다. 반대로 하루 천 건 단위로 반복되면 이야기가 달라집니다.
- 틀렸을 때 되돌릴 수 있는가. 되돌릴 수 없는 행동은 사람 확인이 필요하고, 사람 확인이 필요하면 완전 자동의 이점이 줄어듭니다.
- 사람이 3분에 하는 일을 에이전트가 10분 걸려도 괜찮은가. 백그라운드로 돌려도 되는 일이어야 합니다.
- 결과를 기계적으로 검증할 수 있는가. 그럴듯한 오독이 가장 비싼 실패입니다.
- 로그인, 2FA, CAPTCHA를 사람에게 넘길 수 있는가. 넘길 수 없다면 처음부터 대상이 아닙니다.

반대로 CUA가 맞는 자리의 모양도 비슷합니다. API가 없는 외부 포털을 반복 처리하는 백오피스, 지연이 중요하지 않은 UI 테스트, 사람이 곁에서 승인해 주는 개인 생산성 작업입니다. 플랫폼·SRE 팀에서는 API 없는 벤더 포털의 저빈도 작업과 배포 뒤 화면 검증이 후보로 남습니다. 그 외의 일, 곧 쿠버네티스를 만지고 인증서를 갱신하고 알림을 처리하는 일은 이미 API와 CLI가 있어서 CUA를 거칠 이유가 없습니다 `Σ`.

제품을 고를 때는 하나를 더 적습니다. 이 영역은 벤더가 도구 형식을 바꾸는 속도가 빠릅니다. Anthropic은 새 모델부터 구형 도구 타입을 거부하기 시작했고 `✓`, OpenAI는 같은 API 안에서도 권장 방식을 코드 실행으로 옮기고 있습니다 `✓`. 하네스를 짤 때 특정 벤더의 도구 형식에 로직을 묶지 말고 얇은 어댑터로 감싸 두면 갈아탈 비용이 줄어듭니다 `Σ`.

## 10. 확인하지 못한 것

- OpenAI 1차 문서(openai.com, help.openai.com)가 이 조사 환경에서 403이었습니다. ChatGPT agent·Work의 제품 설명, Operator 출시일, takeover·watch mode 원문, 플랜별 사용 한도는 2차 출처로만 봤습니다. GPT-6 Astra와 GPT-6.1 Sol의 출시일과 OSWorld 2.0 수치도 2차입니다.
- Claude in Chrome GA 글의 Opus 4.5 수치가 17.6%인지 16.7%인지 조사 중 페치 결과가 갈렸습니다. 그래서 본문에서 뺐습니다.
- 플랫폼·SRE 업무에 CUA를 실제로 쓴 공개 사례와 수치가 없습니다. 찾은 SRE 에이전트는 모두 API·CLI 기반이었습니다. 고객지원(상담원 화면 조작)과 QA 전용 SaaS의 정량 사례도 없었습니다.
- OSWorld 2.0·2.1에서 신형 모델(Opus 5.5, Fable 5.1, GPT-6 계열)의 이진 완료율, Holo4-27B의 61.7%와 Simular Sai 73%가 부분인지 이진인지 확인하지 못했습니다. 과제당 출력 토큰 244K가 평균인지 합인지도 모릅니다.
- StateAct 논문(arXiv 2607.22798) 원문은 보지 못했고 요약 기사로만 확인했습니다. Opus 5 시스템 카드의 인젝션 수치도 2차 보도에서만 봤습니다.
- 로그인과 2FA의 실패율에 대한 정량 연구, 2FA·OTP를 에이전트에 넘기는 것에 대한 벤더의 명시 정책을 찾지 못했습니다.
- Copilot Credit 단가의 Microsoft 1차 가격 페이지, Windows agent workspace의 현재 상태, Bedrock의 5.5 모델 도구 형식 허용 범위가 확인되지 않았습니다.
- Anthropic quickstart의 저장소 이름이 자료마다 `claude-quickstarts`와 `anthropic-quickstarts`로 갈립니다. Docker 이미지 이름과 현행 명령은 README에서 다시 확인해야 합니다.

## 참고 자료

- [Computer use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) — Anthropic, 상시 갱신(2026-10-06 확인) `✓`
- [Browser use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool) — Anthropic, 상시 갱신(2026-10-06 확인) `✓`
- [Vision](https://platform.claude.com/docs/en/build-with-claude/vision) — Anthropic, 상시 갱신(2026-10-06 확인) `✓`
- [Best practices for computer and browser use with Claude](https://claude.com/blog/best-practices-for-computer-and-browser-use-with-claude) — Anthropic, 2026-05-13 `✓`
- [Claude in Chrome is now generally available](https://claude.com/blog/claude-in-chrome-generally-available) — Anthropic, 2026-08-26 `Ⓥ`
- [Claude for Chrome](https://claude.com/blog/claude-for-chrome) — Anthropic, 2025-08-25 `Ⓥ`
- [Prompt injection defenses](https://www.anthropic.com/research/prompt-injection-defenses) — Anthropic Research, 2025-11-24 `Ⓥ`
- [Using Claude in Chrome safely](https://support.claude.com/en/articles/12902428-using-claude-in-chrome-safely) — Claude Help Center `✓`
- [Computer use demo (claude-quickstarts)](https://github.com/anthropics/claude-quickstarts/tree/main/computer-use-demo) — Anthropic, GitHub, 2026-09-30 갱신 `✓`
- [Computer use guide](https://developers.openai.com/api/docs/guides/tools-computer-use) — OpenAI API Docs `✓`
- [openai-cua-sample-app](https://github.com/openai/openai-cua-sample-app) — OpenAI, GitHub, 2026-09-04 갱신 `✓`
- [ChatGPT agent system card](https://deploymentsafety.openai.com/chatgpt-agent) — OpenAI, 2025-07-17 `✓`
- [Gemini API Computer Use](https://ai.google.dev/gemini-api/docs/computer-use) — Google AI for Developers, 2026-10-01 수정 `✓`
- [Introducing the Gemini 2.5 Computer Use model](https://blog.google/technology/google-deepmind/gemini-computer-use-model/) — Google DeepMind, 2025-10-07 `Ⓥ`
- [Computer use in Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/computer-use) — Microsoft Learn, 2026-09-18 갱신 `✓`
- [Amazon Nova Act GA 발표](https://aws.amazon.com/blogs/aws/build-reliable-ai-agents-for-ui-workflow-automation-with-amazon-nova-act-now-generally-available) — AWS, 2025-12-02 `Ⓥ`
- [Can agents use a computer yet? We've got the data](https://a16z.com/can-agents-use-a-computer-yet-weve-got-the-data/) — a16z, 2026-08-10 `Ⓥ`
- [OSWorld: Benchmarking Multimodal Agents for Open-Ended Tasks in Real Computer Environments](https://arxiv.org/abs/2404.07972) — Xie 외, arXiv:2404.07972, 2024-04-11 `✓`
- [OSWorld-Verified 공식 결과](http://osworld-v1.xlang.ai/) — XLANG Lab, 시트 최종 2026-08-01 `Ⓑ`
- [OSWorld 2.0](https://osworld-v2.xlang.ai/) — XLANG Lab, 2026-06-26 `Ⓑ`
- [OSWorld-Human](https://arxiv.org/abs/2506.16042) — arXiv:2506.16042, v2 2026-05-18 `Ⓑ`
- [Online-Mind2Web (HAL)](https://benchmarklist.com/benchmarks/hal_online_mind2web/) — benchmarklist.com, 2026-07-22 갱신 `Ⓑ`
- [RedTeamCUA](https://arxiv.org/abs/2505.21936) — arXiv:2505.21936, v5 2026-03-01 `Ⓑ`
- [Perplexity Comet 프롬프트 인젝션](https://brave.com/blog/comet-prompt-injection/) — Brave, 2025 `✓`
- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) — Microsoft, GitHub, 2026-09-28 갱신 `✓`
- [Browser Use 지원 모델](https://docs.browser-use.com/customize/supported-models) — Browser Use Docs `✓`
