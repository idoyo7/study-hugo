---
title: "Metaflow Spin을 이용한 ML 반복 개발"
description: "Netflix가 Metaflow 2.19에 넣은 spin 명령으로 노트북처럼 한 스텝씩 빠르게 반복 개발하는 방식을 정리했습니다. run·resume·spin의 차이, 입력 주입과 단위 테스트, 코딩 에이전트 활용을 다룹니다."
date: 2026-11-14
weight: 6
---

# Metaflow Spin을 이용한 ML 반복 개발 (2025-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Supercharging the ML and AI Development Experience at Netflix with Metaflow](https://netflixtechblog.com/supercharging-the-ml-and-ai-development-experience-at-netflix-b2d5b95c63eb)
- 매체 · 게시일: Netflix TechBlog · 2025-11-04
- 저자: Shashank Srikanth, Romain Cledat
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 글의 범위 {#scope}

Metaflow는 Netflix가 2019년에 시작해 오픈소스로 공개한 프레임워크로, 지금은 Netflix 안팎의 폭넓은 ML·AI 시스템을 뒷받침합니다. 목표는 두 가지입니다. 마찰을 줄여 빠르게 반복하고 배포하는 것, 그리고 Netflix 규모의 프로덕션에서 적은 오버헤드로 안정적으로 운영하는 것입니다. 두 번째는 검증된 도구들과 함께 풀고, 그 가운데 최근 오픈소스로 공개한 워크플로 오케스트레이터 Maestro가 Netflix 거의 모든 ML·AI 시스템의 기반이자 Metaflow 자체의 백본이라고 원문은 말합니다. 이 글은 첫 번째 목표를 다루며, Metaflow 2.19에 들어간 새 기능 Spin을 소개합니다.

## ML·AI 개발의 반복 주기 {#iteration}

ML·AI 개발은 코드뿐 아니라 크고, 바뀌고, 처리 비용이 큰 데이터와 모델을 중심으로 돕니다. 반복 한 번에 오래 걸리는 데이터 변환과 모델 학습이 들어가고, 실행마다 결과가 조금씩 다른 확률적 과정도 있습니다. 그래서 상태를 유지하며 빠르게 반복하는 일이 생산성의 핵심입니다. Jupyter, Observable, Marimo 같은 노트북이 강한 이유가 이것입니다. 상태를 메모리에 두기 때문에 데이터셋을 한 번 올려 두고 다시 불러오거나 계산하지 않고도 탐색·변환·시각화를 이어 갑니다. 반복 속도를 높이는 도구라면 상태 관리를 일급 설계 요소로 다뤄야 하고, 반복 사이의 연속성을 잃지 않으면서 빠르고 점진적인 실험을 가능하게 해야 합니다.

## spin의 개념 {#spin}

Metaflow 코드는 Airflow 같은 워크플로로 보이지만, 각 `@step`을 체크포인트 경계로 볼 수도 있습니다. 스텝이 끝날 때마다 모든 인스턴스 변수를 아티팩트로 저장하므로 그 지점부터 실행을 이어 갈 수 있습니다. 스텝은 상태를 갱신하는 가장 작은 실행 단위라는 점에서 노트북 셀과 비슷하지만, 노트북 셀의 문제를 해소하는 차이가 있습니다.

- 실행 순서가 명시적이고 결정적이라 셀을 순서 없이 실행해 생기는 의외의 결과가 없음
- 상태가 숨겨지지 않고 `self` 변수로 명시적으로 저장되어 찾아서 들여다볼 수 있음
- 상태가 버전 관리되고 보존되어 결과를 더 재현하기 쉬움

`resume`은 노트북식 반복을 어느 정도 흉내 내지만 고른 스텝부터 끝까지 다시 실행하므로 반복 사이 지연이 큽니다. 노트북은 셀 하나를 고쳐 다시 돌리며 이전 셀의 메모리 데이터를 그대로 쓰니 피드백이 거의 즉각적입니다. Metaflow 2.19의 `spin` 명령이 이 간극을 메웁니다. 노트북 셀 하나를 실행하듯 부모 스텝에서 넘어온 상태를 그대로 쓰며 `@step` 하나만 빠르게 실행합니다.

`run`, `resume`, `spin`은 노트북 동작과 대응되는 보완적 실행 모드입니다. 기록하는 내용도 다릅니다. run과 resume은 메타데이터와 아티팩트를 갖춘 버전 관리되는 전체 실행을 만들지만, spin은 추적을 아예 건너뛰고 개발 중 버리는 반복을 위해 만들었습니다.

원문의 1분짜리 영상은 run과 spin을 번갈아 쓰는 흐름을 보여 줍니다. Parquet 파일에서 데이터셋을 읽고 상품 카테고리마다 모델을 따로 학습하는 플로를 만드는 예로, 컴퓨터 관련 카테고리에 집중합니다. 빈 상태에서 플로를 만들고 최소 버전을 run으로 돌려 테스트용 아티팩트(Parquet 데이터셋)를 남긴 다음, spin으로 한 스텝씩 병렬 학습 스텝 같은 부분을 쌓아 갑니다. 로컬에서 반복을 마친 플로는 Maestro나 Argo 같은 프로덕션 오케스트레이터에 그대로 배포하고, AWS Batch, Titus, Kubernetes 등에서 확장할 수 있습니다. 개발 경험은 노트북만큼 매끄럽고 결과물은 관용적인 Python 프로젝트로 구현된 프로덕션 수준의 확장형 워크플로입니다.

## VS Code·Cursor와 Metaflow Cards {#editor-cards}

터미널에서 run과 spin을 직접 치는 대신 단축키에 묶을 수 있습니다. metaflow-dev VS Code 확장(Cursor에서도 동작)은 Ctrl+Opt+R을 run에, Ctrl+Opt+S를 spin에 묶어서, 코드를 고치고 Ctrl+Opt+S를 누르면 파일을 저장하고 지금 편집 중인 스텝을 spin합니다.

spin이 특히 빛나는 곳은 Metaflow Cards로 미니 대시보드와 리포트를 만들 때입니다. 시각화도 노트북의 강점인데, spin과 Cards를 합치면 실시간·사후 시각화를 개발하는 데 Metaflow가 꽤 괜찮은 대안이 됩니다. 카드 개발은 웹 페이지를 만들듯 코드를 고치고 결과를 바로 봐야 하는 반복적이고 시각적인 작업이며, 웹뷰를 내장한 VS Code·Cursor와 로컬 카드 뷰어와 spin이 그 흐름을 제공합니다. 두 번째 영상은 앞서 만든 train 스텝에 관측 기능을 더하는 모습입니다. Cards의 큰 장점은 관측을 위해 별도의 서비스나 데이터 스트림, 데이터베이스를 배포할 필요가 없다는 점이고, 이렇게 만든 플로를 배포하면 리포트와 시각화까지 갖춘 완전한 시스템이 프로덕션에 올라갑니다.

## 입력 주입과 출력 확인 {#inputs-outputs}

spin은 코드를 실행하는 데 그치지 않고 spin한 스텝의 입력과 출력을 완전히 통제하게 해 줍니다. 노트북과 달리 과거 어떤 실행의 상태로도 임의의 스텝을 spin할 수 있어서, 여러 실행이 만든 모델을 바꿔 가며 추론 스텝에 넣어 보는 식으로 함수를 서로 다른 입력으로 시험하기 쉽습니다.

`ARTIFACTS` 딕셔너리가 든 Python 모듈을 만들어(예: `model`은 `"kmeans"`, `k`는 15) `spin train --artifacts-module artifacts.py`로 가리키면 아티팩트 값을 덮어쓰거나 임의의 Python 객체를 주입할 수 있습니다. 기본적으로 spin은 아티팩트를 저장하지 않으며, `--persist`를 붙이면 저장하되 일반 Metaflow 데이터 저장소가 아니라 디렉터리 단위 위치에 두어서 테스트 뒤에 쉽게 정리할 수 있습니다. 결과는 `inspect_spin(".")`으로 디렉터리를 지정한 뒤 평소처럼 Client API로 읽습니다.

스텝의 입출력을 즉석에서 보고 바꿀 수 있으니 개별 스텝의 단위 테스트도 가능합니다. Runner API로 spin을 프로그램에서 호출해 `Runner("flow.py").spin("train", persist=True)`의 결과를 assert하면 됩니다.

## 코딩 에이전트와 spin {#agents}

spin은 사람뿐 아니라 코딩 에이전트에게도 쓸모가 있었습니다. 에이전트에게 spin을 가르치는 이점은 두 가지입니다. 개발 루프가 빨라진다는 것, 그리고 오류가 더 빨리 드러나며 특정 코드 조각에 연결되어 에이전트가 스스로 고칠 가능성이 커진다는 것입니다. 에이전트는 무엇이 느리고 왜 속도가 중요한지 본래 모르기 때문에 빠른 도구를 쓰도록 유도해야 합니다.

Metaflow 사용자는 이미 Claude Code를 쓰고 있고, 원문은 CLAUDE.md에 "Developing Metaflow code" 절을 넣은 예를 보여 줍니다. 빈 `@step`으로 플로 골격을 만들고, 데이터 로딩 스텝을 더하고, run으로 돌리고, 다음 스텝을 채워 올바른 입력으로 spin해 시험하고, run으로 새 스텝의 출력을 기록하는 일을 모든 스텝이 맞게 돌 때까지 반복한 다음 전체 플로를 run으로 최종 확인하라는 점진적 개발 절차입니다. `spin`은 `run`을 한 번 돌린 뒤에 쓰라는 안내와 두 가지 실행 명령 예시도 들어 있습니다. 이 짧은 지침만으로 에이전트가 spin을 효과적으로 썼습니다.

시연 영상에서는 Claude가 상품 카테고리를 예측하는 분류기를 학습하는 플로를 한 번에 만듭니다. 45초 즈음 Claude가 spin으로 preprocess 스텝을 시험하는데, 테스트 때 데이터를 소량만 샘플링해서 일부 클래스가 부족해지는 데이터 과학의 흔한 함정 때문에 스텝이 처음에 실패합니다. 첫 spin이 문제를 드러냈고, Claude는 층화 샘플링으로 바꿔 고친 뒤 다시 spin으로 확인하고 작업을 이어 갑니다.

## 전체 개발 루프에서의 위치 {#inner-loop}

spin을 더한 이유, 나아가 Metaflow를 만든 이유는 개발 주기를 줄여 구독자에게 더 빨리 즐거움을 전하려는 것입니다. 원문은 이를 가능하게 하는 마법 같은 기능은 하나도 없고 ML·AI 플랫폼의 모든 부분이 맞물려야 한다고 말하며, spin도 그 일부입니다. spin은 모델과 비즈니스 로직 개발의 가장 안쪽 루프를 위한 것이고, 배포 중 단위 테스트를 지원하는 부수 효과도 있습니다. Metaflow 툴체인 전체 청사진에서 파란 상자는 Metaflow 명령을, 파란 글씨는 데코레이터와 기타 기능을 나타냅니다. 지난 한 해 집중한 영역인 Shared Functionality 상자에는 설정 관리와 커스텀 데코레이터가 있어 도메인 팀과 플랫폼 제공자가 Metaflow를 자기 사례에 맞게 조정하게 하며, 조합 가능성이라는 철학에 따라 이 기능들도 spin과 매끄럽게 맞물립니다.

또 하나의 설계 철학은 프로젝트를 작고 단순하게 시작해 필요할 때만 복잡성을 더하는 것입니다. 시작은 `pip install metaflow`이고, 문서와 Metaflow Community Slack에서 질문과 피드백을 받는다고 안내합니다. 감사 인사는 이 기능의 구상부터 리뷰, 테스트, 문서화까지 함께한 Outerbounds의 Ville Tuulos, Savin Goyal, Madhur Tandon과 Model Development and Management 팀에 전합니다.

{{% details title="원문의 주요 명령과 설정" closed="true" %}}

| 항목 | 값 |
|---|---|
| 기능 도입 버전 | Metaflow 2.19 |
| Metaflow 시작 | 2019년 (오픈소스) |
| run, resume | 메타데이터와 아티팩트가 있는 버전 관리 실행 생성 |
| spin | 추적 없음, 부모 스텝의 상태로 스텝 하나만 실행 |
| VS Code 확장 단축키 | metaflow-dev: Ctrl+Opt+R run, Ctrl+Opt+S spin |
| 아티팩트 주입 | `spin train --artifacts-module artifacts.py` (ARTIFACTS 딕셔너리) |
| 아티팩트 저장 | `--persist`, 디렉터리 단위 위치에 저장, `inspect_spin`으로 조회 |
| 단위 테스트 | Runner API의 `spin("train", persist=True)` |
| 프로덕션 배포 대상 | Maestro, Argo / 실행 환경 AWS Batch, Titus, Kubernetes |

{{% /details %}}
