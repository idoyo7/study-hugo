---
title: "평범한 HTTPS 요청 속 MCP를 찾아내는 Cloudflare One"
description: "일반 HTTPS 요청처럼 보이는 MCP 연결을 어떻게 찾아 통제할까요? Cloudflare One은 프로토콜 헤더로 트래픽을 식별하고, Gateway와 MCP Portal로 관리 경로의 직접 연결을 통제합니다."
date: 2026-11-16
weight: 5
---

# 평범한 HTTPS 요청 속 MCP를 찾아내는 Cloudflare One (2026-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How Cloudflare detects MCP traffic and helps secure it](https://blog.cloudflare.com/mcp-security-updates)
- 매체 · 게시일: The Cloudflare Blog · 2026-08-14
- 저자: AJ Gerstenhaber, Kenny Johnson
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 점심에도 멈추지 않는 에이전트의 권한 {#permissions-and-agent-speed}

선임 엔지니어에게는 프로덕션 배포, 민감한 데이터베이스 조회, 다른 사용자의 접근 권한 회수까지 허용될 수 있습니다. 위험을 감수할 만한 전제가 있었습니다. 사람은 예상 밖의 결과를 보면 대개 멈춰 다시 생각하고, 하루에 클릭하고 입력하고 검토할 수 있는 양에도 한계가 있다는 가정입니다.

에이전트가 이 권한을 쓰기 시작하면 전제가 달라집니다. 판단은 비결정적이고, 같은 도구를 지치거나 점심을 먹으러 멈추는 일 없이 계속 호출할 수 있습니다. 그럴듯하지만 틀린 결정 하나가 사람이 알아채기 전에 수천 건의 잘못된 행동으로 번질 수 있다는 뜻입니다.

MCP는 에이전트가 SaaS, 내부 애플리케이션, API의 도구를 발견하고 호출하는 공통 방식입니다. 연결은 간단합니다. 직원은 Claude Code, Codex, Cursor 등에 설정 한 줄을 추가해 조직의 승인 여부를 확인하지 않은 서버에도 접속할 수 있습니다. 그런데 MCP는 정해진 호스트명이나 `/mcp` 경로를 요구하지 않습니다. 네트워크에서 보면 평범한 HTTPS API 호출처럼 보일 수 있습니다.

## 승인한 서버에도 남는 MCP Portal 우회 {#shadow-mcp-and-portal-bypass}

찾아야 할 것은 미승인 서버만이 아닙니다. Cloudflare는 조직이 모르는 서버에 접속하는 Shadow MCP와, 승인된 서버에 접속하면서 관리 경로를 건너뛰는 Portal 우회를 별개 문제로 다룹니다.

직원이 저장소나 제품 가이드, 동료의 메시지에서 찾은 서버를 클라이언트에 바로 등록할 수 있습니다. 조직이 승인하지 않은 서버로 향하는 이런 연결이 Shadow MCP입니다. 보안팀은 그 서버가 무슨 도구를 제공하는지, 직원이 어떤 데이터를 보내는지 모릅니다.

Portal 우회에서는 서버 자체가 이미 승인된 상태입니다. 조직이 MCP Portal에 등록해 둔 서버인데도 직원이 원본 서버 URL로 직접 연결합니다. 그러면 Portal의 Access 정책, 선별된 도구 목록, DLP, 도구별 감사 기록을 건너뛰게 됩니다.

관리되는 네트워크 경로에서 Shadow MCP를 찾고 통제하는 주된 지점은 Gateway입니다. Portal 우회를 막으려면 네트워크 통제에 더해 원본 서버도 직접 요청을 거부할 수 있어야 합니다. Access 정책, 출발지 IP 제한, MCP 서버가 시작하는 기업용 권한 부여 방식이 그 수단이 될 수 있습니다.

## 평범한 URL에서도 드러나는 MCP 프로토콜 헤더 {#protocol-based-detection}

Cloudflare는 처음에 GraphQL Analytics API로 Gateway HTTP 로그를 검색했습니다. 호스트명에 `mcp`가 있는지, 경로가 `/mcp`나 `/sse`인지 찾는 방식입니다. 호스트명에 단서가 없고 `/api` 같은 평범한 경로를 쓰는 MCP 서버는 이 URL 검색에서 빠집니다. 이런 서버도 드물지 않습니다. 관계없는 서비스가 우연히 `mcp`를 이름에 넣어 검색에 걸릴 가능성은 낮지만, Cloudflare가 실제로 겪은 오탐입니다.

URL 검색과 요청 본문에서 `initialize`, `tools/call`, `resources/read` 같은 JSON-RPC 메서드를 찾는 DLP 패턴은 여전히 쓸모가 있습니다. 오래된 클라이언트나 과거 기록을 조사할 때 활용할 수 있기 때문입니다. 새 탐지는 여기에 프로토콜 자체가 보내는 신호를 더합니다.

규격을 준수하는 Streamable HTTP 클라이언트는 `MCP-Protocol-Version` 헤더를 보냅니다. MCP 2025-11-25는 초기화 이후 모든 HTTP 요청에 이 헤더를 요구합니다. MCP 2026-07-28에서는 초기화 핸드셰이크를 없애고 모든 POST 요청에 버전 헤더를 넣도록 했습니다. 새 규격의 `Mcp-Method`와 `Mcp-Name`은 작업과 도구도 드러냅니다. HTTP 인프라가 본문을 파싱하지 않고 작업을 식별하거나, 호출률 제한 장치가 `tools/list`와 `tools/call`을 구분할 수 있는 신호입니다.

Cloudflare One Client는 관리 기기의 트래픽을 Gateway로 보냅니다. Gateway는 TLS 복호화 후 요청을 사용자·기기와 연결하고, 버전 헤더를 발견하면 MCP로 분류합니다. 발표 시점부터 모든 Cloudflare Zero Trust 고객이 Gateway HTTP 로그의 MCP 표시를 확인하고, 불리언 선택자 `experimental.is_mcp == true`를 Allow·Block 정책에 사용할 수 있게 됐습니다.

헤더가 있으면 강한 근거가 됩니다. 그렇다고 헤더가 없는 요청을 MCP가 아니라고 판정할 수는 없습니다. 레거시 클라이언트의 첫 `initialize` 요청에는 헤더가 없을 수 있고, MCP 2025-06-18 이전에는 헤더 자체가 정의되지 않았습니다. 사용자 정의 전송 방식이나 규격을 따르지 않는 트래픽에도 없을 수 있습니다.

관찰 범위에도 경계가 있습니다. Gateway를 거쳐 TLS 복호화된 요청이어야 헤더를 검사할 수 있으므로, 로컬 `stdio`, 네트워크 밖 연결, Do Not Inspect 트래픽, Gateway를 지나지 않는 요청은 이 탐지의 범위 밖입니다.

## 발견한 서버를 관리 경로로 옮기는 MCP Portal {#portal-governance-and-enforcement}

탐지 결과는 조사할 서버와 사용자 목록으로 이어집니다. 전용 MCP 대시보드는 선택한 기간의 전체 요청 수와 고유 사용자·서버 수, 서버별 요청 추이를 보여줍니다. Portal을 거친 요청과 기기에서 직접 보낸 요청의 비중, Portal 밖에서 관찰된 상위 서버, 요청량이 많은 사용자도 확인할 수 있습니다. 서버·사용자·유입 경로로 범위를 좁힌 뒤, 해당 조건으로 필터링된 Gateway HTTP 로그로 이동해 조사하는 흐름입니다.

조사 끝에 승인한 서버는 MCP Portal 뒤로 옮길 수 있습니다. 직원에게는 관리되는 단일 엔드포인트를 제공하고, 원본 서버 앞에는 Access 신원 확인, 선별된 도구 목록, 로그를 둡니다. 호환되는 호출은 Portal 전체나 개별 서버 단위로 Gateway를 경유시켜 HTTP 정책과 예측 가능한 송신 경로, DLP를 적용할 수 있습니다. 도구 활동은 Logpush로 내보냅니다. 이후 대시보드에서는 같은 서버에 접속하더라도 Portal을 거쳤는지 직접 연결했는지 구별할 수 있습니다.

차단 전에 관찰부터 해도 됩니다. 복호화된 트래픽의 HTTP 로그에 MCP 탐지 결과와 Traffic Source가 기록되므로, 별도 정책 없이 접속 행태를 확인할 수 있습니다.

경로를 강제할 때는 Gateway의 Network·HTTP 정책에 추가된 Traffic Source를 사용합니다. Gateway를 경유한 Portal 요청에는 `mcp_portal` 값이 붙습니다. 이 값과 MCP 탐지 조건을 조합해 차단합니다.

이 규칙은 Gateway가 MCP로 탐지한 요청 중 Portal에서 들어오지 않은 요청을 차단합니다. Portal을 경유한 요청은 이 규칙의 영향을 받지 않습니다. 적용 범위는 Gateway가 탐지하고 통제할 수 있는 경로까지입니다.

특정 도구의 사용을 더 세밀하게 통제하는 기능은 앞으로 추가할 예정입니다. 보안팀이 알고 있는 서버뿐 아니라 아직 모르는 서버까지 포함해, 환경 전반의 도구 사용을 보고하는 기능도 예고했습니다.

## 도구 실행 직전에 요청을 거절하는 MCP 서버 {#control-points}

접속 경로를 확인한 뒤에도 호출 안에는 살펴볼 것이 남습니다. Austin의 날씨를 묻는 `get_weather` 호출은 클라이언트 안에서는 도구와 인자를 고르는 결정이고, 네트워크에서는 JSON-RPC를 담은 HTTP 요청이며, 서버에서는 핸들러가 수행할 작업입니다. 가장 민감한 부분은 인자입니다. 날씨 조회에서는 `city`에 `Austin`을 넣지만, 도구에 따라 소스 코드나 고객 데이터, 인프라 변경 지시를 보낼 수도 있습니다. 응답으로 돌아오는 데이터 역시 민감할 수 있습니다.

클라이언트 훅은 모델이 도구를 고른 뒤, 요청을 직렬화하기 전에 개입합니다. 네트워크 트래픽을 복호화하지 않고도 목적지 서버와 도구, 인자를 확인해 미승인 서버를 막거나 민감한 작업의 사용자 확인을 요구하고, 기기를 떠날 데이터에서 일부를 제거할 수 있습니다. 네트워크 요청을 만들지 않는 로컬 `stdio` 서버도 여기서는 다룰 수 있습니다. 문제는 일관된 적용입니다. 직원이 쓰는 클라이언트마다 통제를 구현해야 하고, 한 클라이언트의 기록만으로 전체 MCP 사용 현황을 알 수는 없습니다.

네트워크는 관리 경로의 원격 연결을 가장 넓게 관찰합니다. DLP 검사를 지원하는 프록시라면 JSON-RPC 메서드와 인자의 민감정보도 살필 수 있습니다. 서버는 실행에 필요한 문맥을 더 많이 갖고 있습니다. 호출자를 인증하고 메시지를 해석했으며, 도구를 핸들러에 연결하고 입력 스키마에 맞춰 인자를 검증한 상태입니다. 도구별 권한과 호출률, 인자를 검사해 실행을 거절할 마지막 지점이기도 합니다. 실행 후에만 남긴 로그는 경위를 설명할 수 있어도 이미 일어난 작업을 막지는 못합니다.

Cloudflare는 내부 MCP 서버에서 WriteGuard를 이 위치에 둡니다. 각 도구에는 위험 등급과 활성화 여부가 있습니다. WriteGuard는 읽기를 그대로 통과시키거나, 허용된 쓰기에 에이전트 식별 정보와 감사 이벤트를 추가하거나, 중대한 작업을 핸들러 실행 전에 차단할 수 있습니다. 사용자가 클라이언트를 바꾸거나 로컬 훅을 꺼도 서버의 이 검사는 우회할 수 없습니다. 물론 이런 통제가 보호하는 범위는 이를 구현한 서버까지입니다.

## 직원에게 필요한 서버까지 닿기 위한 MCP Portal {#compatibility-and-remaining-work}

승인된 경로가 쓸모 있으려면 직원에게 필요한 서버를 충분히 연결할 수 있어야 합니다. OAuth부터 방식이 달랐습니다. 이전 MCP 규격은 OAuth 애플리케이션 없이 클라이언트가 스스로 등록하는 Dynamic Client Registration을 권장했습니다. 하지만 흔히 쓰는 OAuth 공급자 상당수는 관리자가 고정된 client ID, client secret, callback URL, scopes로 애플리케이션을 등록하도록 요구합니다. 동적 클라이언트 등록은 MCP 2026-07-28에서도 폐기 예정 기능이 됐습니다.

MCP Portals는 이제 사전 등록된 OAuth 클라이언트를 지원합니다. 관리자는 대시보드에 표시된 콜백 URL을 공급자에 등록하고 자격 증명을 입력합니다. Portal이 표준 OAuth 메타데이터를 자동으로 발견하지 못하면 관련 엔드포인트를 직접 지정할 수 있습니다. 각 사용자는 Portal이 자신의 원본 데이터 소스에 접근하도록 직접 승인합니다. 저장된 클라이언트 비밀값은 갱신된 도구·프롬프트 목록을 가져오는 데만 씁니다.

모든 OAuth 호환성 문제가 해결된 것은 아닙니다. 사용자 정의 헤더, 개인 액세스 토큰, 명시적인 클라이언트 허용 목록을 요구하는 공급자는 별도의 과제로 남습니다. Cloudflare는 발표 이후 수개월 동안 OAuth 지원을 확장할 계획이라고 밝혔습니다.

사설 서버 연결도 개발 중입니다. 발표 당시 Portal은 공개 인터넷에서 원본 서버의 이름을 해석하고 접근할 수 있어야 했으므로, 사설 DNS나 사설 IP 공간에만 있는 서버에는 닿지 못했습니다. Cloudflare는 Gateway 라우팅과 기존 Cloudflare One 네트워크를 이용해 이 서버들을 연결하는 기능을 개발하고 있습니다. 계획된 방식에서는 사설 호스트명을 유지한 채 공개 서버와 같은 Portal에 도구를 제공하고, 기존 Access 정책과 Portal 로그, 도구 통제를 적용합니다.

## MCP 전환기의 연결을 이어 주는 Agents SDK {#agents-sdk-transition}

새 규격으로 모두 한꺼번에 옮겨 가는 일은 드뭅니다. Cloudflare Agents SDK v0.20.0은 MCP 2026-07-28을 클라이언트와 서버 양쪽에서 지원하면서 이전 흐름도 유지합니다. 클라이언트는 연결마다 `server/discover`로 새 무상태 프로토콜을 먼저 탐색하고, 서버가 지원하지 않으면 같은 연결에서 레거시 `initialize` 핸드셰이크로 진행합니다. 기존 `addMcpServer` 호출에 별도 프로토콜 설정이나 별도 클라이언트를 둘 필요가 없습니다.

서버의 `createMcpHandler`는 전송 세션이나 Durable Object 없이 Worker에서 도구·프롬프트·리소스·elicitation을 제공할 수 있습니다. 새 클라이언트는 기존 서버에 접속해야 하고, 새 서버도 아직 옮겨 오지 않은 클라이언트를 처리해야 합니다. SDK가 양쪽 경로를 지원하는 이유입니다. Cloudflare는 프로토콜 변경과 마이그레이션 경로를 별도 글 *The next generation of MCP*에서 다뤘습니다.

{{% details title="프로토콜 버전·탐지 조건·정책 설정" closed="true" %}}
| 항목 | 값 |
|---|---|
| 초기 URL 탐지 예시 | 호스트명의 `mcp`, 경로의 `/mcp` 또는 `/sse` |
| 본문 탐지 메서드 예시 | `initialize`, `tools/call`, `resources/read` |
| MCP 2025-06-18 이전 | `MCP-Protocol-Version` 헤더가 정의되지 않음 |
| MCP 2025-11-25 | 초기화 이후 모든 HTTP 요청에 `MCP-Protocol-Version` 필수 |
| MCP 2026-07-28 | 초기화 핸드셰이크 제거, 모든 POST 요청에 버전 헤더 필수, `Mcp-Method`·`Mcp-Name`으로 작업 정보 노출, 동적 클라이언트 등록 폐기 예정 처리 |
| Gateway MCP 선택자 | `experimental.is_mcp == true`; TLS 검사 요청에서 버전 헤더를 탐지하면 참 |
| Portal 유입 경로 값 | `mcp_portal` |
| 원문의 기본 차단 조건 | `experimental.is_mcp == true and not traffic.onramp in ("mcp_portal")`; 동작은 Block |
| 수동 OAuth 설정 | 고정 client ID, client secret, callback URL, scopes; 자동 발견 불가 시 authorization·token·revocation·issuer 엔드포인트 지정 |
| Agents SDK 지원 버전 | v0.20.0부터 MCP 2026-07-28의 클라이언트·서버 지원 |
{{% /details %}}
