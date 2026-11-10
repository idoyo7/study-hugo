---
title: "LLM 연동을 OpenAI API로 통일한 GenAI Gateway"
description: "우버는 팀마다 달랐던 LLM 연동을 어떻게 하나로 모았을까요? OpenAI API를 따르는 GenAI Gateway로 기존 도구와의 호환성을 확보했지만, 개인정보를 가리는 과정에는 지연 시간과 결과 품질의 부담이 따랐습니다."
date: 2026-11-10
weight: 12
---

# LLM 연동을 OpenAI API로 통일한 GenAI Gateway (2024-07)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Navigating the LLM Landscape: Uber's Innovation with GenAI Gateway](https://www.uber.com/us/en/blog/genai-gateway/)
- 매체 · 게시일: Uber Engineering Blog · 2024-07-11
- 저자: Tse-Chi Wang(Senior Software Engineer, AI Serving 팀), Roopansh Bansal(Senior Software Engineer, Customer Obsession Organization)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 팀마다 되풀이하던 LLM 연동 {#background}

우버에서는 팀마다 LLM을 붙이는 방식이 달랐습니다. 프로세스 자동화, 고객 지원, 콘텐츠 생성 등 찾아낸 활용 사례는 60개가 넘었지만, 각 팀이 제각기 연동하다 보니 비슷한 작업을 되풀이하며 비효율이 쌓이고 있었습니다.

Michelangelo 팀의 답은 GenAI Gateway였습니다. OpenAI와 Vertex AI 같은 외부 벤더 모델부터 우버가 직접 호스팅하는 모델까지 하나의 인터페이스로 쓰게 하는 플랫폼입니다. 연동을 한곳으로 모으면서 팀별 사용량과 예산을 관리하기도 쉬워졌습니다. 원문이 나온 시점에는 약 30개 고객 팀이 사용했으며, 처리 규모는 월 1,600만 쿼리, 피크 25 QPS였습니다.

## 기존 도구와 호환되는 OpenAI 인터페이스 {#architecture}

통합 플랫폼을 만들면서 API 문법까지 새로 만들지는 않았습니다. GenAI Gateway는 OpenAI API의 HTTP/JSON 인터페이스를 따릅니다. OpenAI가 널리 쓰이고 LangChain, LlamaIndex 같은 오픈소스 도구와도 호환되기 때문입니다. 독자 인터페이스를 만들면 빠르게 변하는 오픈소스 생태계에서 금세 뒤처질 수 있다는 판단도 있었습니다.

개발자는 네이티브 OpenAI 클라이언트를 쓰듯 코드를 작성하고, 기존 도구와 라이브러리도 최소한의 수정으로 연결합니다. 원문의 예제에서는 같은 클라이언트로 gpt-4, chat-bison, llama-2-70b-chat-hf-0에 미국의 수도를 물었습니다. 모델은 달라도 답은 모두 워싱턴 D.C.였습니다.

이 선택은 Databricks의 MLflow AI Gateway와도 차이를 만듭니다. 기능이 겹치는 부분은 있지만, MLflow AI Gateway가 create_route와 query라는 독자 문법을 쓰는 데 비해 GenAI Gateway는 OpenAI API 형식을 유지합니다. Python뿐 아니라 우버 백엔드의 주력 언어인 Java와 Go를 지원하고, 모든 사용 사례에 일관된 데이터 보안·프라이버시 방식을 적용한다는 차이도 있습니다.

## 벤더별 클라이언트를 감싼 Go 서비스 {#vendor-clients}

공통 인터페이스 뒤에는 Go 서비스가 있습니다. 외부 벤더의 클라이언트를 감싸며, 우버 자체 LLM을 위한 서빙 스택도 함께 갖췄습니다. 자체 모델의 서빙 스택은 성능과 효율을 위해 최신 추론 라이브러리로 구축한 것입니다.

벤더마다 Go 연동을 마련하는 사정은 달랐습니다. OpenAI는 GitHub의 Go 클라이언트를 사내에서 포크해 사용했습니다. Vertex AI(PaLM2)는 당시 마땅한 Go 구현이 없어 직접 라이브러리를 만들고 오픈소스로 공개했습니다. 지원 범위는 텍스트 생성, 채팅 생성, 임베딩입니다. 이후 Google이 공식 Vertex AI Prediction 클라이언트를 냈지만, 우버는 사용 편의성을 이유로 자체 라이브러리를 계속 지원합니다.

## 게이트웨이 접근 전에 거치는 보안 검토 {#security-review}

온보딩은 간편하게 하되, 접근 권한에는 조건을 뒀습니다. 각 사용 사례는 Engineering Security 팀의 표준 검토에서 우버의 데이터 취급 기준에 맞는지 확인받아야 합니다. 검토를 통과해야 게이트웨이 접근 권한을 얻으며, 테스트를 통과한 프로젝트는 표준 부서 간 소프트웨어 개발 절차를 따릅니다.

인증·인가도 게이트웨이가 맡습니다. 보고와 알림을 위한 메트릭을 내보내고, 감사 로그는 비용 귀속과 보안 감사, 품질 평가에 씁니다. 이 기능들은 모두 우버 사내 생태계와 통합돼 있습니다.

## 문장 순서에 따라 달라지는 익명 표식 {#pii-redactor}

인터페이스를 맞춰도 끝은 아닙니다. 우버가 세운 목표는 네이티브 OpenAI API를 쓸 때와 성능·품질이 거의 같아 전환을 느끼지 못하게 하는 것입니다. 개인 식별 정보(PII)를 가리는 리댁터는 민감한 정보의 외부 유출을 막기 위한 장치이지만, 지연 시간과 결과 품질에 부담을 줍니다.

리댁터는 요청을 외부 벤더에 보내기 전에 입력을 검사해 PII를 익명 표식으로 치환합니다. 이름에는 ANONYMIZED_NAME_, 전화번호에는 ANONYMIZED_PHONE_NUMBER_를 쓰고, 서로 다른 이름에는 ANONYMIZED_NAME_0, ANONYMIZED_NAME_1처럼 순번을 붙입니다. 벤더의 응답이 돌아오면 이 매핑을 따라 원래 값으로 복원하는 언리댁션을 수행합니다.

번호는 이름의 등장 순서에 달려 있습니다. 원문의 예제에서는 George Washington이 미국의 초대 대통령이라는 문장 뒤에 Abraham Lincoln이 남북전쟁 당시의 리더십으로 알려져 있다는 문장이 나옵니다. 이 순서에서는 Washington이 ANONYMIZED_NAME_0, Lincoln이 ANONYMIZED_NAME_1입니다. 문장 순서를 바꾸면 Lincoln이 ANONYMIZED_NAME_0, Washington이 ANONYMIZED_NAME_1을 받습니다. 같은 이름도 입력 안의 위치에 따라 다른 표식으로 바뀝니다.

지연 시간과 품질 문제의 해결책이나 개선 수치는 원문에 제시되지 않았습니다.

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
