---
title: "S3와 CloudFront SPA 배포의 캐시 분리와 fallback 범위 제한"
description: "새 배포 뒤 열려 있던 웹뷰에서 chunk load error가 나던 문제를 풀어 간 과정입니다. index.html과 hashed asset의 캐시 분리, route 전용 rewrite, invalidation 범위 축소, 프론트의 1회 reload 방어를 요약합니다."
date: 2026-11-08
weight: 19
---

# S3와 CloudFront SPA 배포의 캐시 분리와 fallback 범위 제한 (2026-06)

{{< callout type="info" >}}
**원문 정보**
- 원문: [S3 + CloudFront 기반 SPA 배포에서 캐시와 fallback 전략 설계하기](https://tech.socar.kr/fe/2026/06/24/spa-cache-fallback-strategy-with-s3-cloudfront)
- 매체 · 게시일: 쏘카 기술 블로그 · 2026-06-24
- 저자: 프레디
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 열려 있던 웹뷰에서 터진 dynamic import 실패 {#문제-상황}

새 프론트 배포 뒤 이미 열려 있던 웹뷰에서 lazy route로 이동하면 React Router의 ErrorBoundary로 빠지는 사례가 있었습니다. 콘솔에는 `Failed to fetch dynamically imported module`이나 `Expected a JavaScript module script but the server responded with a MIME type of "text/html"` 같은 에러가 찍혔습니다. 처음에는 invalidation을 했는데 왜 예전 파일이 보이는지가 의문이었지만, 따라가 보니 서로 다른 층위의 원인이 겹쳐 있었습니다.

## 여러 조건이 이어진 원인 {#원인}

이미 열린 SPA는 구버전 index.html과 구버전 JavaScript, lazy chunk 목록을 메모리에 들고 있습니다. 새 배포가 나가도 이 runtime은 바뀌지 않습니다. Vite는 배포마다 chunk 파일명의 hash를 바꾸므로, 구버전 runtime은 나중에 해당 route로 갈 때 옛 이름의 chunk를 요청합니다.

이 서비스는 배포마다 S3에 release prefix를 만들고 CloudFront의 OriginPath를 최신 prefix로 바꾸는 구조였습니다. 옛 chunk는 최신 prefix 아래에 없으니 S3가 403이나 404를 돌려줍니다. 여기에 deep link 처리용으로 걸어 둔 Custom Error Response가 403을 `/index.html`의 200으로 바꿔 버렸습니다. 실패가 HTML 200으로 위장되어 MIME type 불일치처럼 보인 것입니다. 최초 원인은 이 설정이 아니라 옛 chunk가 사라진 것이었다고 원문은 구분합니다.

`/*` invalidation도 문제를 키울 수 있었습니다. 이는 엣지 캐시만 지울 뿐 브라우저 캐시나 메모리의 runtime은 건드리지 못하고, 오히려 엣지에 남아 구버전 세션을 버티게 해 주던 옛 chunk까지 지웁니다.

## 계층별로 나눈 해결 {#해결-전략}

해결은 한 가지 설정이 아니라 문제를 층마다 나누는 일이었습니다.

- **캐시 헤더**: index.html은 `no-cache, max-age=0, must-revalidate`로 매번 재검증하고, hashed asset은 `public, max-age=31536000, immutable`로 오래 캐시합니다.
- **fallback**: Custom Error Response를 제거하고, viewer request 단계의 CloudFront Function이 확장자 없는 route만 루트 `/index.html`로 rewrite합니다. 없는 asset은 정직하게 403이나 404를 냅니다.
- **behavior**: 기본 behavior는 HTML과 SPA route를, `/assets/*` behavior는 Function 없이 정적 asset만 맡습니다.
- **invalidation**: `/index.html`과 `/`로 좁힙니다.
- **프론트 방어**: chunk load error를 감지하면 최신 index.html을 받도록 한 번만 reload합니다. 같은 signature는 sessionStorage로 1회로 제한하고, 재실패하면 안내 UI와 수동 새로고침 버튼으로 멈춥니다.

공통 배포 action의 기본 S3 업로드는 모든 파일을 한 번에 올려 헤더를 나눌 수 없었습니다. 여러 서비스가 쓰는 action을 고치지 않고, 해당 서비스 workflow에서 `build-upload`를 끈 뒤 `aws s3 cp`로 assets와 index.html을 따로 올렸습니다. 이때 action 안의 AWS credentials 설정도 함께 빠질 수 있어 별도 step으로 다시 지정했습니다. preview 환경의 nginx에도 같은 정책을 location 규칙으로 맞췄습니다.

## 적용 후 확인 결과와 표준화 방향 {#확인과-표준화}

적용 후 `/`, `/index.html`, SPA route는 200 text/html이고, 실제 asset은 200 text/javascript이며, 없는 asset은 403 또는 404였습니다. SPA route 응답 헤더가 `X-Cache: Error from cloudfront`에서 `Miss from cloudfront`로 바뀐 점도 확인했습니다. 웹뷰별로는 Android WebView에서 자동 reload로 복구됐고, iOS WKWebView에서는 안내 UI가 뜬 뒤 수동 새로고침으로 복구되는 경우가 있었습니다. 원문은 이를 두 가지 실패가 아니라 같은 방어 설계의 두 경로로 봅니다.

원문은 이 문제가 특정 프레임워크가 아니라 정적 SPA 배포 구조 전반의 문제라고 보고, 배포 산출물, S3 metadata, CDN fallback, invalidation, 프론트 런타임 방어, 검증을 항목으로 한 공통 표준화를 후속 방향으로 제안합니다. Webpack, Vue Router, Angular Router에서 chunk 실패를 잡는 지점도 함께 정리했는데, 번들러 전용 이벤트는 어댑터로 두고 판별과 1회 reload 정책은 프레임워크와 무관한 로직으로 두자는 원칙입니다.

{{% details title="경로별 캐시·응답 정책 근거 표" closed="true" %}}

| 대상 | Cache-Control | 기대 응답 |
|---|---|---|
| `/index.html` | `no-cache, max-age=0, must-revalidate` (Content-Type `text/html`) | 200 text/html |
| `/assets/*` | `public, max-age=31536000, immutable` | 200, 없는 파일은 403 또는 404 |
| 기타 루트 정적 파일 | `no-cache, max-age=0, must-revalidate` | 200 |
| SPA route (`/reports` 등) | 해당 없음(rewrite) | 200 text/html |
| CloudFront invalidation | `/index.html`, `/` 만 | `/*` 사용 금지 |

{{% /details %}}
