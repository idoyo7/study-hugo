---
title: "gVisor"
linkTitle: "03 gVisor"
weight: 3
date: 2026-09-14
lastmod: 2026-09-14
---

# 03 · gVisor — 커널을 다시 쓴 샌드박스가 얻는 것과 못 하는 것

{{< callout type="info" >}}
- **호스트 커널 임의 코드 실행에 이르는 완전 탈출 CVE는 확인되지 않는다** — 공개 CVE·advisory를 뒤진 이 조사 범위에서의 부재 확인이다 `✓`.
- **amd64 syscall 351개 중 277개가 구현돼 있다** — 완전 호환이 아니라 넓은 부분 호환이다 `✓`.
- **모델 제공자는 gVisor, 인프라 판매자는 마이크로 VM을 고른다** — Anthropic·OpenAI·Modal은 gVisor, E2B·Fly.io는 Firecracker, Northflank·Ant Group은 Kata다 `Σ`.
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

Kata가 파드 아래 진짜 VM을 세운다면, gVisor는 커널을 유저스페이스에서 다시 구현해 애플리케이션과 호스트 커널 사이에 끼워 넣습니다. [01 경계와 위협 모델]({{< relref "../01-boundaries/index.md" >}})에서 이미 이 접근을 한 번 스쳐 지나갔지만, 이 편은 gVisor 하나에 집중해 그 구조가 호환성과 성능과 보안에서 각각 무엇을 내주는지 봅니다.

핵심은 하드웨어 가상화가 아니라 **syscall 인터포지션**입니다. 진짜 리눅스 커널을 게스트에 넣는 대신, 애플리케이션이 커널에 요청을 보내는 지점 자체를 가로챕니다. 그래서 호환성 구멍이 남고, 그 구멍이 어디서 얼마나 벌어지는지가 이 편의 주제입니다.

자매 문서: 세 물건의 경계와 위협 모델은 [01 경계와 위협 모델]({{< relref "../01-boundaries/index.md" >}})에, Kata는 [02 Kata Containers]({{< relref "../02-kata/index.md" >}})에, KubeVirt는 [04 KubeVirt]({{< relref "../04-kubevirt/index.md" >}})에, 성능 실측은 [05 성능 실측]({{< relref "../05-performance/index.md" >}})에, 시나리오별 판단은 [06 판단]({{< relref "../06-decision/index.md" >}})에 있습니다.

## 1. Sentry와 Gofer — 유저스페이스에서 커널을 다시 쓰다

핵심은 **Sentry**입니다. Go로 쓰인 프로세스가 리눅스 syscall ABI의 상당 부분을 사용자 공간에서 재구현해, 애플리케이션의 syscall을 가로채 호스트 커널에 닿지 않게 합니다. 파일시스템 접근은 별도 **Gofer** 프로세스가 대리합니다 `✓`.

syscall을 가로채는 방식, 즉 플랫폼은 셋입니다 `✓`. **ptrace**는 컨텍스트 스위치 비용이 크고 현재는 지원이 종료된 상태입니다. **KVM**은 Sentry가 게스트 커널이자 VMM 역할을 겸해 베어메탈에서 유리합니다. **systrap**은 seccomp의 `SECCOMP_RET_TRAP`으로 `SIGSYS`를 받아 처리하는 방식으로, "ptrace와 비슷하되 빠르다"는 게 프로젝트의 설명입니다. systrap 발표는 2023-04-28이고 그 무렵부터 기본 플랫폼이 됐습니다 `✓`.

## 2. 호환성의 대가

자동 생성 표 기준으로 amd64는 351개 syscall 중 **277개**, arm64는 294개 중 **250개**가 완전 또는 부분 구현입니다 `✓`. 미구현이라고 곧장 애플리케이션이 깨지는 건 아닙니다. 런타임과 libc에 폴백 경로가 있기 때문입니다 `✓`. 다만 raw socket 기본 차단, `PACKET_RX_RING` 계열, GPU·드라이버 의존 워크로드, io_uring 의존 워크로드가 문제 영역으로 반복 거론됩니다 `≈`. 권위 있는 단일 목록 문서는 찾지 못했고, 각 워크로드가 걸리는지는 실제로 돌려봐야 확인되는 경우가 많습니다 `?`.

## 3. 보안 실적 — 탈출이 아니라 국지전

gVisor 보안 페이지는 목표를 Sentry와 기존 리눅스 하드닝(seccomp-bpf, `pivot_root`, namespace)의 2중 구조로 호스트 커널 공격 표면을 줄이는 것이라고 밝힙니다 `✓`. 샌드박스 **내부**에 머무는 권한 상승이나 DoS는 CVE 대상에서 명시적으로 제외합니다 `✓`.

확인된 CVE는 넷입니다. CVE-2018-16359는 seccomp 샌드박스 안에서 `renameat`을 허용해 호스트 파일 이름을 바꿀 수 있었던, 실제 경계를 넘은 사례입니다 `✓`. CVE-2024-10603(CVSS 5.3)과 CVE-2024-10026은 각각 netstack의 예측 가능한 포트·헤더 값과 TCP 스택의 약한 해시 문제였습니다 `✓`. CVE-2025-2713(CVSS4 6.8, 2025-03-28)은 `runsc`가 첫 fork 전까지 root 유사 권한으로 실행돼 생긴 로컬 권한 상승입니다 `✓`.

**호스트 커널 임의 코드 실행에 이르는 완전 탈출 CVE는 찾지 못했습니다**(부재 확인 `✓`). 반대 방향 사례도 있습니다. CVE-2020-14386(리눅스 패킷 링 버퍼 오버플로)은 gVisor가 `PACKET_RX_RING`을 구현하지 않고 raw socket을 기본 차단해 애초에 영향받지 않은 구조적 회피 사례입니다 `✓`. 쿠버네티스에서는 RuntimeClass handler가 `runsc`이고 containerd 쪽 shim은 `containerd-shim-runsc-v1`입니다 `✓`.

Kata의 위협 모델과 나란히 놓으면 표면 자체가 다릅니다. [01 경계와 위협 모델]({{< relref "../01-boundaries/index.md" >}})에서 본 Kata의 2026년 advisory 10건 중 3건은 호스트가 pod annotation을 신뢰하는 설계에서 비롯됐습니다. gVisor에는 그 계열의 표면이 아예 없습니다. virtio 장치 에뮬레이션도, annotation을 읽어 하이퍼바이저를 구성하는 shim도 존재하지 않기 때문입니다 `Σ`. 대신 gVisor는 리눅스 ABI 전체를 재구현한 코드 자체가 표면이 됩니다. Sentry나 Gofer 코드에 버그가 있으면 그 버그가 곧 가로채는 syscall의 정확성 문제가 되고, 그 결과가 CVE-2018-16359 같은 경계 탈출로 나타납니다 `Σ`.

## 4. 성능 — 반전이 시작되는 자리

gVisor의 syscall 지연이 이 시리즈에서 가장 중요한 반례를 냅니다. gVisor 공식 측정(GCE n1-standard-4, Debian 9)에서 syscall 지연은 runc 1,939ns 대비 ptrace 38,219ns(19.7배)로 벌어지지만, **KVM 플랫폼은 763ns로 runc보다 오히려 빠릅니다** `Ⓥ`. Sentry가 게스트 링0에서 syscall을 자체 처리해 호스트 커널 진입 자체가 없기 때문입니다. "격리 기술의 비용은 기술 자체가 아니라 구현 경로가 정한다"는 이 시리즈의 핵심 반전이 여기서 나옵니다. HotCloud '19의 gettimeofday 100M회 평균 지연도 같은 방향입니다 — native 0.22µs, runc 0.29µs(1.32배)인 데 비해 gVisor의 가장 빠른 경로(KVM + Sentry 내부 처리)도 0.63µs(2.86배)에 그치지만, KVM에서 호스트 호출을 거치면 5.96µs(27배), Gofer를 거치면 45.5µs(207배)까지 벌어집니다 `Ⓑ`. 이 축의 차트는 [05 성능 실측]({{< relref "../05-performance/index.md" >}}) 2장에 있습니다.

애플리케이션 레벨로 올라가면 격차는 워크로드 성격에 따라 7%에서 500%까지 흔들립니다. gVisor 공식 데이터가 이 폭을 그대로 보여줍니다 `Ⓥ`.

| 워크로드 | runc | gVisor | 비율 |
|---|---|---|---|
| ffmpeg run_time | 82.00s | 88.24s | 1.076배 |
| TensorFlow run_time | 207.11s | 244.47s | 1.18배 |
| Redis SET | 30,257 req/s | 15,404 req/s | 0.51배 |
| node.js HTTP | 885.81 req/s | 375.13 req/s | 0.42배 |
| httpd 100k, 1 연결 전송률 | 565.35 KB/s | 282.84 KB/s | 0.50배 |
| httpd 100k, 25 연결 전송률 | 4,964.14 KB/s | 961.03 KB/s | 0.194배 |

CPU 바운드인 ffmpeg는 7.6% 느리고, syscall이 섞인 TensorFlow는 18% 느립니다. 네트워크 중심 워크로드는 훨씬 크게 벌어지는데, 동시 연결이 1개에서 25개로 늘면 httpd의 손실 비율이 절반에서 5분의 1로 더 나빠집니다 `Ⓥ`. **동시성이 올라갈수록 gVisor의 격차가 커진다**는 것이 이 표 하나로 드러납니다. Middleware '21의 추가 관찰도 같은 결을 보탭니다 — MySQL sysbench oltp_read_write에서 gVisor가 여러 플랫폼 중 가장 저조했고, native는 스레드 110개에서 피크를 찍지만 격리 플랫폼 대비 유의미한 우위를 주지는 못했습니다 `Ⓑ`. 랜덤 4K IO 쪽 반전은 [05 성능 실측]({{< relref "../05-performance/index.md" >}}) 3장에서 다룹니다.

기동 시간도 측정 경로에 따라 결론이 뒤집힙니다. gVisor 공식 startup 측정(Docker run 포함)에서는 empty 이미지 기준 runc 1,193ms, gVisor 1,144ms로 **gVisor가 더 빠르게** 나옵니다 `Ⓥ`. Docker 데몬 자체의 오버헤드가 워낙 커서 런타임 차이를 덮어버리기 때문이고, CLOSER 2020도 같은 관찰을 남깁니다 — "runsc가 거의 항상 runc보다 빠르게 동작한다." 밀도 쪽은 반대로 격리가 작은 컨테이너일수록 불리하다는 걸 보여줍니다. 공식 density.csv 기준 빈 컨테이너는 runc 3.9MiB 대비 gVisor 22.6MiB로 5.79배 벌어지지만, 1GB를 쓰는 Redis 워크로드에서는 1.02배로 희석됩니다 `≈`. 밀도 비용은 워크로드가 작을수록 치명적이라는 걸 이 대비가 보여주고, 같은 그림은 [05 성능 실측]({{< relref "../05-performance/index.md" >}}) 6장에도 있습니다.

## 5. 어디에 놓이나

Kata와 gVisor는 같은 문제에 다른 답을 냅니다 `Σ`. gVisor는 syscall 인터포지션으로 호스트 커널에 닿는 syscall 수를 줄여 공격 표면을 좁히지만, 리눅스 ABI를 재구현한 만큼 호환성 구멍을 남깁니다. Kata는 하드웨어 가상화로 진짜 리눅스 커널을 게스트에 넣으니 호환성은 거의 온전하지만, VM 한 대분의 비용과 하이퍼바이저라는 새 공격 표면을 얻습니다. 구조 비교는 [01 경계와 위협 모델]({{< relref "../01-boundaries/index.md" >}}) 1장의 도식에 있습니다.

관리형 서비스 중에서는 **GKE Sandbox가 gVisor를 쓰는 대표 사례**입니다. Kata가 아닙니다 `✓`. Standard 클러스터에서는 노드 단위로, Autopilot에서는 파드 단위로 켭니다 `✓`.

AI 에이전트 샌드박스 지형에서는 뚜렷한 구도가 읽힙니다. 모델 제공자 본인들은 gVisor를 고르고, 인프라 판매자들은 마이크로 VM을 고르는 구도입니다 `Σ`. 자기 코드로 자기 하드웨어를 지키는 문제라면 syscall 표면 축소로 충분하지만, 남의 임의 커널 요구를 받아야 하는 인프라 판매자는 호환성 때문에 VM이 필요하다는 해석이 자연스럽습니다 `≈`. 시나리오별로 gVisor가 KubeVirt·Kata보다 나은 자리와 아닌 자리는 [06 판단]({{< relref "../06-decision/index.md" >}})에서 정리합니다.

## 참고 자료

- [gVisor Architecture Guide](https://gvisor.dev/docs/architecture_guide/intro/) — Sentry·Gofer 구조
- [gVisor Platforms](https://gvisor.dev/docs/architecture_guide/platforms/) — ptrace·KVM·systrap
- [gVisor Security Model](https://gvisor.dev/security/) — CVE 대상 범위
- [gVisor Performance Guide](https://gvisor.dev/docs/architecture_guide/performance/) — syscall.csv·density.csv 원본
- [Releasing Systrap](https://gvisor.dev/blog/2023/04/28/systrap-release/) — 2023-04-28
- [gVisor amd64 syscall 호환성](https://gvisor.dev/docs/user_guide/compatibility/linux/amd64/) — 277/351
- [gVisor, 실제 취약점 봉쇄 사례](https://gvisor.dev/blog/2020/09/18/containing-a-real-vulnerability/) — CVE-2020-14386 회피
- [GKE Sandbox](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/sandbox-pods)
- [The True Cost of Containing: A gVisor Case Study](https://www.usenix.org/system/files/hotcloud19-paper-young.pdf) — Young et al., HotCloud '19. 시스템콜 지연 3자릿수 스펙트럼의 출처
