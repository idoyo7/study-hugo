---
title: "Prometheus · Thanos · VictoriaMetrics 조립"
date: 2026-08-30
lastmod: 2026-08-30
weight: 3
---

# Prometheus · Thanos · VictoriaMetrics 조립

{{< callout type="info" >}}
- Prometheus 리텐션은 기간 아니면 용량, 두 축으로만 조절합니다. RAW → 5m → 1h 식의 해상도 축약은 Prometheus 바깥에서 벌어지는 일입니다.
- 그 일을 Thanos Compactor가 맡습니다. 공식 문서는 "다운샘플링은 공간을 아껴주지 않는다"고 명시합니다. 저장 공간 절감은 raw 보존 기간을 짧게 잡을 때만 생깁니다.
- Prometheus에 Thanos를 붙이는 방법은 Sidecar와 Receive, 둘 중 하나입니다. 둘의 차이는 저장 위치보다 연결 방향에 있습니다.
- VictoriaMetrics에는 Sidecar가 붙지 않습니다. 블록 포맷부터 다르기 때문입니다. 남는 접점은 `vmagent → Thanos Receive` 하나인데 그 길을 택하는 순간 VM은 구성에서 빠집니다.
{{< /callout >}}

이 챕터는 "Prometheus 리텐션을 늘리면 되지 않나"라는 질문에서 시작합니다. 거기서 "그러면 Thanos는 왜 필요한가"로, 다시 "VictoriaMetrics로 갈아타도 Thanos를 뒤에 붙일 수 있나"로 이어지는 질문을 한 줄에 세워 놓고 따라갑니다. 컴포넌트 카탈로그가 아니라 조립 방식의 차이를 다룹니다.

> 자매 챕터: [메트릭 장기보관 아키텍처 비교]({{< relref "../longterm-retention/_index.md" >}})는 같은 후보들을 400d 보관이라는 조건에 놓고 비용으로 판정합니다. "어떻게 붙이나"는 이 챕터가 맡고 "얼마가 드나"는 그쪽이 맡습니다.

## 문서 지도

| 문서 | 주제 | 한 줄 요약 |
|------|------|-----------|
| [01 Prometheus가 하지 않는 일]({{< relref "01-prometheus-retention.md" >}}) | 출발점 | 리텐션 플래그는 둘뿐, compaction은 해상도를 건드리지 않음, recording rule은 대체재가 아님 |
| [02 Thanos Compactor가 채우는 자리]({{< relref "02-thanos-downsampling.md" >}}) | 다운샘플링 | raw/5m/1h 생성 조건(40h·10d), 해상도별 retention, 공간을 아끼지 않는다는 공식 서술 |
| [03 Sidecar vs Receive]({{< relref "03-sidecar-vs-receive.md" >}}) | Prometheus 결합 | 데이터는 Thanos로 가지 않습니다 — 최근 구간은 어디 남고 누가 누구에게 접속하나 |
| [04 VictoriaMetrics에 붙일 수 있나]({{< relref "04-victoriametrics-and-thanos.md" >}}) | VM 결합 | 블록 포맷 비호환, vmctl은 일방향 이관, 유일한 접점은 remote write |
| [05 Receive 실전 구성]({{< relref "05-receive-setup.md" >}}) | 구축 | 컴포넌트 넷의 플래그, 송신 레그, 밟기 쉬운 함정 |
| [06 무엇을 고를 것인가]({{< relref "06-choosing.md" >}}) | 결론 | 판단 트리와 각 선택이 포기하는 것 |

## 세 줄 정리

Prometheus가 하는 일은 수집과 단기 저장까지입니다. 해상도 티어링 기능은 없습니다.

Thanos는 여러 클러스터가 내놓은 블록을 오브젝트 스토리지 한 곳에 모아 두고 그 위에서 해상도를 깎아 장기 보관합니다. 오픈소스로 해상도 티어링을 하겠다면 사실상 다른 선택지가 없습니다. [Mimir]({{< relref "../longterm-retention/04-mimir.md" >}})에는 다운샘플링 자체가 없고 VictoriaMetrics의 다운샘플링은 Enterprise 기능입니다.

VictoriaMetrics는 같은 문제를 다른 축에서 풉니다. 승부처는 압축률과 컴포넌트 수이고 스토리지는 블록 디바이스 위에 둡니다. Thanos와 겹쳐 쓰는 구성은 없고 둘 중 하나를 고르는 문제입니다.
