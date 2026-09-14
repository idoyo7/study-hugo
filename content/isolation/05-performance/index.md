---
title: "성능 실측 — 직관은 절반만 맞다"
linkTitle: "05 성능 실측"
weight: 5
date: 2026-09-14
lastmod: 2026-09-14
---

# 05 · 성능 실측 — 직관은 절반만 맞다

{{< callout type="info" >}}
- **CPU·메모리 대역폭은 셋 다 오차범위 3% 안이다** — 2026년 K8s 실측에서 sysbench CPU가 runc 2,258 · Kata Cloud Hypervisor 2,197(−2.7%) · gVisor 2,220(−1.7%) events/s로 나온다 `Ⓑ`. 여기서는 격리가 사실상 공짜다.
- **랜덤 4K IO에서는 정반대다** — 같은 측정에서 Kata는 −99%, gVisor는 −76% 떨어진다 `Ⓑ`. HTTP 처리량도 Kata −89%, gVisor −42%로 갈린다. 비용은 연산이 아니라 경계를 건너는 횟수에 붙는다.
- **메모리 오버헤드는 VM 크기와 무관한 상수다** — VMM 자체 몫만 재면 Firecracker 3MB · Cloud Hypervisor 13MB · QEMU 131MB이고 `Ⓑ`, AKS의 RuntimeClass overhead는 128Mi 파드 VM에 16Mi(12.5%), 128Gi 파드 VM에 1Gi(0.8%)가 붙는다 `✓`. 작은 파드를 많이 띄울수록 비율이 나빠진다.
- **gVisor KVM 플랫폼은 syscall을 runc보다 빠르게 처리한다** — 763ns vs runc 1,939ns `Ⓥ`. Sentry가 게스트 링0에서 자체 처리해 호스트 커널 진입 자체가 없기 때문이다.
- **대역폭 순위와 지연 순위가 뒤집힌다** — Firecracker RTT 371µs가 gVisor 319µs보다 나쁘다 `Ⓑ`. 대역폭에서 host급인 Firecracker가 지연에서는 최하위다.
- **밀도 비용은 "VM이라서"가 아니라 "워크로드가 작아서" 붙는다** `Σ` — 같은 VMM 상수가 128Mi 파드에서는 12.5%, 128Gi 파드에서는 0.8%로 희석된다.
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

[01]({{< relref "../01-boundaries/index.md" >}})~[04]({{< relref "../04-kubevirt/index.md" >}})가 구조와 위협 모델을 봤다면, 이 편은 순수하게 숫자입니다. 서로 다른 논문과 벤치마크에서 온 11개 축을 모았고, 측정 조건이 다르면 같은 막대에 올리지 않았습니다. 부팅 시간 하나만 봐도 논문마다 측정 구간의 정의가 다르기 때문입니다.

읽는 순서는 자유롭지만, 이 시리즈의 척추가 되는 반전 세 개는 기억해 둘 만합니다. gVisor의 KVM 플랫폼은 syscall을 runc보다 빠르게 처리하는 구간이 있고, 네트워크 대역폭 순위와 지연 순위가 뒤집히며, VM 메모리 오버헤드는 VM 크기와 무관한 상수라 작은 파드일수록 상대 손해가 커집니다.

자매 문서: 세 물건의 경계와 위협 모델은 [01 경계와 위협 모델]({{< relref "../01-boundaries/index.md" >}})에, Kata는 [02 Kata Containers]({{< relref "../02-kata/index.md" >}})에, gVisor는 [03 gVisor]({{< relref "../03-gvisor/index.md" >}})에, KubeVirt는 [04 KubeVirt]({{< relref "../04-kubevirt/index.md" >}})에, 시나리오별 판단은 [06 판단]({{< relref "../06-decision/index.md" >}})에 있습니다.

## 1. CPU·메모리 — 3% 안

{{< lane src="_lane/1-cpu-메모리.json" />}}

2015년 하드웨어로 돌린 Felter의 고전 실험도 같은 방향입니다. Linpack GFLOPS는 native 290.8, Docker 290.9, KVM 기본 241.3(−17%), KVM 튜닝 284.2(−2%)였고, STREAM Triad는 45.6/45.6/45.0으로 사실상 동률이었습니다 `Ⓑ`. PXZ만 −22%로 벌어졌는데 논문은 이를 nested paging TLB 압박으로 추정합니다. 2015년 하드웨어라 현행 EPT/NPT 세대와 직접 비교하기는 어렵고, Linpack이 튜닝 후 −2%까지 회복된다는 점을 보면 하드웨어 세대보다 설정의 영향이 컸다고 읽는 편이 맞습니다 `Σ`.

VEE 2020과 Middleware '21도 정성적으로 같은 결론에 이릅니다. VEE 2020은 sysbench CPU 10초 실행에서 "모든 플랫폼(host, Firecracker, LXC, gVisor)이 유사하게 동작"했고 LLCProbe에서도 "모든 플랫폼이 인스턴스당 약 33k probe"를 기록했다고 적습니다. 인스턴스를 10개로 늘리면 인스턴스당 성능이 23% 떨어지는데 이건 플랫폼과 무관한 자원 경합입니다 `Ⓑ`. Middleware '21의 표현은 더 직접적입니다 — "보안 컨테이너를 포함한 모든 컨테이너가 CPU 바운드 작업에서 네이티브 수준", "QEMU 하이퍼바이저를 쓰는 Kata도 메모리에서 유의미한 손상이 없다", 다만 "메모리 성능의 유일한 이상치는 Firecracker"입니다.

## 2. 시스템콜 — 세 자릿수 스펙트럼

{{< lane src="_lane/2-시스템콜-스펙트럼.json" />}}

이 축에서는 native와 runc 막대가 눈에 잘 안 들어올 정도로 작습니다. 그 자체가 격차의 크기를 말해줍니다.

{{< lane src="_lane/2-gvisor-플랫폼.json" />}}

같은 gVisor라도 syscall을 가로채는 플랫폼에 따라 숫자가 뒤집힙니다. KVM 플랫폼이 runc보다 **빠른** 이유는 Sentry가 게스트 링0에서 syscall을 자체 처리해 호스트 커널 진입 자체가 없기 때문입니다. "격리 기술의 비용은 기술 자체가 아니라 구현 경로가 정한다"는 이 시리즈의 핵심 반전 중 하나가 여기서 나옵니다.

HotCloud '19 논문 본문의 표현을 그대로 옮기면 이렇습니다 — "runc는 네이티브보다 32% 느린 데 그치지만, gVisor의 가장 빠른 결과(KVM + Sentry 전용)도 2.8배 느리다. KVM 모드에서 호스트 호출은 Sentry 내부 처리보다 9배, Gofer 호출은 72배 느리다." 파일 open+close 지연에서는 격차가 216배까지 벌어집니다(외부 tmpfs 518µs vs runc 2.40µs) `Ⓑ`. Gofer를 거치는 호출이라 왕복이 하나 더 붙기 때문입니다. 다만 이 수치는 systrap 이전 gVisor 버전의 것이고, systrap 이후의 대응 수치는 공식 블로그에 SVG 그래프만 있고 텍스트 값이 없어 확인하지 못했습니다 `?`. Kata 게스트 안의 시스템콜은 진짜 리눅스 커널이 처리하므로 구조상 native에 근접해야 하지만, 이를 뒷받침하는 공개 측정은 찾지 못했습니다 `?`.

## 3. 디스크 IO — 순차와 랜덤이 반대로

{{< lane src="_lane/3-랜덤-4k.json" />}}

같은 2026년 3자 비교에서 순차 read는 Kata +112%, gVisor +551%로 runc를 앞섭니다. 실제 디스크 성능이 좋아진 게 아니라 캐시 효과입니다. gVisor의 Gofer가 호스트 페이지 캐시에서 공격적으로 read-ahead를 하고, Kata의 virtio-fs DAX가 호스트 캐시를 게스트에 매핑하기 때문이라고 원 저자가 직접 밝힙니다. 그래서 이 수치는 같은 차트에 올리지 않았습니다. 랜덤 4K는 캐시가 먹히지 않는 자리라 구조적 비용이 그대로 드러납니다. Kata의 −99%는 IO 한 번마다 VM exit이 발생하는 구조 때문으로 보입니다 `≈`.

CLOSER 2020 논문(2코어 노트북급 VM, containerd/CRI-O × runc/runsc 4조합)이 잰 파일 IO도 같은 방향을 가리킵니다. 순차 read에서 runsc가 runc 대비 9.2배 느렸고(3.32초 대 0.36초), 랜덤 read는 9.7배(0.29초 대 0.03초) 느렸습니다. 반면 쓰기 쪽 격차는 2.5배 정도로 훨씬 완만했습니다 `Ⓑ`. 저자는 이 비대칭을 "Gofer가 제공하는 가상 파일시스템의 비효율적 구현" 탓으로 설명합니다. 하드웨어도 실험 목적도 다른 측정 셋(2026년 3자 비교, gVisor 공식 fio, CLOSER 2020)이 "읽기가 쓰기보다 훨씬 크게 벌어진다"는 같은 결론에 따로따로 도달했습니다 `Σ`.

NSDI 2020의 하드웨어 측정이 이 구조를 더 날카롭게 보여줍니다. 하드웨어 자체는 4kB에서 340,000 IOPS 이상을 낼 수 있는데, Firecracker 게스트는 v0.20.0 시점 구현 한계(flush 미구현, IO 직렬 처리)로 약 13,000 IOPS에 묶입니다 `Ⓑ`. 26배 가까이 벌어지는 셈입니다 `≈`. 논문은 QD1 99퍼센타일 지연에서 Firecracker의 4kB read가 네이티브보다 49µs 느리다고도 밝힙니다. Felter의 오래된 측정에서도 같은 방향입니다 — "Docker는 Linux 대비 오버헤드 없음, KVM은 IOPS의 절반만 전달"했고 이유는 모든 IO가 QEMU를 통과하기 때문입니다. 랜덤 read 지연은 KVM에서 2~3배 늘었습니다 `Ⓑ`.

Kata가 쓰는 공유 파일시스템 선택도 성능을 크게 가릅니다. virtio-9p는 순차 read 91–98 MB/s에 그치는데 virtio-fs+DAX는 660–703 MB/s까지 올라갑니다 `Ⓑ`. 4개 파일을 동시에 여는 시나리오에서는 DAX 구성이 2~3 GB/s까지 올라가고 베이스라인은 300~400 MB/s에 머뭅니다. StackHPC의 2019년 측정(Kata 1.6.2, 9p 시절, BeeGFS/NVMe over 100G IB)에서는 bare metal read 대역폭의 약 15%밖에 못 냈고, 순차 read 1클라이언트 p50 지연이 bare metal 1,581µs 대비 Kata 4,112µs로 늘었습니다 `Ⓑ`. Kata 2.0부터 virtio-fs가 기본이 된 배경이고, Middleware '21도 "virtio-fs는 9P를 크게 앞서는 유망한 대안"이라고 같은 결론을 냅니다.

## 4. 네트워크 — 대역폭과 지연의 순위가 다르다

{{< lane src="_lane/4-대역폭.json" />}}

링크 자체가 병목이면 격차가 사라집니다. Felter의 10GbE 환경에서는 native·Docker·KVM이 전부 9.3Gbps로 동률이었습니다. NSDI처럼 loopback으로 링크 제약을 걷어내야 VMM 사이의 실제 격차가 드러납니다.

{{< lane src="_lane/4-rtt.json" />}}

대역폭 순위와 지연 순위가 뒤집힙니다. Firecracker는 대역폭에서 host급인데 RTT는 gVisor보다 나쁩니다. 패킷이 게스트와 호스트 양쪽의 네트워크 스택을 온전히 두 번 통과하기 때문입니다.

{{< lane src="_lane/4-http-처리량.json" />}}

{{< lane src="_lane/4-http-지연.json" />}}

같은 역전이 HTTP에서도 반복됩니다. gVisor는 처리량을 42% 잃으면서 평균 지연은 runc보다 34% 낮게 나옵니다. 요청당 효율은 좋지만 병렬성이 제한적이라는 뜻입니다.

TCP 연결 수립 시간도 벌어집니다. Quark 논문에서 runC-Flannel이 504.65µs인데 Kata-Flannel은 834.6µs입니다 `Ⓑ`. Middleware '21은 하이퍼바이저(TAP+virtio-net) 경로가 약 −25%, bridge가 −9~10%, gVisor의 p90 지연이 경쟁자의 3~4배라고 정리합니다. 이 논문은 Kata가 bridge와 QEMU TAP+virtio-net을 둘 다 쓰기 때문에 "가장 약한 고리인 QEMU 쪽 성능과 같아야 하고, 실제로 그렇다"고 설명합니다. Felter의 결론도 되짚을 만합니다 — 자신의 실험 환경에서 "vhost는 복잡한 네트워크 가속 기술 없이도 네트워크 처리량 문제를 직설적으로 해결한다. NIC이 더 있다면 이 서버는 40Gbps 이상을 밀어낼 수 있을 것"이라고 적었습니다. 대신 오버헤드는 대역폭이 아니라 바이트당 CPU 사이클과 netperf 왕복 지연에 나타났습니다 — NAT은 지연을 2배로, KVM은 트랜잭션당 30µs를 더해 80%를 늘렸습니다 `Ⓑ`. KubeVirt 바인딩별 iperf 대조표는 공개된 것을 찾지 못했습니다 `?`.

## 5. 기동 시간

{{< lane src="_lane/5-기동-시간.json" />}}

NSDI 2020은 Firecracker가 애플리케이션 코드까지 125ms 미만으로 뜬다고 밝히는데, Middleware '21이 잰 Firecracker end-to-end는 350ms입니다. 같은 대상을 잰 게 아닙니다. NSDI는 패치된 커널이 부팅 중 특수 장치에 남기는 타임스탬프까지의 구간을, Middleware는 프로세스 생성부터 종료까지를 잽니다. Middleware 저자는 NSDI 방식이 "왜곡됐다"고 직접 비판합니다. 그래서 두 수치를 같은 막대에 올리지 않았습니다.

부팅 시간을 가르는 요인은 NSDI가 숫자로 분해해 뒀습니다. 압축 커널 해제가 +40ms, Ubuntu 기본 커널 사용이 +900ms, 시리얼 콘솔 로깅 끄기가 −70ms입니다 `Ⓑ`. 커널 이미지를 최적화하지 않으면 부팅 시간의 대부분이 여기서 샙니다.

Ant Group의 실험적 PVM 경로는 claim-to-Ready가 사전부팅 풀이 없을 때 8.806초, 준비된 샌드박스가 하나 있을 때 1.385초입니다 `Ⓥ`. 리틀의 법칙을 적용하면 125ms 생성 시간에서 초당 8건 생성마다 사전부팅 풀 1개가 필요하다는 계산이 나옵니다.

Docker 데몬을 경유하는 측정에서는 gVisor가 runc보다 빠르게 나오기도 합니다. 데몬 자체의 오버헤드가 워낙 커서 런타임 차이를 덮어버리기 때문입니다. HotCloud '19가 잰 동시성 없는 생명주기 전체(setup+teardown)에서도 runc 1.014초, gVisor+KVM 1.117초, gVisor+ptrace 1.181초로 격차가 크지 않았습니다 `Ⓑ`. 컨테이너 자체의 기동은 이렇게 짧은데, 앞서 본 Kata·Firecracker의 수백 ms대 수치와 나란히 두면 "VM을 세우는 일"과 "프로세스를 띄우는 일"의 자릿수 차이가 선명해집니다.

## 6. 메모리 바닥값과 밀도 — 직관이 가장 잘 맞는 축

{{< lane src="_lane/6-vmm-메모리.json" />}}

VMM 자체의 비공유 세그먼트만 재면 VM 크기와 무관하게 상수입니다. QEMU의 131MB는 128MB짜리 마이크로 VM을 띄울 때 VM 본체보다 VMM이 더 크다는 뜻입니다. gVisor는 빈 컨테이너에서 5.79배(+18.7MiB)까지 벌어지지만 Redis처럼 1GB를 쓰는 워크로드에서는 1.02배로 희석됩니다. 밀도 비용은 컨테이너가 작을수록 치명적이라는 걸 이 대비가 보여줍니다.

{{< lane src="_lane/6-aks-오버헤드.json" />}}

이 그림이 이 시리즈의 세 번째 반전입니다. 절대 오버헤드는 VM 크기를 따라 커지지만 그 비율은 128Mi에서 12.5%였다가 128Gi에서 0.78%로 떨어집니다. 호스트 컴포넌트 여유는 450~490Mi 선에 수렴합니다. **VM 메모리 오버헤드는 "VM이라서" 비싼 게 아니라 "워크로드가 작아서" 비싼 것**입니다 `Σ`.

{{< lane src="_lane/6-kubevirt-오버헤드.json" />}}

KubeVirt 쪽도 같은 구조입니다. 기본 구성(8GiB/4vCPU)에서 296Mi였던 오버헤드가 그래픽·전용 CPU를 더하면 428Mi로, VFIO(GPU·SR-IOV) 패스스루를 더하면 1,452Mi로 뜁니다. VFIO는 게스트 RAM 전체를 lock해야 해서 한 번에 1Gi가 붙습니다. Red Hat의 스케일 테스트가 실측한 파드당 약 288MB가 이 계산값과 잘 맞습니다 `Ⓥ`.

같은 스케일 테스트에서 노드당 400개 VMI를 띄울 수 있었고(목표는 500이었으나 테스트베드 불안정으로 미달), 100개를 생성하는 데 약 200초, 200개를 생성하는 데 약 600초가 걸렸습니다 `Ⓥ`. 300개 구간에서의 생성률은 분당 약 48 VMI였습니다. VM당 게스트 RAM은 10MB로 작게 잡았는데도 virt-launcher 파드당 메모리 오버헤드가 위에서 본 288MB 선이었다는 점이, 소스 코드 상수를 그대로 조립한 계산값과 실측이 어긋나지 않는다는 근거입니다.

## 7. 정리 — 워크로드 유형별 기대 오버헤드

| 워크로드 | Kata | gVisor | 근거 |
|---|---|---|---|
| CPU 바운드 | −3% 안팎 | −2% 안팎 | 2026 K8s 실측 `Ⓑ` |
| 메모리 대역폭 | −3% 안팎 | 0% 안팎 | 2026 K8s 실측 `Ⓑ` |
| 랜덤 소블록 IO | −99% | −76% | 2026 K8s 실측 `Ⓑ` |
| 순차 대블록 IO | +112%(캐시 효과, 참고용) | +551%(캐시 효과, 참고용) | 같은 자료, 캐시 제거 안 됨 `Ⓑ` |
| 네트워크 처리량 | −89% | −42% | 2026 wrk 실측 `Ⓑ` |
| 네트워크 지연 | +250%대 | runc보다 −34% | 2026 wrk 실측 `Ⓑ` |
| syscall 밀집(빌드·컴파일류) | 미확인 `?` | 최대 200배대(경로에 따라) | HotCloud '19 `Ⓑ` |
| 기동 지연 | 약 6배(Docker 대비) | 약 2배(Docker 대비) | Middleware '21 `Ⓑ` |
| 파드당 메모리 | 128Mi VM 기준 +12.5% | 빈 컨테이너 기준 +5.79배 | AKS 공식 · gVisor density.csv `✓`/`≈` |

이 표를 보는 방법은 "Kata·gVisor가 나쁘다"가 아니라 "어느 축이 워크로드에 걸리는가"입니다. 계산 중심 배치 작업이라면 이 표의 위쪽 두 줄만 신경 쓰면 되고, 요청이 잦은 API 서버라면 중간의 IO·네트워크 줄이 SLO를 직접 흔듭니다. 여기까지는 Kata와 gVisor처럼 컨테이너를 감싸는 격리의 실측입니다. KubeVirt처럼 VM 자체를 1급 객체로 다루는 쪽의 오버헤드 계약은 [04 KubeVirt]({{< relref "../04-kubevirt/index.md" >}})에서 다룹니다.

## 참고 자료

- [The True Cost of Containing: A gVisor Case Study](https://www.usenix.org/system/files/hotcloud19-paper-young.pdf) — Young et al., HotCloud '19. 시스템콜 지연 3자릿수 스펙트럼의 출처
- [Blending Containers and Virtual Machines: A Study of Firecracker and gVisor](https://pages.cs.wisc.edu/~swift/papers/vee20-isolation.pdf) — Anjali, Caraza-Harter, Swift, VEE '20. RTT 역전의 출처
- [Firecracker: Lightweight Virtualization for Serverless Applications](https://www.usenix.org/system/files/nsdi20-paper-agache.pdf) — Agache et al., NSDI '20. 부팅 요인 분해, VMM 메모리 상수, 네트워크 대역폭의 출처
- [An Updated Performance Comparison of Virtual Machines and Linux Containers](https://www.read.seas.harvard.edu/~kohler/class/cs260r-s19/containerperf14.pdf) — Felter et al., IEEE ISPASS 2015
- [A Fresh Look at the Architecture and Performance of Contemporary Isolation Platforms](https://arxiv.org/pdf/2110.11462) — van Rijn, Rellermeyer, Middleware '21. 기동 시간 정의 논쟁의 출처
- [Quark: A High-Performance Secure Container Runtime for Serverless Computing](https://arxiv.org/pdf/2309.12624) — Zhao et al., arXiv:2309.12624. TCP 연결 수립 시간, Kata 샌드박스 메모리의 출처
- [Some performance numbers for virtiofs, DAX and virtio-9p](https://www.mail-archive.com/virtio-fs@redhat.com/msg02371.html) — Vivek Goyal, 2020-12-10
- [I/O performance of Kata containers](https://www.stackhpc.com/kata-io-1.html) — Bharat Kunwar, StackHPC, 2019-05-09
- [gVisor Performance Guide](https://gvisor.dev/docs/architecture_guide/performance/) — syscall.csv·density.csv 원본
- [cncf/tab#147](https://github.com/cncf/tab/issues/147) — Ant Group Kata AI 에이전트 샌드박스, PVM 부팅 실측
- [container-runtime-benchmarks](https://github.com/bikramkgupta/container-runtime-benchmarks) — 2026년 runc/Kata/gVisor 3자 비교의 출처
