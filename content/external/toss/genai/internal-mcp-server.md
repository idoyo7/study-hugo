---
title: "API 스펙 공유를 바꾼 Spring-AI 기반 Swagger MCP"
description: "API 스펙 링크를 반복해서 찾아 공유하던 토스는 Spring-AI로 Swagger MCP 서버를 만들었습니다. LLM이 필요한 정보를 나누어 조회하도록 하고, 세션 유실과 토큰 초과 문제를 해결해 API 연동을 자동화할 길을 열었습니다."
date: 2026-11-14
weight: 3
---

# API 스펙 공유를 바꾼 Spring-AI 기반 Swagger MCP (2025-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [API 연동 자동화를 위한 여정: 토스는 왜 사내 MCP 서버를 개발하였는가? with Spring-AI](https://toss.tech/article/internal-mcp-server)
- 매체 · 게시일: 토스 기술 블로그 · 2025-10-27
- 저자: 조민규 (토스 Server Developer)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 며칠 지난 스레드 속 Swagger 링크 {#background}

링크를 한 번 보낸다고 끝나지 않았습니다. 조민규 개발자는 새 API를 만들 때마다 Swagger에서 링크를 찾아 사내 메신저로 공유했지만, 스펙을 다시 보내 달라는 요청을 하루에도 몇 번씩 받았습니다. 연동하는 개발자마다 문서를 확인하는 시점이 달랐기 때문입니다. 며칠 지난 스레드에서 링크를 다시 찾아야 했고, 그사이 스펙까지 바뀌면 공유 과정은 더 복잡해졌습니다.

Swagger MCP는 이 반복에서 출발했습니다. 비즈니스 로직 없이 데이터를 주고받는 API 호출 코드라면, LLM에 스펙을 제공해 작성을 자동화할 수 있겠다는 생각이었습니다. 도입 뒤에는 서버 개발자가 외국인 여권 등록 API 개발을 마쳤다고 알리면 됩니다. 연동하는 개발자는 MCP로 스펙에 바로 접근해 LLM에 분석이나 호출 로직 구현을 맡길 수 있게 됐습니다.

## 서버 호출을 이끄는 MCP Prompts {#mcp-building-blocks}

MCP(Model Context Protocol)는 AI 모델과 외부 도구를 연결하는 표준 프로토콜입니다. 이전에는 도구를 연결할 때마다 맞춤형 플러그인이나 커넥터를 따로 만들어야 했고, 호환성도 부족했습니다. MCP는 도구가 같은 프로토콜을 따르면 모델과 쉽게 연결할 수 있다는 목표로 등장했습니다.

MCP 서버가 제공하는 기능은 누가 선택하고 관리하느냐에 따라 구분됩니다.

| 기능 | 제어 주체 | 제공 내용 |
|---|---|---|
| Prompts | 사용자 | 명시적으로 선택해 호출하는 대화형 템플릿 |
| Resources | 애플리케이션 | 파일 내용, Git 히스토리 같은 컨텍스트 데이터 |
| Tools | 모델 | API 호출, 파일 쓰기처럼 작업을 수행하는 함수 |

Tools는 LLM이 사용자 프롬프트와 대화 맥락을 보고 필요한 시점에 호출합니다. 그런데 실제로는 MCP 서버를 호출하지 않는 일이 잦았습니다. 토스는 서버 이름과 API 설명을 인자로 받는 `search-toss-servers-apis` 프롬프트를 추가했습니다. 클라이언트는 이 프롬프트로 MCP 서버 호출을 강제할 수 있습니다.

## 토큰 한도에 맞춰 나눈 Swagger 조회 {#swagger-mcp-steps}

API가 많은 서버의 전체 스펙을 LLM에 주자 토큰 초과 에러가 났습니다. 그대로 넘기기에는 양이 많았습니다. 미사용 API를 제거하고 Swagger JSON에서 불필요한 정보를 줄였으며, 사용자·어드민·디버깅 같은 용도로 API를 묶어 그룹 키를 페이징 키로 쓰는 방식도 도입했습니다.

Swagger MCP는 전체 서비스 목록에서 시작해 필요한 API의 상세 정보로 조회 범위를 좁혀 갑니다. 중앙 Swagger 관리 서버인 SwaggerCenter에서 serviceName, domain, Swagger 주소 등을 가져오되, 테스트용 서비스는 제외하고 유효한 Swagger 주소가 있는 서비스만 담습니다.

특정 서비스를 조회할 때는 해당 서버에서 Swagger JSON을 가져옵니다. 이 단계에서는 URL, HTTP Method, operationId, summary 같은 정보만 남깁니다. 복잡하고 큰 원본을 단순화해 API를 찾는 데 필요한 내용을 제공하는 방식입니다.

상세 조회에는 `serviceName`, `apiGroup`, `requestUrl`, `httpMethod`를 사용합니다. 해당 API의 parameters, requestBody, responses를 추출하되, `$ref`로 연결된 컴포넌트 스키마는 참조 경로만 남겨 둡니다. 컴포넌트 정의는 별도로 조회합니다. `#/components/schemas/ComponentName` 형태의 경로를 파싱해 해당 스키마를 반환하므로, API 상세와 참조된 컴포넌트를 나누어 가져오게 됩니다.

## 세션 끊김 뒤에 선택한 Spring-AI 설정 {#spring-ai-setup}

첫 시도는 SSE였습니다. 세션이 빈번하게 끊겨 사실상 이용이 불가능했습니다. MCP가 2025년 3월 26일부터 Streamable HTTP를 공식 전송 방식으로 바꾸고 Spring-AI가 1.1.0부터 이를 지원하면서 본격적으로 활용할 수 있게 됐습니다. 글 작성 시점에는 1.1.0-M3가 pre-release였기 때문에 정식 출시 전 버전으로 개발했습니다.

사내 원격 서버에는 Stateless Streamable-HTTP를 골랐습니다. SSE나 일반 Streamable-HTTP는 배포하거나 연결이 끊길 때 세션이 유실돼 사용이 불편했기 때문입니다. Stateless 방식은 요청 사이에 세션 상태를 유지하지 않아 MSA 환경에 적합합니다. 네트워크 I/O가 많을 것으로 예상해 실행 모드는 ASYNC로 정했습니다.

Tools 구현에는 선언형인 `@Tool` 애너테이션을 썼습니다. 프로그래밍 방식의 `MethodToolCallback`도 제공되지만, 저자는 선언형을 선호했습니다. 현재 시간을 반환하는 `DateTimeTools` 예제에서는 `description`으로 도구의 용도를 알리고, `@ToolParam`으로 시간대 인자를 설명합니다. LLM이 언제 어떻게 호출할지 이해하도록 정보를 주는 부분입니다. 개발 중 문제 지점을 찾는 데에는 MCP Inspector가 큰 도움이 됐습니다.

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

## LLM에 넘기기 전에 바로잡은 Swagger 문서 {#problems-and-fixes}

스펙을 조회하는 기능만으로는 충분하지 않았습니다. LLM에 정확한 API 정보를 주려면 Swagger 문서의 표현부터 바로잡아야 했습니다. SpringDoc은 기본적으로 클래스 이름을 키로 사용하므로, 패키지가 달라도 이름이 같은 클래스는 충돌합니다. `springdoc.use-fqn=true`를 설정해 전체 패키지 이름을 포함하도록 해결했습니다.

ArgumentResolver로 파라미터를 객체로 받는 경우에도 문제가 있었습니다. Swagger에 원본 값 대신 객체 정보가 노출됐습니다. 토스는 `OperationCustomizer`를 구현해 객체 표현을 제거하고 `user-id` 헤더 같은 원본 값이 나타나도록 했습니다.

## 개발 중인 Swagger 작성 워크플로 {#wrap-up}

Swagger 작성 자체를 자동화하는 GitHub Actions 워크플로도 개발 중입니다. Controller 파일 변경을 감지하면 Gemini AI로 `@Tag`, `@Operation`을 추가하고, 변경사항을 커밋해 PR 브랜치로 푸시한 뒤 PR 코멘트로 결과를 공유하는 흐름입니다.

아직 문서 작성까지 완벽하지는 않습니다. LLM에 도메인 지식이나 작업 맥락이 부족해 정확하게 작성하지 못하는 경우가 있어, RAG 구성이나 추가 컨텍스트 제공이 필요할 것으로 보고 있습니다. Swagger MCP Tools 외에 Elasticsearch MCP Tools도 준비 중입니다.

여기서 다룬 내용은 시스템 개발을 위한 연구·개발 환경에서만 사용할 수 있습니다. 망분리된 내부망과의 통신은 없습니다.
