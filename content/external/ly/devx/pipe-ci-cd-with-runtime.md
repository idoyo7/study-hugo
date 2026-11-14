---
title: "CI/CD와 런타임을 합친 LINE의 PIPE"
description: "LINE Plus Productivity Engineering 팀이 Tekton 기반 워크플로와 Namespace as a Service 쿠버네티스 런타임을 묶어 만든 PIPE를 정리했습니다. 워크플로 구조, 런타임 구성, 운영 방식과 로드맵을 다룹니다."
date: 2026-11-14
weight: 7
---

# CI/CD와 런타임을 합친 LINE의 PIPE (2022-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [PIPE: 더 나은 개발자 경험을 제공하기 위한 CI/CD](https://engineering.linecorp.com/ko/blog/pipe-ci-cd-with-runtime)
- 매체 · 게시일: LINE Engineering 블로그 · 2022-05-03
- 저자: 이승 (LINE Plus Productivity Engineering 팀)
- LINE DEVELOPER DAY 2021 세션 내용을 옮긴 글입니다.
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## PIPE의 구성과 만든 배경 {#overview}

PIPE는 쿠버네티스를 기반으로 CI/CD에 런타임을 통합한 일종의 에코 시스템입니다. 개발자 생산성과 개발자 경험을 높이는 것이 목표이며 워크플로와 런타임 두 컴포넌트로 이루어집니다. 워크플로는 Tekton Pipelines와 GitHub Events를 합친 모델이고, 런타임은 Tekton 워크로드는 물론 사용자의 컨테이너 워크로드까지 호스팅하는 직접 운영하는 관리형 쿠버네티스 플랫폼입니다.

Tekton은 두 가지 기준으로 골랐습니다. CI/CD를 처음부터 끝까지 완전히 자동화할 수 있는지, 파이프라인을 선언적으로 정의할 수 있는지입니다. Argo CD 같은 솔루션도 검토했지만, 직접 운영하며 개선하고 패치하는 것을 생각하면 Tekton이 가장 적합하다고 보았습니다.

배경은 둘입니다.

- 오픈 플랫폼: 사내에는 Jenkins, CircleCI, Drone CI, Argo CD 등이 이미 있었지만 통합되어 있지 않았고 개발자에게 열려 있지 않았습니다. 개발자가 스택 전체를 익히는 대신 필요한 컴포넌트만 골라 쓰게 하려 했습니다. 접근 방식도 문제였습니다. 사내 자체 쿠버네티스 솔루션은 kubectl이 아닌 자체 CLI를 쓰고 OpenStack과 밀접하게 연결되어 있었기 때문에, 사실상 표준인 kubectl과 쿠버네티스 IDE를 그대로 쓰는 환경을 제공하고자 했습니다.
- 관리형 컨테이너 런타임: 'Namespace as a Service' 모델로, 전용 쿠버네티스가 아니라 웹사이트에서 생성 버튼을 누르면 전용 네임스페이스가 만들어집니다. 결재나 승인은 필요 없습니다. 컨트롤 플레인과 etcd 같은 노드는 PIPE가 직접 관리하고, 개발자에게는 네임스페이스 관리자 권한을 줍니다. 프로젝트 단위로 클러스터를 나눠 주면 개발자가 주기적으로 업그레이드하기 어려워지는데, 몇 개의 지정 런타임만 운영하면 업그레이드 관리 비용을 최소화하고 자동 업데이트로 최신 상태를 유지할 수 있습니다. 권한은 쿠버네티스 RBAC과 정책 엔진 Kyverno로 관리합니다.

## PIPE 워크플로 {#workflow}

Tekton Pipelines는 쿠버네티스 문법을 그대로 따르는 CI/CD 프레임워크로, CD Foundation 소속 솔루션 중 Jenkins에 대한 의존성이 없는 거의 유일한 솔루션이라고 원문은 설명합니다. 개발이 대부분 GitHub 기반이라 GitHub Events를 처리하는 애너테이션을 설정했고, 자체 DSL 대신 사실상 표준인 GitHub Actions의 이벤트 트리거 문법을 그대로 가져왔습니다. 이벤트를 어떻게 처리할지는 Tekton Pipeline의 애너테이션 필드에 적습니다.

동작 순서는 다음과 같습니다. GitHub 앱으로 구동되는 웹훅이 푸시나 릴리스 같은 이벤트를 PIPE로 전달합니다. PIPE는 개발자 리포지터리에서 이벤트에 맞는 Tekton 파이프라인을 찾고, 있으면 그것을 템플릿 삼아 이벤트 종류, SHA256 태그, 이벤트 발생자 같은 파라미터를 더해 PipelineRun을 만듭니다. 파이프라인이 클래스라면 PipelineRun은 인스턴스입니다. 이를 컨테이너 런타임에서 실행하고 결과를 GitHub의 커밋 상태로 보여줍니다. 로그 URL과 각 단계의 성공·실패가 실시간으로 갱신되어, 개발자는 PIPE 웹사이트가 아니라 GitHub에서 상태를 볼 수 있습니다. `tkn` CLI가 불편한 점을 보완하려고 별도 로그 웹사이트도 제공합니다.

### 스캐폴더와 재사용 태스크 {#scaffolder}

Tekton Pipelines의 YAML은 처음 작성하기에 길어서 스캐폴더를 만들었습니다. 개발·스테이지·프로덕션을 구동할 네임스페이스, 이벤트를 받을 Slack 채널을 입력하고 Golang, Gradle, Node.js 같은 플랫폼과 버전을 고른 뒤 Scaffold를 누르면 Tekton Pipelines를 만들어 내려받게 합니다. CircleCI에서 모티브를 얻었고 Jenkins Blue Ocean에도 비슷한 기능이 있습니다. 단순한 템플릿이 아니라 CI/CD 모범 사례를 쉽게 적용하도록 한 모델로, 1개의 `ci.yaml`과 4개의 `cd.yaml`을 생성합니다.

- `ci.yaml`: 기본 브랜치가 아닌 브랜치에 PR이 들어오면 린트와 단위 테스트를 돌립니다(`branches-ignore`).
- 기본 브랜치에 변경이 생기면 린트와 단위 테스트에 이어 배포를 만들어 스테이지 환경까지 배포합니다. 스테이지가 늘 기본 브랜치의 최신 소스로 구동되도록 하려는 기본값입니다.
- 태그나 배포가 생성되면 push tags 이벤트가 트리거되고, 정규표현식을 지원하므로 `v*` 같은 태그에서 `cd` 파이프라인이 돌아 프로덕션으로 배포합니다.

재사용 가능한 태스크도 제공합니다. Tekton Hub(Docker Hub와 비슷한 파이프라인 저장소)의 태스크 중 많이 쓸 만한 것을 사내용으로 패치합니다. Git Clone은 주소를 GitHub.com에서 GitHub Enterprise로 바꾸는 식입니다. `build-container-image`는 Kaniko나 BuildKit 같은 도구 대신 PIPE의 별도 BuildKit 서비스와 연동해 캐시로 빠르게 빌드하게 하고, `build-gradle`은 사내 Nexus 리포지터리로 퍼블리시하는 기능을 함께 줍니다.

## PIPE 런타임 {#runtime}

런타임은 코어 클러스터와 런타임 클러스터로 나뉩니다. 코어 클러스터는 PIPE API와 웹사이트를 호스팅하고 GitHub의 모든 이벤트가 여기로 들어오며 OIDC 인증도 맡습니다. 런타임 클러스터는 빌드 요청과 컨테이너 실행 환경을 제공하며 도쿄, 오사카, 싱가포르 등 지역별로 배포하고, 인증과 API 요청은 하나의 코어 클러스터가 처리합니다. Kubeflow처럼 노드가 수천 개인 클러스터는 런타임 클러스터에서 돌리기에 부하나 관리 부담이 커서 별도 클러스터로 제공할 계획입니다.

### 쿠버네티스 구성 {#kubernetes}

- 장비: 전부 물리 장비입니다. 과거 다른 서비스에서 가상 머신 노드가 `non ready` 상태가 되거나 장애가 나는 일이 잦았던 경험에 근거합니다.
- 설치: kubeadm과 자체 제작 Ansible 스크립트로 프로비저닝합니다. 처음에는 Kubespray를 쓰려 했지만 범용 도구라 LINE 상황에 맞는 기능이 부족했고, 같은 상황에서 Kubespray는 속도가 두 배 이상 느렸다고 합니다.
- 버전: v1.21.1입니다. 오픈한 지 얼마 안 되어 테스트를 많이 한 버전을 썼고, 업그레이드를 계획하고 있습니다. v1.22에서 기존 API 상당수가 deprecated 되어 v1.21까지는 구버전 API로 적용할 수 있었지만 v1.22부터는 에러가 나므로, 이 문제를 어떻게 처리할지 고민 중이었습니다.
- 인터페이스: 네트워크는 Calico에 Typha, 런타임은 containerd, 스토리지는 OpenEBS와 사내 플랫폼 Verda의 공유 파일 시스템을 제공합니다.
- 노드 역할: 컨트롤 플레인, 빌드, 게이트웨이, 역할 없음의 네 가지이고 워크로드는 역할에 따라 스케줄링됩니다.

Calico와 Typha를 고른 이유는 확장성입니다. Kubeflow 같은 경우 노드가 1,000개에서 3,000개까지 필요한데, 이때 가장 큰 부하는 네트워크 인터페이스, 그다음이 스케줄러라고 보았고, 머신러닝에서는 스케줄러보다 네트워크 쪽 부하가 훨씬 클 것이라고 예상했습니다. Typha는 Calico와 Kube API 서버 사이의 프록시로, 각 노드가 Kube API 서버에서 직접 정보를 받지 않고 Typha를 거치게 해 API 서버 부하를 줄입니다. 문서상 Typha 하나가 Calico 노드 약 200개를 맡을 수 있어 이론상 4,000노드까지 가능하지만, 실제로는 1,000노드 정도로 테스트했고 문제가 없었습니다.

사전 설치 컴포넌트는 서비스 메시 Istio, 인그레스 Contour(ingress-nginx도 클래스로 선택 가능), Verda 로드 밸런서 연동, 빌드용 Tekton과 buildkitd, 모니터링용 Fluent Bit와 Prometheus, 인증 Dex, 권한 관리 Kyverno, 스토리지 OpenEBS와 VSFS입니다.

### 인증과 권한 {#auth}

인증은 OIDC입니다. 런타임의 Kube API 서버가 코어 클러스터의 Dex에서 OIDC 엔드포인트를 가져옵니다. 사용자가 `kubectl get pod` 같은 요청을 하면 런타임이 ID 토큰을 검증하고, 유효하지 않으면 GitHub OAuth2 Flow로 JWT를 새로 받아 Dex에서 ID 토큰으로 바꿉니다. Dex는 16시간짜리 토큰을 발급해 한 번 로그인하면 하루 정도 쓸 수 있게 했습니다. 권한은 RBAC이 기본이고 부족하면 Kyverno로 한 번 더 관리하는데, Open Policy Agent보다 쓰기 편해서 골랐습니다. 개발자는 대시보드에서 kubeconfig 다운로드, 네임스페이스 생성, API 키 발급, GitHub 앱 설치를 할 수 있습니다.

## 서비스 수준을 높이는 운영 {#operations}

- 모니터링: Grafana와 Prometheus를 쓰며 Alertmanager, kube-state-metrics, node-exporter, metrics-server, node-problem-detector도 운영합니다. 노드 준비 상태, 클라이언트 인증서 만료 임박, 파드의 CrashLoop, 엔드포인트 미준비 같은 경고를 Slack 채널로 보냅니다.
- 백업과 정리: etcd를 30분마다 Verda의 오브젝트 스토리지(S3와 비슷)에 백업합니다. 런타임에 남은 PipelineRun이 etcd에 부하를 주므로 일주일이 넘은 것은 삭제합니다.
- 컨트롤 플레인: 처음에는 Rancher처럼 클러스터를 관리하는 상위 클러스터(Ring 0)를 두었는데, 상위 클러스터의 인증서 만료나 노드 다운, 로드 밸런서 문제가 하위 클러스터 운영 불능으로 번졌습니다. 그래서 현재 PIPE 컨트롤 플레인은 쿠버네티스가 아니라 VM에서 도는 Jenkins로 구성하고 PIPE 자체의 CI/CD를 맡겨 순환 참조를 막았습니다. 클러스터는 Ansible Playbook으로, 각 컴포넌트는 Helmfile과 kustomize로 관리합니다.
- 노드 역할 분리: 빌드는 CPU와 메모리를 많이 써서 기존 워크로드에 영향을 주므로, 빌드 노드와 사용자 워크로드 노드를 Kyverno의 뮤테이션 웹훅으로 명시적으로 분리했습니다.

## 향후 로드맵 {#roadmap}

- 고가용성: 현재 가장 큰 약점은 단일 클러스터라는 점이라고 원문은 말합니다. 곧 LINE 내부의 멀티 AZ로 컨트롤 플레인(etcd, API 서버, 컨트롤러 매니저, 스케줄러)과 워커 노드를 분산할 예정입니다.
- PIPE Functions: Azure Functions나 AWS Lambda와 비슷한 기능을 개발 중입니다. 쿠버네티스 인프라를 깊이 몰라도 쓸 수 있는 Heroku, Netlify, Google App Engine과 비슷한 모델을 목표로 하며, 지금은 Python만 지원하는 Verda Functions를 대체하면서 이벤트와 언어를 늘릴 계획입니다.
- CPaaS: 아직 조사 단계입니다. Namespace as a Service와 독자 클러스터의 중간 모델인 vCluster로, 언더레이 쿠버네티스에서는 하나의 배포로 보이지만 안에서 완전한 쿠버네티스가 도는 형태입니다. CRD나 커스텀 컨트롤러 개발에 편리할 것으로 봅니다.
- VM 기반 CRI: 보안 요구가 높은 경우 Firecracker나 Kata Containers 같은 VM 기반 런타임을 제공할 계획입니다.

{{% details title="원문의 주요 구성값" closed="true" %}}

| 항목 | 값 |
|---|---|
| 쿠버네티스 버전 | v1.21.1 |
| 네트워크 / 런타임 / 스토리지 | Calico + Typha / containerd / OpenEBS, VSFS |
| Typha 하나가 맡는 Calico 노드 | 약 200개 (문서상, 이론상 4,000노드) |
| 실제 테스트 규모 | 약 1,000노드 |
| Dex 토큰 유효 시간 | 16시간 |
| etcd 백업 주기 | 30분 |
| PipelineRun 보관 | 일주일 |
| 스캐폴더 생성 파일 | ci.yaml 1개, cd.yaml 4개 |
| 런타임 클러스터 지역 | 도쿄, 오사카, 싱가포르 등 |

{{% /details %}}
