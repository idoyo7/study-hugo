---
title: "ClickHouse 운영"
weight: 6
cascade:
  type: docs
---

# ClickHouse 운영 — 채택을 전제했을 때의 how

{{< callout type="info" >}}
이 도메인이 답하는 질문은 하나입니다. "ClickHouse를 **채택했다면 어떻게 운영하나(how)**". **채택 여부**는 로깅 챕터 D4(**통합 저장소는 earn-it-last** = 보류)가 이미 답했고 이 챕터는 그 결정을 뒤집지 않습니다 — RUM 내재화 + 범용 분석 니즈가 CH를 요구하고 운영 인력이 있는 **전제**에서만 발동합니다.

**배포**는 EKS self-host(인력·20TB+·스토리지 성능 세 조건 충족 시) · **스토리지**는 로컬 NVMe(hot) + S3(cold) · **엔진**은 ReplicatedMergeTree(self-host 강제) · **operator**는 Altinity. 근거·조건은 아래 「핵심 결정 요약」 표와 각 페이지.
{{< /callout >}}

"채택할 것인가"의 답은 이 챕터 밖에 이미 나와 있습니다. 로깅 챕터의 **D4 결정은 "통합 저장소는 earn-it-last"**입니다. 로그만 놓고 보면 self-hosted ClickHouse를 1차 채택안으로 밀지 않습니다([로깅 · 옵저버빌리티]({{< relref "../logging/_index.md" >}}), [ClickHouse (self-hosted)]({{< relref "../logging/04-clickhouse.md" >}})). 이 챕터는 그 결정을 뒤집지 않습니다. 여기서는 **전제가 다른 시나리오**를 가정합니다 — [RUM 내재화]({{< relref "../rum/_index.md" >}})와 범용 분석 니즈가 ClickHouse를 요구하고 인프라 운영 인력이 이미 있는 경우의 **운영 전략(how)**입니다. 그 RUM 대체 니즈 자체가 **"RUM에서 아래로 자라는 스택"**의 산물입니다 — Datadog RUM 내재화를 시발점으로 FE(`@hyperdx/browser`)·BE(Java/Python OTel 재계측) trace를 병행 확장하고 컨테이너 로그 수집까지 검토합니다. 이 흐름이 성숙해 로그·트레이스·RUM을 한 저장소로 합칠 때 self-hosted CH가 무대에 오릅니다.

## 이 챕터의 위치 — 전제 차이

두 챕터의 결론이 어긋나 보이는 것은 전제가 다르기 때문입니다. 한쪽을 임의로 승격하거나 번복하지 말고 아래 축으로 나눠 읽습니다.

| | 로깅 챕터(D4) | 이 챕터 |
|---|---|---|
| 관점 | 로그 내재화 — 로그만의 규모/형태로 저장소 선택 | RUM 대체 + 범용 분석 + 인력 보유 전제 |
| 팀 가정 | PLG 방치 이력의 소규모 플랫폼 팀 | 이미 EKS·광범위 Datadog 운영 → 전담 인력 존재 |
| self-host CH | 운영 부담이 managed보다 크다 → 1차 안 아님 | 세 조건(인력·20TB+·스토리지 성능)이 self-host를 가리킴 |
| 답하는 질문 | **채택 여부** → earn-it-last(보류) | **운영 방법** → 채택했다면 이렇게 |

{{< callout type="important" >}}
이 챕터의 권고는 **"ClickHouse를 채택하기로 이미 결정한 경우"에만** 발동합니다. 채택 자체가 아직 정당화되지 않았다면 로깅 챕터의 판단이 우선입니다.
{{< /callout >}}

## 핵심 결정 요약

판정만 한 줄씩 적었고 근거·조건·반례는 각 장이 소유합니다. 이 표를 정본으로 쓰지는 않습니다 — 같은 사실을 여러 장에 재기재하면 정정도 여러 번 해야 하기 때문입니다.

| 축 | 판정 | 근거 정본 |
|---|---|---|
| **배포** | EKS self-host — 인력 보유 + 20TB+ 24/7 + 스토리지 성능 세 조건이 겹칠 때만. 그 밖이면 managed `≈` | [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}}) |
| **인스턴스** | i8g 우선 / i7i 차선(x86 의존 시) / i7ie·i3en(초고밀도 목적일 때만) `✓` | [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}}) |
| **스토리지** | 로컬 NVMe(hot) + S3(cold, TTL MOVE). 내구성은 디스크가 아니라 복제로 `✓` | [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}}) |
| **zero-copy** | 프로덕션 금지. 폐기된 게 아니라 `EXPERIMENTAL`로 남아 있다는 표현 구분까지 포함 `Σ` | [스토리지 · zero-copy 금지]({{< relref "02-storage-local-nvme.md" >}}) — 이 챕터의 **단일 정본** |
| **S3 primary** | 안 쓴다. 문법적으로는 가능하나 `plain_rewritable`이 RMT와 배타다 `Σ` | [스토리지 · S3 primary의 OSS 경로]({{< relref "02-storage-local-nvme.md" >}}) · 3갈래 분리는 [Iceberg·레이크하우스]({{< relref "09-iceberg-lakehouse.md" >}}) |
| **엔진** | ReplicatedMergeTree 강제 — SharedMergeTree는 Cloud 전용 `✓` | [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}}) |
| **operator** | Altinity clickhouse-operator로 통일. 공식 operator는 아직 알파, ClickStack은 `clickhouse.enabled: false`로 외부 CH 참조 `✓` | [Altinity operator]({{< relref "03-operator.md" >}}) |
| **데이터레이크** | Iceberg는 지금 도입하지 않는다. 재검토 3조건은 그 장이 못박아 뒀다 `Σ` | [Iceberg·레이크하우스]({{< relref "09-iceberg-lakehouse.md" >}}) |

## 운영에서 놓치기 쉬운 것

채택을 결정했다면 아래가 "나중에 아프다"의 단골입니다. **여기서는 무엇을 조심할지만 적고 수치·설정·절차는 전부 각 장이 소유합니다.**

- **노드 소실 재수화 시간이 replica 여유도를 갉아먹습니다** — 설계 변수는 노드당 데이터량과 replica 수의 균형입니다. "재수화 위험 창"의 정의와 두 레버는 [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}}), 실제 복구 절차는 [변경관리·복구]({{< relref "05-altinity-operations.md" >}}).
- **백업·티어링은 각자 다른 것을 지킵니다** — incremental 체인의 취약성, S3 lifecycle로 Glacier 전환 금지, "티어링 ≠ 내구성"은 모두 [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}})의 내구성 3종 세트가 소유합니다.
- **Karpenter consolidation이 스토리지 지역성을 무시하고 노드를 없앱니다** — `do-not-disrupt`가 무엇을 막고 무엇을 못 막는지, 방어 5조합은 [스토리지 · Karpenter]({{< relref "02-storage-local-nvme.md" >}}).
- **ClickStack의 MongoDB는 무인증 노출 사례가 있습니다.** 인증 + NetworkPolicy 격리가 필수 `✓`.
- **한 클러스터에 여러 워크로드를 몰면 서로 간섭합니다** — 국내 CDP 사례가 self-host 국면에서 실제로 부딪힌 문제입니다. 그 기록은 [무신사 CDP]({{< relref "08-musinsa-cdp.md" >}})가 소유하고 처방(CHI 분리)은 [operator 배포 플레이북]({{< relref "04-deployment-playbook.md" >}}).

## 이 챕터 구성 (문서 지도)

- **[Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}})** — ClickHouse Cloud / BYOC / ClickHouse Private / Altinity.Cloud Anywhere / Aiven 비교와 TCO 크로스오버 — "인력 보유 여부"가 데이터 크기보다 결정적인 이유. Cloud가 쥔 부품 4개와 라이터 failover 재검토 트리거도 여기.
- **[스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}})** — 네 가지 스토리지 전략 비교, 로컬 NVMe hot + S3 cold 티어링, 휘발성 내구성 3종 세트(멀티 AZ replica·clickhouse-backup·Keeper), zero-copy 금지와 `plain_rewritable` 기각, Karpenter·재수화. 이 챕터의 **스토리지·티어링 정본**입니다.
- **[Altinity operator]({{< relref "03-operator.md" >}})** — Altinity 채택 근거, 채택 손익분기점(replica 2개), operator 2종 공존 문제와 해법(Altinity로 통일 + ClickStack 외부 CH 연결).
- **[operator 배포 플레이북]({{< relref "04-deployment-playbook.md" >}})** — 03·02 결정을 "**처음** 서는 클러스터"로 묶는 종합 문서 — CHK/CHI 매니페스트 필드, local PV 5계층, storageManagement·티어링 주입, RF 선택과 쓰기 내구성 노브, 안티패턴·배포 전 체크리스트.
- **[변경관리·스케일·롤링 업그레이드·복구]({{< relref "05-altinity-operations.md" >}})** — 서고 난 뒤의 변경관리 — 규모별 구성 관점, 스케일 in/out의 함정(자동 리밸런싱 없음·신규 shard 스키마 수동), ClickHouse 버전·operator 자체·Keeper 롤링 업그레이드, 노드 소실 재수화·Keeper 정족수 상실 복구 런북, 백업·모니터링·GitOps 연계.
- **[프로덕션 운영 사례]({{< relref "06-production-usecases.md" >}})** — K8s + operator + 로컬 NVMe 실증(PostHog 등), Karpenter/재수화 운영 함정과 소규모 팀 운영 가능성.
- **[로컬 NVMe 데이터스토어 벤치마킹]({{< relref "07-local-nvme-datastore-patterns.md" >}})** — 02 결정의 **외부 강화 근거**. ScyllaDB·Kafka·Redpanda·ES/OpenSearch·Aerospike·TiKV·CockroachDB 등 9개 시스템 횡단 비교로 "로컬 NVMe 1차 + 복제 내구성 + S3 티어링"이 업계 표준인지 검증하고 02에 없던 리스크(재수화 MTTR·cross-AZ 비용)와 node lifecycle 대가를 더합니다.
- **[무신사 CDP — self-hosted ClickHouse에서 Cloud로]({{< relref "08-musinsa-cdp.md" >}})** — 노드 결합 스토리지로 스케일 국면까지 밀고 간 국내 CDP 사례 한 건의 상세 기록 — 걸린 것(스토리지 결합·고정 스펙·워크로드 간섭·운영 부담), Cloud 이전 사유, 절감 수치의 이식 한계.
- **[Iceberg·레이크하우스]({{< relref "09-iceberg-lakehouse.md" >}})** — 파일/테이블/카탈로그/엔진 4층 모델, ClickHouse 의 Iceberg 읽기·쓰기 버전 게이트(25.7~26.7), MergeTree 와의 성능·워크로드 격차, "S3 메인"의 세 갈래 분리와 Antalya 의 위치.
- **[출처]({{< relref "10-sources.md" >}})** — 이 섹션 근거 URL 모음.

## 자매 챕터

- [로깅 · 옵저버빌리티 → ClickHouse (self-hosted)]({{< relref "../logging/04-clickhouse.md" >}}) — 로그 내재화 관점에서 내린 **채택 여부** 판단(강점·약점·적합/부적합). 이 챕터의 how는 그 결정을 뒤집지 않습니다.
- [RUM 내재화 → HyperDX 심층]({{< relref "../rum/01-hyperdx-deep-dive.md" >}}) — ClickHouse를 백엔드로 쓰는 관측성 프론트(HyperDX/ClickStack)의 상세. 이 챕터가 운영하는 CH 위에 올라갑니다.

## 우리 케이스에서는

로깅 챕터의 D4(**통합 저장소는 earn-it-last**)는 여전히 유효합니다 — 로그만 놓고 self-hosted CH를 1차로 밀지 않습니다. 이 챕터는 그 판단과 모순되지 않고 **RUM을 Datadog에서 빼내고 범용 분석까지 CH로 흡수하기로 결정한 뒤**에야 의미가 있습니다. 그 결정이 서면 조사의 권고는 이렇습니다. 배포는 EKS self-host(인력·20TB+·성능 요구 세 조건 충족이 전제), 스토리지는 로컬 NVMe hot + S3 cold, operator는 Altinity로 통일하고 ClickStack은 외부 CH를 참조하게 합니다. 세 조건 중 하나라도 확정되지 않으면 managed 견적과 반드시 비교하고 애초에 채택 자체를 재검토합니다. 시점 기준 2026-08.

> **근거 표기 범례**: `✓` 확인됨(1차 출처 검증) · `≈` 추정 · `Ⓥ` 벤더 주장 · `?` 미확인 · `Ⓑ` 퍼블릭 벤치마크 · `Σ` 종합 판단. `⁽ ⁾`는 부가 설명, `✓/≈`처럼 병기하면 혼재를 뜻합니다.
