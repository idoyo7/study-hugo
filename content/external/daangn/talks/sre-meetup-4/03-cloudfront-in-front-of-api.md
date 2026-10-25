---
title: "API 앞에 CloudFront를 두고 연결 지연과 전송 비용 줄이기"
description: "당근이 캐시 없는 CloudFront 프록시를 API 앞에 도입한 사례입니다. keep-alive 조정, 북미 지표의 변화, 약정 단가와 요청 메서드에 따른 비용 조건을 요약합니다."
date: 2026-10-21
weight: 3
---

# API 앞에 CloudFront를 두고 연결 지연과 전송 비용 줄이기 (SRE 밋업 4회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [API 앞단에 CloudFront를 세우다: 더 빠르고 더 단단하게 | 당근 SRE 밋업 4회](https://www.youtube.com/watch?v=02UhM4wiSZg) (36:51)
- 매체 · 게시일: YouTube 당근 채널 · 2025-10-10
- 발표자: 배상익(속도), 홍성택(비용·보안). 영상 설명란으로 확인했습니다.
- 근거: YouTube 자동 자막 전체 + 발표 슬라이드
- 발표 영상의 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 캐나다 서부의 연결 지연과 늘어나는 전송 비용 {#지연과-네트워크-비용이-도입-배경}

캐나다 전국 출시를 앞둔 당근은 토론토 리전에서 서부 사용자까지의 거리를 우려했습니다. 네트워크 비용도 2023년 말부터 선형으로 증가했고, 응답 크기를 줄이고 압축해도 부담이 남았습니다.

이미지 서빙을 GCP로 옮긴 뒤에는 CloudFront 약정(CFRC) 물량과 할인 단가에 여유가 생겼습니다. 팀은 기술 문서를 검토하고 API의 연결 시간·전송 비용·보안을 개선하는 도입안을 검토했습니다.

## 엣지에서 연결을 맺고 오리진 연결은 재사용 {#캐시-없이-엣지-프록시로-도입}

밴쿠버와 토론토의 RTT가 50~80ms일 때 TLS 1.2 핸드셰이크에는 150~240ms가 걸립니다. 팀은 캐시를 끈 CloudFront를 API 앞에 두어 사용자가 가까운 엣지와 TCP/TLS 연결을 맺도록 했습니다. 엣지는 오리진인 NLB·HAProxy와의 연결을 재사용합니다.

Route 53 가중치 라우팅으로 점진 적용했지만 처음에는 TTFB와 전체 리소스 로딩 시간이 늘어 롤백까지 검토했습니다. 원인은 CloudFront의 기본 keep-alive timeout인 5초였습니다. 이를 HAProxy의 60초보다 짧은 50초로 늘리자 오리진의 새 연결 비율이 줄고 속도가 개선됐습니다.

비용은 정가보다 약정 egress 단가와 메서드 비율을 기준으로 추산했습니다. 발표는 GET/HEAD의 오리진 방향 전송은 무료이고 다른 메서드에는 요청 과금이 붙는다고 설명합니다. 팀은 HAProxy 로그에서 메서드 분포를 확인했습니다.

보안에는 CloudFront의 AWS WAF를 적용했습니다. 작은 요청이 많은 API에서 요청당 과금이 부담이 됐고, 웹사이트 트래픽과 간헐적 DDoS 증가를 계기로 도입한 Shield Advanced를 연동했습니다. 발표에서 설명한 비용 구조는 WAF 요청당 과금에서 GB당 과금으로의 변경입니다. Shield Advanced는 계정 단위로 적용하며 월 정액과 1년 약정 조건이 있었습니다.

## 연결은 빨라졌지만 TTFB는 높게 남았다 {#연결-시간과-비용은-줄고-ttfb는-소폭-증가}

북미 initial connection의 중앙값은 107ms에서 62.49ms로 줄었습니다. 슬라이드는 이를 45% 감소로 정리했습니다. 밴쿠버 클라이언트 도식의 TLS 시간도 60ms에서 37ms로 줄었고, 전송 비용은 예상한 수준인 약 20% 감소했습니다.

한국에서는 속도에 유의미한 차이가 없었습니다. keep-alive 조정 뒤에도 TTFB는 적용 전보다 조금 높았습니다. 연결 시간만으로 전체 응답이 빨라졌다고 볼 수 없으며, 적용 직후와 2025년 3월의 지표를 아래 표에서 구분했습니다.

## 프로토콜·관측·요금 조건의 변화 {#도입-시-확인할-제약}

발표 당시 CloudFront와 오리진 구간은 HTTP/1.1을 사용해 h2·h3가 다운그레이드됐습니다. 당근 API에는 영향이 작았다고 설명합니다. 클라이언트 소켓이 직접 보이지 않으면서 앱 버전별 비정상 종료를 추적하던 정보는 잃었습니다. CloudFront 도메인을 다른 CloudFront의 오리진으로 지정하면 403이 발생하는 제약도 있었습니다.

비용 절감은 메서드 구성에 따라 달라집니다. 당근은 PUT/POST 비율이 30%만 더 높아도 절감이 사라지거나 비용이 늘 수 있다고 보고 계속 감시했습니다. 대용량 다운로드에는 GB 과금이 불리해 Shield 연동을 선택적으로 적용했습니다. 가격과 지원 조건은 발표 당시 사례의 전제입니다.

## 주요 구간

- [02:00](https://www.youtube.com/watch?v=02UhM4wiSZg&t=120s) 문제 정의와 세 가지 목표
- [06:30](https://www.youtube.com/watch?v=02UhM4wiSZg&t=390s) RTT와 엣지 프록시 설계
- [13:00](https://www.youtube.com/watch?v=02UhM4wiSZg&t=780s) 도입 구조와 카나리 배포
- [16:00](https://www.youtube.com/watch?v=02UhM4wiSZg&t=960s) 속도 결과와 keep-alive 문제
- [22:30](https://www.youtube.com/watch?v=02UhM4wiSZg&t=1350s) 비용
- [27:00](https://www.youtube.com/watch?v=02UhM4wiSZg&t=1620s) WAF와 Shield

{{% details title="슬라이드 기준 지표 표 (북미, 적용 전 → 적용 직후 → 2025년 3월)" closed="true" %}}

| 지표 | 구분 | 적용 전 | 적용 직후 | 2025년 3월 |
|---|---|---|---|---|
| initial connection | median | 107ms | 해당 없음 | 62.49ms (-45%) |
| initial connection | p75 | 170ms | 해당 없음 | 99ms (-41%) |
| initial connection | p90 | 279ms | 해당 없음 | 176ms (-36%) |
| DNS lookup | median | 30.7ms | 34.5ms (+12%) | 22ms (-26%) |
| TTFB | median | 49.2ms | 54ms (+10%) | 52ms (+6%) |
| TTFB | p75 | 117ms | 142ms (+21%) | 125ms (+6%) |
| TTFB | p90 | 204ms | 265ms (+29%) | 229ms (+12%) |
| Total Resource Duration | median | 144ms | 159ms (+10%) | 133ms (-7%) |
| Total Resource Duration | p75 | 230ms | 262ms (+14%) | 220ms (-4%) |
| Total Resource Duration | p90 | 377ms | 420ms (+11%) | 349ms (-7%) |

| 기타 항목 | 값 | 근거 |
|---|---|---|
| 비용 절감 | 예상 10~20%, 정리 슬라이드는 20% | 슬라이드 |
| AWS WAF 요금 | 100만 요청당 $0.60 | 슬라이드 |
| keep-alive timeout | 5초 → 50초 | 슬라이드 |
| WAF 표준 규칙 순서 | IP deny list, IP rate limit, Core Rule Set, DDoS managed rule, Shield 자동 룰 | 자막 기준 |

자막의 initial connection 값은 107ms와 103ms가 섞여 있지만, 103ms는 대시보드 캡처값이어서 슬라이드 요약값을 사용했습니다.

{{% /details %}}
