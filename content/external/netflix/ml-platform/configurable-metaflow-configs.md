---
title: "Metaflow Config와 Metaboost"
description: "Netflix ML 플랫폼 팀이 Metaflow 2.13에 넣은 Config 객체로 플로의 데코레이터까지 설정 파일로 바꿀 수 있게 됐습니다. Config의 동작 시점, Hydra와의 결합, 사내 도구 Metaboost의 사용 예를 요약합니다."
date: 2026-11-14
weight: 7
---

# Metaflow Config와 Metaboost (2024-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Introducing Configurable Metaflow](https://netflixtechblog.com/introducing-configurable-metaflow-d2fb8e9ba1c6)
- 매체 · 게시일: Netflix TechBlog · 2024-12-20
- 저자: David J. Berg, David Casler, Romain Cledat, Qian Huang, Rui Lin, Nissan Pow, Nurcan Sonmez, Shashank Srikanth, Chaoying Wang, Regina Wang, Darin Yu (ML Platform 모델 개발팀, Casler는 Content Demand Modeling 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 팀마다 다른 요구와 설정 가능한 플로 {#configurable-flows}

Netflix에서는 Metaflow로 수천 개의 플로가 돌아갑니다. 콘텐츠 의사결정자를 돕는 시스템이나 콘텐츠별 자막 언어의 가치를 매기는 시스템처럼, 담당 팀과 업무 목표와 개발 관행이 제각각입니다. 중앙 ML·AI 플랫폼 팀은 팀들이 플랫폼에 맞추는 대신 플랫폼이 팀의 필요에 맞추도록 도구를 만든다는 원칙을 Metaflow 설계 초기부터 지켜 왔습니다. Metaflow는 데이터와 컴퓨트 접근, 프로덕션 수준의 워크플로 오케스트레이션, 협업·버전 관리·의존성·관측 같은 관행을 기본으로 제공하며, 덕분에 사용자는 저수준 문제에 시간을 쓰지 않고 지난 몇 년간 수백만 건의 실험을 돌렸다고 원문은 말합니다.

플랫폼 팀은 각 팀이 만든 도구가 어떤 빈틈을 메우는지 살핍니다. 빈틈이 너무 팀 고유하거나 스택 위쪽의 의견이 강한 것이면 Metaflow 안에 만들지 않고, 그렇지 않으면 더 일반적인 저수준 개념을 뽑아냅니다. 그렇게 반복해서 보인 패턴이 서로 밀접한 플로 묶음을 배포하는 일이었습니다. 테이블 생성, ETL, 배포 작업으로 이어진 큰 파이프라인의 일부인 경우가 많고, 구조는 그대로 두고 데이터, 매개변수, 알고리즘을 바꾼 변형을 시험하고 싶어 했습니다. 자연스러운 답은 설정 파일입니다. 그러나 기본 제공 방법이 없어서 팀들은 JSON 타입 Parameter, IncludeFile, 배포 시점 Parameter로 각자 해결책을 만들었고, 원문 표현으로 "큰 고통을 겪으며" 자체 도구를 만들기도 했습니다. 어느 쪽도 데코레이터를 포함한 플로의 모든 동작을 설정하기는 어려웠습니다. 커뮤니티 Slack에도 @resource의 CPU·메모리를 하드코딩 없이 바꾸는 법, 프로덕션과 스테이징의 @schedule 주기를 다르게 두는 법 같은 질문이 올라왔습니다.

## Config 객체 {#config-object}

답으로 나온 것이 Metaflow의 Config 객체입니다. 기존의 아티팩트, Parameter와 나란히 놓이며, 실행이 시작되기 전에 데코레이터를 포함해 플로의 모든 면을 설정하게 해 줍니다. 셋 모두 Metaflow가 아티팩트로 저장하지만 값이 확정되어 저장되는 시점이 다릅니다.

- 아티팩트: 태스크가 끝날 때마다 확정되어 저장됩니다.
- Parameter: 실행이 시작될 때 확정됩니다. 그 전까지 바꿀 수 있어서 트리거로 값을 넘기는 용도에 많이 쓰이고, 스텝 코드 안에서만 쓸 수 있습니다.
- Config: 플로를 배포할 때 확정됩니다. Argo Workflows 같은 스케줄러에서는 플로를 create할 때, 로컬 실행에서는 실행 직전이 배포 시점입니다. Parameter와 달리 스텝·플로 수준 데코레이터와 Parameter 기본값에도 쓸 수 있습니다.

원문 예시는 TOML 설정 파일입니다. schedule에 cron, model에 optimizer와 learning_rate, resources에 cpu 값을 두고, Metaflow 2.13의 플로가 `Config("config", default="myconfig.toml", parser="tomllib.loads")`로 이를 읽습니다. 클래스에 `@schedule(cron=config_expr("config.schedule.cron"))`, start 스텝에 `@resources(cpu=config.resources.cpu)`를 붙입니다. `config_expr`로는 Config가 정의되기 전에도 참조할 수 있고, 파서는 임의로 정할 수 있으며 문자열로 지정하면 원격에 파서가 없어도 됩니다.

개발자 입장에서 Config는 딕셔너리 같은 아티팩트입니다. 가능하면 점 표기로 키에 접근하고, `**config`로 전체나 일부를 풀 수 있으며 일반적인 대괄호 표기도 됩니다. 딕셔너리 아티팩트가 되므로 자동으로 버전이 매겨지고 저장되어 Client API로 과거 실행의 Config를 읽을 수 있습니다. 데이터, 모델, 코드, Parameter, Config, 실행 환경이 하나의 묶음으로 Metaflow 네임스페이스에 저장되는 셈입니다.

## 설정 파일 너머의 활용 {#beyond-config-file}

원문이 문서에서 가져온 활용 예는 네 가지입니다.

- Parameter와 Config를 섞어 런타임에 바꿀 부분과 배포 때 고정할 부분을 고릅니다. 예를 들어 Config로 Parameter의 기본값을 정하고 실행 시점의 이벤트가 덮어쓰게 할 수 있습니다.
- Pydantic 같은 라이브러리로 설정을 검증하는 파서를 만듭니다.
- 파일 하나에 묶이지 않고 OmegaConf나 Hydra로 계층적인 설정을 관리하거나, Metaboost 같은 도메인 전용 도구로 Config를 생성합니다.
- 외부 서비스에서 설정을 받아오거나 현재 git 브랜치 같은 실행 환경을 읽어 컨텍스트로 넣는 식으로 즉석에서 생성합니다.

과거의 임시방편과 달리 Config는 Metaflow의 다른 기능과 매끄럽게 연동됩니다. 사용자 정의 파서를 쓰더라도 스텝을 원격에서 돌리고 프로덕션에 배포할 수 있고, Config나 파서를 직접 패키징하거나 태스크 간 일관성을 맞출 필요가 없습니다. Runner와 Deployer와도 함께 동작합니다.

## Hydra와 제어 반전 {#hydra-inversion}

Hydra 같은 설정 관리자와 함께 쓰면 여러 설정에 걸친 실험이나 매개변수 공간 탐색을 조율할 수 있습니다. Metaflow는 foreach로 매개변수 격자를 훑는 것은 늘 지원했지만, 실험마다 @resources나 @pypi/@conda 의존성처럼 플로 자체를 바꾸는 일은 쉽지 않았습니다. 보통은 플로를 실행하면서 설정 파일을 읽히지만, Hydra를 쓰면 제어가 거꾸로 되어 무엇을 돌릴지를 Hydra가 설정 파일로 정합니다. 원문은 이를 "don't call us, we'll call you"라는 Hollywood 원칙에 빗댑니다. Runner와 Deployer API 덕분에 Hydra 앱이 Metaflow를 프로그램으로 조작해 수백 개의 플로 변형을 배포하고 실행할 수 있습니다. 문서의 예 가운데 하나는 CPU 코어 수와 텐서 크기를 바꿔 가며 PyTorch를 벤치마크하는 수십 개 플로를 Hydra가 배포하고 결과 시각화를 실시간으로 갱신하는 영상입니다.

## Metaboost {#metaboost}

Metaboost는 ML 실무자가 여러 플랫폼에 걸친 프로젝트를 관리·개발·실행하도록 돕는 Netflix 내부 CLI입니다. Hydra와 비슷하지만 사내 생태계와 통합돼 있습니다. Metaflow를 쓰던 팀이 만든 의견이 강한 프레임워크이고, Config를 도입하게 된 영감의 일부가 이 사례였습니다. ETL·워크플로의 Maestro, ML 파이프라인의 Metaflow, 데이터 웨어하우스 테이블의 Kragle 세 사내 플랫폼의 단일 창구 역할을 하며, 프로젝트 하나를 하나의 설정 체계로 관리하면 일관성이 오르고 위험이 줄어듭니다.

템플릿은 바인딩(binding)으로 만듭니다. Metaflow 파이프라인을 임의의 레이블에 바인딩하고 그 레이블용 설정을 만들면, 바인딩된 설정이 git 저장소·브랜치 등을 담은 전역 설정에 병합됩니다. 플로를 바인딩하면 Metaboost는 바인딩마다 플로를 한 개씩 오케스트레이션 클러스터에 띄웁니다. 원문은 새 콘텐츠 지표가 생기면 모델의 목표 열만 바꿔 첫 버전을 만들고, 이후 하이퍼파라미터, 피처 엔지니어링, 피처 다이어트를 바꾼 실험을 바인딩으로 늘려 가는 시나리오를 듭니다. 실험 수는 과학자가 설정을 쓰는 속도만큼 늘어납니다.

### demo 프로젝트 예시 {#metaboost-demo}

원문의 demo 프로젝트는 Maestro가 관리하는 ETL로 테이블에 데이터를 적재하고, Metaflow가 그 데이터로 간단한 모델을 학습합니다. 저장소에는 파이프라인을 정의한 metaflows, 테이블 DDL이 있는 schemas, 설정 YAML이 있는 settings, Maestro 워크플로가 있는 workflows, 프로젝트를 정의하는 metaboost.yaml이 있습니다. 전역 설정은 fit_intercept와 conda 패키지 버전(numpy 1.22.4, scikit-learn 1.4.0)을 정하고, 실험 EXP_01과 EXP_02는 각자 목표 열과 피처 목록을 더합니다. EXP_01은 runtime, content_type, top_billed_talent를, EXP_02는 runtime, director, box_office를 피처로 씁니다.

Metaboost는 명령을 시작할 때 실험 설정을 전역 설정에 각각 병합하고, `metaboost metaflow settings show`는 값이 어느 파일에서 왔는지 표시하며 병합 결과를 보여 줍니다. 그래서 training.py를 EXP_01과 EXP_02 두 개의 독립 인스턴스로 배포한다는 것을 알고, 바인딩되지 않은 테이블과 ETL 워크플로는 한 번만 배포합니다. 어떤 것을 바인딩하고 어떤 것을 두지 않을지는 metaboost.yaml에 적혀 있습니다.

Metaflow 파이프라인에 붙이는 작업은 MetaboostSettings 믹스인 하나를 FlowSpec에 더하는 것이 전부입니다. 스텝에서는 `self.settings.configuration.features`처럼 점 표기로 값을 읽고, 믹스인된 `show_settings()`가 시작 스텝에서 설정값을 출력합니다. `metaboost metaflow run --binding=EXP_01`을 실행하면 병합된 설정이 `.metaboost/settings/compiled/` 아래 YAML로 직렬화되고, `--config` 인자로 그 파일을 가리켜 training.py가 하위 프로세스로 실행됩니다. 예시 출력에서는 학습이 모두 성공했고 기울기는 약 0.47, 절편은 약 -6.25로 찍혔습니다.

## 맺음과 시작하는 방법 {#takeaways}

Metaboost는 git 기반 매개변수, 전역 설정, 임의로 바인딩한 설정 파일을 묶어 사내 플랫폼에 대해 실행하는 통합 도구입니다. Metaflow Config와의 연동은 믹스인 하나를 더하고 스텝이나 데코레이터에서 설정값을 참조하는 것으로 끝나도록 설계했습니다. 예시는 실험용 학습 템플릿이지만 목표 지표, 사업 계획 등 다른 축으로도 플로를 템플릿화할 수 있다고 원문은 말합니다. 시작은 `pip install -U metaflow`로 최신 버전을 설치하고 문서와 예제 저장소를 보면 되며, 질문은 Metaflow 커뮤니티 Slack으로 받습니다. 이 기능은 Outerbounds가 철저히 테스트하고 예제 저장소를 만들며 협력했습니다.

{{% details title="Config 시점 비교와 demo 설정값" closed="true" %}}

| 구분 | 확정·저장 시점 | 쓸 수 있는 곳 |
|---|---|---|
| 아티팩트 | 태스크 종료 시 | 스텝 코드 |
| Parameter | 실행 시작 시 | 스텝 코드 |
| Config | 배포 시 | 플로 코드, 스텝·플로 데코레이터, Parameter 기본값 |

| 항목 | 값 |
|---|---|
| 필요한 Metaflow 버전 | 2.13 |
| 전역 설정 | fit_intercept true, numpy 1.22.4, scikit-learn 1.4.0 |
| EXP_01 피처 | runtime, content_type, top_billed_talent (목표 metricA) |
| EXP_02 피처 | runtime, director, box_office (목표 metricA) |
| 예시 출력의 학습 결과 | 기울기 약 0.47, 절편 약 -6.25 |
| 컴파일된 설정 위치 | .metaboost/settings/compiled/ |

{{% /details %}}
