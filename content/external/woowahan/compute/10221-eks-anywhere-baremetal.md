---
title: "남은 Hadoop 장비에서 시작한 EKS Anywhere 구축기"
description: "EKS Anywhere는 베어메탈 MLOps 플랫폼 구축을 어디까지 자동화해 줄까요? 우아한형제들 데이터플랫폼팀은 OS부터 클러스터까지 설치를 자동화했지만, AWS 인증 설정과 Ubuntu 이미지는 직접 준비해야 했습니다."
date: 2026-11-14
weight: 4
---

# 남은 Hadoop 장비에서 시작한 EKS Anywhere 구축기 (2023-01)

{{< callout type="info" >}}
**원문 정보**
- 원문: [EKS Anywhere 구축기](https://techblog.woowahan.com/10221/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2023-01-19
- 저자: 신승엽 (데이터플랫폼팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## GPU 수요가 늘던 시기에 남은 Hadoop 장비 {#background}

GPU가 필요한 일은 늘고 있었습니다. 허위 리뷰 방지와 가게 추천 모델링에 머신러닝·딥러닝을 활용하려는 수요가 커졌지만, 사내 온프레미스 GPU 인프라는 부족했고 AWS GPU 인스턴스도 품귀로 할당받기 어려웠습니다.

IDC에는 다른 용도를 기다리는 Hadoop 장비가 있었습니다. 2021년 우아콘에서 발표한 데이터 분석 플랫폼의 AWS 이관 이후, 데이터플랫폼팀이 재활용할 방안을 찾던 인프라입니다. 팀은 이 장비에 Kubernetes 클러스터를 구축해 늘어나는 분석 수요를 수용하고, 부족한 GPU 인프라의 활용도를 높이기로 했습니다. 2022년에 진행한 온프레미스 MLOps 플랫폼 전환 프로젝트는 여기서 시작됐습니다.

## EKS 운영 경험에서 출발한 EKS-A 선택 {#eksa-eksd}

팀은 이미 AWS에서 EKS를 운영하고 있었습니다. 전사 Data Lake도 AWS에 있었고, MLOps의 기반 플랫폼 역시 EKS였습니다. 온프레미스에서도 AWS와 연계하면서 익숙한 사용자 경험을 제공하고, 클러스터 유지보수를 쉽게 하려는 선택이 EKS Anywhere(EKS-A)였습니다.

익숙한 환경을 기대했지만 운영 책임은 달랐습니다. EKS에서는 AWS가 관리하는 Control Plane을 EKS-A에서는 고객이 자신의 IDC에 두고 직접 관리합니다. 설치와 사용은 무료이며, 필요하면 유료 구독으로 기술 지원을 받는 방식입니다. 컴퓨트는 VMware vSphere와 베어메탈을 지원하며, Fargate 같은 서버리스는 지원하지 않습니다. 로드 밸런서는 MetalLB를 선택해 쓸 수 있습니다.

EKS-A는 클러스터의 생성·확장·삭제를 관리하는 오픈소스 Ops Tool과 Kubernetes 배포판인 EKS Distro(EKS-D)로 구성됩니다. EKS-D는 Amazon EKS에서 쓰는 배포판을 온프레미스의 베어메탈이나 VM에도 설치하도록 2020년 12월 공개한 오픈소스입니다. `kubeadm`이나 `kops`로도 설치할 수 있으며, 원문 작성 당시 최신 버전은 v1.24였습니다.

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

## 기대보다 좁았던 베어메탈 지원 범위 {#limits}

실제로 구축해 보니 EKS에서 기대했던 운영 편의를 모두 누릴 수는 없었습니다. 특히 한 번의 CLI 실행으로 Kubernetes 버전을 올리는 기능이 베어메탈에 없다는 점이 아쉬웠습니다. 당시 EKS-A는 아직 v0.x.x였습니다. vSphere에서 지원하던 클러스터 업그레이드뿐 아니라 etcd 백업·복원, GitOps 관리, Terraform 관리도 베어메탈에서는 지원하지 않았고, 일부 기능은 수동으로 구성해야 했습니다.

첫 배포에 쓸 Manifest의 설정 범위도 좁았습니다. 당시 공식 문서가 베어메탈에서 안내한 항목은 네트워크 플러그인인 CNI뿐이었으며, v0.11.0부터는 AWS IAM Authenticator도 지원했습니다. 문서에 없어도 Manifest로 구성하거나 배포 뒤 수동으로 설정할 수 있는 기능은 있었습니다. 그렇다고 vSphere에서 제공하던 구성을 처음부터 모두 자동화할 수 있는 상태는 아니었습니다.

설치와 운영의 편의에 걸었던 기대만큼 만족스럽지는 않았습니다. 그래도 OS 설치부터 자동화한 Tinkerbell과 AWS 연계 기능, 간단한 설치 절차는 인상적인 부분입니다. 팀은 vSphere에서 제공하는 기능이 베어메탈에도 추가되기를 기대했습니다.

## 설정 파일 뒤에서 움직이는 Tinkerbell {#architecture}

기본 설치의 입력은 설정 파일 둘입니다. CSV에는 호스트명·BMC 정보·MAC·IP·디스크 등 하드웨어 정보를, Manifest YAML에는 CNI·Pod/Service CIDR·Control Plane 수·OS 같은 클러스터 구성을 적습니다. 준비를 마치면 `eksctl anywhere create cluster --hardware-csv hardware.csv -f eksa-mgmt-cluster.yaml`을 실행합니다.

명령을 실행하는 곳은 Bootstrap(admin) 노드입니다. etcd와 API 서버 같은 시스템 컴포넌트는 Control Plane 노드에, 워크로드는 Data Plane 노드에 배치합니다. `eksctl`의 `anywhere` 플러그인은 클러스터 배포뿐 아니라 노드 추가·제거와 클러스터 삭제에도 쓰입니다.

명령 뒤의 베어메탈 설치 작업은 Tinkerbell이 맡습니다. 데이터 센터 기업 Equinix가 만든 프로비저닝 자동화 오픈소스입니다. 배포를 시작하면 kind가 Bootstrap 노드에 임시 로컬 Kubernetes를 만들고, Tinkerbell은 이 환경에서 대상 노드에 EKS-D와 EKS-A를 설치할 준비를 합니다. vSphere에 배포할 때는 Tinkerbell 대신 vSphere의 스택을 사용합니다.

장비에서는 네트워크 부팅부터 시작합니다. PXE로 부팅한 노드가 DHCP 요청을 보내면, DHCP 서버이자 TFTP 서버인 Boots가 IP 주소와 iPXE 스크립트를 전달합니다. 노드는 이 스크립트로 Hook OS(Linux Kit)를 메모리에 받아 부팅한 뒤, 실제 운영체제인 Bottlerocket 또는 Ubuntu와 EKS-A 컴포넌트를 설치하는 순서입니다. Boots는 DHCP를 위해 네트워크 2계층을 사용해야 하므로, 이 단계에서는 다른 컴포넌트와 달리 단독 컨테이너로 실행됩니다.

Hook OS 안에서는 Tink Worker가 움직입니다. 노드의 MAC 주소를 Tink Server에 보내 자신이 실행할 워크플로를 요청하고, 작업을 하나씩 마칠 때마다 결과를 보고하는 에이전트입니다. Tink Controller는 하드웨어 정보와 템플릿, 노드별 워크플로를 관리합니다. 하드웨어 스펙을 담은 메타데이터 저장소 Hegel은 EC2 메타데이터와 비슷한 형식의 정보를 HTTP로 제공하며, Rufio는 BMC로 머신의 시작·종료와 부팅 순서를 제어합니다.

설치가 끝나면 관리 위치도 바뀝니다. Tinkerbell 서비스는 새 클러스터로 옮겨져 Pod로 실행되고, Bootstrap 노드에 있던 서비스와 임시 Kubernetes는 삭제됩니다. 생성 결과는 `kube-system`의 Kubernetes 필수 컴포넌트와 `eksa-system`의 EKS-A·Tinkerbell 컴포넌트로 확인합니다. 옮겨 간 Tinkerbell 컴포넌트는 이후 클러스터 구성을 변경할 때도 사용합니다.

노드를 늘릴 때도 같은 프로비저닝 과정을 사용합니다. 신규 노드의 정보를 CSV로 작성한 뒤 `eksctl anywhere generate hardware -z hardware_2.csv | kubectl apply -f -`를 실행하면 Tinkerbell이 설치를 수행하는 방식입니다. 이때는 클러스터 구성을 위한 YAML을 다시 준비하지 않아도 됩니다.

## 수작업이 남았던 베어메탈 설치 {#problems}

설치 명령이 간단하다고 모든 설정이 끝나는 것은 아니었습니다. 팀은 빠진 설정을 추가하고 필요한 이미지를 직접 준비한 뒤에야 원하는 수준으로 설치를 마쳤습니다. 이 과정에서는 EKS-A의 GitHub 이슈 게시판도 도움이 됐습니다. 기술 지원을 구독하지 않았지만 버그 제보와 설치 중 예외 상황에 관한 문의에 신속한 대응을 받을 수 있었습니다.

### 인증서부터 보완한 AWS IAM Authenticator

AWS IAM Authenticator는 AWS 계정으로 Kubernetes 클러스터를 인증하는 도구입니다. 팀이 처음 설치한 v0.10.0에서는 Manifest에 관련 옵션을 넣어도 정상적으로 동작하지 않았습니다. GitHub 이슈에도 같은 문제가 올라와 있었습니다.

빠진 것은 인증서와 API 서버 설정이었습니다. Kube API 서버 Pod에 AWS IAM Authenticator 인증서가 정상적으로 배포되지 않았고, API 서버의 Pod Manifest에도 필요한 설정이 없었습니다.

팀은 `aws-iam-authenticator` CLI로 인증서를 생성해 API 서버 Pod가 마운트하는 호스트 디렉터리에 복사했습니다. 이어 API 서버 Manifest에 Webhook 인증을 위한 `--authentication-token-webhook-config-file` 옵션을 추가하고, `aws-auth` ConfigMap에 AWS 계정별 권한을 작성했습니다. v0.11.0부터는 이 문제가 수정돼 최초 배포 Manifest에 설정을 넣는 것으로 구성할 수 있게 됐습니다.

### Service Account에 연결한 IAM Role

S3 데이터에 접근하는 워크로드에는 IAM for Pod(IRSA)가 유용합니다. Kubernetes의 Service Account와 AWS IAM Role을 연결해, 해당 Service Account를 쓰는 Pod가 Role의 권한을 얻는 기능입니다. Access/Secret Key를 따로 발급하지 않아도 되므로 키 관리의 번거로움을 줄입니다. 처음 발급할 때만 확인할 수 있는 키를 잃어버리거나, 유출로 권한을 탈취당할 위험도 피할 수 있습니다.

이 기능도 Manifest만으로는 준비되지 않았습니다. API 서버에 필요한 설정이 없었고, Service Account를 인지해 Pod에 권한을 부여하는 `amazon-eks-pod-identity-webhook` Pod도 배포되지 않았습니다.

먼저 이 프로젝트의 키 생성기로 OIDC Provider에 제공할 공개키를 발급했습니다. S3를 키 저장소로 쓰고 CloudFront와 함께 Service Issuer를 구성한 뒤, 이를 이용해 AWS IAM의 OIDC Provider를 구축했습니다. 임시 토큰을 발급받도록 `sts.amazonaws.com`을 Audience로 추가하고, 토큰으로 IAM Role의 권한을 얻도록 OIDC Provider와 IAM Role 사이의 신뢰 관계도 설정했습니다.

AWS 쪽 준비 뒤에는 클러스터 설정이 남았습니다. API 서버 Manifest에 `--api-audiences`와 `--service-account-issuer`를 추가하고, `amazon-eks-pod-identity-webhook`을 빌드해 클러스터에 배포했습니다. 이 과정을 마치면 Service Account의 annotation에 IAM Role ARN을 지정하고, 해당 Service Account를 사용하는 Pod에 Role의 권한을 부여할 수 있습니다.

### v0.11.0부터 직접 준비한 Ubuntu 이미지

EKS-A는 Bottlerocket과 Ubuntu를 지원하지만, v0.11.0부터는 EKS-A용 Ubuntu 이미지를 제공하지 않았습니다. Ubuntu를 쓰려면 Amazon의 `image-builder`로 이미지를 직접 빌드하고 자체 이미지 저장소도 준비해야 했습니다.

빌드할 서버에도 조건이 있었습니다. KVM을 지원하는 베어메탈 서버에서만 빌드할 수 있어, 이 조건을 만족하는 장비가 필요했습니다. 이미지 생성 가이드는 상세한 편이었습니다. 팀은 가이드에 따라 이미지를 만든 뒤 Apache 웹서버에서 HTTP로 내려받도록 구성하고, 클러스터 Manifest의 `osImageURL`에 다운로드 경로를 지정했습니다.
