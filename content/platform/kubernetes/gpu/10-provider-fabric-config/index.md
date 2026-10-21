---
title: "10 제공자가 GPU 파드보다 먼저 맞추는 NVLink·패브릭 설정"
description: "2026-10-21 기준으로 GPU 클러스터 제공자가 NVLink와 노드 간 패브릭을 준비할 때 확인할 조건을 설명한다. FM·IMEX의 관리 범위를 나누고, InfiniBand·RoCE의 공개 사례와 설정 부담을 선택 근거로 삼는다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 10
url: "/kubernetes/gpu/10-provider-fabric-config/"
---

# 10 · 제공자가 GPU 파드보다 먼저 맞추는 NVLink·패브릭 설정

## 1. 파드 초기화 오류에서 패브릭 상태로 거슬러 올라간다

NVSwitch 노드에서 GPU Operator 검증기 파드가 `error code system not yet initialized` 오류로 종료되면 Fabric Manager(FM)이 떠 있는지부터 봅니다. GPU Operator 트러블슈팅 문서는 이 오류가 나는 경우 대부분 해당 노드에 FM이 없다고 설명합니다. 이 설명대로라면 파드의 초기화 실패는 대개 호스트의 FM 문제에서 시작합니다.

이때 `nvidia-smi -q`의 Fabric 섹션은 다음과 같습니다.

```text
Fabric
     State                             : In Progress
     Status                            : N/A
     CliqueId                          : N/A
     ClusterUUID                       : N/A
```

정상 상태는 `State`가 `Completed`, `Status`가 `Success`입니다. NVSwitch SXid 오류는 호스트 syslog와 FM 로그에 남습니다. 패브릭에서 제외된 GPU는 `nvidia-smi -B`와 `/proc/driver/nvidia/gpus/<PCI_ID>/information`에서 확인할 수 있습니다.

아래 도식은 파드의 초기화 실패에서 시작해 FM과 패브릭 상태로 원인을 좁혀 가는 순서입니다.

{{< flow src="_flow/2-fm-상태-판정.json" />}}

Kubernetes에서는 GPU Operator가 FM 배포를 맡습니다. GPU Operator 1.8부터 드라이버 컨테이너가 NVSwitch를 감지하면 FM을 자동으로 띄우며, 현행 트러블슈팅 문서도 같은 동작을 설명합니다. 로그는 드라이버 데몬셋 파드의 `nvidia-driver-ctr` 컨테이너 안에 있는 `/var/log/fabricmanager.log`에서 읽습니다. 호스트에 드라이버를 설치했다면 호스트의 같은 경로를 봅니다.

앞선 편들이 파드와 스케줄러에서 출발했다면, 이 편은 제공자가 준비하는 통신 경로를 따라갑니다. 노드 안과 NVL72 랙 안의 NVLink 패브릭을 구성한 뒤, 노드 간 네트워크를 선택하고 RoCE 설정을 맞추는 데까지 범위를 잡았습니다.

패브릭 초기화 상태를 확인한 뒤에는 개별 NVLink 상태를 살펴봅니다. `nvidia-smi nvlink`의 옵션으로는 링크 상태를 보는 `-s`, 에러 카운터를 읽는 `-e`, 레인별 CRC를 보는 `-ec`, 카운터를 초기화하는 `-re`, 처리량을 읽는 `-gt`가 알려져 있습니다. 이 목록은 2차 자료가 옮긴 도움말에서 확인했으며 드라이버마다 다릅니다. 실제 노드에서는 `nvidia-smi nvlink --help`를 먼저 확인하는 편이 안전합니다.

프로그램에서 카운터를 읽을 때는 NVML API의 `nvmlDeviceGetNvLinkErrorCounter`를 사용합니다. 카운터를 지속적으로 수집하는 방법은 [11편]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}})의 DCGM 절에서 다룹니다.

노드 안 토폴로지를 읽는 방법은 [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}}), ComputeDomain이 IMEX를 파드 단위로 묶는 방식은 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에서 다뤘습니다. 패브릭 정보를 라벨로 스케줄러에 알리는 일은 [04편]({{< relref "/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md" >}}), 스토리지 트래픽을 compute 패브릭에서 떼어내는 이유는 [09편]({{< relref "/platform/kubernetes/gpu/09-storage-reality/index.md" >}})에 있습니다. 토폴로지 설계, NCCL 설정, 인수 검증, 멀티테넌시는 [11편]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}})으로 이어집니다.

근거 표기 — `✓` 1차 출처 확인 · `Ⓥ` 벤더 주장 · `≈` 추정 · `?` 미확인 · `Σ` 종합 판단. 각 절 끝의 '근거와 측정 조건'에 조건과 출처를 모았습니다. 조사 기준일은 2026-10-21이며 Fabric Manager 사용자 가이드 v2.6, IMEX 가이드, GPU Operator 26.7.2 문서, NCCL 2.32.3 환경 변수 문서, Cumulus Linux 5.18 문서를 봤습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 조사 범위 | FM 가이드 v2.6, GPU Operator 26.7.2, NCCL 2.32.3, Cumulus Linux 5.18 | 각 NVIDIA 문서 | `✓` |
| IMEX 가이드 갱신일 | 2025-07-02 | IMEX 가이드 | `✓` |
| 데이터센터 드라이버 브랜치 | R615, R610, R595, R590, R580이 색인에 있음. production 여부 표기는 없음 | 데이터센터 드라이버 색인 | `✓` |
| 미동작 증상 | `system not yet initialized`, Fabric State `In Progress`, 정상은 `Completed`/`Success` | GPU Operator 트러블슈팅, FM 사용자 가이드 | `✓` |
| 제외 GPU 확인 | `nvidia-smi -B`, `/proc/driver/nvidia/gpus/<PCI_ID>/information` | FM 사용자 가이드 | `✓` |
| Operator의 FM 자동 배포 | 1.8부터. 로그는 `nvidia-driver-ctr` 안 `/var/log/fabricmanager.log` | GPU Operator 1.8 릴리스 노트, 트러블슈팅 | `✓` |
| `nvidia-smi nvlink` 옵션 | `-s` 상태, `-e` 에러 카운터, `-ec` 레인별 CRC, `-re` 초기화, `-gt` 처리량. 드라이버마다 다름 | 2차 자료가 옮긴 도움말 | `≈` |
| NVML 카운터 | `nvmlDeviceGetNvLinkErrorCounter` | NVML API 문서 | `✓` |

{{% /details %}}

## 2. FM은 GPU 세대와 장애 정책에 맞춰 구성한다

FM은 NVSwitch 커널 드라이버와 짝을 이루는 특권 프로세스입니다. NVSwitch 메모리 패브릭을 구성하고 NVLink를 감시합니다. 링크가 학습되는 과정과 패브릭이 구성되는 과정은 구분해야 합니다. Hopper의 3세대 NVSwitch에서는 NVLink 학습이 ALI 기반이어서 링크 학습에 FM이 필요하지 않지만, 패브릭 구성은 여전히 FM이 맡습니다.

Blackwell HGX의 4세대 NVSwitch에는 FM과 함께 NVLSM(NVLink Subnet Manager)이 필요합니다. FM 서비스가 둘을 함께 띄우며, NVSwitch는 CX7 브리지 디바이스로 연결됩니다. FM과 NVLSM은 소켓으로 통신하므로 `FM_SM_IPC_INTERFACE` 경로와 NVLSM의 `plugin_options grpc_mgr --grpc_server_address` 값이 같아야 합니다. B200과 B300에서는 `TOPOLOGY_FILE_PATH`가 적용되지 않고 `nvswitch-audit`도 지원하지 않습니다.

설치할 패키지도 세대와 드라이버 브랜치에 맞춰 고릅니다. 최소 드라이버는 HGX A100이 450, HGX H100이 525, HGX B200·B300·B100이 570입니다. 4세대 이전 시스템에서는 Debian과 Ubuntu의 `cuda-drivers-fabricmanager-<branch>` 패키지 또는 RHEL의 `nvidia-driver:<branch>/fm` 모듈을 사용합니다. 4세대이면서 드라이버가 620 미만이면 `nvidia-open-<branch>`와 `nvlink5-<branch>`를 설치합니다.

FM 사용자 가이드는 드라이버 620부터 FM이 자체 버전을 갖고 GPU 드라이버와 따로 설치된다고 설명합니다. 가이드의 버전 검사 기준은 `libnvidia-fmdrv.so.1` 라이브러리입니다. 4세대 이전 시스템에서는 이 라이브러리 버전이 FM 버전과 같아야 합니다. 드라이버 620이 실제로 어떤 상태인지는 확인하지 못했습니다.

설정 파일은 `/usr/share/nvidia/nvswitch/fabricmanager.cfg`입니다. 여기서는 실행 모드뿐 아니라 링크나 스위치가 실패했을 때 패브릭을 어떻게 처리할지도 정합니다.

| 키 | 기본값 | 의미 |
|---|---|---|
| `FABRIC_MODE` | 0 | 0은 베어메탈·풀 패스스루, 1은 Shared NVSwitch 멀티테넌시, 2는 vGPU 멀티테넌시 |
| `FM_STAY_RESIDENT_ON_FAILURES` | 0 | 1이면 장애 뒤에도 FM이 남지만 CUDA 실행은 `cudaErrorSystemNotReady`로 실패 |
| `ACCESS_LINK_FAILURE_MODE` | 0 | GPU와 NVSwitch 사이 링크 장애 시 0이면 해당 GPU를 라우팅에서 제외(베어메탈) |
| `TRUNK_LINK_FAILURE_MODE` | 0 | 베이스보드 2장 시스템 전용. 0이면 베어메탈에서 FM이 중단되고 시스템이 초기화되지 않음 |
| `NVSWITCH_FAILURE_MODE` | 0 | 0이면 베어메탈에서 FM 중단. 1이면 해당 NVSwitch와 짝을 끄고 6개 대역 중 5개로 운영 |
| `ABORT_CUDA_JOBS_ON_FM_EXIT` | 1 | FM 종료 시 실행 중 CUDA 잡을 중단. H100 이후에는 효과 없음 |
| `PARTITION_RAIL_POLICY` | greedy | NVLink Encryption을 쓰면 `symmetric` |
| `FM_CMD_BIND_INTERFACE` / `FM_CMD_PORT_NUMBER` | 127.0.0.1 / 6666 | shared·vGPU 모드의 API 인터페이스 |

스위치 하나가 고장 나면 베어메탈 노드 전체가 올라오지 않는 쪽이 기본 동작입니다. 일부 대역을 잃더라도 계속 운영하려면 `NVSWITCH_FAILURE_MODE`를 1로 바꿔야 합니다. 어느 정책을 택할지는 제공자의 SLA에 달려 있습니다.

서비스는 `systemctl`로 관리하고 로그는 `journalctl -u nvidia-fabricmanager`로 확인합니다. FM 가이드는 서비스를 중지하면 패브릭 상태가 사라지고, 복구하려면 패브릭의 모든 GPU를 리셋해야 한다고 경고합니다. 문서가 직접 말하는 내용은 아니고, 이 글의 추정으로는 실행 중인 노드의 FM 재시작은 드레인을 전제로 해야 합니다.

GPU Operator 26.7.2 릴리스 노트에 따르면 NVLink5 이상인 HGX B200·B300에서 드라이버 컨테이너가 띄운 `nvlsm`이 `ib_umad` 모듈을 사용하면서 컨테이너형 DOCA-OFED 드라이버 업데이트를 막을 수 있습니다. 문서는 호스트에 설치한 DOCA-OFED나 OS 기본 드라이버를 권합니다. 우회책으로는 `network.nvidia.com/operator.mofed.wait` 라벨을 쓰는 기본이 아닌 `NVIDIADriver` 리소스를 제시합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| FM의 역할 | NVSwitch 메모리 패브릭 구성, NVLink 감시. NVSwitch 커널 드라이버와 짝 | FM 사용자 가이드 | `✓` |
| Hopper | NVLink 학습이 ALI 기반이라 링크 학습에 FM 불필요, 패브릭 구성은 FM | FM 사용자 가이드 | `✓` |
| Blackwell HGX | FM 옆에 NVLSM 필요. `FM_SM_IPC_INTERFACE`와 NVLSM의 gRPC 서버 주소를 맞춤. CX7 브리지 | FM 사용자 가이드 | `✓` |
| B200/B300 제약 | `TOPOLOGY_FILE_PATH` 미적용, `nvswitch-audit` 미지원 | FM 사용자 가이드 | `✓` |
| 최소 드라이버 | HGX A100 450, H100 525, B200/B300/B100 570 | FM 사용자 가이드 | `✓` |
| 설치 패키지 | 4세대 이전은 `cuda-drivers-fabricmanager-<branch>` 또는 RHEL `nvidia-driver:<branch>/fm`. 4세대와 620 미만은 `nvidia-open-<branch>`와 `nvlink5-<branch>` | FM 사용자 가이드 | `✓` |
| 620부터 FM 분리 | FM이 독자 semver(2.0.x)를 갖고 드라이버와 따로 설치. 버전 검사는 `libnvidia-fmdrv.so.1` 기준 | FM 사용자 가이드 | `✓` |
| 설정 키 기본값 | 위 표의 값 | FM 사용자 가이드 v2.6 | `✓` |
| 서비스 중지 경고 | 패브릭 상태가 사라지고 모든 GPU 리셋 필요 | FM 사용자 가이드 | `✓` |
| 26.7.2 알려진 문제 | `nvlsm`이 `ib_umad`를 잡아 컨테이너형 DOCA-OFED 업데이트를 막을 수 있음 | GPU Operator 26.7.2 릴리스 노트 | `✓` |

{{% /details %}}

## 3. MIG와 가상화가 NVLink 사용 조건을 바꾼다

MIG를 사용하는 GPU에서는 파티션 활성화에 성공해도 NVLink가 학습되지 않을 수 있다는 점이 함정입니다.

FM 가이드는 다음 모델을 설명합니다. 파티션은 최대 64개, 16 GPU까지 지원합니다.

- 베어메탈
- 풀 패스스루: 2·4 GPU VM에서는 대역이 줄어듦
- Shared NVSwitch: 신뢰된 Service VM이 패브릭을 관리하며 1·2·4·8 GPU VM 지원. 가이드가 권장하는 모델
- vGPU: SR-IOV VF만 게스트에 제공

GPU Operator 23.3부터 24.3 릴리스 노트에는 NVSwitch 베어메탈 노드에서 vGPU를 지원하지 않는다고 적혀 있습니다.

MIG가 패브릭 초기화와 다른 기능에 미치는 영향은 다음과 같습니다.

- H100 이후에서는 MIG가 켜진 GPU의 NVLink가 학습되지 않는다. 멀티 GPU 파티션 활성화 자체는 성공한다.
- Shared NVSwitch 모드에서는 MIG가 켜진 GPU가 하나라도 있으면 `--restart` 없는 FM 초기화가 중단된다.
- A100 vGPU 모드에서 FM을 시작하기 전에 MIG를 켜면 그 GPU가 들어간 파티션이 제거된다.
- GPU Operator 25.3.2 노트에 따르면 Grace 기반 시스템의 드라이버 580.65.06이 기본으로 켜는 CDMM은 MIG, GPUDirect Storage와 호환되지 않는다.

MIG 노드와 NVLink 노드를 같은 풀에 섞으면 증상이 원인과 떨어진 곳에서 나타날 수 있습니다. 이 글의 판단으로는 MIG를 쓰는 노드를 별도 풀로 나누는 편이 안전합니다. 문서가 제시한 권고는 아닙니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| 가상화 모델 | 4가지, 파티션 최대 64개 16 GPU | FM 사용자 가이드 | `✓` |
| NVSwitch 베어메탈 vGPU | 23.3~24.3 노트에서 미지원 | GPU Operator 릴리스 노트 | `✓` |
| MIG와 NVLink | H100 이후 MIG GPU는 NVLink 미학습. Shared NVSwitch에서 MIG GPU가 있으면 `--restart` 없는 초기화 중단. A100 vGPU에서 FM 전 MIG 활성화 시 파티션 제거 | FM 사용자 가이드 | `✓` |
| CDMM | Grace 기반, 드라이버 580.65.06이 기본 활성화, MIG·GPUDirect Storage와 비호환 | GPU Operator 25.3.2 릴리스 노트 | `✓` |
| MIG 노드를 별도 풀로 | 위 사실에서 이끌어 낸 판단 | — | `Σ` |

{{% /details %}}

## 4. NVL72에서는 랙 전체를 관리한다

GB200과 GB300 NVL72에서는 NVLink 패브릭이 노드 한 대를 넘어 랙 전체로 확장됩니다. 랙 안은 NVLink, 랙 사이는 InfiniBand로 연결합니다. Mission Control 2.0 관리 가이드에 따르면 랙은 출하 시 72 GPU 하나짜리 Default Partition으로 구성됩니다. 관리자가 사용자 파티션으로 나눌 수 있지만, 문서는 보안 요구가 강하지 않으면 Default Partition을 쓰라고 권합니다.

관리 서비스는 스위치 트레이와 컴퓨트 트레이로 나뉩니다. 먼저 스위치 트레이입니다. 스위치 트레이의 NMX Controller(NMX-C)는 GB200에서 Subnet Manager와 Global Fabric Manager 기능을 호스팅합니다. NMX-Telemetry(NMX-T)와 NMX-Manager(NMX-M)도 NMX 구성에 포함됩니다. 리더 스위치인 NVSWITCH-1의 NVOS에서 NMX-C와 NMX-T가 실행됩니다.

리더 스위치에서는 다음 NVOS 명령으로 관리 앱과 파티션 상태를 확인하고 파티션을 변경합니다.

```text
nv show cluster app          # nmx-controller, nmx-telemetry가 ok인지
nv show sdn partition        # 파티션 목록과 상태
nv action create|update|delete|restore sdn partition <id> ...
```

문서의 예시 출력에서 Default Partition은 ID `32766`, 72 GPU, 상태 `healthy`, 복원력 모드 `adaptive_bandwidth`로 표시됩니다. 복원력 모드에는 `full_bandwidth`, `adaptive_bandwidth`, `user_action`이 있고, 멀티캐스트 한도는 0에서 1024까지입니다. BCM이 노출하는 NMX-M 메트릭으로는 `nmxm_gpu_health_count{parameter=healthy|degraded|nonvlink|degraded_bw}`, `nmxm_switch_health_count{parameter=healthy|unhealthy|missing_nvlink}`, `nmxm_compute_allocation_count` 등이 있습니다.

컴퓨트 트레이 쪽은 IMEX가 담당합니다. `nvidia-imex-<driver-branch>` 패키지에 포함된 `nvidia-imex` systemd 서비스이며, 설치만으로 자동 enable되지는 않습니다. 설정 파일은 `/etc/nvidia-imex/config.cfg`입니다.

| 키 | 값 | 의미 |
|---|---|---|
| `IMEX_NODE_CONFIG_FILE` | `/etc/nvidia-imex/nodes_config.cfg` | 도메인에 속한 노드 IP 목록 |
| `SERVER_PORT` | 50000 | IMEX 서버 포트 |
| `IMEX_CMD_PORT` | 50005 | 명령 포트 |
| `IMEX_WAIT_FOR_QUORUM` | `RECOVERY` | 쿼럼 대기 방식 |
| `IMEX_ENABLE_AUTH_ENCRYPTION` | 0 | 1이면 `SSL_TLS`, GSSAPI 인증과 암호화 |

IMEX는 시작할 때 로드된 커널 드라이버 스택의 버전을 검사하고, 버전이 맞지 않으면 중단합니다. 도메인 전체 상태는 `nvidia-imex-ctl -N`으로 확인하며, 호스트 이름을 표시하려면 `-H`를 사용합니다. 정상일 때는 노드마다 `READY`가 표시되고 연결 행렬은 모두 `C`이며, 마지막 줄은 `Domain State: UP`입니다.

Kubernetes에서는 DRA 드라이버의 ComputeDomain이 IMEX 데몬, 도메인, 채널을 조율합니다. 운영자가 노드마다 IMEX를 직접 띄우는 일을 이 계층이 맡는 것입니다. k8s-dra-driver-gpu README는 ComputeDomain 안의 파드끼리만 MNNVL로 통신하도록 격리한다고 설명합니다.

GPU Operator 26.7.0의 `GPUCluster` 리소스는 DRA 드라이버, ComputeDomain, DCGM, exporter, 검증 워크로드를 함께 배포합니다. `ClusterPolicy`와 공존할 수 없으며 Kubernetes 1.34.2 이상, 드라이버 580 이상, CDI 런타임이 필요합니다.

워크로드의 NCCL이 MNNVL 경로를 사용하려면 `NCCL_MNNVL_ENABLE`과 `NCCL_CUMEM_ENABLE` 설정이 맞아야 합니다. NVLink 도메인에 속한 모든 노드에서 IMEX 도메인도 동작 중이어야 합니다. GB200의 MNNVL에는 NCCL 2.25.2 이상이 필요합니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| NVL72 기본 파티션 | 72 GPU 하나짜리 Default Partition. 보안 요구가 약하면 그대로 쓰라고 권고. 랙 안 NVLink, 랙 사이 InfiniBand | Mission Control 2.0 관리 가이드 | `✓` |
| NMX 구성 | NMX-C(SM과 Global FM 기능 호스팅), NMX-T, NMX-M. 리더 스위치 NVOS에서 NMX-C·NMX-T 구동 | Mission Control 2.0 관리 가이드, NMX Controller 문서 | `✓` |
| NVOS 명령 | `nv show cluster app`, `nv show sdn partition`, `nv action ... sdn partition` | Mission Control 2.0 관리 가이드 | `✓` |
| 예시 파티션 | ID 32766, 72 GPU, healthy, adaptive_bandwidth. 복원력 모드 3종, 멀티캐스트 한도 0~1024 | Mission Control 2.0 관리 가이드 | `✓` |
| NMX-M 메트릭 | `nmxm_gpu_health_count`, `nmxm_switch_health_count`, `nmxm_compute_health_count`, `nmxm_compute_allocation_count` | Mission Control 2.0 관리 가이드 | `✓` |
| IMEX 서비스와 설정 | `nvidia-imex` 서비스, 자동 enable 안 됨, 위 표의 키와 기본값 | IMEX 가이드 | `✓` |
| IMEX 상태 확인 | `nvidia-imex-ctl -N`, 정상은 `READY`·`C`·`Domain State: UP`. 드라이버 스택 버전 불일치 시 중단 | IMEX 가이드 | `✓` |
| ComputeDomain | IMEX 데몬·도메인·채널을 조율, CD 안 파드끼리만 MNNVL | k8s-dra-driver-gpu README | `✓` |
| `GPUCluster` 리소스 | 26.7.0. `ClusterPolicy`와 공존 불가, K8s 1.34.2+, 드라이버 580+, CDI 필요 | GPU Operator 릴리스 노트 | `✓` |
| NCCL의 MNNVL | `NCCL_MNNVL_ENABLE`(0/1/2), `NCCL_CUMEM_ENABLE`, 동작 중인 IMEX 도메인. GB200은 NCCL 2.25.2 이상 | NCCL 환경 변수 문서, GB200 Multi-Node Tuning Guide | `✓` |

{{% /details %}}

## 5. 노드 간 패브릭은 공개 사례와 운영 부담으로 고른다

InfiniBand와 RoCE(이더넷 기반 RDMA)의 지연과 테일 지연을 같은 조건에서 비교한 1차 측정은 찾지 못했습니다. 여기서는 공개된 구축 사례와 설정 부담을 선택 근거로 삼습니다.

NVIDIA의 SuperPOD 레퍼런스 아키텍처는 B300에 Quantum-X800 InfiniBand(XDR)를 쓰는 판과 Spectrum-4 이더넷(Spectrum-X)을 쓰는 판을 모두 제공합니다. Azure와 NVIDIA의 발표문에 따르면 Azure의 GB300 NVL72 클러스터는 랙 사이를 ConnectX-8과 Quantum-X800 InfiniBand로 연결했습니다. 발표한 구성은 GPU당 800 Gb/s의 full fat-tree non-blocking입니다.

Google Cloud의 GPU 네트워크 대역 문서는 A3 Ultra와 A4가 ConnectX-7 8개로 RoCE 기반 GPUDirect RDMA를 사용하고, A3 Mega는 GPUDirect-TCPXO를 사용한다고 설명합니다. Meta도 2024년 엔지니어링 블로그와 SIGCOMM 논문에서 AI 용량 대부분을 RoCEv2 백엔드 패브릭으로 운영한다고 밝혔습니다. Meta는 학습 전용 백엔드를 적재·체크포인트·로깅을 맡는 프론트엔드와 분리하고, 2단 Clos 구조의 AI Zone 위에 집계 계층을 구성했습니다.

xAI Colossus가 Spectrum-X를 사용한다는 근거는 NVIDIA 보도자료입니다. 같은 자료의 약 95% 처리량과 플로 충돌 손실 없음이라는 수치는 NVIDIA의 발표 주장으로 읽어야 합니다. Spectrum-X 제품 페이지의 "기존 이더넷 대비 AI 네트워킹 성능 1.6배" 역시 비교 기준이 정의되지 않은 벤더 수치라 선택 근거로 쓰기 어렵습니다.

Dell'Oro의 분석은 이더넷 비중이 커지고 있다고 봅니다. Dell'Oro의 2026-06-02 분석에 따르면 2026년 1분기 AI 백엔드 네트워크의 이더넷 스위치 매출은 두 배 넘게 늘어 AI 클러스터 데이터센터 스위치 매출의 약 3분의 2를 차지했습니다. 같은 분기에 InfiniBand 매출도 세 배 넘게 늘었습니다. Dell'Oro는 Blackwell Ultra와 함께 공급한 800G 스위치와 기존 설치 기반의 업그레이드를 그 배경으로 설명합니다. 이 글의 종합 판단으로는 신규 대규모 구축은 이더넷으로 기울고 있지만, NVIDIA의 XDR SuperPOD 레퍼런스와 일부 하이퍼스케일러는 InfiniBand를 유지하는 상태로 보입니다.

운영자가 설정해야 하는 범위는 UFM과 Cumulus 문서의 구성에서 차이가 드러납니다. InfiniBand는 Subnet Manager(UFM 또는 OpenSM)가 경로, 파티션, 적응형 라우팅을 중앙에서 관리합니다. RoCE는 스위치마다 PFC(우선순위별 흐름 제어), ECN(명시적 혼잡 알림), 버퍼, DSCP 매핑을 맞추고 NIC의 트러스트 모드도 일치시켜야 합니다. 문서 구성을 비교한 판단이지만, RoCE를 선택할 때는 이 정합을 관리하는 부담이 더 드러납니다. Meta도 InfiniBand와의 정면 비교는 싣지 않았고, RoCE의 흐름 제어가 더 거칠어 버퍼 튜닝이 어렵다고만 적었습니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Meta의 RoCEv2 | AI 용량 대부분을 RoCEv2 백엔드로 운영, 프론트엔드와 분리, 2단 Clos AI Zone | Meta 엔지니어링 블로그, SIGCOMM'24 논문 | `✓` |
| IB와 비교 | 정면 비교 벤치마크 없음. RoCE 흐름 제어가 거칠어 버퍼 튜닝이 더 어렵다는 서술만 있음 | Meta 엔지니어링 블로그 | `✓` |
| SuperPOD RA | B300 + Quantum-X800 XDR판(2026-09-02 갱신)과 B300 + Spectrum-4판(2025-11-19 갱신) | SuperPOD B300 레퍼런스 아키텍처 | `✓` |
| Azure GB300 | 랙 간 ConnectX-8 + Quantum-X800 InfiniBand, GPU당 800 Gb/s, full fat-tree non-blocking | Azure 블로그, NVIDIA 블로그 | `Ⓥ` |
| Google Cloud | A3 Mega는 GPUDirect-TCPXO, A3 Ultra·A4는 CX-7 8개 RoCE GPUDirect RDMA | Google Cloud GPU 네트워크 대역 문서 | `✓` |
| xAI Colossus | Spectrum-X(SN5600 + BlueField-3 SuperNIC). 약 95% 처리량, 플로 충돌 손실 없음 | NVIDIA 보도자료 | `Ⓥ` |
| 시장 | 2026년 1분기 이더넷 매출 두 배 이상, AI 클러스터 스위치 매출의 약 3분의 2. IB 매출은 세 배 이상 | Dell'Oro 2026-06-02 | `Ⓥ` |
| 2025년 역전 | 2025년에 이더넷이 IB를 넘어섰고 2년 전 IB는 AI 백엔드 스위치 매출의 80% 가까이 | Dell'Oro 2026 전망 | `Ⓥ` |
| 현황 종합 | 신규는 이더넷 쪽, NVIDIA XDR 레퍼런스와 일부 하이퍼스케일러는 IB 유지 | 위 자료를 종합 | `≈` |
| 같은 조건 지연·테일 | 1차 측정을 찾지 못함 | — | `?` |
| Spectrum-X 1.6배 | 기준 "traditional/off-the-shelf Ethernet"이 정의되지 않음 | NVIDIA 제품 페이지 | `Ⓥ` |
| 설정 부담 차이 | IB는 SM이 중앙 관리, RoCE는 스위치마다 PFC·ECN·버퍼·DSCP 맞춤 | UFM·Cumulus 문서 구조 | `≈` |

{{% /details %}}

## 6. RoCE 우선순위를 통신자부터 스위치까지 맞춘다

RoCE를 선택했다면 스위치, NIC, NCCL이 같은 우선순위를 가리키도록 설정해야 합니다. 어느 한 곳이 어긋나면 PFC가 걸리지 않거나 혼잡 신호가 돌아오지 않습니다.

아래 도식은 RoCE 설정이 이어지는 경로를 한 방향으로 보여줍니다. 스위치 큐의 PFC pause는 표시하지 않았습니다.

{{< flow src="_flow/6-roce-설정-경로.json" />}}

통신을 시작하는 NCCL부터 보면, NCCL 2.32u1부터 `NCCL_IB_TC`와 `NCCL_IB_SL`의 기본값은 AUTO입니다. 통신자에 traffic class가 없으면 0이 됩니다. 문서가 직접 말하는 내용은 아니고, 이 글의 추정으로는 아래 Cumulus 기본값처럼 스위치가 DSCP 26을 무손실로 분류한다면 NCCL 트래픽도 같은 클래스로 표시되도록 운영자가 맞춰야 합니다. `NCCL_IB_ADAPTIVE_ROUTING`의 기본값은 InfiniBand에서 켜짐, RoCE에서 꺼짐입니다.

ConnectX NIC에서는 `mlnx_qos -i <if> --trust dscp`로 DSCP 트러스트를 켜고 `--dscp2prio`로 매핑합니다. 현재 상태도 같은 명령으로 읽습니다. RDMA-CM의 ToS를 `cma_roce_tos -d <dev> -t 106`으로 맞추는 설정은 커뮤니티에서 흔히 쓰입니다. 106은 DSCP 26에 ECN ECT 비트를 더한 값입니다. 이 설정의 근거는 대학 HPC 팀의 템플릿 같은 2차 자료입니다.

Kubernetes에서 Network Operator의 Spectrum-X 경로를 쓰면 NIC Configuration Operator가 Spectrum-X 프로필로 펌웨어를 맞춥니다. Spectrum-X Operator는 PF마다 `flow_steering_mode=hmfs`와 eSwitch `switchdev`를 적용하고, 하드웨어 멀티플레인이면 `esw_multiport=true`와 DOCA xPlane도 적용합니다. 생성한 OVSNetwork의 RDMA QoS는 `rdmaQoS: {tos: 96, tc: 96}`입니다. 지원 NIC은 ConnectX-8과 BlueField-3 SuperNIC으로 한정됩니다. 멀티플레인의 `hwplb` 모드는 26.4 문서에 tech preview, 26.7 문서에 GA로 적혀 있으므로 사용하는 버전의 문서를 확인해야 합니다.

스위치에서는 트래픽 분류와 큐 설정을 확인합니다. Cumulus Linux 5.18은 `nv set qos roce`와 `nv config apply`로 기본 lossless RoCE를 켭니다. 다른 모드에는 `lossy`, `lossless-single-ipool`, `lossy-multi-tc`, Beta인 `dci-1`이 있으며, 해제할 때는 `nv unset qos roce`를 사용합니다.

| 항목 | 기본값 |
|---|---|
| PFC | switch-priority 3에서 rx/tx 활성, `cable-length 100` |
| RoCE 분류 | PCP 3 / DSCP 26 → switch-priority 3. 기본 표는 DSCP 24~31을 SP3로 매핑 |
| CNP 분류 | PCP 6 / DSCP 48 → switch-priority 6 |
| 트래픽 클래스 | SP3 → TC3(RoCE, DWRR 50%), SP6 → TC6(CNP, strict priority), 나머지 TC0(DWRR 50%) |
| ECN | `min-threshold 146.48 KB`, `max-threshold 1.43 MB`, `probability 100` |
| LLDP app TLV | UDP 4791, priority 3 |

Cumulus 문서 안에서도 ECN 임계값 표기가 서로 어긋나며, Spectrum-4의 하드웨어 값은 156 KB로 다릅니다. 임계값은 장비에서 읽은 값으로 확인해야 합니다. 상태 확인 명령은 `nv show qos roce`, `nv show interface <id> qos roce status`, `nv show interface <id> qos roce counters`입니다.

Cumulus의 적응형 라우팅은 기본으로 꺼져 있으며 `nv set router adaptive-routing state ...`로 켭니다. 큐 점유와 포트 사용률을 기준으로 경로를 고르지만 L3 서브인터페이스, SVI, 본드에서는 지원하지 않습니다. 5.13부터는 설정을 적용할 때 switchd가 재시작됩니다.

SONiC에서는 `config_db` 키로 분류와 큐를 구성합니다. `PORT_QOS_MAP`에 `pfc_enable: "3,4"`, `dscp_to_tc_map`, `tc_to_pg_map`, `tc_to_queue_map`, `pfc_to_queue_map`을 두고, 무손실 큐에는 `QUEUE`의 `wred_profile: "AZURE_LOSSLESS"`를 붙입니다. 문서 예시의 WRED 프로파일은 `ecn: ecn_all`, 색상별 최소 1048576·최대 2097152 바이트, drop probability 5입니다.

SONiC의 확인 명령은 `show ecn`과 `show pfcwd config|stats`이며, PFC 워치독은 `config pfcwd start|start_default|interval`로 관리합니다. NVIDIA 개발자 포럼에는 DSCP에서 TC, PG, PFC로 이어지는 매핑의 priority가 맞지 않아 PFC가 0번에만 걸렸던 사례가 있습니다. 공식 설정 문서와 별개로, 매핑 불일치가 어떻게 나타났는지 보여주는 커뮤니티 사례입니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| Cumulus 기본 lossless | `nv set qos roce`. 모드 `lossy`, `lossless-single-ipool`, `lossy-multi-tc`, `dci-1`(Beta, Spectrum-4~6) | Cumulus Linux 5.18 RoCE 문서 | `✓` |
| Cumulus 기본값 | 위 표의 값. Spectrum-4 ECN min은 하드웨어 값 156 KB. 문서 안 ECN 표기가 서로 어긋남 | Cumulus Linux 5.18 RoCE 문서 | `✓` |
| 확인 명령 | `nv show qos roce`, `nv show interface <id> qos roce status|counters` | Cumulus Linux 5.18 RoCE 문서 | `✓` |
| 적응형 라우팅 | 기본 비활성. L3 서브인터페이스·SVI·본드 미지원. 5.13부터 적용 시 switchd 재시작. NetQ 모니터링은 Spectrum-4 + Cumulus 5.5 이상 + RoCE lossless | NVUE 레퍼런스, NetQ 문서 | `✓` |
| SONiC 키 | `PORT_QOS_MAP`, `QUEUE`, `WRED_PROFILE.AZURE_LOSSLESS`(min 1048576, max 2097152, drop probability 5), `show ecn`, `show pfcwd` | sonic-buildimage Configuration.md, sonic-utilities Command-Reference | `✓` |
| SONiC priority 정합 | 매핑 priority가 맞아야 PFC가 걸림. PFC가 0번에만 켜진 사례 | NVIDIA 개발자 포럼 | `≈` |
| NIC 트러스트 | `mlnx_qos -i <if> --trust dscp`, `--dscp2prio` | MLNX_OFED·DOCA QoS 문서 | `✓` |
| RDMA-CM ToS | `cma_roce_tos -t 106`(DSCP 26 + ECN ECT) | 대학 HPC 팀 템플릿 | `≈` |
| Spectrum-X Operator | PF마다 `hmfs`, `switchdev`, 멀티플레인이면 `esw_multiport=true`와 DOCA xPlane. `rdmaQoS: {tos: 96, tc: 96}`. 지원 NIC은 ConnectX-8, BlueField-3 SuperNIC | Network Operator 26.1·26.7 문서 | `✓` |
| `hwplb` 표기 | 26.4 문서는 tech preview, 26.7 문서는 GA | Network Operator 문서 | `✓` |
| NCCL TC·SL 기본값 | 2.32u1부터 `NCCL_IB_TC`·`NCCL_IB_SL` 기본 AUTO, 통신자 traffic class가 없으면 0 | NCCL 환경 변수 문서 | `✓` |
| 스위치와 NCCL TC 정합 | 운영자가 맞춰야 한다는 결론 | — | `≈` |
| 적응형 라우팅 기본값 | `NCCL_IB_ADAPTIVE_ROUTING`은 IB 기본 켜짐, RoCE 기본 꺼짐 | NCCL 환경 변수 문서 | `✓` |

{{% /details %}}

## 7. 성능이 낮으면 경로 분산과 혼잡 제어를 본다

Meta는 학습 트래픽의 낮은 플로 엔트로피 때문에 기본 ECMP의 성능이 나빴다고 설명합니다. QP 필드로 해시하는 E-ECMP에 QP 스케일링을 더하자, 같은 클러스터에서 QP 스케일링 없는 기준 ECMP 대비 AllReduce 성능이 최대 40% 좋아졌습니다. 별도로 경로 고정과 랙 할당 단편화가 겹쳐 학습 성능이 30% 넘게 떨어진 사례도 기록했습니다.

혼잡 제어 설정에서도 Meta의 운영 조건을 함께 읽어야 합니다. Meta는 400G 배포에서 DCQCN을 껐습니다. 펌웨어 변경으로 버그와 CNP 집계 문제가 생겼고 기본 설정이 성능을 낮췄기 때문입니다. 이후 1년 넘게 PFC만으로 운영했으며, 혼잡은 NCCL과 RoCE 전송 계층의 수신자 주도 admission으로 처리한다고 설명합니다.

NCCL IB 타임아웃은 4.096 µs × 2^`NCCL_IB_TIMEOUT`이며 `NCCL_IB_TIMEOUT`의 기본값은 20입니다. 재시도 횟수인 `NCCL_IB_RETRY_CNT`의 기본값은 7이므로, 기본 설정에서는 약 30초 뒤에 실패합니다.

처리량이 낮으면 실제로 사용하는 네트워크 경로도 확인합니다. 2차 가이드는 busbw가 50~100 GB/s 근처로 떨어질 때 IB나 RoCE 대신 소켓으로 폴백했을 가능성이 크다고 설명합니다. 이 가이드가 제시하는 확인 방법은 `NCCL_DEBUG=INFO` 로그에서 "Using network IB"를 찾는 것입니다. NVCRE 문서는 임계값 미달을 링크 열화, EFA/RoCE 설정 오류, NIC 불량 같은 네트워크 문제의 신호로 해석합니다.

검증 절차는 [11편]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}})에서, NCCL이 실제로 RDMA 경로를 타는지 확인하는 방법과 운영 함정은 [07편]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}})에서 이어집니다.

{{% details title="근거와 측정 조건" closed="true" %}}

| 주장 | 수치·조건 | 출처 | 근거 |
|---|---|---|---|
| ECMP 해시 | E-ECMP + QP 스케일링이 기준 ECMP 대비 AllReduce 최대 40% 개선. 같은 클러스터, QP 스케일링 없는 ECMP 대비 | Meta 엔지니어링 블로그 | `✓` |
| DCQCN 끔 | 400G 배포에서 끔. PFC만으로 1년 넘게 운영, 혼잡은 수신자 주도 admission(CTS)으로 처리 | Meta 엔지니어링 블로그 | `✓` |
| 타임아웃 | 4.096 µs × 2^`NCCL_IB_TIMEOUT`(기본 20), `NCCL_IB_RETRY_CNT` 기본 7, 기본값이면 약 30초 | NCCL 환경 변수 문서 | `✓` |
| 성능 하락 사례 | 경로 고정과 할당 단편화로 학습 성능 30% 이상 하락 | Meta 엔지니어링 블로그 | `✓` |
| 소켓 폴백 | busbw 50~100 GB/s 근처면 소켓 폴백이 많음. `NCCL_DEBUG=INFO`로 확인 | 2차 가이드 | `≈` |
| 임계값 미달 해석 | 링크 열화, EFA/RoCE 설정 오류, NIC 불량 | NVCRE 문서 | `✓` |

{{% /details %}}

## 8. 확인하지 못한 것

- 같은 조건에서 InfiniBand와 RoCE의 지연과 테일 지연을 잰 1차 측정
- Spectrum-X의 "1.6배", "실효 대역 60%에서 95%"가 어떤 조건에서 나온 수치인지
- 패킷 단위 적응형 라우팅과 NIC 측 재정렬의 동작 세부. 2차 자료에만 있음
- `nvidia-smi nvlink` 옵션의 NVIDIA 공식 매뉴얼 원문
- 드라이버 620의 출시 상태와 데이터센터 드라이버 브랜치별 production 구분
- GB300 전용 SuperPOD 레퍼런스 아키텍처의 최신판
- AWS의 EFA와 SRD 경로에 대한 1차 문서. 이번 조사에서는 따로 열지 않음
- NVIDIA Air에서의 설정 항목
- Cumulus Linux 5.18의 릴리스일

## 참고 자료

- [Fabric Manager 사용자 가이드](https://docs.nvidia.com/datacenter/tesla/fabric-manager-user-guide/index.html)
- [데이터센터 드라이버 색인](https://docs.nvidia.com/datacenter/tesla/index.html)
- [GPU Operator 릴리스 노트](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/release-notes.html)
- [GPU Operator 트러블슈팅](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/troubleshooting.html)
- [NVML NvLink](https://docs.nvidia.com/deploy/nvml-api/group__NvLink.html)
- [IMEX 가이드 시작](https://docs.nvidia.com/multi-node-nvlink-systems/imex-guide/gettingstarted.html)
- [IMEX 가이드 설정](https://docs.nvidia.com/multi-node-nvlink-systems/imex-guide/config.html)
- [IMEX 가이드 명령 서비스](https://docs.nvidia.com/multi-node-nvlink-systems/imex-guide/cmdservice.html)
- [GB200 Multi-Node Tuning Guide(NCCL)](https://docs.nvidia.com/multi-node-nvlink-systems/multi-node-tuning-guide/nccl.html)
- [Mission Control 2.0 High-Speed Fabric Management](https://docs.nvidia.com/mission-control/docs/systems-administration-guide/2.0.0/high-speed-fabric-management.html)
- [NMX Controller](https://docs.nvidia.com/networking/display/nmxcv11/nmx-controller)
- [NVIDIA k8s-dra-driver-gpu](https://github.com/NVIDIA/k8s-dra-driver-gpu)
- [SuperPOD B300 XDR Network Fabrics](https://docs.nvidia.com/dgx-superpod/reference-architecture/scalable-infrastructure-b300-xdr/latest/network-fabrics.html)
- [SuperPOD B300 Spectrum-4 Network Fabrics](https://docs.nvidia.com/dgx-superpod/reference-architecture/scalable-infrastructure-b300/latest/network-fabrics.html)
- [NCCL 환경 변수(2.32.3)](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/env.html)
- [Cumulus Linux 5.18 RoCE](https://docs.nvidia.com/networking-ethernet-software/cumulus-linux-518/Layer-1-and-Switch-Ports/Quality-of-Service/RDMA-over-Converged-Ethernet-RoCE/)
- [NVUE Adaptive Routing](https://docs.nvidia.com/networking-ethernet-software/nvue-reference/Set-and-Unset-Commands/Adaptive-Routing)
- [NetQ Adaptive Routing](https://docs.nvidia.com/networking-ethernet-software/cumulus-netq-48/Monitor-Operations/Monitor-Adaptive-Routing)
- [MLNX_OFED QoS](https://networking-docs.nvidia.com/mlnxofedswum/562090/quality-of-service-qos)
- [DOCA QoS](https://networking-docs.nvidia.com/doca/archive/3-0-0/ethernet-qos)
- [Network Operator 26.7 Spectrum-X](https://docs.nvidia.com/networking/display/kubernetes2670/spectrum-x/spectrum-x.html)
- [Network Operator 26.1 Spectrum-X NIC 설정](https://docs.nvidia.com/networking/display/kubernetes2610/nic-conf-operator/spectrum-x-configuration.html)
- [Cluster Readiness Engine NCCL 벤치마크](https://docs.nvidia.com/cluster-readiness-engine/how-to-guides/run-nccl-benchmarks)
- [SONiC Configuration.md](https://github.com/sonic-net/sonic-buildimage/blob/master/src/sonic-yang-models/doc/Configuration.md)
- [SONiC Command-Reference](https://github.com/sonic-net/sonic-utilities/blob/master/doc/Command-Reference.md)
- [Meta RoCE 블로그](https://engineering.fb.com/2024/08/05/data-center-engineering/roce-network-distributed-ai-training-at-scale/)
- [Meta SIGCOMM'24 논문](https://engineering.fb.com/wp-content/uploads/2024/08/sigcomm24-final246.pdf)
- [Google Cloud GPU 네트워크 대역](https://docs.cloud.google.com/compute/docs/gpus/gpu-network-bandwidth)
- [Azure GB300 NVL72 클러스터](https://azure.microsoft.com/en-us/blog/microsoft-azure-delivers-the-first-large-scale-cluster-with-nvidia-gb300-nvl72-for-openai-workloads/)
- [NVIDIA 블로그: Azure GB300 NVL72](https://blogs.nvidia.com/blog/microsoft-azure-worlds-first-gb300-nvl72-supercomputing-cluster-openai)
- [Dell'Oro 2026-06-02](https://www.delloro.com/news/ethernet-extends-lead-in-ai-scale-out-networks-despite-strong-infiniband-rebound/)
- [Dell'Oro 2026 전망](https://www.delloro.com/2026-predictions-data-center-switch-frontend-ai-backed-networks/)
- [Spectrum-X 제품 페이지](https://www.nvidia.com/en-us/networking/spectrumx/)
- [xAI Colossus 보도자료](https://investor.nvidia.com/news/press-release-details/2024/NVIDIA-Ethernet-Networking-Accelerates-Worlds-Largest-AI-Supercomputer-Built-by-xAI)
- [nvidia-smi nvlink 옵션(2차)](https://cloud-atlas.readthedocs.io/zh_CN/latest/machine_learning/hardware/nvidia_gpu/nvlink/nvidia-smi_nvlink.html)
- [RoCE ToS 106 커뮤니티 템플릿](https://gitlab.erc.monash.edu.au/hpc-team/HPCasCode/-/raw/e76d9f86cf595f286305ae2e79bf4c0ff568ea55/roles/mellanox_config/templates/pfc-ecn.sh.j2)
- [SONiC DSCP PFC 포럼](https://forums.developer.nvidia.com/t/priority-flow-control-using-dscp-as-priority-not-working/343814)
