---
title: "pid 네임스페이스가 끝나지 않던 FUSE 데드락 추적"
description: "Netflix Compute 팀이 사내 FUSE 파일시스템 ndrive 때문에 docker kill이 멈추던 문제를 /proc과 커널 코드로 추적해 원인을 찾은 과정을 정리했습니다. 종료 중인 스레드가 SIGKILL을 무시해 생기는 데드락입니다."
date: 2026-11-14
weight: 9
---

# pid 네임스페이스가 끝나지 않던 FUSE 데드락 추적 (2023-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Debugging a FUSE deadlock in the Linux kernel](https://netflixtechblog.com/debugging-a-fuse-deadlock-in-the-linux-kernel-c75cd7989b6d)
- 매체 · 게시일: Netflix TechBlog · 2023-05-19
- 저자: Tycho Andersen
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 문제의 배경 {#background}

Netflix의 Compute 팀은 AWS와 컨테이너 워크로드 전반을 맡아 오토스케일링, 컨테이너 배포, 문제 복구 같은 일을 합니다. 저자는 사용자가 신고한 이상한 문제를 고치는 역할입니다. 이번 건은 사내 FUSE 파일시스템 ndrive와 얽혀 있었고, 한동안 방치되다가 누군가 작정하고 들여다봐야 하는 상태였습니다. 글은 /proc을 뒤져 상황을 파악한 과정, 커널 메일링 리스트에 올렸다가 커널 wait 코드가 실제로 어떻게 동작하는지 배운 이야기를 담았습니다.

## 증상, 멈춘 docker kill과 좀비 프로세스 {#symptom}

Docker API 호출 하나가 멈춰 있었습니다. 고루틴 덤프를 보면 Titus 실행기의 `Kill`이 shutdown 도중 `ContainerInspect`를 부르고, 이 HTTP 호출이 Docker unix 소켓에서 약 8,817분째 대기 중이었습니다. 관리 엔진이 컨테이너를 죽이라고 요청한 것이고, 컨테이너는 SIGKILL로 죽이도록 설정돼 있습니다. SIGKILL은 대체로 치명적이어야 하는데 컨테이너가 무엇을 하고 있을까요.

`docker exec`로 들어가 보면 OCI 런타임 오류로 setns 프로세스가 상태 1로 끝났다는 메시지가 나옵니다. 컨테이너는 살아 있는데 setns(2)가 실패하는 상황입니다. `ps`로 프로세스 트리를 보면 containerd-shim 아래에 docker-init이 있고, 그 자식으로 ndrive가 `<defunct>`로 하나 남아 있습니다. 컨테이너의 init은 살아 있고 좀비 자식 하나를 둔 상태입니다.

init의 `/proc/<pid>/stack`을 보면 `zap_pid_ns_processes`에서 `kernel_wait4`로 대기하고 있습니다. 종료 중인데 멈춘 것입니다. 유일한 자식은 좀비, 즉 이미 종료되어 부모의 wait()를 기다리는 프로세스입니다. 그런데 커널이 좀비를 기다리며 멈출 수 있을까요. ndrive 프로세스의 `task` 디렉터리를 보니 스레드가 둘이었습니다. 하나는 좀비이고 다른 하나는 아니었습니다. 이 스레드의 스택은 FUSE의 `request_wait_answer`에서 `fuse_simple_request`, `fuse_flush`, `filp_close`, `put_files_struct`, `do_exit`로 이어집니다. 열심히 종료하려는데 FUSE 안에서 막혀 있는 것입니다.

## 커널 코드로 본 대기 지점 {#kernel-wait}

`zap_pid_ns_processes()`는 좀비 자식을 거두고, `kernel_wait4`가 ECHILD를 돌려줄 때까지 반복합니다. 그 앞에서는 `disable_pid_allocation`으로 pid 네임스페이스에 더 이상 프로세스가 들어오지 못하게 막습니다. docker가 setns()를 못 하는 이유가 이것입니다. 네임스페이스가 좀비 상태이기 때문입니다.

그렇다면 왜 `kernel_wait4`에서 멈출까요. 다른 스레드가 있는 FUSE의 `request_wait_answer`는 `wait_event`로 `FR_FINISHED` 플래그가 서기를, 즉 유저 공간이 FUSE flush 요청에 답하기를 기다립니다. 그런데 `zap_pid_ns_processes()`가 이미 SIGKILL을 보냈습니다. 스레드의 status 파일을 보면 ShdPnd에 `0x100`(아홉 번째 비트)이 있고 이것이 SIGKILL입니다. pending 시그널은 커널이 만들었지만 유저 공간에 아직 전달되지 않은 시그널입니다. 시그널은 시스템 콜에 들어가거나 나올 때, 이벤트를 기다릴 때처럼 특정 시점에만 전달됩니다. 막힌(blocked) 시그널도 pending 집합에 나타나지만 `man 7 signal`은 SIGKILL과 SIGSTOP은 잡거나 막거나 무시할 수 없다고 말합니다. 그런데 이 작업은 대기하는 동안 SIGKILL이 pending인 채로 무시되고 있었습니다.

## 헛다리, 시그널은 어떻게 처리되는가 {#red-herring}

wait 코드(`include/linux/wait.h`)는 세마포어, 대기 큐, completion 등 커널 곳곳에서 쓰이니 SIGKILL을 알아볼 것이 분명합니다. 그렇다면 `wait_event()`는 실제로 무엇을 할까요. 매크로를 풀어 보면 `___wait_event`가 무한 루프로 `prepare_to_wait_event()`를 부르고, 조건을 확인하고, 중단할지 확인하고, `cmd`(여기서는 `schedule()`)를 실행합니다. `prepare_to_wait_event()`가 0이 아닌 값(-ERESTARTSYS)을 돌려주는 경우는 `signal_pending_state()`가 참일 때뿐입니다. 호출 지점이 그냥 `wait_event()`라서 상태는 `TASK_UNINTERRUPTIBLE`이고, `signal_pending_state()`는 상태에 `TASK_INTERRUPTIBLE`이나 `TASK_WAKEKILL`이 없으면 0을 돌려줍니다. 그러니 첫 `if`가 실패합니다.

그래도 이 작업에 시그널이 pending이면 `TIF_SIGPENDING`이 서 있어야 하지 않을까요. `signal_pending()`은 `TIF_NOTIFY_SIGNAL`(이름과 달리 여기서는 상관없음)을 보고, `task_sigpending()`은 `TIF_SIGPENDING` 플래그를 봅니다. `zap_pid_ns_processes()`는 `group_send_sig_info(SIGKILL, SEND_SIG_PRIV, task, PIDTYPE_MAX)`로 시그널을 보내고, 이는 `__send_signal_locked()`에 이릅니다. PIDTYPE_PID가 아니면 공유 pending 집합(`shared_pending`)에 시그널을 넣고 `complete_signal()`을 부릅니다. PIDTYPE_MAX는 대략 "커널의 특권 작업이 보내는 시그널이니 반드시 전달하라"는 뜻입니다. 의도치 않은 결과로 SIGKILL이 개별 작업의 집합이 아니라 공유 집합에 들어갑니다. 그런데 `__fatal_signal_pending()`은 작업 자신의 pending 집합에 SIGKILL이 있는지를 봅니다. 하지만 이것도 헛다리였고, 그 사실을 이해하는 데 한참 걸렸다고 저자는 적습니다.

## 시그널이 실제로 전달되는 방식 {#signal-delivery}

진짜 원인은 `complete_signal()`에 있습니다. 이 함수는 작업의 pending 집합에 SIGKILL을 무조건 더합니다. 그런데도 왜 안 통했을까요. 함수 첫머리는 시그널을 큐에서 꺼내도록 깨울 스레드를 찾습니다. 메인 스레드가 시그널을 원하면(`wants_signal`) 메인 스레드가 먼저 받고, 스레드가 하나뿐이거나 PIDTYPE_PID면 깨울 필요가 없으니 돌아갑니다. 이때 Eric Biederman이 설명했듯 사실상 모든 스레드는 언제든 SIGKILL을 처리할 수 있습니다.

`wants_signal()`은 시그널이 blocked면 거짓을 돌려주고, 스레드가 `PF_EXITING`이어도 거짓입니다. SIGKILL이면 참이고, 그다음에 정지·추적 상태 같은 규칙이 이어집니다. 곧 이미 종료 중인 스레드는 시그널을 받으려 하지 않습니다.

데드락은 아래 순서로 만들어집니다.

1. 작업이 FUSE 파일을 열고 닫지 않은 채 종료합니다. 종료 중 커널이 `do_exit()`을 부르고 여기서 `exit_signals(tsk)`가 `PF_EXITING`을 겁니다.
2. `do_exit()`이 `exit_files(tsk)`로 이어져 아직 열린 모든 파일을 flush합니다. 위의 스택 트레이스가 이 단계입니다.
3. pid 네임스페이스가 종료되며 `zap_pid_ns_processes()`에 들어가 모두에게 SIGKILL을 보내고(치명적일 것으로 기대) 모두 끝나기를 기다립니다.
4. 이 때문에 pid 네임스페이스 안의 FUSE 데몬이 죽어서 응답할 수 없게 됩니다.
5. 이미 종료 중이던 FUSE 작업에 대해 `complete_signal()`은 `PF_EXITING` 때문에 시그널을 무시합니다.
6. 데드락. FUSE 연결을 수동으로 abort하지 않으면 영원히 멈춥니다.

## 해결, 기다리지 않기 {#solution}

이 경우 flush를 기다리는 것은 의미가 없습니다. 작업이 죽어 가는 중이라 flush()의 반환 코드를 받을 상대가 없습니다. 이 버그는 여러 파일시스템에서 일어날 수 있습니다. 커널의 wait 코드를 flush()에서 호출하는 모든 경우, 즉 로컬 커널 밖의 무언가와 통신하는 거의 모든 파일시스템이 해당합니다. 당분간은 파일시스템마다 패치해야 합니다. FUSE의 수정은 4월 23일에 배포된 Linux 6.3에 들어 있습니다.

원문은 이 글이 FUSE 데드락을 다루지만 nfs 코드 등에도 같은 문제가 분명히 있다고 짚습니다. 프로덕션에서 아직 만나지 않았을 뿐 거의 틀림없이 만날 것이라고 합니다. 다른 파일시스템 버그의 증상일 수도 있으니, 끝나지 않는 pid 네임스페이스가 있으면 이 점을 살펴보라고 권합니다. 대규모로 컨테이너를 돌리며 만나는 낯선 문제 중 작은 맛보기라는 말과 함께, 헛다리와 커널 데드락을 좋아하는 사람을 채용한다는 문구로 글이 끝납니다.
