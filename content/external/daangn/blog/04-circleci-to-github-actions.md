---
title: "GitHub Actions 이전과 Docker 캐시로 배포 시간을 줄인 과정"
description: "당근 karrot-cs의 CI/CD 이전 사례입니다. 캐시 저장소를 추가하고 Dockerfile의 커밋 ID·소스 복사 순서를 바꿔, 캐시를 재사용하는 배포를 약 2분으로 줄였습니다."
date: 2026-10-21
weight: 9
---

# GitHub Actions 이전과 Docker 캐시로 배포 시간을 줄인 과정 (2022-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [CircleCI에서 GitHub Actions로 이전하며 배포 속도 개선하기](https://medium.com/daangn/circleci%EC%97%90%EC%84%9C-github-actions%EB%A1%9C-%EC%9D%B4%EC%A0%84%ED%95%98%EB%A9%B0-%EB%B0%B0%ED%8F%AC-%EC%86%8D%EB%8F%84-%EA%B0%9C%EC%84%A0%ED%95%98%EA%B8%B0-39fc41617993)
- 매체 · 게시일: Medium 당근 블로그 · 2022-09-20
- 저자: Seungwook Seo (Wade, 당근마켓 운영개발팀 인턴 서버 개발자). SRE팀 클러스터 파트 글이 아닙니다.
- 근거: 블로그 본문 (본문에 삽입된 코드 조각과 이미지는 확인하지 않았습니다)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 매번 처음부터 빌드하던 karrot-cs {#캐시-없이-반복하던-빌드}

스팸·신고·문의를 처리하는 어드민 툴 karrot-cs는 배포에 15분 넘게 걸리기도 했습니다. workflow마다 새 머신에서 `docker build`를 실행해, 이전 빌드의 layer cache를 재사용하지 못했습니다.

CI 도구도 배포 대상에 따라 달랐습니다. 캐나다·일본의 alpha 테스트 서버는 GitHub Actions를, 한국 alpha와 각국 운영 배포는 CircleCI를 사용했습니다. 팀은 코드와 CI를 GitHub에서 함께 확인하기 편하다는 점과 사내 다른 프로젝트의 도입 흐름을 고려해 GitHub Actions로 통합하면서 캐시도 적용했습니다.

## 캐시를 저장해도 precompile이 반복된 이유 {#캐시-저장소와-dockerfile-실행-순서-변경}

팀은 별도 설정 없이 사용할 수 있고 API로 관리하기 쉬운 GitHub Actions Cache를 저장소로 골랐습니다. Docker의 `build-push-action`에 `cache-from`, `cache-to`를 지정하고, `github-script`로 최근 100개만 남기도록 캐시를 정리했습니다.

캐시를 적용한 뒤에도 빌드는 6분 넘게 걸렸습니다. Dockerfile의 `ARG git_commit_id`에서 캐시가 무효화돼 이후 단계를 다시 실행했고, 그중 `rails assets:precompile`에 약 5분이 들었습니다.

커밋 ID를 받는 줄을 precompile 뒤로 옮기고, precompile에 필요한 소스만 앞에서 `ADD`했습니다. 전체 소스는 그 뒤에 추가했습니다. 이 순서라면 precompile과 무관한 코드만 바뀌었을 때 해당 단계의 캐시를 재사용할 수 있습니다.

## 캐시와 실행 순서 변경 후의 배포 시간 {#배포-시간과-적용-범위}

Docker layer caching을 적용하면서 빌드 시간을 약 8분 줄였습니다. Dockerfile 순서까지 조정한 뒤에는 precompile까지 캐시를 재사용하는 배포가 약 2분에 끝났습니다. 동일한 yml을 한국을 포함한 나머지 리전의 모든 배포에 적용하고 정상 동작을 확인했습니다. 단계별 시간은 아래 표에 남겼습니다.

## 약 2분 배포가 가능한 변경 범위 {#캐시-효과의-조건과-남은-개선점}

precompile까지의 캐시를 재사용하려면 그 단계에 필요한 소스가 바뀌지 않아야 합니다. 모든 배포가 같은 시간에 끝난다는 의미는 아닙니다. 저자는 인턴 마지막 과제로 작업을 진행했으며, 캐시 정리 코드 등에 개선 여지가 남았다고 설명했습니다.

빌드 시간을 포함해 팀의 배포 절차를 바꾼 사례는 [매일 배포하는 팀이 되는 여정(1)]({{< relref "/external/daangn/blog/05-daily-deploy-branch-strategy.md" >}})에서 이어서 읽을 수 있습니다.

{{% details title="근거와 세부 수치" closed="true" %}}

| 단계 | 소요 시간 | 비고 |
|---|---|---|
| 캐시 적용 전 캐나다 alpha 배포(GitHub Actions) | 15분 6초 | layer cache 없음 |
| Docker layer caching 적용 후 | 약 8분 단축, 빌드 6분 이상 남음 | GitHub Actions Cache 사용 |
| `rails assets:precompile` | 약 5분 | `ARG git_commit_id` 이후 캐시 미스 |
| Dockerfile 순서 조정 후 | 약 2분 | 원문 표현은 "배포속도가 약 2분까지" |

{{% /details %}}
