---
title: "초밥 홍보 메시지를 보내는 LINE Messaging API MCP 서버"
description: "Claude 데스크톱에서 날씨에 맞는 초밥 홍보 메시지를 보내려면 어떻게 연결해야 할까요? LINE Messaging API와 Brave Search의 MCP 툴을 연결하면 날씨를 검색하고, 그 결과로 홍보 문구를 작성해 공식 계정의 친구들에게 전송할 수 있습니다."
date: 2026-11-14
weight: 15
---

# 초밥 홍보 메시지를 보내는 LINE Messaging API MCP 서버 (2025-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [MCP 개념 및 LINE Messaging API를 활용한 MCP 서버 구축 사례 소개](https://techblog.lycorp.co.jp/ko/introduction-to-mcp-and-building-mcp-server-using-line-messaging-api)
- 매체 · 게시일: LY Corporation Tech Blog · 2025-05-02
- 저자: 한창구
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

일본 초밥집 '오이시'를 운영하며 LINE 공식 계정으로 마케팅하는 상황을 가정해 보겠습니다. Claude 데스크톱에 이런 요청을 입력합니다.

> 나는 초밥집 '오이시'의 사장님이야. 고객들에게 초밥을 홍보하는 메시지를 보내줘.

요청은 문구 작성에서 끝나지 않습니다. 공식 계정을 친구로 추가한 고객에게 실제 메시지를 보내는 일까지 포함합니다. 이때 Claude 데스크톱과 LINE Messaging API를 연결하는 것이 MCP 서버입니다.

## 실제 Armeria 저장소를 조회하는 MCP {#why-mcp}

LLM만으로 답하는 것과 외부 서비스를 사용하는 것의 차이는 코드 검색에서도 드러납니다. LINE의 오픈소스 라이브러리 Armeria에서 특정 코드를 찾아 달라고 요청해도, LLM만 단독으로 쓰면 실제 GitHub에 접속하지 않고 학습한 내용으로 답합니다. 환각이 생길 수 있는 지점입니다. GitHub MCP를 사용하면 애플리케이션이 실제 Armeria 저장소를 검색하고 그 결과를 바탕으로 응답합니다.

MCP(Model Context Protocol)는 이처럼 LLM이 외부 데이터나 기능을 사용하도록 Anthropic이 공개한 오픈 프로토콜입니다. 연결에는 양쪽의 지원이 필요합니다. 외부 기능을 제공하는 MCP 서버가 있어야 하고, LLM 애플리케이션도 MCP로 서버를 호출해야 합니다. GitHub은 실제로 MCP 서버를 제공합니다.

서버가 제공하는 기능은 툴로 실행합니다. GitHub MCP의 `create_pull_request`는 PR을 만드는 툴입니다. 파일 내용이나 데이터베이스 레코드, API 응답 같은 데이터는 리소스로 제공할 수 있습니다. GitHub MCP에서 저장소의 소스 코드를 제공하는 `repo://{owner}/{repo}/contents{/path*}`가 그 예입니다. 클라이언트가 리소스 목록을 요청하고 필요한 데이터를 가져오면, 호스트가 이를 프롬프트 응답에 활용합니다.

## LINE Messaging API를 호출하는 서버 {#building-server}

먼저 LINE 쪽을 준비합니다. 공식 계정을 만들고 Messaging API를 활성화해 채널을 생성한 뒤, LINE Developer Console에서 채널 액세스 토큰을 발급받습니다. 자신의 LINE 계정으로 해당 공식 계정을 친구로 추가하는 과정도 필요합니다.

MCP 서버를 만들기 전에 메시지가 도착하는지부터 확인합니다. 셸에서 채널 액세스 토큰을 `Authorization` 헤더에 넣고 `broadcast` API(`https://api.line.me/v2/bot/message/broadcast`)를 호출합니다. 친구로 추가한 공식 계정에서 메시지가 오면 API 사용 준비가 끝난 것입니다.

서버는 Python으로 만듭니다. `uv`를 설치한 뒤 `uv init line-mcp`로 프로젝트를 생성하고, 가상 환경을 만들고 활성화한 다음 `uv add "mcp[cli]" httpx`로 의존성을 추가합니다. `main.py`에서는 `FastMCP("line", ...)`로 서버를 초기화하고 `@mcp.tool` 데코레이터로 `broadcast_message`를 등록합니다.

이 툴이 하는 일은 전달받은 메시지를 LINE Messaging API로 보내는 것입니다. 환경 변수 `CHANNEL_ACCESS_TOKEN`을 읽어 Bearer 토큰을 만들고, `Content-Type`과 중복 요청을 막기 위한 `X-Line-Retry-Key`를 헤더에 넣습니다. 재시도 키에는 UUID를 사용합니다. 이 헤더와 메시지를 담아 `broadcast` 엔드포인트를 호출하면 공식 계정의 모든 친구에게 메시지를 보냅니다.

툴의 `description`에는 `messages` 매개변수가 최대 5개의 메시지를 허용하며, 지원하는 텍스트 메시지의 형식이 무엇인지 적습니다. 서버는 `mcp.run(transport="stdio")`로 실행하도록 작성합니다. `uv run main.py`로 정상 구동을 확인하면 Claude 데스크톱에 연결할 차례입니다.

## Claude 데스크톱에서 시작되는 툴 호출 {#connecting}

이 예제에서 Claude 데스크톱은 사용자의 요청을 받고 응답하는 MCP 호스트입니다. 호스트 내부의 클라이언트가 외부 MCP 서버에 요청을 보내고 결과를 돌려받습니다. 앞서 만든 `line-mcp`가 그 서버이며, LINE Messaging API를 호출하는 일을 맡습니다.

설치한 Claude 데스크톱에서 `claude_desktop_config.json`을 열고 `mcpServers`에 `line-mcp`를 등록합니다. `command`에는 `uv`, `args`에는 프로젝트 위치와 `main.py`, `env`에는 `CHANNEL_ACCESS_TOKEN`과 발급받은 토큰을 넣습니다. macOS에서 `uv`가 제대로 동작하지 않으면 셸에서 `which uv`로 경로를 확인해 `command`에 입력합니다.

설정을 저장하고 Claude 데스크톱을 실행하면 서버도 자동으로 시작됩니다. 설정한 `command`와 `args`에 따라 서버를 실행하는 방식입니다. 연결이 정상이라면 화면에 망치 표시와 함께 사용할 수 있는 MCP 툴이 나타납니다.

이제 '오이시'의 홍보 요청이 어떻게 발송까지 이어지는지 볼 수 있습니다. 호스트는 실행 시 클라이언트로 서버의 `tools/list`를 호출해 툴 목록을 받아 둡니다. 사용자가 프롬프트를 입력하면 이 목록을 프롬프트와 함께 LLM에 전달합니다. LLM은 요청의 '메시지를 보내'라는 부분에서 `broadcast_message`가 필요하다고 판단합니다.

툴을 고른 뒤에는 호출이 이어집니다. 호스트가 `description`에 적힌 형식에 맞춰 요청을 만들고, 클라이언트가 서버의 `tools/call`을 호출하면 서버가 LINE Messaging API로 메시지를 전송합니다. Claude 데스크톱의 플러그 표시로 툴 사용을 확인하고, LINE에서 공식 계정이 보낸 메시지도 확인할 수 있습니다.

툴 응답은 다시 호스트로 돌아옵니다. 가장 기초적인 동작 방식에서는 호스트가 이 결과와 원래 프롬프트를 LLM에 전달하고, LLM이 생성한 최종 응답을 가공해 사용자에게 보여 줍니다.

## 내일 날씨를 찾는 Brave Search {#wrap-up}

날씨에 따라 먹고 싶은 초밥이 달라질 수 있다는 데서 다음 요청이 출발합니다.

> 나는 초밥집 '오이시'의 사장님이야. 내일 날씨에 어울리는 초밥을 홍보하는 메시지를 보내줘

이 요청에는 날씨 정보가 필요합니다. 예제에서는 검색 기능을 제공하는 Brave Search MCP 서버를 추가했습니다. 사용하려면 Brave Search에 가입하고 API 키를 발급받아야 합니다.

LLM은 프롬프트의 '내일 날씨'를 보고 `brave` 서버의 `brave_web_search` 툴을 선택합니다. 호스트가 클라이언트로 툴을 호출하면 Brave Search가 날씨를 검색해 돌려줍니다. 호스트는 그 정보로 날씨에 어울리는 초밥 홍보 문구를 작성한 뒤, `line-mcp`의 `broadcast_message`를 호출합니다. 메시지는 LINE 공식 계정을 친구로 등록한 고객에게 전송됩니다.

LINE은 직접 구축해 보는 이 예제 외에도 공식 MCP 서버를 GitHub의 `line/line-bot-mcp-server`에 공개했습니다. 원문이 나온 2025년 5월, 저자는 이런 외부 서비스 연동이 LLM을 더 강력한 도구로 만들고 생산성을 높일 것으로 기대했습니다. OpenAI 같은 다른 모델 제공자도 MCP를 도입하거나 자체 프로토콜을 구축할 것이라는 전망도 함께 제시했습니다.

{{% details title="예제에 사용한 설정" closed="true" %}}

| 항목 | 값 |
|---|---|
| 호스트 | Claude 데스크톱 애플리케이션 |
| 툴 이름 | `broadcast_message` (메시지 최대 5개) |
| 호출 엔드포인트 | `https://api.line.me/v2/bot/message/broadcast` |
| 서버 전송 방식 | stdio |
| 의존성 | `mcp[cli]`, `httpx` |
| 응용에 쓴 MCP 서버 | Brave Search(`brave_web_search`) |

{{% /details %}}
