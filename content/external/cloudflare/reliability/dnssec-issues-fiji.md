---
title: "DNSSEC 검증 오류로 접속이 엇갈린 피지 .fj 도메인"
description: "2022년 3월 8일 피지 .fj 사이트에 일부 사용자만 접속하지 못한 현상은 DNSSEC 검증 문제와 맞아떨어졌습니다. Cloudflare가 관찰한 키 불일치의 흔적과 DS 갱신 뒤의 복구 경과를 짚습니다."
date: 2026-11-14
weight: 31
---

# DNSSEC 검증 오류로 접속이 엇갈린 피지 .fj 도메인 (2022-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [DNSSEC issues take Fiji domains offline](https://blog.cloudflare.com/dnssec-issues-fiji)
- 매체 · 게시일: The Cloudflare Blog · 2022-03-09
- 저자: David Belson
- 피지 ccTLD의 장애를 Cloudflare가 외부에서 관찰한 분석이며, Cloudflare 자사 장애는 아닙니다.
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 사용자마다 달랐던 .fj 접속 {#incident}

3월 8일 아침, Hacker News에 “모든 .fj 도메인이 오프라인이 되었다”는 글이 올라왔습니다. .fj는 피지의 국가 코드 최상위 도메인(ccTLD)입니다. 글에는 접속되지 않는 호스트네임이 여럿 나열됐지만, 댓글에는 문제없이 접속했다는 사람도 있었습니다. 현지 뉴스 사이트 fijivillage는 Vodafone의 M-PAiSA 앱·서비스에도 문제가 생겨 사용자가 금융 거래를 마치지 못한다고 전했습니다.

접속 결과가 엇갈린 데에는 단서가 있었습니다. DNSSEC 문제라면 리졸버의 검증 방식에 따라 이런 차이가 생깁니다. 엄격하게 DNSSEC를 검증하는 리졸버를 쓰는 사용자는 브라우저에서 오류를 보았을 것이고, 검증이 덜 엄격한 리졸버를 쓰는 사용자는 문제없이 접속했을 것입니다. Cloudflare의 조사도 DNSSEC를 원인으로 의심하게 했습니다.

## 검증 실패가 가리킨 .fj 서명 키 {#cause}

트래픽 변화는 UTC 자정 무렵부터 나타났습니다. `.com.fj` 2단계 도메인에 속한 Cloudflare 고객 zone의 HTTP 트래픽이 3월 8일 자정 무렵 거의 즉시 약 40% 줄었고, 오전 내내 감소세가 이어졌습니다. 1.1.1.1 리졸버에서도 `.com.fj` 호스트네임 질의의 오류량이 자정 직후 크게 늘었습니다.

리졸버가 .fj 서버에서 받은 응답에 문제가 있다는 뜻입니다. 같은 시각 Cloudflare Radar에는 피지의 인터넷 장애 징후가 없었습니다. Cloudflare가 인터넷 연결 장애보다 DNS 자체의 문제를 의심한 근거입니다.

`.fj`의 DNSSEC 레코드를 `kdig`로 조회한 결과는 더 구체적이었습니다. 응답 상태는 `SERVFAIL`이었고, `EDE: 9 (DNSKEY Missing): 'no SEP matching the DS found for fj.'`라는 오류가 나왔습니다. EDE 9는 부모 zone에 DS 레코드가 있지만 자식 zone에서 그와 일치하고 리졸버가 지원하는 DNSKEY를 찾지 못했다는 뜻입니다.

검증 기준은 부모 zone의 DS에 있습니다. 이 레코드에는 자식 zone의 KSK를 해시한 값이 들어 있으며, DNSSEC 리졸버는 자식의 KSK를 해시한 결과를 부모의 DS와 비교해 자식 zone의 진위를 검증합니다.

Cloudflare는 UTC 자정 무렵 .fj zone이 루트 zone의 DS와 맞지 않는 키로 서명되기 시작한 것으로 추정했습니다. 예정된 키 롤오버를 진행하면서 IANA의 루트 zone 갱신이 먼저 끝났는지 확인하지 않았을 가능성이 있습니다. IANA는 TLD 운영자와 소통하고, 루트 zone 퍼블리셔에게 다음 버전에 반영할 변경을 지시합니다.

## DS 갱신 뒤에 복구된 .fj 사이트 {#resolution}

Cloudflare가 리졸버 지표를 더 분석해 확인한 복구 시점은 약 14:00 UTC입니다. DS가 갱신된 때였습니다.

단일 도메인의 DNSSEC 설정 오류도 해당 zone의 웹사이트나 앱 접속을 막을 수 있습니다. 오류가 ccTLD 수준에서 발생하면 영향은 훨씬 커집니다. Cloudflare는 이런 일이 너무 자주 일어나는 듯하다고 지적했습니다.

이 분석에는 Ólafur Guðmundsson이 DNSSEC 전문 지식을 보탰습니다.

{{% details title="관측 시각과 수치" closed="true" %}}

| 항목 | 값 |
|---|---|
| 시작 | 2022-03-08 약 00:00 UTC |
| 복구 | 약 14:00 UTC (DS 갱신) |
| .com.fj zone HTTP 트래픽 감소 | 약 40% |
| 리졸버 응답 | SERVFAIL, EDE 9 (DNSKEY Missing) |
| 확인에 쓴 쿼리 | kdig fj. soa +dnssec @1.1.1.1 (2022-03-08 08:57:41 EST) |
| 부수 영향 | Vodafone M-PAiSA 금융 거래 불가 |

{{% /details %}}
