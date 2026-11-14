---
title: "제각각인 API를 잇는 LiteLLM·Langfuse 기반 GenAI SDK"
description: "제공사마다 다른 LLM API와 키를 어떻게 함께 다룰까요? 우아한형제들 AI플랫폼은 LiteLLM과 Langfuse를 묶은 GenAI SDK에서 모델 호출, 키 관리, fallback과 프롬프트 실험을 지원합니다."
date: 2026-11-14
weight: 4
---

# 제각각인 API를 잇는 LiteLLM·Langfuse 기반 GenAI SDK (2025-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [복잡한 LLM 연동, GenAI SDK 하나로 끝내기](https://techblog.woowahan.com/23667/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2025-11-06
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 제공사 이름까지 생략한 GenAI SDK {#unified-interface}

모델 하나로 끝낼 수는 없었습니다. 프로덕트마다 요구하는 성능과 속도가 달라 GPT, Claude, Gemini 등을 골라 쓰다 보니 OpenAI, Azure, AWS Bedrock, Google의 API를 함께 다뤄야 했습니다. 나라마다 콘센트 규격이 다른 상황과 닮았습니다. 호출 방식도 다르고, 제공사별 자격 증명도 따로 안전하게 관리해야 했습니다.

우아한형제들 AI플랫폼은 이 복잡함을 줄이기 위해 LLMOps 환경을 구축했습니다. 앞선 글 「LLMOps로 확장하는 AI플랫폼 2.0」에서 소개한 환경 중 LLM 연동을 맡은 도구가 GenAI SDK입니다. 목표는 어떤 제공사의 모델이든 같은 메서드로 호출하도록 만드는 것이었습니다.

기존 코드에서는 클라이언트 초기화부터 달랐습니다. AWS Bedrock은 `boto3`의 `invoke_model`을 사용하고, Google Gemini는 `genai.Client`로 만든 클라이언트에서 다른 메서드와 요청 형식으로 모델을 호출합니다. 응답을 꺼내는 방법도 제각각입니다. SDK의 기반으로 택한 LiteLLM은 100개 이상의 LLM 제공사 API를 표준 포맷으로 통합해, 이런 차이를 번역하는 역할을 합니다. `litellm.completion`에 제공사와 모델명을 지정하면 호출과 응답 처리 방식을 통일할 수 있습니다.

GenAI SDK는 제공사 이름도 생략하게 했습니다. 모델 이름에 들어 있는 `gpt`, `gemini`, `claude` 등의 패턴을 분석해 알맞은 제공사를 찾고 LiteLLM에 넘깁니다. 사용자는 `client.completion`을 호출할 때 `model="gpt-4o-mini"`처럼 모델명만 지정하면 됩니다.

## 키 조회를 위해 직접 접근한 Langfuse 데이터베이스 {#key-management}

호출을 통일해도 키는 남았습니다. 사용자가 제공사별 키를 로컬 `.env` 파일이나 배포 환경 변수에 일일이 등록해야 한다면, 새 제공사를 추가할 때마다 같은 작업을 반복해야 했습니다. GenAI SDK는 자격 증명과 연결 정보를 한곳에 모으고, 사용자는 Langfuse 프로젝트 키로 클라이언트를 초기화하도록 바꿨습니다.

등록 창구는 Langfuse 웹 UI의 LLM Connections입니다. 여기에 자격 증명을 등록하면 실제 LLM에 연결되는지 검증하고, 정보를 암호화해 Langfuse 데이터베이스에 저장합니다. 그런데 등록과 검증 기능은 있어도 저장한 키를 조회하는 공식 API는 없었습니다.

SDK가 데이터베이스에 직접 접근한 이유입니다. `GenAIClient`는 초기화할 때 Langfuse 데이터베이스에서 정보를 읽고, SDK 내부에 구현한 AESGCM 로직으로 런타임에 키를 복호화합니다. 이 자격 증명을 LiteLLM의 `Router` 객체에 동적으로 등록하는 일도 SDK가 맡습니다. 사용자는 제공사별 키 대신 `public_key`, `secret_key`, 사용할 연결 이름인 `llm_connection_names`를 넘겨 클라이언트를 만듭니다.

## 호출 실패에 대비한 Router 설정 {#fallback}

호출할 모델과 키가 준비돼도 API가 응답하지 않는 상황은 남습니다. 일부 프로젝트는 Azure의 미국 동부 지역 서비스 가용성 문제로 실제 영향을 받았습니다. 실패할 때마다 호출 코드에 `try-except`를 반복해 넣는 방식은 가독성을 떨어뜨리고 유지보수를 어렵게 만듭니다.

GenAI SDK는 LiteLLM의 `Router`가 제공하는 fallback과 재시도 로직을 클라이언트 초기화 설정으로 지정하게 했습니다. 예를 들어 `router_args`의 `fallbacks`에 `gemini-2.5-pro`와 `gemini-2.5-flash`를 연결하면, 전자의 호출이 실패했을 때 후자로 재시도하도록 설정할 수 있습니다.

모델을 바꾸지 않고 리전을 바꾸는 설정도 가능합니다. `gemini_seoul`과 `gemini_usa` 연결을 등록한 뒤, `gemini_seoul/gemini-2.5-pro`의 호출이 실패하면 `gemini_usa/gemini-2.5-pro`로 요청을 보내도록 지정하는 예입니다. 오류 처리 전략을 호출 코드 밖의 설정으로 분리해, 사용자가 비즈니스 로직에 집중하도록 했습니다.

## 재배포 없이 이어가는 프롬프트 실험 {#prompt-management}

모델 호출을 안정적으로 처리한 뒤에는 프롬프트를 바꾸고 결과를 확인하는 일이 이어집니다. SDK는 Langfuse의 프롬프트 관리 기능을 감싸서 제공합니다. 사용자는 웹 UI에서 프롬프트를 작성하고 테스트하며 버전을 관리합니다. 코드에서는 `client.get_prompt("test_prompt")`처럼 이름으로 내용을 가져옵니다.

변수가 있는 템플릿도 지원합니다. 가령 번역 프롬프트에 `language`와 `text`를 두고, `variables` 인자로 `Korean`과 `Hello!`를 전달하면 해당 값으로 치환한 프롬프트를 가져옵니다. Langfuse의 캐싱 기능을 이용하므로 프롬프트를 수정하고 버전을 올리면 코드 재배포 없이 서비스에 반영됩니다.

결과를 확인하는 기록도 자동으로 남습니다. `GenAIClient` 초기화 시 Langfuse 연결 정보를 설정하고 `litellm.callbacks = ["langfuse"]`를 지정하면, LiteLLM의 모든 호출 기록을 Langfuse로 보냅니다. 요청과 응답뿐 아니라 토큰 수, 비용, 응답 지연 시간도 대시보드에 쌓입니다. 어떤 프롬프트가 어떤 결과를 냈는지 한곳에서 비교하고 분석할 수 있어 개발과 실험, 디버깅 속도가 향상되었습니다.

우아한형제들 AI플랫폼의 목표는 “모든 구성원을 AI 서비스 개발자로 만드는 것”입니다. GenAI SDK는 사용자가 제공사별 연동 작업에 쓰던 시간을 줄이고 비즈니스 로직과 프롬프트 엔지니어링에 집중하도록 돕는 출발점입니다.
