---
title: "Job을 중단하지 않고 EKS 노드 그룹 자동 확장·축소하기"
description: "당근이 고정 크기 Job 노드 그룹을 자동 확장·축소하도록 바꾼 과정입니다. PodAffinity로 Pod를 모은 뒤 kubelet, 이미지 다운로드, EBS, CNI 병목에 대응한 내용을 요약합니다."
date: 2026-10-21
weight: 1
---

# Job을 중단하지 않고 EKS 노드 그룹 자동 확장·축소하기 (2026-04)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Job 워크로드를 위한 EKS Node Group 오토스케일링 도입기](https://medium.com/daangn/job-%EC%9B%8C%ED%81%AC%EB%A1%9C%EB%93%9C%EB%A5%BC-%EC%9C%84%ED%95%9C-eks-node-group-%EC%98%A4%ED%86%A0%EC%8A%A4%EC%BC%80%EC%9D%BC%EB%A7%81-%EB%8F%84%EC%9E%85%EA%B8%B0-a6a28376d153) (영문판 [Our Journey to Autoscaling EKS Node Groups for Job Workloads](https://medium.com/daangn/our-journey-to-autoscaling-eks-node-groups-for-job-workloads-e8a6a7ed845e))
- 매체 · 게시일: Medium 당근 블로그 · 2026-04-16
- 저자: Jungsub Shin (Ssup, 당근 SRE팀 클러스터 파트)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 실행 중인 Job 때문에 줄이지 못한 노드 {#고정-크기-job-노드-그룹의-한계}

당근은 실행 중인 Job을 보호하려고 Server와 Job의 Node Group을 분리했습니다. Job은 중단되면 처음부터 다시 실행해야 했고, 1시간 넘게 걸리는 작업도 있었습니다. 이 때문에 scale-in 때 노드를 자유롭게 지울 수 없었습니다.

고정 크기인 Job 그룹은 한가할 때도 여유 노드 비용이 들었습니다. 반대로 작업이 몰리면 시작이 늦어져 운영자가 노드 수를 조정해야 했습니다. 자동 확장·축소를 도입하려면 작업을 실행할 여유를 확보하면서, 실행 중인 Job은 중단하지 않아야 했습니다.

## Pod를 모은 뒤 드러난 노드 내부 병목 {#pod를-모으고-집중-부하를-제어한-방법}

당근은 Job Pod를 소수 노드에 모으는 bin-packing을 적용했습니다. Volcano, YuniKorn, 기본 스케줄러의 MostAllocated 전략을 검토했지만 별도 스케줄러를 운영하는 부담 때문에 채택하지 않았습니다. 대신 같은 Pod가 많은 노드에 높은 점수를 주는 preferred PodAffinity를 사용했습니다. weight는 100, topologyKey는 hostname이며, Kyverno가 Argo Workflow 소유 Pod에 라벨과 affinity를 넣습니다.

노드 축소로 Job이 중단되지 않도록 보호 어노테이션도 주입합니다. Cluster Autoscaler에는 `safe-to-evict: "false"`, Karpenter에는 `karpenter.sh/do-not-disrupt: "true"`를 붙입니다.

Alpha에서 동작을 확인한 뒤 Production에 적용하자, 10분 단위, 특히 정시에 시작하는 Job이 소수 노드에 집중됐습니다. CPU request가 실제 사용량보다 작아 kubelet이 감당하기 어려울 만큼 Pod가 배치됐고, Job 노드의 maxPods를 낮춰 대응했습니다. 이미지 다운로드 실패에는 `registryPullQPS`와 `registryBurst`를 높였고, EBS throttling에는 IOPS와 throughput을 증설했습니다. 조정 전후 값은 아래 표에 모았습니다.

CNI IP 할당이 늦어지는 문제는 [Host Network]({{< relref "/external/daangn/blog/02-host-network.md" >}})를 적용해 Job의 IP 할당 과정을 생략했습니다. maxPods의 기존 234는 4xlarge 이상에서 사용하던 기본값이며, Job 노드는 60으로 제한했습니다.

## 자동 확장·축소 후 달라진 시간과 노드 수 {#실행-시간과-운영-부담의-변화}

workflow Pod는 평균 Pending과 Running 시간이 줄었습니다. job(amd64)의 평균 노드 수도 줄었지만, 모든 그룹과 지표가 같은 방향으로 변하지는 않았습니다. arm 그룹의 노드 수와 Image Pull 시간, job Pod의 Running 시간은 늘었습니다. 지표별 수치는 아래 표에 함께 실었습니다.

저자는 노드 수를 지켜보며 수동으로 조정하던 부담이 사라졌다는 점을 주요 효과로 꼽았습니다. 적용 대상은 CronJob, Airflow, Dagster, GitHub Actions Runner를 포함한 모든 Job 워크로드입니다.

## 정시 부하와 잦은 노드 교체의 영향 {#pod-밀도와-이미지-캐시에서-확인할-점}

정시에 Job이 집중되는 부하는 Alpha에서 재현되지 않았습니다. Production에서는 Pod 밀도가 높아진 뒤 kubelet, 레지스트리 QPS, EBS, CNI가 차례로 병목이 됐습니다. bin-packing을 적용할 때는 노드의 CPU·메모리뿐 아니라 Pod 생성 과정도 함께 확인해야 한다는 사례입니다.

당근은 Image Pull 시간이 늘어난 이유를 잦은 노드 교체로 이미지 캐시가 줄었기 때문이라고 봤습니다. 같은 저자의 [Karpenter 도입 발표]({{< relref "/external/daangn/talks/builder-meetup-2026/01-karpenter-adoption.md" >}})에는 노드 그룹을 점진적으로 전환한 과정이 나옵니다.

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
