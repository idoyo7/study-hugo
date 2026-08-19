---
title: "01 hub/edge 2-클러스터 구조"
weight: 1
---

# hub / edge — 스토리지 없는 클러스터를 스포크로 두는 홈랩

홈랩 클러스터가 두 집에 걸쳐 두 개다. 하나는 지금 사는 집, 하나는 본가. 오랫동안 이 둘을 `stage` / `prod`라고 불러왔는데, 어느 순간부터 이 이름이 거짓말을 하고 있었다. "prod"라던 본가 클러스터는 스토리지도 없이 서버만 켜져 있고, "stage"라던 현재 집이 노드 2대에 시놀로지까지 붙은 실질적 중앙이었으니까. 이름과 실체가 어긋나면 도메인 매핑을 매번 머릿속에서 뒤집어야 하고, 실제로 과거에 stage/prod 도메인이 한 번 스왑된 이력까지 있어서 혼동이 잦았다.

그래서 이름을 역할대로 다시 지었다. **hub**와 **edge**.

| | hub (현재집, 舊 stage) | edge (본가, 舊 prod) |
|---|---|---|
| 도메인 | `*.makgol.com` | `*.montkim.com` |
| 노드 | master1 + node1 + Synology NAS | node1 단일 노드 |
| 역할 | 중앙 — 스토리지·관측·SSO·CI 산출물의 종착지 | 스포크 — 서비스만 돌리고 상태는 전부 hub로 |
| 스토리지 | `synology` storageClass (NFS) | **없음. PVC 금지** |
| 관측 | vmcluster(vmstorage ×4, RF2) + Grafana + vmalert | vmagent 하나 |
| 인증 | Keycloak (sso.makgol.com) | 자체 IdP 없음 — hub Keycloak에 OIDC 위임 |

환경 이름이 도메인과 1:1이 된 것도 부수 효과다. `*.makgol.com`이면 hub, `*.montkim.com`이면 edge. GitOps repo의 디렉토리(`hub/`, `edge/`)부터 메트릭 라벨(`cluster=hub`, `cluster=edge`)까지 같은 축으로 정렬된다.

## 1. 전체 지도

{{< flow src="_flow/1-전체-토폴로지.json" />}}

두 집 사이에 VPN은 없다. 클러스터 간 통신은 공인망 하나뿐이고, 그 위를 지나는 트래픽도 딱 하나 — edge vmagent의 remote write다. 이 화살표에 인증을 붙이는 이야기는 §3에서.

## 2. edge를 stateless로 만든 이유 — NAS 이사 사건

원래 edge(당시 prod)에도 hub와 똑같은 VictoriaMetrics 풀스택이 있었다. vmstorage 4대가 900Gi씩 PVC를 잡고, Grafana도 PVC 위에서 돌았다. 문제는 그 PVC가 전부 시놀로지 NFS였고, 시놀로지가 이사하면서 본가를 떠났다는 것.

결과는 참혹했다. vmstorage 3대가 마운트 실패로 **재시작 12,000회**를 넘겼고, Grafana와 alertmanager는 Init에서 영영 멈췄다. 더 나쁜 건 이걸 GitOps로 고칠 수도 없었다는 점이다. 당시 apps-root(루트 Application)는 `{env}/` 루트에 놓인 수동 apply 전용 파일이라 automated sync가 없었고, git에 들어간 수정이 **두 달 동안 클러스터에 반영되지 않은 채** 드리프트만 쌓였다.

여기서 얻은 결론이 이 글의 제목이다. **원격지 클러스터는 상태를 갖지 않는 게 낫다.**

- 상태가 없으면 스토리지 장애가 존재하지 않는다. NAS가 어디로 이사 가든 edge는 무사하다.
- 부트스트랩이 재현 가능해진다. edge가 통째로 날아가도 ArgoCD 설치 + `kubectl apply -f edge/apps/apps-root.yaml` 한 번이면 전부 돌아온다. 복원할 데이터 자체가 없으니까.
- 원격지에 백업·용량·디스크 교체 같은 운영 부담을 두지 않는다. 본가에 가야만 고칠 수 있는 문제의 목록을 0에 수렴시킨다.

그래서 edge의 VM 스택은 vmagent 하나로 줄였고(저장·조회·알림 전부 hub로 위임), keycloak·uptime-kuma 같은 stateful 앱은 edge 앱 목록에서 제거했다. 지금 edge에서 도는 건 블로그·청첩장 같은 무상태 서비스 몇 개와 vmagent뿐이다. 규칙은 가이드에 한 줄로 박았다: **edge에는 PVC를 요구하는 앱을 배포하지 않는다.**

apps-root도 구조를 바꿨다. `{env}/apps/apps-root.yaml`로 옮겨 **자기 자신이 sync 대상 디렉토리 안에 있게(self-managed)** 했다. 이제 루트 Application의 스펙 변경도 git push만으로 클러스터에 닿는다. 두 달 드리프트 같은 사고가 구조적으로 불가능해졌다.

## 3. 메트릭 파이프라인 — 공인망을 건너는 유일한 트래픽

{{< flow src="_flow/2-메트릭-파이프라인.json" />}}

edge vmagent는 자기 클러스터의 kubelet·apiserver·node-exporter·kube-state-metrics를 긁어서 `cluster=edge` 라벨을 달고 `metrics-insert.makgol.com`으로 remote write 한다. hub 자신의 vmagent도 대칭으로 `cluster=hub`를 단다. Grafana에서 라벨 하나로 두 클러스터가 갈라진다.

이 경로는 공인망을 탄다. 무인증으로 열어두면 인터넷 전체가 내 TSDB에 아무 시계열이나 꽂아 넣을 수 있는 구멍이 되므로, 쓰기·읽기 관문에 **vmauth**를 세웠다.

- VMAuth CR 하나가 :8427에서 프록시로 서고, VMUser CR이 계정별 라우팅을 정의한다. `edge` 계정은 `/insert/*`만 vminsert로, `viewer` 계정은 `/select/*`만 vmselect로 통과시킨다. 경로 밖 요청과 미인증 요청은 401.
- istio VirtualService의 목적지를 vminsert/vmselect에서 vmauth로 바꾸는 것으로 전환 완료. 무중단으로 하려면 순서가 중요하다 — ① vmauth·VMUser 배포 ② vmagent에 basicAuth 추가(아직 무인증 관문이라 헤더가 있어도 무해) ③ VS 전환.
- 자격증명은 git에 없다. 양쪽 클러스터의 native secret(`vmauth-remote-write`, `vmauth-select`)으로만 존재하고, VMUser는 `passwordRef`로, vmagent는 `remoteWrite.basicAuth`의 secretKeyRef로 참조한다.
- hub 내부 소비자는 이 관문과 무관하다. Grafana·vmalert·hub vmagent는 클러스터 내부 svc로 직결이라 vmauth 장애가 나도 hub 관측은 살아 있다.

전환 검증은 세 가지로 했다. 미인증 write/read가 401인지, 인증 경로가 200인지, 그리고 edge 샘플의 최신 timestamp가 계속 전진하는지. vmagent 쪽엔 WAN 단절 대비로 디스크 버퍼 상한(`remoteWrite.maxDiskUsagePerURL=1GiB`)을 걸어뒀다 — 끊겼다 붙으면 버퍼에서 재전송된다.

아직 무인증으로 남은 건 `mon.makgol.com`(vmselect UI)과 `metrics-alert.makgol.com`(alertmanager)이다. 같은 패턴으로 붙일 수 있어서 후속 작업 목록에 있다.

## 4. GitOps·CI — 사람 손은 앱 repo까지만

{{< flow src="_flow/3-gitops-파이프라인.json" />}}

배포 정의는 세 repo로 나뉜다.

| repo | 역할 |
|------|------|
| **montstrap** | app-of-apps 정본. `{hub,edge}/apps/*.yaml`에 ArgoCD Application 정의, `platform/manifests/`에 istio·cert-manager 같은 플랫폼 컴포넌트 |
| **mont-helm** | 외부 helm chart에 먹일 custom values (`$values` 멀티소스로 참조) |
| **montstrap-manifest** | raw manifest 앱 (deployment/service/VS + kustomization) |

앱 repo에 push하면 GitHub Actions가 이미지를 빌드해 Docker Hub에 올리고, montstrap 계열 repo의 kustomization `newTag`(또는 deployment 이미지 태그)에 커밋을 민다. 거기서부터는 두 클러스터의 apps-root가 각자 pull해서 수렴한다. 배포에 사람이 kubectl을 만지는 지점이 없다.

환경 분리는 디렉토리 하나다. 같은 repo의 `hub/`와 `edge/`가 각 클러스터의 전체 상태고, 두 클러스터는 서로의 존재를 모른다 — 접점은 오직 §3의 remote write와 §5의 OIDC뿐이다.

리네임 후기: 디렉토리 이름을 바꾸는 것 자체는 `git mv` 두 번이지만, 여파는 세 repo의 경로 참조 전부와 **앱 repo 12개의 CI 워크플로우**까지 닿았다. CI가 `stage/...` 경로를 하드코딩하고 있었기 때문이다. 이런 리네임은 "git 치환 → 클러스터 apps-root 재적용 → CI 경로 수정"을 한 호흡에 끝내야 중간 상태(옛 경로를 바라보는 CI가 존재하지 않는 디렉토리에 커밋을 미는 상태)가 생기지 않는다.

## 5. 인증 위임 — edge에 IdP를 두지 않는다

stateless 원칙은 인증에도 적용된다. Keycloak은 DB가 필요한 stateful 앱이라 edge에 둘 수 없고, 둘 필요도 없다. edge ArgoCD(argo.montkim.com)는 hub의 Keycloak(sso.makgol.com, realm `monthouse`)을 OIDC provider로 쓴다.

필요했던 건 세 가지뿐이다. edge argocd-cm에 OIDC 설정(issuer를 hub SSO로), Keycloak `argocd` 클라이언트의 redirect URI에 `https://argo.montkim.com/auth/callback` 추가, 그리고 client secret을 edge의 `argocd-secret`에 주입. RBAC은 hub와 동일하게 Keycloak 그룹(`platform-admins` → admin) 매핑을 그대로 복사했다. 계정·권한 관리가 hub 한 곳으로 모인다.

## 6. 앱 인벤토리

| | hub (47 apps) | edge (11 apps) |
|---|---|---|
| 플랫폼 | istio ×3, cert-manager, nfs-csi/storage, reloader, lxcfs, VM CRDs | istio ×3, cert-manager, nfs-csi, VM CRDs |
| 관측 | victoria-metrics(풀스택), victoria-logs, opentelemetry, tempo, kuma+autokuma | victoria-metrics(vmagent만) |
| 인증 | keycloak, oauth2-proxy ×3, workspace-auth | argo-config(OIDC 위임 설정) |
| 개발 인프라 | code-server, atlantis, portal, kagent, s3manager, seaweedfs, minio-console, turbo-cache, workspace-* | — |
| 서비스 | hotdeal, jekyll, nextra, kanna, memos, openclaw, study ×3, wedding ×2, palworld ×4, home-assistant | jekyll, nextra, kanna, k8s-dashboard, wedding ×2, home-assistant |

hub와 edge에 같은 앱(블로그·청첩장)이 겹치는 건 의도다. 블로그는 같은 이미지를 양쪽 도메인으로 서빙하는 이중화고, 청첩장은 도메인별로 다른 버전(hub=invi2, edge=구형)을 나눠 서빙한다.

## 7. 남은 일

- `mon.makgol.com`, `metrics-alert.makgol.com`에도 vmauth 인증 (§3과 동일 패턴)
- edge의 home-assistant — 이사 간 NAS의 PVC에 묶여 있는 마지막 stateful 잔재. hub로 옮기거나 local-path로 전환
- vmalert 룰에 `cluster` 라벨 조건 정리 — 두 클러스터 메트릭이 한 TSDB에 섞이면서 알림 대상 구분이 필요해졌다
