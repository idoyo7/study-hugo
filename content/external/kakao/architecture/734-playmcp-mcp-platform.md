---
title: "카카오 AI에 연결할 도구를 시험하는 실험실 PlayMCP"
description: "카카오는 AI가 쓸 도구를 시험하고 공유하기 위해 PlayMCP를 만들었습니다. 카카오 AI 서비스와의 통합을 준비하며 원격 MCP 서버를 지원한 이유와, 마켓·인증·AI 채팅을 연결해 도구 호출을 검증하는 과정을 설명합니다."
date: 2026-11-14
weight: 1
---

# 카카오 AI에 연결할 도구를 시험하는 실험실 PlayMCP (2025-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [PlayMCP: 제로부터 시작하는 MCP 플랫폼 개발](https://tech.kakao.com/posts/734)
- 매체 · 게시일: 카카오 기술블로그 · 2025-09-08
- 저자: AI에이전트플랫폼 팀의 베니, 클룽, 홀든 (본문 자기소개)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## AI와 도구를 잇는 공통 포트 MCP {#소개}

“오늘 3시에 무슨 회의가 있어?”라는 질문에 자연스러운 문장으로 답하는 것만으로는 부족합니다. 실제 일정을 확인해야 합니다. 카카오가 그리는 다음 단계의 AI는 사용자의 요청을 이해한 뒤 직접 캘린더를 열어 필요한 정보를 가져오는 AI입니다. PlayMCP는 그런 AI가 사용할 도구를 실험하고 서비스에 적용할 준비를 하려고 만든 공간입니다.

MCP 이전에도 LLM은 웹을 검색하고 코드를 작성했습니다. 어려움은 도구를 연결하는 과정에 있었습니다. 개발자는 같은 도구라도 모델마다 다른 연동 방식에 맞춰 작업해야 했고, LLM 서비스 제공자는 사용자가 원하는 모든 도구를 직접 연결할 수 없어 지원 범위를 제한해야 했습니다. 컴퓨터마다 독자 규격 포트만 있다면 주변기기를 자유롭게 꽂기 어려운 것과 같은 상황입니다.

MCP(Model Context Protocol)는 AI 세계의 USB-C를 지향합니다. LLM과 외부 도구 사이에 공통 인터페이스를 마련해 개별 연동의 부담을 줄이는 프로토콜입니다. 서비스와 도구가 MCP를 지원하면 복잡한 통합 작업 없이 연결할 수 있고, 코딩을 모르는 사용자도 원하는 MCP 서버를 연결해 쓸 수 있습니다.

2025년 7월 31일 공개된 PlayMCP는 이 규격으로 만든 서버를 시험하고 공유하는 개발자용 베타 플랫폼입니다. 공개된 서버를 AI 채팅에 적용하거나 자신이 만든 서버를 등록하고, AI가 어떤 도구를 골라 어떤 데이터를 주고받는지 확인하는 플레이그라운드이자 마켓입니다. 원문 발표 당시에는 카카오 서비스 관련 서버가 주로 공개돼 있었으며, 앞으로 더 다양한 서버를 공개할 예정이었습니다.

## 카카오 AI 연동을 위한 원격 MCP 서버 {#transport}

PlayMCP는 원격 MCP 서버만 지원합니다. 카카오 AI 서비스에 실제로 연결할 수 있는 서버를 발굴하고, 이후 통합하기 쉽게 하려는 선택입니다. 같은 머신의 로컬 프로세스끼리 표준 입출력으로 통신하는 STDIO 대신 Streamable HTTP를 사용했습니다. 단일 HTTP 요청·응답이 기본이며, 필요하면 SSE를 쓸 수 있고 bearer token, API key, 커스텀 헤더 같은 HTTP 표준 인증도 지원합니다.

원격 연결에는 세션 문제가 따라옵니다. MCP는 본래 로컬 데스크톱 애플리케이션에서 오래 유지하는 연결(long-lived connection)을 전제로 설계된 stateful 프로토콜입니다. 서버가 툴 목록 변경 알림이나 샘플링 같은 메시지를 먼저 보낼 수 있고, 연결이 끊겨도 세션 정보로 스트림을 재개할 수 있다는 장점이 있습니다.

이 연결을 원격 환경에서 유지하려면 부담이 커집니다. 스케일링이 어렵고 서버리스 배포에도 적합하지 않습니다. 여러 서버 인스턴스를 운영할 때 재연결 요청이 기존 인스턴스로 가지 않으면 세션이 무효화되는 문제도 있습니다. 상태를 관리하는 서버는 구현도 복잡해져, 서버를 단순하게 유지하려는 MCP의 철학과 충돌합니다.

Streamable HTTP는 stateless(HTTP POST)를 기본으로 두고 stateful(SSE)을 옵션으로 제공하는 절충안을 택했습니다. PlayMCP의 AI 채팅도 SSE 옵션을 지원합니다. 개발팀은 등록될 서버 대부분이 stateless하게 동작할 것으로 예상했으며, 샘플링처럼 stateful 특성이 필요한 기능은 당시 제공하지 않았습니다.

초기화 제약도 남아 있습니다. 모든 Operation에 앞서 Initialization Phase를 거쳐야 하는데, 일반적인 REST API라면 불필요한 과정입니다. MCP Host인 AI 애플리케이션이 서버 세션 정보를 보관해 초기화를 건너뛰는 방안도 있을 수 있지만, 분산 환경에서 세션을 관리하는 일은 확장성과 안정성 측면에서 부담입니다. 커뮤니티에서도 이런 충돌을 인지하고 논의와 개선을 이어가고 있습니다.

## 마켓에서 고른 서버를 연결하는 MCP Host {#아키텍처}

PlayMCP는 마켓과 채팅을 서로 다른 컴포넌트로 나눴습니다. 서버를 탐색하고 등록하는 기능은 MCP Server Registry에, AI 채팅과 MCP Client 관리는 MCP Host에 두었습니다. Host가 관리하는 Client는 각각 하나의 MCP Server와 연결을 유지하며 데이터와 기능을 전달받습니다. PlayMCP는 Host와 Client를 구현하면서 마켓의 책임을 분리해, 각 컴포넌트를 단순하게 유지하고 확장·개선할 수 있도록 했습니다.

사용자가 서버를 찾는 과정은 Registry에서 시작합니다. 이곳에는 서버 설명과 툴 정보 같은 탐색용 메타데이터뿐 아니라 엔드포인트와 인증 방식 같은 연결 정보도 있습니다. 마음에 드는 서버를 AI 채팅에 적용하면 그 선택을 User-MCP Server Bindings에 기록합니다. 인증이 필요한 서버라면 사용자가 입력한 인증 정보도 함께 저장합니다.

프롬프트를 입력할 때 이 정보들이 모입니다. PlayMCP는 프롬프트에 Registry의 서버 연결 정보와 Bindings의 사용자 인증 정보를 더해 Host로 전달합니다. Host는 Client로 해당 서버에 연결하고, 서버가 제공하는 도구를 LLM이 사용할 수 있게 합니다. 이 구분은 원문이 설명을 위해 단순화한 개념 구성으로, 실제 구조와는 조금 다릅니다.

Registry는 저장된 등록 정보만 조회하지 않습니다. 원격 서버마다 Initialization Phase를 거쳐 ProtocolVersion, Capabilities, ServerInfo를 확인하고, 툴 정보가 필요하면 Listing Tools(`tools/list`)를 호출합니다. 서버가 여럿이면 이 과정을 병렬로 처리합니다.

## PlayMCP가 보관하고 전달하는 사용자 인증 정보 {#인증}

서버 연결만으로는 사용자별 일정을 비롯한 개인화된 리소스나 보호된 리소스를 가져올 수 없습니다. 인증이 필요합니다. MCP는 Streamable HTTP에서 HTTP 표준 인증을 지원하고 OAuth 기반 인증을 권장하며, PlayMCP는 Key/Token과 OAuth 방식으로 인증 기능을 제공합니다.

Key/Token 인증에서는 서버가 정한 커스텀 HTTP 헤더에 키나 토큰을 담아 보냅니다. 인증 로직을 구현하기가 상대적으로 쉬워 많은 MCP 서버가 사용하는 방식입니다. PlayMCP도 이를 지원하며, 서버 개발자는 등록할 때 인증에 사용할 헤더 이름과 설명을 입력합니다.

OAuth 2.0의 역할로 보면 사용자는 Resource Owner이고, 연결할 MCP 서버는 Resource Server입니다. PlayMCP는 Client로서 서버별 외부 인증 서버인 Authorization Server에서 Access Token을 발급받습니다. 사용자의 인증 정보를 보관했다가 MCP 서버에 연결할 때 전달하는 것도 PlayMCP의 역할입니다.

여기에는 서버 제공자가 먼저 해야 할 작업이 있습니다. PlayMCP가 제공자를 대신해 외부 Authorization Server에 Client를 등록하는 것은 현실적으로 불가능하기 때문입니다. 제공자가 미리 Client를 등록한 다음, MCP 서버 등록 과정에서 Client ID, Client Secret, Authorize Endpoint, Token Endpoint, Scope, Grant Type을 입력해야 PlayMCP가 그 Client의 역할을 대행할 수 있습니다.

원문 발표 당시 지원하는 방식은 Authorization Code Grant뿐이었습니다. 인증 과정의 보안 위협을 줄이기 위해 MCP 스펙에 명시된 PKCE도 지원하며, 이 과정에서 `code_verifier`와 `code_challenge`를 사용합니다.

## 날씨 질문에서 시작하는 Agent Loop {#채팅-구조}

서버를 선택하고 인증을 마치면 채팅에서 도구를 사용할 준비가 됩니다. 사용자가 “오늘 날씨 어때?”라고 입력하면 PlayMCP는 질문을 기록하고, 채팅에 적용한 MCP 서버 목록을 조회합니다. 각 서버에 Initialization과 `tools/list`를 병렬로 수행한 뒤, MCP 정보와 툴 정보를 조합해 한 번의 Agent Loop 동안 사용할 논리적 세션인 Dialogue 세션을 만듭니다.

대화 기록은 Dialogue 엔티티로 영속화합니다. 각 레코드에는 텍스트·이미지·ToolCall·ToolResult를 담는 Content, 대화 주체를 나타내는 Role(USER, ASSISTANT, TOOL), 토큰 사용량이 있습니다. PlayMCP는 이 기록을 누적해 프롬프트를 구성하고 AI 모델에 전달합니다.

날씨 질문의 예제에서는 모델이 `GetWeatherTool`을 고르고 `date="2025-08-25"`를 인자로 정했다고 가정합니다. 어떤 도구가 필요한지 고르는 과정이 Tool Selection이고, 호출할 인자를 정하는 과정이 Argument Binding입니다. 모델이 ToolCall을 돌려주면 PlayMCP가 원격 MCP 서버에 Calling Tools(`tools/call`)를 요청합니다. 받은 결과는 TOOL 레코드로 기록하고 다시 모델에 전달하며, 모델이 만든 답변은 ASSISTANT 레코드로 남깁니다.

도구 호출 한 번으로 끝나는 흐름은 아닙니다. PlayMCP가 요청과 문맥을 관리하면서 최종 응답이 나올 때까지 모델 호출과 도구 실행을 반복하는 과정이 Agent Loop입니다.

이 반복이 끝날 때까지 사용자가 빈 화면을 보는 것은 아닙니다. PlayMCP는 AI 모델과 SSE로 연결해 응답을 delta 단위로 받고, 클라이언트와 연결한 채팅용 SSE 스트림에 그대로 전달합니다. 사용자는 생성 중인 답변을 실시간으로 확인하며, 화면에는 `Progress`, `ToolCall`, `Complete`, `Error` 이벤트로 Agent Loop의 진행 상태도 표시합니다.

## 애니메이션 API로 시험하는 MCP 서버 {#서버-구현-등록}

원문의 구현 예제는 애니메이션 조회·추천 API에서 출발합니다. `ListAnimation`은 선택적으로 `genre`를 받아 목록을 조회하고, 인자가 없으면 전체 목록을 반환합니다. `RecommendAnimation`은 추천 결과를 돌려줍니다. 이런 기능을 Tool로 제공하려면 MCP 서버가 capabilities를 명시하고, PlayMCP가 호출하는 `tools/list`와 `tools/call`을 구현해야 합니다. 예제에서는 `/mcp` HTTP 엔드포인트를 외부에 노출합니다.

서버 구현에는 MCP SDK를, 디버깅에는 MCP Inspector를 사용할 수 있습니다. SDK의 지원 범위는 확인해야 합니다. 2025-08-25 기준 Kotlin SDK는 Streamable HTTP를 지원하지 않았습니다.

Tool을 만들 때는 토큰 소비량도 고려해야 합니다. tool spec을 영어로 작성하는 편이 토큰 소비를 줄이는 데 유리하며, 응답이 너무 크면 PlayMCP가 에러로 처리할 수 있습니다. 개발팀은 모델이 이해하기 쉽도록 툴 응답에 JSON, YAML, Markdown 등으로 포맷한 문자열을 주는 방식을 권합니다. 프롬프트 작성 참고 자료로는 GPT-5와 GPT-4.1 프롬프팅 가이드를 제시했습니다.

스펙이 계속 바뀐다는 점은 학습 과정에도 영향을 줍니다. AI에게 MCP를 맥락 없이 물으면 잘못된 답변을 받을 수 있어, 원문은 MCP 문서 페이지의 복사 기능으로 내용을 제공한 뒤 그 자료를 바탕으로 설명하도록 요청하는 방법을 안내합니다. 저자는 학습할 문맥을 명확히 제공할 수 있는 NotebookLM을 유용하게 사용했다고 합니다.

서버를 준비했다면 MCP Endpoint를 입력하고 ‘정보 불러오기’를 눌러 ListingTools 결과로 서버 정보를 확인합니다. 비공개로 테스트하려면 ‘임시 등록’을 선택하고 나중에 심사를 요청할 수 있습니다. 등록한 서버를 AI 채팅에 적용한 뒤에는 툴 호출 로그 뷰어와 Tool 패널에서 실제 동작을 확인합니다.

- 여러 툴 가운데 프롬프트에 맞는 Tool Selection이 이뤄지는지
- Tool 패널에 표시된 Argument Binding이 의도와 일치하는지
- 툴 간 병렬·순차 실행이 예상한 흐름으로 발생하는지

{{% details title="PlayMCP 지원 범위와 구성 값" closed="true" %}}

| 항목 | 값 |
|---|---|
| 오픈일 | 2025년 7월 31일 (베타) |
| 지원 Transport | Streamable HTTP (원격 MCP 서버만) |
| 기본 동작 | stateless(HTTP POST), stateful(SSE)은 옵션 |
| 미제공 기능 | 샘플링 등 stateful 특성이 필요한 기능 |
| 인증 방식 | Key/Token(커스텀 헤더), OAuth (Authorization Code Grant만, PKCE 지원) |
| OAuth 등록 정보 | Client ID, Client Secret, Authorize Endpoint, Token Endpoint, Scope, Grant Type |
| Dialogue Role | USER, ASSISTANT, TOOL |
| 채팅 SSE 이벤트 | Progress, ToolCall, Complete, Error |
| 서버가 구현할 Operation | tools/list, tools/call |
| Kotlin SDK Streamable HTTP | 미지원 (2025-08-25 기준) |

{{% /details %}}
