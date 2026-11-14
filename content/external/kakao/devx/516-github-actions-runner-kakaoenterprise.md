---
title: "카카오엔터프라이즈의 GitHub Actions 도입과 Runner 운영"
description: "카카오엔터프라이즈가 CI를 GitHub Actions로 통일한 이유와 Self-hosted Runner 구성을 정리했습니다. 워크플로 문법과 Runner를 도커로 옮기며 만난 프록시, DinD, DooD 이슈를 요약합니다."
date: 2026-11-14
weight: 9
---

# 카카오엔터프라이즈의 GitHub Actions 도입과 Runner 운영 (2022-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [카카오엔터프라이즈가 GitHub Actions를 사용하는 이유](https://tech.kakao.com/posts/516)
- 매체 · 게시일: 카카오 기술블로그 · 2022-05-06
- 저자: aaron.m2 (카카오엔터프라이즈 DevOps Engine 아론, 그레타)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## DevOps 표준안과 도입 이유 {#standard}

카카오엔터프라이즈는 전사 DevOps 표준화를 위해 GitHub Actions를 도입했습니다. 표준 흐름은 이렇습니다. 소스 저장소는 GitHub Enterprise이고, 커밋 같은 액션이 생기면 GitHub Actions가 CI를 돌려 소스를 이미지로 만들어 카카오 i 클라우드의 컨테이너 레지스트리에 올립니다. 올라간 이미지는 Argo CD로 카카오 i 클라우드의 쿠버네티스 엔진에 배포합니다.

기존에는 Jenkins, Drone, Bamboo 같은 CI가 프로젝트마다 달랐습니다. 프로젝트마다 CI 담당자를 두어야 했고, 여러 프로젝트가 협업할 때 CI를 하나로 합치기 어려웠으며, 도구마다 문법도 익혀야 했습니다. 업무와 직접 관련 없는 허들이었고, 이를 없애려고 하나의 솔루션으로 GitHub Actions를 골랐습니다. 이유는 네 가지입니다.

- GitHub과 하나로 통일된 환경에서 CI를 돌릴 수 있습니다.
- 중앙에서 관리하는 Runner를 계속 트러블슈팅해 원활한 CI 환경을 만들 수 있습니다.
- 프로젝트마다 개별 Runner로 빌드와 테스트를 할 수 있습니다.
- 친숙한 YAML 문법으로 파이프라인을 간단히 구성할 수 있습니다.

## Self-hosted Runner {#runner}

GitHub는 퍼블릭용 Actions Runner를 클라우드에서 제공하지만, 카카오엔터프라이즈는 사정상 내부 GitHub Enterprise에서 그 Runner를 쓰지 못합니다. 그래서 로컬 Runner나 중앙에서 프로비저닝하는 Runner로 Actions를 수행합니다. 중앙에서 제공하는 Runner에는 `k8s` 라벨이 붙어 있고, 프로젝트가 자기 Runner를 쓰고 싶으면 다른 라벨로 등록해 따로 쓸 수 있습니다.

Runner는 Access token을 발급받아 GitHub에 인증하고, GitHub이 Runner로 인식합니다. 토큰은 계정에서 발급하며 `admin:enterprise`의 manage Runners: enterprise 권한으로 만들 수도 있습니다. UI에서 직접 만들 수도 있는데, 저장소 Settings의 Actions > Runner 페이지에서 New self-hosted runner를 눌러 서버뿐 아니라 로컬 환경에도 설치할 수 있습니다. 워크플로의 `runs-on`에 `k8s` 라벨을 쓰면 그 라벨의 Runner 중 Idle 상태인 하나가 골라져 작업을 맡고, 작업 중에는 Active가 됩니다. Runner는 group으로도 관리해서, Default 그룹에 16개를 제공하고 별도로 만든 DevOps 그룹은 선택된 organization 두 곳에서만 접근하고 빌드할 수 있습니다.

## 워크플로 문법 {#workflow}

각 저장소의 `.github/workflows/`에 YAML을 직접 작성합니다. 원문 예시는 `main.yaml`이고, `on`으로 트리거하며 `jobs` 아래 `steps`가 실제 과정입니다.

- 트리거: push나 pull request에서 자동 실행하고, `branches`로 하나나 여러 개를 고르거나 `branches-ignore`로 제외할 브랜치를 지정합니다.
- job: 예시는 build와 deploy로 구성되며 deploy에 `needs: build`가 있어 build 뒤에 실행됩니다. `needs`가 없으면 병렬로 돕니다.
- 분기: build 성공 시 `on_success`, 실패 시 `on_failure`가 도는 식으로 분기를 둘 수 있습니다.
- step: `uses`는 Marketplace에 정의된 것(예: actions checkout)을 가져와 환경 설정용으로 쓰고, `run`은 직접 쓴 명령을 수행하는 실제 수행용입니다. build 자체는 `run` 아래에 쓰고 앞의 사전 작업은 Marketplace 것을 쓰면 된다고 설명합니다.

## 운영 이슈와 개선 {#issues}

백엔드 부서가 Node.js를 많이 쓰고 앱은 Android, Erlang은 elixir로 빌드해서 하나의 config로 커버할 수 없었고, 플랫폼과 언어별 설정이 필요했습니다. 원문이 기승전프록시라고 부를 만큼 프록시 쪽 오류가 잦아서, Node.js 패키지를 받을 때의 npm, yarn config를 Runner 기본 설정에 넣었습니다. Android 빌드는 `JAVA OPTS`에 프록시 옵션을 가져와 등록해 Java 빌드가 정상 동작하게 했습니다.

Runner는 처음 VM 프로세스로 띄웠다가 지금은 도커로 띄워 쿠버네티스로 스케일링합니다. 쿠버네티스로 오토스케일이 가능하고 프로비저닝도 더 효율적이기 때문입니다. 검토 중에는 `ephemeral` 옵션으로 계속 재시작해 CI 작업이 이어져도 원래 Runner 설정을 유지하려 했습니다. 하지만 `ephemeral`을 적용하면 여러 job을 한꺼번에 병렬로 돌리지 못하는 이슈가 있어 파악 중이며 개선할 예정이라고 합니다.

도커로 Runner를 띄우면서 DinD와 DooD 중 선택해야 했습니다.

- DinD(Docker in Docker): CI에서 별다른 설정 없이 도커 명령을 쓰면 이 방식으로 수행되어 편합니다. 그러나 정상 동작하려면 privileged 옵션이 필요하고, 그러면 호스트에서 할 수 있는 거의 모든 작업을 Runner 안에서 할 수 있어 보안 이슈가 생깁니다. 그래서 선택하지 않았습니다.
- DooD(Docker out of Docker): `docker.sock` 파일을 마운트해 호스트의 도커 데몬을 쓰는 방식이고, 팀은 이쪽으로 Runner를 띄우기로 했습니다. `docker.sock`을 소유한 그룹과 유저를 Runner 안에서 인식할 수 있어야 합니다. 도커 설정이 Runner 내부와 호스트 사이에 달라지는 경우가 있어 두 설정을 함께 맞춰야 한다는 점이 이슈가 될 수 있다고 짚습니다.

원문은 GitHub Actions가 빌드와 배포를 어떻게 자동화하고 협업을 얼마나 편하게 하는지 전달됐기를 바란다며 맺습니다.
