---
title: "GPU 클러스터"
linkTitle: "GPU 클러스터"
description: "Kubernetes에서 GPU 노드 토폴로지, 할당, 노드 간 스케줄링, GPUDirect RDMA, GPU 스토리지 경로, 제공자의 패브릭 설정을 2026-10-21 기준 공식 문서로 정리한다."
date: 2026-10-21
lastmod: 2026-10-21
weight: 40
comments: false
cascade:
  type: docs
url: "/kubernetes/gpu/"
---

# GPU 클러스터 — 노드 안에서 패브릭까지

<span id="이-시리즈가-답하는-질문"></span>

Kubernetes에서 GPU를 요청하면 필요한 개수의 장치를 받을 수 있습니다. 분산 학습과 추론을 운영하려면 그 장치들이 어떻게 연결돼 있는지, 파드가 어느 노드에 모이는지, NIC과 스토리지가 GPU 메모리에 어떤 경로로 접근하는지도 알아야 합니다. 이 시리즈는 Kubernetes 운영 경험은 있지만 GPU 서버 구성이 낯선 플랫폼 엔지니어를 위해 이 과정을 설명합니다.

노드 안의 연결과 GPU 할당에서 시작해 노드 간 스케줄링, GPUDirect RDMA, 스토리지 경로로 범위를 넓힙니다. 마지막에는 인프라 제공자가 패브릭을 설정하고 검증해 사용자에게 내주는 조건을 다룹니다. 과거 알리바바 계열의 커스텀 GPU 리소스 방식이 지금도 쓰이는지, DRA로 전환할 필요가 있는지, Kubernetes와 Slurm을 어떻게 함께 운영할지도 이 흐름 안에서 살펴봅니다.

이 글들은 AI가 작성한 기술 초안·조사 자료입니다. 공식 문서의 동작 설명, 벤더의 주장, 자료에서 도출한 추정, 확인하지 못한 항목을 구분했습니다. 실제 노드에서 재현하지 않은 서술도 포함돼 있습니다.

## 이 분류에서 찾기 {#section-navigation}

<span id="문서-지도"></span>

관심 있는 운영 문제부터 읽을 수 있습니다. 할당·스케줄링·RDMA·스토리지·제공자 설정은 각각 두 편으로 이어지므로, 앞편에서 조건을 확인한 뒤 뒤편의 선택과 운영 제약을 읽는 편이 좋습니다.

- [01 GPU 조합이 성능을 바꾸는 조건]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}}) — HGX와 PCIe 서버의 연결 차이를 비교하고, topo 출력과 NCCL 로그로 GPU·CPU·NIC의 경로를 확인합니다.
- [02 요청한 GPU는 누가 골라 주는가]({{< relref "/platform/kubernetes/gpu/02-allocation-device-plugin/index.md" >}}) — 스케줄러와 kubelet의 역할, device plugin의 선호 조합과 NUMA 제약을 설명합니다. Koordinator·ACK에 남아 있는 커스텀 리소스 방식도 확인합니다.
- [03 GPU 할당에 DRA가 필요한 때]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}}) — 장치 조건을 요청하는 DRA와 노드 간 NVLink용 ComputeDomain을 구분하고, 기존 할당을 옮길 때의 설치·관리형 플랫폼 제약을 검토합니다.
- [04 학습 잡을 가까운 노드에 모으려면]({{< relref "/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md" >}}) — 환경별 노드 라벨을 Kueue TAS의 배치 제약에 연결합니다. 코어 Kubernetes의 gang·토폴로지 인지 스케줄링 상태도 비교합니다.
- [05 노드 간 스케줄링 2부 — Volcano·KAI·Slurm 비교]({{< relref "/platform/kubernetes/gpu/05-scheduling-volcano-kai-slurm/index.md" >}}) — 공개 도입 자료와 워크로드 API를 바탕으로 배치 요구에 맞는 스케줄러와 Slurm 공존 방식을 고릅니다.
- [06 GPUDirect RDMA 1부 — 파드의 NIC이 GPU 메모리에 닿는 조건과 준비]({{< relref "/platform/kubernetes/gpu/06-gpudirect-rdma-basics/index.md" >}}) — PCIe·호스트 드라이버 조건을 확인하고 NIC을 파드에 연결하는 방법과 권장 경로인 DMA-BUF를 설명합니다.
- [07 GPUDirect RDMA가 실제로 쓰이는지 확인하고 클라우드별 차이를 읽기]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}}) — NCCL 채널 로그와 busbw로 직접 전송 여부와 성능을 확인합니다. 클라우드별 경로와 GPU·NIC 정렬을 할당 조건으로 표현하는 방법도 다룹니다.
- [08 스토리지 — GDS와 NVMe-oF의 CPU 우회 범위]({{< relref "/platform/kubernetes/gpu/08-storage-gds-nvmeof/index.md" >}}) — GDS와 NVMe-oF RDMA의 경로를 구분하고 파일시스템·드라이버·Kubernetes 지원 조건, 호환 모드와 성능 확인 방법을 설명합니다.
- [09 스토리지 — 학습·추론의 GDS 활용과 패브릭 분리]({{< relref "/platform/kubernetes/gpu/09-storage-reality/index.md" >}}) — 학습과 추론의 실제 데이터 경로에서 GDS를 사용할 수 있는 범위, 스토리지와 집합통신 패브릭을 분리하는 조건, 운영 점검 순서를 살펴봅니다.
- [10 제공자가 GPU 파드보다 먼저 맞추는 NVLink·패브릭 설정]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}}) — Fabric Manager·IMEX의 관리 범위와 MIG·가상화·NVL72 운영을 설명하고 InfiniBand·RoCE의 설정 부담을 비교합니다.
- [11 GPU 클러스터를 사용자에게 내주기 위한 조건]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}}) — 배선과 토폴로지 정보, NCCL 기본값, 인수 합격선, 관측 카운터와 테넌트 경계를 확인합니다.

조사 기준일은 2026-10-21입니다. 주요 버전은 Kubernetes 1.37.1, GPU Operator 26.7.2, DRA Driver for NVIDIA GPUs v0.5.1, NCCL 2.32.3, Kueue 0.20.2, Volcano 1.16.0, KAI Scheduler 0.18.6, Network Operator 26.7.1, GDS 1.19.1입니다.
