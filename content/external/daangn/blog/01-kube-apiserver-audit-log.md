---
title: "kubectl create pod 뒤에 일어나는 일: kube-apiserver 감사 로그로 보기"
description: "당근 SRE팀 클러스터 파트의 Karin이 쓴 입문 해설 요약입니다. Pod 하나를 만들 때 컨트롤 플레인 컴포넌트가 어떤 순서로 API를 호출하는지 EKS 감사 로그로 따라갑니다."
date: 2026-10-21
weight: 1
---

# kubectl create pod 뒤에 일어나는 일 (2024-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [‘kubectl create pod’를 실행하면 발생하는 일 — kube-apiserver 감사 로그(Audit Log)로 엿보기](https://medium.com/daangn/kubectl-create-pod%EB%A5%BC-%EC%8B%A4%ED%96%89%ED%95%98%EB%A9%B4-%EB%B0%9C%EC%83%9D%ED%95%98%EB%8A%94-%EC%9D%BC-kube-apiserver-%EA%B0%90%EC%82%AC-%EB%A1%9C%EA%B7%B8-audig-log-%EB%A1%9C-%EC%97%BF%EB%B3%B4%EA%B8%B0-6f01487abdda)
- 매체 · 게시일: Medium 당근 블로그 · 2024-05-07
- 저자: Karin (당근 SRE팀 클러스터 파트)
- 이 문서는 원문을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## Pod 생성 뒤의 동작을 확인하려면

`kubectl create`로 Pod 하나를 만들어도 apiserver, scheduler, kubelet이 각각 무엇을 했는지는 눈에 잘 드러나지 않습니다. Karin은 감사 로그를 읽으며 각 컴포넌트의 동작을 요청 단위로 따라갑니다. 장애 사례를 분석하는 글이 아닌 학습용 해설입니다.

## EKS 감사 로그에서 따라간 생성 순서

실습에는 EKS 1.28과 공식 문서의 nginx 샘플 Pod를 사용했습니다. EKS 콘솔의 제어 플레인 로깅에서 API 서버, 감사, 스케줄러 로그를 켜면 CloudWatch에서 확인할 수 있습니다. 원문은 버전에 따라 로그와 스펙이 조금 다를 수 있다고 밝힙니다.

요청을 읽을 때 살펴볼 필드는 다음과 같습니다.

- requestURI: 요청 대상 자원
- verb: 요청한 동작
- userAgent: 요청을 보낸 주체(apiserver, scheduler, kubelet)
- objectRef, requestObject, responseObject: 요청과 응답의 세부 내용

scheduler와 kubelet이 watch를 걸어 둔 상태에서 kubectl 요청이 들어옵니다. apiserver는 해당 네임스페이스의 limitranges와 resourcequotas를 조회하며, 이 단계에서 막히면 Pod 생성은 실패합니다. 통과한 Pod는 etcd에 저장되고 Pending 상태가 됩니다.

이후 scheduler가 노드를 골라 `binding`을 요청하면, kubelet이 Pod 정보를 가져와 ContainerCreating으로 바꿉니다. Pulled·Created·Started 이벤트가 기록되고 Ready와 Pod IP가 보고된 뒤, kubectl이 응답을 받습니다.

## 확인한 역할과 당근의 활용

당근은 감사 로그와 AWS EventBridge로 엔지니어의 kubectl 작업을 Slack에 알립니다. kubectl exec 같은 작업도 모두가 볼 수 있게 합니다.

정량 결과는 없으며, 이 글에서 확인할 수 있는 것은 컴포넌트별 역할입니다. 모든 컴포넌트가 apiserver를 거치고, etcd와 직접 통신하는 것은 apiserver뿐입니다. scheduler는 노드 배정만 맡고, kubelet은 컨테이너를 실행하며 상태를 apiserver에 보고합니다. 단독 Pod 생성에는 controller-manager가 관여하지 않으며, Deployment에는 deployment-controller가 관여합니다.

## 원문이 다루는 범위

원문은 watch 로그를 생략하고 IP 할당, 컨테이너 실행 등 노드 쪽 세부 동작은 다루지 않습니다. 글 끝에는 SRE 밋업 영상 3편이 임베드되어 있지만, 어느 영상인지는 확인하지 못했습니다.

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
