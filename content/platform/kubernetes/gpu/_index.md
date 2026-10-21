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

## 이 분류에서 찾기 {#section-navigation}

- [01 GPU 조합이 성능을 바꾸는 조건]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}})
- [02 요청한 GPU는 누가 골라 주는가]({{< relref "/platform/kubernetes/gpu/02-allocation-device-plugin/index.md" >}})
- [03 GPU 할당에 DRA가 필요한 때 — 개수는 device plugin, 노드 간 NVLink는 ComputeDomain]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}})
- [04 학습 잡을 가까운 노드에 모으려면 — 토폴로지 라벨과 Kueue TAS]({{< relref "/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md" >}})
- [05 노드 간 스케줄링 2부 — Volcano·KAI·Slurm 비교]({{< relref "/platform/kubernetes/gpu/05-scheduling-volcano-kai-slurm/index.md" >}})
- [06 GPUDirect RDMA 1부 — 파드의 NIC이 GPU 메모리에 닿는 조건과 준비]({{< relref "/platform/kubernetes/gpu/06-gpudirect-rdma-basics/index.md" >}})
- [07 GPUDirect RDMA가 실제로 쓰이는지 확인하고 클라우드별 차이를 읽기]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}})
- [08 스토리지 — GDS와 NVMe-oF의 CPU 우회 범위]({{< relref "/platform/kubernetes/gpu/08-storage-gds-nvmeof/index.md" >}})
- [09 스토리지 — 학습·추론의 GDS 활용과 패브릭 분리]({{< relref "/platform/kubernetes/gpu/09-storage-reality/index.md" >}})
- [10 제공자가 GPU 파드보다 먼저 맞추는 NVLink·패브릭 설정]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}})
- [11 GPU 클러스터를 사용자에게 내주기 위한 조건]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}})

## 이 시리즈가 답하는 질문

GPU 클러스터를 운영하는 플랫폼 엔지니어가 던지는 질문 여섯 가지를 따라 노드 안에서 패브릭 바깥까지 순서대로 따라갑니다. 독자는 Kubernetes 운영 경험이 있고 GPU 서버의 구성은 아직 낯선 사람을 가정했습니다.

1. 노드 안의 토폴로지를 알고 GPU를 할당하려면 무엇을 알아야 하는가. 01편에서 구조를 보고 02·03편에서 할당 방식을 봅니다.
2. 알리바바 계열이 쓴 커스텀 리소스 기법이 지금도 쓰이는가. 02편에서 Device Plugin 시대의 기법과 현재 상태를 확인합니다.
3. 노드 사이의 토폴로지를 인지하는 스케줄링은 최근 어떻게 흘러가는가. 04·05편에서 라벨과 Kueue, Volcano, KAI, Slurm 공존을 다룹니다.
4. GPUDirect RDMA를 Kubernetes에서 어떻게 쓰는가. 06·07편에서 원리와 호스트 준비, NIC을 파드에 주는 경로, 운영 함정을 다룹니다.
5. NVMe-oF RDMA와 GDS로 CPU를 우회하는 스토리지 경로는 어떤가. 08·09편에서 원리와 현실의 제약을 나눠 봅니다.
6. 인프라 제공자는 NVLink와 패브릭을 어떻게 설정하고 검증하는가. 10·11편에서 Fabric Manager, IMEX, InfiniBand와 RoCE 설정, 검증과 멀티테넌시를 다룹니다.

각 편은 조사 노트에서 확인한 공식 문서의 서술과 벤더 주장, 추정, 확인하지 못한 것을 구분해서 적습니다. 이 글들은 AI가 작성한 초안이어서 실제 노드에서 재현해 보기 전의 서술이 섞여 있습니다.

## 문서 지도

2부작은 한 주제를 앞뒤로 나눈 것이므로 이어서 읽는 편이 낫습니다.

- [01 GPU 조합이 성능을 바꾸는 조건]({{< relref "/platform/kubernetes/gpu/01-node-topology/index.md" >}}) — HGX와 PCIe 서버의 연결 구조 차이에서 출발해 토폴로지 출력과 NCCL 로그로 GPU 경로와 제약을 확인하는 방법을 다룬다.
- [02 요청한 GPU는 누가 골라 주는가]({{< relref "/platform/kubernetes/gpu/02-allocation-device-plugin/index.md" >}}) — 기본 할당 경로에서 스케줄러와 kubelet이 맡는 역할, device plugin의 선호 조합, NUMA, Koordinator와 ACK의 토폴로지 방식을 정리한다. (할당 2부작)
- [03 GPU 할당에 DRA가 필요한 때 — 개수는 device plugin, 노드 간 NVLink는 ComputeDomain]({{< relref "/platform/kubernetes/gpu/03-allocation-dra/index.md" >}}) — GPU 개수 할당을 device plugin이 맡는 범위와 DRA로 장치 조건을 요청하는 방식, 노드 간 NVLink에 필요한 ComputeDomain, 관리형 Kubernetes의 지원 범위를 따진다. (할당 2부작)
- [04 학습 잡을 가까운 노드에 모으려면 — 토폴로지 라벨과 Kueue TAS]({{< relref "/platform/kubernetes/gpu/04-scheduling-labels-kueue/index.md" >}}) — 환경별 토폴로지 라벨을 Kueue TAS의 배치 제약에 연결하는 방법과 코어 Kubernetes의 gang 및 토폴로지 인지 스케줄링 상태를 정리한다. (스케줄링 2부작)
- [05 노드 간 스케줄링 2부 — Volcano·KAI·Slurm 비교]({{< relref "/platform/kubernetes/gpu/05-scheduling-volcano-kai-slurm/index.md" >}}) — Volcano, KAI, Slurm 연동을 공개 도입 자료와 워크로드 API 기준으로 비교해 배치 요구에 맞는 조합을 고르는 기준을 설명한다. (스케줄링 2부작)
- [06 GPUDirect RDMA 1부 — 파드의 NIC이 GPU 메모리에 닿는 조건과 준비]({{< relref "/platform/kubernetes/gpu/06-gpudirect-rdma-basics/index.md" >}}) — 파드의 NIC이 GPU 메모리에 닿기 위한 PCIe 조건과 호스트 드라이버, NIC을 파드에 주는 방식, 권장 경로인 DMA-BUF를 설명한다. (GPUDirect RDMA 2부작)
- [07 GPUDirect RDMA가 실제로 쓰이는지 확인하고 클라우드별 차이를 읽기]({{< relref "/platform/kubernetes/gpu/07-gpudirect-rdma-operations/index.md" >}}) — NCCL 채널 로그로 직접 전송을 확인하는 방법과 busbw를 읽는 조건, 클라우드별 전송 경로, GPU와 NIC 정렬을 할당 조건으로 만드는 방법을 다룬다. (GPUDirect RDMA 2부작)
- [08 스토리지 — GDS와 NVMe-oF의 CPU 우회 범위]({{< relref "/platform/kubernetes/gpu/08-storage-gds-nvmeof/index.md" >}}) — GDS와 NVMe-oF RDMA가 CPU를 우회하는 범위, 지원 파일시스템과 드라이버 조건, Kubernetes 구성, 호환 모드와 성능 확인을 정리한다. (스토리지 2부작)
- [09 스토리지 — 학습·추론의 GDS 활용과 패브릭 분리]({{< relref "/platform/kubernetes/gpu/09-storage-reality/index.md" >}}) — 학습과 추론의 실제 데이터 경로에서 GDS가 쓰이는 자리와 스토리지·집합통신 패브릭 분리, 지원 범위와 점검 순서를 다룬다. (스토리지 2부작)
- [10 제공자가 GPU 파드보다 먼저 맞추는 NVLink·패브릭 설정]({{< relref "/platform/kubernetes/gpu/10-provider-fabric-config/index.md" >}}) — FM과 IMEX의 관리 범위, MIG와 가상화의 영향, NVL72 운영, InfiniBand와 RoCE 선택 및 설정 부담을 제공자 관점에서 정리한다. (제공자 설정 2부작)
- [11 GPU 클러스터를 사용자에게 내주기 위한 조건]({{< relref "/platform/kubernetes/gpu/11-provider-validation-tenancy/index.md" >}}) — 배선 규칙과 토폴로지 정보, NCCL 기본값, 인수 합격선, 관측 카운터, 테넌트 경계를 사용자에게 클러스터를 내주는 조건으로 정리한다. (제공자 설정 2부작)

조사 기준일은 2026-10-21입니다. 주요 버전은 Kubernetes 1.37.1, GPU Operator 26.7.2, DRA Driver for NVIDIA GPUs v0.5.1, NCCL 2.32.3, Kueue 0.20.2, Volcano 1.16.0, KAI Scheduler 0.18.6, Network Operator 26.7.1, GDS 1.19.1입니다.
