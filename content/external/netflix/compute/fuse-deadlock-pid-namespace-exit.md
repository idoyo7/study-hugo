---
title: "SIGKILL 뒤에도 끝나지 않던 FUSE 데드락 추적"
description: "SIGKILL을 보낸 뒤에도 컨테이너가 종료되지 않은 이유는 무엇일까요? Netflix가 /proc과 커널 코드로 찾아낸 원인은 이미 종료 중인 스레드가 죽은 FUSE 데몬의 응답을 기다리는 데드락이었습니다."
date: 2026-11-14
weight: 9
---

# SIGKILL 뒤에도 끝나지 않던 FUSE 데드락 추적 (2023-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Debugging a FUSE deadlock in the Linux kernel](https://netflixtechblog.com/debugging-a-fuse-deadlock-in-the-linux-kernel-c75cd7989b6d)
- 매체 · 게시일: Netflix TechBlog · 2023-05-19
- 저자: Tycho Andersen
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 8,817분째 돌아오지 않은 Docker 호출 {#symptom}

컨테이너를 죽이라는 요청이 끝나지 않았습니다. 고루틴 덤프에는 Titus 실행기의 `Kill`이 종료 처리 도중 호출한 `ContainerInspect`가 Docker unix 소켓의 HTTP 왕복 요청에서 약 8,817분째 기다리고 있었습니다. 컨테이너를 종료하는 데 쓰는 시그널은 SIGKILL입니다. 거의 언제나 프로세스를 끝내야 할 시그널을 보냈는데도 `docker kill`이 멈춘 상태였습니다.

Netflix Compute 팀은 오토스케일링부터 컨테이너 배포와 문제 복구까지 AWS와 컨테이너 워크로드 전반을 관리합니다. Tycho Andersen은 그중 사용자가 신고한 이상한 문제를 고치는 일을 맡고 있었습니다. 사내 FUSE 파일시스템 ndrive와 얽힌 이 문제도 한동안 해결되지 않은 채 남아 있다가, 작정하고 들여다볼 차례가 됐습니다.

컨테이너 안으로 들어가는 것부터 실패했습니다. `docker exec`를 실행하면 setns 프로세스가 상태 1로 끝났다는 OCI 런타임 오류가 나왔습니다. 컨테이너가 살아 있는 듯한데 setns(2)는 실패한 것입니다. `ps`로 본 프로세스 트리에는 containerd-shim 아래 docker-init이 있었고, 그 자식으로 ndrive 하나가 `<defunct>` 상태로 남아 있었습니다.

init의 `/proc/<pid>/stack`은 `zap_pid_ns_processes` 안에서 `kernel_wait4`를 호출한 뒤 기다리는 중이었습니다. init도 이미 종료 경로에 들어와 있었습니다. 유일한 자식이 이미 실행을 끝내고 부모가 `wait()`로 거두기만을 기다리는 좀비라면, 커널은 무엇을 더 기다리고 있었을까요?

프로세스 표시만으로는 보이지 않는 스레드가 남아 있었습니다. ndrive의 `task` 디렉터리에는 스레드가 둘 있었고, 좀비인 것은 하나뿐이었습니다. 다른 스레드의 스택을 따라가면 `do_exit`에서 `put_files_struct`, `filp_close`, `fuse_flush`, `fuse_simple_request`를 거쳐 FUSE의 `request_wait_answer`에 닿습니다. 이 스레드 역시 열심히 종료하려는 중이었지만, 파일을 닫다가 FUSE 안에서 멈췄습니다.

## 응답할 데몬을 잃은 FUSE의 flush {#signal-delivery}

데드락을 만든 것은 종료 순서였습니다. FUSE 파일을 열고 닫지 않은 작업이 종료하면, `do_exit()`은 먼저 `exit_signals(tsk)`를 호출해 작업에 `PF_EXITING` 플래그를 설정합니다. 이미 종료 중이라는 표시입니다. 이어서 `exit_files(tsk)`가 아직 열린 파일을 정리하는데, 이때 파일을 flush하다가 FUSE의 응답을 기다리게 됐습니다.

그 사이 pid 네임스페이스도 종료에 들어갔습니다. `zap_pid_ns_processes()`는 남은 프로세스들에게 SIGKILL을 보내고 모두 끝나기를 기다립니다. 이 시그널로 같은 pid 네임스페이스 안의 FUSE 데몬이 죽었습니다. 이제 flush 요청에 답할 상대가 없습니다.

기다리는 스레드에도 SIGKILL이 왔지만 대기는 끝나지 않았습니다. 커널은 이미 `PF_EXITING`이 설정된 스레드를 시그널을 전달하려고 깨울 대상에서 제외했기 때문입니다. init은 스레드의 종료를 기다리고, 스레드는 죽은 데몬의 응답을 기다렸습니다. FUSE 연결을 수동으로 abort하지 않으면 이 상태는 영원히 이어집니다.

여기까지가 원인을 찾은 뒤 재구성한 종료 순서입니다. 하지만 당시 `/proc`에 남아 있던 것은 멈춘 스택과 전달되지 않은 SIGKILL뿐이었습니다. 그 흔적에서 이 순서에 도달하려면, 커널이 누구를 기다리고 누구에게 시그널을 전달하는지 더 따라가야 했습니다.

## 좀비 상태의 pid 네임스페이스 {#kernel-wait}

`docker exec`가 실패한 이유부터 커널 코드에서 드러났습니다. `zap_pid_ns_processes()`는 자식들을 기다리기 전에 `disable_pid_allocation`을 호출해 pid 네임스페이스에 새 프로세스가 들어오지 못하게 합니다. 이어서 좀비 자식을 거두고, 더는 자식이 없다는 ECHILD가 돌아올 때까지 `kernel_wait4`를 반복합니다. 들어갈 수는 없고 종료도 끝나지 않은, 좀비 같은 네임스페이스였습니다.

FUSE 쪽의 대기 조건도 분명했습니다. `request_wait_answer`는 `wait_event`에서 `FR_FINISHED` 플래그가 설정되기를 기다립니다. 유저 공간에서 flush 요청에 답해야 이 조건이 충족됩니다. 데몬이 죽은 뒤에는 올 수 없는 응답이었습니다.

그런데 스레드의 status 파일에는 SIGKILL도 남아 있었습니다. 공유 대기 시그널을 나타내는 `ShdPnd` 값에 `0x100`, 즉 아홉 번째 비트가 설정돼 있었습니다. 커널이 시그널을 만들었지만 아직 유저 공간에 전달하지 않은 pending 상태입니다.

시그널은 시스템 콜에 들어가거나 나올 때, 이벤트를 기다릴 때처럼 정해진 시점에 전달됩니다. 차단된 시그널도 pending 집합에 남을 수 있지만, `man 7 signal`에는 SIGKILL과 SIGSTOP을 잡거나 차단하거나 무시할 수 없다고 적혀 있습니다. 여기서는 SIGKILL이 분명히 대기 중인데도 작업이 끝나지 않았습니다. 자연스럽게 의심은 커널의 시그널 처리로 향했습니다.

## 공유 pending 집합에서 길어진 헛다리 {#red-herring}

처음에는 커널의 wait 코드가 SIGKILL을 알아볼 것이라고 생각했습니다. `include/linux/wait.h`의 코드는 세마포어, 대기 큐, completion 등 커널 곳곳에서 쓰입니다. 그러나 실제 호출에 어떤 대기 상태가 쓰였는지부터 확인해야 했습니다.

매크로를 풀면 `___wait_event`는 루프 안에서 `prepare_to_wait_event()`를 호출하고 조건을 검사합니다. 조건이 참이면 빠져나옵니다. 시그널로 중단할 수 있는 대기 상태에서 중단 오류가 돌아왔으면 그 오류를 반환하고, 어느 쪽도 아니면 `cmd`, 여기서는 `schedule()`을 실행해 기다립니다.

`prepare_to_wait_event()`가 -ERESTARTSYS를 반환하는 것은 `signal_pending_state()`가 참일 때뿐입니다. 그런데 이곳은 일반 `wait_event()` 호출이라 대기 상태가 `TASK_UNINTERRUPTIBLE`이었습니다. `signal_pending_state()`는 상태에 `TASK_INTERRUPTIBLE`이나 `TASK_WAKEKILL`이 없으면 0을 돌려줍니다. pending 시그널을 확인하기도 전에 이 검사에서 탈락한 것입니다.

시그널이 기록된 위치도 수상해 보였습니다. `signal_pending()`은 이 문제와 무관한 `TIF_NOTIFY_SIGNAL`을 검사한 뒤 `task_sigpending()`을 부르고, 이 함수는 스레드의 `TIF_SIGPENDING` 플래그를 확인합니다. SIGKILL을 보냈다면 이 플래그도 설정돼 있어야 한다는 생각으로, 저자는 시그널을 보내는 쪽까지 거슬러 올라갔습니다.

`zap_pid_ns_processes()`의 호출은 `group_send_sig_info(SIGKILL, SEND_SIG_PRIV, task, PIDTYPE_MAX)`였습니다. 여기서 `__send_signal_locked()`까지 따라가면, 전송 유형이 `PIDTYPE_PID`가 아닐 때 시그널을 `shared_pending`에 넣고 `complete_signal()`을 호출합니다. `PIDTYPE_MAX`에는 대략 커널이 특권을 가지고 보내는 시그널이니 반드시 전달하라는 뜻이 있습니다. 그런데 이 선택 때문에 SIGKILL은 작업 자신의 pending 집합 대신 공유 집합에 들어갔습니다. 치명적인 시그널을 확인하는 `__fatal_signal_pending()`은 작업 자신의 집합에서만 SIGKILL을 찾았습니다.

그럴듯한 단서였지만 헛다리였습니다. `complete_signal()`의 뒤쪽에는 SIGKILL을 작업 자신의 pending 집합에도 무조건 추가하는 코드가 있었습니다. 공유 집합에 들어갔다는 사실만으로는 설명이 끝나지 않습니다. 문제는 그 코드에 도달하기 전에 있었습니다.

`complete_signal()`은 먼저 깨울 스레드를 고릅니다. 메인 스레드가 `wants_signal()`에서 시그널을 원한다고 답하면 우선권을 받습니다. 그렇지 않은데 스레드가 하나뿐이거나 전송 유형이 `PIDTYPE_PID`이면 함수는 돌아갑니다. 그 스레드가 다시 실행되기 전에 차단되지 않은 시그널을 큐에서 꺼낼 것이므로, 따로 깨울 필요가 없다는 동작입니다.

커널 메일링 리스트에서 Eric Biederman은 사실상 모든 스레드가 언제든 SIGKILL을 처리할 수 있다고 설명했습니다. 그러나 `wants_signal()`의 검사 순서에는 단서가 있었습니다. 이 함수는 시그널이 차단돼 있거나 스레드에 `PF_EXITING`이 설정돼 있으면 먼저 거짓을 반환합니다. 그 검사를 지나야 SIGKILL에 참을 반환하고, 다른 시그널에는 정지·추적 상태 등의 규칙을 적용합니다.

이미 종료 중인 스레드는 SIGKILL 여부를 확인하는 곳까지 가지 못했습니다. 앞에서 파일을 정리하기 전에 설정한 `PF_EXITING`이 바로 그 조건이었습니다. 시그널이 어느 집합에 기록됐는지 한참 추적한 끝에, 원인은 시그널을 받을 스레드를 고르는 단계에서 드러났습니다.

## 반환값을 받을 작업이 없는 flush {#solution}

해법은 이 경우에 기다리지 않는 것이었습니다. 작업은 이미 죽어 가는 중이고, flush()가 반환할 코드를 받아 볼 상대도 없습니다. 응답을 끝까지 기다려야 할 이유가 없었던 것입니다. FUSE 수정은 4월 23일에 배포된 Linux 6.3에 포함됐습니다.

문제가 생길 수 있는 범위는 FUSE보다 넓습니다. flush() 안에서 커널의 wait 코드를 호출하는 파일시스템이라면 같은 상황을 만날 수 있습니다. 로컬 커널 밖의 무언가와 통신하는 거의 모든 파일시스템이 여기에 해당합니다. 글이 쓰인 시점에는 파일시스템마다 개별 패치가 필요한 상태였습니다.

저자는 nfs 코드 등에도 같은 문제가 분명히 있다고 봤습니다. 아직 프로덕션에서 겪지 않았지만 거의 틀림없이 마주칠 것이라는 전망이었습니다. FUSE에서 찾은 이 증상은 다른 파일시스템 버그의 단서일 수도 있습니다. SIGKILL 뒤에도 끝나지 않는 pid 네임스페이스가 그 흔적입니다.
