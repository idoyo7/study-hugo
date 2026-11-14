---
title: "Kubernetes Cgroup Driver 선택 과정"
description: "카카오 클라우드기술팀이 cgroupfs와 systemd Cgroup Driver의 동작을 분석하고 DKOS에서 cgroupfs Driver를 그대로 쓰기로 한 과정을 정리했습니다. Kubernetes 문서의 불안정 경고를 확인하려고 시작한 조사입니다."
date: 2026-11-14
weight: 7
---

# Kubernetes Cgroup Driver 선택 과정 (2020-06)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Cgroup Driver 선택하기](https://tech.kakao.com/posts/394)
- 매체 · 게시일: 카카오 기술블로그 · 2020-06-29
- 저자: ssup.2 (클라우드기술팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 조사의 계기 {#motivation}

카카오는 Kubernetes 기반 Container Platform DKOS를 개발하고 운영합니다. 안정적 운영을 위해 Kubernetes를 분석하다가 Cgroup Driver 문서에서 다음 취지의 문구를 봤습니다. kubelet과 Docker에는 cgroupfs를, 노드의 나머지 프로세스에는 systemd를 쓰도록 설정한 노드가 리소스 압박 아래서 불안정해지는 사례를 현장에서 봤다는 내용입니다. systemd를 쓰는 Linux에서 kubelet과 Docker가 cgroupfs Driver를 쓰면 시스템이 불안정해진다는 뜻이므로 이를 완전히 파악하려고 Cgroup Driver를 분석하게 됐습니다.

## Cgroup과 제어 방법 {#cgroup-basics}

Cgroup은 Control Group의 약자로, 여러 프로세스가 든 프로세스 그룹 단위로 CPU, Memory, Disk, Network 사용량을 제한하고 격리하는 Linux 기능입니다. 주로 컨테이너의 리소스 제어에 쓰입니다. 컨테이너가 생성되면 그 프로세스를 담당하는 Container Cgroup이 만들어지고, 컨테이너 안 프로세스가 fork로 만든 자식 프로세스도 모두 여기에 속합니다. 그래서 컨테이너 리소스는 Container Cgroup을 제어해서 다룹니다.

Cgroup을 제어하는 방법은 cgroupfs와 systemd API, 두 가지입니다.

cgroupfs는 Cgroup 제어를 위해 만든 특수 파일시스템입니다. 커널이 별도 시스템 콜 대신 cgroupfs를 제공하며, Cgroup 정보는 디렉터리와 파일로 나타나서 디렉터리 생성·삭제와 파일 내용 변경으로 제어합니다. 그래서 `mkdir`, `rmdir`, `echo` 같은 명령을 쓸 수 있습니다. systemd는 cgroupfs를 `/sys/fs/cgroup` 아래에 mount하며 리소스 종류별로 따로 mount됩니다. 담당 리소스는 mount option으로 알 수 있습니다. memory cgroupfs에 `mkdir group_a`를 하면 Memory Cgroup이 만들어지고, 아무 파일도 만들지 않았는데 상태 확인과 설정용 파일이 다수 생깁니다. 프로세스의 PID를 `cgroup.procs`에 `echo`하면 그 Cgroup에 속하고, `cat`으로 소속 PID를 확인합니다.

systemd는 Linux의 Init Process로 데몬 제어와 함께 Cgroup 제어도 맡습니다. 이 기능은 systemd Unit(systemd가 제어하는 데몬 프로세스)의 일부로 들어 있어서, 데몬의 리소스 사용량을 제어하는 데 쓰입니다. 원문의 `systemd-run --unit=myunit sleep infinity` 예에서 Unit의 Cgroup이 `/sys/fs/cgroup/memory/system.slice` 아래에 `myunit.service`로 만들어지고 sleep 프로세스가 소속된 것을 볼 수 있습니다.

## Cgroup Driver 분석 {#driver-analysis}

Cgroup Driver는 Cgroup을 관리하는 모듈이며 cgroupfs Driver와 systemd Driver가 있습니다. 전자는 직접 cgroupfs로 Cgroup을 제어하고, 후자는 systemd를 통해 제어합니다. Docker를 쓰는 Kubernetes 클러스터에서 Cgroup Driver는 libcontainer 라이브러리에 들어 있고 kubelet과 runc가 이를 씁니다. 사용할 Driver는 kubelet과 Docker Daemon에 각각 설정하며 둘은 반드시 같아야 합니다. Docker Daemon에 설정된 Driver는 Docker Daemon과 containerd의 명령으로 컨테이너를 실제로 만드는 runc가 사용합니다.

systemd의 API는 IPC인 D-Bus로 노출되므로 systemd Driver는 D-Bus로 통신하고, systemd는 요청에 따라 cgroupfs로 Cgroup을 제어합니다. systemd가 cgroupfs를 쓰기 때문에 mount 관리도 systemd가 합니다.

두 Driver가 만드는 Cgroup 경로는 정책이 달라 다릅니다. cgroupfs Driver는 `kubepods/besteffort/pod<pod-id>/<container-id>` 형태이고, systemd Driver는 `kubepods.slice/kubepods-besteffort.slice/kubepods-besteffort-pod<pod-id>.slice/docker-<container-id>.scope`처럼 이름이 조금씩 다르며 slice와 scope가 붙습니다. 이는 systemd가 Cgroup을 관리하는 Unit의 Type으로, systemd가 만드는 Cgroup에는 반드시 붙습니다.

## DKOS의 선택 {#decision}

분석하고 나니 오히려 문서의 경고에 공감하기 어려웠다고 합니다. cgroupfs Driver가 cgroupfs로 설정한 Cgroup이나 systemd가 cgroupfs로 설정한 Cgroup이나 커널 입장에서는 다를 게 없다고 판단했기 때문입니다. 더 명확한 원인을 알고 싶어 kubeadm, kubernetes website, systemd의 GitHub 이슈와 커밋에 질문을 남겼습니다. 결론은 cgroupfs Driver와 systemd를 같이 쓸 때의 문제는 Cgroup 관리 정책의 충돌이고, 시스템 안정성과는 관계가 없다는 것이었습니다.

그래서 DKOS는 기존에 쓰던 cgroupfs Driver를 그대로 쓰기로 했고, 이유는 세 가지입니다.

- DKOS의 클러스터 노드는 Kubernetes 전용 VM/PM이라 Kubernetes 구동만 고려하면 되므로, 두 관리 정책의 충돌이 실제 관리를 어렵게 하는 요소가 아닙니다.
- Cgroup 설정에 사용자 수준 앱인 systemd를 쓰는 systemd Driver보다 cgroupfs로 직접 설정하는 cgroupfs Driver가 더 안정적일 확률이 높다고 판단했습니다.
- 지금까지 cgroupfs Driver를 써 왔고 그로 인한 이슈를 겪은 적이 없습니다.

결론은 "현재 쓰는 cgroupfs Driver를 그대로 쓰자"로 단순하지만, 분석과 선택 과정에서 Kubernetes를 더 깊이 이해하게 됐다고 맺습니다.
