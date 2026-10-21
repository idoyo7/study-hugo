---
title: "HPA Scale-in이 만든 AZ 불균형, Pod Deletion Cost로 바로잡기"
description: "당근 SRE 밋업 4회에서 딜리버리 파트가 발표한 AZ 파드 수 불균형 해결 요약입니다. Locality LB 때문에 생긴 Zone Skew를 Pod Deletion Cost 컨트롤러로 잡았고 도입 뒤 Zone Skew가 원인인 장애는 0건이 되었습니다."
date: 2026-10-21
weight: 4
---

# HPA Scale-in이 만든 AZ 불균형, Pod Deletion Cost로 바로잡기 (SRE 밋업 4회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [HPA Scale-in이 만든 AZ 불균형, Pod Deletion Cost로 바로잡기 | 당근 SRE 밋업 4회](https://www.youtube.com/watch?v=_8suLM4lrRo) (25:18)
- 매체 · 게시일: YouTube 당근 채널 · 2025-10-10
- 발표자: 김규환 (SRE 팀 딜리버리 파트, 영상 설명란과 슬라이드 표지로 확인)
- 근거: YouTube 자동 자막 전체 + 발표 슬라이드
- 이 문서는 영상을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## 주요 구간

- [01:00](https://www.youtube.com/watch?v=_8suLM4lrRo&t=60s) 문제 정의: Locality LB와 Zone Skew
- [04:00](https://www.youtube.com/watch?v=_8suLM4lrRo&t=240s) TopologySpreadConstraints, 수동 재시작, Descheduler
- [07:30](https://www.youtube.com/watch?v=_8suLM4lrRo&t=450s) Pod Deletion Cost 소개
- [10:00](https://www.youtube.com/watch?v=_8suLM4lrRo&t=600s) 컨트롤러 목표와 cost 부여 전략 비교
- [16:00](https://www.youtube.com/watch?v=_8suLM4lrRo&t=960s) 컨트롤러 구조와 동기화 루프
- [20:00](https://www.youtube.com/watch?v=_8suLM4lrRo&t=1200s) 대칭 코스트와 도입 결과

## Locality LB 이후 드러난 AZ 불균형

당근은 AZ별 파드 수 불균형으로 2년 동안 크고 작은 장애를 겪었다고 합니다. 새벽 1시쯤부터 AZ별 CPU 사용량이 벌어지는 서비스도 있었습니다.

배경에는 발표 시점에서 약 2년 전 비용 절감을 위해 도입한 Locality 로드 밸런싱이 있습니다. 같은 AZ의 서버로 요청을 먼저 보내 Cross-AZ 트래픽은 크게 줄었지만, 파드가 여섯 대인 AZ와 두 대인 AZ에 같은 양의 요청이 들어오면 두 대에 부하가 몰립니다. 발표에서 Zone Skew라고 부른 문제입니다. HPA는 두 AZ의 전체 평균 부하를 보므로 한쪽만 과부하여도 스케일 아웃하지 않았습니다.

## 스케일 인의 삭제 순서 제어

당근이 적용한 TopologySpreadConstraints(topologyKey는 zone, maxSkew는 1)는 배포·재시작·스케일 아웃 때 새 파드를 고르게 배치하는 데 효과가 있었습니다. 스케일 인에서 지울 파드는 스케줄러가 정하지 않아, 트래픽이 줄어드는 새벽에는 작은 불균형이 쌓였습니다. 온콜이 알림을 보고 디플로이먼트를 재시작해도 다음 스케일 인에서 다시 균형이 깨졌고, 새벽 대응도 어려웠습니다. 수동 재시작은 근본 해결이 아니었습니다. 주기적으로 파드를 제거하는 Descheduler는 새벽에 임의로 파드를 지우는 위험이 부담스러워 제외했습니다.

선택한 수단은 Kubernetes의 Pod Deletion Cost 어노테이션입니다. 같은 ReplicaSet에서 값이 낮은 파드부터 삭제하며, 값이 없으면 0으로 취급합니다. v1.22부터 beta로 제공되는 기능입니다. 당근은 AZ 간 파드 수 균형과 운영 예측 가능성을 확보하고 Kubernetes API 부하를 최소화하려고 cost를 관리하는 컨트롤러를 만들었습니다.

모든 파드에 순번 cost를 주면 삭제 순서를 정확히 예측할 수 있지만, 노드가 갑자기 사라지면 cost가 무효화돼 불균형이 커지고 API 호출도 폭증합니다. 발표자는 새벽에 HPA가 파드를 한꺼번에 줄이지 않고 불균형도 조금씩 쌓인다는 점에 주목해 부분 cost 방식을 택했습니다. 파드가 많은 AZ에서 다음에 삭제할 소수의 파드에만 cost를 주는 방식입니다. 삭제 예측 가능성은 약간 떨어져도 알고리즘이 단순하고 API 부하가 적습니다.

Go로 작성한 컨트롤러는 스케일 인이나 새 파드 스케줄로 파드 수가 변할 때만 동작합니다. 이벤트를 큐에 넣고 파드와 노드의 AZ 정보를 모아, AZ별로 cost를 부여할 파드 수를 계산합니다. 실제 상태와 비교해 cost를 받은 파드가 부족하면 추가로 부여하고, 많으면 cost를 제거합니다.

운영 중에는 균형 상태의 삭제 순서도 보완해야 했습니다. 균형이 맞으면 cost가 없어 다음 스케일 인에서 어느 AZ의 파드가 삭제될지 알 수 없었고, 파드가 적은 새벽에는 이 불확실성이 치명적이었습니다. 그래서 당근은 균형일 때도 양쪽 AZ의 일부 파드에 같은 작은 cost를 주는 대칭 코스트를 넣었습니다. 스케일 인 때 양쪽에서 번갈아 하나씩 삭제하도록 유도합니다.

## 도입 결과

- 적용 전에는 새벽마다 벌어졌다 교차하던 AZ별 파드 수 그래프의 두 선이 적용 뒤에는 거의 겹쳐서 움직임
- 적용 뒤 AZ별 CPU 평균 사용량의 두 곡선이 거의 겹침
- 컨트롤러 도입 이후 Zone Skew가 원인인 장애 0건, 온콜의 수동 재시작도 불필요

## 적용 범위와 주의점

부분 cost는 모든 파드에 cost를 주는 방식보다 삭제 순서를 덜 예측할 수 있습니다. 발표자는 실제 운영에서는 충분히 받아들일 만한 수준으로 판단했습니다. Kubernetes 문서는 Pod Deletion Cost를 너무 자주 바꾸지 말라고 안내하므로, 컨트롤러가 필요할 때만 최소한으로 개입하는 것이 이 방식의 전제입니다.

발표에서 다룬 범위는 Locality 로드 밸런싱을 쓰는 AZ 두 개 구성입니다. 그 밖의 구성은 발표에서 다루지 않았습니다.

{{% details title="근거와 세부 수치" closed="true" %}}

| 항목 | 내용 | 근거 |
|---|---|---|
| Locality LB 도입 시점 | 발표 시점에서 약 2년 전 | 자막 기준 |
| Zone Skew 사례 | 한쪽 AZ 6대, 다른 쪽 2대 | 자막 기준 |
| AZ 제약 | topologyKey zone, maxSkew 1, DoNotSchedule | 슬라이드 |
| Pod Deletion Cost | 어노테이션 controller.kubernetes.io/pod-deletion-cost, 낮은 값 우선 삭제, 기본 0, v1.22부터 beta | 슬라이드 |
| 전체 cost 전략 | 이벤트마다 모든 파드의 cost 재계산, API 요청이 많고 일관성 관리가 복잡함 | 슬라이드 |
| 부분 cost 전략 | 파드가 더 많은 AZ의 일부 파드에만 cost 부여, 슬라이드 도식 값은 -100 | 슬라이드 |
| 컨트롤러 단계 | 이벤트 감시, 큐, AZ별 불균형 계산, 삭제 후보 수 결정, 파드 패치 | 슬라이드 |
| 적용 전후 | AZ별 파드 수와 CPU 평균 그래프만 있고 수치 표는 없음 | 슬라이드 |
| 장애 | Zone Skew가 원인인 장애 0건 | 슬라이드 |

부분 cost 값은 자막에서 -1로 들리지만 슬라이드 도식에는 -100으로 적혀 있어, 이 문서에는 슬라이드 값을 썼습니다. 발표자는 부분 cost를 처음 접근한 방식이라고 설명했습니다. 이후 보완한 대칭 코스트의 슬라이드 값은 -1입니다.

{{% /details %}}
