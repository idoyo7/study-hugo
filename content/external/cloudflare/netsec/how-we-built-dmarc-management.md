---
title: "Cloudflare Workers로 구현한 DMARC 리포트 처리"
description: "Cloudflare가 DMARC Management를 Email Workers, Workers Analytics Engine, R2, Workers KV만으로 구현한 방식을 정리했습니다. 수신 메일에서 리포트를 꺼내 저장하고 분석 플랫폼에 넣는 처리 흐름과 오픈소스 Worker를 요약합니다."
date: 2026-11-14
weight: 14
---

# Cloudflare Workers로 구현한 DMARC 리포트 처리 (2023-03)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How we built DMARC Management using Cloudflare Workers](https://blog.cloudflare.com/how-we-built-dmarc-management)
- 매체 · 게시일: The Cloudflare Blog · 2023-03-17
- 저자: André Cruz, Nelson Duarte
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## DMARC와 리포트 {#dmarc}

DMARC(Domain-based Message Authentication, Reporting, and Conformance)는 이메일 피싱과 스푸핑을 막는 이메일 인증 프로토콜입니다. 도메인 소유자가 DNS 레코드로 SPF나 DKIM 같은 인증 방식을 지정해 두면, 메일이 인증에 실패했을 때 수신 측 메일 제공자가 그 메일을 격리할지 거부할지 처리 방법을 알 수 있습니다. 레코드는 예컨대 `v=DMARC1; p=reject; rua=mailto:dmarc@example.com` 형태로, DMARC 버전 1을 쓰고, 검사에 실패한 메일을 거부하며, 제공자가 리포트를 보낼 주소를 지정한다는 뜻입니다.

DMARC는 리포트도 제공합니다. 어떤 메시지가 DMARC 검사를 통과하고 실패했는지, 어디서 왔는지가 담긴 인증 활동 리포트를 도메인 소유자가 받을 수 있습니다. 효과적인 DMARC 관리에는 정책 설정, 인증 활동 모니터링, 리포트 분석에 따른 정책 조정, 메일 제공자와 서드파티 벤더와의 협업이 들어갑니다. Cloudflare는 이 글을 쓰던 날 DMARC Management를 출시했고, 이 글은 그 구현 이야기입니다.

## Workers로 구현한 이유 {#why-workers}

Cloudflare는 자사 제품을 내부에서 직접 쓰는 "dogfood" 방식으로 문제를 고객 전에 찾습니다. Workers도 그렇게 써서 Radar 2.0 같은 서비스나 Wildebeest 같은 소프트웨어 패키지를 만들었습니다. 최근 Email Routing 제품이 Workers와 합쳐져 수신 메일을 Workers 스크립트로 처리하는 Email Workers가 생겼습니다. 규칙과 검증된 주소는 API로 설정할 수 있고, 간단한 Email Worker는 허용 목록에 없는 발신자를 거부하고 나머지는 전달하는 정도의 코드입니다.

메일을 프로그램으로 처리할 수 있게 되면서, DMARC 리포트 메일을 확장성 있고 효율적으로 처리하는 데 알맞아 보였습니다. 전 세계에서 오는 수를 알 수 없는 메일 수신을 Email Routing과 Workers가 맡으면 됩니다. 필요한 일은 셋입니다.

- 메일을 받아 리포트를 꺼낸다. Email Workers의 `email()` 핸들러가 SMTP 봉투 요소, 미리 파싱된 헤더, 원본 메일 전체를 읽는 스트림을 받으므로 쉽습니다.
- 관련 내용을 분석 플랫폼에 게시한다. Workers Analytics Engine에 리포트 내용과 이후 쿼리에 맞는 스키마를 정의해 넣고, GraphQL이나 SQL API로 조회합니다.
- 원본 리포트를 저장한다. R2 객체 스토리지는 Worker에서 접근하기 쉬워서 리포트를 꺼낸 뒤 보관용으로 저장합니다.

이를 관리형 서비스로 만들어 존(zone)에서 켜게 하고 편의를 위해 대시보드도 붙였지만, 도구는 모두 공개되어 있어서 서버, 확장성, 성능 걱정 없이 자기 계정의 Cloudflare Workers 위에 직접 DMARC 리포트 처리기를 배포할 수도 있습니다.

## 아키텍처 {#architecture}

Email Workers는 Email Routing 제품의 기능입니다. Email Routing 구성요소는 모든 노드에서 돌고, 메일 인그레스 BGP 프리픽스를 모든 데이터센터에서 광고하기 때문에 어느 노드든 수신 메일을 처리할 수 있습니다. Workers로 보내는 일은 Email Routing 대시보드에서 규칙 하나를 설정하는 것으로 충분합니다.

Email Routing이 Worker로 전달하라는 규칙에 맞는 메일을 받으면, 최근 오픈소스로 공개된 workerd 런타임의 내부 버전에 연결합니다. 이 런타임도 모든 노드에서 돌고, 둘 사이의 RPC 스키마는 Capnproto로 정의되어 메일 본문을 읽는 대로 Edgeworker로 스트리밍할 수 있습니다. 스크립트가 메일을 전달하기로 하면 Edgeworker는 처음 요청에 실려 온 capability를 써서 Email Routing에 접속합니다.

## 리포트 메일의 처리 흐름 {#processing}

DMARC 리포트 메일은 이렇게 처리합니다.

- 메일의 수신자를 확인합니다. 이것이 쓰인 RUA, 즉 해당 도메인의 집계 DMARC 처리 피드백을 어디로 보낼지 지정하는 설정 값이며 메시지의 `to` 속성에 있습니다.
- 수가 정해지지 않은 도메인의 리포트를 처리하므로 도메인별 정보를 Workers KV에 RUA를 키로 저장해 두고, 이 리포트를 받아야 하는지도 여기서 확인합니다.
- 파싱하려고 메일 전체를 arrayBuffer로 읽습니다. 리포트 크기에 따라 무료 Workers 플랜의 한도에 걸릴 수 있고, 이때는 한도 문제가 없는 Workers Unbound 리소스 모델로 전환하라고 권합니다.
- 원본 메일의 MIME 파트를 파싱합니다. 여러 라이브러리가 있고 원문은 postal-mime을 예로 듭니다.
- 파싱한 첨부파일이 DMARC 리포트이며 압축돼 있을 수 있습니다. 먼저 압축된 형태 그대로 R2에 장기 보관합니다. 나중에 재처리하거나 흥미로운 리포트를 조사할 때 쓸 수 있고, 찾기 쉽도록 현재 시간 기준의 디렉터리로 파일을 나누기를 권합니다.
- 첨부파일의 MIME 타입을 보고 압축을 풉니다. 리포트의 원래 형태는 XML이고, 리포터마다 압축 알고리즘이 달라 MIME 타입으로 판별합니다. zlib은 pako, ZIP은 unzipit이 좋은 선택이라고 합니다.
- 얻은 XML은 fast-xml-parser로 파싱해서 잘 썼습니다. 리포트에는 메타데이터, 게시된 정책, 소스 IP와 건수와 DKIM, SPF 평가 결과를 담은 레코드가 들어 있습니다.
- 이후 처리는 데이터를 어떻게 보여 줄지에 달렸습니다. 대시보드에 의미 있는 데이터를 보여 주는 것이 목표였고, Worker에서 데이터를 보내고 이후 GraphQL API로 조회할 수 있는 Workers Analytics Engine이 알맞았습니다. 대시보드에 보이는 데이터는 이렇게 가져옵니다.

앞으로는 Queues를 흐름에 넣어 리포트를 비동기로 처리하고 클라이언트가 완료되기를 기다리지 않게 하는 방안도 고려하고 있다고 합니다. 이 프로젝트를 끝에서 끝까지 Workers 인프라만으로 구현했고, 확장성, 성능, 스토리지, 보안 걱정 없이도 사소하지 않은 앱을 만들 수 있고 그것이 유리하다는 점을 보였다는 것이 원문의 평가입니다.

## 오픈소스 {#open-source}

관리형 서비스를 켜서 쓸 수도 있지만 같은 일을 자기 계정에 직접 배포해 자기 DMARC 리포트를 관리할 수도 있으며 쉽고 무료입니다. 이를 위해 위 방식으로 DMARC 리포트를 처리하는 Worker를 `cloudflare/dmarc-email-worker` 저장소에 오픈소스로 공개했습니다. 데이터를 보여 줄 대시보드가 없으면 Worker에서 Analytics Engine을 조회하면 되고, 관계형 데이터베이스에 저장하고 싶으면 D1을 쓰면 됩니다. Email Routing 쪽은 Email Workers API를 기능 면에서 더 확장하는 작업도 하고 있다고 덧붙입니다.

{{% details title="사용한 구성요소" closed="true" %}}
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
