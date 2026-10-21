---
title: "GPU 클러스터 스토리지"
date: 2026-10-21
lastmod: 2026-10-21
weight: 35
comments: false
cascade:
  type: docs
url: "/gpu-storage/"
linkTitle: "GPU 클러스터 스토리지"
---

# GPU 클러스터 스토리지 — 학습·추론이 스토리지에 요구하는 것

## 이 분류에서 찾기 {#section-navigation}

- [01 워크로드별 I/O]({{< relref "/data/gpu-storage/01-workload-io-patterns/index.md" >}})
- [02 데이터 경로와 파일시스템]({{< relref "/data/gpu-storage/02-data-path-and-filesystems/index.md" >}})
- [03 관리형·오브젝트·Kubernetes]({{< relref "/data/gpu-storage/03-managed-object-kubernetes/index.md" >}})

GPU 클러스터의 스토리지는 한 가지 성능 숫자로 평가하기 어렵습니다. 학습 데이터 로딩, 체크포인트 저장과 복구, 추론 서버의 모델 로딩, KV cache 오프로드가 각각 다른 I/O 패턴을 만들고, 병목이 되는 지점도 단계마다 다릅니다. 스토리지가 병목이 아니라 CPU 전처리나 캐시 구성이 병목인 경우도 있습니다.

이 분류는 그 요구가 어디서 나오는지, 데이터가 GPU까지 어떤 경로로 가는지, 그 뒤의 파일시스템과 관리형 서비스, 오브젝트 스토리지가 어디까지 받아 주는지를 순서대로 따라갑니다. 수치마다 측정 조건을 같이 적었고, 벤더 주장과 공개 벤치마크는 근거 등급으로 구분했습니다. 확인하지 못한 항목은 `?`로 남겼습니다.

## 문서 지도

학습 중 어느 단계가 스토리지를 누르는지부터 보려면 01, 병렬 파일시스템과 GPUDirect Storage를 비교하려면 02, 관리형 서비스나 Kubernetes 구성이 궁금하면 03부터 읽으셔도 됩니다.

| 문서 | 다루는 것 |
|---|---|
| [01 워크로드별 I/O]({{< relref "/data/gpu-storage/01-workload-io-patterns/index.md" >}}) | 학습 데이터 로딩, 체크포인트 크기와 저장 방식, 모델 로딩, KV cache의 계층과 크기, 병목이 스토리지가 아닌 경우 |
| [02 데이터 경로와 파일시스템]({{< relref "/data/gpu-storage/02-data-path-and-filesystems/index.md" >}}) | GPUDirect Storage가 이득이 되는 조건, SuperPOD의 스토리지 요구치, NVIDIA 인증 목록 읽는 법, 병렬·분산 파일시스템 비교, 메타데이터 구조와 I/O 패턴 |
| [03 관리형·오브젝트·Kubernetes]({{< relref "/data/gpu-storage/03-managed-object-kubernetes/index.md" >}}) | 클라우드 관리형 Lustre의 용량별 대역폭, 그 밖의 관리형 서비스, 오브젝트 원본과 캐시 구성, Kubernetes에서 걸리는 조건, MLPerf Storage 읽는 법, 체크포인트가 병렬 파일시스템을 요구하는지 |

## 비교할 때 함께 볼 조건

- 워크로드 단계. 학습 로딩, 체크포인트, 모델 로딩, KV cache는 읽기·쓰기 비율과 요청 크기, 요구 시점이 모두 다르다. 어느 단계의 수치인지 먼저 확인해야 한다.
- 동기와 비동기 체크포인트. 동기 방식은 쓰는 동안 GPU가 멈추므로 피크 쓰기 대역폭이 중요하고, 비동기 방식은 평균 대역폭이 중요하다. 같은 클러스터도 방식에 따라 요구가 달라진다.
- GDS 조건. GPUDirect Storage는 PCIe 토폴로지, 직접 I/O와 정렬, 파일시스템 지원 여부를 만족해야 효과가 있고, 조건이 어긋나면 호환 모드로 조용히 떨어진다.
- 메타데이터 구조. 메타데이터를 별도 서버가 맡는 파일시스템과 데이터 노드에 분산하는 파일시스템은 작은 파일과 많은 파일에서 다르게 움직인다.
- 관리형 서비스의 대역폭. 관리형 Lustre는 대체로 프로비저닝한 용량에 비례해 대역폭이 정해진다. 필요한 대역폭 때문에 용량을 더 빌려야 할 수 있다.
- 수치가 측정된 조건. 노드 수, GPU 종류, 요청 크기, 클라이언트 수가 다르면 같은 표에 올릴 수 없다. 벤더 주장은 공개 벤치마크와 구분해서 읽는다.
