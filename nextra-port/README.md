# nextra 이식 대기 디렉토리

**이 디렉토리는 Hugo 빌드에 참여하지 않는다.** `content/` 밖이고 어떤 shortcode 도 여기를 참조하지 않으므로 `hugo` 가 읽지도, `public/` 에 내보내지도 않는다(확인함). 나중에 nextra 로 옮길 때 그대로 집어가기 위한 대기 파일만 둔다.

지금 여기 있는 것을 "왜 지금 만들었나"는 하나다 — **도식의 의미가 Hugo 엔진 안에 갇혀 있으면 이식할 때 다시 읽어야 하고, 다시 읽으면 틀린다.** 그래서 의미만 프레임워크 무의존 모듈로 빼두고, 그게 엔진과 어긋나지 않는지 스크립트로 붙잡아 둔다.

## 먼저 알 것 — 이식은 이미 절반 이상 되어 있다

nextra 쪽(`~/evejuni/nextra-blog`)을 실측한 결과다. **"앞으로 옮겨야 할 일"이 아니라 "이미 오간 것과 아직 안 간 것"이 섞여 있다.**

| 엔진 | nextra 쪽 대응 | 방향 | 상태 |
|---|---|---|---|
| `flow.js` | `docs/app/_components/diagram/Flow.tsx` (763줄) | hugo → nextra | **이식 완료** (2026-08-03). page.mdx 6곳에서 사용 중 |
| `seq.js` | `docs/app/_components/diagram/Seq.tsx` (542줄) | hugo → nextra | **이식 완료.** 단 어느 page.mdx 에서도 아직 사용된 적 0건 |
| `expand.js` | `docs/app/_components/diagram/DiagramFigure.tsx` (244줄) | hugo → nextra | **이식 완료.** "크게 보기" 셸 |
| `cfstl.js` | `CfsTimeline.tsx` (446줄) | **nextra → hugo** | 반대 방향이었다. nextra 가 원본 |
| `bscore.js` · `mnode.js` | `BalancedScore.tsx` (483줄) · `MnodeStages.tsx` (769줄) | 왕복 | nextra `ThrottleGate` 에서 구조만 차용 → hugo 에서 완성 → nextra 로 문자적 재포트 |
| **`rstep.js`** | **없음** | hugo 전용 | **6개 중 유일한 미이식.** 이 디렉토리가 그걸 대비한다 |

그래서 실제로 해야 하는 일이 셋으로 좁혀진다.

1. **`_flow/*.json` · `_seq/*.json` 은 복사만 하면 된다.** `Flow.tsx`·`Seq.tsx` 가 이미 있고 같은 스펙을 먹는다. 프레임워크 무의존 데이터다.
2. **`rstep` 은 새로 만들어야 한다** — `RolloutStep.tsx` 를 여기 준비해 뒀다.
3. **산문·링크·근거 배지는 손으로 옮긴다** (아래 문법 대응표).

## `rollouts/` — Argo Rollouts 3부작

| 파일 | 무엇 | 상태 |
|---|---|---|
| `rstep-frames.mjs` | `rstep` 도식의 **의미만**. 상수·variant 4종·캡션·`computeFrame(variant, phase, t)` 순수 함수. 의존성 0, DOM 접근 0 | Hugo 엔진과 패리티 통과 |
| `RolloutStep.tsx` | 그 모듈을 소비하는 React 컴포넌트 (751줄) | **nextra 빌드에서 컴파일·렌더된 적 없음** |

### 드리프트를 붙잡는 장치

`static/flow/rstep.js` 는 정적 호스팅용이라 번들러 없이 도는 IIFE 다. 그래서 `rstep-frames.mjs` 를 `import` 하지 못하고 **같은 계산을 자기 안에 들고 있다.** 두 곳에 같은 로직이 있으면 드리프트가 난다.

```
node tools/flow-render/port-parity.js
```

엔진을 최소 DOM 스텁 위에서 돌려 **실제로 SVG 에 칠한 값**을 되읽고, 모듈의 프레임과 `variant 4종 × 6단계 × 10시점 × 필드 12종`(240회)을 대조한다. 상수 한 자리만 어긋나도 잡힌다(확인함 — `RPS: 96` 을 `97` 로 바꾸면 20종 불일치로 FAIL).

`./tools/flow-render/run.sh` 에 들어가 있으니 도식을 고칠 때마다 같이 돈다.

**한쪽만 고치고 이 테스트를 느슨하게 만들지 마라.** 그러면 이식 시점에 조용히 다른 그림이 나온다.

### `RolloutStep.tsx` 가 지킨 관례

nextra 쪽 도식·차트 컴포넌트 9종을 실측해 나온 공통 아키텍처를 그대로 따랐다. **framer-motion·d3·recharts 를 쓰지 않는다** — 전부 손으로 짠 rAF + SVG ref 다(framer-motion 은 의존성에 있지만 랜딩 장식에만 쓰인다).

- `'use client'` + `useRef` 로 SVG 자식 노드를 직접 잡는다. `document.createElementNS` 를 쓰지 않는다
- **`setState` 리렌더를 쓰지 않는다.** 매 프레임 `ref.current.setAttribute(...)`
- `useEffect` 에서 `matchMedia('(prefers-reduced-motion: reduce)')` 를 **가장 먼저** 검사해 참이면 마지막 단계 정지 화면만 남기고 종료
- `t0` 는 ref, 초기값 `-1`, `if (t0.current < 0)`. **`if (!t0.current)` 로 쓰면 첫 타임스탬프가 정확히 0 일 때 영영 안 걸린다**
- `IntersectionObserver` `threshold: 0.25`. `halt()` 는 `t0` 를 리셋하지 않는다 — 화면 밖에서도 시계는 흐른 것으로 계산되어 다시 들어오면 이어진다
- IO 가 걸리기 전에도 첫 화면을 깔아둔다
- cleanup 에서 `io.disconnect()` + `halt()`
- `<DiagramFigure className="vm-rstep"><style>{CSS}</style><svg ref={…}>` 구조. CSS 는 템플릿 문자열 상수

## 문법 대응표

| study-hugo | nextra | 자동 변환 가능? |
|---|---|---|
| `{{< flow src="_flow/이름.json" />}}` | `import spec from './_components/flow/이름.json'` → `<Flow spec={spec} />` | 기계적 |
| `{{< seq src="_seq/이름.json" />}}` | 같은 방식으로 `<Seq spec={spec} />` | 기계적 |
| `{{< rstep variant="rollback" >}}` | `<RolloutStep variant="rollback" />` | 기계적 |
| `{{< relref "../01-x/index.md" >}}` | `/blog/<최종-슬러그>` **절대경로** | **불가.** nextra 에 relref 리졸버가 없다. 매번 손으로 최종 슬러그를 알아내 바꿔야 한다 |
| frontmatter `title`·`weight` | `page.mdx` frontmatter (`title`·`date`) | 부분 |
| 근거 등급 배지 (`✓` 인라인 code → 색 배지) | **없다.** `docs/mdx-components.tsx` 에 inline code 오버라이드가 없다 | **불가.** 컴포넌트나 rehype 플러그인을 새로 만들어야 한다 |

co-location 규칙(`<절번호>-<제목>` 파일명)은 양쪽이 이미 같게 수렴해 있다. hugo 는 page bundle resource, nextra 는 `_components/flow/` 아래 import — 디렉토리 이름만 다르다.

## 옮길 때 순서

1. `rstep-frames.mjs` 를 가져간다. 손댈 것 없다. `.ts` 로 바꿀지 아니면 `.d.ts` 를 붙일지 결정한다 — 지금 `RolloutStep.tsx` 의 `Frame`·`Cfg` 타입은 손으로 옮긴 것이라 모듈과 강제 연결돼 있지 않다.
2. `RolloutStep.tsx` 를 가져간다. **머리의 `/* eslint-disable */`·`// @ts-nocheck` 두 줄을 지우고** 그쪽 tsconfig 로 실제 타입 검사를 받는다 — 그게 이 파일이 처음으로 진짜 검증되는 시점이다. import 경로 둘(`./rstep-frames.mjs`, `DiagramFigure`)을 실제 위치로 맞춘다.
3. **네 variant 를 hugo 쪽과 나란히 띄워 눈으로 대조한다.** 아직 브라우저에서 렌더된 적이 없다.
4. `port-parity.js` 를 nextra 테스트로 옮기고 **비교 방향을 뒤집는다** — 옮긴 뒤에는 Hugo 엔진이 아니라 이 모듈이 SSOT 이므로, 되읽을 Hugo 엔진이 없어진다.
5. `DIAGRAMS.md` 에 "nextra 쪽 대응 컴포넌트" 열을 추가한다.

## 이식이 아니라 재동기화인 것

`content/homelab/01-hub-edge-architecture` 와 `02-dev-workspace` 는 **이미 2026-08-25 에 nextra 로 이식이 끝났다.** 도식 JSON 은 양쪽이 바이트 단위로 동일하다(확인함).

그런데 그 뒤로도 hugo 쪽 산문만 계속 편집됐다 — 이식 이후 커밋 둘이 더 있다. 즉 이 둘은 "옮길 신규 글"이 아니라 **"이미 옮긴 글의 산문 재동기화"** 대상이다. 이식 계획을 세울 때 이 구분을 놓치면 같은 글을 두 번 옮긴다.

`docs/app/blog/_karpenter-consolidation/` 은 언더스코어 프리픽스라 App Router 가 라우트로 노출하지 않는 **죽은 디렉토리**다. `karpenter-consolidation-part1`·`part2` 로 대체된 뒤 지워지지 않은 초안 잔재로 보인다 — 정리 후보.
