---
title: "신뢰성·트래픽 관리"
description: "Cloudflare 기술 블로그의 신뢰성·트래픽 관리 글 32편 목록입니다. 글마다 원문을 읽고 한국어로 요약했습니다."
date: 2026-11-14
weight: 5
comments: false
---

# 신뢰성·트래픽 관리

## 이 분류에서 찾기 {#section-navigation}

- [200 OK 뒤에 숨어 있던 hyper의 응답 잘림 버그 (2026-06)]({{< relref "/external/cloudflare/reliability/hyper-bug.md" >}})
- [깨진 .de 서명 앞에서 DNSSEC 예외를 택한 Cloudflare (2026-05)]({{< relref "/external/cloudflare/reliability/de-tld-outage-dnssec.md" >}})
- [장애 반경을 줄인 Code Orange Fail Small (2026-05)]({{< relref "/external/cloudflare/reliability/code-orange-fail-small-complete.md" >}})
- [한 요청의 실패에 멈춰 서던 Rust Workers의 복구 설계 (2026-04)]({{< relref "/external/cloudflare/reliability/making-rust-workers-reliable.md" >}})
- [Cloudflare BYOIP 대량 철회로 번진 삭제 자동화 (2026-02)]({{< relref "/external/cloudflare/reliability/cloudflare-outage-february-20-2026.md" >}})
- [프리픽스 목록 삭제가 부른 Cloudflare BGP 경로 유출 (2026-01)]({{< relref "/external/cloudflare/reliability/route-leak-incident-january-22-2026.md" >}})
- [1.1.1.1의 메모리 최적화가 뒤집은 CNAME 순서 (2026-01)]({{< relref "/external/cloudflare/reliability/cname-a-record-order-dns-standards.md" >}})
- [Cloudflare의 장애 확산을 막을 Code Orange Fail Small (2025-12)]({{< relref "/external/cloudflare/reliability/fail-small-resilience-plan.md" >}})
- [Cloudflare의 HTTP 500 오류를 부른 WAF 킬스위치 (2025-12)]({{< relref "/external/cloudflare/reliability/5-december-2025-outage.md" >}})
- [Cloudflare 트래픽을 멈춘 Bot Management 피처 파일 (2025-11)]({{< relref "/external/cloudflare/reliability/18-november-2025-outage.md" >}})
- [Cloudflare 대시보드에서 시작된 Tenant Service 장애 (2025-09)]({{< relref "/external/cloudflare/reliability/deep-dive-into-cloudflares-sept-12-dashboard-and-api-outage.md" >}})
- [한 고객이 포화시킨 Cloudflare와 AWS us-east-1 연결 (2025-08)]({{< relref "/external/cloudflare/reliability/cloudflare-incident-on-august-21-2025.md" >}})
- [288바이트에 맞춰 다시 설계한 Workers KV 저장소 (2025-08)]({{< relref "/external/cloudflare/reliability/rearchitecting-workers-kv-for-redundancy.md" >}})
- [Cloudflare 1.1.1.1을 멈춘 서비스 토폴로지 설정 (2025-07)]({{< relref "/external/cloudflare/reliability/cloudflare-1-1-1-1-incident-on-july-14-2025.md" >}})
- [Cloudflare Workers KV 뒤에 남은 단일 장애점 (2025-06)]({{< relref "/external/cloudflare/reliability/cloudflare-service-outage-june-12-2025.md" >}})
- [로그를 지키려다 과부하를 부른 Cloudflare Logs (2024-11)]({{< relref "/external/cloudflare/reliability/cloudflare-incident-on-november-14-2024-resulting-in-lost-logs.md" >}})
- [Cloudflare에서 추적한 OVHcloud 장애의 경로 (2024-10)]({{< relref "/external/cloudflare/reliability/cloudflare-perspective-of-the-october-30-2024-ovhcloud-outage.md" >}})
- [비어 있다고 믿은 주소에서 시작된 Cloudflare IPv4 장애 (2024-09)]({{< relref "/external/cloudflare/reliability/cloudflare-incident-on-september-17-2024.md" >}})
- [DDoS 규칙이 드러낸 Cloudflare의 무한 루프 (2024-06)]({{< relref "/external/cloudflare/reliability/cloudflare-incident-on-june-20-2024.md" >}})
- [두 번째 정전으로 검증한 Cloudflare의 Code Orange (2024-04)]({{< relref "/external/cloudflare/reliability/major-data-center-power-failure-again-cloudflare-code-orange-tested.md" >}})
- [PDX-04 정전으로 드러난 Cloudflare의 숨은 의존성 (2023-11)]({{< relref "/external/cloudflare/reliability/post-mortem-on-cloudflare-control-plane-and-analytics-outage.md" >}})
- [Cloudflare의 복구 도구까지 멈춘 Workers KV 장애 (2023-11)]({{< relref "/external/cloudflare/reliability/cloudflare-incident-on-october-30-2023.md" >}})
- [ZONEMD 추가 뒤 멈춘 1.1.1.1의 루트 존 갱신 (2023-10)]({{< relref "/external/cloudflare/reliability/1-1-1-1-lookup-failures-on-october-4th-2023.md" >}})
- [필요한 트래픽만 옮기는 Cloudflare Traffic Manager (2023-09)]({{< relref "/external/cloudflare/reliability/meet-traffic-manager.md" >}})
- [잘못된 설정에 얼어붙은 Workers KV와 점진 배포의 빈틈 (2023-08)]({{< relref "/external/cloudflare/reliability/workers-kv-restoring-reliability.md" >}})
- [Verisign DNSSEC 장애로 태평양을 건넌 DNS 쿼리 (2023-07)]({{< relref "/external/cloudflare/reliability/connection-errors-in-asia-pacific-region-on-july-9-2023.md" >}})
- [롤백 뒤에 번진 Cloudflare 서비스 토큰 장애 (2023-01)]({{< relref "/external/cloudflare/reliability/cloudflare-incident-on-january-24th-2023-service-tokens.md" >}})
- [분산 트레이싱이 지운 Tiered Cache의 제어 헤더 (2022-10)]({{< relref "/external/cloudflare/reliability/partial-cloudflare-outage-on-october-25-2022-tiered-cache.md" >}})
- [Cloudflare MCP 19곳의 연결을 끊은 BGP 정책 순서 (2022-06)]({{< relref "/external/cloudflare/reliability/cloudflare-outage-on-june-21-2022-bgp-policy.md" >}})
- [Cloudflare의 30분 지연을 부른 pipefail 누락 (2022-04)]({{< relref "/external/cloudflare/reliability/pipefail-how-a-missing-shell-option-slowed-cloudflare-down.md" >}})
- [DNSSEC 검증 오류로 접속이 엇갈린 피지 .fj 도메인 (2022-03)]({{< relref "/external/cloudflare/reliability/dnssec-issues-fiji.md" >}})
- [Cloudflare for SaaS 이전 중 잘못 활성화된 호스트네임 (2022-01)]({{< relref "/external/cloudflare/reliability/incorrect-proxying-of-24-hostnames-on-january-24-2022.md" >}})

장애 대응과 이중화, 트래픽 제어처럼 서비스를 안정적으로 유지하는 방법을 다루는 글입니다. Cloudflare 기술 블로그에서 고른 32편을 게시일 최신순으로 실었습니다.
