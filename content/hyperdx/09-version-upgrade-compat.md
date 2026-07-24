---
title: "버전 호환성·업그레이드 — 스택 전 구성요소 매트릭스와 EBS 롤백"
weight: 9
---

# 버전 호환성·업그레이드 — 스택 전 구성요소 매트릭스와 EBS 롤백

[operator 운영]({{< relref "../clickhouse/05-altinity-operations.md" >}})이 CH 서버 롤링 업그레이드 런북(shard 내 1 replica씩·shard 간 병렬·혼합버전 창)·operator 자체 minor 단계별 업그레이드·CRD 삭제 절대금지·안전장치 3층·Keeper(CHK) 업그레이드를 이미 깊게 다뤘고, [operator 토폴로지·다운타임]({{< relref "04-operator-topology-downtime.md" >}})이 롤링 중 다운타임·EBS reattach 물리 역학을 다뤘다. 이 페이지는 그 일반 메커니즘을 반복하지 않고, **HyperDX 스택 전체를 한 매트릭스로 묶었을 때 무엇이 무엇과 붙는가**, 그리고 **EBS-first에서 업그레이드를 어떻게 되돌리는가** 한 축에만 집중한다. 새로 깊게 파는 것은 넷이다: (1) 6개 구성요소 상호 버전 호환 매트릭스, (2) CH `compatibility` 서버 설정, (3) 다운그레이드 비지원과 그 실질 롤백 경로, (4) EBS 스냅샷 기반 롤백. 일반 롤링 런북은 전부 위 두 페이지로 위임한다.

{{< callout type="info" >}}
**한눈에**

- 이 스택은 **독립적으로 버전이 도는 6개 구성요소**(ClickHouse·Keeper·Altinity operator·HyperDX·OTel Collector·MongoDB)다. 각자 별도 케이던스로 올린다 — "한 번에 다 올리기"는 원인 추적을 불가능하게 하므로 금지 `≈`.
- **버전 핀 정책**: CH/Keeper는 **24.8 LTS(또는 검증된 안정판) 명시 핀**, 최신 추종 금지. operator는 **0.27.1**(2026-06-04, 최신). ClickStack의 "최소 24.8"과 차트 기본 이미지 "25.7-alpine"은 **다른 숫자다** — self-host HyperDX Only라 우리가 이 두 숫자를 분리해서 통제한다(하한만 넘기면 됨).
- **CH는 함부로 못 내린다**: 온디스크 파트 포맷이 바뀐 뒤(25.8 JSON·25.10 String 직렬화·25.8 marks 등)로는 이전 버전이 새 파트를 못 읽어 startup에서 죽는다. `compatibility` 서버 설정은 **"동작 기본값 회귀 방지"**용이지 **롤백이 아니다**.
- **실질 롤백은 스냅샷/백업뿐**. EBS-first에선 **업그레이드 직전 데이터 볼륨 EBS 스냅샷**이 가장 확실한 롤백 지점이고, `clickhouse-backup`을 이중 안전으로 건다.
- **operator 0.27.0+가 `async_replication`/`use_xid_64`를 기본 활성화 → Keeper 25.3+ 요구**. 우리가 CH/Keeper를 24.8로 핀하면 이 기본값이 충돌할 수 있어 **배포 스테이징에서 실동작 검증이 필요한 매트릭스 함정** `?`.
- 일반 롤링 런북·혼합버전 창·CRD 금지·안전장치 3층은 [operator 운영]({{< relref "../clickhouse/05-altinity-operations.md" >}})이 기준 문서다. 블록 온리의 업그레이드 단순성은 [블록 온리 튜닝]({{< relref "08-block-only-tuning.md" >}}).
{{< /callout >}}

## 1. 버전 호환성 매트릭스 — 스택 전 구성요소

우리는 ClickStack 표준 차트를 그대로 쓰지 않고 `clickhouse.enabled: false`(HyperDX Only)로 CH/Keeper를 [Altinity CHI/CHK로 분리]({{< relref "01-stack-topology.md" >}}) 운영한다. 그래서 "차트가 배포하는 기본 이미지"와 "우리가 실제로 핀하는 이미지"는 별개이며, 아래 매트릭스가 그 경계를 명확히 한다.

### 1.1 마스터 매트릭스 (2026-07 확인)

| # | A ↔ B | 요구/권장 | 근거 |
|---|---|---|---|
| ① | **ClickStack/HyperDX ↔ ClickHouse** | **최소 24.8 LTS 이상**(24.8·25.x 지원). self-host에서 외부 CH 참조 시 24.8+ 필수 | `✓⁽ClickStack docs⁾` |
| ② | **ClickStack 차트 기본 CH 이미지** | `clickhouse/clickhouse-server:25.7-alpine` (차트가 실제 배포하는 태그) | `✓⁽values.yaml⁾` — 최소요구(24.8)와 차트기본(25.7)은 **다른 숫자** |
| ③ | **HyperDX app ↔ CH 스키마/기능** | `LowCardinality`·`Map`·bloom filter 2차 인덱스·`TTL ... ttl_only_drop_parts` 등 **MergeTree 표준 기능만** 사용 → 하한이 24.8 LTS로 낮게 유지됨(신규 JSON 타입 강제 아님) | `✓/≈` |
| ④ | **MongoDB ↔ HyperDX** | **5.0.32**(차트 기본), ReplicaSet(차트 기본 `members:1`). 메타데이터 전용이라 버전 민감도 낮음 | `✓⁽values.yaml⁾` — 부하 프로파일은 {{< relref "../rum/07-hyperdx-mongodb.md" >}} |
| ⑤ | **OTel Collector ↔ ClickStack** | `docker.clickhouse.com/clickstack-otel-collector:2.29.0`, mode: deployment. ClickStack 배포판(표준 upstream 아님) | `✓⁽values.yaml⁾` — persistent queue 확장 포함 여부는 {{< relref "05-keeper.md" >}} §옵션A로 재확인 |
| ⑥ | **HyperDX 이미지 ↔ 차트** | `docker.hyperdx.io/hyperdx/hyperdx`, 태그 미지정 시 차트 `appVersion` 추종. 명시 오버라이드하면 appVersion과 어긋날 수 있음 | `✓⁽values.yaml⁾` |
| ⑦ | **Altinity operator 0.27.1 ↔ CH / K8s** | operator 0.27.1 → **CH 21.11+**, **K8s 1.25+**. 더 오래된 CH는 operator 0.23.7 이하 필요 | `✓⁽Artifact Hub / release notes⁾` — 우리 CH(24.8~25.x)는 여유롭게 범위 안 |
| ⑧ | **Altinity operator ↔ CRD apiVersion** | CHI=`clickhouse.altinity.com/v1`, CHK=`clickhouse-keeper.altinity.com/v1`. operator가 CRD를 소유(Helm이 기존 CRD 미수정) | `✓⁽CRD 원문·Helm README⁾` |
| ⑨ | **operator 0.27.0+ 기본값 ↔ Keeper 버전** | operator 0.27.0+가 `async_replication`/`use_xid_64`를 **기본 활성화** → **Keeper 25.3+ 필요** | `✓⁽release notes⁾` — **매트릭스 함정**(§1.4) |

### 1.2 매트릭스에서 나오는 실전 결정 3가지

1. **CH 이미지 = 24.8 LTS 핀 vs 25.x 추종.** ClickStack 최소요구는 24.8 LTS, 차트 기본은 25.7이다. self-host(Altinity CHI)에서는 `podTemplate` 이미지 태그를 **우리가 직접 정한다** — 관측성 워크로드는 안정성이 우선이므로 **LTS(24.8) 또는 검증된 최근 안정판을 핀**하고 25.x 최신 추종은 하지 않는 게 기본 `≈`.
2. **Keeper 이미지 = CH 이미지와 정렬.** CHK `clickhouse/clickhouse-keeper` 태그를 CH 서버와 같은 메이저.마이너로 맞춘다(둘 다 24.8). ClickStack 차트는 Keeper를 별도 이미지 없이 CH 서버 이미지로 돌리지만, 우리는 Altinity CHK로 분리하므로 태그를 명시 정렬한다 `✓/≈`.
3. **컴포넌트별 업그레이드는 독립 관심사.** CH·operator·Keeper·HyperDX·OTel·MongoDB는 각각 별도 케이던스로 올린다. 한 reconcile에 여러 변화를 몰면 원인 추적이 불가능해지고, [이미지+설정 동시변경 crash(#1926)]({{< relref "../clickhouse/05-altinity-operations.md" >}})와 같은 결의 위험이 생긴다 `≈⁽corpus 원칙 연장⁾`.

### 1.3 정정 — "최소 24.8"과 "차트 기본 25.7"은 모순이 아니다 `✓`

{{< callout type="warning" >}}
ClickStack 문서의 "24.8+ 요구"는 **호환 하한(floor)**이고, 차트 `values.yaml`의 `25.7-alpine`은 **그 시점 차트가 실제 배포하는 기본 태그**다. self-host에서 외부 CH를 Altinity로 운영하면 이 두 숫자는 우리가 분리해서 통제한다 — 하한(24.8) 이상이기만 하면 어떤 버전을 핀하든 ClickStack이 붙는다. 04·05의 CHI 예제가 `24.8`을 쓰는 것과 차트 values의 `25.7`이 충돌하는 게 아니다.
{{< /callout >}}

### 1.4 매트릭스 함정 — operator 0.27+ 기본값 ↔ Keeper 25.3+ `?`

⑨는 배포 전 반드시 실측해야 하는 지점이다. operator **0.27.0+**는 `async_replication`과 `use_xid_64`를 **기본 활성화**하는데, 이 기능들은 **Keeper 25.3+**를 요구한다 `✓⁽release notes⁾`. 우리가 CH/Keeper를 **24.8 LTS로 핀**하면(§1.2-2) operator가 이 기본값을 켠 상태에서 Keeper 24.8과 충돌할 수 있다.

- **검증 항목**: 24.8 CH + 24.8 Keeper + operator 0.27.x 조합에서 operator가 이 두 기본값을 (a) 그대로 켜서 오류를 내는지, (b) Keeper 버전을 감지해 자동 무효화하는지 `?`.
- **핀 vs 기본값**: 필요하면 CHK/CHI 설정에서 `async_replication`을 명시적으로 끄거나, Keeper만 25.3+로 올리는 결정을 스테이징에서 확정한다. "operator 최신 = 무조건 안전"이 아니라 **operator 기본값이 우리 핀 버전보다 최신 Keeper를 전제할 수 있다**는 게 핵심 함정이다.

## 2. `compatibility` 서버 설정 — 업그레이드 안전 노브

### 2.1 무엇인가 `✓`

`compatibility` 설정은 **"지정한 이전 버전의 기본 설정값(default settings)을 그대로 쓰게"** 한다. 값은 버전 문자열(`'24.8'` 등), 빈 값이 기본(비활성).

- **핵심 규칙**: **명시적으로 바꾸지 않은 설정만** 영향받는다 — 사용자가 이미 override한 설정은 존중된다. 즉 "바이너리는 신버전으로 올렸지만 동작 기본값은 옛 버전에 고정"하는 노브다.
- **업그레이드와의 상호작용**: 업그레이드로 CH 바이너리가 올라가도 `compatibility='24.8'`이면 24.8 시절 기본값으로 동작 → 신규 기본값 변화로 인한 **조용한 회귀(silent regression)**(쿼리 결과·성능·리소스 사용 변화)를 막는다.

### 2.2 어디에 넣나 `✓`

| 레벨 | 방법 |
|---|---|
| 세션 | `SET compatibility = '24.8';` |
| 쿼리 | `SELECT ... SETTINGS compatibility = '24.8'` |
| 프로파일(영속) | `users.xml` 프로파일에 지정 → Altinity에서는 **CHI `configuration.profiles`로 선언**(operator가 XML 렌더) |

Altinity 운영이면 평문 XML 직접 주입을 피하고 **CHI의 `configuration.profiles`**로 넣는다 — operator가 이를 `users.xml` 프로파일로 렌더한다 `≈⁽profiles→users.xml 렌더는 corpus 사실의 귀결. 렌더된 users.xml은 도입 시 확인⁾`.

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

### 2.3 언제 쓰나 `≈`

1. **메이저 버전 업그레이드 직후**: 새 기본값이 쿼리 결과·성능·리소스 사용을 바꾸는 것을 유예한다. `compatibility`를 옛 버전으로 핀한 채 올리고, 스테이징에서 새 기본값을 하나씩 검증한 뒤 핀을 제거/상향한다.
2. **혼합버전 창 중**: 롤링 도중 노드마다 버전이 다를 때 동작 편차를 줄이는 보조 수단(혼합버전 창 자체의 규칙은 [operator 운영]({{< relref "../clickhouse/05-altinity-operations.md" >}})).

{{< callout type="error" >}}
**혼동 금지 `✓`**: `compatibility`는 **설정 기본값만** 되돌린다 — **온디스크 파트 포맷·기능 자체는 되돌리지 못한다**(§3). 즉 "동작 롤백"이지 "데이터/버전 롤백"이 아니다. `compatibility='24.8'`을 걸었다고 25.10 바이너리를 25.9로 내릴 수 있는 게 아니다.
{{< /callout >}}

## 3. 다운그레이드 정책 — CH는 함부로 못 내린다

### 3.1 핵심 명제 `✓`

> **ClickHouse는 온디스크 데이터 포맷이 바뀌지 않은 경우에만 롤백(다운그레이드)할 수 있다.** "새 버전 포맷으로 파트를 다시 쓰는 작업을 하지 않은 상태"에서만 이전 버전으로 되돌릴 수 있다.

바이너리를 내리는 것 자체는 쉽지만, **디스크의 파트를 옛 버전이 못 읽으면** 그 노드는 startup에서 죽거나 파트가 `detached/broken-on-start_*`로 떨어진다.

### 3.2 다운그레이드가 불가능해지는 트리거 (2026 확인)

| 트리거 | 효과 | 근거 |
|---|---|---|
| **JSON 타입 advanced shared data 기본 활성화(v25.12)** | 25.8 미만이 새 JSON 컬럼 파트를 못 읽음 → **25.8 미만으로 불가** | `✓⁽v25.12 BIC⁾` |
| **String `with_size_stream` 직렬화 기본 활성화(v25.11)** | 새 직렬화 포맷은 25.10부터 지원 → **25.10 미만으로 불가** | `✓⁽v25.11 BIC⁾` |
| **marks 포맷 변경(25.8)** | 25.3.1이 25.8.2가 만든 파트의 marks를 못 읽어 startup fatal(`getMarksTypeFromFilesystem`) → **25.8→25.3 롤백 불가** | `✓⁽issue #86837⁾` |
| **24.7의 pre-21 온디스크 포맷 비호환** | 24.7 첫 기동에서 다수 파트 detach → 24.6 복귀 시 broken 파트 재attach 필요 | `✓/≈⁽#68198·#68408⁾` |
| **`OPTIMIZE TABLE ... FINAL` 실행** | 파트를 새 버전 포맷으로 재작성 → 롤백 창을 스스로 닫음 | `✓` |
| **신규 컬럼 타입(`Variant`/`JSON`)으로 신규 데이터 적재** | 옛 버전이 그 파트를 못 읽음 | `✓` |

{{< callout type="warning" >}}
**정정 — "CH는 언제든 이전 버전으로 되돌릴 수 있다"는 기각** `✓`. 25.10/25.8 같은 포맷 도입 이후로는 그 이전으로 못 내린다. 다운그레이드는 **버전 쌍마다 성립 여부가 다르며**, 안전한 롤백의 유일한 일반해는 스냅샷/백업이다.
{{< /callout >}}

### 3.3 롤백 창을 여는 규칙 & 실질 롤백 경로 `✓`

- **업그레이드 관찰 창(24~48h) 동안 롤백 창을 열어두려면**: (a) `OPTIMIZE ... FINAL` 금지, (b) 새 컬럼 타입/신규 기능 사용 금지, (c) 새 시스템 테이블/컬럼을 MV에서 참조 금지. 이 규칙을 지키면 온디스크 포맷이 그대로라 바이너리만 되돌려도 롤백 가능하다.
- **그 창을 넘겼거나 포맷이 바뀌면 실질 롤백은 오직 복구다**:
  - **사전 백업**: 업그레이드 직전 `BACKUP DATABASE ... TO ...` 또는 `clickhouse-backup create_remote`(FREEZE PARTITION 래핑 + S3 업로드).
  - **스키마 스냅샷**: `SELECT database, name, create_table_query FROM system.tables`를 사전에 저장.
  - **복구**: 서버 stop → `clickhouse-backup restore_remote <pre_upgrade>` → 패키지 다운그레이드 → start.

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

## 4. EBS/블록 온리 특유 업그레이드 안전

CH 다운그레이드가 포맷 때문에 막힐 수 있으므로(§3), EBS-first에서는 **업그레이드 직전 데이터 볼륨의 EBS 스냅샷**을 롤백 지점으로 삼는 게 가장 확실하다. 이것이 이 스택이 EBS-first이기에 추가로 얻는 롤백 축이다.

### 4.1 EBS 스냅샷 → 롤백 경로 `✓⁽AWS⁾`

- EBS 스냅샷은 **시점(point-in-time) 증분 백업**이다(첫 스냅샷만 full, 이후 델타). "위험한 배포 직전 스냅샷 = 깨끗한 롤백 지점".
- **정합성**: 스냅샷은 비동기(생성 즉시 시작, pending 동안 S3로 전송). AWS는 완전 정합 스냅샷을 원하면 스냅샷 전 볼륨 쓰기를 멈추라고 권고한다. CH는 롤링 중 해당 replica를 어차피 순차 정지하므로, **그 replica가 stop된 상태에서 스냅샷**을 뜨면 정합성이 좋다 `≈`.
- **복원**: 스냅샷에서 새 gp3 볼륨을 만들고(`create-volume --snapshot-id <id> --volume-type gp3`) PV/PVC를 교체해 그 시점 상태로 되돌린다.
- **replica 병렬성 활용**: RF2/RF3라 한 replica씩 업그레이드하므로, "한 replica 스냅샷 → 업그레이드 → 실패 시 그 replica만 스냅샷 복원 → 나머지 healthy replica에서 [델타 catch-up]({{< relref "04-operator-topology-downtime.md" >}})"이 성립한다 `≈`.

{{< seq caption="replica 단위 롤링 업그레이드 — stop→스냅샷→업그레이드, 실패 시 스냅샷 복원 + Keeper 델타 catch-up." >}}
{
  "participants": [
    {"id": "Op",   "label": "운영자"},
    {"id": "R",    "label": "replica(대상)"},
    {"id": "EBS",  "label": "EBS/스냅샷"},
    {"id": "Rest", "label": "나머지 healthy replica"}
  ],
  "steps": [
    {"msg": ["Op", "R"], "label": "1. PDB 준수하며 이 replica만 stop"},
    {"msg": ["R", "EBS"], "label": "2. stop 상태에서 데이터 볼륨 스냅샷(정합)"},
    {"msg": ["Op", "R"], "label": "3. 이미지 업그레이드 → 재기동 → readiness"},
    {"note": ["Op", "R"], "lines": ["관찰 24~48h: OPTIMIZE FINAL·신규 타입 금지", "(롤백 창 유지)"]},
    {"alt": "성공", "steps": [
      {"msg": ["Op", "Rest"], "label": "다음 replica로 진행"}
    ], "elseLabel": "실패(포맷 손상/startup fatal)", "elseSteps": [
      {"msg": ["EBS", "R"], "label": "create-volume --snapshot-id --volume-type gp3 → PV/PVC 교체"},
      {"msg": ["Rest", "R"], "label": "Keeper 로그 델타만 catch-up"}
    ]}
  ]
}
{{< /seq >}}

```bash
# 실패 시: 업그레이드 전 스냅샷에서 gp3 볼륨 복원
aws ec2 create-volume \
  --snapshot-id snap-0abc... \
  --volume-type gp3 \
  --availability-zone ap-northeast-2a   # 원 볼륨과 같은 AZ (EBS는 AZ-bound)
# → 새 volume-id를 PV의 volumeHandle로 교체하고 PVC를 재바인딩
```

> **EBS는 AZ-bound**라 복원 볼륨은 반드시 원 볼륨과 같은 AZ에 만든다 — AZ 종속·reattach 전제는 [operator 토폴로지·다운타임]({{< relref "04-operator-topology-downtime.md" >}})이 기준 문서다.

### 4.2 allowVolumeExpansion ↔ 업그레이드 순서 상호작용 `≈`

- gp3 온라인 확장(`allowVolumeExpansion: true`)과 CH 버전 업그레이드는 **별도 reconcile로 분리**한다 — [이미지+설정 동시변경 crash(#1926)]({{< relref "../clickhouse/05-altinity-operations.md" >}})와 같은 결의 위험이다. 볼륨 확장 중 롤링을 겹치면 STS 업데이트 경합이 생길 수 있다.
- 확장 경로의 **데이터손실 주의(issue #1385)**와 온라인 확장 상세는 [블록 온리 튜닝]({{< relref "08-block-only-tuning.md" >}}).

### 4.3 PVC Retain으로 실수 삭제 방어 `✓/≈`

- `reclaimPolicy: Retain`(operator·StorageClass 이중)이면 CHI/STS 재생성이나 `helm uninstall`에도 EBS PVC가 잔존 → 업그레이드 중 실수로 리소스를 지워도 데이터 볼륨은 살아남는다. operator/Helm이 만든 PVC는 애초에 `helm uninstall`로 안 지워진다. reclaimPolicy 미준수 버그(#1619)와 이중 방어는 [hot 스토리지·EBS]({{< relref "02-hot-storage-ebs.md" >}}).

### 4.4 블록 온리(무 S3)의 업그레이드 단순성 `≈`

S3 cold 티어가 없으면 업그레이드 중 **티어 간 정합(로컬 파트 메타 ↔ S3 오브젝트)** 우려가 원천적으로 없다. `storage_policy`가 내장 `default` 하나뿐이라 disk 설정·IRSA·endpoint 이슈가 업그레이드 표면에서 빠진다 — 즉 블록 온리는 업그레이드 롤백 추론이 **"EBS 스냅샷 하나"**로 단순해진다. 전량 EBS 사이징·operator 볼륨 튜닝은 [블록 온리 튜닝]({{< relref "08-block-only-tuning.md" >}}), S3 티어링 시의 정합 고려는 [S3 cold 티어링]({{< relref "03-s3-cold-tiering.md" >}}).

## 5. ClickStack/HyperDX 업그레이드 경로

### 5.1 ClickStack Helm v1 → v2 = 파괴적 변경 `✓⁽UPGRADE.md⁾`

| 컴포넌트 | v1.x (before) | v2.x (after) |
|---|---|---|
| MongoDB | 인라인 Deployment | **MongoDB K8s Operator(MCK)의 `MongoDBCommunity` CR** |
| ClickHouse | 인라인 Deployment | **ClickHouse Operator의 `ClickHouseCluster` + `KeeperCluster` CR** |
| OTel Collector | 인라인 `otel.*` 블록 | **공식 OTel Collector Helm subchart** |

- **2단계 설치**: `helm install clickstack-operators ...` → `helm install my-clickstack ...`. uninstall은 역순.
- **in-place 업그레이드 금지 권고**: 문서는 "기존 MongoDB/ClickHouse Deployment가 Helm에 의해 삭제된다"며 **기존 배포 옆에 fresh install 후 데이터 마이그레이션**을 권한다(in-place 아님).
- **PVC 보호**: MongoDB/ClickHouse operator가 만든 PVC는 `helm uninstall`로 삭제되지 않음 → 수동 정리 필요. 사전에 PVC 백업.
- **values 재구성**: `hyperdx.*`가 resource-type 구조로 이동(`config`→ConfigMap, `secrets`→Secret, `frontendUrl`→`appUrl`, `tasks`가 `hyperdx.tasks`). `mongodb.image/port/persistence.*`·`clickhouse.image/persistence.*`·`otel:` 블록은 **제거됨** → 오버라이드 재작성 필수.

### 5.2 우리 배포에 주는 함의 `≈`

우리는 이미 **`clickhouse.enabled: false`(HyperDX Only)로 CH/Keeper를 Altinity CHI/CHK로 분리** 운영한다([스택 토폴로지]({{< relref "01-stack-topology.md" >}})). 그래서 v2의 "내장 CH를 공식 operator CR로 관리"라는 파괴적 변경의 상당 부분이 **우리에겐 적용되지 않는다** — 업그레이드 표면이 다음처럼 좁아진다:

| 표면 | 경로 |
|---|---|
| **CH/Keeper** | ClickStack 차트 밖. [Altinity 롤링 업그레이드]({{< relref "../clickhouse/05-altinity-operations.md" >}}) 경로로 독립 처리(§1·§3·§4) |
| **HyperDX 앱** | `docker.hyperdx.io/hyperdx/hyperdx` 태그 상향(기본 appVersion 추종). MergeTree 표준 기능만 쓰므로 CH 24.8+ 유지 시 앱 업그레이드가 CH 하한을 새로 요구하는 경우는 드묾 `≈` |
| **OTel Collector** | 배포판 태그(2.29.0 기준) 상향. persistent queue 확장은 {{< relref "05-keeper.md" >}} 재확인 항목 |
| **MongoDB** | 메타데이터 전용·소용량이라 리스크 낮음. v2에서 `MongoDBCommunity` CR로 관리 시 MCK operator 경로. 5.0.32 기준. 부하 프로파일 {{< relref "../rum/07-hyperdx-mongodb.md" >}} |

즉 HyperDX Only 구조가 ClickStack v1→v2의 가장 파괴적인 부분(내장 CH 삭제·재설치)을 **회피**시켜 준다 — 우리의 ClickStack 차트 업그레이드는 사실상 HyperDX + OTel + 외부 CH 참조 설정 표면으로 국한된다.

## 6. 일반 업그레이드 런북 (relref 위임)

아래는 이미 corpus에 기준 문서가 있으므로 여기서 재서술하지 않는다. 요지 한 줄 + 링크로만 둔다.

- **CH 서버 롤링**: shard 내 1 replica씩·shard 간 병렬·혼합버전 창 ~1년/2 LTS·중간 LTS 징검다리·`podTemplate` 이미지 태그 변경으로 트리거 → [operator 운영]({{< relref "../clickhouse/05-altinity-operations.md" >}}).
- **operator 자체**: minor 단계별(0.26→0.27)·CRD 삭제 절대금지·이미지+설정 분리 reconcile·안전장치 3층(STS recreate 정책·aborted reconcile 자동 재개·pre/post SQL 훅) → [operator 운영]({{< relref "../clickhouse/05-altinity-operations.md" >}}).
- **Keeper(CHK)**: 0.26→0.27 무마이그레이션·0.23.x 수동 PV·4LW 라이브니스 전환 → [operator 운영]({{< relref "../clickhouse/05-altinity-operations.md" >}}).
- **롤링 다운타임·EBS reattach 물리 역학·`reconcile.statefulSet.update.timeout`** → [operator 토폴로지·다운타임]({{< relref "04-operator-topology-downtime.md" >}}).

## 우리 케이스에서는

- **버전 핀 정책을 배포 문서에 표로 고정한다**: CH 24.8 LTS(또는 검증된 안정판) / Keeper=CH 태그 정렬(둘 다 24.8) / operator 0.27.1(CH 21.11+·K8s 1.25+) / MongoDB 5.0.32 / OTel 2.29.0 / HyperDX=appVersion. 최신 추종은 하지 않고, ClickStack 최소요구(24.8)를 항상 상회하도록만 관리한다. operator 0.27+의 `async_replication` 기본값 ↔ Keeper 25.3+ 상호작용(§1.4)은 **24.8 핀 시 스테이징 실측 항목**으로 못박는다.
- **업그레이드 3규칙**: ① 이미지·설정·볼륨확장은 각각 **별도 reconcile**(동시변경 crash 회피), ② 업그레이드 직전 **EBS 스냅샷 + `clickhouse-backup` 이중 안전**, ③ 관찰 24~48h 동안 `OPTIMIZE FINAL`·신규 타입 사용 금지로 **롤백 창 유지**. RF2/RF3라 replica 단위로 "스냅샷 → 업그레이드 → 실패 시 그 replica만 스냅샷 복원 → 나머지에서 델타 catch-up"이 성립한다.
- **다운그레이드는 "없다고 가정"한다**: 포맷 도입 버전(25.8/25.10 등) 이후로는 스냅샷/백업 복구가 유일한 롤백이다. `compatibility` 설정은 **"동작 회귀 방지"용이지 롤백이 아니다**를 팀 룰로 명문화한다.
- **블록 온리라 롤백 추론이 단순하다**: S3 티어 정합 우려가 없어 "EBS 스냅샷 하나"로 시점 복원이 닫힌다. 전량 EBS 사이징·볼륨 튜닝은 [블록 온리 튜닝]({{< relref "08-block-only-tuning.md" >}})으로 이어진다.
- 시점 기준 2026-07.
