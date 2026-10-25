---
title: "EKS 크로스 AZ 호출을 줄여 전송 비용을 절반 이하로 낮추기"
description: "멀티 AZ EKS에서 파드 호출이 가용 영역을 넘으며 생긴 비용을 줄인 사례다. VPC Flow Logs로 큰 구간을 찾고 Istio Locality Load Balancing과 Outlier Detection, Topology Aware Hints를 적용한 과정과 조건을 정리한다."
date: 2026-10-21
weight: 7
---

# EKS 크로스 AZ 호출을 줄여 전송 비용을 절반 이하로 낮추기 (SRE 밋업 3회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Case Study on Reducing Amazon EKS Data Transfer Costs | Karrot SRE Meetup Vol. 3](https://www.youtube.com/watch?v=HPYuFpKJI-E) (19:40). 한국어 제목 영상은 채널 검색에서 찾지 못했고, 영문 제목 영상의 한국어 음성을 근거로 삼았습니다.
- 매체 · 게시일: YouTube 당근 채널 · 2023-06-27 (슬라이드 표지에 2023.06.15)
- 발표자: 허진수(Koriel). 슬라이드 표지에 인프라실 SRE팀 클러스터 파트로 적혀 있습니다.
- 근거: YouTube 자동 자막 전체 + 발표 슬라이드
- 발표 영상의 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## VPC Flow Logs로 크로스 AZ 호출 주체를 찾았다 {#비용이-큰-통신-구간-찾기}

당근은 멀티 AZ EKS에서 가용 영역을 넘는 파드 호출의 데이터 전송 비용을 줄이려 했습니다. 어떤 파드가 얼마나 보내는지 보기 위해 VPC Flow Logs와 파드 메타데이터를 S3에 저장하고 Athena에서 조인했습니다.

가장 큰 비용은 외부 요청을 받는 Istio Ingress Gateway에서 발생했습니다. Istio 메시 내부의 파드 호출도 가용 영역을 자주 넘었습니다. Istiod와 모니터링 트래픽도 예상보다 컸는데, 한 영역의 수집기가 다른 영역 파드의 메트릭을 가져갔기 때문입니다.

## Istio와 Kubernetes에 같은 영역 우선 규칙을 넣었다 {#같은-영역으로-보내도록-설정}

Istio 서비스에는 Locality Load Balancing과 Outlier Detection을 함께 적용했습니다. 발표자는 영역마다 `Hello world` 파드를 하나씩 두고 `curl`로 호출했습니다. DestinationRule에서 `localityLbSetting`만 켰을 때는 양쪽 영역의 파드가 모두 응답했고, Outlier Detection을 추가한 뒤 같은 영역의 파드만 응답했습니다.

Istio는 EKS 워커 노드의 리전·영역 정보를 사이드카 설정에 넣어 가까운 파드를 우선할 수 있습니다. 같은 영역에 정상 파드가 없을 때 다른 영역으로 장애 조치하려면 Outlier Detection이 필요합니다. 발표자가 Istio 커뮤니티에서 받은 답도 두 설정을 함께 사용해야 한다는 내용이었습니다.

Istio를 사용하지 않는 서비스에는 Kubernetes Service의 Topology Aware Hints 어노테이션을 `auto`로 설정했습니다. kube-proxy는 EndpointSlice의 영역 힌트로 같은 영역의 파드만 선택하는 iptables 규칙을 만듭니다. 데모에서도 가까운 파드만 응답했습니다. 발표자는 다른 영역의 사이드카 설정까지 전달할 이유가 없다며 Istio 환경에서도 Istiod Service에 이 설정을 적용하라고 권했습니다.

## 코드 변경 없이 다음 날 일 비용이 절반 아래로 줄었다 {#설정-적용-뒤-비용-변화}

서비스 코드는 바꾸지 않고 Locality Load Balancing과 Topology Aware Hints만 설정했습니다. 적용 다음 날 일 비용은 절반 아래로 내려갔습니다. 2월 말에 적용한 뒤 4월 월 청구액도 2월의 절반 이하였습니다. 정확한 대략값과 읽은 방식은 근거 표에 남겼습니다.

## 같은 영역 우선은 파드가 고르게 배치될 때 효과가 난다 {#영역별-파드-분포-주의}

한 가용 영역 전체가 내려가면 Outlier Detection이 다른 영역으로 장애 조치하므로 발표자는 가용성 문제가 없다고 설명합니다. 파드가 한 영역에 몰려 있으면 가까운 파드 우선 정책 때문에 트래픽도 그쪽에 집중됩니다. 따라서 영역별로 파드를 고르게 배치해야 하며, 이 상태는 [모니터링 발표]({{% relref "/external/daangn/talks/sre-meetup-3/06-monitoring-karrot-services.md" %}})의 가용 영역 쏠림 모니터에서 확인합니다.

이 사례는 멀티 AZ 클러스터를 유지한다는 전제입니다. 발표자는 비용 절감만 본다면 단일 영역 클러스터 여러 개를 액티브-액티브로 운영하는 구성이 답일 수도 있다고 덧붙였습니다.

## 주요 구간

- [03:35](https://www.youtube.com/watch?v=HPYuFpKJI-E&t=215s) 크로스존 트래픽이 생기는 곳 확인하기
- [06:46](https://www.youtube.com/watch?v=HPYuFpKJI-E&t=406s) Istio Locality LB 적용과 테스트 환경
- [08:53](https://www.youtube.com/watch?v=HPYuFpKJI-E&t=533s) Outlier Detection이 필요한 이유
- [10:56](https://www.youtube.com/watch?v=HPYuFpKJI-E&t=656s) Istio를 쓰지 않는 서비스의 Topology Aware Hints
- [13:00](https://www.youtube.com/watch?v=HPYuFpKJI-E&t=780s) 비용 절감 결과와 고려할 점
- [15:01](https://www.youtube.com/watch?v=HPYuFpKJI-E&t=901s) Envoy와 kube-proxy 내부 동작

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
