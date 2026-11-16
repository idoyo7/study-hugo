---
title: "한 요청의 실패에 멈춰 서던 Rust Workers의 복구 설계"
description: "한 요청의 panic이나 abort가 다른 요청까지 실패시키던 Rust Workers의 문제를 Cloudflare가 wasm-bindgen에서 해결했습니다. panic은 소멸자를 실행하며 상태를 보존하고, abort는 오염된 인스턴스의 실행을 막은 뒤 이후 요청을 위해 복구합니다."
date: 2026-11-14
weight: 4
---

# 한 요청의 실패에 멈춰 서던 Rust Workers의 복구 설계 (2026-04)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Making Rust Workers reliable: panic and abort recovery in wasm‑bindgen](https://blog.cloudflare.com/making-rust-workers-reliable)
- 매체 · 게시일: The Cloudflare Blog · 2026-04-22
- 저자: Guy Bedford, Hood Chatham, Logan Gatlin
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 다음 요청에도 남아 있던 실패의 흔적 {#problem}

Rust Workers에서 panic은 오랫동안 한 요청만의 문제가 아니었습니다. Rust를 WebAssembly로 컴파일해 Cloudflare Workers에서 실행하다가 panic이나 예기치 않은 abort가 나면, 런타임이 정의되지 않은 상태로 남을 수 있었습니다. 오염된 인스턴스는 함께 처리 중인 요청뿐 아니라 새로 들어오는 요청까지 실패시키고, 한동안 Worker를 못 쓰게 만들기도 했습니다.

문제는 Rust와 JavaScript 사이의 바인딩을 생성하는 wasm-bindgen에 실패 이후의 복구 동작이 내장돼 있지 않다는 점이었습니다. Cloudflare가 문제를 감지하고 완화해도, 처리되지 않은 abort 하나가 다른 요청의 실패로 번질 가능성은 작게나마 남아 있었습니다.

처음 마련한 해법은 애플리케이션 전체를 다시 초기화하는 방식이었습니다. 커스텀 Rust panic 핸들러가 Worker의 실패 상태를 추적하고, 다음 요청을 처리하기 전에 재초기화를 시작했습니다. JavaScript에서는 Proxy로 Rust-JavaScript 호출 경계를 감싸 모든 진입점에 이 처리가 적용되도록 했습니다. 생성된 바인딩도 손봤습니다. 실패 뒤 WebAssembly 모듈을 올바르게 다시 초기화하려면 바인딩 쪽의 수정도 필요했기 때문입니다.

이 복구 래퍼는 workers-rs 0.6부터 모든 사용자에게 기본으로 제공됐고, 실제로 관찰되던 지속적인 실패를 없앴습니다. Worker를 되살리는 데는 성공했습니다. 하지만 Durable Objects처럼 메모리에 의미 있는 상태를 보관하는 워크로드에서는 한 요청의 panic 때문에 다른 요청이 쓰던 상태까지 통째로 잃었습니다. 상태 없는 요청 핸들러에는 괜찮은 재초기화가, 상태를 가진 애플리케이션에는 손실이었습니다.

## 소멸자를 실행하고 상태를 남기는 panic=unwind {#panic-unwind}

인스턴스를 버리지 않고 panic에서 복구하려면 실패한 호출을 빠져나오면서 소멸자를 실행해야 했습니다. 대부분의 네이티브 Rust 환경에서 쓰는 panic unwind가 이 역할을 합니다. 그러나 `wasm32-unknown-unknown`으로 컴파일한 Rust의 기본값은 `panic=abort`입니다. panic이 나면 `unreachable` 명령에서 trap이 발생하고, `WebAssembly.RuntimeError`와 함께 Wasm 실행이 끊긴 채 JavaScript로 돌아옵니다.

Cloudflare는 wasm-bindgen에 `wasm32-unknown-unknown`용 `panic=unwind` 지원을 추가했습니다. 이 경로에서는 소멸자가 실행되고 WebAssembly 인스턴스도 유효한 상태로 남아 재사용됩니다. Rust Workers 0.8.0부터는 빌드 명령에 `--panic-unwind`를 붙여 선택합니다. panic 복구와 함께 새로운 abort 분류 및 복구 훅도 사용하며, `panic=abort`를 유지하는 사용자는 0.6.0부터 제공된 기존 커스텀 복구 래퍼를 계속 이용합니다. Cloudflare는 업그레이드해 이 플래그를 써 볼 것을 권했고, 이후 릴리스에서는 `panic=unwind`를 기본값으로 삼을 계획이라고 밝혔습니다.

이 동작을 가능하게 한 것은 2023년에 엔진 지원이 넓어진 WebAssembly Exception Handling 제안입니다. 빌드는 `RUSTFLAGS='-Cpanic=unwind' cargo build -Zbuild-std`로 시작합니다. 표준 라이브러리부터 unwind를 지원하도록 다시 빌드하고, panic이 났을 때 소멸자를 실행하는 코드를 생성합니다.

예를 들어 `HasDropA`와 `HasDropB`를 차례로 만든 뒤 `imported_func()`를 호출하는 함수가 있다고 가정합니다. 정상적으로 반환하면 소멸자를 실행합니다. 호출 중 panic이 나더라도, 컴파일된 `try` / `catch_all` 블록이 `drop_b`, `drop_a` 순서로 소멸자를 호출한 뒤 예외를 다시 던집니다. `std::panic::catch_unwind(|| some_func())` 역시 Wasm 예외 처리 명령으로 컴파일돼 정상 반환은 `Ok`, 잡아낸 panic은 `Err`로 돌려줍니다.

컴파일러가 코드를 생성하는 것만으로는 부족했습니다. wasm-bindgen 툴체인도 그 코드를 읽고 처리해야 했습니다. 팀은 try/catch 명령을 모르던 WebAssembly 파서 Walrus에 지원을 추가하고, 디스크립터 인터프리터가 예외 처리 블록을 포함한 코드도 평가하도록 수정했습니다. 여기까지 바꾼 뒤에야 애플리케이션 전체를 `panic=unwind`로 빌드할 수 있었습니다.

## 안전한 unwind를 위한 Rust-JavaScript 경계 {#unwind-boundary}

unwind가 Rust 안에서만 동작해서는 요청을 복구할 수 없습니다. wasm-bindgen이 생성하는 export도 Rust-JavaScript 경계에서 panic을 잡아 JavaScript의 `PanicError` 예외로 전달하도록 바꿨습니다. 비동기 export에서는 panic이 반환된 `Promise`를 `PanicError`로 reject합니다. JavaScript 쪽에는 실패를 알리되, 소멸자를 실행한 Wasm 인스턴스는 다시 쓸 수 있게 남기는 동작입니다.

호출 규약에도 함정이 있었습니다. Rust는 외부 예외가 `extern "C"` 함수를 거쳐 unwind하면 이를 잡아 abort하므로, export를 `extern "C-unwind"`로 표시해 경계를 넘는 unwind를 명시적으로 허용해야 했습니다.

클로저에서는 허용 여부를 더 따져야 했습니다. 새로 도입한 `MaybeUnwindSafe` 트레이트는 `panic=unwind`로 빌드할 때만 `UnwindSafe`를 검사합니다. 이 검사를 적용하자 많은 클로저가 unwind 뒤에도 남는 참조를 캡처해, 본래 unwind에 안전하지 않다는 문제가 드러났습니다. 컴파일러를 통과하려고 `AssertUnwindSafe`로 잘못 감싸게 유도해서는 안 됐습니다. 팀은 안전성을 보장할 수 없는 경우를 위해 `Closure::new_aborting` 변형을 추가했습니다. 이 변형은 panic이 나면 unwind하지 않고 종료합니다.

Cloudflare는 이런 복구 작업을 지난해 결성된 wasm-bindgen 조직 안에서 협력하며 업스트림에 기여했습니다. Workers에만 적용한 커스텀 JavaScript 복구 로직에서 출발해, 바인딩을 만드는 프로젝트 자체에 복구 동작을 마련한 것입니다.

## abort 뒤의 재실행을 막는 마지막 방어선 {#abort-recovery}

`panic=unwind`를 켜도 abort는 남습니다. 메모리 부족은 흔한 원인 중 하나입니다. abort는 unwind할 수 없으므로 그 상태를 복구할 방법도 없습니다. 여기서 지켜야 할 대상은 이후의 실행입니다. 잘못된 상태로 요청을 계속 처리하지 않도록 abort를 감지하고, 다음 연산이 성공할 수 있게 복구해야 합니다.

그런데 unwind 지원을 추가하면서 오류를 구별하는 일이 더 까다로워졌습니다. Wasm에서 JavaScript로 나온 오류만 보고는 `extern "C-unwind"`를 거친 외부 오류인지, 실제 abort인지 알 수 없었습니다. WebAssembly의 abort는 형태도 다양합니다. 확실한 abort에 표시를 붙이는 방법과 확실한 unwind에 표시를 붙이는 방법 모두 가능했지만, 팀은 unwind 쪽을 택했습니다.

선택의 이유는 이미 작성한 코드에 있었습니다. 외부 예외 처리에서 WAT, 즉 WebAssembly 텍스트 형식의 예외 처리 명령을 직접 사용하고 있었으므로, 외부 예외에 태그를 달아 unwind할 수 없는 abort와 구분하는 편이 쉬웠습니다. WebAssembly Exception Handling의 `Exception.Tag`로 복구 가능한 오류와 불가능한 오류를 가려낸 뒤, 새 abort 핸들러와 재진입 가드를 통합했습니다. 초기화할 때 `set_on_abort` 훅에 핸들러를 등록하면 Wasm을 실행하는 플랫폼의 요구에 맞게 복구 동작을 정할 수 있습니다.

오류를 알아보는 것만큼 실행을 막는 일도 까다로웠습니다. Wasm이 JavaScript를 호출하고 그 JavaScript가 다시 Wasm에 들어가는 호출은 임의의 깊이로 중첩될 수 있으며, 같은 인스턴스에서 여러 태스크가 실행될 수도 있습니다. 예전에는 한 태스크나 중첩된 호출에서 abort가 나더라도, JavaScript를 거치는 상위 호출 스택까지 무효화된다는 보장이 없었습니다. 그 결과 정의되지 않은 동작으로 이어질 수 있었습니다.

재진입 가드는 abort가 난 뒤 Rust 코드가 Wasm에서 다시 실행되지 않도록 막습니다. 복구 훅은 이후 연산을 위한 복구를 맡습니다. 애플리케이션을 다시 초기화하는 것은 최악의 경우에 쓰는 수단이지만, 오염된 상태가 남아 실패를 거듭 일으키지 않게 하는 마지막 방어선입니다. 복잡하게 얽힌 호출에서도 실행의 정확성을 보장하기 위한 작업은 계속 진행 중입니다.

## 재임포트 없이 다시 쓰는 wasm-bindgen 라이브러리 {#library-reset}

복구가 필요한 곳은 Rust Workers만이 아니었습니다. JavaScript 애플리케이션이 wasm-bindgen으로 만든 Wasm 라이브러리를 사용할 때도 같은 문제가 생깁니다. Cloudflare 팀이 지원하는 JS 기반 Workers 사용자 가운데도 Rust 기반 Wasm 라이브러리를 의존성으로 쓰는 사용자가 있었습니다.

ES 모듈로 만든 라이브러리를 `import { func } from 'wasm-dep'`처럼 가져온 상황을 생각하면 문제가 분명해집니다. 바인딩은 이미 연결됐고 라이브러리도 초기화됐습니다. 이때 `func()`를 호출하다 abort가 나면, 라이브러리를 사용하는 애플리케이션 안에서 어떻게 복구해야 할지가 불분명했습니다.

팀은 이를 위해 wasm-bindgen에 실험적 기능인 `--reset-state-function`을 추가했습니다. 이 옵션은 Rust 애플리케이션이 내부 Wasm 인스턴스를 다음 호출에 대비해 초기 상태로 되돌리도록 요청하는 함수를 노출합니다. 사용하는 쪽에서 생성된 바인딩을 다시 임포트하거나 새로 만들지 않아도 됩니다.

옛 객체까지 살려 주지는 않습니다. 이전 Wasm 인스턴스에서 만든 클래스 인스턴스는 핸들이 연결 대상을 잃어 예외를 던지지만, 새 클래스 인스턴스는 생성할 수 있습니다. Wasm 라이브러리를 쓰던 JavaScript 애플리케이션은 오류를 겪어도 벽돌처럼 멈춘 채 남지는 않습니다.

## 기본 타깃 전환을 늦추던 Node.js 일정 {#ecosystem}

wasm-bindgen을 고친 뒤에도 Rust 쪽의 과제가 남았습니다. 원문 작성 시점에 `panic=unwind`로 Wasm을 빌드하려면 여전히 실험적인 nightly Rust 타깃이 필요했습니다. Cloudflare는 이를 stable Rust로 가져가기 위해 Rust의 WebAssembly Exception Handling 지원도 개선하고 있었습니다.

예외 처리 명세에도 전환 과정이 있었습니다. 개발 후반에 명세가 바뀌면서 레거시 예외 처리와 최종 형태인 “exnref” 현대 예외 처리가 생겼습니다. Rust의 WebAssembly 타깃은 당시에도 기본으로 레거시용 코드를 생성했습니다. 레거시는 널리 지원되지만 이미 폐기 예정이었으므로, 현대 예외 처리를 지원하는 런타임의 범위가 기본 타깃을 바꾸는 데 걸림돌이 됐습니다.

지원 현황을 확인하던 팀의 가장 큰 걱정은 Node.js 24 LTS 일정이었습니다. 그대로라면 생태계가 2028년 4월까지 레거시 예외 처리에 묶일 상황이었습니다. 팀은 현대 예외 처리를 Node.js 24에 백포트하고, 동작에 필요한 수정도 Node.js 22 계열에 백포트했습니다. 이 작업으로 이듬해에는 현대 예외 처리를 기본 타깃으로 삼을 수 있을 것으로 기대했습니다. 전환이 끝난 것은 아닙니다. 이후 몇 달 동안 stable `panic=unwind`와 현대 예외 처리로 옮겨 가는 과정이 최종 사용자에게 가능한 한 드러나지 않도록 작업할 계획이었습니다.

이 작업은 Rust Workers의 안정 릴리스를 준비하는 과정에 속합니다. Cloudflare는 wasm-bindgen generics와 자동화된 bindgen을 비롯한 추가 개선 내용도 곧 공유하겠다고 예고했습니다.

{{% details title="현대 예외 처리 지원 버전과 복구 기능의 도입 시점" closed="true" %}}

| 런타임 | 버전 | 릴리스 날짜 |
|---|---|---|
| v8 | 13.8.1 | 2025-04-28 |
| workerd | v1.20250620.0 | 2025-06-19 |
| Chrome | 138 | 2025-06-28 |
| Firefox | 131 | 2024-10-01 |
| Safari | 18.4 | 2025-03-31 |
| Node.js | 25.0.0 | 2025-10-15 |

| 항목 | 값 |
|---|---|
| 첫 완화책이 기본 제공된 버전 | workers-rs 0.6 |
| `--panic-unwind` 플래그 도입 버전 | Rust Workers 0.8.0 |
| 컴파일 설정 | `RUSTFLAGS='-Cpanic=unwind' cargo build -Zbuild-std` |
| Node.js 24 LTS 일정 문제 | 백포트 없이는 2028년 4월까지 레거시 예외 처리에 묶임 |
| 백포트 대상 | Node.js 24, Node.js 22 계열 수정 |

{{% /details %}}
