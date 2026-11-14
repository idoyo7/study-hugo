---
title: "200여 개 서비스 모노레포의 파이프라인 최적화"
description: "토스 프론트엔드 챕터가 40GB가 넘는 모노레포에서 git push부터 배포까지 5분을 유지하는 방법을 정리했습니다. 병렬 빌드, 매일 굽는 Docker 베이스 이미지, SSR standalone 이미지 세 가지를 다룹니다."
date: 2026-11-14
weight: 3
---

# 200여 개 서비스 모노레포의 파이프라인 최적화 (2024-06)

{{< callout type="info" >}}
**원문 정보**
- 원문: [200여개 서비스 모노레포의 파이프라인 최적화](https://toss.tech/article/monorepo-pipeline)
- 매체 · 게시일: 토스 기술 블로그 · 2024-06-14
- 저자: 정석호
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 거대해진 프론트엔드 모노레포 {#monorepo-background}

토스 프론트엔드 챕터는 하나의 모노레포에서 200여 개가 넘는 서비스를 관리합니다. 기여자는 50~60명이고 하루에 머지되는 PR은 평균 60개를 넘습니다. 저장소가 계속 커진 끝에 그냥 클론하는 것조차 어려워져서, 필요하기 전까지 blob을 받지 않는 `filter=blob:none`을 자주 씁니다.

그런데도 `git push`부터 배포까지 5분을 유지하고 있고, 원문은 그 방법을 세 가지로 소개합니다.

## 독립된 환경에서 병렬로 빌드하기 {#parallel-build}

모노레포에서는 여러 서비스가 동시에 바뀌는 일이 잦습니다. 토스는 개발, 스테이징, 라이브 환경을 따로 빌드하므로 빌드 횟수는 변경된 서비스 수에 환경 수를 곱한 만큼입니다. 쇼핑, 송금, 만보기 세 서비스가 바뀌면 9번이고, 빌드 하나가 5분이면 순차 실행에 45분이 걸립니다. 기다리는 동안 개발자는 컨텍스트 스위칭 비용을 치릅니다.

yarn의 `yarn workspace since run --jobs` 옵션으로 병렬 실행을 할 수 있지만, 한 컴퓨팅 환경 안에서는 CPU와 메모리를 나눠 쓰게 됩니다. 병렬 수를 늘릴수록 오히려 느려지고, 빌드 대상이 많으면 순차 실행과 비슷해집니다.

토스는 빌드마다 독립된 환경을 주는 쪽으로 파이프라인을 고쳤습니다. CircleCI의 Dynamic Configuration으로 변경된 서비스마다 파이프라인을 동적으로 만들고, 각 파이프라인은 자원이 따로 할당된 가상 머신에서 돕니다. 이상적인 경우 서비스가 2개든 200개든 트리거 파이프라인 1분에 병렬 파이프라인 5분, 약 6분이면 끝납니다. 다만 러너를 무한정 늘릴 수는 없으니 최대 러너 수를 조절해 비용을 지켜야 한다고 원문은 덧붙입니다. 2개 서비스가 바뀐 경우 30분에서 6분으로, 약 5배 줄었습니다. CircleCI뿐 아니라 Jenkins로도 같은 구성이 가능하다고 합니다.

## 매일 굽는 Docker 베이스 이미지 {#daily-base-image}

모노레포는 40GB를 훌쩍 넘어서, 러너가 빌드할 때마다 checkout하면 매우 오래 걸리거나 타임아웃이 납니다. 해법은 모노레포를 미리 복제해 둔 Docker 이미지를 쓰는 것입니다. 이 방법은 2022년 SLASH 발표에서도 짧게 다룬 내용입니다.

Dockerfile은 먼저 `git clone --depth 50`으로 가볍게 받고, 변경 계산에 충분하도록 `git fetch --depth 1000`으로 1,000개 커밋까지 이어 받습니다. 그다음 main 브랜치로 checkout하고 `yarn`으로 의존성까지 설치해 둡니다. 이 빌드를 매일 오전 7시에 돌리며 36분이 걸립니다. 만든 이미지는 AWS ECR에 올리고 CircleCI executor로 지정해 Job을 실행합니다. 미리 받아 둔 뒤 변경분만 내려받는 데는 22초가 듭니다. `git checkout`이 필요한 Job마다 약 36분을 아끼는 셈입니다.

## SSR standalone Docker 이미지 {#ssr-standalone}

세 번째는 SSR 배포 시간을 줄이는 방법으로, 이것도 2022년 SLASH에서 소개한 내용입니다. Node File Trace로 런타임에 필요한 의존성만 추려 최소한의 JavaScript 파일로 빌드 환경을 만들면 Docker 빌드와 Kubernetes 배포가 빨라집니다. Next.js는 `next.config.js`의 `output: 'standalone'`으로 이 아이디어를 제공합니다.

문제는 이 기능이 `node_modules` 디렉터리에 기대고 있다는 점이었습니다. 토스는 Yarn PnP를 써서 의존성이 `.yarn/cache`에 있으므로 그대로 쓸 수 없었습니다. 그래서 PnP API로 standalone과 비슷한 일을 하는 함수를 직접 만들어 `bundle.zip`을 생성합니다. SSR Dockerfile은 이 zip을 풀어 `node -r ./.pnp.cjs --experimental-loader ./pnp.loader.mjs ./server.js`로 서버를 띄웁니다. bundle.zip만 있으면 git과 yarn이 없는 곳에서도 SSR 서버를 실행할 수 있습니다.

이미지 크기는 4GB에서 약 200MB로 20배가량 줄었습니다. 이미지가 작아지면 Kubernetes에서 Pod를 띄울 때 이미지를 pull하는 PodInitializing 시간이 줄어듭니다.

## 최적화 결과 {#result}

- 병렬화: 배포 시간 5배 개선
- Daily Docker Base Image: Job당 36분 이상 개선
- SSR Standalone Docker Image: Pod 뜨는 시간 20배 개선

{{% details title="세부 수치와 설정 조건" closed="true" %}}

| 항목 | 값 |
|---|---|
| 모노레포 규모 | 서비스 200여 개, 기여자 50~60명, 일평균 머지 PR 60개 이상, 저장소 40GB 이상 |
| 빌드 횟수 | 변경된 서비스 수 x 환경 수(개발, 스테이징, 라이브) |
| 순차 빌드 예시 | 3개 서비스 x 3개 환경 x 5분 = 45분 |
| 병렬 빌드 이상값 | 트리거 파이프라인 1분 + 병렬 파이프라인 5분 |
| 2개 서비스 변경(6개 배포) | AS-IS 6 x 5 = 30분, TO-BE 1 + 5 = 6분 |
| 베이스 이미지 빌드 | 매일 오전 7시, 36분 소요 |
| clone 깊이 | `--depth 50` 이후 `--depth 1000` |
| 변경분 내려받기 | 36분에서 22초 |
| SSR 이미지 크기 | 4GB에서 약 200MB |

{{% /details %}}
