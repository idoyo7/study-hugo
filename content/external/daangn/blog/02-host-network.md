---
title: "DaemonSet과 Job에 hostNetwork를 적용해 IP 사용과 대기 줄이기"
description: "당근이 DaemonSet과 Job에 hostNetwork를 적용한 과정입니다. IP 절약 효과와 함께 포트 충돌, Istio, DogStatsD 연동에서 확인한 제약을 요약합니다."
date: 2026-10-21
weight: 3
---

# DaemonSet과 Job에 hostNetwork를 적용해 IP 사용과 대기 줄이기 (2025-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [쿠버네티스 파드에 Host Network 도입기](https://medium.com/daangn/%EC%BF%A0%EB%B2%84%EB%84%A4%ED%8B%B0%EC%8A%A4-%ED%8C%8C%EB%93%9C%EC%97%90-host-network-%EB%8F%84%EC%9E%85%EA%B8%B0-99b4c02ca490)
- 매체 · 게시일: Medium 당근 블로그 · 2025-09-25
- 저자: Jungsub Shin (Ssup, 당근 SRE팀 클러스터 파트)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 노드가 늘수록 부족해진 Pod IP {#문제와-적용-대상}

클러스터가 약 1000대로 커지자 노드마다 실행하는 DaemonSet의 IP 사용량이 부담이 됐습니다. 블루/그린 업그레이드로 여분 노드를 만들 때는 더 많은 IP가 필요했습니다. 생성과 삭제가 잦은 Job에서는 AWS VPC CNI의 IP 할당이 지연돼 실행이 늦어졌습니다. 운영 클러스터에서 측정한 5회 가운데 실행까지 1분 넘게 걸린 경우는 모두 IP 할당이 늦어진 경우였습니다.

당근은 노드 IP를 공유하는 `hostNetwork: true`를 노드당 하나씩 실행하는 DaemonSet과 리스닝 포트가 없는 Job에 적용했습니다. CoreDNS를 계속 사용하도록 `dnsPolicy: ClusterFirstWithHostNet`도 지정했습니다. 포트를 공유하므로 충돌할 수 있고 Istio sidecar를 사용할 수 없어, 일반 서버 Deployment는 적용 대상에서 제외했습니다.

## Job 자동 적용과 포트 충돌 처리 {#적용-방식과-예외-처리}

Warm IP를 늘리면 지연을 줄일 여지가 있지만 IP 낭비가 커집니다. Job 노드에만 Warm IP를 늘리는 방안도 검토했으나, VPC CNI를 하나 더 설치하는 비표준 구성을 운영해야 해 채택하지 않았습니다. 대신 자체 Admission 컨트롤러가 Job Pod에 hostNetwork와 dnsPolicy를 넣고, 제외 어노테이션이 있는 Pod는 건너뛰게 했습니다.

전환 뒤 충돌이 발생한 포트는 용도에 따라 처리했습니다. 서버 코드를 재사용하면서 남은 Prometheus Exporter 포트는 Job에서 쓰지 않아 닫았습니다. PostgreSQL을 직접 실행하는 Job에는 제외 어노테이션을 붙였습니다. 메트릭만으로 충돌 원인을 찾기 어려워 로그의 "address already in use" 문자열도 감시했습니다.

DaemonSet에서는 eks-pod-identity-agent, datadog, alloy를 전환했습니다. datadog의 DogStatsD가 메트릭을 받지 못하던 문제는 메트릭을 보내는 Pod를 재시작해 해결했습니다.

## IP 사용량과 Job 실행 시간의 변화 {#결과}

DaemonSet을 전환한 뒤 IP를 2000개 이상 아꼈고, 신규 DaemonSet에도 같은 설정을 기본으로 적용했습니다. Job 실행 시간은 재측정한 5회 모두 20초 안팎이었습니다. 도입 전 측정 범위와 IP 할당 실패 이벤트의 변화는 아래 표에서 비교할 수 있습니다. 전환 후 남은 실패 이벤트는 서버 Pod를 대량 배포할 때 발생했습니다.

## 전환 후에도 확인해야 하는 포트와 연동 {#적용할-때-주의할-점}

노드 IP를 공유하는 DaemonSet끼리도 포트가 겹칠 수 있습니다. 당근은 도입 후 2~3주 동안 간헐적인 충돌을 해결했으며, DogStatsD처럼 연동된 Pod를 재시작해야 하는 경우도 있었습니다. Istio 메시가 필요한 워크로드에는 이 구성을 적용할 수 없습니다.

CNI의 IP 할당 지연은 [Job 노드 그룹 오토스케일링 글]({{< relref "/external/daangn/blog/03-job-nodegroup-autoscaling.md" >}})에서도 노드당 Pod가 많아졌을 때의 병목으로 등장합니다.

{{% details title="측정 전후 근거 표" closed="true" %}}

| 항목 | 도입 전 | 도입 후 |
|---|---|---|
| Job Pod 실행까지 시간(5회 측정) | 15초 ~ 1분 25초 | 모두 20초 내외 |
| `failed to assign an IP address to container` 이벤트 | 시간당 약 13,000건 | 시간당 약 50건 |
| DaemonSet 전환으로 절약한 IP | 해당 없음 | 2000개 이상 |
| Warm IP 설정(당시) | 5 | 변경 없음(증설 대안은 기각) |

{{% /details %}}
