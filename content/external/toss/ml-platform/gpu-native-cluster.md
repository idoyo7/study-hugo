---
title: "GPU-aware를 넘어 GPU-native로 가는 토스증권의 쿠버네티스 GPU 클러스터"
description: "토스증권이 쿠버네티스 위에 GPU 클러스터를 만들고 GPU 상태 판단, 서비스 투입 기준, 자원 분할과 배치를 하나씩 보완한 과정을 정리했습니다. nvidia-validator 보완, Xid 알럿, GPU 시범운행, MIG와 Packed Allocation 업스트림 기여가 중심입니다."
date: 2026-11-14
weight: 2
---

# GPU-aware를 넘어 GPU-native로 가는 토스증권의 쿠버네티스 GPU 클러스터 (2026-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [토스증권이 GPU-aware를 넘어 GPU-native 클러스터를 구축한 방법](https://toss.tech/article/gpu-native-cluster)
- 매체 · 게시일: 토스 기술 블로그 · 2026-09-15
- 저자: 장재영 (Data Infra 팀 Data Engineer), 김진웅 (ML Platform 팀)
- 시리즈: 원문 말미에서 MIG 도입 과정은 이전 글 "GPU를 밀도 있게 쓰는 방법: 토스증권의 GPU 가상화(MIG) 도입기"에서 자세히 다뤘다고 안내합니다.
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 문제 배경 {#배경}

토스증권의 서비스와 데이터 플랫폼은 쿠버네티스 위에서 돌아가고 수백 명의 개발자가 이 환경에서 서비스를 운영합니다. AI 서비스도 같은 기반을 쓰도록 GPU 워크로드를 기존 클러스터 안에서 실행하게 해야 했습니다. 지난 상반기 Data Infra 팀과 ML Platform 팀이 함께 GPU 클러스터를 구축했고, 원문은 그 과정의 문제와 해결을 다룹니다.

첫 과제는 쿠버네티스가 GPU를 자원으로 인식해 할당하고 컨테이너에서 쓰게 하는 것이었습니다. 원문은 이 상태를 GPU-aware라고 부릅니다. 그 뒤에도 문제가 남았습니다. 노드가 `Ready`여도 개별 GPU에는 오류가 있을 수 있었고, 점검을 마친 노드를 언제 다시 투입해도 되는지 기준도 필요했으며, 서비스마다 필요한 크기가 다른데 GPU를 한 장씩 주는 방식은 비효율적이었습니다. 이런 운영 조건까지 갖춘 상태를 팀은 GPU-native라고 부릅니다. 토스증권은 멀티테넌트 GPU 클러스터를 운영하며 조건을 하나씩 갖췄고 필요한 경우 업스트림에도 기여했습니다.

쿠버네티스 쪽에서도 관련 변화가 이어집니다. DRA(Dynamic Resource Allocation)는 GPU 한 개가 아니라 필요한 조건을 가진 장치를 요청하고 할당받게 하므로, 팀이 지난 2년 동안 별도 구성 요소와 운영 로직으로 보완한 문제 중 일부가 쿠버네티스 자체에서도 다뤄지고 있는 셈이라고 원문은 짚습니다.

## GPU-aware 클러스터의 네 단계 {#gpu-aware}

GPU 한 장이 파드에서 쓰이기까지 네 단계를 거칩니다.

- 하드웨어와 드라이버: 서버에 GPU가 있고 운영체제가 쓸 수 있도록 NVIDIA 커널 드라이버가 준비돼야 합니다. 없으면 OS부터 GPU를 장치로 인식하지 못합니다.
- NVIDIA Container Toolkit: 컨테이너 런타임과 드라이버를 이어서 할당된 GPU를 컨테이너가 쓰게 합니다. 이 연결이 없으면 노드가 GPU를 인식해도 컨테이너에서는 못 씁니다.
- NVIDIA Device Plugin: 노드의 GPU를 kubelet에 등록합니다. kubelet은 이를 Capacity와 Allocatable에 `nvidia.com/gpu`로 반영하고, 스케줄러가 이 값으로 GPU를 요청한 파드를 배치합니다.
- 파드 계층: 파드 스펙에서 `nvidia.com/gpu`를 요청하면 앞 단계의 경로로 GPU가 연결됩니다.

어느 단계에 문제가 생겨도 결과는 비슷해서, 노드에는 GPU가 있는데 쿠버네티스 자원으로 안 보이거나 파드가 배치됐는데 GPU를 쓰지 못합니다. 드라이버, Toolkit, Plugin을 각각 설치하고 호환 버전과 설정을 유지하는 일은 운영 부담이고, 노드가 늘수록 구성 차이가 장애로 이어질 가능성이 커집니다.

## GPU-aware만으로 부족했던 이유 {#한계}

CPU와 시스템 메모리는 리눅스 cgroup으로 컨테이너 단위 제어가 되고 한도를 넘으면 커널이 개입합니다. GPU 메모리는 이 제어 경로에 들어 있지 않습니다. Device Plugin과 kubelet은 어떤 GPU를 컨테이너에 줄지 정하고 Container Toolkit은 선택된 디바이스(`/dev/nvidia*`, `libcuda.so` 등)를 연결하지만, 쿠버네티스가 제어하는 경계는 거기까지입니다. `nvidia.com/gpu: 1`은 장치 하나를 할당한다는 뜻이지 VRAM 크기나 연산 비율을 지정하는 것이 아니고, `memory: 4Gi`처럼 `vram: 40Gi`를 요청하는 표준 자원도 없습니다. VRAM이 모자라면 애플리케이션이 CUDA OOM을 만나는데 쿠버네티스 이벤트만으로는 원인을 진단하기 어렵고, 파드가 끝난 뒤 GPU가 정상으로 돌아왔는지도 기본 이벤트와 자원 상태로는 충분히 확인할 수 없습니다.

운영을 위해 답해야 할 질문은 세 가지였습니다.

- Node Ready는 GPU Ready인가: Node Ready는 노드와 kubelet의 기본 동작을 보여줄 뿐 개별 GPU와 스택의 정상 여부를 뜻하지 않습니다. 노드가 Ready이고 파드가 Running이어도 특정 GPU에서는 이미 `ERR!` 상태나 Xid 오류가 났을 수 있습니다.
- 언제 GPU 노드를 서비스에 투입할 수 있는가: 신규 노드가 자원으로 등록됐다는 사실만으로는 서비스 워크로드를 받을 준비가 끝났다고 볼 수 없습니다. 장애 점검 뒤 돌아온 장비에도 같이 적용할 투입 기준이 필요했습니다.
- GPU 한 장은 적절한 제공 단위인가: `nvidia.com/gpu` 같은 확장 리소스는 정수 단위로만 요청할 수 있어서 CPU처럼 0.5를 요청할 수 없습니다. GPU를 나눈 뒤에도 조각을 여러 물리 GPU에 분산할지 한 GPU부터 채울지가 남습니다.

## Node Ready와 GPU Ready의 분리 {#gpu-ready}

팀은 `GPU Ready`를 별도의 운영 기준으로 정의했습니다. GPU 실행 경로가 모두 동작하는지, 기대한 GPU 자원이 노출되는지, 개별 장치 상태 조회가 정상인지, 복구가 필요한 오류가 없는지를 함께 보는 기준이며, 판단에는 실행 전 스택 검증, 실행 중 상태 관측, 장애 신호와 대응의 연결이라는 세 관점이 필요했습니다.

### nvidia-validator 보완 {#validator}

`nvidia-validator`는 드라이버, Container Toolkit, Device Plugin, CUDA가 기본 검증을 통과했는지 봅니다. 그런데 통과가 곧 모든 GPU가 정상이라는 뜻은 아니었습니다. 운영 중인 H100 노드 하나에서 `dcgm-exporter`가 nvml error: unknown error로 `CrashLoopBackOff`에 빠졌는데, 노드에서 `nvidia-smi`를 보니 H100 네 장 중 한 장이 `ERR!` 상태였습니다. 당시 validator는 이 노드를 정상으로 봤습니다. 드라이버 검증이 `nvidia-smi`의 종료 코드에 의존했고, 개별 GPU가 `ERR!`여도 명령 자체는 `exit 0`이었기 때문입니다.

그래서 NVIDIA의 기본 검증 체계는 유지하고, 팀의 운영 기준으로 readiness를 판단하는 별도 DaemonSet을 구성했습니다. 이 DaemonSet은 `nvidia-smi` 출력의 `ERR!`, 치명적인 Xid, Device Plugin이 보여주는 GPU 수와 실제 PCI 디바이스 수의 차이를 함께 봅니다. 핵심은 종료 코드만 보던 검사를 출력과 커널 로그(`dmesg`)까지 보도록 바꾼 것입니다.

```
SMI_OUTPUT=$(chroot /host nvidia-smi 2>&1); SMI_EXIT=$?
if [ $SMI_EXIT -ne 0 ]; then rm -f /run/nvidia/validations/driver-ready
elif echo "$SMI_OUTPUT" | grep -qi "ERR!"; then rm -f /run/nvidia/validations/driver-ready
elif chroot /host dmesg -T | tail -500 | grep -qE "Xid.*: (109|120|79|119|63|64)"; then rm -f ...
else touch /run/nvidia/validations/driver-ready; fi
```

판정 결과는 노드별 메트릭으로 노출합니다. 드라이버, Container Toolkit, Device Plugin, CUDA 네 readiness 신호가 모두 1이어야 실행 경로가 정상이라고 보며, 물리 GPU 수와 노출된 자원 수, 마지막 검증 성공 시각은 장치 누락이나 검증 중단을 찾는 보조 기준입니다. 대시보드에서는 이 네 신호를 PromQL로 묶어 모두 통과하면 Healthy로 판정합니다.

### DCGM Exporter 상시 관측 {#dcgm}

검증 시점에 스택이 정상이라는 것과 워크로드 실행 중 GPU 상태를 아는 것은 다른 문제입니다. DCGM Exporter는 GPU 사용률, VRAM, 온도, 전력, ECC·Xid 오류, PCIe·NVLink 상태를 Prometheus 메트릭으로 노출해, 쿠버네티스 이벤트로는 안 보이는 GPU 내부 상태를 관측 체계로 가져옵니다. 팀은 메트릭 수를 늘리기보다 운영자가 답해야 할 질문에 맞춰 지표를 묶었습니다. `DCGM_FI_DEV_GPU_UTIL`은 작업이 실행되는지를 보여주지만 서빙 워크로드가 연산 유닛을 얼마나 쓰는지 판단하려면 `DCGM_FI_PROF_SM_ACTIVE` 같은 프로파일링 지표를 함께 봐야 했습니다.

### Xid 알럿 {#xid}

Xid는 NVIDIA 드라이버가 GPU 관련 오류를 감지해 커널 로그에 남기는 보고입니다. 이 신호는 쿠버네티스 이벤트에서 보이지 않아서, 서빙 워크로드가 CUDA나 NVML 오류로 실패해도 파드, 노드, 특정 GPU 중 어디가 원인인지 알 수 없습니다. 반대로 Xid가 보인다고 바로 노드 장애로 판단할 수도 없습니다. 예를 들어 `Xid 31`은 GPU 메모리 페이지 폴트로 주로 애플리케이션의 잘못된 메모리 접근에서 나오지만 드라이버나 하드웨어 문제일 가능성도 있습니다. 그래서 어떤 워크로드에서 났는지, 같은 GPU에서 반복되는지, readiness 신호와 함께 볼 때 워크로드를 계속 받아도 되는지를 같이 봐야 했고, Xid를 노드·GPU·워크로드 정보를 함께 전달하는 알럿으로 구성했습니다.

실제 사례로 운영 중인 H100 한 장에서 HBM의 복구 불가능한 메모리 오류인 DBE(Double Bit Error)가 났습니다. 그 GPU를 쓰던 vLLM 엔진이 두 차례 종료됐고 Xid 알럿과 readiness 신호가 같은 시간대에 바뀌었으며, 워크로드는 다른 노드로 재스케줄돼 서비스는 이어졌습니다. 하지만 파드 종료만으로는 애플리케이션 문제인지 GPU 하드웨어 문제인지 구분하기 어려웠을 것이라고 원문은 말합니다. Xid 기반 가시성이 있었기에 신호를 하나의 장애 흐름으로 읽을 수 있었습니다.

{{% details title="사례의 Xid 해석과 주요 지표" closed="true" %}}
| 항목 | 내용 |
|---|---|
| Xid 48·171 | HBM에서 복구 불가능한 DBE 발생 |
| Xid 94 | 오류가 GPU 전체로 확산되지 않고 해당 vLLM 워크로드에 격리 |
| Xid 63 | row remapping 기록 |
| Xid 154 | 드라이버가 GPU를 비우고 리셋해야 한다는 복구 동작 요구 |
| `gpu_operator_node_driver_ready` | 드라이버가 살아 있는가 |
| `gpu_operator_node_toolkit_ready` | Container Toolkit이 동작하는가 |
| `gpu_operator_node_plugin_ready` | Device Plugin이 GPU를 노출하는가 |
| `gpu_operator_node_cuda_ready` | CUDA 워크로드가 실제로 실행되는가 |
| `gpu_operator_nvidia_pci_devices_total` vs `gpu_operator_node_device_plugin_devices_total` | 장착된 GPU 수와 노출된 GPU 수, 어긋나면 이상 |
| `DCGM_FI_DEV_FB_USED/FREE/TOTAL` | 쿠버네티스 표준 자원이 아닌 VRAM 사용량 |
| `DCGM_EXP_GPU_HEALTH_STATUS` | DRIVER, MEM, NVLINK, PCIE, POWER, SM, THERMAL 상태 |
{{% /details %}}

## 검증된 노드만 투입하는 GPU 시범운행 {#시범운행}

Blackwell 시리즈를 도입하면서 위의 판단 기준을 신규 장비 투입에도 적용해야 했습니다. 새 GPU 아키텍처가 들어오면 하드웨어만이 아니라 드라이버, CUDA, Device Plugin, GPU Operator, DCGM, MIG 구성, 실제 서빙까지 다시 맞춰야 합니다. 팀은 운영 중 정립한 기준을 투입 전 검증 절차로 묶어 GPU 시범운행(preflight)으로 구현했습니다. 검증 순서는 이렇습니다.

- 표준 스펙 정합성: OS, 커널, 드라이버, CUDA 버전부터 커널 모듈, sysctl 튜닝값까지 수십 개 항목을 정의해 둔 표준 매트릭스와 대조
- 하드웨어 검증: `dcgmi diag`로 GPU에 부하를 가하는 burn-in과 NVLink 대역폭 같은 물리 성능 실측
- 쿠버네티스 편입 상태: Device Plugin의 GPU 자원 노출, GPU Feature Discovery(GFD)의 모델·MIG 가능 여부 라벨 확인
- CUDA 런타임 검증: CUDA 커널을 실제 실행하고 연산 결과 확인
- 서빙 워크로드 검증: 아주 작은 LLM을 잠깐 띄워 모델 로드와 토큰 출력 확인

토스증권 미션 문구 "투자의 힘을 모두에게"를 담은 프롬프트에 새 GPU가 다음 토큰을 이어 출력하면 최종 검증이 통과됩니다. 드라이버가 로드되는 것만으로는 서비스 워크로드가 돈다고 볼 수 없어서 CUDA 커널과 작은 LLM 서빙까지 통과 조건으로 삼았습니다. 각 관문 결과는 메트릭으로 수집되고 모두 통과한 노드에만 `preflight=passed` 라벨이 붙습니다. 이 라벨은 서비스 스케줄링 게이트로 쓰여, 통과한 노드는 cordon을 해제하고 하나라도 실패한 노드는 cordon을 유지합니다. 신규 노드와 하드웨어 점검 뒤 복귀한 노드 모두 이 관문을 넘어야 스케줄 대상이 됩니다.

## MIG 분할과 Packed Allocation {#mig}

서비스에 맞는 크기로 GPU를 제공하려고 토스증권은 MIG(Multi-Instance GPU)를 택했습니다. MIG는 GPU를 하드웨어 수준에서 독립 인스턴스로 쪼개 조각마다 연산 유닛과 메모리를 물리적으로 격리합니다. 도입 과정은 이전 글에서 다뤘다고 합니다. 문제는 MIG 인스턴스를 수동으로 관리하는 비용으로, 노드마다 접속해 필요한 크기의 인스턴스를 만들고 구성이 바뀔 때마다 다시 설정해야 했습니다. 이를 줄이려고 MIG Manager를 썼습니다. 원하는 구성을 ConfigMap에 정의하고 노드 라벨로 적용할 구성을 고르면 각 노드의 GPU가 선언한 구성대로 자동 설정됩니다.

조각을 만드는 것과 효율적으로 배치하는 것은 별개입니다. MIG Manager는 구성을 만들고 어떤 인스턴스를 워크로드에 줄지는 Device Plugin이 정합니다. Device Plugin의 기본 정책인 Distributed Allocation은 MIG 조각을 여러 물리 GPU에 골고루 배치하는데, 그 결과 조각이 몇 개뿐이어도 여러 GPU가 부분 점유됐습니다. Full GPU를 확보하거나 MIG 프로파일을 바꾸려면 여러 GPU를 함께 비워야 해서 구성을 유연하게 전환하기 어려웠습니다.

그래서 MIG 인스턴스를 한 물리 GPU부터 채워 완전히 빈 GPU를 남기는 Packed Allocation이 필요했습니다. 팀은 사용자가 배치 정책을 고르는 `allocationPolicy` 개념과 Packed Allocation을 구현해 NVIDIA k8s-device-plugin에 제안했고(PR #1621), 변경은 업스트림에 머지되어 v0.20.0부터 `sharedDevicesAllocationPolicy`(`packed`/`distributed`) 설정으로 제공됩니다.

## 정리 {#정리}

원문의 결론은 GPU를 인식하고 할당하는 GPU-aware 클러스터는 시작일 뿐이라는 것입니다. 팀은 GPU 스택 검증과 DCGM·Xid 관측으로 Node Ready와 GPU Ready를 구분했고, 시범운행으로 서비스 투입 기준을 세웠으며, MIG로 필요한 단위의 GPU를 제공하고 Packed Allocation으로 배치 방식을 보완했습니다. 이 과정에는 쿠버네티스 운영 경험과 GPU·모델 서빙 이해가 함께 필요했고, Data Infra 팀과 ML Platform 팀이 각자의 경험으로 문제를 함께 풀었다고 합니다.
