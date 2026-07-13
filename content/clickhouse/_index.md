---
title: "ClickHouse 운영"
weight: 6
cascade:
  type: docs
---

# ClickHouse 운영 — 채택을 전제했을 때의 how

ClickHouse를 **어떻게 운영할지**를 다루는 도메인이다. "채택할 것인가"의 답은 이미 다른 곳에 있다 — 로깅 챕터의 **D4 결정은 "통합 저장소는 earn-it-last"**, 즉 로그만 놓고 보면 self-hosted ClickHouse를 1차 채택안으로 밀지 않는다([로깅 · 옵저버빌리티]({{< relref "../logging/_index.md" >}}), [ClickHouse (self-hosted)]({{< relref "../logging/04-clickhouse.md" >}})). 이 챕터는 그 결정을 뒤집지 않는다. 대신 **전제가 다른 시나리오**를 가정한다: [RUM 내재화]({{< relref "../rum/_index.md" >}})와 범용 분석 니즈가 ClickHouse를 요구하고, 인프라 운영 인력이 이미 있는 경우의 **운영 전략(how)**. 그 RUM 대체 니즈 자체가 **"RUM에서 아래로 자라는 스택"**의 산물이다 — Datadog RUM 내재화를 시발점으로 FE(`@hyperdx/browser`)·BE(Java/Python OTel 재계측) trace를 병행 확장하고 컨테이너 로그 수집까지 검토하는 흐름이 성숙해 로그·트레이스·RUM을 한 저장소로 합칠 때 self-hosted CH가 무대에 오른다.

## 이 챕터의 위치 — 전제 차이

두 챕터의 결론이 어긋나 보이는 것은 전제가 다르기 때문이다. 임의로 승격·번복하지 말고 아래 축으로 읽는다.

| | 로깅 챕터(D4) | 이 챕터 |
|---|---|---|
| 관점 | 로그 내재화 — 로그만의 규모/형태로 저장소 선택 | RUM 대체 + 범용 분석 + 인력 보유 전제 |
| 팀 가정 | PLG 방치 이력의 소규모 플랫폼 팀 | 이미 EKS·광범위 Datadog 운영 → 전담 인력 존재 |
| self-host CH | 운영 부담이 managed보다 크다 → 1차 안 아님 | 세 조건(인력·20TB+·스토리지 성능)이 self-host를 가리킴 |
| 답하는 질문 | **채택 여부** → earn-it-last(보류) | **운영 방법** → 채택했다면 이렇게 |

즉 이 챕터의 권고들은 **"ClickHouse를 채택하기로 이미 결정한 경우"에만** 발동한다. 채택 자체가 아직 정당화되지 않았다면 로깅 챕터의 판단이 우선이다.

## 핵심 결정 요약

| 축 | 결정 | 조건 · 근거 |
|---|---|---|
| **배포** | EKS 자체 운영(self-host) | 인력 보유 + 20TB+ 24/7 + 스토리지 성능 요구 세 조건이 겹칠 때만. Cloud의 유일한 구조적 우위(people TCO 흡수)가 이미 상쇄된 경우다 `[추정]`. 그 밖이면 managed(Cloud/BYOC·Altinity.Cloud) |
| **인스턴스** | i8g 우선 / i7i 차선 | i8g는 Graviton4·최신 Nitro SSD, i7i와 IOPS 동일·~9% 저렴, ClickHouse ARM64 궁합 `[추정]`. x86 의존(사이드카 바이너리) 있으면 i7i, 초고밀도면 i7ie/i3en `[확인됨]` |
| **스토리지** | 로컬 NVMe(hot) + S3(cold, TTL MOVE) | 로컬 NVMe는 network block 대비 5~10x 빠르나 휘발성 → **내구성은 디스크가 아니라 복제로** `[확인됨]`. **zero-copy replication 금지**(22.8+ 기본 비활성, 데이터 손실 이슈 다수) `[확인됨]` |
| **엔진** | ReplicatedMergeTree | SharedMergeTree(compute-storage 완전 분리)는 **ClickHouse Cloud 전용** → self-host는 RMT 강제 `[확인됨]` |
| **operator** | Altinity clickhouse-operator | 7년+ 프로덕션 트랙레코드로 사실상 표준 `[확인됨]`. ClickHouse Inc. 공식 operator는 아직 알파. ClickStack은 `clickhouse.enabled: false`로 Altinity가 관리하는 **외부 CH를 참조** `[확인됨]` |

## 운영에서 놓치기 쉬운 것

채택을 결정했다면 아래는 "나중에 아프다"의 단골이다. 세부는 각 페이지에서 다룬다.

- **노드 소실 재수화 시간이 replica 여유도를 갉아먹는다.** 완전 소실 노드는 healthy replica에서 전량 재전송받으므로 소요 ≈ 노드 데이터량 / 네트워크 대역 — 실전은 압축 해제·머지·쓰기로 수 시간 `[추정]`. 노드당 데이터를 키우면(예: 40TB) 재수화 중 redundancy가 준다 → **노드당 데이터량과 replica 수의 균형** 설계가 필요 `[확인됨]`.
- **clickhouse-backup의 incremental 체인은 fragile.** 이전 백업 전체 체인에 의존해 하나라도 손상되면 이후 복구 불가 → 주간 full + 일간 incremental·정기 restore drill을 직접 소유 `[확인됨]`.
- **S3 cold tier에 part metadata는 로컬에 남는다.** desync 시 orphan S3 파일이 생기고, **S3 lifecycle policy로 Glacier 전환은 체인/테이블을 깨뜨릴 수 있어 금지** `[확인됨]`.
- **Karpenter consolidation이 스토리지 지역성을 무시하고 노드를 없앤다.** `do-not-disrupt`는 voluntary disruption만 막으므로 On-Demand/SP(Spot 금지) + PDB + 노드 expiration 억제로 보강 `[확인됨]`.
- **ClickStack의 MongoDB는 무인증 노출 사례가 있다.** 인증 + NetworkPolicy 격리가 필수 `[확인됨]`.

## 이 챕터 구성 (블록 지도)

| 페이지 | 다루는 것 |
|---|---|
| [Managed vs Self-hosted]({{< relref "01-managed-vs-selfhosted.md" >}}) | ClickHouse Cloud / BYOC / Altinity.Cloud Anywhere / Aiven 비교와 TCO 크로스오버 — "인력 보유 여부"가 데이터 크기보다 결정적인 이유 |
| [스토리지 · 로컬 NVMe]({{< relref "02-storage-local-nvme.md" >}}) | 네 가지 스토리지 전략 비교, 로컬 NVMe hot + S3 cold 티어링, 휘발성 내구성 3종 세트(멀티 AZ replica·clickhouse-backup·Keeper), zero-copy 금지 |
| [Altinity operator]({{< relref "03-operator.md" >}}) | Altinity 채택 근거, 채택 손익분기점(replica 2개), operator 2종 공존 문제와 해법(Altinity로 통일 + ClickStack 외부 CH 연결) |
| [프로덕션 운영 사례]({{< relref "04-production-usecases.md" >}}) | K8s + operator + 로컬 NVMe 실증(PostHog 등), Karpenter/재수화 운영 함정과 소규모 팀 운영 가능성 |
| [출처]({{< relref "05-sources.md" >}}) | 이 섹션 근거 URL 모음 |

## 자매 챕터

- [로깅 · 옵저버빌리티 → ClickHouse (self-hosted)]({{< relref "../logging/04-clickhouse.md" >}}) — 로그 내재화 관점에서의 **채택 여부** 판단(강점·약점·적합/부적합). 이 챕터의 how는 그 결정을 뒤집지 않는다.
- [RUM 내재화 → HyperDX 심층]({{< relref "../rum/01-hyperdx-deep-dive.md" >}}) — ClickHouse를 백엔드로 쓰는 관측성 프론트(HyperDX/ClickStack)의 상세. 이 챕터가 운영하는 CH 위에 올라간다.

## 우리 케이스에서는

로깅 챕터의 D4(**통합 저장소는 earn-it-last**)는 여전히 유효하다 — 로그만 놓고 self-hosted CH를 1차로 밀지 않는다. 이 챕터는 그 판단과 모순되지 않으며, **RUM을 Datadog에서 빼내고 범용 분석까지 CH로 흡수하기로 결정한 뒤**에야 의미를 가진다. 그 결정이 서면, 배포는 EKS self-host(단, 인력·20TB+·성능 요구 세 조건 충족 전제), 스토리지는 로컬 NVMe hot + S3 cold, operator는 Altinity로 통일하고 ClickStack은 외부 CH를 참조하게 하는 것이 조사의 권고다. 세 조건 중 하나라도 못 박히지 않으면 managed 견적과 반드시 비교하고, 애초에 채택 자체를 재검토한다. 시점 기준 2026-07.
