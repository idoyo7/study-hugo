---
title: "중간 단계까지 들여다보는 Workflows의 격리 테스트"
description: "Workflows의 중간 단계를 검증하면서 테스트 간 상태 누출도 막으려면 무엇을 바꿔야 할까요? Cloudflare는 로컬 테스트 API로 단계 결과와 이벤트를 제어하고, 테스트가 끝나면 자원을 해제해 저장소 격리를 보장했습니다."
date: 2026-11-16
weight: 4
---

# 중간 단계까지 들여다보는 Workflows의 격리 테스트 (2025-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Building a better testing experience for Workflows, our durable execution engine for multi-step applications](https://blog.cloudflare.com/better-testing-for-workflows)
- 매체 · 게시일: The Cloudflare Blog · 2025-11-04
- 저자: Olga Silva, Mia Malden
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 완료 상태 뒤에 가려진 Workflows의 중간 단계 {#black-box-testing}

Workflows 테스트에서는 인스턴스가 완료됐는지 기다려 확인할 수 있었습니다. 결제 단계가 성공했는지, 확인 이메일 단계에 올바른 데이터가 전달됐는지는 알 수 없었습니다. 답을 찾으려면 외부 시스템이나 로그를 뒤져야 했습니다.

Cloudflare Workflows는 장애가 발생해도 실행을 이어가는 장기 다단계 애플리케이션용 서버리스 엔진입니다. 개발자가 비즈니스 로직에 집중하도록 상태 저장과 재시도, 긴 대기를 맡아 처리합니다. 복잡한 흐름을 맡길 수 있었지만, 그 흐름을 검증하는 테스트는 블랙박스에 머물러 있었습니다.

불편은 Workflow 안에서 끝나지 않았습니다. 프로젝트에 Workflow를 추가하기만 해도 `vitest-pool-workers`의 isolated storage를 꺼야 했습니다. 이 격리 저장소는 각 테스트가 다른 테스트의 부작용 없이 깨끗한 환경에서 실행되도록 보장하는 기능입니다. 당시에는 Workflows의 테스트 간 격리를 보장할 수 없어, Workflow를 직접 테스트하지 않는 경우에도 예외가 없었습니다.

격리 저장소를 끄면 상태가 다른 테스트로 새어 나가 간헐적이고 원인을 찾기 어려운 실패를 일으킬 수 있었습니다. Workers, Durable Objects, R2와 Workflows를 함께 쓰는 개발자는 프로젝트 전체의 격리 테스트를 포기하거나 테스트를 생략해야 했습니다. Workflows를 도입하는 일부터 부담이 되는 제약이었습니다.

## 승인 이벤트까지 제어하는 댓글 검토 Workflow {#local-testing-apis}

새 테스트 API는 중간 단계의 결과와 이벤트를 테스트 안에서 정할 수 있게 합니다. `@cloudflare/vitest-pool-workers` 0.9.0 이상에서 `cloudflare:test` 모듈로 제공하며, 테스트는 Workers 런타임인 `workerd` 안에서 로컬·오프라인으로 실행됩니다. 네트워크 연결에 기대지 않아 빠르고 저렴하게 실행할 수 있는 방식입니다.

댓글 검토 Workflow를 예로 들어 보겠습니다. 댓글이 들어오면 Workers AI에 검토를 요청하고, 반환된 위반 점수에 따라 운영자의 승인이나 거부를 기다립니다. 승인을 받으면 `step.do`에서 외부 API를 호출해 댓글을 게시합니다. 이 흐름을 시험하려면 AI의 응답뿐 아니라 운영자의 승인 이벤트도 제어해야 합니다.

인스턴스 ID를 미리 정한 단위 테스트에서는 `introspectWorkflowInstance`를 사용합니다. 이 함수가 반환한 introspector의 `modify` 콜백에서 modifier 객체를 받아, `AI content scan` 단계의 결과를 `violationScore: 50`으로 모킹합니다. 이어 `moderation-approval` 이벤트에 `{ action: "approved" }`를 넣고, `publish comment` 단계의 결과도 `{ status: "published" }`로 지정합니다. 외부 호출의 결과와 승인 이벤트를 준비한 뒤 Workflow 인스턴스를 생성하는 순서입니다.

검증할 대상도 분명해집니다. `waitForStepResult`로 AI 검사와 게시 단계가 지정한 결과를 반환했는지 확인하고, `waitForStatus("complete")`로 전체 흐름의 완료를 기다립니다. 완료 여부만 보던 테스트에서 각 단계의 결과까지 확인하는 테스트로 바뀐 것입니다.

## 인스턴스 생성 직전에 개입하는 Proxy {#dynamic-instance-ids}

HTTP 요청을 받은 Worker가 임의의 ID로 Workflow를 생성한다면, 테스트에서 그 ID를 미리 지정하기 어렵습니다. 이런 통합 테스트에는 `introspectWorkflow`를 사용합니다. `modifyAll`의 콜백에서 단계 결과와 이벤트를 모킹하거나 대기를 비활성화하면, 생성되는 인스턴스들에 같은 설정을 적용할 수 있습니다.

이를 구현한 장치는 JavaScript `Proxy`입니다. `introspectWorkflow`는 Workflow 바인딩을 Proxy로 감싸 `create()`와 `createBatch()` 호출을 가로챕니다. 호출자가 지정한 ID를 확보하거나 ID가 없으면 생성한 뒤, 그 ID에 대한 introspection을 준비하고 `modifyAll`의 설정을 적용합니다. 원래 생성 메서드는 그다음에 호출합니다. Workflow가 실행되기 전에 테스트 설정을 마치는 순서입니다.

동적 ID 예제에서는 AI 검사 결과를 `violationScore: 0`으로 지정하고 `disableSleeps()`로 대기를 비활성화합니다. Worker에 HTTP 요청을 보낸 뒤 introspector에서 생성된 인스턴스를 조회합니다. 인스턴스가 1개인지, AI 검사 결과가 지정한 값인지, 최종 상태가 `complete`인지 확인하는 테스트입니다.

테스트가 끝난 뒤의 처리도 격리와 직결됩니다. 두 예제 모두 JavaScript의 Explicit Resource Management 문법인 `await using`으로 introspector를 선언합니다. 객체가 스코프를 벗어나면 해제 메서드가 자동으로 호출되며, 이 처리가 각 테스트의 격리 저장소를 보장합니다. `introspectWorkflow`의 introspector가 해제되거나 `dispose()`를 호출하면 Proxy도 제거되어 바인딩이 원래 상태로 돌아갑니다.

## Engine DO에 접근하는 로컬 Workflows 바인딩 {#vitest-engine-connection}

단계 결과와 이벤트를 제어하려면 테스트 코드가 Workflow 실행 엔진에 접근해야 합니다. 로컬에서 `wrangler dev`를 실행할 때 Workflows를 구동하는 것은 Miniflare와 `workerd`입니다. 각 Workflow 인스턴스에는 SQLite Durable Object가 하나씩 연결되며, 이 Engine DO가 단계 실행과 상태 저장, 인스턴스 수명주기를 담당합니다.

Vitest 테스트 러너는 `workerd` 밖의 별도 Node.js 프로세스에서 실행됩니다. 테스트를 `workerd` 안에서 실행하도록 연결하는 것이 `vitest-pool-workers`의 Runner Worker입니다. 이 Worker는 Wrangler 설정에 지정된 바인딩과 `cloudflare:test` API에 접근하고, Runner Object라는 별도 DO를 거쳐 WebSocket/RPC로 Node.js와 통신합니다.

Cloudflare가 처음 검토한 방법은 Runner Worker에 각 Workflow의 Engine DO 네임스페이스도 직접 바인딩하는 것이었습니다. 그러면 Engine DO의 메서드를 바로 호출할 수 있습니다. 접근은 간단해 보였지만, 테스트 기능 하나를 위해 Miniflare와 `vitest-pool-workers`의 중심 구현까지 크게 고쳐야 했습니다.

우선 Miniflare가 기본 사용자 접두사를 붙이면 Engine DO를 찾지 못하므로, 엔진의 서비스 이름을 지정하는 새 `unsafe` 필드가 필요했습니다. 테스트하지 않는 Workflow까지 프로젝트의 모든 Engine DO를 러너에 바인딩해야 한다는 문제도 있었습니다. 이렇게 추가한 바인딩이 사용자 테스트의 `env`에 노출되지 않도록 별도로 정리해야 했습니다.

채택한 방법은 기존 로컬 Workflows 바인딩을 접근점으로 삼는 것이었습니다. 여기에 추가한 `unsafe` 함수는 운영 환경에는 존재하지 않습니다. 테스트 러너가 인스턴스 ID를 전달하면 해당 Engine DO의 스텁을 얻고, `WorkflowInstanceModifier`라는 `RpcTarget`을 이용해 허용된 메서드를 RPC로 호출합니다. ID를 미리 알거나 Proxy에서 확보하면, 그 ID로 해당 인스턴스의 Engine DO를 찾을 수 있습니다.

`RpcTarget`을 상속한 객체는 스텁으로 전달됩니다. 스텁의 메서드를 호출할 때 원래 객체로 RPC가 전달되는 방식입니다. 이 경로를 택하면서 변경 범위를 Workflows 환경 안으로 제한했습니다. Runner Worker에 모든 Engine DO를 바인딩하는 안보다 다른 구성 요소에 미치는 영향이 작고, 이후 기능 변경도 Workflows 안에서 다룰 수 있는 설계입니다.

{{% details title="지원 버전과 예제에 사용한 설정" closed="true" %}}
| 항목 | 값 |
|---|---|
| 최소 지원 버전 | `@cloudflare/vitest-pool-workers` 0.9.0 |
| 알려진 ID 예제의 AI 검사 결과 | `violationScore: 50` |
| 알려진 ID 예제의 승인 이벤트 | `type: "moderation-approval"`, `payload: { action: "approved" }` |
| 알려진 ID 예제의 게시 결과 | `status: "published"` |
| 동적 ID 예제의 AI 검사 결과 | `violationScore: 0` |
| 동적 ID 예제의 대기 설정 | `disableSleeps()` 호출 |
| 동적 ID 예제의 생성 인스턴스 수 검증 | 1개 |
| 예제의 최종 상태 검증 | `waitForStatus("complete")` |
{{% /details %}}
