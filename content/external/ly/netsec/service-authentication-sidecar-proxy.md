---
title: "사이드카 프록시로 구현한 서비스 인증"
description: "LINE VOOM 신규 프로젝트에서 10개가 넘는 하부 모듈의 인증을 공용화하려고 쿠버네티스 사이드카 프록시를 직접 만든 사례입니다. Spring Boot 프록시 구성과 파드 배포, 배포 뒤 겪은 URL 이중 인코딩 문제를 정리했습니다."
date: 2026-11-14
weight: 4
---

# 사이드카 프록시로 구현한 서비스 인증 (2022-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [사이드카 프록시로 구현한 서비스 인증](https://engineering.linecorp.com/ko/blog/service-authentication-sidecar-proxy)
- 매체 · 게시일: LINE Engineering 블로그 · 2022-12-30
- 저자: 박찬우 (LINE VOOM 서버 개발자)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 문제 배경 {#background}

저자가 맡은 신규 프로젝트는 크게 두 부분, 세부적으로는 10개가 넘는 하부 모듈로 이루어져 있었습니다. 일부 모듈은 오픈소스를 썼기 때문에 소스 코드 수준에서 인증을 일괄 적용하기 어려웠고, 유지 보수 비용도 과다하게 들 것으로 보였습니다. 고민 끝에 사이드카 패턴을 쓴 인증 프록시를 따로 만들어 붙이기로 했습니다. 글은 프로젝트가 쿠버네티스 환경에서 돈다고 전제합니다.

## 사이드카 프록시 {#sidecar-proxy}

사이드카 패턴의 이름은 오토바이 옆에 붙는 사이드카에서 왔습니다. 사이드카에 탄 사람이 운전자와 동력을 나누면서 여러모로 돕는 것처럼, 인증·로깅·설정값 같은 기능을 애플리케이션 옆에서 대신 제공합니다. 별도 애플리케이션이라서 본체와 다른 언어로 만들어도 됩니다.

쿠버네티스에서는 한 파드의 컨테이너들이 같은 가상 네트워크 장치를 공유하므로 서로 안전하게 통신할 수 있습니다. 그래서 사이드카 프록시만 외부에 노출하고, 프록시와 애플리케이션 사이는 보안 네트워크로 연결할 수 있습니다.

Nginx 같은 리버스 프록시로 해결하면 되지 않느냐는 의문에는 원문이 이렇게 답합니다.

- 레플리카셋이나 디플로이먼트로 배포하면 파드가 속한 노드가 계속 바뀌고 네트워크 정보도 함께 바뀝니다. 스테이트풀셋이면 이런 걱정이 없지만, HPA나 확장·가용성이 필요한 일반 애플리케이션은 보통 레플리카셋이나 디플로이먼트로 배포합니다.
- Nginx의 연결 지점을 로드밸런서나 서비스 객체로 두면 네트워크 홉이 늘고, 개별 파드 단위 지정이 어렵습니다. 무엇보다 필요한 인증 로직을 넣을 자리가 마땅치 않습니다.

그래서 쿠버네티스에서 기존 리버스 프록시만으로 인증을 적용하기는 어렵다고 보았습니다.

## 프록시 구현 {#implementation}

프로젝트는 외부 인증 플랫폼과 통합해야 했고, 이 플랫폼은 비대칭키 방식이었습니다. 요청마다 개인키로 암호화한 정보가 오므로 사이드카는 공개키로 복호화해 검증해야 합니다. 프록시는 Node.js와 Spring Boot 사이에서 고심하다 익숙한 Spring Boot로 만들었고, 경로와 헤더를 고치는 ProxyController와 인증을 처리하는 AuthenticationFilter 둘로 나눴습니다.

### ProxyController {#proxy-controller}

핵심은 Spring Cloud Gateway가 제공하는 ProxyExchange입니다. 모든 경로(`/**`) 요청의 URI를 대상 서비스의 scheme·host·port로 바꿔 전달합니다. 프록시가 서비스를 호출한 뒤 받은 응답에서 특정 헤더를 빼는 설정도 있습니다. 대표적인 것이 `x-frame-options`로, 응답에 이 헤더가 있으면 iframe 화면 구성이 안 됩니다. 보안용 헤더가 애플리케이션에 영향을 주는 경우 프록시가 응답에서 제거하게 했습니다.

모든 설정값은 소스나 Docker 이미지에 넣지 않고 쿠버네티스 환경 변수와 연동했습니다. Helm의 Values.yaml에 `PROXY.TARGET.HOST`, `PROXY.TARGET.PORT`, `PROXY.TARGET.SCHEME`, `PROXY.RESPONSE.HEADERS.REMOVE`를 두면 ConfigMap으로 옮겨지고, Deployment의 `envFrom`으로 프록시 컨테이너 환경 변수가 되며, Spring Boot가 기동할 때 읽어 `@Value`에 매핑합니다. Values, ConfigMap, Deployment, ProxyController 순으로 값을 참조합니다.

### AuthenticationFilter {#authentication-filter}

인증 로직은 WebFilter로 구현한 AuthenticationFilter에 있어 모든 요청이 거칩니다. 요청 헤더의 접근 서명(access signature)을 복호화해 사용자 정보를 확인하고, 실패하면 인증 예외를 던집니다. 문제는 readiness probe나 liveness probe 경로까지 인증을 거친다는 점이었고, `exclude.path` 변수로 특정 경로를 인증에서 제외했습니다. 이 값도 ProxyController 설정과 같은 경로로 환경 변수에 주입됩니다.

## 파드 배포 {#pod-deploy}

인증 프록시와 애플리케이션은 한 파드에 함께 배포합니다. Helm 차트의 Deployment에 애플리케이션 컨테이너와, `proxy.enabled`일 때만 붙는 프록시 컨테이너를 나란히 두었습니다. 두 컨테이너가 한 파드에서 돌 때 리소스 문제가 없도록 각각 배분했고, 원문은 각 컨테이너 리소스 limits의 합이 파드가 배정된 노드의 물리 값보다 작아야 한다고 짚습니다.

Service 객체는 프록시만 외부에 노출합니다. `proxy.enabled`일 때 `targetPort`가 프록시 포트를 가리키고, 이 설정에 따라 쿠버네티스가 만드는 로드밸런서에서 프록시까지 구간의 트래픽이 정해집니다. 원문의 Service는 `LoadBalancer` 타입에 `externalTrafficPolicy: Local`입니다.

## 배포 뒤 문제와 해결 {#issue}

배포 뒤 특정 파라미터가 들어간 요청이 동작하지 않았습니다. 프록시가 있을 때와 없을 때의 URL을 비교해 보니 URL 인코딩이 두 번 수행되고 있었습니다. `UriComponents`의 `build(boolean encoded)` 인자를 `false`로 바꿔 해결했습니다.

## 적용 효과 {#effects}

- 자체 개발 컴포넌트와 오픈소스를 같은 인증 체계로 통합했습니다. 사이드카가 별도 애플리케이션으로 인증하므로 대상 소스를 고칠 필요가 없어서, 오픈소스에 특히 유용했습니다.
- 인증 관련 수정은 사이드카만 고치면 됩니다. 인증 대상을 늘리거나 줄이는 것도 사이드카를 붙이거나 떼면 되고, 간단한 추가는 Harbor에 올려 둔 프록시 이미지를 쓰는 것으로 끝났습니다.
- 인증 외의 용도로도 쓸 수 있었습니다. 원래 의도한 인증과 로깅 외에 다른 이슈를 풀 때도, 오픈소스를 직접 손대지 않고 요청과 응답을 바꿀 수 있어 유용했습니다.

저자는 마치며 애플리케이션과 그 환경을 별개 직무로 보기보다 함께 발전하는 하나의 구성 요소로 인식하는 것이 필요하다고 적습니다.

{{% details title="원문의 주요 설정값" closed="true" %}}

| 항목 | 값 |
|---|---|
| 프록시 구현 | Spring Boot, Spring Cloud Gateway의 ProxyExchange |
| 프록시 환경 변수 예 | TARGET.HOST 127.0.0.1, TARGET.PORT 8080, TARGET.SCHEME http |
| 응답에서 제거하는 헤더 예 | x-frame-options |
| 애플리케이션 리소스 예 | requests cpu 5000m, memory 4000Mi / limits cpu 10000m, memory 10000Mi |
| 프록시 리소스 예 | requests cpu 1000m, memory 2000Mi / limits cpu 1500m, memory 5000Mi |
| Service | type LoadBalancer, externalTrafficPolicy Local |
| URL 이중 인코딩 해결 | `build(false)` |

{{% /details %}}
