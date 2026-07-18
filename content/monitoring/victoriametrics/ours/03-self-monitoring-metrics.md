---
title: "자기감시 메트릭"
weight: 3
---

# 03 · 우리가 보는 자기감시 메트릭

{{< callout type="info" >}}
**한눈에**
- 전송 상태는 네 지표로 본다 — **retries**(재시도), **packets_dropped**(드랍), **bytes_sent**(전송량), **pending_data_bytes**(대기 큐).
- **bytes_sent**는 `forceVMProto` 효과 판정에 쓴다 — 적용 후 뚝 떨어지면 여태 snappy였던 것, 그대로면 이미 zstd였던 것. **둘 다 정상**이다.
- **pending_data_bytes**가 평시 0 근처를 벗어나 **지속 증가하면 목적지 병목** 신호다.
- 카디널리티 감시(**churn rate · slow insert**)는 D2 개념을 계승한다 → [실전 01 카디널리티]({{< relref "../practice/01-cardinality.md" >}}). 인벤토리는 vmui + `metric_names_stats`로 뽑는다.
{{< /callout >}}

Phase 1 적용이 잘 됐는지, 전송이 건강한지를 판정하는 자기감시(self-monitoring) 메트릭을 정리한다. [02]({{< relref "02-vmagent-transport-tuning.md" >}})의 적용 후 확인이 여기로 이어진다.

> 관련 문서: [02 vmagent 전송 튜닝]({{< relref "02-vmagent-transport-tuning.md" >}}) · [실전 01 카디널리티]({{< relref "../practice/01-cardinality.md" >}}) · [04 스케일링·용량 기준치]({{< relref "04-scaling-thresholds.md" >}}) · [우리의 운영 허브]({{< relref "_index.md" >}})

## 전송 상태 4지표

| 메트릭 | 무엇을 말하나 | 정상 기준 | 이상 시 의미 |
|--------|--------------|-----------|--------------|
| `vmagent_remotewrite_retries_count_total` | 전송 재시도 횟수 | `rate(...[5m])` ≈ 0 유지 | 값이 오르면 목적지가 불안정하거나 write가 반복 실패 중 |
| `vmagent_remotewrite_packets_dropped_total` | 버려진 패킷 수 | `increase(...[1h])` = 0 유지 | 0이 아니면 데이터가 실제로 유실됨 (큐 상한 초과·포맷 거부 등) |
| `vmagent_remotewrite_bytes_sent_total` | URL별 전송 바이트 | 안정적 추세 | `forceVMProto` 효과 판정용 (아래 참고) |
| `vmagent_remotewrite_pending_data_bytes` | 아직 못 보낸 대기 큐 크기 | 평시 0 근처 | **지속 증가 = 목적지 병목** (큐가 계속 쌓임) |

### PromQL 예제

```promql
# ① 재시도 — 0 근처 유지
rate(vmagent_remotewrite_retries_count_total[5m])

# ② 드랍 — 0 유지 (0이 아니면 유실 발생)
increase(vmagent_remotewrite_packets_dropped_total[1h])

# ③ URL별 전송량 — forceVMProto 효과 판정
sum(rate(vmagent_remotewrite_bytes_sent_total[10m])) by (url)

# ④ 대기 큐 — 지속 증가하면 목적지 병목
vmagent_remotewrite_pending_data_bytes
```

### `bytes_sent`로 `forceVMProto` 효과 판정

`forceVMProto` 적용 전후로 URL별 전송량을 비교한다.

- **뚝 떨어짐** → 여태 snappy로 나가고 있었다는 뜻. zstd 고정으로 절감이 확정됐다.
- **그대로** → 이미 zstd였다는 뜻. 이번 변경은 다운그레이드 방지 보장만 추가한 것이다.

**둘 다 정상**이다. 떨어지면 절감 효과를 얻은 것이고, 그대로면 원래 최적이었던 것을 고정한 것이다. 나빠질 시나리오는 없다.

## 카디널리티 감시 — D2 개념 계승

전송 지표와 별개로, **수집하는 시계열 자체의 건강**도 봐야 한다. 원리는 D2 발표에서 정리한 그대로다 — **churn rate**(24시간 내 신규 시계열 생성 속도)와 **slow insert rate**(지속 10% 초과 시 메모리 부족 경고)가 핵심이다. 개념과 임계의 근거는 [실전 01 카디널리티]({{< relref "../practice/01-cardinality.md" >}})에서 다룬다. slow insert 임계의 운영 적용은 [04]({{< relref "04-scaling-thresholds.md" >}})에도 정리했다.

### 인벤토리 도구

지금 어떤 지표가 카디널리티를 먹고 있는지는 다음으로 뽑는다.

- **vmui 카디널리티 익스플로러** — `/vmui/#/cardinality`
- **메트릭 이름별 통계 API** — `/api/v1/status/metric_names_stats`

이 인벤토리로 무엇을 drop/keep 할지는 **실측 후 결정 예정**이다(TODO). 규칙을 성급하게 넣기보다 실제 분포를 본 뒤 정한다.
