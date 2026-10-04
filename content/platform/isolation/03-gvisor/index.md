---
title: "gVisor"
linkTitle: "03 gVisor"
weight: 3
date: 2026-09-14
lastmod: 2026-09-14
url: "/isolation/03-gvisor/"
---

# 03 · gVisor — 커널을 다시 쓴 샌드박스가 얻는 것과 못 하는 것

{{< callout type="info" >}}
- **호스트 커널 임의 코드 실행에 이르는 완전 탈출 CVE는 확인되지 않는다** — 공개 CVE·advisory를 조사한 범위에서의 부재 확인이다 `✓`.
- **amd64 syscall 351개 중 277개가 완전 또는 부분 구현돼 있다** — 완전 호환이 아니라 넓은 부분 호환이며, 구현 수만으로 개별 워크로드의 호환성을 판단할 수는 없다 `✓`.
- **모델 제공자는 gVisor, 인프라 판매자는 마이크로 VM을 고른다** — Anthropic·OpenAI·Modal은 gVisor, E2B·Fly.io는 Firecracker, Northflank·Ant Group은 Kata다 `Σ`.
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

gVisor는 애플리케이션의 syscall을 가로채 유저스페이스에서 재구현한 커널로 처리합니다. 이 **syscall 인터포지션**은 호스트 커널의 공격 표면을 줄이지만, 애플리케이션이 요구하는 리눅스 기능을 모두 제공하지는 않습니다. 적용 여부를 판단하려면 필요한 syscall의 지원 여부와 그 호출을 처리하는 경로를 함께 봐야 합니다.

자매 문서: 격리 경계의 비교는 [01 경계와 위협 모델]({{< relref "/platform/isolation/01-boundaries/index.md" >}})에, VM 기반 대안의 구성과 운영 조건은 [02 Kata Containers]({{< relref "/platform/isolation/02-kata/index.md" >}})와 [04 KubeVirt]({{< relref "/platform/isolation/04-kubevirt/index.md" >}})에 있습니다.

## 1. syscall을 처리하는 Sentry와 Gofer

**Sentry**는 Go로 쓰인 프로세스입니다. 리눅스 syscall ABI의 상당 부분을 사용자 공간에서 재구현해 애플리케이션의 syscall을 가로채 처리합니다. 파일시스템 접근은 별도 **Gofer** 프로세스가 대리합니다 `✓`.

gVisor는 syscall을 가로채는 방식을 플랫폼이라 부릅니다. 여기서 구분할 플랫폼은 셋입니다 `✓`.

- ptrace: 컨텍스트 스위치 비용이 크며 현재는 지원이 종료된 상태.
- KVM: Sentry가 게스트 커널이자 VMM 역할을 겸하며 베어메탈에서 유리한 방식.
- systrap: seccomp의 `SECCOMP_RET_TRAP`으로 `SIGSYS`를 받아 처리하는 방식.

프로젝트는 systrap을 "ptrace와 비슷하되 빠르다"고 설명합니다. 발표일은 2023-04-28이며, 그 무렵부터 기본 플랫폼이 됐습니다 `✓`. 같은 gVisor라도 어느 플랫폼에서 측정했는지에 따라 성능 결과를 달리 읽어야 합니다.

## 2. 호환성은 워크로드로 확인해야 한다

자동 생성 표 기준으로 amd64는 351개 syscall 중 **277개**, arm64는 294개 중 **250개**가 완전 또는 부분 구현입니다 `✓`. 미구현 syscall이 있다고 곧장 애플리케이션이 깨지지는 않습니다. 런타임과 libc에 폴백 경로가 있기 때문입니다 `✓`.

문제 영역으로 반복 거론되는 것은 raw socket 기본 차단, `PACKET_RX_RING` 계열, GPU·드라이버 의존 워크로드, io_uring 의존 워크로드입니다 `≈`. 다만 이를 망라한 권위 있는 단일 목록 문서는 찾지 못했습니다. 개별 워크로드가 이 제약에 걸리는지는 직접 실행해 확인해야 하는 경우가 많습니다 `?`.

## 3. 보안 기록과 남아 있는 공격 표면

gVisor 보안 페이지는 Sentry와 기존 리눅스 하드닝(seccomp-bpf, `pivot_root`, namespace)의 2중 구조로 호스트 커널 공격 표면을 줄이는 것을 목표로 밝힙니다 `✓`. 샌드박스 내부에 머무는 권한 상승이나 DoS는 CVE 대상에서 명시적으로 제외하므로, 공개 CVE 기록을 읽을 때도 이 범위를 고려해야 합니다 `✓`.

이 조사에서 확인한 CVE는 넷입니다.

- CVE-2018-16359: seccomp 샌드박스 안에서 `renameat`을 허용해 호스트 파일 이름을 바꿀 수 있었던 경계 침범 사례 `✓`.
- CVE-2024-10603(CVSS 5.3): netstack의 예측 가능한 포트·헤더 값 문제 `✓`.
- CVE-2024-10026: TCP 스택의 약한 해시 문제 `✓`.
- CVE-2025-2713(CVSS4 6.8, 2025-03-28): `runsc`가 첫 fork 전까지 root 유사 권한으로 실행돼 생긴 로컬 권한 상승 `✓`.

공개 CVE·advisory를 조사한 범위에서 호스트 커널 임의 코드 실행에 이르는 완전 탈출 CVE는 찾지 못했습니다 `✓`. 지원하지 않는 기능이 방어로 작용한 사례도 있습니다. CVE-2020-14386은 리눅스 패킷 링 버퍼 오버플로였지만, gVisor는 `PACKET_RX_RING`을 구현하지 않고 raw socket을 기본 차단해 영향받지 않았습니다 `✓`.

공격 표면은 Kata와도 다릅니다. [01 경계와 위협 모델]({{< relref "/platform/isolation/01-boundaries/index.md" >}})에서 다룬 Kata의 2026년 advisory 10건 중 3건은 호스트가 pod annotation을 신뢰하는 설계에서 비롯됐습니다. gVisor에는 virtio 장치 에뮬레이션이나 annotation을 읽어 하이퍼바이저를 구성하는 shim이 없어, 그 계열의 공격 표면은 없습니다 `Σ`.

gVisor에서 살펴야 할 표면은 리눅스 ABI를 재구현한 Sentry와 파일시스템 접근을 대리하는 Gofer의 코드입니다. 이 코드의 버그는 syscall 처리의 정확성을 해칠 수 있고, CVE-2018-16359처럼 경계를 넘는 결과로 이어질 수도 있습니다 `Σ`.

## 4. 성능 비용은 어디서 발생하는가

Sentry 내부에서 끝나는 syscall과 호스트 호출·Gofer 접근이 필요한 syscall은 처리 비용이 다릅니다. KVM에서는 Sentry가 게스트 링0에서 syscall을 자체 처리하면 호스트 커널에 진입하지 않습니다. gVisor 공식 측정(GCE n1-standard-4, Debian 9)의 syscall 지연은 runc 1,939ns, ptrace 38,219ns(19.7배), KVM 763ns였습니다 `Ⓥ`.

HotCloud '19의 gettimeofday 100M회 평균 지연에서는 native 0.22µs, runc 0.29µs(1.32배), KVM + Sentry 내부 처리 0.63µs(2.86배)였습니다. 같은 KVM에서도 호스트 호출을 거치면 5.96µs(27배), Gofer를 거치면 45.5µs(207배)까지 늘었습니다 `Ⓑ`. 두 측정에서 KVM과 runc의 순위는 다릅니다. 플랫폼 이름만으로 비용을 일반화하기보다 처리 경로와 측정 조건을 구분해야 합니다. 비교 차트는 [05 성능 실측]({{< relref "/platform/isolation/05-performance/index.md" >}}) 2장에 있습니다.

애플리케이션 레벨로 올라가면 격차는 워크로드 성격에 따라 7%에서 500%까지 흔들립니다. gVisor 공식 데이터가 이 폭을 그대로 보여줍니다 `Ⓥ`.

애플리케이션 수준에서는 CPU 연산과 네트워크 처리의 비중에 따라 차이가 납니다. 아래는 gVisor 공식 데이터입니다 `Ⓥ`.

| 워크로드 | runc | gVisor | 비율 |
|---|---|---|---|
| ffmpeg run_time | 82.00s | 88.24s | 1.076배 |
| TensorFlow run_time | 207.11s | 244.47s | 1.18배 |
| Redis SET | 30,257 req/s | 15,404 req/s | 0.51배 |
| node.js HTTP | 885.81 req/s | 375.13 req/s | 0.42배 |
| httpd 100k, 1 연결 전송률 | 565.35 KB/s | 282.84 KB/s | 0.50배 |
| httpd 100k, 25 연결 전송률 | 4,964.14 KB/s | 961.03 KB/s | 0.194배 |

CPU 바운드인 ffmpeg의 실행 시간은 7.6%, syscall이 섞인 TensorFlow는 18% 늘었습니다. 네트워크 중심 워크로드에서는 처리량 차이가 더 큽니다. 특히 이 httpd 측정에서는 동시 연결이 1개에서 25개로 늘 때 runc 대비 전송률이 절반에서 5분의 1로 낮아졌습니다 `Ⓥ`. 이 표 안에서는 동시성이 올라갈수록 gVisor의 격차가 커집니다.

Middleware '21의 MySQL sysbench oltp_read_write 측정에서는 gVisor가 비교 플랫폼 중 가장 저조했습니다. native는 스레드 110개에서 피크를 기록했지만 격리 플랫폼 대비 유의미한 우위를 보이지는 않았습니다 `Ⓑ`. 랜덤 4K IO 결과는 [05 성능 실측]({{< relref "/platform/isolation/05-performance/index.md" >}}) 3장에서 다룹니다.

기동 시간은 측정에 포함한 범위도 봐야 합니다. Docker run을 포함한 공식 startup 측정의 empty 이미지 결과는 runc 1,193ms, gVisor 1,144ms였습니다 `Ⓥ`. Docker 데몬의 오버헤드가 런타임 차이를 가릴 수 있는 측정입니다. CLOSER 2020에도 "runsc가 거의 항상 runc보다 빠르게 동작한다."는 서술이 있습니다.

메모리 비용의 비율은 워크로드 크기에 따라 달라집니다. 공식 density.csv 기준 빈 컨테이너는 runc 3.9MiB, gVisor 22.6MiB로 5.79배 차이지만, 1GB를 쓰는 Redis 워크로드에서는 1.02배입니다 `≈`. 작은 컨테이너를 많이 배치할 계획이라면 이 차이를 따로 계산해야 합니다. 밀도 비교는 [05 성능 실측]({{< relref "/platform/isolation/05-performance/index.md" >}}) 6장에 있습니다.

## 5. Kubernetes 적용과 AI 샌드박스의 선택

Kata와 gVisor는 같은 문제에 다른 답을 냅니다 `Σ`. gVisor는 syscall 인터포지션으로 호스트 커널에 닿는 syscall 수를 줄여 공격 표면을 좁히지만 리눅스 ABI를 재구현한 만큼 호환성 구멍이 생깁니다. Kata는 하드웨어 가상화로 진짜 리눅스 커널을 게스트에 넣으니 호환성은 거의 온전하지만 VM 한 대분의 비용과 하이퍼바이저라는 새 공격 표면을 얻습니다. 구조 비교는 [01 경계와 위협 모델]({{< relref "/platform/isolation/01-boundaries/index.md" >}}) 1장의 도식에 있습니다.

쿠버네티스에서 gVisor를 연결할 때 RuntimeClass handler는 `runsc`, containerd 쪽 shim은 `containerd-shim-runsc-v1`입니다 `✓`. 관리형 서비스의 대표 사례인 **GKE Sandbox**도 gVisor를 씁니다. Kata가 아닙니다 `✓`. Standard 클러스터에서는 노드 단위로, Autopilot에서는 파드 단위로 켭니다 `✓`.

앞서 든 AI 샌드박스 도입 사례에서는 모델 제공자가 gVisor를, 인프라 판매자가 마이크로 VM을 고르는 구도가 읽힙니다 `Σ`. 자기 코드로 자기 하드웨어를 지키는 환경에서는 syscall 표면 축소를 택하고, 고객의 다양한 커널 요구를 받아야 하는 환경에서는 호환성 때문에 VM을 택한다는 해석이 가능합니다. 다만 이는 도입 사례에서 추론한 선택 이유입니다 `≈`.

자기 워크로드에 적용할 때는 필요한 커널 기능이 동작하는지 확인한 뒤, syscall·파일시스템·네트워크 경로와 동시성 조건을 반영해 성능을 측정해야 합니다. 시나리오별로 gVisor·Kata·KubeVirt를 고르는 조건은 [06 판단]({{< relref "/platform/isolation/06-decision/index.md" >}})에서 이어집니다.

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
