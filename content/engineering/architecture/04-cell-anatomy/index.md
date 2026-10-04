---
title: "셀 기반 아키텍처 — 정의, 계보, 해부"
linkTitle: "04 셀의 해부"
weight: 4
date: 2026-09-22
lastmod: 2026-09-22
url: "/cellarch/04-cell-anatomy/"
---

# 04 · 셀 기반 아키텍처 — 정의, 계보, 해부

{{< callout type="info" >}}
- **셀은 워크로드 전체의 독립 사본이다** — AWS 백서는 "독립적으로 돌아가는 데 필요한 모든 것을 갖춘 완전한 워크로드"라고 정의한다 `✓`
- **"cell"이라는 단어는 세 갈래가 서로 다른 뜻으로 사용했다** — Google Borg의 스케줄링 도메인, WSO2의 API 조합 단위, AWS의 폭발 반경 격리 단위는 이름만 같고 뜻이 다르다 `✓`
- **셔플샤딩은 셀이 아니라 셀 안에서 쓰는 조합 기법이다** — AWS FAQ가 이 둘을 직접 구분해 못 박는다 `✓`
{{< /callout >}}

근거 표기 — `✓` 1차 문서 확인 · `Ⓑ` 공개 벤치마크 · `Ⓥ` 벤더·프로젝트 주장 · `≈` 추정·역산 · `?` 미확인 · `Σ` 종합 판단.

서비스를 수백 개로 쪼개도 설정 저장소나 메타데이터 DB를 함께 쓰면 장애가 전체로 번질 수 있습니다. [03 공유 의존성 장애]({{< relref "/engineering/architecture/03-shared-failure/index.md" >}})에서 본 문제입니다. 셀 기반 아키텍처는 고객 몫 단위로 워크로드를 통째로 복제하고, 그 앞에 얇은 라우터를 둡니다. AWS는 이 패턴을 2023년 9월 백서로 공식화했지만, 개념 자체는 그보다 훨씬 오래됐습니다.

## 1. 셀의 경계와 가용성

AWS Well-Architected 가이던스 *Reducing the Scope of Impact with Cell-Based Architecture*(2023-09-20)는 셀을 다음과 같이 정의합니다.

> "A cell-based architecture uses multiple isolated instances of a workload, where each instance is known as a *cell*. Each cell is independent, does not share state with other cells, and handles a subset of the overall workload requests." `✓`

셀은 다른 셀과 상태를 공유하지 않고 전체 요청의 일부를 처리하는 독립 워크로드입니다. 컴퓨트·데이터·캐시·큐 전부를 포함하므로, 데이터스토어만 격리한 DB 샤드는 셀의 부분집합입니다. 셀의 경계를 AZ와 맞출 필요도 없습니다. 백서는 "zonal, regional, or global" 모두 가능하다고 명시합니다. AZ에 맞추는 것은 한 가지 선택지입니다.

워크로드를 복제한다고 인프라를 N배로 늘리는 것도 아닙니다. 백서는 호스트 30대짜리 애플리케이션이 셀 구조에서도 같은 30대일 수 있다고 설명합니다. 나누는 것은 요청을 처리하는 범위이며, 셀 하나의 장애가 전체에 미치는 영향은 다음 예시로 설명합니다.

> "If a workload uses 10 cells to service 100 requests, when a failure occurs in one cell, 90% of the overall requests would be unaffected by the failure." `✓`

이 산수만으로는 총 가용성이 높아진다고 말할 수 없습니다. `n`개 셀이면 장애 건수도 `n`배로 늘고 각 건의 영향은 `1/n`이니 상쇄된다는 계산이 가능합니다. 백서는 셀의 MTBF와 MTTR이 달라진다고 반박합니다 `✓`.

> "But the higher MTBF and lower MTTR afforded by cells means fewer shorter failures events per cell, and higher overall availability."

백서는 이어서 "With cells, you can minimize the amount of time the numerator is zero"라고 덧붙입니다 `✓`. 전면 장애를 부분 장애로 바꿔 분자가 0이 되는 시간을 줄이는 것이 가용성의 이득이며, 1/N은 그때의 영향 비율입니다 `Σ`. MTBF가 오르는 이유도 명시합니다 `✓` — "Cells have a consistent capped size that is regularly tested and operated, eliminating the *every day is a new adventure* dynamic."

## 2. 계보 — 같은 이름, 서로 다른 격리 단위

"셀"을 누가 처음 말했는지 깔끔한 답은 없습니다. 하나의 족보보다 수렴 진화에 가깝습니다 `Σ`.

개념 자체는 단어보다 먼저 있었습니다. Michael Nygard가 *Release It!*(2007)에서 명명한 벌크헤드 패턴은 "장애 격리 구획"이라는 발상을 담고 있습니다 `≈`(책 지면 미확인, 2차 출처 간 문구는 일치). 같은 시기에 이미 실물도 있었습니다. Flickr는 2007년 userID를 shardID로 매핑하는 룩업 링을 공개했지만 이건 DB 샤딩이지 풀스택 격리는 아니었습니다 `≈`. Salesforce는 2008년 백서에서 pod(인스턴스) 하나가 고객 약 1만 곳의 앱+DB 전체를 담는 구조를 설명했습니다 `Ⓥ`. 셀이라는 단어 없이도 워크로드 전체를 고객 몫으로 나눈 구조였습니다.

단어 "cell"은 Google이 먼저 썼습니다. Borg 논문(Verma 외, EuroSys 2015)은 "A cluster usually hosts one large Borg cell"이라 쓰고, 중앙값 셀 크기를 머신 약 1만 대로 보고합니다 `≈`(논문 PDF 판독 실패, 2차 요약 경유). Borg의 cell은 Borgmaster 하나가 관장하는 머신 풀, 즉 스케줄링·자원 할당 도메인입니다. 워크로드를 복제해 장애 영향을 줄이는 셀과는 격리하는 대상이 다릅니다 `Σ`.

"cell-based architecture"라는 정확한 문구를 문서 제목에 먼저 쓴 것은 WSO2입니다(Abeysinghe & Fremantle, 2018-06) `✓`.

> "A cell is a collection of components, grouped from design and implementation into deployment. A cell is independently deployable, manageable, and observable." `✓`

WSO2의 셀은 서비스·API 묶음과 인그레스·이그레스 정책, 셀 게이트웨이로 이뤄진 API 조합과 거버넌스 단위입니다. 장애 영향의 격리와는 다른 문제를 풉니다. Kubernetes 참조 구현이던 Cellery는 WSO2 스스로 유지보수를 중단했다고 밝혔고 `✓`, 외부 도입 사례도 확인되지 않습니다.

오늘날의 뜻 — 폭발 반경 축소를 위한 독립 워크로드 복제본 — 은 AWS가 만들었습니다. 개념은 2014년 Colm MacCárthaigh의 셔플샤딩 글에서 활자로 먼저 나왔고, 어휘는 2019년 re:Invent ARC342 세션 제목에 등장했으며, 정의는 2023년 백서로 굳었습니다 `✓`. AWS가 스스로 밝힌 계보는 Borg도 WSO2도 아닌 배 격벽입니다 `✓`.

> "A cell-based architecture comes from the concept of a bulkhead in a ship, where vertical partition walls subdivide the ship's interior into self-contained, watertight compartments."

Azure는 원조를 주장하지 않고 동의어 목록으로 정리합니다. Deployment Stamps 문서는 이렇게 씁니다 `✓`.

> "Deploy multiple independent copies of application components, including data stores, as a single group of resources. Each copy is called a *stamp*, or sometimes a *service unit*, *scale unit*, or *cell*."

이 시리즈에서 쓰는 셀은 AWS가 정식화한 독립 워크로드 복제본입니다. Borg와 WSO2의 cell은 같은 이름을 쓰지만 서로 다른 개념입니다.

| 시점 | 갈래 | 뜻 |
|---|---|---|
| 2007~2008 | Nygard 벌크헤드 · Flickr 샤딩 · Salesforce pod | 개념 선행, 단어 없음 |
| 2014 | AWS 셔플샤딩(MacCárthaigh) | 폭발 반경 어휘가 활자로 처음 등장 |
| 2015 | Google Borg cell(논문) | 스케줄링 도메인 — 다른 개념 |
| 2018 | WSO2 cell-based architecture | API 조합·거버넌스 단위 — 다른 개념 |
| 2019 | AWS re:Invent ARC342 | "cell-based architecture" 어휘 사용 |
| 2023-09-20 | AWS Well-Architected 백서 | 오늘날 표준 정의 확정 |

## 3. 라우터와 컨트롤 플레인의 책임

AWS 백서가 나누는 구성 요소는 셀 라우터·셀·컨트롤 플레인입니다 `✓`. 라우터는 "the thinnest possible layer, with the responsibility of routing requests to the right cell, and only that"이며, 셀은 "A complete workload, with everything needed to operate independently"입니다. 컨트롤 플레인은 셀 프로비저닝·해제·고객 이전을 맡는 관리 계층입니다.

다음 도식에서 요청이 지나가는 경로와 셀을 관리하는 경로가 어디서 갈라지는지 볼 수 있습니다.

{{< flow src="_flow/3-셀-구조.json" />}}

이 구조에서 라우터는 셀들 사이에서 유일하게 공유되는 컴포넌트입니다. 백서는 이 사실이 곧 위험이라고 직접 인정합니다 `✓`.

> "the only component that has the shared state of all cells is the cell router. It presents itself as a single point of failure. Therefore, it is essential that it be built of with maximum reliability and also as a cellular component."

라우터에는 별도 규율 여섯 가지가 붙습니다 `✓`. 간단해야 하고, 셀 간 요청 처리가 서로 격리돼야 하며, 비즈니스 로직을 최소화해야 합니다. 셀 구현의 복잡함을 클라이언트로부터 감추면서 빠르고 신뢰할 수 있어야 하고, 셀 하나가 응답하지 못해도 다른 셀은 계속 돌아야 합니다. 이 조건들은 라우터를 셀보다 단순하게 유지하도록 요구합니다 `Σ`.

라우터와 컨트롤 플레인의 분리도 이 규율의 일부입니다. 라우터(데이터 플레인)는 이미 정해진 매핑을 읽기만 하고, 매핑을 바꾸는 일은 컨트롤 플레인이 맡습니다 `✓`. 컨트롤 플레인이 죽어도 라우터는 마지막으로 알던 매핑으로 계속 동작합니다. static stability 원칙이 여기에도 적용됩니다.

셀끼리 직접 호출하는 것도 원칙적으로 금지됩니다. 셀 경계를 넘는 호출은 도식의 일반 요청 경로로 돌아가야 합니다 `✓`.

> "instead of letting the cells talk directly to each other, any cross-cell calls have to go back through the normal cell router."

## 4. 파티션 키, 셀 크기, 배포 단위

파티션 키는 서비스의 "결(grain)"에 맞아야 합니다 `✓`. 고객 ID나 리소스 ID가 흔한 예시입니다. 문제는 고객이 셀보다 커질 때입니다. 백서는 이 경우 고객을 더 나눌 수 있는 차원을 명시합니다 `✓`.

> "A good strategy is to define a second dimension more aligned with your type of business to be part of the partition key along with the customerId."

customerId 하나로 나누다가 특정 고객이 셀의 수용 범위를 넘으면, 지역이나 리소스 유형 같은 둘째 축을 더한 복합 키로 나눕니다. 매핑 방식이 무엇이든 override table은 필수라는 경고도 있습니다 `✓`. 문제 테넌트를 격리하거나 특정 키를 강제로 다른 셀에 배정할 때 쓰는 안전장치입니다.

셀 크기는 상충하는 힘 세 가지 사이에서 정해집니다 `✓`.

| 힘 | 방향 |
|---|---|
| 최대 워크로드 수용 | 셀을 키우는 쪽 |
| 풀스케일 테스트 가능 | 셀을 작게 유지하는 쪽 |
| 규모의 경제 | 셀을 키우는 쪽 |

크기 상한을 정하는 이유는 셀이 너무 커서 테스트할 수 없는 상태를 피하기 위해서입니다. 백서는 서비스 전체와 셀 하나를 검증하는 비용을 구분합니다 `✓`.

> "It is impractical for cost reasons for large-scale services to regularly simulate the entire workload of all their tenants, but it is reasonable to simulate the largest workload that can fit into a cell."

배포도 셀 단위 웨이브로 진행합니다 `✓` — "deploy in waves, cell by cell or set of cells." 첫 셀은 카나리 셀로 두고 합성 트래픽으로 먼저 검증합니다 `✓`. 회사마다 이 경계를 어디에 뒀는지는 [05 실전 사례]({{< relref "/engineering/architecture/05-cell-cases/index.md" >}})에서 이어집니다.

## 5. 셔플샤딩의 조합 수와 재시도 전제

AWS FAQ는 셀과 셔플샤딩을 직접 구분합니다 `✓`.

> "In a cell-based architecture, a cell should be self-contained, not share its state. We can use shuffle-sharding within a cell, but cross-cells should not be used by definition."

셀은 서로 겹치지 않는 워크로드 복제본이고, 셔플샤딩은 고객마다 겹치는 워커 조합을 나눠주는 기법입니다. 셀 안에서 셔플샤딩을 함께 쓸 수 있습니다.

조합 수는 출처마다 다르게 나오니 구분해서 읽어야 합니다. 2014년 원조 글은 워커 8대 중 2대를 고르는 경우의 수를 **56**으로 씁니다 `✓`.

> "By choosing two instances from eight there are 56 potential shuffle shards, much more than the four simple shards we had before."

2019년 Builders' Library 정본은 같은 8워커 예시에서 **28**을 씁니다 `✓`. 56은 순서를 구분한 8×7이고, 28은 순서 없는 조합 C(8,2)입니다. 최신·정본은 28입니다.

> "With eight workers, there are 28 unique combinations of two workers... the scope of impact due to a problem is just 1/28th. That's 7 times better than regular sharding."

같은 2014년 글은 다른 예시에서 4개 조합 단위를 쓰면 영향을 훨씬 더 좁힐 수 있다고도 말합니다 `✓`(다만 이 예시의 전체 풀 크기는 인용 맥락에서 확인하지 못했습니다 `?`).

> "With four instances per shuffle shard, we can reduce the impact to 1/1680 of our total customer base."

8워커 예시에서 샤딩 방식별 영향 범위를 비교하면 다음과 같습니다 `✓`.

| 방식 | 구성 | 영향 범위 |
|---|---|---|
| 샤딩 없음 | 워커 8개가 전부 모든 요청 처리 | 100% |
| 일반 샤딩 | 4샤드 × 2워커 | 25%(1/4) |
| 셔플 샤딩 | 8개 중 2개 조합 = 28 | 1/28 ≈ 3.6% |

다음 도식은 워커 조합이 겹치는 구조와 고객에게 서비스가 완전히 끊기는 비율을 나란히 보여줍니다.

{{< flow src="_flow/5-셔플샤딩.json" />}}

{{< lane src="_lane/5-영향-비율.json" />}}

도식의 영향 비율은 워커 손실 비율과 다릅니다. 셔플샤딩을 해도 여전히 8분의 2, 즉 25%의 워커가 망가집니다. 줄어드는 것은 **완전히 서비스를 못 받는 고객의 비율**입니다. 겹치지 않는 조합을 받은 다른 고객은 계속 서비스를 받습니다. 다만 전제가 붙습니다 `✓` — "If the requestors are fault tolerant and can work around this (with retries for example)." 클라이언트가 재시도를 해줘야 이 이득이 실현됩니다.

[06 AWS의 격리 설계]({{< relref "/engineering/architecture/06-aws-isolation/index.md" >}})에서 다루는 Route 53은 가상 네임서버 2048개 중 도메인 하나당 4개를 배정하며 `✓`, AWS가 표현한 조합 수는 "약 7,300억(730 billion)"이고 `Ⓥ`(MacCárthaigh 스레드 경유 2차 인용, 검산값 C(2048,4)=730,862,190,080), 어떤 고객 도메인도 다른 도메인과 가상 네임서버를 2개보다 많이 공유하지 않습니다 `✓`.

## 참고 자료

- [Reducing the Scope of Impact with Cell-Based Architecture](https://docs.aws.amazon.com/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/) — AWS Well-Architected, 2023-09-20
- [Cell-based architecture FAQ](https://docs.aws.amazon.com/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/faq.html) — AWS Well-Architected
- [Shuffle Sharding: Massive and Magical Fault Isolation](https://aws.amazon.com/blogs/architecture/shuffle-sharding-massive-and-magical-fault-isolation/) — Colm MacCárthaigh, AWS Architecture Blog, 2014-04-14
- [Workload isolation using shuffle-sharding](https://d1.awsstatic.com/builderslibrary/pdfs/workload-isolation-using-shuffle-sharding.pdf) — Colm MacCárthaigh, AWS Builders' Library, 2019
- [re:Invent 2019 ARC342-R1 슬라이드](https://d1.awsstatic.com/events/reinvent/2019/REPEAT_1_Cell-based_architectures_for_global,_well-architected_apps_ARC342-R1.pdf) — AWS re:Invent 2019
- [Large-scale cluster management at Google with Borg](https://research.google/pubs/large-scale-cluster-management-at-google-with-borg/) — Verma et al., EuroSys 2015
- [Cell-based architecture reference](https://github.com/wso2/reference-architecture/blob/master/reference-architecture-cell-based.md) — Abeysinghe & Fremantle, WSO2, 2018
- [Deployment Stamps pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/deployment-stamp) — Microsoft Learn
- Michael Nygard, *Release It!* 1판, Pragmatic Bookshelf, 2007 — 벌크헤드·서킷 브레이커 명명 `≈`(지면 미확인)
