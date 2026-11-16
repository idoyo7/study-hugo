---
title: "Node.js와 모듈 규칙을 맞춘 Workers의 새 레지스트리"
description: "Workers에서 Node.js 앱을 실행하려면 API뿐 아니라 모듈을 찾고 불러오는 규칙도 맞아야 합니다. Cloudflare는 URL을 기준으로 모듈 레지스트리를 다시 쓰고, 지연 컴파일과 캐시 공유를 처음부터 설계에 넣었습니다."
date: 2026-11-14
weight: 4
---

# Node.js와 모듈 규칙을 맞춘 Workers의 새 레지스트리 (2026-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How we rebuilt Cloudflare Workers’ module registry for Node.js compatibility](https://blog.cloudflare.com/workers-module-registry-nodejs)
- 매체 · 게시일: The Cloudflare Blog · 2026-09-09
- 저자: Logan Gatlin, James Snell
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 수십만 줄로 커진 Workers 번들 {#로딩}

Cloudflare는 Worker의 스크립트가 수십만 줄까지 커지는 사례를 봤습니다. Wrangler가 기본적으로 거의 모든 코드를 모듈 스크립트 하나로 합치기 때문입니다. 내부에서 실행하는 `esbuild`는 상대 임포트와 대부분의 npm 의존성에 대한 `require()` 호출을 처리해 코드를 인라인하고, `import`와 `require()`를 일반 함수로 바꾸므로, Workers 런타임의 핵심 오픈소스 구성 요소인 `workerd`에 번들이 도착할 때면, 런타임이 처리할 모듈 그래프는 거의 남아 있지 않습니다.

여러 모듈을 올리는 기능은 오래전부터 있었습니다. 서로 다른 유형의 모듈도 배포할 수 있었습니다. 문제는 기존 Workers 런타임이 모듈을 해석하는 방식이 다른 런타임과 일치하지 않았다는 점입니다. 코드나 의존성이 `import.meta.resolve()`로 다른 모듈의 경로를 구하려 하면, 이 함수를 지원하지 않아 실패했습니다.

Node.js API 지원만 늘려서는 해결되지 않는 문제였습니다. Workers는 이제 서버리스에서 쓸 만한 Node.js의 안정 API를 모두 지원하며, 이 API들은 기본으로 활성화되어 있습니다. 모든 플랜에서 최대 64MiB의 번들을 배포할 수 있고 압축 번들 크기 제한도 없어졌습니다. 더 큰 앱을 받아들이는 데서 그치지 않고, 앱이 기대하는 모듈 해석·로딩·캐시 동작까지 맞춰야 했습니다.

Cloudflare Vite 플러그인을 쓰면 번들의 형태가 조금 달라집니다. Vite 8은 esbuild 대신 Rolldown으로 임포트와 npm 의존성을 해석하고, 필요하면 CommonJS를 ESM으로 변환합니다. 진입 모듈 외에도 동적 임포트 같은 코드 분할로 생긴 청크를 내보내므로, 런타임은 애플리케이션의 원래 소스 그래프보다 작은 모듈 그래프를 받습니다. 이 역시 빌드 도구가 가공한 결과입니다. 이렇게 만들어진 하나 또는 여러 모듈을 `wrangler deploy`로 Cloudflare에 업로드합니다.

번들러가 모든 모듈을 합치는 것은 아닙니다. Worker에서 Node.js API를 임포트하면 기본적으로 폴리필을 번들에 넣는 대신 `workerd`의 내장 모듈을 가져옵니다. Wasm, 텍스트, 바이너리 모듈도 별도 파일로 전달되며, 임포트할 대상을 나타내는 지정자로 참조됩니다. `--no-bundle`로 배포하거나 도구가 여러 모듈을 직접 업로드하면 작성한 모듈 그래프 전체가 런타임에 도착합니다.

어느 경우든 런타임이 해야 할 일은 남습니다. 지정자가 가리키는 코드를 찾고, 컴파일한 뒤, V8이 링크하고 실행할 모듈 객체를 넘겨야 합니다. ESM, CommonJS, WebAssembly를 불러오는 이 과정을 맡는 시스템이 모듈 레지스트리입니다.

## URL과 지연 컴파일에서 출발한 설계 {#이유}

기존 레지스트리는 지정자를 파일 시스템식 경로로 해석했습니다. URL과 경로의 차이는 작아 보여도 지원할 수 있는 동작을 제한했습니다. `import.meta.url`을 깔끔하게 구현하기 어려웠고, 상대 임포트의 해석 결과도 `new URL()`의 규칙과 일치하지 않았습니다. `node:`와 `cloudflare:`마저 프로토콜로 다루지 않고 문자열 앞부분을 따로 검사해 처리했습니다.

컴파일과 메모리 사용에도 중복이 있었습니다. 기존 구현은 실제로 임포트되는지와 관계없이 Worker 번들 전체를 미리 컴파일하고, V8 isolate마다 별도의 사본을 보관했습니다. Cloudflare는 CPU 코어에 부하를 나누려고 같은 Worker의 isolate 복제본을 여럿 실행합니다. 그 결과 같은 소스를 여러 번 컴파일하고, 메모리에도 소스 사본을 여러 개 두었습니다.

이 동작 자체가 버그는 아니었습니다. 하지만 기존 호환성을 유지하며 구현을 발전시키기는 어려웠습니다. 새 레지스트리는 지정자를 처음부터 URL로 다루고, 지연 컴파일과 캐시 공유를 설계의 출발점으로 삼았습니다. 모듈은 정적·동적 임포트 중 어느 방식이든 처음 임포트될 때 컴파일됩니다.

이제 Rolldown 같은 번들러가 변환 작업을 줄이고 모듈 해석을 런타임에 더 맡길 길이 열렸습니다. 번들러가 이미 그렇게 바뀌었다는 뜻은 아닙니다. 기존 레지스트리도 계속 남아 있으므로, 배포된 Worker는 종전대로 동작합니다.

## 쿼리마다 독립된 상태를 갖는 모듈 인스턴스 {#세부}

새 레지스트리에서 상대 임포트는 `new URL(specifier, base)`의 규칙을 따릅니다. 내부에서도 실제로 이 방식으로 해석하며, 상대 경로뿐 아니라 전체 URL도 지정자로 받습니다. 쿼리 문자열과 프래그먼트도 모듈을 구별하는 기준에 들어갑니다.

같은 소스 파일을 가리켜도 쿼리나 프래그먼트가 다르면 별개의 모듈 인스턴스입니다. 브라우저와 같은 규칙입니다. 예를 들어 상태를 가진 카운터 모듈이 있습니다.

`counter.js`는 `let n = 0`으로 상태를 두고, `increment()`가 호출될 때마다 `++n`을 반환합니다.

이 모듈을 서로 다른 쿼리로 임포트하면 카운터도 따로 움직입니다.

`./counter.js?a`의 `increment()`를 `incA`로, `./counter.js?b`의 `increment()`를 `incB`로 가져오면, `incA()`를 두 번 호출한 결과는 차례로 1과 2이고 `incB()`를 처음 호출한 결과는 1입니다.

`./counter.js?a`와 `./counter.js?b`는 같은 소스를 읽지만 따로 평가됩니다. 각각 자신의 `import.meta.url`과 최상위 상태를 갖기 때문에, `?a` 쪽 카운터를 올려도 `?b` 쪽 값은 변하지 않습니다. 같은 쿼리를 붙인 같은 지정자를 다시 임포트하면 기존 인스턴스를 돌려받습니다. 임포트할 때마다 평가를 새로 시작하는 기능은 아닙니다.

Node.js 내장 모듈의 동일성도 보장됩니다. 어떤 경로로 접근하든 같은 `node:` 내장 모듈은 같은 인스턴스로 해석됩니다.

`import.meta`에서는 이렇게 정해진 모듈의 URL과 진입점 여부를 확인할 수 있습니다. `import.meta.url`과 `import.meta.main`을 출력하면 `file:///bundle/index.js, main: true` 같은 결과를 얻습니다. `import.meta.main`이 true인 곳은 Worker의 진입점으로 설정한 모듈뿐입니다. 나머지 모듈에서는 false입니다.

경로만 구할 때는 `import.meta.resolve()`를 씁니다. 현재 모듈을 기준으로 지정자를 해석하지만, 실제로 임포트하거나 해당 URL에 모듈이 존재하는지 확인하지는 않습니다. Node.js와 브라우저에서처럼 순수한 문자열 변환입니다. URL로 파싱할 수 없는 지정자는 `null`을 반환하는 대신 `TypeError`를 던집니다.

정규화도 `new URL()`과 같습니다. `./a/../b.js`처럼 앞뒤로 이동하는 경로는 정리하지만, 이미 퍼센트 인코딩된 문자를 디코딩하지는 않습니다. 따라서 `%66oo.js`를 해석해도 경로에 `%66oo.js`가 남으며 `foo.js`로 바뀌지 않습니다.

## 동기로 값을 돌려줘야 하는 `require(esm)` {#require-esm}

CommonJS 코드에서 ES 모듈을 `require()`할 때 무엇을 돌려받는지도 호환성의 일부입니다. 새 레지스트리는 CommonJS 모듈에서 직접 호출하든 `createRequire()`로 만든 함수를 쓰든 Node.js의 `require(esm)` 규칙을 따릅니다. ES 모듈이 `'module.exports'`라는 문자열 이름으로 값을 내보내면 그 값을 반환합니다. 그런 익스포트가 없으면 모듈 네임스페이스 객체를 돌려줍니다.

`workerd`의 `node:` 내장 모듈에는 별도 처리가 있습니다. 이 모듈들은 CommonJS식 API를 기본 익스포트에 담은 ES 모듈이므로, `require()`하면 기본 익스포트를 바로 반환합니다. `require('node:buffer').Buffer`로 기대한 API에 접근할 수 있고, 호출자가 `.default`를 한 번 더 꺼낼 필요가 없습니다.

오래된 번들도 계속 동작해야 합니다. Node.js가 `require(esm)`을 지원하기 전에 나온 번들러가 참으로 평가되는 `__cjsUnwrapDefault` 익스포트를 표식으로 남겼다면, 이 표식이 `'module.exports'`와 네임스페이스 반환 규칙보다 우선합니다. 이때는 기본 익스포트를 반환합니다. 기존에 빌드된 번들을 위한 호환 처리입니다.

값을 동기로 돌려줘야 한다는 제약은 그대로입니다. `require()` 대상이나 그 모듈 그래프 안에 최상위 `await`가 있으면, 실행이 끝날 때까지 기다리거나 미완성 값을 넘기는 대신 오류를 던집니다. 평가를 마치지 않은 모듈에서 동기로 반환할 합리적인 값이 없기 때문입니다. Node.js의 `ERR_REQUIRE_ASYNC_MODULE`과 같은 제약입니다.

임포트 순서로 이 제약을 피할 수도 없습니다. 앞서 `import()`로 불러와 평가까지 끝낸 모듈이어도, 그래프에 최상위 `await`가 있으면 `require()`할 수 없습니다. 비동기 모듈에는 `import()`를 써야 합니다.

## 조용히 무시하던 속성에서 명확한 오류까지 {#validation}

기존 레지스트리는 `with { type: 'json' }` 같은 import attributes를 조용히 무시했습니다. 이해하지 못하는 속성에 예외를 던지도록 한 스펙과 어긋나는 동작이었습니다. 새 구현에서는 속성 자체와 실제 모듈 유형을 검사합니다.

현재 활성화된 유형은 `json`뿐입니다. 관련 TC39 제안 중 Stage 4에 도달한 것이 JSON뿐이기 때문입니다. `text`와 `bytes`는 Import Text와 Import Bytes 제안을 따라 인식하지만, 아직 지원하지 않는다는 특정 오류로 거부합니다. 무시하거나 알 수 없는 문법으로 취급하지 않습니다.

속성 키도 검사 대상입니다. `type` 외에 `cache` 같은 키를 넣으면 예외를 던지고, JavaScript 모듈에 `type: 'json'`을 지정하면 `Module "./utils.js" is not of type "json"` 오류가 납니다. 속성을 적었다고 다른 유형의 모듈을 JSON으로 읽지는 않습니다.

로딩 경로에 따라 오류를 다르게 처리하던 문제도 바로잡았습니다. 정적 `import`, 동적 `import()`, `require()` 중 어디서 모듈 해석이 실패하든 같은 오류 클래스와 같은 메시지 형태를 반환합니다. 대상을 찾지 못한 `Module not found`는 일반 `Error`입니다. 전달한 값 자체의 문제가 아니기 때문입니다.

URL로 파싱할 수 없는 지정자는 `TypeError`입니다. Node.js의 `ERR_INVALID_MODULE_SPECIFIER`에 맞춘 구분입니다. V8이 해소하지 못하는 순환 의존성에는 일반 `Error`를 쓰며, `TypeError`를 던지지 않습니다. 동적 `import()`를 사용하는 자체 로더나 재시도 래퍼를 만든다면, 어느 로딩 경로에서 실패했는지와 관계없이 오류 클래스나 메시지를 기준으로 분기할 수 있습니다.

## 인스턴스화 전에 가져오는 WebAssembly 모듈 {#wasm-source}

WebAssembly에는 컴파일은 끝났지만 아직 인스턴스화하지 않은 모듈을 직접 가져오는 source phase import가 추가됐습니다. `import source wasmModule from './add.wasm'`으로 정적으로 가져오거나, `await import.source('./add.wasm')`으로 동적으로 가져옵니다. 어느 쪽이든 반환값은 `WebAssembly.Module`입니다.

일반 임포트의 `default` 익스포트에서 모듈을 꺼내던 단계가 줄어듭니다. 가져온 모듈은 `WebAssembly.instantiate()`로 인스턴스화할 수 있습니다. 언어에 새로 추가된 기능이라 현재 지원 대상은 WebAssembly뿐이며, 다른 유형의 모듈에 사용하면 Node.js와 다른 런타임에서처럼 `SyntaxError`가 납니다.

## 명시적으로 켜는 `new_module_registry` 플래그 {#다음}

새 레지스트리는 Worker에 호환 플래그를 추가해 사용할 수 있습니다.

설정값은 `{"compatibility_flags": ["new_module_registry"]}`입니다.

기본 활성 날짜는 아직 정해지지 않았습니다. 기존 Worker든 새 Worker든 호환 날짜만으로 자동 활성화되지 않으므로, `new_module_registry`를 명시해야 합니다. Cloudflare는 설명된 동작 변경에 해당하지 않는 회귀를 발견하면 오픈소스 `workerd` 저장소에 이슈로 알려 달라고 요청합니다.

{{% details title="플래그와 지원 범위" closed="true" %}}

| 항목 | 값 |
|---|---|
| 호환 플래그 | `new_module_registry` (기본 활성 날짜 없음) |
| 번들 크기 한도 | 모든 플랜 최대 64MiB, 압축 번들 크기 제한은 제거 |
| 번들러 | Wrangler는 esbuild, Cloudflare Vite 플러그인은 Vite 8의 Rolldown |
| 활성인 import attribute 유형 | `json`만 (`text`, `bytes`는 인식하되 거부) |
| 모듈 지정자 예시 | `file:///bundle/index.js` |

{{% /details %}}
