---
title: "03 [안B] 관측 평면"
weight: 3
---

# [안 B · 2/3] 관측 평면 — 공인망을 건너는 유일한 트래픽

> 안 B(평면 분리안)의 둘째 편입니다. 이 편은 **"메트릭이 어떻게 흐르고, 어디서 인증되나"** 하나만 답합니다. 클러스터 배치는 [토폴로지]({{< relref "../02-b-topology/index.md" >}}), 배포와 사람의 접근은 [배포·접근 평면]({{< relref "../04-b-deployment-access/index.md" >}}) 참고.

{{< flow src="_flow/2-메트릭-파이프라인.json" />}}

edge vmagent는 자기 클러스터의 kubelet·apiserver·node-exporter·kube-state-metrics를 긁어서 `cluster=edge` 라벨을 달고 hub의 메트릭 수집 엔드포인트로 remote write 합니다. hub 자신의 vmagent도 대칭으로 `cluster=hub`를 답니다. Grafana에서 라벨 하나로 두 클러스터가 갈라집니다.

## vmauth — 쓰기·읽기의 단일 관문

이 경로는 공인망을 탑니다. 무인증으로 열어두면 인터넷 전체가 내 TSDB에 아무 시계열이나 꽂아 넣는 구멍이 됩니다. 쓰기·읽기 관문에 **vmauth**를 세운 이유입니다.

- VMAuth CR 하나가 :8427에서 프록시로 서고 VMUser CR이 계정별 라우팅을 정의합니다. `edge` 계정은 `/insert/*`만 vminsert로, `viewer` 계정은 `/select/*`만 vmselect로 통과시킵니다. 경로 밖 요청과 미인증 요청은 401.
- istio VirtualService의 목적지를 vminsert/vmselect에서 vmauth로 바꾸는 것으로 전환 완료. 무중단으로 하려면 순서가 중요합니다 — ① vmauth·VMUser 배포 ② vmagent에 basicAuth 추가(아직 무인증 관문이라 헤더가 있어도 무해) ③ VS 전환.
- 자격증명은 git에 없습니다. 양쪽 클러스터의 native secret(`vmauth-remote-write`, `vmauth-select`)으로만 존재하고 VMUser는 `passwordRef`로, vmagent는 `remoteWrite.basicAuth`의 secretKeyRef로 참조합니다.
- hub 내부 소비자는 이 관문과 무관합니다. Grafana·vmalert·hub vmagent는 클러스터 내부 svc로 직결이라 vmauth 장애가 나도 hub 관측은 살아 있습니다.

## 전환 검증

세 가지로 했습니다. 미인증 write/read가 401인지, 인증 경로가 200인지, 그리고 edge 샘플의 최신 timestamp가 계속 전진하는지. vmagent 쪽엔 WAN 단절 대비로 디스크 버퍼 상한(`remoteWrite.maxDiskUsagePerURL=1GiB`)을 걸어뒀습니다 — 끊겼다 붙으면 버퍼에서 재전송됩니다.

## 남은 일

- vmselect UI·alertmanager 공개 경로에도 같은 패턴의 vmauth 인증을 붙입니다.
- vmalert 룰에 `cluster` 라벨 조건을 정리합니다 — 두 클러스터 메트릭이 한 TSDB에 섞이면서 알림 대상 구분이 필요해졌습니다.
