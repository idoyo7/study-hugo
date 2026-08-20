---
title: "01 토폴로지와 stateless 원칙"
weight: 1
---

# 상태 없는 서비스 클러스터를, 집 두 곳에 걸쳐 만들기

프로덕션에서 서비스 클러스터는 상태를 갖지 않습니다. 데이터베이스도 오브젝트 스토리지도 메트릭 저장소도 클러스터 밖에 두고, 클러스터 안에는 워크로드만 돌립니다. 노드가 죽어도, 클러스터를 통째로 다시 만들어도 복원할 것이 없어야 한다는 뜻입니다.

이 홈랩은 그 패턴을 물리적으로 떨어진 두 곳에서 구현한 것입니다. 클러스터가 두 집에 걸쳐 두 개 있습니다. 하나는 지금 사는 집, 하나는 본가. 상태를 쥔 중앙을 **hub**, 워크로드만 도는 서비스 클러스터를 **edge**라고 부릅니다.

프로덕션이라면 이 둘이 같은 리전 안에 있고 사설망으로 붙어 있을 겁니다. 여기서는 아닙니다. 두 집은 서로 다른 회선에 물려 있고 VPN도 없어서, 둘을 잇는 것은 공인망 하나뿐입니다. "서비스 클러스터는 상태를 갖지 않는다"를 가장 불리한 조건에서 시험해 본 셈입니다. 중앙이 안 보이는 순간이 실제로 생기고, 원격지에 손을 대려면 차를 몰고 가야 하니까요.

## 이름부터 역할과 어긋나 있었다

오랫동안 이 둘을 `stage` / `prod`라고 불렀습니다. 어느 순간부터 이 이름이 거짓말을 하고 있었습니다. "prod"라던 본가 클러스터는 스토리지도 없이 서버만 켜져 있고, "stage"라던 현재 집이 노드 2대에 NAS까지 붙은 실질적 중앙이었으니까. 이름과 실체가 어긋나면 도메인 매핑을 매번 머릿속에서 뒤집어야 합니다. 과거에 두 환경의 도메인이 한 번 스왑된 이력까지 있어 혼동이 잦았습니다.

그래서 역할대로 다시 지었습니다. 중앙이면 hub, 스포크면 edge. 이름이 구조를 설명하게 두면 나머지가 따라옵니다.

| | hub (현재집, 舊 stage) | edge (본가, 舊 prod) |
|---|---|---|
| 노드 | master1 + node1 + Synology NAS | node1 단일 노드 |
| 역할 | 중앙 — 상태를 쥐는 쪽 | 서비스 클러스터 — 워크로드만 |
| 스토리지 | `synology` storageClass (NFS) | **없음. PVC 금지** |
| 관측 | 저장·조회·알림 전부 | 수집만, 저장은 hub로 |

이름을 맞추자 축이 하나로 정렬됐습니다. GitOps repo의 디렉토리(`hub/`, `edge/`)도, 메트릭 라벨(`cluster=hub`, `cluster=edge`)도, 도메인도 같은 이름을 씁니다. 어느 쪽 이야기를 하는지 매번 되묻지 않게 됐습니다.

## 전체 지도

{{< flow src="_flow/1-전체-토폴로지.json" />}}

좌우가 같은 모양인데 맨 아랫줄만 다릅니다. 앱이 있고 그 위를 수집하는 계층이 있는 것까지는 양쪽이 같고, 그 아래 상태 계층이 hub에만 있습니다. 이 그림 한 장이 이 시리즈의 논지 전부입니다.

두 집을 건너는 트래픽은 edge에서 hub로 가는 remote write 하나뿐입니다. 그 화살표에 인증을 붙이는 이야기는 [관측 평면]({{< relref "../02-observability/index.md" >}})에서 다룹니다.

## 원칙을 어겼을 때 무슨 일이 생기나 — NAS 이사 사건

이 원칙은 처음부터 지켜진 게 아닙니다. 원래 edge에도 hub와 똑같은 VictoriaMetrics 풀스택이 있었습니다. vmstorage가 각자 PVC를 잡고 Grafana도 PVC 위에서 돌았습니다. 문제는 그 PVC가 전부 NAS의 NFS를 보고 있었고, 그 NAS가 이사하면서 본가를 떠났다는 것.

결과는 참혹했습니다. vmstorage 3대가 마운트 실패로 재시작 12,000회를 넘겼고 Grafana와 alertmanager는 Init에서 영영 멈췄습니다. 더 나쁜 건 이걸 GitOps로 고칠 수도 없었다는 점입니다. 당시 apps-root(루트 Application)는 automated sync가 없는 수동 apply 전용 파일이라, git에 들어간 수정이 두 달 동안 클러스터에 반영되지 않은 채 드리프트만 쌓였습니다. 이 구조를 고친 이야기는 [배포·접근 평면]({{< relref "../03-deployment-access/index.md" >}})에 있습니다.

프로덕션에서라면 이건 "원격 스토리지가 잠깐 끊겼다" 정도로 끝났을 사고입니다. 여기서는 스토리지가 아예 다른 집으로 걸어 나갔습니다. 원칙을 어긴 대가를 극단적인 형태로 받아본 셈이고, 그래서 결론도 분명해졌습니다. **원격지 클러스터는 상태를 갖지 않는 편이 낫습니다.**

- 상태가 없으면 스토리지 장애라는 사건 자체가 존재하지 않습니다. NAS가 어디로 이사 가든 edge는 무사합니다.
- 부트스트랩이 재현 가능해집니다. edge가 통째로 날아가도 ArgoCD를 설치하고 apps-root 하나를 apply하면 전부 돌아옵니다. 복원할 데이터가 없으니까.
- 원격지에 백업·용량·디스크 교체 같은 운영 부담을 두지 않습니다. 본가에 가야만 고칠 수 있는 문제의 목록을 0에 수렴시킵니다.

그래서 edge의 VM 스택은 vmagent 하나로 줄였고, keycloak·uptime-kuma처럼 DB나 PVC를 요구하는 앱은 edge 목록에서 뺐습니다. 규칙은 가이드에 한 줄로 박았습니다. edge에는 PVC를 요구하는 앱을 배포하지 않습니다.

## 앱 인벤토리

| | hub (47 apps) | edge (11 apps) |
|---|---|---|
| 플랫폼 | istio ×3, cert-manager, nfs-csi/storage, reloader, lxcfs, VM CRDs | istio ×3, cert-manager, nfs-csi, VM CRDs |
| 관측 | victoria-metrics(풀스택), victoria-logs, opentelemetry, tempo, kuma+autokuma | victoria-metrics(vmagent만) |
| 인증 | keycloak, oauth2-proxy ×3, workspace-auth | argo-config(OIDC 위임 설정) |
| 개발 인프라 | code-server, atlantis, portal, kagent, s3manager, seaweedfs, minio-console, turbo-cache, workspace-* | — |
| 서비스 | hotdeal, jekyll, nextra, kanna, memos, openclaw, study ×3, wedding ×2, palworld ×4, home-assistant | jekyll, nextra, kanna, k8s-dashboard, wedding ×2, home-assistant |

앱 수가 4배 차이 나는 게 중요한 게 아닙니다. 차이는 종류에 있습니다. hub 목록에는 상태를 쥐는 것들(NAS, TSDB, IdP, 오브젝트 스토어)이 있고 edge 목록에는 하나도 없습니다.

hub와 edge에 같은 앱(블로그·청첩장)이 겹치는 건 의도입니다. 블로그는 같은 이미지를 양쪽 도메인으로 서빙하는 이중화고, 청첩장은 도메인별로 다른 버전을 나눠 서빙합니다. 둘 다 무상태라 어느 쪽에 놓든 상관없다는 점이 오히려 이 구조의 결과입니다.

## 남은 일

- edge의 home-assistant — 이사 간 NAS의 PVC에 묶여 있는 마지막 stateful 잔재. hub로 옮기거나 local-path로 전환합니다.
