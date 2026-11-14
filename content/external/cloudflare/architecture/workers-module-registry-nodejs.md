---
title: "Node.js 호환을 위한 Workers 모듈 레지스트리 재작성"
description: "Cloudflare는 workerd의 모듈 레지스트리를 URL 기반으로 다시 써서 Node.js와 표준에 가깝게 맞췄습니다. new_module_registry 호환 플래그로 켜며, 아직 기본값은 아닙니다."
date: 2026-11-14
weight: 3
---

# Node.js 호환을 위한 Workers 모듈 레지스트리 재작성 (2026-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How we rebuilt Cloudflare Workers’ module registry for Node.js compatibility](https://blog.cloudflare.com/workers-module-registry-nodejs)
- 매체 · 게시일: The Cloudflare Blog · 2026-09-09
- 저자: Logan Gatlin, James Snell
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 배경 {#배경}

Workers 런타임의 핵심 오픈소스 구성 요소 `workerd`의 모듈 레지스트리를 더 빠르고 표준에 맞고 Node.js의 모듈 레지스트리에 더 가깝게 다시 썼습니다. 지난 몇 년간 Node.js 런타임 API 지원을 계속 넓혀 왔고, 서버리스에서 쓸 만한 Node.js의 안정 API는 이제 모두 지원하며 기본으로 켜져 있습니다. 더 큰 Node.js 앱도 배포할 수 있어서, 모든 플랜에서 번들 크기가 최대 64MiB이고 압축 번들 크기 제한은 없앴습니다.

하지만 API 호환만으로는 부족합니다. Node.js 애플리케이션은 런타임이 모듈을 어떻게 해석하고 로드하고 캐시하는지에도 의존합니다. ESM, CommonJS, WebAssembly가 모두 Worker 코드에서 임포트할 수 있는 모듈 유형이고, 런타임에서 이를 처리하는 시스템이 모듈 레지스트리입니다. Worker에서 `new_module_registry` 호환 플래그를 켜면 바로 쓸 수 있습니다.

플래그를 켜면 다음이 달라집니다.

- `import.meta.url`, `import.meta.main`, `import.meta.resolve()`가 동작합니다.
- 모듈 지정자가 쿼리 문자열과 프래그먼트를 포함해 실제 URL로 파싱되고 해석됩니다.
- `node:` 내장 모듈은 어떤 경로로 접근해도 같은 모듈 인스턴스로 해석됩니다.
- import attributes(`with { type: 'json' }`)가 올바르게 검증됩니다.
- ES 모듈에 대한 `require()`가 Node.js의 `require(esm)` 규칙을 따릅니다.
- 어떤 로딩 경로에서든 일관된 오류 클래스와 메시지를 씁니다.
- 모듈은 처음 임포트될 때(정적이든 동적이든) 지연 컴파일됩니다.
- WebAssembly 모듈이 source phase import를 지원합니다.

## Workers 런타임이 코드를 읽는 방식 {#로딩}

Worker를 배포하면 wrangler나 Vite가 여러 파일과 의존성을 하나 또는 여러 모듈로 번들하고, `wrangler deploy`가 이를 업로드합니다. Wrangler는 기본적으로 거의 모든 코드를 모듈 스크립트 하나로 번들합니다. 내부적으로 `esbuild`가 상대 임포트와 대부분의 npm 의존성의 `require()` 호출을 그 파일에 인라인하고, `import`와 `require()`는 일반 함수로 대체됩니다. 번들이 `workerd`에 닿을 때쯤에는 모듈 그래프가 거의 남지 않습니다. 이런 스크립트가 수십만 줄까지 커지는 것도 봤다고 합니다.

서버 쪽 코드를 올리기 전에 하나의 파일로 번들해야 했던 것은, 여러 모듈, 심지어 다른 유형의 모듈을 올리는 일이 기술적으로는 오래전부터 가능했어도 런타임이 모듈을 다른 런타임과 일관되게 해석하지 않았기 때문입니다. 예를 들어 코드나 의존성이 `import.meta.resolve()`로 다른 모듈의 경로를 구하려 하면 지원되지 않아 실패했습니다.

Cloudflare Vite 플러그인을 쓰면 Wrangler의 esbuild 대신 Vite 8이 Rolldown으로 번들합니다. Rolldown이 임포트와 npm 의존성을 해석하고 필요하면 CommonJS를 ESM으로 바꾸고, 진입 모듈과 동적 임포트 같은 코드 분할로 생긴 청크를 내보냅니다. 그래서 Workers 런타임은 애플리케이션의 원래 소스 그래프 대신 더 작은, 빌드가 만든 모듈 그래프를 받습니다. 새 레지스트리 구현은 Rolldown 같은 번들러가 변환을 줄이고 모듈 해석을 런타임에 더 맡길 길을 엽니다.

Worker에서 Node.js API를 임포트하면 기본적으로 `workerd`에 내장된 모듈을 가져오며 폴리필로 번들되지 않습니다. Wasm, 텍스트, 바이너리 모듈도 인라인하지 않고 지정자로 참조되는 별도 파일로 런타임에 제공됩니다. `--no-bundle`로 배포하거나 도구가 Worker를 여러 모듈로 직접 올리면 작성한 그대로의 모듈 그래프가 런타임에 나타납니다. 이 모든 경우에 지정자를 받아 실제로 가리키는 코드를 알아내고 컴파일해 V8이 링크하고 실행할 모듈 객체를 넘기는 일이 `workerd` 모듈 레지스트리의 몫입니다.

## 새 구현이 필요했던 이유 {#이유}

기존 레지스트리는 지정자를 URL이 아니라 파일 시스템식 경로로 해석합니다. 사소해 보여도 `import.meta.url`을 깔끔하게 구현할 방법이 없었고, 상대 임포트가 `new URL()`과 같은 해석 규칙을 따르지 않았으며, `node:`나 `cloudflare:` 같은 프로토콜도 프로토콜이 아니라 특수 문자열 접두사로 처리됐습니다. 모듈을 임포트하든 안 하든 Worker 번들 전체를 미리 컴파일하고 V8 isolate마다 모든 것의 비공개 사본을 따로 들고 있기도 했습니다. Cloudflare는 CPU 코어에 부하를 나누려고 같은 Worker의 V8 isolate 복제본을 여럿 돌리므로, 같은 소스를 여러 번 컴파일하고 소스 사본을 메모리에 여럿 두는 셈이었습니다.

버그는 아니지만 호환성을 깨지 않고 구현을 발전시키기 어려웠다고 합니다. 새 레지스트리는 URL을 지정자 형식의 출발점으로 삼고, 지연 컴파일과 캐시 공유를 처음부터 설계에 넣었습니다. 기존 레지스트리 구현은 사라지지 않으며 이미 배포된 Worker는 전과 똑같이 동작합니다.

## 새 동작의 세부 {#세부}

`import.meta`는 모듈의 URL과 진입점 여부를 알려 줍니다. 값은 `file:///bundle/index.js, main: true` 같은 형태이고, `import.meta.main`은 Worker의 진입점으로 설정된 모듈에서만 true입니다. `import.meta.resolve()`는 임포트하지 않고 현재 모듈 기준으로 지정자를 해석하며, Node.js와 브라우저처럼 순수한 문자열 변환입니다. 해석된 URL이 실제 모듈에 대응하는지 검사하지 않고, 아예 URL로 파싱되지 않는 지정자에는 `null` 대신 `TypeError`를 던집니다. 퍼센트 인코딩은 `new URL()`처럼 정규화하여 `./a/../b.js` 같은 경로는 접지만, 이미 퍼센트 인코딩된 문자를 디코딩하지는 않습니다.

지정자는 URL입니다. 상대 임포트는 `new URL(specifier, base)`처럼 해석되고 전체 URL도 지정자로 쓸 수 있습니다. 더 흥미로운 결과는 쿼리 문자열과 프래그먼트입니다. 브라우저와 같은 모듈 정체성 규칙에 따라 쿼리나 프래그먼트가 다른 지정자는 같은 소스를 가리켜도 별개의 모듈 인스턴스입니다. `./counter.js?a`와 `./counter.js?b`는 같은 소스를 불러오지만 따로 평가되어 각자 `import.meta.url`과 최상위 상태의 사본을 가집니다. 원문의 `increment` 예시에서 `?a` 쪽은 1, 2가 나오고 `?b` 쪽은 별도 인스턴스라 1이 나옵니다. 같은 쿼리의 같은 지정자를 다시 임포트하면 같은 인스턴스를 받으므로 이것이 임포트마다 재평가를 강제하는 방법은 아닙니다.

import attributes 검증도 바로잡혔습니다. 기존 구현은 스펙을 어기고 import attributes를 조용히 무시했는데, 스펙은 이해하지 못하는 속성이 있으면 예외를 던지게 합니다. 지금은 `json`만 활성입니다. 관련 TC39 제안 중 Stage 4에 이른 것이 이것뿐이기 때문입니다. `text`와 `bytes`는 Import Text와 Import Bytes 제안을 따라 인식은 하지만 조용히 무시하거나 지원하지 않는 문법으로 다루는 대신 특정 오류로 거부합니다. `type` 외의 속성 키도 무시하지 않고 하드 오류이고, 지정한 type과 실제 모듈 유형이 다르면 `Module "./utils.js" is not of type "json"` 오류가 납니다.

`require(esm)`은 Node.js 규칙을 따릅니다. CommonJS 모듈 안에서 직접이든 `createRequire()`를 통해서든 ES 모듈을 `require()`하면, 문자열 이름의 `'module.exports'` 익스포트가 있으면 그 값을 반환하고, 없으면 모듈 네임스페이스 객체를 반환합니다. `workerd` 자체의 `node:` 내장 모듈이 유일한 예외입니다. 이것들은 기본 익스포트에 CommonJS식 API를 감싼 ES 모듈로 구현되어 있어서 `require('node:buffer').Buffer`가 기대대로 동작하고 `.default`를 직접 벗겨 낼 필요가 없습니다. 제약도 따라옵니다. `require()`하는 모듈이나 그 모듈 그래프 안에 최상위 `await`가 있으면 막거나 덜 끝난 값을 주는 대신 오류를 던집니다. Node.js의 `ERR_REQUIRE_ASYNC_MODULE` 제약과 같은 것으로, `require()`는 동기로 반환해야 하는데 평가가 끝나지 않은 모듈에 돌려줄 합리적인 값이 없기 때문입니다. 비동기에는 `import()`를 써야 하고, 앞서 누군가 `import()`로 불러 평가를 마쳤다고 해서 그 모듈이 `require()` 가능해지지도 않습니다. Node.js의 `require(esm)` 지원 이전에 나온 번들러가 표식으로 쓰는 참 값의 `__cjsUnwrapDefault` 익스포트가 있으면 위 두 규칙보다 우선해 기본 익스포트를 반환하며, 기존 사전 빌드 번들이 계속 동작하게 하려는 장치입니다.

오류는 일관되고 알맞은 클래스를 씁니다. 정적 `import`, 동적 `import()`, `require()` 중 어느 경로에서 해석이 실패해도 같은 종류의 오류와 같은 메시지 형태가 나옵니다. `Module not found`는 값 자체의 문제가 아니라 대상을 못 찾은 실패이므로 일반 `Error`입니다. URL로 파싱할 수 없는 지정자는 Node.js의 `ERR_INVALID_MODULE_SPECIFIER`에 맞춰 `TypeError`이고, V8이 풀지 못하는 순환 의존성도 `TypeError`가 아닌 일반 `Error`입니다. 동적 `import()` 위에 자체 로더나 재시도 래퍼를 만드는 경우, 어느 로딩 경로에서 일어났든 오류 클래스나 메시지로 안정적으로 분기할 수 있게 됩니다.

WebAssembly 모듈은 컴파일됐지만 인스턴스화되지는 않은 형태를 source phase import로 바로 가져올 수 있습니다. `import source wasmModule from './add.wasm'`이나 동적 `await import.source('./add.wasm')`이며, 모듈을 일반적으로 임포트해 `default` 익스포트에서 꺼내는 대신 `WebAssembly.Module`을 곧바로 받습니다. 언어의 새 기능이라 지금은 WebAssembly에서만 동작하고, 다른 모듈 유형에 쓰면 Node.js 및 다른 런타임과 같게 `SyntaxError`가 납니다.

## 다음 단계 {#다음}

Worker에 `new_module_registry` 호환 플래그를 추가해 써 볼 수 있습니다. 아직 기본 활성 날짜가 정해지지 않아서 호환 날짜가 무엇이든 자동으로 켜지지 않고 플래그를 명시해야 합니다. `workerd`는 오픈소스이고, 여기서 설명한 변경이 아닌 회귀로 보이는 동작은 `workerd` 저장소에 이슈로 올리라고 합니다.

{{% details title="플래그와 한도 설정" closed="true" %}}

| 항목 | 값 |
|---|---|
| 호환 플래그 | `new_module_registry` (기본 활성 날짜 없음) |
| 번들 크기 한도 | 모든 플랜 최대 64MiB, 압축 번들 크기 제한은 제거 |
| 번들러 | Wrangler는 esbuild, Cloudflare Vite 플러그인은 Vite 8의 Rolldown |
| 활성인 import attribute 유형 | `json`만 (`text`, `bytes`는 인식하되 거부) |
| 모듈 지정자 예시 | `file:///bundle/index.js` |

{{% /details %}}
