---
title: "Kubernetes"
weight: 9
cascade:
  type: docs
---

# Kubernetes — 공식 문서 너머의 실사용 판단

> 공식 문서와 릴리스 블로그는 "무엇이 있다"까지만 말해주고, **"우리 클러스터에서 지금 써도 되는가"** 는 말해주지 않는다. 이 챕터는 운영에 실제로 영향을 주는 Kubernetes 주제를 골라, 설명에 그치지 않고 **구현이 실제로 하는 일·리포팅된 버그·케이스별 득실**까지 내려가 "쓸지 말지, 쓴다면 어디에"를 판단할 수 있는 수준으로 정리한다.

> 자매 챕터: [EKS 업그레이드]({{< relref "../eks-upgrade/_index.md" >}}) — 그쪽이 "버전을 **어떻게** 올리나"라면, 이쪽은 "올리고 나서 **무엇을** 얻나"에 가깝다.

## 왜 이걸 정리하는가

GA(stable) 딱지는 "API가 안 바뀐다"는 약속이지 "당신의 워크로드에 안전하다"는 약속이 아니다. GA 직후에도 이슈 트래커에는 열린 버그가 남아 있고, 기능의 전제(cgroup 버전, 런타임 버전, 언어 런타임의 동작)가 안 맞으면 기대한 효과가 안 나온다. 반대로 **커널에는 5년 전에 들어갔는데 Kubernetes 표면이 없어서 못 쓰는** 경우도 있다.

그래서 어느 쪽이든 결국 세 가지를 봐야 한다 — **무엇이 구현됐고 무엇이 빠졌나, 누가 어떤 버그를 밟았나, 내 워크로드 유형에서 득인가 실인가.** 이 챕터의 문서들은 그 세 질문에 답하는 형식으로 쓴다.

## 참고 — 최근 버전 타임라인

| 버전 | 릴리스 | 대표 신기능 |
|---|---|---|
| **1.33** "Octarine" | 2025-04 | 사이드카 컨테이너 **GA** · in-place pod resize **beta**(기본 활성화) · DRA beta |
| **1.34** "Of Wind & Will" | 2025-08 | DRA 코어 **GA** · Pod-level resources beta · ServiceAccount 토큰 이미지 풀 |
| **1.35** "Timbernetes" | 2025-12 | **in-place pod resize GA** · Pod Certificates beta |
| **1.36** "Haru" | 2026-04 | Pod-level 리소스의 in-place resize beta · Pod-level Resource Managers alpha |

## 문서 지도

- **[01 In-Place Pod Resize]({{< relref "01-inplace-pod-resize.md" >}})** · k8s 1.35 GA — 파드 재시작 없이 CPU/메모리를 바꾼다. 구현 코드가 실제로 하는 일, 열린 버그, 케이스별 득실.
- **[02 CPU Throttling]({{< relref "02-cpu-throttling.md" >}})** · 모든 k8s · CFS — limit을 다 쓰지도 않았는데 잘린다. CPU wait이 APM 지연으로 번지는 경로, 다중코어에서 더 잘리는 이유, limit 제거와 CPU Manager.
- **[03 CPU Burst]({{< relref "03-cpu-burst.md" >}})** · 커널 5.14+ · k8s WIP — CPU limit을 지키면서 불필요한 throttling만 걷어낸다. 누적 상한 불변의 증명, 이웃 간섭의 정량화, k8s 표면 부재.
- **[04 Node Problem Detector]({{< relref "04-node-problem-detector.md" >}})** · 모든 k8s · DaemonSet 애드온 — 노드 문제를 탐지해 NodeCondition·Event로 보고한다. 조치는 remedy system 몫이고, EKS엔 `eks-node-monitoring-agent` + node auto repair라는 관리형 대안이 있다.
- **[05 DaemonSet 미기동 노드 격리]({{< relref "05-daemonset-gap-isolation.md" >}})** · 모든 k8s — DS가 안 뜬 노드에도 워크로드는 내려앉는다. 노드별 갭 탐지, cordon이 DS를 못 막는 이유, startup taint(선제)와 탐지→taint(반응) 두 전략.

이 챕터는 **쿠버네티스 코어 기능과 SIG가 관리하는 코어 인접 컴포넌트**를 다룬다. 생태계 컴포넌트 중 성격이 같은 주제 — 공식 문서가 "가장 싼 인스턴스를 고른다"까지만 말하고 멈추는 자리에서 정렬·절단·부등식이 실제로 무엇을 하는지 소스로 내려가는 이야기 — 는 자매 챕터 [Karpenter]({{< relref "../karpenter/_index.md" >}})가 소유한다.

## 공통 핵심

- **GA는 시작점이지 종착점이 아니다.** in-place resize도 GA 시점에 메모리 축소의 OOM 방지가 best-effort로 남았고, 관련 이슈가 열려 있다. → [01]({{< relref "01-inplace-pod-resize.md" >}})
- **커널에 있다고 쓸 수 있는 게 아니다.** CPU Burst는 5.14에 들어갔지만 Pod spec으로 켜는 표면이 없어서 노드를 직접 만지거나 벤더 annotation에 기대야 한다. → [03]({{< relref "03-cpu-burst.md" >}})
- **지표는 겹쳐 읽어야 보인다.** CPU 사용률만 보면 "여유로운데 잘리는" 상태가 아예 관측되지 않는다. 그래프에 안 나타나는 것과 문제가 없는 것은 다르다. → [02]({{< relref "02-cpu-throttling.md" >}})
- **기능의 전제를 먼저 확인한다.** cgroup 버전은 맞는가, 컨테이너 런타임 버전은 충분한가, 언어 런타임(JVM 힙 같은)이 커널 레벨 변경을 인지하는가 — 전제가 안 맞으면 기능은 켜져도 효과가 없다.
- **케이스별로 갈린다.** 같은 기능이 stateful 워크로드에는 구원이고 JVM 힙에는 반쪽이다. "좋은 기능인가"가 아니라 "**우리 어떤 워크로드에** 좋은가"로 묻는다.
- **선언한 것과 실행되는 것은 다르다.** NodePool에 인스턴스 타입을 나열해도 무엇이 뜰지는 그 목록이 아니라 정렬·절단·할당 전략이 정한다. 의도를 매니페스트에 적었다고 의도대로 도는 게 아니다. → [Karpenter]({{< relref "../karpenter/_index.md" >}})
