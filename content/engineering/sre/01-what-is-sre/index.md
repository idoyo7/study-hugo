---
title: "01 SRE가 신뢰성을 책임지는 방식"
description: "SRE는 무엇을 책임지고 DevOps와 어떻게 다를까요? 영어 위키백과의 Site reliability engineering 항목을 바탕으로, 신뢰성에 초점을 둔 DevOps의 구체적인 구현으로 여겨지는 SRE의 책임과 원칙, 팀 구성을 설명합니다."
date: 2026-11-01
lastmod: 2026-11-01
weight: 1
url: "/sre/01-what-is-sre/"
---

# 01 · SRE가 신뢰성을 책임지는 방식

> 영어 위키백과 [Site reliability engineering](https://en.wikipedia.org/wiki/Site_reliability_engineering) 항목의 2026-10-04 판을 바탕으로 쓴 글입니다. 항목에 없는 내용은 보태지 않았습니다.

사이트 신뢰성 엔지니어링(SRE, site reliability engineering)은 배포된 소프트웨어 시스템과 대규모 소프트웨어 서비스의 가용성과 성능을 감시하고 개선하는 분야입니다. 소프트웨어 공학과 IT 인프라 지원에 속하며, 신뢰성을 높이기 위해 소프트웨어 공학·IT 인프라·웹 개발·운영의 요소를 함께 씁니다.

SRE는 DevOps의 구체적인 구현으로 여겨집니다. 배포된 시스템의 신뢰성과 가용성을 높이려는 목표는 비슷하지만, SRE는 신뢰할 수 있는 시스템을 만드는 데 초점을 두고 DevOps는 더 넓은 운영 범위를 다룹니다. 이처럼 초점에 차이가 있는데도 일부 회사는 기존 운영팀의 이름을 SRE 팀으로 바꿨습니다.

## 장애 대응과 시스템 개선을 함께 맡는다

서비스에는 새 소프트웨어 배포, 하드웨어 장애, 사이버 공격 같은 사건이 벌어져도 신뢰할 만한 응답 시간을 제공하리라는 기대가 있습니다. SRE가 책임지는 범위는 시스템 가용성, 지연 시간(latency), 성능, 효율에서 변경 관리, 모니터링, 긴급 대응, 용량 계획까지 이어집니다.

이 일을 맡는 엔지니어는 소프트웨어 공학, 시스템 공학, 시스템 관리 가운데 하나 이상의 배경을 가진 경우가 많습니다. SRE가 집중하는 일은 자동화와 시스템 설계, 시스템 회복력(resilience) 개선입니다. 보통 자동화와 코드형 인프라(infrastructure as code) 방법론에 무게를 둡니다.

## 목표를 정하고 반복 작업을 줄인다

신뢰성 목표를 정하는 이유는 끝없이 노력을 들이는 일을 막기 위해서입니다. 위키백과는 이를 SRE에서 흔히 꼽는 실천으로 소개합니다. 신뢰성 목표를 정의하고 측정하는 원칙에는 SLI, SLO, 오류 예산(error budget)이 포함됩니다.

반복 작업의 자동화는 비용 효율을 위한 실천입니다. SRE의 원칙에는 토일(toil) 관리도 있습니다. 토일은 수작업으로 반복되며 자동화할 수 있는 운영 작업을 가리킵니다.

## 설계부터 운영 절차까지 신뢰성을 반영한다

SRE의 시스템 설계는 가용성, 지연 시간, 효율을 해칠 위험을 줄이는 데 목적을 둡니다. 신뢰성에 초점을 맞춘 NALSD(Non-Abstract Large Scale Systems Design, 추상에 머물지 않는 대규모 시스템 설계)도 원칙에 포함됩니다.

관측성(observability)은 무엇을 물어야 할지 미리 알지 못해도 시스템에 임의의 질문을 던질 수 있는 능력을 뜻합니다. SRE는 이런 관측성을 갖추는 일을 실천으로 삼으며, 관측성을 설계하고 구현하는 일도 원칙으로 다룹니다.

운영 절차에서는 인시던트 관리 프로세스를 정의하고, 시험하고, 운영합니다. 용량 계획도 SRE의 원칙 중 하나입니다. CI/CD를 포함한 변경·릴리스 관리와 카오스 엔지니어링(chaos engineering) 역시 원칙에 포함되며, 위키백과가 소개하는 실천과 원칙은 이 내용에 한정되지 않습니다.

## 책임 범위와 협업 방식에 따라 팀의 모습이 달라진다

SRE 팀은 조직의 다른 부서와 협력하며 이러한 원칙을 구현하도록 안내합니다. 팀이 맡는 서비스의 범위, 개발팀과 함께 일하는 방식에 따라 여러 형태가 쓰입니다.

| 모델 | 맡는 일과 협업 방식 |
| --- | --- |
| Kitchen Sink | 서비스와 업무 흐름을 폭넓게 맡으며, 책임 범위에 뚜렷한 경계가 없는 경우가 많다. 성능 최적화, 인시던트 관리, 자동화 등 여러 과제를 다루면서 시스템이 효율적으로 작동하고 달라지는 요구와 복잡성에 맞춰 발전하도록 한다. |
| Infrastructure | 다른 팀의 업무 흐름을 받치는 시스템의 신뢰성을 유지하고 개선한다. 일차 책임은 가동 시간, 성능, 효율을 보장하는 일이다. |
| Product/Application | 특정 제품이나 애플리케이션을 전담하며, 핵심 서비스의 신뢰성·확장성·성능을 책임진다. 대형 조직에서 흔한 방식이다. |
| Embedded | SRE 개인이나 소규모 SRE 짝(pair)이 소프트웨어 엔지니어링 팀에 들어가 개발자와 협력한다. 자동화, 모니터링, 인시던트 대응 같은 원칙을 개발 수명 주기에 직접 적용하며, 신뢰성·성능과 SRE·개발자 사이의 협업을 높이는 것이 목적이다. |
| Consulting | 조직이 SRE 원칙과 실천을 도입하도록 조언한다. 여러 도입 경험을 쌓은 경력 많은 SRE로 구성되는 경우가 보통이며, 조직의 구체적인 필요에 맞춰 안내한다. 고객과 직접 일하는 SRE는 흔히 Customer Reliability Engineer(고객 신뢰성 엔지니어)로 불린다. |

Infrastructure SRE 팀은 플랫폼 엔지니어링 팀과 협력하기도 합니다. 신뢰성은 두 팀 모두의 목표이지만 우선하는 일이 다릅니다. 플랫폼 팀은 조직 전체에서 쓰는 소프트웨어와 시스템을 개발하며, 내부 이해관계자를 위한 도구와 서비스를 만들고 유지하는 일을 우선합니다. Infrastructure SRE 팀은 그 시스템이 원활하게 작동하고 신뢰성 기준을 충족하도록 책임집니다.

SRE 팀은 여러 도구를 써서 시스템 신뢰성을 측정하고 유지하고 개선합니다. 이런 도구는 성능 감시, 문제 식별, 선제적 유지보수를 돕습니다. 예를 들어 Nagios Core는 시스템 모니터링과 경보에 흔히 쓰이며, Prometheus는 클라우드 네이티브 환경에서 메트릭을 수집하고 질의하는 데 자주 쓰입니다.

규모가 큰 회사는 보통 SRE 팀을 여럿 두고 팀마다 다른 제품이나 애플리케이션을 맡겨, 각 영역의 성능·가용성 목표를 전담 팀이 전문적으로 다루게 합니다. SRE를 도입한 대형 조직에서는 여러 모델을 섞은 하이브리드 모델도 흔한데, 제품마다 다른 신뢰성 요구를 맡는 Product/Application SRE 팀을 여럿 두는 구성이 여기에 포함됩니다. Infrastructure SRE 팀이 플랫폼 엔지니어링 그룹과 협력해 모든 제품과 애플리케이션을 받치는 통합 플랫폼의 신뢰성 목표를 함께 추구할 수도 있습니다.

## Google에서 시작해 여러 조직으로 퍼진 방식

Google의 SRE는 2003년 Benjamin Treynor Sloss가 “Site Reliability Tsar”라는 직함으로 입사해 처음 모인 production engineer(프로덕션 엔지니어) 7명으로 SRE 팀을 만들면서 시작됐습니다. 2016년에는 팀 규모가 SRE 1,000명을 넘었고, 다른 대형 인터넷 기업도 이 방식을 받아들였습니다.

SRE 개념을 도입한 조직으로는 Airbnb, Dropbox, IBM, LinkedIn, Netflix, Wikimedia가 있으며, Meta에서는 production engineer가 비슷한 일을 맡습니다. production engineer는 다른 대형 기술 기업의 SRE에 견줄 수 있는 역할로 설명됩니다.

2020년 개발·운영 전문가 572명을 대상으로 한 설문에서는 조직 규모에 따라 다음과 같은 응답이 나왔습니다.

| 응답자가 속한 조직의 직원 수 | 해당 규모 조직의 응답자 중 SRE 팀이 있다고 답한 비율 |
| --- | --- |
| 10,000명 이상 | 64% |
| 101~1,000명 | 44% |
| 100명 이하 | 32% |

경험과 지식을 나누는 자리도 이어지고 있습니다. USENIX는 2014년부터 매년 SREcon 콘퍼런스를 개최합니다. 여러 업종의 SRE가 모여 지식을 공유하고, 효과적인 실천을 살피며, SRE의 동향을 논의하는 자리입니다.

## 더 읽을 자료

위키백과 항목이 소개하는 책 7권입니다.

- Limoncelli, Tom; Chalup, Strata R.; Hogan, Christina J. (2014년 9월). The Practice of Cloud System Administration: DevOps and SRE Practices for Web Services. 2권. Addison-Wesley.
- Beyer, Betsy; Jones, Chris; Petoff, Jennifer; Murphy, Niall Richard 편 (2016). Site Reliability Engineering: How Google Runs Production Systems. O'Reilly.
- Blank-Edelman, David N. 편 (2018). Seeking SRE: Conversations About Running Production Systems at Scale. 1판. O'Reilly.
- Beyer, Betsy; Murphy, Niall; Kawahara, Kent; Rensin, David; Thorne, Stephen (2018). The Site Reliability Workbook: Practical Ways to Implement SRE. O'Reilly.
- Welch, Nat (2018). Real-World SRE: The Survival Guide for Responding to a System Outage and Maximizing Uptime. Packt.
- Adkins, Heather; Beyer, Betsy; Blankinship, Paul; Lewandowski, Piotr; Oprea, Ana; Stubblefield, Adam (2020). Building Secure and Reliable Systems: Best Practices for Designing, Implementing, and Maintaining Systems. O'Reilly.
- Rosenthal, Casey; Jones, Nora (2020). Chaos Engineering: System Resiliency in Practice. O'Reilly.

자료 목록과 뉴스레터, Google의 안내 페이지도 소개합니다.

- [Awesome Site Reliability Engineering](https://github.com/dastergon/awesome-sre) — 자료 목록
- [How they SRE](https://github.com/upgundecha/howtheysre) — 자료 목록
- [SRE Weekly](https://sreweekly.com/) — SRE 전문 주간 뉴스레터
- [SRE at Google](https://sre.google/) — Google의 SRE를 더 알아볼 수 있는 안내 페이지

원문의 각주가 가리키는 Google 자료도 있습니다. 토일은 [What is Toil in SRE](https://sre.google/sre-book/eliminating-toil/), NALSD는 [Non-Abstract Large System Design](https://sre.google/workbook/non-abstract-design/)에서 설명합니다.
