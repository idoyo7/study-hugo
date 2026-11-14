---
title: "베어메탈 MLOps 플랫폼을 위한 EKS Anywhere 구축"
description: "우아한형제들 데이터플랫폼팀이 AWS 이관 뒤 남은 온프레미스 Hadoop 인프라를 EKS Anywhere 기반 MLOps 플랫폼으로 바꾼 과정을 정리했습니다. 구조와 설치 방법, 베어메탈에서 겪은 문제와 해결을 다룹니다."
date: 2026-11-14
weight: 4
---

# 베어메탈 MLOps 플랫폼을 위한 EKS Anywhere 구축 (2023-01)

{{< callout type="info" >}}
**원문 정보**
- 원문: [EKS Anywhere 구축기](https://techblog.woowahan.com/10221/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2023-01-19
- 저자: 신승엽 (데이터플랫폼팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 도입 배경 {#background}

2022년에 데이터플랫폼팀은 AWS 이관으로 쓸모가 줄어든 온프레미스 Hadoop 클러스터 인프라를 정비해 MLOps 플랫폼으로 바꾸는 프로젝트를 했습니다. 2021년 우아콘에서 발표한 AWS 이관기 이후 IDC의 Hadoop 장비를 다른 용도로 쓸 방법을 찾던 중이었습니다. 마침 허위 리뷰 방지와 가게 추천 모델링 같은 GPU 기반 머신러닝·딥러닝 수요가 늘고 있었습니다. 온프레미스 GPU 인프라는 부족했고 AWS GPU 인스턴스도 품귀로 할당받기 어려웠습니다.

그래서 기존 온프레미스 인프라를 재활용해 Kubernetes 클러스터를 만들고 유연하고 확장 가능한 분석 환경과 GPU 인프라를 제공하기로 했습니다. 배포판은 세 가지 이유로 AWS의 EKS Anywhere(EKS-A)를 골랐습니다.

- 전사 Data Lake가 있는 AWS 환경과의 연계성
- 전사 MLOps 기반 플랫폼인 EKS와 비슷한 사용자 경험
- Kubernetes 클러스터를 유지보수하기 쉬운 점

## EKS-A와 EKS-D {#eksa-eksd}

EKS-A는 AWS의 관리형 서비스 EKS를 고객 인프라에 직접 설치해 쓸 수 있게 한 제품입니다. 온프레미스에서 클러스터의 생성, 확장, 삭제 같은 라이프사이클을 관리하는 오픈소스 Ops Tool과 EKS의 배포판 EKS Distro로 이루어집니다. 2021년 9월에 VMware vSphere 전용으로 처음 나왔고, 1년이 채 되기 전인 2022년 6월에 베어메탈 버전이 나왔습니다. EKS-D는 2020년 12월 공개된 오픈소스로, EKS가 쓰는 배포판을 온프레미스(BM, VM)에 `kubeadm`이나 `kops`로 설치할 수 있게 한 것이며 원문 작성 시점의 최신은 v1.24였습니다.

EKS와 가장 큰 차이는 Kubernetes 클러스터를 AWS가 관리하느냐 고객이 관리하느냐입니다. EKS-A는 설치와 사용이 무료이고 기술 지원은 유료 구독이 필요합니다. 원문 표에 따르면 EKS-A는 Control plane이 고객 IDC에 있고, 컴퓨트로 vSphere와 베어메탈, OS로 Bottlerocket과 Ubuntu를 지원하며, Fargate 같은 서버리스는 지원하지 않습니다. 네트워킹은 Cilium, 로드 밸런서는 MetalLB(선택)입니다.

## 구조와 설치 {#architecture}

설치에는 세 종류의 노드가 필요합니다. `eksctl`을 실행하는 Bootstrap(admin) 노드, etcd와 API 서버 같은 시스템 컴포넌트가 올라가는 Control Plane 노드, 워크로드가 올라가는 Data Plane 노드입니다.

Bootstrap 노드의 `eksctl`에 `anywhere` 플러그인을 더해 클러스터를 배포하고 늘리고 지웁니다. 베어메탈에서는 Equinix가 만든 프로비저닝 자동화 오픈소스 Tinkerbell을 씁니다. 배포를 시작하면 kind로 Bootstrap 노드에 임시 로컬 Kubernetes가 만들어지고, 여기에 Tinkerbell 컴포넌트가 Pod로 떠서 대상 노드에 EKS-D와 EKS-A를 설치합니다.

- Boots: DHCP 서버이자 설치 이미지를 주는 TFTP 서버입니다. PXE 부팅한 노드에 IP와 iPXE 스크립트를 주면 노드가 Hook OS(Linux Kit)를 메모리에 받아 부팅하고, 이어서 Bottlerocket 또는 Ubuntu와 EKS-A 컴포넌트를 설치합니다. DHCP는 2계층을 써야 해서 다른 컴포넌트와 달리 단독 컨테이너로 실행됩니다.
- Hegel: 프로비저닝할 하드웨어 스펙을 가진 메타데이터 저장소로, EC2 메타데이터와 비슷한 형식으로 조회합니다.
- Rufio: BMC로 머신의 시작·종료와 부트 순서를 제어합니다.
- Tink: Tink Server, Controller, Worker로 구성됩니다. Worker는 HookOS 안에서 도는 에이전트로, 노드의 MAC 주소를 보내 워크플로를 받아 하나씩 실행하고 결과를 보고합니다.

설치가 끝나면 Tinkerbell 서비스는 새 클러스터로 옮겨져 Pod로 실행되고, Bootstrap 노드의 로컬 Kubernetes와 거기 있던 서비스는 삭제됩니다.

사용자가 할 일은 설정 파일 둘과 명령 하나입니다. 하드웨어 정보를 담은 CSV(호스트명, BMC 정보, MAC, IP, 디스크 등)와 클러스터 Manifest YAML(CNI, Pod·Service CIDR, 컨트롤 플레인 수, OS 등)을 쓰고 `eksctl anywhere create cluster --hardware-csv hardware.csv -f eksa-mgmt-cluster.yaml`을 실행합니다. 생성 뒤에는 kube-system에 Kubernetes 필수 컴포넌트가, eksa-system에 EKS-A 컴포넌트와 Tinkerbell이 올라온 것을 확인합니다. 노드를 늘릴 때도 새 노드의 CSV를 쓰고 `eksctl anywhere generate hardware`의 출력을 `kubectl apply`하면 같은 방식으로 프로비저닝됩니다.

## 베어메탈에서 겪은 한계 {#limits}

원문은 EKS-A가 완벽해 보이지만 베어메탈에서 많은 문제를 만났다고 합니다. 가장 큰 것은 Manifest로 최초 배포 때 자동화할 수 있는 구성이 vSphere보다 훨씬 적다는 점이었습니다. 공식 문서에서 베어메탈은 네트워크 플러그인(CNI)만 지원한다고 되어 있고(v0.11.0부터 IAM Authenticator도 지원), 문서에 없어도 일부는 Manifest나 배포 후 수동으로 설정할 수 있었습니다. 관리 기능에서도 etcd 백업·복원, 클러스터 업그레이드, GitOps 관리, Terraform 관리가 아직 베어메탈에서 지원되지 않았고, 수동 작업으로 되는 것도 있었다고 합니다.

## 직접 해결한 문제 {#problems}

AWS IAM Authenticator. v0.10.0에서는 Manifest에 옵션을 넣어도 동작하지 않았고, EKS-A의 GitHub 이슈에도 같은 스레드가 있었습니다. 원인은 Kube API 서버 Pod에 인증서가 배포되지 않은 점과 API 서버 Pod Manifest에 필요한 설정이 빠진 점이었습니다. `aws-iam-authenticator` CLI로 인증서를 만들어 API 서버 Pod가 마운트하는 호스트 디렉터리에 복사하고, API 서버 Manifest에 `--authentication-token-webhook-config-file` 옵션을 더했으며, `aws-auth` ConfigMap에 계정별 권한을 적었습니다. v0.11.0부터는 이 이슈가 고쳐졌습니다.

IAM for Pod(IRSA). Access/Secret Key는 처음 발급 때만 볼 수 있어 분실 위험이 있고 유출되면 권한을 모두 뺏길 수 있는데, IRSA를 쓰면 키 없이 IAM 권한을 쓸 수 있습니다. S3에 접근하는 워크로드가 많은 곳에 유용하다고 합니다. 이 기능도 Manifest 설정만으로는 API 서버 설정과 `amazon-eks-pod-identity-webhook` Pod가 배포되지 않았습니다. 그래서 다음을 수작업으로 했습니다.

- 키 생성기로 OIDC Provider에 줄 공개키를 발급
- S3와 CloudFront로 Service Issuer를 만들고 이를 이용해 AWS IAM의 OIDC Provider를 구축, `sts.amazonaws.com`을 Audience로 추가하고 OIDC Provider와 IAM Role 사이에 신뢰 관계 설정
- API 서버 Manifest에 `--api-audiences`와 `--service-account-issuer` 추가
- `amazon-eks-pod-identity-webhook`을 빌드해 클러스터에 배포

이후에는 Service Account에 IAM Role ARN annotation을 달면 해당 Pod가 권한을 얻습니다.

Ubuntu 이미지. v0.11.0부터 EKS-A용 Ubuntu 이미지를 더 이상 제공하지 않아, Amazon의 `image-builder`로 직접 빌드하고 이미지 저장소를 만들어야 했습니다. 가이드가 상세해 따라 할 수 있었지만 KVM을 지원하는 베어메탈 서버에서만 빌드가 됩니다. Apache 웹서버로 이미지를 HTTP로 내려받게 하고 Manifest의 `osImageURL`에 경로를 적었습니다.

기술 지원 구독이 없는데도 GitHub 이슈 게시판의 버그 제보와 설치 문의에 빠르게 대응해 줘서 도움이 됐다고 합니다.

## 평가 {#assessment}

팀은 이미 AWS에서 EKS를 운영해 EKS 기반인 EKS-A의 설치·운영 편의에 기대가 컸지만, 출시된 지 얼마 안 됐고 버전이 v0.x.x라 기대만큼의 만족은 아니었다고 정리합니다. 한 번의 CLI로 Kubernetes 버전을 올리는 기능이 베어메탈에 없는 점이 특히 아쉬웠습니다. 반면 AWS와 연동하는 기능, 간단한 설치, Tinkerbell로 OS 설치부터 모두 자동화된 점은 인상 깊었고, vSphere의 기능이 베어메탈에도 빨리 추가되기를 기대한다고 맺습니다.

{{% details title="EKS-A와 EKS의 주요 차이, 버전 정보" closed="true" %}}

| 항목 | EKS-A | EKS |
|---|---|---|
| Control plane 관리·위치 | 고객, 고객의 IDC | AWS, AWS 클라우드 |
| 컴퓨트 옵션 | VMware vSphere, 베어메탈 | Amazon EC2, Fargate |
| 지원 OS | Bottlerocket, Ubuntu | Amazon Linux 2, Windows Server, Bottlerocket, Ubuntu |
| 네트워킹 | Cilium | Amazon VPC CNI |
| 가격 | 설치·사용 무료, 기술 지원은 구독형 | 시간 단위 클러스터 이용료 |
| 첫 릴리스 | vSphere 2021-09, 베어메탈 2022-06 | 해당 없음 |
| 이슈가 있던 버전 | v0.10.0 (IAM Authenticator Manifest 미동작), v0.11.0부터 수정 및 Ubuntu 이미지 미제공 | 해당 없음 |

{{% /details %}}
