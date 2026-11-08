---
title: "Keycloak 하나로 묶은 웹·Wi-Fi·SSH 인증"
description: "쏘카가 사내 관리 시스템, 무선 네트워크, 서버 SSH 접속의 인증을 Keycloak과 FreeRADIUS로 통합한 과정입니다. 구성 방식과 설치 때 부딪힌 제약을 요약합니다."
date: 2026-11-08
weight: 1
---

# Keycloak 하나로 묶은 웹·Wi-Fi·SSH 인증 (2019-07)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Keycloak를 이용한 SSO 구축(web + wifi + ssh)](https://tech.socar.kr/security/2019/07/31/keycloak-sso)
- 매체 · 게시일: 쏘카 기술 블로그 · 2019-07-31
- 저자: 도마
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 하나의 ID로 모으려던 세 가지 접속 {#요구사항과-선택}

쏘카는 사내 보안을 강화하려고 SSO(Single Sign-On)를 구축했습니다. 직원과 파트너가 쓰는 관리 시스템, Wi-Fi, 서버 SSH 접속을 ID 하나로 인증하는 것이 목적이었습니다. 요구 사항은 Spring 기반 웹 사이트 인증, Wi-Fi 인증, SSH와 sudo 인증, OTP 2차 인증, 유연한 권한 설정이었습니다.

Gluu와 Google Identity Platform 같은 유료 솔루션도 살펴봤지만 설치형 오픈소스인 Keycloak으로 방향을 정했습니다. Wi-Fi와 SSH는 OpenLDAP과 연동한 자료가 더 많았습니다. 저자는 웹으로 운영할 수 있는 쪽을 선호해 Keycloak을 골랐고, 스스로 험한 길이었다고 적었습니다.

## 웹은 gatekeeper, Wi-Fi와 SSH는 RADIUS {#인증-경로-구성}

웹 사이트는 OpenID와 SAML을 지원하는 Keycloak에 직접 붙입니다. reverse proxy로 동작하는 keycloak-gatekeeper를 앞에 두면 애플리케이션에 인증·권한 코드를 쓰지 않아도 됩니다.

Wi-Fi와 SSH는 RADIUS 프로토콜로 풀었습니다. 사내 Cisco 무선 공유기가 RADIUS를 지원하고, SSH는 sshd의 PAM 설정에서 `pam_radius_auth.so`를 거쳐 같은 서버로 인증 요청을 보낼 수 있기 때문입니다. FreeRADIUS에는 Keycloak용 모듈이 없었습니다. Perl 모듈은 쓸 줄 몰라 제외했고, REST 모듈은 Keycloak 연동에 API 호출이 여러 번 필요해 처리하기 어렵다고 판단해 Python 모듈로 정했습니다.

Python 스크립트는 두 단계로 나뉩니다. authorize 단계에서 사용자 이름과 비밀번호가 있으면 Auth-Type을 KEYCLOAK으로 지정하고, authenticate 단계에서 Keycloak API로 실제 인증을 처리합니다. SSH와 sudo의 OTP는 Access-Challenge와 Reply-Message를 돌려주면 PAM 모듈이 사용자에게 추가 입력을 받는 방식입니다. Wi-Fi에는 OTP를 쓰지 않을 계획이었습니다.

## 설치에서 걸린 제약 {#설치-제약}

Keycloak은 EKS에 codecentric Helm 차트로 설치했습니다. nginx-ingress와 Route53 와일드카드 레코드를 먼저 준비했고, 데이터베이스는 RDS의 MySQL을 썼습니다. 바꿀 값이 많아 명령행 인자 대신 values.yaml을 수정했습니다.

FreeRADIUS는 별도 서버에서 docker-compose로 실행했습니다. RADIUS는 UDP 포트 두 개를 쓰는데, 원문 작성 당시 AWS 로드 밸런서로는 UDP를 받을 수 없었고 설정을 마친 직후에야 지원이 시작됐다고 합니다. Kubernetes에 올릴 때도 ingress 종류에 따라 UDP가 안 될 수 있습니다. NodePort는 30000-32767 범위만 써서 기본 포트를 쓸 수 없고, 컨테이너 배포 예시에서는 31812와 31813으로 노출했습니다.

Wi-Fi 인증에는 EAP-TTLS와 내부 PAP를 골랐습니다. PEAP나 CHAP는 해시로 핸드셰이크해서 RADIUS 서버가 사용자가 입력한 비밀번호를 알 수 없고, 그러면 Keycloak에 로그인 요청을 보낼 수 없기 때문입니다. 기본 FreeRADIUS 이미지가 Python을 지원하지 않아, 설정과 인증서를 넣고 pycrypto까지 설치한 이미지를 직접 만들었습니다.

## SSH 쪽 설정과 남는 한계 {#ssh와-운영-한계}

`pam_radius_auth.so`는 Mac에서 작업하는 저자가 Ubuntu 컨테이너로 빌드했습니다. sshd와 sudo의 PAM 설정에는 이 모듈을 `[success=done default=ignore]`로 두고 `common-auth`를 그대로 남겼습니다. RADIUS 인증이 실패하면 기본 리눅스 인증으로 넘어갑니다. `client_id`는 NAS-Identifier로 전달되므로 서버와 ssh, sudo를 구분하는 값으로 쓸 수 있습니다. sshd_config에서는 PasswordAuthentication을 끄고 ChallengeResponseAuthentication을 켜 PAM이 프롬프트를 다루게 했습니다.

저자는 작업 대부분이 설치와 설정이었고 직접 쓴 코드는 Python 스크립트 100~200줄 정도였다고 밝혔습니다. SSH 접속 전에 서버별 계정은 미리 만들어 둬야 합니다. 비밀번호 변경은 사용자별로 관리됩니다. Keycloak의 권한 설정과 스크립트의 권한 확인을 결합하면 사용자별 서버 접근 허용 여부도 다룰 수 있다고 덧붙였지만, 구현 내용은 적지 않았습니다.
