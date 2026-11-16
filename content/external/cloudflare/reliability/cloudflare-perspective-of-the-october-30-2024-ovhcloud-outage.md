---
title: "Cloudflare에서 추적한 OVHcloud 장애의 경로"
description: "OVHcloud의 백본 장애를 Cloudflare는 어떻게 추적했을까요? 트래픽과 BGP 로그에서 Worldstream의 라우트 릭을 의심할 단서가 드러났고, max prefix-limit은 Cloudflare 네트워크를 보호했습니다."
date: 2026-11-14
weight: 22
---

# Cloudflare에서 추적한 OVHcloud 장애의 경로 (2024-10)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Cloudflare’s perspective of the October 30, 2024, OVHcloud outage](https://blog.cloudflare.com/cloudflare-perspective-of-the-october-30-2024-ovhcloud-outage)
- 매체 · 게시일: The Cloudflare Blog · 2024-10-30
- 저자: Bryton Herdes, David Belson, Tanner Ryan
- 원문 내용을 바탕으로 재구성한 요약입니다.
- Cloudflare 자사 장애가 아니라 클라우드 호스팅 업체 OVHcloud의 장애를 Cloudflare 쪽에서 관찰한 기록입니다.
{{< /callout >}}

## 종료 시각에도 절반만 돌아온 OVHcloud 트래픽 {#overview}

2024년 10월 30일, OVHcloud(AS16276)는 백본 장애가 13:23 UTC에 시작해 13:40 UTC에 끝났다고 밝혔습니다. 보고된 장애 시간은 17분입니다. 그런데 종료 시각에도 Cloudflare에서 관측한 OVHcloud발 트래픽은 사고 전의 약 50%에 머물렀습니다.

일부 고객은 OVHcloud를 사이트의 오리진으로 두고 Cloudflare로 콘텐츠를 전달하며, Cloudflare 캐시에 요청받은 콘텐츠가 없으면 OVHcloud에서 가져옵니다.

Cloudflare가 트래픽 감소를 관측한 시각은 13:21 UTC였습니다. OVHcloud가 밝힌 시작 시각보다 조금 앞섭니다. 13:28 UTC에는 트래픽이 사고 전보다 약 95% 줄었고, 13:31 UTC부터 회복이 시작되는 것으로 보였습니다.

## Amsterdam 포트 하나로 이어진 경로 {#traffic-observation}

평소 OVHcloud발 트래픽이 가장 많이 들어오는 곳은 Cloudflare의 Frankfurt와 Paris 데이터센터입니다. OVHcloud가 이 지역에 대규모 데이터센터를 두고 있기 때문입니다. 장애 중에는 Amsterdam 데이터센터로 라우팅된 트래픽이 급증했습니다.

두 회사는 대부분의 트래픽을 프라이빗 피어링 세션으로 주고받습니다. 두 네트워크가 직접 연결되는 방식입니다. 장애 중 OVHcloud에서 Cloudflare로 향하는 경로는 몇 분간 완전히 끊겼다가 Amsterdam의 인터넷 익스체인지 포트 하나로만 이어졌습니다. 전 세계의 라우팅이 정상화된 것은 그로부터 몇 분 뒤였습니다.

그 과정에서 OVHcloud 요청이 들어오는 Cloudflare 데이터센터가 갑자기 바뀌면서, Cloudflare에서 OVHcloud로 향하는 소량의 트래픽이 잠시 트랜짓 링크로 흐른 것으로 보입니다. 트랜짓은 중간 네트워크에 비용을 내고 목적지까지 트래픽을 전달하는 방식입니다.

Cloudflare는 트랜짓과 Amsterdam 피어링 지점으로 경로가 바뀐 움직임을 AS16276 내부 BGP 재수렴이나 전반적인 네트워크 회복의 가장 이른 징후로 추정했습니다. Amsterdam 피어링 지점에 가장 가까운 거점부터 회복이 시작됐을 수 있다는 해석입니다.

## 트래픽 감소에 앞서 끊긴 Worldstream 세션 {#prefix-limit}

장애 원인을 조사하던 Cloudflare는 트래픽 감소보다 앞선 기록을 찾았습니다. 13:16:53 UTC, Amsterdam의 라우터에서 Worldstream(AS49981)과의 BGP 세션이 `Established`에서 `Idle`로 바뀌었습니다.

`Oct 30 13:16:53  edge02.ams01 rpd[9669]: RPD_BGP_NEIGHBOR_STATE_CHANGED: BGP peer 141.101.65.53 (External AS 49981) changed state from Established to Idle (event PrefixLimitExceeded) (instance master)`

로그에 찍힌 이유는 `PrefixLimitExceeded`입니다. Worldstream에서 받은 프리픽스 수가 해당 피어링 세션의 수신 한도인 max prefix-limit을 넘자 세션이 자동으로 끊겼습니다. 이 차단 덕분에 Cloudflare 네트워크는 라우트 릭(경로 누출)의 영향을 받지 않았습니다.

세션이 자동으로 닫히기 전의 BGP Monitoring Protocol(BMP) 데이터를 살펴보니, Worldstream이 광고한 AS 경로에는 상위 Tier 1 트랜짓 제공자가 들어 있었습니다. 같은 시간 AS49981에서 감지된 BGP 광고는 50만 건이 넘습니다. Worldstream이 여러 피어에게 경로를 광고하는 모습도 Cloudflare Radar에서 확인됐습니다.

## 모든 피어에게 경로를 광고한 Worldstream {#cause}

Worldstream은 이후 상태 페이지에서 라우트 릭이 발생했다고 밝혔습니다. 코어 라우터 하나의 설정 오류로 모든 경로를 모든 피어에게 잠시 광고했다는 설명입니다. 예상보다 많은 트래픽이 몰려 일부 경로에서 혼잡이 생겼고, 문제를 찾고 네트워크를 안정시키려고 해당 BGP 세션을 일시적으로 내렸다고 밝혔습니다.

OVHcloud의 포스트모템도 피어링 파트너 한 곳이 실수로 적용한 네트워크 설정에 문제가 있었다고 설명했습니다. OVHcloud는 즉시 네트워크 경로를 다시 설정해 트래픽을 복구했다고 보고했습니다.

Cloudflare가 제시한 가능한 설명은 OVHcloud가 해당 피어에게서 전체 인터넷 라우팅 테이블을 받아들였다는 것입니다. 그랬다면 트래픽이 OVHcloud나 피어링 파트너의 네트워크를 압도했거나, AS16276 내부에서 예상치 못한 BGP 경로 갱신이 일어났을 수 있습니다.

Cloudflare는 Worldstream이 Amsterdam의 OVHcloud 피어링 세션에도 경로를 누출했고, 그 결과 이번 장애가 발생했을 것으로 추정합니다.

## 라우트 릭에 대비하는 BGP 보호 장치 {#recommendations}

피어별 max prefix-limit은 이번에 Cloudflare에서 실제로 동작한 보호 장치입니다. Cloudflare는 라우트 릭에 대비해 앞으로 활용할 수 있는 수단으로 BGP용 ASPA(Autonomous System Provider Authorization)와 RFC9234도 제시합니다.

ASPA는 RPKI를 활용해 유효하지 않은 AS 경로가 포함된 BGP 경로를 받아들이지 않도록 돕습니다. RFC9234는 고객·피어·제공자의 관계를 BGP 갱신에 엄격하게 연결해 라우트 릭을 막는 방식입니다. Cloudflare는 인터넷 복원력을 높이기 위해 네트워크 운영자에게 MANRS for Network Operators의 권고를 따르도록 제안합니다.

{{% details title="장애 보고와 Cloudflare 관측에 남은 수치" closed="true" %}}

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
