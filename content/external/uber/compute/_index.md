---
title: "컴퓨트·Kubernetes"
description: "우버 엔지니어링 블로그의 컴퓨트·Kubernetes 글 28편 목록입니다. 2020년 이후 글 13편은 한국어 요약으로, 나머지는 원문 링크로 정리했습니다."
date: 2026-11-10
weight: 3
comments: false
---

# 컴퓨트·Kubernetes

## 이 분류에서 찾기 {#section-navigation}

- [이기종 서버 위에서 스테이트풀 워크로드에 같은 연산 능력을 주는 NCU (2026-10)]({{< relref "/external/uber/compute/diverse-server-fleet.md" >}})
- [수평 스케일링 컨트롤러를 둘로 나눈 우버 컴퓨트 플랫폼 (2026-09)]({{< relref "/external/uber/compute/evolving-ubers-compute-platform.md" >}})
- [Go 고루틴 스택을 미리 키워 아끼는 CPU 10% (2026-05)]({{< relref "/external/uber/compute/zero-growth-stack.md" >}})
- [클라우드 약정이 기대는 물리 계층 다섯 가지 (2026-05)]({{< relref "/external/uber/compute/five-layers-cloud.md" >}})
- [전용 코어와 공유 코어를 섞은 Odin의 하이브리드 CPU 할당 (2026-04)]({{< relref "/external/uber/compute/hybrid-core-allocation.md" >}})
- [Arm 이전 경험으로 함께 다듬은 OCI AmpereOne M A4 인스턴스 (2025-12)]({{< relref "/external/uber/compute/how-uber-oci-and-ampere-co-optimized-oci-ampereone-m-a4-compute.md" >}})
- [우버의 적응형 벤치마킹 프레임워크 Ceilometer (2025-11)]({{< relref "/external/uber/compute/ceilometer-ubers-adaptive-benchmarking-framework.md" >}})
- [중단 없이 Kubernetes로 옮긴 대화형 노트북 워크로드 (2025-05)]({{< relref "/external/uber/compute/migrating-large-scale-compute-workloads-to-kubernetes.md" >}})
- [Mesos에서 Kubernetes로 옮긴 우버 stateless 컴퓨트 플랫폼 (2025-04)]({{< relref "/external/uber/compute/migrating-ubers-compute-platform-to-kubernetes-a-technical-journey.md" >}})
- [Go 프로그램 효율을 자동으로 올리는 프로파일 기반 최적화 (2025-03)]({{< relref "/external/uber/compute/automating-efficiency-of-go-programs-with-pgo.md" >}})
- [수천 개 서비스를 Arm으로 옮긴 멀티 아키텍처 전환 (2025-02)]({{< relref "/external/uber/compute/adopting-arm-at-scale-transitioning-to-a-multi-architecture-environment.md" >}})
- [x86 일색 인프라에 Arm을 들이는 부트스트래핑 (2025-02)]({{< relref "/external/uber/compute/adopting-arm-at-scale-bootstrapping-infrastructure.md" >}})
- [클라우드를 위한 이동 가능한 마이크로서비스 Up (2023-09)]({{< relref "/external/uber/compute/up-portable-microservices-ready-for-the-cloud.md" >}})

Mesos·Peloton에서 Kubernetes로의 이전, Arm 도입, CPU 할당과 스케일링, Go·JVM 효율화처럼 서버 자원을 다루는 글입니다.

## 요약하지 않은 원문 {#original-only}

2019년 이전 글이거나 아직 요약하지 않은 글입니다. 원문 제목 그대로 링크합니다.

- [Bootstrapping Uber’s Infrastructure on arm64 with Zig](https://www.uber.com/us/en/blog/bootstrapping-ubers-infrastructure-on-arm64-with-zig/) · 2023-05-03
- [Uber’s Sustainable Engineering Journey](https://www.uber.com/us/en/blog/ubers-sustainable-engineering-journey/) · 2023-03-02
- [Fixing Go’s Linker: An Unexpected Journey into ARM64, DWARF, and Linker Internals](https://www.uber.com/us/en/blog/fixing-gos-linker/) · 2023-02-16
- [Crane: Uber’s Next-Gen Infrastructure Stack](https://www.uber.com/us/en/blog/crane-ubers-next-gen-infrastructure-stack/) · 2022-09-15
- [Vertical CPU Scaling: Reduce Cost of Capacity and Increase Reliability](https://www.uber.com/us/en/blog/vertical-cpu-scaling/) · 2022-07-14
- [Avoiding CPU Throttling in a Containerized Environment](https://www.uber.com/us/en/blog/avoiding-cpu-throttling-in-a-containerized-environment/) · 2022-03-22
- [Capacity Recommendation Engine: Throughput and Utilization Based Predictive Scaling](https://www.uber.com/us/en/blog/capacity-recommendation-engine/) · 2022-01-19
- [How We Saved 70K Cores Across 30 Mission-Critical Services (Large-Scale, Semi-Automated Go GC Tuning @Uber)](https://www.uber.com/us/en/blog/how-we-saved-70k-cores-across-30-mission-critical-services/) · 2021-12-22
- [Efficient and Reliable Compute Cluster Management at Scale](https://www.uber.com/us/en/blog/compute-cluster-management/) · 2021-06-22
- [Tricks of the Trade: Tuning JVM Memory for Large-scale Services](https://www.uber.com/us/en/blog/jvm-tuning-garbage-collection/) · 2020-02-26
- [Open Sourcing Peloton, Uber’s Unified Resource Scheduler](https://www.uber.com/us/en/blog/open-sourcing-peloton/) · 2019-03-08
- [Introducing Kraken, an Open Source Peer-to-Peer Docker Registry](https://www.uber.com/us/en/blog/introducing-kraken/) · 2019-03-05
- [Introducing Makisu: Uber’s Fast, Reliable Docker Image Builder for Apache Mesos and Kubernetes](https://www.uber.com/us/en/blog/makisu/) · 2018-12-06
- [Peloton: Uber’s Unified Resource Scheduler for Diverse Cluster Workloads](https://www.uber.com/us/en/blog/resource-scheduler-cluster-management-peloton/) · 2018-10-30
- [Scaling Infrastructure Management with Grail](https://www.uber.com/us/en/blog/grail/) · 2018-03-13
