---
title: "Cloudflare의 MCP 확산을 받친 포털과 Code Mode"
description: "MCP 사용이 전사로 퍼질 때 서버 관리와 토큰 비용을 어떻게 감당할까요? Cloudflare는 공용 플랫폼과 포털에 인증·접근 통제를 모으고, Code Mode로 필요한 도구를 찾아 쓰게 해 도구 정의 비용을 줄였습니다."
date: 2026-11-16
weight: 12
---

# Cloudflare의 MCP 확산을 받친 포털과 Code Mode (2026-04)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Scaling MCP adoption: Our reference architecture for simpler, safer and cheaper enterprise deployments of MCP](https://blog.cloudflare.com/enterprise-mcp)
- 매체 · 게시일: The Cloudflare Blog · 2026-04-14
- 저자: Sharon Goldberg, Matt Carey, Ivan Anguiano
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 배포할 때부터 통제를 갖춘 공용 MCP 플랫폼 {#governed-remote-servers}

Cloudflare의 MCP 사용은 엔지니어링 조직을 넘어 제품, 영업, 마케팅, 재무 팀까지 퍼졌습니다. 직원들은 MCP로 프로젝트 관리 플랫폼, 내부 위키, 문서와 코드 관리 플랫폼에 접근합니다. 과제는 직원들의 일을 늦추지 않으면서 권한의 무분별한 확산, 프롬프트 인젝션, 공급망 위험을 관리하는 일이었습니다.

MCP에는 AI와 기업 자원을 분리하는 경계가 있습니다. MCP client는 LLM이나 AI agent와 연결되고, MCP server는 client와 기업 자원 사이에서 자격 증명과 API를 다룹니다. 에이전트가 자율적으로 행동하더라도 이 경계는 유지됩니다. 문제는 서버를 누가 고르고 관리하느냐였습니다.

로컬 MCP server는 검증되지 않은 소프트웨어나 버전에 의존할 수 있어 공급망 공격과 도구 인젝션의 위험을 키웁니다. IT·보안 관리자의 손도 닿기 어렵습니다. 직원마다 서버를 선택하고 업데이트까지 책임지게 하는 방식으로는 이 관리 문제를 풀 수 없었습니다.

Cloudflare는 중앙 팀이 monorepo에 공용 MCP 플랫폼을 구축하도록 했습니다. 내부 자원을 MCP로 제공하려는 직원은 AI governance 팀의 승인을 받고, 템플릿을 복사해 도구 정의를 작성한 뒤 배포합니다. 쓰기 작업 기본 거부, 감사 로깅, 자동 생성 CI/CD 파이프라인, secrets 관리가 템플릿에 포함됩니다. 기본 틀을 준비하는 데는 몇 분이면 충분했습니다. 통제를 플랫폼에 내장한 덕분에 새 서버를 만드는 일과 관리 기준을 적용하는 일이 함께 이뤄졌습니다.

CI/CD는 custom domain을 쓰는 원격 MCP server를 Cloudflare Developer platform에 배포합니다. 중앙 팀은 소프트웨어 출처와 직원들의 사용 현황을 관리하고, 서버는 글로벌 데이터센터에 자동 배포되어 직원이 어디에 있든 낮은 지연으로 접근하도록 합니다.

내부 자원을 다루는 서버의 인증도 템플릿에 들어 있습니다. OAuth provider인 Cloudflare Access가 로그인을 보호하고 access token을 발급하며, SSO·MFA와 IP 주소, 위치, 기기 인증서 같은 맥락 정보를 확인합니다. 누구나 접근하도록 제공하는 Cloudflare 문서나 Cloudflare Radar의 MCP server와 달리, 내부 서버는 권한 있는 직원만 접근해야 하기 때문입니다.

## 권한에 맞춰 도구를 보여 주는 MCP server portal {#access-and-portals}

서버를 중앙에서 관리하자 다음에는 발견의 문제가 생겼습니다. 원격 MCP server가 늘어날수록, 특히 MCP에 익숙하지 않은 직원에게는 자신이 쓸 수 있는 서버를 찾는 일부터 장애물이 됐습니다.

MCP server portal은 이 접근 경로를 한곳에 모읍니다. 직원이 MCP client를 포털에 연결하면 사용 권한이 있는 내부·외부 MCP server가 나타납니다. 포털에는 중앙 로깅과 일관된 정책 집행, 데이터 유출 방지를 위한 DLP 통제도 있습니다. 관리자는 누가 어느 포털에 로그인했는지 확인하고, 특정 MCP server로 개인정보가 전달되지 않도록 규칙을 만들 수 있습니다.

포털에 들어올 권한과 포털에서 보여 줄 도구는 따로 정합니다. 예를 들어 재무 그룹에만 열어 둔 포털에는 내부 코드 저장소 MCP server의 읽기 전용 도구를 노출할 수 있습니다. 회사 노트북을 사용하는 엔지니어링 팀을 위한 별도 포털이라면 같은 서버의 읽기·쓰기 도구까지 제공하는 구성이 가능합니다. 같은 서버를 연결해도 포털마다 접근 조건과 도구 범위를 달리하는 방식입니다.

Cloudflare에서 호스팅하는 서버뿐 아니라 다른 곳에서 운영하는 외부 서버도 연결할 수 있습니다. Cloudflare 호스팅 서버를 사용하는 경로에는 성능상의 이점도 있습니다. 포털, 원격 MCP server, Cloudflare Access가 같은 물리 머신에서 실행되므로, 이 구성 요소 사이를 지나는 요청은 머신 밖으로 나갈 필요가 없습니다.

## 필요한 도구부터 찾는 Code Mode {#code-mode}

몇 달 동안 MCP를 대량으로 사용하면서 Cloudflare는 토큰 비용도 만만치 않게 치렀습니다. API 작업마다 도구를 하나씩 정의하고 그 정의를 전부 에이전트에게 전달하는 방식이 문제였습니다. 수천 개 endpoint를 가진 플랫폼에서는 실제 작업을 시작하기도 전에 도구 정의가 context window를 빠르게 소모합니다.

앞선 글에서 Cloudflare는 자사 MCP server에 서버 측 Code Mode를 적용해, Cloudflare API의 수천 개 endpoint를 제공하면서 토큰 사용량을 99.9% 줄인 사례를 소개했습니다. 도구를 미리 전부 알려 주는 대신 모델이 필요한 도구를 검색하고 코드로 실행하게 했습니다. 이번에는 그 방식을 MCP server portal에도 출시했습니다.

포털이 client에 노출하는 도구는 `portal_codemode_search`와 `portal_codemode_execute`입니다. 검색 도구는 연결된 모든 MCP server의 도구 정의를 반환하는 `codemode.tools()`를 제공합니다. 모델은 JavaScript로 이 정의들을 필터링하고 탐색해 필요한 정보만 가져옵니다. 전체 schema를 컨텍스트에 넣지 않아도 도구 이름과 매개변수를 알아낼 수 있습니다.

실행 도구에서는 `codemode` proxy가 각 도구를 호출 가능한 함수로 제공합니다. 모델이 작성한 JavaScript는 여러 작업을 연결하고, 결과를 걸러 내고, 오류를 처리합니다. 이 코드는 Dynamic Workers 기반의 포털 sandbox에서 실행됩니다.

Jira 티켓에 Google Drive 문서 내용을 추가하는 예시가 이 차이를 보여 줍니다. 먼저 Jira와 Drive 관련 도구를 검색한 뒤, 실행 호출 하나에 티켓 검색, 문서 읽기, 티켓 설명 갱신을 연결합니다. 검색 한 번과 실행 한 번으로 끝납니다. 일반 방식이라면 두 MCP server의 전체 도구 schema를 먼저 받고, 작업을 수행하는 도구 호출도 각각 나눠 총 3회 실행해야 합니다.

내부 포털에 서버 4개만 연결해도 도구는 52개였습니다. 정의만으로 약 9,400토큰을 차지했지만, Code Mode에서는 포털 도구 2개의 정의에 약 600토큰이 들어 약 94% 줄었습니다. 서버를 더 연결해도 이 정의 비용은 늘지 않습니다. 여기서 고정되는 것은 포털 도구의 정의 비용이며, 전체 워크플로의 토큰 사용량이 아닙니다.

Code Mode는 포털 URL에 `?codemode=search_and_execute`를 붙여 활성화합니다. Cloudflare가 다른 기업에 권하는 출발점도 기존 원격·외부 MCP server를 포털 뒤에 두고 Code Mode를 켜는 구성입니다.

LLM 연결의 비용 통제에는 AI Gateway를 사용합니다. Cloudflare는 이를 MCP client와 LLM 사이에 두었습니다. 이 위치에서 LLM provider를 빠르게 교체해 vendor lock-in을 피하고, 직원별 토큰 사용량을 제한할 수 있습니다.

## 포털 밖의 MCP를 찾아내는 Cloudflare Gateway {#gateway-controls}

승인된 서버로 가는 경로를 마련해도 포털을 거치지 않는 사용은 남습니다. Cloudflare Gateway는 직원의 인터넷 트래픽에서 이런 비인가 원격 MCP server 사용, 즉 shadow MCP를 찾는 데 쓰입니다.

탐지에는 여러 신호를 함께 사용합니다. `httpHost`로 알려진 MCP hostname과 `mcp.*` 패턴을 찾고, `httpRequestURI`로 `/mcp`, `/mcp/sse` 같은 경로를 검사합니다. 주소에 `mcp`나 `sse`라는 흔적이 없어도 DLP 본문 검사로 찾을 수 있습니다. MCP가 HTTP 위에서 JSON-RPC를 사용하므로, 요청 본문의 `method` 필드에 있는 `initialize`, `tools/call`, `prompts/get` 같은 값도 탐지 단서가 됩니다.

발견한 뒤의 처리도 정할 수 있습니다. Gateway API와 custom DLP profile을 조합해 트래픽을 차단하거나 리디렉션하고, 또는 기록한 뒤 payload를 검사하도록 구성합니다. 이 탐지 범위는 기업 네트워크를 거쳐 접근하는 원격 MCP server입니다.

## 공개 MCP server를 위한 AI Security for Apps {#public-servers-and-next-steps}

Cloudflare는 직원용 서버 외에 고객이 자사 제품을 관리하고 운영하는 공개 MCP server도 Developer platform에서 제공합니다. 각 기업이 공식 MCP server를 직접 제공해야 한다는 것이 Cloudflare의 입장입니다. 고객이 공개 저장소에서 구한 미검증 서버에는 위험한 신뢰 가정, 공개되지 않은 데이터 수집, 승인되지 않은 동작이 들어 있을 수 있기 때문입니다. 공식 서버를 제공하면 고객이 사용하는 도구의 코드와 업데이트 주기, 보안 상태를 기업이 직접 관리하게 됩니다.

보호 방식은 다른 웹 API와 이어집니다. 원격 MCP server도 HTTP endpoint이므로 Cloudflare WAF 뒤에 배치할 수 있습니다. 고객은 WAF의 AI Security for Apps를 활성화해 유입 MCP 트래픽의 프롬프트 인젝션 시도와 민감정보 유출을 자동 검사하고, 주제를 분류할 수 있습니다.

{{% details title="Code Mode 비교 수치와 탐지 설정 예시" closed="true" %}}
| 항목 | 값 |
|---|---|
| 앞선 Cloudflare MCP server 사례 | Cloudflare API의 수천 개 endpoint를 제공하면서 토큰 사용량 99.9% 감소 |
| 내부 포털 비교 조건 | 내부 MCP server 4개 연결, 도구 52개 |
| 일반 방식의 도구 정의 비용 | 약 9,400 tokens |
| Code Mode의 도구 정의 비용 | 포털 도구 2개, 약 600 tokens, 약 94% 감소 |
| Jira·Google Drive 예시의 호출 수 | Code Mode는 검색·실행 2회, 일반 방식은 전체 schema 수신 후 개별 도구 호출 3회 |
| Code Mode 활성화 설정 | 포털 URL에 `?codemode=search_and_execute` 추가 |
| hostname 탐지 selector | `httpHost`로 알려진 MCP hostname과 `mcp.*` 패턴 검사 |
| URI 탐지 selector | `httpRequestURI`로 `/mcp`, `/mcp/sse` 같은 경로 검사 |
| DLP 본문 탐지 예시 | `initialize`, `tools/call`, `tools/list`, `resources/read`, `prompts/list` 등의 JSON-RPC method |
{{% /details %}}
