---
title: "컨트롤 플레인 파라미터"
weight: 8
---

# 컨트롤 플레인 파라미터 — 무엇을 정할 수 있고 무엇이 닫혀 있나

[EKS 버전 업그레이드]({{< relref "../_index.md" >}}) 챕터의 상위 문서들이 답한 질문은 "어떤 버전으로, 어떤 토폴로지로 blue를 세우는가"였습니다. 이 하위 섹션은 그렇게 세운 클러스터의 **컨트롤 플레인에 무엇을 설정할 수 있는가**를 전수로 다룹니다. 계기는 **2026-08-12**입니다. 그날 EKS가 kube-scheduler·kube-apiserver·kube-controller-manager의 파라미터 4종을 처음으로 고객 설정 대상으로 열었습니다. "관리형이라 손댈 수 없다"는 오래된 전제에 금이 갔습니다. 그 금이 어디까지 갔는지가 이 섹션의 주제입니다 — 열린 것은 파라미터 4개이고 그 옆자리는 그대로 닫혀 있습니다.

{{< callout type="info" >}}
- **finance 판정: create 시점에는 컴포넌트 파라미터 4개를 전부 기본값으로 둡니다.** 실제 후보는 `MostAllocated` 하나이고 blue 안정화 이후 별건입니다. Provisioned Control Plane은 해당 없습니다 `✓`
- **`upgradePolicy.supportType` 기본값이 `EXTENDED`입니다** — 명시하지 않으면 표준지원 종료일부터 시간당 $0.60(표준 $0.10 + $0.50)이 자동으로 붙고 확장지원에 실제로 진입한 뒤에는 STANDARD로 되돌릴 수 없습니다. blue를 만드는 Terraform에서 반드시 명시해야 하는 한 줄 `✓`
- **2026-08-12에 열린 것은 4개뿐입니다.** `kubeApiServerConfig`의 하위 필드는 `eventTtl`·`serviceNodePortRange` **둘**입니다 — "이제 apiserver 플래그를 만질 수 있다"는 서술은 이 숫자 하나가 반박합니다 `✓`
- **Provisioned Control Plane은 신규 기능이 아닙니다** — 2025-11-21 GA된 9개월 된 기능이고 8월 발표에서 전제조건으로 언급됐을 뿐입니다. Standard 복귀를 막는 조건이 **둘인데 서로 다른 문서에 하나씩만** 있어 한 문서만 읽으면 절반을 놓칩니다 `✓`
- **AWS 문서와 실제 도구 지원이 어긋납니다.** User Guide는 Terraform을 "coming soon"이라 쓰지만 provider v6.59.0(발표 당일)에 이미 들어왔고 eksctl·CDK는 거꾸로 과대 서술입니다 `✓`
{{< /callout >}}

## 3레이어 지도

컨트롤 플레인 설정은 성격이 다른 세 층으로 나뉩니다. 층을 섞어 읽으면 "무엇을 언제 정할 수 있는가"가 흐려지므로 페이지도 층 단위로 나눴습니다.

| 레이어 | 무엇을 정하는가 | 대표 파라미터 | 페이지 |
|---|---|---|---|
| **레이어 1** | 클러스터라는 리소스 자체의 속성 | `upgradePolicy`·`resourcesVpcConfig`·`encryptionConfig`·`accessConfig`·`deletionProtection`·`version` | [레이어 1]({{< relref "01-cluster-parameters.md" >}}) |
| **레이어 2** | 컨트롤 플레인 **컴포넌트의 동작** | `kubeSchedulerConfig`·`kubeApiServerConfig`·`kubeControllerManagerConfig` | [레이어 2]({{< relref "02-component-parameters.md" >}}) |
| *용량 축* | 컨트롤 플레인을 **얼마나 크게 사는가** | `controlPlaneScalingConfig.tier` | [용량 축]({{< relref "03-provisioned-control-plane.md" >}}) |
| **레이어 3** | 위 어디에도 없는 것 — 손댈 수 없는 영역 | `--max-requests-inflight`·`--audit-policy-file`·`--feature-gates`·etcd 전 구간 | [레이어 3]({{< relref "04-not-tunable.md" >}}) |

용량 축을 레이어로 세지 않은 것은 이 축이 직교하기 때문입니다. 값을 정하는 문제가 아니라 크기를 사는 문제입니다. 레이어 2의 HPA `syncPeriod` 하나가 이 축을 **전제조건으로** 요구해서 의존이 한 방향으로 걸립니다.

## 색인

- **[레이어 1 — 클러스터 파라미터와 가변성 3분류]({{< relref "01-cluster-parameters.md" >}})** · 최상위 29개를 **create-only 8 · 단방향 불가역 6 · day-2 가변 15**로 나누는 마스터 표. Terraform ForceNew 판정, `Update.type` 21종, `upgradePolicy.supportType`의 EXTENDED 기본값 함정, 2026-07에 생긴 버전 롤백(7일 창)과 `--force`의 실제 범위.
- **[레이어 2 — 2026-08 열린 4종과 karpenter 가중치]({{< relref "02-component-parameters.md" >}})** · `nodeResourcesFit.scoringStrategy`·`eventTtl`·`serviceNodePortRange`·HPA `syncPeriod` 심층. 업스트림 점수 공식, cpu/memory 가중치를 노드 비율에 맞출 수 있는지의 판정, karpenter가 이 설정을 읽지 않는다는 코드 근거, 도구별 지원 현황의 어긋남.
- **[용량 축 — Provisioned Control Plane 티어와 복귀 제약]({{< relref "03-provisioned-control-plane.md" >}})** · 티어 표 두 구간, 8XL의 비대칭(스케줄링 처리율은 4XL에서 포화), 요금이 기본요금에 더해진다는 계산, Standard 복귀를 막는 두 조건.
- **[레이어 3 — 닫힌 영역과 클러스터 내부 우회]({{< relref "04-not-tunable.md" >}})** · 닫힌 플래그를 `path:line`으로 열거하고 우회 창구 3개(APF·어드미션·자체 스케줄러)를 짝지웁니다. 대안이 없는 항목은 없다고 적습니다.

네 페이지는 층마다 같은 질문을 반복합니다 — **언제 정할 수 있나 → 정한 뒤 되돌릴 수 있나 → 되돌릴 수 없으면 무엇을 미리 결정해야 하나**. 사실 기준 시점은 **2026-08-14**이고 근거는 AWS 1차 문서(User Guide·API Reference·Best Practices·요금 페이지)와 로컬 업스트림 클론입니다. 업스트림 인용의 체크아웃 시점은 각 페이지가 개별로 밝힙니다.

## 자매 문서

- [클러스터 설정]({{< relref "../02-cluster-config.md" >}}) — 클러스터 껍데기·Fargate 토폴로지·Terraform 리소스. 레이어 1의 파라미터가 실제로 들어가는 곳입니다.
- [managed addon]({{< relref "../03-managed-addons.md" >}}) — vpc-cni·kube-proxy·coredns·ebs-csi의 설정. **애드온 config는 컨트롤 플레인 파라미터가 아닙니다** — 혼동하기 쉬운 경계라 소유를 나눠 뒀습니다.
- [목표 버전]({{< relref "../01-target-version.md" >}}) — 1.35 판정과 EOL 캘린더. 레이어 2의 하한이 1.31이라 blue가 4종을 전부 쓸 수 있다는 판정의 근거이고 `supportType` 함정이 걸리는 확장지원 종료일도 여기 있습니다.
- [컷오버·롤백]({{< relref "../05-cutover-rollback.md" >}}) — ALB 가중치 전환 기반 롤백 계약. 레이어 1의 버전 롤백(2026-07 신규)이 이 계약과 어떻게 겹치는지 함께 읽어야 합니다.
