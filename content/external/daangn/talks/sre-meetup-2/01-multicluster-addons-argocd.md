---
title: "쿠버네티스 멀티 클러스터에서 Addons를 관리하는 방법"
description: "당근 SRE 밋업 2회에서 클러스터 파트 유정열이 발표한 멀티 클러스터 Addons 관리 요약입니다. 새 EKS 클러스터마다 필요한 Addons를 Argo CD ApplicationSet으로 한꺼번에 배포하는 구성을 데모 환경으로 보여 줍니다."
date: 2026-10-21
weight: 1
---

# 쿠버네티스 멀티 클러스터에서 Addons를 관리하는 방법 (SRE 밋업 2회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [쿠버네티스 멀티 클러스터에서 Addons를 관리하는 방법 | 당근마켓 SRE 밋업 2회](https://www.youtube.com/watch?v=tqyj1klizCU) (18:00)
- 매체 · 게시일: YouTube 당근 채널 · 2021-12-02
- 발표자: 유정열 (당근마켓 SRE 팀 클러스터 파트). 영상 설명란과 슬라이드 표지로 확인했습니다. 슬라이드 표지에는 AWS Hero라고도 적혀 있습니다.
- 근거: YouTube 자동 자막 전체 + 발표 슬라이드. 2021년 영상의 자막은 인식 오류가 많아 슬라이드를 우선했습니다.
- 이 문서는 영상을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## 주요 구간

- [00:00](https://www.youtube.com/watch?v=tqyj1klizCU&t=0s) 밋업 소개와 발표자 소개
- [01:00](https://www.youtube.com/watch?v=tqyj1klizCU&t=60s) 새 클러스터에 필요한 Addons
- [02:00](https://www.youtube.com/watch?v=tqyj1klizCU&t=120s) Argo CD와 ApplicationSet, 데모 구성
- [06:00](https://www.youtube.com/watch?v=tqyj1klizCU&t=360s) Addons 구성: Prometheus, Loki, Istio 등
- [09:00](https://www.youtube.com/watch?v=tqyj1klizCU&t=540s) Argo CD 설치와 클러스터 등록
- [12:00](https://www.youtube.com/watch?v=tqyj1klizCU&t=720s) ApplicationSet으로 Addons 배포, TargetGroupBinding

## 클러스터마다 반복되는 Addons 설치

이 발표는 클러스터가 늘어날 때마다 필요한 Addons를 같은 방식으로 설치하고 관리하는 문제를 다룹니다. 새 EKS 클러스터에는 CoreDNS, kube-proxy 같은 기본 파드만 올라오므로, 발표자는 서비스를 운영하려면 Addons를 더 설치해야 한다고 설명합니다. 슬라이드에는 cluster-autoscaler, external-dns, aws-ebs-csi-driver, aws-load-balancer-controller, kubernetes-external-secrets, Prometheus, Grafana, Loki, Istio, Kubernetes Dashboard가 나옵니다.

## ApplicationSet으로 여러 클러스터에 배포하기

발표자는 AWS 리소스를 Terraform으로 만들고, 서비스와 Addons는 Argo CD로 배포합니다. Argo CD Application의 배포 대상은 클러스터 하나입니다. 여러 클러스터에 같은 서비스를 배포하는 데는 ApplicationSet을 사용했습니다. 데모에는 운영(OPS) EKS 클러스터 1개와 서비스(SVC) EKS 클러스터 2개를 둡니다.

설치는 Helm으로 Argo CD를 올리는 데서 시작합니다. external-dns로 Route 53 레코드를 만들고, `argocd cluster add`로 서비스 클러스터를 등록한 뒤 ApplicationSet을 만듭니다. ApplicationSet의 generator는 저장소의 클러스터 설정 파일(cluster별 YAML)에서 클러스터 목록을 읽어 각 클러스터에 같은 Addons 애플리케이션을 배포합니다. 계정 ID, 도메인, 인증서 ARN, 타깃 그룹 ARN 등 클러스터별 값도 이 파일에 둡니다.

운영 클러스터에는 Argo CD, Grafana, Loki를, 서비스 클러스터에는 각각 Prometheus를 배치합니다. 각 Prometheus가 모은 메트릭은 운영 클러스터의 Grafana가 조회하고, 클러스터마다 Promtail이 운영 클러스터의 Loki로 로그를 보냅니다. 시크릿은 AWS SSM Parameter Store에 저장하고 kubernetes-external-secrets로 Secret으로 바꿉니다.

Route 53 도메인마다 퍼블릭 ALB와 내부 ALB를 둡니다. 기본 도메인의 트래픽은 서비스 클러스터 두 곳에 50%씩 나누고, 클러스터 전용 도메인의 트래픽은 해당 클러스터로 보냅니다. ALB는 Istio ingress gateway로 이어집니다. aws-load-balancer-controller의 TargetGroupBinding이 ALB 대상 그룹과 게이트웨이 파드를 연결하며, 파드 IP가 바뀌어도 대상 그룹의 IP를 계속 갱신합니다.

## 데모에서 보여 준 결과

슬라이드는 Argo CD 설치부터 클러스터 등록, ApplicationSet 등록, Addons 배포를 거쳐 Grafana 대시보드와 Loki 조회까지 보여 줍니다. 샘플 앱을 배포한 뒤 도메인을 새로 고칠 때마다 두 클러스터 이름이 번갈아 나오는 모습으로 50% 분배를 설명합니다.

발표는 데모 중심이며 성과 수치는 제시하지 않습니다. 라이브 데모는 영상에서 진행하지 않고, 발표가 끝난 뒤 별도 공간에서 진행한다고 안내합니다.

## 시연 구성과 실제 운영의 구분

도메인, 클러스터 이름, 저장소는 모두 시연용 예시이며, 당근의 실제 운영 구성도 이와 같다는 설명은 영상에 없습니다. 2021년 발표는 Argo CD ApplicationSet, kubernetes-external-secrets 같은 당시 도구를 전제로 합니다. 지금도 같은 구성이 권장되는지는 이 발표만으로 알 수 없습니다. 영상 마지막에는 팀 채용 안내가 나옵니다.

{{% details title="근거와 세부 수치" closed="true" %}}

| 항목 | 내용 | 근거 |
|---|---|---|
| 데모 클러스터 | 운영 EKS 1개, 서비스 EKS 2개 | 슬라이드 |
| 노드 구성 | 워커 노드 세 대(모니터링 1, 기본 2) | 자막 기준 |
| 트래픽 분배 | 기본 도메인은 서비스 클러스터 두 곳에 50%씩 | 슬라이드 |
| Argo CD 배포 도구 | Argo CD Application은 단일 클러스터, ApplicationSet은 멀티 클러스터 | 슬라이드 |
| Addons 목록 | argo-rollouts, aws-ebs-csi-driver(GP3), aws-load-balancer-controller(TargetGroupBinding), cluster-autoscaler, kubernetes-external-secrets(SSM에서 Secret으로) 외 | 슬라이드 |
| Argo CD 인증 | GitHub OAuth Apps | 슬라이드 |
| 코드 저장소 | Argo CD 설정과 Terraform 예제를 각각 별도 공개 저장소로 안내 | 슬라이드 |

영상 설명란의 녹화일은 2021년 1월 17일로, 게시일인 2021-12-02와 어긋납니다. 이 문서에는 게시일만 썼습니다. 발표자 이름은 이 영상 설명란에 유정열, 1회 영상 설명란에 유정렬로 적혀 있습니다. 이 문서는 슬라이드 표기를 따랐습니다.

{{% /details %}}
