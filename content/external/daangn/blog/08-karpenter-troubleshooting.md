---
title: "Karpenter 트러블슈팅 — 비용과 안정성 두 마리 토끼 잡기"
description: "당근페이 인프라팀이 ASG 기반 클러스터를 Karpenter로 옮기며 겪은 다섯 가지 문제와 해결 과정의 요약입니다. 스케줄링 시뮬레이션의 한계, 커스텀 AMI, 작은 노드 편중, 리소스 계산 오차, Node Churn을 다룹니다."
date: 2026-10-21
weight: 4
---

# Karpenter 트러블슈팅 — 비용과 안정성 두 마리 토끼 잡기 (2025-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Karpenter 트러블슈팅 — 비용과 안정성 두 마리 토끼 잡기](https://medium.com/daangn/karpenter-%ED%8A%B8%EB%9F%AC%EB%B8%94%EC%8A%88%ED%8C%85-%EB%B9%84%EC%9A%A9%EA%B3%BC-%EC%95%88%EC%A0%95%EC%84%B1-%EB%91%90%EB%A7%88%EB%A6%AC-%ED%86%A0%EB%81%BC-%EC%9E%A1%EA%B8%B0-ce8bd45ec8f2)
- 매체 · 게시일: Medium 당근 블로그 · 2025-03-27
- 저자: Yany Choi (당근페이 인프라팀 Site Reliability Engineer). 당근 SRE팀 클러스터 파트 글이 아닙니다.
- 근거: 블로그 본문 (코드 조각과 도식 속 수치는 확인하지 않았습니다)
- 이 문서는 원문을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## ASG 운영에서 드러난 한계

당근페이는 클러스터 오토스케일러와 HPA 없이 ASG로 노드를 관리했습니다. 컴플라이언스상 노드와 서브넷을 분리해야 하는 워크로드가 늘면서 ASG도 늘었습니다. 스케일 아웃 때는 여러 곳에서 네트워크 병목이 생겼고, 클러스터 업데이트에는 ASG별 AMI 교체가 필요했습니다. 트래픽이 적은 새벽에도 리소스 사용량은 많았습니다. 사용자와 거래량 급증을 계기로 Karpenter를 도입했고, 원문은 이후 겪은 다섯 가지 문제와 대응을 설명합니다.

## 도입 뒤 부딪힌 문제와 선택

보안 규정을 지킨 골든 이미지를 커스텀 AMI로 쓰려면 AMI를 태그로 찾아야 했습니다. 계정이 나뉜 환경에서 AMI를 복사하면 태그가 따라가지 않아, 팀은 여러 계정에 한꺼번에 태그를 붙이는 별도 파이프라인을 만들었습니다.

스케줄링에서는 팀이 쓰던 `matchLabelKeys`(ReplicaSet별 skew 계산)를 포기해야 했습니다. Karpenter는 Provisioning과 Disruption 루프마다 내부 시뮬레이션으로 스케줄링을 판단하지만, kube-scheduler를 모방한 구현이라 동작이 완전히 같다는 보장은 없습니다. 당시 시뮬레이션에 빠져 있던 이 기능은 1년 넘게 upstream PR에 머문 뒤 1.3.0에 반영됐습니다.

Karpenter가 계산한 메모리도 실제 노드와 어긋났습니다. Karpenter가 인스턴스 메모리에서 일괄 비율로 오버헤드를 뺀 값이 실제 사용 가능량과 달라 프로비저닝이 공격적으로 이뤄졌습니다. 팀은 우선 허용 인스턴스 중 가장 큰 갭을 기준 값으로 반영했습니다. 1.1.0에서 생성된 인스턴스의 실제 리소스를 캐싱하게 된 뒤에는 정합성이 크게 좋아졌습니다.

기존 2xlarge 기준 구성을 그대로 올렸더니 xlarge 위주로 노드가 생겼고, 노드 수에 비례하는 DaemonSet 비용이 늘었습니다. 낮은 consolidation budget 때문에 MultiNodeConsolidation 없이 SingleNodeConsolidation만 일어난 것이 원인이었습니다. budget을 높이면 이동이 지나치게 공격적이어서, 팀은 최소 노드 크기를 2xlarge로 제한했습니다.

Node Churn은 배포(rolling, canary)로 파드 수요가 흔들릴 때 시작됐습니다. budget이 10%일 때는 클러스터 노드의 약 50%가 순차로 삭제되고 다시 생성됐으며, 1로 낮춰도 낮 시간대의 Churn은 계속됐습니다. 팀은 낮에는 budget 1, 새벽에는 2를 적용해 consolidation이 밤에 미리 처리되도록 했습니다.

## 비용과 운영 변화

- 월간 인프라 비용이 줄었고(금액은 아래 표), 워커 노드 AMI 교체와 점진 업데이트도 수월해졌습니다.
- Node Churn은 연쇄 consolidation이 전체 노드의 10% 안에서 일어나는 수준으로 개선됐습니다.
- 노드 웜업은 모든 가용 영역에 여유 노드를 유지하는 Overprovisioning 파드와 JVM 서비스의 readinessProbe로 줄여 가고 있습니다.

## 배포와 Churn이 겹칠 때의 주의점

당근페이에서는 Churn과 배포가 겹쳐 지연이 크게 튄 경우가 있었습니다. 그래서 팀은 배포 중인 서비스에 `karpenter.sh/do-not-disrupt` 어노테이션을 자동 삽입하는 컨트롤러를 개발 중이라고 설명합니다. 스케줄링이 어긋나는 원인을 찾기 위한 Karpenter 스케줄링 시뮬레이터도 만들고 있습니다.

당근 SRE팀 클러스터 파트가 EKS 클러스터에 Karpenter를 도입한 과정은 [Karpenter 도입기 발표]({{< relref "/external/daangn/talks/builder-meetup-2026/01-karpenter-adoption.md" >}})에 따로 정리돼 있습니다.

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
