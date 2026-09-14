---
title: "블록 스토리지 온리 — S3 없이 EBS 단일 티어 튜닝"
date: 2026-08-01
lastmod: 2026-08-24
weight: 8
---

# S3 없이 EBS에 보관하는 ClickHouse

보관 기간이 짧거나 staging 규모가 작다면 ClickHouse 데이터를 전부 EBS에 두는 구성이 간단합니다. S3 디스크와 캐시, 접근 권한, TTL MOVE를 관리할 필요가 없습니다. 대신 오래된 로그와 트레이스도 삭제할 때까지 EBS 공간을 사용합니다.

월 0.7TB 모델에서는 이 선택의 차이를 계산할 수 있습니다. 3개월 보관은 S3 티어링보다 스토리지 비용이 월 약 $54 늘지만, 1년 보관은 약 $332 늘어납니다. 2026-08 산정 예시이며, 압축비와 단가 가정은 [용량 산정]({{< relref "07-capacity-planning.md" >}})을 따릅니다.

아래에서는 EBS만 사용하는 새 배포의 설정, 용량, 확장, 머지 부하를 다룹니다. 이미 S3에 파트가 있는 클러스터를 전환할 때는 데이터를 옮기기 전에 기존 disk와 policy 정의를 삭제해서는 안 됩니다. StorageClass는 [hot 스토리지·EBS]({{< relref "02-hot-storage-ebs.md" >}}), 티어링 구성은 [S3 콜드 티어링]({{< relref "03-s3-cold-tiering.md" >}}), 노드 중단은 [operator·다운타임]({{< relref "04-operator-topology-downtime.md" >}})에서 이어집니다.

## 1. default 디스크만 사용하기 {#1-무-s3-단일-티어--무엇이-사라지나}

새 배포에서 별도 storage policy를 지정하지 않으면 내장 `default` 정책을 사용합니다. 데이터 경로 `/var/lib/clickhouse`를 gp3 PVC에 마운트하면 됩니다. S3 티어링용 `config.d/storage_configuration.xml`은 넣지 않습니다.

S3 티어링 설정과 비교하면 관리 대상이 줄어듭니다.

| 03에서 필요했던 것 | 블록 온리에서 | 이유 |
|---|---|---|
| `<s3_disk>` disk 정의(endpoint·region·metadata_type) | **불필요** | S3 디스크 없음 |
| `<s3_cache>` cache 디스크(`max_size` 150Gi, LRU) | **불필요** | cold 볼륨 없음 → 캐시 대상 없음¹ |
| IRSA(ServiceAccount·IAM 정책·`use_environment_credentials`·`region`) | **불필요** | CH가 S3 미접속 → IRSA 함정 전부 소거 |
| `{replica}` S3 경로 분리(shared-nothing) | **불필요** | S3 blob 없음 |
| `storage_policy = 'rum_hot_cold'` 테이블 SETTING | **불필요**(또는 명시 `default`) | 기본 정책 그대로 |
| `move_factor`(여유 공간 임계 안전판) | **무의미** | 이동할 다음 볼륨(cold)이 없어 `move_factor`가 개입할 대상이 아예 없음 `≈` |
| `prefer_not_to_merge` 고려 | **무관** | S3 위 작은 part 폭증 이슈가 없음(전부 gp3에서 머지) |
| 금지 3종(S3 lifecycle→Glacier·zero-copy·`prefer_not_to_merge=true`) | **2종 소거** | S3 lifecycle·zero-copy 소거²  |
| 캐시 미스 지연·cold full-scan이 hot 쿼리 잠식 | **소거** | 모든 데이터가 로컬 gp3 → 균일 저지연 |

¹ EBS의 cache 소비항(150Gi)이 통째로 사라져 사이징이 단순해집니다.
² `prefer_not_to_merge` 함정만 여전합니다(default false 유지).

설정 파일과 권한 구성이 줄어드는 만큼 작은 환경에서 준비와 장애 조사가 수월합니다. S3에 파트를 옮겼는지, 캐시가 충분한지 확인할 필요가 없고 디스크 사용량과 머지를 집중해서 볼 수 있습니다.

`move_factor`는 다음 볼륨으로 이동할 여유 공간 임계값입니다. 이동 대상이 없는 이 구성에서는 용량 부족을 해결하지 못합니다. 정의와 티어링에서의 동작은 [S3 콜드 티어링]({{< relref "03-s3-cold-tiering.md" >}}) §1.3에 있습니다.

### 1.1 CHI 볼륨 예시 {#11-chi-storage--default-only-예제}

다음 CHI 예시는 gp3 volumeClaimTemplate만 둡니다. StorageClass의 `WaitForFirstConsumer`와 `Retain` 설정은 [hot 스토리지·EBS]({{< relref "02-hot-storage-ebs.md" >}}) §6의 예시를 함께 적용합니다.

```yaml
apiVersion: "clickhouse.altinity.com/v1"
kind: "ClickHouseInstallation"
metadata:
  name: hyperdx-ch
  namespace: clickhouse
spec:
  defaults:
    storageManagement:
      provisioner: Operator     # ★ 블록 온리 권장: STS 재생성/재시작 없이 온라인 확장(§4.1)
      reclaimPolicy: Retain     # operator 레벨 — CHI 삭제에도 gp3 PVC 잔존
  configuration:
    # files: config.d/storage_configuration.xml  → 블록 온리에선 없음(03에서 삭제)
    clusters:
      - name: main
        layout:
          shardsCount: 1
          replicasCount: 2      # RF2 (2 AZ). 판단·다운타임은 04로 위임
  templates:
    volumeClaimTemplates:
      - name: data-gp3
        reclaimPolicy: Retain
        spec:
          accessModes: ["ReadWriteOnce"]
          storageClassName: clickhouse-gp3   # allowVolumeExpansion: true SC (02 §6 기준 문서)
          resources:
            requests:
              storage: 1500Gi   # 블록 온리는 전량 상주 → 07 hot(~1TB)보다 크게 잡는다(§3)
    # 테이블에 storage_policy 미지정 → 기본 'default' 정책/'default' 디스크 사용
```

## 2. DELETE만 사용하는 TTL {#2-ttl-delete-only--move-없는-보존}

TTL에는 DELETE 기간만 지정합니다. 로그·트레이스 90일, 메트릭 180일, 세션 30일을 두는 예시입니다. 보관 기간별 산정은 [용량 산정]({{< relref "07-capacity-planning.md" >}}) §6과 연결됩니다.

```sql
-- 블록 온리: MOVE 없음, DELETE-only. 보존일 하나로 끝.
-- (아래는 3개월 지평 예시; 지평별 값은 03/07이 기준 문서)
ALTER TABLE default.otel_logs   MODIFY TTL toDateTime(Timestamp) + INTERVAL 90  DAY DELETE;
ALTER TABLE default.otel_traces MODIFY TTL toDateTime(Timestamp) + INTERVAL 90  DAY DELETE;
ALTER TABLE default.otel_metrics_gauge     MODIFY TTL toDateTime(TimeUnix) + INTERVAL 180 DAY DELETE;
ALTER TABLE default.otel_metrics_sum       MODIFY TTL toDateTime(TimeUnix) + INTERVAL 180 DAY DELETE;
ALTER TABLE default.otel_metrics_histogram MODIFY TTL toDateTime(TimeUnix) + INTERVAL 180 DAY DELETE;
ALTER TABLE default.otel_metrics_summary   MODIFY TTL toDateTime(TimeUnix) + INTERVAL 180 DAY DELETE;
ALTER TABLE default.hyperdx_sessions       MODIFY TTL TimestampTime + INTERVAL 30 DAY DELETE;  -- sessions는 03에서도 S3 안 감(hot only)
```

- `ttl_only_drop_parts=1`(ClickStack 관리 테이블 기본): 만료 행을 골라 지우는 대신 part 전체가 만료돼야 통째로 드롭합니다. 파티션이 `toDate`(일 단위)라 정합적이고 part-drop은 머지를 유발하지 않는 값싼 연산입니다. → 블록 온리에서 특히 유리합니다. 삭제가 머지 I/O를 먹지 않아 gp3 대역을 아낍니다.
- `merge_with_ttl_timeout` 기본 14400초(4시간) — "delete TTL 머지를 반복하기 전 최소 지연". `ttl_only_drop_parts=1`이면 whole-part drop이라 이 값을 하향해도 부하가 낮습니다(만료 part 드롭 지연을 줄이려면 하향; 트레이드는 TTL 머지 스캔 빈도↑).
- `MODIFY TTL`은 이후 머지에서 점진 적용되므로 이미 쌓인 과거 파티션을 즉시 정리하려면 `MATERIALIZE TTL`(또는 `materialize_ttl_after_modify`)을 저트래픽 창에 돌립니다(기준 절차는 03·07).

아래 90/180/30일은 배포 오버라이드입니다. 이 글이 확인한 ClickStack OSS 기본은 `${TABLES_TTL}` 단일값이며 문서 예시는 3일이었습니다. 적용 전후 `SHOW CREATE TABLE`로 시간 컬럼과 실효 TTL을 확인합니다. [S3 콜드 티어링]({{< relref "03-s3-cold-tiering.md" >}}) §4.1에도 같은 전제가 있습니다.

## 3. EBS 상주량과 비용 {#3-전량-ebs-보존-사이징-델타-07-대비}

[용량 산정]({{< relref "07-capacity-planning.md" >}})의 압축 후 단일사본 월 0.7TB 모델을 사용합니다. 그 계산에서 S3에 놓았던 데이터를 gp3로 옮겨 계산하면 됩니다.

### 3.1 추가로 EBS에 남는 데이터 {#31-무엇이-gp3로-넘어오나}

리플레이는 S3 티어링 구성에서도 30일 뒤 삭제하므로 두 방식의 차이에 포함되지 않습니다. EBS로 추가되는 양은 hot 기간을 지난 로그·트레이스·메트릭입니다. 따라서 EBS만 쓰는 경우의 상주량은 기존 모델의 hot과 cold를 더한 값입니다.

### 3.2 보관 기간별 상주량 {#32-사이징-표--07-hot-고정-vs-블록-온리-gp3-상주-계산-예시}

| 지평 | 07 hot gp3(단일, 고정) | 07 cold S3(단일) | **블록 온리 gp3 상주(단일)** | 07 hot 대비 배수 |
|---|---|---|---|---|
| 3개월(90일) | 0.63 TB | 0.37 TB | **~1.0 TB** | **~1.6x** |
| 6개월(180일) | 0.63 TB | 0.82 TB | **~1.45 TB** | **~2.3x** |
| 12개월(365일) | 0.63 TB | 1.72 TB | **~2.35 TB** | **~3.7x** |

*(블록 온리 gp3 = 07 hot + 07 cold = 누적 단일. 리플레이 고정분은 양쪽 공통.)*

### 3.3 복제와 머지 여유를 포함한 비용 {#33-물리-gp3rf2-40-머지-헤드룸--07은-고정-블록-온리는-증가-계산-예시}

[용량 산정]({{< relref "07-capacity-planning.md" >}}) §4.6의 RF2 비용과 비교합니다. 사용한 서울 GB 단가는 [hot 스토리지·EBS]({{< relref "02-hot-storage-ebs.md" >}}) §1.3에 있습니다.

| 지평 | 07 hot gp3 물리(고정) | **블록 온리 gp3 물리(×RF2,+40%)** | gp3 요금(서울 $0.0912/GB, RF2) | (참고) 07 hot gp3+S3 요금(서울) |
|---|---|---|---|---|
| 3개월 | ~2.0 TB | 1.0×2×1.4 ≈ **2.8 TB** | ~$255/mo | hot ~$182 + S3 ~$19 ≈ **$201** |
| 6개월 | ~2.0 TB | 1.45×2×1.4 ≈ **4.06 TB** | ~$370/mo | hot ~$182 + S3 ~$41 ≈ **$223** |
| 12개월 | ~2.0 TB | 2.35×2×1.4 ≈ **6.58 TB** | ~$600/mo | hot ~$182 + S3 ~$86 ≈ **$268** |

서울 단가 가정은 gp3 $0.0912/GB-월, S3 Standard $0.025/GB-월입니다. 컴퓨트·Keeper·MongoDB가 같아도 보관 기간이 길어지면 이 저장 단가 차이가 누적됩니다. 3개월의 스토리지 차이는 월 약 $54, 12개월은 약 $332입니다. 다른 리전에 적용할 때는 표의 GB 단가를 교체합니다.

RF2 12개월의 물리량 6.58TB는 노드당 약 3.3TB입니다. 단일 gp3 용량 한도에는 여유가 있으므로 용량 때문에 스트라이핑할 필요는 없습니다. 단일·다중 볼륨 비교는 [hot 스토리지·EBS]({{< relref "02-hot-storage-ebs.md" >}}) §3에 있습니다.

확장은 디스크가 가득 차기 전에 해야 합니다. 여기의 +40%는 저장 데이터량에 곱한 산정 여유이며, 운영 경보는 [용량 산정]({{< relref "07-capacity-planning.md" >}}) §8.1처럼 별도로 둡니다. 백업은 데이터 티어와 별개이므로 `clickhouse-backup`의 S3 백업을 유지할 수 있고, 리플레이 제외 정책도 그대로 적용할 수 있습니다.

## 4. PVC 온라인 확장 {#4-operator-볼륨-튜닝--온라인-확장이-유일한-성장-레버}

보관 기간을 유지하면서 데이터가 늘면 gp3 볼륨을 확장해야 합니다. TTL 단축이나 shard 추가도 가능하지만 배포 구조를 유지하는 일상적인 대응은 온라인 확장입니다.

StorageClass와 Retain 설정은 [hot 스토리지·EBS]({{< relref "02-hot-storage-ebs.md" >}}) §6을, 이미지 업그레이드와 확장의 분리는 [버전·업그레이드 호환성]({{< relref "09-version-upgrade-compat.md" >}})을 함께 참고합니다.

### 4.1 PVC 관리 주체 선택 {#41-storagemanagementprovisioner--statefulset-vs-operator-핵심}

`spec.defaults.storageManagement.provisioner`는 PVC 관리 주체를 정합니다. 이 글이 다루는 operator 0.20+의 두 방식은 다음과 같습니다.

| 값 | 확장 동작 | pod 재시작 | 블록 온리 적합 |
|---|---|---|---|
| **`StatefulSet`**(기본) | `volumeClaimTemplates` 불변 → 확장 시 **STS 재생성·CH 재시작** | **있음**(비쌈) | △ 확장 잦으면 비용↑ |
| **`Operator`** | operator가 PVC 직접 수정 → **재시작 없이** 온라인 확장¹ | **없음** | **✅ 블록 온리 권장** — 무중단 확장 이점 |

¹ STS에서 VolumeClaimTemplate을 제거하고 operator가 PVC를 직접 수정하는 방식. CSI `allowVolumeExpansion` 전제.

- 전환 주의: 기존 CHI에서 `StatefulSet`→`Operator`로 바꾸면 operator가 기존 STS-생성 PVC를 넘겨받는데 이 전환 자체가 재시작 1회를 요구합니다(그래서 기본값이 아닙니다). 처음부터 `Operator`로 시작하는 편이 깔끔합니다.
- SC에 `allowVolumeExpansion: true`는 필수입니다. `reclaimPolicy: Retain`(operator 레벨 + SC 레벨 이중)으로 실수 삭제를 막습니다 — 기준 예제는 [02 §6]({{< relref "02-hot-storage-ebs.md" >}}).

### 4.2 EBS 볼륨 수정 한도 {#42-ebs-elastic-volumes--2026-01-15-6시간-쿨다운-폐지-}

EBS 수정 한도도 확장 계획에 반영합니다. 2026-07에 확인한 내용은 2026-01-15 변경된 Elastic Volumes 한도를 따릅니다.

- 이전: 볼륨을 1회 수정하면 6시간 대기가 필요했습니다.
- 현행(2026-07): 롤링 24시간 창당 최대 4회까지 수정하되 직전 수정이 끝나야 다음을 시작할 수 있습니다.
- OPTIMIZING 상태 제약은 그대로입니다. 수정 직후 볼륨이 `OPTIMIZING`으로 들어가고 그 동안엔 다시 수정할 수 없습니다(`cannot be modified in modification state OPTIMIZING`). 대형 볼륨은 OPTIMIZING이 수 시간 걸리고 그동안 성능에 영향이 있을 수 있습니다.
- 4회를 넘기면 `You've reached the maximum modification rate per volume limit`. gp2/gp3 모두 적용되고 리전 제약은 명시되지 않았습니다(도쿄 검증; 서울 `ap-northeast-2`도 동일 가정).

수정 횟수와 OPTIMIZING 시간을 감안해 한 번 확장할 때 충분한 여유를 확보합니다. 목표 사용량의 1.3~1.5배 같은 값은 계획용 예시이며 실제 증가 속도와 확장 소요 시간에 맞춰 정합니다.

### 4.3 확장 절차와 알려진 이슈 {#43-확장-절차--데이터-손실-함정}

```yaml
# 온라인 확장: PVC의 requests.storage만 키운다 (provisioner: Operator + allowVolumeExpansion SC 전제)
# kubectl patch pvc <pvc-name> -n clickhouse --type merge \
#   -p '{"spec":{"resources":{"requests":{"storage":"2000Gi"}}}}'
# → EBS ModifyVolume → OPTIMIZING → 파일시스템 온라인 확장(재시작 없음)
```

{{< callout type="error" >}}
PVC를 확장하기 전에 배포 operator 버전으로 같은 절차를 시험하고 백업을 확보합니다. 다음 이슈는 확장이 항상 안전하게 끝난다고 가정할 수 없는 이유입니다.

1. issue #1385에는 operator 0.22.2에서 volumeClaimTemplate 크기 변경 시 PVC가 삭제·재생성된 회귀가 보고됐습니다. `storageManagement` 미설정 시 반복 재생성 사례도 있습니다. `provisioner: Operator`를 통한 확장이나 PVC 직접 수정 경로도 사용 버전에서 검증한 뒤 적용합니다. 0.27.1의 수정 여부는 이 글에서 확정하지 못했습니다.
2. issue #1263은 CHI 재생성 후 PVC 리사이즈 실패, #457은 AKS 스토리지 rescale 실패 사례입니다.
3. issue #1619에는 CHI·CHK의 `reclaimPolicy: Retain`에도 삭제 과정에서 볼륨을 잃은 사례가 있습니다. StorageClass의 Retain과 실제 삭제 동작을 별도 시험 환경에서 확인합니다. [EBS 볼륨 보존]({{< relref "02-hot-storage-ebs.md" >}})에서도 다룹니다.

{{< /callout >}}

### 4.4 단일 gp3 볼륨의 범위 {#44-단일-대형-gp3-vs-다중-gp3-위임}

이 모델의 노드당 데이터량은 단일 gp3에 들어갑니다. 여러 볼륨을 붙여도 인스턴스 EBS 대역 한도는 공유하므로 볼륨 수를 늘리는 것만으로 처리량이 증가한다고 볼 수 없습니다. 선택 근거는 [hot 스토리지·EBS]({{< relref "02-hot-storage-ebs.md" >}}) §3에 있습니다.

## 5. 디스크와 머지 부하 조정 {#5-커지는-상주-데이터-튜닝--merge--background-pool}

상주 데이터가 늘면 파트 수와 스캔 범위도 커질 수 있습니다. 다만 보관량 배수만큼 머지 부하가 반드시 늘어나는 것은 아닙니다. 실제 백로그와 디스크 대역을 보고 throughput, 머지 동시성, 파트 크기를 조정합니다.

### 5.1 throughput을 올리기 전에 {#51-gp3-provisioned-iops--throughput-상향-시점}

- gp3 baseline = 3,000 IOPS / 125 MiB/s(무료). ClickHouse는 throughput-bound라 먼저 오르는 건 throughput입니다(스펙·요금·인스턴스 파이프 천장은 [02]({{< relref "02-hot-storage-ebs.md" >}}) 기준 문서).
- 블록 온리 트리거: 상주 데이터↑ → 백그라운드 머지가 대형 순차 read+write로 gp3 대역을 지속 점유 → `system.asynchronous_metrics`·EBS 대역 지표에서 baseline 125 MiB/s를 지속 초과하면 provisioned throughput을 인스턴스 baseline까지 올립니다(예: r7g.2xlarge baseline 312 MB/s에 맞춰 ~300 MiB/s). IOPS는 대개 baseline 3,000으로 충분합니다(인스턴스 EBS IOPS 자체가 먼저 천장).
- 인스턴스 파이프가 볼륨보다 먼저 천장이라 볼륨 provisioning보다 노드 사이즈업(r7g→더 큰 크기/r8g)이 먼저 효과를 낼 수 있습니다 — 순서는 [02 §1.4]({{< relref "02-hot-storage-ebs.md" >}}) 기준 문서.

### 5.2 머지 풀과 파트 크기 설정 {#52-background--merge-풀-노브-}

머지 큐가 밀릴 때 살펴볼 설정은 다음과 같습니다. 아래 값은 이 글의 확인 버전에서 사용한 설명이며, 실효 기본값은 배포 서버에서 조회합니다. 여러 값을 한꺼번에 바꾸지 않고 병목과 관련된 항목부터 시험합니다.

- `background_pool_size`(기본 16) — 백그라운드 머지·뮤테이션 스레드 수. 튜닝: 상주 데이터·머지 백로그↑ 시 상향(beefy 노드는 코어 수에 맞춰 예: 32~36).
- `background_merges_mutations_concurrency_ratio`(기본 2) — 동시 머지 = pool_size × ratio이므로 기본은 16×2=32입니다. 튜닝: 백로그 청산엔 1로 낮춰 큰 머지에 스레드를 몰아줍니다. 런타임 상향만 되고 하향은 재시작입니다.
- `max_bytes_to_merge_at_max_space_in_pool`(기본 ~150 GB) — 자원 충분 시 한 머지로 합칠 최대 part 합. 튜닝: 큰 part 위주 백로그면 조정합니다. 너무 크면 단일 머지가 gp3 대역을 독점합니다.
- `number_of_free_entries_in_pool_to_lower_max_size_of_merge`(기본 8) — 여유 풀 슬롯이 이 값보다 적으면 최대 머지 크기를 지수적으로 낮춥니다(작은 머지 우선). 튜닝: aggressive는 pool_size의 90~95%(예 pool 36→32). 작은 part 적체를 막습니다.
- `max_bytes_to_merge_at_min_space_in_pool`(기본 양수) — 디스크 여유가 부족해도 허용하는 최대 머지 크기. 튜닝: `TOO_MANY_PARTS` 방어용입니다. 블록 온리는 여유가 빠듯해질 수 있어 관련성↑.

- 머지는 디스크 여유를 예약합니다 — 합쳐질 part 합의 약 2배를 booking합니다. 그래서 "여유 공간은 있는데 진행 중 대형 머지가 예약해버려 다른 머지가 못 시작 → 작은 part 누적 → `TOO_MANY_PARTS`" 상황이 블록 온리(꽉 찬 gp3)에서 특히 잘 납니다. → 헤드룸 30~40%는 성능이 아니라 안정성 문제입니다.
- aggressive 튜닝 주의: "저지연 read/write를 상시 유지해야 하거나 이미 디스크 대역이 병목이면 aggressive 머지는 역효과". 블록 온리 gp3 대역이 빠듯하면 오히려 머지 동시성을 낮춥니다.
- `move_factor`는 무의미합니다(cold 볼륨 없음, §1). 튜닝 대상에서 뺍니다.

{{% details title="정확한 실효 기본값은 배포 버전에서 확인" closed="true" %}}
- `max_bytes_to_merge_at_max_space_in_pool`은 ClickHouse docs가 `0`(=컴파일 기본)으로 표기하나 실효 기본은 ~150 GB(161061273600 바이트)입니다. 정확한 상수는 `SELECT * FROM system.merge_tree_settings WHERE name LIKE 'max_bytes_to_merge%'`로 확인합니다.
- `parts_to_throw_insert`(파티션당)는 관례 기본 300이나 최신 버전에서 상향된 정황이 있어 배포 버전 `system.merge_tree_settings`로 확정합니다.
{{% /details %}}

### 5.3 파트 생성 속도 줄이기 {#53-part-적체-방어-insert-스로틀-}

- `parts_to_delay_insert` 초과 시 INSERT 인위 지연, `parts_to_throw_insert`(파티션당, 관례 기본 300) 초과 시 `TOO_MANY_PARTS` 예외, `max_parts_in_total` 초과 시 INSERT 중단.
- 블록 온리에서 데이터·파티션이 많아지면 배치/`async_insert` 튜닝으로 part 생성 빈도를 낮춥니다(기준 경보표는 [07 §8.2]({{< relref "07-capacity-planning.md" >}}): 파티션당 active parts >300 조치).

### 5.4 디스크·머지·파트 조회 {#54-모니터링-block-only-관점-}

```sql
-- 디스크 여유(머지 헤드룸): 블록 온리는 default 하나만 나온다 (s3_disk/s3_cache 없음)
SELECT name, type, path,
       formatReadableSize(free_space) AS free, formatReadableSize(total_space) AS total,
       round(100*(total_space-free_space)/total_space,1) AS used_pct
FROM system.disks;

-- 진행 중 머지(예약 공간·소요) — 대형 머지가 여유를 booking 중인지
SELECT database, table, elapsed, progress,
       formatReadableSize(memory_usage) AS mem,
       formatReadableSize(bytes_read_uncompressed) AS read_u,
       num_parts
FROM system.merges ORDER BY elapsed DESC;

-- 테이블·파티션별 part 수·크기 (전부 disk_name='default' 여야 정상 — cold 없음)
SELECT table, partition, disk_name, count() AS parts,
       formatReadableSize(sum(bytes_on_disk)) AS size
FROM system.parts WHERE database='default' AND active
GROUP BY table, partition, disk_name ORDER BY parts DESC;
```

- 블록 온리 헬스 지표: (a) `system.disks.used_pct` < 80%, (b) 파티션당 active parts < 300, (c) `system.merges`에 장시간 정체 머지 없음, (d) EBS 대역(baseline 125 MiB/s 지속 초과 시 §5.1). `system.disks`에 `default` 외 디스크가 보이면 블록 온리 전제가 깨진 것입니다(어딘가 storage_configuration이 살아 있습니다).

## 6. EBS 보관과 S3 티어링 선택 {#6-언제-블록-온리-vs-s3-티어링-결정}

두 구성 모두 세션 리플레이는 EBS에서 짧게 보관합니다. 선택이 달라지는 데이터는 오래된 로그·트레이스·메트릭입니다. 이 데이터의 보관 기간과 운영 부담을 비교합니다.

| 축 | **블록 온리(EBS only)** | **S3 티어링(03)** |
|---|---|---|
| 보존 기간 | **짧음(30~90일)** | 김(180일~1년+) |
| 운영 단순성 | **최상**(storage XML·IRSA·S3·lifecycle·cache·이동감시 전부 없음) | 복잡(§1 전부 관리) |
| S3 접근성 | **S3 미접근/규정상 오브젝트 금지** 환경 | S3 사용 가능 |
| 규모 | 소규모(누적 gp3가 부담 없는 수준)·staging | 누적↑로 gp3 비용이 커질 때 |
| 스토리지 비용 | 짧은 보존에서 근접, 긴 보존에서 발산(서울 gp3 **3.65x**/GB, §3) | 긴 보존에서 우위(서울 cold **$0.025**/GB) |
| 크로스오버 | ~3개월까지 블록 온리가 단순하고 비용 근접 | ~6개월+부터 S3 티어링이 명확히 저렴 |

{{< flow src="_flow/6-언제-블록-온리-vs.json" />}}

- io2 전환 트리거(>2,000 MiB/s 지속·>80,000 IOPS/vol·볼륨 99.999% 규제)는 [02]({{< relref "02-hot-storage-ebs.md" >}}) 기준 문서 — 블록 온리든 티어링이든 RUM 0.7TB/월엔 도달하지 않습니다.
- staging 경로: staging은 데이터가 작고 보존도 짧아 블록 온리가 자연스럽습니다 — storage XML·IRSA 없이 gp3 하나로 띄우고 prod만 S3 티어링을 추가하는 조합도 유효합니다.

## staging에서 prod로 옮길 때 {#우리-케이스에서는}

현재 stage의 실제 구성은 [우리 배포 형상]({{< relref "../../hyperdx-operating/01-our-deployment.md" >}})에 기록합니다. 짧은 보관과 작은 데이터량에서는 EBS만 사용하는 편이 설정과 운영을 단순하게 유지하기 좋습니다. prod의 보관 기간이 6개월 이상으로 늘어나면 [의사결정 가이드]({{< relref "../../hyperdx-operating/03-decision-guide.md" >}})의 cold 선택과 위 비용표를 다시 검토합니다.

EBS만 유지한다면 `default` 정책과 DELETE TTL을 사용하고, PVC 온라인 확장을 미리 시험합니다. 디스크 사용률과 part 적체가 증가할 때 볼륨 용량 부족인지 머지 I/O 부족인지 구분해야 합니다. 용량 문제에 머지 스레드만 늘리면 오히려 여유 공간과 대역을 더 소모할 수 있습니다.

업그레이드 전 스냅샷과 복구 절차는 [버전·업그레이드 호환성]({{< relref "09-version-upgrade-compat.md" >}})을 따릅니다. S3 데이터 티어를 없애도 백업과 복구 검증은 필요합니다. 수치와 설정은 2026-08 정리 시점의 예시입니다.
