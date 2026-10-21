---
title: "Job 워크로드를 위한 EKS Node Group 오토스케일링 도입기"
description: "당근 SRE팀 클러스터 파트가 고정 크기이던 Job용 노드 그룹에 오토스케일링을 붙인 과정의 요약입니다. Pod를 소수 노드에 몰아넣는 bin-packing과 그 부작용을 maxPods 등으로 푼 이야기입니다."
date: 2026-10-21
weight: 1
---

# Job 워크로드를 위한 EKS Node Group 오토스케일링 도입기 (2026-04)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Job 워크로드를 위한 EKS Node Group 오토스케일링 도입기](https://medium.com/daangn/job-%EC%9B%8C%ED%81%AC%EB%A1%9C%EB%93%9C%EB%A5%BC-%EC%9C%84%ED%95%9C-eks-node-group-%EC%98%A4%ED%86%A0%EC%8A%A4%EC%BC%80%EC%9D%BC%EB%A7%81-%EB%8F%84%EC%9E%85%EA%B8%B0-a6a28376d153) (영문판 [Our Journey to Autoscaling EKS Node Groups for Job Workloads](https://medium.com/daangn/our-journey-to-autoscaling-eks-node-groups-for-job-workloads-e8a6a7ed845e))
- 매체 · 게시일: Medium 당근 블로그 · 2026-04-16
- 저자: Jungsub Shin (Ssup, 당근 SRE팀 클러스터 파트)
- 이 문서는 원문을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## 고정 크기 Job 노드 그룹의 한계

당근의 Job용 Node Group은 고정 크기여서 한가할 때는 비용을 낭비하고, Job이 몰리면 시작이 늦어졌습니다. Server용과 Job용 Node Group을 나눈 것도 실행 중인 Job을 지키기 위해서였습니다. Job은 중단하면 처음부터 다시 실행해야 하고, 1시간 넘게 걸리는 Job도 있어 scale-in 때 노드를 자유롭게 지울 수 없었습니다. 여유 노드를 넉넉히 두고 수동으로 수를 조정하는 부담이 남았습니다.

## Pod를 모으고 집중 부하를 제어한 방법

당근은 Job Pod를 소수 노드에 모으는 bin-packing을 선택했습니다. Volcano, YuniKorn, 기본 스케줄러의 MostAllocated 전략을 검토했으나 별도 스케줄러 운영 부담 때문에 채택하지 않았습니다. 대신 같은 Pod가 많은 노드의 점수를 높이는 preferred PodAffinity(weight 100, topologyKey는 hostname)를 적용했습니다. 라벨과 affinity는 Kyverno가 Argo Workflow 소유 Pod에 일괄로 넣는 방식입니다.

노드 축소 때 Job을 보호하는 어노테이션도 같은 방식으로 넣습니다. Cluster Autoscaler에는 `safe-to-evict: "false"`, Karpenter에는 `karpenter.sh/do-not-disrupt: "true"`를 붙입니다.

Alpha에서는 잘 동작했지만 Production에서는 10분 단위, 특히 정시에 몰리는 Job이 소수 노드에 부하를 집중시켰습니다. 당근이 병목별로 적용한 조치는 다음과 같습니다.

- kubelet 과부하: Job의 CPU request가 실제보다 작아 Pod가 과하게 배치됨. maxPods를 4xlarge 이상 기본값 234에서 Job 노드 60으로 낮춰 해결
- Image Pull 실패: kubelet의 `registryPullQPS`를 5에서 40으로, `registryBurst`를 10에서 60으로 상향
- EBS throttling: IOPS를 3,000에서 8,000으로, throughput을 150MB/s에서 800MB/s로 증설
- CNI IP 할당 지연: Host Network Mode를 적용해 IP 할당 생략([Host Network 글]({{< relref "/external/daangn/blog/02-host-network.md" >}}) 참고)

## 실행 시간과 운영 부담의 변화

저자는 노드 수를 지켜보며 수동 조정하던 부담이 사라진 점을 가장 큰 이득으로 꼽습니다.

- workflow Pod 평균 Pending 시간: 1.54초 → 0.78초, 약 49% 감소
- workflow Pod Running 시간: 138초 → 72.6초, 약 47% 감소
- job(amd64) 그룹 평균 노드 수: 5개 → 4.198개, 약 16% 감소

적용 범위는 CronJob, Airflow와 Dagster, GitHub Actions Runner 등 모든 Job 워크로드입니다.

## Pod 밀도와 이미지 캐시에서 확인할 점

당근에서는 bin-packing으로 노드당 Pod 밀도가 높아지면서 kubelet, 레지스트리 QPS, EBS, CNI가 차례로 병목이 됐습니다. 정시 몰림은 Alpha에서 재현되지 않았고 Production에서 처음 확인한 문제입니다.

당근은 노드 교체가 잦아져 이미지 캐시가 줄어든 것을 Image Pull 시간 증가의 원인으로 봅니다. job에서는 3초에서 7.972초로 늘었습니다. 같은 저자의 Karpenter 발표는 [영상 요약]({{< relref "/external/daangn/talks/builder-meetup-2026/01-karpenter-adoption.md" >}})에 있습니다.

{{% details title="전후 비교 근거 표" closed="true" %}}

| 지표 | 도입 전 | 도입 후 |
|---|---|---|
| 평균 노드 수 job(amd64) | 5 | 4.198 (약 16% 감소) |
| 평균 노드 수 job-arm(arm64) | 2 | 4.18 (약 109% 증가) |
| Image Pull 시간 job | 3초 | 7.972초 |
| Image Pull 시간 job-arm | 16초 | 29.76초 |
| workflow Pod Pending 최대 | 14초 | 10초 |
| workflow Pod Pending 평균 | 1.54초 | 0.78초 (약 49% 감소) |
| workflow Pod Running | 138초 | 72.6초 (약 47% 감소) |
| job Pod Running | 290.76초 | 321.48초 (약 10.56% 증가) |
| maxPods (Job 노드) | 234 | 60 |
| registryPullQPS / registryBurst | 5 / 10 | 40 / 60 |
| EBS IOPS / Throughput | 3,000 / 150MB/s | 8,000 / 800MB/s |

원문은 arm 그룹의 노드 수가 늘어난 이유로 Job 수 자체의 증가와 maxPods 제한에 따른 분산을 듭니다.

{{% /details %}}
