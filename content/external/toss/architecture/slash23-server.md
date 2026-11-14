---
title: "토스의 수많은 서비스가 거치는 Spring Cloud Gateway"
description: "토스는 수많은 서비스의 공통 로직과 장애 전파를 어디에서 다룰까요? Spring Cloud Gateway와 Istio로 요청 처리를 모으고, Gateway와 각 애플리케이션에서 서킷 브레이킹을 적용합니다."
date: 2026-11-14
weight: 1
---

# 토스의 수많은 서비스가 거치는 Spring Cloud Gateway (2023-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [토스는 Gateway 이렇게 씁니다](https://toss.tech/article/slash23-server)
- 매체 · 게시일: 토스 기술 블로그 · 2023-10-12
- 저자: 최준우 (서버플랫폼팀)
- 시리즈: SLASH23 발표를 글로 옮긴 서버 세션
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 반복된 유저 정보 조회를 줄인 Passport {#common-logic}

토스의 내부 서비스들은 유저 정보가 필요할 때마다 유저 API를 호출했습니다. 한 트랜잭션 안에서도 조회가 거듭됐습니다. 불필요한 중복 요청으로 서버 자원을 낭비하던 문제를 해결하려고, 토스는 인증 시 id 토큰을 트랜잭션 안으로 전파하는 Netflix의 Passport를 팀에 맞게 바꿨습니다.

앱이 유저 식별키와 함께 API를 요청하면 Gateway는 이 키로 인증 서버에 Passport를 요청합니다. 기기 정보와 유저 정보를 담은 토큰을 받아 serialize한 뒤 서비스로 전파하는 흐름입니다. 사용자 정보가 여권처럼 트랜잭션 안을 따라다닙니다. 각 서비스는 유저 API를 다시 호출하지 않고 Passport에서 필요한 정보를 얻습니다.

## Spring Cloud Gateway에 모인 공통 로직 {#gateway-role}

서비스와 트래픽이 적을 때는 각 서버가 공통 로직까지 처리해도 큰 부담이 없습니다. 서버가 무수히 늘어나면 배포도 큰일입니다. 같은 로직을 모든 서버에 적용해야 하기 때문입니다. 라우팅과 프로토콜 변환을 맡는 Gateway는 요청을 먼저 받아 공통 처리를 마치고 업스트림 서비스로 넘깁니다. 서비스는 클라이언트와 독립적으로 확장하고, 보안과 모니터링은 한 지점에서 제어하는 구성입니다.

토스는 Spring Cloud Gateway로 이 역할을 구현했습니다. Spring Webflux 기반으로 내부에서 Reactor-Netty를 사용해 비동기 처리를 지원하며, 필터 개발에는 Kotlin Coroutine을 적극 활용합니다. Istio의 Ingress/Egress Gateway, Envoy 필터도 함께 사용하는 구성입니다.

설정의 단위는 Route입니다. Route 안에서 Predicate가 Path, Method, Host 등으로 요청을 구분하면, Filter가 매칭된 요청을 전처리하거나 서비스의 응답을 후처리합니다. 요청을 받았을 때 우선 수행하는 Sanitize도 공통 처리의 하나입니다. 클라이언트가 잘못되거나 악의적인 값을 보내면 해당 값을 지우거나 올바른 값으로 바꿔 서비스에 넘깁니다.

## 토스 앱의 요청을 검증하는 Dynamic Security {#security-stability}

토스 앱의 대부분 API에는 패킷 분석을 어렵게 하기 위한 종단간 암호화가 적용됩니다. 앱이 암호화 키로 요청 바디를 암호화하면 Gateway가 이를 복호화하면서 인증/인가를 처리합니다. 서비스가 받는 것은 복호화한 데이터와 유저 정보입니다. 개별 서비스가 이 과정을 직접 처리하지 않아도 됩니다.

인증/인가에서 검증이 끝나지는 않습니다. Dynamic Security는 요청이 위변조되지 않은 토스 앱에서 만들어졌는지까지 확인하는 장치입니다. 앱은 아주 짧은 유효기간을 가진 키와 변조되지 않은 앱만 아는 정보로 매 요청을 서명해 Gateway에 보냅니다.

Gateway는 이 서명으로 토스 앱에서 만든 요청인지, 중복 사용됐는지, 만료된 키로 서명했는지를 확인합니다. 앱 위변조, delayed request, replaying attack을 막기 위한 검증입니다. 의심스러운 요청을 발견하면 FDS(fraud detection system)로 계정을 비활성화해 사용자를 보호합니다.

## Istio의 mTLS 뒤에서 권한을 판단하는 Gateway {#mtls-auth}

외부 회사나 내부 개발자의 서비스 호출에는 클라이언트 인증서 기반 mTLS API도 지원합니다. Edge의 Istio가 먼저 인증서의 CA 유효성을 확인합니다. 인증서 정보를 헤더에 실어 모든 트래픽을 Gateway로 전달하면, Gateway는 인증서를 Decode한 뒤 X.509 extensions의 Subject Alternative Name에서 사용자 정보를 얻습니다. 이 정보와 도착지 호스트, 요청 경로를 바탕으로 인증/인가와 Auditing을 처리하는 흐름입니다.

Istio만으로 인증/인가를 처리하는 것도 가능합니다. 토스가 그 위에 Gateway 애플리케이션을 둔 이유는 코드로 구현할 때의 자유도에 있습니다. Istio의 matching rule보다 유연하게 로직을 작성하고 Auditing을 처리할 수 있으며, 카나리 배포의 이점도 얻습니다.

## 거미줄처럼 얽힌 서비스 사이의 Circuit breaker {#circuit-breaker}

한 서비스의 응답 지연은 그곳에서 끝나지 않습니다. 거미줄처럼 얽힌 MSA에서는 해당 서비스에 의존하는 다른 서비스로 지연이 번지고, 시스템 자원을 점유하다 전체가 먹통이 될 수 있습니다. Circuit breaker는 지연을 일으키는 서비스에 요청을 더 보내지 않고 빠르게 실패시키는 장치입니다. 부하를 겪는 서비스의 회복을 돕고 지연이 전체로 퍼지는 일을 막습니다.

Gateway에도 서킷 브레이킹을 적용하는 이유가 있습니다. 내부 서비스 사이에서 요청을 차단하는 데 더해, 트래픽의 근원인 클라이언트에 백프레셔를 빠르게 주기 위해서입니다.

어느 계층에서 적용하느냐에 따라 제어 범위도 달라집니다. Istio를 쓰면 호스트 단위로 쉽고 빠르게 전체에 적용하고, 애플리케이션 개발 주기와 독립적으로 관리할 수 있습니다. 하지만 설정은 호스트 단위로만 가능하고 룰에도 한계가 있습니다.

애플리케이션 레이어에서는 Resilience4J나 Hystrix 같은 라이브러리를 사용하는 방법이 있습니다. 토스는 각 애플리케이션과 Gateway에 서킷 브레이킹을 적용했습니다. 호스트뿐 아니라 Route나 기능 단위로도 세밀하게 요청을 차단하는 방식입니다.

## API Path까지 좁혀 보는 모니터링 {#monitoring}

모든 서비스가 거치는 Gateway인 만큼 요청의 경로와 시스템 상태도 꼼꼼히 확인합니다. Gateway를 지나는 모든 요청과 응답의 Route id, method, URI, 상태 코드를 Elasticsearch에 남깁니다. 어떤 Route로 들어왔고 업스트림의 어떤 URI를 호출했는지 바로 확인할 수 있는 기록입니다.

메트릭은 Prometheus가 수집합니다. 수집 대상은 Node Exporter의 시스템 메트릭과 Spring actuator의 애플리케이션 메트릭입니다. Grafana로 시각화하고 슬랙으로 알림을 보냅니다.

시스템 메트릭의 CPU, memory, 네트워크 RX/TX는 애플리케이션 변경이 시스템에 미친 영향을 먼저 파악하고, 문제가 생겼을 때 현상과 원인을 찾는 데 쓰입니다. 애플리케이션 쪽에서는 JVM thread block, 세대별 메모리 할당, full GC 발생 여부를 살핍니다. 관찰 단위를 더 좁히기도 합니다. Spring Cloud Gateway가 제공하는 Route별 메트릭에 Path 값을 더해 API Path별 Route 메트릭까지 확인하는 방식입니다.

더 많은 Gateway 활용 사례는 SLASH23 영상에서 볼 수 있습니다.
