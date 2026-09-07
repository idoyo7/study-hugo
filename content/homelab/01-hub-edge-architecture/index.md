---
title: "01 hub/edge 2-클러스터 구조"
date: 2026-08-20
lastmod: 2026-08-24
weight: 1
---

# hub / edge — 스토리지 없는 클러스터를 스포크로 두는 홈랩

홈랩 클러스터는 두 개고, 두 집에 하나씩 있습니다. 지금 사는 집과 본가. 이 둘을 오랫동안 `stage` / `prod`로 불러왔는데 어느 시점부터 이 이름은 거짓말이 되어 있었습니다. "prod"라던 본가 쪽은 스토리지도 없이 서버만 켜져 있었고 "stage"라던 지금 집은 노드 2대에 시놀로지까지 붙은 사실상의 중앙이었으니까. 이름이 실체와 어긋나면 도메인을 볼 때마다 머릿속에서 매핑을 뒤집어야 합니다. 과거에 stage/prod 도메인이 한 번 스왑된 이력까지 있어 혼동은 더 잦았습니다.

그래서 역할을 따라 이름을 다시 붙였습니다. hub와 edge.

| | hub (현재집, 舊 stage) | edge (본가, 舊 prod) |
|---|---|---|
| 도메인 | hub 전용 도메인 | edge 전용 도메인 |
| 노드 | master1 + node1 + Synology NAS | node1 단일 노드 |
| 역할 | 중앙 — 스토리지·관측·SSO·CI 산출물의 종착지 | 스포크 — 서비스만 돌리고 상태는 전부 hub로 |
| 스토리지 | `synology` storageClass (NFS) | **없음. PVC 금지** |
| 관측 | vmcluster(vmstorage ×4, RF2) + Grafana + vmalert | vmagent 하나 |
| 인증 | Keycloak (hub SSO) | 자체 IdP 없음 — hub Keycloak에 OIDC 위임 |

덤으로 환경 이름과 도메인이 1:1로 맞아 들어갔습니다. hub 도메인이면 hub, edge 도메인이면 edge. GitOps repo의 디렉토리(`hub/`, `edge/`)에서 메트릭 라벨(`cluster=hub`, `cluster=edge`)까지 전부 한 축 위에 놓입니다.

## 1. 전체 지도

{{< flow src="_flow/1-전체-토폴로지.json" />}}

두 집 사이를 오가는 데이터 트래픽은 edge vmagent의 remote write 하나뿐입니다. 집 밖으로 나가는 경로여서 인증을 붙였고, 그 이야기는 §3에서 합니다.

## 2. edge를 stateless로 만든 이유 — NAS 이사 사건

처음에는 edge(당시 prod)에도 hub와 같은 VictoriaMetrics 풀스택이 올라가 있었습니다. vmstorage 4대가 900Gi씩 PVC를 잡았고 Grafana도 PVC 위에서 돌았습니다. 그 PVC가 전부 시놀로지 NFS였는데, 시놀로지가 이사와 함께 본가를 떠났습니다.

결과는 참혹했습니다. vmstorage 3대가 마운트에 실패해 재시작 12,000회를 넘겼고 Grafana와 alertmanager는 Init 단계에서 영영 멈췄습니다. GitOps로 고칠 수도 없었다는 게 더 나빴습니다. 당시 apps-root(루트 Application)는 `{env}/` 루트에 놓인 수동 apply 전용 파일이라 automated sync가 걸려 있지 않았고 git에 넣은 수정은 두 달 동안 클러스터에 닿지 못한 채 드리프트만 쌓였습니다.

여기서 얻은 결론이 이 글의 제목이 됐습니다. 원격지 클러스터는 상태를 갖지 않는 게 낫습니다.

- 상태가 없으면 스토리지 장애라는 것이 아예 생기지 않습니다. NAS가 어디로 이사를 가든 edge는 무사합니다.
- 부트스트랩을 언제든 똑같이 재현할 수 있습니다. edge가 통째로 날아가도 ArgoCD 설치 + `kubectl apply -f edge/apps/apps-root.yaml` 한 번이면 전부 돌아옵니다. 복원할 데이터가 애초에 없으니까.
- 백업·용량·디스크 교체 같은 운영 부담을 원격지에 두지 않습니다. 본가에 직접 가야만 고칠 수 있는 문제의 목록이 0에 가까워집니다.

edge의 VM 스택은 vmagent 하나로 줄이고 저장·조회·알림은 전부 hub에 맡겼습니다. keycloak·uptime-kuma처럼 stateful한 앱도 edge 앱 목록에서 빼냈습니다. 지금 edge에서 도는 것은 블로그·청첩장 같은 무상태 서비스 몇 개와 vmagent가 전부입니다. 가이드에는 규칙을 한 줄로 적어두었습니다. edge에는 PVC를 요구하는 앱을 배포하지 않습니다.

apps-root도 손봤습니다. `{env}/apps/apps-root.yaml`로 옮겨 자기 자신이 sync 대상 디렉토리 안에 들어가도록(self-managed) 만들었습니다. 루트 Application의 스펙을 바꿀 때도 git push 한 번이면 클러스터에 닿습니다. 두 달짜리 드리프트 같은 사고는 이제 생길 길이 없습니다.

## 3. 메트릭 파이프라인 — 공인망을 건너는 유일한 트래픽

{{< flow src="_flow/2-메트릭-파이프라인.json" />}}

edge vmagent는 자기 클러스터의 kubelet·apiserver·node-exporter·kube-state-metrics를 긁어 `cluster=edge` 라벨을 붙인 뒤 hub의 메트릭 수집 엔드포인트로 remote write 합니다. hub 쪽 vmagent도 같은 방식으로 `cluster=hub`를 답니다. Grafana에서는 이 라벨 하나로 두 클러스터를 구분합니다.

이 경로는 집 밖 공인망을 지납니다. 인증 없이 열어둘 수는 없으니 쓰기와 읽기 관문에 vmauth를 세웠습니다.

- VMAuth CR 하나가 :8427에서 프록시로 서 있고 계정별 라우팅은 VMUser CR이 정합니다. `edge` 계정은 `/insert/*`만 vminsert로, `viewer` 계정은 `/select/*`만 vmselect로 넘깁니다. 정해진 경로 밖의 요청과 미인증 요청은 401을 받습니다.
- istio VirtualService의 목적지를 vminsert/vmselect에서 vmauth로 돌리면 전환이 끝납니다. 무중단으로 하려면 순서를 지켜야 합니다. ① vmauth·VMUser 배포 ② vmagent에 basicAuth 추가(관문을 바꾸기 전이라 헤더가 붙어 있어도 무해) ③ VS 전환.
- 자격증명은 git에 올리지 않았습니다. 양쪽 클러스터의 native secret(`vmauth-remote-write`, `vmauth-select`)으로만 존재하며 VMUser는 `passwordRef`로, vmagent는 `remoteWrite.basicAuth`의 secretKeyRef로 이를 참조합니다.
- hub 안의 소비자는 이 관문을 거치지 않습니다. Grafana·vmalert·hub vmagent는 클러스터 내부 svc에 직결돼 있어서 vmauth가 죽어도 hub 관측은 그대로 살아 있습니다.

전환 뒤에는 미인증 write/read가 401을 받는지, 인증 경로가 200을 돌려주는지, edge 샘플의 최신 timestamp가 계속 전진하는지를 확인했습니다. vmagent 쪽에는 WAN이 끊길 때를 대비해 디스크 버퍼 상한(`remoteWrite.maxDiskUsagePerURL=1GiB`)을 걸어두었습니다. 회선이 끊겼다 붙으면 버퍼에 쌓인 것부터 다시 보냅니다.



## 4. GitOps·CI — 사람 손은 앱 repo까지만

{{< flow src="_flow/3-gitops-파이프라인.json" />}}

배포 정의는 repo 세 개에 나뉘어 있습니다.

| repo | 역할 |
|------|------|
| **montstrap** | app-of-apps 정본. `{hub,edge}/apps/*.yaml`에 ArgoCD Application 정의, `platform/manifests/`에 istio·cert-manager 같은 플랫폼 컴포넌트 |
| **mont-helm** | 외부 helm chart에 먹일 custom values (`$values` 멀티소스로 참조) |
| **montstrap-manifest** | raw manifest 앱 (deployment/service/VS + kustomization) |

앱 repo에 push하면 GitHub Actions가 이미지를 빌드해 Docker Hub에 올린 다음 montstrap 계열 repo의 kustomization `newTag`(또는 deployment 이미지 태그)에 커밋을 밉니다. 그 뒤로는 두 클러스터의 apps-root가 각자 pull해서 알아서 수렴합니다. 배포 과정에서 사람이 kubectl을 만질 일은 없습니다.

환경을 나누는 것은 디렉토리 하나입니다. 같은 repo 안의 `hub/`와 `edge/`가 각 클러스터의 전체 상태이고 두 클러스터는 서로의 존재를 모릅니다. 접점은 §3의 remote write와 §5의 OIDC뿐입니다.

리네임 후기도 적어둡니다. 디렉토리 이름을 바꾸는 일 자체는 `git mv` 두 번으로 끝나지만 여파는 세 repo의 경로 참조 전부와 앱 repo 12개의 CI 워크플로우까지 미쳤습니다. CI가 `stage/...` 경로를 하드코딩하고 있었기 때문입니다. 이런 리네임은 "git 치환 → 클러스터 apps-root 재적용 → CI 경로 수정"을 한 호흡에 끝내야 합니다. 중간에 멈추면 옛 경로를 보고 있는 CI가 존재하지 않는 디렉토리로 커밋을 미는 어정쩡한 상태가 생깁니다.

## 5. 인증 위임 — edge에 IdP를 두지 않는다

stateless 원칙은 인증에도 그대로 이어집니다. Keycloak은 DB가 필요한 stateful 앱이어서 edge에 둘 수 없고 둘 필요도 없습니다. edge ArgoCD는 hub의 Keycloak을 OIDC provider로 씁니다.

필요한 설정은 셋뿐이었습니다. edge argocd-cm에 OIDC 설정을 넣고(issuer는 hub SSO로), Keycloak `argocd` 클라이언트의 redirect URI에 edge ArgoCD의 callback 주소를 더하고, client secret을 edge의 `argocd-secret`에 주입하면 끝입니다. RBAC은 hub와 같은 Keycloak 그룹(`platform-admins` → admin) 매핑을 그대로 복사했습니다. 계정과 권한 관리가 hub 한 곳으로 모입니다.

## 6. 앱 인벤토리

| | hub (47 apps) | edge (11 apps) |
|---|---|---|
| 플랫폼 | istio ×3, cert-manager, nfs-csi/storage, reloader, lxcfs, VM CRDs | istio ×3, cert-manager, nfs-csi, VM CRDs |
| 관측 | victoria-metrics(풀스택), victoria-logs, opentelemetry, tempo, kuma+autokuma | victoria-metrics(vmagent만) |
| 인증 | keycloak, oauth2-proxy ×3, workspace-auth | argo-config(OIDC 위임 설정) |
| 개발 인프라 | code-server, atlantis, portal, kagent, s3manager, seaweedfs, minio-console, turbo-cache, workspace-* | — |
| 서비스 | hotdeal, jekyll, nextra, kanna, memos, openclaw, study ×3, wedding ×2, palworld ×4, home-assistant | jekyll, nextra, kanna, k8s-dashboard, wedding ×2, home-assistant |

hub와 edge 양쪽에 같은 앱(블로그·청첩장)이 있는 것은 의도한 겹침입니다. 블로그는 같은 이미지를 두 도메인으로 서빙하는 이중화이고 청첩장은 도메인별로 다른 버전(hub=invi2, edge=구형)을 나눠 서빙합니다.

## 7. 남은 일

- vmselect UI·alertmanager 공개 경로에도 vmauth 인증을 붙이기 (§3과 같은 패턴)
- edge의 home-assistant — 이사 간 NAS의 PVC에 묶인 마지막 stateful 잔재. hub로 옮기거나 local-path로 전환
- vmalert 룰에 `cluster` 라벨 조건 정리. 두 클러스터 메트릭이 한 TSDB에 섞이면서 알림 대상을 구분해야 할 필요가 생겼습니다
