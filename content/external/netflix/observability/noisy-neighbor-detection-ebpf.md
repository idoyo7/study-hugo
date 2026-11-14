---
title: "Titus의 noisy neighbor를 추적하는 eBPF"
description: "컨테이너의 CPU 대기가 길어질 때 이웃의 영향인지 어떻게 확인할까요? Netflix는 Titus에서 eBPF로 대기 시간과 선점 원인을 상시 기록해 noisy neighbor와 CPU 쿼터의 영향을 구분합니다."
date: 2026-11-14
weight: 5
---

# Titus의 noisy neighbor를 추적하는 eBPF (2024-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Noisy Neighbor Detection with eBPF](https://netflixtechblog.com/noisy-neighbor-detection-with-ebpf-64b1f4b3bbdd)
- 매체 · 게시일: Netflix TechBlog · 2024-09-10
- 저자: Jose Fernandez, Sebastien Dabdoub, Jason Koch, Artem Tkachuk
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 10시 35분에 길어진 Titus의 CPU 대기 {#story}

서버에는 CPU 여유가 충분했습니다. Netflix의 멀티테넌트 컴퓨트 플랫폼 Titus에서 컨테이너 하나만 실행 중일 때, 프로세스가 스케줄링 큐에서 CPU를 기다리는 시간인 run queue latency의 p99는 평균 83.4µs였습니다. 가끔 400µs까지 튀는 정도였습니다.

10시 35분, 호스트의 모든 CPU를 쓰는 두 번째 컨테이너를 띄웠습니다. 첫 컨테이너의 p99 대기 시간이 131ms(131,000µs) 늘었습니다. HTTP 요청을 처리하는 애플리케이션이라면 드러날 만한 지연입니다.

## perf를 붙이기에는 늦은 성능 조사 {#background}

Netflix의 Compute and Performance Engineering 팀은 성능 문제를 조사할 때 애플리케이션과 인프라 중 어디에 원인이 있는지 먼저 확인합니다. 이 구분을 어렵게 만드는 단골 원인이 noisy neighbor입니다. 서버 자원을 심하게 써서 옆 컨테이너의 성능을 떨어뜨리는 컨테이너나 시스템 서비스를 뜻합니다. CPU가 가장 흔한 원인이어서 이번 계측도 CPU에 집중했습니다.

문제가 터진 뒤에 조사 도구를 붙이면 늦습니다. perf 같은 도구는 보통 그때 배포하는 데다, 계측 오버헤드가 성능 문제를 더 악화시킬 수도 있습니다. 디버깅에는 저수준 지식과 전용 도구까지 필요했습니다. Netflix가 택한 방법은 eBPF로 Linux 스케줄러를 낮은 오버헤드로 상시 계측하는 것입니다. 사용자가 직접 이웃의 영향을 확인할 수 있게 하려는 선택이었습니다.

## 대기 시간과 함께 읽는 선점의 원인 {#signals}

컨테이너가 할당된 CPU를 다 쓰지도 않는데 큐에서 오래 기다린다면 문제가 있다는 신호입니다. Netflix는 이 시간을 `runq.latency`라는 percentile 타이머로 기록합니다. 여기에 선점 횟수를 세는 `sched.switch.out` 카운터를 함께 봅니다. 선점 원인은 같은 컨테이너 안의 프로세스, 다른 컨테이너, 시스템 서비스로 구분합니다.

대기 시간만 높다고 이웃을 지목할 수는 없습니다. 컨테이너가 cgroup CPU 한도에 닿거나 넘으면 스로틀링 때문에 대기가 길어지기도 합니다. 이때의 지연 급증은 CPU 쿼터의 영향입니다. 두 메트릭이 함께 치솟고 선점의 주된 원인이 다른 컨테이너나 시스템 프로세스라면 noisy neighbor를 명확히 가리킵니다.

10시 35분의 사례에서도 선점 기록이 원인을 드러냈습니다. `sched.switch.out`이 보여 준 것은 시스템 프로세스에 의한 선점 증가였습니다. 컨테이너와 CPU를 다투던 시스템 서비스가 noisy neighbor였던 것입니다. Netflix는 두 번째 컨테이너가 호스트의 CPU를 모두 사용한 일이 이 경쟁을 촉발했을 가능성이 높다고 보았습니다.

## 스케줄러에서 Atlas까지 이어지는 계측 {#instrumentation}

대기 시간을 구하려면 큐에 들어간 시각부터 알아야 합니다. 프로세스가 잠든 상태에서 실행 가능한 상태로 바뀔 때 `sched_wakeup`과 `sched_wakeup_new` 훅이 실행되며, eBPF 프로그램은 PID를 키로 하는 해시 맵 `runq_enqueued`에 시각을 저장합니다. 이미 항목이 있으면 덮어쓰지 않습니다.

CPU가 다른 프로세스로 전환할 때는 `sched_switch` 훅이 실행됩니다. 이 훅은 이전·다음 프로세스의 포인터를 제공하므로, 다음 프로세스의 PID로 저장해 둔 시각을 찾습니다. 현재 시각에서 그 값을 빼면 큐에서 기다린 시간이 나옵니다. 계산한 뒤에는 항목을 지우고, 큐 진입 기록이 없으면 그대로 반환합니다.

이제 프로세스를 컨테이너와 연결해야 합니다. eBPF는 실제 커널 task 구조체의 포인터를 제공하지만, 그 안의 cgroup 포인터는 RCU로 보호됩니다. Netflix는 eBPF에서 호출할 수 있는 커널 함수인 kfunc `bpf_rcu_read_lock`과 `bpf_rcu_read_unlock`으로 읽기 구간을 열고 닫아 cgroup ID를 안전하게 얻었습니다.

이벤트에는 이전·다음 프로세스의 cgroup ID, 대기 시간, 타임스탬프를 담아 eBPF ring buffer로 userspace에 보냅니다. ring buffer는 가변 길이 레코드를 지원하고 추가 복사나 시스템 콜도 필요 없지만, 이벤트가 워낙 많았습니다. 이를 읽는 userspace 프로그램이 CPU를 너무 많이 썼습니다. 그래서 eBPF 안에 속도 제한을 넣었습니다. CPU별 해시 맵에 cgroup ID와 마지막 이벤트 시각을 저장하고, `RATE_LIMIT_NS`만큼의 간격이 지나지 않았으면 이벤트를 버립니다.

Go로 작성한 userspace 프로그램은 ring buffer를 읽어 메트릭 백엔드 Atlas로 내보냅니다. cgroup ID를 호스트의 컨테이너와 연결하고, 일치하는 컨테이너가 없으면 시스템 서비스로 분류합니다. 이전·다음 cgroup ID를 함께 알기 때문에 선점 원인도 태그로 붙입니다.

이 메트릭은 고객 대시보드에 통합됐습니다. 사용자가 성능 문제의 원인을 확인하고 멀티테넌시 성능을 논의할 근거가 생겼습니다. Netflix는 이 데이터가 CPU 격리 전략을 다듬는 데도 도움이 될 것으로 기대합니다.

## bpftop으로 확인한 eBPF 훅의 비용 {#optimization}

계측 코드는 커널의 핫패스에서 실행됩니다. Netflix는 여기에 더해지는 비용을 측정하려고 오픈소스 eBPF 프로세스 모니터링 도구 bpftop을 만들었습니다. 최적화 과정에서는 직접 비교해 봐야 알 수 있는 차이도 나왔습니다.

큐 진입 시각을 저장할 때는 `BPF_MAP_TYPE_HASH`가 가장 빨랐습니다. `BPF_MAP_TYPE_TASK_STORAGE`는 거의 두 배 느렸고, 예상과 달리 `BPF_MAP_TYPE_PERCPU_HASH`도 `BPF_MAP_TYPE_HASH`보다 조금 느렸습니다. CPU별 맵이 더 느린 이유는 추가로 조사할 과제로 남았습니다.

처음부터 일반 해시 맵을 쓴 것은 아닙니다. PID가 계속 바뀌는 점을 고려해 `BPF_MAP_TYPE_LRU_HASH`를 선택했지만, 일반 해시 맵보다 연산당 40~50ns가 더 들었습니다. 결국 크기를 늘린 `BPF_MAP_TYPE_HASH`를 사용했습니다.

구조체를 읽는 비용도 줄였습니다. `BPF_CORE_READ`는 호출당 20~30ns가 들지만, BTF가 켜진 raw tracepoint(`tp_btf/*`)에서는 task 구조체 멤버를 직접 읽어도 안전하고 더 빠릅니다. PID 0인 커널 태스크에는 조기 종료 조건을 넣었습니다. 이 태스크도 일반 프로세스처럼 스케줄러 큐를 거쳐 훅이 실행되지만, 모니터링할 대상이 아니므로 맵 접근 같은 비싼 작업을 생략했습니다.

bpftop으로 측정한 결과, 각 `sched_*` 훅에 더해지는 시간은 600ns 미만이었습니다. 컨테이너에서 실행하는 Java 서비스에서도 run queue 프로파일링을 켰을 때와 껐을 때의 차이가 밀리초 단위로는 측정되지 않았습니다. 커널이 eBPF 통계를 계산하는 방식을 살피다가 개선할 부분을 찾아 패치를 제출했고, 이 패치는 Linux 6.10에 포함됐습니다.

Netflix는 앞으로 관측 기능과 비즈니스 로직이 더 많이 eBPF로 옮겨갈 것으로 기대합니다. 워크로드에 맞춰 스케줄링 결정을 내리는 방식을 바꿀 가능성이 있는 프로젝트로는 sched_ext를 꼽았습니다.

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
