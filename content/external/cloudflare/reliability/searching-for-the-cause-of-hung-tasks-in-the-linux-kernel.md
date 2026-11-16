---
title: "Linux hung task 경고에 이름이 찍힌 프로세스"
description: "Linux hung task 경고는 오래 기다린 프로세스를 알려주지만, 대기를 일으킨 주체까지 가리키지는 않습니다. Cloudflare가 XFS 작업 큐와 core dump, RTNL 잠금 보유자를 조사하며 실제 원인을 좁혀 간 과정을 설명합니다."
date: 2026-11-16
weight: 19
---

# Linux hung task 경고에 이름이 찍힌 프로세스 (2025-02)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Searching for the cause of hung tasks in the Linux kernel](https://blog.cloudflare.com/searching-for-the-cause-of-hung-tasks-in-the-linux-kernel)
- 매체 · 게시일: The Cloudflare Blog · 2025-02-14
- 저자: Oxana Kharitonova, Jesper Brouer
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

서버는 기존 트래픽을 처리하고 있었습니다. 시스템 메트릭도 대부분 정상이었지만, 새 SSH 접속은 막히고 Kubernetes 컨테이너 생성도 멈췄습니다. Cloudflare가 커널 로그에서 찾은 메시지는 hung task 경고뿐이었습니다.

경고에 찍힌 이름은 오래 기다린 프로세스의 이름입니다. 그 프로세스가 대기를 일으킨 주체인지는 별개의 문제입니다. 애플리케이션 코드에 문제가 있을 수도 있고, 메모리를 보존하는 종료 절차나 다른 작업이 보유한 잠금 때문에 기다리는 중일 수도 있습니다. 이름 다음에 읽어야 할 단서는 스택 트레이스에 있었습니다.

## D 상태의 기다림을 감시하는 khungtaskd {#khungtaskd-and-monitoring}

hung task 경고의 출발점은 로그에 `D`로 표시되는 `TASK_UNINTERRUPTIBLE` 상태입니다. 이 상태의 프로세스는 특정 이벤트가 발생해야 깨어납니다. 그전까지는 시그널도 전달되지 않습니다.

CPU에서 실행 중이거나 실행할 준비가 된 `TASK_RUNNING`, 네트워크 패킷이나 사용자 입력을 기다리는 `TASK_INTERRUPTIBLE`과는 차이가 있습니다. 이들은 시그널을 받을 수 있고 종료 시그널로 끝낼 수도 있지만, D 상태의 프로세스는 그 상태를 벗어나야 시그널을 받습니다.

종료조차 막는 데는 이유가 있습니다. 데이터 일부는 디스크에 기록됐고 나머지는 아직 프로세스 메모리에 있다면, 메모리를 보존하는 일이 디스크 데이터의 일관성을 지키는 데 도움이 됩니다. 버그가 발생한 순간의 메모리 스냅샷을 남길 때도 유용합니다. `TASK_KILLABLE`은 이런 보호를 유지하면서 치명적 시그널로는 종료할 수 있도록 도입된 상태입니다.

문제는 깨우는 이벤트가 오지 않거나 너무 늦게 오는 경우입니다. 기다리는 프로세스가 잠금을 보유했다면 다른 프로세스까지 멈출 수 있습니다. D 상태의 프로세스가 많아지는 현상은 시스템 자원이 과부하 상태이거나 제대로 작동하지 않는다는 신호일 수 있습니다.

커널 스레드 `khungtaskd`는 설정에 따라 주기적으로 D 상태의 프로세스를 검사하고, 대기가 `kernel.hung_task_timeout_secs`를 넘으면 로그에 경고를 남깁니다. Cloudflare는 기본값 120초를 10초로 낮췄습니다. 내부 모니터링 시스템은 이 로그를 읽어 알림을 보냅니다. 어느 정도의 지연부터 경고할지는 시스템 구성과 그 지연이 미치는 영향에 따라 달라집니다.

경고 횟수에도 한도를 뒀습니다. `kernel.hung_task_warnings`를 200으로 설정하고 15분마다 초기화해, 같은 문제가 로그를 채우는 상황과 모니터링이 너무 오래 끊기는 상황을 함께 피했습니다. 횟수를 제한하지 않으려면 값을 `-1`로 설정합니다.

## test의 종료를 늦춘 core dump {#coredump-wait}

사용자 공간 애플리케이션 `test`가 5초 넘게 멈췄다는 경고가 나타났습니다. 이름만 보면 애플리케이션이 실행 중에 멎은 듯하지만, 스택 트레이스에는 `do_exit`가 있었습니다. 해당 위치의 소스 코드는 `coredump_task_exit`로 이어졌습니다. 프로세스 메트릭을 확인하자 경고가 뜬 시점에 애플리케이션이 비정상 종료됐다는 사실도 드러났습니다.

대기는 종료 과정에서 발생했습니다. core dump가 활성화돼 있으면 특정 시그널로 프로세스가 비정상 종료될 때 커널이 메모리 스냅샷을 만듭니다. 이를 파일에 쓰거나 소켓으로 `systemd-coredump` 같은 처리기에 전달하는 동안, 메모리를 보존하고 조기 종료를 막으려고 프로세스를 D 상태에 둡니다. 메모리 사용량이 클수록 이 작업도 길어지고 hung task 경고가 나올 가능성도 높아집니다.

Cloudflare는 이 가설을 재현 실험으로 확인했습니다. 10 GB 파일을 메모리에 읽고 8분간 기다리도록 만든 Go 프로그램을 준비한 뒤, 기본 Linux core dump 처리기를 사용하고 hung task 임계값을 1초로 낮췄습니다. 프로그램을 `GOTRACEBACK=crash`로 실행하고 `Ctrl+\`로 비정상 종료를 유도하자, 22초 넘게 대기했다는 경고가 나타났습니다.

재현 로그에는 이유도 적혀 있었습니다. `Blocked by coredump.`라는 문구입니다. 원문 작성 무렵 upstream에 추가된 이 메시지는 core dump 때문에 기다리는 프로세스를 대기의 원인으로 오인하지 않도록 돕습니다. 같은 패치에서 추가한 `task_flags`도 분석 단서입니다. core dump 대기는 그중 `PF_POSTCOREDUMP` 플래그로 판별합니다.

애플리케이션이 비정상 종료된 것은 사실입니다. 하지만 이 경고에서 추적하던 긴 대기는 core dump를 만드는 데 걸린 시간이었습니다.

## 느려진 XFS를 드러낸 Workqueue {#xfs-workqueue-delay}

경고에 애플리케이션 이름조차 없는 경우도 있습니다. XFS 사례에서 로그에 찍힌 이름은 `kworker/13:0`이었습니다. `kworker`는 나중에 실행하도록 예약한 작업을 처리하는 커널 스레드입니다. 여러 작업을 모아 처리하므로 이름만 보고 어느 애플리케이션이 지연을 겪는지 알아내기 어렵습니다.

여기서는 `Workqueue` 줄이 단서였습니다. Workqueue는 작업을 추가한 순서대로 `kworker`가 처리하는 큐이며, 로그에는 큐 이름 `xfs-sync`와 실행 함수 `xfs_log_worker`가 함께 남았습니다. Cloudflare는 XFS에 부하가 걸렸을 가능성을 생각하고 관련 메트릭을 확인했습니다.

조사 끝에 구성 변경 과정에서 빠뜨린 설정을 찾았습니다. Linux 디스크 암호화 성능을 높이려고 도입했던 `no_read_workqueue`와 `no_write_workqueue` 플래그였습니다. 시스템에 치명적인 문제가 생긴 사례는 아니었습니다. hung task 경고가 포착한 것은 파일시스템의 속도 저하였습니다.

## RTNL 잠금을 보유한 Wireguard의 wg_set_device() {#rtnl-lock-owner}

앞서 SSH 접속과 Kubernetes 컨테이너 생성이 막혔던 서버에서는 경고가 훨씬 넓게 퍼졌습니다. 보통 한두 프로세스에 한정되던 경고가 서로 무관해 보이는 수십 개의 작업에서 나왔고, 수분이 지나도 나아지지 않았습니다.

스택 트레이스들은 서로 달랐습니다. 그래도 따라가 보니 `rtnetlink_rcv_msg`, `dev_ethtool`, `bonding_show_bonds`가 모두 `rtnl_lock` 획득을 기다린다는 공통점이 드러났습니다. 누군가 `rtnl_mutex`를 보유한 채 놓지 않는 듯했습니다.

RTNL은 커널 네트워킹 하위 시스템이 네트워크 설정을 읽거나 쓸 때 주로 사용하는 전역 mutex입니다. 원문 작성 시점에는 이를 network namespace별로 나누려는 upstream 작업이 진행 중이었습니다. 이 서버의 경고에 나타난 작업들은 전역 잠금을 기다리는 피해자였습니다. 원인을 더 좁히려면 잠금 보유자를 찾아야 했습니다.

Cloudflare는 BPF와 `bpftrace`로 실행 중인 커널을 조사했습니다. mutex의 `owner`에는 잠금을 보유한 프로세스의 `task_struct` 포인터가 `atomic_long_t` 형태로 들어 있습니다. 포인터의 하위 3비트에는 상태 정보도 저장하므로, `& ~0x07`로 그 비트를 제거해야 포인터를 읽을 수 있습니다.

`bpftrace`의 `kaddr()`는 `/proc/kallsyms`에 공개된 `rtnl_mutex` 주소를 찾아 줍니다. 이 주소에서 `owner`를 10초마다 확인한 결과, 잠금을 오래 보유한 프로세스는 PID 3895365의 `calico-node`였습니다.

이제 보유자의 스택을 읽을 차례였습니다. `/proc/3895365/stack`을 조회하자 Wireguard 설정 변경 경로가 드러났습니다. `wg_set_device()`가 RTNL 잠금을 보유하고 있었고, `peer_remove_after_dead()`는 `napi_disable()` 호출을 오래 기다리고 있었습니다. 서로 무관해 보이던 경고들이 같은 잠금 보유자로 이어진 것입니다.

조사는 여기서 끝나지 않았습니다. Cloudflare는 Python과 비슷한 대화형 셸에서 실행 중인 커널을 조사할 수 있는 디버거 `drgn`으로 분석을 이어갔습니다. 잠금을 보유한 함수와 그 함수가 기다리는 지점까지는 찾았지만, 원문 작성 시점에도 Wireguard 문제의 근본 원인은 밝히지 못했습니다. upstream에도 도움을 요청한 상태였습니다.

{{% details title="모니터링 설정과 재현 실험의 세부 값" closed="true" %}}
| 항목 | 값 |
|---|---|
| hung task 기본 임계값과 Cloudflare 설정 | `kernel.hung_task_timeout_secs`: 기본 120초 → Cloudflare 10초 |
| Cloudflare 경고 메시지 한도와 초기화 주기 | `kernel.hung_task_warnings=200`, 15분마다 초기화 |
| 경고 메시지 수 무제한 설정 | `kernel.hung_task_warnings=-1` |
| Cloudflare 설정 예시의 기타 값 | `hung_task_all_cpu_backtrace=0`, `hung_task_check_count=4194304`, `hung_task_check_interval_secs=0`, `hung_task_panic=0` |
| core dump 재현 환경의 커널 버전 | `6.6.72-cloudflare-2025.1.7` |
| core dump 재현 설정 | `kernel.core_pattern=core`, `kernel.core_pipe_limit=16`, `kernel.core_uses_pid=1` |
| core dump 재현 시 hung task 설정 | 임계값 1초, 경고 메시지 수 무제한 |
| 재현용 Go 프로그램 | 10 GB 파일을 메모리로 읽은 뒤 8분간 대기하도록 작성 |
| 재현 시 비정상 종료 유도 | `GOTRACEBACK=crash`로 실행한 뒤 `Ctrl+\` 입력 |
| 재현 로그에서 관찰한 대기 시간 | 22초 초과 |
| RTNL 잠금 보유자 확인 주기 | `bpftrace`의 `interval:s:10`으로 10초마다 확인 |
| mutex owner 포인터의 상태 비트 제거 | 하위 3비트를 `& ~0x07`로 제거 |
{{% /details %}}
