---
title: "EKS 노드를 재단하는 목수: 당근의 Karpenter 도입 여정"
description: "2026 당근 빌더 밋업에서 클러스터 파트가 발표한 Cluster Autoscaler에서 Karpenter로의 전환 요약입니다. 네임스페이스별 평균 Pending이 최대 4분 수준에서 약 30초로 줄었습니다."
date: 2026-10-21
weight: 1
---

# EKS 노드를 재단하는 목수: 당근의 Karpenter 도입 여정 (2026 빌더 밋업)

{{< callout type="info" >}}
**원문 정보**
- 원문: [EKS 노드를 재단하는 목수 : 당근의 Karpenter 도입 여정 | 2026 당근 빌더 밋업](https://www.youtube.com/watch?v=rmGEMwQIG-A) (31:06)
- 매체 · 게시일: YouTube 당근 채널 · 2026-10-07 (SRE Day)
- 발표자: 신정섭 (EKS 클러스터 라이프사이클·GPU 인프라 담당, 자막 기준). [Job 노드 그룹 블로그 글]({{< relref "/external/daangn/blog/03-job-nodegroup-autoscaling.md" >}})의 저자와 같은 인물입니다.
- 근거: YouTube 자동 자막 전체 (공개된 슬라이드 없음)
- 이 문서는 영상을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## 주요 구간

- [01:00](https://www.youtube.com/watch?v=rmGEMwQIG-A&t=60s) Pending과 NotTriggerScaleUp
- [03:30](https://www.youtube.com/watch?v=rmGEMwQIG-A&t=210s) AZ, topology spread, Cluster Autoscaler의 한계
- [07:00](https://www.youtube.com/watch?v=rmGEMwQIG-A&t=420s) overprovisioning 우회책
- [10:30](https://www.youtube.com/watch?v=rmGEMwQIG-A&t=630s) 노드 그룹 단위 점진 전환
- [18:00](https://www.youtube.com/watch?v=rmGEMwQIG-A&t=1080s) PDB와 IP 타깃 설정
- [22:00](https://www.youtube.com/watch?v=rmGEMwQIG-A&t=1320s) 전환 효과

## 필요한 AZ에 노드가 생기지 않는 문제

당근은 AZ 두 개를 쓰고 대부분의 Pod에 topologySpreadConstraints를 걸었습니다. Pod가 특정 AZ에 묶여도 Cluster Autoscaler는 ASG 용량만 조절할 뿐 AZ를 지정하지 못했습니다. Pod가 한꺼번에 뜨면 일부는 짧게는 5분 미만, 길게는 30분 넘게 Pending에 머물렀고 NotTriggerScaleUp 이벤트가 나타났습니다.

우회책은 spread가 없는 낮은 우선순위의 overprovisioning Pod였습니다. Cluster Autoscaler는 Pending 중인 이 Pod만 보고 그 수만큼 노드를 만들었습니다. 증설은 여러 번에 나뉘었고, overprovisioning Pod를 늘릴수록 비용도 커졌습니다.

## Karpenter 선택과 점진 전환

Karpenter는 AZ를 지정해 노드를 만들고, 볼륨 같은 스케줄링 제약에 맞춰 인스턴스를 고릅니다. ASG 없이 노드 수명주기를 직접 관리하며, 사실상의 표준이라는 점도 발표자가 밝힌 선택 이유입니다.

당근은 같은 클러스터에서 노드 그룹별로 점진 전환했습니다. 각 그룹에 PDB를 설정하고 로드밸런서를 IP 타깃으로 바꿨습니다. instance 타깃은 ASG 소속 노드만 지원하기 때문입니다. 이어 Karpenter 노드 그룹을 만들고 기존 노드를 cordon과 drain한 뒤 제거했습니다.

Karpenter 자체는 ASG 노드 그룹에서 실행합니다. 각 노드 그룹에는 NodeClass 하나와 NodePool 여러 개를 두고 weight로 우선순위를 정했습니다. consolidation은 stateless workers에 `WhenEmptyOrUnderutilized`, jobs에 `WhenEmpty`를 적용했습니다.

## Pending 시간과 비용의 변화

- 네임스페이스별 평균 Pending은 Cluster Autoscaler 시절 최대 4분 수준에서 평균 약 30초로 감소.
- 생활 시간에 비례하고 급격한 스파이크가 없는 당근 트래픽에서는 overprovisioning Pod가 불필요하다고 판단해 제거하고 비용 절감.
- 메모리가 큰 워크로드를 별도 노드 그룹으로 분리해 비용 약 8% 추가 절감.

## 노드 축소와 인스턴스 선택에서 주의할 점

PDB를 5%에서 30%로 높이자 새벽에도 줄지 않던 노드가 바로 줄었습니다. 롤링 배포 때는 노드가 약 500개에서 550개로 출렁여 큰 워크로드만 maxSurge를 조정했습니다.

인스턴스는 C·M·R 패밀리를 섞고 세대는 섞지 않습니다. Karpenter는 현재 Pending인 Pod만 보고 인스턴스를 고르므로 미래 수요까지 고려한 최적 선택은 못 합니다.

이 사이트의 관련 문서: [Karpenter]({{< relref "/platform/kubernetes/karpenter/_index.md" >}})

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
