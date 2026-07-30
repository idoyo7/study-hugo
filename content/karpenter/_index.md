---
title: "Karpenter"
weight: 10
cascade:
  type: docs
aliases: ["/k8s-features/karpenter/"]
---

# Karpenter — 버전이 바꾼 것, 그리고 노드를 고르는 알고리즘

{{< callout type="info" >}}
**한눈에 — 두 축**

*버전 축 (01~03)*
- v1beta1→v1을 "필드 이름이 바뀐 일"로 읽으면 사고가 난다. 위험한 건 **매니페스트가 그대로 통과하는데 클러스터가 다르게 행동하는** 변경이다 — drift는 feature gate가 삭제돼 끌 수 없게 됐고([core#1311](https://github.com/kubernetes-sigs/karpenter/pull/1311)), expiration은 대체 노드 없이 드레인을 시작하는 forceful로 되돌아갔다([core#1333](https://github.com/kubernetes-sigs/karpenter/pull/1333)).
- **"No breaking changes 🎉"는 "아무 일도 안 일어난다"가 아니다.** 1.12는 업그레이드 가이드상 breaking이 아니지만 CA bundle 해시 변경으로 **기존 노드 전체가 drift 대상**이 된다.
- **메트릭 이름·라벨 변경은 CI가 못 잡는 사고다.** 1.2의 reason 라벨 snake_case 전환 이후 `reason="Drifted"` 쿼리는 에러 없이 결과가 빈다. 1.7의 리네임 2건도 같은 성질이다.
- **1.6의 native ODCR 기본 활성화가 이 구간 가장 비싼 회귀다.** `open` eligibility 예약을 `capacityReservationSelectorTerms`에 등재하지 않고 올리면 **예약을 안 쓰면서 요금은 계속 나간다.**

*알고리즘 축 (04~07)*
- **"싸서 고른다"의 주어는 Karpenter가 아니다.** 코어 스케줄러는 인스턴스 타입을 확정하지 않고 후보 집합을 통째로 NodeClaim에 실어 보낸다. 가격으로 하나를 뽑는 주체는 **EC2 CreateFleet**이다.
- **단일 NodePool 안에는 세대 선호를 표현할 축이 아예 없다.** `requirements`는 집합 연산일 뿐 서열이 아니고 `weight`는 NodePool **레벨**에만 있다. 업스트림도 이 요구를 두 번 반려했다(karpenter#1829, provider-aws#6721).
- **consolidation은 weight를 아예 모른다.** 교체 조건은 `launchPrice < candidatePrice` 부등식 하나라, **한 번 7세대로 내려가면 consolidation으로는 절대 안 돌아온다** — 복귀 경로는 `expireAfter`와 drift뿐이다.
- **없는 기능을 만들기 전에 있는 기능을 확인한다.** ICE 폴백은 이미 공짜로 동작한다(오퍼링 unavailable 마킹, TTL 3분). 실제로 만들어야 하는 건 폴백이 아니라 반대 방향의 **상향 강제**다.
{{< /callout >}}

> **왜 한 챕터인가.** 두 축은 성질이 같다 — **판단 근거가 공식 문서에 없다.** 버전 축의 근거는 릴리스노트의 Behavior Changes 절과 PR diff에 있고, 알고리즘 축의 근거는 정렬·절단·부등식 몇 줄의 소스 코드에 있다. 어느 쪽도 "Karpenter는 적당한 노드를 알아서 띄운다"는 소개 문장에서는 나오지 않는다. 이 챕터는 그 두 층을 각각 함수·PR 단위로 내려가 뜯고, **그 위에서 "그래서 무엇을 선언하고 무엇을 켤 것인가"까지** 결정한다.

> 자매 문서: [EKS 업그레이드 / karpenter]({{< relref "../eks-upgrade/components/01-karpenter.md" >}}) — 그쪽이 "우리 finance 클러스터를 0.36.2에서 1.14.0으로 **어떻게 올렸나**"(차트·values·IAM·ArgoCD 절차)라면, 이 챕터는 "올리고 나서 **무엇을 얻고, 무엇을 조심하고, 무엇을 어떻게 고르게 만드나**"다. · [K8s 버전별 신기능]({{< relref "../k8s-features/_index.md" >}})

## 버전 타임라인

| 버전 | 릴리스 | 대표 변경 |
|---|---|---|
| **0.36 / 0.37** | 2024-03 / 2024-06 | v1beta1 마지막 구간. drift 롤백 제약, EC2NodeClass readiness 조건 신설 |
| **1.0** | 2024-08 | **v1 API.** drift Stable(게이트 삭제) · expiration forceful 회귀 · `consolidateAfter` 필수 · `terminationGracePeriod` 신설 |
| **1.1** | 2024-11 | **v1beta1 서빙 종료.** `nodeClassRef.group`/`kind` 필수, Bottlerocket `instanceStorePolicy: RAID0` |
| **1.2 / 1.3** | 2025-01 / 2025-03 | 메트릭 reason 라벨 snake_case · nodeclass 컨트롤러 통합 / `capacity-type: reserved`(ODCR alpha) |
| **1.4 / 1.5** | 2025-04 / 2025-05 | `NodeRegistrationHealthy` 조건 · NodeOverlay·Node Repair 계열 정비 |
| **1.6** | 2025-07 | **native ODCR beta 기본 활성화**(open eligibility 사용자에게 회귀) · `MinValuesPolicy` |
| **1.7** | 2025-09 | **`instance-capability-flex` 라벨** · NodeOverlay AWS 지원 · 메트릭 리네임 2건 · `iam:ListInstanceProfiles` |
| **1.8** | 2025-10 | **Static NodePool**(`spec.replicas`). 단 **1.8.4는 건너뛴다**(topology spread 회귀) |
| **1.9 ~ 1.11** | 2026-02 ~ 2026-04 | `Gte`/`Lte` 연산자 · IAM 정책 5분할 · capacity reservation 인터럽션 · placement group |
| **1.12** | 2026-04 | **CA bundle drift** — 업그레이드 자체가 전 노드를 drift로 만든다 · ARC Zonal Shift · 인스턴스 상태 헬스체크 |
| **1.13 / 1.14** | 2026-06 / 2026-07 | **Capacity Buffers**(신규 CRD) · **Balanced consolidation** · DRA · preview 인스턴스 타입 |

## 문서 지도

**버전 축** — 0.36 이후 무엇이 바뀌었고 무엇을 조치해야 하나

| 문서 | 대상 버전 | 한 줄 요약 |
|------|---------|-----------|
| [01 v1 전환과 그 직후]({{< relref "01-changelog-v1-transition.md" >}}) | 0.36 → 1.6 | v1이 바꾼 것은 API가 아니라 **동작**이다 — 옵트아웃 없는 변경 둘, 필수가 된 필드 하나, 그리고 가장 비싼 회귀(ODCR) |
| [02 지금 켤 만한 것과 미룰 것]({{< relref "02-changelog-maturity.md" >}}) | 1.7 → 1.14 | breaking은 거의 없는 대신 **켜야 쓸 수 있는 기능**이 쌓였다 — flex 배제, Static NodePool, Capacity Buffers, Balanced consolidation |
| [03 키워드 레퍼런스]({{< relref "03-keyword-reference.md" >}}) | 1.14 기준 | Karpenter에는 `affinity:` 필드가 없다 — **NodePool requirements ∩ 파드 요구 ∩ 클라우드 offering** 의 집합 연산으로 스케줄링을 통제한다 |

**알고리즘 축** — 노드를 누가 어떤 기준으로 고르나

| 문서 | 전제 | 한 줄 요약 |
|------|------|-----------|
| [04 인스턴스는 누가 고르는가]({{< relref "04-instance-selection.md" >}}) | 없음 — 진입점 | 스케줄러 → NodeClaim → Truncate → EC2 Fleet 경로를 함수 단위로 따라간다. 최종 선택자는 EC2고, "절단이 8세대를 잘라낸다"는 흔한 오해는 사실이 아니다 |
| [05 세대 선호 만들기]({{< relref "05-generation-preference.md" >}}) | 04 | NodePool 분리 + `spec.weight`(GA) vs NodeOverlay `priceAdjustment`(알파)를 코드 경로로 비교하고, **복붙해서 쓸 매니페스트 전문**을 낸다 |
| [06 consolidation이 되돌리는 것]({{< relref "06-consolidation-traps.md" >}}) | 05 | 세워 놓은 구성이 며칠~몇 주에 걸쳐 조용히 무너지는 경로 — 가격 부등식 하나, weight 미인지, 복귀 부재, `expireAfter`의 함정, drift |
| [07 용량이 없을 때]({{< relref "07-ice-fallback.md" >}}) | 04 | ICE 캐시의 3분과 세 축, 폴백 실측 지연, spot을 섞는 순간 논의가 바뀌는 이유, 알파 없이 8세대를 1순위로 만드는 ODCR. 그리고 **폴백이 흡수하지 않는 유일한 실패** — 런치는 됐는데 등록이 안 되는 경우(`NodeRegistrationHealthy`) |

**운영 축** — 돌아가는 클러스터를 무엇으로 통제하나

| 문서 | 전제 | 한 줄 요약 |
|------|------|-----------|
| [08 언제 무엇을 멈출 것인가]({{< relref "08-disruption-budgets.md" >}}) | 06 | v1에서 남은 통제 수단은 `disruption.budgets` 하나다. **`reasons`를 생략한 예산은 빈 노드 정리까지 멈춘다** |

## 읽는 순서

- **업그레이드를 앞두고 있으면** 01 → 02가 최단 경로다. 각 문서 말미의 "버전별 운영 판단 표"가 조치 목록이고, 실제 적용 절차는 [eks-upgrade / karpenter]({{< relref "../eks-upgrade/components/01-karpenter.md" >}})가 소유한다.
- **파드가 Pending인데 노드가 안 뜨면** 03으로 간다. 원인은 거의 항상 NodePool requirements와 파드 요구의 교집합이 빈 것이다.
- **원하는 인스턴스가 안 뜨면** 04 → 05다. 당장 매니페스트만 필요하면 05로 바로 가도 되지만, 그게 왜 NodePool 두 개인지는 04에서만 설명된다.
- **세워 둔 구성이 시간이 지나며 무너지면** 06이 실무 직결이다. 01의 disruption 동작 변경과 함께 읽으면 "왜 지금 무너졌나"의 답이 나온다.
- **노드가 안 줄어들거나, 반대로 너무 자주 교체되면** 08이다. 원인의 대부분은 예산이고, 예산은 유일하게 이벤트로 증거를 남긴다.

## 공통 핵심

- **옵트아웃이 사라진 변경이 가장 위험하다.** v1에서 drift feature gate는 삭제됐고 expiration은 forceful로 되돌아갔다. 남은 통제 수단은 disruption budget 하나뿐이므로, 업그레이드 전에 예산을 먼저 심는 순서가 강제된다. → [01]({{< relref "01-changelog-v1-transition.md" >}})
- **기능이 있다는 것과 켜져 있다는 것은 다르다.** NodeOverlay·Capacity Buffers·Static NodePool·spot-to-spot consolidation은 각자 feature gate 또는 별도 CRD 뒤에 있다. "1.14로 올렸으니 다 쓸 수 있다"가 아니다. → [02]({{< relref "02-changelog-maturity.md" >}})
- **파드 쪽 affinity만 보면 원인을 못 찾는다.** NodePool이 어떤 축에 requirement를 걸지 않으면 그 축은 클라우드가 파는 모든 값이 허용되고, 반대로 교집합이 비면 노드는 아예 만들어지지 않으면서 파드는 Pending으로 백오프 재시도만 반복한다 — 오설정과 용량 부족이 같은 겉모습을 갖는다. → [03]({{< relref "03-keyword-reference.md" >}})
- **선호는 NodePool 경계로만 표현된다.** `requirements`는 집합 연산일 뿐 서열이 아니고, 파드의 `preferred` nodeAffinity도 대안이 아니다. 서열이 필요하면 경계를 나눠야 한다. → [05]({{< relref "05-generation-preference.md" >}})
- **컨트롤러는 계속 다시 계산한다.** "적용한 순간 의도대로 동작함"은 정상 상태의 증거가 아니다. consolidation·drift·expiration이 각각 다른 기준으로 노드를 갈아치우고, 그중 어느 것도 weight를 모른다. → [06]({{< relref "06-consolidation-traps.md" >}})
- **알파 기능의 비용은 기능 자체가 아니라 확정 불가한 구멍이다.** NodeOverlay는 코어 쪽 배선이 깔끔하지만 마지막 한 홉(EC2 Fleet `prioritized`)의 계약이 코드로도 문서로도 확정되지 않는다. 이런 구멍은 도입 전 실측 말고는 메울 방법이 없다. → [05]({{< relref "05-generation-preference.md" >}})
- **버전을 안 밝힌 Karpenter 문장은 믿지 마라.** 코어(kubernetes-sigs/karpenter)와 provider(aws/karpenter-provider-aws)가 따로 태깅되고, provider 릴리스가 코어를 핀한다. 같은 "v1.11.3"이라도 안에 든 코어는 다르다.

## 검증 기준

이 챕터의 모든 코드·릴리스노트 인용은 로컬 체크아웃을 직접 읽어 확인했다.

| 저장소 | 기준 | 쓰임 |
|---|---|---|
| kubernetes-sigs/karpenter (코어) | **v1.14.0-6-gac7a021e** · main(2026-07-30) | 스케줄링·disruption·NodeOverlay 배선, 라인번호 인용 기준 |
| aws/karpenter-provider-aws | **main**(2026-07-30) · **v1.7.0** · **v1.11.3** | CreateFleet 호출부·ICE 캐시·오퍼링 가격·인스턴스 타입 라벨. v1.7.0은 NodeOverlay 지원이 처음 들어간 태그 |
| 릴리스노트 | provider v0.36.0~v1.14.0 · 코어 v1.0.0~v1.14.0 | 버전 축의 도입 시점·PR 번호 판정 |

{{< callout type="warning" >}}
**라인번호는 배포 버전과 어긋날 수 있다.** provider-aws **v1.11.3이 핀하는 코어는 v1.11.2**인데, 알고리즘 축의 코어 라인번호는 v1.14 기준이다. 함수명·조건식·상수값은 그대로 유효하지만 `파일:라인` 형태의 인용을 그대로 열면 몇 줄 어긋난 곳에 도착할 수 있다. 자기 클러스터에서 확인할 때는 라인이 아니라 **함수명·식별자로 검색**하라.

각 문서 말미에는 **확인하지 못한 항목**을 별도로 모아 뒀다. 특히 EC2 Fleet `prioritized` 전략의 소수 `Priority` 해석은 04·05·07 세 문서에 걸쳐 반복 등장하는데, AWS API 레퍼런스가 `Priority`를 "whole numbers starting at 0"으로 규정하는 반면 Karpenter는 소수 달러값을 넣는다. 정수 절단이 일어나면 시간당 $1 미만 인스턴스가 전부 priority 0이 되어 세대 선호가 조용히 무력화된다 — **NodeOverlay를 도입한다면 실측 검증이 필수다.**
{{< /callout >}}
