---
title: "백엔드와 HTTP 요청의 끝을 다르게 읽은 Pingora"
description: "Pingora 프록시에서 요청이 보안 검사를 건너뛸 수 있었던 원인은 백엔드와 다른 요청 경계 해석이었습니다. Pingora 0.8.0은 Upgrade 전환과 본문 길이 처리를 고치고, 캐시 오염을 일으킬 수 있는 기본 CacheKey를 제거했습니다."
date: 2026-11-16
weight: 11
---

# 백엔드와 HTTP 요청의 끝을 다르게 읽은 Pingora (2026-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Fixing request smuggling vulnerabilities in Pingora OSS deployments](https://blog.cloudflare.com/pingora-oss-smuggling-vulnerabilities)
- 매체 · 게시일: The Cloudflare Blog · 2026-03-09
- 저자: Edward Wang, Fei Deng, Andrew Hauck
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 인터넷에 직접 노출된 Pingora 프록시 {#scope-and-discovery}

Pingora가 HTTP 요청으로 읽은 것은 `GET /` 하나뿐이어도, 그 뒤에 붙은 `GET /admin`이 백엔드까지 전달될 수 있었습니다. 프록시와 백엔드가 요청의 끝을 다르게 판단하면서 두 번째 요청이 첫 요청의 일부처럼 검사를 빠져나간 것입니다. 이번 HTTP/1.x 요청 스머글링의 출발점입니다.

Cloudflare는 2025년 12월부터 관련 제보를 받았습니다. Bug Bounty Program에 참여한 Rajat Raghav(xclow3n)는 기본 Pingora reverse proxy와 Node/Express, uvicorn 같은 백엔드 사이에서 요청 길이 해석이 어긋나는 재현 사례를 제시했습니다. 제보자는 이후 수정 검증에도 참여했습니다.

Pingora가 일부 비표준 HTTP 요청과 응답을 허용한 데는 이유가 있습니다. 오래된 HTTP 스택을 사용하는 고객의 트래픽도 받아들여야 했습니다. 그러나 이번에 드러난 요청 본문 해석은 프록시 검사를 우회하고, 공유 백엔드와 요청·응답 순서를 어긋나게 만들 수 있었습니다. 다른 사용자의 세션이나 자격 증명을 탈취하는 공격으로도 이어질 수 있는 문제였습니다.

영향 대상은 Pingora를 ingress proxy로 쓰는, 인터넷에 노출된 독립 배포였습니다. Cloudflare는 수정과 보안 강화를 담은 Pingora 0.8.0을 배포하고 프록시 사용자에게 신속한 업그레이드를 권고했습니다. Cloudflare CDN과 고객 트래픽에서는 영향이 발견되지 않았으며, Cloudflare 고객이 취할 조치는 없었습니다.

## 101 응답보다 앞선 Upgrade 전환 {#premature-upgrade-passthrough}

백엔드의 전환 승인은 아직 오지 않았습니다. 그런데 Pingora는 요청에 `Upgrade: foo` 같은 헤더가 있으면 첫 요청만 HTTP로 파싱하고, 버퍼에 남은 바이트를 이미 프로토콜이 전환된 스트림처럼 백엔드로 넘겼습니다. 응답을 받기도 전에 후속 데이터의 해석부터 바꾼 것입니다.

공격자는 이 동작을 이용해 Upgrade 요청 뒤에 불완전한 HTTP 요청을 붙일 수 있었습니다. 예를 들어 `GET /admin`으로 시작하는 요청을 보내면, Pingora는 이를 별도 요청으로 검사하지 않고 그대로 전달했습니다. 백엔드가 `200 OK`로 응답해 전환을 거절하더라도, 후속 요청은 이미 Pingora에 정의된 ACL이나 WAF 로직을 건너뛸 수 있었습니다.

문제는 그 연결에 남습니다. 백엔드는 전달받은 불완전한 요청 헤더가 끝나기를 기다리고, Pingora가 다른 사용자의 요청을 보내면 이를 앞선 헤더에 이어 붙여 해석할 수 있습니다. 그 결과 다른 사용자에게 공격자가 유도한 `/admin` 응답이 돌아갈 수 있었습니다.

수정된 Pingora는 백엔드의 `101 Switching Protocols` 응답을 받은 뒤에만 후속 바이트를 전환된 스트림으로 해석합니다. `200 OK`가 돌아오면 계속 HTTP로 읽습니다. RFC 9110의 Upgrade 절차가 요구하는 구분입니다.

## 연결이 닫힐 때까지 이어진 HTTP/1.0 본문 {#http10-transfer-encoding-framing}

또 다른 재현 사례는 전형적인 CL.TE 공격처럼 보였습니다. Pingora는 `Content-Length`를, 백엔드는 `Transfer-Encoding`을 기준으로 본문 길이를 판단하는 공격입니다. 하지만 실제 Pingora는 `Content-Length`를 쓰지 않았습니다. RFC의 우선순위에 따라 `Transfer-Encoding`이 이를 덮어쓴 상태였습니다.

문제는 그다음 해석이었습니다. Pingora는 인코딩과 `Transfer-Encoding` 헤더가 하나씩만 온다고 가정하고, 값이 `chunked`인지 확인하는 수준으로 본문 형식을 판별했습니다. 그래서 `Transfer-Encoding: identity, chunked`를 chunked 본문으로 인식하지 못했습니다. HTTP/1.1에서는 마지막 인코딩이 `chunked`이면 chunked 규칙으로 본문 경계를 읽어야 합니다.

여기에 HTTP/1.0 처리 오류가 겹쳤습니다. Pingora는 인식하지 못한 `Transfer-Encoding`이 HTTP/1.0 요청에 들어오자, 연결이 닫힐 때까지 뒤따르는 바이트를 모두 같은 본문으로 취급했습니다. node.js 백엔드는 chunked 규칙을 적용해 길이가 0인 청크에서 본문을 끝냈습니다. 그 뒤에 붙은 불완전한 `GET /admin` 헤더는 Pingora에는 본문의 일부였지만, 백엔드에는 다음 요청의 시작이었습니다. Upgrade 사례와 같은 요청·응답 불일치를 만들 수 있는 조건입니다.

연결 종료로 본문의 끝을 구분하는 방식은 응답에만 허용됩니다. 요청 본문에는 쓸 수 없으며, RFC 9112도 이를 별도 주석으로 명시합니다. Pingora는 프레이밍 헤더가 없는 HTTP/1.0 요청에서도 같은 오류를 일으킬 수 있었습니다. 또한 HTTP/1.0에는 `Transfer-Encoding` 자체가 정의돼 있지 않습니다. RFC는 이 헤더가 포함된 HTTP/1.0 요청을 잘못된 프레이밍으로 취급하고 연결을 닫도록 요구합니다.

Pingora는 여러 `Transfer-Encoding`을 파싱하는 코드를 고치고, 요청 본문을 연결 종료 기준으로 읽지 않도록 수정했습니다. 잘못된 `Content-Length`와 HTTP/1.0에 `Transfer-Encoding`이 포함된 요청도 거부합니다.

CONNECT 요청도 기본 거부 대상에 포함됐습니다. CONNECT에는 별도의 메시지 프레이밍 규칙이 있지만, 현재 Pingora의 HTTP 프록시 로직은 CONNECT 업그레이드 프록시에 필요한 특별한 처리를 구현하지 않았기 때문입니다.

## Pingora 앞에서 요청을 걸러낸 Cloudflare CDN {#validation-and-follow-up}

같은 프레임워크를 쓰는 Cloudflare CDN에서 이 공격이 성립하지 않은 이유는 Pingora의 위치와 입력 트래픽에 있었습니다. CDN은 Pingora를 ingress proxy로 사용하지 않습니다. 내부 서비스를 계측한 조사에서도 이번 오류를 일으킬 요청이 Pingora에 도착한 사례는 발견되지 않았습니다.

CDN의 앞단 프록시 계층은 요청을 HTTP/1.1로만 전달했습니다. 잘못된 `Content-Length`처럼 본문 경계가 모호한 요청은 거부하고, chunked 요청에는 단일 `Transfer-Encoding: chunked` 헤더만 넘겼습니다. 수신 CONNECT 요청도 CDN에서 거부했습니다.

Upgrade에도 별도의 보호가 있었습니다. ingress CDN 프록시에는 승인 전에 스트림을 전환하는 동작이 없었고, 내부 Pingora 서비스의 클라이언트는 HTTP/1 요청을 파이프라이닝하지 않았습니다. 이 클라이언트가 직접 연결하는 Pingora 서비스는 Upgrade 요청에 `Connection: close`를 삽입해 keep-alive를 끕니다. 같은 연결에 추가 요청을 실어 보내는 경로도 막혀 있었습니다.

Cloudflare는 프레임워크 사용자 대부분이 자사와 같은 ‘거친 인터넷’을 감당하지는 않아도 된다고 봅니다. 이에 기본 동작이 최신 RFC를 더 엄격하게 따르도록 하는 작업을 계속하겠다고 밝혔습니다. Cloudflare 내부에서 공격을 막아 준 조건과 별개로, 독립 Pingora 배포의 기본 보안을 강화하려는 방향입니다.

## 같은 경로에서 충돌한 기본 CacheKey {#default-cache-key-collisions}

요청 파싱과 별개로 캐시에도 문제가 있었습니다. alpha 단계의 프록시 캐싱 기능에서 기본 `CacheKey` 구현을 선택한 사용자가 영향 대상입니다. 이 구현은 URI 경로만 반영했으므로, 서로 다른 호스트가 같은 경로를 쓰면 하나의 캐시 키로 충돌하고 서로의 캐시를 오염시킬 수 있었습니다. Host 헤더와 업스트림 HTTP scheme은 키에 들어가지 않았습니다.

Cloudflare 내부의 캐시 키는 여러 요소를 반영하며, 이 기본 구현을 사용한 적이 없었습니다. Pingora는 문제가 된 기본 구현을 제거했습니다. 사용자가 자신의 애플리케이션 동작을 따져 캐시 키를 구성하도록 한 선택입니다.

HTTP scheme + host + URI는 많은 애플리케이션에 맞는 조합입니다. 그렇다고 모든 프록시에 충분한 기준은 아닙니다. 예를 들어 업스트림 요청의 URI나 method를 조건에 따라 바꾸는 로직이 있다면, 캐시 오염을 피하려면 그 동작도 캐시 키에 반영해야 할 가능성이 높습니다.

{{% details title="취약점 식별자·프로토콜 조건·대응 일정" closed="true" %}}
| 항목 | 값 |
|---|---|
| 취약점 식별자 | CVE-2026-2833, CVE-2026-2835, CVE-2026-2836 |
| 수정 버전·배포일 | Pingora 0.8.0 · 2026-03-02 |
| Upgrade 전환 조건 | 업스트림의 `101 Switching Protocols` 수신 후 전환. `200 OK`이면 후속 바이트를 HTTP로 계속 해석 |
| 내부 Upgrade 요청 보호 | `Connection: close`를 삽입해 keep-alive 비활성화 |
| Transfer-Encoding 재현 조건 | HTTP/1.0, `Connection: keep-alive`, `Transfer-Encoding: identity, chunked`, `Content-Length: 29` |
| 기본 CONNECT 처리 | 특별한 프레이밍 처리가 구현돼 있지 않아 기본 거부. Cloudflare CDN도 수신 CONNECT 요청 거부 |
| Upgrade 취약점 제보 | 2025-12-02 |
| Transfer-Encoding·HTTP/1.0 문제 제보 | 2026-01-13 |
| 기본 캐시 키 문제 제보 | 2026-01-18 |
| 제보자와 수정 검증 | 2026-01-29~2026-02-13 |
| 캐시 키 기본값 제거·추가 RFC 검사 검증 | 2026-02-25 |
| CVE 권고문 공개 | 2026-03-04 |
{{% /details %}}
