---
title: "Istio ServiceEntry 자동생성으로 외부 트래픽 가시화하기"
description: "당근 SRE 밋업 4회에서 클러스터 파트가 발표한 Mesh 외부 트래픽 L4 가시화의 요약입니다. CoreDNS 로그에서 호출 도메인을 뽑아 ServiceEntry를 자동으로 만들었고 SNI가 없는 DB 트래픽은 못 봅니다."
date: 2026-10-21
weight: 2
---

# Istio ServiceEntry 자동생성으로 외부 트래픽 가시화하기 (SRE 밋업 4회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Istio ServiceEntry 자동생성으로 외부 트래픽 가시화하기 | 당근 SRE 밋업 4회](https://www.youtube.com/watch?v=Uf4_38HV9JY) (21:32)
- 매체 · 게시일: YouTube 당근 채널 · 2025-10-10
- 발표자: 이시은 (SRE 클러스터 파트, 영상 설명란과 슬라이드 자기소개로 확인). 슬라이드에 Karin이라는 이름이 함께 적혀 있어 [감사 로그 글]({{< relref "/external/daangn/blog/01-kube-apiserver-audit-log.md" >}})의 저자 Karin과 같은 사람으로 보이지만, 이 부분은 슬라이드의 표기에 근거한 추정입니다.
- 근거: YouTube 자동 자막 전체 + 발표 슬라이드
- 이 문서는 영상을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## 주요 구간

- [01:30](https://www.youtube.com/watch?v=Uf4_38HV9JY&t=90s) Istio의 서비스 레지스트리
- [04:00](https://www.youtube.com/watch?v=Uf4_38HV9JY&t=240s) 문제 정의
- [06:00](https://www.youtube.com/watch?v=Uf4_38HV9JY&t=360s) L4와 L7, SNI, TLS origination
- [13:00](https://www.youtube.com/watch?v=Uf4_38HV9JY&t=780s) 주요 도메인 ServiceEntry 수동 생성
- [15:00](https://www.youtube.com/watch?v=Uf4_38HV9JY&t=900s) CoreDNS 로그를 메트릭으로
- [17:30](https://www.youtube.com/watch?v=Uf4_38HV9JY&t=1050s) CronJob 구현과 한계

## 외부 호출에서 보이지 않던 것

당근은 AI 서비스가 늘며 외부 호출이 급증했지만, 서비스별 OpenAI 사용량이나 지연이 외부 호출 때문인지는 확인할 수 없었습니다. 메시 내부 트래픽은 사이드카의 L7 메트릭(`istio_requests_total` 등)으로 자세히 보였습니다. Istio가 제어하는 범위는 서비스 레지스트리에 등록된 대상뿐입니다. OpenAI나 Google API 같은 외부 도메인은 그냥 통과(PassThrough)해 메트릭이 남지 않았습니다.

## L4 관측을 선택하고 ServiceEntry 생성을 자동화

L7까지 보려면 앱이 평문 HTTP로 요청하고 DestinationRule을 설정해 Istio가 TLS를 대신 처리해야 합니다. 당근은 언어와 SDK가 다양하고 코드 변경 때마다 SRE가 Istio 리소스를 관리해야 하는 부담을 고려해, 코드 수정 없이 L4(TCP 연결 단위)만 확보하기로 했습니다. 외부 호스트를 ServiceEntry로 등록하면 Istio가 대상을 인식합니다. HTTPS는 암호화되어 사이드카가 읽을 수 있는 정보가 TLS 핸드셰이크의 SNI뿐이므로, 관측 범위는 L4까지입니다.

Google API, AWS, OpenAI, Pinecone 네 도메인을 수동으로 등록해 TCP 메트릭을 확인한 뒤, 모든 외부 호출을 다루도록 생성을 자동화했습니다. 호출 도메인을 찾을 자료로는 CoreDNS 로그를 골랐습니다. 모든 Pod가 외부 통신 전에 DNS를 질의하기 때문입니다.

CoreDNS 로그는 형식을 간소화한 뒤 Alloy로 Loki에 보내고, recording rule로 메트릭화해 Thanos에 저장합니다. PromQL에서 소스 IP를 네임스페이스·Pod와 조인하면 네임스페이스별 외부 도메인 목록을 얻습니다. 이 목록을 읽는 Go CronJob은 사이드카가 주입된 네임스페이스를 찾고 메시 내부 주소를 제외한 뒤, 기존 ServiceEntry를 확인해 생성하거나 갱신하도록 구현했습니다.

실시간 처리가 필요하지 않았던 이유는 목적이 제어보다 가시성 확보에 있었기 때문입니다. 새 도메인이 자주 생기지 않았고, istiod와 Thanos의 부하도 줄여야 했습니다.

## 확보한 가시성

당근은 아웃바운드 HTTPS 트래픽을 서비스별 TCP 메트릭과 response flag로 확인할 수 있게 되었습니다. TCP connection close 메트릭으로는 외부 연결이 끊길 때 알림을 만들 수 있습니다. 발표에 제시된 정량 수치는 거의 없습니다.

## 관측 한계와 적용 시 주의점

SNI가 있는 트래픽만 볼 수 있습니다. Redis나 MySQL처럼 SNI가 없는 프로토콜은 도메인을 구분할 수 없어, 요청량이 가장 많은 데이터베이스 계열 트래픽은 아직 가시화하지 못했습니다. CoreDNS 로그에는 포트와 프로토콜 정보도 없습니다.

적용 과정에서는 네임스페이스 수백 개와 호스트 수천 개를 한꺼번에 처리할 때 istiod에 생기는 부담을 줄이려고 나눠서 순차 적용했습니다. 다음 과제로 제시한 내용은 비용 추적, 외부 API 급증 대응, DB를 포함한 모든 외부 트래픽의 가시화입니다.

2026년 3월 장애와의 관계는 [옵저버빌리티 발표 요약]({{< relref "/external/daangn/talks/builder-meetup-2026/02-observability-agents.md" >}})에서 다룹니다. 그 발표는 ServiceEntry 자동 관리 로직의 방어 로직 오류를 장애 원인으로 들었습니다. 이 영상의 CronJob과 같은 컴포넌트인지는 영상에서 확인되지 않습니다.

이 사이트의 관련 문서: [Istio]({{< relref "/platform/istio/_index.md" >}})

{{% details title="세부 근거 표" closed="true" %}}

| 항목 | 내용 | 근거 |
|---|---|---|
| 수동 생성 도메인 | openai.com, googleapis.com, amazonaws.com, pinecone.io | 슬라이드 |
| Pinecone 처리 | 인덱스마다 고유 도메인을 사용하므로 `*.pinecone.io` 와일드카드 적용 | 슬라이드 |
| 프록시 체인 | tls_inspector로 SNI 읽기, tcp_proxy로 통과, `istio_tcp_*` 기록 | 슬라이드 |
| CoreDNS 로그 필드 | source_ip, qtype, qname, rcode, duration | 슬라이드 |
| 적용 대상 규모 | 네임스페이스 수백 개, 호스트 수천 개(슬라이드는 자릿수를 가림) | 슬라이드 |
| 구현 형태 | Go CronJob(발표에서는 컨트롤러라고 부름) | 슬라이드와 자막 |

{{% /details %}}
