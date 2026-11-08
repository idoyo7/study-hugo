---
title: "테크노트 요약"
description: "티맵모빌리티 테크노트 글 18편의 요약입니다. 측위와 경로탐색 엔진, 지도 데이터 구축, 실시간 데이터 파이프라인, 서버 TTS, 클라우드 인프라, 대중교통 백엔드, 보안 인증을 최근 게시일부터 정리했습니다."
date: 2026-11-08
weight: 10
comments: false
---

# 테크노트 요약

## 이 분류에서 찾기 {#section-navigation}

- [완성차에 탑재되는 TMAP AUTO의 사이버보안 인증과 검증 (2025-05)]({{< relref "/external/tmap/blog/18-tmap-auto-security.md" >}})
- [Geofence, 타이머, WiFi 스캔을 겹친 대중교통 승하차 알림 (2024-09)]({{< relref "/external/tmap/blog/17-transit-boarding-alert.md" >}})
- [Kafka와 Redis 사이를 논블로킹으로 잇는 대중교통 백엔드 (2024-05)]({{< relref "/external/tmap/blog/16-public-transit-reactive-backend.md" >}})
- [기관 데이터를 5분 단위로 통합하는 도로 상황 정보 시스템 (2023-10)]({{< relref "/external/tmap/blog/15-road-condition-info-system.md" >}})
- [기지국, WiFi, GPS 위성으로 잡는 위치 측위 (2023-02)]({{< relref "/external/tmap/blog/14-location-positioning-methods.md" >}})
- [Shortcut 변화 시점만 저장하는 CATCHUp 미래 경로탐색 (2023-01)]({{< relref "/external/tmap/blog/13-catchup-time-dependent-routing.md" >}})
- [단어별 요청으로 바꾼 서버 기반 TTS (2022-11)]({{< relref "/external/tmap/blog/12-server-based-tts.md" >}})
- [사전 정보 수집에서 즉시 반영까지의 지도 데이터 구축 (2022-10)]({{< relref "/external/tmap/blog/11-map-data-building.md" >}})
- [메인 스레드를 비워 준 지도 엔진의 웹 워커 (2022-09)]({{< relref "/external/tmap/blog/10-js-map-engine-web-worker.md" >}})
- [링크와 버텍스 위에서 계산하는 GPS 구간 속도 (2022-07)]({{< relref "/external/tmap/blog/09-traffic-info-from-gps.md" >}})
- [경로탐색 엔진 모듈별 Graviton2 교체 결과 (2022-05)]({{< relref "/external/tmap/blog/08-aws-graviton2-adoption.md" >}})
- [EKS on Fargate로 구축한 티맵결제 플랫폼 (2022-04)]({{< relref "/external/tmap/blog/07-payment-platform-eks-fargate.md" >}})
- [내비게이션 복잡도를 감춘 TMAP SDK의 설계 (2022-03)]({{< relref "/external/tmap/blog/06-tmap-navigation-sdk.md" >}})
- [주행 데이터 기반 T지금 실시간 인기 장소 랭킹 (2022-03)]({{< relref "/external/tmap/blog/05-tnow-realtime-ranking.md" >}})
- [ADAS Map의 콘텐츠와 제작 단계 (2022-01)]({{< relref "/external/tmap/blog/04-adas-map-building.md" >}})
- [12시간 배치에서 Flink 스트리밍으로 옮긴 운전습관 분석 (2021-12)]({{< relref "/external/tmap/blog/03-flink-realtime-driving-score.md" >}})
- [A*의 한계와 CCH 기반 Thor 경로탐색 엔진 (2021-12)]({{< relref "/external/tmap/blog/02-cch-routing-engine-thor.md" >}})
- [터널 안 측위를 위한 센서 실험과 기압 기반 가상 주행 (2021-12)]({{< relref "/external/tmap/blog/01-tunnel-positioning.md" >}})

최근 게시일부터 차례로 놓았습니다. 경로탐색 엔진 두 편(CCH, CATCHUp)과 Graviton2 교체기는 같은 서버 엔진을 다른 각도에서 쓴 글이고, 터널 측위와 위치 측위, 승하차 알림은 단말이 위치를 잡는 쪽입니다. ADAS Map과 지도 데이터 구축은 데이터를 만드는 쪽, GPS 교통정보와 도로 상황 정보는 그 위에 실시간 정보를 얹는 쪽입니다. 앱과 서버가 어떻게 이어지는지는 [티맵 앱과 지도 서버의 연결 구조]({{< relref "/external/tmap/server-connectivity.md" >}})에서 관련 글의 단서를 모아 정리했습니다.

원문이 아니라 읽고 재구성한 요약이므로 정확한 내용은 각 문서의 원문 링크에서 확인하시기 바랍니다.
