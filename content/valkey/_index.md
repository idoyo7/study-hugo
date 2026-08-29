---
title: "Valkey"
weight: 130
cascade:
  type: docs
---

# Valkey — 같은 방에서 15분 간격으로 갈린 두 아키텍처

이 도메인은 [KubeCon + CloudNativeCon Europe 2026](https://www.cncf.io/blog/2025/08/05/kubecon-cloudnativecon-europe-2026-returning-to-amsterdam-23-26-march/) Hall 8 | Room E에서 연달아 열린 두 세션에서 출발합니다. 11:00에 AWS ElastiCache 팀이 [*Scaling Valkey the Right Way: Kubernetes at XL Scale*](https://kccnceu2026.sched.com/event/2CW5d)로 노드 2,000대짜리 Valkey Cluster를 말했습니다. 11:45에 Braze의 Joe Heyburn이 [*Redis on EC2 to Valkey on Kubernetes: A Zero-Downtime Case Study*](https://kccnceu2026.sched.com/event/2CW6D/redis-on-ec2-to-valkey-on-kubernetes-a-zero-downtime-case-study-joe-heyburn-braze)로 Sentinel HA 샤드 581개를 말했습니다. **둘 다 "Valkey를 크게 굴리는 법"인데 거의 모든 지점에서 어긋납니다** — 샤딩을 서버가 하느냐 클라이언트가 하느냐, 장애를 gossip으로 잡느냐 Sentinel quorum으로 잡느냐, 근거가 벤치마크냐 프로덕션이냐.

차이는 **근거의 성격**에서 나옵니다. 앞 세션의 간판 수치인 2,000노드 / 1B RPS는 맨 EC2에서 `taskset` 코어 피닝과 `ethtool` NIC 인터럽트 어피니티로 손튜닝해 잰 값입니다. [서면판 원문](https://valkey.io/blog/1-billion-rps/)에는 Kubernetes·EKS·pod·StatefulSet·container 언급이 한 번도 없습니다. 뒤 세션의 36M ops/sec · 6.6TiB는 2년째 Kubernetes에서 돌고 있는 클러스터의 값입니다. 그래서 Kubernetes를 쓰는 팀이라면 **엔진 사실은 ①에서, 운영 사실은 ②에서** 가져와야 합니다 — 반대로 섞으면 둘 다 틀린 근거가 됩니다.

## 문서 지도

- **[00 두 갈래 — 같은 방, 15분 간격, 정반대 아키텍처]({{< relref "00-두-갈래.md" >}})** · 두 발표 비교 — 어느 질문에 어느 챕터를 펴야 하는지 정합니다. 2,000노드 천장은 대부분에게 오지 않고 Sentinel-on-Kubernetes 문제는 첫 주에 옵니다.
- **[① 2,000노드 Valkey 클러스터 (AWS)]({{< relref "cluster-xl-scale/_index.md" >}})** · EC2 실측 vs Kubernetes 조언 — 간판 수치의 출처를 밝힙니다. 엔진 수정 4건은 전이되지만 코어 피닝·"2,000노드 실증" 그 자체는 전이되지 않습니다.
- **[② Braze Sentinel HA 무중단 이관]({{< relref "braze-k8s-migration/_index.md" >}})** · Kubernetes 프로덕션 2년 — Valkey Cluster를 쓰지 않는 581샤드를 NLB 경유 양방향 replication으로 무중단 이관한 기록. 데이터 손실은 0이었습니다. 그런데 NLB를 상시로 두면 데이터 전송비가 월 $100,000을 넘을 것으로 산정돼 전 클라이언트가 넘어올 때까지 기다렸다가 걷었습니다.
