---
title: "버전 호환성·업그레이드 — 스택 전 구성요소 매트릭스와 EBS 롤백"
date: 2026-08-01
lastmod: 2026-08-24
weight: 9
url: "/hyperdx/09-version-upgrade-compat/"
---

# HyperDX 스택 업그레이드와 데이터 복원

HyperDX 앱 이미지를 올리는 일과 ClickHouse 데이터를 새 버전으로 여는 일은 복구 방법이 다릅니다. 앱은 이전 이미지로 돌아갈 수 있어도 ClickHouse가 새 포맷으로 기록한 파트는 이전 바이너리가 읽지 못할 수 있습니다. 업그레이드 전에 호환 버전뿐 아니라 되돌릴 데이터 사본도 준비해야 합니다.

이 구성은 ClickHouse·Keeper·Altinity operator·HyperDX·OTel Collector·MongoDB를 각각 관리합니다. 아래 버전표는 2026-07 확인값이며 저장 포맷 항목은 2026-08 조사 내용을 포함합니다. 현재 권장 최신 버전 목록이 아니라 이 배포안의 호환 관계와 미확인 항목을 기록한 것입니다.

실제 롤링 순서와 CRD 관리는 [operator 운영]({{< relref "/data/clickhouse/operations/05-altinity-operations.md" >}}), EBS 재부착 시간은 [operator 토폴로지·다운타임]({{< relref "/observability/hyperdx/design/04-operator-topology-downtime/index.md" >}})에 있습니다. 여기서는 버전 선택과 복원 가능성을 연결해 봅니다.

## 1. 구성요소별 호환 관계 {#1-버전-호환성-매트릭스--스택-전-구성요소}

`clickhouse.enabled: false`로 ClickHouse와 Keeper를 [Altinity CHI/CHK에 분리]({{< relref "/observability/hyperdx/design/01-stack-topology/index.md" >}})합니다. 따라서 ClickStack 차트의 기본 ClickHouse 이미지가 외부 클러스터의 태그를 정하지는 않습니다. 차트 기본값, 앱의 최소 요구 버전, 실제 배포 태그를 각각 기록합니다.

### 1.1 2026-07에 확인한 버전 관계 {#11-마스터-매트릭스-2026-07-확인}

배포안을 확인할 때 대조할 관계는 다음과 같습니다. 요구 하한과 차트 기본값을 구분해 적었습니다.

- ① ClickStack/HyperDX ↔ ClickHouse — 최소 24.8 LTS 이상(24.8·25.x 지원). self-host에서 외부 CH 참조 시 24.8+ 필수 ().
- ② ClickStack 차트 기본 CH 이미지 — `clickhouse/clickhouse-server:25.7-alpine`(차트가 실제 배포하는 태그) ( — 최소요구(24.8)와 차트기본(25.7)은 다른 숫자).
- ③ HyperDX app ↔ CH 스키마/기능 — `LowCardinality`·`Map`·bloom filter 2차 인덱스·`TTL ... ttl_only_drop_parts` 등 MergeTree 표준 기능만 씁니다 → 하한이 24.8 LTS로 낮게 유지됨(신규 JSON 타입 강제 아님) ().
- ④ MongoDB ↔ HyperDX — 5.0.32(차트 기본), ReplicaSet(차트 기본 `members:1`). 메타데이터 전용이라 버전 민감도가 낮음 ( — 부하 프로파일은 {{< relref "/observability/apm-rum/07-hyperdx-mongodb.md" >}}).
- ⑤ OTel Collector ↔ ClickStack — `docker.clickhouse.com/clickstack-otel-collector:2.29.0`, mode: deployment. ClickStack 배포판(표준 upstream 아님) ( — persistent queue 확장 포함 여부는 {{< relref "/observability/hyperdx/design/05-keeper/index.md" >}} §옵션A로 재확인).
- ⑥ HyperDX 이미지 ↔ 차트 — `docker.hyperdx.io/hyperdx/hyperdx`, 태그 미지정 시 차트 `appVersion` 추종. 명시 오버라이드하면 appVersion과 어긋날 수 있음 ().
- ⑦ Altinity operator 0.27.1 ↔ CH / K8s — operator 0.27.1 → CH 21.11+, K8s 1.25+. 더 오래된 CH는 operator 0.23.7 이하 필요 ( — 우리 CH(24.8~25.x)는 여유롭게 범위 안).
- ⑧ Altinity operator ↔ CRD apiVersion — CHI=`clickhouse.altinity.com/v1`, CHK=`clickhouse-keeper.altinity.com/v1`. operator가 CRD를 소유(Helm이 기존 CRD 미수정) ().
- ⑨ operator 0.27.0+ 기본값 ↔ Keeper 버전 — operator 0.27.0+가 `async_replication`/`use_xid_64`를 기본 활성화 → Keeper 25.3+ 필요 ( — 매트릭스 함정, §1.4).

### 1.2 이미지 태그와 변경 단위 {#12-매트릭스에서-나오는-실전-결정-3가지}

이 배포안은 CHI의 `podTemplate`에서 ClickHouse 이미지를 고정합니다. 24.8 LTS를 예시로 사용하지만 최소 요구 버전을 충족한다는 사실만으로 이후 모든 기능 조합의 호환성이 보장되지는 않습니다.

Keeper 태그는 별도로 관리합니다. 서버와 같은 24.8을 검토한 안은 아래 operator 0.27+ 기본값과 충돌 가능성이 남아 있으므로 확정된 조합으로 취급하지 않습니다. 서버와 Keeper를 같은 작업에서 동시에 올리지 않고 한 구성요소의 상태를 확인한 다음 다음 변경을 진행합니다.

이미지·설정 변경을 한 reconcile에 몰아넣으면 장애 원인을 구분하기 어렵습니다. [이미지와 설정의 동시 변경 이슈 #1926]({{< relref "/data/clickhouse/operations/05-altinity-operations.md" >}})도 있어 변경 단위를 분리합니다.

### 1.3 최소 버전과 차트 기본 태그 {#13-정정--최소-248과-차트-기본-257은-모순이-아니다-}

ClickStack의 “24.8+”는 문서에 적힌 호환 하한이고, `25.7-alpine`은 확인 당시 차트의 기본 배포 태그입니다. 외부 ClickHouse를 사용하므로 실제 태그는 CHI에서 선택합니다. 하한을 충족한 뒤에도 사용하는 기능과 operator·Keeper 조합을 확인해야 합니다.

### 1.4 operator 0.27과 Keeper 24.8 확인 {#14-매트릭스-함정--operator-027-기본값--keeper-253-}

operator 0.27.0+의 `async_replication`·`use_xid_64` 기본 활성화와 Keeper 25.3+ 요구가 이 배포안의 미확인 조합입니다. CH와 Keeper를 모두 24.8로 고정하면 operator 기본값을 그대로 사용할 수 있는지 확인해야 합니다.

스테이징에서 렌더링된 설정과 기동 로그를 확인합니다. operator가 Keeper 버전에 맞춰 값을 조정하는지는 미검증입니다. 필요하면 해당 기능을 명시적으로 끄거나 Keeper 25.3+ 조합을 시험합니다. 검증이 끝나기 전에는 “CH/Keeper 24.8 + operator 0.27.1”을 운영 확정 버전표에 넣지 않습니다.

### 1.5 저장 기능의 미확인 항목 {#15-문서에-있지만-아직-못-쓰는-것-}

2026-08 조사에서는 아래 저장 기능의 OSS 가용성을 확정하지 못했습니다. 도입 근거로 사용하지 않고 재검토할 항목으로 남깁니다.

- Packed storage (`min_level_for_full_part_storage`, 25.10) — 기본값이 0 = Full storage라 켜지 않으면 동작이 바뀌지 않습니다. 가용성 진술은 문서마다 다릅니다 — 공식 표는 Availability를 "Open source and Cloud"로 적는데 별도 조회에서는 "Cloud 전용"이라는 상충 진술이 나옵니다 → OSS 실제 동작 미확정. 문서가 드는 효과(insert당 PUT 31.3 → 2.22)가 사실이면 S3 요청 비용 구조가 바뀌므로 켤지 말지는 지금 정하지 않고 실측 대상으로만 남깁니다.
- `system.parts.part_storage_type`은 OSS 26.9부터 노출 예정이고 2026-08 기준 최신 출시는 26.7입니다. 지금은 어떤 출시본에도 없어서 part가 어느 저장 형태로 쓰였는지를 이 컬럼으로 확인할 수 없습니다. 위 Packed storage 검증이 여기서 막힙니다.

Keeper 조합은 스테이징의 설정과 기동 결과로 확인할 수 있습니다. Packed storage와 새 시스템 컬럼은 당시 문서와 출시 상태에 불확실성이 남았습니다. 26.9 출시 여부와 실제 배포 버전의 기능을 확인할 때 다시 검토하고, 그전에는 이 기능을 전제로 비용이나 롤백 절차를 정하지 않습니다.

## 2. compatibility로 기본값 유지하기 {#2-compatibility-서버-설정--업그레이드-안전-노브}

### 2.1 적용 범위 {#21-무엇인가-}

`compatibility`에 `'24.8'` 같은 버전 문자열을 지정하면 명시적으로 바꾸지 않은 설정의 기본값을 해당 버전에 맞춥니다. 빈 값이면 비활성이고 사용자가 override한 값은 유지합니다.

바이너리 교체와 기본값 변경을 나누어 검증할 때 사용할 수 있습니다. 다만 쿼리 엔진의 모든 변화나 저장 포맷을 이전 상태로 되돌리는 기능은 아닙니다.

### 2.2 설정 위치 {#22-어디에-넣나-}

| 레벨 | 방법 |
|---|---|
| 세션 | `SET compatibility = '24.8';` |
| 쿼리 | `SELECT ... SETTINGS compatibility = '24.8'` |
| 프로파일(영속) | `users.xml` 프로파일에 지정 → Altinity에서는 **CHI `configuration.profiles`로 선언**(operator가 XML 렌더) |

Altinity에서는 CHI의 `configuration.profiles`로 선언하고 operator가 렌더링한 프로파일을 확인합니다.

```yaml
apiVersion: "clickhouse.altinity.com/v1"
kind: "ClickHouseInstallation"
metadata:
  name: hyperdx-ch
  namespace: clickhouse
spec:
  configuration:
    profiles:
      # 업그레이드 직후 이 프로파일을 쓰는 모든 세션이 24.8 기본값으로 동작한다.
      # 스테이징에서 새 기본값을 하나씩 검증한 뒤 이 핀을 제거/상향한다.
      default/compatibility: "24.8"
```

### 2.3 업그레이드 중 사용 방법 {#23-언제-쓰나-}

기존 기본값을 유지한 채 바이너리를 올려 쿼리 결과·성능·리소스 사용을 비교합니다. 이후 새 기본값을 시험하고 `compatibility`를 해제하거나 상향합니다. 롤링 중 동작 차이를 줄이는 보조 수단으로도 쓸 수 있지만, [혼합 버전 호환 범위]({{< relref "/data/clickhouse/operations/05-altinity-operations.md" >}})를 늘려 주지는 않습니다.

`compatibility='24.8'`을 설정해도 새 버전이 기록한 파트를 24.8이 읽을 수 있게 되는 것은 아닙니다. 바이너리 다운그레이드 가능성은 다음의 저장 포맷 조건으로 따로 판단합니다.

## 3. 이전 ClickHouse 버전으로 돌아가기 {#3-다운그레이드-정책--ch는-함부로-못-내린다}

### 3.1 저장 포맷의 제약 {#31-핵심-명제-}

다운그레이드는 되돌아갈 버전이 현재 파트와 사용 기능을 읽을 수 있을 때만 가능합니다. 공식 [self-managed 업그레이드 문서](https://clickhouse.com/docs/guides/oss/update)도 새 기능을 사용하지 않은 경우 최근 버전으로 돌아갈 수 있을 수 있다고 조건부로 설명합니다.

이미지를 바꾸는 데 성공해도 파트를 읽지 못하면 기동이 실패하거나 `detached/broken-on-start_*`로 분리될 수 있습니다. 업그레이드 전 데이터 사본을 확보하는 이유입니다.

### 3.2 다운그레이드 비호환 사례 {#32-다운그레이드가-불가능해지는-트리거-2026-확인--차단-버전의-단일-정본}

다음 표는 확인했던 비호환 사례입니다. 새 포맷을 사용하기 시작한 버전과 그 포맷을 읽을 수 있는 최소 버전을 구분합니다. 실제 다운그레이드 가능 여부는 출발·도착 버전과 기록된 파트에 대해 검증해야 합니다.

| 트리거 | 효과 | 근거 |
|---|---|---|
| **JSON advanced shared data 기본 활성화(v25.12)** | 새 JSON 컬럼 파트를 못 읽음 → **25.8 미만 롤백 불가** | `✓⁽v25.12 BIC⁾` |
| **String `with_size_stream` 직렬화 기본 활성화(v25.11)** | 새 포맷은 25.10+ 지원 → **미만 롤백 불가** | `✓⁽v25.11 BIC⁾` |
| **marks 포맷 변경(25.8)** | 25.3.1이 25.8.2 파트 marks를 못 읽어 startup fatal¹ → **25.8→25.3 롤백 불가** | `✓⁽issue #86837⁾` |
| **24.7의 pre-21 온디스크 포맷 비호환** | 24.7 기동 시 파트 detach → 24.6 복귀 시 재attach 필요 | `✓/≈⁽#68198·#68408⁾` |
| **`OPTIMIZE TABLE ... FINAL` 실행** | 파트를 새 버전 포맷으로 재작성 → 롤백 창을 스스로 닫음 | `✓` |
| **신규 컬럼 타입(`Variant`/`JSON`)으로 신규 데이터 적재** | 옛 버전이 그 파트를 못 읽음 | `✓` |

¹ `getMarksTypeFromFilesystem` 함수에서 fatal 발생.

포맷이 바뀌어 이전 바이너리로 읽을 수 없다면 업그레이드 전 백업이나 스냅샷으로 복원해야 합니다. 표의 버전 숫자만 보고 모든 데이터셋의 롤백을 보장할 수는 없습니다.

### 3.3 관찰 기간과 백업 준비 {#33-롤백-창을-여는-규칙--실질-롤백-경로-}

업그레이드 후 24~48시간을 관찰하는 동안 `OPTIMIZE ... FINAL`, 새 컬럼 타입과 기능 사용, 새 시스템 컬럼을 참조하는 MV 도입을 미룹니다. 그렇다고 이 작업들만 피하면 포맷이 유지된다고 보장할 수는 없습니다. 일반 INSERT와 백그라운드 머지도 파트를 기록하므로 대상 버전의 변경 사항을 확인해야 합니다.

복구에는 업그레이드 전의 스키마와 데이터가 필요합니다. `system.tables`에서 생성 SQL을 저장하고 `BACKUP DATABASE ...` 또는 `clickhouse-backup create_remote`로 사본을 확보합니다. 아래 명령은 백업 이름과 스키마를 남기는 예시이며, restore 순서는 사용 도구와 배포 형태에서 사전 검증한 런북을 따릅니다.

```sql
-- 업그레이드 직전 스키마 스냅샷 (롤백 시 대조용)
SELECT database, name, create_table_query
FROM system.tables
WHERE database NOT IN ('system','INFORMATION_SCHEMA','information_schema')
FORMAT TSVRaw;
```

```bash
# 업그레이드 직전 백업 (clickhouse-backup: FREEZE + S3 업로드)
clickhouse-backup create_remote pre-upgrade-$(date +%Y%m%d)
# 실패 시 복구: 서버 stop → restore → 패키지 다운그레이드 → start
clickhouse-backup restore_remote pre-upgrade-YYYYMMDD
```

## 4. EBS 스냅샷 복원 {#4-ebs블록-온리-특유-업그레이드-안전}

EBS에 데이터가 모두 있다면 정지한 replica의 업그레이드 전 볼륨 스냅샷을 남길 수 있습니다. 해당 시점의 데이터로 돌아가는 방법이므로 이후 유입된 데이터의 처리와 Keeper 메타데이터도 복구 계획에 포함해야 합니다.

### 4.1 replica 볼륨의 스냅샷과 복구 {#41-ebs-스냅샷--롤백-경로-aws}

EBS 스냅샷은 시점 백업이며 첫 스냅샷 이후에는 변경분을 저장합니다. 일관된 사본을 얻기 위해 해당 replica의 쓰기를 멈춘 상태에서 생성합니다. 스냅샷 전송은 비동기로 진행되므로 완료 여부도 확인합니다.

복원할 때는 스냅샷에서 새 gp3 볼륨을 만들고 PV/PVC 연결을 교체합니다. replica별로 순차 업그레이드하면 실패한 replica만 복원하는 경로를 검토할 수 있습니다. 다만 다른 replica에서 다시 가져올 파트도 이전 바이너리가 읽을 수 있어야 합니다. 스냅샷 복원 후 무조건 [델타 catch-up]({{< relref "/observability/hyperdx/design/04-operator-topology-downtime/index.md" >}})하면 된다고 가정하지 않습니다.

{{< seq src="_seq/4-1-ebs-스냅샷-롤백-경로.json" />}}

```bash
# 실패 시: 업그레이드 전 스냅샷에서 gp3 볼륨 복원
aws ec2 create-volume \
  --snapshot-id snap-0abc... \
  --volume-type gp3 \
  --availability-zone ap-northeast-2a   # 원 볼륨과 같은 AZ (EBS는 AZ-bound)
# → 새 volume-id를 PV의 volumeHandle로 교체하고 PVC를 재바인딩
```

이 예시는 원래 Pod를 같은 AZ에 다시 배치하는 경로입니다. EBS 볼륨은 연결할 노드와 같은 AZ에 있어야 합니다. [operator 토폴로지·다운타임]({{< relref "/observability/hyperdx/design/04-operator-topology-downtime/index.md" >}})의 재부착 조건과 함께 확인합니다.

### 4.2 볼륨 확장과 업그레이드 분리 {#42-allowvolumeexpansion--업그레이드-순서-상호작용-}

- gp3 온라인 확장(`allowVolumeExpansion: true`)과 CH 버전 업그레이드는 별도 reconcile로 분리합니다 — [이미지+설정 동시변경 crash(#1926)]({{< relref "/data/clickhouse/operations/05-altinity-operations.md" >}})와 같은 결의 위험입니다. 볼륨 확장 중 롤링을 겹치면 STS 업데이트 경합이 생길 수 있습니다.
- 확장 경로의 데이터손실 주의(issue #1385)와 온라인 확장 상세는 [블록 온리 튜닝]({{< relref "/observability/hyperdx/design/08-block-only-tuning/index.md" >}}).

### 4.3 PVC와 PV 보존 설정 {#43-pvc-retain으로-실수-삭제-방어-}

PVC와 PV의 보존 정책을 확인해 리소스 재생성이 데이터 볼륨 삭제로 이어지지 않게 합니다. operator와 StorageClass에 `Retain`을 선언하더라도 알려진 이슈 #1619가 있으므로 실제 삭제 동작을 검증해야 합니다. 설정과 이중 방어는 [hot 스토리지·EBS]({{< relref "/observability/hyperdx/design/02-hot-storage-ebs/index.md" >}})에 있습니다.

### 4.4 S3 데이터 티어가 없는 경우 {#44-블록-온리무-s3의-업그레이드-단순성-}

EBS만 쓰면 로컬 파트 메타데이터와 S3 오브젝트를 함께 복원할 필요가 줄어듭니다. 그래도 스냅샷 하나로 클러스터 전체 상태가 자동 복구되는 것은 아닙니다. Keeper 상태와 다른 replica의 포맷을 포함해 복원 절차를 시험합니다. 볼륨 운영은 [블록 온리 튜닝]({{< relref "/observability/hyperdx/design/08-block-only-tuning/index.md" >}}), S3가 있는 경우는 [S3 cold 티어링]({{< relref "/observability/hyperdx/design/03-s3-cold-tiering/index.md" >}})을 함께 봅니다.

## 5. ClickStack 차트 업그레이드 {#5-clickstackhyperdx-업그레이드-경로}

### 5.1 Helm v1에서 v2로 바뀌는 리소스 {#51-clickstack-helm-v1--v2--파괴적-변경-upgrademd}

| 컴포넌트 | v1.x (before) | v2.x (after) |
|---|---|---|
| MongoDB | 인라인 Deployment | **MongoDB K8s Operator(MCK)의 `MongoDBCommunity` CR** |
| ClickHouse | 인라인 Deployment | **ClickHouse Operator의 `ClickHouseCluster` + `KeeperCluster` CR** |
| OTel Collector | 인라인 `otel.*` 블록 | **공식 OTel Collector Helm subchart** |

- 2단계 설치: `helm install clickstack-operators ...` → `helm install my-clickstack ...`. uninstall은 역순입니다.
- in-place 업그레이드 금지 권고: 문서는 "기존 MongoDB/ClickHouse Deployment가 Helm에 의해 삭제된다"며 기존 배포 옆에 fresh install 후 데이터 마이그레이션을 권합니다(in-place 아님).
- PVC 보호: MongoDB/ClickHouse operator가 만든 PVC는 `helm uninstall`로 삭제되지 않으므로 수동 정리가 필요합니다. 사전에 PVC를 백업합니다.
- values 재구성: `hyperdx.*`가 resource-type 구조로 이동합니다(`config`→ConfigMap, `secrets`→Secret, `frontendUrl`→`appUrl`, `tasks`가 `hyperdx.tasks`). `mongodb.image/port/persistence.*`·`clickhouse.image/persistence.*`·`otel:` 블록은 제거됐으므로 오버라이드를 다시 써야 합니다.

### 5.2 외부 ClickHouse 배포의 변경 범위 {#52-우리-배포에-주는-함의-}

[스택 토폴로지]({{< relref "/observability/hyperdx/design/01-stack-topology/index.md" >}})처럼 CH/Keeper를 Altinity로 분리했으므로 내장 ClickHouse Deployment를 삭제하는 v1→v2 변경은 외부 CHI에 직접 적용되지 않습니다. 그렇지만 HyperDX·Collector·MongoDB와 values 구조 변경은 여전히 확인해야 합니다.

| 표면 | 경로 |
|---|---|
| **CH/Keeper** | ClickStack 차트 밖. [Altinity 롤링 업그레이드]({{< relref "/data/clickhouse/operations/05-altinity-operations.md" >}}) 경로로 독립 처리(§1·§3·§4) |
| **HyperDX 앱** | `docker.hyperdx.io/hyperdx/hyperdx` 태그 상향(기본 appVersion 추종)¹ |
| **OTel Collector** | 배포판 태그(2.29.0 기준) 상향. persistent queue 확장은 {{< relref "/observability/hyperdx/design/05-keeper/index.md" >}} 재확인 항목 |
| **MongoDB** | 메타데이터 전용·소용량, 리스크 낮음. v2도 `MongoDBCommunity` CR/MCK 경로 동일. 부하 프로파일 [rum/07]({{< relref "/observability/apm-rum/07-hyperdx-mongodb.md" >}}) |

¹ MergeTree 표준 기능만 쓰므로 CH 24.8+ 유지 시 앱 업그레이드가 CH 하한을 새로 요구하는 경우는 드뭅니다.

외부 CHI/CHK의 업그레이드는 ClickStack 차트 변경과 분리해 진행합니다. 차트를 바꿀 때는 외부 ClickHouse 주소·자격 증명, 앱 설정, Collector 파이프라인, MongoDB 마이그레이션 범위를 대조합니다.

## 6. 실행 절차 참고 {#6-일반-업그레이드-런북-relref-위임}

실행 단계에서는 다음 문서의 해당 절차를 사용합니다.

- CH 서버 롤링: shard 내 1 replica씩·shard 간 병렬·혼합버전 창 ~1년/2 LTS·중간 LTS 징검다리·`podTemplate` 이미지 태그 변경으로 트리거 → [operator 운영]({{< relref "/data/clickhouse/operations/05-altinity-operations.md" >}}).
- operator 자체: minor 단계별(0.26→0.27)·CRD 삭제 절대금지·이미지+설정 분리 reconcile·안전장치 3층(STS recreate 정책·aborted reconcile 자동 재개·pre/post SQL 훅) → [operator 운영]({{< relref "/data/clickhouse/operations/05-altinity-operations.md" >}}).
- Keeper(CHK): 0.26→0.27 무마이그레이션·0.23.x 수동 PV·4LW 라이브니스 전환 → [operator 운영]({{< relref "/data/clickhouse/operations/05-altinity-operations.md" >}}).
- 롤링 다운타임·EBS reattach 물리 역학·`reconcile.statefulSet.update.timeout` → [operator 토폴로지·다운타임]({{< relref "/observability/hyperdx/design/04-operator-topology-downtime/index.md" >}}).

## 배포안에 남길 기록 {#우리-케이스에서는}

각 구성요소의 실제 이미지 태그와 호환 근거, 스테이징 결과를 함께 기록합니다. 특히 operator 0.27+와 Keeper 24.8 조합은 기본값 동작을 확인하기 전까지 미확정입니다. 차트의 기본 태그를 옮겨 적는 것만으로는 이 관계를 검증할 수 없습니다.

이미지, 설정, 볼륨 확장은 별도 변경으로 진행합니다. ClickHouse 업그레이드 전에는 스키마와 데이터 백업을 확보하고 EBS 스냅샷 복원을 시험합니다. 관찰 기간에 새 기능 도입을 미루더라도 바이너리만 되돌릴 수 있다고 약속하지 않습니다.

이 글의 버전값은 2026-07~08 배포안의 기록입니다. Packed storage와 `part_storage_type`은 당시 미확인 항목이며, 사용할 버전이 정해지면 출시 문서와 실제 동작을 다시 대조합니다.
