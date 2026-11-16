---
title: "브라우저를 재사용하도록 바꾼 Cloudflare URL Scanner"
description: "브라우저 시작 지연과 검색 DB의 쓰기 부하를 어떻게 줄일까요? Cloudflare URL Scanner는 브라우저를 재사용하고 검색 반영을 배치 처리하되, 완성된 보고서는 ID로 바로 조회하도록 했습니다."
date: 2026-11-14
weight: 10
---

# 브라우저를 재사용하도록 바꾼 Cloudflare URL Scanner (2024-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Cloudflare's URL Scanner, new features, and the story of how we built it](https://blog.cloudflare.com/building-urlscanner)
- 매체 · 게시일: The Cloudflare Blog · 2024-03-08
- 저자: Sofia Cardita, Alexandra Moraru
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

Cloudflare URL Scanner는 보안팀과 일반 사용자가 웹사이트의 악성 여부를 조사하는 도구입니다. 2024년 3월 발표 시점에는 전해 3월 Cloudflare Radar에 출시한 뒤 누적 스캔이 거의 100만 건에 이르렀습니다. 비공개 스캔과 상세 악성 판정, 검색 기능을 보강한 데 이어 Security Center 통합과 공식 API도 추가했습니다.

스캔을 처리하는 방식에도 변화가 있었습니다. 처음에는 스캔마다 새 브라우저를 띄우고, 완료된 스캔을 곧바로 검색 DB에 기록했습니다. 이후 브라우저는 여러 스캔에서 재사용하고 검색용 쓰기는 모아서 처리하도록 바꿨습니다. 요청자가 보고서를 받는 속도와 검색 결과에 반영되는 속도는 따로 다룰 수 있었습니다.

## Chrome 운영을 맡아 준 Browser Rendering API {#architecture}

빠른 출시를 도운 기반은 Browser Rendering API였습니다. Chrome 브라우저 플릿을 처음부터 구축하고 운영하는 일을 이 API에 맡길 수 있었기 때문입니다. 개발팀은 필요한 브라우저를 요청한 뒤, 널리 알려진 Puppeteer 라이브러리로 페이지를 가져오고 처리했습니다. 브라우저 실행과 연결 유지에 필요한 인프라를 직접 관리하지 않아도 됐습니다.

Cloudflare는 나머지 구성에도 자사 플랫폼을 사용했습니다. Workers가 공개 API를 제공하고 Durable Objects가 스캔 진행을 조율합니다. 주 저장소는 R2이며, Queues는 배치 작업을 담당합니다. 모두 Cloudflare의 엣지 런타임에서 동작하는 구성입니다.

API Worker의 구현 언어는 TypeScript입니다. 라우터로는 Radar용으로 만들어진 뒤 커뮤니티 기여로 발전해 온 itty-router-openapi를 사용했습니다. OpenAPI 3 스키마 생성과 검증을 지원하므로, 엔드포인트에 입력 스키마를 정의하면 handler를 호출하기 전에 요청 데이터를 검증합니다.

## 다음 스캔을 위해 남겨 둔 브라우저 {#browser-reuse}

접수 응답은 곧바로 돌아갑니다. 스캔마다 고유한 Durable Object인 Scanner를 만들고, 요청을 그 객체의 트랜잭션 키-값 저장소에 기록한 뒤 1초 후 알람을 예약합니다. 사용자에게는 요청을 접수했다고 알리고, 실제 스캔은 알람이 울리면 비동기로 시작합니다. Scanner는 대기열 등록부터 탐색, 후처리, 최종 보고서 저장까지 전체 과정을 조율하는 객체입니다.

초기 버전에서는 이때마다 새 브라우저를 띄웠습니다. 브라우저를 시작하는 데 시간이 걸렸고 비효율적이어서, 검토 끝에 여러 스캔에서 재사용하기로 했습니다. 이를 위해 추가한 Browser Pool과 Browser Controller도 Scanner와 같은 Durable Object입니다.

Browser Pool은 어떤 브라우저가 열려 있는지, 마지막으로 생존 신호를 보낸 시각은 언제인지, 새 스캔을 받을 수 있는지 추적합니다. Browser Controller는 한 번 띄운 브라우저를 계속 살아 있게 유지하면서 탐색 세션 전체를 조율합니다.

단순화한 Browser Controller 예제에서는 브라우저가 없을 때 `puppeteer.launch`를 호출합니다. 이후 5초 간격의 알람에서 `browser.version()`을 호출해 Chrome과의 WebSocket 연결이 유휴 상태가 되는 것을 막습니다. 풀에 생존을 알리고 다음 알람도 예약합니다. 페이지 이동에는 `networkidle2` 대기 조건과 5초 타임아웃을 적용하며, DOM 수집을 마치면 페이지를 닫습니다.

## 완성된 보고서보다 늦어도 되는 검색 {#report-storage}

브라우저에서 얻는 초기 보고서에는 모든 요청의 네트워크 로그와 base64로 인코딩한 스크린샷 등의 메타데이터가 담깁니다. 로그 형식은 HAR(HTTP Archive)입니다. 브라우저와 웹사이트 사이의 상호작용을 기록한 JSON 파일이며, 널리 쓰이는 표준이라 공유하거나 전문 도구로 분석하기 쉽습니다.

탐색을 마친 Scanner는 다른 Cloudflare API를 호출해 보고서에 넣을 정보를 더 모읍니다. 페이지 DOM을 피싱 스캐너로 검사하고, DNS 레코드와 주 호스트 이름의 카테고리·Radar 순위를 가져옵니다. 이렇게 모은 자료를 합쳐 최종 보고서를 만들고 R2에 JSON으로 저장합니다.

검색에는 Postgres를 사용합니다. 처음에는 스캔이 끝날 때마다 코어 API로 보내 Postgres에 바로 저장했습니다. 스캔이 늘자 쓰기 부하를 더 효율적으로 관리할 방법이 필요해졌고, Worker Queues로 작업을 모아 배치 처리하도록 바꿨습니다.

이때 허용한 지연은 검색에 반영되기까지의 시간입니다. 요청자에게는 결과를 최대한 빨리 보여 주되, 검색 결과에는 부하에 따라 수 초에서 수 분 늦게 나타나도 괜찮다고 판단했습니다. 완성된 보고서는 API Worker가 ID로 R2에서 가져오므로 검색용 배치 쓰기가 끝날 때까지 기다리지 않습니다. Cloudflare는 Workers, Durable Objects, R2의 확장성을 바탕으로 앞으로 늘어날 수요에도 대응할 수 있을 것으로 봤습니다.

## 보안 조사에 들어온 URL Scanner {#overview}

Cloudflare 대시보드의 Security Center는 공격 표면을 파악하고 잠재적 보안 위험을 찾아 완화하는 곳입니다. 이제 그 안의 Investigate Portal에서 URL Scanner를 바로 사용할 수 있습니다. 여기서 실행하는 스캔은 기본적으로 검색에 공개되지 않는 unlisted입니다. 조사를 비공개로 유지하려는 개발자들이 자주 요청했던 기능입니다.

사용자는 이전 스캔과 보고서를 다시 조회하고, 여러 화면 크기의 스크린샷도 자동으로 받게 됩니다. 대시보드 접근 권한이 있는 고객에게는 더 높은 API 한도와 빠른 응답을 제공합니다.

공식 API에서도 공개 범위를 unlisted로 지정할 수 있습니다. User-Agent나 Authorization 같은 HTTP 헤더를 직접 설정하거나 모바일·데스크톱 등 여러 기기의 스크린샷을 요청하는 옵션도 추가됐습니다. 공개 스캔은 누구나 검색할 수 있어 조사 결과를 커뮤니티와 공유할 때 유용합니다.

스캔이 끝나면 최종 보고서와 전체 네트워크 로그를 가져옵니다. 새로 추가된 `verdict` 속성은 사이트의 악성 여부를 나타내고, `securityViolations` 섹션은 CSP 또는 SRI 정책 위반을 담습니다. 개발자가 자기 웹사이트를 스캔해 권장 사항을 확인하는 용도로도 사용할 수 있습니다.

검색 범위는 처음 검사한 주소에 그치지 않습니다. 호스트 이름과 특정 URL뿐 아니라 스캔 도중 페이지가 연결한 URL도 검색 대상입니다. 예를 들어 `?path=jquery.min.js`로 해당 자바스크립트 라이브러리를 사용하는 사이트를 찾습니다. URL Scanner는 악성 자바스크립트 파일을 호스팅하는 사이트를 식별하는 위협 조사에도 활용할 수 있습니다.

보안 조사 외에도 쓰임새가 있습니다. 온라인 신문의 첫 화면이 시간에 따라 어떻게 바뀌는지 기록하거나, 웹사이트가 사용하는 기술을 분석할 수 있습니다. 단축 URL을 미리 검사해 잠재적 위험을 살피는 것도 활용 예입니다. Security Center의 새 기능은 기존 고객에게 제공하지만, 기본 스캔은 Cloudflare Radar에서 일반 사용자도 계속 이용할 수 있습니다.

## 구상 중인 지역별 스캔 {#future-plans}

Cloudflare는 사용자가 스캔 위치를 지정하는 지역별 스캔을 계획하고 있습니다. 지역별 보안 위협과 콘텐츠 규정 준수를 파악하도록 돕는 기능입니다. 검색에는 IP 주소, ASN, 악성 사이트 분류 조건을 추가할 계획입니다.

보고서에 담을 헤더와 보안 정보도 확대할 예정입니다. 더 빠른 결과를 위한 성능 개선과 최적화를 이어가고, 악성 판정 정확도 역시 계속 집중해 개선할 영역으로 꼽았습니다.

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
