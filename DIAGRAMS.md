# 도식 shortcode 레퍼런스

이 레포는 자체 도식 엔진 두 개를 쓴다. **mermaid가 아니다.**

| shortcode | 용도 | 엔진 |
|---|---|---|
| `{{< flow >}}` | 노드·엣지 흐름도 (파티클 애니메이션) | `static/flow/flow.js`, `static/flow/flow.css` |
| `{{< seq >}}` | 시퀀스 다이어그램 | `static/seq/seq.js` |

둘 다 `layouts/partials/custom/head-end.html`에서 로드된다. 본문에는 JSON 스펙만 쓴다.

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

`static/seq/seq.js`. 사용처는 `content/` 에서 `{{< seq` 로 검색.

---

## 작성 요령

- **본문을 도식으로 대체한다.** 단계가 3개 이상이면 산문보다 flow가 짧고 정확하다. 도식을 넣었으면 같은 내용을 다시 서술하지 말 것.
- **`caption`이 본문 역할을 한다.** 도식이 무엇을 말하는지 한 문장으로.
- **`rate`로 부하 차이를 표현한다.** 같은 그림에서 `rate: 380`과 `rate: 900`은 "이쪽이 훨씬 자주"를 색 없이 전달한다.
- **인라인은 본문 폭에 맞춰 축소**되고, 우상단 "크게 보기"로 전체화면 확대된다. 넓은 도식도 넣을 수 있지만 인라인 가독성은 스스로 확인할 것.
- 렌더 확인: `hugo server` 또는 `hugo --gc --minify` 후 `public/<경로>/index.html`.
