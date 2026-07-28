# 도식 shortcode 레퍼런스

이 레포는 자체 도식 엔진 두 개를 쓴다. **mermaid가 아니다.**

| shortcode | 용도 | 엔진 |
|---|---|---|
| `{{< flow >}}` | 노드·엣지 흐름도 (파티클 애니메이션) | `static/flow/flow.js`, `static/flow/flow.css` |
| `{{< seq >}}` | 시퀀스 다이어그램 (왕복 화살표) | `static/flow/seq.js`, `static/flow/seq.css` |
| `{{< cfstl >}}` | CFS period 타임라인 (재생 헤드 애니메이션) | `static/flow/cfstl.js`, `static/flow/cfstl.css` |

셋 다 `layouts/partials/custom/head-end.html`에서 로드된다(공용 "크게 보기"는 `flow/expand.js`). 본문에는 JSON 스펙만 쓴다.

---

## `{{< flow >}}`

````
{{< flow caption="설명 한 줄" >}}
{
  "nodes": [
    { "id": "A", "col": 0, "row": 0, "label": "Kube API", "sub": "Service · Endpoint", "kind": "store" },
    { "id": "B", "col": 1, "row": 0, "label": "istiod", "kind": "proc" }
  ],
  "edges": [
    { "from": "A", "to": "B", "label": "watch", "rate": 700 }
  ]
}
{{< /flow >}}
````

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
  { "label": "컨트롤 플레인", "members": ["B", "C"] }
]
```

### 레이아웃 상수 (`flow.js`)

```js
NODE_W: 146,  COL_GAP: 218,  ROW_VGAP: 30,  MARGIN: 24,  MINH: 48
```

노드 폭이 고정이라 **`label`은 짧게** 쓴다. 긴 문장은 `sub`로 내리거나 `caption`에 둔다.

---

## `{{< seq >}}`

````
{{< seq caption="설명 한 줄" >}}
{
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
{{< /seq >}}
````

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

사용처는 `content/` 에서 `{{< seq` 로 검색.

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

## 작성 요령

- **본문을 도식으로 대체한다.** 단계가 3개 이상이면 산문보다 flow가 짧고 정확하다. 도식을 넣었으면 같은 내용을 다시 서술하지 말 것.
- **`caption`이 본문 역할을 한다.** 도식이 무엇을 말하는지 한 문장으로.
- **`rate`로 부하 차이를 표현한다.** 같은 그림에서 `rate: 380`과 `rate: 900`은 "이쪽이 훨씬 자주"를 색 없이 전달한다.
- **인라인은 본문 폭에 맞춰 축소**되고, 우상단 "크게 보기"로 전체화면 확대된다. 넓은 도식도 넣을 수 있지만 인라인 가독성은 스스로 확인할 것.
- 렌더 확인: `hugo server` 또는 `hugo --gc --minify` 후 `public/<경로>/index.html`.
