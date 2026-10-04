---
title: "격리 런타임"
date: 2026-09-14
lastmod: 2026-09-14
weight: 40
comments: false
cascade:
  type: docs
url: "/isolation/"
linkTitle: "격리 런타임"
---

# 격리 런타임 — 컨테이너 아래 경계를 한 겹 더 깔 때

## 이 분류에서 찾기 {#section-navigation}

- [01 경계와 위협 모델]({{< relref "/platform/isolation/01-boundaries/index.md" >}})
- [02 Kata Containers]({{< relref "/platform/isolation/02-kata/index.md" >}})
- [03 gVisor]({{< relref "/platform/isolation/03-gvisor/index.md" >}})
- [04 KubeVirt]({{< relref "/platform/isolation/04-kubevirt/index.md" >}})
- [05 성능 실측]({{< relref "/platform/isolation/05-performance/index.md" >}})
- [06 판단]({{< relref "/platform/isolation/06-decision/index.md" >}})

runc는 namespace와 cgroup으로 컨테이너를 나누지만, 같은 노드에서 runc로 실행하는 파드는 호스트 커널을 공유합니다. 이 공유를 줄이려고 VM이나 유저스페이스 커널을 추가하면 격리 경계와 함께 실행 경로도 달라집니다. Kata Containers, gVisor, KubeVirt를 선택하려면 그 경계가 막는 위협과 워크로드가 부담할 비용을 함께 봐야 합니다.

격리를 한 겹 추가하는 결정은 계산을 없애지 않습니다. 계산이 지나가는 경로를 늘리고, 그 경로마다 값을 매깁니다.

[런타임]({{< relref "/engineering/runtime/_index.md" >}}) 챕터가 일이 어디로 옮겨가는지 다뤘다면, 여기서는 격리 경계가 생기는 위치와 그에 따른 비용을 비교합니다. 비교 근거는 측정 조건이 서로 다른 벤치마크에 흩어져 있어, 수치와 조건을 함께 모았습니다.

## 문서 지도

경계와 위협 모델부터 확인하려면 01, 실측 수치가 필요하면 05, 시나리오별 선택을 검토하려면 06부터 읽으셔도 됩니다.

| 문서 | 다루는 것 |
|---|---|
| [01 경계와 위협 모델]({{< relref "/platform/isolation/01-boundaries/index.md" >}}) | 세 물건이 경계를 긋는 위치, Kata의 위협 모델과 2026년 CVE 현황 |
| [02 Kata Containers]({{< relref "/platform/isolation/02-kata/index.md" >}}) | Kata의 구조, VMM 선택, VM 크기 산정, 운영 비용 체크리스트 |
| [03 gVisor]({{< relref "/platform/isolation/03-gvisor/index.md" >}}) | Sentry·Gofer 구조, 호환성, 보안 실적, GKE Sandbox |
| [04 KubeVirt]({{< relref "/platform/isolation/04-kubevirt/index.md" >}}) | 파드-VM 구조, 스토리지·네트워킹 계약, 오버헤드, 채택 현황 |
| [05 성능 실측]({{< relref "/platform/isolation/05-performance/index.md" >}}) | CPU·메모리·시스템콜·IO·네트워크·기동·밀도 11개 축의 실측 |
| [06 판단]({{< relref "/platform/isolation/06-decision/index.md" >}}) | Kata vs KubeVirt 겹치는 자리, 시나리오별 선택, 확인하지 못한 것 |

## 비교할 때 함께 볼 조건

- 경계의 위치와 공격 표면. runc는 호스트 커널을 공유하고, gVisor는 유저스페이스에서 syscall을 재구현하며, Kata·KubeVirt는 VM을 세운다. VM 경계에는 하이퍼바이저와 virtio 장치라는 새 공격 표면도 따른다.
- 경계를 건너는 빈도와 워크로드 크기. 모은 실측에서 CPU와 메모리 대역폭은 세 접근 모두 오차범위 안이며, 비용은 경계를 건너는 빈도에 붙는다. 워크로드 크기와 무관한 고정 오버헤드는 작은 파드를 많이 띄울수록 상대 부담이 커진다.
- 수치가 측정된 조건. 조건이 다르면 벤치마크 결과를 같은 막대에 올려 비교할 수 없다. 부팅 시간도 논문마다 측정 구간을 다르게 잡는다.
