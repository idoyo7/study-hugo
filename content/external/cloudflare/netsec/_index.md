---
title: "네트워크·보안"
description: "Cloudflare 기술 블로그의 네트워크·보안 글 31편 목록입니다. 글마다 원문을 읽고 한국어로 요약했습니다."
date: 2026-11-14
weight: 9
comments: false
---

# 네트워크·보안

## 이 분류에서 찾기 {#section-navigation}

- [무료 인증서의 새 공급원이 되려는 Cloudflare CA (2026-09)]({{< relref "/external/cloudflare/netsec/cloudflare-certificate-authority.md" >}})
- [MTC로 포스트 퀀텀 인증을 준비하는 Cloudflare CA (2026-09)]({{< relref "/external/cloudflare/netsec/pq-ca-with-mtcs.md" >}})
- [Cloudflare Containers의 빈 공간에 남은 다른 고객의 데이터 (2026-09)]({{< relref "/external/cloudflare/netsec/containers-cross-tenant-vulnerability.md" >}})
- [.al 장애 때 DNSSEC 검증 우회를 알린 1.1.1.1 (2026-07)]({{< relref "/external/cloudflare/netsec/dnssec-nta-ede-33.md" >}})
- [오리진의 리전을 알게 된 Smart Tiered Cache (2026-07)]({{< relref "/external/cloudflare/netsec/smart-tiered-cache-for-public-clouds.md" >}})
- [Linux CUBIC의 유휴 보정에 갇힌 QUIC 연결 (2026-05)]({{< relref "/external/cloudflare/netsec/quic-death-spiral-fix.md" >}})
- [Linux Copy Fail을 재부팅 없이 막은 Cloudflare (2026-05)]({{< relref "/external/cloudflare/netsec/copy-fail-linux-vulnerability-mitigation.md" >}})
- [BPF 바이트코드에서 매직 패킷을 만드는 filterforge (2026-04)]({{< relref "/external/cloudflare/netsec/from-bpf-to-packet.md" >}})
- [백엔드와 HTTP 요청의 끝을 다르게 읽은 Pingora (2026-03)]({{< relref "/external/cloudflare/netsec/pingora-oss-smuggling-vulnerabilities.md" >}})
- [Cloudflare ACME 검증에서 오리진까지 이어진 WAF 예외 (2026-01)]({{< relref "/external/cloudflare/netsec/acme-path-vulnerability.md" >}})
- [사설망 안의 서비스에 닿는 Workers VPC Services (2025-11)]({{< relref "/external/cloudflare/netsec/workers-vpc-open-beta.md" >}})
- [Linux로 만든 WARP VPN이 마주한 IPv4 비용 (2025-10)]({{< relref "/external/cloudflare/netsec/how-to-build-your-own-vpn-or-the-history-of-warp.md" >}})
- [수백만 항목 앞에서 한계를 드러낸 BPF LPM trie (2025-10)]({{< relref "/external/cloudflare/netsec/a-deep-dive-into-bpf-lpm-trie-performance-and-optimization.md" >}})
- [요청마다 할 일을 줄인 Cloudflare의 Rust FL2 (2025-09)]({{< relref "/external/cloudflare/netsec/20-percent-internet-upgrade.md" >}})
- [Cloudflare Workers의 보안 경계가 된 샌드박스 배치 (2025-09)]({{< relref "/external/cloudflare/netsec/safe-in-the-sandbox-security-hardening-for-cloudflare-workers.md" >}})
- [600만 도메인의 암호화를 높인 Automatic SSL/TLS (2025-09)]({{< relref "/external/cloudflare/netsec/automatically-secure.md" >}})
- [Salesloft Drift에서 시작된 Cloudflare 지원 케이스 유출 (2025-09)]({{< relref "/external/cloudflare/netsec/response-to-salesloft-drift-incident.md" >}})
- [Privacy Proxy의 40ms 지연을 줄인 명령 버퍼링 (2025-08)]({{< relref "/external/cloudflare/netsec/reducing-double-spend-latency-from-40-ms-to-less-than-1-ms-on-privacy-proxy.md" >}})
- [캐시 적중 뒤 남은 본문에 오염된 Pingora의 다음 요청 (2025-05)]({{< relref "/external/cloudflare/netsec/resolving-a-request-smuggling-vulnerability-in-pingora.md" >}})
- [배포 전에 DNS 정책 충돌을 잡는 Cloudflare Topaz (2024-11)]({{< relref "/external/cloudflare/netsec/topaz-policy-engine-design.md" >}})
- [ROA 서명 뒤에도 벌어진 Cloudflare 1.1.1.1 장애 (2024-07)]({{< relref "/external/cloudflare/netsec/cloudflare-1111-incident-on-june-27-2024.md" >}})
- [브라우저를 재사용하도록 바꾼 Cloudflare URL Scanner (2024-03)]({{< relref "/external/cloudflare/netsec/building-urlscanner.md" >}})
- [Okta 통보보다 먼저 시작된 Cloudflare의 침해 대응 (2023-10)]({{< relref "/external/cloudflare/netsec/how-cloudflare-mitigated-yet-another-okta-compromise.md" >}})
- [Cloudflare가 서버 패치에 나선 AMD Zenbleed (2023-07)]({{< relref "/external/cloudflare/netsec/zenbleed-vulnerability.md" >}})
- [TCP 수신 버퍼의 과도한 증가를 멈춘 Cloudflare의 커널 패치 (2023-05)]({{< relref "/external/cloudflare/netsec/unbounded-memory-usage-by-tcp-for-receive-buffers-and-how-we-fixed-it.md" >}})
- [Cloudflare Workers로 완성한 DMARC Management (2023-03)]({{< relref "/external/cloudflare/netsec/how-we-built-dmarc-management.md" >}})
- [키를 쓸 지역을 암호화로 제한한 Geo Key Manager v2 (2023-01)]({{< relref "/external/cloudflare/netsec/inside-geo-key-manager-v2-attribute-based-encryption.md" >}})
- [비밀번호 유출 뒤에도 Cloudflare를 지킨 보안 키 (2022-08)]({{< relref "/external/cloudflare/netsec/2022-07-sms-phishing-attacks.md" >}})
- [Okta 침해 뒤 계정 변경 기록을 되짚은 Cloudflare (2022-03)]({{< relref "/external/cloudflare/netsec/cloudflare-investigation-of-the-january-2022-okta-compromise.md" >}})
- [행간을 읽지 않는 Tamarin의 KEMTLS 보안 증명 (2022-02)]({{< relref "/external/cloudflare/netsec/post-quantum-formal-analysis.md" >}})
- [상주 데몬 없이 수백만 IP의 연결을 배분하는 tubular (2022-02)]({{< relref "/external/cloudflare/netsec/tubular-fixing-the-socket-api-with-ebpf.md" >}})

네트워크 구성과 서비스 보안을 다루는 글입니다. Cloudflare 기술 블로그에서 고른 31편을 게시일 최신순으로 실었습니다.
