---
title: "① 2,000노드 Valkey 클러스터 (AWS)"
weight: 1
---

# ① 2,000노드 Valkey 클러스터 (AWS)

이 챕터는 [KubeCon + CloudNativeCon Europe 2026 세션](https://kccnceu2026.sched.com/event/2CW5d) *Scaling Valkey the Right Way: Kubernetes at XL Scale*(Sarthak Aggarwal · Madelyn Olson, AWS ElastiCache)을 다룬다. 발표는 Valkey cluster 모드가 2,000노드·1B RPS까지 올라간다는 것과 그 과정에서 실제로 부러진 네 곳(재접속 폭풍·failure report O(N)·투표 분열·pub/sub 헤더)을 업스트림 PR과 함께 보여준다.

제목은 "Kubernetes at XL Scale"이지만 간판 수치인 2,000노드 / 1B RPS는 Kubernetes에서 잰 게 아니다. [valkey.io 블로그](https://valkey.io/blog/1-billion-rps/) 원문에 Kubernetes·EKS·pod·StatefulSet·container 언급이 한 번도 없고 실측 인스턴스는 `r7g.2xlarge`(클러스터 노드)와 `c7g.16xlarge`(부하 생성기) 750대다. 튜닝도 `taskset`·`cset` 코어 피닝과 `ethtool` NIC 인터럽트 어피니티를 손으로 잡았다 — Kubernetes 위에서는 하기 까다롭거나 아예 안 하는 것들이다. 발표자 본인도 도입부에서 "we come from Amazon, which is mostly a VM based world"라고 밝힌다.

그렇다고 Kubernetes가 발표에서 빠진 건 아니다. 역할이 다르다 — 엔진 층위의 한계와 그 수정 4건은 **EC2 실측**이고 인프라를 가리지 않으므로 그대로 Kubernetes에도 전이된다. 반면 StatefulSet 배치, headless service 부트스트랩, "CPU limit은 걸지 마라" 같은 Kubernetes 조언은 실측이 아니라 두 AWS 엔지니어의 **경험칙**이다. 이 챕터의 01 문서는 그 둘을 등급별로 가른다.

두 발표자는 전원 AWS ElastiCache 소속이다. Valkey 자체는 Linux Foundation 산하 벤더 중립 BSD-3 프로젝트지만 이 발표의 수치는 AWS가 AWS 하드웨어에서 잰 것이라는 편향을 01 문서 전체에서 명시한다.

| 문서 | 한 줄 요약 |
|------|-----------|
| [01 부러지는 것]({{< relref "01-부러지는-것/index.md" >}}) | EC2 실측 vs Kubernetes 조언 등급 판정 — 엔진 수정 4건은 전이, 코어 피닝·"2,000노드 실증"은 비전이 |
| [02 발표 전사]({{< relref "02-발표-전사/index.md" >}}) | 부록 · 원문 대조용 — 01의 판정 근거를 초 단위로 재검증하는 원본 전사 |

자매 챕터: [② Braze Sentinel HA 무중단 이관]({{< relref "../braze-k8s-migration/_index.md" >}}) · 두 발표를 맞붙인 비교는 [두 갈래]({{< relref "../00-두-갈래.md" >}}).
