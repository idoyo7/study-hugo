# 2026-10-04 문서 분류 개편

## 변경 목적

최상위 주제 22개를 나열하던 구조를 4개 대분류로 줄였습니다. 한 화면에서 골라야 하는 항목을 줄이고, 큰 주제는 문서까지 최대 5단계로 나눴습니다. 사용자 요청에 따라 실제 파일 구조와 내부 링크까지 함께 개편했습니다.

| 대분류 | 경로 | 주제 문서 수 | 주요 하위 주제 |
|---|---|---:|---|
| 플랫폼·인프라 | `content/platform/` | 71 | Kubernetes, Istio, Argo Rollouts, 격리 런타임, 홈랩 |
| 관측성 | `content/observability/` | 63 | 메트릭, 로그, APM·RUM, HyperDX |
| 데이터·스토리지 | `content/data/` | 27 | ClickHouse, Redis·Valkey·Memcached, 블록 스토리지, S3 |
| 설계·개발 | `content/engineering/` | 21 | 서비스 아키텍처, 커넥션 게이트웨이, 앱 런타임, AI 도구 |

주제 문서 182개에는 참고 자료와 발표 전사도 포함합니다. 기존 Markdown 219개(주제 문서·색인·홈·소개)를 모두 보존하고 분류 색인 20개를 추가했습니다. 도식 JSON 200개는 내용 변경 없이 문서 번들과 함께 이동했습니다.

## 분류와 탐색

- Kubernetes 아래에 기능·리소스, Karpenter, EKS 업그레이드를 둡니다.
- Istio는 기초·요청 경로 / 설정·확장 / 운영·장애 대응 / Ambient / 버전 변경으로 나눕니다.
- Karpenter는 버전 변경 / 노드 선택·프로비저닝 / 통합·중단 제어 / 관측·비용으로 나눕니다.
- ClickHouse는 도입·구축 / 운영·사례 / 스토리지·레이크하우스로 나눕니다.
- HyperDX의 설계·구축과 실제 운영 기록은 같은 제품 아래의 별도 갈래로 유지합니다.
- VictoriaMetrics의 내부 개념·설계·우리 환경 운영·외부 사례를 한 입구에서 찾습니다.
- Redis·Valkey·Memcached 엔진 비교와 Valkey 운영 사례를 같은 제품군 아래로 모읍니다.
- S3 문서는 대분류에서 바로 연결합니다. 종전 S3 색인 URL도 보존합니다.
- 참고 자료·전사·STT 원문은 주제 색인의 보조 링크와 검색으로 접근합니다. 작성 예정인 APM은 사이드바에서 숨깁니다.

사이드바는 현재 문서의 조상 경로만 펼쳐 렌더링하고, 모바일과 데스크톱에 같은 4개 대분류를 표시합니다. breadcrumb는 실제 부모 계층을 따릅니다. 이전·다음 링크는 현재 부모의 직계 형제로 제한해 대분류 안의 무관한 시리즈로 넘어가지 않게 했습니다.

## URL과 내부 링크 계약

기존 공개 URL은 변경하지 않았습니다. 이동한 기존 문서의 front matter에 `url`을 명시하고 기존 `aliases`를 유지했습니다. 따라서 파일이 `content/platform/istio/...` 아래에 있어도 기존 `/istio/.../` 주소로 열립니다. 새 분류 색인만 `/platform/`, `/observability/` 등의 새 URL을 사용합니다. 이 방식은 외부 링크와 `pathname`으로 연결하는 giscus 댓글의 주소도 유지합니다.

기존 내부 `relref`/`ref` 2,123건은 이동 전 Hugo가 실제 해석한 대상을 추출해 새 원본 경로로 변환했습니다. 이후 홈과 색인에 새 분류 링크를 추가했습니다. 새 링크도 아래처럼 `content/` 기준 절대 원본 경로로 작성합니다.

```go-html-template
{{< relref "/platform/istio/fundamentals/01-mesh-basics/index.md" >}}
```

[전체 경로 대응표](2026-10-04-content-navigation.csv)는 기존 파일 219개 각각의 `old_source`, `new_source`, `original_url`, `aliases`를 기록합니다. 파일을 찾거나 추가 이동을 할 때 이 표와 문서의 `url`을 함께 확인합니다. 별칭 열은 JSON 배열입니다.

## 검증 근거

Hugo extended 0.166.0으로 개편 전 `c97a829`와 개편 후를 별도 디렉터리에 빌드했습니다.

- 기존 219개 Markdown에 현재 파일이 일대일 대응합니다.
- 도식 JSON 200개의 이동 전후 SHA-256이 일치합니다.
- 개편 후 HTML 284개와 생성 경로·리소스 1,402개를 검사했습니다.
- 기존 HTML 264개와 비교해 URL·별칭·참조 리소스가 유지되는 것을 확인했습니다.
- 내부 링크의 경로·앵커, canonical, 모바일·데스크톱의 4개 루트와 깊은 문서의 활성 조상 경로를 검사했습니다.
- 깊은 VictoriaMetrics·Karpenter 문서의 breadcrumb와 직계 형제 pager, 숨김 전사 문서의 부모 경로를 별도로 확인했습니다.

재현 명령:

```bash
hugo --gc --minify --enableGitInfo --destination /tmp/study-hugo-check
python3 -m unittest discover -s tools/tests -p 'test_*.py'
python3 tools/check-content-navigation.py \
  --site-dir /tmp/study-hugo-check \
  --baseline-dir /tmp/study-hugo-before \
  --mapping docs/changes/2026-10-04-content-navigation.csv
```

`--baseline-dir`은 비교할 이전 커밋을 별도 위치에 빌드한 디렉터리입니다. 없으면 생략할 수 있습니다. `Content navigation checks` PR 워크플로는 PR의 base SHA를 별도 worktree에 빌드해 비교합니다. 검증 도구는 Python 표준 라이브러리만 사용합니다.

검사 범위는 생성된 HTML과 자산입니다. 외부 사이트의 응답 상태나 브라우저에서 JavaScript 실행 후 생기는 동작까지 확인하는 검사는 아닙니다.

## 다른 세션에서 이어서 작업하기

저장소 루트의 [CLAUDE.md](../../CLAUDE.md)와 [README.md](../../README.md)가 [CHANGELOG.md](../../CHANGELOG.md) 및 이 기록을 안내합니다. `.omx/`나 개인 세션 메모 없이 커밋된 기록만으로 개편 이유와 파일 위치를 확인할 수 있습니다. 과거 경로를 가진 작업 지시를 받으면 대응표의 `new_source`를 사용합니다.
