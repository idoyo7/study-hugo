---
title: "Pod Deletion Cost로 HPA의 AZ 불균형을 줄인 방법"
description: "당근 딜리버리 파트는 Locality LB 환경에서 HPA Scale-in이 만든 Zone Skew를 전용 Pod Deletion Cost 컨트롤러로 줄였습니다. 설계 선택과 동기화 방식, 도입 뒤 Zone Skew가 원인인 장애가 0건이 된 결과를 정리합니다."
date: 2026-10-21
weight: 4
---

# Pod Deletion Cost로 HPA의 AZ 불균형을 줄인 방법 (SRE 밋업 4회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [HPA Scale-in이 만든 AZ 불균형, Pod Deletion Cost로 바로잡기 | 당근 SRE 밋업 4회](https://www.youtube.com/watch?v=_8suLM4lrRo) (25:18)
- 매체 · 게시일: YouTube 당근 채널 · 2025-10-10
- 발표자: 김규환 (SRE 팀 딜리버리 파트, 영상 설명란과 슬라이드 표지로 확인)
- 근거: YouTube 자동 자막 전체 + 발표 슬라이드
- 발표 영상의 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## Locality LB가 드러낸 Zone Skew {#locality-lb-이후-드러난-az-불균형}

발표자는 당근이 약 2년 동안 AZ별 파드 수가 어긋나면서 크고 작은 장애를 겪었다고 설명했습니다. 일부 서비스는 새벽 1시 무렵부터 AZ별 CPU 사용량 차이가 벌어졌습니다.

비용을 줄이려고 약 2년 전에 도입한 Locality 로드 밸런싱이 이 현상의 배경이었습니다. 요청을 같은 AZ 서버에 우선 보내 Cross-AZ 트래픽은 크게 줄였지만, 파드가 여섯 대인 AZ와 두 대인 AZ에 같은 요청량이 들어오면 두 대뿐인 쪽이 과부하됩니다. 발표자는 이를 Zone Skew라고 불렀습니다. HPA는 두 AZ를 합친 평균 부하를 보기 때문에 한쪽만 과부하인 상황에서는 스케일 아웃하지 않았습니다.

## 스케일 인의 삭제 순서 제어

`topologyKey: zone`, `maxSkew: 1`인 TopologySpreadConstraints는 배포·재시작·스케일 아웃 때 새 파드를 고르게 놓았습니다. 하지만 스케일 인에서 삭제할 파드는 스케줄러가 선택하지 않습니다. 트래픽이 줄어드는 새벽마다 작은 불균형이 누적됐고, 온콜이 디플로이먼트를 재시작해도 다음 스케일 인에서 다시 어긋났습니다. 새벽에 임의로 파드를 제거할 수 있는 Descheduler도 운영 위험 때문에 제외했습니다.

해결 수단으로 Kubernetes v1.22부터 beta인 Pod Deletion Cost 어노테이션을 골랐습니다. 같은 ReplicaSet에서는 값이 낮은 파드를 먼저 지우고, 어노테이션이 없으면 0으로 처리합니다. 당근은 AZ별 파드 수를 맞추면서 삭제 순서를 예측하고 Kubernetes API 부하를 줄이기 위해 cost 전용 컨트롤러를 만들었습니다.

모든 파드에 순번 cost를 붙이면 삭제 순서를 정확히 알 수 있습니다. 그러나 노드가 갑자기 사라지면 기존 cost가 무효가 되어 불균형과 API 호출이 함께 커집니다. HPA가 새벽에 파드를 한꺼번에 줄이지 않고 불균형도 서서히 쌓인다는 관찰을 바탕으로, 파드가 많은 AZ의 삭제 후보 몇 개에만 값을 주는 부분 cost를 선택했습니다. 예측성은 조금 낮아지지만 알고리즘이 단순해지고 API 사용량이 줄어듭니다.

Go 컨트롤러는 스케일 인이나 새 파드 스케줄로 파드 수가 달라질 때만 실행됩니다. 이벤트를 큐에 넣고 파드·노드의 AZ 정보를 수집한 다음, 각 AZ에서 cost가 필요한 파드 수를 계산합니다. 실제 상태보다 부족하면 cost를 추가하고 많으면 제거합니다.

AZ가 균형을 이룬 순간에도 문제가 남았습니다. cost가 하나도 없으면 다음 스케일 인이 어느 AZ를 줄일지 알 수 없고, 파드가 적은 새벽에는 한 번의 선택도 큰 차이를 만들었습니다. 당근은 균형 상태에서도 양쪽 AZ의 일부 파드에 같은 작은 값을 주는 대칭 코스트를 추가해, 스케일 인이 양쪽에서 번갈아 한 개씩 삭제되도록 유도했습니다.

## 도입 결과

- 적용 전에는 새벽마다 벌어졌다 교차하던 AZ별 파드 수 그래프의 두 선이 적용 뒤에는 거의 겹쳐서 움직임
- 적용 뒤 AZ별 CPU 평균 사용량의 두 곡선이 거의 겹침
- 컨트롤러 도입 이후 Zone Skew가 원인인 장애 0건, 온콜의 수동 재시작도 불필요

## 적용 범위와 주의점

부분 cost는 전체 파드에 순번을 매기는 방식보다 삭제 순서의 예측성이 낮습니다. 발표자는 운영에서 수용할 수 있는 수준이라고 판단했습니다. Kubernetes 문서도 Pod Deletion Cost를 자주 바꾸지 말라고 안내하므로, 상태가 변할 때만 최소한의 파드를 패치해야 합니다.

이 발표에서 다룬 범위는 Locality 로드 밸런싱을 사용하는 2개 AZ 구성입니다. 다른 구성은 다루지 않았습니다.

## 주요 구간

- [01:00](https://www.youtube.com/watch?v=_8suLM4lrRo&t=60s) 문제 정의: Locality LB와 Zone Skew
- [04:00](https://www.youtube.com/watch?v=_8suLM4lrRo&t=240s) TopologySpreadConstraints, 수동 재시작, Descheduler
- [07:30](https://www.youtube.com/watch?v=_8suLM4lrRo&t=450s) Pod Deletion Cost 소개
- [10:00](https://www.youtube.com/watch?v=_8suLM4lrRo&t=600s) 컨트롤러 목표와 cost 부여 전략 비교
- [16:00](https://www.youtube.com/watch?v=_8suLM4lrRo&t=960s) 컨트롤러 구조와 동기화 루프
- [20:00](https://www.youtube.com/watch?v=_8suLM4lrRo&t=1200s) 대칭 코스트와 도입 결과

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
