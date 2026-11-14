---
title: "토스의 Gateway 활용 사례"
description: "토스 서버플랫폼팀이 Spring Cloud Gateway와 Istio로 공통 로직, 보안, 모니터링을 처리하는 방식을 정리했습니다. Sanitize, 유저 Passport, 종단간 암호화, Dynamic Security, mTLS, Circuit breaker를 다룹니다."
date: 2026-11-14
weight: 1
---

# 토스의 Gateway 활용 사례 (2023-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [토스는 Gateway 이렇게 씁니다](https://toss.tech/article/slash23-server)
- 매체 · 게시일: 토스 기술 블로그 · 2023-10-12
- 저자: 최준우 (서버플랫폼팀)
- 시리즈: SLASH23 발표를 글로 옮긴 서버 세션
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## Gateway의 역할과 토스의 구성 {#gateway-role}

Gateway는 라우팅과 프로토콜 변환을 맡아 마이크로서비스 앞에서 중개자 역할을 하는 서버입니다. 서비스가 클라이언트와 독립적으로 확장되고 보안과 모니터링을 위한 단일 제어 지점이 생깁니다. 서비스와 트래픽이 적을 때는 각 서비스가 모든 로직을 처리해도 부담이 없지만, 서버가 무수히 많아지는 MSA에서는 공통 로직을 모든 서버에 적용하고 배포하는 일 자체가 큰일이 됩니다. Gateway 패턴은 이 공통 로직을 모아서 처리하고 업스트림 서버에 넘깁니다.

요청이 오면 Gateway는 설정에 따라 라우팅하고 필터를 실행합니다. 설정은 Route 단위이며 Route는 Predicate와 Filter로 구성됩니다. Predicate는 Path, Method, Host 등으로 요청을 구분하고, Filter는 요청 전처리나 응답 후처리를 맡습니다. 토스는 Gateway를 Spring Cloud Gateway로 만듭니다. Spring Webflux 기반이고 내부에서 Reactor-Netty로 비동기 처리하며, 필터 개발에는 Kotlin Coroutine을 적극 쓰고 Istio의 Ingress/Egress Gateway, Envoy 필터와 함께 개발합니다.

## 공통 로직 처리 {#common-logic}

Gateway가 처리하는 공통 로직은 크게 요청 전처리·후처리, 유저 정보를 이용한 로직, 보안과 서비스 안정화 설정입니다.

Sanitize는 클라이언트의 올바르지 않은 요청 값을 지우거나 올바른 값으로 바꾸는 일입니다. 사용자가 악의적인 값을 넣어 요청해도 Gateway가 바로잡아 서비스에 넘깁니다.

유저 Passport는 서비스가 유저 정보를 얻는 방식을 바꿨습니다. 예전에는 서비스마다 유저 정보가 필요할 때 유저 API를 호출했고, 이것이 트랜잭션 안의 불필요한 중복 요청과 서버 자원 낭비로 이어졌습니다. 토스는 Netflix가 id 토큰인 Passport를 트랜잭션 안으로 전파하는 구조를 참고해 팀에 맞게 바꿨습니다. 앱이 유저 식별키와 함께 API를 요청하면 Gateway가 이 키로 인증 서버에서 기기 정보와 유저 정보가 담긴 Passport를 받아 serialize해 서비스에 전달하고, 서비스는 유저 API 호출 없이 이 정보를 씁니다.

## 보안과 안정성 {#security-stability}

종단간 암호화는 토스 앱 API의 대부분에 적용됩니다. 앱이 암호화 키로 요청 바디를 암호화하면 Gateway가 복호화하면서 인증/인가를 처리하고, 복호화한 데이터와 유저 정보를 서비스에 넘깁니다.

Dynamic Security는 요청이 위변조되지 않은 토스 앱에서 왔는지까지 검증합니다. 앱은 아주 짧은 유효기간의 키와 변조되지 않은 앱만 아는 정보로 매 요청을 서명하고, Gateway는 서명으로 앱에서 만든 요청인지, 중복 사용되지 않았는지, 만료된 키로 만들지 않았는지를 확인합니다. 앱 위변조, delayed request, replaying attack을 막기 위함이며, 의심스러운 요청은 FDS(fraud detection system)를 통해 계정을 비활성화합니다.

외부 회사나 내부 개발자의 호출을 위해서는 클라이언트 인증서 기반 mTLS API도 지원합니다. Istio의 mTLS flow 위에 Gateway 애플리케이션을 두고 인증/인가를 처리합니다. Istio만으로도 가능하지만 코드 기반 애플리케이션이 matching rule보다 자유도가 높고 Auditing 등을 처리할 수 있으며 카나리 배포의 이점도 누릴 수 있어서입니다. Edge에서 Istio가 인증서의 CA 유효성을 확인하고 인증서 정보를 헤더에 실어 Gateway에 전달하면, Gateway가 X.509 extensions의 Subject Alternative Name으로 사용자 정보를 얻고 도착지 호스트와 요청 경로를 함께 보아 인증/인가와 Auditing을 처리합니다.

Circuit breaker는 서비스가 거미줄처럼 얽힌 MSA에서 응답 지연이 의존하는 서비스로 번져 시스템 전체가 멈추는 일을 막습니다. 지연을 일으키는 서비스에 요청을 보내지 않고 빠르게 실패시켜 회복할 시간을 줍니다. 내부 서비스 간에도 중요하지만 트래픽의 근원인 클라이언트에 백프레셔를 빠르게 주려면 Gateway에서 거는 것이 중요합니다. Istio로 하는 인프라 레이어 방식은 호스트 단위로 쉽고 빠르게 전체 적용이 되고 애플리케이션 개발 주기와 독립적이지만, 호스트 단위 설정만 가능하고 룰에 한계가 있습니다. 라이브러리(Resilience4J, Hystrix)로 하는 애플리케이션 레이어 방식은 더 정교합니다. 토스는 각 애플리케이션과 Gateway에 직접 적용해 호스트, Route, 기능 단위로 세밀하게 걸고 있습니다.

## 모니터링 {#monitoring}

Gateway는 토스의 모든 서비스가 거치는 컴포넌트라 로깅, 메트릭, 트레이싱 모니터링이 더 꼼꼼해야 합니다. 로깅은 Gateway를 지나는 모든 요청과 응답의 Route id, method, URI, 상태 코드를 Elasticsearch에 남깁니다. 어떤 Route로 들어왔고 업스트림의 어떤 URI를 호출했는지 바로 확인할 수 있습니다.

메트릭은 Prometheus가 수집합니다. Node Exporter의 시스템 메트릭(CPU, memory, 네트워크 RX/TX)과 Spring actuator의 애플리케이션 메트릭(JVM thread block, 세대별 메모리 할당, full GC 여부)을 Grafana로 시각화하고 슬랙으로 알립니다. Spring Cloud Gateway가 주는 Route별 메트릭에 Path 값을 더해 API Path별 Route 메트릭도 봅니다.

## 마무리 {#wrap-up}

원문은 Gateway가 외부에 노출되는 엔드포인트를 중앙에서 관리하게 해 주어, 트래픽 모니터링, 속도 제한, 요청과 응답 수정 같은 일로 거대한 MSA 클러스터를 확장, 관리, 모니터링하기 쉽게 한다고 맺습니다. 더 많은 사례는 SLASH23 영상을 참고하라고 안내합니다.
