---
title: "eBPF로 잡는 noisy neighbor"
description: "Netflix가 Titus의 멀티테넌트 환경에서 컨테이너별 run queue latency를 eBPF로 상시 측정해 noisy neighbor를 가려내는 방법을 정리했습니다. 훅 구성과 오버헤드를 줄인 최적화 결과를 요약합니다."
date: 2026-11-14
weight: 5
---

# eBPF로 잡는 noisy neighbor (2024-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Noisy Neighbor Detection with eBPF](https://netflixtechblog.com/noisy-neighbor-detection-with-ebpf-64b1f4b3bbdd)
- 매체 · 게시일: Netflix TechBlog · 2024-09-10
- 저자: Jose Fernandez, Sebastien Dabdoub, Jason Koch, Artem Tkachuk
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 문제 배경 {#background}

Netflix의 Compute and Performance Engineering 팀은 멀티테넌트 환경의 성능 문제를 자주 조사합니다. 첫 단계는 원인이 애플리케이션인지 아래쪽 인프라인지 가르는 일이고, 이를 어렵게 만드는 단골 원인이 noisy neighbor입니다. 멀티테넌트 컴퓨트 플랫폼 Titus에서는 서버 자원을 심하게 쓰며 옆 컨테이너의 성능을 떨어뜨리는 컨테이너나 시스템 서비스를 가리킵니다. 워크로드에서 가장 흔한 원인이 CPU라 CPU에 집중합니다.

noisy neighbor의 영향은 잡아내기가 까다롭습니다. perf 같은 전통적인 도구는 오버헤드가 커서 성능을 더 떨어뜨릴 수 있고, 보통 문제가 터진 뒤에 배포하므로 조사하기에는 늦습니다. 디버깅에는 저수준 전문 지식과 전용 도구도 필요합니다. 원문은 eBPF로 Linux 스케줄러를 낮은 오버헤드로 상시 계측해, 사용자가 직접 noisy neighbor를 확인하는 방법을 소개합니다.

## 스케줄러 상시 계측 {#instrumentation}

계측 대상은 컨테이너별 run queue latency입니다. 프로세스가 CPU에 오르기 전에 스케줄링 큐에서 기다린 시간으로, 컨테이너가 할당된 CPU를 다 쓰지 않는데도 길어지면 성능 문제의 신호입니다. 이 값을 내려고 eBPF 훅 세 개를 씁니다.

- `sched_wakeup`, `sched_wakeup_new`: 프로세스가 sleeping에서 runnable로 바뀔 때 호출됩니다. 이 시점에 타임스탬프를 만들어 PID를 키로 하는 eBPF 해시 맵에 저장합니다.
- `sched_switch`: CPU가 다른 프로세스로 전환될 때 호출됩니다. 이전·다음 프로세스의 포인터가 오므로 다음 프로세스의 PID로 맵에서 큐에 들어간 시각을 꺼내 현재 시각과의 차이로 지연을 구하고 항목을 지웁니다.

컨테이너와 연결하려면 프로세스의 cgroup ID가 필요한데, task 구조체의 cgroup 정보는 RCU 락으로 보호됩니다. eBPF에서 호출할 수 있는 커널 함수인 kfunc `bpf_rcu_read_lock`과 `bpf_rcu_read_unlock`으로 RCU 읽기 구간을 안전하게 열고 닫으며 cgroup ID를 읽습니다.

데이터는 eBPF ring buffer로 userspace에 보냅니다. 효율이 좋고 가변 길이 레코드를 지원하며 추가 메모리 복사나 시스템 콜이 필요 없습니다. 다만 데이터 양이 너무 많아 userspace 프로그램의 CPU 사용량이 높아졌고, 그래서 eBPF 안에 cgroup별·CPU별 속도 제한을 넣어 일정 간격 안의 이벤트를 버리는 샘플링을 했습니다.

Go로 쓴 userspace 프로그램이 ring buffer의 이벤트를 읽어 메트릭 백엔드 Atlas로 내보냅니다. cgroup ID가 호스트의 컨테이너와 맞으면 그 컨테이너의 percentile 타이머 `runq.latency`를 기록하고, 맞는 컨테이너가 없으면 시스템 서비스로 분류합니다. 선점 횟수를 세는 카운터 `sched.switch.out`도 올립니다. 선점당한 프로세스의 cgroup ID를 알 수 있으니 이 메트릭에는 원인 태그를 달 수 있습니다. 같은 컨테이너 안의 프로세스인지, 다른 컨테이너인지, 시스템 서비스인지 구분합니다.

noisy neighbor 판정에는 두 메트릭이 모두 필요합니다. `runq.latency`만 보면 오해하기 쉽습니다. 컨테이너가 cgroup CPU 한도에 닿거나 넘으면 스케줄러가 스로틀링하며 큐 대기가 늘어 지연이 튀는데, 이때는 이웃 탓이 아니라 CPU 쿼터에 걸린 것입니다. 반면 두 메트릭이 함께 튀고 원인이 다른 컨테이너나 시스템 프로세스라면 noisy neighbor로 볼 수 있습니다.

## 실제 사례 {#story}

컨테이너 하나만 있고 CPU 여유가 충분한 서버의 `runq.latency` p99는 평균 83.4µs이고 가끔 400µs까지 튀었습니다. 이것이 기준선입니다. 10시 35분에 호스트의 모든 CPU를 쓰는 두 번째 컨테이너를 띄우자 첫 컨테이너의 p99가 131ms(131,000µs)로 치솟았습니다. HTTP 트래픽을 처리하는 앱이라면 사용자 공간에서도 보일 만한 값입니다. 앱 소유자가 원인 모를 지연 급증을 제보하면 이 메트릭으로 noisy neighbor를 곧바로 확인할 수 있습니다.

`sched.switch.out`은 이 급증이 시스템 프로세스의 선점 증가에서 왔다고 보여 줍니다. 컨테이너와 CPU를 다투는 시스템 서비스가 noisy neighbor였고, 두 번째 컨테이너가 CPU를 다 쓴 일이 계기였을 가능성이 높다고 원문은 해석합니다.

## eBPF 코드 최적화 {#optimization}

커널 핫패스에서 도는 코드라 오버헤드를 재야 했고, 이를 위해 오픈소스 eBPF 프로세스 모니터링 도구 bpftop을 만들었습니다. bpftop 프로파일링에서 각 `sched_*` 훅에 더해지는 시간은 600ns 미만이었습니다. 컨테이너에서 도는 Java 서비스로 성능을 분석했을 때도 run queue 프로파일링 코드를 켠 상태와 끈 상태의 차이는 밀리초 단위로 측정되지 않았습니다. 커널이 eBPF 통계를 계산하는 방식을 조사하다 개선할 부분을 찾아 패치를 보냈고, Linux 커널 6.10에 들어갔습니다.

시행착오로 찾은 최적화는 다음과 같습니다.

- 큐 진입 시각 저장에는 `BPF_MAP_TYPE_HASH`가 가장 빨랐습니다. `BPF_MAP_TYPE_TASK_STORAGE`는 성능이 거의 두 배 나빠졌고, `BPF_MAP_TYPE_PERCPU_HASH`는 `HASH`보다 약간 느렸는데 원문은 예상 밖이라 더 조사가 필요하다고 적습니다.
- `BPF_MAP_TYPE_LRU_HASH`는 연산당 40~50ns 느립니다. PID가 빠르게 재사용되는 공간 문제 때문에 처음에는 LRU를 썼지만, 결국 크기를 키운 `BPF_MAP_TYPE_HASH`로 위험을 줄였습니다.
- `BPF_CORE_READ` 헬퍼는 호출당 20~30ns가 듭니다. BTF가 켜진 raw tracepoint(`tp_btf/*`)에서는 task 구조체 멤버를 직접 읽는 편이 안전하고 효율적입니다.
- 세 훅은 PID 0인 커널 태스크에서도 호출됩니다. 이 태스크는 모니터링할 필요가 없어, 조기 종료 조건을 넣어 맵 접근 같은 비싼 작업을 건너뜁니다. 커널 태스크도 일반 프로세스처럼 스케줄러 큐를 거칩니다.

## 결론과 앞으로 {#conclusion}

이 메트릭은 고객 대시보드에 통합돼 실행 가능한 인사이트를 주고 멀티테넌시 성능 논의의 근거가 됩니다. CPU 격리 전략을 다듬어 noisy neighbor의 영향을 줄이는 데도 쓸 수 있고, Linux 스케줄러에 대한 이해도 깊어졌다고 합니다. 원문은 eBPF 도입이 늘면 인프라 관측과 비즈니스 로직이 더 eBPF로 옮겨 가리라 보고, 스케줄링 결정을 워크로드에 맞추게 할 가능성이 있는 프로젝트로 sched_ext를 꼽습니다.

{{% details title="원문의 주요 수치와 설정값" closed="true" %}}

| 항목 | 값 |
|---|---|
| 사용 훅 | `sched_wakeup`, `sched_wakeup_new`, `sched_switch` |
| 메트릭 | `runq.latency`(percentile 타이머), `sched.switch.out`(카운터) |
| 기준선 p99 | 평균 83.4µs, 최대 약 400µs |
| 사례의 급증 | p99 131ms |
| 훅당 추가 지연 | 600ns 미만 |
| LRU 해시 맵 | 일반 해시보다 연산당 40~50ns 느림 |
| BPF_CORE_READ | 호출당 20~30ns |
| TASK_STORAGE 맵 | 성능 약 2배 저하 |
| 커널 패치 | Linux 6.10에 포함 |

{{% /details %}}
