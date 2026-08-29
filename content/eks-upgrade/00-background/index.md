---
title: "배경 — 왜 CAPI in-place를 버리고 blue-green인가"
date: 2026-08-01
weight: 1
---

# 배경 — 왜 CAPI in-place를 버리고 blue-green인가

finance EKS 클러스터는 원래 CAPI GitOps로 관리하도록 설계돼 있었습니다. 그런데 조사 시점(2026-07)에 그 설계는 이미 반쯤 무너져 있었습니다. 최초 계획은 CAPI GitOps in-place 업그레이드였지만, 조사 과정에서 진단이 두 번 뒤집힌 끝에 **신규 blue 클러스터를 Terraform으로 생성하는 blue-green**으로 방향이 굳었습니다. [랜딩]({{< relref "_index.md" >}})이 요약한 이 전환의 근거를 아래 네 포인트로 풀어냅니다.

{{< callout type="info" >}}
- 원래는 허브(ring0-blue)의 CAPA가 크로스계정으로 워크로드 클러스터를 reconcile하고, 버전 SSOT는 CAPI 스펙(`clusterapi.yaml`의 `k8sVersion`)이었습니다.
- 그러나 **CAPA는 2025-10-21부터 죽어 있었다** — 워크로드 계정의 크로스계정 롤이 삭제돼 `AssumeRole`이 실패하고 있었습니다.
- 롤을 되살려도 CAPA v2.6.1은 addon의 **config-only 변경을 반영하지 않아**(공개 이슈 #4226) addon SSOT로 부적합했습니다.
- 어차피 카펜터 포함 전 컴포넌트를 대점프해야 하므로 in-place 대신 **신규 blue를 Terraform으로** 짓습니다.
{{< /callout >}}

## 기존 구조 — 허브-스포크 GitOps + CAPI

finance EKS는 관리(hub) 클러스터 1개와 워크로드(spoke) 클러스터 2개로 이뤄진 허브-스포크 구조입니다. 허브인 **ring0-blue**에는 ArgoCD와 CAPA(Cluster API Provider AWS) 컨트롤러가 함께 돕니다. ArgoCD의 `ApplicationSet`이 CAPI 커스텀 리소스를 만들면 CAPA가 그 스펙을 워크로드 계정의 EKS 클러스터로 reconcile합니다. 세 클러스터는 각각 별도 AWS 계정(관리·stage·prod)에 놓여 있고 이 3계정 분리가 아키텍처의 보안 경계입니다.

{{< flow src="_flow/기존-구조-허브-스포크.json" />}}

버전 변경의 "정상 경로"는 언제나 **ring0의 YAML 수정 → ArgoCD sync → CAPA가 AssumeRole해 워크로드 계정에 반영**이라는 크로스계정 경로를 지나게 돼 있었습니다. 클러스터 버전의 SSOT는 CAPI 스펙이었습니다. ArgoCD 3-tier 부트스트랩 체인과 3레포 구조의 상세는 [부트스트랩]({{< relref "04-cluster-bootstrap.md" >}})이 이어받습니다.

## 문제 — CAPA가 2025-10-21부터 죽어 있었다

`clusterapi.yaml`의 `k8sVersion`을 bump해 in-place 업그레이드를 시작하려던 시점에 실측 진단에서 **CAPA가 이미 죽어 있다**는 사실이 드러났습니다. CAPA가 워크로드 계정을 조작하려면 각 계정에 크로스계정 신뢰 관계가 걸린 IAM 롤(`controllers.cluster-api-provider-aws.sigs.k8s.io`, clusterawsadm 표준 롤명)이 있어야 합니다. 그런데 stage·prod 양쪽 모두 이 롤이 삭제돼 있었습니다(`iam get-role` → `NoSuchEntity`). 증상도 그대로였습니다 — CAPA 컨트롤러 로그에는 `sts:AssumeRole AccessDenied`가 반복됐고 Cluster 리소스의 condition은 양쪽 다 `Ready=False (VpcReconciliationFailed)`였으며 마지막 전환 시각은 **2025-10-21**에 멈춰 있었습니다.

롤이 사라진 경위는 코드로 추적되지 않았습니다. IaC로 관리된 적이 없는 롤이라(clusterawsadm이 최초 생성한 CloudFormation 산물이라 레포에 흔적이 없다) 코드 이력만으로는 언제 어떻게 사라졌는지 알 수 없었습니다. 그래서 진단은 한동안 "복구 불가능한 장애"와 "복구 가능한 장애" 사이를 오갔습니다. 결론은 후자였습니다. 롤을 재생성하자 reconcile 자체는 정상 재개됐습니다 — **CAPA 사망은 복구 가능한 장애였습니다.** "CAPA가 고장 나서 blue-green으로 갔다"는 단순화는 틀렸고, 진짜 문제는 그다음 단계에서 드러났습니다.

## 구조적 결함 — config는 CAPA를 못 넘는다

reconcile이 되살아난 뒤에도 남는 문제가 있었습니다. CAPA v2.6.1의 addon 비교 로직(`EKSAddon.IsEqual()`)은 **버전 문자열·SA 롤 ARN·태그만 비교**하고 **`Configuration`(addon 세부 설정값)은 비교하지 않습니다**(공개 이슈 #4226). addon 버전을 그대로 둔 채 설정값만 바꾼 변경은 CAPA가 절대 반영하지 않습니다 — `clusterapi.yaml`을 아무리 고쳐도 UpdateAddon 호출 자체가 나가지 않습니다.

여기에 "Synced 착시"가 겹칩니다. `clusterapi` ApplicationSet은 ring0 in-cluster의 CAPI 커스텀 리소스만 갱신하고 실제 EKS 반영은 CAPA의 크로스계정 호출에 위임돼 있습니다. 롤이 죽어 있던 기간에도 ArgoCD 화면에는 **Synced로 보였지만 실제 클러스터에는 아무 변경도 가지 않았습니다.**

두 함정을 합치면 **CAPA v2.6.1은 addon 설정의 SSOT로 쓰기에 구조적으로 부적합합니다.** 클러스터 버전 자체는 CAPA가 문제없이 처리합니다. 버전과 함께 계속 바뀌어야 하는 addon 세부 설정까지 맡기면 "config-only 무시"와 "Synced 착시"가 상시 운영 리스크로 남습니다.

## 결정 — 신규 blue를 Terraform으로

CAPI 복구는 "해결"이 아니라 "새로운 종류의 리스크로 갈아탄 것"이었습니다. 롤은 되살아났지만 addon config 변경마다 수동 개입과 git-라이브 동기화 확인이 필요하다는 운영 부담은 그대로 남았습니다. 여기에 별개의 사정이 하나 더 끼어들었습니다. 카펜터 컨트롤러(0.36.2)가 EKS 1.33+에서 더는 공식 지원되지 않습니다. 이번 업그레이드는 어차피 카펜터를 포함해 거의 모든 컴포넌트를 큰 폭으로 올려야 하는 대규모 마이그레이션이 될 참이었습니다.

**어차피 전 컴포넌트를 대점프해야 한다면, green을 in-place로 조금씩 고치는 대신 신규 blue 클러스터를 깨끗하게 짓는 편이 낫습니다.** 그 클러스터는 CAPA가 아니라 **Terraform으로 생성**해 addon config SSOT 문제를 CAPA 밖으로 완전히 들어냅니다. 목표 버전 판정은 [01 목표버전]({{< relref "01-target-version.md" >}}), Fargate+karpenter 토폴로지와 Terraform 리소스는 [02 클러스터 설정]({{< relref "02-cluster-config.md" >}}), 부트스트랩 순서는 [04 부트스트랩]({{< relref "04-cluster-bootstrap.md" >}})이 이어받습니다.
