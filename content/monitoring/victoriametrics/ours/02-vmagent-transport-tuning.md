---
title: "vmagent 전송 튜닝"
weight: 2
---

# 02 · vmagent 전송 안정화 (Phase 1)

{{< callout type="info" >}}
**한눈에**
- **`remoteWrite.forceVMProto=true`** — 자동 협상을 없애고 VM native protocol(zstd)로 고정한다. '조용한 snappy 다운그레이드'가 사라지므로 전송량 2~4x 절감을 보장한다. 수신측 vminsert **v1.88+** 필요.
- **`remoteWriteSettings.maxDiskUsagePerURL`** — 기본값 0(무제한)이라 링크 장애가 길어지면 노드 디스크가 고갈될 수 있다. 상한 도달 시 오래된 블록부터 FIFO drop. 적용값은 stage `1000MiB` / prod `2000MiB`.
- **대안(미적용) `statefulMode=true`** — 큐를 PVC로 옮기면 유실이 없어집니다. 다만 무상태 원칙의 예외이므로 그 예외를 인정할 때만 택합니다.
- 적용 순서는 **stage 먼저 → 수일 관찰 → prod**. 적용 후 확인은 [03 자기감시 메트릭]({{< relref "03-self-monitoring-metrics.md" >}}).
{{< /callout >}}

Phase 1의 목표는 **전송 안정화**입니다. 손댄 곳은 두 군데입니다 — 전송 프로토콜을 zstd로 고정했고 디스크 큐에 상한을 명시했습니다. 아래에서 각 변경의 근거와 트레이드오프, 적용 순서를 정리합니다.

> 관련 문서: [개념 03 수집]({{< relref "../concepts/03-ingestion.md" >}}) · [03 자기감시 메트릭]({{< relref "03-self-monitoring-metrics.md" >}}) · [04 스케일링·용량 기준치]({{< relref "04-scaling-thresholds.md" >}}) · [우리의 운영 허브]({{< relref "_index.md" >}})

## ① `remoteWrite.forceVMProto=true` — zstd 고정

vmagent와 수신측은 remote_write 프로토콜을 **자동 협상**합니다. 문제는 이 협상이 조건에 따라 **조용히 snappy로 다운그레이드**될 수 있다는 데 있습니다. snappy는 VM native protocol(zstd)보다 압축률이 낮아 전송량이 그만큼 늘어납니다. 아무 에러도 없이 대역폭만 몇 배로 새어 나갈 수 있습니다.

`remoteWrite.forceVMProto: "true"`는 이 협상 자체를 없애고 **VM native protocol(zstd)로 고정**합니다.

- **전송량 2~4x 절감을 보장합니다.** 다운그레이드 여지를 없애므로 항상 zstd로 나갑니다.
- **수신측(vminsert)이 v1.88+ 여야 합니다.** native protocol을 받을 수 있는 최소 버전입니다.
- **문제가 생기면 조용히 새지 않고 write 에러로 즉시 드러난다.** 에러가 나는 동안에도 지표는 디스크 큐가 버퍼링하므로 유실되지 않는다(→ 큐 원리는 [개념 03]({{< relref "../concepts/03-ingestion.md" >}})).

정리하면 "조용한 손해(snappy로 몰래 다운그레이드)"를 "시끄러운 실패(write 에러)"로 바꾸는 설정입니다. 실패는 눈에 보이므로 대응할 수 있습니다.

## ② `maxDiskUsagePerURL` — 디스크 큐 상한

전송이 밀리면 vmagent는 지표를 **디스크 큐**에 쌓아 버팁니다. 유실을 막는 장치입니다. 그런데 이 큐의 기본 상한은 **0 = 무제한**입니다. 링크 장애가 길어지면 큐가 무한히 커져 **노드의 ephemeral 디스크를 고갈**시킬 수 있습니다. vmagent 한 파드가 노드 디스크를 먹어치우면 같은 노드의 다른 워크로드까지 위험해집니다.

그래서 `remoteWriteSettings.maxDiskUsagePerURL`로 큐 상한을 명시합니다.

- 상한에 도달하면 **가장 오래된 블록부터 ~500MB 청크 단위로 FIFO drop**합니다. 최신 데이터를 살리고 오래된 것을 버리는 쪽입니다.
- 값은 **500MiB 배수**를 권장합니다. drop 청크 단위와 맞물리기 때문입니다.
- 현재 적용값: **stage `1000MiB` / prod `2000MiB`**.

무제한을 방치하느니 상한을 명시해 **"디스크 고갈로 노드가 죽는 것"보다 "오래된 지표 일부를 버리는 것"을 택합니다.** 큐 상한을 얼마로 잡을지의 산정식은 [04 스케일링·용량 기준치]({{< relref "04-scaling-thresholds.md" >}})에서 다룹니다.

## ③ 대안 — `statefulMode=true` (미적용)

큐 유실을 아예 없애는 길도 있습니다. vmagent를 **stateful**로 돌리는 것입니다.

- `statefulMode: true`로 두면 operator가 vmagent를 **Deployment → StatefulSet + PVC 큐(`/vmagent_pq`)** 로 전환합니다.
- 이 경우 `maxDiskUsagePerURL`을 **`storage ÷ remoteWrite 수`로 자동 산출**합니다.

파드가 재스케줄돼도 PVC에 남은 큐를 이어받으므로 유실 여지가 더 줄어듭니다. 다만 이는 **무상태 원칙의 예외**입니다. 우리 vmagent는 stateless를 기본으로 두므로 이 전환은 **무상태 예외를 인정할 만한 근거가 있을 때만** 택합니다. 현재는 미적용입니다.

```yaml
# [대안 · 미적용] 무상태 예외를 인정할 때만
# statefulMode: true
# statefulStorage:
#   volumeClaimTemplate:
#     spec:
#       resources:
#         requests:
#           storage: 5Gi
```

## ④ 적용 순서

1. **stage 먼저 적용** → 수일 관찰.
2. 이상 없으면 **prod 적용**.

성급하게 prod부터 건드리지 않습니다. 두 설정 모두 전송 경로를 바꾸므로 위험이 낮은 stage에서 며칠 관찰해 부작용이 없음을 확인한 뒤 올립니다. 적용 후 무엇을 봐야 하는지 — 재시도·드랍·전송량·pending 큐 3~4종 PromQL 체크리스트 — 는 [03 자기감시 메트릭]({{< relref "03-self-monitoring-metrics.md" >}})으로 이어집니다.

## 적용 후 최종 블록 (YAML 발췌)

아래는 stage 예시입니다. prod는 `maxDiskUsagePerURL`을 `2000MiB`로 올리고 리소스를 prod 값으로 바꾸며, `extraArgs`가 두 계열(용도별 분리)에 함께 걸린다는 점만 다릅니다.

```yaml
vmagent:
  spec:
    remoteWrite:
      - url: https://<vminsert-endpoint>/insert/0/prometheus/api/v1/write
        tlsConfig:
          insecureSkipVerify: true
    remoteWriteSettings:
      # 디스크 큐 상한. 기본값 0 = 무제한 → 링크 장애 장기화 시 노드 디스크 고갈 위험.
      # 상한 도달 시 오래된 블록부터 ~500MB 청크 FIFO drop. 500MiB 배수 권장.
      maxDiskUsagePerURL: "1000MiB"
    resources:
      requests:
        cpu: '500m'
        memory: 500Mi
      limits:
        memory: 1500Mi
    scrapeInterval: 30s
    extraArgs:
      promscrape.streamParse: "true"
      promscrape.maxScrapeSize: 24GiB
      # VM native protocol(zstd) 고정 — 조용한 snappy 다운그레이드 방지 (전송 2~4x 절감 보장)
      # 수신측 vminsert v1.88+ 필요. 문제 시 write 에러로 즉시 드러남(디스크 큐가 버퍼링).
      remoteWrite.forceVMProto: "true"
```
