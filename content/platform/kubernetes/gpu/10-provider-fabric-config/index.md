---
title: "10 제공자가 GPU 파드보다 먼저 맞추는 NVLink·패브릭 설정"
description: "2026-10-21 기준으로 GPU 클러스터 제공자가 NVLink와 노드 간 패브릭을 준비할 때 확인할 조건을 설명한다. FM·IMEX의 관리 범위를 나누고, InfiniBand·RoCE의 공개 사례와 설정 부담을 선택 근거로 삼는다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 10
url: "/kubernetes/gpu/10-provider-fabric-config/"
---

# 10 · 제공자가 GPU 파드보다 먼저 맞추는 NVLink·패브릭 설정

## 1. GPU 세대에 맞춰 Fabric Manager를 구성한다 {#2-fm은-gpu-세대와-장애-정책에-맞춰-구성한다}

GPU 파드가 NVLink를 사용하려면 제공자가 먼저 노드의 패브릭을 구성해야 합니다. NVSwitch 노드에서는 Fabric Manager(FM)가, NVL72에서는 랙의 NMX와 컴퓨트 트레이의 IMEX가 각각 맡는 일이 있습니다. 그 상태를 확인한 뒤 노드 간 InfiniBand·RoCE 연결과 혼잡 제어를 맞추는 순서로 살펴봅니다.

아래 내용은 2026-10-21 조사 기준입니다. Fabric Manager 사용자 가이드 v2.6, 2025-07-02 갱신 IMEX 가이드, GPU Operator 26.7.2, NCCL 2.32.3, Cumulus Linux 5.18 문서를 사용했습니다. 데이터센터 드라이버 색인에는 R615, R610, R595, R590, R580이 있지만 production 여부는 표시돼 있지 않았습니다. 문서의 지원 조건과 작성자의 추정은 본문에서 구분합니다.

### FM과 NVLSM의 역할

FM은 NVSwitch 커널 드라이버와 짝을 이루는 특권 프로세스로, 메모리 패브릭을 구성하고 NVLink를 감시합니다. 링크 트레이닝(물리 링크 초기화)과 패브릭 구성은 구분해야 합니다. Hopper의 3세대 NVSwitch는 ALI 기반으로 링크를 트레이닝하므로 그 과정에는 FM이 필요하지 않지만, 패브릭은 여전히 FM이 구성합니다.

Blackwell HGX의 4세대 NVSwitch에서는 FM 서비스가 NVLSM(NVLink Subnet Manager)도 함께 실행합니다. NVSwitch는 CX7 브리지 디바이스로 연결되고 FM과 NVLSM은 소켓으로 통신합니다. 따라서 `FM_SM_IPC_INTERFACE` 경로와 NVLSM의 `plugin_options grpc_mgr --grpc_server_address` 값이 같아야 합니다. B200·B300에는 `TOPOLOGY_FILE_PATH`가 적용되지 않으며 `nvswitch-audit`도 지원하지 않습니다.

### 설치 패키지와 장애 시 동작

FM 가이드의 최소 드라이버는 HGX A100 450, H100 525, B200·B300·B100 570입니다. 4세대 이전에는 Debian·Ubuntu의 `cuda-drivers-fabricmanager-<branch>` 또는 RHEL의 `nvidia-driver:<branch>/fm`을 사용합니다. 4세대이면서 드라이버가 620 미만이면 `nvidia-open-<branch>`와 `nvlink5-<branch>`가 필요합니다.

가이드는 드라이버 620부터 FM이 독자 semver(2.0.x)를 갖고 GPU 드라이버와 별도로 설치된다고 설명합니다. 버전 검사는 `libnvidia-fmdrv.so.1` 기준이며, 4세대 이전 시스템에서는 이 라이브러리 버전과 FM 버전이 같아야 합니다. 620의 실제 출시 상태는 확인하지 못했으므로 문서의 설치 구분과 현재 배포 가능 여부를 동일하게 보아서는 안 됩니다.

`/usr/share/nvidia/nvswitch/fabricmanager.cfg`에서는 실행 모드와 장애 정책을 정합니다. 아래 기본값은 FM 사용자 가이드 v2.6 기준입니다.

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

기본 설정에서는 스위치 장애로 베어메탈 노드 전체가 초기화되지 않을 수 있습니다. 일부 대역을 잃어도 운영을 계속하려면 `NVSWITCH_FAILURE_MODE=1`을 선택합니다. 제공자는 어느 동작이 SLA에 맞는지 정해야 합니다.

서비스는 `systemctl`, 로그는 `journalctl -u nvidia-fabricmanager`로 관리합니다. FM 가이드는 서비스를 중지하면 패브릭 상태가 사라져 모든 GPU를 리셋해야 복구할 수 있다고 경고합니다. 이 조건에서 보면 실행 중인 노드의 FM 재시작은 드레인을 전제로 계획하는 편이 타당하지만, 드레인 자체는 문서의 직접 지시가 아닌 운영상 판단입니다.

GPU Operator 26.7.2의 알려진 문제도 업데이트 계획에 영향을 줍니다. NVLink5 이상인 HGX B200·B300에서 드라이버 컨테이너의 `nvlsm`이 `ib_umad`를 사용하면 컨테이너형 DOCA-OFED 드라이버 업데이트가 막힐 수 있습니다. 릴리스 노트는 호스트에 설치한 DOCA-OFED나 OS 기본 드라이버를 권장하며, 대안으로 `network.nvidia.com/operator.mofed.wait` 라벨을 쓰는 기본이 아닌 `NVIDIADriver` 리소스를 제시합니다.

## 2. 파드 초기화 오류를 FM 상태와 연결한다 {#1-파드-초기화-오류에서-패브릭-상태로-거슬러-올라간다}

NVSwitch 노드에서 GPU Operator 검증기 파드가 `error code system not yet initialized`로 종료되면 호스트의 FM과 패브릭 초기화 상태를 확인합니다. GPU Operator 트러블슈팅 문서는 이 오류의 원인이 대부분 FM 부재라고 설명합니다. 문서의 `nvidia-smi -q` 예시에서는 Fabric 상태가 `In Progress`로 표시됩니다.

```text
Fabric
     State                             : In Progress
     Status                            : N/A
     CliqueId                          : N/A
     ClusterUUID                       : N/A
```

정상 상태는 `State: Completed`, `Status: Success`입니다. NVSwitch SXid 오류는 호스트 syslog와 FM 로그에 기록됩니다. 패브릭에서 제외된 GPU는 `nvidia-smi -B`와 `/proc/driver/nvidia/gpus/<PCI_ID>/information`에서 확인합니다.

{{< flow src="_flow/2-fm-상태-판정.json" />}}

Kubernetes에서는 GPU Operator 1.8부터 드라이버 컨테이너가 NVSwitch를 감지해 FM을 자동으로 실행합니다. 현행 트러블슈팅 문서도 같은 동작을 설명합니다. 드라이버 DaemonSet 파드의 `nvidia-driver-ctr`에서 `/var/log/fabricmanager.log`를 읽고, 호스트에 드라이버를 직접 설치했다면 호스트의 같은 경로를 봅니다.

패브릭 초기화가 끝난 뒤에는 개별 NVLink를 확인합니다. 2차 자료가 옮긴 도움말에는 `nvidia-smi nvlink`의 `-s`(상태), `-e`(에러 카운터), `-ec`(레인별 CRC), `-re`(카운터 초기화), `-gt`(처리량)가 나옵니다. 드라이버마다 옵션이 달라 실제 노드의 `nvidia-smi nvlink --help`와 대조해야 합니다. 프로그램에서는 NVML의 `nvmlDeviceGetNvLinkErrorCounter`로 카운터를 읽을 수 있습니다.

노드 토폴로지 해석은 [01편]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}}), 카운터를 지속적으로 수집하는 DCGM 구성은 [11편]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}})에서 다룹니다.

## 3. MIG와 가상화 모드를 정한 뒤 패브릭을 초기화한다 {#3-mig와-가상화가-nvlink-사용-조건을-바꾼다}

FM 파티션 활성화 성공만으로 모든 GPU의 NVLink가 사용 가능하다고 판단할 수는 없습니다. MIG와 가상화 모드에 따라 링크 트레이닝과 P2P 통신의 조건을 따로 확인해야 하기 때문입니다.

FM 가이드는 최대 64개 파티션, 16 GPU를 지원하는 다음 모델을 설명합니다.

| 모델 | GPU 제공 방식과 제약 |
|---|---|
| 베어메탈 | 호스트에서 GPU와 패브릭 사용 |
| 풀 패스스루 | GPU를 VM에 제공. 2·4 GPU VM은 대역이 줄어듦 |
| Shared NVSwitch | 신뢰된 Service VM이 패브릭을 관리. 1·2·4·8 GPU VM 지원. 가이드가 권장하는 모델 |
| vGPU | 게스트에 SR-IOV VF만 제공 |

이 모델 설명과 GPU Operator의 지원 범위는 따로 확인해야 합니다. Operator 23.3~24.3 릴리스 노트는 NVSwitch 베어메탈 노드의 vGPU를 지원하지 않는다고 적습니다.

FM 가이드의 일반적인 MIG 상호운용성 절은 A100에서 MIG를 켜면 NVLink가 꺼지고 H100 이후에는 활성 상태를 유지한다고 설명합니다. MIG에서 P2P 통신을 잃는다는 설명도 있으므로, 링크가 활성 상태라는 것과 인스턴스 사이 P2P를 사용할 수 있다는 것은 구분해야 합니다.

같은 가이드의 Shared NVSwitch 가상화 모델 절에는 H100 이후 MIG GPU의 NVLink가 트레이닝되지 않아도 멀티 GPU 파티션 활성화는 성공한다는 설명이 있습니다. 이 절은 H100 이후에 해당 옵션들이 적용되지 않는다는 단서도 둡니다. 일반 절의 활성 상태 설명과 이 가상화 절의 트레이닝 설명을 합쳐 모든 H100 MIG 구성에 하나의 규칙으로 적용할 수는 없습니다.

Shared NVSwitch 가상화 절에서 설명하는 Service VM의 초기화는 MIG GPU가 있으면 `--restart` 없이 FM을 시작하는 것을 허용하지 않습니다. 이 설명의 세대별 적용 범위는 앞의 H100 이후 예외 문구와 함께 확인해야 합니다. A100 vGPU 모드에서는 FM 시작 전에 MIG를 켜면 해당 GPU가 들어간 파티션이 제거됩니다. 사용하는 모드와 GPU 세대를 붙여 문서를 대조해야 하며, 절마다 다른 설명의 세부 적용 범위는 이번 조사에서 확정하지 못했습니다.

Grace 기반 시스템에는 별도의 제약도 있습니다. GPU Operator 25.3.2 노트에 따르면 드라이버 580.65.06이 기본으로 활성화하는 CDMM은 MIG 및 GPUDirect Storage와 호환되지 않습니다.

이 조건들을 종합하면 MIG용 노드를 별도 풀로 구분하는 편이 운영상 안전해 보입니다. 파티션 활성화, 링크 상태, 인스턴스 간 통신 지원 여부가 서로 다를 수 있기 때문입니다. 이는 문서에 명시된 권고가 아닌 이 글의 판단입니다.

## 4. NVL72의 스위치 관리와 IMEX 도메인을 맞춘다 {#4-nvl72에서는-랙-전체를-관리한다}

GB200·GB300 NVL72는 NVLink 패브릭이 랙 전체로 확장됩니다. Mission Control 2.0 관리 가이드의 구성은 랙 안 NVLink, 랙 사이 InfiniBand입니다. 출하 시에는 72 GPU를 묶은 Default Partition 하나가 있으며, 관리자가 사용자 파티션으로 나눌 수 있습니다. 문서는 보안 요구가 강하지 않으면 기본 파티션을 사용하도록 권합니다.

### 스위치 트레이의 NMX

스위치 트레이의 NMX Controller(NMX-C)는 GB200에서 Subnet Manager와 Global Fabric Manager 기능을 호스팅합니다. NMX-Telemetry(NMX-T), NMX-Manager(NMX-M)도 NMX 구성에 포함됩니다. 리더 스위치 NVSWITCH-1의 NVOS에서 NMX-C와 NMX-T가 실행되며, 다음 명령으로 앱과 파티션 상태를 확인합니다.

```text
nv show cluster app          # nmx-controller, nmx-telemetry가 ok인지
nv show sdn partition        # 파티션 목록과 상태
nv action create|update|delete|restore sdn partition <id> ...
```

문서의 Default Partition 예시는 ID `32766`, 72 GPU, 상태 `healthy`, 복원력 모드 `adaptive_bandwidth`입니다. 복원력 모드는 `full_bandwidth`, `adaptive_bandwidth`, `user_action` 중에서 고르며 멀티캐스트 한도는 0~1024입니다.

BCM이 노출하는 NMX-M 메트릭에는 `nmxm_gpu_health_count{parameter=healthy|degraded|nonvlink|degraded_bw}`, `nmxm_switch_health_count{parameter=healthy|unhealthy|missing_nvlink}`, `nmxm_compute_health_count`, `nmxm_compute_allocation_count`가 있습니다. 이 값으로 랙 패브릭의 상태와 할당을 관측합니다.

### 컴퓨트 트레이의 IMEX와 Kubernetes 연동

컴퓨트 트레이에서는 `nvidia-imex-<driver-branch>` 패키지의 `nvidia-imex` systemd 서비스가 동작합니다. 설치만으로 자동 enable되지는 않습니다. 도메인의 노드 목록, 포트와 인증 방식은 `/etc/nvidia-imex/config.cfg`에서 설정합니다.

| 키 | 값 | 의미 |
|---|---|---|
| `IMEX_NODE_CONFIG_FILE` | `/etc/nvidia-imex/nodes_config.cfg` | 도메인에 속한 노드 IP 목록 |
| `SERVER_PORT` | 50000 | IMEX 서버 포트 |
| `IMEX_CMD_PORT` | 50005 | 명령 포트 |
| `IMEX_WAIT_FOR_QUORUM` | `RECOVERY` | 쿼럼 대기 방식 |
| `IMEX_ENABLE_AUTH_ENCRYPTION` | 0 | 1이면 `SSL_TLS`, GSSAPI 인증과 암호화 |

IMEX는 시작할 때 로드된 커널 드라이버 스택의 버전을 검사하며, 맞지 않으면 중단합니다. `nvidia-imex-ctl -N`은 도메인 전체 상태를 보여 주고 `-H`는 호스트 이름을 표시합니다. 정상 상태는 각 노드 `READY`, 연결 행렬 전체 `C`, 마지막 줄 `Domain State: UP`입니다.

Kubernetes에서는 DRA 드라이버의 ComputeDomain이 IMEX 데몬·도메인·채널을 조율합니다. k8s-dra-driver-gpu README는 같은 ComputeDomain의 파드끼리만 MNNVL로 통신하도록 격리한다고 설명합니다. 이 파드 단위 구성은 [03편]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})에서 다뤘습니다.

GPU Operator 26.7.0의 `GPUCluster` 리소스는 DRA 드라이버, ComputeDomain, DCGM, exporter, 검증 워크로드를 함께 배포합니다. `ClusterPolicy`와 공존할 수 없으며 Kubernetes 1.34.2 이상, 드라이버 580 이상, CDI 런타임이 필요합니다.

워크로드가 MNNVL을 쓰려면 `NCCL_MNNVL_ENABLE`(0/1/2), `NCCL_CUMEM_ENABLE` 설정이 맞고 NVLink 도메인의 모든 노드에서 IMEX 도메인이 동작해야 합니다. GB200에는 NCCL 2.25.2 이상이 필요합니다. 패브릭 정보를 스케줄러에 전달하는 라벨은 [04편]({{< relref "/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md" >}})에서 설명합니다.

## 5. InfiniBand와 RoCE의 공개 구성 및 운영 조건 {#5-노드-간-패브릭은-공개-사례와-운영-부담으로-고른다}

InfiniBand와 RoCE(이더넷 기반 RDMA)의 지연·테일 지연을 같은 조건에서 비교한 1차 측정은 찾지 못했습니다. 따라서 공개 구축 사례는 어떤 패브릭을 선택했는지 보여 주는 자료로, 운영 문서는 무엇을 설정하고 유지해야 하는지 보여 주는 자료로 읽습니다.

NVIDIA SuperPOD B300에는 Quantum-X800 InfiniBand(XDR)판(2026-09-02 갱신)과 Spectrum-4 이더넷(Spectrum-X)판(2025-11-19 갱신)이 모두 있습니다. Azure·NVIDIA 발표에 따르면 Azure GB300 NVL72는 랙 사이를 ConnectX-8과 Quantum-X800 InfiniBand로 연결하고 GPU당 800 Gb/s의 full fat-tree non-blocking을 제공합니다. 이는 사업자의 발표 구성입니다.

Google Cloud 문서에서 A3 Ultra·A4는 ConnectX-7 8개로 RoCE GPUDirect RDMA를 사용하며 A3 Mega는 GPUDirect-TCPXO를 사용합니다. Meta의 2024년 엔지니어링 블로그와 SIGCOMM'24 논문은 AI 용량 대부분을 RoCEv2 백엔드로 운영한다고 설명합니다. 학습 백엔드는 적재·체크포인트·로깅용 프론트엔드와 분리되고, 2단 Clos AI Zone 위에 집계 계층을 둡니다.

xAI Colossus의 Spectrum-X 구성은 NVIDIA 보도자료에 나온 SN5600과 BlueField-3 SuperNIC 조합입니다. 같은 자료의 약 95% 처리량과 플로 충돌 손실 없음은 NVIDIA의 주장입니다. 제품 페이지의 "기존 이더넷 대비 AI 네트워킹 성능 1.6배"도 비교 기준인 "traditional/off-the-shelf Ethernet"이 정의되지 않아 이를 직접적인 선택 근거로 쓰기 어렵습니다.

시장 수치도 성능 비교와는 구분해야 합니다. Dell'Oro의 2026-06-02 분석은 2026년 1분기 AI 백엔드 이더넷 스위치 매출이 두 배 넘게 늘어 AI 클러스터 스위치 매출의 약 3분의 2가 됐다고 봅니다. InfiniBand 매출도 세 배 넘게 증가했으며, 분석은 Blackwell Ultra와 함께 공급한 800G 스위치 및 기존 설치 기반의 업그레이드를 배경으로 듭니다. 별도의 2026 전망은 이더넷이 2025년에 IB를 넘어섰고, 2년 전에는 IB가 AI 백엔드 스위치 매출의 80% 가까이를 차지했다고 설명합니다.

이 자료들을 종합하면 신규 대규모 구축은 이더넷 쪽으로 기울면서 NVIDIA XDR 레퍼런스와 일부 하이퍼스케일러는 InfiniBand를 유지하는 것으로 보입니다. 이는 구축·매출 자료에서 이끌어 낸 판단입니다.

운영 부담은 설정을 관리하는 위치에서 차이가 납니다. InfiniBand는 Subnet Manager(UFM 또는 OpenSM)가 경로·파티션·적응형 라우팅을 중앙에서 관리합니다. RoCE는 스위치마다 PFC(우선순위별 흐름 제어), ECN(명시적 혼잡 알림), 버퍼, DSCP 매핑을 맞추고 NIC 트러스트 모드까지 일치시켜야 합니다. UFM·Cumulus 문서 구성을 비교하면 RoCE에서 이 정합을 관리하는 부담이 더 드러납니다. Meta도 IB와의 직접 벤치마크는 제시하지 않았고, RoCE 흐름 제어가 더 거칠어 버퍼 튜닝이 어렵다고 설명했습니다.

## 6. RoCE 트래픽 분류를 NCCL·NIC·스위치에서 일치시킨다 {#6-roce-우선순위를-통신자부터-스위치까지-맞춘다}

RoCE에서는 애플리케이션이 표시한 traffic class를 NIC와 스위치가 같은 우선순위로 해석해야 합니다. 매핑이 맞지 않으면 의도한 큐에 PFC가 적용되지 않거나 혼잡 신호가 돌아오지 않을 수 있습니다. 아래 도식은 설정의 연결 관계이며 스위치 큐의 PFC pause는 생략했습니다.

{{< flow src="_flow/6-roce-설정-경로.json" />}}

### NCCL과 NIC이 표시하는 우선순위

NCCL 2.32u1부터 `NCCL_IB_TC`·`NCCL_IB_SL`의 기본값은 AUTO입니다. 통신자에 traffic class가 없으면 0을 사용합니다. 따라서 스위치가 아래 Cumulus 예시처럼 DSCP 26을 무손실 트래픽으로 분류한다면, NCCL 트래픽도 그 분류에 맞게 표시해야 한다는 운영상 판단이 나옵니다. 이것은 NCCL 문서가 직접 제시한 설정 조합은 아닙니다. `NCCL_IB_ADAPTIVE_ROUTING`은 InfiniBand에서 기본 켜짐, RoCE에서 기본 꺼짐입니다.

ConnectX에서는 `mlnx_qos -i <if> --trust dscp`로 DSCP 트러스트를 켜고 `--dscp2prio`로 매핑하며, 같은 명령으로 현재 상태를 읽습니다. RDMA-CM의 ToS를 `cma_roce_tos -d <dev> -t 106`으로 지정하는 예시는 대학 HPC 팀의 템플릿 등 2차 자료에 있습니다. 106은 DSCP 26에 ECN ECT 비트를 더한 값입니다.

Network Operator의 Spectrum-X 경로는 다른 설정 조합을 제공합니다. NIC Configuration Operator가 Spectrum-X 프로필에 맞게 펌웨어를 설정하고, Spectrum-X Operator는 PF별 `flow_steering_mode=hmfs`, eSwitch `switchdev`를 적용합니다. 하드웨어 멀티플레인에서는 `esw_multiport=true`와 DOCA xPlane도 사용합니다. 생성된 OVSNetwork의 값은 `rdmaQoS: {tos: 96, tc: 96}`이며 지원 NIC은 ConnectX-8·BlueField-3 SuperNIC입니다. Network Operator 26.1·26.7 문서에 나온 구성으로, 멀티플레인 `hwplb`는 26.4에서 tech preview, 26.7에서 GA로 표기됩니다.

### Cumulus의 큐와 ECN 설정

Cumulus Linux 5.18에서는 `nv set qos roce`와 `nv config apply`로 기본 lossless RoCE를 켭니다. 다른 모드는 `lossy`, `lossless-single-ipool`, `lossy-multi-tc`, Spectrum-4~6용 Beta인 `dci-1`이며, 해제 명령은 `nv unset qos roce`입니다.

| 항목 | 기본값 |
|---|---|
| PFC | switch-priority 3에서 rx/tx 활성, `cable-length 100` |
| RoCE 분류 | PCP 3 / DSCP 26 → switch-priority 3. 기본 표는 DSCP 24~31을 SP3로 매핑 |
| CNP 분류 | PCP 6 / DSCP 48 → switch-priority 6 |
| 트래픽 클래스 | SP3 → TC3(RoCE, DWRR 50%), SP6 → TC6(CNP, strict priority), 나머지 TC0(DWRR 50%) |
| ECN | `min-threshold 146.48 KB`, `max-threshold 1.43 MB`, `probability 100` |
| LLDP app TLV | UDP 4791, priority 3 |

ECN 임계값은 문서 안에서도 표기가 일치하지 않습니다. Spectrum-4의 하드웨어 값은 156 KB로 위 표와 다르므로 실제 장비에서 확인해야 합니다. 전체 구성은 `nv show qos roce`, 인터페이스 상태와 카운터는 `nv show interface <id> qos roce status`, `nv show interface <id> qos roce counters`로 읽습니다.

Cumulus의 적응형 라우팅은 기본 비활성이며 `nv set router adaptive-routing state ...`로 켭니다. 큐 점유와 포트 사용률을 기준으로 경로를 고르지만 L3 서브인터페이스·SVI·본드는 지원하지 않습니다. 5.13부터는 적용할 때 switchd가 재시작됩니다. NetQ에서 관측하려면 Spectrum-4, Cumulus 5.5 이상, RoCE lossless 조건이 필요합니다.

### SONiC의 매핑과 PFC 워치독

SONiC은 `config_db`의 `PORT_QOS_MAP`에 `pfc_enable: "3,4"`, `dscp_to_tc_map`, `tc_to_pg_map`, `tc_to_queue_map`, `pfc_to_queue_map`을 설정합니다. 무손실 큐에는 `QUEUE`의 `wred_profile: "AZURE_LOSSLESS"`를 연결합니다. 문서 예시의 `WRED_PROFILE.AZURE_LOSSLESS`는 `ecn: ecn_all`, 색상별 최소 1048576·최대 2097152 바이트, drop probability 5입니다.

ECN과 워치독은 `show ecn`, `show pfcwd config|stats`로 확인하며 `config pfcwd start|start_default|interval`로 워치독을 관리합니다. NVIDIA 개발자 포럼에는 DSCP→TC→PG→PFC의 priority가 맞지 않아 PFC가 0번에만 걸린 사례가 있습니다. 이 사례는 공식 권장값의 근거가 아니라 매핑 불일치로 생긴 증상을 보여 주는 참고 자료입니다.

## 7. 낮은 성능을 경로 선택과 혼잡 제어로 좁힌다 {#7-성능이-낮으면-경로-분산과-혼잡-제어를-본다}

RoCE 설정이 맞아도 트래픽이 경로에 고르게 분산되지 않으면 성능이 낮아질 수 있습니다. Meta는 학습 트래픽의 낮은 플로 엔트로피 때문에 기본 ECMP의 성능이 나빴다고 보고했습니다. 같은 클러스터에서 QP 필드를 해시하는 E-ECMP와 QP 스케일링을 함께 적용하자, QP 스케일링 없는 기준 ECMP 대비 AllReduce가 최대 40% 개선됐습니다. 경로 고정과 랙 할당 단편화가 겹쳐 학습 성능이 30% 넘게 떨어진 사례도 있습니다.

Meta의 DCQCN 선택은 그 배포 조건과 함께 읽어야 합니다. 400G 배포에서 펌웨어 변경 뒤 버그·CNP 집계 문제가 발생하고 기본 설정이 성능을 낮추자 DCQCN을 껐습니다. 이후 1년 넘게 PFC만으로 운영했으며, 혼잡은 NCCL과 RoCE 전송 계층의 수신자 주도 admission(CTS)으로 처리한다고 설명합니다. 이 사례만으로 다른 RoCE 패브릭의 DCQCN 설정을 정할 수는 없습니다.

전송 실패까지 걸리는 시간에는 NCCL 재시도 설정도 반영됩니다. IB 타임아웃은 4.096 µs × 2^`NCCL_IB_TIMEOUT`이고 기본값은 20입니다. `NCCL_IB_RETRY_CNT`의 기본값 7을 함께 사용하면 약 30초 뒤 실패합니다.

먼저 확인할 관측값은 실제로 선택된 네트워크 경로입니다. 2차 가이드는 busbw가 50~100 GB/s 근처로 낮아졌을 때 IB·RoCE 대신 소켓으로 폴백했을 가능성을 들고, `NCCL_DEBUG=INFO`에서 "Using network IB"를 찾도록 안내합니다. 이 대역폭 범위는 공식 합격선이 아닙니다. NVCRE 문서도 임계값 미달을 링크 열화, EFA/RoCE 설정 오류, NIC 불량 등의 신호로 해석합니다.

실제 RDMA 경로를 확인하는 로그는 [07편]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}}), 하드웨어별 인수 검증과 멀티테넌시는 [11편]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}})에서 이어집니다. 스토리지 트래픽을 compute 패브릭에서 분리하는 문제는 [09편]({{< relref "/platform/kubernetes/gpu/09-storage-reality/index.md" >}})에서 따로 다룹니다.

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
- FM 가이드의 일반 MIG 절과 Shared NVSwitch 가상화 절에 있는 H100 이후 링크 상태·트레이닝 및 초기화 예외의 세대별 적용 범위

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
