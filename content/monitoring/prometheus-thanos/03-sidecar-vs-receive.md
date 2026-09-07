---
title: "Sidecar vs Receive"
date: 2026-08-30
lastmod: 2026-08-30
weight: 3
---

# Prometheus에 붙이는 두 방식 — Sidecar vs Receive

"Thanos를 붙인다"는 한마디 안에 전혀 다른 배치 둘이 들어 있습니다. 어느 쪽이냐에 따라 방화벽 정책도, 장애가 퍼지는 반경도 달라집니다.

## 먼저 오해 하나

Sidecar 모델에서 데이터는 Thanos로 가지 않습니다.

Sidecar가 맡는 일은 둘뿐입니다. Prometheus가 2시간마다 닫아둔 블록을 오브젝트 스토리지에 올리는 것 하나, gRPC StoreAPI를 열어두는 것 하나입니다.

아직 닫히지 않은 최근 블록은 그 클러스터의 Prometheus 디스크를 떠나지 않습니다. 이 구간을 중앙 Querier가 읽으려면 클러스터마다 있는 Sidecar에 직접 접속해야 합니다. 클러스터가 다섯이면 gRPC 연결도 다섯 곳으로 나갑니다.

"중앙으로 다 보내놓고 중앙에서 조회한다"는 그림이 아닙니다. 오래된 데이터는 버킷에서, 최근 데이터는 원격지에서 가져와 합치는 그림입니다.

## Receive는 방향이 반대입니다

Receive는 remote write 엔드포인트입니다. 각 클러스터가 중앙으로 샘플을 밀어 넣습니다. Receive는 받은 샘플로 자기 로컬 TSDB에 블록을 만든 뒤 그 블록을 버킷으로 올립니다.

이 구성에서는 edge에 상태가 남지 않습니다. Prometheus를 agent 모드(`--agent`)로 돌리거나 vmagent를 두고 수집한 것을 넘기는 일만 시킵니다. Querier가 바라볼 곳도 중앙의 Receive와 Store Gateway, 둘로 끝납니다.

## 대조

| | Sidecar | Receive |
|---|---|---|
| 각 클러스터 | full Prometheus + PVC | agent 모드 Prometheus 또는 vmagent, 무상태 |
| 최근 2h 데이터 위치 | 각 클러스터 디스크 | 중앙 Receive |
| 연결 방향 | 중앙 → 각 클러스터 (인바운드 필요) | 각 클러스터 → 중앙 (아웃바운드) |
| 버킷 업로더 | 클러스터마다 하나씩 | 중앙 Receive 하나 |
| 전송 형태 | 2시간마다 압축된 TSDB 블록 | 상시 샘플 스트림 |
| 링크 단절 시 | 로컬에 계속 쌓고 복구 후 업로드 | 송신측 디스크 버퍼링 |
| 로컬 알림 | 가능 | 불가 (중앙 Ruler가 대신) |
| 중앙 컴포넌트 | Querier, Store GW, Compactor | + Receive (StatefulSet) |

## 무엇으로 갈리나

### 연결 방향

실무에서 이게 첫 번째 필터입니다. Sidecar 모델은 중앙 Querier가 각 클러스터의 gRPC 포트로 들어가야 합니다. 클러스터마다 엔드포인트를 노출하고 인증을 붙여야 합니다. mTLS나 Ingress + 클라이언트 인증서를 씁니다.

클러스터들이 퍼블릭 클라우드의 같은 VPC나 피어링 안에 모여 있다면 부담은 크지 않습니다. NAT 뒤에 있거나 조직 경계를 넘어가면 터널을 계속 유지해야 합니다. 홈랩이나 온프렘 지사 환경이 Receive로 기우는 이유가 여기에 있습니다. 아웃바운드만 쓰면 방화벽에 손댈 일이 없습니다.

### 알림의 독립성

Sidecar 모델에서는 룰 평가를 각 클러스터의 Prometheus가 스스로 합니다. 옆에 Alertmanager까지 두면 중앙과 이어진 링크가 끊긴 상황에서도 알림은 나갑니다. 링크가 끊겼다는 사실 자체도 로컬에서 알아챕니다.

Receive 모델의 edge는 수집기에서 끝납니다. 룰 평가는 중앙의 Thanos Ruler로 넘어갑니다. 어느 사이트의 회선이 죽으면 그 사이트 알림은 통째로 멈추고 송신측은 디스크에 버퍼링만 할 뿐입니다.

이게 걸리면 하이브리드로 갑니다. 각 클러스터에 full Prometheus를 두되 맡기는 일은 로컬 알림까지입니다. 로컬 리텐션은 2~3일로 짧게 잡고 장기 보관은 그 Prometheus의 remote write로 중앙 Receive에 보냅니다. Sidecar는 붙이지 않고 인바운드도 열지 않습니다.

### 대역폭

여기서는 Sidecar가 앞섭니다. TSDB 블록은 이미 압축·중복제거된 상태로 올라갑니다. remote write는 샘플 단위 스트림이라 프로토콜 오버헤드가 더 큽니다. 카디널리티가 크지 않은 환경이라면 체감할 만한 차이는 아닙니다.

## external label을 틀리면 Compactor가 멈춥니다

두 모델 어느 쪽에서든 일어나는 가장 흔한 사고입니다.

버킷에 블록을 올리는 주체라면 자기를 식별하는 external label이 붙어 있어야 합니다. Sidecar 모델이면 각 Prometheus의 `external_labels`에 `cluster` 같은 키가 유일한 값으로 들어가야 합니다. Receive 모델이면 각 Receive 레플리카의 `--label`이 서로 달라야 합니다.

값이 겹치는 순간 같은 시간대·같은 라벨셋의 블록이 버킷에 둘 이상 쌓입니다. Compactor는 이 overlap을 만나면 halt합니다. 앞 문서에서 본 소리 없는 정지가 여기서 시작됩니다.

Receive는 tenant 단위로도 TSDB를 나눕니다. `THANOS-TENANT` 헤더 값마다 독립 TSDB를 동적으로 만들고 헤더를 주지 않으면 `default-tenant`로 들어갑니다. 클러스터를 tenant로 나눌지 external label로 나눌지는 별개 결정입니다.

## 참고

- thanos.io Sidecar / Receive 컴포넌트 문서 — StoreAPI, `--remote-write.address` 기본 `0.0.0.0:19291`, `--receive.tenant-header` 기본 `THANOS-TENANT`, `--receive.default-tenant-id` 기본 `default-tenant`, tenant별 독립 TSDB 동적 생성
- 이어지는 글: [04 VictoriaMetrics에 붙일 수 있나]({{< relref "04-victoriametrics-and-thanos.md" >}})
