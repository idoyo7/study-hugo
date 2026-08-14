---
title: "왜 찢어졌나 — Commons Clause 부터 AGPL 복귀까지"
weight: 3
---

# 03 · 왜 찢어졌나 — 2018 Commons Clause 부터 2025 AGPL 복귀까지

{{< callout type="info" >}}
**한눈에**
- **2018·2019·2022 의 라이선스 변경은 전부 모듈 얘기다.** RediSearch·RedisGraph·ReJSON·ReBloom·Redis-ML 에 붙은 것이고, core 는 2024-03-20 까지 BSD-3 였다. 회사는 그 사이 세 번 문서로 "core 는 BSD 로 남는다"고 공언했다 `✓`
- **core 가 넘어간 것은 커밋 하나다.** `0b3439692` "Change license from BSD-3 to dual RSALv2+SSPLv1 (#13157)", 2024-03-20 22:38:24Z, author Pieter Cailliau(Redis Inc.). `COPYING` 삭제 + `LICENSE.txt`(733줄) 추가 `✓`
- **SSPL 단독이 아니라 "RSALv2 또는 SSPLv1" 듀얼**이고 둘의 성격이 정반대다 — RSALv2 는 "서비스로 제공하지 말라"는 **금지형**, SSPLv1 은 "하려면 오케스트레이션 전부를 공개하라"는 **조건형 copyleft** `✓`
- **포크 기점은 두 개다.** 라이선스적으로는 마지막 BSD 릴리스인 7.2.4(2024-01-09), 코드적으로는 relicense 커밋의 **부모** `e64d91c37`(2024-03-20 20:44:28Z) — 즉 Valkey 는 relicense 1시간 54분 전의 트리를 들고 나갔고 7.2.4 이후 2개월 반치 unstable 을 포함한다 `✓`
- **"AWS 가 만든 포크"는 절반만 사실이다.** 첫 커밋 저자 Madelyn Olson 은 2020-07-09 에 Redis Core Team 멤버가 됐는데, **Redis Inc. 가 직접 초청해 앉힌 자리**였다. 실제 대비는 "벤더 vs 벤더"가 아니고 **CLA + 단일 소유 vs DCO + LF + TSC 1/3 상한**에 있다 `✓`
- **2025-05 에 Redis 는 AGPLv3 를 추가해 OSI 승인 라이선스로 돌아왔다. 그런데도 Valkey 는 돌아가지 않았다.** 라이선스 옵션이 늘어난 것과 거버넌스가 바뀐 것은 다르다 — CLA 는 그대로이고, AGPL 은 **추가**였을 뿐 RSALv2/SSPLv1 철회가 아니다 `✓`
- **호환성은 RESP 레벨까지만 참이다.** 커맨드 JSON 기준 Valkey 9.1.0 전용 18개 / Redis 8.10.0 전용 52개. atomic slot migration 처럼 **같은 기능을 다른 커맨드로** 구현한 사례가 이미 있다 `✓`
- 사내에서 캐시로만 쓴다면 **어느 라이선스에서도 걸리지 않는다**(§7). 걸리는 것은 재배포·외부 제공·그룹사 경계다.
{{< /callout >}}

> **왜 이 문서인가.** "Redis 가 라이선스를 바꿨고 AWS 가 포크했다"는 두 줄 요약은 세 곳에서 틀린다 — 무엇이 바뀌었는지(모듈 vs core), 누가 나갔는지(외부인 vs 원 core team), 그리고 왜 안 돌아왔는지다. 마지막 항목이 이 문서의 논지다. **2025-05 에 Redis 가 AGPLv3 를 추가해 OSI 승인 라이선스로 복귀했는데도 Valkey 는 돌아가지 않았다.** 라이선스가 원인이었다면 이 시점에 봉합됐어야 한다. 원인은 라이선스가 아니었다. **단일 벤더가 프로젝트의 라이선스를 일방적으로 바꿀 수 있는 구조**가 원인이었고, 라이선스 변경은 그 구조를 드러낸 방아쇠였다.

> 근거 기준: 라이선스 원문·커밋·거버넌스 문서는 `~/evejuni/{redis,valkey}` 로컬 클론의 태그(`redis 7.4.0`·`8.0.0`·`8.10.0`·`7.2.15`, `valkey 9.1.0`) 직접 확인, 회사 발표문·프레스릴리스·배포판 패키지 DB 는 2026-08-05 기준. 시각이 걸린 사건은 **UTC 로 통일**했다.

## 1. 전사 — 압박의 누적(2018~2021), 그리고 core 는 BSD 였다

2024 사건을 "여러 번 바꾼 것 중 하나"로 읽으면 성격을 놓칩니다. **2018·2019·2022 의 변경은 전부 모듈에 대한 것이고, core 는 그때마다 BSD-3 로 남았습니다.** 이 구분이 이 절의 전부입니다.

| 날짜 | 사건 | 적용 범위 | 무엇이 바뀌었나 |
|---|---|---|---|
| 2009-03-22 | Redis 첫 커밋 `ed9b544e1` (antirez) | core | `COPYING` = BSD-3. **이 커밋은 지금도 양쪽 repo 에 동일 해시로 존재한다** `✓` |
| 2018-08-21~22 | **Commons Clause** | **모듈만** | RediSearch·RedisGraph·ReJSON·ReBloom·Redis-ML 이 AGPL → Apache 2.0 + Commons Clause `✓` |
| 2019-02-21 | Commons Clause 철회 → **RSAL** | **모듈만** | 이유 3가지를 회사가 명시 — Apache 브랜딩 혼동, "substantial" 의 모호성, support 제약이 에코시스템 성장 의도와 충돌 `✓` |
| 2020-06-30 | antirez 스텝다운 | 거버넌스 | BDFL 종료. Yossi Gottlieb·Oran Agra 가 project lead, "light-governance" core team 도입 `✓` |
| 2020-07-09 | **Core Team 확정** | 거버넌스 | Itamar Haber(Redis) + **Madelyn Olson(AWS)** + **Zhao Zhao(Alibaba)**. 회사가 초청한 것 `✓` |
| 2021-08-11 | Redis Labs → **Redis** | 회사명 | 프레스릴리스가 라이선스 불변을 명시(아래) `✓` |
| 2022-11-15 | 모듈 RSALv2 + SSPLv1 듀얼 | **모듈만** | 2024 FAQ 가 이 날짜를 명시 `✓` |
| 2023-02-01 | **Rowan Trollope CEO** 취임 | 경영 | 2022-12-05 발표. Ofer Bengal 은 회장으로 `✓` |

**약속은 세 번 문서화됐다.** (a) 2018-08-22 회사 블로그 — "the license for open source Redis was never changed. It is BSD and will always remain BSD". (b) 2019-02-21 — "This change has zero effect on the Redis core license, which is and will always be licensed under the 3-Clause-BSD." (c) 2021-08-11 리브랜딩 프레스릴리스 — "The company renaming will not affect the licensing of open source Redis, which has always been and will continue to be BSD licensed, **nor the governance model**." `✓`

그래서 **2018·2019 에 Redis core 를 걷어낸 배포판은 없습니다.** 2024 사건이 처음으로 배포판·클라우드·자체 호스팅을 동시에 때렸고, 충격의 크기는 조항의 강도보다 **이 세 문장의 파기**에서 나왔습니다 `Σ`. 이 점이 §5 의 AGPL 복귀가 왜 신뢰를 회복하지 못했는지를 미리 설명합니다 — 옵션 추가는 "약속 하나 더"로 읽혔습니다.

한편 압박의 방향은 처음부터 명확했습니다. Commons Clause 도, RSAL 도, SSPL 도 겨냥한 것은 개별 사용자가 아니라 **소스를 가져가 관리형 서비스로 파는 클라우드 사업자**였습니다. 이 인센티브 구조는 §2 의 조항 원문에 그대로 드러나고, §3 에서 그 클라우드 사업자들이 포크의 후원자가 되는 이유이기도 합니다.

## 2. 2024-03-20 — core 가 넘어간 날

### 2.1 무엇에서 무엇으로

커밋 하나입니다 `✓`

```
0b3439692  2024-03-20T22:38:24+00:00  Pieter Cailliau <pieter@redis.com>
Change license from BSD-3 to dual RSALv2+SSPLv1 (#13157)
```

이 커밋이 `COPYING`(BSD-3, 10줄)을 삭제하고 `LICENSE.txt`(733줄)와 `REDISCONTRIBUTIONS.txt`(30줄)를 만들고 `src/` 전체의 파일 헤더를 교체했습니다. `redis 7.4.0:LICENSE.txt` 의 첫 5줄이 선언입니다 — "Starting on March 20th, 2024, Redis follows a dual-licensing model with all Redis project code contributions under version 7.4 and subsequent releases governed by the **Redis Software Grant and Contributor License Agreement**. After this date, contributions are subject to **the user's choice of** the Redis Source Available License v2 (RSALv2) or the Server Side Public License v1 (SSPLv1)". `✓`

공식 발표문의 논지는 두 겹이었습니다. 하나는 "여러 배포판을 동시에 유지하는 것이 Redis 를 미래로 끌고 가는 능력과 상충한다"는 것 — 발표문이 커뮤니티 주도 거버넌스 모델의 한계를 스스로 인정한 문장입니다("Despite efforts to support a community-led governance model … delivering multiple software distributions simultaneously … is at odds with our ability to drive Redis successfully into the future"). 다른 하나는 **자기 판정**이었습니다. 발표문 FAQ 가 "Redis is no longer open source under the OSI definition" 이라고 직접 썼습니다 `✓`

{{< callout type="warning" >}}
**OSI 측 성명은 인용하지 않습니다.** SSPL 이 OSI 승인 라이선스가 아니라는 사실의 근거는 Redis 자신의 FAQ 와 2025 년 AGPL 발표문("the Open Source Initiative clarified it lacks the requisites to be an OSI-approved license")입니다. opensource.org 도메인의 2024년 Redis 관련 게시물은 **직접 확인하지 못했습니다** `?` — 그래서 이 문서는 "Redis 스스로 OSI 정의상 오픈소스가 아니라고 인정했다"는 형태로만 씁니다.
{{< /callout >}}

### 2.2 RSALv2 와 SSPLv1 이 각각 무엇을 금지하나 — 원문

"SSPL 로 바꿨습니다"는 서술은 정확하지 않습니다. 듀얼이고, **사용자가 고르며**, 두 라이선스의 작동 방식이 정반대입니다.

| | RSALv2 | SSPLv1 |
|---|---|---|
| 형식 | **금지형** — 하지 말라 | **조건형 copyleft** — 하려면 공개하라 |
| 원문 위치 | `redis 7.4.0:LICENSE.txt:78-93` ("Limitations") | `redis 7.4.0:LICENSE.txt:654-676` ("13. Offering the Program as a Service") |
| 핵심 문구 | "You may not make the functionality of the Software or a Modified version available to third parties **as a service** or distribute the Software … in a manner that makes the functionality … available to third parties." | "If you make the functionality of the Program … available to third parties as a service, you must make the **Service Source Code** available via network download to everyone at no charge, under the terms of this License." |
| 범위 정의 | "enabling third parties to interact with the functionality … remotely through a computer network, offering a product or service, the value of which entirely or primarily derives from the value of the Software … or offering a product or service that accomplishes for users the primary purpose of the Software" | Service Source Code = "the Corresponding Source for all programs that you use to make the Program … available as a service, including, without limitation, **management software, user interfaces, application program interfaces, automation software, monitoring software, backup software, storage software and hosting software**, all such that a user could run an instance of the service using the Service Source Code you make available" |
| 실질 효과 | 관리형 서비스 사업 자체가 불가 | 가능하되 프로비저닝·모니터링·백업·UI 전부를 SSPL 로 공개해야 하므로 **실질적으로 불가** |

`✓` (양쪽 모두 `git show 7.4.0:LICENSE.txt` 로 원문 확인)

두 라이선스 어느 쪽도 **자체 호스팅과 사내 사용을 막지 않습니다.** FAQ #20 이 직접 씁니다 — "Hosting the products for the internal use of your organization is permitted. An organization includes its affiliates and subsidiaries." `✓` 걸리는 것은 SaaS 사업자, 그리고 **배포판**입니다 — DFSG·Fedora 정책이 "field of use" 차별을 통과시키지 않기 때문입니다(§4).

### 2.3 비소급 — 포크가 합법일 수 있었던 이유

`0b3439692` 가 `COPYING` 을 지우면서 만든 `REDISCONTRIBUTIONS.txt` 는 "BSD 잔여물 고지" 파일입니다. 8.10.0 판의 원문은 이렇습니다 — "Despite the shift to the dual-licensing model with version 7.4 (RSALv2 or SSPLv1) and the shift to a tri-license option with version 8.0 (RSALv2/SSPLv1/AGPLv3), **portions of Redis Open Source remain available subject to the BSD-3-Clause License**." 그 아래 BSD-3 전문이 붙습니다 `✓`

이 파일이 존재하는 이유는 **과거 기여자들의 BSD 기여분에 라이선스 변경을 소급 적용할 수 없기 때문**입니다. FAQ 도 "The license change is not retroactive"라고 명시합니다. 즉 Valkey·Redict 가 relicense 이전 트리를 BSD-3 로 계속 개발한 것은 라이선스 위반이 아니고, 그 법적 근거를 원 저작권자 쪽 문서가 스스로 제공합니다 `Σ`. 반대로 **신규 기여는 CLA(Redis Software Grant and Contributor License Agreement) 수락이 전제**입니다 — `redis 8.10.0:CONTRIBUTING.md` 가 CLA 전문을 그 자리에 싣습니다 `✓`. §5 와 §6 이 이 한 줄로 갈립니다.

### 2.4 왜 7.4 부터인가 — 그리고 7.2 BSD 라인은 아직 살아 있다

라이선스 커밋은 `unstable` 에 들어갔고, 그 `unstable` 이 릴리스로 나온 첫 버전이 **7.4.0(2024-07-29)** 입니다. 7.2 브랜치는 BSD 로 남았습니다. FAQ #12 는 "Redis will continue to backport critical security patches … to existing versions under the 3-clause license **until Redis Community Edition 9.0 is released**"라고 했습니다 `✓`

그런데 **Redis 9.0 이 나오지 않았습니다.** 8.0(2025-05-02) 이후 8.2·8.4·8.6·8.8·8.10 짝수 마이너 케이던스로 갔고 9.x 는 태그·브랜치·마일스톤·공표 계획이 모두 없습니다(→ [Redis 7.0 → 8.10]({{< relref "04-redis-7-to-8.md" >}})). 결과적으로 그 약속이 만료 조건에 도달하지 못한 채 계속 이행되고 있습니다 — 2026-07-23 에 **6.2.23 과 7.2.15** 가 나왔고, **두 태그의 루트에는 여전히 `COPYING`(BSD-3)만 있습니다** `✓`

{{< callout type="important" >}}
**"2024-03-20 이후의 모든 Redis 는 non-BSD"라는 말은 성립하지 않는다.** `git ls-tree --name-only 7.2.15` → `COPYING`, `git ls-tree --name-only 8.10.0` → `LICENSE.txt`. 라이선스 판정은 **버전 라인 단위**로 해야 한다(§7 표).
{{< /callout >}}

배포판의 반응은 §4 에서 다룹니다. 여기서 한 줄만 미리 적으면, Fedora 는 F41 에서 redis 를 retire 하고 `valkey-compat` 이 `Obsoletes: redis` 로 자동 대체하게 했으며 그 사유를 명문화했습니다 — "Redis's shift to the Server Side Public License (SSPL) that Fedora does not allow poses an issue." `✓`

## 3. 2024-03-28 — 8일 뒤

### 3.1 포크 기점은 두 개다

| 관점 | 기점 | 근거 |
|---|---|---|
| **라이선스** | Redis **7.2.4**(2024-01-09) — 마지막 BSD **릴리스** | 양쪽 repo 의 7.2.4 태그가 **완전히 동일한 커밋 객체** `d2c8a4b91e8c0e6aefd1f5bc0bf582cddbe046b7` `✓` |
| **코드** | `e64d91c37`(2024-03-20 **20:44:28Z**) — `redis/redis` unstable 의 마지막 BSD 커밋 | relicense 커밋 `0b3439692`(22:38:24Z)의 **부모**. `git merge-base --is-ancestor e64d91c37 9.1.0` → YES. `0b3439692` 는 Valkey 히스토리에 **없다**(`git cat-file -e` → not a valid object) `✓` |

즉 Valkey 는 relicense **1시간 54분 전**의 트리를 들고 나갔습니다. 홍보 문구의 "continue development on Redis 7.2.4"는 라이선스적 사실이고, 코드적으로는 7.2.4 이후 2개월 반치 unstable 커밋을 포함합니다 — Redis 7.4 의 기능 일부가 Valkey 에도 처음부터 들어 있었던 이유입니다 `Σ`

첫 Valkey 커밋은 `38632278f` "A single commit to get stuff building", **2024-03-22 02:00:46Z**, 저자 **Madelyn Olson** — 라이선스 커밋 기준 **+27시간 22분**입니다 `✓`. Linux Foundation 발표는 그로부터 6일 뒤인 **2024-03-28** 이었고, 같은 날 Olson 이 TSC Chair 로 취임했습니다(`valkey 9.1.0:MAINTAINERS.md` — "Term: March 28, 2024 – Present") `✓`

LF 를 고른 이유는 발표 구조에 드러납니다. 새 재단을 세우지 않고 기존 중립 재단 아래로 들어가면 상표·자산 귀속과 참여 규칙을 처음부터 단일 회사 밖에 둘 수 있습니다 `Σ`. 초기 참여로 발표된 곳은 **AWS · Google Cloud · Oracle · Ericsson · Snap Inc.** 다섯입니다 `✓` — 다만 valkey.io/topics/history 는 초기 연합을 "Alibaba, Amazon, Ericsson, Google, Huawei, Tencent"로 다르게 서술합니다. **어느 쪽이 "창설 참여"의 정본 정의인지는 확정하지 못했습니다** `?`

### 3.2 거버넌스 — 단일 벤더 모델과 갈리는 지점

`valkey 9.1.0:GOVERNANCE.md` 는 재라이선스를 막는 장치를 조문으로 둡니다.

| 장치 | Valkey (`GOVERNANCE.md`) | Redis Inc. |
|---|---|---|
| 기여 계약 | **DCO** — `Signed-off-by` 만. 권리를 넘기지 않는다(`valkey 9.1.0:CONTRIBUTING.md`) | **CLA** — Redis Software Grant and Contributor License Agreement 수락 필수(`redis 8.10.0:CONTRIBUTING.md`) |
| 최종 결정권 | TSC = Valkey 리포지토리의 maintainer 들. `MAINTAINERS.md` 에 공개 | 회사 |
| 단일 조직 상한 | **1/3** (`valkey 9.1.0:GOVERNANCE.md:16-20`) — "At any time, no more than one third (1/3) of the TSC members may be employees, contractors, or representatives of the same organization or affiliated organizations." 초과 시 통보 의무 + 30일 내 시정 + 조치 문서화 | 없음 |
| 기술적 중대 결정 | 단순 과반. 2주 내 과반이 안 나오고 **반대표가 없으면** TSC 2명의 명시적 "+2" 로도 통과. 반대표가 하나라도 있으면 +2 경로 봉쇄 | 없음 |
| 거버넌스 중대 결정(문서 수정·TSC 구성 제한 변경·표결 규칙 변경 포함) | **전체 TSC 의 2/3 super-majority** | 없음 |
| 논의 공개 | 공개 원칙. 예외는 embargo 된 보안 이슈와 maintainer 추가·제거뿐 | — |

`✓` (전 항목 `git show 9.1.0:GOVERNANCE.md` 원문 확인)

**이것이 이 문서의 논지가 서는 자리입니다.** Valkey 를 재라이선스하려면 거버넌스 문서 수정 = 2/3 super-majority 를 통과해야 하고, 그 TSC 는 한 조직이 1/3 을 넘을 수 없습니다. Redis 를 재라이선스하는 데 필요한 것은 회사 결정 하나였고, 실제로 그렇게 됩니다. core team 은 2020-06-30 에 도입됐고, 그 core team 이 존재하는 상태에서도 라이선스 변경은 **회사 직원의 커밋 하나로** unstable 에 들어갔습니다 `✓`. AGPL 추가(§5)는 이 비대칭을 건드리지 않았습니다.

### 3.3 "AWS 가 만든 포크"는 어디까지 맞나

| 서술 | 판정 | 근거 |
|---|---|---|
| 초기 커밋의 다수가 Amazon 소속이었다 | **맞다** | 첫 커밋 Madelyn Olson, 이어 Harkrishn Patro·Roshan Khatri 등 `✓` |
| AWS 에 직접적 상업 인센티브가 있었다 | **맞다** | ElastiCache·MemoryDB. 2024-10-08 에 가격 인하로 Valkey 를 밀었다 `✓` |
| Olson 은 외부에서 들어와 포크를 만든 사람이다 | **틀리다** | 2020-07-09 회사 블로그가 직접 초청을 기록한다 — "Madelyn Olson … Senior Software Development Engineer at Amazon Web Services and Zhao Zhao … Senior Engineer at Alibaba Cloud, have also accepted **our invitation** and have joined the core team" `✓` |
| Valkey 는 AWS 가 통제한다 | **틀리다** | TSC 9명 = Amazon 3(정확히 1/3 상한) · Google 1 · Oracle 1 · Ericsson 1 · Alibaba 1 · Tencent 1 · Percona 1 `✓` |
| 포크는 "커뮤니티 대 회사"의 사건이다 | **부분적** | Olson 은 LWN 인터뷰에서 "not an AWS fork"이고 목적이 "keep the continuity with the community"라고 했다 `≈`(2차 인용) |

정확한 서술은 이것입니다 — **기존 core team 의 일부가 자기 회사의 자원을 들고 중립 재단 아래로 옮겨갔습니다.** 그 자원에는 상업적 이해가 걸려 있었습니다. "벤더 하나가 만든 포크 대 벤더 하나가 소유한 원본"이라는 프레임은 양쪽 다 벤더가 걸려 있으므로 판별력이 없고, 실제 대비축은 **CLA + 단일 소유 vs DCO + LF + 1/3 상한 TSC** 입니다 `Σ`

라이선스 자체는 BSD-3 를 유지했습니다. `valkey 9.1.0:COPYING` 은 두 개의 BSD-3 를 병기합니다 — License 1 "Copyright (c) 2024-present, Valkey contributors", License 2 "Copyright (c) 2006-2020, Redis Ltd." 두 번째가 상속받은 BSD 코드의 저작권 고지입니다 `✓`

## 4. 왜 Valkey 가 이겼나

### 4.1 "Redis 대안"을 한 바구니에 담으면 안 된다

| 프로젝트 | 성격 | 라이선스 | OSI | 2026-08-05 상태 |
|---|---|---|---|---|
| **Valkey** | 포크 (BSD 트리 계승) | BSD-3 | 승인 | 9.1.1(2026-07-21). LF 아래 TSC 9명 `✓` |
| **Redict** | 포크 (7.2.4 기반, Drew DeVault/SourceHut, Codeberg) | LGPL-3.0-only | 승인 | **사실상 종료** — 최신 릴리스 7.3.6(2025-10-08), 이후 커밋 0. 마지막 커밋 메시지가 "Backport CVE fixes from **Valkey**" `✓` |
| **KeyDB** | 포크 (멀티스레드, 2019, → 2022 Snap 인수) | BSD-3 | 승인 | **사태 전부터 정체** — 최신 릴리스 v6.3.4(2023-10-30), 마지막 커밋 2024-03-22. Redis 7 기능이 없다 `✓` |
| **Microsoft Garnet** | **재구현** — C#/.NET, 스토리지는 MSR FASTER 계열(Tsavorite). RESP 만 채택 | MIT | 승인 | 활발 — v2.1.1(2026-07-30) `✓` |
| **DragonflyDB** | **재구현** | **BSL 1.1** (Change Date 2030-11-01 → Apache-2.0) | **비승인** | 활발하나, Additional Use Grant 가 "in-memory data store product or service"와 "as a Service"를 배제한다 — **회피하려던 문제와 같은 범주** `✓` |

두 가지가 읽힙니다. 첫째, **포크가 여러 개 생겨 생태계가 갈렸다는 진단은 사실과 어긋납니다** — 살아남은 것은 하나입니다. 둘째, 승부를 가른 것은 라이선스 선택이 아니라 **유지 인력**입니다. Redict 는 세 포크 중 가장 강한 copyleft(LGPL-3.0-only)를 골랐지만 10개월간 커밋이 없고 보안 패치를 Valkey 에서 받아 씁니다 `Σ`

라이선스 리스크 회피만이 목적이라면 후보는 **Valkey(BSD-3)와 Garnet(MIT)** 뿐입니다. Dragonfly 를 대안으로 세우는 것은 판정 기준을 스스로 무너뜨리는 선택입니다.

### 4.2 채택 증거

| 축 | 사실 | 근거 |
|---|---|---|
| **Fedora** | F41 에서 redis retire, `valkey-compat` 이 `Obsoletes: redis`. 2026-08-05 현재 `packages.fedoraproject.org/pkgs/redis/redis/` 는 **404**, dist-git 릴리스 브랜치는 `f40` 까지. **AGPL 이 된 뒤에도 복귀하지 않았다** | Fedora Change 페이지 · src.fedoraproject.org 브랜치 목록 `✓` |
| **Debian** | **양쪽 다 담았다.** `redis` bookworm 7.0.15 → trixie 8.0.2 → sid 8.0.6, `valkey` bookworm-backports 8.0.1 → trixie 8.1.1 → sid 8.1.4. trixie 의 redis copyright 는 "Licensed under your choice of (a) RSALv2; or (b) SSPLv1; or (c) AGPLv3" 를 그대로 선언한다 — **AGPLv3 옵션이 DFSG 통과의 근거** | sources.debian.org API + trixie copyright `✓` |
| **Alpine** | 3.20 에서 redis → valkey 교체 | 2차 `≈` |
| **AWS** | ElastiCache for Valkey 2024-10-08. 같은 날 **가격을 내려서** 밀었다 — 할인폭 수치는 [AWS 엔드포인트]({{< relref "07-aws-endpoints/index.md" >}})가 소유한다 | AWS 발표문 `✓` `Ⓥ`(발표 시점 **2024-10-08** 기준, 2026-08 현재성 미확인 `?`) |
| **Google Cloud** | Memorystore for Valkey GA(99.99% SLA). valkey-search 모듈도 기여 | GA 날짜는 검색 요약 경유 `≈` |
| **Oracle** | OCI Cache 가 Valkey GA. 2026-04-09 시점 지원은 7.2 / 8.1 | 2차 `≈`(9.x 지원 미확인 `?`) |
| **참여사 규모** | 초기 5개사 → 2025-09 기준 corporate participants **22 → 47**. 2025년 활동 기여자 346명(LFX analytics) | valkey.io `✓`(발행 주체가 프로젝트 자신 `Ⓥ`) |
| **다운스트림** | **Harbor**(CNCF graduated 컨테이너 레지스트리)가 v2.15.2 에서 내부 캐시를 Redis → Valkey 로 교체(PR #23157, 2026-04-28 머지). 사유를 명문화했다 — "open source projects benefit from dependencies with **clear governance models** that align with their own community values" | valkey.io 블로그 `✓` |

**여기서 비대칭이 하나 드러납니다.** AGPL 추가는 법적 자격 문제를 실제로 해결했습니다(Debian 이 증거). 그러나 **패키징 관성과 메인테이너 의지는 되돌려주지 않았습니다**(Fedora 가 증거) — 원 메인테이너 Remi Collet 본인이 "Redis may be proposed for unretirement … by me if I find enough motivation and energy, or by someone else" 라고 썼습니다 `✓`. 배포판 기본 패키지가 무엇인지가 대부분 팀의 실질 선택을 결정하므로, 이 비대칭이 채택을 계속 한쪽으로 밉니다 `Σ`

GitHub stars(2026-08-05: redis/redis 75,890 / valkey-io/valkey 26,747)는 15년 누적 대 2년 누적이므로 **채택 지표로 쓰면 안 됩니다** `✓`

## 5. 2025-05 — Redis 8.0 의 AGPLv3 와 antirez 복귀

### 5.1 왜 SSPL 이 아니라 AGPL 이 판정을 바꾸나

커밋은 `d65102861` "Adding AGPLv3 as a license option to Redis! (#13997)"(2025-05-01), 발표문은 같은 날 Rowan Trollope 명의, 태그 8.0.0 은 2025-05-02 다 `✓`

AGPLv3 와 SSPLv1 은 겉보기 구조가 같습니다 — 둘 다 "네트워크로 제공하면 소스를 공개하라"는 조항을 13조에 둡니다. 갈리는 지점은 **공개 범위**입니다.

| | AGPLv3 §13 (Remote Network Interaction) | SSPLv1 §13 (Offering the Program as a Service) |
|---|---|---|
| 공개 대상 | **그 프로그램의 수정된 소스** | **Service Source Code** = 그 프로그램 + 서비스로 제공하는 데 쓴 모든 프로그램 |
| 포함 범위 | 수정본 자체 | management software, user interfaces, APIs, automation, monitoring, backup, storage, hosting software 전부 |
| OSI | **승인** | 비승인 |

`✓`

즉 AGPL 은 "당신이 고친 그것"까지, SSPL 은 "당신 인프라 전체"까지를 요구합니다. 후자가 OSI 정의를 통과하지 못하는 이유이고, 그래서 AGPL 옵션 추가만으로 배포판 판정이 뒤집힙니다(§4.2 Debian).

발표문의 논지는 세 겹였습니다 `✓`
1. **2024-03 의 목표는 달성됐다** — "This achieved our goal—**AWS and Google now maintain their own fork**—but the change hurt our relationship with the Redis community."
2. **SSPL 은 오픈소스가 아니다** — "SSPL is not truly open source because the Open Source Initiative clarified it lacks the requisites to be an OSI-approved license."
3. **antirez 가 돌아왔다** — 복귀 공표는 2024-12-10(회사 발표문은 결정 시점을 "in November of 2024"로 쓴다 `?`), 역할은 part-time evangelist. Vector Sets 를 그가 만들었고 오픈소스로 내보내고 싶어 했다.

Redis 8 GA 블로그는 실무 이유를 하나 더 줍니다 — "We heard from **some customers** that it is easier for them to operate under an OSI-approved license." `✓` antirez 본인의 논지는 조금 다릅니다. 그는 SSPL 이 닫힌 라이선스라고 보지 않지만 "the SSPL, in practical terms, **failed to be accepted by the community**. The OSI wouldn't accept it, nor would the software community regard the SSPL as an open license" 라고 썼습니다 `✓`

같은 릴리스에서 이름도 되돌렸습니다 — "Redis Community Edition" → **"Redis Open Source"** `✓`

### 5.2 그런데도 트라이로 남긴 이유, 그리고 CLA

`redis 8.10.0:LICENSE.txt` 첫 문단이 현재 상태입니다 — "moving to a **tri-licensing** model … contributions are subject to **your choice of**: (a) RSALv2; or (b) SSPLv1; or (c) AGPLv3." `✓`

{{< callout type="warning" >}}
**"Redis 8 은 AGPL 이 됐다"는 서술은 틀립니다.** AGPLv3 는 **추가**됐을 뿐 RSALv2/SSPLv1 은 그대로입니다. 트라이 라이선스는 **사용자 선택**이므로, 회사는 어느 쪽 고객도 잃지 않습니다. 조직 중에는 AGPL 의 §13 때문에 AGPL 을 사내 정책상 못 쓰는 곳이 있습니다 — 2018-08 글이 이미 "the use of AGPL was against their company's policy"라고 언급했던 그 조직들입니다. 이런 조직은 RSALv2 를 고르고, 배포판·OSI 요구가 있는 쪽은 AGPLv3 를 고릅니다 `Σ`
{{< /callout >}}

그리고 **CLA 는 그대로입니다.** FAQ #24 가 "acceptance of the contributor license agreement (CLA) by the contributor is necessary" 라고 명시하고, `redis 8.10.0:CONTRIBUTING.md` 는 여전히 CLA 전문을 싣습니다 `✓`. 이것의 함의는 단순합니다 — **8.10 의 코드도 회사가 원하면 옵션을 다시 뺄 수 있는 구조에 있습니다.** 2025-05 에 바뀐 것은 라이선스 옵션의 개수이고, 바뀌지 않은 것은 그 개수를 정하는 주체입니다.

부수 사실 하나. **Redis 8.0.0 이 실제로 실은 라이선스 본문은 AGPLv3 가 아니라 GPLv3 였습니다.** `8.0.0:LICENSE.txt` 의 13조가 "Use with the GNU Affero General Public License"(= GPLv3 의 13조)이고, AGPLv3 의 13조인 "Remote Network Interaction" 은 `8.2.0:LICENSE.txt` 에서야 나타납니다. 수정 커밋은 `266835659`(2025-05-06, #14010) `✓`

## 6. 그래서 포크는 봉합됐나

안 됐습니다. 근거 넷입니다.

**첫째, 대응 자체가 없었습니다.** valkey.io 블로그 전량(2024-04-12~2026-07-17)을 확인했고 2025-05 의 AGPL 발표에 대응하는 글은 **존재하지 않습니다** `✓`. The Register 인터뷰(2025-05-15)는 "We spoke to Olson **before** Redis announced that it would be switching to the AGPL" 이라고 명시합니다 — 즉 공식 반박 성명이 없었고, 무대응이 답였습니다 `Σ`. 대신 2025-09-16 블로그가 자기 정의를 반복합니다. "Valkey was founded just over a year ago to keep high-performance key/value storage in the open source community: **free from vendor lock-in and restrictive licenses**." `✓`

**둘째, 개발 활동이 돌아오지 않았습니다.** 로컬 클론 직접 계측(`--all` 기준)입니다.

| 기간 | redis/redis 커밋 / 저자 | valkey-io/valkey 커밋 / 저자 |
|---|---|---|
| 2021 | 1,116 / 164 | (공통 히스토리) |
| 2023 | 671 / 115 | (공통) |
| 2024-03-22 ~ 2024-12-31 | **246 / 55** | **889 / 132** |
| 2025 | 823 / 90 | 1,124 / 137 |
| 2025-08-01 ~ 2026-08-05 (최근 12개월) | 905 / 112 | **1,701 / 165** |

`✓`

{{< callout type="important" >}}
**이 표를 배수로 읽지 마십시오.** `redis/redis` 는 core 만이고, Redis 8 이후 Query Engine·JSON·TimeSeries·Bloom 은 별 repo 입니다 — Redis 진영이 **과소평가**돼 있습니다. Valkey 도 valkey-search·valkey-json·valkey-bloom·valkey-glide 를 뺐으니 같은 방향으로 과소평가입니다. **방향성만** 유효합니다. 교차검증인 Percona 분석(2025-12-05, fork 직전 4개월 Redis 기여자 24명 중 9명 이탈 / Valkey 18→49명)은 방향이 일치하지만 **Percona 는 Valkey 참여사**이므로 편향 가능성을 감안합니다 `≈`
{{< /callout >}}

**셋째, 커맨드가 실제로 갈라졌습니다.** `src/commands/*.json` 파일 목록을 직접 diff 했습니다 — valkey 9.1.0 = 426개, redis 8.10.0 = 460개(core 만), **Valkey 전용 18 / Redis 전용 52** `✓`

| 진영 | 전용 커맨드 |
|---|---|
| Valkey 전용 (18) | `CLUSTERSCAN`, `CLUSTER MIGRATESLOTS`/`GETSLOTMIGRATIONS`/`CANCELSLOTMIGRATIONS`/`FLUSHSLOT`, `COMMANDLOG`(+get/help/len/reset), `DELIFEQ`, `CLIENT CAPA`, `CLIENT IMPORT-SOURCE`, `SCRIPT SHOW`, `SENTINEL` primary 계열 4개 |
| Redis 전용 (52) | `AR*` 18개(8.8 의 새 자료구조 Array, @antirez), `BACKUP` 계열 8개, `HIMPORT` 계열 5개, `HOTKEYS` 계열 6개, `XACKDEL`/`XDELEX`/`XNACK`/`XIDMPRECORD`/`XCFGSET`, `LMOVEM`/`BLMOVEM`, `SDIFFCARD`/`SUNIONCARD`, `SFLUSH`, `DELEX`, `INCREX`, `DIGEST`, `TRIMSLOTS`, `CLUSTER MIGRATION` |

결정적 사례는 **atomic slot migration** 입니다. 양쪽이 같은 기능을 독립적으로, 반대 방향으로 구현했습니다 — Valkey 9.0.0(2025-10-21)은 `CLUSTER MIGRATESLOTS`(source 에서 push), Redis 8.4.0(2025-11-18)은 `CLUSTER MIGRATION IMPORT`(destination 에서 pull)입니다. **자동화 스크립트가 서로 호환되지 않습니다.** 동작 비교는 [cluster mode]({{< relref "06-cluster-mode/index.md" >}})가 소유합니다 `✓`

여전히 같은 것은 **RESP 프로토콜**입니다. Harbor 는 교체 후 "same RESP protocol as Redis; **no application-level RESP changes were required**"라고 보고했고, Valkey 8.0 릴리스노트는 "fully compatible with Redis OSS 7.2.4"를 명시하며 `extended-redis-compatibility` 설정도 9.1.1 까지 살아 있습니다(`valkey 9.1.1:src/config.c:3320` — `MODIFIABLE_CONFIG`) `✓`. 즉 **드롭인 교체는 7.2 기능 집합 안에서만 참**입니다 — 7.4 이후 어느 한쪽의 신규 커맨드에 애플리케이션이 의존하는 순간 락인이 시작됩니다. 버전별 신기능은 [Redis 7.0 → 8.10]({{< relref "04-redis-7-to-8.md" >}})과 [Valkey 8.0 → 9.1]({{< relref "05-valkey-8-to-9/index.md" >}})이 소유합니다.

**넷째, 보안 패치 흐름이 역전된 구간이 있습니다.** Debian bug **#1136392**(2026-05-13, 신고자는 Debian redis 메인테이너 Aron Xu)가 사례입니다. Debian 의 redis 패키지가 CVE-2026-21863 패치를 **Valkey 커밋에서 그대로 복사해** 붙였는데, Valkey 는 그 검사를 전용 함수 `clusterIsValidPacket()`(0=invalid, 1=valid)에 두었고 Redis 는 `clusterProcessPacket()` 인라인(0=link freed, 1=link alive)에 두었습니다. **반환값 의미가 반대라서** 원 CVE 는 막았지만 새 remote DoS 를 만들었고 `5:8.0.6-2` 에서 수정됐습니다 `✓`. Redict 가 Valkey 에서 CVE 를 백포트하는 것(§4.1)과 합치면 이 계보의 보안 유지 중심이 어디인지가 보이고, 동시에 **두 코드베이스가 패치를 기계적으로 이식할 수 없을 만큼 갈라졌다**는 것도 보입니다 `Σ`

다만 **법적 적대 상태는 아닙니다.** 2024-08-14 에 Valkey 에 들어간 커밋 `4d284daef` "Copyright update to reflect IP transfer from salvatore to Redis (#740)" 의 저자는 **Pieter Cailliau** — 5개월 전 relicense 커밋을 넣은 그 사람입니다 `✓`. 소송이 제기됐다는 근거는 찾지 못했습니다(적극적으로 부재를 확인한 것은 아닙니다 `?`). Valkey 가 `redisServer` → `valkeyServer` 등 전면 개칭을 초기에 서둘러 한 것은 트레이드마크 때문입니다. 2024-03-20 FAQ #22 가 "You can no longer use 'Redis' or 'for Redis' in your product name" 라고 명시했습니다 `✓`

## 7. 운영자에게 무엇이 남았나

{{< callout type="warning" >}}
**이 절은 법률 자문이 아닙니다.** 아래는 라이선스 원문과 발행 주체의 FAQ 를 읽은 결과이고, 실제 판단은 사용 형태·계약 관계·법인 구조에 따라 달라집니다. 재배포나 외부 제공이 걸리는 순간 법무 확인을 거쳐야 합니다.
{{< /callout >}}

| 버전 | 라이선스 | OSI | 우리에게 무엇이 금지되나 |
|---|---|---|---|
| Redis ≤ 6.2.x · ≤ 7.2.x (7.2.15·6.2.23 = 2026-07-23 까지 패치) | BSD-3 (`COPYING`) | 승인 | 사실상 없음 (고지 유지) `✓` |
| Redis 7.4.x ~ 8.10.x — **RSALv2** 선택 | RSALv2 | **비승인** | 기능을 제3자에게 **서비스로 제공**하거나, 제3자가 그 기능을 쓰게 되는 형태로 **배포**하는 것 `✓` |
| Redis 7.4.x ~ 8.10.x — **SSPLv1** 선택 | SSPLv1 | **비승인** | 서비스로 제공하려면 관리·UI·API·자동화·모니터링·백업·스토리지·호스팅 소프트웨어 **전부**를 SSPL 로 공개해야 함 `✓` |
| Redis 8.0.0 ~ — **AGPLv3** 선택 | AGPLv3 | 승인 | 수정본을 네트워크로 제공하면 **그 수정본의** 소스 공개. 인프라 전체는 아님 `✓` |
| Valkey 전 버전 (7.2.5 ~ 9.1.1) | BSD-3 (`COPYING`, License 1·2 병기) | 승인 | 사실상 없음 (고지 유지) `✓` |
| Redict 7.3.x | LGPL-3.0-only | 승인 | 수정본 배포 시 동일 라이선스로. 단 유지 종료 상태(§4.1) `✓` |
| Garnet | MIT | 승인 | 사실상 없음 `✓` |
| DragonflyDB | BSL 1.1 (Change Date 2030-11-01) | **비승인** | in-memory data store 제품/서비스로 제공하는 것, "as a Service" 제공 `✓` |
| memcached | BSD-3 (2003-06-15 이후 23년 무변경) | 승인 | 사실상 없음 → [memcached]({{< relref "02-memcached/index.md" >}}) `✓` |

**사내에서 캐시로 쓰는 것은 위 어느 라이선스에서도 걸리지 않습니다.** RSALv2·SSPLv1 발표 FAQ #20 이 직접 씁니다 — "Hosting the products for the internal use of your organization is permitted. **An organization includes its affiliates and subsidiaries.**" 자체 호스팅, k8s 위 self-host, 관리형 서비스 이용, 사내 애플리케이션의 세션·캐시·큐 용도는 모두 허용 범위입니다 `✓`

진짜 걸리는 케이스는 네 가지입니다.

| 케이스 | 어느 라이선스에서 문제인가 | 무엇을 확인하나 |
|---|---|---|
| **제품에 임베드해 배포** — 온프렘 설치형 소프트웨어, 어플라이언스, 컨테이너 이미지에 엔진을 담아 고객에게 넘김 | RSALv2 는 "distribute … in a manner that makes the functionality available to third parties" 로 직접 금지. SSPLv1 도 배포 경로에서 조건이 걸린다 | 배포 산출물에 엔진 바이너리·이미지가 들어가는지. 들어가면 **BSD/MIT 계열(Valkey·Garnet·memcached·Redis ≤7.2)로 내려야 한다** |
| **캐시/데이터스토어 기능을 외부 고객에게 노출** — 멀티테넌트 SaaS 가 고객에게 Redis 프로토콜 엔드포인트나 그 기능을 상품으로 제공 | RSALv2 금지, SSPLv1 은 Service Source Code 전량 공개 조건 | "value … entirely or primarily derives from the value of the Software" 에 해당하는지. 우리 SaaS 의 내부 캐시로만 쓰는 것과는 다른 문제다 |
| **그룹사·계열사 경계** — 플랫폼 팀이 다른 법인에 공용 캐시를 서비스로 제공 | FAQ 는 affiliates·subsidiaries 를 organization 에 포함시킨다. 그러나 계약상 별개 법인에 유상 제공하는 형태가 "third parties" 인지는 원문으로 확정되지 않는다 `?` | 법인 구조와 과금 관계. **이 케이스는 원문만으로 판정하지 말 것** |
| **AGPL 을 사내 정책으로 금지한 조직** | AGPLv3 옵션을 못 고르므로 Redis 8.x 는 RSALv2 또는 SSPLv1 로만 쓸 수 있고, 그러면 위 두 케이스의 제약이 그대로 살아난다 | 사내 OSS 정책의 AGPL 조항. 트라이 라이선스가 "OSI 승인이라 안전"으로 자동 번역되지 않는다 |

`Σ`

버전 선택으로 이 문제를 피하려는 경우 두 함정이 있습니다. 하나는 **7.2.x 가 형식상 살아 있어도 2023-08-15 이후 기능이 동결된 상태**라는 것이고(패치의 실제 상류가 어디인지는 §6 넷째 항목), 다른 하나는 **RDB 포맷이 마이그레이션을 단방향으로 막는다**는 것입니다 — Redis 7.4+ (RDB 12)는 Valkey 8.x 로 넘어가지 못합니다. 차단선 전체는 [무엇을 고를 것인가]({{< relref "08-choosing.md" >}})와 [Valkey 8.0 → 9.1]({{< relref "05-valkey-8-to-9/index.md" >}})이 소유합니다.

마지막으로 이 문서의 논지를 운영 언어로 옮기면 이렇게 됩니다. **라이선스는 스냅샷이고 거버넌스는 그 스냅샷이 얼마나 오래 유효한지에 대한 확률입니다.** 2026-08 시점에 Redis 8.x 는 AGPLv3 옵션으로 OSI 승인 라이선스이고 사내 캐시 용도로는 아무 문제가 없습니다. 다만 그 옵션을 유지하거나 회수하는 결정은 단일 회사에 있습니다. 그 회사가 CLA 로 권리를 모아 두었기 때문입니다. Valkey 쪽은 같은 결정을 2/3 super-majority 와 1/3 조직 상한을 통과해야 내릴 수 있습니다. 재배포·외부 제공이 로드맵에 있는 조직이라면 판단 근거를 현재 라이선스 문자열이 아니라 이 구조 차이에 두는 편이 안전합니다 `Σ`

## 8. 근거

**라이선스 원문 (로컬 클론 직접 확인)**
- `redis 7.4.0:LICENSE.txt` — 1\~5줄 듀얼 선언, 78\~93줄 RSALv2 "Limitations", 654\~676줄 SSPLv1 §13 "Offering the Program as a Service"
- `redis 8.10.0:LICENSE.txt` — 트라이 라이선스 선언. `redis 8.0.0:LICENSE.txt` 는 13조가 GPLv3 본문 → `8.2.0` 에서 정정(커밋 `266835659`)
- `redis 7.4.0:REDISCONTRIBUTIONS.txt`, `redis 8.10.0:REDISCONTRIBUTIONS.txt` — BSD-3 잔여 고지
- `redis 7.2.15` 루트 = `COPYING`(BSD-3) / `redis 8.10.0` 루트 = `LICENSE.txt` (`git ls-tree --name-only`)
- `valkey 9.1.0:COPYING` — License 1(2024-present, Valkey contributors) · License 2(2006-2020, Redis Ltd.), 양쪽 BSD-3

**커밋·포크 기점**
- `redis`: `0b3439692` 2024-03-20T22:38:24Z (Pieter Cailliau) · 부모 `e64d91c37` 2024-03-20T20:44:28Z · `d65102861` 2025-05-01 (AGPLv3 추가)
- `valkey`: 첫 커밋 `38632278f` 2024-03-22T02:00:46Z (Madelyn Olson) · `4d284daef` 2024-08-14 (Pieter Cailliau)
- `git merge-base --is-ancestor e64d91c37 9.1.0` → YES · `git cat-file -e 0b3439692`(valkey) → 객체 없음 · 양쪽 `git rev-parse 7.2.4^{commit}` → `d2c8a4b91e8c0e6aefd1f5bc0bf582cddbe046b7` 동일

**거버넌스·기여 계약**
- `valkey 9.1.0:GOVERNANCE.md` — TSC 정의, 1/3 조직 상한, technical major decision(단순 과반 + 조건부 +2), governance major decision(2/3 super-majority), 논의 공개 원칙
- `valkey 9.1.0:MAINTAINERS.md` — Chair Madelyn Olson(Term: March 28, 2024 – Present), maintainer 9명과 소속
- `valkey 9.1.0:CONTRIBUTING.md`(DCO) vs `redis 8.10.0:CONTRIBUTING.md`(CLA 전문)

**커맨드 divergence**
- `git ls-tree --name-only <tag> src/commands/` 양쪽 diff — valkey 9.1.0 = 426, redis 8.10.0 = 460, Valkey 전용 18 / Redis 전용 52
- `valkey 9.1.1:src/config.c:3320` — `extended-redis-compatibility` 가 `MODIFIABLE_CONFIG` 로 생존

**회사·프로젝트 발표문 (URL 은 [출처]({{< relref "99-sources.md" >}}))**
- 2018-08-22 "Redis license: BSD will remain BSD" · 2019-02-21 모듈 라이선스 변경 · 2020-06-30 새 거버넌스 · 2020-07-09 Core Team update · 2021-08-11 리브랜딩 프레스릴리스 · 2022-11-15 모듈 듀얼 라이선스
- 2024-03-20 "Redis adopts dual source-available licensing" + FAQ(#11 비소급 · #12 BSD 백포트 · #20 사내 사용 허용 · #22 트레이드마크 · #24 CLA)
- 2024-03-28 Linux Foundation 프레스릴리스(초기 참여 5개사) · 2024-03-22 Redict 발표
- 2025-05-01 "AGPLv3 as a license option" · Redis 8 GA 블로그 · antirez.com/news/{120,133,144,151,152}
- Fedora Change "Replace Redis With Valkey" · sources.debian.org 의 redis·valkey copyright · Debian bug #1136392 · valkey.io 블로그(2024 회고 · Harbor 사례 · 2025-09 참여 현황)

**측정·계산**
- 커밋/저자 수는 `git log --format='%ae' --since=… --all | sort -u | wc -l` 로 양쪽 repo 직접 계측. **core repo 만이므로 양 진영 모두 과소평가** — 방향성만 유효
- 벤더·프로젝트 자체 발행 수치(AWS 가격 인하 발표, valkey.io 참여사·기여자 수)는 `Ⓥ` 로 표시하고 발표 시점을 함께 적었다. 가격 수치 자체는 07 이 소유한다

**미확인으로 남긴 것** — OSI 도메인의 2024년 Redis 관련 공식 게시물 · LF 프레스릴리스와 valkey.io/topics/history 의 초기 참여사 목록 불일치의 정본 · AWS 할인폭의 2026-08 현재성 · Oracle OCI Cache 의 Valkey 9.x 지원 · Google Memorystore GA 날짜의 1차 근거 · antirez 복귀 "결정" 시점(2024-11)의 1차 근거 · 그룹사 간 제공이 라이선스상 "third parties" 인지의 판정 · Redis Inc. 의 소송 부재

