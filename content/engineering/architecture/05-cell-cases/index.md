---
title: "셀을 실제로 만든 곳들 — Slack·Roblox·GitLab·Shopify, 그리고 셀을 안 쓴 Uber"
linkTitle: "05 실전 사례"
weight: 5
date: 2026-09-22
lastmod: 2026-09-22
url: "/cellarch/05-cell-cases/"
---

# 05 · 셀을 실제로 만든 곳들 — Slack·Roblox·GitLab·Shopify, 그리고 셀을 안 쓴 Uber

{{< callout type="info" >}}
- **셀 경계는 조직마다 다른 것을 가리킨다** — Slack은 가용 영역, Roblox는 머신 세트, GitLab은 조직, Shopify는 데이터스토어만 나눈다 `✓`
- **Datadog 2023-03-08은 격리의 반례다** — 리전은 갈랐지만 OS 업데이트 파이프라인은 전역이라 전 리전이 동시에 멈췄다 `Ⓥ`
- **Uber와 Netflix는 셀을 쓰지 않는다** — 수천 개 서비스를 굴리는 두 회사는 리전 페일오버와 대피를 택했다 `✓`
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

트래픽과 데이터를 리전별로 갈라둔 Datadog도 전역 OS 업데이트 앞에서는 모든 리전이 함께 멈췄습니다 `Ⓥ`. 장애를 가두려면 요청이 흐르는 경계뿐 아니라 변경이 퍼지는 경계도 나눠야 합니다.

셀을 만든 조직들이 나눈 대상부터 서로 다릅니다. AZ, 머신 세트, 조직, 데이터스토어 중 어디에 경계를 긋느냐에 따라 라우터가 요청에서 읽어야 할 값과 컨트롤 플레인이 소유할 정보가 달라집니다. 경계가 배포 단위에만 머물면 장애는 여전히 셀을 넘나듭니다.

## 1. 셀 경계는 어디에 놓였나

[04 셀의 해부]({{< relref "/engineering/architecture/04-cell-anatomy/index.md" >}})에서 본 라우터·셀·컨트롤 플레인은 AWS 백서의 정의입니다. 실제 조직의 설계는 이 정의와 일치하지 않는 경우가 많습니다.

Slack은 클라우드 사업자가 물리적으로 갈라놓은 가용 영역(AZ)을 셀 경계로 썼습니다. Roblox는 데이터센터 안의 머신 약 1,400대 묶음을 셀로 삼았습니다 `✓`. GitLab은 조직(Organization)이라는 논리적 소유권을 partition key로 잡았습니다. Shopify pod는 컴퓨트를 공유하고 데이터스토어만 나눠, AWS 정의의 "완전한 워크로드 사본"에 미달합니다.

아래 도식에서 네 조직이 각각 어떤 자원을 경계 안에 넣었는지 비교할 수 있습니다.

{{< lane src="_lane/3-셀-경계.json" />}}

도식의 경계는 [격리 런타임]({{< relref "/platform/isolation/_index.md" >}}) 챕터에서 다룬 노드 안의 경계보다 큽니다. 여러 노드에 걸친 워크로드를 어디까지 묶어 복제하고, 무엇을 공유 자원으로 남기는지가 달라집니다.

Salesforce Hyperforce는 셀 하나를 오히려 3개 AZ에 걸쳐 배포합니다. Salesforce의 정의는 이렇습니다. "A cell is a collection of services serving a group of our customers… It is deployed across multiple availability zones for redundancy within the cell and is isolated from other cells." `✓` 같은 셀이라는 이름 아래에서도 AZ는 셀 사이의 경계가 되기도 하고, 셀 내부의 중복성을 확보하는 수단이 되기도 합니다.

## 2. Slack과 Roblox의 전환은 어디까지 진행됐나

Slack의 전환은 2021-06-30 us-east-1에서 겪은 회색 장애(gray failure)가 발단이었습니다 `✓`. 한 AZ 안의 서버는 백엔드가 살아 있다고 보고, 밖의 서버는 그 AZ에 닿지 않는다고 보는 비대칭 장애였습니다. 기존 헬스체크로는 잡히지 않았습니다.

1.5년에 걸친 전환 끝에 Slack은 HAProxy를 Envoy로 바꾸고, 자체 xDS 컨트롤 플레인 Rotor가 weighted cluster와 RTDS로 AZ별 가중치를 실시간 조정하게 만들었습니다. 드레인 목표는 5분이었고, siloed 서비스는 실제로 60초 만에 빠졌습니다 `✓`. 아래 도식은 이 드레인 과정에서 가중치 변경이 요청 경로에 반영되는 흐름을 보여줍니다.

{{< seq src="_seq/1-slack-drain.json" />}}

Slack은 이 드레인 경로를 주간 AZ 드레인 훈련으로 반복 실행하고, 훈련 결과로 마이그레이션 진척을 측정했습니다 `✓`. 경계를 설계한 뒤 실제로 트래픽을 빼낼 수 있는지 확인하는 과정까지 전환에 포함한 것입니다.

Roblox는 [03 공유 의존성 장애]({{< relref "/engineering/architecture/03-shared-failure/index.md" >}})에서 본 2021-10 73시간 전면 장애 이후 데이터센터를 약 1,400대 단위의 셀로 쪼갰습니다 `✓`. 2023년 말 시점에 백엔드 트래픽의 70%가 셀 안에서 처리됐지만, 셀 간 트래픽을 막는 라우팅 규율은 아직 없었습니다 `✓`. 물리적 경계를 먼저 세우고 라우팅 규율을 나중에 붙인 사례입니다. 2024년 이후 완료했다는 공개 후속 글은 찾지 못했습니다 `?`.

## 3. GitLab과 Shopify가 나눈 데이터 소유권

GitLab은 조직을 partition key로 삼고, 소유권이 셀을 따라 이동하는 스키마(`gitlab_main_org`)와 셀에 고정되는 스키마(`gitlab_main_cell_local`)를 나눴습니다 `✓`. Topology Service는 요청 경로·사용자명·쿠키 프리픽스로 소유 셀을 분류(Classify)합니다.

조직별로 셀을 나눠도 사용자명이나 이메일의 전역 유일성은 유지해야 합니다. GitLab은 이를 별도 서비스로 처리합니다. Claim Service는 생성 전에 값을 선점해 사용자명·이메일의 전역 유일성을 강제하고, Sequence Service는 셀마다 ID 블록을 임대해 충돌을 막습니다. org-scoped 스키마는 테넌트 이동도 전제합니다. 어느 데이터가 조직과 함께 움직이고 어느 데이터가 셀에 남는지를 스키마에서 구분한 것입니다.

Shopify pod는 2015년 단일 DB의 확장 한계에서 출발했습니다. job worker·앱 서버·로드밸런서는 여러 pod가 공유하되, "공유 자원은 한 번에 pod 하나만 상대한다"는 규율로 장애 전파를 막습니다 `✓`. 라우터 Sorting Hat은 룰 기반으로 요청을 pod에 매칭하고 헤더를 주입합니다. AWS 정의를 데이터 계층에서만 만족하는 절충안입니다.

Shopify의 Pod Mover는 테라바이트 규모 샵을 무중단으로 옮깁니다. GitLab의 스키마 설계와 마찬가지로, 테넌트 이동을 나중에 덧붙일 운영 작업으로 남기지 않습니다. 셀 사이에서 테넌트를 옮기는 메커니즘은 처음부터 만들어야 합니다.

## 4. 추가 사례와 공개 근거의 범위

DoorDash는 이미 있던 AZ 정렬 셀 위에 Envoy의 zone-aware routing을 얹어 cross-AZ 전송 비용을 줄였습니다. 서비스 디스커버리에 Consul을 쓰고, 그 위의 자체 xDS 컨트롤 플레인이 EDS로 AZ 메타데이터를 내려보냅니다. 1차 블로그 본문은 접근이 막혀 있어 세부 수치는 2차 보도로만 확인됩니다 `?`.

2025년 5~6월 Neon에서는 에이전틱 AI 워크로드로 데이터베이스 생성 요청이 5배, 브랜치 생성이 50배로 늘면서 단일 컨트롤 플레인이 감당하지 못해 연쇄 안정성 사고가 발생했습니다. 이후 셀 기반 구조로 옮겨갔다는 3자 해설이 있으나, Neon 자체 공식 문서와의 대조는 아직 마치지 못했습니다 `?`. 셀을 day one부터 두라는 AWS 권고와 연결되는 사례지만, 전환 내용은 이 확인 범위 안에서 읽어야 합니다.

Salesforce Hyperforce는 하루 1,000억 건 넘는 요청을 처리하고 셀이 수백 개 규모라고 밝힙니다. 다만 이 수치는 1차 엔지니어링 블로그가 아니라 2차 페이지에서만 확인됩니다 `Ⓥ`. Supercell이나 Functional Domain 같은 상위 개념의 1차 정의도 이번 조사에서는 확인하지 못했습니다 `?`.

2026년 9월 현재 국내 기업이 공개한 셀 기반 아키텍처 사례는 확인되지 않습니다 `?`. 컨퍼런스 세션 영상 안에는 있을 수 있지만 텍스트로 인덱싱되지 않았을 가능성도 있습니다. 국내 사례가 없다는 뜻이 아니라 이번 조사에서 찾지 못했다는 뜻입니다.

공개 자료에서 확인한 경계·라우터·규모는 아래와 같습니다. 같은 조직이라도 Slack 코어와 Egress처럼 플랫폼에 따라 셀 경계가 다릅니다.

| 조직 | 연도 | 셀 경계 | 라우터 | partition key | 크기 상한 | 주장 수치 | 출처 |
|---|---|---|---|---|---|---|---|
| Slack (코어) | 2022–2023 | AZ | Envoy + Rotor(xDS, weighted cluster·RTDS) | AZ | 명시 없음 | 드레인 5분 목표 / siloed 60초, 1% 단위, SLA 99.99% | slack.engineering 2023-08-22 `✓` |
| Slack (Egress) | 2024 | AZ 내 셀 | Route 53 가중 DNS + ARC | — | — | 486셀·15리전, cross-AZ 비용 −90%, 총비용 −75% | re:Invent 2024 ARC335 `Ⓥ` |
| Roblox | 2021– | 머신 세트 | 2023-12 시점 미완 | — | ~1,400대/셀 | 머신 36k→145k, 백엔드 트래픽 70% 피크 | about.roblox.com 2023-12-07 `✓` |
| DoorDash | 2023– | AZ | Envoy zone-aware + EDS | AZ | — | 메시 처리량 80M req/s | InfoQ 2024-01 `?` |
| GitLab | 2024– | Organization | HTTP/SSH Routing → Topology Service Classify | Organization | 명시 없음 | 셀당 ID 블록 100만 개 | docs.gitlab.com `✓` |
| Shopify | 2018– | 데이터스토어 세트 | Sorting Hat(LB 내 룰 매칭) | shop | 명시 없음 | 없음 | shopify.engineering 2018-03-02 `✓` |
| Salesforce Hyperforce | 2021– | 셀 = 3 AZ | 미확인 | 고객 그룹·org | 미확인 | 100B req/day, hundreds of cells | engineering.salesforce.com `Ⓥ` |

## 5. Datadog의 리전 경계를 넘은 OS 업데이트

2023-03-08, Datadog은 US1·EU1·US3·US4·US5 모든 리전, 여러 클라우드 사업자에 걸친 전체 다운을 겪었습니다 `Ⓥ`. 사전에 밝혀둔 격리 수준은 낮지 않았습니다. "Datadog's regions are fully isolated software stacks on multiple cloud providers... don't share any infrastructure, don't share any data storage." `Ⓥ`

원인은 변경 경로에 있었습니다. systemd 보안 업데이트가 VM에 자동 적용되면서 `systemd-networkd`가 Cilium이 관리하던 라우트를 강제로 지웠고, 해당 노드들이 한꺼번에 오프라인이 됐습니다 `Ⓥ`. 리전별로 갈라둔 것은 런타임 트래픽과 데이터였습니다. OS 이미지·패키지 저장소·자동 업데이트 정책은 전역으로 공유돼 있었습니다.

04편에서 다룬 wave deployment는 이 변경 경로를 나누는 규율입니다. 셀을 잘게 나눠도 같은 변경을 전 셀에 동시에 밀어 넣으면 장애를 가둘 수 없습니다. AWS 백서가 안티패턴으로 꼽는 "모든 셀에 동시에 코드 업데이트를 적용하는 것"이 Datadog에서 일어난 실패와 같은 모양입니다. 변경 축이 격리되지 않아 생긴 더 최근의 사례는 [07 2025 us-east-1 해부]({{< relref "/engineering/architecture/07-aws-2025-outage/index.md" >}})에서 다룹니다.

## 6. Uber와 Netflix는 리전을 대피시킨다

Uber는 2026년 기준 약 6,000개 마이크로서비스를 운영하면서도 셀을 고르지 않았습니다 `✓`. 도시 단위 트래픽을 리전에 묶고, 서비스마다 리전 페일오버를 독립적으로 흡수할 용량을 갖추는 방식을 택했습니다.

Uber의 DOMA(Domain-Oriented Microservice Architecture, 2020)를 셀과 같은 것으로 묶는 2차 서술도 있습니다. 그러나 DOMA는 2,200개 마이크로서비스를 도메인으로 묶은 조직·API 경계이며, 장애 격리 단위가 아닙니다. 두 프로그램은 별개입니다 `✓`.

페일오버 용량은 모든 서비스에 균일하게 2배를 예약하는 대신, 비즈니스 중요도에 따라 네 프로필로 나눴습니다. 비크리티컬 서비스는 평시에 크리티컬 서비스용 페일오버 버퍼를 기회주의적으로 사용합니다.

| 티어 | 프로필 | 동작 |
|---|---|---|
| T0, T1 | Always-On | in-place 스케일업, sub-second RTO |
| T2 | Active-Migrate | 무중단 라이브 마이그레이션 |
| T3–T5 | Restore-Later | 약 1시간 복구 허용 |
| non-prod | Terminate | 페일오버 중 복구 안 함 |

이 재설계로 용량 예약을 2배에서 1.3배로 낮추고 100만 코어 이상을 회수했습니다 `✓`. 런타임 검출과 정적 분석을 함께 수행해 페일오버에서 살아남지 못하는 의존 관계도 4,155건 찾아냈습니다 `✓`. 용량을 확보하는 것만으로는 부족하며, 실제 의존 관계가 페일오버를 허용하는지도 확인해야 했습니다.

Netflix는 shadow ASG로 리전 전체를 대피(evacuation)시키는 시간을 약 1시간에서 10분 미만으로 줄였습니다. 인스턴스를 미리 띄워두되 메트릭 보고와 디스커버리 등록을 막고, 페일오버가 걸릴 때만 깨웁니다. 기존 예약 용량을 재사용하므로 비용 중립입니다 `≈`.

Slack·Roblox·GitLab의 셀과 Uber·Netflix의 대피를 가르는 것은 워크로드의 모양입니다. 파티션 키가 자연스럽게 나뉘고 cross-tenant 조회가 적다면 셀이 맞습니다. 리전 전체를 한 단위로 옮겨야 할 만큼 상태가 얽혀 있다면 대피가 더 현실적입니다. 테넌트 간 조회가 많은 워크로드, 다운타임이 허용되는 단순 시스템, 비용을 정당화할 규모가 안 되는 서비스에는 셀이 오버헤드만 남깁니다. 공유 DB를 남겨두면 격리 이득은 애초에 사라집니다.

## 7. 라우팅·관측·부하 시험을 셀에 맞추기

라우터는 셀보다 단순해야 합니다. Guy Coleman은 "셀 위의 라우터가 시스템에서 가장 중요한 부분일 수 있다 — 그게 없으면 아무것도 작동하지 않는다"고 씁니다 `✓`. 매핑을 바꾸는 컨트롤 플레인과 매핑을 조회하는 데이터 플레인을 분리해, 컨트롤 플레인이 죽어도 데이터 플레인은 마지막 매핑으로 계속 돌아가게 해야 합니다. AWS 백서는 cross-cell 호출도 셀끼리 직접 하지 말고 라우터를 다시 타라고 규정합니다.

관측 스택 역시 셀을 구분해야 합니다. AWS는 관측 스택 전체가 셀을 인지하고 모든 요청이 어느 셀로 향하는지 추적해야 한다고 명시합니다 `✓`. Slack Egress는 Site·AZ ID·Cell ID 3단 디멘션으로 드릴다운합니다 `Ⓥ`. 셀 100개 중 1개가 완전히 죽어도 전역 에러율은 1%에 그쳐 알람이 울리지 않습니다. 알람을 셀 단위로 걸어야 하는 이유입니다.

셀 크기를 제한하는 이유 중 하나는 테스트 가능성입니다. 셀 하나가 감당할 수 있는 최대 부하까지 스트레스를 걸고 그 한계를 직접 넘겨봐야 실제 한계를 압니다. 앞서 본 Slack의 드레인 훈련처럼, 설계한 경계가 장애 상황에서도 작동하는지 반복해서 확인해야 합니다. 훈련하지 않는 셀 경계는 작동을 보장하지 못합니다.

비용에는 서로 반대인 효과가 작용합니다. 셀마다 로드밸런서·컨트롤 플레인·최소 인스턴스의 고정비가 N배로 늘지만, 셀을 AZ에 정렬하면 cross-AZ 전송비를 없앨 수 있습니다. Slack은 2024년 공개한 Egress 플랫폼에서 셀 486개를 15개 리전에 걸쳐 운영하며 cross-AZ 전송 비용을 90%, 총비용을 75% 줄였다고 밝혔습니다 `Ⓥ`. 마이크로서비스 간 통신이 잦을수록 전송비 절감 효과가 커집니다.

## 8. EKS에서 셀 하나를 만든다면

AWS가 공개한 EKS 셀 가이던스는 AZ마다 독립된 EKS 클러스터 셋을 두고, Route 53 가중 라우팅(33/33/34)과 헬스체크 기반 자동 페일오버로 트래픽을 나눕니다 `✓`. 이 가이던스의 코어에는 Istio도 ArgoCD도 들어 있지 않습니다. 서비스 메시와 GitOps는 따로 얹어야 합니다. 아래 도식은 트래픽 분배와 클러스터 경계를 함께 보여줍니다.

{{< flow src="_flow/6-eks-셀.json" />}}

도식의 클러스터 경계를 셀 경계로 잡고, 셀 ID를 클러스터 이름·태그·모든 메트릭 레이블에 넣습니다. 네임스페이스로 셀을 나누면 API 서버와 etcd, 노드풀이 공유돼 AWS 정의에 미달합니다.

Karpenter는 셀 안에서만 노드를 띄우도록 NodePool을 해당 AZ로 제한합니다. 셀이 자기 AZ 밖으로 노드를 확장하며 격리를 깨는 일을 막기 위해서입니다. Istio는 셀 내부 메시로만 두고 셀 간에는 메시를 잇지 않습니다. 멀티클러스터 메시로 셀을 연결하는 순간 셀은 더 이상 격리 단위가 아닙니다. cross-cell이 필요하면 라우터를 다시 태우는 것이 원칙입니다.

카나리와 웨이브는 서로 다른 층에서 작동합니다. [Argo Rollouts]({{< relref "/platform/rollouts/_index.md" >}})는 셀 내부 카나리를 담당합니다. ArgoCD ApplicationSet의 클러스터 제너레이터는 셀 목록을 순회하며 같은 매니페스트를 각 셀에 배포해 셀 간 웨이브를 담당합니다. 웨이브 순서를 합성 트래픽만 받는 카나리 셀 → 셀 1개 → 셀 몇 개 → 전체로 두면 04편에서 다룬 wave deployment 규율과 맞물립니다.

AWS 데모 기준 3셀 구성의 월 비용은 785~1,037달러이며, EKS 클러스터 3개만으로 219달러입니다 `✓`. 실제 워크로드에서는 셀당 고정비를 셀 수만큼 곱해 자원 계획에 반영해야 합니다. 멀티클러스터를 셀 목록에서 생성하는 도구도 늘고 있습니다. Karmada는 2026년 9월 CNCF 졸업 프로젝트가 됐습니다 `✓`.

이 구성 아래에서 AWS 서비스가 제공하는 격리 범위도 확인해야 합니다. AWS가 리전·AZ·컨트롤/데이터 플레인·셀을 자사 서비스 안에서 어떻게 겹쳐 쓰는지는 [06 AWS의 격리 설계]({{< relref "/engineering/architecture/06-aws-isolation/index.md" >}})에서 이어집니다.

## 참고 자료

- [Slack's Migration to a Cellular Architecture](https://slack.engineering/slacks-migration-to-a-cellular-architecture/) — Cooper Bethea, Slack Engineering, 2023-08-22 `✓`
- [How We're Making Roblox's Infrastructure More Efficient and Resilient](https://about.roblox.com/newsroom/2023/12/making-robloxs-infrastructure-efficient-resilient) — Sturman·Ross·Wolf, Roblox, 2023-12-07 `✓`
- [GitLab Cells Development Guidelines](https://docs.gitlab.com/development/cells/) — GitLab, 상시 갱신 `✓`
- [A Pods Architecture To Allow Shopify To Scale](https://shopify.engineering/a-pods-architecture-to-allow-shopify-to-scale) — Xavier Denis, Shopify Engineering, 2018-03-02 `✓`
- [Architectural Principles for High Availability on Hyperforce](https://engineering.salesforce.com/architectural-principles-for-high-availability-on-hyperforce/) — Bohan Chen, Salesforce Engineering, 2022-08-10 `✓`
- [2023-03-08 Incident: Infrastructure connectivity issue affecting multiple regions](https://www.datadoghq.com/blog/2023-03-08-multiregion-infrastructure-connectivity-issue/) — Datadog, 2023 `Ⓥ`
- [Failure is inevitable: Learning from a large outage](https://www.datadoghq.com/blog/engineering/rethinking-reliability/) — Datadog Engineering `Ⓥ`
- [Uber's Failover Architecture](https://arxiv.org/html/2603.07345) — Bansal·Chabbi 외, arXiv:2603.07345, 2026-03-07 `✓`
- [Project Nimble: Region Evacuation Reimagined](https://netflixtechblog.com/project-nimble-region-evacuation-reimagined-d0d0568254d4) — Netflix TechBlog `✓`
- [Cell-Based Architecture Adoption Guidelines](https://www.infoq.com/articles/cell-based-architecture-adoption-guidelines/) — Guy Coleman, InfoQ, 2024-11-04 `✓`
- [Guidance for a Cell-Based Architecture for Amazon EKS](https://aws-solutions-library-samples.github.io/compute/cell-based-architecture-for-amazon-eks.html) — AWS Solutions Library `✓`
- [DoorDash's Service Mesh Journey](https://www.infoq.com/news/2024/01/doordash-service-mesh) — Eran Stiller, InfoQ, 2024-01 `?`
- [Moving to Cell-Based Architecture: Lessons from Neon](https://omnistrate.com/blog/moving-to-cell-based-architecture-lessons-from-neon) — Pablo Berton, Omnistrate, 2025-08-15 `Ⓥ` (3자 해설)
