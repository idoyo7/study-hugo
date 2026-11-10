---
title: "CI·모노레포·개발자 도구"
description: "우버 엔지니어링 블로그의 CI·모노레포·개발자 도구 글 25편 목록입니다. 2020년 이후 글 23편은 한국어 요약으로, 나머지는 원문 링크로 정리했습니다."
date: 2026-11-10
weight: 7
comments: false
---

# CI·모노레포·개발자 도구

## 이 분류에서 찾기 {#section-navigation}

- [수백 개 자동화 시스템의 모노레포 관리를 맡은 GitFarm (2026-07)]({{< relref "/external/uber/devx/gitfarm-as-a-service.md" >}})
- [SaaS 원본을 매번 확인하는 우버의 아티팩트 검증 프록시 (2026-05)]({{< relref "/external/uber/devx/modernizing-artifact-storage.md" >}})
- [OpenRewrite로 자동화한 우버의 대규모 JUnit 5 이전 (2026-04)]({{< relref "/external/uber/devx/junit-migration.md" >}})
- [서비스 티어를 따라 단계적으로 배포하는 모노레포 대규모 변경 (2025-08)]({{< relref "/external/uber/devx/controlling-the-rollout-of-large-scale-monorepo-changes.md" >}})
- [SubmitQueue의 빌드 우선순위로 줄인 CI 비용 (2025-06)]({{< relref "/external/uber/devx/slashing-ci-costs-at-uber.md" >}})
- [대형 모노레포를 위한 우버의 지속적 배포 Up CD (2024-08)]({{< relref "/external/uber/devx/continuous-deployment.md" >}})
- [머지 전에 도는 E2E 테스트 시스템 BITS (2024-08)]({{< relref "/external/uber/devx/shifting-e2e-testing-left.md" >}})
- [SLATE로 프로덕션 이웃과 함께 하는 디버깅 (2024-06)]({{< relref "/external/uber/devx/debugging-with-production-neighbors.md" >}})
- [Testopedia로 갈아엎은 우버의 불안정 테스트 관리 (2024-06)]({{< relref "/external/uber/devx/flaky-tests-overhaul.md" >}})
- [Go의 nil panic을 잡아내는 정적 분석 도구 NilAway (2023-11)]({{< relref "/external/uber/devx/nilaway-practical-nil-panic-detection-for-go.md" >}})
- [그래프로 찾아내는 환경 간 RPC 호출 CheckEnv (2023-09)]({{< relref "/external/uber/devx/checkenv.md" >}})
- [SubmitQueue에서 큰 변경을 건너뛰는 BLRD (2023-08)]({{< relref "/external/uber/devx/bypassing-large-diffs-in-submitqueue.md" >}})
- [모노레포 개발 루프를 클라우드로 옮긴 Devpod 원격 개발 환경 (2022-12)]({{< relref "/external/uber/devx/devpod-improving-developer-productivity-at-uber.md" >}})
- [운영 환경에서 고루틴 누수를 찾는 가벼운 도구 LeakProf (2022-11)]({{< relref "/external/uber/devx/leakprof-featherlight-in-production-goroutine-leak-detection.md" >}})
- [운영 환경 안에 만드는 임시 E2E 테스트 환경 SLATE (2022-10)]({{< relref "/external/uber/devx/simplifying-developer-testing-through-slate.md" >}})
- [주 10만 건 컨테이너 이미지 빌드를 빠르고 안전하게 처리하는 uBuild (2022-10)]({{< relref "/external/uber/devx/ubuild-fast-and-safe-building-of-thousands-of-container-images.md" >}})
- [큰 변경에 막힌 Go 모노레포 대기열을 줄인 Uber CI (2022-06)]({{< relref "/external/uber/devx/how-we-halved-go-monorepo-ci-build-time.md" >}})
- [잠그고 기다려도 놓치기 쉬운 우버 Go 코드의 데이터 레이스 (2022-06)]({{< relref "/external/uber/devx/data-race-patterns-in-go.md" >}})
- [PR을 막지 않고 Go 데이터 레이스를 찾아내는 Uber (2022-04)]({{< relref "/external/uber/devx/dynamic-data-race-detection-in-go-code.md" >}})
- [모노레포의 Java 불안정 테스트 대응 (2021-06)]({{< relref "/external/uber/devx/handling-flaky-tests-java.md" >}})
- [런타임 컨텍스트로 값이 달라지는 동적 설정 시스템 Flipr (2021-04)]({{< relref "/external/uber/devx/flipr.md" >}})
- [Bazel로 구축한 우버의 Go 모노레포 (2020-05)]({{< relref "/external/uber/devx/go-monorepo-bazel.md" >}})
- [낡은 피처 플래그 코드를 지우는 Piranha (2020-03)]({{< relref "/external/uber/devx/piranha.md" >}})

모노레포 CI·배포, 빌드, 테스트 인프라, 원격 개발 환경, Go 정적·동적 분석처럼 개발과 배포 흐름을 다루는 글입니다.

## 요약하지 않은 원문 {#original-only}

2019년 이전 글이거나 아직 요약하지 않은 글입니다. 원문 제목 그대로 링크합니다.

- [Building Automated Feature Rollouts on Robust Regression Analysis](https://www.uber.com/us/en/blog/autonomous-rollouts-regression-analysis/) · 2018-07-17
- [Uber Engineering’s Micro Deploy: Deploying Daily with Confidence](https://www.uber.com/us/en/blog/micro-deploy-code/) · 2016-06-23
