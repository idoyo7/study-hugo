---
title: "모놀리스와 수직 확장 — 장애 도메인이 하나였던 시절"
linkTitle: "01 모놀리스와 수직 확장"
weight: 1
date: 2026-09-22
lastmod: 2026-09-22
url: "/cellarch/01-monolith/"
---

# 01 · 모놀리스와 수직 확장 — 장애 도메인이 하나였던 시절

{{< callout type="info" >}}
- **확장과 격리는 다른 문제다** — 앱 서버를 늘리면 처리량은 늘지만, 뒤에 놓인 DB가 하나면 장애 도메인은 그대로 하나로 남는다 `Σ`
- **2008년 eBay 발표는 분할의 두 축을 함께 제시했다** — Randy Shoup의 "Partition by Function"과 "Split Horizontally"가 훗날 각각 마이크로서비스와 셀로 갈라져 이어진다 `✓`
- **Amazon의 3-tier 전환은 1차 문서로 남아 있지만, 그 뒤 흔히 도는 해체 서사는 2차 출처뿐이다** — Obidos를 3년에 걸쳐 쪼갰다는 이야기는 출처를 밝히지 않으면 단언할 수 없다 `✓`/`?`
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

트래픽이 늘면 더 큰 머신을 들이거나 앱 서버를 더 붙일 수 있었습니다. 모놀리스 시대에도 두 방식 모두 쓰였습니다. 하지만 데이터베이스 한 대를 공유하는 구조에서는 처리량을 늘린 뒤에도 그 DB의 장애가 서비스 전체로 번졌습니다. 초기 웹 서비스의 실패 단위가 대개 "서비스 전체"였던 이유입니다 `Σ`.

## 1. 코드 안의 경계가 장애를 막지는 못했다

Brian Foote와 Joseph Yoder는 1997년 PLoP 학회에서 "Big Ball of Mud"를 발표했습니다. 우아한 아키텍처 패턴 논의와 별개로, 현장에서 실제로 쓰이는 구조는 대개 진흙덩어리라는 게 이 논문의 논지입니다 `✓`.

> "A BIG BALL OF MUD is a casually, even haphazardly, structured system. Its organization, if one can call it that, is dictated more by expediency than design."
>
> — Foote & Yoder, *Big Ball of Mud*, PLoP'97

논문이 짚은 증상은 정보가 시스템 곳곳에 무분별하게 공유된다는 것입니다. "거의 모든 중요한 정보가 전역이 되거나 중복된다"는 표현은 이후 마이크로서비스 진영이 모놀리스의 병리를 설명할 때 두고두고 인용하는 문구가 됐습니다.

기술적으로는 하나의 배포 단위, 하나의 코드베이스, 하나의 데이터베이스였습니다. 클래스나 모듈로 내부를 나눌 수는 있었지만, 그 경계는 관습에 의존했습니다. 따로 배포하거나 장애 전파를 막을 수 있는 벽은 아니었습니다 `Σ`.

## 2. Amazon의 3-tier 전환이 풀려던 결합

Amazon 내부에는 1998년에 작성된 "Distributed Computing Manifesto"라는 문서가 있습니다. Werner Vogels가 2022년 11월에 이 문서를 공개하며 당시 구조를 설명했습니다 `✓`.

> "a monolithic, stateless application (Obidos) that was used to serve pages and a whole battery of databases"
>
> — Werner Vogels, "The Distributed Computing Manifesto", 2022-11

1998년 문서는 기존 2-tier 구조가 데이터에 묶여 있다고 진단했습니다.

> "Our current two-tier, client-server architecture is one that is essentially data bound."
>
> — Amazon, "Distributed Computing Manifesto", 1998

당시 클라이언트는 데이터 구조와 위치에 직접 묶여 있었습니다. 데이터 모델이 바뀌면 기능이 그대로여도 애플리케이션을 같이 고쳐야 했습니다. 문서가 제시한 해법은 표현·비즈니스 로직·데이터를 분리하는 3-tier 구조였습니다.

> "towards a three-tier architecture where presentation (client), business logic and data are separated"
>
> — Amazon, "Distributed Computing Manifesto", 1998

Vogels는 이 결정이 참고할 교과서도, 구입할 상용 소프트웨어도 없이 내려졌다고 회고합니다.

> "there is no textbook you can rely on, nor is there any commercial software you can buy"
>
> — Werner Vogels, "The Distributed Computing Manifesto", 2022-11

이후의 해체 과정은 문서로 확인되는 범위가 다릅니다. "2001년에 결단을 내려 Obidos를 3년에 걸쳐 해체했다", "처음엔 customers·catalog·orders 세 조각으로 쪼갰는데 각각이 다시 원래 모놀리스만큼 커졌다"는 서사가 여러 2차 자료에서 반복됩니다. 하지만 Amazon 1차 문서로는 확인되지 않았습니다. 강연 전언일 가능성이 높습니다 `?`. 1998년 문서에 담긴 3-tier 전환 결정과, 이후 몇 년에 걸쳐 무엇을 어떻게 쪼갰는지는 확신도가 다른 별개의 주장입니다.

## 3. 앱 서버를 늘려도 남는 공유 데이터베이스

2000년대 중반 이후 흔해진 배치는 3-tier 위에 앱 계층의 수평 확장을 얹는 방식이었습니다. 로드밸런서 뒤에 같은 코드를 실행하는 앱 서버를 여러 대 두고, 트래픽이 늘면 대수를 늘립니다. 상태를 갖지 않는 앱 계층에서는 잘 작동합니다. 다만 그 모두가 같은 데이터베이스 한 대를 바라보면, 데이터 계층의 장애를 함께 겪습니다 `Σ`.

DB가 느려지면 앱 서버가 100대든 3대든 전체 요청이 함께 느려집니다. DB가 죽으면 앱 서버가 몇 대 살아 있든 서비스 전체가 멎습니다. 아래 도식에서 앱 계층을 늘린 뒤에도 요청 경로가 어디로 모이는지 볼 수 있습니다.

{{< flow src="_flow/5-3tier.json" />}}

도식의 배치를 수직 확장과 비교하면, 처리량을 늘리는 방식은 달라도 단일 장애점이 남는다는 공통점이 드러납니다.

| 축 | 수직 확장 | 수평 확장(앱 계층만) |
|---|---|---|
| 늘어나는 것 | 머신 한 대의 사양 | 같은 역할의 인스턴스 수 |
| 처리량 | 상한이 있다 | 이론상 무제한 |
| 장애 도메인 | 하나(그 머신) | 앱 계층은 여럿, DB는 여전히 하나 |
| 단일 장애점 | 그 머신 자체 | 공유 데이터베이스 |

더 큰 머신은 처리량 상한에 부딪히는 시점을 미룰 수 있습니다. 앱 서버를 더 붙이면 앱 계층의 처리량을 늘릴 수 있습니다. 어느 쪽도 공유 DB에 의존하는 구조 자체를 바꾸지는 않습니다.

## 4. Netflix 2008: 사흘간 멈춘 DVD 배송

Netflix는 2008년 8월 데이터베이스 손상 사고를 겪었습니다. 회사가 2016년 공개한 회고에서 직접 확인되는 내용입니다 `✓`.

> "We experienced a major database corruption and for three days could not ship DVDs to our members."
>
> — Yury Izrailevsky, Stevan Vlaovic, Ruslan Meshenberg, "Completing the Netflix Cloud Migration", 2016-02-12

이 사고에는 "가입자 840만 명 중 3분의 1이 영향을 받았다", "디스크 어레이에 펌웨어를 밀어 넣다가 DB가 깨졌다"는 세부가 흔히 따라붙습니다. 그러나 이 내용은 2차 자료에서만 반복됩니다. 1차 문서로 확인되는 배송 중단과 구분해야 하며, 여기서는 사고 원인까지 단언하지 않습니다 `?`.

Netflix가 사고 뒤 내린 판단은 같은 회고에 남아 있습니다.

> "We realized that we had to move away from vertically scaled single points of failure, like relational databases in our datacenter, towards highly reliable, horizontally scalable, distributed systems in the cloud."
>
> — Yury Izrailevsky, Stevan Vlaovic, Ruslan Meshenberg, "Completing the Netflix Cloud Migration", 2016-02-12

관계형 DB를 더 큰 머신에 얹어도 그 머신이 실패하면 전체가 멎는 구조는 그대로입니다. Netflix는 "vertically scaled single point of failure"에서 벗어나려 했고, 기존 시스템을 그대로 클라우드로 옮기는 리프트앤시프트도 거부했습니다. 장소만 바꾸면 기존 제약까지 따라오기 때문입니다.

> "The easiest way to move to the cloud is to forklift all of the systems, unchanged, out of the data center and drop them in AWS. But in doing so, you end up moving all the problems and limitations of the data center along with it."
>
> — Yury Izrailevsky, Stevan Vlaovic, Ruslan Meshenberg, "Completing the Netflix Cloud Migration", 2016-02-12

## 5. eBay가 제시한 분할의 두 축

Randy Shoup은 eBay의 아키텍처 역사를 다섯 세대로 정리해 여러 자리에서 반복했습니다. 팟캐스트와 컨퍼런스 발표가 출처라 세대별 연도가 자료마다 조금씩 어긋나지만, 큰 흐름은 일치합니다 `≈`.

| 세대 | 시기 | 기술 스택 |
|---|---|---|
| 1 | 1995 | Perl, 아이템 하나가 파일 하나, 486 타워 한 대 |
| 2 ("V2") | 1997 | C++ 모놀리스 |
| 3 | 2002 | XSL + Java |
| 4 | 2007 | 풀스택 Java |
| 5 | 2013~ | 폴리글랏 마이크로서비스 |

Shoup은 각 세대가 그 시점에는 옳은 선택이었다고 말합니다. 1995년에 마이크로서비스로 시작했다면 그 규모에서는 자기 무게로 무너졌을 것이라는 설명입니다. V2에서 V3로 넘어가는 데만 5년이 걸렸고, 그동안 신구 페이지를 나란히 운영했습니다. 전환은 한 번에 끝나는 빅뱅 방식이 아니었습니다 `≈`.

2008년 5월 28일 InfoQ가 정리한 Shoup의 발표에는 분할 방향이 구체적으로 나옵니다 `✓`. 그는 확장성을 "기능과 무관한 비기능 요구사항"으로 보는 통념을 반박하면서, 일곱 가지 실천 원칙 중 앞의 두 가지를 다음과 같이 제시했습니다.

1. **Partition by Function** — 기능 단위로 나눈다. 훗날의 마이크로서비스다.
2. **Split Horizontally** — 같은 종류를 여러 조각으로 쪼갠다. 훗날의 샤드이자 셀이다.

당시 eBay는 사용자 수억 명, 하루 20억 페이지뷰 이상, 데이터 페타바이트급 규모를 이 원칙으로 감당하고 있었습니다 `✓`. "Split Horizontally"는 앱 계층 너머 데이터 계층까지 분할을 밀어붙이자는 방향이었습니다. Netflix가 부딪힌 공유 DB의 한계를 앱 서버 증설만으로 풀 수 없었던 이유와 맞닿아 있습니다.

두 방향은 2008년에 이미 한 발표 안에 나란히 있었습니다. 업계는 그중 기능 분할을 십수 년 밀어붙이다가 뒤늦게 수평 분할로 돌아옵니다. [02 SOA → 마이크로서비스]({{< relref "/engineering/architecture/02-microservices/index.md" >}})에서는 기능 분할이 바꾼 배포·확장·조직의 경계를, [04 셀의 해부]({{< relref "/engineering/architecture/04-cell-anatomy/index.md" >}})에서는 워크로드를 나누는 셀의 경계를 이어서 다룹니다.

## 6. 기능을 나눈 뒤에도 남는 공유 층

코드·배포·데이터·인프라를 나란히 놓으면, 모놀리스에서 셀까지 각 세대가 어디에 경계를 세웠는지 비교할 수 있습니다.

{{< lane src="_lane/6-시리즈-지도.json" />}}

도식에서 MSA 이후에도 남는 인프라의 공유 층에는 메시지 큐, 캐시, 설정 저장소, 서비스 디스커버리 같은 것들이 있습니다. 코드와 배포, 데이터를 나눈 뒤에도 이 의존성을 함께 쓰면 장애가 서비스 경계를 넘을 수 있습니다. [03 공유 의존성 장애]({{< relref "/engineering/architecture/03-shared-failure/index.md" >}})는 그 전파를 실제 사례로 다룹니다. 셀은 이 공유 층까지 나누기 위해 워크로드 전체를 통째로 복제합니다.

## 참고 자료

- [Big Ball of Mud, PLoP'97](https://hillside.net/plop/plop97/Proceedings/foote.pdf) — Brian Foote, Joseph Yoder, 1997
- [The Distributed Computing Manifesto](https://www.allthingsdistributed.com/2022/11/amazon-1998-distributed-computing-manifesto.html) — Werner Vogels, allthingsdistributed.com, 2022-11
- [Scalability Best Practices: Lessons from eBay](https://www.infoq.com/news/2008/05/ebay-scalability-lessons) — Randy Shoup 경유 Floyd Marinescu, InfoQ, 2008-05-28
- [Completing the Netflix Cloud Migration](https://about.netflix.com/en/news/completing-the-netflix-cloud-migration) — Yury Izrailevsky, Stevan Vlaovic, Ruslan Meshenberg, Netflix, 2016-02-12
- Randy Shoup, Software Engineering Radio 525 (2022-08) — eBay 5세대 정리, 팟캐스트 전언 `≈` (URL 미확인)
