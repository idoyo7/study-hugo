---
title: "생성형 AI 서비스를 위한 AI API Gateway"
description: "AI플랫폼팀이 구성원 인터뷰를 거쳐 가장 먼저 개발한 AI API Gateway를 정리한 글입니다. 자격증명, 프롬프트 템플릿, 프록시, 파이프라인, LangChain 호환과 비용 대시보드로 중복 개발과 재배포 부담을 줄이는 방식을 설명합니다."
date: 2026-11-14
weight: 8
---

# 생성형 AI 서비스를 위한 AI API Gateway (2024-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [생성형 AI 서비스: 게이트웨이로 쉽게 시작하기](https://techblog.woowahan.com/19915/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2024-11-07
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 게이트웨이를 먼저 만든 배경 {#background}

우아한형제들은 업무와 서비스 개발 전반에서 생성형 AI 도구를 쓰고 있고, 사용하는 구성원과 서비스 수도 꾸준히 늘고 있습니다. 대표 사례는 과도하게 확대 촬영된 저품질 메뉴 이미지의 배경을 Google VertexAI Imagen으로 확장(아웃페인팅)하는 기능입니다. AI플랫폼팀은 이런 활용을 더 효율적으로 개발할 환경을 만들려고 먼저 구성원 인터뷰를 진행했습니다.

인터뷰에서 나온 주제는 여섯 가지입니다. API Gateway, 사용자 피드백을 모으는 Experimental Feedback, Lexical과 Semantic 검색을 결합한 Hybrid Search, 사내 또는 공개 LLM을 운영하는 LLM Serving, 프롬프트 실험 환경인 Prompt Experiment, RAG Pipeline 표준화입니다. 팀은 API Gateway를 최우선으로 정했습니다. AWS Bedrock, Azure OpenAI, GCP Imagen 등 여러 서비스를 쓰고 있었고, 서비스마다 프롬프트와 호출 로직이 흩어져 있어서, 다른 기능에 앞서 자격증명과 프롬프트를 한곳에 모으는 Hub가 필요하다고 판단했기 때문입니다.

Kong, Dify.ai 같은 통합 관리 솔루션이 이미 있었지만 직접 만들기로 했습니다. 이유로는 특정 AI 워크로드 요구에 빠르게 대응하기, 빠르게 변하는 기술에 맞춘 유연성, 장기적인 비용 절감, AI 모델과 데이터에 특화된 보안 요구 충족, 기존 인프라와의 통합을 들었습니다.

## 풀려던 세 가지 문제 {#problems}

첫째는 자격증명입니다. 서비스마다 필요한 값이 다릅니다. Azure OpenAI는 endpoint와 API key, GCP VertexAI는 credential json, AWS Bedrock은 IAM Role ARN(과 STS), Naver Cloud Platform은 invoke_url과 secret_key입니다. 이를 AWS Secrets Manager로 관리하니 불편했습니다. 신규 서비스마다 AI플랫폼 개발자에게 보안 암호 생성을 요청해야 했고, 값을 고치면 External Secret을 갱신하려고 Deployment를 배포해야 했습니다. 서비스 단위로 만들다 보니 암호 수가 계속 늘었고, 자격증명의 이력을 추적하기도 어려웠습니다.

둘째는 중복 개발입니다. 외부 API 호출 자체는 간단하지만 실서비스에서는 고민할 것이 늘어납니다. PII는 외부로 나가면 안 되므로 민감 정보가 든 요청은 거부하거나 마스킹해야 합니다. 입출력과 `temperature` 같은 파라미터는 디버깅, 품질 개선, 캐싱에 쓰이니 서비스마다 로깅 저장소와 적재 로직이 필요합니다. 많은 API가 요청량을 무한히 주지 않아 Quota나 Call Rate 제한이 생기므로 예외 처리와 폴백, 그리고 트래픽이 많다면 여러 리소스 중 하나를 고르는 로직까지 필요합니다.

셋째는 비효율적인 배포입니다. 게이트웨이 이전에는 자격증명, 프롬프트, 모델 배포명과 API 버전, 세부 파라미터를 코드나 리소스 파일로 관리했습니다. 값을 고치거나 호출 서비스를 Azure OpenAI에서 AWS Bedrock으로 바꿀 때마다 코드 수정과 배포가 필요했습니다. 게이트웨이는 동적 라우팅과 내부 리소스(템플릿 등) 관리로 이를 해결해서, 데이터 과학자나 비즈니스 로직 개발자가 서버 코드를 고치지 않고 즉시 수정할 수 있게 합니다.

## 구조와 지원 범위 {#architecture}

호출 방식은 두 가지입니다. HTTP 호출은 간단한 프록시나 파이프라인, 다른 서빙 서버와의 연동에 맞습니다. ML SDK는 복잡한 전후 처리가 필요하거나 LangChain 같은 프레임워크와 함께 쓸 때 맞습니다. 서비스 개발자는 필요한 정보만 등록하면 엔드포인트를 받습니다.

지원 서비스는 AWS Bedrock, Azure OpenAI, GCP VertexAI ImageGeneration, 그리고 실험적으로 OCR을 제공하는 Naver Cloud Platform입니다.

## 주요 기능 {#features}

프로젝트는 리소스 수정·삭제 권한을 제한하고 무분별한 호출을 막는 단위입니다. 프로젝트를 만들면 발급되는 `api_key`로 게이트웨이를 쓰고, 베타와 운영 환경은 프로젝트와 `api_key`를 따로 관리합니다.

자격증명 관리는 Secrets Manager 대신 게이트웨이에 등록해 수정과 삭제가 즉시 반영됩니다. AWS Bedrock은 STS로 호출을 제어합니다.

템플릿 관리는 프롬프트를 체계적으로 바꾸고 구성원이 노하우를 공유하는 허브를 겨냥합니다. plain text와 message blocks 형식을 모두 지원하고, plain text는 message block으로 변환돼 저장됩니다. `{style} 스타일로 {user_input}에 대해 설명해줘`처럼 `{key}` 자리에 요청 때 값을 넣어 동적 프롬프트를 만듭니다. 수정할 때마다 버전이 쌓이고 특정 버전으로 복구할 수 있습니다. 한 템플릿으로 여러 모델과 서비스를 비교 실험하는 것도 가능합니다.

프록시는 자격증명, 프롬프트, 파라미터를 한데 정의해 요청 양식을 줄이고, 호출 정보를 클라이언트 서버와 독립적으로 관리하게 합니다. 엔지니어 없이 데이터 과학자가 바로 수정할 수 있고, 다중 자격증명을 등록하면 게이트웨이가 알맞은 것을 골라 쓰기 때문에 대용량이나 순간 트래픽의 Call rate limit을 완화합니다. AWS Bedrock과 GCP VertexAI Imagen도 같은 방식으로 프록시로 등록합니다.

파이프라인은 연속된 호출을 서버 없이 게이트웨이만으로 처리하게 합니다. 모든 경우를 지원하지는 않고 간단한 순차 시나리오가 대상입니다. 원문의 예는 Azure OpenAI로 한국어를 영어로 번역한 뒤 그 결과를 프롬프트로 이미지를 생성하는 파이프라인입니다. 앞 프록시의 결과 필드(`0.response.choices.0.message.content`)를 뒤 프록시의 입력으로 지정합니다. 자격증명, 템플릿, 프록시, 파이프라인은 프로젝트 안에서 재사용할 수 있습니다.

LangChain 호환은 ML SDK의 게이트웨이 클라이언트가 LangChain의 pipe operator(`|`)와 맞물리도록 만들어 제공합니다. 프록시를 알맞게 구성했다면 `service` 값만 바꿔 AI API 제공자를 쉽게 교체할 수 있고, 비동기 호출도 지원합니다.

공용 대시보드는 비용에 비례하는 지표를 보여 줍니다. 텍스트 생성은 입출력 토큰 수에, 이미지 생성은 생성한 이미지 수에 비례해 비용이 매겨지고 API 요청 수와는 비례하지 않기 때문에, 프로젝트나 모델 단위로 (모델, 작업)별 요청량, LLM의 입출력 토큰 수, Vision의 생성 이미지 수를 한눈에 봅니다.

## 향후 계획 {#next-steps}

게이트웨이는 지금 API로만 기능을 제공해서 Postman 같은 HTTP 클라이언트나 호출 코드가 필요합니다. 팀은 개발 중인 AI Studio(서비스 개발·운영용 웹페이지)에 프로젝트, 자격증명, 템플릿 관리와 서비스 요청을 위한 웹뷰를 제공하고, 구성원이 템플릿을 공유하는 템플릿 허브를 구성할 계획입니다. 원문은 서비스 개발자와 소통하며 NoCode로 생성형 AI 서비스를 만들 수 있는 환경을 목표로 삼는다고 맺습니다.

{{% details title="자격증명 종류와 템플릿 요청 예" closed="true" %}}

| 항목 | 값 |
|---|---|
| Azure OpenAI 자격증명 | AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY |
| GCP VertexAI 자격증명 | credential json |
| AWS Bedrock 자격증명 | IAM Role ARN (+ STS) |
| Naver Cloud Platform 자격증명 | invoke_url, secret_key |
| 템플릿 형식 | plain text, message blocks |
| 프록시 선택 정책 예 | random (자격증명 여러 개 중 선택) |
| 프록시 예시 파라미터 | temperature 0.7, max_tokens 50 |
| 지원 서비스 | AWS Bedrock, Azure OpenAI, GCP VertexAI ImageGeneration, Naver Cloud Platform(실험적, OCR) |

{{% /details %}}
