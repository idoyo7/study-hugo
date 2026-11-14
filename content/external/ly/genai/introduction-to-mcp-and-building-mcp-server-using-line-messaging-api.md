---
title: "MCP 개념과 LINE Messaging API MCP 서버 구축"
description: "MCP의 호스트·클라이언트·서버 구조와 툴·리소스 개념을 소개하고, LINE Messaging API의 broadcast 엔드포인트를 감싼 MCP 서버를 Python으로 만들어 Claude 데스크톱 앱에 연결한 과정을 정리했습니다."
date: 2026-11-14
weight: 15
---

# MCP 개념과 LINE Messaging API MCP 서버 구축 (2025-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [MCP 개념 및 LINE Messaging API를 활용한 MCP 서버 구축 사례 소개](https://techblog.lycorp.co.jp/ko/introduction-to-mcp-and-building-mcp-server-using-line-messaging-api)
- 매체 · 게시일: LY Corporation Tech Blog · 2025-05-02
- 저자: 한창구
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## MCP가 필요한 이유 {#why-mcp}

Model Context Protocol(MCP)은 Anthropic이 Claude와 함께 발표한 오픈 프로토콜로, LLM이 외부 데이터 소스나 기능을 쓸 수 있게 돕습니다. 원문의 예는 LINE의 오픈소스 라이브러리 Armeria에서 특정 코드를 찾는 상황입니다. LLM만 쓰면 실제 GitHub에 접속하지 않고 학습한 내용으로 답하므로 환각이 생길 수 있습니다. GitHub MCP를 쓰면 LLM 애플리케이션이 GitHub의 실제 Armeria 저장소를 검색하고 그 결과로 답합니다. 이를 위해서는 외부 서비스가 MCP 서버를 제공하고, LLM 애플리케이션도 MCP로 호출해야 합니다. GitHub은 실제로 MCP를 제공합니다.

## 구조와 구성 요소 {#architecture}

MCP는 호스트 안의 클라이언트가 서버와 연결되는 클라이언트-서버 구조입니다.

- 호스트는 MCP를 쓰는 LLM 애플리케이션입니다. 사용자 요청을 받아 응답하며, 예제에서는 Claude 데스크톱 애플리케이션입니다.
- 클라이언트는 호스트의 내부 모듈로, MCP 서버에 요청을 보내고 응답을 호스트에 전달합니다.
- 서버는 호스트 밖에서 클라이언트의 요청을 처리하는 애플리케이션입니다.

핵심 요소는 툴과 리소스입니다. 툴은 외부 기능을 실행하게 하는 요소로, 서버가 툴 목록을 보는 `tools/list`와 툴을 호출하는 `tools/call` 엔드포인트를 제공합니다. GitHub MCP 서버의 `create_pull_request`로 PR을 만드는 것이 예입니다. 리소스는 파일 내용, 데이터베이스 레코드, API 응답 같은 데이터나 콘텐츠입니다. 클라이언트가 리소스 목록을 요청한 뒤 필요한 것을 다시 요청하면 호스트가 이를 응답에 씁니다. GitHub MCP 서버의 `repo://{owner}/{repo}/contents{/path*}`가 저장소 소스 코드를 제공하는 예입니다.

가장 기초적인 동작 순서는 이렇습니다. 호스트가 실행될 때 `tools/list`로 툴 목록을 받아 오고, 사용자가 프롬프트를 보내면 호스트가 프롬프트와 툴 목록을 LLM에 넘깁니다. LLM이 쓸 툴을 고르면 호스트가 `tools/call`로 호출하고, 툴 응답과 원래 프롬프트를 다시 LLM에 보내 최종 응답을 만든 뒤 사용자에게 전달합니다.

## LINE Messaging API MCP 서버 만들기 {#building-server}

LINE 공식 계정(OA)용 Messaging API로 공식 계정을 친구로 등록한 사용자에게 메시지를 보낼 수 있습니다. 준비물은 Claude 데스크톱 애플리케이션, 그리고 공식 계정을 만들고 Messaging API 채널을 활성화해 발급받은 채널 액세스 토큰, 그 공식 계정에 대한 친구 추가입니다. 토큰을 `Authorization` 헤더에 넣고 셸에서 `broadcast` API(`https://api.line.me/v2/bot/message/broadcast`)를 호출해 메시지가 오면 준비가 끝난 것입니다.

서버 개발은 `uv`로 Python 프로젝트를 만들고(`uv init line-mcp`, `uv add "mcp[cli]" httpx`) `main.py`에 코드를 쓰는 방식입니다. `FastMCP("line", ...)`로 서버를 초기화하고 `broadcast_message`라는 툴을 `@mcp.tool` 데코레이터로 등록합니다. 이 툴은 환경 변수 `CHANNEL_ACCESS_TOKEN`으로 만든 헤더(Content-Type, Bearer 토큰, 중복 요청을 막는 `X-Line-Retry-Key`에 UUID)로 `broadcast` 엔드포인트를 호출합니다. `description`에는 `messages` 매개변수가 최대 5개까지 허용되고 텍스트 메시지를 지원한다는 점을 적었으며, 실행은 `mcp.run(transport="stdio")`입니다. `uv run main.py`로 구동해 확인합니다.

## Claude 데스크톱 연결과 사용 {#connecting}

호스트에 서버를 등록하려면 `claude_desktop_config.json`의 `mcpServers`에 `line-mcp`를 추가합니다. `command`에는 `uv`, `args`에는 프로젝트 위치와 `main.py`, `env`에는 채널 액세스 토큰을 넣습니다. macOS에서 `uv`가 제대로 동작하지 않으면 `which uv`로 경로를 확인해 넣으라고 안내합니다. 저장하고 Claude 데스크톱을 실행하면 서버가 자동으로 뜨고, 망치 표시와 함께 사용할 수 있는 툴이 보입니다.

시나리오는 일본 초밥집 '오이시'의 사장님이 공식 계정으로 마케팅하는 상황입니다. "고객들에게 초밥을 홍보하는 메시지를 보내줘"라고 입력하면 호스트가 `broadcast_message` 툴을 써서 실제로 공식 계정에서 메시지가 전송됩니다. 내부에서는 호스트 실행 때 `command`로 서버가 뜨고, `tools/list`로 목록을 받고, LLM이 "메시지를 보내" 부분에서 이 툴을 고르고, 호스트가 `description` 형식에 맞춰 요청을 만들어 `tools/call`로 호출하며, 서버가 LINE Messaging API에 요청을 보냅니다.

응용으로 Brave Search MCP 서버를 함께 썼습니다(Brave Search 가입과 API 키가 필요). "내일 날씨에 어울리는 초밥을 홍보하는 메시지를 보내줘"라고 하면, LLM이 "내일 날씨"에서 `brave_web_search` 툴을 골라 날씨를 검색하고, 호스트가 그 정보로 메시지를 작성한 뒤 `line-mcp`의 `broadcast_message`를 호출해 전송합니다.

## 마무리 {#wrap-up}

원문은 LLM을 외부 서비스와 함께 쓸 수 있으면 더 강력한 도구가 되고 생산성도 오를 것이라고 보며, OpenAI 같은 다른 모델 제공자도 MCP를 도입하거나 자체 프로토콜을 구축할 것으로 보인다고 전망합니다. LINE은 공식 MCP 서버를 GitHub(`line/line-bot-mcp-server`)에 공개했습니다.

{{% details title="예제의 주요 설정" closed="true" %}}

| 항목 | 값 |
|---|---|
| 호스트 | Claude 데스크톱 애플리케이션 |
| 툴 이름 | `broadcast_message` (메시지 최대 5개) |
| 호출 엔드포인트 | `https://api.line.me/v2/bot/message/broadcast` |
| 서버 전송 방식 | stdio |
| 의존성 | `mcp[cli]`, `httpx` |
| 응용에 쓴 MCP 서버 | Brave Search(`brave_web_search`) |

{{% /details %}}
