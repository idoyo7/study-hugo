---
title: "Cloudflare for SaaS 이전 중 잘못 활성화된 호스트네임"
description: "Cloudflare for SaaS 이전 중 24개 호스트네임의 트래픽은 왜 clickfunnels.com으로 향했을까요? blocked 호스트네임이 잘못 active 상태로 바뀌면서 해당 트래픽에 clickfunnels.com의 설정이 적용됐습니다."
date: 2026-11-14
weight: 37
---

# Cloudflare for SaaS 이전 중 잘못 활성화된 호스트네임 (2022-01)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Incorrect proxying of 24 hostnames on January 24, 2022](https://blog.cloudflare.com/incorrect-proxying-of-24-hostnames-on-january-24-2022)
- 매체 · 게시일: The Cloudflare Blog · 2022-01-26
- 저자: Jeremy Hartman
- 원문 내용을 바탕으로 재구성한 포스트모템 요약입니다.
{{< /callout >}}

## clickfunnels.com으로 향한 24개 호스트네임의 트래픽 {#overview}

2022년 1월 24일, Cloudflare 글로벌 네트워크에서 프록시하던 www.cloudflare.com 등 호스트네임 24개의 트래픽이 잘못된 오리진으로 전달됐습니다. 목적지는 clickfunnels.com이었습니다. Cloudflare 내부의 제품 마이그레이션에서 발생한 오류로, clickfunnels.com 측은 트래픽이 도착하기 전까지 이 사실을 알지 못했습니다.

방문자에게는 원래 사이트 대신 `clickfunnels.com` 페이지가 보였을 수 있습니다. API 호출도 응답이 잘못되거나 아예 실패했을 가능성이 있습니다. 예를 들어 `api.example.com`이 영향받은 호스트네임이었다면, 호출자는 기대한 응답을 받지 못했을 가능성이 큽니다.

잘못 전달된 요청은 총 268,430,157건입니다. 그중 268,220,296건(99.92%)이 www.cloudflare.com을 향하던 요청이었습니다. 여기서 영향을 받은 이름은 www.cloudflare.com으로, cloudflare.com과 dash.cloudflare.com, api.cloudflare.com, cdnjs.cloudflare.com 등은 이 문제의 영향을 받지 않았습니다.

## 수동 승인이 필요했던 blocked 호스트네임 {#migration}

Cloudflare for SaaS는 SaaS 제공자가 고객의 웹사이트와 SSL 인증서를 대규모로 관리하는 제품입니다. 고객은 어떤 호스트네임이든 설정할 수 있지만, Cloudflare가 트래픽을 프록시하기 전에는 DNS 검증으로 해당 이름의 트래픽을 처리할 권한을 증명해야 합니다. 처음 등록된 호스트네임은 검증을 마칠 때까지 pending 상태입니다. 보통 SaaS 제공자가 호스트네임을 먼저 등록하고 고객과 필요한 DNS 검증을 진행하므로, pending은 이 서비스에서 매우 흔한 상태입니다.

DNS 검증을 통과하면 active로 바뀌어 프록시할 수 있습니다. 예외는 blocked로 표시된 호스트네임입니다. 이 경우에는 Trust & Safety 팀의 수동 승인이 있어야 활성화할 수 있습니다. Cloudflare 소유 자산이나 잘 알려진 브랜드, 여러 이유로 추가 검토가 필요한 호스트네임 등이 blocked로 표시될 수 있습니다.

이번 마이그레이션은 고객에게 더 나은 기능과 보안을 제공하면서 매끄럽게 전환하려는 작업이었습니다. 데이터베이스에서 커스텀 호스트네임 설정을 읽어 옛 시스템인 SaaS v1에서 현재 버전인 SaaS v2로 자동 이전하도록 설계했습니다.

그런데 clickfunnels.com 고객의 설정을 옮기던 중 소수의 blocked 호스트네임이 잘못 active 상태로 바뀌었습니다. 상태가 바뀌자 트래픽의 경로도 달라졌습니다. 해당 호스트네임으로 향하던 트래픽을 clickfunnels.com 소유의 설정으로 처리하면서, 요청이 clickfunnels.com 오리진으로 전달된 것입니다.

## 첫 경보가 가리킨 www.cloudflare.com {#timeline}

마이그레이션은 2022-01-24 22:24 UTC에 시작됐습니다. 대상은 수십만 개의 커스텀 호스트네임이었습니다. 목록을 따라 이전이 진행되면서 clickfunnels.com 오리진으로 향하는 트래픽도 늘었고, 23:06 UTC에는 www.cloudflare.com이 영향을 받았습니다.

23:15 UTC에 Cloudflare는 내부적으로 인시던트를 선언했습니다. 첫 경보가 가리킨 곳은 www.cloudflare.com이었습니다. 팀은 여기서 조사를 시작해 이후 19분 동안 www.cloudflare.com을 올바른 오리진으로 복구하고, 영향 범위와 근본 원인을 파악했으며, 나머지 호스트네임의 복구에도 착수했습니다.

전체 복구를 마친 시각은 2022-01-25 00:13 UTC입니다. 모든 커스텀 호스트네임의 설정을 바로잡고 인시던트를 종료했습니다.

Cloudflare는 영향받은 고객 모두에게 연락했습니다. 잘못 전달된 데이터를 ClickFunnels가 보관하지 않도록 협력해 관련 로그를 삭제했으며, ClickFunnels의 빠른 협조에 감사를 전했습니다. 고객과 해당 사이트 방문자에게도 사과하면서, 이번 사고로 그동안 알지 못했던 절차와 기술의 빈틈이 드러났다고 밝혔습니다.

## 마이그레이션에도 적용할 검증 파이프라인 {#follow-up}

Cloudflare가 제시한 후속 조치에는 blocked 상태를 덮어쓰는 처리를 없애는 방안이 포함됐습니다. 마이그레이션 중에도 blocked 호스트네임의 모든 변경을 검증 파이프라인으로 보내겠다는 계획입니다. blocked 호스트네임을 활성화 후보로 검토하려면 SaaS 고객의 명시적인 검증과 승인도 요구하기로 했습니다.

탐지 범위도 넓힙니다. 마이그레이션 대상 호스트네임에 모니터링을 추가해 잘못된 트래픽 패턴을 찾아내고 이전 작업을 담당하는 팀에 알릴 계획입니다. www.cloudflare.com에는 모니터링을 추가했습니다.

호스트네임을 활성화하는 순서도 바꿀 예정입니다. 먼저 비프로덕션 요소에서 활성화해 새 상태가 예상과 일치하는지 확인한 뒤 프로덕션으로 옮기는 방식입니다. 이 절차로 프로덕션 트래픽에 영향을 주기 전에 문제를 발견하려는 계획입니다.

{{% details title="시각과 요청 수" closed="true" %}}

| 항목 | 값 |
|---|---|
| 마이그레이션 시작 | 2022-01-24 22:24 UTC |
| www.cloudflare.com 영향 시작 | 23:06 UTC |
| 인시던트 선언 | 23:15 UTC |
| 선언 후 www.cloudflare.com 복구 및 원인 파악 | 19분 |
| 전체 복구, 인시던트 종료 | 2022-01-25 00:13 UTC |
| 영향받은 호스트네임 | 24개 |
| 마이그레이션 대상 | 수십만 개 커스텀 호스트네임 |
| clickfunnels.com으로 간 요청 | 268,430,157건 |
| 그중 www.cloudflare.com | 268,220,296건 (99.92%) |

{{% /details %}}
