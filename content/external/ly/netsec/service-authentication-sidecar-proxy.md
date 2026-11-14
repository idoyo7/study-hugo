---
title: "소스 수정 없이 인증을 통합한 쿠버네티스 사이드카 프록시"
description: "LINE VOOM은 오픈소스가 섞인 10개 넘는 모듈의 인증을 어떻게 통합했을까요? 쿠버네티스 파드에 Spring Boot 사이드카 프록시를 함께 배포해, 애플리케이션 소스를 고치지 않고 공통 인증을 적용했습니다."
date: 2026-11-14
weight: 4
---

# 소스 수정 없이 인증을 통합한 쿠버네티스 사이드카 프록시 (2022-12)

{{< callout type="info" >}}
**원문 정보**
- 원문: [사이드카 프록시로 구현한 서비스 인증](https://engineering.linecorp.com/ko/blog/service-authentication-sidecar-proxy)
- 매체 · 게시일: LINE Engineering 블로그 · 2022-12-30
- 저자: 박찬우 (LINE VOOM 서버 개발자)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 소스마다 손대기 어려웠던 공통 인증 {#background}

LINE VOOM은 신규 프로젝트의 공통 인증을 별도로 개발한 사이드카 프록시에 맡겼습니다. 인증 대상의 소스를 고치지 않고 자체 개발 컴포넌트와 오픈소스를 같은 인증 체계로 묶기 위한 선택입니다.

프로젝트는 크게 두 부분, 세부적으로는 10개가 넘는 하부 모듈로 구성돼 있었습니다. 일부는 오픈소스였습니다. 각 모듈의 소스 코드에 인증을 일괄 적용하기 어려웠고, 유지 보수 비용도 과다하게 들 것으로 예상됐습니다. 이 문제를 풀 때 활용한 실행 환경이 쿠버네티스입니다.

## 인증 프록시와 애플리케이션을 담은 파드 {#sidecar-proxy}

쿠버네티스 밖이라면 Nginx 같은 리버스 프록시로 애플리케이션을 감싸 인증을 제공할 수도 있습니다. 쿠버네티스에서는 배포 방식을 함께 고려해야 합니다. 레플리카셋이나 디플로이먼트로 배포하면 파드가 속한 노드가 계속 바뀔 수 있고, 네트워크 정보도 따라 바뀝니다. 스테이트풀셋이면 이런 염려가 없지만, HPA를 쓰거나 확장·가용성이 필요한 일반적인 애플리케이션은 레플리카셋이나 디플로이먼트로 배포합니다.

Nginx의 연결 지점을 로드밸런서나 서비스 객체로 지정하는 방법도 있습니다. 그러면 네트워크 홉이 추가되거나 개별 파드를 지정하기 어려워집니다. 필요한 인증 로직을 구현해 넣을 자리도 마땅치 않았습니다.

그래서 인증 프록시를 애플리케이션과 같은 파드에 배치했습니다. 오토바이 옆 사이드카에 탄 사람이 운전자와 동력을 공유하며 돕듯, 별도 애플리케이션이 인증·로깅·설정값 같은 기능을 제공하는 방식입니다. 사용하는 언어도 달라도 됩니다. 쿠버네티스에서는 같은 파드의 컨테이너들이 가상 네트워크 장치를 공유하므로, 외부에는 프록시만 노출하고 프록시와 애플리케이션 사이는 보안 네트워크로 연결할 수 있습니다.

## 프록시 포트로 향하는 LoadBalancer {#pod-deploy}

외부 요청이 들어오는 지점은 Service 객체에서 정합니다. 제시된 설정은 `LoadBalancer` 타입에 `externalTrafficPolicy: Local`을 사용하며, `proxy.enabled`일 때 `targetPort`가 프록시 포트를 가리킵니다. 이 설정에 따라 쿠버네티스가 로드밸런서를 생성하면, 로드밸런서에서 프록시로 트래픽을 보내는 구간이 구성됩니다.

파드 안의 배치는 Helm 차트의 Deployment에 담았습니다. 애플리케이션 컨테이너 옆에 프록시 컨테이너를 두되, `proxy.enabled`일 때만 함께 배포하는 구성입니다. 리소스는 컨테이너마다 배분합니다. 원문은 한 파드에서 함께 실행할 때 리소스 문제가 생기지 않도록, 각 컨테이너의 `limits` 합이 파드가 배정된 노드의 물리적 자원보다 작아야 한다고 명시합니다.

## Harbor 이미지로 추가하는 인증 대상 {#effects}

이렇게 배치하면 인증을 바꿀 때 수정할 대상은 사이드카 프록시입니다. 자체 개발 컴포넌트와 오픈소스의 소스를 각각 고칠 필요가 없어졌습니다. 인증 대상을 추가하거나 삭제하는 작업도 사이드카를 붙이거나 빼는 것으로 처리했습니다. 간단한 인증 대상 추가에는 Harbor에 이미 올려 둔 프록시 이미지를 사용하면 됐습니다.

활용 범위는 처음 의도했던 인증과 로깅을 넘어섰습니다. 프로젝트를 진행하며 생긴 다른 문제도 프록시에서 요청과 응답을 변형해 해결할 수 있었습니다. 특히 오픈소스를 직접 수정하지 않아도 된다는 점이 유용했습니다. 쿠버네티스에 맞춰 애플리케이션 아키텍처를 다시 구성하는 일이 유지 보수 방식을 바꾼 사례입니다.

## 인증과 중계를 나눈 Spring Boot {#implementation}

프록시를 만들 때는 Node.js도 고려했지만, 더 익숙한 Spring Boot를 골랐습니다. 요청 경로와 응답을 다루는 ProxyController, 인증을 담당하는 AuthenticationFilter로 역할을 나눴습니다.

### probe 경로를 인증에서 제외한 AuthenticationFilter {#authentication-filter}

연동해야 할 외부 인증 플랫폼은 비대칭키 방식을 사용했습니다. 요청마다 개인키로 암호화한 정보를 보내므로, 사이드카는 공개키로 이를 복호화하고 검증해야 합니다. AuthenticationFilter는 요청 헤더의 접근 서명(access signature)을 복호화해 사용자 정보를 확인하고, 실패하면 인증 예외를 던집니다.

AuthenticationFilter를 WebFilter로 구현하면 모든 요청이 이 필터를 거칩니다. 여기에는 예외가 필요했습니다. readiness probe나 liveness probe처럼 인증을 적용해서는 안 되는 경로까지 검사하게 되기 때문입니다. `exclude.path`에 지정한 경로는 인증을 생략하도록 만들었고, 이 설정도 환경 변수로 주입했습니다.

### 경로와 응답을 바꾸는 ProxyController {#proxy-controller}

인증을 거친 요청의 전달에는 Spring Cloud Gateway가 제공하는 ProxyExchange를 사용합니다. ProxyController는 모든 경로(`/**`)의 요청을 받아 URI의 scheme·host·port를 대상 서비스 값으로 바꾼 뒤 전달합니다. 서비스에서 돌아온 응답도 수정할 수 있습니다.

응답 헤더를 제거하는 설정이 그 예입니다. `x-frame-options` 때문에 iframe으로 화면을 구성하지 못하는 경우, 프록시가 응답에서 해당 헤더를 빼도록 했습니다. 애플리케이션의 응답을 그대로 전달하는 데서 그치지 않고, 서비스를 사용하는 쪽에 영향을 주는 헤더를 조정한 것입니다.

설정값은 소스 코드나 Docker 이미지에 넣지 않았습니다. 쿠버네티스 환경 변수와 연동해 등록과 수정을 편하게 했습니다. Helm의 Values.yaml에는 `PROXY.TARGET.HOST`, `PROXY.TARGET.PORT`, `PROXY.TARGET.SCHEME`, `PROXY.RESPONSE.HEADERS.REMOVE`를 두었습니다. 이 값들은 ConfigMap으로 옮겨지고, Deployment의 `envFrom` 설정에 따라 프록시 컨테이너의 환경 변수가 됩니다.

마지막으로 Spring Boot가 기동하면서 값을 읽어 `@Value`에 매핑합니다. Values.yaml에서 시작해 ConfigMap, Deployment를 거쳐 ProxyController에 도착하는 흐름입니다. 예를 들어 호스트를 `127.0.0.1`로 설정하면 ProxyController의 `targetHost`도 그 값을 받습니다.

## 특정 파라미터에서 드러난 URL 이중 인코딩 {#issue}

배포를 마치자 특정 파라미터가 들어간 요청이 작동하지 않았습니다. 프록시가 있는 경로와 없는 경로의 URL을 비교했습니다. 차이는 인코딩이었습니다. 프록시를 거치는 과정에서 URL 인코딩이 중복 수행되고 있었습니다.

해결한 지점은 대상 URI를 만드는 코드입니다. `UriComponents`의 `build(boolean encoded)` 인자를 `false`로 변경해 이중 인코딩 문제를 해결했습니다.

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
