---
title: "재배포 없이 실제 데이터를 쓰는 Workers 원격 바인딩"
description: "Cloudflare는 Worker 코드를 로컬에서 실행하면서 배포된 리소스로 테스트할 수 있도록 원격 바인딩을 만들었습니다. 기존 바인딩의 통신 경계와 Cap’n Web을 이용해, 운영용 코드를 바꾸지 않고 로컬 리소스와 원격 리소스를 함께 쓰도록 했습니다."
date: 2026-11-16
weight: 3
---

# 재배포 없이 실제 데이터를 쓰는 Workers 원격 바인딩 (2025-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Connecting to production: the architecture of remote bindings](https://blog.cloudflare.com/connecting-to-production-the-architecture-of-remote-bindings)
- 매체 · 게시일: The Cloudflare Blog · 2025-11-12
- 저자: Samuel Macleod, Dario Piotrowicz
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 실제 데이터 앞에서 다시 찾게 된 원격 모드 {#remote-resource-needs}

테스트 데이터만으로는 부족한 순간이 있습니다. 팀과 리소스를 공유하거나, 실제 데이터에 묶인 버그를 재현하거나, 실제 운영 리소스에서 앱이 제대로 동작하는지 확인하려는 경우입니다. Cloudflare Workers에 완전한 로컬 개발 환경이 생긴 뒤에도 `wrangler dev --remote`가 쓰인 이유입니다.

초기 `wrangler dev`는 원격 모드로 동작했습니다. 코드를 바꿀 때마다 Cloudflare 네트워크에 Worker의 미리보기 버전을 배포하고 연결하는 방식입니다. 수정과 테스트를 반복하는 속도는 느렸고 디버깅 연결도 불안정했습니다. 여러 Worker를 함께 개발하는 시나리오는 지원이 부족했으며, Cloudflare에도 복잡한 구현을 유지보수해야 하는 부담이 있었습니다.

Cloudflare는 이 문제들을 풀기 위해 로컬 개발 환경에 투자했습니다. 2023년 중반 이를 출시해 `wrangler dev`의 기본 동작으로 삼았고, 이후 Wrangler, Cloudflare Vite plugin, `@cloudflare/vitest-pool-workers`, Miniflare의 개발 경험을 꾸준히 개선했습니다.

하지만 로컬 모드에서는 모든 바인딩이 처음에는 비어 있는 로컬 데이터로 리소스를 모사합니다. 테스트 데이터로 앱의 로직을 다듬기에는 좋지만 실제 리소스가 필요한 작업까지 충족하지는 못했습니다. 그렇다고 원격 모드로 돌아가면 그동안 개선된 로컬 개발 환경의 이점을 누릴 수 없었습니다. Cloudflare가 가져오려던 것은 원격 모드 전체가 아닌, 그곳에 남아 있던 원격 리소스 접근 기능입니다.

## Workers 런타임 안에 이미 있던 통신 경계 {#binding-network-boundary}

운영용 Worker 코드는 그대로여야 했습니다. 개발자가 원격 리소스를 쓰려고 코드를 고치는 대신, 기존 바인딩을 호출하는 순간에 원격 데이터를 가져오는 것이 목표입니다. 예를 들어 `const value = await env.KV.get("some-key")`는 로컬에 없는 `some-key`의 값을 네트워크 너머에서 읽어 와야 합니다.

가장 먼저 생각할 만한 방법은 Cloudflare API였습니다. 로컬의 `env`를 API 호출용 대체 객체로 바꾸면 `env.KV.put()`도 원격 KV에 값을 저장하는 API 요청으로 변환할 수 있습니다. KV, R2, D1처럼 성숙한 HTTP API가 있는 바인딩에는 잘 맞는 접근입니다.

문제는 구현하고 유지해야 할 범위였습니다. 바인딩 API 전체를 복제하고 가능한 모든 연산을 대응하는 API 호출로 바꿔야 합니다. 애초에 대응하는 API 호출이 없는 연산도 있어, 이 방식으로는 지원할 수 없는 기능이 남습니다.

필요한 API는 이미 운영 환경 안에 있었습니다. Workers 플랫폼의 바인딩 대부분은 두 Worker가 HTTP 또는 JSRPC로 통신하도록 연결하는 service binding에 기반합니다. KV의 JavaScript API도 Workers 런타임에 구현돼 있으며, 런타임은 `env.KV.get()`을 KV 서비스를 구현한 플랫폼 Worker로 보내는 HTTP 요청으로 바꿉니다.

Cloudflare는 그 사이의 비동기 네트워크 경계를 재사용했습니다. 로컬 런타임인 `workerd`가 바인딩 호출을 HTTP 요청으로 변환해 보내면, 운영 런타임의 변환 단계를 거치지 않고 원격 KV 서비스에 접근할 수 있습니다. 바인딩 API를 새로 복제하는 대신 이미 쓰던 통신 방식을 로컬 개발에 연결한 것입니다.

## 로컬 KV와 원격 KV_2를 함께 쓰는 프록시 {#per-binding-selection}

정식 출시된 remote bindings는 이 경계를 이용해 로컬 Worker와 Cloudflare 계정에 배포된 리소스를 연결합니다. Worker 코드는 자신의 컴퓨터에서 실행하면서 실제 R2 버킷이나 D1 데이터베이스로 테스트하는 방식입니다. 코드를 고칠 때마다 배포할 필요도 없습니다.

설정은 바인딩마다 고릅니다. Wrangler v4.37.0부터 개별 바인딩에 `remote: true`를 지정하면 해당 바인딩이 원격 리소스를 사용합니다. 원문의 설정 예시에서는 `KV`와 `R2`를 로컬에 두고 `KV_2`만 원격에 연결합니다. 별도의 API 키나 자격 증명을 복잡하게 관리할 필요 없이, Wrangler가 Cloudflare API에 연결할 때 쓰는 기존 OAuth 연결을 그대로 사용합니다.

요청을 처리하는 경로도 바인딩마다 달라집니다. 원격으로 지정한 바인딩은 로컬 리소스 모사 대신 remote proxy client가 처리하고, 이 클라이언트는 실제 리소스에 연결된 remote proxy server와 통신합니다. 원격 바인딩들의 클라이언트는 모두 같은 서버에 연결됩니다. 그래서 하나의 Worker 안에서도 일부 바인딩은 로컬 모사를 사용하고, 나머지는 배포된 리소스에 접근하도록 구성할 수 있습니다.

## JSRPC 바인딩까지 연결하는 Cap’n Web {#jsrpc-with-capn-web}

먼저 길을 낸 바인딩도 있었습니다. AI 바인딩은 처음부터 원격 리소스에 연결했습니다. Workers AI의 여러 모델을 모두 로컬에서 지원하려면 시작부터 대규모 모델을 다운로드해야 하므로, 완전한 로컬 실행은 현실적이지 않았습니다. 이후 Images와 Hyperdrive에도 비슷한 요구가 생기면서 제품별 해결책을 이어 붙인 상태가 됐고, Cloudflare는 이를 바인딩 유형 전반에 쓰는 하나의 원격 연결 방식으로 통합했습니다.

지원 범위를 넓히려면 HTTP 경계만으로는 부족했습니다. KV와 R2는 HTTP로 연결되지만 최신 바인딩은 JSRPC를 사용합니다. 이 바인딩들을 지원하려면 로컬 `workerd`가 운영 런타임 인스턴스와 JSRPC로 통신해야 했습니다.

마침 이를 가능하게 하는 프로젝트가 별도로 진행 중이었습니다. Cloudflare는 그 결과인 Cap’n Web을 통합해 로컬 `workerd`와 원격 런타임이 WebSocket 위에서 통신하도록 만들었습니다. 이 연결로 Images 같은 최신 바인딩뿐 아니라 개발자 자신의 Worker로 향하는 JSRPC service binding도 사용할 수 있게 됐습니다.

## Vite와 Vitest로 이어지는 Wrangler의 연결 기능 {#tooling-and-availability}

원격 바인딩을 쓰기 위해 개발 도구를 `wrangler dev`로 한정할 이유는 없었습니다. Cloudflare는 Cloudflare Vite plugin과 `vitest-pool-workers`에서도 이 기능을 지원하고, 다른 JavaScript 도구에서도 사용할 수 있도록 연결 기능을 공개했습니다.

Wrangler 패키지가 내보내는 `startRemoteProxySession`이 그 예입니다. 도구 개발자는 이런 유틸리티를 사용해 `wrangler dev`를 실행하지 않는 개발 흐름에도 원격 바인딩을 지원할 수 있습니다.

{{% details title="도구별 지원 버전과 설정" closed="true" %}}
| 항목 | 값 |
|---|---|
| 완전한 로컬 개발 환경 출시 | 2023년 중반, 이후 `wrangler dev`의 기본 경험으로 제공 |
| Wrangler 지원 시작 버전 | v4.37.0 |
| `@cloudflare/vite-plugin` 지원 시작 버전 | v1.13.0 |
| `@cloudflare/vitest-pool-workers` 지원 시작 버전 | v0.9.0 |
| 원격 연결 설정 | Wrangler 설정의 개별 바인딩에 `remote: true` 지정 |
| 원문 설정 예시의 리소스 조합 | 로컬 `KV`·`R2`, 원격 `KV_2` |
| 외부 도구용 유틸리티 예시 | `startRemoteProxySession` |
{{% /details %}}
