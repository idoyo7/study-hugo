---
title: "Workflows의 병렬 실행을 드러내는 AST 다이어그램"
description: "실행 순서가 미리 정해지지 않은 Cloudflare Workflows를 어떻게 그림으로 옮길까요? 배포 시점의 코드를 AST로 분석하고 Promise와 await 관계를 추적해 병렬 실행과 대기 지점을 드러냅니다."
date: 2026-11-14
weight: 9
---

# Workflows의 병렬 실행을 드러내는 AST 다이어그램 (2026-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How we use Abstract Syntax Trees (ASTs) to turn Workflows code into visual diagrams](https://blog.cloudflare.com/workflow-diagrams)
- 매체 · 게시일: The Cloudflare Blog · 2026-03-27
- 저자: André Venceslau, Mia Malden
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 실행 순서를 미리 모르는 Workflows 엔진 {#background}

코딩 에이전트가 작성한 코드를 사람이 모두 읽는다는 보장은 없습니다. 그래도 무엇을 만들었는지는 알아야 합니다. 단계가 어떻게 연결되고 어디서 분기하며 실제로 어떤 일이 일어나는지 보려는 요구가, Cloudflare가 배포된 모든 워크플로에 대시보드 다이어그램을 제공한 출발점입니다.

Cloudflare Workflows는 단계를 연결하고, 실패하면 재시도하며, 오래 실행되는 프로세스의 상태를 유지하는 durable execution 엔진입니다. 백그라운드 에이전트와 데이터 파이프라인, 사람이 승인하는 작업 등에 쓰입니다. 시각적 워크플로 빌더는 보통 JSON이나 YAML, 드래그 앤 드롭으로 정의한 흐름을 그림으로 옮깁니다. Workflows에서 그림의 재료는 코드입니다. `Promise.all`, 반복문, 조건문이 섞이고 함수나 클래스 안에 단계가 들어갈 수도 있습니다.

실행도 코드의 흐름을 따릅니다. 런타임이 단계를 만날 때 엔진에 실행을 맡기므로, 코드에 A, B, C 순서로 적었다고 해서 A가 끝난 뒤 B가 시작하는 것은 아닙니다. `await`하지 않은 단계는 병렬로 실행됩니다. 개발자는 별도 래퍼나 지시어 없이 코드의 흐름 제어를 그대로 쓸 수 있습니다.

인스턴스마다 “감독자” 역할의 Durable Object가 엔진으로 뜨고, 동적 디스패치로 사용자 Worker를 호출해 Workers 런타임에 제어를 넘깁니다. 런타임이 `step.do`를 만나면 다시 엔진 차례입니다. 엔진은 단계를 실행해 결과를 저장하거나 오류를 던지고, 사용자 Worker를 다시 호출합니다.

이 과정에서 엔진이 전체 단계의 순서를 본래 알고 있지는 않습니다. 하지만 다이어그램에는 그 순서가 필요합니다. Cloudflare는 배포된 코드에서 AST(추상 구문 트리)를 만들고, `Promise`와 `await`의 관계를 분석해 실행 흐름을 정적인 그래프로 추론했습니다.

## 병렬 실행의 높이를 정하는 starts와 resolves {#execution-order}

그림에는 무엇이 나란히 실행되고 어디서 기다리는지가 드러나야 합니다. 다이어그램을 생성할 때 `await`와 `Promise.all()`이 없는 워크플로는 단계가 나타난 순서대로 실행된다고 가정합니다. `await`, `Promise`, `Promise.all()`이 등장하면 그 관계를 추적해야 하므로, 노드에 `starts`와 `resolves` 필드를 두었습니다.

두 필드는 시작과 종료의 상대적인 순서를 나타내는 인덱스입니다. 기준은 시작한 뒤 곧바로 종료되지 않은 첫 Promise입니다. 파서가 `await`하지 않은 `Promise`나 `Promise.all()`을 만나면 노드에 진입 번호를 매겨 `starts`에 기록합니다. 해당 Promise를 기다리는 `await`를 만나면 번호를 하나 올려 종료 번호인 `resolves`에 저장합니다.

이 번호가 그림의 높이를 결정합니다. `starts:1`인 단계는 같은 줄에 놓입니다. 단계를 선언할 때마다 바로 `await`하는 순차 흐름에서는 두 필드를 정의하지 않고, 런타임에 나타나는 순서를 따릅니다.

원문의 예제에서는 `task a`와 `task b`를 기다리지 않고 시작한 뒤, `task c`에서 이벤트를 기다립니다. 셋 모두 `starts:1`입니다. `task c`에 `resolves:2`가 붙고, 그 대기가 끝난 뒤 실행하는 `task d`에는 `starts:2`, `resolves:3`이 붙습니다. 코드에서 떨어져 있는 Promise 생성과 대기 지점을 연결해야, 병렬로 시작한 단계와 대기 뒤에 이어지는 단계를 그림에서도 구분할 수 있습니다.

## 번들러마다 달라진 JavaScript를 읽는 Rust Worker {#parsing}

이 관계를 찾으려면 먼저 배포된 코드를 읽어야 합니다. 분석 대상은 개발자가 작성한 TypeScript를 번들하고 압축한 JavaScript입니다. Workers 배포를 담당하는 내부 구성 서비스는 기본적으로 esbuild를 쓰며, 별도 지정이 없으면 코드를 압축합니다. Cloudflare는 이 처리가 끝난 스크립트를 가져옵니다. 배포 시점에 가져오기 때문에 실행 중 만난 단계에 한정하지 않고 워크플로 전체를 파싱할 수 있습니다.

압축된 코드는 번들러마다 다른 모습으로 복잡해집니다. 요약·정확성 검토·명료성 검토 에이전트를 병렬로 실행하는 같은 워크플로도, rspack으로 번들하면 긴 한 줄에 빽빽하게 들어가고 vite로 번들하면 또 다른 형태가 됩니다. 이런 코드를 빠르고 정확하게 처리하기 위해 JavaScript Oxidation Compiler(OXC)의 `oxc-parser`를 선택했습니다.

처음에는 Rust 컨테이너로 가능성을 검증했습니다. 스크립트 ID를 Cloudflare Queue에 넣고, 메시지를 꺼내 컨테이너로 보내 처리하는 방식입니다. 동작을 확인한 뒤 Rust로 작성한 Worker로 옮겼습니다. Workers는 WebAssembly로 Rust를 실행할 수 있었고, 패키지도 충분히 작아 이전이 수월했습니다.

Rust Worker는 압축된 JavaScript를 AST 노드로 바꾸고, 이를 미리 정의한 워크플로 노드에 대응시킵니다. 내부 서비스는 모든 WorkflowEntrypoint와 단계 호출이 담긴 중간 그래프를 만들고 순회합니다. 최종 그래프는 API 응답으로 제공하며, 대시보드는 이 결과를 렌더링합니다.

## 함수 안팎에서 이어지는 단계 호출 {#rendering}

AST를 얻었다고 그림이 완성되지는 않습니다. 엔진에는 단계 정보만 있지만, 코드에서는 함수가 단계를 감싸기도 하고 단계 안에 함수를 정의하기도 합니다. 다른 모듈의 단계를 호출하거나 이름을 바꾸는 경우도 있습니다. 단계 이름만 모아서는 이런 연결을 따라갈 수 없어 함수 이름도 함께 수집했습니다.

예를 들어 `functionA` 안에 `console.log(await functionB(), await functionC())`가 있고, `functionB`만 `step.do()`를 호출한다고 해 보겠습니다. 그림에는 `functionA`와 `functionB`가 필요합니다. 단계와 관계없는 `functionC`는 빠져야 합니다.

이를 구분하려고 함수마다 서브그래프를 만듭니다. 함수가 직접 단계를 호출하는지, 또는 단계를 호출할 수 있는 다른 함수로 이어지는지 확인하고, 관련 노드를 함수 노드 안에 담습니다. 직접 호출도 간접 호출도 없는 리프 함수 노드는 최종 출력에서 제거합니다. 한 스크립트에 워크플로가 여럿이면 같은 방식을 한 단계 위에 적용합니다.

함수 호출 외에도 처리할 형태가 많습니다. 반복만 해도 `for...of`, `while`, `map`, `forEach`가 있고, 분기에는 `switch`, `if/else`, 삼항 연산자, nullish coalescing, `try/catch/finally`가 쓰입니다. 정적으로 나열한 단계 목록에서 흐름을 추론하는 경우도 확인하며, 변수 정의는 최대 열 가지 형태를 다룹니다. 모범 사례를 따르지 않는 코드와 엣지 케이스까지 고려하면서도 API는 간결하게 유지하려 했습니다.

그래프를 표현하는 노드 타입은 `StepSleep`, `StepDo`, `StepWaitForEvent`, `StepSleepUntil`, `LoopNode`, `ParallelNode`, `TryNode`, `BlockNode`, `IfNode`, `SwitchNode`, `StartNode`, `FunctionCall`, `FunctionDef`, `BreakNode`로 정했습니다. API 응답에는 함수 호출이나 분기, 병렬 관계뿐 아니라 단계의 설정도 담깁니다. 예를 들어 `loop > maxLoops` 조건에서 실행하는 `step.do` 노드에는 재시도 한도 5회, 지수 백오프, 타임아웃 10,000이 함께 들어갑니다. `step.do`와 `waitForEvent`를 담은 병렬 노드의 예시에서는 각 단계의 `starts`와 `resolves`도 확인할 수 있습니다.

## 실시간 실행 추적을 목표로 한 디버깅 도구 {#next}

다이어그램은 아직 베타 단계입니다. 대다수 워크플로를 정확하게 표현하고 진단에 도움이 되는 그래프를 만들기 위해 계속 개선할 계획입니다.

목표는 종합 디버깅 도구입니다. 그래프 위에서 실행을 실시간으로 추적하고, 오류를 찾고, 사람의 승인을 기다리며, 테스트할 때 단계를 건너뛰는 기능을 지향합니다. 로컬 개발에서 시각화를 제공하는 것도 향후 계획에 포함됩니다. 기능 요청과 버그 제보는 Cloudflare Developers Discord 커뮤니티에서 받습니다.
