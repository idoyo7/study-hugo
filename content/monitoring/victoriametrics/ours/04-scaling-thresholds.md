---
title: "스케일링·용량 기준치"
weight: 4
---

# 04 · 스케일링·용량 기준치

{{< callout type="info" >}}
**한눈에**
- 디스크 큐 상한 산정식: **`sum(rate(vmagent_remotewrite_bytes_sent_total[1h]))` × 버틸 장애 시간** (실측 후 조정). 현행 stage `1000MiB` / prod `2000MiB`.
- vmagent 리소스는 현행값을 기준치로 두되 **실측 후 조정**을 남긴다(TODO).
- **HA(`replicaCount: 2`)는 의도적 미적용** — replica가 각자 전량 전송해 cross-cluster 트래픽이 2배가 되고, dedup은 저장만 절약하므로 전송 절감 목표와 상충한다.
- **slow insert 지속 10% 초과 = 메모리 부족 경고** (D2 계승) → [실전 01 카디널리티]({{< relref "../practice/01-cardinality.md" >}}).
{{< /callout >}}

큐 상한·리소스·HA·메모리 임계를 어떤 근거로 잡는지 정리한다. 확정 숫자보다 **판단 기준과 산정식**에 무게를 둔다 — 실제 값은 실측으로 조정한다.

> 관련 문서: [02 vmagent 전송 튜닝]({{< relref "02-vmagent-transport-tuning.md" >}}) · [03 자기감시 메트릭]({{< relref "03-self-monitoring-metrics.md" >}}) · [실전 01 카디널리티]({{< relref "../practice/01-cardinality.md" >}}) · [우리의 운영 허브]({{< relref "_index.md" >}})

## ① 디스크 큐 상한 산정식

`maxDiskUsagePerURL`은 "링크 장애가 나도 몇 시간치 지표를 큐에 버틸 수 있게 할 것인가"로 잡는다.

```
maxDiskUsagePerURL ≈ sum(rate(vmagent_remotewrite_bytes_sent_total[1h])) × 버틸 장애 시간
```

즉 **평시 전송 바이트레이트 × 목표 버팀 시간**이다. 링크가 끊긴 동안 이 큐가 지표를 붙잡아 두고, 복구되면 다시 흘려보낸다. 상한을 넘기면 오래된 블록부터 버린다(→ drop 동작은 [02]({{< relref "02-vmagent-transport-tuning.md" >}})).

| 환경 | 현행값 | 근거 |
|------|--------|------|
| stage | `1000MiB` | 500MiB 배수, 낮은 트래픽 |
| prod | `2000MiB` | 500MiB 배수, 위 산정식 기준 (버틸 시간 **실측 후 조정**) |

평시 바이트레이트는 [03]({{< relref "03-self-monitoring-metrics.md" >}})의 `bytes_sent`로 실측한다. 목표 버팀 시간을 확정하면 이 표의 값도 그에 맞춰 조정한다(TODO).

## ② vmagent 리소스 기준치

현행값을 기준선으로 둔다. 실사용량을 관찰해 조정한다.

| 환경 | requests | limits | 비고 |
|------|----------|--------|------|
| stage | cpu `500m` / mem `500Mi` | mem `1500Mi` | — |
| prod | cpu `100m` / mem `150Mi` | cpu `2` / mem `1000Mi` | 2 계열(용도별 분리) |

> **TODO(실측 후 조정)**: 실제 CPU·메모리 사용량과 스크랩 대상 수를 관찰해 requests/limits를 맞춘다. vmagent 메모리는 활성 시계열 수·스크랩 크기에 좌우되므로, 카디널리티가 늘면 함께 올려야 한다.

## ③ HA(`replicaCount: 2`) — 의도적 미적용

vmagent를 2벌로 띄우면 가용성은 오르지만, 전송 절감 목표와 정면으로 부딪힌다.

- **replica가 각자 전량을 전송한다.** vmagent HA는 2벌이 같은 타깃을 스크랩해 각자 remote_write 하는 구조라, **cross-cluster 전송 트래픽이 2배**가 된다.
- **dedup은 저장만 절약한다.** 중복은 수신측/쿼리 시점 dedup으로 제거되지만(→ [개념 03 수집]({{< relref "../concepts/03-ingestion.md" >}})), 그건 **저장 용량** 이야기일 뿐 **전송량**은 이미 2배로 나간 뒤다.

Phase 1의 목표가 전송 안정화·절감(zstd 고정, 큐 상한)인데 HA는 전송을 2배로 늘리므로 **의도적으로 미적용**한다. 가용성 요구가 절감보다 우선하는 상황이 명확해지면 그때 별도로 판단한다.

## ④ slow insert 임계 — 메모리 부족 경고

수신측 관점의 용량 신호다. **slow insert rate가 지속적으로 10%를 넘으면**, 현재 활성 시계열 수에 비해 메모리가 부족하다는 경고다. TSID 캐시가 메모리에 다 담기지 못해 IndexDB 폴백이 잦아진다는 뜻이다. 이 지표와 churn rate의 원리·임계 근거는 D2 개념을 그대로 계승한다 → [실전 01 카디널리티]({{< relref "../practice/01-cardinality.md" >}}).
