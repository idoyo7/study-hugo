---
title: "쿠버네티스 파드에 Host Network 도입기"
description: "당근 SRE팀 클러스터 파트가 DaemonSet의 IP 점유와 Job Pod의 IP 할당 지연을 hostNetwork로 줄인 과정의 요약입니다. 2000개 이상의 IP를 아꼈고 IP 할당 실패 이벤트를 시간당 약 13,000건에서 약 50건으로 낮췄습니다."
date: 2026-10-21
weight: 3
---

# 쿠버네티스 파드에 Host Network 도입기 (2025-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [쿠버네티스 파드에 Host Network 도입기](https://medium.com/daangn/%EC%BF%A0%EB%B2%84%EB%84%A4%ED%8B%B0%EC%8A%A4-%ED%8C%8C%EB%93%9C%EC%97%90-host-network-%EB%8F%84%EC%9E%85%EA%B8%B0-99b4c02ca490)
- 매체 · 게시일: Medium 당근 블로그 · 2025-09-25
- 저자: Jungsub Shin (Ssup, 당근 SRE팀 클러스터 파트)
- 이 문서는 원문을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## 문제와 적용 대상

클러스터가 약 1000대 규모로 커지면서 DaemonSet Pod의 IP 점유가 문제가 됐습니다. 블루/그린 업그레이드로 여분 노드를 대량 생성할 때는 더 심해졌습니다. 생성·삭제가 잦은 Job에서는 AWS VPC CNI의 IP 할당이 밀렸습니다. 운영 클러스터에서 5회 측정한 Pod 실행까지 걸린 시간은 15초에서 1분 25초였고, 1분을 넘긴 경우는 모두 IP 할당 지연 때문이었습니다.

당근이 선택한 방법은 Pod가 노드 IP를 그대로 쓰는 `hostNetwork: true`입니다. IP를 아끼고 Pod 생성을 앞당길 수 있으며, CoreDNS를 계속 쓰려면 `dnsPolicy: ClusterFirstWithHostNet`도 지정해야 합니다. 포트 충돌 위험이 있고 Istio sidecar를 붙일 수 없어 메시를 못 쓰므로 일반 서버 Deployment에는 맞지 않습니다. 적용 대상은 노드당 하나인 DaemonSet과 리스닝 포트가 없는 Job입니다.

## 적용 방식과 예외 처리

Warm IP를 늘리는 방안은 IP 낭비가 커져 택하지 않았습니다. Job 노드의 Warm IP만 늘리는 방안도 VPC CNI를 하나 더 설치해야 하는 비표준 방식이고 운영이 복잡해 기각했습니다. 그래서 Job은 IP 할당 과정 자체를 피하는 Host Network를 택했습니다. 자체 Admission 컨트롤러가 Job Pod에 hostNetwork와 dnsPolicy를 자동으로 넣습니다. 특정 어노테이션이 붙은 Pod는 제외합니다.

포트 충돌에는 원인별로 대응했습니다. 서버 코드를 재사용하면서 남은 Prometheus Exporter 리스닝 포트는 쓰이지 않아 닫았습니다. Job 안에서 PostgreSQL을 띄우는 경우는 제외 어노테이션을 붙였습니다. 충돌 원인은 메트릭으로 파악하기 어려워 로그의 "address already in use" 문자열을 감시합니다.

DaemonSet에서는 eks-pod-identity-agent, datadog, alloy를 Host Network로 전환했습니다. 전환 뒤 datadog의 DogStatsD가 메트릭을 받지 못하는 문제는 메트릭을 보내는 Pod를 재시작해 해결했습니다.

## 결과

- 모든 DaemonSet 전환 후 IP 2000개 이상 절약. 신규 DaemonSet에도 기본 적용
- Job Pod 실행까지 걸린 시간은 재측정 5회 모두 20초 안팎
- IP 할당 실패 이벤트는 시간당 약 13,000건에서 약 50건으로 감소. 남은 이벤트는 서버 Pod 대량 배포로 발생

## 적용할 때 주의할 점

Istio 메시가 필요한 워크로드에는 쓸 수 없으며, DaemonSet끼리 같은 포트를 쓰면 충돌할 수 있습니다. datadog 사례처럼 전환 뒤 연동 Pod를 재시작해야 하는 경우도 있습니다. 당근은 도입 뒤 2~3주 동안 간헐적으로 발생한 충돌을 하나씩 해결했다고 합니다.

이 글의 Job IP 지연 문제와 해법은 [Job 노드 그룹 오토스케일링 글]({{< relref "/external/daangn/blog/03-job-nodegroup-autoscaling.md" >}})에서도 CNI IP 할당 지연을 다룰 때 다시 나옵니다.

{{% details title="측정 전후 근거 표" closed="true" %}}

| 항목 | 도입 전 | 도입 후 |
|---|---|---|
| Job Pod 실행까지 시간(5회 측정) | 15초 ~ 1분 25초 | 모두 20초 내외 |
| `failed to assign an IP address to container` 이벤트 | 시간당 약 13,000건 | 시간당 약 50건 |
| DaemonSet 전환으로 절약한 IP | 해당 없음 | 2000개 이상 |
| Warm IP 설정(당시) | 5 | 변경 없음(증설 대안은 기각) |

{{% /details %}}
