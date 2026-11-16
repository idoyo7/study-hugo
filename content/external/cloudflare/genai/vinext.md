---
title: "Next.js API와 Vite 사이를 AI로 채운 vinext"
description: "Next.js 앱을 다른 런타임에서 개발하고 배포하려면 어디부터 바꿔야 할까요? Cloudflare는 빌드 결과물을 변환하던 방식에서 벗어나, AI와 Vite로 Next.js API를 재구현한 vinext를 만들었습니다."
date: 2026-11-16
weight: 14
---

# Next.js API와 Vite 사이를 AI로 채운 vinext (2026-02)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How we rebuilt Next.js with AI in one week](https://blog.cloudflare.com/vinext)
- 매체 · 게시일: The Cloudflare Blog · 2026-02-24
- 저자: Steve Faulkner
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

엔지니어 한 명이 AI를 지휘해 일주일도 안 돼 Next.js API를 Vite 위에 재구현했습니다. Claude API 토큰 비용 약 1,100달러로 만든 vinext입니다. Cloudflare도 처음에는 성공하리라 생각하지 않았던 시도는, Next.js를 다른 서버리스 플랫폼에 배포할 때 겪던 문제에서 출발했습니다.

## Next.js 빌드 결과물을 뒤쫓던 OpenNext {#nextjs-deployment-limits}

Next.js 앱을 Cloudflare, Netlify, AWS Lambda에서 실행하려면 전용 빌드 도구가 내놓은 결과물을 각 플랫폼에 맞게 가공해야 합니다. OpenNext가 해 온 일입니다. 하지만 Next.js의 빌드 결과물을 역공학하는 방식은 불안정했습니다. 버전 사이에 생기는 예측하기 어려운 변경을 계속 따라잡는 작업은 두더지 잡기와 닮았습니다.

Cloudflare는 Next.js의 공식 adapters API 개발에도 협력하고 있습니다. 아직 초기 단계인 이 API가 다루는 범위는 빌드와 배포까지이며, 기반 도구는 여전히 Turbopack입니다. 개발 환경의 제약도 남습니다. `next dev`는 Node.js에서만 실행되므로 Durable Objects, KV, AI bindings 같은 플랫폼 API를 개발 중에 시험하려면 우회 방법이 필요합니다.

vinext는 이 문제를 다른 출발점에서 풀었습니다. Next.js가 만든 결과물을 변환하는 대신, Next.js의 API 자체를 Vite 플러그인으로 새로 구현했습니다. 라우팅과 서버 렌더링(SSR), React Server Components(RSC), server actions, 캐싱, middleware가 그 대상입니다. 기존 `app/`, `pages/`, `next.config.js`를 유지하면서 스크립트의 `next`를 `vinext`로 바꾸는 사용 방식입니다.

## 개발 서버에서도 앱을 실행하는 workerd {#vite-api-reimplementation}

첫 배포 대상은 Cloudflare Workers입니다. `vinext deploy` 한 번으로 앱을 빌드하고 Worker 설정을 생성한 뒤 배포까지 처리합니다. App Router와 Pages Router 모두 클라이언트 hydration, 상호작용 컴포넌트, 클라이언트 탐색, React state를 지원합니다.

달라진 것은 배포 명령만이 아닙니다. 개발할 때도 배포한 뒤에도 앱 전체가 workerd에서 실행되므로 Cloudflare 서비스를 우회 코드 없이 사용할 수 있습니다. Cloudflare Agents를 넣은 Next.js 앱도 `getPlatformProxy` 같은 우회 방법 없이 동작하는 예시로 공개했습니다.

캐시는 교체 가능한 handler로 분리했습니다. 기본으로 제공하는 Cloudflare KV handler는 첫 요청 뒤 페이지를 캐시하고 백그라운드에서 재검증하는 ISR을 지원합니다. KV는 대부분의 앱에 적합한 기본 선택이지만, 캐시 데이터가 크거나 접근 패턴이 다르면 R2가 더 나을 수 있습니다. 설정 부담을 줄이기 위한 Cache API 개선도 진행 중입니다.

Workers를 첫 대상으로 삼았어도 코드 약 95%는 순수 Vite입니다. 라우팅, module shim, SSR 파이프라인, RSC 통합은 Cloudflare 전용 코드가 아니며, Vite Environment API가 빌드 결과물을 다른 플랫폼에서도 실행할 수 있게 합니다. Vercel에서는 30분 미만에 개념 검증을 마쳤습니다. 다른 호스팅 사업자와 함께 이 도구를 발전시키는 일은 앞으로 이어 갈 과제입니다.

## 33개 경로에서 측정한 빌드 시간 {#early-performance-results}

초기 비교에서 Vite 8 / Rolldown 기반 vinext의 평균 빌드 시간은 1.67초였습니다. Next.js 16.1.6과 Turbopack의 7.38초보다 4.4배 빠른 결과입니다. gzip 압축 클라이언트 번들도 168.9 KB에서 72.9 KB로 줄어 57% 작았습니다.

무엇을 측정했는지가 중요합니다. 시험 대상은 공통으로 사용한 33개 경로의 App Router 앱 하나였습니다. 컴파일과 번들링 속도를 비교하려고 Next.js 빌드의 TypeScript 타입 검사와 ESLint를 끄고, `force-dynamic`으로 정적 사전 렌더링을 제외했습니다. production에서 요청을 얼마나 빨리 처리하는지 측정한 결과는 아닙니다. 앱 하나의 수치이므로 전체 애플리케이션의 성능을 대표하지도 않습니다.

실제 운영 사례는 있습니다. National Design Studio의 beta 사이트 CIO.gov는 이미 vinext를 production에서 사용하며 빌드 시간과 번들 크기 개선을 보고했습니다. 구체적인 개선 수치는 공개하지 않았습니다.

vinext는 실험 단계이며, 의미 있는 규모의 트래픽 검증은 아직 남아 있습니다. Next.js App Router Playground로 동작을 확인했지만 Next.js 16 API 지원 범위는 94%입니다. README에는 미지원 기능뿐 아니라 지원하지 않을 기능과 알려진 제약도 명시합니다. 초기 벤치마크는 가능성을 보여주지만, 그 수치와 현재 지원 범위는 함께 읽어야 합니다.

## 자주 찾는 페이지부터 렌더링하는 TPR {#traffic-aware-prerendering}

ISR은 지원하지만 빌드 시점에 정적 HTML을 미리 만드는 기능은 아직 없습니다. 출시 때 의도적으로 미뤘으며 향후 계획에 포함돼 있습니다. 사이트 전체가 미리 생성한 정적 HTML이라면 현재 vinext의 이점은 크지 않을 수 있습니다.

그렇다고 모든 페이지를 빌드할 때 만드는 방식이 늘 효율적인 것도 아닙니다. Next.js에서 상품 페이지 10,000개를 `generateStaticParams()`에 나열하면 빌드 시 10,000개를 모두 렌더링합니다. 실제로는 그중 99%가 요청 한 번 받지 못할 수도 있습니다. 페이지 수에 따라 빌드 시간도 선형으로 늘어납니다.

Cloudflare는 이미 사이트의 리버스 프록시로서 방문 데이터를 갖고 있다는 점을 활용했습니다. 실험 기능인 Traffic-aware Pre-Rendering(TPR)은 배포할 때 Cloudflare zone analytics를 조회해 방문이 몰린 페이지를 골라 사전 렌더링하고 KV에 저장합니다. 나머지는 요청이 왔을 때 SSR로 처리한 뒤 ISR로 캐시합니다.

대상은 배포마다 다시 고릅니다. 최근 트래픽을 반영하므로 갑자기 인기를 얻은 페이지도 이후 배포에서 포함됩니다. `generateStaticParams()`를 작성하거나 빌드를 production 데이터베이스에 연결할 필요도 없습니다. TPR을 기본 동작으로 만드는 일은 실사용 검증을 더 거친 뒤의 계획입니다.

## AI가 만든 코드를 대조한 Next.js 테스트 {#ai-specification-and-validation}

Cloudflare도 과거에 Next.js 재구현을 시도한 적이 있습니다. 이번 시도를 가능하게 한 조건에는 풍부한 API 문서와 방대한 테스트가 있었습니다. Next.js 테스트와 OpenNext의 Cloudflare 적합성 테스트를 직접 이식해, 새 구현이 기존 동작과 맞는지 기계적으로 대조할 수 있었습니다.

기반 도구도 준비돼 있었습니다. Vite가 HMR, native ESM, 플러그인 API, 번들링을 맡으므로 번들러부터 만들 필요가 없었습니다. Vite가 Next.js의 말을 알아듣게 하는 작업이었습니다. 초기 단계의 `@vitejs/plugin-rsc`는 RSC를 처음부터 구현하는 부담을 줄였고, 새로운 모델은 큰 코드베이스의 아키텍처와 모듈 사이 관계를 다룰 수 있었습니다. Faulkner는 문서와 테스트, 기반 도구, 모델 중 하나라도 빠졌다면 이 방식이 지금처럼 잘 통하지 않았을 것으로 봅니다.

개발은 계획부터 시작했습니다. OpenCode에서 Claude와 몇 시간 동안 아키텍처, 구현 순서, 사용할 추상화를 정했습니다. 이후에는 작업을 정의하고 AI가 구현과 테스트를 작성하게 한 뒤 테스트를 실행했습니다. 통과하면 병합하고, 실패하면 오류 출력을 전달해 수정을 반복했습니다.

거의 모든 코드를 AI가 썼지만 PR마다 테스트, tsgo를 사용한 TypeScript 타입 검사, oxlint 검사를 실행했습니다. PR 검토 에이전트와 검토 의견을 처리하는 별도 에이전트도 연결해 피드백 과정을 대부분 자동화했습니다.

그래도 틀린 PR은 나왔습니다. AI가 자신 있게 작성한 코드가 그럴듯해 보여도 실제 Next.js 동작과 어긋나는 경우가 있었습니다. 아키텍처와 우선순위를 결정하고 막다른 접근에서 방향을 돌리는 일은 사람이 맡았습니다. agent-browser로 실제 렌더링 결과와 클라이언트 탐색, hydration을 확인하면서 단위 테스트가 놓친 미묘한 브라우저 문제도 발견했습니다. 첫 주 후반은 이런 예외 상황을 고치고 테스트와 API 지원 범위를 넓히는 데 썼습니다.

Faulkner는 이 경험을 바탕으로, 사람이 복잡성을 다루려고 쌓아 온 중간 계층 가운데 무엇이 계속 필요한지 되묻습니다. API 계약과 기반 도구 사이를 AI가 구현하는 방식은 더 널리 반복될 것으로 예상합니다. 어떤 추상화가 기반으로 남고 어떤 추상화가 사라질지는 아직 분명하지 않다는 판단입니다.

{{% details title="벤치마크 조건과 구현·검증 수치" closed="true" %}}
| 항목 | 값 |
|---|---|
| 비교 앱과 실행 조건 | 공통 33개 경로 App Router 앱, main 병합마다 GitHub CI 실행 |
| 비교 범위 조정 | Next.js 빌드의 TypeScript 타입 검사와 ESLint 비활성화, `force-dynamic`으로 정적 사전 렌더링 제외 |
| Next.js 기준 | Next.js 16.1.6, Turbopack, 평균 빌드 7.38초, gzip 클라이언트 번들 168.9 KB |
| vinext의 Rollup 결과 | Vite 7 / Rollup, 평균 빌드 4.64초, 기준 대비 1.6배 빠름, 번들 74.0 KB로 56% 작음 |
| vinext의 Rolldown 결과 | Vite 8 / Rolldown, 평균 빌드 1.67초, 기준 대비 4.4배 빠름, 번들 72.9 KB로 57% 작음 |
| 벤치마크 한계 | 단일 앱의 컴파일·번들링 측정, production 요청 처리 성능 측정 제외 |
| 테스트와 검사 도구 | Vitest 테스트 1,700개 초과, Playwright E2E 테스트 380개, tsgo 타입 검사, oxlint |
| API 지원 범위 | Next.js 16 API의 94% |
| 개발 과정 | OpenCode 세션 800회 초과, Claude API 토큰 비용 약 1,100달러 |
| 초기 구현 일정 | 2월 13일 첫 커밋, 당일 두 Router의 기본 SSR 구현, 개발 3일째 Workers 배포와 완전한 클라이언트 hydration |
| 플랫폼 독립성 관련 수치 | 약 95%가 순수 Vite 코드, Vercel 개념 검증에 30분 미만 소요 |
| TPR 실행 옵션 | `vinext deploy --experimental-tpr` |
| 원문의 TPR 실행 예시 | 최근 24시간의 고유 경로 12,847개 중 184개 페이지가 트래픽 90% 차지, 8.3초에 사전 렌더링 후 KV 저장 |
| TPR의 트래픽 분포 설명 | 상품 페이지 10만 개 사이트에서 보통 50~200개 페이지에 트래픽 90%가 집중된다는 설명이며, 해당 실행 예시의 실측값과 구별 |
{{% /details %}}
