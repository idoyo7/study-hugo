---
title: "Atlantis를 30분씩 붙잡은 Kubernetes 기본값"
description: "Cloudflare의 Atlantis 재시작이 30분씩 걸린 원인은 볼륨 전체에 반복되던 그룹 변경이었습니다. 볼륨 내부의 그룹 변경 가능성을 확인한 뒤 Kubernetes 설정 한 줄을 추가해 재시작 시간을 약 30초로 줄였습니다."
date: 2026-11-16
weight: 5
---

# Atlantis를 30분씩 붙잡은 Kubernetes 기본값 (2026-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [A one-line Kubernetes fix that saved 600 hours a year](https://blog.cloudflare.com/one-line-kubernetes-fix-saved-600-hours-a-year)
- 매체 · 게시일: The Cloudflare Blog · 2026-03-26
- 저자: Braxton Schafer
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

Cloudflare는 Kubernetes 설정 한 줄로 Atlantis 재시작 시간을 약 30분에서 30초로 줄였습니다. 수정 자체는 싱거울 만큼 간단했습니다. 오래 걸린 쪽은 새 Pod가 만들어진 뒤 무엇을 기다리는지 알아내는 일이었습니다.

## 재시작마다 멈춰 선 Terraform 작업 {#restart-delays}

Atlantis가 돌아올 때까지는 plan도, apply도 불가능했습니다. 이 도구가 관리하는 모든 저장소에서 인프라 변경이 멈췄고, 재시작할 때마다 온콜 엔지니어도 호출됐습니다. 한 번에 약 30분입니다.

Cloudflare는 GitLab merge request(MR)로 관리하는 수십 개 Terraform 프로젝트의 plan과 apply를 Atlantis에 맡깁니다. Atlantis는 잠금으로 한 프로젝트를 한 번에 하나의 MR만 수정하도록 보장하며, Kubernetes에서는 단일 인스턴스 StatefulSet으로 실행됩니다. 저장소 상태를 디스크에 보존하는 곳은 PersistentVolume(PV)입니다.

재시작은 피하기 어려운 일상 작업이었습니다. Terraform 프로젝트를 추가하거나 제거할 때, 자격 증명을 갱신할 때마다 Atlantis를 재시작해야 변경 사항을 반영할 수 있었습니다. 자격 증명 갱신과 프로젝트 추가 등으로 재시작은 월 약 100회에 이르렀고, 그때마다 쌓인 엔지니어의 작업 대기는 월 50시간을 넘었습니다.

알림 대기 시간을 늘리자는 논의도 나왔습니다. 하지만 그렇게 하면 문제를 가리고 실제 장애에 대응하는 시점까지 늦추게 됩니다. 팀은 Atlantis가 왜 이토록 늦게 돌아오는지 추적하기로 했습니다.

## 이미지 다운로드 직전의 긴 공백 {#events-and-kubelet-logs}

Secret 변경을 반영하려고 `kubectl rollout restart statefulset atlantis`를 실행하면 기존 Pod가 정상 종료되고 새 Pod가 거의 즉시 나타났습니다. 생성 자체는 빨랐습니다. 그런데 새 Pod는 init container조차 실행하지 못한 채 `Init:0/1` 상태로 약 30분을 보냈습니다.

Pod 이벤트에는 스케줄링 성공과 init container 이미지 다운로드 기록이 남아 있었습니다. 다운로드에 걸린 시간은 대기를 포함해 632ms입니다. 설명이 필요한 구간은 그 앞이었습니다. Pod를 배치한 뒤 이미지 다운로드를 시작하기까지 긴 시간이 비어 있었지만, 이벤트만으로는 그 사이에 무슨 일이 있었는지 알 수 없었습니다.

조사 대상을 노드로 옮겼습니다. 각 노드에서 Pod 생성과 PV 마운트를 담당하는 `kubelet`은 systemd 서비스로 실행되며, 이 환경에서는 Kibana에서 로그를 조회할 수 있었습니다. Pod가 배치된 호스트는 이미 알고 있었으므로, 해당 호스트의 `kubelet` 로그에서 `atlantis`가 들어간 메시지를 추렸습니다.

PV 장치 마운트는 스케줄링 직후 성공했습니다. Secret 볼륨도 문제없었습니다. 그런데 뒤이어 `atlantis-storage`가 아직 마운트되지 않았다는 시간 초과 오류와 Pod sandbox를 새로 시작해야 한다는 메시지가 반복됐습니다. 장치 마운트는 끝났는데 Pod는 시작하지 못하는 상태였습니다.

## 수백만 파일을 다시 훑는 Kubernetes 기본값 {#recursive-group-changes}

Pod 이름으로 찾은 로그는 거기까지였습니다. 팀은 멈추기 직전에 마운트한 PV로 시선을 돌렸습니다. 고유한 PV 이름을 Kibana 검색어로 넣자, 볼륨 소유권을 설정하고 있으며 파일이 많으면 오래 걸릴 수 있다는 로그가 나타났습니다.

파일이 많다는 단서는 이미 있었습니다. 최근 Atlantis의 영구 스토리지는 inode가 고갈돼 볼륨을 확장해야 했습니다. 파일과 디렉터리 항목마다 소비하는 inode의 개수는 파일시스템을 만들 때 전달한 매개변수로 정해집니다. 하지만 Cloudflare의 Kubernetes 플랫폼이 제공하는 Ceph 구현에서는 `mkfs` 플래그를 지정할 수 없어 기본값을 써야 했습니다. 이 환경에서 inode를 늘릴 방법은 파일시스템 확장뿐이었고, PV 재시작에는 Pod 재시작도 필요했습니다. 그 과정에서 긴 재시작 시간이 다시 드러났던 것입니다.

문제의 설정은 Pod의 `spec.securityContext`에 있던 `fsGroup: 1`입니다. GID 1로 실행되는 프로세스가 볼륨의 파일에 접근하도록 하는 설정으로, root가 아닌 사용자로 실행되는 Atlantis가 PV를 읽고 쓰려면 필요했습니다.

Kubernetes는 이 접근 권한을 보장하려고 볼륨을 마운트할 때마다 전체 파일과 디렉터리의 그룹을 갱신했습니다. `kubelet`이 파일시스템 전체에 `chgrp -R`을 실행하는 작업입니다. inode가 바닥날 만큼 파일이 쌓인 볼륨에서는 매번 수백만 항목을 순회해야 했습니다. 빠른 flash 스토리지에서도 오래 걸리는 작업이었습니다.

## 파일 생성 방식을 확인한 뒤 바꾼 한 줄 {#root-permission-policy}

권한 설정을 없앨 수는 없었습니다. 대신 매번 볼륨 전체를 갱신해야 하는지 결정하는 설정이 있었습니다. Kubernetes v1.20부터 지원하는 `fsGroupChangePolicy`입니다.

기본값인 `Always`는 마운트할 때마다 권한을 갱신합니다. 다른 선택지인 `OnRootMismatch`는 PV 루트 디렉터리의 권한이 기대와 다를 때만 권한을 변경합니다. 루트 디렉터리의 권한이 이미 맞으면 재귀적 갱신을 건너뛰는 방식입니다.

여기에는 적용 조건이 있습니다. PV에서 파일이 어떻게 생성되는지 정확히 모른다면 `OnRootMismatch`를 설정해서는 안 됩니다. Cloudflare 팀은 PV 내부 항목의 그룹을 바꿀 만한 것이 없는지 확인한 뒤, StatefulSet의 Pod 템플릿에 한 줄을 추가했습니다.

추가한 항목은 `spec.template.spec.securityContext`의 `fsGroupChangePolicy: OnRootMismatch`입니다.

작고 단순한 워크로드에 적합한 기본값도 데이터가 늘면 병목이 될 수 있습니다. 큰 PV를 사용하는 환경이라면 재귀적 권한 변경이 재시작 시간을 소비하는지 확인하고, `securityContext`의 `fsGroup`과 `fsGroupChangePolicy`를 점검할 이유가 여기에 있습니다. 설정을 바꿀 수 있는지는 볼륨 안에서 파일과 그룹을 어떻게 다루는지에 달려 있습니다.

변경 후 Atlantis는 약 30초 만에 돌아왔습니다. Cloudflare가 되찾은 시간은 월 약 50시간이며, 연간으로 환산하면 약 600시간입니다. 인프라 변경을 기다리던 시간과 온콜 엔지니어가 오탐에 대응하던 시간을 줄인 결과였습니다.

{{% details title="재시작 시간과 권한 설정의 세부 값" closed="true" %}}
| 항목 | 값 |
|---|---|
| 재시작 빈도 | 자격 증명 갱신과 프로젝트 추가 등의 이유로 월 약 100회 |
| 변경 전 재시작 시간 | 약 30분 |
| 변경 후 재시작 시간 | 약 30초 |
| 초기 문제 규모 설명 | 월 50시간을 넘는 엔지니어 작업 대기 |
| 변경 후 회수 시간 | 월 약 50시간, 연간 환산 약 600시간 |
| init container 이미지 다운로드 | 제시된 이벤트에서 대기 포함 632ms |
| 기존 그룹 설정 | `fsGroup: 1` |
| `fsGroupChangePolicy` 지원 시작 | Kubernetes v1.20 |
| 기본 정책 | `Always` |
| 적용 정책과 위치 | StatefulSet의 `spec.template.spec.securityContext`에 `fsGroupChangePolicy: OnRootMismatch` |
| 적용 전 확인 | PV 내부 항목의 그룹을 바꿀 만한 것이 없는지 확인 |
{{% /details %}}
