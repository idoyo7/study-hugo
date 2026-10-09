---
title: "04 Computer Use Agent — 어디에 쓰고 어디엔 쓰지 않나"
description: "CUA의 동작 원리, 제품·API 지형, 실제 쓰이는 곳과 한계, 안전하게 쓰는 법을 2026-10-06 기준으로 정리하고 API·접근성 트리·픽셀 중 무엇을 먼저 쓸지 판단 기준을 제시한다."
date: 2026-10-06
lastmod: 2026-10-06
weight: 4
url: "/ai-tools/04-computer-use-agents/"
---

# 04 · Computer Use Agent — 어디에 쓰고 어디엔 쓰지 않나

## 1. CUA를 고르기 전에 확인할 것

자동화할 일에 API가 있으면 API부터 씁니다. 화면을 다뤄야 해도 접근성 트리(UI 요소의 역할과 상태를 표현한 트리)나 코드로 처리할 수 있는지 먼저 확인합니다. 화면의 픽셀을 읽고 클릭하는 CUA는 그 경로가 막혔을 때 검토할 마지막 수단입니다.

CUA(Computer Use Agent)는 화면을 보고 마우스와 키보드 같은 입력 수단으로 소프트웨어를 조작하는 에이전트입니다. 스크린샷에서 다음 행동을 정하고, 행동한 뒤 바뀐 화면을 다시 봅니다. API가 없는 포털과 데스크톱 앱도 사람이 쓰는 인터페이스로 다룰 수 있습니다. 이 범용성 때문에 관심을 끌지만, 같은 일을 API로 끝낼 수 있다면 느리고 비싼 화면 조작을 택할 이유가 없습니다. CUA의 경제성은 API가 없거나 막힌 곳에서 나옵니다.

화면을 읽는 모델만 있으면 곧바로 자동화가 되는 것은 아닙니다. Anthropic API의 computer use는 클라이언트 측 도구입니다. 개발자가 가상 머신이나 컨테이너를 띄우고 스크린샷을 보내면, 모델은 실행할 행동을 요청합니다. 실제 입력을 보내고 다음 화면을 돌려주는 일은 하네스(모델 바깥에서 도구 실행과 반복을 관리하는 코드)가 맡습니다.

워크플로우와 에이전트의 차이, 하네스의 역할은 [03 에이전트 개념 정리]({{< relref "/engineering/ai-tools/03-agent-concepts/_index.md" >}})에서 다뤘습니다. CUA도 같은 에이전트이며, 사용하는 도구가 화면 조작이라는 점이 달라집니다. 비슷한 자동화와 비교하면 선택 기준이 더 분명해집니다.

- RPA는 미리 정한 화면 좌표나 셀렉터를 따르는 결정적 자동화입니다. 화면이 바뀌면 깨집니다. CUA는 매번 화면을 읽고 판단하므로 변화에 덜 취약하지만 느리고 비쌉니다.
- API 에이전트는 화면을 거치지 않고 함수나 CLI를 직접 호출합니다. API로 처리되는 일에는 화면이 필요 없습니다.
- Playwright 같은 브라우저 자동화 라이브러리는 사람이 작성한 스크립트를 실행합니다. 여기에 모델의 판단을 더하면 브라우저 에이전트가 됩니다.

이 글은 플랫폼 엔지니어, SRE, 개발자가 CUA를 어디에 쓸지 판단하는 데 필요한 사례와 제약을 살펴봅니다. 제품이 화면을 얼마나 잘 읽는지보다, 내 업무에 화면 조작이 필요한지부터 따져보려는 글입니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `Ⓑ` 공개 벤치마크 · `≈` 추정·계산 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 수치와 조건을 모았습니다. 조사 기준일은 2026-10-06입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 클라이언트 측 도구 | Anthropic API의 computer use는 개발자가 환경을 띄우고 행동을 실행하는 방식. 모델은 스크린샷을 보고 행동을 요청 | Anthropic API | `✓` |
| 조사 기준일 | 2026-10-06 | — | — |

{{% /details %}}

## 2. 모델은 화면을 보고, 하네스는 행동을 실행한다

### 2.1 화면 조작 루프를 누가 책임지나

아래 도식은 화면을 관찰하고 행동하는 반복 과정과, 그 과정 바깥에서 실행을 검사하는 장치를 보여줍니다.

{{< flow src="_flow/2-관찰-추론-행동-루프.json" />}}

CUA를 구현할 때 개발자가 만드는 것은 이 반복 과정입니다. 환경에서 화면을 캡처해 모델에 보내고, 모델이 요청한 행동을 실행한 뒤, 결과 화면을 다시 전달합니다. 실행 순서와 좌표 변환은 하네스가 맡습니다.

행동의 범위는 도구 정의가 정합니다. Anthropic의 `computer_toolset_20260801`에는 `screenshot`, `zoom`, 여러 종류의 클릭, `left_click_drag`, `type`, `key`, `scroll`, `wait`를 포함한 멤버 도구 17개가 있습니다. 모델이 내놓는 좌표는 전달받은 스크린샷 기준입니다. 따라서 화면 배율이나 이미지 크기를 바꿨다면 실제 입력 좌표도 그에 맞게 변환해야 합니다. macOS Retina처럼 화면 배율이 2인 환경에서는 좌표를 절반으로 나누거나 스크린샷을 줄여서 보냅니다.

왕복을 줄이는 배치 액션도 지원합니다. 클릭과 타이핑처럼 이어서 실행할 행동을 한 응답에 담는 방식입니다. 하네스는 순서대로 실행하다 첫 실패에서 멈추고, 나머지 블록에 `Not executed`를 반환합니다. 앞 행동의 결과 화면을 봐야 다음 행동을 정할 수 있다면 배치로 묶을 수 없습니다. 작은 글씨를 읽거나 요소가 밀집한 곳을 확인할 때는 `zoom`으로 해당 영역을 원해상도로 다시 봅니다.

모델 바깥에는 프롬프트 인젝션(외부 콘텐츠의 지시가 모델의 행동을 바꾸는 공격)을 검사하는 장치도 필요합니다. Anthropic API는 도구 결과를 스캔하는 분류기를 기본으로 켜 둡니다. 의심스러운 지시를 발견하면 사용자에게서 나온 지시인지 확인하도록 모델을 유도합니다. 벤더별로 무엇을 검사하고 어디서 멈추는지는 7절에서 살펴봅니다.

웹 페이지 안에서 끝나는 작업은 전용 도구를 쓸 수 있습니다. Anthropic의 `browser_toolset_20260801`은 요소 참조와 접근성 트리를 사용하며, `javascript_exec`·`file_upload` 같은 위험한 도구는 기본으로 꺼져 있습니다. 데스크톱 전체를 조작해야 하는지, 브라우저만 다루면 되는지에 따라 처음부터 도구 선택이 달라집니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 클라이언트 측 도구 | 환경(VM·컨테이너·데스크톱)은 개발자가 띄우고 Anthropic은 호스팅하지 않음 | [Computer use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) | `✓` |
| 툴셋 구성 | `computer_toolset_20260801` 멤버 17개, `configs`로 멤버별 on/off | 같은 문서 | `✓` |
| 브라우저 툴셋 | `browser_toolset_20260801` 멤버 31개(기본 활성 27, 옵션 4: `file_upload`·`read_console`·`read_network`·`javascript_exec`) | [Browser use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool) | `✓` |
| 좌표 | 보낸 스크린샷의 픽셀 공간 기준, 클라이언트가 역스케일. Retina DPR 2 | Computer use tool | `✓` |
| 배치 액션 | 순서대로 실행, 첫 실패에서 중단, 나머지는 `Not executed` 고정 문구. 왕복·지연 감소를 정량으로 주장하는 문장은 문서에 없음 | 같은 문서 | `✓` |
| 분류기 | 도구 결과를 스캔해 인젝션 의심 시 사용자 확인을 유도. 지원팀 요청으로 끌 수 있음 | 같은 문서 | `✓` |
| 배치 액션의 조건 | 앞 행동이 바꾼 화면에 뒤 행동이 의존한다면 배치로 묶지 않음 | — | `✓` |
| 영역 확대 | 작은 글씨나 밀집한 화면은 `zoom`으로 영역을 원해상도로 다시 확인 | — | `✓` |

{{% /details %}}

### 2.2 화면을 어떤 형태로 전달할 것인가

| 방식 | 장점 | 단점 |
|---|---|---|
| 픽셀(스크린샷만) | 앱 종류와 무관하다. 캔버스, 원격 데스크톱, 게임까지 사람과 같은 인터페이스로 본다 | 좌표 오차, 이미지 토큰 비용, 작은 요소 판독 한계 |
| 접근성 트리·DOM | 요소를 결정적으로 가리킨다. 비전 모델이 필요 없고 토큰이 적다 | 트리가 없거나 부정확한 앱(캔버스, 일부 데스크톱 앱)에서 무력하다. 트리 자체가 길 수 있다 |
| 하이브리드(스크린샷+트리, Set-of-Mark) | 트리 좌표로 번호 박스를 그려 "몇 번을 눌러라"로 좌표 문제를 피한다 | 트리 품질에 종속되고 입력이 길어진다 |

웹 페이지의 DOM(문서를 객체 트리로 표현한 모델)이나 접근성 트리를 읽을 수 있다면, 요소를 좌표 대신 참조로 지정할 수 있습니다. 캔버스나 일부 데스크톱 앱처럼 트리가 없거나 부정확한 곳에서는 스크린샷이 필요합니다. 둘을 함께 보내는 Set-of-Mark는 요소에 번호를 표시해 좌표를 직접 고르는 문제를 줄입니다.

모델의 화면 판독 능력은 크게 달라졌습니다. 2024년 OSWorld 원 논문에서는 스크린샷만 받은 GPT-4V보다 접근성 트리를 받은 GPT-4가 더 높은 점수를 냈습니다. 현재 OSWorld-Verified 공식 시트의 상위 20개 행은 모두 별도의 접근성 트리 없이 스크린샷을 사용합니다.

이 변화와 도구 선택은 구분해야 합니다. 같은 상위권에는 GUI(그래픽 사용자 인터페이스) 조작과 함께 코드 실행을 허용한 결과가 상당수 있습니다. 스크린샷을 입력으로 받았다는 사실만으로 모든 과제를 픽셀 클릭으로 해결했다고 볼 수는 없습니다.

### 2.3 무엇을 할지와 어디를 누를지를 나누는 방법

클릭할 위치를 찾는 grounding을 별도 모델에 맡기는 설계가 있습니다. 상위 모델이 작업을 계획하고, grounding 모델이 좌표를 찾습니다. Agent S3의 권장 구성은 주 에이전트 GPT-5와 grounding 모델 UI-TARS-1.5-7B입니다. UI-TARS와 Fara처럼 한 모델이 생각과 좌표를 함께 내는 통합형도 있습니다.

분리형 설계가 겨냥한 문제는 클릭 오차입니다. OSWorld의 2024년 실패 분석에서는 마우스 클릭 부정확이 실패 사례의 75% 이상에 포함됐습니다. 계획이 맞아도 엉뚱한 위치를 누르면 다음 단계로 나아갈 수 없습니다.

최근 구현은 클릭을 더 잘하는 데서 한발 더 나아갑니다. OpenAI 샘플 앱은 모델이 Playwright나 PyAutoGUI 코드를 작성해 소프트웨어를 조작하는 방식을 기본으로 삼습니다. OpenAI 가이드도 GPT-6 Astra에는 code execution을 권장하며, `computer` 도구 지원은 유지합니다. H Company는 Holo4가 코드를 작성하고 MCP 서버와 REST API까지 직접 호출한다고 소개합니다. 화면 조작이 필요하더라도 코드와 API를 함께 쓰는 흐름입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| OSWorld 2024 관찰 방식 비교 | 스크린샷만 GPT-4V 5.26% / a11y 트리 GPT-4 12.24% / 스크린샷+a11y GPT-4V 12.17% / SoM GPT-4V 11.77% | [OSWorld](https://arxiv.org/abs/2404.07972) | `✓ Ⓑ` |
| a11y 트리 길이 | a11y 관찰 90%를 담으려면 약 6,000토큰 | 같은 논문 | `✓` |
| 공식 시트 상위 | 상위 20개 행 모두 "Additional a11y tree used = No". 상위 상당수는 "coding-based action = Yes" | [OSWorld-Verified 공식 시트](http://osworld-v1.xlang.ai/) | `Ⓑ` |
| 클릭 오차 | 실패 550건 중 75% 이상에 마우스 클릭 부정확 | OSWorld 논문 v2 | `✓` |
| Agent S3 구성 | 주 에이전트 GPT-5 + grounding UI-TARS-1.5-7B | [Agent-S README](https://github.com/simular-ai/Agent-S) | `Ⓥ` |
| OpenAI 방향 | 샘플 앱은 Playwright JS 또는 PyAutoGUI Python 런타임에서 모델이 코드로 조작. GPT-6 Astra에는 code execution 권장 | [openai-cua-sample-app](https://github.com/openai/openai-cua-sample-app), [Computer use 가이드](https://developers.openai.com/api/docs/guides/tools-computer-use) | `✓` |
| Holo4 | 코드 작성, MCP·REST API 직접 호출 (발표 보도, 2026-09-28) | H Company 발표 보도 | `Ⓥ` |
| OpenAI 도구 지원 | GPT-6 Astra에 code execution을 권장하면서 `computer` 도구도 계속 지원 | OpenAI 문서 | `✓` |

{{% /details %}}

## 3. 제품을 고를 때는 실행 위치와 기본 설정부터 본다

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

제품 선택은 누가 실행 환경을 마련할지에서 시작합니다. 직접 환경을 띄우고 하네스를 만들려면 API를 씁니다. 브라우저나 데스크톱을 바로 조작하려면 완성된 제품을 고를 수 있고, 코드 없이 업무 에이전트를 구성하려면 업무 자동화 플랫폼을 검토할 수 있습니다. 표는 2026-10-06 기준입니다.

같은 computer use라는 이름이어도 안전장치의 기본값은 다릅니다. Gemini API의 인젝션 탐지는 기본으로 꺼져 있어 `enable_prompt_injection_detection`으로 켜야 합니다. Anthropic API는 기본으로 켜져 있고, 끄려면 지원팀에 요청해야 합니다. 익숙한 제품의 설정을 다른 API에도 그대로 기대해서는 안 되는 이유입니다.

기존 Anthropic 코드를 옮긴다면 모델 교체보다 도구 형식을 먼저 확인해야 합니다. Opus 5.5와 Sonnet 5.5는 Claude API와 Google Cloud에서 툴셋 형식만 받습니다. `computer_20251124`를 보내면 400 오류가 납니다. 마이그레이션에는 `tools` 항목 교체, 결과마다 `toolset_name` 반환, 스크린샷 직접 리사이즈가 포함됩니다. Bedrock에서 5.5 모델이 이전 형식을 받는지는 자료의 서술이 엇갈려 재확인이 필요합니다.

OpenAI는 API와 제품 설명의 확인 수준이 다릅니다. API 가이드와 모델 문서는 developers.openai.com에서 직접 확인했습니다. ChatGPT agent·Work 관련 1차 페이지 일부는 조사 환경에서 403으로 막혀 제품 설명은 2차 보도에 의존했습니다. 플랜별 사용 한도도 확인하지 못했습니다.

가중치가 공개된 모델을 직접 띄우는 선택지도 있습니다. OSWorld-Verified 공식 시트의 오픈 웨이트 최고 점수는 Holo3-35B-A3B의 82.56%입니다. 같은 회사의 모델도 라이선스는 다릅니다. Holo4-27B는 비상업 라이선스인 CC-BY-NC-4.0이고, Holo4-35B-A3B는 Apache-2.0입니다. Microsoft는 Fara1.5를 스크린샷만으로 웹을 조작하는 소형 모델로 소개합니다. 공개 점수는 모델마다 다른 하네스와 스텝 한도에서 나온 결과이므로, 가중치를 내려받는 것만으로 같은 성능이 보장되지는 않습니다.

브라우저를 실행할 자리도 별도로 살 수 있습니다. Browserbase는 에이전트용 클라우드 Chromium을 시간제로 제공하고, Browser Use Cloud도 브라우저 사용 시간에 과금합니다. 두 서비스가 공개한 가격은 아래에 모았습니다. 이 비용은 모델 사용료와 별개입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 툴셋 전환 | Claude API·Google Cloud에서 Opus 5.5·Sonnet 5.5는 툴셋만 받음. `computer_20251124`는 400. Bedrock 5.5의 이전 형식 허용 여부는 서술이 엇갈림 | Computer use tool, Claude API 마이그레이션 가이드(로컬 번들) | `✓ / ≈` |
| 선언 오버헤드 | 툴셋 기본 선언 시 입력 약 4,500토큰(모델별 4,520·4,590). zoom 끄면 약 410토큰 감소 | Computer use tool | `✓` |
| Claude in Chrome | 2026-08-26 GA, 기본 자동 승인, Enterprise는 allowlist·blocklist, 모든 유료 플랜에 포함 | [Claude in Chrome GA](https://claude.com/blog/claude-in-chrome-generally-available) | `✓` |
| 데스크톱 computer use | Pro·Max만, Team·Enterprise 미제공, macOS 15+·Windows | Claude 지원 문서 | `✓` |
| OpenAI 가격 | `gpt-6-astra` $10 / 캐시 $1 / $50, `gpt-6.1-sol` $2 / $0.1 / $10 (1M 토큰당) | developers.openai.com 모델 문서 | `✓` |
| ChatGPT agent·Work | 원격 가상 브라우저 / 로컬 데스크톱 조작. 플랜별 한도 불명 | 2차 보도 | `≈` |
| Gemini | Preview, 환경 3종(`BROWSER`·`MOBILE`·`DESKTOP`), 좌표 0~999 정규화, 정책 7종, 인젝션 탐지 기본 꺼짐 | [Gemini API Computer Use](https://ai.google.dev/gemini-api/docs/computer-use) | `✓` |
| Chrome auto browse | Android(미국) 2026-08-18, 데스크톱 발표(2026-01-28)는 2차 | Google 블로그 / 2차 보도 | `✓ ≈` |
| Copilot Studio | 단계당 5/15 Copilot Credits. 모델 선택표에 OpenAI CUA, Claude Sonnet 4.5(GA) 등 | [Computer use in Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/computer-use) | `✓` |
| Nova Act | $4.75/에이전트-시간(실제 경과 시간, 병렬은 각각, 사람 응답 대기 제외). GA는 2025-12(2차) | [AWS Nova 가격](https://aws.amazon.com/nova/pricing/) | `✓ / ≈` |
| Holo 라이선스 | Holo3-35B-A3B Apache-2.0, Holo4-27B CC-BY-NC-4.0, Holo4-35B-A3B Apache-2.0. 공개일은 HF API로 확인 | Hugging Face | `✓` |
| Fara1.5 | 4B·9B·27B, MIT, Qwen3.5 기반. Online-Mind2Web 57.3/63.4/72.3 (자체 보고) | [microsoft/fara](https://github.com/microsoft/fara) | `Ⓥ` |
| Browserbase·Browser Use Cloud | Developer $20/월(100시간, 초과 $0.12/h) / 약 $0.02/브라우저-시간 | 각 사 가격 페이지·README | `Ⓥ` |
| API 마이그레이션 작업 | `tools` 항목 교체, 결과마다 `toolset_name` 반환, 스크린샷 직접 리사이즈 | — | `✓` |
| 인젝션 탐지 설정 | Gemini API는 `enable_prompt_injection_detection`으로 활성화. Anthropic은 기본 활성화된 분류기를 끄려면 지원팀에 요청 | Gemini API, Anthropic | `✓` |
| OpenAI 자료 접근 | 제품 관련 1차 문서 일부가 403으로 차단되어 2차 출처로 확인. API 가이드와 모델 문서는 developers.openai.com에서 직접 확인 | 2차 출처, developers.openai.com | `≈ / ✓` |
| 오픈 웨이트 최고 점수 | OSWorld-Verified 공식 시트에서 Holo3-35B-A3B 82.56%, 활성 파라미터 3B, 오픈 웨이트 1위 | OSWorld-Verified 공식 시트 | `Ⓑ` |
| Fara1.5 조작 방식 | 스크린샷만으로 웹을 조작하는 소형 모델 | Microsoft | `Ⓥ` |
| Anthropic API 제공 방식 | 개발자 환경에서 툴셋 사용, 일반 tool use 요금 | — | `✓` |
| Claude in Chrome 승인 방식 | 행동마다 분류기가 검토하는 자동 승인이 기본, 수동 승인으로 변경 가능 | — | `✓` |
| 데스크톱 제품 범위 | Cowork·Claude Code 안에서 사용자 PC 화면 제어. 앱마다 첫 접근 허가, 투자·암호화폐 앱 기본 차단. 지원 문서는 beta, 발표 글은 research preview | Claude 지원 문서, 발표 글 | `✓` |
| OpenAI API 제공 방식 | Responses API `computer` 도구, 개발자 환경에서 실행, 위험 행동 직전 확인은 개발자가 구현 | — | `✓` |
| ChatGPT agent·Work 안전 기능 | takeover·watch mode, 확인 요청, 플랜별 차등 | — | `≈` |
| Gemini API 제공 방식 | 개발자 환경에서 실행, `require_confirmation` 반환, 별도 요금 없이 모델 토큰 요금 | — | `✓` |
| Chrome auto browse 제공 방식 | 로컬 Chrome의 Gemini 사이드 패널, 민감 행동 전 확인, origin 제한, AI Pro·Ultra 구독 | — | `✓ ≈` |
| Copilot Studio 제공 방식 | 2026-05 GA. Windows 365 호스티드 브라우저 또는 고객 Windows 머신, 허용 사이트·앱 목록과 사람 검토자 메일 | — | `✓` |
| Nova Act 제공 방식 | AWS 관리형 브라우저 UI 워크플로 서비스와 SDK, URL 허용·차단 목록, 사람 검증 지점 | — | `✓` |
| 오픈소스 제공 방식 | Browser Use(MIT), Stagehand(MIT), Skyvern(AGPL-3.0), Playwright MCP(Apache-2.0). 자체 환경에서 무료로 사용, 호스팅 클라우드는 별도, 안전장치는 제품마다 다름 | — | `✓` |
| 제품 조사 기준일 | 2026-10-06 | — | — |

{{% /details %}}

## 4. 실제 사례는 백오피스와 테스트에 모인다

### 4.1 가장 큰 사례도 CUA를 대체 경로로 쓴다

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

공개된 사례를 종합하면, 돈을 받고 돌아가는 CUA는 API가 열려 있지 않은 포털·레거시 화면의 백오피스와 QA·E2E 테스트에 몰려 있습니다. a16z의 인터뷰 사례와 UiPath·Automation Anywhere·Copilot Studio·Nova Act가 내세우는 업무도 이 범위에 모입니다.

표에서 가장 큰 숫자를 제시한 CPG 데이터 플랫폼을 먼저 볼 만합니다. a16z가 인터뷰로 전한 처리 규모는 월 약 1,500만~2,000만 건입니다. 이 사례는 평소에 결정적 자동화를 쓰다가 UI 변경으로 자동화가 깨질 때 CUA를 대체 경로로 호출합니다. CUA를 처음부터 모든 클릭에 쓰지 않는다는 점이 규모만큼 중요합니다.

표의 구분 열도 함께 봐야 합니다. 익명 인터뷰와 벤더 고객 사례는 실제 사용을 주장하지만, 제시한 성과를 독립적으로 검증할 수는 없습니다. 공식 문서의 송장 이관이나 신청 입력은 구현 예시이며 실고객 성과가 아닙니다.

a16z의 같은 글에는 실패 경험도 실려 있습니다. 에이전트가 "net 60"을 "net 30"으로 잘못 읽었는데 결과는 그럴듯했고, 보험 청구는 "접수됨"으로 보이다가 며칠 뒤 조정 단계에서 실패했습니다. 인터뷰 참여자는 사람이 2~3분 하는 일을 에이전트가 8~10분에 처리한다고도 전했습니다. 작업 종료와 업무 성공을 구분해야 하는 이유입니다.

소비자용 구매·예약 대행은 사람이 개입하는 지점이 더 드러납니다. 2차 보도에서 확인한 Operator와 ChatGPT agent 계열은 로그인, 결제, CAPTCHA에서 사용자에게 조작을 넘깁니다. ChatGPT agent 시스템 카드의 내부 평가에서도 권한 편집, 고위험 커뮤니케이션 발송, 금융 거래 완료에서 확인을 요청한 비율이 99.9~100%였습니다. 사용자가 필요한 순간에 돌아오는 것을 전제로 한 위임입니다.

### 4.2 테스트에서는 느린 속도를 받아들이기 쉽다

QA·E2E 테스트는 CUA의 제약과 비교적 잘 맞습니다. 지연을 허용하기 쉽고 결과를 기계적으로 판정할 수 있으며, 틀리더라도 실제 업무 데이터를 건드리지 않습니다. Anthropic 문서도 사람보다 느릴 수 있다는 이유로 백그라운드 정보 수집이나 자동 테스트처럼 속도가 중요하지 않은 용도에 집중하라고 권합니다. Claude in Chrome 파일럿의 내부 용도에는 새 웹사이트 기능 테스트가 포함됐습니다.

Google은 Gemini 2.5 Computer Use를 UI 테스트에 배포했다고 발표했고, QA.tech는 Claude computer use를 자율 테스트 플랫폼에 통합했다고 밝혔습니다. 그러나 이름이 알려진 QA 전용 SaaS인 QA Wolf, Momentic, Checksum의 정량 고객 결과는 찾지 못했습니다. 사용 사례의 존재와 도입 효과의 크기는 따로 확인해야 합니다.

### 4.3 플랫폼·SRE에서는 아직 후보를 말하는 단계다

| 구분 | 내용 | 배지 |
|---|---|---|
| 공식 언급 | Anthropic이 Claude in Chrome GA 글에서 연동이 없는 대상으로 내부 대시보드, 레거시 시스템, 벤더 포털을 꼽음 | ✓ |
| 공식 기능 | Claude Code에서 빌드·배포한 뒤 Chrome 확장으로 브라우저에서 테스트·검증하고 콘솔 로그를 읽는 연동 | ✓ |
| 공식 기능 | Claude in Chrome 예약 작업(일·주·월·연 반복). 대시보드 정기 점검에 쓸 수 있다는 것은 추정 | ✓ / ≈ |
| 가능성 | API 없는 외부 포털(일부 도메인 등록기관, 인증서 포털, SaaS 관리 콘솔)의 저빈도 클릭 작업 | ≈ |
| 가능성 | 배포 직후 UI 스모크 확인, 대시보드 스크린샷 점검 | ≈ |
| 비교 대상(CUA 아님) | Azure SRE Agent는 런북을 읽어 진단 단계를 실행하고, Claude Managed Agents의 SRE 쿡북은 bash로 로그와 IaC를 조사하며 PR은 사람이 승인. 둘 다 화면이 아닌 API·CLI·로그 도구로 동작 | Ⓥ ✓ |

플랫폼·SRE 업무에 CUA를 적용한 공개 실사례는 찾지 못했습니다. 현재 확인한 기능에서 후보를 고르면 API 없는 외부 포털의 저빈도 작업과 배포 뒤 화면 검증 정도가 남습니다.

이 후보에도 비용을 먼저 물어야 합니다. 이미 API·CLI 경로가 있는 일은 그쪽이 싸고 빠르며, 인증서 자동 갱신처럼 관리형 경로가 있는 작업까지 CUA로 처리할 이유는 없어 보입니다. 온콜 런북을 실행하는 에이전트도 이미 API·CLI·로그 도구를 사용합니다. 화면 조작으로 같은 일을 몇 배 느리게 수행하는 것은 플랫폼 팀에 이점이 되기 어렵습니다.

보안 분야에는 허가된 환경에서 취약한 웹앱을 공격하게 한 HackWorld 연구가 있습니다. ICLR 2026의 이 벤치마크에서 가장 나은 Claude 3.7 Sonnet의 평균 성공률은 10.18%였습니다. 평가 대상은 2025년 모델이며, 지금 세대로 다시 측정한 공개 결과는 찾지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| a16z 운영 사례 | CPG 포털 월 1,500만~2,000만 건·팀 절반 축소, IT 티켓 워크플로 27개·하루 1,500~2,100건, ATS 입력. "net 60 → net 30" 오독, 사람 2~3분 대 에이전트 8~10분 | [Can agents use a computer yet?](https://a16z.com/can-agents-use-a-computer-yet-weve-got-the-data/) | `Ⓥ` |
| Alight | 플랜 변경 테스트 자동화, "3x higher efficiency", "60% greater automation resiliency"는 벤더 주장 | Automation Anywhere 보도자료 2025-05-13 | `Ⓥ` |
| Google UI 테스트 | Project Mariner, Firebase Testing Agent, Search AI Mode 에이전트 기능에도 사용했다고 밝힘 | [Gemini 2.5 Computer Use 발표](https://blog.google/technology/google-deepmind/gemini-computer-use-model/) | `Ⓥ` |
| QA.tech | 자사 모델은 DOM+스크린샷이 필요했지만 Claude는 스크린샷만으로 동작, 정량치 없음 | QA.tech 블로그 | `Ⓥ` |
| Copilot Studio 샘플 | 송장 이관, 재고 입력. 문서의 대표 용도는 데이터 입력·송장 처리·데이터 추출 | Computer use in Copilot Studio | `✓` |
| Nova Act 서비스 카드 | 4대 용도 중 하나가 QA 테스트. 초기 고객 90%+ 종단 신뢰도는 벤더 주장 | AWS Service Card, [AWS 블로그](https://aws.amazon.com/blogs/aws/build-reliable-ai-agents-for-ui-workflow-automation-with-amazon-nova-act-now-generally-available) | `✓ / Ⓥ` |
| ChatGPT agent 확인 정책 | 권한 편집 100.0%, 고위험 커뮤니케이션 발송 99.9%, 금융 거래 완료 100.0% 확인 요청. 전체 confirmation recall 91.0% | [ChatGPT agent system card](https://deploymentsafety.openai.com/chatgpt-agent) | `✓` |
| takeover | 로그인·결제·CAPTCHA에서 사용자에게 조작을 넘김. 1차 페이지는 403이라 2차 보도로만 확인 | 2차 보도 | `≈` |
| SRE 비교 대상 | Azure SRE Agent는 마크다운 런북 기반(블로그), Managed Agents SRE 쿡북은 Skill·bash·사람 승인 PR | Microsoft 블로그, Claude 쿡북 | `Ⓥ / ✓` |
| HackWorld | 취약 웹앱 36개(11개 프레임워크·7개 언어), 최고 Claude 3.7 Sonnet 평균 10.18%. 실패 원인은 도구 선택·출력 파싱·복구 실패 등 | arXiv 2510.12200 | `Ⓑ` |
| 반론 근거 | ACM 자동 갱신 등 API·관리형 경로가 있는 작업은 CUA 대상이 아님. InfoQ 보도는 검색 요약으로만 확인 | 검색 요약 | `Σ` |
| 사용처의 집중 | API가 열려 있지 않은 포털·레거시 화면의 백오피스와 QA·E2E 테스트에 사례와 대표 시나리오가 집중 | a16z, UiPath·Automation Anywhere·Copilot Studio·Nova Act | `Σ` |
| CPG 대체 경로 | 결정적 자동화가 UI 변경으로 깨질 때 CUA가 복구하는 대체 경로로 들어감 | a16z | `Ⓥ` |
| IT 티켓 목표 | 글로벌 SI의 인력 20~25% 재배치가 목표 | a16z | `Ⓥ` |
| ATS 입력 | 채용 대행사가 저렴한 비프런티어 모델로 후보자 데이터를 ATS에 끝까지 입력. 수치 없음 | a16z | `Ⓥ` |
| Alight의 기존 작업 규모 | 수개월, 수백 명이 걸리던 플랜 변경 테스트를 UI Agents로 자동화. 정량 결과는 없으며 효율 3배, 자동화 복원력 60% 향상은 벤더 주장 | Automation Anywhere 보도자료 | `Ⓥ` |
| 보험 청구 실패 | 접수된 것으로 보인 청구가 며칠 뒤 조정 단계에서 실패 | a16z | `Ⓥ` |
| 송장·재고 예시 | PDF 송장 데이터를 웹 폼에 옮겨 제출하고 품목 5건 입력 | Copilot Studio 공식 문서 | `✓` |
| 신청 입력 예시 | 건강보험 신청 입력, PDF 추출, 누락 시 HR 에스컬레이션 | 공식 서비스 카드 | `✓` |
| 소비자 에이전트 확인 비율 | 권한 편집·고위험 커뮤니케이션 발송·금융 거래 완료의 확인 요청 99.9~100%. 내부 평가 | ChatGPT agent 시스템 카드 | `✓` |
| 지연을 허용하는 용도 | 백그라운드 정보 수집과 자동 테스트처럼 속도가 중요하지 않은 용도에 집중하도록 권고 | Anthropic 공식 한계 설명 | `✓` |
| 파일럿 테스트 용도 | 내부 용도에 새 웹사이트 기능 테스트 포함 | Claude in Chrome 파일럿 | `✓` |
| QA 전용 SaaS 성과 | QA Wolf, Momentic, Checksum의 정량 고객 결과를 찾지 못함 | — | `?` |
| 플랫폼·SRE 실사례 | CUA를 적용한 공개 실사례를 찾지 못함 | — | `?` |
| 연동 없는 대상 | 내부 대시보드, 레거시 시스템, 벤더 포털을 언급 | Claude in Chrome GA 글 | `✓` |
| 개발·브라우저 연동 | Claude Code에서 빌드·배포한 뒤 Chrome 확장으로 테스트·검증하고 콘솔 로그를 읽음 | — | `✓` |
| 예약 작업과 활용 가능성 | 일·주·월·연 반복은 공식 기능. 대시보드 정기 점검 활용은 추정 | — | `✓ / ≈` |
| 플랫폼 업무 후보 | API 없는 외부 포털의 저빈도 클릭, 배포 직후 UI 스모크 확인, 대시보드 스크린샷 점검 | — | `≈` |
| 플랫폼 팀의 적용 범위 | API가 없거나 막힌 외부 포털의 저빈도 작업과 배포 뒤 화면에서만 확인되는 검증이 후보 | — | `Σ` |
| HackWorld의 시점 | ICLR 2026, 2025년 모델 기준. 지금 세대로 다시 측정한 공개 수치는 찾지 못함 | HackWorld | `Ⓑ / ?` |

{{% /details %}}

## 5. 높은 벤치마크 점수 뒤에 남은 제약

### 5.1 OSWorld-Verified의 포화와 장기 과제의 미완료는 함께 존재한다

OSWorld-Verified에서 사람 기준은 72.36%입니다. 공식 시트의 상위권은 이미 이를 넘어섰고, 코드 실행 없이 GUI만 사용한 claude-fable-5도 85.96%를 기록했습니다. 이 벤치마크는 상위 모델을 구분하기 어려운 포화 단계에 들어섰습니다.

그렇다면 긴 업무도 맡길 수 있을까요? 후속인 OSWorld 2.0의 결과는 다른 모습을 보여줍니다. 과제가 길어졌고, 완료 여부만 보는 이진 완료율과 체크포인트별 부분 점수를 함께 발표합니다. 공식 사이트에서 Claude Opus 4.8은 이진 완료율 20.6%, 부분 점수 54.8%였습니다. 중간 작업을 해냈다는 것과 끝까지 마쳤다는 것 사이에 큰 차이가 있습니다.

최근 발표도 이 구분을 유지해서 봐야 합니다. Anthropic이 발표한 Opus 5.5의 OSWorld 2.1 점수는 부분 점수이며, 신형 모델의 이진 완료율은 확인하지 못했습니다. 2.1은 2.0의 버그를 수정한 판이어서 판본 사이의 직접 비교도 어렵습니다. OSWorld 2.0의 과제 길이별 분석에서는 긴 과제로 갈수록 완료율이 낮아졌고, 가장 긴 구간에서는 모든 모델이 과제를 마치지 못했습니다. 사람의 긴 업무를 통째로 맡기는 데는 여전히 제약이 큽니다.

점수를 확인할 때는 공식 검증 결과인지부터 살펴야 합니다. Qwen3.8-27B와 Holo4-27B의 벤더 발표 수치는 OSWorld-Verified 공식 시트에 없는 자가 보고입니다. 공식 시트 안에서도 스텝 한도가 다른 행을 구분해야 합니다. 같은 모델이라도 행동 기회를 얼마나 줬는지에 따라 결과가 달라집니다. 모델 이름만으로 성능을 비교하기 어려운 이유입니다.

### 5.2 웹에서도 평가 방식에 따라 점수 차이가 크다

Online-Mind2Web은 실제 웹사이트에서 과제를 수행하는 벤치마크입니다. HAL은 하네스를 통일하고 비용을 함께 공개합니다. 별도의 자기보고 리더보드에는 훨씬 높은 점수가 올라와 있으며, 일부 행에는 독립 검증이 붙어 있습니다.

이 차이를 곧바로 모델의 우열로 바꿀 수는 없습니다. 리더보드 자체가 제출마다 판정기가 달라 행 사이를 비교할 수 없다고 경고합니다. 원 논문도 어려운 과제로 넘어가면 정확도가 크게 떨어진다고 보고했습니다. 모바일 AndroidWorld 역시 자기보고 상위 점수가 만점에 도달해 사실상 포화 상태입니다. 어떤 환경과 판정 절차에서 얻은 점수인지를 함께 봐야 합니다.

### 5.3 성공하더라도 기다리는 시간이 길다

CUA는 느립니다. OSWorld-Human은 최고 에이전트도 사람이 필요로 하는 스텝의 2.7~4.3배를 사용한다고 보고했습니다. 같은 연구의 줄 간격 변경 작업은 사람에게 30초 미만이 걸렸지만 에이전트는 12분이 필요했습니다.

지연의 대부분은 계획과 반성을 담당하는 대형 모델 호출에서 나왔습니다. 뒤로 갈수록 히스토리가 쌓여 각 스텝도 더 느려집니다. Anthropic 문서가 속도가 중요하지 않은 작업을 권하는 이유와 맞닿아 있습니다. 성공률이 충분해도, 결과를 기다릴 수 있는 업무인지 별도로 판단해야 합니다.

### 5.4 실패를 알아차리는 일도 자동화에 포함된다

Anthropic의 공식 한계 목록에는 좌표 출력 오류와 환각, 도구 선택 오류, 스크롤 불안정, 스프레드시트 셀 선택 문제가 들어 있습니다. 틈새 앱과 여러 앱을 함께 쓰는 작업은 도구 선택이 특히 어렵고, 소셜 플랫폼 계정 생성과 콘텐츠 게시에는 제한도 있습니다. 프롬프트 인젝션 역시 공식적으로 명시된 위험입니다.

실제 실패는 다음처럼 나타납니다.

- 좌표와 클릭 오차. 2024년 분석에서는 실패의 75% 이상에 클릭 부정확이 포함됐습니다.
- 장기 과제의 상태 추적 실패. OSWorld 2.0 분석은 제약 조건 망각, 중간에 갱신된 정보 누락, 확인 질문 대신 추측, 숨은 상태 검증 부족을 실패 원인으로 꼽습니다.
- 그럴듯한 오독. 앞서 본 "net 60" 사례처럼 틀린 결과가 맞는 것처럼 보여 며칠 뒤에야 드러납니다.
- 완료했다고 잘못 판단하는 경우. OpenAI 샘플 앱 README는 실행 종료가 루프의 정상 종료를 뜻할 뿐, 최종 답이 과제 성공을 증명하지는 않는다고 설명합니다.
- CAPTCHA. Open CaptchaWorld에서도 에이전트 성능은 사람보다 낮았습니다. 성능과 별개로 Claude in Chrome과 Gemini는 CAPTCHA 우회를 금지합니다.
- 로그인과 2FA(두 단계 인증). 실패율을 정량적으로 다룬 1차 자료는 찾지 못했습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| OSWorld 기준선 | 369과제, 사람 72.36%, 2024 최고 12.24% | OSWorld | `✓ Ⓑ` |
| 공식 시트 상위(2026-08-01) | Intelligence-Indeed Agent 90.19%(코드 액션 예), claude-fable-5 85.96%(코드 액션 아니오), Pointer Agent w/ Opus 4.7 83.64%, claude-opus-5 83.39%, Coasty CUA v1 82.81%, Holo3-35B-A3B 82.56% | OSWorld-Verified 공식 시트 | `Ⓑ` |
| 스텝 한도 | computer-use-preview 15스텝 26% → 50스텝 31.3% → 100스텝 31.4% | 같은 시트 | `Ⓑ` |
| 자가 보고 | Qwen3.8-27B 84.3%(Claude Code 하네스), Holo4-27B 85.2%. 공식 시트에 없음. 집계 사이트의 Qwen3.8 Max 86.1%는 공식 시트에서 확인하지 못함 | HF 모델 카드 | `Ⓥ / ?` |
| OSWorld 2.0 | 108과제, 21개 하위 범주, 500스텝 상한, 툴 호출 평균 318회(1.0은 약 30), 사람 중앙값 약 1.6시간. 이진과 부분 점수 병기 | [OSWorld 2.0](https://osworld-v2.xlang.ai/), arXiv 2606.29537 | `✓ Ⓑ` |
| 2.0 공식 점수 | Opus 4.8 이진 20.6% / 부분 54.8%, Opus 4.7 이진 18.2%, GPT-5.5 이진 약 14% | 같은 사이트 | `✓ Ⓑ` |
| 2.1 벤더 발표 | Opus 5.5 81.8%(2026-09-22), Fable 5.1 80.7%, Opus 5 74.0%. 모두 부분 점수. 집계 사이트 기준 Sonnet 5.5 80.1% | [Claude Opus 5.5 발표](https://www.anthropic.com/news/claude-opus-5-5) | `✓ Ⓥ` |
| 과제 길이별 | 45분 미만 이진 20~24%, 137~163분 모든 모델 10% 미만, 163분 초과 전 모델 0% | OSWorld 2.0 사이트 | `✓ Ⓑ` |
| Online-Mind2Web | 300과제·136개 사이트. HAL 통일 하네스 SeeAct+GPT-5 42.33%. 자기보고 Browser Use Cloud 97.0%, GPT-5.4 93.0%, 독립 검증 ABP+Opus 4.6 90.53%, TinyFish 90.0% | [HAL](https://benchmarklist.com/benchmarks/hal_online_mind2web/), leaderboard.steel.dev | `Ⓑ` |
| 쉬운 과제 대비 하락 | 어려운 과제에서 약 47%p 하락 | arXiv 2504.01382 | `✓ Ⓑ` |
| AndroidWorld | 시트가 "커뮤니티 제출, 독립 검증 없음, 자기보고"라고 명시. 상위 100% | AndroidWorld 공식 리더보드 | `Ⓑ` |
| OSWorld-Human | 필요 스텝의 2.7~4.3배(v2, 2026-05-18 개정, v1은 1.4~2.7배), 줄 간격 변경 사람 30초 미만 vs 에이전트 12분, 계획·반성이 지연의 75~94%, 뒤쪽 스텝 최대 3배 느림 | [OSWorld-Human](https://arxiv.org/abs/2506.16042) | `✓ Ⓑ` |
| 장기 과제 실패 축 | 제약 망각, 중간 갱신 놓침, 질문 대신 추측, 숨은 상태 검증 부족 | OSWorld 2.0 | `✓` |
| CAPTCHA | Open CaptchaWorld 20종·225개, 사람 93.3% vs 최고 에이전트 40.0%(OpenAI o3) | arXiv 2505.24878 | `✓ Ⓑ` |
| 팝업 공격 | OSWorld·VisualWebArena에 적대적 팝업 삽입 시 공격 성공률 평균 86%, 과제 성공률 47% 하락. "팝업 무시" 프롬프트 같은 기본 방어는 효과 없음 | arXiv 2411.02391 | `✓ Ⓑ` |
| OpenAI 샘플 앱 | "실행 종료는 정상 종료일 뿐 최종 답이 과제 성공을 증명하지 않는다" | openai-cua-sample-app | `✓` |
| Anthropic 공식 한계 | 좌표 환각, 도구 선택 오류, 스크롤, 셀 선택, 계정 생성·게시 제한, 인젝션 | Computer use tool | `✓` |
| 스텝에 따른 점수 차이 | 공식 시트에 15·50·100스텝 행이 별도로 있으며 같은 모델도 한도에 따라 5%p 넘게 차이 | OSWorld-Verified 공식 시트 | `Ⓑ` |
| 신형 모델의 이진 완료율 | OSWorld 2.1의 신형 모델 이진 완료율은 확인하지 못함 | — | `?` |
| 판본 간 비교 | 2.1은 2.0의 버그 수정판이므로 직접 비교할 수 없음 | — | `Ⓑ` |
| 웹 리더보드 비교 조건 | 제출마다 판정기가 달라 행 사이를 비교할 수 없다고 리더보드가 경고 | Online-Mind2Web 리더보드 | — |
| 클릭 오차의 반복 | 2024년 분석에서 실패의 75% 이상에 클릭 부정확이 포함 | — | — |
| CAPTCHA 우회 정책 | Claude in Chrome과 Gemini 모두 우회 금지 | Claude in Chrome, Gemini | `✓` |
| 로그인·2FA 실패율 | 정량적으로 다룬 1차 자료를 찾지 못함 | — | `?` |

{{% /details %}}

## 6. 비용은 스크린샷과 반복 횟수에서 시작한다

CUA의 비용을 볼 때는 모델 단가보다 한 작업에서 이미지를 얼마나 보내는지 먼저 봐야 합니다. 스크린샷은 매 스텝 생기고, 이전 화면을 컨텍스트에 남겨두면 다음 요청에서도 입력 비용이 발생합니다. 여기에 툴셋 선언, 모델의 생각과 출력, 실패 후 재시도가 더해집니다.

Anthropic의 비전 문서는 이미지 토큰을 ⌈w/28⌉ × ⌈h/28⌉으로 계산합니다. 1280×800 스크린샷을 20장 유지하고 입력 단가를 100만 토큰당 $5로 놓고 계산하면, 캐시 없이 스텝마다 이미지 입력에만 약 $0.13이 듭니다. 툴셋 선언에 붙는 약 4,500토큰은 별도입니다.

해상도를 높이면 읽기는 좋아지지만 비용도 늘어납니다. 그렇다고 무조건 "1080p 권장"으로 이해해서는 안 됩니다. Computer use tool 문서는 일반 데스크톱에 1024×768이나 1280×720, 웹 앱에 1280×800이나 1366×768을 권하고, 1920×1080 초과는 피하라고 안내합니다. 일부 블로그와 마이그레이션 문서는 신모델에 다른 기준을 제시하므로, 사용하는 모델과 문서의 조건을 함께 확인해야 합니다.

이미지 크기 관리도 하네스의 일입니다. 툴셋은 모델 한도를 넘는 스크린샷을 자동으로 줄이지 않고 오류로 거부합니다. 개발자가 미리 리사이즈해야 하며, 한 요청에 이미지를 많이 담으면 장당 픽셀 한도도 더 엄격해집니다.

비용을 줄이는 방법은 다음과 같습니다.

- 오래된 스크린샷 가지치기. Anthropic은 최근 스크린샷 3장만 남기고 나머지를 25장 단위로 묶어 치우라고 안내합니다. 매 턴 삭제하면 프롬프트 캐시가 깨지기 때문입니다. Claude 5.5 이후 모델에서 생각(thinking) 블록을 함께 쓴다면 클라이언트 가지치기 대신 서버 측 tool result clearing을 권합니다.
- 프롬프트 캐싱. 캐시에 적중한 입력은 낮은 요율이 적용됩니다.
- 배치 액션. 결과 화면을 다시 볼 필요 없이 기계적으로 이어지는 행동은 한 왕복으로 묶습니다.
- 생각 강도 조절. Anthropic의 Best practices는 Opus 4.7에서 high가 max보다 적은 출력 토큰으로 거의 같은 성공률을 냈다고 설명합니다.
- 접근성 트리 사용. 일반 웹 페이지에서는 스크린샷보다 토큰을 적게 사용합니다.
- 코드 우선 실행. StateAct 요약 기사는 코드로 상태를 읽고 쓰고 GUI는 필요할 때만 사용해 비용을 줄이고 성공률을 높였다고 전합니다. 원문은 확인하지 못했습니다.

실제 작업 비용의 차이는 큽니다. HAL의 Online-Mind2Web 결과에서 SeeAct와 GPT-5 조합, Browser Use와 Claude Sonnet 4 조합은 비슷한 성공률을 냈지만 비용은 10배 가까이 차이 났습니다. 벤더가 밝힌 값으로 Holo4-27B는 OSWorld 과제당 $0.08입니다. 모델과 하네스를 함께 놓고 비용을 봐야 합니다.

과금 단위도 제품마다 다릅니다. Copilot Studio는 스텝별 크레딧을 청구하고, Nova Act는 에이전트 실행 시간에 과금합니다. Copilot Credit의 달러 단가는 Microsoft 1차 가격 페이지에서 확인하지 못했으므로, 아래 환산값은 3자 자료의 단가를 가정한 금액입니다.

a16z는 CUA의 시간당 비용을 재시도 비용까지 넣어 $6~8로 추산했고, 오프쇼어 BPO는 약 $10, 미국 백오피스는 $30~45로 잡았습니다. 이 글은 이 비교를 CUA가 싼 노동력과 같은 자릿수에서 경쟁한다는 뜻으로 읽습니다. 같은 일을 API 호출 한 번으로 처리할 수 있다면 화면 조작의 스텝과 이미지, 재시도를 줄일 수 있어 비용 차이는 더 커질 것으로 보입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 이미지 토큰 공식 | ⌈w/28⌉ × ⌈h/28⌉. 1920×1080은 2,691토큰, 3840×2160은 2576×1449로 줄어 4,784토큰(문서 표). 1024×768=1,036, 1280×720=1,196, 1280×800=1,334, 1366×768=1,372는 공식으로 계산 | [Vision](https://platform.claude.com/docs/en/build-with-claude/vision) | `✓ / ≈` |
| 한도 | 고해상도 티어(Claude 4.7 이후) 긴 변 2,576px·4,784토큰(약 3.75MP), 이전 모델 1,568px·약 1.15MP. 툴셋은 초과 시 거부 | Vision, Computer use tool | `✓` |
| 해상도 권장 | 일반 데스크톱 1024×768·1280×720, 웹 앱 1280×800·1366×768, 1920×1080 초과 지양. quickstart README는 XGA 권장·XGA/WXGA 초과 지양. 일부 블로그·마이그레이션 문서에는 신모델에 1080p부터를 권한다는 문장도 있어 출처마다 기준 모델이 다름 | Computer use tool, [computer-use-demo](https://github.com/anthropics/claude-quickstarts/tree/main/computer-use-demo), [Best practices](https://claude.com/blog/best-practices-for-computer-and-browser-use-with-claude) | `✓` |
| 20장 규칙 | 요청당 이미지 20장 이하 권장 | Computer use tool | `✓` |
| 스텝당 입력 추정 | 1,334토큰 × 20장 ≈ 26,680토큰, $5/M이면 약 $0.133 (캐시 미적용) | 위 공식과 단가로 계산 | `≈` |
| 가지치기·캐싱 | 최근 3장 유지, 25장 단위, 약 150k 입력 토큰에서 compaction, 캐시 브레이크포인트 최대 4개(시스템·도구 뒤 1 + 최근 tool_result 3), 히트 시 입력 10% | Best practices, Computer use tool | `✓` |
| 생각 강도 | Opus 4.7 high ≈ max의 절반 출력 토큰으로 거의 최고 성공률. 4.6은 medium이 high의 절반 | Best practices | `✓` |
| StateAct | 코드 우선, 작업당 비용 약 1/9. GUI 서브에이전트는 108개 중 28개 과제에서만 호출. OSWorld 2.0 이진 20.6% → 26.9%, 부분 54.8% → 61.6% (Opus 4.8) | arXiv 2607.22798(aiweekly 요약) | `Ⓑ` |
| HAL 비용 | Online-Mind2Web 300과제: SeeAct+GPT-5 Medium $171.07(42.33%), Browser-Use+Claude Sonnet 4 $1,577.26(40%). 과제당 약 $0.57 / 약 $5.26 | HAL | `Ⓑ ≈` |
| Holo4 비용 | OSWorld $0.08, OSWorld 2.0 $1.22(27B) / $0.61(35B-A3B). OSWorld 2.0 점수가 부분인지 이진인지 불명 | HF 모델 카드 | `Ⓥ` |
| 출력 토큰 | OSWorld 2.0 과제당 출력 토큰 Opus 4.8 약 244K, Opus 4.7 약 150K, GPT-5.5 약 39K. 평균인지 합인지 불명 | OSWorld 2.0 사이트 | `✓ ?` |
| Copilot Studio | 표준 5 / 프리미엄 15 크레딧·스텝. 4스텝 20 / 60. 단가 $0.01(종량), 용량팩 $200/25,000(약 $0.008)은 3자 정리 | Computer use in Copilot Studio | `✓ / ?` |
| a16z 비용 | CUA $6~8/시간(범위 $3~15), 오프쇼어 BPO 약 $10, 미국 백오피스 $30~45 | a16z | `Ⓥ ≈` |
| 선언 오버헤드 | 약 4,500토큰. 구버전은 시스템 프롬프트 466~499 + 도구 정의 약 735 | Computer use tool | `✓` |
| 시각 토큰 단위 | 28×28 픽셀 패치 하나를 시각 토큰 하나로 계산 | Anthropic 비전 문서 | `✓` |
| 이미지당 토큰 설명 | 이미지 한 장에 대략 1,000~1,800 입력 토큰 | Anthropic 문서 | `✓` |
| 이미지 수와 한도 | 요청당 20장을 넘으면 장당 픽셀 한도가 더 엄격해짐 | Anthropic 문서 | `✓` |
| 누적 이미지 비용의 반올림 표현 | 1280×800 스크린샷 20장은 이미지만 약 2만 7천 토큰. 100만 토큰당 $5라면 캐시 없이 스텝마다 약 $0.13 | 위 공식과 단가로 계산 | `≈` |
| 요청별 선언 비용 | 툴셋 선언 오버헤드 약 4,500토큰이 요청마다 추가 | — | `✓` |
| 가지치기 방식 | 매 턴 삭제하면 프롬프트 캐시가 깨짐. Claude 5.5 이후 모델에서 thinking 블록과 함께 쓸 때는 서버 측 tool result clearing 권장 | — | `✓` |
| 접근성 트리 비용 | 일반 웹 페이지에서는 트리가 스크린샷보다 토큰이 적음 | — | `✓` |
| StateAct 비교 조건 | 스크린샷 전용 기준선 대비 작업당 비용 약 1/9, 성공률도 향상. 요약 기사만 확인했고 논문 원문은 미확인 | 요약 기사 | `Ⓑ` |
| HAL 비용 차이 | 같은 300개 과제에서 정확도는 비슷하지만 비용은 10배 가까이 차이 | HAL | `Ⓑ` |
| Copilot 모델과 예시 | 표준 스텝당 5 Copilot Credits, 프리미엄 Claude Opus 4.6은 15. 4스텝 타임시트 작업은 각각 20과 60 크레딧 | — | `✓` |
| Copilot 달러 환산 | Microsoft 1차 가격 페이지에서 단가를 확인하지 못함. 3자 정리의 종량제 $0.01을 가정하면 스텝당 약 $0.05 / $0.15, 4스텝 작업 약 $0.20 / $0.60 | 3자 정리 | `≈` |
| Nova Act 과금 | 에이전트 1시간에 $4.75, 병렬 에이전트는 각각 과금 | — | `✓` |
| 인력 비용 비교의 조건 | a16z의 CUA 비용 추정에는 재시도 추론 비용 포함 | a16z | `Ⓥ` |
| API와의 비용 비교 | 같은 일을 API 한 번으로 끝낼 수 있으면 스텝·이미지·재시도가 없어 CUA와의 비용 격차가 더 큼 | — | `Σ` |

{{% /details %}}

## 7. 안전장치는 모델 바깥에도 필요하다

### 7.1 화면의 지시를 사용자 지시와 구분해야 한다

CUA가 읽는 웹 페이지와 문서, 이미지에는 공격자가 쓴 지시가 들어갈 수 있습니다. Anthropic과 OpenAI가 공통으로 경고하는 위협입니다. 화면 속 문장이 사용자의 목표를 바꾸는 공격은 OWASP의 에이전트 위험 분류에서 목표 탈취(ASI01)에 해당하는 것으로 보입니다. 이 분류는 보안 벤더 해설로 확인했고 OWASP 원문은 확인하지 못했습니다.

Brave가 공개한 Perplexity Comet 취약점은 이 위험을 구체적으로 보여줍니다. 페이지 내용이 이메일과 일회용 비밀번호(OTP)를 빼내는 경로가 됐고, 스크린샷에 거의 보이지 않게 숨긴 글자도 명령으로 처리됐습니다.

벤더의 방어 성능 숫자는 조건을 함께 봐야 합니다. Anthropic은 2025-11 연구에서 Opus 4.5의 적응형 공격 성공률을 약 1%로 발표하면서도 그 비율이 의미 있는 위험이라고 설명했습니다. 2026-08 Chrome GA 발표는 더 강한 전문 레드팀 공격과 추가 방어 계층을 평가했습니다. 학술 벤치마크 RedTeamCUA에서는 Claude 4.5 Sonnet의 공격 성공률이 60%로 가장 높았습니다.

이 수치로 제품의 안전 순위를 매길 수는 없습니다. 공격자 모델, 시도 횟수, 방어 계층 포함 여부가 서로 다릅니다. 낮은 성공률을 얻은 벤더 평가에서도 분류기, probe, 확인 단계가 사용됐다는 점을 봐야 합니다. 모델 하나의 판단으로 실행을 맡기기 어렵다는 이야기입니다.

### 7.2 제품의 기본값과 직접 구현할 장치를 나눈다

완성된 제품은 확인 절차를 제공하지만 적용 방식이 다릅니다.

- Claude in Chrome은 GA 이후 자동 승인이 기본입니다. Claude가 행동의 안전성을 검토하고 필요할 때 확인을 요청합니다. 사용자는 수동 승인으로 바꿀 수 있고, Enterprise 관리자는 사이트 allowlist·blocklist를 설정할 수 있습니다.
- 데스크톱 computer use는 앱마다 첫 접근 때 허가를 요청합니다. 투자·트레이딩·암호화폐 앱은 기본으로 차단합니다.
- Gemini API는 모델이 `require_confirmation`을 반환합니다. 금융 거래, 민감 데이터 수정, 메일·메시지 자율 발송, 계정 생성, 약관 동의 등을 다루는 일곱 가지 정책이 내장돼 있습니다.
- Copilot Studio의 허용 사이트·앱 목록은 앱을 여는 것까지 막지는 못하며 조작을 제한합니다. 유해 지시를 감지하면 지정한 검토자에게 메일을 보내고, 응답 제한시간이 지나면 실행을 중단합니다.

API로 하네스를 직접 만든다면 실행 환경과 통제 장치도 직접 마련해야 합니다. 공식 문서의 권고는 격리, 허용 목록, 위험 행동 직전 확인, 자격증명 비노출로 모입니다.

- 전용 VM이나 컨테이너에서 최소 권한 계정으로 실행합니다. 로그인 정보나 API 키 같은 민감 데이터를 모델에 직접 주지 않습니다.
- 도메인 허용 목록을 적용하고 리다이렉트 뒤에도 다시 검사합니다. Anthropic은 이동 처리기에서 허용 목록을 강제하고, loopback·사설 대역과 `javascript:`·`file:`·`data:`·`chrome:` 스킴을 URL 파서로 차단하라고 안내합니다. 문자열 접두어 검사만으로 처리하지 않습니다.
- 위험 행동 바로 직전에 사용자 확인을 받습니다. OpenAI 가이드는 구매, 데이터 전송, 파괴적 변경을 사용자 통제 아래 두며, 폼에 민감 정보를 입력하는 것도 전송으로 취급합니다. 확인을 받았다는 모델의 주장에 의존하지 말라고 명시합니다.
- 스텝, 시간, 비용에 상한을 두고 취소할 수 있게 합니다.
- 스크린샷과 행동 로그를 남깁니다. 세션 전체를 영상처럼 되감는 리플레이를 기본 기능으로 명시한 1차 문서는 찾지 못했습니다.
- 결과를 사후 검증합니다. 모델의 완료 선언만으로 성공을 판단하지 않습니다.

CAPTCHA도 우회 대상이 아닙니다. Claude in Chrome과 Gemini는 우회를 금지합니다. 2FA·OTP를 에이전트에 넘기는 명시 정책은 찾지 못했지만, Comet 취약점에서 드러난 유출 가능성을 고려하면 사람이 직접 다루는 편이 안전해 보입니다.

참조 구현을 가져올 때도 경계를 확인해야 합니다. Playwright MCP README는 스스로 "not a security boundary"라고 밝힙니다. OpenAI 샘플 앱의 Python 판은 샌드박스 없이 사용자 권한으로 실제 마우스와 키보드를 제어합니다. Anthropic quickstart는 조작 대상 컨테이너 안에서 에이전트 루프가 돌며 한 번에 한 세션만 지원하는 최소 참조 구현입니다.

제품을 공유할 때 생기는 권한 문제도 있습니다. Copilot Studio 문서는 기본값인 제작자 자격증명을 유지한 채 에이전트를 공유하면, 받은 사람이 제작자의 권한으로 행동하게 된다고 경고합니다. 실행할 수 있다는 것과 필요한 권한만 부여했다는 것은 별도로 확인해야 합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Claude for Chrome 파일럿 | 123 케이스·29 시나리오, 완화책 없는 자율 모드 23.6% → 완화 후 11.2%. 브라우저 특화 공격 4종 35.7% → 0%. 123/29는 2차 요약에서 나옴 | [Claude for Chrome](https://claude.com/blog/claude-for-chrome) | `Ⓥ` |
| 인젝션 방어 연구 | Opus 4.5, 내부 적응형 Best-of-N 공격자(환경당 100회 시도) 약 1%. 방어 3축: RL 견고성 학습, 비신뢰 콘텐츠 분류기 스캔, 사람 레드팀 | [Prompt injection defenses](https://www.anthropic.com/research/prompt-injection-defenses) | `Ⓥ` |
| Chrome GA | 전문 레드팀 기준, 추가 방어 없이 도달한 공격 성공률 Opus 5 3.8%. probe+분류기 적용 시 Sonnet 5·Opus 5·Mythos 5 0%, Fable 5 0.3%. 성공한 공격은 모두 저심각도 시나리오. Opus 4.5 수치는 17.6%와 16.7%가 엇갈려 본문에서 제외 | Claude in Chrome GA | `Ⓥ` |
| 지원 문서 수치 | 현재 구성의 내부 테스트 성공률 0.08% 미만. 측정 모델·조건 불명 | [Using Claude in Chrome safely](https://support.claude.com/en/articles/12902428-using-claude-in-chrome-safely) | `✓ ?` |
| RedTeamCUA | RTC-Bench 864건, 성공률 Claude 3.7 Sonnet 42.9%, Claude 4.5 Sonnet 60%(최고), Operator 7.6%(최저). 시도율 최대 92.5% | [RedTeamCUA](https://arxiv.org/abs/2505.21936) | `Ⓑ` |
| ChatGPT agent 저항률 | 무관 지시(텍스트 브라우저) 99.5%, 무관 지시(시각 브라우저) 95%, 맥락 내 데이터 유출 78%, 능동 유출 67% | ChatGPT agent system card | `✓` |
| Comet | 2025-07-25 제보, 이틀 뒤 1차 수정. 이메일·OTP 유출 가능성 | [Brave](https://brave.com/blog/comet-prompt-injection/) | `✓` |
| Gemini 안전 | 정책 7종(`FINANCIAL_TRANSACTIONS`, `SENSITIVE_DATA_MODIFICATION`, `COMMUNICATION_TOOL`, `ACCOUNT_CREATION`, `DATA_MODIFICATION`, `USER_CONSENT_MANAGEMENT`, `LEGAL_TERMS_AND_AGREEMENTS`). 인젝션 탐지는 기본 꺼짐 | Gemini API Computer Use | `✓` |
| 브라우저 툴셋 권고 | 새 프로필(자격 증명 없음), navigate 핸들러의 허용 목록, loopback·사설 대역 차단, 위험 스킴은 URL 파서로 거부 | Browser use tool | `✓` |
| OpenAI 가이드 | 격리 브라우저/VM + 허용 목록, 화면 콘텐츠는 비신뢰 입력, 위험 지점에서 확인(모델 주장에 의존 금지), 단계·시간·비용 상한 | Computer use 가이드 | `✓` |
| Copilot Studio | 허용 목록은 열기를 막지 못하고 조작만 막음. Human supervision 메일. 기본 제작자 자격증명 공유 경고. 머신 권고: 전용 머신, 최소 권한, Intune으로 Edge 허용 목록, App Control | Computer use in Copilot Studio | `✓` |
| 참조 구현 한계 | Playwright MCP "not a security boundary"(`--isolated`, `--allowed-origins`). 샘플 앱 샌드박스 없음. quickstart 한 번에 한 세션 | 각 README | `✓` |
| CAPTCHA 금지 | Claude in Chrome 지원 문서, Gemini 블로그 | 각 문서 | `✓` |
| OWASP | Top 10 for Agentic Applications 2026, ASI01 Agent Goal Hijack. 보안 벤더 해설로 확인, 원문은 미확인 | 해설 기사 | `Σ` |
| 방어 연구의 위험 설명 | 2025-11, 약 1%의 성공률도 의미 있는 위험이라고 설명 | Anthropic | `Ⓥ` |
| Chrome GA 평가 시점 | 2026-08, 전문 레드팀의 더 강한 공격 기준 | Anthropic Chrome GA 글 | `Ⓥ` |
| 스크린샷 인젝션 | 거의 보이지 않게 숨긴 글자도 명령으로 처리 | Brave의 Perplexity Comet 취약점 공개 | `✓` |
| Chrome 승인 설정 | GA 이후 자동 승인 기본, 행동마다 안전성 검토, 필요 시 확인. 수동 승인으로 변경 가능, Enterprise 사이트 allowlist·blocklist | Claude in Chrome | `✓` |
| 데스크톱 접근 통제 | 앱마다 첫 접근 허가. 투자·트레이딩·암호화폐 앱 기본 차단 | 데스크톱 computer use | `✓` |
| Gemini 확인 요청 | 모델이 `require_confirmation` 반환 | Gemini API | `✓` |
| 검토 응답 대기 | 유해 지시 감지 시 지정 검토자에게 메일, 응답 제한시간 경과 시 실행 중단 | Copilot Studio 문서 | `✓` |
| 격리와 자격증명 | 전용 VM·컨테이너, 최소 권한 계정. 로그인 정보나 API 키 같은 민감 데이터를 직접 주지 않음 | 공식 문서들 | `✓` |
| 이동 검사 | 리다이렉트 뒤에도 허용 목록 검사. `javascript:`·`file:`·`data:`·`chrome:` 스킴은 문자열 접두어 대신 URL 파서로 차단 | Anthropic | `✓` |
| 민감 정보 입력 | 구매·데이터 전송·파괴적 변경을 사용자 통제 아래 두며, 폼에 민감 정보를 입력하는 것도 전송으로 간주 | OpenAI 가이드 | `✓` |
| 세션 리플레이 | 세션 전체를 영상처럼 되감는 기능을 기본으로 명시한 1차 문서는 찾지 못함 | — | `?` |
| Python 샘플 권한 | 사용자 권한으로 샌드박스 없이 실제 마우스와 키보드 제어 | OpenAI 샘플 앱 | `✓` |
| quickstart 실행 위치 | 에이전트 루프가 조작 대상 컨테이너 안에서 실행되는 최소 참조 구현 | Anthropic quickstart | `✓` |
| 2FA·OTP 정책 | 에이전트에 넘기는 명시 정책을 찾지 못함 | — | `?` |
| 2FA·OTP 취급 판단 | Comet 사례를 고려하면 사람이 직접 다루는 편이 안전 | Comet 사례 | `Σ` |

{{% /details %}}

## 8. 직접 시험할 경로를 고른다

플랫폼 엔지니어가 먼저 가치를 확인하기에는 Playwright MCP와 코딩 에이전트 조합이 적합해 보입니다. 접근성 트리로 처리할 수 있는 일을 먼저 시험할 수 있기 때문입니다. 픽셀 기반 조작 자체를 보고 싶다면 Anthropic 데모가 직접적이고, 설치를 간단히 끝내려면 Claude in Chrome이 편합니다. 로컬 모델로 비용을 줄이는 실험에는 Browser Use와 Ollama를 쓸 수 있습니다.

### 8.1 Anthropic computer-use-demo: 화면 조작 루프를 본다

Docker와 `ANTHROPIC_API_KEY` 또는 Bedrock·Vertex 설정이 있으면 Linux 데스크톱 컨테이너를 띄울 수 있습니다. 브라우저에서 에이전트가 화면을 조작하는 과정을 확인합니다. 이미지 이름은 `ghcr.io/anthropics/anthropic-quickstarts:computer-use-demo-latest`이며, 해상도는 `WIDTH`와 `HEIGHT`로 정합니다. README는 XGA(1024×768)를 권장합니다.

API 종량제가 적용되고 비용의 대부분은 스크린샷 토큰입니다. README의 기본 모델 표기는 Claude Opus 4.8이지만 갱신이 늦었을 수 있어 실제 설정을 확인해야 합니다. 컨테이너라 격리하기 쉽더라도 인증 없는 포트를 공개하지 않는 편이 안전해 보입니다. 장기간 업무를 맡기는 완성품보다는 동작을 살펴보는 참조 구현에 가깝습니다.

### 8.2 Claude in Chrome: 설치 후 간단한 작업부터 시작한다

Claude in Chrome은 Chrome 전용 확장입니다. 유료 플랜(Pro·Max·Team·Enterprise)에 포함되며, 다른 Chromium 계열 브라우저와 모바일은 지원하지 않습니다. 예약 작업, 워크플로 녹화, Claude Code 연동을 사용할 수 있습니다.

설치가 쉬운 만큼 현재 로그인 세션을 그대로 쓴다는 점을 기억해야 합니다. 안전 지원 문서는 연구나 폼 작성처럼 단순한 작업부터 시작하고 금융·법률·의료·민감한 업무 계정은 피하라고 권합니다. 별도 브라우저 프로필을 사용하는 편이 안전합니다.

### 8.3 Playwright MCP: 접근성 트리로 해결되는지 확인한다

Node.js가 있다면 `claude mcp add playwright npx @playwright/mcp@latest`로 코딩 에이전트에 연결할 수 있습니다. 기본 관찰 수단은 접근성 스냅샷입니다. 좌표 클릭이 필요할 때 `--caps vision`으로 활성화합니다. 배포 뒤 UI 스모크 확인이나 대시보드 점검을 코딩 에이전트 안에서 시험하는 경로입니다.

비용은 코딩 에이전트 구독이나 API에 포함됩니다. 세션과 접근 범위는 `--isolated`, `--allowed-origins`·`--blocked-origins`, `--storage-state`로 제한합니다. README는 Playwright MCP를 보안 경계가 아니라고 적습니다.

README는 코딩 에이전트라면 Playwright CLI와 스킬 조합이 MCP보다 토큰 효율이 나을 수 있다고 안내합니다. 큰 도구 스키마와 긴 접근성 트리를 컨텍스트에 넣지 않기 때문입니다. 이 경로 역시 화면이 필요한 일을 코드로 처리할 수 있는지 살펴보는 선택지입니다.

### 8.4 Browser Use와 로컬 모델: 작은 작업으로 한계를 확인한다

비용을 0에 가깝게 줄여보려면 Browser Use와 Ollama 조합이 있습니다. Python 3.12와 uv를 사용하는 설치 순서는 `uv pip install browser-use`, `uvx browser-use install`입니다. 모델은 `ChatOllama(model="qwen3-vl:8b")`처럼 연결합니다. 공식 문서의 예시는 `llama3.1:8b`입니다. 비전이 없는 모델에는 `use_vision=False`를 설정합니다. 메모리와 컨텍스트, 타임아웃 조건은 아래에 모았습니다.

이 경로는 기대를 작게 잡는 편이 좋습니다. 개인 블로그의 비독립 관찰에서는 8B 모델이 단순 조회는 대체로 수행했지만 다단계 검색·비교, 로그인, 팝업이 섞이면 대부분 실패했습니다. 작은 모델이 잘못된 JSON 액션 스키마를 내는 문제도 보고됐습니다. 같은 글은 Ollama 비전 모델의 JSON 문제가 2026-08 기준 미해결이라고 설명합니다. 로컬 소형 모델은 데모 수준으로 접근하는 편이 맞습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| computer-use-demo | 포트 8080(통합 UI)·6080(noVNC)·5900(VNC)·8501(Streamlit), `WIDTH`/`HEIGHT`, XGA 권장, 기본 모델 표기 Opus 4.8(README 갱신 지연 가능) | computer-use-demo README | `✓` |
| Claude in Chrome 요건 | Chrome 전용, 유료 플랜, 디버거 권한. 예약 작업·워크플로 녹화·Claude Code 연동 | [시작하기](https://support.claude.com/en/articles/12012173-getting-started-with-claude-for-chrome) | `✓` |
| Playwright MCP | 접근성 스냅샷 기본, `--caps vision`, "not a security boundary", `--isolated`·`--allowed-origins`·`--storage-state`, CLI+스킬 권장 | [playwright-mcp](https://github.com/microsoft/playwright-mcp) | `✓` |
| Browser Use + Ollama | 설치 순서, `ChatOllama`, 8GB VRAM+8B 최소·24GB+30B 안정, 8B는 단순 조회만 | [Browser Use 모델 문서](https://docs.browser-use.com/customize/supported-models), 개인 블로그(2026-09-06) | `✓ / Ⓥ` |
| 데모 실행 요건 | Docker와 `ANTHROPIC_API_KEY` 또는 Bedrock·Vertex 설정. Linux 데스크톱 컨테이너의 조작 모습을 브라우저에서 확인. 이미지 `ghcr.io/anthropics/anthropic-quickstarts:computer-use-demo-latest`, XGA(1024×768) 권장 | computer-use-demo README | `✓` |
| 데모 포트 취급 | 컨테이너라 격리는 쉽지만 공개 포트를 인증 없이 열지 않도록 주의 | — | `≈` |
| Chrome 지원 범위 | Pro·Max·Team·Enterprise, 다른 Chromium 계열 브라우저와 모바일은 미지원 | — | `✓` |
| Chrome 출시와 기능 | 2026-08-26 GA, 예약 작업·워크플로 녹화·Claude Code 연동 | — | `✓` |
| Chrome 시작 작업 | 연구·폼 작성 같은 단순 작업부터 시작, 금융·법률·의료·민감한 업무 계정 회피 | 안전 지원 문서 | `✓` |
| 플랫폼 엔지니어의 체험 경로 | Playwright MCP와 코딩 에이전트 조합을 먼저 추천 | — | `Σ` |
| CLI와 스킬의 효율 | 큰 도구 스키마와 긴 접근성 트리를 컨텍스트에 싣지 않아 코딩 에이전트에서는 MCP보다 토큰 효율이 나을 수 있음 | Playwright MCP README | `✓` |
| Browser Use 설치·모델 | Python 3.12와 uv, `uv pip install browser-use` 뒤 `uvx browser-use install`. `ChatOllama(model="qwen3-vl:8b")`로 연결. 최소 VRAM 8GB·8B, 안정권 24GB 이상·30B급 | 개인 블로그 | `Ⓥ` |
| Ollama 설정 | `num_ctx` 32768, 타임아웃 120초, 비전 없는 모델은 `use_vision=False` | — | — |
| Ollama 공식 예시 | 공식 예시는 `llama3.1:8b` | 공식 문서 | `✓` |
| 소형 모델의 실패 | 8B는 단순 조회를 대체로 수행하지만 다단계 검색·비교와 로그인·팝업이 끼면 대부분 실패. 잘못된 JSON 액션 스키마 출력, Ollama 비전 모델 JSON 문제는 2026-08 기준 미해결 | 개인 블로그의 비독립 관찰 | `Ⓥ` |

{{% /details %}}

## 9. 언제 CUA를 쓰고 언제 쓰지 않나

| 단계 | 쓰는 때 | 근거 |
|---|---|---|
| API·CLI 에이전트 | API나 CLI가 있을 때. 화면이 필요 없다 | SRE 에이전트 제품은 API·CLI·로그로 동작한다. 관리형 경로가 있는 일은 CUA 대상이 아니다 |
| 접근성 트리·DOM | 화면은 필요하지만 웹이고 구조가 읽힐 때 | 비전 모델이 필요 없고 토큰이 적다. 웹 안에서 끝나는 일은 브라우저 툴셋·Playwright MCP |
| 코드 우선 | 화면의 상태를 코드로 읽고 쓸 수 있을 때 | OpenAI의 code execution 권고, StateAct의 비용 약 1/9 |
| 픽셀 CUA | 위가 모두 막혔을 때. 레거시 데스크톱, 캔버스, 원격 데스크톱, API가 없는 포털 | a16z의 운영 사례도 결정적 자동화가 깨질 때의 대체 경로로 쓴다 |

위 단계에서 해결되면 아래로 내려갈 필요가 없습니다. API나 CLI가 있으면 그 경로를 쓰고, 웹 화면이 필요하면 접근성 트리와 DOM을 확인합니다. 코드로 상태를 읽고 쓸 수 있는지도 살핀 뒤, 남은 작업에 픽셀 CUA를 검토합니다.

마지막 단계까지 내려왔다고 도입 결정이 끝나지는 않습니다. 다음 조건도 확인해야 합니다.

- 작업 빈도. 월에 한 번 하는 클릭 작업은 하네스를 작성한 비용을 회수하지 못합니다. 하루 천 건 단위로 반복한다면 판단이 달라집니다.
- 복구 가능성. 되돌릴 수 없는 행동에는 사람 확인이 필요합니다. 확인을 자주 받아야 한다면 완전 자동화의 이점은 줄어듭니다.
- 허용 지연. 사람이 3분에 하는 일을 에이전트가 10분에 처리해도 괜찮은지 확인합니다. 백그라운드로 돌릴 수 있는 일이 적합합니다.
- 결과 검증. 결과를 기계적으로 판정할 수 있어야 합니다. 그럴듯한 오독이 가장 비싼 실패입니다.
- 사람에게 넘길 수 있는지. 로그인, 2FA, CAPTCHA를 사용자에게 넘길 수 없다면 처음부터 대상에서 제외합니다.

이 글의 판단으로는 API 없는 외부 포털을 반복 처리하는 백오피스, 지연이 중요하지 않은 UI 테스트, 사람이 곁에서 승인하는 개인 생산성 작업이 CUA에 맞습니다. 플랫폼·SRE 팀에서는 API 없는 벤더 포털의 저빈도 작업과 배포 뒤 화면 검증이 후보입니다. 쿠버네티스 조작, 인증서 갱신, 알림 처리에는 이미 API와 CLI가 있어 화면 조작을 거칠 이유가 없어 보입니다.

도입하기로 했다면 도구 형식의 변경도 감당해야 합니다. Anthropic은 새 모델에서 구형 도구 타입을 거부하기 시작했고, OpenAI는 같은 API 안에서도 권장 방식을 코드 실행으로 옮기고 있습니다. 특정 벤더의 도구 형식에 업무 로직을 직접 묶기보다 얇은 어댑터로 감싸 두는 편이 교체 비용을 줄이는 데 도움이 될 것으로 보입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 판단 순서 | API·CLI → 접근성 트리·DOM → 코드 우선 → 픽셀 CUA. 위 단계로 해결되면 다음 단계로 내려가지 않음 | — | — |
| 코드 우선 비용 근거 | StateAct의 작업당 비용 약 1/9 | StateAct | — |
| 빈도 판단 | 월에 한 번 하는 클릭 작업은 하네스 작성 비용을 회수하지 못하며, 하루 천 건 단위 반복이면 판단이 달라짐 | — | — |
| 지연 판단 | 사람이 3분에 하는 일을 에이전트가 10분에 처리해도 허용되는지 확인 | — | — |
| 적합한 업무 | API 없는 외부 포털의 반복 백오피스, 지연이 중요하지 않은 UI 테스트, 사람이 승인하는 개인 생산성 작업. 플랫폼·SRE에서는 API 없는 벤더 포털의 저빈도 작업과 배포 뒤 화면 검증이 후보 | — | `Σ` |
| 제외할 업무 | 쿠버네티스 조작, 인증서 갱신, 알림 처리는 이미 API·CLI가 있어 CUA를 거칠 이유가 없음 | — | `Σ` |
| Anthropic 도구 변경 | 새 모델부터 구형 도구 타입 거부 | — | `✓` |
| OpenAI 권장 방식 | 같은 API 안에서도 권장 방식을 코드 실행으로 이동 | — | `✓` |
| 하네스 설계 판단 | 벤더 도구 형식과 로직 사이에 얇은 어댑터를 두면 교체 비용을 줄일 수 있음 | — | `Σ` |

{{% /details %}}

## 10. 확인하지 못한 것

- OpenAI 1차 문서(openai.com, help.openai.com)는 이 조사 환경에서 403으로 막혔습니다. ChatGPT agent·Work의 제품 설명, Operator 출시일, takeover·watch mode 원문, 플랜별 사용 한도는 2차 출처로만 확인했습니다. GPT-6 Astra와 GPT-6.1 Sol의 출시일과 OSWorld 2.0 수치도 2차 출처에 의존했습니다.
- Claude in Chrome GA 글의 Opus 4.5 수치는 조사 중 가져온 결과가 17.6%와 16.7%로 엇갈려 본문에서 제외했습니다.
- 플랫폼·SRE 업무에 CUA를 실제로 쓴 공개 사례와 수치는 찾지 못했습니다. 확인한 SRE 에이전트는 모두 API·CLI 기반이었습니다. 고객지원의 상담원 화면 조작과 QA 전용 SaaS의 정량 사례도 찾지 못했습니다.
- OSWorld 2.0·2.1에서 신형 모델(Opus 5.5, Fable 5.1, GPT-6 계열)의 이진 완료율은 확인하지 못했습니다. Holo4-27B의 61.7%와 Simular Sai 73%가 부분 점수인지 이진 완료율인지도 불명확합니다. 과제당 출력 토큰 244K가 평균인지 합인지 역시 확인하지 못했습니다.
- StateAct 논문(arXiv 2607.22798)은 원문을 보지 못했고 요약 기사로만 확인했습니다. Opus 5 시스템 카드의 인젝션 수치도 2차 보도에서만 확인했습니다.
- 로그인과 2FA의 실패율을 다룬 정량 연구, 2FA·OTP를 에이전트에 넘기는 벤더의 명시 정책을 찾지 못했습니다.
- Copilot Credit 단가의 Microsoft 1차 가격 페이지, Windows agent workspace의 현재 상태, Bedrock의 5.5 모델 도구 형식 허용 범위를 확인하지 못했습니다.
- Anthropic quickstart의 저장소 이름은 자료에 따라 `claude-quickstarts`와 `anthropic-quickstarts`로 다르게 나옵니다. Docker 이미지 이름과 현행 명령은 README에서 다시 확인해야 합니다.

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
