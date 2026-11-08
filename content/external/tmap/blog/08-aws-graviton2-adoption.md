---
title: "경로탐색 엔진 모듈별 Graviton2 교체 결과"
description: "티맵 경로탐색 엔진의 세 모듈을 Graviton2 인스턴스로 바꿔 보고 모듈마다 다르게 결정한 과정을 정리했습니다. 인스턴스 가격과 소요 시간 비교 수치를 요약합니다."
date: 2026-11-08
weight: 8
---

# 경로탐색 엔진 모듈별 Graviton2 교체 결과 (2022-05)

{{< callout type="info" >}}
**원문 정보**
- 원문: [AWS Graviton2 출시 후 바로 도입해본 후기](https://brunch.co.kr/@tmapmobility/14)
- 부제: 11편 – 가격 대비 성능 40% 향상..은 못 참지!
- 매체 · 게시일: 티맵모빌리티 테크노트(브런치) · 2022-05-25
- 저자: 티맵모빌리티 (본문에 저자 미표기)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 도입 계기와 엔진 환경 {#도입-계기}

티맵의 신규 경로탐색 엔진 Thor는 AWS에서 서비스됩니다. 개발한 지 오래되지 않아 환경도 비교적 최신입니다. 언어는 Amazon Corretto 11 기반 Java 11, 프레임워크는 Spring Boot 2.x, 인프라는 Elastic Beanstalk과 EC2입니다. 엔진 알고리즘은 [CCH 경로탐색 엔진 글]({{< relref "/external/tmap/blog/02-cch-routing-engine-thor.md" >}})에서 다룹니다.

계기는 우연이었습니다. AWS 콘솔에 들어갈 때마다 Graviton2(ARM64) 기반 장비 소식이 떴고, 기존 x86 장비보다 가격 대비 성능이 40% 좋다는 내용이었습니다. 엔진이 JVM 위에서 돌아 OS 의존성이 없으니 바꾸지 않을 이유가 없다고 봤습니다. 원문은 AWS 한국 블로그의 사례도 인용합니다. ElastiCache는 최대 45%, RDS는 최대 52% 나은 가격 대비 성능이라고 했고, Netflix는 M5보다 50% 개선된 성능을 확인했다고 합니다.

## 세 모듈의 구성 {#모듈-구성}

Thor는 세 모듈로 나뉩니다. preprocessor는 EC2를 켜고 끄는 방식으로, 약 2주마다 맵 데이터를 변환하고 경로탐색용으로 최적화합니다. customizer는 Elastic Beanstalk에서 1분, 5분 단위로 바뀐 맵 데이터의 변경분을 최적화합니다. route-planning은 Elastic Beanstalk에서 사용자 요청에 최적 경로를 찾아 주는 웹서버입니다.

특성이 달라 모듈별로 시험한 뒤 적용하기로 했습니다. Beanstalk 환경설정 파일을 소스로 관리하고 있어서 InstanceTypes만 고치면 돼 적용은 빨랐습니다.

## preprocessor를 그대로 둔 이유 {#preprocessor}

병렬 처리가 많아 vCPU가 가장 큰 인스턴스를 쓰는 작업입니다. 세대별 최대 vCPU 장비인 c5.24xlarge와 c6g.16xlarge를 비교했습니다. CPU를 거의 다 쓰는 병렬 작업인 그래프 파티셔닝은 약 48분에서 43분으로 줄었습니다. 반대로 순차 작업은 느려져서 전체는 71분에서 77분이 됐습니다. 비용 대비 성능은 약 47% 개선으로 계산됩니다.

그래도 c5.24xlarge를 유지했습니다. 이 인스턴스는 평소 Stopped 상태로 두고 필요할 때만 켜서 쓰기 때문에 비용 이점이 크지 않다는 이유입니다.

## customizer와 route-planning의 교체 {#교체}

customizer는 순간적으로 높은 성능이 필요한 병렬 작업과 많은 메모리 때문에 범용 인스턴스를 씁니다. m5.4xlarge에서 m6g.4xlarge로 바꾸자 병렬 customization은 7초에서 11초로 느려지고, 압축과 내보내기는 15초에서 11초로 빨라졌습니다. 전체는 약 30초로 비슷했고 가격이 낮아 비용 대비 성능은 약 20% 개선됐습니다. 그래서 교체했습니다.

route-planning은 IO보다 CPU 연산이 많은 웹 애플리케이션입니다. 내부에 map-matching, 경로 탐색, 경로 안내, protobuffer 처리가 들어 있습니다. 사내에서 쓰는 nGrinder로 m5.2xlarge와 m6g.2xlarge를 비교하자 성능은 13~16% 올랐고 비용은 20% 줄었습니다. 비용 대비 성능으로는 약 35~40% 개선이어서 m6g.2xlarge로 바꿨습니다.

원문은 장비 교체만으로 비용 대비 성능이 약 2~40% 좋아졌다고 정리합니다. JVM 언어라 쉽게 바꿨으니 네이티브 언어를 쓴다면 더 면밀히 시험하라고 덧붙이고, Graviton3에 대한 기대도 적었습니다.

{{% details title="모듈별 비교 수치" closed="true" %}}

| 모듈 | 비교 인스턴스 (시간당 USD) | 소요 시간 또는 성능 | 비용 대비 성능 | 결정 |
|---|---|---|---|---|
| preprocessor | c5.24xlarge 96vCPU 4.608 → c6g.16xlarge 64vCPU 2.464 | 전체 71분 → 77분, 파티셔닝 약 48분 → 43분 | 약 47% 개선 | c5.24xlarge 유지 |
| customizer | m5.4xlarge 16vCPU 0.944 → m6g.4xlarge 16vCPU 0.752 | customization 7초 → 11초, 압축·내보내기 15초 → 11초, 전체 약 30초 | 약 20% 개선 | m6g.4xlarge 교체 |
| route-planning | m5.2xlarge 8vCPU 0.472 → m6g.2xlarge 8vCPU 0.376 | 성능 13~16% 향상, 비용 20% 절감 | 약 35~40% 개선 | m6g.2xlarge 교체 |

{{% /details %}}
