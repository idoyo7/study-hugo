---
title: "쏘카"
description: "쏘카 기술 블로그에서 인프라와 운영에 가까운 글 20편을 골라 요약한 자료입니다. 차량 단말과 서버를 잇는 IoT 파이프라인, FMS 데이터 파이프라인, 인증 트래픽 대응, 로그·CI·배포 구성까지 주제별로 찾아볼 수 있습니다."
date: 2026-11-08
weight: 30
comments: false
---

# 쏘카

## 이 분류에서 찾기 {#section-navigation}

- [쏘카 차량 단말의 연결 구조]({{< relref "/external/socar/device-connectivity.md" >}})
- [기술 블로그 요약]({{< relref "/external/socar/blog/_index.md" >}})

{{< callout type="info" >}}
**출처**

쏘카 기술 블로그(tech.socar.kr)에 2026-11-08 기준 공개된 72편 가운데 인프라·플랫폼·데이터 파이프라인·운영에 해당하는 20편을 골랐습니다. 프런트엔드 컴포넌트, 디자인 시스템, QA 조직, 데이터 분석 사례처럼 인프라와 거리가 있는 글은 제외했습니다. 아래에는 원문 제목, 게시일, 저자 닉네임을 적었고 각 링크에서 원문을 확인할 수 있습니다.

- [Keycloak를 이용한 SSO 구축(web + wifi + ssh)](https://tech.socar.kr/security/2019/07/31/keycloak-sso) · 2019-07-31 · 도마
- [AWS VPC에서 FQDN Outbound Control](https://tech.socar.kr/security/2019/09/02/aviatrix-fqdn) · 2019-09-02 · 아이작
- [딥러닝 모델 Serving 간단 구축기](https://tech.socar.kr/data/2020/03/10/ml-model-serving) · 2020-03-10 · 토마스
- [쏘카 데이터 그룹 - Airflow와 함께한 데이터 환경 구축기](https://tech.socar.kr/data/2021/06/01/data-engineering-with-airflow) · 2021-06-01 · 하디
- [차량용 단말을 위한 IoT 파이프라인 구축기 #1](https://tech.socar.kr/mobility/2022/01/06/socar-iot-pipeline-1) · 2022-01-06 · 스팍
- [차량용 단말을 위한 IoT 파이프라인 구축기 (feat. Kafka) #2](https://tech.socar.kr/mobility/2022/02/09/socar-iot-pipeline-2) · 2022-02-09 · 바다
- [쏘카의 관제 장치(Telematics Device)가 하는 일](https://tech.socar.kr/mobility/2022/02/15/control-device-with-car-sharing) · 2022-02-15 · 주노
- [전사 구성원들이 사용하는 배치 데이터 플랫폼 만들기 - Airflow Advanced](https://tech.socar.kr/data/2022/11/09/advanced-airflow-for-databiz) · 2022-11-09 · 그랩
- [FMS(차량 관제 시스템) 데이터 파이프라인 구축기 1편. 스트리밍/배치 파이프라인 개발기](https://tech.socar.kr/data/2023/01/17/build-fms-data-pipeline-1) · 2023-01-17 · 그랩
- [FMS(차량 관제 시스템) 데이터 파이프라인 구축기 2편. 신뢰성 높은 데이터를 위한 테스트 환경 구축](https://tech.socar.kr/data/2023/01/24/build-fms-data-pipeline-2) · 2023-01-24 · 그랩
- [쏘카의 대규모 인증토큰 트래픽 대응 : 개발기](https://tech.socar.kr/dev/2023/06/27/handling-authentication-token-traffic-01) · 2023-06-27 · 올리
- [쏘카의 대규모 인증토큰 트래픽 대응 : 프로젝트 플래닝](https://tech.socar.kr/dev/2023/07/07/handling-authentication-token-traffic-02) · 2023-07-07 · 청명
- [싱글벙글 회원 서비스 성능 튜닝기](https://tech.socar.kr/dev/2023/07/22/member-service-performance-tuning-01) · 2023-07-22 · 촤
- [FMS(Fleet Management System) 주행이벤트 파이프라인 개선기](https://tech.socar.kr/dev/2024/06/12/fms-trip-event-pipeline) · 2024-06-12 · 렉스
- [로그 파이프라인 개선기 - 기존 파이프라인 문제 정의 및 해결 방안 적용](https://tech.socar.kr/data/2025/02/26/log-pipeline-revamp) · 2025-02-26 · 삐약
- [FE Core팀의 CI 속도전: 캐시 전략을 활용한 병렬 빌드](https://tech.socar.kr/fe/2025/06/11/monorepo-ci-cd-pipeline) · 2025-06-11 · 아놀드
- [쏘카프레임 - 블루투스 모듈](https://tech.socar.kr/socarframe/2026/01/08/socarframe-bluetooth) · 2026-01-08 · 아벨
- [Node.js 컨테이너, 왜 깔끔하게 안 죽을까? (feat. Graceful shutdown)](https://tech.socar.kr/dev/2026/01/20/nodejs-graceful-shutdown) · 2026-01-20 · 세바스찬
- [S3 + CloudFront 기반 SPA 배포에서 캐시와 fallback 전략 설계하기](https://tech.socar.kr/fe/2026/06/24/spa-cache-fallback-strategy-with-s3-cloudfront) · 2026-06-24 · 프레디
- [장애를 스스로 복구하는 AI 에이전트](https://tech.socar.kr/dev/2026/07/22/agentic-engineering-in-production) · 2026-07-22 · 토닉
{{< /callout >}}

쏘카는 차량에 장착한 단말에서 올라오는 상태 정보가 서비스의 출발점이라, 인프라 글도 단말과 서버를 잇는 파이프라인에서 데이터 플랫폼으로 이어지는 흐름이 두드러집니다. 단말 연결 구조는 관련 글 일곱 편을 한데 놓고 진단한 문서에서 먼저 읽고, 개별 글은 블로그 요약 목록에서 게시일순으로 찾을 수 있습니다.

원문이 아니라 읽고 재구성한 요약이므로 정확한 내용은 각 문서의 원문 링크에서 확인하시기 바랍니다.
