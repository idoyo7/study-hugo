# Design

## Source of truth
- Status: Draft
- Last refreshed: 2026-08-21
- Primary product surfaces: Hugo 기술 문서, 본문 내 flow/seq 도식
- Evidence reviewed: `README.md`, `DIAGRAMS.md`, `static/flow/flow.js`, `static/flow/flow.css`, `content/homelab/`

## Brand
- Personality: 기술적으로 정확하고 차분하지만, 구조적 대비가 선명한 운영 기록
- Trust signals: 실제 구성과 한계 공개, 평면별 색의 일관성, 실패 시 동작 설명
- Avoid: 장식만 위한 노드, 한 그림에서 모든 세부 구현을 설명하는 과밀 구성

## Product goals
- Goals: 복잡한 인프라의 핵심 관계를 한 번에 읽히게 하고 상세 설명으로 자연스럽게 이어준다.
- Non-goals: 전체 리소스 인벤토리나 실제 네트워크 패킷 시퀀스를 개요도 한 장에 재현하지 않는다.
- Success signals: 독자가 먼저 물리 경계와 핵심 의존성을 찾고, 다음으로 각 클러스터 내부 체인을 읽는다.

## Personas and jobs
- Primary personas: Kubernetes·GitOps·관측 스택에 익숙한 엔지니어
- User jobs: 배치 위치, 상태 소유권, 클러스터 간 장애 전파 범위를 빠르게 파악한다.
- Key contexts of use: 데스크톱 본문, 모바일 축소 보기, 전체화면 확대 보기

## Information architecture
- Primary navigation: 홈랩 개요 → 토폴로지 → 관측 평면 → 배포·접근 평면
- Core routes/screens: `content/homelab/`
- Content hierarchy: 전체 지도는 경계와 의존성을, 후속 문서는 프로토콜과 구현 세부를 담당한다.

## Design principles
- 경계를 먼저 그린다: hub·공인 인터넷·edge를 가장 큰 시각 단위로 삼는다.
- 방향을 제한한다: 클러스터 내부 체인은 위→아래, 클러스터 간 의존성은 가로로 읽힌다.
- 상세는 다음 그림으로 넘긴다: 전체 지도에서는 역할을 묶고 후속 평면도에서 컴포넌트를 푼다.
- Tradeoffs: 완전한 대칭보다 실제 상태 소유권의 비대칭을 우선한다.

## Visual language
- Color: 배포 파랑, 관측 청록, 상태 보라, 접근 주황을 기존 토큰 그대로 사용한다.
- Typography: 기존 flow 엔진의 monospace 노드 라벨과 sans-serif 보조 문구를 유지한다.
- Spacing/layout rhythm: 5열 좌우 대칭, 중앙 한 열을 WAN 경계로 사용한다.
- Shape/radius/elevation: 기존 둥근 노드와 점선 그룹 박스를 재사용한다.
- Motion: 실제 지속 흐름만 파티클로 표시하고 의존성·부재는 점선으로 정지시킨다.
- Imagery/iconography: 아이콘 없이 라벨·위치·색으로 의미를 전달한다.

## Components
- Existing components to reuse: Hugo `flow` shortcode, flow group, layer, ghost node
- New/changed components: 없음
- Variants and states: 실제 컴포넌트는 실선 카드, 논리적 WAN 통로와 부재는 ghost 카드
- Token/component ownership: `static/flow/flow.css`와 `static/flow/flow.js`

## Accessibility
- Target standard: 텍스트와 구조만으로 색상 의미를 보완한다.
- Keyboard/focus behavior: 전체화면 확대 기능의 기존 동작을 유지한다.
- Contrast/readability: 노드 라벨은 짧게 유지하고 긴 설명은 caption과 본문으로 내린다.
- Screen-reader semantics: JSON caption이 SVG `aria-label`이 된다.
- Reduced motion and sensory considerations: 기존 `prefers-reduced-motion` 처리를 유지한다.

## Responsive behavior
- Supported breakpoints/devices: 본문 폭에서는 전체 축소, 필요 시 전체화면 확대
- Layout adaptations: 5열을 넘기지 않고 긴 라벨을 피한다.
- Touch/hover differences: 의미 전달을 hover에 의존하지 않는다.

## Interaction states
- Loading: 정적 JSON과 인라인 SVG 생성 외 별도 상태 없음
- Empty: ghost 노드로 의도적 부재를 표현한다.
- Error: 잘못된 JSON은 도식이 생성되지 않으므로 빌드와 렌더 스모크 테스트로 방지한다.
- Success: caption과 전체 노드·엣지가 함께 렌더링된다.
- Disabled: 해당 없음
- Offline/slow network: 외부 런타임 의존성이 없어야 한다.

## Content voice
- Tone: 단정하되 실제 예외와 대가를 숨기지 않는다.
- Terminology: `hub`, `edge`, `공인 인터넷`, `remote write`, `OIDC`를 일관되게 사용한다.
- Microcopy rules: 노드는 명사, 선은 동작 또는 프로토콜, 부재는 `없음`으로 쓴다.

## Implementation constraints
- Framework/styling system: Hugo + Hextra, 저장소 자체 flow 엔진
- Design-token constraints: 기존 네 가지 layer 색을 변경하지 않는다.
- Performance constraints: 새 프런트엔드 의존성을 추가하지 않는다.
- Compatibility constraints: JSON page bundle과 기존 shortcode 규약을 지킨다.
- Test/screenshot expectations: `hugo --buildDrafts --gc --minify`와 생성 HTML 확인

## Open questions
- [ ] 새 포크의 구조가 승인되면 기존 토폴로지 문서에 반영할지 결정한다.
