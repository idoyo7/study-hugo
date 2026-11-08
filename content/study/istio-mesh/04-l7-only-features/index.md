---
title: "04 요청을 읽는 갈림길 — L7 프록시가 여는 기능"
description: "요청 단위 분산, 카나리, 재시도, 경로별 인가를 네 그림으로 살펴본다. 대기 한도와 중복 실행 비용, waypoint가 필요한 범위를 짚는다."
date: 2026-11-07
lastmod: 2026-11-08
inlineToc: false
weight: 4
url: "/study/istio-mesh/04-l7-only-features/"
aliases:
  - "/istio/mesh-traffic/04-l7-only-features/"
---

# 04 · 요청을 읽는 갈림길 — L7 프록시가 여는 기능

HTTP를 읽는 사이드카는 연결 하나 안의 요청을 각각 다른 파드로 보낼 수 있습니다. 재시도·트래픽 분할·경로별 인가도 이 요청 경계에서 시작합니다.

{{< flow src="_flow/2-연결-하나-요청-여럿.json" />}}

## 연결 하나에서도 요청마다 다른 파드 {#연결-하나에-묶였던-요청을-다시-나누기}

앱이 연 연결과 프록시의 대상별 연결 풀은 별개입니다. 앞쪽 HTTP/2 연결이 하나여도 뒤에서는 요청마다 EDS 엔드포인트를 고릅니다. 기본 least request는 연결 수가 아니라 활성 요청 수를 비교합니다.

TCP로만 처리하는 연결은 처음 고른 대상에 묶입니다. HTTP로 인식하는 조건과 연결 구조는 [03편]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}})에서 봤습니다.

## 헤더와 가중치로 나누는 요청 {#어떤-요청을-어느-버전으로-보낼-것인가}

VirtualService의 HTTP 규칙은 위에서부터 평가하며, 처음 맞는 규칙을 적용합니다.

{{< flow src="_flow/2-헤더-우선-카나리-분할.json" />}}

이 예시의 `x-canary: true` 요청은 v2로 고정하고, 나머지는 v1:v2를 90:10 가중치로 나눕니다. 가중치는 장기적인 선택 비율이며 요청 열 개 중 하나를 보장하는 약속은 아닙니다. subset과 파드 라벨의 대응은 DestinationRule에 둡니다.

TCP 가중치는 **연결 수**에 적용됩니다. 오래 열린 연결 몇 개라면 요청 비율은 가중치와 크게 달라질 수 있습니다. 미러링은 요청 복사본을 따로 보내고 응답을 버립니다. 응답을 기다리지는 않지만 복제 트래픽과 대상의 처리 비용은 늘어납니다.

## 실패한 요청의 재시도와 전체 대기 한도 {#실패한-요청은-다시-보내고-대기-시간은-제한한다}

재시도는 조건에 맞는 실패에만 적용합니다. 아래는 다른 파드로 재시도가 성공하는 예입니다.

{{< seq src="_seq/3-다른-파드로-재시도.json" />}}

기본 HTTP 재시도는 최대 두 번이며, 연결 실패·스트림 거부·일부 gRPC 상태가 대상입니다. 앱의 모든 500·503 응답을 자동으로 재시도하는 정책은 아닙니다. 전체 요청의 타임아웃은 기본으로 꺼져 있으므로, 필요한 경로에 명시합니다.

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: orders
spec:
  hosts: [orders]
  http:
  - route:
    - destination: {host: orders}
    timeout: 3s
    retries:
      attempts: 2
      perTryTimeout: 1s
      retryOn: connect-failure,refused-stream,503
```

`attempts: 2`는 최초 시도 뒤 최대 두 번을 더 보낸다는 뜻입니다. 각 시도는 최대 1초, 전체는 백오프를 포함해 3초로 제한합니다. 결제처럼 중복 실행이 위험한 요청은 멱등성을 확보하거나 `attempts: 0`으로 끕니다. 앱과 메시가 함께 재시도하면 호출 수가 곱해지므로 정책을 맞춰야 합니다.

## 요청 한도와 불량 파드 제외 {#연결-수로-보이지-않는-부하와-오류}

DestinationRule의 두 설정은 백엔드를 보호하는 방식이 다릅니다.

| 설정 | 조절하는 대상 | 한도·조건을 넘으면 |
|---|---|---|
| `connectionPool` | 연결 수·대기 요청·활성 요청 | 새 요청을 제한, overflow는 로그의 `UO`로 확인 |
| `outlierDetection` | 실제 오류를 내는 엔드포인트 | 해당 파드를 후보에서 일시 제외 |

HTTP/2 연결 하나에도 요청 수백 개가 들어갑니다. 연결 한도만 두면 이 부하를 구분하지 못합니다. 반대로 TCP 연결이 정상이어도 앱이 계속 500을 보내는 파드는 HTTP 오류를 기준으로 제외해야 합니다. TCP outlier detection은 HTTP 응답을 읽지 못하고 연결 실패·타임아웃을 봅니다.

<span id="fault로-재시도를-시험할-때는-홉을-나눈다"></span>

fault injection으로 재시도를 시험할 때는 **서로 다른 홉**에 둡니다. 같은 HTTP route에 fault를 켜면 그 route의 retry·timeout은 활성화되지 않습니다. 세부 필드와 동작은 [재시도와 복원력]({{< relref "/platform/istio/cilium/04-retry-resilience/index.md" >}})에서 확인합니다.

## 같은 호출자도 경로와 메서드로 나누는 인가 {#호출자-신원에서-경로와-메서드까지}

mTLS로 확인한 서비스 어카운트에 HTTP 메서드와 경로 조건을 더하면, 같은 호출자의 요청도 다르게 처리합니다.

{{< flow src="_flow/5-신원과-요청-조건의-인가.json" />}}

그림은 해당 서비스 계정에 `GET /orders/*`만 ALLOW한 예입니다. 신원·IP·포트 조건은 L4에서도 쓸 수 있지만, 메서드·경로·헤더와 JWT 클레임에는 HTTP 해석이 필요합니다. JWT 조건을 쓴다면 RequestAuthentication으로 먼저 검증하며, 토큰을 필수로 요구하는 인가 조건도 별도로 둡니다.

HTTP 속성이 든 DENY를 TCP에 적용하면 없는 속성을 일치로 취급해 해당 포트 전체가 막힐 수 있습니다. 정책 범위를 포트와 워크로드로 좁혀야 합니다.

## ambient에서 L7을 맡는 waypoint {#ztunnel만-있는-경로에는-무엇이-남는가}

ztunnel만 쓰는 경로에는 mTLS·워크로드 신원·L4 인가가 남습니다. 요청 단위 분산, 재시도, HTTP 라우팅과 L7 인가는 waypoint에서 처리합니다.

L7 인가 정책은 `targetRefs`로 서비스 등에 연결하고 트래픽이 실제 waypoint를 지나는지 확인합니다. ztunnel에 HTTP 조건을 둔 정책을 붙이면 의도대로 집행되지 않고 트래픽이 차단될 수 있습니다. 우회 경로의 접근도 제한하려면 ztunnel의 L4 정책을 함께 설계합니다.

[이전: 03 사이드카와 사이드카 사이]({{< relref "/study/istio-mesh/03-proxy-to-proxy/index.md" >}}) · [다음: 05 메트릭·로그·트레이스]({{< relref "/study/istio-mesh/05-logs-and-tracing/index.md" >}})

## 근거와 더 보기

기준: 사이드카 모드, Istio 1.31.4.

- [Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/) — 요청 분산과 기본 동작
- [VirtualService](https://istio.io/latest/docs/reference/config/networking/virtual-service/) — HTTP 매칭·가중치·재시도·fault
- [DestinationRule](https://istio.io/latest/docs/reference/config/networking/destination-rule/) — 연결 풀·outlier detection
- [AuthorizationPolicy](https://istio.io/latest/docs/reference/config/security/authorization-policy/) — ALLOW·DENY와 HTTP 조건
- [Ambient L7 기능](https://istio.io/latest/docs/ambient/usage/l7-features/) — waypoint 경유와 정책 연결
