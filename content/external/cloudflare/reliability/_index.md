---
title: "신뢰성·트래픽 관리"
description: "Cloudflare 기술 블로그의 신뢰성·트래픽 관리 글 32편 목록입니다. 글마다 원문을 읽고 한국어로 요약했습니다."
date: 2026-11-14
weight: 5
comments: false
---

# 신뢰성·트래픽 관리

## 이 분류에서 찾기 {#section-navigation}

- [hyper HTTP 라이브러리의 응답 잘림 버그 추적 (2026-06)]({{< relref "/external/cloudflare/reliability/hyper-bug.md" >}})
- [DNSSEC 서명 오류로 인한 .de TLD 장애 대응 (2026-05)]({{< relref "/external/cloudflare/reliability/de-tld-outage-dnssec.md" >}})
- [Code Orange Fail Small 완료와 재발 방지 체계 (2026-05)]({{< relref "/external/cloudflare/reliability/code-orange-fail-small-complete.md" >}})
- [Rust Workers의 panic과 abort 복구 구조 (2026-04)]({{< relref "/external/cloudflare/reliability/making-rust-workers-reliable.md" >}})
- [BYOIP 프리픽스 대량 철회로 번진 2026년 2월 20일 장애 (2026-02)]({{< relref "/external/cloudflare/reliability/cloudflare-outage-february-20-2026.md" >}})
- [마이애미 라우터 정책 오류가 만든 2026년 1월 22일 BGP 경로 유출 (2026-01)]({{< relref "/external/cloudflare/reliability/route-leak-incident-january-22-2026.md" >}})
- [1.1.1.1 응답의 CNAME 순서 변경과 DNS 표준의 모호함 (2026-01)]({{< relref "/external/cloudflare/reliability/cname-a-record-order-dns-standards.md" >}})
- [Code Orange Fail Small 복원력 계획 (2025-12)]({{< relref "/external/cloudflare/reliability/fail-small-resilience-plan.md" >}})
- [WAF 테스트 도구 비활성화가 부른 2025년 12월 5일 500 오류 (2025-12)]({{< relref "/external/cloudflare/reliability/5-december-2025-outage.md" >}})
- [2025년 11월 18일 Cloudflare 네트워크 장애 포스트모템 (2025-11)]({{< relref "/external/cloudflare/reliability/18-november-2025-outage.md" >}})
- [2025년 9월 12일 Cloudflare 대시보드·API 장애 포스트모템 (2025-09)]({{< relref "/external/cloudflare/reliability/deep-dive-into-cloudflares-sept-12-dashboard-and-api-outage.md" >}})
- [2025년 8월 21일 AWS us-east-1 구간 네트워크 혼잡 포스트모템 (2025-08)]({{< relref "/external/cloudflare/reliability/cloudflare-incident-on-august-21-2025.md" >}})
- [Workers KV 저장소 이중화 재설계와 성능 개선 (2025-08)]({{< relref "/external/cloudflare/reliability/rearchitecting-workers-kv-for-redundancy.md" >}})
- [2025년 7월 14일 Cloudflare 1.1.1.1 리졸버 장애 포스트모템 (2025-07)]({{< relref "/external/cloudflare/reliability/cloudflare-1-1-1-1-incident-on-july-14-2025.md" >}})
- [2025년 6월 12일 Cloudflare Workers KV 의존 장애 포스트모템 (2025-06)]({{< relref "/external/cloudflare/reliability/cloudflare-service-outage-june-12-2025.md" >}})
- [2024년 11월 14일 Cloudflare Logs 유실 장애 (2024-11)]({{< relref "/external/cloudflare/reliability/cloudflare-incident-on-november-14-2024-resulting-in-lost-logs.md" >}})
- [Cloudflare가 본 2024년 10월 OVHcloud 장애 (2024-10)]({{< relref "/external/cloudflare/reliability/cloudflare-perspective-of-the-october-30-2024-ovhcloud-outage.md" >}})
- [2024년 9월 17일 IPv4 프리픽스 광고 중단 장애 (2024-09)]({{< relref "/external/cloudflare/reliability/cloudflare-incident-on-september-17-2024.md" >}})
- [DDoS 규칙이 깨운 rate limit 무한 루프 장애 (2024-06)]({{< relref "/external/cloudflare/reliability/cloudflare-incident-on-june-20-2024.md" >}})
- [같은 데이터 센터의 두 번째 정전과 Code Orange 시험 (2024-04)]({{< relref "/external/cloudflare/reliability/major-data-center-power-failure-again-cloudflare-code-orange-tested.md" >}})
- [데이터 센터 정전이 부른 컨트롤 플레인과 애널리틱스 장애 (2023-11)]({{< relref "/external/cloudflare/reliability/post-mortem-on-cloudflare-control-plane-and-analytics-outage.md" >}})
- [Workers KV 배포 도구 오류가 부른 37분 장애 (2023-11)]({{< relref "/external/cloudflare/reliability/cloudflare-incident-on-october-30-2023.md" >}})
- [ZONEMD 레코드와 루트 존 DNSSEC 만료가 부른 1.1.1.1 조회 실패 (2023-10)]({{< relref "/external/cloudflare/reliability/1-1-1-1-lookup-failures-on-october-4th-2023.md" >}})
- [Traffic Manager의 글로벌 트래픽 자동 분산 (2023-09)]({{< relref "/external/cloudflare/reliability/meet-traffic-manager.md" >}})
- [Workers KV 연쇄 장애의 포스트모템과 배포 안전성 강화 (2023-08)]({{< relref "/external/cloudflare/reliability/workers-kv-restoring-reliability.md" >}})
- [Verisign DNSSEC 서명 만료로 인한 아시아태평양 연결 오류 (2023-07)]({{< relref "/external/cloudflare/reliability/connection-errors-in-asia-pacific-region-on-july-9-2023.md" >}})
- [2023년 1월 24일 서비스 토큰 덮어쓰기 장애 (2023-01)]({{< relref "/external/cloudflare/reliability/cloudflare-incident-on-january-24th-2023-service-tokens.md" >}})
- [2022년 10월 25일 Tiered Cache 530 오류 부분 장애 (2022-10)]({{< relref "/external/cloudflare/reliability/partial-cloudflare-outage-on-october-25-2022-tiered-cache.md" >}})
- [2022년 6월 21일 BGP 정책 순서 변경 장애 (2022-06)]({{< relref "/external/cloudflare/reliability/cloudflare-outage-on-june-21-2022-bgp-policy.md" >}})
- [pipefail 누락이 일으킨 Cloudflare 30분 지연 장애 (2022-04)]({{< relref "/external/cloudflare/reliability/pipefail-how-a-missing-shell-option-slowed-cloudflare-down.md" >}})
- [DNSSEC 오류로 오프라인이 된 피지 도메인 (2022-03)]({{< relref "/external/cloudflare/reliability/dnssec-issues-fiji.md" >}})
- [호스트네임 24개 오라우팅 사고 (2022-01)]({{< relref "/external/cloudflare/reliability/incorrect-proxying-of-24-hostnames-on-january-24-2022.md" >}})

장애 대응과 이중화, 트래픽 제어처럼 서비스를 안정적으로 유지하는 방법을 다루는 글입니다. Cloudflare 기술 블로그에서 고른 32편을 게시일 최신순으로 실었습니다.
