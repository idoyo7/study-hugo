---
title: "Karpenter"
description: "0.36부터 1.14까지 버전별 행동 변화와, 인스턴스 가격을 실제로 정하는 주체가 EC2 CreateFleet이라는 알고리즘 두 축을 함수·PR 단위로 뜯어 무엇을 켜고 조심할지 판단합니다."
date: 2026-07-30
lastmod: 2026-08-24
weight: 110
cascade:
  type: docs
aliases: ["/k8s-features/karpenter/"]
comments: false
---

# Karpenter — 버전이 바꾼 것, 그리고 노드를 고르는 알고리즘

{{< callout type="info" >}}
*버전 축 (01~03)*
- v1beta1→v1을 "필드 이름이 바뀐 일"로 읽으면 사고가 납니다. 위험한 쪽은 매니페스트가 그대로 통과하는데 클러스터가 다르게 행동하는 변경입니다 — drift는 feature gate가 삭제돼 끌 수 없게 됐고([core#1311](https://github.com/kubernetes-sigs/karpenter/pull/1311)), expiration은 대체 노드 없이 드레인을 시작하는 forceful로 되돌아갔습니다([core#1333](https://github.com/kubernetes-sigs/karpenter/pull/1333)).
- "No breaking changes 🎉"가 "아무 일도 안 일어난다"는 뜻은 아닙니다. 1.12는 업그레이드 가이드상 breaking이 아니지만 CA bundle 해시가 바뀌면서 기존 노드 전체가 drift 대상이 됩니다.
- 메트릭 이름·라벨 변경은 CI가 못 잡는 사고입니다. 1.2에서 reason 라벨이 snake_case로 바뀐 뒤 `reason="Drifted"` 쿼리는 에러 없이 결과가 빕니다. 1.7의 리네임 2건도 마찬가지입니다.
- 1.6의 native On-Demand Capacity Reservation(ODCR) 기본 활성화가 이 구간에서 가장 비싼 회귀입니다. `open` eligibility 예약을 `capacityReservationSelectorTerms`에 등재하지 않고 올리면 예약은 안 쓰면서 요금은 계속 나갑니다.

*알고리즘 축 (04~07)*
- "싸서 고른다"의 주어는 Karpenter가 아닙니다. 코어 스케줄러는 인스턴스 타입을 확정하지 않고 후보 집합을 통째로 NodeClaim에 실어 보냅니다. 가격으로 하나를 뽑는 주체는 EC2 CreateFleet입니다.
- 단일 NodePool 안에는 세대 선호를 표현할 축이 아예 없습니다. `requirements`는 집합 연산이라 서열을 매기지 못하고 `weight`는 NodePool 레벨에만 있습니다. 업스트림도 이 요구를 두 번 반려했습니다(karpenter#1829, provider-aws#6721).
- consolidation은 weight를 아예 모릅니다. 교체 조건이 `launchPrice < candidatePrice` 부등식 하나뿐이라 한 번 7세대로 내려가면 consolidation으로는 절대 안 돌아옵니다. 복귀 경로는 `expireAfter`와 drift뿐입니다.
- 없는 기능을 만들기 전에 있는 기능을 확인합니다. Insufficient Capacity Error(ICE) 폴백은 이미 공짜로 동작합니다(오퍼링 unavailable 마킹, TTL 3분). 실제로 만들어야 하는 건 반대 방향의 상향 강제입니다.
{{< /callout >}}

왜 한 챕터인가. 두 축은 성질이 같습니다 — 판단 근거가 공식 문서에 없습니다. 버전 축의 근거는 릴리스노트의 Behavior Changes 절과 PR diff에, 알고리즘 축의 근거는 정렬·절단·부등식 몇 줄의 소스 코드에 있습니다. 어느 쪽도 "Karpenter는 적당한 노드를 알아서 띄운다"는 소개 문장에서는 나오지 않습니다. 이 챕터는 그 두 층을 각각 함수·PR 단위로 내려가 뜯고 그 위에서 "그래서 무엇을 선언하고 무엇을 켤 것인가"까지 결정합니다.

자매 문서: [EKS 업그레이드 / karpenter]({{< relref "../eks-upgrade/components/01-karpenter.md" >}}) — 그쪽이 "우리 finance 클러스터를 0.36.2에서 1.14.0으로 **어떻게 올렸나**"(차트·values·IAM·ArgoCD 절차)라면 이 챕터는 "올리고 나서 **무엇을 얻고, 무엇을 조심하고, 무엇을 어떻게 고르게 만드나**"입니다. · [K8s 버전별 신기능]({{< relref "../k8s-features/_index.md" >}})

## 버전 타임라인

릴리스는 0.36 2024-03부터 1.14 2026-07까지입니다. 그 구간을 "무엇이 머지됐나"로 읽으면 목록이 되고 "어떤 상황에서 켤 것을 주는가"로 읽으면 계획이 됩니다. 아래는 후자입니다.

| 버전 | 언제 쓰나 (조건) | 무엇이 가능해졌나 | 대가 |
|---|---|---|---|
| **0.36~0.37** | 선택 아님 | EC2NodeClass readiness | CRD 선행 없으면 중단 |
| **1.0** | **v1 진입 — 선택 아님** | `terminationGracePeriod` · reason별 budget | **drift를 못 끈다** · 만료 forceful |
| **1.1** | 선택 아님 | Node Repair(alpha) | v1beta1 서빙 종료 |
| **1.2~1.3** | ODCR을 쓰고 싶다 | `capacity-type: reserved` | reason 라벨 snake_case |
| **1.4~1.5** | 등록 실패를 감지하고 싶다 | `NodeRegistrationHealthy` | 없음 |
| **1.6** | **선택 아님 — 기본 ON** | Capacity Blocks · `MinValuesPolicy` | **ODCR 미등재면 요금만 나간다** |
| **1.7** | flex가 섞이는 게 싫다 | 라벨 한 줄로 배제 | 메트릭 2건 리네임 |
| **1.8** | 기준 용량을 상시 유지한다 | Static NodePool | alpha · 전환 불가 · 1.8.4 스킵 |
| **1.9~1.11** | HPC·랙 격리가 필요하다 | Placement Group | IAM 두 번 추가 |
| **1.12** | **선택 아님 — 지나간다** | ARC Zonal Shift | **전 노드 일괄 drift** |
| **1.13~1.14** | churn이 과해 불만이다 | `Balanced` 한 줄 | Capacity Buffers는 alpha |

"선택 아님"이 네 줄입니다. 그 넷은 켤지 말지 고르는 항목이 아닙니다. 지나갈 때 무엇을 미리 막아둘지를 고르는 항목입니다. 그중 1.6과 1.12는 대가가 각각 요금과 전 노드 교체입니다.

## 문서 지도

**버전 축** — 0.36 이후 무엇이 바뀌었고 무엇을 조치해야 하나

- [01 v1 전환과 그 직후]({{< relref "01-changelog-v1-transition.md" >}}) · 0.36 → 1.6 — v1이 바꾼 것은 API가 아니라 동작입니다. 옵트아웃 없는 변경 둘, 필수가 된 필드 하나, 가장 비싼 회귀(ODCR).
- [02 지금 켤 만한 것과 미룰 것]({{< relref "02-changelog-maturity.md" >}}) · 1.7 → 1.14 — breaking은 거의 없는 대신 켜야 쓸 수 있는 기능이 쌓였습니다. flex 배제, Static NodePool, Capacity Buffers, Balanced consolidation.
- [03 키워드 레퍼런스]({{< relref "03-keyword-reference.md" >}}) · 1.14 기준 — Karpenter에는 `affinity:` 필드가 없습니다. NodePool requirements ∩ 파드 요구 ∩ 클라우드 offering의 집합 연산으로 스케줄링을 통제합니다.

**알고리즘 축** — 노드를 누가 어떤 기준으로 고르나

- [04 인스턴스는 누가 고르는가]({{< relref "04-instance-selection.md" >}}) · 진입점 — 스케줄러 → NodeClaim → Truncate → EC2 Fleet 경로를 함수 단위로 따라갑니다. 최종 선택자는 EC2입니다. "절단이 8세대를 잘라낸다"는 설명은 흔하지만 틀렸습니다.
- [05 세대 선호 만들기]({{< relref "05-generation-preference.md" >}}) · 04 — NodePool 분리 + `spec.weight`(GA) vs NodeOverlay `priceAdjustment`(알파)를 코드 경로로 비교하고 복붙해서 쓸 매니페스트 전문을 냅니다.
- [13 consolidation은 무엇을 하는가]({{< relref "13-consolidation-models.md" >}}) · 04 — 세 Method(Emptiness·MultiNode·SingleNode)와 비용 모델. 대체 노드는 액션당 최대 1대이고 `Emptiness`는 `consolidationPolicy`를 읽지 않아 `Balanced`에서도 빈 노드는 스코어링을 우회합니다. "세 정책은 같은 모델의 서로 다른 k"라는 흔한 설명이 왜 코드상 틀렸는지도 다룹니다.
- [06 consolidation이 되돌리는 것]({{< relref "06-consolidation-traps.md" >}}) · 05·13 — 세워 놓은 구성이 며칠~몇 주에 걸쳐 눈에 띄지 않게 무너지는 경로. 가격 부등식 하나, weight 미인지, 복귀 부재, `expireAfter`의 함정, drift.
- [07 용량이 없을 때]({{< relref "07-ice-fallback.md" >}}) · 04 — ICE 캐시의 3분과 세 축, 폴백 실측 지연, spot을 섞는 순간 논의가 바뀌는 이유, 알파 없이 8세대를 1순위로 만드는 ODCR. 그리고 폴백이 흡수하지 않는 유일한 실패 — 런치는 됐는데 등록이 안 되는 경우(`NodeRegistrationHealthy`).

**운영 축** — 돌아가는 클러스터를 무엇으로 통제하나

- [08 언제 무엇을 멈출 것인가]({{< relref "08-disruption-budgets.md" >}}) · 06 — v1에서 남은 통제 수단은 `disruption.budgets` 하나입니다. `reasons`를 생략한 예산은 빈 노드 정리까지 멈춥니다. 실패 대신 침묵으로 나타나는 오설정, 그리고 "노드가 안 줄어든다"의 진단 순서.
- [09 무엇을 봐야 하나]({{< relref "09-metrics-logs-events.md" >}}) · 08 — 코어가 내보내는 메트릭 60개 전량과 판정 로그·이벤트. `nodeclaims_disrupted_total{reason}` 하나가 "노드가 왜 갈렸나"에 답하고 판정 로그는 `--log-level debug`에서만 나옵니다. 이벤트 dedupe 창이 Reason마다 달라 카운트를 빈도로 읽으면 안 됩니다.
- [10 메트릭 수집 비용]({{< relref "10-metric-cost.md" >}}) · 09 — 60개를 다 저장할 이유는 없습니다. 파드 단위 6개가 시리즈의 대부분을 차지하고 배포마다 전량 churn합니다. Datadog은 OpenMetrics로 긁은 것을 전부 custom metric으로 셉니다. VM에서는 청구 대신 `indexdb` 팽창이 비용입니다.

## 읽는 순서

- 업그레이드를 앞두고 있으면 01 → 02가 최단 경로입니다. 각 문서 말미의 "버전별 운영 판단 표"가 조치 목록입니다. 실제 적용 절차는 [eks-upgrade / karpenter]({{< relref "../eks-upgrade/components/01-karpenter.md" >}})가 소유합니다.
- 파드가 Pending인데 노드가 안 뜨면 03으로 갑니다. 원인은 거의 항상 NodePool requirements와 파드 요구의 교집합이 빈 것입니다.
- 원하는 인스턴스가 안 뜨면 04 → 05입니다. 당장 매니페스트만 필요하면 05로 바로 가도 되지만 그게 왜 NodePool 두 개인지는 04에서만 설명합니다.
- 세워 둔 구성이 시간이 지나며 무너지면 06이 실무 직결입니다. 01의 disruption 동작 변경과 함께 읽으면 "왜 지금 무너졌나"의 답이 나옵니다.
- 노드가 안 줄어들거나 반대로 너무 자주 교체되면 08입니다. 원인의 대부분은 예산입니다. 예산은 유일하게 이벤트로 증거를 남깁니다.
- 대시보드를 짜거나 장애 중 로그를 켜야 하면 09가 목록입니다. 08의 진단 절차에서 쓰는 신호가 전부 거기 정리돼 있습니다.

## 공통 핵심

- 옵트아웃이 사라진 변경이 가장 위험합니다. v1에서 drift feature gate는 삭제됐고 expiration은 forceful로 되돌아갔습니다. 남은 통제 수단이 disruption budget 하나뿐이라 업그레이드 전에 예산을 먼저 심어야 합니다. → [01]({{< relref "01-changelog-v1-transition.md" >}})
- 기능이 있다는 것과 켜져 있다는 것은 다릅니다. NodeOverlay·Capacity Buffers·Static NodePool·spot-to-spot consolidation은 각자 feature gate 또는 별도 CRD 뒤에 있습니다. "1.14로 올렸으니 다 쓸 수 있다"는 성립하지 않습니다. → [02]({{< relref "02-changelog-maturity.md" >}})
- 파드 쪽 affinity만 보면 원인을 못 찾습니다. NodePool이 어떤 축에 requirement를 걸지 않으면 그 축은 클라우드가 파는 모든 값이 허용됩니다. 반대로 교집합이 비면 노드는 아예 만들어지지 않고 파드는 Pending으로 백오프 재시도만 반복합니다. 오설정과 용량 부족이 겉으로는 똑같이 보입니다. → [03]({{< relref "03-keyword-reference.md" >}})
- 선호는 NodePool 경계로만 표현됩니다. `requirements`는 집합 연산일 뿐 서열이 아니고 파드의 `preferred` nodeAffinity로도 대신할 수 없습니다. 서열이 필요하면 경계를 나눠야 합니다. → [05]({{< relref "05-generation-preference.md" >}})
- 컨트롤러는 계속 다시 계산합니다. "적용한 순간 의도대로 동작함"은 정상 상태의 증거가 아닙니다. consolidation·drift·expiration이 각각 다른 기준으로 노드를 갈아치우고 그중 어느 것도 weight를 모릅니다. → [06]({{< relref "06-consolidation-traps.md" >}})
- 알파 기능의 비용은 기능 자체보다 확정 못 하는 구멍에 있습니다. NodeOverlay는 코어 쪽 배선이 깔끔하지만 마지막 한 홉(EC2 Fleet `prioritized`)의 계약을 코드로도 문서로도 확정할 수 없습니다. 이런 구멍은 도입 전 실측 말고는 메울 방법이 없습니다. → [05]({{< relref "05-generation-preference.md" >}})
- 버전을 안 밝힌 Karpenter 문장은 믿지 마십시오. 코어(kubernetes-sigs/karpenter)와 provider(aws/karpenter-provider-aws)가 따로 태깅됩니다. provider 릴리스가 코어를 핀합니다. 같은 "v1.11.3"이라도 안에 든 코어는 다릅니다.

## 검증 기준

이 챕터의 모든 코드·릴리스노트 인용은 로컬 체크아웃을 직접 읽어 확인했습니다. 본문에 `파일:라인` 형태로 나오는 인용은 아래 체크아웃을 연 것입니다.

- kubernetes-sigs/karpenter (코어) — `v1.14.0-6-gac7a021e` · main(2026-07-30). 스케줄링·disruption·NodeOverlay 코드가 여기 있습니다. 코어 쪽 라인번호는 전부 이 체크아웃 기준입니다.
- aws/karpenter-provider-aws — main(2026-07-30) · `v1.7.0` · `v1.11.3`. CreateFleet 호출부·ICE 캐시·오퍼링 가격·인스턴스 타입 라벨. `v1.7.0`은 NodeOverlay 지원이 처음 들어간 태그입니다.
- 릴리스노트 — provider `v0.36.0`~`v1.14.0`, 코어 `v1.0.0`~`v1.14.0`. 어떤 기능이 어느 버전에 들어왔는지와 PR 번호를 여기서 판정했습니다.

{{< callout type="warning" >}}
라인번호는 배포 버전과 어긋날 수 있습니다. provider-aws v1.11.3이 핀하는 코어는 v1.11.2인데 알고리즘 축의 코어 라인번호는 v1.14 기준입니다. 함수명·조건식·상수값은 그대로 유효하지만 `파일:라인` 형태의 인용을 그대로 열면 몇 줄 어긋난 곳에 도착할 수 있습니다. 자기 클러스터에서 확인할 때는 라인 대신 함수명·식별자로 검색하십시오.

각 문서 말미에는 확인하지 못한 항목을 별도로 모아 뒀습니다. 특히 EC2 Fleet `prioritized` 전략의 소수 `Priority` 해석은 04·05·07 세 문서에 걸쳐 반복 등장합니다. AWS API 레퍼런스는 `Priority`를 "whole numbers starting at 0"으로 규정합니다. Karpenter는 거기에 소수 달러값을 넣습니다. 정수 절단이 일어나면 시간당 $1 미만 인스턴스가 전부 priority 0이 되어 세대 선호가 에러 없이 무력화됩니다 — NodeOverlay를 도입한다면 실측 검증이 필수입니다.
{{< /callout >}}
