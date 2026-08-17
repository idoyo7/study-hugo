---
title: "S3 콜드 티어링 — storage_configuration·TTL·IRSA worked example"
weight: 3
aliases: ["/hyperdx-operating/02-tiering/", "/hyperdx/operating/02-tiering/"]
---

# S3 콜드 티어링 — storage_configuration·TTL·IRSA worked example

{{< callout type="info" >}}
**한눈에**
- 이 장의 경계: "cold를 켤 것인가"의 판정은 [블록 온리 튜닝]({{< relref "08-block-only-tuning.md" >}}) §6의 결정표와 운영 트랙 의사결정 가이드의 cold 축에 있습니다. 이 장은 **켠다고 결정한 뒤**의 조립을 소유합니다(§0).
- hot = EBS `default` 디스크(gp3/io2), cold = S3 Standard + `cache` 디스크(EBS 위 LRU, `max_size` 150Gi). [로컬 NVMe 예제]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})에서 hot 자리를 EBS로 갈아 끼운 것일 뿐, cold(S3) 조립은 동일합니다.
- storage_configuration 기준 문서: 내장 `default` + `s3`(신문법 `object_storage`) + `cache`. 정책 `rum_hot_cold`는 `move_factor=0.1`(안전판만), `prefer_not_to_merge` 미설정(기본 false 유지).
- 이 페이지가 TTL 단일 기준 문서입니다([07 용량 산정]({{< relref "07-capacity-planning.md" >}})이 이 표를 relref): `otel_logs`/`otel_traces` hot **14일**→S3→DELETE(지평 90/180/365), `otel_metrics_*` hot **30일**→S3→DELETE(180/365), **`hyperdx_sessions`는 S3에 안 내리고 hot만·DELETE 30일**.
- 인증 = IRSA(정적 키 금지) + `use_environment_credentials=1` + `region` 명시 + `{replica}` 경로 분리(shared-nothing 필수). 주입은 CHI `files`의 `config.d/storage_configuration.xml`입니다. 권한이 뚫린 다음이 **네트워크 경로 — S3 Gateway VPC Endpoint**(무료, 없으면 NAT 처리요금이 절감액을 먹습니다, §3.4).
- 함정: part 메타데이터·cache가 EBS를 먹습니다(사이징 반영) · S3 lifecycle→Glacier **금지** · zero-copy **금지** · cold=캐시 미스 지연 · 요청 비용은 "머지를 hot에서 끝내는" 설계 덕에 작습니다(§5.6).
{{< /callout >}}

[로컬 NVMe 스토리지]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})가 hot을 로컬 NVMe로 두는 전제였다면, 이 카테고리는 **hot = EBS(gp3/io2)** 전제입니다({{< relref "02-hot-storage-ebs.md" >}}). 티어링의 골격은 같습니다 — TTL로 오래된 part를 S3로 밀고 최근 데이터만 로컬에 둡니다. 달라지는 것은 ClickHouse `storage_configuration`에서 hot 볼륨의 disk 하나뿐입니다. 로컬 SC PVC가 아니라 **내장 `default` 디스크(=`/var/lib/clickhouse` = gp3/io2 PVC)** 를 씁니다. 이 페이지는 그 hot=EBS 전제로 **복붙 가능한 storage XML·CHI 매니페스트·TTL DDL**을 조립하고, HyperDX/ClickStack이 자동 생성하는 관리 테이블(`otel_*`/`hyperdx_sessions`)에 실제로 티어링을 얹습니다. **티어링 ≠ 내구성**·zero-copy 금지·S3 lifecycle 함정의 *배경*은 이미 [클릭하우스 챕터]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})가 깊게 다뤘으므로 여기선 relref로 위임하고 EBS-first worked example의 새 각도만 팝니다.

이 매니페스트들은 표준 ClickStack Helm 2차트가 쓰는 ClickHouse Inc. 공식 operator(ClickHouseCluster CRD)를 쓰지 않습니다. `clickhouse.enabled: false`(자체(self-hosted) ClickHouse에 연결하는 'HyperDX Only')로 두고 CH/Keeper는 Altinity CHI/CHK로 분리 운영하는 전제입니다. 이 분기의 배경은 [스택 토폴로지]({{< relref "01-stack-topology.md" >}})·[operator·다운타임]({{< relref "04-operator-topology-downtime.md" >}})에 있습니다. `✓`

## 0. 결정 게이트 — 이 장은 "켠다고 결정한 뒤"부터다

"cold 티어를 켤 것인가"는 이 장이 판정하지 않습니다. 켜고 마는 손익표는 반대 방향 변형인 [블록 온리 튜닝]({{< relref "08-block-only-tuning.md" >}}) §6이 소유하고 결정 자산도 그쪽에 있습니다. 우리 클러스터의 현재 부하에서 언제 켜고 어떤 신호에 되돌리는지는 운영 트랙 [의사결정 가이드]({{< relref "../../hyperdx-operating/03-decision-guide.md" >}})의 cold 티어링 축이 소유합니다. 이 장은 **켠다고 결정한 다음** 무엇을 어떤 순서로 조립하고 무엇이 비용을 새게 하는지를 다룹니다.

| 질문 | 소유 |
|---|---|
| cold 티어링 대신 gp3 단일 티어로 가면 무엇이 사라지고 무엇을 감당하나 | [08 §6]({{< relref "08-block-only-tuning.md" >}}) 결정표 |
| 지금 우리 클러스터에서 켤 시점인가, 되돌릴 신호는 무엇인가 | 운영 트랙 [의사결정 가이드]({{< relref "../../hyperdx-operating/03-decision-guide.md" >}}) cold 축 |
| hot 매체를 gp3로 둘 것인가(io2·스트라이핑, baseline IOPS·인스턴스 EBS 파이프 천장) | [02 hot 스토리지]({{< relref "02-hot-storage-ebs.md" >}}) |
| 켠 뒤 storage XML·CHI 주입·IRSA·네트워크 경로·TTL을 어떻게 조립하나 | **이 장 §1~§5** |
| 얼마나 쌓이고 월 얼마가 드나 | [07 용량 산정]({{< relref "07-capacity-planning.md" >}}) |

우리 지평(3~12개월)에서 기본 권고는 **S3 티어링 유지**입니다. block-only는 "짧은 보존(≤90일) + S3 미접근·규정 + 운영 단순성"이 겹치는 경로(대표적으로 staging)에서만 고릅니다. 두 경로는 함께 놓고 고르는 선택지이며 티어링을 켜도 `hyperdx_sessions`는 S3로 내리지 않으므로(§4.4) 실제 기본형은 **부분 티어링**입니다. 성장 레버도 갈립니다 — 티어링은 TTL + S3 확장이고 block-only는 gp3 온라인 확장 하나뿐입니다([08 §4]({{< relref "08-block-only-tuning.md" >}})).

## 1. `storage_configuration` 기준 문서 — hot=EBS `default` / cold=S3+cache

정책은 hot 볼륨 하나(내장 `default`)와 cold 볼륨 하나(`cache`로 감싼 S3)로 구성합니다. disk는 셋을 다루지만 `default`는 내장이라 선언할 필요가 없어 실제로 적는 것은 `s3` + `cache` 둘입니다. 이동 우선순위는 볼륨을 적은 순서가 잡습니다.

{{< flow src="_flow/s3-콜드-티어링-storage.json" />}}

### 1.1 disk 정의 — 신문법 `object_storage`(24.1+) `✓`

**우리가 배포하는 ClickHouse가 24.8 LTS+이므로** 신문법을 쓸 수 있습니다 `Σ`. 이것을 "ClickStack이 24.8 LTS+를 요구한다"고 읽으면 안 됩니다 — ClickStack의 공식 최소 지원 ClickHouse 버전 매트릭스는 찾지 못했고 24.8 하한은 2차 출처에만 있습니다 `?`. operator 공식 tiered-s3 예제와 Altinity KB는 아직 구문법 `type: s3`를 쓰는데, 24.8에서는 둘 다 동작합니다.

구문법 `type: s3`는 신문법 3키(`type: object_storage` + `object_storage_type: s3` + `metadata_type: local`)의 **축약과 정확히 등가**입니다 `✓` — 공식 storing-data 문서가 구문법 예제를 두고 *"is equal to the following configuration, from version 24.1"*이라고 명시하고 `metadata_type`을 생략하면 기본값이 `local`입니다. 게다가 **공식 문서 어디에도 구문법을 legacy·deprecated로 표시하는 admonition은 없습니다** `✓`. 구문법으로 쓰인 예제가 낡아서 못 쓰는 것이 아니라, 같은 설정의 짧은 표기일 뿐입니다. 그래도 아래 예제는 신문법을 펼쳐 씁니다. `metadata_type`이 §5.1 사이징 논지의 입력이라 눈에 보이게 두려는 것입니다.

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

주요 필드(공통) `✓`:

| 필드 | 기본 | 의미 (우리 값) |
|---|---|---|
| `endpoint` | — | 버킷 + 루트경로 + **`{replica}`**. 리전 도메인 포함 권장 |
| `use_environment_credentials` | false | **1 → AWS SDK 기본 자격증명 체인**(IRSA web identity 토큰 픽업). §3 |
| `region` | — | **명시 필수 권장**(STS regional endpoint·서명). IRSA에서 특히 |
| `metadata_type` | local | `local`=part 매핑 파일이 로컬 상주 + replica별 독립(shared-nothing) → `{replica}` 필수 |
| `metadata_path` | `/var/lib/clickhouse/disks/<name>/` | 로컬 메타데이터 위치(**EBS 위**) |
| `request_timeout_ms` | 5000 | cold full-scan 많으면 상향(예 60000) `≈` |
| `support_batch_delete` | true | **GCS면 false**(S3는 기본 유지) |

cache disk 필드 `✓`:

| 필드 | 기본 | 의미 |
|---|---|---|
| `disk` | — | 캐시 대상 하위 disk(`s3_disk`) |
| `path` | — | 캐시 실체 로컬 경로(**EBS 용량 소비** → §5.1) |
| `max_size` | — | LRU 상한(`150Gi` 또는 바이트). 초과 시 LRU 축출. 최적값은 cold working set 대비 hit rate로 튜닝 `?` |
| `cache_on_write_operations` | false | **1이면 TTL MOVE 시에도 로컬 캐시에 적재** → 갓 내려간 데이터 첫 조회가 빠름 |
| `enable_cache_hits_threshold` | false | N회 읽힌 뒤에만 캐싱(핫셋만) |

cache는 `filesystem_cache`(쿼리 레벨 원격 읽기 캐시)와 별개인 disk 레벨 LRU 캐시입니다. 관측성 티어링의 정석은 disk 레벨 `cache` disk로 cold 볼륨을 감싸는 것입니다. `✓`

### 1.2 storage_policy — hot=`default`(EBS) / cold=`s3_cache`

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

- 볼륨 순서 = 이동 우선순위(hot=index0 → cold=index1). TTL `TO VOLUME 'cold'`가 hot→cold로 밉니다. `✓`
- `prefer_not_to_merge`는 설정하지 않습니다(기본 false). true면 S3 위 작은 part가 폭증해 `TOO_MANY_PARTS`로 파국 — 병합은 hot(EBS)에서 끝내고 이동합니다. `✓` 이 선택은 안정성 방어이면서 요청 비용 방어이기도 합니다(§5.6).
- hot 볼륨의 `default` 디스크는 데이터 VCT(gp3/io2 PVC)에 매핑되는 내장 디스크라 **별도 선언·별도 로컬 provisioner 계층이 불필요**합니다. 로컬 NVMe 예제(별도 로컬 SC·StatefulSet 고정)와의 실질 차가 여기입니다. `✓`
- hot 매체 자체의 산정(노드당 단일 gp3로 갈 것인가, baseline IOPS·인스턴스 EBS 파이프 천장·RAID0 기각·io2 각주)은 [hot 스토리지]({{< relref "02-hot-storage-ebs.md" >}})가 기준 문서입니다. 이 장은 그 결론인 `default` 디스크를 hot 볼륨으로 받아 쓰기만 합니다.

### 1.3 정정 — `move_factor`는 "여유 공간 임계"다 `✓`

`move_factor`는 **"여유 공간이 `move_factor × 볼륨크기` 아래로 떨어지면 다음 볼륨으로 이동 시작"**입니다(기본 0.1). **여유 공간 임계 비율**이지 "사용률"이 아닙니다.

| move_factor | 이동 개시 조건 | 사용률 환산 | 성격 |
|---|---|---|---|
| **0.1**(기본) | 여유 < 10% | **~90% 찼을 때** | 진짜 "가득 차기 직전 안전판" |
| 0.2 | 여유 < 20% | ~80% 찼을 때 | 약간 이른 안전판 |
| **0.9** | 여유 < 90% | **~10%만 차도** | 거의 즉시·공격적 이동 |

{{< callout type="warning" >}}
"move_factor **0.9**를 안전판으로 둔다"는 흔한 서술은 **값–설명 불일치**입니다. `0.9`는 "여유<90%(=10%만 차도) 즉시 이동"이라 **hot에 갓 들어온 최근 데이터까지 곧장 S3로 밀어내** "hot=최근 14/30일" 목적을 깨뜨립니다. **90% 찼을 때 밀어내는 안전판을 원하면 `move_factor=0.1`(기본)이 맞습니다.** 시간 기반 TTL을 주 이동 수단으로 두는 설계에서는 move_factor를 낮게(기본 유지) 둬 예외적 ingest 폭주 시에만 개입시킵니다(ClickHouse 공식 문서: "available space가 factor보다 낮아지면 이동", 기본값 0.1) `✓`.
{{< /callout >}}

## 2. Altinity CHI에 주입 — `files`의 `storage_configuration.xml`

주입 경로의 정석은 **`spec.configuration.files`에 `config.d/storage_configuration.xml` 키로 XML을 통째로 넣는 것**입니다(operator 공식 tiered-s3 예제가 확정) `✓`. `settings`의 점표기(`storage_configuration/disks/s3_disk/type: s3` …)로도 되지만 중첩이 깊어 오타 위험이 커 실무 표준은 `files`입니다 `≈`. **외부 볼륨/ArgoCD로 config를 직접 마운트하면 operator 렌더와 충돌해 CrashLoop**합니다(#1456) — 반드시 `files`로 넣습니다 `✓`.

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

- CHI 필드 전수·podDistribution anti-affinity·롤링/스케일 함정은 [operator·다운타임]({{< relref "04-operator-topology-downtime.md" >}})과 [클릭하우스 operator 운영]({{< relref "../../clickhouse/05-altinity-operations.md" >}})이 담당합니다. 여기선 storage 주입에 필요한 뼈대만 보입니다.
- PVC 크기는 임의로 바꾸지 않습니다. 위 `1000Gi`는 prod 노드당 order 예시이며 정확한 산정은 [용량 산정]({{< relref "07-capacity-planning.md" >}})이 기준 문서입니다. `default` 디스크가 hot + metadata + cache를 다 담으므로(§5.1) hot 데이터량만으로 잡으면 안 됩니다.

## 3. EKS IRSA — CH 서버가 S3에 붙는 법

정적 access key를 XML/시크릿에 박지 않고 **IRSA(IAM Roles for Service Accounts)**로 pod에 역할을 부여합니다. `use_environment_credentials=1`이 AWS SDK 기본 체인을 타고 `AWS_WEB_IDENTITY_TOKEN_FILE`을 픽업합니다. `✓`

### 3.1 IAM 정책 — cold 버킷 최소권한 `✓`

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

- IAM role 신뢰정책은 EKS OIDC provider + `system:serviceaccount:<ns>:<sa>` 조건(eksctl `--approve`나 IRSA 모듈이 생성). `✓`

### 3.2 ServiceAccount + pod 연결 `✓`

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: clickhouse-s3
  namespace: clickhouse
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/clickhouse-cold-s3
```

이 SA를 CHI podTemplate `spec.serviceAccountName`(§2)에 지정하면 EKS webhook이 pod에 `AWS_ROLE_ARN`·`AWS_WEB_IDENTITY_TOKEN_FILE` env와 projected token 볼륨을 자동 주입합니다. `✓`

### 3.3 IRSA 함정

- `region` 명시 필수 `≈`: IRSA는 STS regional endpoint 서명이 얽혀 `region`을 지정하지 않으면 서명·리다이렉트 오류가 나기 쉽습니다. disk XML에 `region`와 `endpoint` 리전 도메인을 둘 다 적습니다.
- `{replica}` 경로 분리 필수 `✓`: `metadata_type=local`은 shared-nothing이라 RF>1에서 replica들이 같은 S3 prefix를 쓰면 blob을 서로 덮어씁니다. operator 예제가 `.../s3_disk/{replica}/`인 이유입니다.
- clickhouse-backup의 IRSA self-assume 버그(#798) `✓`: 백업 도구는 `AWS_ROLE_ARN`이 있으면 자기 자신을 다시 assume 시도하는 이슈가 있었습니다. 이는 **백업 사이드카** 얘기지 CH 서버 disk와는 별개이나, 같은 클러스터에서 백업도 IRSA로 붙일 때 `AssumeRoleARN`이 설정돼 있지 않은지 확인합니다.
- **CH 서버 disk에서 IRSA `use_environment_credentials` 실동작(최소 버전·필수 env·`AWS_EC2_METADATA_DISABLED` 영향)은 스테이징 실측이 필요합니다** — 백업 도구 이슈는 확인됐으나 서버 disk 경로는 미실측입니다. `?`

### 3.4 S3 Gateway VPC Endpoint — 티어링 절감의 전제조건

권한(IRSA)이 뚫렸으면 다음은 **경로**입니다. CH 파드는 프라이빗 서브넷에 있고 S3는 VPC 밖 서비스라, 라우팅을 따로 잡지 않으면 cold 트래픽이 NAT Gateway를 탑니다. **S3 Gateway VPC Endpoint는 시간요금·데이터 처리요금이 모두 0원**이고 없으면 그 트래픽에 **NAT Gateway 데이터 처리요금 $0.059/GB**(서울, 게이트웨이 시간요금 $0.059/h는 별도)가 붙습니다 `✓`.

금액이 작지 않습니다. 3개월 지평·RF2에서 cold로 내려가는 양이 월 300GB 규모이므로 NAT를 타면 쓰기만으로 **월 $18~24**(캐시 미스 읽기 포함)가 붙습니다 `Σ⁽계산⁾`. 티어링으로 얻는 절감액은 같은 조건에서 **월 $50 규모**(같은 데이터를 gp3에 두는 것과의 차이 — [08 §3]({{< relref "08-block-only-tuning.md" >}})의 상주 배수 계산과 독립적으로 정합합니다)이므로, 경로 하나 때문에 **절감액의 35~50%가 잠식됩니다** `Σ⁽계산⁾`. 스토리지 단가를 3.65배 낮추려고 켠 티어링의 이득 절반이 사라지는 구조입니다. Gateway Endpoint는 무료라 이 항목에는 트레이드오프가 없습니다. 그래서 배포 순서에서 IRSA 직후에 옵니다.

{{< callout type="important" >}}
이 항목은 지금까지 이 문서군의 본문에 아예 없었습니다 — 권한(IRSA)은 조립돼 있는데 그 권한으로 나가는 경로의 요금이 비어 있었습니다. 워커 노드 서브넷의 라우팅 테이블에 S3 Gateway Endpoint가 실제로 걸려 있는지 확인하는 절차는 운영 트랙 [의사결정 가이드]({{< relref "../../hyperdx-operating/03-decision-guide.md" >}})의 배포 전 실측 체크리스트가 소유합니다 — 요금·근거는 이 장이, 확인 명령은 실행 트랙이 갖습니다.
{{< /callout >}}

## 4. TTL 기준 문서 — RUM 테이블별 hot/cold/DELETE

> **이 표가 카테고리의 TTL 단일 기준 문서입니다.** [용량 산정]({{< relref "07-capacity-planning.md" >}})은 이 표를 relref하고 보존 지평(3개월/6개월/1년)에 따른 DELETE 값만 변주합니다. 두 페이지가 다른 TTL을 나란히 싣지 않게 하려는 규칙입니다.

### 4.1 ClickStack 관리 테이블 스키마 `✓`

ClickStack이 자동 생성하는 테이블(기본 DB=`default`). 전부 `ENGINE=MergeTree` + `ttl_only_drop_parts=1`, `PARTITION BY toDate(...)`.

| 테이블 | 타임스탬프 (TTL 기준 컬럼) | 기본 TTL 식 |
|---|---|---|
| `otel_logs` | `Timestamp DateTime64(9)` | `toDateTime(Timestamp) + ${TABLES_TTL}` |
| `otel_traces` | `Timestamp DateTime64(9)` | `toDateTime(Timestamp) + ${TABLES_TTL}` |
| `otel_metrics_gauge` / `_sum` / `_histogram` / `_summary` | `TimeUnix DateTime` | `toDateTime(TimeUnix) + ${TABLES_TTL}` |
| `hyperdx_sessions` | `Timestamp DateTime64(9)` (+ `TimestampTime DateTime`) | `TimestampTime + ${TABLES_TTL}` |

- TTL 식이 `DateTime`(초 단위) 기준임에 주의: logs/traces/metrics는 `toDateTime(Timestamp/TimeUnix)`, sessions는 `TimestampTime`(DateTime 물질화 컬럼)을 씁니다. **우리 MOVE DDL도 이 동일 식을 확장**해야 파티션 프루닝·TTL 머지가 정합적입니다. `✓`

{{< callout type="warning" >}}
기본 TTL 값의 오해부터 차단합니다. ClickStack 공식 "Managing TTL" 문서는 *"기본 3일"* — `${TABLES_TTL}`이 **모든 테이블에 균일 적용**되는 단일 값(문서상 72h)이라고 명시합니다 `✓`. 일부 2차 자료가 언급하는 "logs 14 / traces 30 / metrics 90 / sessions 7"의 신호별 값은 **ClickStack 배포 기본이 아니라** HyperDX 로컬 모드/특정 버전 신호이거나 권장치일 수 있습니다 `?`. 아래 우리 값(14/30일 hot 등)은 **우리가 의도적으로 설정하는 권장치**지 "기본값"이 아닙니다. 배포 후 `SHOW CREATE TABLE`로 실제 `${TABLES_TTL}`을 확인합니다.
{{< /callout >}}

### 4.2 TTL 기준 문서 표 (우리 RUM 워크로드) `≈`

hot 창은 **디버깅 최근성**으로, cold 이동/DELETE는 **보존 지평**으로 정합니다. 세션 리플레이만 예외 — 아래 §4.4.

| 테이블 | hot(EBS) | cold(S3) 시작 | DELETE (지평별) | 근거 |
|---|---|---|---|---|
| `otel_logs` | 14일 | 14일~ | **90 / 180 / 365일** | 디버깅 최근성 + 로그 볼륨 |
| `otel_traces` | 14일 | 14일~ | **90 / 180 / 365일** | span 고volume, 최근 위주 조회 |
| `otel_metrics_*` | 30일 | 30일~ | **180 / 365일** | 장기 추세 — 3개월 지평에서도 최소 180 권장 |
| `hyperdx_sessions` | **30일(전 수명)** | **미이동** | **30일 고정** | 리플레이 급감·volume 지배 → §4.4 |

- "지평별" = [07]({{< relref "07-capacity-planning.md" >}})의 3개월/6개월/1년 시나리오에 맞춘 DELETE 값. 아래 DDL은 **3개월 지평(logs/traces 90, metrics 180)** 을 기준으로 쓰고 6개월/1년은 주석으로 변주만 바꿉니다.
- 캐파 hot EBS 사이징은 이 hot 창으로 계산합니다: logs·traces 14일, metrics·sessions 30일치가 hot(EBS)에 상주합니다(sessions는 전 수명이 hot). 상세 산정은 [07]({{< relref "07-capacity-planning.md" >}}).

### 4.3 정책 연결 + TTL MOVE DDL `✓/≈`

HyperDX는 schema-agnostic(앱은 SQL로만 read/write, 스키마 소유 아님)이라 `ALTER TABLE ... MODIFY TTL ... TO VOLUME 'cold'`는 앱 개입 없이 안전합니다 `✓`. 단 OTel exporter가 `create_schema:true`(기본)면 재기동 시 자기 TTL/스키마를 다시 얹을 수 있으니 **프로덕션은 `create_schema:false`로 스키마를 직접 관리**합니다 `✓`.

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

- 적용 직후 반영을 원하면 저트래픽 창에 `ALTER TABLE ... MATERIALIZE TTL`을 돌리고 `merge_with_ttl_timeout`을 하향해 TTL 머지 우선순위를 올립니다. `✓`
- `ttl_only_drop_parts=1`(ClickStack 기본)이라 DELETE는 part 전체가 만료돼야 통째로 드롭됩니다. 파티션이 `toDate`(일 단위)라 정합적입니다. `✓`

**배포 직후 백필/긴급 hot 확보용 수동 이동**(`MODIFY TTL`은 이후 머지에서 점진 적용되므로, 이미 쌓인 과거 파티션을 즉시 내리려면 명시 이동):

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

### 4.4 왜 `hyperdx_sessions`는 S3에 안 내리나 `≈`

세션 리플레이(rrweb)는 **볼륨을 지배하면서도 유용 수명이 가장 짧습니다** — 인시던트 재현은 사고 직후 며칠 안에 끝나고, 오래된 리플레이의 조회 가치는 급감합니다. 여기에 리플레이를 S3로 내리면 (a) cold 이동 자체의 쓰기·List/Delete 비용, (b) `{replica}` 경로에 **RF배수 사본**(RF2=2벌), (c) part metadata 로컬 잔존(§5.1)이 붙는데, 정작 그 데이터를 다시 읽을 일이 드뭅니다 → **S3 이전이 순비용**입니다. 따라서 sessions는 `rum_hot_cold` 정책을 붙이지 않고 **기본 `default` 정책(EBS only)에 두고 30일 DELETE**로 끝냅니다. hot 볼륨에 sessions 30일치가 상주하므로 EBS 사이징에 그만큼 반영합니다([07]({{< relref "07-capacity-planning.md" >}})). 리플레이 압축비(약 5x 가정)는 공개 실측이 없어 `≈`이며 스테이징 실측으로 확정합니다.

## 5. 함정 (worked example에서 반드시 경고)

거꾸로 S3 티어링을 쓰지 않는 선택지(짧은 보존·staging·운영 단순성)는 [블록 온리 튜닝]({{< relref "08-block-only-tuning.md" >}})이 다룹니다. 이 페이지의 `storage_configuration`·IRSA·cache·`move_factor`가 통째로 빠지는 변형입니다.

### 5.1 part 메타데이터·cache가 로컬(EBS)을 먹는다 → 사이징 반영 `✓`

`metadata_type=local`이라 **S3에 있는 part도 로컬 매핑 파일**(`metadata_path`)이 남고 `cache` disk(`s3_cache/path`)도 EBS를 씁니다. 즉 hot EBS PVC는 다음을 다 담아야 합니다:

```
EBS PVC 용량 ≥  hot 데이터(로그·트레이스 14일 + 메트릭·세션 30일)
              + part metadata(로컬 상주, part 수에 비례)
              + s3_cache LRU(max_size, 예 150Gi)
              + 머지 여유(peak 시 part 순간 공존)
              (+ 로그는 별도 log VCT 권장)
```

- metadata 자체는 소량이나 **part 수가 많으면**(잦은 INSERT·미머지) 무시 못 합니다 — 정량은 워크로드 의존이라 스테이징 실측이 필요합니다 `?`. 로컬 최대 소비항은 보통 `cache max_size`입니다.
- 이 항들을 hot 데이터량과 함께 EBS 사이징에 명시하는 것은 [용량 산정]({{< relref "07-capacity-planning.md" >}})의 몫입니다.

### 5.2 S3 lifecycle → Glacier/IA 전환 금지 `✓`

{{< callout type="error" >}}
**cold 데이터 버킷에 S3 lifecycle로 Glacier/IA 전환을 걸면 안 됩니다.** cold 데이터는 ClickHouse가 언제든 GET 하는 **살아있는 테이블의 일부**라, Glacier(비동기 복원)면 쿼리가 깨지고 부분 전환은 part 체인/테이블을 파괴합니다. cold = **S3 Standard 유지**. 백업(clickhouse-backup) 버킷과 cold 데이터 버킷을 **분리**하고, lifecycle은 백업 버킷에만 신중히 겁니다(그마저 incremental 체인은 Glacier 금지). 배경은 [로컬 NVMe 티어링]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})입니다.
{{< /callout >}}

### 5.3 zero-copy replication 금지 (relref) `✓`

RF2에서 "S3에 사본 1벌로 줄이자"는 유혹이 생기지만 zero-copy는 프로덕션 금지(#45346)입니다. **각 replica가 `{replica}` 경로에 자기 사본**을 갖는 표준 RMT를 유지합니다. 데이터 손실 사고 배경은 [로컬 NVMe 페이지의 error 콜아웃]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})에 위임합니다.

### 5.4 cold 쿼리 지연 = 캐시 미스 `✓`

- cold(S3) part를 처음 조회하면 캐시 미스 → S3 왕복(수십~수백 ms). `cache_on_write_operations=1`로 **이동 시점에 프리페치**하면 첫 조회를 완화합니다. 대시보드가 자주 긁는 기간은 hot 창에 넣는 것이 근본책입니다.
- hot·cold가 같은 CH 서버에 붙어 한 쿼리가 두 티어를 투명하게 횡단하므로 컴퓨트 격리가 없습니다(OpenSearch UltraWarm 전용 노드와 다름). cold full-scan이 hot 쿼리 리소스를 잠식할 수 있습니다. `✓`

### 5.5 사본 경제와 내구성 — cold도 RF배수, 티어링은 내구성이 아니다 `✓`

"S3라서 싸다"는 GB 단가 얘기고 **사본 수는 RF 그대로**입니다(RF2면 S3에도 2벌 + 백업). UltraWarm식 단일 사본 절감은 self-host에서 성립하지 않습니다 — 비용은 [07]({{< relref "07-capacity-planning.md" >}})에서 RF배수로 계상하고 구조 배경은 [클릭하우스 티어링]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})입니다.

{{< callout type="error" >}}
- 볼륨 내구성 ≠ 데이터 내구성. gp3 99.8~99.9%·S3 11 nines는 매체가 그 사본을 안 잃을 확률이지, 우리 데이터가 안전하다는 뜻이 아닙니다. 데이터 내구성·가용성은 **멀티 AZ RF2+ ReplicatedMergeTree + `clickhouse-backup → S3`**가 담당합니다. `✓`
- cold(S3)도 RF배수 사본입니다. `metadata_type=local`은 shared-nothing이라 각 replica가 `{replica}` 경로에 자기 사본을 갖습니다(RF2면 S3에도 2벌). "S3라서 사본 1벌로 줄이자"는 zero-copy replication은 프로덕션에서 금지입니다(#45346, §5.3). `✓`
- 즉 티어링(hot→cold 이동)은 **비용·조회지연 축**이고 내구성은 **RF 복제 + 백업 축**입니다. 둘을 같은 결정으로 섞지 않습니다.
{{< /callout >}}

![hot·cold 2계층 티어링 구조 — hot 티어의 노드당 단일 gp3 EBS와 cold 티어의 S3 Standard·replica별 RF배수 사본을 TTL이 TO VOLUME과 DELETE로 잇는 그림, 그리고 티어링은 내구성이 아니라는 주석](/images/hyperdx/tiering-hot-cold.svg)
*hot(노드당 단일 gp3 EBS)과 cold(S3 Standard, `{replica}` 경로마다 RF배수 사본을 두는 shared-nothing) 2계층을 시간 기반 TTL이 `TO VOLUME 'cold'`로 잇고 `DELETE`로 만료시킵니다. 세션 리플레이만 cold로 안 내리고 hot 30일 후 삭제합니다. 내구성은 티어링이 아니라 멀티 AZ RF 복제 + 백업이 담당하며, cold(S3)도 RF배수 사본을 두고 zero-copy는 금지입니다.*

### 5.6 요청 비용의 구조 — 왜 우리 cold tier는 request가 싼가

GB 단가만 보면 티어링 판단의 절반을 놓칩니다. S3는 저장량 외에 **요청 수**로도 과금하고, 서울 단가는 다음과 같습니다 `✓`:

| 요청 종류 | 서울 단가 |
|---|---|
| PUT / COPY / POST / LIST | **$4.50** / 백만 요청 |
| GET / SELECT 등 읽기 | **$0.35** / 백만 요청 |
| DELETE | **무료** |

**PUT이 GET의 약 13배**이므로 요청 비용의 향방은 "S3에 무엇을 몇 번 쓰는가"가 정합니다. ClickHouse의 쓰기 단위는 part인데, wide part는 컬럼당 최소 2파일(`.bin`+`.mrk2`)에 메타 파일이 붙어 **컬럼 109개 테이블이 part당 227파일**이 되는 실측 예시가 공식 KB에 있습니다 `✓`. 머지가 S3 위에서 일어나는 구성이면 이 파일 수가 쓰기 증폭 배수만큼 PUT으로 환산돼 스토리지 절감을 압도합니다.

우리 설계는 그 경로를 구조적으로 피합니다. `prefer_not_to_merge`를 켜지 않으므로(§1.2) 머지는 hot(EBS)에서 끝나고 **S3가 보는 쓰기는 TTL MOVE 시점의 part 1회 업로드뿐**입니다 `Σ`. 남는 것은 이동량에만 비례하는 소량의 PUT과 cold 조회 GET이고 DELETE는 무료라 TTL DELETE는 요청 비용에 잡히지 않습니다. 지평별 절대 금액은 [07 §4.6]({{< relref "07-capacity-planning.md" >}})이 PUT 항목까지 포함해 계상하며, 같은 규모에서 §3.4의 NAT 처리요금이 훨씬 큰 항목입니다 — **cold tier에서 실제로 위험한 비용은 요청이 아니라 네트워크 경로**입니다 `Σ`.

`prefer_not_to_merge`를 기본 false로 두는 이유는 `TOO_MANY_PARTS` 방어에서 끝나지 않습니다 — **요청 비용 방어이기도 합니다.** 반대로 머지를 S3 위에서 하는 구성(S3를 primary로 두는 경로)의 기각 근거는 [클릭하우스 스토리지 전략]({{< relref "../../clickhouse/02-storage-local-nvme.md" >}})이 소유합니다.

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

위 쿼리들은 `system.storage_policies`/`system.disks`/`system.parts`/`system.part_log`/`system.events`/`system.filesystem_cache` 조회로 확인 가능한 표준 인터페이스입니다 `✓`.

계측을 배포 순서에 넣습니다. 스토리지 GB만 보고 티어링을 판단하면 안 된다는 것이 이 장 §5.4~§5.6의 결론이므로, 티어링을 켜기 전에 `system.events`의 `%S3%` 카운터를 **베이스라인으로 한 번 찍고** 이동 후 델타를 봅니다 `Σ`. 캐시 히트율은 1주 관측 후 `s3_cache`의 `max_size`를 보정하는 입력입니다.

- cold 이동이 **예상보다 이르면**(최근 데이터가 S3로 감) → `move_factor`가 높거나 hot이 부족하다는 신호입니다(§1.3). `≈`
- 배포 초기엔 `system.parts`에서 `disk_name='default'`(hot)의 테이블별 크기가 §4.2 hot 창(14/30일)과 맞는지 1회 실측해 사이징을 보정합니다.
{{% /details %}}

## 우리 케이스에서는

- hot = EBS `default` 디스크(gp3 기본, IOPS/throughput 부족 시 io2 — [02]({{< relref "02-hot-storage-ebs.md" >}})), cold = S3 Standard + `cache` disk(EBS LRU `max_size` 150Gi, `cache_on_write`). `storageManagement.provisioner: Operator`로 EBS 무중단 확장을 활용합니다(로컬 NVMe와 근본 차이).
- 인증 = IRSA(정적 키 금지), `use_environment_credentials=1` + `region` 명시 + `{replica}` 경로 분리(shared-nothing 필수). CH 서버 disk의 IRSA 실동작은 스테이징 실측 대상 `?`.
- 주입 = CHI `files`의 `config.d/storage_configuration.xml`, pod `serviceAccountName`=IRSA SA. 외부 직접 마운트 금지. 권한 다음이 경로입니다. S3 Gateway VPC Endpoint를 먼저 확인합니다(무료, 없으면 NAT 처리요금 $0.059/GB가 절감액의 35~50%를 먹습니다, §3.4).
- TTL 기준 문서(이 페이지가 단일 출처): logs·traces hot 14일→S3→DELETE 90/180/365, metrics hot 30일→S3→DELETE 180/365, **sessions는 S3 미이동·hot만·DELETE 30일**. 주 이동은 시간 TTL, `move_factor=0.1`(안전판만), `prefer_not_to_merge` 미설정. 07은 이 표를 relref해 지평별 DELETE만 변주합니다.
- 사이징 주의: EBS는 hot + part metadata(로컬 상주) + `cache max_size` + 머지 여유를 모두 담습니다. hot 데이터량만으로 PVC를 잡지 않습니다([07]({{< relref "07-capacity-planning.md" >}})).
- 금지 3종: S3 lifecycle→Glacier, zero-copy replication, `prefer_not_to_merge=true`. 마지막 항목은 `TOO_MANY_PARTS` 방어이면서 요청 비용 방어입니다. 머지를 hot에서 끝내므로 S3가 보는 쓰기가 이동 1회뿐입니다(§5.6).
- 내구성은 티어링과 다른 축입니다. 멀티 AZ RF2 복제 + 백업이 담당하고, cold(S3)도 RF배수 사본이라는 원칙은 어떤 티어 선택에서도 흔들지 않습니다(§5.5).
- 기본 TTL 오해 차단: ClickStack 기본은 `${TABLES_TTL}` 단일값(문서상 3일); 위 신호별 14/30/90/… 은 우리가 권장하는 설정치입니다. 배포 후 `SHOW CREATE TABLE`·`system.parts`로 실측해 보정합니다.
- 켤지 말지는 여기서 정하지 않습니다(§0). 결정표는 [08 §6]({{< relref "08-block-only-tuning.md" >}}), 우리 클러스터의 승급·회귀 판단은 운영 트랙 의사결정 가이드가 소유합니다. 이 장은 켠 뒤의 조립과 비용 누수를 소유합니다.

시점 기준 2026-08.
