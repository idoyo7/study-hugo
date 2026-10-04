# 저장소 작업 안내

이 저장소는 Hugo + Hextra로 빌드하는 Ops Insights 기술 문서 사이트입니다.

문서는 AI가 작성하는 초안·조사 자료입니다. 이곳에서 초안을 검토하고 다듬은 뒤,
makgol.com에 주제와 설명의 흐름을 다시 구성한 게시글을 새로 작성합니다.
사이트 소개에서 사람이 직접 집필한 완성 원고나 검토가 끝난 글로 표현하지 마세요.
작성·검토·발행 흐름은 [사이트 소개 원본](content/about.md)에 있습니다.

새 세션에서는 [README.md](README.md)와 [CHANGELOG.md](CHANGELOG.md)를 먼저 읽고,
수정하려는 영역의 최근 변경 기록을 확인하세요. 세션별 메모보다 커밋된 문서와
현재 파일 구조를 기준으로 작업합니다.

- 2026-10-04에 최상위 22개 주제를 `platform`, `observability`, `data`, `engineering`으로 재분류했습니다.
- 기존 문서의 공개 URL은 front matter의 `url`로 유지합니다. `url`과 `aliases`를 파일 위치에 맞춰 임의로 지우거나 바꾸지 마세요.
- 이전 파일 위치는 [경로 대응표](docs/changes/2026-10-04-content-navigation.csv)에서 현재 위치로 찾을 수 있습니다.
- 내부 링크는 `content/` 기준 절대 원본 경로를 쓰는 `relref`로 연결합니다.
- 도식 리소스는 해당 문서의 page bundle과 함께 유지합니다. 도식 규약은 [DIAGRAMS.md](DIAGRAMS.md)에 있습니다.
- 도식을 새로 그리거나 검토할 때는 [DIAGRAM-GUIDE.md](DIAGRAM-GUIDE.md)를 먼저 읽으세요. 도식을 넣을지, 몇 장으로 나눠 어떤 엔진으로 그릴지의 기준이 있습니다.
- 변경 후 README의 Hugo 빌드와 내비게이션 검증을 실행하세요. 새 URL을 추가할 때는 분류 색인에서도 접근할 수 있어야 합니다.

개편 범위·설계 선택·검증 근거: [2026-10-04 분류 개편](docs/changes/2026-10-04-content-navigation.md).
