---
title: "Metaflow Config와 Metaboost로 늘리는 실험"
description: "코드를 고치지 않고 플로마다 CPU, 의존성, 학습 대상을 달리하려면 무엇이 필요할까요? Netflix는 배포 시점에 값을 확정하는 Metaflow Config를 도입해 데코레이터까지 설정하고, Hydra와 Metaboost로 여러 플로 변형을 다룰 수 있게 했습니다."
date: 2026-11-14
weight: 7
---

# Metaflow Config와 Metaboost로 늘리는 실험 (2024-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Introducing Configurable Metaflow](https://netflixtechblog.com/introducing-configurable-metaflow-d2fb8e9ba1c6)
- 매체 · 게시일: Netflix TechBlog · 2024-12-20
- 저자: David J. Berg, David Casler, Romain Cledat, Qian Huang, Rui Lin, Nissan Pow, Nurcan Sonmez, Shashank Srikanth, Chaoying Wang, Regina Wang, Darin Yu (ML Platform 모델 개발팀, Casler는 Content Demand Modeling 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 코드 밖으로 옮기기 어려웠던 Metaflow 설정 {#configurable-flows}

플로의 형태는 유지하고 데이터, 매개변수, 알고리즘만 바꾸고 싶었습니다. Metaflow를 쓰는 팀들 사이에서 반복해서 나타난 요구입니다. 서로 닮은 플로들을 묶어 배포하는 일이 많았고, 이 플로들은 테이블 생성과 ETL, 배포 작업으로 이어지는 더 큰 파이프라인의 일부이기도 했습니다.

설정 파일이면 될 법한 일입니다. 하지만 Metaflow에는 이를 온전히 지원하는 기능이 없었습니다. 팀들은 JSON 타입 Parameter, IncludeFile, 배포 시점 Parameter를 활용하거나, 종종 큰 고통을 겪으며 자체 도구를 만들었습니다. 그래도 데코레이터까지 포함한 플로 전체를 설정하지는 못했습니다. 커뮤니티 Slack에 올라온 질문도 이 빈틈을 드러냅니다. CPU와 메모리를 하드코딩하지 않고 바꾸거나, 프로덕션과 스테이징에서 `@schedule`의 실행 주기를 다르게 정하려는 요구였습니다.

Netflix가 사용하는 Metaflow 플로는 수천 개입니다. 콘텐츠 의사결정자를 돕는 팀과 콘텐츠별 자막 언어의 가치를 매기는 팀은 목표도 개발 관행도 다릅니다. 중앙 ML·AI 플랫폼 팀은 처음부터 도구가 각 팀의 필요에 맞아야 한다는 원칙을 지켜 왔습니다. 데이터와 컴퓨트 접근, 프로덕션 수준의 오케스트레이션, 협업·버전 관리·의존성 관리·관측을 Metaflow가 제공한 덕분에 사용자들은 저수준 문제에 매달리지 않고 지난 몇 년간 수백만 건의 실험을 실행했습니다.

그렇다고 각 팀의 도구를 모두 Metaflow에 넣지는 않습니다. 특정 팀에만 필요한 기능이나 상위 계층의 설계 방식을 강하게 전제하는 기능은 팀의 도구로 남깁니다. 여러 팀에 걸쳐 반복되는 요구에서는 더 일반적인 저수준 기능을 찾아냅니다. 설정 가능한 플로라는 오래된 요구에서 나온 결과가 Config입니다.

## 배포 시점에 확정하는 Config {#config-object}

Config는 실행이 시작되기 전에 데코레이터를 포함한 플로 전체를 설정하는 객체입니다. 값은 배포할 때 확정하고 저장합니다. Argo Workflows 같은 스케줄러에서는 플로를 생성하는 시점이고, 로컬 실행에서는 실행에 필요한 것을 모으는 실행 직전입니다. 이렇게 일찍 정해진 값은 스텝·플로 데코레이터, Parameter 기본값, 플로 내부 코드에서 모두 참조할 수 있습니다.

Parameter는 그보다 늦게 값을 받습니다. 실행을 시작할 때 확정되므로, 트리거가 실행 직전에 전달한 값을 받는 데 자주 쓰입니다. 대신 사용 범위는 스텝 코드 안으로 제한됩니다. 일반 아티팩트는 각 태스크가 끝날 때 확정됩니다. 모두 아티팩트로 저장되지만, 언제 값을 확정하느냐에 따라 쓰임이 달라지는 것입니다.

Metaflow 2.13의 예시는 TOML 파일로 시작합니다. `[schedule]`에는 cron 값 `"0 * * * *"`, `[model]`에는 optimizer `"adam"`과 learning_rate `0.5`, `[resources]`에는 cpu `1`을 둡니다. 플로는 `Config("config", default="myconfig.toml", parser="tomllib.loads")`로 파일을 읽고, 클래스에는 `@schedule(cron=config_expr("config.schedule.cron"))`, start 스텝에는 `@resources(cpu=config.resources.cpu)`를 붙입니다. 실행 주기와 CPU를 코드에 고정하지 않아도 됩니다.

클래스 바깥의 데코레이터에서는 아직 정의되지 않은 Config를 참조해야 합니다. 이때 쓰는 것이 `config_expr`입니다. 파서도 자유롭게 지정할 수 있으며, `"tomllib.loads"`처럼 문자열로 지정하면 원격 실행 환경에 파서가 없어도 동작합니다.

플로 안에서 Config를 다루는 방식은 딕셔너리 아티팩트와 비슷합니다. 가능한 키는 점 표기로 읽고, 일반적인 대괄호 표기나 `**config`로 전체 또는 하위 설정을 풀어 쓰는 방식도 지원합니다. 별도의 이력 관리도 필요하지 않습니다. Config가 딕셔너리 아티팩트로 저장되면서 자동으로 버전이 매겨지므로 Client API에서 과거 실행의 설정을 읽을 수 있습니다. 데이터, 모델, 코드, Parameter, Config, 실행 환경이 Metaflow 네임스페이스 안에 일관된 묶음으로 남습니다.

### 실행 때 바꿀 여지를 남기는 설정 {#beyond-config-file}

Config를 쓴다고 모든 값을 배포 때 고정해야 하는 것은 아닙니다. Config로 Parameter의 기본값을 정하고, 실행을 촉발한 실시간 이벤트가 그 값을 덮어쓰게 할 수 있습니다. 배포 때 정할 부분과 실행 때 받을 부분을 Config와 Parameter로 나누는 방식입니다.

설정을 가져오는 방법도 파일 하나에 한정되지 않습니다. 사용자 정의 파서에서 Pydantic으로 값을 검증하거나, OmegaConf와 Hydra로 여러 파일의 설정을 계층적으로 합칠 수 있습니다. 외부 서비스에서 값을 가져오거나 현재 git 브랜치를 읽어 설정을 즉석에서 만드는 방법도 지원합니다. Netflix의 Metaboost처럼 업무에 맞춘 도구가 설정을 생성해도 됩니다.

이런 확장은 원격 실행과 배포에서도 이어집니다. 사용자 정의 파서를 쓰더라도 Config나 파서를 수동으로 패키징하거나 태스크마다 설정이 일치하는지 관리할 필요가 없습니다. Runner와 Deployer도 Config를 지원합니다. 팀이 원하는 설정 체계를 만들면서 Metaflow의 실행·배포 기능을 함께 쓰도록 한 것입니다.

## 설정을 쓰는 속도로 늘어나는 Metaboost 실험 {#metaboost}

콘텐츠 ML 실무자가 수백 개의 웨어하우스 열에서 피처를 뽑고, 계속 늘어나는 지표에 맞춰 모델을 만드는 상황을 생각해 볼 수 있습니다. 새 콘텐츠 지표가 생기면 목표 열만 바꿔 모델의 첫 버전을 만듭니다. 이후에는 하이퍼파라미터와 피처 엔지니어링을 바꾸거나 피처를 줄여 가며 실험합니다. 이때 필요한 것은 같은 학습 플로의 여러 변형입니다.

Netflix 내부 CLI인 Metaboost는 이런 프로젝트의 개발·관리·실행을 돕습니다. Hydra와 비슷하지만 Netflix 생태계에 통합돼 있으며, ETL·워크플로를 담당하는 Maestro, ML 파이프라인을 담당하는 Metaflow, 데이터 웨어하우스 테이블을 담당하는 Kragle을 한 인터페이스에서 다룹니다. 프로젝트 전체에 같은 설정 체계를 적용해 일관성을 높이고 위험을 줄입니다. Metaflow를 쓰던 팀이 자체 방식을 담아 만든 프레임워크이며, Config를 설계할 때 참고한 사례이기도 합니다.

플로의 변형을 구분하는 단위는 바인딩(binding)입니다. 파이프라인에 임의의 레이블을 붙이고 그 레이블에 맞는 설정을 작성하면, Metaboost가 이를 git 저장소와 브랜치 등을 담은 전역 설정에 병합합니다. 오케스트레이션 클러스터에는 바인딩마다 플로 인스턴스를 하나씩 생성합니다.

바인딩과 Config를 결합하면 실험 수를 과학자가 설정을 작성하는 속도만큼 늘릴 수 있습니다. 같은 방식으로 목표 지표나 사업 계획에 따라 플로를 템플릿화하는 것도 가능합니다. 실험용 학습에만 한정된 기능은 아닙니다.

## 하나의 training.py를 공유하는 demo 프로젝트 {#metaboost-demo}

`demo` 프로젝트는 Maestro의 ETL로 테이블을 채우고, Metaflow가 데이터를 가져와 피처를 가공한 뒤 LinearRegression을 학습합니다. 저장소에는 파이프라인을 정의한 `metaflows`, 테이블 DDL을 담은 `schemas`, 설정 YAML을 모은 `settings`, Maestro 워크플로를 둔 `workflows`가 있습니다. `metaboost.yaml`은 프로젝트와 바인딩할 대상을 정의합니다.

실험은 EXP_01과 EXP_02로 나뉩니다. 전역 설정에는 `fit_intercept true`와 conda 패키지 버전 `numpy 1.22.4`, `scikit-learn 1.4.0`을 두고, 실험별 파일에서 목표 열과 피처 목록을 정합니다. 두 실험의 목표는 모두 `metricA`입니다. EXP_01은 `runtime`, `content_type`, `top_billed_talent`를 사용하고, EXP_02는 `runtime`, `director`, `box_office`를 사용합니다.

Metaboost는 명령을 시작할 때 각 실험 설정을 전역 설정에 병합합니다. `metaboost metaflow settings show --yaml-path=configuration`을 실행하면 바인딩별 병합 결과와 각 값이 어느 파일에서 왔는지 확인할 수 있습니다. 이 설정에 따라 같은 `training.py`를 EXP_01과 EXP_02의 독립 인스턴스로 배포합니다. 바인딩하지 않은 테이블과 ETL 워크플로는 한 번만 배포합니다. 무엇을 실험별로 만들지는 `metaboost.yaml`에 명시합니다.

학습 코드에 연결하는 작업은 짧습니다. 클래스를 `DemoTraining(FlowSpec, MetaboostSettings)`로 선언해 믹스인을 추가하고, 데코레이터나 스텝에서 설정값을 참조합니다. `@conda_base`에는 `MetaboostSettings.get_deploy_time_settings("configuration.conda")`로 읽은 라이브러리를 전달합니다. 스텝에서는 `self.settings.configuration.features`처럼 점 표기로 값을 읽으며, 믹스인이 제공하는 `show_settings()`는 시작 스텝에서 설정값을 출력합니다.

`metaboost metaflow run --binding=EXP_01`을 실행하면 병합한 설정을 `.metaboost/settings/compiled/` 아래 YAML 파일로 저장합니다. 이어서 `--config` 인자로 그 파일을 지정해 `training.py`를 하위 프로세스로 실행합니다. 예시 실행에서는 모든 태스크가 성공했고, 학습한 모델의 기울기는 약 0.47, 절편은 약 -6.25였습니다. 설정 파일에서 고른 피처와 목표 열이 실제 학습까지 이어진 결과입니다.

## 호출 방향을 뒤집은 Hydra {#hydra-inversion}

실험별로 피처만 바꾸는 것으로는 부족할 때도 있습니다. CPU 코어 수나 패키지 의존성 자체를 바꿔 가며 비교해야 할 수 있습니다. Metaflow는 원래 foreach로 매개변수 격자를 탐색할 수 있었지만, 실험마다 `@resources`나 `@pypi`·`@conda`를 달리하는 일은 쉽지 않았습니다.

여기에 Hydra와 Config를 함께 쓰면 호출 방향이 바뀝니다. 보통은 사용자가 플로를 호출하고 플로가 설정 파일을 읽습니다. 이제는 Hydra가 설정 파일을 읽고 무엇을 실행할지 정합니다. Hollywood 원칙의 “don't call us, we'll call you”를 적용한 방식입니다. Runner와 Deployer API를 사용하는 Hydra 앱은 대규모 실험에서 수백 개의 플로 변형을 프로그램으로 배포하고 실행할 수 있습니다.

시연 영상에서는 이 방식을 PyTorch 벤치마크에 사용합니다. Hydra가 CPU 코어 수와 텐서 크기를 달리한 수십 개의 플로 배포를 조율하고, 결과 시각화가 실시간으로 갱신됩니다. Config로 데코레이터까지 바꾸게 되면서 학습 입력뿐 아니라 플로의 자원과 의존성도 실험 설정에 포함할 수 있게 된 것입니다.

## Config를 시험할 문서와 예제 {#takeaways}

`pip install -U metaflow`로 업데이트한 뒤 Config 문서와 예제 저장소에서 사용법을 확인할 수 있습니다. 질문은 Metaflow 커뮤니티 Slack에서 받습니다. Outerbounds는 기능을 철저히 테스트하고 예제 저장소를 만드는 작업에 협력했습니다.

{{% details title="Config의 확정 시점과 demo 설정값" closed="true" %}}

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
