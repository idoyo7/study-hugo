# study-hugo — Ops Insights

Kubernetes·관측성·데이터스토어를 직접 운영하며 남은 판단 근거를 도메인 단위로
정리한 지식베이스. 176개 문서, 17개 도메인.

- 운영 사이트: https://docs.makgol.com
- 테마: [hextra](https://github.com/imfing/hextra) v0.12.3 (`themes/hextra/` 벤더링)

## 구조

```
content/            도메인별 문서. 섹션 = 디렉터리, 정렬 = front matter weight
layouts/
  _markup/          마크다운 렌더 훅 (이미지: WebP 변환 + width/height)
  partials/         테마 오버라이드 (opengraph, twitter_cards, search,
                    page-description) + custom/ (JSON-LD, 근거 배지, 도식 로더)
  robots.txt        robots.txt 템플릿 (Sitemap 줄을 baseURL 에서 뽑는다)
  404.html          섹션 목록이 있는 404
assets/images/      본문 이미지. Hugo 이미지 파이프라인 대상이라 WebP 가 생성된다
static/flow/        도식 엔진 7종 (flow·seq·cfstl·bscore·mnode·rstep·rrev)
nginx/default.conf  정적 서빙 설정 (gzip_static, Cache-Control, error_page)
```

내부 링크는 Hugo `{{< relref >}}` 숏코드를 쓴다.

## 로컬 미리보기

```bash
hugo server            # http://localhost:1313
hugo --gc --minify     # 결과: public/  (Dockerfile 과 같은 명령)
```

Hugo **extended** 0.164.0 이 필요하다. 이미지 처리(WebP)가 extended 빌드에만
있고, `Dockerfile` 도 같은 버전을 고정한다.

## 배포

`Dockerfile` 이 hugo 빌드 → 텍스트 자산 사전 압축(gzip -9) → nginx 정적 서빙.
CI(`.github/workflows/docker-build-push.yml`)가 GHCR 에 이미지를 올리고
`idoyo7/montstrap-manifest` 의 `hub/study-hugo/kustomization.yaml` 태그를
갱신하면 ArgoCD 가 받는다.

`enableGitInfo` 때문에 CI checkout 은 `fetch-depth: 0` 이어야 한다 — 얕은
클론에서는 모든 문서의 수정일이 한 날짜로 붕괴한다.

## 도식 엔진

`static/flow/` 의 7종은 직접 만든 애니메이션 다이어그램 엔진이다. 문서에서
`{{< flow >}}` 같은 숏코드로 부르고, `layouts/partials/custom/head-end.html`
이 그 문서가 실제로 쓰는 엔진만 골라 싣는다. 자세한 건 `DIAGRAMS.md`.
