---
title: "① 2,000노드 Valkey 클러스터 (AWS)"
weight: 1
comments: false
---

# ① 2,000노드 Valkey 클러스터 (AWS)

이 챕터는 [KubeCon + CloudNativeCon Europe 2026 세션](https://kccnceu2026.sched.com/event/2CW5d) *Scaling Valkey the Right Way: Kubernetes at XL Scale*(Sarthak Aggarwal · Madelyn Olson, AWS ElastiCache) 한 편을 다룹니다. 발표에 따르면 Valkey cluster 모드는 2,000노드·1B RPS까지 올라갑니다. 거기까지 가는 동안 실제로 부러진 곳이 네 곳 있었습니다 — 재접속 폭풍, failure report O(N), 투표 분열, pub/sub 헤더. 부러진 자리마다 업스트림 PR을 함께 보여줍니다.

제목은 "Kubernetes at XL Scale"이지만 간판 수치인 2,000노드 / 1B RPS는 Kubernetes에서 잰 게 아닙니다. [valkey.io 블로그](https://valkey.io/blog/1-billion-rps/) 원문에 Kubernetes·EKS·pod·StatefulSet·container 언급이 한 번도 없습니다. 실측에 쓴 인스턴스는 클러스터 노드 `r7g.2xlarge`, 부하 생성기 `c7g.16xlarge` 750대입니다. 튜닝도 손으로 잡았습니다 — `taskset`·`cset` 코어 피닝, `ethtool` NIC 인터럽트 어피니티. Kubernetes 위에서는 하기 까다롭거나 아예 안 하는 것들입니다. 발표자 본인도 도입부에서 "we come from Amazon, which is mostly a VM based world"라고 밝힙니다.

그렇다고 Kubernetes가 발표에서 빠진 건 아닙니다. 역할이 다릅니다. 엔진 층위의 한계와 그 수정 4건은 **EC2 실측**이고 인프라를 가리지 않으므로 그대로 Kubernetes에도 전이됩니다. StatefulSet 배치, headless service 부트스트랩, "CPU limit은 걸지 마라" 같은 Kubernetes 조언은 실측이 아니라 두 AWS 엔지니어의 **경험칙**입니다. 이 챕터의 01 문서는 그 둘을 등급별로 나눕니다.

두 발표자는 전원 AWS ElastiCache 소속입니다. Valkey 자체는 Linux Foundation 산하 벤더 중립 BSD-3 프로젝트지만 이 발표의 수치는 AWS가 AWS 하드웨어에서 잰 것이라는 편향을 01 문서 전체에서 명시합니다.

| 문서 | 한 줄 요약 |
|------|-----------|
| [01 부러지는 것]({{< relref "01-부러지는-것/index.md" >}}) | EC2 실측 vs Kubernetes 조언 등급 판정 — 엔진 수정 4건은 전이, 코어 피닝·"2,000노드 실증"은 비전이 |
| [02 발표 전사]({{< relref "02-발표-전사/index.md" >}}) | 부록 · 원문 대조용 — 01의 판정 근거를 초 단위로 재검증하는 원본 전사 |

자매 챕터: [② Braze Sentinel HA 무중단 이관]({{< relref "../braze-k8s-migration/_index.md" >}}) · 두 발표를 맞붙인 비교는 [두 갈래]({{< relref "../00-두-갈래.md" >}}).
