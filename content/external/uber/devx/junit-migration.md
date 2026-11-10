---
title: "Bazel과 OpenRewrite로 자동화한 우버의 JUnit 5 이전"
description: "60만 개가 넘는 테스트를 둔 코드베이스에서 JUnit 5 이전을 어떻게 자동화할까요? 우버는 Bazel에서 두 버전을 함께 실행할 기반을 만들고, OpenRewrite와 Shepherd로 변환·검증·롤아웃을 반복했습니다."
date: 2026-11-10
weight: 3
---

# Bazel과 OpenRewrite로 자동화한 우버의 JUnit 5 이전 (2026-04)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How Uber Executed A JUnit Migration at Massive Scale](https://www.uber.com/us/en/blog/junit-migration/)
- 매체 · 게시일: Uber Engineering Blog · 2026-04-08
- 저자: Anshuman Mishra(Staff Software Engineer), Kaushik Vejju(Software Engineer)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 60만 테스트가 남아 있던 JUnit 4 {#background}

JUnit 4 테스트는 여전히 돌아갔습니다. 하지만 2026년 초 우버의 Java 모노레포에서는 8년도 더 전에 나온 JUnit 5의 기능을 쓰지 못했고, JUnit 4 자체는 2021년부터 개발이 멈춘 상태였습니다. 버그 수정도 보안 패치도 새 기능도 더는 나오지 않습니다. 향후 JUnit 버전에서는 JUnit 4 지원마저 없앨 계획이었습니다.

이전하려니 규모가 문제였습니다. 1,500만 줄의 코드에 JUnit 4 테스트가 60만 개 넘게 있었고, 수작업으로 옮기려면 개발자들이 Jupiter API를 익히고 직접 만든 테스트 스위트까지 손봐야 했습니다. 팀들이 새 프레임워크를 쓰도록 동기를 부여하는 일도 남아 있었습니다. 게다가 우버의 빌드 시스템인 Bazel에는 JUnit 5 기본 지원이 없습니다.

우버는 개발 흐름의 변화를 최소화하면서 이전을 자동화하는 길을 택했습니다. 먼저 JUnit 4와 5를 함께 실행할 환경을 마련하고, 자동 변환과 검증을 통과한 변경부터 점진적으로 반영하는 방식입니다.

## JUnit 4와 5가 함께 돌아가는 Bazel {#prerequisites}

코드 변환보다 실행 환경이 먼저였습니다. 우버는 모든 테스트 모듈을 JUnit Platform으로 옮겨, 기존 테스트를 유지하면서 JUnit 5도 실행할 기반을 갖췄습니다. JUnit Platform은 JUnit 4 테스트를 Vintage 엔진으로, JUnit 5 테스트를 Jupiter 엔진으로 실행하는 범용 러너입니다.

Bazel은 JUnit 4를 기본 지원하지만 JUnit Platform은 지원하지 않습니다. 우버는 Bazel 테스트 규칙과 JUnit Platform 사이를 연결하는 커스텀 테스트 러너를 만들었습니다. 이 러너가 우버 고유의 테스트 탐색, 실행 리스너, flaky 테스트 필터, 추가 설정을 구성하고 실제 실행은 JUnit Platform에 맡깁니다.

팀들은 이제 JUnit 5를 쓰기 시작했습니다. 아직 옮기지 않은 JUnit 4 테스트도 같은 기반에서 실행되므로, 중앙에서 진행할 이전 작업 역시 모든 파일을 한꺼번에 바꿀 필요가 없어졌습니다.

## 지원 범위 밖에 남겨 둔 테스트 파일 {#recipe}

변환을 어렵게 만든 것은 특수한 테스트 패턴이었습니다. 전용 러너나 룰, 베이스 테스트 클래스를 변환 논리가 해석하지 못하는데도 억지로 옮기면, 한 파일에 JUnit 4와 5 API가 섞여 빌드가 깨질 수 있습니다. 그렇다고 파일 하나 때문에 타깃 전체를 건너뛰면 이전 속도가 느려집니다.

우버는 파일별로 변환 여부를 결정했습니다. 코드 변환에 선택한 Moderne의 오픈소스 OpenRewrite는 소스 검색·리팩터링 연산을 레시피로 정의하며, precondition을 파일 단위 필터로 쓸 수 있는 도구입니다. 우버는 직접 만든 레시피와 OpenRewrite의 기존 레시피가 지원하는 러너, 룰, 베이스 클래스 목록을 모았습니다. 목록에 없는 유틸리티가 든 파일은 제외하고, 끝까지 처리할 수 있는 파일만 변환합니다.

지원 범위를 넓히는 순서는 사용량으로 정했습니다. 검색 레시피로 모노레포의 러너, 룰, 베이스 클래스가 얼마나 쓰이는지 집계하고, 가장 흔한 패턴부터 이전 논리를 만드는 방식입니다. 오픈소스 유틸리티는 대응하는 JUnit 5 extension을 찾았고, 사내 유틸리티는 같은 기능의 JUnit 5 버전을 개발했습니다. 대응물을 만드는 대신 다른 패턴으로 구현하거나 낡은 유틸리티를 없앤 경우도 있습니다.

## Bazel 타깃에서 패치를 만드는 OpenRewrite {#transformation}

변환 결과는 정해진 규칙을 따라야 했습니다. 우버가 원한 것은 타입 안전성과 코드의 의미를 보존하는 자동화였고, 이 규모와 독자적인 테스트 패턴에는 결정적 변환이 더 현실적이라는 판단이었습니다. 여러 테스트 클래스 파일을 생성형 AI로 한꺼번에 옮기려는 시도는 성공하지 못했습니다. AI는 테스트와 빌드 실패를 디버깅하는 용도로만 썼습니다.

OpenRewrite를 골랐어도 Bazel과 연결하는 작업은 남아 있었습니다. OpenRewrite 역시 Bazel을 지원하지 않았기 때문입니다. OpenRewrite가 코드를 파싱하고 타입을 해석하려면 소스 파일과 컴파일 클래스패스가 필요하므로, 우버는 테스트 타깃에서 소스와 전체 컴파일 클래스패스를 수집하는 커스텀 Bazel aspect를 만들었습니다. 적용할 레시피는 aspect 파라미터로 받습니다.

수집한 입력은 우버의 통합 계층으로 넘어갑니다. 여기서 OpenRewrite 파서는 코드를 타입 정보, 서식, 메타데이터가 담긴 LST(Lossless Semantic Tree)로 만들고, 비지터는 이 트리를 순회하며 레시피에 따라 메서드 선언, 애너테이션, import를 고칩니다. 변경한 트리는 다시 소스 텍스트로 출력합니다.

공통 패턴의 변환은 OpenRewrite의 `org.openrewrite.java.testing.junit5.JUnit4to5Migration` 레시피에서 시작합니다. 예를 들어 `@RunWith(Parameterized.class)`를 JUnit Jupiter 매개변수화 테스트로 바꾸고, `ExpectedException` 룰을 `Assertions.assertThrows()`로 교체하는 레시피가 포함되어 있습니다. 우버는 이 기본 레시피들을 개선해 업스트림에도 기여했습니다.

사내 패턴은 별도 레시피로 처리했습니다. 커스텀 러너를 JUnit 5 extension으로 바꾸고, 커스텀 룰 패턴을 변환하며, 기존 베이스 테스트 클래스는 JUnit 5 대응물로 교체하거나 제거합니다. 이를 모두 묶은 종합 레시피가 `com.uber.openrewrite.recipe.junit.JUnit4to5Migration`입니다. precondition으로 파일을 고른 뒤 공통 패턴과 사내 패턴을 차례로 바꾸고, 마지막에는 `FindDependencyUsage`로 JUnit Jupiter, Mockito JUnit Jupiter처럼 새로 필요한 테스트 의존성을 찾습니다.

산출물은 패치와 CSV입니다. 코드 변환은 `test_main.patch`에 담고, 의존성과 이전 메타데이터, 진단 정보는 `datatable/` 아래의 `DependencyUsage.csv`, `SourcesFileResults.csv`, `RecipeRunStats.csv`에 기록합니다. 이 파일들이 소스 수정 이후의 빌드 설정 변경과 검증으로 이어집니다.

## 테스트 통과를 조건으로 삼은 셸 스크립트 {#workflow}

패치만 적용해서는 타깃 이전이 끝나지 않습니다. 바뀐 소스에 맞춰 빌드 설정의 의존성을 고치고, 실제로 빌드와 테스트가 성공하는지 확인해야 합니다. 우버는 이 과정을 테스트 타깃 하나만 입력받는 셸 스크립트로 묶었습니다.

스크립트는 먼저 OpenRewrite를 실행해 패치와 CSV를 생성합니다. 패치를 적용한 다음에는 `DependencyUsage.csv`를 읽어 빌드 설정에 필요한 테스트 의존성을 추가합니다. 레시피가 찾아낸 의존성 정보가 코드 변환과 빌드 설정 변경을 연결하는 방식입니다.

변경을 남기는 조건은 테스트 통과였습니다. 갱신한 타깃의 빌드가 성공하면 테스트 스위트를 실행하고, 테스트가 실패하면 이전을 중단하면서 실패한 테스트 클래스를 보고합니다. 모두 통과한 경우에만 변경을 유지하므로, 검증에 실패한 상태로 이전을 진행하지 않습니다.

## 실패를 구분하며 반복한 Shepherd 롤아웃 {#rollout}

타깃 하나에서 작동한 절차를 수천 개 타깃에 적용할 차례였습니다. 로컬에서 전부 실행하면 몇 시간이 걸려 현실적이지 않았으므로, 우버는 사내 대규모 코드 변경 도구인 Shepherd에 실행을 맡겼습니다. Shepherd는 이전에 성공한 타깃을 가려 타깃마다 diff를 생성합니다.

검증은 거기서 끝나지 않습니다. 생성한 diff는 우버 CI에서 통합 테스트와 린터 검사를 거치고, 코드 커버리지 기준도 충족해야 합니다. 타깃의 단위 테스트를 통과한 변경을 더 넓은 범위에서 확인하는 절차입니다.

첫 롤아웃에서 나온 diff만 2,000개가 넘었습니다. 그래도 빌드나 테스트가 실패한 타깃, 지원하지 않는 패턴이 남은 타깃은 옮기지 못했습니다. 이후 작업은 실패의 종류에 따라 달랐습니다.

테스트가 실패한 파일은 JUnit 4로 되돌렸습니다. 수천 개 타깃에서 개별 테스트 실패를 하나씩 진단하기는 현실적이지 않았기 때문입니다. 빌드 실패는 여러 타깃에서 반복되는 패턴을 찾아 OpenRewrite 레시피를 추가하는 방식으로 처리했습니다. 모든 실패를 개별 수정하는 대신, 공통된 원인을 자동 변환이 처리하도록 지원 범위를 넓혔습니다.

Shepherd로 롤아웃을 실행하고, 실패 로그를 분석하고, 빠진 패턴을 지원한 뒤 다시 실행하는 과정이 이어졌습니다. 그 결과 4개월 동안 75,000개가 넘는 테스트 클래스를 JUnit 5로 옮겼고, 수정한 코드는 약 125만 줄에 이릅니다. 자동으로 생성한 diff는 5,000개 이상입니다.

## Spring Boot 3 빌드로 이어지는 이전 도구 {#learnings}

후속 작업에는 Spring Boot 3 서비스 빌드를 위한 도구도 포함됩니다. OpenRewrite 동작을 Bazel 규칙에 통합해 서비스의 의존성 빌드에 적용하는 도구입니다. Guava에서 표준 Java API로, Joda-Time에서 `java.time`으로 옮기는 작업도 앞으로의 적용 대상으로 소개했습니다.

{{% details title="이전 규모와 자동화 산출물" closed="true" %}}

| 항목 | 값 |
|---|---|
| 이전 전 JUnit 4 테스트 / 코드 규모 | 60만 개 이상 / 1,500만 줄 |
| 이전한 테스트 클래스 | 75,000개 이상 |
| 수정한 코드 | 약 125만 줄, 4개월 |
| 자동 생성 diff | 5,000개 이상 (첫 롤아웃 2,000개 이상) |
| 종합 레시피 | com.uber.openrewrite.recipe.junit.JUnit4to5Migration |
| 레시피 출력 | test_main.patch, datatable/ (DependencyUsage.csv, SourcesFileResults.csv, RecipeRunStats.csv) |
| 실행 엔진 | Vintage(JUnit 4), Jupiter(JUnit 5) |
| 대규모 변경 도구 | Shepherd (CI에서 통합 테스트, 린터, 커버리지 검증) |
| 후속 작업 | Spring Boot 3 빌드 통합, Guava에서 표준 Java API, Joda-Time에서 java.time |

{{% /details %}}
