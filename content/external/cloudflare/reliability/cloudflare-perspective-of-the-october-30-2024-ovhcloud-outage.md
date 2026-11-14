---
title: "Cloudflare가 본 2024년 10월 OVHcloud 장애"
description: "2024년 10월 30일 OVHcloud 백본 장애를 Cloudflare 쪽 트래픽과 BGP 로그로 관찰한 글을 정리했습니다. Worldstream의 라우트 릭 가능성과 max prefix-limit이 맡은 역할을 요약합니다."
date: 2026-11-14
weight: 17
---

# Cloudflare가 본 2024년 10월 OVHcloud 장애 (2024-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Cloudflare’s perspective of the October 30, 2024, OVHcloud outage](https://blog.cloudflare.com/cloudflare-perspective-of-the-october-30-2024-ovhcloud-outage)
- 매체 · 게시일: The Cloudflare Blog · 2024-10-30
- 저자: Bryton Herdes, David Belson, Tanner Ryan
- 원문 내용을 바탕으로 재구성한 요약입니다.
- Cloudflare 자사 장애가 아니라 클라우드 호스팅 업체 OVHcloud의 장애를 Cloudflare 쪽에서 관찰한 기록입니다.
{{< /callout >}}

## 장애 개요와 영향 범위 {#overview}

2024년 10월 30일 클라우드 호스팅 업체 OVHcloud(AS16276)가 짧지만 큰 장애를 겪었습니다. OVHcloud의 사고 보고서에 따르면 문제는 13:23 UTC에 시작했고 "백본 인프라에서 사고가 진행 중"이라고만 설명되었습니다. 사고는 17분 뒤인 13:40 UTC에 끝났다고 밝혔습니다.

OVHcloud는 대형 글로벌 호스팅 업체라 일부 고객이 Cloudflare로 전달하는 사이트의 오리진으로 씁니다. 캐시에 없는 콘텐츠는 OVHcloud에서 가져오므로 이 장애는 Cloudflare 쪽 트래픽에서도 확인되었습니다.

## 타임라인 {#timeline}

모든 시각은 2024-10-30 UTC입니다.

- 13:16:53: Amsterdam의 Cloudflare 엣지 라우터에서 Worldstream(AS49981)과의 BGP 세션이 `PrefixLimitExceeded`로 Established에서 Idle로 바뀌었습니다.
- 13:21: Cloudflare가 OVHcloud발 트래픽이 줄기 시작하는 것을 관찰했습니다. OVHcloud가 밝힌 시작 시각보다 약간 앞섭니다.
- 13:23: OVHcloud가 밝힌 사고 시작 시각입니다.
- 13:28: 트래픽이 사고 전 수준보다 약 95% 낮아졌습니다.
- 13:31: 회복이 시작되는 것으로 보였습니다.
- 13:40: OVHcloud가 밝힌 종료 시각이며, 트래픽은 사고 전의 약 50%까지 돌아왔습니다.

## Cloudflare 쪽에서 본 트래픽 변화 {#traffic-observation}

Cloudflare는 OVHcloud와 대부분의 트래픽을 피어링 링크로 주고받습니다. 피어링은 두 네트워크 사업자가 트래픽 교환을 위해 직접 연결하는 방식이고, 트랜짓은 한 네트워크가 중간 네트워크에 비용을 내고 목적지 네트워크까지 트래픽을 나르게 하는 방식입니다. 사고 중에는 피어링 트래픽량이 크게 줄었고, Cloudflare에서 OVHcloud로 가는 트랜짓 링크로 소량의 트래픽이 잠깐 흐른 것으로 보입니다. OVHcloud 요청이 도착하는 Cloudflare 데이터센터가 갑자기 바뀌었기 때문입니다.

OVHcloud발 라우팅은 몇 분간 완전히 끊겼다가 Amsterdam의 인터넷 익스체인지 포트 하나로만 이어졌고, 몇 분 뒤 전 세계에서 정상으로 돌아왔습니다. 평소에는 OVHcloud 데이터센터가 많은 Frankfurt와 Paris 데이터센터로 가장 많은 트래픽이 오지만, 트랜짓으로의 전환과 Amsterdam 익스체인지 피어링 지점으로의 전환 중에는 Amsterdam 데이터센터로 라우팅된 트래픽이 급증했습니다. 팀은 이 변화를 AS16276 내부 BGP 재수렴이나 전반적 네트워크 회복의 가장 이른 징후로, 즉 Amsterdam 피어링 지점과 가까운 곳에서 먼저 회복이 시작된 것으로 추정합니다.

## 근본 원인 추정 {#cause}

OVHcloud의 포스트모템은 피어링 파트너 중 한 곳이 실수로 푸시한 네트워크 설정에 문제가 있었고, 즉시 네트워크 경로를 재설정해 트래픽을 복구했다고 밝혔습니다. 원문은 이 백본 사고의 한 가지 가능한 설명으로, 해당 파트너의 BGP 라우트 릭을 듭니다. OVHcloud가 그 피어에게서 전체 인터넷 테이블을 받아들여 자기 네트워크나 파트너 네트워크를 트래픽으로 압도했거나 AS16276 내부에 예상치 못한 BGP 경로 갱신을 일으켰을 수 있다는 것입니다.

릭의 출처를 조사하다가 Cloudflare는 Amsterdam의 Worldstream(AS49981)과의 피어링에서 max prefix-limit 임계값이 넘은 증거를 찾았습니다. 수신 프리픽스 수가 이 피어링 세션에 설정한 한도를 넘자 BGP 세션이 자동으로 idle 상태가 되었고, 이 덕분에 라우트 릭이 Cloudflare 네트워크에 영향을 주지 않았습니다. 세션이 자동 차단되기 전 AS49981의 BGP Monitoring Protocol(BMP) 데이터를 분석해 보니 Worldstream이 상위 Tier 1 트랜짓 제공자가 AS 경로에 들어간 광고를 보내고 있었습니다. 같은 시간 AS49981에서 50만 건이 넘는 BGP 광고가 감지되었고, Worldstream이 여러 피어에게 경로를 광고했다는 점이 Cloudflare Radar에서 보입니다.

이후 Worldstream은 상태 페이지에 핵심 라우터 하나의 설정 오류로 모든 경로가 모든 피어에게 잠시 광고되었다고 밝혔습니다. 예상보다 많은 트래픽을 끌어들여 일부 경로에서 혼잡이 생겼고, 문제를 찾고 네트워크를 안정시키려고 해당 BGP 세션을 일시적으로 내렸다는 내용입니다. Cloudflare는 Worldstream이 Amsterdam의 OVHcloud 피어링 세션에서도 경로를 흘렸고 그것이 이번 영향의 원인이었다고 봅니다.

## 재발 방지를 위한 권고 {#recommendations}

원문은 BGP 라우트 릭이 네트워크에 영향을 주는 것을 막는 방법을 여러 개 제시합니다.

- 피어마다 max prefix-limit를 설정해, 피어가 예상보다 많은 프리픽스를 보내면 BGP 세션이 자동으로 끊기게 하는 방법
- 앞으로 도입할 수 있는 조치로 BGP용 ASPA(Autonomous System Provider Authorization). RPKI로 유효하지 않은 AS 경로의 BGP 경로를 받지 않게 돕습니다.
- 고객, 피어, 제공자 관계를 BGP 갱신에 엄격히 묶어 릭을 막는 RFC9234
- 인터넷 복원력을 높이기 위해 네트워크 운영자는 MANRS for Network Operators의 권고를 따를 것

{{% details title="원문의 주요 수치와 시각" closed="true" %}}

| 항목 | 값 |
|---|---|
| OVHcloud 보고 사고 구간 | 13:23~13:40 UTC (17분) |
| Cloudflare 관찰 트래픽 하락 시작 | 13:21 UTC |
| 최대 하락 | 13:28 UTC에 사고 전 대비 약 95% 감소 |
| 회복 시작 | 13:31 UTC |
| 13:40 UTC 시점 트래픽 | 사고 전의 약 50% |
| Worldstream 세션 차단 | 13:16:53 (`PrefixLimitExceeded`) |
| AS49981 BGP 광고 | 50만 건 이상 |

{{% /details %}}
