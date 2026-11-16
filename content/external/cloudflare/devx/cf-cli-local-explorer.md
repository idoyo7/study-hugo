---
title: "Cloudflare 전체를 향한 Wrangler와 Local Explorer"
description: "Cloudflare는 전체 제품을 CLI에서 다루기 위해 수작업으로 갱신하던 인터페이스의 생성 체계부터 다시 만들었습니다. TypeScript 스키마로 명령 규칙을 맞추고, Local Explorer로 로컬 데이터와 API에 접근할 길을 열었습니다."
date: 2026-11-16
weight: 1
---

# Cloudflare 전체를 향한 Wrangler와 Local Explorer (2026-04)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Building a CLI for all of Cloudflare](https://blog.cloudflare.com/cf-cli-local-explorer)
- 매체 · 게시일: The Cloudflare Blog · 2026-04-13
- 저자: Matt “TK” Taylor, Dimitri Mitropoulos, Dan Carter
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## CLI 명령이 비어 있던 Cloudflare 제품들 {#cli-coverage-gap}

Cloudflare에는 100개가 넘는 제품과 약 3,000개의 HTTP API 작업이 있지만, Wrangler에는 CLI 명령이 없는 제품이 많습니다. 에이전트는 CLI를 즐겨 씁니다. 개발자가 코딩 에이전트에게 애플리케이션 구축과 배포, 계정 설정, 분석 데이터와 로그 조회를 맡기면서 API 사용자로서 에이전트의 비중도 커지고 있습니다.

전체 API를 단일 Code Mode MCP 서버로 제공하는 일은 이미 마쳤습니다. 여기에 쓰는 토큰은 1,000개 미만입니다. 하지만 CLI, Workers Bindings, 여러 언어의 SDK, 설정 파일, Terraform, 문서, Agent Skills까지 모든 제품을 모든 인터페이스에서 쓸 수 있는 상태는 아닙니다.

Cloudflare는 이 빈자리를 채우기 위해 Wrangler를 재구축하고 있습니다. 목표는 모든 제품의 명령을 제공하고, 여러 제품을 infrastructure-as-code로 함께 설정하는 CLI입니다. 명령을 제품마다 수작업으로 늘려 가는 방식으로는 Cloudflare의 제품 개발 속도를 따라가기 어려웠습니다.

## 명령 이름과 실행 대상에서 어긋나는 에이전트의 기대 {#command-consistency-and-targets}

에이전트는 CLI의 일관성을 기대합니다. 어떤 리소스는 `<command> info`, 다른 리소스는 `<command> get`으로 조회한다면 한쪽에서 익힌 이름을 다른 쪽에도 적용해 존재하지 않는 명령을 호출할 수 있습니다. 수백, 수천 명이 일하는 조직에서 리뷰만으로 이런 차이를 막는 방식은 구멍이 숭숭 뚫린 스위스 치즈와 같습니다.

CLI에서 이름만 통일해도 문제가 남습니다. REST API와 SDK의 이름이 CLI와 달라지면 오히려 혼란이 커질 수 있기 때문입니다. 규칙을 지킬 범위가 CLI에만 머물러서는 부족했습니다.

Wrangler에서는 실행 대상도 분명해야 합니다. D1 데이터베이스, R2 버킷, KV 네임스페이스를 로컬에서 모사한 리소스로도, 원격 리소스로도 다루기 때문입니다. 예를 들어 에이전트가 원격 DB를 수정한다고 생각하면서 실제로는 로컬 DB에 레코드를 넣을 수 있습니다. 개발자가 원격 bindings로 원격 DB에 연결해 로컬에서 개발하고 있다면, 에이전트는 로컬 개발 서버에 요청해도 새 레코드가 보이지 않는 이유를 이해하지 못합니다.

이때 에이전트에게 필요한 안내는 일관된 기본값과 명확한 출력입니다. 명령이 로컬과 원격 중 어느 리소스에 적용됐는지 출력에서 드러나야 합니다.

## 명령과 맥락을 함께 담은 TypeScript 스키마 {#typescript-schema-generation}

Cloudflare는 규칙을 강제하는 위치를 스키마 계층으로 잡았습니다. 조회에는 `info` 대신 `get`, 확인 생략에는 `--skip-confirmations` 대신 `--force`를 씁니다. JSON 출력도 모든 명령에서 `--json`을 지원하며, `--format`은 쓰지 않습니다.

기존 OpenAPI 스키마만으로는 담을 수 없는 내용이 있었습니다. OpenAPI는 REST API를 기술하지만, 대화형 CLI 명령은 로컬 개발 작업과 API 요청을 묶어 실행합니다. Workers Bindings는 RPC API로 표현되며, 문서와 Agent Skills에는 이들을 연결하는 설명도 들어갑니다.

이미 API SDK, Terraform provider, Code Mode MCP 서버는 OpenAPI 스키마로 생성하고 있었습니다. CLI, Workers Bindings, `wrangler.jsonc`, Agent Skills, 대시보드와 문서는 여전히 사람이 갱신했습니다. 오류가 생기기 쉽고 조율도 자주 오가는 이 과정으로는 전체 API를 지원하는 CLI까지 확장하기 어려웠습니다.

새로 도입한 TypeScript 스키마에는 API 정의뿐 아니라 CLI 명령과 인자, 각 인터페이스를 생성하는 데 필요한 맥락을 함께 담습니다. Cloudflare에서 많이 쓰는 TypeScript를 택했습니다. 형식 자체는 TypeScript 타입에 규약과 린팅, 일관성을 지킬 보호 장치를 더한 것으로, 필요한 인터페이스에 맞춰 확장하면서 OpenAPI 스키마도 생성할 수 있습니다.

Cloudflare가 지금까지 집중한 작업은 이 생성 체계를 만드는 일이었습니다. 오랫동안 제공하고 싶었던 CLI와 다른 인터페이스를 만들기 위해, 먼저 그것들을 만들어 낼 기계부터 준비한 것입니다.

## 로컬 데이터를 드러내는 Local Explorer {#local-explorer}

Cloudflare는 Workers뿐 아니라 플랫폼 전체를 완전히 로컬에서 개발하는 방향에 수년간 투자해 왔습니다. 호스팅형 서버리스 데이터베이스인 D1도 별도 설정이나 도구 없이 로컬에서 실행하고 bindings로 접근합니다. 로컬 개발 플랫폼 에뮬레이터인 Miniflare를 사용하면 Workers runtime이 production과 같은 API를 제공하고, 로컬 SQLite 데이터베이스가 D1의 기능을 구현합니다. 네트워크 없이 빠르게 테스트하고 오프라인에서도 작업할 수 있습니다.

그런데 저장된 데이터를 들여다보는 일은 번거로웠습니다. 내부 동작을 역으로 파악하거나 `.wrangler/state` 디렉터리를 조사하고, 외부 도구를 설치해야 했습니다. 로컬에서 실행은 되는데 그 안에서 무슨 일이 일어났는지 확인할 인터페이스가 부족했던 것입니다.

Wrangler와 Cloudflare Vite plugin에 오픈 베타로 공개한 Local Explorer는 이 데이터를 직접 보여줍니다. 대상은 로컬 개발 중 Worker가 사용하는 KV, R2, D1, Durable Objects, Workflows의 모사 리소스입니다. Cloudflare API와 대시보드에서 하던 작업을 같은 기반 API 체계에 따라 로컬에서도 수행합니다.

앱을 실행하면 Local Explorer를 여는 안내가 나타나고, 단축키 `e`로 열 수 있습니다. Worker에 연결된 bindings와 저장 데이터를 확인하면서 에이전트가 데이터를 어떻게 다루는지 살펴봅니다. 스키마를 검증하거나 테스트 레코드를 넣고, 필요하면 `DROP TABLE`로 다시 시작하는 일도 가능합니다.

API도 열려 있습니다. Wrangler 또는 Cloudflare Vite plugin 기반 앱의 `/cdn-cgi/explorer/api`를 에이전트에게 알려주면, 에이전트가 그곳의 OpenAPI 명세를 찾아 로컬 리소스를 관리할 수 있습니다.

Cloudflare가 목표로 하는 모습은 로컬 데이터만 변경하는 Cloudflare API의 거울입니다. 로컬과 원격의 API 형태를 맞춰 두면, 향후 CLI에서는 같은 명령에 `--local`을 붙여 이 로컬 API로 요청을 보내도록 만들 수 있습니다. 명령을 달리 만들지 않고 요청이 향하는 곳을 바꾸려는 계획입니다.

## 차기 Wrangler를 앞서 공개한 cf 프리뷰 {#preview-scope-and-next-steps}

새 CLI의 매우 초기 기술 프리뷰는 `npx cf`로 실행하거나 `npm install -g cf`로 전역 설치할 수 있습니다. 현재 공개한 `cf`가 지원하는 제품은 일부입니다. Cloudflare는 전체 API를 지원하는 버전을 별도로 시험하고 있으며, 각 제품의 명령과 출력을 사람과 에이전트 모두 쓰기 편하도록 검토하고 조정할 예정입니다.

기존 Wrangler와의 통합도 남아 있습니다. 이번 프리뷰는 차기 Wrangler의 작은 일부이며, 앞으로 몇 달 동안 기존 Wrangler의 기능과 새 체계를 합칠 계획입니다. 이른 단계에서 공개한 이유는 공개하며 개발할 때 가장 좋은 피드백을 얻기 때문입니다.

Cloudflare가 의견을 구하는 범위는 지금 프리뷰에서 되는 일보다 넓습니다. 대시보드에서 여러 번 클릭해야 하는 작업 중 무엇을 한 줄 명령으로 만들고 싶은지, DNS records나 Cache Rules처럼 어떤 항목을 `wrangler.jsonc`에서 설정하고 싶은지, 에이전트가 막히는 곳에 어떤 CLI 명령이 있으면 좋을지를 묻고 있습니다.

{{% details title="지원 규모와 명령·접근 설정" closed="true" %}}
| 항목 | 값 |
|---|---|
| Cloudflare 제품과 HTTP API 규모 | 제품 100개 초과, HTTP API 작업 약 3,000개 |
| 기존 Code Mode MCP 서버 | 단일 서버에서 전체 Cloudflare API 제공, 토큰 사용량 1,000개 미만 |
| 기술 프리뷰 실행 | `npx cf` |
| 기술 프리뷰 전역 설치 | `npm install -g cf` |
| CLI 명령 규약 | `get` 사용, `info` 미사용; `--force` 사용, `--skip-confirmations` 미사용 |
| JSON 출력 규약 | 모든 명령에서 `--json` 지원, `--format` 미사용 |
| 기존 로컬 상태 조사 경로 | `.wrangler/state` |
| Local Explorer 단축키 | Wrangler 또는 Cloudflare Vite plugin으로 앱 실행 후 `e` |
| Local Explorer API 경로 | Wrangler 또는 Vite plugin 기반 앱의 `/cdn-cgi/explorer/api`, OpenAPI 명세 제공 |
| 향후 CLI의 로컬 대상 지정 | `--local`로 로컬 Cloudflare API 미러에 요청하는 동작을 목표로 함 |
{{% /details %}}
