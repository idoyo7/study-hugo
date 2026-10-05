---
title: "01 hub/edge 2-클러스터 구조"
date: 2026-08-20
lastmod: 2026-10-04
weight: 1
url: "/homelab/01-hub-edge-architecture/"
---

# hub와 edge: 두 집의 클러스터를 역할로 나누기

두 집에서 Kubernetes 클러스터를 운영합니다. 현재 사는 집에는 노드 2대와 Synology NAS가 있고, 본가에는 단일 노드가 있습니다. 예전에는 각각 `stage`와 `prod`라고 불렀지만, 스토리지와 관측 시스템이 현재 집에 모이면서 이름이 역할을 설명하지 못하게 됐습니다. 과거에 stage/prod 도메인까지 한 번 서로 바꾼 이력이 있어 혼동이 잦았습니다.

현재 집의 클러스터를 **hub**, 본가의 클러스터를 **edge**로 바꿨습니다. hub에 저장·관측·인증을 모으고 edge는 무상태 서비스를 실행하도록 정했습니다. NAS 이전으로 멈춘 edge의 관측 스택을 정리한 결과이며, 마지막으로 남은 home-assistant의 PVC 의존은 아직 해결해야 합니다.

| | hub (현재집, 舊 stage) | edge (본가, 舊 prod) |
|---|---|---|
| 도메인 | hub 전용 도메인 | edge 전용 도메인 |
| 노드 | master1 + node1 + Synology NAS | node1 단일 노드 |
| 역할 | 중앙 — 스토리지·관측·SSO·CI 산출물의 종착지 | 스포크 — 서비스만 돌리고 상태는 전부 hub로 |
| 스토리지 | `synology` storageClass (NFS) | **없음. PVC 금지** |
| 관측 | vmcluster(vmstorage ×4, RF2) + Grafana + vmalert | vmagent 하나 |
| 인증 | Keycloak (hub SSO) | 자체 IdP 없음 — hub Keycloak에 OIDC 위임 |

도메인, GitOps repo의 디렉토리(`hub/`, `edge/`), 메트릭 라벨(`cluster=hub`, `cluster=edge`)에도 같은 이름을 사용합니다. 어느 클러스터를 뜻하는지 이름을 다시 해석할 필요가 없어졌습니다.

## hub와 edge의 역할 {#1-전체-지도}

{{< flow src="_flow/1-전체-토폴로지.json" />}}

edge가 수집한 메트릭은 remote write로 hub에 보냅니다. 이 경로는 공인망을 지나므로 아래 메트릭 전송 절의 vmauth 인증을 거칩니다. edge ArgoCD가 hub의 Keycloak에 인증을 위임하는 경로는 아래 인증 위임 절에서 설명합니다.

## NAS 이전과 edge의 스토리지 의존 {#2-edge를-stateless로-만든-이유--nas-이사-사건}

원래 edge(당시 prod)에도 hub와 똑같은 VictoriaMetrics 풀스택이 있었습니다. vmstorage 4대가 900Gi씩 PVC를 잡고 Grafana도 PVC 위에서 돌았습니다. 이 PVC들은 모두 시놀로지 NFS에 의존했습니다. 시놀로지가 이사하면서 본가에서 빠지자 저장소를 마운트할 수 없게 됐습니다.

vmstorage 3대는 마운트 실패로 재시작 12,000회를 넘겼고, Grafana와 alertmanager는 Init 상태에서 진행하지 못했습니다. Git에 수정한 배포 정의도 적용되지 않았습니다. 당시 apps-root(루트 Application)는 `{env}/` 루트에 놓인 수동 apply 전용 파일이라 automated sync가 없었고 git에 들어간 수정이 두 달 동안 클러스터에 반영되지 않은 채 드리프트만 쌓였습니다.

이 경험 뒤에 edge에서는 데이터를 직접 보관하지 않기로 했습니다. NAS 이전이 원격지의 저장·조회 시스템 전체를 멈추게 했고, 백업·용량·디스크 교체를 위해 본가에 가야 하는 부담도 줄이고 싶었습니다.

edge의 VM 스택은 vmagent 하나로 줄여 저장·조회·알림을 hub에 맡겼습니다. keycloak·uptime-kuma 같은 stateful 앱도 edge 앱 목록에서 제거했습니다. 블로그·청첩장 같은 무상태 서비스와 vmagent를 중심으로 운영하며, 새 앱의 배포 규칙은 **edge에는 PVC를 요구하는 앱을 배포하지 않는다**로 정했습니다. 기존 home-assistant의 NAS 의존은 마지막 절의 미완료 작업으로 남아 있습니다.

클러스터를 다시 구성할 때는 ArgoCD를 설치하고 `kubectl apply -f edge/apps/apps-root.yaml`로 배포 정의를 적용합니다. 앱 데이터를 edge에 두지 않는 범위에서는 별도의 데이터 복원 절차를 줄일 수 있습니다.

apps-root도 구조를 바꿨습니다. `{env}/apps/apps-root.yaml`로 옮겨 자기 자신이 sync 대상 디렉토리 안에 있게(self-managed) 했습니다. 이제 루트 Application의 스펙 변경도 동기화 대상에 포함됩니다. 이전처럼 apps-root만 수동 적용에 남아 Git 변경을 받지 못하던 원인을 없앴습니다.

## 공인망으로 메트릭 보내기 {#3-메트릭-파이프라인--공인망을-건너는-유일한-트래픽}

{{< flow src="_flow/2-메트릭-파이프라인.json" />}}

edge vmagent는 자기 클러스터의 kubelet·apiserver·node-exporter·kube-state-metrics를 긁어서 `cluster=edge` 라벨을 달고 hub의 메트릭 수집 엔드포인트로 remote write 합니다. hub 자신의 vmagent도 대칭으로 `cluster=hub`를 답니다. Grafana에서는 `cluster` 라벨로 두 클러스터를 구분합니다.

공인망으로 노출하는 쓰기·읽기 경로에는 **vmauth**를 배치했습니다. VMAuth CR 하나가 :8427에서 프록시로 동작하고 VMUser CR이 계정별 라우팅을 정의합니다. `edge` 계정은 `/insert/*`를 통해 vminsert로만, `viewer` 계정은 `/select/*`를 통해 vmselect로만 접근합니다. 허용 경로 밖의 요청과 미인증 요청에는 401을 반환합니다.

기존 istio VirtualService의 목적지를 vminsert/vmselect에서 vmauth로 바꿀 때는 다음 순서로 진행했습니다.

1. vmauth와 VMUser를 배포합니다.
2. vmagent에 basicAuth를 추가합니다. 아직 관문을 바꾸기 전이라 기존 요청에 인증 헤더가 붙어도 전송은 계속됩니다.
3. VirtualService의 목적지를 vmauth로 전환합니다.

자격증명은 Git에 저장하지 않습니다. 양쪽 클러스터의 native secret(`vmauth-remote-write`, `vmauth-select`)에 두고, VMUser는 `passwordRef`로, vmagent는 `remoteWrite.basicAuth`의 secretKeyRef로 참조합니다. hub의 Grafana·vmalert·vmagent는 클러스터 내부 svc에 직접 연결하므로 이 vmauth를 거치지 않습니다.

전환 뒤에는 미인증 write/read가 401을 받는지, 인증한 경로는 200을 받는지 확인했습니다. edge 샘플의 최신 timestamp가 계속 갱신되는지도 대조했습니다. vmagent에는 WAN 단절에 대비해 디스크 버퍼 상한 `remoteWrite.maxDiskUsagePerURL=1GiB`를 설정했습니다. 연결이 복구되면 버퍼에 남은 데이터를 재전송합니다.

## 앱 저장소에서 클러스터까지의 배포 {#4-gitopsci--사람-손은-앱-repo까지만}

{{< flow src="_flow/3-gitops-파이프라인.json" />}}

배포 정의는 세 repo로 나뉩니다.

| repo | 역할 |
|------|------|
| **montstrap** | app-of-apps 정본. `{hub,edge}/apps/*.yaml`에 ArgoCD Application 정의, `platform/manifests/`에 istio·cert-manager 같은 플랫폼 컴포넌트 |
| **mont-helm** | 외부 helm chart에 먹일 custom values (`$values` 멀티소스로 참조) |
| **montstrap-manifest** | raw manifest 앱 (deployment/service/VS + kustomization) |

앱 repo에 push하면 GitHub Actions가 이미지를 빌드해 Docker Hub에 올리고, montstrap 계열 repo의 kustomization `newTag` 또는 deployment 이미지 태그를 갱신합니다. 이후 각 클러스터의 apps-root가 자기 배포 정의를 동기화합니다. 이 배포 경로에서는 사람이 kubectl로 이미지 태그를 바꾸지 않습니다.

같은 repo의 `hub/`와 `edge/` 디렉토리가 각 클러스터의 배포 정의를 담습니다. 두 클러스터의 배포는 독립적으로 동기화하고, 메트릭 전송과 인증은 각각 remote write와 OIDC로 연결합니다.

이름을 바꾸는 작업에는 `git mv` 두 번 외에도 세 repo의 경로 참조와 앱 repo 12개의 CI 워크플로우 수정이 필요했습니다. CI가 `stage/...` 경로를 하드코딩하고 있었기 때문입니다. 이때는 "git 치환 → 클러스터 apps-root 재적용 → CI 경로 수정"까지 이어서 완료해야 합니다. 그러지 않으면 옛 경로를 바라보는 CI가 존재하지 않는 디렉토리에 커밋을 미는 중간 상태가 생깁니다.

## hub Keycloak에 인증 위임 {#5-인증-위임--edge에-idp를-두지-않는다}

Keycloak은 DB를 사용하므로 상태를 hub에 모으는 운영 방침에 따라 hub에만 둡니다. edge ArgoCD는 hub의 Keycloak을 OIDC provider로 씁니다.

edge argocd-cm의 OIDC issuer를 hub SSO로 설정하고, Keycloak `argocd` 클라이언트의 redirect URI에 edge ArgoCD의 callback 주소를 추가했습니다. client secret은 edge의 `argocd-secret`에 넣었습니다. RBAC은 hub와 동일하게 Keycloak 그룹(`platform-admins` → admin) 매핑을 그대로 복사했습니다. 계정·권한 관리가 hub 한 곳으로 모입니다.

## 클러스터별 앱 목록 {#6-앱-인벤토리}

| | hub (65 apps) | edge (11 apps) |
|---|---|---|
| 플랫폼 | istio ×3, cert-manager, nfs-csi/storage, reloader, lxcfs, VM CRDs | istio ×3, cert-manager, nfs-csi, VM CRDs |
| 관측 | victoria-metrics(풀스택), hyperdx(ClickHouse), vector, opentelemetry-operator, kuma+autokuma | victoria-metrics(vmagent만) |
| 인증 | keycloak, oauth2-proxy ×3, workspace-auth | argo-config(OIDC 위임 설정) |
| 개발 인프라 | code-server, atlantis, portal, kagent, s3manager, seaweedfs, minio-console, turbo-cache, workspace-* | — |
| 서비스 | hotdeal, jekyll, nextra, kanna, memos, openclaw, study ×3, wedding ×2, palworld ×4, home-assistant | jekyll, nextra, kanna, k8s-dashboard, wedding ×2, home-assistant |

hub와 edge에 같은 앱(블로그·청첩장)이 겹치는 건 의도입니다. 블로그는 같은 이미지를 양쪽 도메인으로 서빙하는 이중화고 청첩장은 도메인별로 다른 버전(hub=invi2, edge=구형)을 나눠 서빙합니다.

## 남은 작업 {#7-남은-일}

- vmselect UI·alertmanager의 공개 경로에도 메트릭 전송과 같은 방식으로 vmauth 인증을 적용해야 합니다.
- edge의 home-assistant는 이사 간 NAS의 PVC에 아직 의존합니다. hub로 옮기거나 local-path로 전환하는 선택이 남아 있습니다.
- 두 클러스터의 메트릭이 한 TSDB에 저장되므로 vmalert 룰의 `cluster` 라벨 조건으로 알림 대상을 구분해야 합니다.
