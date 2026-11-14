---
title: "PlayMCP, 제로부터 시작한 MCP 플랫폼 개발"
description: "카카오가 MCP 서버를 실험하고 공유하는 플랫폼 PlayMCP를 만들며 내린 설계 선택을 정리했습니다. Host와 Registry의 분리, Streamable HTTP와 stateless 선택, 인증 방식, AI 채팅의 Agent Loop와 MCP 서버 등록 가이드를 요약합니다."
date: 2026-11-14
weight: 1
---

# PlayMCP, 제로부터 시작한 MCP 플랫폼 개발 (2025-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [PlayMCP: 제로부터 시작하는 MCP 플랫폼 개발](https://tech.kakao.com/posts/734)
- 매체 · 게시일: 카카오 기술블로그 · 2025-09-08
- 저자: AI에이전트플랫폼 팀의 베니, 클룽, 홀든 (본문 자기소개)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## PlayMCP가 하는 일 {#소개}

카카오는 말만 잘하는 AI를 넘어 도구를 직접 써서 행동하는 AI를 다음 단계로 봅니다. "오늘 3시에 무슨 회의가 있어?"라는 질문에 답을 지어내는 대신, 캘린더를 열어 실제 일정을 확인해 알려 주는 AI입니다. AI에 도구를 연결하는 방식을 표준화한 프로토콜이 MCP(Model Context Protocol)이고, 이를 실험하고 서비스에 적용해 보려고 만든 플랫폼이 PlayMCP입니다.

PlayMCP는 2025년 7월 31일에 연 베타 서비스로, 카카오 AI 서비스에 연결할 MCP 서버를 실험하고 준비하는 개발자용 플랫폼입니다. 할 수 있는 일은 세 가지입니다. 카카오 내외부 개발자가 공개한 MCP 서버를 탐색해 바로 AI 채팅에 적용하고(현재는 카카오 서비스 관련 서버가 주로 올라와 있고 앞으로 늘 예정입니다), 채팅에서 어느 대화 흐름에 어떤 도구가 선택되는지와 인자가 어떻게 바인딩되는지를 툴 호출 로그 뷰어로 확인하며, 직접 만든 Remote MCP 서버를 임시 등록으로 조용히 테스트하거나 공개해 반응을 봅니다. 플레이그라운드이면서 마켓인 셈입니다.

## MCP가 필요했던 배경 {#mcp-배경}

MCP 이전에는 개발자가 만든 도구를 여러 LLM에 붙이려면 모델마다 다른 연동 방식에 맞춰 직접 작업해야 했습니다. 컴퓨터마다 독자 규격 포트만 있어 주변기기를 자유롭게 꽂을 수 없는 상황과 같았다는 비유를 원문이 씁니다. LLM 서비스 제공자도 사용자가 원하는 모든 도구를 직접 붙일 수 없어 제한된 범위만 지원했습니다. MCP는 이 사이에 AI 세계의 USB-C 같은 공통 인터페이스를 놓습니다. 서비스가 MCP를 지원하면 코딩을 모르는 사용자도 원하는 MCP 서버를 연결할 수 있습니다.

원문은 MCP 스펙이 계속 바뀌므로 AI에게 맥락 없이 물으면 틀린 답이 나올 수 있다는 팁도 줍니다. MCP 문서 페이지의 복사 기능으로 내용을 컨텍스트로 주면 할루시네이션을 피할 수 있고, 필자는 NotebookLM이 유용했다고 합니다.

## PlayMCP 아키텍처 {#아키텍처}

MCP는 Host, Client, Server의 세 컴포넌트로 이뤄진 Client-Server 구조입니다. Host는 Claude Code나 Claude Desktop 같은 AI 애플리케이션으로 여러 Client를 관리하고, Client는 서버 하나와 일대일 연결을 유지하며, Server는 컨텍스트(데이터, 기능)를 제공하는 프로그램입니다.

PlayMCP는 Host와 Client를 구현하고, 여기에 마켓 기능을 더했습니다. 연결에 필요한 엔드포인트와 인증 방식은 물론 탐색용 메타데이터(설명, 툴 정보)도 관리하며, 인증형 서버에는 사용자가 인증 정보를 안전하게 입력하는 플로우를 제공하고 연결할 때 저장해 둔 값을 Host로 넘깁니다. 원문의 개념도는 세 부분입니다. MCP Server Registry가 탐색과 등록을 맡고, MCP Host가 AI 채팅과 Client 관리를 맡으며, User-MCP Server Bindings가 사용자가 채팅에 적용한 서버 목록과 인증 정보를 저장합니다. 사용자가 프롬프트를 입력하면 PlayMCP가 Registry의 연결 정보와 Bindings의 인증 정보를 Host에 넘기고, Host가 Client로 서버에 연결해 도구를 LLM이 쓰게 합니다. Host 기능과 마켓 기능을 서로 다른 컴포넌트로 나눠 책임을 단순하게 하고 확장에 열린 코드를 얻었다고 합니다. 원문의 그림은 개념을 추린 것이어서 실제 구조와는 조금 다릅니다.

## Streamable HTTP와 stateful 연결 {#transport}

PlayMCP는 원격 MCP 서버만 지원하고 Streamable HTTP를 씁니다. 로컬 프로세스끼리 표준 입출력으로 통신하는 STDIO와 달리, 카카오 AI 서비스에 통합할 수 있는 서버를 발굴하는 것이 목표이기 때문입니다. Streamable HTTP는 단일 HTTP 요청/응답을 기본으로 하고 필요하면 SSE를 옵션으로 쓰며, bearer token, API key, 커스텀 헤더 같은 HTTP 표준 인증을 지원합니다.

MCP는 로컬 데스크톱 환경의 long-lived connection을 전제로 설계된 stateful 프로토콜입니다. 서버가 알림이나 샘플링 같은 메시지를 먼저 보낼 수 있고 연결이 끊겨도 세션 정보로 스트림을 재개할 수 있다는 장점이 있습니다. 하지만 원격 환경에서는 long-lived connection의 스케일링이 어렵고, 서버리스 배포에 맞지 않으며, 분산 환경에서 재연결 때 같은 인스턴스로 가지 않으면 세션이 무효화됩니다. 서버 구현을 단순하게 둔다는 MCP의 철학과도 어긋납니다. 이런 절충 때문에 Streamable HTTP는 stateless(HTTP POST)를 기본으로 하고 stateful(SSE)은 옵션입니다. PlayMCP의 AI 채팅도 SSE 옵션을 지원하지만 대부분의 서버가 stateless하게 동작할 것으로 보며, 샘플링처럼 stateful 특성이 필요한 기능은 아직 제공하지 않습니다. 모든 Operation 전에 Initialization Phase를 거쳐야 한다는 제약도 일반 REST API에는 없던 부담이라고 짚습니다. 원문은 커뮤니티도 이 충돌을 인지하고 논의 중이니 변화를 지켜보라고 권합니다.

## 인증 {#인증}

개인화되거나 보호된 리소스를 주려면 인증이 필요하고, MCP는 HTTP 표준 인증을 지원하며 OAuth 기반을 권장합니다. PlayMCP는 이를 두 가지로 추상화했습니다.

- Key/Token 인증(커스텀 헤더): 서버가 정한 커스텀 헤더로 키나 토큰을 전달하는 방식입니다. 구현이 쉬워 많은 MCP 서버가 쓰며, 개발자는 서버를 등록할 때 헤더 이름과 설명을 입력합니다.
- OAuth 인증: OAuth 2.0의 네 역할이 PlayMCP에서는 Resource Owner가 PlayMCP 사용자, Resource Server가 연결 대상 MCP 서버, Client가 PlayMCP 서비스, Authorization Server가 서버별로 연동된 외부 인증 서버로 매핑됩니다. 사용자의 인증 정보를 저장하고 서버에 전달하는 역할이 OAuth Client의 역할과 일치해 PlayMCP가 Client를 맡습니다.

PlayMCP가 서버 제공자를 대신해 Authorization Server에 Client를 등록하는 것은 현실적으로 불가능합니다. 그래서 제공자가 미리 Client를 등록한 뒤 서버를 등록할 때 Client ID, Client Secret, Authorize Endpoint, Token Endpoint, Scope, Grant Type을 입력합니다. 현재는 Authorization Code Grant만 지원하고, 보안 위협을 줄이려고 MCP 스펙에도 있는 PKCE(code_verifier, code_challenge)를 씁니다.

## 서버 정보 조회와 AI 채팅의 Agent Loop {#채팅-구조}

PlayMCP는 MCP Registry로서 등록 정보를 조회하고, 서버마다 Initialization Phase로 ProtocolVersion, Capabilities, ServerInfo를 얻고, Listing Tools로 tool 정보를 가져옵니다. 서버가 여럿이면 병렬로 처리합니다.

AI 채팅은 대화 기록을 Dialogue 엔티티로 영속화합니다. 각 레코드는 Content(텍스트, 이미지, ToolCall, ToolResult)와 Role(USER, ASSISTANT, TOOL), 토큰 사용량을 가집니다. 예를 들어 "오늘 날씨 어때?"는 USER 레코드로 저장되고, AI 모델이 Tool 사용 여부와 종류(Tool Selection), 넣을 인자(Argument Binding)를 정해 ToolCall을 돌려주면 PlayMCP가 서버를 호출해 결과를 TOOL 레코드로 쌓습니다. 모델은 이를 바탕으로 답을 만들어 ASSISTANT 레코드로 남깁니다. 최종 응답이 나올 때까지 모델 호출과 도구 실행을 반복하는 이 순환을 원문은 Agent Loop라 부르고, 중심에 요청 처리와 문맥 관리를 맡은 Agent(PlayMCP)가 있습니다.

채팅이 시작되면 사용자가 적용한 MCP 서버 목록을 조회해 서버마다 Initialization과 tools/list를 병렬로 수행하고, 툴 정보를 묶어 한 번의 Agent Loop 동안 쓰는 Dialogue 세션을 만듭니다. 이어 AI 모델과 SSE로 연결해 누적된 Dialogue를 프롬프트로 전달합니다. Tool Call이 필요하면 서버에 tools/call을 보내고 결과를 Dialogue에 쌓아 다시 모델에 넘깁니다. 모델에서는 delta 단위로 응답을 받아 클라이언트로 SSE 그대로 전달하며, 진행 상태를 보이려고 `Progress`, `ToolCall`, `Complete`, `Error` 이벤트를 발행합니다.

## MCP 서버 구현과 등록 {#서버-구현-등록}

MCP SDK로 서버를 쉽게 만들 수 있지만, 원문 작성 시점(2025-08-25)에 Kotlin SDK는 Streamable HTTP를 지원하지 않았습니다. 디버깅에는 MCP Inspector를 쓸 수 있습니다. 등록되는 서버는 capabilities를 밝히고 PlayMCP가 호출하는 Listing Tools(`tools/list`)와 Calling Tools(`tools/call`)를 구현해야 합니다. 원문은 애니메이션 조회·추천 API를 Tool로 감싸는 의사 코드와 `/mcp` 엔드포인트 노출 예를 보입니다.

Tool 구현 팁은 다음과 같습니다.

- 토큰 소비를 고려해야 합니다. tool spec은 영어로 쓰는 편이 토큰이 적게 듭니다.
- 응답이 너무 크면 PlayMCP가 에러로 처리할 수 있습니다.
- 모델이 잘 이해하도록 직렬화한 데이터보다 JSON, YAML, Markdown 같은 포맷된 문자열로 응답하는 것이 좋습니다.
- 프롬프트는 GPT-5, GPT-4.1 프롬프팅 가이드를 참고하라고 안내합니다.

등록은 MCP Endpoint를 입력하고 '정보 불러오기'를 눌러 ListingTools 결과로 서버 정보를 확인한 뒤 진행합니다. 비공개로 두려면 '임시 등록'을 하고 나중에 심사를 요청할 수 있습니다. 채팅에서는 여러 툴 중 프롬프트에 맞는 Tool Selection, Tool 패널의 Argument Binding, 툴 간 병렬·순차 실행이 의도대로 되는지 확인하라고 권합니다.

원문은 PlayMCP가 이제 막 시작한 베타 서비스이며 개발자들과 소통하며 발전시켜 가겠다고 맺습니다.

{{% details title="PlayMCP 구성 값" closed="true" %}}

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
