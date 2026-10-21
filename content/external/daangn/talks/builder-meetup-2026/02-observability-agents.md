---
title: "AI 시대의 옵저버빌리티 재설계: Grafana를 걷어내고, 얼럿은 에이전트에게"
description: "2026 당근 빌더 밋업에서 클러스터 파트가 발표한 옵저버빌리티 재설계의 요약입니다. 올해 3월 약 50분 장애의 원인 파악이 오래 걸린 경험에서 시작해 자체 웹 플랫폼과 Doctor Agent를 만들고 있습니다."
date: 2026-10-21
weight: 2
---

# AI 시대의 옵저버빌리티 재설계 (2026 빌더 밋업)

{{< callout type="info" >}}
**원문 정보**
- 원문: [AI 시대의 옵저버빌리티 재설계 : Grafana를 걷어내고, 얼럿은 에이전트에게 | 2026 당근 빌더 밋업](https://www.youtube.com/watch?v=UV4-G58NLrw) (24:55)
- 매체 · 게시일: YouTube 당근 채널 · 2026-10-07 (SRE Day)
- 발표자: 배상익 (SRE 테크 리드). 자막의 자기소개와 [CloudFront 영상]({{< relref "/external/daangn/talks/sre-meetup-4/03-cloudfront-in-front-of-api.md" >}})의 설명란으로 확인했습니다.
- 근거: YouTube 자동 자막 전체 (공개된 슬라이드 없음)
- 이 문서는 영상을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## 주요 구간

- [02:00](https://www.youtube.com/watch?v=UV4-G58NLrw&t=120s) 2026년 3월 장애
- [05:00](https://www.youtube.com/watch?v=UV4-G58NLrw&t=300s) 회고에서 확인한 사람과 도구의 병목
- [09:00](https://www.youtube.com/watch?v=UV4-G58NLrw&t=540s) Grafana의 한계
- [10:30](https://www.youtube.com/watch?v=UV4-G58NLrw&t=630s) 웹 플랫폼의 목표와 시연
- [17:00](https://www.youtube.com/watch?v=UV4-G58NLrw&t=1020s) Doctor Agent PoC
- [22:00](https://www.youtube.com/watch?v=UV4-G58NLrw&t=1320s) 결과와 방향

## 원인 파악에 오래 걸린 3월 장애

약 50분간 이어진 장애로 트래픽은 40~50% 떨어졌습니다. 2026년 3월 장애에서는 원인 파악에 약 40분, 수정에 2분이 들었습니다. Service, VirtualService, DestinationRule, Argo Rollouts 해시, Sidecar, ServiceEntry를 차례로 확인한 끝에 찾은 원인은 ServiceEntry 자동 관리 컨트롤러의 방어 로직 오류였습니다. 들어가면 안 되는 주소가 ServiceEntry에 들어간 것입니다.

회고에서는 담당자의 휴가와 순차 확인 습관을 사람 쪽 병목으로 꼽았습니다. 도구 쪽에서는 슬랙에 뒤섞인 Grafana, AWS 콘솔, Datadog 캡처의 맥락을 맞추는 데 비용이 컸습니다.

## 웹 플랫폼과 Doctor Agent의 역할

당근 SRE팀이 Grafana에서 느낀 한계는 time series와 pie chart로 표현하기 어려운 문제가 있다는 점이었습니다. 서비스 대시보드 패널은 70개를 넘었고 서비스별 패널 분기도 어려웠으며, 얼럿 하나에도 policy와 contact point를 알아야 했습니다.

당근은 도구 병목을 풀기 위해 관점을 표준화한 자체 옵저버빌리티 웹 플랫폼을 택했습니다. 웹 플랫폼과 자체 얼럿 엔진은 지난해부터 개발 중이며, Grafana에서 이전하는 작업은 아직 끝나지 않았습니다. 목표는 홈에서 리전, 서비스 맵, 워크로드로 내려가는 드릴다운, 모바일 웹부터 Pod까지의 트래픽 경로 같은 당근 인프라 맥락의 표현, Datadog APM 트레이스와 사내 eBPF 스캐너 같은 관측 서비스의 통합입니다.

사람 병목은 AI 에이전트의 병렬 분석으로 풀기로 했습니다. Doctor Agent의 기반은 SRE 컴포넌트별 닥터 대시보드입니다. PoC는 Python LangGraph의 ReAct 루프로, Grafana, Prometheus, Loki, kubectl, istioctl을 도구로 씁니다. 이후 서비스 닥터, 사내 얼럿 딜리버리 연동, 슬랙 대화형, 코딩 에이전트를 통한 PR까지 확장하고 다른 팀 에이전트도 Doctor를 호출하게 할 계획입니다. Loki 닥터 대시보드는 [Loki 운영기]({{< relref "/external/daangn/talks/sre-meetup-4/01-loki-one-year.md" >}})에도 나옵니다.

## PoC에서 확인한 변화

발표자는 뒤늦게 합류한 사람도 상황을 빨리 따라오고 불필요한 질문이 줄었다고 전했습니다. PoC에서 Claude Sonnet은 1~2분 안에 의미 있는 분석 리포트를 냈습니다. 단축 시간은 정량으로 제시하지 않았습니다. 발표는 다음 목표로 끝납니다.

> "더 많은 화면이 아니라 더 짧은 시간에 더 좋은 판단" (발표 마무리, 자막)

## 남은 과제와 해석의 한계

발표자는 모델이 발전하면서 직접 만든 지시문이 오히려 제약이 된 경험을 교훈으로 꼽고, 자율 분석의 여지를 남기며 품질을 추적하는 방향을 제시했습니다. 플랫폼 MCP, SRE 도구 연결, 다른 조직으로의 확장, 분석 품질 관리가 다음 과제입니다.

3월 장애의 ServiceEntry 자동 관리 로직과 [Istio ServiceEntry 자동생성 발표]({{< relref "/external/daangn/talks/sre-meetup-4/02-istio-serviceentry.md" >}})의 CronJob이 같은 컴포넌트인지는 두 영상 어디에서도 확인되지 않습니다. 이 요약에서도 둘을 같은 것으로 단정하지 않습니다.

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
