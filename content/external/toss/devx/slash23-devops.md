---
title: "토스뱅크의 배포 Pipeline 운영 방식"
description: "토스뱅크가 400개가 넘는 GoCD 배포 Pipeline을 가시성, 생산성, 확장성, 복잡성 네 가지 어려움에 맞춰 관리한 방법을 정리했습니다. Pipeline as Code, Helm Template, CI를 차례로 도입한 과정입니다."
date: 2026-11-14
weight: 4
---

# 토스뱅크의 배포 Pipeline 운영 방식 (2023-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [유연하고 안전하게 배포 Pipeline 운영하기](https://toss.tech/article/slash23-devops)
- 매체 · 게시일: 토스 기술 블로그 · 2023-10-12
- 저자: 김동석
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## Pipeline과 토스뱅크의 요구 {#pipeline-needs}

Pipeline은 반복하는 일을 자동화하는 시스템입니다. 서버 빌드와 배포가 대표적이고 라이브러리 업로드나 운영 작업 자동화에도 씁니다. Micro Service Architecture를 적극 쓰는 토스뱅크는 하루에 수십~수백 번 서버를 배포하므로, Pipeline은 개발자들이 가장 많이 쓰는 시스템 중 하나입니다.

서비스가 자주 생기고 동작이 자주 바뀌므로 Pipeline을 빠르게 만들고 고칠 수 있어야 합니다. 안정적 운영을 위해 Pipeline끼리 일관되게 동작해야 하고, 금융권에 적용되는 전자금융감독규정에 따라 서버를 배포할 때 동료가 검증하는 절차 같은 Compliance 요건도 모든 Pipeline에서 지켜야 합니다. 토스뱅크는 이를 위해 Pipeline 설정을 중앙화하기로 했고, 여러 스쿼드가 쓰는 설정을 한곳에 모아 DevOps Engineer가 주도해 운영합니다. 도구는 주로 GoCD를 쓰며, Server가 작업을 할당하고 Agent가 실행하는 구조는 Jenkins와 비슷합니다.

## 가시성과 Pipeline as Code {#visibility}

GoCD에서 새 Pipeline은 웹 UI의 Pipeline Wizard로 만듭니다. 토스뱅크에는 서비스 빌드/배포 Pipeline 281개, 작업 자동화 Pipeline 76개, 기타 47개로 400개가 넘는 Pipeline이 있습니다. 이 규모에서는 웹 UI로 어떤 Pipeline이 있는지 보는 것부터 쉽지 않고, 한 Pipeline의 단계를 보려면 페이지를 여러 번 오가야 하며, Pipeline끼리 비교하기도 어렵습니다. 가장 큰 문제는 현재 설정만 보여서 언제 어떻게 바뀌었는지 알 수 없다는 점이었습니다.

해법은 Pipeline as Code, 즉 Pipeline을 YAML 파일로 써서 Git에 저장하고 gocd-yaml-config-plugin으로 GoCD 서버와 연동하는 것입니다. 수백 개 Pipeline을 한 폴더에서 볼 수 있고, 여러 단계도 한 파일에서 확인하며, Version Control로 변경 이력을 추적합니다.

## 생산성과 GoCD Template {#productivity}

토스뱅크의 Pipeline 수는 약 6개월 간격으로 집계하면 1년에 2배 이상 늘었습니다. 새 서비스는 기존 서비스와 기술 스택이 비슷한 경우가 많아 기존 설정을 복사해 붙이다 보니 잘못 붙이거나 바꿀 부분을 빼먹는 실수가 잦았습니다. 모든 Pipeline에 공통 변경이 생길 때도 모든 파일을 고쳐야 해서 실수하기 쉬웠습니다.

GoCD Template은 Pipeline 동작을 추상화해 여러 Pipeline이 공유합니다. 공통 설정은 Template을 지정하는 한 줄로 대체되고 달라야 하는 값은 변수로 주입하며, 공통 변경은 Template만 고치면 모두에 적용됩니다. gocd-yaml-config-plugin과도 함께 쓸 수 있습니다.

## 확장성과 Helm Template {#scalability}

Pipeline 설정은 Git에, Template 설정은 웹 UI에 있어서 둘을 비교하며 Template을 고치기 불편했고, Template 하나를 고치면 많은 Pipeline에 한꺼번에 적용되어 실수의 영향도 컸습니다. 토스뱅크는 Template Rendering 도구인 Helm Template으로 이 문제를 풀기로 했습니다. 공통 부분을 Template으로, 고유 부분을 Values로 주입하고 조건문, 반복문, 변수로 복잡한 내용도 표현할 수 있습니다.

Helm Template은 YAML을 잘 지원해 gocd-yaml-config-plugin과 어울리고, GoCD Template이 지원하지 못하는 부분도 Template으로 만들 수 있습니다. Template이 파일이라 Pipeline 설정과 같은 Git 저장소에 두면 한곳에서 볼 수 있습니다. 조건문으로 일부 Pipeline에서만 Template 변경을 시험해 보고 전체에 적용할 수 있어서 변경 실수가 모든 Pipeline으로 번지는 일도 줄었습니다. Values 파일은 Pipeline 도구와 무관한 추상 설정을 담으므로 GitHub Actions 같은 다른 도구를 쓰게 되면 Template 파일만 새로 쓰면 Values를 재사용할 수 있습니다.

## 복잡성과 CI {#complexity-ci}

Template은 시간이 갈수록 복잡해집니다. 2023년 1월 기준 토스뱅크의 Pipeline은 5가지 Type, 72개 설정값, Template 파일 길이 합계 1,182줄이었고, Helm Template 문법은 일반 프로그래밍 언어만큼 직관적이지 않아 오타나 의도하지 않은 변경으로 배포가 안 되거나 잘못 배포되는 일이 종종 있었습니다.

그래서 GitHub Actions로 CI를 구성했습니다. Template 파일은 develop 브랜치에서만 수정하고, 검증을 통과해야 master에 반영됩니다. 검증은 develop에 변경이 생길 때 모든 Pipeline 설정 파일을 다시 Rendering하는 것으로, 의도한 변경은 이미 파일에 반영돼 있으니 다시 Rendering했는데 내용이 바뀌면 의도하지 않은 변경일 가능성이 높습니다. 이때 검증은 실패하고 사내 메신저로 작업자에게 알립니다.

Kubernetes에 배포하는 Object Template도 같은 문제가 있었습니다. 채널계 서비스는 Kubernetes에서 운영하고 배포할 때 Helm Template을 쓰는데, 2023년 1월 기준 7가지 Object, 110개 설정값, Template 합계 762줄이었습니다. 이쪽은 Rendering 결과를 Git에 저장하지 않고 바로 배포하므로 비교할 파일이 없었고, 그래서 검증용 Kubernetes Object 파일을 Git에 저장하기로 했습니다. CI에서 이 파일들을 다시 Rendering해 같은 방식으로 비교합니다. Pipeline 설정과 검증용 Object 파일이 모두 바뀌지 않았다면 의도하지 않은 변경이 없다고 보고 master에 자동 반영합니다.

## 마무리 {#wrap-up}

원문은 네 가지로 정리합니다. Pipeline이 너무 많아 파악하기 어렵다면 Pipeline as Code, 빠르고 정확하게 만들려면 Template, Template을 고치기 어렵다면 Helm Template, 복잡해서 수정 실수가 많다면 CI가 도움이 된다고 합니다. 보통 Pipeline as Code는 Version Control되는 Pipeline을 뜻하는데, 여기에 Helm Template으로 Programmable한 특성을, CI로 Testable한 특성을 더하면 코드처럼 유연하고 안전하게 운영할 수 있다고 봅니다.

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
