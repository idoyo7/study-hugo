---
title: "호스트네임 24개 오라우팅 사고"
description: "2022년 1월 24일 Cloudflare for SaaS 마이그레이션 중 www.cloudflare.com 등 24개 호스트네임이 엉뚱한 오리진으로 프록시된 사고의 타임라인과 원인을 정리했습니다. 영향 범위와 재발 방지 조치를 요약합니다."
date: 2026-11-14
weight: 32
---

# 호스트네임 24개 오라우팅 사고 (2022-01)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Incorrect proxying of 24 hostnames on January 24, 2022](https://blog.cloudflare.com/incorrect-proxying-of-24-hostnames-on-january-24-2022)
- 매체 · 게시일: The Cloudflare Blog · 2022-01-26
- 저자: Jeremy Hartman
- 원문 내용을 바탕으로 재구성한 포스트모템 요약입니다.
{{< /callout >}}

## 사고 개요 {#overview}

2022년 1월 24일 내부 제품 마이그레이션의 결과로, Cloudflare 글로벌 네트워크로 프록시되던 호스트네임 24개(www.cloudflare.com 포함)가 잘못된 오리진으로 연결되었습니다. 이 호스트네임으로 가는 트래픽이 clickfunnels.com 오리진으로 흘러, 의도한 사이트 대신 `clickfunnels.com` 페이지가 보였을 수 있습니다. 원문은 이것이 Cloudflare의 실수이며 clickfunnels.com은 트래픽이 도착하기 전까지 알지 못했다고 밝힙니다. API 호출 같은 응답도 제대로 오지 않거나 완전히 실패했을 수 있고, 예컨대 `api.example.com`이 영향을 받은 호스트네임이었다면 기대한 응답을 받지 못했을 것입니다.

## 마이그레이션과 호스트네임 상태 {#migration}

22:24 UTC에 수십만 개의 커스텀 호스트네임을 Cloudflare for SaaS 제품으로 옮기는 마이그레이션이 시작되었습니다. Cloudflare for SaaS는 SaaS 제공자가 고객의 웹사이트와 SSL 인증서를 대규모로 관리하게 해 주는 제품입니다. 의도는 완전히 매끄러운 전환이었고, 데이터베이스에서 커스텀 호스트네임 설정을 읽어 SaaS v1(옛 시스템)에서 SaaS v2(현재 버전)로 자동 이전하도록 설계되었습니다.

커스텀 호스트네임은 이렇게 구성됩니다. SaaS 고객은 어떤 호스트네임이든 설정할 수 있지만, Cloudflare가 프록시하려면 먼저 DNS 검증으로 그 호스트네임을 다룰 권한이 있음을 증명해야 합니다. 처음 설정하면 검증 전까지 pending 상태이고, 검증을 통과하면 active로 바뀌어 프록시됩니다. 예외가 하나 있습니다. 호스트네임이 시스템에서 blocked로 표시된 경우 Trust & Safety 팀의 수동 승인 없이는 활성화되지 않습니다. Cloudflare 소유 자산, 잘 알려진 브랜드, 추가 검토가 필요한 호스트네임 등이 blocked가 될 수 있습니다.

## 근본 원인 {#root-cause}

clickfunnels.com의 고객을 마이그레이션하는 동안 아주 소수의 blocked 호스트네임이 잘못 active 상태로 옮겨졌습니다. 그러자 이 호스트네임으로 가는 트래픽이 clickfunnels.com 소유의 설정으로 처리되어 clickfunnels.com 오리진으로 갔습니다. 그중 하나가 www.cloudflare.com이었습니다. cloudflare.com이 아니라 www.cloudflare.com이었으므로 dash, api, cdnjs 같은 하위 도메인은 영향을 받지 않았습니다.

## 타임라인 {#timeline}

- 2022-01-24 22:24 UTC: 마이그레이션 시작
- 23:06 UTC: www.cloudflare.com이 영향을 받음
- 23:15 UTC: 내부적으로 인시던트 선언. 첫 경보가 www.cloudflare.com에 대한 것이어서 거기서부터 조사를 시작함
- 이후 19분 동안: www.cloudflare.com을 올바른 오리진으로 복구하고, 영향 범위와 근본 원인을 파악하고, 나머지 호스트네임의 복구 작업을 시작
- 2022-01-25 00:13 UTC: 모든 커스텀 호스트네임이 올바른 설정으로 복구되고 인시던트 종료

## 영향 범위와 사후 처리 {#impact}

clickfunnels.com으로 리디렉션된 요청은 총 268,430,157건이었고 그중 268,220,296건(99.92%)이 www.cloudflare.com 대상이었습니다. 영향받은 고객에게는 모두 연락했습니다. 또 ClickFunnels와 협력해 이 사건의 로그를 삭제해, 잘못 도착한 데이터를 그쪽이 보관하지 않도록 했고 신속한 협조에 감사를 표했습니다.

## 재발 방지 조치 {#follow-up}

원문은 절차와 기술 양면의 후속 조치를 제시합니다.

- blocked 호스트네임 덮어쓰기를 더는 허용하지 않고, blocked 호스트네임의 모든 변경을 마이그레이션 중에도 검증 파이프라인으로 보냅니다.
- 마이그레이션 때 blocked 호스트네임을 활성화 후보로 보려면 SaaS 고객의 명시적 검증과 승인을 요구합니다.
- 마이그레이션 중인 호스트네임에 모니터링을 추가해 잘못된 트래픽 패턴을 감지하고 마이그레이션 팀에 알립니다.
- www.cloudflare.com에도 모니터링을 추가합니다.
- 호스트네임 활성화를 프로덕션에 올리기 전에 비프로덕션 요소에서 먼저 단계별로 적용해, 새 호스트네임 상태가 예상대로인지 확인하고 프로덕션 트래픽에 닿기 전에 문제를 잡습니다.

원문은 이번 일로 이전에는 몰랐던 프로세스와 기술의 틈이 드러났고, 고객과 영향받은 사이트의 방문자에게 사과한다고 맺습니다.

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
