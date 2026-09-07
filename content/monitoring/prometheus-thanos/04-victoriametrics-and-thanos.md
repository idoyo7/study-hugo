---
title: "VictoriaMetrics에 Thanos를 붙일 수 있나"
date: 2026-08-30
lastmod: 2026-08-30
weight: 4
---

# VictoriaMetrics에 Thanos를 붙일 수 있나

"Prometheus를 VictoriaMetrics로 바꾸고 뒤에 Thanos를 붙여 S3 장기 보관을 한다"는 그림을 한 번쯤 떠올리게 됩니다. 얼핏 자연스럽지만 이 조합은 성립하지 않습니다.

## 블록 포맷이 다릅니다

Thanos는 처음부터 끝까지 Prometheus TSDB 블록 포맷을 전제로 만들어져 있습니다.

블록 하나는 ULID를 이름으로 삼는 디렉토리이고, 그 안에 `meta.json`, `index`, `chunks/000001`, `tombstones`가 놓입니다. 청크 인코딩은 Gorilla XOR입니다. `index`는 심볼 테이블과 포스팅 리스트를 묶은 역인덱스입니다. Sidecar가 이 디렉토리를 통째로 올리면 Store Gateway는 `index`에서 index-header를 뽑아 캐시하고, Compactor는 `meta.json`에 적힌 시간 범위와 해상도를 읽어 병합·다운샘플 대상을 정합니다.

VictoriaMetrics의 저장 구조는 이와 별개입니다. `-storageDataPath` 아래 디렉토리 하나에 데이터를 전부 담고 인덱스도 자기 방식으로 짭니다. 압축 역시 독자 구현입니다. `meta.json`도, ULID 블록도 없습니다.

이 차이 때문에 vmstorage 데이터 디렉토리에 Sidecar를 붙인다 해도 읽어 올릴 블록이 없습니다. 내부 구조는 [VM 챕터의 스토리지·압축]({{< relref "../victoriametrics/concepts/04-storage-and-compression.md" >}}) 문서가 다룹니다.

## vmctl은 이관 도구지 연동 도구가 아닙니다

반대 방향으로 가는 길은 있습니다. `vmctl`이 Thanos 블록을 읽어 VictoriaMetrics로 옮겨 넣습니다. 지원 모드는 Prometheus 스냅샷, Thanos, remote read(Cortex·Mimir·Promscale), InfluxDB, OpenTSDB, vm-native입니다.

어느 모드를 쓰든 데이터는 VictoriaMetrics로 들어오는 일방향입니다. Thanos에서 VM으로 옮겨 갈 때 쓰는 이관 도구라서, 두 스택이 같은 데이터를 나눠 갖고 함께 도는 구성은 이것으로 만들 수 없습니다.

## 유일한 접점은 remote write입니다

Thanos와 VM 계열 사이에 열려 있는 통로는 vmagent에서 Thanos Receive로 향하는 remote write 하나뿐입니다.

```
vmagent ──remote write──▶ Thanos Receive ──▶ S3 ──▶ Compactor(5m/1h)
```

이 구성은 잘 돕니다. Receive는 표준 remote write 엔드포인트이고 vmagent는 그 프로토콜을 말할 줄 압니다. vmagent를 수집기로 세우고 저장만 Thanos에 맡긴 사례도 실제로 있습니다.

그런데 이 그림에는 VictoriaMetrics 저장소가 어디에도 없습니다. 남는 것은 수집 에이전트 vmagent 하나뿐이고, vminsert도 vmstorage도 등장하지 않습니다. "VM으로 갈아타고 Thanos도 붙인다"가 아니라 "수집기만 vmagent를 쓰고 저장은 Thanos로 한다"입니다.

송신 레그에는 손볼 곳이 몇 군데 있습니다. Receive는 out-of-order 샘플을 기본으로 거부하므로 해당 URL에는 `-remoteWrite.queues=1`을 붙이라는 권고가 따릅니다. 그 대가로 `-remoteWrite.maxDiskUsagePerURL` 버퍼를 어떻게 잡을지 설계할 일이 생깁니다. 상세는 [longterm-retention 챕터의 송신 레그 절]({{< relref "../longterm-retention/03-thanos-s3.md" >}})이 소유합니다.

## VM 단독으로 같은 목적을 풀면

VM 계열에서 장기 보관을 하려면 Thanos 없이 VM 안에서 끝냅니다. 접근하는 축 자체가 다릅니다.

보관 기간은 `-retentionPeriod` 하나로 정합니다. 기본값이 1개월(31일), 최소 단위가 24h이고, 값을 늘린 만큼 데이터가 오래 남습니다.

저장 위치는 블록 디바이스뿐입니다. VictoriaMetrics는 S3를 조회 가능한 primary 스토리지로 지원하지 않습니다. `vmbackup`으로 S3에 사본을 떠 둘 수는 있어도 그것은 백업이라서 거기에 직접 쿼리를 던지지 못합니다. 티어링과는 다른 이야기입니다.

해상도 축약은 Enterprise 기능입니다. 공식 Enterprise 기능 목록에 Downsampling이 올라 있습니다. OSS만 쓴다면 다른 길을 찾아야 하는데, 실무에서 택하는 길은 streamAggr로 수집 시점에 5m 시리즈를 미리 만들어 별도 인스턴스에 쌓는 방식입니다. 이미 쌓인 데이터를 사후에 다시 계산하는 Thanos 다운샘플링과 달리 streamAggr은 수집 단계에서 값을 미리 확정합니다. 이 대조는 [streamAggr vs downsampling]({{< relref "../longterm-retention/07-streamaggr-vs-downsampling.md" >}})이 자세히 다룹니다.

그 대신 VM은 압축률이 좋습니다. 다운샘플 없이 raw를 오래 들고 가는 구성이 현실적인 경우가 많고, 카디널리티가 크지 않다면 해상도 티어링 자체가 필요 없어질 때도 있습니다.

## 정리표

| | Prometheus + Thanos | VM OSS | VM Enterprise |
|---|---|---|---|
| 해상도 티어링 | Compactor가 raw/5m/1h | 없음 (streamAggr로 사전 집계) | `-downsampling.period` |
| 오브젝트 스토리지 | 조회 가능한 primary | 백업 사본만 | 백업 사본만 |
| 티어링 시점 | 사후 재계산 | 사전 확정 | 사후 |
| 컴포넌트 수 | 4~5종 (+캐시) | 3종 또는 1종(single) | 동일 |
| 쿼리 언어 | PromQL | MetricsQL | MetricsQL |

Mimir는 세 번째 후보처럼 보이지만 해상도 축약이 없습니다. Thanos에서 포크될 때 함께 넘어온 다운샘플링 코드를 나중에 제거했고, 제안은 열려 있으나 진척이 없습니다. 오브젝트 스토리지 네이티브라는 이점이 있어도 이 챕터의 질문에는 답이 되지 않습니다. 판정 근거는 [04 Mimir]({{< relref "../longterm-retention/04-mimir.md" >}})에 있습니다.

## 참고

- docs.victoriametrics.com vmctl — 지원 마이그레이션 모드, Thanos 블록 읽기, VM으로 들어오는 일방향
- docs.victoriametrics.com single-server — `-storageDataPath` 단일 디렉토리, `-retentionPeriod` 기본 31일·최소 24h
- docs.victoriametrics.com Enterprise features — Downsampling이 Enterprise 목록에 포함
- grafana/mimir PR #3024 — 다운샘플링 코드 제거
