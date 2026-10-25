---
title: "필요한 AZ에 노드를 만들기 위한 당근의 Karpenter 전환"
description: "당근이 Cluster Autoscaler에서 Karpenter로 전환한 발표를 요약합니다. 특정 AZ에서 길어지던 Pending, 노드 그룹별 전환 절차, 축소 정책과 비용 변화를 다룹니다."
date: 2026-10-21
weight: 1
---

# 필요한 AZ에 노드를 만들기 위한 당근의 Karpenter 전환 (2026 빌더 밋업)

{{< callout type="info" >}}
**원문 정보**
- 원문: [EKS 노드를 재단하는 목수 : 당근의 Karpenter 도입 여정 | 2026 당근 빌더 밋업](https://www.youtube.com/watch?v=rmGEMwQIG-A) (31:06)
- 매체 · 게시일: YouTube 당근 채널 · 2026-10-07 (SRE Day)
- 발표자: 신정섭 (EKS 클러스터 라이프사이클·GPU 인프라 담당, 자막 기준). [Job 노드 그룹 블로그 글]({{< relref "/external/daangn/blog/03-job-nodegroup-autoscaling.md" >}})의 저자와 같은 인물입니다.
- 근거: YouTube 자동 자막 전체 (공개된 슬라이드 없음)
- 발표 영상의 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 빈 노드가 있어도 특정 AZ에서 기다리는 Pod {#필요한-az에-노드가-생기지-않는-문제}

당근은 AZ 두 개에 걸쳐 클러스터를 운영하며 대부분의 Pod에 topologySpreadConstraints를 적용했습니다. 특정 AZ에 배치해야 하는 Pod가 생겨도 Cluster Autoscaler는 ASG 용량을 늘릴 뿐, 새 노드의 AZ를 지정하지 못했습니다. Pod를 한꺼번에 생성하면 NotTriggerScaleUp 이벤트와 함께 짧게는 5분 미만, 길게는 30분 넘게 Pending이 이어졌습니다.

팀은 우선 topology spread 제약이 없는 낮은 우선순위의 overprovisioning Pod를 배치했습니다. Cluster Autoscaler가 이 Pod의 Pending을 보고 증설하도록 유도한 것입니다. 그러나 증설이 여러 차례에 나뉘었고, 여유 Pod를 늘리면 비용도 증가했습니다.

## 노드 그룹별로 전환한 순서 {#karpenter-선택과-점진-전환}

Karpenter는 ASG 없이 노드 수명주기를 관리하면서 AZ와 볼륨 등 스케줄링 제약에 맞춰 인스턴스를 선택합니다. 발표자는 이 동작과 함께 널리 사용되는 도구라는 점을 선택 이유로 들었습니다.

당근은 클러스터를 새로 만들지 않고 노드 그룹을 하나씩 전환했습니다. 먼저 PDB를 설정하고 로드밸런서를 IP 타깃으로 바꿨습니다. 발표에서는 기존 instance 타깃 구성이 ASG 소속 노드만 지원했다고 설명합니다. 이후 Karpenter 노드 그룹을 생성하고 이전 노드를 cordon·drain한 다음 삭제했습니다.

Karpenter 자체는 ASG 노드 그룹에 남겼습니다. 각 노드 그룹은 NodeClass 하나와 NodePool 여러 개로 구성하고 weight로 우선순위를 정했습니다. consolidation 정책은 stateless workers와 jobs를 구분해 적용했습니다. 구체적인 인스턴스 우선순위와 정책 값은 아래 설정표에 있습니다.

## Pending 감소와 여유 노드 제거 {#pending-시간과-비용의-변화}

네임스페이스별 평균 Pending은 기존에 최대 4분 수준이던 값에서 약 30초로 줄었습니다. 당근은 생활 시간에 따라 변하고 급격한 스파이크가 없는 자사 트래픽에서 overprovisioning Pod가 더는 필요하지 않다고 판단해 제거했습니다.

메모리를 많이 쓰는 워크로드를 별도 노드 그룹으로 옮긴 뒤에는 비용이 약 8% 추가로 줄었습니다. 이 비율은 해당 그룹 분리의 효과이며, 전체 Karpenter 전환의 절감률과 같지는 않습니다.

## 축소 정책과 배포 때의 노드 증가 {#노드-축소와-인스턴스-선택에서-주의할-점}

새벽에도 줄지 않던 노드는 PDB를 5%에서 30%로 조정하자 축소됐습니다. 롤링 배포 때 약 500개에서 550개로 노드가 늘어나는 문제에는 큰 워크로드의 maxSurge를 조정했습니다.

인스턴스는 C·M·R 패밀리를 함께 쓰되 세대는 섞지 않습니다. Karpenter의 선택은 현재 Pending인 Pod를 기준으로 하므로 이후 수요까지 예상해 최적화하지는 않습니다. 관련 설정은 이 사이트의 [Karpenter 문서]({{< relref "/platform/kubernetes/karpenter/_index.md" >}})에서도 확인할 수 있습니다.

## 주요 구간

- [01:00](https://www.youtube.com/watch?v=rmGEMwQIG-A&t=60s) Pending과 NotTriggerScaleUp
- [03:30](https://www.youtube.com/watch?v=rmGEMwQIG-A&t=210s) AZ, topology spread, Cluster Autoscaler의 한계
- [07:00](https://www.youtube.com/watch?v=rmGEMwQIG-A&t=420s) overprovisioning 우회책
- [10:30](https://www.youtube.com/watch?v=rmGEMwQIG-A&t=630s) 노드 그룹 단위 점진 전환
- [18:00](https://www.youtube.com/watch?v=rmGEMwQIG-A&t=1080s) PDB와 IP 타깃 설정
- [22:00](https://www.youtube.com/watch?v=rmGEMwQIG-A&t=1320s) 전환 효과

{{% details title="세부 설정 근거 표 (모두 자막 기준)" closed="true" %}}

| 항목 | 내용 |
|---|---|
| NodePool weight 예 | workers는 c6i.12xlarge weight 100, 안 되면 c6i.8xlarge weight 99 |
| consolidation | stateless workers `WhenEmptyOrUnderutilized`, jobs `WhenEmpty` |
| 메모리 큰 워크로드 그룹 | workers-memory (M 시리즈만), CPU 1개당 메모리 4GB 이상이면 사내 배포 도구가 이 그룹으로 배치 |
| 비용 효과 | 분리 뒤 약 8% 추가 절감 |
| 인스턴스 패밀리 | C(1:2), M(1:4), R(1:8) 혼용, 세대는 혼용하지 않음 |
| PDB | 5%에서 30%로 상향 |
| 롤링 배포 시 노드 수 | 약 500개 → 550개 |
| 평균 Pending | 최대 4분 수준 → 약 30초 |

월 절감액은 발표 슬라이드에서 숫자를 가렸고 자막 값도 신뢰하기 어려워 싣지 않았습니다.

{{% /details %}}
