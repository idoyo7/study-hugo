---
title: "02 [안B] 토폴로지와 stateless 원칙"
weight: 2
---

# [안 B · 1/3] hub / edge — 토폴로지와 stateless 원칙

> 안 B(평면 분리안)의 첫 편입니다. 이 편은 **"무엇이 어디에 있고, 상태는 어디에 있나"** 하나만 답합니다. 메트릭이 어떻게 흐르는지는 [관측 평면]({{< relref "../03-b-observability/index.md" >}}), 코드와 사람이 어떻게 닿는지는 [배포·접근 평면]({{< relref "../04-b-deployment-access/index.md" >}})에서 다룹니다.

홈랩 클러스터가 두 집에 걸쳐 두 개입니다. 하나는 지금 사는 집, 하나는 본가. 오랫동안 이 둘을 `stage` / `prod`라고 불러왔는데, 어느 순간부터 이 이름이 거짓말을 하고 있었습니다. "prod"라던 본가 클러스터는 스토리지도 없이 서버만 켜져 있고 "stage"라던 현재 집이 노드 2대에 시놀로지까지 붙은 실질적 중앙이었으니까. 이름과 실체가 어긋나면 도메인 매핑을 매번 머릿속에서 뒤집어야 합니다. 실제로 과거에 stage/prod 도메인이 한 번 스왑된 이력까지 있어 혼동이 잦았습니다.

그래서 이름을 역할대로 다시 지었습니다. **hub**와 **edge**.

| | hub (현재집, 舊 stage) | edge (본가, 舊 prod) |
|---|---|---|
| 도메인 | hub 전용 도메인 | edge 전용 도메인 |
| 노드 | master1 + node1 + Synology NAS | node1 단일 노드 |
| 역할 | 중앙 — 스토리지·관측·SSO·CI 산출물의 종착지 | 스포크 — 서비스만 돌리고 상태는 전부 hub로 |
| 스토리지 | `synology` storageClass (NFS) | **없음. PVC 금지** |

환경 이름이 도메인과 1:1이 된 것도 부수 효과입니다. hub 도메인이면 hub, edge 도메인이면 edge. GitOps repo의 디렉토리(`hub/`, `edge/`)부터 메트릭 라벨(`cluster=hub`, `cluster=edge`)까지 같은 축으로 정렬됩니다.

## 전체 지도

{{< flow src="_flow/1-전체-토폴로지.json" />}}

두 집 사이에 VPN은 없습니다. 클러스터 간 통신은 공인망 하나뿐이고 그 위를 지나는 트래픽도 딱 하나 — edge vmagent의 remote write입니다. 이 화살표의 인증은 [관측 평면]({{< relref "../03-b-observability/index.md" >}}) 소관입니다.

## edge를 stateless로 만든 이유 — NAS 이사 사건

원래 edge(당시 prod)에도 hub와 똑같은 VictoriaMetrics 풀스택이 있었습니다. vmstorage 4대가 900Gi씩 PVC를 잡고 Grafana도 PVC 위에서 돌았습니다. 문제는 그 PVC가 전부 시놀로지 NFS였고 시놀로지가 이사하면서 본가를 떠났다는 것.

결과는 참혹했습니다. vmstorage 3대가 마운트 실패로 재시작 12,000회를 넘겼고 Grafana와 alertmanager는 Init에서 영영 멈췄습니다. 더 나쁜 건 이걸 GitOps로 고칠 수도 없었다는 점입니다. 당시 apps-root(루트 Application)는 automated sync가 없는 수동 apply 전용 파일이라, git에 들어간 수정이 두 달 동안 클러스터에 반영되지 않은 채 드리프트만 쌓였습니다(이 구조를 고친 이야기는 [배포·접근 평면]({{< relref "../04-b-deployment-access/index.md" >}})에서).

여기서 얻은 결론이 이 시리즈의 뼈대입니다. **원격지 클러스터는 상태를 갖지 않는 게 낫습니다.**

- 상태가 없으면 스토리지 장애가 존재하지 않습니다. NAS가 어디로 이사 가든 edge는 무사합니다.
- 부트스트랩이 재현 가능해집니다. edge가 통째로 날아가도 ArgoCD 설치 + `kubectl apply -f edge/apps/apps-root.yaml` 한 번이면 전부 돌아옵니다. 복원할 데이터 자체가 없으니까.
- 원격지에 백업·용량·디스크 교체 같은 운영 부담을 두지 않습니다. 본가에 가야만 고칠 수 있는 문제의 목록을 0에 수렴시킵니다.

그래서 edge의 VM 스택은 vmagent 하나로 줄였고(저장·조회·알림 전부 hub로 위임), keycloak·uptime-kuma 같은 stateful 앱은 edge 앱 목록에서 제거했습니다. 규칙은 가이드에 한 줄로 박았습니다: **edge에는 PVC를 요구하는 앱을 배포하지 않습니다.**

## 앱 인벤토리

| | hub (47 apps) | edge (11 apps) |
|---|---|---|
| 플랫폼 | istio ×3, cert-manager, nfs-csi/storage, reloader, lxcfs, VM CRDs | istio ×3, cert-manager, nfs-csi, VM CRDs |
| 관측 | victoria-metrics(풀스택), victoria-logs, opentelemetry, tempo, kuma+autokuma | victoria-metrics(vmagent만) |
| 인증 | keycloak, oauth2-proxy ×3, workspace-auth | argo-config(OIDC 위임 설정) |
| 개발 인프라 | code-server, atlantis, portal, kagent, s3manager, seaweedfs, minio-console, turbo-cache, workspace-* | — |
| 서비스 | hotdeal, jekyll, nextra, kanna, memos, openclaw, study ×3, wedding ×2, palworld ×4, home-assistant | jekyll, nextra, kanna, k8s-dashboard, wedding ×2, home-assistant |

hub와 edge에 같은 앱(블로그·청첩장)이 겹치는 건 의도입니다. 블로그는 같은 이미지를 양쪽 도메인으로 서빙하는 이중화고 청첩장은 도메인별로 다른 버전(hub=invi2, edge=구형)을 나눠 서빙합니다.

## 남은 일

- edge의 home-assistant — 이사 간 NAS의 PVC에 묶여 있는 마지막 stateful 잔재. hub로 옮기거나 local-path로 전환합니다.
