---
title: "Amazon EKS 데이터 전송 비용 절감 사례"
description: "당근 SRE 밋업 3회에서 멀티 AZ EKS 클러스터의 크로스존 트래픽 비용을 줄인 사례의 요약입니다. Istio Locality Load Balancing과 Outlier Detection, Kubernetes Topology Aware Hints로 같은 가용 영역 안에서 호출이 끝나게 만든 방법을 다룹니다."
date: 2026-10-21
weight: 7
---

# Amazon EKS 데이터 전송 비용 절감 사례 (SRE 밋업 3회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Case Study on Reducing Amazon EKS Data Transfer Costs | Karrot SRE Meetup Vol. 3](https://www.youtube.com/watch?v=HPYuFpKJI-E) (19:40). 한국어 제목 영상은 채널 검색에서 찾지 못했고, 영문 제목 영상의 한국어 음성을 근거로 삼았습니다.
- 매체 · 게시일: YouTube 당근 채널 · 2023-06-27 (슬라이드 표지에 2023.06.15)
- 발표자: 허진수(Koriel). 슬라이드 표지에 인프라실 SRE팀 클러스터 파트로 적혀 있습니다.
- 근거: YouTube 자동 자막 전체 + 발표 슬라이드
- 이 문서는 영상을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## 주요 구간

- [03:35](https://www.youtube.com/watch?v=HPYuFpKJI-E&t=215s) 크로스존 트래픽이 생기는 곳 확인하기
- [06:46](https://www.youtube.com/watch?v=HPYuFpKJI-E&t=406s) Istio Locality LB 적용과 테스트 환경
- [08:53](https://www.youtube.com/watch?v=HPYuFpKJI-E&t=533s) Outlier Detection이 필요한 이유
- [10:56](https://www.youtube.com/watch?v=HPYuFpKJI-E&t=656s) Istio를 쓰지 않는 서비스의 Topology Aware Hints
- [13:00](https://www.youtube.com/watch?v=HPYuFpKJI-E&t=780s) 비용 절감 결과와 고려할 점
- [15:01](https://www.youtube.com/watch?v=HPYuFpKJI-E&t=901s) Envoy와 kube-proxy 내부 동작

## 비용이 큰 통신 구간 찾기

당근은 멀티 AZ EKS에서 가용 영역(AZ)을 넘는 파드 간 호출에 드는 데이터 전송 비용을 줄이려 했습니다. 어떤 파드가 얼마나 보내는지 확인하려고 VPC Flow Logs와 파드 메타데이터를 S3에 모으고 Athena로 조인했습니다.

비용이 가장 큰 곳은 외부 트래픽을 받는 Istio Ingress Gateway였고, Istio 메시 안의 파드 간 통신에서도 크로스존 트래픽이 많이 발생했습니다. Istiod와 모니터링 비용도 예상보다 컸습니다. 한 영역의 수집기가 다른 영역 파드의 메트릭을 가져가는 통신 때문입니다.

## 같은 영역으로 보내도록 설정

Istio 서비스에는 Locality Load Balancing과 Outlier Detection을 함께 적용했습니다. 발표자는 영역마다 `Hello world` 파드를 하나씩 두고 `curl`로 호출해 동작을 확인했습니다. DestinationRule에서 `localityLbSetting`만 켰을 때는 양쪽 영역의 파드가 모두 응답했고, Outlier Detection을 추가한 뒤에야 같은 영역의 파드만 응답했습니다.

Istio는 EKS 워커 노드의 리전·영역 정보를 읽어 사이드카 프록시 설정에 넣으므로 같은 영역의 파드를 우선 선택할 수 있습니다. 같은 영역에 정상 파드가 없으면 다른 영역으로 장애 조치해야 하며, 이 판단에 Outlier Detection이 필요합니다. 발표자가 Istio 커뮤니티에서 얻은 답도 이 설정이 필수라는 것이었습니다.

Istio를 쓰지 않는 서비스에는 Kubernetes Service의 Topology Aware Hints 어노테이션을 `auto`로 설정했습니다. EndpointSlice에 들어간 영역 정보를 바탕으로 kube-proxy가 같은 영역의 파드로만 보내는 iptables 규칙을 만듭니다. 같은 방식의 데모에서도 같은 영역의 파드만 응답했습니다. 발표자는 다른 영역 사이드카의 프록시 설정까지 전송할 이유가 없다며, Istio를 쓰는 경우에도 Istiod 서비스에 이 설정을 꼭 적용하라고 권합니다.

## 설정 적용 뒤 비용 변화

서비스 코드는 바꾸지 않고 Locality LB와 Topology Aware Hints 설정만 적용했습니다. 적용 다음 날 일 비용은 절반 아래로 줄었습니다. 월 단위로도 2월 말 적용 후 4월 청구액이 2월의 절반 이하로 내려갔습니다(슬라이드 막대 그래프).

## 영역별 파드 분포 주의

발표자는 한 영역 전체가 내려가면 Outlier Detection으로 다른 영역에 장애 조치하므로 문제가 없다고 설명합니다. 주의할 상황은 파드가 한 영역에 몰리도록 배포될 때입니다. 같은 영역으로 트래픽이 쏠리므로 파드를 영역별로 고르게 배포하는 일이 중요하며, 이 쏠림은 [모니터링 발표]({{% relref "/external/daangn/talks/sre-meetup-3/06-monitoring-karrot-services.md" %}})의 가용 영역 쏠림 모니터로 이어집니다.

이 발표는 멀티 AZ 구성을 유지하는 환경을 전제로 합니다. 발표자는 비용 절감만 목표라면 단일 영역 클러스터 여러 개를 액티브-액티브로 묶는 구성이 답일 수도 있다고 덧붙입니다.

{{% details title="근거와 세부 수치" closed="true" %}}

| 항목 | 내용 | 근거 |
|---|---|---|
| 일 비용 | 적용 당일(D-0) 약 US$4,500에서 다음 날(D+1) 약 US$2,000으로 감소 | 슬라이드 막대 그래프 눈금에서 읽은 대략값. 자막은 "다음날 바로 절반"이라고만 말함 |
| 월 비용 | 2월 약 US$140,000에서 4월 약 US$60,000으로 감소 | 슬라이드 막대 그래프 눈금에서 읽은 대략값 |
| 적용 시점 | 2월 말 | 자막 기준 |
| 크로스존 가시화 | VPC Flow Logs와 파드 메타데이터를 S3에 저장하고 Athena로 조인. AWS 샘플 CloudFormation 사용 | 슬라이드, 자막 기준 |
| 비용 큰 구간 | Istio Ingress Gateway, 메시 내부 통신, Istiod, 모니터링 | 슬라이드 |
| Istio 설정 | DestinationRule의 localityLbSetting을 활성화하고 outlierDetection도 설정 | 슬라이드, 자막 |
| 비 Istio 설정 | Service 어노테이션 `service.kubernetes.io/topology-aware-hints: auto` | 슬라이드, 자막 기준 |
| 동작 원리 | Envoy는 EDS로 받은 locality 정보로 같은 영역 호스트를 우선 선택. kube-proxy는 EndpointSlice 힌트로 iptables 규칙 생성 | 슬라이드 |

자막에서는 3월 집계 금액과 원화 환산으로 월 비용이 크게 줄었다고 설명하지만, 자막에서만 확인되는 금액이라 싣지 않았습니다. 슬라이드는 Envoy 소스 위치와 Kubernetes 동작을 자세히 풀어 씁니다. 발표 마지막의 코드 수준 설명은 요약하지 않았습니다.

{{% /details %}}
