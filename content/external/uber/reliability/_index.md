---
title: "신뢰성·트래픽 관리"
description: "우버 엔지니어링 블로그의 신뢰성·트래픽 관리 글 16편 목록입니다. 2020년 이후 글 12편은 한국어 요약으로, 나머지는 원문 링크로 정리했습니다."
date: 2026-11-10
weight: 5
comments: false
---

# 신뢰성·트래픽 관리

## 이 분류에서 찾기 {#section-navigation}

- [깊은 호출 체인의 재시도 폭주를 막은 Uber의 에러 소유권 (2026-09)]({{< relref "/external/uber/reliability/protecting-against-retry-storms.md" >}})
- [존 하나와 노드 하나를 잃어도 버티는 우버의 OpenSearch (2026-06)]({{< relref "/external/uber/reliability/zone-failure-resilient.md" >}})
- [Docstore와 Schemaless에서 승차 요청을 지키는 Cinnamon (2026-04)]({{< relref "/external/uber/reliability/from-static-rate-limiting-to-intelligent-load-management.md" >}})
- [전역 부하로 요청을 거르는 Global Rate Limiter (2026-02)]({{< relref "/external/uber/reliability/ubers-rate-limiting-system.md" >}})
- [고르게 나눈 요청에도 남는 CPU 불균형과 Uber의 ALB (2024-03)]({{< relref "/external/uber/reliability/load-balancing-handling-heterogeneous-hardware.md" >}})
- [과부하 속에서 한계를 찾는 Cinnamon Auto-tuner (2023-12)]({{< relref "/external/uber/reliability/cinnamon-auto-tuner-adaptive-concurrency-in-the-wild.md" >}})
- [Cinnamon의 거절 비율을 안정시킨 PID 컨트롤러 (2023-11)]({{< relref "/external/uber/reliability/pid-controller-for-cinnamon.md" >}})
- [설정값 없이 과부하를 견디는 로드 셰더 Cinnamon (2023-11)]({{< relref "/external/uber/reliability/cinnamon-using-century-old-tech-to-build-a-mean-load-shedder.md" >}})
- [Java GC 실험에서 부하 테스트 서비스로 자란 Shadower (2022-06)]({{< relref "/external/uber/reliability/introducing-shadower-a-minimalistic-load-testing-tool.md" >}})
- [서비스 메시의 연결 폭을 조절하는 Uber 동적 서브셋팅 (2022-05)]({{< relref "/external/uber/reliability/better-load-balancing-real-time-dynamic-subsetting.md" >}})
- [실제 트래픽을 재생해 서비스 한계를 찾는 Ballast (2022-03)]({{< relref "/external/uber/reliability/introducing-ballast-an-adaptive-load-test-framework.md" >}})
- [Eats Safety의 모바일·백엔드 통합 온콜 교대 (2021-08)]({{< relref "/external/uber/reliability/eats-safety-team-on-call-overview.md" >}})

재시도 폭주, rate limiting, 부하 차단(load shedding), 로드 밸런싱, 부하 테스트, 존 장애 대비처럼 장애를 막고 견디는 글입니다.

## 요약하지 않은 원문 {#original-only}

2019년 이전 글이거나 아직 요약하지 않은 글입니다. 원문 제목 그대로 링크합니다.

- [Introducing QALM, Uber’s QoS Load Management Framework](https://www.uber.com/us/en/blog/qalm-qos-load-management-framework/) · 2018-03-22
- [Denial By DNS: Uber’s Open Source Tool for Preventing Resource Exhaustion by DNS Outages](https://www.uber.com/us/en/blog/denial-by-dns/) · 2017-12-05
- [Reliability at Scale: Engineering an Uneventful New Year’s Eve](https://www.uber.com/us/en/blog/nye/) · 2017-11-30
- [How Uber Thinks About Site Reliability Engineering](https://www.uber.com/us/en/blog/site-reliability-engineering-talks-feb-2016/) · 2016-03-03
