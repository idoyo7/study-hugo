---
title: "서비스 400개에 공통 모니터링을 제공한 방법"
description: "워크로드가 약 90개에서 약 400개로 늘어난 당근이 공통 서비스 모니터링을 만든 과정을 정리한다. USE·RED 방법론을 대시보드에 적용하고 로그 알림, 담당 팀 호출, 장애 회고까지 연결한 방법을 다룬다."
date: 2026-10-21
weight: 6
---

# 서비스 400개에 공통 모니터링을 제공한 방법 (SRE 밋업 3회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How to Monitor Karrot Services | 3rd Karrot SRE Meetup](https://www.youtube.com/watch?v=3iLTBBC9ZX4) (24:35). 같은 밋업의 한국어 제목 영상(당근마켓 서비스를 모니터링하는 방법)은 채널 검색에서 찾지 못해, 영문 제목으로 올라온 영상의 한국어 음성을 근거로 삼았습니다.
- 매체 · 게시일: YouTube 당근 채널 · 2023-06-27 (슬라이드 표지에 2023.06.15)
- 발표자: 당근마켓 SRE팀 클러스터 파트의 배상익(Aidan). 슬라이드 표지와 자막으로 확인했습니다.
- 근거: YouTube 자동 자막 전체 + 발표 슬라이드
- 발표 영상의 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 서비스별 지표는 팀에 맡기고 공통 영역을 정했다 {#늘어난-서비스를-어디까지-모니터링할-것인가}

2021년 8월 1회 밋업부터 2023년 6월까지 워크로드는 약 90개에서 약 400개로 늘었습니다. HTTP 요청은 초당 75k에서 145k, gRPC 요청은 60k에서 344k, MAU는 1200만에서 1800만으로 증가했습니다. SRE 인원은 조금 늘었을 뿐이어서 광고 클릭률처럼 서비스마다 다른 지표까지 모두 관리할 수는 없었습니다.

당근은 SRE 팀이 모든 서비스에 공통으로 필요한 모니터링을 제공하고, 비즈니스 지표는 개발팀이 Superset 같은 도구로 채우는 경계를 정했습니다.

## 대시보드의 신호를 담당 팀 호출과 회고로 연결했다 {#공통-대시보드에서-알림과-회고까지}

서비스 클러스터는 전사 단일 클러스터로 제공하고 프로젝트마다 네임스페이스를 받아 클러스터처럼 사용합니다. 운영 정책을 바꿀 때는 원페이저에 근거를 적어 토론합니다.

SRE 팀은 공통 영역을 잘 갖추면 개발자가 실수해도 빨리 감지하고 복구할 수 있다고 봤습니다. Brendan Gregg의 USE(사용률·포화·에러), Tom Wilkie의 RED(요청률·에러·지연), SRE 책의 Four Golden Signals를 참고했습니다.

Grafana 대시보드는 네임스페이스별 서비스 화면과 리전 전체 화면으로 나눴습니다. 서비스 화면의 트래픽 그룹은 Istio 메트릭으로 RED를 구현해 호출·피호출 서비스와 응답 플래그를 보여 줍니다. 사용량 그룹은 USE에 따라 CPU, 스로틀링, 메모리, 디스크 IO, 열린 소켓 수를 표시합니다. Kubernetes 그룹에서는 재시작 사유, Pending, 프로브 실패, 가용 영역별 파드 쏠림과 노드 분산을 확인합니다. 배포 시점 Annotation은 [배포 시스템 발표]({{% relref "/external/daangn/talks/sre-meetup-3/02-deployment-system-lessons.md" %}})에서 설명한 이벤트입니다.

메트릭과 로그 스택은 직접 운영합니다. 클러스터별 Prometheus를 Cortex로 모으고 Loki에 로그를 저장한 뒤 Grafana에서 봅니다. Datadog은 이상 감지, APM, 클라우드 연동에 보조로 사용합니다. 비용 때문에 로그는 보내지 않으며 외부 솔루션으로 전부 교체할 계획도 없다고 밝혔습니다.

알림이 의미를 가지려면 정상 상태의 로그가 깨끗해야 한다고 봤습니다. 경고 로그가 쌓이면 개발자에게 알리고, 자주 발생하는 에러 로그는 경고 수준으로 조정해 달라고 요청했습니다. Loki 컨테이너 로그에서 특정 단어를 포함한 에러를 세고, 비용이 큰 쿼리는 recording rule로 미리 계산합니다. 임계값을 넘으면 [AlertDelivery]({{% relref "/external/daangn/talks/sre-meetup-3/08-alertdelivery-grafana.md" %}})가 katalog의 담당 팀과 연결해 온콜을 호출합니다.

원인은 Loki 로그와 Datadog APM으로 조사합니다. 장애 일지는 5 Whys와 교훈 템플릿으로 작성하고 매주 목요일 개발팀 미팅에서 검토합니다. 감지하지 못한 영역은 대시보드나 알림을 만드는 후속 이슈로 남깁니다.

## 모든 서비스가 같은 출발점에서 상태를 확인한다 {#결과}

모든 개발자에게 서비스 단위의 일관된 대시보드를 기본 제공했습니다. Istio, HAProxy, kube-system 닥터 대시보드도 만들어 인프라 문제인지 빠르게 구분하려 했습니다. 같은 대시보드는 용량 계획과 업그레이드 버전을 결정하는 데도 사용합니다.

## 인프라 변경마다 관측 항목도 바꿨다 {#주의할-점}

인프라 구성이 달라지면 모니터링도 보강했습니다. 1분기 OKR로 컨테이너 CPU limit을 없앤 뒤에는 노드 단위 지표를 강화했습니다. Spot 인스턴스를 도입할 때는 파드 eviction 목록을, 로컬리티 로드 밸런싱을 적용할 때는 가용 영역 쏠림 모니터를 추가했습니다.

발표자는 이 구성이 완성된 모범 답안이라는 뜻은 아니며 비교의 출발점으로 공유한다고 밝혔습니다. Loki 운영의 상세는 [Loki 1년 운영기]({{% relref "/external/daangn/talks/sre-meetup-4/01-loki-one-year.md" %}}), 알림의 후속 작업은 [옵저버빌리티 에이전트 발표]({{% relref "/external/daangn/talks/builder-meetup-2026/02-observability-agents.md" %}})에서 이어집니다.

## 주요 구간

- [02:03](https://www.youtube.com/watch?v=3iLTBBC9ZX4&t=123s) 1회 밋업 이후 트래픽과 조직의 변화
- [07:42](https://www.youtube.com/watch?v=3iLTBBC9ZX4&t=462s) 모니터링 방법론: USE, RED, Four Golden Signals
- [10:44](https://www.youtube.com/watch?v=3iLTBBC9ZX4&t=644s) 모니터링 구성 요소
- [13:48](https://www.youtube.com/watch?v=3iLTBBC9ZX4&t=828s) 서비스 대시보드와 서비스 전체 대시보드
- [18:22](https://www.youtube.com/watch?v=3iLTBBC9ZX4&t=1102s) 에러 로그 알림과 장애 일지 회고
- [21:23](https://www.youtube.com/watch?v=3iLTBBC9ZX4&t=1283s) 인프라 변경에 따른 대시보드 보강

{{% details title="근거와 세부 수치" closed="true" %}}

| 항목 | 1회 밋업 시점(2021-08-26) | 2023-06-10 | 근거 |
|---|---|---|---|
| HTTP 요청 | 75k rps | 145k rps | 슬라이드 |
| gRPC 요청 | 60k rps | 344k rps | 슬라이드 |
| MAU | 1200만 | 1800만 | 슬라이드 |
| 워크로드 수 | 약 90개 | 약 400개 | 자막 기준 |

같은 슬라이드의 본문은 HTTP 145k, Grafana 캡처는 HTTP 약 69K, gRPC 약 344K로 HTTP 값이 다릅니다. 발표에서 차이를 설명하지 않아 요약에는 본문 값을 썼습니다. 자막의 "초당 35만 건"은 gRPC 344k를 가리키는 것으로 보입니다.

| 항목 | 내용 | 근거 |
|---|---|---|
| 메인 메트릭 스택 | Prometheus, Cortex, Loki, Grafana | 슬라이드, 자막 |
| 보조 | Datadog(APM, 이상 감지, 클라우드 연동), 로그는 미전송 | 자막 기준 |
| 에러 로그 알림 | Loki 컨테이너 로그에서 단어 매칭, recording rule로 사전 계산 | 슬라이드, 자막 |
| 장애 일지 | 5 Whys와 교훈 템플릿, 매주 목요일 리뷰 | 슬라이드, 자막 |
| 주요 언어 | Node.js, Java, Go, Ruby on Rails, Python | 슬라이드 |
| 메트릭 방법론 | USE(Gregg), RED(Wilkie), Four Golden Signals(SRE 책) | 슬라이드 |

발표자 이름은 자막에 "배상익", 슬라이드에 Aidan으로 나옵니다. Notion 목록의 클러스터 파트 표기와도 일치합니다. 영상에서 인용한 Datadog 서비스 카탈로그 등 외부 화면은 요약에서 제외했습니다.

{{% /details %}}
