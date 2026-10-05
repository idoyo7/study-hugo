# 변경 이력

문서 구조와 공통 동작이 바뀐 작업을 기록합니다. 개별 글의 수정 내역은 Git 이력을 확인합니다.

## 2026-10-05 — 사이드바 접기 버튼

- 데스크톱(768px 이상) 사이드바 아래 메뉴 바, 테마 전환 버튼 오른쪽에 접기 버튼을 추가했습니다. 누르면 사이드바가 3rem 레일만 남기고 접히며, 접힌 동안 문서 트리는 `visibility:hidden`이라 키보드 포커스와 스크린리더에서 빠집니다.
- 상태는 `localStorage`의 `sb-off`에 저장하고 `<html data-sb-off>`로 표현합니다. 첫 페인트 전에 적용하는 인라인 한 줄을 `head-end.html`에 두어 접힌 채로 연 페이지가 펼쳐졌다 접히지 않게 했고, 저장소 접근이 막혀도 try/catch로 펼친 상태로 동작합니다.
- 버튼 동작은 캐시되는 `static/js/sidebar-collapse.js`로 분리했습니다. 페이지당 HTML은 약 600바이트 늘었습니다(대표 3개 페이지 실측은 커밋 설명 참고). 모바일 햄버거 메뉴와 `themes/hextra` 파일은 건드리지 않았습니다.
- 접힌 레일에는 펼치기 버튼만 남기므로 접은 채로는 테마를 바꿀 수 없습니다(의도한 설계, 펼친 뒤 전환). 접힌 상태로 연 페이지에서 `defer` 스크립트가 실행되기 전(또는 로드 실패 시)에는 버튼의 `aria-expanded`·라벨이 "접기"로 남을 수 있습니다. 접힘 규칙은 정상 사이드바(`hx:md:sticky`)에만 걸려, 사이드바가 꺼진 페이지의 placeholder 폭은 바뀌지 않습니다.
- `tools/check-content-navigation.py`의 baseline 비교가 지문 해시만 바뀐 번들(`/css/compiled/main.min.<해시>.css`)을 사라진 자산으로 보고 CI를 실패시켰습니다. `custom.css`를 바꾸면 번들 해시가 바뀌는 것이 정상 동작이라(HTML은 `max-age=0`, 해시 파일은 immutable) 같은 디렉터리·stem·확장자에 해시만 다른 파일이 있으면 통과시키고, 대응 파일이 없으면 지금처럼 실패합니다. 새 HTML의 깨진 참조는 기존대로 별도로 잡습니다.
- 문구는 `i18n/ko.yaml`의 `sidebarCollapse`·`sidebarExpand`, 스타일은 `assets/css/custom.css`에 있습니다. `prefers-reduced-motion`이면 전환 애니메이션이 없습니다.

## 2026-10-05 — 도식 사용 가이드

관련 PR: [#35](https://github.com/idoyo7/study-hugo/pull/35)

- 도식을 넣을지, 몇 장으로 나눠 어떤 엔진으로 그릴지, 그린 뒤 무엇을 확인할지를 정하는 가이드를 저장소 루트에 추가했습니다.
- 크기 기준값은 엔진 상수, 본문 폭 실측(데스크톱 638px), 기존 도식 203개의 집계에서 가져왔습니다. 기존 도식을 일괄 수정하지 않고 새로 그리거나 그 글을 고칠 때 적용합니다.
- README·DIAGRAMS.md·CLAUDE.md에 가이드로 가는 링크를 추가했습니다. DIAGRAMS.md의 필드와 상수 설명은 그대로입니다.
- 첫 적용으로 homelab 04편을 구조 중심으로 줄이고 도식을 이 가이드 기준으로 다시 그렸습니다(3장 → flow 3장, seq 2장). 과정은 가이드 11절에 적었습니다.

[도식 사용 가이드](DIAGRAM-GUIDE.md)

## 2026-10-04 — AI 초안 공간과 게시글 작성 흐름 안내

관련 PR: [#34](https://github.com/idoyo7/study-hugo/pull/34)

- 사이트 소개를 모든 문서가 AI로 작성되는 초안·조사 자료 공간이라는 목적에 맞춰 다시 썼습니다.
- 초안 작성 → 근거·조건 확인 → 초안 다듬기 → makgol.com에서 새 게시글 작성 과정을 안내합니다.
- 홈 소개·검색 설명·README·Claude 안내도 같은 취지로 맞췄습니다.

[사이트 소개 원본](content/about.md)

## 2026-10-04 — 문서 분류 개편

관련 PR: [#32](https://github.com/idoyo7/study-hugo/pull/32)

- 최상위 22개 주제를 플랫폼·인프라 / 관측성 / 데이터·스토리지 / 설계·개발의 4개로 통합했습니다.
- Istio·Karpenter·ClickHouse의 긴 문서 목록을 하위 주제로 나누고, HyperDX·VictoriaMetrics·Valkey의 관련 시리즈를 한 부모 아래로 모았습니다.
- 기존 문서와 도식, 공개 URL·별칭을 보존하고 내부 참조를 새 파일 위치로 갱신했습니다.
- 모바일·데스크톱 사이드바는 최대 5단계를 표시하며 이전·다음 문서는 같은 부모 안에서 연결합니다.
- PR에 Hugo 빌드와 내부 링크·내비게이션 회귀 검증을 추가했습니다.

[상세 변경 기록](docs/changes/2026-10-04-content-navigation.md) · [전체 경로 대응표](docs/changes/2026-10-04-content-navigation.csv)
