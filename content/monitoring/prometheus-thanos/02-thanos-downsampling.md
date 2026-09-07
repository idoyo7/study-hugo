---
title: "Thanos Compactor가 채우는 자리"
date: 2026-08-30
lastmod: 2026-08-30
weight: 2
---

# Thanos Compactor가 채우는 자리 — 다운샘플링의 실제 동작

Prometheus 단독으로는 해상도 티어링이 없습니다. Thanos에서 그 일을 하는 컴포넌트가 Compactor입니다. 오브젝트 스토리지 버킷을 훑으면서 블록을 병합하고 해상도를 깎은 블록을 새로 만들고 만료된 블록을 지웁니다.

## 두 단계로 내려갑니다

원본 블록은 raw라 부릅니다. 여기서 5m 블록이 나오고 5m에서 다시 1h 블록이 나옵니다.

아무 블록이나 곧바로 내려가지는 않습니다. 나이 조건이 있어서 5m 다운샘플은 공식 문서 문구대로 "blocks older than 40 hours (2d)"를, 1h 다운샘플은 "blocks older than 10 days (2w)"를 대상으로 삼습니다.

함정은 이 나이 조건이 리텐션 설정과 맞물리는 데서 나옵니다. `--retention.resolution-raw`를 40시간 아래로 잡아두면 raw 블록이 다운샘플 대상 나이가 되기 전에 지워지므로 5m 블록은 아예 생기지 않습니다. 5m 보존이 10일보다 짧을 때 1h 블록이 나오지 않는 것도 같은 이유입니다.

## 리텐션은 해상도마다 따로 겁니다

```
--retention.resolution-raw=14d
--retention.resolution-5m=90d
--retention.resolution-1h=1y
```

세 플래그의 기본값은 전부 `0d`입니다. 이 0을 "끄기"로 읽으면 안 됩니다. 무제한 보존이라 아무것도 지우지 않겠다는 뜻입니다. 설정을 건너뛰고 띄워놓은 뒤 버킷이 왜 계속 커지는지 찾아다니는 사고가 여기서 납니다.

## 다운샘플링은 저장 절감 수단이 아닙니다

이 문장이 가장 자주 반대로 알려져 있습니다. 공식 문서가 직접 부인합니다.

> downsampling doesn't save you **any** space but instead, it adds 2 more blocks for each raw block which are only slightly smaller or relatively similar size to raw blocks.

이유는 다운샘플 포인트의 구조에 있습니다. 5m 포인트 하나에는 sum, count, min, max, counter 다섯 집계가 청크에 함께 들어갑니다. 값 하나로 줄어드는 게 아니라서 5m 블록은 raw의 1/20로 떨어지지 않습니다. 원문 표현대로 "약간 작거나 비슷한 크기"에 머뭅니다.

같은 구간에 raw·5m·1h가 공존하면 저장량은 대략 3배가 됩니다. 실제 절감은 `--retention.resolution-raw`를 줄여 raw를 삭제할 때만 생깁니다.

다운샘플링이 노리는 건 다른 것입니다. 1년 범위 그래프를 그릴 때 raw 샘플 수천만 개를 읽지 않아도 되도록 하는 것, 공간이 아니라 쿼리 시간을 위한 기능입니다.

집계 다섯 개를 전부 들고 다니는 대신 얻는 것도 있습니다. 시리즈 이름과 개수가 그대로라서 `rate()`가 downsampled 블록 위에서도 투명하게 동작합니다. recording rule 방식과 결과가 달라지는 지점이 여기입니다. 카운터인지 게이지인지를 사람이 미리 구분해 줄 필요가 없습니다.

## 쿼리는 해상도를 자동으로 고릅니다

Querier가 `max_source_resolution` 파라미터로 어느 해상도를 읽을지 정합니다. 기준은 쿼리 step이라서 Grafana에서 1년 범위를 열면 1h 블록을, 최근 1시간을 열면 raw를 읽습니다.

자동 선택이 항상 뜻대로 굴러가지는 않습니다. step을 짧게 잡은 패널로 장기 구간을 조회하면 raw를 훑느라 느려지는데 이런 패널은 데이터소스 설정에서 해상도를 고정해 두는 편이 낫습니다.

## Compactor 자체의 운영 특성 둘

하나는 싱글턴 요구입니다. 문서는 "only one instance of Compactor may run against a single stream of blocks in a single object storage"라고 적습니다. 둘 이상이 돌면 겹치는 블록이 생기고 그걸 정리하는 일은 수동입니다. Deployment로 띄울 때 `replicas: 1`을 고정하고 HPA를 붙이지 않는 이유입니다.

다른 하나는 오류 처리 방식입니다. Compactor는 오류를 만나면 crash 대신 halt합니다. 프로세스는 살아 있고 `thanos_compact_halted` 메트릭만 1로 올라갑니다. compaction·다운샘플·리텐션이 그 자리에서 전부 멈추는데 파드는 여전히 Running이라 아무도 눈치채지 못하고 버킷 크기만 계속 늘어납니다. 이 메트릭에 알림을 걸어두는 일은 필수입니다.

## 참고

- thanos.io Compactor 문서 — 40h/10d 다운샘플 조건, `--retention.resolution-*` 기본 `0d`, "downsampling doesn't save you any space", 싱글턴 요구, `thanos_compact_halted`
- 비용까지 대입한 판정: [Thanos — Receive → S3]({{< relref "../longterm-retention/03-thanos-s3.md" >}})
- 사전 집계와 사후 다운샘플의 대조: [streamAggr vs downsampling]({{< relref "../longterm-retention/07-streamaggr-vs-downsampling.md" >}})
