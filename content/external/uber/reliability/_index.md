---
title: "신뢰성·트래픽 관리"
description: "우버 엔지니어링 블로그의 신뢰성·트래픽 관리 글 17편 목록입니다. 2020년 이후 글 10편은 한국어 요약으로, 나머지는 원문 링크로 정리했습니다."
date: 2026-11-10
weight: 5
comments: false
---

# 신뢰성·트래픽 관리

## 이 분류에서 찾기 {#section-navigation}

- [재시도 폭주를 막는 에러 소유권 (2026-09)]({{< relref "/external/uber/reliability/protecting-against-retry-storms.md" >}})
- [존 장애를 견디는 우버의 OpenSearch (2026-06)]({{< relref "/external/uber/reliability/zone-failure-resilient.md" >}})
- [정적 쿼터에서 지능형 부하 관리로 옮겨 간 우버 데이터베이스 과부하 대응 (2026-04)]({{< relref "/external/uber/reliability/from-static-rate-limiting-to-intelligent-load-management.md" >}})
- [서비스 메시에 넣은 Global Rate Limiter와 자동 한도 설정 (2026-02)]({{< relref "/external/uber/reliability/ubers-rate-limiting-system.md" >}})
- [이기종 하드웨어를 다루는 로드 밸런싱 (2024-03)]({{< relref "/external/uber/reliability/load-balancing-handling-heterogeneous-hardware.md" >}})
- [설정 없이 동작하는 Cinnamon 적응형 동시성 제한 (2023-12)]({{< relref "/external/uber/reliability/cinnamon-auto-tuner-adaptive-concurrency-in-the-wild.md" >}})
- [Cinnamon 거절기를 움직이는 PID 컨트롤러 (2023-11)]({{< relref "/external/uber/reliability/pid-controller-for-cinnamon.md" >}})
- [100년 된 기법으로 만든 로드 셰더 Cinnamon (2023-11)]({{< relref "/external/uber/reliability/cinnamon-using-century-old-tech-to-build-a-mean-load-shedder.md" >}})
- [대규모 인보이스 서비스 이전에서 겪은 위험과 교훈 (2023-08)]({{< relref "/external/uber/reliability/the-perils-of-migrating-a-large-scale-service-at-uber.md" >}})
- [마이크로서비스 부하 테스트 서비스 Shadower (2022-06)]({{< relref "/external/uber/reliability/introducing-shadower-a-minimalistic-load-testing-tool.md" >}})

재시도 폭주, rate limiting, 부하 차단(load shedding), 로드 밸런싱, 부하 테스트, 존 장애 대비처럼 장애를 막고 견디는 글입니다.

## 요약하지 않은 원문 {#original-only}

2019년 이전 글이거나 아직 요약하지 않은 글입니다. 원문 제목 그대로 링크합니다.

- [Better Load Balancing: Real-Time Dynamic Subsetting](https://www.uber.com/us/en/blog/better-load-balancing-real-time-dynamic-subsetting/) · 2022-05-17
- [Introducing Ballast: An Adaptive Load Test Framework](https://www.uber.com/us/en/blog/introducing-ballast-an-adaptive-load-test-framework/) · 2022-03-01
- [Eats Safety Team On-Call Overview](https://www.uber.com/us/en/blog/eats-safety-team-on-call-overview/) · 2021-08-19
- [Introducing QALM, Uber’s QoS Load Management Framework](https://www.uber.com/us/en/blog/qalm-qos-load-management-framework/) · 2018-03-22
- [Denial By DNS: Uber’s Open Source Tool for Preventing Resource Exhaustion by DNS Outages](https://www.uber.com/us/en/blog/denial-by-dns/) · 2017-12-05
- [Reliability at Scale: Engineering an Uneventful New Year’s Eve](https://www.uber.com/us/en/blog/nye/) · 2017-11-30
- [How Uber Thinks About Site Reliability Engineering](https://www.uber.com/us/en/blog/site-reliability-engineering-talks-feb-2016/) · 2016-03-03
