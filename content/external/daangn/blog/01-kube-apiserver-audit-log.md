---
title: "EKS 감사 로그로 따라가는 Pod 생성 과정"
description: "EKS 1.28에서 nginx Pod를 만들 때 apiserver, scheduler, kubelet이 주고받는 요청을 따라간 당근의 글을 요약합니다."
date: 2026-10-21
weight: 5
---

# EKS 감사 로그로 따라가는 Pod 생성 과정 (2024-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [‘kubectl create pod’를 실행하면 발생하는 일 — kube-apiserver 감사 로그(Audit Log)로 엿보기](https://medium.com/daangn/kubectl-create-pod%EB%A5%BC-%EC%8B%A4%ED%96%89%ED%95%98%EB%A9%B4-%EB%B0%9C%EC%83%9D%ED%95%98%EB%8A%94-%EC%9D%BC-kube-apiserver-%EA%B0%90%EC%82%AC-%EB%A1%9C%EA%B7%B8-audig-log-%EB%A1%9C-%EC%97%BF%EB%B3%B4%EA%B8%B0-6f01487abdda)
- 매체 · 게시일: Medium 당근 블로그 · 2024-05-07
- 저자: Karin (당근 SRE팀 클러스터 파트)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## kubectl 요청을 컴포넌트별로 나눠 보기 {#pod-생성-뒤의-동작을-확인하려면}

`kubectl create`를 실행한 뒤 Pod가 뜨기까지는 apiserver, scheduler, kubelet의 작업이 이어집니다. Karin의 글은 EKS 감사 로그에서 각 요청을 찾아 이 과정을 설명합니다. 장애를 해결한 기록이 아니라, Pod 생성 과정을 익히기 위한 실습입니다.

## EKS 1.28에서 확인한 요청 순서 {#eks-감사-로그에서-따라간-생성-순서}

실습에는 공식 문서의 nginx 샘플 Pod를 썼습니다. EKS 콘솔에서 API 서버·감사·스케줄러 로그를 켜면 CloudWatch로 요청을 볼 수 있습니다. 로그의 필드와 스펙은 버전에 따라 달라질 수 있습니다.

`requestURI`와 `verb`로 요청 대상과 동작을 읽고, `userAgent`로 요청을 보낸 컴포넌트를 구분합니다. `objectRef`, `requestObject`, `responseObject`에는 요청과 응답의 세부 내용이 담깁니다.

원문은 scheduler와 kubelet이 watch를 걸어 둔 상태에서 시작합니다. kubectl의 생성 요청을 받은 apiserver는 네임스페이스의 limitranges와 resourcequotas를 조회합니다. 이 검사를 통과하지 못하면 생성이 실패하고, 통과한 Pod는 etcd에 저장되어 Pending 상태가 됩니다.

scheduler가 노드를 고르고 `binding`을 요청하면 kubelet이 Pod 정보를 가져와 ContainerCreating 상태를 보고합니다. 이어 Pulled·Created·Started 이벤트와 Ready, Pod IP가 기록됩니다. 원문에 정리된 요청 순서는 아래 표에 남겼습니다.

## 감사 로그로 구분할 수 있는 역할 {#확인한-역할과-당근의-활용}

감사 로그를 읽으면 scheduler가 노드를 배정하고 kubelet이 컨테이너 실행과 상태 보고를 맡는다는 점을 확인할 수 있습니다. 컴포넌트들은 apiserver를 통해 통신하며, etcd에 직접 접근하는 컴포넌트는 apiserver입니다. 단독 Pod 생성과 Deployment 생성의 차이도 드러납니다. 앞의 실습에는 controller-manager가 관여하지 않지만 Deployment에는 deployment-controller가 관여합니다.

당근은 감사 로그와 AWS EventBridge를 연결해 엔지니어의 kubectl 작업을 Slack에 알립니다. 다른 엔지니어도 `kubectl exec` 같은 작업을 확인할 수 있도록 한 용도입니다. 이 글에는 성능이나 비용의 정량 비교는 없습니다.

## 실습에서 생략한 동작 {#원문이-다루는-범위}

원문은 watch 로그와 노드 내부의 IP 할당·컨테이너 실행 과정을 생략합니다. 글 끝에 삽입된 SRE 밋업 영상 3편은 어느 발표인지 확인하지 못했습니다.

{{% details title="Pod 생성 흐름 근거 표" closed="true" %}}

| 순서 | 주체 | 관찰되는 요청 |
|---|---|---|
| 1 | apiserver | limitranges, resourcequotas 조회 |
| 2 | apiserver, etcd | Pod 생성 요청 저장, Pending |
| 3 | scheduler | `pods/<name>/binding` 요청 |
| 4 | kubelet | Pod 정보 조회, status 갱신(ContainerCreating) |
| 5 | kubelet | Pulled, Created, Started 이벤트(EKS는 containerd, vpc-cni) |
| 6 | kubelet | Ready, ContainersReady True, Pod IP 보고 |
| 7 | apiserver | kubectl 응답 |

scheduler와 kubelet의 watch는 표의 첫 요청보다 먼저 걸려 있습니다.

{{% /details %}}
