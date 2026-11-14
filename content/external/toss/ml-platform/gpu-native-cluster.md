---
title: "GPU-native로 전환한 토스증권 쿠버네티스 클러스터"
description: "노드가 Ready여도 개별 GPU의 정상 여부는 따로 확인해야 합니다. 토스증권은 GPU Ready와 시범운행으로 서비스 투입 기준을 세우고, MIG와 Packed Allocation으로 GPU를 나누고 배치했습니다."
date: 2026-11-14
weight: 2
---

# GPU-native로 전환한 토스증권 쿠버네티스 클러스터 (2026-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [토스증권이 GPU-aware를 넘어 GPU-native 클러스터를 구축한 방법](https://toss.tech/article/gpu-native-cluster)
- 매체 · 게시일: 토스 기술 블로그 · 2026-09-15
- 저자: 장재영 (Data Infra 팀 Data Engineer), 김진웅 (ML Platform 팀)
- 시리즈: 원문 말미에서 MIG 도입 과정은 이전 글 "GPU를 밀도 있게 쓰는 방법: 토스증권의 GPU 가상화(MIG) 도입기"에서 자세히 다뤘다고 안내합니다.
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 정상 판정을 통과한 H100의 오류 {#배경}

토스증권이 운영하던 H100 노드에서 `dcgm-exporter`가 `nvml error: unknown error`를 내며 `CrashLoopBackOff`에 빠졌습니다. `nvidia-smi`로 확인하니 H100 네 장 중 한 장이 `ERR!` 상태였습니다. 그런데 `nvidia-validator`는 이 노드를 정상으로 보고 있었습니다.

GPU를 사용할 수 있게 만드는 일과 정상적으로 운영하는 일 사이에는 이런 틈이 있었습니다. 토스증권의 서비스와 데이터 플랫폼은 수백 명의 개발자가 사용하는 쿠버네티스를 기반으로 합니다. AI 서비스도 같은 기반에서 운영하려고, 지난 상반기 Data Infra 팀과 ML Platform 팀이 함께 기존 클러스터에 GPU 워크로드를 실행할 환경을 구축했습니다. 쿠버네티스 운영 경험에 GPU와 모델 서빙에 관한 이해가 함께 필요한 작업이었습니다.

토스증권은 쿠버네티스가 GPU를 인식하고 할당하며 컨테이너에서 사용할 수 있게 된 상태를 GPU-aware라고 부릅니다. 여러 팀이 GPU를 함께 쓰려면 여기서 더 나아가야 했습니다. 개별 GPU의 정상 여부를 판단하고, 신규 장비나 점검을 마친 장비의 투입 기준을 세우며, 서비스에 맞는 크기로 자원을 나누고 배치해야 했습니다. 이런 운영 조건까지 갖춘 상태가 팀이 말하는 GPU-native입니다.

## VRAM까지 닿지 않는 쿠버네티스의 제어 경로 {#gpu-aware}

GPU를 파드에 연결하는 출발점은 호스트입니다. 서버에 GPU가 있어도 NVIDIA 커널 드라이버가 없으면 운영체제가 장치를 인식하지 못합니다. 그다음에는 NVIDIA Container Toolkit이 컨테이너 런타임과 드라이버를 연결해야 합니다. 노드가 GPU를 인식하는 것만으로 컨테이너에서 GPU를 쓸 수 있는 것은 아닙니다.

쿠버네티스에 GPU 자원을 알리는 역할은 NVIDIA Device Plugin이 맡습니다. Plugin이 노드의 GPU를 kubelet에 등록하면, kubelet은 Capacity와 Allocatable에 `nvidia.com/gpu`를 반영합니다. 스케줄러는 이 값을 보고 GPU를 요청한 파드를 배치합니다. 사용자가 파드 스펙에 `nvidia.com/gpu`를 요청해야 앞서 준비한 경로를 따라 GPU가 컨테이너에 연결됩니다.

어느 연결이 끊겨도 증상은 비슷합니다. 노드에는 GPU가 있는데 쿠버네티스 자원으로 보이지 않거나, 파드는 배치됐는데 컨테이너에서 GPU를 쓰지 못합니다. 드라이버와 Container Toolkit, Device Plugin의 호환 버전과 설정을 유지하는 일도 남습니다. 노드가 늘수록 같은 구성을 유지하기 어려워지고, 구성 차이가 장애로 이어질 가능성도 커집니다.

이 경로를 모두 연결해도 GPU 내부 자원을 제어하는 문제는 남습니다. CPU와 시스템 메모리는 리눅스 cgroup으로 컨테이너별 사용량을 제한하고, 한도를 넘으면 커널이 개입합니다. GPU 메모리는 이 제어 경로에 포함되지 않습니다. Device Plugin과 kubelet이 할당할 GPU를 정하면 Container Toolkit이 `/dev/nvidia*` 디바이스와 `libcuda.so` 같은 드라이버 라이브러리를 연결하지만, 쿠버네티스의 제어는 그 경계에서 멈춥니다.

`nvidia.com/gpu: 1`은 장치 하나를 할당한다는 뜻입니다. 그 안에서 사용할 VRAM 크기나 연산 비율까지 정하지는 않습니다. 시스템 메모리의 `memory: 4Gi`처럼 `vram: 40Gi`를 요청하는 표준 자원도 없습니다. VRAM이 부족하면 애플리케이션은 CUDA OOM을 만나지만, 쿠버네티스 이벤트만으로 원인을 진단하기는 어렵습니다. 파드가 종료된 뒤 GPU가 정상으로 돌아왔는지도 기본 이벤트와 자원 상태만으로는 충분히 확인할 수 없습니다.

쿠버네티스 자체에서도 관련 변화가 이어지고 있습니다. DRA(Dynamic Resource Allocation)는 단순히 GPU 한 개를 요청하는 데서 나아가, 필요한 조건을 가진 장치를 요청하고 할당받는 기능입니다. 토스증권이 지난 2년 동안 별도 구성 요소와 운영 로직으로 보완해 온 문제 중 일부를 쿠버네티스 자체에서도 다루고 있습니다.

## 출력과 커널 로그까지 살피는 GPU Ready {#gpu-ready}

토스증권은 노드 상태와 별도로 `GPU Ready`를 판단했습니다. `Node Ready=True`는 kubelet이 정상적으로 상태를 보고하고, 노드가 파드를 실행할 기본 조건을 갖췄다는 뜻입니다. `Pod Running`도 파드의 실행 단계를 나타낼 뿐, GPU 워크로드의 정상 동작을 보장하지 않습니다. 팀에는 GPU 실행 경로와 자원 노출, 개별 장치의 상태, 복구가 필요한 오류를 함께 확인하는 기준이 필요했습니다.

앞선 H100 사례에서 오류를 놓친 이유는 종료 코드에 있었습니다. `nvidia-validator`는 드라이버, Container Toolkit, Device Plugin, CUDA의 기본 동작을 검증하는데, 드라이버 검증은 `nvidia-smi` 명령의 성공 여부에 의존했습니다. 개별 GPU에 `ERR!`가 표시돼도 명령 자체는 `exit 0`으로 끝났습니다. 기본 검증을 통과했다는 사실과 모든 GPU가 정상이라는 판단이 어긋난 지점입니다.

팀은 NVIDIA의 기본 검증 체계를 유지하면서 별도 DaemonSet을 구성했습니다. 이 DaemonSet은 `nvidia-smi`의 종료 코드뿐 아니라 출력에 담긴 `ERR!`, 커널 로그의 치명적인 Xid도 검사합니다. Device Plugin이 노출한 GPU 수와 실제 PCI 디바이스 수의 차이도 함께 확인하도록 했습니다.

```
SMI_OUTPUT=$(chroot /host nvidia-smi 2>&1); SMI_EXIT=$?
if [ $SMI_EXIT -ne 0 ]; then rm -f /run/nvidia/validations/driver-ready
elif echo "$SMI_OUTPUT" | grep -qi "ERR!"; then rm -f /run/nvidia/validations/driver-ready
elif chroot /host dmesg -T | tail -500 | grep -qE "Xid.*: (109|120|79|119|63|64)"; then rm -f ...
else touch /run/nvidia/validations/driver-ready; fi
```

판정 결과는 노드별 메트릭으로 노출합니다. 드라이버, Container Toolkit, Device Plugin, CUDA의 readiness 신호가 모두 1이어야 GPU 실행 경로가 정상이라는 기준입니다. 대시보드에서는 관련 검증 지표를 PromQL로 묶어 모두 통과했을 때 Healthy로 표시합니다. 물리 GPU 수와 노출된 자원 수는 장치 누락을, 마지막 검증 성공 시각은 검증 자체의 중단을 찾는 보조 기준으로 사용했습니다.

## 다음 토큰까지 확인하는 GPU 시범운행 {#시범운행}

토스증권의 GPU 시범운행(preflight)은 작은 LLM이 토큰을 출력하는 데까지 진행합니다. 드라이버가 로드됐다는 사실만으로 서비스 워크로드가 동작한다고 판단할 수 없었기 때문입니다. 검증 예시에서는 `"토스증권 - 투자의 힘을 모두에게"`라는 프롬프트 뒤에 `"전하다"`가 이어졌습니다.

이 절차를 마련한 계기는 Blackwell 시리즈 도입이었습니다. 새 GPU 아키텍처를 들이면 드라이버와 CUDA부터 NVIDIA Device Plugin, GPU Operator, DCGM, MIG 구성, 실제 서빙 워크로드까지 다시 맞춰 봐야 합니다. 팀은 운영 중 세운 판단 기준을 투입 전 검증 절차로 묶었습니다. 장치가 동작하는지를 넘어, 토스증권의 서비스 워크로드를 받을 준비가 됐는지 확인하는 과정입니다.

검증은 표준 스펙 대조에서 시작합니다. OS·커널·드라이버·CUDA 버전과 커널 모듈, sysctl 튜닝값 등 수십 개 항목을 팀이 정의한 표준 매트릭스와 비교합니다. 이어 `dcgmi diag`로 GPU에 실제 부하를 가하는 burn-in 테스트를 수행하고, NVLink 대역폭 같은 물리 성능도 실측합니다.

하드웨어 검증 뒤에는 쿠버네티스에 제대로 편입됐는지 확인합니다. Device Plugin이 GPU를 자원으로 노출하는지, GPU Feature Discovery(GFD)가 GPU 모델과 MIG 가능 여부 같은 노드 특성을 라벨로 표시하는지 검사하는 단계입니다. 이후 CUDA 커널을 실행해 연산 결과를 확인하고, 마지막으로 아주 작은 LLM을 잠깐 띄워 모델 로드와 토큰 출력까지 검증합니다.

통과 여부는 스케줄링에 바로 연결됩니다. 각 관문의 결과를 메트릭으로 수집하고, 모든 검증을 통과한 노드에만 `preflight=passed` 라벨을 붙입니다. 이 라벨을 서비스 스케줄링 게이트로 삼아 통과한 노드는 cordon을 해제하고, 하나라도 실패한 노드는 cordon 상태로 유지합니다. 신규 노드뿐 아니라 하드웨어 점검을 마치고 복귀한 노드에도 같은 투입 기준을 적용했습니다.

## 운영 중인 GPU에서 이어지는 장애 신호 {#runtime-signals}

### 연산 유닛의 활용을 보여 주는 DCGM Exporter {#dcgm}

투입 전 검증을 통과해도 관측은 계속됩니다. 워크로드가 실행되는 동안 GPU 사용량과 상태는 변하기 때문입니다. DCGM Exporter는 사용률과 VRAM, 온도, 전력, ECC·Xid 오류, PCIe·NVLink 상태를 Prometheus 메트릭으로 노출합니다. 쿠버네티스 이벤트나 Node Ready만으로 보이지 않던 GPU 내부 상태를 확인하는 경로입니다.

팀은 지표를 많이 모으기보다 운영 판단에 맞춰 묶었습니다. GPU가 작업을 실행하는지 확인할 때는 `DCGM_FI_DEV_GPU_UTIL`을 봅니다. 서빙 워크로드가 연산 유닛을 얼마나 활용하는지까지 판단하려면 `DCGM_FI_PROF_SM_ACTIVE` 같은 프로파일링 지표가 함께 필요했습니다. VRAM 사용량과 장치의 건강 상태도 각각 별도의 지표로 살폈습니다.

### vLLM 종료의 원인을 드러낸 Xid 알럿 {#xid}

Xid는 NVIDIA 드라이버가 GPU 오류를 감지해 커널 로그에 남기는 보고입니다. 쿠버네티스 이벤트에는 나타나지 않습니다. 서빙 워크로드가 CUDA나 NVML 오류로 실패했을 때 쿠버네티스 이벤트만 보면, 원인이 파드인지 노드인지 특정 GPU인지 구분하기 어렵습니다.

그렇다고 Xid 발생을 곧바로 노드 장애로 해석할 수도 없습니다. 예를 들어 `Xid 31`은 GPU 메모리 페이지 폴트이며, 주로 애플리케이션의 잘못된 메모리 접근에서 발생하지만 드라이버나 하드웨어 문제일 가능성도 있습니다. 어떤 워크로드에서 발생했는지, 같은 GPU에서 반복되는지, readiness 신호까지 함께 봤을 때 워크로드를 계속 받아도 되는지를 판단해야 했습니다. 팀은 이를 위해 노드·GPU·워크로드 정보를 함께 전달하는 Xid 알럿을 구성했습니다.

이 연결은 H100 한 장에서 HBM의 복구 불가능한 메모리 오류인 DBE(Double Bit Error)가 발생했을 때 쓰였습니다. 해당 GPU를 사용하던 vLLM 엔진이 두 차례 종료됐고, 같은 시간대에 Xid 알럿과 GPU readiness 신호도 변했습니다. 워크로드는 다른 노드로 재스케줄돼 서비스는 이어졌습니다. 파드 종료 기록만으로는 구분하기 어려웠던 하드웨어 오류의 흐름을 함께 읽을 수 있었습니다.

신호는 메모리 오류에서 복구 요구까지 이어졌습니다. HBM에서 발생한 DBE는 GPU 전체로 확산되지 않고 해당 vLLM 워크로드에 격리됐습니다. 이후 row remapping이 기록됐고, 드라이버는 GPU를 비우고 리셋하라는 복구 동작을 요구했습니다. Xid를 오류 횟수로만 세지 않고, 격리와 복구, 재투입 여부를 결정하는 근거로 사용한 사례입니다.

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

## MIG 조각을 한 GPU부터 채우는 Packed Allocation {#mig}

정상 여부와 투입 기준을 마련한 뒤에도 자원을 제공하는 단위가 문제로 남았습니다. 서비스마다 필요한 연산량과 VRAM, 격리 수준은 다릅니다. 하지만 `nvidia.com/gpu` 같은 확장 리소스는 정수 단위로만 요청할 수 있어, CPU의 0.5코어처럼 나눠 요청할 수 없습니다. 서비스마다 GPU 한 장을 제공하는 방식으로는 자원을 효율적으로 쓰기 어려웠습니다.

토스증권은 MIG(Multi-Instance GPU)를 선택했습니다. MIG는 GPU를 하드웨어 수준에서 독립 인스턴스로 나누고, 각 조각의 연산 유닛과 메모리를 물리적으로 격리합니다. 조각마다 별도의 GPU처럼 동작하는 방식입니다. MIG 도입 과정은 이전 글 「GPU를 밀도 있게 쓰는 방법: 토스증권의 GPU 가상화(MIG) 도입기」에서 자세히 다뤘습니다.

분할에는 관리 비용이 따랐습니다. 노드마다 접속해 필요한 크기의 MIG 인스턴스를 만들고, 구성이 바뀔 때마다 다시 설정해야 했습니다. 팀은 이 작업을 MIG Manager에 맡겼습니다. 원하는 구성을 ConfigMap에 정의하고 노드 라벨로 적용할 구성을 선택하면, 각 노드의 GPU가 선언한 구성에 맞게 자동 설정됩니다.

MIG Manager가 조각을 만든 뒤에는 배치 방식이 남습니다. 워크로드에 어떤 인스턴스를 할당할지는 NVIDIA Device Plugin이 결정합니다. 기본 정책인 Distributed Allocation은 MIG 조각을 여러 물리 GPU에 골고루 배치했습니다. 사용하는 조각이 몇 개뿐이어도 여러 GPU가 부분적으로 점유되는 결과였습니다.

토스증권에는 완전히 비어 있는 GPU도 필요했습니다. 서비스의 요구에 따라 Full GPU와 여러 MIG 프로파일 사이를 전환해야 했기 때문입니다. 조각이 흩어져 있으면 Full GPU를 확보하거나 MIG 프로파일을 바꿀 때 여러 GPU를 함께 비워야 했습니다. 한 물리 GPU부터 MIG 인스턴스를 채우는 Packed Allocation은 빈 GPU를 남기기 위한 배치 방식이었습니다.

팀은 사용자가 배치 정책을 선택하는 `allocationPolicy` 개념과 Packed Allocation을 구현해 NVIDIA k8s-device-plugin에 제안했습니다(PR #1621). 변경은 업스트림에 머지됐습니다. v0.20.0부터 `sharedDevicesAllocationPolicy` 설정에서 `packed`와 `distributed`를 선택할 수 있습니다.
