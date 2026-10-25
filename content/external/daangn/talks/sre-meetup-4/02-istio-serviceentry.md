---
title: "CoreDNS 로그로 ServiceEntry를 생성해 외부 HTTPS 호출 관측하기"
description: "당근이 외부 도메인 목록을 수집하고 ServiceEntry 생성을 자동화한 사례입니다. 코드 변경 없이 확보한 TCP 메트릭과 SNI·DNS 로그만으로는 확인하기 어려운 범위를 요약합니다."
date: 2026-10-21
weight: 2
---

# CoreDNS 로그로 ServiceEntry를 생성해 외부 HTTPS 호출 관측하기 (SRE 밋업 4회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Istio ServiceEntry 자동생성으로 외부 트래픽 가시화하기 | 당근 SRE 밋업 4회](https://www.youtube.com/watch?v=Uf4_38HV9JY) (21:32)
- 매체 · 게시일: YouTube 당근 채널 · 2025-10-10
- 발표자: 이시은 (SRE 클러스터 파트, 영상 설명란과 슬라이드 자기소개로 확인). 슬라이드에 Karin이라는 이름이 함께 적혀 있어 [감사 로그 글]({{< relref "/external/daangn/blog/01-kube-apiserver-audit-log.md" >}})의 저자 Karin과 같은 사람으로 보이지만, 이 부분은 슬라이드의 표기에 근거한 추정입니다.
- 근거: YouTube 자동 자막 전체 + 발표 슬라이드
- 발표 영상의 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 서비스별 외부 호출을 구분하기 어려웠다 {#외부-호출에서-보이지-않던-것}

AI 서비스가 늘며 외부 호출도 급증했지만, 당근은 서비스별 OpenAI 사용량이나 외부 호출이 지연에 미치는 영향을 확인하기 어려웠습니다. 메시 내부는 `istio_requests_total` 같은 sidecar의 L7 메트릭으로 관측하고 있었습니다.

서비스 레지스트리에 없는 OpenAI·Google API 등의 도메인은 PassThrough로 처리돼, 발표에서 필요로 한 외부 대상별 메트릭을 얻지 못했습니다. 외부 호스트를 Istio가 구분할 수 있게 등록하는 작업이 필요했습니다.

## 애플리케이션 변경 없이 TCP 메트릭 확보하기 {#l4-관측을-선택하고-serviceentry-생성을-자동화}

L7 관측을 하려면 애플리케이션은 평문 HTTP로 요청하고 Istio가 DestinationRule에 따라 TLS를 처리하도록 바꿔야 했습니다. 다양한 언어·SDK를 수정하고 SRE가 리소스를 관리하는 부담 때문에 팀은 코드 변경 없이 L4, 즉 TCP 연결 단위의 정보를 확보하기로 했습니다. ServiceEntry로 호스트를 등록해도 HTTPS 본문은 암호화돼 있으며, 도메인을 구분할 때는 TLS 핸드셰이크의 SNI를 사용합니다.

Google API·AWS·OpenAI·Pinecone 도메인을 수동 등록해 메트릭을 확인한 뒤 생성 작업을 자동화했습니다. Pod가 외부 도메인에 연결하기 전에 남기는 DNS 질의를 이용하려고 CoreDNS 로그를 선택했습니다.

형식을 간소화한 로그를 Alloy에서 Loki로 보내고 recording rule로 메트릭을 만들어 Thanos에 저장합니다. PromQL에서 소스 IP와 네임스페이스·Pod를 조인해 네임스페이스별 외부 도메인을 구합니다. Go CronJob은 sidecar가 있는 네임스페이스를 찾고 내부 주소를 제외한 다음, 기존 ServiceEntry를 확인해 생성·갱신합니다.

새 도메인이 자주 추가되지 않고 목적도 실시간 제어보다 관측에 있었으므로 주기 실행을 택했습니다. istiod와 Thanos의 부하를 줄이려는 이유도 있었습니다.

## 외부 연결의 메트릭과 response flag 확인 {#확보한-가시성}

도입 후에는 아웃바운드 HTTPS 연결을 서비스별 TCP 메트릭과 response flag로 확인할 수 있게 됐습니다. TCP connection close 메트릭을 이용하면 외부 연결 종료에 대한 알림도 만들 수 있습니다. 발표에는 도입 전후를 비교할 정량 수치가 거의 없습니다.

## SNI가 없는 DB 호출과 대량 설정 적용의 한계 {#관측-한계와-적용-시-주의점}

도메인 구분은 SNI가 있는 트래픽에서만 가능합니다. Redis·MySQL처럼 SNI가 없는 프로토콜은 구분하지 못해, 요청이 가장 많던 데이터베이스 계열 트래픽은 관측 범위에 포함하지 못했습니다. CoreDNS 로그만으로는 포트·프로토콜도 알 수 없습니다.

네임스페이스 수백 개와 호스트 수천 개를 적용할 때는 istiod 부하를 줄이려고 나눠서 순차 처리했습니다. 비용 추적, 외부 API 호출 급증 대응, DB를 포함한 외부 트래픽 관측은 이후 과제로 남았습니다.

[2026년 옵저버빌리티 발표]({{< relref "/external/daangn/talks/builder-meetup-2026/02-observability-agents.md" >}})는 ServiceEntry 자동 관리 로직의 오류를 3월 장애 원인으로 설명합니다. 하지만 그 로직과 이 발표의 CronJob이 동일한 컴포넌트인지는 확인되지 않습니다. 관련 개념은 이 사이트의 [Istio 문서]({{< relref "/platform/istio/_index.md" >}})에서도 다룹니다.

## 주요 구간

- [01:30](https://www.youtube.com/watch?v=Uf4_38HV9JY&t=90s) Istio의 서비스 레지스트리
- [04:00](https://www.youtube.com/watch?v=Uf4_38HV9JY&t=240s) 문제 정의
- [06:00](https://www.youtube.com/watch?v=Uf4_38HV9JY&t=360s) L4와 L7, SNI, TLS origination
- [13:00](https://www.youtube.com/watch?v=Uf4_38HV9JY&t=780s) 주요 도메인 ServiceEntry 수동 생성
- [15:00](https://www.youtube.com/watch?v=Uf4_38HV9JY&t=900s) CoreDNS 로그를 메트릭으로
- [17:30](https://www.youtube.com/watch?v=Uf4_38HV9JY&t=1050s) CronJob 구현과 한계

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
