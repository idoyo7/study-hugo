---
title: "HyperDX 직접 운영하기"
weight: 8
aliases: ["/hyperdx/00-operating-hyperdx/", "/hyperdx/operating/"]
cascade:
  type: docs
---

# HyperDX 직접 운영하기

{{< callout type="info" >}}
**한눈에**
- 챕터 정본(01~10) 위에서 "직접 운영하려면 어떤 순서로 무엇을 판단해야 하나"를 6부로 실체화한 운영 트랙.
- 관통 원칙(챕터 로드맵에서 승계): 모든 결정을 "왜/어떻게 안전한가"와 함께 본다.
- 읽는 순서 = 아래 표 순서: 아키텍처 → 티어링 → 가용성 → operator 패턴 → 규모 산정 → 의사결정 가이드.
- 매니페스트 전문·산식 유도·1차 출처 URL은 이 트랙이 아니라 챕터 정본(01~09)·출처(10)가 담당한다.
{{< /callout >}}

이 섹션은 [HyperDX 내재화]({{< relref "../hyperdx/_index.md" >}}) 챕터의 10개 정본 문서 위에서, 실제로 우리 손으로 배포·운영하려면 **어떤 순서로 무엇을 판단해야 하나**를 6부로 나눠 자기완결적으로 서술하는 트랙이다. 챕터를 관통하던 원칙 하나를 그대로 승계한다 — **모든 결정을 "왜/어떻게 안전한가"와 함께 본다.** 배포·스토리지·토폴로지·조정 계층의 기본값을 정할 때마다 "이 기본값이 어떤 장애를 어떻게 견디나", "이 규모에 왜 충분한가", "무엇이 승급 트리거인가"를 같은 자리에서 판단해야, 규모가 커질 때 무엇을 올려야 할지 알 수 있기 때문이다.

## 6부 구성

| 부 | 페이지 | 한 줄 요지 | 대응 정본 문서 |
|---|---|---|---|
| 1 | {{< relref "01-architecture.md" >}} | 4컴포넌트 조립·`clickhouse.enabled:false`(BYO)로 Altinity CHI/CHK 분리, RUM 인제스트엔 MongoDB 없음 | {{< relref "../hyperdx/01-stack-topology.md" >}} |
| 2 | {{< relref "02-tiering.md" >}} | hot=단일 gp3, cold=S3 TTL MOVE, 리플레이는 hot 30일 DELETE, 티어링≠내구성 | {{< relref "../hyperdx/02-hot-storage-ebs.md" >}}·{{< relref "../hyperdx/03-s3-cold-tiering.md" >}}·{{< relref "../hyperdx/08-block-only-tuning.md" >}} |
| 3 | {{< relref "03-availability.md" >}} | 컴포넌트별 blast radius 매트릭스, 무손실 2트랙(텔레메트리 vs 메타데이터) | {{< relref "../hyperdx/01-stack-topology.md" >}}(§7) |
| 4 | {{< relref "04-operator-pattern.md" >}} | 승격 없는 멀티마스터 복제, EBS reattach가 재수화를 대체, Keeper 정족수가 진짜 SPOF, 6구성요소 독립 케이던스 | {{< relref "../hyperdx/04-operator-topology-downtime.md" >}}·{{< relref "../hyperdx/05-keeper.md" >}}·{{< relref "../hyperdx/06-replication-failover.md" >}}·{{< relref "../hyperdx/09-version-upgrade-compat.md" >}} |
| 5 | {{< relref "05-capacity.md" >}} | 월 0.7TB raw vs on-disk 해석, 리플레이는 안 쌓인다, 1 shard×RF2로 prod ~$1.0K/mo | {{< relref "../hyperdx/07-capacity-planning.md" >}} |
| 6 | {{< relref "06-decision-guide.md" >}} | 7축 결정 매트릭스(기본값·왜 안전/충분·승급 트리거) + 관측 지점 + 배포 전 실측 체크리스트 | 01~09 전체를 종합(축별 정본은 06 표 각 행에 개별 링크) |

## 정본과의 관계

이 6개 페이지는 운영 관점에서 자기완결적으로 판단을 서술하는 트랙이고, 남김없는 세부·매니페스트 전문·산식 유도·1차 출처 URL은 챕터 정본(01~09)과 출처 모음({{< relref "../hyperdx/10-sources.md" >}})이 계속 담당한다. 트랙 페이지가 정본의 주장을 가져와 다시 쓰는 자리에서는 원문의 근거 기호(`✓`/`≈`/`Ⓥ`/`?`/`Ⓑ`/`Σ`)를 그대로 승계했으므로, 트랙과 정본 사이에 등급 불일치가 보이면 정본이 우선한다.

## 우리 케이스에서는

배포 판단 순서는 위 표 그대로다 — 아키텍처(1부)로 조립 형태를 정하고, 티어링(2부)으로 hot/cold를 나누고, 가용성(3부)으로 컴포넌트별 blast radius를 확인한 뒤, operator 패턴(4부)에서 클러스터 위 운영 난이도를 판단하고, 규모 산정(5부)으로 캐파·비용을 확정하고, 마지막 의사결정 가이드(6부)의 결정 매트릭스로 전체를 접는다. 배포 전 실측 4항목(0.7TB 해석·리플레이 압축비·기본 TTL·EBS reattach 실소요)을 staging에서 `✓`으로 승격하는 것이 착수 1번 작업이라는 결론은 6부와 동일하다. 시점 기준 2026-07.
