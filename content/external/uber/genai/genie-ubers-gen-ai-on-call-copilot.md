---
title: "Slack 온콜 질문에 답하는 RAG 기반 코파일럿 Genie"
description: "우버가 Slack 지원 채널의 온콜 대기 시간을 줄이려고 RAG로 만든 코파일럿 Genie를 요약했습니다. 데이터 적재 파이프라인과 환각 억제, 평가 체계, 도입 성과를 정리합니다."
date: 2026-11-10
weight: 19
---

# Slack 온콜 질문에 답하는 RAG 기반 코파일럿 Genie (2024-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Genie: Uber’s Gen AI On-Call Copilot](https://www.uber.com/us/en/blog/genie-ubers-gen-ai-on-call-copilot/)
- 매체 · 게시일: Uber Engineering Blog · 2024-10-10
- 저자: Nicholas Marcott(Staff Software Engineer, TLM, Uber AI Feature Store 팀), Eduards Sidorovics(Senior Software Engineer, Uber AI Platform 팀), Paarth Chothani(Staff Software Engineer, Gen AI/CoreML 팀), Xiyuan Feng(Software Engineer, Feature Store 팀), Chun Zhu(Senior Software Engineer, Uber AI Platform 팀), Meghana Somasundara(Product Lead, Uber AI Platform), Kailiang Fu(Associate Product Manager, Michelangelo 팀), Jonathan Li(Software Engineer, Uber AI Platform 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 온콜 지원 채널의 병목 {#problem}

Michelangelo 팀처럼 우버의 여러 팀은 내부 사용자가 도움을 구하는 Slack 지원 채널을 운영합니다. 이런 채널에 한 달에 올라오는 질문이 약 45,000건입니다. 질문이 많고 답을 기다리는 시간이 길어지면 사용자와 온콜 엔지니어 모두 생산성을 잃습니다.

과정도 번거롭습니다. 사용자가 질문을 올리면 온콜 엔지니어가 답하거나 추가 정보를 묻고, 사용자가 다시 질문하거나 정보를 보태면 또 기다려야 합니다. 몇 차례 오간 끝에야 해결됩니다. 문서만 봐도 풀릴 질문이 많지만 정보가 사내 위키 Engwiki, 사내 Stack Overflow 등에 흩어져 있어 답을 찾기 어렵고, 같은 질문이 반복되어 수백 개 Slack 채널에서 온콜 수요가 커집니다.

## RAG를 고른 이유와 세 가지 과제 {#rag-choice}

팀은 LLM 파인튜닝과 RAG 중에서 골랐습니다. 파인튜닝은 품질 높고 다양한 예시 데이터가 필요하고 모델을 최신으로 유지할 컴퓨팅도 들어갑니다. RAG는 시작할 때 다양한 예시가 필요 없어 출시까지의 시간이 짧아서 이쪽을 택했습니다.

코파일럿을 만들면서 환각, 데이터 보호, 사용자 경험이 과제였습니다. 환각은 질문에 맞는 지식을 정확히 가져오고, 응답을 권위 있는 출처와 대조해 검증하고, 최신 데이터에 접근하게 하는 방향으로 다뤘습니다. 데이터 보안은 Slack 채널에 노출될 수 없는 소스가 많아 적재할 소스를 신중히 골랐습니다. 사용자 경험은 쓰기 쉬운 인터페이스와 응답에 피드백을 남길 수 있는 루프로 풀었습니다.

## 아키텍처 {#architecture}

Genie는 Engwiki, 사내 Stack Overflow, 엔지니어링 요구 문서 같은 내부 소스를 스크레이핑해 OpenAI 임베딩 모델로 벡터를 만들고 벡터 데이터베이스에 저장합니다. 사용자가 Slack 채널에 질문을 올리면 질문을 임베딩으로 바꾸고, 벡터 데이터베이스에서 관련 임베딩을 찾아 그 결과를 프롬프트로 LLM에 넘겨 답을 받습니다. 데이터 준비, 임베딩, 서빙용 아티팩트 푸시 단계는 Apache Spark로 만드는 RAG 애플리케이션의 일반적인 틀입니다.

### 데이터 적재 {#ingest}

데이터 준비 단계에서는 Spark 앱이 Engwiki나 Stack Overflow API로 콘텐츠를 가져와 Spark 데이터프레임으로 내놓습니다. 원본 URL, 내용, 메타데이터 컬럼이 문자열로 들어 있습니다. 임베딩 생성 단계에서는 wiki 콘텐츠를 langchain으로 청크로 나누고 PySpark UDF로 OpenAI 임베딩을 만들어, 청크 내용과 해당 벡터를 짝지은 데이터프레임을 우버의 블롭 스토리지 Terrablob에 올립니다. 임베딩은 해당 Engwiki 공간과 연결된 Slack 채널에서만 접근할 수 있습니다.

푸셔 단계에서는 부트스트랩 잡이 데이터 소스에서 우버 자체 벡터 DB인 Sia로 데이터를 적재하고, Spark 잡 두 개가 인덱스를 빌드·병합해 Terrablob에 넣습니다. 각 리프 노드는 Terrablob의 기본 인덱스와 스냅샷을 내려받아 동기화하며, 조회 때 쿼리가 각 리프로 직접 전달됩니다.

### Knowledge Service와 비용 추적 {#knowledge-service}

백엔드의 Knowledge Service가 들어오는 모든 질의를 받아 임베딩으로 변환하고 벡터 DB에서 가장 관련 있는 청크를 가져옵니다. 비용 추적을 위해 Slack 클라이언트나 다른 플랫폼이 Knowledge Service를 부를 때 UUID를 넘기고, 이 UUID가 컨텍스트 헤더로 Michelangelo Gateway에 전달됩니다. Gateway는 LLM으로 가는 패스스루 서비스이며 감사 로그에 UUID별로 기록해 비용을 추적합니다.

## 성능 평가 {#evaluation}

사용자는 Genie 답변의 버튼으로 바로 피드백을 남깁니다. 선택지는 네 가지입니다.

- Resolved: 답변으로 문제가 완전히 해결됨
- Helpful: 부분적으로 도움이 되었지만 추가 도움이 필요함
- Not Helpful: 답이 틀렸거나 관련이 없음
- Not Relevant: 코드 리뷰처럼 Genie가 도울 수 없어 온콜 담당자가 필요함

피드백은 Slack 플러그인이 받아 Kafka 토픽으로 흘려 보내고 Hive 테이블에 메타데이터와 함께 쌓이며, 이를 대시보드로 시각화합니다.

사용자가 직접 평가를 돌릴 수도 있습니다. 환각, 답변 관련성 등 필요한 지표를 골라 검색과 생성 양쪽 RAG 구성요소를 조정하는 데 씁니다. 평가는 Michelangelo 컴포넌트를 재사용한 별도 ETL 파이프라인입니다. Hive에서 Genie의 컨텍스트와 응답을 가져와 Slack 메타데이터, 사용자 피드백과 합치고, Evaluator가 지정된 프롬프트로 LLM을 심판으로 돌려 지표를 뽑아 UI의 평가 리포트에 싣습니다.

문서 평가도 있습니다. 문서 품질이 나쁘면 LLM이 아무리 좋아도 성능이 나오지 않으므로, 문서를 평가해 개선 제안을 주는 일이 중요하다는 이유입니다. 지식 베이스의 문서를 행 하나에 문서 하나인 Spark 데이터프레임으로 바꾸고, 맞춤 평가 프롬프트를 준 LLM이 점수와 설명, 문서 품질을 높일 구체적 제안을 돌려줍니다. 결과는 Michelangelo UI에서 볼 수 있습니다.

## 과제별 해법 {#solutions}

환각을 줄이려고 벡터 DB에서 얻은 결과를 LLM에 보내는 방식을 바꿨습니다. 각 결과마다 sub-context 구간과 그 출처 URL을 명시적으로 붙이고, LLM에게 주어진 sub-context 안에서만 답하며 근거 URL을 함께 돌려 달라고 요청했습니다. 모든 답변에 출처 URL이 달리게 하려는 것입니다.

데이터 유출을 막으려고, 임베딩을 만드는 소스가 OpenAI나 접근 권한이 없는 사람에게 새지 않도록 대다수 우버 엔지니어가 열람할 수 있는 소스를 미리 골라 그것만 임베딩에 쓰게 했습니다.

답변을 더 잘 활용하도록 새 상호작용 모드도 만들었습니다. 사용자가 후속 질문을 더 편하게 하고 답을 더 꼼꼼히 읽게 하는 방식입니다. Genie가 답에 다음 행동 버튼을 붙이면 후속 질문을 하거나, 해결로 표시하거나, 사람 지원에 연락할 수 있어 답을 못 얻은 사용자가 온콜로 쉽게 넘어갑니다.

## 결과와 앞으로 {#results}

2023년 9월 출시 이후 Genie는 154개 Slack 채널로 퍼졌고 70,000건이 넘는 질문에 답했습니다. 도움이 되었다는 비율은 48.9%이고, 출시 이후 약 13,000 엔지니어링 시간을 아낀 것으로 추정합니다.

원문은 Genie가 온콜 대응과 협업을 돕는 Slack 봇이라고 소개하며, 어떤 플랫폼이든 사용자와 온콜 엔지니어가 Slack 채널에서 만나는 방식을 바꿀 수 있다고 전망합니다. Michelangelo나 IDE 같은 제품 안에서, 혹은 제품별 Slack 채널에서 온콜을 기다리지 않고 제품 관련 도움을 받는 경험도 그려 봅니다.

{{% details title="원문의 주요 수치" closed="true" %}}

| 항목 | 값 |
|---|---|
| Slack 지원 채널 질문량 | 월 약 45,000건 |
| 출시 | 2023년 9월 |
| 확산 범위 | 154개 Slack 채널 |
| 누적 답변 | 70,000건 이상 |
| 도움이 되었다는 비율 | 48.9% |
| 절감 추정 | 13,000 엔지니어링 시간 |

{{% /details %}}
