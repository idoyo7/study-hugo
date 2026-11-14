---
title: "Cloudflare URL Scanner의 신기능과 구현 구조"
description: "Cloudflare URL Scanner의 Security Center 통합과 공식 API 신기능, Workers·Durable Objects·Browser Rendering API로 스캔 파이프라인을 만든 구조를 정리했습니다. 브라우저 재사용 풀과 Queues 배치 쓰기 같은 설계 변경도 다룹니다."
date: 2026-11-14
weight: 10
---

# Cloudflare URL Scanner의 신기능과 구현 구조 (2024-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Cloudflare's URL Scanner, new features, and the story of how we built it](https://blog.cloudflare.com/building-urlscanner)
- 매체 · 게시일: The Cloudflare Blog · 2024-03-08
- 저자: Sofia Cardita, Alexandra Moraru
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## URL Scanner 소개와 신기능 {#overview}

URL Scanner는 악성 웹사이트를 스캔하고 분석해 보안팀부터 일반 사용자까지 방어하게 돕는 도구입니다. 지난해 3월 Cloudflare Radar에 출시된 뒤 거의 100만 건의 스캔을 수행했고, 그동안 비공개 스캔(unlisted), 악성 판정 상세, 검색 기능 강화를 넣었으며 이번에 Security Center 통합과 공식 API를 추가했습니다. 모두 Cloudflare Workers, Durable Objects, Browser Rendering API 위에 지었습니다.

Cloudflare 대시보드의 Security Center는 공격 표면을 파악하고 보안 위험을 완화하는 곳으로, Investigate Portal에서 URL Scanner를 바로 쓸 수 있습니다. 스캔은 기본적으로 비공개이고, 사용자는 이전 스캔과 보고서를 다시 보며, 여러 화면 크기의 스크린샷을 자동으로 받습니다. 대시보드 접근이 있는 고객은 더 높은 API 한도와 빠른 응답을 얻습니다.

API로는 피싱·악성코드 위험 검사와 웹사이트 기술 분석 같은 맞춤 스캔을 할 수 있습니다. 새로 생긴 옵션은 User-Agent나 Authorization 같은 사용자 지정 HTTP 헤더, 모바일·데스크톱 등 여러 기기 스크린샷, 공개 범위를 unlisted로 두는 것입니다. unlisted는 스캔을 비공개로 표시해 조사를 숨기려는 개발자들이 자주 요청한 기능이고, 공개 스캔은 누구나 검색해 찾을 수 있어 커뮤니티와 결과를 나누기 좋습니다. 스캔이 끝나면 최종 보고서와 전체 네트워크 로그를 받고, 사이트의 악성 여부를 나타내는 `verdict` 속성과 CSP 또는 SRI 정책 위반을 담은 `securityViolations` 섹션이 새로 들어갔습니다. 판정 정확도는 앞으로 개선할 영역이라고 밝힙니다.

검색은 호스트 이름, 특정 URL, 스캔 중 페이지가 연결한 어떤 URL로도 할 수 있습니다. 예를 들어 `?path=jquery.min.js`로 해당 자바스크립트 라이브러리를 쓰는 사이트를 찾습니다. 활용 예로 신문 첫 화면처럼 시간에 따라 변하는 사이트의 상태 기록, 사용 기술 분석, 단축 URL 같은 잠재 위험의 사전 평가, 악성 자바스크립트 파일을 호스팅하는 영향받은 사이트 식별을 들었습니다.

## 구현 구조 {#architecture}

원문은 이 도구를 Workers 플랫폼의 도그푸딩 사례로 소개합니다. Workers가 공개 API를 서빙하고 Durable Objects가 오케스트레이션을, R2가 주 저장소를, Queues가 배치 작업을 맡으며 모두 엣지에서 동작합니다. 핵심은 Browser Rendering API입니다. Chrome 브라우저 플릿을 직접 만들고 운영하지 않아도 되어 짧은 기간에 출시할 수 있었고, 브라우저를 요청하면 알려진 Puppeteer 라이브러리로 페이지를 가져오고 처리합니다.

스캔은 네 단계입니다.

- 스캔 대기열에 넣기
- 웹사이트를 탐색해 초기 보고서 작성
- 후처리로 추가 정보를 모아 최종 보고서 작성
- 최종 보고서를 서빙·검색할 수 있게 저장

스캔마다 고유한 Durable Object인 Scanner가 시작부터 끝까지 조율합니다. 사용자에게 즉시 응답하려고 스캔을 Durable Object의 트랜잭션 키-값 저장소에 저장하고 1초 뒤 알람을 예약해 비동기로 수행하며, 요청이 접수됐다고 응답합니다.

알람이 울리면 두 번째 단계로 들어가고 Scanner, Browser Pool, Browser Controller 세 구성 요소(모두 Durable Object)가 일합니다. 초기 릴리스는 스캔마다 새 브라우저를 띄웠지만 시간이 걸리고 비효율적이어서, 검토 후 브라우저를 여러 스캔에서 재사용하기로 했고 이를 위해 두 구성 요소를 도입했습니다. Browser Pool은 열린 브라우저와 마지막으로 응답한 시각, 새 스캔을 받을 수 있는지 여부를 추적합니다. Browser Controller는 브라우저를 한 번 띄운 뒤 살아 있게 하고 탐색 세션 전체를 조율합니다. 원문의 단순화한 코드에서는 첫 요청에 `puppeteer.launch`로 브라우저를 열고 5초 간격으로 알람을 다시 걸어 WebSocket 연결이 유휴 상태가 되지 않게 `browser.version()`을 호출하며 풀에 생존을 알립니다. 페이지는 `networkidle2` 조건, 5초 타임아웃으로 탐색하고 DOM을 수집합니다.

초기 보고서는 모든 요청의 네트워크 로그를 HAR(HTTP Archive) 형식으로 담고, base64로 인코딩한 스크린샷 같은 메타데이터를 더합니다. 세 번째 단계에서 Scanner가 다른 Cloudflare API와 상호작용해 피싱 스캐너를 페이지 DOM에 돌리고, DNS 레코드를 가져오고, 주 호스트의 카테고리와 Radar 순위를 얻습니다. 모든 정보를 모으면 최종 보고서를 JSON으로 R2에 저장하고, 검색을 위해서는 Postgres를 씁니다.

처음에는 완료된 스캔을 코어 API로 바로 보내 Postgres에 저장했지만 스캔 비율이 늘자 쓰기를 모으는 편이 효율적이라고 판단해 Worker Queues로 배치 처리합니다. 스캔은 요청자에게 최대한 빨리 보여 주되 검색 결과에는 부하에 따라 수 초에서 수 분 늦게 올라와도 된다는 판단입니다. 결과는 R2에서 ID로 가져오면 되므로 Workers, Durable Objects, R2가 수요에 맞춰 매끄럽게 확장될 것으로 봅니다.

API Worker는 TypeScript로 작성했고 Radar용으로 만들어 커뮤니티 기여로 개선돼 온 OpenAPI 3 스키마 생성·검증 라우터 itty-router-openapi를 씁니다. 엔드포인트를 스키마와 함께 정의하면 handler가 호출되기 전에 입력이 검증됩니다.

## 앞으로의 계획 {#future-plans}

- 위치를 사용자가 지정하는 지역별 스캔(지역 보안 위협과 콘텐츠 규정 준수 파악)
- 더 폭넓은 헤더와 보안 정보를 포함한 상세 스캔 정보
- 더 빠른 스캔 결과를 위한 지속적 성능 개선
- IP 주소, ASN, 악성 사이트 분류별 검색

Security Center의 새 기능은 기존 고객용이고, URL Scanner의 기본 스캔은 Cloudflare Radar에서 일반 대중이 계속 쓸 수 있다고 덧붙입니다.

{{% details title="구성 요소와 설정값" closed="true" %}}
| 항목 | 값 |
|---|---|
| 출시 이후 스캔 수 | 거의 100만 건 |
| 스캔 단계 | 4단계 |
| 스캔 알람 지연(응답 후 비동기 시작) | 1초 |
| Browser Controller 알람 주기 | 5초 |
| 페이지 이동 대기 조건·타임아웃 | `networkidle2`, 5초 |
| Durable Object 구성 | Scanner, Browser Pool, Browser Controller |
| 저장소 | 최종 보고서 R2(JSON), 검색 Postgres |
| 쓰기 배치 | Workers Queues |
| 네트워크 로그 형식 | HAR |
{{% /details %}}
