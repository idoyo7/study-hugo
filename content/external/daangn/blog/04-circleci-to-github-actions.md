---
title: "CircleCI에서 GitHub Actions로 이전하며 배포 속도 개선하기"
description: "당근 운영개발팀 인턴이 어드민 툴 karrot-cs의 CI/CD를 CircleCI에서 GitHub Actions로 옮기며 Docker layer caching과 Dockerfile 순서 조정으로 배포 시간을 줄인 과정의 요약입니다. 15분이 넘던 배포가 약 2분까지 내려갔습니다."
date: 2026-10-21
weight: 4
---

# CircleCI에서 GitHub Actions로 이전하며 배포 속도 개선하기 (2022-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [CircleCI에서 GitHub Actions로 이전하며 배포 속도 개선하기](https://medium.com/daangn/circleci%EC%97%90%EC%84%9C-github-actions%EB%A1%9C-%EC%9D%B4%EC%A0%84%ED%95%98%EB%A9%B0-%EB%B0%B0%ED%8F%AC-%EC%86%8D%EB%8F%84-%EA%B0%9C%EC%84%A0%ED%95%98%EA%B8%B0-39fc41617993)
- 매체 · 게시일: Medium 당근 블로그 · 2022-09-20
- 저자: Seungwook Seo (Wade, 당근마켓 운영개발팀 인턴 서버 개발자). SRE팀 클러스터 파트 글이 아닙니다.
- 근거: 블로그 본문 (본문에 삽입된 코드 조각과 이미지는 확인하지 않았습니다)
- 이 문서는 원문을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## 캐시 없이 반복하던 빌드

스팸 처리와 신고, 문의를 다루는 어드민 툴 karrot-cs는 배포에 15분이 넘게 걸리기도 했습니다. workflow마다 새 머신에서 `docker build`를 실행하면서 layer cache 없이 이미지를 처음부터 빌드했기 때문입니다.

배포 도구도 나뉘어 있었습니다. 캐나다·일본의 alpha(테스트 서버) 배포는 GitHub Actions를, 한국 alpha와 각국 운영 배포는 CircleCI를 썼습니다. 코드를 관리하는 GitHub에서 CI까지 확인하기 편하고 사내 다른 프로젝트도 GitHub Actions를 선택하는 추세여서, 이전하면서 캐시도 적용하기로 했습니다.

## 캐시 저장소와 Dockerfile 실행 순서 변경

layer cache 저장소로는 별도 설정이 필요 없고 API로 관리하기 쉬운 GitHub Actions Cache를 골랐습니다. Docker의 `build-push-action`에 `cache-from`, `cache-to`를 붙이고, 캐시가 쌓이지 않도록 `github-script`로 최근 100개만 남기고 나머지를 비우게 했습니다.

캐시를 적용해도 빌드는 6분 넘게 걸렸습니다. Dockerfile을 보니 `ARG git_commit_id`에서 캐시 미스가 나 이후 단계를 모두 다시 실행하고 있었습니다. 그중 `rails assets:precompile`이 약 5분을 차지했습니다.

커밋 ID를 받는 줄을 precompile 뒤로 옮겼습니다. precompile에 필요한 소스만 먼저 `ADD`하고, 전체 소스는 precompile 뒤에 추가했습니다. 이렇게 하면 precompile과 무관한 코드만 바뀐 배포에서는 이 단계까지 캐시를 쓸 수 있습니다.

## 배포 시간과 적용 범위

Docker layer caching만 적용했을 때 빌드 시간이 약 8분 줄었고, Dockerfile 순서까지 바꾼 뒤 precompile 단계까지 캐시가 적용된 배포는 약 2분 수준으로 줄었습니다. 같은 yml을 한국을 포함한 나머지 리전의 모든 배포에 적용해 정상 동작을 확인했습니다.

## 캐시 효과의 조건과 남은 개선점

캐시 이득은 precompile에 쓰이지 않는 코드만 바뀐 배포에서만 납니다. 저자는 인턴 마지막 과제로 이 작업을 진행했고, 캐시 비우기 코드 등에는 개선 여지가 남아 있다고 적었습니다.

배포 속도를 팀 단위 흐름으로 다룬 글은 [매일 배포하는 팀이 되는 여정(1)]({{< relref "/external/daangn/blog/05-daily-deploy-branch-strategy.md" >}})에 있습니다.

{{% details title="근거와 세부 수치" closed="true" %}}

| 단계 | 소요 시간 | 비고 |
|---|---|---|
| 캐시 적용 전 캐나다 alpha 배포(GitHub Actions) | 15분 6초 | layer cache 없음 |
| Docker layer caching 적용 후 | 약 8분 단축, 빌드 6분 이상 남음 | GitHub Actions Cache 사용 |
| `rails assets:precompile` | 약 5분 | `ARG git_commit_id` 이후 캐시 미스 |
| Dockerfile 순서 조정 후 | 약 2분 | 원문 표현은 "배포속도가 약 2분까지" |

{{% /details %}}
