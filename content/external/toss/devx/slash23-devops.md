---
title: "400개 넘는 GoCD Pipeline의 변경을 검증하는 CI"
description: "400개가 넘는 Pipeline을 어떻게 빠르고 안전하게 고칠 수 있을까요? 토스뱅크는 설정을 Git에 모으고, Helm Template으로 일부 Pipeline에서 변경을 시험하며, CI로 의도하지 않은 차이를 검사했습니다."
date: 2026-11-14
weight: 5
---

# 400개 넘는 GoCD Pipeline의 변경을 검증하는 CI (2023-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [유연하고 안전하게 배포 Pipeline 운영하기](https://toss.tech/article/slash23-devops)
- 매체 · 게시일: 토스 기술 블로그 · 2023-10-12
- 저자: 김동석
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

토스뱅크에서는 Pipeline Template을 잘못 고쳐 배포가 안 되거나 잘못된 배포가 되는 일이 종종 있었습니다. 설정은 이미 Git에 있었습니다. 공통 동작도 Template으로 묶어 관리했지만, 시간이 지나며 복잡해진 Template을 수정하다 보면 오타나 의도하지 않은 변경이 생겼습니다. 변경 이력을 남기는 데서 더 나아가, 변경을 검증할 방법이 필요했습니다.

## 여러 스쿼드의 설정을 모은 Git 저장소 {#visibility}

Micro Service Architecture를 적극적으로 활용하는 토스뱅크는 하루에도 수십~수백 번 서버를 배포합니다. Pipeline은 개발자들이 일상적으로 가장 많이 쓰는 시스템 중 하나입니다. 새 서비스가 자주 생기고 동작도 바뀌므로 빠르게 만들고 고쳐야 하지만, 서비스의 안정성을 위해 일관된 동작도 지켜야 했습니다.

금융권에 적용되는 전자금융감독규정도 준수해야 합니다. 서버를 배포할 때 동료끼리 검증하는 절차 같은 Compliance 요건은 모든 Pipeline에 필요했습니다. 토스뱅크는 이런 요구를 충족하려고 여러 스쿼드의 Pipeline 설정을 한곳에 모으고, DevOps Engineer가 주도적으로 운영했습니다.

주로 사용하는 도구는 GoCD입니다. Jenkins와 비슷하게 Server가 작업을 할당하고 Agent가 실행하며, 웹 UI의 Pipeline Wizard로 새 Pipeline을 만듭니다. 수가 적을 때는 이 방식으로도 큰 어려움이 없었습니다.

400개가 넘는 Pipeline을 웹 UI에서 살피는 일은 달랐습니다. 이름을 알면 검색하면 되지만, 모르면 모든 Pipeline을 훑어야 했습니다. 한 Pipeline의 단계와 순서를 확인하려 해도 여러 페이지를 오가야 했고, 서로 다른 Pipeline을 비교하기도 어려웠습니다. 가장 큰 문제는 이력이었습니다. 동작이 이상해도 웹 UI에는 현재 설정만 보여 언제 어떻게 바뀌었는지 알기 어려웠습니다.

토스뱅크는 설정을 코드로 표현해 Git에 저장하는 Pipeline as Code를 적용했습니다. YAML로 작성한 설정을 gocd-yaml-config-plugin으로 GoCD 서버와 연동했습니다. 수백 개의 Pipeline을 한 폴더에서 살피고, 한 Pipeline의 모든 단계를 한 파일에서 확인하게 됐습니다. Git에 변경 이력이 남으니 설정이 언제 어떻게 달라졌는지도 추적할 수 있었습니다.

## 공통 설정을 한 줄로 줄인 GoCD Template {#productivity}

설정을 찾기 쉬워졌어도 만드는 일은 계속 늘었습니다. 약 6개월 간격으로 집계한 Pipeline 수는 1년에 2배 이상 증가했습니다. 새 서비스는 기존 서비스와 기술 스택과 구성이 비슷한 경우가 많아 설정을 복사해 쓰곤 했는데, 잘못 붙여 넣거나 바꿔야 할 부분을 놓치기 쉬웠습니다. 공통 변경이 생길 때마다 모든 파일을 수정하는 작업에도 같은 위험이 있었습니다.

GoCD Template은 이 반복을 줄였습니다. 여러 Pipeline이 공유할 동작을 Template으로 만들면 공통 설정은 Template을 지정하는 한 줄로 줄어들고, 서로 달라야 하는 값만 변수로 주입하면 됩니다. gocd-yaml-config-plugin과도 함께 쓸 수 있어, 공통 변경을 Template 한곳에 반영하는 방식으로 실수할 여지를 줄였습니다.

수정할 곳은 줄었지만 영향은 커졌습니다. Template을 한 번 고치면 많은 Pipeline에 적용되므로 잘못 고쳤을 때의 영향도 컸습니다. Pipeline 설정은 Git에서, Template 설정은 웹 UI에서 봐야 한다는 점도 불편했습니다. 둘을 비교하며 수정하기 어려운 데다 실수의 영향까지 크니, Template을 유연하게 바꾸기 힘들었습니다.

## 일부 Pipeline에서 먼저 시험하는 Helm Template {#scalability}

토스뱅크는 GoCD Template을 Helm Template으로 대체했습니다. 공통 부분을 Template으로 작성하고 Pipeline마다 다른 값을 Values로 주입해 설정 파일을 Rendering하는 방식입니다. 조건문과 반복문, 변수도 사용할 수 있어 복잡한 동작을 표현할 수 있습니다.

Helm Template은 YAML을 잘 지원하므로 gocd-yaml-config-plugin과도 잘 맞았습니다. GoCD Template이 지원하지 않는 부분까지 Template으로 만들 수 있었고, Template 자체도 파일이어서 Pipeline 설정과 같은 Git 저장소에 둘 수 있었습니다. 설정과 Template을 한곳에서 비교하게 된 것입니다.

변경을 시험할 여지도 생겼습니다. 조건문으로 일부 Pipeline에만 변경된 Template을 적용하면, 전체에 적용하기 전에 테스트용 Pipeline에서 충분히 동작을 검증할 수 있습니다. 이 과정을 거치면서 Template 수정 실수가 모든 Pipeline에 영향을 주는 일이 줄었습니다.

Values 파일은 다른 도구에서도 재사용할 수 있습니다. Pipeline 도구에 종속되지 않는 추상적인 설정을 담고 있기 때문입니다. GitHub Actions 같은 다른 도구를 사용하게 된다면, 그 도구에 맞는 Template 파일을 새로 작성하고 기존 Values를 쓰는 방식입니다.

## 다시 Rendering한 파일의 차이를 찾는 CI {#complexity-ci}

Helm Template으로 표현할 수 있는 내용이 늘어도 수정 실수까지 사라지지는 않았습니다. 2023년 1월 기준 Pipeline에는 5가지 Type과 72개의 설정값이 있었고, Template 파일 길이는 합계 1,182줄이었습니다. Helm Template 문법도 일반 프로그래밍 언어만큼 직관적이지 않아, 복잡해진 내용을 수정하다 오타나 의도하지 않은 변경을 만들기 쉬웠습니다.

토스뱅크는 GitHub Actions로 변경을 자동 검증하는 CI를 구성했습니다. Template 파일은 develop 브랜치에서만 수정하고, 검증을 통과한 변경만 master 브랜치에 반영하도록 했습니다.

검증은 파일 비교에서 시작합니다. develop에 변경이 생기면 모든 Pipeline 설정 파일을 다시 Rendering합니다. 의도한 변경은 이미 설정 파일에 반영되어 있다는 전제입니다. 다시 Rendering했을 때 새로 생기는 차이는 의도하지 않은 변경일 가능성이 높다고 봅니다.

내용이 달라지면 검증은 실패합니다. 사내 메신저로 알람을 보내 작업자가 다시 확인하도록 했습니다. Git에 이력을 남기는 데 그쳤던 Pipeline 설정에, Template을 수정한 뒤 결과를 검사하는 절차가 더해졌습니다.

## 비교할 파일이 없었던 Kubernetes Object {#kubernetes-ci}

같은 검증 방식을 Kubernetes Object에도 적용했습니다. 토스뱅크의 채널계 서비스는 Kubernetes에서 운영하며, 배포할 때 Helm Template으로 Kubernetes Object를 만듭니다. 2023년 1월 기준 7가지 Object와 110개의 설정값을 다뤘고, Template 파일 길이는 합계 762줄이었습니다. 이 Template도 복잡해서 수정할 때 실수하기 쉬웠습니다.

여기에는 비교할 파일이 없었습니다. Pipeline 설정과 달리 Kubernetes Object는 Rendering한 결과를 Git에 저장하지 않고 Kubernetes에 배포했기 때문입니다. 토스뱅크는 검증용 Kubernetes Object 파일을 Git에 저장해 비교 기준으로 삼았습니다.

CI에서는 검증용 파일을 모두 다시 Rendering합니다. 의도한 변경은 이 파일들에 이미 반영되어 있다는 전제도 같습니다. 다시 Rendering하면서 내용이 달라지면 예상하지 않은 변경일 가능성이 높다고 보고, 사내 메신저로 알람을 보냅니다.

CI를 수행하는 동안 Pipeline 설정 파일과 검증용 Kubernetes Object 파일이 모두 바뀌지 않으면, 의도하지 않은 변경이 없는 것으로 간주해 master 브랜치에 자동으로 반영합니다. 이후 실행하는 Pipeline과 이후 배포하는 Kubernetes Object는 변경 사항을 반영한 Template을 사용합니다.

{{% details title="규모와 Template 수치" closed="true" %}}

| 항목 | 값 |
|---|---|
| Pipeline 총수 | 400개 이상 |
| 서비스 빌드/배포 Pipeline | 281개 |
| 작업 자동화 Pipeline | 76개 |
| 기타 Pipeline | 47개 |
| Pipeline 증가 속도 | 1년에 2배 이상 |
| Pipeline Template(2023-01 기준) | 5가지 Type, 설정값 72개, 파일 길이 합계 1,182줄 |
| Kubernetes Object Template(2023-01 기준) | 7가지 Object, 설정값 110개, 파일 길이 합계 762줄 |

{{% /details %}}
