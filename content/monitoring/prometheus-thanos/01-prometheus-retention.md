---
title: "Prometheus가 하지 않는 일"
date: 2026-08-30
lastmod: 2026-08-30
weight: 1
---

# Prometheus가 하지 않는 일 — 리텐션의 경계

Prometheus 리텐션을 늘려 장기 보관을 해결하려다 보면 곧 벽을 만납니다. 기간을 늘리면 용량이 선형으로 늡니다. 해상도를 깎아 완만하게 만들 방법이 Prometheus 안에는 없습니다.

## 플래그는 둘뿐입니다

```
--storage.tsdb.retention.time=15d
--storage.tsdb.retention.size=100GB
```

기간이냐 용량이냐만 정합니다. 둘 다 주면 먼저 걸리는 쪽이 이깁니다. 보관 기간 안에 들어있는 데이터는 처음 수집한 해상도 그대로 남습니다. `scrape_interval: 15s`로 긁었다면 삭제되는 날까지 15초 간격입니다. 90일 전 데이터를 5분 간격으로 낮춰 들고 있겠다는 선택지가 없습니다.

## compaction은 해상도를 건드리지 않습니다

여기서 오해가 자주 생깁니다. Prometheus TSDB에는 compaction이 있습니다. 2시간짜리 블록을 더 큰 블록으로 병합하는 작업입니다.

병합은 블록 개수를 줄이고 인덱스를 다시 씁니다. 샘플을 솎아내지는 않습니다. 15초 간격 샘플 5,760개가 든 2시간 블록 열둘을 하루짜리 블록 하나로 합쳐도 그 안의 샘플 수는 그대로입니다. 이름이 "압축"으로 읽히는 탓에 축약으로 오해하기 쉽습니다.

## recording rule은 대체재가 아닙니다

네이티브로 비슷한 걸 흉내낼 수단은 recording rule 하나입니다.

```yaml
groups:
  - name: rollup-5m
    interval: 5m
    rules:
      - record: job:http_requests:rate5m
        expr: sum by (job) (rate(http_requests_total[5m]))
```

돌려보면 한계가 바로 드러납니다.

원본이 사라지지 않습니다. 새 시리즈가 하나 더 생길 뿐이고 `http_requests_total`은 리텐션 끝까지 그대로 삽니다. 저장 총량은 오히려 늘어납니다.

시리즈 이름이 달라집니다. 대시보드와 알림 룰이 구간에 따라 다른 이름을 봐야 합니다. 최근 7일은 `http_requests_total`, 그 이전은 `job:http_requests:rate5m`을 참조하는 패널을 사람이 관리하게 됩니다.

무엇을 남길지 미리 골라야 합니다. 장애를 다시 파헤칠 때 필요한 메트릭은 사고가 난 다음에야 알게 됩니다. 룰에 없던 시리즈는 복구할 방법이 없습니다.

대시보드 몇 개를 가볍게 만드는 용도로는 씁니다. 보관 전략으로는 성립하지 않습니다.

## 그래서 남는 자리

Prometheus에 없는 기능은 둘입니다.

해상도 티어링이 없습니다. 오래된 구간을 낮은 해상도로 자동 변환하는 경로가 아예 빠져 있습니다.

여러 클러스터를 가로지르는 조회가 없습니다. Prometheus 하나는 자기가 긁은 데이터만 압니다. 클러스터가 다섯이면 Grafana 데이터소스도 다섯입니다. 클러스터를 넘나드는 집계 쿼리를 쓸 수 없습니다.

Thanos는 이 둘을 함께 가져가려고 만들어진 물건입니다. 다음 문서에서 앞의 것부터 봅니다.

## 참고

- Prometheus Storage 문서 — `--storage.tsdb.retention.time` / `.size`, 2h 블록과 compaction
- 이어지는 글: [02 Thanos Compactor가 채우는 자리]({{< relref "02-thanos-downsampling.md" >}})
