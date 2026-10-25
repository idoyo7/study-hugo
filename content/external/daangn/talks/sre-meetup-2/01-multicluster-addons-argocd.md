---
title: "ApplicationSet으로 여러 EKS 클러스터에 애드온 배포하기"
description: "운영 클러스터 1개와 서비스 클러스터 2개를 사용한 당근의 2021년 시연입니다. 클러스터별 설정 파일로 애드온을 배포하고 관측·트래픽 경로를 연결하는 방법을 요약합니다."
date: 2026-10-21
weight: 1
---

# ApplicationSet으로 여러 EKS 클러스터에 애드온 배포하기 (SRE 밋업 2회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [쿠버네티스 멀티 클러스터에서 Addons를 관리하는 방법 | 당근마켓 SRE 밋업 2회](https://www.youtube.com/watch?v=tqyj1klizCU) (18:00)
- 매체 · 게시일: YouTube 당근 채널 · 2021-12-02
- 발표자: 유정열 (당근마켓 SRE 팀 클러스터 파트). 영상 설명란과 슬라이드 표지로 확인했습니다. 슬라이드 표지에는 AWS Hero라고도 적혀 있습니다.
- 근거: YouTube 자동 자막 전체 + 발표 슬라이드. 2021년 영상의 자막은 인식 오류가 많아 슬라이드를 우선했습니다.
- 발표 영상의 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 서비스 운영에 필요한 애드온을 함께 준비하기 {#클러스터마다-반복되는-addons-설치}

새 EKS 클러스터에는 CoreDNS와 kube-proxy 같은 기본 구성만 있어 서비스 운영에 필요한 도구를 추가해야 합니다. 클러스터가 늘어날 때마다 같은 설치를 반복하는 문제를 다룬 발표입니다.

슬라이드에는 cluster-autoscaler, external-dns, aws-ebs-csi-driver, aws-load-balancer-controller, kubernetes-external-secrets와 Prometheus, Grafana, Loki, Istio, Kubernetes Dashboard가 등장합니다. 발표자는 이 애드온들을 여러 클러스터에 일관되게 배포하는 과정을 시연용 구성으로 설명합니다.

## 클러스터 설정 파일에서 Application 생성하기 {#applicationset으로-여러-클러스터에-배포하기}

시연에서는 Terraform이 AWS 리소스를 만들고 Argo CD가 서비스와 애드온을 배포합니다. 운영(OPS) EKS 클러스터 1개와 서비스(SVC) 클러스터 2개를 준비했습니다. Application 하나는 한 클러스터를 대상으로 하므로 ApplicationSet으로 클러스터별 Application을 생성합니다.

Helm으로 Argo CD를 설치하고 external-dns로 Route 53 레코드를 만든 뒤, `argocd cluster add`로 서비스 클러스터를 등록합니다. ApplicationSet의 generator는 저장소의 클러스터별 YAML을 읽습니다. 이 파일에는 계정 ID, 도메인, 인증서 ARN, 타깃 그룹 ARN 같은 환경별 값도 들어 있습니다.

운영 클러스터에는 Argo CD·Grafana·Loki를, 각 서비스 클러스터에는 Prometheus를 배치합니다. Grafana가 서비스 클러스터의 메트릭을 조회하고, 각 클러스터의 Promtail은 운영 클러스터의 Loki로 로그를 전송합니다. AWS SSM Parameter Store의 시크릿은 kubernetes-external-secrets가 Kubernetes Secret으로 만듭니다.

Route 53 도메인마다 퍼블릭·내부 ALB를 둡니다. 기본 도메인은 서비스 클러스터 두 곳에 50%씩, 클러스터 전용 도메인은 해당 클러스터에 트래픽을 보냅니다. ALB 뒤에는 Istio ingress gateway가 있으며, aws-load-balancer-controller의 TargetGroupBinding으로 게이트웨이 Pod IP의 변경을 타깃 그룹에 반영합니다.

## 설치부터 Grafana·Loki 조회까지의 시연 {#데모에서-보여-준-결과}

슬라이드는 Argo CD 설치, 클러스터 등록, ApplicationSet 생성, 애드온 배포에 이어 Grafana 대시보드와 Loki 조회 화면을 보여 줍니다. 샘플 앱에서는 새로 고칠 때 두 클러스터 이름이 번갈아 나오는 모습으로 트래픽 분배를 설명합니다.

운영 효과를 비교한 수치는 제시하지 않았습니다. 영상에는 준비된 화면을 설명하며, 라이브 데모는 발표 후 별도 공간에서 진행한다고 안내했습니다.

## 2021년 시연으로 확인할 수 있는 범위 {#시연-구성과-실제-운영의-구분}

도메인·클러스터 이름·저장소는 시연용입니다. 당근의 실제 운영 구성도 같다는 설명은 없습니다. ApplicationSet과 kubernetes-external-secrets 등 당시 도구를 사용한 사례이므로 현재 권장 구성을 판단하는 자료로 그대로 적용하기는 어렵습니다. 영상은 팀 채용 안내로 끝납니다.

## 주요 구간

- [00:00](https://www.youtube.com/watch?v=tqyj1klizCU&t=0s) 밋업 소개와 발표자 소개
- [01:00](https://www.youtube.com/watch?v=tqyj1klizCU&t=60s) 새 클러스터에 필요한 Addons
- [02:00](https://www.youtube.com/watch?v=tqyj1klizCU&t=120s) Argo CD와 ApplicationSet, 데모 구성
- [06:00](https://www.youtube.com/watch?v=tqyj1klizCU&t=360s) Addons 구성: Prometheus, Loki, Istio 등
- [09:00](https://www.youtube.com/watch?v=tqyj1klizCU&t=540s) Argo CD 설치와 클러스터 등록
- [12:00](https://www.youtube.com/watch?v=tqyj1klizCU&t=720s) ApplicationSet으로 Addons 배포, TargetGroupBinding

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
