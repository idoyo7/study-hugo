# 변경 이력

문서 구조와 공통 동작이 바뀐 작업을 기록합니다. 개별 글의 수정 내역은 Git 이력을 확인합니다.

## 2026-10-04 — 문서 분류 개편

관련 PR: [#32](https://github.com/idoyo7/study-hugo/pull/32)

- 최상위 22개 주제를 플랫폼·인프라 / 관측성 / 데이터·스토리지 / 설계·개발의 4개로 통합했습니다.
- Istio·Karpenter·ClickHouse의 긴 문서 목록을 하위 주제로 나누고, HyperDX·VictoriaMetrics·Valkey의 관련 시리즈를 한 부모 아래로 모았습니다.
- 기존 문서와 도식, 공개 URL·별칭을 보존하고 내부 참조를 새 파일 위치로 갱신했습니다.
- 모바일·데스크톱 사이드바는 최대 5단계를 표시하며 이전·다음 문서는 같은 부모 안에서 연결합니다.
- PR에 Hugo 빌드와 내부 링크·내비게이션 회귀 검증을 추가했습니다.

[상세 변경 기록](docs/changes/2026-10-04-content-navigation.md) · [전체 경로 대응표](docs/changes/2026-10-04-content-navigation.csv)
