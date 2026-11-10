---
title: "CI·모노레포·개발자 도구"
description: "우버 엔지니어링 블로그의 CI·모노레포·개발자 도구 글 22편 목록입니다. 2020년 이후 글 20편은 한국어 요약으로, 나머지는 원문 링크로 정리했습니다."
date: 2026-11-10
weight: 7
comments: false
---

# CI·모노레포·개발자 도구

## 이 분류에서 찾기 {#section-navigation}

- [수백 개 자동화 시스템의 모노레포 관리를 맡은 GitFarm (2026-07)]({{< relref "/external/uber/devx/gitfarm-as-a-service.md" >}})
- [SaaS 원본을 매번 확인하는 우버의 아티팩트 검증 프록시 (2026-05)]({{< relref "/external/uber/devx/modernizing-artifact-storage.md" >}})
- [중요한 서비스를 기다리게 하는 Uber의 모노레포 배포 (2025-08)]({{< relref "/external/uber/devx/controlling-the-rollout-of-large-scale-monorepo-changes.md" >}})
- [끝까지 돌릴 빌드를 다시 고른 Uber의 SubmitQueue (2025-06)]({{< relref "/external/uber/devx/slashing-ci-costs-at-uber.md" >}})
- [모노레포의 수천 마이크로서비스를 자동 배포로 옮긴 Up CD (2024-08)]({{< relref "/external/uber/devx/continuous-deployment.md" >}})
- [프로덕션을 나눠 E2E 테스트를 앞당긴 Uber의 BITS (2024-08)]({{< relref "/external/uber/devx/shifting-e2e-testing-left.md" >}})
- [프로덕션 이웃 곁에서 코드를 멈춰 보는 SLATE 디버깅 (2024-06)]({{< relref "/external/uber/devx/debugging-with-production-neighbors.md" >}})
- [재시도로 버티던 CI를 바꾼 우버의 Testopedia (2024-06)]({{< relref "/external/uber/devx/flaky-tests-overhaul.md" >}})
- [9천만 줄 Go 코드의 nil panic을 추적하는 NilAway (2023-11)]({{< relref "/external/uber/devx/nilaway-practical-nil-panic-detection-for-go.md" >}})
- [부하 테스트 전에 환경 간 RPC를 찾는 CheckEnv (2023-09)]({{< relref "/external/uber/devx/checkenv.md" >}})
- [도착 순서의 제약을 풀어낸 SubmitQueue의 BLRD (2023-08)]({{< relref "/external/uber/devx/bypassing-large-diffs-in-submitqueue.md" >}})
- [모노레포 개발을 노트북 밖으로 옮긴 Uber의 Devpod (2022-12)]({{< relref "/external/uber/devx/devpod-improving-developer-productivity-at-uber.md" >}})
- [끝나지 않는 Go 고루틴의 기다림을 찾는 LeakProf (2022-11)]({{< relref "/external/uber/devx/leakprof-featherlight-in-production-goroutine-leak-detection.md" >}})
- [운영 의존성을 그대로 쓰는 Uber의 임시 테스트 공간 SLATE (2022-10)]({{< relref "/external/uber/devx/simplifying-developer-testing-through-slate.md" >}})
- [수천 마이크로서비스의 빌드를 떠받치는 Uber의 uBuild (2022-10)]({{< relref "/external/uber/devx/ubuild-fast-and-safe-building-of-thousands-of-container-images.md" >}})
- [큰 변경에 막힌 Go 모노레포 대기열을 줄인 Uber CI (2022-06)]({{< relref "/external/uber/devx/how-we-halved-go-monorepo-ci-build-time.md" >}})
- [잠그고 기다려도 놓치기 쉬운 우버 Go 코드의 데이터 레이스 (2022-06)]({{< relref "/external/uber/devx/data-race-patterns-in-go.md" >}})
- [PR을 막지 않고 Go 데이터 레이스를 찾아내는 Uber (2022-04)]({{< relref "/external/uber/devx/dynamic-data-race-detection-in-go-code.md" >}})
- [조금씩 열고 빠르게 되돌리는 Uber의 설정 시스템 Flipr (2021-04)]({{< relref "/external/uber/devx/flipr.md" >}})
- [커지는 우버 Go 모노레포에 맞춰 고친 빌드 공장 Bazel (2020-05)]({{< relref "/external/uber/devx/go-monorepo-bazel.md" >}})

모노레포 CI·배포, 빌드, 테스트 인프라, 원격 개발 환경, Go 정적·동적 분석처럼 개발과 배포 흐름을 다루는 글입니다.

## 요약하지 않은 원문 {#original-only}

2019년 이전 글이거나 아직 요약하지 않은 글입니다. 원문 제목 그대로 링크합니다.

- [Building Automated Feature Rollouts on Robust Regression Analysis](https://www.uber.com/us/en/blog/autonomous-rollouts-regression-analysis/) · 2018-07-17
- [Uber Engineering’s Micro Deploy: Deploying Daily with Confidence](https://www.uber.com/us/en/blog/micro-deploy-code/) · 2016-06-23
