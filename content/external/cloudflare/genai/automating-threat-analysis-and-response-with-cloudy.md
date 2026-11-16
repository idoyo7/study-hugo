---
title: "로그 속 단서에서 전역 위협으로 조사를 넓히는 Cloudy"
description: "의심스러운 트래픽을 어디서부터 조사해야 할까요? Cloudy는 질문을 주고받으며 원인을 좁히도록 돕고, Cloudforce One의 전역 위협 데이터에서 관련 공격과 공격자의 활동도 찾아 줍니다."
date: 2026-11-16
weight: 18
---

# 로그 속 단서에서 전역 위협으로 조사를 넓히는 Cloudy (2025-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Automating threat analysis and response with Cloudy](https://blog.cloudflare.com/automating-threat-analysis-and-response-with-cloudy)
- 매체 · 게시일: The Cloudflare Blog · 2025-08-29
- 저자: Alexandra Moraru, Harsh Saxena, Steve James, Nick Downie, Levi Kipke
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 데이터에 묻힌 위협을 찾는 Cloudy 대화창 {#conversational-traffic-analysis}

의심스러운 트래픽이 급증하면 보안팀은 서둘러 원인을 찾아야 합니다. 그런데 대시보드를 열고 로그를 필터링하며 위협 피드를 대조하다 보면, 위협을 잘 보려고 모은 데이터가 오히려 조사를 늦추는 상황에 부딪힙니다. 찾던 위협이 그 안에 묻히기도 합니다. 인력이 적은 보안팀에는 특히 버거운 일입니다.

기존 대시보드는 찾으려는 대상과 알맞은 쿼리를 미리 알아야 하는 경우가 많았습니다. Cloudflare는 이 ‘디지털 건초더미 속 바늘’을 찾도록 보안 분석에 자사의 첫 AI 에이전트 Cloudy를 통합하고 대화창을 추가했습니다. 이제 넓은 질문에서 출발해 사람 분석가와 대화하듯 조사 범위를 좁혀 갑니다.

예를 들어 Security Analytics의 권고 사항을 조사해 달라고 요청한 뒤, “로그인 엔드포인트만 살펴봐 주세요”라고 범위를 제한합니다. 이어서 관련된 상위 5개 IP 주소를 묻고 “이 중 악성으로 알려진 IP가 있나요?”라고 확인하는 흐름입니다.

목표는 ‘뭔가 이상하다’는 징후를 발견한 뒤 분 단위로 원인과 대응책을 찾는 데 있습니다. 새 채팅 인터페이스는 모든 요금제에 제공됩니다.

Cloudflare는 이메일 탐지 요약 자동화도 같은 방향의 사례로 소개합니다. 매일 이어지는 이메일 위협에서도 복잡한 보안 데이터를 이해하기 쉽고 대응에 쓸 수 있는 정보로 바꾸려는 시도입니다.

## 로그 너머의 단서를 모은 Cloudforce One {#global-threat-investigation}

자체 로그만으로는 위협의 일부만 보입니다. Cloudflare는 Cloudy를 Cloudforce One의 Threat Events 플랫폼과 연결해 전역 네트워크에서 관측하고 완화한 위협의 맥락까지 제공하도록 했습니다. 이 위협 인텔리전스 기능은 Cloudforce One 고객에게 제공됩니다.

Threat Events는 Cloudflare 네트워크에서 관측한 대규모 공격 데이터를 조직과 관련된 실시간 이벤트로 바꾸고 공격자 정보를 연결합니다. 추적 범위는 APT 인프라부터 사이버 범죄 집단, 침해된 기기, 대규모 DDoS 활동까지입니다. 이벤트별로 대화형 타임라인을 살피고, 공격자의 전술·기법·절차인 TTPs와 지역, 표적 산업 정보도 확인할 수 있습니다.

질문은 Cloudflare Dashboard의 Security Center 아래 Threat Intelligence에서 자연어로 입력합니다. 예를 들어 조직이 속한 산업이나 국가를 누가 노리는지, 지금 차단할 만한 침해 지표인 IOCs는 무엇인지 묻는 식입니다. 특정 공격자의 활동이 시간에 따라 어떻게 전개됐는지도 조회할 수 있습니다.

출발점은 IP 주소나 도메인 하나여도 됩니다. Cloudy는 그 지표에서 Cloudflare가 관측한 위협 이벤트를 찾고, 관련 공격이나 같은 공격자의 다른 활동으로 조사를 넓히도록 안내합니다. Threat Events가 벽에 붙인 증거 게시판이라면 Cloudy는 모든 단서를 추적하는 조수입니다. 이렇게 cyber kill chain과 MITRE ATT&CK framework에 걸친 공격자의 행적을 이해하고, 정밀한 차단에 쓸 정보를 찾도록 돕습니다.

## Agents SDK가 실행되는 Workers AI {#agents-sdk-workers-ai}

Cloudflare는 Workers AI에서 실행되는 Agents SDK로 이 기능을 개발했습니다. 대규모 네트워크 텔레메트리와 위협 인텔리전스에 맞춰 작성한 LLM 프롬프트를 Workers AI의 유연성과 결합해, 기능을 빠르게 다듬고 배포했습니다.

Cloudy가 사용하는 것은 Workers AI에서 공개적으로 제공되는 모델입니다. Cloudflare 고객 데이터로 Cloudy를 학습시키지는 않았습니다.

## Cloudy가 준비하는 WAF 규칙 디버깅 {#availability-and-next-steps}

Cloudflare는 WAF 규칙의 지능형 디버깅을 개발하고 있습니다. Alerts와의 통합도 확대해 알림에 더 풍부한 맥락을 담고, 사용자가 대응에 활용하도록 돕겠다는 계획입니다.

위협 이벤트 데이터셋은 계속 보강하고 있습니다. 복잡한 공격자 타임라인과 캠페인 개요, 공격 그래프를 Cloudy로 시각화하는 방법은 아직 탐색 중입니다.

{{% details title="기존 Cloudy 기능의 이용 실적과 피드백" closed="true" %}}
| 항목 | 값 |
|---|---|
| Cloudy 출시 시점 | 2025년 3월 |
| custom rule 생성 기능 이용자 | 원문 게시 시점까지 54,000명 초과 |
| 에이전트 제안 규칙 배포 비율 | custom rule 생성 기능을 사용해 본 이용자의 31% |
| Cloudflare Gateway 로그 설명 기능 로드 횟수 | 원문 기준 직전 한 달 동안 30,000회 초과 |
| 로그 요약이 유익했다는 피드백 비율 | 접수된 피드백의 80% |
{{% /details %}}
