---
title: "AST로 Workflows 코드를 시각 다이어그램으로 바꾸는 방법"
description: "Cloudflare Workflows는 코드로 짠 워크플로라 정적 선언이 없는데, 배포 시점에 번들된 스크립트를 AST로 파싱해 단계 간 관계를 그래프로 뽑아냅니다. 압축된 JS를 oxc-parser와 Rust Worker로 처리한 방식과 노드 타입 설계를 요약합니다."
date: 2026-11-14
weight: 6
---

# AST로 Workflows 코드를 시각 다이어그램으로 바꾸는 방법 (2026-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How we use Abstract Syntax Trees (ASTs) to turn Workflows code into visual diagrams](https://blog.cloudflare.com/workflow-diagrams)
- 매체 · 게시일: The Cloudflare Blog · 2026-03-27
- 저자: André Venceslau, Mia Malden
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 배경 {#background}

Cloudflare Workflows는 단계를 이어 붙이고, 실패하면 재시도하고, 오래 걸리는 프로세스 전반에서 상태를 유지하는 durable execution 엔진입니다. 백그라운드 에이전트, 데이터 파이프라인, 사람이 승인하는 흐름 등에 쓰입니다. 원문이 쓰인 시점의 지난달 Cloudflare는 배포된 모든 워크플로에 대시보드에서 볼 수 있는 완전한 시각 다이어그램이 붙는다고 발표했습니다.

원문은 코딩 에이전트가 사람이 읽지 않을 수도 있는 코드를 쓰는 시대일수록 단계가 어떻게 이어지고 어디서 갈라지는지 보는 일이 중요하다고 봅니다. 시각적 워크플로 빌더의 다이어그램은 보통 JSON, YAML, 드래그 앤 드롭 같은 선언형 정의에서 나옵니다. Workflows는 그냥 코드라 Promise, `Promise.all`, 루프, 조건문이 들어가고 함수나 클래스 안에 중첩될 수도 있어 다이어그램 렌더링이 까다롭습니다. 해법은 AST로 그래프를 정적으로 뽑아내며 `Promise`와 `await` 관계를 추적해 무엇이 병렬로 돌고 무엇이 막히는지 파악하는 것입니다.

## 동적 실행 모델 {#dynamic-execution}

워크플로 엔진은 동적 실행 순서와 순차(정적) 실행 순서 중 하나를 따릅니다. Cloudflare Workflows는 동적 모델입니다. 워크플로가 코드이므로 런타임이 단계를 만나는 순간 그 단계가 엔진에 넘어가 관리됩니다. await하지 않은 단계는 병렬로 실행됩니다. 그래서 별도 래퍼나 지시어 없이 흐름 제어 그대로 코드를 쓸 수 있습니다. 실행 과정은 다음과 같습니다.

- 인스턴스의 "감독자" Durable Object인 엔진이 뜹니다. 엔진이 실제 워크플로 실행 로직을 맡습니다.
- 엔진이 동적 디스패치로 사용자 Worker를 호출해 Workers 런타임에 제어를 넘깁니다.
- 런타임이 `step.do`를 만나면 실행을 엔진에 돌려줍니다.
- 엔진이 단계를 실행하고 결과를 저장하거나(필요하면 오류를 던지고) 다시 사용자 Worker를 호출합니다.

이 구조에서 엔진은 단계의 순서를 본래 알지 못하지만, 다이어그램에는 순서가 핵심 정보입니다. 대다수 워크플로를 정확히, 디버깅에 도움이 되는 그래프로 옮기는 것이 과제입니다. 다이어그램은 베타 단계라 계속 개선할 계획입니다.

## 코드 파싱 {#parsing}

실행 시점이 아니라 배포 시점에 스크립트를 가져오면 워크플로 전체를 파싱해 다이어그램을 정적으로 만들 수 있습니다. Workers 배포를 맡은 내부 구성 서비스가 코드를 번들하고 별도 지정이 없으면 minify한 뒤에 스크립트를 가져옵니다. 이 서비스가 기본으로 쓰는 번들러는 esbuild입니다. 그다음 파서로 워크플로의 AST를 만들고, 내부 서비스가 모든 WorkflowEntrypoint와 워크플로 단계 호출이 담긴 중간 그래프를 생성·순회하며, 최종 결과를 API에서 렌더링합니다.

minify된 JavaScript는 TypeScript로 쓴 직관적인 패턴과 달리 빽빽해서 읽기 어렵고 번들러마다 형태도 다릅니다. 원문은 같은 워크플로를 rspack으로 번들한 코드와 vite로 번들한 코드를 예로 들어, 압축된 코드가 번들러에 따라 서로 다른 방향으로 알아보기 어려워진다고 보여 줍니다. 다양한 형태를 빠르고 정확하게 파싱하려고 JavaScript Oxidation Compiler(OXC)의 `oxc-parser`를 골랐습니다. 먼저 Rust를 돌리는 컨테이너로 방식을 검증했는데, 스크립트 ID를 Cloudflare Queue에 보내고 메시지를 꺼내 컨테이너가 처리하는 구조였습니다. 방식이 통하는 것을 확인한 뒤 Rust로 쓴 Worker로 옮겼고, Workers가 WebAssembly로 Rust를 돌릴 수 있고 패키지가 충분히 작아 수월했습니다. Rust Worker는 minify된 JS를 AST 노드 타입으로 바꾼 뒤, 노드 타입을 대시보드에 렌더링되는 워크플로의 그래프 표현으로 바꿉니다.

## 다이어그램 렌더링 {#rendering}

렌더링의 과제는 단계와 함수의 관계를 정확히 추적하는 것, 그리고 노드 타입을 가능한 한 단순하게 정의하면서 전체 표면을 덮는 것입니다. 엔진은 단계 정보만 알고, 단계가 함수에 의존하거나 그 반대일 수 있으며, 단계를 함수로 감싸거나 다른 모듈의 단계를 부르거나 이름을 바꿀 수도 있습니다. 예를 들어 `functionA`가 `console.log(await functionB(), await functionC())`를 호출하고 `functionB`만 `step.do()`를 부른다면 `functionA`와 `functionB`는 다이어그램에 들어가야 하지만 `functionC`는 빠져야 합니다. 이를 위해 함수마다 서브그래프를 만들고, 단계 호출을 직접 갖는지 아니면 단계를 부를 수 있는 다른 함수를 호출하는지 확인합니다. 서브그래프는 관련 노드를 담은 함수 노드로 표현되고, 직간접 워크플로 단계가 없는 리프 함수 노드는 최종 출력에서 잘라냅니다. 정적 단계 목록이나 변수가 최대 열 가지 방식으로 정의되는 경우도 확인하고, 스크립트에 워크플로가 여럿이면 함수 서브그래프와 같은 방식을 한 단계 위에서 적용합니다.

AST 노드 타입마다 워크플로 안에서 쓰일 수 있는 모든 방식을 고려해야 했고, 루프(`for...of`, `while`, `map`, `forEach`)와 분기(`switch`, `if/else`, 삼항 연산자, nullish coalescing, `try/catch/finally`)만 해도 경우의 수가 많습니다. 모범 사례를 따르든 아니든 모든 패턴과 엣지 케이스를 처리해야 했습니다.

단계는 기본적으로 서로 순차적이지 않습니다. `await`, `Promise`, `Promise.all()`을 쓰지 않은 워크플로는 단계가 마주친 순서대로 실행된다고 가정합니다. 그런 구문이 있으면 관계를 추적해야 하므로 각 노드에 `starts:`와 `resolves:` 필드를 두어 실행 순서를 추적합니다. 이 인덱스는 Promise가 시작하고 끝나는 시점을, 즉시 이어지는 종료 없이 시작된 첫 Promise를 기준으로 나타내며, 다이어그램 UI의 세로 위치에 대응합니다. `starts:1`인 단계는 같은 줄에 놓입니다. 선언과 동시에 await하는 단계는 두 값이 정의되지 않고 런타임에 나타나는 순서대로 실행됩니다. await하지 않은 `Promise`나 `Promise.all()`을 파서가 만나면 해당 노드에 진입 번호를 매겨 `starts`에 표시하고, 그 Promise를 await하는 곳을 만나면 번호를 하나 올려 종료 번호(`resolves`)로 저장합니다. 이렇게 어떤 Promise가 동시에 돌고 서로 비교해 언제 끝나는지 압니다.

결정한 노드 타입은 StepSleep, StepDo, StepWaitForEvent, StepSleepUntil, LoopNode, ParallelNode, TryNode, BlockNode, IfNode, SwitchNode, StartNode, FunctionCall, FunctionDef, BreakNode입니다. 원문은 `function` 호출, `if` 조건이 `step.do`로 갈라지는 경우(예: 조건 `loop > maxLoops`에서 재시도 5회·지수 백오프·타임아웃 10,000이 설정된 단계), `step.do`와 `waitForEvent`가 병렬인 경우의 API 출력 예시를 보여 줍니다.

## 다음 계획 {#next}

원문은 Workflow 다이어그램의 목표를 종합 디버깅 도구로 둡니다. 그래프를 따라 실행을 실시간으로 추적하고, 오류를 찾고, 사람 승인을 기다리고, 테스트용으로 단계를 건너뛰는 것, 그리고 로컬 개발에서 시각화를 쓰는 것이 앞으로 가능하게 하려는 일입니다. 피드백은 Cloudflare Developers Discord 커뮤니티로 받습니다.
