# 도식 shortcode 레퍼런스

이 레포는 자체 도식 엔진 다섯 개를 쓴다. **mermaid가 아니다.**

| shortcode | 용도 | 엔진 |
|---|---|---|
| `{{< flow >}}` | 노드·엣지 흐름도 (파티클 애니메이션) | `static/flow/flow.js`, `static/flow/flow.css` |
| `{{< seq >}}` | 시퀀스 다이어그램 (왕복 화살표) | `static/flow/seq.js`, `static/flow/seq.css` |
| `{{< cfstl >}}` | CFS period 타임라인 (재생 헤드 애니메이션) | `static/flow/cfstl.js`, `static/flow/cfstl.css` |
| `{{< bscore >}}` | Balanced 스코어 조립 (5단계 상태머신) | `static/flow/bscore.js`, `static/flow/bscore.css` |
| `{{< mnode >}}` | 노드 삭제 → 파드 이동 (5단계 상태머신, variant 둘) | `static/flow/mnode.js`, `static/flow/mnode.css` |

전부 `layouts/partials/custom/head-end.html`에서 로드된다(공용 "크게 보기"는 `flow/expand.js`).

---

## 스펙은 문서 옆 파일에 둔다

`flow`·`seq` 스펙은 본문에 인라인하지 않고 **page bundle 리소스**로 분리한다. nextra 쪽 `_components/` 와 같은 co-location이다.

```
content/karpenter/
├── 06-consolidation-traps/
│   ├── index.md
│   └── _seq/
│       └── 3-왜-돌아오지-않나.json
└── 12-consolidation-models/
    ├── index.md
    └── _flow/
        ├── 3-세-분류.json
        ├── 4-2-두-형태-삭제와-교체.json
        └── 7-2-balanced-는-그-위에.json
```

본문에서는 self-closing으로 부른다.

````
{{< flow src="_flow/4-2-두-형태-삭제와-교체.json" />}}
{{< seq src="_seq/3-왜-돌아오지-않나.json" />}}
````

- **`caption`은 JSON 최상위 `caption` 키**에 넣는다 — 도식 하나가 파일 하나로 완결된다. shortcode에 `caption=` 파라미터를 주면 그쪽이 이긴다.
- 파일명은 `<절번호>-<제목 앞부분>` 규칙. 같은 문서 안에서만 유일하면 된다.
- 인라인(`{{< flow caption="…" >}}…{{< /flow >}}`) 형태도 계속 동작한다. 새로 쓸 땐 쓰지 말 것.

### 문서를 번들로 바꿀 때

`doc.md` → `doc/index.md`로 옮기면 **URL은 그대로**이고 `{{< relref "doc.md" >}}` 같은 이름 참조도 그대로 해석된다. 단 **그 문서 안의 상대 참조는 한 단계 깊어진다** — `relref "../other/x.md"`를 `relref "../../other/x.md"`로 고쳐야 한다. 안 고치면 빌드가 `REF_NOT_FOUND`로 실패하므로 조용히 깨지지는 않는다.

`_index.md`는 이미 섹션 번들이라 옮길 필요 없이 옆에 `_flow/`만 두면 된다.

---

## `{{< flow >}}`

````
{{< flow src="_flow/이름.json" />}}
````

```json
{
  "caption": "설명 한 줄",
  "nodes": [
    { "id": "A", "col": 0, "row": 0, "label": "Kube API", "sub": "Service · Endpoint", "kind": "store" },
    { "id": "B", "col": 1, "row": 0, "label": "istiod", "kind": "proc" }
  ],
  "edges": [
    { "from": "A", "to": "B", "label": "watch", "rate": 700 }
  ]
}
```

### node

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | ✅ | 엣지에서 참조할 식별자 |
| `col` | | 가로 위치(0부터). 열 간격 218px 고정 |
| `row` | | 세로 위치(0부터). 같은 row는 높이를 공유 |
| `label` | | 굵은 제목. 없으면 `id`가 쓰인다. 폭 128px에서 자동 줄바꿈 |
| `sub` | | 아래 작은 설명줄. 폭 132px에서 자동 줄바꿈 |
| `kind` | | 색상 계열. 기본 `proc` |

`kind` 값은 **다섯 개뿐**이다. 다른 값을 넣으면 CSS가 없어 무색으로 나온다.

`src` · `proc` · `store` · `query` · `sink`

### edge

| 필드 | 필수 | 설명 |
|---|---|---|
| `from` / `to` | ✅ | node `id` |
| `label` | | 선 중앙에 표시 |
| `rate` | | 파티클 생성 간격(ms). 기본 720. **작을수록 빈번** |
| `speed` | | `slow`(55) · `normal`(92) · `fast`(150). 기본 `normal` |
| `dashed` | | `true`면 점선이 되고 **파티클이 흐르지 않는다** |
| `kind` | | 파티클 색. 생략하면 `from` 노드의 `kind`를 따른다 |

### group (선택)

노드 여러 개를 묶어 배경 박스를 그린다.

```json
"groups": [
  { "id": "cp", "label": "컨트롤 플레인", "members": ["B", "C"] },
  { "id": "dp", "label": "데이터 플레인", "members": ["D", "E"] }
]
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | ✅ | 그룹마다 **유일해야 한다**. 아래 주의 참고 |
| `label` | | 박스 좌상단 라벨. 생략하면 박스만 그려진다 |
| `members` | ✅ | node `id` 배열. 이들의 바운딩 박스가 그룹 박스가 된다 |

**`id`를 빠뜨리면 그룹이 둘 이상일 때 조용히 깨진다.** `flow.js`가 `groupBox[g.id]`로 키를 잡아서, `id`가 없으면 전부 `undefined` 키를 덮어쓴다 — **마지막 그룹의 박스 하나만 그려지고 그 위에 라벨이 전부 겹쳐 찍힌다.** 에러도 경고도 없다. 그룹이 하나뿐일 때는 우연히 정상으로 보이므로, 그룹을 추가하는 순간 터진다.

`members`는 인접할 필요가 없지만, 바운딩 박스로 계산되므로 **떨어진 노드를 한 그룹에 묶으면 사이에 낀 다른 노드까지 박스 안에 들어간다.**

### 레이아웃 상수 (`flow.js`)

```js
NODE_W: 146,  COL_GAP: 218,  ROW_VGAP: 30,  MARGIN: 24,  MINH: 48
```

노드 폭이 고정이라 **`label`은 짧게** 쓴다. 긴 문장은 `sub`로 내리거나 `caption`에 둔다.

---

## `{{< seq >}}`

````
{{< seq src="_seq/이름.json" />}}
````

```json
{
  "caption": "설명 한 줄",
  "participants": [
    { "id": "C", "label": "client pod" },
    { "id": "Z", "label": "ztunnel" }
  ],
  "steps": [
    { "msg": ["C", "Z"], "label": "1. :15001 REDIRECT" },
    { "msg": ["Z", "C"], "label": "2. 응답", "dashed": true },
    { "note": ["C", "Z"], "lines": ["mTLS 세션 수립", "(x509 SPIFFE ID)"] }
  ]
}
```

**flow와 갈리는 지점: seq는 화살표가 좌→우, 우→좌 모두 그려진다.** 요청/응답 왕복, 핸드셰이크, 실패 후 재시도처럼 **되돌아오는 흐름은 flow가 아니라 seq로** 그린다 — flow는 `to`의 `col`이 `from` 이하면 선이 뒤로 그려져 화살표가 깨진다.

### participant

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | ✅ | step에서 참조할 식별자 |
| `label` | | 상자 안 이름. 없으면 `id`. 폭 128px에서 자동 줄바꿈 |

배열에 쓴 순서가 곧 가로 순서다. `col` 같은 위치 필드는 없다.

### step — 세 종류뿐

| 형태 | 스펙 | 설명 |
|---|---|---|
| 메시지 | `{"msg": ["from","to"], "label": "…", "dashed": true}` | 화살표 한 줄. `dashed`면 점선 — 응답·비동기 표현용 |
| 노트 | `{"note": ["id","id"], "lines": ["줄1","줄2"]}` | 지정 참여자들에 걸치는 상자. `lines` 없으면 `label` 한 줄이 쓰인다 |
| 분기 | `{"alt": "라벨", "steps": [...], "elseLabel": "…", "elseSteps": [...]}` | alt/else 프레임. 중첩 가능 |

`loop` · `par` · `opt` 프레임은 **엔진에 없다.** `alt` 하나뿐이므로 반복은 `note`나 라벨로 표현한다. `elseLabel`을 생략하면 구분선 없이 alt 박스만 그려진다.

### 레이아웃 상수 (`seq.js`)

```js
PBOX_W: 142,  PGAP: 182,  STEP_H: 46,  M: 20
```

- 참여자 라벨 폭은 128px(font 12) — **한글 10자를 넘으면 두 줄**이 되고 상자가 그만큼 높아진다.
- 참여자 5명이면 폭이 이미 910px다. **3~4명이 최적**이고, 넘으면 인라인에서 심하게 축소된다.
- msg 라벨은 잘리지 않는다 — 대신 viewBox가 좌우로 늘어나 **도식 전체가 넓어진다.** 긴 설명은 `note`로 내린다.

### 애니메이션

메시지는 **문서에 쓴 순서대로** 점이 하나씩 이동한다(`STEP_DELAY 640ms`). `alt` 안의 메시지도 같은 순번을 받으므로, 정상/실패 분기가 번갈아 재생되는 게 아니라 위에서 아래로 한 번씩 흐른다.

사용처는 `content/` 에서 `{{< seq` 로 검색. 스펙 파일은 `content/**/_seq/*.json`.

---

## `{{< cfstl >}}`

CFS bandwidth control의 period 타임라인. **JSON 스펙이 아니라 `variant` 하나만 받는다** — 데이터가 곧 개념이라 엔진(`static/flow/cfstl.js`)의 `ROWS`에 박아뒀다. nextra 블로그의 `CfsTimeline` React 컴포넌트를 옮긴 것.

````
{{< cfstl variant="latency" >}}
````

| variant | 보여주는 것 |
|---|---|
| `latency` | CPU limit이 요청 지연을 늘리는 방식 — 30ms 작업이 110ms가 된다 |
| `threads` | 병렬도가 quota를 태운다 — 같은 1코어 limit인데 2·4코어에서 더 잘린다 |
| `burst` | 안 쓴 quota를 적립해 당겨 쓴다 — 누적 상한은 그대로 |

`caption`을 주면 그 문장이, 생략하면 variant별 기본 설명이 들어간다. 새 variant를 넣을 땐 `ROWS`와 `CAPTION`에 같은 키를 추가한다.

**렌더 검증**: 브라우저 없이 확인하려면 엔진을 최소 DOM 스텁 위에서 돌려 rect가 viewBox를 벗어나지 않는지·`NaN` 속성이 없는지 본다(`<defs>`의 clipPath 마스크는 렌더되지 않으므로 검사에서 제외). 막대 길이 합이 서술한 수치와 맞는지도 같이 세어볼 것 — 도식과 산문이 어긋나기 쉬운 지점이다.

---

## `{{< bscore >}}` · `{{< mnode >}}` — 단계형 상태머신

`flow`가 정해진 선 위로 파티클을 계속 흘리는 것과 달리, 이 둘은 **단계마다 멈춰 보여주는** 방식이다. nextra 블로그의 `ThrottleGate`에서 가져온 구조로, `cfstl`처럼 **JSON 스펙이 아니라 인자가 없다** — 데이터가 곧 개념이라 엔진에 박아뒀다.

````
{{< bscore >}}
{{< mnode variant="single" >}}
{{< mnode variant="multi" >}}
````

| shortcode | 5단계 |
|---|---|
| `bscore` | 후보 확정 → disruptionCost 누적 → savings → 풀 기준선 → 심사(승인/거부) |
| `mnode` | 후보와 파드 → SavingsRatio 정렬 → 앞에서 집기 → 새 노드로 파드 이동 → 옛 노드 반납 |

`mnode`의 두 variant는 **"앞에서 몇 대를 집는가" 하나만 다르다**(`single` 1대, `multi` 3대). 후보 넷과 정렬은 공유하므로 두 그림을 나란히 두면 차이가 그 한 지점으로 보인다. 개념은 `single`이 쉬우니 문서에서도 그 순서로 놓고, **실행 순서가 반대(multi 먼저)라는 건 산문이 말한다** — 그림으로 그리면 오히려 헷갈린다.

`caption`을 주면 그 문장이 고정되고, 생략하면 **캡션이 단계마다 바뀐다**(그 단계 설명으로). 애니메이션이 꺼진 상태(`prefers-reduced-motion`)에서는 마지막 단계 정지 화면 + 기본 설명이 남는다.

### 구조

```js
PHASE_MS = 2600, PHASE_COUNT = 5
computeFrame(phase, t) → Frame      // (단계, 0~1 진행률)의 순수 함수
```

**파티클 배열을 들고 있지 않는 게 핵심이다.** 매 프레임 `(phase, t)`만으로 전체 상태를 다시 계산하고 SVG 속성만 갈아끼운다. 그래서 단계를 넣고 빼거나 순서를 바꿀 때 `computeFrame`의 분기 하나만 손대면 된다.

수치를 바꿀 땐 파일 상단 상수 블록만 고친다 — `bscore`는 가격·파드 수·풀 총계가 서로 맞아떨어져야 하고(`SCORE`가 유도값이라 임계 `0.5`와의 관계가 저절로 정해진다), `mnode`는 `NODES`의 `from`/`to`가 `ratio` 내림차순과 일치해야 정렬 애니메이션이 맞고, `VARIANTS`의 `meterMax`가 그 variant의 총 cost보다 커야 미터가 넘치지 않는다.

### 렌더 검증

브라우저 없이 확인하려면 최소 DOM 스텁 위에서 rAF 루프를 여러 시점으로 돌려 `NaN`·`undefined` 속성과 viewBox 이탈을 본다. 단계형이라 **한 시점만 보면 안 되고 전 구간을 훑어야** 한다 — 특정 단계에서만 음수 `width`가 나오는 식으로 깨진다. 숨겨진(`opacity="0"`) 요소는 범위 검사에서 빼되, **좌표 자체는 항상 유효하게** 둘 것.

한 가지 함정: 프레임 루프의 시작 시각을 `if (!t0) t0 = ts` 로 잡으면 **첫 타임스탬프가 정확히 0일 때 영영 안 걸린다.** 브라우저의 `ts`는 0이 아니라 안 드러나지만, 시계를 주입해 테스트하거나 스크럽을 붙이면 바로 터진다. `t0 = -1` 로 두고 `if (t0 < 0)` 로 검사한다.

---

## 작성 요령

- **본문을 도식으로 대체한다.** 단계가 3개 이상이면 산문보다 flow가 짧고 정확하다. 도식을 넣었으면 같은 내용을 다시 서술하지 말 것.
- **`caption`이 본문 역할을 한다.** 도식이 무엇을 말하는지 한 문장으로.
- **`rate`로 부하 차이를 표현한다.** 같은 그림에서 `rate: 380`과 `rate: 900`은 "이쪽이 훨씬 자주"를 색 없이 전달한다.
- **인라인은 본문 폭에 맞춰 축소**되고, 우상단 "크게 보기"로 전체화면 확대된다. 넓은 도식도 넣을 수 있지만 인라인 가독성은 스스로 확인할 것.
- 렌더 확인: `hugo server` 또는 `hugo --gc --minify` 후 `public/<경로>/index.html`.
