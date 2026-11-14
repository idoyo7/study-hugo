---
title: "Spring-AI로 만든 사내 Swagger MCP 서버"
description: "토스가 API 스펙 공유 작업을 LLM에 맡기려고 Spring-AI로 Swagger MCP 서버를 만든 과정을 요약했습니다. Stateless Streamable-HTTP 선택과 토큰 초과, 프롬프트 추가 같은 운영 문제의 해결을 함께 다룹니다."
date: 2026-11-14
weight: 3
---

# Spring-AI로 만든 사내 Swagger MCP 서버 (2025-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [API 연동 자동화를 위한 여정: 토스는 왜 사내 MCP 서버를 개발하였는가? with Spring-AI](https://toss.tech/article/internal-mcp-server)
- 매체 · 게시일: 토스 기술 블로그 · 2025-10-27
- 저자: 조민규 (토스 Server Developer)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 도입 배경 {#background}

저자는 "저번에 공유했던 API 스펙 다시 공유주실 수 있나요?"라는 메시지를 하루에도 몇 번씩 받았다고 합니다. 새 API를 만들 때마다 Swagger에서 해당 API를 찾아 링크를 복사해 메신저로 공유해야 했고, API를 연동하는 개발자는 자기 개발 주기에 맞춰 확인하기 때문에 며칠 지난 스레드에서 링크를 다시 찾아야 했습니다. 스펙이 바뀌면 더 복잡했습니다.

API 호출 코드는 비즈니스 로직이 없는 단순한 데이터 교환이니 LLM에 스펙을 주면 자동화할 수 있겠다는 생각이 Swagger MCP 서버의 출발점입니다. 도입 뒤에는 서버 개발자가 "외국인 여권 등록 API 개발 완료했습니다"처럼 자연어로 알리기만 하면 되고, 연동하는 쪽은 MCP로 스펙에 바로 접근해 LLM에 분석이나 호출 로직 구현을 맡길 수 있습니다.

## MCP의 세 가지 빌딩 블록 {#mcp-building-blocks}

MCP(Model Context Protocol)는 AI 모델과 외부 도구를 잇는 표준 프로토콜입니다. 이전에는 도구마다 맞춤형 플러그인이나 커넥터를 따로 만들어야 했고 호환성도 부족했습니다. MCP 서버는 세 가지 기본 요소로 컨텍스트를 제공합니다.

- Prompts: 사용자가 선택해 호출하는 대화형 템플릿(슬래시 명령어 등). 제어 주체는 사용자입니다.
- Resources: 클라이언트가 첨부하고 관리하는 컨텍스트 데이터(파일 내용, Git 히스토리 등). 제어 주체는 애플리케이션입니다.
- Tools: LLM이 작업을 위해 호출하는 함수(API 호출, 파일 쓰기 등). 제어 주체는 모델입니다.

## Spring-AI 구성 {#spring-ai-setup}

MCP는 2025년 3월 26일부터 Streamable HTTP를 공식 전송 방식으로 바꿨고, Spring-AI는 `spring-ai-starter-mcp-server-webmvc`를 제공합니다. Streamable HTTP 지원은 Spring-AI 1.1.0부터인데 글을 쓴 시점에는 1.1.0-M3 pre-release였기 때문에, 정식 릴리즈가 아닌 버전으로 개발했습니다.

Spring-AI가 제공하는 서버 프로토콜은 STDIO, SSE, Streamable-HTTP, Stateless Streamable-HTTP입니다. 토스는 사내 원격 서버로 제공하려고 Stateless Streamable-HTTP를 택했습니다. SSE나 일반 Streamable-HTTP는 서버 배포나 연결 끊김 때 세션이 사라져 쓰기 불편했고, Stateless 방식은 요청 사이에 세션 상태를 유지하지 않아 MSA 환경에 맞습니다. 실행 모드는 네트워크 I/O가 많을 것으로 보고 ASYNC로 정했습니다.

Tools는 `@Tool` 애너테이션으로 선언합니다. 원문은 현재 시간을 돌려주는 `DateTimeTools`를 예로 들며, `description`을 LLM이 언제 어떻게 호출할지 이해하게 돕는 설명이라고 합니다. 프로그래밍 방식의 `MethodToolCallback`도 있지만 저자는 선언형을 선호해 이쪽을 썼습니다.

## Swagger MCP의 네 단계 {#swagger-mcp-steps}

Swagger MCP는 LLM과 여러 단계로 오가며 정보를 줍니다.

1. 전체 서비스 목록 조회: 중앙 Swagger 관리 서버 SwaggerCenter에서 serviceName, domain, Swagger 주소를 가져옵니다. 테스트용 서비스는 빼고 유효한 Swagger 주소가 있는 서비스만 담습니다.
2. 서비스별 API 스펙 조회: 해당 서버의 Swagger JSON을 받아 URL, HTTP Method, operationId, summary 같은 핵심만 남깁니다. 원본은 복잡하고 커서 단순화가 필요했습니다.
3. API 상세 조회: serviceName, apiGroup, requestUrl, httpMethod로 API를 찾아 parameters, requestBody, responses를 뽑습니다. `$ref`로 연결된 컴포넌트 스키마는 참조 경로만 넣습니다.
4. 컴포넌트 상세 조회: `#/components/schemas/ComponentName` 형태의 참조 경로를 파싱해 스키마 정의를 반환합니다.

## 겪은 문제와 해결 {#problems-and-fixes}

SSE 방식은 세션이 자주 끊겨 사실상 쓸 수 없었고, Spring-AI가 Streamable HTTP를 지원하면서 본격적으로 쓰게 됐습니다.

API가 많은 서버는 전체 스펙을 LLM에 주면 토큰 초과 에러가 났습니다. 세 가지로 풀었습니다.

- 미사용 API를 제거해 유지보수성과 LLM 컨텍스트를 개선했습니다.
- Swagger JSON에서 불필요한 정보를 덜어냈습니다.
- 페이징을 넣었습니다. API를 사용자, 어드민, 디버깅 같은 용도로 묶고 그룹 키를 페이징 키로 씁니다.

LLM이 MCP 서버를 호출하지 않는 일이 잦아서 Prompts를 추가했습니다. `search-toss-servers-apis`라는 프롬프트가 서버 이름과 API 설명을 인자로 받고, 클라이언트는 이 프롬프트로 MCP 서버 호출을 강제할 수 있습니다.

Swagger 쪽 문제도 둘 있었습니다. SpringDoc은 클래스 이름을 키로 쓰기 때문에 패키지가 다른 같은 이름의 클래스가 충돌해, `springdoc.use-fqn=true`로 전체 패키지 이름을 쓰게 했습니다. ArgumentResolver로 파라미터를 객체로 받는 경우에는 Swagger에 원본 값이 아니라 객체 정보가 나오므로, `OperationCustomizer`를 구현해 `user-id` 헤더 같은 원본 값으로 노출되게 했습니다.

LLM에 줄 스펙이 정확하려면 Swagger 문서부터 정확해야 합니다. 그래서 GitHub Actions로 Swagger 작성을 자동화하는 워크플로를 개발 중이라고 합니다. Controller 파일 변경을 감지해 Gemini로 `@Tag`, `@Operation`을 추가하고, 변경을 PR 브랜치에 커밋한 뒤 PR 코멘트로 결과를 알리는 흐름입니다. 다만 LLM이 도메인 지식이나 작업 맥락이 부족해 완벽하게 쓰지 못하는 경우가 있어 RAG나 추가 컨텍스트가 필요할 것으로 본다고 합니다.

## 마무리 {#wrap-up}

개발 중에는 MCP Inspector라는 디버깅 도구가 큰 도움이 됐습니다. Swagger MCP 외에 Elasticsearch MCP Tools 같은 기능도 준비 중이라고 합니다. 원문 끝에는 이 내용이 연구·개발 환경에서만 쓸 수 있고 망분리된 내부망과의 통신은 없다는 문구가 붙어 있습니다.

{{% details title="MCP 서버 설정값과 Tool 속성" closed="true" %}}

| 항목 | 값 |
|---|---|
| 의존성 | `spring-ai-starter-mcp-server-webmvc:1.1.0-M3` |
| 프로토콜 설정 | `spring.ai.mcp.server.protocol=STATELESS` |
| 실행 모드 | `spring.ai.mcp.server.type=ASYNC` |
| `@Tool` 속성 | name, description, returnDirect, resultConverter |
| `@ToolParam` 속성 | description, required (기본값 true) |
| 컴포넌트 이름 충돌 해결 | `springdoc.use-fqn=true` |

{{% /details %}}
