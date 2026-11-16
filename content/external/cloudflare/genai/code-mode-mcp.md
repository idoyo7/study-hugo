---
title: "Cloudflare API를 1,000토큰으로 여는 Code Mode"
description: "API 엔드포인트가 늘어날 때마다 MCP 도구 설명도 늘어나야 할까요? Cloudflare는 탐색과 실행을 코드로 처리하는 서버 측 Code Mode로 전체 API의 도구 정의를 약 1,000토큰으로 유지합니다."
date: 2026-11-16
weight: 15
---

# Cloudflare API를 1,000토큰으로 여는 Code Mode (2026-02)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Code Mode: give agents an entire API in 1,000 tokens](https://blog.cloudflare.com/code-mode-mcp)
- 매체 · 게시일: The Cloudflare Blog · 2026-02-20
- 저자: Matt Carey
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 제품별 MCP 서버가 따라잡지 못한 Cloudflare API {#context-pressure}

Cloudflare는 처음에 제품마다 MCP 서버를 만들었습니다. DNS를 관리하려면 DNS MCP 서버를, Workers 로그를 보려면 Workers Observability MCP 서버를 연결하는 식이었습니다. 각 서버가 API 작업에 대응하는 고정된 도구 목록을 제공했지만, 엔드포인트가 2,500개를 넘어서자 수작업으로 관리하는 서버들로는 API의 확장을 따라갈 수 없었습니다.

모델의 문맥 창에도 부담이 쌓였습니다. 에이전트에게 유용한 일을 맡기려고 도구를 추가할수록 설명이 공간을 차지하고, 실제 작업에 쓸 여유는 줄어듭니다. tiktoken으로 비교한 결과, Code Mode 없이 전체 Cloudflare API를 제공하는 동등한 MCP 서버에는 입력 토큰 117만 개가 필요했습니다.

새 Cloudflare MCP 서버가 공개하는 도구는 `search()`와 `execute()`뿐입니다. DNS, Zero Trust, Workers, R2를 포함한 전체 API를 다루면서 도구 정의는 약 1,000토큰으로 유지합니다. 기존 방식보다 99.9% 줄어든 수치입니다. 이 비교는 도구 정의가 차지하는 문맥 비용을 측정한 것으로, 작업 전체의 토큰 소비나 실행 속도를 뜻하지는 않습니다.

## 오리진 보호 설정을 찾아가는 네 번의 호출 {#ddos-example}

사용자가 오리진을 DDoS 공격으로부터 보호해 달라고 요청했다고 가정합니다. 에이전트는 먼저 문서를 읽고 오리진 앞에 Cloudflare WAF와 DDoS 보호 규칙을 배치해야 한다는 정보를 얻습니다. API 탐색은 그 뒤입니다.

`search()`에 보내는 것은 JavaScript 코드입니다. 에이전트는 zone 경로에서 WAF와 ruleset 엔드포인트를 추린 뒤, 한 차례 더 호출해 응답 스키마의 phase 값을 살펴봅니다. 여기서 DDoS 보호에 쓸 `ddos_l7`와 WAF에 쓸 `http_request_firewall_managed`를 확인합니다. 전체 명세를 문맥에 넣지 않고도 호출할 대상과 필요한 값을 찾았습니다.

이제 `execute()` 차례입니다. 기존 ruleset의 이름, phase, kind를 조회하자 관리형 DDoS와 WAF ruleset이 이미 존재한다는 사실이 드러납니다. 에이전트는 이어지는 한 번의 실행에서 각 진입점의 설정을 가져옵니다.

명세 검색부터 스키마 검사, ruleset 목록 조회, DDoS·WAF 설정 조회까지 도구 호출은 총 4회입니다. 규칙을 검사하고 민감도를 조정하는 작업도 한 실행에서 연결할 수 있지만, 예시에 제시된 코드는 설정 조회에서 끝납니다. 실제 민감도를 바꾼 결과까지 보여주는 예시는 아닙니다.

## 압축된 계획을 실행하는 MCP 서버 {#server-side-design}

Code Mode에서 코드는 압축된 계획입니다. 모델은 타입이 있는 SDK를 대상으로 코드를 작성해 작업을 탐색하고 여러 호출을 조합한 뒤 필요한 데이터만 반환합니다. Cloudflare가 앞서 소개한 방식이며, Anthropic도 별도로 같은 패턴을 탐구했습니다.

새 서버의 `search()`는 `$ref`를 미리 인라인으로 해석한 OpenAPI 명세를 코드에 제공합니다. 에이전트는 타입이 있는 명세 표현을 대상으로 제품, 경로, 태그 등의 조건을 작성하고 실행 결과를 받습니다. 명세 전체는 문맥에 들어오지 않습니다. `execute()`에는 인증된 `cloudflare.request()` 클라이언트가 주어지므로, 한 번의 실행 안에서 API 호출과 페이지네이션, 응답 확인, 후속 작업을 연결할 수 있습니다.

코드를 실행할 곳도 서버가 마련합니다. 두 도구는 생성된 코드를 Dynamic Worker isolate라는 가벼운 V8 샌드박스에서 실행합니다. 파일 시스템이 없고, 프롬프트 인젝션으로 유출될 환경 변수도 없습니다. 외부 fetch는 기본적으로 비활성화되며, 필요한 외부 요청은 outbound fetch handler로 명시적으로 제어할 수 있습니다.

새 제품이 추가돼도 검색과 실행 경로는 그대로입니다. 같은 코드 경로가 새 엔드포인트를 발견하고 호출하므로 도구 정의나 MCP 서버를 추가하지 않아도 됩니다. GraphQL Analytics API도 지원합니다.

## 샌드박스를 서버로 옮긴 Code Mode {#scaling-and-alternatives}

Cloudflare가 처음 시도한 클라이언트 측 Code Mode에서는 모델이 타입이 있는 SDK를 대상으로 TypeScript를 작성하고, 클라이언트의 Dynamic Worker Loader에서 실행했습니다. 이 방식에는 조건이 붙습니다. 에이전트 환경에 안전한 샌드박스 접근 수단이 있어야 합니다.

CLI도 에이전트가 탐색하면서 기능을 알아가는 방법입니다. 하지만 셸을 제공해야 하고, 공격 표면도 샌드박스 isolate보다 넓습니다. Claude Code에서 사용하는 동적 도구 검색은 현재 작업과 관련 있을 만한 도구를 추려 보여줍니다. 문맥 사용량은 줄지만 검색 기능을 유지하고 평가해야 하며, 검색된 각 도구도 토큰을 소비합니다.

서버 측 Code Mode는 실행 환경을 서버가 맡도록 했습니다. 에이전트를 수정할 필요 없이, 에이전트는 도구 두 개에 코드를 전달하고 서버는 탐색과 실행을 처리합니다. API 규모와 무관하게 도구 정의의 토큰 비용을 고정하면서 기능을 점진적으로 발견하게 하는 방식입니다. Cloudflare는 개발자가 자체 MCP 서버와 에이전트에도 이 방식을 적용하도록 Cloudflare Agents SDK에 새 Code Mode SDK를 오픈 소스로 공개했습니다.

## 연결할 때 정하는 에이전트의 권한 {#connection-permissions}

전체 API를 탐색할 수 있다고 해서 모든 작업이 허용되지는 않습니다. 새 MCP 서버는 OAuth 2.1을 준수하며, 연결할 때 사용자가 승인한 권한으로 Workers OAuth Provider가 토큰 범위를 축소합니다. 에이전트는 명시적으로 허용받은 기능만 사용합니다.

CI/CD나 자동화에서 직접 토큰을 관리하려면 필요한 권한으로 Cloudflare API 토큰을 만들 수 있습니다. 사용자 토큰과 계정 토큰을 모두 지원하며, `Authorization` 헤더에 bearer token으로 전달합니다.

## 단일 API 너머의 Cloudflare MCP Server Portals {#results-and-next-steps}

Cloudflare API 하나의 문맥 비용을 줄여도 에이전트의 연결 대상은 하나로 끝나지 않습니다. GitHub, 데이터베이스, 내부 문서 서버까지 필요하다면 MCP 서버를 추가할 때마다 처음의 문맥 부담이 다시 생깁니다.

Cloudflare MCP Server Portals는 여러 MCP 서버를 인증과 접근 제어가 통합된 게이트웨이 뒤에 구성합니다. Cloudflare는 여기에 Code Mode를 직접 통합하는 기능을 개발 중입니다. 게이트웨이 뒤에 서비스가 몇 개 있든 고정된 토큰 규모를 유지하고, 필요한 기능을 점진적으로 탐색하게 하는 것이 목표입니다.

{{% details title="토큰 비교와 실행·인증 세부값" closed="true" %}}
| 항목 | 값 |
|---|---|
| Cloudflare API 규모 | 엔드포인트 2,500개 초과 |
| 공개 도구와 문맥 크기 | `search()`, `execute()`의 도구 정의 약 1,000토큰 |
| Code Mode 없는 동등한 MCP 서버 | 입력 토큰 117만 개 |
| 입력 토큰 절감률 | 대규모 Cloudflare API 비교에서 99.9%, tiktoken으로 측정 |
| DDoS 예시의 도구 호출 | 명세 검색, 스키마 검사, ruleset 목록 조회, DDoS·WAF 설정 조회까지 총 4회 |
| 예시에서 확인한 phase | DDoS 보호 `ddos_l7`, WAF `http_request_firewall_managed` |
| OAuth 규격 | OAuth 2.1 준수 |
| 직접 토큰 인증 | 사용자 토큰과 계정 토큰 지원, `Authorization` 헤더의 bearer token으로 전달 |
{{% /details %}}
