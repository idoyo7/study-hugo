---
title: "컴퓨트·Kubernetes"
description: "우버 엔지니어링 블로그의 컴퓨트·Kubernetes 글 24편 목록입니다. 2020년 이후 글 21편은 한국어 요약으로, 나머지는 원문 링크로 정리했습니다."
date: 2026-11-10
weight: 3
comments: false
---

# 컴퓨트·Kubernetes

## 이 분류에서 찾기 {#section-navigation}

- [서버마다 다른 코어 성능을 CPU 할당에 반영한 Odin의 NCU (2026-10)]({{< relref "/external/uber/compute/diverse-server-fleet.md" >}})
- [우버의 수평 스케일링을 나눠 맡은 ServiceScale (2026-09)]({{< relref "/external/uber/compute/evolving-ubers-compute-platform.md" >}})
- [스택을 미리 키워 CPU 비용을 줄인 Uber의 Go 런타임 (2026-05)]({{< relref "/external/uber/compute/zero-growth-stack.md" >}})
- [Uber의 장기 클라우드 약정을 떠받치는 다섯 물리 계층 (2026-05)]({{< relref "/external/uber/compute/five-layers-cloud.md" >}})
- [버스트 부하에 맞춰 전용·공유 코어를 배분하는 Odin (2026-04)]({{< relref "/external/uber/compute/hybrid-core-allocation.md" >}})
- [서버 성능 검증에 공통 기준을 세운 우버의 Ceilometer (2025-11)]({{< relref "/external/uber/compute/ceilometer-ubers-adaptive-benchmarking-framework.md" >}})
- [재시작의 부담을 줄여 Kubernetes로 옮긴 DSW (2025-05)]({{< relref "/external/uber/compute/migrating-large-scale-compute-workloads-to-kubernetes.md" >}})
- [Mesos에서 Kubernetes로 옮긴 우버의 300만 코어 (2025-04)]({{< relref "/external/uber/compute/migrating-ubers-compute-platform-to-kubernetes-a-technical-journey.md" >}})
- [수천 개 서비스의 실행 기록으로 매일 최적화하는 Go PGO (2025-03)]({{< relref "/external/uber/compute/automating-efficiency-of-go-programs-with-pgo.md" >}})
- [서비스 하나에서 수천 개로 확대한 Uber의 Arm 도입 (2025-02)]({{< relref "/external/uber/compute/adopting-arm-at-scale-transitioning-to-a-multi-architecture-environment.md" >}})
- [Arm 서비스 하나를 위해 다시 준비한 우버의 빌드 기반 (2025-02)]({{< relref "/external/uber/compute/adopting-arm-at-scale-bootstrapping-infrastructure.md" >}})
- [4,500개 서비스가 실행될 존을 엔지니어 대신 고르는 Up (2023-09)]({{< relref "/external/uber/compute/up-portable-microservices-ready-for-the-cloud.md" >}})
- [첫 arm64 호스트를 준비한 우버의 Zig 툴체인 (2023-05)]({{< relref "/external/uber/compute/bootstrapping-ubers-infrastructure-on-arm64-with-zig.md" >}})
- [ARM64 Go 바이너리의 줄 정보를 빠뜨린 링커의 가정 (2023-02)]({{< relref "/external/uber/compute/fixing-gos-linker.md" >}})
- [노트북 한 대에서 존을 세우는 우버의 인프라 스택 Crane (2022-09)]({{< relref "/external/uber/compute/crane-ubers-next-gen-infrastructure-stack.md" >}})
- [페일오버 여유까지 계산한 Uber의 수직 CPU 스케일링 (2022-07)]({{< relref "/external/uber/compute/vertical-cpu-scaling.md" >}})
- [CPU 스로틀링을 멈춘 Uber의 cpuset 전환 (2022-03)]({{< relref "/external/uber/compute/avoiding-cpu-throttling-in-a-containerized-environment.md" >}})
- [다음 피크에 맞춘 Capacity Recommendation Engine (2022-01)]({{< relref "/external/uber/compute/capacity-recommendation-engine.md" >}})
- [남는 메모리로 Go GC 비용을 줄인 우버의 GOGCTuner (2021-12)]({{< relref "/external/uber/compute/how-we-saved-70k-cores-across-30-mission-critical-services.md" >}})
- [CPU 오버커밋의 안전한 여유를 지키는 Uber cQoS (2021-06)]({{< relref "/external/uber/compute/compute-cluster-management.md" >}})
- [수백 GB 힙에서 오래 멈추던 우버 데이터 플랫폼의 JVM (2020-02)]({{< relref "/external/uber/compute/jvm-tuning-garbage-collection.md" >}})

Mesos·Peloton에서 Kubernetes로의 이전, Arm 도입, CPU 할당과 스케일링, Go·JVM 효율화처럼 서버 자원을 다루는 글입니다.

## 요약하지 않은 원문 {#original-only}

2019년 이전 글이거나 아직 요약하지 않은 글입니다. 원문 제목 그대로 링크합니다.

- [Introducing Kraken, an Open Source Peer-to-Peer Docker Registry](https://www.uber.com/us/en/blog/introducing-kraken/) · 2019-03-05
- [Peloton: Uber’s Unified Resource Scheduler for Diverse Cluster Workloads](https://www.uber.com/us/en/blog/resource-scheduler-cluster-management-peloton/) · 2018-10-30
- [Scaling Infrastructure Management with Grail](https://www.uber.com/us/en/blog/grail/) · 2018-03-13
