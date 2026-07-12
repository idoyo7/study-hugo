# study-hugo — Ops Insights (Hugo 버전)

운영 인사이트 KB의 Hugo(hugo-book 테마) 프로토타입. study-starlight / study-nextra와 동일 콘텐츠를 Hugo로 렌더한다.

## 구조

- `content/docs/monitoring/` — 모니터링 도메인
  - `victoriametrics/` — VictoriaMetrics 내부·운영 (블록 9)
  - `longterm-retention/` — 메트릭 400일 보관 아키텍처 (블록 9)
- 내부 링크는 Hugo `{{< relref >}}` 셔ート코드, 사이드바는 front matter `weight`로 정렬.

## 로컬 미리보기

```bash
hugo server   # http://localhost:1313
```

## 빌드 / 배포

```bash
hugo --gc --minify   # 결과: public/
```

`Dockerfile`은 hugo 빌드 → nginx 정적 서빙(study-nextra와 동일 패턴).

## 테마

`themes/hugo-book` ([alex-shpak/hugo-book](https://github.com/alex-shpak/hugo-book)) 벤더링.
