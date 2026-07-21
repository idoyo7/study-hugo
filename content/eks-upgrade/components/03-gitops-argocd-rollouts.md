---
title: "GitOps — argocd·argo-rollouts"
weight: 3
---

# GitOps — argocd·argo-rollouts

{{< callout type="info" >}}
**한눈에**
- **argocd(워크로드 spoke)**: chart 7.5.2(앱 v2.12) → **chart 10.1.4(앱 v3.4.5)**. 최대 breaking 구간은 앱 **2.14→3.0**(logs RBAC 강제, 리소스 추적 label→annotation) — 현행 2.12는 애초에 k8s 1.33 tested 목록 밖이라 bump가 사실상 필수다 `✓`
- **argo-rollouts**: chart 2.37.2(앱 v1.7.1) → **chart 2.41.1(앱 v1.9.1)**. k8s 지원 매트릭스가 없는 tolerant 컴포넌트라 하드 블로커는 아니지만, **CVE-2026-35469(HIGH, 원격 DoS)** 수정판이라 강력 권장이다 `✓`
- 둘 다 finance에서 **umbrella 서브차트로 배포되는 argo-rollouts**와 **독립 upstream 차트로 배포되는 argocd**라는 구조가 다르다 — argocd는 `yo-charts` 리워크가 필요 없고, argo-rollouts는 `cluster-bootstrap-v2` umbrella의 `Chart.yaml` dependency를 고쳐야 한다 `✓`
- argo-rollouts는 istio canary 트래픽 라우팅만 쓴다(ALB rollout trafficRouting은 finance 템플릿에 없음) — v1.9.0의 istio DestinationRule/weight 순서 변화가 직접 관련된다 `✓`
{{< /callout >}}

## argocd(워크로드 spoke) — 7.5.2 → 10.1.4

대상은 staging-finance-green/prod-finance-green의 워크로드 spoke ArgoCD다. ring0 허브(관리) ArgoCD는 이 페이지 범위 밖이지만, 허브가 spoke를 배포하는 주체이므로 **허브 버전이 미확인이라는 점은 리스크로 남는다**.

차트는 argo-helm의 `argo-cd`를 upstream에서 직접 핀한다(ECR OCI 미러가 아니다) — 3단계 메이저(7.x→8.x→9.x→10.x)를 관통해 최신 stable로 직행한다. CRD apiVersion(`argoproj.io/v1alpha1`)은 그대로지만, ApplicationSet CRD 스키마가 대형화되면서 앱 3.3+부터 **Server-Side Apply가 사실상 필수**가 됐다.

가장 breaking이 몰린 구간은 앱 **2.14→3.0**이다.

- **logs RBAC 강제 기본화**와 함께 `server.rbac.log.enforce.enable` 플래그 자체가 제거된다. finance는 이미 대부분 역할에 `logs, get` 그랜트를 갖고 있지만, `role:devops`에는 이 그랜트가 없어 순수 devops 사용자가 로그 접근을 잃을 수 있다(단 sre 계정은 developers 역할을 경유해 유지된다).
- **Application 하위 리소스 fine-grained RBAC**가 강화되어 `update`/`delete`가 더 이상 관리 리소스에 자동 상속되지 않는다. UI에서 관리 리소스를 직접 삭제/수정하는 운영 방식을 쓴다면 레거시 동작 복원 플래그를 명시해야 한다.
- **리소스 추적 기본이 label에서 annotation으로** 바뀐다. `ApplyOutOfSyncOnly=true`를 쓰는 앱은 orphan 위험이 있으나 finance는 이 syncOption을 쓰지 않는다.
- **`global.networkPolicy.create` 기본값이 chart 10.0.0에서 false→true로** 바뀐다. finance는 istio 사이드카가 병존하므로 기본 NetworkPolicy가 컴포넌트 트래픽에 영향을 줄 수 있어 명시적으로 재검토해야 한다.

blue-green 신규 클러스터는 신규 설치이므로 앱 2.12→…→3.4 순차 helm 적용이 필요 없다 — 목표 chart로 직행하면 되고, in-place 경로에서만 필요한 redis-ha haproxy selector 마이그레이션(chart 9.1.0)도 신규 설치에는 해당 없다.

### 적용 절차

1. **사전** — ECR 이미지 미러에 argocd v3.4.5·dex v2.45.0·redis 7.2 계열·haproxy 태그가 존재하는지 확인한다. 신규 클러스터는 API endpoint가 바뀌므로 허브의 cluster secret과 정적 SA bearerToken도 재발급해야 한다.
2. **values 정정** — `server.rbac.log.enforce.enable` 제거, `role:devops`에 `logs, get` 그랜트 추가 검토, `server.rbac.disableApplicationFineGrainedRBACInheritance: 'false'`로 레거시 상속 유지 여부 결정, `global.networkPolicy.create: false` 명시(istio 병존 대응).
3. **revision 핀 변경** — chart targetRevision을 10.1.4로 올린다. spoke argocd Application의 syncOptions에 `ServerSideApply=true`를 추가한다(대형 ApplicationSet CRD 대응, 앱 3.3+ 요건).
4. **검증** — 이미지 태그 v3.4.5 확인, 파드 Running(server/repo-server/application-controller/applicationset-controller/redis-ha), CRD Established, 팀별 RBAC 회귀(로그 접근 포함), Keycloak OIDC 로그인 + redirect URI(3.1 PKCE 요건).

### 리스크 체크리스트

- [ ] 허브 ArgoCD 버전 미확인 — 멀티소스 `$values` 참조·Server-Side Apply·대형 CRD 배포를 지원하는지 먼저 캡처한다.
- [ ] 정적 SA bearerToken 미회전 — 신규 클러스터용 신규 발급이 필수다.
- [ ] ECR 이미지 미러 태그 존재 확인(누락 시 ImagePullBackOff).
- [ ] `global.networkPolicy.create` 기본 true × istio 병존 — 명시 정책 결정.
- [ ] logs RBAC 강제 기본화 — `role:devops` 그랜트 부재 확인·보완.
- [ ] fine-grained RBAC 상속 제거 — UI 직접 삭제/수정 사용 여부에 따라 호환 플래그 결정.
- [ ] ApplicationSet CRD SSA 필요 — spoke Application에 syncOption 추가.

## argo-rollouts — 2.37.2 → 2.41.1

argo-rollouts는 finance 워크로드에서 **`cluster-bootstrap-v2` umbrella 차트의 서브차트**로 배포된다(독립 ArgoCD 앱이 아니다). 따라서 단독 bump가 불가능하고, umbrella `Chart.yaml`의 dependency 핀을 리워크해 재퍼블리시해야 한다. finance에서 실제로 Rollout을 쓰는 서비스는 3개, 표준 Deployment로 남는 서비스가 2개이며, 전략은 canary + analysis(istio 메트릭 기반)이 기본이고 blueGreen도 지원한다. trafficRouting은 istio 전용이라 ALB 관련 변경은 무관하다.

Rollout CRD apiVersion(`argoproj.io/v1alpha1`)은 전 구간 변경이 없다. 공식 릴리스노트에도 "breaking change" 명시 항목은 없지만, finance의 canary + istio + analysis 사용 패턴에 영향 가능한 동작 변화가 v1.9.0에 몰려 있다.

- **Pod metadata가 항상 reconcile**되도록 바뀐다. canary/stable 임시 라벨을 관리하는 방식이 달라지므로 커스텀 ephemeral metadata를 붙이는 경우 검증이 필요하다.
- **istio DestinationRule/weight 순서가 바뀐다** — `ReplicaSetReferenced`가 DestinationRule을 제대로 확인하도록, 롤백 시 DestinationRule 업데이트가 SetWeight보다 먼저 수행되도록, 신규 canary에서는 weight 설정이 hash 할당보다 먼저 되도록 바뀐다. finance의 canary 서브셋 전환 순서가 영향받을 수 있어 스테이징 canary 검증이 필수다.
- **v1.9.1(패치)**는 CVE-2026-35469(spdystream SPDY 프레임 파서 미검증으로 인한 원격 DoS, CVSS4.0 8.7 HIGH) 수정판이다 — 이번 업그레이드의 핵심 동인이다.

### 적용 절차

1. **umbrella 차트 리워크** — `cluster-bootstrap-v2`의 `Chart.yaml`에서 argo-rollouts dependency 버전을 2.41.1로 교체한다. 실배포 umbrella와 워킹트리 버전이 다를 수 있으므로, **실배포 baseline에서 argo-rollouts 핀만 올린 최소 diff 버전**을 새로 끊는 것을 권장한다 — 같은 Chart.yaml에 핀된 다른 서브차트(external-secrets·aws-load-balancer-controller·metrics-server)가 의도치 않게 함께 재렌더되는 것을 피하기 위해서다.
2. **targetRevision 핀** — app-of-apps의 umbrella targetRevision을 새로 퍼블리시한 버전으로 교체한다.
3. **values** — argo-rollouts 서브차트 values는 공식 릴리스노트에 스키마 파괴 변경이 없어 그대로 유지 가능(스테이징에서 helm template diff로 검증 권장). 서비스 Rollout values(canary/blueGreen/analysis/istio trafficRouting)도 변경 불필요.
4. **배포·검증** — staging 먼저. 컨트롤러 이미지가 v1.9.1인지, 기존 Rollout이 정상 reconcile되는지 확인한 뒤 실제 이미지 bump로 canary 롤아웃 1회를 돌려 istio 서브셋 weight 전환·analysis 통과·자동 프로모션을 검증한다. 통과 후 prod에 동일 절차를 적용한다.

### 리스크 체크리스트

- [ ] **번들 커플링(최우선)** — umbrella 버전을 그대로 올리면 argo-rollouts 외 다른 서브차트도 함께 재렌더될 수 있다. `helm template`로 argo-rollouts 외 렌더 diff가 0인지 확인한다.
- [ ] **istio canary 회귀(1.9.0)** — DestinationRule/SetWeight/hash 순서 변경을 스테이징 실 canary로 검증한다.
- [ ] **pod metadata 항상 reconcile(1.9.0)** — 메트릭 라벨링에 영향 가능성을 스테이징에서 확인한다.
- [ ] **AnalysisTemplate 호환** — error-rate/latency AnalysisTemplate이 v1.9.1에서 유효 렌더·평가되는지 확인한다.
- [ ] **CRD Server-Side Apply** — 공식 하드 요구사항은 아니지만, ArgoCD sync 시 대형 CRD 어노테이션 에러가 나면 예방적으로 적용한다.
- [ ] **롤백 계획** — umbrella targetRevision을 되돌리면 argo-rollouts도 함께 복귀하지만, CRD는 `keepCRDs: true`라 다운그레이드 시 신규 필드가 남을 수 있다(무해하나 인지 필요).

## 근거

- Argo CD tested k8s 매트릭스(3.4=v1.32~1.35, 3.1=1.33 최초 지원): `https://raw.githubusercontent.com/argoproj/argo-cd/v3.4.5/docs/operator-manual/tested-kubernetes-versions.md`
- Argo CD upgrading 가이드(2.14→3.0 핵심 구간, 3.2→3.3 SSA 필수): `https://argo-cd.readthedocs.io/en/stable/operator-manual/upgrading/overview/`
- argo-helm `argo-cd` Chart.yaml(10.1.4=appVersion v3.4.5): `https://raw.githubusercontent.com/argoproj/argo-helm/argo-cd-10.1.4/charts/argo-cd/Chart.yaml`
- argo-rollouts 릴리스노트(v1.8.0/v1.9.0/v1.9.1): `https://github.com/argoproj/argo-rollouts/releases`
- CVE-2026-35469(NVD, CVSS4.0 8.7 HIGH): `https://nvd.nist.gov/vuln/detail/CVE-2026-35469`
