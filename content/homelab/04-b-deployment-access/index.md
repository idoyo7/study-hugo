---
title: "04 [안B] 배포·접근 평면"
weight: 4
---

# [안 B · 3/3] 배포·접근 평면 — 코드의 흐름과 사람의 접근

> 안 B(평면 분리안)의 셋째 편입니다. 이 편은 두 질문을 답합니다 — **"코드가 어떻게 클러스터에 닿나"**(GitOps·CI)와 **"사람이 어떻게 배포 시스템에 들어오나"**(ArgoCD 인증/인가). 클러스터 배치는 [토폴로지]({{< relref "../02-b-topology/index.md" >}}), 메트릭 흐름은 [관측 평면]({{< relref "../03-b-observability/index.md" >}}) 참고.

## 코드의 흐름 — 사람 손은 앱 repo까지만

{{< flow src="_flow/3-gitops-파이프라인.json" />}}

배포 정의는 세 repo로 나뉩니다.

| repo | 역할 |
|------|------|
| **montstrap** | app-of-apps 정본. `{hub,edge}/apps/*.yaml`에 ArgoCD Application 정의, `platform/manifests/`에 istio·cert-manager 같은 플랫폼 컴포넌트 |
| **mont-helm** | 외부 helm chart에 먹일 custom values (`$values` 멀티소스로 참조) |
| **montstrap-manifest** | raw manifest 앱 (deployment/service/VS + kustomization) |

앱 repo에 push하면 GitHub Actions가 이미지를 빌드해 Docker Hub에 올리고 montstrap 계열 repo의 kustomization `newTag`(또는 deployment 이미지 태그)에 커밋을 밉니다. 거기서부터는 두 클러스터의 apps-root가 각자 pull해서 수렴합니다. 배포에 사람이 kubectl을 만지는 지점이 없습니다.

apps-root는 `{env}/apps/apps-root.yaml`로 옮겨 자기 자신이 sync 대상 디렉토리 안에 있게(self-managed) 했습니다. 루트 Application의 스펙 변경도 git push만으로 클러스터에 닿습니다. 예전엔 이 파일이 수동 apply 전용이라 edge가 두 달치 수정을 못 받는 사고가 있었고, 그 재발을 구조적으로 막은 장치입니다.

환경 분리는 디렉토리 하나입니다. 같은 repo의 `hub/`와 `edge/`가 각 클러스터의 전체 상태고 두 클러스터는 서로의 존재를 모릅니다 — 접점은 [관측 평면]({{< relref "../03-b-observability/index.md" >}})의 remote write와 아래 OIDC뿐입니다.

리네임 후기: 디렉토리 이름을 바꾸는 것 자체는 `git mv` 두 번이지만 여파는 세 repo의 경로 참조 전부와 앱 repo 12개의 CI 워크플로우까지 닿았습니다. CI가 `stage/...` 경로를 하드코딩하고 있었기 때문입니다. 이런 리네임은 "git 치환 → 클러스터 apps-root 재적용 → CI 경로 수정"을 한 호흡에 끝내야 합니다. 그러지 않으면 옛 경로를 바라보는 CI가 존재하지 않는 디렉토리에 커밋을 미는 중간 상태가 생깁니다.

## 사람의 접근 — edge에 IdP를 두지 않는다

{{< flow src="_flow/4-사람의-접근.json" />}}

stateless 원칙은 인증에도 적용됩니다. Keycloak은 DB가 필요한 stateful 앱이라 edge에 둘 수 없고 둘 필요도 없습니다. edge ArgoCD(argo.montkim.com)는 hub의 Keycloak(sso.makgol.com, realm `monthouse`)을 OIDC provider로 씁니다.

필요했던 건 세 가지뿐입니다.

1. edge argocd-cm에 OIDC 설정 — issuer를 hub SSO로.
2. Keycloak `argocd` 클라이언트의 redirect URI에 `https://argo.montkim.com/auth/callback` 추가 — 클라이언트 하나를 두 ArgoCD가 공유합니다.
3. client secret을 edge의 `argocd-secret`에 주입 — git엔 평문이 없고 클러스터 secret으로만.

RBAC은 hub와 동일하게 Keycloak 그룹(`platform-admins` → admin) 매핑을 그대로 복사했습니다. 계정·권한 관리가 hub 한 곳으로 모입니다 — 사람을 추가·차단하는 일도, 권한을 바꾸는 일도 Keycloak에서 한 번이면 두 클러스터에 동시에 적용됩니다.
