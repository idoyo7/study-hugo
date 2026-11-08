---
title: "티맵모빌리티"
description: "티맵모빌리티 테크노트(브런치) 29편 가운데 지도·측위·경로탐색 엔진, 실시간 데이터 파이프라인, 클라우드 인프라에 해당하는 18편을 요약한 자료입니다. 티맵 앱과 지도 서버가 어떻게 이어지는지 관련 글을 모아 진단한 문서도 함께 있습니다."
date: 2026-11-08
weight: 40
comments: false
---

# 티맵모빌리티

## 이 분류에서 찾기 {#section-navigation}

- [티맵 앱과 지도 서버의 연결 구조]({{< relref "/external/tmap/server-connectivity.md" >}})
- [테크노트 요약]({{< relref "/external/tmap/blog/_index.md" >}})

{{< callout type="info" >}}
**출처**

티맵모빌리티가 브런치 매거진 「티맵 테크노트」(brunch.co.kr/@tmapmobility)에 2026-11-08 기준 공개한 29편 가운데 지도 데이터, 측위, 경로탐색 엔진, 실시간 데이터 파이프라인, 클라우드 인프라, 보안에 해당하는 18편을 골랐습니다. 딥러닝 모델링과 추천, OCR, 화물 다이나믹 프라이싱, QA 자동화, 졸음운전 감지처럼 인프라와 거리가 있는 11편은 제외했습니다. 글은 모두 "티맵모빌리티" 계정으로 올라와 있어 아래에는 원문 제목과 부제, 게시일을 적었습니다.

- [GPS 안잡히는 터널에서 티맵은 어떻게 길안내를 할까?](https://brunch.co.kr/@tmapmobility/2) · 티맵 개발자 SSUL 2편 · 2021-12-20
- [네비 개발자여, 번개처럼 빠른 경로탐색엔진을 만들라](https://brunch.co.kr/@tmapmobility/3) · 3편 CCH Algorithm · 2021-12-21
- [실시간 운전점수를 위한 Apache Flink](https://brunch.co.kr/@tmapmobility/5) · 4편 실시간 운전점수 데이터 스트림 · 2021-12-23
- [21세기 김정호는 ADAS Map을 만듭니다](https://brunch.co.kr/@tmapmobility/6) · 5편 티맵이 지도를 만드는 방법 · 2022-01-26
- [주행 데이터로 실시간 핫플 랭킹 서비스 개발하기](https://brunch.co.kr/@tmapmobility/9) · 7편 T지금 시스템 구축기 · 2022-03-11
- [내비 앱 만들기 어렵지 않아요- 티맵 SDK만 있다면!](https://brunch.co.kr/@tmapmobility/10) · 8편 · 2022-03-31
- [결제플랫폼 구축에 EKS on Fargate 적용하기](https://brunch.co.kr/@tmapmobility/13) · 10편 AWS에서 MSA 서비스 구축하기 · 2022-04-28
- [AWS Graviton2 출시 후 바로 도입해본 후기](https://brunch.co.kr/@tmapmobility/14) · 11편 · 2022-05-25
- [GPS 정보로 교통정보 생성하는 방법](https://brunch.co.kr/@tmapmobility/16) · 13편 · 2022-07-28
- [자바스크립트 지도 엔진에 웹 워커를 적용해봤습니다](https://brunch.co.kr/@tmapmobility/17) · 14편 · 2022-09-05
- [티맵은 어떻게 지도 데이터를 구축할까?](https://brunch.co.kr/@tmapmobility/18) · 15편 · 2022-10-20
- [내비 안내 음성은 어떻게 자동으로 만들어질까?](https://brunch.co.kr/@tmapmobility/19) · 16편 서버 기반 TTS 개발하기 · 2022-11-02
- [티맵, 3시간 뒤 출발하면 얼마나 걸려?](https://brunch.co.kr/@tmapmobility/20) · 17편 CATCHUp Algorithm · 2023-01-06
- [포켓몬고와 티맵은 내 위치를 어떻게 잡을까?](https://brunch.co.kr/@tmapmobility/21) · 18편 위치 기반 서비스의 이해 및 측위 방법 · 2023-02-13
- [결빙주의! 티맵은 도로 상황 정보를 어떻게 빠르게 알까](https://brunch.co.kr/@tmapmobility/30) · 22편 도로 상황 정보 수집, 가공, 표출 시스템 · 2023-10-11
- [TMAP 대중교통이 티맵 안으로 들어온 이유](https://brunch.co.kr/@tmapmobility/37) · 26편 Reactive Programming으로 재탄생한 대중교통 · 2024-05-09
- [승하차 타이밍을 놓치지 않는 방법](https://brunch.co.kr/@tmapmobility/38) · 27편 대중교통 승하차 알림 · 2024-09-30
- [TMAP AUTO 안전하게 달리다](https://brunch.co.kr/@tmapmobility/40) · 29편 티맵모빌리티의 사이버 보안 이야기 · 2025-05-16
{{< /callout >}}

티맵 글은 지도 데이터를 만드는 쪽, 그 데이터와 실시간 교통정보로 경로를 계산하는 서버 엔진 쪽, 그리고 단말에서 위치를 잡고 안내를 그리는 앱 쪽으로 나뉩니다. 앱과 서버 사이의 통신이 어떻게 유지되는지는 한 글에 모여 있지 않아, 관련 글의 단서를 한데 놓고 진단한 문서를 따로 두었습니다.

원문이 아니라 읽고 재구성한 요약이므로 정확한 내용은 각 문서의 원문 링크에서 확인하시기 바랍니다.
