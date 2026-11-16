---
title: "느린 사내 문서의 원인을 좁혀 가는 Cloudflare AI"
description: "느리다는 신고만으로 네트워크 문제를 어디서부터 조사해야 할까요? Cloudflare의 WARP diagnostic analyzer와 DEX MCP 서버는 진단 로그와 성능 데이터를 분석해 더 살펴볼 지점을 보여줍니다."
date: 2026-11-16
weight: 17
---

# 느린 사내 문서의 원인을 좁혀 가는 Cloudflare AI (2025-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Troubleshooting network connectivity and performance with Cloudflare AI](https://blog.cloudflare.com/ai-troubleshoot-warp-and-network-connectivity-issues)
- 매체 · 게시일: The Cloudflare Blog · 2025-08-29
- 저자: Chris Draper, Koko Uko
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 급한 신고에 빠진 네트워크 단서 {#distributed-network-troubleshooting}

“내부 문서가 뜨는 데 한참 걸립니다. 지금 당장 고쳐 주세요.” 임원에게 이런 IT 티켓을 받았다고 가정해 보겠습니다. 요청은 급하고, 단서는 적습니다.

직원들이 사무실에서 일하고 애플리케이션도 사내에 있던 시절에는 기업 네트워크가 그 사이를 연결했습니다. 클라우드와 SaaS가 늘고 어디서나 일하는 환경이 되면서 원인을 찾을 범위도 넓어졌습니다. 직원의 기기나 집·회사의 Wi-Fi부터 기업 네트워크, SaaS를 호스팅하는 클라우드 네트워크, 중간 ISP까지 후보입니다. 여러 성능 문제가 하나의 신고에 뒤섞여 있을 수도 있습니다.

Cloudflare One은 기업의 애플리케이션·사용자·기기·네트워크를 보호하는 SASE 플랫폼입니다. 여기서 WARP는 기기 트래픽을 암호화해 Cloudflare edge로 보내고, Digital Experience Monitoring(DEX)은 WARP와 함께 기기·네트워크·애플리케이션의 성능을 관찰합니다. Cloudflare가 공개한 WARP diagnostic analyzer와 DEX MCP 서버는 이 환경에서 로그 해석과 성능 데이터 분석을 돕습니다.

## 대시보드 구축 부담을 줄이는 DEX MCP 서버 {#dex-analysis-with-mcp}

DEX가 생성하는 모든 데이터는 API나 로그 수집으로 가져올 수 있습니다. 기업은 이를 SIEM에 연결해 원하는 분석 환경을 만들지만, 데이터 파이프라인과 대시보드를 구축하는 데는 시간과 비용이 듭니다. 예산이나 인력, 시간의 제약 때문에 이 작업에 엔지니어링 시간을 배정하지 못하는 고객도 있었습니다.

DEX MCP 서버는 SIEM에 로그를 통합하는 작업 없이 맞춤 분석을 요청하는 경로입니다. MCP(Model Context Protocol)는 AI가 다른 애플리케이션에 연결되도록 하는 표준으로, 여기서는 AI와 DEX를 연결합니다. 사용자가 “alice@acme.com의 기기 성능을 그래프로 보여 달라”고 요청하면 서버가 DEX API의 해당 기기 데이터를 바탕으로 맞춤 그래프를 제공합니다.

## 기기 점검 뒤에 드러난 wiki의 DNS 지연 {#internal-wiki-dns-investigation}

직원 Bob의 기기가 느리다는 신고를 조사하는 예시를 따라가 보면 분석의 흐름이 드러납니다. DEX MCP 서버는 기기의 전반적인 상태부터 확인합니다. 최근 24시간 연결 가용성은 100%이고, WARP 모드와 클라이언트 버전에도 문제가 없어 보입니다.

차이는 기기에 설정된 성능 테스트에서 나타납니다. Google 대상 HTTP 테스트는 평균 247ms인데, 내부 wiki인 `wiki.internal.acme.com`은 평균 1,374ms가 걸렸습니다. 특히 DNS 조회가 느립니다. 평균 616ms에 최대 1,600ms까지 치솟았습니다.

분석 응답은 느린 DNS 조회와 긴 리소스 가져오기 시간, 지속적인 HTTP 400 오류를 짚습니다. 애플리케이션이나 서버 측 지연, 설정이나 라우팅 문제의 가능성도 제시합니다. Cloudflare는 이 예시에서 느린 DNS 조회가 리소스를 가져오는 시간을 늘리고 HTTP 400 오류도 일으킨다고 설명합니다. wiki의 DNS 응답이 느리다면 다른 내부 애플리케이션도 성능 문제를 겪고 있을 가능성이 높다는 판단입니다.

해결책을 더 요청하면 서버는 WARP DNS 설정 점검, 로컬 DNS 캐시 도입 또는 개선, DNS용 TCP·UDP 설정 최적화를 제안합니다. 여기까지가 진단 예시에 담긴 내용입니다. 이 제안을 적용한 결과나 도구 도입 뒤의 성능 개선 실측치는 제시되지 않았습니다.

## 지원팀에 보내던 WARP 로그의 새 분석 화면 {#warp-diagnostic-analysis}

WARP 클라이언트의 연결 문제를 조사할 때는 진단 로그가 출발점입니다. 데스크톱 클라이언트에서 가장 흔한 문제들은 WARP diagnostic 로그에 담긴 정보로 조사할 수 있습니다. 문제는 분량입니다. 여러 날에 걸친 이벤트가 쌓여 있어, 기기에 무슨 일이 있었는지 파악하려면 전문 지식이 필요합니다.

Cloudflare는 그동안 고객에게 로그를 보내 달라고 안내하고, 숙련된 지원 담당자가 원인을 분석하도록 했습니다. 효과는 있었지만, 고객이 흔한 문제를 직접 해석할 수 있다면 더 빠른 해결을 도울 수 있습니다. WARP diagnostic analyzer를 만든 목적입니다.

분석은 Zero Trust dashboard의 `DEX > Remote Captures`에서 시작합니다. 원격 진단에 성공해 WARP diagnostic 파일이 생성되면 상태 상세 화면에서 `View WARP Diag`를 선택합니다. 그러면 AI가 더 조사해 볼 이벤트를 Cloudy 요약으로 보여줍니다.

요약 아래에는 클라이언트나 연결 문제 때 흔히 나타나는 이벤트가 표시됩니다. 이벤트를 펼치면 설명과 참고 자료, 최근 발생 시각 목록을 확인할 수 있습니다. 화면 아래의 기기 및 WARP 상세 영역에는 운영체제, WARP 버전, 기기 프로필 ID도 모여 있습니다. 분석 결과는 JSON 탭에서 복사하고, 추가 분석에 쓸 WARP Diag 파일도 같은 화면에서 내려받을 수 있습니다.

## AI playground에서 시작하는 MCP 연결 {#setup-and-prompt-requirements}

발표일인 2025-08-29 기준으로 두 기능은 모든 Cloudflare One 고객에게 기본으로 무료 제공되는 정식 기능입니다. DEX MCP 서버는 Free, PayGo, ENT 요금제에서 시험할 수 있습니다. Cloudflare AI playground의 `MCP Servers` 영역에 서버 주소를 넣고 `Connect`를 누른 뒤 Cloudflare 계정으로 인증하는 방식입니다. Cloudflare는 이 시작 과정에 1분 미만이 걸린다고 안내했습니다.

playground에서는 질문을 구체적이고 명시적으로 해야 응답을 얻을 수 있습니다. 예를 들어 사용할 계정을 활성 계정으로 먼저 지정한 뒤, `bob@acme.com`의 최근 24시간 DEX 테스트 결과를 가져오라는 요청을 별도로 해야 할 수 있습니다.

더 유연하게 질문하려면 MCP를 지원하는 Claude, Gemini, ChatGPT 등의 AI assistant에 서버를 설정하는 방법이 있습니다. 일부 assistant에서는 MCP 지원에 구독이 필요할 수 있습니다. 원문의 Claude Desktop 예시는 `claude_desktop_config.json`의 `mcpServers`에 서버를 등록하고, `npx`로 `mcp-remote`를 실행하도록 설정하는 방식입니다.

{{% details title="진단 예시의 수치와 연결 설정" closed="true" %}}
| 항목 | 값 |
|---|---|
| 예시 기기 연결 상태 | 최근 24시간 연속 연결, 가용성 100% |
| 예시 WARP 모드 | `warp+doh` — WARP와 DNS over HTTPS |
| 예시 클라이언트 버전 | `2025.1.7.2`, 예시 응답에서 최신 상태로 표시 |
| Google 대상 HTTP 테스트 | 평균 247ms, 범위 81~649ms |
| Google 대상 테스트의 시간대별 변화 | 하루 초반 약 317ms에서 저녁 약 211ms로 감소 |
| 내부 wiki HTTP 테스트 | 평균 1,374ms, 범위 877~2,431ms |
| 내부 wiki DNS 조회 | 평균 616ms, 최대 1,600ms의 급증 |
| 예시 응답의 DNS 성능 기준 | 좋은 성능을 위한 정상 DNS 응답 시간으로 50ms 미만 제시 |
| 내부 wiki HTTP 상태 | 지속적인 HTTP 400 오류 |
| playground 이용 가능 요금제 | Free, PayGo, ENT |
| playground 시작 시간 안내 | 원문은 1분 미만으로 안내 |
| 명시적 조회 요청 예시 | 특정 사용자의 최근 24시간 DEX 테스트 결과 조회 |
| Claude Desktop 설정 예시 | 파일 `claude_desktop_config.json`, 서버 키 `cloudflare-dex-analysis`, 명령 `npx`, 실행 인자 `mcp-remote`와 DEX MCP 서버 주소 |
{{% /details %}}
