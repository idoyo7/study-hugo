---
title: "Karpenter"
weight: 10
cascade:
  type: docs
---

# Karpenter — 0.36 이후 무엇이 생겼고, 그걸로 무엇을 하나

> Karpenter는 2024-08의 v1.0 이후 2026-07까지 마이너를 14개 냈다. 릴리스노트는 대부분 "무엇이 머지됐다"의 목록이고, **업그레이드 가이드의 "No breaking changes 🎉"는 "아무 일도 안 일어난다"는 뜻이 아니다.** 이 챕터는 0.36 이후 변경 중 운영에 실제로 영향을 주는 것을 골라, 릴리스노트·업스트림 문서에서 멈추지 않고 **구현 코드·설계 RFC·실제 함정**까지 내려가 "지금 무엇을 켜고, 무엇을 미루고, 업그레이드 전에 무엇을 고쳐야 하는가"를 판단할 수 있는 수준으로 정리한다.

> 자매 문서: [EKS 업그레이드 / karpenter]({{< relref "../eks-upgrade/components/01-karpenter.md" >}}) — 그쪽이 "우리 finance 클러스터를 0.36.2에서 1.14.0으로 **어떻게 올리나**"(차트·values·IAM·ArgoCD 절차)라면, 이 챕터는 "올라간 뒤 **무엇을 얻고 무엇을 조심하나**"다.

## 왜 이걸 정리하는가

Karpenter 업그레이드에서 사고가 나는 지점은 `kubectl apply`가 실패하는 곳이 아니다. 스키마 오류는 CI가 잡아준다. 위험한 것은 **매니페스트가 그대로 통과하는데 클러스터가 다르게 행동하는** 변경이다 — 끄고 있던 drift가 강제로 켜지고, 만료된 노드가 대체 노드 없이 드레인을 시작하고, 메트릭 라벨이 바뀌어 알람이 에러 없이 조용해지고, ODCR 예약을 안 쓰면서 요금은 계속 나간다. 이 넷은 전부 실제 릴리스에 있었고, 셋은 업그레이드 가이드에서 한 줄로만 언급된다.

그래서 이 챕터의 문서들은 버전별로 세 가지를 묻는 형식으로 쓴다 — **무엇이 바뀌었나, 우리 클러스터에서 무슨 일이 나나, 업그레이드 전에 무엇을 해야 하나.** 그리고 여기에 신기능 하나를 도입할지 판단하려면 필요한 것 — **비용(설정 난이도·리스크) 대비 효과, 그리고 지금인가 나중인가.**

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

| 문서 | 대상 버전 | 한 줄 요약 |
|------|---------|-----------|
| [01 v1 전환과 그 직후]({{< relref "01-changelog-v1-transition.md" >}}) | 0.36 → 1.6 | v1이 바꾼 것은 API가 아니라 **동작**이다 — 옵트아웃 없는 변경 둘, 필수가 된 필드 하나, 그리고 가장 비싼 회귀(ODCR) |
| [02 지금 켤 만한 것과 미룰 것]({{< relref "02-changelog-maturity.md" >}}) | 1.7 → 1.14 | breaking은 거의 없는 대신 **켜야 쓸 수 있는 기능**이 쌓였다 — flex 배제, Static NodePool, Capacity Buffers, Balanced consolidation |
| [03 키워드 레퍼런스]({{< relref "03-keyword-reference.md" >}}) | 1.14 기준 | Karpenter에는 `affinity:` 필드가 없다 — **NodePool requirements ∩ 파드 요구 ∩ 클라우드 offering** 의 집합 연산으로 스케줄링을 통제한다 |

## 공통 핵심

- **"No breaking changes"를 신뢰하지 않는다.** 1.12는 업그레이드 가이드상 breaking이 아니지만 CA bundle 해시 변경으로 **기존 노드 전체가 drift 대상**이 된다. 릴리스노트의 Behavior Changes 절과 hash 관련 PR을 따로 봐야 한다. → [01]({{< relref "01-changelog-v1-transition.md" >}}) · [02]({{< relref "02-changelog-maturity.md" >}})
- **옵트아웃이 사라진 변경이 가장 위험하다.** v1에서 drift feature gate는 삭제됐고 expiration은 forceful로 되돌아갔다. 남은 통제 수단은 disruption budget 하나뿐이므로, 업그레이드 전에 예산을 먼저 심는 순서가 강제된다. → [01]({{< relref "01-changelog-v1-transition.md" >}})
- **메트릭 이름·라벨 변경은 CI가 못 잡는 사고다.** `reason="Drifted"` 쿼리는 1.2 이후 에러 없이 결과가 빈다. 1.7의 리네임 2건도 같은 성질이다 — 경보가 오지 않는 방식으로 깨진다. → [01 §4]({{< relref "01-changelog-v1-transition.md" >}}) · [02 §3]({{< relref "02-changelog-maturity.md" >}})
- **라벨 하나로 즉시 이득을 보는 변경도 있다.** 1.7의 `karpenter.k8s.aws/instance-capability-flex`는 NodePool requirement 한 줄로 `-flex` 계열 인스턴스를 전량 배제한다. 단 `DoesNotExist`를 쓰면 **인스턴스 타입 전체가 배제**되므로 연산자 선택이 중요하다. → [02 §2]({{< relref "02-changelog-maturity.md" >}})
- **파드 쪽 affinity만 보면 원인을 못 찾는다.** NodePool이 어떤 축에 requirement를 걸지 않으면 그 축은 클라우드가 파는 모든 값이 허용되고, 반대로 교집합이 비면 노드는 아예 만들어지지 않으면서 파드는 Pending으로 백오프 재시도만 반복한다 — 오설정과 용량 부족이 같은 겉모습을 갖는다. → [03]({{< relref "03-keyword-reference.md" >}})
- **기능이 있다는 것과 켜져 있다는 것은 다르다.** NodeOverlay·Capacity Buffers·Static NodePool·spot-to-spot consolidation은 각자 feature gate 또는 별도 CRD 뒤에 있다. "1.14로 올렸으니 다 쓸 수 있다"가 아니다. → [02]({{< relref "02-changelog-maturity.md" >}})
