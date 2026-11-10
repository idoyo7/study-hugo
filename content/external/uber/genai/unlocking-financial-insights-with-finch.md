---
title: "Slack에서 재무 데이터를 묻고 답하는 AI 에이전트 Finch"
description: "우버 FinTech 팀이 재무 담당자의 SQL 작업과 데이터 요청 대기를 줄이려고 만든 Slack 기반 대화형 데이터 에이전트 Finch를 다룬 글입니다. 구조와 평가 방식, 앞으로의 계획을 요약합니다."
date: 2026-11-10
weight: 15
---

# Slack에서 재무 데이터를 묻고 답하는 AI 에이전트 Finch (2025-07)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Unlocking Financial Insights with Finch: Uber's Conversational AI Data Agent](https://www.uber.com/us/en/blog/unlocking-financial-insights-with-finch/)
- 매체 · 게시일: Uber Engineering Blog · 2025-07-17
- 저자: Eddie Huang(Uber FinTech Business System Manager), Taya Yusuf(Uber FinTech Senior Product Manager), Tim Ross(Lead Product Manager), Austin Harrison(Finance Data Analytics & AI 디렉터), Spencer Garth(FinTech Software Engineer)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 재무 데이터 접근의 병목 {#problem}

우버의 재무 분석가와 회계 담당자는 실시간 의사결정을 뒷받침하려고 방대한 데이터를 뒤집니다. 그런데 여러 플랫폼에 걸친 복잡한 SQL 쿼리를 거치는 전통적인 데이터 접근 방식 때문에 지연이 생겼습니다. 원문은 가상의 분석가 Taya의 보고서 준비 과정으로 세 가지 어려움을 보여 줍니다.

- 알맞은 데이터셋을 손으로 찾아야 합니다. Presto, IBM Planning Analytics, Oracle Enterprise Performance Management, Google Docs 같은 여러 플랫폼에 로그인해야 하고, 어느 쪽에 최신 수치가 있는지 알기 어렵습니다.
- 복잡한 SQL을 직접 써야 합니다. 문서를 대조하고 문법 오류를 잡고 필요한 컬럼을 모두 넣는 일이 숙련자에게도 오래 걸리고 실수하기 쉽습니다.
- 데이터 요청을 올려야 합니다. 쿼리가 너무 복잡하거나 권한이 없으면 데이터 사이언스 팀에 요청하고 몇 시간, 길면 며칠을 기다립니다.

## Finch의 기능 {#solution}

이 마찰을 없애려고 FinTech 팀이 Slack에 직접 통합한 AI 에이전트 Finch를 만들었습니다. 기술 선택은 생성형 AI, RAG, 자기 질의(self-querying) 에이전트의 조합이었고, 선정 요인은 데이터 보안, 기존 시스템과의 매끄러운 통합, 앞으로의 확장성이었습니다. 주요 기능은 다음과 같습니다.

- Slack 대화형 인터페이스: "2024년 4분기 US&C의 GB 값은?"처럼 물으면 알맞은 데이터를 가져옵니다.
- 우버 고유 용어 이해: "US&C"는 미국·캐나다 지역, "GBs"는 총 예약액(gross bookings)처럼 사내 재무 용어를 구조화된 데이터 소스에 연결합니다.
- 자기 질의 에이전트: 접근 가능한 모든 테이블의 메타데이터를 훑어 요청에 가장 맞는 소스를 고르고 올바른 SQL을 실행합니다.
- 보안과 접근 통제: 역할 기반 권한(RBAC)으로 허가된 사용자만 민감한 재무 데이터를 조회합니다.
- Google Sheets 자동 내보내기: 큰 데이터셋은 결과를 시트로 내보내 평소 쓰는 방식으로 분석하게 합니다.

## 아키텍처 {#architecture}

Finch의 차별점은 데이터를 가져오는 방식에 있습니다. 자주 쓰는 재무·운영 지표를 모은 단일 테이블 데이터 마트를 도메인별로 선별하고, 그 위에 메타데이터 시맨틱 레이어를 얹었습니다. 데이터 마트는 쿼리 복잡도와 조회 시간을 줄이도록 단순하게 설계해서, LLM이 쿼리를 쓰고 오류 메시지 같은 피드백을 빠르게 받아 스스로 고치기 쉽습니다. 구조와 거버넌스가 정해져 있어 허가된 사용자만 특정 재무 차원을 조회할 수 있습니다.

WHERE 절 필터의 정확도는 SQL 테이블 컬럼과 값의 자연어 별칭을 OpenSearch 인덱스에 저장해 크게 높였습니다. 테이블 스키마와 샘플 몇 행에만 의존하는 기존 LLM SQL 에이전트와 다른 점입니다. 별칭을 쓰면 LLM이 추출한 용어를 퍼지 매칭할 수 있습니다.

구성 요소는 다음과 같습니다.

- 모델: 자체 호스팅 모델과 서드파티 LLM을 우버의 Generative AI Gateway로 접근합니다. 기반 기술이 발전해도 모델을 쉽게 바꿀 수 있습니다.
- 에이전트 오케스트레이션: LangChain의 LangGraph로 에이전트를 만들고 조율합니다. SQL Writer Agent, Supervisor Agent 같은 전문 에이전트 사이의 쿼리 흐름과 실행 순서를 관리합니다.
- 메타데이터 저장소: OpenSearch 인덱스에 SQL 컬럼, 값, 자연어 별칭을 담습니다.
- Slack 연동: Slack SDK로 API에 직접 연결합니다. LangGraph 애플리케이션의 콜백 핸들러가 Slack 상태 메시지를 실시간으로 갱신해 사용자가 에이전트의 단계별 진행을 볼 수 있습니다. 새로 나온 Slack AI Assistant API로 새 대화 시작 시 추천 질문, Finch를 앱에 고정하는 기능, 항상 열려 있는 분할 창도 씁니다.

내부적으로는 Presto, IBM Planning Analytics, Oracle EPM 같은 데이터 플랫폼과 연동되고 Generative AI Gateway 같은 사내 서비스를 활용합니다.

## 데이터 에이전트의 처리 흐름 {#flow}

흐름은 여섯 단계입니다. 재무팀 구성원이 Slack에서 질문하면, Supervisor Agent가 질의를 받아 성격에 맞는 하위 에이전트(예: SQL Writer Agent)에 보냅니다. 에이전트는 OpenSearch 인덱스에서 컬럼명과 값의 자연어 별칭을 포함한 메타데이터를 가져오고, SQL Writer Agent가 이를 바탕으로 쿼리를 만들어 알맞은 데이터 소스에서 실행합니다. 이 과정에서 Slack 콜백 핸들러가 도구 호출 같은 각 단계를 상태 메시지로 알리고, 실행이 끝나면 결과를 실행된 쿼리 정보와 Google Sheet 링크와 함께 Slack에 돌려줍니다.

Taya가 "2024년 4분기 GBs 값을 보여 줘"라고 입력하는 예가 원문에 나옵니다. Supervisor Agent가 데이터 조회 요청으로 판단해 SQL Writer Agent에 보내고, SQL Writer Agent는 컬럼이나 필터 값일 수 있는 단어와 구절을 찾아 올바른 테이블을 고르고, 테이블별 주의 사항 지침을 따라 쿼리를 만들고, 실행 전에 Taya의 권한을 확인합니다. 오류가 나면 오류 메시지를 참고해 쿼리를 고쳐 씁니다. 몇 초 안에 요약과 분해 표가 담긴 응답이 오고 값은 약 441억 9,728만 달러로 표시됩니다. Taya가 "2023년 4분기와 비교해 줘"라고 이어 묻자 Finch는 쿼리를 갱신해 2023년 4분기 값을 가져오고 증가 추세를 요약하며 Google Sheets 내보내기를 제안합니다.

## 정확도와 성능 관리 {#evaluation}

정확도는 네 가지로 계속 평가합니다.

- 에이전트별 정확도: SQL Writer와 Document Reader 같은 하위 에이전트를 기대 응답에 견줘 독립적으로 평가합니다. SQL 에이전트는 쿼리를 쓰는 방법이 여러 가지라서 "골든" 쿼리의 결과와 생성 쿼리의 결과를 비교합니다.
- Supervisor 라우팅 정확도: 질문이 모호하거나 도구 기능이 비슷할 때(Presto와 Oracle EPM 조회 도구처럼) 잘못 고르는 의도 충돌을 찾습니다.
- 종단 검증: 실제 질의를 모사한 시나리오로 시스템 전체의 신뢰성을 확인합니다.
- 회귀 테스트: 시스템 프롬프트나 모델을 바꾸기 전에 과거 질의를 다시 돌려 정확도가 흔들리는지 봅니다.

속도 면에서는 SQL을 최적화해 데이터베이스 부하를 줄이고, 하위 에이전트가 작업을 동시에 실행해 응답 시간을 줄이며, 자주 쓰는 지표를 미리 가져옵니다.

## 다른 도구와의 차이 {#differentiators}

원문은 범용 AI 챗봇이나 전통적인 BI 도구와 비교해 네 가지를 내세웁니다. 학습된 지식에 의존하는 챗봇과 달리 최신 재무 데이터를 실시간으로 조회합니다. 수동 SQL이나 미리 정의된 리포트가 필요한 BI 도구와 달리 최적의 쿼리 전략을 스스로 정합니다. 데스크톱과 모바일 Slack에 들어 있어 SQL을 모르는 임원도 쓸 수 있습니다. 엔터프라이즈 인증, 세분화된 권한, 쿼리 검증으로 보안과 컴플라이언스를 지킵니다.

## 앞으로의 계획 {#roadmap}

우버 FinTech 시스템과의 통합을 넓혀 재무 분석, 보고, 예측, 예산 편성을 아우르는 통합 환경으로 가려 합니다. 또한 경영진 경험을 개선하려 합니다. 원문은 Finch가 대부분의 재무팀 일상 업무에는 충분하지만 지금의 생성형 AI가 대개 그렇듯 100% 신뢰할 수 없고 환각이 있을 수 있다고 인정합니다. 정확도 개선과 함께, 응답 옆에 "Request validation" 버튼을 두어 질문 맥락과 응답을 해당 분야 전문가에게 보내 검증이나 수정을 받고, 확인이 끝나면 Finch가 경영진에게 알리는 요청형 휴먼 인 더 루프를 도입할 계획입니다. 덜 중요한 질문에는 사람을 끼우지 않고, 중요한 질문에서만 사람의 확인을 받겠다는 구상입니다. 더 많은 사용자 의도를 처리하도록 에이전트와 툴킷을 늘려 재무 사용자의 원스톱 창구로 만드는 것도 목표입니다.

{{% details title="원문의 구성 요소와 평가 항목" closed="true" %}}

| 항목 | 값 |
|---|---|
| 연동 데이터 플랫폼 | Presto, IBM Planning Analytics, Oracle EPM |
| 메타데이터 저장소 | OpenSearch 인덱스(컬럼, 값, 자연어 별칭) |
| 에이전트 프레임워크 | LangChain LangGraph(Supervisor Agent, SQL Writer Agent, Document Reader) |
| 모델 접근 | Uber Generative AI Gateway |
| 예시 질의 응답 | 2024년 4분기 GBs 약 $44,197.28M USD |
| 평가 방식 | 에이전트별 골든 쿼리 비교, Supervisor 라우팅, 종단 검증, 회귀 테스트 |

{{% /details %}}
