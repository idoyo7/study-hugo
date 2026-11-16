---
title: ".al 장애 때 DNSSEC 검증 우회를 알린 1.1.1.1"
description: "DNSSEC 장애로 끊긴 .al 접속을 어떻게 복구하면서 검증 우회 사실도 알릴 수 있을까요? 1.1.1.1은 NTA로 이름 해석을 복구하고, 해당 응답에 EDE 33을 붙였습니다."
date: 2026-11-16
weight: 4
---

# .al 장애 때 DNSSEC 검증 우회를 알린 1.1.1.1 (2026-07)

{{< callout type="info" >}}
**원문 정보**
- 원문: [A broken DNSSEC rollover took down .al. Now 1.1.1.1 tells you when validation is bypassed](https://blog.cloudflare.com/dnssec-nta-ede-33)
- 매체 · 게시일: The Cloudflare Blog · 2026-07-14
- 저자: Sebastiaan Neuteboom
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 운영자 연락처까지 막힌 .al {#nta-recovery}

2026년 7월 3일, DNSSEC를 검증하는 리졸버를 쓰던 이용자들은 알바니아의 정부 서비스와 은행, 언론 사이트에 접속하지 못했습니다. 문제는 `.al`에 있었습니다. 국가 최상위 도메인(TLD) `.al`을 운영하는 알바니아 통신 당국 AKEP가 DNSSEC 키 교체를 시도하다 검증 실패를 일으켰습니다. 호스팅 위치나 권한 네임서버와 관계없이 모든 `.al` 도메인이 영향을 받을 수 있는 장애였습니다.

오류 반환은 명세에 따른 동작입니다. DNSSEC 검증에 실패한 서명을 받은 리졸버는 이를 거부해야 했고, Cloudflare의 공개 DNS 리졸버 1.1.1.1도 예외는 아니었습니다.

Cloudflare가 택한 대응은 약 두 달 전 `.de` 장애 글에서도 다뤘던 Negative Trust Anchor(NTA)였습니다. RFC 7646에 정의된 NTA는 리졸버가 특정 존을 서명되지 않은 것으로 취급하고 DNSSEC 검증을 건너뛰게 합니다. 적용에 앞서 Cloudflare는 `.al` 운영자에게 직접 연락하고 DNS-OARC Mattermost에도 장애를 알렸습니다. 답변은 없었습니다. 운영자의 연락처 주소 자체가 `.al`에 속해 장애 중 도달할 수 없었다는 점도 이유 중 하나였습니다.

신뢰 사슬이 끊어진 지 약 3시간 뒤인 17:15 UTC, 모든 1.1.1.1 이용자에게 NTA가 적용됐습니다. 원문의 그래프에는 복구 시점이 뚜렷이 드러납니다. 캐시된 레코드가 만료돼 리졸버가 다시 검증에 나서면서 올라가던 SERVFAIL 비율이 NTA 적용 직후 급격히 떨어졌습니다.

접속을 복구한 대가는 분명했습니다. NTA가 적용된 동안 `.al` 응답은 암호학적 검증을 거치지 않았으며, 도메인은 DNS 스푸핑을 막는 DNSSEC 보호를 받지 못했습니다. Cloudflare는 공개적으로 확인된 장애가 모든 검증 리졸버에 똑같이 영향을 주고 있다는 점에서 이 대응을 받아들일 만하다고 판단했습니다.

## 옛 키를 가리키던 루트의 DS {#broken-chain-of-trust}

이 장애를 이해하려면 `.al`이 제공하는 키뿐 아니라 루트에 남아 있던 기록을 함께 봐야 합니다. DNSSEC는 루트 존부터 개별 도메인까지 신뢰 사슬을 잇습니다. 루트의 Delegation Signer(DS) 레코드는 서명된 TLD의 DNSKEY 지문을 담고 있으며, 리졸버는 TLD 네임서버가 제공하는 키를 이 지문과 대조합니다. `.al`과 서명된 하위 존 사이에서도 같은 검증을 반복합니다. 사슬의 어느 한 곳이 끊기면 그 아래의 검증도 모두 실패합니다.

7월 3일 약 14:15 UTC, `.al` 운영자는 새 DNSKEY를 게시하면서 기존 키의 제공을 중단했습니다. 루트의 DS는 그대로였습니다. 여전히 기존 DNSKEY인 ID 26319를 가리키고 있었으므로, 리졸버는 DS에 맞는 키를 찾지 못해 검증에 실패했습니다.

약 17:00 UTC에는 새 DNSKEY마저 제거됐습니다. 기존 키는 복원하지 않았습니다. 이제 `.al`에는 DNSKEY가 하나도 없는데 루트의 DS는 계속 ID 26319를 가리키는 상태였습니다. 검증 실패는 이어졌습니다.

약 19:15 UTC, 운영자가 루트 존의 DS를 제거하자 이름 해석이 복구됐습니다. DS가 없으니 리졸버도 더는 `.al`에 DNSSEC 검증을 기대하지 않았습니다. TLD 전체가 서명되지 않은 상태가 된 것입니다. NTA도 필요 없어져 Cloudflare는 다음 날 이를 제거했습니다.

DNSSEC 보호까지 복구된 것은 아닙니다. 원문 게시 시점에도 루트의 DS는 복원되지 않았고, 모든 `.al` 도메인이 DNSSEC 보호를 사용할 수 없는 상태였습니다.

## NOERROR 응답에 붙은 EDE 33 {#in-response-disclosure}

NTA로 접속을 복구하는 동안 클라이언트에게는 보이지 않는 변화가 있었습니다. 응답만으로는 DNSSEC 검증을 건너뛰었다는 사실을 알 수 없었습니다. RFC 7646은 운영자에게 NTA 적용 사실을 공개하도록 권고하지만, 그 공개는 DNS 응답 바깥에서 이뤄집니다. Cloudflare도 `.de`와 `.al` 장애 때 상태 페이지를 게시했습니다. 이용자가 직접 찾아봐야 하는 정보였습니다.

이번에는 응답 자체에 표시를 넣었습니다. RFC 8914에 정의된 Extended DNS Error(EDE)는 오류 응답뿐 아니라 성공 응답에도 추가 정보를 담을 수 있습니다. Quad9의 Babak Farrokhi는 NTA 적용 사실을 알리는 새 EDE 코드를 Internet-Draft로 제안했고, Cloudflare는 공동 저자로 참여해 1.1.1.1에 구현했습니다. `.al` 장애는 1.1.1.1이 이 표시를 처음 사용한 사례입니다.

NTA 적용 중 `google.al`을 조회한 예시에서는 주소가 담긴 `NOERROR` 응답에 `EDE 9 (DNSKEY Missing)`와 `EDE 33 (Negative Trust Anchor)`가 함께 붙었습니다. EDE 9는 신뢰 사슬에서 DNSKEY가 누락돼 검증이 실패했다는 원인을 드러냅니다. EDE 33은 그 실패에도 NTA를 적용해 응답을 제공했다는 사실을 알립니다. 주소를 돌려받았어도 DNSSEC로 검증된 응답은 아닙니다.

EDE 33은 NTA가 적용된 존의 모든 응답에 붙습니다. DNSSEC를 아예 쓰지 않는 도메인도 예외가 없습니다. 해당 질의가 실제로 검증에 실패했을지와 관계없이, 존 전체에 NTA가 적용돼 있다는 사실을 응답마다 드러내려는 선택입니다.

앞선 `.de` 장애 글에서 지적한 오류 표시 문제도 고쳤습니다. 당시 1.1.1.1은 실제 DNSSEC 오류 대신 권한 서버에 도달하지 못했다는 `EDE 22 (No Reachable Authority)`를 잘못 반환했습니다. 이번 `.al` 장애에서는 DNSKEY 누락을 나타내는 EDE 9와 NTA 적용을 알리는 EDE 33을 함께 반환했습니다.

## IETF 논의를 앞둔 Internet-Draft {#implementation-and-standardization}

EDE 33은 IANA가 할당한 코드이며, Knot 프로젝트의 `kdig`도 이 코드를 이름으로 인식합니다. 원문 게시 시점에 Unbound 지원을 위한 pull request는 검토 중이었습니다. Cloudflare는 다른 리졸버 구현도 뒤따르기를 기대했습니다.

Internet-Draft는 개인 제출 문서입니다. IETF DNSOP Working Group에 제출됐으며, 2026년 7월 18일부터 24일까지 Vienna에서 열릴 IETF 회의의 DNSOP Working Group에서 논의될 예정이었습니다.

{{% details title="장애 시각과 오류 코드·표준화 상태" closed="true" %}}
| 항목 | 값 |
|---|---|
| `.al`의 Cloudflare Radar TLD 순위 | 원문 기준 191위 |
| 신뢰 사슬 단절 | 2026-07-03 약 14:15 UTC, 새 DNSKEY 게시 및 기존 키 제공 중단 |
| 루트 DS가 가리킨 기존 DNSKEY | ID 26319 |
| DNSKEY 전체 부재 | 같은 날 약 17:00 UTC, 새 키 제거 후 기존 키 미복원 |
| NTA 전체 배포 완료 | 같은 날 17:15 UTC, 신뢰 사슬 단절 약 3시간 뒤 |
| 루트 DS 제거 | 같은 날 약 19:15 UTC, DNSSEC 검증을 기대하지 않게 되면서 이름 해석 복구 |
| NTA 제거 | 다음 날, 루트 DS 제거 이후 |
| NTA 운영 지침 | RFC 7646 |
| EDE 정의 | RFC 8914 |
| `.al` 응답의 원인 표시 | EDE 9, DNSKEY Missing |
| NTA 적용 표시 | EDE 33, Negative Trust Anchor |
| 앞선 `.de` 장애의 잘못된 표시 | EDE 22, No Reachable Authority |
| 표준화·구현 상태 | IANA 코드 할당 완료, 개인 제출 Internet-Draft, `kdig` 이름 인식 지원, Unbound pull request 검토 중 |
| 예정된 논의 | 2026-07-18~2026-07-24 Vienna IETF 회의의 DNSOP Working Group |
{{% /details %}}
