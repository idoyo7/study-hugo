---
title: "BentoML과 Kubernetes로 자동화한 AI 서빙 시스템"
description: "AI플랫폼이 모델을 만들기만 하면 배포와 관리가 자동으로 이어지도록 서빙 시스템을 구성한 과정입니다. CI/CD 구조와 모니터링, 운영 중 만난 Keep Alive 에러, 재배포 에러, BentoML 메모리 릭 사례를 다룹니다."
date: 2026-11-14
weight: 1
---

# BentoML과 Kubernetes로 자동화한 AI 서빙 시스템 (2024-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [제목은 안정적인 AI 서빙 시스템으로 하겠습니다. 근데 이제 자동화를 곁들인…](https://techblog.woowahan.com/19548/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2024-11-05
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 서빙 로봇에 빗댄 AI플랫폼의 목표 {#platform-goal}

원문은 음식점의 서빙 로봇에 비유해 시작합니다. 서빙 로봇이 있으면 요리에만 집중할 수 있듯, 모델 배포 과정을 신경 쓰지 않으면 모델 학습에만 집중할 수 있습니다. 우아한형제들의 AI플랫폼은 서빙 자동화 시스템을 갖춰, 모델을 만들기만 하면 배포와 관리를 알아서 처리합니다.

서빙은 학습된 모델을 운영 환경에 올려 실시간 요청을 받는 API로 제공하는 과정입니다. 성능 최적화, API 생성, 확장성 관리, 버전 관리, 모니터링이 모두 포함됩니다. 현재 서빙 시스템은 월 약 20억 건의 트래픽을 처리합니다. 그래서 버전 관리, 유실 없는 무중단 배포, 문제 시 빠른 롤백이 철저해야 합니다. 이 글은 학습된 모델이 Model Registry에 저장된 상황을 전제합니다.

## BentoML로 통일한 서빙 코드 {#bentoml-serving}

개발자는 PyTorch, TensorFlow, CatBoost, Scikit Learn 등 다양한 프레임워크로 모델을 학습합니다. 프레임워크마다 모델을 불러오고 추론하는 방식이 달라 코드 일관성과 유지보수가 어려워지므로, AI플랫폼은 여러 프레임워크를 지원하고 개발이 빠른 BentoML로 서빙 환경을 구성했습니다. 컨테이너화가 쉬워 Kubernetes 배포가 편하고, 전후처리 같은 비즈니스 로직도 간단히 붙일 수 있습니다.

개발자는 생성자에서 Model Registry의 모델을 불러오고, `@api`를 붙인 추론 함수 하나를 쓰면 됩니다. 그러면 `/inference` 경로로 호출할 수 있는 API가 뜹니다. 나머지는 플랫폼이 자동으로 처리합니다.

## CI에서 이미지 생성과 버전 관리 {#ci-image-build}

서비스 코드를 GitLab에 푸시하면 GitLab CI 파이프라인이 테스트를 거쳐 Docker 이미지를 만듭니다. 모든 서비스를 한 저장소에서 관리하는 모노레포인데, CI가 파이프라인을 동적으로 생성해서 새 서비스가 생겨도 추가 작업이 필요 없습니다.

이미지에는 모델을 함께 넣습니다. 빌드 시간이 길고 용량을 많이 차지하는 단점이 있지만, Model Registry와의 연결이 없어 SPOF를 피하고 안정성이 높아집니다. 서빙 로직과 모델 버전을 맞추는 과정이 없으니 문제가 생겨도 빨리 복구할 수 있고 코드 복잡도도 낮아집니다.

버전은 `2.5.3` 같은 Semantic Versioning으로 관리합니다. 로직만 바뀌면 Minor가 오르고(`2.5.3` → `2.6.0`), API 입출력이 바뀌면 Major가 오릅니다(`2.5.3` → `3.0.0`). 재학습 파이프라인이 모델을 새로 학습하면 Patch가 오릅니다(`2.5.3` → `2.5.4`). Minor와 Patch는 Rolling Update로 무중단 자동 배포하고, Major는 기존 API와 연동되지 않으므로 CI에 oasdiff를 넣어 현재 API와 새 API 사이의 breaking change를 감지합니다. Major 배포는 Blue Green 방식으로, 새 버전이 뜨면 호출을 모두 옮기고 기존 버전을 지우는 수동 배포입니다.

## CD와 Kubernetes 구성 {#cd-kubernetes}

서비스마다 Namespace를 두고 Deployment로 Pod를 배포합니다. 호출이 늘면 replica를 늘리고 줄면 다시 줄입니다. 호출은 Ingress와 Service를 거쳐 Pod로 가는데, Ingress는 AWS ALB를 쓰며 요청량에 따라 로드밸런서 가용량이 자동으로 정해집니다. Route53에는 도메인이 자동 등록돼 서비스별 endpoint가 생깁니다.

Pod가 올라갈 Node는 Karpenter가 워크로드 수요에 맞춰 만들고 관리합니다. NodePool마다 필요한 EC2 인스턴스를 정의해 두고 서비스가 쓸 NodePool을 고릅니다. 가용 Node가 없으면 NodePool에 정의된 인스턴스로 새 Node를 만듭니다. 명세는 Helm 공통 템플릿으로 관리하고 서비스별로 필요한 부분만 바꿉니다. 차트는 ArgoCD로 배포하며 Git에서 명세를 관리합니다. ArgoCD Image Updater가 이미지 태그를 감지해, minor나 patch가 바뀌면 Rolling Update가 실행됩니다. 이미지 생성부터 배포까지 전 과정이 자동입니다.

## 모니터링과 알람 {#monitoring-alerts}

Grafana로 서빙 인프라와 서비스 메트릭을 봅니다. Prometheus로 Kubernetes와 BentoML 메트릭을, CloudWatch로 ALB 메트릭을 보고, GPU 서비스는 DCGM Exporter를 씁니다. 서비스별 대시보드 대신 한 대시보드에서 `service_name` 변수로 서비스를 고르게 했습니다. Namespace 이름을 `serving-sample-project-beta` 같은 형식으로 통일해 두었기 때문에 정규식 `serving-(.*)-beta`로 서비스명을 뽑아냅니다.

알람은 인프라 알람과 서비스 알람으로 나뉩니다. 인프라 알람은 주로 시스템 문제이고 AI플랫폼 개발자가 맡습니다. CPU와 메모리 사용량이 임계치를 넘을 때, 일정 기간 요청이 없을 때 등입니다. 서비스 알람은 로직 문제 위주이며 AI 서비스 개발자가 해결합니다. 배포 알람은 ArgoCD 자동 배포 결과를 알려 주고, 에러 알람은 Sentry로 에러 정보와 trace를 모읍니다. Kubecost로 서비스별 대략적인 비용도 확인합니다.

## 운영 중 만난 문제 세 가지 {#operational-issues}

첫째는 Keep Alive로 생긴 간헐적 응답 에러입니다. ALB에서 5xx가 간헐적으로 났습니다. 재시도 로직 덕에 큰 문제는 없었지만 원인을 찾아야 했습니다. ALB의 idle timeout은 60초인데, BentoML은 timeout을 설정하는 옵션이 없어 ASGI 서버 Uvicorn의 기본값 5초로 돌고 있었습니다. 서버가 5초 뒤 연결을 끊어도 ALB는 이를 모르고 이후 요청을 보내 실패했습니다. 서버 timeout은 ALB 값 이상이어야 하므로, `feat: add uvicorn timeouts options` PR을 올려 BentoML에 설정 기능을 추가했고 에러가 사라졌습니다.

둘째는 Pod와 ALB의 동기화 지연으로 재배포 때 응답 에러가 난 문제입니다. 재배포를 반복해 재현했고, Pod 생명 주기와 ALB Target Group 갱신 주기가 맞지 않는 것이 원인이었습니다. Readiness Gate를 설정하면 Target Group이 ready여야 기존 Pod가 삭제돼 생성 쪽 트래픽 문제는 사라집니다. 하지만 삭제 쪽은 Pod가 사라졌는데 Target Group이 아직 갱신되지 않아 요청이 가는 문제가 남습니다. preStop hook에 지연을 넣어(이 경우 30초) Pod 종료를 늦추면 그 사이 Target Group이 갱신됩니다. 이렇게 지연을 주면 Readiness Gate 없이도 갱신이 끝나므로, 원문은 Pod 삭제 시 적절한 지연만으로 문제를 모두 해결할 수 있다고 정리합니다.

셋째는 BentoML 메모리 릭입니다. BentoML을 올리는 과정에서 메모리 알람이 왔고 메모리가 점차 늘고 있었습니다. 내부 로직을 대부분 빼도, 이전 방식인 Runner로 바꿔도 같았고, 로직이 없는 튜토리얼 샘플 코드에서도 똑같이 메모리가 증가했습니다. 자체 로직이 아닌 BentoML의 문제라고 보고 `bug: memory leak when I am using bentoml>=1.2` 이슈를 올렸습니다. 메인테이너가 알려 준 시험을 해 보고 결과를 공유하기를 몇 차례 반복한 끝에, 새로 추가된 파일 관련 기능의 오작동이 원인으로 밝혀져 수정됐습니다. 원문은 간단한 수정이면 Keep Alive처럼 직접 기여하는 편이 빠르고, 난도가 있다면 이슈를 적극 보고해 메인테이너의 수정을 기대하는 방법이 있다고 정리합니다.

## 마무리와 앞으로의 방향 {#wrap-up}

AI플랫폼의 비전은 "모든 사람을 AI서비스 개발자로"입니다. 앞으로는 UI를 만들어 웹에서 서비스를 쉽게 생성하고 수정하게 하고, 필요한 기능을 설명만 하면 처음부터 끝까지 자동 생성하는 플랫폼이 되는 것이 목표입니다. 이 글은 모회사 Delivery Hero 기술 블로그에도 영문으로 소개됐습니다.

{{% details title="서빙 시스템의 버전 규칙과 timeout 값" closed="true" %}}

| 항목 | 값 |
|---|---|
| 서빙 트래픽 | 월 약 20억 건 |
| Minor 증가 | 로직만 변경 (2.5.3 → 2.6.0), Rolling Update |
| Major 증가 | API 입출력 변경 (2.5.3 → 3.0.0), Blue Green 수동 배포 |
| Patch 증가 | 재학습으로 모델 갱신 (2.5.3 → 2.5.4), Rolling Update |
| ALB idle timeout | 60초 |
| Uvicorn 기본 keep-alive timeout | 5초 |
| preStop hook 지연 | 30초 |
| 대시보드 Namespace 규칙 | serving-sample-project-beta, 정규식 serving-(.*)-beta |

{{% /details %}}
