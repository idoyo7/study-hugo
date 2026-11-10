---
title: "OpenAI 인터페이스를 따른 우버 GenAI Gateway"
description: "우버 Michelangelo 팀이 팀마다 제각각이던 LLM 연동을 하나로 모으려고 만든 GenAI Gateway를 정리했습니다. 설계 선택과 PII 리댁터, 그리고 리댁션이 낳는 문제를 요약합니다."
date: 2026-11-10
weight: 21
---

# OpenAI 인터페이스를 따른 우버 GenAI Gateway (2024-07)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Navigating the LLM Landscape: Uber's Innovation with GenAI Gateway](https://www.uber.com/us/en/blog/genai-gateway/)
- 매체 · 게시일: Uber Engineering Blog · 2024-07-11
- 저자: Tse-Chi Wang(Senior Software Engineer, AI Serving 팀), Roopansh Bansal(Senior Software Engineer, Customer Obsession Organization)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 통합 게이트웨이가 필요했던 배경 {#background}

우버에서는 프로세스 자동화, 고객 지원, 콘텐츠 생성 등 60개가 넘는 LLM 활용 사례가 나왔습니다. 문제는 팀마다 연동 방식이 달라 중복 작업이 쌓이고 비효율이 생겼다는 점입니다.

Michelangelo 팀은 이를 모든 LLM 사용 사례의 통합 플랫폼인 GenAI Gateway로 풀었습니다. OpenAI, Vertex AI 같은 외부 벤더 모델과 우버가 직접 호스팅하는 모델을 같은 인터페이스로 쓸 수 있습니다. 온보딩이 쉽고, 사용 사례는 Engineering Security 팀의 표준 검토에서 우버의 데이터 취급 기준에 맞는지 확인받은 뒤에야 게이트웨이 접근 권한을 얻습니다. 테스트를 통과하면 표준 부서 간 개발 절차를 밟습니다. 사용량과 예산을 한곳에서 관리할 수 있다는 점도 이점입니다.

## 설계와 아키텍처 {#architecture}

핵심 결정은 OpenAI API의 HTTP/JSON 인터페이스를 그대로 따르는 것이었습니다. OpenAI가 널리 쓰이고 LangChain, LlamaIndex 같은 오픈소스 생태계가 두텁기 때문입니다. 독자 인터페이스를 만들면 빠르게 변하는 오픈소스 흐름에서 금세 뒤처질 위험이 있다는 판단도 있었습니다. 개발자는 OpenAI 클라이언트를 쓰듯 코드를 쓰면서 Vertex AI 같은 다른 벤더 모델에도 접근합니다. 원문의 예시는 같은 질문을 gpt-4, chat-bison, llama-2-70b-chat-hf-0에 보내 모두 워싱턴 D.C.라는 답을 받는 코드였습니다.

GenAI Gateway는 Go 서비스입니다. 서드파티 벤더 클라이언트를 감싸는 계층이고, 우버 자체 LLM을 위한 서빙 스택이 함께 붙습니다.

- OpenAI: GitHub의 Go 클라이언트를 사내에서 포크해 연동했습니다.
- Vertex AI(PaLM2): 당시 마땅한 Go 구현이 없어 직접 만들어 오픈소스로 공개했습니다. 텍스트 생성, 채팅 생성, 임베딩에 초점을 둔 라이브러리입니다. 이후 Google이 공식 클라이언트를 냈지만 쓰기 쉬워서 계속 지원할 계획입니다.
- 우버 호스팅 LLM: 최신 추론 라이브러리 위에 성능과 효율을 노린 서빙 스택을 직접 구축했습니다.

서빙 외에 인증·인가, 보고와 알림을 위한 메트릭 발행, 비용 귀속·보안 감사·품질 평가에 쓰는 감사 로그도 갖췄고, 모두 우버 사내 생태계에 붙어 있습니다. 원문 시점의 사용 규모는 고객 팀 약 30곳, 월 1,600만 쿼리, 피크 25 QPS입니다.

## MLflow AI Gateway와의 차이 {#comparison}

원문은 Databricks의 MLflow AI Gateway와 기능이 겹치는 부분이 있다고 인정한 뒤 차이를 셋 듭니다. MLflow AI Gateway는 create_route와 query라는 독자 문법을 쓰는 반면, GenAI Gateway는 OpenAI 인터페이스를 거의 그대로 따릅니다. 모든 사용 사례에 일관된 데이터 보안·프라이버시 방식을 적용합니다. 그리고 Python에 그치지 않고 우버 백엔드의 주력 언어인 Java와 Go도 지원합니다.

## PII 리댁터가 낳는 과제 {#pii-redactor}

목표는 네이티브 OpenAI API와 성능·품질이 거의 같아서 전환을 느끼지 못하게 하는 것입니다. 이 목표를 가로막는 대표 과제가 PII 리댁터입니다. 프라이버시와 보안에는 꼭 필요하지만 지연 시간과 결과 품질에 부담을 줍니다.

리댁터는 입력에서 개인 식별 정보를 찾아 익명 placeholder로 바꿉니다. 이름은 ANONYMIZED_NAME_, 전화번호는 ANONYMIZED_PHONE_NUMBER_ 같은 식입니다. 같은 종류가 여러 번 나오면 순번을 붙여 구분하므로 첫 이름은 ANONYMIZED_NAME_0, 두 번째는 ANONYMIZED_NAME_1이 됩니다. 이 매핑은 벤더 응답이 돌아왔을 때 원래 값으로 되돌리는 언리댁션에 쓰입니다. 매핑은 입력 안의 위치에 따라 정해져서, 같은 단어라도 등장 순서가 다르면 다른 placeholder가 붙습니다. 원문의 예에서 George Washington과 Abraham Lincoln은 문장 순서가 바뀌면 NAME_0과 NAME_1이 서로 뒤바뀝니다.

원문은 이 대목에서 끝나며, 지연 시간과 품질 문제를 어떻게 해결했는지는 이 글에 나오지 않습니다.

{{% details title="원문의 규모와 지원 범위" closed="true" %}}

| 항목 | 값 |
|---|---|
| LLM 활용 사례 | 60개 이상 |
| 고객 팀 | 약 30곳 |
| 월 쿼리 | 1,600만 |
| 피크 QPS | 25 |
| 연동 벤더 | OpenAI, Vertex AI(PaLM2), 우버 호스팅 모델 |
| 지원 언어 | Python, Java, Go |

{{% /details %}}
