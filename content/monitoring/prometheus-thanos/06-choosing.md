---
title: "무엇을 고를 것인가"
weight: 6
---

# 무엇을 고를 것인가

앞의 다섯 문서를 판단 순서로 압축합니다.

## 첫 질문 — 해상도 티어링이 정말 필요한가

필요 없을 수 있습니다. 카디널리티가 크지 않으면 raw를 그대로 오래 들고 가는 편이 단순하고 쌉니다.

Thanos 다운샘플링은 저장을 줄여주지 않습니다. 줄어드는 건 raw 보존 기간을 깎을 때뿐입니다. 그 대가로 컴포넌트 넷과 Compactor halt 감시가 상시 운영 항목으로 붙습니다. VictoriaMetrics는 압축률이 좋아 raw 1~2년을 디스크에 두는 구성이 종종 성립합니다.

티어링이 필요한 신호는 둘입니다. 보관 기간이 길어 raw 총량이 자릿수로 커지는 경우, 장기 구간 쿼리가 실제로 느려 대시보드를 못 쓰게 된 경우입니다. 두 번째가 다운샘플링의 원래 목적입니다.

## 둘째 질문 — 클러스터가 몇 개인가

하나면 Thanos의 절반은 필요 없습니다. 여러 클러스터를 가로지르는 조회가 Thanos의 나머지 절반인데, 그게 없으면 남는 건 장기 보관뿐입니다. 장기 보관만 놓고 보면 VM 쪽이 컴포넌트가 적습니다.

여럿이면 다음 질문으로 갑니다.

## 셋째 질문 — 중앙에서 각 클러스터로 들어갈 수 있는가

들어갈 수 있으면 Sidecar가 선택지에 들어옵니다. 같은 VPC나 피어링 안이면 부담이 적습니다. 전송량이 적은 데다 각 클러스터가 자기 알림을 독립적으로 평가한다는 이점이 큽니다.

들어갈 수 없거나 터널 유지가 부담이면 Receive입니다. 아웃바운드만 쓰면 되고 edge가 무상태가 됩니다.

## 각 선택이 포기하는 것

| 선택 | 포기하는 것 |
|---|---|
| Sidecar | 각 클러스터에 인바운드 경로와 인증을 유지해야 합니다. edge가 stateful이라 PVC와 백업 대상이 늘어납니다. 링크가 끊기면 최근 구간을 중앙에서 못 봅니다. |
| Receive | 각 클러스터의 독립 알림을 잃습니다. 회선이 죽으면 그 사이트 알림이 통째로 멈춥니다. Receive 자체가 StatefulSet이라 중앙에 상태가 하나 더 생깁니다. |
| VM OSS | 사후 재계산을 포기합니다. streamAggr로 만든 5m는 수집 시점에 확정되므로, 나중에 "다른 집계가 필요했다"에 대응할 수 없습니다. S3를 primary로 쓰지 못합니다. |
| VM Enterprise | 라이선스 비용입니다. 대신 다운샘플링이 플래그 한 줄입니다. |
| Mimir | 해상도 축약을 포기합니다. 오브젝트 스토리지 네이티브와 정돈된 컴포넌트 구성을 얻습니다. |

## 자주 나오는 조합 셋

**여러 클러스터 + 같은 네트워크 + 알림 독립성 중요** — Prometheus + Sidecar. 클러스터마다 `external_labels`를 유일하게 주고 Querier가 각 Sidecar와 Store Gateway를 함께 봅니다.

**여러 사이트 + NAT/조직 경계 + edge 최소화** — vmagent(또는 agent 모드 Prometheus) + Thanos Receive. edge 복구가 재배포 한 번으로 끝납니다. 알림 독립성이 필요하면 각 사이트에 짧은 리텐션의 full Prometheus와 Alertmanager를 두고 그 Prometheus가 중앙으로 remote write 합니다.

**단일 대형 클러스터 + 장기 보관만 필요** — VictoriaMetrics. `-retentionPeriod`를 늘리고 필요하면 streamAggr로 집계 인스턴스를 따로 둡니다. 400d 조건에서 비용을 어떻게 판정하는지는 [longterm-retention 챕터]({{< relref "../longterm-retention/_index.md" >}})가 소유합니다.

## 하지 말 것

**VM 뒤에 Thanos를 붙이려는 시도.** 블록 포맷이 달라 Sidecar가 붙지 않습니다. vmctl은 일방향 이관 도구입니다. 접점은 `vmagent → Receive`뿐이고 그건 VM 저장소를 쓰지 않는 구성입니다.

**Compactor를 HPA에 물리는 것.** 싱글턴이어야 합니다.

**리텐션 플래그를 비워두는 것.** 기본 `0d`는 무제한 보존입니다.

**IA/Glacier 클래스로 비용을 아끼려는 시도.** Store Gateway가 읽는 버킷은 Standard여야 합니다. 리트리벌 수수료가 조회마다 붙습니다.

## 이 챕터 밖의 이야기

비용 숫자로 판정하는 쪽은 [메트릭 장기보관 아키텍처 비교]({{< relref "../longterm-retention/_index.md" >}})입니다. VM 내부 동작과 운영 기준치는 [VictoriaMetrics Deep Dive]({{< relref "../victoriametrics/_index.md" >}})가 다룹니다.
