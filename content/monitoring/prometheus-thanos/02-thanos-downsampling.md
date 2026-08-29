---
title: "Thanos Compactor가 채우는 자리"
weight: 2
---

# Thanos Compactor가 채우는 자리 — 다운샘플링의 실제 동작

Prometheus에 없는 해상도 티어링은 Thanos Compactor가 맡습니다. 오브젝트 스토리지 버킷을 훑으면서 블록을 병합하고 해상도를 깎은 블록을 새로 만들고 만료된 블록을 지웁니다.

## 두 단계로 내려갑니다

원본 블록을 raw라 부릅니다. 여기서 5m 블록이 나오고 5m에서 다시 1h 블록이 나옵니다.

생성에는 시간 조건이 붙습니다. 공식 문서 표현을 그대로 옮기면 5m 다운샘플은 "blocks older than 40 hours (2d)"를, 1h 다운샘플은 "blocks older than 10 days (2w)"를 대상으로 만듭니다.

이 조건이 리텐션 설정과 맞물려 함정을 만듭니다. `--retention.resolution-raw`를 40시간보다 짧게 잡으면 5m 블록이 아예 생기지 않습니다. 재료가 되는 raw 블록이 다운샘플 대상 나이에 도달하기 전에 지워지기 때문입니다. 같은 이유로 5m 보존이 10일보다 짧으면 1h 블록이 생기지 않습니다.

## 리텐션은 해상도마다 따로 겁니다

```
--retention.resolution-raw=14d
--retention.resolution-5m=90d
--retention.resolution-1h=1y
```

세 플래그의 기본값은 모두 `0d`입니다. 0을 "끄기"로 읽으면 곤란합니다. 무제한 보존입니다. 아무것도 지우지 않겠다는 뜻입니다. 설정하지 않은 채 띄워놓고 왜 버킷이 계속 커지는지 찾는 사고가 여기서 납니다.

## 다운샘플링은 저장 절감 수단이 아닙니다

이 문장이 가장 자주 뒤집힙니다. 공식 문서가 직접 부인합니다.

> downsampling doesn't save you **any** space but instead, it adds 2 more blocks for each raw block which are only slightly smaller or relatively similar size to raw blocks.

다운샘플 포인트의 구조 때문입니다. 5m 포인트 하나가 단일 값이 아닙니다. sum, count, min, max, counter 다섯 집계를 청크에 함께 담습니다. 그래서 5m 블록이 raw의 1/20이 되지 않습니다. 원문 표현대로 "약간 작거나 비슷한 크기"입니다.

같은 구간에 raw·5m·1h가 공존하면 저장량은 대략 3배가 됩니다. 실제 절감은 오직 `--retention.resolution-raw`를 줄여 raw를 삭제할 때 생깁니다.

다운샘플링의 본래 목적은 다른 데 있습니다. 1년 범위 그래프를 그릴 때 raw 샘플 수천만 개를 읽지 않아도 되게 만드는 것입니다. 공간이 아니라 쿼리 시간을 위한 기능입니다.

집계를 다섯 개나 들고 다니는 대가로 얻는 게 하나 있습니다. 시리즈 이름과 개수가 변하지 않습니다. `rate()`가 downsampled 블록 위에서도 투명하게 동작합니다. recording rule 방식과 결과가 달라지는 대목입니다 — 카운터인지 게이지인지 사람이 미리 구분해줄 필요가 없습니다.

## 쿼리는 해상도를 자동으로 고릅니다

Querier가 `max_source_resolution` 파라미터로 어느 해상도를 읽을지 정합니다. Grafana에서 1년 범위를 열면 1h 블록을, 최근 1시간을 열면 raw를 읽습니다. 판단 근거는 쿼리 step입니다.

자동 선택이 늘 원하는 대로 되지는 않습니다. step이 짧게 잡힌 패널이 장기 구간을 조회하면 raw를 훑다가 느려집니다. 그런 패널은 데이터소스 설정에서 해상도를 고정하는 편이 낫습니다.

## Compactor 자체의 운영 특성 둘

싱글턴이어야 합니다. 문서 표현으로 "only one instance of Compactor may run against a single stream of blocks in a single object storage"입니다. 둘 이상 돌면 겹치는 블록이 생기고 그 정리는 수동입니다. Deployment로 띄운다면 `replicas: 1`을 고정하고 HPA를 붙이지 않습니다.

오류를 만나면 죽지 않고 멈춥니다. crash 대신 halt합니다. 프로세스는 살아있고 `thanos_compact_halted` 메트릭이 1이 됩니다. 이 상태에서 compaction·다운샘플·리텐션이 전부 정지하는데, 파드는 Running이라 아무도 눈치채지 못합니다. 버킷 크기만 계속 늘어납니다. 이 메트릭에는 반드시 알림을 걸어야 합니다.

## 참고

- thanos.io Compactor 문서 — 40h/10d 다운샘플 조건, `--retention.resolution-*` 기본 `0d`, "downsampling doesn't save you any space", 싱글턴 요구, `thanos_compact_halted`
- 비용까지 대입한 판정: [Thanos — Receive → S3]({{< relref "../longterm-retention/03-thanos-s3.md" >}})
- 사전 집계와 사후 다운샘플의 대조: [streamAggr vs downsampling]({{< relref "../longterm-retention/07-streamaggr-vs-downsampling.md" >}})
