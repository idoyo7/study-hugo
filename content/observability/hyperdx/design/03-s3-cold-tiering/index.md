---
title: "S3 콜드 티어링 — storage_configuration"
linkTitle: "S3 콜드 티어링 — storage_configuration·TTL·IRSA worked example"
date: 2026-08-01
lastmod: 2026-08-24
weight: 3
aliases: ["/hyperdx-operating/02-tiering/", "/hyperdx/operating/02-tiering/"]
url: "/hyperdx/03-s3-cold-tiering/"
---

# ClickHouse의 오래된 데이터를 S3로 옮기기

보존 기간을 늘리면 오래된 로그와 트레이스가 EBS 용량을 계속 차지합니다. 이 구성에서는 최근 데이터는 gp3에 남기고, 일정 시간이 지난 파트를 S3 Standard로 옮깁니다. ClickHouse가 두 위치를 함께 조회하므로 HyperDX에서 저장 위치를 나눠 다룰 필요는 없습니다.

hot 디스크는 `/var/lib/clickhouse`에 마운트한 EBS이고 cold 디스크는 로컬 캐시로 감싼 S3입니다. [로컬 NVMe 티어링]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})과 이동 방식은 같지만 hot 볼륨의 배치와 복구가 다릅니다. EBS 선택은 [hot 스토리지 글]({{< relref "/observability/hyperdx/design/02-hot-storage-ebs/index.md" >}})에서 설명했습니다.

아래 예제는 ClickStack 차트에서 `clickhouse.enabled: false`로 두고 Altinity CHI/CHK를 별도로 관리하는 배포입니다. 표준 차트의 ClickHouse Inc. operator용 CR에 그대로 넣을 수는 없습니다. 연결 구조는 [스택 토폴로지]({{< relref "/observability/hyperdx/design/01-stack-topology/index.md" >}}), 복제와 AZ 배치는 [operator·다운타임]({{< relref "/observability/hyperdx/design/04-operator-topology-downtime/index.md" >}})을 참고합니다.

## 0. 이 예제가 적용되는 구성 {#0-결정-게이트--이-장은-켠다고-결정한-뒤부터다}

이 글은 S3 티어를 사용하기로 한 뒤의 설정을 다룹니다. gp3만으로 운영할 때와의 비용·관리 차이는 [블록 전용 운영 §6]({{< relref "/observability/hyperdx/design/08-block-only-tuning/index.md" >}}), 실제 도입 시점과 되돌릴 신호는 [의사결정 가이드]({{< relref "/observability/hyperdx/operations/03-decision-guide/index.md" >}})에서 비교합니다. 저장량과 월 비용은 [용량 산정]({{< relref "/observability/hyperdx/design/07-capacity-planning/index.md" >}})에 있습니다.

3~12개월 보존을 가정한 운영 구성에서는 로그·트레이스·메트릭에 티어링을 적용합니다. 세션 리플레이는 30일 동안 EBS에만 두고 삭제합니다. 짧은 보존 기간이나 staging처럼 설정을 줄이는 편이 유리한 환경에서는 gp3 단일 티어도 선택할 수 있습니다.

## 1. hot EBS와 S3 캐시 연결하기 {#1-storage_configuration-기준-문서--hotebs-default--colds3cache}

스토리지 정책에는 hot과 cold 볼륨을 순서대로 등록합니다. hot은 내장 `default` 디스크를 쓰므로 별도 disk 선언이 필요 없습니다. 추가할 것은 S3 객체를 읽고 쓰는 `s3_disk`와 그 앞의 로컬 LRU 캐시 `s3_cache`입니다.

{{< flow src="_flow/s3-콜드-티어링-storage.json" />}}

### 1.1 S3 disk와 로컬 캐시 정의 {#11-disk-정의--신문법-object_storage241-}

예제의 ClickHouse는 24.8 LTS 계열이며 24.1부터 제공되는 `object_storage` 표기를 사용합니다. 이 버전 선택과 ClickStack의 공식 최소 지원 버전은 구분해야 합니다. 조사 당시 공식 최소 버전 매트릭스는 찾지 못했고, 24.8 하한은 2차 자료에서만 확인했습니다.

기존 `type: s3`도 사용할 수 있습니다. 공식 문서에서는 이를 `type: object_storage`, `object_storage_type: s3`, `metadata_type: local`의 조합과 같은 설정으로 설명합니다. 여기서는 S3의 파일 매핑 정보가 로컬에 남는다는 점을 드러내려고 `metadata_type`까지 적었습니다.

```xml
<clickhouse>
  <storage_configuration>
    <disks>
      <!-- S3 오브젝트 스토리지 disk. {replica} 매크로로 replica마다 경로 분리(shared-nothing) -->
      <s3_disk>
        <type>object_storage</type>
        <object_storage_type>s3</object_storage_type>
        <metadata_type>local</metadata_type>   <!-- part 매핑 메타데이터는 로컬(EBS)에 상주 → §5.1 -->
        <endpoint>https://rum-clickhouse-cold.s3.ap-northeast-2.amazonaws.com/s3_disk/{replica}/</endpoint>
        <use_environment_credentials>1</use_environment_credentials>  <!-- IRSA(§3) -->
        <region>ap-northeast-2</region>
        <metadata_path>/var/lib/clickhouse/disks/s3_disk/</metadata_path>
      </s3_disk>
      <!-- S3 disk 위에 로컬(EBS) LRU 캐시를 얹는다. cold 쿼리 지연 방어의 핵심 -->
      <s3_cache>
        <type>cache</type>
        <disk>s3_disk</disk>
        <path>/var/lib/clickhouse/disks/s3_cache/</path>
        <max_size>150Gi</max_size>                          <!-- LRU 상한. EBS 소비항(§5.1). 실값은 스테이징 튜닝 -->
        <cache_on_write_operations>1</cache_on_write_operations>  <!-- TTL MOVE 시점에 프리페치 → 첫 조회 완화 -->
      </s3_cache>
    </disks>
    ...
  </storage_configuration>
</clickhouse>
```

S3 disk에서 확인할 필드는 다음과 같습니다.

| 필드 | 기본 | 의미 (우리 값) |
|---|---|---|
| `endpoint` | — | 버킷 + 루트경로 + `{replica}`. 리전 도메인 포함 권장 |
| `use_environment_credentials` | false | 1 → AWS SDK 기본 자격증명 체인(IRSA web identity 토큰 픽업). §3 |
| `region` | — | 명시 필수 권장(STS regional endpoint·서명). IRSA에서 특히 |
| `metadata_type` | local | `local`=part 매핑 파일이 로컬 상주 + replica별 독립(shared-nothing) → `{replica}` 필수 |
| `metadata_path` | `/var/lib/clickhouse/disks/<name>/` | 로컬 메타데이터 위치(EBS 위) |
| `request_timeout_ms` | 5000 | cold full-scan 많으면 상향(예 60000) |
| `support_batch_delete` | true | GCS면 false(S3는 기본 유지) |

캐시 크기와 쓰기 시 캐싱 여부는 별도로 지정합니다.

| 필드 | 기본 | 의미 |
|---|---|---|
| `disk` | — | 캐시 대상 하위 disk(`s3_disk`) |
| `path` | — | 캐시 실체 로컬 경로(EBS 용량 소비 → §5.1) |
| `max_size` | — | LRU 상한(`150Gi` 또는 바이트). 초과 시 LRU 축출. 최적값은 cold working set 대비 hit rate로 튜닝 |
| `cache_on_write_operations` | false | 1이면 TTL MOVE 시에도 로컬 캐시에 적재 → 갓 내려간 데이터 첫 조회가 빠름 |
| `enable_cache_hits_threshold` | false | N회 읽힌 뒤에만 캐싱(핫셋만) |

여기서는 S3 disk를 `cache` disk로 감쌉니다. `max_size`는 EBS에서 이 캐시가 사용할 상한이므로 hot 데이터와 합쳐 볼륨 용량에 반영해야 합니다. 배포 후 `system.filesystem_cache`와 캐시 읽기 지표로 실제 사용량을 확인합니다.

### 1.2 rum_hot_cold 정책 {#12-storage_policy--hotdefaultebs--colds3_cache}

```xml
    <policies>
      <rum_hot_cold>
        <volumes>
          <hot>
            <disk>default</disk>          <!-- = /var/lib/clickhouse = gp3/io2 PVC(내장 disk, 선언 불필요) -->
          </hot>
          <cold>
            <disk>s3_cache</disk>         <!-- cache로 감싼 S3 -->
          </cold>
        </volumes>
        <move_factor>0.1</move_factor>    <!-- 안전판(여유<10%=~90% 찼을 때만 개입). 주 이동은 시간 TTL. §1.3 -->
        <!-- prefer_not_to_merge 미설정(기본 false 유지): S3 위 작은 part 폭증 방지 -->
      </rum_hot_cold>
    </policies>
```

`hot`을 앞에, `cold`를 뒤에 놓고 TTL의 `TO VOLUME 'cold'`로 오래된 파트를 옮깁니다. `default`가 가리키는 hot 매체는 [gp3 설정]({{< relref "/observability/hyperdx/design/02-hot-storage-ebs/index.md" >}})을 그대로 사용합니다.

`prefer_not_to_merge`는 기본 false로 둡니다. 이 값을 true로 설정해 특정 볼륨의 머지를 막으면 작은 파트가 계속 남아 `TOO_MANY_PARTS`나 INSERT 지연으로 이어질 수 있습니다. false로 두었다고 S3 이동 전에 모든 머지가 끝나는 것은 아닙니다. 이동 후에도 머지는 일어날 수 있으므로 cold 요청 비용은 실제 S3 쓰기량으로 확인해야 합니다. [ClickHouse MergeTree 스토리지 설정](https://github.com/ClickHouse/ClickHouse/blob/master/docs/en/engines/table-engines/mergetree-family/mergetree.md)

### 1.3 move_factor와 남은 공간 {#13-정정--move_factor는-여유-공간-임계다-}

`move_factor`는 남은 공간의 비율입니다. 여유 공간이 `move_factor × 볼륨 크기`보다 작아지면 다음 볼륨으로 파트를 옮깁니다. 기본값 0.1이면 약 90% 찼을 때 이동하는 셈입니다.

| move_factor | 이동 개시 조건 | 사용률 환산 | 성격 |
|---|---|---|---|
| 0.1(기본) | 여유 < 10% | ~90% 찼을 때 | 여유 공간이 적을 때 이동 시작 |
| 0.2 | 여유 < 20% | ~80% 찼을 때 | 약간 이른 안전판 |
| 0.9 | 여유 < 90% | ~10%만 차도 | 거의 즉시·공격적 이동 |

시간 TTL로 최근 14일·30일 데이터를 유지하려면 `move_factor=0.1`을 두고 공간 부족 때만 작동하게 합니다. 0.9로 올리면 약 10%만 사용해도 이동을 시작하므로 최근 데이터까지 S3로 내려갈 수 있습니다. 배포 후 최근 파트가 예상보다 일찍 이동한다면 TTL과 함께 이 값과 hot 여유 공간을 확인합니다.

## 2. CHI에 storage XML 넣기 {#2-altinity-chi에-주입--files의-storage_configurationxml}

Altinity CHI의 `spec.configuration.files`에 `config.d/storage_configuration.xml`을 넣습니다. 깊게 중첩된 disk·volume 설정을 XML로 한곳에 두면 관계를 확인하기 쉽습니다. 외부 볼륨으로 같은 config 경로를 직접 마운트해 operator가 생성한 설정과 충돌한 사례(#1456)가 있으므로 예제에서는 operator의 `files` 경로를 사용합니다.

```yaml
apiVersion: "clickhouse.altinity.com/v1"
kind: "ClickHouseInstallation"
metadata:
  name: rum-observability
  namespace: clickhouse
spec:
  defaults:
    storageManagement:
      provisioner: Operator          # EBS는 무중단 확장 가능 → Operator 선택 이점(로컬 NVMe와 다른 점)
      reclaimPolicy: Retain
    templates:
      podTemplate: ch-ebs
      dataVolumeClaimTemplate: data-ebs      # → /var/lib/clickhouse (hot=default 디스크)
      logVolumeClaimTemplate:  log-ebs
      serviceTemplate: ch-svc
  configuration:
    zookeeper:
      keeper:
        name: rum-keeper            # CHK 참조(Keeper 상세는 05)
    clusters:
      - name: main
        pdbManaged: "yes"
        pdbMaxUnavailable: 1
        layout:
          shardsCount: 1
          replicasCount: 2           # RF2. cold(S3)도 replica별 사본(shared-nothing) → {replica} 경로 분리
    files:
      config.d/storage_configuration.xml: |
        <clickhouse>
          <storage_configuration>
            <disks>
              <s3_disk>
                <type>object_storage</type>
                <object_storage_type>s3</object_storage_type>
                <metadata_type>local</metadata_type>
                <endpoint>https://rum-clickhouse-cold.s3.ap-northeast-2.amazonaws.com/s3_disk/{replica}/</endpoint>
                <use_environment_credentials>1</use_environment_credentials>
                <region>ap-northeast-2</region>
                <metadata_path>/var/lib/clickhouse/disks/s3_disk/</metadata_path>
              </s3_disk>
              <s3_cache>
                <type>cache</type>
                <disk>s3_disk</disk>
                <path>/var/lib/clickhouse/disks/s3_cache/</path>
                <max_size>150Gi</max_size>
                <cache_on_write_operations>1</cache_on_write_operations>
              </s3_cache>
            </disks>
            <policies>
              <rum_hot_cold>
                <volumes>
                  <hot><disk>default</disk></hot>       <!-- EBS gp3/io2 PVC -->
                  <cold><disk>s3_cache</disk></cold>
                </volumes>
                <move_factor>0.1</move_factor>
              </rum_hot_cold>
            </policies>
          </storage_configuration>
        </clickhouse>
    settings:
      # storage_policy는 보통 테이블별 SETTINGS로 지정(§4). 서버 기본으로 강제하려면:
      # merge_tree/storage_policy: rum_hot_cold
      max_concurrent_queries: 200
  templates:
    podTemplates:
      - name: ch-ebs
        spec:
          serviceAccountName: clickhouse-s3     # ← IRSA SA(§3.2)
          nodeSelector: { workload: clickhouse }
          tolerations:
            - { key: dedicated, operator: Equal, value: clickhouse, effect: NoSchedule }
          containers:
            - name: clickhouse
              image: clickhouse/clickhouse-server:24.8   # ClickStack 병용 24.8 LTS+
              resources:
                requests: { cpu: "4", memory: "32Gi" }
                limits:   { cpu: "4", memory: "32Gi" }
    volumeClaimTemplates:
      - name: data-ebs
        spec:
          accessModes: [ReadWriteOnce]
          storageClassName: gp3                 # 또는 io2 — 선택 기준은 02
          # prod 노드당 order ~1TB. hot 데이터 + part metadata + s3_cache(150Gi) + 머지 여유를 모두 포함(§5.1).
          # 정확한 사이징은 06이 기준 문서. 스테이징은 소규모(예 100Gi).
          resources: { requests: { storage: 1000Gi } }
      - name: log-ebs
        spec:
          accessModes: [ReadWriteOnce]
          storageClassName: gp3
          resources: { requests: { storage: 50Gi } }
    serviceTemplates:
      - name: ch-svc
        spec:
          type: ClusterIP
          ports:
            - { name: http, port: 8123 }
            - { name: tcp,  port: 9000 }
```

예제는 스토리지와 IRSA 연결을 보여주는 뼈대입니다. replica 분산과 롤링 설정은 [operator·다운타임]({{< relref "/observability/hyperdx/design/04-operator-topology-downtime/index.md" >}}), 변경 절차는 [Altinity 운영]({{< relref "/data/clickhouse/operations/05-altinity-operations.md" >}})과 맞춰야 합니다.

`1000Gi`는 운영 노드당 약 1TB를 가정한 값입니다. 이 볼륨에는 hot 데이터뿐 아니라 파트 매핑 정보, 최대 150Gi 캐시와 머지 중 임시 사용량이 함께 들어갑니다. 실제 요청 용량은 [용량 산정]({{< relref "/observability/hyperdx/design/07-capacity-planning/index.md" >}})으로 계산합니다. staging에서 PVC를 줄인다면 캐시 상한도 함께 줄여야 합니다.

## 3. IRSA로 S3 접근하기 {#3-eks-irsa--ch-서버가-s3에-붙는-법}

ClickHouse 파드에 IRSA 역할을 부여하고 XML에는 `use_environment_credentials=1`을 설정합니다. AWS SDK 자격증명 체인이 `AWS_WEB_IDENTITY_TOKEN_FILE`의 토큰을 사용하도록 하는 구성입니다.

### 3.1 버킷 IAM 권한 {#31-iam-정책--cold-버킷-최소권한-}

ClickHouse S3 disk는 GET/PUT뿐 아니라 List/Delete도 필요합니다(part 이동·머지·TTL DELETE·오래된 blob 정리).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "clickhouse-s3-cold-object",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::rum-clickhouse-cold/*"
    },
    {
      "Sid": "clickhouse-s3-cold-list",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::rum-clickhouse-cold"
    }
  ]
}
```

IAM role의 신뢰 정책에는 EKS OIDC provider와 `system:serviceaccount:<ns>:<sa>` 조건을 연결합니다. eksctl이나 IRSA 모듈을 사용하더라도 생성된 namespace·ServiceAccount 조건이 실제 파드와 맞는지 확인합니다.

### 3.2 ServiceAccount 연결 {#32-serviceaccount--pod-연결-}

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: clickhouse-s3
  namespace: clickhouse
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/clickhouse-cold-s3
```

이 SA를 CHI podTemplate `spec.serviceAccountName`(§2)에 지정하면 EKS webhook이 pod에 `AWS_ROLE_ARN`·`AWS_WEB_IDENTITY_TOKEN_FILE` env와 projected token 볼륨을 자동 주입합니다.

### 3.3 리전·replica 경로·자격증명 확인 {#33-irsa-함정}

disk XML에는 `region`과 리전이 포함된 `endpoint`를 함께 적습니다. IRSA의 STS 호출과 S3 서명에 쓰이는 리전이 어긋나지 않도록 하기 위한 설정입니다.

replica마다 S3 prefix도 분리합니다. 이 예제의 `metadata_type=local` 구성은 각 replica가 파일 매핑과 객체 사본을 독립적으로 관리하므로 `.../s3_disk/{replica}/`를 사용합니다.

백업 사이드카도 IRSA를 쓴다면 clickhouse-backup의 self-assume 이슈(#798)를 따로 확인합니다. `AWS_ROLE_ARN`을 보고 자기 역할을 다시 assume한 사례이며 ClickHouse 서버 disk와는 다른 코드 경로입니다. `AssumeRoleARN` 설정을 확인하되, 서버 disk의 IRSA 동작까지 이 이슈로 판단하지 않습니다.

서버 disk 경로는 아직 staging에서 검증하지 않았습니다. 배포 버전에서 필요한 환경변수와 `AWS_EC2_METADATA_DISABLED`의 영향을 포함해 S3 읽기·쓰기·삭제를 확인해야 합니다.

### 3.4 NAT 비용을 피하는 S3 Gateway Endpoint {#34-s3-gateway-vpc-endpoint--티어링-절감의-전제조건}

IRSA가 맞아도 프라이빗 서브넷의 라우팅에 따라 S3 트래픽이 NAT Gateway를 지날 수 있습니다. S3 Gateway VPC Endpoint에는 시간요금과 데이터 처리요금이 없습니다. 반면 2026-08 서울 기준 NAT Gateway에는 데이터 처리 $0.059/GB와 시간요금 $0.059/h가 붙습니다.

3개월 보존·RF2에서 cold로 월 약 300GB가 이동한다는 가정이면 NAT 쓰기 비용이 생기고, 캐시 미스 읽기까지 포함한 예산은 월 약 $18~24입니다. 같은 조건의 스토리지 절감액을 월 약 $50로 잡았을 때 약 35~50%에 해당합니다. 이 추정은 실제 이동량과 조회량으로 보정해야 하며, 비교 모델은 [블록 전용 운영]({{< relref "/observability/hyperdx/design/08-block-only-tuning/index.md" >}})을 참고합니다.

배포할 때 워커 서브넷의 라우팅 테이블에 S3 Gateway Endpoint가 연결됐는지 확인합니다. IRSA 권한 확인과 네트워크 경로 확인을 함께 해야 예상한 비용으로 동작합니다. 확인 절차는 [의사결정 가이드]({{< relref "/observability/hyperdx/operations/03-decision-guide/index.md" >}})에 있습니다.

## 4. 테이블별 보존 기간 적용하기 {#4-ttl-기준-문서--rum-테이블별-hotcolddelete}

보존 기간은 아래 표를 사용합니다. [용량 산정]({{< relref "/observability/hyperdx/design/07-capacity-planning/index.md" >}})에서도 같은 hot 기간을 적용하고, 3개월·6개월·1년 시나리오에 따라 삭제 시점만 바꿉니다.

### 4.1 ClickStack 테이블과 시간 컬럼 {#41-clickstack-관리-테이블-스키마-}

ClickStack이 자동 생성하는 테이블(기본 DB=`default`). 전부 `ENGINE=MergeTree` + `ttl_only_drop_parts=1`, `PARTITION BY toDate(...)`.

| 테이블 | 타임스탬프 (TTL 기준 컬럼) | 기본 TTL 식 |
|---|---|---|
| `otel_logs` | `Timestamp DateTime64(9)` | `toDateTime(Timestamp) + ${TABLES_TTL}` |
| `otel_traces` | `Timestamp DateTime64(9)` | `toDateTime(Timestamp) + ${TABLES_TTL}` |
| `otel_metrics_gauge` / `_sum` / `_histogram` / `_summary` | `TimeUnix DateTime` | `toDateTime(TimeUnix) + ${TABLES_TTL}` |
| `hyperdx_sessions` | `Timestamp DateTime64(9)` (+ `TimestampTime DateTime`) | `TimestampTime + ${TABLES_TTL}` |

TTL에는 초 단위 `DateTime` 식을 사용합니다. 로그와 트레이스는 `toDateTime(Timestamp)`, 메트릭은 `toDateTime(TimeUnix)`, 세션은 `TimestampTime`을 기준으로 아래 DDL을 작성합니다.

ClickStack의 “Managing TTL” 문서는 `${TABLES_TTL}`을 모든 테이블에 적용하는 기본 3일(72h) 값으로 설명합니다. 아래 14일·30일 등의 설정은 이 워크로드를 위해 정한 값입니다. 배포 버전의 실제 값은 `SHOW CREATE TABLE`로 확인한 뒤 변경합니다.

### 4.2 이 구성의 보존 기간 {#42-ttl-기준-문서-표-우리-rum-워크로드-}

최근 장애 조사에 사용할 기간만 EBS에 남기고 더 오래 보존할 데이터는 S3로 옮깁니다. 세션 리플레이는 조회 수명이 짧다고 가정해 별도 정책을 사용합니다.

| 테이블 | hot(EBS) | cold(S3) 시작 | DELETE (지평별) | 근거 |
|---|---|---|---|---|
| `otel_logs` | 14일 | 14일~ | 90 / 180 / 365일 | 디버깅 최근성 + 로그 볼륨 |
| `otel_traces` | 14일 | 14일~ | 90 / 180 / 365일 | span 고volume, 최근 위주 조회 |
| `otel_metrics_*` | 30일 | 30일~ | 180 / 365일 | 장기 추세 — 3개월 지평에서도 최소 180 권장 |
| `hyperdx_sessions` | 30일(전 수명) | 미이동 | 30일 고정 | 리플레이 급감·volume 지배 → §4.4 |

아래 DDL은 로그·트레이스 90일, 메트릭 180일 보존 예제입니다. 더 긴 보존이 필요하면 DELETE 값을 바꿉니다. hot EBS에는 로그·트레이스 14일치와 메트릭·세션 30일치가 남는 것으로 계산합니다. [기간별 용량 계산]({{< relref "/observability/hyperdx/design/07-capacity-planning/index.md" >}})도 같은 가정입니다.

### 4.3 스토리지 정책과 TTL DDL {#43-정책-연결--ttl-move-ddl-}

테이블의 스토리지 정책과 TTL은 ClickHouse에서 변경합니다. 프로덕션에서 스키마를 직접 관리한다면 exporter의 `create_schema` 설정도 함께 확인합니다. 아래 예제는 필요한 테이블을 준비하고 `create_schema:false`로 운영하는 구성을 전제로 합니다. 재시작 후 스키마가 유지되는지는 배포할 exporter 버전으로 검증합니다.

```sql
-- 0) 정책 연결. storage_policy 변경은 "볼륨 추가 방향"(hot 유지 + cold 추가)이라 허용.
--    sessions는 의도적으로 rum_hot_cold를 붙이지 않는다(§4.4) → 기본 default 정책(EBS only) 유지.
ALTER TABLE default.otel_logs              MODIFY SETTING storage_policy = 'rum_hot_cold';
ALTER TABLE default.otel_traces            MODIFY SETTING storage_policy = 'rum_hot_cold';
ALTER TABLE default.otel_metrics_gauge     MODIFY SETTING storage_policy = 'rum_hot_cold';
ALTER TABLE default.otel_metrics_sum       MODIFY SETTING storage_policy = 'rum_hot_cold';
ALTER TABLE default.otel_metrics_histogram MODIFY SETTING storage_policy = 'rum_hot_cold';
ALTER TABLE default.otel_metrics_summary   MODIFY SETTING storage_policy = 'rum_hot_cold';

-- 1) logs: hot 14일 → S3, 90일 DELETE  (6개월 지평=180 / 1년=365)
ALTER TABLE default.otel_logs MODIFY TTL
    toDateTime(Timestamp) + INTERVAL 14 DAY TO VOLUME 'cold',
    toDateTime(Timestamp) + INTERVAL 90 DAY DELETE;

-- 2) traces: hot 14일 → S3, 90일 DELETE  (6개월=180 / 1년=365)
ALTER TABLE default.otel_traces MODIFY TTL
    toDateTime(Timestamp) + INTERVAL 14 DAY TO VOLUME 'cold',
    toDateTime(Timestamp) + INTERVAL 90 DAY DELETE;

-- 3) metrics: hot 30일 → S3, 180일 DELETE  (1년 지평=365). gauge/sum/histogram/summary 동일 패턴 반복
ALTER TABLE default.otel_metrics_gauge MODIFY TTL
    toDateTime(TimeUnix) + INTERVAL 30 DAY TO VOLUME 'cold',
    toDateTime(TimeUnix) + INTERVAL 180 DAY DELETE;
-- ALTER TABLE default.otel_metrics_sum       MODIFY TTL ... (동일)
-- ALTER TABLE default.otel_metrics_histogram MODIFY TTL ... (동일)
-- ALTER TABLE default.otel_metrics_summary   MODIFY TTL ... (동일)

-- 4) sessions: S3에 안 내린다. hot(EBS)만, 30일 DELETE만. (TO VOLUME 'cold' 없음)
ALTER TABLE default.hyperdx_sessions MODIFY TTL
    TimestampTime + INTERVAL 30 DAY DELETE;
```

기존 파트에 TTL을 적용하는 작업은 부하를 만들 수 있습니다. 즉시 처리해야 한다면 저트래픽 시간에 `ALTER TABLE ... MATERIALIZE TTL`을 검토하고, TTL 머지 재실행 간격인 `merge_with_ttl_timeout`도 확인합니다. `ttl_only_drop_parts=1`에서는 파트 전체가 만료돼야 삭제되므로 행의 만료 시점과 실제 삭제 시점 사이에 차이가 생길 수 있습니다.

이미 쌓인 과거 파티션을 직접 옮겨야 할 때는 다음 명령을 사용할 수 있습니다. 대상 파티션과 여유 공간을 확인한 뒤 순서대로 이동합니다.

```sql
-- 과거 파티션(예: 2주 넘은 날짜)을 cold 볼륨으로 즉시 이동
ALTER TABLE default.otel_logs   MOVE PARTITION '2026-06-14' TO VOLUME 'cold';
ALTER TABLE default.otel_traces MOVE PARTITION '2026-06-14' TO VOLUME 'cold';

-- 개별 part 단위 이동(특정 disk 지목: 긴급 hot 확보·재조정)
ALTER TABLE default.otel_logs   MOVE PART 'all_12345_12345_0' TO DISK 's3_cache';

-- 어느 파티션이 아직 hot에 있는지 확인 후 스크립트로 순차 이동
SELECT table, partition, disk_name, sum(bytes_on_disk)
FROM system.parts WHERE database='default' AND active AND disk_name='default'
GROUP BY table, partition ORDER BY partition;
```

### 4.4 세션 리플레이는 EBS에서 30일 보관 {#44-왜-hyperdx_sessions는-s3에-안-내리나-}

세션 리플레이는 데이터가 크고 장애 직후에 주로 조회된다는 가정입니다. 오래된 리플레이를 보존할 필요가 없다면 S3로 이동시켜 사본과 메타데이터를 유지하는 대신 30일 후 삭제할 수 있습니다. 따라서 `hyperdx_sessions`에는 `rum_hot_cold`를 연결하지 않고 `default` 정책과 30일 DELETE만 둡니다.

이 선택으로 EBS에는 세션 30일치가 남습니다. [용량 산정]({{< relref "/observability/hyperdx/design/07-capacity-planning/index.md" >}})에 사용한 리플레이 압축비 약 5배는 가정이며, 조회 패턴과 압축비를 실측해 이 보존 정책을 다시 확인해야 합니다.

## 5. 적용 후 확인할 저장량과 비용 {#5-함정-worked-example에서-반드시-경고}

구성을 적용한 뒤에는 EBS 소비량과 S3 읽기·쓰기 비용을 함께 봅니다. 관리할 항목이 너무 많다면 [gp3 단일 티어 구성]({{< relref "/observability/hyperdx/design/08-block-only-tuning/index.md" >}})과 비교할 수 있습니다.

### 5.1 EBS에 남는 메타데이터와 캐시 {#51-part-메타데이터cache가-로컬ebs을-먹는다--사이징-반영-}

`metadata_type=local`에서는 S3에 옮긴 파트의 파일 매핑 정보가 EBS에 남습니다. `s3_cache`도 같은 EBS를 사용하므로 PVC 크기는 다음 항목을 합쳐 정합니다.

```
EBS PVC 용량 ≥  hot 데이터(로그·트레이스 14일 + 메트릭·세션 30일)
              + part metadata(로컬 상주, part 수에 비례)
              + s3_cache LRU(max_size, 예 150Gi)
              + 머지 여유(peak 시 part 순간 공존)
              (+ 로그는 별도 log VCT 권장)
```

메타데이터 크기는 파트 수에 영향을 받습니다. 작은 INSERT와 머지 적체로 파트가 많아졌다면 이를 무시하기 어렵습니다. 캐시는 `max_size`까지 커질 수 있으므로 [용량 산정]({{< relref "/observability/hyperdx/design/07-capacity-planning/index.md" >}})에 상한을 포함하고 metadata는 실제 사용량으로 보정합니다.

### 5.2 조회용 객체의 S3 클래스 {#52-s3-lifecycle--glacieria-전환-금지-}

cold 버킷에는 아직 ClickHouse가 조회하는 테이블 데이터가 있습니다. 이 예제는 S3 Standard를 유지하고 lifecycle로 아카이브하지 않습니다. Glacier Flexible Retrieval·Deep Archive는 읽기 전에 복원이 필요해 일반 쿼리가 객체를 바로 읽을 수 없습니다.

Standard-IA와 Glacier Instant Retrieval은 즉시 접근이 가능하므로 위 아카이브 클래스와 같은 이유로 금지할 수는 없습니다. 다만 조회 비용과 최소 보관 기간까지 따로 계산해야 하며 이 예제에서는 사용하지 않습니다. 클래스별 차이는 [AWS S3 스토리지 클래스](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html)를 참고합니다.

cold 데이터 버킷과 백업 버킷을 분리하면 두 보존 정책을 혼동하기 어렵습니다. 백업 lifecycle도 증분 체인의 복원에 필요한 객체를 남기도록 설계해야 합니다. [티어링과 백업 설명]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})에서 그 배경을 다룹니다.

### 5.3 replica별 S3 사본 유지 {#53-zero-copy-replication-금지-relref-}

RF2에서는 각 replica가 `{replica}` 경로 아래에 사본을 둡니다. 사본을 줄이려고 zero-copy replication을 켜는 구성은 데이터 손실 보고(#45346)를 고려해 사용하지 않습니다. 사례는 [로컬 NVMe 티어링 글]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})을 참고합니다.

### 5.4 캐시 미스와 cold 쿼리 부하 {#54-cold-쿼리-지연--캐시-미스-}

S3 파트를 읽을 때 로컬 캐시에 없으면 원격 요청이 발생합니다. `cache_on_write_operations=1`은 이동 중 기록한 데이터를 캐시에도 남겨 첫 조회의 미스를 줄일 수 있지만, 조회 시점까지 캐시에 남아 있어야 효과가 있습니다. 자주 보는 기간은 hot에 두는 편이 예측하기 쉽습니다.

hot과 cold는 같은 ClickHouse 서버의 CPU·메모리를 사용합니다. cold 전체 스캔을 오래 돌리면 최근 데이터 조회와 적재에 영향을 줄 수 있으므로 저장 비용뿐 아니라 동시 부하도 관측해야 합니다.

### 5.5 사본 수를 반영한 비용과 백업 {#55-사본-경제와-내구성--cold도-rf배수-티어링은-내구성이-아니다-}

RF2는 S3에도 두 벌을 저장하고 백업은 별도로 둡니다. [용량 산정]({{< relref "/observability/hyperdx/design/07-capacity-planning/index.md" >}})에서는 낮아진 GB 단가에 이 사본 수를 곱합니다. self-hosted `ReplicatedMergeTree`를 S3 단일 사본 구조로 계산하면 비용을 과소평가하게 됩니다.

티어링으로 저장 위치를 바꿔도 복제와 백업은 유지합니다. gp3의 볼륨 내구성과 S3의 11 nines는 잘못된 삭제나 쿼리 가용성까지 보장하는 수치가 아닙니다. [스토리지 전략]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})에서 설명한 멀티 AZ RF2 이상 복제와 별도 백업을 이 구성에도 적용합니다.

![hot·cold 2계층 티어링 구조 — hot 티어의 노드당 단일 gp3 EBS와 cold 티어의 S3 Standard·replica별 RF배수 사본을 TTL이 TO VOLUME과 DELETE로 잇는 그림, 그리고 티어링은 내구성이 아니라는 주석](/images/hyperdx/tiering-hot-cold.svg)
*hot(노드당 단일 gp3 EBS)과 cold(S3 Standard, `{replica}` 경로마다 RF배수 사본을 두는 shared-nothing) 2계층을 시간 기반 TTL이 `TO VOLUME 'cold'`로 잇고 `DELETE`로 만료시킵니다. 세션 리플레이만 cold로 안 내리고 hot 30일 후 삭제합니다. 내구성은 티어링과 별개로 멀티 AZ RF 복제 + 백업이 담당하며 cold(S3)도 RF배수 사본을 두고 zero-copy는 금지입니다.*

### 5.6 머지와 S3 요청 비용 {#56-요청-비용의-구조--왜-우리-cold-tier는-request가-싼가}

S3는 저장량과 요청 수를 함께 과금합니다. 2026-08 조사에서 사용한 서울 요청 단가는 다음과 같습니다.

| 요청 종류 | 서울 단가 |
|---|---|
| PUT / COPY / POST / LIST | $4.50 / 백만 요청 |
| GET / SELECT 등 읽기 | $0.35 / 백만 요청 |
| DELETE | 무료 |

PUT 단가는 GET의 약 13배입니다. wide part는 컬럼별 데이터·마크 파일과 메타데이터를 만들며, 공식 KB에는 컬럼 109개 테이블의 파트가 227개 파일로 구성된 예가 있습니다. S3에서 머지가 반복되면 새 객체를 쓰는 비용도 증가합니다.

14일·30일 동안 EBS에 머무르는 파트는 이동 전에 병합될 시간을 갖습니다. 그래서 S3를 처음부터 주 저장소로 쓰는 구성보다 작은 파일 업로드가 줄어들 것으로 예상합니다. 다만 `prefer_not_to_merge=false`가 “이동 전 병합 완료”를 보장하지는 않으며 cold에서 추가 머지가 발생할 수 있습니다.

[용량 산정 §4.6]({{< relref "/observability/hyperdx/design/07-capacity-planning/index.md" >}})의 PUT 비용은 이런 이동 패턴을 가정한 예산입니다. 실제 요청 수로 확인해야 하고, NAT Gateway를 거치는지에 따라서도 총비용이 달라집니다. S3 primary 구성과의 비교는 [스토리지 전략]({{< relref "/data/clickhouse/storage/02-storage-local-nvme.md" >}})에 있습니다.

{{% details title="이동·배치 모니터링 쿼리 모음" closed="true" %}}
```sql
-- 정책/볼륨/디스크 구성 + 실제 반영된 move_factor 확인
SELECT policy_name, volume_name, disks, volume_priority, max_data_part_size, move_factor
FROM system.storage_policies WHERE policy_name = 'rum_hot_cold';

-- 디스크 여유(hot EBS / s3_cache 소비 확인)
SELECT name, type, path,
       formatReadableSize(free_space) AS free, formatReadableSize(total_space) AS total
FROM system.disks;

-- 테이블·파티션이 어느 disk에 있나(hot=default vs cold=s3_disk 분포)
SELECT table, partition, disk_name, count() AS parts,
       formatReadableSize(sum(bytes_on_disk)) AS size
FROM system.parts
WHERE database='default' AND active
GROUP BY table, partition, disk_name
ORDER BY table, partition DESC;

-- 이동 이벤트 추적(part_log의 MovePart)
SELECT event_time, table, part_name, disk_name, event_type
FROM system.part_log
WHERE event_type = 'MovePart' AND event_date >= today() - 1
ORDER BY event_time DESC LIMIT 50;

-- ★ 요청 수 계측 — 위 §5.6의 "요청 비용은 구조적으로 작다"를 실제로 검증하는 인터페이스.
--   이벤트 이름은 버전에 따라 S3*/DiskS3* 접두사가 갈리므로 먼저 목록을 확인한다 `≈`
SELECT event, value FROM system.events WHERE event ILIKE '%S3%' ORDER BY value DESC;

-- 캐시 효율(히트율) — cold 조회가 S3까지 내려가는 비율. §1.2 max_size 사이징의 판단 근거
SELECT event, value FROM system.events
WHERE event IN ('CachedReadBufferReadFromCacheBytes', 'CachedReadBufferReadFromSourceBytes');

SELECT cache_name, formatReadableSize(sum(size)) AS cached
FROM system.filesystem_cache GROUP BY cache_name;
```

정책과 배치는 `system.storage_policies`·`system.disks`·`system.parts`, 이동 이력은 `system.part_log`에서 확인합니다. S3 요청과 캐시 지표는 `system.events`와 `system.filesystem_cache`를 사용합니다.

티어링 적용 전에 S3 카운터를 기록하고 이동 후 증가량을 비교합니다. 캐시 히트율은 일정 기간, 예를 들어 1주 동안 관측해 `max_size`를 조정합니다. 최근 파트가 예상보다 일찍 S3에 있다면 `move_factor`와 hot 여유 공간을 점검하고, 테이블별 hot 크기가 14일·30일 가정과 맞는지도 확인합니다.

{{% /details %}}

## 실제 이동량으로 설정 보정하기 {#우리-케이스에서는}

설정 순서는 storage XML과 CHI 연결, IRSA, S3 Gateway Endpoint 확인, 테이블별 정책·TTL 적용입니다. 적용 전에 `SHOW CREATE TABLE`을 기록하고, 이후 `system.parts`에서 데이터가 의도한 기간만큼 hot에 남는지 확인합니다.

검증이 남은 것은 서버 disk의 IRSA 동작, 실제 파트 메타데이터 크기, 캐시 효율과 S3 요청량입니다. 특히 cold에서도 머지가 발생할 수 있으므로 요청 비용을 “파트당 업로드 한 번”으로 고정하지 않습니다. 이 값들을 확인한 뒤 캐시 크기와 예상 비용을 보정합니다.

예제의 TTL·사양·단가는 2026-08 조사 가정입니다. 로그·트레이스 14일, 메트릭 30일 후 S3 이동과 세션 30일 삭제는 이 글에서 선택한 정책입니다.
