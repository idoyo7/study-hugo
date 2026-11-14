---
title: "CI 표준화를 위해 직접 꾸린 GitHub Actions Runner"
description: "카카오엔터프라이즈는 프로젝트마다 CI를 구성하고 문법을 익히는 부담을 줄이려고 GitHub Actions를 선택했습니다. 내부 GitHub Enterprise에서 클라우드 Runner를 사용할 수 없어 Self-hosted Runner를 제공하고, 프록시 설정과 도커 실행 방식을 조정했습니다."
date: 2026-11-14
weight: 9
---

# CI 표준화를 위해 직접 꾸린 GitHub Actions Runner (2022-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [카카오엔터프라이즈가 GitHub Actions를 사용하는 이유](https://tech.kakao.com/posts/516)
- 매체 · 게시일: 카카오 기술블로그 · 2022-05-06
- 저자: aaron.m2 (카카오엔터프라이즈 DevOps Engine 아론, 그레타)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 협업 전에 맞춰야 했던 CI 도구 {#standard}

카카오엔터프라이즈의 프로젝트들은 Jenkins, Drone, Bamboo 등 서로 다른 CI 도구를 쓰고 있었습니다. 프로젝트마다 CI 구성을 맡을 담당자가 필요했습니다. 여러 프로젝트가 협업할 때는 도구를 하나로 맞추기 어려웠고, CI 문서를 작성하려면 도구마다 다른 문법도 익혀야 했습니다.

이 허들을 줄이려고 선택한 도구가 GitHub Actions입니다. 소스 저장소와 CI를 GitHub의 한 환경에서 다루고, 친숙한 YAML로 파이프라인을 구성할 수 있다는 점이 도입 이유였습니다. Runner를 중앙에서 관리하며 문제를 해결하되, 프로젝트별 Runner로 빌드와 테스트를 하는 방식도 지원합니다.

전사 DevOps 표준안에서는 GitHub Enterprise에 커밋 같은 이벤트가 생기면 GitHub Actions가 소스를 이미지로 만들어 카카오 i 클라우드의 컨테이너 레지스트리에 올립니다. 이후 Argo CD가 그 이미지를 카카오 i 클라우드의 쿠버네티스 엔진에 배포합니다.

## 빌드 순서를 적는 YAML {#workflow}

워크플로 파일은 직접 작성합니다. 저장소의 `.github/workflows/`에 YAML을 두고, `on`으로 작업을 시작할 이벤트를, `jobs`와 그 아래 `steps`로 수행할 과정을 적습니다. 소개된 예시의 파일 이름은 `main.yaml`입니다.

push나 pull request를 트리거로 삼으면 해당 이벤트가 발생할 때 CI가 시작됩니다. `branches`로 대상 브랜치를 하나 또는 여러 개 고를 수 있고, `branches-ignore`를 쓰면 지정한 브랜치만 제외하고 나머지 브랜치에서 실행합니다.

job 사이의 실행 순서도 YAML에 적습니다. build와 deploy로 나눈 예시에서는 deploy에 `needs: build`를 지정해 build 뒤에 실행하도록 했습니다. `needs`가 없으면 job은 병렬로 실행됩니다. build 성공 시 `on_success`, 실패 시 `on_failure`를 실행하도록 분기를 두는 예시도 있습니다.

각 step에서 `uses`는 GitHub Marketplace에 미리 정의된 작업을 가져오고, `run`은 직접 적은 명령을 실행합니다. actions checkout 같은 패키지에 변수를 넣거나 기본값을 사용해 환경을 준비하고, 실제 build 명령은 `run` 아래에 적는 식입니다.

## `k8s` 라벨로 연결한 공용 Runner {#runner}

CI 작업을 실행할 Runner는 직접 준비해야 했습니다. GitHub은 퍼블릭용 Runner를 클라우드에서 제공하지만, 카카오엔터프라이즈는 사정상 내부 GitHub Enterprise에서 이를 쓸 수 없었습니다. 그래서 로컬 Runner나 중앙에서 프로비저닝하는 Self-hosted Runner로 작업을 실행했습니다.

중앙에서 제공하는 Runner의 라벨은 `k8s`입니다. 워크플로의 `runs-on`에 이 라벨을 지정하면 `k8s` Runner 가운데 Idle 상태인 하나가 작업을 맡고, 작업 중에는 Active로 표시됩니다. 프로젝트가 자체 Runner를 쓰고 싶으면 `ian`, `aaron` 같은 라벨로 등록해 별도로 사용할 수 있습니다.

접근 범위는 Runner group으로 관리합니다. Default 그룹에는 16개의 Runner를 제공했고, 별도로 만든 DevOps 그룹은 선택된 organization 두 곳에서만 접근해 빌드하도록 했습니다.

직접 설치할 Runner는 저장소 Settings의 Actions > Runner에 있는 New self-hosted runner에서 생성하며, 서버뿐 아니라 로컬 환경에도 설치할 수 있습니다. Runner는 Access token으로 GitHub에 인증한 뒤 등록됩니다. 토큰은 GitHub 계정에서 발급하며, `admin:enterprise`의 manage Runners: enterprise 권한을 사용하는 방법도 있습니다.

## 언어별 설정에서 만난 기승전프록시 {#issues}

CI 도구를 통일해도 빌드 설정은 제각각이었습니다. 백엔드 부서에서는 Node.js를 많이 사용했고, Android 앱 빌드와 elixir를 사용하는 Erlang 빌드도 있어 하나의 config로 모두 처리할 수 없었습니다. 플랫폼과 언어마다 설정을 맞춰야 했습니다.

그중에서도 프록시 오류가 잦았습니다. npm과 yarn으로 Node.js 패키지를 받을 때 필요한 config를 Runner 기본 설정에 넣은 이유입니다. Android 빌드에서도 `JAVA OPTS`에 프록시 옵션을 등록해 Java 빌드가 정상 동작하도록 했습니다.

## 쿠버네티스 스케일링을 위한 도커 전환 {#docker-runner}

Runner는 처음에 VM 프로세스로 실행했습니다. 이후 도커로 옮겨 쿠버네티스로 스케일링하는 방식으로 바꿨습니다. 쿠버네티스에서 auto scaling이 가능하고, Runner를 더 효율적으로 프로비저닝할 수 있다는 점이 전환 이유입니다.

Runner를 도커로 띄우자 CI 작업에서 호출하는 도커를 어디서 실행할지도 정해야 했습니다. DinD(Docker in Docker)는 Runner 컨테이너 안에서 도커를 실행하는 방식입니다. CI에서 도커를 쓰기에는 편하지만, 정상 동작에 필요한 `privileged` 옵션을 주면 Runner 안에서 호스트의 거의 모든 작업을 할 수 있어 보안 문제가 생깁니다.

팀이 선택한 방식은 DooD(Docker out of Docker)입니다. Runner에 `docker.sock`을 마운트해 호스트의 도커 데몬을 사용하므로, Runner 안에서 명령을 내려도 컨테이너는 호스트 위에 뜹니다. 이때 소켓 파일을 소유한 그룹과 유저를 Runner 내부에서도 인식할 수 있어야 합니다. 호스트와 Runner 내부의 도커 설정에 차이가 생기면 양쪽 설정을 함께 맞춰야 한다는 제약도 있습니다.

CI 작업이 이어져도 원래 Runner 설정으로 계속 작업하려고, `ephemeral` 옵션으로 재시작하는 방식도 검토했습니다. 그러나 당시 팀의 환경에서는 이 옵션을 적용하면 여러 job을 병렬로 실행하지 못하는 문제가 있었습니다. 팀은 이 문제를 파악 중이었으며 개선할 예정이었습니다.
