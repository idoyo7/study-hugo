---
title: "Kubernetes Cgroup Driver를 유지하기로 한 DKOS"
description: "Kubernetes의 불안정 경고에도 DKOS가 cgroupfs Driver를 유지하기로 한 이유는 무엇일까요? 카카오 클라우드기술팀은 문제를 Cgroup 관리 정책의 충돌로 보았고, Kubernetes 전용 노드에서는 그 충돌이 관리를 어렵게 하지 않는다고 판단했습니다."
date: 2026-11-14
weight: 7
---

# Kubernetes Cgroup Driver를 유지하기로 한 DKOS (2020-06)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Cgroup Driver 선택하기](https://tech.kakao.com/posts/394)
- 매체 · 게시일: 카카오 기술블로그 · 2020-06-29
- 저자: ssup.2 (클라우드기술팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 불안정 경고가 적힌 Kubernetes 문서 {#motivation}

카카오 클라우드기술팀은 Kubernetes 기반 Container Platform인 DKOS에서 기존 cgroupfs Driver를 유지하기로 했습니다. 조사의 출발점은 불안정 경고였습니다. DKOS를 안정적으로 운영하려고 Kubernetes를 분석하던 중, Cgroup Driver 문서에서 그냥 지나치기 어려운 문구를 발견했습니다.

문서에는 kubelet과 Docker에는 cgroupfs를, 노드의 나머지 프로세스에는 systemd를 쓰도록 설정한 노드가 리소스 압박 아래서 불안정해진 현장 사례가 있다고 적혀 있었습니다. systemd를 사용하는 Linux에서 cgroupfs Driver를 계속 써도 되는지 확인해야 했습니다. 팀은 Cgroup을 누가 어떻게 제어하는지부터 살펴봤습니다.

## cgroupfs로 이어지는 Cgroup Driver의 제어 경로 {#driver-analysis}

Cgroup은 Control Group의 약자로, 프로세스 그룹 단위로 CPU, Memory, Disk, Network 사용량을 제한하고 격리하는 Linux 기능입니다. 컨테이너를 생성하면 그 안의 프로세스들이 속할 Container Cgroup도 만들어집니다. fork로 생긴 자식 프로세스도 여기에 속합니다. 따라서 Container Cgroup을 제어하면 컨테이너의 리소스 사용량을 다룰 수 있습니다.

이 Cgroup을 관리하는 모듈이 Cgroup Driver입니다. Docker를 쓰는 Kubernetes 클러스터에서는 libcontainer 라이브러리에 포함되어 있고, kubelet과 runc가 이 라이브러리를 사용합니다. Driver 설정은 kubelet과 Docker Daemon에 각각 지정하며 반드시 같아야 합니다. Docker Daemon에 지정한 Driver는 Docker Daemon과 containerd의 명령을 받아 실제 컨테이너를 생성하는 runc가 사용합니다.

cgroupfs Driver는 cgroupfs를 직접 다룹니다. systemd Driver는 프로세스 간 통신 방식인 D-Bus로 systemd API를 호출하고, 요청을 받은 systemd가 Cgroup을 제어합니다. 여기서 systemd가 사용하는 것도 cgroupfs입니다. 호출 경로에는 차이가 있지만, Cgroup을 설정하는 마지막 단계에서는 같은 파일시스템을 쓰고 있었습니다.

## 디렉터리 하나로 만들어지는 Cgroup {#cgroup-basics}

cgroupfs는 Cgroup 제어를 위한 특수 파일시스템입니다. 커널은 별도 시스템 콜 대신 이 파일시스템을 제공하며, 내부에서 관리하는 Cgroup 정보를 디렉터리와 파일로 보여 줍니다. 디렉터리 하나가 Cgroup 하나에 해당합니다. Cgroup 사이의 관계도 디렉터리처럼 트리를 이루므로, `mkdir`, `rmdir`, `echo`로 그룹을 만들거나 지우고 설정을 바꿉니다.

systemd를 쓰는 Linux에서는 `/sys/fs/cgroup` 아래에 리소스 종류별로 cgroupfs가 mount되어 있습니다. systemd도 Cgroup 제어에 cgroupfs를 사용하므로 mount까지 관리하는 것입니다. 각 파일시스템이 담당하는 리소스는 mount option으로 확인합니다.

Memory를 담당하는 cgroupfs에서 `mkdir group_a`를 실행하면 Memory Cgroup이 생깁니다. 디렉터리만 만들었는데도 안에는 상태 확인과 설정에 쓰는 파일들이 들어 있습니다. 프로세스를 넣는 일도 파일 쓰기입니다. sleep 프로세스의 PID를 `cgroup.procs`에 `echo`로 쓰면 그 프로세스가 그룹에 속하고, 같은 파일을 `cat`으로 읽으면 소속 PID를 확인합니다.

systemd를 사용할 때는 Unit이 등장합니다. Linux의 Init Process인 systemd는 데몬을 제어하면서 Cgroup도 관리하는데, Cgroup 제어 기능은 Unit 기능의 일부입니다. 여기서 Unit은 systemd가 제어하는 데몬 프로세스로 이해하면 됩니다. `systemd-run --unit=myunit sleep infinity`를 실행하면 `myunit` Unit이 만들어지고, Memory Cgroup은 `/sys/fs/cgroup/memory/system.slice` 아래에 `myunit.service`로 생깁니다. 이 Cgroup의 `cgroup.procs`를 읽으면 sleep 프로세스가 소속된 것을 확인합니다.

Driver별 관리 정책의 차이는 경로에 드러납니다. cgroupfs Driver로 만든 컨테이너의 Memory Cgroup은 `kubepods/besteffort/pod<pod-id>/<container-id>` 형태입니다. 같은 컨테이너라도 systemd Driver를 쓰면 `kubepods.slice/kubepods-besteffort.slice/kubepods-besteffort-pod<pod-id>.slice/docker-<container-id>.scope`처럼 이름이 달라집니다. 모두 Pod의 QoS, Pod ID, Container ID로 구성되지만, systemd가 만든 Cgroup에는 관리용 Unit의 Type인 slice와 scope가 붙습니다.

## Kubernetes 전용 노드에서 고른 cgroupfs Driver {#decision}

동작을 확인하고 나니 저자는 오히려 처음의 경고에 공감하기 어려워졌습니다. cgroupfs Driver가 cgroupfs로 설정한 Cgroup이나 systemd가 cgroupfs로 설정한 Cgroup이나, 커널 입장에서는 다를 게 없다고 판단했기 때문입니다. 경로 이름과 관리 정책의 차이만으로는 시스템이 불안정해진다는 설명을 받아들이기 어려웠습니다.

더 명확한 원인을 찾으려고 kubeadm, kubernetes website, systemd의 GitHub 이슈와 커밋에 질문을 남겼습니다. 문답을 거쳐 저자가 내린 결론은, 함께 사용할 때의 문제가 Cgroup 관리 정책의 충돌에 있으며 시스템 안정성과는 관계가 없다는 것이었습니다.

DKOS의 노드는 Kubernetes 전용 VM/PM이었습니다. Kubernetes 구동만 고려하면 되는 환경이어서, cgroupfs Driver와 systemd의 관리 정책이 충돌하더라도 실제 노드 관리를 어렵게 하는 요소는 아니었습니다. 이 운영 조건에서 DKOS는 기존 Driver를 유지하기로 했습니다.

직접 제어하는 방식에 대한 판단도 있었습니다. 사용자 수준 앱인 systemd를 거쳐 Cgroup을 설정하는 것보다 cgroupfs로 직접 설정하는 편이 더 안정적일 확률이 높다고 보았습니다. 기존 운영 경험도 이 선택을 뒷받침했습니다. DKOS는 그때까지 cgroupfs Driver로 클러스터를 구성해 왔고, 이 Driver로 인한 이슈를 겪은 적이 없었습니다.
