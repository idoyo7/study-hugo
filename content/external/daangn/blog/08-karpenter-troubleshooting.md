---
title: "당근페이가 Karpenter 도입 후 해결한 스케줄링과 노드 교체 문제"
description: "당근페이의 Karpenter 운영 사례입니다. 커스텀 AMI, 스케줄링 시뮬레이션, 메모리 계산, 작은 노드 편중, 반복적인 노드 교체에 대응한 설정과 제약을 요약합니다."
date: 2026-10-21
weight: 4
---

# 당근페이가 Karpenter 도입 후 해결한 스케줄링과 노드 교체 문제 (2025-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Karpenter 트러블슈팅 — 비용과 안정성 두 마리 토끼 잡기](https://medium.com/daangn/karpenter-%ED%8A%B8%EB%9F%AC%EB%B8%94%EC%8A%88%ED%8C%85-%EB%B9%84%EC%9A%A9%EA%B3%BC-%EC%95%88%EC%A0%95%EC%84%B1-%EB%91%90%EB%A7%88%EB%A6%AC-%ED%86%A0%EB%81%BC-%EC%9E%A1%EA%B8%B0-ce8bd45ec8f2)
- 매체 · 게시일: Medium 당근 블로그 · 2025-03-27
- 저자: Yany Choi (당근페이 인프라팀 Site Reliability Engineer). 당근 SRE팀 클러스터 파트 글이 아닙니다.
- 근거: 블로그 본문 (코드 조각과 도식 속 수치는 확인하지 않았습니다)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## ASG가 늘면서 복잡해진 노드 운영 {#asg-운영에서-드러난-한계}

당근페이는 클러스터 오토스케일러와 HPA 없이 ASG로 노드를 관리했습니다. 규정에 따라 노드·서브넷을 분리해야 하는 워크로드가 늘자 ASG도 많아졌습니다. 스케일 아웃에는 네트워크 병목이 발생했고, 클러스터를 업데이트할 때마다 ASG별로 AMI를 바꿔야 했습니다. 트래픽이 적은 새벽에도 리소스 사용량은 높았습니다.

사용자와 거래량이 급증한 뒤 팀은 Karpenter를 도입했습니다. 원문은 도입 자체보다 이후 운영에서 마주친 다섯 문제와 대응에 초점을 둡니다.

## AMI 검색부터 consolidation까지 조정한 내용 {#도입-뒤-부딪힌-문제와-선택}

보안 규정을 반영한 골든 이미지를 커스텀 AMI로 쓰려면 태그로 검색할 수 있어야 했습니다. 계정 간 AMI 복사에는 태그가 따라오지 않아, 팀은 여러 계정에 태그를 붙이는 별도 파이프라인을 만들었습니다.

스케줄링에서는 ReplicaSet별 skew 계산에 사용하던 `matchLabelKeys`가 문제였습니다. Karpenter는 Provisioning과 Disruption 루프에서 자체 시뮬레이션을 실행하므로 kube-scheduler의 기능과 차이가 날 수 있습니다. 당시에는 해당 기능이 빠져 있어 사용을 포기했습니다. 관련 PR은 1년 넘게 upstream에 머물다가 1.3.0에 반영됐습니다.

메모리 용량 계산에도 차이가 있었습니다. Karpenter가 인스턴스 메모리에서 일정 비율을 뺀 추정치가 실제 사용 가능량과 달라 프로비저닝이 과도하게 이뤄졌습니다. 팀은 허용한 인스턴스 중 오차가 가장 큰 경우를 설정에 반영했습니다. 1.1.0에서 생성된 인스턴스의 실제 리소스를 캐싱한 뒤에는 계산이 실제 값에 더 가까워졌습니다.

기존 2xlarge 기준 설정을 옮겼더니 xlarge 노드가 주로 생성돼 노드마다 실행하는 DaemonSet 비용이 늘었습니다. 낮은 consolidation budget으로 MultiNodeConsolidation은 실행되지 않고 SingleNodeConsolidation만 일어난 것이 원인이었습니다. budget을 높였을 때는 이동이 지나치게 잦아, 최소 노드 크기를 2xlarge로 제한했습니다.

롤링·카나리 배포로 Pod 수요가 바뀔 때는 노드 삭제와 생성이 연쇄적으로 반복됐습니다. budget 10%에서는 전체 노드의 약 50%가 순차 교체됐고, 1로 낮춰도 낮 시간의 Churn이 계속됐습니다. 팀은 낮에는 1, 새벽에는 2를 적용해 새벽에 consolidation을 더 처리하도록 조정했습니다.

## 비용 절감과 노드 교체 규모의 변화 {#비용과-운영-변화}

도입 후 월간 인프라 비용이 약 10,000달러 줄었고, 워커 노드의 AMI 교체와 점진 업데이트도 수월해졌습니다. 연쇄 consolidation은 전체 노드의 10% 안에서 일어나는 수준으로 줄었습니다.

노드 웜업에 따른 지연은 모든 가용 영역에 여유 노드를 유지하는 Overprovisioning Pod와 JVM 서비스의 readinessProbe로 줄여 가고 있습니다. 이는 원문 작성 당시 진행 중인 대응입니다.

## 배포 중인 서비스의 노드 이동 제한 {#배포와-churn이-겹칠-때의-주의점}

당근페이에서는 배포와 Churn이 겹쳐 지연이 크게 늘어난 적이 있습니다. 원문 작성 당시 팀은 배포 중인 서비스에 `karpenter.sh/do-not-disrupt`를 자동으로 넣는 컨트롤러와, 스케줄링 차이를 조사할 Karpenter 시뮬레이터를 개발하고 있었습니다.

당근 SRE팀 클러스터 파트의 전환 과정은 별도의 [Karpenter 도입기 발표]({{< relref "/external/daangn/talks/builder-meetup-2026/01-karpenter-adoption.md" >}})에 있습니다. 두 사례는 팀과 운영 환경을 구분해 읽어야 합니다.

{{% details title="근거와 세부 수치" closed="true" %}}

| 항목 | 값 | 비고 |
|---|---|---|
| 월간 인프라 비용 절감 | 약 10,000달러 | 원문 표기 "약 10,000$" |
| Karpenter 버전 | v1.1.1 기준 작성 | `matchLabelKeys`는 1.3.0에서 반영 |
| 리소스 캐싱 패치 | 1.1.0 | 생성된 인스턴스의 실제 리소스 반영 |
| Churn 당시 budget | 10% | 클러스터 노드 약 50%가 연쇄 교체 |
| 개선 후 budget | 낮 1, 새벽 2 | 연쇄 consolidation이 전체 노드의 10% 안으로 |
| 기존 기본 노드 | 2xlarge | Karpenter 도입 후 xlarge 위주로 생성됨 |

{{% /details %}}
