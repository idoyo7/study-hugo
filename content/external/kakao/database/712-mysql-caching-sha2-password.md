---
title: "접속 방식까지 살펴야 할 MySQL caching_sha2_password"
description: "caching_sha2_password로 옮길 때 무엇을 준비해야 할까요? SSL/TLS 또는 RSA 연결 여부를 확인하고, 지원 커넥터 버전과 기존 계정의 전환 절차를 검토해야 합니다."
date: 2026-11-14
weight: 5
---

# 접속 방식까지 살펴야 할 MySQL caching_sha2_password (2025-07)

{{< callout type="info" >}}
**원문 정보**
- 원문: [MySQL 인증 플러그인 caching_sha2_password에 대한 이해](https://tech.kakao.com/posts/712)
- 매체 · 게시일: 카카오 기술블로그 · 2025-07-17
- 저자: 본문에 저자 미표기
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## mysql_native_password 지원이 끝나는 MySQL 9.0 {#background}

MySQL 9.0에서는 mysql_native_password를 계속 쓸 수 없습니다. 8.4까지 사용할 수 있던 이 인증 플러그인의 지원이 끝나기 때문입니다. 이를 대체하는 caching_sha2_password는 5.7.23에서 선택 가능한 플러그인으로 도입됐고, 8.0부터 기본값이 됐습니다.

전환 범위는 계정 설정보다 넓습니다. caching_sha2_password를 도입하면 비밀번호를 저장하고 검증하는 방식뿐 아니라 클라이언트가 서버에 접속하는 방식도 살펴야 합니다. 기존 연결이 SSL/TLS나 RSA 키 쌍을 사용하지 않는다면 연결 방식부터 바꿔야 하기 때문입니다.

## 전환 전에 정할 SSL/TLS와 RSA {#adoption}

이미 SSL/TLS나 RSA 공개키 방식으로 MySQL에 접속하고 있다면 연결 방식을 새로 고르는 문제는 없습니다. 그렇지 않은 환경에서는 어느 쪽을 사용할지 결정해야 합니다. 운영 중인 MySQL에 영향을 주는 변경인 만큼, 선택할 방식이 현재 구성에 어떤 영향을 주는지도 함께 확인해야 합니다.

SSL/TLS를 택한다면 확인 범위는 서버 설정에서 끝나지 않습니다. 클라이언트뿐 아니라 복제에 사용하는 계정과 연결 방법도 포함됩니다.

- 서버의 SSL/TLS 설정과 인증서 관리 방법
- 클라이언트의 SSL/TLS 연결 방법
- 복제용 계정과 연결 방법
- 그룹 복제를 사용할 때의 연결 방법

이 선택은 인증 과정에서 비밀번호를 어떻게 전달할지도 결정합니다. SSL/TLS에서는 암호화된 채널로 비밀번호 원문을 보내고, RSA 방식에서는 서버의 공개키로 비밀번호를 암호화해 전달합니다. 서버가 비밀번호를 검증한다는 점은 같지만, 전달 과정에서 사용하는 보호 방식이 다릅니다.

## 같은 비밀번호에서 달라지는 저장값 {#hash-basics}

mysql_native_password는 비밀번호를 SHA-1로 두 번 해싱합니다. 해시는 입력을 복원할 수 없는 단방향 함수입니다. `SHA1(SHA1(password))`의 결과를 40자리 16진수로 바꾸고 앞에 `*`를 붙인 41자 문자열이 `mysql.user`의 `authentication_string`에 저장됩니다.

접속할 때는 비밀번호 원문 대신 토큰을 보냅니다. 서버가 20바이트 임의 문자열인 scramble을 전달하면, 클라이언트는 `SHA1(password)`와 `SHA1(scramble + SHA1(SHA1(password)))`를 XOR한 토큰을 돌려줍니다. 서버는 저장된 이중 해시와 scramble로 계산한 값에 토큰을 XOR해 `SHA1(password)`를 유추하고, 이를 다시 해싱해 저장값과 비교합니다.

SHA-1은 보안 취약점으로 사용이 권장되지 않습니다. caching_sha2_password는 SHA-2 계열인 SHA-256을 기반으로 하며, 비밀번호마다 솔트라는 임의 바이트열을 더합니다. 원문의 계정 생성 예시에서도 차이가 드러납니다. 같은 비밀번호로 만든 mysql_native_password 계정 둘은 저장값이 같았지만, caching_sha2_password 계정 둘은 서로 달랐습니다.

솔트가 만드는 차이입니다. MySQL은 비밀번호를 만들거나 바꿀 때마다 고유하고 예측 불가능한 20바이트 솔트를 생성합니다. 솔트 자체는 비밀 정보가 아니며 해시값과 함께 저장됩니다. 같은 비밀번호라도 서로 다른 해시가 만들어지므로, 미리 계산한 해시 목록을 이용하는 레인보우 테이블 공격이 어려워집니다. 사전·무차별 대입 공격에서도 추측한 비밀번호를 솔트마다 따로 해싱해야 하므로 공격자의 계산량이 늘어납니다.

계산을 반복하는 과정도 있습니다. 솔트와 평문 비밀번호를 섞어 HMAC-SHA256 같은 의사 난수 함수에 넣고, `caching_sha2_password_digest_rounds`에 설정된 횟수만큼 반복합니다. 기본값은 5000입니다. 이렇게 반복 해싱으로 비밀번호의 보안 강도를 높이는 기법이 키 스트레칭입니다.

저장 문자열은 `$A$005$<솔트><해시>` 형태입니다. `$`로 구분한 앞부분에서 `A`는 caching_sha2_password를, `005`는 5000번 반복을 뜻합니다. 그 뒤에는 사용한 솔트와 최종 해시값이 들어갑니다.

## 반복 해싱을 줄여 주는 인증 캐시 {#caching-sha2-auth}

비밀번호를 검증할 때마다 반복 계산을 해야 한다면 성능 부담이 생깁니다. caching_sha2_password는 sha256_password와 기본 동작이 비슷하지만, 재인증에 쓸 정보를 자체 캐시에 보관한다는 차이가 있습니다. 캐시가 없을 때는 완전한 인증인 Full Authentication을 거치고, 유효한 캐시가 있으면 빠른 인증인 Fast Authentication을 사용합니다.

처음 접속하는 클라이언트는 사용자 이름과 지원 기능 등 초기 정보부터 보냅니다. 이때는 비밀번호 원문을 전송하지 않습니다. 서버가 계정의 인증 플러그인이 caching_sha2_password임을 확인해 알리면, 클라이언트는 선택한 연결 방식에 따라 비밀번호를 전달합니다.

SSL/TLS 연결에서는 서버가 암호화된 채널로 전달받은 평문 비밀번호를 검증합니다. RSA 방식이라면 서버의 개인키로 암호화된 비밀번호를 복호화하는 과정이 먼저입니다. 이후에는 계정에 저장된 솔트와 반복 횟수를 사용해 해시를 계산하고, `authentication_string`에 저장된 해시값과 비교해 인증 성공 여부를 결정합니다.

Full Authentication에 성공하면 서버 메모리에 빠른 재인증용 정보가 캐시됩니다. 이후 재접속에서 이 정보가 유효하면 Fast Authentication을 사용할 수 있습니다. 서버가 임의 문자열인 Nonce를 보내고, 클라이언트가 Nonce와 비밀번호로 계산한 값을 돌려주면 서버가 이를 검증합니다. 캐시에 인증 정보가 없거나 유효하지 않으면 다시 완전한 인증을 진행합니다.

캐시는 영구히 남지 않습니다. MySQL 메인 프로세스의 Heap에서 플러그인이 사용하는 영역에 저장되며, 다음 작업으로 삭제됩니다.

- MySQL 재시작
- `FLUSH PRIVILEGES` 실행
- 계정 정보 변경

한 번 접속에 성공한 계정이라도 이 작업 뒤에는 캐시가 없는 상태에서 인증을 시작합니다. 빠른 인증의 전제는 과거의 접속 성공만이 아니라, 서버 메모리에 유효한 재인증 정보가 남아 있다는 것입니다.

## 업그레이드와 함께 검토할 기존 계정 {#native-on-80}

MySQL 8.0에서는 추가 설정 없이 caching_sha2_password를 사용할 수 있습니다. 기존 mysql_native_password도 기동 옵션이나 `my.cnf`의 `mysql_native_password=ON`, 또는 `default_authentication_plugin=mysql_native_password` 설정으로 사용할 수 있습니다. 기본 플러그인이 바뀐 뒤에도 기존 방식을 유지해 온 환경이라면 계정 전환 방안을 따로 준비해야 합니다.

연결 방식이 준비됐다면 남은 검토 대상은 커넥터와 계정입니다. 사용 중인 커넥터 버전이 caching_sha2_password를 지원하는지 확인하고, 기존 mysql_native_password 계정을 어떻게 전환할지 정해야 합니다. 메이저 업그레이드와 함께 진행하려는 경우에는 업그레이드 과정에 계정 전환을 어떤 절차로 포함할지도 검토해야 합니다.

전환 시나리오는 서비스 구성과 민감도에 따라 달라집니다. 원문은 연결 방식 변경에 따른 세부 영향과 서비스별 계정 전환 절차까지 다루지는 않습니다. 자신이 운영하는 시스템의 연결 방식과 계정 사용 현황에 맞춰 구체화해야 하는 부분입니다.

{{% details title="버전별 인증 플러그인 지원 현황" closed="true" %}}

| MySQL 버전 | 기본 | 적용 가능한 플러그인 |
|---|---|---|
| 4.1 ~ 5.5 | mysql_native_password | mysql_native_password, mysql_old_password (5.6부터 Deprecated) |
| 5.6 ~ 5.7 | mysql_native_password | caching_sha2_password (5.7.23 도입), sha256_password (5.6 도입), mysql_native_password, mysql_old_password (5.7에서 제거) |
| 8.0 ~ | caching_sha2_password | caching_sha2_password, sha256_password (8.0.15부터 Deprecated), mysql_native_password (8.4부터 Deprecated, 9.0에서 제거) |

{{% /details %}}
