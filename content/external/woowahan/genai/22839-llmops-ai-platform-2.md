---
title: "LLMOps로 확장한 AI플랫폼 2.0"
description: "AI플랫폼 1.0의 MLOps에서 GenAI 중심의 2.0으로 넓히며 만난 여덟 가지 운영 문제와 해법입니다. Langfuse 기반 Studio, SDK, API Gateway, Labs를 어떻게 설계했는지와 도입 뒤 사용자와 프로젝트의 성장을 다룹니다."
date: 2026-11-14
weight: 6
---

# LLMOps로 확장한 AI플랫폼 2.0 (2025-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [LLMOps로 확장하는 AI플랫폼 2.0](https://techblog.woowahan.com/22839/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2025-09-29
- 저자: 본문에 저자 미표기
- 시리즈: AI플랫폼 1.0(MLOps)을 다룬 「배민 앱에도 AI 서비스가? AI 서비스와 MLOps 도입기」와 「제목은 안정적인 AI 서빙 시스템으로 하겠습니다. 근데 이제 자동화를 곁들인…」의 후속 성격입니다.
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## MLOps에서 LLMOps로 {#from-mlops-to-llmops}

AI플랫폼팀은 1.0에서 머신러닝 모델의 개발, 배포, 운영을 돕는 MLOps 플랫폼을 만들어 왔습니다. LLM이 등장하면서 모델을 직접 학습하지 않아도 파운데이션 모델 API를 호출하는 것만으로 AI 프로덕트를 만들 수 있게 됐습니다. ML 시대의 과제가 데이터 준비, 학습, 재학습 운영이었다면 LLM 시대에는 비용, 지연 시간, 외부 의존성이 과제가 됩니다. 사내에서는 지난 1~2년 동안 AI 프로덕트가 10개 넘게 만들어졌고, 만드는 사람도 데이터 사이언티스트와 ML 엔지니어에서 PM, 프론트엔드, 백엔드 엔지니어로 넓어졌습니다. 프로덕트와 고객이 빠르게 늘면서 운영 문제가 본격적으로 드러났고, 팀은 GenAI 중심의 AI플랫폼 2.0을 준비해 LLMOps를 플랫폼 차원에서 지원하는 것을 핵심 목표로 삼았습니다.

## 운영 중 드러난 여덟 가지 문제 {#eight-problems}

1. 멀티 Provider 복잡성. Azure OpenAI, Google Gemini, AWS Bedrock은 API 스펙이 모두 달라 같은 기능도 매번 다른 코드로 써야 했고, 벤더별 크레덴셜 발급과 관리까지 겹쳐 서비스가 늘수록 부담이 커졌습니다.
2. 프롬프트 관리 한계. 프롬프트가 코드, 시트, 파일에 흩어져 어느 버전이 실제 배포 버전인지 알기 어려웠고 재현성과 협업이 떨어졌습니다.
3. 안정성 문제. 2025년 4월에는 Azure OpenAI East US 리전 장애로 GPT-4 계열 모델이 장시간 응답하지 못했습니다. 특정 단어가 안전성 필터에 걸리면 Google Gemini가 PROHIBITED_CONTENT 오류를 돌려주기도 했습니다. 동일 모델을 다른 리전에 재배포하고 트래픽을 우회해 대응했습니다.
4. 비용과 리소스 관리. 벤더 콘솔을 보고 시트에 정리하는 수동 방식으로는 프로젝트별 비용을 알 수 없었습니다. AWS Bedrock처럼 여러 프로젝트가 한 모델을 공유하면 Application Inference Profile을 수동으로 관리해야 했고, 클라이언트 타임아웃 뒤의 자동 재시도로 요금이 폭증한 사례도 있었습니다.
5. 실험 관리 부재. 프롬프트와 실험 결과를 Google 시트로 관리하다 보니 이력이 쉽게 사라졌고, Golden Dataset을 기준으로 Evaluation Dataset을 넓혀 가는 구조가 없어 여러 팀이 같은 실험을 반복했습니다.
6. 새로운 고객층. PM과 기획자도 LLM을 쓰고 싶어 했지만, 코드 없이 프롬프트만으로 실험할 환경이 부족했습니다.
7. 크레덴셜 발급 허들. 보안 검토와 비용 승인을 거쳐야 키가 나와 PoC 단계의 실험이 막혔습니다. '아이디어는 있지만 첫 호출조차 못 해본다'는 피드백이 여러 팀에서 나왔습니다.
8. 보안과 개인정보. 이름, 연락처, 계좌번호, 주민등록번호 같은 민감 정보가 필터 없이 외부 벤더로 넘어갈 위험이 있었습니다.

서비스 개발자 인터뷰에서는 프롬프트 관리 기능(91%)과 Trace 수집을 통한 Observability(45%)가 우선순위가 가장 높았습니다. 이 요구에 가장 직접 답하는 첫 컴포넌트가 Studio였고, 이후 SDK, API Gateway, Labs로 넓혔습니다.

## GenAI Studio와 Langfuse {#genai-studio}

Studio는 프롬프트 관리, Observability, 크레덴셜 관리, Evaluation 네 가지를 해결하는 운영 허브입니다. 기반 솔루션 후보로 MLflow, PromptFlow, LangSmith, Agenta, Opik, Pezzo, OpenPrompt를 검토했습니다. MLflow는 LLM 특화 기능이 부족했고, PromptFlow는 독립 웹 UI가 없었고, LangSmith는 LangChain 중심이라 범용성이 제한됐습니다. Agenta와 Opik은 엔터프라이즈 성숙도가, Pezzo는 운영 모니터링과 피드백 기능이, OpenPrompt는 로깅·버전 관리·권한 체계가 아쉬웠다고 합니다.

팀은 처음부터 프롬프트 관리와 Trace 기반 Observability를 핵심으로 설계한 Langfuse를 골랐습니다. 프롬프트를 텍스트, 변수, 구성 단위로 쓰고 라벨이나 버전으로 구분하며, 요청의 입출력, 재시도, 지연, 비용을 Trace로 기록하고, 대시보드와 A/B 테스트, 데이터셋 관리까지 지원하며 self-hosted도 됩니다. self-hosted라 ClickHouse와 Redis 같은 운영 컴포넌트가 늘어나는 부담은 있지만, 대규모 트래픽을 고려한 확장 아키텍처를 갖췄다는 점에서 장기적으로 강점이라고 판단했습니다.

Studio에서 가장 많이 쓰는 기능은 다음과 같습니다.

- 프롬프트 관리. 버전별 저장과 변경 이력 추적, 모델 간 성능 비교, 이전 버전 롤백이 가능하고 운영 배포 버전을 지정합니다.
- Observability. 요청 단위 Trace로 지연, 비용, 오류 지점, 토큰 사용량을 봅니다. Application 레이어가 Studio로 LLM 응답을 모으고, Collection 레이어가 Trace는 ClickHouse에, 서비스와 시스템 메트릭은 Prometheus에 저장하는 3계층 구조입니다. 기존 Grafana 서빙 모니터링에서는 평균 응답 시간의 변동이 커서 지연 원인을 찾기 어려웠는데, 도입 뒤에는 모델별 응답 속도를 Percentile로 분석하고 Trace에서 병목을 확인할 수 있게 됐습니다. ClickHouse와 Superset으로 프로젝트별 비용 모니터링과 알림도 구축했습니다.
- 크레덴셜 관리. 크레덴셜을 Studio에 한 번 등록하면 SDK가 Studio의 단일 API 키로 프로젝트에 등록된 모든 모델을 호출합니다. 예전에는 AWS Secret Manager나 환경 변수에 일일이 등록했고 누가 어떤 키를 쓰는지 파악하기도 어려웠습니다.
- Evaluation. 사람이 검수한 작은 Golden Dataset을 기준선으로 쓰고, 실제 서비스 데이터를 넓혀 Evaluation Dataset을 만듭니다. 실험마다 응답 속도, 비용, 정확도를 비교하며 Manual Annotation, User Feedback, LLM-as-a-Judge 방식으로 평가합니다.

## SDK, API Gateway, Labs {#sdk-gateway-labs}

GenAI SDK는 모델 선택, 라우팅, Trace 로깅, 크레덴셜 관리처럼 서비스마다 반복되는 기능을 패키지로 묶습니다. LiteLLM을 기반으로 모델 이름만 바꿔 여러 LLM을 호출하고, 여러 리전과 벤더 사이의 라우팅, 로드밸런싱, Fallback을 지원합니다. Studio에 저장된 프롬프트를 불러와 동적으로 컨텍스트를 주입할 수도 있습니다.

GenAI API Gateway는 SDK 기능을 그대로 내장해 OpenAI-Compatible API로 제공합니다. OpenWebUI, Langfuse Playground, LangChain, LlamaIndex 같은 도구와 추가 개발 없이 연동되고, REST API라서 Python이 아닌 앱이나 웹·모바일 앱에서도 쓸 수 있습니다.

GenAI Labs는 프롬프트 관리, 실험 실행, 성능 평가, 결과 분석을 한 워크플로로 묶은 도구로 직접 만들었습니다. LLM 제공사의 신기능을 바로 실험하고, Studio와 긴밀히 연동하고, 코드 수준에서 평가 지표를 정의하고, Prompt Variables로 Context Engineering을 하기 위해서입니다. Studio의 UI만으로는 Context Engineering을 적용하기 어려웠고, 당시 Langfuse Playground는 멀티모달 입력을 지원하지 않았다고 합니다. 활용은 세 가지입니다. 단일 테스트는 개발 초기에 특정 사례를 빠르게 검증하고, 배치 실험은 Golden Dataset으로 모델을 비교하며, 데이터셋 업로드는 입력, 출력, 메타데이터를 매핑해 프로젝트별로 Studio에 올립니다.

## 여덟 가지 문제의 해결 {#solutions}

- 멀티 Provider는 SDK의 단일 인터페이스와 Gateway의 OpenAI-Compatible 인터페이스로 풀었습니다.
- 프롬프트 관리는 Studio에서 중앙 관리해 버전별 성능과 변경 이력, Trace를 추적하게 됐습니다.
- 안정성은 SDK의 Retry/Fallback으로 리전 장애 때 다른 리전이나 모델로 트래픽을 전환하고, Trace로 문제 구간을 분석하며, 자체 개발한 PII 탐지 모듈로 개인정보가 든 입력을 요청 전에 차단합니다.
- 비용은 Studio가 요청별 토큰과 비용을 기록하고 Superset이 팀과 프로젝트 단위 리포트를 만들며, 예산 초과나 비정상 패턴을 알림으로 잡습니다.
- 실험 관리는 Labs가 Golden/Evaluation Dataset으로 평가하고 결과를 Studio에 자동 저장합니다.
- 새로운 고객층은 Labs와 Studio UI로 비개발자도 프롬프트만으로 실험하게 됐습니다. 다만 개발자 중심으로 설계된 정책과 워크플로가 비개발자에게는 여전히 어려웠고, UI에 시스템 내부 개념이 그대로 드러났습니다. 팀은 Langflow, n8n 같은 시각적 워크플로 도구 도입을 고민하고 있고 직군별 이해 수준에 맞는 정책 체계를 새로 설계하는 과제가 남아 있습니다.
- 크레덴셜 발급은 PoC 전에 보안 검토를 거치면 공용 API 키 하나로 여러 벤더 모델을 자유롭게 실험하고, 정식 과제가 되면 필요한 모델에 대해서만 정식 키를 발급받는 방식으로 정책화했습니다.
- 개인정보는 외부 호출 전에 PII 탐지 모듈이 이름, 연락처, 계좌번호, 주민등록번호가 든 요청을 차단하고 로그를 남깁니다. Studio 수준에서 정책화해 모든 프로젝트가 같은 절차를 따릅니다.

LLMOps 사이클 관점에서는 개발 단계에서 Studio, SDK, API Gateway로 프롬프트를 저장하고 호출하며, 연구 단계에서 Studio, SDK, Labs로 실험하고 평가하며, 운영 단계에서 라벨 기반 A/B 테스트와 배포, Trace 기반 모니터링을 하고 쌓인 데이터를 다시 Golden/Evaluation Dataset으로 정제해 연구 단계에 돌려줍니다.

## 도입 결과와 앞으로의 방향 {#results}

원문은 정성적으로 Observability, 보안, 안정성이 갖춰져 운영 체계의 신뢰성이 강화됐고, 개발과 배포가 표준화되며 생산성이 올랐다고 정리합니다. 정량적으로는 2025년 기준 사용자 수가 전년 대비 50%, 프로젝트 수가 69% 늘었습니다. 2022~2024년에는 데이터사이언티스트와 ML 엔지니어 중심이었지만 2025년에는 기타 직군의 비중이 38.3%로 늘었습니다.

팀의 목표는 프로덕트를 만들며 필요한 공통 기능을 플랫폼화하고 이를 다시 활용해 더 많은 프로덕트를 만드는 선순환입니다. 앞으로는 Context Engineering과 Agentic Design Patterns 같은 기법이 점점 중요해질 것으로 봅니다.

{{% details title="도입 지표와 인터뷰 수치" closed="true" %}}

| 항목 | 값 |
|---|---|
| 사내 AI 프로덕트 | 지난 1~2년 사이 10개 이상 |
| 인터뷰 우선순위 | 프롬프트 관리 91%, Observability 45% |
| 기반 솔루션 | Langfuse (self-hosted, ClickHouse·Redis 추가 운영) |
| SDK 기반 | LiteLLM |
| 기타 직군 활용 비중 | 2025년 38.3% |
| 사용자 수 | 2025년 기준 전년 대비 50% 증가 |
| 프로젝트 수 | 2025년 기준 전년 대비 69% 성장 |
| 사용자 성장 지수(2022년=100) | 2023년 625%, 2024년 38%, 2025년 50% 추가 성장 |
| 신규 LLM 프로젝트 증가율 | 2023년 대비 2024년 333%, 2025년 633% |

{{% /details %}}
