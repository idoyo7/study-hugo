---
title: "DNSSEC 오류로 오프라인이 된 피지 도메인"
description: "2022년 3월 8일 .fj 도메인이 일부 환경에서 접속되지 않은 사고를 Cloudflare가 자사 지표로 분석한 글입니다. ccTLD 수준의 DNSSEC 설정 오류가 어떤 영향을 냈는지와 복구 시점을 요약합니다."
date: 2026-11-14
weight: 31
---

# DNSSEC 오류로 오프라인이 된 피지 도메인 (2022-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [DNSSEC issues take Fiji domains offline](https://blog.cloudflare.com/dnssec-issues-fiji)
- 매체 · 게시일: The Cloudflare Blog · 2022-03-09
- 저자: David Belson
- 피지 ccTLD의 장애를 Cloudflare가 외부에서 관찰한 분석이며, Cloudflare 자사 장애는 아닙니다.
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 발생 상황 {#incident}

3월 8일 아침 Hacker News에 "모든 .fj 도메인이 오프라인이 되었다"는 글이 올라왔고, 접속이 안 되는 피지 최상위 도메인(ccTLD) 아래 호스트네임 몇 개가 나열되었습니다. 댓글에서는 접속에 성공한 사람과 실패한 사람이 엇갈렸습니다. 현지 뉴스 사이트 fijivillage도 문제를 다루면서 Vodafone의 M-PAiSA 서비스가 영향을 받아 사용자가 금융 거래를 마칠 수 없었다고 전했습니다.

## 영향 범위 {#impact}

Cloudflare 고객 zone 중 `.com.fj` 2단계 도메인으로 가는 HTTP 트래픽은 3월 8일 UTC 자정 무렵부터 거의 바로 약 40% 줄었고, 오전 내내 계속 감소했습니다. Cloudflare의 1.1.1.1 리졸버에서도 `.com.fj` 호스트네임에 대한 질의의 오류량이 자정 직후부터 크게 늘었습니다. 즉 리졸버가 .fj 서버의 응답에서 문제를 만났다는 뜻입니다. Cloudflare Radar에는 같은 시각 피지의 인터넷 장애 징후가 없었으므로, 연결 문제가 아니라 DNS 자체의 문제로 보았습니다.

## 원인 분석 {#cause}

Hacker News 댓글에서 DNSSEC 문제일 수 있다는 의견이 나왔고, 조사해 보니 그럴 가능성이 높았습니다. `.fj`의 DNSSEC 레코드를 `kdig`로 조회하자 SERVFAIL과 함께 `EDE: 9 (DNSKEY Missing): 'no SEP matching the DS found for fj.'`가 나왔습니다. Extended DNS Error 9는 부모에 DS 레코드가 있지만 자식에서 맞는 DNSKEY를 찾지 못했다는 의미입니다. DS 레코드는 부모 zone에 있는 자식 zone KSK의 해시이며, DNSSEC 리졸버는 자식의 KSK를 해시해 부모의 DS와 비교해 자식 zone을 검증합니다.

원문의 추정은 UTC 자정 무렵 .fj zone이 루트 zone의 DS에 없는 키로 서명되기 시작했다는 것입니다. 예정된 키 롤오버가, 루트 zone을 갱신하는 IANA 쪽의 업데이트를 확인하지 않은 채 진행된 결과일 수 있다고 합니다(IANA는 TLD 운영자와 소통하고 루트 zone 퍼블리셔에게 다음 버전의 변경을 지시합니다). 일부만 접속 실패한 현상도 이로 설명됩니다. 엄격하게 DNSSEC를 검증하는 리졸버 뒤의 사용자는 브라우저 오류를 보았고, 느슨한 리졸버 뒤의 사용자는 문제없이 접속했을 것입니다.

## 복구와 시사점 {#resolution}

Cloudflare 리졸버 지표를 더 분석하니 문제는 대략 14:00 UTC에 DS가 갱신되면서 해결되었습니다. 원문은 DNSSEC를 잘못 설정하면 단일 도메인에서도 접속 문제가 생기지만, ccTLD 수준에서 생기면 영향이 훨씬 크다고 지적하고, 이런 일이 너무 자주 일어난다고 덧붙입니다. DNSSEC 전문 지식을 제공한 Ólafur Guðmundsson에게 감사를 전합니다.

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
