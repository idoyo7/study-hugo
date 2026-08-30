# 도식 shortcode 레퍼런스

이 레포는 자체 도식 엔진 여덟 개를 쓴다. **mermaid가 아니다.**

| shortcode | 용도 | 엔진 |
|---|---|---|
| `{{< flow >}}` | 노드·엣지 흐름도 (파티클 애니메이션) | `static/flow/flow.js`, `static/flow/flow.css` |
| `{{< seq >}}` | 시퀀스 다이어그램 (왕복 화살표) | `static/flow/seq.js`, `static/flow/seq.css` |
| `{{< lane >}}` | 가로축 위 레인 막대 (시점 축 · 연속 축) | `static/flow/lane.js`, `static/flow/lane.css` |
| `{{< cfstl >}}` | CFS period 타임라인 (재생 헤드 애니메이션) | `static/flow/cfstl.js`, `static/flow/cfstl.css` |
| `{{< bscore >}}` | Balanced 스코어 조립 (5단계 상태머신) | `static/flow/bscore.js`, `static/flow/bscore.css` |
| `{{< mnode >}}` | 노드 삭제 → 파드 이동 (5단계 상태머신, variant 둘) | `static/flow/mnode.js`, `static/flow/mnode.css` |
| `{{< rstep >}}` | canary step 진행·스킵·가중치·가용량·AnalysisRun (6단계 상태머신, variant 넷) | `static/flow/rstep.js`, `static/flow/rstep.css` |
| `{{< rrev >}}` | 리비전 핸드오프 — 해시가 언제 써지고 VS weight 가 언제 움직이는가 (6단계 상태머신, variant 하나) | `static/flow/rrev.js`, `static/flow/rrev.css` |

전부 `layouts/partials/custom/head-end.html`에서 로드된다(공용 "크게 보기"는 `flow/expand.js`).

로딩은 **그 문서가 실제로 쓰는 것만** 싣는다 — `.RawContent`에서 `{{< 이름` 을 찾아 판정한다. 새 엔진을 넣으면 `head-end.html`의 `$use…` 판정과 `expand.js`의 셀렉터 목록 **양쪽**에 등록해야 한다. 한쪽만 하면 도식은 뜨는데 "크게 보기"가 없거나, 반대로 조용히 로드가 안 된다.

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
| `layer` | | 평면 구분. `deploy`(파랑) · `observe`(청록) · `state`(보라) · `access`(주황). 지정하면 `kind` 색 대신 이 색으로 테두리(굵게)·옅은 바탕·파티클을 칠한다. 여러 도식에 걸쳐 같은 레이어를 같은 색으로 읽히게 할 때 쓴다 |
| `ghost` | | `true`면 점선 테두리·바탕 없음·반투명으로 그린다. "없음·예정·미구현"처럼 **비어 있는 자리를 자리로서 보여줄 때** 쓴다. 색은 `layer`/`kind`를 그대로 따르되 옅어진다. 들어오는 엣지는 보통 `dashed`로 맞춘다 |
| `kind` | | 색상 계열. 기본 `proc` |

`kind` 값은 **다섯 개뿐**이다. 다른 값을 넣으면 CSS가 없어 무색으로 나온다.

`src` · `proc` · `store` · `query` · `sink`

### edge

| 필드 | 필수 | 설명 |
|---|---|---|
| `from` / `to` | ✅ | node `id` |
| `label` | | 선 중앙에 표시. 수직 엣지는 선 오른쪽 옆에 붙는다. **인접한 열 사이 빈 폭은 72px뿐**이라 가로 엣지 라벨은 한글 4~5자·영문 8자 안쪽으로 짧게 — 길면 배경 상자가 양쪽 노드 테두리를 덮는다. 긴 설명은 `caption`으로 |
| `rate` | | 파티클 생성 간격(ms). 기본 720. **작을수록 빈번** |
| `speed` | | `slow`(55) · `normal`(92) · `fast`(150). 기본 `normal` |
| `dashed` | | `true`면 점선이 되고 **파티클이 흐르지 않는다** |
| `kind` | | 파티클 색. 생략하면 `from` 노드의 `kind`를 따른다 |

라우팅은 자동이다. 기본은 `from` 오른쪽 면 → `to` 왼쪽 면이고, 두 노드의 x 범위가 40% 이상 겹치면(같은 `col`에 세로로 쌓인 경우) 아래/위 면을 잇는 **수직 직선**으로, `to`가 왼쪽에 있으면 좌우를 반전해 그린다. 세로 스택을 수직 화살표로 잇고 싶으면 같은 `col`에 두면 된다.

### font 배율 (선택)

`"font": 1.2` 를 최상위에 넣으면 노드 제목·설명·엣지 라벨·그룹 라벨 글자가 그 배율로 커진다. 노드 폭(146px)과 열 간격은 그대로라 긴 텍스트는 줄이 늘어 노드가 높아진다. SVG가 본문 폭에 맞춰 축소되는 열 4~5개짜리 도식에서 글자가 작아 보일 때 쓴다. 1.2~1.3 권장 — 그 이상이면 `label`이 노드 폭에서 강제 분할된다.

### token 모드 (선택)

`"token": true` 를 최상위에 넣으면 **파티클을 뿌리는 대신 하나가 경로를 따라 단계별로 넘어간다.** "여러 개가 흐른다"가 아니라 "한 대가 이 길을 지난다"를 말하고 싶을 때 쓴다.

```json
{ "caption": "…", "token": true, "nodes": [...], "edges": [...] }
```

- 시작 노드(들어오는 엣지 없음)에서 끝 노드(나가는 엣지 없음)까지의 **단순 경로를 전부 열거**하고, 한 바퀴마다 다른 갈래를 탄다. 갈래가 둘이면 번갈아 돈다.
- 토큰은 **멈추지 않고 연속으로 흐른다.** `segT += dt / ed._dur` 로 매 프레임 위치를 갱신하고, 구간을 넘어가면(`segT >= 1`) 넘친 만큼을 다음 구간에 그대로 넘겨 끊김 없이 이어간다(`segT -= 1`). `data-active` 속성 조작이나 일시 정지 코드는 없다.
- 한 바퀴가 끝나면(`segIdx >= path.length`) `lap++` 후 다음 바퀴 첫 구간으로 곧바로 이어진다 — 경계에서 멈추는 로직은 없다.
- 엣지 끝점이 **그룹 id 면 토큰 모드를 포기**하고 기존 파티클 모드로 돌아간다(경로를 잡을 수 없다).
- `rate` 는 무시된다. `speed` 는 이동 속도로 그대로 쓰인다.

**독자에게 부르는 이름**: 도식이 "패킷"이 아니라 **노드 한 대**를 옮기는 그림이면 caption 에서 그렇게 부를 것. `flow-packets` 라는 클래스 이름은 이 엔진이 원래 istio 네트워크 도식용이라 붙은 것이고, 뜻과는 무관하다.

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
| `pad` | | 박스 여백(px). 기본 16. 한 그룹이 다른 그룹 **안에** 들어가는 레이어를 그릴 때 안쪽 그룹에 `6`처럼 작게 줘서 테두리가 겹치지 않게 한다. 그룹은 배열 순서대로 그리므로 바깥 그룹을 먼저 둔다 |

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

**flow와 갈리는 지점: seq는 화살표가 좌→우, 우→좌 모두 그려진다.** 요청/응답 왕복, 핸드셰이크, 실패 후 재시도처럼 **되돌아오는 흐름은 flow가 아니라 seq로** 그린다 — flow도 수직·역방향 라우팅은 지원하지만(§edge 라우팅 참고) 같은 두 노드를 오가는 왕복은 선이 겹쳐 표현할 수 없다.

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

## `{{< lane >}}`

````
{{< lane src="_lane/이름.json" />}}
````

```jsonc
{
  "caption": "한 줄 설명",              // figcaption + svg aria-label. flow와 동일 규약
  "font": 1.15,                         // 선택. 글자 배율
  "note": "아래로 갈수록 왼쪽으로 몰린다", // 선택. 축 아래 한 줄(작은 글씨)

  "axis": {
    "kind": "category",                 // "category" | "linear". 기본 "category"
    "cols": ["빌드", "훈련 실행", "시동", "정상 운영"],   // category 전용
    "max": 8,                           // linear 전용. 트랙 오른쪽 끝의 값
    "unit": "GB",                       // linear 전용. 눈금 라벨에 붙는다
    "ticks": [0, 2, 4, 6, 8]            // linear 전용. 생략하면 0과 max만
  },

  "lanes": [
    { "label": "C2 JVM", "sub": "OpenJDK 기본", "segments": [ /* ... */ ] }
  ],

  "markers": [                          // 선택. linear 축에서만 그린다
    { "at": 4, "label": "컨테이너 limit", "kind": "query" }
  ]
}
```

**flow와 갈리는 지점 — flow는 "무엇이 무엇으로 흐르는가", lane은 "무엇이 축의 어디에 얼마만큼 놓이는가".** 순서·의존이 있으면 flow, 위치·양이 있으면 lane.

### segment — 축 종류에 따라 위치 지정이 다르다

**category 축**

| 필드 | 필수 | 설명 |
|---|---|---|
| `col` | ✅ | 몇 번째 칸인가(0부터) |
| `w` | | 그 칸 안에서 막대가 차지하는 폭 비율 0~1. 기본 1. 막대는 칸 왼쪽에 **좌측 정렬**된다 — "칸 시작점에서 얼마나 뻗는가"로 읽는다 |
| `label` | | 막대 위에 붙는 이름 |
| `sub` | | 라벨 아래 작은 둘째 줄 |
| `kind` | | 색 계열. `src`·`proc`·`store`·`query`·`sink` 다섯 개뿐. 기본 `proc` |
| `empty` | | `true`면 "이 시점엔 할 일 없음". 점선 테두리·채움 없음·라벨 흐리게. `label` 생략 시 `없음` |
| `style` | | `"hatch"`면 대각 빗금 채움 — 실제로 쓰는 게 아니라 순간적으로 부푸는 몫 같은 것 |

**linear 축**

`col`/`w` 대신 `start`·`end`를 쓴다. 둘 다 `axis.max`와 같은 단위의 실제 값이다. 나머지 필드는 category와 동일.

**두 방식을 한 도식 안에서 섞지 마라.** `axis.kind`와 안 맞는 세그먼트(category인데 `start`/`end`, linear인데 `col`)는 조용히 건너뛰지 않고 `console.warn`을 남기고 그 세그먼트만 버린다. linear에서 `end`가 `axis.max`를 넘는 세그먼트도 **잘리지 않고** 그대로 그리며 경고만 남긴다 — viewBox가 그만큼 늘어난다.

### 막대는 양만, 텍스트는 막대 위 — 그리고 절대 칸을 넘지 않는다

막대 폭은 "일의 양"을 나타낸다. 라벨을 막대 **안에** 넣으면 라벨을 담으려고 막대가 넓어져야 해서 두 요구가 충돌한다. 그래서 라벨·서브는 막대 위에 별도로 얹는다 — 막대는 빈 색 블록일 뿐이다.

레인 한 줄의 세로 구성(위→아래):

```
  라벨   (12px, 줄당 15px×font)
  서브   (9.5px, 줄당 12px×font) ← 있을 때만
  4px 간격
  막대   (BAR_H = 18px 고정)
```

- 라벨·서브는 세그먼트 왼쪽 끝에 `text-anchor: start`로 좌측 정렬된다.
- **텍스트는 자기 칸(category) 또는 다음 세그먼트의 시작점(linear)을 절대 넘지 않는다.** `wrap()`으로 최대 2줄까지 접고, 2줄로도 안 들어가면 `console.warn`을 남기고 2줄까지만 그린다 — 잘라내는 대신 다른 세그먼트의 칸을 침범하는 쪽을 완전히 막았다(이전 버전은 막대 바깥에 라벨을 놓아 남의 칸에 걸치는 문제가 있었다).
  - category: 접는 기준 폭은 **그 칸의 폭**(`COL_W − 좌우 패딩`)으로 고정 — 막대의 `w`가 작아도 텍스트는 칸 전체 폭까지 쓸 수 있다.
  - linear: 접는 기준 폭은 `max(세그먼트 폭, 120)`이되 **다음 세그먼트의 시작 x를 넘지 않게** 잘린다. 마지막 세그먼트는 트랙 오른쪽 끝까지 쓸 수 있다.
- 이 규칙 덕에 **세그먼트 텍스트가 viewBox를 넓히는 일은 없다.** category 총 폭은 `MARGIN + GUTTER_W + cols×COL_W + MARGIN`으로 항상 딱 떨어진다(linear는 `end > max`로 막대 자체가 넘치는 경우만 여전히 예외 — 잘리지 않고 그대로 그리며 viewBox가 늘어난다).

### 레인 높이는 계산값이다

레인마다 라벨·서브 줄 수가 다르므로 높이도 다르다. 고정 상수가 아니라 레인마다 이렇게 계산한다.

```js
laneH = Math.max(46, maxLabelLines * 15*font + maxSubLines * 12*font + 4 + 18 /* BAR_H */ + 6)
```

`maxLabelLines`·`maxSubLines`는 그 레인 세그먼트들 중 최댓값이다. 최소 46px은 유지한다(왼쪽 거터의 레인 이름이 2줄일 수 있어서다). 총 높이는 이 레인별 높이의 합 + 레인 사이 간격이다.

### 레이아웃 상수 (`lane.js`)

```js
GUTTER_W: 118,  COL_W: 150,  TRACK_W: 640,  LANE_GAP: 14,
HEAD_H: 28,  FOOT_H: 22,  MARGIN: 16,  SEG_R: 5,  BAR_H: 18
```

- category 축 헤더: 각 칸 중앙에 칸 이름, 칸 경계마다(양끝 포함, `cols.length+1`개) 옅은 세로 구분선이 레인 영역 전체 높이로 그려진다.
- linear 축 헤더: `ticks`(생략 시 `[0, max]`) 위치마다 눈금선 + `값+unit` 라벨, 레인 영역을 관통하는 옅은 세로 격자선.
- marker(linear 전용): 해당 위치에 점선 세로선 + 위쪽에 라벨. 색은 `kind`(기본 `query`).
- 레인 라벨(왼쪽 거터)은 `flow.js`의 `wrap()`을 이식해 `GUTTER_W - 10` 기준으로 줄바꿈한다. 세그먼트 라벨·서브도 같은 `wrap()`을 쓰되 기준 폭이 다르다(위 참고).
- `hatch` 패턴의 `<pattern>` id는 도식(컨테이너)마다 유일한 접두어가 붙는다 — 페이지에 `lane` 도식이 여럿이어도 안전하다.

### 애니메이션

막대가 왼쪽에서 오른쪽으로 자라는 draw-in을 **한 번만** 한다(레인당 600ms, 레인마다 80ms stagger, 반복 없음). 텍스트는 애니메이션 없이 처음부터 고정 위치에 보인다. `IntersectionObserver`로 화면에 들어올 때 시작하고, `prefers-reduced-motion: reduce`면 애니메이션 없이 완성 상태로 즉시 그린다.

### 렌더 검증

```
node tools/lane_smoke.js content/runtime/01-jvm-graalvm/_lane/*.json
```

브라우저 없이 최소 DOM 스텁 위에서 엔진을 돌려 여섯 가지를 본다: ①`NaN`·음수 폭 없음 ②모든 요소가 viewBox 안 ③`<pattern>` id 유일성 ④category 칸 구분선 수와 `cols.length` 일치 ⑤linear `end > max` 세그먼트가 잘리지 않고 경고가 나는지 ⑥**세그먼트 텍스트가 자기 칸(category) 또는 다음 세그먼트 시작점(linear)을 넘지 않는지** — `lane.js`와 같은 텍스트 폭 추정 공식을 스크립트 안에 복제해서 잰다. 합성(synthetic) 케이스로 축 불일치 skip 경고와 linear 초과 경고도 같이 검증한다.

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

## `{{< bscore >}}` · `{{< mnode >}}` · `{{< rstep >}}` · `{{< rrev >}}` — 단계형 상태머신

`flow`가 정해진 선 위로 파티클을 계속 흘리는 것과 달리, 이 넷은 **단계마다 멈춰 보여주는** 방식이다. nextra 블로그의 `ThrottleGate`에서 가져온 구조로, `cfstl`처럼 **JSON 스펙이 아니라 인자가 없다** — 데이터가 곧 개념이라 엔진에 박아뒀다.

````
{{< bscore >}}
{{< mnode variant="single" >}}
{{< mnode variant="multi" >}}
{{< rstep variant="rollback" >}}
{{< rrev >}}
````

| shortcode | 단계 |
|---|---|
| `bscore` | (5단계) 후보 확정 → disruptionCost 누적 → savings → 풀 기준선 → 심사(승인/거부) |
| `mnode` | (5단계) 후보와 파드 → SavingsRatio 정렬 → 집어서 가상 배치(시뮬레이션) → 실제 파드 이동 → 옛 노드 반납 |
| `rstep` | (6단계) RS 생성(하한) → 인덱스 이동·스킵 → 가중치 결정 → 램프업 → 요구=실제 도달 → 승격 |
| `rrev` | (6단계) 세 평면 등장(해시는 이미 같다) → canary RS 생성(조기 반환, replicas=0) → 다음 바퀴에 해시만 먼저 써짐 → desired 2 로 확장·Available 미달로 가드 걸림 → 가드 해제·VS weight 이동 → 승격(weight 원점, 리비전 이동) |

`mnode`의 두 variant는 **"앞에서 몇 대를 집는가" 하나만 다르다**(`single` 1대, `multi` 3대). 후보 넷과 정렬은 공유하므로 두 그림을 나란히 두면 차이가 그 한 지점으로 보인다. 개념은 `single`이 쉬우니 문서에서도 그 순서로 놓고, **실행 순서가 반대(multi 먼저)라는 건 산문이 말한다** — 그림으로 그리면 오히려 헷갈린다.

`mnode` ③단계의 점선 파드는 **시뮬레이션이 앉혀본 자리**다 — ④에서 실물이 도착하면 그 자리부터 지워진다. 유령과 실물이 한 자리에 겹치지 않게 `flightP[j] >= 1` 로 교대시킨다.

`caption`을 주면 그 문장이 고정되고, 생략하면 **캡션이 단계마다 바뀐다**(그 단계 설명으로). 애니메이션이 꺼진 상태(`prefers-reduced-motion`)에서는 마지막 단계 정지 화면 + 기본 설명이 남는다.

### `{{< rstep >}}` 의 variant 넷

canary 배포에서 **동시에 움직이는 다섯 가지**를 한 판에 겹쳐 놓는다.

1. 스텝 인덱스와 **스킵**
2. 그 가중치를 정한 **코드 갈래** (`:217` · `:229` · `:245` · `:255` · `:261`)
3. 트래픽 가중치
4. 그 가중치가 **요구하는 파드 수 vs 실제 Available**
5. AnalysisRun 상태

`flow`로는 안 된다. 선 위를 흐르는 그림이 아니라 **같은 판이 단계마다 다시 칠해지는** 그림이기 때문이다.

| variant | 보여주는 것 | steps | 스킵 시작 |
|---|---|---|---|
| `deploy` | 정상 배포 — 인덱스를 하나씩 밟고 스텝마다 가용량 게이트가 걸린다 | 3 (base 기본값) | 없음 |
| `promote` | `promote --full` — 스텝은 건너뛰지만 `:229` 가 가중치를 **동결**한다 | 3 (같음) | index 1 |
| `rollback` | `rollbackWindow` — 같은 자리에서 같이 건너뛰는데 `:245` 역탐색이 마지막 `setWeight` 를 집는다 | 3 (같음) | index 0 |
| `fixed` | 마지막 `setWeight: 100` 을 지운 뒤의 같은 롤백 | 2 | index 0 |

**`promote` 와 `rollback` 을 나란히 두는 게 이 도식의 존재 이유다.** 스킵도 AnalysisRun 취소도 같은 코드 같은 줄(`canary.go:390`, `analysis.go:77`)이고, 갈리는 건 가중치 갈래 하나다. 세 그림을 순서대로 놓으면 차이가 그 한 지점으로 좁혀진다 — `mnode` 의 `single`/`multi` 와 같은 설계다.

읽는 법 세 가지:

- **스텝 레일의 마지막 뒤 점선 칸은 스텝이 아니다.** `index == stepCount` 자리이고 `currentStep` 이 `nil` 이 되는 상태다.
- **위로 넘어가는 주황 호가 스킵**이고, **아래로 되돌아오는 빨간 화살표가 역탐색**이다. 방향이 반대인 게 요점이다 — 건너뛴 스텝의 값을 도로 집어온다.
- **가중치 바는 두 겹이다.** 초록이 실제 Available 로 감당되는 몫, 빨강이 확보되지 않았는데 라우팅된 몫이다. 이 빨간 칸이 곧 사고다.

수치는 파일 상단 상수 블록(`REPLICAS`·`MIN_PODS`·`RPS`·`POD_CEIL`)에 있다. `MIN_PODS` 를 바꾸면 ① 단계의 RS 크기와 이후 단계의 "요구 n대 / n대 부족" 문구가 같이 따라간다 — 서로 유도되므로 한 곳만 고치면 된다. **`weight` 와 `cAvail` 은 절대 직접 쓰지 말고 단계 서술에서 유도할 것** — 둘이 어긋나면 빨간 칸이 거짓말을 한다.

**③단계(`phase === 2`)에서 `cDesired`(RS 목표)가 가중치보다 늦게 오르는 건 의도된 순서다 — 되돌리지 말 것.** `reconcileTrafficRouting`(`:57`)이 `reconcileCanaryReplicaSets`(`:75`)보다 앞이므로 한 바퀴 리컨실 안에서 가중치가 먼저 정해지고 RS 목표가 뒤따른다(산문: `content/rollouts/02-rollback-window-weight/index.md`). 그래서 엔진은 `cDesired` 상승을 가중치 전환(`t>0.5`)보다 늦은 `t>0.55`에 놓는다 — `rrev`의 ③→④(해시가 desired 상승보다 먼저 써지는 것)와 같은 원칙이다. `verdict` 의 "요구 n대"도 `cDesired`가 아니라 가중치에서 유도한다(`ceil(REPLICAS×weight/100)`) — 그래야 가중치가 아직 안 바뀐 t 구간에서 캡션이 화면보다 앞서 나가지 않는다. `tools/flow-render/rstep-assert.js` 가 이 순서(가중치 먼저)와 캡션·화면 일치를 단정으로 잡는다.

### `{{< rrev >}}` 의 6단계

"리비전이 바뀌면 트래픽은 어떻게 따라가는가" — **해시가 언제 써지는가**라는 시간축을 보여준다. `rstep` 이 스텝·가중치·가용량·AnalysisRun 을 겹쳐 보이는 것과 달리, `rrev` 는 **층 셋(파드/트래픽/판정)을 항상 띄워두고 그 사이를 흐르는 트래픽 패킷**으로 "지금 몇 %가 어디로 가는가"를 보인다. variant 는 `handoff` 하나뿐이다.

| 단계 | canary RS | stable RS | canary 해시 칩 | stable 해시 칩 | VS weight (stable/canary) | 가드 배너 |
|---|---|---|---|---|---|---|
| ① | 없음 | Available 20/desired 20 · rev N | `hash⟨N⟩` | `hash⟨N⟩` | 100/0 | 없음 |
| ② | 생성됨 · desired 0/Available 0 | 20/20 · rev N | `hash⟨N⟩` | `hash⟨N⟩` | 100/0 | 없음 |
| ③ | desired 0/Available 0 | 20/20 · rev N | `hash⟨N+1⟩` | `hash⟨N⟩` | 100/0 | 없음 |
| ④ | desired 2/Available 0 | 20/20 · rev N | `hash⟨N+1⟩` | `hash⟨N⟩` | 100/0 | **빨강 — 걸림** |
| ⑤ | desired 2/Available 2 | 20/20 · rev N | `hash⟨N+1⟩` | `hash⟨N⟩` | **95/5** | 없음 |
| ⑥ | 이 RS 가 stable 이 된다 | 20/20 · rev N+1 | `hash⟨N+1⟩` | `hash⟨N+1⟩`(재작성) | 100/0 | 없음 |

새 RS 는 `replicas=0` 으로 태어나고(`rollout/sync.go`) canary RS 를 실제로 키우는 코드는 트래픽 리컨실보다 뒤에 있다(`rollout/canary.go`) — 그래서 desired 가 2 로 오르는 것도, Available 이 그 뒤를 따라잡는 것도 해시가 써지는 것보다 늦다. desired 2 는 `ceil(20×5%)=1` 에 `minPodsPerReplicaSet` 하한 2 가 걸린 값이다.

읽는 법 세 가지:

- **가드가 먼저 풀리는 건 ③이지, weight 가 움직이는 건 아니다.** ③은 replicas=0 인 canary RS 를 가드가 건너뛰고 해시만 먼저 써버리는 단계다(`UpdateHash()` 진입부, `rollout/trafficrouting/istio/istio.go`) — subset 은 갈라졌지만 weight 가 아직 0 이라 아무도 그쪽으로 가지 않는다.
- **가드 배너는 ④에서만 보인다.** canary desired 가 2 로 오른 뒤 Available 이 그 목표에 못 미치는 구간이 ④다. 이때 가드가 걸려 그 리컨실의 `SetWeight` 가 실행되지 않는다(`rollout/trafficrouting.go`) — 가드가 막는 것은 해시 쓰기가 아니라 weight 이동이다.
- **⑥은 weight 가 원점(100/0)인데 가리키는 리비전이 바뀐 상태다.** `status.stableRS` 포인터만 옮겨가고(`rollout/sync.go`) 어떤 RS 도 지워지지 않는다 — 그래서 canary 카드는 ①처럼 다시 빈다. stable subset 해시가 canary 와 같아지고(`hash⟨N+1⟩`), stable RS 의 revision 라벨도 `rev N+1` 로 바뀐다. desired 20 은 전 구간 그대로다 — `dynamicStableScale` 미사용.

수치는 파일 상단 상수 블록(`REPLICAS`·`CANARY_STEP_PCT`·`MIN_PODS_PER_RS`·`PACKET_N`·`LOOPS`)에 있다. `REPLICAS` 는 `rstep.js` 와 같은 값(20)을 그대로 쓴다 — 문서 전체에서 예시 수치를 통일하기 위해서다. `CANARY_DESIRED = max(ceil(REPLICAS × CANARY_STEP_PCT / 100), MIN_PODS_PER_RS)` — 지금 값으로는 `ceil(20×5/100)=1` 인데 `MIN_PODS_PER_RS`(2, `rstep.js` 의 `MIN_PODS` 와 같은 값)에 걸려 2 다. 이 둘 중 하나를 바꾸면 ④~⑤ 단계의 canary desired·caption 문구가 같이 바뀐다. `PACKET_N` 은 트래픽 패킷 개수 — `REPLICAS` 와 같은 값(20)이라 canary weight 5% 가 패킷 1개로 깨끗하게 떨어진다. 이 값을 바꾸면 canary weight 가 0 이 아닌 단계에서 canary 로 향하는 패킷 수(`Math.round(PACKET_N × weightCanary / 100)`)가 달라지므로, `rrev-assert.js` 의 단계표 대조와 `port-parity.js` 의 패킷 대조가 함께 검증한다. 리비전은 `rev N`/`rev N+1`, 해시는 `hash⟨N⟩`/`hash⟨N+1⟩` 심볼로만 표기한다 — 실제 값을 발명하지 않는다.

### 구조

```js
PHASE_MS = 2600, PHASE_COUNT = 5   // rstep 3200·6단계, rrev 3000·6단계
computeFrame(phase, t) → Frame      // (단계, 0~1 진행률)의 순수 함수. rstep·rrev 는 (variant, phase, t) — variant 가 하나뿐인 rrev 도 이식 모듈과 서명을 맞추려고 그렇게 뒀다
```

**파티클 배열을 들고 있지 않는 게 핵심이다.** 매 프레임 `(phase, t)`만으로 전체 상태를 다시 계산하고 SVG 속성만 갈아끼운다. 그래서 단계를 넣고 빼거나 순서를 바꿀 때 `computeFrame`의 분기 하나만 손대면 된다. `rrev` 의 트래픽 패킷도 예외가 아니다 — 위치 배열을 들고 있지 않고, 매 프레임 `(phase, t)` 에서 각 패킷의 목표(`target`)와 주기 진행률(`cyc`)을 다시 계산한다.

수치를 바꿀 땐 파일 상단 상수 블록만 고친다 — `bscore`는 가격·파드 수·풀 총계가 서로 맞아떨어져야 하고(`SCORE`가 유도값이라 임계 `0.5`와의 관계가 저절로 정해진다), `mnode`는 `NODES`의 `from`/`to`가 `ratio` 내림차순과 일치해야 정렬 애니메이션이 맞고, `VARIANTS`의 `meterMax`가 그 variant의 총 cost보다 커야 미터가 넘치지 않는다. `rstep`은 스텝 레일 폭이 `STEP_W`(168) × (스텝 수 + 1) + 간격이라 **스텝을 4개 넘게 늘리면 viewBox(940) 를 벗어난다** — 스모크가 잡는다. `rrev`는 카드·띠 x/y 가 모두 `MARGIN`(26)·`GAP`(20) 기준으로 유도돼 있어 카드 하나만 폭을 넓히면 오른쪽 카드들이 viewBox(920)를 벗어난다 — 마찬가지로 스모크가 잡는다.

### 렌더 검증

`rstep`·`rrev` 는 스크립트가 있다 — `node tools/flow-render/rstep-smoke.js static/flow/rstep.js`, `node tools/flow-render/rrev-smoke.js static/flow/rrev.js`. `variant × phase × t` 격자를 훑어 `NaN`·이탈·음수 폭·빈 caption 을 본다. 자세한 건 `tools/flow-render/README.md`.

`bscore`·`mnode` 는 브라우저 없이 확인하려면 최소 DOM 스텁 위에서 rAF 루프를 여러 시점으로 돌려 `NaN`·`undefined` 속성과 viewBox 이탈을 본다. 단계형이라 **한 시점만 보면 안 되고 전 구간을 훑어야** 한다 — 특정 단계에서만 음수 `width`가 나오는 식으로 깨진다. 숨겨진(`opacity="0"`) 요소는 범위 검사에서 빼되, **좌표 자체는 항상 유효하게** 둘 것.

한 가지 함정: 프레임 루프의 시작 시각을 `if (!t0) t0 = ts` 로 잡으면 **첫 타임스탬프가 정확히 0일 때 영영 안 걸린다.** 브라우저의 `ts`는 0이 아니라 안 드러나지만, 시계를 주입해 테스트하거나 스크럽을 붙이면 바로 터진다. `t0 = -1` 로 두고 `if (t0 < 0)` 로 검사한다.

---

## 작성 요령

- **본문을 도식으로 대체한다.** 단계가 3개 이상이면 산문보다 flow가 짧고 정확하다. 도식을 넣었으면 같은 내용을 다시 서술하지 말 것.
- **`caption`이 본문 역할을 한다.** 도식이 무엇을 말하는지 한 문장으로.
- **`rate`로 부하 차이를 표현한다.** 같은 그림에서 `rate: 380`과 `rate: 900`은 "이쪽이 훨씬 자주"를 색 없이 전달한다.
- **인라인은 본문 폭에 맞춰 축소**되고, 우상단 "크게 보기"로 전체화면 확대된다. 넓은 도식도 넣을 수 있지만 인라인 가독성은 스스로 확인할 것.
- 렌더 확인: `hugo server` 또는 `hugo --gc --minify` 후 `public/<경로>/index.html`.

---

## 검증 스크립트

```
./tools/flow-render/run.sh
```

여섯 겹이다. **스크립트나 스펙을 고쳤으면 전부 돌린다.**

| 스크립트 | 무엇을 보나 |
|---|---|
| `rstep-smoke.js` | 좌표·`NaN`·viewBox 이탈·음수 폭·빈 caption. variant × phase × t 격자를 훑는다 |
| `rstep-assert.js` | **그림이 참말을 하나.** 빨간 칸은 `rollback`에서만, 역탐색 화살표는 `promote`에서 안 나오고, `요구 n대`가 `ceil(replicas × w / 100)`과 일치하는지, ③단계에서 가중치 전환이 `cDesired` 상승보다 먼저인지, `verdict`·`gate` 문구 수치가 그 시점 화면과 어긋나지 않는지 |
| `rrev-smoke.js` | 좌표·`NaN`·viewBox 이탈·음수 폭·빈 caption. phase × t 격자를 훑는다 (variant 는 `handoff` 하나) |
| `rrev-assert.js` | **그림이 참말을 하나.** 6단계 전부에서 canary/stable 의 Available·desired·해시 칩·VS weight·가드 유무가 단계표 리터럴과 정확히 일치하는지, canary weight 가 0인 단계에서 canary 패킷이 도달하지 않는지, 캡션이 단계마다 다른지 등 |
| `port-parity.js` | 앞 넷과 달리 "도식이 참말을 하나"가 아니라 **"Hugo 엔진과 nextra 이식 모듈이 같은 그림을 내는가"**를 본다(rstep·rrev 각각) — `tools/flow-render/README.md`, `nextra-port/README.md` 참고 |
| `spec-lint.js` | `flow`·`seq` JSON. group `id` 누락, 없는 `kind`/`layer`, 엣지 끝점 오타, 가로 라벨 폭 초과, `token: true`인데 시작 노드 없음. 그다음 실제 엔진을 태워 렌더 좌표까지 본다 |

`rstep-assert.js`·`rrev-assert.js` 가 이 여섯 중 **의미**를 보는 둘이다. 좌표가 멀쩡해도 도식이 거짓말을 할 수 있다 — 가중치와 요구 파드 수를 각각 손으로 적어 두면 둘이 어긋나고, 그러면 독자는 틀린 수치를 읽는다. 그래서 단계 서술에서 유도하고, 유도가 맞는지 이 스크립트들이 검사한다.

**검사기를 고쳤으면 일부러 깨뜨려 FAIL이 나는지 확인할 것.** 통과만 보고 믿으면 안 된다 — 필드 이름을 바꾼 뒤 `sed` 패턴이 안 맞아 negative 테스트가 조용히 no-op이 된 적이 있다.
