---
title: "요청마다 새로 띄우는 AI 샌드박스 Dynamic Workers"
description: "AI가 만든 코드마다 새 샌드박스를 띄우는 비용은 어떻게 줄일까요? Cloudflare는 V8 isolate 기반 Dynamic Workers로 시작 시간을 줄이고, TypeScript RPC로 코드에 허용할 기능을 제한합니다."
date: 2026-11-16
weight: 6
---

# 요청마다 새로 띄우는 AI 샌드박스 Dynamic Workers (2026-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Sandboxing AI agents, 100x faster](https://blog.cloudflare.com/dynamic-workers)
- 매체 · 게시일: The Cloudflare Blog · 2026-03-24
- 저자: Kenton Varda, Sunil Pai, Ketan Gupta
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 코드 한 조각마다 새로 만드는 Dynamic Worker {#dynamic-worker-loader}

에이전트가 도구를 하나씩 호출하면 중간 결과도 모델의 컨텍스트에 쌓입니다. API 호출들을 코드로 연결해 실행하면 최종 결과만 돌려줄 수 있습니다. Cloudflare가 앞선 9월 소개한 Code Mode의 접근입니다. MCP 서버를 TypeScript API로 바꾼 시연에서는 토큰 사용량이 81% 줄었습니다.

그 코드에는 안전한 실행 공간이 필요합니다. 애플리케이션에서 AI 생성 코드를 곧바로 `eval()`하면 악의적인 사용자가 프롬프트로 취약점을 주입할 수 있기 때문입니다. 허용한 기능에만 접근하게 하고, 나머지 애플리케이션과 외부 세계로부터 코드를 격리할 샌드박스가 있어야 합니다.

Linux 컨테이너라면 원하는 실행 환경을 마련할 수 있지만, 시작에 수백 밀리초가 걸리고 실행 중에는 수백 MB의 메모리를 씁니다. 지연을 피하려고 미리 띄워 두면 비용이 들고, 여러 작업에 재사용하면 보안이 약해집니다. 사용자마다 하나 이상의 에이전트가 코드를 쓰는 규모를 감당하려면 실행 공간도 더 가벼워야 합니다.

Dynamic Worker Loader는 실행 중인 Worker가 런타임에 받은 코드로 별도의 Worker를 만드는 API입니다. 기반은 Cloudflare Workers가 출시 때부터 사용해 온 V8 isolate, 즉 V8 JavaScript 엔진의 인스턴스입니다. 시작에 수 밀리초, 메모리는 수 MB가 듭니다. 일반적인 컨테이너보다 시작은 약 100배 빠르고 메모리 효율은 약 10~100배 높아, 요청마다 새 샌드박스를 만들어 코드 조각 하나를 실행한 뒤 버리는 방식이 가능합니다.

일회성 Dynamic Worker는 보통 자신을 만든 Worker와 같은 머신, 심지어 같은 스레드에서 실행됩니다. 준비된 샌드박스를 찾아 멀리 통신할 이유가 없습니다. 요청이 도착한 곳에서 바로 실행하며, Cloudflare의 전 세계 수백 개 위치에서 지원됩니다.

Cloudflare는 샌드박스 전체 동시 실행 수와 생성 속도에도 별도 제한을 두지 않습니다. 초당 100만 요청 각각에 별도 Dynamic Worker를 생성해 함께 실행하는 규모도 가능하다고 설명합니다. 해당 조건의 실측 결과를 제시한 것은 아닙니다.

## V8 isolate를 둘러싼 추가 방어 계층 {#sandbox-security}

isolate의 공격 표면은 하드웨어 가상 머신보다 복잡합니다. V8 보안 버그도 일반적인 하이퍼바이저의 보안 버그보다 흔합니다. 악성일 수 있는 코드를 맡기려면 isolate 밖에도 방어 장치가 필요합니다.

Dynamic Workers에는 Cloudflare가 거의 10년 동안 운영해 온 격리 플랫폼의 보안 장치가 적용됩니다. V8 보안 패치를 수 시간 안에 production에 배포하고, 자체적인 추가 샌드박스에서 위험 평가에 따라 테넌트를 동적으로 분리합니다.

V8 샌드박스 자체도 MPK 같은 하드웨어 기능을 활용하도록 확장했습니다. Spectre 방어를 위한 연구에 더해, 코드에서 악성 패턴을 탐지해 자동으로 차단하거나 추가 격리를 적용하는 시스템도 운영합니다. Dynamic Workers 사용자는 이 방어 장치들을 함께 제공받습니다.

## 필요한 기능만 건네는 TypeScript RPC {#typed-api-capabilities}

빠른 실행에는 언어 선택도 관계가 있습니다. Workers는 Python과 WebAssembly도 지원하지만, 에이전트가 즉석에서 작성하는 짧은 코드에는 JavaScript의 로딩과 실행이 훨씬 빠릅니다. Cloudflare는 사람이 선호하는 언어에 맞출 필요 없이, AI가 이 작업에 맞는 JavaScript를 쓰게 하면 된다고 봅니다.

코드가 사용할 API는 TypeScript 인터페이스로 설명합니다. MCP는 개별 도구 호출의 스키마를 정의하고, OpenAPI는 REST API를 표현하지만 명세와 호출 코드가 깁니다. TypeScript라면 적은 토큰으로 API를 정확하게 전달할 수 있습니다.

호스트 Worker는 허용할 API를 RPC 객체로 만들어 메서드 인자나 `env`에 건넵니다. Workers Runtime이 Cap’n Web RPC 연결을 자동으로 구성하므로, 샌드박스 안의 코드는 로컬 라이브러리를 쓰듯 API를 호출합니다. 실제 호출은 보안 경계를 건넙니다.

채팅방 API를 예로 들면 쓰임이 선명해집니다. 사용자가 Alice의 최근 메시지를 요약해 달라고 요청했을 때, 에이전트는 `getHistory(1000)`으로 기록을 가져와 작성자가 `alice`인 메시지만 추리는 코드를 씁니다. 모델이 읽는 것은 추린 결과입니다. 채팅 기록 전체를 컨텍스트에 넣지 않아도 됩니다.

HTTP가 필요한 경우도 있습니다. 학습 데이터에 포함된 익숙한 API를 호출하거나 REST API 기반 라이브러리를 샌드박스 안에서 실행하려는 경우입니다. `globalOutbound`에 콜백을 등록하면 모든 HTTP 요청을 검사·수정·차단하거나 직접 응답할 수 있고, `null`로 설정하면 네트워크 접근을 차단합니다. 인증이 필요한 서비스에는 나가는 요청에 자격 증명을 주입합니다. 에이전트가 비밀값을 알지 못하므로 그 값을 유출할 수도 없습니다.

호환성 요구가 없다면 Cloudflare는 TypeScript RPC를 권장합니다. 설명과 호출 코드가 짧을 뿐 아니라, 허용할 함수만 구현해 기능의 범위를 좁히기 쉽습니다. 기존 HTTP API를 필터링하는 프록시는 허용 여부를 판단하려고 헤더와 매개변수까지 포함한 각 호출의 의미를 해석해야 합니다. 필요한 함수만 제공하는 래퍼를 만드는 편이 더 쉽다는 판단입니다.

Cloudflare MCP 서버도 이 방식으로 전체 Cloudflare API를 노출합니다. 도구는 `search`와 `execute` 2개이고, 설명은 1,000토큰 미만입니다. 에이전트가 수백 개의 도구 정의를 다루는 대신 타입이 있는 API를 호출하는 코드를 작성합니다.

## 채팅 뒤에서 자동화를 실행하는 Zite {#usage-and-results}

Zite는 사용자가 코드 한 줄을 보지 않고도 채팅으로 앱을 만드는 플랫폼을 구축하고 있습니다. 뒤에서는 LLM이 TypeScript를 작성해 CRUD 앱을 만들고, Stripe·Airtable·Google Calendar 같은 서비스를 연결하며 백엔드 로직을 실행합니다. 자동화마다 별도의 Dynamic Worker를 두고 해당 엔드포인트에 필요한 서비스와 라이브러리만 허용합니다.

Zite 측은 Dynamic Workers로 일일 수백만 건의 실행 요청을 처리한다고 밝혔습니다. 속도와 라이브러리 지원에서 비교한 다른 모든 플랫폼보다 우수했다는 평가도 Zite가 수행한 벤치마크에 따른 설명입니다.

AI가 전체 애플리케이션을 생성하는 플랫폼에도 같은 실행 방식을 쓸 수 있습니다. 앱을 필요할 때 시작하고 다음 호출까지 콜드 스토리지로 되돌리는 방식입니다. 빠른 시작은 개발 중 변경 사항을 미리 보는 데 도움이 되며, 플랫폼은 생성 코드가 보내는 네트워크 요청을 차단하거나 가로챌 수 있습니다.

## 실행할 모듈과 파일을 준비하는 보조 라이브러리 {#helper-libraries}

`@cloudflare/codemode`는 모델이 만든 코드를 Dynamic Workers에서 실행하는 과정을 줄여 줍니다. 중심인 `DynamicWorkerExecutor()`가 샌드박스를 구성하고 흔한 코드 형식 오류를 보정합니다. 앞서 살펴본 `globalOutbound`도 여기서 제어하며, `Fetcher` 바인딩을 전달해 외부 요청을 중계하거나 가공할 수 있습니다.

기존 API를 Code Mode로 제공할 때는 서버 측 유틸리티를 사용합니다. `codeMcpServer()`는 기존 MCP 서버의 도구들을 단일 `code()` 도구로 감쌉니다. 더 큰 API에는 OpenAPI 명세에서 `search()`와 `execute()`를 갖춘 MCP 서버를 만드는 `openApiMcpServer()`가 적합합니다. 어느 쪽이든 모델의 코드는 Dynamic Workers 안에서 실행되고, 외부 서비스는 실행기에 전달한 RPC 바인딩으로 호출합니다.

실행 전에는 모듈을 번들링해야 합니다. `@cloudflare/worker-bundler`는 소스 파일과 `package.json`을 받아 npm 레지스트리에서 의존성을 해석하고, `esbuild`로 묶어 Loader가 받는 모듈 맵을 반환합니다. `createApp`은 서버 Worker와 클라이언트 JavaScript, 정적 자산을 함께 번들링하며 콘텐츠 유형, ETag, SPA 라우팅을 처리하는 자산 제공 기능도 갖췄습니다.

파일을 다루는 에이전트에는 `@cloudflare/shell`이 가상 파일시스템을 제공합니다. 문자열을 파싱하는 대신 타입이 있는 `state` API로 읽기·쓰기·검색·치환·diff·glob·JSON 작업을 수행합니다. SQLite와 R2 기반 `Workspace`가 파일을 보존하므로, 실행이 끝나도 다음 실행에서 이어서 사용할 수 있습니다.

여러 파일을 다룰 때는 `searchFiles`, `replaceInFiles`, `planEdits` 같은 연산으로 RPC 왕복을 줄입니다. 파일마다 호출을 반복하는 대신 한 번에 작업을 요청하는 방식입니다. 일괄 쓰기는 기본적으로 트랜잭션으로 처리하며, 하나라도 실패하면 앞선 쓰기도 자동으로 롤백합니다.

## 공개 베타에서 면제되는 Worker 로딩 요금 {#pricing-and-constraints}

게시 당시 Dynamic Worker Loader의 공개 베타는 모든 Workers 유료 사용자에게 제공됐습니다. 동적 로딩 가격은 하루에 로드한 고유 Worker당 0.002달러이며, 일반 Workers의 CPU 시간과 호출 요금이 추가됩니다.

매번 고유한 코드를 만드는 Code Mode라면 일회성 Worker를 로드할 때마다 0.002달러가 붙는 계산입니다. 베타 기간에는 이 로딩 요금이 면제됩니다. 가격은 변경될 수 있으며, 여기 적은 금액과 면제 조건은 게시 당시 기준입니다.

{{% details title="성능·토큰 사용량·과금 수치의 근거" closed="true" %}}
| 항목 | 값 |
|---|---|
| 일반적인 컨테이너의 시작 시간·메모리 | 수백 밀리초·수백 MB |
| V8 isolate의 시작 시간·메모리 | 수 밀리초·수 MB |
| 일반적인 컨테이너 대비 isolate 비교 | 시작 약 100배 빠름, 메모리 효율 약 10~100배 |
| MCP 서버를 TypeScript API로 전환한 기존 시연 | 토큰 사용량 81% 감소 |
| Cloudflare MCP 서버의 도구 구성 | `search`·`execute` 2개, 1,000토큰 미만으로 전체 API 노출 |
| Cloudflare가 제시한 확장 가능성의 예 | 초당 100만 요청 각각에 별도 Dynamic Worker 생성·동시 실행, 해당 조건의 실측 결과는 미제시 |
| Zite가 보고한 처리 규모 | 일일 수백만 실행 요청 |
| 게시 당시 동적 로딩 요금 | 하루에 로드한 고유 Worker당 0.002달러, CPU 시간·호출 요금 별도 |
| 매번 고유 Worker를 만드는 Code Mode | 로드한 Worker당 0.002달러, CPU 시간·호출 요금 별도 |
| 베타 기간의 요금 면제 | 위 0.002달러 로딩 요금 면제 |
{{% /details %}}
