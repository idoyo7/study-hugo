---
title: "Ambient mode 도입기 (채널코퍼레이션)"
description: "채널코퍼레이션이 8개월에 걸쳐 Ambient mode를 프로덕션에 올린 기록 6편을 요약합니다. 4,000파드·240Gi 메모리 계산과 노드·namespace 단위로 커진 장애 격리 대가를 다룹니다."
date: 2026-07-28
lastmod: 2026-08-24
weight: 20
comments: false
---

# Ambient mode 도입기 — 채널코퍼레이션이 사이드카를 건너뛴 기록 (2026-03 ~ 2026-07)

{{< callout type="info" >}}
**참조한 내용정리**

여기 실린 문서는 모두 요약입니다. 채널코퍼레이션 기술 블로그(tech.channel.io)의 아래 원문 6건을 읽고 이 지식베이스 형식으로 다시 묶었습니다. **원문 자체가 아니며** 정확한 워딩·전체 맥락·원문에 실린 그림과 config 덤프 전문은 각 링크에서 확인합니다.

- [Istio 1편: 왜 Istio Ambient mode인가?](https://tech.channel.io/kr/articles/tech-istio-ambient-mode-30cdf79a) · 2026-03-20
- [Istio 2편: Envoy config로 해부하는 Ambient mode](https://tech.channel.io/kr/articles/tech-istio-envoy-config-c5193569) · 2026-04-14
- [Istio 3-1편: 503과 Half-open Connection](https://tech.channel.io/kr/articles/ambient-mode-troubleshooting-1-82576790) · 2026-06-26
- [Istio 3-2편: Partially Enrolled Pod와 Untaint Controller](https://tech.channel.io/kr/articles/ambient-mode-troubleshooting-2-1f761f31) · 2026-07-02
- [Istio 3-3편: Ambient mode 안전하게 업그레이드하기](https://tech.channel.io/kr/articles/tech-istio-cni-in-place-b004fdb9) · 2026-07-08
- [Istio 3-4편: 507 status code와 istiod disconnected 탐지](https://tech.channel.io/kr/articles/tech-507-istiod-disconnected-e92ce438) · 2026-07-13
{{< /callout >}}

{{< callout type="info" >}}
- 채널코퍼레이션 DevOps팀이 2025년 3월부터 11월까지 약 8개월을 들여 서비스 메시를 처음 올렸습니다. 성숙한 Sidecar mode를 지나치고 Istio 1.24에서 GA된 **Ambient mode를 첫 대상으로 골랐습니다**.
- 결정의 무게추는 **약 4,000개 파드**였습니다. 프록시 개수가 파드 개수에 1:1로 묶이는 구조라 전부 사이드카를 붙이면 idle 상태에서만 약 240Gi 메모리가 프록시로 나갑니다.
- 대가로 장애 격리 단위가 커집니다. 사이드카는 장애 범위가 파드 하나였지만 ztunnel은 노드 전체, waypoint는 namespace 전체입니다. 팀이 잡은 기준은 문제 발생 빈도가 아니라 **장애 복구 속도와 나중에 다시 갈아엎지 않아도 되는 쪽**이었습니다.
- 프로덕션에서 터진 것은 전부 **프록시가 파드 밖으로 나가면서 생긴 타이밍 문제**입니다 — 죽은 Pod의 HBONE 터널을 재사용해 터지는 503, istio-cni보다 먼저 뜬 파드(partially enrolled), 노드 단위가 되어 버린 업그레이드 카나리, 그리고 xDS 단절을 못 잡는 readinessProbe.
- 사이드카 비용이 빠진 자리에는 새 운영 축이 들어섰습니다. **노드 라이프사이클과 메시 데이터플레인 준비를 서로 맞추는 일**입니다. 청구서가 사라진 게 아니라 항목이 바뀌었습니다.
{{< /callout >}}

## 왜 이 섹션이 상위 Istio 챕터와 따로 있는가

이 레포의 [상위 Istio 챕터]({{< relref "../_index.md" >}}) 01~09편은 전부 **Sidecar mode를 전제로 쓰인 운영기**입니다. 파드마다 Envoy가 붙습니다. istiod는 그 프록시 전부에 xDS를 밀어 넣고 게이트웨이는 전용 노드로 빠집니다. 5xx가 나면 게이트웨이 → 사이드카 → 앱 순으로 hop을 좁혀 갑니다. 이 `ambient/` 섹션은 그 전제를 바꾼 외부 팀(채널코퍼레이션)의 프로덕션 기록입니다. 우리 환경이 아니라 남의 사례라서 따로 뒀습니다. 같은 문제를 다른 아키텍처로 푼 **대조군**으로 읽습니다. 컨트롤 플레인 부하·데이터 플레인 비용·장애 추적은 양쪽이 똑같이 마주합니다. 출발점은 다릅니다 — 사이드카 모드는 "파드당 프록시 하나"라는 전제에서, Ambient는 "노드당 ztunnel 하나 + 필요한 곳에만 waypoint"라는 전제에서 답을 찾습니다.

## 문서 지도

- **[01 왜 Ambient mode인가]({{< relref "01-why-ambient-mode.md" >}})** · 2026-03 · 의사결정 — 4,000 파드·240Gi라는 계산과 polynomial scaling problem, 그리고 SPoF를 감수한 이유
- **[02 Envoy config로 해부하는 Ambient mode]({{< relref "02-envoy-config-anatomy.md" >}})** · 2026-04 · 기술 해부 — 클러스터 하나가 endpoint 메타데이터를 따라 세 갈래로 갈립니다 · HBONE은 Envoy 부품 세 개의 조합입니다
- **[03-1 503과 Half-open Connection]({{< relref "03-1-503-half-open-connection.md" >}})** · 2026-06 · 장애 추적 — waypoint가 `IP:Port`만을 키로 죽은 Pod의 HBONE 터널을 재사용합니다
- **[03-2 Partially Enrolled Pod와 Untaint Controller]({{< relref "03-2-partially-enrolled-untaint-controller.md" >}})** · 2026-07 · 장애 추적 — Running·Ready인데 메시 밖 — kube-scheduler는 DaemonSet 준비를 기다리지 않습니다
- **[03-3 Ambient 안전하게 업그레이드하기]({{< relref "03-3-ambient-upgrade-in-place.md" >}})** · 2026-07 · 운영 런북 — istiod → istio-cni → ztunnel 순서, ztunnel만은 node pool blue-green
- **[03-4 507과 istiod disconnected 탐지]({{< relref "03-4-507-istiod-disconnected.md" >}})** · 2026-07 · 부록 2건 — retry가 만든 보이지 않는 1MB 상한 · 사후 xDS 단절을 못 잡는 readinessProbe

## 읽는 순서

- **사이드카에서 넘어올 계획이면** [10 Ambient 이행 심사]({{< relref "../10-ambient-migration-questions.md" >}})를 먼저 봅니다. 이 섹션은 사이드카를 거치지 않은 그린필드 기록이라 "버리고 오는 쪽"의 비용이 빠져 있습니다.
- **처음이라면** 01부터 읽습니다. 왜 사이드카를 건너뛰었는지, 그 대가로 무엇을 받아들였는지가 나머지 다섯 편의 전제입니다. ztunnel · waypoint · HBONE · istio-cni라는 용어도 여기서 잡힙니다.
- **개념까지만 필요하면** 01에서 멈춰도 됩니다. 02는 Envoy config 덤프를 필드 단위로 따라가는 문서라 밀도가 가장 높습니다. 03-1의 커넥션 pool 문제와 03-4의 `xds-grpc` cluster를 이해하려면 02를 먼저 읽어야 합니다.
- **장애 대응 관점이면** 03-1 → 03-2 순서로 봅니다. 03-1은 이미 메시에 들어온 커넥션의 수명 문제이고 03-2는 애초에 메시에 못 들어온 파드의 문제입니다. 증상은 둘 다 5xx지만 원인 계층이 다릅니다.
- **Ambient를 이미 운영 중이라면** 03-3(업그레이드)과 03-4(탐지)가 실무 직결입니다. 특히 03-4의 두 사례는 원문이 Ambient 고유 문제가 아니라고 밝혔으니 사이드카 모드 운영자에게도 적용됩니다.
- 시간순 01 → 02 → 03-1 → 03-2 → 03-3 → 03-4가 원문 시리즈의 순서이자 채널팀이 실제로 겪은 순서입니다.

## 사이드카 모드와 대조해서 읽기

같은 문제를 상위 챕터(Sidecar mode)와 이 섹션(Ambient mode)이 각각 어떻게 다루는지 짝지어 둡니다.

- **메시의 비용 구조**
  - 상위 챕터 (Sidecar mode): [01 서비스 메시와 Istio 기초]({{< relref "../01-mesh-basics.md" >}}) — 파드마다 붙는 프록시가 CPU·메모리·지연을 더합니다
  - 이 섹션 (Ambient mode): [01 왜 Ambient mode인가]({{< relref "01-why-ambient-mode.md" >}}) — 프록시 개수를 파드 수에서 노드 수로 옮깁니다
- **컨트롤 플레인 부하**
  - 상위 챕터 (Sidecar mode): [02 컨트롤 플레인 해부: istiod]({{< relref "../02-istiod-control-plane.md" >}}) — 설정 범위를 좁혀 push 부하를 줄입니다
  - 이 섹션 (Ambient mode): [01]({{< relref "01-why-ambient-mode.md" >}}) — polynomial scaling problem의 분모(프록시 수) 자체를 줄입니다
- **xDS 커넥션**
  - 상위 챕터 (Sidecar mode): [09 istiod 스케일링과 xDS 커넥션 재분배]({{< relref "../09-istiod-scaling-connections.md" >}}) — 장수 gRPC는 스케일아웃해도 재분배되지 않습니다
  - 이 섹션 (Ambient mode): [03-4]({{< relref "03-4-507-istiod-disconnected.md" >}}) — 한 번 끊긴 stream은 스스로 낫지 않아 탐지가 필요합니다
- **데이터 플레인 격리**
  - 상위 챕터 (Sidecar mode): [03 데이터 플레인과 Ingress Gateway]({{< relref "../03-gateway-node-isolation.md" >}}) — 자원 경합을 피하려 게이트웨이를 노드로 뺍니다
  - 이 섹션 (Ambient mode): [03-2]({{< relref "03-2-partially-enrolled-untaint-controller.md" >}}) — 노드가 준비될 때까지 스케줄을 미룹니다(시간 축의 격리)
- **5xx 추적 순서**
  - 상위 챕터 (Sidecar mode): [05 장애 이야기: 간헐적 응답 이상]({{< relref "../05-incident-intermittent-5xx.md" >}}) — 게이트웨이 → 사이드카 → 앱으로 hop을 좁힙니다
  - 이 섹션 (Ambient mode): [03-1]({{< relref "03-1-503-half-open-connection.md" >}}) — 게이트웨이 로그에는 `via_upstream`만 남으므로 waypoint부터 봅니다
- **표준 CRD 밖의 조작**
  - 상위 챕터 (Sidecar mode): [08 EnvoyFilter — 표준 CRD의 탈출구]({{< relref "../08-envoyfilter-extension.md" >}}) — 저수준 Envoy 설정을 직접 패치합니다
  - 이 섹션 (Ambient mode): [02]({{< relref "02-envoy-config-anatomy.md" >}}) — 같은 저수준 부품을 istiod가 정식 경로로 조립해 내려줍니다
- **프록시 업그레이드**
  - 상위 챕터 (Sidecar mode): 워크로드 Pod 전부를 재시작해야 하고 그 롤아웃이 곧 [istiod xDS 부하]({{< relref "../02-istiod-control-plane.md" >}}) 이벤트입니다
  - 이 섹션 (Ambient mode): [03-3]({{< relref "03-3-ambient-upgrade-in-place.md" >}}) — 앱 재시작은 사라지고 노드 DaemonSet 교체가 위험 지점이 됩니다
