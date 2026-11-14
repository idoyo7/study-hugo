---
title: "LiteLLM과 Langfuse로 만든 GenAI SDK"
description: "우아한형제들 AI플랫폼이 여러 LLM 제공사를 단일 인터페이스로 호출하고 키 관리와 호출 기록, 프롬프트 버전 관리, fallback까지 맡도록 만든 GenAI SDK를 정리했습니다."
date: 2026-11-14
weight: 4
---

# LiteLLM과 Langfuse로 만든 GenAI SDK (2025-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [복잡한 LLM 연동, GenAI SDK 하나로 끝내기](https://techblog.woowahan.com/23667/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2025-11-06
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 규격이 제각각인 LLM API {#background}

GPT, Claude, Gemini 같은 모델이 쏟아지면서 OpenAI, Azure, AWS Bedrock, Google 등 여러 제공사의 API를 함께 다뤄야 했습니다. 원문은 이를 나라마다 콘센트 규격이 다른 상황에 빗댑니다. 프로덕트마다 성능과 속도 요구가 달라 모델을 골라 써야 했고, 제공사별 자격 증명도 따로 안전하게 관리해야 했습니다. 이런 환경은 개발 속도를 늦추고 코드를 복잡하게 만듭니다. 우아한형제들 AI플랫폼은 LLMOps 환경을 구축해 이 문제를 풀었고(LLMOps로 확장하는 AI플랫폼 2.0 글 참고), 이 글은 그중 LiteLLM과 Langfuse를 기반으로 GenAI SDK를 만든 경험을 소개합니다.

## 단일 인터페이스 {#unified-interface}

첫 목표는 어떤 제공사의 모델이든 같은 메서드로 부르는 것이었고, 핵심 엔진으로 100개 이상의 LLM 제공사 API를 하나의 표준 포맷으로 호출하게 해 주는 LiteLLM을 택했습니다. 원문은 Bedrock은 `boto3`의 `invoke_model`, Gemini는 `genai.Client`로 클라이언트 초기화와 호출 메서드, 요청·응답 구조가 모두 다르다는 점을 코드로 비교한 뒤, LiteLLM에서는 `litellm.completion`이라는 단일 함수에 `model` 파라미터만 바꾸면 된다고 보여 줍니다. SDK는 여기서 더 나아가 모델 이름의 패턴(`gpt`, `gemini`, `claude` 등)을 분석해 알맞은 제공사를 찾아 LiteLLM에 넘기므로, 사용자는 `model="gpt-4o-mini"`처럼 모델명만 쓰면 됩니다.

## 키의 중앙 관리 {#key-management}

호출 방식은 통일했지만 API 키는 사용자가 각자 로컬 `.env`나 배포 환경 변수에 일일이 넣어야 했고, 제공사가 늘 때마다 번거로움이 커졌습니다. SDK는 키를 한곳에서 관리하고 사용자는 Langfuse 프로젝트 키만 갖고 호출하게 했습니다. 사용자는 Langfuse 웹 UI의 LLM Connections에 자격 증명을 등록하고, 등록할 때 실제 연결이 되는지 유효성 검증도 합니다. 정보는 Langfuse 데이터베이스에 암호화되어 저장되지만 조회용 공식 API는 없었습니다. 그래서 `GenAIClient`가 초기화될 때 Langfuse 데이터베이스에 직접 접근하고, SDK 내부에 구현한 AESGCM 복호화 로직으로 키를 런타임에 복호화해 LiteLLM의 `Router` 객체에 동적으로 등록합니다. 결과적으로 사용자는 `public_key`, `secret_key`, `llm_connection_names`만 넘겨 클라이언트를 만들면 됩니다.

## 자동 호출 기록 {#tracing}

LiteLLM은 Langfuse와 연동하는 기능이 있어, `GenAIClient`를 초기화할 때 `litellm.callbacks = ["langfuse"]` 몇 줄을 추가하면 모든 호출 기록이 Langfuse로 갑니다. 요청과 응답, 토큰 수, 비용, 응답 지연 시간이 대시보드에 자동으로 쌓여서, 어떤 프롬프트가 어떤 결과를 냈는지 비교하고 분석하기 쉬워지고 LLM 기능의 개발과 실험 속도가 올라간다고 설명합니다.

## 프롬프트 버전 관리 {#prompt-management}

SDK는 Langfuse의 프롬프트 관리 기능을 감싸서 제공합니다. UI에서 프롬프트를 쓰고 테스트하고 버전을 관리하며, 코드에서는 `client.get_prompt("test_prompt")`처럼 이름으로 가져옵니다. `language`와 `text` 같은 변수를 쓰는 동적 템플릿도 `variables` 인자로 치환합니다. Langfuse의 캐싱 덕분에 프롬프트를 고치고 버전만 올리면 코드를 다시 배포하지 않고도 서비스에 반영됩니다.

## fallback으로 오류 대응 {#fallback}

일부 프로젝트가 올해 Azure 장애(미국 동부 지역 가용성 문제)의 영향을 받으면서 LLM API 실패에 대한 대처의 중요성을 알게 됐다고 합니다. `try-except`를 반복해 넣으면 가독성과 유지보수가 나빠지므로, SDK는 `litellm.Router`의 fallback과 재시도 로직을 클라이언트 초기화 설정으로 노출합니다. 원문의 예는 `gemini-2.5-pro` 호출이 실패하면 `gemini-2.5-flash`로 재시도하는 설정과, `gemini_seoul/gemini-2.5-pro`가 실패하면 `gemini_usa/gemini-2.5-pro`로 보내는 리전 기반 fallback입니다. 복잡한 에러 처리를 코드 밖으로 분리해 사용자가 비즈니스 로직에 집중하게 하는 것이 취지입니다.

## 마무리 {#closing}

원문은 이제 사용자가 제공사별 API 명세나 키 관리에 시간을 쓰지 않고 `client.completion` 하나로 어떤 모델이든 부르며, 모든 요청과 프롬프트가 Langfuse에 기록되어 실험과 디버깅이 빨라졌다고 정리합니다. AI플랫폼의 목표는 모든 구성원을 AI 서비스 개발자로 만드는 것이고, GenAI SDK는 복잡한 LLM 인프라를 추상화하는 첫걸음이라고 적습니다.
