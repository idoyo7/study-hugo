---
title: "② Sentinel HA 581샤드를 Kubernetes로 (Braze)"
date: 2026-08-06
lastmod: 2026-08-24
weight: 2
---

# ② Sentinel HA 581샤드를 Kubernetes로 (Braze)

이 챕터는 [Joe Heyburn](https://kccnceu2026.sched.com/event/2CW6D/redis-on-ec2-to-valkey-on-kubernetes-a-zero-downtime-case-study-joe-heyburn-braze)(Braze)가 KubeCon + CloudNativeCon Europe 2026에서 발표한 *Redis on EC2 to Valkey on Kubernetes: A Zero-Downtime Case Study* 세션을 다룹니다. 앞 세션과 같은 방에서 바로 다음 순서로 이어졌습니다. 자매 챕터 [① 2,000노드 Valkey 클러스터]({{< relref "../cluster-xl-scale/_index.md" >}})가 EC2 벤치마크(1B RPS, 짧은 측정 구간)였다면 이 챕터는 반대편입니다 — 2023년 2월부터 2024년 5월까지 Kubernetes 이관을 마치고 그 뒤로도 계속 돌아간 **프로덕션 실적**입니다.

토폴로지도 다릅니다. AWS 발표가 gossip·16384 슬롯의 단일 거대 클러스터를 말했다면 Braze는 Valkey Cluster를 아예 쓰지 않습니다. **Sentinel 기반 HA 샤드 581개**를 독립적으로 굴립니다. 샤딩은 서버가 아니라 클라이언트 쪽 해싱이 담당합니다. 그렇게 돌아가는 규모는 **36M ops/sec**, 메모리 총량 **6.6TiB** — 벤치마크가 아니라 실운영 수치입니다.

이관 과정이 이 챕터의 소재입니다. Kubernetes에서는 Sentinel이 파드마다 사이드카로 붙어 그 샤드만 감시합니다. 파드가 롤되면 IP가 바뀌어 Sentinel에 stale replica가 쌓입니다. 그런데 ClusterIP는 클러스터 밖에서 접근이 안 되니 EC2 쪽 primary가 k8s 파드를 복제할 방법이 없습니다 — 이걸 무중단으로, 게다가 롤백 시 데이터 손실 없이 풀어야 했습니다. 해법은 AWS NLB를 경유한 양방향 replication입니다. 이관 기간에는 Sentinel이 6대(EC2 3 + k8s 3)로 늘어나 split-brain이 생기는데, 7번째 Sentinel과 quorum 5로 막습니다.

| 문서 | 한 줄 요약 |
|------|-----------|
| [01 무중단 이관]({{< relref "01-무중단-이관/index.md" >}}) | NLB 경유 양방향 replication, replica-announce, Sentinel split-brain과 quorum 5 대응, Kubernetes 이관 274샤드와 Valkey 전환 350샤드 |
| [02 발표 전사]({{< relref "02-발표-전사/index.md" >}}) | 부록 · 원문 대조용 — 01의 판정 근거를 초 단위로 재검증하는 원본 전사 |

자매 챕터: [① 2,000노드 Valkey 클러스터 (AWS)]({{< relref "../cluster-xl-scale/_index.md" >}}) · 두 발표를 맞붙인 비교는 [두 갈래]({{< relref "../00-두-갈래.md" >}}).
