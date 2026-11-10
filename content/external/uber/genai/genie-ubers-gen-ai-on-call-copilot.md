---
title: "Slack 온콜의 긴 기다림에서 출발한 코파일럿 Genie"
description: "문서에 답이 있는데도 Slack에서 온콜을 기다려야 하는 문제를 어떻게 줄일까요? Uber는 흩어진 문서를 검색하는 RAG 코파일럿 Genie를 만들고, 답변과 문서의 품질을 함께 평가했습니다."
date: 2026-11-10
weight: 19
---

# Slack 온콜의 긴 기다림에서 출발한 코파일럿 Genie (2024-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Genie: Uber’s Gen AI On-Call Copilot](https://www.uber.com/us/en/blog/genie-ubers-gen-ai-on-call-copilot/)
- 매체 · 게시일: Uber Engineering Blog · 2024-10-10
- 저자: Nicholas Marcott(Staff Software Engineer, TLM, Uber AI Feature Store 팀), Eduards Sidorovics(Senior Software Engineer, Uber AI Platform 팀), Paarth Chothani(Staff Software Engineer, Gen AI/CoreML 팀), Xiyuan Feng(Software Engineer, Feature Store 팀), Chun Zhu(Senior Software Engineer, Uber AI Platform 팀), Meghana Somasundara(Product Lead, Uber AI Platform), Kailiang Fu(Associate Product Manager, Michelangelo 팀), Jonathan Li(Software Engineer, Uber AI Platform 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 답이 있어도 기다려야 했던 Slack 채널 {#problem}

온콜 지원에서 기다림은 한 번으로 끝나지 않았습니다. 사용자가 Slack에 질문을 올리면 담당 엔지니어가 답하거나 추가 정보를 요청했고, 사용자가 내용을 보충한 뒤에는 다시 응답을 기다려야 했습니다. 몇 차례 대화가 오가야 질문이 해결되는 흐름입니다.

Michelangelo를 비롯한 Uber 팀의 지원 채널에는 한 달에 약 45,000건의 질문이 올라왔습니다. 많은 질문과 긴 대기에 사용자와 온콜 엔지니어 모두 생산성을 잃었습니다. 답은 이미 문서에 있는 경우가 많았지만, 사내 위키 Engwiki와 사내 Stack Overflow 등에 흩어진 정보를 찾기가 어려운 상황입니다. 같은 질문이 반복되면서 수백 개 Slack 채널의 온콜 수요가 커졌습니다.

## 예시 데이터 없이 출발한 RAG {#rag-choice}

Uber는 Genie를 빠르게 선보이기 위해 RAG를 택했습니다. 질문과 관련된 문서를 검색해 LLM에 답변 근거로 제공하는 방식입니다. 파인튜닝으로 시작하려면 품질이 높고 다양한 예시 데이터를 먼저 준비해야 했고, 모델을 최신으로 유지하는 데도 컴퓨팅 자원이 들었습니다. RAG는 이런 예시 없이 시작할 수 있어 출시까지 걸리는 시간을 줄일 수 있었습니다.

수집할 문서부터 골라야 했습니다. 내부 소스라고 모두 Slack에 공개할 수 있는 자료는 아니기 때문입니다. Uber는 대다수 엔지니어가 열람할 수 있는 소스를 미리 추려 사용했습니다. OpenAI나 접근 권한이 없는 사람에게 노출해서는 안 되는 데이터가 새는 일을 막으려는 조치입니다.

환각을 줄이려면 검색 결과를 LLM에 건네는 방식도 정해야 했습니다. 각 결과를 sub-context라는 구간으로 나누어 출처 URL과 함께 넣고, LLM에는 그 안의 내용만으로 답하면서 근거 URL을 제시하라고 지시했습니다. 이렇게 모든 답변에 출처를 붙입니다. 관련 문서를 찾는 일에 더해, 답변이 사용할 근거의 범위까지 프롬프트에 명시한 것입니다.

## Engwiki에서 Sia까지 이어지는 검색 경로 {#architecture}

Genie가 사용하는 지식은 Engwiki, 사내 Stack Overflow, 엔지니어링 요구 문서 같은 내부 소스에서 옵니다. 문서를 수집하고 벡터로 변환한 뒤 검색에 쓸 데이터를 적재하는 과정은 Apache Spark 애플리케이션으로 구현했습니다.

### 청크와 인덱스를 준비하는 적재 작업 {#ingest}

Spark 앱은 Engwiki나 사내 Stack Overflow API에서 콘텐츠를 가져옵니다. 결과는 원본 URL과 본문을 문자열 열에 담고 메타데이터를 함께 기록한 Spark 데이터프레임입니다. 위키 본문은 langchain으로 작은 조각인 청크로 나눕니다. 이어 PySpark UDF에서 OpenAI 임베딩 모델을 호출해 각 청크를 벡터로 바꾸고, 청크와 벡터를 짝지은 결과를 Uber의 블롭 스토리지 Terrablob에 저장했습니다.

접근 범위도 채널에 맞췄습니다. 생성한 임베딩은 해당 Engwiki 공간과 연결된 Slack 채널에서만 접근할 수 있습니다.

검색을 맡는 벡터 데이터베이스는 Uber가 자체 개발한 Sia입니다. 부트스트랩 잡이 Sia에 데이터를 적재하고, Spark 잡 두 개가 인덱스 빌드와 병합을 수행해 Terrablob에 넣습니다. 각 리프 노드는 Terrablob에서 기본 인덱스와 스냅샷을 내려받아 동기화합니다. 조회할 때는 쿼리가 각 리프로 직접 전달되는 방식입니다.

### 관련 청크를 찾는 Knowledge Service {#knowledge-service}

Slack에 질문이 올라오면 백엔드의 Knowledge Service가 질문을 임베딩으로 변환하고 벡터 데이터베이스에서 가장 관련 있는 청크를 가져옵니다. 이 결과가 LLM에 넘길 프롬프트의 컨텍스트가 됩니다. 앞서 정한 sub-context와 출처 URL은 검색한 내용을 답변의 근거로 전달하기 위한 형식입니다.

호출 비용은 UUID로 추적합니다. Slack 클라이언트 같은 호출자가 Knowledge Service에 UUID를 넘기면, 서비스는 이를 컨텍스트 헤더에 담아 Michelangelo Gateway로 전달합니다. Gateway는 LLM으로 요청을 전달하는 패스스루 서비스입니다. 이 과정에서 호출을 감사 로그에 남겨 UUID별 비용을 추적합니다.

## Slack 피드백과 문서 품질을 함께 살피는 평가 {#evaluation}

Genie는 답변에 다음 행동을 고르는 버튼을 붙였습니다. 사용자는 후속 질문을 하거나, 해결로 표시하거나, 사람의 지원을 요청할 수 있습니다. 답변을 더 꼼꼼히 읽도록 유도하고, 해결되지 않은 질문은 온콜 엔지니어에게 넘기기 쉽게 만든 흐름입니다.

답변 피드백에서는 도움을 받은 정도와 사람이 맡아야 할 요청을 구분합니다.

- Resolved: 답변으로 문제가 완전히 해결됨
- Helpful: 부분적으로 도움이 되었지만 추가 도움이 필요함
- Not Helpful: 답이 틀렸거나 관련이 없음
- Not Relevant: 코드 리뷰처럼 온콜 담당자가 필요한 요청

Slack 플러그인은 이 피드백을 Kafka 토픽으로 보내고, Hive 테이블에 메타데이터와 함께 쌓습니다. 대시보드에서는 이렇게 모은 사용자 반응을 확인합니다.

환각이나 답변 관련성을 더 살펴보고 싶다면 사용자가 원하는 지표로 평가를 실행할 수도 있습니다. 여기에 쓰는 것은 Michelangelo 컴포넌트를 재사용한 별도 ETL 파이프라인입니다. Hive에 저장한 Genie의 컨텍스트와 응답을 Slack 메타데이터, 사용자 피드백과 결합한 뒤 Evaluator에 넘깁니다. Evaluator는 지정한 프롬프트로 LLM이 응답을 평가하게 하고, 지표를 UI의 리포트에 기록합니다. 사용자는 이 결과를 검색과 생성 구성요소를 조정하는 데 쓸 수 있습니다.

평가 대상에는 원본 문서도 포함됩니다. 문서가 부실하면 LLM이 아무리 좋아도 답변 품질에는 한계가 있기 때문입니다. 수집한 문서를 한 행에 하나씩 담은 Spark 데이터프레임으로 만들고, 맞춤 프롬프트를 받은 LLM이 문서마다 점수와 설명, 구체적인 개선 제안을 내놓게 했습니다. Michelangelo UI에서 점수뿐 아니라 문서를 어떻게 고칠지도 확인할 수 있습니다.

## 154개 Slack 채널에서 쌓인 Genie의 기록 {#results}

2023년 9월 출시한 Genie는 2024년 10월 원문 기준으로 154개 Slack 채널에서 70,000건이 넘는 질문에 답했습니다. 도움이 되었다는 비율은 48.9%입니다. Uber는 출시 이후 엔지니어의 작업 시간을 약 13,000시간 아낀 것으로 추정했습니다.

Uber가 그린 활용 범위는 Slack 채널 밖에도 있습니다. Michelangelo나 IDE 같은 제품에 Genie를 넣어, 사용자가 제품 안에서 바로 도움을 받도록 확장할 가능성을 제시했습니다. 이는 당시 도입 성과와 구분되는 향후 활용 구상입니다.

{{% details title="원문에 제시된 도입 수치" closed="true" %}}

| 항목 | 값 |
|---|---|
| Slack 지원 채널 질문량 | 월 약 45,000건 |
| 출시 | 2023년 9월 |
| 확산 범위 | 154개 Slack 채널 |
| 누적 답변 | 70,000건 이상 |
| 도움이 되었다는 비율 | 48.9% |
| 절감 추정 | 13,000 엔지니어링 시간 |

{{% /details %}}
