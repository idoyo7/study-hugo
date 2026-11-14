---
title: "MySQL 인증 플러그인 caching_sha2_password의 동작과 도입 준비"
description: "mysql_native_password를 대체하는 caching_sha2_password의 해시 저장 방식과 인증 절차를 정리한 글입니다. 도입할 때 정해야 할 연결 방식과 계정 전환 문제를 짚습니다."
date: 2026-11-14
weight: 5
---

# MySQL 인증 플러그인 caching_sha2_password의 동작과 도입 준비 (2025-07)

{{< callout type="info" >}}
**원문 정보**
- 원문: [MySQL 인증 플러그인 caching_sha2_password에 대한 이해](https://tech.kakao.com/posts/712)
- 매체 · 게시일: 카카오 기술블로그 · 2025-07-17
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 글의 배경 {#background}

caching_sha2_password는 MySQL 5.7.23에서 도입된 SHA-256 기반 인증 플러그인입니다. 처음엔 원하는 사람만 골라 쓰는 선택지였지만, 8.0 이후 기본 인증 플러그인이 되었고 9.0부터는 mysql_native_password가 지원되지 않습니다. 원문은 mysql_native_password를 쓰는 환경이라면 전환이 불가피하고, 운영에 어떤 영향이 있을지 미리 따져야 한다는 문제의식에서 출발합니다. 전환에 필요한 사전 지식과 반영할 내용을 정리한 글입니다.

## 해시 알고리즘 기초 {#hash-basics}

해시는 단방향이라 빠르지만 복호화할 수 없습니다. MD5는 128비트 해시를 만들지만 충돌 공격에 약해 이제 잘 쓰이지 않습니다. SHA는 NIST가 낸 해시 함수군으로, SHA-1은 사용이 권장되지 않고 지금은 SHA-2와 SHA-3을 권장합니다. 원문은 SHA-2 쪽의 SHA-256, SHA-512가 가장 많이 쓰이며 MySQL은 SHA-256 기반 플러그인을 제공한다고 설명합니다.

## 인증 플러그인의 변천 {#plugin-history}

MySQL은 버전에 따라 서로 다른 플러그인을 기본값으로 삼았습니다.

- mysql_old_password는 자체 해시 알고리즘을 쓰는 단순한 방식이고, 16자리 16진수(8바이트) 해시를 만듭니다.
- mysql_native_password는 비밀번호를 SHA-1로 두 번 해싱하고, 40자리 16진수 앞에 `*`를 붙여 41자로 `mysql.user`의 `authentication_string`에 저장합니다. 5.6~5.7의 기본이었고, 8.0부터는 기본이 아니지만 설정으로 쓸 수 있습니다.
- sha256_password는 SHA-256에 솔트(Salt)를 더해 같은 비밀번호도 다른 해시가 되게 합니다. 연결은 SSL/TLS나 RSA로만 가능합니다.
- caching_sha2_password는 sha256_password와 동작이 비슷하지만 자체 캐시가 있습니다. sha256_password의 성능 문제를 개선하려고 캐시를 넣은 것으로 볼 수 있다고 합니다. 연결 조건은 같아서 SSL/TLS나 RSA 키 쌍이 필요합니다.

솔트는 비밀번호마다 따로 만든 임의 바이트열(MySQL은 20바이트)로, 같은 비밀번호도 다른 해시로 만들고 레인보우 테이블 공격과 사전·무차별 대입 공격의 효율을 떨어뜨립니다.

기본 플러그인은 버전별로 이렇게 바뀌었습니다.

| MySQL 버전 | 기본 알고리즘 |
|---|---|
| 1.0 ~ 4.0 | mysql_old_password |
| 4.1 ~ 5.7 | mysql_native_password |
| 8.0 ~ | caching_sha2_password |

## mysql_native_password를 8.0에서 쓰려면 {#native-on-80}

8.0에서 mysql_native_password를 쓰려면 기동 옵션이나 `my.cnf`에서 `mysql_native_password=ON`을 주거나, `default_authentication_plugin=mysql_native_password`를 설정해야 합니다. 인증 절차는 챌린지-응답 방식입니다. 서버가 20바이트 임의 문자열(scramble)을 보내면, 클라이언트는 `SHA1(password)`와 `SHA1(scramble + SHA1(SHA1(password)))`를 XOR한 토큰을 돌려줍니다. 서버는 저장된 이중 해시로 같은 계산을 거꾸로 해 `SHA1(password)`를 유추하고, 이를 다시 해싱해 저장값과 맞는지 비교합니다.

## caching_sha2_password의 저장과 인증 {#caching-sha2-auth}

8.0에서는 추가 설정 없이 쓸 수 있습니다. 비밀번호를 만들거나 바꿀 때마다 고유한 솔트를 생성하고, 솔트와 평문을 섞어 HMAC-SHA256 같은 의사 난수 함수에 넣는 과정을 `caching_sha2_password_digest_rounds`만큼 반복합니다(기본 5000). 이 반복이 키 스트레칭입니다. 저장 문자열은 `$`로 나뉘며 `$A$005$<솔트><해시>` 꼴입니다. `A`는 caching_sha2_password를, `005`는 5000번 반복을 뜻합니다.

인증은 두 갈래입니다.

- Full Authentication은 처음 접속하거나 서버 캐시에 인증 정보가 없을 때 쓰입니다. 클라이언트는 비밀번호 원문 없이 초기 정보만 보내고, 서버가 플러그인을 확인해 알립니다. SSL/TLS 연결이면 암호화된 채널로 평문 비밀번호를 보내고, RSA 연결이면 서버의 공개키로 암호화해 보냅니다. 서버는 저장된 솔트와 반복 횟수로 해시를 계산해 `authentication_string`과 비교합니다.
- Fast Authentication은 이전에 Full Authentication에 성공해 서버 메모리에 재인증 정보가 캐시된 경우에 씁니다. 서버가 Nonce를 보내면 클라이언트가 Nonce와 비밀번호로 암호화한 값을 돌려주고, 서버가 이를 검증합니다.

캐시는 MySQL 메인 프로세스 Heap에 있고, MySQL 재시작, `FLUSH PRIVILEGES`, 계정 정보 변경 때 삭제됩니다.

## 도입할 때 정해야 할 것 {#adoption}

원문은 고려할 사항을 둘로 나눕니다.

첫째는 연결 방식으로, SSL/TLS와 RSA 공개키 방식 중 하나를 골라야 합니다. 이미 둘 중 하나를 쓰고 있다면 고민할 것이 없지만, 아니라면 운영 중인 MySQL에 영향이 가므로 환경에 맞는 쪽을 고르고 영향도를 정확히 파악해야 합니다. SSL/TLS를 택하면 서버 설정과 인증서 관리, 클라이언트 연결 방법, 복제 계정과 그룹 복제 연결 방법을 확인해야 합니다. 원문은 연결 방식 변경의 영향은 이 글 주제에서 벗어난다며 자세히 다루지 않습니다.

둘째는 인증 방식 변경의 영향입니다. caching_sha2_password를 지원하는 커넥터 버전과 기존 mysql_native_password 계정의 처리 방안을 정리해야 합니다. 메이저 업그레이드와 함께 한다면 전환 절차도 고민해야 하며, 시나리오는 서비스 구성과 민감도에 따라 달라 원문은 상세히 다루지 않습니다.

## 맺음 {#wrap-up}

원문은 8.4까지는 mysql_native_password를 쓸 수 있어 당장 큰 문제가 없지만, 9.0부터는 caching_sha2_password를 쓸 수밖에 없다고 정리합니다. 서버와 클라이언트의 연결 방식까지 바뀌어야 하므로 전환에 어려움이 예상되고, 미리 준비하는 것이 필요할 것으로 보인다고 맺습니다.

{{% details title="버전별 인증 플러그인 지원 현황" closed="true" %}}

| MySQL 버전 | 기본 | 적용 가능한 플러그인 |
|---|---|---|
| 4.1 ~ 5.5 | mysql_native_password | mysql_native_password, mysql_old_password (5.6부터 Deprecated) |
| 5.6 ~ 5.7 | mysql_native_password | caching_sha2_password (5.7.23 도입), sha256_password (5.6 도입), mysql_native_password, mysql_old_password (5.7에서 제거) |
| 8.0 ~ | caching_sha2_password | caching_sha2_password, sha256_password (8.0.15부터 Deprecated), mysql_native_password (8.4부터 Deprecated, 9.0에서 제거) |

{{% /details %}}
