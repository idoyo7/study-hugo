---
title: "행동 지침을 담은 Cloudflare의 RFC 9457 오류 응답"
description: "에이전트는 오류 뒤에 재시도해야 할지 어떻게 판단할까요? Cloudflare는 오류 응답에 명시적인 행동 지침을 담고, 실제 1015 응답 비교에서 크기와 토큰 사용량을 HTML보다 약 98% 줄였습니다."
date: 2026-11-16
weight: 13
---

# 행동 지침을 담은 Cloudflare의 RFC 9457 오류 응답 (2026-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Slashing agent token costs by 98% with RFC 9457-compliant error responses](https://blog.cloudflare.com/rfc-9457-agent-error-pages)
- 매체 · 게시일: The Cloudflare Blog · 2026-03-11
- 저자: Sam Marsh
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 다음 행동을 알려 주지 못한 HTML 페이지 {#browser-error-page-limitations}

매일 수십억 건의 HTTP 요청을 보내는 AI 에이전트도 오류 앞에서는 브라우저용 HTML을 받았습니다. 수백 줄의 마크업과 CSS는 사람의 눈을 위한 것입니다. 에이전트는 이를 처리하는 데 시간과 토큰을 쓰면서도, “차단되었습니다”라는 문구에서 다시 요청해도 될지까지 추측해야 했습니다.

이때 오류를 반환한 곳이 Cloudflare라고 해서 Cloudflare 장애라는 뜻은 아닙니다. 대개 고객이 설정한 정책을 집행하거나 고객을 대신해 플랫폼 응답을 반환한 결과입니다. 잘못된 호스트·DNS 라우팅, WAF나 지역·ASN·봇 규칙에 따른 접근 제어, 엣지의 속도 제한 등으로 요청을 그대로 처리하지 못한 상황입니다.

Custom Error Rules로 오류 응답을 조정하는 길은 이미 있었습니다. 하지만 사이트마다 설정해야 하는 기능을 웹 전반에서 통하는 기본 규약으로 삼을 수는 없었습니다. Cloudflare는 요청 경로 앞에 있는 자신의 위치에서 이 문제를 풀었습니다. 에이전트가 Markdown이나 JSON을 요청하면 오류 사유와 함께 기다릴지, 멈출지, 사이트 소유자에게 문제를 전달할지를 명시하도록 바꿨습니다.

## 재시도와 중단의 기준이 된 오류 필드 {#field-driven-error-handling}

속도 제한 오류 `1015`의 응답 예시에는 `retryable: true`와 `retry_after: 30`이 들어갑니다. 대기 시간까지 명확합니다. 설명문은 최소 30초를 기다린 뒤 재시도하고, 다시 제한되면 60초·120초로 대기를 늘리는 지수 백오프를 안내합니다. 이 예시에서 권하는 중단 시점은 5회 재시도 뒤에도 제한이 이어질 때이며, 그때는 요청 패턴을 재검토하도록 합니다.

기다린다고 풀리지 않는 차단도 있습니다. 의도적인 WAF 차단 `1020`에서는 재시도를 멈추고, `ray_id`를 기록해 문제를 전달합니다. 지역 제한 `1009`를 만난 MCP(Model Context Protocol) 도구도 기계가 읽을 수 있는 차단 사유를 오케스트레이터에 반환할 수 있습니다. 그러면 워크플로는 다른 경로를 택하거나 사용자에게 알릴 수 있습니다.

모든 `1xxx` 오류는 10개 `error_category` 중 하나로 분류됩니다. 재시도 성공 가능성은 `retryable`, 사이트 소유자의 조치가 필요한지는 `owner_action_required`에 담깁니다. 이 필드를 사용하는 간단한 처리 패턴에서는 재시도가 가능하면 `retry_after`만큼 기다리고, 재시도가 불가능하면서 소유자 조치가 필요하면 중단 후 문제를 전달합니다. 나머지는 반복 요청 없이 빠르게 실패 처리합니다.

행동 지침을 담고도 응답은 훨씬 작아졌습니다. 실제 `1015` 응답을 `cl100k_base`로 측정했을 때 HTML의 14,252토큰이 Markdown에서는 221토큰, JSON에서는 256토큰으로 줄었습니다. 바이트 크기와 토큰 사용량이 모두 약 98% 감소한 결과입니다.

이 절감률은 특정 속도 제한 응답을 비교한 값입니다. 모든 오류에서 같은 비율을 확인한 것은 아닙니다. Cloudflare는 한 워크플로에서 오류를 여러 번 만나면 절감 효과가 누적되어 모델 지출과 복구 시간을 줄인다고 설명하지만, 복구 시간의 별도 실측치는 제시하지 않았습니다.

## Markdown과 JSON이 공유하는 RFC 9457 계약 {#one-contract-two-formats}

Markdown을 고르든 JSON을 고르든 오류의 의미와 처리 지침은 같습니다. Markdown에는 기계가 읽는 YAML frontmatter와 `What happened`, `What you should do` 설명을 두고, JSON에는 같은 운영 정보를 평면 객체로 담습니다. 에이전트가 표시 문구의 변화를 따라가며 처리 로직을 고치지 않도록 스키마를 안정적으로 설계했습니다.

JSON의 바탕은 HTTP API의 오류 표현을 표준화한 RFC 9457 Problem Details입니다. `type`은 해당 오류 문서의 URI를 가리키고, `status`는 실제 HTTP 응답의 상태 코드와 일치합니다. `title`에는 짧은 문제 요약을, `detail`에는 이번 발생 건의 설명을 담으며, `instance`에는 그 발생 건을 식별하는 Ray ID를 넣습니다.

`error_code`, `error_name`, `error_category` 같은 분류 정보와 재시도·소유자 조치 관련 정보는 RFC 9457의 확장 필드입니다. 이를 모르는 클라이언트는 무시하면 됩니다. Problem Details를 지원하는 HTTP 클라이언트는 Cloudflare 전용 코드 없이도 기본 필드를 해석할 수 있습니다.

자동화 뒤에 남길 맥락도 있습니다. `ray_id`, `timestamp`, `zone`은 로그를 기록하고 지원 요청을 전달할 때 사용합니다. 오류를 분류하는 데서 그치지 않고, 어떤 요청에서 언제 문제가 생겼는지까지 함께 전달하는 방식입니다.

## 에이전트가 명시해야 할 Accept 헤더 {#content-negotiation}

이 기능은 모든 `1xxx` 계열 오류 경로에 적용한 상태로 공개됐습니다. Cloudflare 네트워크 전체의 기본 동작이므로 사이트 소유자가 별도로 설정할 것은 없습니다. 클라이언트는 `Accept: text/markdown`, `Accept: application/json`, `Accept: application/problem+json`으로 원하는 형식을 요청합니다.

뒤의 두 요청은 JSON 본문이 같고 응답의 `Content-Type`만 다릅니다. Markdown과 JSON을 함께 나열하면 먼저 명시한 구조화 형식을 선택합니다. `*/*`만 보낸 요청은 구조화 형식을 선호한다는 뜻으로 보지 않으므로 HTML을 반환합니다.

브라우저 역시 Markdown이나 JSON을 명시적으로 요청하지 않으면 기존 HTML을 받습니다. 요청이 성공했을 때도 달라지는 것은 없습니다. 정상적인 원본 콘텐츠를 반환하며, 여기서 설명한 형식 선택은 Cloudflare가 생성하는 오류 응답에만 적용됩니다.

개발자는 `curl`로 에이전트가 받는 내용을 그대로 재현할 수 있습니다. Cloudflare 프록시를 사용하는 도메인의 `/cdn-cgi/error/1015`에 요청하거나, 마지막 코드를 다른 `1xxx` 오류로 바꾸면 됩니다. HTML을 역으로 해석하지 않고 필드와 행동 지침을 직접 확인하는 경로입니다.

Cloudflare는 에이전트 런타임의 기본 헤더로 모델 중심 워크플로에는 `Accept: text/markdown, */*`를, 타입에 따른 제어 흐름에는 `Accept: application/json, */*`를 권합니다. 발표 시점의 적용 범위는 `1xxx` 계열이며, Cloudflare가 생성하는 `4xx`와 `5xx` 오류에도 같은 계약을 확장할 계획입니다.

{{% details title="실측값과 요청·오류 처리 기준" closed="true" %}}
| 항목 | 값 |
|---|---|
| 측정 대상 | 실제 `1015` 속도 제한 오류 응답 |
| HTML 응답 | 46,645바이트, 14,252토큰 |
| Markdown 응답 | 798바이트, 221토큰; HTML 대비 크기 58.5배, 토큰 64.5배 축소 |
| JSON 응답 | 970바이트, 256토큰; HTML 대비 크기 48.1배, 토큰 55.7배 축소 |
| 토큰 계산 기준 | `cl100k_base` |
| 속도 제한 응답 예시 | 오류 `1015`, HTTP `429`, `retryable: true`, `retry_after: 30`, `owner_action_required: false` |
| 속도 제한 예시의 권장 재시도 | 최소 30초 대기 후 재시도, 다시 제한되면 60초·120초 등으로 대기 증가; 5회 재시도 후에도 지속되면 중단하고 요청 패턴 재검토 |
| `access_denied` | IP·ASN·지역·방화벽 규칙에 따른 의도적 차단; 재시도 중단, 예상하지 못한 차단이면 소유자에게 문의 |
| `rate_limit` | 요청 속도 초과; 백오프 적용 후 `retry_after`만큼 기다려 재시도 |
| `dns` | 원본 서버의 DNS 확인 실패; 재시도 중단, 소유자에게 보고 |
| `config` | CNAME·터널·호스트 라우팅 설정 오류; 보통 재시도 중단, 소유자에게 보고 |
| `tls` | TLS 버전·암호군 불일치; 클라이언트 설정 수정, 같은 조건의 재시도 중단 |
| `legal` | DMCA·규제에 따른 차단; 재시도 중단 |
| `worker` | Cloudflare Workers 런타임 오류; 재시도 중단, 소유자의 스크립트 수정 필요 |
| `rewrite` | 잘못된 URL 재작성 결과; 재시도 중단, 소유자의 규칙 수정 필요 |
| `snippet` | Cloudflare Snippets 오류; 재시도 중단, 소유자의 Snippets 설정 수정 필요 |
| `unsupported` | 지원하지 않는 메서드·폐기된 기능; 요청 변경, 같은 조건의 재시도 중단 |
| JSON 요청과 응답 타입 | `Accept: application/json` → `application/json; charset=utf-8` |
| Problem Details 요청과 응답 타입 | `Accept: application/problem+json` → `application/problem+json; charset=utf-8` |
| 복수 형식 선택 예시 | `application/json, text/markdown;q=0.9`와 `application/json, text/markdown`은 JSON; `text/markdown, application/json`은 Markdown |
| 와일드카드 처리 | `text/markdown, */*`와 `text/*`는 Markdown; `*/*`만 있으면 HTML |
| 테스트 경로 | `/cdn-cgi/error/1015`; 다른 `1xxx` 코드로 교체 가능 |
| 런타임 기본값 권고 | 모델 중심 워크플로는 `Accept: text/markdown, */*`, 타입에 따른 제어 흐름은 `Accept: application/json, */*` |
{{% /details %}}
