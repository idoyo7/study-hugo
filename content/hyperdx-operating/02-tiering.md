---
title: "데이터 티어링 — hot gp3 · cold S3 · 리플레이 DELETE"
weight: 2
aliases: ["/hyperdx/operating/02-tiering/"]
---

# 데이터 티어링 — hot gp3 · cold S3 · 리플레이 DELETE

{{< callout type="info" >}}
**한눈에**

- hot = 노드당 **단일 gp3**. ClickHouse는 대형 순차 머지가 지배적인 throughput-bound 워크로드이고, 인스턴스 EBS 파이프가 볼륨보다 먼저 천장이라 0.7TB/월 RUM엔 io2·스트라이핑이 불필요하다.
- cold = **S3 Standard + `cache` disk**, 이동 주체는 **시간 기반 TTL `TO VOLUME 'cold'`**. `move_factor`(기본 0.1)는 "여유<10%(≈90% 찼을 때)"에만 개입하는 안전판이지 주 이동 수단이 아니다.
- 세션 리플레이(`hyperdx_sessions`)는 on-disk를 지배하면서도 유용 수명이 짧아 **S3로 안 내리고 hot 30일 후 DELETE**한다.
- S3를 못/안 쓰는 경로는 **block-only**(EBS 단일 티어, TTL DELETE-only)가 대안 — 짧은 보존(≤90일)·staging·규정상 S3 금지에서만 고른다.
- **티어링은 내구성이 아니다.** 데이터 내구성은 멀티 AZ RF 복제 + 백업이 담당하고, cold(S3)도 `{replica}` 경로에 RF배수 사본을 두는 shared-nothing이다 — zero-copy replication은 금지.
{{< /callout >}}

이 페이지는 [운영 로드맵]({{< relref "_index.md" >}}) 2부(데이터 티어링)를 실체화한 것이다. hot(gp3)·cold(S3 worked example)·block-only 대안의 정본은 각각 [hot 스토리지]({{< relref "../hyperdx/02-hot-storage-ebs.md" >}})·[S3 콜드 티어링]({{< relref "../hyperdx/03-s3-cold-tiering.md" >}})·[블록 온리 튜닝]({{< relref "../hyperdx/08-block-only-tuning.md" >}})이며, 이 페이지는 세 문서를 관통하는 **티어링 논지**(무엇을 왜 어디에 두나)를 하나로 묶어 판단 기준만 압축한다. 스펙·요금·XML 전문·산정식은 재서술하지 않고 relref로 위임한다.

## 1. hot = 노드당 단일 gp3 — 스펙 산정 요지

| 항목 | 값 |
|---|---|
| baseline IOPS / throughput | **3,000 IOPS / 125 MiB/s**(무료, 버스트 아님) `✓` |
| 최대 IOPS / throughput(Nitro) | **80,000 IOPS / 2,000 MiB/s**(2025-09 상향) `✓` |
| r7g.2xlarge 인스턴스 EBS 파이프 baseline | **312 MB/s**(burst 1,250 MB/s) `✓` |

인스턴스 EBS 파이프가 볼륨 상한보다 먼저 천장이므로, gp3를 80,000 IOPS/2,000 MiB/s까지 올려도 mid-size Graviton(r7g ≤4xlarge)에선 돈만 버린다 `≈`. 실전 sweet spot은 **baseline IOPS(3,000) + 인스턴스 baseline에 맞춘 소량 provisioned throughput**(예: r7g.2xlarge에 ~300 MiB/s)이다 `≈`. RAID0 스트라이핑은 볼륨 1개 실패로 배열 전체가 죽어 실효 내구성이 낮아지고, 인스턴스 대역이 어차피 총 throughput 상한이라 여러 볼륨을 붙여도 이득이 없다 — **단일 gp3가 성능·내구성·운영 모두에서 우위**다 `≈`. io2/io2 Block Express는 극한 IOPS(>80,000/vol)·sub-ms 지연·볼륨 단위 99.999% 규제가 걸릴 때만 각주로 검토한다. gp3 요금 3분해·io2 tiered 요금·StorageClass/volumeClaimTemplate 조립은 [hot 스토리지]({{< relref "../hyperdx/02-hot-storage-ebs.md" >}})가 정본이다.

## 2. cold = S3 Standard + cache — 시간 TTL이 이동을 정한다

`storage_configuration`은 hot 볼륨(내장 `default` = gp3 PVC, 선언 불필요) + cold 볼륨(`cache`로 감싼 S3 `object_storage` disk) 두 개로 조립한다. S3 disk는 `{replica}` 경로로 분리해 replica마다 독립 사본을 갖게 하고(shared-nothing), `cache` disk(EBS 위 LRU, `max_size` 예 150Gi)가 cold 첫 조회 지연을 완화한다 `✓`. 볼륨 이동은 `ALTER TABLE ... MODIFY TTL ... TO VOLUME 'cold'`가 담당하고, `move_factor`는 어디까지나 안전판이다.

{{< callout type="warning" >}}
**`move_factor`는 "여유 공간 임계"이지 "사용률"이 아니다.** 기본값 0.1은 **여유 < 10%(≈90% 찼을 때)**에만 다음 볼륨으로 밀어내는 안전판이다. "0.9를 안전판으로 둔다"는 서술은 값-설명 불일치 — 0.9는 여유<90%(=10%만 차도) 즉시 이동이라 hot=최근 창 목적을 깨뜨린다. 주 이동 수단은 시간 기반 TTL이고 `move_factor=0.1`(기본)로 예외적 ingest 폭주에만 개입시킨다 `✓`.
{{< /callout >}}

TTL 정본 표(단위: hot 창 → cold 시작 → DELETE 지평):

| 테이블 | hot(EBS) | cold(S3) | DELETE(3/6/12개월) |
|---|---|---|---|
| `otel_logs` / `otel_traces` | 14일 | 14일~ | 90 / 180 / 365일 |
| `otel_metrics_*` | 30일 | 30일~ | 180 / 365일(3개월 지평도 최소 180 권장) |
| `hyperdx_sessions` | 30일(전 수명) | **미이동** | 30일 고정 |

DDL 핵심 조각(3개월 지평 예시, 전 테이블 반복형은 [S3 콜드 티어링]({{< relref "../hyperdx/03-s3-cold-tiering.md" >}}) §4가 정본):

```sql
-- logs/traces: hot 14일 → S3, 90일 DELETE
ALTER TABLE default.otel_logs MODIFY TTL
    toDateTime(Timestamp) + INTERVAL 14 DAY TO VOLUME 'cold',
    toDateTime(Timestamp) + INTERVAL 90 DAY DELETE;

-- metrics: hot 30일 → S3, 180일 DELETE
ALTER TABLE default.otel_metrics_gauge MODIFY TTL
    toDateTime(TimeUnix) + INTERVAL 30 DAY TO VOLUME 'cold',
    toDateTime(TimeUnix) + INTERVAL 180 DAY DELETE;
```

`storage_policy`는 볼륨 추가 방향(hot 유지 + cold 추가)이라 스키마 소유자 없이도 안전하게 걸 수 있다. `prefer_not_to_merge`는 설정하지 않는다(기본 false 유지) — true면 S3 위 작은 part가 폭증해 `TOO_MANY_PARTS`로 파국이다 `✓`.

## 3. 세션 리플레이는 왜 S3로 안 내리나

세션 리플레이(rrweb)는 **on-disk 볼륨을 지배하면서도 유용 수명이 가장 짧다** — 인시던트 재현은 사고 직후 며칠 안에 끝나고, 오래된 리플레이의 조회 가치는 급감한다 `≈`. 리플레이를 S3로 내리면 (a) 이동 자체의 쓰기·List/Delete 비용, (b) `{replica}` 경로에 RF배수 사본, (c) 로컬 part metadata 잔존이 붙는데 정작 재조회가 드물어 **순비용**이 된다. 그래서 `hyperdx_sessions`는 `rum_hot_cold` 정책을 붙이지 않고 기본 `default`(EBS only) 정책에 둔 채 30일 DELETE로 끝낸다:

```sql
ALTER TABLE default.hyperdx_sessions MODIFY TTL
    TimestampTime + INTERVAL 30 DAY DELETE;   -- TO VOLUME 'cold' 없음
```

hot EBS 사이징은 sessions 30일치(전 수명)를 상주분으로 포함해야 한다 — 자세한 산정은 [용량 산정]({{< relref "../hyperdx/07-capacity-planning.md" >}}).

## 4. 3티어 결정 분기 — S3 티어링 vs block-only

S3 못/안 쓰는 경로(또는 짧은 보존·운영 단순성 우선)는 **block-only**(`storage_policy`를 내장 `default` 하나로만, TTL은 `... DELETE`만 남기고 `TO VOLUME` 절 제거)가 대안이다. `storage_configuration.xml`·IRSA·cache·`move_factor`·zero-copy 금지 걱정이 통째로 사라지는 대신, 03에서 S3로 내리던 logs/traces/metrics가 전부 gp3에 상주한다.

| 축 | S3 티어링(기본 권고) | block-only(대안) |
|---|---|---|
| 보존 지평 | 6개월~1년+ 우위 | 짧은 보존(≤90일)·staging |
| 운영 표면적 | storage XML·IRSA·cache·이동감시 | 없음 — gp3 PVC만 |
| gp3 상주 배수(07 hot 대비) | 1x(고정) | **1.6x(3개월)~3.7x(12개월)** `≈⁽계산 예시⁾` |
| 성장 레버 | TTL + S3 무한 확장 | gp3 온라인 확장 하나(`provisioner: Operator`) |
| 크로스오버 | ~6개월+부터 명확히 저렴 | ~3개월까지 단순·비용 근접 |

**결정**: 우리 지평(3~12개월)에서는 S3 티어링을 기본 권고로 유지한다. "짧은 보존 + S3 미접근/규정 + 운영 단순성"이 겹치는 경로(대표적으로 staging)에서만 block-only를 고른다. 두 경로는 배타가 아니라 선택이며, sessions는 S3 티어링 안에서도 이미 block-only(hot only·DELETE-only)라 "부분 티어링"이 기본형이다. 상세 델타·DELETE-only DDL·머지 풀 튜닝은 [블록 온리 튜닝]({{< relref "../hyperdx/08-block-only-tuning.md" >}})이 정본이다.

## 5. 핵심 경고 — 티어링은 내구성이 아니다

{{< callout type="error" >}}
- **볼륨 내구성 ≠ 데이터 내구성.** gp3 99.8~99.9%·S3 11 nines은 매체가 그 사본을 안 잃을 확률이지, 우리 데이터가 안전하다는 뜻이 아니다. 데이터 내구성/가용성은 **멀티 AZ RF2+ ReplicatedMergeTree + `clickhouse-backup → S3`**가 담당한다 `✓`.
- **cold(S3)도 RF배수 사본이다.** `metadata_type=local`은 shared-nothing이라 각 replica가 `{replica}` 경로에 자기 사본을 갖는다(RF2면 S3에도 2벌) — "S3라서 사본 1벌로 줄이자"는 **zero-copy replication**은 프로덕션 금지(#45346)다 `✓`. UltraWarm식 단일사본 절감은 self-host에 없다.
- 즉 티어링(hot→cold 이동)은 **비용·조회지연 축**이고, 내구성은 **RF 복제+백업 축**이다. 둘을 같은 결정으로 섞지 않는다.
{{< /callout >}}

## 6. IRSA 미확인 항목

- **CH 서버 disk의 `use_environment_credentials` 실동작**(최소 버전·필수 env·`AWS_EC2_METADATA_DISABLED` 영향)은 스테이징 실측이 필요하다 — 백업 사이드카의 IRSA self-assume 버그(#798)는 확인됐으나 서버 disk 경로는 별개이며 미실측이다 `?`.
- **`region` 명시 필수 여부의 정확한 실패 모드**(STS regional endpoint 서명 오류)는 실측 전까지 근거 수준 `≈`로 둔다.
- **operator issue #1619**(CHI/CHK `reclaimPolicy: Retain` 미준수로 클러스터 삭제 시 볼륨 소실)의 기준 버전 0.27.1 수정 여부는 릴리스 노트 확인 전까지 `?` — 그 전까진 StorageClass 레벨 Retain을 이중으로 건다.
- **part metadata 로컬 소비량**(part 수 비례)의 정량치는 워크로드 의존이라 스테이징 실측이 필요하다 `?`.

## 우리 케이스에서는

- **hot = 노드당 단일 gp3**(baseline IOPS + 인스턴스 baseline에 맞춘 소량 throughput), **cold = S3 Standard + cache disk**로 시작한다. 이동은 시간 기반 TTL이 주도하고 `move_factor=0.1`은 안전판으로만 둔다.
- **세션 리플레이는 hot 30일 DELETE로 고정**하고 S3로 내리지 않는다 — volume 지배 + 유용수명 짧음이라는 두 성질이 겹치는 유일한 신호다.
- **기본 경로는 S3 티어링**이며, block-only는 staging 등 "짧은 보존 + S3 미접근/규정 + 운영 단순성"이 겹칠 때만 채택한다.
- **내구성은 별도 축**이다 — RF2(2 AZ) 복제 + 백업이 담당하고, cold도 RF배수 사본(zero-copy 금지)이라는 원칙을 어떤 티어 선택에서도 흔들지 않는다.
- 배포 전 실측 대기 항목(IRSA 서버 disk 실동작·part metadata 소비량·#1619 수정 버전)은 staging에서 `✓`으로 승격한다. 시점 기준 2026-07.
