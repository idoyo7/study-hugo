---
title: "Cloudflare Workers로 완성한 DMARC Management"
description: "전 세계에서 들어오는 DMARC 리포트를 어떻게 받아 분석할까요? Cloudflare는 Email Workers, Workers KV, R2, Workers Analytics Engine으로 메일 수신부터 원본 보관과 대시보드 조회까지 구현했습니다."
date: 2026-11-14
weight: 14
---

# Cloudflare Workers로 완성한 DMARC Management (2023-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How we built DMARC Management using Cloudflare Workers](https://blog.cloudflare.com/how-we-built-dmarc-management)
- 매체 · 게시일: The Cloudflare Blog · 2023-03-17
- 저자: André Cruz, Nelson Duarte
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 전 세계의 리포트를 받을 Workers {#why-workers}

Cloudflare가 DMARC Management에서 받아야 할 입력은 전 세계에서 들어오는 리포트 메일이었습니다. 처리할 도메인 수도 정해져 있지 않았습니다. 메일을 받아 첨부된 리포트를 꺼내고, 분석에 쓸 데이터를 보내며, 원본을 보관하는 과정까지 필요했습니다. Cloudflare는 이 흐름 전체를 Workers 인프라 안에서 구현했습니다.

자사 도구를 내부 업무에 직접 쓰는 ‘dogfood’ 방식은 Cloudflare에 익숙한 접근입니다. 고객이 문제를 겪기 전에 직접 찾아보려는 목적입니다. 이미 Workers로 Radar 2.0과 소프트웨어 패키지 Wildebeest를 만들었고, Email Routing과 Workers가 결합하면서 수신 메일을 스크립트로 처리하는 Email Workers도 생겼습니다.

DMARC 리포트를 처리하기에 알맞은 기반이었습니다. 전 세계에서 들어오는 메일 수신은 Email Routing과 Workers에 맡기고, 추출한 데이터는 Workers Analytics Engine으로 보내면 됩니다. 원본 리포트를 보관할 R2도 Worker에서 바로 접근할 수 있었습니다.

## 정책 설정 뒤에 돌아오는 DMARC 리포트 {#dmarc}

DMARC(Domain-based Message Authentication, Reporting, and Conformance)는 이메일 피싱과 스푸핑을 막는 인증 프로토콜입니다. 도메인 소유자는 DNS 레코드에 SPF나 DKIM 같은 인증 방식과 함께, 인증에 실패한 메일을 수신 측에서 격리할지 거부할지 지정합니다. 예를 들어 `v=DMARC1; p=reject; rua=mailto:dmarc@example.com`은 DMARC 버전 1을 사용하고 검사에 실패한 메일을 거부하며, 지정한 주소로 리포트를 보내라는 설정입니다.

정책을 등록한 뒤에도 할 일이 남습니다. 어떤 메시지가 검사를 통과하거나 실패했는지, 어디서 발송됐는지 계속 살펴야 합니다. 이 정보를 담아 보내는 것이 DMARC 리포트입니다. 도메인 소유자는 분석 결과에 따라 정책이나 인증 방식을 조정하고, 정책이 제대로 적용되도록 메일 제공자나 서드파티 벤더와 협업할 수도 있습니다.

DMARC Management는 이처럼 계속 들어오는 인증 결과를 받아 보여 주는 서비스입니다. DNS 레코드 설정 이후의 모니터링과 분석을 뒷받침하려면, 메일로 도착한 리포트가 조회 가능한 데이터로 이어져야 했습니다.

## Worker로 본문을 스트리밍하는 Email Routing {#architecture}

Cloudflare는 모든 데이터센터에서 메일 인그레스 BGP 프리픽스를 광고합니다. 어느 노드로 메일이 들어와도 처리할 수 있도록 Email Routing 구성요소도 모든 노드에서 실행됩니다. 수신 메일을 Worker로 보내려면 Email Routing 대시보드에 규칙을 설정하면 됩니다. 규칙과 검증된 주소는 API로도 설정할 수 있습니다.

규칙에 맞는 메일이 도착하면 Email Routing은 당시 오픈소스로 공개된 workerd 런타임의 내부 버전에 접속합니다. 이 런타임 역시 모든 노드에서 실행됩니다. 둘 사이의 RPC는 Capnproto 스키마로 정의돼 있으며, 메일 본문을 읽는 대로 Edgeworker에 스트리밍할 수 있습니다. 스크립트가 메일을 다른 주소로 전달하기로 결정하면, Edgeworker는 최초 요청에 담긴 capability를 사용해 Email Routing에 다시 접속합니다.

Worker 코드에서의 진입점은 `email()` 핸들러입니다. 이 핸들러는 SMTP 봉투 정보, 미리 파싱된 헤더, 원본 메일 전체를 읽는 스트림을 받습니다. 허용 목록에 없는 발신자는 거부하고 나머지는 전달하는 간단한 로직도 여기서 작성할 수 있습니다. DMARC 처리기는 이 진입점에서 수신자를 확인하는 것으로 시작합니다.

## 분석보다 먼저 원본을 남기는 R2 {#processing}

수신 주소부터 확인하는 이유가 있습니다. 메시지의 `to` 속성에는 해당 도메인의 집계 리포트를 받을 주소를 지정한 DMARC 설정 값인 RUA가 들어 있습니다. Cloudflare는 여러 도메인의 정보를 Workers KV에 RUA를 키로 저장해 두고, 이를 조회해 해당 리포트를 받아야 하는지 판단합니다.

받기로 한 메일은 전체를 arrayBuffer로 읽은 뒤 MIME 파트를 파싱합니다. 이때 postal-mime 같은 라이브러리를 사용할 수 있습니다. 리포트 크기는 실행 환경 선택에도 영향을 줍니다. 무료 Workers 플랜의 한도에 걸릴 수 있으며, Cloudflare는 이 문제가 발생하면 해당 제약을 피할 수 있는 Workers Unbound 리소스 모델로 전환하도록 권했습니다.

파싱해서 얻은 첨부파일이 DMARC 리포트입니다. 압축돼 있을 수도 있습니다. Cloudflare는 내용을 분석하기 전에 첨부파일을 R2에 장기 보관하며, 압축된 파일은 그 상태로 저장합니다. 나중에 다시 처리하거나 눈여겨볼 리포트를 조사할 때 쓰기 위해서입니다. 저장은 R2 바인딩의 `put()` 호출로 처리하고, 나중에 찾기 쉽도록 현재 시간을 기준으로 디렉터리를 나누는 방식을 권합니다.

원본을 남긴 뒤에는 첨부파일의 MIME 타입을 확인합니다. 리포트의 본래 형식은 XML이지만 압축 알고리즘은 다를 수 있어, 타입에 맞는 방법으로 먼저 압축을 풀어야 합니다. zlib에는 pako를 사용할 수 있고, ZIP에는 unzipit이 좋은 선택입니다. Cloudflare는 이렇게 얻은 XML을 fast-xml-parser로 파싱했습니다. 그 안에는 리포트 메타데이터와 게시된 정책, 소스 IP, 메시지 건수, DKIM·SPF 평가 결과가 들어 있습니다.

## 대시보드 조회에 맞춘 Workers Analytics Engine {#analytics}

XML을 읽고 나면 다음 처리는 데이터를 어떻게 보여 줄지에 달려 있습니다. Cloudflare의 목표는 대시보드에 의미 있는 정보를 표시하는 것이었습니다. 따라서 분석 플랫폼의 스키마도 리포트에 담긴 내용과 나중에 실행할 쿼리를 함께 고려해 정했습니다.

Workers Analytics Engine은 이 흐름에 잘 맞았습니다. Worker에서 가공한 데이터를 보내고, 대시보드에서는 GraphQL API로 조회합니다. Analytics Engine은 SQL API로도 데이터를 조회할 수 있습니다. R2에 남긴 원본은 재처리와 조사에 쓰고, 화면에 필요한 데이터는 분석 플랫폼에서 가져오는 구성입니다.

글이 게시된 시점에는 Queues를 연결하는 방안도 검토하고 있었습니다. 리포트를 비동기로 처리해 클라이언트가 처리 완료를 기다리지 않도록 하려는 구상입니다. 이미 구현한 처리 흐름과 앞으로 검토할 개선을 구분해 둔 대목입니다.

## 자기 계정에 배포하는 DMARC Worker {#open-source}

DMARC Management는 존(zone)에서 켤 수 있는 관리형 서비스이며, 조회용 대시보드도 제공합니다. 같은 처리기를 직접 운영할 길도 열어 뒀습니다. Cloudflare는 이 방식으로 DMARC 리포트를 처리하는 Worker를 `cloudflare/dmarc-email-worker` 저장소에 오픈소스로 공개했습니다. 사용자는 자신의 계정에 무료로 배포해 리포트를 관리할 수 있습니다.

데이터를 보여 줄 대시보드가 없어도 Worker에서 Analytics Engine을 조회하면 됩니다. 관계형 데이터베이스에 저장하려면 D1을 선택할 수도 있습니다. 메일 수신부터 저장과 분석까지 Workers 플랫폼의 도구를 사용하되, 데이터를 보여 주고 보관하는 방식은 필요한 형태로 구성하는 것입니다.

Email Routing 팀은 Email Workers API의 기능을 더 확장하는 작업도 진행하고 있었습니다. 이 내용은 후속 글에서 다루겠다고 예고했습니다.

{{% details title="처리 단계별 구성요소" closed="true" %}}
| 항목 | 값 |
|---|---|
| 메일 수신과 처리 | Email Routing, Email Workers (`email()` 핸들러) |
| 도메인별 정보 저장 | Workers KV (RUA를 키로 사용) |
| 원본 리포트 보관 | R2 (시간 기준 디렉터리 구조) |
| 분석과 조회 | Workers Analytics Engine (GraphQL, SQL API) |
| 이메일 파싱 | postal-mime |
| 압축 해제 | pako (zlib), unzipit (ZIP) |
| XML 파싱 | fast-xml-parser |
| Worker와 런타임 간 RPC | Capnproto 스키마 |
| 오픈소스 저장소 | cloudflare/dmarc-email-worker |
{{% /details %}}
