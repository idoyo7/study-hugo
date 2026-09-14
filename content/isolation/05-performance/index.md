---
title: "성능 실측 — 직관은 절반만 맞다"
linkTitle: "05 성능 실측"
weight: 5
date: 2026-09-14
lastmod: 2026-09-14
---

# 05 · 성능 실측 — 직관은 절반만 맞다

{{< callout type="info" >}}
- **연산 중심 작업에서는 격리 비용이 작다** — 2026년 K8s 실측에서 CPU·메모리 대역폭 차이는 3% 안에 머문다 `Ⓑ`. IO가 많은 작업까지 같은 결과를 기대할 수는 없다.
- **시스템콜과 IO 비용은 호출 경로에 따라 벌어진다** — Sentry 내부 처리, 호스트 호출, Gofer 왕복을 구분해야 한다. 같은 gVisor도 플랫폼과 호출 종류에 따라 결과가 달라진다 `Ⓑ`.
- **네트워크 처리량과 지연은 따로 봐야 한다** — 대역폭에서 앞선 런타임이 RTT에서도 앞서지는 않는다 `Ⓑ`. 링크 속도와 측정한 지연 지표도 함께 확인해야 한다.
- **작은 파드를 많이 띄울수록 메모리 바닥값이 부담된다** — VMM 자체의 고정 비용과 VM 크기·장치 구성에 따라 늘어나는 오버헤드를 나눠 계산해야 한다 `Σ`.
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

같은 런타임을 잰 숫자라도 측정 구간과 환경이 다르면 직접 비교할 수 없습니다. 부팅 시간은 어디까지를 기동으로 보느냐에 따라 달라지고, 디스크 읽기는 캐시가 결과를 뒤집기도 합니다. 아래 11개 축은 서로 다른 논문과 벤치마크에서 모았으며, 측정 조건이 다른 수치는 같은 막대에 올리지 않았습니다.

자매 문서: 경계를 건너는 경로는 [01 경계와 위협 모델]({{< relref "../01-boundaries/index.md" >}}), 런타임별 구성은 [02 Kata Containers]({{< relref "../02-kata/index.md" >}})와 [03 gVisor]({{< relref "../03-gvisor/index.md" >}})에서 확인할 수 있습니다. VM의 오버헤드 계약은 [04 KubeVirt]({{< relref "../04-kubevirt/index.md" >}}), 시나리오별 선택은 [06 판단]({{< relref "../06-decision/index.md" >}})으로 이어집니다.

## 1. CPU·메모리 대역폭

2026년 K8s 실측에서 sysbench CPU는 runc 2,258 · Kata Cloud Hypervisor 2,197(−2.7%) · gVisor 2,220(−1.7%) events/s였습니다 `Ⓑ`. 아래 차트에서 연산과 메모리 대역폭의 격차는 작지만, 이 결과를 다른 설정과 메모리 접근 패턴까지 일반화할 수는 없습니다.

{{< lane src="_lane/1-cpu-메모리.json" />}}

설정의 영향은 Felter의 2015년 실험에서 드러납니다. Linpack GFLOPS는 native 290.8, Docker 290.9, KVM 기본 241.3(−17%), KVM 튜닝 284.2(−2%)였고 STREAM Triad는 45.6/45.6/45.0으로 거의 같았습니다 `Ⓑ`. PXZ는 −22%로 벌어졌는데, 논문은 이를 nested paging TLB 압박으로 추정합니다. 2015년 하드웨어를 현행 EPT/NPT 세대와 직접 비교하기는 어렵습니다. 다만 같은 실험에서 Linpack이 튜닝 후 −2%까지 회복된 결과는 하드웨어 세대만으로 격차를 설명하기 전에 설정을 확인해야 한다는 근거입니다 `Σ`.

VEE 2020은 sysbench CPU 10초 실행에서 "모든 플랫폼(host, Firecracker, LXC, gVisor)이 유사하게 동작"했고, LLCProbe에서도 "모든 플랫폼이 인스턴스당 약 33k probe"를 기록했다고 적습니다. 인스턴스를 10개로 늘렸을 때 인스턴스당 성능이 23% 떨어진 현상은 플랫폼과 무관한 자원 경합으로 설명합니다 `Ⓑ`.

Middleware '21도 "보안 컨테이너를 포함한 모든 컨테이너가 CPU 바운드 작업에서 네이티브 수준", "QEMU 하이퍼바이저를 쓰는 Kata도 메모리에서 유의미한 손상이 없다"고 보고합니다. 다만 이 논문에서 "메모리 성능의 유일한 이상치는 Firecracker"입니다.

## 2. 시스템콜 — 호출 경로가 만드는 격차

시스템콜은 Sentry 안에서 끝나는지, 호스트나 Gofer까지 왕복하는지에 따라 비용이 달라집니다. 아래 스펙트럼을 읽을 때는 런타임 이름과 함께 호출 경로를 봐야 합니다.

{{< lane src="_lane/2-시스템콜-스펙트럼.json" />}}

HotCloud '19 논문 본문의 표현은 이렇습니다 — "runc는 네이티브보다 32% 느린 데 그치지만, gVisor의 가장 빠른 결과(KVM + Sentry 전용)도 2.8배 느리다. KVM 모드에서 호스트 호출은 Sentry 내부 처리보다 9배, Gofer 호출은 72배 느리다." 파일 open+close 지연에서는 격차가 216배까지 벌어집니다(외부 tmpfs 518µs vs runc 2.40µs) `Ⓑ`. Gofer를 거치면서 왕복이 하나 더 붙기 때문입니다.

gVisor 내부에서도 syscall을 가로채는 플랫폼을 바꾸면 결과가 달라집니다. 다음 차트는 그 차이를 보여줍니다.

{{< lane src="_lane/2-gvisor-플랫폼.json" />}}

gVisor 공식 자료의 KVM 플랫폼 결과는 Sentry 내부에서 처리되는 syscall에 한정됩니다. Sentry가 게스트 링0에서 해당 syscall을 직접 처리해 호스트 커널 진입을 피하기 때문입니다. 이 결과를 Gofer 호출이나 gVisor의 모든 시스템콜에 적용할 수는 없습니다.

앞의 HotCloud '19 수치는 systrap 이전 gVisor 버전의 것입니다. systrap 이후의 대응 수치는 공식 블로그에 SVG 그래프만 있고 텍스트 값이 없어 확인하지 못했습니다 `?`. Kata 게스트 안의 시스템콜은 리눅스 커널이 처리하므로 구조상 native에 근접할 것으로 예상하지만, 이를 뒷받침하는 공개 측정은 찾지 못했습니다 `?`.

## 3. 디스크 IO — 순차 읽기와 랜덤 읽기의 조건

아래 차트는 랜덤 IO에서 런타임 사이의 성능 격차를 보여줍니다. 아래 차트의 격차를 순차 읽기 결과와 함께 보면 캐시 조건을 구분해야 하는 이유가 드러납니다.

{{< lane src="_lane/3-랜덤-4k.json" />}}

같은 측정에서 순차 read는 Kata +112%, gVisor +551%로 runc를 앞섭니다. 원 저자는 이 결과를 캐시 효과로 설명합니다. gVisor의 Gofer가 호스트 페이지 캐시에서 적극적으로 read-ahead를 하고, Kata의 virtio-fs DAX가 호스트 캐시를 게스트에 매핑한다는 설명입니다. 디스크 자체의 성능 향상으로 읽을 수 없어 같은 차트에 올리지 않았습니다. 랜덤 4K에서는 이런 캐시 이득을 얻기 어려워 경계를 건너는 비용이 드러납니다. Kata의 −99%가 IO 한 번마다 발생하는 VM exit 때문이라는 설명은 추정입니다 `≈`.

CLOSER 2020 논문은 2코어 노트북급 VM에서 containerd/CRI-O × runc/runsc 4조합의 파일 IO를 쟀습니다. 순차 read에서 runsc는 runc 대비 9.2배 느렸고(3.32초 대 0.36초), 랜덤 read는 9.7배(0.29초 대 0.03초) 느렸습니다. 쓰기 쪽 격차는 2.5배 정도로 더 작았습니다 `Ⓑ`. 저자는 이 비대칭을 "Gofer가 제공하는 가상 파일시스템의 비효율적 구현" 탓으로 설명합니다. 하드웨어와 실험 목적이 다른 측정 셋(2026년 3자 비교, gVisor 공식 fio, CLOSER 2020)에서 읽기 비용이 쓰기보다 크게 벌어지는 경향을 볼 수 있습니다 `Σ`. 다만 앞의 순차 read처럼 캐시 효과로 결과가 뒤집힌 구간은 구분해서 읽어야 합니다.

장치 구현의 한계도 큽니다. NSDI 2020에서 하드웨어 자체는 4kB에서 340,000 IOPS 이상을 냈지만, Firecracker 게스트는 v0.20.0 시점의 구현 한계(flush 미구현, IO 직렬 처리)로 약 13,000 IOPS에 묶였습니다 `Ⓑ`. 26배 가까운 차이입니다 `≈`. QD1 99퍼센타일 지연에서도 Firecracker의 4kB read는 네이티브보다 49µs 느렸습니다. Felter의 측정에서도 "Docker는 Linux 대비 오버헤드 없음, KVM은 IOPS의 절반만 전달"했으며, 논문은 모든 IO가 QEMU를 통과하는 경로를 원인으로 설명합니다. 랜덤 read 지연은 KVM에서 2~3배 늘었습니다 `Ⓑ`.

Kata에서는 공유 파일시스템 선택까지 확인해야 합니다. virtio-9p의 순차 read는 91–98 MB/s인 반면 virtio-fs+DAX는 660–703 MB/s였습니다 `Ⓑ`. 파일 4개를 동시에 여는 시나리오에서는 DAX 구성이 2~3 GB/s, 베이스라인은 300~400 MB/s였습니다.

StackHPC의 2019년 측정(Kata 1.6.2, 9p 시절, BeeGFS/NVMe over 100G IB)에서는 bare metal read 대역폭의 약 15%만 나왔습니다. 순차 read 1클라이언트 p50 지연은 bare metal 1,581µs 대비 Kata 4,112µs로 늘었습니다 `Ⓑ`. 이런 격차는 Kata 2.0부터 virtio-fs가 기본이 된 배경입니다. Middleware '21도 "virtio-fs는 9P를 크게 앞서는 유망한 대안"이라고 평가합니다.

## 4. 네트워크 — 대역폭과 지연의 순위가 다르다

대역폭 측정에서는 링크가 먼저 포화되는지 확인해야 합니다. Felter의 10GbE 환경에서는 native·Docker·KVM이 모두 9.3Gbps였습니다. NSDI처럼 loopback으로 링크 제약을 걷어낸 측정에서는 아래와 같이 VMM 사이의 격차가 드러납니다.

{{< lane src="_lane/4-대역폭.json" />}}

처리량이 링크 속도에 도달해도 CPU 비용과 왕복 지연은 남습니다. Felter는 자신의 실험 환경에서 "vhost는 복잡한 네트워크 가속 기술 없이도 네트워크 처리량 문제를 직설적으로 해결한다. NIC이 더 있다면 이 서버는 40Gbps 이상을 밀어낼 수 있을 것"이라고 적었습니다. 이 실험의 오버헤드는 바이트당 CPU 사이클과 netperf 왕복 지연에 나타났습니다. NAT은 지연을 2배로 늘렸고, KVM은 트랜잭션당 30µs를 더해 80%를 늘렸습니다 `Ⓑ`.

다음 RTT 차트에서도 대역폭과 다른 순위를 볼 수 있습니다. 대역폭에서 host급이던 Firecracker는 RTT에서는 순위가 내려갑니다.

{{< lane src="_lane/4-rtt.json" />}}

Firecracker에서는 패킷이 게스트와 호스트 양쪽의 네트워크 스택을 통과합니다. 이 경로에서 생기는 왕복 비용은 대역폭만으로 드러나지 않습니다. 연결 수립도 별도로 봐야 합니다. Quark 논문의 TCP 연결 수립 시간은 runC-Flannel 504.65µs, Kata-Flannel 834.6µs였습니다 `Ⓑ`.

HTTP에서도 처리량과 지연을 함께 확인해야 합니다. 2026년 wrk 측정의 처리량은 아래와 같습니다.

{{< lane src="_lane/4-http-처리량.json" />}}

Kata는 처리량이 −89%, gVisor는 −42%였습니다 `Ⓑ`. 그런데 같은 측정의 평균 지연에서는 gVisor가 runc보다 34% 낮게 나옵니다.

{{< lane src="_lane/4-http-지연.json" />}}

처리량 손실과 낮은 평균 지연이 함께 나온 결과는 병렬 처리의 제약을 의심하게 하지만, 이 두 값만으로 원인을 확정할 수는 없습니다. 평균 지연이 낮다는 결과를 다른 부하 조건이나 꼬리 지연까지 확대해서도 안 됩니다.

Middleware '21에서는 하이퍼바이저(TAP+virtio-net) 경로의 처리량이 약 −25%, bridge가 −9~10%였고, gVisor의 p90 지연은 경쟁자의 3~4배였습니다. 저자들은 Kata가 bridge와 QEMU TAP+virtio-net을 둘 다 쓰기 때문에 "가장 약한 고리인 QEMU 쪽 성능과 같아야 하고, 실제로 그렇다"고 설명합니다. 앞의 wrk 평균 지연과는 실험 조건과 지표가 다르므로 같은 순위로 합칠 수 없습니다. KubeVirt 바인딩별 iperf 대조표는 공개된 것을 찾지 못했습니다 `?`.

## 5. 기동 시간의 측정 구간

기동 시간은 시작점과 끝점을 확인한 뒤 비교해야 합니다. 아래 차트에서도 측정 구간이 다른 결과는 같은 막대에 올리지 않았습니다.

{{< lane src="_lane/5-기동-시간.json" />}}

NSDI 2020은 Firecracker가 애플리케이션 코드까지 125ms 미만으로 뜬다고 밝히지만, Middleware '21이 잰 Firecracker end-to-end는 350ms입니다. NSDI는 패치된 커널이 부팅 중 특수 장치에 남기는 타임스탬프까지의 구간을, Middleware는 프로세스 생성부터 종료까지를 잽니다. Middleware 저자는 NSDI 방식이 "왜곡됐다"고 직접 비판합니다.

NSDI는 부팅 시간을 좌우하는 요인도 분해했습니다. 압축 커널 해제가 +40ms, Ubuntu 기본 커널 사용이 +900ms, 시리얼 콘솔 로깅 끄기가 −70ms입니다 `Ⓑ`. 이 측정에서는 런타임 선택뿐 아니라 커널 이미지와 로깅 설정이 기동 시간에 크게 작용합니다.

Ant Group의 실험적 PVM 경로에서 claim-to-Ready는 사전부팅 풀이 없을 때 8.806초, 준비된 샌드박스가 하나 있을 때 1.385초입니다 `Ⓥ`. 별도로 생성 시간을 125ms, 생성률을 초당 8건으로 놓고 리틀의 법칙을 적용하면 `125ms × 8/s = 1`입니다. 이는 평균적으로 생성 중인 샌드박스가 1개라는 계산입니다.

Docker 데몬을 경유하는 측정에서는 gVisor가 runc보다 빠르게 나오기도 합니다. 데몬의 오버헤드가 런타임 사이의 차이를 가리기 때문입니다. HotCloud '19가 잰 동시성 없는 생명주기 전체(setup+teardown)는 runc 1.014초, gVisor+KVM 1.117초, gVisor+ptrace 1.181초로 격차가 크지 않았습니다 `Ⓑ`. 이 값에는 종료까지 포함되므로, Kata·Firecracker의 수백 ms대 부팅 수치와 나란히 놓고 VM과 프로세스의 기동 비용을 비교할 수는 없습니다.

## 6. 메모리 바닥값과 밀도

VMM 자체의 비공유 세그먼트만 재면 VM 크기와 무관한 상수입니다. 아래 차트는 VMM별 고정 메모리 비용의 차이를 보여줍니다. 이 값은 게스트 메모리나 파드 전체 오버헤드와 구분해야 합니다.

{{< lane src="_lane/6-vmm-메모리.json" />}}

128MB짜리 마이크로 VM에서는 QEMU의 131MB가 VM 본체보다 큽니다. gVisor도 빈 컨테이너에서는 5.79배(+18.7MiB)까지 벌어지지만, Redis처럼 1GB를 쓰는 워크로드에서는 1.02배로 희석됩니다. 워크로드가 작을수록 고정 비용이 전체 메모리에서 차지하는 비율이 커집니다 `Σ`.

AKS의 RuntimeClass overhead는 VMM 자체 메모리와 달리 VM 크기에 따라 절대량도 늘어납니다. 128Mi 파드 VM에는 16Mi(12.5%), 128Gi 파드 VM에는 1Gi(0.8%)가 붙습니다 `✓`.

{{< lane src="_lane/6-aks-오버헤드.json" />}}

위 차트에서 오버헤드 비율은 128Mi의 12.5%에서 128Gi의 0.78%로 낮아지고, 호스트 컴포넌트 여유는 450~490Mi 선에 수렴합니다. VMM 자체의 고정 비용과 RuntimeClass에 잡히는 전체 오버헤드는 같은 값이 아닙니다. 밀도를 계산할 때는 필요한 파드 수에 각 파드의 절대 오버헤드를 반영해야 하며, 작은 파드를 많이 띄우는 구성일수록 그 비율이 불리합니다 `Σ`. **VM 메모리 오버헤드는 "VM이라서" 비싼 게 아니라 "워크로드가 작아서" 비싼 것**입니다 `Σ`.

KubeVirt에서는 VM 크기뿐 아니라 장치와 CPU 구성도 오버헤드에 영향을 줍니다. 다음 차트는 구성별 계산값을 비교합니다.

{{< lane src="_lane/6-kubevirt-오버헤드.json" />}}

기본 구성(8GiB/4vCPU)의 오버헤드는 296Mi이며, 그래픽·전용 CPU를 더하면 428Mi, VFIO(GPU·SR-IOV) 패스스루를 더하면 1,452Mi로 늘어납니다. VFIO는 게스트 RAM 전체를 lock해야 하며, 이 구성의 오버헤드 계산에는 1Gi가 추가됩니다.

Red Hat의 스케일 테스트에서 실측한 virt-launcher 파드당 메모리 오버헤드는 약 288MB로, 기본 구성의 계산값과 가까웠습니다 `Ⓥ`. VM당 게스트 RAM을 10MB로 작게 잡았는데도 이 비용은 남았습니다. 소스 코드 상수를 조립한 계산값과 실측이 크게 어긋나지 않는다는 근거입니다.

같은 테스트에서는 노드당 400개 VMI를 띄웠습니다(목표는 500이었으나 테스트베드 불안정으로 미달). 100개를 생성하는 데 약 200초, 200개에는 약 600초가 걸렸고, 300개 구간의 생성률은 분당 약 48 VMI였습니다 `Ⓥ`. 메모리상 수용 가능한 수와 원하는 시간 안에 생성할 수 있는 수는 별도로 확인해야 합니다.

## 7. 워크로드별로 대조할 측정값

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

계산 중심 배치 작업은 CPU·메모리 대역폭부터, 요청이 잦은 API 서버는 IO·네트워크부터 대조하면 됩니다. 각 행은 서로 다른 측정 조건의 결과이므로, 내 워크로드의 병목과 해당 실험의 조건이 맞는지 확인한 뒤 재측정할 축을 고르는 데 사용해야 합니다.

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
