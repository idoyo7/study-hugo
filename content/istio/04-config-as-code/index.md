---
title: "설정을 코드로: GitOps"
weight: 4
---

# 04 · 설정을 코드로 — Istio Manifest를 Git으로 동기화하기

{{< callout type="info" >}}
**한눈에**
- Istio 설정은 두 층입니다 — **설치 층**(Helm 권장, IstioOperator는 지양)과 **트래픽 층**(전부 CRD).
- 메시 CRD는 **적용 즉시 트래픽에 직결**됩니다. 손 apply가 남기는 드리프트·추적불가·재현불가가 그대로 장애 위험이 됩니다.
- GitOps(Argo CD/Flux)로 **Git을 단일 진실**로 못 박아 드리프트를 자동 복원하고 `istioctl analyze`로 적용 전에 검증합니다.
- 컨트롤 플레인 업그레이드는 **revision 기반 카나리**로 폭발 반경을 줄입니다.
{{< /callout >}}

> **그때 무슨 일이 있었나.** IstioOperator/Helm 값, Gateway, VirtualService, DestinationRule — 메시 설정 일체를 그때그때 `kubectl apply`로 손봤습니다. **클러스터의 실제 상태와 Git 저장소가 어긋나기** 시작한 지점이 거기입니다. 누가 언제 무엇을 바꿨는지 기록이 남지 않았고 재현도 롤백도 불안했습니다. "Istio Manifest Sync" 과제는 이 **드리프트를 없애고 Git을 단일 진실로** 만드는 일이었습니다. 이 문서에서는 Istio 설정 방식, GitOps로 옮기는 이유, 메시 설정 특유의 위험을 다룹니다.

> 관련 문서: [02 컨트롤 플레인]({{< relref "02-istiod-control-plane.md" >}}) · [03 게이트웨이]({{< relref "03-gateway-node-isolation.md" >}}) · [05 장애 이야기]({{< relref "05-incident-intermittent-5xx.md" >}})

## Istio는 무엇으로 설정되나 — 두 층

Istio 설정은 성격이 다른 두 층으로 갈립니다. **설치·플랫폼 설정**은 메시 자체를 어떻게 깔고 구성할지 정합니다. 런타임에 트래픽을 어떻게 다루느냐는 **트래픽·정책 설정**의 몫입니다. 이 구분이 GitOps 설계의 출발점입니다.

| 층 | 예시 | 바뀌는 빈도 |
|---|---|---|
| **설치·플랫폼 설정** | istiod 리소스, 게이트웨이 배치, 메시 전역 옵션(mTLS 기본값 등) | 드묾 (플랫폼 팀) |
| **트래픽·정책 설정** | Gateway, VirtualService, DestinationRule, AuthorizationPolicy | 잦음 (서비스 팀) |

**설치 층**을 다루는 방법은 역사적으로 셋입니다.

- **`istioctl` + IstioOperator(IOP)** — `istioctl install -f iop.yaml`. 한때 표준이었으나 **IstioOperator API/컨트롤러는 이후 사용 지양(deprecation) 방향**으로 정리됐습니다.
- **Helm chart** — `base`(CRD·클러스터 리소스) → `istiod`(컨트롤 플레인) → `gateway`(게이트웨이)를 차례로 설치합니다. **현재 권장되는 방식**이고 GitOps 도구와 궁합이 좋습니다.
- (참고) 신형 게이트웨이는 Kubernetes **Gateway API**로도 구성할 수 있습니다.

**트래픽 층**은 전부 Kubernetes CRD입니다. 평범한 YAML이라는 뜻이니 **그대로 Git으로 관리하기에 최적**입니다.

## 왜 손 apply가 위험한가

메시 CRD가 보통의 매니페스트와 결정적으로 다른 점은 하나입니다 — **적용하는 순간 살아있는 트래픽에 직결됩니다.** VirtualService의 라우팅 한 줄, DestinationRule의 서브셋 정의가 틀리면 그 즉시 요청이 엉뚱한 곳으로 가거나 503이 난다([05]({{< relref "05-incident-intermittent-5xx.md" >}})의 단골 원인). 손 apply는 여기에 넷을 더 얹습니다.

- **드리프트** — Git엔 A인데 클러스터엔 B. 다음 배포가 무엇을 덮을지 아무도 모릅니다.
- **추적 불가** — 누가 언제 왜 바꿨는지 기록이 없습니다. 장애 원인 규명이 느려집니다.
- **재현 불가** — 스테이징과 프로덕션, 또는 멀티클러스터의 설정이 미묘하게 달라집니다.
- **롤백 불안** — "직전 상태"가 정의되어 있지 않으니 되돌리기가 수동·위험합니다.

## GitOps로 옮기면 — Git이 단일 진실

핵심은 **"클러스터의 원하는 상태 = Git 저장소"** 로 못 박고 사람이 클러스터를 직접 만지지 않는 것입니다.

{{< flow src="_flow/gitops-로-옮기면-git.json" />}}

- **변경은 PR로만** — 리뷰·승인·감사 로그가 자연히 남습니다.
- **드리프트 자동 복원** — 누가 클러스터를 손으로 바꿔도 Argo CD/Flux가 Git 상태로 되돌립니다. 손 apply가 구조적으로 무력화됩니다.
- **롤백 = git revert** — 직전 상태가 커밋으로 정의되어 있어 되돌리기가 원자적입니다.
- **멀티클러스터 재현성** — 같은 소스에서 스테이징·프로덕션·리전별 클러스터를 동일하게 만듭니다. 03의 게이트웨이 노드풀 설정도 같은 방식으로 재현됩니다.

이것이 "Manifest Sync"의 목표입니다: **매니페스트(설치 층 Helm 값 + 트래픽 층 CRD)를 Git에 두고 클러스터를 항상 거기에 수렴시키는 것.**

## 메시 설정 특유의 안전장치

메시 설정은 트래픽에 직결되므로 GitOps 파이프라인에 **적용 전 검증**을 반드시 끼웁니다.

- **`istioctl analyze`** — CI에서 설정의 논리 오류·충돌·누락을 정적 분석. 예: VirtualService가 참조하는 호스트/서브셋이 실제 DestinationRule에 없는 경우를 잡습니다.
- **`istioctl validate` / 스키마 검증** — CRD 문법·필드 유효성 확인.
- **점진 반영** — 라우팅 변경은 카나리(가중치 분할)로 먼저 소수 트래픽에만 걸어 확인합니다. 트래픽 층 변경의 리스크를 데이터 플레인 수준에서 낮춥니다.

### 컨트롤 플레인 업그레이드는 카나리로

설치 층에서 가장 위험한 작업은 **Istio 버전 업그레이드**입니다. Istio는 이 작업을 위해 **revision 기반 카나리 업그레이드**를 제공합니다.

- 새 버전 istiod를 **다른 revision**(예: `istiod-1-x`)으로 나란히 설치합니다. 기존 컨트롤 플레인은 그대로 돕니다.
- 워크로드 네임스페이스의 revision 라벨(또는 `revision tag`)을 새 것으로 바꾸고 **재시작**하면, 그 워크로드만 새 컨트롤 플레인·새 프록시로 옮겨갑니다.
- 문제가 생기면 라벨을 되돌려 **즉시 롤백**. in-place 업그레이드와 달리 전체가 한 번에 바뀌지 않아 폭발 반경이 작습니다.

이 revision 전략도 GitOps와 맞물립니다 — revision 라벨과 Helm 값이 Git에 있으니 업그레이드 자체가 리뷰 가능한 PR이 됩니다.

## 이 문서에서 가져갈 것

- Istio 설정은 **설치 층(Helm 권장, IOP는 지양)** 과 **트래픽 층(전부 CRD)** 으로 나뉩니다. 둘 다 YAML이라 Git 관리에 적합합니다.
- 메시 CRD는 **적용 즉시 트래픽에 직결**되므로 손 apply의 드리프트·추적불가·재현불가가 곧 장애 위험입니다.
- GitOps(Argo CD/Flux)로 **Git을 단일 진실**로 삼아 드리프트를 자동 복원하고 `istioctl analyze` 검증과 **revision 카나리 업그레이드**로 트래픽 직결 설정의 리스크를 낮춥니다.
