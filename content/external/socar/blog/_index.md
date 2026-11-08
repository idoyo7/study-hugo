---
title: "기술 블로그 요약"
description: "쏘카 기술 블로그 글 20편의 요약입니다. 차량 단말 IoT 파이프라인, FMS 데이터 파이프라인, Airflow 플랫폼, 인증 트래픽 대응, 로그·CI·배포 구성, 장애 복구 에이전트를 최근 게시일부터 정리했습니다."
date: 2026-11-08
weight: 10
comments: false
---

# 기술 블로그 요약

## 이 분류에서 찾기 {#section-navigation}

- [50여 개 외부 웹의 장애를 복구하는 AI 에이전트의 단계 설계와 방어 장치 (2026-07)]({{< relref "/external/socar/blog/20-self-healing-ai-agent.md" >}})
- [S3와 CloudFront SPA 배포의 캐시 분리와 fallback 범위 제한 (2026-06)]({{< relref "/external/socar/blog/19-spa-s3-cloudfront-cache-fallback.md" >}})
- [SIGTERM 이후에도 살아 있는 Node.js 컨테이너의 종료 처리 (2026-01)]({{< relref "/external/socar/blog/17-nodejs-graceful-shutdown.md" >}})
- [쏘카프레임 블루투스 모듈의 호스트·리모트 추상화 (2026-01)]({{< relref "/external/socar/blog/18-socarframe-bluetooth-module.md" >}})
- [모노레포 CI의 병렬 빌드와 Turborepo 캐시 사전 점검 (2025-06)]({{< relref "/external/socar/blog/16-fe-ci-parallel-build-cache.md" >}})
- [서버 로그 적재를 Kafka와 데이터 컨트랙트로 다시 짠 파이프라인 (2025-02)]({{< relref "/external/socar/blog/15-log-pipeline-revamp.md" >}})
- [순서를 지키는 FMS 주행이벤트 파이프라인의 두 차례 교체 (2024-06)]({{< relref "/external/socar/blog/14-fms-trip-event-pipeline.md" >}})
- [20줄짜리 회원 조회 코드에서 찾은 다섯 가지 성능 병목 (2023-07)]({{< relref "/external/socar/blog/13-member-service-performance-tuning.md" >}})
- [일정이 절반이 된 인증 개선 프로젝트의 우선순위와 단계 분할 (2023-07)]({{< relref "/external/socar/blog/12-auth-token-traffic-planning.md" >}})
- [인증 토큰 조회 부하를 줄인 네 단계 개선 (2023-06)]({{< relref "/external/socar/blog/11-auth-token-traffic-development.md" >}})
- [FMS 데이터 파이프라인의 E2E 테스트와 데이터 품질 검사 (2023-01)]({{< relref "/external/socar/blog/10-fms-data-pipeline-2-testing.md" >}})
- [FMS 차량 데이터의 스트리밍·배치 파이프라인 구성 (2023-01)]({{< relref "/external/socar/blog/09-fms-data-pipeline-1-streaming-batch.md" >}})
- [전사 구성원이 쓰는 Airflow 플랫폼의 고도화 (2022-11)]({{< relref "/external/socar/blog/08-airflow-advanced-platform.md" >}})
- [카셰어링 차량에 장착되는 관제 장치의 역할 (2022-02)]({{< relref "/external/socar/blog/07-telematics-device-role.md" >}})
- [Kinesis에서 MSK로 옮긴 차량 단말 데이터 파이프라인 (2022-02)]({{< relref "/external/socar/blog/06-iot-pipeline-2-kafka.md" >}})
- [SMS와 HTTP를 걷어낸 신규 단말의 MQTT와 AWS IoT Core (2022-01)]({{< relref "/external/socar/blog/05-iot-pipeline-1-new-device.md" >}})
- [Cloud Composer에서 Kubernetes까지 3년간의 Airflow 운영 (2021-06)]({{< relref "/external/socar/blog/04-airflow-data-platform.md" >}})
- [SQS와 Kubernetes로 만든 차량 파손 탐지 모델 서빙 (2020-03)]({{< relref "/external/socar/blog/03-ml-model-serving.md" >}})
- [Aviatrix Gateway로 만든 AWS VPC의 FQDN 아웃바운드 통제 (2019-09)]({{< relref "/external/socar/blog/02-aviatrix-fqdn-egress.md" >}})
- [Keycloak 하나로 묶은 웹·Wi-Fi·SSH 인증 (2019-07)]({{< relref "/external/socar/blog/01-keycloak-sso.md" >}})

최근 게시일부터 차례로 놓았습니다. 차량 단말과 서버를 잇는 IoT 파이프라인 두 편과 관제 장치 소개, FMS 데이터 파이프라인 두 편과 주행이벤트 파이프라인은 모빌리티 플랫폼과 데이터 그룹이 같은 데이터 흐름을 각자의 자리에서 쓴 글이라 함께 읽으면 그림이 이어집니다. 이 흐름을 한데 놓고 본 정리는 [쏘카 차량 단말의 연결 구조]({{< relref "/external/socar/device-connectivity.md" >}})에 있습니다. Airflow 두 편과 로그 파이프라인은 데이터 플랫폼 운영, 인증 토큰 두 편과 회원 서비스 튜닝은 트래픽 대응, 나머지는 보안·CI·배포·운영 자동화를 다룹니다.

원문이 아니라 읽고 재구성한 요약이므로 정확한 내용은 각 문서의 원문 링크에서 확인하시기 바랍니다.
