---
title: "VictoriaMetrics에 Thanos를 붙일 수 있나"
date: 2026-08-30
lastmod: 2026-08-30
weight: 4
---

# VictoriaMetrics에 Thanos를 붙일 수 있나

"Prometheus를 VictoriaMetrics로 바꾸고 뒤에 Thanos를 붙여 S3 장기 보관을 한다"는 그림이 자연스러워 보입니다. 성립하지 않습니다.

## 블록 포맷이 다릅니다

Thanos 전체가 Prometheus TSDB 블록 포맷 위에 서 있습니다.

블록 하나는 ULID 이름의 디렉토리입니다. 안에 `meta.json`, `index`, `chunks/000001`, `tombstones`가 들어갑니다. 청크는 Gorilla XOR로 인코딩됩니다. `index`는 심볼 테이블과 포스팅 리스트로 이뤄진 역인덱스입니다. Sidecar는 이 디렉토리를 통째로 업로드하고 Store Gateway는 `index`에서 index-header를 뽑아 캐시합니다. Compactor는 `meta.json`의 시간 범위와 해상도를 보고 병합·다운샘플 대상을 고릅니다.

VictoriaMetrics는 자체 저장 구조를 씁니다. `-storageDataPath` 아래 한 디렉토리에 전부 담고 인덱스도 별도 구조입니다. 압축 방식도 독자 구현입니다. `meta.json`도 ULID 블록도 존재하지 않습니다.

그래서 vmstorage 데이터 디렉토리에 Sidecar를 붙일 대상이 없습니다. 읽을 블록이 없기 때문입니다. 내부 구조는 [VM 챕터의 스토리지·압축]({{< relref "../victoriametrics/concepts/04-storage-and-compression.md" >}}) 문서가 다룹니다.

## vmctl은 이관 도구지 연동 도구가 아닙니다

방향이 반대인 경로는 있습니다. `vmctl`이 Thanos 블록을 읽어 VictoriaMetrics로 넣어줍니다. 지원 모드는 Prometheus 스냅샷, Thanos, remote read(Cortex·Mimir·Promscale), InfluxDB, OpenTSDB, vm-native입니다.

전부 **VictoriaMetrics로 들어오는 일방향**입니다. Thanos에서 VM으로 이사할 때 쓰는 도구입니다. 두 스택이 같은 데이터를 나눠 갖고 함께 도는 구성은 만들 수 없습니다.

## 유일한 접점은 remote write입니다

Thanos와 VM 계열이 만나는 지점은 하나뿐입니다. vmagent가 Thanos Receive로 remote write를 보내는 경로입니다.

```
vmagent ──remote write──▶ Thanos Receive ──▶ S3 ──▶ Compactor(5m/1h)
```

이 구성은 잘 돕니다. Receive는 표준 remote write 엔드포인트고 vmagent는 그 프로토콜을 말할 수 있습니다. 실제로 vmagent를 수집기로 두고 저장소만 Thanos로 가져가는 사례가 있습니다.

정작 이 그림에는 **VictoriaMetrics 저장소가 없습니다.** 남은 건 수집 에이전트 vmagent뿐입니다. vminsert도 vmstorage도 등장하지 않습니다. "VM으로 갈아타고 Thanos도 붙인다"가 아니라 "수집기만 vmagent를 쓰고 저장은 Thanos로 한다"입니다.

송신 레그에는 조정할 것이 몇 개 있습니다. Receive가 out-of-order 샘플을 기본 거부하니 해당 URL에는 `-remoteWrite.queues=1`이 권고됩니다. 그 대가로 `-remoteWrite.maxDiskUsagePerURL` 버퍼 설계가 따라옵니다. 상세는 [longterm-retention 챕터의 송신 레그 절]({{< relref "../longterm-retention/03-thanos-s3.md" >}})이 소유합니다.

## VM 단독으로 같은 목적을 풀면

VM 계열로 장기 보관을 하려면 Thanos 없이 VM 안에서 끝냅니다. 축이 다릅니다.

보관 기간은 `-retentionPeriod`로 정합니다. 기본은 1개월(31일)이고 최소 단위는 24h입니다. 값을 늘리면 그만큼 오래 남습니다.

저장 위치는 블록 디바이스입니다. VictoriaMetrics는 S3를 조회 가능한 primary 스토리지로 지원하지 않습니다. `vmbackup`으로 S3에 사본을 뜰 수는 있지만 그건 백업일 뿐이어서 그 데이터에 직접 쿼리를 던질 수 없습니다. 티어링이 아닙니다.

해상도 축약은 **Enterprise 기능**입니다. 공식 Enterprise 기능 목록에 Downsampling이 들어 있습니다. OSS만 쓴다면 다른 길을 찾아야 합니다. 실무에서는 streamAggr로 **수집 시점에 5m 시리즈를 미리 만들어** 별도 인스턴스에 쌓습니다. Thanos 다운샘플링은 이미 쌓인 데이터를 사후에 다시 계산하지만 streamAggr은 수집 단계에서 값을 미리 확정합니다. 이 대조는 [streamAggr vs downsampling]({{< relref "../longterm-retention/07-streamaggr-vs-downsampling.md" >}})이 자세히 다룹니다.

대신 VM은 압축률이 좋습니다. 다운샘플 없이 raw를 오래 들고 가는 구성이 현실적일 때가 많습니다. 카디널리티가 크지 않다면 해상도 티어링 자체가 필요 없어지는 경우도 있습니다.

## 정리표

| | Prometheus + Thanos | VM OSS | VM Enterprise |
|---|---|---|---|
| 해상도 티어링 | Compactor가 raw/5m/1h | 없음 (streamAggr로 사전 집계) | `-downsampling.period` |
| 오브젝트 스토리지 | 조회 가능한 primary | 백업 사본만 | 백업 사본만 |
| 티어링 시점 | 사후 재계산 | 사전 확정 | 사후 |
| 컴포넌트 수 | 4~5종 (+캐시) | 3종 또는 1종(single) | 동일 |
| 쿼리 언어 | PromQL | MetricsQL | MetricsQL |

Mimir는 세 번째 후보처럼 보이지만 해상도 축약이 없습니다. Thanos에서 포크될 때 딸려온 다운샘플링 코드를 나중에 제거했습니다. 제안은 열려 있으나 진행되지 않았습니다. 오브젝트 스토리지 네이티브라는 이점은 있어도 이 챕터의 질문에는 답을 주지 않습니다. 판정 근거는 [04 Mimir]({{< relref "../longterm-retention/04-mimir.md" >}})에 있습니다.

## 참고

- docs.victoriametrics.com vmctl — 지원 마이그레이션 모드, Thanos 블록 읽기, VM으로 들어오는 일방향
- docs.victoriametrics.com single-server — `-storageDataPath` 단일 디렉토리, `-retentionPeriod` 기본 31일·최소 24h
- docs.victoriametrics.com Enterprise features — Downsampling이 Enterprise 목록에 포함
- grafana/mimir PR #3024 — 다운샘플링 코드 제거
