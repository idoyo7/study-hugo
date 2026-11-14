---
title: "Rust Workers의 panic과 abort 복구 구조"
description: "Cloudflare가 Rust Workers에서 panic이나 abort가 인스턴스를 오염시키는 문제를 wasm-bindgen 수준에서 푼 과정을 정리했습니다. panic=unwind 지원과 abort 복구 훅, 예외 처리 생태계 정비 작업을 요약합니다."
date: 2026-11-14
weight: 4
---

# Rust Workers의 panic과 abort 복구 구조 (2026-04)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Making Rust Workers reliable: panic and abort recovery in wasm‑bindgen](https://blog.cloudflare.com/making-rust-workers-reliable)
- 매체 · 게시일: The Cloudflare Blog · 2026-04-22
- 저자: Guy Bedford, Hood Chatham, Logan Gatlin
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## panic이 인스턴스를 오염시키는 문제 {#problem}

Rust Workers는 Rust를 WebAssembly로 컴파일해 Cloudflare Workers 위에서 돌립니다. 그런데 WebAssembly에는 날카로운 모서리가 있어서, panic이나 예기치 않은 abort가 나면 런타임이 정의되지 않은 상태로 남을 수 있습니다. Rust Workers 사용자에게 panic은 오래도록 치명적이었고, 인스턴스를 오염시켜 한동안 Worker를 못 쓰게 만들 수도 있었습니다. 문제를 감지하고 완화할 수는 있었지만 Rust Worker가 예기치 않게 실패하면서 다른 요청까지 실패시킬 가능성이 작게나마 남아 있었습니다. 한 요청에 영향을 준 처리되지 않은 abort가 형제 요청, 심지어 새로 들어오는 요청에까지 번질 수 있었습니다. 근본 원인은 Rust Workers가 의존하는 Rust-JavaScript 바인딩 생성 프로젝트 wasm-bindgen에 복구 의미론이 내장돼 있지 않다는 점이었습니다. 이 글은 이를 푼 최신 Rust Workers의 오류 복구를 설명하며, 작업은 지난해 wasm-bindgen 조직 안에서 협력하며 업스트림에 기여됐습니다.

## 첫 완화책 {#initial-mitigation}

처음에는 프로덕션 Rust Workers에서 panic과 abort가 일으키는 실패를 이해하고 가두는 데 집중했습니다. Worker 안에서 실패 상태를 추적하는 커스텀 Rust panic 핸들러를 넣어, 이후 요청을 처리하기 전에 애플리케이션 전체를 다시 초기화하게 했습니다. JavaScript 쪽에서는 Proxy 기반 간접 호출로 Rust-JavaScript 호출 경계를 감싸 모든 진입점이 일관되게 캡슐화되게 했고, 생성된 바인딩도 실패 뒤 WebAssembly 모듈을 올바르게 재초기화하도록 고쳤습니다. 커스텀 JavaScript 로직에 의존했지만 신뢰할 수 있는 복구가 가능함을 보였고 실제로 관찰되던 지속적 실패 모드를 없앴습니다. 이 방식은 workers-rs 0.6부터 모든 사용자에게 기본으로 나갔고 이후의 일반적인 업스트림 abort 복구의 토대가 됐습니다.

## WebAssembly 예외 처리로 만든 panic=unwind {#panic-unwind}

위 방식은 Worker가 실패에서 살아남게 하지만 애플리케이션 전체를 재초기화하는 방식입니다. 상태 없는 요청 핸들러에는 괜찮지만 Durable Objects처럼 메모리에 의미 있는 상태를 쥔 워크로드에서는 상태를 통째로 잃습니다. 한 요청의 panic 하나가 동시에 처리 중인 다른 요청의 메모리 상태를 지울 수 있습니다. 네이티브 Rust 환경은 panic을 unwind해서 소멸자를 실행하고 상태를 잃지 않고 복구하지만, `wasm32-unknown-unknown`으로 컴파일한 Rust는 기본이 `panic=abort`라서 `unreachable` 명령으로 trap되어 `WebAssembly.RuntimeError`와 함께 JS로 빠져나옵니다.

상태를 버리지 않고 복구하려면 wasm-bindgen에 `wasm32-unknown-unknown`용 `panic=unwind` 지원이 필요했고, 2023년에 엔진 지원이 넓어진 WebAssembly Exception Handling 제안이 이를 가능하게 했습니다. `RUSTFLAGS='-Cpanic=unwind' cargo build -Zbuild-std`로 표준 라이브러리를 unwind 지원 상태로 다시 빌드합니다. 예를 들어 임포트 함수를 부르는 함수는 `try` / `catch_all` 블록으로 컴파일되어, 임포트 함수가 panic해도 소멸자가 실행되고 `std::panic::catch_unwind`도 같은 방식으로 컴파일됩니다.

끝까지 동작하려면 wasm-bindgen 툴체인 여러 곳을 바꿔야 했습니다. WebAssembly 파서 Walrus가 try/catch 명령을 몰라서 지원을 추가했고, 디스크립터 인터프리터도 예외 처리 블록이 있는 코드를 평가하도록 가르쳤습니다. 이후 애플리케이션 전체를 `panic=unwind`로 빌드할 수 있게 됐습니다. 마지막으로 wasm-bindgen이 생성하는 export가 Rust-JavaScript 경계에서 panic을 잡아 JavaScript `PanicError` 예외로 드러내게 바꿨습니다. Rust는 `extern "C"` 함수를 거치는 unwind에서 외부 예외를 잡아 abort하므로 export를 `extern "C-unwind"`로 표시해 경계를 넘는 unwind를 명시적으로 허용해야 했습니다. future에서는 panic이 JavaScript `Promise`를 `PanicError`로 reject합니다.

클로저는 unwind 안전성을 올바르게 검사하려고 `panic=unwind`로 빌드했을 때만 `UnwindSafe`를 검사하는 새 `MaybeUnwindSafe` 트레이트를 도입했습니다. 그런데 많은 클로저가 unwind 뒤에도 남는 참조를 캡처해 본질적으로 unwind에 안전하지 않다는 문제가 드러났습니다. 컴파일러를 만족시키려고 사용자가 `AssertUnwindSafe`로 잘못 감싸게 하지 않으려고, unwind 안전성을 보장할 수 없는 경우 unwind 대신 panic 시 종료하는 `Closure::new_aborting` 변형을 추가했습니다.

`panic=unwind`가 켜지면 export된 Rust 함수의 panic을 wasm-bindgen이 잡고, panic이 JavaScript에 `PanicError`로 드러나고, 비동기 export는 반환한 promise를 `PanicError`로 reject하며, 소멸자가 올바르게 실행되고, WebAssembly 인스턴스가 유효하게 남아 재사용됩니다.

## abort 복구 {#abort-recovery}

`panic=unwind`가 있어도 abort는 일어납니다. 메모리 부족이 흔한 원인입니다. abort는 unwind할 수 없으므로 상태를 복구할 방법은 없지만, 이후 연산을 위해 abort를 감지하고 복구해 잘못된 상태가 뒤이은 요청을 오류로 만들지 않게는 할 수 있습니다.

panic unwind 지원은 abort 복구에 새 문제를 만들었습니다. Wasm에서 오류를 받았을 때 `extern "C-unwind"`로 넘어온 외부 오류인지 진짜 abort인지 알 수 없다는 것입니다. WebAssembly에서 abort는 여러 형태를 띨 수 있습니다. 해법은 확실한 abort를 모두 표시하거나 확실한 unwind를 모두 표시하는 두 가지였고, 팀은 후자를 택했습니다. 외부 예외 처리가 이미 WAT 수준의 예외 처리 명령을 직접 쓰고 있어서, 외부 예외에 예외 태그를 달아 abort하는 unwind 불가 예외와 구분하는 편이 쉬웠습니다. WebAssembly Exception Handling의 `Exception.Tag` 기능으로 복구 가능한 오류와 불가능한 오류를 명확히 구별하게 되자 새 abort 핸들러와 abort 재진입 가드를 통합할 수 있었습니다. 초기화 때 `set_on_abort` 훅으로 플랫폼 임베딩에 맞는 복구 핸들러를 붙입니다.

panic과 abort 처리를 단단히 하는 것은 잘못된 실행 상태를 피하는 데 핵심입니다. WebAssembly는 Wasm이 JavaScript를 부르고 JavaScript가 임의 깊이로 다시 Wasm에 진입하는 깊게 얽힌 호출 스택을 허용하고, 한 인스턴스에서 여러 태스크가 함께 동작합니다. 예전에는 한 태스크나 중첩 스택에서 난 abort가 JS를 거치는 상위 스택을 무효화한다는 보장이 없어서 정의되지 않은 동작이 생겼습니다. 이 영역의 기여는 계속 진행 중이라고 합니다. 재초기화는 최악의 경우지만, 마지막 방어선으로서의 치명적 오류 복구가 실행의 정확성과 이후 연산의 성공을 보장해 단일 실패가 연쇄 실패로 번지지 않게 합니다.

## wasm-bindgen 라이브러리용 재초기화 확장 {#library-reset}

이 문제는 wasm-bindgen으로 만든 JS 사용 라이브러리 전반의 흔한 문제였고 abort 핸들러가 도움이 됩니다. 다만 Wasm을 ES 모듈로 빌드해 `import { func } from 'wasm-dep'`처럼 직접 임포트하면, 이미 링크되고 초기화된 라이브러리의 `func()` 호출 중 abort가 났을 때의 복구 방법이 불분명합니다. 순수한 Rust Workers 용도는 아니지만 JS 기반 Workers 사용자가 Rust 기반 Wasm 라이브러리를 의존성으로 쓰기 때문에, 이를 함께 풀면 Workers 플랫폼의 Wasm 사용에도 간접적으로 이롭습니다. 그래서 실험적 재초기화 기능 `--reset-state-function`을 wasm-bindgen에 넣었습니다. Rust 애플리케이션이 다음 호출을 위해 내부 Wasm 인스턴스를 초기 상태로 되돌려 달라고 요청하는 함수를 노출하며, 생성된 바인딩을 쓰는 쪽이 다시 임포트하거나 새로 만들 필요가 없습니다. 옛 인스턴스의 클래스 인스턴스는 핸들이 고아가 되어 예외를 던지지만 새 클래스는 만들 수 있어서, Wasm 라이브러리를 쓰는 JS 애플리케이션은 오류를 겪되 벽돌이 되지는 않습니다.

## 예외 처리 생태계 정비 {#ecosystem}

업스트림 기여는 wasm-bindgen에 그치지 않았습니다. `panic=unwind`로 Wasm을 빌드하려면 아직 실험적인 nightly Rust 타깃이 필요해서, 이를 stable로 가져가려고 Rust의 WebAssembly Exception Handling 지원 발전에도 힘썼습니다. 이 제안은 개발 후반의 명세 변경으로 레거시 예외 처리와 최종 형태인 "exnref" 현대 예외 처리 두 변형이 생겼고, Rust의 WebAssembly 타깃은 지금도 기본으로 레거시용 코드를 냅니다. 레거시는 널리 지원되지만 이제 폐기 예정입니다. 현대 예외 처리는 아래 표의 JS 플랫폼 릴리스부터 지원됩니다.

지원 매트릭스를 조사하면서 가장 큰 걱정은 Node.js 24 LTS 릴리스 일정이었습니다. 이대로면 전체 생태계가 2028년 4월까지 레거시 예외 처리에 묶일 판이었습니다. 이를 발견한 뒤 현대 예외 처리를 Node.js 24에 백포트하고, 이를 동작시키는 데 필요한 수정도 Node.js 22 계열에 백포트해 지원을 확보했습니다. 이로써 내년에는 현대 예외 처리 제안이 기본 타깃이 될 수 있다고 합니다. 앞으로 몇 달 동안 stable `panic=unwind`와 현대 예외 처리로의 전환이 최종 사용자에게 가능한 한 보이지 않도록 작업한다는 계획입니다.

## 사용 방법과 앞으로의 계획 {#usage}

Rust Workers 0.8.0부터 빌드 명령에 붙이는 `--panic-unwind` 플래그가 생겼습니다. 이 플래그를 쓰면 panic이 완전히 복구되고 abort 복구는 새 abort 분류와 복구 훅 방식을 씁니다. 원문은 업그레이드해 써 보라고 권하며 이후 릴리스에서 `panic=unwind`를 기본으로 만들 계획이라고 합니다. `panic=abort`에 머무는 사용자는 0.6.0의 이전 커스텀 복구 래퍼 처리를 계속 이용합니다. 이 작업은 Rust Workers 안정 릴리스를 향한 노력의 일부이며, 앞으로 wasm-bindgen generics와 자동화된 bindgen을 포함한 개선을 곧 공유한다고 합니다.

{{% details title="현대 예외 처리 지원 런타임과 버전" closed="true" %}}

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
