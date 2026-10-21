---
title: "API 앞단에 CloudFront를 세우다"
description: "당근 SRE 밋업 4회에서 발표한 API 앞단 CloudFront 도입기의 요약입니다. 캐나다에서 initial connection 시간이 중앙값 기준 45% 줄었고 트래픽 비용은 약 20% 절감되었으며 WAF와 Shield로 보안도 보강했습니다."
date: 2026-10-21
weight: 3
---

# API 앞단에 CloudFront를 세우다 (SRE 밋업 4회)

{{< callout type="info" >}}
**원문 정보**
- 원문: [API 앞단에 CloudFront를 세우다: 더 빠르고 더 단단하게 | 당근 SRE 밋업 4회](https://www.youtube.com/watch?v=02UhM4wiSZg) (36:51)
- 매체 · 게시일: YouTube 당근 채널 · 2025-10-10
- 발표자: 배상익(속도), 홍성택(비용·보안). 영상 설명란으로 확인했습니다.
- 근거: YouTube 자동 자막 전체 + 발표 슬라이드
- 이 문서는 영상을 읽고 재구성한 요약이며 원문 자체가 아닙니다.
{{< /callout >}}

## 주요 구간

- [02:00](https://www.youtube.com/watch?v=02UhM4wiSZg&t=120s) 문제 정의와 세 가지 목표
- [06:30](https://www.youtube.com/watch?v=02UhM4wiSZg&t=390s) RTT와 엣지 프록시 설계
- [13:00](https://www.youtube.com/watch?v=02UhM4wiSZg&t=780s) 도입 구조와 카나리 배포
- [16:00](https://www.youtube.com/watch?v=02UhM4wiSZg&t=960s) 속도 결과와 keep-alive 문제
- [22:30](https://www.youtube.com/watch?v=02UhM4wiSZg&t=1350s) 비용
- [27:00](https://www.youtube.com/watch?v=02UhM4wiSZg&t=1620s) WAF와 Shield

## 지연과 네트워크 비용이 도입 배경

캐나다 전국 오픈을 앞둔 당근은 토론토 리전 하나뿐인 상황에서 서부 사용자의 지연을 우려했습니다. 네트워크 비용도 2023년 말부터 선형으로 늘었고, 응답 크기를 줄이고 압축을 적용한 뒤에도 높았습니다.

이미지 서빙의 GCP 이전으로 CloudFront 약정(CFRC) 물량과 할인 단가에 여유가 생긴 점도 도입 배경입니다. 팀은 기술 문서 리뷰를 거쳐 속도, 비용, 보안을 목표로 잡았습니다.

## 캐시 없이 엣지 프록시로 도입

밴쿠버에서 토론토까지 RTT가 50~80ms면 TLS 1.2 핸드셰이크에만 150~240ms가 듭니다. 당근은 이 시간을 줄이려고 API 도메인 앞에 캐시를 끈 CloudFront 프록시를 뒀습니다. 사용자는 가까운 엣지에서 TCP/TLS 핸드셰이크를 마치고, 엣지는 오리진(NLB와 HAProxy)과의 연결을 재사용하는 방식입니다.

Route 53 가중치 라우팅으로 카나리 배포를 시작했지만, TTFB와 전체 리소스 로딩 시간이 늘어 롤백까지 검토했습니다. 원인은 CloudFront의 기본 keep-alive timeout 5초였습니다. 이를 HAProxy의 60초보다 짧은 50초로 늘리자 오리진의 신규 연결 비율이 내려가며 속도가 개선됐습니다.

비용 절감은 CloudFront 정가가 더 비싸더라도 약정으로 낮춘 egress 단가라면 가능하리라는 가설에서 출발했습니다. GET/HEAD는 오리진 방향 전송이 무료이고 다른 메서드에는 요청 과금이 붙습니다. 팀은 HAProxy 로그에서 메서드 비율을 확인해 절감 폭을 추산했습니다.

CloudFront에 AWS WAF를 붙여 엣지에서 차단했지만, 작은 요청이 많은 API에서는 요청당 과금 부담이 컸습니다. 웹사이트 트래픽 증가와 간헐적 DDoS를 계기로 도입한 Shield Advanced를 연동하자 WAF 과금이 요청당에서 GB당으로 바뀌었습니다. Shield Advanced는 계정 단위로 적용되며, 월 정액에 1년 약정입니다.

## 연결 시간과 비용은 줄고 TTFB는 소폭 증가

- 북미 initial connection 중앙값: 107ms → 62.49ms, 45% 감소
- TLS 시간: 60ms → 37ms(밴쿠버 클라이언트 도식)
- 트래픽 비용: 예상대로 약 20% 절감

한국에서는 속도에 유의미한 차이가 없었습니다. keep-alive를 조정한 뒤에도 TTFB는 적용 전보다 약간 높습니다.

## 도입 시 확인할 제약

- CloudFront와 오리진 사이는 HTTP/1.1이어서 h2와 h3가 다운그레이드됨. 당근 API에서는 영향이 작다고 설명
- 클라이언트 소켓이 보이지 않아 앱 버전별 비정상 종료를 추적하던 관측성 상실
- CloudFront의 오리진으로 다시 CloudFront 도메인을 지정하면 403 발생
- PUT/POST 비율이 30%만 더 높았어도 절감이 없거나 비용이 늘 수 있어 당근은 계속 모니터링
- 대용량 다운로드 서비스는 GB 과금이 불리해 Shield 연동을 선택적으로 적용

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
