---
title: "장애 원인 분석 시간을 줄이려는 당근의 관측 플랫폼과 Doctor Agent"
description: "2026년 3월 장애 회고를 바탕으로 당근이 자체 관측 플랫폼과 Doctor Agent를 개발한 발표입니다. 시연·PoC 결과와 아직 진행 중인 이전·연동 계획을 구분해 요약합니다."
date: 2026-10-21
weight: 2
---

# 장애 원인 분석 시간을 줄이려는 당근의 관측 플랫폼과 Doctor Agent (2026 빌더 밋업)

{{< callout type="info" >}}
**원문 정보**
- 원문: [AI 시대의 옵저버빌리티 재설계 : Grafana를 걷어내고, 얼럿은 에이전트에게 | 2026 당근 빌더 밋업](https://www.youtube.com/watch?v=UV4-G58NLrw) (24:55)
- 매체 · 게시일: YouTube 당근 채널 · 2026-10-07 (SRE Day)
- 발표자: 배상익 (SRE 테크 리드). 자막의 자기소개와 [CloudFront 영상]({{< relref "/external/daangn/talks/sre-meetup-4/03-cloudfront-in-front-of-api.md" >}})의 설명란으로 확인했습니다.
- 근거: YouTube 자동 자막 전체 (공개된 슬라이드 없음)
- 발표 영상의 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 수정에는 2분, 원인을 찾는 데는 약 40분 {#원인-파악에-오래-걸린-3월-장애}

2026년 3월 장애는 약 50분간 이어졌고 트래픽은 40~50% 감소했습니다. 원인을 찾는 데 약 40분이 걸렸지만 수정에는 2분이 들었습니다. Service, VirtualService, DestinationRule, Argo Rollouts 해시, Sidecar, ServiceEntry를 순서대로 확인한 끝에 ServiceEntry 자동 관리 컨트롤러의 방어 로직 오류를 찾았습니다. 포함되면 안 되는 주소가 ServiceEntry에 들어가 있었습니다.

회고에서는 담당자의 휴가와 한 항목씩 확인하던 분석 방식이 진단을 늦췄다고 봤습니다. Slack에 섞여 올라온 Grafana·AWS 콘솔·Datadog 캡처를 연결해 상황을 이해하는 데에도 시간이 들었습니다.

## 인프라 상태를 연결해 보여 주는 화면과 병렬 분석 {#웹-플랫폼과-doctor-agent의-역할}

서비스 대시보드는 패널이 70개를 넘었습니다. 당근 SRE팀은 시계열과 원형 차트만으로 표현하기 어려운 정보가 있고, 서비스에 따라 필요한 패널을 나누기도 어렵다고 느꼈습니다. 경보 하나를 설정할 때도 policy와 contact point를 알아야 했습니다.

팀은 당근 인프라의 관계를 공통된 관점으로 보여 주는 웹 플랫폼을 개발했습니다. 홈에서 리전·서비스 맵·워크로드로 이동하고, 모바일 웹부터 Pod까지 요청 경로를 보여 주며, Datadog APM 트레이스와 사내 eBPF 스캐너를 통합하는 것이 목표입니다. 플랫폼과 자체 경보 엔진은 발표 전년부터 개발 중이며 Grafana에서의 이전은 아직 끝나지 않았습니다.

사람이 항목을 순서대로 확인하던 분석에는 Doctor Agent의 병렬 분석을 적용하려 합니다. SRE 컴포넌트별 닥터 대시보드를 바탕으로, PoC는 Python LangGraph의 ReAct 루프와 Grafana·Prometheus·Loki·kubectl·istioctl 도구를 사용합니다. Loki 닥터 대시보드는 [Loki 운영기]({{< relref "/external/daangn/talks/sre-meetup-4/01-loki-one-year.md" >}})에도 나옵니다.

서비스 닥터와 사내 얼럿 딜리버리 연동, Slack 대화, 코딩 에이전트를 통한 PR 작성, 다른 팀 에이전트의 Doctor 호출은 이후 확장 계획입니다.

## PoC에서 나온 분석과 협업상의 변화 {#poc에서-확인한-변화}

발표자는 뒤늦게 장애 대응에 합류한 사람도 상황을 빨리 파악하고 불필요한 질문이 줄었다고 전했습니다. Claude Sonnet을 사용한 PoC에서는 1~2분 안에 유용한 분석 리포트가 나왔습니다. 다만 실제 장애 대응 시간이 얼마나 줄었는지는 정량으로 제시하지 않았습니다.

> "더 많은 화면이 아니라 더 짧은 시간에 더 좋은 판단" (발표 마무리, 자막)

## 분석 품질 추적과 추가 연동은 진행 중 {#남은-과제와-해석의-한계}

발표자는 모델 성능이 발전하면서 직접 작성한 지시문이 오히려 분석을 제한한 경험을 설명했습니다. 에이전트가 자율적으로 분석할 여지를 두면서 품질을 추적하려는 방향입니다. 플랫폼 MCP, SRE 도구 연결, 다른 조직으로의 확대도 남은 과제로 들었습니다.

3월 장애의 ServiceEntry 관리 로직이 [Istio ServiceEntry 자동생성 발표]({{< relref "/external/daangn/talks/sre-meetup-4/02-istio-serviceentry.md" >}})의 CronJob과 같은 컴포넌트인지는 확인되지 않습니다. 두 발표의 내용을 연결해 같은 장애 원인으로 해석할 근거는 없습니다.

## 주요 구간

- [02:00](https://www.youtube.com/watch?v=UV4-G58NLrw&t=120s) 2026년 3월 장애
- [05:00](https://www.youtube.com/watch?v=UV4-G58NLrw&t=300s) 회고에서 확인한 사람과 도구의 병목
- [09:00](https://www.youtube.com/watch?v=UV4-G58NLrw&t=540s) Grafana의 한계
- [10:30](https://www.youtube.com/watch?v=UV4-G58NLrw&t=630s) 웹 플랫폼의 목표와 시연
- [17:00](https://www.youtube.com/watch?v=UV4-G58NLrw&t=1020s) Doctor Agent PoC
- [22:00](https://www.youtube.com/watch?v=UV4-G58NLrw&t=1320s) 결과와 방향

{{% details title="세부 내용 근거 표 (모두 자막 기준)" closed="true" %}}

| 항목 | 내용 |
|---|---|
| 장애 | 2026년 3월, 약 50분, 트래픽 40~50% 하락 |
| 원인 파악 / 해결 | 약 40분 / 2분 |
| 확인 순서 | Service, VirtualService, DestinationRule, Argo Rollouts 해시, Sidecar, ServiceEntry |
| Grafana 한계 | 서비스 대시보드 패널 70개 초과, 필요 없는 서비스의 GPU 패널 숨김 분기 어려움 |
| 플랫폼 기능 | 노드·Pod 라이프사이클 타임라인에 Karpenter 이벤트 배지, 서브탭 헬스 마커, 전문가 설명(Envoy NC 플래그 등) |
| PoC 스택 | Python LangGraph ReAct, 도구는 Grafana·Prometheus·Loki·kubectl·istioctl |
| PoC 결과 | Claude Sonnet으로 1~2분 내 분석 리포트 |

{{% /details %}}
