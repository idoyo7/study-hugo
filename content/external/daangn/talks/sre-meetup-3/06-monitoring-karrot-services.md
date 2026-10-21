---
title: "당근마켓 서비스를 모니터링하는 방법"
description: "당근 SRE 밋업 3회에서 클러스터 파트가 소개한 서비스 모니터링 방식의 요약입니다. 공통 모니터링 영역을 먼저 정하고, USE와 RED 방법론을 Prometheus와 Grafana 대시보드로 구현해 Alert Delivery와 이어 붙인 과정을 다룹니다."
date: 2026-10-21
weight: 6
---

# 당근마켓 서비스를 모니터링하는 방법 (SRE 밋업 3회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How to Monitor Karrot Services | 3rd Karrot SRE Meetup](https://www.youtube.com/watch?v=3iLTBBC9ZX4) (24:35). 같은 밋업의 한국어 제목 영상(당근마켓 서비스를 모니터링하는 방법)은 채널 검색에서 찾지 못해, 영문 제목으로 올라온 영상의 한국어 음성을 근거로 삼았습니다.
- 매체 · 게시일: YouTube 당근 채널 · 2023-06-27 (슬라이드 표지에 2023.06.15)
- 발표자: 당근마켓 SRE팀 클러스터 파트의 배상익(Aidan). 슬라이드 표지와 자막으로 확인했습니다.
- 근거: YouTube 자동 자막 전체 + 발표 슬라이드
- 이 문서는 영상을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## 주요 구간

- [02:03](https://www.youtube.com/watch?v=3iLTBBC9ZX4&t=123s) 1회 밋업 이후 트래픽과 조직의 변화
- [07:42](https://www.youtube.com/watch?v=3iLTBBC9ZX4&t=462s) 모니터링 방법론: USE, RED, Four Golden Signals
- [10:44](https://www.youtube.com/watch?v=3iLTBBC9ZX4&t=644s) 모니터링 구성 요소
- [13:48](https://www.youtube.com/watch?v=3iLTBBC9ZX4&t=828s) 서비스 대시보드와 서비스 전체 대시보드
- [18:22](https://www.youtube.com/watch?v=3iLTBBC9ZX4&t=1102s) 에러 로그 알림과 장애 일지 회고
- [21:23](https://www.youtube.com/watch?v=3iLTBBC9ZX4&t=1283s) 인프라 변경에 따른 대시보드 보강

## 늘어난 서비스를 어디까지 모니터링할 것인가

1회 밋업이 열린 2021년 8월 이후 2023년 6월까지, 워크로드(서비스 단위)는 약 90개에서 약 400개로 늘었습니다. 같은 기간 HTTP 요청은 초당 75k에서 145k, gRPC 요청은 초당 60k에서 344k로 늘었고, MAU는 1200만에서 1800만이 됐습니다. SRE 인원은 조금 늘었을 뿐입니다. 커진 규모를 감당해야 하는 상황에서 광고 클릭률처럼 서비스마다 다른 지표까지 SRE 팀이 모두 맡을 수는 없었습니다.

## 공통 대시보드에서 알림과 회고까지

먼저 클러스터 운영 정책에 합의했습니다. 서비스 클러스터는 멀티 테넌시로 나누지 않고 전사 단일 클러스터로 제공하며, 프로젝트마다 네임스페이스를 받아 클러스터처럼 쓰게 합니다. 정책을 바꾸려면 원페이저에 근거를 담아 토론합니다.

SRE 팀은 이 정책 위에서 모든 서비스에 공통으로 필요한 모니터링 영역을 정하고 기본을 갖추는 데 집중했습니다. 공통 영역을 잘 갖추면 개발자가 실수해도 빨리 감지하고 회복할 수 있다는 SRE 팀의 믿음입니다. 그 밖의 비즈니스 지표는 개발팀이 Superset 같은 도구로 채웁니다.

모니터링 방법론은 Brendan Gregg의 USE(사용률, 포화, 에러), Tom Wilkie의 RED(요청률, 에러, 지연), SRE 책의 Four Golden Signals를 참고했습니다. 대시보드는 네임스페이스 기준의 서비스 대시보드와 리전 전체를 보는 서비스 전체 대시보드로 나눴습니다. 서비스 대시보드는 트래픽, 사용량, Kubernetes의 세 그룹으로 구성합니다.

- 트래픽 그룹: RED를 구현하고 Istio 메트릭으로 호출한 서비스, 받은 서비스, 응답 플래그 표시
- 사용량 그룹: USE에 맞춰 CPU, CPU 스로틀링, 메모리, 디스크 IO, 열린 소켓 수 확인
- Kubernetes 그룹: 재시작 사유, Pending, 프로브 실패, 가용 영역별 파드 쏠림과 노드 분산 확인

배포 시점 어노테이션은 [배포 시스템 발표]({{% relref "/external/daangn/talks/sre-meetup-3/02-deployment-system-lessons.md" %}})에서 소개한 기능입니다.

메트릭·로그 스택은 직접 운영합니다. 클러스터별 로컬 Prometheus를 Cortex로 모으고, 로그는 Loki에 저장하며 Grafana로 시각화합니다. Datadog은 이상 감지, APM, 클라우드 연동에 보조로 씁니다. 비용 때문에 로그는 보내지 않으며, 외부 솔루션으로 전부 대체할 계획도 없다고 합니다.

알림이 효과를 내려면 평소 정상 상태를 깨끗이 유지해야 한다고 봤습니다. 경고 로그가 쌓이면 개발자에게 알리고, 에러 로그가 자주 튀면 경고 수준으로 내려 달라고 요청합니다. Loki의 컨테이너 로그에서 특정 단어가 포함된 에러 로그를 세되, 부하가 큰 쿼리는 recording rule로 미리 계산합니다. 임계값을 넘으면 [AlertDelivery]({{% relref "/external/daangn/talks/sre-meetup-3/08-alertdelivery-grafana.md" %}})가 katalog와 매핑해 해당 팀의 온콜을 호출합니다.

장애 원인은 Loki 로그와 Datadog APM으로 찾습니다. 장애 일지는 5 Whys와 교훈 템플릿으로 작성해 매주 목요일 개발팀 미팅에서 리뷰합니다. 감지하지 못한 영역은 대시보드와 알림을 구축하는 후속 이슈로 남깁니다.

## 결과

- 모든 개발자에게 서비스 단위의 일관된 대시보드를 기본 제공
- 인프라 이슈인지 빠르게 가리기 위한 Istio, HAProxy, kube-system 닥터 대시보드 구축 중
- 용량 계획과 업그레이드 버전 결정에도 대시보드 활용

## 주의할 점

당근은 인프라를 바꿀 때마다 모니터링도 보강합니다. 1분기 OKR로 컨테이너 CPU limit을 해제한 뒤에는 노드 단위 모니터링을 보강했습니다. Spot 인스턴스 도입 때는 파드 eviction 목록 대시보드를, 로컬리티 로드 밸런싱 적용 때는 가용 영역 쏠림 모니터를 추가했습니다.

발표자는 자신들이 잘한다는 뜻으로 소개한 것은 아니며, 비교의 출발점이 되기를 바란다고 밝혔습니다. Loki 기반 로그 모니터링의 상세는 [Loki 1년 운영기]({{% relref "/external/daangn/talks/sre-meetup-4/01-loki-one-year.md" %}})에서, 알림의 후속 내용은 [AlertDelivery 후속 발표]({{% relref "/external/daangn/talks/builder-meetup-2026/02-observability-agents.md" %}})에서 이어집니다.

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
